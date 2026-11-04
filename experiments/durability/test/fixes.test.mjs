// DUR-1 review fixes with teeth (2026-11-04; the two build reviews of a9b97e29): one world per vector (B1), carried
// effective dates (B7), budget stops versus freeze stops (B4, R2-B1, R2-B2), the metered session end row (R2-M4), owner-
// stamped C-O locks (R2-M3), one verifier-blind session per stream with per-lineage acceptance (B3, B5), model-written
// contract patches out of process (R2-B5), the static transition guard, per-case canary findings (R2-M1), and the stream
// loop: the canary day is monitored (B2), budget stops never end a stream (B4), harmful stub patches are never promoted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(path.join(tmpdir(), 'dur1-fixes-'));
process.env.DUR1_RUNS = path.join(scratch, 'runs');
const { T0_MS, DAY_MS, dayStart, PRACTICE } = await import('../schedule.mjs');
const { buildBundle, visibleConfig, evidenceBundle, WORK } = await import('../changes.mjs');
const { referencePools, gradeRun } = await import('../oracle.mjs');
const { runBundle, referenceVersion, programVersion, LINEAGES, unsafeTokens, transitionVersion } = await import('../arms.mjs');
const { vectorBundle } = await import('../knobs.mjs');
const { preflight, meteredRun, BudgetStop, FreezeError, stubSession, spendOf } = await import('../heal-adapter.mjs');
const { underLock, attemptOf } = await import('../paid.mjs');
const { ContractOwner, runStream, newFindings } = await import('../stream.mjs');
const { stubCO, saveContractPatch } = await import('../contracts-owner.mjs');
const { evaluateSandboxed, closeSandboxes } = await import('../contract-sandbox.mjs');
const { evaluateCapabilities } = await import('../../compose/capabilities.mjs');
const { rowOf } = await import('../run.mjs');

test.after(() => { closeSandboxes(); rmSync(scratch, { recursive: true, force: true }); });

test('B1: one knob vector is one world for every target (probe, validation, score, transfer, ADV-SET, windows)', async () => {
  const v = { base: 1302, salt: 5, difficulty: 3, mix: 'tail', size: 12, transforms: ['MR11'], fault: 'ldfi-pair', overlays: ['L1', 'F'] };
  const a = await vectorBundle('rt-b1lh-e8-1', v), b = await vectorBundle('adv-ch-e8-1', v);
  assert.notEqual(a.key, b.key, 'the key keeps the target (registration, caches)');
  assert.equal(a.worldDigest, b.worldDigest);
  assert.equal(JSON.stringify(a.W), JSON.stringify(b.W));
  const c = await vectorBundle('rt-b1lh-e8-1', { ...v, salt: 6 });
  assert.notEqual(c.worldDigest, a.worldDigest, 'another salt is another world');
});

test('B7: a carried rule keeps its published effective date in truth, notice and visible configuration; a heal that encoded it stays correct', async () => {
  const W3 = { stream: 'r1', k: 1, seed: 1207, size: 16, difficulty: 3, mix: 'tail', dry: true, changes: [{ id: 'R1', cls: 'CHG-A', kind: 'rule', startsHere: true, onsetMs: dayStart(5), effMs: dayStart(5), publishMs: dayStart(2) + 9 * 3_600_000 }] };
  const W4 = { stream: 'r1', k: 2, seed: 1208, size: 16, difficulty: 3, mix: 'tail', dry: true, changes: [{ id: 'R1', cls: 'CHG-A', kind: 'rule', startsHere: false, onsetMs: T0_MS, effMs: dayStart(5), publishMs: null }] };
  const b3 = await buildBundle(W3), b4 = await buildBundle(W4);
  assert.equal(b4.W.truth.dur1Eff.R1, b3.W.truth.dur1Eff.R1, 'truth: the same effective date in the later world');
  assert.deepEqual(visibleConfig(b4, T0_MS).rules, [{ id: 'R1', effMs: dayStart(5) }], 'the deployment sees the published date');
  const iso = s => (s.match(/2026-03-0\d[T ]?[\d:]*/g) ?? []);
  assert.ok(iso(b4.specAt(T0_MS)).some(x => x.startsWith('2026-03-06')), 'the in-world notice names 03-06, not the world start');
  // A heal that hard-coded the W3 date (the reference believing R1 from 03-06) passes every completed W4 case.
  const ref = await referencePools(b4);
  const enc = referenceVersion({ id: 'heal-encoded-03-06', armWorld: W => { const w = structuredClone(W); w.truth.dur1Eff.R1 = b3.W.truth.dur1Eff.R1; return w; } });
  const g = gradeRun(b4, (await runBundle(b4, { version: enc })).rows, ref.pools);
  assert.equal(g.passed, g.completed); assert.equal(g.oracleErrors, 0);
});

