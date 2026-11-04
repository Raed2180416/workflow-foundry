#!/usr/bin/env node
// One line per frozen wave-2 oracle (analysis, $0): hidden worlds, public world, mutants killed / killable / total, two-reference
// agreement (v2 and v1), reference effects in the hidden worlds, categorical columns, and the oracle file's sha256.
//   CI1_BED=/var/tmp/foundry-work/ci1-20261021/bed-w2 node experiments/ci1-w2/oracle-summary.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { BED } from '../ci1/bed.mjs';

for (const f of readdirSync(path.join(BED, 'oracle')).filter(f => f.endsWith('.json')).sort()) {
  const text = readFileSync(path.join(BED, 'oracle', f), 'utf8'), o = JSON.parse(text);
  const eff = o.hidden.reduce((a, h) => ({ mail: a.mail + h.reference.mail.length, chat: a.chat + h.reference.chat.length, respond: a.respond + h.reference.respond.length,
    none: a.none + (h.reference.mail.length + h.reference.chat.length + h.reference.respond.length === 0 ? 1 : 0) }), { mail: 0, chat: 0, respond: 0, none: 0 });
  console.log(JSON.stringify({ id: o.id, schema: o.schema, hidden: o.hidden.length, public: o.public.world.id, mutants: `${o.mutation.killedByHidden}/${o.mutation.killable}/${o.mutation.total}`,
    agreement: `${o.agreement.pass}/${o.agreement.of} (v1 ${o.agreement.v1Pass})`, effects: eff, categorical: o.decl.categorical, sha256: createHash('sha256').update(text).digest('hex').slice(0, 16) }));
}
