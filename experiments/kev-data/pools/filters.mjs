// train-pools: deterministic local filters. They replace nothing the program requires of the
// two-model filter (§2.3 rule 1: Sonnet 5.5 and Opus 5.5 must both recover the brief's label); they
// catch the defects a script can catch before any model is asked: slots, shape, copies, near
// duplicates, skeleton collisions, the train skeleton bucket, window hygiene.
import { sentences } from '../lib/hash.mjs';
import { PLACEHOLDER_RE, SYSTEMS } from './templates.mjs';

// ---- addressee words (the crit-S Q14 regex, JUDGE-CRITIQUE-shortcuts.md Q14) --------------------
// The critique names "AI, AUTOMATED, ASSISTANT, SYSTEM:, bot, override, …" and does not print the
// regex. This is the list used here and recorded in the manifest, so heldout-author and shortcut-audit
// can adopt or replace it explicitly (specGap). "AI" is case sensitive (an English word "ai" is rare
// but "Ai" is a name); the other words are not.
export const ADDRESSEE_WORDS = Object.freeze(['AI', 'LLM', 'automated', 'automation', 'assistant', 'assistants', 'agent', 'agents', 'bot', 'bots', 'chatbot', 'chatbots',
  'override', 'overrides', 'overrode', 'overridden', 'overriding', 'SYSTEM:']);
const CASE_FREE = new RegExp(`(?<![\\p{L}\\p{N}_])(?:llm|automated|automation|assistants?|agents?|bots?|chatbots?|overrid(?:e|es|den|ing)|overrode)(?![\\p{L}\\p{N}_])`, 'iu');
const AI_RE = /(?<![\p{L}\p{N}_])AI(?![\p{L}\p{N}_])/u;
const SYSTEM_COLON = /(?<![\p{L}\p{N}_])SYSTEM\s*:/i;
export const ADDRESSEE_REGEX_SOURCE = `${AI_RE.source} | ${CASE_FREE.source} (flags iu) | ${SYSTEM_COLON.source} (flags i)`;
export function hasAddressee(text) {
  const t = String(text).replace(PLACEHOLDER_RE, ' ');
  return AI_RE.test(t) || CASE_FREE.test(t) || SYSTEM_COLON.test(t);
}

// ---- date windows (R4) --------------------------------------------------------------------------
// A line is windowed when it carries the mirror window slots ({w0} and {w1}). A line without them
// must not smuggle a window in as literal dates (two or more date-like tokens).
const MONTH_RE = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)';
const DATE_LIKE = [
  /\b\d{4}-\d{2}-\d{2}\b/g, /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g,
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_RE}\\b(?:,?\\s+(?:19|20)\\d{2}\\b)?`, 'gi'), new RegExp(`\\b${MONTH_RE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+(?:19|20)\\d{2}\\b)?`, 'gi'),
  new RegExp(`\\b${MONTH_RE}\\s+(?:19|20)\\d{2}\\b`, 'gi'), /\bQ[1-4]\s*(?:19|20)\d{2}\b/g, /\b(?:19|20)\d{2}\b/g,
];
export function literalDates(text) {
  let n = 0; let t = String(text);
  for (const re of DATE_LIKE) { t = t.replace(re, () => { n++; return ' '; }); }
  return n;
}
export function windowSlots(text) { const s = new Set([...String(text).matchAll(PLACEHOLDER_RE)].map(m => m[1])); return { w0: s.has('w0'), w1: s.has('w1') }; }
export const isWindowed = text => { const w = windowSlots(text); return w.w0 && w.w1; };

// ---- similarity ---------------------------------------------------------------------------------
const words = text => String(text).normalize('NFC').toLowerCase().replace(PLACEHOLDER_RE, (_, n) => ` §${n} `).replace(/[^\p{L}\p{N}§_'\- ]+/gu, ' ').split(/\s+/).filter(Boolean);
export function grams(text, n = 4) {
  const w = words(text);
  if (w.length <= n) return new Set([w.join(' ')]);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}
export function jaccardSets(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
export const jaccard4 = (a, b) => jaccardSets(grams(a, 4), grams(b, 4));
export const jaccard1 = (a, b) => jaccardSets(new Set(words(a)), new Set(words(b)));
// max 4-gram Jaccard of `text` against a list of strings
export function maxJaccard4(text, others) {
  const g = grams(text, 4); let best = 0, at = null;
  for (const o of others) { const j = jaccardSets(g, o.grams ?? grams(o.text ?? o, 4)); if (j > best) { best = j; at = o; } }
  return { score: best, at };
}
export const prepGrams = list => list.map(x => (typeof x === 'string' ? { text: x, grams: grams(x, 4) } : { ...x, grams: grams(x.text, 4) }));

// ---- shape --------------------------------------------------------------------------------------
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/;
export function shapeProblems(text, { maxSentences = 1, minChars = 12, maxChars = 480, requireTerminal = true } = {}) {
  const out = [], t = String(text);
  if (typeof text !== 'string' || !t.trim()) return ['empty'];
  if (t !== t.normalize('NFC')) out.push('not-nfc');
  if (CONTROL.test(t) || /\n/.test(t)) out.push('control-or-newline');
  if (t !== t.trim() || /\s{2,}/.test(t)) out.push('whitespace');
  if (t.length < minChars) out.push('too-short'); if (t.length > maxChars) out.push('too-long');
  if (/<<|>>|\|/.test(t)) out.push('dsl-leftover');
  if (/\be\.g\.|\bi\.e\.|\betc\./i.test(t)) out.push('abbreviation-splits-sentence');
  if (requireTerminal && !/[.!?"”')\]]$/.test(t)) out.push('no-terminal-punctuation');
  const open = (t.match(/\{/g) ?? []).length, close = (t.match(/\}/g) ?? []).length;
  if (open !== close) out.push('unbalanced-braces');
  const n = sentences(t.replace(PLACEHOLDER_RE, 'X')).length;
  if (n > maxSentences) out.push(`sentences:${n}>${maxSentences}`);
  return out;
}
export function literalSystemNames(text, names = SYSTEMS) {
  return names.filter(n => new RegExp(`(?<![\\p{L}\\p{N}_])${n}(?![\\p{L}\\p{N}_])`, 'u').test(String(text)));
}
// Strings of a bed source file (single, double and backtick quoted literals of 24+ characters), the
// reference for "this line is not a copy of a bed sentence" (X1 and counterfactual lines).
export function sourceStrings(source, { min = 24 } = {}) {
  const out = new Set();
  for (const m of String(source).matchAll(/'((?:[^'\\\n]|\\.){24,})'|"((?:[^"\\\n]|\\.){24,})"|`((?:[^`\\]|\\.){24,})`/g)) {
    const s = (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, ' ').replace(/\\(['"`nrt\\])/g, '$1').trim();
    if (s.length >= min && /[A-Za-z]{3}/.test(s)) out.add(s);
  }
  return [...out];
}
