// Plain-code rules for the know-your-business SOP (sop.txt). Each rule is one the SOP states or the example answers
// reveal; none is keyed to an example row. Pure functions: no tools, no model.

export const DAY_MS = 86_400_000;
export const MAX_EXPIRED_DAYS = 42;      // 5.2.1: a licence more than 42 days expired (or expiring) against its date of entry escalates
export const UBO_PERCENT = 25;           // 3.1: a UBO owns or controls 25% or more
export const ACCOUNT_TYPES = ['Business', 'Checking', 'Savings'];
const REG_RE = /^REG\d{6}$/;
const LIC_RE = /^LIC\d{6}$/;
const TAX_RE = /^TIN(\d{6})$/i;          // 5.2.1: TIN (any case) followed by six digits
// 5.1.1: a known building, which may omit its street number (a World Trade Center or named tower).
const BUILDING_RE = /\b(tower|towers|centre|center|building|plaza|square|park|bay|harbou?r|court|complex|wtc|world trade center|house|mall)\b/i;
// Words that say nothing about which business a domain belongs to.
const GENERIC_WORDS = new Set(['the', 'and', 'of', 'inc', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'company', 'co', 'plc', 'group', 'holdings']);

export const text = v => (v === undefined || v === null ? '' : String(v).trim());
export const isBlank = v => text(v) === '';
export const upperCode = v => text(v).toUpperCase();
export const isRegistrationNumber = v => REG_RE.test(upperCode(v));
export const isLicenceNumber = v => LIC_RE.test(upperCode(v));
export const digitsOf = v => text(v).replace(/\D/g, '');
export const lettersOf = v => text(v).toLowerCase().replace(/[^a-z0-9]/g, '');
export const sameName = (a, b) => text(a).replace(/\s+/g, ' ').toLowerCase() === text(b).replace(/\s+/g, ' ').toLowerCase();

// 5.2.1: 'missing', 'malformed' (not TIN plus six digits), 'repeated-digit' (one digit six times) or 'valid'.
export function taxIdVerdict(tax) {
  if (isBlank(tax)) return 'missing';
  const m = TAX_RE.exec(text(tax));
  if (!m) return 'malformed';
  return new Set(m[1]).size === 1 ? 'repeated-digit' : 'valid';
}

// The host part of a website or e-mail address, as letters and digits, without 'www' and the top-level domain.
function domainCore(raw) {
  let s = text(raw).toLowerCase();
  if (s.includes('@')) s = s.split('@').pop();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#:]/)[0];
  let labels = s.split('.').filter(l => l && !/^w+$/.test(l));
  if (labels.length > 1) labels = labels.slice(0, -1);
  return labels.join('').replace(/[^a-z0-9]/g, '');
}

const significantWords = name => text(name).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !GENERIC_WORDS.has(w));

