#!/usr/bin/env node
// The corpus as an intent prior: P(latent feature | task family) over research/corpus-20261006/items.jsonl. $0, no model.
//
//   node experiments/intent/corpus-prior.mjs [--items FILE] [--json OUT [--per-item]] [--md OUT] [--min 15]
//
// Families are slice/trigger (features.mjs). Each cell gives n, the count with the feature, the share and a Wilson 95%
// interval. Every table also gives the description provenance mix (original / written / recovered-by-model) and the
// model-read share, because those decide what the family's items can be used for: a `written` description was
// generated from the graph's features by our normaliser, so it can never serve as a request (it would leak the answer),
// while the graph-based detection below is unaffected by it. The audit sample lists seeded positives with the evidence
// string, for a human precision check before any claim (DESIGN.md §5).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng } from '../../beds/lib/rng.mjs';
import { detect, FEATURES, familyOf, sliceOf, connectorGroupOf } from './features.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ITEMS = path.resolve(here, '../../research/corpus-20261006/items.jsonl');

export function loadItems(file = ITEMS) { return readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l)); }

/** Wilson 95% interval for k of n. */
export function wilson(k, n, z = 1.96) {
  if (!n) return [null, null];
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}

function cell(rows) {
  const n = rows.length, out = { n, provenance: {}, modelRead: rows.filter(r => r.modelRead).length, features: {} };
  for (const r of rows) out.provenance[r.provenance] = (out.provenance[r.provenance] ?? 0) + 1;
  for (const f of FEATURES) {
    const app = rows.filter(r => r.has[f] !== null), k = app.filter(r => r.has[f]).length;
    out.features[f] = app.length ? { k, n: app.length, p: k / app.length, ci: wilson(k, app.length) } : { k: 0, n: 0, p: null, ci: [null, null] };
  }
  return out;
}

function groupBy(rows, key) { const m = new Map(); for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; }

export function corpusPrior(items, { min = 15, auditPerFeature = 8, seed = 20261021 } = {}) {
  const rows = items.map(it => {
    const d = detect(it);
    return { id: it.id, platform: it.source.platform, slice: sliceOf(it.source.platform), family: familyOf(it), connectors: connectorGroupOf(it),
      provenance: it.description?.provenance ?? 'none', modelRead: !!it.source?.extraction, oracle: it.oracle?.kind ?? 'none', has: d.has, evidence: d.evidence };
  });
  const tab = (key, minN) => [...groupBy(rows, key)].map(([k, rs]) => ({ key: k, ...cell(rs) })).filter(c => c.n >= minN).sort((a, b) => b.n - a.n);
  const r = rng('intent/corpus-prior/audit', seed);
  const audit = Object.fromEntries(FEATURES.map(f => [f, r.sample(rows.filter(x => x.has[f]), auditPerFeature).map(x => ({ id: x.id, evidence: x.evidence[f] }))]));
  return {
    version: 'intent-corpus-prior/1', items: rows.length, min,
    overall: cell(rows),
    bySlice: tab(x => x.slice, 1),
    byFamily: tab(x => x.family, min),
    byProvenance: tab(x => x.provenance, 1),
    automationByConnector: tab(x => (x.slice === 'automation' ? x.connectors : null), 10).filter(c => c.key !== null && c.key !== 'null'),
    audit,
    perItem: rows.map(({ id, family, provenance, has }) => ({ id, family, provenance, has })),
  };
}

const pct = x => (x === null ? 'n/a' : `${Math.round(100 * x)}%`);
const SHORT = { 'error-handling': 'error', retries: 'retry', idempotency: 'idem', 'failure-notification': 'fail-notify', 'human-approval': 'approval', 'recurring-schedule': 'schedule', 'logging-audit': 'log/audit', 'sub-workflows': 'subwf', timeouts: 'timeout' };

export function markdownTable(cells, label) {
  const head = `| ${label} | n | orig / written / rec | ${FEATURES.map(f => SHORT[f]).join(' | ')} |`;
  const sep = `|---|---|---|${FEATURES.map(() => '---').join('|')}|`;
  const body = cells.map(c => `| ${c.key} | ${c.n} | ${c.provenance.original ?? 0} / ${c.provenance.written ?? 0} / ${c.provenance['recovered-by-model'] ?? 0} | ${FEATURES.map(f => (c.features[f].n === 0 ? 'n/a' : `${pct(c.features[f].p)} (${c.features[f].k})`)).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const prior = corpusPrior(loadItems(arg('--items', ITEMS)), { min: Number(arg('--min', '15')) });
  const md = [`Corpus latent-feature prior (${prior.items} items; lexical detectors over normalised graphs; share (count); n/a = not applicable).`, '',
    markdownTable([{ key: 'all', ...prior.overall }], 'corpus'), '', markdownTable(prior.bySlice, 'slice'), '', markdownTable(prior.byFamily, 'family (slice/trigger)'), '',
    markdownTable(prior.byProvenance, 'description provenance'), '', markdownTable(prior.automationByConnector, 'automation by connector group')].join('\n');
  const { perItem, ...slim } = prior;
  if (arg('--json')) writeFileSync(arg('--json'), `${JSON.stringify(process.argv.includes('--per-item') ? prior : slim, null, 1)}\n`);
  if (arg('--md')) writeFileSync(arg('--md'), `${md}\n`);
  console.log(md);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
