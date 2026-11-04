// DUR-1 hand-crafted comparators (PREREG-DUR-1 §5): R-static, R-maint(L) and R-ceil. $0, analyst side.
// The reference policy (beds/ebed/oracle/policy.mjs referenceArm, the oracle core) reads every DATA change from the world
// itself (editions through editionAt, F5 renames through the API files, load and faults through the journal), so only
// the RULE changes (R1, R2s, U1s: the gated edits of the transition copy, changes.mjs) separate a frozen reference from
// the true one. A version's rule knowledge is the world it believes (variant.armWorld): truth.dur1Eff restricted to the
// rule changes it has switched to.
//   R-static     believes no rule change (frozen at the base rules);
//   R-maint(L)   switches to the true rule of change c at knowable(c) + L world-days: knowable = publication if c is
//                announced, else the first deployment-visible signal (m1, m5) on a case exposed to c on its own journal
//                (before its switch R-maint behaves exactly as R-static, so R-static's journal is that journal);
//   R-ceil       switches at the first oracle failure of a case exposed to c on R-static's journal (an upper bound).
// Switch times are stream times (world k, ms); a switch at or before a world's t0 is in force for the whole world.
import { referenceVersion } from './arms.mjs';
import { T0_MS, DAY_MS, HORIZON_DAYS, CHANGES } from './schedule.mjs';

export const RULE_CHANGES = Object.freeze(['R1', 'R2s', 'U1s']);
export const LAGS = Object.freeze([0, 2, 7]);
const WORLD_MS = HORIZON_DAYS * DAY_MS;

/** Stream milliseconds of a time in world k (world k starts at (k - 1) * 14 days). */
export const streamMs = (k, ms) => (k - 1) * WORLD_MS + (ms - T0_MS);
/** World k and in-world ms of a stream time. */
export const fromStreamMs = s => { const k = Math.floor(s / WORLD_MS) + 1; return { k, ms: T0_MS + (s - (k - 1) * WORLD_MS) }; };

/** A reference version that believes only the rule changes in `ids` (R-static: none). */
export function ruleVersion(ids, { label = null } = {}) {
  const keep = [...ids].sort();
  const id = label ?? (keep.length ? `R[${keep.join('+')}]` : 'R-static');
  const v = referenceVersion({ id, timing: 'earliest', armWorld: W => {
    const w = structuredClone(W);
    const eff = w.truth.dur1Eff ?? {};
    w.truth.dur1Eff = Object.fromEntries(Object.entries(eff).filter(([c]) => keep.includes(c)));
    return w;
  } });
  return Object.freeze({ ...v, digest: `rule-${keep.join('+') || 'base'}` });
}
export const rStaticVersion = () => ruleVersion([], { label: 'R-static' });

/**
 * The version timeline of world k for a set of switches { [c]: streamMs | Infinity }: every switch at or before t0 is in
 * force from t0; later switches inside the world add entries at their in-world time. Versions are cached by rule set so
 * a timeline's versions keep their digests (journal digests stay comparable).
 */
export function switchTimeline(k, switches, { cache = new Map(), label = 'R' } = {}) {
  const start = (k - 1) * WORLD_MS, end = k * WORLD_MS;
  const vOf = ids => { const key = [...ids].sort().join('+'); if (!cache.has(key)) cache.set(key, ruleVersion(ids, { label: `${label}[${key || 'base'}]` })); return cache.get(key); };
  const on = Object.entries(switches).filter(([, s]) => Number.isFinite(s) && s <= start).map(([c]) => c);
  const inside = Object.entries(switches).filter(([, s]) => Number.isFinite(s) && s > start && s < end).sort((a, b) => a[1] - b[1]);
  const out = [{ fromMs: -Infinity, version: vOf(on) }];
  const ids = [...on];
  for (const [c, s] of inside) { ids.push(c); out.push({ fromMs: T0_MS + (s - start), version: vOf(ids) }); }
  return out;
}

/**
 * Knowable and first-failure times per rule change from R-static's stream record (stream.mjs runStream output with
 * per-day signals and per-case grades) and the exposure (exposure(k) -> { [change]: Set(case) }). Returns
 * { knowable: { [c]: streamMs | Infinity }, firstFailure: { [c]: streamMs | Infinity }, how: { [c]: text } }.
 */
export function ruleTimes({ staticRecord, worlds, exposure }) {
  const knowable = {}, firstFailure = {}, how = {};
  for (const c of RULE_CHANGES) {
    const startSpec = worlds.find(w => w.changes.some(x => x.id === c && x.startsHere));
    if (!startSpec) continue;
    const ch = startSpec.changes.find(x => x.id === c);
    if (CHANGES[c].announced && ch.publishMs !== null && ch.publishMs !== undefined) { knowable[c] = streamMs(startSpec.k, ch.publishMs); how[c] = 'publication'; }
    else {
      knowable[c] = Infinity; how[c] = 'no deployment-visible signal (m1, m5) on an exposed case';
      for (const w of staticRecord.worlds.filter(x => x.k >= startSpec.k).sort((a, b) => a.k - b.k)) {
        const ex = exposure(w.k)?.[c] ?? new Set();
        const sig = Object.values(w.days ?? {}).flatMap(d => d.signals ?? []).filter(s => ['m1', 'm5'].includes(s.ch) && s.case && ex.has(s.case)).sort((a, b) => a.at - b.at)[0];
        if (sig) { knowable[c] = streamMs(w.k, sig.at); how[c] = `first ${sig.ch} on an exposed case (W${w.k})`; break; }
      }
    }
    firstFailure[c] = Infinity;
    for (const w of staticRecord.worlds.filter(x => x.k >= startSpec.k).sort((a, b) => a.k - b.k)) {
      const ex = exposure(w.k)?.[c] ?? new Set();
      const t = Object.entries(w.grade ?? {}).filter(([x, g]) => ex.has(x) && g[0] === 0 && g[2] !== null).map(([, g]) => g[2]).sort((a, b) => a - b)[0];
      if (t !== undefined) { firstFailure[c] = streamMs(w.k, t); break; }
    }
  }
  return { knowable, firstFailure, how };
}

/** Switch times of R-maint(L) and R-ceil from ruleTimes. */
export const maintSwitches = (times, L) => Object.fromEntries(Object.entries(times.knowable).map(([c, s]) => [c, Number.isFinite(s) ? s + L * DAY_MS : Infinity]));
export const ceilSwitches = times => ({ ...times.firstFailure });
