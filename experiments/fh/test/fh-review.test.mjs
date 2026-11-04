// FH-1 review tests (2026-11-04, finding m5 and the post-hoc tools; NOT part of the FH-1 freeze, which hashes fh.test.mjs). $0, no
// model call: a test that could reach the paid path asserts first that the budget rule refuses it.
//   nice -n 15 node --test --test-concurrency=1 experiments/fh/test/fh-review.test.mjs
//   FH_SLOW=1 ... also runs a full stub heal attempt through the gate and both gradings (about 12 world runs).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';

const TMP = mkdtempSync(path.join(process.env.FH_TEST_TMP ?? os.tmpdir(), 'fh-review-'));
process.env.FH_WORKDIRS = path.join(TMP, 'sessions');       // read by heal.mjs at import
process.env.FH_WORK = path.join(TMP, 'work');                // read by grade.mjs at import (pool cache)
const H = await import('../heal.mjs');
const { compare, ROOT } = await import('../grade.mjs');
const { decisions } = await import('../report.mjs');
const { analyse } = await import('../analyse.mjs');
const P = await import('../posthoc.mjs');
const { route, wilsonLower, recordedIncidents } = await import('../ladder.mjs');
const { diffTrees, reconstruct, withPatch } = await import('../lean.mjs');
const { importsOf, closureFiles } = await import('../closure.mjs');
const { readTranscript, cost } = await import('../architect-cost.mjs');
const { effort, pairCompare } = await import('../durability.mjs');
const { composedBuildFiles } = await import('../../compose/build.mjs');
const { buildFiles } = await import('../../ebed/build.mjs');
const e8 = await import('../../../beds/ebed/e8/index.mjs');
test.after(() => rmSync(TMP, { recursive: true, force: true }));

const RUNS = path.join(ROOT, 'research/heal-20261021/fh1/runs');
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');
const W = '1235:d2';
const g = cases => ({ worlds: [{ world: W, armErrors: 0, cases }] });
const c = (id, o = {}) => ({ case: id, class: o.class ?? 'x', oracle: o.oracle ?? true, contracts: o.contracts ?? true });

test('spent(): ended sessions count at their cost, open sessions at their cap', () => {
  const f = path.join(TMP, 'spend.jsonl');
  writeFileSync(f, [
    { id: 'a', phase: 'start', capUsd: 0.5 }, { id: 'a', phase: 'end', costUsd: 0.12 },
    { id: 'b', phase: 'start', capUsd: 0.5 },
    { id: 'c', phase: 'start', capUsd: 0.5 }, { id: 'c', phase: 'end', costUsd: null, costUpperUsd: 0.3 },
  ].map(x => JSON.stringify(x)).join('\n') + '\n');
  const s = H.spent(f);
  assert.equal(s.sessions, 2);
  assert.equal(s.open, 1);
  assert.ok(Math.abs(s.usd - 0.42) < 1e-9);
  assert.ok(Math.abs(s.upperUsd - 0.92) < 1e-9);
  assert.deepEqual(H.spent(path.join(TMP, 'none.jsonl')), { usd: 0, upperUsd: 0, sessions: 0 });
});

test('the recorded ledger sums to the reported $4.615, and the budget rule now refuses any further paid session', async () => {
  const s = H.spent();
  assert.equal(Math.round(s.usd * 1000) / 1000, 4.615);
  assert.equal(s.open, 0);
  assert.ok(s.upperUsd + H.SESSION.budgetUsd > H.TOTAL_CAP_USD, 'precondition: the cap must refuse, or this test would start a paid session');
  const ledger = sha(H.SPEND);
  const label = 'b1lh-e8-3.H-0.k99';
  try {
    await assert.rejects(H.healAttempt({ incident: 'b1lh-e8-3', arm: 'H-0', k: 99, log: () => {} }), e => e.code === 'FH_BUDGET');
    assert.equal(sha(H.SPEND), ledger, 'a refused session writes nothing to the spend ledger');
    assert.ok(!existsSync(path.join(RUNS, label, 'record.json')));
  } finally { rmSync(path.join(RUNS, label), { recursive: true, force: true }); }
});

