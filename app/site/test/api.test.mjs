// The site API end to end over a real workspace ($0, no model, loopback). nice -n 15 node --test app/site/test/api.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSite } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = n => readFileSync(path.join(here, 'fixtures', n), 'utf8');

test('P2 reference path through the API: card -> test -> turn on -> own list -> exact list -> drafts -> evidence', async () => {
  const s = await startSite();
  try {
    const t = await s.get('/api/templates');
    assert.deepEqual(t.templates.map(x => x.card), ['Chase unpaid invoices', 'Approve small expenses', 'Weekly progress report', 'Route new leads', 'Answer common support questions', 'On-call alert digest', 'Keep the newsletter list in step']);
    assert.ok(t.templates.every(x => x.usesAI === false));
    const p = await s.post('/api/propose', { template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'me@example.com' } });
    assert.equal(p.status, 'proposed'); assert.equal(p.usesAI, false);
    const d = await s.post('/api/practice', { proposalId: p.proposalId });
    assert.equal(d.passed, true); assert.equal(d.wouldDo.length, 4);
    const view = await s.get(`/api/proposals/${p.proposalId}`);
    assert.equal(view.dryRun.passed, true); assert.equal(view.active, false); assert.ok(view.promises.willNotDo.some(x => /schedule/.test(x)));
    const req = await s.post('/api/request-approval', { proposalId: p.proposalId });
    const on = await s.post('/api/decide', { kind: 'activation', approvalId: req.approvalId, decision: 'approve', note: 'who decides: the person at this computer' });
    assert.equal(on.status, 'approved');
    const pv = await s.post('/api/data/preview', { template: 'invoice-chase', sheet: 'invoices', csv: fixture('invoices-accounting-export.csv') });
    assert.deepEqual(pv.questions.map(q => q.id), ['dateOrder:due']);
    const c = await s.post('/api/data/commit', { template: 'invoice-chase', sheet: 'invoices', csv: fixture('invoices-accounting-export.csv'), mapping: pv.mapping, answers: { 'dateOrder:due': 'dmy' }, target: 'live' });
    assert.equal(c.rows, 6);
    const b = await s.post('/api/batch/preview', { flowId: p.flowId });
    assert.equal(b.items.length, 4);
    assert.equal((await s.get('/api/batches')).open.length, 1);
    const made = await s.post('/api/batch/approve', { batchId: b.batchId });
    assert.equal(made.made.length, 4); assert.equal(made.status, 'succeeded');
    const drafts = await s.get('/api/drafts');
    assert.equal(drafts.drafts.length, 4);
    const eml = await fetch(`${s.base}/api/drafts/${drafts.drafts[0].id}.eml`, { headers: s.headers });
    assert.equal(eml.headers.get('content-type'), 'message/rfc822'); assert.match(eml.headers.get('content-disposition'), /attachment/);
    assert.match(await eml.text(), /^X-Unsent: 1\r\n/);
    const ev = await s.get(`/api/evidence/${made.runId}`);
    assert.equal(ev.chain.verified, true); assert.equal(ev.turnedOn.note, 'who decides: the person at this computer');
    const brief = await s.get(`/api/brief/${p.flowId}.json`);
    assert.equal(brief.workflowHash, p.workflowHash);
    const md = await fetch(`${s.base}/api/brief/${p.flowId}.md`, { headers: s.headers });
    assert.match(md.headers.get('content-disposition'), /foundry-it-brief-invoice-chase\.md/);
    const ics = await fetch(`${s.base}/api/ics/${p.flowId}.ics`, { headers: s.headers });
    assert.match(await ics.text(), /RRULE:FREQ=WEEKLY[\s\S]*reminder\\, not automation/);
    const m = await s.get('/api/milestones');
    assert.ok(m.firstVerified && m.firstLive, 'activation timing is a local file only');
  } finally { await s.close(); }
});

test('a test on the person\'s own list runs as of today, so it matches what the live list would make (found by the P2 own-data journey)', async () => {
  const s = await startSite();
  try {
    const p = await s.post('/api/propose', { template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'me@example.com' } });
    const csv = fixture('invoices-accounting-export.csv');
    const pv = await s.post('/api/data/preview', { template: 'invoice-chase', sheet: 'invoices', csv });
    const c = await s.post('/api/data/commit', { template: 'invoice-chase', sheet: 'invoices', csv, mapping: pv.mapping, answers: { 'dateOrder:due': 'dmy' }, target: 'practice' });
    const d = await s.post('/api/practice', { proposalId: p.proposalId, practiceDataId: c.practiceDataId });
    assert.equal(d.passed, true); assert.equal(d.dataSource, 'your-data');
    // On 2026-10-21, read day first: INV-2041 (18 days late), INV-2042 (11) and INV-2043 (50) are due a reminder; INV-2046 is not due yet.
    assert.deepEqual(d.wouldDo.filter(w => w.to !== 'me@example.com').map(w => w.subject.match(/INV-\d+/)[0]).sort(), ['INV-2041', 'INV-2042', 'INV-2043']);
  } finally { await s.close(); }
});

