import { createFlow } from './tools/flow.mjs';
import { createSop } from './tools/sop.mjs';
const flow = createFlow({ budgetUsd: 0.05 });
const sop = createSop(flow);
const task = flow.input();
import { parseLiteral } from './lib/literal.mjs';
import * as rules from './lib/rules.mjs';

// Section contracts: each section's input and output schema (checked on every call by tools/sop.mjs).
const str = { type: 'string' };
const strOrNull = { type: ['string', 'null'] };
const strList = { type: 'array', items: str };
const inputOf = (properties, required) => ({ type: 'object', required, properties });
const outputOf = (properties = {}, required = []) => ({
  type: 'object',
  required: [...required, 'awaiting', 'escalate', 'immediate'],
  properties: { ...properties, awaiting: strList, escalate: strList, immediate: strList },
});
const UBO = { type: 'object', required: ['name', 'id', 'ownership'], properties: { name: str, id: str, ownership: { type: 'number' } } };
const REGISTRY = { type: 'object', required: ['jurisdiction'], properties: { jurisdiction: str, registration_status: strOrNull, date_of_entry: strOrNull, license_expiry_date: strOrNull } };
const SCREENING = { type: 'object', required: ['name', 'id'], properties: { name: str, id: str, sanctions: strOrNull, pep: strOrNull } };
const RISK_HIGH = 0.5;   // 5.6.1: only used to document whether the judgement agrees with the score

// The reasons a section adds: awaiting (missing or irregular information), escalate (a risk trigger), immediate (escalate at once).
const reasons = (f = {}) => ({ awaiting: f.awaiting ?? [], escalate: f.escalate ?? [], immediate: f.immediate ?? [] });
const objectOf = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const entriesOf = x => (Array.isArray(x) ? x : x && typeof x === 'object' ? [x] : []);
const orNull = v => (rules.isBlank(v) ? null : rules.text(v));
// The status a screening result gives for one owner: by name, or the only entry when the tool returned just one.
const statusFor = (list, name) => {
  const rows = entriesOf(list);
  const hit = rows.find(e => rules.sameName(e?.name, name)) ?? (rows.length === 1 ? rows[0] : null);
  return hit && !rules.isBlank(hit.status) ? rules.text(hit.status) : null;
};
// A yes/no field the verifyBankAccount result may carry about the account's ownership (its key names the owner or the alignment).
const ownershipAlignedOf = v => {
  const key = Object.keys(v).find(k => /owner|align/i.test(k));
  return key ? rules.flagValue(v[key]) : null;
};

const s = task.inputs ?? {};
const bid = rules.text(s.business_id);
const state = reasons();
// Adds a section's reasons to the run's, then hands the section's output back for the next section's input.
const take = r => {
  for (const k of ['awaiting', 'escalate', 'immediate']) state[k].push(...r[k]);
  return r;
};

// 5.1.1 Entity Information Retrieval
const profileInfo = take(await sop.section('5.1.1 Entity Information Retrieval',
  { input: inputOf({ business_id: str }, ['business_id']), output: outputOf({ profile: { type: ['object', 'null'] } }, ['profile']), tools: ['getBusinessProfile'] },
  { business_id: bid },
  async (input, port) => {
    const r = await port.tryCall('getBusinessProfile', { business_id: input.business_id });
    if (!r.ok) return { profile: null, ...reasons({ awaiting: [`business profile could not be retrieved (${r.error})`] }) };
    const p = objectOf(r.value);
    const name = rules.text(p.business_name);
    const f = [];
    // The website and e-mail must carry the pre-validated name: a made-up name is an irregularity, a typo is not. So the
    // e-mail's format is not an irregularity of its own: a missing dot ('contact@caymanstratcom') is a typo, and the name decides.
    if (name && !rules.isBlank(p.business_website) && !rules.domainCarriesName(name, p.business_website)) f.push(`website ${rules.text(p.business_website)} does not carry the business name ${name}`);
    if (name && !rules.isBlank(p.business_email) && !rules.domainCarriesName(name, p.business_email)) f.push(`e-mail ${rules.text(p.business_email)} does not carry the business name ${name}`);
    if (!rules.isBlank(p.business_address) && !rules.addressIsComplete(p.business_address)) f.push(`address ${rules.text(p.business_address)} lacks a street number, road or city`);
    return { profile: p, ...reasons({ awaiting: f }) };
  }));

