// Port kit for the records bed (JUDGE-PROGRAM.md §1.2 group R, X1/X5/X8 records families, §8.4 W2).
// RELOCATED from src/judges/records.mjs until the frozen C0 and P1 experiments finish (any file added
// under src/ changes their construction-kit hash); it moves to src/judges/ afterwards, unchanged.
//
// The factory (experiments/kev-data/ports/records-notes.mjs) and the runtime import this same module,
// so a training state and a served state come from one function (W2: kit.buildState(task, slots) is the
// factory state byte for byte). The kit works on the TASK it is given and imports no bed: the runtime
// has no frozen copy of the beds. A task is the bed's task object, { inputs: { source_notes, spec,
// export }, ... }; only inputs.source_notes and inputs.export are read.
//
// States (frozen contracts, spec/ports.json state.keys):
//   R1, R3, R4   { system, source_note }
//   R2           { system, marker, source_note }
//   X5           { source_text }
//   X8           { source_line, conventions, field, extracted_value }
//   X1           { source_kind, text }
//   R5           { system, location_text, row_line }
//   X2           { a, b, context }
//
// source_note is system S's notes paragraph plus every paragraph it names by system (one hop), joined by
// a blank line: the construction of the Kev probe's applicability dataset (experiments/kev-probe/
// datasets.mjs buildApplicability). The slots a state needs beyond the wording slots (all trusted code
// knowledge, never task text):
//   port         which port's state to build (added by kit.buildState / kit.request; optional for R1/R3/R4)
//   system       the system asked about (R1-R5), or the system of a row (X8, X1, X2 when no row id)
//   value        R2: the marker display form (FLAG_FORM show); X8: the extracted value
//   field        X8: the extraction node's output field name (R4's {field} is a wording slot only)
//   row          X8, X1, R5: the row id; the kit reads the row line from inputs.export
//   text         X1: an explicit span, instead of a row
//   assumption   X5 (wording slot only)
//   systems      X5: the systems the assumption concerns (paragraphs chosen by code)
//   paragraphs   explicit ordered list of systems whose paragraphs form source_note / source_text (slot
//                binding tests: two systems' paragraphs in one state); default [system, ...named]
//   scope        'notes': source_note is the whole source notes text (the long variant, windowed by the
//                notes' own size, about 1.8K real tokens)
import { definePortKit } from './kit.mjs';
import { loadSpec } from '../lib/contracts.mjs';

export const KIT_SOURCE_KIND = 'customer export row';
const SYSTEM_PARA = /^([A-Z][A-Z0-9]{2,})\. /;

const text = (task, key) => {
  const v = task?.inputs?.[key];
  if (typeof v !== 'string') throw new TypeError(`records kit: task.inputs.${key} must be a string`);
  return v;
};

// The system paragraphs of a source-notes text: { order: [S, ...], para: {S: text}, general: text|null }.
export function notesParagraphs(notes) {
  const blocks = String(notes).split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const para = {}, order = [];
  let general = null;
  for (const b of blocks) {
    const m = SYSTEM_PARA.exec(b);
    if (m) { if (!(m[1] in para)) { para[m[1]] = b; order.push(m[1]); } }
    else if (/^General:/.test(b)) general = b;
  }
  return { order, para, general, blocks };
}

// Systems whose paragraph `own` names (other than `self`), in notes order.
export function namedSystems(own, self, order) {
  return order.filter(o => o !== self && new RegExp(`(?<![A-Za-z0-9_])${o}(?![A-Za-z0-9_])`).test(own));
}

// The paragraphs a state shows for `system`: explicit slots.paragraphs, else the system's own paragraph
// followed by the paragraphs it names. A system the notes do not describe yields no paragraph.
export function paragraphsFor(notes, slots = {}) {
  const P = notesParagraphs(notes);
  if (Array.isArray(slots.paragraphs) && slots.paragraphs.length) return slots.paragraphs.filter(s => P.para[s]).map(s => P.para[s]);
  const own = P.para[slots.system];
  if (!own) return [];
  return [own, ...namedSystems(own, slots.system, P.order).map(s => P.para[s])];
}

export function sourceNote(task, slots = {}) {
  const notes = text(task, 'source_notes');
  if (slots.scope === 'notes') return notes.trim();
  const paras = paragraphsFor(notes, slots);
  if (!paras.length) throw new Error(`records kit: the notes have no paragraph for ${JSON.stringify(slots.system ?? slots.paragraphs)}`);
  return paras.join('\n\n');
}

// X5: the relevant paragraphs chosen by code. A system the notes do not describe (an assumption about a
// system absent from this task) falls back to the general paragraph and the first two system paragraphs,
// so the source text is still a coherent excerpt of the task's notes.
export function sourceText(task, slots = {}) {
  const notes = text(task, 'source_notes');
  if (slots.scope === 'notes') return notes.trim();
  const P = notesParagraphs(notes);
  const wanted = Array.isArray(slots.paragraphs) && slots.paragraphs.length ? slots.paragraphs
    : (Array.isArray(slots.systems) ? slots.systems : [slots.system]).filter(Boolean);
  const present = wanted.filter(s => P.para[s]);
  if (present.length) {
    if (Array.isArray(slots.paragraphs) && slots.paragraphs.length) return present.map(s => P.para[s]).join('\n\n');
    const out = [];
    for (const s of present) for (const q of [s, ...namedSystems(P.para[s], s, P.order)]) if (!out.includes(q)) out.push(q);
    return out.map(s => P.para[s]).join('\n\n');
  }
  return [P.general, ...P.order.slice(0, 2).map(s => P.para[s])].filter(Boolean).join('\n\n');
}

