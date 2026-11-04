// C2-1 analysis (research/reuse-20261021/PREREG-C2-1.md §3, §5): composes the arms from the recorded components and
// computes every preregistered metric. The components were run once each: the proven entry on every item with every gate
// verdict (reuse.jsonl, $0), each supplier's builds per lineage on that supplier's items (builds.jsonl, built.jsonl) and
// the agent per item (agent.jsonl). An arm is a rule over them:
//   REUSE      (primary) gate G2 ∧ G3 accepts → the proven entry's answer; refuses → deopt → the supplier's build (the same
//              builder on B's labelled history), built at the supplier's first refusal and reused for its later refusals
//   REUSE-sticky  as REUSE, but after a supplier's first refusal all its later items go to the build (source-level deopt)
//   REUSE-b0 / -b1 / -b2   no gate / G2 only / G2 ∧ strict G3 (every new response field counts)
//   REUSE-oracle           clairvoyant gate (accepts exactly the items the proven entry gets right): the ceiling
//   SCRATCH    the supplier's build on every item; every supplier's build is paid
//   AGENT      the Haiku agent on every item
// Builds and agents are paired by lineage / repetition: REUSE@L and SCRATCH@L use the same build L.
import path from 'node:path';
import { itemsOf } from './gen-b.mjs';
import { SOURCES, decideShipment, sameDecision } from './program-b.mjs';
import { clustersOf, crossedOf, reuseBoundRule, reuseBoundRule2 } from '../lib/stats.mjs';
import { mean, median, readJsonl, rng, usd, writeJson } from './lib.mjs';

export const GATES = Object.freeze({
  b0: () => true,
  b1: r => r.variants.g2.accept,
  b2: r => r.variants.g2.accept && r.variants.g3strict.accept,
  b3: r => r.variants.g2.accept && r.variants.g3.accept,
  oracle: r => r.correct,
});
export const PRIMARY_GATE = 'b3';
/** Totals whose class the proven evidence pins (SOP-Bench dev labels: 5-7 A, 9 B, 15-16 C, 17-20 D; 4 lies below 5 in A) and
 * Unable to Decide (0, rules stated in sop.txt). Totals 8 and 10-14 are set by B's matrix alone, which equals the proven
 * workflow's bands by construction (program-b.mjs): accuracy on the pinned subset removes that advantage. */
export const PINNED_TOTALS = Object.freeze([0, 4, 5, 6, 7, 9, 15, 16, 17, 18, 19, 20]);
const isHeldOut = s => SOURCES[s].set === 'test';
const pct = (a, b) => (b ? a / b : null);

/** One arm's per-item outcomes: [{ id, source, shipment, cls, correct, route: 'reuse'|'build'|'agent', ms }], plus charges. */
export function composeArm(arm, { items, reuseBy, builtBy, buildOf, agentBy }) {
  const out = [], buildsCharged = new Map(), firstRefusal = new Map();
  for (const it of items) {
    const id = it.product.id, src = it.source, r = reuseBy.get(id);
    const viaBuild = L => { const b = builtBy.get(`${id}#${L}`); return { cls: b?.answer ?? null, correct: !!b?.correct, route: 'build', ms: b?.durationMs ?? null, missing: !b }; };
    let o;
    if (arm.kind === 'agent') { const a = agentBy.get(`${id}#${arm.k}`); o = { cls: a?.answer ?? null, correct: !!a?.correct, route: 'agent', ms: a?.durationMs ?? null, usd: a?.costUsd ?? 0, missing: !a }; }
    else if (arm.kind === 'scratch') { o = viaBuild(arm.lineage); buildsCharged.set(src, buildOf(src, arm.lineage)); }
    else {
      const sticky = arm.sticky && firstRefusal.has(src);
      const accept = !sticky && GATES[arm.gate](r);
      if (accept) o = { cls: r.answer, correct: r.correct, route: 'reuse', ms: r.durationMs + (r.g2Ms ?? 0) + (r.g3Ms ?? 0) };
      else {
        o = viaBuild(arm.lineage);
        if (!firstRefusal.has(src)) firstRefusal.set(src, id);
        buildsCharged.set(src, buildOf(src, arm.lineage));
        // Time the gate spent before routing to the build: G2 always (a pre-run check); the proven entry's run and G3 only
        // when G2 accepted and the gate has a post-run check (b2, b3) or is the clairvoyant one (it needs the run's result).
        if (!sticky) {
          const ran = arm.gate === 'oracle' || ((arm.gate === 'b2' || arm.gate === 'b3') && r.variants.g2.accept);
          o.ms = (o.ms ?? 0) + (r.g2Ms ?? 0) + (ran ? (r.durationMs ?? 0) + (r.g3Ms ?? 0) : 0);
        }
      }
    }
    out.push({ id, source: src, shipment: it.shipment, truth: it.product.truth.hazard_class, pinned: PINNED_TOTALS.includes(it.product.truth.hazard_score), ...o });
  }
  return { out, buildsCharged, firstRefusal };
}