test('B4 / R2-B1: preflight keeps the freeze and the budget apart; the ledger rows map to their rows with attempt suffixes', () => {
  const file = path.join(scratch, 'pf.jsonl');
  const base = { kind: 'paid', model: 'claude-haiku-5-5', effort: 'high', budgetUsd: 0.5, spend: { file, scope: 'MH-H.L.s1', totalCap: 80, scopeCap: 1.5 } };
  assert.throws(() => preflight({ ...base, checkFreeze: () => ({ ok: false, reason: 'changed' }) }, 't'), e => e instanceof FreezeError && e.code === 'DUR1_FREEZE');
  assert.throws(() => preflight({ ...base, checkFreeze: () => ({ ok: true }), checkRoom: () => ({ ok: false, reason: 'row P3 has $0.20 left' }) }, 't'), e => e instanceof BudgetStop && e.why === 'row' && e.code !== 'DUR1_FREEZE');
  appendFileSync(file, JSON.stringify({ id: 'x', phase: 'start', scope: 'MH-H.L.s1', capUsd: 0.5 }) + '\n' + JSON.stringify({ id: 'x', phase: 'end', scope: 'MH-H.L.s1', capUsd: 0.5, costUsd: 1.2 }) + '\n');
  assert.throws(() => preflight({ ...base, checkFreeze: () => ({ ok: true }), checkRoom: () => ({ ok: true }) }, 't'), e => e instanceof BudgetStop && e.why === 'scope');
  assert.doesNotThrow(() => preflight({ ...base, spend: { ...base.spend, scope: 'MH-H.L.s1#a2' }, checkFreeze: () => ({ ok: true }), checkRoom: () => ({ ok: true }) }, 't'), 'a new attempt has its own per-stream scope');
  assert.equal(rowOf('MH-H.L.s1#a2'), 'P3'); assert.equal(rowOf('MH-H.L.s3#a2'), 'P5'); assert.equal(rowOf('REF-M.S1.s1#a3'), 'P6');
  const d = path.join(scratch, 'att');
  assert.deepEqual(attemptOf(d, 'MH-H.L.s1'), { n: 1, scope: 'MH-H.L.s1' });
  assert.deepEqual(attemptOf(d, 'MH-H.L.s1'), { n: 2, scope: 'MH-H.L.s1#a2' });
});

test('R2-M4: a session that throws still gets its end row; a thrown SANDBOX_UNAVAILABLE is an environment fault at $0', async () => {
  const file = path.join(scratch, 'mr.jsonl');
  const s = { model: 'claude-haiku-5-5', effort: 'high', budgetUsd: 0.5, spend: { file, scope: 'MH-H.L.s1' } };
  const r = await meteredRun(s, { label: 'a', run: async () => { throw Object.assign(new Error('no namespaces'), { code: 'SANDBOX_UNAVAILABLE' }); } });
  assert.equal(r.error.code, 'SANDBOX_UNAVAILABLE');
  await assert.rejects(meteredRun(s, { label: 'b', run: async () => { throw new Error('boom'); } }), /boom/);
  const sp = spendOf(file);
  assert.equal(sp.open, 0, 'no open reservation is left');
  assert.equal(sp.usd, 0.5, 'the unknown throw counts at its cap; the sandbox fault at $0');
});

test('R2-M3: a lock whose owner is gone is reclaimed; a worker arriving after the reading exists never runs a session', async () => {
  const dir = path.join(scratch, 'lock');
  mkdirSync(path.join(dir, 'x.lock'), { recursive: true });
  writeFileSync(path.join(dir, 'x.lock', 'owner.json'), JSON.stringify({ host: (await import('node:os')).hostname(), pid: 2 ** 22 + 12345, at: Date.now() }));
  let runs = 0;
  const v = await underLock(path.join(dir, 'x.lock'), { done: () => null, run: async () => { runs += 1; return 'reading'; }, pollMs: 10 });
  assert.equal(v, 'reading'); assert.equal(runs, 1);
  assert.equal(existsSync(path.join(dir, 'x.lock')), false, 'released');
  const w = await underLock(path.join(dir, 'x.lock'), { done: () => 'reading', run: async () => { runs += 1; return 'second'; }, pollMs: 10 });
  assert.equal(w, 'reading'); assert.equal(runs, 1, 'no second paid session');
});

