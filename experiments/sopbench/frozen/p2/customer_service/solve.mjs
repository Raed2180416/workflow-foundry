import { createFlow } from './tools/flow.mjs';
import { createSop } from './tools/sop.mjs';
const flow = createFlow({ budgetUsd: 0.05 });
const sop = createSop(flow);
const task = flow.input();

// Customer service SOP (sop.txt §5). Every decision is plain code; no judge is used.
// Answer: final_resolution_status only.

const ACCOUNT_ID = /^[A-Z]{3}-[0-9]{5}$/;          // §3 / §5.1 standard pattern
const LATENCY_MAX_MS = 100;                         // §5.4: latency above 100 ms is flagged
const JITTER_MAX_MS = 30;                           // §5.4: jitter above 30 ms is flagged
const CLOSED_GAP = 0.5;                             // §5.5 "significant improvement": close at least half the gap to a threshold
const NON_PAYMENT = /non.?pay|unpaid|overdue|past.?due|payment|billing|bill\b|invoice|arrears|delinquen|balance/i;

const STATUSES = ['RESOLVED', 'PENDING_ACTION', 'ESCALATED', 'FAILED'];   // §3 Resolution Outcome
const NEXTS = ['CONTINUE', 'CONCLUDE', 'ESCALATE'];

// ---- schema helpers
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string' };
const nstr = { type: ['string', 'null'] };
const num = { type: 'number' };
const nnum = { type: ['number', 'null'] };
const bool = { type: 'boolean' };
const strs = { type: 'array', items: str };
const nextSchema = { type: 'string', enum: NEXTS };
const statusSchema = { type: ['string', 'null'], enum: [...STATUSES, null] };

const SEC = {
  auth: '5.1 Authentication and Ticket Initialization',
  status: '5.2 Account Status Evaluation',
  outage: '5.3 Outage and Service Area Analysis',
  diagnosis: '5.4 Technical Diagnosis',
  troubleshooting: '5.5 Troubleshooting',
  escalation: '5.6 Escalation Procedures',
  final: '5.7 Final Resolution and Documentation',
};

const SPEC = {
  auth: {
    input: obj({ account_id: nstr }),
    output: obj({ next: nextSchema, status: statusSchema, reason: str, session_token: nstr, ticket_id: nstr }),
    tools: ['validateAccount', 'getAuthenticationDetails', 'createSessionAndOpenTicket'],
  },
  status: {
    input: obj({ account_id: str, session_token: str }),
    output: obj({ next: nextSchema, status: statusSchema, reason: str, account_status: str, suspension_status: str }),
    tools: ['checkAccountStatus', 'checkAccountSuspensionStatus', 'checkPaymentStatus'],
  },
  outage: {
    input: obj({ account_id: str, session_token: str, service_area_code: nstr }),
    output: obj({ next: nextSchema, status: statusSchema, reason: str, outage_detected: bool, outage_id: str }),
    tools: ['checkServiceAreaOutage'],
  },
  diagnosis: {
    input: obj({ account_id: str, session_token: str, service_type: nstr, subscribed_bandwidth: nstr }),
    output: obj({
      next: nextSchema, status: statusSchema, reason: str,
      latency: nnum, jitter: nnum, bandwidth: nnum, plan_mbps: nnum,
      latency_issue: bool, stability_issue: bool, bandwidth_issue: bool, root_causes: strs,
    }),
    tools: ['performTechnicalDiagnostics'],
  },
  troubleshooting: {
    input: obj({
      account_id: str, session_token: str, service_type: str, subscribed_bandwidth: str,
      root_causes: strs, plan_mbps: num,
      baseline: obj({ latency: num, jitter: num, bandwidth: num }),
      flags: obj({ latency_issue: bool, stability_issue: bool, bandwidth_issue: bool }),
    }),
    output: obj({ next: nextSchema, status: statusSchema, reason: str, metrics_improved: bool, steps: strs }),
    tools: ['executeTroubleshooting', 'performTechnicalDiagnostics'],
  },
  escalation: {
    input: obj({ session_token: str, ticket_id: str, metrics_improved: bool, reason: str }),
    output: obj({ ticket_created: bool, escalation_ticket_id: nstr, team: nstr, reason: str }),
    tools: ['createEscalation'],
  },
  final: {
    input: obj({ status: statusSchema, reason: str, trail: strs, escalation_ticket_id: nstr }),
    output: obj({ final_resolution_status: { type: 'string', enum: STATUSES }, resolution_summary: str }),
    tools: [],
  },
};

