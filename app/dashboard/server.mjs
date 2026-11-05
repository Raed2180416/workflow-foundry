// The spike's dashboard server: one loopback page over a real workspace (research/surface-20261021/DESIGN.md §4).
//
// Reads: runs, their hash-chained events and workflow versions are read through tools/run-view/store-adapter.mjs, which opens the
// SQLite store read-only and re-verifies every event's chain link; plain-language explanations come from app/core/explain.mjs.
// Writes: only a person's decisions (turn a version on; allow or refuse one paused action; confirm, edit, waive or accept edits to what
// they asked for), through FoundryApp with channel 'dashboard'.
//
// Boundary: keys made per start and per browser tab, each traded for a one-time code (app/site/gate.mjs: the code, not a key, is what
// reaches the browser opener's command line), a Host check (DNS rebinding) and, on Linux, an OS-account check of the client socket
// (app/site/peer.mjs) keep other pages and other local users out. They do NOT keep out a coding agent that runs as the same OS user with a shell: it can do
// anything the person can do on this machine. DESIGN.md §6 says what closes that gap (a separate OS user, or a second authority).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StoreReader } from '../../tools/run-view/store-adapter.mjs';
import { digest, errorData } from '../../src/data.mjs';
import { explainRun, describeWorkflow, failureText } from '../core/failure-words.mjs';
import { createGate, pageUrl, CODE_WORDS } from '../site/gate.mjs';
import { watchPeers, peerAllowed } from '../site/peer.mjs';
import { liveRoutes } from './live.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/dashboard.js': ['dashboard.js', 'text/javascript; charset=utf-8'], '/dashboard.css': ['dashboard.css', 'text/css; charset=utf-8'] };
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export const SECURITY = { 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'cross-origin-resource-policy': 'same-origin' };
const MAX_BODY = 16 * 1024;

/** Node-level diff of two workflow versions: what a person needs to see before turning a new version on. */
export function diffVersions(before, after) {
  const b = new Map((before?.nodes ?? []).map(n => [n.id, n])), a = new Map(after.nodes.map(n => [n.id, n]));
  const changed = [...a.keys()].filter(k => b.has(k) && digest(a.get(k)) !== digest(b.get(k))).map(k => {
    const fields = [...new Set([...Object.keys(a.get(k)), ...Object.keys(b.get(k))])].filter(f => digest(a.get(k)[f] ?? null) !== digest(b.get(k)[f] ?? null));
    return { id: k, step: a.get(k).description, fields };
  });
  return { added: [...a.keys()].filter(k => !b.has(k)).map(k => ({ id: k, step: a.get(k).description })),
    removed: [...b.keys()].filter(k => !a.has(k)).map(k => ({ id: k, step: b.get(k).description })), changed,
    checksChanged: digest(before?.acceptance ?? null) !== digest(after.acceptance), limitsChanged: digest(before?.budget ?? null) !== digest(after.budget) };
}

export function readStore(file, fn) {
  const reader = StoreReader.open(file);
  try { return reader.snapshot(fn); } finally { reader.close(); }
}

export function runSummaries(file) {
  return readStore(file, r => r.runIds().reverse().slice(0, 200).map(id => {
    const h = r.header(id), chain = r.events(id, { header: h });
    return { runId: id, flowId: h.workflowId, status: h.status, verdict: h.verdict?.verdict ?? null, costUsd: h.cost ?? 0, steps: h.steps ?? 0,
      createdAt: h.createdAt, updatedAt: h.updatedAt, problem: failureText(h.error), chainVerified: chain.ok, events: chain.count };
  }));
}