test('an environment fault is recorded as envfault-N.json, not graded, and leaves no record and no workdir', async () => {
  const label = 'b1lh-e8-3.H-0.k98.dry';
  try {
    const r = await H.healAttempt({ incident: 'b1lh-e8-3', arm: 'H-0', k: 98, dryRun: true, log: () => {},
      session: async () => ({ error: { code: 'MODEL_RATE_LIMIT', message: 'session limit' }, costUsd: 0, turns: 0 }) });
    assert.deepEqual(r, { label, envFault: 'MODEL_RATE_LIMIT' });
    const files = readdirSync(path.join(RUNS, label));
    assert.ok(files.includes('envfault-1.json') && !files.includes('record.json') && !files.includes('grading-after.json'), files.join(','));
    assert.equal(JSON.parse(readFileSync(path.join(RUNS, label, 'envfault-1.json'), 'utf8')).error.code, 'MODEL_RATE_LIMIT');
    assert.ok(!existsSync(path.join(process.env.FH_WORKDIRS, label)), 'workdir removed');
  } finally { rmSync(path.join(RUNS, label), { recursive: true, force: true }); }
});

test('decisions(): each frozen rule at its boundaries (synthetic analyses)', () => {
  const inc = H.INCIDENTS;
  const mk = ({ hc, hn = () => 0, regen = () => 0, regHC = 0, regG = 0, usdHC = 0.1, usdG = 1, glHN = () => false }) => ({ rows: inc.map((i, j) => ({ incident: i,
    regenerate: { net: regen(j), regressed: j === 0 ? regG : 0, usd: usdG / inc.length },
    heal: { 'H-C': [{ k: 1, accepted: hc(j) > 0, usd: usdHC / inc.length, kept: { net: hc(j), nRecovered: hc(j) + (j === 0 ? regHC : 0), nRegressed: j === 0 ? regHC : 0 } }],
      'H-N': [{ k: 1, kept: { net: hn(j), recoveredByClass: glHN(j) ? { 'gl-intake': 1 } : {} } }] } })) });
  assert.equal(decisions(mk({ hc: j => (j < 6 ? 10 : 0) })).H1.verdict, 'supported (dev)');
  assert.equal(decisions(mk({ hc: j => (j < 5 ? 10 : 0) })).H1.verdict, 'inconclusive', '5 wins is not enough');
  assert.equal(decisions(mk({ hc: j => (j < 6 ? 10 : 0), usdHC: 2, usdG: 1 })).H1.verdict, 'inconclusive', 'the cost conjunct binds');
  assert.equal(decisions(mk({ hc: j => (j < 6 ? 10 : 0), regHC: 3, regG: 1 })).H1.verdict, 'refuted', 'more regressions than regenerate refutes');
  assert.equal(decisions(mk({ hc: () => 0, regen: () => 1 })).H1.verdict, 'refuted');
  assert.equal(decisions(mk({ hc: j => (j < 5 ? 1 : 0) })).H1b.verdict, 'supported (dev)');
  assert.equal(decisions(mk({ hc: j => (j < 4 ? 1 : 0) })).H1b.verdict, 'not supported');
  assert.equal(decisions(mk({ hc: j => (j < 5 ? 10 : 0) })).H2.verdict, 'supported (dev)');
  assert.equal(decisions(mk({ hc: j => (j < 5 ? 10 : 0), glHN: j => j < 2 })).H2.verdict, 'inconclusive', 'H-N recovering go-live in 2 of 7 breaks the second conjunct');
  assert.equal(decisions(mk({ hc: () => 1, hn: () => 1 })).H2.verdict, 'refuted', 'ties count for H-N');
  const missing = mk({ hc: () => 1 }); missing.rows[3].heal = {};
  assert.match(decisions(missing).H1.verdict, /incomplete/);
});

test('decisions() on the recorded runs reproduces the reported verdicts and counts', () => {
  const d = decisions(analyse());
  assert.equal(d.H1.verdict, 'supported (dev)'); assert.equal(d.H1.better, 7); assert.equal(d.H1.regHC, 0); assert.equal(d.H1.regG, 279.5);
  assert.equal(d.H1b.verdict, 'supported (dev)'); assert.equal(d.H1b.keptRecover, 8); assert.equal(d.H1b.recHC, 357);
  assert.equal(d.H2.verdict, 'supported (dev)'); assert.equal(d.H2.cWins, 8); assert.equal(d.H2.hnNoGoLive, 7);
});