test('practice-only mode: the site refuses live runs and new lists; tests still work', async () => {
  const s = await startSite();
  try {
    const p = await s.post('/api/propose', { template: 'weekly-report', settings: { recipient: 'lead@example.com' } });
    await s.post('/api/practice', { proposalId: p.proposalId });
    const req = await s.post('/api/request-approval', { proposalId: p.proposalId });
    await s.post('/api/decide', { kind: 'activation', approvalId: req.approvalId, decision: 'approve' });
    assert.equal((await s.post('/api/settings', { mode: 'practice-only' })).mode, 'practice-only');
    const run = await s.post('/api/run', { flowId: p.flowId });
    assert.equal(run.ok, false); assert.equal(run.problem.code, 'PRACTICE_ONLY');
    const b = await s.post('/api/batch/preview', { flowId: p.flowId });
    assert.equal(b.status, 409); assert.equal(b.error.code, 'PRACTICE_ONLY');
    const p2 = await s.post('/api/propose', { template: 'weekly-report', settings: { recipient: 'lead@example.com', team: 'Ops' } });
    assert.equal((await s.post('/api/practice', { proposalId: p2.proposalId })).passed, true);
    assert.equal((await s.post('/api/settings', { mode: 'sometimes' })).status, 409);
  } finally { await s.close(); }
});

test('the box never builds; a card is required without an AI builder (R1)', async () => {
  const s = await startSite();
  try {
    assert.equal((await s.post('/api/suggest', { text: 'book me a flight to Lisbon' })).candidates.length, 0);
    assert.equal((await s.post('/api/suggest', { text: "remind customers who haven't paid" })).best, 'invoice-chase');
    const r = await s.post('/api/propose', { request: 'remind customers who have not paid' });
    assert.equal(r.status, 409); assert.match(r.problem.what, /Pick a card first/);
    assert.equal((await s.get('/api/automations')).drafts.length, 0, 'nothing was created');
  } finally { await s.close(); }
});

test('the paid line never gates size: fifty automations, no count check anywhere (R12)', async () => {
  const s = await startSite();
  try {
    for (let i = 0; i < 50; i++) assert.equal((await s.post('/api/propose', { template: 'weekly-report', settings: { recipient: 'lead@example.com', team: `Team ${i}` } })).status, 'proposed');
    const a = await s.get('/api/automations');
    assert.equal(a.drafts.length, 50);
    assert.equal((await s.post('/api/propose', { template: 'weekly-report', settings: { recipient: 'lead@example.com', team: 'One more' } })).status, 'proposed');
  } finally { await s.close(); }
});

test('who decides what: start, add a rule, confirm, save; the expense card is capped; a flip blocks the next save', async () => {
  const s = await startSite();
  try {
    let { map } = await s.post('/api/org/starter', { start: 'small-team' });
    map.principals.push({ id: 'p-dana', name: 'Dana', kind: 'human', roles: ['approver', 'rule-owner'] });
    const row = map.approvals.find(a => a.actionClass === 'money-out');
    map.parameters.moneyOutApprovalAbove = { value: 250, unit: 'EUR' }; row.aboveParameter = 'moneyOutApprovalAbove'; row.approverPrincipal = 'p-dana';
    map = (await s.post('/api/org/rule', { map, approvalId: row.id })).map;
    assert.equal(map.clauses[0].examples.length, 6);
    const notYet = await s.post('/api/org/map', { map });
    assert.equal(notYet.status, 409); assert.match(notYet.problem.what, /confirm the examples/);
    map.clauses[0].examples.forEach(e => { e.confirmed = true; });
    const v1 = await s.post('/api/org/map', { map });
    assert.equal(v1.version, 1);
    const cur = await s.get('/api/org/map');
    assert.equal(cur.notEnforced.startsWith('Checked when an automation is made'), true);
    assert.ok(cur.warnings.some(w => /Started by one person/.test(w)));
    const r = await s.post('/api/restate', { template: 'expense-approval', settings: {} });
    assert.equal(r.setBy[0].text, '€250 · Set by Dana (Org policy)');
    const wide = await s.post('/api/propose', { template: 'expense-approval', settings: { autoApproveUpTo: 2000, approver: 'dana@example.com' } });
    assert.equal(wide.status, 'build_failed'); assert.match(wide.reply, /Not allowed here\. Dana set the limit at €250 \(Org policy\)/);
    const next = cur.current.map; next.parameters.moneyOutApprovalAbove.value = 300;
    const blocked = await s.post('/api/org/map', { map: next });
    assert.equal(blocked.status, 409); assert.equal(blocked.flips.length, 1); assert.match(blocked.flips[0].message, /case 4/);
    next.clauses[0].examples.find(e => e.n === 4).answer = 'allowed';
    assert.equal((await s.post('/api/org/map', { map: next })).version, 2);
  } finally { await s.close(); }
});

test('connect prints only; the n8n import runs nothing; doctor reports in plain words', async () => {
  const s = await startSite();
  try {
    const c = await s.get('/api/connect');
    assert.match(c.note, /Nothing was written/);
    assert.deepEqual(c.allowlist.serverCommand.slice(2), ['mcp', '--dashboard', '--workspace', s.dir]);
    assert.deepEqual(JSON.parse(Buffer.from(c.cursorLink.split('config=')[1], 'base64').toString('utf8')), c.cursorJson.mcpServers.foundry);
    const imp = await s.post('/api/import/n8n', { json: fixture('n8n-synthetic.json') });
    assert.equal(imp.executed, false); assert.equal(imp.risk.length, 4);
    const d = await s.get('/api/doctor');
    assert.equal(d.ok, true); assert.ok(d.items.every(i => typeof i.say === 'string' && i.say.length > 5));
  } finally { await s.close(); }
});
