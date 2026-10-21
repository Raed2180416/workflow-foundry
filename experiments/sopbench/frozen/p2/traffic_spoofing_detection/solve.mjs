import { createFlow } from './tools/flow.mjs';
import { createSop } from './tools/sop.mjs';
const flow = createFlow({ budgetUsd: 0.05 });
const sop = createSop(flow);
const task = flow.input();

import { readCase } from './lib/input.mjs';
import {
  LEVELS, finding, text, statusFinding, ratioFinding, engagementFinding, conversionFinding, clickSpikeFinding,
  deviceFinding, bounceFinding, durationFinding, unattributedFinding, percentOf, sourceFinding, isBlankSource,
  RESPONSES, violationClass, riskLevel, derivedRisk, enforcementAction,
} from './lib/rules.mjs';

// Section contract helpers. Every section input and output is an object with the keys listed here.
const nullable = type => ({ type: [type, 'null'] });
const obj = (properties, required = []) => ({ type: 'object', required, properties });
const findingsSchema = {
  type: 'array',
  items: obj({ code: { type: 'string' }, level: { type: 'string', enum: LEVELS }, detail: { type: 'string' } }, ['code', 'level', 'detail']),
};
const findingsOutput = obj({ findings: findingsSchema, tool_status: nullable('string') }, ['findings', 'tool_status']);

// A tool a section calls with the task's own values. A call with a missing argument is not made, and a tool error is not
// fatal: either way the section records an 'unavailable' finding and the procedure goes on with what it has.
async function runTool(port, name, args) {
  const absent = Object.keys(args).filter(k => args[k] == null);
  if (absent.length) return { value: null, finding: finding(name, 'unavailable', `not run: missing ${absent.join(', ')}`) };
  const r = await port.tryCall(name, args);
  if (!r.ok) {
    flow.flag('tool-error', { name, error: r.error });
    return { value: null, finding: finding(name, 'unavailable', `tool error: ${r.error}`) };
  }
  return { value: r.value, finding: statusFinding(name, r.value) };
}

const c = readCase(task.inputs);

// 5.1 Partner Account Validation
const s51 = await sop.section('5.1 Partner Account Validation', {
  input: obj({
    partner_id: { type: 'string' },
    websites: { type: 'array', items: { type: 'string' } },
    earnings_amount: nullable('number'),
    unique_users: nullable('number'),
    total_orders: nullable('number'),
  }, ['partner_id', 'websites']),
  output: findingsOutput,
  tools: ['InvestigateViolations'],
}, { partner_id: c.partner_id, websites: c.websites, earnings_amount: c.earnings_amount, unique_users: c.unique_users, total_orders: c.total_orders },
async (input, port) => {
  // 5.1.1 TAVM verification of the partner and its registered websites.
  const tavm = await runTool(port, 'InvestigateViolations', {
    partner_id: input.partner_id, registered_websites: input.websites, earnings_amount: input.earnings_amount,
  });
  // 5.1.2 earnings_amount is cross-referenced with violation thresholds. The SOP gives no threshold value, so none is applied.
  // 5.1.3 unique users to total orders.
  const findings = [tavm.finding, ratioFinding(input.unique_users, input.total_orders)];
  return { findings, tool_status: tavm.value == null ? null : text(tavm.value) };
});

