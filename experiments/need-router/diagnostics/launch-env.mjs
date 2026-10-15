// Launch-environment check (D6, "the launch environment decides the cache-write rate"). Which cache-write rate did the CLI bill in real sessions run after
// FORCE_PROMPT_CACHING_5M=1 entered the policy (commit 5f145ba, 2026-10-08 20:55 UTC)? The pinned price table prices cache writes at the 5-minute rate
// (1.25 x input); if the sessions of a stage are launched without the switch the CLI bills the 1-hour rate (2 x input) and the label factory's re-price
// falls short of the reported figure.
//   node experiments/need-router/diagnostics/launch-env.mjs [--root /var/tmp/foundry-work] [--write]
// scans saved CLI transcripts (`.executor-transcript.jsonl`, modified after the flag), takes from each the final `result` event (its usage, its cache-write
// split and the CLI-reported cost), prices that usage with the pinned table at the 5-minute and at the 1-hour cache-write rate and compares both with the
// reported figure. --write saves research/need-router-20261014/analysis/m0/launch-env.json: one record per transcript with the first 16 hex of its sha256, its
// size and modification time, and the per-model summary the report renders. run.mjs reads that committed file (it never opens a transcript), so every number
// of the D6 launch-environment paragraph is either in a committed file or recomputed from one; this script is the only place that reads the transcripts.
// Only usage numbers, the model name and a hash leave a transcript; no prompt, output or tool text is copied. $0, no model call, no network.
// Evidence grade: LEGACY/dev (archived sessions of this container).
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUT_DIR, REPO, rel, sha256, median, round, readJson } from './common.mjs';
import { STAGES_FILE } from './census.mjs';
import { priceTokens, CACHE_FLAG } from './d6-cost.mjs';

export const LAUNCH_ENV_SCHEMA = 'need-launch-env/1';
export const LAUNCH_ENV_FILE = path.join(OUT_DIR, 'launch-env.json');
export const TRANSCRIPT_NAME = '.executor-transcript.jsonl';
export const DEFAULT_ROOT = '/var/tmp/foundry-work';
export const EXACT = 0.01;   // "equals the pinned table at a rate" means within 1%

/** Every transcript file under root (depth-first, sorted), as { file, bytes, mtime }. */
export function listTranscripts(root) {
  const out = [];
  const walk = d => {
    let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name === TRANSCRIPT_NAME) { const st = statSync(f); out.push({ file: f, bytes: st.size, mtime: st.mtime.toISOString() }); }
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

/** The last `result` event of a stream-json transcript (text), or null. */
export function finalResult(text) {
  let result = null;
  for (const line of text.split('\n')) {
    if (!line.includes('"type":"result"')) continue;
    try { const e = JSON.parse(line); if (e?.type === 'result') result = e; } catch { /* a torn last line of a session still running */ }
  }
  return result;
}

/**
 * One session's cache-rate record from its final result event, or { skipped } with the reason. Prices the aggregate usage with the pinned table at the
 * 5-minute rate (all cache writes at 1.25 x input) and at the 1-hour rate (2 x input), each at the lowest tier and at the aggregate tier (they differ
 * only for Haiku, whose tiers split at 100K tokens of one request, which an aggregate cannot see). `exact1h` / `exact5m`: the reported figure is within 1%
 * of the price at that rate at either tier. `ratio5mOverReported`: the lowest-tier 5-minute price over the reported figure, which is how far a label-run
 * re-price that takes its output tokens from the final usage lands from the CLI's figure if the pinned table's rate is not the one billed.
 */
export function cacheRateOf(result, table) {
  const u = result?.usage, models = Object.keys(result?.modelUsage ?? {});
  if (!u || !Number.isFinite(result.total_cost_usd) || !(result.total_cost_usd > 0)) return { skipped: 'no usage or no CLI-reported cost in the final result' };
  if (models.length !== 1) return { skipped: models.length ? 'more than one model in one session' : 'no model recorded' };
  const model = models[0];
  if (!table.models[model]) return { skipped: `model ${model} is not in the pinned price table` };
  const cc = u.cache_creation ?? {}, w1 = cc.ephemeral_1h_input_tokens ?? 0;
  const w5 = cc.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1);
  const tok = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 };
  const at = (writes5, writes1, low) => priceTokens(table, model, { ...tok, cacheWrite5m: writes5, cacheWrite1h: writes1 }, { low }).usd;
  const billed = { low: at(w5, w1, true), agg: at(w5, w1, false) };           // as the CLI split them
  const all5 = { low: at(w5 + w1, 0, true), agg: at(w5 + w1, 0, false) };      // every write at the 5-minute rate (the pinned table's assumption)
  const all1 = { low: at(0, w5 + w1, true), agg: at(0, w5 + w1, false) };      // every write at the 1-hour rate
  const rep = result.total_cost_usd, near = (x, y) => Math.abs(x / y - 1) <= EXACT;
  return {
    model, reportedUsd: round(rep, 6), cacheWriteTokens: w5 + w1, cacheWrite1hShare: w5 + w1 > 0 ? round(w1 / (w5 + w1), 3) : null, outputTokens: tok.output,
    price5mUsd: round(all5.low, 6), price1hUsd: round(all1.low, 6), priceBilledSplitUsd: round(billed.low, 6),
    exact1h: near(all1.low, rep) || near(all1.agg, rep), exact5m: near(all5.low, rep) || near(all5.agg, rep), exactBilledSplit: near(billed.low, rep) || near(billed.agg, rep),
    ratio5mOverReported: round(all5.low / rep, 4), ratio1hOverReported: round(all1.low / rep, 4),
  };
}

