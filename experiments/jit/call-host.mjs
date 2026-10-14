// call-host.mjs: the host side of flow-v3's flow.call (research/jit-20261008/design/FLOW-V3.md §1–2.1, slice 1; what
// landed and what differs: design/FLOW-V3-SLICE1.md). A solver never runs a child itself: flow-v3.mjs sends a call request
// over the existing gateway protocol (POST /model with model CALL_MODEL = 'flow:call', the request as JSON in `prompt`),
// and the model port the gateway calls is wrapped by this host (host.port()). The wrapper answers a call request by
// running the callee as a nested compiled run (runCompiled, in its own sandbox and workdir, with a budget carved from the
// caller's) and passes every other request to the real model port. The child's cost is the answer's costUsd, so the
// caller's gateway ledger charges it to the caller; this host also books it under the caller's span.
//
//   const registry = createRegistry({ dir: '<arm>/library' });       // per arm, append-only registry.jsonl
//   const entry = registry.register({ solvePath, contract: { input, output, taskTemplate }, profile, evidence });
//   const host = createCallHost({ registry, modelPort, maxDepth: 3, workRoot: '<run>/calls-root', arm, taskKey });
//   const port = host.port({ budgetUsd: perTaskUsd });                 // the root scope's model port
//   await runCompiled({ ..., modelPort: port, perTaskUsd, flowPath: FLOW_V3, allowedModels: withCallModel(models) });
//   host.events      // one row per call request: call-end | call-deopt | call-refused, with the curriculum fields
//
// Host behaviour per request, in order (FLOW-V3 §2.1): parse; resolve the hash (unknown-hash, revoked); recursion (the
// hash is on the ancestor chain); depth (child depth > maxDepth, default 3, hard ceiling 8); tree size (1,000 children
// per host); effects (only 'none'); input schema (contract.input); applicability (checkProfile on the child task:
// outside-profile); the idempotency memo (key = callKeyOf(calleeHash, inputDigest, parentSpanPath): a repeat, or a
// journaled result under replay, is served at $0); budget (BUDGET_TOO_SMALL below the floor; budget-exceeds-parent unless
// the child's budget is strictly below the caller's remaining); run; typed return (contract.output: a mismatch is a
// child deopt of kind 'output-schema').
//
// mode 'stub' (tests): a registry entry carries stub(input, ctx) instead of a solve.mjs and runs in process; ctx.call(request)
// issues a nested call from the child's scope and ctx.model(req) a model call through the child's port.
//
// Slice 2a (design/FLOW-V3-SLICE2.md §1):
// - Per-call child prompt: request.prompt (else the entry's contract.taskTemplate) is the child task's prompt; it is part of
//   the idempotency key (promptDigest) and of the profile check. Every host event carries the span `name` (a bed attributes
//   calls to its subtasks by name and inputDigest) and, with a prompt, promptDigest.
// - Profile check options: the entry's checkOptions (profile.mjs checkOptionsOf: ignore, lineFormat, vocabMinUnseen) over the
//   host's profileCheck defaults; novelMode 'refuse' (default) | 'warn' (entry over host): 'warn' writes a profile-warn event,
//   runs the call and returns the warning with the answer.
// - Local deopt (FLOW-V3 §1.5): with request.onRefuse 'interpret' an outside-profile or revoked refusal, and with
//   request.onDeopt 'interpret' a child deopt, is answered by the host's interpreter (createCallHost({ interpreter })) on the
//   child task under the call's carved budget (what the child left of it, after a deopt), never below interpretFloorUsd.
//   The answer must fit contract.output. The event kind is interpret-child (outcome: the refusal or deopt it replaced); the
//   caller continues with the interpreted value (status 'interpreted') or gets a deopt of kind interpret-child.
// - Budget tree: a child's reservation must be strictly below the caller's remaining budget, where remaining already
//   holds back the reservations of the caller's children in flight (Σ reservations in flight + this one < budget − spent).
//   A call that would fit without its siblings in flight is refused BUDGET_TREE with the shortfall; one that would not fit
//   even alone is refused budget-exceeds-parent, as in slice 1. When the gateway (services.mjs) holds this call's own
//   reservation on the caller's Ledger (request.gatewayHoldUsd), the host does not hold it again.
//
// Slice 2b (design/FLOW-V3-SLICE2.md §9): agent nodes. A request {v: 1, op: 'agent', name, span, attempt, instructions, files
// ({path: text}, resolved by the SDK from the task), inputs?, returns, model?, tools?, budgetUsd, timeoutMs, stallMs?,
// harvest, retryReason?} is answered by createCallHost({ agent: { runner, ... } }): checks in order (bad-request, no-returns,
// no-agent-runner, depth: only scopes at depth <= agent.maxDepth (default 1) own nodes, model-not-in-policy, tool-not-allowed,
// bad-files, third-party-text: agent.textLabel is the stream's declaration of the run's text (D10: only 'synthetic' reaches
// a node), the memo (key over name, parent path, files, instructions, returns, inputs, attempt and retry reason; journal rows
// replay at $0), per-run-limit (agent.maxPerRun, 16), the budget (BUDGET_TOO_SMALL below agent.floorUsd $0.10, then the
// budget tree as for calls), then at most agent.maxConcurrent (2) nodes run at once (later ones wait, holding their
// reservation). The runner (agent-node.mjs agentNodeRunner, or a stub) runs the node; a stallMs watchdog aborts a node whose
// workdir shows no activity for stallMs and restarts it (agent.stallRestarts, default 1) inside the same reservation. The
// result is void when the transcript shows a nested model use or a hidden-path attempt, failed when there is no answer, it
// stalled out, or the answer fails returns; else ok. Harvest: the scripts an ok node wrote, with its task and answer, are
// saved under <workRoot>/agents/ (harvestFile on the event) for a later sub-compile (agent-node.mjs subCompileGroups). The
// verify is the SDK's (the parent's code). Events: agent-end (outcome ok | void | failed) or agent-refused.
// Registry entries record a static scan of the solver for code execution (agent-node.mjs codeExecutionOf); a call to an
// entry with findings is refused 'executes-code': a compiled callee never runs code it was handed.
import path from 'node:path';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runCompiled, canonicalJson, FLOW_V2 } from './run-compiled.mjs';
import { validateOutput } from './interpret.mjs';
import { AGENT_TOOLS, DEFAULT_AGENT_TOOLS, MAX_AGENT_TOOLS, DEFAULT_AGENT_FLOOR_USD, DEFAULT_AGENT_CONCURRENCY, DEFAULT_AGENTS_PER_RUN, DEFAULT_MAX_AGENT_DEPTH,
  DEFAULT_STALL_RESTARTS, MAX_STALL_RESTARTS, TEXT_LABELS, agentFilesProblem, codeExecutionOf, filesClusterOf } from './agent-node.mjs';
import { compileDataSchema, validateData } from '../../src/validate.mjs';
import { checkProfile, checkOptionsOf, profileSupports, PROFILE_SCHEMA } from './profile.mjs';
import { reserveFor } from '../lib/services.mjs';
import { FoundryError } from '../../src/data.mjs';

export const FLOW_V3 = path.resolve(new URL('./flow-v3.mjs', import.meta.url).pathname);
export const CALL_MODEL = 'flow:call', ROOT_SPAN = 'root', CALL_PROTOCOL = 1;   // as flow-v3.mjs exports them
export const DEFAULT_MAX_DEPTH = 3, HARD_MAX_DEPTH = 8, MAX_TREE_CHILDREN = 1000, DEFAULT_BUDGET_FLOOR_USD = 0.001;
// FLOW-V3 §1.3 agentFloorUsd: about the Haiku agent's whole-task cost on records ($0.103); an interpreted child below it is refused.
export const DEFAULT_INTERPRET_FLOOR_USD = 0.1;
export const REGISTRY_FILE = 'registry.jsonl';
export const REFUSALS = Object.freeze(['bad-request', 'unknown-hash', 'revoked', 'recursion', 'depth', 'tree-size', 'effects', 'input-schema',
  'outside-profile', 'BUDGET_TOO_SMALL', 'budget-exceeds-parent', 'BUDGET_TREE', 'executes-code']);
