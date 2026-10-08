// Audit integrity (07 finding 5, R-21): the run event hash chain binds model responses (journal rows), decision records,
// verdict inputs and executor transcripts, and `verify-run` detects an edit to any of them; chain heads can be anchored outside the
// database. Scripted provider only: no network, no model spend. Development/diagnostic evidence, not sealed evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, appendFileSync, symlinkSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { Foundry } from '../src/foundry.mjs';
import { serveHttp } from '../src/http.mjs';
import { CapabilityRegistry, createDefaultRegistry } from '../src/capabilities.mjs';
import { canonical, digest } from '../src/data.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';
import { AUDIT, appendAnchor, bindRow, merkleRoot, readAnchors, sha256 } from '../src/audit.mjs';
import { verifyRun } from '../src/verify-run.mjs';

const cli = new URL('../bin/foundry.mjs', import.meta.url).pathname;
const loaded = loadPolicy();
const S = 'qwen3.5-2b-q4km', M = loaded.policy.models.find(m => m.class === 'M').id;
const amount = { type: 'object', additionalProperties: false, required: ['amount'], properties: { amount: { type: 'number' } } };
const agent = (id, extra = {}) => ({ id, kind: 'agent', needs: [], description: 'Extract the amount', role: 'extract', instructions: 'Return the amount in USD as a number.',
  context: { inputs: [{ name: 'raw', ref: 'input.raw', render: 'text' }] }, returns: amount, model: { class: 'S', maxClass: 'M' },
  checks: [{ op: 'gte', left: { $ref: 'output.amount' }, right: 0 }], ...extra });
const wrap = (id, nodes, acceptance) => ({ schemaVersion: '1.0', id, version: 1, title: 'Audit probe', goal: 'Extract and double one synthetic amount', domain: 'general',
  envelope: { assumptions: ['Synthetic record'], risks: ['Model error'], successCriteria: ['Typed amounts'] }, budget: { maxSteps: 50, maxConcurrency: 1, maxDurationMs: 60000 }, nodes, acceptance });
// Two agent nodes; the first escalates once (schema failure on S, success on M), so a run holds journal rows, an escalation decision and a verdict.
const workflow = wrap('AuditProbe', [agent('norm'), agent('twice', { needs: ['norm'], instructions: 'Return twice the amount.',
  context: { inputs: [{ name: 'prior', ref: 'nodes.norm.amount', render: 'json' }], recite: { goal: true } } })],
[{ op: 'gt', left: { $ref: 'nodes.twice.amount' }, right: { $ref: 'nodes.norm.amount' } }]);
const script = () => ({ [S]: [{ text: 'five' }, { text: 'still five' }, { value: { amount: 10 }, costUsd: 0 }], [M]: [{ value: { amount: 5 }, costUsd: 0.01 }] });
const silent = () => { throw new Error('the provider must not be called'); };

