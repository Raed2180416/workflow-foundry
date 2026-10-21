import { createFlow } from './tools/flow.mjs';
import { createSop } from './tools/sop.mjs';
const flow = createFlow({ budgetUsd: 0.05 });
const sop = createSop(flow);
const task = flow.input();

// SOP 5.2.2: component weight must be within the Component Tolerance Threshold (CTT) of ±2% of the specification.
const WEIGHT_TOLERANCE = 0.02;
// SOP 5.2.4: installation must fall inside the 24-hour compliance window ending at the inspection.
const INSTALL_WINDOW_HOURS = 24;
// SOP 5.2.3: standardized physical condition terms (the mechanical tool's enum).
const CONDITIONS = ['no damage', 'minor wear', 'moderate wear', 'severe wear', 'severe corrosion'];
const BATTERY = ['operational', 'low_charge', 'critical'];
const CIRCUIT = ['success', 'failure', 'retest'];
const AVIONICS = ['success', 'failure', 'retry'];
const INSPECTION = ['success', 'fail', 'retest'];
// Spelling variants of the tools' enums; retest and retry are the same state on the circuit and avionics enums.
const ALIAS = { fail: 'failure', failed: 'failure', pass: 'success', passed: 'success', ok: 'success', retest: 'retry', retry: 'retest', low: 'low_charge' };
const WEIGHT_KEYS = ['component_weight', 'expected_component_weight'];

const I = task.inputs ?? {};

