// Run a compiled solve.mjs on one task (SPEC §5), sandboxed exactly like the B1 arm: no network, the model gateway's
// unix socket in tools/ as the only way out, a per-task gateway budget, tools/model.mjs (MODEL_TOOL, byte-identical)
// and tools/flow.mjs beside it. Exit 75 means a deopt (deopt.json says why); any other non-zero exit is a crash.
// `invalid` means the output fails the bed's outputSchema (repo validator), never the oracle.
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { runSandboxed } from '../../src/executors/sandboxed-command.mjs';
import { startServices, Ledger } from '../lib/services.mjs';
import { MODEL_TOOL, taskFiles } from '../c0/construct.mjs';
import { loadFamily } from '../lib/beds.mjs';
import { validateOutput } from './interpret.mjs';
import { FoundryError } from '../../src/data.mjs';
import { REPLAYABLE_ERRORS } from '../../src/journal.mjs';

export const DEOPT_EXIT = 75, MAX_TRACE_EVENTS = 5000;
// DEFAULT_FLOW is the version-1 SDK (frozen); a prompt-version-2 arm passes flowPath = FLOW_V2 (stream.mjs, prompts.mjs flowFileOf).
export const DEFAULT_FLOW = path.resolve(new URL('./flow.mjs', import.meta.url).pathname);
export const FLOW_V2 = path.resolve(new URL('./flow-v2.mjs', import.meta.url).pathname);
// flow-v3 (prompt version 5; FLOW-V3.md, design/FLOW-V3-SLICE1.md and SLICE2.md): flow-v2 plus flow.call and flow.phase.
export const FLOW_V3 = path.resolve(new URL('./flow-v3.mjs', import.meta.url).pathname);
export const SCOPE_FILE = 'tools/flow-scope.json';
export const MAX_FLAG_NAMES = 50;   // as flow-v2.mjs caps flagNames on its totals

const parseLines = text => text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
// Uncertainty flags the solver raised (flow.flag, or a judge auto-flag): {count, names}. The totals on the final
// done/deopt/crash event are authoritative (they also count flags past the trace's event cap); without one (a timeout,
// a killed script) the flag events themselves are counted. Pass the whole trace: runCompiled calls it before the cap below
// cuts the trace, since flow.mjs writes its final totals line after MAX_TRACE_EVENTS events. Names are capped at 50.
export function flagsOf(trace) {
  const events = (trace ?? []).filter(e => e?.kind === 'flag');
  const totals = [...(trace ?? [])].reverse().find(e => ['done', 'deopt', 'crash'].includes(e?.kind) && typeof e.flags === 'number');
  const names = [...new Set([...(Array.isArray(totals?.flagNames) ? totals.flagNames : []), ...events.map(e => String(e.name))])].slice(0, MAX_FLAG_NAMES);
  return { count: Math.max(totals?.flags ?? 0, events.length), names };
}
const lastJsonLine = stdout => {
  try { return JSON.parse(stdout.trim().split('\n').filter(Boolean).at(-1) ?? 'null'); } catch { try { return JSON.parse(stdout); } catch { return null; } }
};

// ---- S0-2: replay. A salt-free memo port, and flow-v2's override hook (tools/flow-override.mjs). ----
// canonical JSON exactly as flow-v2.mjs computes it (sorted keys, undefined keys dropped), so the two digests agree.
export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
}
// The salt-free request digest: sha256 of the request as tools/model.mjs posts it to the gateway, which is what the
// gateway hands the port as {modelId, system, prompt, schema, decoding}. No runId, salt, nodeKey or sample index, so an
// identical request in a later run has the same digest. flow-v2.mjs requestDigest(requestOf(...)) is the same function.
export const requestDigestOf = ({ model, modelId, system = '', prompt = '', schema, decoding = {} } = {}) =>
  createHash('sha256').update(canonicalJson({ model: model ?? modelId, system: String(system), prompt: String(prompt), schema, decoding })).digest('hex');

