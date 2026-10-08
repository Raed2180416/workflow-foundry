import test from 'node:test';
import assert from 'node:assert/strict';
import { openCtx, replayRun, fidelity, findTrial, trialsOf, pinNode, injectRow, uninject, acceptedCalls, pmap, costs, p1Workflow, readsOf } from '../replay.mjs';
import { assertNotSealed, sealedRefusal } from '../kit.mjs';
import { world, skipReason, byKey } from './helpers.mjs';

test('the trial index finds recorded runs by run id, by trial key and by task key', { skip: skipReason }, async () => {
  const { trials } = await world();
  const t = findTrial('F-haiku/records:test:d3:s6001/0', trials);
  assert.equal(t.runId, '2fb12d69-12dd-4413-9b6a-36167a36bbe2');
  assert.equal(findTrial(t.runId, trials).key, t.key);
  assert.equal(findTrial('F-haiku|records:test:d3:s6001|0', trials).key, t.key);
  assert.equal(findTrial('records:test:d3:s6001#0', trials.filter(x => x.armId === 'F-haiku')).key, t.key);
  assert.throws(() => findTrial('records:test:d3:s6001#0', trials), /HEAL_TRIAL_AMBIGUOUS/, 'several arms ran this task');
  assert.throws(() => findTrial('nope', trials), /HEAL_TRIAL_UNKNOWN/);
  assert.equal(trials.filter(x => x.armId === 'F-haiku').length, 22);       // 16 test trials + 6 construction probes
  assert.equal(trials.filter(x => x.armId === 'fhand-haiku').length, 36);
});

test('sealed families and splits are refused at intake', () => {
  assert.equal(sealedRefusal({ family: 'sealed-2' }), true);
  assert.equal(sealedRefusal({ family: 'records', split: 'sealed' }), true);
  assert.equal(sealedRefusal({ family: 'records', split: 'test' }), false);
  assert.throws(() => assertNotSealed({ family: 'sealed-1', split: 'test' }), /HEAL_SEALED_REFUSED/);
});

test('strict replay reproduces all 22 recorded C0 F-haiku trials exactly: task hash, oracle score, verdict, call count, cost', { skip: skipReason }, async () => {
  const { kit, trials, wf } = await world();
  const fh = trials.filter(t => t.armId === 'F-haiku');
  const rows = await pmap(fh, 3, async t => {
    const ctx = await openCtx(t.source, { kit, name: 'fid' });
    try { const r = await replayRun(ctx, wf[t.family], t); return { t, r, f: fidelity(t, r) }; } finally { ctx.close(); }
  });
  for (const { t, r, f } of rows) {
    assert.equal(f.identical, true, `${t.key}: ${JSON.stringify(f.checks)}`);
    assert.equal(r.liveCalls, 0, 'strict replay makes no live call');
    assert.ok(Math.abs(r.fullUsd - t.costUsd) < 1e-9, `${t.key}: recorded cost is recovered from the replayed rows`);
    assert.equal(r.liveUsd, 0);
  }
  assert.equal(rows.filter(x => !x.t.pass).length, 5, 'the five failed trials');
});

test('the P1 fhand-haiku failure replays exactly (score 0.945946, verdict pass, 18 calls)', { skip: skipReason }, async () => {
  const { kit, trials, wf } = await world();
  const t = byKey(trials, 'fhand-haiku/records:test:d3:s5002/1');
  const ctx = await openCtx('p1', { kit, name: 'p1' });
  try {
    const r = await replayRun(ctx, wf.p1, t);
    assert.equal(fidelity(t, r).identical, true);
    assert.equal(r.calls, 18); assert.equal(r.pass, false); assert.ok(Math.abs(r.score - 0.945946) < 1e-6); assert.equal(r.verdict, 'pass');
  } finally { ctx.close(); }
});

test('pin identity control: a pin that keeps its reads reproduces the run; one that drops them misses (P-1, taint label)', { skip: skipReason }, async () => {
  const { kit, trials, wf } = await world();
  const t = byKey(trials, 'F-haiku/codefix:test:d3:s6004/0');
  const ctx = await openCtx(t.source, { kit, name: 'pin' });
  try {
    const base = await replayRun(ctx, wf.codefix, t), c1 = base.outputs.check1;
    assert.deepEqual(Object.keys(readsOf(wf.codefix.nodes.find(n => n.id === 'check1'))).sort(), ['candidate', 'module_path', 'source', 'tests']);
    const kept = await replayRun(ctx, pinNode(wf.codefix, 'check1', c1), t);
    assert.equal(fidelity(t, kept).identical, true, 'identity pin with its reads reproduces the run');
    const dropped = await replayRun(ctx, pinNode(wf.codefix, 'check1', c1, { keepReads: false }), t);
    assert.equal(dropped.error?.code, 'REPLAY_MISS', 'dropping the reads changes the taint label, the downstream prompt and the replay key');
    const flipped = await replayRun(ctx, pinNode(wf.codefix, 'check1', { ...c1, ok: true }), t);
    assert.equal(flipped.pass, true, 'check1.ok false->true turns the failure into a pass');
    assert.equal(flipped.calls, 1, 'and the Opus repair is skipped');
  } finally { ctx.close(); }
});

