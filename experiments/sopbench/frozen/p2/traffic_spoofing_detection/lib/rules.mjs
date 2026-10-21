// The SOP's rules as plain code: the threshold bands of 5.1-5.3, the reading of a tool's status text, the risk level,
// the violation classes of 5.4 and the enforcement table of 5.6. Every function is pure.
// A finding is { code, level, detail }. Levels: normal (no anomaly); warning and suspicious (anomalies, suspicious being
// the SOP's worse band); confirmed (a system check reports a violation); unavailable (the value or the tool is missing,
// so nothing was checked).

export const LEVELS = ['normal', 'warning', 'suspicious', 'confirmed', 'unavailable'];

export const finding = (code, level, detail) => ({ code, level, detail });
export const isActive = f => f.level === 'warning' || f.level === 'suspicious' || f.level === 'confirmed';
const grade = (code, v, unit, rule) => (v == null ? finding(code, 'unavailable', 'not in the task, not checked') : finding(code, rule(v), `${v}${unit}`));

// Tool results come back as text ("SUSPICIOUS") or as parsed JSON.
export const text = v => (typeof v === 'string' ? v : JSON.stringify(v ?? null));

// What a tool's status text says about the partner. Upper-cased words, so "VIOLATION_DETECTED" and "Violation detected" agree.
export function statusLevel(value) {
  const t = text(value).toUpperCase().replace(/[\s_-]+/g, ' ').trim();
  if (!t || /NO DATA|NOT FOUND|UNAVAILABLE|NOT AVAILABLE/.test(t)) return 'unavailable';
  if (/\b(NO|NOT|NONE)\b/.test(t)) return 'normal';
  if (/VIOLATION|FAIL|SPOOF|CONFIRM/.test(t)) return 'confirmed';
  if (/SUSPICIOUS/.test(t)) return 'suspicious';
  if (/WARN/.test(t)) return 'warning';
  if (/\b(COMPLETED|SUCCESS|SUCCEEDED|CLEAN|PASS|PASSED|LEGITIMATE|NORMAL|OK)\b/.test(t)) return 'normal';
  return 'unavailable';
}
export const statusFinding = (code, value) => finding(code, statusLevel(value), `tool returned ${text(value)}`);

// 5.1.3 Legitimacy: unique users to total orders, minimum 0.4.
export const ratioFinding = (unique, orders) => {
  const code = '5.1.3 unique_users / total_orders';
  if (unique == null || !(orders > 0)) return finding(code, 'unavailable', 'not in the task, not checked');
  const r = unique / orders;
  return finding(code, r < 0.4 ? 'suspicious' : 'normal', `ratio ${r.toFixed(2)}`);
};

// 5.2.1 Engagement Score Threshold: Critical <1.0, Warning 1.0-2.0, Normal >2.0.
export const engagementFinding = v => grade('5.2.1 engagement_score', v, '', x => (x < 1 ? 'suspicious' : x <= 2 ? 'warning' : 'normal'));

// 5.2.2 Conversion Rate Authentication, in percent: Suspicious <0.05%, Normal >0.1%, between them Warning.
export const conversionFinding = v => grade('5.2.2 conversion_rate', v, '%', x => (x < 0.05 ? 'suspicious' : x <= 0.1 ? 'warning' : 'normal'));

// 5.2.3 Click spike: an anomaly when it exceeds 10x the baseline traffic.
export const clickSpikeFinding = v => grade('5.2.3 click_spike', v, 'x baseline', x => (x > 10 ? 'warning' : 'normal'));

// 5.2.4 Device distribution: Suspicious when one device type carries more than 80% of the traffic.
export function deviceFinding(computerPct, phonePct) {
  const code = '5.2.4 device share';
  const shares = [computerPct, phonePct].filter(x => x != null);
  if (!shares.length) return finding(code, 'unavailable', 'not in the task, not checked');
  const top = Math.max(...shares);
  return finding(code, top > 80 ? 'suspicious' : 'normal', `largest device share ${top}%`);
}

