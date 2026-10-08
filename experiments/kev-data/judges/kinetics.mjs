// Port kit for the kinetics bed (JUDGE-PROGRAM.md §1.2 group K, X3, X8, X5, X1, X4, X7; §2.1, §8.4 W2).
// A kit turns a kinetics task (the bed's {prompt, inputs: {study, documents}}) into the state a
// judgment port reads. The factory (experiments/kev-data/ports/kinetics.mjs) and the runtime import
// the same functions, so a trained state and a served state are built by one code path.
//
// Relocated: until the C0 and P1 experiments finish this file lives in experiments/kev-data/judges/;
// it moves to src/judges/kinetics.mjs afterwards with no change to the interface.
//
// A kit works on the task text only. It never imports a bed (the runtime has no frozen copy), never
// reads seed, split, difficulty or any world structure, and uses no clock or random source. Where a
// port needs the identity of a span (which message, which sample), the caller passes it in `slots`:
//   X3  { message: 'D11#5' }                    a chat line or an addendum line (parseTask().messages[i].id)
//   X8  { sample: 'VN-0396', field, value }     a data row of a notebook, and the extraction node's value
//   X5  { document: 'D7', part, ... }           a window of one document
//   X1  { message: 'D11#5' } | { document: 'D7', line: 4 }
//   K1  { sample: 'VN-0396' }                   the note of one well row
//   K2  { description: '...' }                  a condition reference as written
//   K3  { document: 'D7' }                      one technician sheet
//   X4  { statement: 'D4#3' }                   a line of a document (parseTask().lines)
//   X7  { message: 'D11#5' }
// and `port` selects the state shape in the aggregate kit (the per-port kits in `kits` need none).
import { definePortKit } from './kit.mjs';
import { loadSpec } from '../lib/contracts.mjs';

export const KIT_VERSION = 1;

// RATE_FACTOR of beds/kinetics/render.mjs (rate in unit = rate in uM/s x factor). A copy: a kit
// cannot import a bed. The test pins it against the frozen bed.
export const RATE_FACTOR = Object.freeze({ 'uM/s': 1, 'uM/min': 60, 'nM/s': 1000, 'nM/min': 60000, 'mM/min': 0.06, 'mM/s': 0.001 });
export const CONC_FACTOR = Object.freeze({ uM: 1, mM: 0.001, nM: 1000 });
// The notations a technician writes for a unit (beds/kinetics/render.mjs RATE_LABELS, CONC_LABELS).
export const RATE_LABELS = Object.freeze({
  'uM/s': ['µM/s', 'uM/s', 'µM s⁻¹', 'µmol/L/s'],
  'uM/min': ['µM/min', 'uM/min', 'µM min⁻¹', 'µmol/L/min'],
  'nM/s': ['nM/s', 'nM s⁻¹', 'nmol/L/s'],
  'nM/min': ['nM/min', 'nM min⁻¹', 'nmol/L/min'],
  'mM/min': ['mM/min', 'mM min⁻¹', 'mmol/L/min'],
  'mM/s': ['mM/s', 'mM s⁻¹', 'mmol/L/s'],
});
export const CONC_LABELS = Object.freeze({ uM: ['µM', 'uM', 'µmol/L'], mM: ['mM', 'mmol/L'], nM: ['nM', 'nmol/L'] });
export const RATE_WORDS = Object.freeze({ 'uM/s': 'micromolar per second', 'uM/min': 'micromolar per minute', 'nM/s': 'nanomolar per second', 'nM/min': 'nanomolar per minute', 'mM/min': 'millimolar per minute', 'mM/s': 'millimolar per second' });
export const CONC_WORDS = Object.freeze({ uM: 'micromolar', mM: 'millimolar', nM: 'nanomolar' });
export const UNIT_CODES = Object.freeze(Object.keys(RATE_FACTOR));

const fail = (code, message, details) => { const e = new Error(`${code}: ${message}`); e.code = code; if (details !== undefined) e.details = details; return e; };
const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------------------------------------
// Parsing the task text

