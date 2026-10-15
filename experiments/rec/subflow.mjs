// subflow.mjs: the host of the `subflow` tool (Z0; research/architecture-20261014/MEMORY-ROUTING-RECURSION.md §3.4 and §5 row 7).
//
// An agent node gets one tool, tools/subflow.mjs (tool.mjs), with which it writes and runs a sub-workflow of its own: a typed
// work list (units), one model call per unit (worker: a prompt template over the unit), a typed answer per unit (returns) and,
// optionally, a check of its own (a module the host runs isolated in a fresh process, never in this process: check-runner.mjs).
// The tool posts the request to the node's gateway as model SUBFLOW_MODEL ('flow:subflow'). experiments/lib/services.mjs
// passes every model id it does not route itself to its model port, and that port is this host's (port()): the route lives in
// this module, outside every stamped tree, the stamped gateway is unchanged (design §2 change 7), and the client path matches
// no NESTED_API pattern (src/executors/claude-code.mjs). The node's gateway Ledger is the node's reservation, so the token the
// node holds is carved from it (tool.mjs serveSubflow).
//
// Semantics: lazy task creation (design change 5). The call always runs unless a hard refusal applies; the agent never
// negotiates. Per request, in this order:
//   1. bad-request: malformed (protocol, name, units, worker, returns, check, budget, timeout) or a worker model outside
//      the node's models.
//   2. S0 / taint: an effect, a durable wait or an approval is never handled by subflow (engine structure handles them:
//      obligations in tick hosts, wait.signal, human tasks). Asked for by a tainted request it is refused 'taint' (a structure
//      chosen after reading untrusted data runs with effects 'none'); by an untainted one, 'S0'.
//   3. depth: one dynamic level below an agent node (node.dynamicDepth + 1 > maxDynamicDepth = 1).
//   4. memo: an identical request earlier in this run (memo 'run') or a journaled one of the same task and node (memo
//      'journal', a resumed run) is served at $0. Only `ok` child answers are memoised; inline work is the agent's own.
//   5. count: 4 executed calls per run (a run's hosts may share one counter: createSubflowHost({ run })).
//   6. budget: at most 0.5 x the node's remainder (its Ledger: cap - spent - reserved); the default is that half.
//   7. size-change (the declared measure of the edge): the request's unit ids are a strict subset of the node's, or else its
//      input tokens are strictly fewer than the node's. Unknown = not smaller. Tokens are bytes / 4, the repository's estimate
//      (src/context.mjs, experiments/need-router/features.mjs, the beds) and the scale of the design's 30K.
// A refusal is a value ({status: 'refused', refused, detail}): it costs nothing and the agent carries on.
//
// Otherwise the call runs under its budget, held on the node's Ledger while it runs, and the host chooses executedAs:
//   child   up front when S3 (at least two earlier failures, in this run or given by the harness, named units of this
//           request) or S4 (the expected value from repeats is positive: earlier calls of the same structure spent more than
//           childOverheadUsd, default $0) holds; or, when neither does, after an inline probe of the first k units
//           (probeUnits, default 4) when S2 holds: the request is big (over 30K input tokens or more than 32 units) AND the
//           probe failed (a unit failed its call, its returns schema or its check) or ran slow (mean unit ms x all units >
//           the call's timeout). Size alone never makes a child.
//   inline  otherwise: on the call's budget as the agent's own spend, units one at a time, an agent delivery (credit
//           'agent'), no mutant, no memo, no harvest.
// A child is isolated: its budget is carved (what is left of the call's budget), its units after the first k run with
// concurrency, its record stays on the host behind a handle, and it is mutant-checked: on the first unit it delivers, the host
// plants a type-preserving single mutant of that unit's answer (mutantOf) and runs the request's check on it in a fresh
// process; only if the check rejects it are the child's delivered units `verified`, else they count as the agent's own work
// (design change 4a). Per check structure the host tallies planted and caught mutants: a structure whose false-pass rate
// exceeds its share of the run budget (runFalsePassBudget / maxPerRun) is not deployable (change 4c).
// Deopt back to the agent: the child is dropped (none of its units is delivered; the agent continues with the reason) when
// 50% or more of its first k units fall back, or when more than 25% of its budget is spent before its first delivered unit
// (checked before each of the first k units).
//
// The answer carries typed per-unit results, the fallback units (cause, plus a labelled detail), credit, the probe, the
// handle and the cost; never a prompt, a raw model output, a check's own output or anything else of the child's transcript
// (rule R2). Taint (R8): a request is tainted when its node is (the node's text label is not 'synthetic', or the node already
// received a tainted answer: taint is sticky), when it says so, or when one of its units is marked untrusted; its answer then
// carries label 'untrusted'. Detail text a check or a model wrote is always labelled DETAIL_LABEL.
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../jit/run-compiled.mjs';
import { TEXT_LABELS } from '../jit/agent-node.mjs';
import { reserveFor, Ledger } from '../lib/services.mjs';
import { compileDataSchema, validateData } from '../../src/validate.mjs';
import { FoundryError } from '../../src/data.mjs';

