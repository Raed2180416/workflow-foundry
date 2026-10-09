// runCompiled() at $0: stub solve.mjs scripts in the B1 sandbox (no network, gateway socket only) against a scripted
// model port. Exit 75 + deopt.json is a deopt, an uncaught exception a crash, a schema miss is invalid (never the oracle).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ModelPort } from '../../../src/models/port.mjs';
import { Journal } from '../../../src/journal.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';
import { subsetPolicy } from '../../lib/models.mjs';
import { MODEL_TOOL } from '../../c0/construct.mjs';
import { runCompiled, DEFAULT_FLOW, flagsOf } from '../run-compiled.mjs';

const skip = sandboxAvailable() ? false : 'no user namespaces';
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
const policy = subsetPolicy(loadPolicy().policy, MODELS);
const port = () => new ModelPort({ policy, journal: new Journal(new DatabaseSync(':memory:')),
  providers: { 'claude-cli': new ScriptedProvider(() => ({ value: { label: 'vip' }, costUsd: 0.02 })) } });
const SCHEMA = { type: 'object', required: ['records'], properties: { records: { type: 'array', items: { type: 'object' } } } };
const TASK = { id: 'records:dev:d3:9', prompt: 'p', inputs: { rows: [1, 2, 3] } };

// A tiny stand-in for tools/flow.mjs (builder A's real one is tested on its own): trace events, guard -> deopt.json + 75.
const FLOW_FIXTURE = `import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
const ev = e => appendFileSync('trace.jsonl', JSON.stringify({ at: new Date().toISOString(), ...e }) + '\\n');
export function createFlow() {
  return {
    input: () => JSON.parse(readFileSync(process.argv[2], 'utf8')),
    step: (name, fn) => { const out = fn(); ev({ kind: 'step', name }); return out; },
    guard: (name, cond, detail) => { if (!cond) { writeFileSync('deopt.json', JSON.stringify({ kind: 'guard', name, detail })); ev({ kind: 'deopt', name }); process.exit(75); } },
    done: v => { ev({ kind: 'done', name: 'done' }); console.log(JSON.stringify(v)); },
  };
}
`;
const SOLVES = {
  ok: `import { createFlow } from './tools/flow.mjs';
import { callModel } from './tools/model.mjs';
const flow = createFlow();
const task = flow.input();
const rows = flow.step('rows', () => task.inputs.rows);
const v = await callModel({ model: 'claude-haiku-5-5', prompt: 'label', schema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] } });
console.log('progress line');
flow.done({ records: rows.map(id => ({ id, label: v.label })) });`,
  deopt: `import { createFlow } from './tools/flow.mjs';
const flow = createFlow(); const task = flow.input();
flow.guard('known-dialects', task.inputs.rows.length < 3, { unseen: ['x'] });
flow.done({ records: [] });`,
  crash: `import { createFlow } from './tools/flow.mjs';
const flow = createFlow(); flow.input(); throw new Error('boom: unexpected row');`,
  invalid: `console.log(JSON.stringify({ rows: [] }));`,
  noJson: `console.log('all done');`,
  hang: `setTimeout(() => {}, 60000);`,
  network: `let out = 'blocked'; try { await fetch('https://example.com'); out = 'reached'; } catch {} console.log(JSON.stringify({ records: [{ net: out }] }));`,
  tools: `import { readFileSync, existsSync } from 'node:fs';
console.log(JSON.stringify({ records: [{ model: readFileSync('./tools/model.mjs', 'utf8').length, flow: existsSync('./tools/flow.mjs') }] }));`,
  // JIT v2: uncertainty flags on the real flow.mjs; the answer is unaffected.
  flagged: `import { createFlow } from './tools/flow.mjs';
const flow = createFlow(); const task = flow.input();
flow.flag('weak-name-match', { score: 0.8 }); flow.flag('weak-name-match', { score: 0.7 }); flow.flag('default-used');
flow.done({ records: task.inputs.rows.map(id => ({ id })) });`,
};

async function run(t, name, opts = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'jit-rc-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const solvePath = path.join(root, 'solve.mjs'); writeFileSync(solvePath, SOLVES[name]);
  const flowPath = path.join(root, 'flow-fixture.mjs'); writeFileSync(flowPath, FLOW_FIXTURE);
  const workdir = path.join(root, 'run'); mkdirSync(workdir);
  const r = await runCompiled({ solvePath, task: TASK, modelPort: port(), perTaskUsd: 0.5, timeoutMs: 30000, workdir, outputSchema: SCHEMA, allowedModels: MODELS, flowPath, label: `t-${name}`, ...opts });
  return { r, workdir };
}

test('ok: output on the last stdout line, schema-valid, gateway spend counted, trace.jsonl collected', { skip }, async t => {
  const { r, workdir } = await run(t, 'ok');
  assert.equal(r.status, 'ok', JSON.stringify(r)); assert.equal(r.error, null);
  assert.deepEqual(r.output, { records: [1, 2, 3].map(id => ({ id, label: 'vip' })) });
  assert.equal(r.costUsd, 0.02); assert.equal(r.meta.calls, 1); assert.equal(r.costUnknown, false); assert.equal(r.meta.exitCode, 0);
  assert.deepEqual(r.trace.map(e => e.kind), ['step', 'done']); assert.equal(r.deopt, null);
  assert.ok(existsSync(path.join(workdir, '.solve.stdout')));
});

