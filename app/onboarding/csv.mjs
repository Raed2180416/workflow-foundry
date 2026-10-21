// The person's own data, from a spreadsheet export: parse a CSV (RFC 4180), propose which column is which in plain words, detect the
// values a wrong guess would turn into harm (date order, decimal separator, which statuses mean "still open"), and turn the rows
// into the typed JSON rows the template's stand-in sheets read (app/core/stand-ins.mjs). Nothing here guesses an ambiguous value:
// it becomes a question, and rows are not converted until every question has an answer (SPEC §5 A6b).
//
// Pure functions, no I/O. Limits: 5 MB of text, 10,000 rows, 200 columns, 10,000 characters per cell.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FoundryError } from '../../src/data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const COLUMNS = JSON.parse(readFileSync(path.join(here, 'columns.json'), 'utf8'));
export const LIMITS = Object.freeze({ bytes: 5 * 1024 * 1024, rows: 10000, columns: 200, cell: 10000 });
const EMAIL = /^[^@\s<>()"',;:]+@[^@\s<>()"',;:]+\.[A-Za-z]{2,}$/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinal = n => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/** The column spec of one template sheet ("invoice-chase/invoices"). */
export function sheetSpec(template, sheet) {
  const spec = COLUMNS.sheets[`${template}/${sheet}`];
  if (!spec) throw new FoundryError('SHEET_SPEC', `No column list for ${template}/${sheet}`);
  return spec;
}
/** The sheets a template reads from the person (the ones listed in columns.json), in order. */
export const inputSheets = template => Object.keys(COLUMNS.sheets).filter(k => k.startsWith(`${template}/`)).map(k => k.slice(template.length + 1));

// ------------------------------------------------------------------------------------------------ parsing
/** Pick the delimiter that splits the first lines into the most consistent number of fields. */
export function sniffDelimiter(text) {
  const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim()).slice(0, 20);
  let best = ',', bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map(l => parse(l, d, { limit: false })[0]?.length ?? 1);
    if (!counts.length) continue;
    const first = counts[0], same = counts.filter(c => c === first).length;
    const score = first > 1 ? same * 100 + first : 0;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

/** RFC 4180 rows (quoted fields, "" escapes, line breaks inside quotes, CRLF or LF). */
export function parse(text, delimiter = ',', { limit = true } = {}) {
  const rows = []; let row = [], field = '', quoted = false, i = 0;
  const push = () => { if (limit && field.length > LIMITS.cell) throw new FoundryError('CSV_CELL', `A cell is longer than ${LIMITS.cell} characters`); row.push(field); field = ''; };
  const end = () => { push(); rows.push(row); row = []; if (limit && rows.length > LIMITS.rows + 1) throw new FoundryError('CSV_ROWS', `The file has more than ${LIMITS.rows} rows`); };
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === delimiter) { push(); i++; continue; }
    if (c === '\r') { end(); i += text[i + 1] === '\n' ? 2 : 1; continue; }
    if (c === '\n') { end(); i++; continue; }
    field += c; i++;
  }
  if (quoted) throw new FoundryError('CSV_QUOTE', 'A quoted field is not closed');
  if (field !== '' || row.length) end();
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

