// `records` bed: data repair and entity resolution over a messy multi-system export.
// Interface per beds/CONTRACT.md. Hidden truth is recomputed from (seed, split, difficulty).
import { buildWorld, ruleSolve, resolveGroup, clusterRows, sameDay } from './world.mjs';
import { scoreAgainst } from './score.mjs';
import { dayNum, fromDay, isoDate } from './render.mjs';
import * as P from './pools.mjs';

export const family = {
  id: 'records',
  domain: 'data repair / entity resolution',
  version: '3.0.0',
  description: 'Merge a messy export of customer/supplier rows from several legacy systems (mixed locales, '
    + 'nicknames, transliterations, typos, twins and namesakes, void markers and look-alikes, adversarial staff memos) '
    + 'into one canonical record per real person, following a prose spec for identity, conflict resolution, phone '
    + 'normalisation and USD conversion with market FX quotes. From difficulty 3 the date orders, extra status values, '
    + 'a re-stamped mirror system and balance perspectives change from task to task and are stated only in paraphrased notes.',
  kind: 'oneshot',
};

export { LIMITS, outputSchema, validate, FIELDS, THRESHOLDS, scoreAgainst } from './score.mjs';
// ATTACK-20261014 M1: output-invariance relations and the witness tag (host code, beside the oracle; never shown to arms).
export { invariance, witness, witnessOf, witnessCheck } from './invariance.mjs';

// ---------------------------------------------------------------------------------------
export function generate({ seed, split = 'dev', difficulty = 3 }) {
  const w = buildWorld(seed, split, difficulty);
  const rowCount = w.allRows.length;
  return {
    id: `records:${split}:d${difficulty}:${seed}`,
    family: family.id,
    seed, split, difficulty,
    prompt: w.prompt,
    inputs: { source_notes: w.notes, spec: w.spec, export: w.exportText },
    budget: { outputTokens: 400 + rowCount * 60 },
  };
}

// Memoised world for host-side callers (oracle, reference, controls). buildWorld is a pure function
// of (seed, split, difficulty) and these callers never mutate the world, so caching is safe.
const worldCache = new Map();
function hostWorld(task) {
  const key = JSON.stringify([task.seed, task.split, task.difficulty]);
  let w = worldCache.get(key);
  if (!w) {
    w = buildWorld(task.seed, task.split, task.difficulty);
    worldCache.set(key, w);
    if (worldCache.size > 16) worldCache.delete(worldCache.keys().next().value);
  }
  return w;
}

export function oracle(task, output) {
  return scoreAgainst(hostWorld(task).truth.records, output);
}

export function referenceSolve(task) {
  return structuredClone(hostWorld(task).truth);
}

