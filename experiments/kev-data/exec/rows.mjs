// Helpers shared by the failures-code row builders: wordings, labelled records, paraphrase records, skeleton buckets.
// Every choice is a salted hash of the record key (no Math.random, no clock); held-out wordings reach this code only
// through `opts` (data), never from the held-out directory.
import { labelledQuestion, questionId } from '../lib/render.mjs';
import { optionOrder } from '../lib/balance.mjs';
import { skeleton, skeletonBucket } from '../lib/hash.mjs';
import { hnum, sha, unit } from './util.mjs';

export { hnum, sha, unit };
export const pick = (list, key) => list[hnum(key) % list.length];
export const byHash = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const fail = (code, message) => { const e = new Error(`${code}: ${message}`); e.code = code; return e; };

// the bucket a slice reads (§3.1, §3.3): train-like slices and test-in the train bucket, each OOD slice its own
export const BUCKET_OF_SLICE = Object.freeze({ train: 'train', 'calib-in': 'train', 'dev-select': 'train', 'test-in': 'train', 'calib-ood': 'calib-ood', 'dev-ood': 'dev-ood', 'test-ood': 'test-ood' });
export const bucketAllows = (slice, formHash) => skeletonBucket(formHash) === BUCKET_OF_SLICE[slice];
export const formOf = (text, masks) => skeleton(text, masks);

export function wordingFor(contract, slice, key, opts, taken = []) {
  const port = contract.id, held = (contract.heldoutWordings?.[slice] ?? 0) > 0;
  if (held) {
    const list = (opts.wordings?.[port] ?? []).filter(w => !taken.includes(w.id));
    if (!list.length) throw fail('HELDOUT_WORDINGS_MISSING', `${port} in ${slice} uses the slice's held-out wordings: pass opts.wordings.${port} = [{id, text}] (the assembly reads them from the held-out store; this generator does not)`);
    const w = pick(list, `${key}|wording`);
    return { wording: 'Q0', wordingText: w.text, wordingId: w.id };
  }
  const q = pick(['Q0', 'Q1', 'Q2', 'Q3'], `${key}|wording`);
  return { wording: q, wordingText: undefined, wordingId: q };
}

// one labelled record of one port
export function makeRecord({ contract, slice, opts, key, state, label, slots = {}, options, optionDescriptions, target, meta }) {
  const w = wordingFor(contract, slice, key, opts);
  const names = options ?? Object.keys(contract.options ?? {});
  const q = labelledQuestion(contract, { label, target, wording: w.wording, wordingText: w.wordingText, slots, options, optionDescriptions, optionOrder: optionOrder(names, key) });
  return { state, questions: { [questionId(contract.id)]: q }, meta: { labelSource: 'generator', needsWorldKnowledge: false, wordingId: w.wordingId, ...meta } };
}

// a paraphrase-consistency record (§3.2): the same state asked with Q0 and two held-out wordings of the slice
export function paraphraseOf(rec, contract, opts, key, slots = {}) {
  const port = contract.id, q0 = Object.values(rec.questions)[0], label = q0.label;
  const list = opts.wordings?.[port] ?? [];
  if (list.length < 2) return null;
  const a = pick(list, `${key}|pa`), b = pick(list.filter(w => w.id !== a.id), `${key}|pb`);
  const names = Object.keys(contract.options ?? {}), questions = {};
  questions[questionId(port, 'Q0')] = labelledQuestion(contract, { label, target: q0.target, wording: 'Q0', slots, optionOrder: optionOrder(names, `${key}|Q0`) });
  for (const w of [a, b]) questions[questionId(port, w.id)] = labelledQuestion(contract, { label, target: q0.target, wording: 'Q0', wordingText: w.text, slots, optionOrder: optionOrder(names, `${key}|${w.id}`) });
  return { state: rec.state, questions, meta: { ...rec.meta, variant: 'paraphrase', wordingId: `Q0+${a.id}+${b.id}` } };
}

// deterministic scheduling of an async job list with bounded concurrency; results come back in input order
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}
