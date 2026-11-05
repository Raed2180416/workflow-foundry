#!/usr/bin/env node
// Why did the E8 binder decline (inspection / not-a-condition)? Each declined condition is sorted into one cause by the analyst rules
// below (keywords of the binder's own reason, checked by hand: RESULT-TRACKER.md §6). No model call.
//   node experiments/tracker-v2/e8-inspection.mjs [--list]
import { readFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve('research/tracker-20261021/e8');
const bind = JSON.parse(readFileSync(path.join(dir, 'bind-claude-haiku-5-5.json'), 'utf8'));
const conds = Object.fromEntries(JSON.parse(readFileSync(path.join(dir, 'conditions-s0rule.json'), 'utf8')).conditions.map(c => [c.id, c]));
// Order matters: the first rule that matches decides.
const RULES = [
  ['background (no requirement on the run)', d => d.decision === 'not-a-condition'],
  ['needs a value from reference data (rulebook, policy, calendar, carrier codes, editions)', d => /rulebook|policy|carrier[- ]codes|translat|edition|calendar|collectionTime|cutoff|customerActionHours|fraudReviewHours|feeMinor|unitPrice|table/i.test(d.why)],
  ['needs a computed deadline or time relative to another event', d => /deadline|\bD\b|window .*anchor|anchored|relative to|emission time|computed|timer|time of the answer|answer.s time|after D|at D/i.test(d.why)],
  ['needs a field the vocabulary lacks (read results, reasons, states, instance decisions)', d => /not a listed|no listed (field|column|channel)|not recorded|not listed|no .*field|is not a listed column|no record/i.test(d.why)],
  ['needs the case\'s state at a moment, or "nothing after X" per case', d => /after|status at|state|already|changes nothing|no effect|moot|omission|stop|unclear/i.test(d.why)],
  ['needs a quantifier or aggregate across items or effects (every, sum, all ended, compare keys)', d => /every|sum|Σ|across|compare|all of|each item of|several|set|key/i.test(d.why)],
  ['schedule, platform or code behaviour (not an effect)', d => /platform|schedule|code|routing|instance|format|timezone|capability/i.test(d.why)],
  ['other', () => true],
];
const out = {};
for (const [id, d] of Object.entries(bind.conditions)) {
  if (d.decision === 'check') continue;
  const cause = RULES.find(([, f]) => f({ ...d, why: d.why ?? '' }))[0];
  (out[cause] ??= []).push(id);
}
const total = Object.keys(bind.conditions).length;
console.log(`E8: ${total} conditions; check ${Object.values(bind.conditions).filter(d => d.decision === 'check').length}; declined by cause:`);
for (const [cause, ids] of Object.entries(out)) console.log(`  ${String(ids.length).padStart(3)}  ${cause}`);
if (process.argv.includes('--list')) for (const [cause, ids] of Object.entries(out)) { console.log(`\n## ${cause}`); for (const id of ids) console.log(`  ${id} "${String(conds[id]?.quote).slice(0, 90)}" :: ${String(bind.conditions[id].why).slice(0, 160)}`); }
