// LAT-0 (FIRST-CLASS-PROGRAMS §8.4): the F8 latency table from S1 claim rows. $0, pure.
// Two clocks are never mixed: compute wall time (what the owner waits) comes from timing.*; simulated business time
// (timing.businessTime) is reported apart. Per arm: wall p50/p90/p99 (nearest rank; at n < 100 the p99 is the maximum),
// wall time per verified success (sum of wall over the arm's rows / verified successes, with the success count's two-sided
// 95% Clopper-Pearson interval carried into the ratio), time to first effect, model share, configured and observed
// concurrency. Environment-fault, censored and set-aside rows are listed apart with their concurrency, never pooled.
// Wall time per verified success sums each row's own wall time (session time), so at concurrency > 1 it is compute time
// per success, not the elapsed time the owner waited (the configured and observed concurrency are reported beside it).
// A row that hit its runner's deadline (timing.deadline.hit) has a wall time truncated at the deadline: a quantile that
// lands on such a row is reported as the deadline (wall.atDeadline), a lower bound on latency, never a measured tail.
import { exactBinomialBounds } from '../lib/stats.mjs';

/** Nearest-rank quantile (q in (0, 1]) of finite numbers; null when empty. */
export function quantile(xs, q) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1))];
}
const median = xs => quantile(xs, 0.5);

/** Two-sided 95% Clopper-Pearson interval for k of n (stats.mjs exactBinomialBounds puts 1 - level in each tail). */
export function cp95(k, n) { return n > 0 ? exactBinomialBounds(k, n, { level: 0.975 }) : { lo: null, hi: null }; }

/**
 * Wall time per verified success with an interval from the success count only (K = 1: no run-to-run variance is
 * observable). wall may be a number or {lo, hi} bounds. Returns {point, lo, hi} in ms, or null with no success.
 */
export function perSuccess(wall, successes, total) {
  if (!(successes > 0)) return null;
  const w = typeof wall === 'number' ? { lo: wall, hi: wall } : wall;
  if (!w || !Number.isFinite(w.lo) || !Number.isFinite(w.hi)) return null;
  const ci = cp95(successes, total);
  return { point: (w.lo === w.hi ? w.lo : null), pointLo: w.lo / successes, pointHi: w.hi / successes,
    lo: w.lo / (total * ci.hi), hi: ci.lo > 0 ? w.hi / (total * ci.lo) : Infinity };
}

/** Rows a table may use: verdict-bearing, not excluded, not superseded, not set aside. */
export const usable = r => r.verdict.kind !== 'none' && !r.verdict.excluded && !r.refs?.supersededBy && r.rowKind === 'task';

