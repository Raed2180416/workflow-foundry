// The four DEV formats of the R5 catalogue: the formats the structure-necessity control has code parsers for (W-BED
// §2.4 item 3, "the R4 reference with code parsers for the dev formats only"). Each: a deterministic encoder from R1
// invoice rows (plus extra records and the trailer) to text files with README prose, and the bed's white-box decoder.
import { ROW_FIELDS, majorText, parseMajor, numberWord, parseNumberWord, csvField, parseCsvLine, unitOf } from '../lib/legacy.mjs';
import { SYS_CODE, sysName, CODE_LIST, kvPairs, parseKv, readmeHead, trailerSentence, finish, linesOf, esc } from './common.mjs';

// =====================================================================================================================
// FW  fixed width, layout only in prose. Field order and widths are drawn per task; the README states them as a
// column list (vagueness 0), as sentences (1) or as widths in words in field order (2).
const FW_LABEL = { invoice: 'invoice number', system: 'billing-system code', row: 'customer row id', date_text: 'printed invoice date',
  currency: 'currency code', amount_minor: 'amount', status_text: 'status text' };
const FW_NUMERIC = new Set(['row', 'amount_minor']);
const fwText = (f, row) => (f === 'system' ? SYS_CODE[row.system] ?? row.system : String(row[f]));

export const FIXED_WIDTH = {
  id: 'fixed-width', name: 'fixed-width records, layout described only in README prose', tier: 'dev', grade: 1,
  layoutWhere: 'README prose only (column ranges, sentences, or widths in words by vagueness)',
  mistake: { name: 'fixed-width-off-by-one', why: 'the README\'s 1-based column numbers read as 0-based offsets: every field is cut one column late (loses its first character, gains the next field\'s first)' },
  encode({ records, trailer, r, sub, vague }) {
    const order = r.shuffle(ROW_FIELDS);
    const width = {}, pos = {};
    let p = 2;
    for (const f of order) {
      const max = Math.max(...records.map(x => fwText(f, x.row).length));
      width[f] = f === 'system' ? 2 + r.int(0, 1) : max + (FW_NUMERIC.has(f) ? r.int(1, 3) : r.int(0, 3));
      pos[f] = [p, p + width[f] - 1]; p += width[f];
    }
    const line = (type, row) => type + order.map(f => (FW_NUMERIC.has(f) ? String(row[f]).padStart(width[f], '0') : fwText(f, row).padEnd(width[f]))).join('');
    const lines = records.map(x => line(x.kind === 'row' ? 'D' : 'X', x.row));
    lines.push(`T ${kvPairs(trailer).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    let layout;
    if (vague === 0) layout = ['Column 1: record type.', ...order.map(f => `columns ${pos[f][0]}-${pos[f][1]}  ${FW_LABEL[f]}`)].join('\n');
    else if (vague === 1) layout = `Each line starts with the record type in column 1. ${order.map(f => `The ${FW_LABEL[f]} is in columns ${pos[f][0]} to ${pos[f][1]}.`).join(' ')}`;
    else layout = `A record is one line: a one-character record type, followed by ${order.map((f, i) => `${i === order.length - 1 ? 'and finally ' : i ? 'then ' : ''}the ${FW_LABEL[f]} (${numberWord(width[f])} characters)`).join(', ')}. Nothing separates the fields.`;
    const readme = [
      readmeHead(sub, 'LEGACY RECEIVABLES DUMP (FIXED-WIDTH)', vague), '',
      'File: INVDUMP.DAT, one record per line, fixed width; columns are counted from 1.', '',
      'RECORD LAYOUT', layout,
      `Numbers (the customer row id and the amount) are right-aligned and zero-padded; the amount is in the currency's smallest unit (cents; yen have no smaller unit). Text fields are left-aligned and padded with blanks on the right. Billing-system codes: ${CODE_LIST}.`, '',
      'RECORD TYPES',
      vague === 0 ? 'D is an invoice. X is a record deleted after the extract ran: it is still in the file but is not an invoice of the ledger. T is the trailer (last line).'
        : vague === 1 ? 'Invoices are D records. X records were deleted after the run and only look like invoices. The last line, type T, is the trailer.'
          : 'D = invoice. X = purged by the nightly clean-up after the run (the purge does not compact the file). T = trailer.', '',
      'TRAILER', trailerSentence('the T record, written as KEY=value pairs after the type', vague),
    ].join('\n');
    return { files: { 'README.TXT': readme, 'INVDUMP.DAT': lines.join('\n') }, params: { order, width, pos } };
  },
  decode(files, { keepExtras = false, mistake = null } = {}) {
    const readme = files['README.TXT'] ?? '';
    const sec = readme.slice(readme.indexOf('RECORD LAYOUT'), readme.indexOf('RECORD TYPES'));
    const pos = {};
    for (const f of ROW_FIELDS) {
      const L = esc(FW_LABEL[f]);
      const m = sec.match(new RegExp(`columns (\\d+)-(\\d+)\\s+${L}`)) ?? sec.match(new RegExp(`${L} is in columns (\\d+) to (\\d+)`));
      if (m) pos[f] = [Number(m[1]), Number(m[2])];
    }
    if (Object.keys(pos).length < ROW_FIELDS.length) {
      const labels = Object.values(FW_LABEL).map(esc).join('|');
      let p = 2;
      for (const m of sec.matchAll(new RegExp(`the (${labels}) \\(([a-z-]+) characters?\\)`, 'g'))) {
        const f = ROW_FIELDS.find(x => FW_LABEL[x] === m[1]), w = parseNumberWord(m[2]);
        pos[f] = [p, p + w - 1]; p += w;
      }
    }
    const sh = mistake === FIXED_WIDTH.mistake.name ? 1 : 0;
    const rows = [];
    let trailer = null;
    for (const line of linesOf(files['INVDUMP.DAT'])) {
      const ty = line[0];
      if (ty === 'T') { trailer = parseKv(line.slice(1)); continue; }
      if (!(ty === 'D' || (ty === 'X' && keepExtras))) continue;
      const get = f => (pos[f] ? line.slice(pos[f][0] - 1 + sh, pos[f][1] + sh) : '');
      rows.push({ invoice: get('invoice').trim(), system: sysName(get('system').trim()), row: Number(get('row')), date_text: get('date_text').trim(),
        currency: get('currency').trim(), amount_minor: Number(get('amount_minor')), status_text: get('status_text').trim() });
    }
    return finish(rows, trailer);
  },
};

