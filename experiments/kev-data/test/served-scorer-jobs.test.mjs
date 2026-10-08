// served-scorer-jobs acceptance (research/kev-20261007/JUDGE-BUILD-PLAN.json, group "served-scorer-jobs").
// Runs alone: node --test experiments/kev-data/test/served-scorer-jobs.test.mjs
//
// Development evidence only: no training, no model forward, no laptop. Nothing here submits a bridge job; the bridge is
// imported read-only (bridge/laptop/jobs.mjs, config.mjs; bridge/cloud/client.mjs and the daemon only in the in-process
// round trip on a loopback port). Python runs only the pinned tokenizer, Kev's loaders and parsers, and Kev's own
// FastAPI app / benchmark data path with the model forward replaced (/opt/kev-venv, `python -I`, offline). The fixtures are
// synthetic log-line records; no bed, no test-split world, nothing under beds/sealed/ is read.
//
// Acceptance tests (the group's list, in order) -> tests here:
//   1 every J-spec passes validateParams/buildCommand and the real kev.train/benchmark/serve argparse
//       -> "kev: every J-spec ..." (+ unit: the J0 specs carry the program's parameters)
//   2 200 records, 40% of states 400-2,000 tokens: kev.benchmark --data rejects, score-served rejects none, 20 re-reads agree
//       -> "kev: 200-record file ..." (real kev.benchmark.evaluate_records + Kev's real FastAPI app, forward replaced);
//          "kev-live: ..." runs the real CPU model (KEV_DATA_SERVED_LIVE=1)
//   3 never a second kev.serve, never a kev.train queued while a service runs
//       -> "unit: sequence ...", "unit: the runner ..." (stand-in daemon), "bridge: a plan runs against an in-process daemon"
//   4 the J0 report: s/record, s/token, tokens/s, peak_rss_bytes, peak_device_bytes, free -m, free disk, kernel path; schedule regenerated
//       -> "unit: the J0 report ...", "unit: the schedule ..."
//   5 the file router sends a file to kev.benchmark only if every state fits 384 tokens
//       -> "unit: the route decision ...", "kev: the router ..."
//   6 per training job: no "dropped" line, N training requests = file records + replay, outputs under runs/<jobId>
//       -> "unit: train acceptance ...", "unit: the log patterns are Kev's own"
//   7 after J2 at 5K, within 20% of the J0 prediction or the schedule is recomputed and the deviation logged
//       -> "unit: J2 reconciliation ..."
// Cut line (J0b shared_prefix A/B): built and tested ("unit: J0b ...").
//
// Spec ambiguities resolved here (also in the group's final report):
//  - "train.log" is the bridge job log (stdout and stderr of kev.train, logs/<jobId>.log); Kev writes no train.log file.
//  - "the file router sends a file to kev.benchmark only if every state fits 384 tokens": the decision is Kev's own fits() at
//    the training context (state 384, branch 1,024, packed 2,048), the rule kev.benchmark --data enforces; a record whose
//    state fits but whose question branch does not is rejected by the benchmark too, so it routes to the served scorer.
//  - J0b needs two arms (shared_prefix 0 and 1) on the same 4-question file; "1.5x faster" is seconds per record, arm A over arm B.
//  - The reduced-plan switch compares the fitted rate at the 5K point mix (800 forward tokens per row, 500 per replay record)
//    with 1,500 tokens/s; the reduced plan counts 6 point reads, the program says 7 (it appears to count the grid's "base" twice).
//  - Strict priority when cutting: the first item that does not fit and every later item are cut; J5 is reserved first.
//  - "free RAM" for the 80% rule is `available` from `free -m`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as J from '../jobs.mjs';
import * as SS from '../score-served.mjs';
import { KEV, PYTHON, HF_HOME, TOKENIZER, measureRecords, validateKevFile } from '../lib/tokens.mjs';
import * as H from '../lib/harness.mjs';

const TEST_FILE = fileURLToPath(import.meta.url);
const HERE = path.dirname(TEST_FILE);
const REPO = path.resolve(HERE, '..', '..', '..');
const MUTANT_RUN = process.env.KEV_DATA_MUTANT_RUN === '1';
const LIVE = process.env.KEV_DATA_SERVED_LIVE === '1';
const sha = data => createHash('sha256').update(data).digest('hex');
const once = f => { let done = false, v; return () => { if (!done) { done = true; v = f(); } return v; }; };
const pyEnv = () => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', LANG: 'C.UTF-8', HF_HOME, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false', PYTHONDONTWRITEBYTECODE: '1' });
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const jsonl = records => records.map(r => JSON.stringify(r)).join('\n') + '\n';
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---- fixtures: synthetic log-line records, no bed ---------------------------------------------------------------------
const logRecord = (prefix, i, lines, { questions = 1, pad = 0 } = {}) => J.probeRecord({ id: `${prefix}/${i}`, lines: J.makeLog(`${prefix}/${i}`, lines, pad), seedText: `${prefix}/${i}`, questions });
// 200 records, 40% of them with states of 400-2,000 real tokens (a log line is 41-60 tokens; checked by measuring, not assumed)
const AT2_LONG_LINES = i => 10 + ((i * 7) % 23);     // 10..32 lines
const AT2_SHORT_LINES = i => 2 + (i % 4);            // 2..5 lines
const at2Records = once(() => Array.from({ length: 200 }, (_, i) => (i % 5 < 2 ? logRecord('at2', i, AT2_LONG_LINES(i)) : logRecord('at2', i, AT2_SHORT_LINES(i)))));
const at2Measured = once(() => measureRecords(at2Records(), { maxState: 384 }));      // fits() at Kev's training context

// a stand-in for a SystemOneClient (describe + ask), to exercise the scorer's own logic without a server
function fakeServed({ run = 'jaredpalmer/kev-0.8b@v1.0', answer, runs = null } = {}) {
  const calls = { ask: 0, describe: 0, requests: [] };
  const served = {
    calls,
    async describe() { calls.describe++; return { ids: [], raw: { models: [{ name: 'kev-latest', run: runs ? runs[Math.min(calls.describe - 1, runs.length - 1)] : run, base: 'Qwen/Qwen3.5-0.8B-Base', lora: 16, device: 'cuda', backend: 'torch', dtype: 'torch.bfloat16', temperature: 2.35, max_state_tokens: 65536, truncate_states: false, cuda_graphs: {}, prefix_cache: { size: 4 } }, { name: 'jev-latest', run: runs ? runs[Math.min(calls.describe - 1, runs.length - 1)] : run }] } }; },
    async ask({ state, questions }) {
      calls.ask++; calls.requests.push({ state, questions });
      return answer ? answer({ state, questions, n: calls.ask }) : defaultAnswer(questions);
    }
  };
  return served;
}
function defaultAnswer(questions, { jitter = 0, n = 0 } = {}) {
  const answers = {};
  for (const [qid, q] of Object.entries(questions)) {
    const keys = q.type === 'choice' ? Object.keys(q.criteria) : q.type === 'noul' ? ['false', 'true'] : q.criteria.map((_, i) => String(i));
    const w = keys.map((k, i) => 1 + ((sha(`${qid}${k}`).charCodeAt(0) + i) % 7) + (jitter ? jitter * Math.sin(n + i) : 0)), t = w.reduce((a, b) => a + b, 0);
    const p = w.map(x => Math.round((x / t) * 1e4) / 1e4);
    answers[qid] = q.type === 'noul' ? { type: 'noul', noul: p[1] } : { type: q.type, choice: keys[0], confidence: 0.5, probabilities: Object.fromEntries(keys.map((k, i) => [k, p[i]])) };
  }
  return { model: 'kev-latest', answers, usage: { input_tokens: 123, output_tokens: 40 }, latency_ms: 2.5 };
}
const err = (code, message) => Object.assign(new Error(message), { code, name: 'FoundryError' });
const choice = (labels, label = labels[0]) => ({ type: 'choice', instructions: 'Which?', criteria: Object.fromEntries(labels.map(l => [l, ''])), label, src: 'unit_choice' });
const tinyRecords = n => Array.from({ length: n }, (_, i) => ({ state: { system: 'ATLAS', note: `note ${i}` }, questions: { A: choice(['x', 'y', 'z'], 'y'), B: { type: 'noul', instructions: 'Yes?', label: i % 2 === 0, src: 'unit_noul' } }, _meta: { id: `tiny/${i}` } }));

// =============================================================================================================
// unit: the served scorer
// =============================================================================================================

test('unit: kev files parse the way kev.data.load_records does, and the request carries no label', () => {
  const lines = [JSON.stringify(tinyRecords(1)[0]), '', JSON.stringify({ state: 'plain', questions: { Q: { type: 'score', instructions: 'Level?', criteria: ['low', 'high'], label: 1, target: { 1: 1 } } } })];
  const recs = SS.parseKevText(lines.join('\n') + '\n', { source: 'unit' });
  assert.equal(recs.length, 2);
  assert.equal(recs[0]._meta.id, 'tiny/0');
  assert.equal(recs[1]._meta.id, 'unit/2', 'the default id counts the blank line, as enumerate does in Kev');
  assert.equal(recs[1].questions.Q.src, 'unit_score');
  for (const r of recs) {
    const req = SS.requestOf(r);
    assert.deepEqual(Object.keys(req), ['state', 'questions']);
    for (const q of Object.values(req.questions)) assert.deepEqual(Object.keys(q).filter(k => !['type', 'instructions', 'criteria'].includes(k)), [], 'no label, src or target leaves the machine');
  }
  assert.throws(() => SS.parseKevText('{"state":1}\n'), /non-empty questions/);
  assert.throws(() => SS.parseKevText('{"state":1,"questions":{"Q":{"type":"choice","criteria":{"a":""}}}}\n'), /no label/);
  assert.throws(() => SS.parseKevText(`${JSON.stringify(tinyRecords(1)[0])}\n${JSON.stringify(tinyRecords(1)[0])}\n`), e => e.code === 'SERVED_INPUT_DUPLICATE_ID');
  assert.throws(() => SS.parseKevText('not json\n'), /not JSON/);
});

test('unit: option names that JavaScript would reorder are refused, not served in another order', () => {
  assert.deepEqual(SS.questionKeys(choice(['b', 'a', 'c'])), ['b', 'a', 'c']);
  assert.throws(() => SS.questionKeys(choice(['b', '10', '2'])), e => e.code === 'SERVED_KEYS');
  assert.deepEqual(SS.questionKeys({ type: 'noul' }), ['false', 'true']);
  assert.deepEqual(SS.questionKeys({ type: 'score', criteria: ['lo', 'hi'] }), ['0', '1']);
});

test('unit: an answer is checked like kev.benchmark checks it, and read as returned (4 decimals)', () => {
  const rec = tinyRecords(1)[0];
  const rows = SS.rowsOf(rec, defaultAnswer(rec.questions), { path: 'served' });
  assert.equal(rows.length, 2);
  const a = rows.find(r => r.question === 'A'), b = rows.find(r => r.question === 'B');
  assert.deepEqual(a.keys, ['x', 'y', 'z']); assert.equal(a.label, 1);
  assert.deepEqual(b.keys, ['false', 'true']); assert.equal(b.label, 1, 'a noul label true is index 1');
  for (const r of rows) { assert.ok(Math.abs(r.p.reduce((x, y) => x + y, 0) - 1) < 0.01); assert.ok(r.p.every(x => Math.abs(x * 1e4 - Math.round(x * 1e4)) < 1e-6), '4 decimals'); assert.equal(r.source, 'custom'); }
  const bad = answers => () => SS.rowsOf(rec, { answers });
  const good = defaultAnswer(rec.questions).answers;
  assert.throws(bad({ A: good.A }), /answer ids differ/);
  assert.throws(bad({ ...good, A: { ...good.A, probabilities: { x: 0.5, y: 0.5 } } }), /do not match the requested options/);
  assert.throws(bad({ ...good, A: { ...good.A, probabilities: { x: 0.9, y: 0.9, z: 0.9 } } }), /invalid probability sum/);
  assert.throws(bad({ ...good, A: { ...good.A, probabilities: { x: NaN, y: 0.5, z: 0.5 } } }), /non-finite|invalid probability/);
  assert.throws(bad({ ...good, B: { type: 'choice', probabilities: {} } }), /answer type/);
  // flooring is a calibration step with its own function
  const f = SS.floorAndRenormalize([0, 0.5, 0.5]);
  assert.ok(f[0] >= SS.PROB_FLOOR / 1.0001 && Math.abs(f.reduce((x, y) => x + y, 0) - 1) < 1e-12);
});

test('unit: all questions of a record go in one request, in input order whatever the concurrency, and rows match the file', async () => {
  const records = tinyRecords(12), served = fakeServed({ answer: ({ questions, n }) => defaultAnswer(questions, { jitter: 0, n }) });
  const out = path.join(H.tempDir('served-unit-'), 'rows.jsonl');
  const { report, rows } = await SS.scoreServed({ records, served, rowsFile: out, concurrency: 4, expectRun: 'jaredpalmer/kev-0.8b@v1.0', pingRounds: 0 });
  assert.equal(served.calls.ask, 12, 'one request per record');
  assert.ok(served.calls.requests.every(r => Object.keys(r.questions).join() === 'A,B'), 'both questions in each request');
  assert.deepEqual(rows.map(r => r.id), records.flatMap(r => [r._meta.id, r._meta.id]), 'rows follow the input order');
  assert.equal(report.coverage.evaluated_records, 12); assert.equal(report.coverage.evaluated_questions, 24); assert.equal(report.valid, true);
  assert.deepEqual(SS.readRows(out).map(r => r.id), rows.map(r => r.id));
  assert.equal(report.rows.sha256, sha(readFileSync(out)));
  assert.equal(report.served.identity.run, 'jaredpalmer/kev-0.8b@v1.0');
  assert.equal(report.served.identity.dtype, 'torch.bfloat16');
});

