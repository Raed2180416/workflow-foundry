// flow-v3 slice 2b: flow.wide and the per-item failure policy of map and wide (design/FLOW-V3-SLICE2.md §10-§11), end to end
// over the real gateway (startServices) with a stub model port, against W-bed R3 (beds/wbed/r3: 48 supplier statements at
// d5). The stub "judge" answers each statement from the bed's own reference trace (analyst side, test only), so the wide
// operator's mechanics are checked by R3's oracle: a typed work list of 48, one judgment per item, the concurrency cap, the
// operator's total budget, typed coverage into a code reducer, per-item events, prompt-prefix sharing (6b), onItemError
// 'null' / 'retry(n)' / 'crash' including a judge deopt inside an item, and a planned list with one replan. No model calls; $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MODEL_TOOL } from '../../c0/construct.mjs';
import { startServices, Ledger } from '../../lib/services.mjs';
import { FLOW_V3 } from '../run-compiled.mjs';
import * as R3 from '../../../beds/wbed/r3/index.mjs';
import { buildAudit } from '../../../beds/wbed/r3/world.mjs';
import { toUsdCents } from '../../../beds/wbed/lib/domain.mjs';

const HAIKU = 'claude-haiku-5-5', SONNET = 'claude-sonnet-5-5';
const tmp = (t, p = 'jit-wide-') => { const d = mkdtempSync(path.join(tmpdir(), p)); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const POLICY = { models: [HAIKU, SONNET].map(id => ({ id, provider: 'p', price: { inputPerMTok: 0, outputPerMTok: 0 } })) };
const VOCAB_URL = pathToFileURL(path.resolve(new URL('../../../beds/wbed/r3/vocab.mjs', import.meta.url).pathname)).href;

const R3_TASK = { seed: 301, split: 'dev', difficulty: 5 };
// The analyst-side answer per statement file: the reference statement row and its per-reason US-cent contributions (the
// bed's reducer converts per supplier per reason, so the per-item cents sum exactly).
function answers(task) {
  const w = buildAudit(task.seed, task.split, task.difficulty), ref = R3.referenceTrace(task).reduce;
  const byId = new Map(ref.statements.map(s => [s.vendor_id, s]));
  const out = new Map();
  for (const v of w.vendors) {
    const st = byId.get(v.id), usd = {};
    for (const reason of new Set(st.discrepancies.map(d => d.reason))) usd[reason] = toUsdCents(st.discrepancies.filter(d => d.reason === reason).reduce((s, d) => s + d.amount_minor, 0), v.currency, w.quotes[v.currency]);
    out.set(v.file, { statement: st, usd });
  }
  return out;
}

// A stub model port: per statement file the reference answer; a plan request gets planner(prompt). It records concurrency,
// the order of call starts and ends, and each request's system prompt.
function stubPort({ table, costUsd = 0.01, planner = null, failFor = () => false, delayMs = 5 }) {
  const log = { inFlight: 0, peak: 0, starts: [], ends: [] };
  return { log, policy: POLICY, providers: {}, policyHash: 'stub', async call(r) {
    log.inFlight++; log.peak = Math.max(log.peak, log.inFlight); log.starts.push({ at: Date.now(), system: r.system, prompt: r.prompt.slice(0, 80) });
    await new Promise(res => setTimeout(res, delayMs));
    log.inFlight--;
    let value;
    if (r.prompt.startsWith('PLAN')) value = planner(r.prompt);
    else { const file = /^statement (\S+)/.exec(r.prompt)?.[1]; value = failFor(file, r) ? { statement: null } : table.get(file); }
    log.ends.push({ at: Date.now() });
    return { ok: true, value, costUsd, modelId: r.modelId };
  } };
}

async function runSolver(t, { source, port, capUsd = 2, task }) {
  const dir = tmp(t, 'jit-widep-');
  mkdirSync(path.join(dir, 'tools'));
  const ledger = new Ledger({ capUsd, label: 'root' });
  const svc = await startServices({ modelPort: port, ledger, allowedModels: [HAIKU, SONNET] });
  writeFileSync(path.join(dir, 'tools/model.mjs'), MODEL_TOOL); copyFileSync(FLOW_V3, path.join(dir, 'tools/flow.mjs'));
  writeFileSync(path.join(dir, 'tools/gateway.json'), JSON.stringify({ url: svc.url, token: svc.token }));
  writeFileSync(path.join(dir, 'task.json'), JSON.stringify(task ? { prompt: task.prompt, inputs: task.inputs } : { prompt: 'p', inputs: {} }));
  writeFileSync(path.join(dir, 'solve.mjs'), `import { createFlow } from './tools/flow.mjs';\n${source}`);
  const child = spawn(process.execPath, ['solve.mjs', 'task.json'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  const code = await new Promise(resolve => child.on('close', resolve));
  await svc.close({ graceMs: 1000 });
  const deopt = existsSync(path.join(dir, 'deopt.json')) ? JSON.parse(readFileSync(path.join(dir, 'deopt.json'), 'utf8')) : null;
  const last = stdout.trim().split('\n').filter(Boolean).at(-1);
  return { code, stderr, trace: lines(path.join(dir, 'trace.jsonl')), deopt, output: last === undefined ? undefined : JSON.parse(last), ledger };
}
const ofKind = (trace, k) => trace.filter(e => e.kind === k);

// The parent solver: one item per statement file, a judge per item (check: the vendor echoed), a code reducer assembling R3's
// answer from typed coverage; wide options are spliced in.
const R3_SOLVER = (wideOpts = '', after = '') => `import { REASONS, ACCEPTED } from '${VOCAB_URL}';
const flow = createFlow({ budgetUsd: 2 });
const task = flow.input();
const files = Object.keys(task.inputs.statements).sort();
const ITEM = { type: 'object', required: ['file'], properties: { file: { type: 'string' } } };
const table = await flow.wide('statements', {
  items: files.map(file => ({ file })), itemSchema: ITEM, maxFanout: 48,
  worker: { judge: { tiers: ['${HAIKU}', '${SONNET}'], system: 'Audit one supplier statement against the ledger.', schema: { type: 'object' },
    prompt: it => 'statement ' + it.file + '\\n' + task.inputs.statements[it.file], check: v => (v && v.statement ? null : 'no statement') } },
  reduce: (results, coverage) => {
    const got = results.filter(Boolean);
    const by_reason = REASONS.map(reason => ({ reason, count: got.reduce((s, r) => s + r.statement.discrepancies.filter(d => d.reason === reason).length, 0),
      usd_cents: got.reduce((s, r) => s + (r.usd[reason] ?? 0), 0) }));
    const sum = rs => by_reason.filter(x => rs.includes(x.reason)).reduce((s, x) => s + x.usd_cents, 0);
    return { statements: got.map(r => r.statement), by_reason, coverage: { done: coverage.done, failed: coverage.failed, skipped: coverage.skipped },
      totals: { statements: got.length, discrepancies: by_reason.reduce((s, x) => s + x.count, 0), difference_usd_cents: sum(REASONS), adjustments_usd_cents: sum([...ACCEPTED]) } };
  },
  verify: v => (v.totals.statements === v.statements.length ? null : 'statement count'),
  budgetUsd: 1, concurrency: 8 ${wideOpts} });
${after}
const { coverage, ...answer } = table;
flow.done({ answer, coverage, spent: flow.spent() });`;

test('flow.wide over R3 d5 (48 statements): one judgment per item under the concurrency cap, a code reducer, R3\'s oracle passes; events and budget per item', async t => {
  const task = R3.generate(R3_TASK), table = answers(task);
  assert.equal(Object.keys(task.inputs.statements).length, 48);
  const port = stubPort({ table });
  const r = await runSolver(t, { source: R3_SOLVER(', prefixShare: false'), port, task });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(R3.oracle(task, r.output.answer).pass, true, JSON.stringify(R3.oracle(task, r.output.answer).details));
  assert.ok(port.log.peak <= 8 && port.log.peak >= 4, `peak in flight ${port.log.peak}`);
  const items = ofKind(r.trace, 'wide-item');
  assert.equal(items.length, 48); assert.ok(items.every(e => e.status === 'done' && e.costUsd === 0.01 && e.span === 'wide:statements#0'));
  assert.deepEqual([...new Set(items.map(e => e.i))].sort((a, b) => a - b), [...Array(48).keys()]);
  const judges = ofKind(r.trace, 'judge');
  assert.equal(judges.length, 48); assert.ok(judges.every(e => e.wide === 'wide:statements#0' && Number.isInteger(e.item)), 'events inside an item carry wide and item');
  const plan = ofKind(r.trace, 'wide-plan')[0], end = ofKind(r.trace, 'wide-end')[0];
  assert.equal(plan.n, 48); assert.deepEqual(plan.issues, []); assert.equal(plan.planned, false);
  assert.equal(end.ok, true); assert.equal(end.done, 48); assert.equal(end.spentUsd, 0.48); assert.equal(end.prefix, undefined);
  assert.deepEqual(r.output.coverage, { done: 48, failed: 0, skipped: 0 });
  assert.equal(ofKind(r.trace, 'wide-verify')[0].ok, true);
  assert.equal(r.trace.at(-1).wides, 1); assert.equal(Math.round(r.ledger.spentUsd * 1e6) / 1e6, 0.48);
});

test('flow.wide prefix sharing (6b): siblings with one prompt prefix wait for the first response, then go; the ledger reports the cache-read share when the port reports usage', async t => {
  const task = R3.generate(R3_TASK), table = answers(task);
  const port = stubPort({ table, delayMs: 20 });
  const r = await runSolver(t, { source: R3_SOLVER(), port, task });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(R3.oracle(task, r.output.answer).pass, true);
  const first = port.log.ends[0].at;
  assert.equal(port.log.starts.filter(s => s.at < first).length, 1, 'only the leader runs before the first response');
  const end = ofKind(r.trace, 'wide-end')[0];
  assert.equal(end.prefix.groups, 1);
  const held = ofKind(r.trace, 'wide-item').filter(e => e.heldMs !== undefined);
  assert.equal(held.length, end.prefix.held); assert.ok(end.prefix.held >= 1 && end.prefix.held <= 7, `held ${end.prefix.held}: the followers that started before the first response`);
  // Usage on the ledger: a port that reports cache reads (the leader writes the prefix, the siblings read it).
  const ledger = new Ledger({ capUsd: 1, label: 'u' });
  ledger.charge({ costUsd: 0.01, usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 900 } });
  for (let i = 0; i < 3; i++) ledger.charge({ costUsd: 0.001, usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 900, cacheWriteTokens: 0 } });
  assert.equal(ledger.cacheReadShare(), 0.675); assert.equal(ledger.usage.calls, 4);
  assert.equal(new Ledger({ capUsd: 1, label: 'v' }).cacheReadShare(), null);
});

test('flow.wide total budget: items start only while the operator\'s spend fits; the rest are skipped (typed coverage); quorum decides', async t => {
  const task = R3.generate(R3_TASK), table = answers(task);
  const low = await runSolver(t, { source: R3_SOLVER(", budgetUsd: 0.2, quorum: 0.25, prefixShare: false").replace('budgetUsd: 1, concurrency: 8', 'concurrency: 8'), port: stubPort({ table }), task });
  assert.equal(low.code, 0, low.stderr);
  const cov = low.output.coverage;
  assert.equal(cov.failed, 0); assert.equal(cov.done + cov.skipped, 48); assert.ok(cov.skipped > 0 && cov.done >= 12, JSON.stringify(cov));
  const end = ofKind(low.trace, 'wide-end')[0];
  assert.ok(end.spentUsd <= 0.2 + 1e-9, `spent ${end.spentUsd}`); assert.equal(end.budgetUsd, 0.2);
  assert.equal(ofKind(low.trace, 'wide-item').length, cov.done, 'one event per item that ran');
  const strict = await runSolver(t, { source: R3_SOLVER(", budgetUsd: 0.2, prefixShare: false").replace('budgetUsd: 1, concurrency: 8', 'concurrency: 8'), port: stubPort({ table }), task });
  assert.equal(strict.code, 75); assert.equal(strict.deopt.kind, 'wide'); assert.equal(strict.deopt.detail.refused, 'quorum');
  const tooSmall = await runSolver(t, { source: R3_SOLVER(', itemFloorUsd: 0.05'), port: stubPort({ table }), task });
  assert.equal(tooSmall.code, 75); assert.equal(tooSmall.deopt.detail.refused, 'BUDGET_TOO_SMALL', '48 x $0.05 > $1');
  const over = await runSolver(t, { source: R3_SOLVER().replace('budgetUsd: 1, concurrency: 8', 'budgetUsd: 2, concurrency: 8'), port: stubPort({ table }), task });
  assert.equal(over.code, 75); assert.equal(over.deopt.detail.refused, 'budget-exceeds-parent', 'the operator budget must be below what the run has left');
});

test('onItemError: a judge deopt inside an item fails the item under null (item-deopt, coverage), and the run under crash (the default)', async t => {
  const task = R3.generate(R3_TASK), table = answers(task);
  const bad = new Set(Object.keys(task.inputs.statements).sort().filter((_, i) => i % 10 === 3));
  const failFor = file => bad.has(file);
  const soft = await runSolver(t, { source: R3_SOLVER(", onItemError: 'null', quorum: 0.8, prefixShare: false"), port: stubPort({ table, failFor }), task });
  assert.equal(soft.code, 0, soft.stderr);
  assert.deepEqual(soft.output.coverage, { done: 43, failed: 5, skipped: 0 });
  const deopts = ofKind(soft.trace, 'item-deopt');
  assert.equal(deopts.length, 5); assert.ok(deopts.every(e => e.deopt === 'judge' && e.wide === 'wide:statements#0'));
  assert.equal(ofKind(soft.trace, 'wide-item').filter(e => e.status === 'failed').every(e => /^deopt judge/.test(e.reason)), true);
  assert.equal(R3.oracle(task, soft.output.answer).pass, false, 'a null item is a missing statement: the oracle still sees it');
  const hard = await runSolver(t, { source: R3_SOLVER(", prefixShare: false"), port: stubPort({ table, failFor }), task });
  assert.equal(hard.code, 75); assert.equal(hard.deopt.kind, 'judge', 'crash keeps flow-v2 semantics: the item\'s deopt is the run\'s');
  // retry(1): a flaky item that fails its first attempt and passes its second.
  const seen = new Map();
  const flaky = (file, r) => { const n = (seen.get(file) ?? 0) + 1; seen.set(file, n); return bad.has(file) && n <= 2; };   // both tiers of attempt 1 fail
  const retried = await runSolver(t, { source: R3_SOLVER(", onItemError: 'retry(1)', prefixShare: false"), port: stubPort({ table, failFor: flaky }), task });
  assert.equal(retried.code, 0, retried.stderr);
  assert.deepEqual(retried.output.coverage, { done: 48, failed: 0, skipped: 0 });
  assert.equal(ofKind(retried.trace, 'wide-item').filter(e => e.attempts === 2).length, 5);
  assert.equal(R3.oracle(task, retried.output.answer).pass, true);
});

test('flow.wide plan: one judge plans the list, the check and maxFanout send it back once with the problems; a second bad plan refuses fanout', async t => {
  const fan = n => Array.from({ length: n }, (_, i) => ({ id: `x${i}` }));
  let plans = 0;
  const planner = prompt => { plans++; return { items: /problems/.test(prompt) ? fan(5) : fan(9) }; };
  const SRC = n => `const flow = createFlow({ budgetUsd: 1 });
const out = await flow.wide('entities', { plan: { tiers: ['${HAIKU}'], prompt: 'PLAN the entities', schema: { type: 'object' } }, maxFanout: ${n},
  check: list => list.every(x => /^x\\d+$/.test(x.id)) ? null : 'bad ids',
  worker: async (x, i) => ({ id: x.id, i }), reduce: (rs, cov) => ({ ids: rs.map(r => r.id), done: cov.done }), budgetUsd: 0.5 });
flow.done(out);`;
  const ok = await runSolver(t, { source: SRC(6), port: stubPort({ table: new Map(), planner }) });
  assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual(ok.output, { ids: ['x0', 'x1', 'x2', 'x3', 'x4'], done: 5 });
  const plan = ofKind(ok.trace, 'wide-plan')[0];
  assert.equal(plan.replanned, true); assert.equal(plan.n, 5); assert.equal(plan.planned, true); assert.equal(plans, 2);
  assert.match(ofKind(ok.trace, 'judge')[1].prompt, /9 items; at most 6/);
  plans = 0;
  const no = await runSolver(t, { source: SRC(4), port: stubPort({ table: new Map(), planner }) });
  assert.equal(no.code, 75); assert.equal(no.deopt.kind, 'wide'); assert.equal(no.deopt.detail.refused, 'fanout'); assert.equal(plans, 2);
});

test('map with onItemError: null needs a coverage reducer; retry(n) reruns a failing body; without options map is flow-v2\'s (no new keys)', async t => {
  const r = await runSolver(t, { source: `const flow = createFlow({ budgetUsd: 1 });
let threw = null; try { await flow.map([1, 2], x => x, { onItemError: 'null' }); } catch (e) { threw = e.message; }
const tries = new Map();
const a = await flow.map([1, 2, 3, 4], x => { if (x % 2 === 0) throw new Error('even ' + x); return x * 10; }, { onItemError: 'null', reduce: (out, cov) => ({ out, done: cov.done, failed: cov.failed, why: cov.items.filter(i => i.reason).map(i => i.reason) }) });
const b = await flow.map([1, 2, 3], x => { const n = (tries.get(x) ?? 0) + 1; tries.set(x, n); if (x === 2 && n === 1) throw new Error('flaky'); return x; }, { onItemError: 'retry(2)', name: 'retry' });
const c = await flow.map([1, 2], async x => x + 1);
flow.done({ threw, a, b, c });` });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.output.threw, /needs a reduce/);
  assert.deepEqual(r.output.a, { out: [10, null, 30, null], done: 2, failed: 2, why: ['even 2', 'even 4'] });
  assert.deepEqual(r.output.b, [1, 2, 3]); assert.deepEqual(r.output.c, [2, 3]);
  const maps = ofKind(r.trace, 'map');
  assert.deepEqual(Object.keys(maps.at(-1)).sort(), ['at', 'concurrency', 'kind', 'ms', 'n', 'name', 'ok'], 'the default map event is flow-v2\'s');
  assert.equal(maps[1].retried, 1); assert.equal(maps[1].onItemError, 'retry(2)'); assert.equal(maps[0].failed, 2);
  const crash = await runSolver(t, { source: `const flow = createFlow({ budgetUsd: 1 });
await flow.map([1, 2], x => { throw new Error('boom ' + x); }, { onItemError: 'retry(1)', concurrency: 1 });
flow.done('never');` });
  assert.equal(crash.code, 1); assert.match(crash.stderr, /boom 1/);
});

