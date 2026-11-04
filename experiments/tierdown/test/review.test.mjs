// Tests for the review 2026-11-04 fixes (RESULT-TIERDOWN.md §0): per-event tier charging (#1), wall-time latency over
// concurrent samples (#6), deopt as a loss (#10), Tango's paired interval (#11), task-level NI (#3), the rho interval
// (#14), site-priority ordering (#8), the run-ledger reconciliation that finds the interrupted pass (#7), Mercury
// re-pricing (#9), the frontier price ratios (#4), and the $0 tools readers.mjs and truth.mjs. Pure functions and the
// committed data files; no archive, no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wallMs, refWallMs, directionOf, tierChargeOf, eventsByKey, frontierRatios } from '../inject.mjs';
import { tangoInterval, tangoScore, nonInferiorTango, nonInferior, clusterBootstrapSaved, spearmanInterval, pricedUsd, normalQuantile, cascadeOf } from '../policy.mjs';
import { orderBySite, ledgerGap } from '../tier-replay.mjs';
import { readJsonl } from '../archive.mjs';
import { singleReadCost, summarise } from '../readers.mjs';
import { leafCorrect, leavesOf, truthOf, agreementCascade } from '../truth.mjs';
import { rng } from '../../../beds/lib/rng.mjs';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../research/tierdown-20261021/data');

test('#6 wallMs: concurrent samples count once, sequential calls add, gaps are not time', () => {
  assert.equal(wallMs([[0, 10], [1, 9], [2, 12], [0, 11], [3, 4]]), 12, 'a 5-sample vote takes its slowest draw, not the sum (46)');
  assert.equal(wallMs([[0, 10], [10, 15]]), 15, 'an escalation after the first tier adds');
  assert.equal(wallMs([[0, 10], [20, 25]]), 15);
  assert.equal(wallMs([]), 0);
  // createdAt is when the call returned: two Haiku readers at once, then the Opus arbiter (the s207 shape).
  const calls = [{ origCreatedAt: 48947, origLatencyMs: 48947 }, { origCreatedAt: 50351, origLatencyMs: 50351 }, { origCreatedAt: 84000, origLatencyMs: 33649 }];
  assert.equal(refWallMs(calls), 84000, 'readers overlap, the arbiter follows: 84.0 s, not the 133 s sum');
  assert.equal(refWallMs([{ origLatencyMs: 5 }, { origCreatedAt: 9, origLatencyMs: 4 }]), 9, 'an unknown interval falls back to the plain sum');
});

test('#10 directionOf: a deopt or crash of a passing unit is pass->fail; unmeasured has no direction', () => {
  assert.equal(directionOf(true, false), 'pass->fail');
  assert.equal(directionOf(false, true), 'fail->pass');
  assert.equal(directionOf(false, false), null, 'a deopt of a failing unit is not a gain');
  assert.equal(directionOf(true, null), null);
});

test('#1 tierChargeOf: one tier answer is charged per reference event x its k samples, code tiers nothing', () => {
  const ans = { costUsd: 0.008, inputTokens: 100, outputTokens: 50, cacheReadTokens: 0 };
  const readers = [{ name: 'prose-events-a', samples: 1 }, { name: 'prose-events-b', samples: 1 }, { name: 'prose-events-arbiter', samples: 1 }];
  const c = tierChargeOf({ tier: 'claude-haiku-5-5', answer: ans, events: readers });
  assert.equal(c.asks, 3); assert.ok(Math.abs(c.usd - 0.024) < 1e-12, 'three judges sent the request: three answers, not one');
  assert.deepEqual(c.tokens, { input: 300, output: 150, cacheRead: 0 });
  assert.equal(tierChargeOf({ tier: 'mercury-3', answer: ans, events: [{ samples: 5 }] }).asks, 5, 'a 5-sample vote is 5 answers');
  const r = tierChargeOf({ tier: 'rule', answer: { costUsd: 0 }, events: [{ samples: 5 }, { samples: 1 }] });
  assert.equal(r.usd, 0); assert.equal(r.asks, 2); assert.equal(r.tokens, null);
  const ev = eventsByKey([{ key: 'k', name: 'a', samples: 1, tiersTried: [{ model: 'claude-haiku-5-5' }], tier: 'claude-opus-5-5' }, { key: 'k', name: 'b', samples: 1, tier: 'claude-haiku-5-5' }, { key: null, name: 'x' }]);
  assert.deepEqual(ev.get('k').map(e => e.firstTier), ['claude-haiku-5-5', 'claude-haiku-5-5'], 'the first tier tried, not the one that answered');
  assert.equal(ev.size, 1);
  // The deployed cascade of a tier the reference already starts at IS the reference cascade: not a tier change.
  assert.deepEqual(cascadeOf({ site: 's', tier: 'claude-haiku-5-5', reference: ['claude-haiku-5-5', 'claude-sonnet-5-5'] }).tiers, ['claude-haiku-5-5', 'claude-sonnet-5-5']);
});

