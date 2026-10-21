// Principals for human nodes (compromise D1; src/principals.mjs): role requirements, delegation of authority above a threshold, segregation
// of duties, and static satisfiability against the host's role matrix. The matrix is OT-0's constitution v1
// (experiments/constitution/instances/v1.json), used as the host supplies it. Synthetic local runs only; no model, no spend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Foundry } from '../src/foundry.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { validateWorkflow } from '../src/validate.mjs';
import { principalOf, requirementOf, roleMatrix, satisfiability } from '../src/principals.mjs';
import { verifyRun } from '../src/verify-run.mjs';

const constitution = JSON.parse(readFileSync(new URL('../experiments/constitution/instances/v1.json', import.meta.url), 'utf8'));
// v1 plus a CFO who holds both finance-approver and controller: someone may approve above the threshold.
const hostMatrix = { ...constitution, principals: [...constitution.principals, { id: 'u-cfo', kind: 'human', roles: ['finance-approver', 'controller'] }] };
const human = (id, extra = {}) => ({ id, kind: 'human', needs: [], description: `${id} decides`, question: `${id}?`, answerSchema: { type: 'boolean' }, ...extra });
const refund = ({ labels, segregation = [{ id: 'C2', nodes: ['enter', 'approve'] }], approve = {} } = {}) => ({
  schemaVersion: '1.0', id: 'Refund', version: 1, title: 'Refund with four eyes', goal: 'Refund only with an authorised, distinct approver.', domain: 'general',
  envelope: { assumptions: ['Synthetic'], risks: ['An unauthorised refund'], successCriteria: ['A distinct finance approver approved it'] },
  budget: { maxSteps: 10, maxConcurrency: 1, maxDurationMs: 60000, maxCost: 0 },
  inputSchema: { type: 'object', required: ['amountMinor'], properties: { amountMinor: { type: 'integer' } } },
  nodes: [human('enter', { principal: { role: 'cs-agent' } }),
    human('approve', { needs: ['enter'], principal: { role: 'finance-approver', threshold: { amount: { $ref: 'input.amountMinor' }, above: 50000, role: 'controller' } }, ...approve })],
  acceptance: [{ op: 'eq', left: { $ref: 'nodes.approve.answer' }, right: true }],
  ...(segregation ? { segregation } : {}), ...(labels ? { labels } : {})
});
function setup(t, { principals = hostMatrix } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-principals-'));
  const foundry = new Foundry(path.join(dir, 'workspace'), { principals });
  t.after(async () => { await foundry.close(); rmSync(dir, { recursive: true, force: true }); });
  return foundry;
}
const codes = (workflow, options = {}) => validateWorkflow(workflow, { registry: createDefaultRegistry(), ...options }).errors.map(e => e.code);

test('schema: a workflow without principals is unchanged; principal is for human nodes; segregation names principal-bearing human nodes', () => {
  const plain = refund({ segregation: null });
  plain.nodes = plain.nodes.map(({ principal, ...n }) => n);
  assert.deepEqual(codes(plain), []);
  assert.deepEqual(codes(plain, { principals: hostMatrix }), [], 'a matrix changes nothing for a workflow without principals');
  const onTask = refund(); onTask.nodes.push({ id: 'pay', kind: 'assert', needs: ['approve'], description: 'x', checks: [{ op: 'eq', left: 1, right: 1 }], principal: { role: 'controller' } });
  assert.ok(codes(onTask).includes('SCHEMA'), 'a principal on a non-human node is refused');
  assert.deepEqual(codes(refund({ segregation: [{ nodes: ['enter', 'ghost'] }] })), ['SOD_NODE']);
  const bare = refund(); delete bare.nodes[0].principal;
  assert.deepEqual(codes(bare), ['SOD_NODE'], 'a segregation rule needs identified actors on every node it names');
  assert.ok(codes(refund({ segregation: [{ nodes: ['enter', 'enter'] }] })).includes('SCHEMA'), 'a node is never segregated from itself');
});

