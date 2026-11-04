// CI-1 review arms: builders, retrieval swap, guards and the record scrub, on first-party synthetic fixtures with a scripted ModelPort
// ($0, no model, no bed, no corpus index: every test runs on a fresh clone).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadExamples } from '../../ci1/builders.mjs';
import { retrieve, HINTS } from '../../ci1/retrieve.mjs';
import { PracticeOneShotBuilder, makeBuilderFactoryR } from '../builders-r.mjs';
import { retrieveWith, staticCards, loadPatternsFrom, BLIND_HINTS } from '../retrieve-r.mjs';
import { stripAccountIdentity, diskStop, nonFixtureAddresses } from '../env-guard.mjs';
import { scrubRecordText, scrubJournal } from '../run-r.mjs';

const [overdue] = loadExamples();
const world = { id: 'p1', now: '2026-03-10T08:00:00Z', sheets: { tasks: { columns: overdue.workspace.sheets.tasks.columns, rows: [
  { task_id: 'T1', title: 'Fix roof', owner_email: 'a@x.example', due: '2026-03-01', status: 'open', reminded_on: '' },
  { task_id: 'T2', title: 'Order tiles', owner_email: 'b@x.example', due: '2026-03-02', status: 'DONE', reminded_on: '' }] } } };
function scriptedPort(script) {
  const calls = [];
  return { calls, call: async req => { calls.push(req); const v = script[req.nodeKey]; if (v === undefined) return { ok: false, error: { code: 'MODEL_UNAVAILABLE', message: `no script for ${req.nodeKey}` }, usage: {} };
    const value = typeof v === 'function' ? v(req) : v; return { ok: true, value: structuredClone(value), usage: { inputTokens: 1000, outputTokens: 100 }, costUsd: 0.0002 }; } };
}
const build = wf => ({ decision: 'build', reason: 'r', questions: [], workflow: wf });

test('A0p: a workflow that fails its practice run goes back with the run, a fixed one is ready; no review call is ever made', async () => {
  const crashes = structuredClone(overdue.workflow);
  crashes.nodes[1].source = 'export default function main(args) { throw new Error("boom"); }';
  const p = scriptedPort({ build: build(crashes), 'repair.r0': build(overdue.workflow) });
  const r = await new PracticeOneShotBuilder({ port: p }).build({ request: overdue.request, workspace: overdue.workspace, practiceWorld: world });
  assert.equal(r.status, 'ready');
  assert.deepEqual(p.calls.map(c => c.nodeKey), ['build', 'repair.r0']);
  assert.match(p.calls[1].prompt, /did not finish its practice run/);
  assert.doesNotMatch(p.calls[0].prompt, /Worked examples/, 'A0p has no worked examples');
  assert.equal(r.buildReport.practiceRuns.length, 2);
  assert.notEqual(r.buildReport.practiceRuns[0].status, 'succeeded');
  assert.equal(r.buildReport.practiceRuns[1].status, 'succeeded');
  // never fixed: build_failed after maxRepairs, and the validation path repairs too
  const p2 = scriptedPort({ build: build({ ...overdue.workflow, acceptance: [] }), 'repair.r0': build(crashes), 'repair.r1': build(crashes), 'repair.r2': build(crashes) });
  const r2 = await new PracticeOneShotBuilder({ port: p2 }).build({ request: overdue.request, workspace: overdue.workspace, practiceWorld: world });
  assert.equal(r2.status, 'build_failed');
  assert.deepEqual(r2.buildReport.repairs.map(x => x.kind), ['validation', 'practice-run', 'practice-run', 'practice-run']);
});

test('A0p asks or refuses like A0', async () => {
  const p = scriptedPort({ build: { decision: 'ask', reason: 'r', questions: [{ id: 'q1', question: 'Which channel?' }], workflow: {} } });
  assert.equal((await new PracticeOneShotBuilder({ port: p }).build({ request: 'x', workspace: overdue.workspace, practiceWorld: world })).status, 'needs_answers');
  const p2 = scriptedPort({ build: { decision: 'none', reason: 'cannot', questions: [], workflow: {} } });
  assert.equal((await new PracticeOneShotBuilder({ port: p2 }).build({ request: 'x', workspace: overdue.workspace, practiceWorld: world })).status, 'unsupported');
});

// a synthetic corpus index (no corpus file is read): three skeleton entries, one sharing the target's author
const index = { entries: [
  { id: 'c1', author: 'u1', hash: 'h1', features: ['a', 'b'], shape: ['trigger:schedule', 'effect:mail'], text: 'schedule read sheet send email reminder overdue', skeleton: '1 schedule -> 2\n2 sheet read -> 3\n3 send mail' },
  { id: 'c2', author: 'u2', hash: 'h2', features: ['c', 'd'], shape: ['trigger:webhook', 'effect:respond'], text: 'webhook validate respond', skeleton: '1 webhook -> 2\n2 respond' },
  { id: 'c3', author: 'u3', hash: 'h3', features: ['e', 'f'], shape: ['trigger:schedule', 'effect:sheet-write'], text: 'schedule update sheet mark done', skeleton: '1 schedule -> 2\n2 sheet update' },
  { id: 'target', author: 'u9', hash: 'h9', features: ['x', 'y'], shape: [], text: '', skeleton: '' }] };