// The fallback key for rows that carry no requestDigest (ModelPort journal rows, as stream.mjs journalToJsonl exports
// them): the model, the prompt and the reasoning level, without maxTokens, which a ModelPort row does not keep (its
// decoding is the provider's effective one, and the claude CLI ignores maxTokens). A different object shape from the
// request digest, so the two keys never collide.
export const looseDigestOf = ({ model, modelId, system = '', prompt = '', schema, decoding = {}, reasoning } = {}) =>
  createHash('sha256').update(canonicalJson({ loose: 1, model: model ?? modelId, system: String(system), prompt: String(prompt), schema, reasoning: reasoning ?? decoding?.reasoning ?? 'none' })).digest('hex');

// A request or response body as exported: the object itself, {sha256, bytes, body}, or {sha256, bytes, path} (a large
// body, in a file beside the journal; null when it is not there).
function bodyOf(b, dir) {
  if (!b || typeof b !== 'object' || typeof b.sha256 !== 'string' || !('body' in b || 'path' in b)) return b ?? null;
  if ('body' in b) return b.body;
  if (!dir) return null;
  try { return JSON.parse(readFileSync(path.join(dir, b.path), 'utf8')); } catch { return null; }
}
// A journal row as the memo serves it: {digest, loose, model, ok, value, error}, or null when it cannot be served.
// Accepted rows: {requestDigest, model, response} (response: the port result {ok, value, error}), served by exact digest;
// and ModelPort journal rows ({modelId, ok, errorCode, decoding, request: {system, prompt, schema}, response: {value,
// error}}, bodies possibly wrapped as above), served by looseDigestOf. Environment faults (rate limit, timeout,
// unavailable, cancelled, budget) never replay; model outcomes (schema, truncation, refusal) do, as in src/journal.mjs.
export function memoRowOf(row, { dir = null } = {}) {
  if (!row || typeof row !== 'object') return null;
  const model = row.model ?? row.modelId ?? null, response = bodyOf(row.response, dir) ?? {}, request = bodyOf(row.request, dir);
  const digest = typeof row.requestDigest === 'string' ? row.requestDigest : null;
  // An exported row's requestDigestLoose (stream.mjs journalToJsonl) serves even when its request body is not at hand.
  const loose = digest ? null : model && request && typeof request.prompt === 'string'
    ? looseDigestOf({ model, system: request.system, prompt: request.prompt, schema: request.schema, reasoning: row.decoding?.reasoning ?? request.decoding?.reasoning })
    : typeof row.requestDigestLoose === 'string' ? row.requestDigestLoose : null;
  if (!digest && !loose) return null;
  // A response body that is in a file that is not there: nothing to serve.
  if (row.response && typeof row.response === 'object' && typeof row.response.sha256 === 'string' && 'path' in row.response && bodyOf(row.response, dir) == null) return null;
  const error = response.error ?? (row.errorCode ? { code: row.errorCode } : null);
  const ok = typeof row.ok === 'boolean' ? row.ok : typeof response.ok === 'boolean' ? response.ok : !error && response.value !== undefined;
  if (!ok && !REPLAYABLE_ERRORS.includes(error?.code)) return null;
  return { digest, loose, model, ok, value: ok ? response.value : undefined, error: ok ? null : error };
}
export function readMemoJournal(source) {
  const rows = Array.isArray(source) ? source : parseLines(readFileSync(source, 'utf8'));
  const dir = Array.isArray(source) ? null : path.dirname(path.resolve(source));
  const byDigest = new Map(), byLoose = new Map();
  let skipped = 0;
  const add = (map, k, m) => { if (!map.has(k)) map.set(k, []); map.get(k).push(m); };
  for (const row of rows) {
    const m = memoRowOf(row, { dir });
    if (!m) { skipped++; continue; }
    if (m.digest) add(byDigest, m.digest, m); else add(byLoose, m.loose, m);
  }
  return { byDigest, byLoose, rows: rows.length, skipped };
}