function space(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-chain-'));
  const store = new Store(root);
  t.after(() => { try { store.close(); } catch {} rmSync(root, { recursive: true, force: true }); });
  store.saveWorkflow(workflow);
  return { root, store };
}
function runtimeOn(store, scriptOrFn, policy = { maxCost: 1, maxDurationMs: 60000 }) {
  const provider = new ScriptedProvider(scriptOrFn);
  const models = new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(store) });
  return { provider, runtime: new Runtime(store, createDefaultRegistry(), policy, { models, modelPolicy: loaded }) };
}
async function finished(t, options = {}) {
  const { root, store } = space(t), live = runtimeOn(store, script());
  const run = await live.runtime.execute(live.runtime.create(workflow, { raw: 'five dollars' }, { sampleSalt: 'chain:1', ...options }).id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  return { root, store, run, live, journal: new Journal(store) };
}
const events = (store, runId, type) => store.events(runId).filter(e => e.type === type);
const codes = report => report.findings.map(f => f.code);
const sql = (store, text, ...params) => store.db.prepare(text).run(...params);

// Rewrite the chain from `seq` on, consistently (new previousHash/hash links and checkpoint head): what an editor with write access to the
// database can do. Only a head recorded outside the database exposes it.
function rechain(store, runId, seq, mutate) {
  let previousHash = null, head = null;
  for (const row of store.db.prepare('SELECT seq, body FROM events WHERE run_id=? ORDER BY seq').all(runId)) {
    const event = JSON.parse(row.body);
    if (row.seq === seq) mutate(event);
    event.previousHash = previousHash;
    const hash = digest(event);
    sql(store, 'UPDATE events SET body=?, hash=? WHERE run_id=? AND seq=?', canonical(event), hash, runId, row.seq);
    previousHash = hash; head = { seq: row.seq, hash };
  }
  const run = store.run(runId); run.eventHead = head;
  sql(store, 'UPDATE runs SET body=? WHERE id=?', canonical(run), runId);
}
function truncate(store, runId, keep) {
  sql(store, 'DELETE FROM events WHERE run_id=? AND seq>?', runId, keep);
  const last = store.db.prepare('SELECT seq, hash FROM events WHERE run_id=? ORDER BY seq DESC LIMIT 1').get(runId);
  const run = store.run(runId); run.eventHead = { seq: last.seq, hash: last.hash };
  sql(store, 'UPDATE runs SET body=? WHERE id=?', canonical(run), runId);
}

test('hash chain: a model run binds its journal rows, decisions and verdict inputs, and verifies clean', async t => {
  const { store, run, journal } = await finished(t);
  const log = store.events(run.id);
  assert.equal(log[0].audit, AUDIT, 'the birth event declares the binding, inside the chain');
  assert.deepEqual(log.slice(-2).map(e => e.type), ['run.verdict', 'run.succeeded'], 'the verdict still precedes the terminal event');

  // Every model call event commits to the row it charged: request and response as stored text, and the whole row.
  const called = events(store, run.id, 'model.called');
  assert.equal(called.length, 4);
  for (const event of called) {
    const raw = store.db.prepare('SELECT * FROM model_calls WHERE id=?').get(event.journalId), bound = bindRow(raw);
    assert.equal(event.requestHash, sha256(raw.request));
    assert.equal(event.responseHash, sha256(raw.response));
    assert.equal(event.journalRowHash, bound.journalRowHash);
    assert.deepEqual({ ...journal.binding(event.journalId) }, { ...bound, runId: run.id });
  }
  // Decisions enter the chain in the commit that stores them, ahead of the event they accompany.
  const rows = store.decisionRows(run.id), recorded = events(store, run.id, 'decision.recorded');
  assert.deepEqual(recorded.map(e => e.kind), ['escalation', 'verdict']);
  assert.deepEqual(recorded.map(e => [e.id, e.decisionHash]), rows.map(row => [row.id, sha256(row.body)]));
  const types = log.map(e => e.type);
  assert.ok(types.indexOf('decision.recorded') < types.indexOf('model.escalated'), 'an escalation decision precedes its model.escalated event');
  assert.equal(types[types.lastIndexOf('decision.recorded') + 1], 'run.verdict', 'the verdict decision precedes the verdict event');
  // The seal: a Merkle root over the run's row digests and a hash of the state the verdict was computed from.
  const [seal] = events(store, run.id, 'run.verdict'), all = journal.forRun(run.id);
  const hashes = store.db.prepare('SELECT * FROM model_calls WHERE run_id=? ORDER BY id').all(run.id).map(raw => bindRow(raw).journalRowHash);
  assert.equal(seal.journalRoot, merkleRoot(hashes));
  assert.deepEqual([seal.journalCalls, seal.journalMaxId, seal.boardRoot], [4, all.at(-1).id, null]);
  assert.match(seal.verdictInputsHash, /^[0-9a-f]{64}$/);
  assert.equal(seal.verdict, run.verdict.verdict, 'the verdict fields are unchanged');
  assert.equal(Object.hasOwn(run.verdict, 'journalRoot'), false, 'the seal fields live in the event, not in the verdict record');

  const report = verifyRun(store, run.id);
  assert.deepEqual([report.ok, report.clean, report.bound, report.audit], [true, true, true, AUDIT], JSON.stringify(report.findings));
  assert.deepEqual(report.head, { seq: log.length, hash: log.at(-1).hash });
  assert.deepEqual(report.head, run.eventHead);
  assert.deepEqual(report.checks.journal, { boundCalls: 4, referencedRows: 4, unreferencedLate: 0 });
  assert.deepEqual(report.checks.decisions, { bound: 2, rows: 2 });
  assert.equal(report.anchor.headHash, log.at(-1).hash);
  assert.deepEqual([report.anchor.journalRoot, report.anchor.journalCalls, report.anchor.journalMaxId, report.anchor.schema], [seal.journalRoot, 4, seal.journalMaxId, 'foundry-anchor/1']);
  assert.throws(() => verifyRun(store, 'no-such-run'), { code: 'NOT_FOUND' });
});

const tamper = [
  ['journal response, one byte', (s, { journal }) => sql(s, "UPDATE model_calls SET response=replace(response,'\"amount\":5','\"amount\":6') WHERE ok=1 AND id=(SELECT MIN(id) FROM model_calls WHERE ok=1)"), ['JOURNAL_ROW_EDITED', 'JOURNAL_ROOT_MISMATCH']],
  ['journal response, whitespace only (same JSON value)', (s) => sql(s, "UPDATE model_calls SET response=' '||response WHERE id=(SELECT MIN(id) FROM model_calls)"), ['JOURNAL_ROW_EDITED']],
  ['journal request (prompt)', (s) => sql(s, "UPDATE model_calls SET request=replace(request,'five dollars','nine dollars') WHERE id=(SELECT MIN(id) FROM model_calls)"), ['JOURNAL_ROW_EDITED']],
  ['journal cost column', (s) => sql(s, 'UPDATE model_calls SET cost_usd=99 WHERE id=(SELECT MAX(id) FROM model_calls)'), ['JOURNAL_ROW_EDITED']],
  ['journal outcome flag (ok)', (s) => sql(s, 'UPDATE model_calls SET ok=1-ok, error_code=NULL WHERE id=(SELECT MIN(id) FROM model_calls)'), ['JOURNAL_ROW_EDITED']],
  ['journal row deleted', (s) => sql(s, 'DELETE FROM model_calls WHERE id=(SELECT MIN(id) FROM model_calls)'), ['JOURNAL_ROW_MISSING', 'JOURNAL_ROOT_MISMATCH']],
  ['journal row moved to another run', (s) => sql(s, "UPDATE model_calls SET run_id='other' WHERE id=(SELECT MIN(id) FROM model_calls)"), ['JOURNAL_ROW_FOREIGN', 'JOURNAL_ROOT_MISMATCH']],
  ['decision body edited', (s) => sql(s, "UPDATE decisions SET body=replace(body,'\"propensity\":1','\"propensity\":0.5') WHERE kind='escalation'"), ['DECISION_EDITED']],
  ['decision deleted', (s) => sql(s, "DELETE FROM decisions WHERE kind='verdict'"), ['DECISION_MISSING']],
  ['decision added', (s, { run }) => sql(s, "INSERT INTO decisions VALUES('forged','" + run.id + "','verdict','{\"id\":\"forged\",\"kind\":\"verdict\"}')"), ['DECISION_UNBOUND']],
  ['stored verdict edited', (s, { run }) => { const r = s.run(run.id); r.verdict.verdict = 'pass'; r.verdict.reason = 'edited'; sql(s, 'UPDATE runs SET body=? WHERE id=?', canonical(r), run.id); }, ['VERDICT_EDITED']],
  ['stored verdict removed', (s, { run }) => { const r = s.run(run.id); delete r.verdict; sql(s, 'UPDATE runs SET body=? WHERE id=?', canonical(r), run.id); }, ['VERDICT_EDITED']],
  ['run output edited', (s, { run }) => { const r = s.run(run.id); r.outputs.twice.amount = 1e6; sql(s, 'UPDATE runs SET body=? WHERE id=?', canonical(r), run.id); }, ['STATE_OUTPUT_EDITED', 'VERDICT_INPUTS_MISMATCH']],
  ['run output injected', (s, { run }) => { const r = s.run(run.id); r.outputs.ghost = { amount: 1 }; sql(s, 'UPDATE runs SET body=? WHERE id=?', canonical(r), run.id); }, ['STATE_OUTPUT_UNBOUND', 'VERDICT_INPUTS_MISMATCH']],
  ['run status/error edited', (s, { run }) => { const r = s.run(run.id); r.error = { code: 'FORGED', message: 'x' }; sql(s, 'UPDATE runs SET body=? WHERE id=?', canonical(r), run.id); }, ['VERDICT_INPUTS_MISMATCH']],
  ['event body edited', (s, { run }) => sql(s, "UPDATE events SET body=replace(body,'\"type\":\"model.called\"','\"type\":\"model.callad\"') WHERE run_id=? AND seq=(SELECT MIN(seq) FROM events WHERE run_id=? AND body LIKE '%model.called%')", run.id, run.id), ['CHAIN_BROKEN']],
  ['event removed (tail)', (s, { run }) => sql(s, 'DELETE FROM events WHERE run_id=? AND seq=(SELECT MAX(seq) FROM events WHERE run_id=?)', run.id, run.id), ['CHAIN_BROKEN']],
  // Review fixes (adversarial pass): each of these verified clean before.
  ['decision kind column (body untouched)', (s) => sql(s, "UPDATE decisions SET kind='note' WHERE kind='escalation'"), ['DECISION_EDITED']],
  ['run input', (s, { run }) => { const r = s.run(run.id); r.input = { raw: 'nine dollars' }; sql(s, 'UPDATE runs SET body=? WHERE id=?', canonical(r), run.id); }, ['RUN_IDENTITY_EDITED']],
  ['run policy', (s, { run }) => { const r = s.run(run.id); r.policy.maxCost = 1000; sql(s, 'UPDATE runs SET body=? WHERE id=?', canonical(r), run.id); }, ['RUN_IDENTITY_EDITED']],
  ['run model binding (sample salt)', (s, { run }) => { const r = s.run(run.id); r.sampleSalt = 'other'; sql(s, 'UPDATE runs SET body=? WHERE id=?', canonical(r), run.id); }, ['RUN_IDENTITY_EDITED']],
  ['workflow body the run executed', (s, { run }) => sql(s, "UPDATE workflows SET body=replace(body,'Return twice the amount.','Return thrice the amount.') WHERE hash=?", run.workflowHash), ['WORKFLOW_EDITED']],
  ['closed run status set back to a non-terminal one', (s, { run }) => { const r = s.run(run.id); r.status = 'waiting'; sql(s, 'UPDATE runs SET body=? WHERE id=?', canonical(r), run.id); }, ['VERDICT_INPUTS_MISMATCH']],
  ['chain tail with its seal removed, checkpoint head moved back to match', (s, { run }) => truncate(s, run.id, s.events(run.id).length - 3), ['SEAL_MISSING']],
];
for (const [name, edit, expected] of tamper) {
  test(`hash chain: editing ${name} is detected`, async t => {
    const ctx = await finished(t);
    assert.equal(verifyRun(ctx.store, ctx.run.id).ok, true);
    edit(ctx.store, ctx);
    const report = verifyRun(ctx.store, ctx.run.id);
    assert.equal(report.ok, false, `undetected: ${JSON.stringify(report.findings)}`);
    for (const code of expected) assert.ok(codes(report).includes(code), `${code} expected in ${JSON.stringify(codes(report))}`);
    assert.ok(report.findings.filter(f => f.severity === 'error').length >= 1);
  });
}

test('hash chain: a journal row written after the seal is flagged, and one that replay could serve says so', async t => {
  const ctx = await finished(t);
  const [first] = ctx.journal.forRun(ctx.run.id);
  ctx.journal.record({ replayKey: first.replayKey, runId: ctx.run.id, nodeKey: first.nodeKey, attempt: first.attempt, sampleIndex: 0, modelId: first.modelId, provider: first.provider,
    request: { system: 'planted' }, response: { value: { amount: 999 } }, ok: true, costUsd: 0 });
  ctx.journal.record({ replayKey: 'cancelled', runId: ctx.run.id, nodeKey: 'root/norm', attempt: 1, sampleIndex: 0, modelId: first.modelId, ok: false, errorCode: 'CANCELLED' });
  const report = verifyRun(ctx.store, ctx.run.id), late = report.findings.filter(f => f.code === 'JOURNAL_ROW_LATE');
  assert.deepEqual(late.map(f => f.replayable), [true, false]);
  assert.deepEqual([report.ok, report.clean], [true, false], 'a late row is a warning: it is not part of what the chain committed to');
  assert.equal(report.checks.journal.unreferencedLate, 2);
});

test('hash chain: executor transcripts are bound by hash and re-checked', async t => {
  const ctx = await finished(t), file = path.join(ctx.root, 'session.jsonl');
  writeFileSync(file, '{"type":"assistant","text":"hello"}\n{"type":"result","text":"done"}\n');
  const bound = ctx.store.bindTranscript(ctx.run.id, { nodeKey: 'root/norm', file, label: 'executor:test' });
  assert.deepEqual([bound.transcriptHash, bound.bytes, bound.location.kind], [sha256(readFileSync(file)), readFileSync(file).length, 'workspace']);
  const [event] = events(ctx.store, ctx.run.id, 'executor.finished');
  assert.deepEqual([event.transcriptHash, event.nodeKey, event.label, event.seq], [bound.transcriptHash, 'root/norm', 'executor:test', bound.seq]);
  assert.equal(verifyRun(ctx.store, ctx.run.id).clean, true);
  assert.equal(verifyRun(ctx.store, ctx.run.id).checks.transcripts.bound, 1);
  const copy = path.join(ctx.store.directory, event.location.path);
  assert.equal(readFileSync(copy, 'utf8'), readFileSync(file, 'utf8'));

  appendFileSync(copy, ' ');
  assert.ok(codes(verifyRun(ctx.store, ctx.run.id)).includes('TRANSCRIPT_EDITED'), 'one appended byte');
  rmSync(copy);
  assert.ok(codes(verifyRun(ctx.store, ctx.run.id)).includes('TRANSCRIPT_MISSING'), 'a held copy that vanished is an error');

  // An external transcript (copy:false) is bound by hash; if it is not where it was, it is unchecked, not wrong.
  const external = ctx.store.bindTranscript(ctx.run.id, { nodeKey: 'root/twice', file, copy: false });
  assert.deepEqual(external.location, { kind: 'external', path: file });
  rmSync(file);
  const report = verifyRun(ctx.store, ctx.run.id);
  assert.ok(report.findings.some(f => f.code === 'TRANSCRIPT_UNCHECKED' && f.severity === 'warn'));
  assert.throws(() => ctx.store.bindTranscript(ctx.run.id, { nodeKey: 'root/norm', file: ctx.root }), { code: 'TRANSCRIPT' });
  mkdirSync(path.join(ctx.root, 'x')); symlinkSync(copy, path.join(ctx.root, 'x', 'link'));
  assert.throws(() => ctx.store.bindTranscript(ctx.run.id, { nodeKey: 'root/norm', file: path.join(ctx.root, 'x', 'link') }), { code: 'TRANSCRIPT' });
  assert.throws(() => ctx.store.bindTranscript(ctx.run.id, { nodeKey: '', file }), { code: 'TRANSCRIPT' });
  // The workspace copy cannot be redirected outside the state directory through a symlinked run directory.
  const outside = mkdtempSync(path.join(tmpdir(), 'foundry-chain-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  rmSync(path.join(ctx.store.directory, 'artifacts', ctx.run.id), { recursive: true, force: true });
  symlinkSync(outside, path.join(ctx.store.directory, 'artifacts', ctx.run.id));
  writeFileSync(file, 'transcript\n');
  assert.throws(() => ctx.store.bindTranscript(ctx.run.id, { nodeKey: 'root/norm', file }), { code: 'TRANSCRIPT', message: /outside the workspace state directory/ });
});

test('hash chain: a decision recorded on its own enters the chain; one for no run is stored unbound as before', async t => {
  const { store, run } = await finished(t);
  const before = store.events(run.id).length;
  const decision = { schema: 'foundry-decision/1', id: `${run.id}:note:1`, kind: 'note', at: 1 };
  assert.equal(store.recordDecision(run.id, decision), true);
  assert.equal(store.recordDecision(run.id, decision), false, 'first write wins');
  const after = store.events(run.id);
  assert.equal(after.length, before + 1);
  assert.deepEqual([after.at(-1).type, after.at(-1).id, after.at(-1).decisionHash], ['decision.recorded', decision.id, sha256(canonical(decision))]);
  assert.equal(verifyRun(store, run.id).ok, true);
  assert.equal(store.recordDecision('no-such-run', { id: 'x', kind: 'note' }), true);
  assert.equal(store.decisions('no-such-run').length, 1);
  // A row planted under this run's next decision id, but for another run, would swallow the decision unseen: it is refused.
  sql(store, "INSERT INTO decisions VALUES(?, 'elsewhere', 'note', '{}')", `${run.id}:note:2`);
  assert.throws(() => store.recordDecision(run.id, { ...decision, id: `${run.id}:note:2` }), { code: 'DECISION_CONFLICT' });
  assert.equal(store.events(run.id).length, before + 1, 'nothing was appended');
});

test('hash chain: anchors outside the database expose a consistent rewrite and a truncation that the chain alone accepts', async t => {
  const { root, store, run } = await finished(t), file = path.join(root, '..', `anchors-${path.basename(root)}.jsonl`);
  t.after(() => rmSync(file, { force: true }));
  const clean = verifyRun(store, run.id);
  const first = appendAnchor(file, clean.anchor);
  assert.equal(first.appended, true);
  assert.equal(appendAnchor(file, clean.anchor).appended, false, 'the same head is not written twice');
  assert.equal(readAnchors(file).length, 1);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const anchors = readAnchors(file);
  assert.equal(verifyRun(store, run.id, { anchors }).ok, true);
  assert.equal(verifyRun(store, run.id, { expectHead: { seq: clean.head.seq, hash: clean.head.hash } }).ok, true);

  // 1. A rewrite that re-links every hash after an unbound field (a charge in model.called) passes the chain check; the anchor does not.
  const firstCall = store.events(run.id).find(e => e.type === 'model.called').seq;
  rechain(store, run.id, firstCall, e => { e.costUsd = 123; });
  assert.deepEqual([verifyRun(store, run.id).ok, store.events(run.id).length], [true, clean.head.seq], 'self-consistent: the chain alone cannot tell');
  const exposed = verifyRun(store, run.id, { anchors });
  assert.ok(codes(exposed).includes('ANCHOR_MISMATCH'), JSON.stringify(exposed.findings));
  assert.equal(verifyRun(store, run.id, { expectHead: { seq: clean.head.seq, hash: clean.head.hash } }).ok, false);

  // 2. Truncating the tail (and the checkpoint head with it) is exposed the same way.
  const fresh = await finished(t), anchor2 = verifyRun(fresh.store, fresh.run.id).anchor;
  truncate(fresh.store, fresh.run.id, fresh.store.events(fresh.run.id).length - 3);
  const truncated = verifyRun(fresh.store, fresh.run.id, { anchors: [anchor2] });
  assert.ok(codes(truncated).includes('ANCHOR_MISMATCH'));
  assert.match(truncated.findings.find(f => f.code === 'ANCHOR_MISMATCH').message, /truncated/);

  // 3. The anchor file is itself chained: an edited or removed line is rejected.
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  appendAnchor(file, { ...clean.anchor, headSeq: clean.anchor.headSeq + 1, headHash: 'a'.repeat(64) });
  appendAnchor(file, { ...clean.anchor, headSeq: clean.anchor.headSeq + 2, headHash: 'b'.repeat(64) });
  assert.equal(readAnchors(file).length, 3);
  writeFileSync(file, [lines[0], ...readFileSync(file, 'utf8').trim().split('\n').slice(2)].join('\n') + '\n');
  assert.throws(() => readAnchors(file), { code: 'ANCHOR_FILE' });
  writeFileSync(file, 'not json\n');
  assert.throws(() => readAnchors(file), { code: 'ANCHOR_FILE' });
});

test('hash chain: an anchor taken while a run is paused still holds after the run continues', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-chain-')), store = new Store(root);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const human = wrap('PausedProbe', [{ id: 'ask', kind: 'human', needs: [], description: 'Ask', question: 'Proceed?', answerSchema: { type: 'boolean' } }], [{ op: 'eq', left: { $ref: 'nodes.ask.answer' }, right: true }]);
  store.saveWorkflow(human);
  const runtime = new Runtime(store, createDefaultRegistry(), {});
  const paused = await runtime.execute(runtime.create(human, {}).id);
  assert.equal(paused.status, 'awaiting_human');
  const early = verifyRun(store, paused.id);
  assert.deepEqual([early.ok, early.clean, early.checks.seals], [true, true, 0]);
  runtime.answer(paused.id, 'root/ask', true);
  assert.equal((await runtime.execute(paused.id)).status, 'succeeded');
  const later = verifyRun(store, paused.id, { anchors: [early.anchor] });
  assert.deepEqual([later.ok, later.clean], [true, true], JSON.stringify(later.findings));
  assert.ok(later.head.seq > early.head.seq);
  assert.deepEqual(later.checks.state, { outputsCompared: 1 }, 'a human answer is checked against its answerHash');
  const run = store.run(paused.id); run.outputs.ask = { answer: false };
  sql(store, 'UPDATE runs SET body=? WHERE id=?', canonical(run), paused.id);
  assert.ok(codes(verifyRun(store, paused.id)).includes('STATE_OUTPUT_EDITED'));
});

test('hash chain: a run from before the binding verifies its chain only, and --require-bound refuses it', async t => {
  const ctx = await finished(t);
  rechain(ctx.store, ctx.run.id, 1, e => { delete e.audit; });
  sql(ctx.store, "UPDATE model_calls SET response=replace(response,'\"amount\":5','\"amount\":6') WHERE ok=1");
  const report = verifyRun(ctx.store, ctx.run.id);
  assert.deepEqual([report.ok, report.bound, report.audit], [true, false, null]);
  assert.deepEqual(codes(report), ['LEGACY_UNBOUND']);
  assert.match(report.findings[0].message, /only its event chain is verified/);
  const strict = verifyRun(ctx.store, ctx.run.id, { requireBound: true });
  assert.deepEqual([strict.ok, strict.findings[0].severity], [false, 'error']);
});

test('hash chain: the other ways a run ends seal and verify too: a rejected approval and a failed assertion', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-chain-')), store = new Store(root);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const registry = new CapabilityRegistry().register({ name: 'audit.operation', version: '1', implementation: 'hash-chain-fixture', description: 'Local mock operation',
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, effects: 'idempotent', risk: 'high', requiresApproval: true, maxTimeoutMs: 1000, cost: 0,
    cancellation: 'cooperative', execute: async () => ({ committed: true }) });
  const runtime = new Runtime(store, registry, { allowedCapabilities: ['audit.operation'] });
  const gated = wrap('RejectedChain', [{ id: 'effect', kind: 'task', needs: [], description: 'Operate', tool: 'audit.operation', args: { target: 'mock' }, timeoutMs: 1000, retry: { maxAttempts: 1 } }],
    [{ op: 'eq', left: { $ref: 'nodes.effect.committed' }, right: true }]);
  store.saveWorkflow(gated);
  const paused = await runtime.execute(runtime.create(gated, {}).id);
  assert.equal(paused.status, 'awaiting_approval');
  assert.equal(verifyRun(store, paused.id).clean, true);
  const rejected = runtime.approve(paused.id, Object.keys(paused.approvals)[0], false);
  assert.equal(rejected.status, 'cancelled');
  assert.deepEqual(store.events(paused.id).slice(-2).map(e => e.type), ['run.verdict', 'approval.decided']);
  const report = verifyRun(store, paused.id);
  assert.deepEqual([report.ok, report.clean, report.checks.seals], [true, true, 1], JSON.stringify(report.findings));
  const stored = store.run(paused.id); stored.verdict.verdict = 'pass';
  sql(store, 'UPDATE runs SET body=? WHERE id=?', canonical(stored), paused.id);
  assert.ok(codes(verifyRun(store, paused.id)).includes('VERDICT_EDITED'));

  const failing = wrap('FailedChain', [{ id: 'check', kind: 'assert', needs: [], description: 'Always fails', checks: [{ op: 'eq', left: 1, right: 2 }] }], [{ op: 'eq', left: { $ref: 'nodes.check.passed' }, right: true }]);
  store.saveWorkflow(failing);
  const failed = await runtime.execute(runtime.create(failing, {}).id);
  assert.deepEqual([failed.status, failed.error.code], ['failed', 'ASSERTION_FAILED']);
  const second = verifyRun(store, failed.id);
  assert.deepEqual([second.ok, second.clean, second.checks.seals], [true, true, 1], JSON.stringify(second.findings));
  assert.equal(second.anchor.status, 'failed');
});

