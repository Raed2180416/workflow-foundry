// The retroactive sweep on R3' (PROOF-LEDGER F2; LIBRARY §7.5): once a latent defect is confirmed, which other functions
// and which past outputs does it affect? Both questions have exact answers here, because every function runs.
//
//   impactOf(world)        per manifest defect: the callers that inherit it (planted caller differs from the correct
//                          caller on a valid input) and the callers that do not (they call the defective helper only on
//                          inputs where it is right, e.g. whole numbers through a rounding helper)
//   callLogOf(world, { defectId }) a deterministic "production call log" for ONE confirmed defect (default: the first
//                          defective helper): recorded calls (valid arguments and the output the planted code returned)
//                          of the defect, of every caller of it, and of as many clean distractor functions (never a
//                          defect, never a caller of any defective helper) as there are hit functions, at least four.
//                          One log per defect, so a sweep given the log learns nothing about the other defects (review
//                          2026-10-14, finding 6: the v1 log listed every planted defect)
//   scoreImpact(world, r)  r = { impacts: [{ file, function, affected: [{ file, function }] }] }: exact precision / recall
//                          of the affected-caller sets, micro over the defects
//   scoreReplay(world, r)  r = { wrong: [callId] }: exact precision / recall of the recorded outputs that were wrong
//                          (planted output != correct output)
import { taskRng } from '../lib/prng.mjs';
import { sameObs } from './exec.mjs';
import { obsGen } from './world.mjs';
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

export function callLogOf(world, { defectId = null, perFn = 4 } = {}) {
  const m = defectId ? world.manifest.find(x => x.id === defectId) : (world.manifest.find(x => world.byName.get(x.function).kind === 'helper') ?? world.manifest[0]);
  if (!m) throw new Error(`wbed-r3p: no defect ${defectId}`);
  const r = taskRng('r3p', `calllog:${m.id}`, world.spec, world.attempt);
  const target = world.byName.get(m.function);
  const hit = [target, ...world.fns.filter(c => c.calls === target.name)];
  const tainted = f => f.role === 'defect' || (f.kind === 'caller' && world.defectiveHelpers.includes(f.helperFamily));
  const clean = r.sample(world.fns.filter(f => !tainted(f) && !hit.includes(f)), Math.max(4, hit.length));
  const calls = [];
  for (const f of [...hit, ...clean]) {
    const args = r.shuffle(f.probes).slice(0, perFn);
    for (const a of args) {
      const got = obsGen(world.planted, f.name, a), want = obsGen(world.correct, f.name, a);
      calls.push({ id: '', file: f.path, function: f.name, args: a, recorded: got.throws ? { throws: got.throws } : { returns: got.returns }, wrong: !sameObs(got, want) });
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
