#!/usr/bin/env node
// Generates run-view fixtures by driving the REAL runtime (src/runtime.mjs, src/store.mjs, src/models/port.mjs, src/journal.mjs) with a
// ScriptedProvider and synthetic local capabilities. Every event in the output was written by the production event writer and chained by
// the production store; only the model replies and tool results are scripted. No network, no model spend. Development/diagnostic evidence.
//
//   node tools/run-view/make-fixtures.mjs --out DIR [--only finished,paused,envfault,scale] [--scale-items 1000]
//
// Output (DIR/): zoo-finished.json, zoo-paused.json, zoo-envfault.json, scale-N.json (run-view JSON, schema foundry-run-view/1)
//                and fixtures.log.json with the writer-side timing of each run (measured, this machine).
// The workflows are illustrative: a game-QA-flavoured pipeline (the owner's example) whose "visual understanding" step receives text
// stand-ins for screenshots, because the IR has no image input yet (research/review-20261007/06-ui.md, section 2).
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { Store } from '../../src/store.mjs';
import { Runtime } from '../../src/runtime.mjs';
import { createDefaultRegistry } from '../../src/capabilities.mjs';
import { validateWorkflow } from '../../src/validate.mjs';
import { loadPolicy } from '../../src/models/policy.mjs';
import { ModelPort } from '../../src/models/port.mjs';
import { Journal } from '../../src/journal.mjs';
import { ScriptedProvider } from '../../src/models/providers/scripted.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const loaded = loadPolicy();
const M = 'claude-haiku-5-5', L = 'claude-sonnet-5-5', S1 = 'qwen3.5-2b-q4km';
const ref = $ref => ({ $ref });
const eq = (left, right) => ({ op: 'eq', left, right });
const exists = value => ({ op: 'exists', value });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const base = (id, title, goal, nodes, acceptance, extra = {}) => ({
  schemaVersion: '1.0', id, version: 1, title, goal, domain: 'general', envelope: { assumptions: ['Scripted provider and synthetic local tools: a fixture, not a task run'], risks: ['None: no external effect'], successCriteria: ['The acceptance checks hold'] },
  budget: { maxSteps: 20000, maxConcurrency: 8, maxDurationMs: 600000, maxCost: 5, ...(extra.budget ?? {}) }, nodes, acceptance, ...(extra.labels ? { labels: extra.labels } : {}) });
const task = (id, tool, args, needs = [], extra = {}) => ({ id, kind: 'task', needs, description: extra.description ?? `Run ${tool}`, tool, args, timeoutMs: 20000, retry: { maxAttempts: 1 }, ...extra });
const describeReturns = { type: 'object', additionalProperties: false, required: ['objects', 'anomaly', 'confidence'], properties: { objects: { type: 'array', items: { type: 'string' }, maxItems: 20 }, anomaly: { type: 'boolean' }, confidence: { type: 'number' } } };
const confident = { op: 'gte', left: ref('output.confidence'), right: 0.6 };

export function registryWith(extra = {}) {
  const registry = createDefaultRegistry();
  const reg = (name, effects, handler, more = {}) => registry.register({ name, version: '1', description: `Scripted fixture tool ${name}`, implementation: `run-view-fixture/${name}`, inputSchema: {}, outputSchema: {}, effects, risk: 'low', requiresApproval: false, maxTimeoutMs: 30000, cancellation: 'cooperative', cost: 0, execute: handler, ...more });
  reg('qa.capture', 'none', async () => { await sleep(120); return { frames: [{ id: 'f1', scene: 'menu' }, { id: 'f2', scene: 'tavern, low light' }, { id: 'f3', scene: 'bridge, clipping' }, { id: 'f4', scene: 'boss arena, particles' }] }; });
  reg('qa.step', 'none', async ({ value }) => { await sleep(90); return { value: value + 1 }; });
  reg('qa.file_bug', 'idempotent', async a => ({ filed: true, ...a }), { risk: 'high', requiresApproval: true });
  for (const [name, fn] of Object.entries(extra)) reg(name, 'none', fn);
  return registry;
}
export function environment(root, script, policy = {}, registry = registryWith()) {
  const store = new Store(root), provider = new ScriptedProvider(script);
  const models = new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(store) });
  const runtime = new Runtime(store, registry, { allowedCapabilities: registry.list().map(c => c.name), maxCost: 5, maxConcurrency: 16, maxSteps: 50000, ...policy }, { models, modelPolicy: loaded });
  return { store, provider, models, runtime, registry };
}
const frameOf = prompt => /"id":"(f\d+)"/.exec(prompt)?.[1] ?? '?';
const usage = (i = 900, o = 120) => ({ inputTokens: i, outputTokens: o });
const good = { objects: ['door', 'torch', 'player'], anomaly: false, confidence: 0.92 };