export const SUBFLOW_MODEL = 'flow:subflow', SUBFLOW_PROTOCOL = 1;
export const REFUSALS = Object.freeze(['bad-request', 'S0', 'taint', 'depth', 'count', 'budget', 'size-change']);
// Design §3.4 numbers (depth, count, budget shares, S2 size, deopt share) and change 4c (run false-pass budget). probeUnits (k)
// and childConcurrency are not given by the design: [I] defaults, configurable.
export const LIMITS = Object.freeze({
  maxDynamicDepth: 1, maxPerRun: 4, childShare: 0.5, firstUnitShare: 0.25, bigTokens: 30000, bigUnits: 32, probeUnits: 4, deoptShare: 0.5,
  runFalsePassBudget: 0.05, budgetFloorUsd: 0.001, childOverheadUsd: 0, childConcurrency: 4, checkTimeoutMs: 30000,
  defaultTimeoutMs: 20 * 60 * 1000, maxTimeoutMs: 60 * 60 * 1000,
});
export const MAX_UNITS = 2000, MAX_ID_CHARS = 200, MAX_CHECK_BYTES = 64 * 1024, MAX_DETAIL_CHARS = 300;
export const DETAIL_LABEL = 'untrusted:subflow-detail';
// Fallback causes that are failures of the work (S2's probe, S3's history, the deopt share), as opposed to budget, time or a drop.
export const WORK_FAILURES = Object.freeze(['error', 'returns', 'check']);
const S0_FIELDS = ['wait', 'approval'];

const sha256 = s => createHash('sha256').update(s).digest('hex');
const usd = x => Math.round(x * 1e6) / 1e6;
const short = (v, n = MAX_DETAIL_CHARS) => String(v?.message ?? v).slice(0, n);
const labelled = text => (text == null ? undefined : { label: DETAIL_LABEL, value: short(text) });

// ---- size, the size-change measure and the choice (pure; latent-demand.mjs replays the same functions) ----

/** Estimated tokens of a text: bytes / 4, as src/context.mjs and the need router's features estimate them. */
export const tokensOf = text => Math.ceil(Buffer.byteLength(String(text ?? '')) / 4);
/** The size of a request's work: its unit count and input tokens (the worker's text once plus every unit's input). */
export function sizeOf(request) {
  const text = v => (typeof v === 'string' ? v : canonicalJson(v));
  const units = request.units ?? [];
  return { units: units.length, tokens: tokensOf(String(request.worker?.system ?? '') + String(request.worker?.prompt ?? '') + units.map(u => text(u.input)).join('')) };
}
export const isBig = ({ tokens = 0, units = 0 } = {}, limits = LIMITS) => tokens > limits.bigTokens || units > limits.bigUnits;

/** The size-change measure of the node -> child edge: {smaller, measure, ...the numbers it compared}. */
export function sizeChange(parent = {}, request) {
  const ids = (request.units ?? []).map(u => u.id), size = sizeOf(request);
  const out = { childUnits: ids.length, childTokens: size.tokens, parentUnits: Array.isArray(parent.units) ? parent.units.length : null, parentTokens: Number.isFinite(parent.inputTokens) ? parent.inputTokens : null };
  if (Array.isArray(parent.units)) {
    const set = new Set(parent.units);
    if (ids.length < set.size && ids.every(id => set.has(id))) return { smaller: true, measure: 'units-subset', ...out };
  }
  if (out.parentTokens != null && size.tokens < out.parentTokens) return { smaller: true, measure: 'input-tokens', ...out };
  return { smaller: false, measure: null, ...out };
}

/** The host's choice (S2-S4). probe: null before a probe ran, else {failed (count), slow (bool)}. */
export function chooseExecution({ big = false, probe = null, s3 = false, s4 = false } = {}) {
  if (s3) return { executedAs: 'child', reason: 'S3' };
  if (s4) return { executedAs: 'child', reason: 'S4' };
  if (big && probe && (probe.failed > 0 || probe.slow)) return { executedAs: 'child', reason: 'S2' };
  return { executedAs: 'inline', reason: 'default' };
}

// ---- the planted mutant (change 4a): one probe unit's answer perturbed by a type-preserving edit ----

