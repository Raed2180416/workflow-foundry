// Requirement tracker, the ledger (TRACKER-DESIGN.md §1): one entry per condition the user stated, each quoting the
// user's verbatim span. Everything here is mechanical ($0): locating a quote in the user's text (a quote that does not
// locate is dropped and counted, so an entry cannot be invented), the coverage list (normative sentences no quote
// overlaps), merging duplicates, and the user's edits (confirm, edit, delete, add), each logged. Statuses are per build
// and live in the per-build copy of the ledger written by run.mjs.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';

export const LEDGER_VERSION = '1';
const sha256 = s => createHash('sha256').update(s).digest('hex');

/** Requirement kinds and the property skeleton each maps to (§1 table). */
export const KINDS = Object.freeze({
  must: 'for each trigger: there exists a matching effect',
  never: 'for each candidate effect (emitted or refused): it is not of the forbidden shape',
  'when-then': 'for each trigger event or result: the required effect follows, and no forbidden effect comes first',
  deadline: 'when-then with a window [anchor+lo, anchor+hi] and explicit inclusive/exclusive bounds',
  order: 'for each object with both A and B: A is emitted (or commits) before B',
});
export const KIND_NAMES = Object.freeze(Object.keys(KINDS));

/** Normative cues for the coverage list (§1 "Mechanical checks" 2). */
export const CUES = /\b(must|never|only|within|at most|exactly once|if|when|before|after|until|deadline|each|every|do not)\b/i;

// ---------------------------------------------------------------------------------------------------------------
// Locating quotes. The text is indexed with whitespace runs collapsed to one space; `markup` also drops markdown
// emphasis and code marks (* and `), so a quote that copies the words but not the bold still locates (and says so).
function normIndex(text, markup) {
  let out = '';
  const map = [];
  let space = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (markup && (c === '*' || c === '`')) continue;
    if (c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ') { space = out.length > 0; continue; }
    if (space) { out += ' '; map.push(i); space = false; }
    out += c; map.push(i);
  }
  return { norm: out, map };
}
const normQuote = (q, markup) => normIndex(String(q ?? ''), markup).norm;

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}
/** 1-based line of an offset. */
export function lineOf(starts, offset) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
  return lo + 1;
}

/** An indexed user text: locate(quote) and sentences(). */
export function indexText(text) {
  const starts = lineStarts(text);
  const idx = { exact: normIndex(text, false), markup: normIndex(text, true) };
  const locate = quote => {
    for (const mode of ['exact', 'markup']) {
      const q = normQuote(quote, mode === 'markup');
      if (q.length < 3) return null;
      const { norm, map } = idx[mode];
      const at = norm.indexOf(q);           // the first occurrence wins
      if (at < 0) continue;
      const start = map[at], end = map[at + q.length - 1] + 1;
      return { start, end, line: lineOf(starts, start), lineEnd: lineOf(starts, end - 1), match: mode };
    }
    return null;
  };
  return { text, sha256: sha256(text), starts, locate, sentences: () => sentencesOf(text, starts) };
}

/**
 * Sentences with their offsets and lines. Blocks are paragraphs, list items and table rows; headings and table rule
 * rows are skipped. A block is split after . ! ? when the next word starts with a capital, a digit, a mark or a quote.
 */