const CHAT_LINE = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})\] (.+?): (.*)$/;
const ADDENDUM_LINE = /^Addendum \((\d{4}-\d{2}-\d{2}), (\d{2}:\d{2})\): (.*)$/;
export const WELL_ID = /\b[A-Z]{2}-\d{4}\b/g;
const DATE = /\d{4}-\d{2}-\d{2}/;

// The format of a technician sheet, from its title line (beds/kinetics/render.mjs renderTechDoc).
export function sheetFormat(title) {
  const t = String(title);
  if (/^Notebook p\.\d+ /.test(t)) return 'mdtable';
  if (/^CSV export, /.test(t)) return 'csv';
  if (/^Bench log /.test(t)) return 'prose';
  if (/^Summary sheet by condition, /.test(t)) return 'grouped';
  if (/^Instrument PC export .*decimal-comma locale$/.test(t)) return 'semicolon';
  if (/ export \d{4}-\d{2}-\d{2}, operator /.test(t)) return 'reader';
  return null;
}

// documents, messages (chat lines and addenda, in time order) and notebook sheets of a task
export function parseTask(task) {
  const docsIn = task?.inputs?.documents;
  if (!Array.isArray(docsIn)) throw fail('KIT_TASK', 'a kinetics task has inputs.documents');
  const docs = docsIn.map((d, index) => ({ index, id: d.doc_id, kind: d.kind, title: d.title, author: d.author, date: d.date, text: d.text, lines: String(d.text).split('\n') }));
  const byId = Object.fromEntries(docs.map(d => [d.id, d]));
  const sheets = docs.filter(d => d.kind === 'notebook').map(d => ({ ...d, format: sheetFormat(d.title) }));
  const messages = [];
  for (const d of docs) {
    if (d.kind === 'chat') {
      d.lines.forEach((line, i) => {
        const m = CHAT_LINE.exec(line);
        if (m) messages.push({ id: `${d.id}#${i}`, channel: 'chat', doc: d.id, line: i, date: m[1], time: m[2], author: m[3], text: m[4] });
      });
    } else if (d.kind === 'notebook') {
      d.lines.forEach((line, i) => {
        const m = ADDENDUM_LINE.exec(line);
        if (m) messages.push({ id: `${d.id}#${i}`, channel: 'addendum', doc: d.id, line: i, date: m[1], time: m[2], author: d.author, text: m[3] });
      });
    }
  }
  messages.forEach((m, order) => { m.order = order; m.when = `${m.date} ${m.time}`; });
  messages.sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : a.order - b.order));
  messages.forEach((m, rank) => { m.rank = rank; });
  const people = [...new Set(docs.map(d => d.author).concat(messages.map(m => m.author)))].filter(Boolean);
  return { docs, byId, sheets, messages, messageById: Object.fromEntries(messages.map(m => [m.id, m])), people, study: task.inputs.study ?? null };
}

export const firstName = name => String(name).split(' ')[0];

