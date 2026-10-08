// Shared helpers for the Zoho CRM and KlickTipp mocks (deterministic: no wall clock, no Math.random).
export const normEmail = e => (typeof e === 'string' ? e.trim().toLowerCase() : '');
export const isEmail = e => typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
export const isIsoDate = d => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
};
// ISO date <-> unix seconds at UTC midnight (KlickTipp stores date fields as unix seconds; ASSUMPTION A9).
export const isoToUnix = d => String(Date.parse(`${d}T00:00:00Z`) / 1000);
// Total: a value that is not a representable date maps to 'invalid:<value>' instead of throwing (an oracle must not crash on solver data).
export const unixToIso = s => {
  if (s === '' || s == null) return '';
  const d = new Date(Number(s) * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : `invalid:${String(s).slice(0, 40)}`;
};
export const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
export const res = (status, body) => ({ status, body });
