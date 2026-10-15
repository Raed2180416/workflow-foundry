// Slice 2a stream wiring, builder side (design/FLOW-V3-SLICE2.md §4; FLOW-V3-SLICE1 §3 items 1–2, 7): prompt version 5
// (flow-v3, the flow.call parts only with a library), compile.mjs FLOW_TOOL_V3 and library/index.json in the builder
// workdir, the builder's gateway and the host check calling library solvers through a call host, and the flow-v3 sha pin.
// The compile test runs a stand-in builder (as compile.test.mjs does) in the sandbox; no model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { runClaudeCode, sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ModelPort } from '../../../src/models/port.mjs';
import { Journal } from '../../../src/journal.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';
import { subsetPolicy } from '../../lib/models.mjs';
import { makeTasks } from '../../lib/beds.mjs';
import { builderPrompt, flowFileOf, FLOW_FILES, PROMPT_VERSIONS } from '../prompts.mjs';
import { compile, compileFiles, flowToolOf, FLOW_TOOL_V2, FLOW_TOOL_V3, LIBRARY_INDEX } from '../compile.mjs';
import { createRegistry } from '../call-host.mjs';

const sha = t => createHash('sha256').update(t).digest('hex');
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'];
const skip = sandboxAvailable() ? false : 'no user namespaces';
const OPTS = { traces: 3, regressions: 1, minutes: 30, gatewayUsd: 1.5, perTaskUsd: 1, models: MODELS };
const FLOW_V3_FILE = new URL('../flow-v3.mjs', import.meta.url).pathname;
// flow-v3.mjs as of the slice 2 review fixes (FLOW-V3-SLICE2 §17; slice 2b's was 161ac935…35f6, slice 2a's a67bcbb6…81c8): a
// prompt-version-5 arm's SDK bytes. Update this pin, and the E2 freeze record, whenever flow-v3.mjs changes.
const FLOW_V3_SHA256 = '15da5c24efd537afb30eb8754955583c735fb6f36e8c55ca3646c13aa848f06b';

test('prompt version 5: runs on flow-v3.mjs; without a library its text is version 4\'s byte for byte; with one it adds library/index.json, flow.call and method item 9 (inserted lines only)', () => {
  assert.deepEqual([...PROMPT_VERSIONS], [1, 2, 3, 4, 5]);
  assert.equal(FLOW_FILES[5], 'flow-v3.mjs'); assert.equal(flowFileOf({ promptVersion: 5 }), 'flow-v3.mjs'); assert.equal(flowFileOf({ promptVersion: 4 }), 'flow-v2.mjs');
  for (const kind of ['compile', 'recompile']) {
    const v4 = builderPrompt(kind, { ...OPTS, promptVersion: 4 }), v5 = builderPrompt(kind, { ...OPTS, promptVersion: 5 }), lib = builderPrompt(kind, { ...OPTS, promptVersion: 5, library: 2 });
    assert.equal(v5, v4, `${kind}: no library, no change`);
    assert.equal(builderPrompt(kind, { ...OPTS, promptVersion: 4, library: 2 }), v4, 'a library never changes a version 4 text');
    assert.match(lib, /- library\/index\.json: the library of solvers accepted for earlier tasks/);
    assert.match(lib, /await flow\.call\('sha256:…', subInput, \{ name: 'S2', budgetUsd: 0\.25, prompt: subTask\.prompt \}\)/);
    assert.match(lib, /^9\. library\/index\.json lists solvers already accepted/m);
    assert.match(lib, /onRefuse: 'interpret'/); assert.match(lib, /K calls at once need K times budgetUsd below your own budget/);
    // inserted lines only: every v4 line is still there, in order
    const L = lib.split('\n'); let at = 0;
    for (const line of v4.split('\n')) { const i = L.indexOf(line, at); assert.ok(i >= at, `v4 line kept in order: ${line.slice(0, 60)}`); at = i + 1; }
  }
});

