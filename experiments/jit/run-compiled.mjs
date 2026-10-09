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
// last one it is served again only with reuse (default: on unless strict). A miss throws REPLAY_MISS when strict (the
// default when there is no live port), else goes to live.call(req) and is counted. Served answers cost $0 and carry
// replayed: true, memo: {digest, index, loose?}. stats(): {requests, hits, looseHits (of hits), reused, misses, live,
// coverage = (hits + reused) / requests or null, journalRows, skippedRows, missed: the first 50 misses}.
export function createMemoPort({ journal, live = null, strict = live == null, policy = live?.policy ?? null, reuse = !strict } = {}) {
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

// status: ok | deopt | crash | timeout | invalid. An environment fault (sandbox could not start, provider rate limit)
// is reported through error.code / meta.errors exactly as the B1 arm does, so the stream can apply ENV_FAULTS.
export async function runCompiled({ solvePath, task, modelPort, perTaskUsd = 1, timeoutMs = 20 * 60 * 1000, workdir, familyId = null, outputSchema = null,
  allowedModels = null, flowPath = DEFAULT_FLOW, label = 'compiled', flowOverride = null, flowOverrideData }) {
  if (!solvePath || !task || !workdir) throw new Error('runCompiled needs solvePath, task and workdir');
  // S0-2 (opt-in): flowOverride is the path of an ESM module whose default export is flow-v2's override(callSite, request)
  // (see flow-v2.mjs); it is copied in as tools/flow-override.mjs, and flowOverrideData (any JSON) as tools/flow-override.json
  // for it to read. flow.mjs (version 1, frozen) has no hook, so an override with it is refused rather than ignored.
  if (flowOverride && (!flowPath || path.resolve(flowPath) === DEFAULT_FLOW)) throw new Error('runCompiled: flowOverride needs flow-v2.mjs (flow.mjs version 1 has no override hook)');
  if (!flowOverride && flowOverrideData !== undefined) throw new Error('runCompiled: flowOverrideData needs flowOverride');
  const schema = outputSchema ?? (familyId ? (await loadFamily(familyId)).outputSchema : null);
  const source = readFileSync(solvePath, 'utf8');
  mkdirSync(path.join(workdir, 'tools'), { recursive: true });
  for (const stale of ['deopt.json', 'trace.jsonl', '.solve.stdout', '.solve.stderr', 'tools/flow-override.mjs', 'tools/flow-override.json']) rmSync(path.join(workdir, stale), { force: true });
  const memoBefore = modelPort?.memo?.stats?.() ?? null;
  const ledger = new Ledger({ capUsd: perTaskUsd, label });
  // A fresh run id per attempt: a retried run (after an environment fault) is never served journaled answers.
  const svc = await startServices({ modelPort, ledger, runId: `${label}:${randomUUID()}`, allowedModels, socketDir: path.join(workdir, 'tools') });
  let r;
  try {
    const files = { 'solve.mjs': source, 'tools/model.mjs': MODEL_TOOL, 'tools/gateway.json': JSON.stringify({ socket: 'gw.sock', token: svc.token }), ...taskFiles(task) };
    if (flowPath && existsSync(flowPath)) files['tools/flow.mjs'] = readFileSync(flowPath, 'utf8');
    if (flowOverride) files['tools/flow-override.mjs'] = readFileSync(flowOverride, 'utf8');
    if (flowOverride && flowOverrideData !== undefined) files['tools/flow-override.json'] = JSON.stringify(flowOverrideData);
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
  return {
    status, output, deopt, trace, flags, costUsd: ledger.spentUsd + unknownUsd, costUnknown: ledger.unknownCalls > 0, imputedUsd: ledger.imputedUsd, latencyMs: r.durationMs, error,
    meta: { exitCode: r.code, calls: ledger.calls, errors: ledger.errors, refusals: ledger.refusals, unknownCalls: ledger.unknownCalls, unknownUpperUsd: ledger.unknownUpperUsd,
      spentUsd: ledger.spentUsd, overshootUsd: Math.max(0, ledger.spentUsd - perTaskUsd), schemaErrors, stderrTail: r.stderr.slice(-400),
      solveSha256: createHash('sha256').update(source).digest('hex'), flow: !!(flowPath && existsSync(flowPath)),
      ...(flowOverride ? { flowOverride: true } : {}), ...(memoBefore ? { memo: memoDelta(memoBefore, modelPort.memo.stats()) } : {}) },
  };
}
// This run's share of a (possibly shared) memo port's counters.
function memoDelta(a, b) {
  const d = Object.fromEntries(['requests', 'hits', 'looseHits', 'reused', 'misses', 'live'].map(k => [k, b[k] - a[k]]));
  return { ...d, coverage: d.requests ? Math.round(((d.hits + d.reused) / d.requests) * 1e4) / 1e4 : null, missed: b.missed.slice(a.missed.length) };
}
