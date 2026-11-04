// ROUTER-1 POST-HOC analyses (written after the test split was evaluated; NOT preregistered; diagnostic evidence only).
// Every rule below is chosen on dev only, then read on test, but the designs themselves were chosen after seeing test results.
//
//   (a) Haiku's percent as the slider score: the never-trigger rule (max dev-negative p + 0.02) applied to Haiku's p, and a
//       threshold table on test.
//   (b) Cascade: the $0 code router clears requests whose p is below L; Haiku decides the rest. L is set on dev from
//       out-of-fold (5-fold cluster CV) router p: L = (lowest out-of-fold p among dev positives) - 0.02. Reported for the
//       shipped v1.1 router; a table over L shows the cost/recall frontier for v1 and v1.1.
//
//   node experiments/need-router/router1/posthoc.mjs     # writes results/POSTHOC-test.md and results/posthoc-test.json
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadSet, readJsonl, rowsFile } from './judges.mjs';
import { confusion, cpUpper, RESULTS } from './eval-router1.mjs';
import { fit } from './fit.mjs';
import { detectPrimitives } from '../../../src/need/primitives.mjs';
import { scoreFeatures } from '../../../src/need/router.mjs';
import * as V11 from '../../../src/need/router.mjs';
import * as V1 from './frozen-v1/router.mjs';

const set = loadSet(), dev = set.filter(r => r.split === 'dev'), test = set.filter(r => r.split === 'test');
const haiku = split => new Map(readJsonl(rowsFile('haiku', split)).filter(r => r.ok && (r.sample ?? 0) === 0).map(r => [r.id, r]));
const H = { dev: haiku('dev'), test: haiku('test') };
const r4 = x => Math.round(x * 1e4) / 1e4;

// (a) Haiku p as a slider.
const devNegMax = Math.max(...dev.filter(r => !r.gold.needsWorkflow).map(r => H.dev.get(r.id).p));
const tH = Math.min(1, devNegMax + 0.02);
const evalAt = (items, pred) => { const c = confusion(items.map(r => r.gold.needsWorkflow), items.map(pred)); return { ...c, fpUpper95: cpUpper(c.fp, items.filter(r => !r.gold.needsWorkflow).length) }; };
const a = {
  rule: 'never-trigger on dev: t = max dev-negative Haiku p + 0.02', devNegMaxP: devNegMax, threshold: r4(tH),
  testAtRule: evalAt(test, r => H.test.get(r.id).p >= tH),
  table: [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1].map(t => ({ threshold: t, dev: evalAt(dev, r => H.dev.get(r.id).p >= t), test: evalAt(test, r => H.test.get(r.id).p >= t) }))
};

// (b) Cascade. Out-of-fold dev p for v1.1 (fit.mjs uses the src/need detectors).
const fold = it => parseInt(createHash('sha256').update(`router1-cv:${it.cluster}`).digest('hex').slice(0, 8), 16) % 5;
const oof = new Map();
for (let f = 0; f < 5; f++) {
  const { params } = fit(dev.filter(it => fold(it) !== f));
  for (const it of dev.filter(it => fold(it) === f)) oof.set(it.id, scoreFeatures(detectPrimitives(it.text).features, params));
}
const L = Math.max(0, Math.min(...dev.filter(r => r.gold.needsWorkflow).map(r => oof.get(r.id))) - 0.02);
function cascade(items, router, Lx, hmap) {
  let calls = 0, cost = 0;
  const preds = items.map(r => { const p = router.needCheck(r.text).p; if (p < Lx) return false; calls++; const h = hmap.get(r.id); cost += h.costUsd ?? 0; return h.needsWorkflow; });
  const c = confusion(items.map(r => r.gold.needsWorkflow), preds);
  return { L: r4(Lx), haikuCalls: calls, haikuShare: r4(calls / items.length), costPerDecisionUsd: cost / items.length, ...c, fpUpper95: cpUpper(c.fp, items.filter(r => !r.gold.needsWorkflow).length) };
}
const haikuAlone = (() => { const c = confusion(test.map(r => r.gold.needsWorkflow), test.map(r => H.test.get(r.id).needsWorkflow)); return { ...c, costPerDecisionUsd: test.reduce((s, r) => s + (H.test.get(r.id).costUsd ?? 0), 0) / test.length }; })();
const b = {
  rule: 'L = lowest out-of-fold (5-fold dev CV) router p among dev positives - 0.02 (v1.1 detectors)', L: r4(L),
  devOutOfFoldMinPositiveP: r4(L + 0.02),
  testV11AtRule: cascade(test, V11, L, H.test),
  haikuAloneTest: haikuAlone,
  frontier: [0.02, 0.05, 0.1, 0.15, 0.2, 0.3].map(Lx => ({ L: Lx, v1: cascade(test, V1, Lx, H.test), v11: cascade(test, V11, Lx, H.test) }))
};

const out = { note: 'POST-HOC, not preregistered; rules chosen on dev; designs chosen after the test split was read. Diagnostic only.', a, b };
writeFileSync(path.join(RESULTS, 'posthoc-test.json'), JSON.stringify(out, null, 1) + '\n');
const fmt = c => `FP ${c.fp}/${c.fp + c.tn} (95% upper ${c.fpUpper95 ?? 'n/a'}), recall ${c.recall}, precision ${c.precision}, F1 ${c.f1}`;
const md = ['# ROUTER-1 post-hoc analyses (test split; NOT preregistered; diagnostic only)', '',
  'Written after the preregistered test evaluation was read. Every threshold below is chosen on dev only, but the designs were chosen after seeing the test results, so none of this is held-out evidence.', '',
  '## (a) Haiku percent as the slider score', '', `Never-trigger rule on dev: max dev-negative Haiku p = ${devNegMax}, so t = ${r4(tH)}. On test: ${fmt(a.testAtRule)}.`, '',
  '| Haiku p threshold | dev FP | dev recall | test FP | test recall | test F1 |', '|---|---|---|---|---|---|',
  ...a.table.map(r => `| ${r.threshold} | ${r.dev.fp}/84 | ${r.dev.recall} | ${r.test.fp}/132 | ${r.test.recall} | ${r.test.f1} |`), '',
  '## (b) Cascade: code router clears p < L, Haiku decides the rest', '',
  `Rule (dev): ${b.rule}; L = ${b.L}. On test (v1.1): Haiku asked on ${b.testV11AtRule.haikuCalls}/193 (${b.testV11AtRule.haikuShare}); ${fmt(b.testV11AtRule)}; $${b.testV11AtRule.costPerDecisionUsd.toExponential(2)} per decision. Haiku alone: ${fmt({ ...haikuAlone, fpUpper95: cpUpper(haikuAlone.fp, 132) })}; $${haikuAlone.costPerDecisionUsd.toExponential(2)} per decision.`, '',
  '| L | v1: Haiku share | v1: FP | v1: recall | v1.1: Haiku share | v1.1: FP | v1.1: recall |', '|---|---|---|---|---|---|---|',
  ...b.frontier.map(r => `| ${r.L} | ${r.v1.haikuShare} | ${r.v1.fp} | ${r.v1.recall} | ${r.v11.haikuShare} | ${r.v11.fp} | ${r.v11.recall} |`), ''].join('\n');
writeFileSync(path.join(RESULTS, 'POSTHOC-test.md'), md);
console.log(md);
