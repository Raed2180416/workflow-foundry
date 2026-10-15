// T6 and the request-shape tests of BUILD-ORDER step 7 (JEV-PORTS §1–§8): the Jev port request builders, the option
// audit, the code baselines and decision rules beside the ports, the ledger rows and the noul / score / choice answer
// converter. Request shapes only: nothing is sent (no fetch; the module imports no client). $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as J from '../jev.mjs';
import { loadCard, loadL1 } from '../cards.mjs';
import { shapeOf } from '../index.mjs';
import { openLibrary } from '../store.mjs';
import { calibrationReport } from '../../../src/judgment.mjs';
import { judgmentModelById, loadPolicy } from '../../../src/models/policy.mjs';
import { learnProfile } from '../../jit/profile.mjs';
import { tmp, clock, registerSum, makeKept, sampleTasks } from './helpers.mjs';

const FIRST_SLICE = ['P01', 'P03', 'P07', 'P08', 'P09', 'P12', 'P13', 'P15', 'P16', 'P17', 'P20', 'P54'];
const task = { prompt: 'Sum the rows of the ledger by account and report totals; ignore test customers whose names begin with ZZ.', inputs: { rows: [{ account: 'A', amount: 10 }, { account: 'B', amount: 5 }], note: 'Amounts are in minor units of EUR as stated by the bank.' } };
const taskSpec = { outputSchemaSummary: 'totals by account', inputs: [{ path: 'inputs.rows', kind: 'list' }], rules: [{ span: 'ignore test customers whose names begin with ZZ', kind: 'exclusion' }], conventionsInProse: [], effects: [] };
// Every builder, with inputs that carry everything that must NOT reach state.
function allBuilt(lib, entry) {
  const cands = ['P07', 'P09', 'P12', 'P13', 'P03'].map(id => loadL1().find(p => p.id === id));
  const shape = shapeOf(task);
  return [
    J.applicabilityRequest({ task, taskSpec, candidate: lib.get(entry.hash) }),
    J.patternChoiceStageA({ task, taskSpec, shape, candidates: cands }),
    J.patternChoiceStageB({ task, taskSpec, shape, survivors: ['P12', 'P13', 'P09'] }),
    J.slotCompletenessRequest({ taskSpec, card: loadCard('P03'), filled: loadCard('P03').example.slots }),
    J.riskClassRequest({ task, declaredEffects: [{ tool: 'mail.send', kind: 'send', reversible: false, external: true }], untrustedInputs: ['inputs.note'] }),
    J.quarantinedReadRequest({ source: 'skill-description', text: 'Extracts tables from PDF files into CSV rows.' }),
    J.failureClassRequest({ event: { kind: 'invariant', name: 'sum-conserved', detail: { d: 1250 } }, replay: 'same-failure', novelPaths: [] }),
  ];
}
const keysDeep = (v, out = new Set()) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); } return out; };

