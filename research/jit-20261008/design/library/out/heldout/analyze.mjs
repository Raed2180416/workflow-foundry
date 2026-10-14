// J1 / L1-b analysis (PREREG §1). $0. Reads labels.jsonl (last row per id), features.json, the five MANIFESTs, and, read-only,
// the in-sample comparators (out/L1-reaudit/labels-sonnet-60.jsonl, draw.json, out/pattern-census-items.jsonl).
// Writes summary.json. Usage (repo root):  node research/jit-20261008/design/library/out/heldout/analyze.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
const PLATFORMS = ['windmill', 'kestra', 'power-automate', 'step-functions', 'logic-apps'];
const Z = 1.959964;
const wilson = (x, n) => { const p = x / n, d = 1 + Z * Z / n; const c = (p + Z * Z / (2 * n)) / d, h = (Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n))) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; };
const pct = (x) => +(100 * x).toFixed(1);
const ci = (x, n) => wilson(x, n).map(pct);
const rd = (p) => fs.readFileSync(p, 'utf8');
const jl = (p) => rd(p).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ---- labels (last row per id) and features
const labels = new Map(); for (const r of jl(path.join(HERE, 'labels.jsonl'))) labels.set(r.id, r);
const feats = new Map(JSON.parse(rd(path.join(HERE, 'features.json'))).rows.map((r) => [r.id, r.features]));
const rows = [];
for (const p of PLATFORMS) {
  const m = JSON.parse(rd(path.join(HERE, p, 'MANIFEST.json')));
  for (const wf of m.workflows) {
    const id = `${p}:${wf.id}`; const l = labels.get(id); if (!l) throw new Error('no label for ' + id);
    const f = feats.get(id);
    const size = p === 'windmill' ? f.modules : p === 'kestra' ? Object.values(f.types).reduce((a, b) => a + b, 0) : p === 'step-functions' ? f.states : f.actions;
    rows.push({ ...l, platform: p, size, bytes: wf.bytes });
  }
}
if (rows.length !== labels.size) throw new Error(`label/manifest mismatch ${rows.length} vs ${labels.size}`);