test('compile.mjs: FLOW_TOOL_V3 for version 5; library/index.json only with a library index; a library needs version 5; the flow-v3 pin', async () => {
  assert.equal(sha(readFileSync(FLOW_V3_FILE)), FLOW_V3_SHA256, 'flow-v3.mjs is pinned (E2 freeze candidate, FLOW-V3-SLICE2 §8)');
  assert.equal(flowToolOf(5), FLOW_TOOL_V3); assert.equal(flowToolOf(4), FLOW_TOOL_V2); assert.equal(sha(FLOW_TOOL_V3), FLOW_V3_SHA256);
  assert.ok(FLOW_TOOL_V3.includes('async phase(name, fn)') && FLOW_TOOL_V3.includes("'interpret'"));
  const args = { outputSchema: { type: 'object' }, traces: [{ traceId: 't', task: { prompt: 'p', inputs: {} }, answer: {} }], gateway: { url: 'u', token: 'x' }, promptVersion: 5 };
  assert.equal(compileFiles(args)['tools/flow.mjs'], FLOW_TOOL_V3); assert.equal(LIBRARY_INDEX in compileFiles(args), false);
  const index = [{ hash: 'sha256:ab', contract: { output: { type: 'object' } } }];
  assert.deepEqual(JSON.parse(compileFiles({ ...args, libraryIndex: index })[LIBRARY_INDEX]), index);
  // compile() creates its workdir before this check, so the work root must be writable on a non-root host too.
  const workRoot = mkdtempSync(path.join(tmpdir(), 'slice2-lib-v4-'));
  try {
    await assert.rejects(compile({ familyId: 'records', traces: [{ traceId: 't', task: { prompt: 'p', inputs: {} } }], modelPort: portOf(), workRoot, label: 'x', models: MODELS,
      promptVersion: 4, library: createRegistry() }), /a library needs promptVersion 5/);
  } finally { rmSync(workRoot, { recursive: true, force: true }); }
});

const portOf = () => new ModelPort({ policy: subsetPolicy(loadPolicy().policy, MODELS), journal: new Journal(new DatabaseSync(':memory:')),
  providers: { 'claude-cli': new ScriptedProvider(() => ({ value: { pick: 'b' }, costUsd: 0.003 })) } });
// The library solver: one judge (scripted: pick b), returned as the typed output.
const LEAF = `import { createFlow } from './tools/flow.mjs';
const flow = createFlow({ budgetUsd: 0.2 });
const task = flow.input();
const v = await flow.judge('pick', { tiers: ['claude-haiku-5-5'], prompt: 'pick for ' + task.inputs.n, schema: { type: 'object', properties: { pick: { type: 'string' } }, required: ['pick'] } });
flow.done({ pick: v.pick });`;
// A stand-in builder: reads library/index.json, writes a flow-v3 solver that calls the library solver by hash, runs the
// builder-side check through the gateway (which is a call host), and notes the one disagreement.
const builder = `#!/opt/node24/bin/node
const fs = require('node:fs'), { execFileSync } = require('node:child_process');
fs.writeFileSync('.seen-prompt.txt', fs.readFileSync(0, 'utf8'));
fs.writeFileSync('.seen-files.json', JSON.stringify(fs.readdirSync('.', { recursive: true })));
const index = JSON.parse(fs.readFileSync('library/index.json', 'utf8'));
fs.writeFileSync('solve.mjs', [
  "import { createFlow } from './tools/flow.mjs';",
  "const flow = createFlow({ budgetUsd: 0.5 });",
  "const task = flow.input();",
  "const v = await flow.phase('library', () => flow.call('" + index[0].hash + "', { n: task.prompt.length }, { name: 'pick', budgetUsd: 0.2 }));",
  "flow.done({ promptChars: task.prompt.length, pick: v.pick });"].join('\\n'));
let out; try { out = execFileSync('/opt/node24/bin/node', ['tools/check-traces.mjs', '--only', '0'], { encoding: 'utf8' }); } catch (e) { out = 'ERR ' + e.message + (e.stdout ?? ''); }
fs.writeFileSync('.builder-check.txt', out);
fs.writeFileSync('BUILD-NOTES.md', 'Calls the library solver by hash. trace-2: the agent answer promptChars 1 contradicts the prompt length.');
const ev = o => process.stdout.write(JSON.stringify(o) + '\\n');
ev({ type: 'system', subtype: 'init', session_id: 'fake' });
ev({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.1, num_turns: 1, result: 'done', session_id: 'fake', usage: { input_tokens: 1, output_tokens: 1 } });
`;

