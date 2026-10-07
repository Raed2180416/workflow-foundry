// Reserved-world registry (JUDGE-PROGRAM.md §2.3 rule 8, §3.1). Every (bed, split, difficulty,
// seed) already used as evaluation, real trace, probe or pilot is reserved: dev seeds 1-400 of every
// bed (the probe's range, which holds the records-hand-pilot worlds), the real-trace reserve (test
// 7000-7039) and the end-to-end reserve (test 7040-7199). No reserved world enters a train or calib
// file; a reserved world may appear only in the slice its reservation names. The ranges apply to
// every bed (BEDS lists the nine dev beds of the pin; the bed name is not checked against it).
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
