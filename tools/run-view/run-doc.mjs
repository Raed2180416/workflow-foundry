// Build the per-run document the history page embeds (schema foundry-run-view/1, the same shape tools/run-view/export-run.mjs writes), from an index row.
//   full          a workspace store: header, events and workflow are read in ONE read transaction through the store adapter (works for every store shape),
//                 then folded by export-run.mjs foldRun (chain re-verified, secrets scrubbed, strings clipped with a recorded count and hash)
//   journal-only  model calls from the journal; synthetic events (model.called, a derived dispatch, an escalation INFERRED from a model change within a node key)
//   result-only   no document
// Held-out content rule (AGENTS.md: tests used to improve skills are never held-out evidence): a `test` or `unknown` split run's prompts, replies and outputs are left
// out unless the caller opts in (and every opt-in is written to an inspections ledger); a `sealed` run's content is never included. What remains for such a run is the
// typed structure: ids, codes, numbers, times and the workflow's graph shape.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { StoreReader, openReadOnly, hasTable } from './store-adapter.mjs';
import { foldRun, callOf, makeScrubber, SCHEMA } from './export-run.mjs';
import './history-core.js';

const H = globalThis.HistoryCore;
const KEEP_EVENT = new Set(['seq', 'at', 'type', 'nodeKey', 'frameKey', 'index', 'kind', 'modelId', 'modelClass', 'fromModel', 'toModel', 'fromClass', 'toClass', 'rule', 'errorCode', 'escalation', 'escalations', 'retry', 'sampleIndex', 'attempt',
  'journalId', 'ok', 'latencyMs', 'costUsd', 'costSoFar', 'reservedCost', 'outputHash', 'outputBytes', 'failedItems', 'count', 'verdict', 'code', 'authority', 'engineHash', 'inputHash', 'workflowHash', 'derived', 'derivedFrom', 'inferred', 'synthetic', 'h', 'replayed', 'establishesCompletion']);
const KEEP_NODE = ['id', 'kind', 'needs', 'when', 'maxItems', 'maxIterations', 'concurrency', 'failure', 'onError'];

/** The typed skeleton of a run: no prompt, reply, output, question or error message. */
export function stripContent(doc, reason) {
  const events = doc.events.map(e => { const out = {}; for (const k of KEEP_EVENT) if (e[k] !== undefined) out[k] = e[k]; if (e.error?.code) out.error = { code: e.error.code }; return out; });
  const calls = {};
  for (const [id, c] of Object.entries(doc.calls ?? {})) {
    const { system, prompt, schema, reply, value, error, ...rest } = c;
    calls[id] = { ...rest, error: error?.code ? { code: error.code } : null, prompt: null, system: null, reply: null, value: null };
  }
  const shape = nodes => (nodes ?? []).map(n => ({ ...Object.fromEntries(KEEP_NODE.filter(k => n[k] !== undefined).map(k => [k, n[k]])), ...(n.model?.class ? { model: { class: n.model.class } } : {}), ...(Array.isArray(n.checks) ? { checks: n.checks.map(() => ({})) } : {}), ...(n.body ? { body: { nodes: shape(n.body.nodes) } } : {}) }));
  const workflow = doc.workflow ? { id: doc.workflow.id, version: doc.workflow.version, title: '', nodes: shape(doc.workflow.nodes), acceptance: (doc.workflow.acceptance ?? []).map(p => ({ op: p?.op })), budget: doc.workflow.budget } : null;
  // The run header keeps typed fields only: run.error.message and run.verdict.reason are runtime text that can quote model output (a failed code node's source, a reply).
  const r = doc.run ?? {}, v = r.verdict && typeof r.verdict === 'object' ? r.verdict : null;
  const run = { id: r.id, status: r.status, workflowId: r.workflowId ?? null, workflowHash: r.workflowHash ?? null, createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null, deadline: r.deadline ?? null, steps: r.steps ?? null, cost: r.cost ?? null,
    modelMode: r.modelMode ?? null, resumeCount: r.resumeCount ?? 0, error: r.error?.code ? { code: r.error.code } : null, verdict: v ? { verdict: v.verdict ?? null, code: v.code ?? null, authority: v.authority ?? null, establishesCompletion: v.establishesCompletion === true } : null,
    engineHash: r.engineHash ?? null, eventHead: r.eventHead ?? null, budget: r.budget ?? {}, independentTaskVerified: false, executionActive: false };
  return { ...doc, run, events, calls, outputs: {}, decisions: [], external: [], workflow, contentWithheld: { reason } };
}
const journalRowsFor = (db, ids) => hasTable(db, 'model_calls') ? ids.flatMap(id => db.prepare('SELECT * FROM model_calls WHERE run_id=? ORDER BY id').all(id)) : [];

