// Who decides what: the authority map (proposal v1), its examples-as-tests, versions, the proposal check, and the v0 export.
// nice -n 15 node --test app/onboarding/test/authority-map.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { starter, ruleFromApproval, mapProblems, AuthorityMaps, toConstitutionV0 } from '../authority-map.mjs';
import { evaluate, generateExamples, flips } from '../rule-examples.mjs';
import { orgPolicy } from '../proposal-check.mjs';
import { TemplateFormBuilder } from '../form-builder.mjs';
import { docProblems } from '../../../experiments/constitution/constitution.mjs';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'org-'));
function smallTeam() {
  const map = starter('small-team', { now: new Date('2026-10-21T09:00:00Z') });
  map.principals.push({ id: 'p-dana', name: 'Dana (Finance)', kind: 'human', roles: ['approver', 'rule-owner'] }, { id: 'p-sam', name: 'Sam', kind: 'human', roles: ['auditor'] });
  const row = map.approvals.find(a => a.actionClass === 'money-out');
  map.parameters.moneyOutApprovalAbove = { value: 250, unit: 'EUR' }; row.aboveParameter = 'moneyOutApprovalAbove'; row.approverPrincipal = 'p-dana';
  map.clauses.push(ruleFromApproval(map, row.id));
  return map;
}

test('every starter is a valid document; a one-signer setup carries the bootstrap warning', () => {
  for (const k of ['just-me', 'small-team', 'refund', 'blank']) {
    const { problems, warnings } = mapProblems(starter(k));
    assert.deepEqual(problems, [], k);
    assert.ok(warnings.some(w => /Only you have saved these rules/.test(w)), k);
  }
  assert.throws(() => starter('enterprise'), { code: 'ORG_STARTER' });
});

test('six generated examples at the edges of an amount rule; the requester never approves their own', () => {
  const map = smallTeam(), c = map.clauses[0];
  assert.deepEqual(c.examples.map(e => [e.case.amount, e.answer]), [[0, 'allowed'], [249.99, 'allowed'], [250, 'allowed'], [250.01, 'held'], [5000, 'held'], [500, 'blocked']]);
  assert.match(c.examples[5].label, /asked for by Dana \(Finance\)/);
  assert.equal(c.owner.principal, 'p-dana');
  const domain = { id: 'R9', check: { kind: 'never-outside-domain', domain: 'acme.example' } };
  assert.deepEqual(generateExamples(domain, map).map(e => e.answer), ['allowed', 'allowed', 'blocked', 'blocked', 'blocked', 'blocked']);
  assert.equal(evaluate({ check: { kind: 'max-per-run', n: 3 } }, map, { count: 4 }), 'blocked');
});

test('saving: examples must be confirmed; a change that flips a confirmed answer is refused until the person confirms it', () => {
  const dir = tmp();
  try {
    const maps = new AuthorityMaps(dir, { now: () => Date.parse('2026-10-21T09:00:00Z') });
    const map = smallTeam();
    assert.throws(() => maps.save(map), { code: 'ORG_INVALID', message: /confirm the examples/ });
    map.clauses[0].examples.forEach(e => { e.confirmed = true; });
    const v1 = maps.save(map);
    assert.equal(v1.version, 1); assert.ok(v1.warnings.some(w => /Only you have saved these rules/.test(w)));
    const next = structuredClone(maps.current().map);
    next.parameters.moneyOutApprovalAbove.value = 300;
    const f = flips(next);
    assert.deepEqual(f.map(x => [x.n, x.was, x.now]), [[4, 'held', 'allowed']], 'exactly one confirmed case flips');
    assert.throws(() => maps.save(next), { code: 'ORG_FLIPPED', message: /case 4 .*held.* into allowed/ });
    next.clauses[0].examples.find(e => e.n === 4).answer = 'allowed';
    const v2 = maps.save(next);
    assert.equal(v2.version, 2); assert.equal(maps.current().map.supersedes, v1.hash);
    assert.deepEqual(maps.verify(), { ok: true, versions: 2 });
    const file = path.join(dir, 'org', 'authority-map.v1.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('"Sam"', '"Samuel"'));
    assert.equal(maps.verify().ok, false, 'an edited earlier version breaks the chain');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('validation: owners hold their roles, approvers hold Approver, lower layers only narrow, dual roles are warned', () => {
  const map = smallTeam();
  map.approvals[0].approverPrincipal = 'p-sam';
  assert.ok(mapProblems(map).problems.some(p => /Sam approves money-out but doesn't hold the Approver role/.test(p)));
  const refund = starter('refund');
  refund.parameters.refundApprovalAbove.value = 1500;
  assert.ok(mapProblems(refund).problems.some(p => /above the Org policy limit of 1000 .* A lower layer may only narrow it/.test(p)));
  const sod = smallTeam();
  sod.clauses.push({ ...sod.clauses[0], id: 'R2', title: 'Keep approving and auditing apart', check: { kind: 'separation-of-duties', roles: ['approver', 'auditor'] } });
  assert.ok(mapProblems(sod).warnings.some(w => /You holds both approver and auditor/.test(w)));
});

test('proposal check: the map answers the expense limit ("Set by"), refuses a widening, and the form builder obeys', () => {
  const dir = tmp();
  try {
    const map = smallTeam(); map.clauses[0].examples.forEach(e => { e.confirmed = true; });
    new AuthorityMaps(dir).save(map);
    const policy = orgPolicy(dir);
    const filled = policy('expense-approval', {});
    assert.deepEqual(filled.prefill, { autoApproveUpTo: 250 });
    assert.equal(filled.answered[0].text, '€250 · set by you for Dana (Finance) (Org policy). Dana (Finance) hasn\'t confirmed it', 'the person at this computer wrote it down, for Dana (P3 walkthrough M5)');
    const wide = policy('expense-approval', { autoApproveUpTo: 2000 });
    assert.equal(wide.refusals[0].message, 'Not allowed here. The rule written down for Dana (Finance) (Org policy) caps this at €250. This automation can only make it stricter.');
    const b = new TemplateFormBuilder({ policy });
    assert.equal(b.build({ template: 'expense-approval', settings: { approver: 'dana@example.com', autoApproveUpTo: 2000 } }).status, 'build_failed');
    const ok = b.build({ template: 'expense-approval', settings: { approver: 'dana@example.com' } });
    assert.equal(ok.status, 'ready'); assert.equal(ok.understood.slots.autoApproveUpTo, 250, 'not asked: the map answered it');
    assert.deepEqual(policy('invoice-chase', {}).prefill, {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the refund starter exports to constitution v0 and passes its own validator (the vocabulary is the same)', () => {
  const map = starter('refund');
  map.clauses[0].examples.forEach(e => { e.confirmed = true; });
  const doc = toConstitutionV0(map);
  assert.deepEqual(docProblems(doc), []);
  assert.equal(doc.parameters.refundApprovalThresholdMinor, 50000);
  assert.deepEqual(doc.clauses.map(c => c.id), ['C1', 'C2', 'C3']);
  assert.throws(() => toConstitutionV0(starter('just-me')), { code: 'ORG_V0' });
});