const subSchemaAt = (schema, p) => {
  let s = schema;
  for (const k of p) {
    if (!s || typeof s !== 'object') return null;
    s = typeof k === 'number' ? (Array.isArray(s.items) ? s.items[k] : s.items) : s.properties?.[k];
  }
  return s && typeof s === 'object' ? s : null;
};
const bumpChar = c => (/[0-9]/.test(c) ? String((Number(c) + 1) % 10) : c === 'z' ? 'a' : c === 'Z' ? 'A' : /[a-yA-Y]/.test(c) ? String.fromCharCode(c.charCodeAt(0) + 1) : null);
function candidatesFor(v, sub) {
  if (Array.isArray(sub?.enum)) return sub.enum.filter(x => typeof x === typeof v && canonicalJson(x) !== canonicalJson(v));
  if ('const' in (sub ?? {})) return [];
  if (typeof v === 'boolean') return [!v];
  if (typeof v === 'number') return [v + 1, v - 1, v * 2, -v, 0, 1];
  if (typeof v === 'string') {
    const i = [...v].findLastIndex(c => bumpChar(c) !== null), chars = [...v];
    const bumped = i >= 0 ? [...chars.slice(0, i), bumpChar(chars[i]), ...chars.slice(i + 1)].join('') : null;
    return [bumped, v + 'x', v.slice(0, -1), 'x' + v].filter(x => x !== null);
  }
  return [];
}
function leavesOf(v, p = [], out = []) {
  if (Array.isArray(v)) v.forEach((x, i) => leavesOf(x, [...p, i], out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v).sort()) leavesOf(v[k], [...p, k], out);
  else if (['number', 'string', 'boolean'].includes(typeof v)) out.push(p);
  return out;
}
const setAt = (v, p, x) => { if (!p.length) return x; const c = Array.isArray(v) ? v.slice() : { ...v }; c[p[0]] = setAt(v[p[0]], p.slice(1), x); return c; };
const getAt = (v, p) => p.reduce((o, k) => o?.[k], v);
const validAgainst = (schema, v) => { try { validateData(schema, v, 'mutant'); return true; } catch { return false; } };
/**
 * A single type-preserving mutant of `value` that still satisfies `schema` and differs from it, or null. Deterministic in
 * seed: the scalar leaves are taken in a rotation that starts at a seeded index; per leaf, the first candidate edit (a number
 * +-1, x2, negated, 0 or 1; a string with one character bumped, one appended or removed; a boolean flipped; another enum
 * member) that validates wins; with no scalar leaf, an array loses one element. Returns {value, path, from, to}.
 */
export function mutantOf(value, schema, seed = '') {
  const leaves = leavesOf(value), start = leaves.length ? parseInt(sha256(String(seed)).slice(0, 8), 16) % leaves.length : 0;
  for (let j = 0; j < leaves.length; j++) {
    const p = leaves[(start + j) % leaves.length], from = getAt(value, p);
    for (const to of candidatesFor(from, subSchemaAt(schema, p))) {
      const m = setAt(value, p, to);
      if (canonicalJson(m) !== canonicalJson(value) && validAgainst(schema, m)) return { value: m, path: p.join('.'), from, to };
    }
  }
  const arrays = [];
  const walk = (v, p) => { if (Array.isArray(v)) { if (v.length) arrays.push(p); v.forEach((x, i) => walk(x, [...p, i])); } else if (v && typeof v === 'object') for (const k of Object.keys(v).sort()) walk(v[k], [...p, k]); };
  walk(value, []);
  for (const p of arrays) {
    const arr = getAt(value, p), m = setAt(value, p, arr.slice(0, -1));
    if (validAgainst(schema, m)) return { value: m, path: p.join('.'), from: arr.length, to: arr.length - 1 };
  }
  return null;
}

// ---- request shape ----

function parseRequest(raw, models) {
  const bad = problem => ({ problem });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('the request must be a JSON object');
  if (raw.v !== SUBFLOW_PROTOCOL) return bad(`protocol v must be ${SUBFLOW_PROTOCOL}`);
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > MAX_ID_CHARS) return bad(`name must be a non-empty string of at most ${MAX_ID_CHARS} characters`);
  if (!Array.isArray(raw.units) || !raw.units.length || raw.units.length > MAX_UNITS) return bad(`units must be a list of 1..${MAX_UNITS} {id, input}`);
  const seen = new Set();
  for (const u of raw.units) {
    if (!u || typeof u !== 'object' || typeof u.id !== 'string' || !u.id || u.id.length > MAX_ID_CHARS) return bad(`every unit needs an id: a non-empty string of at most ${MAX_ID_CHARS} characters`);
    if (seen.has(u.id)) return bad(`duplicate unit id ${JSON.stringify(u.id).slice(0, 80)}`);
    if (u.input === undefined) return bad(`unit ${JSON.stringify(u.id).slice(0, 80)} has no input`);
    if (u.untrusted !== undefined && typeof u.untrusted !== 'boolean') return bad('unit.untrusted must be a boolean');
    seen.add(u.id);
  }
  const w = raw.worker;
  if (!w || typeof w !== 'object' || typeof w.prompt !== 'string' || !w.prompt.trim()) return bad('worker.prompt (the per-unit prompt template) is required');
  if (w.system != null && typeof w.system !== 'string') return bad('worker.system must be a string');
  if (w.reasoning != null && typeof w.reasoning !== 'string') return bad('worker.reasoning must be a string');
  if (w.model != null && (typeof w.model !== 'string' || !models.includes(w.model))) return bad(`worker.model must be one of the node's models: ${models.join(', ')}`);
  if (!raw.returns || typeof raw.returns !== 'object' || Array.isArray(raw.returns)) return bad('returns (the JSON Schema of one unit\'s answer) is required');
  try { compileDataSchema(raw.returns); } catch (e) { return bad(`returns: ${short(e)}`); }
  if (raw.checkSource != null && (typeof raw.checkSource !== 'string' || !raw.checkSource.trim() || Buffer.byteLength(raw.checkSource) > MAX_CHECK_BYTES)) return bad(`checkSource must be module source text of at most ${MAX_CHECK_BYTES} bytes`);
  if (raw.budgetUsd != null && !(typeof raw.budgetUsd === 'number' && Number.isFinite(raw.budgetUsd) && raw.budgetUsd > 0)) return bad('budgetUsd must be a positive number');
  if (raw.timeoutMs != null && !(Number.isInteger(raw.timeoutMs) && raw.timeoutMs > 0)) return bad('timeoutMs must be a positive integer');
  if (raw.tainted != null && typeof raw.tainted !== 'boolean') return bad('tainted must be a boolean');
  const units = raw.units.map(u => ({ id: u.id, input: u.input, ...(u.untrusted ? { untrusted: true } : {}) }));
  const worker = { prompt: w.prompt, ...(w.system ? { system: w.system } : {}), ...(w.model ? { model: w.model } : {}), ...(w.reasoning ? { reasoning: w.reasoning } : {}) };
  return { request: { v: SUBFLOW_PROTOCOL, name: raw.name.trim(), units, worker, returns: raw.returns, ...(raw.checkSource != null ? { checkSource: raw.checkSource } : {}),
    ...(raw.budgetUsd != null ? { budgetUsd: raw.budgetUsd } : {}), ...(raw.timeoutMs != null ? { timeoutMs: raw.timeoutMs } : {}), ...(raw.tainted ? { tainted: true } : {}) } };
}
// S0: an effect, a durable wait or an approval (the request's own words; the host has no primitive for any of them).
const s0Of = raw => {
  if (!raw || typeof raw !== 'object') return null;
  const asks = [...(raw.effects != null && raw.effects !== 'none' ? [`effects: ${short(JSON.stringify(raw.effects), 60)}`] : []), ...S0_FIELDS.filter(k => raw[k] != null && raw[k] !== false)];
  return asks.length ? asks : null;
};

