// Reuse scoring for W-bed R4 (W-BED §3.4 composition test, §5, §6; THESIS-JIT §6.7). The bed makes no calls; a run's
// call log is scored after the fact. A call-log entry is { calleeHash, childId, outcome } with outcome 'ok' | 'refused' |
// 'deopt' (call-host event kinds 'call-end' | 'call-refused' | 'call-deopt' are accepted too), plus optionally
// `refused` (the refusal reason), `output` (the child output the call returned: then the child oracle decides),
// `inputDigest` (sha256 of canonical(input); compared with the pack's own inputs to tell a raw pack from an adapted one).
//
// Per child (subsidiary pack), against a library that maps a rung family to the hashes of its accepted solvers:
//   correct reuse   an in-profile pack served by an 'ok' call to a solver of its own rung (output, when given, passes)
//   wrong reuse     an 'ok' call that is outside the solver's domain or wrong: the planted (outside-profile) pack run
//                   raw, a solver of the other rung, or an output that fails the pack's oracle. Counted per call.
//   missed reuse    an in-profile pack whose call to its own rung's solver was refused (outside-profile false alarm
//                   or another refusal) or deopted, and no 'ok' call followed
//   re-derivation   an in-profile pack never called although the library holds its rung's solver (solved inline)
// Outside-profile packs that were refused or not called are 'refused-correctly' / 'not-called-correctly' (good). An 'ok'
// call on a planted pack whose input differs from the raw pack (an adapter rewrote the dialect) and whose output passes
// the oracle is correct reuse ('adapted'); without an output it cannot be verified and is counted wrong.
import { canonical, sha256 } from '../lib/prng.mjs';
import { childOracle } from './children.mjs';

export const PLACEHOLDER_LIBRARY = Object.freeze({ 'wbed-r1': ['R1_REF_HASH'], 'wbed-r3': ['R3_REF_HASH'] });
const OUTCOME = { 'call-end': 'ok', 'call-refused': 'refused', 'call-deopt': 'deopt', ok: 'ok', refused: 'refused', deopt: 'deopt' };
/** sha256 of the canonical JSON of a pack's inputs: what a call-host event's inputDigest is for a raw pack. */
export const packDigestOf = inputs => sha256(canonical(inputs));

/**
 * @param children [{ sub_id, family, outsideProfile, task, output }] (the hidden truth: output is the pack's reference; index.mjs passes it)
 * @param callLog  entries as above
 * @param opts.library { 'wbed-r1': hash | [hashes], 'wbed-r3': ... } (default: the placeholders of structure.outline)
 */
export function scoreReuseOf(children, callLog, { library = PLACEHOLDER_LIBRARY } = {}) {
  const lib = Object.fromEntries(Object.entries(library).map(([f, h]) => [f, new Set([].concat(h ?? []))]));
  const familyOfHash = h => Object.keys(lib).find(f => lib[f].has(h)) ?? null;
  const ids = new Set(children.map(c => c.sub_id));
  const log = (callLog ?? []).map((e, i) => ({ i, calleeHash: e.calleeHash ?? e.callee ?? null, childId: e.childId ?? null, outcome: OUTCOME[e.outcome ?? e.kind] ?? 'unknown',
    refused: e.refused ?? null, output: e.output, inputDigest: e.inputDigest ?? null }));
  const unattributed = log.filter(e => !ids.has(e.childId)).length;
  const per = [];
  const counts = { correct: 0, wrong: 0, missed: 0, rederived: 0, refusedCorrectly: 0, notCalledCorrectly: 0, deopted: 0, adapted: 0 };
  for (const c of children) {
    const calls = log.filter(e => e.childId === c.sub_id);
    const own = calls.filter(e => familyOfHash(e.calleeHash) === c.family);
    const raw = packDigestOf(c.task.inputs);
    const rec = { sub_id: c.sub_id, family: c.family, outsideProfile: !!c.outsideProfile, calls: calls.length, verdicts: [] };
    let served = false;
    for (const e of calls) {
      if (e.outcome === 'ok') {
        const fam = familyOfHash(e.calleeHash);
        const oracle = e.output === undefined ? null : childOracle(c, e.output).pass;
        const adaptedInput = e.inputDigest && e.inputDigest !== raw;
        let v;
        if (fam !== c.family) v = 'wrong';                                   // another rung's solver, or not a library hash
        else if (oracle === false) v = 'wrong';                               // the oracle says so
        else if (c.outsideProfile) v = adaptedInput && oracle === true ? 'adapted' : 'wrong';
        else v = 'correct';
        rec.verdicts.push({ call: e.i, verdict: v });
        if (v === 'wrong') counts.wrong++;
        if ((v === 'correct' || v === 'adapted') && !served) { served = true; counts[v === 'adapted' ? 'adapted' : 'correct']++; if (v === 'adapted') counts.correct++; }
      } else if (e.outcome === 'deopt') { counts.deopted++; rec.verdicts.push({ call: e.i, verdict: 'deopted' }); }
      else if (e.outcome === 'refused') rec.verdicts.push({ call: e.i, verdict: c.outsideProfile ? 'refused-correctly' : 'refused' });
    }
    if (c.outsideProfile) {
      if (!calls.some(e => e.outcome === 'ok')) {
        if (calls.some(e => e.outcome === 'refused')) { counts.refusedCorrectly++; rec.status = 'refused-correctly'; }
        else { counts.notCalledCorrectly++; rec.status = 'not-called-correctly'; }
      } else rec.status = served ? 'adapted' : 'wrong-reuse';
    } else if (served) rec.status = 'correct-reuse';
    else if (lib[c.family]?.size && own.length) { counts.missed++; rec.status = 'missed-reuse'; }
    else if (lib[c.family]?.size) { counts.rederived++; rec.status = calls.length ? 'rederived (only wrong-rung or failed calls)' : 'rederived'; }
    else rec.status = 'no-library-entry';
    per.push(rec);
  }
  const childCalls = log.filter(e => ids.has(e.childId)).length;
  const wrongReuseRate = childCalls ? counts.wrong / childCalls : 0;
  return { children: per, counts, childCalls, unattributed, wrongReuseRate,
    falsifier: { rule: 'wrong reuse > 5% of child calls (W-BED §3.4, ROADMAP §4.3)', fires: wrongReuseRate > 0.05 } };
}