test('static satisfiability against the role matrix: an assignment as evidence, or a named refusal', () => {
  const ok = validateWorkflow(refund(), { registry: createDefaultRegistry(), principals: hostMatrix });
  assert.equal(ok.valid, true, JSON.stringify(ok.errors));
  const a = ok.principalAssignment;
  assert.notEqual(a.enter, a.approve);
  const m = roleMatrix(hostMatrix);
  assert.ok(principalOf(m, a.enter).roles.includes('cs-agent') && principalOf(m, a.approve).roles.includes('finance-approver'));
  // Under v1 as written nobody holds finance-approver + controller: the above-threshold path can never be answered.
  assert.deepEqual(codes(refund(), { principals: constitution }), ['PRINCIPAL_ROLE_UNHELD']);
  // One person holds both duties: the rule can never be met.
  const solo = { roles: ['cs-agent', 'finance-approver', 'controller'], principals: [{ id: 'p1', kind: 'human', roles: ['cs-agent', 'finance-approver', 'controller'] }] };
  assert.deepEqual(codes(refund(), { principals: solo }), ['SOD_UNSATISFIABLE']);
  // Two people, but the only one who may approve above the threshold is also the only one who may enter: met below, never above.
  const tight = { roles: ['cs-agent', 'finance-approver', 'controller'], principals: [{ id: 'p1', kind: 'human', roles: ['cs-agent', 'finance-approver', 'controller'] }, { id: 'p2', kind: 'human', roles: ['finance-approver'] }] };
  const r = satisfiability(refund(), roleMatrix(tight));
  assert.deepEqual(r.problems.map(p => [p.code, p.severity]), [['SOD_UNSATISFIABLE_ABOVE_THRESHOLD', 'warning']]);
  assert.deepEqual(r.assignment, { enter: 'p1', approve: 'p2' });
  // A class principal supplies many distinct actors.
  const customers = { roles: ['customer'], principals: [{ id: 'cust:*', kind: 'customer-class', roles: ['customer'] }] };
  const twoCustomers = refund({ segregation: [{ nodes: ['enter', 'approve'] }] });
  twoCustomers.nodes[0].principal = { role: 'customer' }; twoCustomers.nodes[1].principal = { role: 'customer' };
  assert.deepEqual(codes(twoCustomers, { principals: customers }), []);
  assert.equal(principalOf(roleMatrix(customers), 'cust:42').id, 'cust:*'); assert.equal(principalOf(roleMatrix(customers), 'cust:'), null);
  assert.throws(() => roleMatrix({ roles: ['a'], principals: [{ id: 'x', kind: 'human', roles: ['b'] }] }), { code: 'PRINCIPALS_INVALID' });
});

test('delegation of authority is bound when the question is asked; an unreadable or untrusted amount counts as above', () => {
  const p = { role: 'finance-approver', threshold: { amount: { $ref: 'input.a' }, above: 50000, role: 'controller' } };
  assert.deepEqual(requirementOf(p, { amount: 100, trusted: true }).roles, ['finance-approver']);
  assert.deepEqual(requirementOf(p, { amount: 50001, trusted: true }).roles, ['finance-approver', 'controller']);
  assert.equal(requirementOf(p, { amount: 100, trusted: false }).threshold.why, 'amount derived from untrusted data');
  assert.equal(requirementOf(p, { amount: 'lots', trusted: true }).threshold.why, 'amount unreadable');
});

test('runtime: role, delegation of authority and segregation of duties are enforced on answers; the chain records who and under which matrix', async t => {
  const foundry = setup(t);
  foundry.save(refund());
  const run = foundry.createRun('Refund', { amountMinor: 60000 });
  assert.equal((await foundry.startRun(run.id)).status, 'awaiting_human');
  const answer = (node, actor) => foundry.runtime.answer(run.id, `root/${node}`, true, { actor, channel: 'test' });
  assert.throws(() => foundry.runtime.answer(run.id, 'root/enter', true), { code: 'PRINCIPAL_REQUIRED' });
  assert.throws(() => answer('enter', 'mallory'), { code: 'PRINCIPAL_UNKNOWN' });
  assert.throws(() => answer('enter', 'u-fin2'), { code: 'PRINCIPAL_ROLE' });
  answer('enter', 'u-cs1');
  const asked = await foundry.startRun(run.id);
  assert.equal(asked.status, 'awaiting_human');
  assert.deepEqual(asked.nodes.approve.principal.roles, ['finance-approver', 'controller'], 'EUR 600.00 is above the threshold');
  assert.throws(() => answer('approve', 'u-fin2'), error => error.code === 'PRINCIPAL_ROLE' && /controller/.test(error.message) && /delegation of authority above 50000/.test(error.message));
  // u-cs1 holds finance-approver but entered the refund: refused for segregation, not for lack of a role.
  const narrow = setup(t, { principals: { ...hostMatrix, principals: hostMatrix.principals.map(p => (p.id === 'u-cs1' ? { ...p, roles: [...p.roles, 'controller'] } : p)) } });
  narrow.save(refund());
  const second = narrow.createRun('Refund', { amountMinor: 60000 });
  await narrow.startRun(second.id);
  narrow.runtime.answer(second.id, 'root/enter', true, { actor: 'u-cs1' });
  await narrow.startRun(second.id);
  assert.throws(() => narrow.runtime.answer(second.id, 'root/approve', true, { actor: 'u-cs1' }), { code: 'SOD_VIOLATION' });
  // The CFO holds both roles and did not enter it.
  answer('approve', 'u-cfo');
  const done = await foundry.startRun(run.id);
  assert.equal(done.status, 'succeeded');
  const answered = foundry.store.events(run.id).filter(e => e.type === 'human.answered');
  assert.deepEqual(answered.map(e => [e.nodeKey, e.actor, e.actorVerified, e.principal.principal, e.principal.roles]),
    [['root/enter', 'u-cs1', true, 'u-cs1', ['cs-agent']], ['root/approve', 'u-cfo', true, 'u-cfo', ['finance-approver', 'controller']]]);
  assert.ok(answered.every(e => e.principal.matrixHash === roleMatrix(hostMatrix).hash && e.channel === 'test'));
  assert.equal(verifyRun(foundry.store, run.id).ok, true);
});

