#!/usr/bin/env node
// WorkBench generator seed-control gate ($0; PLAN §4.3 T1-1 "Gates still to do", split.mjs H2-ext rule).
//   1. seed 42 (the seed of src/cli.py generate_data) reproduces the shipped task CSVs byte for byte, twice;
//   2. the breadth seed (8850) gives byte-identical output twice;
//   3. regeneration changes the answers: per regenerated instance, "answer-changed" = its gold action list equals no
//      shipped gold list of its template; "text-new" = its task text equals no shipped task text of its template.
// Regenerated instances stay host-only (HOST_ONLY/regen); the committed record holds hashes and counts only.
//   node experiments/breadth/workbench/regen-gate.mjs [--out research/breadth-20261021/workbench/REGEN-GATE.json]
import path from 'node:path';
import { HOST_ONLY, RESEARCH, bedJson, readJsonl, sha256, shippedTasks, writeJson } from './lib.mjs';
import { SPLIT_RULE } from './split.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const out = opt('out', path.join(RESEARCH, 'REGEN-GATE.json'));
const dir = path.join(HOST_ONLY, 'regen');

export async function regen(seed, tag) {
  const file = path.join(dir, `seed${seed}-${tag}.jsonl`);
  const [r] = await bedJson(['regen', '--seed', String(seed), '--per-template', '10', '--out', file], { cwd: dir });
  return { seed, file, csvSha256: r.csv_sha256, identicalToShipped: r.identical_to_shipped_csv, n: r.n, rowsSha256: sha256(readJsonl(file).map(x => JSON.stringify([x.id, x.task, x.outcome])).join('\n')) };
}

/** Answer-change statistics of regenerated rows against the shipped rows (by template). */
export function answerChange(regenRows, shipped) {
  const golds = new Map(), texts = new Map();
  for (const t of shipped) {
    if (!golds.has(t.template_id)) { golds.set(t.template_id, new Set()); texts.set(t.template_id, new Set()); }
    golds.get(t.template_id).add(JSON.stringify(t.outcome)); texts.get(t.template_id).add(t.task);
  }
  const perTemplate = {};
  let changed = 0, textNew = 0, unknownTemplate = 0;
  for (const r of regenRows) {
    const g = golds.get(r.template_id);
    if (!g) { unknownTemplate++; continue; }
    const c = !g.has(JSON.stringify(r.outcome)), tn = !texts.get(r.template_id).has(r.task);
    changed += c; textNew += tn;
    const p = (perTemplate[r.template_id] ??= { n: 0, answerChanged: 0, textNew: 0 });
    p.n++; p.answerChanged += c; p.textNew += tn;
  }
  return { n: regenRows.length, answerChanged: changed, textNew, unknownTemplate, perTemplate };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now();
  const shipped = await shippedTasks({ cwd: dir });
  const a42 = await regen(42, 'a'), b42 = await regen(42, 'b');
  const seed = SPLIT_RULE.sealed.seed;
  const aS = await regen(seed, 'a'), bS = await regen(seed, 'b');
  const ac = answerChange(readJsonl(aS.file), shipped);
  const zeroTemplates = Object.entries(ac.perTemplate).filter(([, p]) => p.answerChanged === 0).map(([id]) => id).sort();
  const res = {
    gate: 'WorkBench generator seed control (wb-split-v1 H2-ext precondition)', at: new Date().toISOString(), ms: Date.now() - t0,
    command: 'bed.py regen: the six scripts/data_generation/task_outcome_generation modules in src/cli.py generate_data order, np.random.seed(seed) and random.seed(seed) per module, 10 per template, shipped sandbox databases unchanged',
    seed42: { reproducesShippedCsvs: Object.values(a42.identicalToShipped).every(Boolean) && Object.values(b42.identicalToShipped).every(Boolean), perDomain: a42.identicalToShipped,
      twiceIdentical: JSON.stringify(a42.csvSha256) === JSON.stringify(b42.csvSha256), csvSha256: a42.csvSha256 },
    breadthSeed: { seed, twiceIdentical: JSON.stringify(aS.csvSha256) === JSON.stringify(bS.csvSha256) && aS.rowsSha256 === bS.rowsSha256, csvSha256: aS.csvSha256, rowsSha256: aS.rowsSha256,
      identicalToShipped: aS.identicalToShipped, n: aS.n,
      answerChanged: ac.answerChanged, textNew: ac.textNew, answerChangedShare: Math.round((ac.answerChanged / ac.n) * 1000) / 1000, unknownTemplate: ac.unknownTemplate,
      templatesWithNoChangedAnswer: zeroTemplates, templatesWithFewerThan3Changed: Object.entries(ac.perTemplate).filter(([, p]) => p.answerChanged < 3).map(([id, p]) => `${id}:${p.answerChanged}`).sort() },
  };
  res.seedControlVerified = res.seed42.reproducesShippedCsvs && res.seed42.twiceIdentical && res.breadthSeed.twiceIdentical;
  writeJson(out, res);
  console.log(JSON.stringify({ seedControlVerified: res.seedControlVerified, seed42: res.seed42.reproducesShippedCsvs, twice42: res.seed42.twiceIdentical, twiceBreadth: res.breadthSeed.twiceIdentical,
    answerChanged: `${ac.answerChanged}/${ac.n}`, textNew: `${ac.textNew}/${ac.n}`, templatesWithNoChangedAnswer: zeroTemplates.length }, null, 1));
}
