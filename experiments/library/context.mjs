// context.mjs: the per-call context budget as code (LIBRARY.md §5.2; BUILD-ORDER step 2). Every constructor prompt is
// assembled here; a prompt that exceeds its call's cap, or any part that exceeds its allocation, is REFUSED with
// CONTEXT_OVER_CLASS_BUDGET (review-05 §3.6). Nothing is ever truncated to fit.
//
//   const p = assemblePrompt('S6', { l0: l0Card().text, index: lines, expanded: [cardText], task, other });
//   // -> { call, class, cap, system, prompt, tokens: {l0, index, expanded, task, other, framing, total} }  or throws
//
// Tokens are counted with tokens.mjs countTokens (a calibrated conservative bound; its header has the calibration).
// Caps: the §5.2 table, each cross-checked against policy/models.json inputBudgetTokensByClass (the hard class budget):
// the effective cap is the smaller of the two. Part names: l0 (the L0 card), index (one-line entries, <= 30 tokens each),
// expanded (expanded items: J1 questions at S5, one card at S6, the one slot at S8), task (task material), other
// (instructions, slot-group schema).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FoundryError } from '../../src/data.mjs';
import { countTokens, estimateTokens } from './tokens.mjs';
import { INDEX_LINE_MAX } from './index.mjs';

export { countTokens, estimateTokens } from './tokens.mjs';
export const REFUSAL = 'CONTEXT_OVER_CLASS_BUDGET';
export const PART_REFUSAL = 'CONTEXT_PART_NOT_ALLOWED';
const POLICY = JSON.parse(readFileSync(new URL('../../policy/models.json', import.meta.url), 'utf8'));
export const CLASS_BUDGETS = Object.freeze({ ...POLICY.inputBudgetTokensByClass });

// LIBRARY §5.2, row by row. S8's "the slot only" has no number in the table; §5.1 says the repair call sees "one error
// code + its path + the one slot (<= 2,000)", so the slot gets 2,000 (BUILD-ORDER "Implementation status").
export const CAP_TABLE = Object.freeze({
  S1: Object.freeze({ step: 'intake', class: 'S', cap: 4000, parts: Object.freeze({ task: 3000, other: 300 }) }),
  S5: Object.freeze({ step: 'choose', class: 'S', cap: 4000, parts: Object.freeze({ index: 600, expanded: 600, task: 1000, other: 500 }), maxIndexLines: 20, maxExpanded: 20 }),
  S6: Object.freeze({ step: 'fill', class: 'M', cap: 8000, parts: Object.freeze({ l0: 3000, index: 600, expanded: 1200, task: 2500, other: 500 }), maxIndexLines: 20, maxExpanded: 1 }),
  S8: Object.freeze({ step: 'repair', class: 'S', cap: 4000, parts: Object.freeze({ expanded: 2000, task: 1000, other: 500 }), maxExpanded: 1 }),
});
export const capOf = call => {
  const row = CAP_TABLE[call];
  if (!row) throw new FoundryError('CONTEXT_UNKNOWN_CALL', `no cap table row for call ${call}`);
  return Math.min(row.cap, CLASS_BUDGETS[row.class] ?? row.cap);
};
const SECTION = { index: 'INDEX (one line per candidate)', expanded: 'EXPANDED', task: 'TASK', other: 'INSTRUCTIONS' };

