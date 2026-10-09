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
import path from 'node:path';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runCompiled, canonicalJson, FLOW_V2 } from './run-compiled.mjs';
import { validateOutput } from './interpret.mjs';
import { checkProfile, PROFILE_SCHEMA } from './profile.mjs';
import { reserveFor } from '../lib/services.mjs';
import { FoundryError } from '../../src/data.mjs';

export const FLOW_V3 = path.resolve(new URL('./flow-v3.mjs', import.meta.url).pathname);
export const CALL_MODEL = 'flow:call', ROOT_SPAN = 'root', CALL_PROTOCOL = 1;   // as flow-v3.mjs exports them
export const DEFAULT_MAX_DEPTH = 3, HARD_MAX_DEPTH = 8, MAX_TREE_CHILDREN = 1000, DEFAULT_BUDGET_FLOOR_USD = 0.001;
export const REGISTRY_FILE = 'registry.jsonl';
export const REFUSALS = Object.freeze(['bad-request', 'unknown-hash', 'revoked', 'recursion', 'depth', 'tree-size', 'effects', 'input-schema',
  'outside-profile', 'BUDGET_TOO_SMALL', 'budget-exceeds-parent']);

const sha256 = data => createHash('sha256').update(data).digest('hex');
const usd = x => Math.round(x * 1e6) / 1e6;
const short = (v, n = 300) => String(v?.message ?? v).slice(0, n);
// The same digests flow-v3.mjs computes (canonical JSON is run-compiled's canonicalJson, which equals flow-v2's canonical).
export const inputDigestOf = input => sha256(canonicalJson(input));
export const outDigestOf = v => (v === undefined ? null : sha256(canonicalJson(v)).slice(0, 16));
export const callKeyOf = ({ callee, inputDigest, parentPath }) => sha256(canonicalJson({ callee, inputDigest, parentPath }));
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
      const source = typeof e.stub === 'function' ? `stub:${e.stub}` : readFileSync(resolveSolve(e.solvePath));
      const hash = libraryHashOf(source, contract);
      if (e.hash && e.hash !== hash) throw new Error(`registry.register: hash ${e.hash} does not match the solver bytes and contract (${hash})`);
      const entry = { hash, solvePath: e.solvePath ?? null, flowVersion, contract: { input: contract.input ?? null, output: contract.output, taskTemplate: contract.taskTemplate ?? '' },
        profile: e.profile ?? null, evidence: e.evidence ?? {}, effects: e.effects ?? 'none', ...(e.minBudgetUsd != null ? { minBudgetUsd: e.minBudgetUsd } : {}),
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
        evidence: e.evidence, effects: e.effects, revoked: e.revoked }));
    },
  };
}

// ---- reuse classification (W-BED §5, THESIS-JIT §6.7), from a host event plus the oracle, computed after the run ----
// oraclePass: the stage oracle on the child output (for call-end); calleeWouldPass: the callee run offline on the refused
// input (from the event's input / inputFile) and scored (for an outside-profile refusal). Missed reuse that never reached
// the host (a solver re-deriving what the library holds) is not visible here: it is read from the solver's span tree.
export function classifyReuse(event, { oraclePass = null, calleeWouldPass = null } = {}) {
  if (event?.kind === 'call-end') return oraclePass == null ? 'used' : oraclePass ? 'correct' : 'wrong';
  if (event?.kind === 'call-refused' && event.refused === 'outside-profile') return calleeWouldPass == null ? 'refused-profile' : calleeWouldPass ? 'missed' : 'refused-correctly';
  if (event?.kind === 'call-refused') return 'refused-other';
  if (event?.kind === 'call-deopt') return 'deopted';
  return 'unknown';
}