test('step 7: every port builds {model, state, questions}; questions carry only type, instructions, criteria; nothing is sent', t => {
  const lib = openLibrary(tmp(t), { now: clock() });
  const e = registerSum(lib, { preconditions: [{ text: 'the rows carry integer amounts in minor units', kind: 'semantic' }, { text: 'rows have an id', kind: 'shape' }] });
  const built = allBuilt(lib, e);
  assert.deepEqual(built.map(b => b.port), J.PORTS);
  assert.equal(judgmentModelById(loadPolicy().policy, J.JEV_MODEL).entry.id, 'jev-1.13.0', 'the request names the policy\'s pinned Jev version (2026-10-15)');
  for (const b of built) {
    assert.deepEqual(Object.keys(b.request).sort(), ['model', 'questions', 'state']);
    assert.equal(b.request.model, J.JEV_MODEL);
    assert.ok(Object.keys(b.request.questions).length >= 1);
    for (const [id, q] of Object.entries(b.request.questions)) {
      assert.deepEqual(Object.keys(q).filter(k => !['type', 'instructions', 'criteria'].includes(k)), [], `${b.port}.${id}: no label, src or target leaves the machine`);
      assert.ok(['noul', 'choice', 'score'].includes(q.type));
      if (q.type === 'choice') assert.ok(q.criteria && !Array.isArray(q.criteria));
      if (q.type === 'score') assert.ok(Array.isArray(q.criteria) && q.criteria.length >= 2);
      // Paths, not prose (§1.1): every backticked path an instruction names resolves in this request's state.
      for (const p of J.pathsOf(q.instructions)) assert.notEqual(J.resolvePath(b.request.state, p), undefined, `${b.port}.${id}: \`${p}\` is not in state`);
    }
    assert.ok(Array.isArray(b.untrustedFields) && b.untrustedFields.length);
  }
  const code = readFileSync(new URL('../jev.mjs', import.meta.url), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/\bfetch\s*\(|new SystemOneClient|\.ask\s*\(|process\.env/.test(code), 'jev.mjs builds requests only');
  assert.ok(!/import\s*\{[^}]*SystemOneClient/.test(code), 'and imports no client');
});

test('step 7: no label and no baseline verdict leaks into state (hash, name, evidence, profile novel verdict, BM25 rank, lint result)', t => {
  const lib = openLibrary(tmp(t), { now: clock() });
  const e = registerSum(lib, { preconditions: [{ text: 'the rows carry integer amounts in minor units', kind: 'semantic' }] });
  makeKept(lib, e.hash);
  for (let i = 0; i < 3; i++) lib.addEvidence(e.hash, { kind: 'reuse', class: 'correct' });
  const built = allBuilt(lib, e);
  for (const b of built) {
    const s = JSON.stringify(b.request.state), keys = keysDeep(b.request.state);
    assert.ok(!s.includes(e.hash.slice(7, 19)), `${b.port}: the hash is not in state`);
    assert.ok(!s.includes('sum-rows'), `${b.port}: the name is not in state`);
    for (const k of ['label', 'truth', 'expected', 'answer', 'verdict', 'novel', 'score', 'rank', 'bm25', 'evidence', 'reuse', 'oraclePass', 'status', 'findings', 'lint'])
      assert.ok(!keys.has(k), `${b.port}: state has no '${k}' field`);
  }
  // Stage A emits its questions by pattern id, not in the code ranker's order.
  const a = J.patternChoiceStageA({ task, shape: shapeOf(task), candidates: ['P13', 'P07', 'P12', 'P09'].map(id => loadL1().find(p => p.id === id)) });
  assert.deepEqual(Object.keys(a.request.questions), ['P07', 'P09', 'P12', 'P13']);
  assert.deepEqual(a.rewritten, { P07: true, P09: true, P12: true, P13: true });
  // The ledger keeps the baseline beside the state; the store refuses a row whose state contains it.
  const app = built[0], answers = Object.fromEntries(Object.keys(app.request.questions).map(k => [k, { type: 'noul', noul: 0.8, confidence: 0.71 }]));
  const rows = J.ledgerRows(app, answers, { item: { layer: 'L2', id: e.hash, version: 1 }, task: { key: 'test:1', bed: 'unit' }, baseline: { profile: 'not-novel', schema: 'match' }, decision: { taken: 'reuse', by: 'code', propensity: 1 }, jevVersion: 'jev-1.13.0' });
  for (const r of rows) {
    assert.ok(!JSON.stringify(r.request.state).includes('not-novel'));
    const id = lib.recordJudgment(r);
    assert.equal(typeof id, 'string');
  }
  assert.throws(() => lib.recordJudgment({ ...rows[0], request: { ...rows[0].request, state: { ...rows[0].request.state, code: { profile: 'not-novel', schema: 'match' } } } }), /baseline verdict is logged beside the state/);
  const logged = lib.judgmentRows();
  assert.equal(logged.length, rows.length);
  for (const r of logged) { assert.equal(r.port, 'applicability'); assert.deepEqual(r.options, ['false', 'true']); assert.match(r.meta.portVersion, /^applicability@[0-9a-f]{12}$/); assert.deepEqual(r.meta.optionOrder, ['false', 'true']); assert.equal(r.meta.jevVersion, 'jev-1.13.0'); }
});

test('T6: every criteria map of the port builders and of the 12 cards\' when[] passes the option audit; the designed texts that failed are recorded', t => {
  const qs = [], lib = openLibrary(tmp(t), { now: clock() });
  for (const b of allBuilt(lib, registerSum(lib))) for (const [id, q] of Object.entries(b.request.questions)) qs.push([`${b.port}.${id}`, q]);
  for (const [id, q] of Object.entries(J.ROLE_TEXT)) qs.push([`role.${id}`, { type: 'choice', ...q }]);
  for (const id of FIRST_SLICE) for (const w of loadCard(id).when) if (w.type === 'choice') qs.push([`${id}.${w.id}`, w]);
  let choices = 0;
  for (const [id, q] of qs) { const a = J.optionAudit(q); if (q.type === 'choice') choices++; assert.ok(a.ok, `${id}: ${a.problems.join('; ')}`); }
  assert.ok(choices >= 17, `${choices} choice questions audited`);
  // The JEV-PORTS §5 designed texts fail (56% shared content words) and the card's original P01 J2 'one-pass' had no
  // discriminating word: both were revised (AUDIT_REVISIONS) and the revisions pass above.
  const designed = { type: 'choice', criteria: { ...J.RISK_TEXT.criteria, ...J.AUDIT_REVISIONS['risk-class/risk'] } };
  assert.match(J.optionAudit(designed).problems.join(), /internal-reversible \/ internal-irreversible share 56%/);
  const p01 = { type: 'choice', criteria: { ...loadCard('P01').when.find(w => w.id === 'J2').criteria, ...J.AUDIT_REVISIONS['card P01/J2'] } };
  assert.match(J.optionAudit(p01).problems.join(), /one-pass has no discriminating word/);
  // The audit itself: a missing no-match option and an overlapping pair are both caught.
  assert.deepEqual(J.optionAudit({ type: 'choice', criteria: { a: 'the red invoice is paid', b: 'the red invoice is paid late' } }).problems, ['no no-match option', 'a / b share 75% of their content words', 'a has no discriminating word']);
});

test('step 7: the answer converter reads noul, score and choice answers; malformed answers are refused', () => {
  const n = J.fromJevAnswer({ type: 'noul', noul: 0.83, confidence: 0.78 }, { type: 'noul', instructions: 'x' });
  assert.deepEqual(Object.keys(n.probabilities), ['false', 'true']); assert.equal(n.chosen, 'true'); assert.ok(Math.abs(n.confidence - 0.83) < 1e-12); assert.equal(n.jevConfidence, 0.78);
  assert.equal(J.fromJevAnswer({ type: 'noul', noul: 0.2 }, { type: 'noul' }).chosen, 'false');
  const s = J.fromJevAnswer({ type: 'score', probabilities: { 0: 0.1, 1: 0.2, 2: 0.6, 3: 0.1 } }, { type: 'score', criteria: ['a', 'b', 'c', 'd'] });
  assert.equal(s.chosen, '2'); assert.deepEqual(Object.keys(s.probabilities), ['0', '1', '2', '3']);
  assert.equal(J.fromJevAnswer({ type: 'score', probabilities: [0.7, 0.3] }, { type: 'score', criteria: ['a', 'b'] }).chosen, '0');
  const c = J.fromJevAnswer({ type: 'choice', probabilities: { flake: 0.1, env: 0.1, drift: 0.1, defect: 0.6, impossible: 0.05, none: 0.05 } }, { type: 'choice', criteria: J.CAUSE_TEXT.criteria });
  assert.equal(c.chosen, 'defect');
  assert.throws(() => J.fromJevAnswer({ type: 'noul' }, { type: 'noul' }), /no probabilities/);
  assert.throws(() => J.fromJevAnswer({ type: 'score', probabilities: { 0: 0.5, 1: 0.5 } }, { type: 'score', criteria: ['a', 'b', 'c'] }), /do not match/);
  assert.throws(() => J.fromJevAnswer({ type: 'noul', probabilities: { false: 0.9, true: 0.9 } }, { type: 'noul' }), /sum to/);
  assert.throws(() => J.fromJevAnswer({ type: 'choice', noul: 0.4 }, { type: 'noul' }), /a choice answer/);
  // Labelled noul rows feed the calibration report (src/judgment.mjs) unchanged.
  const rows = Array.from({ length: 20 }, (_, i) => ({ ...J.fromJevAnswer({ type: 'noul', noul: i < 10 ? 0.9 : 0.2 }, { type: 'noul' }), options: ['false', 'true'], truth: i < 9 || i >= 18 ? 'true' : 'false' }));
  const rep = calibrationReport(rows);
  assert.equal(rep.n, 20); assert.ok(rep.accuracy > 0.5 && rep.ece >= 0);
});

test('step 7: port versions bump on any text change; decision rules: Jev vetoes but never admits, raises risk but never lowers it', () => {
  const q = { type: 'noul', instructions: 'Does `text` say so?' };
  assert.equal(J.portVersionOf('quarantined-read', q), J.portVersionOf('quarantined-read', { ...q }));
  assert.notEqual(J.portVersionOf('quarantined-read', q), J.portVersionOf('quarantined-read', { ...q, instructions: 'Does `text` say this?' }));
  const tau = { pre: 0.6, out: 0.6, unseen: 0.4, rule: 0.4 };
  const good = { pre_0: 0.9, same_output: 0.9, unseen_form: 0.1, extra_rule: 0.1 };
  assert.deepEqual(J.applicabilityDecision(good, tau, true), { admit: true, by: 'both' });
  assert.deepEqual(J.applicabilityDecision(good, tau, false), { admit: false, by: 'code' }, 'never admits a code refusal');
  assert.deepEqual(J.applicabilityDecision({ ...good, unseen_form: 0.7 }, tau, true), { admit: false, by: 'jev' }, 'vetoes a code pass');
  assert.equal(J.riskClassBaseline([]), 'pure');
  assert.equal(J.riskClassBaseline([{ kind: 'write', reversible: true }, { kind: 'send', external: true }]), 'external-message');
  assert.equal(J.riskClassBaseline([{ kind: 'pay' }]), 'financial-or-legal');
  assert.deepEqual(J.riskDecision('external-message', { chosen: 'pure', probabilities: { pure: 0.99 } }, 0.5), { class: 'external-message', by: 'code' });
  assert.deepEqual(J.riskDecision('pure', { chosen: 'financial-or-legal', probabilities: { 'financial-or-legal': 0.8 } }, 0.5), { class: 'financial-or-legal', by: 'jev' });
  assert.deepEqual(J.riskDecision('pure', { chosen: 'financial-or-legal', probabilities: { 'financial-or-legal': 0.4 } }, 0.5), { class: 'pure', by: 'code' });
  assert.equal(J.failureClassBaseline({ envCodes: ['MODEL_QUOTA'] }), 'env');
  assert.equal(J.failureClassBaseline({ replay: 'passed' }), 'flake');
  assert.equal(J.failureClassBaseline({ replay: 'same-failure', novelPaths: ['inputs.fx[].quote'] }), 'drift');
  assert.equal(J.failureClassBaseline({ replay: 'same-failure' }), 'defect');
  assert.throws(() => J.failureClassRequest({ event: { kind: 'guard' }, replay: 'maybe' }), /replay is/);
  // Profiles are described (describeProfile), never judged, in applicability state; long text is cut by code, marked.
  const desc = J.applicabilityRequest({ task, candidate: { contract: { output: { type: 'object' } }, profile: learnProfile(sampleTasks(3)), preconditions: [] } }).request.state.candidate.seen_inputs;
  assert.match(desc, /^profile jit-profile\/1/);
  assert.match(J.clipTokens(Array.from({ length: 400 }, (_, i) => `line ${i} of a long text`).join('\n'), 100), /…\[cut by code: \d+ more characters\]$/);
});