test('deopt: exit 75 with deopt.json', { skip }, async t => {
  const { r } = await run(t, 'deopt');
  assert.equal(r.status, 'deopt'); assert.deepEqual(r.deopt, { kind: 'guard', name: 'known-dialects', detail: { unseen: ['x'] } });
  assert.equal(r.output, null); assert.equal(r.error, null); assert.equal(r.meta.exitCode, 75);
  assert.deepEqual(r.trace.map(e => e.kind), ['deopt']);
});

test('crash: an uncaught exception is a crash, not a deopt', { skip }, async t => {
  const { r } = await run(t, 'crash');
  assert.equal(r.status, 'crash'); assert.equal(r.error.code, 'SCRIPT_ERROR'); assert.equal(r.meta.exitCode, 1); assert.match(r.error.message, /boom/);
  assert.equal(r.deopt, null);
});

test('invalid: the bed output schema is checked by the repo validator (no oracle); no JSON is invalid too', { skip }, async t => {
  const { r } = await run(t, 'invalid');
  assert.equal(r.status, 'invalid'); assert.equal(r.error.code, 'OUTPUT_SCHEMA'); assert.deepEqual(r.output, { rows: [] });
  const { r: r2 } = await run(t, 'noJson');
  assert.equal(r2.status, 'invalid'); assert.equal(r2.error.code, 'SCRIPT_OUTPUT');
  // the schema can come from the bed by family id
  const { r: r3 } = await run(t, 'invalid', { outputSchema: null, familyId: 'records' });
  assert.equal(r3.status, 'invalid');
});

test('timeout: the wall clock kills the script', { skip }, async t => {
  const { r } = await run(t, 'hang', { timeoutMs: 1500 });
  assert.equal(r.status, 'timeout'); assert.equal(r.error.code, 'SCRIPT_TIMEOUT');
});

test('sandbox: no network; tools/model.mjs is the C0 MODEL_TOOL byte for byte and tools/flow.mjs is copied in', { skip }, async t => {
  const { r } = await run(t, 'network');
  assert.equal(r.status, 'ok'); assert.deepEqual(r.output, { records: [{ net: 'blocked' }] });
  const { r: r2 } = await run(t, 'tools');
  assert.deepEqual(r2.output, { records: [{ model: MODEL_TOOL.length, flow: true }] });
  const { r: r3 } = await run(t, 'tools', { flowPath: path.join(tmpdir(), 'no-such-flow.mjs') });
  assert.deepEqual(r3.output, { records: [{ model: MODEL_TOOL.length, flow: false }] });
  assert.equal(r3.meta.flow, false);
});

test('the real flow.mjs (builder A), when present: a guard deopts with exit 75', { skip: skip || (!existsSync(DEFAULT_FLOW) && 'flow.mjs not written yet') }, async t => {
  const { r } = await run(t, 'deopt', { flowPath: DEFAULT_FLOW });
  assert.equal(r.status, 'deopt', JSON.stringify(r.meta)); assert.equal(r.deopt.kind, 'guard'); assert.equal(r.deopt.name, 'known-dialects');
  assert.ok(r.trace.length >= 1);
  const { r: ok } = await run(t, 'ok', { flowPath: DEFAULT_FLOW });
  assert.equal(ok.status, 'ok', JSON.stringify(ok.meta)); assert.equal(ok.output.records.length, 3);
  assert.ok(readFileSync(DEFAULT_FLOW, 'utf8').includes('createFlow'));
  assert.deepEqual(ok.flags, { count: 0, names: [] }, 'a run that raised no flag reports none');
});

test('flags: runCompiled returns the count and names of the uncertainty flags in the trace (real flow.mjs); the answer is unchanged', { skip }, async t => {
  const { r } = await run(t, 'flagged', { flowPath: DEFAULT_FLOW });
  assert.equal(r.status, 'ok', JSON.stringify(r.meta)); assert.deepEqual(r.output, { records: [{ id: 1 }, { id: 2 }, { id: 3 }] });
  assert.deepEqual(r.flags, { count: 3, names: ['weak-name-match', 'default-used'] });
  const { r: fixture } = await run(t, 'deopt');
  assert.deepEqual(fixture.flags, { count: 0, names: [] }, 'a flow without flag support reports zero flags');
});

test('flagsOf: the final totals win (they count flags past the event cap); without totals the flag events are counted', () => {
  assert.deepEqual(flagsOf([]), { count: 0, names: [] }); assert.deepEqual(flagsOf(undefined), { count: 0, names: [] });
  assert.deepEqual(flagsOf([{ kind: 'flag', name: 'a' }, { kind: 'flag', name: 'b' }, { kind: 'flag', name: 'a' }]), { count: 3, names: ['a', 'b'] }, 'a timeout: no totals');
  assert.deepEqual(flagsOf([{ kind: 'flag', name: 'a' }, { kind: 'done', flags: 7, flagNames: ['a', 'c'] }]), { count: 7, names: ['a', 'c'] });
  assert.deepEqual(flagsOf([{ kind: 'flag', name: 'x' }, { kind: 'crash', name: 'uncaught', flags: 1, flagNames: ['x'] }]), { count: 1, names: ['x'] });
  assert.deepEqual(flagsOf([{ kind: 'done', spentUsd: 0 }]), { count: 0, names: [] });
});
