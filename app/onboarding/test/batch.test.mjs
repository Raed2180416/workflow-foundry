// Batch approval of an exact, displayed list (SPEC §7.5): every rule as a test. nice -n 15 node --test app/onboarding/test/batch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Batches, BATCH_TTL_MS } from '../batch.mjs';
import { listDrafts } from '../drafts.mjs';
import { withApp, invoiceFlowOn, liveInvoices, NOW } from './helpers.mjs';

const batchFile = dir => path.join(dir, 'batches.json');

test('an exact match is made, one click for the whole list; the batch file and the run record show the person as the source', async () => withApp(async (app, dir) => {
  const p = await invoiceFlowOn(app); liveInvoices(app);
  const batches = new Batches(app, { now: () => NOW });
  const b = await batches.preview(p.flowId);
  assert.equal(b.passed, true);
  assert.deepEqual(b.items.map(i => i.subject), ['Final notice: invoice INV-2043', 'Friendly reminder: invoice INV-2042', 'Second reminder: invoice INV-2041', 'Invoice reminders: summary']);
  assert.ok(b.items.every(i => i.body.length > 50 && /^[a-f0-9]{64}$/.test(i.digest)), 'every item carries its full text and a digest');
  assert.equal(listDrafts(app).length, 0, 'preview makes nothing');
  const r = await batches.approve(b.batchId, { channel: 'dashboard' });
  assert.equal(r.status, 'succeeded'); assert.equal(r.made.length, 4); assert.equal(r.stoppedAt, null);
  assert.equal(listDrafts(app).length, 4);
  const saved = JSON.parse(readFileSync(batchFile(dir), 'utf8'))[0];
  assert.deepEqual([saved.status, saved.decision.by, saved.decision.channel, Object.keys(saved.usedBy).length], ['used', 'person', 'dashboard', 4]);
  const decided = app.foundry.store.events(r.runId).filter(e => e.type === 'approval.decided');
  assert.equal(decided.length, 4); assert.ok(decided.every(e => e.actor === 'user' && e.approved === true));
}));

test('a one-character change in a body is not on the list: the run stops and asks about that one', async () => withApp(async (app, dir) => {
  const p = await invoiceFlowOn(app); liveInvoices(app);
  const batches = new Batches(app, { now: () => NOW });
  const b = await batches.preview(p.flowId);
  const list = JSON.parse(readFileSync(batchFile(dir), 'utf8'));
  list[0].items[0].body = list[0].items[0].body.replace('Hello', 'Hullo'); // the person saw (and approved) a different text
  list[0].items[0].digest = 'x'.repeat(64);
  writeFileSync(batchFile(dir), JSON.stringify(list));
  const r = await batches.approve(b.batchId);
  assert.ok(r.stoppedAt, 'stopped'); assert.ok(r.made.length < 4);
  assert.equal(app.status({ runId: r.runId }).status, 'awaiting_approval', 'the unmatched send still waits for a normal single decision');
  assert.equal(app.inbox().actions.length, 1);
}));

test('an item is never used twice, an expired list is refused, a decline makes nothing', async () => withApp(async app => {
  const p = await invoiceFlowOn(app); liveInvoices(app);
  let clock = NOW;
  const batches = new Batches(app, { now: () => clock });
  const b = await batches.preview(p.flowId);
  await batches.approve(b.batchId);
  await assert.rejects(batches.approve(b.batchId), { code: 'BATCH_CLOSED' });
  const b2 = await batches.preview(p.flowId);
  clock = NOW + BATCH_TTL_MS + 1000;
  await assert.rejects(batches.approve(b2.batchId), { code: 'BATCH_EXPIRED' });
  clock = NOW;
  const b3 = await batches.preview(p.flowId);
  const before = listDrafts(app).length;
  assert.equal(batches.decline(b3.batchId).status, 'declined');
  assert.equal(listDrafts(app).length, before, 'a decline makes nothing');
  await assert.rejects(batches.approve(b3.batchId), { code: 'BATCH_CLOSED' });
}));

// Known limit, kept as a test: the preview runs in a fresh practice store, so it cannot see what earlier live runs remembered. On a
// second run the engine skips the reminders it already sent (never asks), and the summary's text ("new reminders sent this run: 0")
// differs from the preview's ("3"), so the guard stops there and asks about the summary as a single card. Nothing unlisted is made.
test('the second run of the same list: reminders already sent are skipped, and a summary whose text changed stops and asks', async () => withApp(async app => {
  const p = await invoiceFlowOn(app); liveInvoices(app);
  const batches = new Batches(app, { now: () => NOW });
  await batches.approve((await batches.preview(p.flowId)).batchId);
  const drafts = listDrafts(app).length;
  const again = await batches.approve((await batches.preview(p.flowId)).batchId);
  assert.deepEqual(again.made, [], 'no reminder is made twice');
  assert.equal(again.stoppedAt.subject, 'Invoice reminders: summary');
  assert.equal(listDrafts(app).length, drafts, 'nothing was made that the person did not see in full');
  assert.equal(app.inbox().actions[0].subject, 'Invoice reminders: summary', 'the summary waits as a normal single card');
}));

test('a changed head (a new version turned on after the list was made) is refused', async () => withApp(async app => {
  const p = await invoiceFlowOn(app); liveInvoices(app);
  const batches = new Batches(app, { now: () => NOW });
  const b = await batches.preview(p.flowId);
  const p2 = await app.propose({ template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'me@example.com', signature: 'Ana at Bramble' }, flowId: p.flowId, origin: 'site-form' });
  assert.equal(p2.version, 2);
  await app.dryRun({ proposalId: p2.proposalId });
  app.decideActivation(app.requestApproval({ proposalId: p2.proposalId }).approvalId, true, { channel: 'dashboard' });
  await assert.rejects(batches.approve(b.batchId), { code: 'STALE_APPROVAL' });
}));

test('no list without a turned-on version, the live sheet, and normal mode', async () => withApp(async app => {
  const p = await app.propose({ template: 'invoice-chase', settings: { sendSummary: false }, origin: 'site-form' });
  await app.dryRun({ proposalId: p.proposalId });
  const batches = new Batches(app, { now: () => NOW });
  await assert.rejects(batches.preview('invoice-chase'), { code: 'NOT_FOUND' });
  app.decideActivation(app.requestApproval({ proposalId: p.proposalId }).approvalId, true, { channel: 'dashboard' });
  await assert.rejects(batches.preview('invoice-chase'), { code: 'SHEET_NOT_FOUND' });
  liveInvoices(app);
  writeFileSync(path.join(app.root, 'settings.json'), JSON.stringify({ mode: 'practice-only' }));
  await assert.rejects(batches.preview('invoice-chase'), { code: 'PRACTICE_ONLY' });
}));
