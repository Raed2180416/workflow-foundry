// The person's own words, as the tracker keeps them: every turn they wrote (the request, each answer, each later edit), in order.
// Everything the tracker records points INTO these words: a condition's quote must locate verbatim (case and spacing ignored), and a
// literal a check uses (an address, an amount, a channel) must appear in them or in the vocabulary of their own data. Nothing here
// calls a model.
import { normText } from './checks.mjs';

/** words: [{ turn, kind: 'request'|'answer'|'edit', text, question? }]. Accepts a request string plus answers { id: text }. */
export function wordsOf({ request, answers = {}, edits = [] }) {
  const out = [];
  if (typeof request === 'string' && request.trim()) out.push({ turn: 0, kind: 'request', text: request });
  for (const [id, text] of Object.entries(answers ?? {})) if (typeof text === 'string' && text.trim()) out.push({ turn: out.length, kind: 'answer', question: id, text });
  for (const text of edits) if (typeof text === 'string' && text.trim()) out.push({ turn: out.length, kind: 'edit', text });
  return out;
}

// Whitespace-collapsed, lower-cased index with a map back to the original offsets.
function index(text) {
  let norm = ''; const map = []; let space = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/\s/.test(c)) { space = norm.length > 0; continue; }
    if (space) { norm += ' '; map.push(i); space = false; }
    norm += c.toLowerCase(); map.push(i);
  }
  return { norm, map };
}
const collapse = q => String(q ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Locate a quote verbatim (case and spacing ignored) in the person's words: { turn, start, end, text } or null. First turn wins. */
export function locate(words, quote) {
  const q = collapse(quote);
  if (q.length < 2) return null;
  for (const w of words) {
    const { norm, map } = index(w.text);
    const at = norm.indexOf(q);
    if (at < 0) continue;
    const start = map[at], end = map[at + q.length - 1] + 1;
    return { turn: w.turn, kind: w.kind, start, end, text: w.text.slice(start, end) };
  }
  return null;
}

/**
 * Units: the clauses of each turn. A turn is split at sentence ends (. ! ? followed by space or end, never inside an address),
 * semicolons, new lines, and commas that start a new clause (a comma followed by a word, not a digit). A one-word unit ("thx") is
 * merged into the previous unit of the same turn. This is the $0 capture rule's segmentation.
 */
export function unitsOf(words) {
  const units = [];
  for (const w of words) {
    const t = w.text;
    const cuts = [0];
    for (let i = 0; i < t.length; i++) {
      const c = t[i], next = t[i + 1] ?? '';
      if ((c === '.' || c === '!' || c === '?') && (next === '' || /\s/.test(next))) cuts.push(i + 1);
      else if (c === ';' || c === '\n') cuts.push(i + 1);
      else if (c === ',' && /\s/.test(next) && /[a-z(]/i.test(t[i + 2] ?? '')) cuts.push(i + 1);
    }
    cuts.push(t.length);
    let prev = null;
    for (let k = 0; k < cuts.length - 1; k++) {
      let s = cuts[k], e = cuts[k + 1];
      while (s < e && /[\s,;.!?]/.test(t[s])) s++;
      while (e > s && /[\s,;]/.test(t[e - 1])) e--;
      if (e <= s) continue;
      const text = t.slice(s, e);
      const sentenceEnd = /[.!?]$/.test(t.slice(cuts[k], cuts[k + 1]).trim());
      const last = units.at(-1);
      if (text.split(/\s+/).length < 2 && last && last.turn === w.turn) { last.end = e; last.text = t.slice(last.start, e); continue; }
      prev = { id: `u${units.length + 1}`, turn: w.turn, kind: w.kind, start: s, end: e, text };
      units.push(prev);
      if (sentenceEnd) prev = null;
    }
  }
  return units;
}

const NUMBER_WORDS = { zero: 0, one: 1, once: 1, single: 1, two: 2, twice: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20, thirty: 30 };
/** Every number the person wrote (digits, including "200", "2-3", "500+", "24h", "$50"; and number words such as "ONE"). */
export function numbersIn(words) {
  const out = new Set();
  for (const w of words) {
    for (const m of w.text.matchAll(/\d+(?:[.,]\d+)?/g)) out.add(Number(m[0].replace(',', '.')));
    for (const m of w.text.toLowerCase().matchAll(/[a-z]+/g)) if (Object.hasOwn(NUMBER_WORDS, m[0])) out.add(NUMBER_WORDS[m[0]]);
  }
  return out;
}

/** A literal is grounded when the person wrote it (as words, case, spacing and punctuation ignored). */
export function grounded(words, literal) {
  const n = normText(literal);
  if (!n) return false;
  return words.some(w => ` ${normText(w.text)} `.includes(` ${n} `));
}