// Who a message is addressed to: a leading "@Name" or "Name," / "Name " that is the first name of exactly
// one person of the task. Returns the person's full name or null.
export function addressee(parsed, message) {
  const m = /^@?([\p{L}][\p{L}'-]*)\b/u.exec(message.text);
  if (!m) return null;
  const hits = parsed.people.filter(p => firstName(p) === m[1] && p !== message.author);
  return hits.length === 1 ? hits[0] : null;
}

// the sheets (notebook documents) whose data rows carry a well id
function sheetOfWell(parsed, id) {
  const hits = parsed.sheets.filter(s => s.lines.some(l => !/^Addendum \(/.test(l) && l.includes(id)));
  return hits.length === 1 ? hits[0] : null;
}

// The owner of the fact a message refers to: the author of the notebook entry it is about. Rules, in
// order: an addendum belongs to its sheet; a message that opens with a person's name is addressed to
// that person's entry; "my/your DATE sheet" names the entry by date; a well id names the sheet whose
// rows carry it; otherwise the message's own author. Returns { owner, basis }.
export function factOwner(parsed, message) {
  if (message.channel === 'addendum') return { owner: parsed.byId[message.doc].author, basis: 'addendum' };
  const to = addressee(parsed, message);
  if (to) return { owner: to, basis: 'addressee' };
  const dm = /\b(?:my|your) (\d{4}-\d{2}-\d{2}) (?:sheet|entries|notes|export|rates|numbers|plate|run)\b/.exec(message.text);
  if (dm) {
    const hits = parsed.sheets.filter(s => s.date === dm[1]);
    if (hits.length === 1) return { owner: hits[0].author, basis: 'date' };
  }
  const ids = [...new Set(message.text.match(WELL_ID) ?? [])];
  const owners = [...new Set(ids.map(id => sheetOfWell(parsed, id)?.author).filter(Boolean))];
  if (owners.length === 1) return { owner: owners[0], basis: 'well' };
  return { owner: message.author, basis: 'author' };
}

// Earlier messages of the same exchange (at most 2, oldest first): the question this message answers
// (the latest earlier message addressed to its author within 12 hours), and earlier messages of the same
// author that name one of the same wells or the same plate row.
const minutesOf = m => { const [y, mo, d] = m.date.split('-').map(Number); const [h, mi] = m.time.split(':').map(Number); return Date.UTC(y, mo - 1, d, h, mi) / 60000; };
const REFERS_BACK = /\byesterday\b|\bmy (?:addendum|message|note)\b|\bscratch\b|\btake back\b|\bdisregard\b/i;
const rowKeysOf = text => new Set([...text.matchAll(/plate (\d+),? row ([A-H])\b/gi)].map(x => `${x[1]}${x[2].toUpperCase()}`));
export function threadContext(parsed, message, { max = 2 } = {}) {
  const t = minutesOf(message), earlier = parsed.messages.filter(m => m.rank < message.rank);
  const picked = [];
  // the question this message answers: the latest earlier message addressed to its author within 12 hours,
  // if the author has not posted since (the author's first reply is the answer)
  const q = [...earlier].reverse().find(m => m.author !== message.author && t - minutesOf(m) <= 12 * 60 && addressee(parsed, m) === message.author);
  if (q && !earlier.some(m => m.rank > q.rank && m.author === message.author)) picked.push(q);
  // earlier messages of the same author that name one of the same wells or the same plate row
  const ids = new Set(message.text.match(WELL_ID) ?? []), rows = rowKeysOf(message.text);
  if (ids.size || rows.size) {
    for (const m of [...earlier].reverse()) {
      if (picked.length >= max) break;
      if (picked.includes(m) || m.author !== message.author) continue;
      const mids = new Set(m.text.match(WELL_ID) ?? []), mrows = rowKeysOf(m.text);
      if ([...ids].some(i => mids.has(i)) || [...rows].some(r => mrows.has(r))) picked.push(m);
    }
  }
  // a message that points back ("yesterday", "scratch my addendum") without naming the same well: the
  // author's latest earlier reports within 40 hours
  if (!picked.length && REFERS_BACK.test(message.text)) {
    for (const m of [...earlier].reverse()) {
      if (picked.length >= max) break;
      if (m.author !== message.author || t - minutesOf(m) > 40 * 60 || !/\bwell\b|[A-Z]{2}-\d{4}|\bplate \d/i.test(m.text)) continue;
      picked.push(m);
    }
  }
  return picked.sort((a, b) => a.rank - b.rank).slice(-max);
}

// ---------------------------------------------------------------------------------------------
// Condition references (K2; also how a message names a plate row)
// conds: [{id, pH, tempC, inhibitor: {uM} | null}]; bench: {code: id} or null.
// A reference may give the register id ("cond C3"), a bench colour ("the Teal block"), the pH, the
// temperature (in °C or K), the inhibitor and its dose (in µM or mM), "vehicle only" / "no inhibitor", or
// a superlative over the inhibitor-free conditions ("the coldest condition"). Returns the register id the
// reference names, or null when it names none or several.
const VEHICLE = /no inhibitor|vehicle|without inhibitor|\(no inh\.\)|-inh\b|0 µM \S+/i;
export function resolveCondition(text, conds, bench = null) {
  const t = String(text);
  const idm = /\bcond(?:ition)? (C\d+)\b/i.exec(t);
  if (idm && conds.some(c => c.id === idm[1].toUpperCase())) return idm[1].toUpperCase();
  const bare = /^\s*(?:the )?(C\d+)\b/.exec(t);
  if (bare && conds.some(c => c.id === bare[1])) return bare[1];
  if (bench) for (const [code, id] of Object.entries(bench)) if (new RegExp(`\\b${escapeRe(code)} block\\b`, 'i').test(t)) return id;
  let pool = conds;
  const free = conds.filter(c => !c.inhibitor);
  const sup = [[/\bcoldest\b/i, free.map(c => c.tempC), c => c.tempC, Math.min], [/\bwarmest\b/i, free.map(c => c.tempC), c => c.tempC, Math.max],
    [/\bmost acidic\b/i, free.map(c => c.pH), c => c.pH, Math.min], [/\bmost alkaline\b/i, free.map(c => c.pH), c => c.pH, Math.max]];
  for (const [re, vals, f, pick] of sup) if (re.test(t)) { const v = pick(...vals); pool = pool.filter(c => !c.inhibitor && f(c) === v); }
  const ph = /pH ?(\d+(?:[.,]\d+)?)/i.exec(t);
  if (ph) { const v = Number(ph[1].replace(',', '.')); pool = pool.filter(c => Math.abs(c.pH - v) < 1e-6); }
  const kel = /(\d+(?:[.,]\d+)?) ?K\b/.exec(t);
  const deg = /(\d+(?:[.,]\d+)?) ?°C|(\d+)C\/|(\d+)-degree/.exec(t);
  if (kel) { const v = Math.round(Number(kel[1].replace(',', '.')) - 273.15); pool = pool.filter(c => c.tempC === v); }
  else if (deg) { const v = Number((deg[1] ?? deg[2] ?? deg[3]).replace(',', '.')); pool = pool.filter(c => c.tempC === v); }
  const dose = /(?:\+ ?|\bat |\bwith |, |\s)[A-Za-z][\w-]* (?:at |\()?(\d+(?:[.,]\d+)?) ?(µM|uM|mM)\b/.exec(t);
  if (dose && !/\b0 µM\b/.test(t)) { const uM = Number(dose[1].replace(',', '.')) * (dose[2] === 'mM' ? 1000 : 1); pool = pool.filter(c => c.inhibitor && Math.abs(c.inhibitor.uM - uM) < 1e-6); }
  else if (VEHICLE.test(t) || (ph || deg || kel) && !dose) pool = pool.filter(c => !c.inhibitor);
  if (!(ph || deg || kel || idm || bench || sup.some(([re]) => re.test(t)))) return null;
  return pool.length === 1 ? pool[0].id : null;
}
export const normalizeConds = study => (study?.conditions ?? []).map(c => ({ id: c.condition_id, pH: c.pH, tempC: c.temperature_C, inhibitor: c.inhibitor ? { name: c.inhibitor.name, uM: c.inhibitor.concentration_uM } : null }));

// ---------------------------------------------------------------------------------------------
// Technician sheets: where the units, the header and the data rows are (beds/kinetics/render.mjs
// renderTechDoc). Pure text; the bed's six formats.
const UNIT_SENTENCE = [
  /^Same template as last week, so the rates below are /, /^\(Units today: /, /^I'm writing substrate in /, /^Units on this sheet: /,
  /^Exported from the instrument PC, which uses a decimal comma/, /^Same reader template as /, /^Units: as on /, /set up the template for both of us;/,
  /^Slopes are ΔA340 in mAU\/min/, /^Conc column: the plate map mixes/,
];
export const isUnitSentence = line => UNIT_SENTENCE.some(re => re.test(line));
const DATA_START = {
  mdtable: l => /^### Plate /.test(l), csv: l => l === '```csv', semicolon: l => l === '```',
  prose: l => /^\d{2}:\d{2} /.test(l), grouped: l => /^(?:Units on this sheet: |Condition: )/.test(l), reader: l => /^Plate \d+ \| Assay: /.test(l),
};
// id of the data row a line carries (by format), or null
export function rowId(format, line) {
  if (format === 'mdtable') return /^\| ([A-Z]{2}-\d{4}) \|/.exec(line)?.[1] ?? null;
  if (format === 'csv') return /^([A-Z]{2}-\d{4}),/.exec(line)?.[1] ?? null;
  if (format === 'semicolon') return /^([A-Z]{2}-\d{4});/.exec(line)?.[1] ?? null;
  if (format === 'reader') return /^[A-H]\d{2}\s+([A-Z]{2}-\d{4})\s/.exec(line)?.[1] ?? null;
  return null;
}
const HEADER_LINE = {
  mdtable: l => /^\| Sample \| Well \|/.test(l), csv: l => /^sample_id,plate,/.test(l), semicolon: l => /^sample;plate;/.test(l),
  reader: l => /^Well  Sample /.test(l),
};
export function sheetParts(sheet) {
  const { format, lines } = sheet;
  const start = lines.findIndex(DATA_START[format] ?? (() => false));
  const dataStart = start < 0 ? lines.length : start;
  const preamble = lines.slice(1, dataStart).filter(l => l.trim());
  const hdrAt = lines.findIndex(HEADER_LINE[format] ?? (() => false));
  const header = hdrAt < 0 ? null : lines[hdrAt];
  // a unit comment directly above the csv column header ("# units: S in mM, rate in µmol/L/s")
  const unitComment = format === 'csv' && hdrAt > 0 && /^# units: /.test(lines[hdrAt - 1]) ? lines[hdrAt - 1] : null;
  const rows = [];
  lines.forEach((line, index) => { const id = rowId(format, line); if (id) rows.push({ id, line, index }); });
  return { format, dataStart, preamble, unitLines: preamble.filter(isUnitSentence), header, headerIndex: hdrAt, unitComment, rows };
}

// The printed number of a rate cell (render.mjs fmtRate: plain, e, E, x10 and decimal-comma styles).
export function parseRate(text) {
  const t = String(text).trim().replace('×10^', 'e').replace(/,/g, '.');
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
function csvFields(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
// the [S] and rate cells of a tabular data row
export function rowCells(format, line) {
  if (format === 'mdtable') { const c = line.split('|').slice(1, -1).map(x => x.trim()); return { id: c[0], pos: c[1], S: c[2], rate: c[3], notes: c.slice(4).join('|') }; }
  if (format === 'csv') { const c = csvFields(line); return { id: c[0], pos: c[2], S: c[5], rate: c[6], notes: c.slice(8).join(',') }; }
  if (format === 'semicolon') { const c = line.split(';'); return { id: c[0], pos: c[2], S: c[5], rate: c[6], notes: c.slice(7).join(';') }; }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Port states
const parsedCache = new WeakMap();
export function parsed(task) {
  let p = parsedCache.get(task);
  if (!p) { p = parseTask(task); parsedCache.set(task, p); }
  return p;
}
const need = (slots, key) => {
  if (slots?.[key] === undefined || slots[key] === null || slots[key] === '') throw fail('KIT_SLOT', `the kinetics kit needs slot ${key}`);
  return slots[key];
};
const sheetById = (p, id) => { const s = p.sheets.find(x => x.id === id); if (!s) throw fail('KIT_SLOT', `no notebook sheet ${id}`); return s; };

// X3 speech_act: { message, author, fact_owner, thread_context }
export function buildX3(task, slots) {
  const p = parsed(task), m = p.messageById[need(slots, 'message')];
  if (!m) throw fail('KIT_SLOT', `no message ${slots.message}`);
  const owner = slots.fact_owner ?? factOwner(p, m).owner;
  const context = threadContext(p, m).map(c => `${c.author}: ${c.text}`);
  return { message: m.text, author: slots.author ?? m.author, fact_owner: owner, thread_context: slots.thread_context ?? context };
}

// X8 value_consistent: { source_line, conventions, field, extracted_value } for a tabular sheet row
export const X8_FIELD = 'rate_uM_per_s';
export function buildX8(task, slots) {
  const p = parsed(task), id = need(slots, 'sample');
  const sheet = p.sheets.find(s => ['mdtable', 'csv', 'semicolon'].includes(s.format) && sheetParts(s).rows.some(r => r.id === id));
  if (!sheet) throw fail('KIT_SLOT', `no tabular sheet has a data row for ${id}`);
  const parts = sheetParts(sheet), row = parts.rows.find(r => r.id === id);
  const conventions = [...parts.unitLines, ...(parts.unitComment ? [parts.unitComment] : []), parts.header].filter(Boolean).join('\n');
  return { source_line: row.line, conventions, field: slots.field ?? X8_FIELD, extracted_value: String(need(slots, 'value')) };
}

// ---- K3 column_unit: { header, preamble, referenced_header? } --------------------------------------
// the line(s) of a sheet that carry its column header (and the unit comment above it)
export function headerOf(sheet) {
  const parts = sheetParts(sheet);
  if (['mdtable', 'csv', 'semicolon', 'reader'].includes(sheet.format)) return [parts.unitComment, parts.header].filter(Boolean).join('\n');
  if (sheet.format === 'grouped') return sheet.lines.find(l => /^Units on this sheet: /.test(l)) ?? sheet.lines.find(l => /^Condition: /.test(l)) ?? '';
  const first = sheet.lines.find(l => /^\d{2}:\d{2} /.test(l));
  return first ? first.slice(0, 320) : '';
}
// the sheet a "same template as X's DATE sheet" sentence points to (author and date both named, one hit)
export function referencedSheet(p, sheet) {
  const line = sheetParts(sheet).unitLines.find(l => /^Same reader template as |^Units: as on |set up the template for both of us;/.test(l));
  if (!line) return null;
  const hits = p.sheets.filter(s => s.id !== sheet.id && line.includes(s.author) && line.includes(s.date));
  return hits.length === 1 ? hits[0] : null;
}
export function buildK3(task, slots) {
  const p = parsed(task), sheet = sheetById(p, need(slots, 'document')), parts = sheetParts(sheet);
  const state = { header: headerOf(sheet), preamble: parts.preamble.join('\n') };
  const ref = referencedSheet(p, sheet);
  if (ref) state.referenced_header = headerOf(ref);
  return state;
}

// ---- K2 condition_reference: { description, register_note } -----------------------------------------
export const describeCondition = c => `pH ${Number(c.pH).toFixed(1)}, ${c.tempC ?? c.temperature_C} °C, ${c.inhibitor ? `${c.inhibitor.name ?? c.inhibitorName} ${c.inhibitor.uM ?? c.inhibitor.concentration_uM} µM` : 'no inhibitor'}`;
export function registerNote(p) {
  const lines = normalizeConds(p.study).map(c => `${c.id}: ${describeCondition(c)}`);
  const bench = p.docs.find(d => d.kind === 'memo' && /^Bench codes \(whiteboard\)/.test(d.title));
  return [...lines, ...(bench ? bench.lines.filter(l => l.startsWith('- ')) : [])].join('\n');
}
export function buildK2(task, slots) {
  const p = parsed(task);
  return { description: String(need(slots, 'description')), register_note: registerNote(p) };
}
export const registerBench = p => {
  const bench = p.docs.find(d => d.kind === 'memo' && /^Bench codes \(whiteboard\)/.test(d.title));
  if (!bench) return null;
  const conds = normalizeConds(p.study), out = {};
  for (const l of bench.lines) {
    const m = /^- (\S+) block = (.+)$/.exec(l);
    if (m) { const ids = conds.filter(c => describeCondition(c) === m[2]).map(c => c.id); if (ids.length === 1) out[m[1]] = ids[0]; }
  }
  return Object.keys(out).length ? out : null;
};

// ---- K1 note_event_type: { note, entry_author } -----------------------------------------------------
export function buildK1(task, slots) {
  const p = parsed(task), id = need(slots, 'sample');
  const sheet = p.sheets.find(s => ['mdtable', 'csv', 'semicolon'].includes(s.format) && sheetParts(s).rows.some(r => r.id === id));
  if (!sheet) throw fail('KIT_SLOT', `no tabular sheet has a data row for ${id}`);
  const row = sheetParts(sheet).rows.find(r => r.id === id), note = rowCells(sheet.format, row.line).notes.trim();
  if (!note) throw fail('KIT_SLOT', `the row of ${id} carries no note`);
  return { note, entry_author: sheet.author };
}

// ---- X1 injected_instruction: { source_kind, text } -------------------------------------------------
const KIND_OF_CHANNEL = { chat: 'lab chat message', addendum: 'notebook addendum' };
// a window of consecutive lines around line i, at most maxChars (the long variant: the span in its document)
export function windowLines(lines, i, maxChars = 6000) {
  let lo = i, hi = i, size = lines[i].length, turn = 0;
  for (;;) {
    const canLo = lo > 0 && size + lines[lo - 1].length + 1 <= maxChars, canHi = hi < lines.length - 1 && size + lines[hi + 1].length + 1 <= maxChars;
    if (!canLo && !canHi) break;
    if (canLo && (turn % 2 === 0 || !canHi)) size += lines[--lo].length + 1; else size += lines[++hi].length + 1;
    turn++;
  }
  return { text: lines.slice(lo, hi + 1).join('\n'), from: lo, to: hi };
}
export function buildX1(task, slots) {
  const p = parsed(task);
  if (slots.message) {
    const m = p.messageById[slots.message];
    if (!m) throw fail('KIT_SLOT', `no message ${slots.message}`);
    if (!slots.long) return { source_kind: KIND_OF_CHANNEL[m.channel], text: m.text };
    const d = p.byId[m.doc];
    return { source_kind: m.channel === 'chat' ? 'lab chat export' : 'notebook', text: windowLines(d.lines, m.line, slots.maxChars ?? 6000).text };
  }
  const d = p.byId[need(slots, 'document')], i = need(slots, 'line');
  const line = d.lines[i];
  if (line === undefined) throw fail('KIT_SLOT', `no line ${i} in ${d.id}`);
  if (!slots.long) return { source_kind: 'notebook line', text: line };
  return { source_kind: 'notebook', text: windowLines(d.lines, i, slots.maxChars ?? 6000).text };
}

// ---- X5 precondition_holds: { source_text } ---------------------------------------------------------
// a window of one sheet: its title, preamble and the first block of rows; or the head of an SOP
export function sheetWindow(sheet, { rows = 5 } = {}) {
  const { format, lines } = sheet, parts = sheetParts(sheet);
  const out = [lines[0], ...parts.preamble];
  const at = parts.dataStart;
  if (format === 'mdtable') { const stop = lines.findIndex((l, i) => i > at && /^\| Sample \|/.test(l)); out.push(...lines.slice(at, stop + 2 + rows)); }
  else if (format === 'csv' || format === 'semicolon') { const h = parts.headerIndex; out.push(...lines.slice(at, h + 1 + rows)); }
  else if (format === 'reader') { const h = parts.headerIndex; out.push(...lines.slice(at, h + 1 + rows)); }
  else if (format === 'grouped') out.push(...lines.slice(at, at + 4 + rows));
  else if (format === 'prose') out.push(lines[at].slice(0, 900));
  return out.join('\n');
}
export function buildX5(task, slots) {
  const p = parsed(task);
  if (slots.sop) { const d = p.byId[slots.sop]; return { source_text: d.lines.slice(0, slots.lines ?? 3).join('\n') }; }
  return { source_text: sheetWindow(sheetById(p, need(slots, 'document')), { rows: slots.rows ?? 5 }) };
}

// ---- X7 item_needed: { item } ------------------------------------------------------------------------
export function buildX7(task, slots) {
  const p = parsed(task), m = p.messageById[need(slots, 'message')];
  if (!m) throw fail('KIT_SLOT', `no message ${slots.message}`);
  return { item: `${m.author}: ${m.text}` };
}

// ---- X4 statement_standing: { statement, source: {doc_type, date, author_role}, related_statements } ----
export const DOC_TYPE = Object.freeze({ sop: 'standard operating procedure', notebook: 'technician notebook sheet', instrument: 'instrument raw export',
  log: 'master-mix log', chat: 'lab chat message', memo: 'memo', pilot: 'pilot plate' });
// a person's role as the task shows it: "Dr." names the principal investigator, a notebook author is a technician
export function roleOfPerson(p, name) {
  if (/^Dr\./.test(name)) return 'principal investigator';
  if (p.sheets.some(s => s.author === name)) return 'technician';
  return 'group member';
}
const sectionLines = (doc, n) => {
  const at = doc.lines.findIndex(l => l.startsWith(`## ${n} `));
  if (at < 0) return [];
  const end = doc.lines.findIndex((l, i) => i > at && l.startsWith('## '));
  return doc.lines.slice(at + 1, end < 0 ? undefined : end).filter(l => l.trim());
};
export function relatedStatements(p, doc, i) {
  const line = doc.lines[i];
  if (doc.kind === 'sop') {
    const sec = [...doc.lines.slice(0, i + 1)].reverse().find(l => l.startsWith('## '))?.match(/^## (\d+) /)?.[1];
    const other = p.docs.find(d => d.kind === 'sop' && d.id !== doc.id);
    return sec && other ? sectionLines(other, sec).slice(0, 2) : [];
  }
  const id = /\b[A-Z]{2}-\d{4}\b/.exec(line)?.[0];
  if (id && (doc.kind === 'notebook' || doc.kind === 'instrument')) {
    const other = p.docs.find(d => d.id !== doc.id && (d.kind === 'notebook' || d.kind === 'instrument') && (doc.kind === 'notebook' ? d.kind === 'instrument' : d.kind === 'notebook') && d.lines.some(l => !/^Addendum \(/.test(l) && l.includes(id) && rowId(sheetFormat(d.title) ?? 'rawexport', l) === id || (d.kind === 'instrument' && new RegExp(`\\s${id}\\s`).test(l))));
    const hit = other?.lines.find(l => !/^Addendum \(/.test(l) && (l.includes(`| ${id} |`) || l.startsWith(`${id},`) || l.startsWith(`${id};`) || new RegExp(`\\s${id}\\s`).test(l)));
    return hit ? [hit] : [];
  }
  return [];
}
export function buildX4(task, slots) {
  const p = parsed(task);
  if (slots.message) {
    const m = p.messageById[slots.message];
    if (!m) throw fail('KIT_SLOT', `no message ${slots.message}`);
    return { statement: m.text, source: { doc_type: m.channel === 'chat' ? DOC_TYPE.chat : 'notebook addendum', date: m.date, author_role: roleOfPerson(p, m.author) }, related_statements: [] };
  }
  const [docId, lineNo] = String(need(slots, 'statement')).split('#'), d = p.byId[docId], i = Number(lineNo);
  if (!d || !(i >= 0 && i < d.lines.length)) throw fail('KIT_SLOT', `no line ${slots.statement}`);
  return { statement: d.lines[i], source: { doc_type: DOC_TYPE[d.kind] ?? d.kind, date: d.date, author_role: roleOfPerson(p, d.author) }, related_statements: relatedStatements(p, d, i) };
}

// ---------------------------------------------------------------------------------------------
// The kits. `kits[port]` binds one port; `kit` binds them all and reads the port from slots.port.
const { contracts: CONTRACTS } = loadSpec();
export const BUILDERS = Object.freeze({ X3: buildX3, X8: buildX8, K1: buildK1, K2: buildK2, K3: buildK3, X1: buildX1, X5: buildX5, X4: buildX4, X7: buildX7 });
export const kits = Object.freeze(Object.fromEntries(Object.entries(BUILDERS).map(([port, f]) => [port,
  definePortKit({ bed: 'kinetics', contracts: { [port]: CONTRACTS[port] }, buildState: (task, slots) => f(task, slots) })])));
export const kit = definePortKit({
  bed: 'kinetics', contracts: Object.fromEntries(Object.keys(BUILDERS).map(port => [port, CONTRACTS[port]])),
  buildState(task, slots) {
    const f = BUILDERS[slots?.port];
    if (!f) throw fail('KIT_SLOT', `the aggregate kinetics kit needs slots.port (one of ${Object.keys(BUILDERS).join(', ')})`);
    return f(task, slots);
  },
});
