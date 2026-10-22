#!/usr/bin/env node
// CI-1 failure classes (analysis; research/ci1-20261021/RESULT-CI1.md §5). Reads the local run records (outside git) and assigns every
// failing build one first cause, from the build outcome and the oracle's reasons in the first failing hidden world:
//   no-build        the arm refused, asked too often, or returned no valid workflow (unsupported, build_failed, too_many_questions, error)
//   run-error       the workflow was built but stopped in a hidden world (code error, missing reference, invalid input ...)
//   missing-effect  fewer messages / answers than the reference (a condition or a branch left something out)
//   extra-effect    more messages / answers than the reference (over-reach, wrong filter, duplicates)
//   wrong-content   right number of messages, but a message misses facts or mentions rows it should not
//   sheet-state     effects right, final sheet rows differ (missing write-back, wrong column, wrong format)
//   response        the answer to the caller differs
// Usage: node experiments/ci1/failures.mjs <label...> [--json out.json]
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNS = process.env.CI1_RUNS ?? '/var/tmp/foundry-work/ci1-20261021/runs';
export function classify(rec) {
  if (rec.pass) return null;
  if (rec.outcome !== 'ready') return { cls: 'no-build', detail: rec.outcome + (rec.error?.code ? ` ${rec.error.code}` : '') };
  const w = (rec.worlds ?? []).find(x => !x.pass);
  if (!w) return { cls: 'no-build', detail: 'no hidden world ran' };
  const reasons = w.reasons ?? [];
  const first = reasons[0] ?? '';
  if (w.status && w.status !== 'succeeded' && /did not finish/.test(first)) return { cls: 'run-error', detail: (w.error ?? first).slice(0, 120) };
  const count = /^(e-mail|chat) to (.+?): (\d+) sent, expected (\d+)/.exec(first);
  if (count) return { cls: Number(count[3]) < Number(count[4]) ? 'missing-effect' : 'extra-effect', detail: `${count[1]} ${count[3]}/${count[4]}` };
  const resp = /^responses: (\d+), expected (\d+)/.exec(first);
  if (resp) return { cls: Number(resp[1]) < Number(resp[2]) ? 'missing-effect' : 'extra-effect', detail: `responses ${resp[1]}/${resp[2]}` };
  if (/^(e-mail|chat) to .*no message carries/.test(first)) return { cls: 'wrong-content', detail: first.slice(0, 160) };
  if (/^response \d+:/.test(first)) return { cls: 'response', detail: first.slice(0, 160) };
  if (/^sheet /.test(first)) return { cls: 'sheet-state', detail: first.slice(0, 160) };
  if (/reference stopped with an error/.test(first)) return { cls: 'run-error', detail: first.slice(0, 120) };
  return { cls: 'other', detail: first.slice(0, 160) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const out = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  const labels = args.filter((x, i) => !x.startsWith('--') && args[i - 1] !== '--json');
  const all = {};
  for (const label of labels) {
    const dir = path.join(RUNS, label, 'records');
    if (!existsSync(dir)) { console.log(`${label}: no records`); continue; }
    const rows = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
    const fails = rows.map(r => ({ item: r.item, k: r.k, ...classify(r) })).filter(x => x.cls);
    const by = fails.reduce((m, f) => { m[f.cls] = (m[f.cls] ?? 0) + 1; return m; }, {});
    console.log(`${label}: ${rows.length} builds, ${fails.length} failing: ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    for (const f of fails.sort((a, b) => (a.item + a.k < b.item + b.k ? -1 : 1))) console.log(`  ${f.item} k${f.k} ${f.cls}: ${f.detail}`);
    all[label] = { builds: rows.length, failing: fails.length, byClass: by, fails };
  }
  if (out) writeFileSync(out, `${JSON.stringify(all, null, 1)}\n`);
}
