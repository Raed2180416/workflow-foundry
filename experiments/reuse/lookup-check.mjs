#!/usr/bin/env node
// $0 check of program B's registry lookup (lookup-b.mjs) against the registries the C2 runs used (review finding 3).
// For every supplier of C2-1's test set and of C2-2, B computes its own contract (its procedure text, its tool catalog,
// the input columns of its own sub-task, its output column), looks it up with the supplier as source and applies the
// declared choice rule. The check passes when the chosen entry is the one the runs fetched by id (PROVEN_ID), with the
// same artifact hash. It also records three misses: one changed character in the procedure text, a tool description
// changed, and the input columns in another order.
//   node experiments/reuse/lookup-check.mjs        -> research/reuse-20261021/runs/c2-1/lookup-check.json
import path from 'node:path';
import { ctxOf, PROVEN_ID } from './c2.mjs';
import { subtaskOf } from './gen-b.mjs';
import { contractOfB, lookupForReuse, CHOICE_RULE } from './lookup-b.mjs';
import { RESEARCH, readJson, writeJson } from './lib.mjs';

const ctx = ctxOf('c2-1', 'test');
const c22 = readJson(path.join(RESEARCH, 'runs', 'c2-2', 'manifest-c22.json'));
const inputColumns = Object.keys(subtaskOf(ctx.manifest.products[0], ctx.bankTexts).inputs);
const b = contractOfB({ procedureText: ctx.sopText, catalog: ctx.catalog, inputColumns });
const fetched = ctx.registry.get(PROVEN_ID);
const perSource = {};
for (const [set, sources] of [['c2-1 test', Object.keys(ctx.manifest.sources)], ['c2-2', Object.keys(c22.sources)]]) {
  for (const source of sources) {
    const r = lookupForReuse(ctx.registry, { hash: b.hash, source });
    perSource[`${set}:${source}`] = { candidates: r.candidates, chosen: r.chosen?.id ?? null, sameAsFetched: r.chosen?.id === PROVEN_ID && r.chosen?.artifact.sha256 === fetched.artifact.sha256, own: r.own };
  }
}
const miss = variant => { const h = contractOfB(variant).hash; return { hash: h, hit: h === b.hash, chosen: lookupForReuse(ctx.registry, { hash: h, source: 'S0' }).chosen?.id ?? null }; };
const misses = {
  procedureOneChar: miss({ procedureText: ctx.sopText.replace(/\.(?=[^.]*$)/, ','), catalog: ctx.catalog, inputColumns }),
  toolDescription: miss({ procedureText: ctx.sopText, catalog: ctx.catalog.map((t, i) => (i ? t : { ...t, description: `${t.description ?? ''} ` })), inputColumns }),
  inputColumnOrder: miss({ procedureText: ctx.sopText, catalog: ctx.catalog, inputColumns: [...inputColumns].reverse() }),
};
const out = { kind: 'c2-lookup-check', note: 'POST-HOC ($0, 2026-11-04): B\'s own contract lookup with the declared choice rule, against the C2 registry the runs fetched by id', rule: CHOICE_RULE,
  bContractHash: b.hash, entryContractHash: fetched.contractHash, contractMatches: b.hash === fetched.contractHash, inputColumns,
  allChoseFetchedEntry: Object.values(perSource).every(x => x.sameAsFetched), perSource, misses };
writeJson(path.join(RESEARCH, 'runs', 'c2-1', 'lookup-check.json'), out);
console.log(JSON.stringify({ contractMatches: out.contractMatches, allChoseFetchedEntry: out.allChoseFetchedEntry, misses: Object.fromEntries(Object.entries(misses).map(([k, v]) => [k, v.hit])) }));
