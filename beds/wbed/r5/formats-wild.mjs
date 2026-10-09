// The three WILD formats of the R5 catalogue: drawn at d2-d4 like the dev formats, but the structure-necessity control
// has no code parser for them (it stands for the R4 reference built from the dev fixtures). A solver that reads the
// README handles them; a solver with only the dev parsers does not. `decoder-tool` is grade 2 and is not drawn at d2.
import { ROW_FIELDS, majorText, parseMajor, overpunch, unOverpunch } from '../lib/legacy.mjs';
import { SYS_CODE, sysName, CODE_LIST, kvPairs, parseKv, readmeHead, trailerSentence, finish, linesOf } from './common.mjs';
import { LAYOUTS, encodeRecord, decode as toolDecode, DECODER_TEXT } from './decoder-tool.mjs';

// =====================================================================================================================
// PD  a "proprietary" text format that the provided decoder.mjs converts once it is called with the flags the README
// describes: --key (the run number on the first line) and --layout (the site's field layout, stated only in prose).
const PD_VALUE = { invoice: x => x.invoice, system: x => SYS_CODE[x.system], row: x => x.row, date: x => x.date_text, currency: x => x.currency,
  amount: x => x.amount_minor, status: x => x.status_text };
export const DECODER_TOOL = {
  id: 'decoder-tool', name: 'proprietary text format with a shipped decoder.mjs that needs flags from the README', tier: 'wild', grade: 2,
  layoutWhere: 'decoder.mjs (code) + README prose (the flags: run number as key, field layout number)',
  mistake: { name: 'decoder-wrong-flags', why: 'decoder.mjs run with the key but without --layout (its default, layout 1): every D and V record comes out with its fields in the wrong slots; the trailer is printed as stored and reads right' },
  encode({ records, trailer, r, sub, vague }) {
    const key = r.int(1000, 9999), layout = r.int(2, 4);
    const lines = [`RUN ${key}`];
    for (const x of records) lines.push(encodeRecord([x.kind === 'row' ? 'D' : 'V', ...LAYOUTS[layout].map(f => PD_VALUE[f](x.row))].join('|'), key));
    lines.push(encodeRecord(`T|${kvPairs(trailer).map(([k, v]) => `${k}=${v}`).join('|')}`, key));
    const how = vague === 0
      ? `Decode it with the decoder shipped here: node decoder.mjs --key=<run number> --layout=<field layout> < LEDGER.PDX. The run number is printed on the first line of LEDGER.PDX ("RUN nnnn"). This dump was written with field layout ${layout}.`
      : vague === 1
        ? `Decoding needs two flags: --key, which is the run number on the first line of LEDGER.PDX, and --layout, the field layout this site's extract uses: layout ${layout}.`
        : `Use the shipped decoder (its header lists the flags). The key is the run number of the extract; the site has been on field layout ${layout} since the 2019 migration.`;
    const readme = [
      readmeHead(sub, 'LEGACY RECEIVABLES DUMP (RIVET-LD ARCHIVE)', vague), '',
      'Files: LEDGER.PDX (the archive, RIVET-LD text format), decoder.mjs (the vendor\'s decoder, Node.js).', '',
      how, '',
      `Decoded, each record is "type|invoice|system|row|date|currency|amount|status": invoice number, billing-system code (${CODE_LIST}), customer row id, invoice date as printed, currency, amount in the currency's smallest unit, status text.`,
      vague === 0 ? 'Type D is an invoice; type V is a void copy kept by the archive (not an invoice of the ledger); type T is the trailer, printed as KEY=value pairs.'
        : vague === 1 ? 'D records are invoices, V records are void copies, and the T record is the trailer (KEY=value pairs).' : 'Types: D, V (void copy), T (trailer).', '',
      trailerSentence('the T record', vague),
    ].join('\n');
    return { files: { 'README.TXT': readme, 'decoder.mjs': DECODER_TEXT, 'LEDGER.PDX': lines.join('\n') }, params: { key, layout } };
  },
  decode(files, { keepExtras = false, mistake = null } = {}) {
    const key = Number((String(files['LEDGER.PDX'] ?? '').match(/^RUN (\d+)/m) ?? [])[1] ?? 0);
    const layout = mistake === DECODER_TOOL.mistake.name ? undefined : Number((String(files['README.TXT'] ?? '').match(/layout (\d)/) ?? [])[1]);
    const rows = [];
    let trailer = null;
    for (const line of linesOf(toolDecode(files['LEDGER.PDX'] ?? '', { key, layout }))) {
      const p = line.split('|');
      if (p[0] === 'T') { trailer = parseKv(p.slice(1).join(' ')); continue; }
      if (!(p[0] === 'D' || (p[0] === 'V' && keepExtras))) continue;
      rows.push({ invoice: p[1], system: sysName(p[2]), row: Number(p[3]), date_text: p[4], currency: p[5], amount_minor: Number(p[6]), status_text: p[7] });
    }
    return finish(rows, trailer);
  },
};