// Refusals the interpreter may answer (onRefuse 'interpret'): the callee is known and typed, it is only not applicable.
export const INTERPRETABLE_REFUSALS = Object.freeze(['outside-profile', 'revoked']);
export const NOVEL_MODES = Object.freeze(['refuse', 'warn']);
// The host event kinds of a call request (slice 2b adds agent-end / agent-refused, op 'agent', counted apart).
export const CALL_EVENT_KINDS = Object.freeze(['call-end', 'call-refused', 'call-deopt', 'interpret-child']);
export const ON_REFUSE = Object.freeze(['deopt', 'interpret', 'skip', 'value']), ON_DEOPT = Object.freeze(['propagate', 'interpret', 'interpret-child', 'skip', 'value']);

const sha256 = data => createHash('sha256').update(data).digest('hex');
const usd = x => Math.round(x * 1e6) / 1e6;
const short = (v, n = 300) => String(v?.message ?? v).slice(0, n);
// The same digests flow-v3.mjs computes (canonical JSON is run-compiled's canonicalJson, which equals flow-v2's canonical).
export const inputDigestOf = input => sha256(canonicalJson(input));
export const outDigestOf = v => (v === undefined ? null : sha256(canonicalJson(v)).slice(0, 16));
// promptDigest (slice 2, a per-call prompt only) joins the key; without one the key is slice 1's.
export const callKeyOf = ({ callee, inputDigest, parentPath, promptDigest }) => sha256(canonicalJson({ callee, inputDigest, parentPath, promptDigest }));
export const promptDigestOf = prompt => (typeof prompt === 'string' ? sha256(prompt) : undefined);
// A library hash: sha256 over the solver's bytes, a NUL, and the contract's canonical JSON (FLOW-V3 §1.2).
export const libraryHashOf = (solveSource, contract) =>
  'sha256:' + createHash('sha256').update(Buffer.from(solveSource)).update(Buffer.from([0])).update(canonicalJson(contract ?? {})).digest('hex');
// The gateway session's model allow-list with the call route added (null stays null: everything allowed).
export const withCallModel = models => (models == null ? null : [...new Set([...models, CALL_MODEL])]);

// ---- library registry (FLOW-V3 §1.2): per arm, append-only ----
// A row is {op: 'register', entry} or {op: 'revoke', hash, reason, at}. get(hash) is the latest registration with its
// version (1, 2, ... per hash: a new profile or evidence for the same bytes and contract) and any later revocation.
export function createRegistry({ dir = null } = {}) {
  const file = dir ? path.join(dir, REGISTRY_FILE) : null;
  const rows = file && existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const stubs = new Map();   // hash -> stub function (stub mode; never persisted)
  const append = row => { rows.push(row); if (file) { mkdirSync(dir, { recursive: true }); appendFileSync(file, JSON.stringify(row) + '\n'); } };
  const resolveSolve = p => (p && dir && !path.isAbsolute(p) ? path.join(dir, p) : p);
  function get(hash) {
    let entry = null, version = 0, revoked = null;
    for (const r of rows) {
      if (r.op === 'register' && r.entry?.hash === hash) { entry = r.entry; version++; revoked = null; }
      else if (r.op === 'revoke' && r.hash === hash && entry) revoked = r;
    }
    if (!entry) return null;
    return { ...entry, solvePath: resolveSolve(entry.solvePath), version, revoked: !!revoked, ...(revoked ? { revokedReason: revoked.reason ?? null } : {}), stub: stubs.get(hash) ?? null };
  }
  return {
    dir, rows,
    register(e) {
      if (!e || typeof e !== 'object') throw new Error('registry.register: an entry object is required');
      const contract = e.contract ?? { input: e.inputSchema ?? null, output: e.outputSchema ?? null, taskTemplate: e.taskTemplate ?? '' };
      if (!contract.output || typeof contract.output !== 'object') throw new Error('registry.register: contract.output (the typed return) is required');
      if (typeof e.stub !== 'function' && !e.solvePath) throw new Error('registry.register: solvePath (or a stub function, stub mode) is required');
      const flowVersion = e.flowVersion ?? 3;
      if (![2, 3].includes(flowVersion)) throw new Error('registry.register: flowVersion must be 2 or 3');
      if (e.profile != null && e.profile.schema !== PROFILE_SCHEMA) throw new Error(`registry.register: profile must be a ${PROFILE_SCHEMA} profile (profile.mjs learnProfile)`);
      // Slice 2: how the entry's profile is checked (validated; defaults dropped, so an entry without them is slice 1's).
      const checkOptions = checkOptionsOf(e.checkOptions);
      if (e.profile && !profileSupports(e.profile, checkOptions)) throw new Error("registry.register: checkOptions.lineFormat 'tolerant' needs a profile learned with PARAMS_V2 (observe.looseLines)");
      if (e.novelMode != null && !NOVEL_MODES.includes(e.novelMode)) throw new Error(`registry.register: novelMode must be one of ${NOVEL_MODES.join(', ')}`);
      const source = typeof e.stub === 'function' ? `stub:${e.stub}` : readFileSync(resolveSolve(e.solvePath));
      const hash = libraryHashOf(source, contract);
      // Slice 2b: how the solver could run code it is handed (none for a stub); the host refuses calls to an entry with findings.
      const codeExec = typeof e.stub === 'function' ? [] : codeExecutionOf(source.toString('utf8'));
      if (e.hash && e.hash !== hash) throw new Error(`registry.register: hash ${e.hash} does not match the solver bytes and contract (${hash})`);
      const entry = { hash, solvePath: e.solvePath ?? null, flowVersion, contract: { input: contract.input ?? null, output: contract.output, taskTemplate: contract.taskTemplate ?? '' },
        profile: e.profile ?? null, evidence: e.evidence ?? {}, effects: e.effects ?? 'none', ...(e.minBudgetUsd != null ? { minBudgetUsd: e.minBudgetUsd } : {}),
        ...(Object.keys(checkOptions).length ? { checkOptions } : {}), ...(e.novelMode ? { novelMode: e.novelMode } : {}), ...(codeExec.length ? { codeExec } : {}),
        registeredAt: e.registeredAt ?? new Date().toISOString() };
      if (typeof e.stub === 'function') stubs.set(hash, e.stub);
      append({ op: 'register', entry });
      return get(hash);
    },
    revoke(hash, reason = null) { if (!get(hash)) throw new Error(`registry.revoke: unknown hash ${hash}`); append({ op: 'revoke', hash, reason, at: new Date().toISOString() }); return get(hash); },
    get,
    // The index a compiler prompt shows (W-BED §5): hash, contract, profile size and evidence; no solver bytes.
    list() {
      const hashes = [...new Set(rows.filter(r => r.op === 'register').map(r => r.entry.hash))];
      return hashes.map(get).map(e => ({ hash: e.hash, version: e.version, flowVersion: e.flowVersion, contract: e.contract, profileTasks: e.profile?.n ?? 0,
        evidence: e.evidence, effects: e.effects, revoked: e.revoked, ...(e.minBudgetUsd != null ? { minBudgetUsd: e.minBudgetUsd } : {}), ...(e.codeExec?.length ? { executesCode: true } : {}) }));
    },
  };
}

