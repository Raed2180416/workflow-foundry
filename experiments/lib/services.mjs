// Host-side services for construction and execution arms (research/construction-20261006/DESIGN.md §2).
// - POST /score   {probe, output}        -> {pass, score}   (probe tasks only, call-limited; oracle stays on the host)
// - POST /model   {model, system, prompt, schema?, decoding?} -> {ok, value, text, error, costUsd}  (policy-enforced, journaled, budgeted)
// - POST /env/<op> {episode, ...}        -> interactive bed env API (create/reset/step/observe/snapshot/restore/actions)
// - GET  /budget                         -> {spentUsd, capUsd, scoreCallsLeft}
// Every request needs the per-session bearer token; the services bind to 127.0.0.1 only.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { score, loadFamily } from './beds.mjs';

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', c => { size += c.length; if (size > 8 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

// A per-session ledger. capUsd bounds everything paid through /model in this session.
export class Ledger {
  constructor({ capUsd, label }) { this.capUsd = capUsd; this.label = label; this.spentUsd = 0; this.imputedUsd = 0; this.calls = 0; this.errors = {}; }
  remaining() { return this.capUsd - this.spentUsd; }
  charge(r) { this.spentUsd += r.costUsd ?? 0; this.imputedUsd += r.imputedUsd ?? 0; this.calls++; if (r.error) this.errors[r.error.code] = (this.errors[r.error.code] ?? 0) + 1; }
}

export async function startServices({ modelPort, ledger, familyId = null, probes = [], scoreLimit = 12, runId = 'gateway', allowedModels = null, log = () => {} }) {
  const token = randomBytes(18).toString('hex');
  let scoreCalls = 0, seq = 0;
  const scoreLog = [];
  const envs = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { error: 'unauthorized' });
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname === '/budget') return json(res, 200, { spentUsd: ledger.spentUsd, capUsd: ledger.capUsd, scoreCallsLeft: scoreLimit - scoreCalls });
      if (req.method !== 'POST') return json(res, 405, { error: 'method' });
      const body = await readBody(req);
      if (url.pathname === '/score') {
        if (!familyId || !probes.length) return json(res, 403, { error: 'no probe oracle in this session' });
        if (scoreCalls >= scoreLimit) return json(res, 429, { error: 'score call limit reached', limit: scoreLimit });
        const i = Number(body.probe);
        if (!Number.isInteger(i) || i < 0 || i >= probes.length) return json(res, 400, { error: `probe must be 0..${probes.length - 1}` });
        scoreCalls++;
        const v = await score(familyId, probes[i], body.output);
        scoreLog.push({ probe: i, pass: !!v.pass, score: v.score ?? null });
        log(`/score probe=${i} -> ${v.pass ? 'pass' : 'fail'} ${v.score}`);
        return json(res, 200, { pass: !!v.pass, score: v.score ?? null, scoreCallsLeft: scoreLimit - scoreCalls });
      }
      if (url.pathname === '/model') {
        if (ledger.remaining() <= 0) return json(res, 402, { error: 'budget exhausted', spentUsd: ledger.spentUsd, capUsd: ledger.capUsd });
        if (allowedModels && !allowedModels.includes(body.model)) return json(res, 403, { error: `model not allowed in this session: ${body.model}` });
        const schema = body.schema ?? { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
        let r;
        try {
          r = await modelPort.call({ runId, nodeKey: `gateway/${body.node ?? 'call'}/${seq++}`, modelId: body.model, system: String(body.system ?? ''), prompt: String(body.prompt ?? ''), schema, decoding: body.decoding ?? {} });
        } catch (error) { return json(res, 400, { ok: false, error: { code: error.code ?? 'MODEL_REQUEST', message: String(error.message).slice(0, 500) } }); }
        ledger.charge(r);
        return json(res, 200, { ok: r.ok, value: r.value ?? null, error: r.error ?? null, costUsd: r.costUsd, modelId: r.modelId, spentUsd: ledger.spentUsd });
      }
      if (url.pathname.startsWith('/env/')) {
        const op = url.pathname.slice(5);
        if (!familyId) return json(res, 403, { error: 'no env in this session' });
        const fam = await loadFamily(familyId);
        if (typeof fam.createEnv !== 'function') return json(res, 400, { error: 'family is not interactive' });
        if (op === 'create') {
          const task = body.taskFile ? body.task : (body.probe != null ? probes[Number(body.probe)] : null);
          if (!task) return json(res, 400, { error: 'create needs probe index' });
          const id = `ep${envs.size + 1}`; envs.set(id, { env: fam.createEnv(task), snapshots: new Map() });
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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, token, scoreLog, close: () => new Promise(r => server.close(r)), get scoreCalls() { return scoreCalls; } };
}