// =====================================================================================================================
// CB  host records described by a COBOL copybook, amounts in signed zoned decimal with the sign overpunched on the last
// digit. The copybook (INVREC.CPY) is machine-readable; field order and widths are drawn per task.
const CB_NAME = { invoice: 'INV-NO', system: 'SYS-CODE', row: 'CUST-ROW', date_text: 'INV-DATE-PRT', currency: 'INV-CCY', amount_minor: 'INV-AMT', status_text: 'INV-STATUS' };
const CB_TRL = [['TRL-TYPE', 'X', 1], ['TRL-COUNT', '9', 8], ['TRL-ROWSUM', '9', 12], ['TRL-HASH-INV', '9', 12], ['TRL-HASH-SYS', '9', 12], ['TRL-HASH-DATE', '9', 12], ['TRL-HASH-STAT', '9', 12]];
const CB_SLOTS = 12;
const pic = (kind, n) => (kind === 'X' ? `PIC X(${n})` : kind === 'S9' ? `PIC S9(${n})` : `PIC 9(${n})`);
export const COPYBOOK = {
  id: 'copybook-overpunch', name: 'host records with a COBOL copybook and overpunched signed amounts', tier: 'wild', grade: 1,
  layoutWhere: 'INVREC.CPY (copybook) + README (record types, the sign convention)',
  mistake: { name: 'overpunch-ignored', why: 'signed zoned decimals read as plain digits: the overpunched last digit ({, A-I) is dropped, so every amount loses its units digit (and the trailer\'s currency totals the same way)' },
  encode({ records, trailer, r, sub, vague }) {
    if (Object.keys(trailer.amounts).length > CB_SLOTS) throw new Error('copybook: more currencies than trailer slots');
    const order = r.shuffle(ROW_FIELDS);
    const def = {};
    for (const f of order) {
      const max = Math.max(...records.map(x => String(f === 'system' ? SYS_CODE[x.row.system] : x.row[f]).length));
      def[f] = f === 'system' ? ['X', 2] : f === 'currency' ? ['X', 3] : f === 'row' ? ['9', max + r.int(1, 2)] : f === 'amount_minor' ? ['S9', max + r.int(1, 3)] : ['X', max + r.int(0, 2)];
    }
    const field = (f, row) => {
      const [k, n] = def[f];
      if (k === 'S9') return overpunch(row[f], n);
      if (k === '9') return String(row[f]).padStart(n, '0');
      return String(f === 'system' ? SYS_CODE[row.system] : row[f]).padEnd(n);
    };
    const lines = records.map(x => (x.kind === 'row' ? 'D' : 'V') + order.map(f => field(f, x.row)).join(''));
    const t = trailer;
    const slots = Object.entries(t.amounts);
    let trl = 'T' + [t.records, t.row_total, t.hash.invoice, t.hash.system, t.hash.date_text, t.hash.status_text].map((v, i) => String(v).padStart(CB_TRL[i + 1][2], '0')).join('');
    for (let i = 0; i < CB_SLOTS; i++) trl += i < slots.length ? slots[i][0] + overpunch(slots[i][1], 15) : '   ' + overpunch(0, 15);
    lines.push(trl);
    const cpy = [
      '      *> INVREC.CPY  receivables extract, record layouts (DISPLAY; one record per line)',
      '       01  INV-REC.',
      `           05  ${'REC-TYPE'.padEnd(16)}  PIC X(1).`,
      ...order.map(f => `           05  ${CB_NAME[f].padEnd(16)}  ${pic(def[f][0], def[f][1])}.`),
      '       01  TRL-REC.',
      ...CB_TRL.map(([n, k, w]) => `           05  ${n.padEnd(16)}  ${pic(k, w)}.`),
      `           05  ${'TRL-CCY-TOTAL'.padEnd(16)}  OCCURS ${CB_SLOTS} TIMES.`,
      `               10  ${'TRL-CCY'.padEnd(12)}  PIC X(3).`,
      `               10  ${'TRL-CCY-AMT'.padEnd(12)}  PIC S9(15).`,
    ].join('\n');
    const readme = [
      readmeHead(sub, 'LEGACY RECEIVABLES DUMP (HOST RECORDS)', vague), '',
      'Files: INVOICES.DAT (records, one per line), INVREC.CPY (the copybook: INV-REC for invoice records, TRL-REC for the trailer).', '',
      vague === 0 ? 'Field widths are in characters. PIC X fields are text, left-aligned and blank-padded. PIC 9 fields are unsigned numbers, zero-padded. PIC S9 fields are signed zoned decimals as the host writes them: the sign is overpunched on the last digit ("{" and A to I stand for a last digit 0 to 9 of a positive number, "}" and J to R for a negative one). INV-AMT is in the currency\'s smallest unit.'
        : vague === 1 ? 'Widths are in characters; X is text, 9 an unsigned number, S9 a signed zoned decimal with the sign overpunched on its last digit (host convention). INV-AMT is in the smallest currency unit.'
          : 'Standard host DISPLAY data per the copybook (S9 fields carry their sign the host way). Amounts in the smallest currency unit.',
      `INV-DATE-PRT is the invoice date as the billing system printed it; INV-STATUS its status text; SYS-CODE: ${CODE_LIST}.`, '',
      vague === 0 ? 'REC-TYPE: D is an invoice; V is a void copy left by a re-run (not an invoice of the ledger); the last record, type T, is the trailer in the TRL-REC layout (unused currency slots are blank with a zero amount).'
        : vague === 1 ? 'D records are invoices and V records void copies; the T record at the end uses TRL-REC (blank currency slots are unused).' : 'REC-TYPE D/V (void copy)/T (trailer, TRL-REC).', '',
      trailerSentence('the T record (TRL-REC)', vague),
    ].join('\n');
    return { files: { 'README.TXT': readme, 'INVREC.CPY': cpy, 'INVOICES.DAT': lines.join('\n') }, params: { order, def } };
  },
  decode(files, { keepExtras = false, mistake = null } = {}) {
    const groups = {};
    let g = null, occ = null;
    for (const line of linesOf(files['INVREC.CPY'])) {
      let m;
      if ((m = line.match(/^\s*01\s+([A-Z0-9-]+)\./))) { g = groups[m[1]] = []; occ = null; continue; }
      if ((m = line.match(/^\s*05\s+([A-Z0-9-]+)\s+OCCURS\s+(\d+)\s+TIMES\./))) { occ = { name: m[1], times: Number(m[2]), items: [] }; g.push(occ); continue; }
      if ((m = line.match(/^\s*(05|10)\s+([A-Z0-9-]+)\s+PIC\s+(S?9|X)\((\d+)\)\./))) {
        const it = { name: m[2], kind: m[3], len: Number(m[4]) };
        if (m[1] === '10' && occ) occ.items.push(it); else { occ = null; g.push(it); }
      }
    }
    const flat = items => { const out = []; for (const it of items) { if (it.times) for (let i = 0; i < it.times; i++) out.push(...it.items.map(x => ({ ...x, name: `${x.name}#${i}` }))); else out.push(it); } let p = 0; for (const x of out) { x.start = p; p += x.len; } return out; };
    const inv = flat(groups['INV-REC'] ?? []), trl = flat(groups['TRL-REC'] ?? []);
    const plain = mistake === COPYBOOK.mistake.name;
    const num = (it, s) => (it.kind === 'S9' ? (plain ? Number(s.replace(/\D/g, '')) : unOverpunch(s)) : Number(s));
    const read = (lay, line) => Object.fromEntries(lay.map(x => { const s = line.slice(x.start, x.start + x.len); return [x.name, x.kind === 'X' ? s.trimEnd() : num(x, s)]; }));
    const rows = [];
    let trailer = null;
    for (const line of linesOf(files['INVOICES.DAT'])) {
      const ty = line[0];
      if (ty === 'T') {
        const v = read(trl, line);
        const amounts = {};
        for (let i = 0; i < CB_SLOTS; i++) { const c = v[`TRL-CCY#${i}`]; if (c && c.trim()) amounts[c.trim()] = v[`TRL-CCY-AMT#${i}`]; }
        trailer = { records: v['TRL-COUNT'], row_total: v['TRL-ROWSUM'], amounts: Object.fromEntries(Object.keys(amounts).sort().map(c => [c, amounts[c]])),
          hash: { invoice: v['TRL-HASH-INV'], system: v['TRL-HASH-SYS'], date_text: v['TRL-HASH-DATE'], status_text: v['TRL-HASH-STAT'] } };
        continue;
      }
      if (!(ty === 'D' || (ty === 'V' && keepExtras))) continue;
      const v = read(inv, line);
      rows.push({ invoice: v['INV-NO'], system: sysName(v['SYS-CODE']), row: v['CUST-ROW'], date_text: v['INV-DATE-PRT'], currency: v['INV-CCY'],
        amount_minor: v['INV-AMT'], status_text: v['INV-STATUS'] });
    }
    return finish(rows, trailer);
  },
};