function journalDoc(row, rows, scrubber, maxPrompt) {
  const calls = {}, events = [], lastModel = new Map();
  rows.sort((a, b) => a.created_at - b.created_at || a.id - b.id);
  rows.forEach((r, i) => {
    calls[r.id] = callOf(r, scrubber, maxPrompt, null);
    const start = r.created_at - (r.latency_ms ?? 0);
    const prev = lastModel.get(r.node_key);
    if (prev && prev !== r.model_id) events.push({ seq: i + 0.25, at: Math.max(0, start - 1), type: 'model.escalated', nodeKey: r.node_key, fromModel: prev, toModel: r.model_id, rule: null, inferred: true });
    lastModel.set(r.node_key, r.model_id);
    events.push({ seq: i + 0.5, at: start, type: 'model.dispatched', nodeKey: r.node_key, modelId: r.model_id, derived: true, derivedFrom: 'journal latency', journalId: r.id, latencyMs: r.latency_ms });
    events.push({ seq: i + 1, at: r.created_at, type: 'model.called', nodeKey: r.node_key, modelId: r.model_id, ok: r.ok === 1, errorCode: r.error_code, costUsd: r.cost_usd, latencyMs: r.latency_ms, journalId: r.id, attempt: r.attempt, sampleIndex: r.sample_index, synthetic: true });
    if (r.ok !== 1) events.push({ seq: i + 1.1, at: r.created_at, type: 'node.failed', nodeKey: r.node_key, error: { code: r.error_code ?? 'ERROR' }, synthetic: true });
  });
  events.sort((a, b) => a.at - b.at || a.seq - b.seq);
  return { schema: SCHEMA, fidelity: 'journal-only', exportedAt: new Date().toISOString(), source: { label: row.key, exporter: 'tools/run-view/run-doc.mjs' },
    run: { id: row.key, status: row.status ?? 'unknown', workflowId: null, workflowHash: null, cost: row.cost?.usd ?? null, verdict: row.verdict ?? null, budget: {} }, workflow: null, events, outputs: {}, calls, decisions: [], external: [],
    integrity: { chainVerified: false, verifiedAt: 'none', events: 0, head: null, journalRows: rows.length, journalOrphans: 0, derivedEvents: rows.length }, truncation: { maxPrompt }, redaction: { enabled: true },
    notice: 'Reconstructed from the model journal. Contains prompts and model replies.' };
}