test('no grader data in anything a session saw: task texts, workspace files, every recorded and every renderable report', async () => {
  const classes = new Set();
  for (const f of readdirSync(path.join(ROOT, 'research/heal-20261021/fh1/baseline'))) for (const w of JSON.parse(readFileSync(path.join(ROOT, 'research/heal-20261021/fh1/baseline', f), 'utf8')).grading.worlds) for (const x of w.cases) classes.add(x.class);
  const hyphenated = [...classes].filter(x => x.includes('-'));
  assert.ok(hyphenated.length >= 15 && hyphenated.includes('gl-intake'), 'the class vocabulary was read');
  // a class name counts only as a whole token (not inside a longer hyphenated word: SPEC-E's reason code fraud-review-timeout is not
  // the oracle class review-timeout)
  const leak = new RegExp(`ORD-123[234]-|\\b123[234]:d|firstDivergence|(?<![\\w-])(${hyphenated.join('|')})(?![\\w-])`);
  const texts = {};
  for (const arm of H.ARMS) for (const kind of ['composed', 'monolith']) texts[`TASK ${arm} ${kind}`] = H.healTask(arm, kind);
  for (const [f, t] of Object.entries(composedBuildFiles(e8, { arm: 'C-H', loop: 'smoke' }))) texts[`composed:${f}`] = t;
  for (const [f, t] of Object.entries(buildFiles(e8, { loop: 'smoke' }))) texts[`monolith:${f}`] = t;
  for (const d of readdirSync(RUNS)) for (const f of ['FAILURES.md', 'DISAGREEMENTS.md']) if (existsSync(path.join(RUNS, d, f))) texts[`${d}/${f}`] = readFileSync(path.join(RUNS, d, f), 'utf8');
  const sigs = await H.ensembleSignatures();
  for (const inc of H.INCIDENTS) {
    const b = JSON.parse(readFileSync(path.join(ROOT, 'research/heal-20261021/fh1/baseline', `${inc}.json`), 'utf8'));
    texts[`render FAILURES ${inc}`] = H.contractFailuresText(b.practice, H.contractClasses(b.practice), { sigs: sigs[inc] });
    texts[`render DISAGREEMENTS ${inc}`] = H.nversionText(H.nversionDisagreements(Object.fromEntries(H.ENSEMBLE.map(x => [x, sigs[x]])), inc));
  }
  assert.ok(Object.keys(texts).filter(k => k.endsWith('/FAILURES.md')).length >= 13 && Object.keys(texts).filter(k => k.endsWith('/DISAGREEMENTS.md')).length >= 8, 'recorded reports were found');
  for (const [k, t] of Object.entries(texts)) assert.doesNotMatch(t, leak, k);
  for (const [k, t] of Object.entries(texts)) if (/FAILURES|DISAGREEMENTS|TASK/.test(k)) assert.doesNotMatch(t, /\boracle\b|grading world/i, k);
});

test('compareStrict counts a case graded before and missing after as a regression (compare() alone drops it)', () => {
  const before = g([c('a', { oracle: false }), c('b')]), after = g([c('a')]);
  assert.equal(compare(before, after).net, 1);
  const s = P.compareStrict(before, after);
  assert.equal(s.nMissing, 1); assert.equal(s.netStrict, 0); assert.equal(s.nRegressedStrict, 1);
});

test('every graded attempt re-compares with 0 missing cases, matches its record, and obeys the kept rule', () => {
  const rows = P.integrity();
  assert.ok(rows.length >= 29);
  for (const r of rows) { assert.equal(r.missing, 0, r.label); assert.equal(r.extra, 0, r.label); assert.ok(r.agrees, r.label); assert.ok(r.keptRule, r.label); }
});