// 5.1.2 Documentation Completeness Assessment (presence and format of the required fields)
const PROFILE_FIELDS = ['business_name', 'business_website', 'business_email', 'business_address', 'registration_number', 'license_number', 'tax_id', 'business_registration_state'];
const SUBMITTED_FIELDS = ['business_id', 'registration_number', 'license_number', 'business_registration_state', 'ubo_list', 'bank_account_number', 'banking_institution', 'bank_account_type'];
const docs = take(await sop.section('5.1.2 Documentation Completeness Assessment',
  { input: inputOf({ profile: { type: ['object', 'null'] }, submitted: { type: 'object' } }, ['profile', 'submitted']), output: outputOf({ documentation_completeness: str }, ['documentation_completeness']), tools: [] },
  { profile: profileInfo.profile, submitted: s },
  async input => {
    const { profile, submitted } = input;
    // Without a profile, 5.1.1 has already reported the missing information.
    if (!profile) return { documentation_completeness: 'Incomplete', ...reasons() };
    const f = [];
    for (const k of PROFILE_FIELDS) if (rules.isBlank(profile[k])) f.push(`profile field ${k} is missing`);
    for (const k of SUBMITTED_FIELDS) if (rules.isBlank(submitted[k])) f.push(`submitted field ${k} is missing`);
    if (!rules.isBlank(submitted.registration_number) && !rules.isRegistrationNumber(submitted.registration_number)) f.push(`registration number ${rules.text(submitted.registration_number)} is not REG followed by six digits`);
    if (!rules.isBlank(submitted.license_number) && !rules.isLicenceNumber(submitted.license_number)) f.push(`licence number ${rules.text(submitted.license_number)} is not LIC followed by six digits`);
    if (!rules.isBlank(profile.registration_number) && !rules.isBlank(submitted.registration_number) && rules.upperCode(profile.registration_number) !== rules.upperCode(submitted.registration_number)) f.push('registration number in the profile differs from the submitted one');
    if (!rules.isBlank(profile.license_number) && !rules.isBlank(submitted.license_number) && rules.upperCode(profile.license_number) !== rules.upperCode(submitted.license_number)) f.push('licence number in the profile differs from the submitted one');
    if (!rules.isBlank(submitted.bank_account_type) && !rules.accountTypeOf(submitted.bank_account_type)) f.push(`bank account type ${rules.text(submitted.bank_account_type)} is not Business, Checking or Savings`);
    return { documentation_completeness: f.length ? 'Incomplete' : 'Complete', ...reasons({ awaiting: f }) };
  }));

