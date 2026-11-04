// The answers a person gave about a file (date order, decimal separator, which values mean "still open", which column is the one owed),
// remembered for the next file of the same kind (UX review 2026-10-21, m4; WCAG 3.3.7 redundant entry; SPEC §5 "never asked: the same
// thing twice"). Without it, a weekly upload of the same export asked the same date-order question every week, for ever.
//
//   <workspace>/site/data-answers.json   { "<card>/<sheet>/<header signature>": { answers: { id: value }, choices: { id: [values] }, at } }
//
// A remembered answer is never applied silently: the page shows it already chosen, says it is the answer from last time and when, and the
// person can change it before anything is imported. It is offered only when it still fits the new file: a "which one" answer only if
// that choice is offered again; a "which values" answer only if the new file has no value the person was not asked about last time.
// The key is the card, the list and the file's column names (sorted, so a reordered export still matches); another export, with other
// columns, is asked afresh. Only the answers are kept, never a value from the file beyond the ones the person ticked.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { withFileLock } from './file-lock.mjs';

const KEEP = 100;
const fileOf = root => path.join(root, 'site', 'data-answers.json');
/** The file's columns, as a short fingerprint that does not depend on their order or case. */
export const headerSignature = header => createHash('sha256').update(JSON.stringify([...new Set((header ?? []).map(h => String(h).trim().toLowerCase()))].sort())).digest('hex').slice(0, 16);
const keyOf = ({ template, sheet, header }) => `${template}/${sheet}/${headerSignature(header)}`;
function load(root) { try { const v = existsSync(fileOf(root)) ? JSON.parse(readFileSync(fileOf(root), 'utf8')) : {}; return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } }

/** Keep the answers to the questions this file asked (only those). */
export function rememberAnswers(root, { template, sheet, header, questions, answers, now = Date.now }) {
  const kept = {}, choices = {};
  for (const q of questions ?? []) {
    const a = answers?.[q.id];
    if (a === undefined || a === null) continue;
    const offered = q.choices.map(c => c.value);
    if (q.kind === 'choice' ? !offered.includes(a) : !(Array.isArray(a) && a.every(v => offered.includes(v)))) continue;
    kept[q.id] = a; choices[q.id] = offered;
  }
  if (!Object.keys(kept).length) return null;
  const file = fileOf(root);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  return withFileLock(file, () => {
    const all = load(root), key = keyOf({ template, sheet, header });
    const prior = all[key] ?? { answers: {}, choices: {} };
    all[key] = { answers: { ...prior.answers, ...kept }, choices: { ...prior.choices, ...choices }, at: new Date(now()).toISOString() };
    const trimmed = Object.fromEntries(Object.entries(all).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, KEEP));
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(trimmed, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
    return trimmed[key];
  });
}

/** The questions with { remembered: { value, at } } on each one whose last answer still fits this file. */
export function recallAnswers(root, { template, sheet, header, questions }) {
  const memo = load(root)[keyOf({ template, sheet, header })];
  return (questions ?? []).map(q => {
    const a = memo?.answers?.[q.id];
    if (a === undefined || a === null) return q;
    const offered = q.choices.map(c => c.value), before = memo.choices?.[q.id] ?? [];
    const fits = q.kind === 'choice' ? offered.includes(a) : Array.isArray(a) && offered.every(v => before.includes(v));
    return fits ? { ...q, remembered: { value: q.kind === 'choice' ? a : a.filter(v => offered.includes(v)), at: memo.at } } : q;
  });
}
