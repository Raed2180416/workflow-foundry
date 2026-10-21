import { createFlow } from './tools/flow.mjs';
import { createSop } from './tools/sop.mjs';
const flow = createFlow({ budgetUsd: 0.05 });
const sop = createSop(flow);
const task = flow.input();
import * as rules from './lib/rules.mjs';

// Task inputs as trimmed strings, or null when absent (a number or padded value must not break a section's input schema).
const input = name => { const v = rules.text(task.inputs?.[name]); return v === '' ? null : v; };

// The SOP's sections (5.1 to 5.7). Each is a typed sub-workflow: declared input and output schemas, and the only tools it
// may call. Decisions are plain code; no model is used.
const str = { type: ['string', 'null'] };
const bool = { type: 'boolean' };
const ELIGIBILITY = ['CONTINUE', 'PENDING_ACTION', 'INELIGIBLE'];
const FINAL = ['RESOLVED', 'PENDING_ACTION', 'ESCALATED', 'FAILED'];
const metrics = { type: ['object', 'null'], properties: { latency: { type: 'number' }, jitter: { type: 'number' }, bandwidth: { type: 'number' } } };
const strings = { type: 'array', items: { type: 'string' } };

const CASE_ID = {
  type: 'object', required: ['account_id'], properties: { account_id: str },
};
const CASE_SESSION = {
  type: 'object', required: ['account_id', 'session_token'], properties: { account_id: str, session_token: str },
};

const s51 = await sop.section('5.1 Authentication and Ticket Initialization', {
  input: CASE_ID,
  output: {
    type: 'object',
    required: ['is_account_id_valid', 'is_authenticated', 'session_token', 'ticket_id'],
    properties: { is_account_id_valid: bool, is_authenticated: bool, session_token: str, ticket_id: str },
  },
  tools: ['validateAccount', 'getAuthenticationDetails', 'createSessionAndOpenTicket'],
}, { account_id: input('account_id') }, async ({ account_id }, port) => {
  const out = (valid, authed, session_token = null, ticket_id = null) => ({ is_account_id_valid: valid, is_authenticated: authed, session_token, ticket_id });
  // Format check: a malformed ID is logged and the process ends here.
  if (!rules.isAccountIdFormat(account_id)) return out(false, false);
  const v = await port.tryCall('validateAccount', { account_id });
  if (!v.ok || !rules.asBool(rules.field(v.value, 'is account id valid'))) return out(false, false);
  const a = await port.tryCall('getAuthenticationDetails', { account_id, is_account_id_valid: true });
  if (!a.ok || !rules.authenticated(a.value)) return out(true, false);
  const s = await port.tryCall('createSessionAndOpenTicket', { account_id, is_account_id_valid: true, is_authenticated: true });
  if (!s.ok) return out(true, true);
  return out(true, true, rules.text(rules.field(s.value, 'session token')) || null,
    rules.text(rules.field(s.value, 'ticket identifer', 'ticket identifier')) || null);
});

const authenticated = s51.is_authenticated && s51.session_token !== null;
let eligibility = null, outage_detected = false, escalation_required = false;

