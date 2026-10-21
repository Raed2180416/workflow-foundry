// Host-side services for construction and execution arms (research/construction-20261006/DESIGN.md §2).
// - POST /score   {probe, output}        -> {pass, score}   (probe tasks only, call-limited; oracle stays on the host)
// - POST /model   {model, system, prompt, schema?, decoding?} -> {ok, value, text, error, costUsd}  (policy-enforced, journaled, budgeted)
//   model 'flow:call' (flow-v3 call requests, experiments/jit/call-host.mjs; FLOW-V3-SLICE2 §3): not subject to
//   allowedModels; the child's reservation (prompt JSON budgetUsd) is held on this session's Ledger while the call runs
//   when it fits strictly below what remains, and the port is told so (gatewayHoldUsd); one that does not fit is passed
//   on unheld, and the call host refuses it with a typed BUDGET_TREE / budget-exceeds-parent refusal. 402 only when the
//   session budget is spent. Every other model id is handled exactly as before.
// - POST /env/<op> {episode, ...}        -> interactive bed env API (create/reset/step/observe/snapshot/restore/actions)
// - GET  /budget                         -> {spentUsd, capUsd, scoreCallsLeft, unknownCalls, unknownUpperUsd}
// Every request needs the per-session bearer token; the services bind to 127.0.0.1 only.
import http from 'node:http';
import path from 'node:path';
import { mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { score, loadFamily } from './beds.mjs';

// The reserved model id of flow-v3 call requests (experiments/jit/call-host.mjs CALL_MODEL).
export const FLOW_CALL_MODEL = 'flow:call';
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', c => { size += c.length; if (size > 8 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

// A per-session ledger. capUsd bounds everything paid through /model in this session. spentUsd is known spend; calls
// whose spend could not be observed (a killed hosted call) add their bound to unknownUpperUsd (null: unbounded).
// A call in flight holds a reservation against the cap (reserveFor), so concurrent calls cannot overshoot it;
// refusals counts requests the gateway turned away (GATEWAY_BUDGET, GATEWAY_MODEL, MODEL_NOT_IN_POLICY, ...).
// A session token cap beside the dollar cap (orch-20261021 E2; the $0-priced model that ran 97M tokens): tokens as the runtime counts
// them (input, output, cache writes, a tenth of cache reads). null = no token cap.
export const DEFAULT_SESSION_TOKENS = 5000000;
export class Ledger {
  constructor({ capUsd, label, tokenCap = DEFAULT_SESSION_TOKENS }) {
    this.capUsd = capUsd; this.label = label; this.tokenCap = tokenCap; this.spentUsd = 0; this.imputedUsd = 0; this.calls = 0; this.errors = {}; this.unknownCalls = 0; this.unknownUpperUsd = 0;
    this.reservedUsd = 0; this.inFlight = 0; this.refusals = {}; this.waiters = [];
  }
  remaining() { return this.capUsd - this.spentUsd - this.reservedUsd; }
  tokensUsed() { const u = this.usage; return u ? Math.ceil(u.inputTokens + u.outputTokens + u.cacheWriteTokens + 0.1 * u.cacheReadTokens) : 0; }
  // The share of prompt tokens read from the prompt cache (cache reads / all prompt tokens), or null before any usage.
  cacheReadShare() {
    const u = this.usage; if (!u) return null;
    const prompt = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
    return prompt ? Math.round((u.cacheReadTokens / prompt) * 1e4) / 1e4 : null;
  }
  refuse(code) { this.refusals[code] = (this.refusals[code] ?? 0) + 1; }
  hold(usd) { this.reservedUsd += usd; this.inFlight++; }
  release(usd) { this.inFlight--; this.reservedUsd = this.inFlight > 0 ? Math.max(0, this.reservedUsd - usd) : 0; this.wake(); }
  wake() { for (const w of this.waiters.splice(0)) w(); }
  changed() { return new Promise(resolve => this.waiters.push(resolve)); }
  async idle() { while (this.inFlight > 0) await this.changed(); }
  charge(r) {
    this.spentUsd += r.costUsd ?? 0; this.imputedUsd += r.imputedUsd ?? 0; this.calls++; if (r.error) this.errors[r.error.code] = (this.errors[r.error.code] ?? 0) + 1;
    // Slice 2b (6b): token usage when the port reports it (ModelPort results carry usage; stub ports do not), so a run's
    // prompt-cache read share is on its ledger. Absent until a call reports usage.
    if (r.usage && typeof r.usage === 'object') {
      const u = (this.usage ??= { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, calls: 0 });
      for (const k of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) u[k] += Number.isFinite(r.usage[k]) ? r.usage[k] : 0;
      u.calls++;
      // 2026-10-21 (research/mercury-20261021/): per model, so a run that mixes a $0 remote model with priced ones shows each one's tokens.
      if (typeof r.modelId === 'string') {
        const m = ((this.usageByModel ??= {})[r.modelId] ??= { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, calls: 0 });
        for (const k of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) m[k] += Number.isFinite(r.usage[k]) ? r.usage[k] : 0;
        m.calls++;
      }
    }
    if (r.costUnknown === true) { this.unknownCalls++; this.unknownUpperUsd = this.unknownUpperUsd === null || typeof r.costUpperUsd !== 'number' ? null : this.unknownUpperUsd + r.costUpperUsd; }
  }
}

// Pre-registered (PREREG-dev §5): while a call is in flight it holds its prompt (system + prompt + schema chars / 3 as
// tokens) x2 at the input price (one-hour cache writes) plus 8000 output tokens at the output price, never more than
// the provider's per-call cap. Observed hosted outputs were 3.5-5.2K tokens per call (2026-10-07 smokes).
export const RESERVE_OUTPUT_TOKENS = 8000;
export function reserveFor(policy, body, perCallCapUsd = 1) {
  const e = policy?.models?.find(m => m.id === body?.model);
  if (!e) return 0;
  const chars = String(body.system ?? '').length + String(body.prompt ?? '').length + (body.schema ? JSON.stringify(body.schema).length : 0);
  return Math.min(perCallCapUsd, ((chars / 3) * 2 * e.price.inputPerMTok + RESERVE_OUTPUT_TOKENS * e.price.outputPerMTok) / 1e6);
}

// A unix socket path must fit in 108 bytes, workdirs often do not: bind through a short-lived short symlink to the
// directory (the socket file itself lands in socketDir), then drop the link.
const LINK_ROOT = '/var/tmp/foundry-work/.sock';
async function listenUnix(server, socketDir) {
  mkdirSync(LINK_ROOT, { recursive: true });
  const link = path.join(LINK_ROOT, randomBytes(6).toString('hex'));
  symlinkSync(path.resolve(socketDir), link);
  try {
    rmSync(path.join(socketDir, 'gw.sock'), { force: true });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path.join(link, 'gw.sock'), () => { server.off('error', reject); resolve(); }); });
  } finally { rmSync(link, { force: true }); }
  return path.join(path.resolve(socketDir), 'gw.sock');
}

