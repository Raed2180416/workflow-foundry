// G, the necessity control (ATTACK-FABLE §3.3): a host guard of at most 30 lines, no model, no case history. At the
// effect port it holds any refund above the threshold in force *now* (not at the order's placement) for an approval by
// the finance-approver role, with no SoD exclusion and no pin or evidence beyond the port's own intervention record.
import { effectPort } from './port.mjs';

export function guardPolicy({ registry }) {
  return {
    name: 'guard-G', hash: null, evidence: false, pin: () => null,
    decide(e, { now }) {
      if (e.system !== 'billing' || e.op !== 'refund') return { action: 'allow' };
      const T = registry.inForceAt(now).doc.parameters.refundApprovalThresholdMinor;
      const amount = e.args?.amountMinor ?? e.args?.amount ?? 0;
      return amount > T ? { action: 'hold', clause: 'C2', threshold: T, task: { role: 'finance-approver', excludeUsers: [] } } : { action: 'allow' };
    },
  };
}

export const guardArm = (inner, { registry }) => effectPort(inner, { policy: guardPolicy({ registry }), id: `G(${inner.id})` });
