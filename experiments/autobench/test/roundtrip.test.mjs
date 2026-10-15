// Tests for the round-trip reader probe (experiments/autobench/roundtrip.mjs). No model is called ($0): the reader is a code
// stand-in. The end-to-end test builds two finished rollouts of a `simple` task (not scored, outside the split) with scripted
// sessions through the real bridge and needs the AutomationBench venv.
//   node --test experiments/autobench/test/roundtrip.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, VENV_PY, scriptedRunner } from '../lib.mjs';
import { runTasks } from '../run.mjs';
import { loadSplit } from '../split.mjs';
import { RT_SYSTEM, analyze, auroc, bootstrapAuroc, literals, renderDiff, resolvePath, rtPrompt, runRoundTrip, scriptedPort, selectRollouts, similarity, spearman, verdict } from '../roundtrip.mjs';

const tmp = p => mkdtempSync(path.join(os.tmpdir(), `autobench-rt-${p}-`));
const HAVE_VENV = existsSync(VENV_PY);
const quiet = () => {};
const PHONE_TASK = 'simple.email_sf_contact_phone_update';

test('AUROC: Mann-Whitney with tied ranks; one class -> null; bootstrap is seeded and clustered by task; Spearman', () => {
  assert.equal(auroc([0.9, 0.8, 0.1, 0.2], [1, 1, 0, 0]), 1);
  assert.equal(auroc([0.1, 0.2, 0.9, 0.8], [1, 1, 0, 0]), 0);
  assert.equal(auroc([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 0]), 0.5);
  assert.equal(auroc([0.3, 0.6, 0.6, 0.9], [0, 1, 0, 1]), 0.875);
  assert.equal(auroc([0.1, 0.2], [1, 1]), null);
  const rows = Array.from({ length: 40 }, (_, i) => ({ task: `t${i % 20}`, pass: i % 3 === 0 ? 1 : 0, rt: (i % 3 === 0 ? 0.6 : 0.4) + (i % 7) / 100, b0: (i % 5) / 10 }));
  const a = bootstrapAuroc(rows, ['rt', 'b0'], { B: 300, seed: 's', vs: 'b0' }), b = bootstrapAuroc(rows, ['rt', 'b0'], { B: 300, seed: 's', vs: 'b0' });
  assert.deepEqual(a, b);
  assert.equal(a.tasks, 20);
  assert.ok(a.auroc.rt.point > 0.9 && a.auroc.rt.ci95[0] <= a.auroc.rt.point && a.auroc.rt.ci95[1] >= a.auroc.rt.point);
  assert.ok(a.minus['rt-b0'].point > 0);
  assert.ok(Math.abs(spearman([1, 2, 3, 4], [10, 20, 30, 40]) - 1) < 1e-12);
  assert.ok(Math.abs(spearman([1, 2, 3, 4], [4, 3, 2, 1]) + 1) < 1e-12);
  // The predeclared verdicts.
  assert.match(verdict({ auroc: { rt: { point: 0.8 } }, minus: { 'rt-b0': { ci95: [0.02, 0.2] } } }), /^usable/);
  assert.match(verdict({ auroc: { rt: { point: 0.8 } }, minus: { 'rt-b0': { ci95: [-0.02, 0.2] } } }), /^not shown to beat/);
  assert.match(verdict({ auroc: { rt: { point: 0.55 } } }), /^dead/);
  assert.match(verdict({ auroc: { rt: { point: 0.7 } } }), /^inconclusive/);
});

test('similarity: literal recall (addresses, ids, amounts, dates, quoted strings, names) and content recall against the request', () => {
  const req = 'Email the "Q3 Budget" summary to ops@corp.example: invoice INV-2041 for $156,000 is due 2026-03-24 for Meridian Corp.';
  const lits = literals(req).map(l => l.value);
  for (const x of ['ops@corp.example', 'INV-2041', 'Q3 Budget', '2026-03-24', 'Meridian Corp', '$156,000']) assert.ok(lits.includes(x), x);
  const full = similarity('Send ops@corp.example the Q3 Budget summary: invoice INV-2041, 156000 USD, due 2026-03-24, Meridian Corp.', req);
  assert.equal(full.literalRecall, 1);
  assert.ok(full.contentRecall > 0.7);
  const part = similarity('Send an email to ops@corp.example.', req);
  assert.ok(part.score < full.score && part.literalRecall > 0 && part.literalRecall < 0.5);
  assert.equal(similarity('', req).score, 0);
  assert.equal(similarity('anything', 'update the record please').literalRecall, null); // no literal: content recall alone
});