// =====================================================================================================================
// CP  a site code page given as an escape table. Every character except digits, the field separator and the record
// type letter is written as ^HH; CODEPAGE.TXT maps each HH to a Unicode code point (a per-task shuffle). The trailer is
// positional (digits only, currencies escaped like any letter).
const hex2 = n => n.toString(16).toUpperCase().padStart(2, '0');
export const CODE_PAGE = {
  id: 'code-page', name: 'pipe-delimited text in a site code page given as an escape table', tier: 'dev', grade: 1,
  layoutWhere: 'CODEPAGE.TXT (escape table) + README (field order, record types, trailer positions)',
  mistake: { name: 'codepage-standard', why: 'the ^HH escapes read as Latin-1 (the standard code page) instead of the site table: every letter of every text field (and the currency codes) is wrong; digits and the counts are right' },
  encode({ records, trailer, r, sub, vague }) {
    const plain = records.map(x => [x.kind === 'row' ? 'D' : 'S', x.row.invoice, SYS_CODE[x.row.system], x.row.row, x.row.date_text, x.row.currency, x.row.amount_minor, x.row.status_text].join('|'));
    const am = Object.entries(trailer.amounts).map(([c, v]) => `${c}:${v}`).join(';');
    plain.push(['Z', trailer.records, trailer.row_total, am, trailer.hash.invoice, trailer.hash.system, trailer.hash.date_text, trailer.hash.status_text].join('|'));
    const chars = [...new Set(plain.flatMap(l => [...l.slice(1)]).filter(c => !/[0-9|]/.test(c)))].sort();
    const codes = r.shuffle(Array.from({ length: 0xFE - 0x21 + 1 }, (_, i) => 0x21 + i).filter(c => c !== 0x7F));
    const code = new Map();
    chars.forEach((c, i) => code.set(c, codes[i]));
    // No escape may decode to its own character under Latin-1 (the misreading must change every escaped character).
    for (const c of chars) {
      if (String.fromCharCode(code.get(c)) !== c) continue;
      const other = chars.find(o => o !== c && String.fromCharCode(code.get(o)) !== c && String.fromCharCode(code.get(c)) !== o);
      const t = code.get(c); code.set(c, code.get(other)); code.set(other, t);
    }
    const enc = l => l[0] + l.slice(1).replace(/[^0-9|]/gu, ch => `^${hex2(code.get(ch))}`);
    const table = [...code.entries()].sort((a, b) => a[1] - b[1])
      .map(([c, n]) => `^${hex2(n)}  U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}  ${c === ' ' ? '(space)' : c}`);
    const cpName = `SITE-${r.int(100, 899)}`;
    const readme = [
      readmeHead(sub, 'LEGACY RECEIVABLES DUMP (SITE CODE PAGE)', vague), '',
      'Files: EXPORT.TXT (one record per line), CODEPAGE.TXT (the escape table).', '',
      vague === 0 ? `The extract writes text in the site's own code page ${cpName}. In EXPORT.TXT every character other than a digit, the field separator "|" and the record type letter in the first position is written as an escape ^HH (two hexadecimal digits). CODEPAGE.TXT gives, for each escape, the Unicode code point of the character it stands for. It is not a standard code page.`
        : vague === 1 ? `Text is in code page ${cpName} (site-specific): apart from digits, "|" and the leading record type, characters appear as ^HH escapes, which CODEPAGE.TXT translates.`
          : `Written on the old terminal server, code page ${cpName}; escapes ^HH per CODEPAGE.TXT (the terminal's own table). Digits, "|" and the record type are not escaped.`, '',
      `Fields, in order: record type | invoice number | billing-system code | customer row id | printed invoice date | currency code | amount in the currency's smallest unit | status text. Billing-system codes: ${CODE_LIST}.`, '',
      vague === 0 ? 'Record types: D is an invoice; S is a record struck out after the run (not an invoice of the ledger); Z is the trailer.'
        : vague === 1 ? 'D records are invoices, S records were struck out after the run, and the Z record is the trailer.'
          : 'D invoice / S struck / Z trailer.', '',
      trailerSentence('the Z record: count | row-id sum | currency:total pairs separated by ";" | hash invoice | hash system | hash date | hash status', vague),
    ].join('\n');
    return { files: { 'README.TXT': readme, 'CODEPAGE.TXT': [`CODE PAGE ${cpName}: escape, Unicode code point, character`, ...table].join('\n'), 'EXPORT.TXT': plain.map(enc).join('\n') }, params: { cpName } };
  },
  decode(files, { keepExtras = false, mistake = null } = {}) {
    const table = new Map();
    for (const m of String(files['CODEPAGE.TXT'] ?? '').matchAll(/^\^([0-9A-F]{2})\s+U\+([0-9A-F]{4,6})/gm)) table.set(m[1], String.fromCodePoint(parseInt(m[2], 16)));
    const std = mistake === CODE_PAGE.mistake.name;
    const dec = s => s.replace(/\^([0-9A-F]{2})/g, (_, h) => (std ? String.fromCharCode(parseInt(h, 16)) : table.get(h) ?? '?'));
    const rows = [];
    let trailer = null;
    for (const line of linesOf(files['EXPORT.TXT'])) {
      const ty = line[0], p = dec(line.slice(1)).split('|').slice(1);
      if (ty === 'Z') {
        const amounts = {};
        for (const kv of (p[2] ?? '').split(';')) { const [c, v] = kv.split(':'); if (c) amounts[c] = Number(v); }
        trailer = { records: Number(p[0]), row_total: Number(p[1]), amounts: Object.fromEntries(Object.keys(amounts).sort().map(c => [c, amounts[c]])),
          hash: { invoice: Number(p[3]), system: Number(p[4]), date_text: Number(p[5]), status_text: Number(p[6]) } };
        continue;
      }
      if (!(ty === 'D' || (ty === 'S' && keepExtras))) continue;
      rows.push({ invoice: p[0], system: sysName(p[1]), row: Number(p[2]), date_text: p[3], currency: p[4], amount_minor: Number(p[5]), status_text: p[6] });
    }
    return finish(rows, trailer);
  },
};

