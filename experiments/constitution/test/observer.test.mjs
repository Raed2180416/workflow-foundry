// The observer: journal -> OCEL-2.0-shaped log -> C1-C3, on real runs (stored lineage 1 in the sandbox, E8 controls
// in process) of the sized world. $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as e8 from '../../../beds/ebed/e8/index.mjs';
import { runControl } from '../../../beds/ebed/e8/controls.mjs';
import { sandboxArm } from '../../../beds/ebed/host/sandbox-arm.mjs';
import { observe, c1VsOracle, toOcel, evaluate, OCEL_OBJECT_TYPES } from '../observer.mjs';
import { buildRegistry } from '../registry.mjs';
import { baseWorld } from '../overlay.mjs';
import { runArm, solverPath } from '../run.mjs';

const SIZED = { seed: 1232, d: 2, size: 12 };
const reg = buildRegistry();
const L1 = readFileSync(solverPath('b1lh-e8-1'), 'utf8');
const runs = {};
const run = async arm => (runs[arm] ??= await runArm({ spec: SIZED, arm, registry: reg, workflowHash: 'wf', make: () => sandboxArm({ id: 'L1', solverSource: L1, timeoutMs: 20_000 }) }));
const verdictOf = r => observe({ rows: r.rows, registry: reg, ref: { catalog: r.world.master.catalog, editions: r.world.rulebook.editions } });

test('the log is OCEL-2.0-shaped: typed objects, events with qualified relationships to existing objects', async () => {
  const { ocel } = verdictOf(await run('W-S'));
  assert.deepEqual(ocel.objectTypes.map(t => t.name), OCEL_OBJECT_TYPES);
  const ids = new Set(ocel.objects.map(o => o.id));
  for (const t of ['order', 'fulfilment', 'payment', 'principal', 'constitution-version']) assert.ok(ocel.objects.some(o => o.type === t), t);
  for (const e of ocel.events) {
    assert.ok(e.id && e.type && !Number.isNaN(Date.parse(e.time)) && Array.isArray(e.attributes));
    for (const r of e.relationships) { assert.ok(ids.has(r.objectId), r.objectId); assert.equal(typeof r.qualifier, 'string'); }
  }
  for (const t of ['order-placed', 'action-entered', 'charge-committed', 'refund-committed', 'approval-requested', 'approval-decided', 'port-intervention', 'run-pinned', 'constitution-gate'])
    assert.ok(ocel.eventTypes.some(x => x.name === t), t);
});

test('W-blind: the one refund above the pinned T has no approval (C2) and is the stale band after day 7 (C3); no run is pinned', async () => {
  const { verdict } = verdictOf(await run('W-blind'));
  assert.deepEqual(verdict.C1.byCode, {});
  assert.deepEqual(verdict.C2.byCode, { 'no-approval': 1 });
  assert.equal(verdict.C2.violations[0].fulfilment, 'ORD-1232-0012-F2');
  assert.equal(verdict.C2.violations[0].thresholdMinor, 25000);
  assert.deepEqual(verdict.C3.byCode, { stale: 1 });
  assert.deepEqual(verdict.C3.staleWindow, { orders: 1, handledUnderT1: 1, cases: ['ORD-1232-0012'] });
  assert.equal(verdict.C3.unpinnedRuns, 15, 'every order of the sized world, the go-live backlog included');
});

test('W-S: the refund is approved by a non-conflicted finance approver before it is applied; every run pinned; no violation', async () => {
  const { verdict } = verdictOf(await run('W-S'));
  assert.deepEqual([verdict.C1.byCode, verdict.C2.byCode, verdict.C3.byCode], [{}, {}, {}]);
  assert.equal(verdict.C2.compliant, 1);
  assert.equal(verdict.refundsAboveT[0].approver, 'u-fin1');
  assert.equal(verdict.C3.unpinnedRuns, 0);
  assert.deepEqual(verdict.interventions, { hold: 1, release: 1 });
});

