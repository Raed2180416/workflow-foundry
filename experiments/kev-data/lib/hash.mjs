// Hashes and skeletons for the Kev data factory (JUDGE-PROGRAM.md §2.3 rule 7, §3.3, §6.0).
//   worldHash(task)   canonical task inputs (prompt, inputs, files), never seed/split/id, so dev and
//                     test worlds that coincide dedup to one hash
//   stateHash(state)  exact canonical state; dedups states across every split and slice
//   spanHash(text)    one rendered span, NFC and whitespace-normalised
//   skeleton(text)    masked surface form (the unit of every CI), hashed
// canonical() is byte-identical to beds/lib/canonical.mjs (the test pins it against the frozen copy).
import { createHash } from 'node:crypto';

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
export const sha256 = data => createHash('sha256').update(data).digest('hex');
export const tagged = hex => `sha256:${hex}`;
export const hashOf = value => tagged(sha256(canonical(value)));

export function worldHash(task) {
  if (!task || typeof task !== 'object') throw new TypeError('worldHash needs a bed task');
  return hashOf({ prompt: task.prompt ?? null, inputs: task.inputs ?? null, files: task.files ?? null });
}
export function stateHash(state) {
  if (state === undefined) throw new TypeError('stateHash needs a state');
  return hashOf(state);
}
export const normalizeSpan = text => String(text).normalize('NFC').replace(/\s+/g, ' ').trim();
export const spanHash = text => tagged(sha256(normalizeSpan(text)));

// ---- Skeletons -------------------------------------------------------------------------------
// skeletonText masks, in this order: quoted strings, {slot} placeholders, the world's own names and
// markers (passed by the caller: system, entity, service and person names; status markers),
// timestamps and dates, hex runs, digit runs; then lowercases and collapses whitespace. The rest is
// the surface form. Placeholders, names and markers all mask to <n>, so a pool line written with
// placeholders ("Treat every {S} balance as ...") has the skeleton of its filled form ("Treat every
// KOBO balance as ...") whenever the filling is a masked name or marker.
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';
const QUOTED = /"[^"\n]{0,400}"|“[^”\n]{0,400}”|„[^“”\n]{0,400}[“”]|«[^»\n]{0,400}»|`[^`\n]{0,400}`/g;
const TIMES = [
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?/g,   // ISO date/time
  /\b\d{1,4}[./-]\d{1,2}[./-]\d{1,4}\b/g,                                                        // numeric dates
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?(?:\\s+\\d{4})?\\b`, 'gi'),         // 14 March 2024
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, 'gi'),        // March 14, 2024
  /\b\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?\b/g,                                                   // clock times
];
const PLACEHOLDER = /\{[A-Za-z_][A-Za-z0-9_]*\}/g;
const HEX = /\b0x[0-9a-f]+\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{6,}\b/gi;
const DIGITS = /\d+(?:[.,]\d+)*/g;
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termRe = terms => {
  const list = [...new Set((terms ?? []).filter(t => typeof t === 'string' && t.trim()))].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  return list.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${list.map(escapeRe).join('|')})(?![\\p{L}\\p{N}_])`, 'gu') : null;
};

export function skeletonText(text, { names = [], markers = [] } = {}) {
  let s = String(text).normalize('NFC').replace(QUOTED, ' <q> ').replace(PLACEHOLDER, ' <n> ');
  const nameRe = termRe(names), markerRe = termRe(markers);
  if (markerRe) s = s.replace(markerRe, ' <n> ');
  if (nameRe) s = s.replace(nameRe, ' <n> ');
  for (const re of TIMES) s = s.replace(re, ' <t> ');
  s = s.replace(HEX, ' <h> ').replace(DIGITS, ' <d> ');
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/ ([.,;:!?)])/g, '$1').replace(/([(]) /g, '$1').trim();
}
export const skeleton = (text, opts) => tagged(sha256(skeletonText(text, opts)));

// Skeleton holdout buckets (§3.3): by hash, 0-20% test-OOD, 20-30% dev-OOD, 30-40% calib-OOD,
// 40-100% train.
export function skeletonPercent(hash) {
  const hex = String(hash).replace(/^sha256:/, '');
  if (!/^[0-9a-f]{8}/.test(hex)) throw new TypeError('skeletonPercent needs a sha256 hash');
  return (parseInt(hex.slice(0, 8), 16) / 0x100000000) * 100;
}
export function skeletonBucket(hash) {
  const p = skeletonPercent(hash);
  return p < 20 ? 'test-ood' : p < 30 ? 'dev-ood' : p < 40 ? 'calib-ood' : 'train';
}

// Sentences of a text: split after . ! ? (followed by whitespace) and at line breaks. Used by the
// span registry and the counterfactual re-render, which both work one sentence at a time.
export function sentences(text) {
  return String(text).split(/\n+/).flatMap(line => line.split(/(?<=[.!?]["”')\]]?)\s+(?=\S)/)).map(s => s.trim()).filter(Boolean);
}

// The id of an exported record: a hash of everything in it, so a rebuild reproduces it and two
// different records never share it.
export const recordId = record => `kd_${sha256(canonical({ state: record.state, questions: record.questions, meta: record.meta })).slice(0, 24)}`;
