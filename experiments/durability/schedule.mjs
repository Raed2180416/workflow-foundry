// DUR-1 frozen schedule (research/durability-20261021/PREREG-DUR-1.md §3, §4.1) as data. $0, pure.
// Three streams of six E8 worlds (d3, tail mix); the program version carries from world to world; changes are cumulative
// unless marked transient (F) or reverted (E1 -> E1r). Days are world-days d1..d14; the stream day is 14(k-1)+d.
// A test parses the prereg's §4.1 table and compares it with this file (a one-cell edit to either side fails).
import { assertEbedSeeds } from '../lib/ebed-seeds.mjs';

export const T0 = '2026-03-02T00:00:00+01:00';
export const T0_MS = Date.parse(T0);
export const DAY_MS = 86_400_000;
export const MIN = 60_000;
export const HORIZON_DAYS = 14;
export const DIFFICULTY = 3;
export const MIX = 'tail';

/** Start of world-day d (1-based) in epoch ms; d = 15 is the horizon end. */
export const dayStart = d => T0_MS + (d - 1) * DAY_MS;
/** World-day (1-based) of an epoch-ms time inside a world (clamped to 1..14; times before t0 are day 1). */
export const dayOf = ms => Math.min(HORIZON_DAYS, Math.max(1, Math.floor((ms - T0_MS) / DAY_MS) + 1));
/** Stream day of world k, day d. */
export const streamDay = (k, d) => 14 * (k - 1) + d;
const at = (d, hhmm = '00:00') => { const [h, m] = hhmm.split(':').map(Number); return dayStart(d) + (h * 60 + m) * MIN; };
export const isoLocal = ms => `${new Date(ms + 60 * MIN).toISOString().slice(0, 19)}+01:00`;
export const dateLocal = ms => isoLocal(ms).slice(0, 10);

export const STREAMS = Object.freeze({
  s1: Object.freeze([1171, 1172, 1173, 1174, 1175, 1176]),
  s2: Object.freeze([1177, 1178, 1179, 1180, 1181, 1182]),
  s3: Object.freeze([1183, 1184, 1185, 1186, 1187, 1188]),
});
export const STREAM_IDS = Object.freeze(Object.keys(STREAMS));
/** World sizes (arriving orders): 80, W6 160 (2x volume). */
export const SIZES = Object.freeze([80, 80, 80, 80, 80, 160]);

/**
 * The nine changes (prereg §4.1). onset/publish are world-days of the world the change starts in; sealed changes take
 * their onset from the sealed bundle (null here). `persist`: in force in every later world (from before t0) unless
 * `until` names the last world or `transient` is set. `floor`: the exposure floor per world where the change starts.
 */
