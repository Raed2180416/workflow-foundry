#!/usr/bin/env node
// Root-cause helper (analysis, $0): rerun one recorded build in one hidden world and print the reference's canonical effects beside
// the built workflow's, with oracle v1's reasons. Used to root-cause every failing test build (research/ci1-20261021/RESULT-CI1.md §5).
//   node experiments/ci1-posthoc/diag.mjs <label> <item> <k> [world id | --all] [--workflow] [--description]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BED, foundryCanon } from '../ci1/bed.mjs';
import { equivalent, rowIdentities, factsOf } from '../ci1/canon.mjs';

const RUNS = process.env.CI1_RUNS ?? '/var/tmp/foundry-work/ci1-20261021/runs';
const [label, item, k, worldArg] = process.argv.slice(2);
const flags = new Set(process.argv.slice(2).filter(x => x.startsWith('--')));
const rec = JSON.parse(readFileSync(path.join(RUNS, label, 'records', `${item}-k${k}.json`), 'utf8'));
const oracle = JSON.parse(readFileSync(path.join(BED, 'oracle', `${item}.json`), 'utf8'));
const vocab = new Set(oracle.decl.vocab);
if (flags.has('--description')) console.log(`# description\n${readFileSync(path.join(BED, 'items', item, 'description.md'), 'utf8')}\n`);
if (flags.has('--workflow')) console.log(`# workflow\n${JSON.stringify(rec.workflow, null, 1)}\n`);
console.log(`# ${label} ${item} k${k}: outcome ${rec.outcome} pass ${rec.pass}; worlds ${rec.worlds.map(w => `${w.id}:${w.pass ? 'ok' : 'FAIL'}`).join(' ')}`);
const ids = worldArg && !worldArg.startsWith('--') ? [worldArg] : flags.has('--all') ? oracle.hidden.map(h => h.world.id) : rec.worlds.filter(w => !w.pass).slice(0, 1).map(w => w.id);
const show = c => JSON.stringify({ ok: c.ok, error: c.error, mail: c.mail, chat: c.chat, respond: c.respond, sheets: c.sheets }, null, 1);
for (const id of ids) {
  const h = oracle.hidden.find(x => x.world.id === id);
  const f = await foundryCanon(rec.workflow, h.world);
  const e = equivalent(h.reference, f.canon, { vocab, rows: rowIdentities(h.world, vocab), mask: oracle.decl.mask, freeText: oracle.decl.freeText, respondCode: oracle.decl.respondCode });
  console.log(`\n## world ${id}: v1 ${e.pass ? 'pass' : 'FAIL'}\n${e.reasons.join('\n')}`);
  console.log(`### world data\n${JSON.stringify({ now: h.world.now, event: h.world.event, sheets: h.world.sheets }, null, 1).slice(0, 6000)}`);
  console.log(`### reference effects\n${show(h.reference)}`);
  for (const m of h.reference.mail ?? []) console.log(`  facts of reference mail to ${m.to}: ${JSON.stringify(factsOf(`${m.subject}\n${m.body}`, vocab))}`);
  for (const m of h.reference.chat ?? []) console.log(`  facts of reference chat to ${m.channel}: ${JSON.stringify(factsOf(m.text, vocab))}`);
  console.log(`### built effects (status ${f.run.status}${f.run.error ? `, ${f.run.error.code} ${f.run.error.message}` : ''})\n${show(f.canon)}`);
}