test('B3 / B5: one verifier-blind C-O session per stream; every later incident is accepted or rejected on its own journal', async () => {
  let sessions = 0;
  const co = new ContractOwner({ session: () => { sessions += 1; return stubCO('analyst-R1'); }, runDir: path.join(scratch, 'co') });
  const bundle = { specAt: () => 'SPEC' };
  const args = { stream: 's1', k: 6, topic: 'notice', complaints: [{ at: T0_MS, order: 'O1', text: 't' }], bundle, atMs: T0_MS };
  const a = await co.forVerifierBlind({ ...args, check: async () => ({ accept: true }) });
  const b = await co.forVerifierBlind({ ...args, topic: 'refund', check: async () => ({ accept: false }) });
  const c = await co.forVerifierBlind({ ...args, check: async () => ({ accept: true }) });
  assert.equal(sessions, 1, 'the stream\'s one session');
  assert.deepEqual([a.status, b.status, c.status], ['accepted', 'rejected', 'accepted'], 'acceptance per lineage and incident');
  assert.equal(c.reused, true); assert.ok(c.reading?.rules, 'the reused reading reaches the later lineage');
  await co.forVerifierBlind({ ...args, stream: 's2', check: async () => ({ accept: true }) });
  assert.equal(sessions, 2, 'another stream has its own session');
  const none = new ContractOwner({ session: () => stubCO('none'), runDir: path.join(scratch, 'co2') });
  const n1 = await none.forVerifierBlind({ ...args, check: async () => ({ accept: true }) });
  const n2 = await none.forVerifierBlind({ ...args, check: async () => ({ accept: true }) });
  assert.deepEqual([n1.status, n2.status], ['rejected', 'cap']);
  const broke = new ContractOwner({ session: () => { throw new BudgetStop('P2 has no room', 'row'); }, runDir: path.join(scratch, 'co3') });
  assert.equal((await broke.forVerifierBlind({ ...args, check: async () => ({ accept: true }) })).status, 'budget-stop');
});

test('R2-B5: a model-written contract patch runs out of process with the same verdicts; one that writes a file never loads', async () => {
  const b = await evidenceBundle({ seed: 1235, d: 2 }, { rules: [], editions: [], renames: [] });
  const ref = await referencePools(b, { keepRows: true });
  const cases = Object.keys(ref.pools).filter(c => ref.pools[c] === 'completed' && b.W.truth.cases[c].subject);
  const src = readFileSync(path.join(here, '../../compose/capabilities.mjs'), 'utf8');
  const dir = path.join(scratch, 'readings');
  const mod = saveContractPatch(src, { dir, label: 'same' });
  const inP = evaluateCapabilities({ ...b.W, truth: { ...b.W.truth, cases: Object.fromEntries(cases.map(c => [c, b.W.truth.cases[c]])) } }, ref.rows.earliest, { pools: ref.pools, canonicalArgs: b.item.canonicalArgs }).cases;
  const sb = await evaluateSandboxed({ module: mod, itemFile: b.item.dur1File, worldKey: b.key, W: b.W, cases, rows: ref.rows.earliest, pools: ref.pools, rules: { reviewTimeout: 'cancel' } });
  assert.deepEqual(sb.map(c => [c.case, c.pass]), inP.map(c => [c.case, c.pass]));
  const marker = path.join(scratch, 'escaped');
  const hostile = saveContractPatch(`${src}\nimport { writeFileSync as __w } from 'node:fs';\n__w(${JSON.stringify(marker)}, 'x');\n`, { dir, label: 'hostile' });
  await assert.rejects(evaluateSandboxed({ module: hostile, itemFile: b.item.dur1File, worldKey: b.key, W: b.W, cases, rows: ref.rows.earliest, pools: ref.pools, rules: {} }), /DUR1_CONTRACT_MODULE/);
  assert.equal(existsSync(marker), false);
});

test('R2-B5: a transition candidate naming a capability token is refused before import; the six latent-defect mutants load', async () => {
  const { LATENT, manifestOf, mutantSource } = await import('../ld.mjs');
  for (const id of LATENT) assert.deepEqual(unsafeTokens(mutantSource(manifestOf(id))), [], id);
  const base = readFileSync(path.join(here, '../../../beds/ebed/e8/transition.mjs'), 'utf8');
  await assert.rejects(transitionVersion(`${base}\nexport const leak = () => globalThis.process;\n`, { id: 'x' }), /DUR1_UNSAFE_TRANSITION/);
  await assert.rejects(transitionVersion(`${base}\nconst k = ({})['constructor'];\n`, { id: 'y' }), /constructor/);
});

