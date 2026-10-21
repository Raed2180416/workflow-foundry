// Regression tests for the persona walkthrough fixes (research/onboarding-20261021/WALKTHROUGH.md): each test names the finding it holds.
// $0, no model, loopback only. nice -n 15 node --test --test-concurrency=1 app/site/test/walkthrough.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSite, NOW } from './helpers.mjs';
import { siteSession, readSession } from '../session.mjs';
import { connectInstructions, connectText, browserOpener, builderAllowed, doctor } from '../../cli.mjs';
import { CARD_TEXT, applyCardText, revisionsFor } from '../../onboarding/card-text.mjs';
import { TemplateFormBuilder } from '../../onboarding/form-builder.mjs';
import { loadLibrary, instantiate, templateById } from '../../core/library.mjs';
import { describeWorkflow } from '../../core/explain.mjs';
import { suggest } from '../../onboarding/suggest.mjs';
import { preview, convert } from '../../onboarding/csv.mjs';
import { loadSettings, saveSettings } from '../../onboarding/settings.mjs';
import { checkEvidence } from '../../onboarding/evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The same POSIX-style split the P1 journey uses (not imported: importing a journey file runs its browser tests). */
function shellWords(line) {
  const out = []; let cur = null, quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) { if (c === '"') quoted = false; else if (c === '\\' && /["\\$`]/.test(line[i + 1] ?? '')) cur += line[++i]; else cur += c; continue; }
    if (c === '"') { quoted = true; cur ??= ''; continue; }
    if (/\s/.test(c)) { if (cur !== null) { out.push(cur); cur = null; } continue; }
    cur = (cur ?? '') + c;
  }
  if (cur !== null) out.push(cur);
  return out;
}
const fixture = n => readFileSync(path.join(here, 'fixtures', n), 'utf8');
const CARDS = { 'invoice-chase': { sendSummary: true, summaryTo: 'me@example.com' }, 'expense-approval': { autoApproveUpTo: 100, approver: 'maria@example.com', notifyEmployees: true },
  'weekly-report': { recipient: 'a@b.example', team: 'Ops' }, 'lead-triage': { defaultAssignee: 's@b.example' }, 'support-deflection': { escalateTo: 's@b.example' },
  'oncall-digest': { channel: '#ops', page: true, pageTo: 'o@b.example' }, 'contact-sync': { reportTo: 'r@b.example' } };

test('P1/P2 B2: the page key and port persist per workspace; the open command needs no key; a stale key is refused', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'session-'));
  try {
    const a = siteSession(dir), b = siteSession(dir);
    assert.equal(a.token, b.token, 'the same key across starts, so a bookmark keeps working');
    a.remember(4999); assert.equal(readSession(dir).port, 4999);
    assert.notEqual(siteSession(dir, { fresh: true }).token, a.token, '--new-key makes a new one');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const s = await startSite();
  try {
    const info = await fetch(`${s.base}/open-info`).then(r => r.json());
    assert.match(info.open, /cli\.mjs" open --workspace /); assert.equal(/#t=|token/i.test(JSON.stringify(info)), false, 'no key without the key');
    const stale = await fetch(`${s.base}/api/overview`, { headers: { 'x-foundry-token': 'x'.repeat(32) } });
    assert.equal(stale.status, 401); assert.match((await stale.json()).error, /open/);
  } finally { await s.close(); }
});

test('P1 B1: a missing browser opener resolves false, never throws or prints the link', async () => {
  const before = process.listenerCount('uncaughtException');
  const ok = await browserOpener('linux', { BROWSER: '/nonexistent/browser-for-test' })('http://127.0.0.1:1/#t=secret');
  assert.equal(ok, false); assert.equal(process.listenerCount('uncaughtException'), before);
});

test('P1 B3, P4 M2: connect prints plain lines that a shell splits into the allowlisted command; default workspace leaves --workspace out', () => {
  const c = connectInstructions('/tmp/some-folder');
  const words = shellWords(c.claudeCode);
  assert.deepEqual(words.slice(words.indexOf('--') + 1), c.allowlist.serverCommand);
  assert.ok(c.allowlist.serverCommand.includes('--consent'));
  const text = connectText(c);
  assert.ok(text.includes(c.claudeCode)); assert.equal(text.trim().startsWith('{'), false, 'not JSON');
  const home = connectInstructions(path.join(process.env.FOUNDRY_HOME ?? path.join(process.env.HOME ?? '/root', '.foundry')));
  assert.equal(home.allowlist.serverCommand.includes('--workspace'), false);
});

