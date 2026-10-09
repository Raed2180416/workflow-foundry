// The NOVEL formats of the R5 catalogue: drawn only at d5, never at d <= 4. The pool is split by task split, so a
// held-out (test) d5 task carries a format that no dev task at any difficulty carries (W-BED §3.5 "at d5 a format never
// seen in dev appears, which forces the fallback").
//   novel-dev  (split dev, d5):  column-store, print-image
//   novel-test (split test, d5): hex-masked, tagged-dictionary
import { ROW_FIELDS, majorText, parseMajor, utf8Hex, hexUtf8 } from '../lib/legacy.mjs';
import { SYS_CODE, sysName, CODE_LIST, kvPairs, parseKv, readmeHead, trailerSentence, finish, linesOf } from './common.mjs';

// =====================================================================================================================
// CO  column store: one file per field, line n of every file is record n; MANIFEST.TXT says which file holds which field.
const CO_LABEL = { type: 'record type', invoice: 'invoice number', system: 'billing-system name', row: 'customer row id', date_text: 'printed invoice date',
  currency: 'currency', amount_minor: 'amount in the smallest currency unit', status_text: 'status text' };
const CO_COLS = ['type', ...ROW_FIELDS];
export const COLUMN_STORE = {
  id: 'column-store', name: 'column store: one file per field, aligned by line number, with a manifest', tier: 'novel-dev', grade: 2,
  layoutWhere: 'MANIFEST.TXT (file -> field) + README',
  mistake: { name: 'manifest-ignored', why: 'the record-type file found by its D/V/T values, but the other column files taken in file-number order as invoice, system, row, date, currency, amount, status instead of the manifest\'s assignment' },
  encode({ records, trailer, r, sub, vague }) {
    let num;
    do num = Object.fromEntries(r.shuffle([1, 2, 3, 4, 5, 6, 7, 8]).map((n, i) => [CO_COLS[i], n]));
    while (ROW_FIELDS.slice().sort((a, b) => num[a] - num[b]).join() === ROW_FIELDS.join());
    const fname = c => `col${String(num[c]).padStart(2, '0')}.txt`;
    const files = {};
    for (const c of CO_COLS) {
      const vals = records.map(x => (c === 'type' ? (x.kind === 'row' ? 'D' : 'V') : String(x.row[c])));
      vals.push(c === 'type' ? `T ${kvPairs(trailer).map(([k, v]) => `${k}=${v}`).join(' ')}` : '');
      files[fname(c)] = vals.join('\n');
    }
    files['MANIFEST.TXT'] = ['COLUMN-STORE EXPORT, receivables extract. One file per field; line n of every file belongs to record n.',
      ...CO_COLS.slice().sort((a, b) => num[a] - num[b]).map(c => `${fname(c)}  ${CO_LABEL[c]}`)].join('\n');
    files['README.TXT'] = [
      readmeHead(sub, 'LEGACY RECEIVABLES DUMP (COLUMN STORE)', vague), '',
      'The archive stores each field in its own file (colNN.txt); MANIFEST.TXT says which file holds which field. Line n of every file belongs to record n.',
      'Dates and status texts are as the billing systems printed them; system names are full names; amounts are in the currency\'s smallest unit.', '',
      vague === 0 ? 'Record type: D is an invoice; V is a void copy (not an invoice of the ledger); T, on the last line, is the trailer as KEY=value pairs (the other files are empty on that line).'
        : 'Record types D (invoice), V (void copy), T (trailer, KEY=value pairs, last line).', '',
      trailerSentence('the T line of the record-type file', vague),
    ].join('\n');
    return { files, params: { num } };
  },
  decode(files, { keepExtras = false, mistake = null } = {}) {
    const which = {};
    for (const m of String(files['MANIFEST.TXT'] ?? '').matchAll(/^(col\d+\.txt)\s+(.+)$/gm)) {
      const c = CO_COLS.find(x => CO_LABEL[x] === m[2].trim());
      if (c) which[c] = m[1];
    }
    if (mistake === COLUMN_STORE.mistake.name) {
      const names = Object.keys(files).filter(f => /^col\d+\.txt$/.test(f)).sort();
      const typeFile = names.find(f => linesOf(files[f]).every(v => /^(D|V|T( .*)?)$/.test(v)));
      const rest = names.filter(f => f !== typeFile);
      for (const k of Object.keys(which)) delete which[k];
      which.type = typeFile;
      ROW_FIELDS.forEach((f, i) => { which[f] = rest[i]; });
    }
    const col = Object.fromEntries(CO_COLS.map(c => [c, linesOf(files[which[c]])]));
    const rows = [];
    let trailer = null;
    col.type.forEach((ty, i) => {
      if (ty.startsWith('T')) { trailer = parseKv(ty.slice(1)); return; }
      if (!(ty === 'D' || (ty === 'V' && keepExtras))) return;
      const g = f => col[f][i] ?? '';
      rows.push({ invoice: g('invoice'), system: g('system'), row: Number(g('row')), date_text: g('date_text'), currency: g('currency'), amount_minor: Number(g('amount_minor')), status_text: g('status_text') });
    });
    return finish(rows, trailer);
  },
};

