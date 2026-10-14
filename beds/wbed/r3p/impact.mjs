// The retroactive sweep on R3' (PROOF-LEDGER F2; LIBRARY §7.5): once a latent defect is confirmed, which other functions
// and which past outputs does it affect? Both questions have exact answers here, because every function runs.
//
//   impactOf(world)        per manifest defect: the callers that inherit it (planted caller differs from the correct
//                          caller on a valid input) and the callers that do not (they call the defective helper only on
//                          inputs where it is right, e.g. whole numbers through a rounding helper)
//   callLogOf(world)       a deterministic "production call log": for every defect and every caller of a defective
//                          helper, recorded calls (valid arguments and the output the planted code returned), plus
//                          calls of clean functions as distractors
//   scoreImpact(world, r)  r = { impacts: [{ file, function, affected: [{ file, function }] }] }: exact precision / recall
//                          of the affected-caller sets, micro over the defects
//   scoreReplay(world, r)  r = { wrong: [callId] }: exact precision / recall of the recorded outputs that were wrong
//                          (planted output != correct output)
import { taskRng } from '../lib/prng.mjs';
import { observe, sameObs } from './exec.mjs';
import { normFile } from './score.mjs';

const loc = (file, fn) => `${normFile(file)}#${String(fn).trim()}`;

export function impactOf(world) {
  return world.manifest.map(m => {
    const f = world.byName.get(m.function);
    const callers = f.kind === 'helper' ? world.fns.filter(c => c.calls === f.name) : [];
    return { id: m.id, file: m.file, function: m.function, class: m.class,
      affected: callers.filter(c => c.affected).map(c => ({ file: c.path, function: c.name })),
      unaffected: callers.filter(c => !c.affected).map(c => ({ file: c.path, function: c.name })) };
  });
}

export function callLogOf(world, perFn = 4) {
  const r = taskRng('r3p', 'calllog', world.spec, world.attempt);
  const hit = world.fns.filter(f => f.role === 'defect' || (f.kind === 'caller' && world.defectiveHelpers.includes(f.helperFamily)));
  const clean = r.sample(world.fns.filter(f => f.role !== 'defect' && !hit.includes(f)), Math.max(4, Math.round(hit.length / 2)));
  const calls = [];
  for (const f of [...hit, ...clean]) {
    const args = r.shuffle(f.probes).slice(0, perFn);
    for (const a of args) {
      const got = observe(world.planted, f.name, a), want = observe(world.correct, f.name, a);
      calls.push({ id: `c${String(calls.length + 1).padStart(4, '0')}`, file: f.path, function: f.name, args: a,
        recorded: got.throws ? { throws: got.throws } : { returns: got.returns }, wrong: !sameObs(got, want) });
    }
  }
  return r.shuffle(calls).map((c, i) => ({ ...c, id: `c${String(i + 1).padStart(4, '0')}` }));
}

const prf = (tp, fp, fn) => { const p = tp + fp ? tp / (tp + fp) : null, rc = tp + fn ? tp / (tp + fn) : null; return { tp, fp, fn, precision: p, recall: rc, f1: p && rc ? (2 * p * rc) / (p + rc) : 0 }; };

export function scoreImpact(world, report) {
  const truth = new Map(impactOf(world).map(x => [loc(x.file, x.function), new Set(x.affected.map(a => loc(a.file, a.function)))]));
  let tp = 0, fp = 0, fn = 0;
  const seen = new Set();
  for (const x of report?.impacts ?? []) {
    const k = loc(x.file, x.function);
    const want = truth.get(k) ?? new Set();
    seen.add(k);
    const got = new Set((x.affected ?? []).map(a => loc(a.file, a.function)));
    for (const g of got) if (want.has(g)) tp++; else fp++;
    for (const w of want) if (!got.has(w)) fn++;
  }
  for (const [k, want] of truth) if (!seen.has(k)) fn += want.size;
  return prf(tp, fp, fn);
}

export function scoreReplay(world, log, report) {
  const wrong = new Set(log.filter(c => c.wrong).map(c => c.id));
  const got = new Set(report?.wrong ?? []);
  let tp = 0, fp = 0;
  for (const id of got) if (wrong.has(id)) tp++; else fp++;
  return prf(tp, fp, [...wrong].filter(id => !got.has(id)).length);
}
