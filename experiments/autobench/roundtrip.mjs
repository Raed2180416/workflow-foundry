#!/usr/bin/env node
// ROUND-TRIP READER probe (research/architecture-20261015/FABLE-WHAT-WE-MISS.md I-3), version rt-v1: an offline,
// development-only measurement on AutomationBench runs that already finished. No world is touched.
//
// Per finished rollout (dev tasks only):
//   1. DIFF     code: the masked world diff of the rollout (bridge.py vote over the official initial world and the final
//               world, generator outputs such as fresh ids and clock reads masked as <gen>), rendered as text with the
//               value before each change.
//   2. READ     one clean-context model call sees ONLY that diff text and writes the request that would produce exactly
//               these changes. It never sees the real request, the task name, the transcript, a grade or an assertion.
//   3. SCORE    code compares the reconstruction with the real request (official user message): literal recall (the
//               request's addresses, ids, amounts, dates, names, quoted strings found in the reconstruction) and content
//               recall (the request's content words found in it). Primary score rt = their mean (content recall alone
//               when the request has no literal). This is the deployable done-signal: it needs no grader.
//   4. ANALYZE  host-side only: AUROC of rt against the rollout's strict pass (task_completed_correctly, read from the
//               run's results.jsonl; grade.json is never opened), with a task-clustered bootstrap CI, beside a $0 code
//               baseline B0 (the same score computed on the diff text itself, no model) and trivial baselines (diff size).
//               Grades are used for this offline AUROC only and never reach a prompt.
//
// Decision rule (FABLE I-3(c), fixed before any paid call): usable as a stop criterion if AUROC(rt) >= 0.75 and the paired
// CI of AUROC(rt) - AUROC(B0) lies above 0 (the model call must beat code alone); dead if AUROC(rt) <= 0.60; otherwise
// inconclusive. Reported on all rollouts (primary) and on rollouts with a non-empty diff (doing nothing is trivially
// detectable). Note: partial credit is not a usable reference AUROC here: strict pass is partial credit == 1, so its AUROC
// is 1 by construction; its rank correlation with rt among failures is reported instead.
//
//   node experiments/autobench/roundtrip.mjs --runs a0-dev60,a1-dev60,raw-haiku-60 --dry-run    ($0: diffs, B0, cost estimate)
//   node experiments/autobench/roundtrip.mjs --runs ... --scripted --id rt-scripted               ($0: code stand-in reader; plumbing only)
//   node experiments/autobench/roundtrip.mjs --runs ... --model claude-haiku-5-5 --cap 1.5 --id rt-v1-dev   (paid: one call per rollout)
//   node experiments/autobench/roundtrip.mjs --runs ... --model claude-haiku-5-5 --replay --id rt-v1-dev   ($0: re-analysis from the journal)
// Options: --live-root DIR (default /var/tmp/foundry-work/autobench) --out DIR (default research/automationbench-20261014/runs/
//   roundtrip-<id>) --concurrency 4 --reasoning none|low|medium|high --diff-chars 30000 --limit N (first N rollouts) --no-copy
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { REPO, bridgeJson, readJson, sha256, writeJson } from './lib.mjs';
import { assertDevOnly, loadSplit } from './split.mjs';
import { entityTerms } from './harness/inventory.mjs';

export const RT_VERSION = 'rt-v1';
export const LIVE_ROOT = '/var/tmp/foundry-work/autobench';
export const DEFAULTS = Object.freeze({ diffChars: 30_000, recordChars: 2_500, concurrency: 4, reasoning: 'none', perCallBoundUsd: 0.05, bootstrap: 2000, seed: 'rt-v1' });
export const THRESHOLDS = Object.freeze({ usable: 0.75, dead: 0.6 });

// ---------------------------------------------------------------------------------------------------------------
// 1. The diff, rendered (code)

