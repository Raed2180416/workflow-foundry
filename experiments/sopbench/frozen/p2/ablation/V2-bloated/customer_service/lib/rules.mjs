// Plain-code rules for the customer service SOP: account format, authentication, account eligibility, diagnostic
// thresholds and the troubleshooting check. Tool results use display keys ("account status", "service metrics"), so
// fields are read by a normalised name (lower case, letters and digits only) and nested objects are searched too.

export const ACCOUNT_ID_PATTERN = /^[A-Z]{3}-\d{5}$/;
export const LATENCY_LIMIT_MS = 100;
export const JITTER_LIMIT_MS = 30;
// Inferred from the examples: a flagged metric that is still outside its limit after troubleshooting counts as improved
// only when it moved at least this far toward the limit (relative to its value before troubleshooting).
export const SIGNIFICANT_IMPROVEMENT = 0.05;

const norm = k => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');

// The first value whose key matches one of `names` (normalised), searching nested objects when the top level has none.
export function field(obj, ...names) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  const want = names.map(norm);
  for (const [k, v] of Object.entries(obj)) if (want.includes(norm(k)) && v !== undefined) return v;
  for (const v of Object.values(obj)) {
    const found = field(v, ...names);
    if (found !== undefined) return found;
  }
  return undefined;
}

export const text = v => (v === undefined || v === null ? '' : String(v).trim());
const upper = v => text(v).toUpperCase();

export function asBool(v) {
  if (typeof v === 'boolean') return v;
  return ['true', 'yes', '1'].includes(text(v).toLowerCase());
}

export function asNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = text(v);
  const n = Number(s);
  return s !== '' && Number.isFinite(n) ? n : null;
}

// A tool result that came back as text (a JSON string) is parsed once; anything unparseable is no data.
function asObject(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
}

export const listOf = v => (Array.isArray(v) ? v.map(x => text(x)).filter(Boolean) : []);

// Bandwidth in Mbps: '300 Mbps', '1 Gbps', '500 Kbps'; a bare number is taken as Mbps.
export function parseMbps(s) {
  const m = /^\s*([\d.]+)\s*([kmg])?\s*(?:bps)?\s*$/i.exec(text(s));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? 'm').toLowerCase();
  return unit === 'g' ? n * 1000 : unit === 'k' ? n / 1000 : n;
}

export const isAccountIdFormat = id => typeof id === 'string' && ACCOUNT_ID_PATTERN.test(id);

// Authentication: the most recent attempt must show a success, or a successful recovery after a failed login.
// A failed attempt with no record of a successful recovery is a failed authentication.
export function authenticated(details) {
  const login = upper(field(details, 'login status'));
  const recovery = upper(field(details, 'account recovery status'));
  return login === 'SUCCESS' || recovery === 'SUCCESS';
}

const SUSPENDED = /SUSPEND/;
const LIFTED = /LIFT|RESOLV|CLEAR|REMOV|REINSTAT|RESTOR/;
const NOT_LIFTED = /NOT|UN|PENDING|ACTIVE/;
const NON_PAYMENT = /PAY|BILL|INVOICE|OVERDUE|PAST[ _-]?DUE|UNPAID|ARREAR|BALANCE/;

// A suspension counts as lifted when the system says so ('ACTIVE' is the lifted state in the SOP's own sample).
export function suspensionLifted(suspension) {
  const u = upper(suspension);
  if (u === 'ACTIVE') return true;
  return LIFTED.test(u) && !NOT_LIFTED.test(u);
}

// Support eligibility from the account status. CONTINUE: go on with diagnosis. PENDING_ACTION: a suspension for
// non-payment, assigned to Accounts Payable. INELIGIBLE: terminated, other suspension, or no usable status.
export function eligibility({ status, reason, suspension }) {
  const s = upper(status);
  if (s === 'ACTIVE') return 'CONTINUE';
  if (SUSPENDED.test(s)) {
    if (suspensionLifted(suspension)) return 'CONTINUE';
    if (NON_PAYMENT.test(upper(`${reason} ${suspension}`))) return 'PENDING_ACTION';
  }
  return 'INELIGIBLE';
}

// Diagnostic metrics as numbers, or null when any of latency, jitter, bandwidth is missing.
export function metricsOf(v) {
  const o = asObject(v);
  if (!o || typeof o !== 'object') return null;
  const latency = asNumber(field(o, 'latency'));
  const jitter = asNumber(field(o, 'jitter'));
  const bandwidth = asNumber(field(o, 'bandwidth'));
  return latency === null || jitter === null || bandwidth === null ? null : { latency, jitter, bandwidth };
}

// Flags from the SOP: latency over 100 ms, jitter over 30 ms, bandwidth below the subscribed plan.
export function flagsOf(m, planMbps) {
  return {
    latency_issue: m.latency > LATENCY_LIMIT_MS,
    stability_issue: m.jitter > JITTER_LIMIT_MS,
    bandwidth_issue: m.bandwidth < planMbps,
  };
}

// Gain toward the good side, as a share of the value before troubleshooting (1 when it was zero and moved the right way).
function gain(before, after, lowerIsBetter) {
  const d = lowerIsBetter ? before - after : after - before;
  return before > 0 ? d / before : d > 0 ? 1 : 0;
}

// Did troubleshooting improve the metrics? Every flagged metric must now be back within its limit, or have improved
// by SIGNIFICANT_IMPROVEMENT; a metric that was fine and is now flagged is a regression. Not improved means escalate.
export function improvement(pre, post, planMbps) {
  const metrics = [
    { name: 'latency', flagged: pre.latency > LATENCY_LIMIT_MS, back: post.latency <= LATENCY_LIMIT_MS,
      gain: gain(pre.latency, post.latency, true), regressed: pre.latency <= LATENCY_LIMIT_MS && post.latency > LATENCY_LIMIT_MS },
    { name: 'jitter', flagged: pre.jitter > JITTER_LIMIT_MS, back: post.jitter <= JITTER_LIMIT_MS,
      gain: gain(pre.jitter, post.jitter, true), regressed: pre.jitter <= JITTER_LIMIT_MS && post.jitter > JITTER_LIMIT_MS },
    { name: 'bandwidth', flagged: pre.bandwidth < planMbps, back: post.bandwidth >= planMbps,
      gain: gain(pre.bandwidth, post.bandwidth, false), regressed: pre.bandwidth >= planMbps && post.bandwidth < planMbps },
  ];
  const ok = m => !m.flagged || m.back || m.gain >= SIGNIFICANT_IMPROVEMENT;
  return {
    improved: !metrics.some(m => m.regressed) && metrics.every(ok),
    outsideLimit: metrics.filter(m => m.flagged && !m.back).map(m => ({ metric: m.name, gain: Number(m.gain.toFixed(4)) })),
  };
}