// ---- value helpers
const text = v => (v == null ? '' : String(v).trim());
const isBlank = v => /^(|nan|null|none|n\/a)$/i.test(text(v));
const truthy = v => v === true || /^(true|yes|y|1)$/i.test(text(v));
const listOf = v => (Array.isArray(v) ? v.map(x => text(x)) : []);
// First key of a tool answer whose name matches; tool keys carry spaces and typos, so match loosely.
const pick = (o, re) => {
  if (!o || typeof o !== 'object') return undefined;
  const k = Object.keys(o).find(k => re.test(k));
  return k === undefined ? undefined : o[k];
};
const toNum = v => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const UNIT_TO_MBPS = { bps: 1e-6, kbps: 1e-3, mbps: 1, gbps: 1e3 };
// "300 Mbps" -> 300; no unit means Mbps.
const mbps = s => {
  const m = /([\d.]+)\s*(bps|kbps|mbps|gbps)?/i.exec(text(s));
  if (!m) return null;
  const v = Number(m[1]) * UNIT_TO_MBPS[(m[2] ?? 'mbps').toLowerCase()];
  return Number.isFinite(v) ? v : null;
};
// Latency, jitter and bandwidth from a diagnostic or troubleshooting answer; null if any is unusable (e.g. NaN).
const metricsOf = v => {
  const src = pick(v, /metric/i) ?? v;
  const latency = toNum(pick(src, /latency/i));
  const jitter = toNum(pick(src, /jitter/i));
  const bandwidth = toNum(pick(src, /bandwidth/i));
  return latency === null || jitter === null || bandwidth === null ? null : { latency, jitter, bandwidth };
};
// Status words with '_' and '-' read as spaces, so "NOT_LIFTED" is a negative and "SUSPENSION_LIFTED" a positive.
const words = s => text(s).replace(/[_-]+/g, ' ');
// A suspension is lifted only on an explicit positive word, not on "NOT LIFTED" or "UNRESOLVED".
const lifted = s => /\b(lift|lifted|reinstated|restored|removed|resolved|cleared|ended)\b/i.test(words(s)) && !/\b(not|un\w*|pending|still)\b/i.test(words(s));
// A non-payment cause is cleared once the overdue payment shows as paid; "UNPAID", "NOT PAID" or "OVERDUE" are not.
const paidUp = s => /\b(paid|settled|cleared|current)\b/i.test(words(s)) && !/\b(not|un\w*|pending|still|overdue|outstanding|due)\b/i.test(words(s));

// §5.5: a flagged metric counts as improved once it is back inside its threshold or has closed at least
// CLOSED_GAP of the distance to it; an unflagged metric must still be inside its threshold.
function metricsImproved(before, after, plan, flags) {
  const checks = [
    { flagged: flags.latency_issue, pre: before.latency, post: after.latency, limit: LATENCY_MAX_MS, lower: true },
    { flagged: flags.stability_issue, pre: before.jitter, post: after.jitter, limit: JITTER_MAX_MS, lower: true },
    { flagged: flags.bandwidth_issue, pre: before.bandwidth, post: after.bandwidth, limit: plan, lower: false },
  ];
  return checks.every(({ flagged, pre, post, limit, lower }) => {
    const within = lower ? post <= limit : post >= limit;
    if (within || !flagged) return within;
    const gap = lower ? pre - limit : limit - pre;
    const moved = lower ? pre - post : post - pre;
    return moved >= CLOSED_GAP * gap;
  });
}