test('sandboxed: a prompt-version-5 compile with a library: the builder sees library/index.json and flow-v3, its runs and the host check call the library solver through a call host, and the record says so', { skip }, async t => {
  const workRoot = mkdtempSync(path.join(tmpdir(), 'jit-s2c-')); t.after(() => rmSync(workRoot, { recursive: true, force: true }));
  writeFileSync(path.join(workRoot, 'leaf.mjs'), LEAF);
  const library = createRegistry({ dir: path.join(workRoot, 'library') });
  const leaf = library.register({ solvePath: path.join(workRoot, 'leaf.mjs'), contract: { output: { type: 'object', required: ['pick'], properties: { pick: { type: 'string' } } }, taskTemplate: 'Pick one.' },
    evidence: { familyId: 'records' } });
  const tasks = (await makeTasks('records', { split: 'dev', seeds: [1, 2, 3], difficulty: 1 })).map(x => x.task);
  const traces = tasks.map((task, i) => ({ traceId: `tr-${i}`, task, answer: i === 2 ? { promptChars: 1, pick: 'b' } : { promptChars: task.prompt.length, pick: 'b' }, scripts: [], commands: [] }));
  const runner = async opts => { const bin = path.join(opts.workdir, '.fake-claude'); writeFileSync(bin, builder); chmodSync(bin, 0o755); return runClaudeCode({ ...opts, binary: bin }); };
  const { record, workdir } = await compile({ familyId: 'records', traces, modelPort: portOf(), workRoot, label: 'v1', models: MODELS, promptVersion: 5, library, runner });
  const seen = JSON.parse(readFileSync(path.join(workdir, '.seen-files.json'), 'utf8'));
  assert.ok(seen.includes('library/index.json')); assert.equal(readFileSync(path.join(workdir, 'tools/flow.mjs'), 'utf8'), FLOW_TOOL_V3);
  assert.match(readFileSync(path.join(workdir, '.seen-prompt.txt'), 'utf8'), /library\/index\.json lists solvers/);
  assert.match(readFileSync(path.join(workdir, '.builder-check.txt'), 'utf8'), /"exact":1/, 'the builder\'s own run called the library through its gateway');
  assert.equal(record.promptVersion, 5); assert.equal(record.flowSha256, sha(FLOW_TOOL_V3));
  assert.equal(record.checkTraces.error, null, JSON.stringify(record.checkTraces.error)); assert.equal(record.checkTraces.accepted, true, JSON.stringify(record.checkTraces));
  assert.equal(record.checkTraces.exact, 2);
  assert.equal(record.library.entries, 1); assert.equal(record.library.indexSha256, sha(JSON.stringify(library.list(), null, 1)));
  assert.equal(record.library.checkCalls.childCalls, 3, 'one library call per case in the host check'); assert.equal(record.library.checkCalls.ends, 3);
  assert.ok(record.library.builderCalls.childCalls >= 1);
  assert.ok(Math.abs(record.checkCostUsd - 0.009) < 1e-9, `three leaf judges at $0.003, charged through the check ledger (${record.checkCostUsd})`);
  assert.equal(leaf.version, 1);
});