test('hash chain: the chain reports where it first breaks, and events() still throws CORRUPT_EVENTS', async t => {
  const { store, run } = await finished(t);
  assert.deepEqual([store.chain(run.id).error, store.chain(run.id).events.length], [null, run.eventHead.seq]);
  sql(store, "UPDATE events SET body=replace(body,'\"type\":\"node.started\"','\"type\":\"node.startad\"') WHERE run_id=? AND seq=(SELECT MIN(seq) FROM events WHERE run_id=? AND body LIKE '%node.started%')", run.id, run.id);
  const { error, events: before } = store.chain(run.id);
  assert.deepEqual([error.seq, before.length], [before.length + 1, error.seq - 1]);
  assert.match(error.reason, /edited/);
  assert.throws(() => store.events(run.id), e => e.code === 'CORRUPT_EVENTS' && e.details.seq === error.seq && e.message === 'Event chain verification failed');
  const report = verifyRun(store, run.id);
  assert.deepEqual([report.ok, report.head, report.anchor, report.findings.map(f => f.code)], [false, null, null, ['CHAIN_BROKEN']]);
});

test('hash chain: a run whose ModelPort journals in another database says so, seals that journal, and is checked against it', async t => {
  const { root, store } = space(t), journalFile = path.join(root, 'elsewhere.sqlite'), journalDb = new DatabaseSync(journalFile);
  t.after(() => { try { journalDb.close(); } catch {} });
  const provider = new ScriptedProvider(script()), journal = new Journal(journalDb);
  const models = new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal });
  const runtime = new Runtime(store, createDefaultRegistry(), { maxCost: 1, maxDurationMs: 60000 }, { models, modelPolicy: loaded });
  const run = await runtime.execute(runtime.create(workflow, { raw: 'five dollars' }).id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(store.events(run.id)[0].journal, 'external');
  const [seal] = events(store, run.id, 'run.verdict');
  assert.deepEqual([seal.journalCalls, seal.journalMaxId > 0], [4, true], 'the seal covers the rows of the journal the ModelPort wrote to');
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='model_calls'").get().n, 0, 'nothing was journaled in the store');

  const alone = verifyRun(store, run.id);
  assert.deepEqual([alone.ok, alone.clean, codes(alone)], [true, false, ['JOURNAL_EXTERNAL']], 'without the journal it says what it could not check');
  assert.equal(alone.anchor.journalRoot, seal.journalRoot, 'the anchor still carries the sealed root');
  const full = verifyRun(store, run.id, { journalDb });
  assert.deepEqual([full.ok, full.clean, full.checks.journal.boundCalls], [true, true, 4], JSON.stringify(full.findings));
  journalDb.prepare("UPDATE model_calls SET response=replace(response,'\"amount\":5','\"amount\":6') WHERE ok=1 AND response LIKE '%\"amount\":5%'").run();
  assert.ok(codes(verifyRun(store, run.id, { journalDb })).includes('JOURNAL_ROW_EDITED'));
  assert.ok(codes(verifyRun(store, run.id, { journalDb })).includes('JOURNAL_ROOT_MISMATCH'));

  // On the command line the journal is named with --journal.
  journalDb.prepare("UPDATE model_calls SET response=replace(response,'\"amount\":6','\"amount\":5') WHERE ok=1 AND response LIKE '%\"amount\":6%'").run();
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); journalDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const env = { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' };
  const cliRun = (...args) => spawnSync(process.execPath, [cli, 'verify-run', run.id, '--workspace', root, ...args], { encoding: 'utf8', env });
  const withJournal = cliRun('--journal', journalFile);
  assert.equal(withJournal.status, 0, withJournal.stderr);
  assert.deepEqual([JSON.parse(withJournal.stdout).clean, JSON.parse(withJournal.stdout).checks.journal.boundCalls], [true, 4]);
  assert.equal(JSON.parse(cliRun().stdout).findings[0].code, 'JOURNAL_EXTERNAL');
  assert.equal(cliRun('--journal', path.join(root, 'nope.sqlite')).status, 1);
});