/** Summary of one arm's rows (task rows). */
export function armSummary(rows) {
  const walls = rows.map(r => r.timing.wallMs).filter(Number.isFinite);
  const succ = rows.reduce((s, r) => s + (r.verdict.successes ?? 0), 0), tot = rows.reduce((s, r) => s + (r.verdict.total ?? 0), 0);
  const allWall = rows.every(r => Number.isFinite(r.timing.wallMs));
  const sumWall = allWall ? walls.reduce((s, x) => s + x, 0) : null;
  const ttfe = rows.map(r => r.timing.timeToFirstEffectMs).filter(Number.isFinite);
  const share = rows.filter(r => Number.isFinite(r.timing.timeToFirstEffectMs) && r.timing.wallMs > 0).map(r => r.timing.timeToFirstEffectMs / r.timing.wallMs);
  const modelShare = rows.filter(r => Number.isFinite(r.timing.components?.modelMs) && r.timing.wallMs > 0).map(r => r.timing.components.modelMs / r.timing.wallMs);
  const conf = [...new Set(rows.map(r => r.timing.concurrency?.configured).filter(x => x != null))];
  const obs = rows.map(r => r.timing.concurrency?.observedMax).filter(Number.isFinite);
  const hitWalls = rows.filter(r => r.timing.deadline?.hit === true).map(r => r.timing.wallMs).filter(Number.isFinite);
  const minHit = hitWalls.length ? Math.min(...hitWalls) : null;
  const q = { p50: median(walls), p90: quantile(walls, 0.9), p99: quantile(walls, 0.99) };
  const atDeadline = Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v !== null && minHit !== null && v >= minHit]));
  return {
    rows: rows.length, successes: succ, total: tot, successRate: tot ? succ / tot : null, successCi: cp95(succ, tot),
    wall: { rows: walls.length, ...q, sum: sumWall, deadlineHits: hitWalls.length,
      deadlineMs: [...new Set(rows.map(r => r.timing.deadline?.ms).filter(Number.isFinite))], atDeadline },
    wallPerSuccess: sumWall === null ? null : perSuccess(sumWall, succ, tot),
    timeToFirstEffect: { rows: ttfe.length, p50: median(ttfe), p90: quantile(ttfe, 0.9), shareOfWallP50: median(share) },
    modelShareP50: median(modelShare), modelShareRows: modelShare.length,
    concurrency: { configured: conf, observedMax: obs.length ? Math.max(...obs) : null },
    chargedUsd: rows.reduce((s, r) => s + (r.usd.charged ?? 0), 0), reportedUsd: rows.reduce((s, r) => s + (r.usd.reported ?? 0), 0),
  };
}

const groupBy = (xs, f) => { const m = new Map(); for (const x of xs) { const k = f(x); (m.get(k) ?? m.set(k, []).get(k)).push(x); } return m; };

/** The E8 build chain of a grading row: its build row and, for a repaired solver, the lineage build too. */
export function buildChain(row, byId) {
  const chain = [];
  let b = byId.get(row.refs?.build);
  while (b) { chain.push(b); b = byId.get(b.refs?.build); }
  return chain;
}

/** E8 blocks: the matched sized world (built arms vs agent-H) and the nine full worlds (built arms only). */
export function e8Blocks(rows) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const e8 = rows.filter(r => r.task.bed === 'ebed-e8');
  const grades = e8.filter(r => usable(r) && r.models?.some(m => m.role === 'builder'));
  // successes over every world each solver was graded on (non-superseded), for the amortised reading
  const solverTotals = new Map();
  for (const g of grades) { const k = g.refs.build; const t = (solverTotals.get(k) ?? solverTotals.set(k, { successes: 0, total: 0, worlds: 0 }).get(k)); t.successes += g.verdict.successes; t.total += g.verdict.total; t.worlds += 1; }
  const builtRow = (g) => {
    const chain = buildChain(g, byId);
    const buildWall = chain.every(b => Number.isFinite(b.timing.wallMs)) ? chain.reduce((s, b) => s + b.timing.wallMs, 0) : null;
    const smoke = chain.flatMap(b => b.timing.stages ?? []).filter(s => s.stage.startsWith('smoke') && s.n);
    const t = solverTotals.get(g.refs.build);
    return {
      arm: g.arm, run: g.run, solver: chain.map(b => b.run).join(' <- '), successes: g.verdict.successes, total: g.verdict.total, successCi: cp95(g.verdict.successes, g.verdict.total),
      buildWallMs: buildWall, runWallMs: null, runWallWhy: 'not recorded by build.mjs grade()',
      smokeMsPerRun: smoke.length ? smoke.reduce((s, x) => s + x.ms, 0) / smoke.reduce((s, x) => s + x.n, 0) : null,
      perSuccessBuildChargedHere: buildWall === null ? null : perSuccess(buildWall, g.verdict.successes, g.verdict.total),
      perSuccessAmortised: buildWall === null || !t ? null : { worlds: t.worlds, cases: t.total, successes: t.successes, ...perSuccess(buildWall, t.successes, t.total) },
      buildUsd: chain.reduce((s, b) => s + (b.usd.charged ?? 0), 0),
    };
  };
  const s12 = grades.filter(g => g.task.key.includes(':s12:'));
  const agent = e8.filter(r => usable(r) && r.arm === 'agent-H' && r.task.key.includes(':s12:'));
  const matched = {
    world: s12[0]?.task.key ?? null,
    built: s12.map(builtRow),
    agent: agent.map(a => ({ arm: a.arm, run: a.run, successes: a.verdict.successes, total: a.verdict.total, successCi: cp95(a.verdict.successes, a.verdict.total),
      wallMs: a.timing.wallMs, wallMsBounds: a.timing.wallMsBounds, perSuccess: perSuccess(a.timing.wallMs ?? a.timing.wallMsBounds, a.verdict.successes, a.verdict.total),
      usd: a.usd.charged, starts: a.usd.starts, businessMs: a.timing.businessTime?.simulatedMs })),
  };
  const full = [];
  for (const [k, gs] of groupBy(grades.filter(g => g.task.key.includes(':full:')), g => `${g.arm}|${g.refs.build}`)) {
    const succ = gs.reduce((s, g) => s + g.verdict.successes, 0), tot = gs.reduce((s, g) => s + g.verdict.total, 0);
    const chain = buildChain(gs[0], byId);
    const bw = chain.every(b => Number.isFinite(b.timing.wallMs)) ? chain.reduce((s, b) => s + b.timing.wallMs, 0) : null;
    full.push({ arm: gs[0].arm, solver: chain.map(b => b.run).join(' <- '), gradings: [...new Set(gs.map(g => g.run))], worlds: gs.length, successes: succ, total: tot,
      successCi: cp95(succ, tot), buildWallMs: bw, runWallMs: null, perSuccessBuildOnly: bw === null ? null : perSuccess(bw, succ, tot), key: k });
  }
  return { matched, full };
}

