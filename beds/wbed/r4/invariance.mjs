// Witness of W-bed rung R4 "group consolidation" (ATTACK-20261014 §3 M1 b; PROOF-LEDGER K3). No group-level relation is
// declared here: the packs carry R1's and R3's own relations (beds/wbed/r1, r3 invariance.mjs), which apply to a pack as a
// child task. Host code beside the oracle; contract: beds/lib/metamorphic.mjs.
import { capped, witnessDescriptor } from '../../lib/metamorphic.mjs';
import { witnessCheckReport } from '../r1/invariance.mjs';
import { witnessCheckAudit } from '../r3/invariance.mjs';

export const invariance = Object.freeze([]);

// Witness: an input-tied count (one subsidiary per register line, with its pack) and conservation over the consolidation
// (every intercompany item in at most one elimination; eliminated = the sum of the eliminations; consolidated = gross
// receivables (payables) - eliminated; the counts), plus each pack's own witness (R1's or R3's) on the pack's inputs.
export const witness = witnessDescriptor('conservation', [
  { tag: 'conservation', scope: 'output', text: 'consolidated = sum of gross receivables (payables) - eliminated; eliminated = sum of eliminations; no item in two eliminations' },
  { tag: 'count', scope: 'input', text: 'one subsidiary per register line, with the register\'s pack; consolidated counts agree' },
  { tag: 'conservation', scope: 'input', text: 'each pack report passes its own rung\'s witness (R1 or R3) on the pack\'s inputs' },
]);
export const witnessOf = () => witness;
const registerOf = text => String(text ?? '').split('\n').filter(l => /^S\d+\s*\|/.test(l)).map(l => { const f = l.split('|').map(x => x.trim()); return { id: f[0], pack: (f[3]?.match(/\(([a-z-]+)\)/) ?? [])[1] ?? null }; });
export function witnessCheckGroup(task, rep) {
  const ok = rep && typeof rep === 'object' && Array.isArray(rep.subsidiaries) && Array.isArray(rep.eliminations) && rep.consolidated && typeof rep.consolidated === 'object';
  if (!ok) return [{ level: 'shape', tag: 'conservation' }];
  const v = [], subs = rep.subsidiaries.filter(Boolean), reg = registerOf(task.inputs?.register);
  if (reg.map(x => x.id).sort().join() !== subs.map(s => s.sub_id).sort().join()) v.push({ level: 'count', tag: 'count', check: 'one subsidiary per register line' });
  for (const s of subs) { const r = reg.find(x => x.id === s.sub_id); if (r?.pack && r.pack !== s.pack) v.push({ level: 'count', tag: 'count', check: 'pack as registered', sub: s.sub_id }); }
  const items = rep.eliminations.flatMap(e => [e?.receivable_item, e?.payable_item]);
  if (new Set(items).size !== items.length) v.push({ level: 'conservation', tag: 'conservation', check: 'item in two eliminations' });
  const sum = f => subs.reduce((a, s) => a + (Number.isInteger(s[f]) ? s[f] : 0), 0), el = rep.eliminations.reduce((a, e) => a + (Number.isInteger(e?.amount_minor) ? e.amount_minor : 0), 0), c = rep.consolidated;
  if (c.eliminated_minor !== el) v.push({ level: 'conservation', tag: 'conservation', check: 'eliminated = sum of eliminations' });
  if (c.eliminations !== rep.eliminations.length) v.push({ level: 'count', tag: 'count', check: 'eliminations count' });
  if (c.subsidiaries !== subs.length) v.push({ level: 'count', tag: 'count', check: 'subsidiaries count' });
  if (c.receivables_minor !== sum('external_receivables_minor') + sum('ic_receivables_minor') - c.eliminated_minor) v.push({ level: 'conservation', tag: 'conservation', check: 'receivables conservation' });
  if (c.payables_minor !== sum('external_payables_minor') + sum('ic_payables_minor') - c.eliminated_minor) v.push({ level: 'conservation', tag: 'conservation', check: 'payables conservation' });
  for (const s of subs) {
    const pack = task.inputs?.subsidiaries?.[s.sub_id];
    if (!pack) continue;
    const inner = s.pack === 'statement-audit' ? witnessCheckAudit(pack.inputs, s.report) : witnessCheckReport(pack.inputs, s.report);
    for (const x of inner) v.push({ ...x, sub: s.sub_id, pack: s.pack });
  }
  return capped(v);
}
export const witnessCheck = (task, output) => witnessCheckGroup(task, output);
