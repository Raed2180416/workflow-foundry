// $0 raw-line parsers for the records export, written for this testbed from the bed README's documented dialects.
// Independent of the C0 solver (no model calls, no code shared with solve.mjs) and of beds/records/solve-text.mjs.
// They read only task.inputs.export; nothing here reads the notes, the spec or generator internals.

const FOLD = { 'ß': 'ss', 'æ': 'ae', 'ø': 'o', 'å': 'a', 'ł': 'l', 'đ': 'd' };
export const fold = s => String(s ?? '').toLowerCase().replace(/[ßæøåłđ]/g, c => FOLD[c]).normalize('NFD').replace(/[̀-ͯ]/g, '');
const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'herr', 'frau', 'sir', 'zztest', 'supplier', 'contact', 'entry', 'revised',
  'spoke', 'with', 'based', 'vendex', 'the', 'and', 'born', 'date', 'birth', 'dob', 'phone', 'mobile', 'reach', 'best', 'number', 'tel']);
export const nameTokens = text => [...new Set(fold(text).split(/[^a-z]+/).filter(t => t.length >= 3 && !TITLES.has(t)))];

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const p2 = n => String(n).padStart(2, '0');
export function validIso(y, m, d) {
  if (!(y >= 1850 && y <= 2030 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  const iso = `${y}-${p2(m)}-${p2(d)}`;
  return iso === '1900-01-01' ? null : iso;
}
const yr = y => (y < 100 ? 1900 + y : y);   // two-digit birth years are 19xx (README / render.mjs)

// A date string -> {kind:'iso', iso} for an unambiguous date, {kind:'num', a, b, y} for a numeric a/b/y (both <= 12 ambiguous), or null.
export function parseDob(raw) {
  const s = String(raw ?? '').trim();
  if (!s || /^0+[\/.\-]0+[\/.\-]0+$|^-+\/-+\/-+$|n\/k|^\?$|unknown|not on file/i.test(s)) return null;
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) { const iso = validIso(+m[1], +m[2], +m[3]); return iso ? { kind: 'iso', iso } : null; }
  if ((m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s))) { const iso = validIso(+m[1], +m[2], +m[3]); return iso ? { kind: 'iso', iso } : null; }
  if ((m = /^([SHR])(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/i.exec(s))) {
    const base = { S: 1925, H: 1988, R: 2018 }[m[1].toUpperCase()];
    const iso = validIso(base + +m[2], +m[3], +m[4]); return iso ? { kind: 'iso', iso } : null;
  }
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/.exec(s))) return { kind: 'num', a: +m[1], b: +m[2], y: yr(+m[3]) };
  const mon = w => MONTHS[String(w).slice(0, 3).toLowerCase()];
  if ((m = /^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?[\s\-]+([A-Za-z]{3,})[\s\-]+(\d{4}|\d{2})$/.exec(s)) && mon(m[2])) {
    const iso = validIso(yr(+m[3]), mon(m[2]), +m[1]); return iso ? { kind: 'iso', iso, named: true } : null;
  }
  if ((m = /^([A-Za-z]{3,})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s)) && mon(m[1])) {
    const iso = validIso(+m[3], mon(m[1]), +m[2]); return iso ? { kind: 'iso', iso, named: true } : null;
  }
  return null;
}
// LEDGR d.m.y (always day first, German).
function parseLedgrDob(raw) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(raw ?? '').trim());
  if (!m) return null;
  const iso = validIso(+m[3], +m[2], +m[1]);
  return iso ? { kind: 'iso', iso } : null;
}

const VX_DOB = /(?:\bborn|\bdate of birth|\bDOB|\bb\.)\s+((?:the\s+)?\d{1,2}(?:st|nd|rd|th)?(?:\s+of)?[\s\-]+[A-Za-z]{3,}[\s\-]+\d{2,4}|[A-Za-z]{3,}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i;

// One export line -> {sys, row, names (raw name text or the whole line for VENDEX), tokens, dob (parsed), phoneDigits, update}
export function parseLine(line) {
  let m;
  if ((m = /^BRIGHTDESK row=(\d+) \| name=([^|]*)\| dob=([^|]*)\|.*?\| phone=([^|]*)\|/.exec(line))) {
    return { sys: 'BRIGHTDESK', row: +m[1], tokens: nameTokens(m[2]), dob: parseDob(m[3]), phone: m[4].trim() };
  }
  if (line.startsWith('LEDGR;')) {
    const f = line.split(';');
    return { sys: 'LEDGR', row: +f[1], tokens: nameTokens(f[2]), dob: parseLedgrDob(f[4]), phone: f[6] };
  }
  if ((m = /^ATLAS #(\d+) :: (.*?) :: born (.*?) :: .*? :: tel (.*?) :: .*?:: last change ([^:]*?)(?: ::|$)/.exec(line))) {
    return { sys: 'ATLAS', row: +m[1], tokens: nameTokens(m[2].replace(/\(.*?\)/g, ' ')), dob: parseDob(m[3]), phone: m[4], update: m[5].trim() };
  }
  if ((m = /^KOBO\/(\d+) member: (.*?) \| birth: (.*?) \| tel: (.*?) \|/.exec(line))) {
    return { sys: 'KOBO', row: +m[1], tokens: nameTokens(m[2]), dob: parseDob(m[3]), phone: m[4] };
  }
  if ((m = /^VERITAS (\{.*\})$/.exec(line))) {
    try {
      const o = JSON.parse(m[1]);
      return { sys: 'VERITAS', row: o.row, tokens: nameTokens(`${o.given} ${o.family}`), dob: o.dob ? parseDob(o.dob) : null, phone: o.msisdn ? `+${o.msisdn}` : '' };
    } catch { return null; }
  }
  if ((m = /^Vendex (\d+) — (.*)$/.exec(line))) {
    const body = m[2].replace(/\bRemark:.*$/, '');
    const d = VX_DOB.exec(body);
    const ph = /(?:phone|reach at|tel\.|mobile|best number)\s+([+\d][\d\s().\-]{5,}\d)/i.exec(body);
    // The name sits before the first DOB / country / phone phrase; take the text before the DOB keyword or the first ';'/'—'.
    const head = body.split(/[;(—]|\b(?:born|date of birth|DOB|b\.)\b/i)[0].replace(/^(?:Supplier contact|Entry revised [^:]*:|Spoke with)\s*/i, '').replace(/\bon\b.*$/, '');
    return { sys: 'VENDEX', row: +m[1], tokens: nameTokens(head.split(',')[0]), lineTokens: nameTokens(body), dob: d ? parseDob(d[1]) : null, phone: ph ? ph[1] : '' };
  }
  return null;
}

export const parseExport = text => String(text ?? '').split('\n').map(s => s.trim()).filter(Boolean).map(parseLine).filter(Boolean);
