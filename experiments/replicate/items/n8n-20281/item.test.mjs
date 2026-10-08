// Tests of the R-bench harness for n8n:20281: frozen fixtures, determinism, no leakage, the mock services, the environment, the oracle's health
// (known-good passes, every known-bad control fails, schema-invalid output is rejected) and the original definition run in the emulator.
//   node --test experiments/replicate/items/n8n-20281/item.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import * as bed from './index.mjs';
import { build, refOf } from './build-fixtures.mjs';
import { snapshot as freezeSnapshot, taskHashes } from './freeze.mjs';
import { readJson, configFor, filterReason, threadLabelOf, CONFIG_PRESETS, THRESHOLDS, SHEET_COLUMNS } from './spec.mjs';
import { fixtures, coreOrder, scenariosFor } from './scenarios.mjs';
import { createEnv, replay, driveSync, API_OPS } from './env.mjs';
import { Jira } from './mocks/jira.mjs';
import { Slack, broadcastsIn } from './mocks/slack.mjs';
import { Teams } from './mocks/teams.mjs';
import { Sheets } from './mocks/sheets.mjs';
import { Gmail } from './mocks/gmail.mjs';
import { Outlook } from './mocks/outlook.mjs';
import { Model } from './mocks/model.mjs';
import { World } from './mocks/world.mjs';
import { oracle, CODES, claimOf, routeOfClaim } from './oracle.mjs';
import { makeFaithful } from './controls/reference.mjs';
import { makeImproved } from './controls/improved.mjs';
import { runKeywordSolution } from './controls/heuristic.mjs';
import { originalAvailable, loadOriginal, rebind, makeOriginalHandler, analyse } from './controls/n8n-emulator.mjs';
import { canonical, hashOf } from '../../../../beds/lib/canonical.mjs';

const task = (seed, difficulty = 3, variant = 'T2', split = 'dev') => bed.generate({ seed, split, difficulty, variant });
const seeds = n => Array.from({ length: n }, (_, i) => i);
const FX = fixtures();
const L = FX.labels.scored;

describe('frozen fixtures', () => {
  test('the files equal the freeze and a rebuild from the authored source', () => {
    const frozen = readJson('./fixtures/FREEZE.json');
    assert.equal(frozen.beforeFirstRun, true);
    assert.deepEqual(freezeSnapshot().files, frozen.files);
    assert.deepEqual(frozen.thresholds, THRESHOLDS);
    const built = build();
    assert.deepEqual(built.emails, FX.emails); assert.deepEqual(built.labels, FX.labels); assert.deepEqual(built.seed, FX.seed); assert.deepEqual(built.recordings, FX.recordings);
    assert.deepEqual(built.examples, readJson('./fixtures/example-mails.json'));
  });
  test('the canonical tasks (text, presets, order, T3 baseline and targets) equal the pinned hashes', async () => {
    const frozen = readJson('./fixtures/FREEZE.json');
    assert.deepEqual(await taskHashes(), frozen.tasks);
  });
  test('thresholds are the pilot plan\'s', () => { assert.equal(THRESHOLDS.categoryAccuracy, 0.85); assert.equal(THRESHOLDS.priorityAccuracy, 0.80); });
  test('80 mails: 15 filtered, 10 follow-ups on seeded tickets, 10 ambiguous, 2 model failures, both providers', () => {
    const ids = Object.keys(L);
    assert.equal(ids.length, 80); assert.equal(FX.emails.scored.length, 80);
    const count = f => ids.filter(i => f(L[i])).length;
    assert.equal(count(l => l.filtered), 15);
    assert.equal(count(l => l.dup), 10);
    assert.equal(count(l => l.amb), 10);
    assert.equal(count(l => l.fault), 2);
    assert.equal(count(l => l.route === 'ticket-followup'), 15);
    const prov = FX.emails.scored.map(e => e.provider);
    assert.ok(prov.includes('gmail') && prov.includes('outlook'));
    assert.equal(FX.emails.scored.filter(e => e.provider === 'outlook').length, 35);
  });
  test('the filter rules reproduce the filtered labels exactly, at every difficulty', () => {
    for (const d of [1, 2, 3, 4, 5]) {
      const cfg = configFor(d);
      for (const e of FX.emails.scored) {
        const addr = e.provider === 'gmail' ? e.mail.from.value[0].address : e.mail.from.emailAddress.address;
        assert.equal(!!filterReason(addr, cfg), L[e.caseId].filtered, `${e.caseId} ${addr} d${d}`);
      }
    }
  });
  test('mail ids, thread ids and reference tokens are unique per mail; the token is in the new text, above any quoted history', () => {
    const ids = FX.emails.scored.map(e => e.mail.id), refs = FX.emails.scored.map(e => e.ref);
    assert.equal(new Set(ids).size, 80); assert.equal(new Set(refs).size, 80);
    for (const e of FX.emails.scored) {
      const text = e.provider === 'gmail' ? e.mail.text : e.mail.body.content;
      assert.ok(text.includes(e.ref), e.caseId);
      const q = text.search(e.provider === 'gmail' ? /\n\nOn .* wrote:/ : /<hr>/);
      if (q >= 0) assert.ok(text.indexOf(e.ref) < q, `${e.caseId}: token below the quote`);
      assert.equal(e.ref, refOf(e.caseId));
    }
  });
  test('threads: follow-ups share the thread of the mail they follow; seeded tickets belong to the threads of their follow-ups', () => {
    const byId = Object.fromEntries(FX.emails.scored.map(e => [e.caseId, e]));
    const tid = e => (e.provider === 'gmail' ? e.mail.threadId : e.mail.conversationId);
    for (const [id, l] of Object.entries(L)) {
      if (l.follows) assert.equal(tid(byId[id]), tid(byId[l.follows]), id);
      if (l.dup) { const seed = FX.seed.tickets.find(t => t.id === l.dup); assert.equal(seed.threadId, tid(byId[id]), id); assert.notEqual(seed.statusCategory, 'done'); }
      if (l.doneBefore) assert.equal(FX.seed.tickets.find(t => t.id === l.doneBefore).statusCategory, 'done');
    }
  });
  test('recorded classifier: standard tier lands near the thresholds, small tier below them, confidence is informative', () => {
    const rec = FX.recordings.byRef;
    const nf = FX.emails.scored.filter(e => !L[e.caseId].filtered);
    const acc = (tier, k) => nf.filter(e => { const r = rec[e.ref]; if (r.fail === 'permanent') return false; return r[tier][k === 'cat' ? 1 : 2] === (k === 'cat' ? L[e.caseId].cat : L[e.caseId].pri); }).length / nf.length;
    assert.ok(acc('standard', 'cat') >= 0.85 && acc('standard', 'pri') >= 0.80, `standard ${acc('standard', 'cat')} ${acc('standard', 'pri')}`);
    assert.ok(acc('small', 'cat') < 0.85, `small category ${acc('small', 'cat')}`);
    for (const e of nf) { const l = L[e.caseId]; if (l.amb) assert.ok(rec[e.ref].standard[3] < 0.6, e.caseId); else if (l.cr) assert.ok(rec[e.ref].standard[3] >= 0.7, e.caseId); }
  });
});

