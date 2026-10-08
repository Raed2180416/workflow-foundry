// Port kit for the synth bed (JUDGE-PROGRAM.md §1.2 group S, X1, X2, X4, X5, X7, X8; §2.1, §8.4 W2).
// A kit turns a synth task (the bed's {prompt, inputs: {documents, requested}}) into the state a judgment
// port reads. The factory (experiments/kev-data/ports/synth.mjs) and the runtime import the same functions,
// so a trained state and a served state are built by one code path.
//
// Relocated: until the C0 and P1 experiments finish this file lives in experiments/kev-data/judges/ (the plan
// names src/judges/synth.mjs; any file added under src/ changes the frozen construction-kit hash); it moves to
// src/judges/synth.mjs afterwards with no change to the interface.
//
// A kit works on the task text only. It never imports a bed (the runtime has no frozen copy), never reads
// seed, split, difficulty or any world structure, and uses no clock or random source. Where a port needs the
// identity of a span (which document, which value) the caller passes it in `slots`:
//   S2  { document: 'D07', value: '12.5 mg/mL', property: 'melting point' }   the value as the text writes it
//   S3  { document, condition: 'in water at 25 °C', property, normalised? }   the condition as stated
//   S4  { document, value, entity }                                           the requested entity (prompt name)
//   S1  { document: <notice id>, candidates: ['D03', 'D17', ...] }            candidate ids c1..ck are the list order
//   S5  { document }
//   X1  { document, text }                                                    a span of the document
//   X2  { a, b, document }                                                    two references; the mapping sentence is read from the document
//   X4  { document, statement, related?: [...] }
//   X5  { topic: 'policy' | 'conditions' | 'both' | 'other', ... }            the prompt windows chosen by code
//   X7  { document }
//   X8  { document, located, field, value, from? }   located: the source value as the text writes it; value: the extraction node's
//                                                    output (the wording slot too); from: the printed value of an erratum line
// and `port` selects the state shape in the aggregate kit (the per-port kits in `kits` need none).
import { definePortKit } from './kit.mjs';
import { loadSpec } from '../lib/contracts.mjs';
import { KIND_OF_TYPE, PROPERTIES, unitsOf } from '../taps/synth-frames.mjs';

export const KIT_VERSION = 1;
const fail = (code, message, details) => { const e = new Error(`${code}: ${message}`); e.code = code; if (details !== undefined) e.details = details; return e; };

// ---------------------------------------------------------------------------------------------------------------
// Parsing the task
const SECTION = /^## (.+)$/;
const PARSED = new WeakMap();
export function parseTask(task) {
  if (task && typeof task === 'object' && PARSED.has(task)) return PARSED.get(task);
  const out = parseTaskUncached(task);
  if (task && typeof task === 'object') PARSED.set(task, out);
  return out;
}
function parseTaskUncached(task) {
  const prompt = task?.prompt, docsIn = task?.inputs?.documents;
  if (typeof prompt !== 'string' || !Array.isArray(docsIn)) throw fail('KIT_TASK', 'a synth task has a prompt and inputs.documents');
  const lines = prompt.split('\n'), sections = {}, order = [];
  let cur = null;
  const intro = [];
  for (const line of lines) {
    const m = SECTION.exec(line);
    if (m) { cur = m[1]; sections[cur] = [line]; order.push(cur); } else if (cur) sections[cur].push(line); else intro.push(line);
  }
  for (const k of Object.keys(sections)) { while (sections[k].length && sections[k][sections[k].length - 1] === '') sections[k].pop(); sections[k] = sections[k].join('\n'); }
  const documents = docsIn.map(d => ({ ...d }));
  const requested = (task.inputs.requested ?? []).map(r => ({ entity: r.entity, property: r.property, unit: r.unit }));
  const stdConditions = {};
  for (const line of (sections['Standard conditions'] ?? '').split('\n')) {
    const m = /^- ([^:]+): (.+)$/.exec(line);
    if (m) stdConditions[m[1]] = m[2];
  }
  return { prompt, intro: intro.join('\n').trim(), sections, order, documents, byId: Object.fromEntries(documents.map(d => [d.id, d])), requested,
    properties: [...new Set(requested.map(r => r.property))], entities: [...new Set(requested.map(r => r.entity))], stdConditions };
}
const need = (cond, code, message) => { if (!cond) throw fail(code, message); };
function docOf(p, id) {
  const d = p.byId[id];
  need(d, 'KIT_SLOT', `the task has no document ${JSON.stringify(id)}`);
  return d;
}

