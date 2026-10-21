import { createFlow } from './tools/flow.mjs';
import { createSop } from './tools/sop.mjs';
const flow = createFlow({ budgetUsd: 0.05 });
const sop = createSop(flow);
const task = flow.input();
import { ALL_FIELDS, TOOL_FIELDS, contract, readFields } from './lib/fields.mjs';
import { RISK_LEVELS, VIOLATION_TYPES, enforcementAction, riskSeverity, scoreViolations, violationType } from './lib/rules.mjs';

// Sections 5.1 to 5.5 read the tools; 5.7 (Steps 1 to 4) is computed from what they read, with no tool.
const ACCOUNT_IN = { type: 'object', required: ['account_id'], properties: { account_id: { type: 'string' } }, additionalProperties: false };
const EVIDENCE = contract(ALL_FIELDS);
const VIOLATION_TYPE = { type: 'string', enum: VIOLATION_TYPES };
const RISK = { type: ['string', 'null'], enum: [...RISK_LEVELS, null] };

// The fields of one tool result. A failed call leaves its fields unknown (null) and is flagged in the trace.
const fieldsOf = (tool, r, names) => {
  if (!r.ok) flow.flag('tool-failed', { tool, error: String(r.error).slice(0, 200) });
  return readFields(r.ok ? r.value : null, names);
};

const investigation = await sop.section('5.1 Account Investigation Process', {
  input: ACCOUNT_IN,
  output: contract(TOOL_FIELDS.investigate_account),
  tools: ['investigate_account'],
}, { account_id: task.inputs.account_id }, async (input, port) => {
  const r = await port.tryCall('investigate_account', { account_id: input.account_id });
  return fieldsOf('investigate_account', r, TOOL_FIELDS.investigate_account);
});

const temporal = await sop.section('5.2 Temporal Pattern Analysis', {
  input: ACCOUNT_IN,
  output: contract(TOOL_FIELDS.analyze_temporal_patterns),
  tools: ['analyze_temporal_patterns'],
}, { account_id: task.inputs.account_id }, async (input, port) => {
  const r = await port.tryCall('analyze_temporal_patterns', { account_id: input.account_id });
  return fieldsOf('analyze_temporal_patterns', r, TOOL_FIELDS.analyze_temporal_patterns);
});

const traffic = await sop.section('5.4 Traffic Analysis Report Review', {
  input: ACCOUNT_IN,
  output: contract([...TOOL_FIELDS.analyze_traffic_patterns, ...TOOL_FIELDS.get_financial_impact]),
  tools: ['analyze_traffic_patterns', 'get_financial_impact'],
}, { account_id: task.inputs.account_id }, async (input, port) => {
  const [t, f] = await port.batch([
    { name: 'analyze_traffic_patterns', arguments: { account_id: input.account_id } },
    { name: 'get_financial_impact', arguments: { account_id: input.account_id } },
  ]);
  return {
    ...fieldsOf('analyze_traffic_patterns', t, TOOL_FIELDS.analyze_traffic_patterns),
    ...fieldsOf('get_financial_impact', f, TOOL_FIELDS.get_financial_impact),
  };
});

const history = await sop.section('5.5 Historical Context Review', {
  input: ACCOUNT_IN,
  output: contract(TOOL_FIELDS.get_violation_history),
  tools: ['get_violation_history'],
}, { account_id: task.inputs.account_id }, async (input, port) => {
  const r = await port.tryCall('get_violation_history', { account_id: input.account_id });
  return fieldsOf('get_violation_history', r, TOOL_FIELDS.get_violation_history);
});

const evidence = { ...investigation, ...temporal, ...traffic, ...history };

const scored = await sop.section('5.7 Violation Type (Steps 1-2)', {
  input: { type: 'object', required: ['evidence'], properties: { evidence: EVIDENCE }, additionalProperties: false },
  output: {
    type: 'object',
    required: ['violation_type', 'scores'],
    properties: { violation_type: VIOLATION_TYPE, scores: { type: 'object' } },
    additionalProperties: false,
  },
  tools: [],
}, { evidence }, async input => {
  const missing = ALL_FIELDS.filter(k => input.evidence[k] === null);
  if (missing.length) flow.flag('missing-evidence', { fields: missing });
  const scores = scoreViolations(input.evidence);
  return { violation_type: violationType(scores), scores };
});

const risk = await sop.section('5.7 Risk Severity (Step 3)', {
  input: {
    type: 'object',
    required: ['evidence', 'violation_type'],
    properties: { evidence: EVIDENCE, violation_type: VIOLATION_TYPE },
    additionalProperties: false,
  },
  output: {
    type: 'object',
    required: ['risk_severity'],
    properties: { risk_severity: RISK },
    additionalProperties: false,
  },
  tools: [],
}, { evidence, violation_type: scored.violation_type }, async input => {
  const isViolation = input.violation_type !== 'none' && input.violation_type !== 'inconclusive';
  return { risk_severity: isViolation ? riskSeverity(input.evidence) : null };
});

const decision = await sop.section('5.7 Enforcement Action (Step 4)', {
  input: {
    type: 'object',
    required: ['violation_type', 'risk_severity', 'previous_violations_count'],
    properties: {
      violation_type: VIOLATION_TYPE,
      risk_severity: RISK,
      previous_violations_count: { type: ['number', 'null'] },
    },
    additionalProperties: false,
  },
  output: {
    type: 'object',
    required: ['final_decision'],
    properties: { final_decision: { type: 'string' } },
    additionalProperties: false,
  },
  tools: [],
}, {
  violation_type: scored.violation_type,
  risk_severity: risk.risk_severity,
  previous_violations_count: evidence.previous_violations_count,
}, async input => ({
  final_decision: enforcementAction(input.violation_type, input.risk_severity, input.previous_violations_count),
}));

sop.done({ final_decision: decision.final_decision });
