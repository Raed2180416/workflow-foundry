// Per-(bed, split) seed ledger (BLOCKER-SYNTHESIS S0-5): research/jit-20261008/SEED-LEDGER.json, read here and refused
// against before any stream runs. stream.mjs normalizeConfig calls assertSeedsAllowed; experiments/kev-data/lib/registry.mjs
// reads the same file (its own small reader: a Kev mutant copy cannot import this directory) and refuses every range another
// owner holds as reserved or fresh.
//
// assertSeedsAllowed({ bed, split, seeds, purpose }) refuses, with error code SEED_REFUSED and one detail per seed:
//   - an unknown purpose, or a purpose on the wrong split;
//   - a seed in a range whose allow list does not name the purpose (reserved by another owner or for another use);
//   - a seed in a used or burned range when the purpose needs fresh seeds;
//   - a held-out seed below rules.heldoutMinSeed (8001).
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const LEDGER_FILE = path.join(REPO, 'research/jit-20261008/SEED-LEDGER.json');
export const LEDGER_STATUSES = Object.freeze(['reserved', 'fresh', 'used', 'burned', 'clean']);
const SPENT = new Set(['used', 'burned']);

// The stream's purpose when the config names none: held-out on the test split, a dev stream otherwise.
export const defaultPurpose = split => (split === 'test' ? 'jit-heldout' : 'jit-dev');

export function validateLedger(ledger) {
  const bad = m => { throw new Error(`seed ledger: ${m}`); };
  if (ledger?.schema !== 'seed-ledger/1') bad('schema must be seed-ledger/1');
  if (!Number.isInteger(ledger.rules?.heldoutMinSeed)) bad('rules.heldoutMinSeed must be an integer');
  if (!ledger.purposes || typeof ledger.purposes !== 'object') bad('purposes is required');
  for (const [k, p] of Object.entries(ledger.purposes)) if (!['dev', 'test'].includes(p.split) || typeof p.fresh !== 'boolean') bad(`purpose ${k} needs split dev|test and fresh true|false`);
  if (!Array.isArray(ledger.ranges)) bad('ranges must be a list');
  const ids = new Set();
  for (const r of ledger.ranges) {
    if (!r.id || ids.has(r.id)) bad(`range id missing or repeated: ${r.id}`);
    ids.add(r.id);
    if (!Array.isArray(r.beds) || !r.beds.length) bad(`${r.id}: beds must be a non-empty list`);
    if (!['dev', 'test'].includes(r.split)) bad(`${r.id}: split must be dev or test`);
    if (!Number.isInteger(r.from) || !(r.to === null || (Number.isInteger(r.to) && r.to >= r.from))) bad(`${r.id}: from must be an integer and to an integer >= from (or null: open)`);
    if (!LEDGER_STATUSES.includes(r.status)) bad(`${r.id}: status must be one of ${LEDGER_STATUSES.join(', ')}`);
    if (r.allow !== null && !(Array.isArray(r.allow) && r.allow.every(p => p in ledger.purposes))) bad(`${r.id}: allow must be null or a list of known purposes`);
    if (typeof r.source !== 'string' || !r.source) bad(`${r.id}: source is required`);
  }
  return ledger;
}

export const loadLedger = (file = LEDGER_FILE) => validateLedger(JSON.parse(readFileSync(file, 'utf8')));

export const rangeCovers = (r, { bed, split, seed }) => r.split === split && (r.beds.includes('*') || r.beds.includes(bed)) && seed >= r.from && (r.to === null || seed <= r.to);
export const rangesOf = (ledger, world) => ledger.ranges.filter(r => rangeCovers(r, world));

// Why one seed is refused for a purpose (a list of reasons; empty when allowed).
export function seedRefusals(ledger, { bed, split, seed, purpose }) {
  const p = ledger.purposes[purpose];
  if (!p) return [`unknown purpose ${purpose} (ledger purposes: ${Object.keys(ledger.purposes).join(', ')})`];
  if (p.split !== split) return [`purpose ${purpose} is for the ${p.split} split, not ${split}`];
  if (!Number.isInteger(seed)) return [`seed ${seed} is not an integer`];
  const out = [];
  if (p.heldout && seed < ledger.rules.heldoutMinSeed) out.push(`held-out seeds must be >= ${ledger.rules.heldoutMinSeed}`);
  for (const r of rangesOf(ledger, { bed, split, seed })) {
    if (r.allow && !r.allow.includes(purpose)) out.push(`range ${r.id} (${r.status}, owner ${r.owner}) is reserved for ${r.allow.join('|')}`);
    if (p.fresh && SPENT.has(r.status)) out.push(`range ${r.id} is ${r.status} and ${purpose} needs fresh seeds`);
  }
  return out;
}

export function assertSeedsAllowed({ bed, split, seeds, purpose, ledger = null }) {
  const L = ledger ?? loadLedger();
  const refused = seeds.map(seed => ({ seed, reasons: seedRefusals(L, { bed, split, seed, purpose }) })).filter(x => x.reasons.length);
  if (refused.length) {
    const e = new Error(`SEED_REFUSED: ${refused.length} ${bed}:${split} seed(s) refused for ${purpose}: ${refused.slice(0, 4).map(x => `s${x.seed} (${x.reasons.join('; ')})`).join(', ')}${refused.length > 4 ? ', ...' : ''}`);
    e.code = 'SEED_REFUSED'; e.details = refused; throw e;
  }
  return { bed, split, purpose, seeds: seeds.length };
}
