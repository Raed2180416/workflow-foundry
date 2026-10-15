// S1 origin labels and the F6 origin census (FIRST-CLASS-PROGRAMS §0.1 S1, §6.4 OUT-0). $0, pure.
// Origin says who wrote the world (or task set) and who wrote the grader:
//   ours                           our generator, our world, our grader
//   ours-grounded                  ours, grounded on outside tasks (e.g. AB-R families built from AutomationBench tasks)
//   outside-world-our-grader       a third party's world, graded by our oracle
//   outside-world-outside-grader   a third party's world and grader
//   real-process                   real process data (an event log, a real user's process)
// Group: our-bed | third-party | real-log. Fidelity tier (S5, §5.4): M0 schema only; M1 written from docs or by us, never
// compared; M2 diffed against a reference mock; M3 diffed against a real system or OSS twin; M4 continuously reconciled.
import { ORIGIN_GROUPS } from './schema.mjs';

export const ORIGINS = ORIGIN_GROUPS;

/**
 * The beds the back-fill touches, with their origin and the tier of the world each row runs in. `tier: null` means the
 * bed has no simulated system (documents with an exact oracle, or a labelled text set): no world fidelity applies.
 */
export const BEDS = Object.freeze({
  'ebed-e8': {
    origin: 'ours', world: 'E8 order saga systems (beds/ebed/e8, host beds/ebed/host)', tier: 'M1',
    why: 'our generator, worlds, systems and oracle; the systems are the reference semantics of our own bed, M1 relative to any real system (§5.4)',
  },
  wbed: {
    origin: 'ours', world: null, tier: null,
    why: 'W-bed rungs (beds/wbed): our generator and exact-field oracles; documents, no simulated system',
  },
  automationbench: {
    origin: 'outside-world-outside-grader', world: 'AutomationBench apps (commit 4a8e106, served by experiments/autobench/bridge.py)', tier: 'M1',
    why: "a third party's tasks, world and assertions; its apps are docs-derived and never compared with the vendors (M1, §5.4); the bridge is ours, checked 35/35 against the official environment (parity.json)",
  },
  'jq-t7': {
    origin: 'ours', world: null, tier: null,
    why: 'T7 planted set from our generator (experiments/library/quarantine.mjs plantedSet, seed 20261014), generator-labelled',
  },
  'jneed2-properties': {
    origin: 'ours', world: null, tier: null,
    why: 'W-bed tasks (ours) read for six properties; truth table written by our independent reader (research/need-router-20261014/jneed2/truth.json)',
  },
});

/** Origin and fidelity fields for a row on a bed. */
export function originOf(bed) {
  const b = BEDS[bed];
  if (!b) throw new Error(`unknown bed ${bed}`);
  return { origin: { class: b.origin, group: ORIGINS[b.origin] }, fidelity: b.world ? [{ world: b.world, tier: b.tier, manifest: null }] : [], why: b.why };
}

/**
 * The F6 origin census over claim rows: per origin group, class and bed: rows, verdict-bearing rows (a verdict that is
 * neither excluded nor superseded by a regrade), verified successes and metered USD. Real-process rows are reported even
 * when zero.
 */
export function census(rows) {
  const blank = () => ({ rows: 0, verdictRows: 0, successes: 0, chargedUsd: 0, reportedUsd: 0, beds: new Set(), runs: new Set() });
  const byGroup = { 'our-bed': blank(), 'third-party': blank(), 'real-log': blank() };
  const byClass = Object.fromEntries(Object.keys(ORIGINS).map(k => [k, blank()]));
  const byBed = {};
  for (const r of rows) {
    for (const acc of [byGroup[r.origin.group], byClass[r.origin.class], (byBed[r.task.bed] ??= blank())]) {
      acc.rows += 1;
      const vb = r.verdict.kind !== 'none' && !r.verdict.excluded && !r.refs?.supersededBy;
      if (vb) { acc.verdictRows += 1; acc.successes += r.verdict.successes ?? 0; }
      acc.chargedUsd += r.usd.charged ?? 0; acc.reportedUsd += r.usd.reported ?? 0;
      acc.beds.add(r.task.bed); acc.runs.add(r.run);
    }
  }
  const fin = o => Object.fromEntries(Object.entries(o).map(([k, a]) => [k, { ...a, beds: [...a.beds].sort(), runs: a.runs.size }]));
  const g = fin(byGroup), c = fin(byClass), b = fin(byBed);
  const tot = k => Object.values(g).reduce((s, a) => s + a[k], 0);
  const share = (grp, k) => (tot(k) ? g[grp][k] / tot(k) : null);
  return {
    byGroup: g, byClass: c, byBed: b,
    shares: {
      thirdPartyRows: share('third-party', 'rows'), thirdPartyVerdictRows: share('third-party', 'verdictRows'),
      thirdPartyChargedUsd: share('third-party', 'chargedUsd'), realLogRows: share('real-log', 'rows'),
    },
    totals: { rows: tot('rows'), verdictRows: tot('verdictRows'), chargedUsd: tot('chargedUsd'), reportedUsd: tot('reportedUsd') },
  };
}