const safe = s => String(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
const dirOf = spanPath => spanPath.split('/').map(safe).join('__').slice(0, 200);
const SPAN_RE = /^call:[^/]{1,200}#\d+$/;

export function createCallHost({ registry, modelPort = null, ledger = null, maxDepth = DEFAULT_MAX_DEPTH, workRoot = null, mode = 'sandbox', allowedModels = null,
  maxChildren = MAX_TREE_CHILDREN, budgetFloorUsd = DEFAULT_BUDGET_FLOOR_USD, maxTimeoutMs = 20 * 60 * 1000, journal = [], arm = null, taskKey = null, log = () => {} } = {}) {
  if (!registry || typeof registry.get !== 'function') throw new Error('createCallHost: a registry (createRegistry) is required');
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > HARD_MAX_DEPTH) throw new Error(`createCallHost: maxDepth must be an integer in 1..${HARD_MAX_DEPTH}`);
  if (!['sandbox', 'stub'].includes(mode)) throw new Error("createCallHost: mode must be 'sandbox' or 'stub'");
  if (mode === 'sandbox' && !workRoot) throw new Error('createCallHost: sandbox mode needs workRoot (child workdirs go under <workRoot>/calls/)');
  const events = [], journalOut = [], spans = new Map(), memo = new Map();
  for (const row of journal ?? []) if (row?.key && row.result?.status === 'ok') memo.set(row.key, { result: row.result, replayed: true });
  const tree = { children: 0 };

  const newScope = ({ span, parent, path: p, depth, budgetUsd, ancestors, ledger: l = null }) => {
    const s = { span, parent, path: p, depth, budgetUsd, spentUsd: 0, reservedUsd: 0, modelReservedUsd: 0, ancestors, ledger: l, ordinals: new Map(), usedSpans: new Set(), calls: 0 };
    spans.set(p, s);
    return s;
  };
  const remainingOf = s => {
    const own = s.budgetUsd - s.spentUsd - s.reservedUsd - s.modelReservedUsd;
    return s.ledger && typeof s.ledger.remaining === 'function' ? Math.min(own, s.ledger.remaining()) : own;
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
          const r = await handle(request, scope);
          return { ok: true, value: r.value, costUsd: r.costUsd, imputedUsd: 0, latencyMs: r.ms, modelId: CALL_MODEL,
            // The child's unknown spend is already in costUsd at its bound: flag it, add nothing more.
            ...(r.costUnknown ? { costUnknown: true, costUpperUsd: 0 } : {}) };
        }
        if (!modelPort) throw new FoundryError('GATEWAY_NO_MODELS', 'no model access in this call host');
        // A child's reservation is held by this host, not by the gateway's ledger: a model call that fits the gateway but
        // not next to the children in flight is refused here (FLOW-V3-SLICE1 §2: the gateway will hold it after R0).
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
      const ctx = { span: child.span, path: child.path, depth: child.depth, budgetUsd: child.budgetUsd, call: request => handle(request, child).then(r => r.value), model: req => childPort.call(req) };
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
    mkdirSync(path.join(workdir, 'tools'), { recursive: true });
    writeFileSync(path.join(workdir, 'tools/flow-scope.json'), JSON.stringify({ span: child.span, parent: child.parent, path: child.path, depth: child.depth }));
    const r = await runCompiled({ solvePath: entry.solvePath, task, modelPort: wrapPort(child), perTaskUsd: child.budgetUsd, timeoutMs, workdir, outputSchema: entry.contract.output,
      allowedModels: withCallModel(allowedModels), flowPath: entry.flowVersion === 2 ? FLOW_V2 : FLOW_V3, label: `call:${entry.hash.slice(7, 19)}` });
    const traceFile = path.join(workdir, 'trace.jsonl');
    return { ...r, childTrace: path.relative(workRoot, traceFile), childTraceSha256: existsSync(traceFile) ? sha256(readFileSync(traceFile)) : null };
  }

  // One call request from `scope`. Returns {value (the answer flow-v3 reads), costUsd, costUnknown, ms}; never throws.
  async function handle(request, scope) {
    const t0 = Date.now(), req = request && typeof request === 'object' ? request : {};
    const name = typeof req.name === 'string' && req.name ? req.name.slice(0, 200) : null, callee = typeof req.callee === 'string' && req.callee ? req.callee : null;
    const childUsd = typeof req.budgetUsd === 'number' && Number.isFinite(req.budgetUsd) ? req.budgetUsd : null;
    const inputDigest = req.input === undefined ? null : inputDigestOf(req.input);
    const key = callee && inputDigest ? callKeyOf({ callee, inputDigest, parentPath: scope.path }) : null;
    let entry = null, span = null, applicability = { checked: false };
    if (name) {
      // The SDK's span id is used when well formed and unused in this scope (it is deterministic: fixed in call order);
      // otherwise the host numbers it.
      span = typeof req.span === 'string' && SPAN_RE.test(req.span) && req.span.startsWith(`call:${name}#`) && !scope.usedSpans.has(req.span) ? req.span : null;
      if (!span) { let k = scope.ordinals.get(name) ?? 0; while (scope.usedSpans.has(`call:${name}#${k}`)) k++; span = `call:${name}#${k}`; scope.ordinals.set(name, k + 1); }
      scope.usedSpans.add(span);
    }
    const childPath = span ? `${scope.path}/${span}` : null, depth = scope.depth + 1;

    const finish = (result, { costUsd = 0, costUnknown = false, child = null } = {}) => {
      const kind = result.status === 'ok' ? 'call-end' : result.status === 'refused' ? 'call-refused' : 'call-deopt';
      const reservedUsd = result.status === 'refused' || result.memo ? 0 : childUsd;
      const value = { status: result.status, ...(result.status === 'ok' ? { output: result.output, outDigest: outDigestOf(result.output) } : {}),
        ...(result.status === 'refused' ? { refused: result.refused, detail: result.detail ?? null } : {}),
        ...(result.status === 'deopt' ? { deopt: result.deopt, childStatus: result.childStatus } : {}),
        key, span, path: childPath, depth, calleeVersion: entry?.version ?? null,
        ...(result.childTrace ? { childTrace: result.childTrace, childTraceSha256: result.childTraceSha256 ?? null } : {}),
        ...(result.memo ? { memo: result.memo } : {}), spentUsd: usd(costUsd), reservedUsd };
      // Inputs and outputs by key (content addressed) under workRoot, or inline without one: the curriculum's oracle pass
      // scores call-end outputs and re-runs refused inputs offline (classifyReuse).
      const inputRef = req.input === undefined ? {} : workRoot ? { inputFile: save('inputs', `${inputDigest}.json`, req.input) } : { input: req.input };
      const outputRef = result.status !== 'ok' ? {} : workRoot ? { outputFile: save('outputs', `${outDigestOf(result.output)}.json`, result.output) } : { output: result.output };
      events.push({ at: new Date().toISOString(), kind, arm, taskKey, key, name, callee, calleeVersion: entry?.version ?? null, calleeEvidence: entry?.evidence ?? null,
        span, parent: scope.span, path: childPath, depth, inputDigest, ...inputRef, budgetUsd: childUsd, outcome: result.status,
        ...(result.status === 'refused' ? { refused: result.refused, refusedDetail: result.detail ?? null } : {}),
        applicability, ...(result.status === 'deopt' ? { deopt: result.deopt, childStatus: result.childStatus } : {}),
        ...(result.status === 'ok' ? { outDigest: value.outDigest, ...outputRef } : {}),
        ...(result.childTrace ? { childTrace: result.childTrace, childTraceSha256: result.childTraceSha256 ?? null } : {}),
        spentUsd: usd(costUsd), reservedUsd, ...(costUnknown ? { costUnknown: true } : {}), memo: result.memo ?? null,
        ...(child ? { childSpent: { model: usd(child.spentUsd), calls: child.calls } } : {}), ms: Date.now() - t0 });
      log(`${kind} ${childPath ?? '(bad request)'} ${result.status === 'refused' ? result.refused : result.status} $${usd(costUsd)}`);
      return { value, costUsd: usd(costUsd), costUnknown, ms: Date.now() - t0 };
    };
    const refuse = (refused, detail = null) => finish({ status: 'refused', refused, detail });

    try {
      if (req.v !== CALL_PROTOCOL || req.op !== 'call' || !name || !callee || req.input === undefined || !(childUsd > 0)) {
        return refuse('bad-request', { expected: `{v: ${CALL_PROTOCOL}, op: 'call', callee, input, name, budgetUsd > 0}` });
      }
      entry = registry.get(callee);
      if (!entry) return refuse('unknown-hash');
      if (entry.revoked) return refuse('revoked', { reason: entry.revokedReason ?? null });
      if (scope.ancestors.includes(callee)) return refuse('recursion', { chain: scope.ancestors });
      if (depth > maxDepth) return refuse('depth', { depth, maxDepth });
      if (tree.children >= maxChildren) return refuse('tree-size', { maxChildren });
      if ((entry.effects ?? 'none') !== 'none') return refuse('effects', { effects: entry.effects });
      const inCheck = validateOutput(entry.contract.input, req.input);
      if (!inCheck.valid) return refuse('input-schema', { errors: inCheck.errors });
      const task = { prompt: entry.contract.taskTemplate ?? '', inputs: req.input };
      if (entry.profile) {
        const p = checkProfile(entry.profile, task);
        applicability = { checked: true, novel: p.novel, score: p.score, n: p.n,
          reasons: p.reasons.slice(0, 5).map(r => ({ feature: r.feature, path: r.path, ratio: r.ratio, ...(r.unseen !== undefined ? { unseen: r.unseen } : {}) })) };
        if (p.novel) return refuse('outside-profile', { score: p.score, reasons: applicability.reasons });
      }
      const hit = memo.get(key);
      if (hit) return finish({ ...hit.result, memo: hit.replayed ? 'replay' : 'repeat' });
      const floor = entry.minBudgetUsd ?? budgetFloorUsd;
      if (childUsd < floor) return refuse('BUDGET_TOO_SMALL', { budgetUsd: childUsd, floorUsd: floor });
      const remaining = remainingOf(scope);
      if (!(childUsd < remaining)) return refuse('budget-exceeds-parent', { budgetUsd: childUsd, remainingUsd: usd(remaining) });

      // Reserve, run, release. The reservation returns to the caller when the child ends; its spend is booked to the caller.
      scope.reservedUsd += childUsd; tree.children++;
      const held = scope.ledger && typeof scope.ledger.hold === 'function';
      if (held) scope.ledger.hold(childUsd);
      const child = newScope({ span, parent: scope.span, path: childPath, depth, budgetUsd: childUsd, ancestors: [...scope.ancestors, callee] });
      const timeoutMs = Math.min(maxTimeoutMs, Number.isInteger(req.timeoutMs) && req.timeoutMs > 0 ? req.timeoutMs : 120000);
      let r;
      try { r = await runChild(entry, task, child, timeoutMs); }
      catch (error) { r = { status: 'crash', error: { code: error.code ?? 'CALL_HOST', message: short(error, 400) }, costUsd: usd(child.spentUsd) }; }
      finally {
        scope.reservedUsd = Math.max(0, scope.reservedUsd - childUsd);
        if (held) scope.ledger.release(childUsd);
      }
      const costUsd = usd(r.costUsd ?? 0);
      scope.spentUsd += costUsd;
      const trace = { childTrace: r.childTrace ?? null, childTraceSha256: r.childTraceSha256 ?? null };
      let result;
      if (r.status === 'ok') {
        result = { status: 'ok', output: r.output, ...trace };
        memo.set(key, { result: { status: 'ok', output: r.output, ...trace }, replayed: false });
        journalOut.push({ key, callee, calleeVersion: entry.version, inputDigest, parentPath: scope.path, result: { status: 'ok', output: r.output, ...trace } });
      } else if (r.status === 'invalid') {
        result = { status: 'deopt', childStatus: 'invalid', deopt: { kind: 'output-schema', name: 'contract.output', detail: { errors: r.meta?.schemaErrors ?? r.error?.message ?? null } }, ...trace };
      } else if (r.status === 'deopt') {
        result = { status: 'deopt', childStatus: 'deopt', deopt: { kind: r.deopt?.kind ?? 'unknown', name: r.deopt?.name ?? null, detail: r.deopt?.detail ?? null }, ...trace };
      } else {
        result = { status: 'deopt', childStatus: r.status, deopt: { kind: r.status === 'timeout' ? 'timeout' : 'crash', name: null, detail: r.error ?? null }, ...trace };
      }
      return finish(result, { costUsd, costUnknown: !!r.costUnknown, child });
    } catch (error) {
      // A host fault before the child ran (a malformed registry entry, a profile that cannot be read): a child deopt.
      return finish({ status: 'deopt', childStatus: 'host-error', deopt: { kind: 'host-error', name: null, detail: short(error, 400) } });
    }
  }

  return {
    events, maxDepth, mode,
    // The root scope's model port: pass it to runCompiled as modelPort. budgetUsd is the root's budget (the run's
    // perTaskUsd); with a gateway Ledger (the root session's), carving also respects ledger.remaining() and holds the
    // child's reservation on it while the child runs. selfHash: the root solver's library hash, if it has one (recursion).
    port({ budgetUsd = null, ledger: l = ledger, selfHash = null } = {}) {
      const cap = budgetUsd ?? l?.capUsd;
      if (typeof cap !== 'number' || !(cap > 0)) throw new Error('callHost.port: a root budgetUsd (or a ledger with capUsd) is required');
      if (spans.has(ROOT_SPAN)) throw new Error('callHost.port: one root scope per host (one host per task)');
      return wrapPort(newScope({ span: ROOT_SPAN, parent: null, path: ROOT_SPAN, depth: 0, budgetUsd: cap, ancestors: selfHash ? [selfHash] : [], ledger: l }));
    },
    // In-process entry (stub mode tests, or a host embedding): one call request from the root scope.
    async request(request) {
      const root = spans.get(ROOT_SPAN);
      if (!root) throw new Error('callHost.request: create the root scope with port() first');
      return (await handle(request, root)).value;
    },
    // The span tree with cost per span (FLOW-V3 §1.3: every scope's spend and reservation).
    spans: () => [...spans.values()].map(s => ({ path: s.path, span: s.span, parent: s.parent, depth: s.depth, budgetUsd: s.budgetUsd, spentUsd: usd(s.spentUsd), reservedUsd: usd(s.reservedUsd), calls: s.calls })),
    // Rows a later host takes as `journal` to serve the same calls at $0 (replay by key).
    journalRows: () => journalOut.slice(),
    writeEvents(file) { mkdirSync(path.dirname(file), { recursive: true }); for (const e of events) appendFileSync(file, JSON.stringify(e) + '\n'); return events.length; },
  };
}