test('unit: a 422 is a rejection, a truncated answer is not a read, a dead service is not hidden; none is dropped silently', async () => {
  const records = tinyRecords(6);
  const served = fakeServed({ answer: ({ questions, n }) => {
    if (n === 2) throw err('MODEL_CONTEXT', 'state is 70,000 tokens, over the 65,536-token limit');
    if (n === 4) return { ...defaultAnswer(questions), truncated: true, usage: { state_tokens: 70000, state_tokens_used: 65536, input_tokens: 65600 } };
    if (n === 5) throw err('MODEL_FAILED', 'System One server returned 400');
    return defaultAnswer(questions);
  } });
  const { report } = await SS.scoreServed({ records, served, concurrency: 1, pingRounds: 0, retry: { max: 0, baseMs: 1 } });
  assert.deepEqual(report.coverage, { requested_records: 6, requested_questions: 12, evaluated_records: 3, evaluated_questions: 6, rejected_records: 1, failed_records: 1, truncated_records: 1 });
  assert.equal(report.rejected[0].id, 'tiny/1'); assert.equal(report.failed[0].code, 'MODEL_FAILED'); assert.equal(report.truncated[0].id, 'tiny/3');
  assert.equal(report.valid, false, 'any rejected, failed or truncated record invalidates the run');
  // a service that stops answering ends the run instead of burning an hour
  const dead = fakeServed({ answer: () => { throw err('MODEL_UNAVAILABLE', 'System One server error 502'); } });
  await assert.rejects(SS.scoreServed({ records: tinyRecords(20), served: dead, concurrency: 1, pingRounds: 0, retry: { max: 0, baseMs: 1 }, maxConsecutiveFailures: 5 }), e => e.code === 'SERVED_UNAVAILABLE');
  assert.equal(dead.calls.ask, 5);
  // a refused credential ends it at once
  await assert.rejects(SS.scoreServed({ records: tinyRecords(3), served: fakeServed({ answer: () => { throw err('MODEL_AUTH', 'refused'); } }), pingRounds: 0 }), e => e.code === 'MODEL_AUTH');
});

test('unit: transient errors are retried with backoff, a timeout once', async () => {
  let n = 0;
  const flaky = fakeServed({ answer: ({ questions }) => { if (++n <= 2) throw err('MODEL_UNAVAILABLE', 'System One server error 503'); return defaultAnswer(questions); } });
  const { report } = await SS.scoreServed({ records: tinyRecords(1), served: flaky, pingRounds: 0, retry: { max: 4, baseMs: 1 } });
  assert.equal(report.valid, true); assert.equal(flaky.calls.ask, 3);
  const slow = fakeServed({ answer: () => { throw err('MODEL_TIMEOUT', 'System One request exceeded 1 ms'); } });
  const r = await SS.scoreServed({ records: tinyRecords(1), served: slow, pingRounds: 0, retry: { max: 4, baseMs: 1 } });
  assert.equal(slow.calls.ask, 2, 'a timeout is retried once, not four times'); assert.equal(r.report.coverage.failed_records, 1);
});

test('unit: one served model at a time: the wrong model, an ambiguous /v1/models and a swap mid-run are all refused', async () => {
  await assert.rejects(SS.scoreServed({ records: tinyRecords(1), served: fakeServed({ run: 'runs/j-1' }), expectRun: 'jaredpalmer/kev-0.8b@v1.0', pingRounds: 0 }), e => e.code === 'SERVED_MODEL_MISMATCH');
  const ambiguous = { async describe() { return { ids: [], raw: { models: [{ name: 'kev-latest', run: 'a' }, { name: 'jev-latest', run: 'b' }] } }; }, async ask() { throw new Error('unreachable'); } };
  await assert.rejects(SS.scoreServed({ records: tinyRecords(1), served: ambiguous, pingRounds: 0 }), e => e.code === 'SERVED_MODEL_AMBIGUOUS');
  // runs/<jobId> matches the daemon's absolute path
  const abs = fakeServed({ run: '/home/u/foundry-bridge/work/runs/j-20261008-111044-e2112b' });
  const ok = await SS.scoreServed({ records: tinyRecords(1), served: abs, expectRun: 'runs/j-20261008-111044-e2112b', pingRounds: 0 });
  assert.equal(ok.report.valid, true);
  // the model changed between the first and the last /v1/models
  const swap = fakeServed({ runs: ['jaredpalmer/kev-0.8b@v1.0', 'runs/j-2'] });
  const r = await SS.scoreServed({ records: tinyRecords(1), served: swap, pingRounds: 0 });
  assert.equal(r.report.served.same_model, false); assert.equal(r.report.valid, false);
});

test('unit: a run resumes from its rows file without scoring a record twice', async () => {
  const records = tinyRecords(8), dir = H.tempDir('served-resume-'), out = path.join(dir, 'rows.jsonl');
  const first = fakeServed({ answer: ({ questions, n }) => { if (n === 5) throw err('MODEL_AUTH', 'stop here'); return defaultAnswer(questions); } });
  await assert.rejects(SS.scoreServed({ records, served: first, rowsFile: out, pingRounds: 0 }), e => e.code === 'MODEL_AUTH');
  appendFileSync(out, '{"id":"torn');                                  // a torn last line, as a killed process leaves
  const second = fakeServed();
  const { report, rows } = await SS.scoreServed({ records, served: second, rowsFile: out, resume: true, pingRounds: 0 });
  assert.equal(second.calls.ask, 4, 'only the 4 records without rows are scored');
  assert.equal(report.coverage.evaluated_records, 8); assert.equal(rows.length, 16); assert.equal(report.valid, true);
  assert.equal(SS.readRows(out).length, 16);
  assert.equal(new Set(SS.readRows(out).map(r => `${r.id}/${r.question}`)).size, 16, 'no row twice');
});

test('unit: two reads of the same requests are compared by max |dp|, mean max-p and argmax flips (§7.5)', () => {
  const row = (id, p) => ({ id, question: 'A', p });
  const a = [row('1', [0.7, 0.2, 0.1]), row('2', [0.4, 0.4, 0.2]), row('3', [0.1, 0.1, 0.8])];
  const same = SS.compareReads(a, a);
  assert.equal(same.maxAbsDp, 0); assert.equal(same.agree, true); assert.equal(same.stable, true);
  const near = SS.compareReads(a, [row('1', [0.705, 0.195, 0.1]), row('2', [0.4, 0.4, 0.2]), row('3', [0.1, 0.105, 0.795])]);
  assert.ok(near.maxAbsDp < 0.01 && near.agree);
  const far = SS.compareReads(a, [row('1', [0.69, 0.21, 0.1]), row('2', [0.4, 0.4, 0.2]), row('3', [0.1, 0.1, 0.8])]);
  assert.ok(far.maxAbsDp >= 0.01 - 1e-9 && !far.agree, 'a difference of 0.01 is not within |dp| < 0.01');
  const flip = SS.compareReads(a, [row('1', [0.3, 0.6, 0.1]), row('2', [0.4, 0.4, 0.2]), row('3', [0.1, 0.1, 0.8])]);
  assert.equal(flip.argmaxFlips, 1); assert.equal(flip.stable, false);
  const missing = SS.compareReads(a, a.slice(1));
  assert.equal(missing.missing, 1); assert.equal(missing.agree, false);
});

// =============================================================================================================
// unit: specs, data, router, sequence
// =============================================================================================================

test('unit: the J0 stages carry the program\'s parameters (§7.4)', () => {
  const stages = J.j0Stages(), by = Object.fromEntries(stages.map(s => [s.id, s]));
  assert.deepEqual(stages.map(s => s.id), ['J0-observe-host', 'J0a-0300', 'J0a-2k', 'J0a-8k', 'J0b-A', 'J0b-B', 'J0k-kernels', 'J0c-serve', 'J0c-score-0300-c1', 'J0c-score-0300-c4', 'J0c-score-2k-c1', 'J0c-score-2k-c4', 'J0c-stop']);
  const base = { base: 'Qwen/Qwen3.5-0.8B-Base', initFrom: 'jaredpalmer/kev-0.8b@v1.0', epochs: 1, lr: 2e-5, batch: 1, accum: 8, dtype: 'bf16', maxState: 8192, checkpointing: 1, lora: 16 };
  const pin = 'dc7cdfe2ee4154fa7e30f5b51ca41bfa40174e68';
  assert.deepEqual(by['J0a-0300'].params, { dataset: 'data/j0-0300.jsonl', ...base, extra: { base_revision: pin, max_steps: 50, seed: 1, suite: 'evals/v7/decision-v7', replay: 50 } });
  assert.deepEqual(by['J0a-2k'].params.extra, { base_revision: pin, max_steps: 30, seed: 1, suite: 'evals/v7/decision-v7', replay: 50, row_budget: 16384, length_sort: 1 });
  assert.deepEqual(by['J0a-8k'].params.extra, { base_revision: pin, max_steps: 10, seed: 1, suite: 'evals/v7/decision-v7', replay: 50, row_budget: 16384, length_sort: 1, weights_dtype: 'bf16' });
  for (const id of ['J0a-0300', 'J0a-2k']) assert.ok(!('weights_dtype' in by[id].params.extra), 'bf16 weights are the long-state probe only, never a curve point (§7.2)');
  assert.equal(by['J0b-A'].params.extra.shared_prefix, 0); assert.equal(by['J0b-B'].params.extra.shared_prefix, 1);
  assert.equal(by['J0b-A'].params.dataset, by['J0b-B'].params.dataset, 'both arms read the same 4-question file');
  assert.deepEqual(by['J0c-serve'].params, { run: 'jaredpalmer/kev-0.8b@v1.0', port: 8008 });
  assert.deepEqual(stages.filter(s => s.kind === 'score').map(s => [s.data.split('/').pop(), s.concurrency]), [['j0-0300.jsonl', 1], ['j0-0300.jsonl', 4], ['j0-2k.jsonl', 1], ['j0-2k.jsonl', 4]]);
  assert.ok(!J.j0Stages({ includeJ0b: false }).some(s => s.job === 'J0b'), 'J0b (the cut line) can be dropped without touching the rest');
  assert.doesNotThrow(() => J.assemblePlan(stages));
  // J2 / J4 recipe (§7.2, §7.4): as J0a without max_steps, maxState the build's p99.9, replay 2,000, p_none_pair 0.25
  const train = { file: 'x', sha256: 'a'.repeat(64), records: 5000, rows: 5000 };
  const j2 = J.j2Stage({ point: '5K', seed: 2, train, maxState: 1536 });
  assert.equal(j2.id, 'J2-5000-s2');
  assert.deepEqual(j2.params.extra, { base_revision: pin, seed: 2, suite: 'evals/v7/decision-v7', replay: 2000, p_none_pair: 0.25, lora_targets: 'all' });
  assert.equal(j2.params.maxState, 1536); assert.equal(j2.params.dtype, 'bf16'); assert.ok(!('max_steps' in j2.params.extra));
  assert.deepEqual(J.j2Stage({ point: '20K', train, maxState: 4096, longStates: true }).params.extra, { base_revision: pin, seed: 1, suite: 'evals/v7/decision-v7', replay: 2000, p_none_pair: 0.25, lora_targets: 'all', row_budget: 16384, length_sort: 1 });
  const grid = Object.fromEntries(Object.keys(J.GRID).map(g => [g, J.j4Stage({ config: g, train, maxState: 1536 })]));
  assert.equal(grid.lr4.params.lr, 4e-5); assert.equal(grid.ep2.params.epochs, 2); assert.equal(grid.rp6.params.extra.replay, 6000); assert.equal(grid.np0.params.extra.p_none_pair, 0);
  for (const [name, s] of Object.entries(grid)) { const changed = ['lr', 'epochs'].filter(k => s.params[k] !== j2.params[k]).length + ['replay', 'p_none_pair'].filter(k => s.params.extra[k] !== J.j2Stage({ point: '5K', train, maxState: 1536 }).params.extra[k]).length; assert.equal(changed, 1, `${name} changes exactly one field`); }
  assert.throws(() => J.j2Stage({ point: '5K', train }), e => e.code === 'PLAN_MAXSTATE');
});

test('unit: J0 log-line records answer from their own lines (a second scan), deterministically', () => {
  for (let i = 0; i < 60; i++) {
    const n = 2 + (i % 40), rec = logRecord('scan', i, n, { questions: 4, pad: i % 7 });
    const truth = J.scanLog(rec.state.log.split('\n')), q = rec.questions;
    assert.equal(q.first_error.label, truth.firstErrorService); assert.equal(q.last_warn.label, truth.lastWarnService);
    assert.equal(q.slowest.label, truth.slowestService); assert.equal(q.last_level.label, truth.lastLevel);
    for (const [id, qq] of Object.entries(q)) { assert.ok(Object.hasOwn(qq.criteria, qq.label), `${id}: the label is an offered option`); assert.equal(Object.keys(qq.criteria).length, 4); }
    assert.deepEqual(rec, logRecord('scan', i, n, { questions: 4, pad: i % 7 }), 'same inputs, same record');
    assert.ok(!/label|truth|answer/.test(Object.keys(rec.state).join()), 'the state names no answer');
  }
  assert.notDeepEqual(logRecord('scan', 1, 12), logRecord('scan', 2, 12));
});