/** Header and records from CSV text (or a JSON array of objects). */
export function readTable(text) {
  if (typeof text !== 'string') throw new FoundryError('CSV_TEXT', 'The file must be text');
  // An Excel, Numbers or OpenDocument file read as text: a zip (PK..) or an old binary workbook, or NUL bytes. Say what to do instead
  // of offering garbage as column names (P2 walkthrough M3).
  if (/^PK\u0003\u0004|^\u00d0\u00cf\u0011\u00e0/.test(text) || text.slice(0, 4096).includes('\u0000'))
    throw new FoundryError('CSV_BINARY', 'This is a spreadsheet file (Excel, Numbers or similar), not a CSV export. In your spreadsheet app choose File, then Save As (or Export), pick CSV, and drop that file here.');
  if (Buffer.byteLength(text, 'utf8') > LIMITS.bytes) throw new FoundryError('CSV_SIZE', 'The file is larger than 5 MB');
  const clean = text.replace(/^﻿/, '');
  if (/^\s*\[/.test(clean)) {
    let rows; try { rows = JSON.parse(clean); } catch { throw new FoundryError('CSV_JSON', 'The file looks like JSON but does not parse'); }
    if (!Array.isArray(rows) || !rows.every(r => r && typeof r === 'object' && !Array.isArray(r))) throw new FoundryError('CSV_JSON', 'A JSON file must be a list of rows (objects)');
    if (rows.length > LIMITS.rows) throw new FoundryError('CSV_ROWS', `The file has more than ${LIMITS.rows} rows`);
    const header = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => !['__proto__', 'prototype', 'constructor'].includes(k));
    return { format: 'json', delimiter: null, header, records: rows.map(r => header.map(h => r[h] === undefined || r[h] === null ? '' : String(r[h]))) };
  }
  const delimiter = sniffDelimiter(clean);
  const rows = parse(clean, delimiter);
  if (!rows.length) throw new FoundryError('CSV_EMPTY', 'The file has no rows');
  const header = rows[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  if (header.length > LIMITS.columns) throw new FoundryError('CSV_COLUMNS', `The file has more than ${LIMITS.columns} columns`);
  const records = rows.slice(1).map(r => header.map((_, i) => (r[i] ?? '').trim()));
  return { format: 'csv', delimiter, header, records };
}

// ------------------------------------------------------------------------------------------------ value readers
const norm = s => String(s).toLowerCase().replace(/[_\-.#:()]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Every reading of a date text: { iso } when certain, { ambiguous: [a, b] } for d/m vs m/d, null when unreadable. */
export function readDate(text, order = null) {
  const s = String(text).trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/)) || (m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/))) return ymd(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/))) {
    const a = +m[1], b = +m[2], y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (a > 12 && b <= 12) { const d = ymd(y, b, a); return d ? { ...d, order: 'dmy' } : null; }
    if (b > 12 && a <= 12) { const d = ymd(y, a, b); return d ? { ...d, order: 'mdy' } : null; }
    if (a === b) return ymd(y, a, b);
    if (order === 'dmy') return ymd(y, b, a);
    if (order === 'mdy') return ymd(y, a, b);
    return { ambiguous: true, dmy: ymd(y, b, a)?.iso ?? null, mdy: ymd(y, a, b)?.iso ?? null };
  }
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/))) { const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); return mo < 0 ? null : ymd(+m[3], mo + 1, +m[1]); }
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/))) { const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); return mo < 0 ? null : ymd(+m[3], mo + 1, +m[2]); }
  if (/^\d{5}(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000); return { iso: d.toISOString().slice(0, 10), excelSerial: true }; }
  return null;
}
function ymd(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const t = Date.UTC(y, mo - 1, d), back = new Date(t);
  if (back.getUTCMonth() !== mo - 1) return null;
  return { iso: back.toISOString().slice(0, 10) };
}
/** An ISO date-time with an offset (datetime columns); a date alone becomes midnight UTC. */
export function readDateTime(text) {
  const s = String(text).trim();
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s))) return { iso: new Date(Date.parse(s)).toISOString() };
  if (/^\d{4}-\d{2}-\d{2} [\d:.]+$/.test(s) && Number.isFinite(Date.parse(`${s.replace(' ', 'T')}Z`))) return { iso: new Date(Date.parse(`${s.replace(' ', 'T')}Z`)).toISOString(), assumedUtc: true };
  const d = readDate(s);
  return d?.iso ? { iso: `${d.iso}T00:00:00.000Z` } : d;
}

