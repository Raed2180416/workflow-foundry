// The free-form front door's checks (app/FRONT-DOOR.md): a typed workflow built by the calling agent (or by the free-form builder from
// the person's words) is checked here, by code, before it can become a proposal. Nothing here changes the workflow: every problem is a
// named blocker the agent can act on, never a silent fix or a substitute.
//
//   checkFreeform(workflow, { registry, words, validate })   -> { ok, blockers[], validation, effects[], notes[] }
//     1. shape: an object with nodes; no reserved metadata tags (template:/slots: mark a flow made from an example's form, which has
//        its own checks and practice data)
//     2. semantics this app can run: no model steps (the app wires no model into a person's runs), no waits on an outside signal (the
//        app has no way to deliver one); refused by name, never flattened
//     3. capabilities: every tool a step or check names is in the app's registry and offered to automations (the diagnostic fixtures
//        are not); a missing one is a named blocker that says which step needs it
//     4. outside effects (send, post, append): every target is grounded in the person's own words, or comes from the person's data;
//        a target taken from the run input is refused (whoever starts a run would choose where things go); every e-mail address
//        anywhere in the workflow, code included, must be one the person wrote; each kind of outside effect has an independent check
//        that re-reads what the run left (outbox / chat / sheet audit)
//     5. strict validation and the construction lint (src/lint.mjs): valid, lint clean, acceptance grade "gating"
//   practiceCases(practiceInput, inputSchema)  -> the agent's practice cases, checked against the input schema
//   generatePractice(schema)                   -> a schema-valid value made deterministically ($0), for a practice input or a stand-in answer
//   capabilityCatalog(registry)                -> what an agent may build with: name, effect, whether it asks the person, schemas
import { FoundryError, references } from '../../src/data.mjs';
import { validateData } from '../../src/validate.mjs';

