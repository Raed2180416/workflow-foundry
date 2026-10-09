// compile() (SPEC §3) with a stand-in Claude Code binary inside the builder sandbox and a scripted model provider: the
// workdir assembly, the builder prompt, the record, and the independent host-side acceptance check. Integrity: no file
// in the compile workdir holds bed source, oracle or reference-solver code, or the hidden truth. No live model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, chmodSync, mkdtempSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ModelPort } from '../../../src/models/port.mjs';
import { Journal } from '../../../src/journal.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';
import { runClaudeCode, sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { subsetPolicy } from '../../lib/models.mjs';
import { makeTasks, loadFamily } from '../../lib/beds.mjs';
import { canonical } from '../../../beds/lib/canonical.mjs';
import { taskTexts } from '../acceptance.mjs';
import { MODEL_TOOL, BUDGET_TOOL } from '../../c0/construct.mjs';
import { compile, agentWork, caseFiles, compileFiles, hostCheck, FLOW_TOOL, FLOW_TOOL_V2, flowToolOf, CHECK_TOOL, COMPARE_TOOL, comparisonOf, JIT_RUN_SOLVER, SCRIPTS_CAP, COMMANDS_CAP } from '../compile.mjs';

const root = path.resolve(new URL('../../..', import.meta.url).pathname);
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'];
const sha = t => createHash('sha256').update(t).digest('hex');
const skip = sandboxAvailable() ? false : 'no user namespaces';

const portOf = () => {
  const provider = new ScriptedProvider(() => ({ value: { pick: 'b' }, costUsd: 0.003 }));
  return new ModelPort({ policy: subsetPolicy(loadPolicy().policy, MODELS), providers: { 'claude-cli': provider }, journal: new Journal(new DatabaseSync(':memory:')) });
};

// The compiled solver the stand-in builder writes: one judge per task, the rest from the task itself.
const SOLVE = `import { createFlow } from './tools/flow.mjs';
const flow = createFlow({ budgetUsd: 0.5 });
const task = flow.input();
const v = await flow.judge('pick', { tiers: ['claude-haiku-5-5', 'claude-sonnet-5-5'], prompt: 'pick one', schema: { type: 'object', properties: { pick: { type: 'string' } }, required: ['pick'] },
  check: v => (['a', 'b'].includes(v.pick) ? null : 'not a or b') });
flow.done({ promptChars: task.prompt.length, pick: v.pick });
`;
// A stand-in for the claude CLI (a node script; it runs inside the builder sandbox with the workdir as cwd). It records what
// the builder saw, writes solve.mjs, runs the builder-side check-traces through the loopback gateway, then tampers with a
// label and with the tools (the host-side check must not be moved by that) and prints stream-json events.
const fake = ({ writeSolve = true, notes }) => `#!/opt/node24/bin/node
const fs = require('node:fs'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
fs.writeFileSync('.seen-prompt.txt', fs.readFileSync(0, 'utf8'));
fs.writeFileSync('.seen-argv.json', JSON.stringify(process.argv.slice(2)));
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]));
fs.writeFileSync('.seen-files.json', JSON.stringify(Object.fromEntries(walk('.').sort().map(f => [f.slice(2), crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]))));
fs.writeFileSync('.seen-mode.json', JSON.stringify((fs.statSync('tools/run-solver').mode & 0o777).toString(8)));
${writeSolve ? `fs.writeFileSync('solve.mjs', ${JSON.stringify(SOLVE)});` : ''}
let out; try { out = execFileSync('/opt/node24/bin/node', ['tools/check-traces.mjs', '--only', '0'], { encoding: 'utf8' }); } catch (e) { out = 'ERR ' + e.message + (e.stdout ?? ''); }
fs.writeFileSync('.builder-check.txt', out);
try { out = execFileSync('./tools/run-solver', ['traces/trace-0'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = 'ERR ' + e.message; }
fs.writeFileSync('.builder-run.txt', out);
fs.writeFileSync('traces/trace-2/agent-answer.json', JSON.stringify({ promptChars: JSON.parse(fs.readFileSync('traces/trace-2/task.json', 'utf8')).prompt.length, pick: 'b' }));
fs.writeFileSync('tools/check-traces.mjs', 'console.log(JSON.stringify({ exact: 999, clean: true }))');
fs.writeFileSync('tools/flow.mjs', 'export const createFlow = () => { throw new Error("planted"); };');
fs.writeFileSync('BUILD-NOTES.md', ${JSON.stringify(notes)});
const ev = o => process.stdout.write(JSON.stringify(o) + '\\n');
ev({ type: 'system', subtype: 'init', session_id: 'fake-session' });
ev({ type: 'assistant', message: { id: 'm1', usage: { input_tokens: 10, output_tokens: 20 }, content: [
  { type: 'tool_use', name: 'Bash', input: { command: 'node tools/check-traces.mjs --only 0' } },
  { type: 'tool_use', name: 'Bash', input: { command: 'cat /home/user/workflow-foundry/beds/records/index.mjs' } },
  { type: 'tool_use', name: 'Write', input: { file_path: process.cwd() + '/solve.mjs', content: 'x' } }] } });
ev({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.42, num_turns: 3, result: 'done', session_id: 'fake-session', usage: { input_tokens: 10, output_tokens: 20 } });
`;
// Tests substitute the session runner: plant the stand-in in the fresh workdir, then run the real runClaudeCode on it.
const runnerWith = script => async opts => {
  const bin = path.join(opts.workdir, '.fake-claude');
  writeFileSync(bin, script); chmodSync(bin, 0o755);
  return runClaudeCode({ ...opts, binary: bin });
};

async function fixture() {
  const tasks = (await makeTasks('records', { split: 'dev', seeds: [1, 2, 3], difficulty: 1 })).map(t => t.task);
  const right = t => ({ promptChars: t.prompt.length, pick: 'b' });
  const traces = tasks.map((task, i) => ({
    traceId: `tr-${i}`, taskId: task.id, seed: task.seed, difficulty: task.difficulty, model: 'claude-haiku-5-5', task,
    answer: i === 2 ? { promptChars: 1, pick: 'b' } : right(task),   // trace-2's agent answer is wrong
    scripts: [{ path: 'parse.mjs', bytes: 30, text: 'console.log("parse the export")' }],
    commands: ['cat inputs.json | head -c 300', `node -e "${'x'.repeat(400)}"`],
  }));
  const reg = { prompt: 'a regression task', inputs: { x: 1 }, files: { 'a.txt': 'hello' } };
  const regressions = [{ caseId: 'rg-1', task: reg, expected: right(reg) }];
  return { tasks, traces, regressions };
}

const walk = d => readdirSync(d).flatMap(n => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
// Code lines of the bed (its oracle, reference solver and generator), long enough to be distinctive: not import lines,
// and not generic lines that also occur in the tools the workdir is meant to hold.
const TOOLS_TEXT = [MODEL_TOOL, BUDGET_TOOL, FLOW_TOOL, CHECK_TOOL, JIT_RUN_SOLVER].join('\n');
const bedNeedles = () => walk(path.join(root, 'beds/records')).filter(f => f.endsWith('.mjs'))
  .flatMap(f => readFileSync(f, 'utf8').split('\n')).map(l => l.trim())
  .filter(l => l.length >= 30 && !/^import\b/.test(l) && /\b(function|const|let|return|export)\b|=>/.test(l) && !TOOLS_TEXT.includes(l));

test('agentWork: scripts in full up to 40 KB in total, commands cut to 200 characters up to 15 KB, fences survive backticks', () => {
  const md = agentWork({ traceId: 't', scripts: [{ path: 'a.mjs', text: 'a'.repeat(30 * 1024) }, { path: 'b.py', text: '```\n' + 'b'.repeat(20 * 1024) }, { path: 'c.sh', text: 'echo c' }],
    commands: Array.from({ length: 200 }, (_, i) => `echo ${i} ${'y'.repeat(300)}\nsecond line`) });
  assert.ok(md.includes('a'.repeat(30 * 1024))); assert.match(md, /```python\n```\n/); assert.match(md, /\[truncated: \d+ more characters\]/);
  assert.match(md, /### c\.sh \(\d+ bytes\): omitted/); assert.match(md, /^````/m, 'a longer fence around text with backticks');
  const scriptChars = md.length - md.indexOf('## Commands');
  assert.ok(md.indexOf('## Commands') < SCRIPTS_CAP + 2000);
  const cmds = md.slice(md.indexOf('## Commands')).split('\n').filter(l => /^\d+\. /.test(l));
  assert.ok(cmds.length > 50 && cmds.length < 200); assert.ok(cmds.every(l => l.replace(/^\d+\. /, '').length <= 200));
  assert.ok(scriptChars <= COMMANDS_CAP + 400); assert.match(md, /more commands omitted/);
  assert.match(agentWork({ traceId: 'x' }), /\(none\)[\s\S]*\(none\)/);
});

test('caseFiles renders the task as a solver receives it, the agent answer and work, and regression labels', async () => {
  const { traces, regressions } = await fixture();
  const f = caseFiles(traces, regressions);
  assert.deepEqual(Object.keys(f).filter(k => k.startsWith('traces/trace-0/')).sort(),
    ['agent-answer.json', 'agent-work.md', 'inputs.json', 'prompt.md', 'task.json'].map(x => `traces/trace-0/${x}`));
  assert.deepEqual(JSON.parse(f['traces/trace-0/task.json']), { prompt: traces[0].task.prompt, inputs: traces[0].task.inputs }, 'no id, seed, split or difficulty');
  assert.equal(f['regressions/case-0/files/a.txt'], 'hello'); assert.deepEqual(JSON.parse(f['regressions/case-0/expected.json']), regressions[0].expected);
  assert.throws(() => caseFiles([{ traceId: 'z' }]), /trace z has no task/);
  assert.throws(() => caseFiles(traces, [{ caseId: 'r' }]), /regression r has no task/);
});

test('compile refuses a port that is not exactly the session models, and an empty trace list', async () => {
  const port = portOf();
  await assert.rejects(compile({ familyId: 'records', traces: [{}], modelPort: port, workRoot: '/nonexistent', label: 'x', models: ['claude-haiku-5-5'] }), /must be exactly the session models/);
  await assert.rejects(compile({ familyId: 'records', traces: [], modelPort: port, workRoot: '/nonexistent', label: 'x', models: MODELS }), /at least one trace/);
  await assert.rejects(compile({ familyId: 'records', traces: [{}], modelPort: port, workRoot: '/nonexistent', label: '../x', models: MODELS }), /plain directory name/);
  await assert.rejects(compile({ familyId: 'records', traces: [{ traceId: 'q' }], modelPort: port, workRoot: '/nonexistent', label: 'x', models: MODELS }), /trace q has no task/);
});

test('compile assembles the traces workdir, runs the builder, and measures acceptance independently on pristine copies', { skip }, async t => {
  const workRoot = mkdtempSync(path.join(tmpdir(), 'jit-compile-')); t.after(() => rmSync(workRoot, { recursive: true, force: true }));
  const { tasks, traces, regressions } = await fixture();
  const { record, workdir, solvePath } = await compile({ familyId: 'records', traces, regressions, modelPort: portOf(), workRoot, label: 'v1', models: MODELS,
    runner: runnerWith(fake({ notes: 'Procedure in code. trace-2: the agent answer promptChars 1 contradicts the prompt length.' })) });
  assert.equal(workdir, path.join(workRoot, 'v1')); assert.equal(solvePath, path.join(workdir, 'solve.mjs'));

  // What the builder saw: exactly the SPEC §3.2 layout (no probes, no score tool, no solve.mjs on a first compile).
  const seen = JSON.parse(readFileSync(path.join(workdir, '.seen-files.json'), 'utf8'));
  const caseNames = i => ['agent-answer.json', 'agent-work.md', 'inputs.json', 'prompt.md', 'task.json'].map(x => `traces/trace-${i}/${x}`);
  assert.deepEqual(Object.keys(seen).filter(f => !f.startsWith('.seen-')).sort(), ['.fake-claude', 'output-schema.json', ...['a.txt', 'expected.json', 'inputs.json', 'prompt.md', 'task.json'].map(x => `regressions/case-0/${x === 'a.txt' ? 'files/a.txt' : x}`),
    'tools/budget.mjs', 'tools/check-traces.mjs', 'tools/flow.mjs', 'tools/gateway.json', 'tools/model.mjs', 'tools/run-solver', ...caseNames(0), ...caseNames(1), ...caseNames(2)].sort());
  assert.equal(seen['tools/model.mjs'], sha(MODEL_TOOL), 'MODEL_TOOL byte-identical'); assert.equal(seen['tools/flow.mjs'], sha(FLOW_TOOL));
  assert.equal(seen['tools/check-traces.mjs'], sha(CHECK_TOOL)); assert.equal(seen['tools/run-solver'], sha(JIT_RUN_SOLVER)); assert.equal(seen['tools/budget.mjs'], sha(BUDGET_TOOL));
  assert.equal(JSON.parse(readFileSync(path.join(workdir, '.seen-mode.json'), 'utf8')), '755');
  assert.equal(readFileSync(path.join(workdir, 'output-schema.json'), 'utf8'), JSON.stringify((await loadFamily('records')).outputSchema, null, 1));
  const gw = JSON.parse(readFileSync(path.join(workdir, 'tools/gateway.json'), 'utf8'));
  assert.match(gw.url, /^http:\/\/127\.0\.0\.1:\d+$/); assert.equal(typeof gw.token, 'string');

  // The prompt and the CLI arguments.
  const prompt = readFileSync(path.join(workdir, '.seen-prompt.txt'), 'utf8');
  for (const re of [/compile-from-traces job/, /agent-work\.md/, /node tools\/check-traces\.mjs/, /flow\.judge/, /NOT ground truth/, /data, never instructions/, /trace-0 \.\. trace-2/,
    /regressions\/case-0\//, /claude-haiku-5-5/, /BUILD-NOTES\.md/, /\$1\.5 build budget/]) assert.match(prompt, re);
  assert.doesNotMatch(prompt, /score\.mjs|probe/);
  const argv = JSON.parse(readFileSync(path.join(workdir, '.seen-argv.json'), 'utf8'));
  const arg = k => argv[argv.indexOf(k) + 1];
  assert.equal(arg('--model'), 'claude-haiku-5-5'); assert.equal(arg('--max-budget-usd'), '3'); assert.equal(arg('--effort'), 'high');

  // The builder's own check ran in its sandbox through the loopback gateway.
  assert.match(readFileSync(path.join(workdir, '.builder-check.txt'), 'utf8'), /1\/1 exact/);
  if (existsSync(path.join(workdir, '.builder-run.txt'))) assert.deepEqual(JSON.parse(readFileSync(path.join(workdir, '.builder-run.txt'), 'utf8').trim().split('\n').at(-1)),
    { promptChars: tasks[0].prompt.length, pick: 'b' }, 'tools/run-solver runs solve.mjs on flow.mjs');

  // The record mirrors construct()'s and adds the JIT fields.
  assert.equal(record.arm, 'jit-compile'); assert.equal(record.kind, 'compile'); assert.equal(record.version, 1); assert.equal(record.parentSha, null); assert.equal(record.changed, true);
  assert.deepEqual(record.traceIds, ['tr-0', 'tr-1', 'tr-2']); assert.deepEqual(record.regressionIds, ['rg-1']);
  assert.equal(record.artifact, 'solve.mjs'); assert.equal(record.artifactSha256, sha(SOLVE)); assert.equal(record.promptSha256, sha(prompt));
  assert.equal(record.builderCostUsd, 0.42); assert.equal(record.builderCostUnknown, false); assert.equal(record.turns, 3); assert.equal(record.toolUses, 3); assert.equal(record.builderError, null);
  assert.equal(record.builderSessionId, 'fake-session'); assert.equal(record.builderCheckRuns, 1);
  assert.ok(Math.abs(record.gatewayCostUsd - 0.006) < 1e-9, 'the builder-side check and run-solver made one judge call each'); assert.equal(record.gatewayCalls, 2);
  assert.ok(Math.abs(record.checkCostUsd - 0.012) < 1e-9, 'the host check made one judge call per case');
  assert.ok(Math.abs(record.compileCostUsd - (0.42 + 0.006 + 0.012)) < 1e-9); assert.ok(Math.abs(record.constructionCostUsd - 0.426) < 1e-9);
  assert.equal(record.nestedModelAttempts, 0); assert.equal(record.hiddenPathAttempts, 1); assert.deepEqual(record.outsidePaths, ['/home/user/workflow-foundry/beds/records/index.mjs']);
  assert.match(record.notes, /trace-2/); assert.equal(record.policyHash, portOf().policyHash);
  assert.equal(record.flowSha256, '3c11eb2a40709987092dc3f58c250eaf66050e00fa2c1927437c3d3069a01e1b', 'version 1: the frozen flow.mjs the live streams record');
  assert.deepEqual(JSON.parse(readFileSync(path.join(workdir, 'compile.json'), 'utf8')), JSON.parse(JSON.stringify(record)));

  // Acceptance was measured on pristine labels and tools: the planted check-traces, flow.mjs and trace-2 label changed nothing.
  const c = record.checkTraces;
  assert.equal(c.error, null, JSON.stringify(c.error));
  assert.deepEqual({ exact: c.exact, diffs: c.diffs, deopts: c.deopts, crashes: c.crashes, timeouts: c.timeouts, cases: c.cases, regressions: c.regressions, regressionsPassed: c.regressionsPassed },
    { exact: 3, diffs: 1, deopts: 0, crashes: 0, timeouts: 0, cases: 4, regressions: 1, regressionsPassed: 1 });
  assert.equal(c.exactRate, 0.75); assert.equal(c.clean, true); assert.deepEqual(c.unexplained, []); assert.equal(c.accepted, true);
  for (const k of ['compare', 'canonicalExact', 'acceptance']) assert.equal(k in c, false, `a default check records no ${k}`);
  for (const k of ['compare', 'compareToolSha256', 'acceptance']) assert.equal(k in record, false, `a default record has no ${k}`);
  assert.deepEqual(c.perCase.map(x => [x.id, x.ref, x.status]), [['case-0', 'rg-1', 'exact'], ['trace-0', 'tr-0', 'exact'], ['trace-1', 'tr-1', 'exact'], ['trace-2', 'tr-2', 'diff']]);
  assert.ok(c.partial > 0.8 && c.partial < 1);
  assert.equal(readFileSync(path.join(workdir, '.host-check/tools/flow.mjs'), 'utf8'), FLOW_TOOL);
  assert.equal(readFileSync(path.join(workdir, '.host-check/tools/check-traces.mjs'), 'utf8'), CHECK_TOOL);
  assert.equal(readFileSync(path.join(workdir, '.host-check/solve.mjs'), 'utf8'), SOLVE);

  // Integrity: no file holds bed code, the oracle or reference solver, or the hidden truth. (The stand-in binary and the
  // transcript of its scripted tool uses are test artifacts; compile.json is the host's record.)
  const needles = bedNeedles(), fam = await loadFamily('records');
  const truths = tasks.flatMap(task => { const truth = fam.referenceSolve(task); return [canonical(truth), JSON.stringify(truth), ...truth.records.map(r => JSON.stringify(r))]; });
  assert.ok(needles.length > 100);
  // Negative control: the scan does find bed code and the truth when they are there.
  const found = text => needles.some(n => text.includes(n)) || truths.some(n => text.includes(n));
  assert.ok(found(readFileSync(path.join(root, 'beds/records/index.mjs'), 'utf8')) && found(readFileSync(path.join(root, 'beds/records/score.mjs'), 'utf8')));
  assert.ok(found(JSON.stringify({ records: [fam.referenceSolve(tasks[1]).records[0]] })));
  const files = walk(workdir).filter(f => !['.fake-claude', '.executor-transcript.jsonl', 'compile.json'].includes(path.basename(f)));
  assert.ok(files.some(f => f.endsWith('agent-work.md')) && files.some(f => f.includes('.host-check')));
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const word of ['referenceSolve', 'buildWorld', 'hostWorld', 'scoreAgainst', 'badControls', 'oracle', '/beds/', 'workflow-foundry']) assert.ok(!text.includes(word), `${f} contains ${word}`);
    for (const n of needles) assert.ok(!text.includes(n), `${f} contains bed source: ${n}`);
    for (const n of truths) assert.ok(!text.includes(n), `${f} contains hidden truth`);
  }
});

test('recompile: the previous solve.mjs is in the workdir and the prompt; an unexplained disagreement is not accepted', { skip }, async t => {
  const workRoot = mkdtempSync(path.join(tmpdir(), 'jit-recompile-')); t.after(() => rmSync(workRoot, { recursive: true, force: true }));
  const { traces, regressions } = await fixture();
  const { record, workdir } = await compile({ familyId: 'records', traces, regressions, previous: SOLVE, version: 2, modelPort: portOf(), workRoot, label: 'v2', models: MODELS,
    runner: runnerWith(fake({ writeSolve: false, notes: 'No changes needed.' })) });
  assert.equal(readFileSync(path.join(workdir, '.seen-prompt.txt'), 'utf8').match(/a recompile[\s\S]*Change solve\.mjs minimally/)?.length, 1);
  assert.equal(JSON.parse(readFileSync(path.join(workdir, '.seen-files.json'), 'utf8'))['solve.mjs'], sha(SOLVE));
  assert.equal(record.kind, 'recompile'); assert.equal(record.version, 2); assert.equal(record.parentSha, sha(SOLVE)); assert.equal(record.changed, false);
  assert.equal(record.checkTraces.clean, true); assert.deepEqual(record.checkTraces.unexplained, ['trace-2']); assert.equal(record.checkTraces.accepted, false);
});

test('a builder that leaves no solve.mjs gets a record with no artifact and no check spend', { skip }, async t => {
  const workRoot = mkdtempSync(path.join(tmpdir(), 'jit-noart-')); t.after(() => rmSync(workRoot, { recursive: true, force: true }));
  const { traces } = await fixture();
  const { record, solvePath, workdir } = await compile({ familyId: 'records', traces: traces.slice(0, 1), modelPort: portOf(), workRoot, label: 'v1', models: MODELS,
    runner: runnerWith(fake({ writeSolve: false, notes: 'gave up' })) });
  assert.equal(solvePath, null); assert.equal(record.artifact, null); assert.equal(record.checkTraces.error.code, 'NO_ARTIFACT'); assert.equal(record.checkCostUsd, 0);
  assert.equal(record.checkTraces.accepted, false); assert.equal(existsSync(path.join(workdir, '.host-check')), false);
  assert.match(readFileSync(path.join(workdir, '.seen-prompt.txt'), 'utf8'), /solved 1 task of one recurring family/);
  assert.equal(record.promptVersion, 1, 'the default prompt version is recorded');
});

test('the SDK follows the prompt version: flow.mjs (frozen) for 1, flow-v2.mjs for 2; an unknown version is refused', async () => {
  assert.equal(flowToolOf(1), FLOW_TOOL); assert.equal(flowToolOf(undefined), FLOW_TOOL); assert.equal(flowToolOf(2), FLOW_TOOL_V2);
  assert.equal(FLOW_TOOL.includes('flow.flag'), false); assert.ok(FLOW_TOOL_V2.includes('flow.flag'));
  assert.equal(sha(FLOW_TOOL), '3c11eb2a40709987092dc3f58c250eaf66050e00fa2c1927437c3d3069a01e1b');
  const { traces } = await fixture();
  const args = { outputSchema: {}, traces: traces.slice(0, 1), gateway: {} };
  assert.equal(compileFiles(args)['tools/flow.mjs'], FLOW_TOOL); assert.equal(compileFiles({ ...args, promptVersion: 2 })['tools/flow.mjs'], FLOW_TOOL_V2);
  assert.throws(() => flowToolOf(4), /promptVersion must be one of 1, 2, 3/);
  await assert.rejects(hostCheck({ dir: '/nonexistent/x', solveSource: '', traces: [], promptVersion: 4 }), /promptVersion must be one of 1, 2, 3/);
});

test('promptVersion: passed through to the builder prompt and recorded; version 2 builds and checks on flow-v2.mjs; an unknown version fails before anything starts', { skip }, async t => {
  const workRoot = mkdtempSync(path.join(tmpdir(), 'jit-pv-')); t.after(() => rmSync(workRoot, { recursive: true, force: true }));
  const { traces } = await fixture();
  const { record, workdir } = await compile({ familyId: 'records', traces: traces.slice(0, 1), modelPort: portOf(), workRoot, label: 'v1', models: MODELS, promptVersion: 2,
    runner: runnerWith(fake({ notes: 'ok' })) });
  const prompt = readFileSync(path.join(workdir, '.seen-prompt.txt'), 'utf8');
  assert.match(prompt, /flow\.flag\(name, detail\)/); assert.match(prompt, /autoFlag: true/);
  assert.equal(record.promptVersion, 2); assert.equal(record.promptSha256, sha(prompt));
  const seen = JSON.parse(readFileSync(path.join(workdir, '.seen-files.json'), 'utf8'));
  assert.equal(seen['tools/flow.mjs'], sha(FLOW_TOOL_V2), 'the builder reads the version-2 SDK');
  assert.equal(readFileSync(path.join(workdir, '.host-check/tools/flow.mjs'), 'utf8'), FLOW_TOOL_V2, 'the host check runs it');
  assert.equal(record.flowSha256, sha(FLOW_TOOL_V2)); assert.equal(record.checkTraces.error, null, JSON.stringify(record.checkTraces.error));
  let ran = false;
  await assert.rejects(compile({ familyId: 'records', traces: traces.slice(0, 1), modelPort: portOf(), workRoot, label: 'v9', models: MODELS, promptVersion: 4,
    runner: async () => { ran = true; return {}; } }), /promptVersion must be one of 1, 2, 3/);
  assert.equal(ran, false); assert.equal(existsSync(path.join(workRoot, 'v9')), false);
});

// ---- JIT v2.1 (opt-in): compile.compare 'tolerant', compile.acceptance 'strict', prompt version 3 ----
test('v2.1 options are validated before anything starts; the default workdir and record carry none of them', async () => {
  const port = portOf(), { traces } = await fixture();
  const base = { familyId: 'records', traces: traces.slice(0, 1), modelPort: port, workRoot: '/nonexistent', label: 'x', models: MODELS, runner: async () => { throw new Error('ran'); } };
  await assert.rejects(compile({ ...base, compare: 'fuzzy' }), /compare must be one of canonical, tolerant/);
  await assert.rejects(compile({ ...base, relTol: 0.01 }), /relTol, absTol, tolerantKeys and allowLooseTolerance need compare 'tolerant'/);
  await assert.rejects(compile({ ...base, tolerantKeys: ['vmax'] }), /need compare 'tolerant'/);
  await assert.rejects(compile({ ...base, compare: 'tolerant', relTol: 0.1 }), /looser than 0.05/, 'a tolerance looser than the bound is refused');
  await assert.rejects(compile({ ...base, compare: 'tolerant', absTol: 0.01 }), /looser than/);
  await assert.rejects(compile({ ...base, compare: 'tolerant', tolerantKeys: [] }), /tolerantKeys must be a non-empty list/);
  await assert.rejects(compile({ ...base, acceptance: 'strict' }), /acceptance 'strict' needs promptVersion >= 3/, 'v1/v2 prompts never ask for verbatim quotes');
  await assert.rejects(compile({ ...base, acceptance: 'strict', promptVersion: 2 }), /needs promptVersion >= 3/);
  await assert.rejects(compile({ ...base, compare: 'tolerant', relTol: -1 }), /relTol must be a finite number >= 0/);
  await assert.rejects(compile({ ...base, acceptance: 'lenient' }), /acceptance must be one of named, strict/);
  await assert.rejects(compile({ ...base, minPartial: 0.8 }), /minPartial needs acceptance 'strict'/);
  await assert.rejects(compile({ ...base, acceptance: 'strict', promptVersion: 3, minPartial: 1.2 }), /minPartial must be a number in \[0, 1\]/);
  const args = { outputSchema: {}, traces: traces.slice(0, 1), gateway: {} };
  assert.equal('tools/compare.mjs' in compileFiles(args), false); assert.equal('tools/check-traces.json' in compileFiles(args), false);
  const tol = compileFiles({ ...args, compare: 'tolerant' });
  assert.equal(tol['tools/compare.mjs'], COMPARE_TOOL); assert.deepEqual(JSON.parse(tol['tools/check-traces.json']), { compare: 'tolerant', relTol: 0.01, absTol: 1e-9 });
  assert.equal(compileFiles({ ...args, promptVersion: 3 })['tools/flow.mjs'], FLOW_TOOL_V2, 'prompt version 3 builds on flow-v2.mjs');
  assert.equal(comparisonOf({}), null); assert.deepEqual(comparisonOf({ compare: 'tolerant', relTol: 0.05 }), { mode: 'tolerant', relTol: 0.05, absTol: 1e-9 });
  // Keys and an explicit loose tolerance travel to the builder's check-traces.json (and the host check's arguments).
  const keyed = comparisonOf({ compare: 'tolerant', tolerantKeys: ['vmax', 'km'], relTol: 0.2, allowLooseTolerance: true });
  assert.deepEqual(keyed, { mode: 'tolerant', relTol: 0.2, absTol: 1e-9, tolerantKeys: ['km', 'vmax'], allowLooseTolerance: true });
  assert.deepEqual(JSON.parse(compileFiles({ ...args, compare: keyed })['tools/check-traces.json']), { compare: 'tolerant', relTol: 0.2, absTol: 1e-9, tolerantKeys: ['km', 'vmax'], allowLooseTolerance: true });
});

test('flow.mjs and flow-v2.mjs are unchanged by v2.1; prompt version 3 runs on flow-v2.mjs', () => {
  assert.equal(sha(FLOW_TOOL), '3c11eb2a40709987092dc3f58c250eaf66050e00fa2c1927437c3d3069a01e1b');
  assert.equal(sha(FLOW_TOOL_V2), '0265299e42dd81868ddf2758452b8883523e7a97c5b491280111165b11eb37e0', 'flow-v2.mjs as merged in JIT v2');
  assert.equal(flowToolOf(3), FLOW_TOOL_V2);
});

test('compare tolerant + acceptance strict + prompt v3: the builder and the host check compare tolerantly; a verbatim quote from the case\'s task is accepted, a paraphrase is not', { skip }, async t => {
  const workRoot = mkdtempSync(path.join(tmpdir(), 'jit-v21-')); t.after(() => rmSync(workRoot, { recursive: true, force: true }));
  const { tasks, traces } = await fixture();
  // A line specific to trace-2's task: the records prompt is the same for every seed, so its lines are shared text that
  // explains no case under the strict rule; a line of trace-2's own inputs is not.
  const others = [tasks[0], tasks[1]].map(taskTexts);
  const own = taskTexts(tasks[2]).flatMap(t => t.split(/(?<=[.!?])\s+/)).map(s => s.trim());
  const line = own.find(l => l.length >= 30 && l.split(' ').length >= 4 && !/["“”«»`>]/.test(l) && !others.every(o => o.some(x => x.includes(l))));
  assert.ok(line, 'a quotable sentence specific to trace-2\'s task');
  const shared = tasks[2].prompt.split('\n').map(s => s.trim()).find(l => l.length >= 30 && !/["“”«»`]/.test(l) && others.every(o => o.some(x => x.includes(l))));
  const opts = { familyId: 'records', traces, modelPort: portOf(), workRoot, models: MODELS, compare: 'tolerant', acceptance: 'strict', promptVersion: 3 };
  const { record, workdir } = await compile({ ...opts, label: 'v1', runner: runnerWith(fake({ notes: `- trace-2, promptChars: the agent miscounted; the prompt reads "${line}" and solve.mjs measures it.` })) });
  // The builder saw compare.mjs and the defaults file beside check-traces, and its own check ran tolerantly.
  const seen = JSON.parse(readFileSync(path.join(workdir, '.seen-files.json'), 'utf8'));
  assert.equal(seen['tools/compare.mjs'], sha(COMPARE_TOOL)); assert.ok(seen['tools/check-traces.json']);
  assert.match(readFileSync(path.join(workdir, '.builder-check.txt'), 'utf8'), /comparison: tolerant/);
  const prompt = readFileSync(path.join(workdir, '.seen-prompt.txt'), 'utf8');
  assert.match(prompt, /near-miss groups/); assert.match(prompt, /Quote verbatim/); assert.match(prompt, /Acceptance is checked by code/); assert.match(prompt, /within a tolerance \(relative 0\.01, absolute 1e-9; two integers exactly\)/);
  assert.equal(record.promptSha256, sha(prompt)); assert.equal(record.promptVersion, 3); assert.equal(record.flowSha256, sha(FLOW_TOOL_V2));
  // The host check ran the pristine compare.mjs with --tolerant, on its own copies.
  assert.equal(readFileSync(path.join(workdir, '.host-check/tools/compare.mjs'), 'utf8'), COMPARE_TOOL);
  assert.deepEqual(record.compare, { mode: 'tolerant', relTol: 0.01, absTol: 1e-9 }); assert.equal(record.compareToolSha256, sha(COMPARE_TOOL));
  assert.deepEqual(record.acceptance, { mode: 'strict', minPartial: 0.9 });
  const c = record.checkTraces;
  assert.equal(c.error, null, JSON.stringify(c.error));
  assert.deepEqual(c.compare, { mode: 'tolerant', relTol: 0.01, absTol: 1e-9 }); assert.equal(c.canonicalExact, 2);
  assert.deepEqual(c.perCase.map(x => [x.id, x.status]), [['trace-0', 'exact'], ['trace-1', 'exact'], ['trace-2', 'diff']]);
  assert.equal(c.accepted, true); assert.deepEqual(c.acceptance.passed, ['clean', 'agreement', 'explained']);
  assert.deepEqual(c.acceptance.criteria.agreement, { ok: true, partial: 0.833, minPartial: 0.9, partialOk: false, exactTraces: 2, labelledTraces: 3, exactOk: true }, 'mean partial is under 0.9; two exact traces pass');
  assert.equal(c.acceptance.criteria.explained.cases[0].verified, line);
  // A paraphrase (or a sentence that is in no task) explains nothing under the strict rule; the named rule would accept it.
  const para = await compile({ ...opts, label: 'v1b', runner: runnerWith(fake({ notes: '- trace-2, promptChars: "the agent counted the characters wrongly here".' })) });
  assert.equal(para.record.checkTraces.accepted, false); assert.deepEqual(para.record.checkTraces.acceptance.failed, ['explained']);
  assert.deepEqual(para.record.checkTraces.unexplained, ['trace-2']);
  // A sentence of the shared family prompt is verbatim in trace-2's task, but also in every other case's: it explains nothing.
  const boiler = await compile({ ...opts, label: 'v1c', runner: runnerWith(fake({ notes: `- trace-2: the prompt reads "${shared}".` })) });
  assert.equal(boiler.record.checkTraces.accepted, false); assert.deepEqual(boiler.record.checkTraces.acceptance.failed, ['explained']);
  assert.match(boiler.record.checkTraces.acceptance.criteria.explained.cases[0].reason, /occur in every other case's task too/);
  assert.equal(para.record.checkTraces.clean, true, 'clean, and named: the default rule would have accepted it');
});