test('hcGate (post hoc) agrees with the frozen gate on synthetic and on recorded practice gradings', () => {
  const before = g([c('a', { contracts: false }), c('b')]);
  for (const after of [g([c('a'), c('b')]), g([c('a'), c('b', { contracts: false })]), g([c('a', { contracts: false }), c('b')])])
    assert.equal(P.hcGate(before, after).accept, H.gateDecision('H-C', { loads: true, before, after }).accept);
  const base = l => JSON.parse(readFileSync(path.join(ROOT, 'research/heal-20261021/fh1/baseline', `${l}.json`), 'utf8')).practice;
  for (const [i, p] of [['b1lh-e8-2', 'b1lh-e8-1'], ['ch-e8-1', 'ch-e8-3'], ['cht-e8-3', 'cht-e8-2']])
    assert.equal(P.hcGate(base(i), base(p)).accept, H.gateDecision('H-C', { loads: true, before: base(i), after: base(p) }).accept, `${p} into ${i}`);
});

test('post-hoc numbers the review quoted: gated regenerate 64, best-of-2 128, go-live 276 of 475, H-C 81/199 vs H-0 118/199 off go-live', () => {
  const a = P.analysis();
  assert.equal(a.regen.totals.gated.net, 64);
  assert.equal(a.regen.totals.best2Practice.net, 128);
  assert.equal(a.regen.totals.best2Oracle.net, 128);
  assert.equal(a.regen.totals.ungated.net, 27.5);
  assert.equal(a.failingGl, 276);
  assert.equal(a.pooled['H-C k1'].other, 81); assert.equal(a.pooled['H-0 k1'].other, 118); assert.equal(a.pooled['H-N k1'].other, 54);
  assert.deepEqual([a.h2.hcWins, a.h2.hnWins, a.h2.incidents.length], [4, 0, 4]);
  assert.equal(a.defects.length, 12);
  assert.equal(a.defects.filter(d => d.arms['H-C k1'].fixed).length, 11);
});

test('ladder route: variance -> retry, determinism -> patch, a blind verifier is named, no evidence -> resample first', () => {
  assert.ok(Math.abs(wilsonLower(8, 8) - 0.6756) < 1e-3);
  assert.equal(wilsonLower(0, 0), 0);
  assert.equal(route({ reruns: Array(8).fill({ pass: true }) }).action, 'retry');
  assert.equal(route({ reruns: [{ pass: false }], deterministic: true }).action, 'patch');
  assert.equal(route({ reruns: Array(8).fill({ pass: false }) }).action, 'patch');
  assert.equal(route({ reruns: Array(8).fill({ pass: false, verdictPass: true }) }).action, 'patch-with-independent-verifier');
  assert.equal(route({ reruns: [{ pass: false }, { pass: false }] }).action, 'resample-more');
  assert.equal(route({ reruns: [...Array(7).fill({ pass: false }), { pass: true }] }).action, 'resample-more', '1 flip in 8: Wilson lower 0.022 <= tau');
  assert.equal(route({}).action, 'resample-first');
  const rec = Object.fromEntries(recordedIncidents().map(x => [x.incident, x.route.action]));
  assert.equal(rec['H-p1 (10-08)'], 'retry');
  for (const i of H.INCIDENTS) assert.equal(rec[`${i} (FH-1)`], 'patch');
});

test('lean storage: diffTrees is exact, and every stored patch rebuilds the program the gate and the grading used', () => {
  const B = s => Buffer.from(s);
  assert.deepEqual(diffTrees(new Map([['a', B('1')], ['b', B('2')]]), new Map([['a', B('1')], ['b', B('3')], ['c', B('4')]])), { b: '3', c: '4' });
  assert.deepEqual(diffTrees(new Map([['a', B('1')]]), new Map()), { a: null });
  const labels = withPatch();
  assert.ok(labels.length >= 29);
  for (const l of labels) {
    const r = reconstruct(l, path.join(TMP, 'lean', l));
    const rec = JSON.parse(readFileSync(path.join(RUNS, l, 'record.json'), 'utf8'));
    assert.equal(r.digest, rec.patchedDigest, l);
  }
});