test('P1 M7, P2 M5-M6, P4 M11: card text revisions apply to every card; no "sent/delivered/went out" and a plain sentence for every check', () => {
  const builder = new TemplateFormBuilder();
  for (const [id, settings] of Object.entries(CARDS)) {
    const r = builder.build({ template: id, settings, origin: 'site-form' });
    assert.equal(r.status, 'ready', `${id}: ${JSON.stringify(r.questions ?? r.problems)}`);
    const words = JSON.stringify(r.workflow);
    assert.equal(/went out|delivered exactly|asks you first|sent this run|Reply to approve or reject/.test(words), false, `${id} still says it sends`);
    assert.equal(r.workflow.envelope.successCriteria.length, r.workflow.acceptance.length, `${id}: every check has a plain sentence`);
    const t = templateById(id), { matched } = applyCardText(t, instantiate(t, r.understood.slots, { builder: 'test' }), r.understood.slots);
    const spec = CARD_TEXT.templates[id];
    for (const [from] of spec.replace ?? []) assert.ok([...matched].some(m => m === revisionsFor(t, r.understood.slots).pairs.find(p => p.from.startsWith(from.split('[[')[0]))?.from), `${id}: "${from}" matched nothing`);
    const plain = describeWorkflow(r.workflow).checks.map(c => c.plain);
    assert.equal(plain.some(x => !x), false, `${id}: a check without a plain sentence`);
  }
});

test('P2 B4: no first reminder claims an earlier one; amounts are written as money (P2 M1)', () => {
  const r = new TemplateFormBuilder().build({ template: 'invoice-chase', settings: {}, origin: 'site-form' });
  const text = JSON.stringify(r.workflow);
  assert.equal(/This is our second reminder|This is a final notice/.test(text), false);
  assert.match(text, /Please pay using the details on your invoice/);
  const rows = convert({ template: 'invoice-chase', sheet: 'invoices', text: fixture('invoices-accounting-export.csv'), mapping: preview({ template: 'invoice-chase', sheet: 'invoices', text: fixture('invoices-accounting-export.csv') }).mapping, answers: { 'dateOrder:due': 'dmy' } }).rows;
  assert.deepEqual(rows.map(x => x.amount).slice(0, 3), ['€1,240.00', '€480.00', '€75.50']);
});

test('P2 M2-M3, P3 B2: Total vs Balance is asked; a spreadsheet file is refused with what to do; a missing receipt column is optional', () => {
  const both = 'Invoice,Customer,Email,Total,Balance,Due,Status\nA1,X,x@y.example,480,200,2026-10-01,Open\n';
  const pv = preview({ template: 'invoice-chase', sheet: 'invoices', text: both });
  assert.equal(pv.mapping.amount, 'Balance', 'what is still owed is preferred');
  assert.deepEqual(pv.questions.find(q => q.id === 'column:amount')?.choices.map(c => c.value), ['Balance', 'Total']);
  assert.equal(convert({ template: 'invoice-chase', sheet: 'invoices', text: both, mapping: pv.mapping, answers: { 'column:amount': 'Total' } }).rows[0].amount, '480.00');
  assert.throws(() => preview({ template: 'invoice-chase', sheet: 'invoices', text: 'PK\u0003\u0004binary' }), { code: 'CSV_BINARY', message: /Save As/ });
  const refunds = 'id,employee,email,amount,status\n1042,Lee Moss,lee@x.example,749.99,Pending\n';
  const p = preview({ template: 'expense-approval', sheet: 'expenses', text: refunds });
  assert.deepEqual(p.missing, []);
  const row = convert({ template: 'expense-approval', sheet: 'expenses', text: refunds, mapping: p.mapping }).rows[0];
  assert.deepEqual([row.receipt, row.description, row.category], [false, 'no description given', 'no category']);
});