// ---- reuse classification (W-BED §5, THESIS-JIT §6.7), from a host event plus the oracle, computed after the run ----
// oraclePass: the stage oracle on the child output (for call-end); calleeWouldPass: the callee run offline on the refused
// input (from the event's input / inputFile) and scored (for an outside-profile refusal). Missed reuse that never reached
// the host (a solver re-deriving what the library holds) is not visible here: it is read from the solver's span tree.
export function classifyReuse(event, { oraclePass = null, calleeWouldPass = null } = {}) {
  if (event?.kind === 'call-end') return oraclePass == null ? 'used' : oraclePass ? 'correct' : 'wrong';
  // A locally interpreted child (slice 2) is classified by the reuse decision it replaced: the refusal or the deopt.
  if (event?.kind === 'interpret-child') return classifyReuse({ ...event, kind: event.refused ? 'call-refused' : 'call-deopt' }, { oraclePass, calleeWouldPass });
  if (event?.kind === 'call-refused' && event.refused === 'outside-profile') return calleeWouldPass == null ? 'refused-profile' : calleeWouldPass ? 'missed' : 'refused-correctly';
  if (event?.kind === 'call-refused') return 'refused-other';
  if (event?.kind === 'call-deopt') return 'deopted';
  return 'unknown';
}

// ---- agent nodes (slice 2b): the host's agent configuration, validated (null: agent requests are refused no-agent-runner)
export function agentConfigOf(agent, { allowedModels = null, modelPort = null } = {}) {
  if (agent == null) return null;
  if (typeof agent !== 'object') throw new Error('createCallHost: agent must be an object { runner, ... }');
  const a = agent;
  if (a.runner != null && typeof a.runner !== 'function') throw new Error('createCallHost: agent.runner must be a function (agent-node.mjs agentNodeRunner or a stub)');
  const models = a.models ?? allowedModels ?? modelPort?.policy?.models?.map(m => m.id) ?? null;
  if (models != null && (!Array.isArray(models) || models.some(m => typeof m !== 'string'))) throw new Error('createCallHost: agent.models must be a list of model ids');
  const tools = a.tools ?? [...AGENT_TOOLS], defaultTools = a.defaultTools ?? [...DEFAULT_AGENT_TOOLS];
  if (!Array.isArray(tools) || tools.some(t => !AGENT_TOOLS.includes(t))) throw new Error(`createCallHost: agent.tools must be a subset of ${AGENT_TOOLS.join(', ')}`);
  if (!Array.isArray(defaultTools) || defaultTools.some(t => !tools.includes(t)) || defaultTools.length > MAX_AGENT_TOOLS) throw new Error('createCallHost: agent.defaultTools must be at most 5 of agent.tools');
  const int = (k, v, lo, hi) => { if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`createCallHost: agent.${k} must be an integer in ${lo}..${hi}`); return v; };
  const cfg = {
    runner: a.runner ?? null, models, model: a.model ?? null, tools, defaultTools,
    maxConcurrent: int('maxConcurrent', a.maxConcurrent ?? DEFAULT_AGENT_CONCURRENCY, 1, DEFAULT_AGENT_CONCURRENCY),
    maxPerRun: int('maxPerRun', a.maxPerRun ?? DEFAULT_AGENTS_PER_RUN, 1, DEFAULT_AGENTS_PER_RUN),
    maxDepth: int('maxDepth', a.maxDepth ?? DEFAULT_MAX_AGENT_DEPTH, 0, HARD_MAX_DEPTH),
    stallRestarts: int('stallRestarts', a.stallRestarts ?? DEFAULT_STALL_RESTARTS, 0, MAX_STALL_RESTARTS),
    floorUsd: a.floorUsd ?? DEFAULT_AGENT_FLOOR_USD, stallMs: a.stallMs ?? null, textLabel: a.textLabel ?? 'synthetic',
    maxTimeoutMs: a.maxTimeoutMs ?? 30 * 60 * 1000,
  };
  if (cfg.model != null && typeof cfg.model !== 'string') throw new Error('createCallHost: agent.model must be a model id');
  if (!(typeof cfg.floorUsd === 'number' && cfg.floorUsd >= 0)) throw new Error('createCallHost: agent.floorUsd must be a number >= 0');
  if (cfg.stallMs != null && !(Number.isInteger(cfg.stallMs) && cfg.stallMs > 0)) throw new Error('createCallHost: agent.stallMs must be a positive integer');
  if (!TEXT_LABELS.includes(cfg.textLabel)) throw new Error(`createCallHost: agent.textLabel must be one of ${TEXT_LABELS.join(', ')}`);
  return cfg;
}
// A returns schema from a solver is not host-owned: compiled as untrusted (no regular expressions, no formats).
function returnsProblem(schema) {
  try { compileDataSchema(schema); return null; } catch (e) { return short(e, 300); }
}
function returnsErrors(schema, value) {
  try { validateData(schema, value, 'answer'); return null; }
  catch (e) { return (e.details ?? [{ message: String(e.message ?? e) }]).slice(0, 5).map(x => `${x.instancePath ?? ''} ${x.message ?? ''}`.trim()); }
}
const AGENT_SPAN_RE = /^agent:[^/]{1,200}#\d+$/;