describe('task generation', () => {
  test('deterministic, and contract-shaped', () => {
    for (const v of ['T1', 'T2', 'T3']) assert.equal(canonical(task(5, 3, v)), canonical(task(5, 3, v)));
    assert.equal(bed.family.kind, 'interactive');
    for (const n of ['family', 'outputSchema', 'generate', 'oracle', 'referenceSolve', 'badControls', 'createEnv']) assert.ok(n in bed, n);
    assert.ok(bed.badControls.length >= 30 && bed.badControls.every(c => c.name && typeof c.make === 'function' && c.expect.length));
    for (const n of ['empty', 'do-nothing', 'everything-bug', 'no-dedupe', 'ack-wrong-mode', 'priority-shift', 'low-threshold']) assert.ok(bed.badControls.some(c => c.name === n), n);
  });
  test('rejects bad parameters', () => {
    assert.throws(() => bed.generate({ seed: 1, split: 'x', difficulty: 3, variant: 'T2' }));
    assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 0, variant: 'T2' }));
    assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 3, variant: 'T9' }));
    assert.throws(() => bed.generate({ seed: 1.5, split: 'dev', difficulty: 3, variant: 'T2' }));
  });
  test('what each variant gives the solver', () => {
    const t1 = task(1, 3, 'T1'), t2 = task(1, 3, 'T2'), t3 = task(1, 3, 'T3');
    assert.ok(t1.attachments?.[0].sha256 === bed.ORIGINAL.sha256 && !t1.inputs.description && !t1.inputs.examples);
    assert.ok(t2.inputs.description && t2.inputs.examples.examples.length === 10 && !t2.attachments);
    assert.ok(t3.attachments && t3.inputs.description && !t3.inputs.examples && t3.budget.target.modelUsdMax > 0 && t3.budget.baseline.externalCalls > 0);
    for (const t of [t1, t2, t3]) { assert.ok(t.prompt.length > 500); assert.equal(t.inputs.config.jiraProjectKey, configFor(3).jiraProjectKey); assert.ok(t.files['handler.mjs']); }
    assert.ok(t3.budget.target.modelUsdMax < t3.budget.baseline.modelUsd * 0.5);
  });
  test('difficulty selects the deployment preset; the dev/test split and the seed change the delivery order only', () => {
    assert.equal(task(1, 1).inputs.config.ackMode, 'off'); assert.equal(task(1, 2).inputs.config.ackMode, 'send'); assert.equal(task(1, 3).inputs.config.ackMode, 'draft');
    assert.equal(task(1, 4).inputs.config.minConfidence, 0.7); assert.equal(task(1, 5).inputs.config.jiraProjectKey, 'HELP');
    const a = coreOrder(1, 'dev'), b = coreOrder(2, 'dev'), c = coreOrder(1, 'test');
    assert.notDeepEqual(a, b); assert.notDeepEqual(a, c);
    assert.deepEqual([...a].sort(), [...b].sort());
  });
  test('a follow-up never arrives before the mail it follows (20 seeds)', () => {
    for (const s of seeds(20)) { const o = coreOrder(s, 'dev'); for (const [id, l] of Object.entries(L)) if (l.follows) assert.ok(o.indexOf(l.follows) < o.indexOf(id), `${s} ${id}`); }
  });
  test('truth does not leak into the task or the events a solver sees', () => {
    const labelWords = ['ticket-new', 'ticket-followup', '"amb"', '"fault"', 'caseId', 'doneBefore', '"follows"', '"plain"'];
    for (const v of ['T1', 'T2', 'T3']) {
      const text = JSON.stringify(task(2, 3, v));
      for (const w of labelWords) assert.ok(!text.includes(w), `${v}: ${w}`);
      for (const e of FX.emails.scored) { assert.ok(!text.includes(e.mail.id), `${v}: scored mail id in the task`); assert.ok(!text.includes(e.ref), `${v}: scored ref in the task`); }
      for (const s of FX.seed.tickets) assert.ok(!text.includes(`${configFor(3).jiraProjectKey}-${s.n}`), `${v}: seeded ticket key ${s.n}`);
    }
    const env = createEnv(task(2, 3, 'T3')); let obs = env.reset(); let n = 0;
    const forbidden = new Set(['caseId', 'plain', 'labels', 'route', 'ref', 'thread', 'filtered']);
    const keysOf = v => (v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);
    while (!obs.done && n < 200) { assert.deepEqual(Object.keys(obs.event), ['seq', 'trigger', 'at', 'data']); for (const k of keysOf(obs.event)) assert.ok(!forbidden.has(k), k); obs = env.step({ call: 'done' }).observation; n++; }
  });
  test('generate and oracle stay within the contract\'s limits at the largest size', () => {
    let t0 = Date.now(); const t = task(9, 5, 'T3'); assert.ok(Date.now() - t0 < 2000, `generate ${Date.now() - t0} ms`);
    const out = bed.referenceSolve(t); t0 = Date.now(); bed.oracle(t, out); assert.ok(Date.now() - t0 < 2000, `oracle ${Date.now() - t0} ms`);
    assert.ok(process.memoryUsage().rss < 400e6);
  });
});

