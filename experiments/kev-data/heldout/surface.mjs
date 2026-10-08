// Consumer API for the held-out surface pools: the only reader of .foundry/kev-data/heldout/ outside
// this group is the `assembly` group (JUDGE-BUILD-PLAN.json). Bed-group ports/ and taps/ never
// import this module or the heldout directory (the test scans for it).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { HELDOUT_DIR } from './author.mjs';
import { COUNTRIES } from './gazetteer.mjs';
import { pick } from './fill.mjs';

const readJsonl = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
export const SURFACE_STATUSES = Object.freeze(['admitted', 'pending-filter', 'reserve', 'rejected', 'carrier']);

// Units of one port's surface file. By default only units that passed the two-model filter
// ('admitted') are returned; a development build passes statuses: ['admitted', 'pending-filter', 'carrier'].
export function loadSurface(port, { dir = HELDOUT_DIR, slice = null, role = null, label = null, statuses = ['admitted'] } = {}) {
  return readJsonl(path.join(dir, 'surface', `${port}.jsonl`))
    .filter(u => statuses.includes(u.status) && (!slice || u.slice === slice) && (!role || u.role === role) && (label === null || u.label === label));
}
export function loadWordings(dir = HELDOUT_DIR) { return readJsonl(path.join(dir, 'wordings.jsonl')); }
export function loadCities(dir = HELDOUT_DIR) { return JSON.parse(readFileSync(path.join(dir, 'cities.json'), 'utf8')).cities; }

// Lines keyed for lib/counterfactual.mjs listProvider: key `${port}:${label}:${slice}`, each {text, from}
// ordered by skeleton hash (the same index in two labels is not a pairing; the pools are independent).
export function providerLines(units) {
  const out = {};
  for (const u of units) (out[`${u.port}:${u.label ?? u.role}:${u.slice}`] ??= []).push({ text: u.text, from: `heldout:${u.id}` });
  return out;
}

// The three placeholders the records line provider (ports/records-notes.mjs fillLine, the train pools' slot vocabulary)
// does not know: {S2}, {city}, {country}. A consumer calls this first and passes the result to its own provider, which
// fills {S} {token} {w0} {w1} {field} from the world. {S2} becomes a system other than `system`; {city} and {country}
// come from the held-out list (cities.json) of the unit's own slice with the order being instantiated (a knowledge
// line carries labels ['dmy', 'mdy']: the order you instantiate is its label). Deterministic in (unit, salt).
// Added by the 2026-10-08 review (second pass); the pools' own lint keeps every other placeholder in the vocabulary.
const SYSTEMS = Object.freeze(['BRIGHTDESK', 'ATLAS', 'VENDEX', 'LEDGR', 'KOBO', 'VERITAS']);
const COUNTRY_NAMES = Object.freeze(Object.fromEntries(Object.entries(COUNTRIES)));
export function prefillHeldoutSlots(unit, { cities = [], order = null, system = null, salt = '' } = {}) {
  const key = `${unit.id}:${salt}`, text = { text: unit.text, assumption: unit.assumption ?? null };
  const need = n => [unit.text, unit.assumption].some(t => t && t.includes(`{${n}}`));
  const out = {};
  if (need('S2')) out.S2 = pick(SYSTEMS.filter(s => s !== system), `${key}:S2`);
  if (need('city') || need('country')) {
    if (order !== 'dmy' && order !== 'mdy') throw new Error(`${unit.id}: {city}/{country} need the order being instantiated (dmy or mdy)`);
    const pool = cities.filter(c => c.order === order && c.slice === unit.slice);
    if (!pool.length) throw new Error(`${unit.id}: no held-out ${order} city in ${unit.slice}`);
    const c = pick(pool, `${key}:c:${order}`);
    out.city = c.city; out.country = COUNTRY_NAMES[c.cc];
  }
  const fill = t => (t === null ? null : t.replace(/\{(S2|city|country)\}/g, (m, n) => out[n] ?? m));
  return { text: fill(text.text), assumption: fill(text.assumption), values: out };
}