function shipmentOutcomes(out, ships) {
  const byShip = new Map();
  for (const o of out) (byShip.get(o.shipment) ?? byShip.set(o.shipment, []).get(o.shipment)).push(o);
  const res = [];
  for (const [sid, os] of byShip) {
    const s = ships.get(sid);
    const truth = decideShipment(os.map(o => o.truth), s.mode), got = decideShipment(os.map(o => o.cls ?? 'none'), s.mode);
    res.push({ shipment: sid, source: s.source, correct: sameDecision(truth, got), hold: got.decision === 'hold', wrongBooking: !sameDecision(truth, got) && got.decision !== 'hold' });
  }
  return res;
}

/** Paired cluster bootstrap (resampling shipments) of the item-accuracy difference A − B. */
export function pairedShipmentBootstrap(outA, outB, { iterations = 10000, seed = 'c2-boot' } = {}) {
  const ships = [...new Set(outA.map(o => o.shipment))];
  const sum = out => { const m = new Map(); for (const o of out) { const x = m.get(o.shipment) ?? [0, 0]; x[0] += o.correct ? 1 : 0; x[1] += 1; m.set(o.shipment, x); } return m; };
  const a = sum(outA), b = sum(outB);
  const r = rng(seed), diffs = [];
  for (let i = 0; i < iterations; i++) {
    let ca = 0, cb = 0, n = 0;
    for (let j = 0; j < ships.length; j++) { const s = ships[Math.floor(r() * ships.length)]; ca += a.get(s)[0]; cb += b.get(s)[0]; n += a.get(s)[1]; }
    diffs.push((ca - cb) / n);
  }
  diffs.sort((x, y) => x - y);
  const point = (outA.filter(o => o.correct).length - outB.filter(o => o.correct).length) / outA.length;
  return { point, lo: diffs[Math.floor(0.025 * iterations)], hi: diffs[Math.floor(0.975 * iterations)] };
}

function armMetrics(name, arm, composed, ctxData) {
  const { out, buildsCharged } = composed;
  const n = out.length;
  const ships = shipmentOutcomes(out, ctxData.ships);
  const buildUsd = [...buildsCharged.values()].reduce((a, b) => a + (b?.costUsd ?? 0), 0);
  const agentUsd = out.reduce((a, o) => a + (o.usd ?? 0), 0);
  const runMs = out.map(o => o.ms).filter(x => typeof x === 'number');
  const buildMs = [...buildsCharged.values()].reduce((a, b) => a + (b?.wallMs ?? 0), 0);
  const m = {
    arm: name, items: n, correct: out.filter(o => o.correct).length, itemAcc: pct(out.filter(o => o.correct).length, n),
    pinnedItems: out.filter(o => o.pinned).length, itemAccPinned: pct(out.filter(o => o.pinned && o.correct).length, out.filter(o => o.pinned).length),
    wrongClass: out.filter(o => o.cls !== null && !o.correct).length, noAnswer: out.filter(o => o.cls === null).length, missingComponent: out.filter(o => o.missing).length,
    shipments: ships.length, shipAcc: pct(ships.filter(s => s.correct).length, ships.length), holds: ships.filter(s => s.hold).length, wrongBookings: ships.filter(s => s.wrongBooking).length,
    buildsPaid: buildsCharged.size, buildUsd: usd(buildUsd), agentUsd: usd(agentUsd), totalUsd: usd(buildUsd + agentUsd), usdPerItem: usd((buildUsd + agentUsd) / n),
    medianItemMs: median(runMs), meanItemMs: mean(runMs) && Math.round(mean(runMs)), buildWallMs: buildMs, meanItemMsWithBuilds: Math.round((runMs.reduce((a, b) => a + b, 0) + buildMs) / n),
    // Amortisation (projection, not a measurement): the builds this arm paid spread over N items per supplier, plus the
    // measured per-item spend and time. N = 20 is about what this run had per supplier.
    projected: Object.fromEntries([20, 100, 1000].map(N => [N, { usdPerItem: usd(buildUsd / ctxData.nSources / N + agentUsd / n),
      msPerItem: Math.round(buildMs / ctxData.nSources / N + (runMs.length ? runMs.reduce((a, b) => a + b, 0) / runMs.length : 0)) }])),
    bySource: {},
  };
  if (arm.kind === 'reuse') {
    const acc = out.filter(o => o.route === 'reuse'), ref = out.filter(o => o.route !== 'reuse');
    const reuseRec = id => ctxData.reuseBy.get(id);
    m.reuseRate = pct(acc.length, n); m.deoptRate = pct(ref.length, n);
    m.wrongReuse = acc.filter(o => !o.correct).length; m.wrongReuseRate = pct(m.wrongReuse, acc.length);
    m.falseDeopt = ref.filter(o => reuseRec(o.id).correct).length; m.falseDeoptRate = pct(m.falseDeopt, ref.length);
    const harmful = out.filter(o => !reuseRec(o.id).correct);
    m.harmfulItems = harmful.length; m.harmfulCaught = harmful.filter(o => o.route !== 'reuse').length; m.catchRate = pct(m.harmfulCaught, harmful.length);
  }
  for (const s of [...new Set(out.map(o => o.source))].sort()) {
    const os = out.filter(o => o.source === s);
    const b = { items: os.length, correct: os.filter(o => o.correct).length, acc: pct(os.filter(o => o.correct).length, os.length) };
    if (arm.kind === 'reuse') { b.reused = os.filter(o => o.route === 'reuse').length; b.wrongReuse = os.filter(o => o.route === 'reuse' && !o.correct).length; b.deopt = os.length - b.reused; }
    m.bySource[s] = b;
  }
  return m;
}

