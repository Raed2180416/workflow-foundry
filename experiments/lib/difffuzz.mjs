// A differential-fuzz gate for repair candidates (ATTACK.md Move 8, repair tier T1: "differential agreement of two
// independent proposers on fuzzed inputs"; research/blockers-20261021/MOVE2-COMP.md). Pure functions, no I/O, no model.
//
// A candidate replaces a base program to fix one declared class of behaviour (the justified class). On fuzzed inputs
// labelled in or out of that class, the gate demands:
//   - no crash anywhere (a candidate that throws where the base answered is a defect, whatever the class);
//   - outside the class, the candidate's verdict equals the base's (a disagreement there is spurious: the repair
//     changed behaviour nobody asked to change);
//   - inside the class, the candidate flips the base's verdict to the intended one on every input (a miss is an
//     incomplete fix); at least one such input must exist, or the fuzz did not exercise the repair at all.
// Verdict: reject on any crash, spurious disagreement or miss; inconclusive when the class was never exercised;
// accept otherwise, with the exact one-sided upper bound on the spurious-disagreement rate over the out-of-class
// inputs (they are independent draws of the generator, so the bound is about the generator's distribution, stated as
// such). Candidates are also compared pairwise (independent proposers that agree everywhere add no information; the
// inputs where they disagree localise the defect), and a ddmin shrinker turns a failing input into a minimal one: the
// notice a re-proposal needs.
import { clopperPearson } from './certify.mjs';

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * differentialGate({ ids, inClass, intended, base, candidate, same }) → certificate.
 *   ids        input ids in generator order
 *   inClass    id → true when the input belongs to the justified class
 *   intended   id → the verdict the repair should give inside the class (e.g. true = "ok")
 *   base       id → { verdict } | { crash }
 *   candidate  id → { verdict } | { crash }
 *   same(a, b) verdict equality (default ===)
 */
export function differentialGate({ ids, inClass, intended, base, candidate, same = (a, b) => a === b, level = 0.95, examples = 5 }) {
  const crashes = [], spurious = [], missed = [], flipped = [], baseCrash = [];
  let outN = 0, inN = 0;
  for (const id of ids) {
    const b = base[id], c = candidate[id];
    if (!b || !c) throw new Error(`differentialGate: no output for input ${id}`);
    if (b.crash) { baseCrash.push(id); continue; }               // the base defines nothing here: not scored
    if (c.crash) { crashes.push(id); continue; }
    if (inClass(id)) {
      inN += 1;
      if (same(c.verdict, intended(id))) { if (!same(b.verdict, intended(id))) flipped.push(id); } else missed.push(id);
    } else {
      outN += 1;
      if (!same(c.verdict, b.verdict)) spurious.push(id);
    }
  }
  const reasons = [];
  if (crashes.length) reasons.push(`${crashes.length} crash(es) (first ${crashes.slice(0, examples).join(', ')})`);
  if (spurious.length) reasons.push(`${spurious.length} spurious disagreement(s) outside the justified class`);
  if (missed.length) reasons.push(`${missed.length} justified-class input(s) not given the intended verdict`);
  const verdict = reasons.length ? 'reject' : inN === 0 || flipped.length === 0 ? 'inconclusive' : 'accept';
  if (verdict === 'inconclusive') reasons.push(inN === 0 ? 'no input of the justified class was generated' : 'no justified-class input where the base was wrong: the fuzz did not exercise the repair');
  const ci = outN ? clopperPearson(spurious.length, outN, { level, sides: 1 }) : null;
  return {
    verdict, reasons, inputs: ids.length, outOfClass: outN, inClass: inN, baseCrashes: baseCrash.length,
    crashes: crashes.length, spurious: spurious.length, missed: missed.length, flipped: flipped.length,
    spuriousUpper: ci ? ci.hi : null, level,
    examples: { crashes: crashes.slice(0, examples), spurious: spurious.slice(0, examples), missed: missed.slice(0, examples), flipped: flipped.slice(0, examples) },
  };
}

/** Pairwise disagreement of candidates: { 'a|b': { n, disagree, ids } } (a crash is its own verdict). */
export function pairwise(ids, outputs, { same = (a, b) => a === b, examples = 5 } = {}) {
  const names = Object.keys(outputs).sort();
  const key = o => (o?.crash ? `crash:${String(o.crash).split(':')[0]}` : o?.verdict);
  const out = {};
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const dis = ids.filter(id => { const a = outputs[names[i]][id], b = outputs[names[j]][id]; return (a?.crash || b?.crash) ? key(a) !== key(b) : !same(a?.verdict, b?.verdict); });
      out[`${names[i]}|${names[j]}`] = { n: ids.length, disagree: dis.length, ids: dis.slice(0, examples) };
    }
  }
  return out;
}

/**
 * ddmin(items, fails) → a 1-minimal sublist of `items` for which `fails(sublist)` still holds (Zeller and Hildebrandt's
 * delta debugging). `fails` may be async. `fails(items)` must hold.
 */
export async function ddmin(items, fails, { maxTests = 2000 } = {}) {
  let cur = [...items], n = 2, tests = 0;
  const test = async xs => { tests += 1; if (tests > maxTests) throw new Error('ddmin: test budget exhausted'); return !!(await fails(xs)); };
  if (!(await test(cur))) throw new Error('ddmin: the full input does not fail');
  while (cur.length >= 2) {
    const size = Math.ceil(cur.length / n);
    const chunks = [];
    for (let i = 0; i < cur.length; i += size) chunks.push(cur.slice(i, i + size));
    let reduced = false;
    for (const c of chunks) { if (await test(c)) { cur = c; n = 2; reduced = true; break; } }
    if (!reduced) {
      for (let i = 0; i < chunks.length; i++) {
        const comp = chunks.filter((_, k) => k !== i).flat();
        if (comp.length && (await test(comp))) { cur = comp; n = Math.max(n - 1, 2); reduced = true; break; }
      }
    }
    if (!reduced) {
      if (n >= cur.length) break;
      n = Math.min(cur.length, n * 2);
    }
  }
  return { items: cur, tests };
}

/** Three-valued summary of several candidates' certificates (for reports). */
export const gateTable = certs => Object.entries(certs).map(([name, c]) => ({ candidate: name, verdict: c.verdict, crashes: c.crashes, spurious: c.spurious,
  missed: c.missed, flipped: c.flipped, outOfClass: c.outOfClass, inClass: c.inClass, spuriousUpper: c.spuriousUpper, reasons: c.reasons }));

export { isObj };