// The kind a document's rendered type label denotes (catalog TYPE_LABELS), or null for a label outside the table.
export const kindOfType = type => KIND_OF_TYPE.get(String(type).trim()) ?? null;

// ---------------------------------------------------------------------------------------------------------------
// Sentences and passages
// A sentence ends at . ! ? (with closing quotes or brackets) followed by space and the start of a new sentence,
// or at a line break. "et al.", the initials after "Entry by" ("H. M. Moreau") and the text inside [square brackets]
// (the bed's banners, among them the injection banner of two sentences) do not end a sentence. "Protocol A." and
// "at 298 K." do.
const ABBREV = /(?:\bet al|\bvs|\be\.g|\bi\.e|\bapprox|\bca|\bFig|\bDr|\bMr|\bMs|\bProf|\bcf)\.$/;
const INITIALS_AFTER_BY = /\bby (?:[A-Z]\. )*[A-Z]\.$/;
export function sentenceSpans(text) {
  const spans = [];
  let offset = 0;
  for (const line of String(text).split('\n')) {
    let start = 0;
    const re = /[.!?]+["”')\]]*(?=\s+\S)/g;
    for (let m; (m = re.exec(line));) {
      const end = m.index + m[0].length;
      const head = line.slice(0, end), rest = line.slice(end).trimStart();
      if (!/^[A-Z\[(“"'0-9−-]/.test(rest)) continue;
      if (ABBREV.test(head) || INITIALS_AFTER_BY.test(head)) continue;
      const open = (head.slice(start).match(/\[/g) ?? []).length, close = (head.slice(start).match(/\]/g) ?? []).length;
      if (open > close) continue;
      push(spans, line, offset, start, end);
      start = end + (line.slice(end).length - rest.length);
    }
    push(spans, line, offset, start, line.length);
    offset += line.length + 1;
  }
  return spans;
}
function push(spans, line, offset, start, end) {
  const raw = line.slice(start, end), lead = raw.length - raw.trimStart().length, body = raw.trim();
  if (body) spans.push({ start: offset + start + lead, end: offset + start + lead + body.length, text: body });
}

// Where `value` occurs in `text` as a whole token: not inside a longer number or word. Returns [{start, end}].
// A value written in a CSV row ("…,12.5,mg/mL") may follow a comma.
const LEFT_BAD = /[\p{L}\p{N}_.,−-]/u, LEFT_BAD_CSV = /[\p{L}\p{N}_.−-]/u, RIGHT_BAD = /[\p{L}\p{N}_]/u;
export function occurrences(text, value, { csv = false } = {}) {
  const out = [], t = String(text), v = String(value);
  if (!v) return out;
  for (let i = t.indexOf(v); i >= 0; i = t.indexOf(v, i + 1)) {
    const l = t[i - 1], r = t[i + v.length];
    if (l !== undefined && (csv ? LEFT_BAD_CSV : LEFT_BAD).test(l)) continue;
    if (r !== undefined && RIGHT_BAD.test(r)) continue;
    // a number followed by a decimal separator and a digit is a longer number ("12.5" in "12.55")
    if (r !== undefined && /[.,]/.test(r) && /\d/.test(t[i + v.length + 1] ?? '') && /\d$/.test(v)) continue;
    out.push({ start: i, end: i + v.length });
  }
  return out;
}

// The passage of a span: its sentence plus or minus `around` sentences, in the document's own characters.
export function passageAround(text, start, end, { around = 1 } = {}) {
  const spans = sentenceSpans(text);
  const at = spans.findIndex(s => s.start <= start && end <= s.end + 1);
  need(at >= 0, 'KIT_SLOT', 'the value lies in no sentence');
  const lo = spans[Math.max(0, at - around)], hi = spans[Math.min(spans.length - 1, at + around)];
  return { passage: String(text).slice(lo.start, hi.end), sentence: spans[at].text, index: at, count: spans.length, spans, from: lo.start, to: hi.end };
}

// The unique occurrence of a value in a document, or a KIT_SLOT error (zero or several occurrences make the
// alignment ambiguous: the factory drops such a claim, the runtime refuses).
// A CSV cell pair ("12.5,mg/mL", "30,200,psi") may follow a comma; a grouped number alone ("30,200") may not.
export const isCsvValue = value => /,[^\d\s]/.test(value) && !/\s/.test(value);
export function locateValue(doc, value) {
  const hits = occurrences(doc.text, value, { csv: isCsvValue(value) });
  need(hits.length === 1, 'KIT_SLOT', `the value ${JSON.stringify(String(value).slice(0, 60))} occurs ${hits.length} times in ${doc.id} (it must occur once)`);
  return hits[0];
}

// ---------------------------------------------------------------------------------------------------------------
// Temperatures in kelvin ("code-normalised text", S3 second family)
const T_C = /(−|-)?(\d+(?:\.\d+)?) ?°C/g, T_F = /(−|-)?(\d+(?:\.\d+)?) ?°F/g;
const kelvinText = k => { const r = Math.round(k * 100) / 100; return Number.isInteger(r) ? String(r) : String(r); };
export function normaliseTemperatures(text) {
  const num = (neg, x) => (neg ? -1 : 1) * Number(x);
  return String(text)
    .replace(T_C, (_, neg, x) => `${kelvinText(num(neg, x) + 273.15)} K`)
    .replace(T_F, (_, neg, x) => `${kelvinText((num(neg, x) - 32) * 5 / 9 + 273.15)} K`);
}

// ---------------------------------------------------------------------------------------------------------------
// State builders
export const SOURCE_KINDS = Object.freeze({ journal: 'document', preprint: 'document', labnote: 'memo', press: 'press release', erratum: 'notice', retraction: 'notice', concern: 'notice' });
const sourceKindOf = doc => SOURCE_KINDS[kindOfType(doc.type)] ?? 'document';

function valueSlot(p, slots, key = 'value') {
  const doc = docOf(p, slots.document);
  need(typeof slots[key] === 'string' && slots[key], 'KIT_SLOT', `slots.${key} must be the value as the document writes it`);
  const at = locateValue(doc, slots[key]);
  return { doc, at };
}
function propertySlot(p, slots) {
  need(PROPERTIES.includes(slots.property) && p.properties.includes(slots.property), 'KIT_SLOT', `slots.property ${JSON.stringify(slots.property)} is not a requested property of the task`);
  return slots.property;
}
export function stateS2(task, slots) {
  const p = parseTask(task), property = propertySlot(p, slots), { doc, at } = valueSlot(p, slots);
  return { document_type: doc.type, property, value: slots.value, passage: passageAround(doc.text, at.start, at.end).passage };
}
export function stateS4(task, slots) {
  const p = parseTask(task), { doc, at } = valueSlot(p, slots);
  need(p.entities.includes(slots.entity), 'KIT_SLOT', `slots.entity ${JSON.stringify(slots.entity)} is not a requested entity of the task`);
  return { requested_entity: slots.entity, passage: passageAround(doc.text, at.start, at.end).passage };
}
// S3: the property's standard condition from the prompt and the condition as the document states it
export function stateS3(task, slots) {
  const p = parseTask(task), doc = docOf(p, slots.document), property = propertySlot(p, slots);
  need(typeof slots.condition === 'string' && slots.condition, 'KIT_SLOT', 'slots.condition must be the condition as the document states it');
  const std = p.stdConditions[property];
  need(std, 'KIT_SLOT', `the prompt gives no standard condition for ${property}`);
  const t = doc.text.toLowerCase(), c = slots.condition.toLowerCase();
  need(t.includes(c), 'KIT_SLOT', `the condition is not in ${doc.id}`);
  const norm = slots.normalised ? normaliseTemperatures : x => x;
  return { property, standard_condition: norm(std), stated_condition: norm(slots.condition) };
}
export const candidateDescription = d => `${d.title} — ${d.authors}, ${d.venue}, ${d.date}`;
export function candidateOptions(task, slots) {
  const p = parseTask(task);
  need(Array.isArray(slots.candidates) && slots.candidates.length >= 2 && slots.candidates.length <= 8, 'KIT_SLOT', 'S1 takes 2-8 candidates');
  need(new Set(slots.candidates).size === slots.candidates.length, 'KIT_SLOT', 'candidates are distinct documents');
  const options = slots.candidates.map((_, i) => `c${i + 1}`), optionDescriptions = {};
  slots.candidates.forEach((id, i) => { optionDescriptions[options[i]] = candidateDescription(docOf(p, id)); });
  return { options, optionDescriptions };
}
export function stateS1(task, slots) {
  const p = parseTask(task), d = docOf(p, slots.document);
  return { notice: { type: d.type, venue: d.venue, date: d.date, title: d.title, text: d.text } };
}
export function stateS5(task, slots) {
  const p = parseTask(task), d = docOf(p, slots.document);
  return { type_label: d.type, venue: d.venue, title: d.title };
}
export function stateX1(task, slots) {
  const p = parseTask(task), d = docOf(p, slots.document);
  need(typeof slots.text === 'string' && slots.text.trim(), 'KIT_SLOT', 'slots.text must be a span of the document');
  need(d.text.includes(slots.text), 'KIT_SLOT', `the span is not in ${d.id}`);
  return { source_kind: sourceKindOf(d), text: slots.text };
}
// X2: two references and the sentence of the document that maps them (a code-mapping sentence or the sentence the
// document uses to tell similar names apart)
export function stateX2(task, slots) {
  const p = parseTask(task), d = docOf(p, slots.document);
  need(typeof slots.a === 'string' && typeof slots.b === 'string' && slots.a && slots.b, 'KIT_SLOT', 'X2 takes two references a and b');
  const spans = sentenceSpans(d.text), hit = spans.filter(s => s.text.includes(slots.a) && s.text.includes(slots.b));
  const first = hit.length ? hit[0] : spans.find(s => s.text.includes(slots.a) || s.text.includes(slots.b));
  need(first, 'KIT_SLOT', `neither reference occurs in ${d.id}`);
  const sentenceNotes = [first.text];
  if (slots.note) sentenceNotes.push(String(slots.note));
  return { a: slots.a, b: slots.b, context: sentenceNotes.join(' ') };
}
const sectionText = (p, name) => p.sections[name] ?? '';
export function stateX4(task, slots) {
  const p = parseTask(task), d = docOf(p, slots.document);
  need(typeof slots.statement === 'string' && d.text.includes(slots.statement), 'KIT_SLOT', `the statement is not in ${d.id}`);
  const related = (slots.related ?? []).map(String);
  need(related.length <= 2, 'KIT_SLOT', 'at most 2 related statements');
  return { statement: slots.statement, source: { doc_type: d.type, date: d.date, author_role: authorRoleOf(d) }, related_statements: related };
}
// the role of a document's author, as the document's own type and venue state it
export function authorRoleOf(d) {
  const k = kindOfType(d.type);
  return k === 'journal' ? 'journal author' : k === 'preprint' ? 'preprint author' : k === 'labnote' ? 'research group' : k === 'press' ? 'company communications' : 'editor';
}
export function stateX7(task, slots) {
  const p = parseTask(task), d = docOf(p, slots.document);
  return { item: `${d.type} | ${d.venue} | ${d.date} | ${d.title}\n${d.text}` };
}
// X5: the windows of the prompt a precondition is checked against, chosen by code. Every window opens with the
// task's own first paragraph and the requested cells (the task text that makes a window this task's); then the
// section(s) the precondition kind concerns.
export const X5_TOPICS = Object.freeze({
  policy: ['Resolution policy'], conditions: ['Standard conditions'], both: ['Standard conditions', 'Resolution policy'],
  units: ['Units'], status: ['Document status'],
});
export function stateX5(task, slots) {
  const p = parseTask(task), names = X5_TOPICS[slots.topic];
  need(names, 'KIT_SLOT', `slots.topic must be one of ${Object.keys(X5_TOPICS).join(', ')}`);
  const parts = [p.intro, sectionText(p, 'Requested cells'), ...names.map(n => sectionText(p, n))].filter(Boolean);
  need(parts.length === names.length + 2, 'KIT_SLOT', 'the task lacks a section this window needs');
  return { source_text: parts.join('\n\n') };
}
// X8: the source line is the sentence holding the value (for an erratum line, the sentences from the one holding the printed
// value to the one holding the correction); the conventions are the task's own sentences about units (and, for an erratum
// line, the status rule that says what an erratum does)
export function stateX8(task, slots) {
  const p = parseTask(task), { doc, at } = valueSlot(p, slots, 'located');
  need(typeof slots.field === 'string' && slots.field && typeof slots.value === 'string' && slots.value, 'KIT_SLOT', 'X8 takes the extraction node\'s field and its extracted value (slots.value)');
  const spans = sentenceSpans(doc.text), at1 = spans.findIndex(s => s.start <= at.start && at.end <= s.end + 1);
  need(at1 >= 0, 'KIT_SLOT', 'the value lies in no sentence');
  let from = at1, to = at1;
  if (slots.from !== undefined) {
    const o = locateValue(doc, slots.from), at2 = spans.findIndex(s => s.start <= o.start && o.end <= s.end + 1);
    need(at2 >= 0, 'KIT_SLOT', 'the printed value lies in no sentence');
    from = Math.min(at1, at2); to = Math.max(at1, at2);
  }
  const sourceLine = doc.text.slice(spans[from].start, spans[to].end);
  const units = sectionText(p, 'Units'), status = sectionText(p, 'Document status');
  need(units, 'KIT_SLOT', 'the task has no Units section');
  const rule4 = status.split('\n').find(l => /^4\. /.test(l));
  const body = units.split('\n').slice(1).join('\n');
  const conventions = slots.from !== undefined && rule4 ? [body, rule4].join('\n') : body;
  return { source_line: sourceLine, conventions, field: slots.field, extracted_value: slots.value };
}

// ---------------------------------------------------------------------------------------------------------------
// Kits
const { contracts: ALL } = loadSpec();
export const PORTS = Object.freeze(['S1', 'S2', 'S3', 'S4', 'S5', 'X1', 'X2', 'X4', 'X5', 'X7', 'X8']);
const BUILDERS = { S1: stateS1, S2: stateS2, S3: stateS3, S4: stateS4, S5: stateS5, X1: stateX1, X2: stateX2, X4: stateX4, X5: stateX5, X7: stateX7, X8: stateX8 };
export function buildState(task, slots = {}, port = slots.port) {
  const f = BUILDERS[port];
  if (!f) throw fail('KIT_PORT', `synth kit: no state for port ${port}`);
  return f(task, slots);
}
const kitOf = port => {
  const base = definePortKit({ bed: 'synth', contracts: { [port]: ALL[port] }, buildState: (task, slots) => BUILDERS[port](task, slots) });
  // S1 serves its candidate ids as the question's options (variable options, described by title, authors, venue and date)
  const req = port === 'S1' ? (p, task, slots = {}, opts = {}) => base.request(p, task, slots, { ...candidateOptions(task, slots), ...opts }) : base.request;
  return Object.freeze({ ...base, request: req });
};
export const kits = Object.freeze(Object.fromEntries(PORTS.map(p => [p, kitOf(p)])));
const baseKit = definePortKit({ bed: 'synth', contracts: Object.fromEntries(PORTS.map(p => [p, ALL[p]])), buildState: (task, slots) => buildState(task, slots) });
// kit.buildState(task, slots, port) and kit.request(port, task, slots, opts) pass the port to the state builder (the
// interface carries one buildState per kit; the states of this bed differ by port).
export const kit = Object.freeze({
  ...baseKit,
  buildState: (task, slots = {}, port = slots.port) => baseKit.buildState(task, { ...slots, port }),
  request: (port, task, slots = {}, opts = {}) => baseKit.request(port, task, { ...slots, port }, port === 'S1' ? { ...candidateOptions(task, slots), ...opts } : opts),
});
export { unitsOf };
