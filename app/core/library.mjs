// The template library: frontier-written workflow templates in the repo's typed workflow JSON (app/core/templates/*.json), each with
// typed slots, the capabilities it needs (local stand-ins only), acceptance checks and an independent verify node, and practice data.
// A builder (the stub, or a cheap model through ModelPort: ./builder-model.mjs) picks a template and fills its slots; this module does
// everything else by code:
//   - the model-facing fill schema of a template (portable subset, no unions, no bounds: bounds are checked here, in code);
//   - slot resolution: typing, ranges, constraints, grounding (an address or channel the person never wrote is treated as not given),
//     the question policy (ask only slots whose wrong default sends data to the wrong place or does something the person would refuse),
//     and visible defaults for everything else;
//   - instantiation into a workflow (`{"$slot"}`, `{"$if"}`, `{"$derive"}`, `"[[slot]]"` and `$includeIf`), with the template id and
//     the slot values recorded in the workflow's metadata tags so a later revision starts from them.
// Templates are trusted host material (written by the frontier author, reviewed, frozen by hash in the eval manifest); a request is
// untrusted data and only ever reaches a template through typed, checked slot values.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FoundryError, canonical, clone } from '../../src/data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_DIR = path.join(here, 'templates');
export const EMAIL = /^[^@\s<>()"',;]+@[^@\s<>()"',;]+\.[A-Za-z]{2,}$/;
const EMAIL_IN_TEXT = /[^@\s<>()"',;:]+@[^@\s<>()"',;:]+\.[A-Za-z]{2,}/g;
const CHANNEL = /^#[a-z0-9][a-z0-9_-]{0,60}$/;
const MARKERS = /\{\{|\}\}|\[\[|\]\]/;
const STRINGY = new Set(['string', 'text', 'email', 'channel']);
const SEVERITIES = ['info', 'warning', 'critical'];
const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'team';

// ---------------------------------------------------------------- derived values (frontier-written, one small function each)
const DERIVE = {
  'weekly-report': {
    reportText: v => 'Weekly report for [[team]]\nReport date: {{now}}\n\nFinished {{done}} of {{total}} items. Still open: {{open}}. Blocked: {{blocked}}.\n\nFinished:\n{{doneLines}}\n'
      .replaceAll('[[team]]', v.team) + (v.listOpen ? '\nStill open:\n{{openLines}}\n' : '') + (v.listBlocked ? '\nBlocked:\n{{blockedLines}}\n' : '')
  },
  'invoice-chase': {
    stageRules: v => [
      ...(v.finalAfterDays > 0 ? [{ field: 'daysLate', op: 'gte', value: v.finalAfterDays, set: { stage: 'final notice', subjectPrefix: 'Final notice', opening: 'This is a final notice.' } }] : []),
      ...(v.secondAfterDays > 0 ? [{ field: 'daysLate', op: 'gte', value: v.secondAfterDays, set: { stage: 'second reminder', subjectPrefix: 'Second reminder', opening: 'This is our second reminder.' } }] : []),
      { field: 'daysLate', op: 'gte', value: v.firstAfterDays, set: { stage: 'reminder', subjectPrefix: 'Friendly reminder', opening: 'Just a friendly reminder.' } }],
    cadenceText: v => [`a friendly reminder once an invoice is ${v.firstAfterDays} days late`, ...(v.secondAfterDays > 0 ? [`a second reminder at ${v.secondAfterDays} days`] : []),
      ...(v.finalAfterDays > 0 ? [`a final notice at ${v.finalAfterDays} days`] : [])].join(', ')
  },
  'lead-triage': {
    routeRules: v => v.rules.map(r => ({ field: r.field, op: r.op === 'atLeast' ? 'gte' : 'eq', value: r.op === 'atLeast' ? Number(r.value) : r.value, set: { assignTo: r.assignTo } })),
    rulesText: v => v.rules.length ? v.rules.map(r => `${r.field} ${r.op === 'atLeast' ? 'at least' : 'is'} ${r.value} → ${r.assignTo}`).join('; ') : 'no rules'
  },
  'support-deflection': {
    routeRules: v => [{ field: 'priority', op: 'eq', value: 'urgent', set: { route: 'person', answer: '' } },
      ...v.answers.map(a => ({ field: ['subject', 'body'], op: 'contains', value: a.keyword, set: { route: 'auto', answer: a.reply } }))],
    keywordsText: v => v.answers.map(a => `"${a.keyword}"`).join(', ') || 'none'
  },
  'expense-approval': {
    receiptText: v => v.requireReceipt ? ' with a receipt' : '',
    decisionRules: v => [...(v.requireReceipt ? [{ field: 'receipt', op: 'ne', value: true, set: { decision: 'waiting for approver', reason: 'no receipt' } }] : []),
      { field: 'amount', op: 'lte', value: v.autoApproveUpTo, set: { decision: 'approved', reason: 'within the limit' } }]
  },
  'contact-sync': {
    eligibleWhere: v => [{ field: 'unsubscribed', op: 'ne', value: true }, { field: 'email', op: 'exists' }, ...(v.onlyTag ? [{ field: 'tags', op: 'contains', value: v.onlyTag }] : [])],
    scopeText: v => v.onlyTag ? `contacts tagged "${v.onlyTag}"` : 'all contacts',
    verbText: v => v.addMissing ? 'Added' : 'Found (not added)'
  },
  'oncall-digest': {
    severities: v => SEVERITIES.slice(SEVERITIES.indexOf(v.minSeverity))
  }
};

// ---------------------------------------------------------------- loading
let cached = null;
/** All templates, sorted by id. Each: { ...template header, workflow, sha256 } (sha256 of the file bytes). */
export function loadLibrary(dir = TEMPLATE_DIR) {
  if (cached && dir === TEMPLATE_DIR) return cached;
  const list = readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => {
    const bytes = readFileSync(path.join(dir, f));
    const { template, workflow } = JSON.parse(bytes.toString('utf8'));
    if (!template?.id || !workflow) throw new FoundryError('TEMPLATE', `${f} is not a template file`);
    return Object.freeze({ ...template, workflow, file: f, sha256: createHash('sha256').update(bytes).digest('hex') });
  });
  if (dir === TEMPLATE_DIR) cached = list;
  return list;
}
export const libraryHash = (library = loadLibrary()) => createHash('sha256').update(canonical(library.map(t => [t.id, t.sha256]))).digest('hex');
export const templateById = (id, library = loadLibrary()) => library.find(t => t.id === id) ?? null;
/** The compact catalog a model sees when choosing: id, title, when to use, not for. */
export const catalog = (library = loadLibrary()) => library.map(t => ({ id: t.id, title: t.title, whenToUse: t.whenToUse, notFor: t.notFor }));

// ---------------------------------------------------------------- the model-facing schema and prompt text of a template's slots
function fieldSchema(s) {
  const description = `${s.description}${s.default !== undefined ? ` Default: ${JSON.stringify(s.default)}.` : ''}`;
  if (STRINGY.has(s.type)) return { type: 'string', description };
  if (s.type === 'integer') return { type: 'integer', description };
  if (s.type === 'number') return { type: 'number', description };
  if (s.type === 'boolean') return { type: 'boolean', description };
  if (s.type === 'enum') return { type: 'string', enum: s.values, description };
  if (s.type === 'list') return { type: 'array', description, items: { type: 'object', additionalProperties: false, required: s.fields.map(f => f.name),
    properties: Object.fromEntries(s.fields.map(f => [f.name, fieldSchema(f)])) } };
  throw new FoundryError('TEMPLATE_SLOT', `Unknown slot type ${s.type}`);
}
/** JSON schema of a fill call: every slot (all required), the slots the request does not state, questions on slots, assumptions. */
export function fillSchema(template) {
  const names = template.slots.map(s => s.name);
  return { type: 'object', additionalProperties: false, required: ['slots', 'notStated', 'questions', 'assumptions'], properties: {
    slots: { type: 'object', additionalProperties: false, required: names, properties: Object.fromEntries(template.slots.map(s => [s.name, fieldSchema(s)])) },
    notStated: { type: 'array', description: 'Slots whose value the person did not state or clearly imply (their default is used, or they are asked).', items: { type: 'string', enum: names } },
    questions: { type: 'array', description: 'At most 3. Only for a slot whose wrong guess would send data to the wrong person or place, or do something the person would refuse.',
      items: { type: 'object', additionalProperties: false, required: ['slot', 'question', 'why'], properties: { slot: { type: 'string', enum: names }, question: { type: 'string' }, why: { type: 'string' } } } },
    assumptions: { type: 'array', description: 'Short plain sentences: what you assumed that the person did not say.', items: { type: 'string' } }
  } };
}
const typeText = s => s.type === 'enum' ? `one of ${s.values.join(' | ')}` : s.type === 'list' ? `list of {${s.fields.map(f => `${f.name}: ${typeText(f)}`).join(', ')}}${s.maxItems ? `, at most ${s.maxItems}` : ''}`
  : s.type === 'integer' || s.type === 'number' ? `${s.type}${s.min !== undefined ? ` ${s.min}..${s.max}` : ''}` : s.type === 'email' ? 'one e-mail address' : s.type === 'channel' ? 'a chat channel like #name' : s.type;
/** The slot list as the prompt shows it: name, type, default, description, and which slots must be asked rather than guessed. */
export function slotSpecText(template) {
  return template.slots.map(s => `- ${s.name} (${typeText(s)}${s.default !== undefined ? `; default ${JSON.stringify(s.default)}` : ''}${s.ask ? `; ${s.askWhen ? `when ${s.askWhen} is true, ` : ''}ASK if not stated: ${s.ask}` : ''}): ${s.description}`).join('\n');
}

// ---------------------------------------------------------------- slot resolution
const has = (text, value) => typeof value === 'string' && value.length > 0 && text.includes(value.toLowerCase());
function grounded(slot, value, text) {
  if (slot.type === 'channel') { const bare = value.slice(1); return text.includes(value) || new RegExp(`(^|[^a-z0-9_-])${bare.replace(/[-]/g, '\\-')}([^a-z0-9_-]|$)`).test(text); }
  return has(text, value);
}
/** Normalise and check one value against its slot. Returns { value } or { problem }. */
function typed(slot, raw) {
  const t = slot.type;
  if (STRINGY.has(t)) {
    if (typeof raw !== 'string') return { problem: `${slot.name} must be text` };
    let v = raw.trim();
    if (MARKERS.test(v)) return { problem: `${slot.name} must not contain {{ }} or [[ ]] markers` };
    if (t === 'email') { v = v.replace(/^mailto:/i, '').toLowerCase(); if (v && !EMAIL.test(v)) return { problem: `${slot.name} "${v.slice(0, 80)}" is not one e-mail address` }; }
    if (t === 'channel') { v = v.toLowerCase(); if (v && !v.startsWith('#')) v = `#${v}`; if (v && !CHANNEL.test(v)) return { problem: `${slot.name} "${v.slice(0, 80)}" is not a channel name like #ops` }; }
    const max = slot.maxLength ?? (t === 'text' ? 2000 : 120);
    if (v.length > max) return { problem: `${slot.name} is longer than ${max} characters` };
    if (slot.minLength && v.length && v.length < slot.minLength) return { problem: `${slot.name} is shorter than ${slot.minLength} characters` };
    return { value: v };
  }
  if (t === 'integer' || t === 'number') {
    const v = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (typeof v !== 'number' || !Number.isFinite(v) || (t === 'integer' && !Number.isInteger(v))) return { problem: `${slot.name} must be ${t === 'integer' ? 'a whole number' : 'a number'}` };
    if ((slot.min !== undefined && v < slot.min) || (slot.max !== undefined && v > slot.max)) return { problem: `${slot.name} must be between ${slot.min} and ${slot.max}` };
    return { value: v };
  }
  if (t === 'boolean') return typeof raw === 'boolean' ? { value: raw } : { problem: `${slot.name} must be true or false` };
  if (t === 'enum') { const v = typeof raw === 'string' ? raw.trim() : raw; return slot.values.includes(v) ? { value: v } : { problem: `${slot.name} must be one of ${slot.values.join(', ')}` }; }
  if (t === 'list') {
    if (!Array.isArray(raw)) return { problem: `${slot.name} must be a list` };
    if (slot.maxItems && raw.length > slot.maxItems) return { problem: `${slot.name} has more than ${slot.maxItems} entries` };
    const out = [];
    for (const [i, item] of raw.entries()) {
      if (!item || typeof item !== 'object') return { problem: `${slot.name}[${i}] must be an object` };
      const row = {};
      for (const f of slot.fields) {
        const r = typed({ ...f, name: `${slot.name}[${i}].${f.name}` }, item[f.name]);
        if (r.problem) return r;
        // An empty address in an entry makes the entry incomplete (asked, in resolveSlots); any other empty field is a problem.
        if (r.value === '' && !f.optional && !f.grounded) return { problem: `${slot.name}[${i}].${f.name} is empty` };
        row[f.name] = r.value;
      }
      out.push(row);
    }
    return { value: out };
  }
  return { problem: `unknown slot type ${t}` };
}
const empty = (slot, v) => v === undefined || v === null || (STRINGY.has(slot.type) && v === '');
const CONSTRAINT = { lt: (a, b) => a < b, lte: (a, b) => a <= b, gt: (a, b) => a > b };

/**
 * Turn a fill (model output, or the stub's code) into slot values.
 * text: everything the person wrote (request and answers), for grounding; base: the slot values of the version this one replaces.
 * Returns { values, stated[], defaults[{slot, value}], questions[{id, slot, question, why, answerSchema}], problems[], ungrounded[] }.
 */
export function resolveSlots(template, fill, { text = '', base = null } = {}) {
  const lowered = `${String(text)}\n${base ? JSON.stringify(base) : ''}`.toLowerCase();
  const notStated = new Set(Array.isArray(fill?.notStated) ? fill.notStated : []);
  const values = {}, stated = [], defaults = [], problems = [], ungrounded = [], unknown = new Set();
  for (const slot of template.slots) {
    const raw = fill?.slots?.[slot.name];
    if (notStated.has(slot.name) || raw === undefined) { unknown.add(slot.name); continue; }
    const r = typed(slot, raw);
    if (r.problem) { problems.push(r.problem); unknown.add(slot.name); continue; }
    if (empty(slot, r.value)) { unknown.add(slot.name); continue; }
    if (slot.grounded && STRINGY.has(slot.type) && !grounded(slot, r.value, lowered)) { ungrounded.push({ slot: slot.name, value: r.value }); unknown.add(slot.name); continue; }
    if (slot.type === 'list') {
      // A list entry whose address the person never wrote is incomplete: the list is asked about, never guessed.
      const bad = r.value.flatMap((item, i) => slot.fields.filter(f => f.grounded && (!item[f.name] || !grounded(f, item[f.name], lowered))).map(f => ({ slot: `${slot.name}[${i}].${f.name}`, value: item[f.name] })));
      if (bad.length) { ungrounded.push(...bad); values[slot.name] = r.value; unknown.add(`${slot.name}:incomplete`); stated.push(slot.name); continue; }
    }
    values[slot.name] = r.value; stated.push(slot.name);
  }
  const questions = [];
  const modelQuestion = name => (Array.isArray(fill?.questions) ? fill.questions : []).find(q => q?.slot === name && typeof q.question === 'string' && q.question.trim());
  for (const slot of template.slots) {
    const incomplete = unknown.has(`${slot.name}:incomplete`);
    if (!unknown.has(slot.name) && !incomplete) continue;
    const fromBase = base && Object.hasOwn(base, slot.name) ? base[slot.name] : undefined;
    const wanted = slot.askWhen ? (values[slot.askWhen] ?? base?.[slot.askWhen] ?? template.slots.find(s => s.name === slot.askWhen)?.default) === true : true;
    if (!incomplete && fromBase !== undefined && !empty(slot, fromBase)) { values[slot.name] = fromBase; continue; }
    // A list slot (routing rules) is asked about only when an entry is incomplete; an unstated list gets its default (empty).
    if (slot.ask && wanted && (!slot.askOnlyIfIncomplete || incomplete)) {
      const q = modelQuestion(slot.name);
      questions.push({ id: slot.name, slot: slot.name, question: (q?.question ?? slot.question).trim().slice(0, 300), why: slot.askWhy,
        answerSchema: { type: 'string', ...(slot.type === 'email' ? { description: 'one e-mail address' } : {}) } });
      if (incomplete) continue;
      values[slot.name] = slot.default ?? null;
      continue;
    }
    if (incomplete) continue;
    values[slot.name] = clone(slot.default ?? null);
    defaults.push({ slot: slot.name, value: values[slot.name] });
  }
  for (const c of template.constraints ?? []) {
    const a = values[c.left], b = values[c.right];
    if (c.unlessZero && (a === 0 || b === 0)) continue;
    if (typeof a === 'number' && typeof b === 'number' && !CONSTRAINT[c.op](a, b)) problems.push(c.message);
  }
  for (const v of template.validations ?? []) {
    if (v.kind === 'numericWhen') for (const [i, item] of (values[v.slot] ?? []).entries()) {
      if (item[v.whenField] === v.whenValue && !Number.isFinite(Number(item[v.field]))) problems.push(`${v.slot}[${i}].${v.field} must be a number when ${v.whenField} is ${v.whenValue}`);
    }
  }
  return { values, stated, defaults, questions: questions.slice(0, 3), problems, ungrounded };
}
/** Addresses the person wrote (request and answers), for the stub and for checks. */
export const addressesIn = text => [...new Set((String(text).match(EMAIL_IN_TEXT) ?? []).map(a => a.toLowerCase()))];

// ---------------------------------------------------------------- instantiation
const truthy = v => Array.isArray(v) ? v.length > 0 : !!v;
function cond(name, values) { return name.startsWith('!') ? !truthy(values[name.slice(1)]) : truthy(values[name]); }
function interpolate(text, values) {
  return text.replace(/\[\[([A-Za-z0-9_]+)\]\]/g, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new FoundryError('TEMPLATE_SLOT', `Template refers to unknown slot ${name}`);
    const v = values[name];
    return v === null || v === undefined ? '' : String(v);
  });
}
function expand(node, values, derive) {
  if (typeof node === 'string') return interpolate(node, values);
  if (Array.isArray(node)) return node.filter(x => !(x && typeof x === 'object' && !Array.isArray(x) && Object.hasOwn(x, '$includeIf') && !cond(x.$includeIf, values)))
    .map(x => expand(x, values, derive));
  if (node && typeof node === 'object') {
    if (Object.hasOwn(node, '$slot')) { if (!Object.hasOwn(values, node.$slot)) throw new FoundryError('TEMPLATE_SLOT', `Unknown slot ${node.$slot}`); return clone(values[node.$slot]); }
    if (Object.hasOwn(node, '$derive')) { const f = derive?.[node.$derive]; if (!f) throw new FoundryError('TEMPLATE_SLOT', `Unknown derived value ${node.$derive}`); return clone(f(values)); }
    if (Object.hasOwn(node, '$if')) return expand(cond(node.$if, values) ? node.then : node.else, values, derive);
    return Object.fromEntries(Object.entries(node).filter(([k]) => k !== '$includeIf').map(([k, v]) => [k, expand(v, values, derive)]));
  }
  return node;
}
/** The flow id of a template instance: the template id, plus the slug of its id slot when it has one (one flow per team, say). */
export const flowIdOf = (template, values) => template.idSlot && values[template.idSlot] ? `${template.id}-${slug(values[template.idSlot])}` : template.id;
/** A workflow from a template and resolved slot values. */
export function instantiate(template, values, { version = 1, id = null, builder = 'unknown' } = {}) {
  const workflow = expand(template.workflow, textScope(template, values), DERIVE[template.id]);
  workflow.id = id ?? flowIdOf(template, values);
  workflow.version = version;
  workflow.metadata = { ...(workflow.metadata ?? {}),
    sources: [...(template.sources ?? []), `app/core/templates/${template.file} sha256 ${template.sha256}`],
    tags: [`template:${template.id}`, `builder:${builder}`.slice(0, 200), `slots:${canonical(values)}`],
    rationale: `Frontier-written template "${template.id}" (author: ${template.author}). Slots filled by ${builder}; every step, check and capability comes from the template.` };
  return workflow;
}
const tag = (workflow, prefix) => workflow?.metadata?.tags?.find(t => typeof t === 'string' && t.startsWith(prefix))?.slice(prefix.length) ?? null;
/** The library template a workflow was built from, if any. */
// (A library instance always carries its slots tag; the stub's weekly report carries template:weekly-report without one.)
export const templateOf = (workflow, library = loadLibrary()) => { const id = tag(workflow, 'template:'); return id && tag(workflow, 'slots:') !== null ? templateById(id, library) : null; };
/** The slot values a library workflow was built with. */
export const slotsOf = workflow => { const s = tag(workflow, 'slots:'); try { return s ? JSON.parse(s) : null; } catch { return null; } };
export const builderOf = workflow => tag(workflow, 'builder:');

// Slot values plus the template's derived *Text values, for [[name]] interpolation in strings.
const textScope = (template, values) => ({ ...values, ...Object.fromEntries(Object.entries(DERIVE[template.id] ?? {}).filter(([k]) => k.endsWith('Text')).map(([k, f]) => [k, f(values)])) });
/** What the flow will and will not do, in plain words, for these slot values. */
export function promises(template, values) {
  const scope = textScope(template, values);
  const render = list => (list ?? []).filter(x => typeof x === 'string' || cond(x.if, values)).map(x => interpolate(typeof x === 'string' ? x : x.text, scope));
  return { willDo: render(template.willDo), willNotDo: render(template.willNotDo) };
}
/** The practice world of a template: the run input and the sheets its practice run starts from. */
export const practiceOf = template => ({ input: { now: template.practice.now }, sheets: clone(template.practice.sheets) });
