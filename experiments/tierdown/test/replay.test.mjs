// Tier-down integration tests on the archived streams (A10 / #42): a real sandboxed replay of an archived compiled
// answer under the strict memo, a perturbation that must flip the oracle, a served answer the solver's own check must
// reject (and the cascade must fall back), and a replay miss that must be counted as unmeasured, never as a flip.
// $0: no model is called (a strict memo port has no live fallback). Needs the archive: research/jit-20261008/runs, or
// TIERDOWN_RUNS=<path>; skipped when it is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listArms, DEFAULT_RUNS, rowId } from '../archive.mjs';
import { replayRow } from '../replay.mjs';
import { outcomeOf, decisionsOf } from '../leverage.mjs';
import { injectRow } from '../inject.mjs';

const RUNS = process.env.TIERDOWN_RUNS ?? DEFAULT_RUNS;
const skip = existsSync(path.join(RUNS, 'jit-dev-records-1')) ? false : `archive not found at ${RUNS}`;
const ROW = 'jit-dev-records-1/jit-claude-sonnet-5-5--claude-haiku-5-5#3';   // records d3 seed 204, Opus 'rules' judge, archived pass

test('archived compiled answer: faithful strict replay, a decisive perturbation flips, a guarded one falls back', { skip, timeout: 300000 }, async () => {
  const work = mkdtempSync(path.join(tmpdir(), 'tierdown-it-'));
  try {
    const arms = listArms({ runs: RUNS, experiments: ['jit-dev-records-1'] });
    const arm = arms.find(a => a.slug === 'jit-claude-sonnet-5-5--claude-haiku-5-5'), row = arm.rows.find(r => rowId(arm, r) === ROW);
    assert.ok(row, 'the archived row exists');
    const base = await replayRow({ arm, row, flowPath: arm.flows.hooked, work });
    assert.equal(base.status, 'ok'); assert.equal(base.memo.misses, 0); assert.equal(base.memo.live, 0, 'nothing went live');
    assert.equal(base.pass, true); assert.equal(base.score, row.score, 'the replay scores what the archive recorded');
    const decisions = decisionsOf(base, arm.family);
    const rules = decisions.find(d => d.name === 'rules');
    assert.ok(rules && rules.models.includes('claude-opus-5-5'), 'the rules reader ran at Opus');
    assert.ok(rules.origCostUsd > 0, 'its archived spend is joined to the decision');

    // The VENDEX numeric date order read the other way: every numeric VENDEX date moves, the oracle must fail.
    const swapped = structuredClone(rules.value);
    swapped.date_order.VENDEX = swapped.date_order.VENDEX === 'DMY' ? 'MDY' : 'DMY';
    const flipped = await replayRow({ arm, row, flowPath: arm.flows.hooked, work, overrideData: { serve: [{ key: rules.key, value: swapped }] } });
    assert.equal(outcomeOf(base, flipped), 'flip');
    assert.equal(flipped.pass, false);
    assert.equal(flipped.memo.misses, 0, 'every other judge still answered from the journal');

    // The same value served back changes nothing.
    const same = await replayRow({ arm, row, flowPath: arm.flows.hooked, work, overrideData: { serve: [{ key: rules.key, value: rules.value }] } });
    assert.equal(outcomeOf(base, same), 'same');

    // A countries answer with one mapping dropped: the solver's check rejects it at every tier (judge ok: false). The
    // injection cascade must take it out, fall back to the reference answer and come out 'same', charging both tiers.
    const countries = decisions.find(d => d.name === 'countries');
    const bad = { ...countries.value, mapping: countries.value.mapping.slice(1) };
    const answersByKey = new Map([[countries.key, new Map([['mercury-3', { ok: true, value: bad, costUsd: 0.001, latencyMs: 5, samples: 1 }]])]]);
    const r = await injectRow({ arm, row, base, assignment: { name: 't', map: { 'records/countries': 'mercury-3' } }, answersByKey, work, interpreterUsd: 0.5 });
    assert.equal(r.status, 'measured'); assert.equal(r.outcome, 'same');
    assert.deepEqual(r.fellBack, { 'check-failed': 1 }); assert.equal(r.escalationRounds, 1);
    assert.ok(Math.abs(r.judgeUsd - (r.refUsd + 0.001)) < 1e-9, 'tier cost plus the reference it fell back to');

    // A served answer that changes a later judge's prompt would be a replay miss: unmeasured, never a flip. Simulated by
    // serving an error for the rules reader: the solver deopts on its only tier (a caught failure, not a miss).
    const err = await replayRow({ arm, row, flowPath: arm.flows.hooked, work, overrideData: { serve: [{ key: rules.key, error: 'invalid' }] } });
    assert.equal(outcomeOf(base, err), 'deopt');
    assert.equal(outcomeOf(base, { ...err, memo: { misses: 1 } }), 'unmeasured');
  } finally { rmSync(work, { recursive: true, force: true }); }
});
