// SPEC-0 owner simulator: closed-list matching (stub matcher), pre-rendered answers, seeded withholding unless the
// question names the subject, the question budget, byte-identical replay, and the ask metrics. $0, no model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPack } from '../render.mjs';
import { createOwnerSim, stubMatcher, replayOwnerSim, askMetrics, namesSubject } from '../owner-sim.mjs';
import { namingQuestion } from '../coverage.mjs';
import { UNITS, NO_MATCH_ANSWER, WITHHELD_ANSWER, TOO_BROAD_ANSWER, BUDGET_ANSWER } from '../content.mjs';

const pack = renderPack({ seed: 4 });
const recs = new Map(pack.owner.records.map(r => [r.id, r]));
const sim = (opts = {}) => createOwnerSim({ pack, matcher: stubMatcher(pack.owner.records), ...opts });
const fixed = ids => async () => ({ ids });

test('no match gives the fixed "use your judgment" answer, and it is still a charged question', async () => {
  const s = sim();
  const { answer } = await s.ask('What is the weather in Utrecht?');
  assert.equal(answer, NO_MATCH_ANSWER);
  assert.equal(s.journal().length, 1);
  assert.equal(s.remaining(), 19);
});

test('a reticent record is withheld from a vague question and answered when the question names its subject', async () => {
  const id = pack.owner.records.find(r => r.reticent && r.units.length && UNITS[r.id]).id;
  const s = createOwnerSim({ pack, matcher: fixed([id]) });
  const vague = await s.ask('Anything else I should know?');
  assert.equal(vague.answer, WITHHELD_ANSWER);
  const named = await s.ask(namingQuestion(id));
  assert.ok(namesSubject(namingQuestion(id), recs.get(id)));
  assert.equal(named.answer, recs.get(id).answer);
  const j = s.journal();
  assert.deepEqual(j[0].withheld, [id]);
  assert.deepEqual(j[1].answered, [id]);
});

test('a forthcoming record answers a vague question; more than three matches is too broad; invalid ids are dropped', async () => {
  const id = pack.owner.records.find(r => !r.reticent && r.units.length).id;
  const s = createOwnerSim({ pack, matcher: fixed([id, 'NOT-A-RECORD']) });
  const a = await s.ask('hmm?');
  assert.equal(a.answer, recs.get(id).answer);
  assert.deepEqual(s.journal()[0].invalidMatch, ['NOT-A-RECORD']);
  const many = pack.owner.records.slice(0, 4).map(r => r.id);
  const s2 = createOwnerSim({ pack, matcher: fixed(many) });
  assert.equal((await s2.ask('tell me everything')).answer, TOO_BROAD_ANSWER);
});

test('the budget: question 21 gets the fixed refusal and is journaled', async () => {
  const s = sim();
  for (let i = 0; i < 20; i++) await s.ask(`question ${i}`);
  assert.equal((await s.ask('one more?')).answer, BUDGET_ANSWER);
  assert.equal(s.journal().length, 21);
  assert.equal(s.journal()[20].budgetExceeded, true);
});

test('replay from the journal is byte-identical with no matcher, and detects a tampered journal', async () => {
  const s = sim();
  for (const id of Object.keys(UNITS).slice(0, 8)) await s.ask(namingQuestion(id));
  await s.ask('Is there a rule about refunds?');
  await s.ask('random noise');
  const j = s.journal();
  assert.deepEqual(replayOwnerSim(pack, j), { ok: true, mismatches: [] });
  const bad = structuredClone(j);
  bad[2].match = [pack.owner.records.at(-1).id];
  assert.equal(replayOwnerSim(pack, bad).ok, false);
});

test('the stub matcher maps every unit\'s naming question to that unit (the owner route of the coverage gate)', async () => {
  const m = stubMatcher(pack.owner.records);
  const list = pack.owner.records.map(({ id, title }) => ({ id, title }));
  for (const id of Object.keys(UNITS)) assert.deepEqual((await m(namingQuestion(id), list)).ids, [id], id);
});

test('ask metrics: Ask-F1 over the owner-only blockers, wasted questions on rules the documents state', async () => {
  const blockers = Object.entries(pack.assignment.units).filter(([, u]) => u.gold && u.carrier === 'owner').map(([id]) => id);
  const stated = Object.entries(pack.assignment.units).filter(([, u]) => u.gold && u.carrier === 'sop').map(([id]) => id);
  const s = sim();
  for (const id of blockers) await s.ask(namingQuestion(id));
  await s.ask(namingQuestion(stated[0]));
  const m = askMetrics(pack, s.journal());
  assert.equal(m.blockers, 3);
  assert.equal(m.blockersObtained, 3);
  assert.equal(m.recall, 1);
  assert.equal(m.precision, 3 / 4);
  assert.equal(m.wasted, 1);
  assert.ok(Math.abs(m.askF1 - (2 * 0.75) / 1.75) < 1e-12);
});
