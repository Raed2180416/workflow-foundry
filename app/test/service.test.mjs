// FoundryApp: the lifecycle and its refusals, on the real runtime and store ($0, no model). node --test app/test/service.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FoundryApp } from '../core/service.mjs';
import { buildFromIntent } from '../core/builder.mjs';
import { StoreReader } from '../../tools/run-view/store-adapter.mjs';

const MESSY = 'ugh can u make something that tells my boss what we got done each week for the Platform team, dont spam ppl';
const WEEK = { weekOf: '2026-10-19', items: [{ title: 'Ship login fix', status: 'done', owner: 'Sam' }, { title: 'Billing table', status: 'open' }, { title: 'Contract', status: 'blocked' }] };
async function withApp(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'surface-app-'));
  const app = new FoundryApp({ workspace: dir });
  try { await fn(app, dir); } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
}
async function activeFlow(app, recipient = 'boss@example.com') {
  const p = app.propose({ request: MESSY, answers: { recipient } });
  assert.equal(p.status, 'proposed');
  const d = await app.dryRun({ proposalId: p.proposalId });
  assert.equal(d.passed, true);
  const a = app.requestApproval({ proposalId: p.proposalId });
  assert.equal(a.status, 'awaiting_human');
  assert.equal(app.decideActivation(a.approvalId, true, { channel: 'dashboard' }).status, 'approved');
  return p;
}

test('builder asks only the question whose wrong default sends data somewhere, and refuses what it cannot build', () => {
  const q = buildFromIntent({ request: MESSY });
  assert.equal(q.status, 'needs_answers');
  assert.deepEqual(q.questions.map(x => x.id), ['recipient']);
  assert.equal(q.understood.team, 'Platform');
  assert.deepEqual(q.understood.constraints, ['one recipient only']);
  assert.equal(buildFromIntent({ request: MESSY, answers: { recipient: 'my boss' } }).status, 'needs_answers', 'a non-address answer is asked again, not guessed');
  assert.equal(buildFromIntent({ request: 'book me a flight to Lisbon next Tuesday' }).status, 'unsupported');
});

test('happy path: propose -> practice -> person approves -> run pauses before sending -> person allows -> every check passes', async () => withApp(async (app, dir) => {
  const p = await activeFlow(app);
  const r = await app.run({ flowId: p.flowId, input: WEEK });
  assert.equal(r.status, 'awaiting_approval');
  assert.deepEqual(r.pendingApprovals.map(a => a.tool), ['outbox.send']);
  assert.equal(existsSync(path.join(dir, 'outbox')) ? readdirSync(path.join(dir, 'outbox')).length : 0, 0, 'nothing sent before the person allows it');
  const inbox = app.inbox();
  assert.equal(inbox.actions.length, 1);
  assert.equal(inbox.actions[0].to, 'boss@example.com');
  assert.match(inbox.actions[0].preview, /Finished 1 of 3 items/);
  const done = await app.decideAction(r.runId, inbox.actions[0].approvalId, true, { channel: 'dashboard' });
  assert.equal(done.status, 'succeeded');
  assert.equal(done.verdict, 'pass');
  assert.deepEqual(done.checks.map(c => c.passed), [true, true, true, true, true]);
  assert.equal(readdirSync(path.join(dir, 'outbox')).length, 1, 'exactly one message delivered');
  // The record the dashboard reads is the real hash-chained journal, verified link by link.
  const reader = StoreReader.open(app.storeFile);
  try { const chain = reader.events(r.runId, { header: reader.header(r.runId) }); assert.equal(chain.ok, true); assert.ok(chain.count > 10); }
  finally { reader.close(); }
}));

test('authority stays with the person: no dry run, no approval, model channel, rejected send', async () => withApp(async (app, dir) => {
  const p = app.propose({ request: MESSY, answers: { recipient: 'boss@example.com' } });
  assert.equal(app.requestApproval({ proposalId: p.proposalId }).problem.code, 'NEEDS_DRY_RUN');
  assert.equal((await app.run({ flowId: p.flowId, input: WEEK })).problem.code, 'NOT_APPROVED');
  await app.dryRun({ proposalId: p.proposalId });
  const a = app.requestApproval({ proposalId: p.proposalId });
  for (const channel of ['mcp-tool', 'model', undefined]) assert.throws(() => app.decideActivation(a.approvalId, true, { channel }), { code: 'APPROVAL_AUTHORITY' });
  assert.equal((await app.run({ flowId: p.flowId, input: WEEK })).problem.code, 'NOT_APPROVED');
  app.decideActivation(a.approvalId, true, { channel: 'cli' });
  assert.throws(() => app.decideActivation(a.approvalId, false, { channel: 'dashboard' }), { code: 'ACTIVATION_CONFLICT' }, 'a decided request cannot be decided twice');
  const r = await app.run({ flowId: p.flowId, input: WEEK });
  const approvalId = r.pendingApprovals[0].approvalId;
  await assert.rejects(app.decideAction(r.runId, approvalId, true, { channel: 'mcp-tool' }), { code: 'APPROVAL_AUTHORITY' });
  const stopped = await app.decideAction(r.runId, approvalId, false, { channel: 'dashboard' });
  assert.equal(stopped.status, 'cancelled');
  assert.equal(stopped.problem.code, 'APPROVAL_REJECTED');
  assert.match(stopped.problem.what, /said no/);
  assert.equal(existsSync(path.join(dir, 'outbox')) ? readdirSync(path.join(dir, 'outbox')).length : 0, 0);
}));

test('versions: an approval covers one exact hash; a changed head is refused until the person approves it', async () => withApp(async (app) => {
  const v1 = await activeFlow(app);
  const v2 = app.propose({ request: MESSY, flowId: v1.flowId, answers: { recipient: 'cto@example.com' } });
  assert.equal(v2.status, 'proposed'); assert.equal(v2.version, 2);
  assert.deepEqual(v2.changes.changed, ['send']);
  assert.equal(app.requestApproval({ proposalId: v2.proposalId }).problem.code, 'NEEDS_DRY_RUN', 'the v1 practice run does not count for v2');
  assert.equal((await app.run({ flowId: v1.flowId, input: WEEK })).status, 'awaiting_approval', 'v1 still runs while v2 is a draft');
  // A new head that bypassed approval (here: saved straight into the store) is refused.
  const head = app.foundry.store.workflow(v1.flowId);
  app.foundry.save({ ...app.foundry.store.proposal(v2.proposalId).workflow, version: 2 }, head.hash);
  assert.equal((await app.run({ flowId: v1.flowId, input: WEEK })).problem.code, 'STALE_APPROVAL');
  assert.equal(app.propose({ request: 'same thing, every Friday', flowId: v1.flowId }).status, 'no_change', 'a revision that changes nothing is not proposed');
}));

test('bad input and unknown requests fail in words, and create nothing', async () => withApp(async (app) => {
  assert.equal(app.propose({ request: 'translate my novel into Klingon' }).status, 'unsupported');
  assert.equal(app.foundry.store.proposals().length, 0);
  const p = await activeFlow(app);
  const bad = await app.run({ flowId: p.flowId, input: { weekOf: 'x', items: [{ title: 'a', status: 'maybe' }] } });
  assert.equal(bad.ok, false);
  assert.match(bad.problem.what, /expected shape/);
  const practice = await app.dryRun({ proposalId: p.proposalId, input: { weekOf: 'x', items: 'not a list' } });
  assert.equal(practice.passed, false);
}));