// =====================================================================================================================
// KS  keyed stanzas: *REC ... *END blocks of two-letter keys; a value longer than the line allows continues on "+ "
// lines (joined with nothing added). Amounts in whole units with decimals.
const KS_KEY = { invoice: 'IN', system: 'SY', row: 'CR', date_text: 'DT', currency: 'CY', amount_minor: 'AM', status_text: 'ST' };
export const KEYED_STANZAS = {
  id: 'keyed-stanzas', name: 'keyed stanzas with two-letter keys and continuation lines', tier: 'wild', grade: 1,
  layoutWhere: 'README (the keys, the continuation rule, the stanza kinds)',
  mistake: { name: 'continuation-dropped', why: 'the "+ " continuation lines skipped: every long value (word dates, long status texts, long amounts, and the trailer\'s long totals) is cut at the wrap width' },
  encode({ records, trailer, r, sub, vague }) {
    const W = r.int(8, 12);
    const kv = (k, v) => { const s = String(v), out = [`${k}= ${s.slice(0, W)}`]; for (let i = W; i < s.length; i += W) out.push(`+ ${s.slice(i, i + W)}`); return out; };
    const lines = [];
    records.forEach((x, i) => {
      lines.push(`*REC ${String(i + 1).padStart(5, '0')}${x.kind === 'row' ? '' : ' VOID-COPY'}`);
      for (const f of ROW_FIELDS) lines.push(...kv(KS_KEY[f], f === 'amount_minor' ? majorText(x.row.amount_minor, x.row.currency) : x.row[f]));
      lines.push('*END');
    });
    const t = trailer;
    lines.push('*TRAILER', ...kv('NR', t.records), ...kv('RS', t.row_total), ...Object.entries(t.amounts).flatMap(([c, m]) => kv(`AT-${c}`, majorText(m, c))),
      ...kv('HI', t.hash.invoice), ...kv('HY', t.hash.system), ...kv('HD', t.hash.date_text), ...kv('HS', t.hash.status_text), '*END');
    const readme = [
      readmeHead(sub, 'LEGACY RECEIVABLES DUMP (KEYED STANZAS)', vague), '',
      'File: STANZAS.TXT. Each record is a stanza from a "*REC nnnnn" line to "*END"; inside, one "KEY= value" line per field.', '',
      'Keys: IN invoice number; SY billing-system name; CR customer row id; DT invoice date as printed by the billing system; CY currency; AM amount in whole units with decimals (yen have none); ST status text.',
      vague === 0 ? `Lines are at most ${W} characters of value long. A longer value continues on the following lines, each starting with "+ " (plus and one blank); join the pieces exactly, adding nothing.`
        : vague === 1 ? `Values wrap after ${W} characters onto "+ " continuation lines; concatenate them as they are.`
          : 'The writer wraps long values; continuation lines start with "+ ".', '',
      vague === 0 ? 'A stanza whose header line ends with VOID-COPY is a void copy (not an invoice of the ledger).'
        : vague === 1 ? 'VOID-COPY stanzas are void copies, not ledger invoices.' : 'VOID-COPY stanzas: copies the source system voided.', '',
      trailerSentence('the *TRAILER stanza (NR records, RS row-id sum, AT-<currency> amount totals in whole units, HI/HY/HD/HS hash totals of invoice, system, date and status)', vague),
    ].join('\n');
    return { files: { 'README.TXT': readme, 'STANZAS.TXT': lines.join('\n') }, params: { W } };
  },
  decode(files, { keepExtras = false, mistake = null } = {}) {
    const drop = mistake === KEYED_STANZAS.mistake.name;
    const rows = [];
    let trailer = null, cur = null, last = null;
    for (const line of linesOf(files['STANZAS.TXT'])) {
      let m;
      if ((m = line.match(/^\*REC \d+( VOID-COPY)?$/))) { cur = { kind: m[1] ? 'extra' : 'row', v: {} }; continue; }
      if (line === '*TRAILER') { cur = { kind: 'trailer', v: {} }; continue; }
      if (line === '*END') {
        if (!cur) continue;
        const v = cur.v;
        if (cur.kind === 'trailer') {
          const amounts = {};
          for (const [k, x] of Object.entries(v)) if (k.startsWith('AT-')) amounts[k.slice(3)] = parseMajor(x, k.slice(3));
          trailer = { records: Number(v.NR), row_total: Number(v.RS), amounts: Object.fromEntries(Object.keys(amounts).sort().map(c => [c, amounts[c]])),
            hash: { invoice: Number(v.HI), system: Number(v.HY), date_text: Number(v.HD), status_text: Number(v.HS) } };
        } else if (cur.kind === 'row' || keepExtras) {
          rows.push({ invoice: v.IN, system: v.SY, row: Number(v.CR), date_text: v.DT, currency: v.CY, amount_minor: parseMajor(v.AM, v.CY), status_text: v.ST });
        }
        cur = null; continue;
      }
      if (!cur) continue;
      if ((m = line.match(/^([A-Z]{2}(?:-[A-Z]{3})?)= (.*)$/))) { cur.v[m[1]] = m[2]; last = m[1]; continue; }
      if (line.startsWith('+ ') && last && !drop) cur.v[last] += line.slice(2);
    }
    return finish(rows, trailer);
  },
};

export const WILD_FORMATS = [COPYBOOK, KEYED_STANZAS, DECODER_TOOL];
