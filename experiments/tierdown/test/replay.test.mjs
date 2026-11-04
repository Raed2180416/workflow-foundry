// Tier-down integration tests on the archived streams (A10 / #42): a real sandboxed replay of an archived compiled
// answer under the strict memo, a perturbation that must flip the oracle, a served answer the solver's own check must
// reject (and the cascade must fall back), and a replay miss that must be counted as unmeasured, never as a flip.
// $0: no model is called (a strict memo port has no live fallback). Needs the archive: TIERDOWN_RUNS=<path>, else
// research/jit-20261008/runs in this checkout, else the same path in the main worktree (git common dir), so a linked
// worktree runs the test instead of skipping it (review 2026-11-04 #15). When none exists the skip says so on stderr,
// and TIERDOWN_REQUIRE_ARCHIVE=1 turns the skip into a failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listArms, DEFAULT_RUNS, REPO, rowId } from '../archive.mjs';
import { replayRow } from '../replay.mjs';
import { outcomeOf, decisionsOf } from '../leverage.mjs';
import { injectRow } from '../inject.mjs';
import { perturbations } from '../perturb.mjs';

const mainTreeRuns = () => {
  try { return path.join(path.dirname(path.resolve(REPO, execFileSync('git', ['-C', REPO, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim())), 'research/jit-20261008/runs'); }
  catch { return null; }
};
const RUNS = [process.env.TIERDOWN_RUNS, DEFAULT_RUNS, mainTreeRuns()].filter(Boolean).find(p => existsSync(path.join(p, 'jit-dev-records-1'))) ?? null;
const skip = RUNS ? false : 'archive not found (TIERDOWN_RUNS, this checkout, the main worktree)';
if (skip) { console.error(`replay.test.mjs: SKIPPED, ${skip}`); if (process.env.TIERDOWN_REQUIRE_ARCHIVE === '1') throw new Error(`replay.test.mjs: ${skip}`); }
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

    // An error served to the rules reader: the solver deopts on its only tier (a caught failure, not a miss).
    const err = await replayRow({ arm, row, flowPath: arm.flows.hooked, work, overrideData: { serve: [{ key: rules.key, error: 'invalid' }] } });
    assert.equal(outcomeOf(base, err), 'deopt');
  } finally { rmSync(work, { recursive: true, force: true }); }
});

// A REAL replay miss (review #15: the earlier case faked it with {...err, memo: {misses: 1}}). On row #8 of the same arm
// the leverage screen found that swapping one void marker's text changes the prompt of a later judge, which the strict
// memo cannot answer: the replay must count the miss and the outcome must be 'unmeasured', never a flip.
test('a served answer that changes a later prompt is a real replay miss: unmeasured, never a flip', { skip, timeout: 300000 }, async () => {
  const work = mkdtempSync(path.join(tmpdir(), 'tierdown-it-'));
  try {
    const arm = listArms({ runs: RUNS, experiments: ['jit-dev-records-1'] }).find(a => a.slug === 'jit-claude-sonnet-5-5--claude-haiku-5-5');
    const row = arm.rows.find(r => rowId(arm, r) === 'jit-dev-records-1/jit-claude-sonnet-5-5--claude-haiku-5-5#8');
    const base = await replayRow({ arm, row, flowPath: arm.flows.hooked, work });
    assert.equal(base.status, 'ok'); assert.equal(base.memo.misses, 0);
    const rules = decisionsOf(base, arm.family).find(d => d.name === 'rules');
    const p = perturbations(rules.value, rules.schema).find(x => x.kind === 'swap' && x.path.join(',') === 'void_markers,4,marker');
    assert.ok(p, 'the screened perturbation is regenerated');
    const run = await replayRow({ arm, row, flowPath: arm.flows.hooked, work, overrideData: { serve: [{ key: rules.key, value: p.value }] } });
    assert.ok(run.memo.misses > 0, 'the strict memo missed a changed later request');
    assert.equal(outcomeOf(base, run), 'unmeasured');
  } finally { rmSync(work, { recursive: true, force: true }); }
});