test('P3 B1: a request that shares only a common word is never "this sounds like"; refunds are not expense claims', () => {
  assert.equal(suggest('Refunds over $500 need my approval before we pay them back').best ?? null, null);
  assert.equal(suggest('Refunds over $500 need my approval before we pay them back').candidates.length, 0);
  assert.equal(suggest("remind customers who haven't paid").best, 'invoice-chase');
  const weak = suggest('please approve this');
  assert.equal(weak.best, null); assert.equal(weak.weakOnly, true);
});

test('P4 B1-B3, M4, M12-M13: the brief says "Uses AI: no", lists the e-mail step inside "for each", what leaves, the build, removal', async () => {
  const s = await startSite();
  try {
    const p = await s.post('/api/propose', { template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'me@example.com' } });
    await s.post('/api/practice', { proposalId: p.proposalId });
    const b = await s.get(`/api/brief/${p.flowId}.json`);
    const section = title => b.sections.find(x => x.title === title);
    assert.match(section('This automation').table.find(r => r[0] === 'Uses AI')[1], /^no/);
    const send = section('Every action').table.find(r => /^For each one: Draft the reminder/.test(r[0]));
    assert.ok(send, 'the customer e-mail step is listed'); assert.match(send[1], /e-mail draft/); assert.match(send[2], /^yes/);
    assert.match(section('What leaves this computer').lines.join(' '), /coding agent/);
    assert.ok(section('Build').table.some(r => r[0] === 'Commit'));
    assert.ok(section('Removing Foundry')); assert.ok(section('Data kept, and how to delete it'));
    const general = await s.get('/api/brief.json');
    assert.ok(general.sections.find(x => x.title === 'What a coding agent can call').table.some(r => r[0] === 'ask_person_to_turn_on'));
  } finally { await s.close(); }
});

test('P4 M1: an organisation policy file forces practice-only; Settings cannot turn it off; the service refuses live runs', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'policy-'));
  const file = path.join(dir, 'policy.json');
  writeFileSync(file, JSON.stringify({ mode: 'practice-only', allowedAI: 'none' }));
  const saved = process.env.FOUNDRY_POLICY_FILE; process.env.FOUNDRY_POLICY_FILE = file;
  try {
    const s = loadSettings(dir);
    assert.equal(s.mode, 'practice-only'); assert.deepEqual(s.managed, { mode: true, allowedAI: true });
    assert.throws(() => saveSettings(dir, { mode: 'normal' }), { code: 'SETTINGS_MANAGED' });
    assert.equal(saveSettings(dir, { theme: 'dark' }).theme, 'dark');
    assert.match(await builderAllowed('haiku', dir), /Allowed AI: none, set by your organisation/);
  } finally { if (saved === undefined) delete process.env.FOUNDRY_POLICY_FILE; else process.env.FOUNDRY_POLICY_FILE = saved; rmSync(dir, { recursive: true, force: true }); }
});

test('P1 B4: the doctor names a missing agent library and a missing browser in plain words', () => {
  const d = doctor({ workspace: mkdtempSync(path.join(tmpdir(), 'doc-')), env: { PATH: '/nonexistent' }, os: 'linux' });
  assert.ok(d.items.find(i => i.check === 'Agent connection library'));
  assert.match(d.items.find(i => i.check === 'Browser').say, /open --workspace/);
});