/** Per (bed, run, arm) summaries for the one-call, session and reader beds. */
export function armTable(rows) {
  const out = [];
  for (const [k, rs] of groupBy(rows.filter(r => usable(r) && r.task.bed !== 'ebed-e8'), r => `${r.task.bed}|${r.run}|${r.arm}`)) {
    const [bed, run, arm] = k.split('|');
    out.push({ bed, run, arm, origin: rs[0].origin.group, evidence: rs[0].evidence.class, ...armSummary(rs) });
  }
  return out.sort((a, b) => (a.bed + a.run + a.arm).localeCompare(b.bed + b.run + b.arm));
}

/** Rows kept apart: environment faults, censored runs and set-aside attempts, with concurrency. */
export function faultRows(rows) {
  return rows.filter(r => r.rowKind === 'set-aside' || r.verdict.censored || (r.envFaults ?? []).length)
    .map(r => ({ bed: r.task.bed, run: r.run, arm: r.arm, rowKind: r.rowKind, censored: r.verdict.censored, excluded: r.verdict.excluded, envFaults: r.envFaults,
      wallMs: r.timing.wallMs, wallProv: r.provenance?.['timing.wallMs']?.kind ?? null, chargedUsd: r.usd.charged, reportedUsd: r.usd.reported, starts: r.usd.starts,
      concurrency: r.timing.concurrency, businessMs: r.timing.businessTime?.simulatedMs ?? null }));
}

/** Arms with verdicts but no timing at all (the gap S6 closes). */
export function untimed(rows) {
  const out = [];
  for (const [k, rs] of groupBy(rows.filter(r => usable(r) && !rs0Timed(r)), r => `${r.task.bed}|${r.run}|${r.arm}`)) out.push({ key: k, rows: rs.length, why: rs[0].provenance?.['timing.wallMs']?.why ?? null });
  return out;
}
const rs0Timed = r => Number.isFinite(r.timing.wallMs) || r.timing.wallMsBounds != null;

export function latencyReport(rows) {
  return { e8: e8Blocks(rows), arms: armTable(rows), faults: faultRows(rows), untimed: untimed(rows) };
}