// ---- sections
async function authenticate(input, port) {
  const id = input.account_id ?? '';
  const stop = (status, reason) => ({ next: 'CONCLUDE', status, reason, session_token: null, ticket_id: null });
  if (!ACCOUNT_ID.test(id)) return stop('FAILED', 'account ID does not match the standard format; process terminated');

  const v = await port.tryCall('validateAccount', { account_id: id });
  if (!v.ok || pick(v.value, /valid/i) !== true) return stop('FAILED', `account ID not validated${v.ok ? '' : `: ${v.error}`}`);

  const h = await port.tryCall('getAuthenticationDetails', { account_id: id, is_account_id_valid: true });
  if (!h.ok) return stop('FAILED', `authentication history unavailable: ${h.error}`);
  const rec = pick(h.value, /records?|history/i) ?? h.value;
  const login = text(pick(rec, /login.?status/i));
  const recovery = text(pick(rec, /recovery/i));
  // A failed latest attempt stands unless a successful recovery is on record.
  const authenticated = /fail/i.test(login) ? /success/i.test(recovery) : /success/i.test(login);
  if (!authenticated) return stop('FAILED', `authentication failed: login ${login || 'unknown'}, recovery ${recovery || 'none'}`);

  const s = await port.tryCall('createSessionAndOpenTicket', { account_id: id, is_account_id_valid: true, is_authenticated: true });
  const token = s.ok ? text(pick(s.value, /session/i)) : '';
  const ticket = s.ok ? text(pick(s.value, /ticket/i)) : '';
  if (!token || !ticket) return stop('FAILED', `session or ticket not opened: ${s.ok ? 'no session token or ticket ID' : s.error}`);
  return { next: 'CONTINUE', status: null, reason: `authenticated; ticket ${ticket} opened`, session_token: token, ticket_id: ticket };
}

async function checkEligibility(input, port) {
  const args = { account_id: input.account_id, session_token: input.session_token };
  const out = (next, status, reason, acc = '', sus = '') => ({ next, status, reason, account_status: acc, suspension_status: sus });

  const st = await port.tryCall('checkAccountStatus', args);
  if (!st.ok) return out('CONCLUDE', 'FAILED', `account status unavailable: ${st.error}`);
  const acc = text(pick(st.value, /status/i)).toUpperCase();
  const why = text(pick(st.value, /reason/i));

  if (/TERMINAT/.test(acc)) return out('CONCLUDE', 'FAILED', `account terminated (${why || 'no reason given'}); ineligible for support`, acc);
  if (/^ACTIVE\b/.test(acc)) return out('CONTINUE', null, 'account active', acc);
  if (!/SUSPEND/.test(acc)) return out('CONCLUDE', 'FAILED', `account status ${acc || 'unknown'}; ineligible for support`, acc);

  // Suspended: a lifted suspension continues; a non-payment suspension goes to Accounts Payable; any other cause is ineligible.
  const sus = await port.tryCall('checkAccountSuspensionStatus', args);
  const susText = sus.ok ? text(pick(sus.value, /suspension/i)) : '';
  if (lifted(susText)) return out('CONTINUE', null, 'suspension lifted; continue', acc, susText);
  const cause = why || susText;
  if (!NON_PAYMENT.test(cause)) return out('CONCLUDE', 'FAILED', `suspended for a cause outside support scope (${cause || 'none given'})`, acc, susText);

  // Non-payment: the case is assigned to Accounts Payable, and the dependent action is the overdue payment. Once it shows
  // as paid (or the suspension is lifted) the cause is cleared and the workflow continues; otherwise the case stays with AP.
  const pay = await port.tryCall('checkPaymentStatus', args);
  const again = await port.tryCall('checkAccountSuspensionStatus', args);
  const afterText = again.ok ? text(pick(again.value, /suspension/i)) : susText;
  const payText = pay.ok ? text(pick(pay.value, /payment|overdue/i)) : '';
  if (lifted(afterText) || paidUp(payText)) return out('CONTINUE', null, `non-payment cleared (payment: ${payText || 'n/a'}; suspension: ${afterText || 'n/a'}); continue`, acc, afterText);
  const paidNote = pay.ok ? payText || 'no status given' : `check failed (${pay.error})`;
  return out('CONCLUDE', 'PENDING_ACTION', `suspended for non-payment; assigned to Accounts Payable (payment: ${paidNote})`, acc, afterText);
}