test('journal injection changes one recorded value, replays everything else, and leaves no trace after uninject', { skip: skipReason }, async () => {
  const { kit, trials, wf } = await world();
  const t = byKey(trials, 'F-haiku/records:test:d3:s6001/0');
  const ctx = await openCtx(t.source, { kit, name: 'inj' });
  try {
    const row = acceptedCalls(ctx.journal, t.runId).find(r => r.nodeKey === 'root/conf');
    const before = ctx.db.prepare('SELECT COUNT(*) n FROM model_calls').get().n;
    const identity = injectRow(ctx.db, row.id, row.response.value);
    const same = await replayRun(ctx, wf.records, t);
    assert.equal(fidelity(t, same).identical, true, 'identity injection reproduces the run');
    uninject(ctx.db, row.id);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM model_calls WHERE json_extract(response, \'$.heal.counterfactualOf\') IS NOT NULL').get().n, 0);
    assert.ok(identity > before);
    const value = structuredClone(row.response.value); value.orders.find(o => o.system === 'BRIGHTDESK').numeric_order = 'DMY';
    injectRow(ctx.db, row.id, value);
    const fixed = await replayRun(ctx, wf.records, t);
    uninject(ctx.db, row.id);
    assert.equal(fixed.pass, true); assert.equal(fixed.score, 1);
    const again = await replayRun(ctx, wf.records, t);
    assert.equal(again.pass, false, 'the injected row is gone');
  } finally { ctx.close(); }
});

test('a call missing from the journal fails with REPLAY_MISS instead of reaching a provider, and costs nothing', { skip: skipReason }, async () => {
  const { kit, trials, wf } = await world();
  const t = byKey(trials, 'F-haiku/records:test:d3:s6001/0');
  const ctx = await openCtx(t.source, { kit, name: 'miss' });
  try {
    const edited = structuredClone(wf.records); edited.nodes.find(n => n.id === 'conf').instructions += '\nAn extra sentence changes the prompt hash.';
    const r = await replayRun(ctx, edited, t);
    assert.equal(r.error?.code, 'REPLAY_MISS'); assert.equal(r.liveCalls, 0); assert.equal(r.liveUsd, 0);
    assert.equal(costs(ctx.journal, r.runId).liveCalls, 0);
  } finally { ctx.close(); }
});

test('replay-or-live: unchanged nodes replay, a changed node goes to the provider table once and is journaled; costUnknown is bounded', { skip: skipReason }, async () => {
  const { kit, trials, wf } = await world();
  const t = byKey(trials, 'F-haiku/records:test:d3:s6001/0');
  const peek = await openCtx(t.source, { kit, name: 'r' });
  const recorded = acceptedCalls(peek.journal, t.runId).find(r => r.nodeKey === 'root/conf').response.value;
  peek.close();
  const fixed = structuredClone(recorded); fixed.orders.find(o => o.system === 'BRIGHTDESK').numeric_order = 'DMY';
  const provider = new kit.ScriptedProvider(() => ({ value: fixed, costUsd: 0.0123, usage: { inputTokens: 10, outputTokens: 5 } }));
  const ctx = await openCtx(t.source, { kit, name: 'rol', providers: { 'claude-cli': provider } });
  try {
    const edited = structuredClone(wf.records); edited.nodes.find(n => n.id === 'conf').model = { class: 'L', maxClass: 'L' };
    const r = await replayRun(ctx, edited, t, { mode: 'replay-or-live' });
    assert.equal(r.liveCalls, 1); assert.ok(Math.abs(r.liveUsd - 0.0123) < 1e-9);
    assert.equal(provider.calls.length, 1); assert.equal(provider.calls[0].modelId, 'claude-sonnet-5-5', 'class L resolves to Sonnet from the owner policy');
    assert.equal(r.pass, true);
    assert.ok(r.fullUsd > r.liveUsd, 'the replayed calls are charged at their recorded cost in fullUsd');
  } finally { ctx.close(); }
});