test('hash chain: an anchor is a function of the run alone, so the same evidence prints the same anchor from every command', async t => {
  const { store, run } = await finished(t);
  const first = verifyRun(store, run.id).anchor;
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(verifyRun(store, run.id).anchor, first);
  assert.equal(first.headAt, store.events(run.id).at(-1).at, 'it names the time of the head event, not of the anchoring');
  assert.equal(Object.hasOwn(first, 'at'), false);
  const file = path.join(store.workspace, 'anchors.jsonl');
  const { anchor } = appendAnchor(file, first);
  assert.equal(typeof anchor.at, 'number', 'a line in the anchor file records when it was taken');
  assert.equal(anchor.previous, null);
});

// ---- replay -------------------------------------------------------------------------------------------------------------------

test('replay: a replayed run serves the recorded responses, binds its own replay rows and verifies clean', async t => {
  const { store, run: live, journal } = await finished(t);
  const replaying = runtimeOn(store, silent);
  const second = await replaying.runtime.execute(replaying.runtime.create(workflow, { raw: 'five dollars' }, { modelMode: 'replay', sampleSalt: 'chain:1' }).id);
  assert.equal(second.status, 'succeeded', JSON.stringify(second.error));
  assert.equal(replaying.provider.calls.length, 0);
  assert.deepEqual(second.outputs, live.outputs);
  for (const id of [live.id, second.id]) { const report = verifyRun(store, id); assert.deepEqual([report.ok, report.clean], [true, true], JSON.stringify(report.findings)); }
  const replayed = events(store, second.id, 'model.called');
  assert.ok(replayed.every(e => e.replayed === true && e.journalRowHash && e.requestHash && e.responseHash));
  assert.ok(replayed.every(e => e.replaySource?.check === 'bound' && e.replaySource.runId === live.id && e.replaySource.journalId === e.replayedFrom), 'each replayed response records that its recording was checked against the chain that bound it');
  assert.notDeepEqual(replayed.map(e => e.journalId), events(store, live.id, 'model.called').map(e => e.journalId), 'a replay is journaled as rows of its own');
  assert.equal(journal.forRun(second.id).length, 4);
});