/** analyze(ctx) -> summary (written to research/.../runs/<run-id>/summary-<set>.json). */
export async function analyze(ctx, { freeze = null, write = true } = {}) {
  const { items, ships } = itemsOf(ctx.manifest);
  const reuse = readJsonl(path.join(ctx.setLive, 'reuse.jsonl'));
  const builds = readJsonl(path.join(ctx.setLive, 'builds.jsonl'));
  const built = readJsonl(path.join(ctx.setLive, 'built.jsonl'));
  const agent = readJsonl(path.join(ctx.setLive, 'agent.jsonl')).filter(a => !a.envFault);
  const reuseBy = new Map(reuse.map(r => [r.id, r]));
  const builtBy = new Map(built.map(b => [`${b.id}#${b.lineage}`, b]));
  const agentBy = new Map(agent.map(a => [`${a.id}#${a.k}`, a]));
  const buildRec = new Map(builds.filter(b => !b.envFault).map(b => [`${b.source}#${b.lineage}`, b]));
  const buildOf = (src, L) => buildRec.get(`${src}#${L}`) ?? null;
  const covered = items.filter(it => reuseBy.has(it.product.id));
  const lineages = [...new Set(builds.filter(b => !b.envFault).map(b => b.lineage))].sort();
  const ks = [...new Set(agent.map(a => a.k))].sort();
  const data = { reuseBy, builtBy, buildOf, agentBy, ships, nSources: Object.keys(ctx.manifest.sources).length };
  const arms = [];
  // A lineage enters the arm table only when every supplier has a build record for it (complete pairing).
  const completeLineages = lineages.filter(L => Object.keys(ctx.manifest.sources).every(s => buildRec.has(`${s}#${L}`)));
  for (const L of completeLineages) {
    for (const [name, arm] of [[`REUSE@L${L}`, { kind: 'reuse', gate: PRIMARY_GATE, lineage: L }], [`REUSE-sticky@L${L}`, { kind: 'reuse', gate: PRIMARY_GATE, lineage: L, sticky: true }],
      [`REUSE-b0@L${L}`, { kind: 'reuse', gate: 'b0', lineage: L }], [`REUSE-b1@L${L}`, { kind: 'reuse', gate: 'b1', lineage: L }], [`REUSE-b2@L${L}`, { kind: 'reuse', gate: 'b2', lineage: L }],
      [`REUSE-oracle@L${L}`, { kind: 'reuse', gate: 'oracle', lineage: L }], [`SCRATCH@L${L}`, { kind: 'scratch', lineage: L }]]) arms.push({ name, arm });
  }
  const completeKs = ks.filter(k => covered.every(it => agentBy.has(`${it.product.id}#${k}`)));
  for (const k of completeKs) arms.push({ name: `AGENT@k${k}`, arm: { kind: 'agent', k } });
  const composed = Object.fromEntries(arms.map(({ name, arm }) => [name, composeArm(arm, { items: covered, ...data })]));
  const metrics = arms.map(({ name, arm }) => armMetrics(name, arm, composed[name], data));
  // Gate-only view ($0, needs no build): every gate variant's decisions on the proven entry.
  const gateView = Object.fromEntries(Object.entries(GATES).map(([g, f]) => {
    const acc = reuse.filter(f), ref = reuse.filter(r => !f(r)), harmful = reuse.filter(r => !r.correct);
    const sub = rs => ({ items: rs.length, accepted: rs.filter(f).length, wrongAccepted: rs.filter(r => f(r) && !r.correct).length, falseDeopt: rs.filter(r => !f(r) && r.correct).length });
    return [g, { accepted: acc.length, reuseRate: pct(acc.length, reuse.length), wrongReuse: acc.filter(r => !r.correct).length, wrongReuseRate: pct(acc.filter(r => !r.correct).length, acc.length),
      deopt: ref.length, falseDeopt: ref.filter(r => r.correct).length, falseDeoptRate: pct(ref.filter(r => r.correct).length, ref.length), catchRate: pct(harmful.filter(r => !f(r)).length, harmful.length),
      devKnown: sub(reuse.filter(r => !isHeldOut(r.source))), heldOut: sub(reuse.filter(r => isHeldOut(r.source))),
      bySource: Object.fromEntries([...new Set(reuse.map(r => r.source))].sort().map(s => [s, sub(reuse.filter(r => r.source === s))])) }];
  }));
  // M3 reuse rule (ATTACK-20261014 §3 M3; LIBRARY-TESTS L4 amended M3b) on the primary gate's admitted decisions.
  const admitted = reuse.filter(GATES[PRIMARY_GATE]).map(r => ({ parent: r.shipment, entry: r.entry, wrong: !r.correct }));
  const m3 = admitted.length ? {
    admitted: admitted.length, wrong: admitted.filter(d => d.wrong).length,
    parentExact: (({ decision, upper, n, nEff, deff, rhoUsed, minN }) => ({ decision, upper, n, nEff, deff, rhoUsed, minN }))(reuseBoundRule(clustersOf(admitted), { method: 'exact' })),
    crossedExact: (({ decision, upper, n, nEff, deff, rhoParentUsed, rhoEntryUsed, entries, minN }) => ({ decision, upper, n, nEff, deff, rhoParentUsed, rhoEntryUsed, entries, minN }))(reuseBoundRule2(crossedOf(admitted))),
  } : null;
  // Paired comparisons (item accuracy, shipment-cluster bootstrap): REUSE vs SCRATCH (same lineage) and vs AGENT.
  const comparisons = [];
  for (const L of completeLineages) {
    comparisons.push({ a: `REUSE@L${L}`, b: `SCRATCH@L${L}`, ...pairedShipmentBootstrap(composed[`REUSE@L${L}`].out, composed[`SCRATCH@L${L}`].out) });
    for (const k of completeKs) comparisons.push({ a: `REUSE@L${L}`, b: `AGENT@k${k}`, ...pairedShipmentBootstrap(composed[`REUSE@L${L}`].out, composed[`AGENT@k${k}`].out) });
  }
  for (const k of completeKs) for (const L of completeLineages) comparisons.push({ a: `SCRATCH@L${L}`, b: `AGENT@k${k}`, ...pairedShipmentBootstrap(composed[`SCRATCH@L${L}`].out, composed[`AGENT@k${k}`].out) });
  const buildTable = builds.map(b => ({ label: b.label, source: b.source, lineage: b.lineage, costUsd: usd(b.costUsd ?? 0), wallMin: b.wallMs ? +(b.wallMs / 60000).toFixed(1) : null, rounds: b.rounds?.length ?? 0,
    bestRound: b.bestRound ?? null, devPass: b.devPass ?? 0, devRows: b.devRows ?? null, failedBuild: !!b.failedBuild, envFault: b.envFault ?? null, judgeCallsPerRun: b.judgeCallsPerRun ?? null, artifactSha256: b.artifactSha256 ?? null }));
  const agentCost = agent.reduce((a, r) => a + (r.costUsd ?? 0), 0);
  const summary = {
    kind: 'c2-summary', id: 'C2-1', set: ctx.set, runId: ctx.runId, evidence: ctx.set === 'test' ? 'development evidence (preregistered; self-authored second program; not sealed)' : 'development (dev set: gate design and harness checks)',
    freeze, manifestSha256: ctx.manifest.sha256, items: covered.length, shipments: new Set(covered.map(it => it.shipment)).size, sources: Object.keys(ctx.manifest.sources),
    completeLineages, completeKs, gateView, primaryGate: PRIMARY_GATE, m3, metrics, comparisons, builds: buildTable,
    spend: { buildsUsd: usd(builds.reduce((a, b) => a + (b.costUsd ?? 0), 0)), agentUsd: usd(agentCost), agentItems: agent.length, agentViolations: agent.filter(a => a.violations?.length).length,
      agentSessionErrors: agent.filter(a => a.sessionError).length, agentNoAnswer: agent.filter(a => a.answer === null).length },
    generatedAt: new Date().toISOString(),
  };
  if (write) writeJson(path.join(ctx.out, `summary-${ctx.set}.json`), summary);
  return summary;
}
