// ROUTER-1 review addendum (2026-11-04): the $0 re-analyses the review asked for, computed from the COMMITTED rows only (no
// model call). Every number here is POST-HOC (written after the test split was read) and diagnostic, except section A, which is
// a record of when things happened.
//
//   A  freeze ordering (review B1): judge rows that existed at each ROUTER-1 commit, from the rows' own timestamps and git
//   B  leak exclusion (M1): test items quoted in RUBRIC.md / judge-prompt.mjs, and v1 cues that fire on test items but on no dev
//      item; every system re-scored without them
//   C  Mercury as a system (m7): faults counted as "no", and faults falling back to the code decision
//   D  operating-point-matched comparisons (review: "two different operating points"): recall at a fixed false-trigger count,
//      threshold read off the TEST split (an oracle operating point, diagnostic only)
//   E  the protocol (M5): how often the preregistered never-trigger rule can pass at all, how many negatives a "never" claim
//      needs, and the middle band the preregistered rule could not test, chosen on OUT-OF-FOLD dev scores
//   F  generation-call clusters (m1)
//   G  the $0 learned baseline (m11; baseline-ngram.mjs, frozen on dev in 1f8e27c0 before its test read)
//   H  the shipped product's measured operating points per (decider, sensitivity) (M4) -> src/need/reliability.json
//
//   node experiments/need-router/router1/addendum.mjs   # writes results/ADDENDUM-REVIEW.md, results/addendum-review.json, src/need/reliability.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadSet, readJsonl, rowsFile, RUNS } from './judges.mjs';
import { confusion, auroc, cpUpper, RESULTS, KEYWORDS } from './eval-router1.mjs';
import { fitLogistic } from './fit.mjs';
import * as V1 from './frozen-v1/router.mjs';
import * as V1P from './frozen-v1/primitives.mjs';
import * as V11 from '../../../src/need/router.mjs';
import { FEATURES } from '../../../src/need/primitives.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const r4 = x => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 1e4) / 1e4);
const set = loadSet(), dev = set.filter(it => it.split === 'dev'), test = set.filter(it => it.split === 'test');
const INDEPENDENT = new Set(['mercury', 'ab-devtrain', 'ab-simple', 'anchor', 'abr-policy', 'ebed-spec']);
const KEYWORD_RE = new RegExp(`\\b(?:${KEYWORDS.join('|')})\\b`, 'i');
const rowsOf = (judge, split, sample = 0) => new Map(readJsonl(rowsFile(judge, split)).filter(r => (r.sample ?? 0) === sample).map(r => [r.id, r]));
const H = { dev: rowsOf('haiku', 'dev'), test: rowsOf('haiku', 'test') };
const M = { dev: rowsOf('mercury', 'dev'), test: rowsOf('mercury', 'test') };
const ok = r => r && r.ok;
// The 13 faulted Mercury test calls re-asked at a 4,000-token output cap (mercury-refault.mjs, 2026-11-04; diagnostic). M4K is the
// test rows with those answers in place of the faults: what the product's Mercury judge (cap 4,000) would have seen.
const REFAULT = new Map(readJsonl(path.join(RUNS, 'mercury-test-refault-4000.jsonl')).filter(r => r.ok).map(r => [r.id, r]));
const M4K = { dev: M.dev, test: new Map([...M.test].map(([id, r]) => [id, ok(r) ? r : (REFAULT.get(id) ?? r)])) };
const v1 = new Map(set.map(it => [it.id, V1.needCheck(it.text)]));
const v11 = new Map(set.map(it => [it.id, V11.needCheck(it.text)]));
const P1 = V1.loadParams(), P11 = V11.loadParams();
const ngramFile = path.join(RESULTS, 'ngram-test.json');
const NG = existsSync(ngramFile) ? JSON.parse(readFileSync(ngramFile, 'utf8')) : null;
const ngram = NG ? new Map(NG.rows.map(r => [r.id, r.p])) : null;