// ---------------------------------------------------------------------------------------
// Bad controls. Each is a plausible failure mode recomputed from the hidden world.
const worldOf = hostWorld;
const rowRecord = (s, fx) => resolveGroup([s], fx);
export const badControls = [
  { name: 'empty', make: () => ({ records: [] }) },
  {
    name: 'shuffled-or-corrupted',
    make: task => {
      const recs = structuredClone(worldOf(task).truth.records);
      const n = recs.length;
      const rot = (f, by) => { const vals = recs.map(x => x[f]); recs.forEach((x, i) => { x[f] = vals[(i + by) % n]; }); };
      rot('birth_date', 1); rot('phone_e164', 2); rot('amount_usd', 3); rot('country', 4);
      return { records: recs };
    },
  },
  {
    // Plausible: every row becomes its own person (no entity resolution at all).
    name: 'no-dedup',
    make: task => { const w = worldOf(task); return { records: w.rows.map(x => rowRecord(x.s, w.fx)) }; },
  },
  {
    // Plausible shortcut: birth date as the identity key (undated rows joined by phone), names never
    // compared. Twins and same-birthday people (every level) are merged.
    name: 'birthdate-key',
    make: task => {
      const w = worldOf(task);
      const link = (a, b) => (a.dob && b.dob ? sameDay(a.dob, b.dob) : Boolean(a.phone && a.phone === b.phone));
      return ruleSolve(w.rows.map(x => x.s), w.fx, { link });
    },
  },
  {
    // Plausible: void markers ignored (test fixtures, cancelled and withdrawn rows migrated).
    name: 'ignore-void-markers',
    make: task => { const w = worldOf(task); return ruleSolve(w.allRows.map(x => x.s), w.fx); },
  },
  {
    // Plausible: the oldest row wins every conflict instead of the most recent one.
    name: 'oldest-row-wins',
    make: task => {
      const w = worldOf(task);
      const live = w.rows.map(x => x.s);
      const records = clusterRows(live).map(g => resolveGroup(g, w.fx, { order: (a, b) => (a.date - b.date) || (a.rowId - b.rowId) }));
      return { records: records.sort((a, b) => a.entity_id - b.entity_id) };
    },
  },
  {
    // Plausible: ATLAS numeric birth dates read in the wrong order (the UK-ledger default assumed when the
    // notes say month first, or the US order assumed when they say day first; at difficulty >= 4 the
    // vendor switch is also missed). At difficulty 1-2 this is "every ATLAS date read as US month/day".
    name: 'atlas-order-flipped',
    make: task => {
      const w = worldOf(task);
      const live = w.rows.map(x => {
        if (x.system !== 'ATLAS' || !x.s.dob) return x.s;
        if (!w.ctx.k.conv && w.ctx.atlasMonthFirst(x.date)) return x.s;
        const { y, m, d } = x.s.dob;
        return d <= 12 ? { ...x.s, dob: { y, m: d, d: m } } : x.s;
      });
      return ruleSolve(live, w.fx);
    },
  },
  {
    // Plausible: balances copied without currency conversion.
    name: 'unconverted-amounts',
    make: task => {
      const w = worldOf(task);
      const flat = { cur: {}, old: {}, cutover: null };
      for (const cur of Object.keys(w.fx.cur)) flat.cur[cur] = { num: 1, den: 1 };
      return ruleSolve(w.rows.map(x => x.s), flat);
    },
  },
  // Difficulty >= 3: per-task conventions stated only in the source notes. The generator rejects any world
  // in which one of these single misreadings would still pass, so each fails on every seed.
  {
    // Plausible: BRIGHTDESK numeric birth dates read in the other order (e.g. "US CRM, so month first"
    // when the notes say the instance runs in UK locale).
    name: 'brightdesk-order-flipped', minDifficulty: 3,
    make: task => {
      const w = worldOf(task);
      return ruleSolve(w.rows.map(x => (x.system === 'BRIGHTDESK' && x.s.dob && x.s.dob.d <= 12
        ? { ...x.s, dob: { y: x.s.dob.y, m: x.s.dob.d, d: x.s.dob.m } } : x.s)), w.fx);
    },
  },
  {
    // Plausible: VENDEX numeric dates read in the other order (the notes' team convention ignored).
    name: 'vendex-order-flipped', minDifficulty: 3,
    make: task => {
      const w = worldOf(task);
      return ruleSolve(w.rows.map(x => {
        if (x.system !== 'VENDEX') return x.s;
        let s = x.s;
        if (x.vxDobNum && s.dob) s = { ...s, dob: { y: s.dob.y, m: s.dob.d, d: s.dob.m } };
        if (x.vxRevNum) { const t = fromDay(s.date); s = { ...s, date: dayNum(t.y, t.d, t.m) }; }
        return s;
      }), w.fx);
    },
  },
  {
    // Plausible: every per-task extra status value read with the opposite meaning (live ones dropped,
    // void ones migrated).
    name: 'status-meaning-flipped', minDifficulty: 3,
    make: task => {
      const w = worldOf(task);
      return ruleSolve([...w.rows.filter(x => !x.flag), ...w.voids.filter(v => v.flag)].map(x => x.s), w.fx);
    },
  },
  {
    // Plausible: unknown status values treated as live (only the fixed void markers honoured).
    name: 'unknown-status-live', minDifficulty: 3,
    make: task => {
      const w = worldOf(task);
      return ruleSolve([...w.rows, ...w.voids.filter(v => v.flag)].map(x => x.s), w.fx);
    },
  },
  {
    // Plausible: the mirror note ignored; re-stamped rows win conflicts by their (re-stamp) dates.
    name: 'mirror-ignored', minDifficulty: 3,
    make: task => { const w = worldOf(task); return ruleSolve(w.rows.map(x => ({ ...x.s, rank: 0 })), w.fx); },
  },
  {
    // Plausible: every printed balance read as owed to us (the per-system perspective notes ignored).
    name: 'perspective-ignored', minDifficulty: 3,
    make: task => {
      const w = worldOf(task);
      const flip = s => (s.amount ? { ...s, amount: { ...s.amount, minor: -s.amount.minor } } : s);
      return ruleSolve(w.rows.map(x => (w.ctx.conv.persp[x.system] === 'pay' ? flip(x.s) : x.s)), w.fx);
    },
  },
];

export { buildWorld, isoDate, P as pools };
