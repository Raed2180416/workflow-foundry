#!/usr/bin/env node
// Wave-2 failure classes per arm (analysis, $0): every build that fails the frozen oracle v2 gets every class its failing worlds show
// (a build can show several), by the root-causes of RESULT-CI1.md §9.2; "genuine" = it still fails the post hoc w2x rescoring.
//   node experiments/ci1-posthoc/w2-classes.mjs w2-A0 w2-A0t w2-A1c w2-A2
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNS = process.env.CI1_RUNS ?? '/var/tmp/foundry-work/ci1-20261021/runs';
const SUMMARIES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../research/ci1-20261021/runs');
export const CLASSES = [
  ['oracle: address case in a cell', (i, r) => i === '17771' && /customer_email/.test(r)],
  ['oracle: settings-row leak', (i, r) => i === '19014' && /only the right rows/.test(r)],
  ['oracle: shared first name leak', (i, r) => i === '18797' && /user@example\.com: no message carries only the right rows/.test(r)],
  ['oracle: message ID not asked for', (i, r) => i === '20090' && /body\.message misses/.test(r)],
  ['ambiguous: Evaluation Date format', (i, r) => i === '19187' && /Evaluation Date/.test(r)],
  ['ambiguous: duplicate clientId', (i, r) => i === '19014' && /body\.clientId/.test(r)],
  ['ambiguous: escaped answer', (i, r) => i === '17175' && /body\.phone is/.test(r)],
  ['ambiguous: logged name fallback', (i, r) => i === '17771' && /customer_name/.test(r)],
  ['builder: missing-list rules', (i, r) => i === '18281'],
  ['builder: placeholder in a data column', (i, r) => i === '19014' && /Start Date|Notes/.test(r)],
  ['builder: skipped-branch read', (i, r) => /MISSING_REFERENCE/.test(r)],
  ['builder: unasked sheet update', (i, r) => i === '18797' && /Reminder Count/.test(r)],
  ['builder: double-escaped code', (i, r) => /CODE_ERROR/.test(r)],
  ['builder: invalid after repair', (i, r) => /^outcome build_failed/.test(r)],
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const labels = process.argv.slice(2), table = new Map(CLASSES.map(([c]) => [c, {}]));
  const totals = {};
  for (const label of labels) {
    const w2x = new Map(JSON.parse(readFileSync(path.join(SUMMARIES, label, 'rescore-w2x.json'), 'utf8')).rows.map(x => [`${x.item}-k${x.k}`, x.w2x]));
    const dir = path.join(RUNS, label, 'records'); totals[label] = { fail: 0, genuine: 0, unclassified: [] };
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const rec = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); if (rec.pass) continue;
      totals[label].fail++; if (!w2x.get(`${rec.item}-k${rec.k}`)) totals[label].genuine++;
      const reasons = rec.outcome !== 'ready' ? [`outcome ${rec.outcome}`] : rec.worlds.filter(w => !w.pass).flatMap(w => w.reasons ?? []);
      const hit = CLASSES.filter(([, test]) => reasons.some(r => test(rec.item, r))).map(([c]) => c);
      if (!hit.length) totals[label].unclassified.push(`${rec.item}k${rec.k}`);
      for (const c of hit) table.get(c)[label] = (table.get(c)[label] ?? 0) + 1;
    }
  }
  console.log(`| Class | ${labels.join(' | ')} |`);
  for (const [c, v] of table) console.log(`| ${c} | ${labels.map(l => v[l] ?? '–').join(' | ')} |`);
  console.log(JSON.stringify(totals));
}
