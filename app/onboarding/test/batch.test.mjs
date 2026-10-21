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
  // card-text r2 wording: no subject claims an earlier reminder (P2 walkthrough B4)
  assert.deepEqual(b.items.map(i => i.subject), ['Payment overdue, action needed: invoice INV-2043', 'Payment overdue: invoice INV-2041', 'Payment reminder: invoice INV-2042', 'Invoice reminders: summary']);
  assert.equal(b.items.filter(i => i.to !== 'me@example.com').some(i => /second reminder|final notice/i.test(i.body)), false, 'no customer is told about a reminder they never got');
  assert.match(b.items[0].body, /€75\.50/, 'the amount is written as money');
  // Two customers would get a firmer reminder although Foundry never reminded them: the list says so before the yes.
  assert.deepEqual(b.notes.find(n => n.kind === 'firm-first')?.invoices.map(x => x.invoice).sort(), ['INV-2041', 'INV-2043']);
  assert.ok(b.items.every(i => i.body.length > 50 && /^[a-f0-9]{64}$/.test(i.digest)), 'every item carries its full text and a digest');
  assert.equal(listDrafts(app).length, 0, 'preview makes nothing');
  const r = await batches.approve(b.batchId, { channel: 'dashboard' });
  assert.equal(r.status, 'succeeded'); assert.equal(r.made.length, 4); assert.equal(r.stoppedAt, null);
  assert.equal(listDrafts(app).length, 4);
  const saved = JSON.parse(readFileSync(batchFile(dir), 'utf8'))[0];
  assert.deepEqual([saved.status, saved.decision.channel, Object.keys(saved.usedBy).length], ['used', 'dashboard', 4]);
  assert.match(saved.decision.by, /\S+@\S+/, 'the decision names this computer\'s account and host');
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

// Fixed (P2 walkthrough B3; was a known limit): the preview starts from the live store's state, so the second run of the same list lists
// only the summary (no reminder twice), its text matches the real run's ("drafts made this run: 0"), and the yes makes exactly it.
test('the second run of the same list lists only what is new; the yes makes exactly that, and nothing waits', async () => withApp(async app => {
  const p = await invoiceFlowOn(app); liveInvoices(app);
  const batches = new Batches(app, { now: () => NOW });
  await batches.approve((await batches.preview(p.flowId)).batchId);
  const drafts = listDrafts(app).length;
  const second = await batches.preview(p.flowId);
  assert.deepEqual(second.items.map(i => i.subject), ['Invoice reminders: summary'], 'no reminder is listed twice');
  assert.match(second.items[0].body, /Reminder drafts made this run: 0/);
  assert.equal(second.remembered, 3, 'the preview saw the three reminders made before');
  assert.equal(second.notes.some(n => n.kind === 'firm-first'), false, 'no first-contact warning once Foundry has reminded them');
  const again = await batches.approve(second.batchId);
  assert.equal(again.stoppedAt, null); assert.equal(again.made.length, 1);
  assert.equal(listDrafts(app).length, drafts + 1);
  assert.equal(app.inbox().actions.length, 0, 'nothing waits as a single card');
}));

test('a new list replaces the open one; a yes closes every other open list of the automation', async () => withApp(async app => {
  const p = await invoiceFlowOn(app); liveInvoices(app);
  const batches = new Batches(app, { now: () => NOW });
  const a = await batches.preview(p.flowId), b = await batches.preview(p.flowId);
  assert.equal(batches.get(a.batchId).status, 'replaced');
  assert.deepEqual(batches.open().map(x => x.batchId), [b.batchId]);
  await batches.approve(b.batchId);
  assert.equal(batches.open().length, 0);
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
