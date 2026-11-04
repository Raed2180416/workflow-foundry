// Conformance suite for gauntlet.mjs: a port of shrinkray's tests/test_nondeterminism.py (MIT, Copyright © 2023
// David R. MacIver; commit 5fe6ee135d732e4b7758b3dbe3d91428523018fb; see the licence in gauntlet.mjs). Each upstream test
// function is one `test` here, under its upstream name (45 functions; parametrised cases are looped inside). Hypothesis
// property tests are ported as seeded random sampling (beds/lib/rng.mjs, 3,000 draws each, plus the edge cases), with the
// upstream strategies: Evidence(int(runs * frac), runs), runs in [0, 200], frac in [0, 1].
// The last block ("teeth") runs the reference operating points against deliberately broken variants and requires them to
// fail, so the suite is shown to discriminate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../beds/lib/rng.mjs';
import {
  ANCHOR_ALPHA, ANCHOR_SEED_RUNS, CONFIRM_CAP, CONFIRM_MIN_HITS, GATE_RUNS, GAUNTLET_CAP, GAUNTLET_FLOOR, GAUNTLET_GAMMA,
  GAUNTLET_MIN_HITS, INITIAL_MIN_HITS, MIN_HITS_CEILING, MONITOR_MIN_RUNS, RETENTION_HIGH_WATER,
  Evidence, NondeterminismPolicy, Verdict, anchorZ, confirmationBar, gauntlet, gauntletAt, gauntletThreshold, wilsonBound,
  normalInvCdf, operatingPoint,
} from './gauntlet.mjs';

const approx = (got, want, abs, msg = '') => assert.ok(Math.abs(got - want) <= abs, `${msg} ${got} != ${want} ± ${abs}`);
// pytest.approx default: relative 1e-6 (and absolute 1e-12).
const approxRel = (got, want, msg = '') => assert.ok(Math.abs(got - want) <= Math.max(1e-6 * Math.abs(want), 1e-12), `${msg} ${got} != ${want}`);
const DRAWS = 3000;
function* evidences(seed) {
  for (const [i, r] of [[0, 0], [0, 1], [1, 1], [0, 200], [200, 200], [1, 200], [199, 200]]) yield new Evidence(i, r);
  const r = rng('gauntlet-port', seed);
  for (let i = 0; i < DRAWS; i++) { const runs = r.int(0, 200), frac = r.next(); yield new Evidence(Math.floor(runs * frac), runs); }
}
const floats = (r, edges = [0, 1]) => (r.chance(0.1) ? r.pick(edges) : r.next());

// === Wilson bounds ===

test('test_wilson_reference_values', () => {
  for (const [interesting, runs, lower, upper, id] of [
    [4, 30, 0.0531, 0.2968, 'min-hits-at-cap'], [1, 1, 0.2065, 1.0, 'single-hit'], [20, 20, 0.8389, 1.0, 'all-hit-seed'],
    [10, 20, 0.2993, 0.7007, 'half'], [40, 40, 0.9124, 1.0, 'forty'], [30, 30, 0.8865, 1.0, 'cap-reachable'],
    [0, 10, 0.0, 0.2775, 'no-hits'],
  ]) {
    const ev = new Evidence(interesting, runs);
    approx(ev.lowerBound(), lower, 1e-4, id);
    approx(ev.upperBound(), upper, 1e-4, id);
  }
});

test('test_wilson_with_no_runs_is_vacuous', () => {
  assert.equal(wilsonBound(0, 0, { upper: false }), 0.0);
  assert.equal(wilsonBound(0, 0, { upper: true }), 1.0);
});

test('test_wilson_bounds_bracket_the_rate (property)', () => {
  for (const ev of evidences('bracket')) {
    if (ev.runs === 0) continue;
    const rate = ev.interesting / ev.runs;
    assert.ok(ev.lowerBound() >= 0 && ev.lowerBound() <= rate && rate <= ev.upperBound() && ev.upperBound() <= 1, `${ev.interesting}/${ev.runs}`);
  }
});

