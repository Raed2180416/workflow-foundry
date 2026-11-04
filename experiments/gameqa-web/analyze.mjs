#!/usr/bin/env node
// GQA-1 analysis (frozen with the arms before any paid call): per-arm summaries, per-bug detection, cost, and the
// preregistered comparisons (exact permutation Mann-Whitney on per-run foundMin, research/gameqa-20261021/PREREG-GQA-1.md §5).
//   node experiments/gameqa-web/analyze.mjs [RUNS_DIR] [--json]
// Only runs whose meta matches the frozen bed (FREEZE.json), that are not --dev, and that show no harness fault enter the
// comparison; the preregistered analysis uses complete rep indices only. Harness fault (PREREG §6): the runner raised an
// exception, or (amendment A1) at least 50% of the run's model calls failed for a non-model reason (rate limit, CLI
// unavailable or crashed, timeout, the per-call cap): the frozen script checked only the first, so three rate-limited
// workflow runs with no model output would have entered as foundMin 0.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = f => JSON.parse(readFileSync(f, 'utf8'));

/** Exact permutation test of the Mann-Whitney U statistic (ties counted 1/2). alt: 'greater' (a > b), 'less', 'two-sided'. */
export function mannWhitney(a, b, alt = 'greater') {
  const u = (x, y) => { let s = 0; for (const p of x) for (const q of y) s += p > q ? 1 : p === q ? 0.5 : 0; return s; };
  const obs = u(a, b), pool = [...a, ...b], n = a.length, N = pool.length, center = (a.length * b.length) / 2;
  let total = 0, extreme = 0;
  const pick = (start, chosen) => {
    if (chosen.length === n) {
      const set = new Set(chosen), x = chosen.map(i => pool[i]), y = pool.filter((_, i) => !set.has(i));
      const v = u(x, y); total++;
      if (alt === 'greater' ? v >= obs - 1e-9 : alt === 'less' ? v <= obs + 1e-9 : Math.abs(v - center) >= Math.abs(obs - center) - 1e-9) extreme++;
      return;
    }
    for (let i = start; i <= N - (n - chosen.length); i++) pick(i + 1, [...chosen, i]);
  };
  if (!n || !b.length) return { U: obs, p: null, permutations: 0 };
  pick(0, []);
  return { U: obs, p: extreme / total, permutations: total };
}
const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const sd = xs => { if (xs.length < 2) return null; const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); };
const r3 = x => (x === null || x === undefined ? null : Math.round(x * 1000) / 1000);

// Failure codes that are not the model's doing (src/models/providers/claude-cli.mjs, experiments/gameqa-web/arms.mjs makeCaller).
export const NON_MODEL_FAILURES = Object.freeze(['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_PROTOCOL', 'MODEL_TIMEOUT', 'MODEL_BUDGET', 'ERROR']);
export function transportFailures(dir) {
  const f = path.join(dir, 'calls.jsonl');
  if (!existsSync(f)) return { calls: 0, nonModel: 0 };
  const rows = readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => typeof r.ok === 'boolean');
  return { calls: rows.length, nonModel: rows.filter(r => !r.ok && NON_MODEL_FAILURES.includes(r.error)).length };
}

export function loadRuns(dir) {
  if (!existsSync(dir)) return [];
  const freeze = existsSync(path.join(ROOT, 'research/gameqa-20261021/FREEZE.json')) ? read(path.join(ROOT, 'research/gameqa-20261021/FREEZE.json')) : null;
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const d = path.join(dir, name);
    if (!existsSync(path.join(d, 'meta.json')) || !existsSync(path.join(d, 'score.json'))) continue;
    const meta = read(path.join(d, 'meta.json')), score = read(path.join(d, 'score.json'));
    const tf = transportFailures(d);
    const excluded = meta.dev ? 'dev run' : meta.error ? 'harness fault (runner exception)'
      : tf.calls && tf.nonModel / tf.calls >= 0.5 ? `harness fault (${tf.nonModel} of ${tf.calls} model calls failed for a non-model reason)`
        : freeze && meta.bed !== freeze.bed?.sha256 ? 'bed hash differs from the freeze' : null;
    out.push({ dir: d, name, meta, score, tag: name.slice(0, name.indexOf(`-${meta.arm}-r`)), excluded });
  }
  return out;
}

