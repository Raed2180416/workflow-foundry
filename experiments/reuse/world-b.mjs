// Program B's systems of record, behind the same tool contract as the proven program (research/reuse-20261021/PREREG-C2-1.md
// §1). Program B ("Hazmat Shipment Desk", program-b.mjs) buys from several suppliers; each supplier's product master and
// scoring service is a World here. B's integration layer exposes the four dangerous-goods scoring tools under the SAME names
// and specifications as SOP-Bench's dangerous_goods catalog (so the contract hash matches), and answers them the way the
// upstream tools do (tools.py: look the product up by id, return its stored score; python json.dumps of the result, or
// "Error: <message>"), with the supplier's own ids and stored values. What differs between suppliers is data, not the
// declared contract: id formats, text styles, the scale or direction of the stored scores, extra response fields.
//
// The mailbox server speaks the SOP-Bench bridge protocol (experiments/sopbench/bridge.py serve): a client (the frozen
// workflow's tools/sop.mjs, the agent's tool.mjs, the builder's tools/run-solver.mjs) writes .tools/req-<n>.json =
// {v: 1, calls: [{name, arguments: '<json>', section?}]}, the server answers .tools/res-<n>.json = {results: [{name,
// content}]} or {error}. One request is one step; past maxSteps every request is refused, as in the bridge.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pyDumps } from './lib.mjs';

/** The four dangerous-goods tools: the text field each takes, the result key, and the SOP component it scores. */
export const DG_TOOLS = Object.freeze({
  calculate_sds_label_score: { field: 'sds_label_text', key: 'sds_label_score', comp: 'safety' },
  calculate_handling_score: { field: 'handling_and_storage_guidelines', key: 'handling_score', comp: 'handling' },
  calculate_transportation_score: { field: 'transportation_requirements', key: 'transportation_score', comp: 'transportation' },
  calculate_disposal_score: { field: 'disposal_guidelines', key: 'disposal_score', comp: 'disposal' },
});
export const COMPONENTS = Object.freeze(['safety', 'handling', 'transportation', 'disposal']);
export const TEXT_FIELDS = Object.freeze(Object.values(DG_TOOLS).map(t => t.field));
const MANAGER = 'DangerousGoodsManager';
export const MAX_REQUEST_BYTES = 1_000_000;

/**
 * A supplier world: products keyed by id, each { id, raw: { safety, handling, transportation, disposal } } where a raw
 * value is what the supplier's scoring service has stored (an integer, or null = no value: upstream's int(NaN) raises).
 * response: how the supplier's scoring service answers: { extra (fields appended to every successful response),
 *   valueAs ('string': the score as a string), scoreKey (the score under another key) }; {} = as upstream.
 * allowed: optional Set of product ids this world serves (a builder's build world); others answer "No product found".
 */
export function makeWorld({ name, products, response = null, allowed = null, toolOrder = Object.keys(DG_TOOLS) }) {
  const byId = new Map();
  for (const p of products) {
    if (byId.has(p.id)) throw new Error(`world ${name}: duplicate product ${p.id}`);
    byId.set(p.id, p);
  }
  return { name, byId, response: response ?? {}, allowed: allowed ? new Set(allowed) : null, toolOrder };
}

/** Python's message for a call with missing/unexpected keyword arguments (3.13 wording, checked against the venv). */
function kwargsError(tool, params, required) {
  const unexpected = Object.keys(params).find(k => !required.includes(k));
  if (unexpected !== undefined) return `${MANAGER}.${tool}() got an unexpected keyword argument '${unexpected}'`;
  const missing = required.filter(k => !(k in params));
  if (!missing.length) return null;
  const names = missing.map(m => `'${m}'`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `${MANAGER}.${tool}() missing ${missing.length} required positional argument${missing.length > 1 ? 's' : ''}: ${list}`;
}
const pyFalsy = v => v === undefined || v === null || v === false || v === 0 || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && v && !Array.isArray(v) && !Object.keys(v).length);
const pyStrOf = v => (typeof v === 'string' ? v : v === null ? 'None' : v === true ? 'True' : v === false ? 'False' : typeof v === 'number' ? String(v) : pyDumps(v));