// createMemoPort({journal, live, strict, policy, reuse}): a model port (the .call(req) the gateway uses) that answers from
// a journal JSONL (or an array of rows) by requestDigestOf(req), else by looseDigestOf(req) for rows without a digest.
// The k-th identical request in this port's life gets the k-th journaled answer for its key (reset() rewinds); past the
// last one it is served again only with reuse (default off, MEM-0 M3: serving the last answer again lets a samples > 1 vote
// come out unanimous from one recorded answer; a caller that wants it passes reuse: true). A miss throws REPLAY_MISS when strict (the
// default when there is no live port), else goes to live.call(req) and is counted. Served answers cost $0 and carry
// replayed: true, memo: {digest, index, loose?}. stats(): {requests, hits, looseHits (of hits), reused, misses, live,
// coverage = (hits + reused) / requests or null, journalRows, skippedRows, missed: the first 50 misses}.
export function createMemoPort({ journal, live = null, strict = live == null, policy = live?.policy ?? null, reuse = false } = {}) {
  if (!strict && !live) throw new Error('createMemoPort: a non-strict memo port needs a live port for its misses');
  const memo = readMemoJournal(journal), cursor = new Map();
  let requests = 0, hits = 0, looseHits = 0, reused = 0, misses = 0, liveCalls = 0;
  const missed = [];
  const stats = () => ({ requests, hits, looseHits, reused, misses, live: liveCalls, coverage: requests ? Math.round(((hits + reused) / requests) * 1e4) / 1e4 : null,
    journalRows: memo.rows, skippedRows: memo.skipped, missed: missed.slice() });
  // The next answer under one key, or null.
  const take = (map, key) => {
    const list = map.get(key), i = cursor.get(key) ?? 0;
    const row = list?.[i] ?? (reuse && list?.length ? list.at(-1) : null);
    if (!row) return null;
    cursor.set(key, i + 1);
    return { row, index: Math.min(i, list.length - 1), fresh: i < list.length };
  };
  return {
    policy, providers: live?.providers ?? {}, policyHash: live?.policyHash ?? null, memo: { stats, strict, reuse },
    reset() { cursor.clear(); },
    async call(req) {
      requests++;
      const digest = requestDigestOf(req), loose = looseDigestOf(req);
      const got = take(memo.byDigest, digest) ?? take(memo.byLoose, loose);
      if (got) {
        if (got.fresh) { hits++; if (!got.row.digest) looseHits++; } else reused++;
        const { row } = got;
        return { ok: row.ok, value: row.ok ? row.value : undefined, ...(row.ok ? {} : { error: row.error }), costUsd: 0, imputedUsd: 0, latencyMs: 0,
          modelId: req.modelId, replayed: true, memo: { digest, index: got.index, ...(row.digest ? {} : { loose: true }) } };
      }
      misses++;
      if (missed.length < 50) missed.push({ digest, model: req.modelId, nodeKey: req.nodeKey ?? null, occurrence: cursor.get(digest) ?? 0 });
      if (strict) throw new FoundryError('REPLAY_MISS', `memo: no journaled answer for ${req.modelId} request ${digest.slice(0, 16)}`, { digest, modelId: req.modelId });
      liveCalls++;
      return live.call(req);
    },
  };
}

