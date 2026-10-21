// SPEC-1 / INTENT-1 end to end at $0 (scripted builder, scripted agent sessions, scripted Haiku stand-in behind the
// journaled ModelPort; no model call, no network): a derive-ledger lineage (extraction, owner review, ask channel, smoke
// loop, grading with no spec), a none-agent lineage that stops on an environment fault and resumes from its journal with
// the owner's journal restored, the spend ledger across both, and score.mjs over the outputs. About 1 min.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dryRunner, dryRunnerWith } from '../../agentv/run.mjs';
import { runBuildLineage, runAgentLineage, spendTotals, SHARED, CAPS } from '../spec1.mjs';
import { scriptedPackSession } from '../pack-agent.mjs';
import { scoreRuns } from '../score.mjs';
import { validateClaimRow } from '../../claims/schema.mjs';

const readJsonl = f => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

test('dry end to end: derive-ledger and none-agent (stopped by an environment fault, resumed), spend ledger, journals, scoring', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'spec1-dry-'));
  const dirs = { liveRoot: path.join(root, 'live'), outRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work') };
  const spendFile = path.join(dirs.outRoot, 'spend.jsonl');
  const log = () => {};
  try {
    // 1. A derive-ledger lineage on the shared world, smoke loop on a small practice world.
    const b = await runBuildLineage({ armName: 'derive-ledger', lineage: 1, dry: true, label: 'dry-t-ledger', ...dirs, spendFile, worlds: [SHARED],
      practice: { seeds: [1235], difficulties: [2], size: 4 }, log });
    assert.equal(b.summary.shared.completed, 14);
    assert.equal(b.build.scripted, true);
    assert.equal(b.build.smokeRuns, 1);
    assert.ok(b.ledger.counts.entries > 0 && b.ledger.counts.corrected > 0 && b.ledger.counts.struck > 0);
    assert.equal(b.owner.asked, 2);
    assert.deepEqual(b.owner.replay, { ok: true, mismatches: [] });
    const db = new DatabaseSync(b.journals.modelPort.file);
    assert.equal(db.prepare('SELECT count(*) AS n FROM model_calls').get().n, b.journals.modelPort.rows);
    assert.equal(b.journals.modelPort.rows, 1 + 2, 'one extraction and two match judgments, all journaled');
    db.close();
    for (const f of ['solver.mjs', 'transcript.jsonl', 'smoke.jsonl', 'ask.jsonl', 'match.jsonl', 'LEDGER.md', 'ledger.json', 'result.json']) assert.ok(existsSync(path.join(dirs.outRoot, 'dry-t-ledger', f)), f);
    assert.ok(!readFileSync(path.join(dirs.workRoot, 'dry-t-ledger', 'TASK.md'), 'utf8').includes('SPEC-E.md exactly'));
    assert.ok(!existsSync(path.join(dirs.workRoot, 'dry-t-ledger', 'SPEC-E.md')));
    assert.ok(existsSync(path.join(dirs.workRoot, 'dry-t-ledger', 'LEDGER.md')));

    // 2. none-agent: the 3rd scripted session ends in MODEL_RATE_LIMIT: the run freezes at its last commit, nothing is graded.
    const world = { seed: 1241, d: 2, size: 3, set: 'shared' };
    const common = { lineage: 1, dry: true, label: 'dry-t-agent', ...dirs, spendFile, world, concurrency: 1, log };
    const first = scriptedPackSession({ after: dryRunnerWith({ envFaultAt: 3 }), askOn: [1] });
    await assert.rejects(runAgentLineage({ ...common, inner: first }), e => e.code === 'SPEC1_FROZEN');
    assert.ok(!existsSync(path.join(dirs.outRoot, 'dry-t-agent', 'result.json')));
    const askedBefore = readJsonl(path.join(dirs.liveRoot, 'dry-t-agent', 'ask.jsonl')).length;
    assert.equal(askedBefore, 1);
    // The same command resumes: the committed prefix replays, the owner's journal is restored, the run completes.
    const second = scriptedPackSession({ after: dryRunner, askOn: [1] });
    const a = await runAgentLineage({ ...common, inner: second });
    assert.equal(a.resumed, true);
    assert.equal(a.status, 'complete');
    assert.equal(a.owner.asked, askedBefore + 1, 'question numbering continues across the resume');
    assert.deepEqual(a.owner.journal.map(r => r.n), [1, 2]);
    assert.deepEqual(a.owner.replay, { ok: true, mismatches: [] });
    assert.ok(second.seen.every(s => s.pack && !s.spec));

    // 3. The spend ledger: every reservation settled ($0 in a dry run); the caps are the preregistered ones.
    const rows = readJsonl(spendFile);
    const reserved = new Set(rows.filter(r => r.op === 'reserve').map(r => r.id)), settled = new Set(rows.filter(r => r.op === 'settle').map(r => r.id));
    assert.deepEqual([...reserved].filter(id => !settled.has(id)), []);
    assert.equal(spendTotals(spendFile).totalUsd, 0);
    assert.ok(rows.every(r => r.dry === true));
    assert.equal(rows.filter(r => r.op === 'reserve' && r.arm === 'none-agent').length, 4, 'two invocations, each reserving sessions and matcher');
    assert.equal(CAPS.totalUsd, 25);

    // 4. Scoring over both lineages.
    const s = scoreRuns(dirs.outRoot);
    assert.deepEqual(Object.keys(s.arms).sort(), ['derive-ledger', 'none-agent']);
    assert.equal(s.claimRowsInvalid.length, 0);
    assert.ok(s.claimRows.length >= 2 && s.claimRows.every(r => validateClaimRow(r).length === 0));
    const ag = s.lineages.find(l => l.arm === 'none-agent'), dl = s.lineages.find(l => l.arm === 'derive-ledger');
    assert.equal(ag.evidenceSet, 'shared');
    assert.equal(dl.outcome.shared.completed, 14);
    assert.equal(dl.ask.replayOk, true);
    assert.ok(s.readings.length >= 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