// =====================================================================================================================
// PI  a print-image register: paged, column headings repeated per page, ditto marks (") for a system, date or currency
// equal to the line above on the same page, page-total lines that are not records, struck lines marked "*", and a
// control-totals block at the end.
const PI_COLS = [['invoice', 'INVOICE'], ['system', 'SYS'], ['row', 'CUST ROW'], ['date_text', 'INV DATE (PRINTED)'], ['currency', 'CCY'], ['amount_minor', 'AMOUNT'], ['status_text', 'STATUS']];
const PI_DITTO = new Set(['system', 'date_text', 'currency']);
const PI_RIGHT = new Set(['row', 'amount_minor']);
const piText = (f, row) => (f === 'system' ? SYS_CODE[row.system] : f === 'amount_minor' ? majorText(row.amount_minor, row.currency, { group: true }) : String(row[f]));
export const PRINT_IMAGE = {
  id: 'print-image', name: 'paged print-image register with ditto marks and page totals', tier: 'novel-dev', grade: 2,
  layoutWhere: 'the printed column headings and rulers on every page + README',
  mistake: { name: 'ditto-literal', why: 'ditto marks (") read as values: every system, date or currency that repeats the line above comes out as a quote mark' },
  encode({ records, trailer, r, sub, vague }) {
    const sysOrder = [...new Set(records.map(x => x.row.system))];
    const sorted = sysOrder.flatMap(s => records.filter(x => x.row.system === s));
    const w = Object.fromEntries(PI_COLS.map(([f, label]) => [f, Math.max(label.length, ...sorted.map(x => piText(f, x.row).length))]));
    const P = r.int(14, 20);
    const title = `HOLLIN ${sub.short.replace(/^Hollin /, '').toUpperCase()} - RECEIVABLES REGISTER (ARCHIVE REPRINT)`;
    const out = [];
    const cell = (f, s) => (PI_RIGHT.has(f) ? s.padStart(w[f]) : s.padEnd(w[f]));
    for (let p = 0; p * P < sorted.length; p++) {
      const page = sorted.slice(p * P, (p + 1) * P);
      out.push(`${title.padEnd(78)}PAGE ${String(p + 1).padStart(3)}`, '');
      out.push(('  ' + PI_COLS.map(([f, l]) => l.padEnd(w[f])).join('  ')).trimEnd());
      out.push('  ' + PI_COLS.map(([f]) => '-'.repeat(w[f])).join('  '));
      let prev = null;
      const tot = {};
      for (const x of page) {
        const vals = PI_COLS.map(([f]) => (prev && PI_DITTO.has(f) && prev[f] === x.row[f] ? cell(f, '"') : cell(f, piText(f, x.row))));
        out.push(`${x.kind === 'row' ? ' ' : '*'} ${vals.join('  ')}`.trimEnd());
        prev = x.row;
        if (x.kind === 'row') tot[x.row.currency] = (tot[x.row.currency] ?? 0) + x.row.amount_minor;
      }
      for (const c of Object.keys(tot).sort()) out.push(`  PAGE TOTAL  ${c}  ${majorText(tot[c], c, { group: true })}`);
      out.push('');
    }
    const t = trailer;
    out.push('*** CONTROL TOTALS', `*** RECORDS ${t.records}`, `*** ROW TOTAL ${t.row_total}`, ...Object.entries(t.amounts).map(([c, m]) => `*** AMOUNT ${c} ${majorText(m, c, { group: true })}`),
      `*** HASH INVOICE ${t.hash.invoice}`, `*** HASH SYSTEM ${t.hash.system}`, `*** HASH DATE ${t.hash.date_text}`, `*** HASH STATUS ${t.hash.status_text}`, '*** END OF REPORT');
    const readme = [
      readmeHead(sub, 'LEGACY RECEIVABLES DUMP (PRINT IMAGE)', vague), '',
      'File: REGISTER.LST, the receivables register as it was printed (an archive reprint). Each page repeats the title, the column headings and a ruler line of dashes under each column.', '',
      vague === 0 ? `Columns: INVOICE invoice number; SYS billing-system code (${CODE_LIST}); CUST ROW customer row id; INV DATE (PRINTED) the invoice date as the billing system printed it; CCY currency; AMOUNT in whole units with thousands separators (yen have no decimals); STATUS status text. A double quote (") in SYS, INV DATE or CCY means "same as the line above" on that page. A line with "*" in the first column was struck before printing and is not an invoice of the ledger. PAGE TOTAL lines are not records.`
        : `Usual register print: SYS codes ${CODE_LIST}; ditto marks where a value repeats the line above; "*" in column 1 marks struck lines; PAGE TOTAL lines are subtotals.`, '',
      trailerSentence('the "***" block at the end', vague),
    ].join('\n');
    return { files: { 'README.TXT': readme, 'REGISTER.LST': out.join('\n') }, params: { P } };
  },
  decode(files, { keepExtras = false, mistake = null } = {}) {
    const lines = linesOf(files['REGISTER.LST']);
    const literal = mistake === PRINT_IMAGE.mistake.name;
    const rows = [];
    const t = { amounts: {}, hash: {} };
    let spans = null, inPage = false, prev = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('***')) {
        let m;
        if ((m = line.match(/^\*\*\* RECORDS (\d+)/))) t.records = Number(m[1]);
        else if ((m = line.match(/^\*\*\* ROW TOTAL (\d+)/))) t.row_total = Number(m[1]);
        else if ((m = line.match(/^\*\*\* AMOUNT ([A-Z]{3}) (\S+)/))) t.amounts[m[1]] = parseMajor(m[2], m[1]);
        else if ((m = line.match(/^\*\*\* HASH (INVOICE|SYSTEM|DATE|STATUS) (\d+)/))) t.hash[{ INVOICE: 'invoice', SYSTEM: 'system', DATE: 'date_text', STATUS: 'status_text' }[m[1]]] = Number(m[2]);
        continue;
      }
      if (/^\s+-+(\s+-+)*$/.test(line) && i > 0) {
        const head = lines[i - 1];
        spans = [];
        for (const m of line.matchAll(/-+/g)) {
          const label = head.slice(m.index, m.index + m[0].length).trim();
          const f = PI_COLS.find(([, l]) => l === label)?.[0];
          spans.push({ f, start: m.index, end: m.index + m[0].length });
        }
        inPage = true; prev = null; continue;
      }
      if (!inPage) continue;
      if (!line.trim() || line.startsWith('  PAGE TOTAL')) { if (!line.trim()) inPage = false; continue; }
      const v = {};
      spans.forEach((s, k) => { v[s.f] = (k === spans.length - 1 ? line.slice(s.start) : line.slice(s.start, s.end)).trim(); });
      if (!literal && prev) for (const f of PI_DITTO) if (v[f] === '"') v[f] = prev[f];
      prev = v;
      if (line[0] === '*' && !keepExtras) continue;
      rows.push({ invoice: v.invoice, system: sysName(v.system), row: Number(v.row), date_text: v.date_text, currency: v.currency, amount_minor: parseMajor(v.amount_minor, v.currency), status_text: v.status_text });
    }
    const trailer = t.records === undefined ? null
      : { records: t.records, row_total: t.row_total, amounts: Object.fromEntries(Object.keys(t.amounts).sort().map(c => [c, t.amounts[c]])), hash: t.hash };
    return finish(rows, trailer);
  },
};

