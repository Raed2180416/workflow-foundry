// Independent text-level solver for the `records` bed (test-only health check). It reads nothing but
// task.inputs (export, source notes, spec), parses every system's dialect, and applies the spec's
// rules via the shared rule functions. If it scores 1.0, the hidden truth is derivable from the
// rendered text alone. It is NOT the reference solver and is never shown to arms.
import * as P from './pools.mjs';
import { ruleSolve, rowsLink, sameDay, mulRate, divRate } from './world.mjs';
import { dayNum, VENDEX_VOID, FLAG_FORM, FLAG_NOTE, PERSP_NOTE } from './render.mjs';

let AB = null; // active ablation (single-threaded, set per solveText call)
const MONTH = {};
P.MONTHS.forEach((m, i) => { MONTH[m.toLowerCase()] = i + 1; MONTH[m.slice(0, 3).toLowerCase()] = i + 1; });
export const COUNTRY_ALIAS = new Map();
for (const [iso, c] of Object.entries(P.COUNTRIES)) {
  for (const a of [...c.en, ...c.de, ...c.typo, ...c.prose, iso]) COUNTRY_ALIAS.set(a.toLowerCase(), iso);
}
COUNTRY_ALIAS.set('uk', 'GB');
const DEMONYM = new Map(Object.entries(P.COUNTRIES).map(([iso, c]) => [c.demonym.toLowerCase(), iso]));
const CITY = new Map(Object.entries(P.ALL_CITIES).flatMap(([iso, list]) => list.map(c => [c.toLowerCase(), iso])));
const CCS = [...new Set(Object.values(P.COUNTRIES).map(c => c.cc))].sort((a, b) => b.length - a.length);
const TITLE_TOKENS = new Set(['mr', 'mr.', 'ms', 'ms.', 'mrs', 'mrs.', 'dr', 'dr.', 'prof.', 'prof']);
const MISSING = new Set(['', 'n/a', '—', 'tbd', '?', 'n/k']);

const ymd = (y, m, d) => ({ y: Number(y), m: Number(m), d: Number(d) });
const dayOf = ({ y, m, d }) => dayNum(y, m, d);
function longDate(s) { // "10 September 2022" | "March 5, 2021" | "3 Mar 2021"
  let m = s.match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/);
  if (m) return ymd(m[3], MONTH[m[2].toLowerCase()], m[1]);
  m = s.match(/^([A-Za-z]+) (\d{1,2}), (\d{4})$/);
  if (m) return ymd(m[3], MONTH[m[1].toLowerCase()], m[2]);
  throw new Error(`date? ${s}`);
}
let VX_ORDER = 'mdy'; // VENDEX numeric date order of the current task (from the notes; ablation 'vendex-flipped' inverts it)
function vxNumeric(s, twoDigitCentury = 1900) {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? twoDigitCentury + Number(m[3]) : m[3];
  const monthFirst = (VX_ORDER === 'mdy') !== (AB === 'vendex-flipped');
  return monthFirst ? ymd(y, m[1], m[2]) : ymd(y, m[2], m[1]);
}
function vendexDob(s) {
  const num = vxNumeric(s);
  if (num) return num;
  let m = s.match(/^([A-Za-z]+) (\d{1,2})(?:st|nd|rd|th), (\d{4})$/);
  if (m) return ymd(m[3], MONTH[m[1].toLowerCase()], m[2]);
  m = s.match(/^the (\d{1,2})(?:st|nd|rd|th) of ([A-Za-z]+) (\d{4})$/);
  if (m) return ymd(m[3], MONTH[m[2].toLowerCase()], m[1]);
  m = s.match(/^(\d{2})-([A-Za-z]{3})-(\d{2})$/);
  if (m) return ymd(1900 + Number(m[3]), MONTH[m[2].toLowerCase()], m[1]);
  return longDate(s);
}
function eraDob(s) {
  const m = s.match(/^([SH])(\d+)\.(\d{2})\.(\d{2})$/);
  if (!m) return null;
  return ymd((m[1] === 'S' ? 1925 : 1988) + Number(m[2]), m[3], m[4]);
}