// ----------------------------------------------------------------------------------------------------------- the finished run
export function finishedWorkflow() {
  const nodes = [
    task('capture', 'qa.capture', {}, [], { description: 'Capture frames from the build under test' }),
    { id: 'visual_understanding', kind: 'map', needs: ['capture'], description: 'Describe what is on every captured frame', items: ref('nodes.capture.frames'), maxItems: 8, concurrency: 2, failure: 'collect',
      body: { nodes: [{ id: 'describe', kind: 'agent', needs: [], description: 'Describe one frame and say whether anything looks wrong', role: 'extract', instructions: 'List the visible objects, say whether anything looks broken, and give your confidence from 0 to 1.',
        context: { inputs: [{ name: 'frame', ref: 'item', render: 'json' }] }, returns: describeReturns, model: { class: 'M', maxClass: 'L' }, checks: [confident] }], acceptance: [exists(ref('nodes.describe.objects'))] } },
    { id: 'reproduce', kind: 'loop', needs: ['capture'], description: 'Replay the suspicious scene until the glitch reproduces', maxIterations: 4, initial: { step: { value: 0 } }, input: { limit: 3 },
      until: { op: 'gte', left: ref('nodes.step.value'), right: ref('input.limit') },
      body: { nodes: [task('step', 'qa.step', { value: ref('previous.step.value') }, [], { description: 'Replay once' })], acceptance: [exists(ref('nodes.step.value'))] } },
    { id: 'severity', kind: 'agent', needs: ['visual_understanding', 'reproduce'], description: 'Rate the severity of the glitch', role: 'classify', instructions: 'Rate the severity of the reported glitch as minor, major or blocker.',
      context: { inputs: [{ name: 'player_report', ref: 'input.notes', render: 'text' }, { name: 'frames_seen', ref: 'nodes.visual_understanding.count', render: 'json' }] },
      returns: { type: 'object', additionalProperties: false, required: ['severity'], properties: { severity: { enum: ['minor', 'major', 'blocker'] } } }, model: { class: 'M' } },
    { id: 'qa_judge', kind: 'verify', needs: ['severity'], description: 'Independently judge the severity call', method: 'agent', independence: 'different-model', gate: false,
      instructions: 'Decide whether the severity rating is justified by the player report.', subject: ref('nodes.severity'), context: { inputs: [{ name: 'player_report', ref: 'input.notes', render: 'text' }] }, model: { class: 'S' } },
    task('perf_pass', 'core.identity', { ran: true }, ['severity'], { description: 'Run the optional performance pass', when: eq(ref('input.perf'), true) }),
    task('report', 'core.identity', { severity: ref('nodes.severity.severity'), frames: ref('nodes.visual_understanding.count') }, ['severity', 'qa_judge'], { description: 'Write the QA report' })
  ];
  return base('GameQAFixture', 'Game QA, scripted fixture', 'Illustrative game-QA pipeline for the run viewer (scripted provider; text stand-ins for screenshots)', nodes, [exists(ref('nodes.report.severity'))],
    { labels: { 'input.notes': 'untrusted:player-report' } });
}
export function finishedScript() {
  const seen = new Map(), n = (key) => { const v = (seen.get(key) ?? 0) + 1; seen.set(key, v); return v; };
  return {
    [M]: async (a) => {
      if (/severity/i.test(a.prompt) && /player_report/.test(a.prompt)) { await sleep(260); return n('sev') === 1 ? { text: 'major, probably', usage: usage(700, 12) } : { value: { severity: 'major' }, usage: usage(700, 14) }; }
      const f = frameOf(a.prompt); await sleep(f === 'f1' ? 380 : 300);
      if (f === 'f1') return { value: good, usage: usage() };
      if (f === 'f2') return { value: { objects: ['table', 'lamp'], anomaly: true, confidence: 0.31 }, usage: usage() };
      if (f === 'f3') return { text: 'I think there is a bridge', usage: usage(900, 18) };
      return { value: { objects: ['boss'], anomaly: true, confidence: 0.2 }, usage: usage() };
    },
    [L]: async (a) => {
      const f = frameOf(a.prompt); await sleep(700);
      if (f === 'f4') return { value: { objects: ['boss', 'particles'], anomaly: true, confidence: 0.3 }, usage: usage(950, 160) };
      return { value: { objects: ['bridge', 'plank', 'player'], anomaly: f === 'f3', confidence: 0.88 }, usage: usage(950, 160) };
    },
    [S1]: async () => { await sleep(450); return { value: { pass: false, score: 0.4, reasons: ['The report only says "major, probably"; nothing shows the frame budget was exceeded.'] }, usage: usage(500, 60) }; }
  };
}

