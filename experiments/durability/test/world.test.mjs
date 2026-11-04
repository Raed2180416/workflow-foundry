// DUR-1 world-level teeth on small rehearsal worlds (BUILD-PLAN rows 2-4, 7; validity gates V-1, V-2, V-4, V-6). Every
// world here is seed 1207 or 1208 at size <= 24 (a few seconds per run on a shared machine).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dryWorlds, T0_MS, DAY_MS } from '../schedule.mjs';
import { buildBundle, loadSealed, transitionSource, R1_EDIT, visibleConfig } from '../changes.mjs';
import { referencePools, gradeRun, criticalAtFirst, EXEMPT_EPOCHS } from '../oracle.mjs';
import { runBundle, referenceVersion, controlVersion, journalDigest, samePrefix, armVersion } from '../arms.mjs';
import { caseSignatures } from '../exposure.mjs';
import { signalsOfRun, m1Findings, IncidentBook } from '../monitor.mjs';
import { driftedItem } from '../../compose/drift.mjs';
import { e8Systems } from './helpers.mjs';
import { MockSystem } from '../../../beds/ebed/host/mocks.mjs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sealed = loadSealed(path.join(here, '../fixtures/sealed-stub.json'));
const [W1, W2] = dryWorlds();
const ref = referenceVersion({ id: 'reference-earliest', timing: 'earliest' });
const withEff = (b, eff) => { const W = structuredClone(b.W); W.truth.dur1Eff = { ...W.truth.dur1Eff, R1: eff }; return { ...b, W, key: `${b.key}@${eff}`, worldDigest: `${b.worldDigest}-${eff}` }; };

test('V-1 / V-2 / determinism: the reference passes every completed case of a changed world with 0 oracle errors, bad controls fail, the world and journal are reproducible', async () => {
  const b = await buildBundle(W1, { sealed });
  const again = await buildBundle(W1, { sealed });
  assert.equal(b.worldDigest, again.worldDigest, 'same world twice');
  const pools = await referencePools(b);
  assert.equal(pools.control.ok, true, pools.control.problems.join('; '));
  const r1 = await runBundle(b, { version: ref }), r2 = await runBundle(b, { version: ref });
  assert.equal(journalDigest(r1.rows), journalDigest(r2.rows), 'a deterministic arm replays byte-identically');
  for (const c of ['noop', 'charge-twice']) {
    const g = gradeRun(b, (await runBundle(b, { version: controlVersion(c) })).rows, pools.pools);
    assert.ok(g.passed < g.completed, `bad control ${c} must fail (${g.passed}/${g.completed})`);
  }
  const g = gradeRun(b, r1.rows, pools.pools);
  assert.ok(g.cases.filter(c => EXEMPT_EPOCHS.includes(c.epoch)).every(c => !c.graded), 'ep4 cases are never graded');
  assert.ok(g.completed > 0 && g.passed === g.completed);
});

test('V-4 effectiveFrom golden: an order placed exactly at the effective time follows the new rule, one minute before the old (p >= eff)', async () => {
  const b = await buildBundle(W1, { sealed });
  const c = [...b.touched.R1].sort()[0];
  assert.ok(c, 'R1 converted at least one order');
  const p = Date.parse(b.W.truth.cases[c].placedAt);
  const sig = async eff => { const bb = withEff(b, eff); return caseSignatures(bb, (await runBundle(bb, { version: ref })).rows).get(c); };
  const atEff = await sig(p), oneMinLate = await sig(p + 60_000), newRule = await sig(-Infinity), oldRule = await sig(Infinity);
  assert.notEqual(newRule, oldRule, 'R1 changes this order');
  assert.equal(atEff, newRule, 'placed at the effective time: the new rule (a gate on p > eff fails here)');
  assert.equal(oneMinLate, oldRule, 'placed one minute before the effective time: the old rule');
});