function wordsToNumber(s) {
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  let total = 0, cur = 0;
  for (const tok of s.split(/[\s-]+/)) {
    if (ONES.includes(tok)) cur += ONES.indexOf(tok);
    else if (TENS.includes(tok)) cur += TENS.indexOf(tok) * 10;
    else if (tok === 'hundred') cur *= 100;
    else if (tok === 'thousand') { total += cur * 1000; cur = 0; } else throw new Error(`number word? ${tok}`);
  }
  return total + cur;
}
function decimalToMinor(text, currency) {
  const md = P.CURRENCIES[currency].minor;
  const [i, f = ''] = text.split('.');
  return Number(i) * 10 ** md + (md ? Number(f.padEnd(md, '0').slice(0, md)) : 0);
}

function phone(raw, iso, allow011) {
  const s = (raw ?? '').trim();
  if (MISSING.has(s.toLowerCase())) return null;
  const all = s.replace(/\D/g, '');
  if (!all || /^0+$/.test(all)) return null;
  let intl = null;
  if (s.startsWith('+')) intl = s.slice(1);
  else if (s.startsWith('00')) intl = s.slice(2);
  else if (allow011 && AB !== 'no-011' && s.startsWith('011 ')) intl = s.slice(4);
  if (intl !== null) {
    const d = (AB === 'keep-trunk-zero' ? intl : intl.replace('(0)', '')).replace(/\D/g, '');
    if (!CCS.some(cc => d.startsWith(cc))) throw new Error(`calling code? ${raw}`);
    return `+${d}`;
  }
  if (!iso) { if (AB) return null; throw new Error(`local phone without country: ${raw}`); }
  const c = P.COUNTRIES[iso];
  let d = all;
  if (c.trunk === 'nanp' && d.length === 11 && d[0] === '1') d = d.slice(1);
  else if (c.trunk === '0' && d[0] === '0' && AB !== 'keep-trunk-zero') d = d.slice(1);
  return `+${c.cc}${d}`;
}
function country(raw) {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const iso = COUNTRY_ALIAS.get(s.toLowerCase());
  if (!iso) throw new Error(`country? ${raw}`);
  return iso;
}
function givenFirst(text) { // "[Title] Given [M.] Family"
  const toks = text.trim().split(/\s+/);
  while (TITLE_TOKENS.has(toks[0].toLowerCase())) toks.shift();
  const given = toks.shift();
  return { given, family: toks.filter(t => !/^[A-Z]\.$/.test(t)).join(' ') };
}
function familyComma(text) { // "Family, Given [M.] [(Title)]"
  const i = text.indexOf(', ');
  const family = text.slice(0, i);
  const rest = text.slice(i + 2).replace(/\s*\([^)]*\)\s*$/, '').trim().split(/\s+/);
  return { given: rest[0], family };
}
function nameAny(text) { return text.includes(', ') ? familyComma(text) : givenFirst(text); }

// ---------------------------------------------------------------------------------------
function parseFx(spec) {
  const fx = { cur: {}, old: {}, cutover: null };
  let table = 'cur';
  for (const line of spec.split('\n')) {
    let m = line.match(/Table B1, for rows updated up to and including (.+):$/);
    if (m) { table = 'old'; continue; }
    m = line.match(/Table B2, for rows updated on or after (.+):$/);
    if (m) { table = 'cur'; fx.cutover = dayOf(longDate(m[1])); continue; }
    m = line.match(/^\s+([A-Z]{3})(?:\/USD)?\s+(\d+)\.(\d+)$/);
    if (m && P.CURRENCIES[m[1]]) fx[table][m[1]] = mulRate(Number(m[2]) * 1e6 + Number(m[3].padEnd(6, '0')));
    m = line.match(/^\s+USD\/([A-Z]{3})\s+(\d+)\.(\d{4})$/);
    if (m && P.CURRENCIES[m[1]]) {
      const q4 = Number(m[2]) * 1e4 + Number(m[3]);
      fx[table][m[1]] = AB === 'pairs-multiply' ? { num: q4, den: 10000 } : divRate(q4);
    }
  }
  fx.cur.USD ??= mulRate(1000000);
  if (fx.cutover !== null) fx.old.USD ??= mulRate(1000000);
  return fx;
}

