// S0-2 replay plumbing at $0: the salt-free memo port (run-compiled.mjs), runCompiled's flowOverride option, and the
// replay-coverage tool (FG P1: under 90% coverage, "$0 replays" are capped live re-runs). No model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ModelPort } from '../../../src/models/port.mjs';
import { Journal } from '../../../src/journal.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';
import { subsetPolicy } from '../../lib/models.mjs';
import { runCompiled, createMemoPort, requestDigestOf, looseDigestOf, memoRowOf, readMemoJournal, FLOW_V2, DEFAULT_FLOW } from '../run-compiled.mjs';
import { replayCoverage, coverageVerdict, parseArgs, main, COVERAGE_BAR } from '../replay-coverage.mjs';

const skip = sandboxAvailable() ? false : 'no user namespaces';
const HAIKU = 'claude-haiku-5-5', SONNET = 'claude-sonnet-5-5';
const MODELS = [HAIKU, SONNET, 'claude-opus-5-5'];
const policy = subsetPolicy(loadPolicy().policy, MODELS);
const SCHEMA = { type: 'object', properties: { label: { type: 'string' } }, required: ['label'], additionalProperties: false };
const req = (prompt, extra = {}) => ({ runId: 'r', nodeKey: 'gateway/call/0', modelId: HAIKU, system: '', prompt, schema: SCHEMA, decoding: { reasoning: 'none' }, ...extra });
const row = (prompt, value, extra = {}) => ({ requestDigest: requestDigestOf(req(prompt)), model: HAIKU, response: { ok: true, value }, ...extra });

test('requestDigestOf: salt-free and stable (no runId, nodeKey, salt or sample index); model, prompt, schema and decoding all count', () => {
  const d = requestDigestOf(req('p'));
  assert.match(d, /^[0-9a-f]{64}$/);
  assert.equal(requestDigestOf(req('p', { runId: 'other', nodeKey: 'gateway/call/9', salt: 's', sampleIndex: 2 })), d);
  assert.equal(requestDigestOf({ ...req('p'), schema: JSON.parse(JSON.stringify({ required: ['label'], type: 'object', additionalProperties: false, properties: { label: { type: 'string' } } })) }), d, 'key order does not matter');
  for (const other of [req('q'), req('p', { modelId: SONNET }), req('p', { system: 's' }), req('p', { decoding: { reasoning: 'low' } }), req('p', { schema: { type: 'object' } })]) assert.notEqual(requestDigestOf(other), d);
  assert.equal(requestDigestOf({ model: HAIKU, system: '', prompt: 'p', schema: SCHEMA, decoding: { reasoning: 'none' } }), d, 'model or modelId');
});