// =====================================================================================================================
// JV  JSON lines whose schema version switches mid-file. v1: {"t":"inv", no, src (system name), acct, printed, ccy,
// amt (major-unit decimal text), st}; v2: {"kind":"invoice", ref, sys (code), row (string), date, amount {minor, ccy},
// status, deleted}. A schema line switches the version for every following line; the trailer is in the current version.
const v1Row = (x, extra) => JSON.stringify({ t: extra ? 'inv-void' : 'inv', no: x.invoice, src: x.system, acct: x.row, printed: x.date_text, ccy: x.currency, amt: majorText(x.amount_minor, x.currency), st: x.status_text });
const v2Row = (x, extra) => JSON.stringify({ kind: 'invoice', ref: x.invoice, sys: SYS_CODE[x.system], row: String(x.row), date: x.date_text, amount: { minor: x.amount_minor, ccy: x.currency }, status: x.status_text, deleted: extra });
const hashV1 = h => ({ invoice: h.invoice, system: h.system, date: h.date_text, status: h.status_text });
export const JSONL_VERSIONS = {
  id: 'jsonl-versions', name: 'JSON lines whose schema version switches mid-file', tier: 'dev', grade: 1,
  layoutWhere: 'README (both schemas) + in-band schema lines',
  mistake: { name: 'schema-switch-ignored', why: 'the schema lines are skipped: version-2 records are read with version-1 conventions (amount taken as whole units, the system code kept as the name, the deleted flag not honoured), and so is a version-2 trailer' },
  encode({ records, trailer, r, L, sub, vague }) {
    const n = records.length;
    const k = Math.min(L.switches, n - 1);
    const cuts = new Set();
    while (cuts.size < k) cuts.add(r.int(1, n - 1));
    const lines = [JSON.stringify({ t: 'header', extract: 'receivables', schema: 1, company: sub.short })];
    let v = 1;
    records.forEach((x, i) => {
      if (cuts.has(i)) { lines.push(v === 1 ? JSON.stringify({ t: 'schema', version: 2 }) : JSON.stringify({ kind: 'schema', version: 1 })); v = 3 - v; }
      lines.push(v === 1 ? v1Row(x.row, x.kind !== 'row') : v2Row(x.row, x.kind !== 'row'));
    });
    lines.push(v === 1
      ? JSON.stringify({ t: 'trailer', records: trailer.records, rowsum: trailer.row_total, amt: Object.fromEntries(Object.entries(trailer.amounts).map(([c, m]) => [c, majorText(m, c)])), hash: hashV1(trailer.hash) })
      : JSON.stringify({ kind: 'trailer', count: trailer.records, row_total: trailer.row_total, totals_minor: trailer.amounts, hash_totals: trailer.hash }));
    const readme = [
      readmeHead(sub, 'LEGACY RECEIVABLES DUMP (JSON LINES)', vague), '',
      'File: records.jsonl, one JSON object per line.', '',
      'SCHEMA 1 (the file starts in it)',
      '  {"t":"inv", "no": invoice number, "src": billing-system name, "acct": customer row id, "printed": invoice date as printed, "ccy": currency, "amt": amount in whole units as decimal text (yen without decimals), "st": status text}',
      `  ${vague === 2 ? '"t":"inv-void" lines: void copies.' : '"t":"inv-void" marks a void copy of a record: not an invoice of the ledger.'}`,
      '  trailer: {"t":"trailer", records, rowsum, amt {currency: whole-unit decimal text}, hash {invoice, system, date, status}}', '',
      'SCHEMA 2',
      `  {"kind":"invoice", "ref": invoice number, "sys": billing-system code, "row": customer row id (text), "date": invoice date as printed, "amount": {"minor": amount in the smallest unit, "ccy": currency}, "status": status text, "deleted": true for a record deleted after the run (not an invoice of the ledger)}. Billing-system codes: ${CODE_LIST}.`,
      '  trailer: {"kind":"trailer", count, row_total, totals_minor {currency: smallest unit}, hash_totals {invoice, system, date_text, status_text}}', '',
      vague === 0 ? 'A line {"t":"schema","version":2} switches every following line to schema 2; a line {"kind":"schema","version":1} switches back. The job changed schema while it ran, so both occur in one file.'
        : vague === 1 ? 'The writer switched schema mid-run: a schema line ({"t":"schema",...} or {"kind":"schema",...}) announces the version of the lines after it.'
          : 'The writer was upgraded during the run (and rolled back); look for the schema lines.', '',
      trailerSentence('the last line', vague),
    ].join('\n');
    return { files: { 'README.TXT': readme, 'records.jsonl': lines.join('\n') }, params: { cuts: [...cuts].sort((a, b) => a - b) } };
  },
  decode(files, { keepExtras = false, mistake = null } = {}) {
    const ignore = mistake === JSONL_VERSIONS.mistake.name;
    const rows = [];
    let trailer = null, v = 1;
    for (const line of linesOf(files['records.jsonl'])) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.t === 'schema' || o.kind === 'schema') { if (!ignore) v = o.version; continue; }
      if (o.t === 'header') continue;
      const asV2 = o.kind !== undefined; // the line's own shape
      if (o.t === 'trailer') {
        trailer = { records: o.records, row_total: o.rowsum, amounts: Object.fromEntries(Object.entries(o.amt ?? {}).sort().map(([c, t]) => [c, parseMajor(t, c)])),
          hash: { invoice: o.hash?.invoice, system: o.hash?.system, date_text: o.hash?.date, status_text: o.hash?.status } };
        continue;
      }
      if (o.kind === 'trailer') {
        const u = c => (ignore ? unitOf(c) : 1);
        trailer = { records: o.count, row_total: o.row_total, amounts: Object.fromEntries(Object.entries(o.totals_minor ?? {}).sort().map(([c, m]) => [c, m * u(c)])), hash: { ...o.hash_totals } };
        continue;
      }
      if (asV2 && (v === 2 || ignore)) {
        if (o.deleted && !keepExtras && !ignore) continue;
        const c = o.amount?.ccy;
        rows.push({ invoice: o.ref, system: ignore ? o.sys : sysName(o.sys), row: Number(o.row), date_text: o.date, currency: c,
          amount_minor: ignore ? o.amount?.minor * unitOf(c) : o.amount?.minor, status_text: o.status });
      } else if (!asV2) {
        if (o.t === 'inv-void' && !keepExtras) continue;
        if (o.t !== 'inv' && o.t !== 'inv-void') continue;
        rows.push({ invoice: o.no, system: o.src, row: o.acct, date_text: o.printed, currency: o.ccy, amount_minor: parseMajor(o.amt, o.ccy), status_text: o.st });
      }
    }
    return finish(rows, trailer);
  },
};

