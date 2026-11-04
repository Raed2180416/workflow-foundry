// Seeded world-generation helpers for CI-1 item generators (bed/items/<id>/gen.mjs). First-party data pools: distinctive fake names so
// that world values never coincide with words written in a template (facts must be detectable), and .example/.test domains only.
export function rng(seed) {
  let s = (Number(seed) >>> 0) || 1;
  const next = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const R = {
    next, int: (a, b) => a + Math.floor(next() * (b - a + 1)), chance: p => next() < p, pick: xs => xs[Math.floor(next() * xs.length)],
    pickN: (xs, n) => { const c = [...xs]; const out = []; while (out.length < n && c.length) out.push(c.splice(Math.floor(next() * c.length), 1)[0]); return out; },
    money: (a, b, cents = true) => { const v = a + next() * (b - a); return cents ? Math.round(v * 100) / 100 : Math.round(v); },
    shuffle: xs => R.pickN(xs, xs.length),
    // a value near a threshold: below, at, or above (boundary worlds)
    around: (t, step = 1) => R.pick([t - step, t, t + step, t - 2 * step, t + 2 * step]),
  };
  return R;
}
export const FIRST = ['Amara', 'Bastian', 'Calla', 'Dorian', 'Elif', 'Fenwick', 'Galina', 'Hollis', 'Ingrid', 'Jasper', 'Kiran', 'Lucinda', 'Mateo', 'Noor', 'Odette', 'Pavel', 'Quinlan', 'Rosalind', 'Soren', 'Talia', 'Ulric', 'Vesna', 'Wendell', 'Xiomara', 'Yusuf', 'Zelda'];
export const LAST = ['Ashcombe', 'Brennagh', 'Castellan', 'Dunmore', 'Ellery', 'Fairhurst', 'Grieve', 'Hartigan', 'Ivers', 'Jessop', 'Kilbride', 'Lorrimer', 'Marchetti', 'Northcott', 'Okonkwo', 'Pemberton', 'Quayle', 'Rothwell', 'Silvana', 'Thackeray', 'Underhill', 'Vantongeren', 'Whitlock', 'Yarrow'];
export const COMPANY = ['Brightwater Tiles', 'Kestrel Optics', 'Lumen Bakery', 'Quarry Lane Books', 'Harbourline Freight', 'Mossgrove Dental', 'Tidewell Studio', 'Orchid Ridge Farms', 'Copperleaf Legal', 'Saltmarsh Cycles', 'Juniper Mill', 'Falconcrest Labs', 'Wrenfield Clinic', 'Ashgrove Motors', 'Bluefinch Media', 'Cindervale Brewing'];
export const PRODUCT = ['Ceramic kettle', 'Walnut desk', 'Linen apron', 'Brass lamp', 'Cedar planter', 'Wool throw', 'Glass carafe', 'Oak stool', 'Copper pan', 'Slate coaster'];
export const CITY = ['Oslo', 'Porto', 'Tallinn', 'Ghent', 'Bergen', 'Lyon', 'Graz', 'Aarhus', 'Malmo', 'Turku'];
export const person = R => { const f = R.pick(FIRST), l = R.pick(LAST); return { first: f, last: l, name: `${f} ${l}`, email: `${f}.${l}`.toLowerCase() + `@${R.pick(['mailbox', 'inbox', 'post'])}.example` }; };
/** ISO date `days` from `now` (negative = past), YYYY-MM-DD. */
export const day = (now, days) => new Date(Date.parse(now) + days * 86400000).toISOString().slice(0, 10);
export const at = (now, ms) => new Date(Date.parse(now) + ms).toISOString();
/** Distinct people (no repeated first or last name inside one world, so every row has identity tokens). */
export function people(R, n) { const f = R.pickN(FIRST, n), l = R.pickN(LAST, n); return f.map((x, i) => ({ first: x, last: l[i], name: `${x} ${l[i]}`, email: `${x}.${l[i]}`.toLowerCase() + `@${R.pick(['mailbox', 'inbox', 'post'])}.example` })); }