async function checkOutage(input, port) {
  const out = (next, status, reason, detected = false, id = '') => ({ next, status, reason, outage_detected: detected, outage_id: id });
  if (isBlank(input.service_area_code)) return out('CONTINUE', null, 'no service area code; outage search skipped');
  const r = await port.tryCall('checkServiceAreaOutage', { account_id: input.account_id, session_token: input.session_token, service_area_code: input.service_area_code });
  if (!r.ok) return out('CONTINUE', null, `no outage record returned (${r.error})`);
  if (!truthy(pick(r.value, /detected/i))) return out('CONTINUE', null, 'no active outage in the service area');
  const id = text(pick(r.value, /outage.?id/i));
  const eta = text(pick(r.value, /resolution/i));
  return out('CONCLUDE', 'PENDING_ACTION', `outage ${id || 'detected'} in the service area; awaiting outage resolution (estimated ${eta || 'unknown'}); diagnostics concluded`, true, id);
}

async function diagnose(input, port) {
  const empty = { latency: null, jitter: null, bandwidth: null, plan_mbps: null, root_causes: [], latency_issue: false, stability_issue: false, bandwidth_issue: false };
  const out = (next, status, reason, extra = {}) => ({ ...empty, next, status, reason, ...extra });
  if (isBlank(input.service_type) || isBlank(input.subscribed_bandwidth)) return out('ESCALATE', null, 'service type or subscribed bandwidth missing; diagnostics cannot run');
  const plan = mbps(input.subscribed_bandwidth);
  if (plan === null) return out('ESCALATE', null, `subscribed bandwidth unreadable (${input.subscribed_bandwidth})`);

  const d = await port.tryCall('performTechnicalDiagnostics', { account_id: input.account_id, session_token: input.session_token, service_type: input.service_type, subscribed_bandwidth: input.subscribed_bandwidth });
  if (!d.ok) return out('ESCALATE', null, `diagnostics failed: ${d.error}`);
  const m = metricsOf(d.value);
  if (!m) return out('ESCALATE', null, 'diagnostics returned no usable metrics');

  const flags = { latency_issue: m.latency > LATENCY_MAX_MS, stability_issue: m.jitter > JITTER_MAX_MS, bandwidth_issue: m.bandwidth < plan };
  const measured = { ...m, plan_mbps: plan, ...flags, root_causes: listOf(pick(d.value, /root/i)) };
  if (!Object.values(flags).some(Boolean)) return out('CONCLUDE', 'RESOLVED', 'diagnostics within thresholds; no service fault found', measured);
  return out('CONTINUE', null, 'issues flagged; troubleshooting required', measured);
}

async function troubleshoot(input, port) {
  const done = (next, status, reason, improved = false, steps = []) => ({ next, status, reason, metrics_improved: improved, steps });
  if (!input.root_causes.length) return done('ESCALATE', null, 'no root cause to troubleshoot; no automated step can run');

  const t = await port.tryCall('executeTroubleshooting', { account_id: input.account_id, session_token: input.session_token, root_causes: input.root_causes });
  if (!t.ok) return done('ESCALATE', null, `troubleshooting failed: ${t.error}`);
  const steps = listOf(pick(t.value, /step/i));

  let after = metricsOf(t.value);
  if (!after) {
    // No post-change metrics in the troubleshooting answer: re-execute diagnostics (§5.5).
    const d = await port.tryCall('performTechnicalDiagnostics', { account_id: input.account_id, session_token: input.session_token, service_type: input.service_type, subscribed_bandwidth: input.subscribed_bandwidth });
    after = d.ok ? metricsOf(d.value) : null;
  }
  if (!after) return done('ESCALATE', null, 'no post-troubleshooting metrics available', false, steps);

  if (metricsImproved(input.baseline, after, input.plan_mbps, input.flags)) return done('CONCLUDE', 'RESOLVED', 'metrics improved after troubleshooting; issue fixed', true, steps);
  return done('ESCALATE', null, 'no significant improvement after troubleshooting', false, steps);
}

