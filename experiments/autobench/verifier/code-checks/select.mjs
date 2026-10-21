// code-checks selector: pick one world among k candidate runs of the same request.
//
// Order of preference (all deterministic):
//   1. the highest verifier score (fewest / lightest failed checks);
//   2. optional consensus tie-break: the candidate whose effects agree most with the other candidates' effects
//      (mean Jaccard similarity of effect atoms: who was messaged, which records changed to what, which records were
//      created, which numbers each recipient was told). A generic self-consistency rule; it reads only the diffs;
//   3. the caller's fixed fork order (the prior: the strongest pipeline first).
import { collectOutputs, namesOf } from './checks.mjs';
import { lower, numbersIn, stripHtml } from './lib.mjs';

/** The set of effect atoms of a diff. */
export function effectAtoms(diff) {
  const out = collectOutputs(diff);
  const atoms = new Set();
  for (const m of out.messages) {
    if (m.draft) continue;
    const who = m.kind === 'email' ? [...new Set(m.recipients)].sort().join(',') : m.kind === 'chat' ? `#${m.channel}` : `${m.key}:${m.id}`;
    atoms.add(`msg|${m.kind}|${who}`);
    for (const n of numbersIn(stripHtml(m.text))) if (Math.abs(n.value) >= 10) atoms.add(`num|${who}|${Math.round(n.value * 100) / 100}`);
  }
  for (const u of out.updated) for (const [p, [, after]] of Object.entries(u.fields)) {
    if (after === null || typeof after !== 'object') atoms.add(`upd|${u.key}|${u.id}|${p}=${lower(String(after)).slice(0, 80)}`);
    else atoms.add(`upd|${u.key}|${u.id}|${p}`);
  }
  for (const c of out.created) {
    if (c.app === 'gmail' || (c.app === 'slack' && c.coll === 'messages')) continue;
    const names = namesOf(c.coll.startsWith('actions.') ? (c.record.params ?? {}) : c.record).map(lower).sort();
    atoms.add(`new|${c.key}|${names.join('|').slice(0, 120)}`);
  }
  for (const d of out.deleted) atoms.add(`del|${d.key}|${d.id}`);
  return atoms;
}

const jaccard = (a, b) => { if (!a.size && !b.size) return 1; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };

/** Consensus of each candidate: mean similarity of its atoms to the other candidates' atoms. */
export function consensusScores(atomSets) {
  return atomSets.map((a, i) => {
    const others = atomSets.filter((_, j) => j !== i);
    return others.length ? others.reduce((s, b) => s + jaccard(a, b), 0) / others.length : 0;
  });
}

/** Pick a candidate. cands: [{score, atoms, order}]; tiebreak: 'order' | 'consensus'. Returns the chosen index. */
export function pick(cands, { tiebreak = 'order', eps = 1e-9 } = {}) {
  const cons = tiebreak === 'consensus' ? consensusScores(cands.map(c => c.atoms)) : cands.map(() => 0);
  const idx = cands.map((_, i) => i);
  idx.sort((i, j) => (cands[j].score - cands[i].score > eps ? 1 : cands[i].score - cands[j].score > eps ? -1 : 0)
    || (cons[j] - cons[i] > eps ? 1 : cons[i] - cons[j] > eps ? -1 : 0) || (cands[i].order - cands[j].order));
  return idx[0];
}