// ---------- systems as (item -> {yes, p}) on the test split ----------
const systems = {
  'router v1 (preregistered)': it => ({ yes: v1.get(it.id).needsWorkflow, p: v1.get(it.id).p }),
  'router v1.1 (dev evidence)': it => ({ yes: v11.get(it.id).needsWorkflow, p: v11.get(it.id).p }),
  'Haiku direct': it => ({ yes: H.test.get(it.id).needsWorkflow, p: H.test.get(it.id).p }),
  'Mercury direct (faults = no)': it => (ok(M.test.get(it.id)) ? { yes: M.test.get(it.id).needsWorkflow, p: M.test.get(it.id).p } : { yes: false, p: 0 }),
  keyword: it => ({ yes: KEYWORD_RE.test(it.text), p: KEYWORD_RE.test(it.text) ? 1 : 0 }),
  ...(ngram ? { 'n-gram LR ($0 learned, post-hoc)': it => ({ yes: ngram.get(it.id) >= NG.choice.threshold, p: ngram.get(it.id) }) } : {})
};
function score(items, sys) {
  const g = items.map(it => it.gold.needsWorkflow), d = items.map(sys), c = confusion(g, d.map(x => x.yes)), neg = g.filter(x => !x).length;
  return { n: items.length, negatives: neg, positives: g.length - neg, fp: c.fp, tp: c.tp, fn: c.fn, recall: c.recall, precision: c.precision, f1: c.f1, fpUpper95: cpUpper(c.fp, neg), auroc: auroc(g, d.map(x => x.p)) };
}
const table = items => Object.fromEntries(Object.entries(systems).map(([k, f]) => [k, score(items, f)]));

// ---------- A. freeze ordering ----------
const COMMITS = [['72785e59', 'set frozen'], ['04db31b9', 'PREREG frozen'], ['f9641ff9', 'router v1 frozen (step 3)'], ['45909902', 'deviations D1, D2'],
  ['f13864a5', 'step 4 frozen; D3'], ['297a303e', 'v1.1 frozen; D4'], ['2fd70d02', 'step 5 test results']];
