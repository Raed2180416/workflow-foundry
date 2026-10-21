import { createFlow } from './tools/flow.mjs';
import { createSop } from './tools/sop.mjs';
const flow = createFlow({ budgetUsd: 0.05 });
const sop = createSop(flow);
const task = flow.input();
import {
  AS_OF, BANK_ACCOUNT_TYPES, LICENCE_GRACE_DAYS, MAX_OWNERSHIP_LAYERS, PROFILE_REQUIRED, UBO_THRESHOLD,
  addressComplete, daysExpiredAsOf, decide, namesMatch, norm, parseOwners, sameOwners, taxIdStatus, text,
} from './lib/rules.mjs';

// Schema helpers. A section's output lists its findings: gaps (missing or irregular information, which sets awaiting
// information), triggers (escalation triggers) and immediate (an escalate-at-once rule, 5.2.1).
const STR = { type: 'string' };
const NSTR = { type: ['string', 'null'] };
const NUM = { type: ['number', 'null'] };
const NBOOL = { type: ['boolean', 'null'] };
const LIST = { type: 'array', items: { type: 'string' } };
const OBJS = { type: 'array', items: { type: 'object' } };
const FINDINGS = { gaps: LIST, triggers: LIST, immediate: LIST };
const inp = props => ({ type: 'object', required: Object.keys(props), properties: props });
const out = props => ({ type: 'object', required: Object.keys(props), properties: props });
const empty = () => ({ gaps: [], triggers: [], immediate: [] });
const entryFor = (list, name) => (Array.isArray(list) ? list.find(e => e && norm(e.name) === norm(name)) : undefined);
const plain = v => v && typeof v === 'object' && !Array.isArray(v);

const i = task.inputs;
const businessId = text(i.business_id);
const gaps = [], triggers = [], immediate = [];
const absorb = found => { gaps.push(...found.gaps); triggers.push(...found.triggers); immediate.push(...found.immediate); };

// 5.1.1 Entity Information Retrieval: the business profile, and the website, e-mail and address checks against the name.
const profileStep = await sop.section('5.1.1 Entity Information Retrieval', {
  input: inp({ business_id: STR, submitted: { type: 'object' } }),
  output: out({ retrieved: { type: 'boolean' }, profile: { type: ['object', 'null'] }, ...FINDINGS }),
  tools: ['getBusinessProfile'],
}, {
  business_id: businessId,
  submitted: {
    registration_number: text(i.registration_number),
    license_number: text(i.license_number),
    business_registration_state: text(i.business_registration_state),
  },
}, async (input, port) => {
  const r = await port.tryCall('getBusinessProfile', { business_id: input.business_id });
  if (!r.ok || !plain(r.value)) {
    return { retrieved: false, profile: null, ...empty(), gaps: [`business profile not retrieved${r.ok ? '' : `: ${r.error}`}`] };
  }
  const p = Object.fromEntries(Object.entries(r.value).map(([k, v]) => [k, text(v)]));
  const f = empty();
  if (p.business_website && !namesMatch(p.business_name, p.business_website)) {
    f.gaps.push(`website ${p.business_website} does not match the business name ${p.business_name}`);
  }
  if (p.business_email) {
    const at = p.business_email.lastIndexOf('@');
    if (at < 0) f.gaps.push(`e-mail ${p.business_email} is not an e-mail address`);
    else if (!namesMatch(p.business_name, p.business_email.slice(at + 1))) {
      f.gaps.push(`e-mail ${p.business_email} does not match the business name ${p.business_name}`);
    }
  }
  if (p.business_address && !addressComplete(p.business_address)) {
    f.gaps.push(`address ${p.business_address} lacks a street number or named building, or a city`);
  }
  for (const [k, label] of [['registration_number', 'registration number'], ['license_number', 'license number'], ['business_registration_state', 'registration state']]) {
    const sub = input.submitted[k];
    if (sub && p[k] && norm(sub) !== norm(p[k])) f.gaps.push(`${label} on file ${p[k]} differs from the submitted ${sub}`);
  }
  return { retrieved: true, profile: p, ...f };
});
absorb(profileStep);