test('unit: the route decision: kev.benchmark only if every record fits the training context', () => {
  const ok = (stateTokens, fits = true) => ({ ok: true, fits, stateTokens, packedTokens: stateTokens + 80, error: null });
  const all = J.routeFromResults([ok(120), ok(383), ok(384)]);
  assert.equal(all.route, 'benchmark'); assert.equal(all.overflowing, 0); assert.equal(all.maxStateTokens, 384);
  const one = J.routeFromResults([ok(120), ok(385, false), ok(300)]);
  assert.equal(one.route, 'served'); assert.equal(one.overflowing, 1); assert.match(one.reason, /1 of 3 records exceed the training context/);
  // a state that fits but a branch that does not is rejected by the benchmark as well
  assert.equal(J.routeFromResults([ok(100), ok(100, false)]).route, 'served');
  assert.throws(() => J.routeFromResults([]), e => e.code === 'ROUTE_INVALID');
  assert.throws(() => J.routeFromResults([ok(10), { ok: false, fits: false, error: 'ValueError: no' }]), e => e.code === 'ROUTE_INVALID');
});

const stage = (id, kind, extra = {}) => ({ id, kind, ...extra });
const serve = (id, run = 'jaredpalmer/kev-0.8b@v1.0') => stage(id, 'kev.serve', { params: { run, port: 8008 } });
const score = (id, of, run = 'jaredpalmer/kev-0.8b@v1.0') => stage(id, 'score', { serve: of, expectRun: run, needs: [of] });
const train = id => stage(id, 'kev.train', { params: {} });
test('unit: sequence: never a second kev.serve, never a GPU job queued while a service runs', () => {
  const fine = [train('t1'), serve('s1'), score('c1', 's1'), stage('x1', 'serve.stop', { serve: 's1' }), train('t2'), serve('s2', 'runs/{{t2}}'), score('c2', 's2', 'runs/{{t2}}'), stage('x2', 'serve.stop', { serve: 's2' })];
  const timeline = J.checkSequence(fine);
  assert.equal(timeline.filter(t => t.kind === 'kev.train').every(t => t.service === null), true);
  const refuses = (stages, re) => assert.throws(() => J.checkSequence(stages), e => e instanceof J.SequenceError && re.test(e.message), re.source);
  refuses([serve('s1'), serve('s2')], /a second kev\.serve while s1 is running/);
  refuses([serve('s1'), train('t1'), stage('x', 'serve.stop', { serve: 's1' })], /kev\.train is queued while the service s1 runs/);
  refuses([serve('s1'), stage('b', 'kev.benchmark', { params: {} }), stage('x', 'serve.stop', { serve: 's1' })], /kev\.benchmark is queued while the service s1 runs/);
  assert.doesNotThrow(() => J.checkSequence([serve('s1'), stage('b', 'kev.benchmark', { params: {} }), stage('x', 'serve.stop', { serve: 's1' })], { allowBenchmarkDuringService: true }));
  refuses([score('c', 's1')], /not the running service/);
  refuses([serve('s1', 'runs/{{nope}}'), stage('x', 'serve.stop', { serve: 's1' })], /\{\{nope\}\}, which is not an earlier kev\.train/);
  refuses([train('t1'), serve('s1', 'runs/{{t1}}'), score('c', 's1', 'jaredpalmer/kev-0.8b@v1.0'), stage('x', 'serve.stop', { serve: 's1' })], /expects jaredpalmer\/kev-0\.8b@v1\.0 but the service runs runs\/\{\{t1\}\}/);
  refuses([serve('s1')], /ends with s1 still running/);
  refuses([stage('x', 'serve.stop', { serve: 's1' })], /not the running service/);
  refuses([train('t1'), train('t1')], /duplicate/);
  // a read of a candidate cannot start before its stock service stops: swapping the run without stopping is a second serve
  refuses([serve('stock'), serve('cand', 'runs/{{x}}')], /second kev\.serve/);
  // the writers' own output always passes
  const reads = [{ id: 'a', file: 'a.jsonl', sha256: 'b'.repeat(64), route: { route: 'benchmark', reason: 'fits' } }, { id: 'b', file: 'b.jsonl', sha256: 'c'.repeat(64), route: { route: 'served', reason: 'long' } }];
  const plan = [...J.j0Stages(), ...J.j1Stages({ reads }), train('J2-5000-s1'), ...J.j3Stages({ of: 'J2-5000-s1', reads }), ...J.j5Stages({ reads, candidate: 'runs/{{J2-5000-s1}}' })];
  const tl = J.checkSequence(plan);
  for (const [i, s] of plan.entries()) if (['kev.train', 'kev.benchmark'].includes(s.kind)) assert.equal(tl[i].service, null, `${s.id} runs with no service`);
  assert.equal(plan.filter(s => s.kind === 'kev.serve').length, plan.filter(s => s.kind === 'serve.stop').length);
  // J5: stock first, candidate after, never concurrent
  const j5 = J.j5Stages({ reads, candidate: 'runs/j-20261008-111044-e2112b' }).filter(s => s.kind === 'kev.serve');
  assert.deepEqual(j5.map(s => s.params.run), ['jaredpalmer/kev-0.8b@v1.0', 'runs/j-20261008-111044-e2112b']);
  assert.throws(() => J.j5Stages({ reads, candidate: 'jaredpalmer/kev-0.8b@v1.0' }), e => e.code === 'PLAN_CANDIDATE');
});

test('unit: nested curve files are byte prefixes of one another and report what they cannot reach', () => {
  const dir = H.tempDir('served-nested-');
  const recs = Array.from({ length: 90 }, (_, i) => ({ state: `s${i}`, questions: Object.fromEntries(Array.from({ length: 1 + (i % 3) }, (_, k) => [`Q${k}`, choice(['a', 'b'])])), _meta: { id: `n/${i}` } }));
  writeFileSync(path.join(dir, 'train.jsonl'), jsonl(recs));
  const total = recs.reduce((n, r) => n + Object.keys(r.questions).length, 0);
  const out = J.nestedPrefixes(path.join(dir, 'train.jsonl'), { points: ['25', '60', '120', '4000'], outDir: path.join(dir, 'nested') });
  for (let i = 1; i < out.length; i++) assert.ok(readFileSync(out[i].file, 'utf8').startsWith(readFileSync(out[i - 1].file, 'utf8')), 'each larger set contains the smaller one in the same order');
  for (const o of out) { assert.ok(o.rows <= o.targetRows); assert.equal(o.sha256, sha(readFileSync(o.file))); }
  assert.ok(out[0].rows <= 25 && out[0].rows >= 23); assert.equal(out[2].shortfall, total < 120); assert.equal(out[3].shortfall, true, 'a train file with fewer rows than the point is reported, not padded');
  assert.equal(out.at(-1).rows, total); assert.equal(out.at(-1).exact, false);
});

// =============================================================================================================
// unit: train and benchmark acceptance (acceptance 6)
// =============================================================================================================

const GOOD_LOG = (n = 400, replay = 50, extra = '') => [
  `replay: ${replay} of 3000 suite training records mixed with ${n} from /home/u/foundry-bridge/work/data/j0-0300.jsonl`,
  ...(extra ? [extra] : []),
  `${n + replay} training requests (holdout=), questions by type {'choice': ${n + replay}}`,
  'device=cuda world=1 trainable params=11.3M',
  'ep0 step 10/50 loss 0.912 kl 0.000 anchor 0.000 0.311s/rec', 'ep0 step 20/50 loss 0.704 kl 0.000 anchor 0.000 0.301s/rec',
  'saved /home/u/foundry-bridge/work/runs/j-20261008-111041-cd3b9b',
  '[bridge 2026-10-08T11:11:41.000Z] end succeeded exit=0'
].join('\n');
const JOB_ID = 'j-20261008-111041-cd3b9b';
const GOOD_JOB = (id = JOB_ID) => ({ id, state: 'succeeded', outputDir: `runs/${id}`, outputs: { dir: `runs/${id}`, files: ['head.pt', 'training_metrics.json', 'training_config.json', 'adapter_model.safetensors'].map(f => ({ path: `runs/${id}/${f}` })) } });
const GOOD_CONFIG = (o = {}) => ({ args: { init_from: 'jaredpalmer/kev-0.8b@v1.0', max_state: 8192, epochs: 1, replay: 50, ...o.args }, base_revision: TOKENIZER.revision, suite_sha256: 'd'.repeat(64), ...o.top });
const GOOD_METRICS = { rejected_records: 0, truncated_records: 0, optimizer_steps: 50 };
const EXPECT = (o = {}) => ({ fileRecords: 400, replay: 50, maxState: 8192, epochs: 1, jobId: JOB_ID, datasetSha256: 'a'.repeat(64), uploadedSha256: 'a'.repeat(64), manifestSha256: `sha256:${'a'.repeat(64)}`, ...o });
const check = (o = {}) => J.checkTrainJob({ log: o.log ?? GOOD_LOG(), config: o.config ?? GOOD_CONFIG(), metrics: o.metrics ?? GOOD_METRICS, job: o.job ?? GOOD_JOB(), expect: EXPECT(o.expect) });