test('#11 Tango interval: closed form at zero discordance, the bound solves the score equation, Newcombe-style collapse avoided', () => {
  assert.ok(Math.abs(normalQuantile(0.95) - 1.6448536) < 1e-6); assert.ok(Math.abs(normalQuantile(0.975) - 1.959964) < 1e-6);
  const z = normalQuantile(0.95);
  for (const n of [6, 22, 42, 149]) {
    const iv = tangoInterval({ b: 0, c: 0, n });
    assert.ok(Math.abs(iv.lower + z * z / (n + z * z)) < 1e-9, `b = c = 0, n = ${n}: -z^2/(n+z^2)`);
    assert.ok(Math.abs(iv.upper - z * z / (n + z * z)) < 1e-9);
  }
  const iv = tangoInterval({ b: 5, c: 1, n: 42 });
  assert.ok(iv.lower < iv.estimate && iv.estimate < iv.upper);
  assert.ok(Math.abs(tangoScore({ b: 5, c: 1, n: 42 }, iv.lower) - z) < 1e-6 && Math.abs(tangoScore({ b: 5, c: 1, n: 42 }, iv.upper) + z) < 1e-6, 'the bounds are where the score crosses +-z');
  const sym = tangoInterval({ b: 1, c: 1, n: 42 });
  assert.ok(Math.abs(sym.lower + sym.upper) < 1e-9, 'symmetric counts, symmetric interval');
  assert.ok(sym.lower < tangoInterval({ b: 0, c: 0, n: 42 }).lower, 'discordance widens it');
  // The preregistered test and the corrected one on the same zero-flip data: neither shows 3 points at 42 runs.
  assert.equal(nonInferior({ b: 0, c: 0, n: 42 }).holds, false);
  const t = nonInferiorTango({ b: 0, c: 0, n: 42, byTask: Array(22).fill({ diff: 0 }) });
  assert.equal(t.holdsRuns, false); assert.equal(t.holdsTasks, false); assert.equal(t.tasks.n, 22, '#3: one unit per task');
  assert.ok(t.tasks.lower < t.runs.lower, 'fewer independent units, a wider bound');
  assert.equal(nonInferiorTango({ b: 0, c: 0, n: 400 }).holds, true, 'enough zero-discordance runs do show it');
  const mixed = nonInferiorTango({ b: 1, c: 1, n: 4, byTask: [{ diff: -0.5 }, { diff: 0.5 }, { diff: 0 }] });
  assert.equal(mixed.tasks.b, 1); assert.equal(mixed.tasks.c, 1);
});

test('#3 clusterBootstrapSaved: seeded, resamples tasks, not runs', () => {
  const units = [{ task: 'a', policyUsd: 1, refUsd: 2 }, { task: 'a', policyUsd: 1, refUsd: 2 }, { task: 'b', policyUsd: 2, refUsd: 2 }];
  const x = clusterBootstrapSaved(units, { iterations: 500 }, rng), y = clusterBootstrapSaved(units, { iterations: 500 }, rng);
  assert.deepEqual(x, y, 'deterministic');
  assert.equal(x.tasks, 2); assert.ok(Math.abs(x.estimate - (1 - 4 / 6)) < 1e-12);
  assert.ok(x.lower <= x.estimate && x.estimate <= x.upper); assert.ok(x.lower >= 0 && x.upper <= 0.5 + 1e-12, 'bounded by the two tasks\' own savings');
});