// 5.1.2 Documentation Completeness Assessment: every required field is populated.
const completeness = await sop.section('5.1.2 Documentation Completeness Assessment', {
  input: inp({ profile: { type: ['object', 'null'] } }),
  output: out({ documentation_completeness: STR, ...FINDINGS }),
  tools: [],
}, { profile: profileStep.profile }, async input => {
  const missing = PROFILE_REQUIRED.filter(k => !input.profile || !text(input.profile[k]));
  const gaps = missing.map(k => `missing ${k}`);
  return { documentation_completeness: gaps.length ? 'Incomplete' : 'Complete', gaps, triggers: [], immediate: [] };
});
absorb(completeness);

let riskScore = null;
if (profileStep.retrieved) {
  const profile = profileStep.profile;

  // 5.2.1 Government Registry Validation: Tax ID format, registration status, licence expiry.
  const registry = await sop.section('5.2.1 Government Registry Validation', {
    input: inp({ business_id: STR, registration_number: STR, business_registration_state: STR, license_number: STR, tax_id: STR }),
    output: out({ tax_id_status: STR, registration_status: NSTR, license_expiry_days_past: NUM, ...FINDINGS }),
    tools: ['verifyBusinessRegistration'],
  }, {
    business_id: businessId,
    registration_number: text(profile.registration_number),
    business_registration_state: text(profile.business_registration_state),
    license_number: text(profile.license_number),
    tax_id: text(profile.tax_id),
  }, async (input, port) => {
    const f = empty();
    const taxStatus = taxIdStatus(input.tax_id);
    if (taxStatus === 'missing') f.gaps.push('tax id missing');
    else if (taxStatus === 'malformed') f.immediate.push(`tax id ${input.tax_id} is not TIN followed by six digits that are not all the same`);
    const missing = ['registration_number', 'business_registration_state', 'license_number'].filter(k => !input[k]);
    if (missing.length) {
      f.gaps.push(`registry check skipped: ${missing.join(', ')} missing`);
      return { tax_id_status: taxStatus, registration_status: null, license_expiry_days_past: null, ...f };
    }
    const r = await port.tryCall('verifyBusinessRegistration', {
      business_id: input.business_id,
      registration_number: input.registration_number,
      business_registration_state: input.business_registration_state,
      license_number: input.license_number,
    });
    if (!r.ok || !plain(r.value)) {
      f.gaps.push(`government registry check failed${r.ok ? '' : `: ${r.error}`}`);
      return { tax_id_status: taxStatus, registration_status: null, license_expiry_days_past: null, ...f };
    }
    const status = text(r.value.registration_status);
    if (!status) f.gaps.push('registration status not returned');
    else if (status.toLowerCase() !== 'active') f.triggers.push(`registration status is ${status}`);
    const days = daysExpiredAsOf(r.value.license_expiry_date);
    if (days === null) f.gaps.push('license expiry date not returned');
    else if (days > LICENCE_GRACE_DAYS) f.triggers.push(`license expired ${days} days before ${AS_OF} (more than ${LICENCE_GRACE_DAYS})`);
    return { tax_id_status: taxStatus, registration_status: status || null, license_expiry_days_past: days, ...f };
  });
  absorb(registry);

  // 5.3.1 UBO Identification and Verification: the ownership record, checked against the submitted list; owners of 25% or more.
  const ubo = await sop.section('5.3.1 UBO Identification and Verification', {
    input: inp({ business_id: STR, submitted_ubo_list: STR }),
    output: out({ owners: OBJS, ubos: OBJS, ...FINDINGS }),
    tools: ['getOwnershipData'],
  }, { business_id: businessId, submitted_ubo_list: typeof i.ubo_list === 'string' ? i.ubo_list : JSON.stringify(i.ubo_list ?? null) }, async (input, port) => {
    const f = empty();
    const r = await port.tryCall('getOwnershipData', { business_id: input.business_id });
    if (!r.ok || !plain(r.value)) {
      f.gaps.push(`ownership record not retrieved${r.ok ? '' : `: ${r.error}`}`);
      return { owners: [], ubos: [], ...f };
    }
    const owners = parseOwners(r.value.ubo_list);
    if (!owners) {
      f.gaps.push('UBO list on file is unreadable');
      return { owners: [], ubos: [], ...f };
    }
    const submitted = parseOwners(input.submitted_ubo_list);
    if (!submitted) f.gaps.push('submitted UBO list is unreadable');
    else if (!sameOwners(owners, submitted)) f.gaps.push('UBO list on file differs from the submitted UBO list');
    if (!owners.length) f.gaps.push('no owners on file');
    const ubos = owners.filter(o => o.ownership >= UBO_THRESHOLD);
    if (owners.length && !ubos.length) f.gaps.push(`no individual owns ${UBO_THRESHOLD}% or more`);
    return { owners, ubos, ...f };
  });
  absorb(ubo);

  // 5.3.2 Ownership Structure Analysis: shell company indicators, offshore flag and layer count.
  if (ubo.owners.length) {
    const structure = await sop.section('5.3.2 Ownership Structure Analysis', {
      input: inp({ business_id: STR, owners: { type: 'array', minItems: 1, items: { type: 'object' } } }),
      output: out({ shell_company_suspected: NBOOL, ownership_layer_count: NUM, offshore_jurisdiction_flag: NBOOL, ...FINDINGS }),
      tools: ['verifyUBO'],
    }, { business_id: businessId, owners: ubo.owners }, async (input, port) => {
      const f = empty();
      const r = await port.tryCall('verifyUBO', { business_id: input.business_id, ubo_list: input.owners });
      if (!r.ok || !plain(r.value)) {
        f.gaps.push(`ownership verification failed${r.ok ? '' : `: ${r.error}`}`);
        return { shell_company_suspected: null, ownership_layer_count: null, offshore_jurisdiction_flag: null, ...f };
      }
      const { shell_company_suspected: shell, ownership_layer_count: layers, offshore_jurisdiction_flag: offshore } = r.value;
      if (typeof shell !== 'boolean') f.gaps.push('shell company status not returned');
      else if (shell) f.triggers.push('shell company suspected');
      if (typeof offshore !== 'boolean') f.gaps.push('offshore jurisdiction flag not returned');
      else if (offshore) f.triggers.push('offshore jurisdiction flag set');
      if (typeof layers !== 'number') f.gaps.push('ownership layer count not returned');
      else if (layers > MAX_OWNERSHIP_LAYERS) f.triggers.push(`ownership has ${layers} layers (more than ${MAX_OWNERSHIP_LAYERS})`);
      return {
        shell_company_suspected: typeof shell === 'boolean' ? shell : null,
        ownership_layer_count: typeof layers === 'number' ? layers : null,
        offshore_jurisdiction_flag: typeof offshore === 'boolean' ? offshore : null,
        ...f,
      };
    });
    absorb(structure);
  }

  // 5.4.1 Comprehensive Screening Protocol: sanctions and PEP status for each UBO, screened one at a time (the tool
  // answers for the first UBO in a list only).
  if (ubo.ubos.length) {
    const screen = await sop.section('5.4.1 Comprehensive Screening Protocol', {
      input: inp({ business_id: STR, ubos: OBJS }),
      output: out({ screened: OBJS, ...FINDINGS }),
      tools: ['performSanctionsCheck'],
    }, { business_id: businessId, ubos: ubo.ubos }, async (input, port) => {
      const f = empty();
      const screened = [];
      for (const u of input.ubos) {
        const r = await port.tryCall('performSanctionsCheck', { business_id: input.business_id, ubo_list: [u] });
        if (!r.ok || !plain(r.value)) {
          f.gaps.push(`sanctions screening failed for ${u.name}${r.ok ? '' : `: ${r.error}`}`);
          continue;
        }
        const s = entryFor(r.value.sanction_check_status, u.name);
        const p = entryFor(r.value.pep_status, u.name);
        const sStatus = s ? text(s.status) : '';
        const pStatus = p ? text(p.status) : '';
        if (!sStatus) f.gaps.push(`no sanctions result for ${u.name}`);
        else if (sStatus.toLowerCase() !== 'clear') f.triggers.push(`sanctions status for ${u.name} is ${sStatus}`);
        if (!pStatus) f.gaps.push(`no PEP result for ${u.name}`);
        else if (pStatus.toLowerCase() !== 'no') f.triggers.push(`PEP status for ${u.name} is ${pStatus}`);
        screened.push({ name: u.name, sanction_status: sStatus || null, pep_status: pStatus || null });
      }
      return { screened, ...f };
    });
    absorb(screen);
  }

  // 5.5.1 Banking Information Validation: the account as submitted must verify, with no flag.
  const bank = await sop.section('5.5.1 Banking Information Validation', {
    input: inp({ business_id: STR, bank_account_number: STR, banking_institution: STR, bank_account_type: STR }),
    output: out({ bank_verification_status: NSTR, ...FINDINGS }),
    tools: ['verifyBankAccount'],
  }, {
    business_id: businessId,
    bank_account_number: text(i.bank_account_number),
    banking_institution: text(i.banking_institution),
    bank_account_type: text(i.bank_account_type),
  }, async (input, port) => {
    const f = empty();
    const type = BANK_ACCOUNT_TYPES.find(t => t.toLowerCase() === input.bank_account_type.toLowerCase());
    if (!input.bank_account_number || !input.banking_institution) f.gaps.push('bank account number or banking institution missing');
    if (!type) f.gaps.push(`bank account type "${input.bank_account_type}" is not Business, Checking or Savings`);
    if (f.gaps.length) return { bank_verification_status: null, ...f };
    const r = await port.tryCall('verifyBankAccount', {
      business_id: input.business_id,
      bank_account_number: input.bank_account_number,
      banking_institution: input.banking_institution,
      bank_account_type: type,
    });
    if (!r.ok || !plain(r.value)) {
      f.gaps.push(`bank account verification failed${r.ok ? '' : `: ${r.error}`}`);
      return { bank_verification_status: null, ...f };
    }
    const status = text(r.value.bank_verification_status);
    if (!status) f.gaps.push('bank verification status not returned');
    else if (status.toLowerCase() !== 'verified') f.triggers.push(`bank verification status is ${status}`);
    return { bank_verification_status: status || null, ...f };
  });
  absorb(bank);

  // 5.6.1 Risk Score Calculation: recorded for the audit trail; the SOP says the score is unreliable, so it decides nothing.
  const risk = await sop.section('5.6.1 Risk Score Calculation', {
    input: inp({ business_id: STR }),
    output: out({ risk_score: NUM }),
    tools: ['calculateRiskScore'],
  }, { business_id: businessId }, async (input, port) => {
    const r = await port.tryCall('calculateRiskScore', { business_id: input.business_id });
    const score = r.ok && plain(r.value) && typeof r.value.risk_score === 'number' ? r.value.risk_score : null;
    return { risk_score: score };
  });
  riskScore = risk.risk_score;
}

// 5.6.2 Escalation Determination: plain code over the findings (see decide in lib/rules.mjs).
const verdict = await sop.section('5.6.2 Escalation Determination', {
  input: inp({ gaps: LIST, triggers: LIST, immediate: LIST, risk_score: NUM }),
  output: out({ escalation_status: STR, reasons: LIST }),
  tools: [],
}, { gaps, triggers, immediate, risk_score: riskScore }, async input => {
  const status = decide(input);
  const reasons = [
    ...input.immediate.map(x => `escalate immediately: ${x}`),
    ...input.gaps.map(x => `awaiting information: ${x}`),
    ...input.triggers.map(x => `escalate: ${x}`),
  ];
  if (input.risk_score !== null) {
    const high = input.risk_score >= 0.5;
    reasons.push(`system risk score ${input.risk_score} ${high === (status === 'escalate') ? 'agrees with' : 'does not agree with'} the decision (recorded only)`);
  }
  return { escalation_status: status, reasons };
});

sop.done({ escalation_status: verdict.escalation_status });
