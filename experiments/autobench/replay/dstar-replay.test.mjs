// Tests for the $0 replay scoring of ATTACK Moves 1-2: the preregistered success / kill numbers are applied verbatim,
// and the duplicate / alignment helpers count what they claim. Synthetic summaries only (no benchmark data).
//   nice -n 15 node --test --test-concurrency=1 experiments/autobench/replay/dstar-replay.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { ARMS, MOVE1_A, SOURCES, summarize } from './dstar-replay.mjs';
import { GATE_SOURCES, MOVE2, attributeDuplicates, diffDuplicates, refusalAligns, summarizeGate } from './gate-replay.mjs';
import { aligns, brokenGuardrails } from './dstar-score.mjs';

test('the thresholds are ATTACK §6 verbatim', () => {
  assert.deepEqual({ ...MOVE1_A }, { successTasks: 6, ofTasks: 14, maxTaskShare: 0.30, maxFalseExclusion: 0.05, maxPassingFlagged: 1, killTasksBelow: 4, killFalseExclusionAbove: 0.10, killPassingFlaggedAbove: 3 });
  assert.deepEqual({ ...MOVE2 }, { mentionRefused: 6, ofMention: 12, distinctTasks: 3, maxFalseRefusals: 1, duplicatesAfterPerArm: 2, duplicatesBeforePerArm: 13 });
});

// ---- Move 1 step A: synthetic per-task summaries
function move1({ reached, fe = [0, 100], flagged = 0, broken = 2 }) {
  const perTask = {};
  const n = Math.max(14, reached.length);
  for (let i = 0; i < n; i++) {
    const r = reached[i] ?? 0;
    const arms = { 'haiku-a1c': { passed: false, broken, reachedClosure: r, reachedAny: r, reachedRows: [], flagBases: [], flaggedClosure: false, flaggedAnyNeg: false, flaggedAnyHard: false } };
    arms['haiku-a0'] = { passed: true, broken: 0, reachedClosure: 0, reachedAny: 0, reachedRows: [], flagBases: i < flagged ? ['quote'] : [], flaggedClosure: i < flagged, flaggedAnyNeg: i < flagged, flaggedAnyHard: i < flagged };
    const row = { arms, falseExclusion: i === 0 ? { required: fe[1], hardExcluded: fe[0], unknown: 0 } : { required: 0, hardExcluded: 0, unknown: 0 }, today: { status: 'anchored' }, unknownKinds: {}, stats: { members: 0, include: 0, exclude: 0, unknown: 0, hardExclude: 0 } };
    perTask[`t${i}`] = Object.fromEntries(SOURCES.map(s => [s, row]));
  }
  return summarize(perTask).a1c.prereg;
}

test('Move 1 replay A: success, neither, and each kill condition', () => {
  const six = [1, 1, 1, 1, 1, 1];
  assert.deepEqual([move1({ reached: six, fe: [5, 100], flagged: 1 }).success, move1({ reached: six, fe: [5, 100], flagged: 1 }).kill], [true, false]);
  assert.equal(move1({ reached: [1, 1, 1, 1, 1] }).success, false, '5 of 14 tasks is not success');
  assert.equal(move1({ reached: [1, 1, 1, 1, 1] }).kill, false, '...nor kill');
  assert.equal(move1({ reached: [1, 1, 1, 1, 1, 3] }).success, false, 'one task holding 3 of 8 reached guardrails (37.5%) breaks the 30% cap');
  assert.equal(move1({ reached: [1, 1, 1] }).kill, true, '3 of 14 tasks kills');
  assert.equal(move1({ reached: six, fe: [6, 100] }).success, false, 'false exclusion 6% is not success');
  assert.equal(move1({ reached: six, fe: [11, 100] }).kill, true, 'false exclusion 11% kills');
  assert.equal(move1({ reached: six, flagged: 2 }).success, false, '2 passing worlds flagged is not success');
  assert.equal(move1({ reached: six, flagged: 3 }).kill, false, '3 flagged is not a kill');
  assert.equal(move1({ reached: six, flagged: 4 }).kill, true, '4 flagged kills');
});