// 5.1.1: a website or e-mail domain must carry the pre-validated business name. Its significant words must appear in the
// domain, in order, each as the first three letters a domain makes of it ('digisys' carries Digital Systems, 'pactradesol'
// carries Pacific Trading Solutions), and at least half of them must; or the name's initials appear as an abbreviation
// (for example 'ntg' for Northwest Trading Group). A domain that carries one word of a longer name ('www.cay' for Cayman
// Strategic Trust) or none of it ('psychotics' for Grand Cayman Trust) does not.
export function domainCarriesName(name, address) {
  const core = domainCore(address);
  if (!core) return false;
  const words = significantWords(name);
  const initials = text(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(w => w[0]).join('');
  if (initials.length >= 3 && core.includes(initials)) return true;
  if (!words.length) {
    const whole = lettersOf(name);
    return whole !== '' && core.includes(whole);
  }
  let at = 0;
  let found = 0;
  for (const w of words) {
    const abbr = w.slice(0, 3);
    const p = core.indexOf(abbr, at);
    if (p >= 0) {
      found++;
      at = p + abbr.length;
    }
  }
  return found * 2 >= words.length;
}

// 5.1.1: an address has a street part and a city after it, separated by a comma. The street part has a street number and a
// road name, or it is a known building that may omit the number.
export function addressIsComplete(address) {
  const [street = '', city = ''] = text(address).split(',').map(p => p.trim());
  const numbered = /\d/.test(street) && street.replace(/\d+/g, '').trim() !== '';
  return (numbered || BUILDING_RE.test(street)) && /[a-z]/i.test(city);
}

// The registry's dates start 'YYYY-MM-DD' (any time after that is ignored); null when absent or unreadable.
export function dayOf(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(v));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

// 5.2.1: how far the licence's expiry lies from its date of entry, in days (positive: the expiry is after the entry; negative:
// the licence had already expired at the entry); null if a date is missing.
export function licenceSpanDays(entry, expiry) {
  const e = dayOf(entry);
  const x = dayOf(expiry);
  return e === null || x === null ? null : Math.round((x - e) / DAY_MS);
}

// 5.2.1 registration status: 'Active' passes, a missing status is unknown, any other status escalates.
export function registrationVerdict(status) {
  if (isBlank(status)) return 'unknown';
  return /^active\b/i.test(text(status)) ? 'ok' : 'escalate';
}

// 5.5.1 bank verification: 'Verified' passes, a flagged or failed check escalates, anything else is unclear.
export function bankStatusVerdict(status) {
  const t = text(status);
  if (/^verified$/i.test(t)) return 'ok';
  if (/flag|fail|reject|mismatch|fraud|suspic|invalid|closed/i.test(t)) return 'escalate';
  return 'unknown';
}

// 5.4: a sanctions or PEP status. 'clear' passes; a match, a pending screen or a potential hit escalates; anything else is unknown.
export function screeningVerdict(status) {
  const t = text(status).toLowerCase();
  if (!t) return 'unknown';
  if (/^(clear|cleared|no|none|negative|false|no match|not matched|not a match)$/.test(t)) return 'clear';
  if (/match|hit|pending|potential|possible|review|positive|confirmed|yes|true/.test(t)) return 'escalate';
  return 'unknown';
}

// A tool's yes/no field as true or false; null when it is neither.
export function flagValue(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const t = text(v).toLowerCase();
  if (/^(true|yes|y|1)$/.test(t)) return true;
  if (/^(false|no|n|0)$/.test(t)) return false;
  return null;
}

// 5.2.1 cross-jurisdiction: a state field may name several jurisdictions, separated by ';', '|' or ' / '.
export const jurisdictionsOf = s => [...new Set(text(s).split(/\s*[;|]\s*|\s+\/\s+/).map(x => x.trim()).filter(Boolean))];

// The account type as the tool's enum spells it, or null.
export const accountTypeOf = v => ACCOUNT_TYPES.find(t => t.toLowerCase() === text(v).toLowerCase()) ?? null;

export function toPercent(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number.parseFloat(text(v).replace('%', ''));
  return Number.isFinite(n) ? n : null;
}

// Owner records as { name, id, ownership }; ownership is a number, or null when it is not one.
export function owners(list) {
  return (Array.isArray(list) ? list : []).map(o => ({ name: text(o?.name), id: text(o?.id), ownership: toPercent(o?.ownership) }));
}

// 5.3.1: an owner with a name, an ID and at least 25% is a UBO.
export const isUbo = o => o.name !== '' && o.id !== '' && o.ownership !== null && o.ownership >= UBO_PERCENT;

// Two UBO lists agree when they hold the same IDs, names and percentages (to half a point).
export function sameUbos(a, b) {
  const byId = new Map(b.map(o => [o.id, o]));
  return a.length === b.length && a.every(o => {
    const m = byId.get(o.id);
    return m !== undefined && sameName(m.name, o.name) && Math.abs(m.ownership - o.ownership) <= 0.5;
  });
}