async function escalate(input, port) {
  const r = await port.tryCall('createEscalation', { session_token: input.session_token, ticket_id: input.ticket_id, metrics_improved_post_troubleshooting: input.metrics_improved, escalation_required: true });
  if (!r.ok) return { ticket_created: false, escalation_ticket_id: null, team: null, reason: `escalation ticket not created: ${r.error}` };
  const id = text(pick(r.value, /escalation.*ticket/i));
  const team = text(pick(r.value, /team/i));
  return { ticket_created: true, escalation_ticket_id: id || null, team: team || null, reason: `escalated to ${team || 'support team'}` };
}

async function finalize(input) {
  // No stage reached a resolution: close the case as failed.
  const status = STATUSES.includes(input.status) ? input.status : 'FAILED';
  const summary = [...input.trail, `final status ${status}${input.escalation_ticket_id ? ` (escalation ${input.escalation_ticket_id})` : ''}`].join(' | ');
  return { final_resolution_status: status, resolution_summary: summary };
}

// ---- parent orchestrator
const trail = [];
const stage = async (name, spec, input, fn) => {
  const r = await sop.section(name, spec, input, fn);
  trail.push(`${name}: ${r.reason}`);
  return r;
};
// Stage result to an end state: CONCLUDE carries a status, ESCALATE goes to 5.6, CONTINUE returns null.
const endOf = r => (r.next === 'CONCLUDE' ? { escalate: false, status: r.status, reason: r.reason, metrics_improved: false }
  : r.next === 'ESCALATE' ? { escalate: true, status: null, reason: r.reason, metrics_improved: !!r.metrics_improved } : null);

async function resolveCase(inp) {
  const a = await stage(SEC.auth, SPEC.auth, { account_id: inp.account_id ?? null }, authenticate);
  let end = endOf(a);
  if (end) return { ...end, session_token: null, ticket_id: null };
  const session = a.session_token, ticket = a.ticket_id;
  const common = { account_id: inp.account_id, session_token: session };

  end = endOf(await stage(SEC.status, SPEC.status, common, checkEligibility));
  if (end) return { ...end, session_token: session, ticket_id: ticket };

  end = endOf(await stage(SEC.outage, SPEC.outage, { ...common, service_area_code: inp.service_area_code ?? null }, checkOutage));
  if (end) return { ...end, session_token: session, ticket_id: ticket };

  const d = await stage(SEC.diagnosis, SPEC.diagnosis, { ...common, service_type: inp.service_type ?? null, subscribed_bandwidth: inp.subscribed_bandwidth ?? null }, diagnose);
  end = endOf(d);
  if (end) return { ...end, session_token: session, ticket_id: ticket };

  const t = await stage(SEC.troubleshooting, SPEC.troubleshooting, {
    ...common, service_type: inp.service_type, subscribed_bandwidth: inp.subscribed_bandwidth,
    root_causes: d.root_causes, plan_mbps: d.plan_mbps,
    baseline: { latency: d.latency, jitter: d.jitter, bandwidth: d.bandwidth },
    flags: { latency_issue: d.latency_issue, stability_issue: d.stability_issue, bandwidth_issue: d.bandwidth_issue },
  }, troubleshoot);
  return { ...endOf(t), session_token: session, ticket_id: ticket };
}

const first = await resolveCase(task.inputs ?? {});
let status = first.status;
let escalationTicket = null;
if (first.escalate) {
  const e = await stage(SEC.escalation, SPEC.escalation, { session_token: first.session_token, ticket_id: first.ticket_id, metrics_improved: first.metrics_improved, reason: first.reason }, escalate);
  status = 'ESCALATED';
  escalationTicket = e.escalation_ticket_id;
}
const fin = await stage(SEC.final, SPEC.final, { status, reason: first.reason, trail: [...trail], escalation_ticket_id: escalationTicket }, finalize);
sop.done({ final_resolution_status: fin.final_resolution_status });