test('retrieveWith with the ORIGINAL cards reproduces the frozen retrieve() exactly; with the blind cards only the cards differ', () => {
  const args = { request: overdue.request, workspace: overdue.workspace, targetId: 'target', index };
  const frozen = retrieve(args), same = retrieveWith({ ...args, hintsFile: HINTS }), blind = retrieveWith(args);
  assert.equal(same.block, frozen.block);
  assert.deepEqual(same.exemplars, frozen.exemplars);
  assert.deepEqual(blind.exemplars, frozen.exemplars, 'exemplars do not depend on the cards');
  assert.ok(!blind.exemplars.some(e => e.id === 'target'), 'leave-one-out');
  const blindHints = JSON.parse(readFileSync(BLIND_HINTS, 'utf8')).patterns;
  for (const p of blind.patterns) assert.ok(blind.block.includes(blindHints[p.id].hint), `${p.id} carries the blind hint`);
  assert.equal(blind.patterns.length, 3);
});

test('the blind cards cover the same 16 catalog patterns as the original cards and hold no address', () => {
  assert.deepEqual(loadPatternsFrom(BLIND_HINTS).map(p => p.id), loadPatternsFrom(HINTS).map(p => p.id));
  const text = readFileSync(BLIND_HINTS, 'utf8');
  assert.deepEqual(nonFixtureAddresses(text), []);
  const s = staticCards();
  assert.equal(s.patterns.length, 16); assert.deepEqual(s.exemplars, []);
  for (const p of loadPatternsFrom(BLIND_HINTS)) assert.ok(s.block.includes(p.hint));
});

test('A1cH puts every card in the compose prompt; A2b retrieves blind cards per item', async () => {
  const p = scriptedPort({ compose: build(overdue.workflow), 'review.r0': { verdict: 'ok', problems: [], workflow: {} } });
  const r = await makeBuilderFactoryR('A1cH', { port: p })({ id: 'x' }).build({ request: overdue.request, workspace: overdue.workspace, practiceWorld: world });
  assert.equal(r.status, 'ready');
  assert.equal((p.calls[0].prompt.match(/Pattern P\d\d "/g) ?? []).length, 16);
  assert.match(p.calls[0].prompt, /Worked examples/);
  assert.throws(() => makeBuilderFactoryR('A9', { port: p }), /unknown review arm/);
});

test('account guard: strips exactly the account variables; disk floor stops below 1.2 GB', () => {
  const env = { CLAUDE_CODE_USER_EMAIL: 'x@y.example', CLAUDE_CODE_ACCOUNT_UUID: 'u', CLAUDE_CODE_ORGANIZATION_UUID: 'o', CLAUDE_CODE_VERSION: '1', PATH: '/bin' };
  assert.deepEqual(stripAccountIdentity(env), ['CLAUDE_CODE_ACCOUNT_UUID', 'CLAUDE_CODE_ORGANIZATION_UUID', 'CLAUDE_CODE_USER_EMAIL']);
  assert.deepEqual(Object.keys(env).sort(), ['CLAUDE_CODE_VERSION', 'PATH']);
  assert.equal(diskStop('/x', 1.2e9, () => 2e9), null);
  assert.match(diskStop('/x', 1.2e9, () => 0.9e9), /0\.90 GB under the 1\.2 GB floor/);
});

test('records are scrubbed of non-fixture addresses before they are written; the journal is scrubbed same-length', () => {
  const rec = { workflow: { nodes: [{ args: { to: 'someone@nowhere.invalid' } }] }, note: 'ok a@b.example c@d.test' };
  const { text, redacted } = scrubRecordText(rec);
  assert.equal(redacted, 1);
  assert.doesNotMatch(text, /nowhere/); assert.match(text, /a@b\.example/); assert.match(text, /c@d\.test/);
  const dir = mkdtempSync(path.join(tmpdir(), 'ci1r-test-'));
  try {
    const f = path.join(dir, 'j.sqlite'), db = new DatabaseSync(f);
    db.exec('CREATE TABLE model_calls (id INTEGER PRIMARY KEY, response TEXT, n INTEGER)');
    const same = 'ow.person@corp.invalid'; // 22 characters, like requester@example.test
    assert.equal(same.length, 'requester@example.test'.length);
    db.prepare('INSERT INTO model_calls (response, n) VALUES (?, ?)').run(`the account is ${same} ok`, 1);
    db.prepare('INSERT INTO model_calls (response, n) VALUES (?, ?)').run('the other is x.y@a.invalid ok', 2);
    db.prepare('INSERT INTO model_calls (response, n) VALUES (?, ?)').run('nothing here', 3);
    db.close();
    assert.equal(scrubJournal(f, same), 1);
    assert.equal(scrubJournal(f, 'x.y@a.invalid'), 1, 'another length falls back to the redaction marker');
    const bytes = readFileSync(f);
    assert.equal(bytes.includes(Buffer.from(same)), false, 'no copy left in free pages (VACUUM)');
    const back = new DatabaseSync(f), rows = back.prepare('SELECT response FROM model_calls ORDER BY n').all().map(r => r.response); back.close();
    assert.deepEqual(rows, ['the account is requester@example.test ok', 'the other is <redacted-address> ok', 'nothing here']);
    assert.equal(scrubJournal(f, null), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