test('diff rendering: values before each change from the initial world; new records compacted; $.meta dropped; the prompt carries only the diff', () => {
  const world0 = { meta: { x: 1 }, gmail: { messages: [{ id: 'm1', subject: 'Hi' }] }, salesforce: { contacts: [{ id: '003A', phone: '+1-555-0000', name: 'Jordan Lee' }] } };
  assert.equal(resolvePath(world0, '$.salesforce.contacts[id=003A].phone'), '+1-555-0000');
  assert.equal(resolvePath(world0, '$.salesforce.contacts[id=nope].phone'), undefined);
  const diff = [
    ['set', '$.salesforce.contacts[id=003A].phone', '+1-555-0101'],
    ['add-records', '$.gmail.messages', [JSON.stringify({ id: '<gen>', to: ['jordan@corp.example'], subject: 'Updated', body_plain: 'Done', body_html: '<p>Done</p>', attachment_ids: [] })]],
    ['del-record', '$.gmail.messages', 'm1'],
    ['set', '$.meta.steps', 3],
  ];
  const d = renderDiff(diff, world0);
  assert.equal(d.entries, 3);
  assert.equal(d.metaDropped, 1);
  assert.equal(d.records, 1);
  assert.match(d.text, /^~ salesforce\.contacts\[id=003A\]\.phone: "\+1-555-0000" -> "\+1-555-0101"$/m);
  assert.match(d.text, /^\+ new record in gmail\.messages: \{"id":"<gen>","to":\["jordan@corp\.example"\],"subject":"Updated","body_plain":"Done"\}$/m);
  assert.match(d.text, /^- record m1 removed from gmail\.messages \(was \{"id":"m1","subject":"Hi"\}\)$/m);
  assert.ok(renderDiff([], world0).empty);
  // A keyless list changed as a whole: only the items added or removed are shown.
  const w1 = { slack: { messages: [{ ts: '1', text: 'old one' }, { ts: '2', text: 'old two' }] } };
  const l = renderDiff([['set', '$.slack.messages', [{ text: 'old two', ts: '2' }, { text: 'old one', ts: '1' }, { text: 'Posted update', ts: '<gen>' }]]], w1);
  assert.equal(l.text, '+ new item in slack.messages: {"text":"Posted update","ts":"<gen>"}');
  const p = rtPrompt(d.text);
  assert.ok(p.includes(d.text));
  assert.doesNotMatch(`${RT_SYSTEM}\n${p}`, /assertion|rubric|grade|partial.credit|task_completed|pass|score/i);
});

