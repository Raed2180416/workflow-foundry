#!/usr/bin/env node
// Which retrieved pattern cards went with a gain (EXPLORATORY, $0): for every card that A2's retrieval showed on an item, the paired
// per-item difference A2 - A1c in pass@1 over the items where it was shown, and the same over the items where it was not. Association
// only: cards co-occur and items differ, so the causal reading comes from the leave-one-pattern-out reruns (run-arm.mjs --drop).
//   node experiments/ci1-posthoc/pattern-association.mjs <A2 label> <A1c label> [--oracle v2] [--exclude id,...]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { perItem } from '../ci1/report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNS = process.env.CI1_RUNS ?? '/var/tmp/foundry-work/ci1-20261021/runs';
const SUMMARIES = path.join(here, '../../research/ci1-20261021/runs');

export function records(label, { v2 = false } = {}) {
  const dir = path.join(RUNS, label, 'records');
  if (!existsSync(dir)) throw new Error(`no records for ${label}`);
  let recs = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
  if (v2) { const r = JSON.parse(readFileSync(path.join(SUMMARIES, label, 'rescore-v2.json'), 'utf8')); const by = new Map(r.rows.map(x => [`${x.item}-k${x.k}`, x.v2])); recs = recs.map(x => ({ ...x, pass: by.get(`${x.item}-k${x.k}`) ?? x.pass })); }
  return recs;
}
/** card id -> { name, items: Set } from the first retrieval round of every A2 record. */
export function cardsShown(recs) {
  const out = new Map();
  for (const r of recs) for (const p of r.retrieval?.rounds?.[0]?.patterns ?? []) {
    const x = out.get(p.id) ?? { name: p.name, items: new Set() }; x.items.add(r.item); out.set(p.id, x);
  }
  return out;
}
export function association(a2, a1c) {
  const A = new Map(perItem(a2).map(x => [x.item, x.p1])), B = new Map(perItem(a1c).map(x => [x.item, x.p1]));
  const items = [...A.keys()].filter(k => B.has(k));
  const diff = k => A.get(k) - B.get(k);
  const avg = ks => (ks.length ? ks.reduce((s, k) => s + diff(k), 0) / ks.length : null);
  return [...cardsShown(a2)].map(([id, c]) => {
    const on = items.filter(k => c.items.has(k)), off = items.filter(k => !c.items.has(k));
    return { id, name: c.name, shownOn: on.length, diffShown: avg(on), diffNotShown: avg(off), gainItems: on.filter(k => diff(k) > 0), lossItems: on.filter(k => diff(k) < 0) };
  }).sort((x, y) => y.shownOn - x.shownOn);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const v2 = args.includes('--oracle') && args[args.indexOf('--oracle') + 1] === 'v2';
  const drop = args.includes('--exclude') ? args[args.indexOf('--exclude') + 1].split(',') : [];
  const [a2l, a1l] = args.filter((x, i) => !x.startsWith('--') && !['--oracle', '--exclude'].includes(args[i - 1]));
  const keep = r => !drop.includes(r.item);
  const rows = association(records(a2l, { v2 }).filter(keep), records(a1l, { v2 }).filter(keep));
  const f = x => (x === null ? '-' : `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}`);
  console.log('| Card | Shown on items | A2 - A1c where shown (points) | where not shown | items with a gain | items with a loss |\n|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.id} ${r.name} | ${r.shownOn} | ${f(r.diffShown)} | ${f(r.diffNotShown)} | ${r.gainItems.join(', ') || '-'} | ${r.lossItems.join(', ') || '-'} |`);
}