// =====================================================================================================================
// HX  hex records: each record is "<type> <hex>", the hex being the UTF-8 bytes of the fields joined by the unit
// separator (byte 1F), every byte XOR-ed with a site mask stated in the README.
const US = '\u001f';
export const HEX_MASKED = {
  id: 'hex-masked', name: 'hex-encoded UTF-8 records with an XOR mask', tier: 'novel-test', grade: 2,
  layoutWhere: 'README prose (the mask byte, the separator byte, field order)',
  mistake: { name: 'mask-not-removed', why: 'the hex decoded as UTF-8 without removing the XOR mask: the bytes are not the text, nothing splits on the separator, and the records come out as one garbled field each' },
  encode({ records, trailer, r, sub, vague }) {
    const mask = r.int(0x21, 0xEE);
    const lines = records.map(x => `${x.kind === 'row' ? 'D' : 'V'} ${utf8Hex([x.row.invoice, SYS_CODE[x.row.system], x.row.row, x.row.date_text, x.row.currency, x.row.amount_minor, x.row.status_text].join(US), mask)}`);
    lines.push(`T ${utf8Hex(kvPairs(trailer).map(([k, v]) => `${k}=${v}`).join(US), mask)}`);
    const m = mask.toString(16).toUpperCase().padStart(2, '0');
    const readme = [
      readmeHead(sub, 'LEGACY RECEIVABLES DUMP (HEX RECORDS)', vague), '',
      'File: DUMP.HEX. One record per line: the record type, a blank, then the record as hexadecimal byte pairs.',
      vague === 0 ? `Each byte of a record was XOR-ed with the site mask 0x${m} before it was written. Unmasked, the bytes are UTF-8 text; the fields are separated by the unit-separator byte (1F hexadecimal).`
        : `Records are UTF-8, fields separated by the unit separator, every byte masked (XOR) with the site key 0x${m}.`,
      `Fields, in order: invoice number, billing-system code (${CODE_LIST}), customer row id, invoice date as printed, currency, amount in the smallest currency unit, status text.`, '',
      'Types: D invoice; V void copy (not an invoice of the ledger); T trailer (KEY=value fields).', '',
      trailerSentence('the T record', vague),
    ].join('\n');
    return { files: { 'README.TXT': readme, 'DUMP.HEX': lines.join('\n') }, params: { mask } };
  },
  decode(files, { keepExtras = false, mistake = null } = {}) {
    const mask = mistake === HEX_MASKED.mistake.name ? 0 : parseInt((String(files['README.TXT'] ?? '').match(/0x([0-9A-F]{2})/) ?? [])[1] ?? '0', 16);
    const rows = [];
    let trailer = null;
    for (const line of linesOf(files['DUMP.HEX'])) {
      const m = line.match(/^([DVT]) ([0-9A-F]*)$/);
      if (!m) continue;
      const p = hexUtf8(m[2], mask).split(US);
      if (m[1] === 'T') { trailer = parseKv(p.join(' ')); continue; }
      if (m[1] === 'V' && !keepExtras) continue;
      rows.push({ invoice: p[0], system: sysName(p[1] ?? ''), row: Number(p[2]), date_text: p[3], currency: p[4], amount_minor: Number(p[5]), status_text: p[6] });
    }
    return finish(rows, trailer);
  },
};