function parseLine(line, ctx) {
  let m;
  if ((m = line.match(/^BRIGHTDESK row=(\d+) \| (.*)$/))) {
    const f = Object.fromEntries(m[2].split(' | ').map(kv => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
    let name = f.name;
    const isVoid = name.startsWith('ZZTEST ') || flagVoid(ctx, 'BRIGHTDESK', f.stage);
    if (isVoid) name = name.slice(7);
    const iso = country(f.country);
    const dm = f.dob.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/), dw = f.dob.match(/^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/);
    const bdMonthFirst = (ctx.bdOrder === 'mdy') !== (AB === 'bd-flipped');
    const dob = dm && f.dob !== '00/00/0000' ? (bdMonthFirst ? ymd(dm[3], dm[1], dm[2]) : ymd(dm[3], dm[2], dm[1]))
      : dw ? ymd(dw[3], MONTH[dw[2].toLowerCase()], dw[1]) : null;
    let amount = null;
    const b = f.balance.trim();
    if (!MISSING.has(b.toLowerCase())) {
      const neg = /^\(.*\)$/.test(b) || b.startsWith('-');
      const num = b.replace(/[()$,\s-]|USD/g, '');
      amount = { minor: (neg ? -1 : 1) * decimalToMinor(num, 'USD'), currency: 'USD' };
    }
    const [y, mo, d] = f.updated.split('-');
    return { rowId: Number(m[1]), void: isVoid, date: dayOf(ymd(y, mo, d)), np: nameAny(name), dob, country: iso,
      phone: phone(f.phone, iso, true), amount, memo: f.memo ?? null };
  }
  if (line.startsWith('LEDGR;')) {
    const [, id, name, , dobS, land, tel, saldo, status, changed] = line.split(';');
    const iso = country(land);
    const dm = dobS.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    const dob = dm && dobS !== '00.00.0000' ? ymd(dm[3], dm[2], dm[1]) : null;
    let amount = null;
    if (!MISSING.has(saldo.trim().toLowerCase())) {
      const currency = /CHF/.test(saldo) ? 'CHF' : 'EUR';
      const neg = saldo.includes('-');
      const num = saldo.replace(/EUR|CHF|€|-|\s/g, '').replace(/\./g, '').replace(',', '.');
      amount = { minor: (neg ? -1 : 1) * decimalToMinor(num, currency), currency };
    }
    const [dd, mm, yy] = changed.split('.');
    return { rowId: Number(id), void: status === 'storniert' || (AB === 'blocked-is-void' && status === 'gesperrt') || flagVoid(ctx, 'LEDGR', status), date: dayOf(ymd(yy, mm, dd)), np: familyComma(name), dob,
      country: iso, phone: phone(tel, iso, false), amount };
  }
  if ((m = line.match(/^ATLAS #(\d+) :: (.*)$/))) {
    const parts = m[2].split(' :: ');
    const tag = parts[parts.length - 1];
    const isVoid = tag === 'DO NOT MIGRATE' || flagVoid(ctx, 'ATLAS', tag);
    const [name, born, land, tel, owed, change] = parts;
    const date = dayOf(longDate(change.replace(/^last change /, '')));
    const iso = country(land);
    const ds = born.replace(/^born /, '');
    const dm = ds.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const base = ctx.atlasOrder === 'mdy', switched = AB !== 'atlas-cutoff' && ctx.atlasCutoff !== null && date >= ctx.atlasCutoff;
    const monthFirst = AB === 'atlas-month-first' || ((base !== switched) !== (AB === 'atlas-flipped'));
    const wm = ds.match(/^(\d{1,2})[ -]([A-Z][a-z]{2})[ -](\d{4})$/);
    const dob = dm ? (monthFirst ? ymd(dm[3], dm[1], dm[2]) : ymd(dm[3], dm[2], dm[1])) : wm ? ymd(wm[3], MONTH[wm[2].toLowerCase()], wm[1]) : null;
    const o = owed.replace(/^owed /, '').trim();
    let amount = null;
    if (!MISSING.has(o.toLowerCase())) {
      const neg = /\bCR$/.test(o);
      amount = { minor: (neg ? -1 : 1) * decimalToMinor(o.replace(/£|GBP|CR|,|\s/g, ''), 'GBP'), currency: 'GBP' };
    }
    const np = /^[^,]+, /.test(name) ? familyComma(name) : givenFirst(name);
    const note = parts.find(x => x.startsWith('note: '));
    return { rowId: Number(m[1]), void: isVoid, date, np, dob, country: iso, phone: phone(tel.replace(/^tel ?/, ''), iso, false), amount,
      memo: note ? note.slice(6) : null };
  }
  if ((m = line.match(/^KOBO\/(\d+) member: (.*)$/))) {
    const parts = m[2].split(' | ');
    const toks = parts[0].trim().split(/\s+/);
    const np = { given: toks[toks.length - 1], family: toks.slice(0, -1).join(' ') };
    const f = Object.fromEntries(parts.slice(1).map(p => { const i = p.indexOf(': '); return [p.slice(0, i), p.slice(i + 2)]; }));
    const b = f.birth.trim();
    let dob = null;
    const dm = b.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (dm) dob = ymd(dm[1], dm[2], dm[3]); else dob = AB === 'era-unreadable' ? null : eraDob(b);
    let amount = null;
    const bal = f.balance.trim();
    if (!MISSING.has(bal.toLowerCase())) {
      const neg = /^[▲-]/.test(bal);
      amount = { minor: (neg ? -1 : 1) * Number(bal.replace(/[▲¥円,\s-]|JPY/g, '')), currency: 'JPY' };
    }
    const [y, mo, d] = f.upd.split('/');
    return { rowId: Number(m[1]), void: f.flag === 'SAMPLE' || flagVoid(ctx, 'KOBO', f.flag), date: dayOf(ymd(y, mo, d)), np, dob, country: 'JP',
      phone: phone(f.tel, 'JP', false), amount, memo: f.note ?? null };
  }
  if (line.startsWith('Vendex ')) return parseVendex(line);
  if (line.startsWith('VERITAS ')) {
    const o = JSON.parse(line.slice(8));
    const dob = o.dob && (o.dob !== '1900-01-01' || AB === 'sentinel-as-dob') ? ymd(...o.dob.split('-')) : null;
    const iso = o.country ? country(o.country.toUpperCase() === 'UK' ? 'GB' : o.country.toUpperCase()) : null;
    return { rowId: o.row, void: o.env === 'sandbox' || flagVoid(ctx, 'VERITAS', o.env), date: dayOf(ymd(...o.ts.slice(0, 10).split('-'))), np: { given: o.given, family: o.family },
      dob, country: iso, phone: o.msisdn ? `+${o.msisdn}` : null,
      amount: o.amount === null ? null : { minor: (o.amount.startsWith('-') ? -1 : 1) * decimalToMinor(o.amount.replace('-', ''), o.ccy), currency: o.ccy },
      memo: o.note ?? null };
  }
  throw new Error(`unparsed line: ${line.slice(0, 60)}`);
}

const DATE_RE = '(?:[A-Z][a-z]+ \\d{1,2}(?:st|nd|rd|th)?, \\d{4}|\\d{1,2} [A-Z][a-z]+ \\d{4}|the \\d{1,2}(?:st|nd|rd|th) of [A-Z][a-z]+ \\d{4}|\\d{2}-[A-Z][a-z]{2}-\\d{2}|\\d{1,2}/\\d{1,2}/(?:\\d{4}|\\d{2}))';
const DOB_RE = `(?:(?:born|date of birth|DOB|b\\.|Born|Date of birth) ${DATE_RE}|birth date not on file|DOB unknown)`;
const PHONE_RE = '(?:(?:[Pp]hone|[Rr]each at|[Tt]el\\.|[Mm]obile|[Bb]est number) [^,;—]+?|[Nn]o phone on file|[Pp]hone not on file)';
const AMT_RE = '(?:(?:[Oo]wes us|[Oo]pen balance|[Oo]utstanding|[Bb]alance due|[Ii]n credit by|[Hh]olding a credit of|[Cc]redit balance of|[Ww]e owe them) .+?|[Bb]alance not recorded|[Nn]o balance recorded)';
const NAME_RE = '([^,;()—]+?)';
const VT = [
  // [regex, field order]
  [new RegExp(`^Supplier contact ${NAME_RE} \\((${DOB_RE})\\)(?:, based in ([^;]+)|, an? ([A-Za-z]+) supplier)?; (${PHONE_RE}); (${AMT_RE})\\. Entry revised (.+?)\\.$`), ['name', 'dob', 'place', 'dem', 'phone', 'amt', 'rev']],
  [new RegExp(`^${NAME_RE}(?:, an? ([A-Za-z]+) supplier,|, based in ([^,]+),)? (${DOB_RE}); (${PHONE_RE}); (${AMT_RE})\\. Revised on (.+?)\\.$`), ['name', 'dem', 'place', 'dob', 'phone', 'amt', 'rev']],
  [new RegExp(`^Entry revised (.+?): ${NAME_RE}(?: \\(([^)]+)\\))?, (${DOB_RE}), (${PHONE_RE}), (${AMT_RE})\\.$`), ['rev', 'name', 'any', 'dob', 'phone', 'amt']],
  [new RegExp(`^Spoke with ${NAME_RE} on (.+?)(?: \\(an? ([A-Za-z]+) contact\\)| \\(based in ([^)]+)\\))?\\. (${DOB_RE})\\. (${PHONE_RE})\\. (${AMT_RE})\\.$`), ['name', 'rev', 'dem', 'place', 'dob', 'phone', 'amt']],
  [new RegExp(`^${NAME_RE} — (.+?) — (${DOB_RE}) — (${PHONE_RE}) — (${AMT_RE}) — last revised (.+?)\\.$`), ['name', 'loc', 'dob', 'phone', 'amt', 'rev']],
];
function vendexPlace(s) {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  if (t === 'location not stated') return null;
  const iso = COUNTRY_ALIAS.get(t) ?? DEMONYM.get(t) ?? DEMONYM.get(t.replace(/ supplier$/, '')) ?? CITY.get(t);
  if (!iso) throw new Error(`place? ${s}`);
  return iso;
}
function parseVendex(line) {
  let s = line;
  const isVoid = s.endsWith(VENDEX_VOID);
  if (isVoid) s = s.slice(0, -VENDEX_VOID.length);
  const ri = s.indexOf(' Remark: ');
  const memo = ri >= 0 ? s.slice(ri + 9) : null;
  if (ri >= 0) s = s.slice(0, ri);
  const m = s.match(/^Vendex (\d+) — (.*)$/);
  let f = null;
  for (const [re, keys] of VT) {
    const x = m[2].match(re);
    if (x) { f = Object.fromEntries(keys.map((k, i) => [k, x[i + 1]])); break; }
  }
  if (!f) throw new Error(`vendex? ${line}`);
  const iso = vendexPlace(f.place ?? f.dem ?? f.any ?? f.loc);
  const dobS = f.dob.replace(/^(born|date of birth|DOB|b\.|Born|Date of birth) /, '');
  const dob = /not on file|unknown/.test(f.dob) ? null : vendexDob(dobS);
  const ph = /not on file/i.test(f.phone) ? null : phone(f.phone.replace(/^([Pp]hone|[Rr]each at|[Tt]el\.|[Mm]obile|[Bb]est number) /, ''), iso, false);
  const rev = vxNumeric(f.rev, 2000) ?? longDate(f.rev);
  return { rowId: Number(m[1]), void: isVoid, date: dayOf(rev), np: givenFirst(f.name), dob, country: iso, phone: ph,
    amount: vendexAmount(f.amt), memo };
}
function vendexAmount(s) {
  if (/^(?:[Bb]alance not recorded|[Nn]o balance recorded)$/.test(s)) return null;
  let neg = false, t = s;
  const cm = t.match(/^(?:[Ii]n credit by|[Hh]olding a credit of|[Cc]redit balance of|[Ww]e owe them) (.*)$/);
  if (cm) { neg = true; t = cm[1]; } else t = t.replace(/^(?:[Oo]pen balance|[Oo]wes us|[Oo]utstanding|[Bb]alance due) /, '');
  let m = t.match(/^(USD|EUR|GBP) ([\d,]+\.\d{2})$/);
  if (m) return { minor: (neg ? -1 : 1) * decimalToMinor(m[2].replace(/,/g, ''), m[1]), currency: m[1] };
  m = t.match(/^(.+?) (US dollars?|dollars?|euros?|pounds? sterling|pounds?)(?: and (.+?) (cents?|pence|penny))?$/);
  if (!m) throw new Error(`amount? ${s}`);
  const currency = /dollar/.test(m[2]) ? 'USD' : /euro/.test(m[2]) ? 'EUR' : 'GBP';
  const minor = wordsToNumber(m[1]) * 100 + (m[3] ? wordsToNumber(m[3]) : 0);
  return { minor: (neg ? -1 : 1) * minor, currency };
}

// Single-judgment ablations: each knocks out exactly one skill the task needs (used to measure how
// much each judgment matters; see README).
export const ABLATIONS = ['atlas-cutoff', 'atlas-month-first', 'era-unreadable', 'sentinel-as-dob', 'keep-void', 'blocked-is-void',
  'single-fx-table', 'no-fx', 'keep-trunk-zero', 'no-011', 'nickname-as-given', 'no-accent-restore', 'exact-names',
  'no-phone-link', 'phone-merges-households', 'obey-memos', 'oldest-wins',
  // v2 traps
  'lenient-names', 'keyword-voids', 'country-from-phone', 'pairs-multiply',
  // v3 per-task prose (difficulty >= 3); 'notes-defaults' is a program that never reads the per-task notes
  'vendex-flipped', 'atlas-flipped', 'bd-flipped', 'flags-flipped', 'unknown-flags-live', 'mirror-ignored', 'perspective-ignored', 'notes-defaults'];
const KEYWORD_VOID = /ZZTEST|DO NOT MIGRATE|SAMPLE|sandbox|withdrawn/i;

// ---------------------------------------------------------------------------------------
// Per-task notes (difficulty >= 3): date orders, ATLAS cutoff, extra status values, re-stamped mirror.
const reEsc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TEAM_ORDER = new Map(Object.entries(P.TEAM_CITIES).flatMap(([order, cities]) => cities.map(c => [c, order])));
// Status-value sentences: regexes derived from the paraphrase pool with the shown value as a capture group.
const SHOW_RE = { BRIGHTDESK: 'stage=(\\S+?)', LEDGR: 'Status "([^"]+)"', ATLAS: '":: ([^"]+)"', KOBO: '"flag: ([^"]+)"', VERITAS: '"env":"([^"]+)"' };
const FLAG_RES = Object.fromEntries(Object.entries(SHOW_RE).map(([sys, show]) => [sys, ['live', 'void'].flatMap(pol =>
  FLAG_NOTE[pol].map(tpl => [pol, new RegExp(reEsc(tpl('\u0000', FLAG_FORM[sys])).replace('\u0000', show))]))]));
function dateOrderOfExample(written, meaning) { // "06/05/2021" + "June 5, 2021" | "6 May 2021" -> 'mdy' | 'dmy'
  const [a] = written.split('/').map(Number);
  let m = meaning.match(/^([A-Za-z]+) (\d{1,2}), \d{4}$/);
  if (m) return MONTH[m[1].toLowerCase()] === a ? 'mdy' : 'dmy';
  m = meaning.match(/^(\d{1,2}) ([A-Za-z]+) \d{4}$/);
  if (m) return Number(m[1]) === a ? 'dmy' : 'mdy';
  throw new Error(`example? ${meaning}`);
}
export function parseNotes(notes) {
  const para = sys => notes.split('\n').find(l => l.startsWith(`${sys}.`)) ?? '';
  const out = { atlasOrder: 'dmy', atlasCutoff: null, vendexOrder: 'mdy', bdOrder: 'mdy', flags: {}, mirror: null, persp: {} };
  const orderOf = sys => ({ LEDGR: 'dmy', BRIGHTDESK: out.bdOrder, ATLAS: out.atlasOrder }[sys]);
  let m;
  // BRIGHTDESK (difficulty 1-2 wording: "runs in US locale, so birth dates are month/day/year")
  const B = para('BRIGHTDESK');
  if (/runs in UK locale: numeric birth dates are day\/month\/year|Numeric birth dates are DD\/MM\/YYYY|does not keep its vendor's American defaults|does not use the American order/.test(B)) out.bdOrder = 'dmy';
  else if ((m = B.match(/For example, dob=(\d\d\/\d\d)\/\d{4} is (\d{1,2} [A-Za-z]+ \d{4})\./))) out.bdOrder = dateOrderOfExample(m[1], m[2]);
  else if ((m = B.match(/A customer with dob=(\d\d)\/\d\d\/\d{4} was born in ([A-Za-z]+)\./))) out.bdOrder = MONTH[m[2].toLowerCase()] === Number(m[1]) ? 'mdy' : 'dmy';
  else if (!/runs in US locale, so (?:numeric )?birth dates are month\/day\/year|Numeric birth dates are MM\/DD\/YYYY|kept its vendor's American defaults|does not use the British order/.test(B) && B) throw new Error('BRIGHTDESK order not found');
  // ATLAS
  const A = para('ATLAS');
  if (/are day\/month\/year, not|not month-first: the day comes first|Unlike the US installation|as DD\/MM\/YYYY, never|configured in UK locale: birth dates are day\/month\/year/.test(A)) out.atlasOrder = 'dmy';
  else if (/are month\/day\/year, not|not day-first: the month comes first|Unlike the UK installation|as MM\/DD\/YYYY, never/.test(A)) out.atlasOrder = 'mdy';
  else if ((m = A.match(/an ATLAS birth date written (\d\d\/\d\d)\/\d{4} is (\d{1,2} [A-Za-z]+ \d{4})\./))) out.atlasOrder = dateOrderOfExample(m[1], m[2]);
  else if ((m = A.match(/An ATLAS row "born (\d\d)\/\d\d\/\d{4}" belongs to someone born in ([A-Za-z]+)\./))) out.atlasOrder = MONTH[m[2].toLowerCase()] === Number(m[1]) ? 'mdy' : 'dmy';
  else if ((m = A.match(/the country where its servers stand, (.+?)\. /))) out.atlasOrder = m[1] === 'the United States' ? 'mdy' : 'dmy';
  else if ((m = A.match(/Numeric birth dates in ATLAS use the same order as (\w+)/))) out.atlasOrder = orderOf(m[1]);
  else if (A) throw new Error('ATLAS order not found');
  m = A.match(/On (\d{1,2} [A-Z][a-z]+ \d{4}), ATLAS moved/) ?? A.match(/migration to a new vendor on (\d{1,2} [A-Z][a-z]+ \d{4})/)
    ?? A.match(/the date that matters is (\d{1,2} [A-Z][a-z]+ \d{4})/);
  if (m) out.atlasCutoff = dayOf(longDate(m[1]));
  // VENDEX
  const V = para('VENDEX');
  if (V) {
    if (/written by a US-based procurement team|follow the American convention, month\/day\/year|Numeric dates are MM\/DD\/YYYY|first number is the month|never adopted the day-first habit/.test(V)) out.vendexOrder = 'mdy';
    else if (/follow the European convention, day\/month\/year|Numeric dates are DD\/MM\/YYYY|first number is the day|never adopted the month-first habit/.test(V)) out.vendexOrder = 'dmy';
    else if ((m = V.match(/A numeric date such as (\d\d\/\d\d)\/2021 means (.+?)\. /))) out.vendexOrder = dateOrderOfExample(m[1], m[2]);
    else if ((m = V.match(/Numeric dates use the same order as (\w+)\./))) out.vendexOrder = orderOf(m[1]);
    else if ((m = V.match(/moved from .+? to (.+?) in 2015/) ?? V.match(/works from (.+?) and writes numeric dates/))) out.vendexOrder = TEAM_ORDER.get(m[1]);
    else out.vendexOrder = null;
    if (!out.vendexOrder) throw new Error('VENDEX order not found');
  }
  for (const [sys, res] of Object.entries(FLAG_RES)) {
    const text = para(sys);
    for (const [pol, re] of res) { const f = text.match(re); if (f) (out.flags[sys] ||= {})[f[1]] = pol; }
  }
  for (const sys of ['BRIGHTDESK', 'LEDGR', 'KOBO', 'VERITAS']) {
    if (/extract comes from a read-only mirror|Do not trust the \S+ dates of|shows when the nightly copy job last rewrote|the migration overwrote|re-imported the whole table/.test(para(sys))) out.mirror = sys;
  }
  for (const [sys, pols] of Object.entries(PERSP_NOTE)) {
    for (const [pol, texts] of Object.entries(pols)) if (texts.some(t => para(sys).includes(t))) out.persp[sys] = pol;
  }
  return out;
}
function flagVoid(ctx, sys, value) {
  const pol = ctx.flags?.[sys]?.[value];
  if (!pol || AB === 'unknown-flags-live' || AB === 'notes-defaults') return false;
  return (pol === 'void') !== (AB === 'flags-flipped');
}
const CC_ISO = new Map(Object.entries(P.COUNTRIES).reverse().map(([iso, c]) => [c.cc, iso])); // '1' -> US
const fold = s => P.foldStrip(s);
const LINKS = {
  'exact-names': (a, b) => {
    if (a.dob && b.dob) { if (!sameDay(a.dob, b.dob)) return false; } else if (!(a.phone && b.phone && a.phone === b.phone)) return false;
    const ga = fold(P.formalOf(a.np.given)), gb = fold(P.formalOf(b.np.given));
    return ga === gb && (fold(a.np.family) === fold(b.np.family) || P.foldExpand(a.np.family) === P.foldExpand(b.np.family));
  },
  'no-phone-link': (a, b) => Boolean(a.dob && b.dob && sameDay(a.dob, b.dob) && P.namesMatch(a.np, b.np)),
  'phone-merges-households': (a, b) => rowsLink(a, b) || Boolean(a.phone && b.phone && a.phone === b.phone),
  // Tolerates two typing errors: merges near-twins (same birth date and family name, given names 2 edits apart).
  'lenient-names': (a, b) => {
    if (a.dob && b.dob) { if (!sameDay(a.dob, b.dob)) return false; } else if (!(a.phone && b.phone && a.phone === b.phone)) return false;
    const g = P.partDistance(P.formalOf(a.np.given), P.formalOf(b.np.given));
    return g <= 2 && g + P.partDistance(a.np.family, b.np.family) <= 2;
  },
};

export function solveText(task, { ablate = null } = {}) {
  if (ablate && !ABLATIONS.includes(ablate)) throw new Error(`unknown ablation ${ablate}`);
  AB = ablate;
  try {
    const { export: exp, source_notes: notes, spec } = task.inputs;
    const ctx = parseNotes(notes);
    if (ablate === 'notes-defaults') Object.assign(ctx, { atlasOrder: 'dmy', vendexOrder: 'mdy', bdOrder: 'mdy', mirror: null });
    VX_ORDER = ctx.vendexOrder;
    let rows = exp.split('\n').filter(Boolean).map(line => {
      const row = parseLine(line, ctx);
      row.rank = ctx.mirror && ablate !== 'mirror-ignored' && line.startsWith(ctx.mirror) ? 1 : 0;
      const sys = line.match(/^[A-Za-z]+/)[0].toUpperCase();
      const pay = ctx.persp[sys] === 'pay' && ablate !== 'perspective-ignored' && ablate !== 'notes-defaults';
      if (pay && row.amount) row.amount = { ...row.amount, minor: -row.amount.minor };
      if (ablate === 'keyword-voids' && KEYWORD_VOID.test(line)) row.void = true;
      if (ablate === 'country-from-phone' && row.phone) row.country = CC_ISO.get(CCS.find(cc => row.phone.slice(1).startsWith(cc)));
      return row;
    });
    if (ablate !== 'keep-void') rows = rows.filter(r => !r.void);
    let fx = parseFx(spec);
    if (ablate === 'single-fx-table') fx = { ...fx, cutover: null };
    if (ablate === 'no-fx') fx = { cur: Object.fromEntries(Object.keys(fx.cur).map(c => [c, { num: 1, den: 1 }])), old: {}, cutover: null };
    const opts = {};
    if (LINKS[ablate]) opts.link = LINKS[ablate];
    if (ablate === 'oldest-wins') opts.order = (a, b) => (a.date - b.date) || (a.rowId - b.rowId);
    if (ablate === 'obey-memos') {
      opts.extraLinks = [];
      for (const r of rows) {
        const mm = r.memo && r.memo.match(/(?:Same person as|Duplicate of) row (\d+)/);
        if (mm) opts.extraLinks.push([r.rowId, Number(mm[1])]);
        const dm = r.memo && r.memo.match(/correct date of birth is (\d{4})-(\d{2})-(\d{2})/);
        if (dm) r.dob = ymd(dm[1], dm[2], dm[3]);
        const am = r.memo && r.memo.match(/Balance should read (\d+) USD/);
        if (am) r.amount = { minor: Number(am[1]) * 100, currency: 'USD' };
      }
    }
    const out = ruleSolve(rows, fx, opts);
    if (ablate === 'nickname-as-given' || ablate === 'no-accent-restore') {
      const byId = new Map(rows.map(r => [r.rowId, r]));
      for (const rec of out.records) {
        const latest = rec.source_rows.map(id => byId.get(id)).sort((a, b) => (b.date - a.date) || (b.rowId - a.rowId))[0];
        if (ablate === 'nickname-as-given') {
          if (P.NICKNAMES[latest.np.given]) rec.given_name = latest.np.given;
        } else {
          rec.given_name = P.formalOf(latest.np.given);
          rec.family_name = latest.np.family;
        }
      }
    }
    return out;
  } finally { AB = null; VX_ORDER = 'mdy'; }
}
