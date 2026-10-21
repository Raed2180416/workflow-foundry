import { createFlow } from './tools/flow.mjs';
import { createSop } from './tools/sop.mjs';
const flow = createFlow({ budgetUsd: 0.05 });
const sop = createSop(flow);
const task = flow.input();
import { answerOf, listArg, lifestyleBand, lifestyleIndex, overallFallback, readIntake } from './lib/intake.mjs';

// Schema helpers (the portable subset the section contracts check).
const str = { type: ['string', 'null'] };
const strs = { type: 'array', items: { type: 'string' } };
const bool = { type: 'boolean' };
const schema = (properties, required = Object.keys(properties)) => ({ type: 'object', required, properties, additionalProperties: false });
const oneOf = values => ({ type: 'string', enum: values });
const VALIDITY = ['valid', 'invalid'], RISK = ['low', 'medium', 'high'], YESNO = ['yes', 'no'], OUTCOME = ['success', 'failure'];

// The tool's answer under its output column, or the fallback when the tool erred or answered something else (flagged).
const answerFrom = (r, column, allowed, fallback, name) => {
  const v = answerOf(r, column, allowed);
  if (v == null) flow.flag(name, { error: r.ok ? r.value : r.error, fallback });
  return v ?? fallback;
};
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k] ?? null]));

const intake = readIntake(task.inputs);

// 5.1 Insurance Validation Protocol
// 5.1.1 Primary Insurance Verification
const PRIMARY = ['patient_id', 'insurance_provider', 'policy_number', 'group_number', 'coverage_start_date', 'insurance_type'];
const primary = await sop.section('5.1.1 Primary Insurance Verification', {
  input: schema(Object.fromEntries(PRIMARY.map(k => [k, str]))),
  output: schema({ insurance_validation: oneOf(VALIDITY) }),
  tools: ['validateInsurance'],
}, pick(intake, PRIMARY), async (input, port) => {
  // No coverage can be confirmed without these fields (the tool requires them), so the answer is invalid without a call.
  const gaps = PRIMARY.filter(k => input[k] == null);
  if (gaps.length || input.insurance_type === 'None') {
    flow.flag('primary-insurance-unverifiable', { gaps, insurance_type: input.insurance_type });
    return { insurance_validation: 'invalid' };
  }
  const r = await port.tryCall('validateInsurance', input);
  return { insurance_validation: answerFrom(r, 'insurance_validation', VALIDITY, 'invalid', 'insurance-tool-no-answer') };
});

// 5.1.2 Prescription Benefit Validation
const RX = ['patient_id', 'insurance_provider', 'policy_number', 'insurance_type'];
const prescription = await sop.section('5.1.2 Prescription Benefit Validation', {
  input: schema(Object.fromEntries(RX.map(k => [k, str]))),
  output: schema({ prescription_insurance_validation: oneOf(VALIDITY) }),
  tools: ['validatePrescriptionBenefits'],
}, pick(intake, RX), async (input, port) => {
  const gaps = RX.filter(k => input[k] == null);
  if (gaps.length || input.insurance_type === 'None') {
    flow.flag('prescription-benefits-unverifiable', { gaps, insurance_type: input.insurance_type });
    return { prescription_insurance_validation: 'invalid' };
  }
  const r = await port.tryCall('validatePrescriptionBenefits', pick(input, ['patient_id', 'insurance_provider', 'policy_number']));
  return { prescription_insurance_validation: answerFrom(r, 'prescription_insurance_validation', VALIDITY, 'invalid', 'prescription-tool-no-answer') };
});

// 5.2 Risk Assessment Protocol
// 5.2.1 Lifestyle Risk Evaluation
const LIFESTYLE = ['patient_id', 'smoking_status', 'alcohol_consumption', 'exercise_frequency'];
const lifestyle = await sop.section('5.2.1 Lifestyle Risk Evaluation', {
  input: schema(Object.fromEntries(LIFESTYLE.map(k => [k, str]))),
  output: schema({ life_style_risk_level: oneOf(RISK) }),
  tools: ['calculateLifestyleRisk'],
}, pick(intake, LIFESTYLE), async (input, port) => {
  // A missing item adds nothing to the index: Never (0), exercise 3-4 (0). Alcohol not reported is None (0), as the example rows show.
  const used = {
    smoking_status: input.smoking_status ?? 'Never',
    alcohol_consumption: input.alcohol_consumption ?? 'None',
    exercise_frequency: input.exercise_frequency ?? '3-4 times',
  };
  const defaulted = Object.keys(used).filter(k => input[k] == null);
  if (defaulted.length) flow.flag('lifestyle-item-defaulted', { defaulted });
  const score = lifestyleIndex(used.smoking_status, used.alcohol_consumption, used.exercise_frequency);
  const band = lifestyleBand(score);
  if (input.patient_id == null) {
    flow.flag('lifestyle-no-patient-id', { band });
    return { life_style_risk_level: band };
  }
  const r = await port.tryCall('calculateLifestyleRisk', { patient_id: input.patient_id, ...used });
  const level = answerFrom(r, 'life_style_risk_level', RISK, band, 'lifestyle-tool-no-answer');
  // The tool's level is the answer; a disagreement with the index is kept in the trace only.
  if (level !== band) flow.flag('lifestyle-tool-vs-index', { tool: level, index: score, band });
  return { life_style_risk_level: level };
});