test('test_more_hits_never_lower_the_bounds (property)', () => {
  const r = rng('gauntlet-port', 'more-hits');
  for (let i = 0; i < DRAWS; i++) {
    const runs = r.int(1, 200);
    const k = Math.min(r.int(0, 200), runs - 1);
    const before = new Evidence(k, runs), after = new Evidence(k + 1, runs);
    assert.ok(after.lowerBound() >= before.lowerBound(), `${k}/${runs}`);
    assert.ok(after.upperBound() >= before.upperBound(), `${k}/${runs}`);
  }
});

test('test_evidence_record_counts_hits_and_runs', () => {
  const ev = new Evidence();
  ev.record(true); ev.record(false); ev.record(true);
  assert.deepEqual([ev.interesting, ev.runs], [2, 3]);
  approxRel(ev.rate, 2 / 3);
});

test('test_evidence_rate_with_no_runs_is_zero', () => {
  assert.equal(new Evidence().rate, 0.0);
});

// === Gauntlet ===

test('test_threshold_is_gamma_scaled_above_the_floor', () => {
  approxRel(gauntletThreshold(0.5), GAUNTLET_GAMMA * 0.5);
});

test('test_threshold_never_drops_below_the_floor', () => {
  assert.equal(gauntletThreshold(0.0), GAUNTLET_FLOOR);
  assert.equal(gauntletThreshold(0.03), GAUNTLET_FLOOR);
});

test('test_threshold_is_full_anchor_at_the_high_water', () => {
  assert.equal(gauntletThreshold(RETENTION_HIGH_WATER), RETENTION_HIGH_WATER);
  assert.equal(gauntletThreshold(0.9), 0.9);
});

test('test_floor_costs_no_power_at_min_hits', () => {
  assert.ok(GAUNTLET_FLOOR < new Evidence(GAUNTLET_MIN_HITS, GAUNTLET_CAP).lowerBound());
});

test('test_gauntlet_continues_short_of_min_hits', () => {
  for (let hits = 0; hits < GAUNTLET_MIN_HITS; hits++) assert.equal(gauntlet(new Evidence(hits, hits), 0.5, GAUNTLET_MIN_HITS), Verdict.CONTINUE);
});

test('test_gauntlet_accepts_at_min_hits_when_bound_clears', () => {
  const ev = new Evidence(GAUNTLET_MIN_HITS, GAUNTLET_MIN_HITS);
  assert.ok(ev.lowerBound() >= gauntletThreshold(0.5));
  assert.equal(gauntlet(ev, 0.5, GAUNTLET_MIN_HITS), Verdict.ACCEPT);
});

test('test_gauntlet_rejects_when_upper_bound_is_below_threshold', () => {
  assert.equal(gauntlet(new Evidence(0, 8), 0.5, GAUNTLET_MIN_HITS), Verdict.REJECT);
});

test('test_gauntlet_rejects_at_the_cap', () => {
  assert.equal(gauntlet(new Evidence(GAUNTLET_MIN_HITS, GAUNTLET_CAP), 0.5, GAUNTLET_MIN_HITS), Verdict.REJECT);
});

test('test_gauntlet_rejects_once_the_threshold_is_unreachable', () => {
  const anchor = new Evidence(ANCHOR_SEED_RUNS, ANCHOR_SEED_RUNS).lowerBound();
  assert.equal(gauntlet(new Evidence(1, 2), anchor, GAUNTLET_MIN_HITS), Verdict.REJECT);
  assert.equal(gauntlet(new Evidence(2, 2), anchor, GAUNTLET_MIN_HITS), Verdict.CONTINUE);
});

test('test_reject_bar_drops_a_clearly_worse_candidate_early', () => {
  assert.equal(gauntlet(new Evidence(0, 4), 0.0, 2), Verdict.CONTINUE);
  assert.equal(gauntlet(new Evidence(0, 4), 0.0, 2, 0.5), Verdict.REJECT);
  assert.equal(gauntlet(new Evidence(2, 2), 0.0, 2, 0.5), Verdict.ACCEPT);
});

test('test_reject_bar_never_turns_a_reject_into_anything_else (property)', () => {
  const r = rng('gauntlet-port', 'reject-bar');
  for (const ev of evidences('reject-bar')) {
    const anchor = floats(r), minHits = r.int(1, MIN_HITS_CEILING), bar = floats(r);
    const plain = gauntlet(ev, anchor, minHits), barred = gauntlet(ev, anchor, minHits, bar);
    if (plain === Verdict.REJECT) assert.equal(barred, Verdict.REJECT);
    if (plain === Verdict.ACCEPT) assert.equal(barred, Verdict.ACCEPT);
  }
});