test('flow.wide with call workers and agent workers (stub call host): typed results per item; agent workers run at most two at a time', async t => {
  const { createRegistry, createCallHost } = await import('../call-host.mjs');
  const registry = createRegistry();
  const twice = registry.register({ contract: { output: { type: 'object', required: ['y'], properties: { y: { type: 'integer' } } } }, stub: async input => ({ output: { y: input.x * 2 }, costUsd: 0.01 }) });
  let running = 0, peak = 0;
  const runner = async a => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 15)); running--; return { answer: { n: a.files['a.txt'].length }, costUsd: 0.1 }; };
  const host = createCallHost({ registry, mode: 'stub', modelPort: { policy: POLICY, providers: {}, async call() { throw new Error('no model'); } }, agent: { runner, models: [HAIKU], model: HAIKU, textLabel: 'synthetic' } });
  const ledger = new Ledger({ capUsd: 2, label: 'root' });
  const dir = tmp(t, 'jit-widew-');
  mkdirSync(path.join(dir, 'tools'));
  const svc = await startServices({ modelPort: host.port({ budgetUsd: 2, ledger }), ledger, allowedModels: [HAIKU] });
  writeFileSync(path.join(dir, 'tools/model.mjs'), MODEL_TOOL); copyFileSync(FLOW_V3, path.join(dir, 'tools/flow.mjs'));
  writeFileSync(path.join(dir, 'tools/gateway.json'), JSON.stringify({ url: svc.url, token: svc.token }));
  writeFileSync(path.join(dir, 'task.json'), JSON.stringify({ prompt: 'p', inputs: {} }));
  writeFileSync(path.join(dir, 'solve.mjs'), `import { createFlow } from './tools/flow.mjs';
const flow = createFlow({ budgetUsd: 2 });
const calls = await flow.wide('double', { items: [1, 2, 3, 4, 5, 6], worker: { call: { hash: '${twice.hash}', budgetUsd: 0.05, input: x => ({ x }), name: x => 'S' + x } },
  reduce: rs => rs.map(r => r.y), budgetUsd: 0.5 });
const agents = await flow.wide('read', { items: ['a', 'bb', 'ccc'], concurrency: 8,
  worker: { agent: { spec: x => ({ instructions: 'Count the characters.', files: { 'a.txt': { text: x } }, returns: { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } } }),
    opts: { verify: (v, ctx) => (v.n === ctx.files['a.txt'].length ? null : 'wrong count'), budgetUsd: 0.2 } } },
  reduce: rs => rs.map(r => r.n), budgetUsd: 1 });
flow.done({ calls, agents });`);
  const child = spawn(process.execPath, ['solve.mjs', 'task.json'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  const code = await new Promise(resolve => child.on('close', resolve));
  await svc.close({ graceMs: 1000 });
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout.trim().split('\n').at(-1)), { calls: [2, 4, 6, 8, 10, 12], agents: [1, 2, 3] });
  assert.equal(peak, 2);
  const trace = lines(path.join(dir, 'trace.jsonl'));
  assert.deepEqual(ofKind(trace, 'wide-start').map(e => [e.name, e.worker, e.concurrency]), [['double', 'call', 8], ['read', 'agent', 2]]);
  assert.ok(ofKind(trace, 'call-end').every(e => e.wide === 'wide:double#0' && Number.isInteger(e.item)));
  assert.ok(ofKind(trace, 'agent-end').every(e => e.wide === 'wide:read#0' && e.ok));
  assert.deepEqual(ofKind(trace, 'wide-end').map(e => e.spentUsd), [0.06, 0.3]);
});