function sentencesOf(text, starts) {
  const lines = text.split('\n');
  const blocks = [];
  let cur = null, off = 0;
  const flush = () => { if (cur) blocks.push(cur); cur = null; };
  for (const line of lines) {
    const start = off, end = off + line.length;
    off = end + 1;
    if (!line.trim()) { flush(); continue; }
    if (/^\s*#/.test(line)) { flush(); continue; }
    if (/^\s*\|/.test(line)) { flush(); if (!/^\s*\|[\s:|-]+\|?\s*$/.test(line)) blocks.push({ start, end }); continue; }
    if (/^\s*([-*+]|\d+\.)\s/.test(line) || !cur) { flush(); cur = { start, end }; continue; }
    cur.end = end;
  }
  flush();
  const out = [];
  for (const b of blocks) {
    const chunk = text.slice(b.start, b.end);
    const re = /[.!?](?=\s+[A-Z0-9`*"'(\[§])/g;
    let s = 0, m;
    const cut = e => {
      const raw = chunk.slice(s, e);
      const lead = raw.length - raw.trimStart().length, trail = raw.length - raw.trimEnd().length;
      const a = b.start + s + lead, z = b.start + e - trail;
      if (z > a) out.push({ start: a, end: z, line: lineOf(starts, a), lineEnd: lineOf(starts, z - 1), text: raw.trim().replace(/\s+/g, ' ') });
    };
    while ((m = re.exec(chunk))) {
      // not after a one- or two-letter abbreviation (e.g., i.e.) or a section number
      const before = chunk.slice(Math.max(0, m.index - 4), m.index + 1);
      if (/\b(e\.g|i\.e|cf|vs)\.$/i.test(before)) continue;
      cut(m.index + 1); s = m.index + 1;
    }
    cut(chunk.length);
  }
  return out;
}

export const isNormative = sentence => CUES.test(sentence);

/** Normative sentences that no entry's quote overlaps (shown as "possibly missed by extraction"). */
export function uncoveredOf(index, ranges) {
  return index.sentences().filter(s => isNormative(s.text) && !ranges.some(r => r.start < s.end && s.start < r.end))
    .map(s => ({ line: s.line, lineEnd: s.lineEnd, text: s.text }));
}

// ---------------------------------------------------------------------------------------------------------------
const pad3 = n => String(n).padStart(3, '0');
export const quoteHashOf = (quote, contextQuotes = []) => sha256(JSON.stringify([normQuote(quote, true), ...contextQuotes.map(q => normQuote(q, true))]));

/** The quotes a requirement's check is written from: its own, then its context (entries, then other sentences). */
export function contextQuotes(ledger, entry) {
  const byId = new Map(ledger.requirements.map(r => [r.id, r]));
  return [...(entry.context ?? []).map(id => byId.get(id)?.quote).filter(Boolean), ...(entry.contextText ?? []).map(c => c.quote)];
}

/**
 * buildLedger({ text, source, extractor, entries }) → ledger. `entries` are raw [{ quote, kind, summary, context: [quote] }]
 * from an extractor (a model, or a frozen gold list). Mechanical checks: verbatim location (else dropped), kind (else
 * dropped), duplicates merged, ids by position in the text, context quotes resolved to entry ids where they are entries.
 */
export function buildLedger({ text, source = {}, extractor = null, entries = [], idPrefix = 'Q' }) {
  const index = indexText(text);
  const dropped = [], kept = [];
  for (const [i, e] of entries.entries()) {
    const quote = typeof e?.quote === 'string' ? e.quote.trim() : '';
    if (!quote) { dropped.push({ index: i, quote: null, why: 'no quote' }); continue; }
    if (!KIND_NAMES.includes(e.kind)) { dropped.push({ index: i, quote, why: `unknown kind ${JSON.stringify(e.kind)}` }); continue; }
    const at = index.locate(quote);
    if (!at) { dropped.push({ index: i, quote, why: 'not a verbatim span of the text' }); continue; }
    const key = normQuote(quote, true);
    const dup = kept.find(k => k.key === key || (k.at.start === at.start && k.at.end === at.end));
    if (dup) {         // merged: the first entry is kept; a different summary is appended, so nothing the extractor said is lost
      dup.merged += 1; dup.contextRaw.push(...(Array.isArray(e.context) ? e.context : []));
      const s = typeof e.summary === 'string' ? e.summary.trim() : '';
      if (s && !dup.summary.includes(s)) dup.summary = dup.summary ? `${dup.summary}; also: ${s}` : s;
      continue;
    }
    kept.push({ key, at, quote, kind: e.kind, summary: typeof e.summary === 'string' ? e.summary.trim() : '', contextRaw: Array.isArray(e.context) ? [...e.context] : [], merged: 0 });
  }
  kept.sort((a, b) => a.at.start - b.at.start || a.at.end - b.at.end);
  kept.forEach((k, i) => { k.id = `${idPrefix}-${pad3(i + 1)}`; });
  const requirements = kept.map(k => {
    const context = [], contextText = [];
    for (const c of k.contextRaw) {
      if (typeof c !== 'string' || !c.trim()) continue;
      const at = index.locate(c);
      if (!at) continue;                                       // a context quote must be verbatim too
      const hit = kept.find(o => o !== k && o.at.start < at.end && at.start < o.at.end);
      if (hit) { if (!context.includes(hit.id)) context.push(hit.id); continue; }
      if (k.at.start <= at.start && at.end <= k.at.end) continue;  // inside its own quote
      if (!contextText.some(x => x.span.line === at.line && x.quote === c.trim())) contextText.push({ quote: c.trim(), span: { line: at.line, lineEnd: at.lineEnd } });
    }
    return { id: k.id, quote: k.quote, span: { line: k.at.line, lineEnd: k.at.lineEnd }, ...(k.at.match === 'markup' ? { match: 'markup' } : {}),
      context, contextText, kind: k.kind, summary: k.summary, confirmed: false, source: 'user-text', ...(k.merged ? { merged: k.merged } : {}),
      check: null, status: null, evidence: null };
  });
  return { tracker: LEDGER_VERSION, source: { ...source, sha256: index.sha256 }, extractor, requirements,
    uncovered: uncoveredOf(index, kept.map(k => k.at)), dropped, log: [] };
}

/** Recompute the coverage list after edits (offsets come from the quotes, located again). */
export function refreshCoverage(ledger, text) {
  const index = indexText(text);
  const ranges = ledger.requirements.map(r => index.locate(r.quote)).filter(Boolean);
  return { ...ledger, uncovered: uncoveredOf(index, ranges) };
}

/**
 * The user's edits (§1 "User control"), applied in order and logged:
 *   { op: 'confirm', id }   { op: 'delete', id, reason? }   { op: 'edit', id, summary?, kind?, quote?, context?, reason? }
 *   { op: 'add', quote, kind, summary, context?, reason? }  (the quote must be a verbatim span: "select a span")
 * An edit that changes the quote, kind, summary or context bumps check.version and drops the property: it is rewritten
 * from the edited entry. Only these edits ever revise a property after it was written (guard G1).
 */
export function applyEdits(ledger, text, edits, { by = 'user', now = () => new Date().toISOString() } = {}) {
  if (sha256(text) !== ledger.source?.sha256) throw new Error('the text is not the one this ledger was extracted from (sha256 differs)');
  const index = indexText(text);
  const out = structuredClone(ledger);
  const find = id => { const r = out.requirements.find(x => x.id === id); if (!r) throw new Error(`no requirement ${id}`); return r; };
  const resolveContext = (ctx, self) => {
    const context = [], contextText = [];
    for (const c of ctx ?? []) {
      if (out.requirements.some(r => r.id === c)) { context.push(c); continue; }
      const at = index.locate(c);
      if (!at) throw new Error(`context quote is not a verbatim span: ${String(c).slice(0, 80)}`);
      const hit = out.requirements.find(r => r !== self && index.locate(r.quote)?.start < at.end && at.start < index.locate(r.quote)?.end);
      if (hit) context.push(hit.id); else contextText.push({ quote: String(c).trim(), span: { line: at.line, lineEnd: at.lineEnd } });
    }
    return { context, contextText };
  };
  const bump = r => { r.check = { version: (r.check?.version ?? 1) + 1, fn: null, rewrite: true }; r.status = null; r.evidence = null; };
  for (const e of edits) {
    if (e.op === 'confirm') { find(e.id).confirmed = true; }
    else if (e.op === 'delete') { const r = find(e.id); out.requirements = out.requirements.filter(x => x !== r); }
    else if (e.op === 'edit') {
      const r = find(e.id);
      if (e.kind !== undefined && !KIND_NAMES.includes(e.kind)) throw new Error(`unknown kind ${e.kind}`);
      if (e.quote !== undefined) {
        const at = index.locate(e.quote);
        if (!at) throw new Error(`edited quote is not a verbatim span: ${String(e.quote).slice(0, 80)}`);
        r.quote = e.quote.trim(); r.span = { line: at.line, lineEnd: at.lineEnd };
        if (at.match === 'markup') r.match = 'markup'; else delete r.match;
      }
      if (e.kind !== undefined) r.kind = e.kind;
      if (e.summary !== undefined) r.summary = String(e.summary);
      if (e.context !== undefined) Object.assign(r, resolveContext(e.context, r));
      r.confirmed = true;
      bump(r);
    } else if (e.op === 'add') {
      if (!KIND_NAMES.includes(e.kind)) throw new Error(`unknown kind ${e.kind}`);
      const at = index.locate(e.quote ?? '');
      if (!at) throw new Error(`added quote is not a verbatim span: ${String(e.quote).slice(0, 80)}`);
      const n = Math.max(0, ...out.requirements.map(r => Number(r.id.split('-').pop()) || 0)) + 1;
      const r = { id: `U-${pad3(n)}`, quote: e.quote.trim(), span: { line: at.line, lineEnd: at.lineEnd }, ...(at.match === 'markup' ? { match: 'markup' } : {}),
        context: [], contextText: [], kind: e.kind, summary: String(e.summary ?? ''), confirmed: true, source: 'user-added', check: null, status: null, evidence: null };
      Object.assign(r, resolveContext(e.context, r));
      out.requirements.push(r);
      e.id = r.id;
    } else throw new Error(`unknown edit op ${JSON.stringify(e.op)}`);
    out.log.push({ at: now(), by, op: e.op, id: e.id ?? null, ...(e.reason ? { reason: String(e.reason) } : {}) });
  }
  return refreshCoverage(out, text);
}

// ---------------------------------------------------------------------------------------------------------------
export const readLedger = file => JSON.parse(readFileSync(file, 'utf8'));
export function writeLedger(file, ledger) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(ledger, null, 1) + '\n');
  renameSync(`${file}.tmp`, file);
}