test('replay: a response edited in the recording run is detected there, and replay refuses to serve it', async t => {
  const { store, run: live } = await finished(t);
  sql(store, "UPDATE model_calls SET response=replace(response,'\"amount\":5','\"amount\":6') WHERE run_id=? AND ok=1 AND response LIKE '%\"amount\":5%'", live.id);
  assert.ok(codes(verifyRun(store, live.id)).includes('JOURNAL_ROW_EDITED'));
  const replaying = runtimeOn(store, silent);
  const second = await replaying.runtime.execute(replaying.runtime.create(workflow, { raw: 'five dollars' }, { modelMode: 'replay', sampleSalt: 'chain:1' }).id);
  assert.equal(replaying.provider.calls.length, 0);
  assert.equal(second.status, 'failed');
  assert.equal(second.error.code, 'JOURNAL_TAMPERED');
  assert.equal(second.verdict.verdict, 'harness_fault');
  assert.equal(second.outputs.norm, undefined, 'the edited response was not used');
});

test('replay: a recording that has no binding cannot be checked, so it is served as recorded', async t => {
  const { store, run: live } = await finished(t);
  rechain(store, live.id, 1, e => { delete e.audit; });
  sql(store, "UPDATE model_calls SET response=replace(response,'\"amount\":10','\"amount\":11') WHERE run_id=? AND ok=1 AND response LIKE '%\"amount\":10%'", live.id);
  const replaying = runtimeOn(store, silent);
  const second = await replaying.runtime.execute(replaying.runtime.create(workflow, { raw: 'five dollars' }, { modelMode: 'replay', sampleSalt: 'chain:1' }).id);
  assert.equal(second.status, 'succeeded', JSON.stringify(second.error));
  assert.deepEqual(second.outputs.twice, { amount: 11 }, 'the edited response of a legacy recording is served as recorded: nothing committed to it');
  assert.deepEqual([verifyRun(store, live.id).bound, verifyRun(store, second.id).ok], [false, true]);
  // ...and the replaying run says so: nothing vouched for the responses it served.
  assert.ok(events(store, second.id, 'model.called').every(e => e.replaySource?.check === 'unverified'));
  assert.ok(codes(verifyRun(store, second.id)).includes('REPLAY_UNVERIFIED'));
  assert.equal(verifyRun(store, second.id, { requireBound: true }).ok, false);
});

