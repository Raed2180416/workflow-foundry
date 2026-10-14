// flow-v3 slice 2b: agent nodes (design/FLOW-V3-SLICE2.md §9). Part 1: the host's agent request (call-host.mjs handleAgent)
// in process: the refusal table, the concurrency cap, void and failed results, the stall watchdog, harvest, journal replay,
// and the code-execution scan of registry entries. Part 2: flow.agent end to end over the real gateway against W-bed R5
// (beds/wbed/r5) with a stub subagent that writes the truth, a wrong decode or nothing; the verify is R5's own
// verifyPredicate plus the trailer-quote check, run in the parent. Part 3: the real runner (agentNodeRunner) with a stand-in
// runClaudeCode. No model calls; $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MODEL_TOOL } from '../../c0/construct.mjs';
import { startServices, Ledger } from '../../lib/services.mjs';
import { createRegistry, createCallHost, CALL_MODEL, FLOW_V3, REFUSALS } from '../call-host.mjs';
import { agentNodeRunner, agentPrompt, codeExecutionOf, filesClusterOf, fileRoleOf, harvestedTracesOf, subCompileGroups, AGENT_REFUSALS, agentFilesProblem } from '../agent-node.mjs';
import { caseFiles } from '../compile.mjs';
import * as R5 from '../../../beds/wbed/r5/index.mjs';
import { buildDump } from '../../../beds/wbed/r5/world.mjs';
import { decodeStage, verifyPredicate } from '../../../beds/wbed/r5/decode.mjs';

const HAIKU = 'claude-haiku-5-5';
const tmp = (t, p = 'jit-agent-') => { const d = mkdtempSync(path.join(tmpdir(), p)); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const STUB_POLICY = { models: [{ id: HAIKU, provider: 'p', price: { inputPerMTok: 0, outputPerMTok: 0 } }] };
const stubModelPort = () => ({ policy: STUB_POLICY, providers: {}, policyHash: 'stub', async call(r) { return { ok: true, value: { text: 'x' }, costUsd: 0.01, modelId: r.modelId }; } });
const RETURNS = { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } };
const req = (extra = {}) => ({ v: 1, op: 'agent', name: 'node', span: 'agent:node#0', attempt: 0, instructions: 'Count the lines.', files: { 'a.txt': 'x\ny\n' }, returns: RETURNS, budgetUsd: 0.3, ...extra });
const hostWith = (agent, opts = {}) => {
  const host = createCallHost({ registry: createRegistry(), mode: 'stub', modelPort: stubModelPort(), agent: agent === null ? null : { models: [HAIKU], model: HAIKU, ...agent }, ...opts });
  host.port({ budgetUsd: opts.budgetUsd ?? 1 });
  return host;
};

