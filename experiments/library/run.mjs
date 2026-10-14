// run.mjs: run an assembled solver at $0 (BUILD-ORDER step 3; LIBRARY §3.2 fixtures; LIBRARY-TESTS T4).
//
// The solver runs as a plain child process against the real flow-v3 SDK (experiments/jit/flow-v3.mjs, copied to
// tools/flow.mjs) and the real gateway (experiments/lib/services.mjs startServices over loopback, with a Ledger), whose
// model port is the real call host (experiments/jit/call-host.mjs createCallHost, stub mode) over a library registry
// (store.mjs) holding the fixture's stub children. Judges are answered by the flow-v3 replay override hook
// (tools/flow-override.mjs + tools/flow-override.json): a table {judgeName: [{when?, ordinal?, tier?, value | error}]},
// first matching rule wins, `when` is a substring of the judge prompt. The override never returns "call the model"; and the
// stub gateway's model port refuses every model request, so a judge without a stub answer deopts instead of spending.
// This is flow-v3-call.test.mjs part 1's arrangement (plain process, not the B1 sandbox; the sandboxed path is
// runCompiled, which this runner does not need for $0 fixtures).
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { MODEL_TOOL } from '../c0/construct.mjs';
import { startServices, Ledger } from '../lib/services.mjs';
import { createCallHost, FLOW_V3 } from '../jit/call-host.mjs';
import { canonicalJson } from '../jit/run-compiled.mjs';
import { learnProfile } from '../jit/profile.mjs';
import { FoundryError } from '../../src/data.mjs';
import { openLibrary } from './store.mjs';
import { assemble, resolveRefs } from './assemble.mjs';
import { validate } from './schema.mjs';

const STUB_POLICY = { models: [{ id: 'claude-haiku-5-5', provider: 'stub', price: { inputPerMTok: 0, outputPerMTok: 0 } }] };
export const OVERRIDE_SOURCE = `// $0 fixture override (experiments/library/run.mjs): answers every judge from tools/flow-override.json; never live.
import { readFileSync, appendFileSync } from 'node:fs';
const table = JSON.parse(readFileSync(new URL('./flow-override.json', import.meta.url), 'utf8'));
export default (site, request) => {
  const text = typeof request.prompt === 'string' ? request.prompt : JSON.stringify(request.prompt);
  const rules = table[site.name] ?? [];
  const i = rules.findIndex(r => (r.when == null || text.includes(r.when)) && (r.ordinal == null || r.ordinal === site.ordinal) && (r.tier == null || r.tier === site.tier));
  appendFileSync(new URL('./overrides.jsonl', import.meta.url), JSON.stringify({ id: site.id, name: site.name, ordinal: site.ordinal, tier: site.tier, rule: i }) + '\\n');
  if (i < 0) return { error: 'no stub answer for judge ' + site.name };
  return 'error' in rules[i] ? { error: rules[i].error } : { value: rules[i].value };
};
`;
// The sweep's replay override (sweep.mjs; LIBRARY §7.5 step 2): a judge request whose (model, system, prompt, schema) was
// journaled in a past run is answered from that journal at $0, the k-th identical request with the k-th journaled answer;
// any other request (a changed judge site) goes to the fallback table (the fixture format above: a $0 stub standing in
// for the live re-ask) or, without one, fails (the judge deopts and the sweep counts the run as unresolved).
// tools/flow-journal.json: {journal: {key: [value, ...]}, fallback: {judgeName: [rules]} | null}.
export const JOURNAL_OVERRIDE_SOURCE = `// sweep replay override (experiments/library/run.mjs): journal first, then the fallback table; never live.
import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const { journal, fallback } = JSON.parse(readFileSync(new URL('./flow-journal.json', import.meta.url), 'utf8'));
const canon = v => (v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}');
const sha = s => createHash('sha256').update(s).digest('hex');
const used = new Map();
export default (site, request) => {
  const text = typeof request.prompt === 'string' ? request.prompt : JSON.stringify(request.prompt);
  const key = sha(canon({ model: request.model, system: sha(String(request.system ?? '')), prompt: sha(text), schema: request.schema ?? null }));
  const k = used.get(key) ?? 0; used.set(key, k + 1);
  const hit = journal[key]?.[k];
  const log = source => appendFileSync(new URL('./overrides.jsonl', import.meta.url), JSON.stringify({ id: site.id, name: site.name, ordinal: site.ordinal, tier: site.tier, source }) + '\\n');
  if (hit !== undefined) { log('journal'); return { value: hit }; }
  const rules = fallback?.[site.name] ?? [];
  const i = rules.findIndex(r => (r.when == null || text.includes(r.when)) && (r.ordinal == null || r.ordinal === site.ordinal) && (r.tier == null || r.tier === site.tier));
  if (i >= 0) { log('fallback'); return 'error' in rules[i] ? { error: rules[i].error } : { value: rules[i].value }; }
  log('miss');
  return { error: 'sweep replay: judge request not in the journal and no fallback (a changed judge site needs a live re-ask)' };
};
`;
// The journal key of a judge request or of a past trace's judge event (system and prompt by their sha256, as a trace
// keeps a text over 64 KB only by its sha256 and head).
const _sha = s => createHash('sha256').update(s).digest('hex');
const _canon = v => (v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(_canon).join(',')}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${_canon(v[k])}`).join(',')}}`);
export const journalKeyOf = ({ model, system = '', prompt, schema = null, systemSha256 = null, promptSha256 = null }) =>
  _sha(_canon({ model, system: systemSha256 ?? _sha(String(system)), prompt: promptSha256 ?? _sha(typeof prompt === 'string' ? prompt : JSON.stringify(prompt)), schema }));