// ---- Slice 2a item 1b: run-level resume (PRIOR-ART-MANAGED-AGENTS-DW §3 B). ----
// createResumePort({ prior, live, invalidate }): a model port that records every request of a run in arrival order, keyed by
// (salt-free request digest, occurrence of that digest), and answers from a prior run's rows: a request whose key the
// prior run completed (ok) returns the recorded result at $0; the first request whose key the prior run does not have (its
// prompt differs, or it is new) and every request after it go live (invalidate, default true); a request the prior run
// failed goes live too, and so does everything after it. This sits above the call host's per-call idempotency memo:
// flow:call answers are recorded and served like model answers (memo: 'resume'). Solvers are deterministic given their
// answers (no Date or Math.random in solvers; PRNG only), so a resumed prefix replays the same control flow.
// rows(): this run's rows, the `prior` of the next resume. stats(): {requests, served, live, diverged, divergedAt}.
// Review fix (FLOW-V3-SLICE2 §Review C2/T3): a flow:call answer is a port-level ok whatever happened to the child, so for
// flow:call a row is completed only when the child's answer is: status 'ok' or 'interpreted' (an agent node: 'ok'). A child
// that deopted, crashed (an environment fault included), was refused or failed reruns on resume, and so does everything
// after it. A served flow:call answer is reported to the live port (live.resumed(req, value): the call host logs it), so the
// retried attempt's call log covers the whole run.
export const CALL_DONE_STATUSES = Object.freeze(['ok', 'interpreted']);
const completedOf = (modelId, ok, value) => !!ok && (modelId !== 'flow:call' || CALL_DONE_STATUSES.includes(value?.status));
export function createResumePort({ prior = [], live, invalidate = true } = {}) {
  if (!live || typeof live.call !== 'function') throw new Error('createResumePort: a live port is required');
  const byKey = new Map();
  for (const row of prior ?? []) if (row && typeof row.digest === 'string' && Number.isInteger(row.occurrence)) byKey.set(`${row.digest}#${row.occurrence}`, row);
  const rows = [], seen = new Map();
  let requests = 0, served = 0, liveCalls = 0, diverged = false, divergedAt = null;
  return {
    policy: live.policy ?? null, providers: live.providers ?? {}, policyHash: live.policyHash ?? null, ...(live.memo ? { memo: live.memo } : {}), ...(live.scope ? { scope: live.scope } : {}),
    rows: () => rows.slice(),
    stats: () => ({ requests, served, live: liveCalls, diverged, divergedAt, priorRows: byKey.size }),
    async call(req) {
      const seq = requests++, digest = requestDigestOf(req), occurrence = seen.get(digest) ?? 0;
      seen.set(digest, occurrence + 1);
      const hit = diverged ? null : byKey.get(`${digest}#${occurrence}`) ?? null;
      if (hit && completedOf(req.modelId, hit.ok, hit.value)) {
        served++;
        const call = req.modelId === 'flow:call' && hit.value && typeof hit.value === 'object';
        const value = call ? { ...hit.value, memo: 'resume', spentUsd: 0 } : hit.value;
        rows.push({ seq, digest, occurrence, modelId: req.modelId ?? null, ok: true, value: hit.value, costUsd: hit.costUsd ?? 0, resumed: true });
        if (call && typeof live.resumed === 'function') { try { live.resumed(req, value); } catch {} }
        return { ok: true, value, costUsd: 0, imputedUsd: 0, latencyMs: 0, modelId: req.modelId, replayed: true, resumed: true };
      }
      if (!diverged && invalidate) { diverged = true; divergedAt = { seq, digest: digest.slice(0, 16), modelId: req.modelId ?? null, reason: hit ? 'failed-before' : 'new-request' }; }
      liveCalls++;
      let r;
      try { r = await live.call(req); }
      catch (error) { rows.push({ seq, digest, occurrence, modelId: req.modelId ?? null, ok: false, error: { code: error.code ?? 'MODEL_REQUEST' } }); throw error; }
      const done = completedOf(req.modelId, r?.ok, r?.value);
      rows.push({ seq, digest, occurrence, modelId: req.modelId ?? null, ok: done, ...(r?.ok ? { value: r.value } : { error: r?.error ?? null }), ...(r?.ok && !done ? { portOk: true } : {}), costUsd: r?.costUsd ?? 0 });
      return r;
    },
  };
}

