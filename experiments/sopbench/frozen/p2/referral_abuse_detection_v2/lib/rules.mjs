// SOP section 5.7 as code: Step 1 scores, Step 2 violation type, Step 3 risk severity, Step 4 enforcement action.
// Pure functions of the evidence (fields as read by lib/fields.mjs): no tool and no model.

// Step 2 thresholds: a type qualifies when its score reaches its threshold. 'none' is the No Violation type (section 5.7 Step 1).
export const THRESHOLDS = { temporal: 4, abusive: 4, misleading: 4, personal: 3, none: 6 };
// Step 2 tie order: among qualifying types with the same score the first listed wins. 'none' comes last, so a tie
// between a violation and No Violation is read as a violation.
const TIE_ORDER = ['temporal', 'abusive', 'misleading', 'personal', 'none'];
export const VIOLATION_TYPES = [...TIE_ORDER, 'inconclusive'];
export const RISK_LEVELS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

const DAY_MS = 864e5;
const above = (v, x) => typeof v === 'number' && v > x;
const atLeast = (v, x) => typeof v === 'number' && v >= x;
const atMost = (v, x) => typeof v === 'number' && v <= x;
const below = (v, x) => typeof v === 'number' && v < x;
const oneOf = (v, ...xs) => typeof v === 'string' && xs.includes(v.toLowerCase());

// Step 1: each type's indicators as [label, holds, points].
export function scoreViolations(e) {
  const rules = {
    abusive: [
      ['address_validity is false', e.address_validity === false, 1],
      ['email_pattern_suspicious is true', e.email_pattern_suspicious === true, 1],
      ['website_verified is false', e.website_verified === false, 1],
      ['connected_accounts >= 15', atLeast(e.connected_accounts, 15), 1],
      ['login_geographic_consistency is false', e.login_geographic_consistency === false, 1],
      ['registration_burst_detected is true', e.registration_burst_detected === true, 2],
      ['account_age_days < 30', below(e.account_age_days, 30), 1],
    ],
    misleading: [
      ['website_verified is false', e.website_verified === false, 1],
      ['referral_source_quality is Low or Medium', oneOf(e.referral_source_quality, 'low', 'medium'), 1],
      ['order_patterns_suspicious is true', e.order_patterns_suspicious === true, 1],
      ['click_through_rate > 0.4', above(e.click_through_rate, 0.4), 1],
      ['activity_spike_detected is true', e.activity_spike_detected === true, 1],
      ['customer_complaint_count > 5', above(e.customer_complaint_count, 5), 1],
    ],
    personal: [
      ['payment_method_shared is true', e.payment_method_shared === true, 1],
      ['0 < connected_accounts < 15', above(e.connected_accounts, 0) && below(e.connected_accounts, 15), 1],
      ['order_patterns_suspicious is true', e.order_patterns_suspicious === true, 1],
      ['referral_source_quality is High', oneOf(e.referral_source_quality, 'high'), 1],
      ['off_hours_activity_percentage < 30', below(e.off_hours_activity_percentage, 30), 1],
    ],
    temporal: [
      ['registration_burst_detected is true', e.registration_burst_detected === true, 2],
      ['off_hours_activity_percentage > 60', above(e.off_hours_activity_percentage, 60), 1],
      ['activity_spike_detected is true', e.activity_spike_detected === true, 1],
      ['account_age_days < 30 and connected_accounts >= 15', below(e.account_age_days, 30) && atLeast(e.connected_accounts, 15), 2],
    ],
    none: [
      ['address_validity is true', e.address_validity === true, 1],
      ['email_pattern_suspicious is false', e.email_pattern_suspicious === false, 1],
      ['website_verified is true', e.website_verified === true, 1],
      ['login_geographic_consistency is true', e.login_geographic_consistency === true, 1],
      ['payment_method_shared is false', e.payment_method_shared === false, 1],
      ['order_patterns_suspicious is false', e.order_patterns_suspicious === false, 1],
      ['registration_burst_detected is false', e.registration_burst_detected === false, 1],
      ['off_hours_activity_percentage < 30', below(e.off_hours_activity_percentage, 30), 1],
      ['customer_complaint_count <= 2', atMost(e.customer_complaint_count, 2), 1],
    ],
  };
  return Object.fromEntries(Object.entries(rules).map(([type, list]) => [type, {
    score: list.reduce((s, [, holds, points]) => s + (holds ? points : 0), 0),
    hits: list.filter(([, holds]) => holds).map(([label]) => label),
  }]));
}

// Step 2: the highest score among the qualifying types; ties follow TIE_ORDER; none qualifying is inconclusive.
export function violationType(scores) {
  const qualifying = TIE_ORDER.filter(t => scores[t].score >= THRESHOLDS[t]);
  if (!qualifying.length) return 'inconclusive';
  return qualifying.sort((a, b) => scores[b].score - scores[a].score)[0];
}

// The account's as-of date: registration plus account_age_days (the SOP's age is days since registration). Every
// example account's age runs to the same date, so this is the date the data was taken on. The clock is the fallback.
export function asOfMs(e) {
  const registered = Date.parse(e.registration_timestamp);
  return typeof e.account_age_days === 'number' && Number.isFinite(registered)
    ? registered + e.account_age_days * DAY_MS
    : Date.now();
}

const withinDays = (iso, asOf, days) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) && Math.abs(asOf - t) <= days * DAY_MS;
};

// Step 3: the risk severity of a violation, from the highest level whose rule holds.
export function riskSeverity(e) {
  const revenue = e.revenue_amount, prev = e.previous_violations_count, connected = e.connected_accounts;
  const warnedRecently = atLeast(prev, 1) && e.warning_issued === true && withinDays(e.last_violation_date, asOfMs(e), 90);
  if (above(revenue, 5000) || atLeast(prev, 2) || warnedRecently || above(e.customer_complaint_count, 10)) return 'CRITICAL';
  if ((above(revenue, 1000) && atMost(revenue, 5000)) || prev === 1 || atLeast(connected, 25) || above(e.refund_rate_percentage, 40)) return 'HIGH';
  if ((above(revenue, 100) && atMost(revenue, 1000)) || oneOf(e.account_rehabilitation_status, 'probation') || (atLeast(connected, 15) && below(connected, 25))) return 'MEDIUM';
  return 'LOW';
}

// Step 4: the enforcement action for the violation type and risk severity.
const ACTION = {
  abusive: { CRITICAL: 'Permanent Account Closure', HIGH: 'Account Closure', MEDIUM: 'Temporary Suspension', LOW: 'Warning Issued' },
  misleading: { CRITICAL: 'Permanent Account Closure', HIGH: 'Account Closure', MEDIUM: 'Temporary Suspension', LOW: 'Warning Issued' },
  temporal: { CRITICAL: 'Permanent Account Closure', HIGH: 'Account Closure', MEDIUM: 'Temporary Suspension', LOW: 'Warning Issued' },
  personal: { CRITICAL: 'Account Closure', HIGH: 'Temporary Suspension', MEDIUM: 'Warning Issued', LOW: 'No Action' },
};

export function enforcementAction(type, risk, previousViolations) {
  if (type === 'none') return 'No Action';
  if (type === 'inconclusive') return (previousViolations ?? 0) > 0 ? 'Manual Review Required' : 'Inconclusive';
  return ACTION[type][risk];
}
