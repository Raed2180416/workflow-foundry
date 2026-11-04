#!/usr/bin/env node
// False-pass audit of the oracle's one known blind spot (RESULT-CI1.md §2.3): a category label that is pure wording. On the two test
// items where the label decides what the recipient is told (17624: out of stock vs running low; 17878: friendly / firmer / final
// notice), every build that passes oracle v2 is rerun in every hidden world ($0) and each built message is checked against the
// reference message to the same recipient (same channel, matched by the item names it carries):
//   17624  reference "OUT OF STOCK" -> built says "out of stock"; reference "Running low" -> built says "low" and not "out of stock"
//   17878  reference final notice -> built says "final"; reference friendly or second reminder -> built does not say "final"
// A build with any mismatch in any hidden world is a false pass of the oracle. Analysis only; it changes no verdict.
//   node experiments/ci1-posthoc/label-audit.mjs <label...>
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BED, foundryCanon } from '../ci1/bed.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNS = process.env.CI1_RUNS ?? '/var/tmp/foundry-work/ci1-20261021/runs';
const SUMMARIES = path.join(here, '../../research/ci1-20261021/runs');

/** Label rules per item: pairs (reference message text, built message text) -> null or the mismatch. */
export const RULES = {
  '17624': (ref, built) => {
    const r = ref.toLowerCase(), b = built.toLowerCase();
    if (r.includes('out of stock')) return b.includes('out of stock') ? null : 'out-of-stock item not called out of stock';
    if (r.includes('running low')) return b.includes('out of stock') ? 'low item called out of stock' : b.includes('low') ? null : 'low item not called low';
    return null;
  },
  '17878': (ref, built) => {
    const r = ref.toLowerCase(), b = built.toLowerCase();
    if (r.includes('final notice')) return b.includes('final') ? null : 'final notice not called final';
    return b.includes('final') ? 'non-final reminder called final' : null;
  },
};
/** Pair each reference chat/mail message with a built one to the same recipient that carries the same item key (first id-like token). */
export function pairs(refList, builtList, keyOf) {
  const free = [...builtList], out = [];
  for (const m of refList) { const k = keyOf(m); const i = free.findIndex(b => b.dest === m.dest && (!k || b.text.toLowerCase().includes(k))); if (i >= 0) out.push([m, free.splice(i, 1)[0]]); }
  return out;
}
const msgs = c => [...c.mail.filter(m => !/^user@example\.com$/.test(m.to)).map(m => ({ dest: m.to, text: `${m.subject}\n${m.body}` })), ...c.chat.map(m => ({ dest: m.channel, text: m.text }))];
const keyOf17624 = m => (/(?:OUT OF STOCK|Running low):\s*([^(]+?)\s*\(/.exec(m.text)?.[1] ?? '').toLowerCase();
const keyOf17878 = m => (/INV-\d+/.exec(m.text)?.[0] ?? '').toLowerCase();

export async function auditBuild(item, workflow) {
  const oracle = JSON.parse(readFileSync(path.join(BED, 'oracle', `${item}.json`), 'utf8'));
  const bad = [];
  let paired = 0, refs = 0;
  for (const h of oracle.hidden) {
    const f = await foundryCanon(workflow, h.world);
    const ps = pairs(msgs(h.reference), msgs(f.canon), item === '17624' ? keyOf17624 : keyOf17878);
    refs += msgs(h.reference).length; paired += ps.length;
    for (const [r, b] of ps) { const why = RULES[item](r.text, b.text); if (why) bad.push({ world: h.world.id, why, built: b.text.slice(0, 160) }); }
  }
  return { bad, paired, refs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const label of process.argv.slice(2)) {
    const v2f = path.join(SUMMARIES, label, 'rescore-v2.json');
    const v2 = existsSync(v2f) ? new Map(JSON.parse(readFileSync(v2f, 'utf8')).rows.map(r => [`${r.item}-k${r.k}`, r.v2])) : new Map();
    for (const item of Object.keys(RULES)) for (let k = 0; k < 3; k++) {
      const f = path.join(RUNS, label, 'records', `${item}-k${k}.json`); if (!existsSync(f)) continue;
      const rec = JSON.parse(readFileSync(f, 'utf8'));
      const pass = v2.get(`${item}-k${k}`) ?? rec.pass; if (!pass || !rec.workflow) continue;
      const { bad, paired, refs } = await auditBuild(item, rec.workflow);
      console.log(JSON.stringify({ label, item, k, v1: rec.pass, v2: pass, paired: `${paired}/${refs}`, falsePass: bad.length > 0, mismatches: bad.length, first: bad[0] ?? null }));
    }
  }
}
