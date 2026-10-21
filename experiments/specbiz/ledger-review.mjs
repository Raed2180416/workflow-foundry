// The derive-ledger arm's bridge (DESIGN §3; FIRST-CLASS-PROGRAMS §4.4 "S-derive+ledger"): extract a quote-anchored ledger
// from the pack with the tracker's own extraction (experiments/tracker/extract.mjs extractLedger: one journaled ModelPort
// call; every quote must locate verbatim, else it is dropped), then the simulated owner reviews it from her intent
// records. The review is truth-first and mechanical, like owner-sim.mjs: nothing is generated at run time.
//   - an entry quoting the unauthorised e-mail or a distractor document is struck, with the owner's pre-rendered record
//     answer for it (UA, D-OUTLET, D-DRAFT, D-REF, D-VELOX-PLUS) or the fixed STRUCK_ANSWER;
//   - an entry overlapping a stale wording (a unit's stale variant, in SOP v2, SOP v3 or quoted in a correction e-mail)
//     is corrected: the owner's pre-rendered record answer for that unit replaces it;
//   - every other entry (current wording, request, platform guide, records) is confirmed as written.
// The owner adds nothing: an owner-only rule never reaches the ledger unless the builder asks for it. The review is not
// charged against the 20-question budget; it is reported as owner burden of its own (entries reviewed).
import { extractLedger } from '../tracker/extract.mjs';
import { indexText } from '../tracker/ledger.mjs';
import { UNITS, DISTRACTORS } from './content.mjs';

export const REVIEW_VERSION = 'specbiz-ledger-review/1';
export const STRUCK_ANSWER = 'That is not our policy. Leave it out.';
const HEADER = f => `=== business/${f} ===`;

/** The pack as one text for extraction: every file under a header line, in path order; and where each file's body starts. */
export function packText(pack) {
  let text = '';
  const spans = [];
  for (const f of Object.keys(pack.files).sort()) {
    const head = `${HEADER(f)}\n`;
    const start = text.length + head.length;
    text += head + pack.files[f];
    spans.push({ file: f, start, end: start + pack.files[f].length });
    text += '\n\n';
  }
  return { text, spans };
}

/** Ranges of a needle in a haystack (every occurrence). */
function rangesOf(hay, needle) {
  const out = [];
  if (!needle) return out;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) out.push([i, i + needle.length]);
  return out;
}

/** Unit wordings inside one file: [{ unit, role: current | stale | precedent, start, end }] (offsets in the file). */
export function wordingsOf(pack, file) {
  const t = pack.files[file], out = [];
  for (const [id, u] of Object.entries(UNITS)) {
    for (const [a, b] of rangesOf(t, u.core)) out.push({ unit: id, role: 'current', start: a, end: b });
    if (u.stale) for (const [a, b] of rangesOf(t, u.stale.text)) out.push({ unit: id, role: 'stale', start: a, end: b });
  }
  for (const fr of pack.fragments.filter(x => x.file === file && x.role === 'precedent')) out.push({ unit: fr.unit, role: 'precedent', start: 0, end: t.length });
  return out;
}

const recordAnswer = (pack, id) => pack.owner.records.find(r => r.id === id)?.answer ?? null;

/** The owner's review of one ledger entry located at [start, end) of packText(pack).text. */
export function reviewEntry(pack, spans, { start, end }) {
  const span = spans.find(s => s.start <= start && start < s.end) ?? spans.find(s => start < s.end && s.start < end);
  if (!span) return { status: 'confirmed', file: null, units: [], why: 'outside every file (a header)' };
  const file = span.file, carrier = pack.fileCarrier[file];
  const a = Math.max(0, start - span.start), b = Math.min(span.end, end) - span.start;
  const hits = wordingsOf(pack, file).filter(w => w.start < b && a < w.end);
  const units = [...new Set(hits.map(h => h.unit))].sort();
  if (carrier === 'unauthorised') return { status: 'struck', file, units, record: 'UA', answer: recordAnswer(pack, 'UA'), why: 'the unauthorised sender' };
  if (carrier === 'distractor') {
    const d = DISTRACTORS.find(x => x.file === file), ans = d ? recordAnswer(pack, d.id) : null;
    return { status: 'struck', file, units, record: ans ? d.id : null, answer: ans ?? STRUCK_ANSWER, why: `distractor ${d?.id ?? file}` };
  }
  const stale = hits.filter(h => h.role === 'stale');
  if (stale.length) {
    const ids = [...new Set(stale.map(h => h.unit))].sort();
    return { status: 'corrected', file, units, records: ids, answer: ids.map(id => recordAnswer(pack, id)).join('\n\n'), why: `stale wording of ${ids.join(', ')}` };
  }
  return { status: 'confirmed', file, units, why: hits.length ? 'current wording' : `no unit wording (${carrier})` };
}