// The outside effects the app's capabilities can have, the argument that names where each goes, and the independent checks that
// re-read what a run left. core.artifact writes only inside the run's own artifact directory, so it is not an outside effect.
export const OUTSIDE_EFFECTS = Object.freeze({
  'outbox.send': { target: 'to', kind: 'e-mail', verb: 'send an e-mail', audits: ['outbox.audit', 'outbox.check'] },
  'chat.post': { target: 'channel', kind: 'chat channel', verb: 'post to a chat channel', audits: ['chat.audit'] },
  'sheet.append': { target: 'sheet', kind: 'sheet', verb: 'add rows to a sheet', audits: ['sheet.audit'] }
});
const INTERNAL_WRITES = new Set(['core.artifact']);
// Diagnostic capabilities of the default registry: present for the engine's own tests, never offered to a person's automations.
const NOT_OFFERED = /^(fixture\.|core\.(fail|sleep)$)/;
export const offered = name => !NOT_OFFERED.test(name);
const RESERVED_TAG = /^(template|slots):/;
const EMAIL_IN_TEXT = /[^@\s<>()"',;:{}[\]`|\\]+@[^@\s<>()"',;:{}[\]`|\\]+\.[A-Za-z]{2,}/g;
// A run-input field whose name or format says it holds an address: who starts each run would choose where things go.
const ADDRESS_FIELD = /(^|[^a-z])(e-?mail|emails|recipients?|to|cc|bcc|channels?|addresse?s?|send-?to|notify)([^a-z]|$)/i;

const text = v => String(v ?? '');
const lower = v => text(v).toLowerCase();
const short = (v, n = 80) => { const t = text(v).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** Everything the person wrote (the request and their answers), lower-cased: what grounding checks against. */
export function wordsOf(request, answers = {}) {
  const parts = [typeof request === 'string' ? request : '', ...Object.values(answers ?? {}).filter(v => typeof v === 'string')];
  return parts.join('\n').toLowerCase();
}
const escape = s => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
/** Did the person write this target? An address verbatim; a channel as #name, "name channel" or "channel name"; a sheet by its name. */
export function groundedIn(words, kind, value) {
  const v = lower(value).trim();
  if (!v) return false;
  if (kind === 'chat channel') {
    const bare = escape(v.replace(/^#/, ''));
    return words.includes(v.startsWith('#') ? v : `#${v}`) || new RegExp(`(^|[^a-z0-9_#-])${bare}\\s+channel\\b|\\bchannel\\s+(called\\s+|named\\s+)?#?${bare}([^a-z0-9_-]|$)`).test(words);
  }
  if (kind === 'sheet') {
    const spaced = v.replace(/[-_]+/g, ' ');
    return new RegExp(`(^|[^a-z0-9])(${escape(v)}|${escape(spaced)})([^a-z0-9]|$)`).test(words);
  }
  return words.includes(v);
}

/** Every node, depth first, with the flow path it sits in (map and loop bodies included). */
export function allNodes(flow, trail = []) {
  const out = [];
  for (const node of flow?.nodes ?? []) {
    out.push({ node, path: [...trail, node.id] });
    if (node.body) out.push(...allNodes(node.body, [...trail, node.id]));
  }
  return out;
}
/** Every string in a value (keys excluded), for the address scan. */
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}
/** Run-input fields (at any depth) whose name or format says they hold an address. */
function addressFields(schema, trail = [], out = [], depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 8) return out;
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    const at = [...trail, name];
    if (ADDRESS_FIELD.test(name) || child?.format === 'email') out.push(at.join('.'));
    addressFields(child, at, out, depth + 1);
  }
  if (schema.items) addressFields(schema.items, [...trail, '[]'], out, depth + 1);
  return out;
}
const blocker = (code, what, next, extra = {}) => ({ code, what, next, ...extra });

/**
 * The free-form checks. registry: the app's LIVE registry; words: wordsOf(request, answers); validate: workflow => strict validation
 * (FoundryApp passes foundry.validate(workflow, { strict: true })). Returns { ok, blockers, validation, effects, notes }.
 * effects: [{ step, tool, kind, verb, target, source: 'your words' | 'your data' }] (target null when it comes from the data).
 */
export function checkFreeform(workflow, { registry, words = '', validate }) {
  const blockers = [], notes = [], effects = [];
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow) || !Array.isArray(workflow.nodes))
    return { ok: false, blockers: [blocker('NOT_A_WORKFLOW', 'What was passed is not a workflow (an object with nodes).', 'Build a typed workflow as construction_guide describes and pass it as workflow.')], validation: null, effects, notes };
  const nodes = allNodes(workflow);
  const reserved = (workflow.metadata?.tags ?? []).filter(t => typeof t === 'string' && RESERVED_TAG.test(t));
  if (reserved.length) blockers.push(blocker('RESERVED_TAGS', `The workflow carries tags Foundry keeps for flows made from an example's form (${reserved.map(t => t.split(':')[0]).join(', ')}).`,
    'Remove the template:/slots: tags from metadata.tags; a free-form workflow is checked and practised on its own terms.'));

  // 2. semantics the app can run
  const modelSteps = nodes.filter(({ node }) => node.kind === 'agent' || (node.kind === 'verify' && node.method === 'agent'));
  if (modelSteps.length) blockers.push(blocker('MODEL_STEP_UNAVAILABLE', `Foundry's app runs no AI model inside a person's automations yet, and ${modelSteps.length} step(s) need one: ${modelSteps.map(({ node }) => `“${short(node.description)}”`).join('; ')}.`,
    'Do that step with code (a code node or the row tools) or ask the person (a human node). If it truly needs judgment, say that Foundry cannot build it yet.', { steps: modelSteps.map(({ path }) => path.join('/')) }));
  const signalWaits = nodes.filter(({ node }) => node.kind === 'wait' && (node.signal !== undefined || node.race !== undefined));
  if (signalWaits.length) blockers.push(blocker('SIGNAL_WAIT_UNSUPPORTED', `${signalWaits.length} step(s) wait for an outside signal (${signalWaits.map(({ node }) => node.signal ?? 'a race').join(', ')}), and this app has no way to deliver one.`,
    'Wait for a time (a wait with delayMs or at), or ask the person (a human node) instead.', { steps: signalWaits.map(({ path }) => path.join('/')) }));

  // 3. capabilities
  const used = new Map();
  for (const { node, path } of nodes) {
    const tool = node.kind === 'task' ? node.tool : node.kind === 'verify' && node.method === 'capability' ? node.tool : null;
    if (typeof tool === 'string') { if (!used.has(tool)) used.set(tool, []); used.get(tool).push({ node, path }); }
  }
  const missing = [...used.keys()].filter(t => !registry.get(t) || !offered(t));
  if (missing.length) blockers.push(blocker('MISSING_CAPABILITY', `Foundry has no capability for ${missing.map(t => `“${t}” (needed by: ${used.get(t).map(({ node }) => short(node.description, 60)).join('; ')})`).join(', ')}.`,
    'Use only the capabilities construction_guide lists. If the person needs something none of them can do, tell them Foundry cannot do that part yet; do not substitute another action.',
    { capabilities: missing }));

  // 4. outside effects: targets, the run input, addresses anywhere, independent checks
  for (const [tool, uses] of used) {
    const spec = OUTSIDE_EFFECTS[tool];
    const cap = registry.get(tool);
    if (!spec) {
      if (cap && cap.effects !== 'none' && !INTERNAL_WRITES.has(tool) && offered(tool))
        blockers.push(blocker('UNKNOWN_EFFECT', `“${tool}” acts outside the run, and Foundry does not know which of its arguments says where.`, 'Use outbox.send, chat.post or sheet.append for outside actions.'));
      continue;
    }
    for (const { node, path } of uses) {
      const arg = node.args?.[spec.target];
      const entry = { step: path.join('/'), description: node.description, tool, kind: spec.kind, verb: spec.verb };
      if (typeof arg === 'string') {
        if (!groundedIn(words, spec.kind, arg)) blockers.push(blocker('UNGROUNDED_TARGET', `The ${spec.kind} “${short(arg, 120)}” (step “${short(node.description, 60)}”) is not in the person's words.`,
          `Ask the person where it should go and pass their answer in answers, or take it from their own data. Never fill in ${spec.kind === 'e-mail' ? 'an' : 'a'} ${spec.kind} they did not give.`, { value: arg, step: entry.step }));
        effects.push({ ...entry, target: arg, source: 'your words' });
      } else if (arg && typeof arg === 'object') {
        const refs = references(arg);
        if (refs.some(r => r === 'input' || r.startsWith('input.'))) blockers.push(blocker('TARGET_FROM_RUN_INPUT', `Where “${short(node.description, 60)}” goes would be chosen by whoever starts each run (it comes from the run input), not by the person.`,
          `Write the ${spec.kind} the person gave into the workflow, or read it from their own data.`, { step: entry.step }));
        else effects.push({ ...entry, target: null, source: 'your data', from: refs });
      } else blockers.push(blocker('INVALID_WORKFLOW', `Step “${short(node.description, 60)}” has no ${spec.target}.`, `Give ${tool} its ${spec.target}.`));
    }
    const audited = nodes.some(({ node }) => node.kind === 'verify' && node.method === 'capability' && spec.audits.includes(node.tool));
    if (!audited) blockers.push(blocker('EFFECT_UNCHECKED', `No independent check re-reads what the ${tool} step(s) left behind (to ${spec.verb}): a step's own "done" is not a check.`,
      `Add a gating verify node (method capability) with ${spec.audits.join(' or ')} that compares what the run left with what it planned.`, { capability: tool }));
  }
  if (effects.length || [...used.keys()].some(t => OUTSIDE_EFFECTS[t])) {
    const fields = addressFields(workflow.inputSchema);
    if (fields.length) blockers.push(blocker('TARGET_FROM_RUN_INPUT', `The run input has a field for an address (${fields.join(', ')}): whoever starts each run would choose where things go.`,
      'Remove it: write the addresses the person gave into the workflow, or read them from their own data.', { fields }));
  }
  const reported = new Set(blockers.filter(b => b.code === 'UNGROUNDED_TARGET' && typeof b.value === 'string').map(b => b.value.toLowerCase()));
  const loose = [...new Set(strings(workflow).flatMap(s => s.match(EMAIL_IN_TEXT) ?? []).map(a => a.toLowerCase().replace(/[.]+$/, '')))].filter(a => !words.includes(a) && !reported.has(a));
  if (loose.length) blockers.push(blocker('UNGROUNDED_TARGET', `The workflow contains e-mail address(es) the person never wrote: ${loose.slice(0, 10).join(', ')}${loose.length > 10 ? ` and ${loose.length - 10} more` : ''}.`,
    'Remove them, or ask the person and pass their answer in answers. An address in code or text counts too.', { values: loose.slice(0, 50) }));

  // 5. strict validation and the construction lint
  let validation = null;
  if (!blockers.some(b => ['MISSING_CAPABILITY', 'NOT_A_WORKFLOW'].includes(b.code))) {
    try { validation = validate(workflow); } catch (error) { validation = { valid: false, errors: [{ code: error.code ?? 'VALIDATION', message: error.message }], warnings: [] }; }
    if (!validation.valid) {
      const lintErrors = (validation.lint?.findings ?? []).filter(f => f.severity === 'error');
      const schemaErrors = (validation.errors ?? []).filter(e => !lintErrors.some(f => f.code === e.code));
      if (schemaErrors.length) blockers.push(blocker('INVALID_WORKFLOW', `The workflow does not validate: ${schemaErrors.slice(0, 5).map(e => `${e.code}: ${short(e.message, 160)}`).join('; ')}.`,
        'Fix each error (construction_guide name "references/ir.md" has the node kinds and fields) and propose again.', { errors: schemaErrors.slice(0, 20) }));
      if (lintErrors.length) blockers.push(blocker('LINT_FAILED', `The construction lint found ${lintErrors.length} problem(s): ${lintErrors.slice(0, 5).map(f => `${f.code} at ${f.path}: ${short(f.message, 140)}`).join('; ')}.`,
        'Apply each finding\'s repair and propose again.', { findings: lintErrors.slice(0, 20) }));
    } else if (validation.lint?.acceptance?.grade !== 'gating') {
      blockers.push(blocker('ACCEPTANCE_NOT_GATING', `The acceptance checks do not gate the result (grade ${validation.lint?.acceptance?.grade ?? 'unknown'}): a run could succeed without the outcome being checked.`,
        'Make acceptance compare the outcome with something an independent check computed (a verify node\'s pass, a count from a second path).'));
    }
    for (const w of validation.warnings ?? []) notes.push(`${w.code}: ${short(w.message, 160)}`);
  }
  return { ok: blockers.length === 0, blockers, validation, effects, notes };
}

