// The run-graph data (app/core/run-graph.mjs) on real runtime runs (scripted provider, local tools, $0). nice -n 15 node --test app/test/run-graph.test.mjs
// Development evidence: the scenarios and seeds here are the development set of research/node-graph-ui-20261021 (PREREG.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as G from '../core/run-graph.mjs';
import { NAMED, randomScenario, HOSTILE_BODY } from '../eval/run-graph/scenarios.mjs';
import { record, evaluateRecording, newScore } from '../eval/run-graph/harness.mjs';
import { loadMutants, MUTANTS, EQUIVALENT } from '../eval/run-graph/mutants.mjs';

const tmp = t => { const dir = mkdtempSync(path.join(tmpdir(), 'run-graph-test-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };
async function named(t, name) {
  const rec = await record(path.join(tmp(t), name), { ...NAMED[name](), name });
  t.after(() => rec.store.close());
  const final = rec.final, executing = rec.commits.at(-1).executing;
  const doc = G.runGraph({ workflow: rec.workflow, run: final, events: rec.events, checkpoint: final, executing, journal: rec.journal });
  return { rec, doc, card: id => doc.graph.cards.find(c => c.members.includes(id)) };
}

test('five user states: every detailed state maps; only working steps breathe, only "needs you" pulses, both slower than 3 flashes a second', () => {
  for (const detail of [...Object.keys(globalThis.RunViewCore.STATES), 'stalled', 'checkdisagreed', 'refused']) assert.ok(G.DETAIL_TO_USER[detail], `${detail} has a user state`);
  assert.deepEqual(Object.keys(G.USER_STATES), ['idle', 'working', 'needs_you', 'problem', 'done']);
  assert.equal(G.userState('running').motion, 'breathe');
  assert.equal(G.userState('running', { executing: false }).motion, 'none', 'nothing breathes when no process runs it');
  assert.equal(G.userState('waiting').motion, 'none', 'a timer wait is still');
  assert.equal(G.userState('needsyou').motion, 'pulse');
  for (const d of ['done', 'failed', 'idle', 'checkdisagreed']) assert.equal(G.userState(d).motion, 'none');
  for (const m of Object.values(G.MOTION)) assert.ok(m.periodMs === 0 || m.periodMs >= 1000 / 3, 'WCAG 2.3.1');
  assert.equal(new Set(Object.values(G.USER_STATES).map(s => s.glyph)).size, 5, 'colour is never the only signal');
});

test('fence: hostile text is sanitised, padding cannot push a payload out of view, clipping is counted', () => {
  const f = G.fence(HOSTILE_BODY, 300);
  assert.equal(f.trust, 'untrusted');
  assert.ok(f.invisibleReplaced >= 2, 'bidi override and zero-width space are made visible');
  assert.ok(!/[‮​]/.test(f.text));
  assert.ok(f.blankLinesCollapsed >= 390);
  assert.match(f.text, /attacker@evil\.example/, 'the payload after 400 blank lines is inside the first 300 shown characters');
  assert.match(f.text, /⟦398 more blank lines⟧/);
  const long = G.fence('x'.repeat(5000), 100);
  assert.equal(long.clippedChars, 4900); assert.equal(long.chars, 5000);
});

test('S1b: a failed check that the record names is shown in words; the one-line summary names the step and the cost', async t => {
  const { doc } = await named(t, 'S1b-check-named');
  const f = doc.summary.failing;
  assert.equal(f.nodeKey, 'root/grade'); assert.equal(f.code, 'NODE_CHECK_FAILED');
  assert.equal(f.check.known, true); assert.equal(f.check.index, 0);
  assert.match(f.check.text, /confidence of “this step's answer” is at least 0\.6/);
  assert.match(doc.summary.oneLine, /^Grade the essays: Problem at “Grade”: .*failed check: the confidence of/);
  assert.match(doc.summary.oneLine, /\$0\.00010/);
  assert.equal(doc.run.state.user, 'problem');
});

test('S1: after an escalation the record does not say which check failed, and the data says so instead of guessing (gap G2)', async t => {
  const { doc } = await named(t, 'S1-fail-after-escalation');
  const f = doc.summary.failing;
  assert.equal(f.code, 'MODEL_ESCALATION_EXHAUSTED'); assert.equal(f.check.known, false); assert.match(f.check.why, /G2/);
  assert.equal(f.remedy.class, 'exhausted');
});

test('S7: the cause of a failed map is the item step three levels down, not the map', async t => {
  const { doc, card } = await named(t, 'S7-nested-fail');
  assert.equal(doc.summary.failing.nodeKey, 'root/check:2/read');
  assert.equal(doc.summary.failing.code, 'NODE_CHECK_FAILED');
  assert.equal(card('check').state.user, 'problem');
  assert.equal(card('report').state.user, 'idle');
});

test('S10: a refused action stops the run quietly: no step keeps saying "needs you", the refused step is "not running"', async t => {
  const { doc, card } = await named(t, 'S10-rejected');
  assert.equal(doc.run.status, 'cancelled'); assert.equal(doc.run.state.user, 'idle');
  assert.equal(doc.waiting.length, 0);
  assert.equal(card('send').state.user, 'idle'); assert.equal(card('send').state.detail, 'refused');
  assert.match(doc.summary.oneLine, /Stopped: You said no/);
});

test('S13: a run whose process died says so (problem, nothing breathes) and counts the call it paid for but never recorded', async t => {
  const { rec, doc } = await named(t, 'S13-stalled');
  assert.equal(rec.crashed, true);
  assert.equal(rec.final.status, 'running');
  assert.equal(doc.run.state.detail, 'stalled'); assert.equal(doc.run.state.user, 'problem');
  assert.ok(doc.graph.cards.every(c => c.state.motion === 'none'));
  assert.equal(doc.graph.cards.find(c => c.id === 'draft').state.detail, 'stalled');
  assert.equal(doc.run.cost.unrecordedCalls, 1);
  assert.ok(doc.run.cost.usd > 0, 'the journal row is counted');
  const chainOnly = G.runGraph({ workflow: rec.workflow, run: rec.final, events: rec.events, executing: false });
  assert.equal(chainOnly.run.cost.calls, 0, 'from the chain alone the call is invisible');
});

test('S8, S11, S12: definition of done, an effect of unknown outcome and a provider fault each get their own words', async t => {
  const acc = (await named(t, 'S8-acceptance')).doc.summary.failing;
  assert.equal(acc.nodeKey, null); assert.equal(acc.check.known, true); assert.match(acc.check.text, /equals 3/);
  const unc = (await named(t, 'S11-uncertain')).doc.summary.failing;
  assert.equal(unc.uncertain, true); assert.equal(unc.remedy.class, 'uncertain'); assert.match(unc.remedy.next, /by hand/);
  const env = (await named(t, 'S12-envfault')).doc.summary.failing;
  assert.equal(env.environmentFault, true); assert.match(env.remedy.what, /not the workflow's fault/);
});

test('S9 and S2: questions inside map items and a paused action are all in the waiting list; S6 has nothing waiting', async t => {
  const s9 = (await named(t, 'S9-question-in-map')).doc;
  assert.deepEqual(s9.waiting.map(w => w.nodeKey).sort(), ['root/confirm:0/ask', 'root/confirm:1/ask']);
  assert.equal(s9.graph.cards.find(c => c.id === 'confirm').state.user, 'needs_you');
  const s2 = (await named(t, 'S2-approval')).doc;
  assert.deepEqual(s2.waiting.map(w => [w.kind, w.nodeKey]), [['approval', 'root/send']]);
  assert.equal((await named(t, 'S6-nothing-waiting')).doc.waiting.length, 0);
});

test('S4: per-step cost equals the journal, including the escalated step', async t => {
  const { rec, card } = await named(t, 'S4-costs');
  for (const id of ['a', 'b', 'c']) {
    const journal = rec.journal.filter(r => r.nodeKey === `root/${id}`).reduce((s, r) => s + r.costUsd, 0);
    assert.ok(Math.abs(card(id).cost.usd - journal) < 1e-12, `${id}: ${card(id).cost.usd} vs ${journal}`);
  }
  assert.ok(card('a').cost.usd > card('b').cost.usd, 'the escalated step cost more');
  assert.deepEqual(Object.keys(card('a').cost.models).sort(), ['claude-haiku-5-5', 'claude-sonnet-5-5']);
});

test('nodeDetail: what the step does, its state, what to do, the checks, the calls, and the output fenced', async t => {
  const { rec } = await named(t, 'S1b-check-named');
  const d = G.nodeDetail({ workflow: rec.workflow, run: rec.final, events: rec.events, nodeKey: 'root/grade', executing: false });
  assert.equal(d.schema, G.NODE_SCHEMA); assert.equal(d.state.user, 'problem');
  assert.match(d.what, /Grade the essay/);
  assert.equal(d.checks[0].status, 'failed'); assert.equal(d.io.shape, 'conversation');
  assert.equal(d.calls.length, 1); assert.ok(d.calls[0].journalId != null);
  assert.equal(d.transcript.trust, 'untrusted');
  assert.match(d.whatToDo.next, /changed flow/);
  assert.equal(G.nodeDetail({ workflow: rec.workflow, run: rec.final, events: rec.events, nodeKey: 'root/nope' }), null);
});

// The strongest test: at every committed moment of every run, what the data says equals what the runtime's own records say.
test('differential: T agrees with the checkpoint/journal oracle at every moment of 13 named and 60 random runs; the blank control does not', async t => {
  const dir = tmp(t), scores = {};
  const jobs = [...Object.keys(NAMED).map(name => ({ name, sc: { ...NAMED[name](), name } })), ...Array.from({ length: 60 }, (_, i) => ({ name: `R${i}`, sc: randomScenario(i) }))];
  let runs = 0;
  for (const job of jobs) {
    const rec = await record(path.join(dir, job.name), job.sc);
    if (rec.invalid) continue;
    evaluateRecording(rec, { scores });
    rec.store.close(); rmSync(path.join(dir, job.name), { recursive: true, force: true }); runs++;
  }
  assert.ok(runs >= 70, `${runs} runs recorded`);
  for (const q of ['state', 'stateLive', 'run', 'wait', 'fail', 'failDeep', 'cost', 'costAll', 'line']) assert.equal(scores.T[q].ok, scores.T[q].n, `T ${q}: ${scores.T[q].ok}/${scores.T[q].n}`);
  for (const q of ['state', 'run', 'wait', 'fail', 'cost']) assert.equal(scores['C+'][q].ok, scores['C+'][q].n, `the oracle arm scores itself 100% on ${q}`);
  assert.ok(scores['C-'].stateLive.ok === 0 && scores['C-'].fail.ok === 0 && scores['C-'].waitMissed.ok === 0, 'the blank control fails what it blanks');
  assert.ok(scores.B1.failDeep.ok < scores.B1.failDeep.n && scores.B0.waitMissed.ok < scores.B0.waitMissed.n, 'the baselines miss what the plan says they miss');
});

test('mutation: every planted defect in run-graph.mjs is caught by the oracle on the development runs', async t => {
  const dir = tmp(t), mutants = await loadMutants(path.join(dir, 'mutants')), scores = {};
  const jobs = [...Object.keys(NAMED).map(name => ({ name, sc: { ...NAMED[name](), name } })), ...Array.from({ length: 40 }, (_, i) => ({ name: `R${i}`, sc: randomScenario(i) }))];
  for (const job of jobs) {
    const rec = await record(path.join(dir, job.name), job.sc);
    if (rec.invalid) continue;
    evaluateRecording(rec, { scores, mutants });
    rec.store.close(); rmSync(path.join(dir, job.name), { recursive: true, force: true });
  }
  const qs = Object.keys(newScore()).filter(k => k !== 'na');
  const survivors = MUTANTS.map(([name]) => name).filter(name => qs.every(q => scores[name][q].ok / Math.max(1, scores[name][q].n) >= scores.T[q].ok / Math.max(1, scores.T[q].n)));
  assert.deepEqual(survivors.filter(name => !EQUIVALENT[name]), [], `mutants not caught: ${survivors.join(', ')}`);
  assert.deepEqual(survivors, Object.keys(EQUIVALENT), 'the equivalent mutants are exactly the ones listed with a reason');
});