// 5.2 Traffic Pattern Analysis
const s52 = await sop.section('5.2 Traffic Pattern Analysis', {
  input: obj({
    partner_id: { type: 'string' },
    engagement_score: nullable('number'),
    conversion_rate: nullable('number'),
    click_spike: nullable('number'),
    computer_traffic_percent: nullable('number'),
    phone_traffic_percent: nullable('number'),
    bounce_rate: nullable('number'),
  }, ['partner_id']),
  output: findingsOutput,
  tools: ['AnalyzeTrafficPatterns'],
}, {
  partner_id: c.partner_id, engagement_score: c.engagement_score, conversion_rate: c.conversion_rate, click_spike: c.click_spike,
  computer_traffic_percent: c.computer_traffic_percent, phone_traffic_percent: c.phone_traffic_percent, bounce_rate: c.bounce_rate,
}, async (input, port) => {
  // The tool needs bounce_rate too, which is checked in 5.3.
  const traffic = await runTool(port, 'AnalyzeTrafficPatterns', {
    partner_id: input.partner_id, engagement_score: input.engagement_score, conversion_rate: input.conversion_rate, bounce_rate: input.bounce_rate,
  });
  const findings = [
    engagementFinding(input.engagement_score),              // 5.2.1
    conversionFinding(input.conversion_rate),               // 5.2.2
    clickSpikeFinding(input.click_spike),                   // 5.2.3
    deviceFinding(input.computer_traffic_percent, input.phone_traffic_percent), // 5.2.4
    traffic.finding,
  ];
  return { findings, tool_status: traffic.value == null ? null : text(traffic.value) };
});

// 5.3 Source Authentication Investigation
const s53 = await sop.section('5.3 Source Authentication Investigation', {
  input: obj({
    partner_id: { type: 'string' },
    bounce_rate: nullable('number'),
    visit_duration_seconds: nullable('number'),
    unattributed_clicks: nullable('number'),
    total_clicks: nullable('number'),
    top_referral_source: nullable('string'),
  }, ['partner_id']),
  output: findingsOutput,
  tools: ['ValidateReferralSources'],
}, {
  partner_id: c.partner_id, bounce_rate: c.bounce_rate, visit_duration_seconds: c.visit_duration_seconds,
  unattributed_clicks: c.unattributed_clicks, total_clicks: c.total_clicks, top_referral_source: c.top_referral_source,
}, async (input, port) => {
  // 5.3.1 the unattributed share needs the click total. Without it the share is not checked, and no count is read as a percent.
  const share = percentOf(input.unattributed_clicks, input.total_clicks);
  if (input.unattributed_clicks != null && share == null) flow.flag('unattributed-share-not-checked', { unattributed_clicks: input.unattributed_clicks });
  const referral = await runTool(port, 'ValidateReferralSources', {
    partner_id: input.partner_id,
    unattributed_clicks: input.unattributed_clicks == null ? null : Math.round(input.unattributed_clicks),
    top_referral_source: input.top_referral_source,
  });
  const findings = [
    bounceFinding(input.bounce_rate),
    durationFinding(input.visit_duration_seconds),
    unattributedFinding(share),
    referral.finding,
  ];
  return { findings, tool_status: referral.value == null ? null : text(referral.value) };
});

// 5.4 Violation Classification
const s54 = await sop.section('5.4 Violation Classification', {
  input: obj({ violation_type: nullable('string'), top_referral_source: nullable('string') }, []),
  output: obj({
    category: nullable('string'),
    response: nullable('string'),
    findings: findingsSchema,
  }, ['category', 'response', 'findings']),
  tools: [],
}, { violation_type: c.violation_type, top_referral_source: c.top_referral_source }, async input => {
  // 5.4.1-5.4.3 by violation class; 5.4.4 when the class is unknown and the traffic source cannot be identified.
  const byType = violationClass(input.violation_type);
  const category = byType ?? (isBlankSource(input.top_referral_source) && input.top_referral_source != null ? 'blank' : null);
  if (!category) flow.flag('violation-unclassified', { violation_type: input.violation_type });
  return {
    category,
    response: category ? RESPONSES[category] : null,
    findings: [sourceFinding(input.top_referral_source)],
  };
});