// ---------------------------------------------------------------------------------------------- part 1: the host
test('host: the agent refusal table (each check in order), and every code is a listed agent refusal', async () => {
  const runner = async () => ({ answer: { n: 2 }, costUsd: 0.05 });
  const cases = [
    [hostWith({ runner }), { instructions: '' }, 'bad-request'],
    [hostWith({ runner }), { returns: undefined }, 'no-returns'],
    [hostWith({ runner }), { returns: { type: 'object', properties: { a: { type: 'string', pattern: '^a' } } } }, 'no-returns'],   // untrusted regexps are not run
    [hostWith(null), {}, 'no-agent-runner'],
    [hostWith({ runner }), { model: 'claude-opus-5-5' }, 'model-not-in-policy'],
    [hostWith({ runner }), { tools: ['Bash', 'Task'] }, 'tool-not-allowed'],
    [hostWith({ runner }), { tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'] }, 'tool-not-allowed'],   // at most 5
    [hostWith({ runner }), { files: { '../etc/passwd': 'x' } }, 'bad-files'],
    [hostWith({ runner, textLabel: 'third-party' }), {}, 'third-party-text'],
    [hostWith({ runner }), { budgetUsd: 0.05 }, 'BUDGET_TOO_SMALL'],
    [hostWith({ runner }), { budgetUsd: 1 }, 'budget-exceeds-parent'],
  ];
  for (const [host, extra, want] of cases) {
    const r = await host.request(req(extra));
    assert.equal(r.status, 'refused', want); assert.equal(r.refused, want, JSON.stringify(r.detail));
    assert.ok(AGENT_REFUSALS.includes(want));
    assert.equal(host.events.at(-1).kind, 'agent-refused'); assert.equal(host.events.at(-1).op, 'agent');
  }
  // per-run limit, and a node one level too deep (a child of a child: depth 2 > maxDepth 1)
  const one = hostWith({ runner, maxPerRun: 1 });
  assert.equal((await one.request(req())).status, 'ok');
  assert.equal((await one.request(req({ name: 'other', span: 'agent:other#0' }))).refused, 'per-run-limit');
  const registry = createRegistry();
  const inner = registry.register({ contract: { output: { type: 'object' } }, stub: async (input, ctx) => ({ output: await ctx.agent(req()) }) });
  const outer = registry.register({ contract: { output: { type: 'object' } }, stub: async (input, ctx) => ({ output: await ctx.call({ v: 1, op: 'call', callee: inner.hash, input: {}, name: 'inner', budgetUsd: 0.5 }) }) });
  const deep = createCallHost({ registry, mode: 'stub', modelPort: stubModelPort(), agent: { runner, models: [HAIKU], model: HAIKU } });
  deep.port({ budgetUsd: 2 });
  const top = await deep.request({ v: 1, op: 'call', callee: outer.hash, input: {}, name: 'outer', budgetUsd: 1 });
  assert.equal(top.status, 'ok');
  assert.equal(top.output.output.refused, 'depth', 'the grandchild may not own an agent node');
  assert.ok(!REFUSALS.includes('no-returns') && REFUSALS.includes('executes-code'));
});

test('host: at most two nodes run at once (later ones wait); void (nested model, hidden path), failed (no answer, returns schema); totals', async () => {
  let running = 0, peak = 0;
  const slow = async ({ instructions }) => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 30)); running--;
    if (instructions.includes('nested')) return { answer: { n: 1 }, costUsd: 0.02, nestedModelAttempts: 1 };
    if (instructions.includes('hidden')) return { answer: { n: 1 }, costUsd: 0.02, hiddenPathAttempts: 2 };
    if (instructions.includes('nothing')) return { answer: null, costUsd: 0.02, error: { code: 'EXECUTOR_BUDGET' } };
    if (instructions.includes('wrong')) return { answer: { n: 'two' }, costUsd: 0.02 };
    return { answer: { n: 2 }, costUsd: 0.02 }; };
  const host = hostWith({ runner: slow }, { budgetUsd: 3 });
  const names = ['ok1', 'ok2', 'nested', 'hidden', 'nothing', 'wrong'];
  const rs = await Promise.all(names.map(n => host.request(req({ name: n, span: `agent:${n}#0`, instructions: `do ${n}`, budgetUsd: 0.2 }))));
  assert.equal(peak, 2, 'the concurrency cap');
  assert.deepEqual(rs.map(r => r.status), ['ok', 'ok', 'void', 'void', 'failed', 'failed']);
  assert.deepEqual(rs.map(r => r.void ?? r.error?.code ?? null), [null, null, 'nested-model', 'hidden-path', 'EXECUTOR_BUDGET', 'RETURNS_SCHEMA']);
  assert.deepEqual(rs[0].output, { n: 2 });
  assert.deepEqual(host.totals().agents, { nodes: 6, ok: 2, void: 2, failed: 2, refused: 0, spentUsd: 0.12, harvested: 0, stalls: 0 });
  assert.equal(host.totals().childCalls, 0, 'agent nodes are not counted as child calls');
});

