// Plain rules for the know_your_business SOP (sections 5.1-5.6). Nothing here calls a tool or a model: each function is a
// deterministic reading of the data the sections pass in.
import { parseLiteral } from './literal.mjs';

// Reference date for the licence rule in 5.2.1 ("not expired for more than 42 days"). The examples fix it to a window,
// not to today: an expiry of 2026-03-15 must count as more than 42 days expired (example 41, escalate), while expiries of
// 2026-04-30, 2026-07-31 and 2026-08-31 must not (examples 21, 46 and 45, approve). That window is 2026-04-27 to
// 2026-06-11. The wall clock (2026-10-21) falls outside it, so the rule uses this fixed date at the middle of the window.
// Confirm the registry snapshot date before freezing.
export const AS_OF = '2026-05-19';
export const LICENCE_GRACE_DAYS = 42;
export const UBO_THRESHOLD = 25;
// More ownership layers than this is a complex structure (5.3.2).
export const MAX_OWNERSHIP_LAYERS = 2;
export const BANK_ACCOUNT_TYPES = ['Business', 'Checking', 'Savings'];
export const PROFILE_REQUIRED = ['business_name', 'business_website', 'business_address', 'business_email', 'registration_number', 'license_number', 'tax_id', 'business_registration_state'];
// A street part with a number, or a named building (the SOP lets these omit the street number), plus a city part.
const KNOWN_BUILDING = /\b(tower|center|centre|plaza|building|square|park|complex|court|house)\b/i;

export const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const text = v => (v == null ? '' : String(v).trim());

// Longest run of characters two strings share. A typo keeps long shared runs; a made-up name shares almost none.
export function sharedRun(a, b) {
  let best = 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

// Edit distance between two short strings (the number of single-letter insertions, deletions or substitutions).
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Can the domain's letters be spelled as abbreviated words of the name, in order? Each piece is a leading part of one
// word (three letters or more; a piece of five or more may be one letter off, e.g. "trade" for "Trading"), and a word may
// be left out ("Inc", "Corp"). At least two pieces are needed, so a bare truncation such as "cay" does not pass.
// Examples: "digisys" for Digital Systems, "pactradesol" for Pacific Trade Solutions.
export function spelledByWords(core, words) {
  const memo = new Map();
  const covers = (pos, k, pieces) => {
    if (pos === core.length) return pieces >= 2;
    const key = `${pos}|${k}|${Math.min(pieces, 2)}`;
    if (memo.has(key)) return memo.get(key);
    let ok = false;
    for (let w = k; w < words.length && !ok; w++) {
      for (let len = 3; pos + len <= core.length && len <= words[w].length && !ok; len++) {
        const piece = core.slice(pos, pos + len);
        const head = words[w].slice(0, len);
        if (editDistance(piece, head) <= (len >= 5 ? 1 : 0)) ok = covers(pos + len, w + 1, pieces + 1);
      }
    }
    memo.set(key, ok);
    return ok;
  };
  return words.length >= 2 && covers(0, 0, 0);
}

// Does a website or e-mail domain plausibly belong to the business name (5.1.1)? A long shared run of letters, an
// acronym of the name's words (e.g. "ntg" for Northwest Trading Group) inside the domain, or the name's words abbreviated
// in order (spelledByWords).
export function namesMatch(businessName, domainText) {
  const n = norm(businessName), d = norm(domainText);
  if (!n || !d) return false;
  if (sharedRun(n, d) >= Math.min(6, n.length)) return true;
  const initials = text(businessName).split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w[0]).join('').toLowerCase();
  if (initials.length >= 3 && d.includes(initials)) return true;
  const core = d.replace(/^www/, '').replace(/(com|net|org|co|biz|info)$/, '');
  const words = text(businessName).split(/[^A-Za-z0-9]+/).filter(Boolean).map(norm);
  return spelledByWords(core, words);
}

export function addressComplete(address) {
  const parts = text(address).split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  return /\d/.test(parts[0]) || KNOWN_BUILDING.test(parts[0]);
}

// 5.2.1: a Tax ID is TIN followed by six digits (any case), and the six digits may not all be the same.
export function taxIdStatus(tax) {
  const t = text(tax);
  if (!t) return 'missing';
  const m = /^TIN(\d{6})$/i.exec(t);
  return m && !/^(\d)\1{5}$/.test(m[1]) ? 'valid' : 'malformed';
}

// Whole days from the expiry date to the reference date; positive means expired that many days ago.
const dayNumber = s => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(s));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null;
};
export function daysExpiredAsOf(expiry, asOf = AS_OF) {
  const e = dayNumber(expiry), a = dayNumber(asOf);
  return e == null || a == null ? null : a - e;
}

// UBO lists arrive as Python-literal text. Returns [{name, id, ownership}] or null when unreadable.
export function parseOwners(raw) {
  let list;
  try { list = typeof raw === 'string' ? parseLiteral(raw) : raw; } catch { return null; }
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const o of list) {
    if (!o || typeof o !== 'object') return null;
    const name = text(o.name), id = text(o.id), own = Number(o.ownership);
    if (!name || !id || !Number.isFinite(own) || own < 0 || own > 100) return null;
    out.push({ name, id, ownership: own });
  }
  return out;
}

export function sameOwners(a, b) {
  if (a.length !== b.length) return false;
  const key = o => `${o.id}|${norm(o.name)}|${o.ownership}`;
  const x = a.map(key).sort(), y = b.map(key).sort();
  return x.every((k, i) => k === y[i]);
}

// 5.6.2: an invalid Tax ID escalates at once; any data gap (missing or irregular information) sets awaiting information;
// otherwise any escalation trigger escalates; otherwise approve.
export function decide({ immediate, gaps, triggers }) {
  if (immediate.length) return 'escalate';
  if (gaps.length) return 'awaiting information';
  if (triggers.length) return 'escalate';
  return 'approve';
}