const safe = s => String(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
const dirOf = spanPath => spanPath.split('/').map(safe).join('__').slice(0, 200);
const SPAN_RE = /^call:[^/]{1,200}#\d+$/;

export function createCallHost({ registry, modelPort = null, ledger = null, maxDepth = DEFAULT_MAX_DEPTH, workRoot = null, mode = 'sandbox', allowedModels = null,
  maxChildren = MAX_TREE_CHILDREN, budgetFloorUsd = DEFAULT_BUDGET_FLOOR_USD, maxTimeoutMs = 20 * 60 * 1000, journal = [], arm = null, taskKey = null, log = () => {},
  profileCheck = {}, novelMode = 'refuse', interpreter = null, interpretFloorUsd = DEFAULT_INTERPRET_FLOOR_USD, agent = null } = {}) {
  if (!registry || typeof registry.get !== 'function') throw new Error('createCallHost: a registry (createRegistry) is required');
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > HARD_MAX_DEPTH) throw new Error(`createCallHost: maxDepth must be an integer in 1..${HARD_MAX_DEPTH}`);
  if (!['sandbox', 'stub'].includes(mode)) throw new Error("createCallHost: mode must be 'sandbox' or 'stub'");
  if (mode === 'sandbox' && !workRoot) throw new Error('createCallHost: sandbox mode needs workRoot (child workdirs go under <workRoot>/calls/)');
  const hostCheck = checkOptionsOf(profileCheck);
  if (!NOVEL_MODES.includes(novelMode)) throw new Error(`createCallHost: novelMode must be one of ${NOVEL_MODES.join(', ')}`);
  if (interpreter != null && typeof interpreter !== 'function') throw new Error('createCallHost: interpreter must be a function ({task, outputSchema, budgetUsd, timeoutMs, workdir, ...}) => {answer, costUsd}');
  if (!(typeof interpretFloorUsd === 'number' && interpretFloorUsd >= 0)) throw new Error('createCallHost: interpretFloorUsd must be a number >= 0');
  const events = [], journalOut = [], spans = new Map(), memo = new Map();
  for (const row of journal ?? []) if (row?.key && row.result?.status === 'ok') memo.set(row.key, { result: row.result, replayed: true });   // call and agent rows (keys differ)
  const tree = { children: 0 };
  const agentCfg = agentConfigOf(agent, { allowedModels, modelPort });
  const agentState = { admitted: 0, running: 0, queue: [], harvests: [], ordinals: new Map() };

  const newScope = ({ span, parent, path: p, depth, budgetUsd, ancestors, ledger: l = null }) => {
    const s = { span, parent, path: p, depth, budgetUsd, spentUsd: 0, reservedUsd: 0, inFlight: 0, modelReservedUsd: 0, ancestors, ledger: l, ordinals: new Map(), usedSpans: new Set(), calls: 0 };
    spans.set(p, s);
    return s;
  };
  // What this scope can still give a child: its budget less spend, its children in flight and its model calls in flight;
  // at the root with a gateway Ledger also what the Ledger has left (plus this request's own gateway hold, which the
  // gateway took for exactly this call).
  const remainingOf = (s, gatewayHoldUsd = 0) => {
    const own = s.budgetUsd - s.spentUsd - s.reservedUsd - s.modelReservedUsd;
    return s.ledger && typeof s.ledger.remaining === 'function' ? Math.min(own, s.ledger.remaining() + gatewayHoldUsd) : own;
  };
  // The budget rule for a reservation of `amount` from scope: null when it fits, else [refusal, detail] (FLOW-V3 §1.3; slice 2a).
  const budgetRefusalFor = (scope, amount, floor, gatewayHoldUsd = 0) => {
    if (amount < floor) return ['BUDGET_TOO_SMALL', { budgetUsd: amount, floorUsd: floor }];
    const remaining = remainingOf(scope, gatewayHoldUsd);
    if (amount < remaining) return null;
    // It would fit if the siblings in flight were done: the budget tree, not this call, is short.
    if (scope.inFlight > 0 && amount < remaining + scope.reservedUsd) {
      return ['BUDGET_TREE', { budgetUsd: amount, remainingUsd: usd(remaining), shortfallUsd: usd(amount - remaining), inFlight: scope.inFlight, reservedInFlightUsd: usd(scope.reservedUsd),
        parentBudgetUsd: scope.budgetUsd, parentSpentUsd: usd(scope.spentUsd), rule: 'Σ reservations in flight + this reservation < parent budget − spent' }];
    }
    return ['budget-exceeds-parent', { budgetUsd: amount, remainingUsd: usd(remaining) }];
  };
  // Reserve `amount` on scope for the duration of fn (a child, an interpreter or an agent node), then release it; spend is
  // booked by the caller. When the gateway already holds it on the scope's Ledger (gatewayHoldUsd), it is not held again.
  const reserveOn = async (scope, amount, gatewayHoldUsd, fn) => {
    scope.reservedUsd += amount; scope.inFlight++;
    const held = !gatewayHoldUsd && scope.ledger && typeof scope.ledger.hold === 'function';
    if (held) scope.ledger.hold(amount);
    try { return await fn(); }
    finally { scope.reservedUsd = Math.max(0, scope.reservedUsd - amount); scope.inFlight--; if (held) scope.ledger.release(amount); }
  };
  const save = (dir, rel, value) => {
    if (!workRoot) return null;
    const file = path.join(workRoot, dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    if (!existsSync(file)) writeFileSync(file, JSON.stringify(value));
    return path.relative(workRoot, file);
  };

  // A model port for one scope: call requests go to handle(); other requests to the real port, booked under the scope.
  function wrapPort(scope) {
    return {
      policy: modelPort?.policy ?? null, providers: modelPort?.providers ?? {}, policyHash: modelPort?.policyHash ?? null, ...(modelPort?.memo ? { memo: modelPort.memo } : {}), scope,
      async call(req) {
        if (req?.modelId === CALL_MODEL) {
          let request = null; try { request = JSON.parse(req.prompt); } catch {}
          // services.mjs passes the reservation it holds for this call on the gateway Ledger (slice 2a); a plain port, none.
          const gatewayHoldUsd = typeof req.gatewayHoldUsd === 'number' && req.gatewayHoldUsd > 0 ? req.gatewayHoldUsd : 0;
          const r = request?.op === 'agent' ? await handleAgent(request, scope, { gatewayHoldUsd }) : await handle(request, scope, { gatewayHoldUsd });
          return { ok: true, value: r.value, costUsd: r.costUsd, imputedUsd: 0, latencyMs: r.ms, modelId: CALL_MODEL,
            // The child's unknown spend is already in costUsd at its bound: flag it, add nothing more.
            ...(r.costUnknown ? { costUnknown: true, costUpperUsd: 0 } : {}) };
        }
        if (!modelPort) throw new FoundryError('GATEWAY_NO_MODELS', 'no model access in this call host');
        // A child's reservation is held by this host (and, at a gateway that knows flow:call, by the gateway too): a model
        // call that does not fit next to the children in flight is refused here.
        const entry = modelPort.policy?.models?.find(m => m.id === req.modelId);
        const reserve = reserveFor(modelPort.policy, { model: req.modelId, system: req.system, prompt: req.prompt, schema: req.schema }, modelPort.providers?.[entry?.provider]?.maxBudgetUsd ?? 1);
        if (scope.reservedUsd > 0 && scope.spentUsd + scope.reservedUsd + scope.modelReservedUsd + reserve > scope.budgetUsd + 1e-9) {
          throw new FoundryError('GATEWAY_BUDGET', `model call refused: $${usd(scope.reservedUsd)} of this scope's budget is held by calls in flight`);
        }
        scope.modelReservedUsd += reserve;
        let r;
        try { r = await modelPort.call(req); } finally { scope.modelReservedUsd = Math.max(0, scope.modelReservedUsd - reserve); }
        scope.spentUsd += (r?.costUsd ?? 0); scope.calls++;
        return r;
      },
    };
  }

  async function runChild(entry, task, child, timeoutMs) {
    if (mode === 'stub') {
      if (typeof entry.stub !== 'function') return { status: 'crash', error: { code: 'NO_STUB', message: 'stub mode: the entry has no stub function' }, costUsd: 0 };
      const childPort = wrapPort(child);
      const ctx = { span: child.span, path: child.path, depth: child.depth, budgetUsd: child.budgetUsd, prompt: task.prompt, call: request => handle(request, child).then(r => r.value),
        agent: request => handleAgent(request, child).then(r => r.value), model: req => childPort.call(req) };
      const r = (await entry.stub(task.inputs, ctx)) ?? {};
      const status = r.status ?? 'ok';
      let out = { status, output: r.output ?? null, deopt: r.deopt ?? null, error: r.error ?? null, costUsd: usd((r.costUsd ?? 0) + child.spentUsd), costUnknown: false };
      if (status === 'ok') {
        const check = validateOutput(entry.contract.output, out.output);
        if (!check.valid) out = { ...out, status: 'invalid', meta: { schemaErrors: check.errors } };
      }
      return out;
    }
    const workdir = path.join(workRoot, 'calls', dirOf(child.path));
    // runCompiled writes tools/flow-scope.json itself (after clearing a stale one), from flowScope.
    const r = await runCompiled({ solvePath: entry.solvePath, task, modelPort: wrapPort(child), perTaskUsd: child.budgetUsd, timeoutMs, workdir, outputSchema: entry.contract.output,
      allowedModels: withCallModel(allowedModels), flowPath: entry.flowVersion === 2 ? FLOW_V2 : FLOW_V3, label: `call:${entry.hash.slice(7, 19)}`,
      flowScope: { span: child.span, parent: child.parent, path: child.path, depth: child.depth } });
    const traceFile = path.join(workdir, 'trace.jsonl');
    return { ...r, childTrace: path.relative(workRoot, traceFile), childTraceSha256: existsSync(traceFile) ? sha256(readFileSync(traceFile)) : null };
  }

  // FLOW-V3 §1.5 local deopt: the interpreter on the child task alone, under budgetUsd (already reserved by the caller).
  // Returns {ok, output?, error?, costUsd, costUnknown, traceId}; never throws.
  async function interpretChild({ entry, task, span, childPath, budgetUsd, timeoutMs, reason }) {
    const workdir = workRoot ? path.join(workRoot, 'interpret', dirOf(childPath)) : null;
    if (workdir) mkdirSync(workdir, { recursive: true });
    let r;
    try { r = (await interpreter({ task, outputSchema: entry.contract.output, budgetUsd, timeoutMs, workdir, name: span?.replace(/^call:|#\d+$/g, '') ?? null, span, path: childPath, callee: entry.hash, reason, arm, taskKey })) ?? {}; }
    catch (error) { return { ok: false, error: { code: error.code ?? 'INTERPRETER', message: short(error, 400) }, costUsd: 0, costUnknown: false, traceId: null }; }
    const costUnknown = !!r.costUnknown, costUsd = usd(costUnknown ? Math.max(r.costUsd ?? 0, budgetUsd) : (r.costUsd ?? 0));
    const traceId = r.traceId ?? null;
    if (r.answer == null) return { ok: false, error: r.error ?? { code: 'NO_ANSWER' }, costUsd, costUnknown, traceId };
    const check = validateOutput(entry.contract.output, r.answer);
    if (!check.valid) return { ok: false, error: { code: 'OUTPUT_SCHEMA', errors: check.errors }, costUsd, costUnknown, traceId };
    return { ok: true, output: r.answer, costUsd, costUnknown, traceId };
  }

  // One call request from `scope`. Returns {value (the answer flow-v3 reads), costUsd, costUnknown, ms}; never throws.
  async function handle(request, scope, { gatewayHoldUsd = 0 } = {}) {
    const t0 = Date.now(), req = request && typeof request === 'object' ? request : {};
    const name = typeof req.name === 'string' && req.name ? req.name.slice(0, 200) : null, callee = typeof req.callee === 'string' && req.callee ? req.callee : null;
    const childUsd = typeof req.budgetUsd === 'number' && Number.isFinite(req.budgetUsd) ? req.budgetUsd : null;
    const inputDigest = req.input === undefined ? null : inputDigestOf(req.input);
    const prompt = typeof req.prompt === 'string' ? req.prompt : null, promptDigest = promptDigestOf(prompt ?? undefined);
    const key = callee && inputDigest ? callKeyOf({ callee, inputDigest, parentPath: scope.path, promptDigest }) : null;
    const onRefuse = ON_REFUSE.includes(req.onRefuse) ? req.onRefuse : 'deopt', onDeopt = ON_DEOPT.includes(req.onDeopt) ? req.onDeopt : 'propagate';
    let entry = null, span = null, applicability = { checked: false }, warning = null;
    if (name) {
      // The SDK's span id is used when well formed and unused in this scope (it is deterministic: fixed in call order);
      // otherwise the host numbers it.
      span = typeof req.span === 'string' && SPAN_RE.test(req.span) && req.span.startsWith(`call:${name}#`) && !scope.usedSpans.has(req.span) ? req.span : null;
      if (!span) { let k = scope.ordinals.get(name) ?? 0; while (scope.usedSpans.has(`call:${name}#${k}`)) k++; span = `call:${name}#${k}`; scope.ordinals.set(name, k + 1); }
      scope.usedSpans.add(span);
    }
    const childPath = span ? `${scope.path}/${span}` : null, depth = scope.depth + 1;

    const finish = (result, { costUsd = 0, costUnknown = false, child = null } = {}) => {
      const kind = result.interpreted ? 'interpret-child' : result.status === 'ok' ? 'call-end' : result.status === 'refused' ? 'call-refused' : 'call-deopt';
      const reservedUsd = result.status === 'refused' || result.memo ? 0 : childUsd;
      const ok = result.status === 'ok' || result.status === 'interpreted';
      const value = { status: result.status, ...(ok ? { output: result.output, outDigest: outDigestOf(result.output) } : {}),
        ...(result.refused ? { refused: result.refused, detail: result.detail ?? null } : {}),
        // An interpreted child also names the deopt it replaced (onDeopt 'interpret').
        ...(result.status === 'deopt' || (result.interpreted && result.deopt) ? { deopt: result.deopt, childStatus: result.childStatus } : {}),
        ...(result.interpreted ? { interpreted: result.interpreted } : {}), ...(warning ? { warning } : {}),
        key, span, path: childPath, depth, calleeVersion: entry?.version ?? null,
        ...(result.childTrace ? { childTrace: result.childTrace, childTraceSha256: result.childTraceSha256 ?? null } : {}),
        ...(result.memo ? { memo: result.memo } : {}), spentUsd: usd(costUsd), reservedUsd };
      // Inputs and outputs by key (content addressed) under workRoot, or inline without one: the curriculum's oracle pass
      // scores call-end outputs and re-runs refused inputs offline (classifyReuse).
      const inputRef = req.input === undefined ? {} : workRoot ? { inputFile: save('inputs', `${inputDigest}.json`, req.input) } : { input: req.input };
      const outputRef = !ok ? {} : workRoot ? { outputFile: save('outputs', `${outDigestOf(result.output)}.json`, result.output) } : { output: result.output };
      // outcome: the reuse decision (an interpreted child keeps the refusal or deopt it replaced).
      const outcome = result.interpreted ? (result.refused ? 'refused' : 'deopt') : result.status;
      events.push({ at: new Date().toISOString(), kind, arm, taskKey, key, name, callee, calleeVersion: entry?.version ?? null, calleeEvidence: entry?.evidence ?? null,
        span, parent: scope.span, path: childPath, depth, inputDigest, ...(promptDigest ? { promptDigest } : {}), ...inputRef, budgetUsd: childUsd, outcome,
        ...(result.refused ? { refused: result.refused, refusedDetail: result.detail ?? null } : {}),
        applicability, ...(warning ? { warned: true } : {}), ...(result.status === 'deopt' || result.deopt ? { deopt: result.deopt, childStatus: result.childStatus } : {}),
        ...(result.interpreted ? { interpreted: result.interpreted, localDeopt: true } : {}),
        ...(ok ? { outDigest: value.outDigest, ...outputRef } : {}),
        ...(result.childTrace ? { childTrace: result.childTrace, childTraceSha256: result.childTraceSha256 ?? null } : {}),
        spentUsd: usd(costUsd), reservedUsd, ...(costUnknown ? { costUnknown: true } : {}), memo: result.memo ?? null,
        ...(child ? { childSpent: { model: usd(child.spentUsd), calls: child.calls } } : {}), ms: Date.now() - t0 });
      log(`${kind} ${childPath ?? '(bad request)'} ${result.status === 'refused' ? result.refused : result.status} $${usd(costUsd)}`);
      return { value, costUsd: usd(costUsd), costUnknown, ms: Date.now() - t0 };
    };
    const refuse = (refused, detail = null) => finish({ status: 'refused', refused, detail });
    // The budget rule for a reservation of `amount` from this scope: null when it fits, else the refusal [code, detail].
    const budgetRefusal = (amount, floor) => budgetRefusalFor(scope, amount, floor, gatewayHoldUsd);
    // Reserve `amount` for the duration of fn (the child or the interpreter), then release it; spend is booked by the caller.
    const reserved = (amount, fn) => reserveOn(scope, amount, gatewayHoldUsd, fn);
    const timeoutMs = Math.min(maxTimeoutMs, Number.isInteger(req.timeoutMs) && req.timeoutMs > 0 ? req.timeoutMs : 120000);
    // onRefuse 'interpret': an applicability refusal is answered by the interpreter under the call's budget, else refused.
    const refuseOrInterpret = async (refused, detail, task) => {
      if (onRefuse !== 'interpret' || !INTERPRETABLE_REFUSALS.includes(refused)) return refuse(refused, detail);
      if (!interpreter) return refuse(refused, { ...(detail ?? {}), interpret: { refused: 'no-interpreter' } });
      const no = budgetRefusal(childUsd, interpretFloorUsd);
      if (no) return refuse(refused, { ...(detail ?? {}), interpret: { refused: no[0], ...no[1] } });
      tree.children++;
      const r = await reserved(childUsd, () => interpretChild({ entry, task, span, childPath, budgetUsd: childUsd, timeoutMs, reason: refused }));
      scope.spentUsd += r.costUsd;
      const interpreted = { ok: r.ok, by: 'interpreter', traceId: r.traceId, costUsd: r.costUsd, ...(r.ok ? {} : { error: r.error }) };
      if (r.ok) return finish({ status: 'interpreted', output: r.output, refused, detail, interpreted }, { costUsd: r.costUsd, costUnknown: r.costUnknown });
      return finish({ status: 'deopt', childStatus: 'interpret-failed', refused, detail, interpreted, deopt: { kind: 'interpret-child', name: refused, detail: r.error ?? null } }, { costUsd: r.costUsd, costUnknown: r.costUnknown });
    };

    try {
      if (req.v !== CALL_PROTOCOL || req.op !== 'call' || !name || !callee || req.input === undefined || !(childUsd > 0) || (req.prompt != null && prompt == null)) {
        return refuse('bad-request', { expected: `{v: ${CALL_PROTOCOL}, op: 'call', callee, input, name, budgetUsd > 0, prompt?: string}` });
      }
      entry = registry.get(callee);
      if (!entry) return refuse('unknown-hash');
      const task = { prompt: prompt ?? entry.contract.taskTemplate ?? '', inputs: req.input };
      // A revoked callee is refused here, as in slice 1, unless the caller asked for the interpreter (after the checks below).
      if (entry.revoked && onRefuse !== 'interpret') return refuse('revoked', { reason: entry.revokedReason ?? null });
      if (scope.ancestors.includes(callee)) return refuse('recursion', { chain: scope.ancestors });
      if (depth > maxDepth) return refuse('depth', { depth, maxDepth });
      if (tree.children >= maxChildren) return refuse('tree-size', { maxChildren });
      if ((entry.effects ?? 'none') !== 'none') return refuse('effects', { effects: entry.effects });
      if (entry.codeExec?.length) return refuse('executes-code', { findings: entry.codeExec.slice(0, 5) });
      const inCheck = validateOutput(entry.contract.input, req.input);
      if (!inCheck.valid) return refuse('input-schema', { errors: inCheck.errors });
      if (entry.revoked) return refuseOrInterpret('revoked', { reason: entry.revokedReason ?? null }, task);
      if (entry.profile) {
        const opts = { ...hostCheck, ...(entry.checkOptions ?? {}) }, modeOf = entry.novelMode ?? novelMode;
        const p = checkProfile(entry.profile, task, opts);
        applicability = { checked: true, novel: p.novel, score: p.score, n: p.n, ...(Object.keys(opts).length ? { options: opts } : {}),
          reasons: p.reasons.slice(0, 5).map(r => ({ feature: r.feature, path: r.path, ratio: r.ratio, ...(r.unseen !== undefined ? { unseen: r.unseen } : {}) })) };
        if (p.novel && modeOf === 'refuse') return refuseOrInterpret('outside-profile', { score: p.score, reasons: applicability.reasons }, task);
        if (p.novel) {
          // novelMode 'warn': the call runs; the warning is logged as its own event and returned with the answer.
          warning = { novel: true, score: p.score, reasons: applicability.reasons };
          events.push({ at: new Date().toISOString(), kind: 'profile-warn', arm, taskKey, key, name, callee, calleeVersion: entry.version, span, parent: scope.span, path: childPath, depth, inputDigest,
            ...(promptDigest ? { promptDigest } : {}), applicability });
          log(`profile-warn ${childPath} score ${p.score}`);
        }
      }
      const hit = memo.get(key);
      if (hit) return finish({ ...hit.result, memo: hit.replayed ? 'replay' : 'repeat' });
      const no = budgetRefusal(childUsd, entry.minBudgetUsd ?? budgetFloorUsd);
      if (no) return refuse(no[0], no[1]);

      // Reserve, run, release. The reservation returns to the caller when the child ends; its spend is booked to the caller.
      tree.children++;
      const child = newScope({ span, parent: scope.span, path: childPath, depth, budgetUsd: childUsd, ancestors: [...scope.ancestors, callee] });
      let r, interp = null;
      await reserved(childUsd, async () => {
        try { r = await runChild(entry, task, child, timeoutMs); }
        catch (error) { r = { status: 'crash', error: { code: error.code ?? 'CALL_HOST', message: short(error, 400) }, costUsd: usd(child.spentUsd) }; }
        // onDeopt 'interpret' (FLOW-V3 §1.5): a child that did not return a typed answer is interpreted with what it left of
        // the reservation, inside the same reservation.
        if (r.status !== 'ok' && ['interpret', 'interpret-child'].includes(onDeopt) && interpreter) {
          const left = usd(childUsd - (r.costUsd ?? 0));
          interp = left >= interpretFloorUsd ? await interpretChild({ entry, task, span, childPath, budgetUsd: left, timeoutMs, reason: r.status })
            : { ok: false, error: { code: 'BUDGET_TOO_SMALL', budgetUsd: left, floorUsd: interpretFloorUsd }, costUsd: 0, costUnknown: false, traceId: null, skipped: true };
        }
      });
      const costUsd = usd((r.costUsd ?? 0) + (interp?.costUsd ?? 0));
      scope.spentUsd += costUsd;
      const trace = { childTrace: r.childTrace ?? null, childTraceSha256: r.childTraceSha256 ?? null };
      let result;
      if (r.status === 'ok') {
        result = { status: 'ok', output: r.output, ...trace };
        memo.set(key, { result: { status: 'ok', output: r.output, ...trace }, replayed: false });
        journalOut.push({ key, callee, calleeVersion: entry.version, inputDigest, ...(promptDigest ? { promptDigest } : {}), parentPath: scope.path, result: { status: 'ok', output: r.output, ...trace } });
      } else if (r.status === 'invalid') {
        result = { status: 'deopt', childStatus: 'invalid', deopt: { kind: 'output-schema', name: 'contract.output', detail: { errors: r.meta?.schemaErrors ?? r.error?.message ?? null } }, ...trace };
      } else if (r.status === 'deopt') {
        result = { status: 'deopt', childStatus: 'deopt', deopt: { kind: r.deopt?.kind ?? 'unknown', name: r.deopt?.name ?? null, detail: r.deopt?.detail ?? null }, ...trace };
      } else {
        result = { status: 'deopt', childStatus: r.status, deopt: { kind: r.status === 'timeout' ? 'timeout' : 'crash', name: null, detail: r.error ?? null }, ...trace };
      }
      if (interp) {
        const interpreted = { ok: interp.ok, by: 'interpreter', traceId: interp.traceId, costUsd: interp.costUsd, ...(interp.ok ? {} : { error: interp.error }) };
        result = interp.ok ? { ...result, status: 'interpreted', output: interp.output, interpreted }
          : { ...result, interpreted, childStatus: result.childStatus };
      }
      return finish(result, { costUsd, costUnknown: !!r.costUnknown || !!interp?.costUnknown, child });
    } catch (error) {
      // A host fault before the child ran (a malformed registry entry, a profile that cannot be read): a child deopt.
      return finish({ status: 'deopt', childStatus: 'host-error', deopt: { kind: 'host-error', name: null, detail: short(error, 400) } });
    }
  }

  // ---- slice 2b: one agent-node request from `scope` (see the header). Returns {value, costUsd, costUnknown, ms}; never throws.
  const acquireSlot = async () => { while (agentState.running >= agentCfg.maxConcurrent) await new Promise(r => agentState.queue.push(r)); agentState.running++; };
  const releaseSlot = () => { agentState.running--; agentState.queue.shift()?.(); };
  async function handleAgent(request, scope, { gatewayHoldUsd = 0 } = {}) {
    const t0 = Date.now(), req = request && typeof request === 'object' ? request : {};
    const name = typeof req.name === 'string' && req.name ? req.name.slice(0, 200) : null;
    const amount = typeof req.budgetUsd === 'number' && Number.isFinite(req.budgetUsd) ? req.budgetUsd : null;
    const attempt = Number.isInteger(req.attempt) && req.attempt >= 0 ? req.attempt : 0;
    const files = req.files && typeof req.files === 'object' && !Array.isArray(req.files) ? req.files : {};
    const retryReason = typeof req.retryReason === 'string' && req.retryReason ? req.retryReason.slice(0, 1000) : null;
    // The SDK's span id when well formed (a retry keeps its node's span); otherwise the host numbers the node.
    let span = null;
    if (name) {
      span = typeof req.span === 'string' && AGENT_SPAN_RE.test(req.span) && req.span.startsWith(`agent:${name}#`) ? req.span : null;
      if (!span) { const k = agentState.ordinals.get(`${scope.path}\0${name}`) ?? 0; agentState.ordinals.set(`${scope.path}\0${name}`, k + 1); span = `agent:${name}#${k}`; }
    }
    const nodePath = span ? `${scope.path}/${span}` : null, depth = scope.depth + 1;
    const filesDigest = sha256(canonicalJson(files)), instructionsDigest = typeof req.instructions === 'string' ? sha256(req.instructions) : null;
    const returnsDigest = sha256(canonicalJson(req.returns ?? null)), inputsDigest = req.inputs === undefined ? null : sha256(canonicalJson(req.inputs));
    const key = name ? sha256(canonicalJson({ op: 'agent', name, parentPath: scope.path, filesDigest, instructionsDigest, returnsDigest, inputsDigest, attempt, retryReason })) : null;
    let model = null, tools = null;
    const fileBytes = Object.values(files).reduce((s, t) => s + (typeof t === 'string' ? Buffer.byteLength(t) : 0), 0);

    const finish = (result, { costUsd = 0, costUnknown = false } = {}) => {
      const kind = result.status === 'refused' ? 'agent-refused' : 'agent-end';
      const reservedUsd = result.status === 'refused' || result.memo ? 0 : amount;
      const ok = result.status === 'ok', run = result.run ?? {};
      const agentInfo = { turns: run.turns ?? null, transcriptSha256: run.transcriptSha256 ?? null, scripts: run.scripts?.length ?? run.scriptCount ?? 0, harvested: result.harvested ?? 0,
        nestedModelAttempts: run.nestedModelAttempts ?? 0, hiddenPathAttempts: run.hiddenPathAttempts ?? 0, traceId: run.traceId ?? null,
        ...(result.stalls ? { stalled: result.stalls, restarts: result.restarts ?? 0 } : {}) };
      const value = { status: result.status, ...(ok ? { output: result.output, outDigest: outDigestOf(result.output) } : {}),
        ...(result.refused ? { refused: result.refused, detail: result.detail ?? null } : {}), ...(result.void ? { void: result.void } : {}), ...(result.error ? { error: result.error } : {}),
        key, span, path: nodePath, depth, model, tools, attempt, agent: agentInfo, ...(result.memo ? { memo: result.memo } : {}), spentUsd: usd(costUsd), reservedUsd };
      const outputRef = !ok ? {} : workRoot ? { outputFile: save('outputs', `${outDigestOf(result.output)}.json`, result.output) } : { output: result.output };
      events.push({ at: new Date().toISOString(), kind, op: 'agent', arm, taskKey, key, name, span, parent: scope.span, path: nodePath, depth, model, tools, budgetUsd: amount, attempt,
        ...(retryReason ? { retryReason } : {}), filesDigest, instructionsDigest, returnsDigest, files: Object.keys(files).length, fileBytes, cluster: filesClusterOf(files),
        outcome: result.status, ...(result.refused ? { refused: result.refused, refusedDetail: result.detail ?? null } : {}), ...(result.void ? { void: result.void } : {}),
        ...(result.error ? { error: result.error } : {}), ...(ok ? { outDigest: value.outDigest, ...outputRef } : {}), ...(result.harvestFile ? { harvestFile: result.harvestFile } : {}),
        ...agentInfo, spentUsd: usd(costUsd), reservedUsd, ...(costUnknown ? { costUnknown: true } : {}), memo: result.memo ?? null, ms: Date.now() - t0 });
      log(`${kind} ${nodePath ?? '(bad request)'} ${result.status === 'refused' ? result.refused : result.status}${result.void ? `:${result.void}` : ''} ${usd(costUsd)}`);
      return { value, costUsd: usd(costUsd), costUnknown, ms: Date.now() - t0 };
    };
    const refuse = (refused, detail = null) => finish({ status: 'refused', refused, detail });

    try {
      if (req.v !== CALL_PROTOCOL || req.op !== 'agent' || !name || typeof req.instructions !== 'string' || !req.instructions.trim() || !(amount > 0)) {
        return refuse('bad-request', { expected: `{v: ${CALL_PROTOCOL}, op: 'agent', name, instructions, files?, inputs?, returns, budgetUsd > 0, attempt?}` });
      }
      if (!req.returns || typeof req.returns !== 'object' || Array.isArray(req.returns)) return refuse('no-returns');
      const rp = returnsProblem(req.returns);
      if (rp) return refuse('no-returns', { problem: rp });
      if (!agentCfg?.runner) return refuse('no-agent-runner');
      if (scope.depth > agentCfg.maxDepth) return refuse('depth', { depth: scope.depth, maxAgentDepth: agentCfg.maxDepth });
      model = typeof req.model === 'string' && req.model ? req.model : agentCfg.model;
      if (!model || (agentCfg.models && !agentCfg.models.includes(model))) return refuse('model-not-in-policy', { model, allowed: agentCfg.models });
      tools = Array.isArray(req.tools) ? req.tools : agentCfg.defaultTools;
      if (!tools.length || tools.length > MAX_AGENT_TOOLS || tools.some(t => !agentCfg.tools.includes(t))) return refuse('tool-not-allowed', { tools: tools.slice(0, 10), allowed: agentCfg.tools, max: MAX_AGENT_TOOLS });
      const fp = agentFilesProblem(files);
      if (fp) return refuse('bad-files', { problem: fp });
      if (req.inputs !== undefined && JSON.stringify(req.inputs) === undefined) return refuse('bad-request', { problem: 'inputs must be JSON' });
      // D10: an agent node gets text only from a run whose text the stream declared synthetic.
      if (agentCfg.textLabel !== 'synthetic') return refuse('third-party-text', { label: agentCfg.textLabel });
      const hit = memo.get(key);
      if (hit) return finish({ ...hit.result, memo: hit.replayed ? 'replay' : 'repeat' });
      if (agentState.admitted >= agentCfg.maxPerRun) return refuse('per-run-limit', { maxPerRun: agentCfg.maxPerRun });
      const no = budgetRefusalFor(scope, amount, agentCfg.floorUsd, gatewayHoldUsd);
      if (no) return refuse(no[0], no[1]);
      agentState.admitted++;
      const timeoutMs = Math.min(agentCfg.maxTimeoutMs, Number.isInteger(req.timeoutMs) && req.timeoutMs > 0 ? req.timeoutMs : 10 * 60 * 1000);
      const stallMs = Number.isInteger(req.stallMs) && req.stallMs > 0 ? req.stallMs : agentCfg.stallMs;
      const workdir = workRoot ? path.join(workRoot, 'agents', `${dirOf(nodePath)}-a${attempt}`) : null;
      let run = null, spent = 0, restarts = 0, stalls = 0, costUnknown = false;
      await reserveOn(scope, amount, gatewayHoldUsd, async () => {
        await acquireSlot();
        try {
          for (;;) {
            // The stall watchdog: no workdir activity (the runner's progress calls) for stallMs aborts the session.
            const ac = new AbortController();
            let last = Date.now(), stalled = false, timer = null;
            if (stallMs) { timer = setInterval(() => { if (Date.now() - last > stallMs) { stalled = true; ac.abort(); } }, Math.max(5, Math.min(1000, Math.floor(stallMs / 4)))); timer.unref?.(); }
            let r;
            try {
              r = (await agentCfg.runner({ instructions: req.instructions, files, inputs: req.inputs, returns: req.returns, model, tools, budgetUsd: usd(amount - spent), timeoutMs,
                workdir: workdir ? (restarts ? `${workdir}-r${restarts}` : workdir) : null, signal: ac.signal, progress: () => { last = Date.now(); }, retryReason, name, span, attempt,
                path: nodePath, arm, taskKey })) ?? {};
            } catch (error) { r = { answer: null, costUsd: 0, error: { code: error.code ?? 'AGENT_RUNNER', message: short(error, 400) } }; }
            finally { if (timer) clearInterval(timer); }
            const unknown = !!r.costUnknown;
            spent = usd(spent + (unknown ? Math.max(r.costUsd ?? 0, amount - spent) : (r.costUsd ?? 0)));
            costUnknown ||= unknown;
            run = { ...r, stalled };
            if (!stalled) break;
            stalls++;
            if (restarts >= agentCfg.stallRestarts || usd(amount - spent) < agentCfg.floorUsd) break;
            restarts++;
          }
        } finally { releaseSlot(); }
      });
      scope.spentUsd += spent;
      // Void, failed or ok (the verify is the caller's).
      let result;
      if ((run.nestedModelAttempts ?? 0) > 0) result = { status: 'void', void: 'nested-model' };
      else if ((run.hiddenPathAttempts ?? 0) > 0) result = { status: 'void', void: 'hidden-path' };
      else if (run.stalled) result = { status: 'failed', error: { code: 'STALLED', stallMs, restarts } };
      else if (run.answer == null) result = { status: 'failed', error: run.error ?? { code: 'NO_ANSWER' } };
      else {
        const errs = returnsErrors(req.returns, run.answer);
        result = errs ? { status: 'failed', error: { code: 'RETURNS_SCHEMA', errors: errs } } : { status: 'ok', output: run.answer };
      }
      result = { ...result, run, restarts, stalls };
      // Harvest (FLOW-V3 §2.2): an ok node's scripts, task and answer, for a sub-compile once its verify passed.
      if (result.status === 'ok' && req.harvest !== false && Array.isArray(run.scripts) && run.scripts.length) {
        const record = { name, span, attempt, key, model, cluster: filesClusterOf(files), instructions: req.instructions, files, ...(req.inputs !== undefined ? { inputs: req.inputs } : {}),
          returns: req.returns, answer: run.answer, scripts: run.scripts.map(x => ({ path: x.path, bytes: x.bytes ?? Buffer.byteLength(x.text ?? ''), source: x.source ?? null, sha256: sha256(x.text ?? ''), text: x.text ?? '' })) };
        agentState.harvests.push({ key, name, cluster: record.cluster, scripts: record.scripts.length, record: workRoot ? null : record });
        result.harvested = record.scripts.length;
        if (workRoot) result.harvestFile = save('harvest', `${key}.json`, record);
      }
      if (result.status === 'ok') {
        const stored = { status: 'ok', output: run.answer, run: { turns: run.turns ?? null, transcriptSha256: run.transcriptSha256 ?? null, scriptCount: run.scripts?.length ?? 0 } };
        memo.set(key, { result: stored, replayed: false });
        journalOut.push({ op: 'agent', key, name, parentPath: scope.path, attempt, filesDigest, instructionsDigest, result: stored });
      }
      return finish(result, { costUsd: spent, costUnknown });
    } catch (error) {
      return finish({ status: 'failed', error: { code: 'HOST_ERROR', message: short(error, 400) } });
    }
  }

  return {
    events, maxDepth, mode,
    // The root scope's model port: pass it to runCompiled as modelPort. budgetUsd is the root's budget (the run's
    // perTaskUsd); with a gateway Ledger (the root session's), carving also respects ledger.remaining() and holds the
    // child's reservation on it while the child runs (unless the gateway already holds it). selfHash: the root solver's
    // library hash, if it has one (recursion).
    port({ budgetUsd = null, ledger: l = ledger, selfHash = null } = {}) {
      const cap = budgetUsd ?? l?.capUsd;
      if (typeof cap !== 'number' || !(cap > 0)) throw new Error('callHost.port: a root budgetUsd (or a ledger with capUsd) is required');
      if (spans.has(ROOT_SPAN)) throw new Error('callHost.port: one root scope per host (one host per task)');
      return wrapPort(newScope({ span: ROOT_SPAN, parent: null, path: ROOT_SPAN, depth: 0, budgetUsd: cap, ancestors: selfHash ? [selfHash] : [], ledger: l }));
    },
    // The root scope's gateway Ledger, once known (run-compiled.mjs creates it per run: onLedger hands it over).
    attachLedger(l) { const root = spans.get(ROOT_SPAN); if (!root) throw new Error('callHost.attachLedger: create the root scope with port() first'); root.ledger = l; },
    // In-process entry (stub mode tests, or a host embedding): one call request from the root scope.
    async request(request) {
      const root = spans.get(ROOT_SPAN);
      if (!root) throw new Error('callHost.request: create the root scope with port() first');
      return (request?.op === 'agent' ? await handleAgent(request, root) : await handle(request, root)).value;
    },
    // Slice 2b: the agent nodes' harvest records ({key, name, cluster, scripts, record?: inline without a workRoot}).
    harvests: () => agentState.harvests.slice(),
    // The span tree with cost per span (FLOW-V3 §1.3: every scope's spend and reservation).
    spans: () => [...spans.values()].map(s => ({ path: s.path, span: s.span, parent: s.parent, depth: s.depth, budgetUsd: s.budgetUsd, spentUsd: usd(s.spentUsd), reservedUsd: usd(s.reservedUsd), calls: s.calls })),
    // Rows a later host takes as `journal` to serve the same calls at $0 (replay by key).
    journalRows: () => journalOut.slice(),
    // Totals for a stream row: call requests, their spend, and how they ended.
    totals() {
      const by = k => events.filter(e => e.kind === k).length;
      // Call requests only (agent nodes are counted under agents, and only when a run had one: a slice 2a row is unchanged).
      const calls = events.filter(e => CALL_EVENT_KINDS.includes(e.kind)), nodes = events.filter(e => e.op === 'agent');
      const out = { childCalls: calls.length, callSpentUsd: usd(calls.filter(e => e.depth === 1).reduce((s, e) => s + (e.spentUsd ?? 0), 0)),
        ends: by('call-end'), refused: by('call-refused'), deopts: by('call-deopt'), interpreted: events.filter(e => e.kind === 'interpret-child' && e.interpreted?.ok).length, warnings: by('profile-warn') };
      if (nodes.length) {
        const of = o => nodes.filter(e => e.outcome === o).length;
        out.agents = { nodes: nodes.length, ok: of('ok'), void: of('void'), failed: of('failed'), refused: of('refused'), spentUsd: usd(nodes.reduce((s, e) => s + (e.spentUsd ?? 0), 0)),
          harvested: agentState.harvests.length, stalls: nodes.reduce((s, e) => s + (e.stalled ?? 0), 0) };
      }
      return out;
    },
    writeEvents(file) { mkdirSync(path.dirname(file), { recursive: true }); for (const e of events) appendFileSync(file, JSON.stringify(e) + '\n'); return events.length; },
  };
}
