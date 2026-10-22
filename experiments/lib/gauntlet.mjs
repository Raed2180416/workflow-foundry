// Sequential gauntlet for decisions under a nondeterministic oracle: a faithful JavaScript port of shrinkray's
// `src/shrinkray/nondeterminism.py` (ATTACK.md §6 Move 0; research/blockers-20261021/MOVE0-CERTIFY.md §2). Pure
// arithmetic, no I/O, no dependency. The conformance suite is the port of the upstream `tests/test_nondeterminism.py`
// (45 test functions) in gauntlet.test.mjs.
//
// Source: https://github.com/DRMacIver/shrinkray, commit 5fe6ee135d732e4b7758b3dbe3d91428523018fb (HEAD of main on
// 2026-10-22), files src/shrinkray/nondeterminism.py (sha256 c73ac190…5ec2a, 355 lines) and tests/test_nondeterminism.py
// (sha256 27374578…1464, 503 lines), fetched 2026-10-22 as inert files (no install, nothing executed). Licence: MIT.
//
//   MIT License
//   Copyright © 2023 David R. MacIver
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
//   documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
//   rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
//   persons to whom the Software is furnished to do so, subject to the following conditions:
//   The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
//   Software.
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
//   WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
//   COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
// What it decides (upstream docstring, condensed). A deterministic reducer treats one run of the test as a verdict; under a
// nondeterministic test one run is a sample. A candidate is adopted only when the Wilson lower bound of its rate clears
// max(gamma * anchor, floor) with at least `minHits` hits (the gauntlet); the incumbent's rate is a monotone anchor (a lower
// bound raised only on unselected evidence, at a Bonferroni z over the attempts); each candidate keeps a ledger of evidence
// across retries; the incumbent is monitored by fresh replays, and an incumbent whose upper bound falls below the threshold
// is a detected false accept, answered by raising the hit minimum by one (up to 12). The gauntlet also rejects as soon as
// the threshold has become unreachable within the run cap.
//
// Port notes. Names are camelCase; constants keep their upstream names. Evidence equality is by value (attrs @define):
// compare with assert.deepEqual. `normalInvCdf` is a port of Wichura's AS241 (PPND16), the algorithm Python's
// statistics.NormalDist.inv_cdf implements, so anchorZ matches upstream to the last bits. Foundry's use ("reverse
// polarity": the interesting event is "the failure reproduces", and a patch must lower its rate) is in certify.mjs, not
// here; this file stays a faithful port.

/** Wilson z for a two-sided 95% interval (a tuning constant: the operating points in the tests are the specification). */
export const Z = 1.96;
/** One-sided level the anchor's raises are held to over all of a run's attempts together (see anchorZ). */
export const ANCHOR_ALPHA = 0.025;
/** Replays of the initial and final test case used to detect nondeterminism. */
export const DETECTION_REPLAYS = 4;
/** While believed deterministic, the current case is re-run once every this many calls. */
export const VERIFY_INTERVAL = 100;
/** Confirmation bar: reject with no hits once the gate is reached, accept on the 4th hit, give up at the cap. */
export const GATE_RUNS = 10;
export const CONFIRM_CAP = 40;
export const CONFIRM_MIN_HITS = 4;
/** The gauntlet's run cap, gamma, floor and the hit minimum its operating points are derived at. */
export const GAUNTLET_CAP = 30;
export const GAUNTLET_GAMMA = 0.8;
export const GAUNTLET_FLOOR = 0.05;
export const GAUNTLET_MIN_HITS = 4;
/** Once the anchor is this high the incumbent counts as deterministic and gamma becomes 1.0. */
export const RETENTION_HIGH_WATER = 0.8;
/** Batches that may seed or raise the anchor are extended to this many runs. */
export const ANCHOR_SEED_RUNS = 20;
/** The hit minimum a run starts with, and the ceiling observed false accepts may escalate it to. */
export const INITIAL_MIN_HITS = 2;
export const MIN_HITS_CEILING = 12;
/** The incumbent monitor judges only once it has this many fresh replays. */
export const MONITOR_MIN_RUNS = 5;

/**
 * Inverse of the standard normal CDF: Wichura (1988), Algorithm AS241 PPND16, as in CPython's
 * statistics._normal_dist_inv_cdf. Accurate to about 1e-16 relative.
 */