// ------------------------------------------------------------------------------------------------------------- the paused run
export function pausedWorkflow() {
  return base('GameQAPaused', 'Game QA waiting on people and time, scripted fixture', 'A run that is paused three ways: a question, a timer and an operation awaiting approval', [
    task('capture', 'qa.capture', {}, [], { description: 'Capture frames from the build under test' }),
    { id: 'triage', kind: 'human', needs: ['capture'], description: 'A tester decides whether the glitch is worth a bug report', question: 'Frame f3 shows a clipping bridge. File a bug?', answerSchema: { type: 'boolean' } },
    { id: 'soak', kind: 'wait', needs: ['capture'], description: 'Let the build soak for an hour before the second pass', delayMs: 3600000 },
    task('file_bug', 'qa.file_bug', { title: 'Bridge clipping', frame: 'f3' }, ['capture'], { description: 'File the bug in the tracker (needs approval)' }),
    { id: 'summarise', kind: 'agent', needs: ['capture'], description: 'Summarise the capture for the report', role: 'synthesis', instructions: 'Summarise the capture in one sentence.', context: { inputs: [{ name: 'frames', ref: 'nodes.capture.frames', render: 'json' }] },
      returns: { type: 'object', additionalProperties: false, required: ['summary'], properties: { summary: { type: 'string', maxLength: 300 } } }, model: { class: 'M' } }
  ], [exists(ref('nodes.file_bug.filed'))]);
}
// ---------------------------------------------------------------------------------------------------------------- the nested run
// A map whose body holds a loop (frames inside frames: root/cases:1/settle:2/step), to check that nested containers fold and drill down.
export function nestedWorkflow() {
  const nodes = [
    task('plan', 'core.identity', { cases: [{ n: 2 }, { n: 3 }, { n: 1 }] }, [], { description: 'Choose the glitch cases to replay' }),
    { id: 'cases', kind: 'map', needs: ['plan'], description: 'Replay each glitch case until it settles', items: ref('nodes.plan.cases'), maxItems: 8, concurrency: 2, failure: 'collect',
      body: { nodes: [
        { id: 'settle', kind: 'loop', needs: [], description: 'Replay once per iteration until the counter reaches the case limit', maxIterations: 4, initial: { step: { value: 0 } }, input: { limit: ref('item.n') },
          until: { op: 'gte', left: ref('nodes.step.value'), right: ref('input.limit') },
          body: { nodes: [task('step', 'qa.step', { value: ref('previous.step.value') }, [], { description: 'Replay once' })], acceptance: [exists(ref('nodes.step.value'))] } },
        task('record', 'core.identity', { replays: ref('nodes.settle.iterations') }, ['settle'], { description: 'Record how many replays the case needed' })
      ], acceptance: [exists(ref('nodes.record.replays'))] } },
    task('report', 'core.identity', { cases: ref('nodes.cases.count') }, ['cases'], { description: 'Write the replay report' })
  ];
  return base('GameQANested', 'Game QA with a loop inside a map, scripted fixture', 'Frames inside frames for the run viewer', nodes, [exists(ref('nodes.report.cases'))]);
}
// ---------------------------------------------------------------------------------------------------------- the env-fault run
export function envfaultWorkflow() {
  const agent = (id, description) => ({ id, kind: 'agent', needs: ['capture'], description, role: 'extract', instructions: description, context: { inputs: [{ name: 'frames', ref: 'nodes.capture.frames', render: 'json' }] }, returns: describeReturns, model: { class: 'M', maxClass: 'L' }, checks: [confident] });
  return base('GameQAEnvFault', 'Game QA hitting a provider rate limit, scripted fixture', 'One branch finishes, the other meets a provider fault that must not be escalated', [
    task('capture', 'qa.capture', {}, [], { description: 'Capture frames from the build under test' }), agent('menu_check', 'Describe the menu frames'), agent('arena_check', 'Describe the arena frames'),
    task('report', 'core.identity', { ok: true }, ['menu_check', 'arena_check'], { description: 'Write the QA report' })
  ], [exists(ref('nodes.report.ok'))]);
}