test('memo port: answers in journal order per digest, $0; strict misses throw REPLAY_MISS; reuse and live fallthrough are counted', async () => {
  const journal = [row('p', { label: 'one' }), row('p', { label: 'two' }), row('q', { label: 'q' }),
    { requestDigest: requestDigestOf(req('e')), model: HAIKU, response: { ok: false, error: { code: 'MODEL_RATE_LIMIT' } } },   // an env fault never replays
    { requestDigest: requestDigestOf(req('s')), model: HAIKU, ok: false, response: { error: { code: 'MODEL_SCHEMA', message: 'bad' } } },   // a model outcome does
    'not a row', { model: HAIKU }];
  const strict = createMemoPort({ journal });
  assert.equal(strict.memo.strict, true); assert.equal(strict.memo.reuse, false);
  const a = await strict.call(req('p')), b = await strict.call(req('p', { runId: 'later-run' }));
  assert.deepEqual([a.value, b.value], [{ label: 'one' }, { label: 'two' }]); assert.equal(a.costUsd, 0); assert.equal(a.replayed, true); assert.equal(b.memo.index, 1);
  await assert.rejects(strict.call(req('p')), e => e.code === 'REPLAY_MISS', 'strict: past the journaled answers is a miss');
  await assert.rejects(strict.call(req('e')), e => e.code === 'REPLAY_MISS', 'a journaled rate limit is not served');
  const s = await strict.call(req('s'));
  assert.equal(s.ok, false); assert.equal(s.error.code, 'MODEL_SCHEMA');
  assert.deepEqual({ ...strict.memo.stats(), missed: strict.memo.stats().missed.length }, { requests: 5, hits: 3, looseHits: 0, reused: 0, misses: 2, live: 0, coverage: 0.6, journalRows: 7, skippedRows: 3, missed: 2 });
  strict.reset(); assert.deepEqual((await strict.call(req('p'))).value, { label: 'one' }, 'reset rewinds');
  // Fallthrough: misses go to the live port; past the last answer the memo reuses it.
  const calls = [];
  const live = { policy, providers: {}, policyHash: 'h', call: async r => { calls.push(r.prompt); return { ok: true, value: { label: 'live' }, costUsd: 0.01, modelId: r.modelId }; } };
  const fall = createMemoPort({ journal, live });
  assert.equal(fall.policy, policy); assert.equal(fall.policyHash, 'h'); assert.equal(fall.memo.reuse, true);
  for (const p of ['p', 'p', 'p', 'zz']) await fall.call(req(p));
  assert.deepEqual(calls, ['zz']);
  const st = fall.memo.stats();
  assert.deepEqual([st.requests, st.hits, st.reused, st.misses, st.live, st.coverage], [4, 2, 1, 1, 1, 0.75]);
  assert.throws(() => createMemoPort({ journal, strict: false }), /needs a live port/);
});