/** Records for some transcripts: { path, bytes, mtime, sha256 (16 hex), ...cacheRateOf } or { path, bytes, mtime, sha256, skipped }. `read` is injected by tests. */
export function measureTranscripts(entries, table, { root = REPO, read = f => readFileSync(f, 'utf8') } = {}) {
  return entries.map(({ file, bytes, mtime }) => {
    const text = read(file), base = { path: path.relative(root, file).split(path.sep).join('/'), bytes, mtime, sha256: sha256(text).slice(0, 16) };
    const result = finalResult(text);
    return result ? { ...base, ...cacheRateOf(result, table) } : { ...base, skipped: 'no final result event (a session still running, or killed)' };
  });
}

/** The per-model summary the report renders. */
export function summariseLaunchEnv(records) {
  const used = records.filter(r => !r.skipped), by = {};
  for (const r of used) (by[r.model] ??= []).push(r);
  return {
    transcripts: records.length, withFinalUsage: used.length, skipped: records.length - used.length,
    skippedReasons: records.filter(r => r.skipped).reduce((a, r) => ({ ...a, [r.skipped]: (a[r.skipped] ?? 0) + 1 }), {}),
    byModel: Object.fromEntries(Object.entries(by).sort().map(([m, rs]) => [m, {
      sessions: rs.length, allWritesOneHour: rs.filter(r => r.cacheWriteTokens > 0 && r.cacheWrite1hShare === 1).length, withCacheWrites: rs.filter(r => r.cacheWriteTokens > 0).length,
      exact1h: rs.filter(r => r.exact1h).length, exact5m: rs.filter(r => r.exact5m).length, exactBilledSplit: rs.filter(r => r.exactBilledSplit).length,
      medianRatio5mOverReported: round(median(rs.map(r => r.ratio5mOverReported)), 3), medianRatio1hOverReported: round(median(rs.map(r => r.ratio1hOverReported)), 3),
    }])),
  };
}

/** The committed file's document for transcripts under `root` modified at or after the flag. `now` is the measurement time (injected by tests). */
export function buildLaunchEnv({ root = DEFAULT_ROOT, table = readJson(STAGES_FILE).priceTable, after = CACHE_FLAG.at, now = new Date().toISOString(), read } = {}) {
  const entries = listTranscripts(root).filter(e => Date.parse(e.mtime) >= Date.parse(after));
  const records = measureTranscripts(entries, table, { root, ...(read ? { read } : {}) });
  return {
    schema: LAUNCH_ENV_SCHEMA, grade: 'LEGACY/dev', measuredAt: now, root, after, priceTable: table.id, rule: { exact: EXACT, transcriptName: TRANSCRIPT_NAME, selection: 'transcripts modified at or after `after`, by file modification time' },
    summary: summariseLaunchEnv(records), transcripts: records,
  };
}

/** The committed launch-environment measurement, or null (run.mjs treats an absent file as "not measured"). */
export function readLaunchEnv(file = LAUNCH_ENV_FILE) {
  if (!existsSync(file)) return null;
  const doc = readJson(file);
  return doc.schema === LAUNCH_ENV_SCHEMA ? doc : null;
}

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const doc = buildLaunchEnv({ root: path.resolve(arg('--root', DEFAULT_ROOT)) });
  console.log(JSON.stringify({ summary: doc.summary }, null, 1));
  if (process.argv.includes('--write')) { mkdirSync(path.dirname(LAUNCH_ENV_FILE), { recursive: true }); writeFileSync(LAUNCH_ENV_FILE, JSON.stringify(doc, null, 1) + '\n'); console.log(`wrote ${rel(LAUNCH_ENV_FILE)}`); }
}