test('#14 spearmanInterval: rho 0.53 over 10 sites spans zero', () => {
  const iv = spearmanInterval(0.53, 10);
  assert.ok(iv.lower < 0 && iv.upper > 0.8, `${iv.lower} .. ${iv.upper}`);
  assert.equal(spearmanInterval(0.5, 3), null);
});

test('#8 orderBySite: --sites is a priority order; within a site the archive order holds', () => {
  const d = [{ site: 'b', i: 1 }, { site: 'a', i: 2 }, { site: 'c', i: 3 }, { site: 'b', i: 4 }, { site: 'a', i: 5 }];
  assert.deepEqual(orderBySite(d, ['a', 'b']).map(x => x.i), [2, 5, 1, 4], 'all of a before any b; c is not asked');
});

test('#7 ledgerGap finds the interrupted C pass in the committed data: 31 Haiku answers ($0.171923) and 111,092 Mercury tokens with no ledger line', () => {
  const answers = readJsonl(path.join(DATA, 'answers-C.jsonl')), runs = readJsonl(path.join(DATA, 'answers-C.runs.jsonl'));
  const g = ledgerGap({ answers, runs, capUsd: 3, tokenCap: 225000 });
  assert.ok(Math.abs(g.gap.haikuUsd - 0.171923) < 2e-6, `Haiku gap ${g.gap.haikuUsd} (ledger lines round spentUsd to 1e-6)`);
  assert.equal(g.gap.mercuryTokens, 111092);
  assert.ok(Math.abs(g.usedBeforeFirst.haikuUsd - 0.171923) < 2e-6, 'the first ledgered run already saw it spent');
  assert.equal(g.usedBeforeFirst.mercuryTokens, 111092);
  const h = ledgerGap({ answers: readJsonl(path.join(DATA, 'answers-H.jsonl')), runs: readJsonl(path.join(DATA, 'answers-H.runs.jsonl')) });
  assert.ok(Math.abs(h.gap.haikuUsd) < 1e-6 && h.gap.mercuryTokens === 0, 'every H answer is ledgered');
  const rec = readJsonl(path.join(DATA, 'answers-C.runs.reconstructed.jsonl'));
  assert.equal(rec.length, 1); assert.equal(rec[0].reconstructed, true); assert.equal(rec[0].tokens.inception.spent, 111092);
});

test('#9 pricedUsd and #4 frontier ratios come from the owner policy file', () => {
  assert.ok(Math.abs(pricedUsd({ input: 2074, output: 6227, cacheRead: 21 }, { inputPerMTok: 0.2, outputPerMTok: 0.75, cacheReadPerMTok: 0.02 }) - 0.00508) < 1e-5, 'vendex at mercury-2.5 list price');
  assert.equal(pricedUsd(null, { inputPerMTok: 1, outputPerMTok: 1 }), 0);
  const r = frontierRatios(JSON.parse(readFileSync(path.join(DATA, '../../../policy/models.json'), 'utf8')));
  assert.equal(r['claude-haiku-5-5'], 40); assert.equal(r['claude-sonnet-5-5'], 2); assert.equal(r['claude-opus-5-5'], 1);
  assert.equal(r['mercury-3'], undefined, 'a $0 listing has no ratio');
});