// A forged row needs no edit: insert a copy of a recorded row with another answer, newer than the original, so lookup serves it.
function forge(store, where, params, edit) {
  const raw = store.db.prepare(`SELECT * FROM model_calls WHERE ${where} ORDER BY id DESC LIMIT 1`).get(...params);
  const columns = Object.keys(raw).filter(c => c !== 'id'), forged = edit({ ...raw });
  sql(store, `INSERT INTO model_calls(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, ...columns.map(c => forged[c]));
}
test('replay: a forged row under a run this store does not hold is served as recorded, but the event and verify-run flag it', async t => {
  const { store, run: live } = await finished(t);
  forge(store, "run_id=? AND node_key='root/twice' AND ok=1", [live.id], row => ({ ...row, run_id: 'ghost', response: row.response.replace('"amount":10', '"amount":999') }));
  const replaying = runtimeOn(store, silent);
  const second = await replaying.runtime.execute(replaying.runtime.create(workflow, { raw: 'five dollars' }, { modelMode: 'replay', sampleSalt: 'chain:1' }).id);
  assert.equal(second.status, 'succeeded', JSON.stringify(second.error));
  assert.deepEqual(second.outputs.twice, { amount: 999 }, 'lookup served the forged row (replay serves what is journaled)');
  const twice = events(store, second.id, 'model.called').find(e => e.nodeKey === 'root/twice');
  assert.deepEqual([twice.replaySource.check, twice.replaySource.runId], ['unverified', 'ghost']);
  assert.match(twice.replaySource.reason, /not in this store/);
  const report = verifyRun(store, second.id);
  assert.deepEqual([report.ok, report.clean], [true, false]);
  assert.deepEqual(report.findings.filter(f => f.code === 'REPLAY_UNVERIFIED').map(f => f.seq), [twice.seq]);
  const strict = verifyRun(store, second.id, { requireBound: true });
  assert.deepEqual([strict.ok, strict.findings.find(f => f.code === 'REPLAY_UNVERIFIED').severity], [false, 'error'], 'a claim-bearing run cannot rest on an unverified recording');
  assert.equal(verifyRun(store, live.id).clean, true, 'the recording run itself is untouched');
});

test('replay: a forged row under a run that is still open (no seal, no event binds it) is flagged; one under a closed run is refused', async t => {
  const { store } = space(t);
  const paused = wrap('OpenSource', [agent('norm'), { id: 'ask', kind: 'human', needs: ['norm'], description: 'Ask', question: 'Proceed?', answerSchema: { type: 'boolean' } }],
    [{ op: 'eq', left: { $ref: 'nodes.ask.answer' }, right: true }]);
  store.saveWorkflow(paused);
  const live = runtimeOn(store, { [S]: [{ value: { amount: 10 } }] });
  const open = await live.runtime.execute(live.runtime.create(paused, { raw: 'five dollars' }, { sampleSalt: 'chain:2' }).id);
  assert.equal(open.status, 'awaiting_human');
  forge(store, 'run_id=? AND ok=1', [open.id], row => ({ ...row, response: row.response.replace('"amount":10', '"amount":999') }));
  const replaying = runtimeOn(store, silent);
  const second = await replaying.runtime.execute(replaying.runtime.create(paused, { raw: 'five dollars' }, { modelMode: 'replay', sampleSalt: 'chain:2' }).id);
  assert.deepEqual([second.status, second.outputs.norm], ['awaiting_human', { amount: 999 }]);
  const [called] = events(store, second.id, 'model.called');
  assert.deepEqual([called.replaySource.check, called.replaySource.runId], ['unverified', open.id]);
  assert.match(called.replaySource.reason, /still open/);
  assert.ok(codes(verifyRun(store, second.id)).includes('REPLAY_UNVERIFIED'));

  // Once the source run is sealed, a row of it that no event binds and that is newer than the seal is refused outright.
  live.runtime.answer(open.id, 'root/ask', true);
  assert.equal((await live.runtime.execute(open.id)).status, 'succeeded');
  forge(store, 'run_id=? AND ok=1', [open.id], row => ({ ...row, response: row.response.replace('"amount":10', '"amount":777') }));
  const third = await replaying.runtime.execute(replaying.runtime.create(paused, { raw: 'five dollars' }, { modelMode: 'replay', sampleSalt: 'chain:2' }).id);
  assert.deepEqual([third.status, third.error.code], ['failed', 'JOURNAL_TAMPERED']);
  assert.match(third.error.message, /written after run .* was sealed/);
});

test('replay: from a ModelPort journal in another database, a row its run only sealed is checked in that database', async t => {
  // Regression: the sealed root was recomputed in the store's database, which holds no journal here, so a genuine row was refused.
  const { root, store } = space(t), journalDb = new DatabaseSync(path.join(root, 'elsewhere.sqlite'));
  t.after(() => { try { journalDb.close(); } catch {} });
  const port = (scriptOrFn) => { const provider = new ScriptedProvider(scriptOrFn);
    return new Runtime(store, createDefaultRegistry(), { maxCost: 1, maxDurationMs: 60000 }, { models: new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(journalDb) }), modelPolicy: loaded }); };
  const recorder = port(script()), live = await recorder.execute(recorder.create(workflow, { raw: 'five dollars' }, { sampleSalt: 'chain:1' }).id);
  assert.equal(live.status, 'succeeded', JSON.stringify(live.error));
  // Leave the rows named by no event (only the sealed journal root covers them), consistently re-chained.
  for (const event of store.events(live.id).filter(e => e.type === 'model.called'))
    rechain(store, live.id, event.seq, e => { delete e.journalId; delete e.journalRowHash; delete e.requestHash; delete e.responseHash; });
  const replayer = port(silent), second = await replayer.execute(replayer.create(workflow, { raw: 'five dollars' }, { modelMode: 'replay', sampleSalt: 'chain:1' }).id);
  assert.equal(second.status, 'succeeded', JSON.stringify(second.error));
  assert.ok(events(store, second.id, 'model.called').every(e => e.replaySource?.check === 'sealed'));
  assert.equal(verifyRun(store, second.id, { journalDb }).clean, true);
  // And an edit under the seal is still refused there.
  journalDb.prepare("UPDATE model_calls SET response=replace(response,'\"amount\":10','\"amount\":11') WHERE run_id=? AND ok=1 AND response LIKE '%\"amount\":10%'").run(live.id);
  const third = await replayer.execute(replayer.create(workflow, { raw: 'five dollars' }, { modelMode: 'replay', sampleSalt: 'chain:1' }).id);
  assert.deepEqual([third.status, third.error.code], ['failed', 'JOURNAL_TAMPERED']);
});

// ---- closed runs ------------------------------------------------------------------------------------------------------------------

const rewrite = (store, runId, edit) => { const r = store.run(runId); edit(r); sql(store, 'UPDATE runs SET body=? WHERE id=?', canonical(r), runId); };
test('closed runs: a final verdict closes the run; editing its record to reopen it is refused by resume, answer and approve, and verify-run names it', async t => {
  // Resume: a passed run whose record is edited back to ready, with a node to run again.
  const { store, run } = await finished(t);
  rewrite(store, run.id, r => { r.status = 'ready'; r.nodes.twice.status = 'pending'; delete r.outputs.twice; });
  const again = runtimeOn(store, silent);
  await assert.rejects(again.runtime.execute(run.id), e => e.code === 'RUN_CLOSED' && /final verdict \(pass\)/.test(e.message));
  assert.equal(store.events(run.id).at(-1).type, 'run.succeeded', 'nothing was appended');
  assert.ok(codes(verifyRun(store, run.id)).includes('VERDICT_INPUTS_MISMATCH'), 'the edit is detected without a resume');
  // A store-level writer that appends a resume anyway (an older engine, or a hand edit) leaves a chain verify-run rejects.
  store.updateRun(run.id, () => {}, { type: 'runner.acquired', token: 'forged' });
  assert.ok(codes(verifyRun(store, run.id)).includes('RUN_REOPENED'));

  // Answer: a finished human run edited back to awaiting the answer.
  const human = wrap('ClosedHuman', [{ id: 'ask', kind: 'human', needs: [], description: 'Ask', question: 'Proceed?', answerSchema: { type: 'boolean' } }], [{ op: 'eq', left: { $ref: 'nodes.ask.answer' }, right: true }]);
  store.saveWorkflow(human);
  const runtime = new Runtime(store, createDefaultRegistry(), {});
  const asked = await runtime.execute(runtime.create(human, {}).id);
  runtime.answer(asked.id, 'root/ask', true);
  assert.equal((await runtime.execute(asked.id)).status, 'succeeded');
  rewrite(store, asked.id, r => { r.status = 'awaiting_human'; r.nodes.ask.status = 'awaiting_human'; r.nodes.ask.answerSchema = { type: 'boolean' }; delete r.outputs.ask; });
  assert.throws(() => runtime.answer(asked.id, 'root/ask', false), { code: 'RUN_CLOSED' });

  // Approve: a rejected (cancelled) approval edited back to pending.
  const registry = new CapabilityRegistry().register({ name: 'audit.operation', version: '1', implementation: 'hash-chain-fixture', description: 'Local mock operation',
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, effects: 'idempotent', risk: 'high', requiresApproval: true, maxTimeoutMs: 1000, cost: 0,
    cancellation: 'cooperative', execute: async () => ({ committed: true }) });
  const gatedRuntime = new Runtime(store, registry, { allowedCapabilities: ['audit.operation'] });
  const gated = wrap('ClosedApproval', [{ id: 'effect', kind: 'task', needs: [], description: 'Operate', tool: 'audit.operation', args: { target: 'mock' }, timeoutMs: 1000, retry: { maxAttempts: 1 } }],
    [{ op: 'eq', left: { $ref: 'nodes.effect.committed' }, right: true }]);
  store.saveWorkflow(gated);
  const waiting = await gatedRuntime.execute(gatedRuntime.create(gated, {}).id), approvalId = Object.keys(waiting.approvals)[0];
  assert.equal(gatedRuntime.approve(waiting.id, approvalId, false).status, 'cancelled');
  rewrite(store, waiting.id, r => { r.status = 'awaiting_approval'; r.error = null; r.approvals[approvalId].status = 'pending'; r.nodes.effect.status = 'awaiting_approval'; });
  assert.throws(() => gatedRuntime.approve(waiting.id, approvalId, true), { code: 'RUN_CLOSED' });
  assert.equal(store.events(waiting.id).at(-1).type, 'approval.decided', 'nothing was appended');
});

test('replay: a copy replayed earlier cannot be edited to change what later replays serve', async t => {
  const { store, run: live } = await finished(t);
  const first = runtimeOn(store, silent), replayed = await first.runtime.execute(first.runtime.create(workflow, { raw: 'five dollars' }, { modelMode: 'replay', sampleSalt: 'chain:1' }).id);
  assert.equal(replayed.status, 'succeeded', JSON.stringify(replayed.error));
  // The newest replayable row for a key is what lookup serves: edit the copy in the first replay, leave the original alone.
  sql(store, "UPDATE model_calls SET response=replace(response,'\"amount\":10','\"amount\":11') WHERE run_id=? AND ok=1 AND response LIKE '%\"amount\":10%'", replayed.id);
  assert.ok(codes(verifyRun(store, replayed.id)).includes('JOURNAL_ROW_EDITED'));
  assert.equal(verifyRun(store, live.id).ok, true);
  const again = runtimeOn(store, silent), third = await again.runtime.execute(again.runtime.create(workflow, { raw: 'five dollars' }, { modelMode: 'replay', sampleSalt: 'chain:1' }).id);
  assert.equal(third.status, 'failed');
  assert.equal(third.error.code, 'JOURNAL_TAMPERED');
  assert.match(third.error.message, /differs from the copy replayed from it/);
  assert.equal(third.outputs.twice, undefined);
});

// A real crash between the journal commit and the charge: the resumed run binds the recovered row.
const src = name => JSON.stringify(new URL(`../src/${name}`, import.meta.url).href);
const childCode = (scriptValue, policy) => `
import { Store } from ${src('store.mjs')}; import { Runtime } from ${src('runtime.mjs')}; import { createDefaultRegistry } from ${src('capabilities.mjs')};
import { loadPolicy } from ${src('models/policy.mjs')}; import { ModelPort } from ${src('models/port.mjs')}; import { Journal } from ${src('journal.mjs')};
import { ScriptedProvider } from ${src('models/providers/scripted.mjs')};
const [workspace, runId] = process.argv.slice(1);
const store = new Store(workspace), loaded = loadPolicy(), provider = new ScriptedProvider(${JSON.stringify(scriptValue)});
const models = new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(store) });
await new Runtime(store, createDefaultRegistry(), ${JSON.stringify(policy)}, { models, modelPolicy: loaded }).execute(runId);`;

test('crash recovery: the row committed before a crash is bound by the recovery event and the sealed root', async t => {
  const { root, store } = space(t), policy = { maxCost: 1, maxDurationMs: 60000 };
  const created = runtimeOn(store, silent, policy).runtime.create(workflow, { raw: 'five dollars' }, { extra: { crashAfterModel: 'root/norm' } });
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childCode({ [S]: [{ text: 'five', costUsd: 0.1 }] }, policy), root, created.id],
    { encoding: 'utf8', timeout: 20000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', NODE_NO_WARNINGS: '1' } });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  assert.equal(verifyRun(store, created.id).ok, true, 'a run that crashed mid-flight verifies: the orphan row is not yet referenced, and nothing is sealed');
  store.updateRun(created.id, run => { delete run.extra.crashAfterModel; }, { type: 'test.crash-injection-disabled' });
  const resumed = runtimeOn(store, { [S]: [{ value: { amount: 5 }, costUsd: 0.2 }, { value: { amount: 10 } }] }, policy);
  const run = await resumed.runtime.execute(created.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  const [recovered] = events(store, created.id, 'node.recovered_from_journal');
  assert.ok(recovered.journalRowHash && recovered.requestHash && recovered.responseHash);
  const report = verifyRun(store, created.id);
  assert.deepEqual([report.ok, report.clean], [true, true], JSON.stringify(report.findings));
  assert.equal(report.checks.journal.boundCalls, 3);
  sql(store, "UPDATE model_calls SET response=replace(response,'five','nine') WHERE id=?", recovered.journalId);
  assert.ok(codes(verifyRun(store, created.id)).includes('JOURNAL_ROW_EDITED'), 'the recovered row is covered too');
});

test('crash recovery: a row seeded for a future call while the run is paused is not "recovered" (it predates the attempt)', async t => {
  // Recovery serves a row journaled for (run, node, attempt) without a provider call; a forged row planted for a call the run has not
  // made yet would be served and bound as genuine. The attempt's first context.compiled event records the journal's high-water mark.
  const seeded = () => wrap('Preseed', [{ id: 'ask', kind: 'human', needs: [], description: 'Ask', question: 'Proceed?', answerSchema: { type: 'boolean' } },
    agent('norm', { needs: ['ask'] })], [{ op: 'gte', left: { $ref: 'nodes.norm.amount' }, right: 0 }]);
  const reference = space(t); reference.store.saveWorkflow(seeded());
  const recorder = runtimeOn(reference.store, { [S]: [{ value: { amount: 5 } }] });
  const first = await recorder.runtime.execute(recorder.runtime.create(seeded(), { raw: 'five dollars' }, { sampleSalt: 'seed' }).id);
  recorder.runtime.answer(first.id, 'root/ask', true);
  assert.equal((await recorder.runtime.execute(first.id)).status, 'succeeded');
  const genuine = reference.store.db.prepare('SELECT * FROM model_calls WHERE ok=1').get();
  const [compiled] = events(reference.store, first.id, 'context.compiled');
  assert.ok(Number.isSafeInteger(compiled.journalMark) && genuine.id > compiled.journalMark, 'a genuine row postdates the mark of its attempt');

  const { store } = space(t); store.saveWorkflow(seeded());
  const victim = runtimeOn(store, silent), paused = await victim.runtime.execute(victim.runtime.create(seeded(), { raw: 'five dollars' }, { sampleSalt: 'seed' }).id);
  assert.equal(paused.status, 'awaiting_human');
  new Journal(store);
  const columns = Object.keys(genuine).filter(c => c !== 'id'), forged = { ...genuine, run_id: paused.id, response: genuine.response.replace('"amount":5', '"amount":999') };
  sql(store, `INSERT INTO model_calls(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, ...columns.map(c => forged[c]));
  victim.runtime.answer(paused.id, 'root/ask', true);
  const run = await victim.runtime.execute(paused.id);
  assert.deepEqual([run.status, run.error.code, victim.provider.calls.length], ['failed', 'JOURNAL_TAMPERED', 0]);
  assert.match(run.error.message, /predates attempt 1 of root\/norm/);
  assert.equal(run.outputs.norm, undefined, 'the seeded answer was not used');
});