export function summarize(runs) {
  const groups = new Map();
  for (const r of runs.filter(x => !x.excluded)) {
    const k = `${r.tag}/${r.meta.arm}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const arms = {};
  for (const [k, rs] of groups) {
    rs.sort((x, y) => x.meta.rep - y.meta.rep);
    const v = f => rs.map(f);
    const foundMin = v(r => r.score.summary.foundMin), usd = v(r => r.meta.cost?.spent ?? 0);
    const perBug = {};
    for (const r of rs) for (const [id, b] of Object.entries(r.score.perBug)) {
      perBug[id] ??= { foundMin: 0, foundAny: 0, foundMinClass: 0 };
      perBug[id].foundMin += b.foundMin ? 1 : 0; perBug[id].foundAny += b.foundAny ? 1 : 0; perBug[id].foundMinClass += b.foundMinClass ? 1 : 0;
    }
    arms[k] = {
      tag: rs[0].tag, arm: rs[0].meta.arm, model: rs[0].meta.model, reps: v(r => r.meta.rep), n: rs.length,
      foundMin, foundMinMean: r3(mean(foundMin)), foundMinSd: r3(sd(foundMin)), foundMinRange: [Math.min(...foundMin), Math.max(...foundMin)],
      foundMinClass: v(r => r.score.summary.foundMinClass), foundAny: v(r => r.score.summary.foundAny),
      falseReports: v(r => r.score.summary.falseReports), falseReportsMean: r3(mean(v(r => r.score.summary.falseReports))),
      reports: v(r => r.score.summary.reports), duplicates: v(r => r.score.summary.duplicates), precision: v(r => r3(r.score.summary.precision)),
      usd: usd.map(r3), usdTotal: r3(usd.reduce((s, x) => s + x, 0)), usdPerFoundMin: foundMin.reduce((s, x) => s + x, 0) ? r3(usd.reduce((s, x) => s + x, 0) / foundMin.reduce((s, x) => s + x, 0)) : null,
      calls: v(r => r.meta.cost?.calls ?? 0), inputTokens: v(r => r.meta.cost?.inputTokens ?? 0), outputTokens: v(r => r.meta.cost?.outputTokens ?? 0),
      wallS: v(r => Math.round(r.meta.wallMs / 1000)), wallMeanS: Math.round(mean(v(r => r.meta.wallMs / 1000))),
      perBug,
    };
  }
  return arms;
}

// The preregistered comparisons (PREREG-GQA-1 §5): [a, b, alternative, role].
export const COMPARISONS = Object.freeze([
  ['gqa1/workflow', 'gqa1/agent', 'greater', 'H1 primary: the cheap-built workflow finds more bugs (1-minimal repros) than the Haiku agent alone'],
  ['gqa1/workflow', 'gqa1/monkey', 'greater', 'H2: the workflow beats the random monkey baseline'],
  ['gqa1/agent', 'gqa1/monkey', 'greater', 'H3: the Haiku agent alone beats the random monkey baseline'],
  ['gqa1/workflow', 'gqa1/workflow-random', 'two-sided', 'H4 ablation: persona-guided exploration vs random exploration with the same constructed checks'],
  // Amendment A1 (2026-11-04), secondary, decided before the gqa1nb runs: the agent without the CLI's "USD budget" line.
  ['gqa1/workflow', 'gqa1nb/agent', 'greater', 'S1 (A1, secondary): H1 against the agent without the CLI budget line'],
  ['gqa1nb/agent', 'gqa1/agent', 'two-sided', 'S2 (A1, secondary): does removing the CLI budget line change the agent?'],
  ['gqa1/workflow', 'gqa1nb/agent-persist', 'greater', 'S3 (A1, secondary): H1 against the agent with no budget line whose early finish is refused'],
  ['gqa1nb/agent-persist', 'gqa1nb/agent', 'two-sided', 'S4 (A1, secondary): does refusing the early finish change the agent?'],
]);
export function compare(arms, { completeRepsOnly = true } = {}) {
  return COMPARISONS.map(([ka, kb, alt, role]) => {
    const A = arms[ka], B = arms[kb];
    if (!A || !B) return { a: ka, b: kb, role, missing: true };
    // complete rep indices only, for the two paid/paired arms; the $0 monkey keeps all its reps
    // (S1/S2 pair arms of two series: their reps are independent runs, not paired, so all valid reps of both enter)
    const crossSeries = ka.split('/')[0] !== kb.split('/')[0];
    const reps = completeRepsOnly && !kb.endsWith('/monkey') && !crossSeries ? A.reps.filter(r => B.reps.includes(r)) : A.reps;
    const a = A.reps.map((r, i) => [r, A.foundMin[i]]).filter(([r]) => reps.includes(r)).map(([, x]) => x);
    const b = kb.endsWith('/monkey') || crossSeries ? B.foundMin : B.reps.map((r, i) => [r, B.foundMin[i]]).filter(([r]) => reps.includes(r)).map(([, x]) => x);
    const t = mannWhitney(a, b, alt);
    const diff = mean(a) - mean(b);
    const decided = alt === 'two-sided' ? (t.p !== null && t.p <= 0.05 ? (diff > 0 ? 'a > b' : 'a < b') : 'no difference shown')
      : (t.p !== null && t.p <= 0.05 && diff >= 1 ? 'supported (dev evidence)' : 'not supported');
    return { a: ka, b: kb, role, alt, nA: a.length, nB: b.length, meanA: r3(mean(a)), meanB: r3(mean(b)), diff: r3(diff), U: t.U, p: r3(t.p), permutations: t.permutations, decision: decided };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv.slice(2).find(x => !x.startsWith('--')) ?? path.join(ROOT, 'research/gameqa-20261021/runs');
  const runs = loadRuns(dir), arms = summarize(runs), tests = compare(arms);
  const excluded = runs.filter(r => r.excluded).map(r => ({ run: r.name, why: r.excluded }));
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ arms, tests, excluded }, null, 1)); process.exit(0); }
  console.log('| arm | n | foundMin per run | mean (sd) | foundMinClass | foundAny | false reports | USD total | USD per found bug | wall s (mean) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const x of Object.values(arms)) console.log(`| ${x.tag}/${x.arm} | ${x.n} | ${x.foundMin.join(', ')} | ${x.foundMinMean} (${x.foundMinSd ?? '-'}) | ${x.foundMinClass.join(', ')} | ${x.foundAny.join(', ')} | ${x.falseReports.join(', ')} | ${x.usdTotal} | ${x.usdPerFoundMin ?? '-'} | ${x.wallMeanS} |`);
  console.log('\n| comparison | n | means | diff | U | p | decision |\n|---|---|---|---|---|---|---|');
  for (const t of tests) console.log(t.missing ? `| ${t.a} vs ${t.b} | missing | | | | | |` : `| ${t.role} | ${t.nA} vs ${t.nB} | ${t.meanA} vs ${t.meanB} | ${t.diff} | ${t.U} | ${t.p} (${t.alt}) | ${t.decision} |`);
  const ids = [...new Set(Object.values(arms).flatMap(x => Object.keys(x.perBug)))].sort();
  console.log(`\n| bug | ${Object.values(arms).map(x => `${x.tag}/${x.arm}`).join(' | ')} |\n|---|${Object.values(arms).map(() => '---|').join('')}`);
  for (const id of ids) console.log(`| ${id} | ${Object.values(arms).map(x => `${x.perBug[id]?.foundMin ?? 0}/${x.n}`).join(' | ')} |`);
  if (excluded.length) console.log(`\nexcluded: ${JSON.stringify(excluded)}`);
}
