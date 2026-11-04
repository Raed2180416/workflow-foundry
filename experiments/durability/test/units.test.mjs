// DUR-1 pure units with teeth (BUILD-PLAN rows 5, 6, 8, 18): version registry, complaints, the m6 e-detector, the
// ledger meter and row rooms, freeze checks, the sealed loader and the author's structural bundle checks. No world runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VersionRegistry, verifyChain } from '../registry.mjs';
import { complaintDraws, trueComplaints, falseComplaints, deliveryOf, Q, falseFor } from '../complaints.mjs';
import { ECusum, conformalP, eValue, EPS, H } from '../edetector.mjs';
import { rng } from '../../../beds/lib/rng.mjs';
import { T0_MS, DAY_MS, HORIZON_DAYS } from '../schedule.mjs';
import { loadSealed } from '../changes.mjs';
import { bundleProblems } from '../author.mjs';
import { rowOf, rowRoom, ledgerMeter } from '../paid.mjs';
import { checkFreeze } from '../freeze.mjs';
import { paidSession } from '../run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.join(here, '../fixtures/sealed-stub.json');
const tmp = () => mkdtempSync(path.join(tmpdir(), 'dur1-test-'));

test('registry: compare-and-swap refuses a stale head, self-approval is refused, an edited past entry breaks the chain', () => {
  const r = new VersionRegistry({ label: 't', genesis: { id: 'v0', digest: 'd0' }, at: 'x' });
  const h0 = r.head().hash;
  r.promote({ expectHead: h0, version: { id: 'v1', digest: 'd1' }, proposer: 'session', approver: 'code-gate', at: 'y' });
  assert.throws(() => r.promote({ expectHead: h0, version: { id: 'v2', digest: 'd2' }, proposer: 'session', approver: 'code-gate', at: 'z' }), /STALE_HEAD/);
  assert.throws(() => r.promote({ expectHead: r.head().hash, version: { id: 'v2', digest: 'd2' }, proposer: 'code-gate', approver: 'code-gate', at: 'z' }), /SELF_APPROVAL/);
  r.rollback({ expectHead: r.head().hash, to: { id: 'v0', digest: 'd0' }, at: 'w' });
  assert.equal(r.current().digest, 'd0');
  assert.throws(() => r.rollback({ expectHead: r.head().hash, to: { id: 'vX', digest: 'never' }, at: 'w' }), /UNKNOWN_VERSION/);
  const entries = JSON.parse(JSON.stringify(r.toJSON().entries));
  assert.equal(verifyChain(entries), true);
  entries[1].version.digest = 'tampered';
  assert.throws(() => verifyChain(entries), /ENTRY_EDITED/);
});

const gradeOf = (pass, extra = {}) => ({ cases: [
  { case: 'c1', subject: 'ORD-1', graded: true, pass, topic: 'charge', firstAt: T0_MS + 3 * DAY_MS, first: { code: 'missed' }, ...extra },
  { case: 'c2', subject: 'ORD-2', graded: true, pass: false, topic: 'notice', firstAt: T0_MS + 13.9 * DAY_MS, first: { code: 'late' } },
] });

test('complaints: draws are per case and arm-independent; false complaints identical across arms; q = 0.5; late ones carried', () => {
  // Two arms with different outcomes on c2 and the same failure on c1 get the same draw, time and text for c1.
  const a = trueComplaints({ stream: 's1', worldSeed: 1171, worldKey: 'w', grade: gradeOf(false) });
  const b = trueComplaints({ stream: 's1', worldSeed: 1171, worldKey: 'w', grade: gradeOf(false, { topic: 'charge' }) });
  assert.deepEqual(a, b);
  const d1 = complaintDraws('s1', 1171, 'c1'), d2 = complaintDraws('s1', 1171, 'c1');
  assert.deepEqual(d1, d2, 'the draw depends only on (stream, world, case)');
  // An arm that passes c1 sends no complaint about it; the other complaint is unchanged.
  const c = trueComplaints({ stream: 's1', worldSeed: 1171, worldKey: 'w', grade: gradeOf(true) });
  assert.ok(!c.some(x => x.case === 'c1'));
  assert.deepEqual(c.filter(x => x.case === 'c2'), a.filter(x => x.case === 'c2'));
  // q = 0.5 within a binomial tolerance over 10^4 cases.
  let sent = 0;
  for (let i = 0; i < 10_000; i++) if (complaintDraws('s1', 1171, `x${i}`).u < Q) sent += 1;
  assert.ok(Math.abs(sent / 10_000 - 0.5) < 4 * Math.sqrt(0.25 / 10_000), `share ${sent / 10_000}`);
  // A complaint due after the horizon is delivered on the next world's d1.
  const late = deliveryOf(T0_MS + HORIZON_DAYS * DAY_MS + 5 * 3_600_000);
  assert.equal(late.carried, true); assert.ok(late.at >= T0_MS && late.at < T0_MS + DAY_MS);
  // False complaints depend only on the world (the reference's ends), never on an arm.
  const ends = { c1: T0_MS + DAY_MS, c2: T0_MS + 2 * DAY_MS, c3: T0_MS + 5 * DAY_MS };
  const subjects = { c1: 'ORD-1', c2: 'ORD-2', c3: 'ORD-3' };
  const f1 = falseComplaints({ stream: 's1', worldSeed: 1171, worldKey: 'w', ends, subjects });
  assert.deepEqual(f1, falseComplaints({ stream: 's1', worldSeed: 1171, worldKey: 'w', ends, subjects }));
  assert.ok(f1.every(x => ends[x.case] <= x.at), 'a false complaint names a case the reference had ended by then');
  assert.equal(falseFor({ kind: 'adversarial' }, gradeOf(false)), true);
});