if (authenticated) {
  const s52 = await sop.section('5.2 Account Status Evaluation', {
    input: CASE_SESSION,
    output: {
      type: 'object', required: ['eligibility', 'account_status', 'suspension_status'],
      properties: { eligibility: { type: 'string', enum: ELIGIBILITY }, account_status: str, suspension_status: str },
    },
    tools: ['checkAccountStatus', 'checkAccountSuspensionStatus'],
  }, { account_id: input('account_id'), session_token: s51.session_token }, async ({ account_id, session_token }, port) => {
    const st = await port.tryCall('checkAccountStatus', { account_id, session_token });
    const su = await port.tryCall('checkAccountSuspensionStatus', { account_id, session_token });
    if (!st.ok) return { eligibility: 'INELIGIBLE', account_status: null, suspension_status: null };
    const status = rules.text(rules.field(st.value, 'account status'));
    const suspension = su.ok ? rules.text(rules.field(su.value, 'account suspension status')) : '';
    const reason = rules.text(rules.field(st.value, 'reason'));
    return { eligibility: rules.eligibility({ status, reason, suspension }), account_status: status || null, suspension_status: suspension || null };
  });
  eligibility = s52.eligibility;

  if (eligibility === 'CONTINUE') {
    const s53 = await sop.section('5.3 Outage and Service Area Analysis', {
      input: {
        type: 'object', required: ['account_id', 'session_token', 'service_area_code'],
        properties: { account_id: str, session_token: str, service_area_code: str },
      },
      output: {
        type: 'object', required: ['outage_detected', 'outage_id'], properties: { outage_detected: bool, outage_id: str },
      },
      tools: ['checkServiceAreaOutage'],
    }, { account_id: input('account_id'), session_token: s51.session_token, service_area_code: input('service_area_code') }, async ({ account_id, session_token, service_area_code }, port) => {
      if (!service_area_code) return { outage_detected: false, outage_id: null };
      const o = await port.tryCall('checkServiceAreaOutage', { account_id, session_token, service_area_code });
      if (!o.ok) return { outage_detected: false, outage_id: null };
      const detected = rules.asBool(rules.field(o.value, 'outage detected'));
      const id = rules.text(rules.field(o.value, 'outage id'));
      return { outage_detected: detected, outage_id: detected && id ? id : null };
    });
    outage_detected = s53.outage_detected;
  }

  if (eligibility === 'CONTINUE' && !outage_detected) {
    // The outage check concluded nothing, so diagnose the service type on the plan the customer subscribes to.
    const s54 = await sop.section('5.4 Technical Diagnosis', {
      input: {
        type: 'object', required: ['account_id', 'session_token', 'service_type', 'subscribed_bandwidth'],
        properties: { account_id: str, session_token: str, service_type: str, subscribed_bandwidth: str },
      },
      output: {
        type: 'object',
        required: ['diagnosed', 'pre_metrics', 'plan_mbps', 'latency_issue', 'stability_issue', 'bandwidth_issue', 'root_causes'],
        properties: {
          diagnosed: bool, pre_metrics: metrics, plan_mbps: { type: ['number', 'null'] },
          latency_issue: bool, stability_issue: bool, bandwidth_issue: bool, root_causes: strings,
        },
      },
      tools: ['performTechnicalDiagnostics'],
    }, {
      account_id: input('account_id'), session_token: s51.session_token,
      service_type: input('service_type'), subscribed_bandwidth: input('subscribed_bandwidth'),
    }, async ({ account_id, session_token, service_type, subscribed_bandwidth }, port) => {
      const none = { diagnosed: false, pre_metrics: null, plan_mbps: null, latency_issue: false, stability_issue: false, bandwidth_issue: false, root_causes: [] };
      const plan = rules.parseMbps(subscribed_bandwidth);
      if (!service_type || plan === null) return none;
      const d = await port.tryCall('performTechnicalDiagnostics', { account_id, session_token, service_type, subscribed_bandwidth });
      if (!d.ok) return none;
      const m = rules.metricsOf(rules.field(d.value, 'service metrics'));
      if (!m) return none;
      return {
        diagnosed: true, pre_metrics: m, plan_mbps: plan, ...rules.flagsOf(m, plan),
        root_causes: rules.listOf(rules.field(d.value, 'root causes')),
      };
    });

    if (!s54.diagnosed) {
      // No readings to act on: troubleshooting cannot run, so the case goes to escalation.
      escalation_required = true;
    } else {
      const s55 = await sop.section('5.5 Troubleshooting', {
        input: {
          type: 'object',
          required: ['account_id', 'session_token', 'service_type', 'subscribed_bandwidth', 'root_causes', 'pre_metrics', 'plan_mbps',
            'latency_issue', 'stability_issue', 'bandwidth_issue'],
          properties: {
            account_id: str, session_token: str, service_type: str, subscribed_bandwidth: str, root_causes: strings,
            pre_metrics: metrics, plan_mbps: { type: ['number', 'null'] },
            latency_issue: bool, stability_issue: bool, bandwidth_issue: bool,
          },
        },
        output: {
          type: 'object', required: ['metrics_improved', 'escalation_required'],
          properties: { metrics_improved: bool, escalation_required: bool },
        },
        tools: ['executeTroubleshooting', 'performTechnicalDiagnostics'],
      }, {
        account_id: input('account_id'), session_token: s51.session_token,
        service_type: input('service_type'), subscribed_bandwidth: input('subscribed_bandwidth'),
        root_causes: s54.root_causes, pre_metrics: s54.pre_metrics, plan_mbps: s54.plan_mbps,
        latency_issue: s54.latency_issue, stability_issue: s54.stability_issue, bandwidth_issue: s54.bandwidth_issue,
      }, async (inp, port) => {
        const { account_id, session_token, service_type, subscribed_bandwidth, root_causes, pre_metrics, plan_mbps } = inp;
        if (!inp.latency_issue && !inp.stability_issue && !inp.bandwidth_issue) return { metrics_improved: true, escalation_required: false };
        if (!root_causes.length || !pre_metrics || plan_mbps === null) return { metrics_improved: false, escalation_required: true };
        const t = await port.tryCall('executeTroubleshooting', { account_id, session_token, root_causes });
        if (!t.ok) return { metrics_improved: false, escalation_required: true };
        const troubledAt = Date.parse(rules.text(rules.field(t.value, 'timestamp troubleshooting completed')));
        let post = rules.metricsOf(rules.field(t.value, 'updated service metrics'));
        // Re-run diagnostics as the SOP says. A reading older than the troubleshooting run is the pre-troubleshooting record,
        // so only a newer reading replaces the updated metrics.
        const again = await port.tryCall('performTechnicalDiagnostics', { account_id, session_token, service_type, subscribed_bandwidth });
        if (again.ok) {
          const fresh = rules.metricsOf(rules.field(again.value, 'service metrics'));
          const freshAt = Date.parse(rules.text(rules.field(again.value, 'timestamp diagnostics completed')));
          if (fresh && Number.isFinite(freshAt) && (!Number.isFinite(troubledAt) || freshAt > troubledAt)) post = fresh;
        }
        if (!post) return { metrics_improved: false, escalation_required: true };
        const r = rules.improvement(pre_metrics, post, plan_mbps);
        if (r.improved && r.outsideLimit.length) flow.flag('improved-by-significance-only', { metrics: r.outsideLimit });
        return { metrics_improved: r.improved, escalation_required: !r.improved };
      });
      escalation_required = s55.escalation_required;
    }

    if (escalation_required && s51.ticket_id) {
      await sop.section('5.6 Escalation Procedures', {
        input: {
          type: 'object', required: ['session_token', 'ticket_id', 'metrics_improved'],
          properties: { session_token: str, ticket_id: str, metrics_improved: bool },
        },
        output: { type: 'object', required: ['escalation_ticket_id'], properties: { escalation_ticket_id: str } },
        tools: ['createEscalation'],
      }, { session_token: s51.session_token, ticket_id: s51.ticket_id, metrics_improved: false }, async ({ session_token, ticket_id, metrics_improved }, port) => {
        const e = await port.tryCall('createEscalation', {
          session_token, ticket_id, metrics_improved_post_troubleshooting: metrics_improved, escalation_required: true,
        });
        return { escalation_ticket_id: e.ok ? rules.text(rules.field(e.value, 'escalation ticket')) || null : null };
      });
    }
  }
}