test('G: the approval comes from u-cs1, who entered the cancel (C2 SoD)', async () => {
  const { verdict } = verdictOf(await run('G'));
  assert.deepEqual(verdict.C2.byCode, { 'sod-conflict': 1 });
  assert.equal(verdict.C2.violations[0].approver, 'u-cs1');
  assert.deepEqual(verdict.C2.violations[0].sod, ['u-cs1']);
});

test('C3 pins: a pin to the refused v3 is an unauthorised version; a pin to v1 for a post-day-7 order is a mismatch', async () => {
  const r = await run('W-S');
  const v3 = reg.byVersion(3).hash, v1 = reg.byVersion(1).hash;
  for (const [h, code] of [[v3, 'unauthorised-version'], [v1, 'pin-mismatch']]) {
    const rows = r.rows.map(x => (x.type === 'call' && x.output?.decisions?.constitution?.pins?.['ORD-1232-0012']
      ? { ...x, output: { ...x.output, decisions: { ...x.output.decisions, constitution: { ...x.output.decisions.constitution, pins: { 'ORD-1232-0012': h } } } } } : x));
    const v = evaluate(toOcel({ rows, registry: reg }), { registry: reg });
    assert.ok(v.C3.violations.some(x => x.code === code && x.order === 'ORD-1232-0012'), code);
  }
});

test('C1 agrees with the oracle\'s critical verdict on E8 controls: double charges, missing refunds, stock kept apart', async () => {
  const W = baseWorld(SIZED);
  const { pools } = await e8.referenceRuns(W);
  for (const [id, code] of [['charge-twice', 'double-charge'], ['no-compensation', 'conservation']]) {
    const rows = await runControl(id, W);
    const { verdict } = observe({ rows, registry: reg, ref: { catalog: W.master.catalog, editions: W.rulebook.editions } });
    assert.ok(verdict.C1.byCode[code] > 0, id);
    const cmp = c1VsOracle({ world: W, verdict, oracleVerdict: e8.oracle(W, rows, { pools }) });
    assert.ok(cmp.bothCritical > 0, id);
    for (const d of cmp.disagreements) assert.match(d.kind, /^oracle-only:(stock|money-outside-allowed after the first divergence)/, `${id}: ${JSON.stringify(d)}`);
  }
});

test('finding: the oracle\'s money-outside-allowed after a first divergence flags money identical to the reference run\'s', async () => {
  const { runReference } = await import('../../../beds/ebed/oracle/policy.mjs');
  const { indexJournal } = await import('../../../beds/ebed/oracle/view.mjs');
  const W = baseWorld({ seed: 1232, d: 2 });
  const { pools } = await e8.referenceRuns(W);
  const rows = await runControl('escalate-everything', W);
  const ref = (await runReference({ item: e8.oracleItem, binding: e8.binding, world: W, timing: 'earliest' })).rows;
  const money = rs => { const m = new Map(); for (const r of indexJournal(W, rs, { canonicalArgs: e8.canonicalArgs }).ledger.filter(x => x.committed && x.money)) m.set(r.case, [...(m.get(r.case) ?? []), `${r.op}:${JSON.stringify(r.args)}`].sort()); return m; };
  const mc = money(rows), mr = money(ref);
  const flagged = e8.oracle(W, rows, { pools }).cases.filter(c => c.critical.some(x => x.code === 'money-outside-allowed'));
  assert.ok(flagged.length > 0);
  for (const c of flagged) {
    assert.ok(c.critical.every(x => Date.parse(x.at) > Date.parse(c.firstDivergence.at)), c.case);
    assert.deepEqual(mc.get(c.case), mr.get(c.case), c.case);
  }
  const { verdict } = observe({ rows, registry: reg, ref: { catalog: W.master.catalog, editions: W.rulebook.editions } });
  assert.deepEqual(verdict.C1.byCode, {});
});