export const CHANGES = Object.freeze({
  P1: Object.freeze({ id: 'P1', cls: 'CHG-A', kind: 'edition', world: 2, onset: { day: 6 }, publish: { day: 3, time: '09:00' }, floor: 10, visibleAs: 'rulebook', announced: true }),
  E1: Object.freeze({ id: 'E1', cls: 'CHG-U', kind: 'f5', world: 2, onset: { day: 9 }, until: 5, floor: 10, visibleAs: 'errors', announced: false }),
  R1: Object.freeze({ id: 'R1', cls: 'CHG-A', kind: 'rule', world: 3, onset: { day: 5 }, publish: { day: 2, time: '09:00' }, floor: 10, visibleAs: 'spec', announced: true }),
  R2s: Object.freeze({ id: 'R2s', cls: 'CHG-A', kind: 'rule', world: 4, onset: null, sealed: true, floor: 10, visibleAs: 'spec', announced: true, onsetBounds: [4, 6] }),
  L1: Object.freeze({ id: 'L1', cls: 'CHG-U', kind: 'load', world: 4, onset: { day: 1 }, floor: 8, visibleAs: 'none', announced: false }),
  F: Object.freeze({ id: 'F', cls: 'FLT', kind: 'fault', world: 5, onset: { day: 1 }, transient: true, floor: null, visibleAs: 'none', announced: false }),
  E2s: Object.freeze({ id: 'E2s', cls: 'CHG-U', kind: 'env', world: 5, onset: null, sealed: true, floor: 10, visibleAs: 'errors', announced: false, onsetBounds: [3, 6] }),
  ADV: Object.freeze({ id: 'ADV', cls: 'ADV', kind: 'adv', world: 5, onset: { day: 1 }, floor: null, visibleAs: 'documents', announced: false, complaintDay: 6 }),
  E1r: Object.freeze({ id: 'E1r', cls: 'CHG-U', kind: 'revert', world: 6, onset: { day: 1 }, floor: 10, visibleAs: 'errors', announced: false, reverts: 'E1' }),
  U1s: Object.freeze({ id: 'U1s', cls: 'CHG-U', kind: 'rule', world: 6, onset: null, sealed: true, floor: 6, visibleAs: 'complaints', announced: false, complaintsOnly: true, onsetBounds: [3, 5] }),
});
export const CHANGE_IDS = Object.freeze(Object.keys(CHANGES));
export const SEALED = Object.freeze(CHANGE_IDS.filter(c => CHANGES[c].sealed));
export const UNANNOUNCED = Object.freeze(['E1', 'L1', 'F', 'E2s', 'E1r', 'U1s']);
/** Rule changes in stacking order (one transition copy per world; each edit gated by its own effective date). */
export const RULE_ORDER = Object.freeze(['R1', 'R2s', 'U1s']);

/** Is change c in force (at some point) in world k? */
export function inForce(c, k) {
  const C = CHANGES[c];
  if (k < C.world) return false;
  if (C.transient && k !== C.world) return false;
  if (C.until !== undefined && k > C.until) return false;
  return true;
}

/**
 * Changes with an effective PLACEMENT date (a rule or a rulebook edition that applies to orders placed on or after a date).
 * Every world replays the same calendar fortnight (the generator's fixed t0), so such a change keeps, in every later world,
 * the effective date it was published with (truth, notice, contract readings, practice overlays): a heal that encodes the
 * published date stays correct in later worlds (fix 2026-11-04, review B7; with the date moved to the later world's t0, a
 * W3 heal that faithfully encoded R1's 2026-03-06 failed every W4-W6 order placed 03-02..03-05). API renames, loads,
 * faults and documents stay in force from the world start.
 */
export const DATED = Object.freeze(['P1', 'R1', 'R2s', 'E2s', 'U1s']);

/**
 * The change schedule of world k: [{ id, onsetMs, effMs, publishMs, startsHere }] in a fixed order. A change that started
 * in an earlier world is in force from the world's t0 (onsetMs = T0_MS), except that a DATED change applies to orders
 * placed on or after its original effective date (effMs, the start world's onset on the replayed calendar); the few
 * go-live backlog orders placed before t0 keep the rules and fees their migrated records were made under. Sealed onsets
 * come from `sealedOnsets` ({ R2s: { day, publishDay? }, ... }); without them a sealed change has onsetMs null.
 */
export function changesOf(k, { sealedOnsets = null } = {}) {
  const out = [];
  for (const c of CHANGE_IDS) {
    if (!inForce(c, k)) continue;
    const C = CHANGES[c];
    const here = C.world === k;
    const on = C.onset ?? sealedOnsets?.[c] ?? null;
    const startOnset = on ? at(on.day, on.time ?? '00:00') : null;
    let onsetMs = T0_MS, publishMs = null;
    if (here) {
      onsetMs = startOnset;
      const pub = C.publish ?? (C.sealed && C.announced && sealedOnsets?.[c]?.publishDay ? { day: sealedOnsets[c].publishDay, time: sealedOnsets[c].publishTime ?? '09:00' } : null);
      publishMs = pub ? at(pub.day, pub.time) : null;
    }
    const effMs = here ? onsetMs : DATED.includes(c) ? startOnset : T0_MS;
    out.push({ id: c, cls: C.cls, kind: C.kind, startsHere: here, onsetMs, effMs, publishMs });
  }
  return out;
}
/** The effective placement time of a scheduled change entry (older specs without effMs: the onset). */
export const effOf = c => (c?.effMs ?? c?.onsetMs ?? null);