test('R1 with its gate open from t0 equals drift.mjs D1 exactly (same journal on the same world)', async () => {
  const b = await buildBundle(W1, { sealed });
  const dir = mkdtempSync(path.join(tmpdir(), 'dur1-d1-'));
  try {
    const d1 = await driftedItem('review-timeout-clears', dir);
    const open = withEff(b, -Infinity);
    const a = await runBundle(open, { version: ref });
    const bD1 = { ...open, item: d1, key: `${open.key}-D1`, itemDigest: 'drift-D1' };
    const d = await runBundle(bD1, { version: referenceVersion({ id: 'reference-earliest', timing: 'earliest', item: d1 }) });
    assert.equal(journalDigest(a.rows), journalDigest(d.rows));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stacked rule edits: two edits both apply; an anchor that occurs twice (or no longer occurs) throws', () => {
  const src = transitionSource([R1_EDIT, { id: 'dummy', from: "export function recordsOf(world, idx, c) {", to: "export function recordsOf(world, idx, c) { /* dur1 dummy */" }]);
  assert.ok(src.includes("__durEff(world, 'R1')") && src.includes('/* dur1 dummy */'));
  assert.throws(() => transitionSource([R1_EDIT, R1_EDIT]), /occurs 0 times/);
  assert.throws(() => transitionSource([{ id: 'x', from: 'return', to: 'return' }]), /occurs \d+ times/);
});

test('E1r: the reverted world has no F5 rename and its API file shows location (not site); its twin keeps the rename', async () => {
  const b = await buildBundle(W2, { sealed });
  assert.ok(!b.W.faults.some(f => f.kind === 'F5' && f.system === 'carrier'), 'no carrier rename in force');
  const twin = await buildBundle(W2, { sealed, exclude: ['E1r'] });
  assert.ok(twin.W.faults.some(f => f.kind === 'F5' && f.system === 'carrier' && f.params.to === 'site'));
  const m = new MockSystem(e8Systems().find(s => s.id === 'carrier'));
  const props = m.apiSchema(T0_MS + 3 * DAY_MS).ops.create.args.properties;
  assert.ok('location' in props && !('site' in props));
  // What a deployment sees: announced rules once published, never an unannounced rule (U1s).
  const cfg = visibleConfig(b, T0_MS + 13 * DAY_MS);
  assert.ok(cfg.rules.some(r => r.id === 'R2s') && !cfg.rules.some(r => r.id === 'U1s'));
  assert.ok(!visibleConfig(b, T0_MS).rules.some(r => r.id === 'R2s'), 'R2s is visible only from its publication (W2 d2 09:00)');
  await assert.rejects(buildBundle(W2, { sealed: null }), /needs the sealed bundle/);
});

test('oracle: critical only if the FIRST divergence is critical; two critical violations count once', () => {
  const at = '2026-03-04T10:00:00+01:00';
  const v = { firstDivergence: { code: 'duplicate', lid: 'chg:F1', at }, critical: [{ code: 'duplicate-money', lid: 'chg:F1', at }, { code: 'orphan-charge', fulfilment: 'F1', at }] };
  assert.equal(criticalAtFirst(v), true);
  const later = { firstDivergence: { code: 'late', lid: 'ntf:F1:x', at }, critical: [{ code: 'duplicate-money', lid: 'chg:F1', at: '2026-03-05T10:00:00+01:00' }] };
  assert.equal(criticalAtFirst(later), false, 'a later critical violation does not make the case critical');
});

test('monitor: a recovered effect error is not m1; m6 and m4 never open an incident; verifier-blind needs two complaints on one topic within 3 days', () => {
  const rows = [
    { type: 'effect.emit', emission: 'e1', effect: { system: 'billing', op: 'charge', args: { orderId: 'ORD-1' } } },
    { type: 'ledger', emission: 'e1', system: 'billing', op: 'charge', committed: false, error: { code: 503, reason: 'unavailable' }, at: '2026-03-02T10:00:00+01:00' },
    { type: 'effect.emit', emission: 'e2', effect: { system: 'billing', op: 'charge', args: { orderId: 'ORD-1' } } },
    { type: 'ledger', emission: 'e2', system: 'billing', op: 'charge', committed: true, at: '2026-03-02T10:05:00+01:00' },
    { type: 'effect.emit', emission: 'e3', effect: { system: 'notify', op: 'send', args: { orderId: 'ORD-2' } } },
    { type: 'ledger', emission: 'e3', system: 'notify', op: 'send', committed: false, error: { code: 400, reason: 'field-renamed', field: 'text', renamedTo: 'message' }, at: '2026-03-02T11:00:00+01:00' },
  ];
  const f = m1Findings(rows).byOrder;
  assert.ok(!f.has('ORD-1'), 'an error followed by a success of the same order, system and op is not a finding');
  assert.deepEqual([...f.get('ORD-2')], ['m1|notify.send|400|field-renamed']);
  const book = new IncidentBook({ label: 't' });
  let r = book.ingest([{ ch: 'm6', cls: 'm6|novel', at: 1 }, { ch: 'm4', cls: 'm4|announcement|spec', at: 1 }], { k: 1, day: 1, worldKey: 'w', streamDay: 1 });
  assert.equal(r.opened.length, 0); assert.equal(r.m4.length, 1); assert.equal(book.incidents.length, 0);
  const cmp = (id, topic, sd) => ({ ch: 'm5', cls: `m5|${topic}`, at: sd, order: `ORD-${id}`, complaint: { id, topic, at: sd, text: 'x', kind: 'false' } });
  r = book.ingest([cmp('a', 'charge', 1), cmp('b', 'refund', 1)], { k: 1, day: 1, worldKey: 'w', streamDay: 1 });
  assert.equal(r.verifierBlind.length, 0, 'two topics');
  r = book.ingest([cmp('c', 'charge', 5)], { k: 1, day: 5, worldKey: 'w', streamDay: 5 });
  assert.equal(r.verifierBlind.length, 0, 'same topic but 4 days apart');
  r = book.ingest([cmp('d', 'charge', 6)], { k: 1, day: 6, worldKey: 'w', streamDay: 6 });
  assert.equal(r.verifierBlind.length, 1, 'two on one topic within 3 days');
});

test('monitor on a correct deployment: no m1-m3 signal on any day of a world without changes (deadlines after a prefix are not judged early); m4 never names a case', async () => {
  const quiet = { stream: 'r1', k: 1, seed: 1208, size: 16, difficulty: 3, mix: 'tail', changes: [] };
  const b = await buildBundle(quiet, { sealed });
  const pools = await referencePools(b);
  const r = await runBundle(b, { version: ref });
  const s = await signalsOfRun({ bundle: b, rows: r.rows, pools: pools.pools });
  const all = Object.values(s.days).flat();
  assert.deepEqual(all.filter(x => ['m1', 'm2', 'm3'].includes(x.ch)).map(x => x.cls), []);
  const bw = await buildBundle(W1, { sealed });
  const rw = await runBundle(bw, { version: ref });
  const sw = await signalsOfRun({ bundle: bw, rows: rw.rows, pools: (await referencePools(bw)).pools });
  const m4 = Object.values(sw.days).flat().filter(x => x.ch === 'm4');
  assert.ok(m4.length >= 2, 'announcements of P1 and R1');
  assert.ok(m4.every(x => x.case === null && x.order === null));
});

test('V-6 prefix identity: a swap at T leaves the journal before T byte-identical; an arm with hidden randomness does not', async () => {
  const b = await buildBundle(W1, { sealed });
  const T = T0_MS + 5 * DAY_MS;
  const base = await runBundle(b, { version: ref });
  const noop = controlVersion('noop');
  const swapped = await runBundle(b, { timeline: [{ fromMs: -Infinity, version: ref }, { fromMs: T, version: noop }] });
  assert.equal(samePrefix(base.rows, swapped.rows, T), true);
  assert.equal(samePrefix(base.rows, swapped.rows, T + 3 * DAY_MS), false, 'after the swap the behaviour differs');
  const { referenceArm } = await import('../../../beds/ebed/oracle/policy.mjs');
  const coin = armVersion('coin', ({ bundle, journal }) => { const inner = referenceArm({ item: bundle.item, world: bundle.W, timing: 'earliest', journal }); return { id: 'coin', tick: (i, c) => (Math.random() < 0.3 ? { decisions: { subject: null }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], carry: i.carry } : inner.tick(i, c)) }; });
  const a1 = await runBundle(b, { version: coin }), a2 = await runBundle(b, { version: coin });
  assert.equal(samePrefix(a1.rows, a2.rows, T), false, 'a hidden Math.random breaks prefix identity (the re-execution ladder would call it a flake)');
});