// Export rows: "BRIGHTDESK row=<id> |", "LEDGR;<id>;", "ATLAS #<id> ::", "Vendex <id> —", "KOBO/<id> ",
// "VERITAS {"row":<id>,".
const ROW_ID = [
  [/^BRIGHTDESK row=(\d+)\b/, 'BRIGHTDESK'], [/^LEDGR;(\d+);/, 'LEDGR'], [/^ATLAS #(\d+)\b/, 'ATLAS'],
  [/^Vendex (\d+) —/, 'VENDEX'], [/^KOBO\/(\d+)\b/, 'KOBO'], [/^VERITAS \{"row":(\d+),/, 'VERITAS'],
];
export function parseRowLine(line) {
  for (const [re, system] of ROW_ID) { const m = re.exec(line); if (m) return { id: Number(m[1]), system }; }
  return null;
}
export function rowLine(task, id) {
  for (const line of text(task, 'export').split('\n')) { const r = parseRowLine(line); if (r && r.id === Number(id)) return { line, system: r.system, id: r.id }; }
  throw new Error(`records kit: the export has no row ${id}`);
}

const needStr = (v, what) => { if (typeof v !== 'string' || !v.length) throw new TypeError(`records kit: ${what} must be a non-empty string`); return v; };

// The location text of a row as written (R5): the country field of the dialect, or for VENDEX free text
// the place phrase of the sentence.
export function locationText(line, system) {
  switch (system) {
    case 'BRIGHTDESK': return /\| country=([^|]*?) \|/.exec(line)?.[1] ?? '';
    case 'LEDGR': return line.split(';')[5] ?? '';
    case 'ATLAS': return /:: born [^:]*? :: ([^:]*?) :: tel /.exec(line)?.[1] ?? '';
    case 'KOBO': return 'Japan (implicit: KOBO serves customers resident in Japan)';
    case 'VERITAS': return /"country":(null|"[^"]*")/.exec(line)?.[1]?.replace(/^"|"$/g, '') ?? '';
    case 'VENDEX': {
      const m = /based in ([^;,.()]+?)(?:[,;.]| \(|$)/.exec(line) ?? /\(([^()]+)\), (?:born|DOB|date of birth|b\.|birth date|DOB unknown)/i.exec(line)
        ?? /(?:an?|the) ([A-Z][a-z]+) supplier/.exec(line) ?? / — ([^—]+?) — /.exec(line);
      return m ? m[1].trim() : '';
    }
    default: return '';
  }
}

export function buildState(task, slots = {}, port = slots.port) {
  switch (port) {
    case undefined: case null: case 'R1': case 'R3': case 'R4':
      return { system: needStr(slots.system, 'slots.system'), source_note: sourceNote(task, slots) };
    case 'R2':
      return { system: needStr(slots.system, 'slots.system'), marker: needStr(slots.value, 'slots.value (the marker display form)'), source_note: sourceNote(task, slots) };
    case 'X5':
      return { source_text: sourceText(task, slots) };
    case 'X8': {
      const r = rowLine(task, slots.row);
      const conv = sourceNote(task, { ...slots, system: slots.system ?? r.system });
      return { source_line: r.line, conventions: conv, field: needStr(slots.field, 'slots.field'), extracted_value: needStr(slots.value, 'slots.value (the extracted value)') };
    }
    case 'X1':
      return { source_kind: KIT_SOURCE_KIND, text: slots.text !== undefined ? needStr(slots.text, 'slots.text') : rowLine(task, slots.row).line };
    case 'R5': {
      const r = rowLine(task, slots.row);
      return { system: slots.system ?? r.system, location_text: locationText(r.line, r.system), row_line: r.line };
    }
    case 'X2': {
      const a = rowLine(task, slots.rowA), b = rowLine(task, slots.rowB);
      return { a: a.line, b: b.line, context: sourceNote(task, { system: a.system }) };
    }
    default: throw new Error(`records kit: no state for port ${port}`);
  }
}

const { contracts: ALL } = loadSpec();
export const PORTS = Object.freeze(['R1', 'R2', 'R3', 'R4', 'R5', 'X1', 'X2', 'X5', 'X8']);
const base = definePortKit({ bed: 'records', contracts: Object.fromEntries(PORTS.map(p => [p, ALL[p]])), buildState: (task, slots) => buildState(task, slots) });

// kit.buildState(task, slots, port) and kit.request(port, task, slots, opts) pass the port to the state
// builder (the interface carries one buildState per kit; the states of this bed differ by port).
export const kit = Object.freeze({
  ...base,
  buildState: (task, slots = {}, port = slots.port) => base.buildState(task, { ...slots, port }),
  request: (port, task, slots = {}, opts = {}) => base.request(port, task, { ...slots, port }, opts),
});