// 5.2.1 Government Registry Validation: the tax ID, then the registry for every jurisdiction named
const registryInfo = take(await sop.section('5.2.1 Government Registry Validation',
  {
    input: inputOf({ business_id: str, tax_id: strOrNull, registration_number: str, license_number: str, jurisdiction: str }, ['business_id', 'tax_id', 'registration_number', 'license_number', 'jurisdiction']),
    output: outputOf({ registry: { type: 'array', items: REGISTRY } }, ['registry']),
    tools: ['verifyBusinessRegistration'],
  },
  { business_id: bid, tax_id: profileInfo.profile ? orNull(profileInfo.profile.tax_id) : null, registration_number: rules.text(s.registration_number), license_number: rules.text(s.license_number), jurisdiction: rules.text(s.business_registration_state) },
  async (input, port) => {
    const f = reasons();
    const tax = rules.taxIdVerdict(input.tax_id);
    // 5.2.1: a tax ID that is not TIN plus six digits, or repeats one digit, escalates at once.
    if (tax === 'missing') f.awaiting.push('tax ID missing');
    if (tax === 'malformed') f.immediate.push(`tax ID ${input.tax_id} is not TIN followed by six digits`);
    if (tax === 'repeated-digit') f.immediate.push(`tax ID ${input.tax_id} repeats one digit`);
    const jurisdictions = rules.jurisdictionsOf(input.jurisdiction);
    if (!jurisdictions.length) f.awaiting.push('registration jurisdiction missing');
    if (!rules.isBlank(input.registration_number) && !rules.isRegistrationNumber(input.registration_number)) f.awaiting.push(`registration number ${input.registration_number} is not REG followed by six digits`);
    if (!rules.isBlank(input.license_number) && !rules.isLicenceNumber(input.license_number)) f.awaiting.push(`licence number ${input.license_number} is not LIC followed by six digits`);
    const ready = jurisdictions.length > 0 && rules.isRegistrationNumber(input.registration_number) && rules.isLicenceNumber(input.license_number);
    // Cross-jurisdiction (5.2.2): one registry check per jurisdiction, in one request.
    const results = ready ? await port.batch(jurisdictions.map(j => ({
      name: 'verifyBusinessRegistration',
      arguments: { business_id: input.business_id, registration_number: rules.upperCode(input.registration_number), business_registration_state: j, license_number: rules.upperCode(input.license_number) },
    }))) : [];
    const registry = [];
    results.forEach((r, k) => {
      const j = jurisdictions[k];
      if (!r.ok) return f.awaiting.push(`registry check for ${j} failed (${r.error})`);
      const v = objectOf(r.value);
      registry.push({ jurisdiction: j, registration_status: orNull(v.registration_status), date_of_entry: orNull(v.date_of_entry), license_expiry_date: orNull(v.license_expiry_date) });
    });
    return { registry, ...reasons(f) };
  }));

// A tax ID that must escalate at once ends the run's checks; the decision below still runs on what was found.
const proceed = state.immediate.length === 0;
let risk = { risk_score: null };
let ubo = { ubos: [] };
let structure = { shell_company_suspected: null, ownership_layer_count: null, offshore_jurisdiction_flag: null };
let bank = { bank_record: null, ownership_aligned: null };