const DROP = new Set(['body_html', 'attachment_ids', 'attachments', 'reactions', 'size_estimate', 'etag', 'iconLink', 'thumbnailLink', 'attributes', 'bot_icon']);
/** Drop empty and noisy fields; cap the text. */
export function compact(o, maxChars = DEFAULTS.recordChars) {
  const clean = v => {
    if (Array.isArray(v)) { const a = v.map(clean).filter(x => x !== undefined); return a.length ? a : undefined; }
    if (v && typeof v === 'object') { const out = {}; for (const [k, x] of Object.entries(v)) { if (DROP.has(k)) continue; const c = clean(x); if (c !== undefined) out[k] = c; } return Object.keys(out).length ? out : undefined; }
    if (v === null || v === '' || v === false) return undefined;
    return v;
  };
  let s = JSON.stringify(clean(o) ?? {});
  if (s.length > maxChars) s = `${s.slice(0, maxChars)}…`;
  return s;
}
/** Parse a vote path ("$.salesforce.contacts[id=003A].phone") into segments: [{key}|{match: [k, v]}]. */
export function parsePath(p) {
  const segs = [];
  const re = /\.([^.[\]]+)|\[([^=\]]+)=([^\]]*)\]/g;
  let m;
  for (const s = String(p).replace(/^\$/, ''); (m = re.exec(s));) segs.push(m[1] !== undefined ? { key: m[1] } : { match: [m[2], m[3]] });
  return segs;
}
/** The value at a vote path in a world (undefined when absent). */
export function resolvePath(world, p) {
  let v = world;
  for (const s of parsePath(p)) {
    if (v === null || v === undefined) return undefined;
    if (s.key !== undefined) v = v[s.key];
    else v = Array.isArray(v) ? v.find(x => x && String(x[s.match[0]]) === s.match[1]) : undefined;
  }
  return v;
}
const show = (v, n) => { const s = typeof v === 'string' ? JSON.stringify(v) : compact(v, n); return s.length > n ? `${s.slice(0, n)}…` : s; };
const pretty = p => String(p).replace(/^\$\./, '');

/**
 * renderDiff(diff, world0) -> { text, entries, records, empty, metaDropped }. `diff` is bridge.py vote's winner_diff
 * (["add-records", path, [canonical json]], ["del-record", path, key], ["set", path, value], ["add", path, value],
 * ["del", path]); `world0` the initial world, used only for the value before each change. Paths under $.meta are dropped.
 */
export function renderDiff(diff, world0, { maxChars = DEFAULTS.diffChars, recordChars = DEFAULTS.recordChars } = {}) {
  const lines = [];
  let records = 0, metaDropped = 0;
  for (const e of diff ?? []) {
    const [op, p] = e;
    if (/^\$\.meta(\.|\[|$)/.test(p)) { metaDropped += 1; continue; }
    if (op === 'add-records') for (const r of e[2]) { records += 1; let o; try { o = JSON.parse(r); } catch { o = r; } lines.push(`+ new record in ${pretty(p)}: ${compact(o, recordChars)}`); }
    else if (op === 'del-record') { const key = e[2]; const was = Array.isArray(resolvePath(world0, p)) ? resolvePath(world0, p).find(x => x && Object.values(x).some(v => String(v) === String(key))) : undefined; lines.push(`- record ${key} removed from ${pretty(p)}${was ? ` (was ${compact(was, 400)})` : ''}`); }
    else if (op === 'set') { const before = resolvePath(world0, p); lines.push(`~ ${pretty(p)}: ${before === undefined ? '(unset)' : show(before, 300)} -> ${show(e[2], 600)}`); }
    else if (op === 'add') lines.push(`+ ${pretty(p)} = ${show(e[2], recordChars)}`);
    else if (op === 'del') { const before = resolvePath(world0, p); lines.push(`- ${pretty(p)} removed${before === undefined ? '' : ` (was ${show(before, 300)})`}`); }
  }
  let text = lines.join('\n');
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…(more changes cut for size)`;
  return { text, entries: lines.length, records, empty: lines.length === 0, metaDropped };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. The reader (clean context): sees the diff only

export const RT_SYSTEM = `You see the changes an automation made to a company's software systems, and you infer the request it was given. You cannot call tools. Reply with one JSON object only.`;
export function rtPrompt(diffText) {
  return `An automation agent received one request from a user at a company and carried it out on the company's systems (email, chat, CRM, spreadsheets and others). Below is every change it made: new records, changed values (shown as before -> after) and removed records. Values shown as <gen> were generated by the systems (ids, timestamps).

<changes>
${diffText || '(no change at all)'}
</changes>

Write the request the user most likely gave, as the user would have written it, so that carrying it out produces exactly these changes: no more and no less. Name every recipient, channel, record, value and wording the changes show. Do not invent work that the changes do not show. Then list the effects one per change.

Reply with JSON only: {"request": "<the request>", "effects": [{"system": "<app>", "action": "<what was done>", "target": "<recipient, channel or record>", "details": "<values and wording>"}]}`;
}
export const RT_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false, required: ['request', 'effects'], properties: {
  request: { type: 'string' },
  effects: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['system', 'action', 'target', 'details'],
    properties: { system: { type: 'string' }, action: { type: 'string' }, target: { type: 'string' }, details: { type: 'string' } } } } } });