/** Returns {doc, meta}. doc is null when nothing can be embedded; meta.reason says why in words the page shows. */
export function buildRunDoc(row, { allowHeldout = false, ledgerFile = null, maxPrompt = 6000, maxString = 1200, tool = 'export-history' } = {}) {
  if (row.fidelity === 'result-only') return { doc: null, meta: { reason: 'Result-only trial: one result line is all that was recorded.' } };
  const policy = H.contentPolicy(row);
  const withhold = policy === 'never' ? 'Sealed run: content is never included.' : policy === 'optin' && !allowHeldout ? `Held-out split (${row.split}): prompts, replies and outputs are withheld unless the file is built with --allow-heldout-content.` : null;
  const scrubber = makeScrubber({ redact: true, maxString });
  let doc, meta = { fidelity: row.fidelity };
  if (row.fidelity === 'full') {
    const store = row.sources.find(s => s.kind === 'store'), jsrc = row.sources.find(s => s.kind === 'journal');
    if (!store?.path) return { doc: null, meta: { reason: 'The workspace store is no longer at the path the index recorded.' } };
    // Records move: another lane can delete a workspace between indexing and export. That run then opens as "summary only"; the export goes on.
    let reader;
    try { reader = StoreReader.open(store.path); } catch (error) { return { doc: null, meta: { reason: `The workspace store could not be opened (${error.code ?? 'error'}): it was moved or deleted after the index was built.` } }; }
    let journalDb = null;
    const runId = row.runId ?? row.key;
    try {
      try { journalDb = jsrc?.path && jsrc.path !== store.path ? openReadOnly(jsrc.path) : null; } catch { journalDb = null; }
      const folded = reader.snapshot(() => {
        const header = reader.header(runId), chain = reader.events(runId, { header });
        if (!chain.ok) return { error: `The event chain does not verify (${chain.reason}); not embedded.` };
        const { workflow, reason } = reader.workflow(header.workflowHash);
        if (!workflow) return { error: `The workflow version is unusable (${reason}); not embedded.` };
        const pseudo = { id: runId, status: header.status, workflowId: workflow.id, workflowHash: header.workflowHash, createdAt: header.createdAt, updatedAt: header.updatedAt, deadline: null, steps: header.steps, cost: header.cost, modelMode: header.modelMode,
          assignment: {}, resumeCount: 0, error: header.error ?? null, verdict: header.verdict ?? null, engineHash: header.engineHash, eventHead: { seq: chain.count, hash: chain.head }, policy: {}, owner: null };
        const rows = journalDb ? journalRowsFor(journalDb, [runId]) : null;
        return { doc: foldRun({ db: reader.db, journalDb: journalDb && rows?.length ? journalDb : null, run: pseudo, workflow, results: [], source: { label: row.key, workspace: path.basename(path.dirname(path.dirname(store.path))), exporter: 'tools/run-view/run-doc.mjs' }, scrubber, maxPrompt }) };
      });
      if (folded.error) return { doc: null, meta: { reason: folded.error } };
      doc = folded.doc; doc.fidelity = 'full'; doc.outputs = {};
      doc.source = { label: row.key, exporter: 'tools/run-view/run-doc.mjs' };       // no absolute path leaves the machine
    } finally { try { journalDb?.close(); } catch { /* closed */ } reader.close(); }
  } else {
    const jsrc = row.sources.find(s => s.kind === 'journal');
    if (!jsrc?.path) return { doc: null, meta: { reason: 'The model journal is no longer at the path the index recorded.' } };
    let db;
    try { db = openReadOnly(jsrc.path); } catch (error) { return { doc: null, meta: { reason: `The model journal could not be opened (${error.code ?? 'error'}): it was moved or deleted after the index was built.` } }; }
    try { doc = journalDoc(row, journalRowsFor(db, jsrc.runIds ?? [row.key]), scrubber, maxPrompt); } finally { db.close(); }
    if (!doc.events.length) return { doc: null, meta: { reason: 'No model call is recorded for this run.' } };
  }
  if (withhold) { doc = stripContent(doc, withhold); meta.withheld = true; meta.reason = withhold; }
  else if (policy === 'optin') {                                                    // opted in: write the ledger line a later pre-registration needs to exclude this task
    meta.heldoutContent = true;
    if (ledgerFile) { mkdirSync(path.dirname(path.resolve(ledgerFile)), { recursive: true }); appendFileSync(ledgerFile, `${JSON.stringify({ at: new Date().toISOString(), tool, taskKey: row.taskKey, taskHash: row.taskHash, runKey: row.key, split: row.split, what: 'embedded prompts, replies and outputs' })}\n`); }
  }
  doc.redaction = { ...doc.redaction, secretsScrubbed: scrubber.stats.redactions };
  return { doc, meta };
}