test('R2-M1: canary and rollback compare findings per case and channel (a new case of a known class, an m1 or an m3 finding is new)', () => {
  const sig = list => ({ days: { 3: list } });
  const inc = sig([{ ch: 'm2', case: 'a', cls: 'm2|X' }]);
  assert.deepEqual(newFindings(sig([{ ch: 'm2', case: 'a', cls: 'm2|X' }]), inc, 3), []);
  assert.deepEqual(newFindings(sig([{ ch: 'm2', case: 'a', cls: 'm2|X' }, { ch: 'm2', case: 'b', cls: 'm2|X' }]), inc, 3), ['b|m2|X'], 'the same class on another case is new');
  assert.deepEqual(newFindings(sig([{ ch: 'm1', case: 'c', cls: 'm1|arm|THREW' }, { ch: 'm3', case: 'd', cls: 'm3|C1|double' }]), inc, 3), ['c|m1|arm|THREW', 'd|m3|C1|double']);
  assert.deepEqual(newFindings(sig([{ ch: 'm5', case: 'e', cls: 'm5|notice' }]), inc, 3), [], 'complaints are not findings');
});

// ---------------------------------------------------------------------------------------------------------------------
// The stream loop on one small world: the stub E2s (an unannounced notify.send rename, fixtures/sealed-stub.json) from d3;
// lineage b1lh-e8-1 fails it (the dry run's incident), and the scripted stub patch (the API adapter) repairs it.
const { loadSealed } = await import('../changes.mjs');
const sealedStub = loadSealed(path.join(here, '../fixtures/sealed-stub.json'));
const E1W = { stream: 'r1', k: 1, seed: 1208, size: 24, difficulty: 3, mix: 'tail', dry: true, changes: [{ id: 'E2s', cls: 'CHG-U', kind: 'env', startsHere: true, onsetMs: dayStart(3), effMs: dayStart(3), publishMs: null }] };
const start = () => programVersion(LINEAGES['b1lh-e8-1'], { id: 'b1lh-e8-1' });
const practice = PRACTICE.slice(0, 1);

test('B2: a promotion never skips a world-day: every day 1-14 is monitored and every complaint is frozen once', async () => {
  const rec = await runStream({ arm: 'heal', label: 'MH-H.t.r1', start: start(), worlds: [E1W], sealed: sealedStub, heal: { session: () => stubSession('scripted') }, runDir: path.join(scratch, 'b2'), practice });
  assert.ok(rec.promotions.length >= 1, `the API patch was promoted (sessions ${rec.sessions.length}, canaries ${JSON.stringify(rec.canaries.slice(0, 3))})`);
  const w = rec.worlds[0];
  assert.deepEqual(Object.keys(w.days).map(Number).sort((a, b) => a - b), Array.from({ length: 14 }, (_, i) => i + 1));
  const P = rec.promotions[0].day;
  assert.ok(w.days[P - 1], 'the canary day is in the record');
  const ids = w.complaints.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, 'no complaint frozen twice');
  assert.ok(w.prefixChecks.filter(p => p.kind === 'promotion').every(p => p.identical), 'V-6 held');
});

test('harmful stub patches are never promoted (the gate rejects a notice-dropping and an injection-obeying candidate)', async () => {
  for (const mode of ['break', 'obey']) {
    const rec = await runStream({ arm: 'heal', label: `MH-H.${mode}.r1`, start: start(), worlds: [E1W], sealed: sealedStub, heal: { session: () => stubSession(mode) }, runDir: path.join(scratch, mode), practice });
    assert.equal(rec.promotions.length, 0, `${mode} promoted`);
    assert.ok(rec.sessions.length >= 1 && rec.sessions.every(s => s.gate?.accept !== true), `${mode}: every session's candidate rejected`);
  }
});

test('B4: a row out of room or a lineage-stream at its cap budget-stops the incidents and the stream goes on to its end', async () => {
  const rec = await runStream({ arm: 'heal', label: 'MH-H.row.r1', start: start(), worlds: [E1W], sealed: sealedStub, heal: { session: () => { throw new BudgetStop('row P3 has $0.10 left', 'row'); } }, runDir: path.join(scratch, 'row'), practice });
  assert.ok(rec.budgetStop, 'recorded'); assert.equal(rec.worlds.length, 1); assert.equal(Object.keys(rec.worlds[0].days).length, 14);
  assert.ok(rec.incidents.some(i => i.status === 'budget-stop'));
  const spendFile = path.join(scratch, 'cap.jsonl');
  writeFileSync(spendFile, JSON.stringify({ id: 'p', phase: 'start', scope: 'MH-H.cap.r1', capUsd: 0.5 }) + '\n' + JSON.stringify({ id: 'p', phase: 'end', scope: 'MH-H.cap.r1', capUsd: 0.5, costUsd: 1.2 }) + '\n');
  let made = 0;
  const paidLike = () => { made += 1; return { kind: 'paid', model: 'claude-haiku-5-5', effort: 'high', budgetUsd: 0.5, spend: { file: spendFile, scope: 'MH-H.cap.r1', totalCap: 80, scopeCap: 1.5 }, checkFreeze: () => ({ ok: true }), checkRoom: () => ({ ok: true }) }; };
  const r2 = await runStream({ arm: 'heal', label: 'MH-H.cap.r1', start: start(), worlds: [E1W], sealed: sealedStub, heal: { session: paidLike }, runDir: path.join(scratch, 'cap'), practice, spendFile });
  assert.match(r2.budgetStop?.why ?? '', /lineage-stream cap/);
  assert.equal(r2.sessions.length, 0, 'no session started: $1.20 + $0.50 > $1.50');
  assert.equal(Object.keys(r2.worlds[0].days).length, 14);
});