/** How a number text reads: { value } when certain; { ambiguous } for a single separator followed by exactly three digits. */
export function readNumber(text, separator = null) {
  let s = String(text).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[\s ']/g, '').replace(/^[^\d\-+.,]+|[^\d.,]+$/g, '');
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const dots = (s.match(/\./g) ?? []).length, commas = (s.match(/,/g) ?? []).length;
  const finish = (whole, dec) => { const v = Number(`${whole}${dec ? `.${dec}` : ''}`); return Number.isFinite(v) ? { value: negative ? -v : v } : null; };
  const split = (dec, thou) => { const parts = s.split(dec); if (parts.length > 2) return null; return finish(parts[0].split(thou).join(''), parts[1] ?? ''); };
  if (dots && commas) return s.lastIndexOf(',') > s.lastIndexOf('.') ? split(',', '.') : split('.', ',');
  const sep = dots ? '.' : commas ? ',' : null;
  if (!sep) return finish(s, '');
  const count = dots || commas, parts = s.split(sep);
  if (count > 1) return parts.slice(1).every(p => p.length === 3) ? finish(parts.join(''), '') : null; // 1,234,567 or 1.234.567
  if (parts[1].length !== 3) return sep === '.' ? finish(parts[0], parts[1]) : finish(parts[0], parts[1]); // 12.5 or 12,50: a decimal
  if (separator === 'decimal-comma') return sep === ',' ? finish(parts[0], parts[1]) : finish(parts.join(''), '');
  if (separator === 'decimal-point') return sep === '.' ? finish(parts[0], parts[1]) : finish(parts.join(''), '');
  return { ambiguous: true, sep, asThousands: Number(parts.join('')) * (negative ? -1 : 1), asDecimal: Number(`${parts[0]}.${parts[1]}`) * (negative ? -1 : 1) };
}
const TRUE = new Set(['true', 'yes', 'y', '1', 'x', '✓', 'ja', 'oui', 'si', 'attached', 'checked']);
const FALSE = new Set(['false', 'no', 'n', '0', '', '-', 'none', 'missing', 'nein', 'non', 'unchecked']);
export function readBoolean(text) { const s = String(text).trim().toLowerCase(); return TRUE.has(s) ? { value: true } : FALSE.has(s) ? { value: false } : null; }

// ------------------------------------------------------------------------------------------------ mapping
// A header that names what is still owed ("Balance", "Amount due") beats a plain "Total" (column.prefer): a partly paid invoice must not
// be chased for its whole total.
const preferred = (header, column) => (column.prefer ?? []).map(norm).some(p => ` ${norm(header)} `.includes(` ${p} `));
function headerScore(header, column) {
  const h = norm(header), syn = [column.name, column.plain, ...(column.synonyms ?? [])].map(norm);
  if (syn.includes(h)) return 10 + (preferred(header, column) ? 2 : 0);
  if (syn.some(s => s.length > 2 && (` ${h} `.includes(` ${s} `)))) return 6 + (preferred(header, column) ? 2 : 0);
  if (syn.some(s => s.length > 3 && h.includes(s))) return 3;
  return 0;
}
function contentScore(values, column) {
  const v = values.filter(x => x !== '').slice(0, 50);
  if (!v.length) return 0;
  const share = f => v.filter(f).length / v.length;
  switch (column.type) {
    case 'email': return share(x => EMAIL.test(x)) > 0.8 ? 5 : 0;
    case 'date': return share(x => !!readDate(x)) > 0.8 ? 3 : 0;
    case 'datetime': return share(x => !!readDateTime(x)) > 0.8 ? 3 : 0;
    case 'number': return share(x => !!readNumber(x)) > 0.9 ? 2 : 0;
    case 'boolean': return share(x => !!readBoolean(x)) > 0.9 ? 2 : 0;
    case 'enum': return share(x => Object.values(column.values).some(val => val.synonyms.map(norm).includes(norm(x)))) > 0.3 ? 2 : 0;
    default: return 0;
  }
}
/** Which header is which needed column: the best unique match by name and content (a column with no plausible header stays unmapped). */
export function proposeMapping(spec, header, records) {
  const scored = [];
  spec.columns.forEach((c, ci) => header.forEach((h, hi) => {
    const nameScore = headerScore(h, c), content = contentScore(records.map(r => r[hi] ?? ''), c);
    const total = nameScore + content;
    if (nameScore > 0 || content >= 5) scored.push({ ci, hi, total });
  }));
  scored.sort((a, b) => b.total - a.total || a.hi - b.hi);
  const mapping = Object.fromEntries(spec.columns.map(c => [c.name, null])), usedH = new Set(), usedC = new Set();
  for (const s of scored) { if (usedH.has(s.hi) || usedC.has(s.ci)) continue; mapping[spec.columns[s.ci].name] = header[s.hi]; usedH.add(s.hi); usedC.add(s.ci); }
  return mapping;
}

// ------------------------------------------------------------------------------------------------ questions
const dateLabel = iso => { const [y, m, d] = iso.split('-').map(Number); return `${ordinal(d)} of ${MONTH_NAMES[m - 1]} ${y}`; };
const usLabel = iso => { const [y, m, d] = iso.split('-').map(Number); return `${MONTH_NAMES[m - 1]} ${ordinal(d)}, ${y}`; };
function enumReading(column, raw) {
  const n = norm(raw);
  for (const [value, v] of Object.entries(column.values)) if (v.synonyms.map(norm).includes(n) || norm(value) === n) return value;
  return null;
}
const listText = values => values.length === 1 ? `"${values[0]}"` : `${values.slice(0, -1).map(v => `"${v}"`).join(', ')} and "${values.at(-1)}"`;

/** The questions the mapped data needs before it can be converted: ids are stable ("dateOrder:due", "decimal:amount", "values:status"). */
export function questionsFor(spec, header, records, mapping) {
  const qs = [];
  for (const c of spec.columns) {
    // Two columns could be the one Foundry needs, and only one of them is what is still owed: ask (P2 walkthrough M2).
    if (c.prefer) {
      const named = header.filter(x => headerScore(x, c) >= 6);
      const owed = named.filter(x => preferred(x, c)), other = named.filter(x => !preferred(x, c));
      if (owed.length && other.length) qs.push({ id: `column:${c.name}`, kind: 'choice', column: c.name, harm: 'wrong-amounts', syncColumn: c.name,
        question: `Your file has ${listText([...other, ...owed])}. Which one is what the customer still owes?`,
        why: 'A customer who already paid part of an invoice would be asked for the whole total. Foundry will not guess it.', skip: 'Nothing is imported until you choose.',
        choices: [...owed, ...other].map(x => ({ value: x, label: x })) });
    }
    const h = mapping[c.name];
    if (!h) continue;
    const idx = header.indexOf(h), values = records.map(r => r[idx] ?? '').filter(v => v !== '');
    if (c.type === 'date') {
      const readings = values.map(v => readDate(v));
      const hasDmy = readings.some(r => r?.order === 'dmy'), hasMdy = readings.some(r => r?.order === 'mdy');
      const amb = readings.find(r => r?.ambiguous);
      if (amb && !hasDmy && !hasMdy) {
        const example = values[readings.indexOf(amb)];
        qs.push({ id: `dateOrder:${c.name}`, kind: 'choice', column: c.name, header: h, harm: 'wrong-dates',
          question: `Is ${example} the ${dateLabel(amb.dmy)} or ${usLabel(amb.mdy)}?`,
          why: `Your file writes dates both ways round, so the ${c.plain} could be wrong by months. Foundry will not guess it.`,
          skip: 'Nothing is imported until you choose.',
          choices: [{ value: 'dmy', label: `The ${dateLabel(amb.dmy)} (day first)` }, { value: 'mdy', label: `${usLabel(amb.mdy)} (month first)` }] });
      }
    }
    if (c.type === 'number') {
      const readings = values.map(v => readNumber(v));
      const amb = readings.find(r => r?.ambiguous);
      // Another value in the file can settle it: "12,50" (two decimals after a comma) shows a decimal comma.
      const settled = values.some(v => /\d,\d{1,2}$/.test(v.trim()) || /\d\.\d{3},/.test(v)) ? 'decimal-comma' : values.some(v => /\d\.\d{1,2}$/.test(v.trim()) || /\d,\d{3}\./.test(v)) ? 'decimal-point' : null;
      if (amb && !settled) {
        const example = values[readings.indexOf(amb)];
        qs.push({ id: `decimal:${c.name}`, kind: 'choice', column: c.name, header: h, harm: 'wrong-amounts',
          question: `Is ${example} ${amb.asThousands.toLocaleString('en-GB')} (a whole number), or ${amb.asDecimal} (with a decimal point)?`,
          why: `The ${c.plain} could be off by a factor of a thousand. Foundry will not guess it.`, skip: 'Nothing is imported until you choose.',
          choices: [{ value: amb.sep === ',' ? 'decimal-point' : 'decimal-comma', label: `${amb.asThousands.toLocaleString('en-GB')} (a whole number)` },
            { value: amb.sep === ',' ? 'decimal-comma' : 'decimal-point', label: `${amb.asDecimal} (with a decimal point)` }] });
      }
    }
    if (c.type === 'enum') {
      const distinct = [...new Map(values.map(v => [norm(v), v.trim()])).values()];
      const unknown = distinct.filter(v => !enumReading(c, v));
      if (unknown.length && c.ask) qs.push({ id: `values:${c.name}`, kind: 'many', column: c.name, header: h, harm: 'wrong-rows',
        question: c.ask.question.replace('{values}', listText(unknown)), why: c.ask.why, skip: 'Nothing is imported until you choose. Tick none if none of them do.',
        choices: unknown.map(v => ({ value: v, label: v })), means: c.ask.value, otherwise: c.ask.otherwise });
    }
    if (c.type === 'boolean') {
      const distinct = [...new Map(values.map(v => [norm(v), v.trim()])).values()];
      const unknown = distinct.filter(v => !readBoolean(v));
      if (unknown.length) qs.push({ id: `values:${c.name}`, kind: 'many', column: c.name, header: h, harm: 'wrong-rows',
        question: `Your file says ${listText(unknown)} under "${h}". Which of these mean yes (${c.plain})?`, why: 'Foundry will not guess what these words mean.',
        skip: 'Nothing is imported until you choose. Tick none if none of them do.', choices: unknown.map(v => ({ value: v, label: v })), means: true, otherwise: false });
    }
  }
  return qs;
}

/** What the drop shows before anything is written: columns, three sample rows, the proposed mapping, questions. */
export function preview({ template, sheet, text }) {
  const spec = sheetSpec(template, sheet);
  const table = readTable(text);
  const mapping = proposeMapping(spec, table.header, table.records);
  const needed = spec.columns.map(c => {
    const h = mapping[c.name], idx = h ? table.header.indexOf(h) : -1;
    return { name: c.name, plain: c.plain, type: c.type, optional: !!c.optional, header: h, samples: idx < 0 ? [] : table.records.map(r => r[idx]).filter(v => v !== '').slice(0, 3) };
  });
  const columnSamples = Object.fromEntries(table.header.map((h, i) => [h, table.records.map(r => r[i]).filter(v => v !== '').slice(0, 3)]));
  return { template, sheet, plain: spec.plain, rowNoun: spec.rowNoun, format: table.format, rowCount: table.records.length, columns: table.header, columnSamples,
    sample: table.records.slice(0, 3), mapping, needed, missing: needed.filter(n => !n.header && !n.optional).map(n => n.name),
    questions: questionsFor(spec, table.header, table.records, mapping),
    unused: table.header.filter(h => !Object.values(mapping).includes(h)) };
}

// ------------------------------------------------------------------------------------------------ money
// The currency comes from the header ("Amount due (EUR)") or the cells ("$480.00"); when neither says, the amount is written with two
// decimals and no sign rather than asked (one question fewer; the person reads every e-mail in full before any is made).
const CODES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'JPY', 'INR', 'ZAR', 'SGD', 'HKD'];
const SIGNS = { '€': 'EUR', '£': 'GBP', '$': 'USD', '¥': 'JPY', '₹': 'INR' };
/** The currency a header or its cells name, or null. */
export function currencyOf(header, values = []) {
  const find = t => { const code = String(t).toUpperCase().match(new RegExp(`\\b(${CODES.join('|')})\\b`)); if (code) return code[1]; const sign = [...String(t)].find(ch => SIGNS[ch]); return sign ? SIGNS[sign] : null; };
  return find(header) ?? values.slice(0, 50).map(find).find(Boolean) ?? null;
}
/** €1,240.00 / $480.00 / 75.50 (two decimals, the currency's own sign). */
export function moneyText(value, currency) {
  if (!currency || currency === 'none') return value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(value); }
  catch { return `${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`; }
}

