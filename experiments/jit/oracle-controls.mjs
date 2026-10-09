// Oracle controls for a held-out stream (PREREG-stream §1): for every task of a config, by code only, the bed's
// referenceSolve must pass and every bad control must fail. Prints counts and task hashes, never task content, so it
// can run on fresh test seeds without inspecting them. Exit 1 if any control misbehaves.
//   node experiments/jit/oracle-controls.mjs <config.json> [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { makeTasks, loadFamily, score } from '../lib/beds.mjs';

const [file] = process.argv.slice(2), jo = process.argv.indexOf('--json');
if (!file) { console.error('usage: oracle-controls.mjs <config.json> [--json out.json]'); process.exit(2); }
const config = JSON.parse(readFileSync(file, 'utf8'));
const fam = await loadFamily(config.familyId);
const out = { experiment: config.experiment, familyId: config.familyId, familyVersion: fam.family.version, split: config.split, tasks: [], ok: true };
for (const seg of config.segments) {
  for (const t of await makeTasks(config.familyId, { split: config.split, seeds: seg.seeds, difficulty: seg.difficulty })) {
    const ref = await score(config.familyId, t.task, fam.referenceSolve(t.task));
    const bad = [];
    for (const c of fam.badControls) { const v = await score(config.familyId, t.task, c.make(t.task)); bad.push({ name: c.name, pass: !!v.pass }); }
    const ok = ref.pass && bad.every(b => !b.pass);
    if (!ok) out.ok = false;
    out.tasks.push({ taskKey: t.taskKey, taskHash: t.taskHash, referencePass: !!ref.pass, badControlsPassed: bad.filter(b => b.pass).map(b => b.name), ok });
  }
}
const n = out.tasks.length, good = out.tasks.filter(t => t.ok).length;
console.log(`${config.experiment} ${config.familyId}@${fam.family.version} ${config.split}: ${good}/${n} tasks with reference pass and all bad controls failing`);
for (const t of out.tasks.filter(t => !t.ok)) console.log(`  CONTROL FAILURE ${t.taskKey}: reference ${t.referencePass ? 'pass' : 'FAIL'}; bad controls passing: ${t.badControlsPassed.join(', ') || 'none'}`);
if (jo > 0) writeFileSync(process.argv[jo + 1], JSON.stringify(out, null, 1));
process.exit(out.ok ? 0 : 1);