test('isolation: roundtrip.mjs never opens grade.json, sends labels or the request to the reader, and refuses test tasks before opening anything', () => {
  const src = readFileSync(path.join(REPO, 'experiments/autobench/roundtrip.mjs'), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(src, /grade\.json|assertion|RECURRING-DESIGN|families\//);
  // The reader's prompt is built only from the rendered diff (rtPrompt takes the diff text and nothing else).
  assert.match(src, /prompt: rtPrompt\(d\.text\)/);
  // A run listing a test task is refused before any of its files is opened (only the name is read).
  const root = tmp('refuse'), run = path.join(root, 'r1');
  mkdirSync(run, { recursive: true });
  const testTask = loadSplit().test[0];
  writeFileSync(path.join(run, 'results.jsonl'), JSON.stringify({ task: testTask, domain: testTask.split('.')[0], k: 1, forks: [{}], final: { task_completed_correctly: 0 } }) + '\n');
  assert.throws(() => selectRollouts(['r1'], { liveRoot: root }), /not dev-split tasks/);
  // devCheck tasks are skipped (sealed), never scored.
  const dc = loadSplit().devCheck[0];
  writeFileSync(path.join(run, 'results.jsonl'), JSON.stringify({ task: dc, domain: dc.split('.')[0], k: 1, forks: [{}], final: { task_completed_correctly: 1 } }) + '\n');
  const s = selectRollouts(['r1'], { liveRoot: root });
  assert.deepEqual([s.rows.length, s.skipped[0].why], [0, 'devCheck (sealed)']);
  // A sealed run is refused.
  const sealed = path.join(root, 'r2');
  mkdirSync(sealed);
  writeFileSync(path.join(sealed, 'results.sealed.jsonl'), '');
  assert.throws(() => selectRollouts(['r2'], { liveRoot: root }), /sealed run/);
});

test('end to end (scripted, $0): two finished rollouts of a simple task (work done / nothing done) -> diffs, stand-in reader, scores, AUROC; the reader sees neither request nor label', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 600_000 }, async () => {
  const root = tmp('e2e');
  const patch = { name: 'api_fetch', arguments: JSON.stringify({ method: 'PATCH', url: 'https://yourinstance.salesforce.com/services/data/v61.0/sobjects/Contact/003001', params: null, body: JSON.stringify({ Phone: '+1-555-0101' }) }) };
  for (const [run, steps] of [['done', [{ calls: [patch] }]], ['noop', []]]) {
    await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], det: 'record', runId: run, liveRoot: path.join(root, run), outDir: null, log: quiet, runner: scriptedRunner(() => steps) });
  }
  const seen = [];
  const base = scriptedPort();
  const port = { call: async req => { seen.push(req); return base.call(req); } };
  const { summary, rows } = await runRoundTrip({ runs: ['done', 'noop'], id: 't', liveRoot: root, outDir: path.join(root, 'out'), port, model: null, scripted: true, log: quiet, bootstrap: 200 });
  assert.equal(summary.n, 2);
  assert.deepEqual(rows.map(r => [r.run, r.pass, r.emptyDiff]), [['done', 1, false], ['noop', 0, true]]);
  const request = JSON.parse(readFileSync(path.join(root, 'done', 'prep', PHONE_TASK, 'prompt.json'), 'utf8')).user;
  assert.equal(seen.length, 2);
  for (const req of seen) {
    assert.equal(req.system, RT_SYSTEM);
    assert.ok(!req.prompt.includes(request) && !req.prompt.includes(PHONE_TASK));
    assert.doesNotMatch(req.prompt, /task_completed|partial_credit|assertion/);
  }
  assert.match(seen.find(r => /0101/.test(r.prompt)).prompt, /~ salesforce\.contacts\[id=003001\]\.phone: "\+1-555-0000" -> "\+1-555-0101"/);
  assert.ok(rows[0].rt > rows[1].rt);
  assert.equal(summary.analysis.all.auroc.rt.point, 1);
  assert.equal(summary.spentUsd, 0);
  // The repo copy holds scores and labels only (no reconstruction, diff or request text).
  const copied = readFileSync(path.join(root, 'out', 'rows.jsonl'), 'utf8');
  assert.ok(!copied.includes('0101') && !copied.includes('reconstruction') && !copied.includes(request.slice(0, 30)));
  // Rerunning the same id reuses the recorded rows: no new call.
  const again = await runRoundTrip({ runs: ['done', 'noop'], id: 't', liveRoot: root, outDir: null, port, model: null, scripted: true, log: quiet, bootstrap: 200 });
  assert.equal(seen.length, 2);
  assert.deepEqual(again.rows.map(r => r.rt), rows.map(r => r.rt));
});

test('analysis block: verdicts on all rollouts and on non-empty diffs; empty-diff share; per-run AUROC', () => {
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push({ run: i < 15 ? 'a' : 'b', task: `t${i}`, pass: i % 3 === 0 ? 1 : 0, partialCredit: (i % 3 === 0) ? 1 : (i % 5) / 5, rt: (i % 3 === 0 ? 0.7 : 0.3) + (i % 4) / 50, rtLiteral: 0.5, rtContent: 0.5, b0: 0.5, nChanges: i % 4, emptyDiff: i % 10 === 1 });
  const a = analyze(rows, { B: 200, seed: 'x' });
  assert.equal(a.all.n, 30);
  assert.ok(a.nonEmptyDiff.n < 30);
  assert.equal(a.emptyDiffShare, 3 / 30);
  assert.deepEqual(Object.keys(a.byRun), ['a', 'b']);
  assert.match(a.verdict.all, /^usable/);
});