// status: ok | deopt | crash | timeout | invalid. An environment fault (sandbox could not start, provider rate limit)
// is reported through error.code / meta.errors exactly as the B1 arm does, so the stream can apply ENV_FAULTS.
// Slice 2a (opt-in, absent = as before): ledger, a gateway Ledger the caller made (cap perTaskUsd) so a call host can hold
// child reservations on it; flowScope {span, parent, path, depth}, written as tools/flow-scope.json for a child run (a stale
// one is always removed first, so a reused workdir never carries a scope into a top-level run); resume (true or a prior
// run's meta.resume.rows): the run goes through createResumePort and meta.resume = {rows, stats}.
//
// ATTACK-20261014 M1 (opt-in; absent or null = exactly the run above, nothing else is read): variants = { relations, seed,
// compare?, modelPortOf? }. relations are a bed's metamorphic relations (beds/<family>/invariance.mjs, already selected by
// the caller: invariance.mjs selectRelations); seed seeds every variant. After an ok original, each relation's variant of
// the task runs through the same solver, flow, model port (or modelPortOf(relation): replay tools give every variant a
// fresh memo port) and options, in its own workdir `${workdir}-v-<relation id>` with its own gateway Ledger at perTaskUsd,
// and the relation's check compares the two outputs (invariance.mjs runVariants). A disagreement turns the result into
// status 'deopt' with deopt {kind: 'invariance', name: <relation id>, detail: {violations, info}} and output null, as a
// guard would. A variant that does not run ok is recorded, never a disagreement. meta.variants = {ran, relations,
// statuses, violated, costUsd, results, output: the original output}; costUsd includes every variant's spend
// (meta.variants.costUsd is that share). Not combined with ledger, flowScope or resume (library arms and child runs).
// Review fixes (2026-10-14, M1 review):
//   - judges (finding 4): 'replay' (default) records the original run's model answers (recordingPort) and gives each variant
//     a memo port over them with the caller's port live for the misses (createMemoPort, strict false, reuse false): a request
//     the variant repeats unchanged gets the original's answer at $0 and only a changed request is paid. That is what the $0
//     archived replay (eval-invariance.mjs part A) measures, so (i) and (ii) measure one detector. 'fresh' passes the
//     caller's port, so every judge is asked again (order dependence mixed with fresh judge samples). modelPortOf, when
//     given, wins over both.
//   - capUsd (finding 8): the variants of one task share one gateway budget, capUsd (default perTaskUsd); each variant's
//     Ledger is capped at what is left, and a variant with nothing left is not run (status 'budget', never a disagreement).
//     So a sampled task spends at most perTaskUsd + capUsd. meta.variants carries costUnknown (the variants') and
//     originalCostUnknown, so a stream can book each on its own cost line.
//   - observe (finding 9): every relation runs (no stop at the first disagreement) and a disagreement is recorded in
//     meta.variants.violated without withholding the original answer (status stays 'ok').
export const FLOW_CALL_MODEL_ID = 'flow:call';
// A port that passes every call through and records each model answer as a memo journal row {requestDigest, model,
// response}. flow:call answers (child runs) are not recorded. rows() returns the rows so far.
export function recordingPort(port) {
  if (!port || typeof port.call !== 'function') throw new Error('recordingPort: a port with call() is required');
  const rows = [];
  return {
    policy: port.policy ?? null, providers: port.providers ?? {}, policyHash: port.policyHash ?? null, ...(port.memo ? { memo: port.memo } : {}),
    rows: () => rows.slice(),
    async call(req) {
      const r = await port.call(req);
      if (req?.modelId !== FLOW_CALL_MODEL_ID && r && typeof r === 'object') rows.push({ requestDigest: requestDigestOf(req), model: req.modelId, response: { ok: !!r.ok, value: r.value, error: r.error ?? null } });
      return r;
    },
  };
}
export async function runCompiled(args = {}) {
  const { variants = null, ...rest } = args;
  if (variants == null) return runOnce(rest);
  if (!Array.isArray(variants.relations)) throw new Error('runCompiled: variants.relations must be a list of relations (beds/<family>/invariance.mjs)');
  if (rest.ledger != null || rest.flowScope != null || rest.resume) throw new Error('runCompiled: variants are not wired with ledger, flowScope or resume (library arms and child runs)');
  if (variants.modelPortOf != null && typeof variants.modelPortOf !== 'function') throw new Error('runCompiled: variants.modelPortOf must be a function of the relation');
  const judges = variants.judges ?? 'replay';
  if (!['replay', 'fresh'].includes(judges)) throw new Error("runCompiled: variants.judges must be 'replay' or 'fresh'");
  const capUsd = variants.capUsd ?? rest.perTaskUsd ?? 1;
  if (!(typeof capUsd === 'number' && Number.isFinite(capUsd) && capUsd >= 0)) throw new Error('runCompiled: variants.capUsd must be a number >= 0');
  const record = judges === 'replay' && !variants.modelPortOf && rest.modelPort ? recordingPort(rest.modelPort) : null;
  const r = await runOnce(record ? { ...rest, modelPort: record } : rest);
  if (r.status !== 'ok' || !variants.relations.length) return { ...r, meta: { ...r.meta, variants: { skipped: r.status !== 'ok' ? `original ${r.status}` : 'no relations', costUsd: 0 } } };
  const { runVariants, invarianceSummary, INVARIANCE_KIND } = await import('./invariance.mjs');
  const answers = record ? record.rows() : null;
  let left = capUsd;
  const portOf = rel => (variants.modelPortOf ? variants.modelPortOf(rel)
    : record ? createMemoPort({ journal: answers, live: rest.modelPort, strict: false, reuse: false }) : rest.modelPort);
  const v = await runVariants({ relations: variants.relations, task: rest.task, output: r.output, seed: String(variants.seed ?? ''), compare: variants.compare ?? {},
    stopOnViolation: !variants.observe,
    runVariant: async (task, rel) => {
      if (!(left > 1e-9)) return { status: 'budget', output: null, costUsd: 0, costUnknown: false };
      const run = await runOnce({ ...rest, task, perTaskUsd: left, workdir: `${rest.workdir}-v-${rel.id}`, label: `${rest.label ?? 'compiled'}:v:${rel.id}`, modelPort: portOf(rel) });
      left -= run.costUsd ?? 0;
      return run;
    } });
  const results = v.results.map(x => (x === v.violated ? x : (({ variantOutput, ...keep }) => keep)(x)));
  const meta = { ...r.meta, variants: { ...invarianceSummary(v), costUsd: v.costUsd, costUnknown: !!v.costUnknown, originalCostUnknown: !!r.costUnknown, judges, capUsd,
    ...(variants.observe ? { observe: true } : {}), ...(record ? { answersRecorded: answers.length } : {}), results, output: r.output } };
  const cost = { costUsd: r.costUsd + v.costUsd, costUnknown: r.costUnknown || v.costUnknown };
  if (!v.violated || variants.observe) return { ...r, ...cost, meta };
  return { ...r, ...cost, status: 'deopt', output: null, deopt: { kind: INVARIANCE_KIND, name: v.violated.relation, detail: { violations: v.violated.violations.slice(0, 10), info: v.violated.info } }, meta };
}

