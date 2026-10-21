import { createFlow } from './tools/flow.mjs'; import { createSop } from './tools/sop.mjs'; const flow = createFlow({ budgetUsd: 0.05 }); const sop = createSop(flow); const task = flow.input();
import { ACTION_FOR, CLOSURE, NON_CLOSURE, asBool, asNumber, asText, connectedBand, isRecord, scoreAll, violationType } from './lib/rules.mjs';

// Parent orchestrator for SOP referral_abuse_detection_v1: one section per SOP part that calls a tool or takes a decision.
// Data moves only through each section's declared input and output.

const NULL_BOOL = { type: ['boolean', 'null'] };
const NULL_NUM = { type: ['number', 'null'] };
const NULL_TEXT = { type: ['string', 'null'] };
const VIOLATION_TYPES = [...CLOSURE, ...NON_CLOSURE, 'INCONCLUSIVE'];
const ACTIONS = ['Account Closure', 'No Action', 'Inconclusive'];
const accountSchema = { type: 'object', required: ['account_id'], properties: { account_id: { type: 'string' } }, additionalProperties: false };

// Section 5.1 Account Investigation Process: address, email, website and login checks come from investigate_account.
const investigate = (accountId) => sop.section('5.1 Account Investigation Process', {
  input: accountSchema,
  output: {
    type: 'object',
    required: ['available', 'address_validity', 'email_pattern_suspicious', 'website_verified', 'connected_accounts', 'login_geographic_consistency'],
    properties: {
      available: { type: 'boolean' },
      address_validity: NULL_BOOL,
      email_pattern_suspicious: NULL_BOOL,
      website_verified: NULL_BOOL,
      connected_accounts: NULL_NUM,
      login_geographic_consistency: NULL_BOOL,
    },
    additionalProperties: false,
  },
  tools: ['investigate_account'],
}, { account_id: accountId }, async (input, port) => {
  const unavailable = { available: false, address_validity: null, email_pattern_suspicious: null, website_verified: null, connected_accounts: null, login_geographic_consistency: null };
  const r = await port.tryCall('investigate_account', { account_id: input.account_id });
  if (!r.ok || !isRecord(r.value)) {
    flow.flag('investigation-unavailable', { error: r.ok ? 'answer is not an object' : r.error });
    return unavailable;
  }
  const v = r.value;
  return {
    available: true,
    address_validity: asBool(v.address_validity),
    email_pattern_suspicious: asBool(v.email_pattern_suspicious),
    website_verified: asBool(v.website_verified),
    connected_accounts: asNumber(v.connected_accounts),
    login_geographic_consistency: asBool(v.login_geographic_consistency),
  };
});

// Section 5.2 Account Relations Investigation: classifies the linked-account count and reads the login pattern. No tool.
const relations = (inv) => sop.section('5.2 Account Relations Investigation', {
  input: {
    type: 'object',
    required: ['connected_accounts', 'login_geographic_consistency'],
    properties: { connected_accounts: NULL_NUM, login_geographic_consistency: NULL_BOOL },
    additionalProperties: false,
  },
  output: {
    type: 'object',
    required: ['connected_band', 'login_consistent'],
    properties: {
      connected_band: { type: ['string', 'null'], enum: ['none', 'some', 'many', null] },
      login_consistent: NULL_BOOL,
    },
    additionalProperties: false,
  },
  tools: [],
}, { connected_accounts: inv.connected_accounts, login_geographic_consistency: inv.login_geographic_consistency }, async input => ({
  connected_band: connectedBand(input.connected_accounts),
  login_consistent: input.login_geographic_consistency,
}));

// Section 5.3 Traffic Analysis Report Review: referral source, click-through, payment sharing and order patterns.
const traffic = (accountId) => sop.section('5.3 Traffic Analysis Report Review', {
  input: accountSchema,
  output: {
    type: 'object',
    required: ['available', 'referral_source_quality', 'click_through_rate', 'payment_method_shared', 'order_patterns_suspicious'],
    properties: {
      available: { type: 'boolean' },
      referral_source_quality: NULL_TEXT,
      click_through_rate: NULL_NUM,
      payment_method_shared: NULL_BOOL,
      order_patterns_suspicious: NULL_BOOL,
    },
    additionalProperties: false,
  },
  tools: ['analyze_traffic_patterns'],
}, { account_id: accountId }, async (input, port) => {
  const unavailable = { available: false, referral_source_quality: null, click_through_rate: null, payment_method_shared: null, order_patterns_suspicious: null };
  const r = await port.tryCall('analyze_traffic_patterns', { account_id: input.account_id });
  if (!r.ok || !isRecord(r.value)) {
    flow.flag('traffic-unavailable', { error: r.ok ? 'answer is not an object' : r.error });
    return unavailable;
  }
  const v = r.value;
  return {
    available: true,
    referral_source_quality: asText(v.referral_source_quality),
    click_through_rate: asNumber(v.click_through_rate),
    payment_method_shared: asBool(v.payment_method_shared),
    order_patterns_suspicious: asBool(v.order_patterns_suspicious),
  };
});