test('P3 B3-B4, P1 M9, P5 B1-B3: who decides is kept; approver answers are recorded and noted on the next list; drafts marked sent; evidence names who and checks', async () => {
  const s = await startSite();
  try {
    const p = await s.post('/api/propose', { template: 'expense-approval', settings: { autoApproveUpTo: 100, approver: 'maria@example.com' } });
    await s.post('/api/deciders', { flowId: p.flowId, choice: 'inform', who: 'maria@example.com' });
    assert.equal((await s.get(`/api/proposals/${p.proposalId}`)).decider.choice, 'inform', 'a reload keeps the answer');
    await s.post('/api/practice', { proposalId: p.proposalId });
    const req = await s.post('/api/request-approval', { proposalId: p.proposalId });
    await s.post('/api/decide', { kind: 'activation', approvalId: req.approvalId, decision: 'approve' });
    const csv = 'id,employee,email,amount,receipt,status\nR1,Lee,lee@x.example,749.99,yes,Pending\nR2,Ana,ana@x.example,20,yes,Pending\n';
    const pv = await s.post('/api/data/preview', { template: 'expense-approval', sheet: 'expenses', csv });
    await s.post('/api/data/commit', { template: 'expense-approval', sheet: 'expenses', csv, mapping: pv.mapping, answers: {}, target: 'live' });
    const b = await s.post('/api/batch/preview', { flowId: p.flowId });
    const made = await s.post('/api/batch/approve', { batchId: b.batchId });
    assert.equal(made.stoppedAt, null);
    const answers = await s.get(`/api/answers/${p.flowId}`);
    assert.deepEqual(answers.waiting.map(w => w.id), ['R1']);
    await s.post('/api/answers', { flowId: p.flowId, id: 'R1', answer: 'approved' });
    assert.equal((await s.get(`/api/answers/${p.flowId}`)).waiting[0].answer.answer, 'approved');
    const again = await s.post('/api/batch/preview', { flowId: p.flowId });
    assert.deepEqual(again.notes.map(n => n.kind).sort(), ['already-sent', 'answered'], 'the next list says R1 already went to Maria and was answered');
    const drafts = (await s.get('/api/drafts')).drafts;
    await s.post(`/api/drafts/${drafts[0].id}/sent`, { sent: true });
    assert.ok((await s.get('/api/drafts')).drafts.find(d => d.id === drafts[0].id).sent, '"I sent it" is kept in the workspace');
    const ev = (await s.get(`/api/evidence/${made.runId}`)).json;
    assert.match(ev.batch.decision.by, /@/); assert.ok(ev.batch.list.every(i => /^[a-f0-9]{64}$/.test(i.digest)));
    assert.ok(ev.actionDecisions.filter(x => x.type === 'approval.decided').every(x => x.fromList?.batchId === b.batchId), 'each applied yes names the list it came from');
    assert.equal(ev.personDecisions.check.ok, true); assert.ok(ev.personDecisions.lines.some(l => l.kind === 'list' && l.decision === 'approved'));
    assert.match(ev.turnedOn.by, /@/); assert.match(ev.run.startedBy, /@/);
    assert.equal(checkEvidence(ev).ok, true, JSON.stringify(checkEvidence(ev).problems));
    const bad = structuredClone(ev); bad.personDecisions.lines[0].decision = 'changed';
    assert.equal(checkEvidence(bad).ok, false);
    appendFileSync(path.join(s.dir, 'site', 'decisions.jsonl'), '{"seq":99,"hash":"x"}\n');
    assert.equal((await s.get('/api/decisions')).ok, false, 'an edited decision log is caught');
    const forgot = await s.post('/api/data/forget', { confirm: 'delete my lists' });
    assert.ok(forgot.deleted >= 1); assert.equal((await s.get(`/api/automations/${p.flowId}`)).data.expenses, null);
  } finally { await s.close(); }
});

test('P2 B3 in the site: the second list of the day shows only what is new, and the yes closes it', async () => {
  const s = await startSite({ asOf: () => NOW });
  try {
    const p = await s.post('/api/propose', { template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'me@example.com' } });
    await s.post('/api/practice', { proposalId: p.proposalId });
    const req = await s.post('/api/request-approval', { proposalId: p.proposalId });
    await s.post('/api/decide', { kind: 'activation', approvalId: req.approvalId, decision: 'approve' });
    const csv = fixture('invoices-accounting-export.csv');
    const pv = await s.post('/api/data/preview', { template: 'invoice-chase', sheet: 'invoices', csv });
    await s.post('/api/data/commit', { template: 'invoice-chase', sheet: 'invoices', csv, mapping: pv.mapping, answers: { 'dateOrder:due': 'dmy' }, target: 'live' });
    const first = await s.post('/api/batch/preview', { flowId: p.flowId });
    assert.equal(first.items.length, 4); assert.equal(first.notes[0].kind, 'firm-first');
    await s.post('/api/batch/approve', { batchId: first.batchId });
    const second = await s.post('/api/batch/preview', { flowId: p.flowId });
    assert.deepEqual(second.items.map(i => i.subject), ['Invoice reminders: summary']);
    const r = await s.post('/api/batch/approve', { batchId: second.batchId });
    assert.equal(r.stoppedAt, null); assert.equal((await s.get('/api/batches')).open.length, 0);
  } finally { await s.close(); }
});