test('unit: train acceptance: no "dropped" line, N training requests = file records + replay, outputs under runs/<jobId>', () => {
  const good = check();
  assert.deepEqual(good.errors, []); assert.equal(good.ok, true); assert.equal(good.facts.requests, 450);
  const bad = (o, re) => { const r = check(o); assert.equal(r.ok, false); assert.ok(r.errors.some(e => re.test(e)), `${re}: ${JSON.stringify(r.errors)}`); };
  bad({ log: GOOD_LOG(400, 50, 'dropped 3 of 453 records that exceed the training context (384 state / 1024 branch / 2048 packed tokens)') }, /"dropped" line/);
  bad({ log: GOOD_LOG(397, 50).replace('mixed with 397', 'mixed with 400') }, /450 training requests|447 training requests/);
  bad({ log: GOOD_LOG().replace(/^\d+ training requests/m, '449 training requests') }, /449 training requests, expected 400 file records \+ 50 replay = 450/);
  bad({ log: GOOD_LOG().replace(/^\d+ training requests.*\n/m, '') }, /no "N training requests" line/);
  bad({ log: GOOD_LOG(400, 50).replace('replay: 50 of 3000', 'replay: 40 of 40') }, /the suite supplied 40 records, 50 were requested/);
  bad({ log: GOOD_LOG().replace(/^replay:.*\n/m, '') }, /no "replay:" line/);
  bad({ log: GOOD_LOG(400, 0) , expect: { replay: 0 } }, /mixes replay records|training requests/);
  bad({ log: `${GOOD_LOG()}\nKilled` }, /out-of-memory kill/);
  bad({ log: GOOD_LOG().replace('end succeeded exit=0', 'end failed exit=137 signal=SIGKILL') }, /ended the job failed|out-of-memory/);
  bad({ job: { ...GOOD_JOB(), outputDir: 'runs/j-20261008-000000-aaaaaa' } }, /outputs are in runs\/j-20261008-000000-aaaaaa/);
  bad({ job: { ...GOOD_JOB(), outputs: { dir: `runs/${JOB_ID}`, files: [{ path: 'data/elsewhere.pt' }, { path: `runs/${JOB_ID}/head.pt` }] } } }, /outside runs\//);
  bad({ job: { ...GOOD_JOB(), outputs: { dir: `runs/${JOB_ID}`, files: [{ path: `runs/${JOB_ID}/training_metrics.json` }] } } }, /outputs lack head\.pt/);
  bad({ job: { ...GOOD_JOB(), state: 'failed' } }, /job state is failed/);
  bad({ config: GOOD_CONFIG({ top: { base_revision: 'f'.repeat(40) } }) }, /base_revision is f{40}, pinned dc7cdfe2/);
  bad({ config: GOOD_CONFIG({ args: { init_from: 'jaredpalmer/kev-4b@v1.0' } }) }, /init_from is "jaredpalmer\/kev-4b@v1\.0", expected jaredpalmer\/kev-0\.8b@v1\.0/);
  bad({ config: GOOD_CONFIG({ args: { max_state: 384 } }) }, /max_state is 384, expected 8192/);
  bad({ expect: { uploadedSha256: 'b'.repeat(64) } }, /differs from the uploaded sha256/);
  bad({ expect: { manifestSha256: 'sha256:' + 'c'.repeat(64) } }, /differs from the build manifest sha256/);
  bad({ metrics: { ...GOOD_METRICS, rejected_records: 2 } }, /rejected_records is 2/);
  bad({ metrics: { ...GOOD_METRICS, optimizer_steps: 0 } }, /no optimizer step/);
  // a candidate run as the warm start: runs/<jobId> resolves to the daemon's absolute path
  const warm = check({ expect: { initFrom: 'runs/j-20261008-000000-aaaaaa' }, config: GOOD_CONFIG({ args: { init_from: '/home/u/foundry-bridge/work/runs/j-20261008-000000-aaaaaa' } }) });
  assert.deepEqual(warm.errors, []);
  // benchmark reports: rejected_records > 0 is invalid
  assert.equal(J.checkBenchmarkReport({ coverage: { requested_records: 10, evaluated_records: 10, rejected_records: 0, truncated_records: 0 } }).ok, true);
  assert.match(J.checkBenchmarkReport({ coverage: { requested_records: 10, evaluated_records: 8, rejected_records: 2, truncated_records: 0 } }).errors.join(), /rejected_records is 2/);
  assert.equal(J.checkBenchmarkReport({}).ok, false);
});

test('unit: the log patterns are Kev\'s own (the checks track the pinned train.py and benchmark.py)', () => {
  const train = readFileSync(path.join(KEV.root, 'kev', 'train.py'), 'utf8'), bench = readFileSync(path.join(KEV.root, 'kev', 'benchmark.py'), 'utf8');
  assert.ok(train.includes('print(f"replay: {len(replay)} of {len(pool)} suite training records mixed with {len(reqs)} from {a.data}"'));
  assert.ok(train.includes('print(f"{len(reqs)} training requests (holdout={holdout}), questions by type "'));
  assert.ok(train.includes('print(f"dropped {len(reqs) - len(kept)} of {len(reqs)} records that exceed the training context "'));
  assert.ok(train.includes('print(f"ep{ep} step {step}/{steps} loss {run[\'ce\']/run[\'n\']:.3f}'));
  assert.ok(train.includes('"records_seen": round(seen)') && train.includes('"forward_tokens": round(tokens_seen)') && train.includes('"peak_device_bytes": peak_mem') && train.includes('"peak_rss_bytes"') && train.includes('"step_seconds": step_seconds'));
  assert.ok(bench.includes('"rejected_records": 0') && bench.includes('coverage["rejected_records"] += 1'));
  // and parse the lines Kev prints
  const p = J.parseTrainLog(GOOD_LOG());
  assert.deepEqual(p.replay, { used: 50, pool: 3000, fileRecords: 400 }); assert.equal(p.requests, 450); assert.equal(p.losses.length, 2); assert.equal(p.losses[1].loss, 0.704);
  assert.deepEqual(p.end, { state: 'succeeded', exit: 0, signal: null }); assert.equal(p.saved, true);
  const fb = J.parseTrainLog('[transformers] `causal_conv1d_fn` is falling back to its reference PyTorch implementation because `causal_conv1d` is not installed. This is correct but much slower\n[transformers] `chunk_gated_delta_rule` is falling back to its reference PyTorch implementation because `flash-linear-attention` is not installed. This is correct');
  assert.deepEqual(fb.fallback, [{ function: 'causal_conv1d_fn', missing: 'causal_conv1d' }, { function: 'chunk_gated_delta_rule', missing: 'flash-linear-attention' }]);
});

// =============================================================================================================
// unit: the J0 report, the schedule, the budget, J2 reconciliation (acceptance 4, 7)
// =============================================================================================================

// Metrics shaped like Kev's training_metrics.json, with the totals of research/kev-20261007/LAPTOP-THROUGHPUT.md (48 records per
// job: 0.281 / 1.918 / 10.531 s per record, 17,451 / 99,051 / 387,051 forward tokens, 3.21 / 4.05 / 7.14 GB). They are a fixture
// shaped after that measurement, not new evidence: the step times are synthesised from the per-record medians.
const throughputMetrics = (sPerRecord, tokens, gb, { steps = 6, warm = 1.8, rss = 9.1e9 } = {}) => {
  const per = sPerRecord * 8;
  return { wall_seconds: per * (steps - 1 + warm) , records_seen: steps * 8, forward_tokens: tokens, optimizer_steps: steps, step_seconds: [per * warm, ...Array(steps - 1).fill(per)], optimizer_seconds: 1.2, peak_device_bytes: Math.round(gb * 2 ** 30), peak_rss_bytes: rss, device: 'cuda', dtype: 'bf16', rejected_records: 0, truncated_records: 0 };
};
const FREE_M = '               total        used        free      shared  buff/cache   available\nMem:           15321        3877        7421          52        4022       11444\nSwap:              0           0           0\n';
const servedReport = (spr, { rtt = 180, overhead = 210, server = 90, tokens = 400 } = {}) => ({ valid: true, timing: { seconds_per_request: spr, requests_per_second: 1 / spr, server_latency_ms: { median: server }, overhead_ms: { median: overhead }, rtt_ms: { median: rtt }, input_tokens_per_request: { mean: tokens } } });
const j0Obs = ({ scale = 1, c4_300 = 0.12, c4_2k = 0.25, drop = [] } = {}) => {
  const obs = {
    train: { '0300': { metrics: throughputMetrics(0.281 * scale, 17451, 3.21), log: GOOD_LOG() }, '2k': { metrics: throughputMetrics(1.918 * scale, 99051, 4.05), log: GOOD_LOG() }, '8k': { metrics: throughputMetrics(10.531 * scale, 387051, 7.14), log: GOOD_LOG() } },
    j0b: { A: { metrics: throughputMetrics(1.2, 70000, 3.5), log: 'ep0 step 10/50 loss 0.900 kl 0\nep0 step 20/50 loss 0.700 kl 0\nep0 step 30/50 loss 0.600 kl 0' }, B: { metrics: throughputMetrics(0.7, 40000, 3.0), log: 'ep0 step 10/50 loss 0.904 kl 0\nep0 step 20/50 loss 0.703 kl 0\nep0 step 30/50 loss 0.604 kl 0' } },
    kernel: { report: { environment: { packages: { torch: '2.8.0+cu126', 'flash-linear-attention': '0.5.2', 'causal-conv1d': '1.7.0' }, backend: 'torch', gpu: 'NVIDIA GeForce RTX 4060 Laptop GPU', deltanet: { forward: 'fla.layers.GatedDeltaNet.forward' } } } },
    served: { '0300': { c1: servedReport(0.31), c4: servedReport(c4_300) }, '2k': { c1: servedReport(0.9), c4: servedReport(c4_2k) } },
    host: { freeM: FREE_M, info: { disk: { freeBytes: 412e9, totalBytes: 953e9 }, os: { memoryTotalMiB: 15321 } } }
  };
  for (const d of drop) { if (d === 'freeM') obs.host.freeM = null; if (d === 'disk') obs.host.info = {}; if (d === 'kernel') obs.kernel = null; if (d === 'served') obs.served = null; if (d === 'rss') delete obs.train['0300'].metrics.peak_rss_bytes; }
  return obs;
};

test('unit: the J0 report has s/record, s/token, tokens/s, peak_rss_bytes, peak_device_bytes, free -m, free disk and the kernel path', () => {
  const r = J.analyzeJ0(j0Obs());
  assert.equal(r.complete, true, JSON.stringify(r.missing));
  for (const klass of ['0300', '2k', '8k']) {
    const j = r.jobs[klass];
    for (const k of ['seconds_per_record', 'seconds_per_token', 'tokens_per_second', 'peak_rss_bytes', 'peak_device_bytes']) assert.ok(Number.isFinite(j[k]) && j[k] > 0, `${klass} ${k}`);
    assert.ok(Math.abs(j.seconds_per_record - { '0300': 0.281, '2k': 1.918, '8k': 10.531 }[klass]) < 1e-3, `${klass}: steady s/record is the per-step median (the warm-up step is dropped)`);
    assert.ok(j.warmup_seconds > 0);
    assert.equal(r.host.memory[klass].under_80_percent_of_free_ram, true); assert.equal(r.host.memory[klass].no_oom_kill, true);
  }
  assert.ok(Math.abs(r.jobs['0300'].tokens_per_second - 17451 / 48 / 0.281) < 15, `tokens/s ${r.jobs['0300'].tokens_per_second}`);
  assert.equal(r.host.free_m.available, 11444); assert.equal(r.host.free_m.total, 15321); assert.match(r.host.free_m.raw, /Mem:/);
  assert.equal(r.host.free_disk.freeBytes, 412e9);
  assert.equal(r.kernel_path.fast, true); assert.equal(r.kernel_path.flash_linear_attention, '0.5.2'); assert.equal(r.kernel_path.causal_conv1d, '1.7.0'); assert.match(r.kernel_path.source, /kev\.benchmark/);
  // the throughput is superlinear in the tokens of a record (8K costs 1,300 tokens/s less than 300), so the two-parameter fit is refused and the schedule interpolates
  assert.equal(r.fit.ok, false); assert.ok(r.fit.maxRelativeResidual > 0.1); assert.equal(r.fit.model, 'interpolated');
  assert.ok(r.reference.tokens_per_second > 1000 && r.reference.tokens_per_second < 1300, `${r.reference.tokens_per_second} tokens/s at the 5K mix`);
  assert.equal(r.served.bridge_batch_request_recommended, false); assert.equal(r.served.tunnel_rtt_ms, 180);
  assert.ok(r.schedule && r.schedule_table.includes('measured')); assert.equal(r.schedule.plan, 'reduced');
  assert.equal(r.schedule.provisional, false);
});

test('unit: the J0 report names what is missing and does not fill it in', () => {
  const missing = d => J.analyzeJ0(j0Obs({ drop: [d] }));
  let r = missing('freeM'); assert.equal(r.complete, false); assert.ok(r.missing.some(m => /free -m/.test(m))); assert.equal(r.host.free_m, null); assert.equal(r.host.memory['0300'].under_80_percent_of_free_ram, null);
  r = missing('disk'); assert.ok(r.missing.some(m => /free disk/.test(m))); assert.equal(r.host.free_disk, null);
  r = missing('kernel'); assert.ok(r.missing.some(m => /kernel path/.test(m))); assert.equal(r.kernel_path.fast, null);
  r = missing('rss'); assert.ok(r.missing.some(m => /peak_rss_bytes/.test(m)));
  r = missing('served'); assert.equal(r.complete, true, 'the served numbers are J0c, not a J0a figure'); assert.equal(r.schedule.provisional, true, 'but the schedule is provisional without them'); assert.equal(r.schedule.seconds_per_request, 0.2);
  // a kernel path from the train.log alone
  const obs = j0Obs({ drop: ['kernel'] }); obs.train['0300'].log += '\n[transformers] `chunk_gated_delta_rule` is falling back to its reference PyTorch implementation because `flash-linear-attention` is not installed. This is correct but much slower';
  const kp = J.analyzeJ0(obs).kernel_path; assert.equal(kp.fast, false); assert.match(kp.source, /train\.log/);
  // an out-of-memory kill or a RAM peak over 80% of available is reported against the job
  const big = j0Obs(); big.train['8k'].metrics.peak_rss_bytes = 0.9 * 11444 * 2 ** 20;
  assert.equal(J.analyzeJ0(big).host.memory['8k'].under_80_percent_of_free_ram, false);
  const oom = j0Obs(); oom.train['2k'].log += '\nKilled';
  assert.equal(J.analyzeJ0(oom).host.memory['2k'].no_oom_kill, false);
  // 0.3 s per request at concurrency 4 asks for the optional bridge batch job
  assert.equal(J.analyzeJ0(j0Obs({ c4_2k: 0.34 })).served.bridge_batch_request_recommended, true);
  // the files the runner leaves are read back into the same observations
  const dir = H.tempDir('served-j0dir-'), o = j0Obs();
  for (const [k, v] of Object.entries(o.train)) { mkdirSync(path.join(dir, 'results', `J0a-${k}`), { recursive: true }); writeFileSync(path.join(dir, 'results', `J0a-${k}`, 'training_metrics.json'), JSON.stringify(v.metrics)); writeFileSync(path.join(dir, 'results', `J0a-${k}`, 'train.log'), v.log); }
  mkdirSync(path.join(dir, 'results', 'J0k-kernels'), { recursive: true }); writeFileSync(path.join(dir, 'results', 'J0k-kernels', 'report.json'), JSON.stringify(o.kernel.report));
  mkdirSync(path.join(dir, 'results', 'rows'), { recursive: true }); mkdirSync(path.join(dir, 'observations'), { recursive: true });
  for (const [k, by] of Object.entries(o.served)) for (const [c, rep] of Object.entries(by)) writeFileSync(path.join(dir, 'results', 'rows', `J0c-${k}-${c}.report.json`), JSON.stringify(rep));
  writeFileSync(path.join(dir, 'observations', 'free-m.txt'), FREE_M); writeFileSync(path.join(dir, 'observations', 'info.json'), JSON.stringify(o.host.info));
  const back = J.analyzeJ0(J.loadJ0Observations(dir));
  assert.equal(back.complete, true, JSON.stringify(back.missing)); assert.deepEqual(back.jobs, J.analyzeJ0(o).jobs);
});

test('unit: J0b adopts shared_prefix only if >= 1.5x faster and the 50-step losses match within 1%', () => {
  const v = J.analyzeJ0(j0Obs()).j0b;
  assert.equal(v.adopt, true); assert.ok(v.speedup >= 1.5); assert.ok(v.max_relative_loss_difference <= 0.01);
  const slow = j0Obs(); slow.j0b.B = { metrics: throughputMetrics(1.0, 60000, 3.0), log: slow.j0b.B.log };
  assert.equal(J.analyzeJ0(slow).j0b.adopt, false); assert.match(J.analyzeJ0(slow).j0b.reason, /only 1\.2x faster/);
  const drift = j0Obs(); drift.j0b.B.log = drift.j0b.B.log.replace('loss 0.703', 'loss 0.730');
  assert.equal(J.analyzeJ0(drift).j0b.adopt, false); assert.match(J.analyzeJ0(drift).j0b.reason, /losses differ/);
  const none = j0Obs(); none.j0b = {};
  assert.equal(J.analyzeJ0(none).j0b.adopt, null, 'cut under the plan\'s cut line: not run, not failed');
});

test('unit: the schedule is regenerated from the J0 numbers: the program\'s table at its rates, the reduced plan below 1,500 tokens/s', () => {
  const at1500 = J.buildSchedule({ rate: 1500 });
  assert.equal(at1500.plan, 'full');
  const hours = Object.fromEntries(at1500.points.map(p => [p.point, p.hours]));
  assert.ok(Math.abs(hours['5K'] - 5.0e6 / 1500 / 3600) < 1e-3 && Math.abs(hours['20K'] - 17e6 / 1500 / 3600) < 1e-3, JSON.stringify(hours));
  // the three program columns (§7.4): 5K = 2.6 h / 56 min / 17 min; 20K = 9.0 h / 3.1 h / 57 min
  const p5 = at1500.points.find(p => p.point === '5K').at_program_rates, p20 = at1500.points.find(p => p.point === '20K').at_program_rates;
  assert.deepEqual([Math.round(p5[525] * 10) / 10, Math.round(p5[1500] * 60), Math.round(p5[4953] * 60)], [2.6, 56, 17]);
  assert.deepEqual([Math.round(p20[525] * 10) / 10, Math.round(p20[1500] * 10) / 10, Math.round(p20[4953] * 60)], [9, 3.1, 57]);
  // full plan: about 99.5M training tokens (priority items 2-4), 12 point reads with J1, reduced: about 35M tokens
  assert.ok(Math.abs(at1500.training_tokens_p2_p4 - 99.5e6) / 99.5e6 < 0.01, `${at1500.training_tokens_p2_p4}`);
  assert.equal(at1500.items.reduce((n, i) => n + (['P1', 'P2', 'P3', 'P4'].includes(i.id) ? i.reads : 0), 0), 12);
  assert.ok(at1500.scheduled_hours > 26 && at1500.scheduled_hours < 40, `${at1500.scheduled_hours} h`);
  const reduced = J.buildSchedule({ rate: 1499 });
  assert.equal(reduced.plan, 'reduced'); assert.equal(reduced.switched, true);
  assert.equal(reduced.training_tokens_p2_p4, 35e6); assert.deepEqual(reduced.items.map(i => i.id), ['P1', 'P2', 'P3', 'P4', 'P6']);
  assert.equal(reduced.items.reduce((n, i) => n + (['P1', 'P2', 'P3', 'P4'].includes(i.id) ? i.reads : 0), 0), 6, 'J1 + 2.5K, 5K, 20K + seed 2 at 5K + lr4 (the program counts 7)');
  assert.ok(Math.abs(J.buildSchedule({ rate: 525, forcePlan: 'full' }).items.find(i => i.id === 'P2').trainHours - 34e6 / 525 / 3600) < 1e-2);
  assert.equal(J.buildSchedule({ rate: 525 }).plan, 'reduced', '525 tokens/s is below the floor: the reduced plan, about 35M tokens, 18.5 h');
  assert.ok(Math.abs(J.buildSchedule({ rate: 525 }).items.slice(1, 4).reduce((a, i) => a + i.trainHours, 0) - 35e6 / 525 / 3600) < 0.1);
  assert.equal(J.buildSchedule({ rate: 5000, forcePlan: 'reduced' }).plan, 'reduced');
  // regenerated from J0: a laptop twice as slow takes twice the hours, and the plan switches
  const fast = J.analyzeJ0(j0Obs({ scale: 0.5 })), slow = J.analyzeJ0(j0Obs());
  assert.equal(fast.schedule.plan, 'full'); assert.equal(slow.schedule.plan, 'reduced');
  const h = r => r.schedule.points.find(p => p.point === '20K').hours;
  assert.ok(Math.abs(h(slow) / h(fast) - 2) < 0.05, `${h(slow)} vs ${h(fast)}`);
  assert.notEqual(fast.schedule_table, slow.schedule_table); assert.match(fast.schedule_table, /Plan: \*\*full\*\*/); assert.match(slow.schedule_table, /Plan: \*\*reduced\*\*/);
  assert.match(slow.schedule_table, /\| 20K \| 17\.0M \| 9 h \| 3\.1 h \| 57 min \|/, 'the program\'s three columns are in the regenerated table');
});

test('unit: the budget: J5 is reserved first, items are cut from the bottom in priority order, completed hours replace estimates', () => {
  const tight = J.buildSchedule({ rate: 1500, budgetHours: 20 });
  const status = Object.fromEntries(tight.items.map(i => [i.id, i.status]));
  assert.deepEqual(status, { P1: 'scheduled', P2: 'scheduled', P3: 'cut', P4: 'cut', P5: 'cut', P6: 'reserved' });
  assert.equal(tight.cut_from, 'P3'); assert.ok(tight.scheduled_hours <= 20);
  assert.ok(tight.items.find(i => i.id === 'P5').hours < tight.available_hours - tight.items.filter(i => i.status === 'scheduled').reduce((a, i) => a + i.hours, 0), 'the small item 5 would fit, but strict priority keeps it cut');
  const none = J.buildSchedule({ rate: 1500, budgetHours: 3 });
  assert.equal(none.items.find(i => i.id === 'P6').status, 'reserved', 'J5 always runs'); assert.equal(none.items.find(i => i.id === 'P2').status, 'cut');
  assert.ok(J.buildSchedule({ rate: 1500, triggered40K: true }).items.find(i => i.id === 'P5').tokens > 33e6, '40K joins item 5 when triggered');
  // the tracker: actual hours replace estimates, and a re-measured rate can switch the plan (logged)
  const log = path.join(H.tempDir('served-budget-'), 'budget.jsonl');
  const tracker = new J.BudgetTracker({ file: log, rate: 1600 });
  const before = tracker.schedule(); assert.equal(before.plan, 'full');
  tracker.record('J0', 0.9); tracker.record('J2-2500-s1', 0.4); tracker.record('read:J2-2500-s1', 0.2); tracker.record(null, 9); tracker.record('x', NaN);
  const after = tracker.schedule();
  assert.ok(Math.abs(after.spent_hours - 1.5) < 1e-9); assert.ok(after.items.find(i => i.id === 'P2').hours < before.items.find(i => i.id === 'P2').hours);
  assert.equal(tracker.update({ rate: 1100 }), 'reduced');
  const events = readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(events.map(e => e.type), ['complete', 'complete', 'complete', 'model', 'switch']); assert.deepEqual([events.at(-1).from, events.at(-1).to], ['full', 'reduced']);
  assert.equal(new J.BudgetTracker({ file: log, rate: 1600 }).usedHours.toFixed(3), '1.500', 'the tracker reloads what it logged');
});

test('unit: J2 reconciliation: within 20% of the J0 prediction, or the schedule is recomputed and the deviation logged', () => {
  const model = J.costModel({ rate: 1600 }), predicted = model.seconds({ rows: 5000, replay: 2000 });
  const logFile = path.join(H.tempDir('served-j2-'), 'deviations.jsonl');
  const within = J.reconcileJ2({ model, measured: { wallSeconds: predicted * 1.19, forwardTokens: 5.2e6 }, logFile });
  assert.equal(within.within, true); assert.equal(within.action, 'keep'); assert.equal(within.schedule, undefined, 'inside 20% the schedule stands');
  const edge = J.reconcileJ2({ model, measured: { wallSeconds: predicted * 1.21 }, logFile });
  assert.equal(edge.within, false); assert.equal(edge.action, 'recompute');
  const under = J.reconcileJ2({ model, measured: { wallSeconds: predicted * 0.79 }, logFile });
  assert.equal(under.within, false, 'faster than predicted by more than 20% also recomputes');
  const slow = J.reconcileJ2({ model, measured: { wallSeconds: predicted * 1.5, forwardTokens: 5.0e6 }, logFile });
  assert.equal(slow.action, 'recompute'); assert.equal(slow.previous.plan, 'full'); assert.equal(slow.schedule.plan, 'reduced', '1,600 tokens/s measured as 1,067 switches the plan');
  assert.ok(Math.abs(slow.schedule.rate.tokens_per_second - 1600 / 1.5) < 1);
  assert.ok(slow.schedule.scheduled_hours !== slow.previous.scheduled_hours);
  const lines = readFileSync(logFile, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(lines.length, 4, 'every comparison is logged'); assert.deepEqual(lines.map(l => l.action), ['keep', 'recompute', 'recompute', 'recompute']);
  assert.equal(lines[3].plan_before, 'full'); assert.equal(lines[3].plan_after, 'reduced'); assert.ok(Math.abs(lines[3].deviation - 0.5) < 1e-3); assert.equal(lines[3].token_model_error, 0);
  assert.equal(lines[0].measured_tokens_per_second, Math.round(5.2e6 / (predicted * 1.19) * 10) / 10);
});

// =============================================================================================================
// unit: the runner against a stand-in daemon (acceptance 3: never a second kev.serve, never a train behind a service)
// =============================================================================================================

const GPU = new Set(['kev.train', 'kev.benchmark']);
class FakeBridge {
  endpoint = 'https://fake-laptop.invalid';
  constructor({ liveService = null, dropLine = false, poolSize = 3000, rejectContext = false, benchmarkRejected = 0 } = {}) {
    Object.assign(this, { dropLine, poolSize, rejectContext, benchmarkRejected });
    this.files = new Map(); this.jobsById = new Map(); this.submitted = []; this.violations = []; this.uploads = []; this.cancelled = []; this.maxLive = 0; this.n = 0;
    this.bridgeFetch = this.bridgeFetch.bind(this);
    if (liveService) this.#add({ kind: 'kev.serve', class: 'service', state: 'running', params: { run: liveService, port: 8008 } });
  }
  #id() { return `j-20261008-${String(120000 + this.n++).slice(0, 6)}-${createHash('sha1').update(String(this.n)).digest('hex').slice(0, 6)}`; }
  #add(job) { const j = { id: this.#id(), createdAt: '2026-10-08T12:00:00.000Z', startedAt: '2026-10-08T12:00:00.000Z', endedAt: null, outputDir: null, outputs: null, error: null, ...job }; this.jobsById.set(j.id, j); this.maxLive = Math.max(this.maxLive, this.#live().length); return j; }
  #live() { return [...this.jobsById.values()].filter(j => j.class === 'service' && !['stopped', 'failed', 'cancelled'].includes(j.state)); }
  async info() { return { version: 'fake', disk: { freeBytes: 412e9, totalBytes: 953e9 }, os: { memoryTotalMiB: 15321 }, gpu: { available: true } }; }
  async upload(local, rel, { overwrite = false } = {}) {
    const body = readFileSync(local);
    if (this.files.has(rel) && !overwrite) throw Object.assign(new Error('exists'), { status: 409 });
    this.files.set(rel, { sha: sha(body), records: body.toString('utf8').split('\n').filter(Boolean).length }); this.uploads.push(rel);
    return { path: rel, size: body.length, sha256: sha(body) };
  }
  async jobs() { return [...this.jobsById.values()].map(j => ({ id: j.id, kind: j.kind, class: j.class, state: j.state })); }
  async job(id) { return this.jobsById.get(id); }
  async submitJob(kind, params) {
    this.submitted.push({ kind, params });
    const live = this.#live();
    if (kind === 'kev.serve' && live.length) { this.violations.push(`a second kev.serve (${live[0].id} is live)`); throw Object.assign(new Error('service_exists'), { status: 409, error: 'service_exists' }); }
    if (GPU.has(kind) && live.length) this.violations.push(`${kind} queued while ${live[0].kind} ${live[0].id} runs`);
    const dataFile = params.dataset ?? params.data;
    if (dataFile && !this.files.has(dataFile)) throw Object.assign(new Error(`${dataFile} was not uploaded`), { status: 400 });
    for (const ref of [params.run, params.initFrom]) if (ref?.startsWith('runs/') && !this.jobsById.get(ref.slice(5))) throw Object.assign(new Error(`${ref} is not a finished kev.train`), { status: 400 });
    if (kind === 'kev.serve') return this.#add({ kind, class: 'service', state: 'running', params });
    const j = this.#add({ kind, class: 'gpu', state: 'succeeded', params, endedAt: '2026-10-08T12:30:00.000Z' });
    j.outputDir = `runs/${j.id}`;
    j.outputs = { dir: j.outputDir, files: ['head.pt', 'training_metrics.json', 'training_config.json', 'report.json', 'rows.json'].map(f => ({ path: `${j.outputDir}/${f}` })) };
    return j;
  }
  #log(j) {
    if (j.kind !== 'kev.train') return `fake ${j.kind} log\n[bridge 2026-10-08T12:00:00.000Z] end succeeded exit=0\n`;
    const n = this.files.get(j.params.dataset).records, replay = Math.min(j.params.extra?.replay ?? 0, this.poolSize);   // Kev: sample(pool, min(a.replay, len(pool)))
    return [replay ? `replay: ${replay} of ${this.poolSize} suite training records mixed with ${n} from /w/${j.params.dataset}` : null, this.dropLine ? `dropped 2 of ${n + replay} records that exceed the training context (384 state / 1024 branch / 2048 packed tokens)` : null,
      `${n + replay} training requests (holdout=), questions by type {'choice': ${n + replay}}`, 'ep0 step 10/50 loss 0.9 kl 0.000', `saved /w/${j.outputDir}`, '[bridge 2026-10-08T12:30:00.000Z] end succeeded exit=0', ''].filter(x => x !== null).join('\n');
  }
  async waitJob(id, { onLog, until = 'auto' } = {}) {
    const j = this.jobsById.get(id);
    if (!j) throw new Error(`no job ${id}`);
    if (j.class === 'service' && until === 'terminal' && j.state === 'running') throw new Error('a running service never ends by itself');
    if (j.class !== 'service') onLog?.(this.#log(j));
    return j;
  }
  async cancel(id) { const j = this.jobsById.get(id); this.cancelled.push(id); if (j.class === 'service') { j.state = 'stopped'; j.endedAt = '2026-10-08T12:45:00.000Z'; } return j; }
  async download(rel, dest) {
    const [, id, name] = /^runs\/([^/]+)\/(.+)$/.exec(rel), j = this.jobsById.get(id);
    mkdirSync(path.dirname(dest), { recursive: true });
    const n = this.files.get(j.params.dataset ?? j.params.data)?.records ?? 0, replay = j.params.extra?.replay ?? 0;
    const body = { 'training_config.json': { args: { init_from: j.params.initFrom?.startsWith('runs/') ? `/w/${j.params.initFrom}` : j.params.initFrom, max_state: j.params.maxState, epochs: j.params.epochs, replay }, base_revision: TOKENIZER.revision, suite_sha256: 'e'.repeat(64) },
      'training_metrics.json': { wall_seconds: 100, records_seen: n + replay, forward_tokens: 100000, optimizer_steps: 5, rejected_records: 0, truncated_records: 0, step_seconds: [3, 2, 2, 2, 2], peak_device_bytes: 3e9, peak_rss_bytes: 8e9 },
      'report.json': { coverage: { requested_records: n, evaluated_records: n - this.benchmarkRejected, rejected_records: this.benchmarkRejected, truncated_records: 0 } }, 'rows.json': [] }[name];
    if (!body) throw Object.assign(new Error(`no ${name}`), { status: 404 });
    writeFileSync(dest, JSON.stringify(body));
    return { path: rel, dest };
  }
  async bridgeFetch(url, init = {}) {
    const u = new URL(url), j = this.#live()[0], json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/svc/kev/v1/models') {
      if (!j) return json(502, { error: 'service_not_running' });
      const run = j.params.run.startsWith('runs/') ? `/w/${j.params.run}` : j.params.run;
      return json(200, { models: ['kev-latest', 'jev-latest'].map(name => ({ name, run, base: 'Qwen/Qwen3.5-0.8B-Base', lora: 16, device: 'cuda', backend: 'torch', dtype: 'torch.bfloat16', temperature: 2.35, max_state_tokens: 65536, truncate_states: false })) });
    }
    if (u.pathname === '/svc/kev/v1/systemone' && init.method === 'POST') {
      if (!j) return json(502, { error: 'service_not_running' });
      const body = JSON.parse(init.body);
      if (this.rejectContext && String(body.state?.log ?? '').split('\n').length > 25) return json(422, { detail: 'state is 70,000 tokens, over the 65,536-token limit' });
      return json(200, defaultAnswer(body.questions));
    }
    return json(404, { error: 'not found' });
  }
}

// a small runnable plan: every kind of stage, tiny files (the structure is the point, not the size)
function tinyPlan(dir, { reads = true } = {}) {
  const mk = (name, records, o = {}) => { const file = path.join(dir, name); writeFileSync(file, jsonl(records)); return { name, file, sha256: sha(readFileSync(file)), bytes: readFileSync(file).length, records: records.length, ...o }; };
  const recs = (prefix, n, lines) => Array.from({ length: n }, (_, i) => logRecord(prefix, i, lines, { questions: 1 }));
  const data = { '0300': mk('j0-0300.jsonl', recs('p/a', 6, 3)), '2k': mk('j0-2k.jsonl', recs('p/b', 6, 6)), '8k': mk('j0-8k.jsonl', recs('p/c', 4, 8)), '0300-q4': mk('j0-0300-q4.jsonl', Array.from({ length: 6 }, (_, i) => logRecord('p/d', i, 3, { questions: 4 }))), kernel: mk('j0-kernel.jsonl', recs('p/e', 4, 2)) };
  const readFiles = [mk('read-short.jsonl', recs('p/r1', 5, 3)), mk('read-long.jsonl', recs('p/r2', 5, 30))];
  const readList = [{ id: 'short', file: readFiles[0].file, sha256: readFiles[0].sha256, route: { route: 'benchmark', reason: 'every record fits the training context' } }, { id: 'long', file: readFiles[1].file, sha256: readFiles[1].sha256, route: { route: 'served', reason: 'a state is over 384 tokens' } }];
  const trainFile = mk('train-5000.jsonl', recs('p/t', 8, 3), { rows: 8 });
  const stages = [...J.j0Stages({ data }), ...(reads ? J.j1Stages({ reads: readList }) : []), J.j2Stage({ point: '5K', train: { file: trainFile.file, sha256: trainFile.sha256, records: trainFile.records, rows: 8, bytes: trainFile.bytes }, maxState: 1024 })];
  if (reads) stages.push(...J.j3Stages({ of: 'J2-5000-s1', reads: readList }), ...J.j5Stages({ reads: readList, candidate: 'runs/{{J2-5000-s1}}' }));
  return { plan: J.assemblePlan(stages, { id: 'tiny' }), data, readList };
}

test('unit: the runner submits a whole plan with no second service and nothing queued behind one', async () => {
  const dir = H.tempDir('served-runner-'), { plan } = tinyPlan(dir), bridge = new FakeBridge();
  mkdirSync(path.join(dir, 'observations'), { recursive: true }); writeFileSync(path.join(dir, 'observations', 'free-m.txt'), FREE_M);
  await assert.rejects(J.runPlan(plan, { client: bridge, dir }), e => e.code === 'RUN_NOT_CONFIRMED', 'writing or loading a plan never submits it');
  assert.equal(bridge.submitted.length, 0);
  const tracker = new J.BudgetTracker({ rate: 1300 });
  const { state } = await J.runPlan(plan, { client: bridge, dir, confirm: true, tracker });
  assert.deepEqual(bridge.violations, [], 'the daemon-side admission saw nothing to object to');
  assert.equal(bridge.maxLive, 1, 'never more than one service');
  const serves = bridge.submitted.filter(s => s.kind === 'kev.serve'), serveStages = plan.stages.filter(s => s.kind === 'kev.serve');
  assert.equal(serves.length, serveStages.length); assert.equal(serves.length, 5, 'J0c, J1, J3, J5 stock, J5 candidate');
  assert.equal(bridge.cancelled.length, serves.length, 'every service is stopped');
  assert.ok(Object.values(state.stages).every(s => s.status === 'done'), JSON.stringify(Object.entries(state.stages).filter(([, s]) => s.status !== 'done')));
  // the candidate service serves the J2 run, and J3/J5 reference the job id the daemon gave J2
  const j2 = state.stages['J2-5000-s1'].jobId;
  assert.deepEqual(serves.map(s => s.params.run).filter(r => r.startsWith('runs/')), [`runs/${j2}`, `runs/${j2}`]);
  // the dataset reaches the daemon once per content, and the sha it stored is the plan's
  assert.equal(new Set(bridge.uploads).size, bridge.uploads.length, 'no file is uploaded twice');
  assert.ok(bridge.uploads.every(u => /^data\/[A-Za-z0-9._-]+\.jsonl$/.test(u)));
  // outputs the J0 report reads are on disk
  for (const k of ['0300', '2k', '8k']) for (const f of ['training_metrics.json', 'training_config.json', 'train.log']) assert.ok(existsSync(path.join(dir, 'results', `J0a-${k}`, f)), `${k} ${f}`);
  assert.ok(existsSync(path.join(dir, 'results', 'rows', 'J0c-0300-c4.jsonl')) && existsSync(path.join(dir, 'results', 'rows', 'J0c-0300-c4.report.json')));
  assert.ok(existsSync(path.join(dir, 'observations', 'info.json')));
  assert.ok(tracker.usedHours > 0, 'the tracker was fed the hours of finished stages');
  // a second run of the same plan submits nothing: every stage is done
  const before = bridge.submitted.length;
  await J.runPlan(plan, { client: bridge, dir, confirm: true });
  assert.equal(bridge.submitted.length, before);
});

test('unit: the runner refuses to queue behind a service or request a second one, and submits nothing', async () => {
  for (const liveService of ['jaredpalmer/kev-0.8b@v1.0', 'runs/j-20261008-000000-aaaaaa']) {
    const dir = H.tempDir('served-runner-live-'), { plan } = tinyPlan(dir, { reads: false }), bridge = new FakeBridge({ liveService });
    mkdirSync(path.join(dir, 'observations'), { recursive: true }); writeFileSync(path.join(dir, 'observations', 'free-m.txt'), FREE_M);
    await assert.rejects(J.runPlan(plan, { client: bridge, dir, confirm: true }), e => e.code === 'RUN_SERVICE_LIVE', 'the first GPU job is not queued behind the live service');
    assert.equal(bridge.submitted.length, 0);
    const onlyServe = J.assemblePlan([{ id: 's', kind: 'kev.serve', params: { run: 'jaredpalmer/kev-0.8b@v1.0', port: 8008 } }, { id: 'x', kind: 'serve.stop', serve: 's' }]);
    await assert.rejects(J.runPlan(onlyServe, { client: bridge, dir: H.tempDir('served-runner-live2-'), confirm: true }), e => e.code === 'RUN_SERVICE_EXISTS', 'a second kev.serve is not requested');
    assert.equal(bridge.submitted.length, 0);
  }
});

test('unit: the runner stops at a job that fails acceptance, an invalid served read, or a fact only the laptop agent can give', async () => {
  let dir = H.tempDir('served-runner-acc-'), { plan } = tinyPlan(dir, { reads: false });
  mkdirSync(path.join(dir, 'observations'), { recursive: true });
  await assert.rejects(J.runPlan(plan, { client: new FakeBridge(), dir, confirm: true }), e => e.code === 'RUN_NEEDS_INPUT' && /free -m/.test(e.message), '`free -m` is asked for, not invented');
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')).stages['J0-observe-host'].status, 'needs-input');
  writeFileSync(path.join(dir, 'observations', 'free-m.txt'), FREE_M);
  await assert.rejects(J.runPlan(plan, { client: new FakeBridge({ dropLine: true }), dir, confirm: true }), e => e.code === 'RUN_ACCEPTANCE' && /"dropped" line/.test(e.message));
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')).stages['J0a-0300'].status, 'rejected');
  // replay the suite cannot supply (a smaller pool)
  dir = H.tempDir('served-runner-acc2-'); ({ plan } = tinyPlan(dir, { reads: false })); mkdirSync(path.join(dir, 'observations'), { recursive: true }); writeFileSync(path.join(dir, 'observations', 'free-m.txt'), FREE_M);
  await assert.rejects(J.runPlan(plan, { client: new FakeBridge({ poolSize: 30 }), dir, confirm: true }), e => e.code === 'RUN_ACCEPTANCE' && /the suite supplied|training requests/.test(e.message));
  // a benchmark that rejected records is invalid
  dir = H.tempDir('served-runner-acc3-'); ({ plan } = tinyPlan(dir, { reads: false })); mkdirSync(path.join(dir, 'observations'), { recursive: true }); writeFileSync(path.join(dir, 'observations', 'free-m.txt'), FREE_M);
  await assert.rejects(J.runPlan(plan, { client: new FakeBridge({ benchmarkRejected: 1 }), dir, confirm: true }), e => e.code === 'RUN_ACCEPTANCE' && /rejected_records is 1/.test(e.message));
  // a served read with a rejected record is invalid
  dir = H.tempDir('served-runner-acc4-'); ({ plan } = tinyPlan(dir)); mkdirSync(path.join(dir, 'observations'), { recursive: true }); writeFileSync(path.join(dir, 'observations', 'free-m.txt'), FREE_M);
  const bridge = new FakeBridge({ rejectContext: true });
  await assert.rejects(J.runPlan(plan, { client: bridge, dir, confirm: true }), e => e.code === 'RUN_SCORE_INVALID', JSON.stringify(plan.stages.filter(s => s.kind === 'score').map(s => s.id)));
  assert.deepEqual(bridge.violations, []);
});

// =============================================================================================================
// kev: tests that run Kev's code (pinned tokenizer, loaders, argparse, the FastAPI app) in /opt/kev-venv under `python -I`
// =============================================================================================================

test('kev: J0 records land on their real-token targets, fit the job maxState, and the scan agrees with the labels', { timeout: 10 * 60_000 }, () => {
  const targets = [300, 300, 2000, 2000, 8000, 8000];
  const { records, stateTokens, results } = J.buildProbeRecords({ prefix: 'j0/test', targets, questions: 4 });
  stateTokens.forEach((n, i) => assert.ok(Math.abs(n - targets[i]) <= 0.02 * targets[i], `record ${i}: ${n} tokens for a target of ${targets[i]}`));
  assert.ok(results.every(r => r.fits === true || r.fits === false) && results.every(r => r.packedTokens > r.stateTokens));
  const at8192 = measureRecords(records, { maxState: 8192 });
  assert.ok(at8192.every(r => r.fits), 'every J0 record fits maxState 8192 (state, branch and packed limits)');
  assert.ok(at8192[5].stateTokens > 7800 && at8192[5].stateTokens < 8192, `the 8K record has ${at8192[5].stateTokens} state tokens`);
  records.forEach(rec => { const t = J.scanLog(rec.state.log.split('\n')); assert.equal(rec.questions.first_error.label, t.firstErrorService); assert.equal(rec.questions.last_level.label, t.lastLevel); });
  const dir = H.tempDir('served-j0data-');
  const m = J.buildJ0Data({ dir, only: ['kernel'] });
  assert.equal(m.kernel.records, 16); assert.ok(m.kernel.stateTokens.max < 384 * 1.0 && m.kernel.stateTokens.min > 150, JSON.stringify(m.kernel.stateTokens));
  assert.equal(m.kernel.sha256, sha(readFileSync(m.kernel.file)));
  const again = J.buildJ0Data({ dir: H.tempDir('served-j0data2-'), only: ['kernel'] });
  assert.equal(again.kernel.sha256, m.kernel.sha256, 'the files are deterministic');
  assert.equal(J.routeFile(m.kernel.file).route, 'benchmark', 'the kernel probe is a file kev.benchmark can read');
});

// every J-spec: J0 (incl. the cut line), J1, J2 at every point and seed, J3, J4, J5
function allStages(dir) {
  const mk = (name, n, lines, o = {}) => { const file = path.join(dir, name); writeFileSync(file, jsonl(Array.from({ length: n }, (_, i) => logRecord(name, i, lines, o)))); return { file, sha256: sha(readFileSync(file)), bytes: readFileSync(file).length, records: n }; };
  const short = mk('read-short.jsonl', 4, 3), long = mk('read-long.jsonl', 4, 20), tr = mk('train.jsonl', 8, 3);
  const reads = [{ id: 'short', ...short, route: { route: 'benchmark', reason: 'fits' } }, { id: 'long', ...long, route: { route: 'served', reason: 'long' } }];
  const stages = [...J.j0Stages(), ...J.j1Stages({ reads })];
  for (const [point, seed] of [['2.5K', 1], ['5K', 1], ['10K', 1], ['20K', 1], ['5K', 2], ['20K', 2], ['40K', 1]]) {
    const id = `J2-${J.POINT_ROWS[point]}-s${seed}`;
    stages.push(J.j2Stage({ point, seed, train: { ...tr, rows: J.POINT_ROWS[point] }, maxState: 1536, longStates: point === '20K' }));
    if (point !== '40K') stages.push(...J.j3Stages({ of: id, reads }));
  }
  for (const g of Object.keys(J.GRID)) { const s = J.j4Stage({ config: g, train: { ...tr, rows: 5000 }, maxState: 1536 }); stages.push(s, ...J.j3Stages({ of: s.id, reads })); }
  stages.push(...J.j5Stages({ reads, candidate: 'runs/{{J2-5000-s1}}' }));
  return stages;
}

test('kev: every J-spec passes the bridge\'s validateParams and buildCommand and the real kev.train / kev.benchmark / kev.serve argparse at Kev 5e42a7a0', { timeout: 10 * 60_000 }, async () => {
  const stages = allStages(H.tempDir('served-specs-'));
  J.assemblePlan(stages);                                               // the sequence check, too
  const bridgeJobs = stages.filter(s => ['kev.train', 'kev.benchmark', 'kev.serve'].includes(s.kind));
  assert.equal(bridgeJobs.length, 44, 'J0 7 + J1 2 + J2 7 + J3 12 + J4 4 + J3 of the grid 8 + J5 4 bridge jobs');
  const r = await J.validateStages(stages);
  assert.deepEqual(r.stages.flatMap(s => s.errors.map(e => `${s.id}: ${e}`)), []);
  assert.equal(r.ok, true); assert.equal(r.stages.length, bridgeJobs.length);
  assert.ok(r.stages.every(s => s.validated && s.parsed), 'every stage was validated by the bridge and parsed by Kev');
  assert.equal(r.kev.commit, '5e42a7a03f28134853dd3ff77461457e921e5ec1');
  const by = Object.fromEntries(r.stages.map(s => [s.id, s]));
  // what Kev's own parser read back is what the recipe says
  const j2 = by['J2-5000-s1'].parsed;
  assert.equal(j2.init_from, 'jaredpalmer/kev-0.8b@v1.0'); assert.equal(j2.base, 'Qwen/Qwen3.5-0.8B-Base'); assert.equal(j2.base_revision, TOKENIZER.revision);
  assert.equal(j2.max_state, 1536); assert.equal(j2.replay, 2000); assert.equal(j2.p_none_pair, 0.25); assert.equal(j2.lr, 2e-5); assert.equal(j2.epochs, 1); assert.equal(j2.seed, 1);
  assert.equal(j2.dtype, 'bf16'); assert.equal(j2.checkpointing, 1); assert.equal(j2.lora, 16); assert.equal(j2.lora_targets, 'all'); assert.equal(j2.max_steps, 0, 'a curve point has no max_steps');
  assert.equal(j2.suite, path.join(KEV.root, 'evals/v7/decision-v7')); assert.equal(j2.device, 'cuda');
  assert.equal(by['J2-20000-s1'].parsed.row_budget, 16384); assert.equal(by['J2-20000-s1'].parsed.length_sort, 1);
  assert.equal(by['J0a-8k'].parsed.weights_dtype, 'bf16'); assert.equal(by['J0a-8k'].parsed.max_steps, 10); assert.equal(by['J0b-B'].parsed.shared_prefix, 1);
  assert.equal(by['J4-lr4'].parsed.lr, 4e-5); assert.equal(by['J4-ep2'].parsed.epochs, 2); assert.equal(by['J4-rp6'].parsed.replay, 6000); assert.equal(by['J4-np0'].parsed.p_none_pair, 0);
  const serves = r.stages.filter(s => s.kind === 'kev.serve');
  assert.ok(serves.length >= 10 && serves.every(s => s.parsed.host === '127.0.0.1' && s.parsed.port === 8008));
  assert.ok(Object.values(r.plantedRuns).length >= 7 && r.stages.filter(s => s.argv.some(a => /\/runs\/j-20261008-000000-/.test(a))).length > 20, 'runs/<jobId> references were resolved by the bridge\'s own run check');
  // the validators are not vacuous: the bridge refuses, and Kev's parser refuses, what they should
  const bad = (id, params) => ({ id, kind: 'kev.train', params: { ...stages.find(s => s.id === 'J2-5000-s1').params, ...params }, files: stages.find(s => s.id === 'J2-5000-s1').files });
  const rb = await J.validateStages([bad('b1', { maxState: 100 }), bad('b2', { extra: { bogus: 1 } }), bad('b3', { dtype: 'fp16' }), bad('b4', { initFrom: 'runs/j-20261008-123456-abcdef' }), bad('b5', { lr: 0.5 }), bad('b6', { base: 'meta-llama/Llama-3-8B' })], { argparse: false });
  assert.equal(rb.ok, false); for (const s of rb.stages) assert.equal(s.validated, false, `${s.id} must be refused: ${s.errors}`);
  const direct = J.kevArgparse([{ id: 'u1', module: 'kev.train', argv: ['--bogus', '1'] }, { id: 'u2', module: 'kev.benchmark', argv: ['--run', 'x'] }, { id: 'u3', module: 'kev.serve', argv: ['--port', 'notanumber'] }, { id: 'u4', module: 'kev.train', argv: ['--epochs', '2'] }]);
  assert.deepEqual(direct.map(d => [d.id, d.error ? 'refused' : 'parsed']), [['u1', 'refused'], ['u2', 'refused'], ['u3', 'refused'], ['u4', 'parsed']]);
  assert.match(direct[0].error, /argparse exit 2/);
});

test('kev: the router sends a file to kev.benchmark only if every state fits 384 tokens (Kev\'s fits(), the benchmark\'s own rule)', { timeout: 10 * 60_000 }, () => {
  const dir = H.tempDir('served-router-');
  const text = k => Array.from({ length: k }, () => 'the').join(' ');                  // one token per word
  const rec = (state, id, extra = {}) => ({ state, questions: { Q: choice(['a', 'b']) , ...extra }, _meta: { id } });
  const probe = measureRecords([rec(text(383), 'p383'), rec(text(384), 'p384'), rec(text(385), 'p385')], { maxState: 384 });
  assert.deepEqual(probe.map(p => [p.stateTokens, p.fits]), [[384, true], [385, false], [386, false]], 'a state of 383 tokens plus the <state> token is the last that fits');
  const write = (name, recs) => { const f = path.join(dir, name); writeFileSync(f, jsonl(recs)); return f; };
  const fitting = write('fits.jsonl', [rec('short', 'a'), rec(text(383), 'b'), ...at2Records().slice(2, 5).map(r => ({ ...r, _meta: { id: `f/${r._meta.id}` } }))]);
  const r1 = J.routeFile(fitting);
  assert.equal(r1.route, 'benchmark'); assert.equal(r1.overflowing, 0); assert.equal(r1.records, 5); assert.equal(r1.maxStateTokens, 384);
  const over = write('over.jsonl', [rec('short', 'a'), rec(text(384), 'b')]);
  const r2 = J.routeFile(over);
  assert.equal(r2.route, 'served'); assert.equal(r2.overflowing, 1); assert.equal(r2.over384, 1); assert.match(r2.reason, /1 of 2 records exceed the training context/);
  // the branch: a short state with a question that is too long is rejected by the benchmark too
  const wide = { state: 'short', questions: { Q: { type: 'choice', instructions: 'Which?', criteria: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`opt_${i}`, text(30)])), label: 'opt_3', src: 'unit_choice' } }, _meta: { id: 'wide' } };
  const r3 = J.routeFile(write('wide.jsonl', [wide]));
  assert.equal(r3.route, 'served'); assert.equal(r3.over384, 0, 'the state itself fits'); assert.equal(r3.overflowing, 1);
  // a single long state sends the whole file to the served scorer, whatever the other records are
  const mixed = write('mixed.jsonl', [...at2Records().slice(0, 40).map(r => ({ ...r, _meta: { id: `m/${r._meta.id}` } }))]);
  const r4 = J.routeFile(mixed), measured = measureRecords(at2Records().slice(0, 40), { maxState: 384 });
  assert.equal(r4.route, 'served'); assert.equal(r4.overflowing, measured.filter(m => !m.fits).length); assert.equal(r4.records, 40);
  assert.deepEqual(J.routeRecords(at2Records().slice(2, 5)).route, 'benchmark');
  // a file that is not a Kev file is refused, not routed
  assert.throws(() => J.routeFile(write('bad.jsonl', [{ state: 'x' }])), e => e.code === 'ROUTE_INVALID');
  assert.throws(() => J.routeFile(path.join(dir, 'missing.jsonl')), e => e.code === 'ROUTE_INVALID');
});