// ------------------------------------------------------------------------------------------------------------------- scale run
export function scaleWorkflow(n) {
  return base('GameQAScale', `Scale fixture, ${n} items, scripted`, `${n} items judged by one narrow node each, to measure the viewer`, [
    task('capture', 'core.identity', { n }, [], { description: 'Prepare the batch' }),
    { id: 'judge_frames', kind: 'map', needs: ['capture'], description: 'Judge every frame', items: ref('input.items'), maxItems: Math.max(n, 1), concurrency: 16, failure: 'collect',
      body: { nodes: [{ id: 'describe', kind: 'agent', needs: [], description: 'Describe one frame', role: 'extract', instructions: 'Describe the frame.', context: { inputs: [{ name: 'frame', ref: 'item', render: 'json' }] }, returns: describeReturns, model: { class: 'M', maxClass: 'L' }, checks: [confident] }], acceptance: [exists(ref('nodes.describe.objects'))] } },
    task('merge', 'core.identity', { count: ref('nodes.judge_frames.count') }, ['judge_frames'], { description: 'Merge the verdicts' })
  ], [exists(ref('nodes.merge.count'))]);
}
export function scaleScript() {
  const idOf = prompt => Number(/"id":(\d+)/.exec(prompt)?.[1] ?? -1);
  const esc = i => i % 13 === 0, dead = i => i % 37 === 5;           // deterministic: ~7.7% escalate, ~2.7% exhaust
  return {
    [M]: async a => { const i = idOf(a.prompt); await sleep(4 + (i % 7)); return { value: esc(i) || dead(i) ? { objects: ['x'], anomaly: true, confidence: 0.2 } : good, usage: usage() }; },
    [L]: async a => { const i = idOf(a.prompt); await sleep(8); return { value: dead(i) ? { objects: ['x'], anomaly: true, confidence: 0.1 } : { ...good, confidence: 0.85 }, usage: usage(950, 150) }; }
  };
}