test('runtime: below the threshold one role suffices, an untrusted amount does not; no matrix, no principal answers; old workflows unchanged', async t => {
  const foundry = setup(t);
  foundry.save(refund());
  const low = foundry.createRun('Refund', { amountMinor: 100 });
  await foundry.startRun(low.id);
  foundry.runtime.answer(low.id, 'root/enter', true, { actor: 'u-cs2' });
  assert.deepEqual((await foundry.startRun(low.id)).nodes.approve.principal.roles, ['finance-approver']);
  foundry.runtime.answer(low.id, 'root/approve', true, { actor: 'u-fin2' });
  assert.equal((await foundry.startRun(low.id)).status, 'succeeded');
  // The same small amount, but the input field is labelled untrusted (e.g. copied from a customer's e-mail): fail closed.
  const tainted = setup(t);
  tainted.save(refund({ labels: { 'input.amountMinor': 'untrusted:customer-email' } }));
  const tr = tainted.createRun('Refund', { amountMinor: 100 });
  await tainted.startRun(tr.id);
  tainted.runtime.answer(tr.id, 'root/enter', true, { actor: 'u-cs2' });
  const held = await tainted.startRun(tr.id);
  assert.deepEqual(held.nodes.approve.principal.roles, ['finance-approver', 'controller']);
  assert.equal(held.nodes.approve.principal.threshold.why, 'amount derived from untrusted data');
  // No role matrix on this host: principal answers are refused, never waved through; creation still works (structure only).
  const bare = setup(t, { principals: null });
  bare.save(refund());
  const br = bare.createRun('Refund', { amountMinor: 1 });
  await bare.startRun(br.id);
  assert.throws(() => bare.runtime.answer(br.id, 'root/enter', true, { actor: 'u-cs2' }), { code: 'PRINCIPAL_MATRIX_REQUIRED' });
  // A workflow the matrix can never satisfy is refused at creation.
  const strict = setup(t, { principals: { roles: ['cs-agent', 'finance-approver', 'controller'], principals: [{ id: 'p1', kind: 'human', roles: ['cs-agent', 'finance-approver', 'controller'] }] } });
  strict.save(refund());
  assert.throws(() => strict.createRun('Refund', { amountMinor: 1 }), error => error.code === 'INVALID_WORKFLOW' && error.details.some(e => e.code === 'SOD_UNSATISFIABLE'));
  // A workflow without principals: any answer, with or without an actor (recorded, not verified).
  const plain = refund({ segregation: null }); plain.id = 'Plain'; plain.nodes = plain.nodes.map(({ principal, ...n }) => n);
  foundry.save(plain);
  const pr = foundry.createRun('Plain', { amountMinor: 1 });
  await foundry.startRun(pr.id);
  foundry.runtime.answer(pr.id, 'root/enter', true);
  await foundry.startRun(pr.id);
  foundry.runtime.answer(pr.id, 'root/approve', true, { actor: 'anyone' });
  assert.equal((await foundry.startRun(pr.id)).status, 'succeeded');
  const e = foundry.store.events(pr.id).filter(x => x.type === 'human.answered');
  assert.equal(e[0].actor, undefined); assert.deepEqual([e[1].actor, e[1].actorVerified, e[1].principal], ['anyone', false, undefined]);
});