const renderPrompt = (template, unit) => {
  const text = typeof unit.input === 'string' ? unit.input : JSON.stringify(unit.input, null, 1);
  const body = template.includes('{{unit}}') ? template.replaceAll('{{unit}}', text) : `${template}\n\n${text}`;
  return body.replaceAll('{{id}}', unit.id);
};
const returnsErrors = (schema, value) => {
  try { validateData(schema, value, 'answer'); return null; }
  catch (e) { return (e.details ?? [{ message: short(e) }]).slice(0, 3).map(x => `${x.instancePath ?? ''} ${x.message ?? ''}`.trim()).join('; '); }
};
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}

// ---- the host ----

/**
 * createSubflowHost({ modelPort, node, ledger | budgetUsd, checkRunner, workRoot?, journal?, run?, limits?, runId?, log? })
 *   modelPort    the node's model port (a journaled ModelPort live; a scripted port in tests): every unit is one call on it.
 *   node         {id, taskKey, model, models?, units?, inputTokens?, dynamicDepth? (0), textLabel? ('third-party': D10 fails
 *                closed, so a node is tainted unless declared 'synthetic'), failures?: [{units: [ids], source?}] (S3 evidence
 *                the harness holds, e.g. the parent's verify reasons)}.
 *   ledger       the node's gateway Ledger (experiments/lib/services.mjs), whose cap is the node's reservation; or budgetUsd.
 *   checkRunner  check-runner.mjs processCheckRunner() / sandboxCheckRunner(), or anything with run({source, cases, timeoutMs}).
 *   journal      earlier journalOut rows (a resumed run): served at $0 for the same task and node only.
 *   run          a counter shared by the hosts of one run ({executed: 0}); default: this host's own.
 * Returns {port(inner?), request(raw), handle(raw), events, journalOut, records, totals(), state}.
 */
