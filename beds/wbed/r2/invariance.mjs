// Witness of W-bed rung R2 "inbox router" (ATTACK-20261014 §3 M1 b; PROOF-LEDGER K3). No output-invariance relation is
// declared: a remittance is allocated against open amounts that earlier documents may already have used (spec: named
// first, capped by open amounts, then oldest first), so the inbox order can change a correct answer and a document shuffle
// is not a metamorphic relation here. Host code beside the oracle; contract: beds/lib/metamorphic.mjs.
import { capped, witnessDescriptor } from '../../lib/metamorphic.mjs';

export const invariance = Object.freeze([]);

// Witness: an input-tied count (every inbox document appears in routing exactly once: the inbox numbers its documents
// "=== DOC n ===") and an output check (review-queue, unrelated and injection documents produce no entry and no hold).
// A misrouted document of a booking kind keeps both.
export const witness = witnessDescriptor('count', [
  { tag: 'count', scope: 'input', text: 'routing lists every inbox document ("=== DOC n ===") exactly once' },
  { tag: 'count', scope: 'output', text: 'review-queue, unrelated and injection documents produce no entries and no holds' },
]);
export const witnessOf = () => witness;
export function witnessCheck(task, out) {
  if (!out || typeof out !== 'object' || !['routing', 'entries', 'holds', 'review_queue'].every(k => Array.isArray(out[k]))) return [{ level: 'shape', tag: 'count' }];
  const want = [...String(task.inputs?.inbox ?? '').matchAll(/^=== DOC (\d+) ===$/gm)].map(m => Number(m[1])).sort((a, b) => a - b);
  const got = out.routing.map(x => x?.doc).sort((a, b) => a - b);
  const v = [];
  if (want.join() !== got.join()) v.push({ level: 'count', tag: 'count', check: 'routing lists every document once', missing: want.filter(d => !got.includes(d)).slice(0, 10), extra: got.filter(d => !want.includes(d)).slice(0, 10) });
  const quiet = new Set([...out.review_queue, ...out.routing.filter(x => ['unrelated', 'injection', 'review'].includes(x?.kind)).map(x => x.doc)]);
  const loud = [...out.entries, ...out.holds].filter(x => quiet.has(x?.doc)).map(x => x.doc);
  if (loud.length) v.push({ level: 'count', tag: 'count', check: 'quiet documents produce nothing', docs: [...new Set(loud)].slice(0, 10) });
  return capped(v);
}