test('closure: imports parsed, and the closure holds the transitive dependencies FREEZE.json missed', () => {
  assert.deepEqual(importsOf(`import a from './a.mjs';\nexport { b } from "../b.mjs";\nconst c = await import('./c.mjs');\nimport 'node:fs';\nimport x from 'pkg';`), ['./a.mjs', '../b.mjs', './c.mjs']);
  const files = closureFiles();
  for (const f of ['experiments/compose/runtime.mjs', 'experiments/compose/kit/kit.mjs', 'beds/lib/rng.mjs', 'beds/lib/canonical.mjs', 'src/data.mjs', 'src/models/policy.mjs', 'experiments/fh/heal.mjs'])
    assert.ok(files.includes(f), f);
});

test('architect cost: usage deduplicated per message id; output from written characters; bounds ordered', () => {
  const line = (id, usage, content = []) => JSON.stringify({ timestamp: 't', message: { id, role: 'assistant', model: 'claude-opus-5-5', usage, content } });
  const t = readTranscript([
    line('m1', { cache_read_input_tokens: 1e6, output_tokens: 1 }), line('m1', { cache_read_input_tokens: 1e6, output_tokens: 3 }),
    line('m2', { cache_creation_input_tokens: 1e5 }, [{ type: 'tool_use', name: 'Write', input: { file_path: '/x/experiments/compose/capabilities.mjs', content: 'x'.repeat(3500) } }]),
    line('m3', { cache_read_input_tokens: 2e6 }, [{ type: 'tool_use', name: 'Write', input: { file_path: '/x/other.mjs', content: 'y'.repeat(3500) } }]),
  ].join('\n'));
  assert.equal(t.calls.length, 3);
  assert.equal(t.calls[0].usage.cache_read_input_tokens, 1e6, 'two lines of one call count once');
  const r = cost(t, { file: 'experiments/compose/capabilities.mjs' });
  assert.equal(r.fileShareOfWrittenChars, 0.5);
  // lower: m1 + m2 = 1e6 x 0.4 + 1e5 x 5 per MTok + 1000 output tokens x 20 per MTok = 0.4 + 0.5 + 0.02
  assert.equal(r.usd.lowerBound, 0.92);
  assert.ok(r.usd.lowerBound <= r.usd.wholeSession && r.usd.allocated <= r.usd.wholeSession && r.usd.wholeSession <= r.usd.upperBound);
});

test('durability helpers: journal effort counts and case-level pairing', () => {
  assert.deepEqual(effort([{ type: 'call' }, { type: 'call' }, { type: 'effect.emit' }, { type: 'wakeup.commit' }, { type: 'deliver' }]), { ticks: 2, effects: 1, wakeups: 1 });
  const a = [{ seed: 1, d: 2, completed: 3, failing: [['x', 'c'], ['y', 'c']] }], b = [{ seed: 1, d: 2, completed: 3, failing: [['y', 'c'], ['z', 'c']] }];
  assert.deepEqual(pairCompare(a, b), { recovered: 1, regressed: 1, missing: 0, cells: 1 });
  assert.equal(pairCompare(a, [{ seed: 9, d: 2, completed: 3, failing: [] }]).missing, 1);
});

test('slow: a harmful scripted patch is rejected by the H-C gate and the original program is kept (net 0)', { skip: process.env.FH_SLOW !== '1' && 'set FH_SLOW=1 (about 12 world runs)' }, async () => {
  const label = 'b1lh-e8-3.H-C.k97.dry';
  try {
    const { copyFileSync } = await import('node:fs');
    const r = await H.healAttempt({ incident: 'b1lh-e8-3', arm: 'H-C', k: 97, dryRun: true, log: () => {},
      session: async ({ workdir }) => { copyFileSync(path.join(ROOT, 'research/enterprise-20261014/runs/b1lh-e8-2/solver.mjs'), path.join(workdir, 'solver.mjs')); return { costUsd: 0, turns: 0 }; } });
    assert.equal(r.gate.accept, false);
    assert.match(r.gate.reason, /newly fail a contract/);
    assert.deepEqual([r.grading.raw.nRecovered, r.grading.raw.nRegressed], [7, 48], 'the same as the recorded $0 dry run');
    assert.deepEqual([r.grading.kept.net, r.grading.kept.nRecovered, r.grading.kept.nRegressed], [0, 0, 0], 'rejected: the original program is the outcome');
  } finally { rmSync(path.join(RUNS, label), { recursive: true, force: true }); }
});