// =============================================================================================================
// kev: acceptance 2: a 200-record file with 40% of states between 400 and 2,000 tokens
// =============================================================================================================
// The model forward is the only thing replaced (a CPU 0.8B forward on 80 states of 500-1,600 tokens takes hours on this shared
// 4-core VM; the real model run is the opt-in "kev-live" test below). Everything that decides the numbers is Kev's:
//  - kev.benchmark.evaluate_records(skip_overlong=True) with LocalPredictor's own strict encode at CONTEXT, load_records, materialize;
//  - kev.serve.app (FastAPI), pydantic request validation, api.to_record / to_answers (4-decimal rounding), Server.answer_async,
//    kev.model.admit (65,536-token serving admission, 422 above), /v1/models.
const DRY_BENCH_PY = String.raw`
import sys, json
kev_root, data, out = sys.argv[1], sys.argv[2], sys.argv[3]
sys.path.insert(0, kev_root)
from kev.benchmark import evaluate_records
from kev.data import load_records, materialize
from kev.model import ContextOverflow, encode, load_tokenizer
from kev.suite import CONTEXT
tok = load_tokenizer("Qwen/Qwen3.5-0.8B-Base", revision="dc7cdfe2ee4154fa7e30f5b51ca41bfa40174e68")
class ForwardlessPredictor:
    temperature = 1.0
    def __call__(self, record):
        enc = encode(tok, materialize(record), max_state=CONTEXT["max_state"], max_branch=CONTEXT["max_branch"], strict=True)
        if len(enc["ids"]) > CONTEXT["max_packed"]:
            raise ContextOverflow("packed request exceeds the %d-token limit" % CONTEXT["max_packed"])
        probs = {}
        for qid, q in record["questions"].items():
            keys = list(q["criteria"]) if q["type"] == "choice" else ["false", "true"]
            probs[qid] = {k: 1.0 / len(keys) for k in keys}
        return {"probabilities": probs, "latency_ms": 0.0}
report, rows = evaluate_records(load_records(data), ForwardlessPredictor(), out, skip_overlong=True)
print("@@COVERAGE@@" + json.dumps(report["coverage"]))
`;
const STUB_SERVE_PY = String.raw`
import sys, hashlib, json, math, types
from concurrent.futures import Future
kev_root, port = sys.argv[1], int(sys.argv[2])
sys.path.insert(0, kev_root)
import torch
import kev.serve as S
from kev.model import encode, admit, load_tokenizer
from fastapi import HTTPException
tok = load_tokenizer("Qwen/Qwen3.5-0.8B-Base", revision="dc7cdfe2ee4154fa7e30f5b51ca41bfa40174e68")
model = types.SimpleNamespace(encode=lambda tok, rec, **kw: encode(tok, rec, option_isolation=False, **kw), backend="torch", dtype="stub-fp32", head=types.SimpleNamespace(temperature=1.0), hybrid=True)
state = {"jitter": 0.0, "n": 0}
class StubServer(S.Server):
    def __post_init__(self):
        self.release_date = "2026-10-06"
        self.prefix_cache = S.PrefixCache(4, 0)
        self.queue = types.SimpleNamespace(qsize=lambda: 0)
    def close(self): pass
    def submit(self, rec):
        try: enc = admit(self.model, self.tok, rec, truncate=self.truncate_states)
        except ValueError as e: raise HTTPException(422, str(e))
        digest = hashlib.sha256(json.dumps(rec, sort_keys=True).encode()).digest()
        probs = []
        for qi, q in enumerate(rec["questions"]):
            logits = [((digest[(qi * 7 + i) % 32] / 255.0) - 0.5) * 6.0 for i in range(len(q["options"]))]
            if state["jitter"]:
                state["n"] += 1
                logits = [x + state["jitter"] * math.sin(state["n"] * 1.7 + i) for i, x in enumerate(logits)]
            z = [math.exp(x) for x in logits]; t = sum(z)
            probs.append(torch.tensor([x / t for x in z]))
        f = Future()
        f.set_result((probs, {"tokens": len(enc["ids"]), "state_tokens": enc["state_tokens"], "state_tokens_used": enc["seg"].count(0), "latency_ms": 1.5, "prefix_cache_hit": False}))
        return f
ck = types.SimpleNamespace(requested="stub/kev-forwardless@test", meta=types.SimpleNamespace(base="Qwen/Qwen3.5-0.8B-Base", lora=16), path="stub", release_date=lambda: "2026-10-06")
S.app.state.server = StubServer(ck, tok, model, "cpu")
@S.app.post("/stub/jitter")
async def set_jitter(body: dict):
    state["jitter"] = float(body.get("amount", 0.0)); return {"ok": True}
import uvicorn
print("stub ready", flush=True)
uvicorn.run(S.app, host="127.0.0.1", port=port, log_level="warning")
`;
let stub = null;
async function stubKev() {
  if (stub) return stub;
  const dir = H.tempDir('served-stub-'), script = path.join(dir, 'stub_serve.py');
  writeFileSync(script, STUB_SERVE_PY);
  const port = await freePort(), child = spawn(PYTHON, ['-I', script, KEV.root, String(port)], { env: pyEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  const url = `http://127.0.0.1:${port}`;
  stub = { url, run: 'stub/kev-forwardless@test', stop: () => child.kill('SIGKILL'), jitter: amount => fetch(`${url}/stub/jitter`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount }) }).then(r => r.json()) };
  process.once('exit', () => child.kill('SIGKILL'));
  for (let i = 0; i < 360; i++) {
    if (child.exitCode !== null) throw new Error(`the stub server exited: ${log.slice(-1200)}`);
    try { if ((await fetch(`${url}/v1/models`)).ok) return stub; } catch {}
    await wait(500);
  }
  child.kill('SIGKILL'); throw new Error(`the stub server did not start: ${log.slice(-1200)}`);
}
function dryBenchmark(file, out) {
  const script = path.join(path.dirname(out), 'dry_bench.py'); writeFileSync(script, DRY_BENCH_PY);
  const r = spawnSync(PYTHON, ['-I', script, KEV.root, file, out], { env: pyEnv(), encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 1 << 26 });
  const m = /@@COVERAGE@@(.*)/.exec(r.stdout ?? '');
  assert.ok(m, `kev.benchmark data path failed:\n${(r.stderr ?? '').slice(-1500)}`);
  return { coverage: JSON.parse(m[1]), rejected: existsSync(path.join(out, 'rejected.json')) ? JSON.parse(readFileSync(path.join(out, 'rejected.json'), 'utf8')) : [] };
}