// Section 5.5.1 Calculate Violation Indicators: the four scores and the violation type. Pure code.
const scoreViolations = (facts) => sop.section('5.5.1 Calculate Violation Indicators', {
  input: {
    type: 'object',
    required: ['investigation_available', 'traffic_available', 'address_validity', 'email_pattern_suspicious', 'website_verified',
      'login_geographic_consistency', 'connected_band', 'referral_source_quality', 'click_through_rate', 'payment_method_shared',
      'order_patterns_suspicious'],
    properties: {
      investigation_available: { type: 'boolean' },
      traffic_available: { type: 'boolean' },
      address_validity: NULL_BOOL,
      email_pattern_suspicious: NULL_BOOL,
      website_verified: NULL_BOOL,
      login_geographic_consistency: NULL_BOOL,
      connected_band: { type: ['string', 'null'], enum: ['none', 'some', 'many', null] },
      referral_source_quality: NULL_TEXT,
      click_through_rate: NULL_NUM,
      payment_method_shared: NULL_BOOL,
      order_patterns_suspicious: NULL_BOOL,
    },
    additionalProperties: false,
  },
  output: {
    type: 'object',
    required: ['aac_score', 'mac_score', 'po_score', 'nv_score', 'violation_type'],
    properties: {
      aac_score: { type: 'integer' },
      mac_score: { type: 'integer' },
      po_score: { type: 'integer' },
      nv_score: { type: 'integer' },
      violation_type: { type: 'string', enum: VIOLATION_TYPES },
    },
    additionalProperties: false,
  },
  tools: [],
}, facts, async input => {
  const scores = scoreAll(input);
  const missing = Object.entries(input).filter(([, v]) => v === null).map(([k]) => k);
  if (missing.length) flow.flag('missing-indicator', { fields: missing });
  const complete = input.investigation_available && input.traffic_available;
  const violation = violationType(scores, complete);
  return {
    aac_score: scores['Abusive Account Creation'].score,
    mac_score: scores['Misleading Ad Copy'].score,
    po_score: scores['Personal Orders (Related)'].score,
    nv_score: scores['No Violation'].score,
    violation_type: violation,
  };
});

// Section 5.5.2 Apply Enforcement Action: the SOP's mapping, with determine_enforcement_action's guideline checked against it.
const applyAction = (accountId, violationType) => sop.section('5.5.2 Apply Enforcement Action', {
  input: {
    type: 'object',
    required: ['account_id', 'violation_type'],
    properties: { account_id: { type: 'string' }, violation_type: { type: 'string', enum: VIOLATION_TYPES } },
    additionalProperties: false,
  },
  output: {
    type: 'object',
    required: ['enforcement_action', 'tool_guideline'],
    properties: { enforcement_action: { type: 'string', enum: ACTIONS }, tool_guideline: NULL_TEXT },
    additionalProperties: false,
  },
  tools: ['determine_enforcement_action'],
}, { account_id: accountId, violation_type: violationType }, async (input, port) => {
  const action = ACTION_FOR[input.violation_type];
  if (input.violation_type === 'INCONCLUSIVE') return { enforcement_action: action, tool_guideline: null };
  const r = await port.tryCall('determine_enforcement_action', { account_id: input.account_id });
  const guideline = r.ok && isRecord(r.value) && isRecord(r.value.enforcement_guidelines)
    ? asText(r.value.enforcement_guidelines[input.violation_type]) : null;
  if (guideline !== null && guideline !== action) flow.flag('guideline-mismatch', { violation_type: input.violation_type, tool: guideline, sop: action });
  return { enforcement_action: action, tool_guideline: guideline };
});

async function solve() {
  const raw = task.inputs?.account_id;
  const accountId = raw == null ? '' : String(raw);
  if (!accountId.trim()) {
    flow.flag('no-account-id', {});
    return { enforcement_action: ACTION_FOR.INCONCLUSIVE };
  }
  const inv = await investigate(accountId);
  const rel = await relations(inv);
  const tr = await traffic(accountId);
  const scored = await scoreViolations({
    investigation_available: inv.available,
    traffic_available: tr.available,
    address_validity: inv.address_validity,
    email_pattern_suspicious: inv.email_pattern_suspicious,
    website_verified: inv.website_verified,
    login_geographic_consistency: rel.login_consistent,
    connected_band: rel.connected_band,
    referral_source_quality: tr.referral_source_quality,
    click_through_rate: tr.click_through_rate,
    payment_method_shared: tr.payment_method_shared,
    order_patterns_suspicious: tr.order_patterns_suspicious,
  });
  const decided = await applyAction(accountId, scored.violation_type);
  return { enforcement_action: decided.enforcement_action };
}

sop.done(await solve());