test('host: the stall watchdog aborts a node with no activity for stallMs and restarts it once inside the same reservation', async () => {
  let calls = 0;
  const runner = async ({ signal, progress, budgetUsd }) => {
    calls++;
    if (calls === 1) { await new Promise(r => signal.addEventListener('abort', r, { once: true })); return { answer: null, costUsd: 0.04, error: { code: 'EXECUTOR_TIMEOUT' } }; }
    for (let i = 0; i < 4; i++) { progress(); await new Promise(r => setTimeout(r, 10)); }
    return { answer: { n: Math.round(budgetUsd * 100) }, costUsd: 0.03 };
  };
  const host = hostWith({ runner, stallMs: 40 });
  const r = await host.request(req({ stallMs: 40 }));
  assert.equal(r.status, 'ok'); assert.deepEqual(r.output, { n: 26 }, 'the restart gets what the stalled run left of the reservation ($0.30 - $0.04)');
  assert.equal(r.agent.stalled, 1); assert.equal(r.agent.restarts, 1); assert.equal(r.spentUsd, 0.07);
  calls = 0;
  const never = hostWith({ runner: async ({ signal }) => { await new Promise(r => signal.addEventListener('abort', r, { once: true })); return { answer: null, costUsd: 0.01 }; }, stallRestarts: 1 });
  const s = await never.request(req({ stallMs: 30 }));
  assert.equal(s.status, 'failed'); assert.equal(s.error.code, 'STALLED'); assert.equal(s.agent.stalled, 2); assert.equal(s.agent.restarts, 1);
});

test('host: harvest of an ok node (scripts, task, answer) and the sub-compile inputs; journal replay at $0; a retry is a new key', async t => {
  const dir = tmp(t);
  let runs = 0;
  const runner = async ({ files }) => { runs++; return { answer: { n: Object.keys(files).length }, costUsd: 0.05, turns: 7, transcriptSha256: 'ab'.repeat(32),
    scripts: [{ path: 'decode.mjs', text: 'console.log(1)\n', bytes: 15, source: 'workdir' }] }; };
  const files = { 'dump/README.TXT': 'layout', 'dump/INV2024.DAT': 'rows' };
  const host = createCallHost({ registry: createRegistry(), mode: 'sandbox', workRoot: dir, modelPort: stubModelPort(), agent: { runner, models: [HAIKU], model: HAIKU } });
  host.port({ budgetUsd: 1 });
  const r = await host.request(req({ files }));
  assert.equal(r.status, 'ok'); assert.equal(r.agent.harvested, 1); assert.equal(r.agent.turns, 7);
  const ev = host.events.at(-1);
  assert.equal(ev.kind, 'agent-end'); assert.equal(ev.outcome, 'ok'); assert.equal(ev.cluster, 'INV9.DAT|README.TXT'); assert.ok(ev.harvestFile && existsSync(path.join(dir, ev.harvestFile)));
  assert.ok(ev.outputFile, 'the node value is kept by digest (the decode-dump hand-off a bed scores)');
  const h = JSON.parse(readFileSync(path.join(dir, ev.harvestFile), 'utf8'));
  assert.deepEqual(h.files, files); assert.equal(h.scripts[0].path, 'decode.mjs'); assert.match(h.scripts[0].sha256, /^[0-9a-f]{64}$/);
  // Only attempts whose parent verify passed become sub-compile traces.
  const solverTraces = [{ kind: 'agent-end', ok: true, key: r.key }];
  const traces = harvestedTracesOf({ hostEvents: host.events, solverTraces, workRoot: dir });
  assert.equal(traces.length, 1); assert.deepEqual(traces[0].task.inputs.files, files); assert.deepEqual(traces[0].answer, { n: 2 });
  assert.equal(harvestedTracesOf({ hostEvents: host.events, solverTraces: [], workRoot: dir }).length, 0, 'unverified attempts are not compile inputs');
  const groups = subCompileGroups([traces[0], { ...traces[0], traceId: 'agent-2' }], { minTraces: 2 });
  assert.equal(groups.length, 1); assert.equal(groups[0].cluster, 'INV9.DAT|README.TXT'); assert.deepEqual(groups[0].contract.output, RETURNS);
  const cf = caseFiles(groups[0].traces);
  assert.ok(cf['traces/trace-0/agent-work.md'].includes('decode.mjs'), 'the harvested script reaches the builder as agent work');
  // Replay: a later host given this host's journal serves the node at $0 without running it; a retry (attempt 1) runs.
  const replay = createCallHost({ registry: createRegistry(), mode: 'stub', modelPort: stubModelPort(), journal: host.journalRows(), agent: { runner, models: [HAIKU], model: HAIKU } });
  replay.port({ budgetUsd: 1 });
  const again = await replay.request(req({ files }));
  assert.equal(again.memo, 'replay'); assert.equal(again.spentUsd, 0); assert.deepEqual(again.output, { n: 2 }); assert.equal(runs, 1);
  const retry = await replay.request(req({ files, attempt: 1, retryReason: 'count 2 != 3' }));
  assert.equal(retry.memo, undefined); assert.equal(runs, 2); assert.notEqual(retry.key, again.key);
});