// A journal {key: [values in order]} from flow-v3 trace judge events (ok ones, with their value).
export function journalOfTrace(events = []) {
  const j = {};
  for (const e of events) if (e?.kind === 'judge' && e.ok === true && 'value' in e && e.tier) (j[journalKeyOf({ model: e.tier, system: e.system, prompt: e.prompt, schema: e.schema ?? null, systemSha256: e.systemSha256 ?? null, promptSha256: e.promptSha256 ?? null })] ??= []).push(e.value);
  return j;
}

const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

// A stub child (fixture): {name, contract: {input?, output, taskTemplate?}, profileInputs?: [input...], revoked?: bool,
// respond: [{when?: substring of the input's canonical JSON, output} | {when?, status: 'deopt', deopt: {kind, name}}]}.
function stubOf(child) {
  const respond = child.respond ?? [];
  return async input => {
    const key = canonicalJson(input);
    const rule = respond.find(r => r.when == null || key.includes(r.when));
    if (!rule) return { status: 'deopt', deopt: { kind: 'guard', name: 'stub-no-rule', detail: null } };
    return rule.status === 'deopt' ? { status: 'deopt', deopt: rule.deopt } : { output: rule.output };
  };
}
export function registerChildren(lib, children = []) {
  const refs = {};
  for (const c of children) {
    const taskTemplate = c.contract.taskTemplate ?? `fixture child ${c.name}`;
    const e = lib.register({ layer: 'L2', name: c.name, contract: { input: c.contract.input ?? null, output: c.contract.output, taskTemplate }, stub: stubOf(c),
      profile: c.profileInputs ? learnProfile(c.profileInputs.map(inputs => ({ prompt: taskTemplate, inputs }))) : null, ...(c.minBudgetUsd != null ? { minBudgetUsd: c.minBudgetUsd } : {}),
      tags: ['compose'], provenance: { source: 'maintainer', ref: 'fixture', licence: 'internal', redistributable: false } });
    if (c.revoked) lib.revoke(e.hash, 'fixture: revoked');
    refs[c.name] = e.hash;
  }
  return refs;
}