test('test_policy_reject_bar_is_the_pools_lower_bound', () => {
  const policy = new NondeterminismPolicy();
  assert.equal(policy.rejectBar, 0.0);
  policy.pool = new Evidence(500, 1000);
  approxRel(policy.rejectBar, new Evidence(500, 1000).lowerBound());
});

test('test_gauntlet_can_accept_at_the_cap', () => {
  assert.equal(gauntlet(new Evidence(GAUNTLET_CAP, GAUNTLET_CAP), 0.7, GAUNTLET_MIN_HITS), Verdict.ACCEPT);
});

test('test_gauntlet_respects_pinned_min_hits', () => {
  const ev = new Evidence(5, 5);
  assert.equal(gauntlet(ev, 0.5, 4), Verdict.ACCEPT);
  assert.equal(gauntlet(ev, 0.5, 6), Verdict.CONTINUE);
});

test('test_gauntlet_always_decides_at_the_cap (property)', () => {
  const r = rng('gauntlet-port', 'decides');
  for (const ev of evidences('decides')) {
    if (ev.runs >= GAUNTLET_CAP) assert.notEqual(gauntlet(ev, floats(r), r.int(1, MIN_HITS_CEILING)), Verdict.CONTINUE);
  }
});

test('test_unreachability_reject_never_changes_an_accept (property)', () => {
  const r = rng('gauntlet-port', 'unreachable');
  for (const ev of evidences('unreachable')) {
    const anchor = floats(r), minHits = r.int(1, MIN_HITS_CEILING);
    const threshold = gauntletThreshold(anchor), verdict = gauntlet(ev, anchor, minHits);
    if (verdict === Verdict.REJECT && ev.runs < GAUNTLET_CAP) {
      const best = new Evidence(ev.interesting + GAUNTLET_CAP - ev.runs, GAUNTLET_CAP);
      assert.ok(ev.upperBound() < threshold || best.lowerBound() < threshold);
    }
  }
});

// Independent DP (upstream exact_gauntlet_outcome / exact_bar_outcome): P(accept) and E[runs] at true rate p.
function exactOutcome(decide, p, start) {
  let mass = new Map([[`${start[0]},${start[1]}`, 1.0]]);
  let accept = 0, runs = 0;
  while (mass.size) {
    const following = new Map();
    for (const [key, m] of mass) {
      const [h, n] = key.split(',').map(Number);
      const v = decide(new Evidence(h, n));
      if (v === Verdict.CONTINUE) {
        following.set(`${h + 1},${n + 1}`, (following.get(`${h + 1},${n + 1}`) ?? 0) + m * p);
        following.set(`${h},${n + 1}`, (following.get(`${h},${n + 1}`) ?? 0) + m * (1 - p));
      } else { runs += m * n; if (v === Verdict.ACCEPT) accept += m; }
    }
    mass = following;
  }
  return [accept, runs];
}
const exactGauntletOutcome = (p, anchor, minHits, { recruited }, g = gauntlet) => exactOutcome(ev => g(ev, anchor, minHits), p, recruited ? [1, 1] : [0, 0]);
const OPERATING_POINTS = [
  // [anchor, p, accept, runs, id]: the operating points upstream experiment 008 derived for these rules.
  [0.05, 0.02, 0.0198, 28.4, 'floor-fluke'], [0.05, 0.10, 0.5650, 23.9, 'floor-target'], [0.05, 0.90, 1.0000, 4.3, 'floor-reliable'],
  [0.30, 0.02, 0.0002, 20.4, 'mid-fluke'], [0.30, 0.10, 0.0182, 21.8, 'mid-target'], [0.30, 0.90, 1.0000, 4.3, 'mid-reliable'],
  [0.839, 0.02, 0.0000, 2.0, 'high-fluke'], [0.839, 0.10, 0.0000, 2.1, 'high-target'], [0.839, 0.90, 0.1216, 9.8, 'high-reliable'],
];
const operatingPointsHold = g => OPERATING_POINTS.every(([anchor, p, accept, runs]) => {
  const [a, r] = exactGauntletOutcome(p, anchor, GAUNTLET_MIN_HITS, { recruited: true }, g);
  return Math.abs(a - accept) <= 5e-4 && Math.abs(r - runs) <= 0.1;
});

