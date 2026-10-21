// Pure SOP rules, no tools and no model: the quantity variance and its classification (5.1.2, 5.2.1), the warehouse
// comparison (5.2.2), the chargeback (5.3.1) and the resolution status (5.3.2).

export const QVT_DEFAULT = 5;
export const QUANTITY_PROBLEMS = ['Underage Quantity', 'Overage Quantity', 'Cancelled Quantity', 'Severe Unmatched Quantity'];
// The quantity discrepancies themselves; the severe flag is a callout on top of one of them (5.2.1).
const QUANTITY_DISCREPANCIES = ['Underage Quantity', 'Overage Quantity', 'Cancelled Quantity'];
const SHORTAGES = ['Underage Quantity', 'Cancelled Quantity'];

const round2 = x => Math.round(x * 100) / 100;

// 5.1.2: variance = (received - confirmed) / confirmed * 100. 5.2.1: a confirmed quantity of 0 is a cancellation (the
// variance is undefined); otherwise compare received with ordered, and flag a variance beyond the QVT as severe.
export function classifyQuantity({ ordered, confirmed, received, qvt = QVT_DEFAULT }) {
  if (confirmed === 0) return { variance_pct: null, problem_type: ['Cancelled Quantity'] };
  const variance = (received - confirmed) / confirmed * 100;
  const problem_type = [];
  if (received > ordered) problem_type.push('Overage Quantity');
  if (received < ordered) problem_type.push('Underage Quantity');
  if (Math.abs(variance) > qvt) problem_type.push('Severe Unmatched Quantity');
  return { variance_pct: round2(variance), problem_type };
}

// 5.2.2: the actual warehouse must be the intended one (the warehouse tool folds case and surrounding spaces).
export function classifyLocation({ intended, actual }) {
  const norm = v => String(v ?? '').trim().toUpperCase();
  const match = norm(intended) === norm(actual);
  return { location_match: match, problem_type: match ? [] : ['Wrong Warehouse'] };
}

// 5.3.1: quantity discrepancies charge (ordered - received) * unit cost (never below zero: an overage is not charged);
// damage charges received * unit cost. A wrong item is never charged (the SOP skips the rest of the procedure), and a
// receipt that is not chargeable carries no chargeback.
export function chargebackAmount({ problem_type, ordered, received, unit_cost, chargeable = true }) {
  if (problem_type.includes('Wrong Item')) return null;
  if (!chargeable) return 0;
  if (unit_cost == null) return null;
  let charge = 0;
  if (problem_type.some(p => QUANTITY_PROBLEMS.includes(p))) charge += Math.max(0, ordered - received) * unit_cost;
  if (problem_type.includes('Vendor Damaged')) charge += received * unit_cost;
  return round2(charge);
}

// 5.3.2 with the examples: a wrong item returns the shipment to the vendor (5.1.1). A shortage (underage or cancelled
// quantity) is Processing: it becomes a chargeback claim. Two vendor-facing problems at once (a quantity discrepancy and
// damage) need reconciling, so they are Processing too. Otherwise the shipment is settled by its chargeable flag: returned
// to the vendor when chargeable, resolved when not (a single overage or damage, or no problem). A wrong warehouse is an
// internal routing problem and does not set the status.
export function resolutionStatus({ problem_type, chargeable = true }) {
  if (problem_type.includes('Wrong Item')) return 'Returned to Vendor';
  const shortage = problem_type.some(p => SHORTAGES.includes(p));
  const vendorFacing = Number(problem_type.some(p => QUANTITY_DISCREPANCIES.includes(p))) + Number(problem_type.includes('Vendor Damaged'));
  if (shortage || vendorFacing > 1) return 'Processing';
  return chargeable ? 'Returned to Vendor' : 'Resolved';
}