describe('mock services', () => {
  const cfg = configFor(3);
  const mkJira = (faults = {}) => new Jira({ projectKey: 'SUP', issueTypes: ['Bug', 'Task', 'Story'], nextNumber: 100, faults,
    seedTickets: [{ n: 1, fields: { project: { key: 'SUP' }, issuetype: { name: 'Bug' }, summary: 'open one', description: '', labels: ['customer-email', 'bug', 'email-thread-aaa'], priority: { name: 'High' }, status: { name: 'To Do', statusCategory: { key: 'new', name: 'To Do' } }, created: 'x' } },
      { n: 2, fields: { project: { key: 'SUP' }, issuetype: { name: 'Bug' }, summary: 'done one', description: '', labels: ['email-thread-aaa'], priority: { name: 'High' }, status: { name: 'Done', statusCategory: { key: 'done', name: 'Done' } }, created: 'x' } }] });
  const good = { project: { key: 'SUP' }, issuetype: { name: 'Task' }, summary: 's', description: 'd', labels: ['customer-email', 'issue'] };

  test('Jira: JQL subset, status category, ordering, limit, field projection', () => {
    const j = mkJira();
    const open = j.search({ jql: 'labels = "email-thread-aaa" AND statusCategory != Done ORDER BY created DESC', fields: 'key,status', limit: 1 });
    assert.equal(open.status, 200); assert.equal(open.body.total, 1); assert.equal(open.body.issues[0].key, 'SUP-1'); assert.deepEqual(Object.keys(open.body.issues[0].fields), ['status']);
    assert.equal(j.search({ jql: 'labels = "email-thread-aaa"' }).body.total, 2);
    assert.equal(j.search({ jql: 'labels in ("email-thread-aaa", "x") AND statusCategory = Done' }).body.issues[0].key, 'SUP-2');
    assert.equal(j.search({ jql: 'labels = "nope"' }).body.total, 0);
    for (const bad of ['text ~ "hello"', 'labels = ', 'assignee = me', 'labels = "a" OR labels = "b"', 'labels = "a" ORDER BY priority']) assert.equal(j.search({ jql: bad }).status, 400, bad);
  });
  test('Jira: create validation, key sequence, comments', () => {
    const j = mkJira();
    assert.equal(j.createIssue({ fields: good }).body.key, 'SUP-100'); assert.equal(j.createIssue({ fields: good }).body.key, 'SUP-101');
    for (const [name, patch] of Object.entries({ project: { project: { key: 'X' } }, type: { issuetype: { name: 'Epic' } }, summary: { summary: '' }, longSummary: { summary: 'x'.repeat(256) }, labels: { labels: ['has space'] }, priority: { priority: { name: 'Urgent' } }, unknown: { components: [] } })) {
      const r = j.createIssue({ fields: { ...good, ...patch } }); assert.equal(r.status, 400, name); assert.ok(r.body.errors);
    }
    assert.equal(j.addComment({ issueKey: 'SUP-100', body: 'hi' }).status, 201);
    assert.equal(j.addComment({ issueKey: 'SUP-999', body: 'hi' }).status, 404); assert.equal(j.addComment({ issueKey: 'SUP-100', body: ' ' }).status, 400);
    assert.equal(j.getIssue({ key: 'SUP-100' }).body.comments, 1);
  });
  test('Jira: search-index lag hides new tickets for the next N searches; a lost acknowledgement still commits', () => {
    const j = mkJira({ lagSearches: 2, createAckLost: [0] });
    const r = j.createIssue({ fields: { ...good, labels: ['t-lag'] } });
    assert.equal(r.status, 504); assert.equal(j.dump().length, 3);
    assert.equal(j.search({ jql: 'labels = "t-lag"' }).body.total, 0); assert.equal(j.search({ jql: 'labels = "t-lag"' }).body.total, 0);
    assert.equal(j.search({ jql: 'labels = "t-lag"' }).body.total, 1);
    assert.equal(j.getIssue({ key: 'SUP-100' }).status, 200);                      // a direct read is consistent
  });
  test('Slack: channel by name, errors, mentions are detected', () => {
    const s = new Slack({ channels: ['a'] });
    assert.equal(s.postMessage({ channel: '#a', text: 'x' }).body.ok, true); assert.equal(s.postMessage({ channel: 'zzz', text: 'x' }).body.error, 'channel_not_found'); assert.equal(s.postMessage({ channel: 'a', text: '' }).body.ok, false);
    assert.deepEqual(broadcastsIn('hi <!channel> and <!here|here> <!everyone> <!subteam^S123>'), ['<!channel>', '<!here|here>', '<!everyone>', '<!subteam^S123>']); assert.deepEqual(broadcastsIn('plain @channel'), []);
  });
  test('Teams: only the configured webhook and an Adaptive Card message', () => {
    const t = new Teams({ webhookUrl: 'https://h/x' });
    const card = { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { body: [] } }] };
    assert.equal(t.post({ url: 'https://h/x', body: card }).status, 202); assert.equal(t.post({ url: 'https://h/y', body: card }).status, 404); assert.equal(t.post({ url: 'https://h/x', body: { text: 'x' } }).status, 400);
    assert.equal(new Teams({ webhookUrl: '' }).post({ url: '', body: card }).status, 404);
  });
  test('Sheets: unknown columns rejected, transient failure writes nothing', () => {
    const s = new Sheets({ faults: { fail503: [1] } });
    assert.equal(s.appendRow({ row: { Category: 'Bug' } }).status, 200); assert.equal(s.appendRow({ row: { Category: 'Bug' } }).status, 503); assert.equal(s.state.rows.length, 1);
    assert.equal(s.appendRow({ row: { Nope: 1 } }).status, 400); assert.equal(s.appendRows({ rows: [{ 'Message ID': 'a' }, { 'Message ID': 'b' }] }).body.updates.updatedRows, 2); assert.equal(s.state.rows.length, 3);
    assert.equal(Object.keys(s.state.rows[0]).length, SHEET_COLUMNS.length);
  });
  test('Gmail and Outlook: reply-all versus sender only, drafts versus sends', () => {
    const msgs = [{ id: 'm1', threadId: 't1', fromEmail: 'Cust@x.example', to: ['support@brightlane.example'], cc: ['col@x.example'], subject: 'Hi' }];
    const g = new Gmail({ messages: msgs, ownAddress: 'support@brightlane.example' });
    assert.deepEqual(g.reply({ messageId: 'm1', text: 't', replyToSenderOnly: true }).body.cc, []); assert.deepEqual(g.reply({ messageId: 'm1', text: 't' }).body.cc, ['col@x.example']); assert.equal(g.reply({ messageId: 'zz', text: 't' }).status, 404);
    assert.equal(g.createDraft({ to: 'a@b.example', subject: 's', text: 't', threadId: 't1' }).status, 200); assert.equal(g.createDraft({ to: 'a@b.example', subject: 's', text: 't', threadId: 'nope' }).status, 404); assert.equal(g.createDraft({ to: 'bad', subject: 's', text: 't' }).status, 400);
    assert.equal(g.state.sent.length, 2); assert.equal(g.state.drafts.length, 1); assert.equal(g.state.sent[0].to[0], 'cust@x.example');
    const o = new Outlook({ messages: msgs, ownAddress: 'support@brightlane.example' });
    assert.equal(o.reply({ messageId: 'm1', comment: '<p>x</p>', saveAsDraft: true }).status, 201); assert.equal(o.reply({ messageId: 'm1', comment: '<p>x</p>', replyToSenderOnly: true }).status, 202);
    assert.equal(o.state.drafts.length, 1); assert.equal(o.state.sent.length, 1); assert.deepEqual(o.state.sent[0].cc, []);
  });
  test('Model: recognises the mail by its token, charges tokens, fails on request, projects the schema', () => {
    const e = FX.emails.scored.find(x => x.caseId === 'b04'), m2 = FX.emails.scored.find(x => x.caseId === 'm01'), m3 = FX.emails.scored.find(x => x.caseId === 'm02');
    const info = Object.fromEntries(FX.emails.scored.map(x => [x.ref, { subject: x.mail.subject, fromName: 'N', company: 'C', plain: x.plain }]));
    const m = new Model({ recordings: FX.recordings.byRef, infoByRef: info });
    const full = m.complete({ prompt: `Classify. ${e.ref}` });
    assert.equal(full.status, 200); assert.equal(full.body.content.category, 'Bug'); assert.equal(full.body.content.priority, 'Critical'); assert.ok(full.body.usage.inputTokens > 0 && full.body.costUsd > 0);
    const slim = m.complete({ prompt: `x ${e.ref}`, schema: { properties: { category: {}, confidence: {} } } });
    assert.deepEqual(Object.keys(slim.body.content), ['category', 'confidence']); assert.ok(slim.body.costUsd < full.body.costUsd);
    assert.ok(m.complete({ prompt: `x ${e.ref}`, tier: 'small' }).body.costUsd < full.body.costUsd);
    assert.equal(m.complete({ prompt: 'no mail here' }).status, 422); assert.equal(m.complete({ prompt: `${e.ref} ${m2.ref}` }).status, 422); assert.equal(m.complete({ prompt: e.ref, tier: 'huge' }).status, 400);
    assert.equal(m.complete({ prompt: m2.ref }).status, 500); assert.equal(m.complete({ prompt: m2.ref }).status, 500);
    assert.equal(m.complete({ prompt: m3.ref }).status, 503); assert.equal(m.complete({ prompt: m3.ref }).status, 200);
  });
  test('World: state port is compare-and-swap; snapshots restore exactly; unknown calls are refused', () => {
    const t = task(1, 3, 'T2'); const sc = scenariosFor({ seed: 1, split: 'dev', difficulty: 3, variant: 'T2' }).scenarios[0];
    const w = new World({ config: cfg, entries: sc.entries, recordings: FX.recordings, seeds: sc.seeds, nextIssueNumber: 1100 });
    assert.equal(w.call('state.put', { key: 'k', value: 1, ifVersion: 0 }).response.status, 200); assert.equal(w.call('state.put', { key: 'k', value: 2, ifVersion: 0 }).response.status, 409);
    assert.equal(w.call('state.get', { key: 'k' }).response.body.value, 1);
    const snap = w.snapshot(); w.call('jira.createIssue', { fields: { project: { key: 'SUP' }, issuetype: { name: 'Bug' }, summary: 's', labels: [] } }); assert.equal(w.dump().jira.length, 16);
    w.restore(snap); assert.equal(w.dump().jira.length, 15); assert.equal(w.call('nope.nope', {}).response.status, 400); assert.ok(t);
  });
});