// =====================================================================================================================
// TD  tagged records with numbered field tags whose meaning is in a dictionary file (per-task numbering), character
// entities for non-ASCII text.
const TD_LABEL = { invoice: 'invoice number', system: 'billing-system code', row: 'customer row id', date_text: 'printed invoice date', currency: 'currency',
  amount_minor: 'amount (smallest currency unit)', status_text: 'status text' };
const ent = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[^\x20-\x7e]/gu, c => `&#x${c.codePointAt(0).toString(16).toUpperCase()};`);
const unent = s => String(s).replace(/&#x([0-9A-F]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
export const TAGGED_DICTIONARY = {
  id: 'tagged-dictionary', name: 'tagged records with numbered field tags and a field dictionary', tier: 'novel-test', grade: 2,
  layoutWhere: 'FIELDS.DIC (tag number -> field) + README',
  mistake: { name: 'dictionary-ignored', why: 'the dictionary not read: tags F1..F7 assumed to be invoice, system, row, date, currency, amount, status in that order' },
  encode({ records, trailer, r, sub, vague }) {
    let num;
    do num = Object.fromEntries(r.shuffle([1, 2, 3, 4, 5, 6, 7]).map((n, i) => [ROW_FIELDS[i], n])); while (ROW_FIELDS.every((f, i) => num[f] === i + 1));
    const val = (f, row) => (f === 'system' ? SYS_CODE[row.system] : row[f]);
    const lines = ['<!DOCTYPE RECEIVABLES SYSTEM "FIELDS.DIC">', '<EXTRACT>'];
    for (const x of records) {
      const fs = r.shuffle(ROW_FIELDS).map(f => `<F${num[f]}>${ent(val(f, x.row))}</F${num[f]}>`).join('');
      lines.push(`<R T="${x.kind === 'row' ? 'D' : 'V'}">${fs}</R>`);
    }
    lines.push(`<CONTROL ${kvPairs(trailer).map(([k, v]) => `${k}=${v}`).join(' ')}>`, '</EXTRACT>');
    const dic = ['FIELD DICTIONARY (tag, meaning)', ...ROW_FIELDS.slice().sort((a, b) => num[a] - num[b]).map(f => `F${num[f]}  ${TD_LABEL[f]}`)].join('\n');
    const readme = [
      readmeHead(sub, 'LEGACY RECEIVABLES DUMP (TAGGED EXPORT)', vague), '',
      'Files: EXPORT.SGM (one <R> element per line), FIELDS.DIC (what each numbered field tag holds).',
      `Text uses character references for anything outside printable ASCII (&#x....;) and &amp; &lt; &gt;. Billing-system codes: ${CODE_LIST}. Dates and status texts are as printed by the billing systems.`, '',
      vague === 0 ? 'R elements with T="D" are invoices; T="V" marks a void copy (not an invoice of the ledger). The CONTROL element is the trailer (KEY=value attributes).'
        : 'T="D" invoices, T="V" void copies; CONTROL is the trailer.', '',
      trailerSentence('the CONTROL element', vague),
    ].join('\n');
    return { files: { 'README.TXT': readme, 'FIELDS.DIC': dic, 'EXPORT.SGM': lines.join('\n') }, params: { num } };
  },
  decode(files, { keepExtras = false, mistake = null } = {}) {
    const fieldOf = {};
    if (mistake === TAGGED_DICTIONARY.mistake.name) ROW_FIELDS.forEach((f, i) => { fieldOf[i + 1] = f; });
    else for (const m of String(files['FIELDS.DIC'] ?? '').matchAll(/^F(\d+)\s+(.+)$/gm)) { const f = ROW_FIELDS.find(x => TD_LABEL[x] === m[2].trim()); if (f) fieldOf[Number(m[1])] = f; }
    const rows = [];
    let trailer = null;
    for (const line of linesOf(files['EXPORT.SGM'])) {
      let m;
      if (line.startsWith('<CONTROL ')) { trailer = parseKv(line); continue; }
      if (!(m = line.match(/^<R T="([DV])">(.*)<\/R>$/))) continue;
      if (m[1] === 'V' && !keepExtras) continue;
      const v = {};
      for (const g of m[2].matchAll(/<F(\d+)>(.*?)<\/F\1>/g)) v[fieldOf[Number(g[1])]] = unent(g[2]);
      rows.push({ invoice: v.invoice, system: sysName(v.system ?? ''), row: Number(v.row), date_text: v.date_text, currency: v.currency, amount_minor: Number(v.amount_minor), status_text: v.status_text });
    }
    return finish(rows, trailer);
  },
};

export const NOVEL_DEV_FORMATS = [COLUMN_STORE, PRINT_IMAGE];
export const NOVEL_TEST_FORMATS = [HEX_MASKED, TAGGED_DICTIONARY];