// runId defaults to a fresh id per session: the port's crash recovery and default salt key on (runId, nodeKey), and
// nodeKeys restart at 0 each session, so a shared id would serve one session's journaled answers to the next.
// socketDir: serve on <socketDir>/gw.sock instead of loopback TCP (for a client in its own network namespace).
export async function startServices({ modelPort, ledger, familyId = null, probes = [], scoreLimit = 12, runId = `gateway-${randomUUID()}`, allowedModels = null, log = () => {}, socketDir = null }) {
  const token = randomBytes(18).toString('hex');
  let scoreCalls = 0, seq = 0, closing = false;
  const aborter = new AbortController();
  const scoreLog = [];
  const envs = new Map(), created = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { error: 'unauthorized' });
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname === '/budget') return json(res, 200, { spentUsd: ledger.spentUsd, capUsd: ledger.capUsd, reservedUsd: ledger.reservedUsd ?? 0,
        inFlight: ledger.inFlight ?? 0, calls: ledger.calls, scoreCallsLeft: scoreLimit - scoreCalls,
        unknownCalls: ledger.unknownCalls ?? 0, unknownUpperUsd: ledger.unknownUpperUsd === undefined ? 0 : ledger.unknownUpperUsd, refusals: ledger.refusals ?? {} });
      if (req.method !== 'POST') return json(res, 405, { error: 'method' });
      const body = await readBody(req);
      if (url.pathname === '/score') {
        if (!familyId || !probes.length) return json(res, 403, { error: 'no probe oracle in this session' });
        if (scoreCalls >= scoreLimit) return json(res, 429, { error: 'score call limit reached', limit: scoreLimit });
        const i = Number(body.probe);
        if (!Number.isInteger(i) || i < 0 || i >= probes.length) return json(res, 400, { error: `probe must be 0..${probes.length - 1}` });
        scoreCalls++;
        const v = await score(familyId, probes[i], body.output);
        scoreLog.push({ probe: i, pass: !!v.pass, score: v.score ?? null, at: new Date().toISOString() });
        log(`/score probe=${i} -> ${v.pass ? 'pass' : 'fail'} ${v.score}`);
        return json(res, 200, { pass: !!v.pass, score: v.score ?? null, scoreCallsLeft: scoreLimit - scoreCalls });
      }
      if (url.pathname === '/model' && body.model === FLOW_CALL_MODEL) {
        if (!modelPort) { ledger.refuse?.('GATEWAY_NO_MODELS'); return json(res, 403, { error: 'no model access in this session' }); }
        if (closing) { ledger.refuse('GATEWAY_CLOSING'); return json(res, 503, { error: 'session closing' }); }
        if (ledger.spentUsd >= ledger.capUsd - 1e-9) {
          ledger.refuse('GATEWAY_BUDGET'); log('/model flow:call refused: budget spent');
          return json(res, 402, { error: 'budget exhausted', spentUsd: ledger.spentUsd, capUsd: ledger.capUsd });
        }
        let ask = null; try { ask = JSON.parse(String(body.prompt ?? '')); } catch {}
        const want = typeof ask?.budgetUsd === 'number' && Number.isFinite(ask.budgetUsd) && ask.budgetUsd > 0 ? ask.budgetUsd : 0;
        // Strictly below what remains (FLOW-V3 §1.3): Σ reservations in flight + this one < cap − spent.
        const hold = want > 0 && ledger.spentUsd + (ledger.reservedUsd ?? 0) + want < ledger.capUsd - 1e-9 ? want : 0;
        if (hold) ledger.hold(hold);
        let r;
        try {
          r = await modelPort.call({ runId, nodeKey: `gateway/flow-call/${seq++}`, modelId: FLOW_CALL_MODEL, system: String(body.system ?? ''), prompt: String(body.prompt ?? ''),
            schema: body.schema ?? { type: 'object' }, decoding: body.decoding ?? {}, signal: aborter.signal, gatewayHoldUsd: hold });
        } catch (error) {
          ledger.refuse(error.code ?? 'MODEL_REQUEST');
          return json(res, 400, { ok: false, error: { code: error.code ?? 'MODEL_REQUEST', message: String(error.message).slice(0, 500) } });
        } finally { if (hold) ledger.release(hold); }
        ledger.charge(r);
        return json(res, 200, { ok: r.ok, value: r.value ?? null, error: r.error ?? null, costUsd: r.costUsd, modelId: r.modelId, spentUsd: ledger.spentUsd,
          ...(r.costUnknown ? { costUnknown: true, costUpperUsd: r.costUpperUsd ?? null } : {}) });
      }
      if (url.pathname === '/model') {
        if (!modelPort) { ledger.refuse?.('GATEWAY_NO_MODELS'); return json(res, 403, { error: 'no model access in this session' }); }
        if (allowedModels && !allowedModels.includes(body.model)) { ledger.refuse('GATEWAY_MODEL'); log(`/model refused: ${body.model} not allowed`); return json(res, 403, { error: `model not allowed in this session: ${body.model}` }); }
        if (ledger.tokenCap != null && ledger.tokensUsed() >= ledger.tokenCap) {
          ledger.refuse('GATEWAY_TOKENS'); log(`/model refused: token budget (${ledger.tokensUsed()} of ${ledger.tokenCap})`);
          return json(res, 402, { error: 'token budget exhausted', tokensUsed: ledger.tokensUsed(), tokenCap: ledger.tokenCap });
        }
        const schema = body.schema ?? { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
        const entry = modelPort.policy?.models?.find(m => m.id === body.model);
        const reserve = reserveFor(modelPort.policy, { ...body, schema }, modelPort.providers?.[entry?.provider]?.maxBudgetUsd ?? 1);
        // Admit a call only if its reservation fits next to known spend and the calls in flight; else wait for one to settle.
        const fits = () => ledger.spentUsd + ledger.reservedUsd + reserve <= ledger.capUsd + 1e-9;
        while (!fits() && ledger.inFlight > 0 && !closing) await ledger.changed();
        if (closing) { ledger.refuse('GATEWAY_CLOSING'); return json(res, 503, { error: 'session closing' }); }
        if (!fits()) {
          ledger.refuse('GATEWAY_BUDGET'); log(`/model refused: budget (spent ${ledger.spentUsd}, reserve ${reserve}, cap ${ledger.capUsd})`);
          return json(res, 402, { error: 'budget exhausted', spentUsd: ledger.spentUsd, capUsd: ledger.capUsd, reserveUsd: reserve });
        }
        ledger.hold(reserve);
        let r;
        try {
          r = await modelPort.call({ runId, nodeKey: `gateway/${String(body.node ?? 'call').slice(0, 200)}/${seq++}`, modelId: body.model, system: String(body.system ?? ''),
            prompt: String(body.prompt ?? ''), schema, decoding: body.decoding ?? {}, signal: aborter.signal });
        } catch (error) {
          // A cancelled call was journaled with what it consumed: charge it (never a silent $0). Other throws are
          // preconditions (unknown model, bad schema or decoding) that never reached a provider.
          if (error.code === 'CANCELLED') ledger.charge({ ...(error.details ?? {}), error: { code: 'CANCELLED' } }); else ledger.refuse(error.code ?? 'MODEL_REQUEST');
          return json(res, 400, { ok: false, error: { code: error.code ?? 'MODEL_REQUEST', message: String(error.message).slice(0, 500) } });
        } finally { ledger.release(reserve); }
        ledger.charge(r);
        return json(res, 200, { ok: r.ok, value: r.value ?? null, error: r.error ?? null, costUsd: r.costUsd, modelId: r.modelId, spentUsd: ledger.spentUsd,
          ...(r.costUnknown ? { costUnknown: true, costUpperUsd: r.costUpperUsd ?? null } : {}) });
      }
      if (url.pathname.startsWith('/env/')) {
        const op = url.pathname.slice(5);
        if (!familyId) return json(res, 403, { error: 'no env in this session' });
        const fam = await loadFamily(familyId);
        if (typeof fam.createEnv !== 'function') return json(res, 400, { error: 'family is not interactive' });
        if (op === 'create') {
          // Only the session's own tasks: a client-supplied task would give a fresh env (and move budget) at will.
          const task = body.probe != null ? probes[Number(body.probe)] : null;
          if (!task) return json(res, 400, { error: 'create needs probe index' });
          // One episode per task per session: a fresh env would reset the bed's lifetime move budget and
          // allow blind search by repeated creation (gridquest audit F1). Snapshots/restore stay available.
          const key = `probe:${Number(body.probe)}`;
          if (created.has(key)) return json(res, 409, { error: 'an episode already exists for this task; use observe/step/snapshot/restore', episode: created.get(key) });
          const id = `ep${envs.size + 1}`; envs.set(id, { env: fam.createEnv(task), snapshots: new Map() }); created.set(key, id);
          return json(res, 200, { episode: id, observation: envs.get(id).env.observe() });
        }
        const e = envs.get(body.episode);
        if (!e) return json(res, 404, { error: 'unknown episode' });
        if (op === 'reset') return json(res, 200, { observation: e.env.reset() ?? e.env.observe() });
        if (op === 'step') return json(res, 200, e.env.step(body.action));
        if (op === 'observe') return json(res, 200, { observation: e.env.observe() });
        if (op === 'actions') return json(res, 200, { actions: e.env.actions() });
        if (op === 'snapshot') { const sid = `s${e.snapshots.size + 1}`; e.snapshots.set(sid, e.env.snapshot()); return json(res, 200, { snapshot: sid }); }
        if (op === 'restore') { if (!e.snapshots.has(body.snapshot)) return json(res, 404, { error: 'unknown snapshot' }); e.env.restore(e.snapshots.get(body.snapshot)); return json(res, 200, { observation: e.env.observe() }); }
        return json(res, 404, { error: 'unknown env op' });
      }
      return json(res, 404, { error: 'not found' });
    } catch (error) { return json(res, 500, { error: String(error.message ?? error).slice(0, 500) }); }
  });
  let url = null, socket = null;
  if (socketDir) socket = await listenUnix(server, socketDir);
  else { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${server.address().port}`; }
  // Refuse new calls, let in-flight calls finish (grace > the 300 s provider timeout) so the ledger is complete, then
  // cancel the rest (each cancelled call is still charged what its journal row records).
  let closed = null;
  const close = ({ graceMs = 330000 } = {}) => closed ??= (async () => {
    closing = true; ledger.wake?.();
    const t = setTimeout(() => aborter.abort(), graceMs);
    try { if (typeof ledger.idle === 'function') await ledger.idle(); } finally { clearTimeout(t); }
    server.closeAllConnections?.();
    await new Promise(r => server.close(r));
    if (socket) rmSync(socket, { force: true });
  })();
  return { url, socket, token, runId, scoreLog, close, get scoreCalls() { return scoreCalls; } };
}