export function createSubflowHost({ modelPort = null, node, ledger = null, budgetUsd = null, checkRunner = null, workRoot = null, journal = [], run = null, limits: over = {},
  runId = `subflow-${Date.now().toString(36)}`, log = () => {} } = {}) {
  if (!node || typeof node !== 'object' || typeof node.id !== 'string' || !node.id) throw new Error('createSubflowHost: node {id, taskKey, model, ...} is required');
  if (typeof node.model !== 'string' || !node.model) throw new Error('createSubflowHost: node.model (the node\'s own model id) is required');
  const textLabel = node.textLabel ?? 'third-party';
  if (!TEXT_LABELS.includes(textLabel)) throw new Error(`createSubflowHost: node.textLabel must be one of ${TEXT_LABELS.join(', ')}`);
  const limits = { ...LIMITS, ...over };
  for (const k of Object.keys(over)) if (!(k in LIMITS)) throw new Error(`createSubflowHost: unknown limit ${k}`);
  if (!Number.isInteger(limits.probeUnits) || limits.probeUnits < 1) throw new Error('createSubflowHost: limits.probeUnits must be a positive integer');
  if (!ledger) {
    if (!(typeof budgetUsd === 'number' && budgetUsd > 0)) throw new Error('createSubflowHost: the node\'s ledger (or budgetUsd) is required');
    ledger = new Ledger({ capUsd: budgetUsd, label: `subflow:${node.id}` });
  }
  if (checkRunner != null && typeof checkRunner.run !== 'function') throw new Error('createSubflowHost: checkRunner must have run({source, cases, timeoutMs})');
  const models = [...new Set([node.model, ...(Array.isArray(node.models) ? node.models : [])])];
  const state = { tainted: textLabel !== 'synthetic', failures: (node.failures ?? []).map(f => ({ units: [...(f.units ?? [])], source: f.source ?? 'harness' })),
    structures: new Map(), falsePass: new Map(), calls: 0 };
  const counter = run ?? { executed: 0 };
  const events = [], journalOut = [], records = new Map(), memo = new Map();
  for (const row of journal ?? []) if (row?.key && row.taskKey === (node.taskKey ?? null) && row.nodeId === node.id && row.value?.status === 'ok') memo.set(row.key, { value: row.value, source: 'journal' });

  const keyOf = (req, tainted) => sha256(canonicalJson({ taskKey: node.taskKey ?? null, node: node.id, units: req.units, worker: req.worker, returns: req.returns, checkSource: req.checkSource ?? null, tainted }));
  const structureOf = req => sha256(canonicalJson({ worker: req.worker, returns: req.returns, checkSource: req.checkSource ?? null })).slice(0, 16);
  const falsePassOf = structure => {
    const t = state.falsePass.get(structure) ?? { planted: 0, caught: 0 }, share = limits.runFalsePassBudget / limits.maxPerRun;
    const rate = t.planted ? (t.planted - t.caught) / t.planted : null;
    return { ...t, rate, share, deployable: rate !== null && rate <= share };
  };
  const event = e => { const row = { at: new Date().toISOString(), node: node.id, taskKey: node.taskKey ?? null, ...e }; events.push(row); log(`${row.kind} ${row.name ?? ''} ${row.executedAs ?? row.refused ?? ''}`); return row; };
  const refuse = (refused, detail, name = null, t0 = Date.now()) => {
    const value = { v: SUBFLOW_PROTOCOL, status: 'refused', refused, detail, ...(name ? { name } : {}), costUsd: 0 };
    event({ kind: 'subflow-refused', name, refused, detail, costUsd: 0, ms: Date.now() - t0 });
    return value;
  };
  const runCheck = async (source, cases) => {
    if (!checkRunner) return { error: { code: 'NO_CHECK_RUNNER', message: 'this host has no check runner' } };
    try {
      const r = await checkRunner.run({ source, cases, timeoutMs: limits.checkTimeoutMs });
      if (r?.error) return { error: r.error };
      if (!Array.isArray(r?.verdicts) || r.verdicts.length !== cases.length) return { error: { code: 'CHECK_RUNNER', message: 'the check runner returned the wrong number of verdicts' } };
      return { verdicts: r.verdicts.map(v => ({ ok: v?.ok === true, ...(v?.ok === true ? {} : { problem: short(v?.problem ?? 'check failed') }) })) };
    } catch (e) { return { error: { code: e.code ?? 'CHECK_RUNNER', message: short(e) } }; }
  };

  // One unit: one model call under acct ({budgetUsd, spentUsd, reservedUsd}). Returns {output} | {cause, detail}, with cost and ms.
  async function runUnit(unit, req, acct, signal, nodeKey) {
    if (signal.aborted) return { cause: 'timeout', cost: 0, ms: 0 };
    const model = req.worker.model ?? node.model, system = req.worker.system ?? '', prompt = renderPrompt(req.worker.prompt, unit), schema = req.returns;
    const entry = modelPort?.policy?.models?.find(m => m.id === model);
    const reserve = reserveFor(modelPort?.policy, { model, system, prompt, schema }, modelPort?.providers?.[entry?.provider]?.maxBudgetUsd ?? 1);
    if (acct.spentUsd + acct.reservedUsd + reserve > acct.budgetUsd + 1e-9) return { cause: 'budget', cost: 0, ms: 0 };
    if (!modelPort) return { cause: 'error', detail: 'no model port in this host', cost: 0, ms: 0 };
    acct.reservedUsd += reserve;
    const t = Date.now();
    let r;
    try { r = await modelPort.call({ runId, nodeKey, modelId: model, system, prompt, schema, decoding: { reasoning: req.worker.reasoning ?? 'none' }, signal }); }
    catch (e) { r = { ok: false, error: { code: e.code ?? 'MODEL_REQUEST', message: short(e) }, costUsd: e.details?.costUsd ?? 0 }; }
    finally { acct.reservedUsd = Math.max(0, acct.reservedUsd - reserve); }
    const cost = r?.costUnknown ? Math.max(r.costUsd ?? 0, r.costUpperUsd ?? reserve) : (r?.costUsd ?? 0);
    acct.spentUsd += cost; if (r?.costUnknown) acct.costUnknown = true;
    const ms = Number.isFinite(r?.latencyMs) ? r.latencyMs : Date.now() - t;
    if (!r?.ok) return { cause: signal.aborted ? 'timeout' : 'error', detail: [r?.error?.code, r?.error?.message].filter(Boolean).join(': ') || 'model call failed', cost, ms };
    const errs = returnsErrors(schema, r.value);
    if (errs) return { cause: 'returns', detail: errs, cost, ms };
    return { output: r.value, cost, ms };
  }

  // The executed call. Returns {value, record}.
  async function execute(req, { key, handle, tainted, budget, timeoutMs, signal: outer, measure }) {
    const t0 = Date.now(), structure = structureOf(req), size = sizeOf(req), big = isBig(size, limits);
    const ids = new Set(req.units.map(u => u.id));
    const s3Failures = state.failures.filter(f => f.units.some(id => ids.has(id))).length;
    const prior = state.structures.get(structure), evUsd = prior ? usd(prior.costUsd - limits.childOverheadUsd) : null;
    const acct = { budgetUsd: budget, spentUsd: 0, reservedUsd: 0, costUnknown: false };
    const results = new Map(), workFailed = new Set(), unitCost = new Map();
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), timeoutMs);
    const onOuter = () => ac.abort();
    outer?.addEventListener?.('abort', onOuter, { once: true });
    const signal = ac.signal;
    let n = 0;
    const call = (u, a, mode) => runUnit(u, req, a, signal, `subflow/${key.slice(0, 12)}/${mode}/${n++}`);
    // Settle units: check the ones with an answer (one isolated check run for the batch), then record each.
    const settle = async (list, mode) => {
      const withOut = list.filter(([, r]) => r.output !== undefined);
      let verdicts = [];
      if (req.checkSource && withOut.length) {
        const v = await runCheck(req.checkSource, withOut.map(([u, r]) => ({ output: r.output, unit: { id: u.id, input: u.input } })));
        // A runner that could not run the check (an environment fault, not the work's): cause 'check-error'.
        verdicts = v.error ? withOut.map(() => ({ ok: false, problem: `check runner: ${v.error.code}`, runnerError: true })) : v.verdicts;
      }
      let j = 0;
      for (const [u, r] of list) {
        unitCost.set(u.id, { usd: usd(r.cost ?? 0), ms: r.ms ?? 0, mode });
        if (r.output === undefined) { results.set(u.id, { cause: r.cause, detail: r.detail, mode }); if (WORK_FAILURES.includes(r.cause)) workFailed.add(u.id); continue; }
        const v = req.checkSource ? verdicts[j++] : { ok: true };
        if (v.ok) results.set(u.id, { output: r.output, mode });
        else if (v.runnerError) results.set(u.id, { cause: 'check-error', detail: v.problem, mode });
        else { results.set(u.id, { cause: 'check', detail: v.problem, mode }); workFailed.add(u.id); }
      }
    };
    let decision = chooseExecution({ big, s3: s3Failures >= 2, s4: evUsd !== null && evUsd > 0 });
    if (decision.executedAs === 'inline') decision = null;   // S2 needs the probe
    let pending = req.units.slice(), probe = null, child = null;
    try {
      if (!decision && big) {
        const probeUnits = pending.splice(0, limits.probeUnits), outs = [];
        for (const u of probeUnits) outs.push([u, await call(u, acct, 'inline')]);
        await settle(outs, 'inline');
        const failed = probeUnits.filter(u => workFailed.has(u.id)).length, meanMs = outs.reduce((s, [, r]) => s + (r.ms ?? 0), 0) / Math.max(1, outs.length);
        probe = { k: probeUnits.length, failed, slow: meanMs * req.units.length > timeoutMs, meanMs: Math.round(meanMs) };
        decision = chooseExecution({ big, probe });
        // A probe that covered every unit leaves nothing for a child: the whole call stays inline.
        if (decision.executedAs === 'child' && !pending.length) decision = { executedAs: 'inline', reason: 'default' };
      }
      decision ??= { executedAs: 'inline', reason: 'default' };
      if (decision.executedAs === 'inline') {
        const outs = [];
        for (const u of pending) outs.push([u, await call(u, acct, 'inline')]);
        await settle(outs, 'inline');
      } else {
        // The child: its budget is what is left of the call's; it is metered apart and adds to the call's spend at the end.
        const cacct = { budgetUsd: Math.max(0, acct.budgetUsd - acct.spentUsd), spentUsd: 0, reservedUsd: 0, costUnknown: false };
        const wave = pending.slice(0, limits.probeUnits), rest = pending.slice(limits.probeUnits);
        let delivered = 0, fellBack = 0, mutant = null, drop = null;
        for (const u of wave) {
          if (delivered === 0 && cacct.spentUsd > limits.firstUnitShare * cacct.budgetUsd) { drop = { cause: 'budget-before-first-unit', spentUsd: usd(cacct.spentUsd), budgetUsd: usd(cacct.budgetUsd), share: limits.firstUnitShare }; break; }
          await settle([[u, await call(u, cacct, 'child')]], 'child');
          const res = results.get(u.id);
          if (res.output === undefined) { fellBack++; continue; }
          delivered++;
          if (!mutant) {
            if (!req.checkSource) mutant = { planted: false, reason: 'no-check' };
            else {
              const m = mutantOf(res.output, req.returns, key);
              if (!m) mutant = { planted: false, reason: 'no type-preserving edit', unit: u.id };
              else {
                const v = await runCheck(req.checkSource, [{ output: m.value, unit: { id: u.id, input: u.input } }]);
                mutant = { planted: true, unit: u.id, path: m.path, caught: !v.error && v.verdicts[0].ok === false, ...(v.error ? { error: v.error.code } : {}) };
              }
            }
          }
        }
        const tried = wave.filter(u => results.has(u.id)).length;
        if (!drop && tried && fellBack / tried >= limits.deoptShare) drop = { cause: 'fallback-rate', fellBack, of: tried, share: limits.deoptShare };
        if (!drop && rest.length) {
          const outs = await pool(rest, limits.childConcurrency, async u => [u, await call(u, cacct, 'child')]);
          await settle(outs, 'child');
        }
        if (drop) for (const u of pending) { const prev = results.get(u.id); results.set(u.id, { cause: 'dropped', mode: 'child', ...(prev?.cause ? { was: prev.cause } : {}) }); }
        acct.spentUsd += cacct.spentUsd; if (cacct.costUnknown) acct.costUnknown = true;
        child = { budgetUsd: usd(cacct.budgetUsd), spentUsd: usd(cacct.spentUsd), units: pending.length, mutant: mutant ?? { planted: false, reason: drop ? 'dropped before a delivered unit' : 'no delivered unit' }, drop };
      }
    } finally { clearTimeout(timer); outer?.removeEventListener?.('abort', onOuter); }

    // The answer: typed results and handles, never the transcript.
    const units = {}, fallback = [], verifiedUnits = [];
    const verified = !!child?.mutant?.planted && child.mutant.caught === true;
    for (const u of req.units) {
      const r = results.get(u.id) ?? { cause: 'timeout', mode: decision.executedAs };
      if (r.output !== undefined) { units[u.id] = r.output; if (verified && r.mode === 'child') verifiedUnits.push(u.id); }
      else fallback.push({ id: u.id, cause: r.cause, ...(r.detail ? { detail: labelled(r.detail) } : {}) });
    }
    const delivered = Object.keys(units).length;
    const credit = delivered && verifiedUnits.length === delivered ? 'verified' : 'agent';
    const status = child?.drop ? 'deopt' : 'ok';
    const mutantOut = child ? { planted: child.mutant.planted, ...(child.mutant.planted ? { unit: child.mutant.unit, caught: child.mutant.caught } : { reason: child.mutant.reason }) } : null;
    if (child?.mutant?.planted) { const t = state.falsePass.get(structure) ?? { planted: 0, caught: 0 }; t.planted++; if (child.mutant.caught) t.caught++; state.falsePass.set(structure, t); }
    const fp = child ? falsePassOf(structure) : null;
    const value = { v: SUBFLOW_PROTOCOL, status, name: req.name, handle, executedAs: decision.executedAs, reason: decision.reason, units, fallback, credit, verifiedUnits,
      ...(mutantOut ? { mutant: mutantOut } : {}), ...(probe ? { probe } : {}), ...(child?.drop ? { deopt: child.drop } : {}),
      tainted, ...(tainted ? { label: 'untrusted' } : {}), budgetUsd: usd(budget), costUsd: usd(acct.spentUsd), ...(acct.costUnknown ? { costUnknown: true } : {}) };
    // History for S3 and S4, and the sticky taint (the agent has now read this answer).
    if (workFailed.size) state.failures.push({ units: [...workFailed], source: handle });
    const st = state.structures.get(structure) ?? { calls: 0, costUsd: 0 }; st.calls++; st.costUsd = usd(st.costUsd + acct.spentUsd); state.structures.set(structure, st);
    if (tainted) state.tainted = true;
    const record = { handle, key, structure, name: req.name, size, big, measure, decision, probe, s3Failures, evUsd, child, units: Object.fromEntries(req.units.map(u => [u.id, { ...results.get(u.id), ...unitCost.get(u.id) }])),
      tainted, budgetUsd: usd(budget), costUsd: usd(acct.spentUsd), ms: Date.now() - t0 };
    return { value, record, falsePass: fp };
  }

  async function handle(raw, { signal = null } = {}) {
    const t0 = Date.now();
    state.calls++;
    const parsed = parseRequest(raw, models);
    const name = typeof raw?.name === 'string' ? raw.name.slice(0, MAX_ID_CHARS) : null;
    if (parsed.problem) return refuse('bad-request', parsed.problem, name, t0);
    const req = parsed.request;
    const tainted = state.tainted || req.tainted === true || req.units.some(u => u.untrusted);
    const s0 = s0Of(raw);
    if (s0) return refuse(tainted ? 'taint' : 'S0', { asks: s0, rule: tainted ? 'a structure chosen after reading untrusted data runs with effects none' : 'effects, durable waits and approvals are engine structure (obligations, wait.signal, human tasks), never subflow' }, req.name, t0);
    const depth = (node.dynamicDepth ?? 0) + 1;
    if (depth > limits.maxDynamicDepth) return refuse('depth', { depth, maxDynamicDepth: limits.maxDynamicDepth }, req.name, t0);
    const key = keyOf(req, tainted);
    const hit = memo.get(key);
    if (hit) {
      const value = { ...structuredClone(hit.value), memo: hit.source, costUsd: 0 };
      event({ kind: 'subflow-memo', name: req.name, key, handle: value.handle, memo: hit.source, executedAs: value.executedAs, costUsd: 0, ms: Date.now() - t0 });
      if (value.tainted) state.tainted = true;
      return value;
    }
    if (counter.executed >= limits.maxPerRun) return refuse('count', { executed: counter.executed, maxPerRun: limits.maxPerRun }, req.name, t0);
    const remaining = ledger.remaining(), maxUsd = usd(limits.childShare * Math.max(0, remaining));
    if (maxUsd < limits.budgetFloorUsd) return refuse('budget', { remainingUsd: usd(remaining), maxUsd, floorUsd: limits.budgetFloorUsd }, req.name, t0);
    const budget = req.budgetUsd ?? maxUsd;
    if (budget > maxUsd + 1e-12) return refuse('budget', { budgetUsd: budget, maxUsd, remainingUsd: usd(remaining), rule: `a subflow gets at most ${limits.childShare} x the node's remainder` }, req.name, t0);
    if (budget < limits.budgetFloorUsd) return refuse('budget', { budgetUsd: budget, floorUsd: limits.budgetFloorUsd }, req.name, t0);
    const measure = sizeChange(node, req);
    if (!measure.smaller) return refuse('size-change', { ...measure, rule: 'the unit set must be a strict subset of the node\'s, or else the input strictly fewer tokens' }, req.name, t0);
    counter.executed++;
    const handleId = `subflow:${key.slice(0, 16)}#${counter.executed}`;
    const timeoutMs = Math.min(req.timeoutMs ?? limits.defaultTimeoutMs, limits.maxTimeoutMs);
    ledger.hold(budget);
    let out;
    try { out = await execute(req, { key, handle: handleId, tainted, budget, timeoutMs, signal, measure }); }
    finally { ledger.release(budget); }
    const { value, record, falsePass } = out;
    records.set(handleId, record);
    if (workRoot) { const dir = path.join(workRoot, 'subflows'); mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, `${handleId.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`), JSON.stringify(record)); }
    if (value.status === 'ok' && value.executedAs === 'child') { memo.set(key, { value: structuredClone(value), source: 'run' }); journalOut.push({ key, taskKey: node.taskKey ?? null, nodeId: node.id, value: structuredClone(value), at: new Date().toISOString() }); }
    event({ kind: value.status === 'deopt' ? 'subflow-deopt' : 'subflow-end', name: req.name, key, handle: handleId, structure: record.structure, executedAs: value.executedAs, reason: value.reason,
      measure: measure.measure, size: record.size, probe: value.probe ?? null, units: req.units.length, delivered: Object.keys(value.units).length, fallback: value.fallback.length,
      verified: value.verifiedUnits.length, credit: value.credit, mutant: record.child?.mutant ?? null, ...(falsePass ? { falsePass } : {}), deopt: value.deopt ?? null, tainted: value.tainted,
      harvestEligible: value.status === 'ok' && value.executedAs === 'child', budgetUsd: value.budgetUsd, costUsd: value.costUsd, ms: Date.now() - t0 });
    return value;
  }

  // The port the node's gateway calls: SUBFLOW_MODEL requests come here, every other request goes to the inner port.
  function port(inner = modelPort) {
    return {
      policy: inner?.policy ?? null, providers: inner?.providers ?? {}, policyHash: inner?.policyHash ?? null,
      async call(req) {
        if (req?.modelId === SUBFLOW_MODEL) {
          const t0 = Date.now();
          let raw = null; try { raw = JSON.parse(String(req.prompt ?? '')); } catch {}
          const value = await handle(raw, { signal: req.signal ?? null });
          // Unknown unit spend is already in costUsd at its bound: flag it, add nothing more (as call-host.mjs does).
          return { ok: true, value, costUsd: value.costUsd ?? 0, imputedUsd: 0, latencyMs: Date.now() - t0, modelId: SUBFLOW_MODEL, ...(value.costUnknown ? { costUnknown: true, costUpperUsd: 0 } : {}) };
        }
        if (!inner) throw new FoundryError('GATEWAY_NO_MODELS', 'no model access through this subflow host');
        return inner.call(req);
      },
    };
  }
  // A call exactly as the gateway makes it (the port, then the Ledger's charge): for harness code and tests without HTTP.
  async function request(raw, { signal = null } = {}) {
    const r = await port().call({ modelId: SUBFLOW_MODEL, prompt: JSON.stringify(raw), signal });
    ledger.charge(r);
    return r.value;
  }
  function totals() {
    const by = k => events.filter(e => e.kind === k);
    const ended = [...by('subflow-end'), ...by('subflow-deopt')];
    const refusals = {}; for (const e of by('subflow-refused')) refusals[e.refused] = (refusals[e.refused] ?? 0) + 1;
    return { requests: state.calls, executed: ended.length, child: ended.filter(e => e.executedAs === 'child').length, inline: ended.filter(e => e.executedAs === 'inline').length,
      deopts: by('subflow-deopt').length, verified: ended.filter(e => e.credit === 'verified').length, memo: by('subflow-memo').length, refusals,
      costUsd: usd(ended.reduce((s, e) => s + (e.costUsd ?? 0), 0)), tainted: state.tainted,
      falsePass: Object.fromEntries([...state.falsePass.keys()].map(s => [s, falsePassOf(s)])) };
  }
  return { node, limits, ledger, port, request, handle, events, journalOut, records, totals, state, run: counter };
}