test('kev: 200-record file, 40% of states 400-2,000 tokens: kev.benchmark --data rejects, score-served rejects none, 20 records re-read through the raw API agree within |dp| < 0.01', { timeout: 20 * 60_000 }, async () => {
  const records = at2Records(), measured = at2Measured();
  // the fixture is what the acceptance says: 80 of 200 states (40%) between 400 and 2,000 real tokens, the rest inside Kev's training context
  const longIdx = measured.map((m, i) => (m.stateTokens >= 400 && m.stateTokens <= 2000 ? i : -1)).filter(i => i >= 0);
  assert.equal(longIdx.length, 80); assert.ok(longIdx.every(i => !measured[i].fits), 'a state over 384 tokens does not fit the training context');
  assert.ok(measured.filter((m, i) => !longIdx.includes(i)).every(m => m.fits && m.stateTokens <= 384));
  const dir = H.tempDir('served-at2-'), file = path.join(dir, 'at2.jsonl');
  writeFileSync(file, jsonl(records));

  // (a) kev.benchmark --data: Kev's own coverage accounting
  const bench = dryBenchmark(file, path.join(dir, 'bench'));
  assert.ok(bench.coverage.rejected_records > 0, 'kev.benchmark --data silently skips states over 384 tokens'); assert.equal(bench.coverage.rejected_records, 80);
  assert.equal(bench.coverage.evaluated_records, 120); assert.equal(bench.coverage.requested_records, 200);
  const route = J.routeFile(file);
  assert.equal(route.route, 'served', 'so the router does not send this file to kev.benchmark'); assert.equal(route.overflowing, bench.coverage.rejected_records, 'the router predicts exactly what the benchmark rejects');

  // (b) score-served against Kev's FastAPI app: every record is served
  const kev = await stubKev(), loaded = SS.loadKevRecords(file), rowsFile = path.join(dir, 'rows', 'at2.rows.jsonl');
  const { report, rows } = await SS.scoreServed({ records: loaded.records, served: SS.servedClient({ url: kev.url }), url: kev.url, rowsFile, concurrency: 4, reread: 20, expectRun: kev.run, inputFile: 'at2.jsonl', inputSha256: loaded.sha256 });
  assert.equal(report.coverage.rejected_records, 0, 'score-served shows 0 rejections'); assert.equal(report.coverage.evaluated_records, 200); assert.equal(report.coverage.evaluated_questions, 200);
  assert.equal(report.coverage.failed_records, 0); assert.equal(report.coverage.truncated_records, 0); assert.equal(report.valid, true);
  assert.equal(rows.length, 200); assert.deepEqual(rows.map(r => r.id), records.map(r => r._meta.id), 'one row per question in the file\'s order');
  assert.ok(rows.every(r => r.p.length === 4 && Math.abs(r.p.reduce((a, b) => a + b, 0) - 1) < 0.01 && r.p.every(x => Math.abs(x * 1e4 - Math.round(x * 1e4)) < 1e-6)), 'four options, four decimals');
  assert.ok(rows.every(r => r.label >= 0 && r.label < 4 && r.keys[r.label] === records.find(x => x._meta.id === r.id).questions[r.question].label), 'the label is the file\'s');
  assert.ok(rows.filter((r, i) => longIdx.includes(i)).every(r => r.input_tokens > 400), 'the long states reached the server whole');
  assert.equal(report.served.identity.run, kev.run); assert.equal(report.served.identity.max_state_tokens, 65536);
  assert.equal(JSON.parse(readFileSync(SS.reportFileOf(rowsFile), 'utf8')).rows.sha256, sha(readFileSync(rowsFile)));
  // (c) 20 records re-read through the raw API (a plain POST, the test's own request builder), compared with the rows
  const ids = [...new Set(rows.map(r => r.id))].filter((_, i) => i % 10 === 3).slice(0, 20);
  assert.equal(ids.length, 20);
  const raw = async rec => {
    const body = { state: rec.state, model: 'kev-latest', questions: Object.fromEntries(Object.entries(rec.questions).map(([q, v]) => [q, { type: v.type, instructions: v.instructions, criteria: v.criteria }])) };
    const res = await fetch(`${kev.url}/v1/systemone`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(res.status, 200); return (await res.json()).answers;
  };
  let maxDp = 0;
  for (const id of ids) {
    const rec = records.find(r => r._meta.id === id), answers = await raw(rec);
    for (const row of rows.filter(r => r.id === id)) row.keys.forEach((k, i) => { maxDp = Math.max(maxDp, Math.abs(row.p[i] - answers[row.question].probabilities[k])); });
  }
  assert.ok(maxDp < 0.01, `|dp| = ${maxDp}`);
  assert.equal(report.reread.records, 20); assert.equal(report.reread.agree, true); assert.ok(report.reread.maxAbsDp < 0.01);
  // numeric noise of bf16 size still agrees; a real disagreement does not
  await kev.jitter(0.004);
  const noisy = await SS.scoreServed({ records: loaded.records.slice(0, 40), served: SS.servedClient({ url: kev.url }), url: kev.url, reread: 20, concurrency: 2 });
  assert.equal(noisy.report.reread.agree, true, `maxAbsDp ${noisy.report.reread.maxAbsDp}`); assert.equal(noisy.report.valid, true);
  await kev.jitter(0.12);
  const unstable = await SS.scoreServed({ records: loaded.records.slice(0, 40), served: SS.servedClient({ url: kev.url }), url: kev.url, reread: 20, concurrency: 1 });
  await kev.jitter(0);
  assert.equal(unstable.report.reread.agree, false, `maxAbsDp ${unstable.report.reread.maxAbsDp}`); assert.equal(unstable.report.valid, false, 'a run whose re-read disagrees is not valid');
});

test('kev: a state over the serving limit is a counted rejection of the served scorer, never a silent drop', { timeout: 10 * 60_000 }, async () => {
  const kev = await stubKev(), records = at2Records().slice(2, 5).map(r => ({ ...r, _meta: { ...r._meta, id: `s/${r._meta.id}` } }));
  const huge = { state: { system: 'ATLAS-01', log: Array.from({ length: 66_000 }, () => 'the').join(' ') }, questions: records[0].questions, _meta: { id: 's/huge' } };
  const parsed = SS.parseKevText(jsonl([records[0], huge, records[1], records[2]]));
  const { report, rows } = await SS.scoreServed({ records: parsed, served: SS.servedClient({ url: kev.url }), url: kev.url, concurrency: 2 });
  assert.equal(report.coverage.rejected_records, 1); assert.equal(report.coverage.evaluated_records, 3); assert.equal(rows.length, 3);
  assert.equal(report.rejected[0].id, 's/huge'); assert.match(report.rejected[0].error, /65,536/); assert.equal(report.valid, false);
});

test('kev-live: the real model on CPU: kev.benchmark --data and kev.serve on the 200-record file (KEV_DATA_SERVED_LIVE=1; hours on a shared 4-core VM)', { skip: LIVE ? false : 'set KEV_DATA_SERVED_LIVE=1 to run the real model (CPU, fp32)', timeout: 6 * 3600_000 }, async t => {
  const dir = H.tempDir('served-live-'), file = path.join(dir, 'at2.jsonl');
  const n = Number(process.env.KEV_DATA_SERVED_LIVE_N ?? 200), keep = at2Records().filter((_, i) => i < n);
  writeFileSync(file, jsonl(keep));
  const longN = keep.filter((_, i) => i % 5 < 2).length;
  const bench = spawnSync(PYTHON, ['-I', '-c', `import sys, runpy; sys.path.insert(0, ${JSON.stringify(KEV.root)}); sys.argv = ['kev.benchmark', '--run', 'jaredpalmer/kev-0.8b@v1.0', '--data', ${JSON.stringify(file)}, '--out', ${JSON.stringify(path.join(dir, 'bench'))}, '--device', 'cpu']; runpy.run_module('kev.benchmark', run_name='__main__')`],
    { env: pyEnv(), encoding: 'utf8', timeout: 5 * 3600_000, maxBuffer: 1 << 28 });
  assert.equal(bench.status, 0, (bench.stderr ?? '').slice(-1500));
  const report = JSON.parse(readFileSync(path.join(dir, 'bench', 'report.json'), 'utf8'));
  t.diagnostic(`kev.benchmark --data: ${JSON.stringify(report.coverage)}`);
  assert.equal(report.coverage.rejected_records, longN);
  const port = await freePort(), srv = spawn(PYTHON, ['-I', '-c', `import sys, runpy; sys.path.insert(0, ${JSON.stringify(KEV.root)}); sys.argv = ['kev.serve', '--run', 'jaredpalmer/kev-0.8b@v1.0', '--host', '127.0.0.1', '--port', '${port}']; runpy.run_module('kev.serve', run_name='__main__')`], { env: { ...pyEnv(), KEV_PREFIX_CACHE: '0' }, stdio: 'ignore' });
  t.after(() => srv.kill('SIGKILL'));
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 1200; i++) { try { if ((await fetch(`${url}/v1/models`)).ok) break; } catch {} await wait(1000); }
  const loaded = SS.loadKevRecords(file);
  const r = await SS.scoreServed({ records: loaded.records, served: SS.servedClient({ url, timeoutMs: 3600_000 }), url, rowsFile: path.join(dir, 'rows.jsonl'), reread: 20, timeoutMs: 3600_000, expectRun: 'jaredpalmer/kev-0.8b@v1.0' });
  t.diagnostic(`score-served: ${JSON.stringify(r.report.coverage)} reread ${JSON.stringify(r.report.reread)} ${r.report.timing.seconds_per_request} s/request`);
  assert.equal(r.report.coverage.rejected_records, 0); assert.equal(r.report.valid, true); assert.ok(r.report.reread.maxAbsDp < 0.01);
});
