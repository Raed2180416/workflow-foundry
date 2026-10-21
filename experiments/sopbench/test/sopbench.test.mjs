// Tests for the SOP-Bench bridge harness (experiments/sopbench). No model is called anywhere ($0).
//   node --test --test-concurrency=1 experiments/sopbench/test/sopbench.test.mjs
// The bridge tests need the pinned tool venv (corpus/sop-bench-venv) and the clone (corpus/sop-bench: upstream's parser
// and evaluator) and skip without them; they run on a toy fixture SOP (test/fixtures/data/toy_sop), never on SOP-Bench rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HERE, TOOL_CLIENT, UPSTREAM, VENV_PY, bridgeOk, canon, materializeWorkdir, readJson, runBridge, shaCanon, startServe, writeJson } from '../lib.mjs';
import { assertRows, loadSplit, makeSplit, repairCount, splitOne } from '../split.mjs';
import { compareSingle, lastFinalOutput, pyFloatRepr, pyJsonLoads, pyStr, strictVerdict, upstreamVerdict } from '../scorer.mjs';
import { policyAnswer, runRows, systemPrompt, userPrompt } from '../run.mjs';

const HAVE = existsSync(VENV_PY) && existsSync(path.join(UPSTREAM, 'src/amazon_sop_bench/evaluation/parser.py'));
const SKIP = !HAVE && 'SOP-Bench tool venv or clone missing';
const FIXTURE = path.join(HERE, 'test/fixtures/data');
const tmp = p => mkdtempSync(path.join(os.tmpdir(), `sopbench-${p}-`));
const E = (str, isna = false) => ({ str, isna });

// ---- scorer --------------------------------------------------------------------------------------------------------
test('pyFloatRepr is Python repr(float)', () => {
  const cases = [[1, '1.0'], [1.5, '1.5'], [1e15, '1000000000000000.0'], [1e16, '1e+16'], [0.0001, '0.0001'], [0.00001, '1e-05'], [-0, '-0.0'], [0.1 + 0.2, '0.30000000000000004'],
    [123456789012345678, '1.2345678901234568e+17'], [5e-324, '5e-324'], [NaN, 'nan'], [Infinity, 'inf'], [-2.5e-7, '-2.5e-07']];
  for (const [x, s] of cases) assert.equal(pyFloatRepr(x), s, String(x));
});

test('pyJsonLoads keeps the Python value of each JSON token', () => {
  const v = pyJsonLoads(' {"a": 1.0, "b": 10, "c": true, "d": null, "e": 12345678901234567890, "f": -0, "g": NaN, "h": "x"} ');
  const m = Object.fromEntries(v.v.map(([k, x]) => [k, pyStr(x)]));
  assert.deepEqual(m, { a: '1.0', b: '10', c: 'True', d: 'None', e: '12345678901234567890', f: '0', g: 'nan', h: 'x' });
  for (const bad of ['{"a": 1} x', "{'a': 1}", '{"a": "\u0001"}', '{"a": 01}', '{"a": 1,}']) assert.throws(() => pyJsonLoads(bad), undefined, bad);
});

test('upstream port: fuzzy containment, separators, null equivalence (parser.py:464-519)', () => {
  assert.equal(compareSingle('not approved', E('Approved')), true); // containment: the leniency the strict metric removes
  assert.equal(compareSingle('class_3', E('Class 3')), true);
  assert.equal(compareSingle('unknown', E('nan', true)), true); // null-likes match each other
  assert.equal(compareSingle('unknown', E('ship')), false);
  assert.equal(compareSingle('1', E('10')), true); // "1" in "10"
  const one = (t, exp) => upstreamVerdict(t, { decision: exp }, ['decision']);
  assert.deepEqual(one('<final_output>{"decision": "ship / review / backorder"}</final_output>', E('review')), { covered: true, pass: true });
  assert.equal(one('no tag here', E('ship')).covered, false); // upstream falls back to its other parsers: not ported
  assert.equal(one('<final_output>{"other": "ship"}</final_output>', E('ship')).covered, false);
  // multi-field: only one of two columns found -> upstream's single-format result -> {} decisions -> fail
  const two = upstreamVerdict('<final_output>{"a": "x"}</final_output>', { a: E('x'), b: E('y') }, ['a', 'b']);
  assert.deepEqual(two, { covered: true, pass: false });
  assert.deepEqual(upstreamVerdict('<final_output>{"A": "X", "b": "Y"}</final_output>', { a: E('x'), b: E('y') }, ['a', 'b']), { covered: true, pass: true });
});

