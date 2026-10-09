// Reserved-world registry (JUDGE-PROGRAM.md §2.3 rule 8, §3.1). Every (bed, split, difficulty,
// seed) already used as evaluation, real trace, probe or pilot is reserved: dev seeds 1-400 of every
// bed (the probe's range, which holds the records-hand-pilot worlds), the real-trace reserve (test
// 7000-7039) and the end-to-end reserve (test 7040-7199). No reserved world enters a train or calib
// file; a reserved world may appear only in the slice its reservation names. The ranges apply to
// every bed (BEDS lists the nine dev beds of the pin; the bed name is not checked against it).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BEDS = Object.freeze(['records', 'incident', 'synth', 'kinetics', 'runbook', 'gameqa', 'gridquest', 'codefix', 'ownerci']);

export const RESERVATIONS = Object.freeze([
  Object.freeze({ id: 'probe-pilot', bedSplit: 'dev', seeds: [1, 400], difficulties: null, allowedSlices: [], use: 'kev-probe datasets and pilots (records-hand-pilot: dev d2 s101-s103, d3 s101-s102); never trained, calibrated or evaluated here' }),
  Object.freeze({ id: 'real-reserve', bedSplit: 'test', seeds: [7000, 7039], difficulties: null, allowedSlices: ['real-reserve'], use: 'weak-model runs on records extraction (X8-real axis, X8 end-to-end), d3-d5' }),
  Object.freeze({ id: 'e2e-reserve', bedSplit: 'test', seeds: [7040, 7199], difficulties: null, allowedSlices: ['e2e-reserve'], use: 'X5 end-to-end reuse gate (§8.3)' }),
]);

const KEY = /^([a-z][a-z0-9-]*):(dev|test):d([1-5]):s(\d+)$/;
export const worldKey = ({ bed, split, difficulty, seed }) => `${bed}:${split}:d${difficulty}:s${seed}`;
export function parseWorldKey(key) {
  const m = KEY.exec(String(key));
  if (!m) throw new Error(`not a world key (bed:split:dN:sN): ${key}`);
  return { bed: m[1], split: m[2], difficulty: Number(m[3]), seed: Number(m[4]) };
}

export function reservationOf(world) {
  const w = typeof world === 'string' ? parseWorldKey(world) : world;
  return RESERVATIONS.find(r => r.bedSplit === w.split && w.seed >= r.seeds[0] && w.seed <= r.seeds[1]
    && (!r.difficulties || r.difficulties.includes(w.difficulty))) ?? null;
}
export const isReserved = world => reservationOf(world) !== null;

// The check the build applies to every record: a reserved world in a slice its reservation does not
// name is an error (never a silent drop: a planted records:dev:d3:s101 in train fails the build).
export function reservedViolation(world, slice) {
  const l = ledgerReservationOf(world);
  if (l) return { world: typeof world === 'string' ? world : worldKey(world), slice, reservation: `ledger:${l.id}` };
  const r = reservationOf(world);
  if (!r || r.allowedSlices.includes(slice)) return null;
  return { world: typeof world === 'string' ? world : worldKey(world), slice, reservation: r.id };
}
export function assertNoReserved(worlds, slice) {
  const bad = worlds.map(w => reservedViolation(w, slice)).filter(Boolean);
  if (bad.length) {
    const e = new Error(`RESERVED_WORLD: ${bad.length} reserved world(s) in ${slice}: ${bad.slice(0, 5).map(b => `${b.world} (${b.reservation})`).join(', ')}`);
    e.code = 'RESERVED_WORLD'; e.details = bad; throw e;
  }
}

// The JIT seed ledger (research/jit-20261008/SEED-LEDGER.json; BLOCKER-SYNTHESIS S0-5): a world in a range that another
// owner holds as reserved or fresh (the JIT's R0, out-of-sample and held-out seeds) enters no Kev slice at all. Read here
// directly, because a mutant copy links research/ but not experiments/jit/ (experiments/jit/seeds.mjs is the full checker).
// A missing or unreadable ledger fails closed.
export const LEDGER_FILE = fileURLToPath(new URL('../../../research/jit-20261008/SEED-LEDGER.json', import.meta.url));
let ledgerHeld = null;
export function ledgerHeldRanges() {
  if (!ledgerHeld) {
    const ledger = JSON.parse(readFileSync(LEDGER_FILE, 'utf8'));
    if (ledger?.schema !== 'seed-ledger/1' || !Array.isArray(ledger.ranges)) throw new Error(`seed ledger ${LEDGER_FILE}: not a seed-ledger/1 file`);
    ledgerHeld = Object.freeze(ledger.ranges.filter(r => r.owner !== 'kev' && (r.status === 'reserved' || r.status === 'fresh')).map(r => Object.freeze({ ...r })));
  }
  return ledgerHeld;
}
export function ledgerReservationOf(world) {
  const w = typeof world === 'string' ? parseWorldKey(world) : world;
  return ledgerHeldRanges().find(r => r.split === w.split && (r.beds.includes('*') || r.beds.includes(w.bed)) && w.seed >= r.from && (r.to === null || w.seed <= r.to)) ?? null;
}