async function runOnce({ solvePath, task, modelPort, perTaskUsd = 1, timeoutMs = 20 * 60 * 1000, workdir, familyId = null, outputSchema = null,
  allowedModels = null, flowPath = DEFAULT_FLOW, label = 'compiled', flowOverride = null, flowOverrideData, ledger: givenLedger = null, flowScope = null, resume = null }) {
  if (!solvePath || !task || !workdir) throw new Error('runCompiled needs solvePath, task and workdir');
  // S0-2 (opt-in): flowOverride is the path of an ESM module whose default export is flow-v2's override(callSite, request)
  // (see flow-v2.mjs); it is copied in as tools/flow-override.mjs, and flowOverrideData (any JSON) as tools/flow-override.json
  // for it to read. flow.mjs (version 1, frozen) has no hook, so an override with it is refused rather than ignored.
  if (flowOverride && (!flowPath || path.resolve(flowPath) === DEFAULT_FLOW)) throw new Error('runCompiled: flowOverride needs flow-v2.mjs (flow.mjs version 1 has no override hook)');
  if (!flowOverride && flowOverrideData !== undefined) throw new Error('runCompiled: flowOverrideData needs flowOverride');
  const schema = outputSchema ?? (familyId ? (await loadFamily(familyId)).outputSchema : null);
  const source = readFileSync(solvePath, 'utf8');
  mkdirSync(path.join(workdir, 'tools'), { recursive: true });
  for (const stale of ['deopt.json', 'trace.jsonl', '.solve.stdout', '.solve.stderr', 'tools/flow-override.mjs', 'tools/flow-override.json', SCOPE_FILE]) rmSync(path.join(workdir, stale), { force: true });
  if (flowScope != null) {
    if (typeof flowScope !== 'object' || typeof flowScope.span !== 'string' || typeof flowScope.path !== 'string' || !Number.isInteger(flowScope.depth)) throw new Error('runCompiled: flowScope must be {span, parent, path, depth}');
    if (!flowPath || path.resolve(flowPath) !== FLOW_V3) throw new Error('runCompiled: flowScope needs flow-v3.mjs (only flow-v3 reads tools/flow-scope.json)');
  }
  if (givenLedger != null && (typeof givenLedger.remaining !== 'function' || givenLedger.capUsd !== perTaskUsd)) throw new Error('runCompiled: ledger must be a services.mjs Ledger with capUsd = perTaskUsd');
  const memoBefore = modelPort?.memo?.stats?.() ?? null;
  const ledger = givenLedger ?? new Ledger({ capUsd: perTaskUsd, label });
  const port = resume ? createResumePort({ prior: Array.isArray(resume) ? resume : [], live: modelPort }) : modelPort;
  // A fresh run id per attempt: a retried run (after an environment fault) is never served journaled answers.
  const svc = await startServices({ modelPort: port, ledger, runId: `${label}:${randomUUID()}`, allowedModels, socketDir: path.join(workdir, 'tools') });
  let r;
  try {
    const files = { 'solve.mjs': source, 'tools/model.mjs': MODEL_TOOL, 'tools/gateway.json': JSON.stringify({ socket: 'gw.sock', token: svc.token }), ...taskFiles(task) };
    if (flowPath && existsSync(flowPath)) files['tools/flow.mjs'] = readFileSync(flowPath, 'utf8');
    if (flowOverride) files['tools/flow-override.mjs'] = readFileSync(flowOverride, 'utf8');
    if (flowOverride && flowOverrideData !== undefined) files['tools/flow-override.json'] = JSON.stringify(flowOverrideData);
    if (flowScope != null) files[SCOPE_FILE] = JSON.stringify({ span: flowScope.span, parent: flowScope.parent ?? null, path: flowScope.path, depth: flowScope.depth });
    for (const [rel, content] of Object.entries(files)) { mkdirSync(path.dirname(path.join(workdir, rel)), { recursive: true }); writeFileSync(path.join(workdir, rel), content); }
    r = await runSandboxed({ command: 'node', args: ['solve.mjs', 'task.json'], workdir, timeoutMs, network: false });
  } catch (error) {
    // runSandboxed throws only before the script starts (no namespaces): an environment fault, nothing spent.
    r = { code: null, stdout: '', stderr: String(error.message ?? error), timedOut: false, sandboxReady: false, durationMs: 0, thrown: error.code ?? 'SANDBOX_UNAVAILABLE' };
  } finally { await svc.close(); }   // settles in-flight gateway calls, so the ledger read below is complete
  writeFileSync(path.join(workdir, '.solve.stdout'), r.stdout); writeFileSync(path.join(workdir, '.solve.stderr'), r.stderr);
  const fullTrace = existsSync(path.join(workdir, 'trace.jsonl')) ? parseLines(readFileSync(path.join(workdir, 'trace.jsonl'), 'utf8')) : [];
  const trace = fullTrace.slice(0, MAX_TRACE_EVENTS), flags = flagsOf(fullTrace);   // flags before the cut: the totals line is last
  let deopt = null;
  if (existsSync(path.join(workdir, 'deopt.json'))) { try { deopt = JSON.parse(readFileSync(path.join(workdir, 'deopt.json'), 'utf8')); } catch { deopt = { kind: 'unknown', detail: 'deopt.json is not JSON' }; } }
  let status, output = null, error = null, schemaErrors = null;
  if (!r.sandboxReady && !r.timedOut) { status = 'crash'; error = { code: 'SANDBOX_UNAVAILABLE', message: r.stderr.slice(-400) }; }
  else if (r.timedOut) { status = 'timeout'; error = { code: 'SCRIPT_TIMEOUT' }; }
  else if (r.code === DEOPT_EXIT) { status = 'deopt'; deopt ??= { kind: 'unknown', detail: 'exit 75 without deopt.json' }; }
  else if (r.code !== 0) { status = 'crash'; error = { code: 'SCRIPT_ERROR', exitCode: r.code, message: r.stderr.slice(-400) }; }
  else {
    output = lastJsonLine(r.stdout);
    const check = output == null ? { valid: false, errors: ['no JSON on the last stdout line'] } : validateOutput(schema, output);
    if (check.valid) status = 'ok';
    else { status = 'invalid'; schemaErrors = check.errors; error = { code: output == null ? 'SCRIPT_OUTPUT' : 'OUTPUT_SCHEMA', message: (check.errors ?? []).join('; ').slice(0, 400) }; }
  }
  if (status !== 'deopt') deopt = status === 'ok' || status === 'invalid' ? null : deopt;
  // A call whose spend could not be observed is charged at its bound (unbounded: the per-task cap), never $0.
  const unknownUsd = ledger.unknownCalls > 0 ? (ledger.unknownUpperUsd ?? perTaskUsd) : 0;
  // flow-v3: the final totals line counts the run's call requests (absent when it made none, and under flow-v1/v2).
  const totals = [...fullTrace].reverse().find(e => ['done', 'deopt', 'crash'].includes(e?.kind));
  return {
    status, output, deopt, trace, flags, costUsd: ledger.spentUsd + unknownUsd, costUnknown: ledger.unknownCalls > 0, imputedUsd: ledger.imputedUsd, latencyMs: r.durationMs, error,
    meta: { exitCode: r.code, calls: ledger.calls, errors: ledger.errors, refusals: ledger.refusals, unknownCalls: ledger.unknownCalls, unknownUpperUsd: ledger.unknownUpperUsd,
      spentUsd: ledger.spentUsd, overshootUsd: Math.max(0, ledger.spentUsd - perTaskUsd), schemaErrors, stderrTail: r.stderr.slice(-400),
      solveSha256: createHash('sha256').update(source).digest('hex'), flow: !!(flowPath && existsSync(flowPath)),
      ...(flowOverride ? { flowOverride: true } : {}), ...(memoBefore ? { memo: memoDelta(memoBefore, modelPort.memo.stats()) } : {}),
      ...(typeof totals?.childCalls === 'number' ? { childCalls: totals.childCalls } : {}), ...(flowScope ? { flowScope } : {}),
      ...(resume ? { resume: { rows: port.rows(), stats: port.stats() } } : {}),
      // Slice 2b (6b): token usage and the prompt-cache read share, when the port reported usage (absent otherwise).
      ...(ledger.usage ? { usage: { ...ledger.usage, cacheReadShare: ledger.cacheReadShare() } } : {}), ...(ledger.usageByModel ? { usageByModel: ledger.usageByModel } : {}) },
  };
}
// This run's share of a (possibly shared) memo port's counters.
function memoDelta(a, b) {
  const d = Object.fromEntries(['requests', 'hits', 'looseHits', 'reused', 'misses', 'live'].map(k => [k, b[k] - a[k]]));
  return { ...d, coverage: d.requests ? Math.round(((d.hits + d.reused) / d.requests) * 1e4) / 1e4 : null, missed: b.missed.slice(a.missed.length) };
}