const s57 = await sop.section('5.7 Final Resolution and Documentation', {
  input: {
    type: 'object', required: ['authenticated', 'eligibility', 'outage_detected', 'escalation_required'],
    properties: { authenticated: bool, eligibility: { type: ['string', 'null'], enum: [...ELIGIBILITY, null] }, outage_detected: bool, escalation_required: bool },
  },
  output: { type: 'object', required: ['final_resolution_status'], properties: { final_resolution_status: { type: 'string', enum: FINAL } } },
  tools: [],
}, { authenticated, eligibility, outage_detected, escalation_required }, async (inp) => {
  // FAILED: authentication not completed, or the account is not eligible for support.
  if (!inp.authenticated || inp.eligibility === null || inp.eligibility === 'INELIGIBLE') return { final_resolution_status: 'FAILED' };
  // PENDING_ACTION: awaiting Accounts Payable (non-payment) or an outage to be resolved.
  if (inp.eligibility === 'PENDING_ACTION' || inp.outage_detected) return { final_resolution_status: 'PENDING_ACTION' };
  // ESCALATED: automated troubleshooting could not resolve the issue; otherwise RESOLVED.
  return { final_resolution_status: inp.escalation_required ? 'ESCALATED' : 'RESOLVED' };
});

sop.done({ final_resolution_status: s57.final_resolution_status });