export function normalInvCdf(p, mu = 0, sigma = 1) {
  if (!(p > 0 && p < 1)) throw new Error(`normalInvCdf: p must be in (0, 1), got ${p}`);
  const q = p - 0.5;
  let num, den, x;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    num = (((((((2.5090809287301226727e+3 * r + 3.3430575583588128105e+4) * r + 6.7265770927008700853e+4) * r
      + 4.5921953931549871457e+4) * r + 1.3731693765509461125e+4) * r + 1.9715909503065514427e+3) * r
      + 1.3314166789178437745e+2) * r + 3.3871328727963666080e+0) * q;
    den = (((((((5.2264952788528545610e+3 * r + 2.8729085735721942674e+4) * r + 3.9307895800092710610e+4) * r
      + 2.1213794301586595867e+4) * r + 5.3941960214247511077e+3) * r + 6.8718700749205790830e+2) * r
      + 4.2313330701600911252e+1) * r + 1.0);
    return mu + (num / den) * sigma;
  }
  let r = q <= 0 ? p : 1 - p;
  r = Math.sqrt(-Math.log(r));
  if (r <= 5.0) {
    r -= 1.6;
    num = (((((((7.7454501427834140764e-4 * r + 2.2723844989269184583e-2) * r + 2.4178072517745061177e-1) * r
      + 1.2704582524523683826e+0) * r + 3.6478483247632045965e+0) * r + 5.7694972214606914055e+0) * r
      + 4.6303378461565452959e+0) * r + 1.4234371107496835773e+0);
    den = (((((((1.05075007164441684324e-9 * r + 5.4759380849953445460e-4) * r + 1.5198666563616457197e-2) * r
      + 1.4810397642748007459e-1) * r + 6.8976733498510000455e-1) * r + 1.6763848301838038494e+0) * r
      + 2.0531916266377588219e+0) * r + 1.0);
  } else {
    r -= 5.0;
    num = (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 1.2426609473880784386e-3) * r
      + 2.6532189526576123093e-2) * r + 2.9656057182850489123e-1) * r + 1.7848265399172913358e+0) * r
      + 5.4637849111641143699e+0) * r + 6.6579046435011037772e+0);
    den = (((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r
      + 7.8686913114561329059e-4) * r + 1.4875361290850615025e-2) * r + 1.3692988092273580531e-1) * r
      + 5.9983220655588793769e-1) * r + 1.0);
  }
  x = num / den;
  if (q < 0) x = -x;
  return mu + x * sigma;
}

/** One side of the Wilson score interval for interesting / runs. */
export function wilsonBound(interesting, runs, { upper, z = Z } = {}) {
  if (typeof upper !== 'boolean') throw new Error('wilsonBound: pass { upper: true | false }');
  if (runs <= 0) return upper ? 1.0 : 0.0;
  // The closed form drifts a few ulps past the ends; the ends are exact.
  if (interesting === 0 && !upper) return 0.0;
  if (interesting === runs && upper) return 1.0;
  const p = interesting / runs, z2 = z * z;
  const denominator = 1.0 + z2 / runs;
  const centre = p + z2 / (2.0 * runs);
  const margin = z * Math.sqrt((p * (1.0 - p) + z2 / (4.0 * runs)) / runs);
  const bound = (upper ? centre + margin : centre - margin) / denominator;
  return Math.min(1.0, Math.max(0.0, bound));
}

/**
 * The z for the `attempts`-th attempt to raise the anchor: a Bonferroni level over the attempts so far, so the chance that
 * any raise ever overshoots the true rate stays at the single-test level.
 */
export function anchorZ(attempts) {
  return Math.max(Z, normalInvCdf(1.0 - ANCHOR_ALPHA / Math.max(attempts, 1)));
}

/** How many of a test case's runs were interesting. */
export class Evidence {
  constructor(interesting = 0, runs = 0) {
    this.interesting = interesting;
    this.runs = runs;
  }
  record(interesting) {
    this.runs += 1;
    if (interesting) this.interesting += 1;
  }
  get rate() { return this.runs === 0 ? 0.0 : this.interesting / this.runs; }
  lowerBound(z = Z) { return wilsonBound(this.interesting, this.runs, { upper: false, z }); }
  upperBound() { return wilsonBound(this.interesting, this.runs, { upper: true }); }
  /** The runs recorded after `earlier`, an earlier snapshot of this evidence. */
  since(earlier) { return new Evidence(this.interesting - earlier.interesting, this.runs - earlier.runs); }
}

export const Verdict = Object.freeze({ ACCEPT: 'ACCEPT', REJECT: 'REJECT', CONTINUE: 'CONTINUE' });

export function gauntletThreshold(anchor) {
  const gamma = anchor >= RETENTION_HIGH_WATER ? 1.0 : GAUNTLET_GAMMA;
  return Math.max(gamma * anchor, GAUNTLET_FLOOR);
}

/**
 * Decide whether a candidate's evidence clears the incumbent's anchor. `rejectBar` lets a caller give up earlier: once
 * the candidate's upper bound is below it (only ever forgoes an adoption, never makes one).
 */
export function gauntlet(evidence, anchor, minHits, rejectBar = 0.0) {
  return gauntletAt(evidence, gauntletThreshold(anchor), minHits, rejectBar);
}

/** The gauntlet at an explicit threshold (upstream `_gauntlet_at`). */
export function gauntletAt(evidence, threshold, minHits, rejectBar = 0.0) {
  if (evidence.interesting >= minHits && evidence.lowerBound() >= threshold) return Verdict.ACCEPT;
  if (evidence.upperBound() < Math.max(threshold, rejectBar)) return Verdict.REJECT;
  if (evidence.runs >= GAUNTLET_CAP) return Verdict.REJECT;
  // Even if every remaining run were interesting the bound would not clear the threshold: nothing is left to learn.
  const remaining = GAUNTLET_CAP - evidence.runs;
  const best = new Evidence(evidence.interesting + remaining, GAUNTLET_CAP);
  if (best.lowerBound() < threshold) return Verdict.REJECT;
  return Verdict.CONTINUE;
}

