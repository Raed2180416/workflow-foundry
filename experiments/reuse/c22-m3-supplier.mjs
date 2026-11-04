#!/usr/bin/env node
// POST-HOC analysis note for C2-2 (review of 2026-11-04, finding 1, blocker for the "M3 serve" claim). PREREG-C2-2 §3
// clustered the M3 rule's admitted decisions by shipment. The gate admits or refuses whole suppliers, and its errors are
// perfectly correlated within a supplier (T1: 17 of 17 wrong), so the unit of independent evidence is the supplier. This
// recomputes M3 on every gate's admitted stream decisions three ways: by shipment (as preregistered; reproduces
// summary-c22.json), by supplier at the rule's rho floor 0.1, and by supplier with rho = 1 (each admitted supplier one
// decision). It reads the same run records as `c22.mjs analyze` and changes no frozen file. $0.
//   node experiments/reuse/c22-m3-supplier.mjs   -> research/reuse-20261021/runs/c2-2/m3-supplier-c22.json
import path from 'node:path';
import { ctxOf, PROVEN_ID } from './c2.mjs';
import { loadProfiles } from './registry.mjs';
import { subtaskOf } from './gen-b.mjs';
import { historyOf, kindOf } from './gen-c22.mjs';
import { gateVerdicts, GATE_LIST, LIVE, MANIFEST_FILE, OUT } from './c22.mjs';
import { m3Views } from './posthoc.mjs';
import { readJson, readJsonl, writeJson } from './lib.mjs';

const ctx = ctxOf('c2-1', 'test');
const profiles = loadProfiles(ctx.registry.get(PROVEN_ID));
const m = readJson(MANIFEST_FILE);
const byId = new Map(m.products.map(p => [p.id, p]));
const histRecs = new Map(readJsonl(path.join(LIVE, 'history.jsonl')).map(r => [r.id, r]));
const hist = new Map(Object.keys(m.sources).map(s => [s, historyOf(m, s).map(p => ({ ...histRecs.get(p.id), task: subtaskOf(p, ctx.bankTexts) }))]));
const stream = readJsonl(path.join(LIVE, 'stream.jsonl')).map(r => ({ ...r, task: subtaskOf(byId.get(r.id), ctx.bankTexts) }));
const verdicts = gateVerdicts({ profiles, hist, stream });
const subsets = { all: null, c21Kinds: Object.keys(m.sources).filter(s => kindOf(s).kind === 'c2-1'), withoutT1: Object.keys(m.sources).filter(s => s !== 'T1') };
const gates = Object.fromEntries(GATE_LIST.map(g => [g, Object.fromEntries(Object.entries(subsets).map(([name, srcs]) => {
  const admitted = verdicts.filter(v => (!srcs || srcs.includes(v.source)) && v.gates[g]).map(v => ({ parent: v.shipment, entry: PROVEN_ID, source: v.source, wrong: !v.correct }));
  return [name, { accepted: admitted.length, wrong: admitted.filter(d => d.wrong).length, m3: m3Views(admitted) }];
}))]));
const out = { kind: 'c22-m3-supplier', note: 'POST-HOC analysis note (2026-11-04, review finding 1): M3 on admitted decisions clustered by the admission unit (supplier); the preregistered shipment clustering is kept beside it',
  manifestSha256: m.sha256, gates };
writeJson(path.join(OUT, 'm3-supplier-c22.json'), out);
const p = gates['G0-M3+b3c'];
for (const [k, v] of Object.entries(p)) console.log(`G0-M3+b3c ${k}: ${v.accepted} accepted, ${v.wrong} wrong; shipment ${v.m3?.parentExact.decision} (${v.m3?.parentExact.upper?.toFixed(3)}); supplier ${v.m3?.supplierExact.decision} (${v.m3?.supplierExact.upper?.toFixed(3)}, ${v.m3?.supplierExact.suppliers} suppliers); rho=1 ${v.m3?.supplierExactRho1.upper?.toFixed(3)}`);