describe('environment', () => {
  test('a run per mail; snapshot and restore reproduce the episode', () => {
    const t = task(4, 3, 'T3'), cfg = configFor(3), h = makeFaithful(cfg);
    const play = (env, from) => {
      let obs = from; const mk = c => env.step(c);
      const api = { call: (name, args) => mk({ call: name, args }).observation.response };
      for (const name of API_OPS) { const [svc, op] = name.split('.'); (api[svc] ??= {})[op] = args => api.call(name, args); }
      while (!obs.done) { h(obs.event, api); obs = env.step({ call: 'done' }).observation; }
    };
    const env = createEnv(t); let obs = env.reset();
    const api = { call: (name, args) => env.step({ call: name, args }).observation.response };
    for (const name of API_OPS) { const [svc, op] = name.split('.'); (api[svc] ??= {})[op] = args => api.call(name, args); }
    for (let i = 0; i < 25; i++) { h(obs.event, api); obs = env.step({ call: 'done' }).observation; }
    const snap = env.snapshot();
    play(env, obs); const a = JSON.stringify(env.record().actions), da = JSON.stringify(env._records().map(r => r.dump));
    env.restore(snap); play(env, env.observe()); const b = JSON.stringify(env.record().actions), db = JSON.stringify(env._records().map(r => r.dump));
    assert.equal(a, b); assert.equal(da, db);
  });
  test('call caps per mail are enforced and flagged', () => {
    const t = task(1, 3, 'T2');
    const rec = driveSync(t, (e, api) => { for (let i = 0; i < 70; i++) api.state.get({ key: 'x' }); });
    const r = oracle(t, rec);
    assert.ok(r.details.violationsByCode.NO_ANSWER >= 80 || r.details.violationsByCode.NO_ANSWER > 0);
    const env = replay(t, rec.actions).env; assert.equal(env._records()[0].events[0].capped, true);
  });
  test('unknown and malformed calls are answered with an error and change nothing', () => {
    const env = createEnv(task(1, 3, 'T2')); env.reset();
    assert.equal(env.step({ call: 'jira.deleteEverything' }).observation.response.status, 400); assert.equal(env.step({}).observation.response.status, 400);
    assert.equal(env._records()[0].events[0].calls.every(c => (c.effects ?? []).length === 0), true);
  });
  test('T3 adds exactly the five probe scenarios; T1 and T2 do not', () => {
    assert.deepEqual(scenariosFor({ seed: 1, split: 'dev', difficulty: 3, variant: 'T3' }).scenarios.map(s => s.id), ['core', 'probe-create-ack-lost', 'probe-search-lag', 'probe-sheet-503', 'probe-redelivery', 'probe-mention-injection']);
    for (const v of ['T1', 'T2']) assert.deepEqual(scenariosFor({ seed: 1, split: 'dev', difficulty: 3, variant: v }).scenarios.map(s => s.id), ['core']);
  });
  test('a live model: the episode keeps the observed answers (modelTape) and the oracle replays them', () => {
    const t = task(2, 3, 'T2'), cfg = configFor(3);
    const full = { isCustomerRequest: true, category: 'Bug', priority: 'High', confidence: 0.9, productArea: 'API', title: 't', summary: 's', customerName: 'n', customerCompany: 'c', sentiment: 'Neutral', stepsToReproduce: '', reasoning: '' };
    const backend = () => ({ status: 200, body: { content: full, usage: { inputTokens: 100, outputTokens: 50 }, costUsd: 0.001 }, latencyMs: 900 });
    const rec = driveSync(t, makeFaithful(cfg), { modelBackend: backend });
    assert.ok(rec.modelTape.length > 0);
    const withTape = oracle(t, rec), withoutTape = oracle(t, { actions: rec.actions });
    assert.equal(withTape.details.cost.model.usd, Number((rec.modelTape.length * 0.001).toFixed(6)));
    assert.notEqual(withoutTape.details.cost.model.usd, withTape.details.cost.model.usd);
    assert.equal(withTape.details.gates.categoryAccuracy, false);                   // the live model called everything a Bug
  });
});

