// The W-bed reference workflows (arm c) at $0: the freeze pins, the stub answer policy, and the references running through
// the real compiled path (run-compiled.mjs sandbox, flow-v3, gateway socket only) on author fixtures with stub or
// author-read judges. No model is called. The sandboxed tests skip without user namespaces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { stubAnswer, stubCostUsd, firstFence } from './stub-policy.mjs';
import { runOne, summarize } from './validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha = file => createHash('sha256').update(readFileSync(path.join(HERE, file))).digest('hex');
const FROZEN = JSON.parse(readFileSync(path.join(HERE, 'FROZEN.json'), 'utf8'));
const skip = sandboxAvailable() ? false : 'no user namespaces';
const work = t => { const d = mkdtempSync(path.join(tmpdir(), 'wbed-refs-test-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test('FROZEN.json pins the reference bytes, the validated v1 bytes and the engine, beds and harness they were validated on', async () => {
  for (const [rung, ref] of Object.entries(FROZEN.references)) {
    assert.equal(sha(ref.file), ref.sha256, `${rung}: ${ref.file} changed after the freeze (W-BED §2.3: the reference is never tuned again)`);
    assert.equal(sha(ref.validatedV1.file), ref.validatedV1.sha256, `${rung}: the validated v1 copy changed`);
    // The bed the recorded validation ran on (review finding 13): a bed version bump means re-validate (README "Re-validation").
    const bed = await import(`../../${ref.bed}/index.mjs`);
    assert.equal(bed.family.version, ref.bedFamilyVersion, `${ref.bed} is ${bed.family.version}, validated on ${ref.bedFamilyVersion}: re-validate (README "Re-validation")`);
  }
  // The engine: flow-v3 and run-compiled as frozen, or a pair a recorded re-validation ran on (validate.mjs --revalidate:
  // every recorded deterministic row re-run with 0 mismatches; README "Re-validation").
  const engine = f => createHash('sha256').update(readFileSync(path.join(HERE, '../../../experiments/jit', f))).digest('hex');
  const now = { flowV3Sha256: engine('flow-v3.mjs'), runCompiledSha256: engine('run-compiled.mjs') };
  const validated = [{ flowV3Sha256: FROZEN.engine.flowV3Sha256, runCompiledSha256: FROZEN.engine.runCompiledSha256 }, ...(FROZEN.engine.revalidated ?? []).filter(e => e.mismatches === 0)];
  assert.ok(validated.some(e => e.flowV3Sha256 === now.flowV3Sha256 && e.runCompiledSha256 === now.runCompiledSha256),
    `flow-v3.mjs or run-compiled.mjs moved (${JSON.stringify(now)}): re-validate the references (README "Re-validation": validate.mjs --revalidate) before a paid round uses them`);
  // The harness and the recorded runs (stub policy, author tables, analyst readings, the driver, the validation files).
  for (const [file, digest] of Object.entries({ ...FROZEN.harness.files, ...FROZEN.validation.files })) assert.equal(sha(file), digest, `${file} changed: record it in FROZEN.json with the re-validation`);
});

test('stub policies A and B: fixed functions of the request text and schema (first/last enum, first/last quoted sentence, one array element per line)', () => {
  const schema = { type: 'object', properties: { meaning: { type: 'string', enum: ['VOID', 'KEEP'] }, quote: { type: 'string' }, note: { type: 'string' }, ok: { type: 'boolean' },
    list: { type: 'array', items: { type: 'string', enum: ['US', 'GB', 'UNKNOWN'] } } } };
  const prompt = 'Question.\n<<<\nFirst line here. Second sentence here.\nShort.\nLast line of the block.\n>>>\n<<<\nother block\n>>>';
  assert.equal(firstFence(prompt), 'First line here. Second sentence here.\nShort.\nLast line of the block.');
  assert.deepEqual(stubAnswer('A', { prompt, schema }), { meaning: 'VOID', quote: 'First line here.', note: '', ok: true, list: ['US', 'US', 'US'] });
  assert.deepEqual(stubAnswer('B', { prompt, schema }), { meaning: 'KEEP', quote: 'Last line of the block.', note: '', ok: false, list: ['UNKNOWN', 'UNKNOWN', 'UNKNOWN'] });
  assert.deepEqual(stubAnswer('A', { prompt, schema }), stubAnswer('A', { prompt, schema }));
  assert.throws(() => stubAnswer('C', { prompt, schema }));
  // List-price token estimate: ceil(chars / 4) in and out (+10 framing tokens out).
  const c = stubCostUsd({ inputPerMTok: 0.1, outputPerMTok: 0.5 }, { system: 'x'.repeat(400), prompt: 'y'.repeat(4000), schema: {} }, { a: 1 });
  assert.equal(c, Math.round((((100 + 1000 + 1) * 0.1 + (2 + 10) * 0.5) / 1e6) * 1e8) / 1e8);
});

test('summarize: judge dependence compares stub A with stub B only', () => {
  const row = (policy, outDigest, pass) => ({ rung: 'r1', seed: 1, difficulty: 3, policy, outDigest, pass, status: 'ok', costUsd: 0, modelCalls: 0, sonnetCalls: 0, judgesFailed: 0, maxPromptChars: 0, latencyMs: 1, flags: [] });
  const same = summarize([row('A', 'x', false), row('B', 'x', false), row('author', 'y', true)]);
  assert.equal(same.judgeDependent, 0); assert.equal(same.judgeIndependentFail, 1); assert.equal(same.passWithAuthorReadings, 1);
  assert.equal(summarize([row('A', 'x', false), row('B', 'z', false)]).judgeDependent, 1);
});

test('R1 reference, fixture 373 d3 with author readings: runs in the sandbox, passes the bed oracle (analyst side), $0', { skip }, async t => {
  const r = await runOne({ rung: 'r1', seed: 373, difficulty: 3, policy: 'author', work: work(t), labels: true });
  assert.equal(r.status, 'ok', JSON.stringify(r));
  assert.equal(r.pass, true); assert.equal(r.labelMatch, true);
  assert.equal(r.costUsd, 0); assert.equal(r.judgesFailed, 0); assert.ok(r.overridden >= 3, `author answers served: ${r.overridden}`);
  for (const k of ['rows-conserved', 'invoices-conserved', 'payments-conserved', 'report-arithmetic', 'report-conserves-documents']) assert.ok(r.invariants?.[k] >= 1, k);
});

test('R1 reference, fixture 373 d4 under stubs A and B: structurally valid, within budget, and judge-dependent', { skip }, async t => {
  const dir = work(t);
  const a = await runOne({ rung: 'r1', seed: 373, difficulty: 4, policy: 'A', work: dir });
  const b = await runOne({ rung: 'r1', seed: 373, difficulty: 4, policy: 'B', work: dir });
  for (const r of [a, b]) {
    assert.equal(r.status, 'ok', JSON.stringify(r));
    assert.ok(r.costUsd > 0 && r.costUsd < 0.02, `cost ${r.costUsd}`);
    assert.ok(r.modelCalls <= 16, `calls ${r.modelCalls}`);
    assert.ok(r.judgeNames.includes('dob-order') && r.judgeNames.includes('marker'), r.judgeNames.join(','));
  }
  assert.notEqual(a.outDigest, b.outDigest, 'the answer depends on the judges (birth-date order, markers)');
  const again = await runOne({ rung: 'r1', seed: 373, difficulty: 4, policy: 'A', work: dir });
  assert.equal(again.outDigest, a.outDigest, 'deterministic given its answers');
});

test('R3 reference, fixture 373 d3 with author readings: statements and totals equal the bed reference, the oracle passes (wbed-r3 1.1.0)', { skip }, async t => {
  const r = await runOne({ rung: 'r3', seed: 373, difficulty: 3, policy: 'author', work: work(t), labels: true });
  assert.equal(r.status, 'ok', JSON.stringify(r));
  assert.equal(r.statementsMatchReference, true);
  assert.equal(r.statementsMatchModuloJudged, true);
  // README "R3 bed finding": on wbed-r3 1.0.0 the totals were not reproducible from the printed quotes (false, false here).
  // 1.1.0 stores every quote at its printed precision, so the frozen reference's totals are the bed's.
  assert.equal(r.totalsMatchReference, true);
  assert.equal(r.pass, true);
  assert.ok(r.invariants?.['Z1-item-conservation'] === 16 && r.invariants?.['statement-running-balance'] === 16, JSON.stringify(r.invariants));
});

test('R3 reference with author readings passes the bed oracle on all 36 development tasks (fixtures 373-378 and 301-312, d3 and d4)', { skip }, async t => {
  // Regression for the R3 bed finding (review P0): 0/36 on wbed-r3 1.0.0 (totals), 36/36 on 1.1.0.
  const dir = work(t), jobs = [];
  for (const seed of [373, 374, 375, 376, 377, 378, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312]) for (const difficulty of [3, 4]) jobs.push({ seed, difficulty });
  const rows = [];
  let next = 0;
  await Promise.all([0, 1].map(async () => { while (next < jobs.length) { const j = jobs[next++]; rows.push(await runOne({ rung: 'r3', ...j, policy: 'author', work: dir })); } }));
  const bad = rows.filter(r => !(r.status === 'ok' && r.pass && r.totalsMatchReference && r.costUsd === 0 && r.judgesFailed === 0));
  assert.deepEqual(bad.map(r => `${r.seed} d${r.difficulty} ${r.status} pass=${r.pass} totals=${r.totalsMatchReference}`), []);
  assert.equal(rows.length, 36);
});

test('out of sample (dev 313-324), world readings: the frozen references\' known results, pinned (review finding 4)', { skip }, async t => {
  // validation/dev-313-324.json: R3 36/36 pass; R1 34/36, the two failures a typo'd name particle outside the reference's
  // fixed particle list ("van dn Berg": the VENDEX name reader fails and guard names-read deopts; "vn der Meer": the name
  // splits wrongly and two rows of one customer stay apart, a wrong answer). The references are frozen, so these stay.
  const dir = work(t);
  const ok = await runOne({ rung: 'r1', seed: 313, difficulty: 3, policy: 'world', work: dir, labels: true });
  assert.equal(ok.status, 'ok', JSON.stringify(ok)); assert.equal(ok.pass, true); assert.equal(ok.costUsd, 0);
  const deopt = await runOne({ rung: 'r1', seed: 320, difficulty: 4, policy: 'world', work: dir });
  assert.equal(deopt.status, 'deopt'); assert.deepEqual(deopt.deopt, { kind: 'guard', name: 'names-read' });
  const wrong = await runOne({ rung: 'r1', seed: 322, difficulty: 4, policy: 'world', work: dir });
  assert.equal(wrong.status, 'ok'); assert.equal(wrong.pass, false); assert.equal(wrong.judgesFailed, 0);
  const r3 = await runOne({ rung: 'r3', seed: 313, difficulty: 5, policy: 'world', work: dir, labels: true });
  assert.equal(r3.status, 'ok', JSON.stringify(r3)); assert.equal(r3.pass, true); assert.equal(r3.invariants?.['Z1-item-conservation'], 48);
});

test('metamorphic relations (ATTACK M1) hold for the frozen references given correct readings (review finding 7)', { skip }, async t => {
  // A correct, order-free solver must keep every relation its bed declares; validation/relations-*.json has all 36 + 72 tasks.
  const dir = work(t);
  for (const rung of ['r1', 'r3']) {
    const r = await runOne({ rung, seed: 374, difficulty: 4, policy: 'author', work: dir, relations: true });
    assert.equal(r.status, 'ok', JSON.stringify(r)); assert.equal(r.pass, true);
    const statuses = Object.values(r.relations ?? {});
    assert.ok(statuses.length >= 3, `${rung}: ${JSON.stringify(r.relations)}`);
    assert.deepEqual(statuses.filter(s => s !== 'agree'), [], `${rung}: ${JSON.stringify(r.relations)}`);
  }
});

test('R3 reference, fixture 374 d4 under stub B: one wide over 32 suppliers, the code-decided part equals the bed reference', { skip }, async t => {
  const dir = work(t);
  const r = await runOne({ rung: 'r3', seed: 374, difficulty: 4, policy: 'B', work: dir });
  assert.equal(r.status, 'ok', JSON.stringify(r));
  assert.equal(r.statementsMatchModuloJudged, true);
  assert.ok(r.costUsd < 0.01, `cost ${r.costUsd}`);
  assert.deepEqual(r.judgeNames, ['reason']);
  assert.equal(r.invariants?.['Z1-item-conservation'], 32);
  const trace = readFileSync(path.join(dir, 'r3-374-d4-B', 'trace.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const start = trace.find(e => e.kind === 'wide-start'), end = trace.find(e => e.kind === 'wide-end');
  assert.equal(start.concurrency, 8); assert.equal(end.ok, true); assert.equal(end.n, 32); assert.equal(end.done, 32);
  assert.ok(end.spentUsd <= end.budgetUsd);
  assert.equal(trace.filter(e => e.kind === 'wide-item').length, 32);
});
