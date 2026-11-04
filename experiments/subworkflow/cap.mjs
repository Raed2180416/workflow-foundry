// Spend-cap admission for run.mjs (review of RESULT-SW-1, defect 11). The SW-1 runner checked the cap only before each
// unit, so units already in flight could overshoot it: SW-1b's check fired at $4.8837 against a $4.85 cap and the run
// ended at $4.9161; eval-1's planning worst case was 3 units x 4 nodes x $0.15 = $1.80 over. Now a unit is admitted only if
// the spend so far plus a reservation for every unit in flight and for itself stays within the cap. The reservation is a
// unit's planning ceiling, nodes x the node budget. It is not a hard ceiling: runNode checks the node budget before each
// call, so a node can pass its budget by at most one call (the CLI caps a call at maxBudgetUsdPerCall, $0.25 in run.mjs);
// in eval-1 and SW-1b no node came near it (largest node $0.0503 of $0.15). Spend already journaled for units in flight is
// counted both in `spent` and in their reservation, so the rule is conservative.
export const unitReserveUsd = ({ nodes = 4, nodeBudgetUsd = 0.15 } = {}) => Math.round(nodes * nodeBudgetUsd * 1e6) / 1e6;

/** { ok, need, why } for admitting one more unit. spent: journaled $ so far; active: units in flight (not counting it). */
export function admit({ spent, active, reserveUsd, capUsd }) {
  const need = Math.round((spent + (active + 1) * reserveUsd) * 1e6) / 1e6;
  if (need <= capUsd + 1e-9) return { ok: true, need };
  return { ok: false, need, why: `cap: $${spent} spent + ${active + 1} x $${reserveUsd} reserved = $${need} > $${capUsd}` };
}