test('m6 e-detector: null false-alarm probability <= 0.10 per 600-case stream; 4 maximally novel cases alarm, 3 do not', () => {
  // Calibration of 300 scores (the frozen practice set has the same order of size); exchangeable null scores.
  const cal = Array.from({ length: 300 }, (_, i) => i % 7);
  const r = rng('dur1/test/m6');
  let alarms = 0;
  const streams = 10_000, n = 600;
  for (let s = 0; s < streams; s++) {
    const d = new ECusum();
    for (let i = 0; i < n; i++) { const score = cal[Math.floor(r.next() * cal.length)]; if (d.step(conformalP(score, cal)).alarm) { alarms += 1; break; } }
  }
  assert.ok(alarms / streams <= 0.10, `null false-alarm share ${alarms / streams}`);
  // A detector whose bet is too aggressive (eps = 1 means e = 1: never alarms; eps = 0.9 alarms too soon under drift) or that
  // re-learns calibration from stream data would change these counts; the maximally novel case has p = 1/(n+1).
  const pMin = conformalP(99, cal);
  assert.equal(pMin, 1 / 301);
  const d3 = new ECusum(); for (let i = 0; i < 3; i++) assert.equal(d3.step(pMin).alarm, false, `case ${i + 1} of 3`);
  const d4 = new ECusum(); let hit = null; for (let i = 0; i < 4; i++) if (d4.step(pMin).alarm) hit = i + 1;
  assert.equal(hit, 4);
  assert.equal(eValue(1, EPS), EPS, 'an ordinary case shrinks the statistic');
  assert.ok(Math.pow(eValue(pMin), 3) < H && Math.pow(eValue(pMin), 4) >= H);
});

test('sealed loader refuses a bundle one byte off its frozen hash; the stub bundle passes the author\'s structural checks', () => {
  const s = loadSealed(STUB);
  assert.doesNotThrow(() => loadSealed(STUB, { sha256: s.sha256 }));
  const dir = tmp();
  const f = path.join(dir, 'b.json');
  writeFileSync(f, readFileSync(STUB, 'utf8').replace('"stub": true', '"stub": true '));
  assert.throws(() => loadSealed(f, { sha256: s.sha256 }), /DUR1_SEALED_HASH/);
  rmSync(dir, { recursive: true, force: true });
  const b = JSON.parse(readFileSync(STUB, 'utf8'));
  assert.deepEqual(bundleProblems(b), []);
  const bad = structuredClone(b);
  bad.changes.E2s.renames = [{ system: 'billing', op: 'charge', from: 'amountMinor', to: 'amount' }];
  bad.changes.U1s.spec = [{ from: 'a', to: 'b' }];
  bad.changes.R2s.transition = [{ from: 'x', to: 'cleared = ans.at;' }];
  bad.changes.R2s.onset.day = 3;
  const p = bundleProblems(bad).join(' | ');
  assert.match(p, /billing\.charge/); assert.match(p, /never published/); assert.match(p, /gated by __durEff/); assert.match(p, /onset day/);
});

test('ledger: rows map to the prereg §12 priority order, unspent cap flows down, the meter refuses a session without room', () => {
  assert.equal(rowOf('MH-H.b1lh-e8-1.s1'), 'P3'); assert.equal(rowOf('MH-H.b1lh-e8-1.s3'), 'P5'); assert.equal(rowOf('co-R1-a1'), 'P2');
  assert.equal(rowOf('A-H.s1.R2s'), 'P4'); assert.equal(rowOf('A-Ox.s1.R2s.c'), 'P8'); assert.equal(rowOf('REF-M.S1.s1'), 'P6'); assert.equal(rowOf('LD-H.ld-k0'), 'P9');
  const dir = tmp();
  const f = path.join(dir, 'spend.jsonl');
  writeFileSync(f, '');
  assert.equal(rowRoom('P0', f), 2);
  assert.equal(rowRoom('P3', f), 2 + 4 + 6 + 15, 'cap flows down from unspent rows');
  const m = ledgerMeter({ scope: 'P0.A-H', row: 'P0', file: f });
  const t1 = m.before({ model: 'claude-haiku-5-5', bound: 1.5 });
  assert.equal(rowRoom('P0', f), 0.5, 'an open session counts at its bound');
  assert.throws(() => m.before({ model: 'claude-haiku-5-5', bound: 1.0 }), /DUR1_BUDGET/);
  m.after(t1, { costUsd: 0.2 });
  assert.ok(Math.abs(rowRoom('P0', f) - 1.8) < 1e-9);
  rmSync(dir, { recursive: true, force: true });
});

test('freeze: one changed byte in a frozen file blocks every paid step; a paid session without effort is refused', async () => {
  const dir = tmp();
  const f = path.join(dir, 'FREEZE.json');
  writeFileSync(f, JSON.stringify({ stage: 'A', bedDigest: 'x', files: { 'policy/models.json': '0'.repeat(64) } }));
  const c = await checkFreeze('A', { file: f });
  assert.equal(c.ok, false);
  assert.ok(c.changed.includes('policy/models.json'));
  assert.ok(c.problems.some(p => /^bed /.test(p)));
  rmSync(dir, { recursive: true, force: true });
  assert.throws(() => paidSession({ model: 'claude-haiku-5-5', budgetUsd: 0.5, minutes: 20 }, { scope: 'x', row: 'P3', freeze: { ok: true } }), /DUR1_EFFORT/);
  assert.equal(paidSession({ model: 'claude-haiku-5-5', effort: 'high', budgetUsd: 0.5, minutes: 20 }, { scope: 'x', row: 'P3', freeze: { ok: true } }).effort, 'high');
});