export function runDetail(app, file, runId) {
  const raw = readStore(file, r => {
    const h = r.header(runId), chain = r.events(runId, { header: h }), wf = r.workflow(h.workflowHash);
    return { header: h, chain, workflow: wf.workflow, workflowNote: wf.reason ?? null, journal: r.hasJournal() };
  });
  // The plain-language view needs node outputs, which the read-only adapter does not expose; FoundryApp reads the same store.
  const view = app.status({ runId });
  const calls = raw.journal ? readStore(file, r => r.db.prepare('SELECT model_id AS modelId, input_tokens AS inputTokens, output_tokens AS outputTokens, cost_usd AS costUsd FROM model_calls WHERE run_id=?').all(runId)) : [];
  return { ...view, chain: { verified: raw.chain.ok, events: raw.chain.count, head: raw.chain.head, reason: raw.chain.reason ?? null },
    // approved and approvalId (UX review M4): an "approval.decided" event is a yes or a no, and the page says which and whose.
    timeline: raw.chain.events.map(e => ({ seq: e.seq, at: e.at, type: e.type, step: e.nodeKey ? (raw.workflow?.nodes.find(n => n.id === String(e.nodeKey).split('/').pop())?.description ?? e.nodeKey) : null,
      ...(e.type === 'approval.decided' ? { approved: e.approved ?? null, approvalId: e.approvalId ?? null } : {}) })),
    modelCalls: { count: calls.length, inputTokens: calls.reduce((s, c) => s + (c.inputTokens ?? 0), 0), outputTokens: calls.reduce((s, c) => s + (c.outputTokens ?? 0), 0),
      costUsd: calls.reduce((s, c) => s + (c.costUsd ?? 0), 0) } };
}

export function flowDetail(app, file, flowId) {
  const versions = readStore(file, r => r.db.prepare('SELECT hash, version FROM workflows WHERE id=? ORDER BY version').all(flowId).map(v => ({ hash: v.hash, version: v.version, workflow: r.workflow(v.hash).workflow })));
  const proposals = app.foundry.store.proposals().filter(p => p.workflow.id === flowId).reverse();
  const all = [...versions.map(v => ({ ...v, state: 'version' })), ...proposals.filter(p => p.status === 'proposed' && !app.ledger.withdrawn(p.id)).map(p => ({ hash: p.workflowHash, version: p.workflow.version, workflow: p.workflow, state: 'draft', proposalId: p.id }))];
  return { flowId, approvals: app.ledger.forFlow(flowId),
    versions: all.map((v, i) => ({ version: v.version, hash: v.hash, state: v.state, proposalId: v.proposalId ?? null, title: v.workflow?.title ?? null,
      active: !!app.ledger.approvedFor(flowId, v.hash), summary: v.workflow ? describeWorkflow(v.workflow, app.registry) : null,
      diffFromPrevious: v.workflow ? diffVersions(all[i - 1]?.workflow ?? null, v.workflow) : null })) };
}

/**
 * The dashboard's API routes (overview, run detail, flow versions, a person's decision, the person's conditions), shared with the onboarding site
 * (app/site/server.mjs mounts it). The caller has already checked the Host header and the token. Returns true when it answered.
 */
export async function handleDashboardApi(app, req, res, url, send) {
  const file = app.storeFile;
  if (req.method === 'GET' && url.pathname === '/api/overview') {
    const listed = app.list();
    send(res, 200, { workspace: app.root, flows: listed.flows, proposals: listed.proposals, inbox: app.inbox(), runs: runSummaries(file),
      mode: { approvers: 'you (single-person mode)', note: 'Flows that need a second approver or a rule owner are the paid Control Plane; not in this preview.' } });
    return true;
  }
  let m;
  if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/runs\/([A-Za-z0-9-]{1,64})$/))) { send(res, 200, runDetail(app, file, m[1])); return true; }
  if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/flows\/([A-Za-z][A-Za-z0-9_-]{0,63})$/))) { send(res, 200, flowDetail(app, file, m[1])); return true; }
  // What the person asked for (the condition tracker, app/core/tracker/): read, and the person's own decisions and edits (channel 'dashboard').
  if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/conditions\/([A-Za-z][A-Za-z0-9_-]{0,63})$/))) { send(res, 200, app.conditions({ flowId: m[1] })); return true; }
  if (req.method === 'POST' && url.pathname === '/api/conditions') {
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) { send(res, 415, { error: 'JSON only' }); return true; }
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) { send(res, 413, { error: 'too large' }); return true; } chunks.push(chunk); }
    const b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const str = v => (typeof v === 'string' ? v : null);
    if (typeof b.flowId !== 'string') { send(res, 400, { error: 'flowId is required' }); return true; }
    // A model has no route to these: the gate's key is the person's page.
    if (['accept', 'reject', 'confirm', 'waive', 'unwaive'].includes(b.action)) {
      send(res, 200, await app.decideCondition({ flowId: b.flowId, action: b.action, proposalId: str(b.proposalId), conditionId: str(b.conditionId), why: str(b.why), workflowHash: str(b.workflowHash), channel: 'dashboard' }));
      return true;
    }
    if (['add', 'change', 'remove'].includes(b.action)) {
      send(res, 200, await app.proposeConditionEdit({ flowId: b.flowId, changes: [{ op: b.action, conditionId: str(b.conditionId), quote: str(b.quote), summary: str(b.summary) }], by: 'person', channel: 'dashboard' }));
      return true;
    }
    if (b.action === 'check') { send(res, 200, await app.checkConditions({ flowId: b.flowId })); return true; }
    send(res, 400, { error: 'action is accept, reject, confirm, waive, unwaive, add, change, remove or check' });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/decide') {
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) { send(res, 415, { error: 'JSON only' }); return true; }
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) { send(res, 413, { error: 'too large' }); return true; } chunks.push(chunk); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!['approve', 'reject'].includes(body.decision)) { send(res, 400, { error: 'decision is approve or reject' }); return true; }
    const yes = body.decision === 'approve';
    if (body.kind === 'activation' && typeof body.approvalId === 'string') { send(res, 200, app.decideActivation(body.approvalId, yes, { channel: 'dashboard', note: typeof body.note === 'string' ? body.note.slice(0, 1000) : null })); return true; }
    if (body.kind === 'action' && typeof body.runId === 'string' && typeof body.approvalId === 'string') { send(res, 200, await app.decideAction(body.runId, body.approvalId, yes, { channel: 'dashboard' })); return true; }
    send(res, 400, { error: 'kind is activation (approvalId) or action (runId, approvalId)' });
    return true;
  }
  return false;
}

