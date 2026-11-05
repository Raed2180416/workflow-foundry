// The held-out runner at $0 (PREREG-TRACKER-H): a hand-bound check over two real held-out builds (the HW2 reference, which lists only
// the finished tasks, and its control that also lists the open ones) must give T2solo unmet on the control only, T0 pass on both, and
// a score that counts the control as caught with no false alarm. No model call.
//   nice -n 15 node --test --test-concurrency=1 experiments/tracker-v2/test/heldout-runner.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stepJudge, stepScore, repairFeedback } from '../heldout/run-heldout.mjs';
import { HELDOUT_DIR } from '../heldout/cases.mjs';

const ref = path.join(HELDOUT_DIR, 'runs/ref/records/HW2.json'), ctl = path.join(HELDOUT_DIR, 'runs/control/records/HW2-0.json');

test('judge and score on two held-out builds with one hand-bound check', { skip: !existsSync(ref) || !existsSync(ctl) }, async () => {
  const out = mkdtempSync(path.join(tmpdir(), 'tracker-h-runner-'));
  try {
    for (const [arm, f] of [['ref', ref], ['control', ctl]]) { mkdirSync(path.join(out, 'runs', arm, 'records'), { recursive: true }); copyFileSync(f, path.join(out, 'runs', arm, 'records', path.basename(f))); }
    // "no open or blocked needed": no e-mail names the practice tracker's open item (the tracker judges practice runs, never the hidden
    // world; the report's count line "Still open: 1" is not a listing).
    const absent = { template: 'absent', channel: 'email', where: [{ path: 'body', op: 'contains', value: 'migrate the billing table' }] };
    const bind = { capture: 'x', prompt: 'hand', model: 'none', cases: { HW2: [
      { id: 'C-001', quote: 'no open or blocked needed', summary: 'no open items', kind: 'never', verification: 'test', check: absent, missing: [] },
      { id: 'C-002', quote: 'email me just the tasks marked done last week', summary: 'done only', kind: 'must', verification: 'test', check: null, missing: [] }] }, costUsd: 0 };
    const bindFile = path.join(out, 'bind-hand.json');
    writeFileSync(bindFile, JSON.stringify(bind));
    const [file] = await stepJudge({ out, bindFile, semantics: ['v3'], log: () => {} });
    const j = JSON.parse(readFileSync(file, 'utf8'));
    const r = j.builds['ref/HW2'], c = j.builds['control/HW2-0'];
    assert.equal(r.verified, true); assert.equal(c.verified, false);
    assert.equal(r.t0.passed, true); assert.equal(c.t0.passed, true, 'the control passes its own checks: T0 cannot see it');
    assert.equal(r.t2Solo['C-001'].status, 'met');
    assert.equal(c.t2Solo['C-001'].status, 'unmet', 'teeth: the control lists the open items');
    assert.equal(r.t2Solo['C-002'].status, 'unknown'); assert.equal(r.t2Solo['C-002'].reason, 'no-check');
    const s = stepScore({ out });
    const a = s.arms[path.basename(file)];
    assert.deepEqual([a.T0.caught, a.T2solo.caught, a.T2solo.falseAlarms, a['T0+T2solo'].caught], [0, 1, 0, 1]);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('H7 repair feedback: grounded findings for flagged builds only; T1 its own ticks; self-review for every build', () => {
  const judge = { builds: { 'b0-h/HW2': { t2Solo: { 'C-001': { status: 'unmet', evidence: [{ why: 'email to liz@beaconcontent.co matches' }] }, 'C-002': { status: 'met' } } }, 'b0-h/HW1': { t2Solo: { 'C-001': { status: 'met' } } } } };
  const bind = { cases: { HW2: [{ id: 'C-001', quote: 'no open or blocked needed' }] } };
  const t2 = repairFeedback('t2', { judge, bind, buildId: 'b0-h/HW2', caseId: 'HW2' });
  assert.match(t2, /"no open or blocked needed": email to liz@beaconcontent.co matches/);
  assert.equal(repairFeedback('t2', { judge, bind, buildId: 'b0-h/HW1', caseId: 'HW1' }), null, 'an unflagged build gets no repair from T2');
  const proseDoc = { builds: { 'b0-h/HW2': { flagged: true, verdicts: { 'C-001': { verdict: 'unmet', why: 'it lists the open items' }, 'C-002': { verdict: 'met', why: '' } } } } };
  assert.match(repairFeedback('t1', { proseDoc, buildId: 'b0-h/HW2' }), /C-001: it lists the open items/);
  assert.equal(repairFeedback('t1', { proseDoc, buildId: 'b0-h/HW1' }), null);
  assert.match(repairFeedback('none', { buildId: 'b0-h/HW1' }), /does everything the person asked/);
});