// ---- command line and server ----------------------------------------------------------------------------------------------------

test('cli: verify-run prints the verdict and chain head, fails on tampering, and checks and appends anchors', async t => {
  const { root, store, run } = await finished(t), anchors = path.join(root, '..', `cli-anchors-${path.basename(root)}.jsonl`);
  t.after(() => rmSync(anchors, { force: true }));
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const verify = (...args) => { const r = spawnSync(process.execPath, [cli, 'verify-run', run.id, '--workspace', root, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' } }); return { ...r, json: r.stdout ? JSON.parse(r.stdout) : null }; };
  const ok = verify('--append-anchor', anchors);
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual([ok.json.ok, ok.json.clean, ok.json.head.hash, ok.json.anchored], [true, true, run.eventHead.hash, { file: anchors, appended: true }]);
  assert.equal(readAnchors(anchors).at(-1).headHash, run.eventHead.hash);
  assert.equal(verify('--check-anchors', anchors, '--expect-head', `${run.eventHead.seq}:${run.eventHead.hash}`).status, 0);
  assert.equal(verify('--expect-head', `${run.eventHead.seq}:${'0'.repeat(64)}`).status, 1);
  assert.match(verify('--expect-head', 'garbage').stderr, /SEQ:HASH/);
  assert.equal(verify('--check-anchors', path.join(root, 'missing.jsonl')).status, 1, 'an anchor file that is not there is an error, not a pass');
  const none = verify('--check-anchors', anchors, '--require-bound'), other = path.join(root, '..', `other-${path.basename(root)}.jsonl`);
  t.after(() => rmSync(other, { force: true }));
  appendAnchor(other, { ...ok.json.anchor, runId: 'someone-else' });
  const unmatched = verify('--check-anchors', other);
  assert.deepEqual([none.status, unmatched.status, unmatched.json.clean, unmatched.json.findings.map(f => f.code)], [0, 0, false, ['ANCHOR_NONE']], 'no anchor for this run is a warning');
  assert.equal(verify('--require-bound').status, 0);

  sql(store, "UPDATE model_calls SET response=replace(response,'\"amount\":5','\"amount\":6') WHERE ok=1 AND response LIKE '%\"amount\":5%'");
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const bad = verify('--check-anchors', anchors);
  assert.equal(bad.status, 1);
  assert.equal(bad.json.ok, false);
  assert.ok(bad.json.findings.some(f => f.code === 'JOURNAL_ROW_EDITED'));
  assert.equal(spawnSync(process.execPath, [cli, 'verify-run', 'nope', '--workspace', root], { encoding: 'utf8' }).status, 1);
  assert.equal(spawnSync(process.execPath, [cli, 'verify-run', '--workspace', root], { encoding: 'utf8' }).status, 1, 'a run id is required');
});

test('cli: run and inspect print the chain head as an anchor, and run can append it to an anchor file', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-chain-cli-')), anchors = `${root}-anchors.jsonl`;
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(anchors, { force: true }); });
  const file = path.join(root, 'wf.json');
  writeFileSync(file, JSON.stringify({ schemaVersion: '1.0', id: 'ChainEcho', version: 1, title: 'Echo', goal: 'Echo the input', domain: 'general',
    envelope: { assumptions: [], risks: [], successCriteria: ['Echo the input'] }, budget: { maxSteps: 5, maxConcurrency: 1, maxDurationMs: 5000, maxCost: 0 },
    nodes: [{ id: 'echo', kind: 'task', needs: [], description: 'Echo', tool: 'core.identity', args: { $ref: 'input' }, timeoutMs: 1000, retry: { maxAttempts: 1 } }],
    acceptance: [{ op: 'eq', left: { $ref: 'nodes.echo' }, right: { $ref: 'input' } }] }));
  const env = { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' };
  const ran = spawnSync(process.execPath, [cli, 'run', file, '--input', '{"a":1}', '--workspace', root, '--append-anchor', anchors], { encoding: 'utf8', env });
  assert.equal(ran.status, 0, ran.stderr);
  const out = JSON.parse(ran.stdout);
  assert.deepEqual([out.anchor.runId, out.anchor.headHash, out.anchor.headSeq], [out.id, out.eventHead.hash, out.eventHead.seq]);
  assert.equal(out.anchor.status, 'succeeded');
  assert.equal(readAnchors(anchors).at(-1).headHash, out.eventHead.hash);
  const inspected = JSON.parse(spawnSync(process.execPath, [cli, 'inspect', out.id, '--workspace', root], { encoding: 'utf8', env }).stdout);
  assert.deepEqual(inspected.anchor.headHash, out.eventHead.hash);
  const { anchored: _anchored, ...runOutput } = out;
  assert.deepEqual(inspected, runOutput, 'inspect prints what run printed (the anchor is a function of the evidence, not of the clock)');
  const checked = spawnSync(process.execPath, [cli, 'verify-run', out.id, '--workspace', root, '--check-anchors', anchors, '--require-bound'], { encoding: 'utf8', env });
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(spawnSync(process.execPath, [cli, 'run', file, '--input', '{}', '--workspace', root, '--check-anchors', anchors], { encoding: 'utf8', env }).status, 1, '--check-anchors belongs to verify-run');
  // An anchor file that cannot be appended to never hides the run: it is printed with the error, and the exit code says so.
  const broken = `${root}-broken.jsonl`;
  t.after(() => rmSync(broken, { force: true }));
  writeFileSync(broken, 'not json\n');
  const unanchored = spawnSync(process.execPath, [cli, 'run', file, '--input', '{"b":2}', '--workspace', root, '--append-anchor', broken], { encoding: 'utf8', env });
  assert.equal(unanchored.status, 1);
  const printed = JSON.parse(unanchored.stdout);
  assert.deepEqual([printed.status, printed.anchored.appended, printed.anchored.error.code], ['succeeded', false, 'ANCHOR_FILE']);
});

test('anchors: writers of one anchor file take turns, so parallel appends never fork it; a lock left by a dead writer is taken over', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-anchor-lock-')), file = path.join(dir, 'anchors.jsonl');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const audit = JSON.stringify(new URL('../src/audit.mjs', import.meta.url).href);
  const writer = who => `import { appendAnchor } from ${audit};
for (let i = 0; i < 15; i++) appendAnchor(${JSON.stringify(file)}, { schema: 'foundry-anchor/1', runId: '${who}-' + i, headSeq: 1, headHash: 'a'.repeat(64), journalRoot: null, status: 'succeeded' });`;
  const { spawn } = await import('node:child_process');
  const codesOf = await Promise.all(['w0', 'w1', 'w2', 'w3'].map(who => new Promise(resolve =>
    spawn(process.execPath, ['--input-type=module', '-e', writer(who)], { stdio: 'ignore', env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' } }).on('exit', resolve))));
  assert.deepEqual(codesOf, [0, 0, 0, 0]);
  assert.equal(readAnchors(file).length, 60, 'every line continues the one before it');
  const lock = `${file}.lock`;
  writeFileSync(lock, '999999');
  const { utimesSync, existsSync } = await import('node:fs');
  utimesSync(lock, new Date(Date.now() - 60000), new Date(Date.now() - 60000));
  assert.equal(appendAnchor(file, { schema: 'foundry-anchor/1', runId: 'late', headSeq: 1, headHash: 'b'.repeat(64), journalRoot: null, status: 'succeeded' }).appended, true);
  assert.equal(existsSync(lock), false);
});

test('http: GET /api/runs/ID/verify returns the report and the run view carries its anchor', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-chain-http-')), foundry = new Foundry(root);
  const service = await serveHttp(foundry, { port: 0 });
  t.after(async () => { await service.close(); await foundry.close(); rmSync(root, { recursive: true, force: true }); });
  foundry.save(wrap('HttpChain', [{ id: 'ask', kind: 'human', needs: [], description: 'Ask', question: 'Proceed?', answerSchema: { type: 'boolean' } }], [{ op: 'eq', left: { $ref: 'nodes.ask.answer' }, right: true }]));
  const run = foundry.createRun('HttpChain', {});
  await foundry.startRun(run.id);
  const report = await (await fetch(`${service.origin}/api/runs/${run.id}/verify`)).json();
  assert.deepEqual([report.schema, report.ok, report.bound, report.runId], ['foundry-verify/1', true, true, run.id]);
  const view = await (await fetch(`${service.origin}/api/runs/${run.id}`)).json();
  assert.equal(view.anchor.headHash, foundry.store.run(run.id).eventHead.hash);
  const missing = await fetch(`${service.origin}/api/runs/nope/verify`);
  assert.equal(missing.status, 404);
});
