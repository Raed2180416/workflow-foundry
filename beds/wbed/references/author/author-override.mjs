// Author-answered judges for the AUTHOR FIXTURES only (wbed dev seeds 373-378; W-BED.md §2.3). The reference author read
// each fixture's notes and wrote down what a correct reader answers to each judge the reference asks there
// (fixture-answers.json, keyed by bed, seed and difficulty, then by judge name). Run through the flow-v3 override hook
// (tools/flow-override.mjs, harness only): a judge whose name is in the table gets that answer at $0, with its quote taken
// from the first sentence of the request's first fenced block (as stub policy A does); a judge that is not in the table
// fails, so a gap in the table is visible as a judge failure, never silently answered. It measures the code given correct
// readings (the deterministic part of the reference), not any model. Never used on validation or held-out seeds.
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('./flow-override.json', import.meta.url), 'utf8'));
const WS = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const firstSentence = block => WS(block).split(/(?<=[.!?])\s+(?=[A-Z"“(　-鿿])/).find(s => s.length >= 8) ?? '';
export default function override(callSite, request) {
  const name = callSite.name.replace(/^marker-tiebreak:/, 'marker:').replace(/^dob-order-second:/, 'dob-order:').replace(/^reason-second:/, 'reason:');
  const answer = data.answers?.[name];
  if (answer === undefined) return { error: `author table has no answer for ${callSite.name}` };
  const block = /<<<\n([\s\S]*?)\n>>>/.exec(String(request.prompt ?? ''))?.[1] ?? '';
  const wantsQuote = !!request.schema?.properties?.quote;
  return { value: wantsQuote && answer.quote === undefined ? { ...answer, quote: firstSentence(block) } : answer };
}
