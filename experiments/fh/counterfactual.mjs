// FH-1 root-cause tool ($0, analysis only; not part of any arm): apply one exact text edit to a recorded incident program and grade it
// on the practice and grading worlds against the incident's frozen baseline. Used to confirm a root cause by its minimal fix: if the
// one-line edit recovers exactly the cases a heal arm left failing (and regresses none), the edit names the defect.
//   node experiments/fh/counterfactual.mjs <args.json>     args: { incident, file, old, new, out }   (old must occur exactly once)
// Writes <out>/result.json (and <out>/program, the edited copy). Never touches the recorded program or the baseline.
import path from 'node:path';
import { cpSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROOT, GRADING, PRACTICE, gradeSubject, compare, totals, subjectOf } from './grade.mjs';
import { BUILDS } from './baseline.mjs';

export async function counterfactual({ incident, file, old: oldStr, new: newStr, out }) {
  const base = BUILDS[incident];
  if (!base) throw new Error(`unknown incident ${incident}`);
  if (!base.spec.startsWith('program:') && !base.spec.startsWith('solver:')) throw new Error(`unsupported spec ${base.spec}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const composed = base.spec.startsWith('program:');
  const src = path.join(ROOT, base.spec.slice(composed ? 8 : 7));
  const prog = path.join(out, 'program');
  if (composed) cpSync(src, prog, { recursive: true }); else { mkdirSync(prog, { recursive: true }); cpSync(src, path.join(prog, 'solver.mjs')); }
  const f = path.join(prog, file);
  const text = readFileSync(f, 'utf8');
  if (text.split(oldStr).length !== 2) throw new Error(`the old text must occur exactly once in ${file}`);
  writeFileSync(f, text.replace(oldStr, newStr));
  const subj = subjectOf(composed ? `program:${prog}` : `solver:${path.join(prog, 'solver.mjs')}`);
  if (!subj.source || subj.problems.length) throw new Error(`the edited program does not load: ${subj.problems.join('; ')}`);
  const baseline = JSON.parse(readFileSync(path.join(ROOT, 'research/heal-20261021/fh1/baseline', `${incident}.json`), 'utf8'));
  const practice = await gradeSubject(subj, { worlds: PRACTICE, label: `fh-rc-${incident}` });
  const grading = await gradeSubject(subj, { worlds: GRADING, label: `fh-rc-${incident}` });
  const c = compare(baseline.grading, grading, { by: 'oracle' });
  const tally = l => { const o = {}; for (const x of l) o[x.class] = (o[x.class] ?? 0) + 1; return o; };
  const result = { incident, file, old: oldStr, new: newStr, at: new Date().toISOString(),
    practiceBefore: totals(baseline.practice.worlds), practiceAfter: practice.totals, gradingBefore: totals(baseline.grading.worlds), gradingAfter: grading.totals,
    recovered: c.nRecovered, regressed: c.nRegressed, net: c.net, recoveredByClass: tally(c.recovered), regressedByClass: tally(c.regressed) };
  writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 1) + '\n');
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await counterfactual(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 1));
}