// Run solve.mjs source on a task. Returns {status: ok|deopt|crash|timeout|invalid, output, deopt, trace, flags, overrides,
// events (call host), liveModelCalls, spentUsd, exitCode, stderr}.
// replay: {journal, fallback} switches the override to the sweep's journal replay (JOURNAL_OVERRIDE_SOURCE).
export async function runSolver({ source, task, answers = {}, library = null, budgetUsd = 1, timeoutMs = 30000, outputSchema = null, workdir = null, keep = false, replay = null }) {
  const dir = workdir ?? mkdtempSync(path.join(tmpdir(), 'lib-run-'));
  let liveModelCalls = 0;
  const modelPort = { policy: STUB_POLICY, providers: {}, policyHash: 'stub', async call(r) { liveModelCalls++; throw new FoundryError('NO_LIVE_MODEL', `$0 runner: model ${r.modelId} requested; every judge must be answered by the override`); } };
  const lib = library ?? openLibrary(path.join(dir, 'library'));
  const host = createCallHost({ registry: lib.registry, mode: 'stub', modelPort });
  const ledger = new Ledger({ capUsd: budgetUsd, label: 'library-fixture' });
  const svc = await startServices({ modelPort: host.port({ budgetUsd, ledger }), ledger });
  try {
    mkdirSync(path.join(dir, 'tools'), { recursive: true });
    for (const stale of ['trace.jsonl', 'deopt.json', 'tools/overrides.jsonl', 'tools/calls.jsonl', 'tools/flow-journal.json']) rmSync(path.join(dir, stale), { force: true });
    writeFileSync(path.join(dir, 'tools/model.mjs'), MODEL_TOOL); copyFileSync(FLOW_V3, path.join(dir, 'tools/flow.mjs'));
    writeFileSync(path.join(dir, 'tools/gateway.json'), JSON.stringify({ url: svc.url, token: svc.token }));
    if (replay) {
      writeFileSync(path.join(dir, 'tools/flow-override.mjs'), JOURNAL_OVERRIDE_SOURCE);
      writeFileSync(path.join(dir, 'tools/flow-journal.json'), JSON.stringify({ journal: replay.journal ?? {}, fallback: replay.fallback ?? null }));
    } else {
      writeFileSync(path.join(dir, 'tools/flow-override.mjs'), OVERRIDE_SOURCE);
      writeFileSync(path.join(dir, 'tools/flow-override.json'), JSON.stringify(answers));
    }
    writeFileSync(path.join(dir, 'task.json'), JSON.stringify({ prompt: task.prompt ?? '', inputs: task.inputs ?? {}, ...(task.files ? { files: task.files } : {}) }));
    writeFileSync(path.join(dir, 'solve.mjs'), source);
    const child = spawn(process.execPath, ['--max-old-space-size=256', 'solve.mjs', 'task.json'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const exitCode = await new Promise(resolve => child.on('close', resolve));
    clearTimeout(timer);
    const trace = lines(path.join(dir, 'trace.jsonl'));
    const deopt = existsSync(path.join(dir, 'deopt.json')) ? JSON.parse(readFileSync(path.join(dir, 'deopt.json'), 'utf8')) : null;
    const last = stdout.trim().split('\n').filter(Boolean).at(-1);
    let output = null; try { output = last === undefined ? null : JSON.parse(last); } catch {}
    let status = timedOut ? 'timeout' : exitCode === 75 ? 'deopt' : exitCode === 0 && output !== null ? 'ok' : 'crash';
    let schemaErrors = null;
    if (status === 'ok' && outputSchema) { const v = validate(outputSchema, output); if (!v.valid) { status = 'invalid'; schemaErrors = v.errors; } }
    const flags = trace.filter(e => e.kind === 'flag').map(e => e.name);
    return { status, output: status === 'ok' || status === 'invalid' ? output : null, deopt: status === 'deopt' ? deopt : null, schemaErrors, trace, flags,
      overrides: lines(path.join(dir, 'tools/overrides.jsonl')), events: host.events.slice(), liveModelCalls, spentUsd: ledger.spentUsd, exitCode, stderr: stderr.slice(-2000), dir };
  } finally {
    await svc.close({ graceMs: 1000 });
    if (!keep && !workdir) rmSync(dir, { recursive: true, force: true });
  }
}

// A registered solve.mjs as a stub-mode child (store.mjs bindStub): each call runs the solver as its own $0 child process
// (runSolver) on the call's input, with the judge answers given, and returns the call host's stub result. onRun(record)
// receives {input, result} for every run (the sweep's journal of a child's judge calls is the run's trace).
export function solverStub(source, { answers = {}, taskTemplate = '', budgetUsd = 0.5, library = null, onRun = null, timeoutMs } = {}) {
  return async input => {
    const r = await runSolver({ source, task: { prompt: taskTemplate, inputs: input }, answers, library, budgetUsd, timeoutMs });
    if (onRun) onRun({ input, result: r });
    if (r.status === 'ok') return { output: r.output, costUsd: r.spentUsd };
    if (r.status === 'deopt') return { status: 'deopt', deopt: r.deopt ? { kind: r.deopt.kind, name: r.deopt.name ?? null, detail: r.deopt.detail ?? null } : { kind: 'unknown', name: null, detail: null }, costUsd: r.spentUsd };
    return { status: 'crash', error: { code: r.status, message: r.stderr.slice(-300) }, costUsd: r.spentUsd };
  };
}

// Register a fixture's children, resolve "@child:<name>" refs, assemble the parts, run. parts: [{card, slots}].
export async function runParts({ parts, task, answers = {}, children = [], budgetUsd = 1, outputSchema = null, timeoutMs, keep = false }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lib-fx-'));
  try {
    const lib = openLibrary(path.join(dir, 'library'));
    const refs = registerChildren(lib, children);
    const resolved = parts.map(p => ({ card: p.card, slots: resolveRefs(p.slots ?? {}, refs) }));
    const { source } = assemble({ parts: resolved, budgetUsd });
    const r = await runSolver({ source, task, answers, library: lib, budgetUsd, outputSchema, timeoutMs, workdir: path.join(dir, 'run') });
    return { ...r, source, refs };
  } finally { if (!keep) rmSync(dir, { recursive: true, force: true }); }
}

// One card fixture: the card's example slots with the fixture's overrides, its task, stub answers and children.
// Returns {pass, problems[], result}. expect: {status, output?, deopt?: {kind, name?}, flags?: [names that must appear],
// calls?: {kind: count} over the host events, outputSchema?}.
export async function runFixture(card, fixture, opts = {}) {
  const slots = { ...(card.example?.slots ?? {}), ...(fixture.slots ?? {}) };
  const result = await runParts({ parts: [{ card, slots }], task: fixture.task, answers: fixture.answers ?? {}, children: fixture.children ?? [],
    budgetUsd: fixture.budgetUsd ?? 1, outputSchema: fixture.expect?.outputSchema ?? card.fragment?.out ?? null, ...opts });
  const problems = [], ex = fixture.expect ?? {};
  if (result.status !== ex.status) problems.push(`status ${result.status} (expected ${ex.status})${result.deopt ? ` deopt ${result.deopt.kind}/${result.deopt.name}` : ''}${result.status === 'crash' ? `: ${result.stderr.slice(-300)}` : ''}${result.schemaErrors ? ` ${result.schemaErrors.join('; ')}` : ''}`);
  if (ex.output !== undefined && canonicalJson(result.output) !== canonicalJson(ex.output)) problems.push(`output ${JSON.stringify(result.output)} != ${JSON.stringify(ex.output)}`);
  if (ex.deopt) {
    if (result.deopt?.kind !== ex.deopt.kind) problems.push(`deopt kind ${result.deopt?.kind} (expected ${ex.deopt.kind})`);
    if (ex.deopt.name && result.deopt?.name !== ex.deopt.name) problems.push(`deopt name ${result.deopt?.name} (expected ${ex.deopt.name})`);
  }
  for (const f of ex.flags ?? []) if (!result.flags.includes(f)) problems.push(`flag ${f} not raised`);
  for (const [kind, n] of Object.entries(ex.calls ?? {})) { const got = result.events.filter(e => e.kind === kind).length; if (got !== n) problems.push(`${got} ${kind} events (expected ${n})`); }
  if (result.liveModelCalls) problems.push(`${result.liveModelCalls} live model calls`);
  if (result.spentUsd !== 0) problems.push(`spent $${result.spentUsd}`);
  return { pass: !problems.length, problems, result };
}