// ---- gap tags: ordered regex rules on fragment + why; every gap must match one (printed otherwise)
const TAGS = [
  ['durable-delay-until', 'wait until an absolute caller-supplied timestamp, any length', /delay_until|Delay_until|until a timestamp|absolute timestamp/i],
  ['clock-or-random', 'wall clock or randomness in a pure step', /wall clock|randomness|rand\(|UUID|Date\.now|utcNow|utcnow|now\(\)|Execution\.StartTime|new Date/i],
  ['heartbeat-lease', 'concurrent heartbeat or lease renewal cancelled through a shared flag', /heartbeat|renew/i],
  ['map-failure-policy', 'per-item failure policy on map (skip_failures, continue past a failed item)', /skip_failures|per-item failure/i],
  ['keyed-cross-run-state', 'cross-run cursor in a keyed state map', /getState|setState/i],
  ['unbounded-cycle', 'loop, poll or pagination with no literal cap (time limit only, or none)', /no count|no counter|no attempt cap|unbounded|time limit|limit \{ timeout|paginat.*(cycle|no page cap)|NextToken|pageToken|retry-until/i],
  ['run-status-end', 'explicit end of the run with a chosen status and message (Terminate, Fail)', /Terminate|runStatus/i],
  ['approval-quorum', 'approval with several approvers and a per-approver response list', /BasicAwaitAll|quorum/i],
  ['approval-no-timeout', 'approval or wait with no timeout in the definition', /no timeout/i],
  ['typed-resume-input', 'a human gate that returns a typed answer on resume (Pause with onResume)', /flow\.Pause|onResume/i],
  ['approval-callback-url', 'approval answered through a callback URL in another system', /getResumeUrls|callback/i],
  ['image-input', 'a model read over image inputs', /Analyze Image|image/i],
  ['external-wait-sync', 'start an external job and wait for completion (.sync, polling plugin)', /\.sync|RunWorkflow|poll/i],
  ['multi-entry', 'several independent triggers into one body', /two independent entry|triggers: every|Webhook, key/i],
  ['shared-workspace-or-accumulator', 'shared mutable workspace or external accumulator between tasks', /WorkingDirectory|accumulator|kv\.Set/i],
  ['effects-in-code', 'effects (network, database) inside a code step', /effects inside a code|cur\.execute|urllib|python Script|script body/i],
  ['stream-consumer-batch', 'bounded batch read of a topic with a broker-held offset', /Consume|maxRecords/i],
  ['code-router-with-none', 'router by kind decided in code with an unsupported branch', /StringMatches|Choices:/i],
  ['validation-in-code', 'validation of an input in code before any effect', /filled_out/i],
  ['batch-positional-judge', 'a batch model read returning free text aligned by position', /Classify the sentiment/i],
  ['parallel-effects-no-compensation', 'parallel effects with no compensation if one fails', /Parallel/i],
  ['injection-defect', 'untrusted input concatenated into SQL or a shell string (a defect the binding removes)', /SELECT user_id|aws deploy|'\$\{email\}'/i],
  ['b2b-artifact-binding', 'integration-account decode, validate or transform bound to artifacts', /FlatFileDecoding|integrationAccount/i],
  ['parameter-binding', 'connector or tool specifics (pagination policy, sessions, retry settings)', /paginationPolicy|minimumItemCount|MaxAttempts|StringMatches|Retry:/i],
];
function tagOf(g) { const s = g.fragment + ' | ' + g.why; for (const [k, , re] of TAGS) if (re.test(s)) return k; return null; }
const gapRows = [];
for (const r of rows) r.gaps.forEach((g, i) => gapRows.push({ id: r.id, platform: r.platform, i, tag: tagOf(g), class: g.class, kind: g.kind, lacks: g.lacks, explained: r.explained, fragment: g.fragment.slice(0, 100) }));
const untagged = gapRows.filter((g) => !g.tag);

// ---- coverage
const cov = (set, f = (r) => r.explained === 'yes') => { const x = set.filter(f).length, n = set.length; return { x, n, p: pct(x / n), wilson: ci(x, n) }; };
const byP = Object.fromEntries(PLATFORMS.map((p) => [p, rows.filter((r) => r.platform === p)]));
const strict = cov(rows), lenient = cov(rows, (r) => r.explained !== 'no');
const perPlatform = Object.fromEntries(PLATFORMS.map((p) => [p, { n: byP[p].length, yes: byP[p].filter((r) => r.explained === 'yes').length, partly: byP[p].filter((r) => r.explained === 'partly').length, no: byP[p].filter((r) => r.explained === 'no').length, strict: cov(byP[p]), lenient: cov(byP[p], (r) => r.explained !== 'no') }]));
const lopo = Object.fromEntries(PLATFORMS.map((p) => [p, cov(rows.filter((r) => r.platform !== p))]));
const NEEDS_CHANGE = (g) => (g.kind === 'construct' || g.kind === 'field' || g.kind === 'binding') && (g.lacks === 'yes' || g.lacks === 'partial');
const s3 = cov(rows, (r) => r.explained === 'yes' && !r.gaps.some(NEEDS_CHANGE));
const s4 = cov(rows, (r) => r.explained === 'yes' && !r.gaps.some((g) => (g.kind === 'construct' || g.kind === 'field') && (g.lacks === 'yes' || g.lacks === 'partial')));
const nontrivial = rows.filter((r) => r.size >= 3);
const covNon = cov(nontrivial);
const trivial = rows.filter((r) => r.size <= 2);
const yesWithGap = cov(rows.filter((r) => r.explained === 'yes'), (r) => r.gaps.length > 0);
const bar = { threshold: 83.6, failBelow: 82.7, passEverywhereFrom: 84.9, comparator: 93.6 };
const decision = strict.p >= bar.passEverywhereFrom ? 'PASS (passes under every comparator)' : strict.p >= bar.threshold ? 'PASS under the 93.6 comparator; comparator-sensitive (82.7-84.9 band)' : strict.p >= bar.failBelow ? 'comparator-sensitive FAIL' : 'FAIL';

// ---- in-sample like-for-like (read-only): sonnet-60 hand labels on the revision-1 strata
const draw = JSON.parse(rd(path.join(OUT, 'L1-reaudit/draw.json')));
const ins = jl(path.join(OUT, 'L1-reaudit/labels-sonnet-60.jsonl'));
function postStrat(subset, reading) {  // reading: 'conservative' (dashboard = not explained) | 'dashboardExplained'
  const cnt = {}, ys = {};
  for (const r of subset) { const k = `${r.cluster}|${r.stratum}`; let e = r.explained; if (r.dashboardCriterion) e = reading === 'conservative' ? 'no' : (r.explainedIfDashboardExplained ?? e); const y = e === 'yes' ? 1 : 0; cnt[k] = (cnt[k] ?? 0) + 1; ys[k] = (ys[k] ?? 0) + y; }
  let w = 0, w2 = 0, num = 0; for (const k of Object.keys(cnt)) { const N = draw.strata[k].popSize, wt = N / cnt[k]; w += N; num += N * (ys[k] / cnt[k]); w2 += cnt[k] * wt * wt; }
  const p = num / w, kish = (w * w) / w2; return { p: pct(p), kishN: +kish.toFixed(1), wilsonAtKish: wilson(p * kish, kish).map(pct), items: w, labels: subset.length };
}
const clusters = (cs) => ins.filter((r) => cs.includes(r.cluster));
const inSample = {
  all: postStrat(ins, 'conservative'),
  nonAgentic: { conservative: postStrat(clusters(['automation', 'orchestration', 'science', 'consumer-creative']), 'conservative'), dashboardExplained: postStrat(clusters(['automation', 'orchestration', 'science', 'consumer-creative']), 'dashboardExplained') },
  automationOrchestration: { conservative: postStrat(clusters(['automation', 'orchestration']), 'conservative'), dashboardExplained: postStrat(clusters(['automation', 'orchestration']), 'dashboardExplained'), unweightedConservative: (() => { const s = clusters(['automation', 'orchestration']); const x = s.filter((r) => !r.dashboardCriterion && r.explained === 'yes').length; return { x, n: s.length, p: pct(x / s.length), wilson: ci(x, s.length) }; })() },
  agentic: postStrat(clusters(['agentic']), 'conservative'),
  yesRowsWithGap: (() => { const y = ins.filter((r) => r.explained === 'yes'); const x = y.filter((r) => r.gaps.length > 0).length; return { x, n: y.length, p: pct(x / y.length) }; })(),
  patternsPerItemByCluster: Object.fromEntries(['automation', 'orchestration', 'science', 'consumer-creative', 'agentic'].map((c) => { const a = clusters([c]).map((r) => r.patterns.length).sort((x, y) => x - y); return [c, { n: a.length, median: a[Math.floor(a.length / 2)], max: a[a.length - 1], over5: a.filter((v) => v > 5).length }]; })),
};

// ---- needs profile: constructs and patterns per platform; nearest in-corpus platform by cosine on pattern shares (census = candidate generator)
const census = jl(path.join(OUT, 'pattern-census-items.jsonl'));
const pset = new Set(); for (const r of census) for (const k of Object.keys(r.needs)) if (/^P\d+$/.test(k)) pset.add(k);
for (const r of rows) for (const p of r.patterns) pset.add(p);
const P = [...pset].sort();
const vec = (items, get) => P.map((p) => items.filter((i) => get(i).includes(p)).length / items.length);
const cosine = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / Math.sqrt(na * nb); };
const corpusPlat = {}; for (const r of census) (corpusPlat[r.plat] ??= []).push(r);
const CL = { automation: ['activepieces', 'coze', 'dify', 'flowise', 'langflow', 'n8n', 'node-red', 'zapier'], orchestration: ['airflow', 'argo', 'dagster', 'github-actions', 'gitlab-ci', 'kubeflow', 'prefect', 'tekton', 'temporal'], science: ['cwl', 'galaxy', 'nextflow', 'nf-core', 'snakemake', 'wdl'], 'consumer-creative': ['apple-shortcuts', 'comfyui', 'home-assistant', 'ifttt'] };
const clusterOf = (p) => (p === 'claude-code-workflows' ? 'first-party' : Object.entries(CL).find(([, v]) => v.includes(p))?.[0] ?? 'agentic');
const corpusVec = Object.fromEntries(Object.entries(corpusPlat).filter(([, a]) => a.length >= 8).map(([p, a]) => [p, vec(a, (r) => Object.keys(r.needs))]));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const profile = {};
for (const p of PLATFORMS) {
  const a = byP[p]; const v = vec(a, (r) => r.patterns);
  const near = Object.entries(corpusVec).map(([q, w]) => ({ platform: q, cluster: clusterOf(q), cosine: +cosine(v, w).toFixed(3) })).sort((x, y) => y.cosine - x.cosine);
  const clusterNear = {}; for (const n of near) (clusterNear[n.cluster] ??= []).push(n.cosine);
  const cMean = Object.entries(clusterNear).map(([c, xs]) => ({ cluster: c, meanCosine: +(xs.reduce((s, t) => s + t, 0) / xs.length).toFixed(3) })).sort((x, y) => y.meanCosine - x.meanCosine);
  const counts = {}; for (const r of a) for (const k of r.patterns) counts[k] = (counts[k] ?? 0) + 1;
  const l0c = {}; for (const r of a) for (const k of r.l0) l0c[k] = (l0c[k] ?? 0) + 1;
  profile[p] = { n: a.length, patternsPerItem: { median: median(a.map((r) => r.patterns.length)), max: Math.max(...a.map((r) => r.patterns.length)), over5: a.filter((r) => r.patterns.length > 5).length }, sizeMedian: median(a.map((r) => r.size)), sizeMax: Math.max(...a.map((r) => r.size)), trivial: a.filter((r) => r.size <= 2).length, topPatterns: Object.entries(counts).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, 6), l0Top: Object.entries(l0c).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, 8), nearestPlatforms: near.slice(0, 3), nearestClusters: cMean.slice(0, 2) };
}
const pooledPatternCounts = {}; for (const r of rows) for (const k of r.patterns) pooledPatternCounts[k] = (pooledPatternCounts[k] ?? 0) + 1;
const pooledL0 = {}; for (const r of rows) for (const k of r.l0) pooledL0[k] = (pooledL0[k] ?? 0) + 1;
const corpusRank = (() => { const n = {}; for (const r of census) for (const k of Object.keys(r.needs)) if (/^P\d+$/.test(k)) n[k] = (n[k] ?? 0) + 1; return n; })();