if (proceed) {
  // 5.2.2 Cross-Jurisdictional Verification: every registry is active and its licence is within the expiry limit
  take(await sop.section('5.2.2 Cross-Jurisdictional Verification',
    { input: inputOf({ registry: { type: 'array', items: REGISTRY } }, ['registry']), output: outputOf(), tools: [] },
    { registry: registryInfo.registry },
    async input => {
      const f = reasons();
      if (!input.registry.length) f.awaiting.push('no government registry could be checked');
      for (const e of input.registry) {
        const status = rules.registrationVerdict(e.registration_status);
        if (status === 'unknown') f.awaiting.push(`registration status missing in ${e.jurisdiction}`);
        if (status === 'escalate') f.escalate.push(`registration in ${e.jurisdiction} is ${e.registration_status}`);
        // The licence's expiry and its date of entry must agree within the 42-day limit: a licence that had expired more than 42 days
        // before its entry, or whose expiry is more than 42 days after it, escalates.
        const span = rules.licenceSpanDays(e.date_of_entry, e.license_expiry_date);
        if (span === null) f.awaiting.push(`licence expiry or date of entry missing in ${e.jurisdiction}`);
        else if (span < -rules.MAX_EXPIRED_DAYS) f.escalate.push(`licence in ${e.jurisdiction} expired ${-span} days before the date of entry (limit ${rules.MAX_EXPIRED_DAYS})`);
        else if (span > rules.MAX_EXPIRED_DAYS) f.escalate.push(`licence in ${e.jurisdiction} expires ${span} days after the date of entry (limit ${rules.MAX_EXPIRED_DAYS})`);
      }
      return reasons(f);
    }));

  // 5.3.1 UBO Identification and Verification: owners at 25% or more, checked against the ownership records
  ubo = take(await sop.section('5.3.1 UBO Identification and Verification',
    { input: inputOf({ business_id: str, ubo_list: {} }, ['business_id', 'ubo_list']), output: outputOf({ ubos: { type: 'array', items: UBO } }, ['ubos']), tools: ['getOwnershipData'] },
    { business_id: bid, ubo_list: s.ubo_list },
    async (input, port) => {
      const f = reasons();
      const parsed = parseLiteral(input.ubo_list);
      const list = rules.owners(parsed);
      const readable = Array.isArray(parsed) && list.length > 0;
      if (!readable) f.awaiting.push('ubo list missing or unreadable');
      if (readable && list.some(o => o.name === '' || o.id === '' || o.ownership === null)) f.awaiting.push('ubo list has an entry without a name, ID or percentage');
      const total = list.reduce((a, o) => a + (o.ownership ?? 0), 0);
      if (readable && total > 100.5) f.awaiting.push(`owners add up to ${total}%`);
      const ubos = list.filter(rules.isUbo);
      if (readable && !ubos.length) f.awaiting.push('no individual holds 25% or more; control has to be established');
      const sys = await port.tryCall('getOwnershipData', { business_id: input.business_id });
      if (!sys.ok) f.awaiting.push(`ownership records not retrieved (${sys.error})`);
      else if (ubos.length && !rules.sameUbos(ubos, rules.owners(parseLiteral(objectOf(sys.value).ubo_list)).filter(rules.isUbo))) f.awaiting.push('submitted ubo list differs from the ownership records');
      return { ubos, ...reasons(f) };
    }));

  // 5.3.2 Ownership Structure Analysis: shell-company suspicion, ownership layers and the offshore flag
  structure = take(await sop.section('5.3.2 Ownership Structure Analysis',
    {
      input: inputOf({ business_id: str, ubos: { type: 'array', items: UBO } }, ['business_id', 'ubos']),
      output: outputOf({ shell_company_suspected: { type: ['boolean', 'null'] }, ownership_layer_count: { type: ['number', 'null'] }, offshore_jurisdiction_flag: { type: ['boolean', 'null'] } },
        ['shell_company_suspected', 'ownership_layer_count', 'offshore_jurisdiction_flag']),
      tools: ['verifyUBO'],
    },
    { business_id: bid, ubos: ubo.ubos },
    async (input, port) => {
      const none = { shell_company_suspected: null, ownership_layer_count: null, offshore_jurisdiction_flag: null };
      if (!input.ubos.length) return { ...none, ...reasons() };
      const r = await port.tryCall('verifyUBO', { business_id: input.business_id, ubo_list: input.ubos });
      if (!r.ok) return { ...none, ...reasons({ awaiting: [`ownership structure not verified (${r.error})`] }) };
      const v = objectOf(r.value);
      const f = reasons();
      const shell = rules.flagValue(v.shell_company_suspected);
      const offshore = rules.flagValue(v.offshore_jurisdiction_flag);
      const layers = rules.isBlank(v.ownership_layer_count) || !Number.isFinite(Number(v.ownership_layer_count)) ? null : Number(v.ownership_layer_count);
      if (shell === null) f.awaiting.push('shell company indicator missing');
      else if (shell) f.escalate.push('shell company suspected');
      if (offshore === null) f.awaiting.push('offshore jurisdiction flag missing');
      else if (offshore) f.escalate.push('offshore jurisdiction flag is set');
      if (layers === null) f.awaiting.push('ownership layer count missing');
      return { shell_company_suspected: shell, ownership_layer_count: layers, offshore_jurisdiction_flag: offshore, ...reasons(f) };
    }));

  // 5.4.1 Comprehensive Screening Protocol: one screening call per UBO (the tool screens only the first owner it is given)
  const screen = take(await sop.section('5.4.1 Comprehensive Screening Protocol',
    { input: inputOf({ business_id: str, ubos: { type: 'array', items: UBO } }, ['business_id', 'ubos']), output: outputOf({ screening: { type: 'array', items: SCREENING } }, ['screening']), tools: ['performSanctionsCheck'] },
    { business_id: bid, ubos: ubo.ubos },
    async (input, port) => {
      if (!input.ubos.length) return { screening: [], ...reasons() };
      const results = await port.batch(input.ubos.map(u => ({ name: 'performSanctionsCheck', arguments: { business_id: input.business_id, ubo_list: [u] } })));
      const screening = input.ubos.map((u, k) => {
        const v = results[k]?.ok ? objectOf(results[k].value) : {};
        return { name: u.name, id: u.id, sanctions: statusFor(v.sanction_check_status, u.name), pep: statusFor(v.pep_status, u.name) };
      });
      return { screening, ...reasons() };
    }));

  // 5.4.2 False Positive Resolution: a match, a pending screen or a PEP hit cannot be cleared here and escalates; a missing result is awaited
  take(await sop.section('5.4.2 False Positive Resolution',
    { input: inputOf({ screening: { type: 'array', items: SCREENING } }, ['screening']), output: outputOf(), tools: [] },
    { screening: screen.screening },
    async input => {
      const f = reasons();
      for (const x of input.screening) {
        const sanctions = rules.screeningVerdict(x.sanctions);
        if (sanctions === 'escalate') f.escalate.push(`sanctions screening of ${x.name} is ${x.sanctions}`);
        if (sanctions === 'unknown') f.awaiting.push(`no sanctions screening result for ${x.name}`);
        const pep = rules.screeningVerdict(x.pep);
        if (pep === 'escalate') f.escalate.push(`PEP screening of ${x.name} is ${x.pep}`);
        if (pep === 'unknown') f.awaiting.push(`no PEP screening result for ${x.name}`);
      }
      return reasons(f);
    }));

  // 5.5.1 Banking Information Validation: the account is verified and the bank's record is read
  const bankInputs = { account_number: rules.text(s.bank_account_number), institution: rules.text(s.banking_institution), account_type: rules.accountTypeOf(s.bank_account_type) ?? rules.text(s.bank_account_type) };
  bank = take(await sop.section('5.5.1 Banking Information Validation',
    {
      input: inputOf({ business_id: str, account_number: str, institution: str, account_type: str }, ['business_id', 'account_number', 'institution', 'account_type']),
      output: outputOf({ bank_record: { type: ['object', 'null'] }, ownership_aligned: { type: ['boolean', 'null'] } }, ['bank_record', 'ownership_aligned']),
      tools: ['verifyBankAccount', 'getBankData'],
    },
    { business_id: bid, ...bankInputs },
    async (input, port) => {
      const none = { bank_record: null, ownership_aligned: null };
      if (!input.account_number || !input.institution || !rules.accountTypeOf(input.account_type)) return { ...none, ...reasons({ awaiting: ['bank account details are incomplete or not valid'] }) };
      const [v, g] = await port.batch([
        { name: 'verifyBankAccount', arguments: { business_id: input.business_id, bank_account_number: input.account_number, banking_institution: input.institution, bank_account_type: input.account_type } },
        { name: 'getBankData', arguments: { business_id: input.business_id } },
      ]);
      const f = reasons();
      const statuses = [];
      if (v.ok) statuses.push(rules.bankStatusVerdict(objectOf(v.value).bank_verification_status));
      else f.awaiting.push(`bank account not verified (${v.error})`);
      if (g.ok) statuses.push(rules.bankStatusVerdict(objectOf(g.value).bank_verification_status));
      else f.awaiting.push(`bank data not retrieved (${g.error})`);
      if (statuses.includes('escalate')) f.escalate.push('bank account verification is flagged');
      if (statuses.includes('unknown')) f.awaiting.push('bank verification status missing or unclear');
      const gv = objectOf(g.value);
      const record = g.ok ? { account_number: rules.text(gv.bank_account_number), institution: rules.text(gv.banking_institution), account_type: rules.text(gv.bank_account_type) } : null;
      return { bank_record: record, ownership_aligned: v.ok ? ownershipAlignedOf(objectOf(v.value)) : null, ...reasons(f) };
    }));

  // 5.5.2 Ownership Alignment: the bank's record matches the submitted account, and the account belongs to the verified UBOs
  take(await sop.section('5.5.2 Ownership Alignment',
    { input: inputOf({ submitted: { type: 'object' }, bank_record: { type: ['object', 'null'] }, ownership_aligned: { type: ['boolean', 'null'] } }, ['submitted', 'bank_record', 'ownership_aligned']), output: outputOf(), tools: [] },
    { submitted: bankInputs, bank_record: bank.bank_record, ownership_aligned: bank.ownership_aligned },
    async input => {
      const f = reasons();
      const rec = input.bank_record;
      if (rec) {
        if (rules.digitsOf(rec.account_number) !== rules.digitsOf(input.submitted.account_number)) f.awaiting.push('bank account number on the record differs from the submitted one');
        if (rules.lettersOf(rec.institution) !== rules.lettersOf(input.submitted.institution)) f.awaiting.push('banking institution on the record differs from the submitted one');
        if (rules.accountTypeOf(rec.account_type) !== rules.accountTypeOf(input.submitted.account_type)) f.awaiting.push('bank account type on the record differs from the submitted one');
      }
      if (input.ownership_aligned === false) f.escalate.push('bank account ownership is not aligned with the verified UBOs');
      return reasons(f);
    }));
}