// 5.5 Evidence Documentation
const s55 = await sop.section('5.5 Evidence Documentation', {
  input: obj({
    partner_id: { type: 'string' },
    violation_type: nullable('string'),
    evidence: { type: 'array', items: { type: 'string' } },
  }, ['partner_id', 'evidence']),
  output: obj({
    documented: { type: 'boolean' },
    evidence: { type: 'array', items: { type: 'string' } },
    report_status: nullable('string'),
  }, ['documented', 'evidence', 'report_status']),
  tools: ['GenerateEvidenceReport'],
}, { partner_id: c.partner_id, violation_type: c.violation_type, evidence: c.evidence }, async (input, port) => {
  const report = await runTool(port, 'GenerateEvidenceReport', {
    partner_id: input.partner_id, violation_type: input.violation_type, evidence_collected: input.evidence,
  });
  return {
    documented: input.evidence.length > 0,
    evidence: input.evidence,
    report_status: report.value == null ? null : text(report.value),
  };
});

const findings = [...s51.findings, ...s52.findings, ...s53.findings, ...s54.findings];

// 5.6 Enforcement Action Determination
const s56 = await sop.section('5.6 Enforcement Action Determination', {
  input: obj({
    partner_id: { type: 'string' },
    risk_level: nullable('string'),
    violation_type: nullable('string'),
    engagement_score: nullable('number'),
    conversion_rate: nullable('number'),
    documented: { type: 'boolean' },
    findings: findingsSchema,
  }, ['partner_id', 'documented', 'findings']),
  output: obj({
    risk_level: { type: 'string' },
    risk_source: { type: 'string' },
    enforcement_action: { type: 'string' },
    basis: { type: 'string' },
  }, ['risk_level', 'risk_source', 'enforcement_action', 'basis']),
  tools: ['CalculateRiskScore'],
}, {
  partner_id: c.partner_id, risk_level: c.risk_level, violation_type: c.violation_type, engagement_score: c.engagement_score,
  conversion_rate: c.conversion_rate, documented: s55.documented, findings,
}, async (input, port) => {
  const score = await runTool(port, 'CalculateRiskScore', {
    partner_id: input.partner_id, violation_type: input.violation_type, engagement_score: input.engagement_score, conversion_rate: input.conversion_rate,
  });
  const inputRisk = riskLevel(input.risk_level);
  const toolRisk = score.value == null ? null : riskLevel(text(score.value));
  // The task's own risk level is used. The risk tool is used when the task has none, and the findings only when neither gives one.
  const risk = inputRisk ?? toolRisk ?? derivedRisk(input.findings);
  const risk_source = inputRisk ? 'task risk_level' : toolRisk ? 'CalculateRiskScore' : 'derived from findings';
  if (inputRisk && toolRisk && inputRisk !== toolRisk) flow.flag('risk-level-disagrees', { input: inputRisk, tool: toolRisk });
  if (risk_source !== 'task risk_level') flow.flag('risk-level-not-in-task', { risk_source, risk });
  const { action, basis } = enforcementAction(risk, input.findings, input.documented);
  if (action === 'Warning Issued' && risk === 'Medium') flow.flag('medium-discretion-warning', { findings: input.findings.length });
  return { risk_level: risk, risk_source, enforcement_action: action, basis };
});

// 6.2 Digital Violation Record Update: the determined action is executed in the violation system.
const s62 = await sop.section('6.2 Digital Violation Record Update', {
  input: obj({
    partner_id: { type: 'string' },
    risk_level: { type: 'string' },
    violation_type: nullable('string'),
    enforcement_action: { type: 'string' },
  }, ['partner_id', 'risk_level', 'enforcement_action']),
  output: obj({ executed: { type: 'boolean' }, record_status: nullable('string') }, ['executed', 'record_status']),
  tools: ['ExecuteEnforcementAction'],
}, {
  partner_id: c.partner_id, risk_level: s56.risk_level, violation_type: c.violation_type, enforcement_action: s56.enforcement_action,
}, async (input, port) => {
  if (input.enforcement_action === 'No Action') return { executed: false, record_status: null };
  const run = await runTool(port, 'ExecuteEnforcementAction', {
    partner_id: input.partner_id, risk_level: input.risk_level, violation_type: input.violation_type,
  });
  return { executed: run.value != null, record_status: run.value == null ? null : text(run.value) };
});

sop.done({ enforcement_action: s56.enforcement_action });