// ------------------------------------------------------------------------------------------------------------------------ driver
function exportRun(root, runId, outFile, hints) {
  const cli = path.join(here, 'export-run.mjs');
  const r = spawnSync(process.execPath, [cli, '--workspace', root, '--run', runId, '--out', outFile, ...(hints ? ['--hints', hints] : [])], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`export failed: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout);
}
let args = { out: '.', keep: false };
async function runOne(name, workflow, { script, input = {}, policy, register, drive, hints } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), `run-view-fixture-${name}-`));
  const registry = registryWith(register);
  const validation = validateWorkflow(workflow, { registry, modelPolicy: loaded });
  if (!validation.valid) throw new Error(`${name}: ${JSON.stringify(validation.errors)}`);
  const env = environment(root, script, policy, registry);
  env.store.saveWorkflow(workflow);
  const run = env.runtime.create(workflow, input);
  const t0 = performance.now();
  const result = await (drive ? drive(env, run) : env.runtime.execute(run.id));
  const wallMs = performance.now() - t0;
  const t1 = performance.now(), events = env.store.events(run.id), verifyMs = performance.now() - t1;     // what GET /api/runs/:id does on every 3 s poll of the existing web UI
  const inspectBytes = JSON.stringify({ ...env.store.run(run.id), events }).length;
  const stat = { verifyAllEventsMs: Math.round(verifyMs * 10) / 10, inspectRunBytes: inspectBytes, name, runId: run.id, status: result.status, events: events.length, modelCalls: env.provider.calls.length, wallMs: Math.round(wallMs), eventsPerSecond: Math.round(events.length / (wallMs / 1000)), runBlobBytes: JSON.stringify(env.store.run(run.id)).length };
  env.store.close();
  const out = path.join(args.out, `${name}.json`);
  stat.export = exportRun(root, run.id, out, hints);
  if (!args.keep) rmSync(root, { recursive: true, force: true });
  console.error(`${name}: ${stat.status}, ${stat.events} events, ${stat.modelCalls} model calls, ${stat.wallMs} ms (${stat.eventsPerSecond} events/s), export ${stat.export.bytes} bytes`);
  return stat;
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { out: { type: 'string' }, only: { type: 'string', default: 'finished,paused,envfault,nested,scale' }, 'scale-items': { type: 'string', default: '1000' }, keep: { type: 'boolean', default: false } } });
  if (!values.out) { console.error('Need --out DIR'); process.exit(2); }
  args = values; mkdirSync(args.out, { recursive: true });
  const only = new Set(args.only.split(','));
  const log = [];
  const hintFile = path.join(args.out, '.zoo-hints.json');
  writeFileSync(hintFile, JSON.stringify({ labels: { visual_understanding: 'Visual understanding', reproduce: 'Reproduce the glitch', severity: 'Severity call', qa_judge: 'Independent QA judge', capture: 'Capture frames' } }));
  if (only.has('finished')) log.push(await runOne('zoo-finished', finishedWorkflow(), { script: finishedScript(), input: { notes: 'Bridge in the tavern district clips through the player and the frame rate drops.', perf: false }, hints: hintFile }));
  if (only.has('paused')) log.push(await runOne('zoo-paused', pausedWorkflow(), { script: { [M]: async () => { await sleep(250); return { value: { summary: 'Four frames: menu, tavern, bridge, arena.' }, usage: usage(400, 30) }; } }, hints: hintFile }));
  if (only.has('envfault')) log.push(await runOne('zoo-envfault', envfaultWorkflow(), { script: { [M]: async a => {
    await sleep(350);
    if (/Describe the arena frames/.test(a.prompt)) return { error: { code: 'MODEL_RATE_LIMIT', message: 'Simulated provider rate limit (429). Scripted fixture.' } };
    return { value: good, usage: usage() };
  }, [L]: async () => ({ value: good, usage: usage() }) }, hints: hintFile }));
  if (only.has('nested')) log.push(await runOne('zoo-nested', nestedWorkflow(), { script: {}, hints: hintFile }));
  if (only.has('scale')) {
    const n = Number(args['scale-items']);
    log.push(await runOne(`scale-${n}`, scaleWorkflow(n), { script: scaleScript(), input: { items: Array.from({ length: n }, (_, id) => ({ id, scene: `scene ${id}` })) } }));
  }
  writeFileSync(path.join(args.out, only.size === 1 && only.has('scale') ? `fixtures.scale-${args['scale-items']}.log.json` : 'fixtures.log.json'), JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, runs: log }, null, 1));
  rmSync(hintFile, { force: true });

}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