// =====================================================================================================================
// MC  monthly CSV files whose headers drift: column order and column names change between months (names from a fixed
// synonym list in the README). A rec_state-like column marks records that are not invoices of the ledger.
const MC_COLS = ['invoice', 'system', 'row', 'date_text', 'currency', 'amount_minor', 'status_text', 'state'];
export const MC_SYNONYMS = {
  invoice: ['invoice_no', 'doc_no', 'inv_ref'], system: ['system', 'source', 'origin_system'], row: ['customer_row', 'acct_row', 'cust_row_id'],
  date_text: ['invoice_date', 'printed_date', 'doc_date'], currency: ['currency', 'ccy', 'curr'], amount_minor: ['amount_minor', 'amt_cents', 'value_minor'],
  status_text: ['status', 'doc_status', 'status_text'], state: ['rec_state', 'marker', 'row_flag'],
};
const MC_STATE = { duplicate: 'RESENT', 'before-image': 'SUPERSEDED', phantom: 'DELETED' };
const MC_LABEL = { invoice: 'invoice number', system: 'billing-system name', row: 'customer row id', date_text: 'invoice date as printed',
  currency: 'currency', amount_minor: 'amount in the smallest currency unit', status_text: 'status text', state: 'record state' };
export const MONTHLY_CSV = {
  id: 'monthly-csv', name: 'monthly CSV files with drifting headers', tier: 'dev', grade: 1,
  layoutWhere: 'each file\'s header line + README synonym list',
  mistake: { name: 'header-drift-mismapped', why: 'the first month\'s header read once and its column positions applied to every month: after the extract changed its column order, fields land in the wrong columns' },
  encode({ records, trailer, r, L, sub, vague }) {
    const months = [...new Set(records.map(x => x.month))].sort();
    const layouts = [];
    for (let i = 0; i < L.layouts; i++) {
      let perm;
      do perm = r.shuffle(MC_COLS); while (layouts.length && layouts[layouts.length - 1].perm.join() === perm.join());
      layouts.push({ perm, names: Object.fromEntries(MC_COLS.map(c => [c, r.pick(MC_SYNONYMS[c])])) });
    }
    const blocks = Math.min(layouts.length, months.length);
    const starts = new Set([0]);
    while (starts.size < blocks) starts.add(r.int(1, months.length - 1));
    const layoutOf = {};
    let li = -1;
    months.forEach((m, i) => { if (starts.has(i)) li++; layoutOf[m] = layouts[li]; });
    const files = {};
    const value = (c, x) => (c === 'state' ? (x.kind === 'row' ? '' : MC_STATE[x.extraKind]) : x.row[c]);
    months.forEach((m, i) => {
      const lay = layoutOf[m];
      const out = [lay.perm.map(c => lay.names[c]).join(',')];
      for (const x of records.filter(y => y.month === m)) out.push(lay.perm.map(c => csvField(value(c, x))).join(','));
      if (i === months.length - 1) out.push(`#TRAILER,${kvPairs(trailer, 'dot').map(([k, v]) => `${k}=${v}`).join(',')}`);
      files[`ar_${m}.csv`] = out.join('\n');
    });
    files['README.md'] = [
      readmeHead(sub, 'LEGACY RECEIVABLES DUMP (MONTHLY CSV)', vague), '',
      'One CSV file per invoice month (ar_YYYY-MM.csv), comma-separated, double quotes around values that contain a comma.', '',
      vague === 0 ? 'The extract was re-configured during the year: from some month on, its columns come in a different order and under different names. Each file has its own header line; read every file by its own header. The names used for each column:'
        : vague === 1 ? 'Column order and names changed more than once during the year (each file\'s header is right for that file). Names seen for each column:'
          : 'Headers are whatever the extract was configured with that month. Known names:',
      ...MC_COLS.map(c => `- ${MC_LABEL[c]}: ${MC_SYNONYMS[c].join(', ')}`), '',
      vague === 0 ? 'The record state is empty for an invoice. RESENT (a copy sent twice), SUPERSEDED (an earlier version of an invoice that was corrected) and DELETED (an invoice deleted after the run) mark records that are not invoices of the ledger.'
        : vague === 1 ? 'A non-empty record state (RESENT, SUPERSEDED, DELETED) marks a line that is not a ledger invoice.'
          : 'Record state: blank for normal lines; the extract flags re-sends, superseded versions and deletions there.', '',
      trailerSentence('the #TRAILER line at the end of the last month\'s file', vague),
    ].join('\n');
    return { files, params: { layouts: layouts.length, months: months.length, blocks } };
  },
  decode(files, { keepExtras = false, mistake = null } = {}) {
    const syn = {};
    for (const c of MC_COLS) for (const s of MC_SYNONYMS[c]) syn[s] = c;
    const names = Object.keys(files).filter(f => /^ar_\d{4}-\d{2}\.csv$/.test(f)).sort();
    const rows = [];
    let trailer = null, first = null;
    for (const name of names) {
      const lines = linesOf(files[name]);
      let col = Object.fromEntries(parseCsvLine(lines[0]).map((h, i) => [syn[h.trim()], i]));
      if (mistake === MONTHLY_CSV.mistake.name) { first ??= col; col = first; }
      for (const line of lines.slice(1)) {
        if (!line) continue;
        if (line.startsWith('#TRAILER')) { trailer = parseKv(line); continue; }
        const v = parseCsvLine(line);
        if (v[col.state] && !keepExtras) continue;
        rows.push({ invoice: v[col.invoice], system: v[col.system], row: Number(v[col.row]), date_text: v[col.date_text], currency: v[col.currency],
          amount_minor: Number(v[col.amount_minor]), status_text: v[col.status_text] });
      }
    }
    return finish(rows, trailer);
  },
};

export const DEV_FORMATS = [FIXED_WIDTH, CODE_PAGE, JSONL_VERSIONS, MONTHLY_CSV];