// ---- missing constructs: gap tags with counts (items and gaps), class and kind
const missing = {};
for (const g of gapRows) { const m = (missing[g.tag ?? 'UNTAGGED'] ??= { tag: g.tag, label: TAGS.find((t) => t[0] === g.tag)?.[1], gaps: 0, items: new Set(), platforms: new Set(), kinds: new Set(), classes: new Set(), lacks: new Set(), notExplained: 0 }); m.gaps++; m.items.add(g.id); m.platforms.add(g.platform); m.kinds.add(g.kind); m.classes.add(g.class); m.lacks.add(g.lacks); }
const missingList = Object.values(missing).map((m) => ({ tag: m.tag, label: m.label, items: m.items.size, gaps: m.gaps, platforms: [...m.platforms].sort(), kinds: [...m.kinds].sort(), classes: [...m.classes].sort(), lacks: [...m.lacks].sort() })).sort((a, b) => b.items - a.items || (a.tag < b.tag ? -1 : 1));
const notYes = rows.filter((r) => r.explained !== 'yes').map((r) => ({ id: r.id, explained: r.explained, stops: r.gaps.filter((g) => g.class === 'stops').map((g) => g.fragment.slice(0, 120)) }));

const out = {
  made: new Date().toISOString(), n: rows.length, decisionBar: bar, decision,
  pooled: { strict, lenient, S3_noVocabularyChange: s3, S4_noConstructOrField: s4, nonTrivial_sizeGE3: covNon, trivialCount: trivial.length, trivialAllExplained: trivial.every((r) => r.explained === 'yes'), yesWithAtLeastOneGap: yesWithGap },
  perPlatform, leaveOnePlatformOut: lopo, inSample, profile,
  pooledL0: Object.entries(pooledL0).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)), pooledPatterns: Object.entries(pooledPatternCounts).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(([k, v]) => ({ pattern: k, workflows: v, corpusItems: corpusRank[k] ?? 0 })),
  patternsNeverUsed: P.filter((p) => !pooledPatternCounts[p] && (corpusRank[p] ?? 0) > 0).length,
  missing: missingList, notYes, gapRows, untagged,
  sizes: rows.map((r) => ({ id: r.id, platform: r.platform, size: r.size, explained: r.explained, gaps: r.gaps.length })),
};
fs.writeFileSync(path.join(HERE, 'summary.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ decision, strict, lenient, perPlatform: Object.fromEntries(Object.entries(perPlatform).map(([k, v]) => [k, `${v.yes}/${v.n} ${v.strict.p} [${v.strict.wilson}]`])), lopo: Object.fromEntries(Object.entries(lopo).map(([k, v]) => [k, v.p])), S3: s3, S4: s4, nonTrivial: covNon, trivial: trivial.length, yesWithGap, untagged: untagged.length }, null, 1));