const inputSchema = keys => ({
  type: 'object', required: keys, additionalProperties: false,
  properties: Object.fromEntries(keys.map(k => [k, { type: ['string', 'number', 'boolean', 'null'] }])),
});
const outputSchema = props => ({ type: 'object', required: Object.keys(props), additionalProperties: false, properties: props });
const numberOrNull = v => (v === null || v === undefined || String(v).trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const pick = keys => Object.fromEntries(keys.map(k => [k, WEIGHT_KEYS.includes(k) ? numberOrNull(I[k]) : (I[k] ?? null)]));
const complete = obj => Object.values(obj).every(v => v !== null && v !== undefined && v !== '');
const wordsOf = v => String(v ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
const sameText = (a, b) => wordsOf(a) === wordsOf(b);

// Maps a raw enum-like input onto the tool's enum (case, spacing, common aliases), or null when it matches none.
function enumValue(raw, allowed) {
  const k = wordsOf(raw).replace(/ /g, '_');
  for (const c of [k, ALIAS[k]]) if (allowed.includes(c)) return c;
  return null;
}

// SOP 5.3.1: battery reading in percent (operational above 80%, low from 40% to 80%, critical below 40%); otherwise the enum.
function batteryValue(raw) {
  const pct = /^(\d+(?:\.\d+)?)\s*%?$/.exec(String(raw ?? '').trim());
  if (pct) {
    const p = Number(pct[1]);
    return p > 80 ? 'operational' : p >= 40 ? 'low_charge' : 'critical';
  }
  return enumValue(raw, BATTERY);
}

// SOP 5.2.2: |actual - expected| <= 2% of expected (inclusive).
function withinTolerance(actual, expected) {
  if (actual === null || expected === null) return false;
  if (expected === 0) return actual === 0;
  return Math.abs(actual - expected) <= WEIGHT_TOLERANCE * Math.abs(expected) + 1e-9;
}

// SOP 5.2.4: the installation may not predate the inspection by more than the 24-hour window.
function installWithinWindow(installed, inspected) {
  const tInstalled = Date.parse(installed), tInspected = Date.parse(inspected);
  if (!Number.isFinite(tInstalled) || !Number.isFinite(tInspected)) return false;
  return (tInspected - tInstalled) / 3600000 <= INSTALL_WINDOW_HOURS;
}

// SOP 5.2.3: standard terms are matched in code; free text is classified once by a narrow judge.
async function standardCondition(raw) {
  if (raw === null || raw === undefined || wordsOf(raw) === '') return null;
  const exact = CONDITIONS.find(c => c === wordsOf(raw));
  if (exact) return exact;
  const v = await flow.judge('physical-condition', {
    tiers: ['claude-haiku-5-5'],
    system: 'You standardize aircraft component condition notes into one fixed term.',
    prompt: `Inspection note: ${JSON.stringify(String(raw))}\nChoose the single closest term from: ${CONDITIONS.join(', ')}.`,
    schema: { type: 'object', required: ['condition'], additionalProperties: false, properties: { condition: { type: 'string', enum: CONDITIONS } } },
    check: v => (CONDITIONS.includes(v?.condition) ? null : 'not one of the standard terms'),
  });
  return v.condition;
}

// The API answers "no value" as a bare NaN, which is not JSON, so it arrives as text. Where the output may be null
// (an output the procedure only yields in some cases), that answer is null; otherwise it is an unusable answer.
const noValue = (r, key) => r.ok && typeof r.value === 'string' && new RegExp(`"${key}"\\s*:\\s*NaN\\b`).test(r.value);

// One tool call inside a section. A failed call, or an answer outside the expected values, returns the fallback
// so the step reads as not passed (and the run still answers).
async function verdict(port, tool, args, key, fallback, allowed = null, nullable = false) {
  const r = await port.tryCall(tool, args);
  if (nullable && noValue(r, key)) return null;
  const v = r.ok && r.value && typeof r.value === 'object' ? r.value[key] : undefined;
  if (v === undefined || v === null || (allowed && !allowed.includes(v))) {
    flow.flag('tool-unusable', { tool, error: r.ok ? r.value : r.error });
    return fallback;
  }
  return v;
}

// 5.1 Aircraft Identification Validation: AVM clearance, MRVS cross-reference and departure window.
const CLEARANCE_KEYS = ['aircraft_id', 'tail_number', 'maintenance_record_id', 'expected_departure_time'];
const { cleared } = await sop.section('5.1 Aircraft Identification Validation', {
  input: inputSchema(CLEARANCE_KEYS),
  output: outputSchema({ cleared: { type: 'boolean' } }),
  tools: ['VerifyAircraftClearance'],
}, pick(CLEARANCE_KEYS), async (input, port) => {
  if (!complete(input)) return { cleared: false };
  const v = await verdict(port, 'VerifyAircraftClearance', input, 'aircraft_ready', false);
  return { cleared: v === true };
});

// 5.2 Mechanical Components Inspection: serial, weight, condition and installation checks run by the mechanical tool.
const MECH_KEYS = ['aircraft_id', 'component_serial_number', 'inspection_location_id', 'component_weight', 'physical_condition_observation', 'installation_time'];
const { mechanical_inspection_result: mechanical } = await sop.section('5.2 Mechanical Components Inspection', {
  input: inputSchema(MECH_KEYS),
  output: outputSchema({ mechanical_inspection_result: { type: 'string' } }),
  tools: ['VerifyMechanicalComponents'],
}, pick(MECH_KEYS), async (input, port) => {
  const args = { ...input, physical_condition_observation: await standardCondition(input.physical_condition_observation) };
  if (!complete(args)) return { mechanical_inspection_result: 'retest' };
  const v = await verdict(port, 'VerifyMechanicalComponents', args, 'mechanical_inspection_result', 'retest', INSPECTION);
  return { mechanical_inspection_result: v };
});

// 5.2.2 + 5.2.4 Cross Check Specifications: weight tolerance and installation window are decided here; the
// specification tool's own verdict is also required (a failure from either side fails the check).
const CROSS_KEYS = ['aircraft_id', 'component_weight', 'expected_component_weight', 'installation_time', 'actual_inspection_time'];
const { cross_check_response: cross } = await sop.section('5.2.2-5.2.4 Cross Check Specifications', {
  input: inputSchema(CROSS_KEYS),
  output: outputSchema({ cross_check_response: { type: 'string' } }),
  tools: ['CrossCheckSpecifications'],
}, pick(CROSS_KEYS), async (input, port) => {
  const weightOk = withinTolerance(input.component_weight, input.expected_component_weight);
  const installOk = installWithinWindow(input.installation_time, input.actual_inspection_time);
  const ruleOk = weightOk && installOk;
  if (!complete(input)) return { cross_check_response: 'failed' };
  const toolOk = sameText(await verdict(port, 'CrossCheckSpecifications', input, 'cross_check_response', 'failed'), 'success');
  if (toolOk !== ruleOk) flow.flag('cross-check-disagree', { rule: ruleOk, tool: toolOk, weightOk, installOk });
  return { cross_check_response: ruleOk && toolOk ? 'success' : 'failed' };
});

// 5.3 Electrical Systems Authentication: battery, circuit continuity and avionics results go to the ESAP tool.
// The retest/retry statuses are reported as the check's result; the check itself is not re-run here.
const ELEC_KEYS = ['aircraft_id', 'battery_status', 'circuit_continuity_check', 'avionics_diagnostics_response'];
const { electrical_inspection_result: electrical } = await sop.section('5.3 Electrical Systems Authentication', {
  input: inputSchema(ELEC_KEYS),
  output: outputSchema({ electrical_inspection_result: { type: 'string' } }),
  tools: ['VerifyElectricalSystems'],
}, pick(ELEC_KEYS), async (input, port) => {
  const args = {
    aircraft_id: input.aircraft_id,
    battery_status: batteryValue(input.battery_status),
    circuit_continuity_check: enumValue(input.circuit_continuity_check, CIRCUIT),
    avionics_diagnostics_response: enumValue(input.avionics_diagnostics_response, AVIONICS),
  };
  if (!complete(args)) return { electrical_inspection_result: 'retest' };
  const v = await verdict(port, 'VerifyElectricalSystems', args, 'electrical_inspection_result', 'retest', INSPECTION);
  return { electrical_inspection_result: v };
});

// 5.4.1 Component Incident Response: reported only when the mechanical or electrical inspection did not pass.
const INCIDENT_KEYS = ['aircraft_id', 'mechanical_inspection_result', 'electrical_inspection_result'];
const { component_incident_response: incident } = await sop.section('5.4.1 Component Incident Response', {
  input: inputSchema(INCIDENT_KEYS),
  output: outputSchema({ component_incident_response: { type: ['string', 'null'] } }),
  tools: ['ReportComponentIncident'],
}, { aircraft_id: I.aircraft_id ?? null, mechanical_inspection_result: mechanical, electrical_inspection_result: electrical }, async (input, port) => {
  const failed = input.mechanical_inspection_result !== 'success' || input.electrical_inspection_result !== 'success';
  if (!failed) return { component_incident_response: 'success' };
  if (!complete(input)) return { component_incident_response: 'failed' };
  const v = await verdict(port, 'ReportComponentIncident', input, 'component_incident_response', 'failed', null, true);
  return { component_incident_response: v };
});

// 5.4.2 Component Mismatch Response: submitted only when the installed serial differs from the maintenance record.
const MISMATCH_KEYS = ['aircraft_id', 'component_serial_number', 'installed_component_serial_number', 'inspection_location_id'];
const { component_mismatch_response: mismatch } = await sop.section('5.4.2 Component Mismatch Response', {
  input: inputSchema(MISMATCH_KEYS),
  output: outputSchema({ component_mismatch_response: { type: 'string' } }),
  tools: ['ReportComponentMismatch'],
}, pick(MISMATCH_KEYS), async (input, port) => {
  const differs = complete([input.component_serial_number, input.installed_component_serial_number])
    && !sameText(input.component_serial_number, input.installed_component_serial_number);
  if (!differs) return { component_mismatch_response: 'success' };
  if (!complete(input)) return { component_mismatch_response: 'failed' };
  const v = await verdict(port, 'ReportComponentMismatch', input, 'component_mismatch_response', 'failed');
  return { component_mismatch_response: v };
});

// 5.5.1 Cross Check Reporting Response: filed only when any inspection, specification or serial check was not clean.
const REPORT_KEYS = ['maintenance_record_id', 'aircraft_id', 'component_incident_response', 'component_mismatch_response'];
const { cross_check_reporting_response: reporting } = await sop.section('5.5.1 Cross Check Reporting Response', {
  input: inputSchema(REPORT_KEYS),
  output: outputSchema({ cross_check_reporting_response: { type: 'string' } }),
  tools: ['ReportCrossCheck'],
}, { maintenance_record_id: I.maintenance_record_id ?? null, aircraft_id: I.aircraft_id ?? null, component_incident_response: incident, component_mismatch_response: mismatch }, async (input, port) => {
  const discrepancy = [mechanical, electrical, cross, mismatch].some(v => v !== 'success');
  if (!discrepancy) return { cross_check_reporting_response: 'success' };
  // A null incident answer (the API gave no value) is reported as the API's own text, NaN, since the report takes a string.
  const args = { ...input, component_incident_response: input.component_incident_response ?? 'NaN' };
  if (!complete(args)) return { cross_check_reporting_response: 'failed' };
  const v = await verdict(port, 'ReportCrossCheck', args, 'cross_check_reporting_response', 'failed');
  return { cross_check_reporting_response: v };
});

// 6.1 Airworthiness Verification Report: the aircraft is ready only when clearance and every inspection step passed.
const { aircraft_ready: ready } = await sop.section('6.1 Aircraft Ready Decision', {
  input: inputSchema(['cleared', 'mechanical', 'electrical', 'cross_check', 'mismatch']),
  output: outputSchema({ aircraft_ready: { type: 'boolean' } }),
  tools: [],
}, { cleared, mechanical, electrical, cross_check: cross, mismatch }, async input => ({
  aircraft_ready: input.cleared === true && [input.mechanical, input.electrical, input.cross_check, input.mismatch].every(v => v === 'success'),
}));

sop.done({
  aircraft_ready: ready ? 'True' : 'False',
  mechanical_inspection_result: mechanical,
  electrical_inspection_result: electrical,
  component_incident_response: incident,
  component_mismatch_response: mismatch,
  cross_check_response: cross,
  cross_check_reporting_response: reporting,
});