test('strict: every column, no containment, numbers by value, nulls only with nulls', () => {
  const s = (t, exp) => strictVerdict(t, { decision: exp }, ['decision']).pass;
  assert.equal(s('<final_output>{"decision": "not approved"}</final_output>', E('Approved')), false);
  assert.equal(s('<final_output>{"decision": " APPROVED "}</final_output>', E('approved')), true);
  assert.equal(s('<final_output>{"decision": "class-3"}</final_output>', E('Class_3')), true);
  assert.equal(s('<final_output>{"decision": 5}</final_output>', E('5.0')), true);
  assert.equal(s('<final_output>{"decision": "-5"}</final_output>', E('5')), false);
  assert.equal(s('<final_output>{"decision": null}</final_output>', E('nan', true)), true);
  assert.equal(s('<final_output>{"decision": ["approved"]}</final_output>', E('approved')), false);
  assert.equal(s('<final_output>{"decision": "a"}</final_output>\n<final_output>{"decision": "b"}</final_output>', E('b')), true); // last block wins
  assert.equal(s('<FINAL_OUTPUT>{"Decision": "b"}</FINAL_OUTPUT>', E('b')), true);
  assert.equal(lastFinalOutput('<final_output>{"a": 1,}</final_output>').ok, false);
});

// ---- split ---------------------------------------------------------------------------------------------------------
test('split: deterministic, disjoint, complete; dev rows at most 20 and at most a quarter', () => {
  for (const n of [8, 30, 66, 90, 274]) {
    const a = splitOne('x', n), b = splitOne('x', n);
    assert.deepEqual(a, b);
    const all = [...a.build, ...a.repair, ...a.sealed].sort((x, y) => x - y);
    assert.deepEqual(all, Array.from({ length: n }, (_, i) => i));
    assert.equal(a.build.length, 5);
    assert.equal(a.repair.length, repairCount(n));
    assert.ok(a.build.length + a.repair.length <= 20 && (n < 28 || a.build.length + a.repair.length <= n / 4));
  }
  assert.notDeepEqual(splitOne('x', 90), splitOne('y', 90));
});

test('split: tampering is detected; sealed rows need --sealed and a freeze naming this split', () => {
  const dir = tmp('split');
  const s = makeSplit({ toy: { n: 30, output_columns: ['d'], testFileSha256: 'x', rowHashes: Array.from({ length: 30 }, (_, i) => String(i)) } });
  const f = path.join(dir, 'SPLIT.json');
  writeJson(f, s);
  const ok = loadSplit(f);
  const sealed = ok.sops.toy.sealed[0], dev = ok.sops.toy.build[0];
  assert.doesNotThrow(() => assertRows(ok, 'toy', [dev]));
  assert.throws(() => assertRows(ok, 'toy', [sealed]), /sealed/);
  assert.throws(() => assertRows(ok, 'toy', [sealed], { sealed: true }), /freeze/);
  const fz = path.join(dir, 'freeze.json');
  writeJson(fz, { kind: 'sopbench-freeze', splitSha256: 'other', sops: ['toy'] });
  assert.throws(() => assertRows(ok, 'toy', [sealed], { sealed: true, freeze: fz }), /freeze/);
  writeJson(fz, { kind: 'sopbench-freeze', splitSha256: ok.splitSha256, sops: ['toy'] });
  assert.doesNotThrow(() => assertRows(ok, 'toy', [sealed], { sealed: true, freeze: fz }));
  // move one sealed row into build: the list hash breaks
  const bad = JSON.parse(JSON.stringify(s));
  bad.sops.toy.build = [...bad.sops.toy.build, sealed].sort((a, b) => a - b);
  writeJson(f, bad);
  assert.throws(() => loadSplit(f), /sha256/);
  // and recomputing the list hash still breaks the split hash
  bad.sops.toy.buildSha256 = shaCanon(bad.sops.toy.build);
  writeJson(f, bad);
  assert.throws(() => loadSplit(f), /splitSha256/);
});