test('codeExecutionOf flags ways to run handed-in code; the registry records them and the host refuses executes-code', async t => {
  assert.deepEqual(codeExecutionOf("import { createFlow } from './tools/flow.mjs';\nconst x = /a/.exec(s);\nawait import('./tools/flow.mjs');").map(f => f.rule), []);
  const bad = ["import { execSync } from 'node:child_process';", "const m = await import('./files/dump/S1/decoder.mjs');", "import d from './files/dump/S1/decoder.mjs';",
    'const v = eval(src);', "const f = new Function('a', src);", "import vm from 'node:vm';"];
  assert.deepEqual(bad.map(s => codeExecutionOf(s)[0]?.rule), ['child_process', 'dynamic-import', 'import-of-input', 'eval', 'Function', 'vm']);
  const dir = tmp(t);
  writeFileSync(path.join(dir, 'solve.mjs'), "import { createFlow } from './tools/flow.mjs';\nconst { decode } = await import('./files/dump/' + 'decoder.mjs');\n");
  const registry = createRegistry({ dir });
  const e = registry.register({ solvePath: 'solve.mjs', contract: { output: { type: 'object' } } });
  assert.deepEqual(e.codeExec, [{ rule: 'dynamic-import', line: 2 }]);
  assert.equal(registry.list()[0].executesCode, true);
  const host = createCallHost({ registry, mode: 'sandbox', workRoot: dir, modelPort: stubModelPort() });
  host.port({ budgetUsd: 1 });
  const r = await host.request({ v: 1, op: 'call', callee: e.hash, input: {}, name: 'decoder', budgetUsd: 0.2 });
  assert.equal(r.refused, 'executes-code');
});

// flow-v3.mjs imports ./model.mjs beside it (the sandbox layout), so its helpers are loaded from a copy with the model tool.
async function sdk(t) {
  const dir = tmp(t, 'jit-agentsdk-');
  copyFileSync(FLOW_V3, path.join(dir, 'flow.mjs')); writeFileSync(path.join(dir, 'model.mjs'), MODEL_TOOL); writeFileSync(path.join(dir, 'gateway.json'), '{"url":"http://127.0.0.1:9","token":"x"}');
  return import(pathToFileURL(path.join(dir, 'flow.mjs')).href);
}
test('file roles, clusters, the files problem check and the SDK file resolution', async t => {
  const { resolveAgentFiles, verdictOf } = await sdk(t);
  assert.equal(fileRoleOf('dump/S3/ar_2024-06.csv'), 'ar_9-9.csv');
  assert.equal(filesClusterOf({ 'dump/col01.txt': '', 'dump/col02.txt': '', 'dump/MANIFEST.TXT': '' }), 'MANIFEST.TXT|col9.txt');
  assert.equal(agentFilesProblem({ 'a/b.txt': 'x' }), null); assert.match(agentFilesProblem({ '/abs': 'x' }), /unsafe/); assert.match(agentFilesProblem({ 'a.txt': 3 }), /not text/);
  const tf = { 'dump/S3/README.TXT': 'r', 'dump/S3/DATA.DAT': 'd', 'dump/S4/README.TXT': 'other' };
  assert.deepEqual(resolveAgentFiles(tf, { 'dump/': 'files/dump/S3/' }).files, { 'dump/DATA.DAT': 'd', 'dump/README.TXT': 'r' });
  assert.deepEqual(resolveAgentFiles(tf, { 'spec.txt': { text: 's' }, 'in/': 'dump/S4/README.TXT' }), { files: { 'spec.txt': 's', 'in/README.TXT': 'other' }, sources: { 'spec.txt': 'literal', 'in/README.TXT': 'task:dump/S4/README.TXT' } });
  assert.throws(() => resolveAgentFiles(tf, { 'dump/': 'dump/S9/' }), /no task file/);
  assert.throws(() => resolveAgentFiles(tf, { '../x': 'dump/S3/README.TXT' }), /unsafe/);
  assert.deepEqual(verdictOf(() => null), { ok: true, reasons: [] }); assert.deepEqual(verdictOf(() => 'record count 3 != trailer 4'), { ok: false, reasons: ['record count 3 != trailer 4'] });
  assert.deepEqual(verdictOf(() => ({ ok: false, reasons: ['a', 'b'] })), { ok: false, reasons: ['a', 'b'] }); assert.equal(verdictOf(() => { throw new Error('x'); }).ok, false);
  const p = agentPrompt({ instructions: 'Decode it.', returns: RETURNS, files: { 'dump/README.TXT': 'x' }, hasInputs: true, retryReason: 'record count 150 != trailer 148' });
  assert.match(p, /files\/ \(1: dump\/README.TXT\)/); assert.match(p, /record count 150 != trailer 148/); assert.match(p, /inputs\.json/);
});

