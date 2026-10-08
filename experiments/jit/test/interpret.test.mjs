// interpret() at $0: a stand-in Claude CLI inside the sandbox writes scripts and answer.json and prints stream-json
// tool uses; the trace must carry the answer, the agent's scripts (not the provided inputs), its Bash commands in order,
// the cost, and the transcript scans.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { interpret, harvestScripts, outsidePathsOf, validateOutput, SCRIPT_CAP_BYTES } from '../interpret.mjs';

const skip = sandboxAvailable() ? false : 'no user namespaces';
const tmp = t => { const d = mkdtempSync(path.join(tmpdir(), 'jit-interp-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const SCHEMA = { type: 'object', required: ['records'], properties: { records: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } } } };
const TASK = { id: 'records:dev:d3:9', seed: 9, split: 'dev', difficulty: 3, prompt: 'Merge the rows.', inputs: { export: 'a,b\n1,2' }, files: { 'notes.txt': 'n' } };

const tool = (id, name, input) => JSON.stringify({ type: 'assistant', message: { id, content: [{ type: 'tool_use', name, input }], usage: { input_tokens: 3, output_tokens: 5 } } });
const q = s => `'${s.replaceAll("'", `'\\''`)}'`;
// The stand-in reads the prompt (stdin), leaves scripts and an answer in its cwd (the workdir), and reports a result.
function fakeCli(workdir, { answer = '{"records":[{"id":1}]}', big = false } = {}) {
  const events = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake-session' }),
    tool('m1', 'Bash', { command: 'cat inputs.json | head' }),
    tool('m2', 'Write', { file_path: `${workdir}/solve.py`, content: 'print(1)' }),
    tool('m3', 'Bash', { command: 'python3 solve.py > answer.json && cat /home/user/secret.txt' }),
    tool('m4', 'Bash', { command: 'claude -p "help me"' }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.0421, num_turns: 4, session_id: 'fake-session' }),
  ];
  const script = `#!/bin/sh
cat > prompt-seen.txt
printf 'print(1)\\n' > solve.py
mkdir -p lib && printf 'export const x = 1;\\n' > lib/util.mjs
printf '#!/bin/sh\\necho hi\\n' > run.sh
printf 'not a script' > notes.md
${big ? `head -c ${SCRIPT_CAP_BYTES + 500} /dev/zero | tr '\\0' 'x' > big.js` : ''}
${answer == null ? '' : `printf '%s' ${q(answer)} > answer.json`}
${events.map(e => `echo ${q(e)}`).join('\n')}
`;
  const bin = path.join(workdir, 'fake-claude');
  writeFileSync(bin, script); chmodSync(bin, 0o755);
  return bin;
}

test('interpret: trace with answer, harvested scripts, ordered commands, cost and transcript scans; trace.json written', { skip }, async t => {
  const workdir = path.join(tmp(t), 'w'); mkdirSync(workdir);
  const binary = fakeCli(workdir, { big: true });
  const tr = await interpret({ task: TASK, familyId: 'records', outputSchema: SCHEMA, model: 'claude-haiku-5-5', budgetUsd: 0.5, timeoutMs: 30000, workdir, binary, traceId: 'tr-test' });
  assert.equal(tr.error, null, JSON.stringify(tr.error));
  assert.deepEqual(tr.answer, { records: [{ id: 1 }] }); assert.equal(tr.answerValid, true);
  assert.equal(tr.costUsd, 0.0421); assert.equal(tr.costUnknown, false); assert.equal(tr.turns, 4); assert.equal(tr.sessionId, 'fake-session');
  assert.deepEqual(tr.scripts.map(s => s.path), ['big.js', 'lib/util.mjs', 'run.sh', 'solve.py'], 'agent scripts only: not inputs, files/, notes.md or the stand-in binary');
  const big = tr.scripts.find(s => s.path === 'big.js');
  assert.equal(big.bytes, SCRIPT_CAP_BYTES + 500); assert.equal(big.truncated, true); assert.ok(big.text.length < SCRIPT_CAP_BYTES + 100);
  assert.equal(tr.scripts.find(s => s.path === 'solve.py').text, 'print(1)\n');
  assert.deepEqual(tr.commands, ['cat inputs.json | head', 'python3 solve.py > answer.json && cat /home/user/secret.txt', 'claude -p "help me"']);
  assert.equal(tr.tools, 4);
  assert.equal(tr.nestedModelAttempts, 1, 'a nested claude CLI is counted (it voids spend accounting)');
  assert.equal(tr.hiddenPathAttempts, 1); assert.deepEqual(tr.outsidePaths, ['/home/user/secret.txt']);
  // the task travels with the trace (what a solver sees), so the compiler can render it; nothing hidden is added
  assert.deepEqual(tr.task, { prompt: TASK.prompt, inputs: TASK.inputs, files: TASK.files });
  assert.deepEqual([tr.taskId, tr.seed, tr.difficulty, tr.familyId, tr.model], ['records:dev:d3:9', 9, 3, 'records', 'claude-haiku-5-5']);
  assert.deepEqual(JSON.parse(readFileSync(path.join(workdir, 'trace.json'), 'utf8')).traceId, 'tr-test');
  // the agent saw the B0 prompt and the task files
  assert.match(readFileSync(path.join(workdir, 'prompt-seen.txt'), 'utf8'), /Merge the rows\.[\s\S]*answer\.json/);
  assert.ok(existsSync(path.join(workdir, 'files/notes.txt')));
});

test('interpret: no answer.json and a schema-invalid answer are recorded, not thrown', { skip }, async t => {
  const root = tmp(t);
  const w1 = path.join(root, 'none'); mkdirSync(w1);
  const none = await interpret({ task: TASK, familyId: 'records', outputSchema: SCHEMA, model: 'claude-haiku-5-5', timeoutMs: 30000, workdir: w1, binary: fakeCli(w1, { answer: null }) });
  assert.equal(none.answer, null); assert.equal(none.answerValid, false); assert.match(none.traceId, /^tr-[0-9a-f]{12}$/);
  const w2 = path.join(root, 'bad'); mkdirSync(w2);
  const bad = await interpret({ task: TASK, familyId: 'records', outputSchema: SCHEMA, model: 'claude-haiku-5-5', timeoutMs: 30000, workdir: w2, binary: fakeCli(w2, { answer: '{"records":[{"id":"x"}]}' }) });
  assert.deepEqual(bad.answer, { records: [{ id: 'x' }] }); assert.equal(bad.answerValid, false); assert.ok(bad.answerErrors.length);
});

test('interpret: a session killed at its timeout is charged at its budget bound', { skip }, async t => {
  const workdir = path.join(tmp(t), 'w'); mkdirSync(workdir);
  const bin = path.join(workdir, 'hang'); writeFileSync(bin, '#!/bin/sh\ncat > /dev/null\necho \'{"type":"system","subtype":"init","session_id":"s"}\'\nsleep 30\n'); chmodSync(bin, 0o755);
  const tr = await interpret({ task: TASK, familyId: 'records', outputSchema: SCHEMA, model: 'claude-haiku-5-5', budgetUsd: 0.7, timeoutMs: 2000, workdir, binary: bin });
  assert.equal(tr.error.code, 'EXECUTOR_TIMEOUT'); assert.equal(tr.costUsd, 0.7); assert.equal(tr.costUnknown, true); assert.equal(tr.answer, null);
});

test('harvest helpers: exclusions, outside-path scan, schema check', t => {
  const d = tmp(t);
  for (const [rel, text] of [['a.py', 'x'], ['inputs.json', '{}'], ['files/f.js', 'x'], ['node_modules/m/i.js', 'x'], ['pre.sh', 'x'], ['b.txt', 'x'], ['sub/c.mjs', 'y']]) {
    mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); writeFileSync(path.join(d, rel), text);
  }
  assert.deepEqual(harvestScripts(d, { exclude: new Set(['pre.sh']) }).map(s => s.path), ['a.py', 'sub/c.mjs']);
  const scan = outsidePathsOf([{ name: 'Bash', input: { command: `ls ${d}/x /opt/corpus/y` } }, { name: 'Read', input: { file_path: '/etc/passwd' } }], d);
  assert.equal(scan.hiddenPathAttempts, 2); assert.deepEqual(scan.outsidePaths, ['/opt/corpus/y', '/etc/passwd']);
  assert.equal(validateOutput(SCHEMA, { records: [] }).valid, true);
  assert.equal(validateOutput(SCHEMA, { rows: [] }).valid, false);
  assert.equal(validateOutput(null, 1).valid, true, 'no schema: nothing to check');
});