// 5.2.2 Clinical Risk Assessment
const clinical = await sop.section('5.2.2 Clinical Risk Assessment', {
  input: schema({ patient_id: str, previous_surgeries: strs, chronic_conditions: strs, life_style_risk_level: oneOf(RISK) }),
  output: schema({ overall_risk_level: oneOf(RISK) }),
  tools: ['calculateOverallRisk'],
}, {
  patient_id: intake.patient_id,
  previous_surgeries: intake.previous_surgeries,
  chronic_conditions: intake.chronic_conditions,
  life_style_risk_level: lifestyle.life_style_risk_level,
}, async (input, port) => {
  const fallback = overallFallback(intake.previous_surgeries, intake.chronic_conditions, input.life_style_risk_level);
  if (input.patient_id == null) {
    flow.flag('overall-no-patient-id', { fallback });
    return { overall_risk_level: fallback };
  }
  const r = await port.tryCall('calculateOverallRisk', {
    patient_id: input.patient_id,
    previous_surgeries: listArg(input.previous_surgeries),
    chronic_conditions: listArg(input.chronic_conditions),
    life_style_risk_level: input.life_style_risk_level,
  });
  return { overall_risk_level: answerFrom(r, 'overall_risk_level', RISK, fallback, 'overall-tool-no-answer') };
});

// 5.3 Patient Registration Protocol
// 5.3.1 Eligibility Confirmation (the procedure's own rules: insurance and prescription valid)
const eligibility = await sop.section('5.3.1 Eligibility Confirmation', {
  input: schema({ insurance_validation: oneOf(VALIDITY), prescription_insurance_validation: oneOf(VALIDITY), life_style_risk_level: oneOf(RISK), overall_risk_level: oneOf(RISK) }),
  output: schema({ eligible: bool, reasons: strs }),
  tools: [],
}, {
  insurance_validation: primary.insurance_validation,
  prescription_insurance_validation: prescription.prescription_insurance_validation,
  life_style_risk_level: lifestyle.life_style_risk_level,
  overall_risk_level: clinical.overall_risk_level,
}, async input => {
  // The procedure states no acceptable band for the two risk levels; registration applies its own rule to them.
  const reasons = [];
  if (input.insurance_validation !== 'valid') reasons.push(`insurance_validation is ${input.insurance_validation}`);
  if (input.prescription_insurance_validation !== 'valid') reasons.push(`prescription_insurance_validation is ${input.prescription_insurance_validation}`);
  return { eligible: reasons.length === 0, reasons };
});

// 5.3.2 Pharmacy Network Verification
const PHARMACY = ['patient_id', 'preferred_pharmacy_name', 'preferred_pharmacy_address', 'pharmacy_phone'];
const pharmacy = await sop.section('5.3.2 Pharmacy Network Verification', {
  input: schema(Object.fromEntries(PHARMACY.map(k => [k, str]))),
  output: schema({ pharmacy_check: oneOf(YESNO) }),
  tools: ['verifyPharmacy'],
}, pick(intake, PHARMACY), async (input, port) => {
  const gaps = PHARMACY.filter(k => input[k] == null);
  if (gaps.length) {
    flow.flag('pharmacy-unverifiable', { gaps });
    return { pharmacy_check: 'no' };
  }
  const r = await port.tryCall('verifyPharmacy', input);
  return { pharmacy_check: answerFrom(r, 'pharmacy_check', YESNO, 'no', 'pharmacy-tool-no-answer') };
});

// 5.3 registration: only an eligible patient with a verified pharmacy is registered; the tool then answers for the registration.
const registration = await sop.section('5.3 Patient Registration Protocol', {
  input: schema({
    patient_id: str, eligible: bool, pharmacy_check: oneOf(YESNO),
    insurance_validation: oneOf(VALIDITY), prescription_insurance_validation: oneOf(VALIDITY),
    life_style_risk_level: oneOf(RISK), overall_risk_level: oneOf(RISK),
  }),
  output: schema({ user_registration: oneOf(OUTCOME) }),
  tools: ['registerPatient'],
}, {
  patient_id: intake.patient_id,
  eligible: eligibility.eligible,
  pharmacy_check: pharmacy.pharmacy_check,
  insurance_validation: primary.insurance_validation,
  prescription_insurance_validation: prescription.prescription_insurance_validation,
  life_style_risk_level: lifestyle.life_style_risk_level,
  overall_risk_level: clinical.overall_risk_level,
}, async (input, port) => {
  if (input.patient_id == null || !input.eligible || input.pharmacy_check !== 'yes') {
    flow.flag('registration-not-eligible', { reasons: eligibility.reasons, pharmacy_check: input.pharmacy_check });
    return { user_registration: 'failure' };
  }
  const r = await port.tryCall('registerPatient', {
    patient_id: input.patient_id,
    insurance_validation: input.insurance_validation,
    prescription_insurance_validation: input.prescription_insurance_validation,
    life_style_risk_level: input.life_style_risk_level,
    overall_risk_level: input.overall_risk_level,
    pharmacy_check: input.pharmacy_check,
  });
  return { user_registration: answerFrom(r, 'user_registration', OUTCOME, 'failure', 'registration-tool-no-answer') };
});

sop.done({
  prescription_insurance_validation: prescription.prescription_insurance_validation,
  insurance_validation: primary.insurance_validation,
  life_style_risk_level: lifestyle.life_style_risk_level,
  overall_risk_level: clinical.overall_risk_level,
  user_registration: registration.user_registration,
  pharmacy_check: pharmacy.pharmacy_check,
});