const gitTime = sha => { try { return execFileSync('git', ['show', '-s', '--format=%cI', sha], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } };
const allRows = Object.fromEntries(['haiku-dev', 'haiku-test', 'mercury-dev', 'mercury-test'].map(k => [k, readJsonl(path.join(RUNS, `${k}.jsonl`))]));
const A = {
  commits: COMMITS.map(([sha, what]) => {
    const at = gitTime(sha), t = at ? Date.parse(at) : NaN;
    return { sha, what, at, rowsExisting: Object.fromEntries(Object.entries(allRows).map(([k, rows]) => [k, `${rows.filter(r => Date.parse(r.at) < t).length}/${rows.length}`])) };
  }),
  firstRow: Object.fromEntries(Object.entries(allRows).map(([k, rows]) => [k, rows.map(r => r.at).sort()[0]])),
  lastRow: Object.fromEntries(Object.entries(allRows).map(([k, rows]) => [k, rows.map(r => r.at).sort().at(-1)]))
};

// ---------- B. leak exclusion ----------
// L1: test items whose words the rubric or the judge prompt quotes (near-verbatim). L1b: the same pattern, looser wording.
const QUOTED = [
  ['ab-sales.historical_context_pipeline_report', 'RUBRIC.md:29 "this week\'s update, same format as last time"; judge-prompt.mjs:12 "this week\'s update, same as last time"'],
  ['ab-marketing.newsletter_unsubscribe_processing', 'RUBRIC.md:30 "the latest batch, same workflow as last time"'],
  ['au-biz09', 'RUBRIC.md:62 "Close the books for September"'],
  ['ab-finance.commission_calculation', 'RUBRIC.md:62-63 "calculate March commissions"'],
  ['au-adv12', 'RUBRIC.md:65 "what did I spend each month last year"'],
  ['au-adv13', 'RUBRIC.md:28 and judge-prompt.mjs:12 "keep an eye on"']
];
const PATTERN = [
  ['ab-hr.anniversary_recognition', '"this month\'s ..., same format as last month" (the RUBRIC.md:29 pattern)'],
  ['me-m2-casual-2', '"Same format as last week\'s report" (the RUBRIC.md:29 pattern)']
];
const cueIds = it => {
  const d = V1P.detectPrimitives(it.text);
  return new Set([...Object.values(d.evidence).flat().map(h => h.id), ...d.irreversible.hits.map(h => `irr:${h.id}`)].filter(id => !['system', 'party', 'channel', 'email', 'context'].includes(id)));
};
const fires = items => { const m = new Map(); for (const it of items) for (const id of cueIds(it)) m.set(id, [...(m.get(id) ?? []), it.id]); return m; };
const devFires = fires(dev), testFires = fires(test);
const testOnlyCues = [...testFires].filter(([id]) => !devFires.has(id)).map(([id, ids]) => ({ cue: id, testItems: ids })).sort((a, b) => b.testItems.length - a.testItems.length);
const L1 = new Set(QUOTED.map(([id]) => id)), L1b = new Set(PATTERN.map(([id]) => id)), L2 = new Set(testOnlyCues.flatMap(c => c.testItems));
const B = {
  quoted: QUOTED.map(([id, where]) => ({ id, where, gold: test.find(x => x.id === id).gold.mode })),
  pattern: PATTERN.map(([id, where]) => ({ id, where, gold: test.find(x => x.id === id).gold.mode })),
  testOnlyCues,
  sets: { L1: L1.size, L1b: L1b.size, L2: L2.size, union: new Set([...L1, ...L1b, ...L2]).size },
  scores: {
    'all test': table(test),
    'without L1 (quoted)': table(test.filter(it => !L1.has(it.id))),
    'without L1 + L1b': table(test.filter(it => !L1.has(it.id) && !L1b.has(it.id))),
    'without L1 + L1b + L2 (test-only cues)': table(test.filter(it => !L1.has(it.id) && !L1b.has(it.id) && !L2.has(it.id)))
  },
  haikuHighConfidence: {
    all: score(test.filter(it => it.gold.confidence === 'high'), systems['Haiku direct']),
    withoutLeaks: score(test.filter(it => it.gold.confidence === 'high' && !L1.has(it.id) && !L1b.has(it.id) && !L2.has(it.id)), systems['Haiku direct'])
  }
};

// ---------- C. Mercury as a system ----------
const mercFaults = test.filter(it => !ok(M.test.get(it.id)));
const C = {
  faults: mercFaults.map(it => ({ id: it.id, gold: it.gold.mode, code: M.test.get(it.id)?.error?.code ?? 'MISSING' })),
  survivors: score(test.filter(it => ok(M.test.get(it.id))), systems['Mercury direct (faults = no)']),
  faultsAsNo: score(test, systems['Mercury direct (faults = no)']),
  faultsToCodeV1: score(test, it => (ok(M.test.get(it.id)) ? { yes: M.test.get(it.id).needsWorkflow, p: M.test.get(it.id).p } : { yes: v1.get(it.id).needsWorkflow, p: v1.get(it.id).p })),
  refault4000: {
    rows: mercFaults.map(it => { const r = REFAULT.get(it.id); return { id: it.id, gold: it.gold.mode, mode: r?.mode ?? null, p: r?.p ?? null, outputTokens: r?.usage?.outputTokens ?? null }; }),
    answered: mercFaults.filter(it => REFAULT.has(it.id)).length,
    merged: score(test, it => { const r = M4K.test.get(it.id); return ok(r) ? { yes: r.needsWorkflow, p: r.p } : { yes: false, p: 0 }; })
  }
};

// ---------- D. operating-point-matched (oracle thresholds on test) ----------
function recallAtFp(items, pOf, maxFp) {
  const g = items.map(it => it.gold.needsWorkflow), ps = items.map(pOf);
  let best = { t: Infinity, fp: 0, recall: 0 };
  for (const t of [...new Set(ps)].sort((a, b) => b - a)) {
    const c = confusion(g, ps.map(p => p >= t));
    if (c.fp > maxFp) break;
    if (c.recall >= best.recall) best = { t, fp: c.fp, recall: c.recall };
  }
  return best;
}
const pOf = { 'router v1': it => v1.get(it.id).p, 'router v1.1': it => v11.get(it.id).p, Haiku: it => H.test.get(it.id).p,
  'Mercury (faults = 0)': it => (ok(M.test.get(it.id)) ? M.test.get(it.id).p : 0), ...(ngram ? { 'n-gram LR': it => ngram.get(it.id) } : {}) };
const D = Object.fromEntries(Object.entries(pOf).map(([k, f]) => [k, Object.fromEntries([0, 1, 5, 9].map(n => [`fp<=${n}`, recallAtFp(test, f, n)]))]));

// ---------- E. protocol power and the out-of-fold middle band ----------
const passChance = (nDev, nTest) => nDev / (nDev + nTest);             // P(max of nDev i.i.d. negatives exceeds all nTest): exact for continuous scores
const negativesNeeded = rate => ({ twoSided95: Math.ceil(Math.log(0.025) / Math.log(1 - rate)), oneSided95: Math.ceil(Math.log(0.05) / Math.log(1 - rate)) });
const fold = it => parseInt(createHash('sha256').update(`router1-cv:${it.cluster}`).digest('hex').slice(0, 8), 16) % 5;
const X1 = new Map(set.map(it => [it.id, FEATURES.map(f => V1P.detectPrimitives(it.text).features[f])]));
const sig = (w, b, x) => 1 / (1 + Math.exp(-(b + FEATURES.reduce((s, f, j) => s + w[f] * x[j], 0))));
const oof = new Map();                                                    // dev id -> { p, t } from the fold model that did not see it
for (let f = 0; f < 5; f++) {
  const train = dev.filter(it => fold(it) !== f), held = dev.filter(it => fold(it) === f);
  const m = fitLogistic(train.map(it => X1.get(it.id)), train.map(it => (it.gold.needsWorkflow ? 1 : 0)));
  const negMax = Math.max(...train.filter(it => !it.gold.needsWorkflow).map(it => sig(m.weights, m.bias, X1.get(it.id))));
  for (const it of held) oof.set(it.id, { p: sig(m.weights, m.bias, X1.get(it.id)), t: Math.min(0.99, negMax + 0.02) });
}
const judges = { mercury: M, haiku: H };
function band(items, split, judge, delta, twoSided) {
  const rows = judges[judge][split];
  let asked = 0, fallbacks = 0;
  const preds = items.map(it => {
    const { p, t } = split === 'dev' ? oof.get(it.id) : { p: v1.get(it.id).p, t: P1.tDefault };
    const inBand = delta > 0 && p >= t - delta && (twoSided ? p < t + delta : p < t);
    if (!inBand) return p >= t;
    const r = rows.get(it.id);
    if (!ok(r)) { fallbacks++; return p >= t; }
    asked++; return r.needsWorkflow;
  });
  const c = confusion(items.map(it => it.gold.needsWorkflow), preds);
  return { fp: c.fp, recall: c.recall, f1: c.f1, asked, fallbacks };
}
const grid = [];
for (const judge of ['mercury', 'haiku']) for (const twoSided of [false, true]) for (const delta of [0, 0.1, 0.2, 0.3, 0.4]) {
  if (delta === 0 && twoSided) continue;
  grid.push({ judge, band: delta === 0 ? 'none' : twoSided ? 'two-sided' : 'one-sided', delta, dev: band(dev, 'dev', judge, delta, twoSided), test: band(test, 'test', judge, delta, twoSided) });
}
const codeOnlyDevFp = grid.find(r => r.delta === 0).dev.fp;
const RANK = { 'none': 0, 'one-sided': 1, 'two-sided': 2 };
const eligible = grid.filter(r => r.dev.fp <= codeOnlyDevFp).sort((a, b) => b.dev.recall - a.dev.recall || (a.judge === b.judge ? 0 : a.judge === 'mercury' ? -1 : 1) || a.delta - b.delta || RANK[a.band] - RANK[b.band]);
const E = {
  preregRulePassChance: { devNegatives: 84, testNegatives: 132, chance: r4(passChance(84, 132)), note: 'for any score whose negatives are i.i.d. across splits, P(no test negative above the highest dev negative) = 84/216; the +0.02 margin raises it a little' },
  cpUpperAtZero: { n132: cpUpper(0, 132), n84: cpUpper(0, 84) },
  negativesNeededForZeroFp: { '5%': negativesNeeded(0.05), '2%': negativesNeeded(0.02), '1%': negativesNeeded(0.01) },
  oofRouterV1: (() => { const ids = dev.map(it => it.id); const c = confusion(dev.map(it => it.gold.needsWorkflow), ids.map(id => oof.get(id).p >= oof.get(id).t)); return { fp: c.fp, recall: c.recall, auroc: auroc(dev.map(it => it.gold.needsWorkflow), ids.map(id => oof.get(id).p)) }; })(),
  rule: 'post-hoc: among (judge, band, delta), the highest OUT-OF-FOLD dev recall whose OOF dev false triggers do not exceed code only; ties -> Mercury before Haiku, smaller delta, one-sided before two-sided',
  grid, choice: eligible[0] ?? null
};

// ---------- F. generation-call clusters ----------
const calls = {};
for (const it of set.filter(it => it.source === 'mercury')) { const c = it.id.replace(/-\d+$/, ''); (calls[c] ??= { dev: 0, test: 0 })[it.split]++; }
const clean = test.filter(it => INDEPENDENT.has(it.source) && it.source !== 'mercury');
const F = { mercuryCalls: calls, straddling: Object.values(calls).filter(c => c.dev && c.test).length, callsTotal: Object.keys(calls).length,
  clusterCleanSlice: { what: 'independent text without the Mercury-written items (AutomationBench prompts, anchor beds, family policies, E-bed specs)', scores: table(clean) },
  mercurySlice: table(test.filter(it => it.source === 'mercury')) };

// ---------- G. n-gram baseline ----------
const G = NG ? { choice: NG.choice, test: NG.test, routerV1Auroc: score(test, systems['router v1 (preregistered)']).auroc, haikuAuroc: score(test, systems['Haiku direct']).auroc } : null;

// ---------- H. the shipped product's operating points ----------
export const SLIDER_POINTS = [0, 0.25, 0.5, 0.75, 1];
const L = V11.CASCADE_CLEAR_BELOW;
function product(items, split, decider, s) {
  let calls = 0, cost = 0, faults = 0;
  const preds = items.map(it => {
    const c = v11.get(it.id), code = c.p >= V11.thresholdAt(s, P11.tDefault);
    if (decider === 'code') return code;
    if (s <= 0) return false;
    if (s >= 1) return true;
    if (c.p < L) return false;
    const r = (decider === 'cascade:claude-haiku-5-5' ? H : M4K)[split].get(it.id);
    calls++; cost += r?.costUsd ?? 0;
    if (!ok(r)) { faults++; return code; }
    return r.p >= V11.thresholdAt(s, 0.5);
  });
  const g = items.map(it => it.gold.needsWorkflow), c = confusion(g, preds), neg = g.filter(x => !x).length;
  return { n: items.length, fp: c.fp, negatives: neg, tp: c.tp, positives: g.length - neg, recall: c.recall, precision: c.precision, fpUpper95: cpUpper(c.fp, neg),
    judgeShare: r4(calls / items.length), judgeFaults: faults, costPerDecisionUsd: Number((cost / items.length).toPrecision(3)) };
}
const DECIDERS = ['code', 'cascade:claude-haiku-5-5', 'cascade:mercury-3'];
const reliability = {
  schema: 'foundry.need-reliability/1',
  generatedBy: 'experiments/need-router/router1/addendum.mjs',
  paramsSha: P11.sha, detector: P11.detector, cascadeClearBelow: L, judgeOutputCap: { 'claude-haiku-5-5': 1000, 'mercury-3': 4000 },
  preregisteredV1AtDefault: (() => { const m = score(test, systems['router v1 (preregistered)']); return { fp: m.fp, negatives: m.negatives, tp: m.tp, positives: m.positives, recall: m.recall, fpUpper95: m.fpUpper95 }; })(),
  measuredOn: 'ROUTER-1 test split (193 requests: 132 do not need a workflow, 61 do; one author wrote the rubric and every label)',
  grade: {
    code: 'development evidence: the shipped detectors (v1.1) were frozen after test judge rows existed and tuned on probes that paraphrase test items (RESULT-ROUTER-1, review B1); the preregistered v1 scored 9/132 false triggers and recall 0.67 at 0.5',
    'cascade:claude-haiku-5-5': 'post-hoc: the cascade and its 0.05 clearing bar were chosen after the test split was read; sealed confirmation pending',
    'cascade:mercury-3': 'post-hoc, as the Haiku cascade; the frozen pass used a 1,000-token output cap and 13 of 193 test calls gave no answer, so those 13 were re-asked at the product\'s 4,000-token cap on 2026-11-04 (all answered) and their answers are used here'
  },
  points: Object.fromEntries(DECIDERS.map(d => [d, Object.fromEntries(SLIDER_POINTS.map(s => [String(s), { test: product(test, 'test', d, s), dev: product(dev, 'dev', d, s) }]))]))
};

// ---------- write ----------
const out = { note: 'POST-HOC review addendum; $0; computed from committed rows. Diagnostic except section A.', A, B, C, D, E, F, G, H: reliability };
writeFileSync(path.join(RESULTS, 'addendum-review.json'), JSON.stringify(out, null, 1) + '\n');
writeFileSync(path.join(ROOT, 'src/need/reliability.json'), JSON.stringify(reliability, null, 1) + '\n');

const f3 = x => (x === null || x === undefined ? 'n/a' : Number.isInteger(x) ? String(x) : x.toFixed(3));
const row = (k, m) => `| ${k} | ${m.n} | ${m.fp}/${m.negatives} (${f3(m.fpUpper95)}) | ${m.tp}/${m.positives} | ${f3(m.recall)} | ${f3(m.f1)} | ${f3(m.auroc)} |`;
const head = ['| system | n | false triggers (95% upper) | caught | recall | F1 | AUROC |', '|---|---|---|---|---|---|---|'];
const md = ['# ROUTER-1 review addendum (2026-11-04): $0 re-analyses (post-hoc, diagnostic)', '',
  'Generated by `experiments/need-router/router1/addendum.mjs` from the committed rows; no model was called. Everything except section A was',
  'written after the test split was read: read it as diagnostic, never as held-out evidence of the preregistered grade.', '',
  '## A. Freeze ordering (review B1): judge rows that existed at each commit', '',
  '| commit | what | committed (UTC) | haiku-dev | haiku-test | mercury-dev | mercury-test |', '|---|---|---|---|---|---|---|',
  ...A.commits.map(c => `| \`${c.sha}\` | ${c.what} | ${c.at?.replace('+00:00', 'Z')} | ${c.rowsExisting['haiku-dev']} | ${c.rowsExisting['haiku-test']} | ${c.rowsExisting['mercury-dev']} | ${c.rowsExisting['mercury-test']} |`), '',
  `First rows: ${Object.entries(A.firstRow).map(([k, v]) => `${k} ${v}`).join('; ')}. Last rows: ${Object.entries(A.lastRow).map(([k, v]) => `${k} ${v}`).join('; ')}.`, '',
  '## B. Leak exclusion (review M1)', '',
  `**L1, quoted (${B.quoted.length} test items):** ${B.quoted.map(q => `\`${q.id}\` (${q.gold}; ${q.where})`).join('; ')}.`, '',
  `**L1b, same pattern (${B.pattern.length}):** ${B.pattern.map(q => `\`${q.id}\` (${q.gold}; ${q.where})`).join('; ')}.`, '',
  `**L2, v1 cues that fire on test items and on no dev item (${testOnlyCues.length} cues, ${L2.size} test items):** ${testOnlyCues.map(c => `\`${c.cue}\` (${c.testItems.length})`).join(', ')}. The preregistration says the detectors were written "iterating only on dev items"; a cue that no dev item fires was not justified by dev.`, '',
  ...Object.entries(B.scores).flatMap(([k, t]) => [`**${k}:**`, '', ...head, ...Object.entries(t).map(([s, m]) => row(s, m)), '']),
  `**Haiku on high-confidence labels:** all ${B.haikuHighConfidence.all.n}: ${B.haikuHighConfidence.all.fp} false triggers, recall ${f3(B.haikuHighConfidence.all.recall)}; without L1, L1b and L2: ${B.haikuHighConfidence.withoutLeaks.n} items, ${B.haikuHighConfidence.withoutLeaks.fp} false triggers, recall ${f3(B.haikuHighConfidence.withoutLeaks.recall)}.`, '',
  '## C. Mercury as a system (review m7)', '',
  `Faults (${C.faults.length}): ${C.faults.map(f => `\`${f.id}\` (${f.gold}, ${f.code})`).join('; ')}.`, '', ...head,
  row('Mercury, answered items only', C.survivors), row('Mercury, faults counted as "no"', C.faultsAsNo), row('Mercury, faults fall back to router v1', C.faultsToCodeV1),
  row('Mercury, the 13 faults re-asked at a 4,000-token cap (2026-11-04)', C.refault4000.merged), '',
  `**Root cause (re-ask at a 4,000-token output cap, \`mercury-refault.mjs\`):** ${C.refault4000.answered} of ${C.faults.length} answered (eb-e8 only after the port's per-call reservation was widened to hold its 2,000-token input). Output tokens of the answers: ${C.refault4000.rows.map(r => r.outputTokens).filter(Number.isFinite).sort((a, b) => a - b).join(', ')}; the 1,000 cap caused the truncations (Mercury 3 reasons on every call). The content-filter (au-q11) and non-JSON (au-adv04) faults did not recur: both were one-off. Answers against gold: ${C.refault4000.rows.map(r => '`' + r.id + '` ' + (r.mode ?? 'fault') + ' ' + (r.p ?? '') + ' (gold ' + r.gold + ')').join('; ')}.`, '',
  '## D. Operating-point-matched recall (threshold read off the test split: an oracle point, diagnostic)', '',
  '| score | recall at 0 FP | at ≤ 1 FP | at ≤ 5 FP | at ≤ 9 FP |', '|---|---|---|---|---|',
  ...Object.entries(D).map(([k, v]) => `| ${k} | ${f3(v['fp<=0'].recall)} | ${f3(v['fp<=1'].recall)} | ${f3(v['fp<=5'].recall)} | ${f3(v['fp<=9'].recall)} |`), '',
  '## E. The protocol (review M5)', '',
  `- **The preregistered never-trigger rule could rarely pass.** With the threshold at the highest of 84 dev negatives, the chance that none of 132 test negatives scores higher is ${E.preregRulePassChance.chance} for any score whose negatives are exchangeable across splits (84/216), before any wording shift.`,
  `- **"Never" needs many negatives.** 0 of 132 bounds the false-trigger rate at ${f3(E.cpUpperAtZero.n132)} (95% two-sided Clopper-Pearson). To show ≤ 5% / 2% / 1% with zero false triggers takes ${E.negativesNeededForZeroFp['5%'].twoSided95} / ${E.negativesNeededForZeroFp['2%'].twoSided95} / ${E.negativesNeededForZeroFp['1%'].twoSided95} negatives (two-sided 95%; one-sided: ${E.negativesNeededForZeroFp['5%'].oneSided95} / ${E.negativesNeededForZeroFp['2%'].oneSided95} / ${E.negativesNeededForZeroFp['1%'].oneSided95}).`,
  `- **Out-of-fold dev router v1** (5-fold cluster refits, threshold by the prereg rule inside each fold): ${E.oofRouterV1.fp}/84 false triggers, recall ${f3(E.oofRouterV1.recall)}, AUROC ${f3(E.oofRouterV1.auroc)}. In-sample it was 0/84 and 1.0: the band had nothing to fix on the data the rule chose it on.`, '',
  `**Middle band, chosen on OUT-OF-FOLD dev scores (${E.rule}).**`, '',
  '| judge | band | δ | OOF dev FP | OOF dev recall | dev asked | test FP | test recall | test F1 | test asked | test fallbacks |', '|---|---|---|---|---|---|---|---|---|---|---|',
  ...grid.map(r => `| ${r.judge} | ${r.band} | ${r.delta} | ${r.dev.fp}/84 | ${f3(r.dev.recall)} | ${r.dev.asked} | ${r.test.fp}/132 | ${f3(r.test.recall)} | ${f3(r.test.f1)} | ${r.test.asked} | ${r.test.fallbacks} |`), '',
  E.choice ? `Chosen: ${E.choice.judge}, ${E.choice.band}, δ = ${E.choice.delta} (dev OOF ${E.choice.dev.fp}/84, recall ${f3(E.choice.dev.recall)}). On test: ${E.choice.test.fp}/132 false triggers, recall ${f3(E.choice.test.recall)}, F1 ${f3(E.choice.test.f1)}, judge asked on ${E.choice.test.asked} of 193.` : 'No choice.', '',
  '## F. Generation-call clusters (review m1)', '',
  `All ${F.straddling} of ${F.callsTotal} Mercury generation calls put items on both sides of the split (${Object.entries(calls).map(([k, v]) => `${k} ${v.dev}/${v.test}`).join(', ')}; dev/test). No Mercury test item is cluster-held-out. The cluster-clean slice is ${F.clusterCleanSlice.what}:`, '',
  ...head, ...Object.entries(F.clusterCleanSlice.scores).map(([s, m]) => row(s, m)), '', '**Mercury-written test items (not cluster-held-out):**', '', ...head, ...Object.entries(F.mercurySlice).map(([s, m]) => row(s, m)), '',
  '## G. A $0 learned baseline (review m11)', '',
  G ? `Character 3-5-gram TF-IDF + L2 logistic regression on the 126 dev items (lambda ${G.choice.lambda} by dev OOF AUROC ${G.choice.devOof.auroc}; threshold ${G.choice.threshold} by the never-trigger rule on OOF dev scores; frozen in \`1f8e27c0\` before its test read). Test: ${G.test.fp}/132 false triggers (95% upper ${f3(G.test.fpRateUpper95)}), recall ${f3(G.test.recall)}, F1 ${f3(G.test.f1)}, **AUROC ${f3(G.test.auroc)}** against the hand-written router's ${f3(G.routerV1Auroc)} and Haiku's ${f3(G.haikuAuroc)}. Fit and score of all 193 in ${G.test.msTotalFitAndScore} ms.` : 'Not run.', '',
  '## H. The shipped product\'s measured operating points (review M4) -> `src/need/reliability.json`', '',
  'Code = v1.1 detectors alone; cascade = code clears p < 0.05, the judge decides the rest, the slider moves the judge\'s bar (s = 0 never, s = 1 always). Test split.', '',
  '| decider | s | false triggers (95% upper) | recall | judge asked | $ per decision |', '|---|---|---|---|---|---|',
  ...DECIDERS.flatMap(d => SLIDER_POINTS.map(s => { const m = reliability.points[d][String(s)].test; return `| ${d} | ${s} | ${m.fp}/${m.negatives} (${f3(m.fpUpper95)}) | ${f3(m.recall)} | ${f3(m.judgeShare)}${m.judgeFaults ? ` (${m.judgeFaults} faults)` : ''} | ${m.costPerDecisionUsd} |`; })), ''
].join('\n');
writeFileSync(path.join(RESULTS, 'ADDENDUM-REVIEW.md'), md);
console.log(md);