test('test_gauntlet_operating_points', () => {
  for (const [anchor, p, accept, runs, id] of OPERATING_POINTS) {
    const [gotAccept, gotRuns] = exactGauntletOutcome(p, anchor, GAUNTLET_MIN_HITS, { recruited: true });
    approx(gotAccept, accept, 5e-4, id);
    approx(gotRuns, runs, 0.1, id);
    // The exported planner gives the same numbers as this independent DP.
    const op = operatingPoint(ev => gauntlet(ev, anchor, GAUNTLET_MIN_HITS), p, { start: [1, 1] });
    approx(op.accept, gotAccept, 1e-12, `${id} planner`);
    approx(op.expectedRuns, gotRuns, 1e-9, `${id} planner`);
  }
});

// === Confirmation bar ===

test('test_bar_continues_at_first', () => {
  assert.equal(confirmationBar(new Evidence(0, 0)), Verdict.CONTINUE);
  assert.equal(confirmationBar(new Evidence(1, 3)), Verdict.CONTINUE);
});

test('test_bar_accepts_on_the_min_hits', () => {
  assert.equal(confirmationBar(new Evidence(CONFIRM_MIN_HITS, 5)), Verdict.ACCEPT);
});

test('test_bar_rejects_no_hits_at_the_gate', () => {
  assert.equal(confirmationBar(new Evidence(0, GATE_RUNS - 1)), Verdict.CONTINUE);
  assert.equal(confirmationBar(new Evidence(0, GATE_RUNS)), Verdict.REJECT);
});

test('test_bar_rejects_when_quota_unreachable', () => {
  const remainingNeeded = CONFIRM_MIN_HITS - 1;
  assert.equal(confirmationBar(new Evidence(1, CONFIRM_CAP - remainingNeeded)), Verdict.CONTINUE);
  assert.equal(confirmationBar(new Evidence(1, CONFIRM_CAP - remainingNeeded + 1)), Verdict.REJECT);
});

test('test_bar_always_decides_at_the_cap (property)', () => {
  for (const ev of evidences('bar-cap')) if (ev.runs >= CONFIRM_CAP) assert.notEqual(confirmationBar(ev), Verdict.CONTINUE);
});

const exactBarOutcome = (p, bar = confirmationBar) => exactOutcome(bar, p, [0, 0]);

test('test_bar_operating_points', () => {
  // Upstream experiment 005A: 0.6% false accepts on a 2% fluke at about 15 replays, 45% power at the 10% target.
  let [accept, runs] = exactBarOutcome(0.02);
  approx(accept, 0.0059, 2e-4); approx(runs, 15.2, 0.1);
  [accept] = exactBarOutcome(0.1);
  approx(accept, 0.454, 1e-3);
});

// === Policy ===

test('test_policy_starts_deterministic', () => {
  const policy = new NondeterminismPolicy();
  assert.equal(policy.active, false); assert.equal(policy.anchor, 0.0); assert.equal(policy.confirming, false);
});

test('test_flip_is_sticky_and_idempotent', () => {
  const policy = new NondeterminismPolicy();
  assert.equal(policy.flip(), true); assert.equal(policy.active, true);
  assert.equal(policy.flip(), false); assert.equal(policy.active, true);
});

test('test_anchor_is_monotone', () => {
  const policy = new NondeterminismPolicy();
  policy.flip();
  policy.raiseAnchor(new Evidence(10, 20));
  const first = policy.anchor;
  approxRel(first, new Evidence(10, 20).lowerBound());
  policy.raiseAnchor(new Evidence(2, 20));
  assert.equal(policy.anchor, first);
  policy.raiseAnchor(new Evidence(20, 20));
  assert.ok(policy.anchor > first);
});

test('test_evidence_since_an_earlier_snapshot', () => {
  assert.deepEqual(new Evidence(7, 12).since(new Evidence(3, 5)), new Evidence(4, 7));
});

test('test_wilson_bound_tightens_with_z', () => {
  assert.ok(new Evidence(10, 20).lowerBound(1.0) > new Evidence(10, 20).lowerBound());
  assert.ok(new Evidence(10, 20).lowerBound(3.0) < new Evidence(10, 20).lowerBound());
});

