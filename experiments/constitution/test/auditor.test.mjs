// The scripted auditor on the sized world: today's journal against the OT-0 evidence pack. $0 (stored lineage 1 in the
// sandbox).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sandboxArm } from '../../../beds/ebed/host/sandbox-arm.mjs';
import { audit, groundTruth, compare } from '../auditor.mjs';
import { buildRegistry } from '../registry.mjs';
import { runArm, solverPath } from '../run.mjs';
import { sha } from '../port.mjs';

const SIZED = { seed: 1232, d: 2, size: 12 };
const reg = buildRegistry();
const L1 = readFileSync(solverPath('b1lh-e8-1'), 'utf8');
const WF = sha(L1);
const runs = {};
const run = async arm => (runs[arm] ??= await runArm({ spec: SIZED, arm, registry: reg, workflowHash: WF, make: () => sandboxArm({ id: 'L1', solverSource: L1, timeoutMs: 20_000 }) }));

test('today\'s journal (W-blind host journal, no registry): Q1, Q2, Q3 and Q5 cannot be answered; Q4 does not apply', async () => {
  const r = await run('W-blind');
  const a = audit({ host: r.full, registry: null });
  assert.equal(a.chain, true); assert.equal(a.complete, true);
  const c = compare(a, groundTruth({ world: r.world, rows: r.rows, registry: reg }));
  assert.deepEqual(c.pass, { Q1: false, Q2: false, Q3: false, Q4: 'n/a', Q5: false });
  assert.match(c.why.Q1.join(), /journal no workflow hash/);
  assert.match(c.why.Q5.join(), /journal no constitution hash/);
  assert.equal(c.walkthrough, '0/10');
});

test('the blind journal with the registry: Q2 and Q3 are answered (the refund above T, with no approver); Q1 and Q5 still fail', async () => {
  const r = await run('W-blind');
  const a = audit({ host: r.full, registry: reg.journal() });
  const c = compare(a, groundTruth({ world: r.world, rows: r.rows, registry: reg }));
  assert.deepEqual(c.pass, { Q1: false, Q2: true, Q3: true, Q4: 'n/a', Q5: false });
  assert.equal(a.queries.Q3.population.length, 1);
  assert.equal(a.queries.Q3.population[0].approver, null);
});

test('the OT-0 evidence pack (W-S host journal + registry): all five queries pass and the walkthrough passes 10/10', async () => {
  const r = await run('W-S');
  const a = audit({ host: r.full, registry: reg.journal() });
  const c = compare(a, groundTruth({ world: r.world, rows: r.rows, registry: reg, port: r.port, workflowHash: WF }));
  assert.deepEqual(c.pass, { Q1: true, Q2: true, Q3: true, Q4: true, Q5: true });
  assert.equal(c.walkthrough, '10/10');
  assert.equal(a.queries.Q1.population[0].workflow, WF);
  const q3 = a.queries.Q3.population[0];
  assert.deepEqual([q3.approver, q3.approverHoldsRole, q3.sodOk], ['u-fin1', true, true]);
});

test('a rewritten host journal is caught: the chain fails and no population is claimed complete', async () => {
  const r = await run('W-S');
  const full = r.full.map(x => ({ ...x }));
  const i = full.findIndex(x => x.type === 'ledger' && x.system === 'billing' && x.op === 'refund');
  full[i] = { ...full[i], status: 'error' };
  const a = audit({ host: full, registry: reg.journal() });
  assert.equal(a.chain, false);
  assert.equal(a.queries.Q1.answerable, false);
  assert.match(a.queries.Q1.why.join(), /chain does not verify/);
});

test('G\'s journal: its interventions carry no constitution hash (Q4) and its runs no pin (Q5)', async () => {
  const r = await run('G');
  const c = compare(audit({ host: r.full, registry: reg.journal() }), groundTruth({ world: r.world, rows: r.rows, registry: reg, port: r.port }));
  assert.equal(c.pass.Q4, false); assert.equal(c.pass.Q5, false);
  assert.match(c.why.Q4.join(), /carry no constitution hash/);
});

test('a break-glass refund (C2-X1: three failed requests, then the controller) is an authorised exception listed for review', async () => {
  const r = await runArm({ spec: { seed: 1232, d: 3, size: null }, arm: 'W-S', registry: reg, workflowHash: WF, make: () => sandboxArm({ id: 'L1', solverSource: L1, timeoutMs: 20_000 }) });
  const a = audit({ host: r.full, registry: reg.journal() });
  const bg = a.queries.Q3.population.filter(p => p.breakGlass);
  assert.equal(bg.length, 1);
  assert.deepEqual([bg[0].approver, bg[0].approverHoldsRole, bg[0].sodOk], ['u-ctl1', true, true]);
  assert.deepEqual(a.queries.Q3.exceptionsForReview, [bg[0].key]);
  const c = compare(a, groundTruth({ world: r.world, rows: r.rows, registry: reg, port: r.port, workflowHash: WF }));
  assert.deepEqual(c.pass, { Q1: true, Q2: true, Q3: true, Q4: true, Q5: true });
});
