// The OT-0 shield: the stateful constitution policy at the effect port (port.mjs). It pins each order to the constitution
// version in force at the order's placement (C3; the registry's gate decides what is in force, so the planted day-9
// change never applies), holds a refund above the pinned threshold for a refundApproval task (C2) addressed to the
// finance-approver role with every principal who entered an amend or cancel of the order excluded (SoD from the case
// history the port saw delivered), escalates to a break-glass request to the controller after three failed requests
// (C2-X1), and journals the workflow hash, the pin and every intervention with its clause id and constitution hash.
import { effectPort, sha } from './port.mjs';
import { thresholdOf, holds } from './constitution.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE_HASH = sha(readFileSync(fileURLToPath(import.meta.url), 'utf8') + readFileSync(fileURLToPath(new URL('./port.mjs', import.meta.url)), 'utf8'));

export function shieldPolicy({ registry }) {
  const pinAt = order => (order?.placedAt ? registry.inForceAt(order.placedAt) : null);
  return {
    name: 'shield', hash: SOURCE_HASH, evidence: true,
    pin(orderId, order) { const v = pinAt(order); return v ? { hash: v.hash, version: v.version } : null; },
    decide(e, { now, order, approvals = [] }) {
      if (!(e.system === 'billing' && e.op === 'refund')) return { action: 'allow' };
      const v = pinAt(order) ?? registry.inForceAt(now);          // fallback (no placement seen): the version in force now, journaled as such
      const pin = { hash: v.hash, version: v.version, ...(pinAt(order) ? {} : { fallback: 'placement not seen' }) };
      const T = thresholdOf(v.doc);
      const amount = e.args?.amountMinor ?? e.args?.amount ?? 0;
      if (!(amount > T)) return { action: 'allow', pin };
      const sod = [...new Set((order?.entered ?? []).filter(x => ['amend', 'cancel'].includes(x.action) && x.principal && !x.principal.startsWith('cust:')).map(x => x.principal))];
      // A constitution-aware solver may have asked itself: the shield verifies that approval instead of asking again.
      const ok = approvals.find(a => a.decision === 'approve' && a.at <= now && holds(v.doc, a.user, 'finance-approver') && !sod.includes(a.user));
      if (ok) return { action: 'allow', clause: 'C2', threshold: T, pin, verified: ok };
      return { action: 'hold', clause: 'C2', threshold: T, pin, task: { role: 'finance-approver', excludeUsers: sod } };
    },
    escalate(h) {
      const sod = h.asks.at(-1)?.excludeUsers ?? [];
      return { role: 'controller', excludeUsers: sod, justification: `no valid finance approval after ${h.asks.length} requests` };
    },
  };
}

/** shieldArm(inner, { registry, workflowHash }) → the solver behind the shield (arm W-S). */
export const shieldArm = (inner, { registry, workflowHash = null }) => effectPort(inner, { policy: shieldPolicy({ registry }), id: `W-S(${inner.id})`, workflowHash });