describe('oracle health', () => {
  test('known-good: the faithful transcription passes (20 seeds at the default size, 3 seeds at every other difficulty)', () => {
    for (const s of seeds(20)) { const t = task(s, 3); const r = oracle(t, bed.referenceSolve(t)); assert.ok(r.pass, `seed ${s}: ${JSON.stringify(r.details.firstViolations)}`); assert.equal(r.score, 1); }
    for (const d of [1, 2, 4, 5]) for (const s of seeds(3)) { const t = task(s, d); const r = oracle(t, bed.referenceSolve(t)); assert.ok(r.pass, `d${d} seed ${s}: ${JSON.stringify(r.details.firstViolations)}`); }
  });
  test('known-good: the improved T3 solution passes core, probes and targets (5 seeds, difficulties 1, 3, 5)', () => {
    for (const d of [1, 3, 5]) for (const s of seeds(5)) { const t = task(s, d, 'T3'); const r = oracle(t, bed.referenceSolve(t)); assert.ok(r.pass, `d${d} seed ${s}: ${JSON.stringify(r.details.probes)} ${JSON.stringify(r.details.cost)}`); assert.ok(r.details.probes.every(p => p.pass)); }
  });
  test('the faithful flow fails T3: all five probes and the cost target (this is what T3 improves)', () => {
    for (const s of seeds(3)) { const t = task(s, 3, 'T3'); const r = oracle(t, driveSync(t, makeFaithful(configFor(3)))); assert.equal(r.pass, false); assert.equal(r.details.corePass, true); assert.deepEqual(r.details.probes.map(p => p.pass), [false, false, false, false, false]); assert.equal(r.details.costOk, false); }
  });
  test('every known-bad control fails (20 seeds at its difficulties) and shows the violation or gate it was built to show', () => {
    for (const c of bed.badControls) {
      const hits = Object.fromEntries(c.expect.map(e => [e, 0]));
      for (const d of c.appliesAt ?? [3]) for (const s of seeds(d === 3 || (c.appliesAt ?? [3]).length === 1 ? 20 : 4)) {
        const t = task(s, d, 'T2'); const r = oracle(t, c.make(t));
        assert.equal(r.pass, false, `${c.name} d${d} seed ${s} passed`);
        const seen = new Set([...Object.keys(r.details.violationsByCode), ...Object.entries(r.details.gates).filter(([, v]) => !v).map(([k]) => `gate:${k}`)]);
        for (const e of c.expect) if (seen.has(e)) hits[e]++;
      }
      for (const [e, n] of Object.entries(hits)) assert.ok(n > 0, `${c.name}: expected ${e} never seen`);
    }
  });
  test('every violation code of the oracle is exercised by some control or probe', () => {
    const seen = new Set();
    for (const c of bed.badControls) for (const d of c.appliesAt ?? [3]) { const t = task(0, d, 'T3'); for (const k of Object.keys(oracle(t, c.make(t)).details.violationsByCode)) seen.add(k); }
    const t = task(0, 3, 'T3'); for (const k of Object.keys(oracle(t, driveSync(t, makeFaithful(configFor(3)))).details.violationsByCode)) seen.add(k);
    assert.deepEqual(Object.keys(CODES).filter(k => !seen.has(k)), []);
  });
  test('trivial solutions fail: empty answer, do-nothing, and a keyword rule that never calls a model', () => {
    const t = task(0, 3);
    assert.equal(oracle(t, { actions: [] }).pass, false); assert.equal(oracle(t, driveSync(t, () => {})).pass, false);
    for (const s of seeds(5)) { const tt = task(s, 3); const r = oracle(tt, runKeywordSolution(tt)); assert.equal(r.pass, false); assert.ok(r.details.accuracy.category < THRESHOLDS.categoryAccuracy); assert.ok(r.details.accuracy.priority < THRESHOLDS.priorityAccuracy); }
  });
  test('schema-invalid output is rejected', () => {
    const t = task(0, 3);
    for (const bad of [null, 'x', [], {}, { actions: 'x' }, { actions: [{}] }, { actions: [{ call: 5 }] }, { actions: [{ call: 'done', args: [] }] }, { actions: [{ call: 'x'.repeat(65) }] }]) {
      const r = oracle(t, bad); assert.equal(r.pass, false); assert.equal(r.score, 0); assert.ok(r.details.schemaInvalid, JSON.stringify(bad));
    }
  });
  test('the verdict depends on the actions only: meta is ignored, a missing done is an unanswered run, the claim must match the effects', () => {
    const t = task(3, 3), ref = bed.referenceSolve(t);
    assert.deepEqual(oracle(t, { ...ref, meta: { anything: 1 } }), oracle(t, ref));
    const cut = oracle(t, { actions: ref.actions.slice(0, ref.actions.length - 40) }); assert.equal(cut.pass, false); assert.ok(cut.details.unanswered > 0);
    const noSlack = oracle(t, { actions: ref.actions.filter(a => a.call !== 'slack.postMessage') }); assert.equal(noSlack.pass, false); assert.ok(noSlack.details.violationsByCode.SLACK_COUNT > 0);
    const noRows = oracle(t, { actions: ref.actions.filter(a => !a.call.startsWith('sheets.')) }); assert.equal(noRows.pass, false);
  });
  test('the oracle is deterministic', () => { const t = task(6, 4, 'T3'); const o = bed.referenceSolve(t); assert.equal(canonical(oracle(t, o)), canonical(oracle(t, o))); });
  test('the claim rule: routing is a function of the audit row alone', () => {
    const cfg = configFor(3);
    const row = o => claimOf({ 'Customer Request': 'Yes', Category: 'Bug', Priority: 'High', Confidence: '0.9', ...o });
    assert.equal(routeOfClaim(row({}), cfg), 'escalate'); assert.equal(routeOfClaim(row({ Confidence: '0.59' }), cfg), 'review'); assert.equal(routeOfClaim(row({ Confidence: '0.6' }), cfg), 'escalate');
    assert.equal(routeOfClaim(row({ Category: 'Unclassified', Confidence: '0' }), cfg), 'review'); assert.equal(routeOfClaim(row({ 'Customer Request': 'No' }), cfg), 'ignore');
    assert.equal(routeOfClaim(row({ Category: 'Other' }), cfg), 'ignore'); assert.equal(row({ Category: 'Defect' }).valid, false); assert.equal(row({ Confidence: '' }).valid, false);
  });
  test('T2 sufficiency: the worked examples show every convention the oracle enforces', () => {
    const ex = task(1, 3, 'T2').inputs.examples.examples.map(e => e.outcome);
    assert.ok(ex.some(o => o.jira?.created?.issuetype === 'Bug' && o.jira.created.labels.some(l => /^email-thread-/.test(l)) && o.jira.created.labels.includes('bug') && o.jira.created.labels.includes('customer-email')));
    assert.ok(ex.some(o => o.jira?.created?.issuetype === 'Story') && ex.some(o => o.jira?.created?.issuetype === 'Task'));
    assert.ok(ex.some(o => o.jira?.created?.priority === 'Highest') && ex.some(o => o.jira?.commentedOn) && ex.some(o => o.slack.some(s => /^support-bugs/.test(s.channel)) ) );
    assert.ok(ex.filter(o => o.modelCalls === 0 && !o.jira && o.slack.length === 0).length >= 2, 'skipped senders');
    assert.ok(ex.some(o => o.slack.some(s => s.channel === 'triage-review')) && ex.some(o => o.modelAnswer?.category === 'Other' && !o.jira));
    assert.ok(ex.some(o => o.reply.some(r => r.kind === 'sent' && r.through === 'gmail')) && ex.some(o => o.reply.some(r => r.through === 'outlook')));
    assert.ok(ex.some(o => o.jira?.commentedOn && o.reply.length === 0), 'a follow-up is not acknowledged');
    assert.ok(ex.some(o => o.slack.some(s => s.text.includes('<!channel>'))), 'the Critical ping');
    assert.ok(ex.every(o => Object.keys(o.auditRow).length === SHEET_COLUMNS.length));
  });
});