test('test_anchor_z_starts_at_z_and_grows_with_attempts', () => {
  assert.equal(anchorZ(0), 1.96); assert.equal(anchorZ(1), 1.96);
  assert.ok(anchorZ(1) < anchorZ(10) && anchorZ(10) < anchorZ(1000));
  approxRel(anchorZ(1000), normalInvCdf(1 - ANCHOR_ALPHA / 1000));
  // Reference values from CPython's statistics.NormalDist().inv_cdf (3.13), which anchor_z calls upstream.
  for (const [p, want] of [[0.975, 1.9599639845400536], [0.9975, 2.8070337683438114], [0.999975, 4.055626981121907],
    [0.3, -0.5244005127080407], [0.02, -2.0537489106318225], [1e-10, -6.361340902404056], [0.9999999, 5.199337582290662]]) {
    approx(normalInvCdf(p), want, 1e-12, `inv_cdf(${p})`);
  }
  approx(anchorZ(1000), 4.055626981121907, 1e-12);
});

test('test_repeated_raises_are_held_to_a_stricter_level', () => {
  const first = new NondeterminismPolicy(); first.flip(); first.raiseAnchor(new Evidence(16, 20));
  const later = new NondeterminismPolicy(); later.flip(); later.anchorAttempts = 200; later.raiseAnchor(new Evidence(16, 20));
  assert.ok(later.anchor < first.anchor);
  assert.equal(later.anchorAttempts, 201);
});

test('test_raise_reachable_reflects_the_anchor_and_remaining_runs', () => {
  const policy = new NondeterminismPolicy(); policy.flip();
  assert.equal(policy.raiseReachable(new Evidence(0, 0), 16), true);
  assert.equal(policy.raiseReachable(new Evidence(0, 0), 0), false);
  policy.raiseAnchor(new Evidence(10, 20));
  assert.equal(policy.raiseReachable(new Evidence(0, 0), 16), true);
  policy.raiseAnchor(new Evidence(20, 20));
  assert.equal(policy.raiseReachable(new Evidence(0, 0), ANCHOR_SEED_RUNS), false);
});

test('test_threshold_follows_the_anchor', () => {
  const policy = new NondeterminismPolicy(); policy.flip(); policy.raiseAnchor(new Evidence(20, 20));
  assert.equal(policy.threshold, gauntletThreshold(policy.anchor));
});

test('test_policy_counts_replays_by_site', () => {
  const policy = new NondeterminismPolicy();
  policy.recordReplay(true, 'detection'); policy.recordReplay(false, 'gauntlet'); policy.recordReplay(false, 'gauntlet');
  assert.equal(policy.replayCalls, 3); assert.equal(policy.replayInteresting, 1);
  assert.deepEqual(policy.replaySites, { detection: 1, gauntlet: 2 });
});

test('test_false_accepts_escalate_the_hit_minimum_to_the_ceiling', () => {
  const policy = new NondeterminismPolicy();
  assert.equal(policy.minHits, INITIAL_MIN_HITS);
  for (let expected = INITIAL_MIN_HITS + 1; expected <= MIN_HITS_CEILING; expected++) {
    policy.recordFalseAccept();
    assert.equal(policy.minHits, expected);
  }
  policy.recordFalseAccept();
  assert.equal(policy.minHits, MIN_HITS_CEILING);
  assert.equal(policy.falseAccepts, MIN_HITS_CEILING - INITIAL_MIN_HITS + 1);
});

test('test_adopt_copies_the_unselected_evidence_and_pools_it', () => {
  const policy = new NondeterminismPolicy();
  const evidence = new Evidence(3, 5);
  policy.adopt(evidence);
  assert.deepEqual(policy.incumbent, new Evidence(3, 5));
  evidence.record(true);
  assert.deepEqual(policy.incumbent, new Evidence(3, 5));
  policy.adopt(new Evidence(1, 2));
  assert.deepEqual(policy.incumbent, new Evidence(1, 2));
  assert.deepEqual(policy.pool, new Evidence(4, 7));
});