/** Review every requirement of a ledger built over packText(pack).text. */
export function ownerReview(pack, ledger) {
  const { text, spans } = packText(pack);
  if (ledger.source?.sha256 && indexText(text).sha256 !== ledger.source.sha256) throw new Error('the ledger was not extracted from this pack text');
  const index = indexText(text);
  const entries = ledger.requirements.map(r => {
    const at = index.locate(r.quote);
    if (!at) return { id: r.id, status: 'confirmed', file: null, units: [], why: 'quote did not relocate' };
    const fileSpan = spans.find(s => s.start <= at.start && at.start < s.end);
    const line = fileSpan ? text.slice(fileSpan.start, at.start).split('\n').length : null;
    return { id: r.id, kind: r.kind, summary: r.summary, quote: r.quote, line, ...reviewEntry(pack, spans, at) };
  });
  const count = s => entries.filter(e => e.status === s).length;
  return { version: REVIEW_VERSION, entries, counts: { entries: entries.length, confirmed: count('confirmed'), corrected: count('corrected'), struck: count('struck') } };
}

/** LEDGER.md: what the derive-ledger builder reads. */
export function ledgerMarkdown(review, { failed = null } = {}) {
  const head = ['# Requirement ledger (extracted from the shop\'s documents; reviewed by Mara)', '',
    'Each entry gives its status, its kind, a one-line summary, the quote and where it comes from. Mara reviewed every entry:',
    'confirmed (as written), corrected (her correction replaces the quote), struck (not the shop\'s policy: leave it out).', ''];
  if (failed) return [...head, `(No ledger: the extraction failed: ${failed}. Work from the documents.)`, ''].join('\n');
  if (!review.entries.length) return [...head, '(The extraction found no conditions. Work from the documents.)', ''].join('\n');
  const body = review.entries.flatMap(e => [
    `## ${e.id} (${e.status}, ${e.kind ?? '?'})`, '',
    `Summary: ${e.summary ?? ''}`,
    `Quote (business/${e.file ?? '?'}${e.line ? `, line ${e.line}` : ''}): "${String(e.quote ?? '').replace(/\s+/g, ' ')}"`,
    ...(e.status === 'corrected' ? [`Mara (correction): "${e.answer}"`] : e.status === 'struck' ? [`Mara (struck): "${e.answer}"`] : []), '']);
  return [...head, ...body].join('\n');
}

/**
 * Extract and review (paid via `port`, or the scripted stand-in). One retry (sample 1) on a failed extraction, logged.
 * Returns { ledger, review, markdown, calls: [{ ok, error, costUsd }], failed }.
 */
export async function extractAndReview({ port, modelId, pack, runId }) {
  const { text } = packText(pack);
  const calls = [];
  let ledger = null, failed = null;
  for (const sampleIndex of [0, 1]) {
    try {
      const { ledger: l, call } = await extractLedger({ port, modelId, text, source: { file: `specbiz pack ${pack.digest}` }, sampleIndex, runId });
      calls.push({ sampleIndex, ok: true, costUsd: call.costUsd ?? 0, journalId: call.journalId ?? null, kept: l.requirements.length, dropped: l.dropped.length });
      ledger = l; failed = null;
      break;
    } catch (e) {
      calls.push({ sampleIndex, ok: false, error: e?.call?.error?.code ?? e?.code ?? 'THROWN', costUsd: e?.call?.costUsd ?? 0 });
      failed = String(e?.message ?? e).slice(0, 200);
    }
  }
  const review = ledger ? ownerReview(pack, ledger) : { version: REVIEW_VERSION, entries: [], counts: { entries: 0, confirmed: 0, corrected: 0, struck: 0 } };
  return { ledger, review, markdown: ledgerMarkdown(review, { failed }), calls, failed };
}

/**
 * The $0 scripted extraction (dry runs and tests): every SOP bullet and every sentence of the unauthorised e-mail's body,
 * quoted verbatim from the prompt's text. A stand-in for plumbing, not a model of extraction quality.
 */
export function scriptedExtraction(prompt) {
  const a = prompt.indexOf('<<<USER-TEXT\n'), b = prompt.lastIndexOf('\nUSER-TEXT>>>');
  const text = prompt.slice(a + '<<<USER-TEXT\n'.length, b);
  const entries = [];
  let file = null;
  for (const line of text.split('\n')) {
    const h = /^=== business\/(.+) ===$/.exec(line);
    if (h) { file = h[1]; continue; }
    const bullet = /^- (.{20,})$/.exec(line);
    if (bullet && /^wiki\/SOP-/.test(file ?? '')) entries.push({ quote: bullet[1].replace(/ \((Joost|see also|Mara|checked)[^)]*\)\.?$/, '').trim(), kind: 'must', summary: bullet[1].slice(0, 80), context: [] });
    if (/please book the shipment with us before you charge the card/.test(line)) entries.push({ quote: line.trim(), kind: 'order', summary: 'book the shipment before charging', context: [] });
  }
  return entries.slice(0, 80);
}
