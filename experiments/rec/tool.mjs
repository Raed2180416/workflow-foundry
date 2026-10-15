// tool.mjs: the `subflow` tool an agent node gets (Z0; research/architecture-20261014/MEMORY-ROUTING-RECURSION.md §3.4):
// tools/subflow.mjs in the node's workdir, with tools/gateway.json. The client posts to the gateway's existing /model route
// with model SUBFLOW_MODEL; the gateway (experiments/lib/services.mjs, unchanged) hands it to its port, which is the subflow
// host's (subflow.mjs port()). The client names no model API host, path or SDK, so the transcript scan for nested model use
// (src/executors/claude-code.mjs nestedModelUses) does not count it (test/tool.test.mjs).
//
//   const ledger = new Ledger({ capUsd: nodeReservationUsd, label });   // the node's reservation
//   const host = createSubflowHost({ modelPort, node, ledger, checkRunner: sandboxCheckRunner() });
//   const svc = await serveSubflow({ host, workdir });                   // gateway + tools/subflow.mjs + tools/gateway.json
//   ... run the agent node in workdir ...
//   await svc.close();
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startServices } from '../lib/services.mjs';
import { SUBFLOW_MODEL } from './subflow.mjs';

export const SUBFLOW_TOOL_FILE = 'tools/subflow.mjs', GATEWAY_FILE = 'tools/gateway.json';
export const SUBFLOW_TOOL = `// tools/subflow.mjs: run a sub-workflow of your own through the host.
//   node tools/subflow.mjs request.json      prints the host's answer (JSON) on stdout
//   import { subflow } from './tools/subflow.mjs'; const answer = await subflow(request);
// request = {
//   name: 'extract-rows',                                   // a label
//   units: [{ id: 'row-1', input: ... }, ...],               // the work list; each unit is one model call (use your task's own unit ids where it has them)
//   worker: { prompt: 'Extract ... from:\\n{{unit}}', system: '...' },   // {{unit}} = the unit's input, {{id}} = its id; optional model
//   returns: { type: 'object', ... },                        // JSON Schema of one unit's answer
//   check: 'check.mjs',                                      // optional: your module, export default (answer, unit) => null (ok) or 'the problem'
//   budgetUsd: 0.2,                                          // optional: at most half of what your node has left (default: that half)
// }
// The call always runs. The host runs it either as an isolated child (its own budget, and your check is tested on a planted
// wrong answer: units are 'verified' only if the check rejects it) or inline (as your own work). The answer:
// {status: 'ok' | 'deopt' | 'refused', executedAs, units: {id: answer}, fallback: [{id, cause}] (units left to you), credit,
// handle, costUsd, ...}. A refusal (budget, depth, count, size, taint) or a deopt carries its reason: carry on without it.
// The sub-task must be smaller than yours (fewer units, or less input). Effects, waits and approvals are never a subflow.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(path.join(here, 'gateway.json'), 'utf8'));
function target() {
  if (!cfg.socket) { const u = new URL(cfg.url); return { host: u.hostname, port: u.port }; }
  const abs = path.join(here, cfg.socket), rel = path.relative(process.cwd(), abs);
  return { socketPath: rel.length < abs.length ? rel : abs };
}
function post(route, payload) {
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request({ ...target(), path: route, method: 'POST', headers: { authorization: 'Bearer ' + cfg.token, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', c => { text += c; });
      res.on('end', () => { let body = {}; try { body = JSON.parse(text); } catch {} resolve({ status: res.statusCode, body }); });
    });
    req.on('error', reject); req.end(data);
  });
}
export async function subflow(request) {
  const { check, ...rest } = request ?? {};
  const checkSource = typeof check === 'string' && check ? readFileSync(path.resolve(check), 'utf8') : undefined;
  const { status, body } = await post('/model', { model: '${SUBFLOW_MODEL}', system: '', prompt: JSON.stringify({ v: 1, ...rest, ...(checkSource !== undefined ? { checkSource } : {}) }) });
  if (status !== 200 || !body.ok) throw new Error('subflow failed: ' + status + ' ' + JSON.stringify(body.error ?? body).slice(0, 400));
  return body.value;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) { console.error('usage: node tools/subflow.mjs request.json'); process.exit(2); }
  console.log(JSON.stringify(await subflow(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 1));
}
`;

/** The gateway session's model allow-list with the subflow route added (null stays null: everything allowed). */
export const withSubflowModel = models => (models == null ? null : [...new Set([...models, SUBFLOW_MODEL])]);

/** Write tools/subflow.mjs and tools/gateway.json ({url, token} or {socket, token}, socket relative to tools/). */
export function installSubflowTool(workdir, { url = null, socket = null, token }) {
  if (!token || (!url && !socket)) throw new Error('installSubflowTool: the gateway url (or socket) and token are required');
  const tools = path.join(workdir, 'tools');
  mkdirSync(tools, { recursive: true });
  writeFileSync(path.join(workdir, SUBFLOW_TOOL_FILE), SUBFLOW_TOOL);
  writeFileSync(path.join(workdir, GATEWAY_FILE), JSON.stringify(socket ? { socket: path.relative(tools, socket), token } : { url, token }));
}

/**
 * The node's gateway with the subflow route: experiments/lib/services.mjs startServices over host.port() and the host's
 * Ledger (the node's reservation), the model allow-list plus SUBFLOW_MODEL, and the tool installed in workdir. socketDir
 * (optional) serves on a unix socket for a node in its own network namespace. Returns the services handle ({url | socket,
 * token, close}).
 */
export async function serveSubflow({ host, workdir, allowedModels = [], socketDir = null, log } = {}) {
  if (!host?.port || !host.ledger) throw new Error('serveSubflow: a subflow host (createSubflowHost) is required');
  const svc = await startServices({ modelPort: host.port(), ledger: host.ledger, allowedModels: withSubflowModel(allowedModels), socketDir, ...(log ? { log } : {}) });
  if (workdir) installSubflowTool(workdir, svc);
  return svc;
}