/** Typed rows from the mapping and the answers. Throws CSV_UNANSWERED while a question is open, CSV_MAPPING for a missing column. */
export function convert({ template, sheet, text, mapping: given, answers = {} }) {
  const spec = sheetSpec(template, sheet);
  const table = readTable(text);
  if (!given || typeof given !== 'object') throw new FoundryError('CSV_MAPPING', 'Say which column is which first');
  // An answer to "which of these columns is it?" is the mapping for that column.
  const mapping = { ...given };
  for (const c of spec.columns) { const a = answers[`column:${c.name}`]; if (typeof a === 'string' && table.header.includes(a)) mapping[c.name] = a; }
  for (const [name, h] of Object.entries(mapping)) {
    if (!spec.columns.some(c => c.name === name)) throw new FoundryError('CSV_MAPPING', `Unknown column ${String(name).slice(0, 40)}`);
    if (h !== null && !table.header.includes(h)) throw new FoundryError('CSV_MAPPING', `The file has no column "${String(h).slice(0, 60)}"`);
  }
  const missing = spec.columns.filter(c => !c.optional && !mapping[c.name]);
  if (missing.length) throw new FoundryError('CSV_MAPPING', `Say which column is the ${missing.map(c => c.plain).join(', the ')}`);
  const open = questionsFor(spec, table.header, table.records, mapping).filter(q => answers[q.id] === undefined || answers[q.id] === null);
  if (open.length) throw Object.assign(new FoundryError('CSV_UNANSWERED', `Answer first: ${open.map(q => q.question).join(' ')}`), { questions: open });
  const skipped = { noEmail: 0, unreadable: 0 }, problems = [];
  const rows = [];
  const currency = Object.fromEntries(spec.columns.filter(c => c.money === 'text' && mapping[c.name]).map(c => {
    const idx = table.header.indexOf(mapping[c.name]);
    return [c.name, currencyOf(mapping[c.name], table.records.map(r => r[idx] ?? '').filter(Boolean))];
  }));
  table.records.forEach((rec, ri) => {
    const row = {}; let bad = null;
    for (const c of spec.columns) {
      const h = mapping[c.name];
      if (!h) { if (c.missing !== undefined) row[c.name] = c.missing; continue; }
      const raw = rec[table.header.indexOf(h)] ?? '';
      if (raw === '' && c.missing !== undefined) { row[c.name] = c.missing; continue; }
      let v;
      switch (c.type) {
        case 'email': { const e = raw.trim().toLowerCase().replace(/^mailto:/, ''); v = EMAIL.test(e) ? e : ''; if (!v) skipped.noEmail++; break; }
        case 'date': { const d = raw ? readDate(raw, answers[`dateOrder:${c.name}`] ?? null) : null; if (raw && !d?.iso) bad = `the ${c.plain} "${raw.slice(0, 30)}"`; v = d?.iso ?? ''; break; }
        case 'datetime': { const d = raw ? readDateTime(raw) : null; if (raw && !d?.iso) bad = `the ${c.plain} "${raw.slice(0, 30)}"`; v = d?.iso ?? ''; break; }
        case 'number': { const n = raw ? readNumber(raw, answers[`decimal:${c.name}`] ?? null) : null; if (raw && (!n || n.ambiguous)) bad = `the ${c.plain} "${raw.slice(0, 30)}"`; v = n?.value ?? null;
          if (c.money === 'text' && typeof v === 'number') v = moneyText(v, currency[c.name]); break; }
        case 'boolean': { const b = readBoolean(raw); v = b ? b.value : (answers[`values:${c.name}`] ?? []).includes(raw.trim()); break; }
        case 'enum': { v = enumReading(c, raw) ?? ((answers[`values:${c.name}`] ?? []).some(x => norm(x) === norm(raw)) ? c.ask.value : c.ask.otherwise); break; }
        default: v = raw;
      }
      row[c.name] = v;
    }
    if (bad) { skipped.unreadable++; if (problems.length < 5) problems.push(`Row ${ri + 2}: Foundry could not read ${bad}, so the row was left out.`); return; }
    rows.push(row);
  });
  return { rows, kept: spec.columns.filter(c => mapping[c.name]).map(c => c.name), dropped: table.header.filter(h => !Object.values(mapping).includes(h)), skipped, problems };
}
