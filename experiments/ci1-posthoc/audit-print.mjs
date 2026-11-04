#!/usr/bin/env node
// Description-entailment audit helper (analysis, $0): for one bed item, print the description, then for the first N hidden worlds that
// have outside effects, the reference messages with the facts oracle v1 requires of them. The auditor reads the description alone and
// marks every required fact the description does not ask for, and every message count it does not decide (RESULT-CI1.md §4).
//   node experiments/ci1-posthoc/audit-print.mjs <item> [N=2]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BED } from '../ci1/bed.mjs';
import { factsOf } from '../ci1/canon.mjs';

const [item, nArg] = process.argv.slice(2);
const N = Number(nArg ?? 2);
const oracle = JSON.parse(readFileSync(path.join(BED, 'oracle', `${item}.json`), 'utf8'));
const vocab = new Set(oracle.decl.vocab);
console.log(`# ${item}\n${readFileSync(path.join(BED, 'items', item, 'description.md'), 'utf8')}`);
const withEffects = oracle.hidden.filter(h => h.reference.mail.length + h.reference.chat.length + h.reference.respond.length > 0);
console.log(`hidden worlds ${oracle.hidden.length}, with outside effects ${withEffects.length}; decl mask ${JSON.stringify(oracle.decl.mask ?? {})} freeText ${JSON.stringify(oracle.decl.freeText ?? {})}`);
for (const h of withEffects.slice(0, N)) {
  console.log(`\n## world ${h.world.id} now ${h.world.now}`);
  for (const m of h.reference.mail) console.log(`MAIL to ${m.to}\n  subject: ${m.subject}\n  body: ${m.body.replace(/\n/g, ' | ')}\n  FACTS ${JSON.stringify(factsOf(`${m.subject}\n${m.body}`, vocab))}`);
  for (const m of h.reference.chat) console.log(`CHAT ${m.channel}\n  text: ${m.text.replace(/\n/g, ' | ')}\n  FACTS ${JSON.stringify(factsOf(m.text, vocab))}`);
  for (const r of h.reference.respond) console.log(`RESPOND ${r.code}: ${JSON.stringify(r.body).slice(0, 600)}`);
}
