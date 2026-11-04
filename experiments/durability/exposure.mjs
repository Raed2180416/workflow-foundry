// DUR-1 twins, exposure and attribution (PREREG-DUR-1 §4.2; BUILD-PLAN row 3). $0, oracle side, computed once per world on
// the frozen reference before any arm is judged.
//   twin(W, c)   W with every change in force except c (changes.mjs buildBundle exclude: [c]); twin0(W): no DUR change.
//   exposed(c)   cases whose reference behaviour differs between W and twin(W, c): the committed effects (canonical
//                arguments), the REQUESTS as emitted (arguments under the names current at the time, so an API rename
//                exposes a case even though the effect is the same), and the final expectation (lids and windows); plus
//                cases a fault or document of c touches (F, ADV) and, for F, cases whose reference instance crashed.
//   change-induced failure (arm a, change c, case x): x in exposed(c), x fails in W under a's version timeline, x passes
//                in twin(W, c) under the same timeline (deterministic replay). Base failure: fails in twin0 as well.
// For sealed changes only counts leave this module's printers (`exposureSummary` with redact).
import { indexJournal, caseView, caseIds } from '../../beds/ebed/oracle/view.mjs';
import { canonical } from '../../beds/lib/canonical.mjs';
import { buildBundle } from './changes.mjs';
import { referencePools } from './oracle.mjs';
import { runBundle, referenceVersion } from './arms.mjs';
import { CHANGES } from './schedule.mjs';

/** Per-case behaviour signatures of one journal on one bundle (effects, requests, final expectation). */
export function caseSignatures(bundle, rows) {
  const W = bundle.W;
  const idx = indexJournal(W, rows, { canonicalArgs: bundle.item.canonicalArgs });
  const raw = new Map();
  for (const r of rows) if (r.type === 'effect.emit') raw.set(r.emission, r.effect);
  const out = new Map();
  for (const c of caseIds(W)) {
    const b = idx.bucket(c);
    const effects = b.ledger.filter(r => r.committed).map(r => [r.system, r.op, canonical(r.args)]).sort();
    const requests = b.ledger.map(r => { const e = raw.get(r.emission); return [r.at, r.system, r.op, canonical(e?.args ?? null), r.committed, r.error?.code ?? null]; });
    let expect = null;
    try {
      const E = bundle.item.referenceTransition(W, caseView(idx, c, idx.horizonMs, Infinity));
      expect = E.effects.required.map(e => [e.lid, canonical(e.match), e.window.earliest, e.window.latest]).sort();
    } catch (e) { expect = [`error: ${String(e?.message ?? e).slice(0, 80)}`]; }
    out.set(c, JSON.stringify({ effects, requests, expect }));
  }
  return out;
}

/** Cases (by instance binding) whose instance a fault of the run touched (the F wrapper's crash and restart log). */
export function faultTouchedCases(rows, faults) {
  const bindingOf = new Map(rows.filter(r => r.type === 'instance.open').map(r => [r.instance, r.binding ?? null]));
  const out = new Set();
  for (const f of faults ?? []) if (f.kind === 'crash') { const c = bindingOf.get(f.instance); if (c) out.add(c); }
  return out;
}

/**
 * exposureOf(spec, { sealed, base }) → { world, changes: { [c]: { exposed: Set, floor, meets } }, twins: { [c]: bundle },
 * twin0, bundle }. The reference (earliest) runs on W, on each incremental twin and on twin0 ($0).
 */
export async function exposureOf(spec, { sealed = null, bundle = null } = {}) {
  const B = bundle ?? await buildBundle(spec, { sealed });
  const ref = await referencePools(B, { keepRows: true });
  const sigW = caseSignatures(B, ref.rows.earliest);
  // The F wrapper's own touches on the reference run (crash draws are per instance and tick).
  const refRun = B.wrapArm ? await runBundle(B, { version: referenceVersion({ id: 'reference-earliest', timing: 'earliest' }) }) : null;
  const out = { world: B.key, bundle: B, changes: {}, twins: {} };
  for (const ch of spec.changes) {
    const c = ch.id;
    const T = await buildBundle(spec, { sealed, exclude: [c] });
    const refT = await referencePools(T, { keepRows: true });
    const sigT = caseSignatures(T, refT.rows.earliest);
    const exposed = new Set();
    for (const [x, s] of sigW) if (sigT.get(x) !== s) exposed.add(x);
    for (const x of B.touched?.[c] ?? []) exposed.add(x);
    if (c === 'F' && refRun) for (const x of faultTouchedCases(refRun.rows, refRun.faults)) exposed.add(x);
    // Only completed order cases count towards the floor (the denominators of every rate).
    const completed = [...exposed].filter(x => ref.pools[x] === 'completed' && B.W.truth.cases[x]?.subject);
    const floor = ch.startsHere ? CHANGES[c].floor : null;
    out.changes[c] = { exposed, completed: new Set(completed), floor, meets: floor === null || completed.length >= floor, startsHere: ch.startsHere };
    out.twins[c] = T;
  }
  out.twin0 = await buildBundle(spec, { sealed, base: true });
  return out;
}

/** The cases exposed to ONE change of a world (one twin), e.g. the U1s cases whose complaints use the sealed templates. */
export async function exposedTo(spec, id, { sealed = null, bundle = null } = {}) {
  const B = bundle ?? await buildBundle(spec, { sealed });
  const ref = await referencePools(B, { keepRows: true });
  const T = await buildBundle(spec, { sealed, exclude: [id] });
  const refT = await referencePools(T, { keepRows: true });
  const sW = caseSignatures(B, ref.rows.earliest), sT = caseSignatures(T, refT.rows.earliest);
  return new Set([...sW].filter(([x, s]) => sT.get(x) !== s).map(([x]) => x));
}

/** Counts per change; with redact (sealed changes until unsealing) no case id is included. */
export function exposureSummary(ex, { redact = new Set(Object.keys(CHANGES).filter(c => CHANGES[c].sealed)) } = {}) {
  const out = {};
  for (const [c, e] of Object.entries(ex.changes)) {
    out[c] = { exposed: e.exposed.size, completed: e.completed.size, floor: e.floor, meets: e.meets };
    if (!redact.has(c)) out[c].cases = [...e.completed].sort();
  }
  return out;
}

/**
 * Change-induced and base failures of one arm on one world: grades of the arm's run on W, on each twin and on twin0
 * (each under the same version timeline). Returns { [c]: { induced: Set, exposedFailing: Set }, base: Set }.
 */
export function attribute({ ex, gradeW, gradeTwins, gradeTwin0 }) {
  const failW = new Set(gradeW.cases.filter(c => c.graded && !c.pass).map(c => c.case));
  const out = { changes: {}, base: new Set() };
  for (const [c, e] of Object.entries(ex.changes)) {
    const gT = gradeTwins[c];
    const passT = new Set(gT ? gT.cases.filter(x => x.pass).map(x => x.case) : []);
    const exposedFailing = new Set([...e.completed].filter(x => failW.has(x)));
    out.changes[c] = { exposedFailing, induced: new Set([...exposedFailing].filter(x => passT.has(x))) };
  }
  if (gradeTwin0) { const f0 = new Set(gradeTwin0.cases.filter(x => x.graded && !x.pass).map(x => x.case)); for (const x of failW) if (f0.has(x)) out.base.add(x); }
  return out;
}
