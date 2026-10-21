// The data fields the SOP's tools return, how each value is read, and the JSON contract of the section outputs.
// A value of the wrong kind reads as null (unknown): no indicator fires on an unknown value, since the SOP's rules
// fire only on the stated value.

const KINDS = {
  bool: { type: ['boolean', 'null'], read: v => (v === true || v === false ? v : null) },
  num: {
    type: ['number', 'null'],
    read: v => {
      const x = typeof v === 'string' && v.trim() ? Number(v) : v;
      return typeof x === 'number' && Number.isFinite(x) ? x : null;
    },
  },
  str: { type: ['string', 'null'], read: v => (typeof v === 'string' && v.trim() ? v.trim() : null) },
};

export const FIELD_KIND = {
  address_validity: 'bool',
  email_pattern_suspicious: 'bool',
  website_verified: 'bool',
  business_description: 'str',
  account_status: 'str',
  connected_accounts: 'num',
  login_geographic_consistency: 'bool',
  account_age_days: 'num',
  registration_timestamp: 'str',
  registration_burst_detected: 'bool',
  off_hours_activity_percentage: 'num',
  activity_spike_detected: 'bool',
  revenue_amount: 'num',
  click_through_rate: 'num',
  page_views: 'num',
  device_distribution: 'str',
  referral_source_quality: 'str',
  payment_method_shared: 'bool',
  order_patterns_suspicious: 'bool',
  total_lifetime_revenue: 'num',
  refund_rate_percentage: 'num',
  customer_complaint_count: 'num',
  previous_violations_count: 'num',
  last_violation_date: 'str',
  warning_issued: 'bool',
  account_rehabilitation_status: 'str',
};

// The fields each tool returns (the SOP's sections 4.1 to 4.4).
export const TOOL_FIELDS = {
  investigate_account: ['address_validity', 'email_pattern_suspicious', 'website_verified', 'business_description',
    'account_status', 'connected_accounts', 'login_geographic_consistency', 'account_age_days', 'registration_timestamp'],
  analyze_temporal_patterns: ['registration_burst_detected', 'off_hours_activity_percentage', 'activity_spike_detected'],
  analyze_traffic_patterns: ['revenue_amount', 'click_through_rate', 'page_views', 'device_distribution',
    'referral_source_quality', 'payment_method_shared', 'order_patterns_suspicious'],
  get_financial_impact: ['total_lifetime_revenue', 'refund_rate_percentage', 'customer_complaint_count'],
  get_violation_history: ['previous_violations_count', 'last_violation_date', 'warning_issued', 'account_rehabilitation_status'],
};

export const ALL_FIELDS = Object.keys(FIELD_KIND);

// A tool's result as an object. The violation-history tool answers with JSON text that writes NaN (not JSON): a NaN
// value means "no value", so it is read as null.
export function toolObject(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v !== 'string') return null;
  for (const text of [v, v.replace(/:\s*(NaN|-?Infinity)\b/g, ': null')]) {
    try {
      const o = JSON.parse(text);
      if (o && typeof o === 'object' && !Array.isArray(o)) return o;
    } catch { /* not JSON in this form */ }
  }
  return null;
}

// The named fields of a tool's result, each read as its kind (null when absent or of the wrong kind).
export function readFields(value, names) {
  const o = toolObject(value) ?? {};
  return Object.fromEntries(names.map(n => [n, KINDS[FIELD_KIND[n]].read(o[n])]));
}

// The JSON schema of an object holding exactly these fields, each nullable.
export function contract(names) {
  return {
    type: 'object',
    required: names,
    properties: Object.fromEntries(names.map(n => [n, { type: KINDS[FIELD_KIND[n]].type }])),
    additionalProperties: false,
  };
}