// ---------------------------------------------------------------------------------------------- part 2: flow.agent on R5
const R5_TASK = { seed: 303, split: 'dev', difficulty: 3 };
const DECODE_RETURNS = { type: 'object', required: ['rows', 'trailer', 'trailer_quote'],
  properties: { rows: { type: 'array', items: R5.ROW_SCHEMA }, trailer: { type: 'object' }, trailer_quote: { type: 'string' } } };
const DECODE_URL = pathToFileURL(path.resolve(new URL('../../../beds/wbed/r5/decode.mjs', import.meta.url).pathname)).href;
// The parent solver (a stand-in for a compiled R5 reference): the dump pack's files go to an agent node; its verify is R5's
// verifyPredicate on the decoded rows and trailer plus the trailer quote occurring in a dump file (W-BED-R5-NOTES item 10).
const SOLVER = (opts = '') => `import { createFlow } from './tools/flow.mjs';
import { verifyPredicate } from '${DECODE_URL}';
const flow = createFlow({ budgetUsd: 1 });
const task = flow.input();
const [sub, pack] = Object.entries(task.inputs.subsidiaries).find(([, p]) => p.dump);
const out = await flow.agent('decode-dump', {
  instructions: task.inputs.dump_spec + '\\nReturn the rows, the trailer as {records, row_total, amounts, hash} and the trailer record verbatim as trailer_quote.',
  files: { 'dump/': pack.dump }, inputs: { sub_id: sub }, returns: ${JSON.stringify(DECODE_RETURNS)},
}, { verify: (o, ctx) => verifyPredicate(o.rows, o.trailer) ?? (ctx.text.includes(o.trailer_quote) ? null : 'trailer_quote is not in the dump'), budgetUsd: 0.4, minutes: 5 ${opts} });
flow.done(out.failed ? { failed: out } : { sub_id: sub, rows: out.rows.length });`;