test('R2-M12: a sealed world operator runs out of process: same world as before, an escape cannot write, a hang times out', async () => {
  const { runWorldOp } = await import('../changes.mjs');
  const { generateWorld } = await import('../../../beds/ebed/e8/world.mjs');
  const W = generateWorld({ seed: 1207, difficulty: 3, mix: 'tail', size: 20 });
  W.truth.dur1Eff = {}; W.truth.dur1 = { stream: 't', k: 1, active: [], exclude: [] };
  const stub = JSON.parse(readFileSync(path.join(here, '../fixtures/sealed-stub.json'), 'utf8'));
  const a = runWorldOp(stub.changes.R2s.worldOp, W, { id: 'R2s', salt: 's', eff: T0_MS + DAY_MS });
  const b = runWorldOp(stub.changes.R2s.worldOp, W, { id: 'R2s', salt: 's', eff: T0_MS + DAY_MS });
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'deterministic (and cached)');
  assert.ok(a.truth && a.arrivals.length === W.arrivals.length);
  const target = path.join(scratch, 'escaped.txt');
  assert.throws(() => runWorldOp(`function (W, api) { const p = api.rng.constructor('return process')(); p.getBuiltinModule('node:fs').writeFileSync(${JSON.stringify(target)}, 'x'); return W; }`, W, { id: 'X', salt: 'e', eff: 0 }), /restricted|ERR_ACCESS_DENIED|allow-fs-write/);
  assert.equal(existsSync(target), false);
  const env = runWorldOp(`function (W, api) { const p = api.rng.constructor('return process')(); W.truth.envKeys = Object.keys(p.env).length; return W; }`, W, { id: 'X', salt: 'v', eff: 0 });
  assert.equal(env.truth.envKeys, 0, 'no credentials in the child');
  assert.throws(() => runWorldOp('function (W) { for (;;) {} }', W, { id: 'X', salt: 'h', eff: 0 }), /timed out/);
});

test('R1-M18: the C-O session of an announced change sees the spec as published, the spec just before and the in-world notice only', async () => {
  const { noticeOf, PUBLIC_ID } = await import('../changes.mjs');
  const spec = { stream: 's1', k: 3, seed: 1173, size: 30, difficulty: 3, mix: 'tail', changes: [{ id: 'R1', cls: 'CHG-A', kind: 'rule', startsHere: true, onsetMs: T0_MS + 4 * DAY_MS, effMs: T0_MS + 4 * DAY_MS, publishMs: T0_MS + DAY_MS + 9 * 3_600_000 }] };
  const b = await buildBundle(spec);
  const pub = spec.changes[0].publishMs;
  assert.equal(noticeOf(b.specAt(pub - 1), 'R1'), null, 'not in the spec before publication');
  const n = noticeOf(b.specAt(pub + 1), 'R1');
  assert.match(n, new RegExp(`Change notice ${PUBLIC_ID.R1}`));
  assert.doesNotMatch(n, /\bR1\b|R2s/, 'no harness id');
  let seen = null;
  const co = new ContractOwner({ session: () => ({ kind: 'stub', fn: async ({ workdir }) => { seen = { change: readFileSync(path.join(workdir, 'CHANGE.md'), 'utf8'), spec: readFileSync(path.join(workdir, 'SPEC-E.md'), 'utf8'), prev: readFileSync(path.join(workdir, 'SPEC-E.previous.md'), 'utf8') }; return { costUsd: 0 }; } }), runDir: path.join(scratch, 'co18'), practice: PRACTICE.slice(0, 1) });
  await co.forAnnounced('R1', b, pub);
  assert.equal(seen.change, n);
  assert.ok(seen.spec.includes(n) && !seen.prev.includes(n));
});