/** A reply in plain words for a refusal: what stops it, then what to do. */
export function refusalReply(blockers) {
  const lines = blockers.slice(0, 6).map(b => b.what);
  return `Foundry did not propose this, so nothing was created. ${lines.join(' ')}${blockers.length > 6 ? ` (${blockers.length - 6} more.)` : ''}`;
}

// ------------------------------------------------------------------------------------------------ practice cases
export const MAX_CASES = 5;
/**
 * The agent's practice cases: [{ name?, input?, sheets?, answers? }]. input must satisfy the workflow's inputSchema; sheets are rows the
 * practice world starts from; answers stand in for the person at each human step (by node id). Throws PRACTICE_INPUT with what is wrong.
 */
export function practiceCases(practiceInput, inputSchema) {
  if (practiceInput === undefined || practiceInput === null) return [];
  const list = Array.isArray(practiceInput) ? practiceInput : [practiceInput];
  if (list.length > MAX_CASES) throw new FoundryError('PRACTICE_INPUT', `At most ${MAX_CASES} practice cases`);
  return list.map((c, i) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new FoundryError('PRACTICE_INPUT', `Practice case ${i + 1} is not an object`);
    const extra = Object.keys(c).filter(k => !['name', 'input', 'sheets', 'answers'].includes(k));
    if (extra.length) throw new FoundryError('PRACTICE_INPUT', `Practice case ${i + 1} has unknown field(s) ${extra.join(', ')}; a case is { name, input, sheets, answers }`);
    const input = c.input ?? generatePractice(inputSchema ?? { type: 'object' });
    try { validateData(inputSchema ?? { type: 'object' }, input, `practice case ${i + 1} input`); }
    catch (error) { throw new FoundryError('PRACTICE_INPUT', `Practice case ${i + 1}: ${error.message}`); }
    const sheets = c.sheets ?? {};
    if (typeof sheets !== 'object' || Array.isArray(sheets) || Object.values(sheets).some(rows => !Array.isArray(rows) || rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))))
      throw new FoundryError('PRACTICE_INPUT', `Practice case ${i + 1}: sheets maps a sheet name to a list of row objects`);
    for (const name of Object.keys(sheets)) if (!/^[a-z][a-z0-9-]{0,40}$/.test(name)) throw new FoundryError('PRACTICE_INPUT', `Practice case ${i + 1}: “${short(name, 40)}” is not a sheet name (lowercase letters, digits, dashes)`);
    const answers = c.answers ?? {};
    if (typeof answers !== 'object' || Array.isArray(answers)) throw new FoundryError('PRACTICE_INPUT', `Practice case ${i + 1}: answers maps a human step's id to its answer`);
    return { name: typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 80) : `case ${i + 1}`, input, sheets, answers, inputGenerated: c.input === undefined };
  });
}