// ---- Move 2: synthetic gate summaries
function move2({ mentionTasks = [2, 2, 2], falseP = 0, kDiffers = 0, dupAfter = 0, unexplained = [1, 2] }) {
  const perTask = {};
  const T = Math.max(mentionTasks.length, 8);
  for (let i = 0; i < T; i++) {
    const refused = mentionTasks[i] ?? 0;
    const failArm = { passed: false, writes: 5, undecodable: 0, admitted: 4, refusedP: refused, refusedK: 0, refusedKSame: 0, refusedKDiffers: 0, unexplained: 0, unexplainedAdmitted: i === 0 ? unexplained[1] : 0, certificates: 4, trueRefusals: refused, unalignedRefusals: 0,
      guardrails: Array.from({ length: Math.max(refused, 1) }, (_, k) => ({ type: 'x', mention: true, refused: k < refused })), refusalWhy: [], refusalOrigins: [], diffDuplicates: 0, residualDuplicates: 0, dupAttribution: { duplicates: i < dupAfter ? 1 : 0, prevented: 0, residual: i < dupAfter ? 1 : 0, unattributed: 0 } };
    const passArm = { passed: true, writes: 5, undecodable: 0, admitted: 5, refusedP: i < falseP ? 1 : 0, refusedK: i < kDiffers ? 1 : 0, refusedKSame: 0, refusedKDiffers: i < kDiffers ? 1 : 0, kDiffers: [], unexplained: 0, unexplainedAdmitted: i === 0 ? unexplained[0] : 0, certificates: 5, trueRefusals: 0, unalignedRefusals: 0,
      guardrails: [], refusalWhy: [], refusalOrigins: [], diffDuplicates: 0, residualDuplicates: 0, dupAttribution: { duplicates: 0, prevented: 0, residual: 0, unattributed: 0 } };
    const row = { arms: { 'haiku-a1c': failArm, 'haiku-a0': passArm } };
    perTask[`t${i}`] = Object.fromEntries(GATE_SOURCES.map(s => [s, row]));
  }
  return summarizeGate(perTask).a1c.prereg;
}

test('Move 2 replay: success needs 6 mention breaks from 3 tasks, at most 1 false refusal and at most 2 duplicate tasks per arm', () => {
  assert.deepEqual([move2({}).success, move2({}).kill], [true, false]);
  assert.equal(move2({ mentionTasks: [3, 3] }).success, false, '6 breaks from only 2 tasks');
  assert.equal(move2({ mentionTasks: [2, 2, 1] }).success, false, '5 breaks');
  assert.deepEqual([move2({ falseP: 1 }).success, move2({ falseP: 1 }).kill], [true, false]);
  assert.equal(move2({ falseP: 2 }).kill, true, 'two passing worlds with a P refusal kill');
  assert.equal(move2({ kDiffers: 2 }).kill, true, 'a registry refusal of different content on a passing world is a false refusal');
  assert.equal(move2({ dupAfter: 3 }).success, false, '3 tasks with residual duplicates in one arm');
  assert.equal(move2({ unexplained: [3, 2] }).kill, true, 'unexplained admitted writes right more often than wrong kills');
});

test('duplicate helpers: diff-level duplicates, and attribution of prevented ones by content', () => {
  const mk = (subject, n = 1) => Array.from({ length: n }, (_, i) => ({ op: 'created', app: 'gmail', coll: 'messages', id: `${subject}${i}`, record: { to: ['a@x.test'], subject } }));
  const diff = { changes: [...mk('Weekly summary', 3), ...mk('Other note')] };
  assert.equal(diffDuplicates(diff), 2);
  const log = [{ app: 'gmail', effect: 'send', text: 'weekly summary body', refused: false }, { app: 'gmail', effect: 'send', text: 'weekly summary body', refused: true }, { app: 'gmail', effect: 'send', text: 'weekly summary body again', refused: false }];
  assert.deepEqual(attributeDuplicates(diff, log), { duplicates: 2, prevented: 1, residual: 1, unattributed: 0 });
  assert.deepEqual(attributeDuplicates(diff, []), { duplicates: 2, prevented: 0, residual: 2, unattributed: 2 }, 'an unattributed duplicate stays residual');
});

test('alignment: a failed check or a refused call explains a broken guardrail only through its literal, id or target', () => {
  const grade = { assertion_results: [{ type: 'gmail_message_sent_to_with_body_not_contains', passed: false, params: { to: 'owner@corp.test', body_not_contains: ['Globex'] } }, { type: 'x_exists', passed: false, params: {} }, { type: 'y_not_exists', passed: true, params: { name: 'Q' } }] };
  const g = brokenGuardrails(grade);
  assert.equal(g.length, 1);
  assert.equal(aligns({ evidence: 'gmail.messages:1 names "globex"', label: 'Globex Corp', lits: ['globex corp', 'globex'] }, g[0]), true);
  assert.equal(aligns({ evidence: 'gmail.messages:1 names "initech"', label: 'Initech LLC', lits: ['initech'] }, g[0]), false);
  assert.equal(refusalAligns({ recipients: ['owner@corp.test'], channels: [], text: 'Globex is on hold' }, g[0]), true);
  assert.equal(refusalAligns({ recipients: ['cfo@corp.test'], channels: [], text: 'Globex is on hold' }, g[0]), false, 'the literal on another target is not this guardrail');
  assert.ok(ARMS.length === 6);
});