async function runParent(t, { runner, opts = '' }) {
  const task = R5.generate(R5_TASK);
  const dir = tmp(t, 'jit-agentp-');
  mkdirSync(path.join(dir, 'tools'));
  const ledger = new Ledger({ capUsd: 1, label: 'root' });
  const host = createCallHost({ registry: createRegistry(), mode: 'stub', modelPort: stubModelPort(), agent: { runner, models: [HAIKU], model: HAIKU } });
  const svc = await startServices({ modelPort: host.port({ budgetUsd: 1, ledger }), ledger, allowedModels: [HAIKU] });
  writeFileSync(path.join(dir, 'tools/model.mjs'), MODEL_TOOL); copyFileSync(FLOW_V3, path.join(dir, 'tools/flow.mjs'));
  writeFileSync(path.join(dir, 'tools/gateway.json'), JSON.stringify({ url: svc.url, token: svc.token }));
  writeFileSync(path.join(dir, 'task.json'), JSON.stringify({ prompt: task.prompt, inputs: task.inputs, files: task.files }));
  writeFileSync(path.join(dir, 'solve.mjs'), SOLVER(opts));
  const child = spawn(process.execPath, ['solve.mjs', 'task.json'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  const code = await new Promise(resolve => child.on('close', resolve));
  await svc.close({ graceMs: 1000 });
  const deopt = existsSync(path.join(dir, 'deopt.json')) ? JSON.parse(readFileSync(path.join(dir, 'deopt.json'), 'utf8')) : null;
  const last = stdout.trim().split('\n').filter(Boolean).at(-1);
  return { task, code, stderr, trace: lines(path.join(dir, 'trace.jsonl')), deopt, output: last === undefined ? undefined : JSON.parse(last), host, ledger };
}
// The stub subagent: the truth, a wrong decode (the excluded records kept: R5's decoys-kept misreading, with the trailer
// read as the dump has it), or nothing. A trailer quote: the head of the last line of the largest dump file.
const world = () => buildDump(R5_TASK.seed, R5_TASK.split, R5_TASK.difficulty);
const quoteOf = files => { const big = Object.values(files).sort((a, b) => b.length - a.length)[0]; return big.trim().split('\n').at(-1).slice(0, 24); };
const decodeAs = (mistake, files) => { const d = decodeStage(world(), mistake); return { rows: d.rows, trailer: d.trailer, trailer_quote: quoteOf(files) }; };

test('flow.agent on R5: a stub subagent that writes the truth passes the parent-side verify; the node got only the dump and dump_spec (D10)', async t => {
  const seen = [];
  const runner = async a => { seen.push(a); return { answer: decodeAs(null, a.files), costUsd: 0.12, turns: 9, scripts: [{ path: 'decode.mjs', text: '// parser\n' }] }; };
  const r = await runParent(t, { runner });
  assert.equal(r.code, 0, r.stderr);
  const w = world();
  assert.deepEqual(r.output, { sub_id: w.sub.id, rows: w.rows.length });
  assert.equal(seen.length, 1);
  const dumpFiles = Object.keys(r.task.files).map(k => k.replace(`dump/${w.sub.id}/`, 'dump/')).sort();
  assert.deepEqual(Object.keys(seen[0].files).sort(), dumpFiles, 'exactly the dump directory');
  assert.deepEqual(seen[0].inputs, { sub_id: w.sub.id });
  assert.ok(!JSON.stringify(seen[0]).includes('ledger_spec'), 'no other pack data reaches the node');
  const start = r.trace.find(e => e.kind === 'agent-start'), end = r.trace.find(e => e.kind === 'agent-end');
  assert.equal(start.span, 'agent:decode-dump#0'); assert.equal(start.files, dumpFiles.length); assert.equal(start.attempt, 0);
  assert.equal(end.ok, true); assert.deepEqual(end.verify, { ok: true }); assert.equal(end.costUsd, 0.12); assert.equal(end.turns, 9); assert.equal(end.scripts, 1); assert.match(end.key, /^[0-9a-f]{64}$/);
  assert.equal(r.trace.at(-1).agentNodes, 1);
  const hostEnd = r.host.events.find(e => e.kind === 'agent-end');
  assert.equal(hostEnd.name, 'decode-dump'); assert.equal(hostEnd.outcome, 'ok'); assert.deepEqual(hostEnd.output.rows.length, w.rows.length, 'the decode hand-off under the node name');
  assert.equal(r.ledger.spentUsd, 0.12); assert.equal(r.ledger.reservedUsd, 0);
});

test('flow.agent on R5: a wrong decode fails R5\'s verify; the retry carries the reason and the corrected decode passes', async t => {
  const seen = [];
  const runner = async a => { seen.push(a); return { answer: a.retryReason ? decodeAs(null, a.files) : decodeAs('decoys-kept', a.files), costUsd: 0.1 }; };
  const r = await runParent(t, { runner });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(seen.length, 2);
  const want = verifyPredicate(decodeAs('decoys-kept', seen[0].files).rows, decodeAs('decoys-kept', seen[0].files).trailer);
  assert.match(want, /^record count \d+ != trailer \d+$/);
  assert.equal(seen[1].retryReason, want, 'the retry is told what failed (W-BED-R5-NOTES item 11)');
  assert.equal(seen[1].attempt, 1); assert.equal(seen[1].budgetUsd, 0.3, 'the retry gets what the node budget has left');
  const ends = r.trace.filter(e => e.kind === 'agent-end');
  assert.deepEqual(ends.map(e => [e.attempt, e.ok, e.status]), [[0, false, 'verify-failed'], [1, true, 'ok']]);
  assert.deepEqual(ends[0].verify, { ok: false, reasons: [want] });
  assert.equal(r.trace.filter(e => e.kind === 'agent-start')[1].retryReason, want);
  assert.equal(r.host.events.length, 2); assert.notEqual(r.host.events[0].key, r.host.events[1].key);
});

test('flow.agent on R5: a subagent that writes nothing, or the wrong decode twice, deopts the parent with kind agent; onFail skip returns the reasons', async t => {
  const none = await runParent(t, { runner: async () => ({ answer: null, costUsd: 0.05, error: { code: 'EXECUTOR_BUDGET' } }) });
  assert.equal(none.code, 75); assert.equal(none.deopt.kind, 'agent'); assert.equal(none.deopt.name, 'decode-dump');
  assert.equal(none.deopt.detail.attempts, 2); assert.deepEqual(none.deopt.detail.reasons, ['no typed answer (EXECUTOR_BUDGET)']); assert.equal(none.deopt.detail.spentUsd, 0.1);
  const wrong = await runParent(t, { runner: async a => ({ answer: decodeAs('totals-forced', a.files), costUsd: 0.05 }) });
  assert.equal(wrong.code, 75); assert.equal(wrong.deopt.kind, 'agent'); assert.match(wrong.deopt.detail.reasons[0], /^(amount total|row-id total|hash total)/, 'count forced to match: the totals catch it');
  const skip = await runParent(t, { runner: async () => ({ answer: null, costUsd: 0.05 }), opts: ", onFail: 'skip', retries: 0" });
  assert.equal(skip.code, 0, skip.stderr); assert.equal(skip.output.failed.failed, true); assert.equal(skip.output.failed.attempts, 1);
  const voided = await runParent(t, { runner: async a => ({ answer: decodeAs(null, a.files), costUsd: 0.05, nestedModelAttempts: 1 }), opts: ', retries: 0' });
  assert.equal(voided.code, 75); assert.deepEqual(voided.deopt.detail.reasons, ['void: nested-model'], 'a void result never reaches the verify');
});

test('flow.agent refusals reach the caller (BUDGET_TOO_SMALL from the host; bad-files from the SDK), deopting kind agent or returned with onRefuse skip', async t => {
  const runner = async () => ({ answer: null, costUsd: 0 });
  const task = R5.generate(R5_TASK);
  const dir = tmp(t, 'jit-agentr-');
  mkdirSync(path.join(dir, 'tools'));
  const ledger = new Ledger({ capUsd: 1, label: 'root' });
  const host = createCallHost({ registry: createRegistry(), mode: 'stub', modelPort: stubModelPort(), agent: { runner, models: [HAIKU], model: HAIKU } });
  const svc = await startServices({ modelPort: host.port({ budgetUsd: 1, ledger }), ledger, allowedModels: [HAIKU] });
  writeFileSync(path.join(dir, 'tools/model.mjs'), MODEL_TOOL); copyFileSync(FLOW_V3, path.join(dir, 'tools/flow.mjs'));
  writeFileSync(path.join(dir, 'tools/gateway.json'), JSON.stringify({ url: svc.url, token: svc.token }));
  writeFileSync(path.join(dir, 'task.json'), JSON.stringify({ prompt: task.prompt, inputs: task.inputs, files: task.files }));
  writeFileSync(path.join(dir, 'solve.mjs'), `import { createFlow } from './tools/flow.mjs';
const flow = createFlow({ budgetUsd: 1 }); flow.input();
const spec = { instructions: 'x', returns: { type: 'object' } }, verify = () => null;
const a = await flow.agent('tiny', { ...spec, files: { 'd/': 'dump/' } }, { verify, budgetUsd: 0.05, onRefuse: 'skip' });
const b = await flow.agent('missing', { ...spec, files: { 'd/': 'nowhere/' } }, { verify, budgetUsd: 0.2, onRefuse: 'skip' });
let c = null; try { await flow.agent('noverify', spec, { budgetUsd: 0.2 }); } catch (e) { c = e.message; }
flow.done({ a, b, c });`);
  const child = spawn(process.execPath, ['solve.mjs', 'task.json'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  const code = await new Promise(resolve => child.on('close', resolve));
  await svc.close({ graceMs: 1000 });
  assert.equal(code, 0, stderr);
  const out = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(out.a.refused, 'BUDGET_TOO_SMALL'); assert.equal(out.b.refused, 'bad-files'); assert.match(out.c, /no-verify/);
  const tr = lines(path.join(dir, 'trace.jsonl'));
  assert.deepEqual(tr.filter(e => e.kind === 'agent-refused').map(e => [e.name, e.refused, e.by ?? 'host']), [['tiny', 'BUDGET_TOO_SMALL', 'host'], ['missing', 'bad-files', 'sdk']]);
});

// ---------------------------------------------------------------------------------------------- part 3: the real runner
test('agentNodeRunner: one session with the node prompt, only the node files, the tool list and the signal; scans and harvest', async t => {
  const dir = tmp(t);
  let got = null;
  const run = async a => {
    got = a;
    for (const [rel, text] of Object.entries(a.files)) { mkdirSync(path.dirname(path.join(a.workdir, rel)), { recursive: true }); writeFileSync(path.join(a.workdir, rel), text); }
    writeFileSync(path.join(a.workdir, 'parse.mjs'), 'export const parse = s => s.split("\\n");\n');
    writeFileSync(path.join(a.workdir, 'answer.json'), JSON.stringify({ n: 2 }));
    writeFileSync(path.join(a.workdir, '.executor-transcript.jsonl'), '{"type":"result"}\n');
    return { costUsd: 0.07, costUnknown: false, turns: 5, error: null, toolUses: [{ name: 'Bash', input: { command: 'cat /home/user/secret.txt' } }, { name: 'Bash', input: { command: 'claude -p hi' } }] };
  };
  const runner = agentNodeRunner({ run, binary: 'fake-claude' });
  const ac = new AbortController();
  const r = await runner({ instructions: 'Count.', files: { 'dump/a.txt': 'x\ny' }, inputs: { k: 1 }, returns: RETURNS, model: HAIKU, tools: ['Bash', 'Read'], budgetUsd: 0.2, timeoutMs: 1000,
    workdir: path.join(dir, 'w'), signal: ac.signal, retryReason: 'n was 3' });
  assert.deepEqual(Object.keys(got.files).sort(), ['files/dump/a.txt', 'inputs.json']);
  assert.deepEqual(got.tools, ['Bash', 'Read']); assert.equal(got.signal, ac.signal); assert.equal(got.binary, 'fake-claude'); assert.match(got.prompt, /n was 3/);
  assert.deepEqual(r.answer, { n: 2 }); assert.equal(r.costUsd, 0.07); assert.equal(r.turns, 5); assert.match(r.transcriptSha256, /^[0-9a-f]{64}$/);
  assert.equal(r.hiddenPathAttempts, 1); assert.equal(r.nestedModelAttempts, 1);
  assert.deepEqual(r.scripts.map(s => s.path), ['parse.mjs'], 'the node\'s own script; files/ and inputs are never harvested');
});
