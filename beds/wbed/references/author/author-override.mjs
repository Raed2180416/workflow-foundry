// Author-answered judges (W-BED.md §2.3): for the author fixtures (wbed dev seeds 373-378, fixture-answers.json) and, at the
// one revision the protocol allows, the validation seeds 301-312 (validation-answers.json). The reference author read each
// task's notes and wrote down what a correct reader answers to each judge the reference asks there (keyed by bed, seed and
// difficulty, then by judge name). Run through the flow-v3 override hook
// (tools/flow-override.mjs, harness only): a judge whose name is in the table gets that answer at $0, with its quote taken
// from the first sentence of the request's first fenced block (as stub policy A does); a judge that is not in the table
// fails, so a gap in the table is visible as a judge failure, never silently answered. It measures the code given correct
// readings (the deterministic part of the reference), not any model. Never used on held-out seeds.
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('./flow-override.json', import.meta.url), 'utf8'));
const WS = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const firstSentence = block => WS(block).split(/(?<=[.!?])\s+(?=[A-Z"“(　-鿿])/).find(s => s.length >= 8) ?? '';
// R3 reason judges: the answer is the labelled reason of (vendor, document); the quote is the notes line that names the
// document, else the one that names its amount.
function reasonAnswer(request) {
  const prompt = String(request.prompt ?? '');
  const m = /^Supplier .+? \((V-\d+)\)\. The (?:invoice|payment|credit note|balance brought forward) (.+?) (?:is on both sides|of )/.exec(prompt);
  if (!m) return { error: 'author override: cannot read the reason question' };
  const reason = data.answers?.reason?.[`${m[1]}|${m[2]}`];
  if (reason === undefined) return { error: `author table has no reason for ${m[1]} ${m[2]}` };
  if (!['PRICE', 'FX', 'MISSING_CREDIT'].includes(reason)) return { value: { reason: 'UNEXPLAINED', quote: '' } };
  const block = /<<<\n([\s\S]*?)\n>>>/.exec(prompt)?.[1] ?? '';
  const key = s => s.toLowerCase().replace(/[\s\-/]/g, '');
  const amount = /(?:statement shows|of) -?[A-Z]{3} ([\d,.]+)/.exec(prompt)?.[1];
  const lines = block.split('\n').map(WS).filter(Boolean);
  const line = lines.find(l => key(l).includes(key(m[2]))) ?? (amount ? lines.find(l => l.includes(amount)) : undefined);
  if (!line) return { error: `author override: no notes line names ${m[2]}` };
  return { value: { reason, quote: line } };
}
// Sensitivity (validate.mjs --flip <class>): the author answer of every judge in one class is replaced by its opposite
// (DMY<->MDY and the switch dropped; VOID<->KEEP; COUNTS<->DOES_NOT_COUNT; a place -> UNKNOWN), to measure how many tasks
// that judge class decides.
const FLIP = {
  'dob-order': a => ({ ...a, order: a.order === 'DMY' ? 'MDY' : 'DMY', switch_date: '' }),
  'row-marker': a => (a.meaning === 'VOID' ? { ...a, meaning: 'KEEP' } : a.meaning === 'KEEP' ? { ...a, meaning: 'VOID' } : a),
  'invoice-status': a => (a.meaning === 'COUNTS' ? { ...a, meaning: 'DOES_NOT_COUNT' } : a.meaning === 'DOES_NOT_COUNT' ? { ...a, meaning: 'COUNTS' } : a),
  'place-country': a => Object.fromEntries(Object.keys(a).map(k => [k, 'UNKNOWN'])),
};
const classOf = (name, a) => (name.startsWith('dob-order') ? 'dob-order' : name === 'place-country' ? 'place-country'
  : name.startsWith('marker') ? (['VOID', 'KEEP'].includes(a?.meaning) ? 'row-marker' : 'invoice-status') : null);
export default function override(callSite, request) {
  if (/^reason:/.test(callSite.name)) return reasonAnswer(request);
  const name = callSite.name.replace(/^marker-tiebreak:/, 'marker:').replace(/^dob-order-second:/, 'dob-order:').replace(/^reason-second:/, 'reason:');
  let answer = data.answers?.[name];
  if (answer !== undefined && data.flip && classOf(name, answer) === data.flip) answer = FLIP[data.flip](answer);
  if (answer === undefined) return { error: `author table has no answer for ${callSite.name}` };
  const block = /<<<\n([\s\S]*?)\n>>>/.exec(String(request.prompt ?? ''))?.[1] ?? '';
  // place-country: the table maps each place (as the register writes it) to its country; the answer follows the lines.
  if (name === 'place-country') {
    const lines = block.split('\n').map(WS).filter(Boolean), missing = lines.filter(l => !(l in answer));
    if (missing.length) return { error: `author table has no country for ${missing.join(' | ')}` };
    return { value: { countries: lines.map(l => answer[l]) } };
  }
  const wantsQuote = !!request.schema?.properties?.quote;
  return { value: wantsQuote && answer.quote === undefined ? { ...answer, quote: firstSentence(block) } : answer };
}