// The L0 card as a prompt asset: L0-VOCABULARY.md with the "Changes since draft" block removed (that block "sits outside
// the prompt budget"). form 'verbatim' is the card as written; 'compact' strips markdown emphasis, code ticks and table
// framing only (no word changes), as a measured alternative. Both are reported with their token counts.
export const L0_SOURCE = new URL('../../research/jit-20261008/design/library/L0-VOCABULARY.md', import.meta.url);
export function l0Card({ form = 'verbatim', source = L0_SOURCE } = {}) {
  const lines = readFileSync(source, 'utf8').split('\n');
  const out = [];
  let i = 0;
  out.push(lines[i++]);                                   // the title
  while (i < lines.length && (lines[i].startsWith('>') || lines[i].trim() === '')) i++;   // the changes block
  for (; i < lines.length; i++) out.push(lines[i]);
  let text = out.join('\n').trim() + '\n';
  if (form === 'compact') {
    text = text.replace(/\*\*/g, '').replace(/`/g, '').replace(/^\|[-| ]+\|$/gm, '').replace(/^\| /gm, '').replace(/ \|$/gm, '').replace(/\n{2,}/g, '\n');
  } else if (form !== 'verbatim') throw new Error(`l0Card: form must be verbatim or compact`);
  return { form, text, sha256: createHash('sha256').update(text).digest('hex'), tokens: countTokens(text), pointTokens: estimateTokens(text) };
}

const refuse = (code, message, details) => { throw new FoundryError(code, message, details); };

// Assemble one constructor prompt or refuse. parts: {l0?: string, index?: string[], expanded?: string[] | string,
// task?: string, other?: string}. opts.caps overrides a row's {cap, parts} (an experiment arm, e.g. LIBRARY-TESTS L5);
// opts.log, an array, receives one record per call, refused or not (the T2 interceptor).
export function assemblePrompt(call, parts = {}, { caps = null, log = null } = {}) {
  const base = CAP_TABLE[call];
  if (!base) refuse('CONTEXT_UNKNOWN_CALL', `no cap table row for call ${call}`, { call });
  const row = { ...base, ...(caps ?? {}), parts: { ...base.parts, ...(caps?.parts ?? {}) } };
  const cap = caps?.cap ?? capOf(call);
  const record = r => { if (Array.isArray(log)) log.push({ call, cap, ...r }); };
  const fail = (code, message, details) => { record({ refused: code, ...details }); refuse(code, message, { call, cap, ...details }); };
  for (const k of Object.keys(parts)) {
    if (parts[k] == null) continue;
    if (!(k in row.parts)) fail(PART_REFUSAL, `${call} (${row.step}) takes no ${k} part`, { part: k });
  }
  const index = parts.index == null ? [] : Array.isArray(parts.index) ? parts.index : fail('CONTEXT_PART_TYPE', 'index must be an array of lines', { part: 'index' });
  const expanded = parts.expanded == null ? [] : Array.isArray(parts.expanded) ? parts.expanded : [parts.expanded];
  if (row.maxIndexLines != null && index.length > row.maxIndexLines) fail(REFUSAL, `${call}: ${index.length} index lines > ${row.maxIndexLines}`, { part: 'index', lines: index.length, maxLines: row.maxIndexLines });
  for (const [i, line] of index.entries()) {
    if (typeof line !== 'string' || line.includes('\n')) fail('CONTEXT_PART_TYPE', `index line ${i} is not one line`, { part: 'index', line: i });
    const t = countTokens(line);
    if (t > INDEX_LINE_MAX) fail(REFUSAL, `${call}: index line ${i} has ${t} tokens > ${INDEX_LINE_MAX}`, { part: 'index', line: i, tokens: t, allocation: INDEX_LINE_MAX });
  }
  if (row.maxExpanded != null && expanded.length > row.maxExpanded) fail(REFUSAL, `${call}: ${expanded.length} expanded items > ${row.maxExpanded}`, { part: 'expanded', items: expanded.length, maxItems: row.maxExpanded });
  const texts = { l0: parts.l0 ?? null, index: index.length ? index.join('\n') : null, expanded: expanded.length ? expanded.join('\n\n') : null, task: parts.task ?? null, other: parts.other ?? null };
  const tokens = {};
  for (const [k, text] of Object.entries(texts)) {
    if (text == null) continue;
    if (typeof text !== 'string') fail('CONTEXT_PART_TYPE', `${k} must be text`, { part: k });
    tokens[k] = countTokens(text);
    if (tokens[k] > row.parts[k]) fail(REFUSAL, `${call}: ${k} has ${tokens[k]} tokens > its allocation ${row.parts[k]}`, { part: k, tokens: tokens[k], allocation: row.parts[k] });
  }
  const system = texts.l0 ?? '';
  const prompt = ['index', 'expanded', 'task', 'other'].filter(k => texts[k] != null).map(k => `## ${SECTION[k]}\n${texts[k]}`).join('\n\n');
  const total = countTokens(system) + countTokens(prompt);
  tokens.framing = Math.max(0, total - Object.values(tokens).reduce((a, b) => a + b, 0));
  tokens.total = total;
  if (total > cap) fail(REFUSAL, `${call}: ${total} tokens > the ${row.class} cap ${cap}`, { part: 'total', tokens: total, allocation: cap });
  record({ tokens });
  return { call, step: row.step, class: row.class, cap, system, prompt, tokens };
}
