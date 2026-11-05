#!/usr/bin/env node
// The decision rules of PREREG-TRACKER-H §5 (H1-H6), applied mechanically to heldout/scores.json (`run-heldout.mjs score`). No model
// call, no threshold of its own: every number below is the frozen rule's. Written after the freeze and before reading any held-out
// score; it only reads what the frozen score step wrote. It lives outside heldout/ because the freeze lists every file there.
//
//   node experiments/tracker-v2/decide-h.mjs [--scores FILE] [--json OUT]
//
// Rules, per Haiku capture sample s in {s0, s1, s2} (judge files judge-<sem>-claude-haiku-5-5-<s>__claude-haiku-5-5.json):
//   H1 T2solo-v3 precision >= 0.95      (no build flagged: precision undefined, the rule is not met)
//   H2 T2solo-v3 false alarms == 0
//   H3 (T0+T2solo-v3 caught) - (T0 caught) >= 10
//   H4 T2solo-v3 precision >= T1 precision and T2solo-v3 false alarms <= T1 false alarms (T1 = prose on capture s0, the only T1 run)
//   H5 Haiku capture recall (capture-claude-haiku-5-5-<s>.json) >= 0.90
//   H6 T2solo false alarms under v3 <= under v1, on the same binding
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export const SAMPLES = Object.freeze(['s0', 's1', 's2']);
const MODEL = 'claude-haiku-5-5';
const judgeOf = (sem, s) => `judge-${sem}-${MODEL}-${s}__${MODEL}.json`;
export const PROSE_FILE = `prose-${MODEL}-s0__${MODEL}.json`;

/** H1-H6 per sample, all-builds and model-built views. Returns { rules: { H1: { s0: {pass, ...} ... , all }, ... }, table }. */
export function decide(scores) {
  const arms = scores.arms ?? {};
  const t1 = arms[PROSE_FILE]?.T1 ?? null;
  const t1m = arms[PROSE_FILE]?.T1modelBuilt ?? null;
  const out = { H1: {}, H2: {}, H3: {}, H4: {}, H5: {}, H6: {} };
  const table = [];
  for (const s of SAMPLES) {
    const v3 = arms[judgeOf('v3', s)], v1 = arms[judgeOf('v1', s)];
    const cap = scores.recall?.[`capture-${MODEL}-${s}.json`] ?? null;
    if (!v3) { for (const h of Object.keys(out)) out[h][s] = { pass: false, missing: judgeOf('v3', s) }; continue; }
    const solo = v3.T2solo, t0 = v3.T0, both = v3['T0+T2solo'];
    out.H1[s] = { pass: solo.precision !== null && solo.precision >= 0.95, precision: solo.precision, flagged: solo.caught + solo.falseAlarms };
    out.H2[s] = { pass: solo.falseAlarms === 0, falseAlarms: solo.falseAlarms, ids: solo.falseAlarmIds };
    out.H3[s] = { pass: both.caught - t0.caught >= 10, added: both.caught - t0.caught, t0: t0.caught, t0PlusT2solo: both.caught, defective: t0.defective };
    out.H4[s] = t1 ? { pass: solo.precision !== null && t1.precision !== null && solo.precision >= t1.precision && solo.falseAlarms <= t1.falseAlarms,
      t2soloPrecision: solo.precision, t1Precision: t1.precision, t2soloFalseAlarms: solo.falseAlarms, t1FalseAlarms: t1.falseAlarms } : { pass: false, missing: PROSE_FILE };
    out.H5[s] = cap ? { pass: cap.recall >= 0.9, recall: cap.recall, covered: cap.covered, total: cap.total } : { pass: false, missing: `capture-${MODEL}-${s}.json` };
    out.H6[s] = v1 ? { pass: solo.falseAlarms <= v1.T2solo.falseAlarms, v3: solo.falseAlarms, v1: v1.T2solo.falseAlarms } : { pass: false, missing: judgeOf('v1', s) };
    for (const [sem, a] of [['v1', v1], ['v2', arms[judgeOf('v2', s)]], ['v3', v3]]) {
      if (!a) continue;
      for (const view of ['T0', 'T2solo', 'T0+T2solo', 'T2', 'T2noG3', 'T0+T2', 'T2soloModelBuilt', 'T2modelBuilt']) {
        const x = a[view];
        if (x) table.push({ sample: s, semantics: sem, arm: view, builds: x.builds, defective: x.defective, caught: x.caught, falseAlarms: x.falseAlarms, precision: x.precision });
      }
    }
  }
  if (t1) table.push({ sample: 's0', semantics: '-', arm: 'T1', builds: t1.builds, defective: t1.defective, caught: t1.caught, falseAlarms: t1.falseAlarms, precision: t1.precision });
  if (t1m) table.push({ sample: 's0', semantics: '-', arm: 'T1modelBuilt', builds: t1m.builds, defective: t1m.defective, caught: t1m.caught, falseAlarms: t1m.falseAlarms, precision: t1m.precision });
  for (const h of Object.keys(out)) out[h].all = SAMPLES.every(s => out[h][s]?.pass === true);
  return { rules: out, table };
}

async function main() {
  const { values: a } = parseArgs({ options: { scores: { type: 'string' }, json: { type: 'string' } } });
  const file = path.resolve(a.scores ?? 'research/tracker-20261021/heldout/scores.json');
  const r = decide(JSON.parse(readFileSync(file, 'utf8')));
  const f3 = x => (x === null || x === undefined ? '-' : Number(x).toFixed(3));
  for (const t of r.table) console.log(`${t.sample} ${t.semantics.padEnd(2)} ${t.arm.padEnd(16)} builds ${String(t.builds).padStart(3)} defective ${String(t.defective).padStart(3)} caught ${String(t.caught).padStart(3)} FA ${String(t.falseAlarms).padStart(3)} precision ${f3(t.precision)}`);
  for (const [h, v] of Object.entries(r.rules)) console.log(`${h} ${v.all ? 'MET' : 'NOT MET'}  ${SAMPLES.map(s => `${s}:${v[s]?.pass ? 'pass' : 'fail'} ${JSON.stringify(Object.fromEntries(Object.entries(v[s] ?? {}).filter(([k]) => k !== 'pass' && k !== 'ids')))}`).join('  ')}`);
  if (a.json) writeFileSync(path.resolve(a.json), `${JSON.stringify(r, null, 1)}\n`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