/** The reconstruction as one text (request + effects), what the similarity is computed on. */
export const reconstructionText = v => (v && typeof v === 'object' ? [String(v.request ?? ''), ...(Array.isArray(v.effects) ? v.effects.map(e => [e?.system, e?.action, e?.target, e?.details].filter(Boolean).join(' ')) : [])].join('\n') : '');

// ---------------------------------------------------------------------------------------------------------------
// 3. Similarity (code)

const STOP = new Set('a an the and or but if then else for to of in on at by with from as is are was were be been being this that these those it its we our you your i me my us they them their he she his her please also all any each every some no not do does did done can could should would will shall may might must have has had into onto out up down over under about after before than so such only just via per new same other both either neither own more most less least very there here when where which who whom whose what why how while until within without also make made send sent post posted use used get got set need needs needed let lets ensure sure'.split(' '));
const stem = w => (w.length > 5 && w.endsWith('ing') ? w.slice(0, -3) : w.length > 4 && w.endsWith('ed') ? w.slice(0, -2) : w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
/** Content words of a text: lower case, alphanumeric runs, no stop words or single characters, light stemming. */
export function contentWords(text) {
  return new Set(String(text ?? '').toLowerCase().replace(/[‘’]/g, "'").split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w) && !/^\d{1,2}$/.test(w)).map(stem));
}
const normLit = s => String(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const digits = s => String(s).replace(/[^0-9.]/g, '').replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
/** The request's literals: entity terms (addresses, ids, quoted strings, dates, names) plus amounts and numbers. */
export function literals(text) {
  const out = new Map();
  for (const t of entityTerms(text, 40)) out.set(normLit(t), { kind: 'term', value: t });
  for (const m of String(text ?? '').matchAll(/[$€£]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*\.\d+\b|\b\d{3,}(?:,\d{3})*\b|\b\d+(?:\.\d+)?\s?%/g)) {
    const v = m[0];
    if (/^\d{4}$/.test(v) && Number(v) > 1900 && Number(v) < 2100) continue; // a year is a date fragment, not an amount
    out.set(`#${digits(v)}`, { kind: 'number', value: v });
  }
  return [...out.values()];
}
const hasLiteral = (hay, lit) => (lit.kind === 'number' ? new Set((hay.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(digits)).has(digits(lit.value)) : normLit(hay).includes(normLit(lit.value)));
/** Similarity of a candidate text to the real request: { literalRecall|null, contentRecall, literals, score }. */
export function similarity(candidate, request) {
  const lits = literals(request);
  const hay = String(candidate ?? '');
  const literalRecall = lits.length ? lits.filter(l => hasLiteral(hay, l)).length / lits.length : null;
  const req = contentWords(request), cand = contentWords(hay);
  const contentRecall = req.size ? [...req].filter(w => cand.has(w)).length / req.size : 0;
  return { literalRecall, contentRecall, literals: lits.length, score: literalRecall === null ? contentRecall : (literalRecall + contentRecall) / 2 };
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Analysis (host-side): AUROC with a task-clustered bootstrap

/** AUROC of score against binary labels (Mann-Whitney U with average ranks for ties); null without both classes. */
export function auroc(scores, labels) {
  const xs = scores.map((s, i) => ({ s, y: labels[i] })).filter(x => Number.isFinite(x.s));
  const pos = xs.filter(x => x.y === 1).length, neg = xs.filter(x => x.y === 0).length;
  if (!pos || !neg) return null;
  xs.sort((a, b) => a.s - b.s);
  let rankSumPos = 0;
  for (let i = 0; i < xs.length;) {
    let j = i;
    while (j + 1 < xs.length && xs[j + 1].s === xs[i].s) j += 1;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (xs[k].y === 1) rankSumPos += r;
    i = j + 1;
  }
  return (rankSumPos - pos * (pos + 1) / 2) / (pos * neg);
}
function rng(seedStr) {
  let a = parseInt(sha256(String(seedStr)).slice(0, 8), 16) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
/** Point AUROC per score key and its task-clustered bootstrap 95% CI; plus paired differences against `vs`. */
export function bootstrapAuroc(rows, keys, { B = DEFAULTS.bootstrap, seed = DEFAULTS.seed, vs = null } = {}) {
  const labels = rows.map(r => r.pass);
  const point = Object.fromEntries(keys.map(k => [k, auroc(rows.map(r => r[k]), labels)]));
  const tasks = [...new Set(rows.map(r => r.task))];
  const byTask = new Map(tasks.map(t => [t, rows.filter(r => r.task === t)]));
  const r = rng(seed), samples = Object.fromEntries(keys.map(k => [k, []])), diffs = Object.fromEntries(keys.filter(k => vs && k !== vs).map(k => [k, []]));
  for (let b = 0; b < B; b++) {
    const s = [];
    for (let i = 0; i < tasks.length; i++) s.push(...byTask.get(tasks[Math.floor(r() * tasks.length)]));
    const ls = s.map(x => x.pass);
    const a = Object.fromEntries(keys.map(k => [k, auroc(s.map(x => x[k]), ls)]));
    for (const k of keys) if (a[k] !== null) samples[k].push(a[k]);
    if (vs && a[vs] !== null) for (const k of Object.keys(diffs)) if (a[k] !== null) diffs[k].push(a[k] - a[vs]);
  }
  const ci = xs => (xs.length ? [quantile(xs, 0.025), quantile(xs, 0.975)] : null);
  return { n: rows.length, positives: labels.filter(y => y === 1).length, tasks: tasks.length,
    auroc: Object.fromEntries(keys.map(k => [k, { point: point[k], ci95: ci(samples[k]) }])),
    ...(vs ? { minus: Object.fromEntries(Object.entries(diffs).map(([k, xs]) => [`${k}-${vs}`, { point: point[k] !== null && point[vs] !== null ? point[k] - point[vs] : null, ci95: ci(xs) }])) } : {}) };
}
/** Spearman rank correlation (average ranks). */
export function spearman(x, y) {
  const rank = v => { const idx = v.map((s, i) => [s, i]).sort((a, b) => a[0] - b[0]); const r = new Array(v.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
  if (x.length < 3) return null;
  const rx = rank(x), ry = rank(y), mx = rx.reduce((a, b) => a + b, 0) / rx.length, my = ry.reduce((a, b) => a + b, 0) / ry.length;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rx.length; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}
/** The predeclared verdict from the AUROC block (all rollouts, or the non-empty subset). */
export function verdict(block, { usable = THRESHOLDS.usable, dead = THRESHOLDS.dead } = {}) {
  const a = block?.auroc?.rt?.point, d = block?.minus?.['rt-b0']?.ci95;
  if (a === null || a === undefined) return 'undetermined (one class only)';
  if (a <= dead) return 'dead (AUROC <= 0.60)';
  if (a >= usable && d && d[0] > 0) return 'usable as a stop criterion (AUROC >= 0.75 and beats the code baseline B0)';
  if (a >= usable) return 'not shown to beat the code baseline B0 (AUROC >= 0.75 but the paired CI includes 0)';
  return 'inconclusive (0.60 < AUROC < 0.75)';
}
export function analyze(rows, opts = {}) {
  const keys = ['rt', 'rtLiteral', 'rtContent', 'b0', 'nChanges'];
  const prep = rs => rs.map(r => ({ ...r, rtLiteral: r.rtLiteral ?? r.rtContent }));
  const all = prep(rows.filter(r => Number.isFinite(r.rt)));
  const nonEmpty = all.filter(r => !r.emptyDiff);
  const fails = all.filter(r => r.pass === 0);
  const youden = rs => { // threshold maximizing TPR(pass flagged done) - FPR (fail flagged done) on rt
    let best = null;
    for (const t of [...new Set(rs.map(r => r.rt))].sort((a, b) => a - b)) {
      const tp = rs.filter(r => r.pass === 1 && r.rt >= t).length / Math.max(1, rs.filter(r => r.pass === 1).length);
      const fp = rs.filter(r => r.pass === 0 && r.rt >= t).length / Math.max(1, rs.filter(r => r.pass === 0).length);
      if (!best || tp - fp > best.j) best = { threshold: t, j: tp - fp, tprPass: tp, fprFail: fp };
    }
    return best;
  };
  const block = rs => ({ ...bootstrapAuroc(rs, keys, { ...opts, vs: 'b0' }), youdenRt: youden(rs) });
  const out = { all: block(all), nonEmptyDiff: block(nonEmpty), emptyDiffShare: all.length ? (all.length - nonEmpty.length) / all.length : null,
    byRun: Object.fromEntries([...new Set(all.map(r => r.run))].map(run => { const rs = all.filter(r => r.run === run); return [run, { n: rs.length, positives: rs.filter(r => r.pass === 1).length, rt: auroc(rs.map(r => r.rt), rs.map(r => r.pass)), b0: auroc(rs.map(r => r.b0), rs.map(r => r.pass)) }]; })),
    spearmanRtPartialCreditAmongFails: spearman(fails.map(r => r.rt), fails.map(r => r.partialCredit ?? 0)), failed: rows.filter(r => !Number.isFinite(r.rt)).length };
  out.verdict = { all: verdict(out.all), nonEmptyDiff: verdict(out.nonEmptyDiff) };
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Rollouts: finished dev runs on disk

/** Every finished single-rollout record of the given runs: dev tasks only (a test task refuses the whole call before any of
 * its files is opened); devCheck tasks are skipped (sealed). Labels come from results.jsonl (strict pass, partial credit). */
export function selectRollouts(runs, { liveRoot = LIVE_ROOT, split = loadSplit() } = {}) {
  const rows = [], skipped = [];
  for (const run of runs) {
    const dir = path.join(liveRoot, run);
    if (existsSync(path.join(dir, 'results.sealed.jsonl')) && !existsSync(path.join(dir, 'results.jsonl'))) throw new Error(`${run} is a sealed run: refused`);
    const file = path.join(dir, 'results.jsonl');
    if (!existsSync(file)) throw new Error(`${run}: no results.jsonl in ${dir}`);
    const recs = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    assertDevOnly(recs.map(r => r.task)); // throws on any test-split task, before anything of it is opened
    for (const r of recs) {
      if (split.devCheck.includes(r.task)) { skipped.push({ run, task: r.task, why: 'devCheck (sealed)' }); continue; }
      if (r.k !== 1) { skipped.push({ run, task: r.task, why: `k=${r.k}` }); continue; }
      const g = r.liveFinal ?? r.final;
      const hostDir = path.join(dir, 'host', r.task, 'fork-0');
      if (!g) { skipped.push({ run, task: r.task, why: 'no grade' }); continue; }
      if (!existsSync(path.join(hostDir, 'final-world.json'))) { skipped.push({ run, task: r.task, why: 'no final world' }); continue; }
      rows.push({ run, task: r.task, domain: r.domain, hostDir, prepDir: path.join(dir, 'prep', r.task), pass: g.task_completed_correctly === 1 ? 1 : 0, partialCredit: g.partial_credit ?? null,
        writes: r.forks?.[0]?.usage?.writes ?? null, steps: r.forks?.[0]?.steps ?? null });
    }
  }
  return { rows, skipped };
}

// ---------------------------------------------------------------------------------------------------------------
// The run

const est = s => Math.ceil(String(s).length / 3.6);
/** A list price estimate for one reader call (tokens from characters; the CLI's own overhead per call added). */
export function estimateUsd(prompt, { inPerM = 0.1, outPerM = 0.5, overheadTokens = 4000, outTokens = 700 } = {}) {
  return ((est(RT_SYSTEM) + est(prompt) + overheadTokens) * inPerM + outTokens * outPerM) / 1e6 * 1.25; // 1.25: cache-write premium
}

/** A $0 code stand-in for the reader: the reconstruction is the diff's own string values (pipeline check, not evidence). */
export const scriptedPort = () => ({ call: async req => { const changes = req.prompt.split('<changes>')[1]?.split('</changes>')[0] ?? ''; const vals = [...changes.matchAll(/"([^"]{3,200})"/g)].map(m => m[1]).filter(v => v !== '<gen>'); return { ok: true, value: { request: vals.join('; ').slice(0, 4000), effects: [] }, costUsd: 0 }; } });

async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

/**
 * runRoundTrip(o) -> { summary, rows }. o: { runs, id, liveRoot, outDir|null, port (a ModelPort or a stand-in), model, cap,
 * reasoning, concurrency, diffChars, limit, dryRun, log }.
 */
export async function runRoundTrip(o) {
  const opt = { ...DEFAULTS, ...o };
  const log = opt.log ?? (m => process.stderr.write(m + '\n'));
  const id = opt.id ?? `rt-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
  const live = path.join(opt.liveRoot ?? LIVE_ROOT, 'roundtrip', id);
  mkdirSync(path.join(live, 'diffs'), { recursive: true });
  const { rows: sel, skipped } = selectRollouts(opt.runs, { liveRoot: opt.liveRoot ?? LIVE_ROOT });
  const rollouts = opt.limit ? sel.slice(0, opt.limit) : sel;
  log(`[roundtrip] ${id}: ${rollouts.length} rollouts from ${opt.runs.join(', ')} (${skipped.length} skipped)`);
  // 1. diffs (code; bridge.py vote, $0)
  for (const r of rollouts) {
    const out = path.join(live, 'diffs', r.run, `${r.task}.json`);
    if (!existsSync(out)) await bridgeJson(['vote', '--base', path.join(r.prepDir, 'world0.json'), '--forks', r.hostDir, '--out', out], { liveDir: live });
    const v = readJson(out);
    const world0 = readJson(path.join(r.prepDir, 'world0.json')).world;
    const d = renderDiff(v.winner_diff ?? [], world0, { maxChars: opt.diffChars });
    const request = readJson(path.join(r.prepDir, 'prompt.json')).user; // the real request: code compares with it, no model sees it
    Object.assign(r, { diffText: d.text, nChanges: d.entries, newRecords: d.records, emptyDiff: d.empty, metaDropped: d.metaDropped, request, prompt: rtPrompt(d.text) });
    const b0 = similarity(d.text, request);
    Object.assign(r, { b0: b0.score, b0Literal: b0.literalRecall, b0Content: b0.contentRecall, literals: b0.literals });
  }
  const estimate = { calls: rollouts.length, usd: rollouts.reduce((s, r) => s + estimateUsd(r.prompt), 0), promptChars: { mean: rollouts.reduce((s, r) => s + r.prompt.length, 0) / Math.max(1, rollouts.length), max: Math.max(0, ...rollouts.map(r => r.prompt.length)) } };
  if (opt.dryRun) {
    const rows = rollouts.map(({ diffText, request, prompt, ...r }) => r);
    const summary = { id, version: RT_VERSION, dryRun: true, runs: opt.runs, n: rows.length, skipped, estimate, b0Auroc: auroc(rows.map(r => r.b0), rows.map(r => r.pass)), nChangesAuroc: auroc(rows.map(r => r.nChanges), rows.map(r => r.pass)), emptyDiffShare: rows.filter(r => r.emptyDiff).length / Math.max(1, rows.length) };
    writeJson(path.join(live, 'dry-run.json'), { summary, rows });
    return { summary, rows };
  }
  // 2-3. reader calls and scores
  let spent = 0;
  const rowsFile = path.join(live, 'rows.jsonl');
  const done = new Map(existsSync(rowsFile) ? readFileSync(rowsFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(x => x.ok).map(x => [`${x.run}/${x.task}`, x]) : []);
  for (const x of done.values()) spent += x.costUsd ?? 0;
  let stopped = null;
  await pool(rollouts, opt.concurrency, async r => {
    const key = `${r.run}/${r.task}`;
    if (done.has(key)) { Object.assign(r, done.get(key)); return; }
    if (stopped) return;
    if (opt.cap !== undefined && spent + opt.perCallBoundUsd > opt.cap) { stopped ??= `cap $${opt.cap}`; return; }
    spent += opt.perCallBoundUsd; // reserved, settled below
    let res, err = null;
    try { res = await opt.port.call({ runId: `${id}:${key}`, nodeKey: 'roundtrip', modelId: opt.model ?? 'scripted', system: RT_SYSTEM, prompt: r.prompt, schema: RT_SCHEMA, decoding: { reasoning: opt.reasoning } }); }
    catch (e) { err = { code: e?.code ?? 'THROWN', message: String(e?.message ?? e).slice(0, 300) }; }
    const cost = Number.isFinite(res?.costUsd) ? res.costUsd : Number.isFinite(err?.costUsd) ? err.costUsd : opt.perCallBoundUsd;
    spent += cost - opt.perCallBoundUsd;
    // An environment fault (rate or usage limit, auth, model unavailable) stops new calls; the row is kept as not ok and is
    // retried by the same command later (only ok rows count as done).
    const code = String(err?.code ?? res?.error?.code ?? '');
    if (/RATE|LIMIT|AUTH|UNAVAILABLE|QUOTA/i.test(code)) stopped ??= `${code} at ${key}`;
    const ok = Boolean(res?.ok);
    const text = ok ? reconstructionText(res.value) : '';
    const s = similarity(text, r.request);
    const row = { run: r.run, task: r.task, ok, error: err ?? (ok ? null : res?.error ?? null), costUsd: cost, rt: ok ? s.score : null, rtLiteral: ok ? s.literalRecall : null, rtContent: ok ? s.contentRecall : null, reconstruction: ok ? res.value : null };
    Object.assign(r, row);
    appendFileSync(rowsFile, JSON.stringify(row) + '\n');
  });
  // 4. analysis (host-side; labels joined here only)
  const rows = rollouts.map(({ diffText, request, prompt, hostDir, prepDir, reconstruction, ...r }) => r);
  const analysis = analyze(rows, { B: opt.bootstrap, seed: opt.seed });
  const summary = { id, version: RT_VERSION, evidence: 'development/diagnostic (exposed dev tasks; offline; not held-out)', model: opt.model ?? null, scripted: Boolean(opt.scripted), reasoning: opt.reasoning, runs: opt.runs,
    n: rows.length, scored: rows.filter(r => Number.isFinite(r.rt)).length, skipped, stopped, spentUsd: spent, estimate, thresholds: THRESHOLDS, analysis,
    provenance: { script: sha256(readFileSync(new URL(import.meta.url))), diffChars: opt.diffChars, finishedAt: new Date().toISOString() } };
  writeJson(path.join(live, 'summary.json'), summary);
  const out = opt.outDir === null ? null : (opt.outDir ?? path.join(REPO, 'research/automationbench-20261014/runs', `roundtrip-${id}`));
  if (out) {
    mkdirSync(out, { recursive: true });
    writeJson(path.join(out, 'summary.json'), summary);
    // Per-rollout scores and labels only (dev tasks; the reconstructions and diffs stay in the live directory).
    writeFileSync(path.join(out, 'rows.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    summary.copiedTo = out;
  }
  return { summary, rows };
}

function parseArgs(argv) {
  const a = {}, flags = new Set(['dry-run', 'scripted', 'replay', 'no-copy']);
  for (let i = 0; i < argv.length; i++) { const k = argv[i]; if (!k.startsWith('--')) throw new Error(`unexpected argument ${k}`); const n = k.slice(2); if (flags.has(n)) a[n] = true; else a[n] = argv[++i]; }
  return a;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.runs) throw new Error('--runs run1,run2,... is required');
  const runs = a.runs.split(',').filter(Boolean);
  let port = null, model = a.model ?? null;
  if (a.scripted) port = scriptedPort();
  else if (!a['dry-run']) {
    if (!model) throw new Error('--model is required for a model run (or --scripted / --dry-run)');
    if (!a.replay && !(Number(a.cap) > 0)) throw new Error('--cap (hard USD cap) is required for a paid run');
    const { createModelPort } = await import('../lib/models.mjs');
    const id = a.id ?? 'rt';
    ({ port } = createModelPort({ journalFile: path.join(a['live-root'] ?? LIVE_ROOT, 'roundtrip', id, 'journal.sqlite'), mode: a.replay ? 'replay' : 'live', allowedModels: [model], maxBudgetUsdPerCall: DEFAULTS.perCallBoundUsd, concurrency: { [model]: Number(a.concurrency ?? DEFAULTS.concurrency) } }));
  }
  const { summary } = await runRoundTrip({ runs, id: a.id, liveRoot: a['live-root'], outDir: a['no-copy'] ? null : a.out, port, model, scripted: Boolean(a.scripted), cap: a.cap === undefined ? undefined : Number(a.cap),
    reasoning: a.reasoning ?? DEFAULTS.reasoning, concurrency: Number(a.concurrency ?? DEFAULTS.concurrency), diffChars: Number(a['diff-chars'] ?? DEFAULTS.diffChars), limit: a.limit ? Number(a.limit) : undefined, dryRun: Boolean(a['dry-run']) });
  process.stdout.write(JSON.stringify(summary, null, 1) + '\n');
}
