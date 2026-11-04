#!/usr/bin/env node
// POST HOC rescoring of CI-1 runs with oracle v2 (oracle-v2.mjs). On an item where v2's reference facts are a subset of v1's (changes
// 1-4 only remove required facts or widen the candidate side; change 5 adds a reference fact only where a reference number sits before
// a prose comma, checked per item by `monotone`), a build or world that passed v1 passes v2: only the v1-failing hidden worlds of
// v1-failing builds are rerun (the built workflow runs again in that world; $0). On an item that is not monotone every world of every
// ready build is rerun. Writes research/ci1-20261021/runs/<label>/rescore-v2.json.
//   node experiments/ci1-posthoc/rescore.mjs <label...>
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BED, foundryCanon } from '../ci1/bed.mjs';
import { equivalent, rowIdentities, factsOf } from '../ci1/canon.mjs';
import { equivalentV2, rowIdentitiesWithAddresses, categoricalColumns, POSTHOC_DECL, factsV2 } from './oracle-v2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNS = process.env.CI1_RUNS ?? '/var/tmp/foundry-work/ci1-20261021/runs';
const SUMMARIES = path.join(here, '../../research/ci1-20261021/runs');
const oracles = new Map();
const oracleOf = id => { if (!oracles.has(id)) oracles.set(id, JSON.parse(readFileSync(path.join(BED, 'oracle', `${id}.json`), 'utf8'))); return oracles.get(id); };

/** True when, on every hidden reference message and prose answer of the item, v2's required facts (before optional spans) equal v1's. */
export function monotone(id) {
  const o = oracleOf(id), vocab = new Set(o.decl.vocab);
  const texts = o.hidden.flatMap(h => [...h.reference.mail.map(m => `${m.subject}\n${m.body}`), ...h.reference.chat.map(m => m.text),
    ...h.reference.respond.filter(r => typeof r.body === 'string').map(r => r.body)]);
  return texts.every(t => factsV2(t, vocab).length === factsOf(t, vocab).length);
}
export async function rescoreRecord(rec) {
  if (rec.pass && monotone(rec.item)) return { v1: true, v2: true, rerun: 0, v1Check: true, worlds: [] };
  if (rec.outcome !== 'ready' || !rec.workflow) return { v1: false, v2: false, rerun: 0, v1Check: true, worlds: [] };
  const full = !monotone(rec.item);
  const o = oracleOf(rec.item), vocab = new Set(o.decl.vocab), post = POSTHOC_DECL[rec.item] ?? {};
  const categorical = categoricalColumns([...o.hidden.map(h => h.world), o.public.world]);
  const out = [];
  let v1Check = true;
  for (const w of rec.worlds) {
    if (w.pass && !full) { out.push({ id: w.id, v1: true, v2: true }); continue; }
    const h = o.hidden.find(x => x.world.id === w.id);
    // a Code step's 10 s wall clock can expire under host load (4 shared CPUs): rerun such a world up to twice, report the retries
    let f = await foundryCanon(rec.workflow, h.world), retries = 0;
    while (f.run.error?.code === 'CODE_TIMEOUT' && retries < 2) { retries++; f = await foundryCanon(rec.workflow, h.world); }
    const d1 = { vocab, rows: rowIdentities(h.world, vocab), mask: o.decl.mask, freeText: o.decl.freeText, respondCode: o.decl.respondCode };
    const e1 = equivalent(h.reference, f.canon, d1);
    const e2 = equivalentV2(h.reference, f.canon, { ...d1, rowsWithAddresses: rowIdentitiesWithAddresses(h.world, vocab, categorical), optional: post.optional });
    // the rerun disagrees with the recorded v1 verdict: reported with the recorded run error (a CODE_TIMEOUT recorded under host load
    // is a scoring-environment fault, not behaviour) and the rerun's status
    if (e1.pass !== !!w.pass) v1Check = false;
    out.push({ id: w.id, v1: e1.pass, v2: e2.pass, v2reasons: e2.reasons.slice(0, 3).map(r => r.slice(0, 200)), ...(retries ? { timeoutRetries: retries } : {}),
      ...(e1.pass !== !!w.pass ? { recordedError: w.error ?? null, rerunStatus: f.run.status } : {}),
      ...(f.run.error ? { rerunError: `${f.run.error.code ?? ''} ${String(f.run.error.message ?? '').slice(0, 120)}` } : {}) });
  }
  return { v1: !!rec.pass, v2: out.every(w => w.v2), rerun: full ? out.length : out.filter(w => !rec.worlds.find(x => x.id === w.id)?.pass).length, v1Check, worlds: out };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const label of process.argv.slice(2)) {
    const dir = path.join(RUNS, label, 'records');
    if (!existsSync(dir)) { console.log(`${label}: no records`); continue; }
    const rows = [];
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
      const rec = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      const r = await rescoreRecord(rec);
      rows.push({ item: rec.item, k: rec.k, outcome: rec.outcome, ...r });
      if (!r.v1 && r.v2) process.stderr.write(`${label} ${rec.item} k${rec.k}: v1 fail -> v2 pass\n`);
    }
    const summary = { label, oracle: 'v2 (post hoc: addressee exemption, categorical cells, declared optional spans, numeric d/m/y dates)', decl: POSTHOC_DECL, builds: rows.length,
      v1Pass: rows.filter(r => r.v1).length, v2Pass: rows.filter(r => r.v2).length, v1Reproduced: rows.every(r => r.v1Check), rows };
    writeFileSync(path.join(SUMMARIES, label, 'rescore-v2.json'), `${JSON.stringify(summary, null, 1)}\n`);
    console.log(`${label}: v1 ${summary.v1Pass}/${rows.length}, v2 ${summary.v2Pass}/${rows.length}, v1 verdicts reproduced: ${summary.v1Reproduced}`);
  }
}