describe('the original definition (executed in the emulator)', { skip: originalAvailable() ? false : 'corpus file /opt/corpus/n8n/workflows/20281.json.gz not present' }, () => {
  const def = originalAvailable() ? loadOriginal() : null;
  test('the pinned file is the analysed one: facts about the published definition', () => {
    const a = analyse(def);
    assert.equal(a.nodes, 48); assert.equal(a.stickyNotes, 21); assert.equal(a.codeNodes, 15); assert.equal(a.expressions, 40);
    assert.equal(a.hasExecuteWorkflowTrigger, false); assert.equal(a.hasErrorTrigger, false);
    assert.ok(a.nodesWithoutInboundEdge.includes('Route by Workflow Step') && a.nodesWithoutInboundEdge.includes('Create Error Alert Message'));
    assert.deepEqual(a.retryOnFail, [{ node: 'AI Email Classifier', maxTries: 3 }, { node: 'Post New Jira Issue', maxTries: 2 }]);
    assert.equal(a.codeScanClean, true);
  });
  test('it passes the oracle at every difficulty (the original-passes control)', () => {
    for (const d of [1, 2, 3, 4, 5]) { const cfg = configFor(d); const t = task(d, d); const h = makeOriginalHandler(rebind(def, cfg), cfg); const rec = driveSync(t, h); assert.equal(rec.meta.handlerErrorCount, 0); const r = oracle(t, rec); assert.ok(r.pass, `d${d}: ${JSON.stringify(r.details.firstViolations)}`); }
  });
  test('its effects equal the independent transcription\'s, mail by mail', () => {
    const sig = rs => canonical(rs.map(sr => sr.events.map(ev => ({ m: ev.calls.filter(c => c.name === 'model.complete').length, e: ev.calls.flatMap(c => c.effects ?? []).map(x => [x.type, x.key ?? x.channel ?? x.provider ?? '', (x.to ?? []).join('|')].join(':')) }))));
    for (const [s, d] of [[0, 3], [1, 2], [2, 5]]) {
      const t = task(s, d, 'T3'), cfg = configFor(d);
      const a = replay(t, driveSync(t, makeOriginalHandler(rebind(def, cfg), cfg)).actions).env._records(), b = replay(t, driveSync(t, makeFaithful(cfg)).actions).env._records();
      assert.equal(sig(a), sig(b), `seed ${s} d${d}`);
    }
  });
  test('as a T3 answer it fails all five probes and the cost target', () => {
    const cfg = configFor(3), t = task(0, 3, 'T3'); const r = oracle(t, driveSync(t, makeOriginalHandler(rebind(def, cfg), cfg)));
    assert.equal(r.details.corePass, true); assert.deepEqual(r.details.probes.map(p => p.pass), [false, false, false, false, false]); assert.equal(r.details.costOk, false); assert.equal(r.pass, false);
  });
  test('deliberately broken variants of the original fail', () => {
    const mut = {
      noDedupe: wf => { wf.nodes.find(x => x.name === 'Check If Ticket Exists').parameters.conditions.conditions[0].leftValue = '={{ false }}'; },
      gateRemoved: wf => { const c = wf.nodes.find(x => x.name === 'Route by Classification Outcome').parameters.rules.values[0].conditions.conditions[0]; c.leftValue = c.leftValue.replace(' && Number($json.confidence) >= Number($json.minConfidence)', ''); },
      noFilter: wf => { for (const a of wf.nodes.find(x => x.name === 'Set Workflow Configuration').parameters.assignments.assignments) if (['internalDomains', 'ignoreSenderPatterns'].includes(a.name)) a.value = ''; },
      allBugs: wf => { const n = wf.nodes.find(x => x.name === 'Combine Email and Classification'); n.parameters.jsCode = n.parameters.jsCode.replace("category: ok ? ai.category : 'Unclassified'", "category: ok ? 'Bug' : 'Unclassified'"); },
    };
    for (const [name, f] of Object.entries(mut)) { const cfg = configFor(3), wf = rebind(def, cfg); f(wf); const t = task(1, 3); assert.equal(oracle(t, driveSync(t, makeOriginalHandler(wf, cfg))).pass, false, name); }
  });
  test('T1/T3 materialise the original definition into the workspace (sha-verified, not committed)', () => {
    mkdirSync('/var/tmp/foundry-work/replicate/n8n-20281', { recursive: true });
    const dir = mkdtempSync('/var/tmp/foundry-work/replicate/n8n-20281/mat-');
    try {
      const [file] = bed.materialize(task(1, 3, 'T1'), dir);
      assert.equal(path.relative(dir, file), 'original/workflow.json');
      const wf = JSON.parse(readFileSync(file, 'utf8'));
      assert.equal(wf.nodes.length, 69); assert.ok(wf.connections['Normalize Gmail Email']);
      assert.deepEqual(bed.materialize(task(1, 3, 'T2'), dir), []);
      assert.throws(() => bed.loadOriginal({ sha256: '0'.repeat(64) }), /sha256/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test('the emulator refuses code that mentions I/O or escape identifiers', () => {
    const cfg = configFor(3), wf = rebind(def, cfg); wf.nodes.find(x => x.name === 'Filter and Prepare for AI').parameters.jsCode = 'return { json: { x: process.env } };';
    const t = task(0, 3); const rec = driveSync(t, makeOriginalHandler(wf, cfg)); assert.ok(rec.meta.handlerErrorCount > 0);
  });
});

test('task hash is stable across calls (pin for the default task)', () => { assert.equal(hashOf(task(1, 3, 'T2')), hashOf(task(1, 3, 'T2'))); assert.ok(createHash('sha256').update('x').digest('hex')); assert.ok(CONFIG_PRESETS().base.jiraProjectKey === 'SUP' && threadLabelOf('abc').startsWith('email-thread-')); });