if (proceed) {
  // 5.6.1 Risk Score Calculation: fetched and documented; the SOP says the score is noisy, so it never decides
  risk = await sop.section('5.6.1 Risk Score Calculation',
    { input: inputOf({ business_id: str }, ['business_id']), output: outputOf({ risk_score: { type: ['number', 'null'] } }, ['risk_score']), tools: ['calculateRiskScore'] },
    { business_id: bid },
    async (input, port) => {
      const r = await port.tryCall('calculateRiskScore', { business_id: input.business_id });
      const score = r.ok ? objectOf(r.value).risk_score : undefined;
      const n = rules.isBlank(score) ? NaN : Number(score);
      return { risk_score: Number.isFinite(n) ? n : null, ...reasons() };
    });
}

// 5.6.2 Escalation Determination: a tax ID escalates at once; otherwise missing or irregular information awaits; otherwise any trigger escalates
const verdict = await sop.section('5.6.2 Escalation Determination',
  {
    input: inputOf({ immediate: strList, awaiting: strList, escalate: strList, risk_score: { type: ['number', 'null'] } }, ['immediate', 'awaiting', 'escalate', 'risk_score']),
    output: outputOf({ escalation_status: str, reasons: strList }, ['escalation_status', 'reasons']),
    tools: [],
  },
  { immediate: state.immediate, awaiting: state.awaiting, escalate: state.escalate, risk_score: risk.risk_score },
  async input => {
    const status = input.immediate.length ? 'escalate'
      : input.awaiting.length ? 'awaiting information'
        : input.escalate.length ? 'escalate'
          : 'approve';
    if (input.risk_score !== null && (input.risk_score >= RISK_HIGH) !== (status !== 'approve')) flow.flag('risk-score-disagrees', { risk_score: input.risk_score, escalation_status: status });
    return { escalation_status: status, reasons: [...input.immediate, ...input.awaiting, ...input.escalate], ...reasons() };
  });

sop.done({ escalation_status: verdict.escalation_status });
