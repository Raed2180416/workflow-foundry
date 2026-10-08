// Consumer API for the held-out surface pools: the only reader of .foundry/kev-data/heldout/ outside
// this group is the `assembly` group (JUDGE-BUILD-PLAN.json). Bed-group ports/ and taps/ never
// import this module or the heldout directory (the test scans for it).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { HELDOUT_DIR } from './author.mjs';

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