// 5.3.1 Source verification: bounce rate in percent (Suspicious >90, Warning 80-90, Normal <80).
export const bounceFinding = v => grade('5.3.1 bounce_rate', v, '%', x => (x > 90 ? 'suspicious' : x >= 80 ? 'warning' : 'normal'));
// 5.3.1 Visit duration in seconds (Suspicious <30, Warning 30-60, Normal >60).
export const durationFinding = v => grade('5.3.1 visit_duration_seconds', v, 's', x => (x < 30 ? 'suspicious' : x <= 60 ? 'warning' : 'normal'));
// 5.3.1 Unattributed clicks as a percent of all clicks (Suspicious >50, Warning 30-50, Normal <30).
export const unattributedFinding = pct => grade('5.3.1 unattributed clicks %', pct, '%', x => (x > 50 ? 'suspicious' : x >= 30 ? 'warning' : 'normal'));
export const percentOf = (part, whole) => (part != null && whole > 0 ? (part / whole) * 100 : null);

// 5.4.4 Unidentifiable traffic source: an empty or placeholder source.
export const isBlankSource = s => /^(unknown|none|n\/?a|null|-|)$/i.test(String(s ?? '').trim());
export const sourceFinding = s => (s == null
  ? finding('5.4.4 top_referral_source', 'unavailable', 'not in the task, not checked')
  : finding('5.4.4 top_referral_source', isBlankSource(s) ? 'warning' : 'normal', `source ${s}`));

// 5.4 Violation classification: the class of a violation type, and the response that class takes.
export const RESPONSES = {
  cloaking: 'traffic_cloaking_response',
  spoofing: 'spoofing_traffic_response',
  redirect: 'redirect_traffic_response',
  blank: 'blank_source_response',
};
export function violationClass(type) {
  const t = String(type ?? '').toLowerCase();
  if (/cloak|mask|content|url/.test(t)) return 'cloaking';
  if (/spoof|referr|\bip\b|falsif/.test(t)) return 'spoofing';
  if (/redirect|funnel|destination/.test(t)) return 'redirect';
  return null;
}

// 3.5 / 5.6 risk level: "High", "Medium" or "Low" (also "critical", "moderate"); null when the text is not a level.
export function riskLevel(v) {
  const t = String(v ?? '').trim().toLowerCase();
  if (/^(high|critical|severe)\b/.test(t)) return 'High';
  if (/^(medium|moderate)\b/.test(t)) return 'Medium';
  if (/^low\b/.test(t)) return 'Low';
  return null;
}
// The risk level when neither the task nor the risk tool gives one: from the findings alone.
export const derivedRisk = findings => (findings.some(f => f.level === 'confirmed') ? 'High' : findings.some(isActive) ? 'Medium' : 'Low');

// 5.6 Enforcement table. High: Account Closure. Medium: Temporary Suspension by default; investigator discretion gives a
// Warning when the evidence is only suspicious, not confirmed. Low: Warning Issued with evidence, else No Action.
// "Confirmed" means a system check reported the violation; anomalies in the metrics alone are suspicious.
export function enforcementAction(risk, findings, documented) {
  const active = findings.filter(isActive);
  const confirmed = active.some(f => f.level === 'confirmed');
  if (risk === 'High') return { action: 'Account Closure', basis: 'High risk violation' };
  if (risk === 'Medium') {
    if (confirmed) return { action: 'Temporary Suspension', basis: 'Medium risk, violation confirmed by a system check: default action' };
    if (active.length) return { action: 'Warning Issued', basis: 'Medium risk, suspicious but not confirmed: investigator discretion to warn' };
    return { action: 'Temporary Suspension', basis: 'Medium risk, no supporting anomaly: default action' };
  }
  if (documented && active.length) return { action: 'Warning Issued', basis: 'Low risk with evidence' };
  return { action: 'No Action', basis: 'Low risk without conclusive evidence' };
}
