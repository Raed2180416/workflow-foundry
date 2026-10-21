// Reads the task's inputs into typed values. A missing or unusable value is null, never undefined, so every section
// input can be checked against its JSON schema.

export const num = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

export const str = v => (v == null ? null : String(v).trim() || null);

// Text (or an array) split on the given separators into trimmed, non-empty items; "none"-like placeholders are dropped.
export const list = (v, sep) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(sep) : [])
  .map(x => String(x).trim())
  .filter(x => x && !/^(none|n\/?a|null|-)$/i.test(x));

export function readCase(inputs = {}) {
  const i = inputs;
  return {
    partner_id: str(i.partner_id) ?? '',
    websites: list(i.registered_websites, /[\s,;|]+/),
    earnings_amount: num(i.earnings_amount),
    unique_users: num(i.unique_users),
    total_orders: num(i.total_orders),
    engagement_score: num(i.engagement_score),
    conversion_rate: num(i.conversion_rate),
    click_spike: num(i.click_spike),
    computer_traffic_percent: num(i.computer_traffic_percent),
    phone_traffic_percent: num(i.phone_traffic_percent),
    bounce_rate: num(i.bounce_rate),
    visit_duration_seconds: num(i.visit_duration_seconds),
    unattributed_clicks: num(i.unattributed_clicks),
    total_clicks: num(i.total_clicks),
    top_referral_source: str(i.top_referral_source),
    violation_type: str(i.violation_type),
    risk_level: str(i.risk_level),
    evidence: list(i.evidence_collected, /[,;|]+/),
  };
}
