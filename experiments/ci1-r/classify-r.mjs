#!/usr/bin/env node
// First-pass failure classes of the review arms under the corrected oracle (PREREG-CI1-R §7 step 5), from committed files only ($0):
// wave 1 from runs/<label>/rescore-v2.json (v2 reasons of every rerun world; the two ambiguous items are left out), wave 2 from
// runs/<label>/rescore-w2x.json, plus the summary's first failure for builds that never ran (build_failed, refused). The rules name
// the classes root-causing found on the earlier arms (RESULT-CI1.md §5, §9.2); a failure no rule names is listed as "read" and is
// root-caused by hand (diag.mjs / diag-w2.mjs) before anything is claimed from it.
//   node experiments/ci1-r/classify-r.mjs test-R-A2b w2-R-A2b ... [--json out.json]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SUM = path.join(here, '../../research/ci1-20261021/runs');
const AMBIGUOUS_W1 = ['16312', '17545'];
export const RULES = Object.freeze([
  ['environment: Code step timeout under load', (t) => /CODE_TIMEOUT/.test(t)],
  ['builder: reads a skipped branch (MISSING_REFERENCE)', (t) => /MISSING_REFERENCE/.test(t)],
  ['builder: code does not parse or throws (CODE_ERROR)', (t) => /CODE_ERROR|SyntaxError/.test(t)],
  ['builder: its own acceptance failed after the effects', (t) => /ACCEPTANCE_FAILED/.test(t)],
  ['builder: no valid workflow (build_failed / refused / questions)', (t, r) => ['build_failed', 'unsupported', 'too_many_questions', 'error'].includes(r.outcome)],
  ['builder: 18281 phone with < 7 digits not listed as missing', (t, r) => r.item === '18281' && /missing/.test(t)],
  ['builder: 17878 skips an unpaid invoice (unstated filter)', (t, r) => r.item === '17878' && /talia|0 sent, expected 1/i.test(t)],
  ['builder: 19014 placeholders written into Start Date / Notes', (t, r) => r.item === '19014' && /Start Date|Notes/.test(t)],
  ['builder: 18797 writes reminder columns not asked for', (t, r) => r.item === '18797' && /Reminder Count|Last Reminder Date|writes columns/.test(t)],
  ['read: count of messages or rows differs', (t) => /sent, expected|rows, expected|responses: \d+, expected/.test(t)],
  ['read: a message lacks facts', (t) => /carries the facts|missing facts|misses \[/.test(t)],
  ['read: a message mentions rows the reference leaves out', (t) => /row\(s\) the reference leaves out/.test(t)],
  ['read: a sheet row differs', (t) => /no row matches|writes columns/.test(t)],
  ['read: an answer differs', (t) => /response \d+:/.test(t)],
]);
export const classify = (text, rec) => (RULES.find(([, f]) => f(text, rec)) ?? ['read: other'])[0];

export function failures(label) {
  const s = JSON.parse(readFileSync(path.join(SUM, label, 'summary.json'), 'utf8'));
  const wave2 = label.startsWith('w2-');
  const rf = path.join(SUM, label, wave2 ? 'rescore-w2x.json' : 'rescore-v2.json');
  if (!existsSync(rf)) throw new Error(`${label}: run the rescorer first (${path.basename(rf)})`);
  const rows = new Map(JSON.parse(readFileSync(rf, 'utf8')).rows.map(r => [`${r.item}-k${r.k}`, r]));
  const out = [];
  for (const rec of s.records) {
    if (!wave2 && AMBIGUOUS_W1.includes(rec.item)) continue;
    const r = rows.get(`${rec.item}-k${rec.k}`); const pass = wave2 ? r?.w2x : r?.v2;
    if (pass) continue;
    const worldReasons = (r?.worlds ?? []).filter(w => (wave2 ? w.w2x === false : w.v2 === false)).flatMap(w => (wave2 ? w.reasons : w.v2reasons) ?? []);
    const text = [...worldReasons, ...(rec.firstFailure?.reasons ?? []), rec.firstFailure?.error ?? '', rec.firstFailure?.outcome ?? ''].join(' | ');
    out.push({ label, item: rec.item, k: rec.k, outcome: rec.outcome, cls: classify(text, rec), text: text.slice(0, 300) });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), json = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  const labels = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json');
  const all = labels.flatMap(failures);
  const byArm = {};
  for (const f of all) { const arm = f.label.replace(/^(test|w2)-R-/, ''); byArm[arm] ??= {}; byArm[arm][f.cls] = (byArm[arm][f.cls] ?? 0) + 1; }
  const classes = [...new Set(all.map(f => f.cls))].sort();
  const arms = Object.keys(byArm);
  console.log(`| Class | ${arms.join(' | ')} |\n|---|${arms.map(() => '---').join('|')}|`);
  for (const c of classes) console.log(`| ${c} | ${arms.map(a => byArm[a][c] ?? 0).join(' | ')} |`);
  console.log(`| failing builds (corrected oracle) | ${arms.map(a => Object.values(byArm[a]).reduce((s, n) => s + n, 0)).join(' | ')} |`);
  for (const f of all.filter(x => x.cls.startsWith('read'))) console.log(`  read: ${f.label} ${f.item} k${f.k}: ${f.text.slice(0, 220)}`);
  if (json) writeFileSync(json, `${JSON.stringify({ failures: all }, null, 1)}\n`);
}