test('prompts: upstream wording, the SOP, the task lines and the exact output keys; tools by Bash client', () => {
  const u = userPrompt('STEP 1: do X', 'item_id: I-0', ['final status', 'b']);
  assert.match(u, /^Please follow this Standard Operating Procedure to process the given task:/);
  assert.match(u, /<sop>\nSTEP 1: do X\n<\/sop>/);
  assert.match(u, /Task to process:\nitem_id: I-0/);
  assert.match(u, /"final status", "b"/);
  const sp = systemPrompt([{ name: 'get_item', description: 'd', input_schema: {} }], 10);
  assert.match(sp, /node tool\.mjs call/);
  assert.match(sp, /at most 10 steps/);
  assert.deepEqual(policyAnswer('gaming', { output_columns: ['d'], expected: { d: E('ship') } }, { d: ['backorder', 'review', 'ship'] }), { d: 'backorder / review / ship' });
});

// ---- tool client -----------------------------------------------------------------------------------------------------
test('tool.mjs: call and batch go through the mailbox; list reads tools.json', async () => {
  const w = tmp('client');
  materializeWorkdir(w, [{ name: 'get_item', description: 'd', input_schema: {} }]);
  const box = path.join(w, '.tools');
  const t = setInterval(() => {
    for (const f of readdirSync(box)) {
      const m = /^req-(\d+)\.json$/.exec(f);
      if (!m || existsSync(path.join(box, `res-${m[1]}.json`))) continue;
      const req = JSON.parse(readFileSync(path.join(box, f), 'utf8'));
      writeFileSync(path.join(box, `res-${m[1]}.tmp`), JSON.stringify({ results: req.calls.map(c => ({ name: c.name, content: `echo ${c.arguments}` })) }));
      renameSync(path.join(box, `res-${m[1]}.tmp`), path.join(box, `res-${m[1]}.json`));
    }
  }, 20);
  const run = args => new Promise(res => { const c = spawn(process.execPath, ['tool.mjs', ...args], { cwd: w }); let o = ''; c.stdout.on('data', d => { o += d; }); c.on('close', code => res({ code, o })); });
  try {
    assert.match((await run(['list'])).o, /get_item/);
    assert.equal((await run(['call', 'get_item', '{"item_id": "I-0"}'])).o.trim(), 'echo {"item_id": "I-0"}');
    assert.match((await run(['batch', '[{"name": "get_item", "arguments": {"item_id": "I-1"}}]'])).o, /### result 1: get_item\necho {"item_id":"I-1"}/);
  } finally { clearInterval(t); }
  assert.equal(readFileSync(path.join(w, 'tool.mjs'), 'utf8'), readFileSync(TOOL_CLIENT, 'utf8'));
});

// ---- bridge on the toy fixture -----------------------------------------------------------------------------------------
async function toySplit(dir) {
  const r = await bridgeOk(['rows'], { liveDir: dir, dataDir: FIXTURE, withSplit: false });
  const rows = JSON.parse(r.stdout.split('\n').filter(l => l.startsWith('{')).pop());
  const s = makeSplit(rows, { createdAt: '2026-10-21' });
  const f = path.join(dir, 'SPLIT.json');
  writeJson(f, s);
  return { split: s, file: f };
}
const keyOf = rid => `I-${rid}`; // the fixture's key column (item_id) is I-<row>

test('bridge: prepare refuses a sealed row; a dev row gets task.json and a separate host-only expected.json', { skip: SKIP }, async () => {
  const dir = tmp('prep');
  const { split, file } = await toySplit(dir);
  const dev = split.sops.toy_sop.build[0], sealed = split.sops.toy_sop.sealed[0];
  const refused = await runBridge(['prepare', '--sop', 'toy_sop', '--rows', String(sealed), '--out', path.join(dir, 'p1')], { liveDir: dir, dataDir: FIXTURE, split: file });
  assert.equal(refused.code, 3);
  assert.match(refused.stdout, /sealed/);
  assert.equal(existsSync(path.join(dir, 'p1')), false);
  await bridgeOk(['prepare', '--sop', 'toy_sop', '--rows', String(dev), '--out', path.join(dir, 'p2')], { liveDir: dir, dataDir: FIXTURE, split: file });
  const task = readJson(path.join(dir, 'p2', 'rows', String(dev), 'task.json'));
  assert.deepEqual(Object.keys(task.inputs), ['item_id']);
  assert.equal(task.task_text, `item_id: ${keyOf(dev)}`);
  assert.equal(JSON.stringify(task).includes('"decision":'), false);
  const exp = readJson(path.join(dir, 'p2', 'rows', String(dev), 'expected.json'));
  assert.ok(['ship', 'review', 'backorder'].includes(exp.expected.decision.str));
  assert.deepEqual(readJson(path.join(dir, 'p2', 'catalog.json')).map(t => t.name), ['get_item', 'count_np', 'stub_tool']);
});

test('bridge replay: the dev world hides sealed rows; unknown tools and unencodable results are non-fatal but flagged; step limit', { skip: SKIP }, async () => {
  const dir = tmp('replay');
  const { split, file } = await toySplit(dir);
  const dev = split.sops.toy_sop.build[0], sealed = split.sops.toy_sop.sealed[0];
  const c = (name, args) => ({ name, arguments: JSON.stringify(args) });
  const steps = [{ calls: [c('get_item', { item_id: keyOf(dev) }), c('get_item', { item_id: keyOf(sealed) }), c('nope', {}), c('count_np', { item_id: keyOf(dev) }), c('stub_tool', { item_id: 'x' })] },
    { calls: [c('get_item', { item_id: keyOf(dev) })] }, { calls: [c('get_item', { item_id: keyOf(dev) })] }];
  writeJson(path.join(dir, 'steps.json'), steps);
  const r = await bridgeOk(['replay', '--sop', 'toy_sop', '--row', String(dev), '--host', path.join(dir, 'host'), '--steps', path.join(dir, 'steps.json'), '--max-steps', '2'], { liveDir: dir, dataDir: FIXTURE, split: file });
  const out = JSON.parse(r.stdout.split('\n').filter(l => l.startsWith('{')).pop());
  assert.equal(out.steps, 2);
  const [first, second, third] = out.results;
  assert.match(first.results[0].content, new RegExp(`"item_id": "${keyOf(dev)}"`));
  assert.match(first.results[1].content, /^Error: No item found with ID/); // a sealed row's key: absent from the dev world
  assert.match(first.results[2].content, /^Error: Tool 'nope' not found/);
  assert.match(first.results[3].content, /^\d+$/); // numpy int64 encoded for the agent ...
  assert.equal(first.results[4].content, 'null');
  assert.ok(second.results);
  assert.match(third.error, /step limit/);
  const calls = readFileSync(path.join(dir, 'host', 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.equal(calls.filter(x => x.upstreamFatal).length, 2); // ... but flagged: upstream's agent would have died (unknown tool, json.dumps)
  assert.equal(calls.filter(x => x.refused === 'step limit').length, 1);
  // with --sealed and a freeze naming this split the full world is served
  const fz = path.join(dir, 'freeze.json');
  writeJson(fz, { kind: 'sopbench-freeze', splitSha256: split.splitSha256, sops: ['toy_sop'] });
  writeJson(path.join(dir, 'steps2.json'), [{ calls: [c('get_item', { item_id: keyOf(sealed) })] }]);
  const r2 = await bridgeOk(['replay', '--sop', 'toy_sop', '--row', String(sealed), '--host', path.join(dir, 'host2'), '--steps', path.join(dir, 'steps2.json'), '--sealed', '--freeze', fz], { liveDir: dir, dataDir: FIXTURE, split: file });
  assert.match(r2.stdout, new RegExp(`\\\\"item_id\\\\": \\\\"${keyOf(sealed)}\\\\"`));
  const r3 = await runBridge(['replay', '--sop', 'toy_sop', '--row', String(sealed), '--host', path.join(dir, 'host3'), '--steps', path.join(dir, 'steps2.json'), '--sealed'], { liveDir: dir, dataDir: FIXTURE, split: file });
  assert.equal(r3.code, 3);
});

test('bridge serve: the mailbox refuses a planted symlink request and answers real ones', { skip: SKIP }, async () => {
  const dir = tmp('serve');
  const { split, file } = await toySplit(dir);
  const dev = split.sops.toy_sop.build[0];
  const w = path.join(dir, 'w');
  materializeWorkdir(w, []);
  const secret = path.join(dir, 'secret.txt');
  writeFileSync(secret, 'host secret');
  const b = startServe({ liveDir: dir, sop: 'toy_sop', row: dev, mailbox: path.join(w, '.tools'), hostDir: path.join(dir, 'host'), dataDir: FIXTURE, split: file });
  await b.ready;
  symlinkSync(secret, path.join(w, '.tools', 'req-1.json'));
  const out = await new Promise(res => { const c = spawn(process.execPath, ['tool.mjs', 'call', 'get_item', JSON.stringify({ item_id: keyOf(dev) })], { cwd: w }); let o = ''; c.stdout.on('data', d => { o += d; }); c.on('close', () => res(o)); });
  assert.match(out, new RegExp(keyOf(dev)));
  for (let i = 0; i < 50 && !existsSync(path.join(w, '.tools', 'res-1.json')); i++) await new Promise(r => setTimeout(r, 50));
  assert.match(readFileSync(path.join(w, '.tools', 'res-1.json'), 'utf8'), /refused: not a regular file/);
  const done = await b.stop();
  assert.equal(done.steps, 1);
});

test('run: scripted oracle scores 100% on both metrics; gaming passes upstream and fails strict; JS and Python agree', { skip: SKIP }, async () => {
  const dir = tmp('run');
  const { file } = await toySplit(dir);
  const go = policy => runRows({ policy, split: file, dataDir: FIXTURE, liveRoot: path.join(dir, policy), outDir: null, concurrency: 2, log: () => {} });
  const o = await go('oracle');
  assert.equal(o.summary.n, 5);
  assert.equal(o.summary.upstream.micro, 1);
  assert.equal(o.summary.strict.micro, 1);
  assert.equal(o.summary.scorer.jsUpstreamAgree, 5);
  const g = await go('gaming');
  assert.equal(g.summary.upstream.micro, 1);
  assert.equal(g.summary.strict.micro, 0);
  for (const p of ['wrong', 'empty']) {
    const x = await go(p);
    assert.equal(x.summary.upstream.micro, 0, p);
    assert.equal(x.summary.strict.micro, 0, p);
  }
  // every scripted session used the tools through the mailbox (unknown-tool path included) and stayed within the dev world
  assert.ok(o.results.every(r => r.world.calls >= 2 && r.world.unknownTool === 1));
});

test('canon matches the bridge canonical JSON', { skip: SKIP }, async () => {
  const dir = tmp('canon');
  const { split, file } = await toySplit(dir);
  // the Python side verified the same hashes when it loaded the split (load_split); a tampered file is refused there too
  const bad = JSON.parse(readFileSync(file, 'utf8'));
  bad.sops.toy_sop.repair = [...bad.sops.toy_sop.repair, bad.sops.toy_sop.sealed[0]];
  writeJson(file, bad);
  const r = await runBridge(['prepare', '--sop', 'toy_sop', '--rows', String(split.sops.toy_sop.build[0]), '--out', path.join(dir, 'p')], { liveDir: dir, dataDir: FIXTURE, split: file });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /does not match its sha256/);
  assert.equal(canon({ b: [1, 2], a: { d: 'x', c: null } }), '{"a":{"c":null,"d":"x"},"b":[1,2]}');
});

test('sealed run (toy SOP): refused without a valid freeze; with one, both arms run k times on sealed rows, are graded, analysed and decided', { skip: SKIP }, async () => {
  const { sealedRun, verifyFreeze } = await import('../sealed.mjs');
  const { artifactFiles, artifactSha256 } = await import('../exec.mjs');
  const dir = tmp('sealed');
  const { split, file } = await toySplit(dir);
  const wf = path.join(HERE, 'test/fixtures/reference/toy_sop');
  const files = artifactFiles(wf);
  const fz = path.join(dir, 'freeze.json');
  const freeze = { kind: 'sopbench-freeze', splitSha256: split.splitSha256, sops: ['toy_sop'], k: 2,
    rows: { toy_sop: { n: split.sops.toy_sop.sealed.length, sealedSha256: split.sops.toy_sop.sealedSha256 } },
    artifacts: { toy_sop: { dir: wf, sha256: artifactSha256(files) } },
    arms: { W: { judgeModels: ['claude-haiku-5-5'], budgetUsdPerRun: 0.05, timeoutMs: 120000, maxSteps: 40, buildCostUsd: 0 },
      A: { model: 'claude-haiku-5-5', budgetUsd: 0.25, maxSteps: 10, timeoutMin: 5, effort: null, tools: ['Bash'] } }, code: {} };
  writeJson(fz, { ...freeze, artifacts: { toy_sop: { dir: wf, sha256: 'not-it' } } });
  assert.throws(() => verifyFreeze(fz, { split: loadSplit(file), checkCode: false, root: '/' }), /artifact toy_sop/);
  writeJson(fz, freeze);
  // A scripted "agent": always answers ship (no model).
  // It writes a minimal transcript, which the host audit (L5) requires of every agent session.
  const runner = async ({ workdir }) => {
    const text = '<final_output>{"decision": "ship"}</final_output>';
    writeFileSync(path.join(workdir, '.executor-transcript.jsonl'), [{ type: 'assistant', message: { id: 'm1', model: 'claude-haiku-5-5', content: [{ type: 'text', text }] } },
      { type: 'result', subtype: 'success', num_turns: 1, result: text, modelUsage: { 'claude-haiku-5-5': {} } }].map(e => JSON.stringify(e)).join('\n') + '\n');
    return { ok: true, error: null, result: text, costUsd: 0, costUnknown: false, costUpperUsd: 0, turns: 1, durationMs: 1, toolUses: [] };
  };
  const { summary, stopped } = await sealedRun({ freeze: fz, runId: `toy-${Date.now()}`, capUsd: 1, split: file, dataDir: FIXTURE, checkCode: false, root: '/', runner, noModels: true,
    rowsRoot: path.join(dir, 'rows'), outDir: null, concurrency: 2, log: () => {} });
  assert.equal(stopped, null);
  const n = split.sops.toy_sop.sealed.length;
  assert.equal(summary.runs, n * 2 * 2);
  assert.equal(summary.analysis.arms.W.macroPassK, 1);             // the toy workflow is right on every sealed row, twice
  const ships = split.sops.toy_sop.sealed.filter(r => [0, 3, 6, 7].includes(r)).length;   // rows whose decision is ship
  assert.equal(summary.analysis.arms.A.macroPassK, ships / n);
  assert.equal(summary.graderDisagreements, 0);
  assert.equal(typeof summary.decision.beatsAgent, 'boolean');
});
