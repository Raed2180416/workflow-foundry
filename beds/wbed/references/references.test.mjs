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

test('FROZEN.json pins the reference bytes, the validated v1 bytes and the flow-v3 SDK they were validated on', () => {
  for (const [rung, ref] of Object.entries(FROZEN.references)) {
    assert.equal(sha(ref.file), ref.sha256, `${rung}: ${ref.file} changed after the freeze (W-BED §2.3: the reference is never tuned again)`);
    assert.equal(sha(ref.validatedV1.file), ref.validatedV1.sha256, `${rung}: the validated v1 copy changed`);
  }
  assert.equal(createHash('sha256').update(readFileSync(path.join(HERE, '../../../experiments/jit/flow-v3.mjs'))).digest('hex'), FROZEN.engine.flowV3Sha256,
    'flow-v3.mjs moved: re-validate the references (README "Re-validation") before a paid round uses them');
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

test('R3 reference, fixture 373 d3 with author readings: statements equal the bed reference; totals do not (R3 bed finding)', { skip }, async t => {
  const r = await runOne({ rung: 'r3', seed: 373, difficulty: 3, policy: 'author', work: work(t), labels: true });
  assert.equal(r.status, 'ok', JSON.stringify(r));
  assert.equal(r.statementsMatchReference, true);
  assert.equal(r.statementsMatchModuloJudged, true);
  // README "R3 bed finding": the bed's by_reason / totals are not reproducible from the printed quotes. When the bed is fixed,
  // this flips to true and the oracle pass to true; update the README and FROZEN.json validation numbers then.
  assert.equal(r.totalsMatchReference, false);
  assert.equal(r.pass, false);
  assert.ok(r.invariants?.['Z1-item-conservation'] === 16 && r.invariants?.['statement-running-balance'] === 16, JSON.stringify(r.invariants));
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