/** One tool call, as the bridge answers it: { name, arguments, ok, content, error? }. */
export function callTool(world, name, argumentsText) {
  const rec = { name };
  let params;
  try { params = typeof argumentsText === 'string' ? JSON.parse(argumentsText) : argumentsText; } catch (e) {
    return { ...rec, error: 'arguments', content: `Error: arguments are not valid JSON (${String(e.message).slice(0, 120)})` };
  }
  if (!params || typeof params !== 'object' || Array.isArray(params)) return { ...rec, error: 'arguments', content: 'Error: arguments must be a JSON object' };
  rec.arguments = params;
  const spec = DG_TOOLS[name];
  if (!spec) return { ...rec, error: 'unknown_tool', content: `Error: Tool '${name}' not found. Available tools: ${world.toolOrder.join(', ')}` };
  const kw = kwargsError(name, params, ['product_id', spec.field]);
  if (kw) return { ...rec, ok: false, error: 'tool', content: `Error: ${kw}` };
  const pid = params.product_id, text = params[spec.field];
  if (pyFalsy(pid) || pyFalsy(text)) return { ...rec, ok: false, error: 'tool', content: `Error: Missing required parameters: product_id or ${spec.field}` };
  const p = typeof pid === 'string' && (!world.allowed || world.allowed.has(pid)) ? world.byId.get(pid) : undefined;
  if (!p) return { ...rec, ok: false, error: 'tool', content: `Error: No product found with ID: ${pyStrOf(pid)}` };
  const v = p.raw[spec.comp];
  if (v === null || v === undefined || !Number.isFinite(v)) return { ...rec, ok: false, error: 'tool', content: 'Error: cannot convert float NaN to integer' };
  const resp = world.response ?? {}, score = Math.trunc(v);
  const out = { product_id: pid, [resp.scoreKey ?? spec.key]: resp.valueAs === 'string' ? String(score) : score, ...(resp.extra ?? {}) };
  return { ...rec, ok: true, content: pyDumps(out) };
}

/**
 * Serve one mailbox for one task: answers every request in number order until stop(). Returns { stop(): Promise<{steps,
 * calls}> , calls } where calls is the host-side log (each call with its step and the section tag the client sent).
 */
export function serveMailbox({ box, world, maxSteps = 40, pollMs = 15 }) {
  mkdirSync(box, { recursive: true });
  const served = new Set(), calls = [];
  let steps = 0, stopped = false, timer = null, busy = false;
  const answer = (n, obj) => {
    const tmp = path.join(box, `.world-res-${n}-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);
    writeFileSync(tmp, JSON.stringify(obj));
    renameSync(tmp, path.join(box, `res-${n}.json`));
  };
  const handle = n => {
    const f = path.join(box, `req-${n}.json`);
    let res;
    try {
      const st = lstatSync(f);
      if (!st.isFile() || st.nlink !== 1) throw new Error('request refused: not a regular file');
      if (st.size > MAX_REQUEST_BYTES) throw new Error(`request larger than ${MAX_REQUEST_BYTES} bytes`);
      const req = JSON.parse(readFileSync(f, 'utf8'));
      const list = req && typeof req === 'object' ? req.calls : null;
      if (!Array.isArray(list) || !list.length || !list.every(c => c && typeof c === 'object')) throw new Error('a request is {"calls": [{"name": ..., "arguments": "<json>"}, ...]}');
      if (steps >= maxSteps) { calls.push({ refused: 'step limit', calls: list.length, t: Date.now() }); res = { error: `step limit reached: this task allows ${maxSteps} tool steps` }; }
      else {
        steps++;
        const out = [];
        for (const c of list) {
          const r = typeof c.name === 'string' ? callTool(world, c.name, c.arguments ?? '{}') : { name: null, error: 'request', content: 'Error: each call is {"name": ..., "arguments": ...}' };
          if (typeof c.section === 'string') r.section = c.section.slice(0, 200);
          r.step = steps; r.t = Date.now();
          calls.push(r);
          out.push({ name: r.name ?? null, content: r.content });
        }
        res = { results: out };
      }
    } catch (e) { res = { error: `${e?.name ?? 'Error'}: ${e?.message ?? e}` }; }
    answer(n, res);
  };
  const tick = () => {
    if (busy) return;
    busy = true;
    try {
      const pending = readdirSync(box).map(x => /^req-(\d+)\.json$/.exec(x)).filter(Boolean).map(m => Number(m[1])).filter(n => !served.has(n)).sort((a, b) => a - b);
      for (const n of pending) {
        if (existsSync(path.join(box, `res-${n}.json`))) { served.add(n); continue; }
        served.add(n);
        handle(n);
      }
    } catch { /* the box may be gone after the run */ }
    busy = false;
  };
  timer = setInterval(tick, pollMs);
  return {
    calls,
    get steps() { return steps; },
    async stop() { if (!stopped) { stopped = true; tick(); clearInterval(timer); } return { steps, calls }; },
  };
}