test('readers.mjs: single-read cost escalates on a rejected check; summary counts losses over draws', () => {
  assert.equal(singleReadCost({ drawUsd: 0.008, checkRejected: false, unitOpusUsd: 0.3 }), 0.008);
  assert.ok(Math.abs(singleReadCost({ drawUsd: 0.008, checkRejected: true, unitOpusUsd: 0.3 }) - 0.308) < 1e-12);
  assert.ok(Math.abs(singleReadCost({ drawUsd: 0.008, checkRejected: true, unitOpusUsd: null, siteOpusUsd: 0.17 }) - 0.178) < 1e-12);
  const d = (row, basePass, pass, refUsd, singleReadUsd) => ({ row, basePass, pass, outcome: basePass === pass ? 'same' : 'flip', checkRejected: false, refUsd, singleReadUsd });
  const s = summarise([d('u1', true, true, 0.2, 0.01), d('u1', true, false, 0.2, 0.01), d('u2', true, true, 0.02, 0.01), d('u2', true, true, 0.02, 0.03)]);
  assert.equal(s.draws, 4); assert.equal(s.units, 2); assert.equal(s.losses, 1);
  assert.ok(Math.abs(s.saved - (1 - (0.01 + 0.02) / 0.22)) < 1e-12, 'per-unit mean of draws, summed');
  // The committed $0 measurement: two of 30 single-read draws lose the task, both in units where the readers disagreed
  // and the Opus arbiter decided.
  const res = JSON.parse(readFileSync(path.join(DATA, 'readers-prose-events.json'), 'utf8'));
  assert.equal(res.summary.all.draws, 30); assert.equal(res.summary.all.losses, 2);
  assert.ok(res.draws.filter(x => x.basePass && !x.pass).every(x => x.refEvents.some(e => e.startsWith('prose-events-arbiter@'))));
});

test('truth.mjs: leaves against the world, unscorable labels never counted, the agreement cascade', () => {
  const truth = { BRIGHTDESK: 'MDY', ATLAS: 'DMY', VENDEX: 'MDY', atlasSwitch: 'DMY_then_MDY' };
  assert.equal(leafCorrect('records/rules', 'ATLAS', 'DMY', truth), true);
  assert.equal(leafCorrect('records/rules', 'BRIGHTDESK', 'DMY', truth), false);
  assert.equal(leafCorrect('records/source-rules', 'ATLAS', 'DMY_then_MDY', truth), true);
  assert.equal(leafCorrect('records/source-rules', 'ATLAS', 'MDY_then_DMY', truth), false);
  assert.equal(leafCorrect('records/source-rules', 'VENDEX', 'MDY_from_2015', truth), null, 'a solver-specific label is unscorable');
  assert.deepEqual(leavesOf('records/rules', { date_order: { ATLAS: 'DMY', BRIGHTDESK: 'MDY' } }), { ATLAS: 'DMY', BRIGHTDESK: 'MDY' });
  assert.deepEqual(leavesOf('records/source-rules', { rules: { atlas_numeric_dates: { value: 'DMY' }, vendex_numeric_dates: { value: 'MDY' } } }), { ATLAS: 'DMY', VENDEX: 'MDY' });
  const t = truthOf({ seed: 1, difficulty: 4 }, () => ({ ctx: { conv: { bd: 'mdy', atlas: 'dmy', vendex: 'mdy' }, cutoff: 123 } }));
  assert.deepEqual(t, truth);
  const dec = (row, ruleLeaves, mercLeaves, basePass) => ({ row, taskKey: row, slice: 'H', truth, ref: { ATLAS: 'MDY' }, refUsd: 0.01, basePass,
    tiers: { rule: { ok: true, leaves: ruleLeaves }, 'mercury-3': { ok: true, leaves: mercLeaves } } });
  const inj = new Map([['records/date-order@rule\0r1', { basePass: false, pass: true }]]);
  const c = agreementCascade([dec('r1', { ATLAS: 'DMY' }, { ATLAS: 'DMY' }, false), dec('r2', { ATLAS: 'DMY' }, { ATLAS: 'MDY' }, true)], inj);
  assert.equal(c.agree, 1); assert.equal(c.gains, 1); assert.equal(c.losses, 0);
  assert.ok(Math.abs(c.usd - 0.01) < 1e-12, 'a disagreement pays the reference; an agreement nothing');
  assert.equal(c.leafCorrect, 1, 'r1 serves the right rule leaf; r2 falls back to a wrong reference leaf');
});