/** Create (not start) the dashboard server for one FoundryApp. */
export function createDashboard(app, { token = randomBytes(24).toString('base64url'), workspace = app.root, instance } = {}) {
  const gate = createGate({ workspace, instance, token });
  const live = liveRoutes(app);                       // read-only run data for a visualisation + the human-task routes (live.mjs), behind the gate
  let port = null;
  const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { ...SECURITY, 'content-type': type }); res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };
  const server = watchPeers(createServer(async (req, res) => {
    try {
      if (!peerAllowed(req)) return send(res, 403, { error: 'This Foundry page belongs to another account on this computer.' });
      // DNS-rebinding guard: only the loopback names of this exact port.
      if (!['127.0.0.1', 'localhost'].map(h => `${h}:${port}`).includes(req.headers.host ?? '')) return send(res, 421, { error: 'wrong host' });
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (req.method === 'GET' && STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        return send(res, 200, readFileSync(path.join(here, file)), type);
      }
      if (req.method === 'POST' && url.pathname === '/auth/open') {
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { error: 'JSON only' });
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 1024) return send(res, 413, { error: 'too large' }); chunks.push(chunk); }
        let code = null; try { code = JSON.parse(Buffer.concat(chunks).toString('utf8')).code; } catch { code = null; }
        const opened = gate.open(code);
        return opened.ok ? send(res, 200, { key: opened.key }) : send(res, opened.status, { error: CODE_WORDS[opened.code]?.what ?? 'refused', code: opened.code });
      }
      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      if (!gate.check(String(req.headers['x-foundry-token'] ?? ''))) return send(res, 401, { error: 'This page needs a fresh link: run `node app/cli.mjs start` again in your own terminal.' });
      if (await live(req, res, url, send) !== false) return;
      if (await handleDashboardApi(app, req, res, url, send)) return;
      return send(res, 404, { error: 'not found' });
    } catch (error) {
      return send(res, error.code === 'NOT_FOUND' ? 404 : 409, { error: errorData(error), problem: failureText(errorData(error)) });
    }
  }));
  return {
    server, token, gate, instance: gate.instance,
    async listen(wanted = 0) {
      await new Promise((resolve, reject) => { const fail = e => reject(e); server.once('error', fail); server.listen(wanted, '127.0.0.1', () => { server.off('error', fail); resolve(); }); });
      port = server.address().port;
      return { port, url: `http://127.0.0.1:${port}/` };
    },
    /** The address with a fresh one-time code, for the browser opener or a person's own terminal. */
    openUrl() { if (!port) throw new Error('not listening'); return pageUrl(`http://127.0.0.1:${port}/`, gate.mint()); },
    close: () => new Promise(resolve => { live.close(); server.close(() => resolve()); })
  };
}