/** Decide whether an incumbent adopted on one run really reproduces. */
export function confirmationBar(evidence) {
  if (evidence.interesting >= CONFIRM_MIN_HITS) return Verdict.ACCEPT;
  if (evidence.interesting === 0 && evidence.runs >= GATE_RUNS) return Verdict.REJECT;
  if (evidence.interesting + (CONFIRM_CAP - evidence.runs) < CONFIRM_MIN_HITS) return Verdict.REJECT;
  return Verdict.CONTINUE;
}

/**
 * The run-level state of nondeterminism handling. `active` is sticky; `anchor` is the monotone lower bound on the
 * incumbent's rate; `minHits` starts at INITIAL_MIN_HITS and escalates by one per observed false accept (to the ceiling);
 * `incumbent` is fresh, unselected evidence about the current incumbent; `pool` the same evidence over every incumbent.
 */
export class NondeterminismPolicy {
  constructor() {
    this.active = false;
    this.anchor = 0.0;
    this.confirming = false;
    this.minHits = INITIAL_MIN_HITS;
    this.falseAccepts = 0;
    this.incumbent = new Evidence();
    this.pool = new Evidence();
    this.anchorAttempts = 0;
    this.replayCalls = 0;
    this.replayInteresting = 0;
    this.replaySites = {};
  }
  /** Switch into nondeterministic handling; returns whether this call was the one that switched. */
  flip() {
    if (this.active) return false;
    this.active = true;
    return true;
  }
  get threshold() { return gauntletThreshold(this.anchor); }
  /** The rate a candidate must not be significantly below: what incumbents have reproduced at (a lower bound). */
  get rejectBar() { return this.pool.lowerBound(); }
  /** What a raise must beat: the anchor, and the rate incumbents have reproduced at so far. */
  get raiseBar() { return Math.max(this.anchor, this.pool.rate); }
  /** Whether `remaining` more runs after `unselected` could raise the anchor on the next attempt, even if all hit. */
  raiseReachable(unselected, remaining) {
    const best = new Evidence(unselected.interesting + remaining, unselected.runs + remaining);
    return best.lowerBound(anchorZ(this.anchorAttempts + 1)) > this.raiseBar;
  }
  /** Raise the anchor to `evidence`'s lower bound (at the attempt's z) if that beats the raise bar. Pass unselected runs. */
  raiseAnchor(evidence) {
    this.anchorAttempts += 1;
    const bound = evidence.lowerBound(anchorZ(this.anchorAttempts));
    if (bound > this.raiseBar) this.anchor = bound;
  }
  /** A fresh replay of the incumbent, from the monitor. */
  recordIncumbentRun(interesting) {
    this.incumbent.record(interesting);
    this.pool.record(interesting);
  }
  /** A new incumbent: start its monitor from the runs that did not take part in accepting it, and pool them. */
  adopt(unselected) {
    this.incumbent = new Evidence(unselected.interesting, unselected.runs);
    this.pool.interesting += unselected.interesting;
    this.pool.runs += unselected.runs;
  }
  /** Whether the incumbent's fresh evidence rules out the rate the gauntlet required of it. */
  incumbentFailing() {
    return this.incumbent.runs >= MONITOR_MIN_RUNS && this.incumbent.upperBound() < this.threshold;
  }
  recordFalseAccept() {
    this.falseAccepts += 1;
    this.minHits = Math.min(MIN_HITS_CEILING, this.minHits + 1);
  }
  recordReplay(interesting, site) {
    this.replayCalls += 1;
    if (interesting) this.replayInteresting += 1;
    this.replaySites[site] = (this.replaySites[site] ?? 0) + 1;
  }
}

/**
 * Exact operating point of a stopping rule at true rate p: P(accept) and E[runs], by dynamic programming over the
 * (hits, runs) lattice (the upstream tests' exact_gauntlet_outcome / exact_bar_outcome, exported for planning).
 * `decide(evidence)` returns a Verdict; `start` is the entry evidence ([1, 1] for a candidate recruited on a hit).
 */
export function operatingPoint(decide, p, { start = [0, 0] } = {}) {
  let mass = new Map([[start.join(','), { h: start[0], r: start[1], m: 1.0 }]]);
  let accept = 0.0, expectedRuns = 0.0;
  while (mass.size) {
    const next = new Map();
    const add = (h, r, m) => { const k = `${h},${r}`; const c = next.get(k); if (c) c.m += m; else next.set(k, { h, r, m }); };
    for (const { h, r, m } of mass.values()) {
      const v = decide(new Evidence(h, r));
      if (v === Verdict.CONTINUE) { add(h + 1, r + 1, m * p); add(h, r + 1, m * (1 - p)); }
      else { expectedRuns += m * r; if (v === Verdict.ACCEPT) accept += m; }
    }
    mass = next;
  }
  return { accept, expectedRuns };
}