const PRACTICE_NOW = '2026-01-05T09:00:00Z';
const CLOCK_NAME = /^(now|today|date|time|asOf|as_of|runAt|run_at)$|(At|Date|Time)$/;
/**
 * A schema-valid value made deterministically from a JSON schema (the strict profile's subset): const and enum take their first value,
 * objects their required properties, arrays their minimum length (at least one item), numbers their minimum (or 1), booleans true,
 * strings a practice word padded to minLength, date-time and date formats a fixed practice clock. $0, no model.
 */
export function generatePractice(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 10) return null;
  if (Object.hasOwn(schema, 'const')) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Object.hasOwn(schema, 'default')) return schema.default;
  const alt = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(alt) && alt.length) return generatePractice(alt[0], depth + 1);
  const type = Array.isArray(schema.type) ? schema.type.find(t => t !== 'null') ?? schema.type[0] : schema.type ?? (schema.properties ? 'object' : schema.items ? 'array' : 'string');
  switch (type) {
    case 'object': {
      const out = {};
      // A required text field named like a clock (now, date, time, ...At) gets the practice clock, so date steps can run.
      for (const name of schema.required ?? []) {
        const child = schema.properties?.[name] ?? {};
        out[name] = CLOCK_NAME.test(name) && (child.type ?? 'string') === 'string' && !child.enum && !Object.hasOwn(child, 'const') ? (/date$/i.test(name) ? PRACTICE_NOW.slice(0, 10) : PRACTICE_NOW) : generatePractice(child, depth + 1);
      }
      return out;
    }
    case 'array': {
      const n = Math.max(1, schema.minItems ?? 1);
      return Array.from({ length: Math.min(n, schema.maxItems ?? n) }, (_, i) => {
        const v = generatePractice(schema.items ?? {}, depth + 1);
        return typeof v === 'string' && schema.uniqueItems ? `${v} ${i + 1}` : v;
      });
    }
    case 'integer': case 'number': {
      const min = schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : null);
      const max = schema.maximum ?? (schema.exclusiveMaximum !== undefined ? schema.exclusiveMaximum - 1 : null);
      const v = min !== null ? min : max !== null && max < 1 ? max : 1;
      return type === 'integer' ? Math.ceil(v) : v;
    }
    case 'boolean': return true;
    case 'null': return null;
    default: {
      if (schema.format === 'date-time') return PRACTICE_NOW;
      if (schema.format === 'date') return PRACTICE_NOW.slice(0, 10);
      if (schema.format === 'email') return 'practice-person@example.invalid';
      const min = schema.minLength ?? 1, max = schema.maxLength ?? Math.max(min, 16);
      let s = 'practice';
      while (s.length < min) s += ' practice';
      return s.slice(0, Math.max(min, Math.min(max, s.length)));
    }
  }
}

