#!/usr/bin/env node
// CI-1 bed summary (analysis): one row per frozen item from the oracles, specs and the pool census. Prints a markdown table and totals.
//   node experiments/ci1/bed-summary.mjs [--json out.json]
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BED } from './bed.mjs';
import { POOL_FILE } from './retrieve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const split = JSON.parse(readFileSync(path.join(here, '../../research/ci1-20261021/SPLIT.json'), 'utf8'));
const pool = existsSync(POOL_FILE) ? JSON.parse(readFileSync(POOL_FILE, 'utf8')) : [];
const rows = [];
for (const [s, ids] of [['dev', split.dev], ['test', split.test]]) for (const id of ids) {
  const o = JSON.parse(readFileSync(path.join(BED, 'oracle', `${id}.json`), 'utf8'));
  const spec = JSON.parse(readFileSync(path.join(BED, 'items', id, 'spec.json'), 'utf8'));
  const p = pool.find(r => r.id === id) ?? {};
  const eff = o.hidden.reduce((a, h) => ({ mail: a.mail + h.reference.mail.length, chat: a.chat + h.reference.chat.length, respond: a.respond + h.reference.respond.length, empty: a.empty + (h.reference.mail.length + h.reference.chat.length + h.reference.respond.length === 0 ? 1 : 0) }), { mail: 0, chat: 0, respond: 0, empty: 0 });
  rows.push({ id, split: s, trigger: spec.workspace.trigger.kind, created: (p.createdAt ?? '').slice(0, 10), post: (p.createdAt ?? '') >= '2026-07-01', nodes: p.n, code: p.code,
    patches: (spec.patches ?? []).length, hidden: o.hidden.length, mutants: o.mutation.total, killable: o.mutation.killable, killed: o.mutation.killedByHidden,
    survivors: o.mutation.survivors.length, agreement: `${o.agreement.pass}/${o.agreement.of}`, effects: eff });
}
console.log('| Item | Split | Trigger | Created | Nodes (code) | Patches | Hidden worlds (no effect) | Effects in hidden worlds (mail / chat / answers) | Mutants killed / killable / total | Two-reference agreement |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.id} | ${r.split} | ${r.trigger} | ${r.created}${r.post ? '' : ' (pre)'} | ${r.nodes} (${r.code}) | ${r.patches} | ${r.hidden} (${r.effects.empty}) | ${r.effects.mail} / ${r.effects.chat} / ${r.effects.respond} | ${r.killed} / ${r.killable} / ${r.mutants} | ${r.agreement} |`);
const sum = k => rows.reduce((s, r) => s + r[k], 0);
const med = xs => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
console.log(`\nItems ${rows.length}; mutants ${sum('mutants')}, killable ${sum('killable')}, killed by hidden worlds ${sum('killed')}; median per-item score over all mutants ${med(rows.map(r => r.killed / r.mutants)).toFixed(2)}, over killable ${med(rows.map(r => r.killed / r.killable)).toFixed(2)}; patches ${sum('patches')} on ${rows.filter(r => r.patches).length} items.`);
const out = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
if (out) writeFileSync(out, `${JSON.stringify(rows, null, 1)}\n`);
