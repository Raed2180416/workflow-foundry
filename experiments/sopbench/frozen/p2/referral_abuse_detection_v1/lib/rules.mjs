// Pure rules of the referral abuse SOP: value normalisers, the indicator scores of SOP 5.5.1 and the violation-type
// and enforcement-action mapping of SOP 5.5.1 STEP 2 and 5.5.2. No I/O here; the sections call these functions.

export const CLOSURE = ['Abusive Account Creation', 'Misleading Ad Copy'];
export const NON_CLOSURE = ['Personal Orders (Related)', 'No Violation'];
// Tie-break order (SOP 5.5.1 STEP 2). The SOP lists the first three; No Violation is not listed, so it comes last.
const PRIORITY = ['Abusive Account Creation', 'Misleading Ad Copy', 'Personal Orders (Related)', 'No Violation'];

export const THRESHOLD = {
  'Abusive Account Creation': 3,
  'Misleading Ad Copy': 3,
  'Personal Orders (Related)': 3,
  'No Violation': 4,
};

// SOP 5.5.2. INCONCLUSIVE is the procedure's own value when no violation type reaches its threshold.
export const ACTION_FOR = {
  'Abusive Account Creation': 'Account Closure',
  'Misleading Ad Copy': 'Account Closure',
  'Personal Orders (Related)': 'No Action',
  'No Violation': 'No Action',
  INCONCLUSIVE: 'Inconclusive',
};

// Normalisers: a field the tool returned as the wrong JSON type, or not at all, becomes null (unknown).
export const asBool = v => {
  if (v === true || v === false) return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return null;
};
export const asNumber = v => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
export const asText = v => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
export const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// SOP 5.2.2: connected_accounts >= 15 is 'many', 0 < n < 15 is 'some' (the Personal Orders band), 0 is 'none'.
export const connectedBand = n => (n == null ? null : n >= 15 ? 'many' : n > 0 ? 'some' : 'none');

const lower = s => (s ?? '').toLowerCase();

// SOP 5.5.1 STEP 1: each indicator is TRUE (+1) or not. A null field is not TRUE, so it adds nothing.
export const INDICATORS = {
  'Abusive Account Creation': [
    ['address_validity is false', f => f.address_validity === false],
    ['email_pattern_suspicious is true', f => f.email_pattern_suspicious === true],
    ['website_verified is false', f => f.website_verified === false],
    ['connected_accounts >= 15', f => f.connected_band === 'many'],
    ['login_geographic_consistency is false', f => f.login_geographic_consistency === false],
  ],
  'Misleading Ad Copy': [
    ['website_verified is false', f => f.website_verified === false],
    ['referral_source_quality is Low or Medium', f => ['low', 'medium'].includes(lower(f.referral_source_quality))],
    ['order_patterns_suspicious is true', f => f.order_patterns_suspicious === true],
    ['click_through_rate > 0.4', f => f.click_through_rate != null && f.click_through_rate > 0.4],
  ],
  'Personal Orders (Related)': [
    ['payment_method_shared is true', f => f.payment_method_shared === true],
    ['0 < connected_accounts < 15', f => f.connected_band === 'some'],
    ['order_patterns_suspicious is true', f => f.order_patterns_suspicious === true],
    ['referral_source_quality is High', f => lower(f.referral_source_quality) === 'high'],
  ],
  'No Violation': [
    ['address_validity is true', f => f.address_validity === true],
    ['email_pattern_suspicious is false', f => f.email_pattern_suspicious === false],
    ['website_verified is true', f => f.website_verified === true],
    ['login_geographic_consistency is true', f => f.login_geographic_consistency === true],
    ['payment_method_shared is false', f => f.payment_method_shared === false],
    ['order_patterns_suspicious is false', f => f.order_patterns_suspicious === false],
  ],
};

export function scoreAll(f) {
  return Object.fromEntries(Object.entries(INDICATORS).map(([type, list]) => {
    const hits = list.map(([label, test]) => ({ label, hit: test(f) === true }));
    return [type, { score: hits.filter(h => h.hit).length, hits }];
  }));
}

// SOP 5.5.1 STEP 2: a closure category that meets its threshold wins (highest score, then priority). A score only grows
// as evidence arrives, so a met closure threshold stands even when some evidence is missing. Otherwise the highest-scoring
// non-closure category that meets its threshold, but only when the evidence is complete: a missing field could still
// lift a closure category to its threshold. Otherwise INCONCLUSIVE.
export function violationType(scores, complete) {
  const meets = t => scores[t].score >= THRESHOLD[t];
  const pick = types => types
    .filter(meets)
    .sort((a, b) => scores[b].score - scores[a].score || PRIORITY.indexOf(a) - PRIORITY.indexOf(b))[0];
  const closure = pick(CLOSURE);
  if (closure) return closure;
  if (!complete) return 'INCONCLUSIVE';
  return pick(NON_CLOSURE) ?? 'INCONCLUSIVE';
}