/** What an agent may build with: every capability offered to automations, with its effect, whether it asks the person, its schemas. */
export function capabilityCatalog(registry) {
  return registry.list().filter(c => offered(c.name)).map(c => ({ name: c.name, effects: c.effects, asksThePersonFirst: !!c.requiresApproval,
    ...(OUTSIDE_EFFECTS[c.name] ? { outsideEffect: { target: OUTSIDE_EFFECTS[c.name].target, checkedBy: OUTSIDE_EFFECTS[c.name].audits } } : {}),
    description: c.description, inputSchema: c.inputSchema, outputSchema: c.outputSchema }));
}

/** The app's own rules for a free-form workflow, in the words construction_guide returns (kept beside the code that enforces them). */
export const FRONT_DOOR_RULES = Object.freeze([
  'Pass the person\'s exact words in request. Every e-mail address, chat channel or sheet the workflow sends to, posts to or appends to must be in their words (or in answers they gave), or come from their own data (a sheet the workflow reads). Ask; never fill one in.',
  'The run input must not carry an address: whoever starts a run would choose where things go.',
  'Use only the capabilities listed here. A needed capability that is missing is a blocker to report to the person, never something to substitute.',
  'No agent nodes and no agent verifies: the app runs no model inside a person\'s automations yet. Use code nodes, the row tools, or a human node (a question for the person).',
  'No waits on a signal (nothing can deliver one here). A timer is a wait with delayMs (at most an hour) or at (an absolute time; take it from the run input, e.g. computed from input.now, so practice can use a time already due).',
  'Every outside effect needs a gating verify node (method capability) that re-reads what the run left: outbox.audit or outbox.check for outbox.send, chat.audit for chat.post, sheet.audit for sheet.append.',
  'The workflow must pass strict validation and the construction lint with acceptance grade "gating" (construction_guide: references/verify-stop.md).',
  'Give practiceInput: 1-5 cases { name, input, sheets: { sheetName: [rows] }, answers: { humanNodeId: answer } }. Without one, Foundry makes a schema-valid input itself and answers human steps with stand-in answers; a sheet the workflow reads must have practice rows.',
  'Live runs: every send and post asks the person first; turning a version on needs a passing practice run of that exact version and the person\'s own yes.'
]);
