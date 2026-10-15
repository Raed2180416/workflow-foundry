// subflow.mjs (Z0): every hard refusal, the budget carve, child or inline (S2, S3, S4), mutant-checked credit, deopt back to
// the agent, memo replay, taint, and the answer's shape. Scripted model ports only ($0); checks run as real code in a fresh
// process (check-runner.mjs processCheckRunner).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubflowHost, mutantOf, sizeOf, sizeChange, isBig, chooseExecution, SUBFLOW_MODEL, REFUSALS, LIMITS, DETAIL_LABEL } from '../subflow.mjs';
import { processCheckRunner } from '../check-runner.mjs';
import path from 'node:path';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Ledger } from '../../lib/services.mjs';

const MODEL = 'claude-haiku-5-5';
const FREE = { models: [{ id: MODEL, provider: 'stub', class: 'M', price: { inputPerMTok: 0, outputPerMTok: 0 } }] };
const PRICED = { models: [{ id: MODEL, provider: 'stub', class: 'M', price: { inputPerMTok: 1, outputPerMTok: 5 } }] };
// A scripted port: answer(unitId, req) -> {value} | {error} (+ costUsd, latencyMs). The unit id is read from the prompt (UNIT=<id>).
function scripted(answer, { costUsd = 0.01, latencyMs = 10, policy = FREE } = {}) {
  const calls = [];
  return {
    policy, providers: {}, policyHash: 'stub', calls,
    async call(req) {
      const id = /UNIT=(\S+)/.exec(req.prompt)?.[1] ?? null;
      calls.push({ id, nodeKey: req.nodeKey, modelId: req.modelId });
      const a = (await answer(id, req)) ?? {};
      return { ok: !a.error, value: a.value, error: a.error ? { code: a.error } : null, costUsd: a.costUsd ?? costUsd, latencyMs: a.latencyMs ?? latencyMs, modelId: req.modelId };
    },
  };
}
const RETURNS = { type: 'object', required: ['total'], properties: { total: { type: 'number' } }, additionalProperties: false };
const CHECK = "export default (a, u) => a.total === u.input.reduce((s, x) => s + x, 0) ? null : 'total ' + a.total + ' is not the sum';";
const LAX = 'export default () => null;';
const units = (n, from = 0, prefix = 'u') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${from + i}`, input: [from + i, 1] }));
const sumOf = id => Number(String(id).replace(/^\D+/, '')) + 1;
const correct = id => ({ value: { total: sumOf(id) } });
const wrongOn = bad => id => (bad.includes(id) ? { value: { total: -1 } } : correct(id));
const req = (o = {}) => ({ v: 1, name: o.name ?? 'sum', units: o.units ?? units(3), worker: { prompt: 'UNIT={{id}} Sum the numbers: {{unit}}', ...(o.worker ?? {}) }, returns: RETURNS,
  ...(o.check === false ? {} : { checkSource: o.check ?? CHECK }), ...(o.extra ?? {}) });
const NODE_UNITS = units(10).map(u => u.id);
const nodeOf = (o = {}) => ({ id: 'agent:solve#0', taskKey: 'fam:dev:d3:s1', model: MODEL, units: NODE_UNITS, inputTokens: 100000, textLabel: 'synthetic', ...o });
const runner = processCheckRunner();
const hostOf = (o = {}) => {
  const port = o.port ?? scripted(correct);
  const host = createSubflowHost({ modelPort: port, node: nodeOf(o.node), ...(o.ledger ? { ledger: o.ledger } : { budgetUsd: o.budgetUsd ?? 1 }), checkRunner: 'checkRunner' in o ? o.checkRunner : runner,
    limits: o.limits, journal: o.journal, run: o.run });
  return { host, port };
};
// S3 up front: two failures the harness recorded name units of the request, so the call is a child from its first unit.
const FORCE_CHILD = { failures: [{ units: ['u0'] }, { units: ['u1'] }] };

test('pure parts: size, the size-change measure, the S2 threshold and the choice', () => {
  const r = req({ units: units(3) });
  assert.equal(sizeOf(r).units, 3); assert.ok(sizeOf(r).tokens > 0);
  assert.deepEqual([sizeChange({ units: NODE_UNITS }, r).smaller, sizeChange({ units: NODE_UNITS }, r).measure], [true, 'units-subset']);
  assert.equal(sizeChange({ units: ['u0', 'u1', 'u2'] }, r).smaller, false, 'the same unit set is not a strict subset');
  assert.equal(sizeChange({ units: ['u0', 'u1', 'u2'], inputTokens: 1e6 }, r).measure, 'input-tokens', 'else strictly fewer input tokens');
  assert.equal(sizeChange({ units: ['zz'] }, r).smaller, false); assert.equal(sizeChange({}, r).smaller, false, 'an unknown parent size is not shown smaller');
  assert.equal(isBig({ tokens: 30000, units: 32 }), false); assert.equal(isBig({ tokens: 30001, units: 0 }), true); assert.equal(isBig({ tokens: 0, units: 33 }), true);
  assert.deepEqual(chooseExecution({ big: true }), { executedAs: 'inline', reason: 'default' }, 'size alone never makes a child');
  assert.deepEqual(chooseExecution({ big: false, probe: { failed: 2, slow: true } }), { executedAs: 'inline', reason: 'default' }, 'nor failure alone');
  assert.deepEqual(chooseExecution({ big: true, probe: { failed: 1, slow: false } }), { executedAs: 'child', reason: 'S2' });
  assert.deepEqual(chooseExecution({ big: true, probe: { failed: 0, slow: true } }), { executedAs: 'child', reason: 'S2' });
  assert.equal(chooseExecution({ s3: true }).reason, 'S3'); assert.equal(chooseExecution({ s4: true }).reason, 'S4');
  assert.deepEqual(REFUSALS, ['bad-request', 'S0', 'taint', 'depth', 'count', 'budget', 'size-change']);
  assert.deepEqual([LIMITS.maxDynamicDepth, LIMITS.maxPerRun, LIMITS.childShare, LIMITS.firstUnitShare, LIMITS.bigTokens, LIMITS.bigUnits, LIMITS.deoptShare], [1, 4, 0.5, 0.25, 30000, 32, 0.5]);
});

test('hard refusals come back as values with the reason; they cost nothing, run nothing and count nothing; the agent carries on', async () => {
  const { host, port } = hostOf();
  const refused = async (raw, code) => { const v = await host.request(raw); assert.equal(v.status, 'refused', JSON.stringify(v)); assert.equal(v.refused, code, JSON.stringify(v)); assert.equal(v.costUsd, 0); return v; };
  // bad-request
  await refused(null, 'bad-request');
  await refused({ ...req(), v: 2 }, 'bad-request');
  await refused(req({ units: [] }), 'bad-request');
  await refused(req({ units: [{ id: 'u0', input: 1 }, { id: 'u0', input: 2 }] }), 'bad-request');
  await refused({ ...req(), worker: {} }, 'bad-request');
  await refused({ ...req(), returns: { type: 'string', pattern: '^a' } }, 'bad-request');   // an untrusted regular expression
  await refused(req({ worker: { model: 'claude-opus-5-5' } }), 'bad-request');               // not one of the node's models
  // S0: effects, durable waits and approvals are engine structure
  for (const extra of [{ effects: 'write' }, { wait: { signal: 'customer-reply' } }, { approval: true }]) {
    const v = await refused(req({ extra }), 'S0'); assert.match(v.detail.rule, /engine structure/);
  }
  // taint: the same asks from a tainted request
  await refused(req({ units: [{ id: 'u0', input: [0, 1], untrusted: true }], extra: { effects: 'send-mail' } }), 'taint');
  await refused(req({ extra: { tainted: true, effects: 'write' } }), 'taint');
  // size-change: neither a strict subset of the node's units nor fewer input tokens (a node of 10 input tokens)
  const small = hostOf({ node: { inputTokens: 10 } });
  const sc = await small.host.request(req({ units: units(2, 0, 'x') }));
  assert.equal(sc.refused, 'size-change'); assert.equal(sc.detail.parentTokens, 10); assert.equal(sc.detail.measure, null); assert.equal(small.port.calls.length, 0);
  // budget: more than half the remainder
  const b = await refused(req({ extra: { budgetUsd: 0.6 } }), 'budget');
  assert.equal(b.detail.maxUsd, 0.5);
  assert.equal(port.calls.length, 0, 'no refusal reached the model');
  assert.equal(host.ledger.spentUsd, 0); assert.equal(host.run.executed, 0);
  // ... and the agent carries on: a well-formed request runs.
  const ok = await host.request(req());
  assert.equal(ok.status, 'ok'); assert.equal(port.calls.length, 3);
  const t = host.totals();
  assert.equal(t.refusals['bad-request'], 7); assert.equal(t.refusals.S0, 3); assert.equal(t.refusals.taint, 2); assert.equal(t.refusals.budget, 1);
});

test('size-change: an unknown or no-smaller parent refuses; fewer input tokens is enough without a unit set', async () => {
  const none = hostOf({ node: { units: undefined, inputTokens: undefined } });
  assert.equal((await none.host.request(req())).refused, 'size-change');
  const same = hostOf({ node: { units: ['u0', 'u1', 'u2'], inputTokens: 5 } });
  const v = await same.host.request(req());
  assert.equal(v.refused, 'size-change'); assert.equal(v.detail.parentUnits, 3); assert.equal(v.detail.childUnits, 3);
  const tokens = hostOf({ node: { units: undefined, inputTokens: 60000 } });
  const ok = await tokens.host.request(req({ units: units(2, 0, 'x') }));
  assert.equal(ok.status, 'ok'); assert.equal(tokens.host.events.at(-1).measure, 'input-tokens');
});

test('depth: one dynamic level below an agent node; count: 4 executed calls per run, shared by the run\'s hosts', async () => {
  const deep = hostOf({ node: { dynamicDepth: 1 } });
  const d = await deep.host.request(req());
  assert.equal(d.refused, 'depth'); assert.deepEqual(d.detail, { depth: 2, maxDynamicDepth: 1 }); assert.equal(deep.port.calls.length, 0);
  const run = { executed: 0 };
  const a = hostOf({ run }), b = hostOf({ run, node: { id: 'agent:other#0' } });
  for (let i = 0; i < 3; i++) assert.equal((await a.host.request(req({ units: units(1, i) }))).status, 'ok');
  assert.equal((await b.host.request(req({ units: units(1, 5) }))).status, 'ok');
  const c = await b.host.request(req({ units: units(1, 6) }));
  assert.equal(c.refused, 'count'); assert.deepEqual(c.detail, { executed: 4, maxPerRun: 4 });
  assert.equal(run.executed, 4);
});

test('budget carve: half the node\'s remainder by default, held on its ledger while the call runs, charged once; the next call halves the new remainder', async () => {
  const ledger = new Ledger({ capUsd: 1, label: 'node' });
  const seen = [];
  const port = scripted(id => { seen.push(ledger.reservedUsd); return correct(id); }, { costUsd: 0.1 });
  const { host } = hostOf({ ledger, port });
  const v = await host.request(req());
  assert.equal(v.budgetUsd, 0.5); assert.equal(v.costUsd, 0.3);
  assert.deepEqual(seen, [0.5, 0.5, 0.5], 'the call\'s budget is held on the node ledger while it runs');
  assert.equal(ledger.reservedUsd, 0); assert.equal(ledger.inFlight, 0); assert.equal(Math.round(ledger.spentUsd * 1e6) / 1e6, 0.3); assert.equal(ledger.calls, 1);
  // remainder 0.7: at most 0.35
  const over = await host.request(req({ units: units(2, 3), extra: { budgetUsd: 0.36 } }));
  assert.equal(over.refused, 'budget'); assert.equal(over.detail.maxUsd, 0.35);
  const fits = await host.request(req({ units: units(2, 3), extra: { budgetUsd: 0.35 } }));
  assert.equal(fits.status, 'ok'); assert.equal(fits.budgetUsd, 0.35);
  // a remainder whose half is below the floor
  const poor = hostOf({ budgetUsd: 0.001 });
  const p = await poor.host.request(req());
  assert.equal(p.refused, 'budget'); assert.equal(p.detail.maxUsd, 0.0005);
});

test('budget carve inside the call: a unit whose reservation no longer fits falls back with cause budget (never a silent overspend)', async () => {
  const port = scripted(correct, { costUsd: 0.05, policy: PRICED });   // reservation about $0.04 per unit (8000 output tokens at $5/M)
  const { host } = hostOf({ port });
  const v = await host.request(req({ extra: { budgetUsd: 0.12 } }));
  assert.equal(v.status, 'ok'); assert.deepEqual(Object.keys(v.units), ['u0', 'u1']);
  assert.deepEqual(v.fallback, [{ id: 'u2', cause: 'budget' }]); assert.equal(port.calls.length, 2);
  assert.ok(v.costUsd <= 0.12);
});

test('S2: a big request whose inline probe fails becomes a child for the rest; a clean probe stays inline; failure without size stays inline', async () => {
  const limits = { probeUnits: 2, bigUnits: 4 };
  const failing = hostOf({ limits, port: scripted(wrongOn(['u1'])) });
  const v = await failing.host.request(req({ units: units(6) }));
  assert.equal(v.executedAs, 'child'); assert.equal(v.reason, 'S2');
  assert.deepEqual(v.probe, { k: 2, failed: 1, slow: false, meanMs: 10 });
  assert.deepEqual(Object.keys(v.units), ['u0', 'u2', 'u3', 'u4', 'u5']);
  assert.deepEqual(v.fallback.map(f => [f.id, f.cause]), [['u1', 'check']]);
  assert.deepEqual(v.verifiedUnits, ['u2', 'u3', 'u4', 'u5'], 'the child\'s units are verified; the inline probe\'s are the agent\'s');
  assert.equal(v.credit, 'agent', 'credit is verified only when every delivered unit is');
  const rec = failing.host.records.get(v.handle);
  assert.deepEqual([rec.units.u0.mode, rec.units.u2.mode], ['inline', 'child']);
  const clean = hostOf({ limits });
  const c = await clean.host.request(req({ units: units(6) }));
  assert.equal(c.executedAs, 'inline'); assert.equal(c.reason, 'default'); assert.equal(c.probe.failed, 0); assert.equal(c.mutant, undefined); assert.equal(c.credit, 'agent');
  const small = hostOf({ limits, port: scripted(wrongOn(['u1'])) });
  const s = await small.host.request(req({ units: units(3) }));
  assert.equal(s.executedAs, 'inline'); assert.equal(s.probe, undefined); assert.deepEqual(s.fallback.map(f => f.id), ['u1']);
  // slow: the probe's mean unit time x all units exceeds the call's timeout
  const slow = hostOf({ limits, port: scripted(correct, { latencyMs: 1000 }) });
  const w = await slow.host.request(req({ units: units(6), extra: { timeoutMs: 5000 } }));
  assert.equal(w.executedAs, 'child'); assert.equal(w.reason, 'S2'); assert.equal(w.probe.slow, true); assert.equal(w.probe.failed, 0);
});

test('S3: two failures that named units of the request make it a child up front; S4: a repeated structure that cost something does too', async () => {
  const s3 = hostOf({ node: FORCE_CHILD });
  const v = await s3.host.request(req());
  assert.equal(v.executedAs, 'child'); assert.equal(v.reason, 'S3'); assert.equal(v.probe, undefined);
  const one = hostOf({ node: { failures: [{ units: ['u0'] }, { units: ['u9'] }] } });
  assert.equal((await one.host.request(req())).executedAs, 'inline', 'only failures naming units of this request count');
  // failures recorded by the host itself count too (a check failure names its unit)
  const hist = hostOf({ port: scripted(wrongOn(['u1'])), limits: { childOverheadUsd: 1 } });   // a large overhead keeps S4 out of the way
  assert.equal((await hist.host.request(req({ units: units(2) }))).executedAs, 'inline');
  assert.equal((await hist.host.request(req({ units: units(2, 1) }))).executedAs, 'inline');
  const third = await hist.host.request(req({ units: units(3) }));
  assert.equal(third.executedAs, 'child'); assert.equal(third.reason, 'S3');
  // S4
  const s4 = hostOf();
  assert.equal((await s4.host.request(req({ units: units(2) }))).executedAs, 'inline');
  const again = await s4.host.request(req({ units: units(2, 4) }));
  assert.equal(again.executedAs, 'child'); assert.equal(again.reason, 'S4');
  assert.equal(s4.host.events.at(-1).executedAs, 'child');
});

test('mutant credit: only a check that rejects the planted mutant earns verified; a lax check, no check or a broken runner leaves the units the agent\'s', async () => {
  const good = hostOf({ node: FORCE_CHILD });
  const v = await good.host.request(req());
  assert.deepEqual(v.mutant, { planted: true, unit: 'u0', caught: true });
  assert.equal(v.credit, 'verified'); assert.deepEqual(v.verifiedUnits, ['u0', 'u1', 'u2']);
  const st = good.host.events.at(-1).structure;
  assert.deepEqual(good.host.totals().falsePass[st], { planted: 1, caught: 1, rate: 0, share: 0.0125, deployable: true });
  const rec = good.host.records.get(v.handle);
  assert.equal(rec.child.mutant.path, 'total');
  assert.equal(good.host.events.at(-1).harvestEligible, true);
  const lax = hostOf({ node: FORCE_CHILD });
  const l = await lax.host.request(req({ check: LAX }));
  assert.deepEqual(l.mutant, { planted: true, unit: 'u0', caught: false });
  assert.equal(l.credit, 'agent'); assert.deepEqual(l.verifiedUnits, []);
  const lst = lax.host.events.at(-1).structure;
  assert.equal(lax.host.totals().falsePass[lst].deployable, false, 'a path that passes its mutant is not deployable');
  const none = hostOf({ node: FORCE_CHILD });
  const n = await none.host.request(req({ check: false }));
  assert.deepEqual(n.mutant, { planted: false, reason: 'no-check' }); assert.equal(n.credit, 'agent');
  // a runner that fails only on the mutant run: the mutant is not caught (an error never earns credit)
  let runs = 0;
  const flaky = { run: async a => (++runs === 2 ? { error: { code: 'CHECK_TIMEOUT' } } : runner.run(a)) };
  const f = hostOf({ node: FORCE_CHILD, checkRunner: flaky });
  const fv = await f.host.request(req());
  assert.deepEqual(fv.mutant, { planted: true, unit: 'u0', caught: false }); assert.equal(fv.credit, 'agent');
  // an answer with no type-preserving edit cannot be mutated: no credit
  const CONST = { type: 'object', required: ['ok'], properties: { ok: { const: true } } };
  const c = hostOf({ node: FORCE_CHILD, port: scripted(() => ({ value: { ok: true } })) });
  const cv = await c.host.request({ ...req({ check: 'export default a => a.ok === true ? null : "no";' }), returns: CONST });
  assert.equal(cv.mutant.planted, false); assert.equal(cv.credit, 'agent');
});

test('mutantOf: one type-preserving edit that still fits the schema; deterministic in its seed; null when none exists', () => {
  const schema = { type: 'object', properties: { n: { type: 'integer', minimum: 0 }, s: { type: 'string' }, b: { type: 'boolean' }, e: { enum: ['a', 'b'] } } };
  const v = { n: 0, s: 'AB-19', b: true, e: 'a' };
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const m = mutantOf(v, schema, `seed-${i}`);
    assert.ok(m); assert.notDeepEqual(m.value, v);
    const changed = Object.keys(v).filter(k => m.value[k] !== v[k]);
    assert.equal(changed.length, 1); assert.equal(typeof m.value[changed[0]], typeof v[changed[0]], 'type-preserving');
    seen.add(m.path);
    if (m.path === 'n') assert.equal(m.value.n, 1, 'n - 1 would break minimum 0');
    if (m.path === 's') assert.equal(m.value.s, 'AB-10', 'the last digit bumped');
    if (m.path === 'e') assert.equal(m.value.e, 'b', 'another enum member');
    assert.deepEqual(mutantOf(v, schema, `seed-${i}`), m, 'deterministic');
  }
  assert.equal(seen.size, 4, 'the seed rotates the leaf');
  assert.deepEqual(mutantOf({ rows: [{}, {}] }, { type: 'object' }, 'x').value, { rows: [{}] }, 'no scalar leaf: an array loses an element');
  assert.equal(mutantOf({ ok: true }, { properties: { ok: { const: true } } }, 'x'), null);
  assert.equal(mutantOf(null, {}, 'x'), null);
});

test('deopt back to the agent: half or more of the first k child units fall back, or a quarter of the budget goes before a delivered unit; the child is dropped with its reason', async () => {
  const limits = { probeUnits: 2 };
  const bad = hostOf({ node: FORCE_CHILD, limits, port: scripted(wrongOn(['u0', 'u1'])) });
  const v = await bad.host.request(req({ units: units(4) }));
  assert.equal(v.status, 'deopt'); assert.equal(v.executedAs, 'child');
  assert.deepEqual(v.deopt, { cause: 'fallback-rate', fellBack: 2, of: 2, share: 0.5 });
  assert.deepEqual(v.units, {}); assert.deepEqual(v.fallback.map(f => [f.id, f.cause]), [['u0', 'dropped'], ['u1', 'dropped'], ['u2', 'dropped'], ['u3', 'dropped']]);
  assert.deepEqual(bad.port.calls.map(c => c.id), ['u0', 'u1'], 'the rest never ran');
  assert.equal(bad.host.events.at(-1).kind, 'subflow-deopt'); assert.equal(bad.host.totals().deopts, 1);
  assert.equal(bad.host.journalOut.length, 0, 'a dropped child is not memoised');
  // one of two is under the share: no drop
  const half = hostOf({ node: FORCE_CHILD, limits: { probeUnits: 4 }, port: scripted(wrongOn(['u0'])) });
  const h = await half.host.request(req({ units: units(4) }));
  assert.equal(h.status, 'ok'); assert.deepEqual(Object.keys(h.units), ['u1', 'u2', 'u3']);
  // more than 25% of the child's budget spent before its first delivered unit
  const dear = hostOf({ node: FORCE_CHILD, limits: { probeUnits: 4 }, port: scripted(wrongOn(['u0', 'u1']), { costUsd: 0.06 }) });
  const d = await dear.host.request(req({ units: units(4), extra: { budgetUsd: 0.2 } }));
  assert.equal(d.status, 'deopt'); assert.equal(d.deopt.cause, 'budget-before-first-unit'); assert.equal(d.deopt.spentUsd, 0.06);
  assert.deepEqual(dear.port.calls.map(c => c.id), ['u0']);
  assert.equal(d.costUsd, 0.06, 'what the dropped child spent is still charged');
  // a check runner that cannot run: every unit falls back check-error (not a work failure) and the child is dropped
  const broken = hostOf({ node: FORCE_CHILD, limits, checkRunner: { run: async () => ({ error: { code: 'SANDBOX_UNAVAILABLE' } }) } });
  const bv = await broken.host.request(req({ units: units(4) }));
  assert.equal(bv.status, 'deopt'); assert.equal(broken.host.records.get(bv.handle).units.u0.was, 'check-error');
  // ... and the agent carries on
  const next = await bad.host.request(req({ units: units(2, 5) }));
  assert.equal(next.status, 'ok');
});

test('memo replay: a repeated child call is served at $0 from the run memo; a resumed host serves it from the journal; never another task\'s or node\'s; inline work is not memoised', async () => {
  const a = hostOf({ node: FORCE_CHILD });
  const first = await a.host.request(req());
  assert.equal(first.executedAs, 'child'); const calls = a.port.calls.length;
  const again = await a.host.request(req({ extra: { budgetUsd: 0.1 } }));
  assert.equal(again.memo, 'run'); assert.equal(again.costUsd, 0); assert.deepEqual(again.units, first.units); assert.equal(again.handle, first.handle);
  assert.equal(a.port.calls.length, calls, 'no model call'); assert.equal(a.host.run.executed, 1, 'not counted');
  assert.equal(a.host.events.at(-1).kind, 'subflow-memo');
  assert.equal(a.host.journalOut.length, 1);
  const resumed = hostOf({ node: FORCE_CHILD, journal: a.host.journalOut });
  const r = await resumed.host.request(req());
  assert.equal(r.memo, 'journal'); assert.deepEqual(r.units, first.units); assert.equal(resumed.port.calls.length, 0);
  const other = hostOf({ node: { ...FORCE_CHILD, taskKey: 'fam:dev:d3:s2' }, journal: a.host.journalOut });
  const o = await other.host.request(req());
  assert.equal(o.memo, undefined); assert.equal(other.port.calls.length, 3, 'another task never gets this task\'s answers');
  const otherNode = hostOf({ node: { ...FORCE_CHILD, id: 'agent:b#0' }, journal: a.host.journalOut });
  assert.equal((await otherNode.host.request(req())).memo, undefined);
  // inline: the agent's own work, executed again (here as an S4 child: the structure repeats)
  const inl = hostOf();
  const i1 = await inl.host.request(req());
  assert.equal(i1.executedAs, 'inline'); assert.equal(inl.host.journalOut.length, 0);
  const i2 = await inl.host.request(req());
  assert.equal(i2.memo, undefined); assert.equal(inl.port.calls.length, 6);
});

test('taint: a node not declared synthetic is tainted and its answers are labelled; an untrusted unit taints the call and the node stays tainted; detail text is always labelled', async () => {
  const third = hostOf({ node: { textLabel: undefined } });
  const t = await third.host.request(req());
  assert.equal(t.tainted, true); assert.equal(t.label, 'untrusted');
  const syn = hostOf({ port: scripted(wrongOn(['u1'])), limits: { childOverheadUsd: 1 } });   // keep S4 out: every call here runs inline
  const clean = await syn.host.request(req({ units: units(1, 5) }));
  assert.equal(clean.tainted, false); assert.equal(clean.label, undefined);
  const dirty = await syn.host.request(req({ units: [{ id: 'u0', input: [0, 1], untrusted: true }, { id: 'u1', input: [1, 1] }] }));
  assert.equal(dirty.tainted, true); assert.equal(dirty.label, 'untrusted');
  assert.deepEqual(dirty.fallback[0].detail, { label: DETAIL_LABEL, value: 'total -1 is not the sum' }, 'a check\'s words reach the agent labelled');
  const after = await syn.host.request(req({ units: units(1, 7) }));
  assert.equal(after.tainted, true, 'the node read a tainted answer: taint is sticky');
  assert.equal(syn.host.totals().tainted, true);
  assert.throws(() => createSubflowHost({ node: nodeOf({ textLabel: 'trusted' }), budgetUsd: 1 }), /textLabel/);
});

test('the answer is typed results and handles, never the transcript: no prompt, no raw output; the record stays on the host', async t => {
  const MARK = 'PROMPT-MARK-7f3a';
  const workRoot = mkdtempSync(path.join(tmpdir(), 'rec-sf-'));
  t.after(() => rmSync(workRoot, { recursive: true, force: true }));
  const host = createSubflowHost({ modelPort: scripted(id => (id === 'u1' ? { error: 'MODEL_SCHEMA' } : correct(id))), node: nodeOf(FORCE_CHILD), budgetUsd: 1, checkRunner: runner, workRoot });
  const v = await host.request(req({ worker: { prompt: `UNIT={{id}} ${MARK} {{unit}}`, system: `system ${MARK}` } }));
  const text = JSON.stringify(v);
  assert.equal(text.includes(MARK), false); assert.equal(JSON.stringify(host.records.get(v.handle)).includes(MARK), false);
  const files = readdirSync(path.join(workRoot, 'subflows'));
  assert.equal(files.length, 1, 'the child\'s record is on the host, behind the handle');
  assert.deepEqual(JSON.parse(readFileSync(path.join(workRoot, 'subflows', files[0]), 'utf8')).handle, v.handle);
  assert.equal(readFileSync(path.join(workRoot, 'subflows', files[0]), 'utf8').includes(MARK), false);
  assert.deepEqual(Object.keys(v).sort(), ['budgetUsd', 'costUsd', 'credit', 'executedAs', 'fallback', 'handle', 'mutant', 'name', 'reason', 'status', 'tainted', 'units', 'v', 'verifiedUnits']);
  assert.deepEqual(v.fallback, [{ id: 'u1', cause: 'error', detail: { label: DETAIL_LABEL, value: 'MODEL_SCHEMA' } }]);
  assert.match(v.handle, /^subflow:[0-9a-f]{16}#1$/);
  // a model answer outside returns falls back (returns), it is never passed through
  const extra = hostOf({ node: FORCE_CHILD, port: scripted(id => ({ value: { total: sumOf(id), notes: 'free text' } })) });
  const e = await extra.host.request(req());
  assert.deepEqual(e.units, {}); assert.equal(e.fallback[0].cause, 'dropped'); assert.equal(extra.host.records.get(e.handle).units.u0.was, 'returns');
});

test('port(): flow:subflow requests are the host\'s; every other model id goes to the inner port; the unit calls carry the node\'s model and the returns schema', async () => {
  const { host, port } = hostOf();
  const p = host.port();
  const r = await p.call({ modelId: SUBFLOW_MODEL, prompt: JSON.stringify(req()) });
  assert.equal(r.ok, true); assert.equal(r.modelId, SUBFLOW_MODEL); assert.equal(r.value.status, 'ok'); assert.equal(r.costUsd, 0.03);
  assert.equal(host.ledger.spentUsd, 0, 'port() never charges: the gateway does');
  const garbage = await p.call({ modelId: SUBFLOW_MODEL, prompt: 'not json' });
  assert.equal(garbage.value.refused, 'bad-request');
  const inner = await p.call({ modelId: MODEL, prompt: 'UNIT=u4 plain call' });
  assert.equal(inner.value.total, 5);
  assert.ok(port.calls.slice(0, 3).every(c => c.modelId === MODEL && c.nodeKey.startsWith('subflow/')));
  assert.equal(p.policy, port.policy);
});
