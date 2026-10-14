// Witness of W-bed rung R5 "legacy dump" (ATTACK-20261014 §3 M1 b; PROOF-LEDGER K3). No relation is declared: the dump's
// files carry a trailer whose totals already pin the decode (below), and the packs carry R1's and R3's relations. Host code
// beside the oracle; contract: beds/lib/metamorphic.mjs.
import { capped, witnessDescriptor } from '../../lib/metamorphic.mjs';
import { witnessCheckGroup } from '../r4/invariance.mjs';
import { verifyPredicate } from './decode.mjs';

export const invariance = Object.freeze([]);

// Witness: the dump's trailer record (row count, row-id total, amount total per currency, text hash totals) is a hash-total
// witness that the decoded rows must reproduce (W-BED-R5-NOTES: 0 misses in 1,100 + 400 wrong decodes), plus R4's
// witness. The trailer is printed in the dump in the format's own way, so reading it is part of decoding: at run time the
// agent node reports it with a verbatim quote that the parent checks (FLOW-V3-SLICE2 §9); witnessCheck takes it as
// ctx.trailer and skips the hash-total check without one.
export const witness = witnessDescriptor('hash-total', [
  { tag: 'hash-total', scope: 'input', text: 'the decoded rows reproduce the dump trailer: count, row-id total, amounts per currency, hash totals (verifyPredicate)' },
  { tag: 'count', scope: 'input', text: 'the decoded row count equals the trailer record count' },
  { tag: 'conservation', scope: 'output', text: 'R4\'s group conservation and each pack\'s own witness' },
]);
export const witnessOf = () => witness;
export function witnessCheck(task, output, ctx = {}) {
  const v = [...witnessCheckGroup(task, output)];
  if (ctx.trailer) {
    const rows = output?.dump?.rows;
    const why = Array.isArray(rows) ? verifyPredicate(rows, ctx.trailer) : 'no dump rows';
    if (why) v.push({ level: 'hash-total', tag: 'hash-total', check: why });
  }
  return capped(v);
}