test('test_incumbent_runs_feed_the_incumbent_and_the_pool', () => {
  const policy = new NondeterminismPolicy();
  policy.adopt(new Evidence(2, 2));
  policy.recordIncumbentRun(false);
  assert.deepEqual(policy.incumbent, new Evidence(2, 3));
  assert.deepEqual(policy.pool, new Evidence(2, 3));
});

test('test_a_raise_must_beat_the_rate_incumbents_have_shown', () => {
  const policy = new NondeterminismPolicy(); policy.flip();
  policy.raiseAnchor(new Evidence(10, 20));
  const start = policy.anchor;
  policy.pool = new Evidence(500, 1000);
  policy.raiseAnchor(new Evidence(12, 18));
  assert.equal(policy.anchor, start);
  assert.equal(policy.raiseReachable(new Evidence(0, 0), 4), false);
  policy.raiseAnchor(new Evidence(40, 40));
  assert.ok(policy.anchor > 0.5);
});

test('test_incumbent_failing_needs_the_upper_bound_below_the_threshold', () => {
  const policy = new NondeterminismPolicy(); policy.flip();
  policy.raiseAnchor(new Evidence(20, 20));
  assert.equal(policy.incumbentFailing(), false);
  policy.incumbent = new Evidence(0, MONITOR_MIN_RUNS - 1);
  assert.equal(policy.incumbentFailing(), false);
  policy.incumbent = new Evidence(0, MONITOR_MIN_RUNS);
  assert.equal(policy.incumbentFailing(), true);
  policy.incumbent = new Evidence(0, 20);
  assert.equal(policy.incumbentFailing(), true);
  policy.incumbent = new Evidence(40, 40);
  assert.equal(policy.incumbentFailing(), false);
});

test('test_constants_are_consistent', () => {
  const seed = new Evidence(ANCHOR_SEED_RUNS, ANCHOR_SEED_RUNS).lowerBound();
  assert.ok(seed <= new Evidence(GAUNTLET_CAP, GAUNTLET_CAP).lowerBound());
  assert.ok(seed >= RETENTION_HIGH_WATER);
  approx(GAUNTLET_GAMMA, 0.8, 1e-12);
});

// === Teeth: the reference operating points reject deliberately broken gauntlets ===

test('teeth: the operating points fail for broken variants of the gauntlet and the bar', () => {
  assert.equal(operatingPointsHold(gauntlet), true, 'the port itself must hold');
  const mutants = {
    // no hit minimum: accepts a candidate on its first lucky run
    'no min-hits': (ev, anchor) => gauntletAt(ev, gauntletThreshold(anchor), 0),
    // no unreachability reject: near-deterministic candidates burn the cap
    'no unreachable reject': (ev, anchor, minHits) => {
      const t = gauntletThreshold(anchor);
      if (ev.interesting >= minHits && ev.lowerBound() >= t) return Verdict.ACCEPT;
      if (ev.upperBound() < t || ev.runs >= GAUNTLET_CAP) return Verdict.REJECT;
      return Verdict.CONTINUE;
    },
    // gamma 1 everywhere: no retention slack below the high water
    'gamma 1': (ev, anchor, minHits) => gauntletAt(ev, Math.max(anchor, GAUNTLET_FLOOR), minHits),
    // one-sided 90% z instead of 1.96
    'z 1.645': (ev, anchor, minHits) => {
      const t = gauntletThreshold(anchor), lo = wilsonBound(ev.interesting, ev.runs, { upper: false, z: 1.645 });
      if (ev.interesting >= minHits && lo >= t) return Verdict.ACCEPT;
      return gauntletAt(new Evidence(ev.interesting, ev.runs), t, Infinity);
    },
  };
  for (const [name, g] of Object.entries(mutants)) assert.equal(operatingPointsHold(g), false, `mutant "${name}" passed the operating points`);
  // Confirmation bar without the zero-hit gate.
  const barNoGate = ev => (ev.interesting >= CONFIRM_MIN_HITS ? Verdict.ACCEPT
    : ev.interesting + (CONFIRM_CAP - ev.runs) < CONFIRM_MIN_HITS ? Verdict.REJECT : Verdict.CONTINUE);
  const [, runs] = exactBarOutcome(0.02, barNoGate);
  assert.ok(Math.abs(runs - 15.2) > 0.1, 'bar without the gate kept the 15.2-run operating point');
});