test('memo journal rows: requestDigest rows; exported ModelPort rows (bodies inline or in bodies/) by the loose key; a JSONL file', async () => {
  // As stream.mjs journalToJsonl exports a ModelPort row: effective decoding (maxTokens erased), wrapped bodies.
  const wrap = body => ({ sha256: 'x'.repeat(64), bytes: 1, body });
  const portRow = { modelId: HAIKU, ok: true, errorCode: null, decoding: { reasoning: 'none', effort: 'low', thinkingTokens: 0, maxTokens: 'provider-default', temperature: 'provider-default' },
    request: wrap({ system: '', prompt: 'p', schema: SCHEMA, mode: 'live', salt: 'run-1' }), response: wrap({ value: { label: 'x' }, text: null }) };
  const m0 = memoRowOf(portRow);
  assert.equal(m0.digest, null); assert.equal(m0.loose, looseDigestOf(req('p'))); assert.deepEqual(m0.value, { label: 'x' });
  assert.equal(looseDigestOf(req('p', { decoding: { reasoning: 'none', maxTokens: 300 } })), m0.loose, 'maxTokens is not in the loose key');
  assert.notEqual(looseDigestOf(req('p', { decoding: { reasoning: 'low' } })), m0.loose);
  assert.equal(memoRowOf({ ...portRow, ok: false, errorCode: 'MODEL_TIMEOUT', response: wrap({ error: { code: 'MODEL_TIMEOUT' } }) }), null, 'an env fault is not served');
  assert.equal(memoRowOf({ ...portRow, request: wrap({ mode: 'replay', salt: 's', replayOf: 3 }) }), null, 'a replay row has no request text');
  const dir = mkdtempSync(path.join(tmpdir(), 'jit-memo-'));
  try {
    const big = { sha256: 'b'.repeat(64), bytes: 999999, path: `bodies/${'b'.repeat(64)}.json` };
    mkdirSync(path.join(dir, 'bodies')); writeFileSync(path.join(dir, big.path), JSON.stringify({ system: '', prompt: 'q', schema: SCHEMA }));
    const f = path.join(dir, 'journal.jsonl');
    writeFileSync(f, [row('p', { label: 'one' }), portRow, { ...portRow, request: big, response: wrap({ value: { label: 'big' } }) },
      { ...portRow, request: { ...big, path: 'bodies/missing.json' } }].map(r => JSON.stringify(r)).join('\n') + '\n{broken\n');
    const m = readMemoJournal(f);
    assert.deepEqual([m.rows, m.skipped], [4, 1], 'an unparseable line is dropped; a body file that is not there makes its row unservable');
    const port = createMemoPort({ journal: f });
    const got = [await port.call(req('p')), await port.call(req('p')), await port.call(req('q'))];
    assert.deepEqual(got.map(x => x.value.label), ['one', 'x', 'big'], 'exact digest first, then the loose key; a body in bodies/ is read');
    assert.deepEqual(got.map(x => !!x.memo.loose), [false, true, true]);
    assert.deepEqual([port.memo.stats().hits, port.memo.stats().looseHits], [3, 2]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('coverageVerdict: FG P1 bar at 90%; a run stopped by a miss is never a $0 replay', () => {
  assert.equal(COVERAGE_BAR, 0.9);
  const v = (requests, hits, misses, status) => coverageVerdict({ requests, hits, reused: 0, misses, coverage: requests ? hits / requests : null }, { status });
  assert.equal(v(10, 9, 1, 'ok').replayable, true);
  assert.match(v(10, 8, 2, 'ok').text, /^capped live re-run: coverage 80\.0% < 90%/);
  const stopped = v(20, 19, 1, 'deopt');
  assert.equal(stopped.replayable, false); assert.equal(stopped.stoppedByMiss, true); assert.match(stopped.text, /stopped on a journal miss/);
  assert.equal(v(0, 0, 0, 'ok').replayable, true);
  assert.throws(() => parseArgs(['a', 'b']), /usage/); assert.deepEqual(parseArgs(['j', 's', 't', '--flow', 'v1', '--json']).positional, ['j', 's', 't']);
});

// ---- sandboxed: the real flow-v2.mjs and gateway ----
const TASK = { id: 'records:dev:d3:9', prompt: 'p', inputs: { rows: [1, 2] } };
const OUT = { type: 'object', required: ['records'], properties: { records: { type: 'array' } } };
const SOLVE = `import { createFlow } from './tools/flow.mjs';
const flow = createFlow({ budgetUsd: 1 }); const task = flow.input();
const schema = ${JSON.stringify(SCHEMA)};
const out = [];
for (const r of task.inputs.rows) out.push((await flow.judge('label', { tiers: ['${HAIKU}', '${SONNET}'], prompt: 'row ' + r, schema })).label);
flow.done({ records: out });`;
const livePort = value => new ModelPort({ policy, journal: new Journal(new DatabaseSync(':memory:')),
  providers: { 'claude-cli': new ScriptedProvider(() => ({ value, costUsd: 0.02 })) } });
function setup(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'jit-replay-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const solvePath = path.join(root, 'solve.mjs'); writeFileSync(solvePath, SOLVE);
  const wd = name => { const d = path.join(root, name); mkdirSync(d); return d; };
  return { root, solvePath, wd };
}
// The journal a persisted run would leave: one row per call, keyed by the digest of the request the gateway saw.
const journalFor = (rows, model = HAIKU) => rows.map(([prompt, label]) => ({ requestDigest: requestDigestOf({ modelId: model, system: '', prompt, schema: SCHEMA, decoding: { reasoning: 'none' } }), model, response: { ok: true, value: { label } } }));

test('runCompiled + strict memo port: a fully journaled task replays at $0 with no live port; meta.memo counts this run', { skip }, async t => {
  const { solvePath, wd } = setup(t);
  const port = createMemoPort({ journal: journalFor([['row 1', 'a'], ['row 2', 'b']]), policy });
  const r = await runCompiled({ solvePath, task: TASK, modelPort: port, perTaskUsd: 0.5, timeoutMs: 30000, workdir: wd('run'), outputSchema: OUT, allowedModels: MODELS, flowPath: FLOW_V2, label: 'memo' });
  assert.equal(r.status, 'ok', JSON.stringify(r.error)); assert.deepEqual(r.output, { records: ['a', 'b'] }); assert.equal(r.costUsd, 0);
  assert.deepEqual({ ...r.meta.memo, missed: r.meta.memo.missed.length }, { requests: 2, hits: 2, looseHits: 0, reused: 0, misses: 0, live: 0, coverage: 1, missed: 0 });
  // Without a memo port the result carries no memo field (the default record is unchanged).
  const plain = await runCompiled({ solvePath, task: TASK, modelPort: livePort({ label: 'z' }), perTaskUsd: 0.5, timeoutMs: 30000, workdir: wd('plain'), outputSchema: OUT, allowedModels: MODELS, flowPath: FLOW_V2, label: 'plain' });
  assert.equal(plain.status, 'ok'); assert.equal('memo' in plain.meta, false); assert.equal('flowOverride' in plain.meta, false);
});

test('runCompiled flowOverride: the hook module and its data are copied beside flow-v2; held judges cost $0; v1 refuses it; a stale hook is removed', { skip }, async t => {
  const { root, solvePath, wd } = setup(t);
  const hook = path.join(root, 'hook.mjs');
  writeFileSync(hook, `import { readFileSync } from 'node:fs';
const held = JSON.parse(readFileSync(new URL('./flow-override.json', import.meta.url), 'utf8'));
export default (site, request) => held[request.prompt] === undefined ? undefined : { value: { label: held[request.prompt] } };`);
  const work = wd('run');
  const r = await runCompiled({ solvePath, task: TASK, modelPort: livePort({ label: 'live' }), perTaskUsd: 0.5, timeoutMs: 30000, workdir: work, outputSchema: OUT, allowedModels: MODELS,
    flowPath: FLOW_V2, label: 'ovr', flowOverride: hook, flowOverrideData: { 'row 1': 'held' } });
  assert.equal(r.status, 'ok', JSON.stringify(r.error)); assert.deepEqual(r.output, { records: ['held', 'live'] }, 'row 1 held fixed, row 2 varied (live)');
  assert.equal(r.meta.flowOverride, true); assert.equal(r.meta.calls, 1); assert.equal(r.costUsd, 0.02);
  assert.deepEqual(r.trace.filter(e => e.kind === 'judge').map(e => e.overridden ?? 0), [1, 0]);
  // Re-using the workdir without an override: the stale hook is gone, both rows go live.
  const again = await runCompiled({ solvePath, task: TASK, modelPort: livePort({ label: 'live' }), perTaskUsd: 0.5, timeoutMs: 30000, workdir: work, outputSchema: OUT, allowedModels: MODELS, flowPath: FLOW_V2, label: 'ovr2' });
  assert.deepEqual(again.output, { records: ['live', 'live'] });
  await assert.rejects(runCompiled({ solvePath, task: TASK, modelPort: livePort({}), workdir: wd('v1'), outputSchema: OUT, flowPath: DEFAULT_FLOW, flowOverride: hook }), /flowOverride needs flow-v2\.mjs/);
  await assert.rejects(runCompiled({ solvePath, task: TASK, modelPort: livePort({}), workdir: wd('d'), outputSchema: OUT, flowPath: FLOW_V2, flowOverrideData: {} }), /flowOverrideData needs flowOverride/);
});

test('replay-coverage: full journal -> $0 replay; half a journal -> misses, a judge deopt, and the capped-live verdict (CLI too)', { skip }, async t => {
  const { root, solvePath, wd } = setup(t);
  const full = await replayCoverage({ journal: journalFor([['row 1', 'a'], ['row 2', 'b']]), solvePath, task: TASK, outputSchema: OUT, workdir: wd('full'), timeoutMs: 30000 });
  assert.equal(full.run.status, 'ok'); assert.equal(full.stats.coverage, 1); assert.equal(full.verdict.replayable, true); assert.match(full.verdict.text, /^\$0 replay: coverage 100\.0%/);
  // Row 2 is not journaled on either tier: haiku misses, sonnet misses, the judge deopts.
  const jf = path.join(root, 'half.jsonl'); writeFileSync(jf, journalFor([['row 1', 'a']]).map(x => JSON.stringify(x)).join('\n') + '\n');
  const tf = path.join(root, 'task.json'); writeFileSync(tf, JSON.stringify({ task: TASK }));
  const lines = [];
  const half = await main([jf, solvePath, tf, '--workdir', wd('half'), '--timeout-s', '30'], { log: l => lines.push(l) });
  assert.equal(half.run.status, 'deopt'); assert.equal(half.run.deopt.kind, 'judge'); assert.equal(half.run.costUsd, 0);
  assert.deepEqual([half.stats.requests, half.stats.hits, half.stats.misses], [3, 1, 2]); assert.equal(half.verdict.replayable, false);
  assert.match(lines.at(-1), /^capped live re-run: coverage 33\.3% < 90%/); assert.match(lines[0], /requests 3 {2}hits 1 \(by the loose key 0\) {2}reused 0 {2}misses 2/);
  assert.equal(readFileSync(path.join(root, 'half', 'tools', 'flow.mjs'), 'utf8'), readFileSync(FLOW_V2, 'utf8'), 'replays run on flow-v2 by default');
});

test('end to end: a live run journaled by ModelPort, exported as JSONL rows (journalToJsonl shape), replays the same task at $0 with 100% coverage', { skip }, async t => {
  const { root, solvePath, wd } = setup(t);
  const db = new DatabaseSync(':memory:');
  const live = new ModelPort({ policy, journal: new Journal(db), providers: { 'claude-cli': new ScriptedProvider(({ prompt }) => ({ value: { label: `L(${prompt})` }, costUsd: 0.02 })) } });
  const first = await runCompiled({ solvePath, task: TASK, modelPort: live, perTaskUsd: 0.5, timeoutMs: 30000, workdir: wd('live'), outputSchema: OUT, allowedModels: MODELS, flowPath: FLOW_V2, label: 'live' });
  assert.equal(first.status, 'ok', JSON.stringify(first.error)); assert.equal(first.costUsd, 0.04);
  const wrap = text => (text == null ? null : { sha256: 'x'.repeat(64), bytes: text.length, body: JSON.parse(text) });
  const rows = db.prepare('SELECT * FROM model_calls ORDER BY id').all().map(r => ({ id: r.id, runId: r.run_id, modelId: r.model_id, ok: r.ok === 1, errorCode: r.error_code,
    decoding: r.decoding == null ? null : JSON.parse(r.decoding), request: wrap(r.request), response: wrap(r.response) }));
  assert.equal(rows.length, 2);
  const jf = path.join(root, 'journal.jsonl'); writeFileSync(jf, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const again = await replayCoverage({ journal: jf, solvePath, task: TASK, outputSchema: OUT, workdir: wd('replay'), timeoutMs: 30000 });
  assert.equal(again.run.status, 'ok'); assert.equal(again.run.costUsd, 0);
  assert.deepEqual([again.stats.requests, again.stats.hits, again.stats.looseHits, again.stats.misses], [2, 2, 2, 0]); assert.equal(again.verdict.replayable, true);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'replay', '.solve.stdout'), 'utf8')), first.output, 'the replay reproduces the live answer');
});

// Integration: the S0-1 export (stream.mjs journalToJsonl, from a journal.sqlite file) is what replays read.
import { journalToJsonl } from '../stream.mjs';
test('end to end through the S0-1 export: a live run journaled to journal.sqlite, exported by journalToJsonl, replays at $0 with 100% coverage; also from the committed mirror (no request bodies)', { skip }, async t => {
  const { root, solvePath, wd } = setup(t);
  const dbFile = path.join(root, 'journal.sqlite'), db = new DatabaseSync(dbFile);
  const live = new ModelPort({ policy, journal: new Journal(db), providers: { 'claude-cli': new ScriptedProvider(({ prompt }) => ({ value: { label: `L(${prompt})` }, costUsd: 0.02 })) } });
  const first = await runCompiled({ solvePath, task: TASK, modelPort: live, perTaskUsd: 0.5, timeoutMs: 30000, workdir: wd('live'), outputSchema: OUT, allowedModels: MODELS, flowPath: FLOW_V2, label: 'live' });
  assert.equal(first.status, 'ok', JSON.stringify(first.error)); assert.equal(first.costUsd, 0.04);
  db.close();
  const rows = journalToJsonl(dbFile).trim().split('\n').map(l => JSON.parse(l));
  assert.equal(rows.length, 2);
  // ModelPort rows journal the requested decoding (request.decoding), so the export carries the exact digest, not the loose key.
  assert.ok(rows.every(r => typeof r.requestDigest === 'string' && !('requestDigestLoose' in r)));
  const jf = path.join(root, 'export.jsonl'); writeFileSync(jf, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const again = await replayCoverage({ journal: jf, solvePath, task: TASK, outputSchema: OUT, workdir: wd('replay'), timeoutMs: 30000 });
  assert.equal(again.run.status, 'ok'); assert.equal(again.run.costUsd, 0);
  assert.deepEqual([again.stats.requests, again.stats.hits, again.stats.looseHits, again.stats.misses, again.stats.coverage], [2, 2, 0, 0, 1], 'served by the exact digest, none by the loose key'); assert.equal(again.verdict.replayable, true);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'replay', '.solve.stdout'), 'utf8')), first.output, 'the replay reproduces the live answer');
  // The committed mirror leaves bodies above maxBodyBytes out: request bodies (schema, provider request) are the big ones.
  const maxResp = Math.max(...rows.map(r => r.response.bytes)), minReq = Math.min(...rows.map(r => r.request.bytes));
  assert.ok(maxResp < minReq, `responses (${maxResp} B) are smaller than requests (${minReq} B)`);
  const mirrored = journalToJsonl(dbFile, { maxBodyBytes: maxResp }).trim().split('\n').map(l => JSON.parse(l));
  assert.ok(mirrored.every(r => r.request.path && !('body' in r.request) && 'body' in r.response));
  const mf = path.join(wd('mirror'), 'journal.jsonl'); writeFileSync(mf, mirrored.map(r => JSON.stringify(r)).join('\n') + '\n');   // no bodies/ beside it
  const fromMirror = await replayCoverage({ journal: mf, solvePath, task: TASK, outputSchema: OUT, workdir: wd('replay2'), timeoutMs: 30000 });
  assert.equal(fromMirror.run.status, 'ok'); assert.equal(fromMirror.stats.coverage, 1); assert.equal(fromMirror.run.costUsd, 0);
  assert.equal(fromMirror.stats.looseHits, 0, 'the mirror serves by the exact digest too');
  // An old journal (rows without request.decoding, as exported before this field) still replays by the loose key.
  const oldDb = new DatabaseSync(dbFile);
  for (const r of oldDb.prepare('SELECT id, request FROM model_calls').all()) { const q = JSON.parse(r.request); delete q.decoding; oldDb.prepare('UPDATE model_calls SET request = ? WHERE id = ?').run(JSON.stringify(q), r.id); }
  oldDb.close();
  const oldRows = journalToJsonl(dbFile).trim().split('\n').map(l => JSON.parse(l));
  assert.ok(oldRows.every(r => typeof r.requestDigestLoose === 'string' && !('requestDigest' in r)));
  const of = path.join(root, 'old.jsonl'); writeFileSync(of, oldRows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const oldReplay = await replayCoverage({ journal: of, solvePath, task: TASK, outputSchema: OUT, workdir: wd('replay-old'), timeoutMs: 30000 });
  assert.deepEqual([oldReplay.run.status, oldReplay.stats.hits, oldReplay.stats.looseHits, oldReplay.stats.misses], ['ok', 2, 2, 0]);
});