/** The six worlds of a stream: [{ stream, k, seed, size, changes }]. */
export function worldsOf(stream, opts = {}) {
  const seeds = STREAMS[stream];
  if (!seeds) throw new Error(`unknown stream ${stream}`);
  return seeds.map((seed, i) => ({ stream, k: i + 1, seed, size: SIZES[i], difficulty: DIFFICULTY, mix: MIX, changes: changesOf(i + 1, opts) }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Seeds (prereg §3; draft claim, Appendix A). Every DUR-1 runner calls assertDurSeeds before it generates a world.

export const REHEARSAL = Object.freeze({ miniStream: Object.freeze([1207, 1208]), agentWindow: 1209, spare: 1210 });
export const AUTHOR_VALIDATION = Object.freeze([1223, 1224, 1225, 1226]);
export const PRACTICE = Object.freeze([{ seed: 1235, d: 2 }, { seed: 1236, d: 3 }, { seed: 1237, d: 5 }].map(Object.freeze));
export const GRADING_REPLAY = Object.freeze([1232, 1233, 1234]);
export const FUZZ_BASES = Object.freeze([1301, 1302, 1303, 1304, 1305, 1306, 1307, 1308, 1309, 1310]);
export const LATENT_MANIFEST_SEEDS = Object.freeze([1101, 1102]);
/** Ranges DUR-1 must never touch (composition harness, held-out, sealed, scale, AutomationBench-R). */
export const UNTOUCHED = Object.freeze([[1161, 1168], [9101, 9104], [9201, 9204], [9301, 9302], [8801, 8840]].map(Object.freeze));
const PURPOSE = { 'ebed-dev': 'jit-dev', 'ebed-dev-fuzz': 'jit-dev', 'ebed-e8-rehearsal': 'ebed-rehearsal' };
const inRange = (s, [a, b]) => s >= a && s <= b;
/** DUR-1's own claim: which seeds it may use, for which ledger block. */
export const CLAIMED = Object.freeze([
  { block: 'ebed-dev', from: 1171, to: 1188, use: 'streams' },
  { block: 'ebed-dev', from: 1101, to: 1102, use: 'latent-defect manifests (reused)' },
  { block: 'ebed-dev-fuzz', from: 1301, to: 1310, use: 'WC-1 fuzz bases' },
  { block: 'ebed-e8-rehearsal', from: 1207, to: 1210, use: 'rehearsal' },
  { block: 'ebed-e8-rehearsal', from: 1223, to: 1226, use: 'sealed author validation (count-only)' },
  { block: 'ebed-e8-rehearsal', from: 1232, to: 1234, use: 'grading-world replay check V-11 (reused)' },
  { block: 'ebed-e8-rehearsal', from: 1235, to: 1237, use: 'practice, calibration, canary base (reused)' },
].map(Object.freeze));

/** Refuse any seed outside DUR-1's claim or inside an untouched range; then the ledger's own E-bed confinement. */
export function assertDurSeeds(seeds, { ledger = null } = {}) {
  const bad = [];
  const byPurpose = new Map();
  for (const s of seeds) {
    if (!Number.isInteger(s)) { bad.push(`${s}: not an integer`); continue; }
    const u = UNTOUCHED.find(r => inRange(s, r));
    if (u) { bad.push(`${s}: in the untouched range ${u[0]}-${u[1]}`); continue; }
    const cl = CLAIMED.find(c => inRange(s, [c.from, c.to]));
    if (!cl) { bad.push(`${s}: outside DUR-1's claim`); continue; }
    const p = PURPOSE[cl.block];
    if (!byPurpose.has(p)) byPurpose.set(p, []);
    byPurpose.get(p).push(s);
  }
  if (bad.length) { const e = new Error(`DUR1_SEED_REFUSED: ${bad.join('; ')}`); e.code = 'DUR1_SEED_REFUSED'; throw e; }
  for (const [purpose, list] of byPurpose) assertEbedSeeds({ bed: 'ebed-e8', split: 'dev', seeds: list, purpose, ledger });
  return { seeds: seeds.length };
}

/** Every seed the schedule uses (streams, rehearsal, author, practice, replay, fuzz bases). */
export function allScheduledSeeds() {
  return [...Object.values(STREAMS).flat(), ...REHEARSAL.miniStream, REHEARSAL.agentWindow, REHEARSAL.spare, ...AUTHOR_VALIDATION,
    ...PRACTICE.map(p => p.seed), ...GRADING_REPLAY, ...FUZZ_BASES, ...LATENT_MANIFEST_SEEDS];
}

// ---------------------------------------------------------------------------------------------------------------------
// The $0 dry-run schedule (rehearsal seeds 1207-1208, small worlds): every designer-known operator and the stub sealed
// changes compressed into two worlds, so the whole loop runs end to end in minutes. It is never a DUR-1 result.
export const DRY = Object.freeze({
  stream: 'r1', seeds: REHEARSAL.miniStream, size: 24,
  worlds: Object.freeze([
    Object.freeze({ k: 1, adds: [{ id: 'P1', onset: { day: 4 }, publish: { day: 2, time: '09:00' } }, { id: 'E1', onset: { day: 6 } }, { id: 'R1', onset: { day: 3 }, publish: { day: 1, time: '09:00' } }] }),
    Object.freeze({ k: 2, adds: [{ id: 'R2s', onset: { day: 4 }, publish: { day: 2, time: '09:00' } }, { id: 'L1', onset: { day: 1 } }, { id: 'F', onset: { day: 1 } },
      { id: 'E2s', onset: { day: 3 } }, { id: 'ADV', onset: { day: 1 } }, { id: 'E1r', onset: { day: 1 } }, { id: 'U1s', onset: { day: 3 } }] }),
  ]),
});

/** The dry-run worlds in the same shape as worldsOf (changes cumulative; F transient; E1 reverted in world 2). */
export function dryWorlds() {
  const out = [];
  const carried = [];
  for (const w of DRY.worlds) {
    const changes = [];
    for (const c of carried) {
      if (CHANGES[c.id].transient) continue;
      if (w.adds.some(a => CHANGES[a.id].reverts === c.id)) continue;
      changes.push({ id: c.id, cls: CHANGES[c.id].cls, kind: CHANGES[c.id].kind, startsHere: false, onsetMs: T0_MS, effMs: DATED.includes(c.id) ? at(c.onset.day, c.onset.time ?? '00:00') : T0_MS, publishMs: null });
    }
    for (const a of w.adds) { const on = at(a.onset.day, a.onset.time ?? '00:00'); changes.push({ id: a.id, cls: CHANGES[a.id].cls, kind: CHANGES[a.id].kind, startsHere: true, onsetMs: on, effMs: on, publishMs: a.publish ? at(a.publish.day, a.publish.time) : null }); }
    for (const a of w.adds) if (!CHANGES[a.id].transient && !CHANGES[a.id].reverts) carried.push(a);
    out.push({ stream: DRY.stream, k: w.k, seed: DRY.seeds[w.k - 1], size: DRY.size, difficulty: DIFFICULTY, mix: MIX, dry: true,
      changes: changes.sort((a, b) => CHANGE_IDS.indexOf(a.id) - CHANGE_IDS.indexOf(b.id)) });
  }
  return out;
}
