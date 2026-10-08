// Read-only adapter over a Foundry workspace store, for the run-history tools. It never goes through `Store` (opening a Store runs mkdir, chmod and
// CREATE TABLE IF NOT EXISTS on the workspace) and never writes. The event chain, the workflow table and the journal are the stable interfaces; only the
// run HEADER goes through this adapter, because the store rewrite (per-node rows instead of one whole-run JSON blob) changes where the header lives.
//
// Shapes (StoreReader.shape):
//   blob-v1   today's store: runs(id, body) and no per-node table. Header = fields of the JSON body (read with json_extract, no full parse).
//   rows-v2   the per-node-row store (stage-1): a per-node table and/or PRAGMA user_version >= 2 and/or a runs table with a workflow-hash column. The header is read from an
//             index-only JSON body if there is one, else from header columns (snake_case or camelCase), else derived from the events. The names live in ONE
//             mapping table below (NODE_TABLES, HEADER_COLUMNS) so a rename is a one-line change.
//   unknown   anything else (no runs table, an unparsable body). The header is derived from the events and the row says so (headerSource: 'events').
// A shape the adapter cannot place is never fatal and never silent: `notes` says what was assumed, and tests/adapter.test.mjs has a test against the REAL new store
// that fails loudly when its shape is not recognised (it is marked pending until the engine change lands).
import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { digest } from '../../src/data.mjs';

// Candidate names for the per-node table of the stage-1 store (kept in one place; the real name is decided by the engine work).
export const NODE_TABLES = ['run_nodes', 'node_rows', 'nodes', 'run_node_rows', 'node_state', 'run_node'];
// Header field -> candidate column names in a rows-v2 `runs` table.
export const HEADER_COLUMNS = {
  status: ['status'], workflowHash: ['workflow_hash', 'workflowHash'], workflowId: ['workflow_id', 'workflowId'], createdAt: ['created_at', 'createdAt'], updatedAt: ['updated_at', 'updatedAt'],
  cost: ['cost', 'cost_usd'], steps: ['steps'], engineHash: ['engine_hash', 'engineHash'], modelMode: ['model_mode', 'modelMode'], verdict: ['verdict', 'verdict_json'],
  eventSeq: ['event_head_seq', 'head_seq', 'event_seq'], eventHash: ['event_head_hash', 'head_hash', 'event_hash']
};

/** Open a SQLite file without changing the directory. A WAL-mode database opened read-only normally creates empty -wal and -shm files; when no WAL data
 *  exists the file is opened immutable instead (nothing is created). With WAL data present the plain read-only open is used so the newest rows are seen. */
export function openReadOnly(file) {
  const wal = `${file}-wal`;
  let hot = false;
  try { hot = existsSync(wal) && statSync(wal).size > 0; } catch { hot = false; }
  if (hot) return new DatabaseSync(file, { readOnly: true });
  const url = pathToFileURL(file); url.search = 'mode=ro&immutable=1';
  return new DatabaseSync(url.href, { readOnly: true });
}
const parse = text => { try { return text == null ? null : JSON.parse(text); } catch { return null; } };
export const hasTable = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const columnsOf = (db, table) => new Set(db.prepare(`PRAGMA table_info(${table.replace(/[^A-Za-z0-9_]/g, '')})`).all().map(c => c.name));
const pick = (columns, names) => names.find(n => columns.has(n)) ?? null;

export class StoreReader {
  constructor(db, file) {
    this.db = db; this.file = file; this.notes = [];
    this.tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
    this.userVersion = db.prepare('PRAGMA user_version').get().user_version;
    this.runColumns = this.tables.has('runs') ? columnsOf(db, 'runs') : new Set();
    this.nodeTable = NODE_TABLES.find(t => this.tables.has(t)) ?? null;
    this.shape = this.#detect();
  }
  static open(file) { return new StoreReader(openReadOnly(file), file); }
  close() { try { this.db.close(); } catch { /* already closed */ } }

  #detect() {
    if (!this.tables.has('events')) { this.notes.push('no events table'); return 'unknown'; }
    if (!this.tables.has('runs')) { this.notes.push('no runs table: header derived from events'); return 'unknown'; }
    const rows2 = this.nodeTable !== null || this.userVersion >= 2 || pick(this.runColumns, HEADER_COLUMNS.workflowHash) !== null;
    if (rows2) { this.notes.push(`rows-v2 recognised by ${this.nodeTable ? `table ${this.nodeTable}` : this.userVersion >= 2 ? `user_version ${this.userVersion}` : 'extra runs columns'}`); return 'rows-v2'; }
    if (this.runColumns.has('id') && this.runColumns.has('body')) {
      const sample = this.db.prepare('SELECT body FROM runs LIMIT 1').get();
      if (!sample || parse(sample.body)?.workflowHash) return 'blob-v1';
      this.notes.push('runs.body does not look like a run header: header derived from events'); return 'unknown';
    }
    this.notes.push('runs table has an unexpected layout'); return 'unknown';
  }

  /** Everything one run needs, read inside ONE read transaction so the header and the event tail come from the same snapshot
   *  (a run that is still being written would otherwise show an event head newer than its header). */
  snapshot(fn) {
    this.db.exec('BEGIN');
    try { return fn(this); } finally { try { this.db.exec('COMMIT'); } catch { /* read-only: nothing to commit */ } }
  }

  runIds() {
    if (this.tables.has('runs') && this.runColumns.has('id')) return this.db.prepare('SELECT id FROM runs ORDER BY rowid').all().map(r => r.id);
    return this.db.prepare('SELECT DISTINCT run_id AS id FROM events ORDER BY run_id').all().map(r => r.id);
  }

  /** Normalised header: {id, status, workflowHash, workflowId, createdAt, updatedAt, cost, steps, engineHash, modelMode, verdict, eventHead:{seq,hash}, headerSource, shape}. */
  header(id) {
    const base = { id, shape: this.shape };
    if (this.shape === 'blob-v1' || (this.shape === 'rows-v2' && this.runColumns.has('body'))) {
      const row = this.db.prepare(`SELECT json_extract(body,'$.status') AS status, json_extract(body,'$.workflowHash') AS workflowHash, json_extract(body,'$.workflowId') AS workflowId,
        json_extract(body,'$.createdAt') AS createdAt, json_extract(body,'$.updatedAt') AS updatedAt, json_extract(body,'$.cost') AS cost, json_extract(body,'$.steps') AS steps,
        json_extract(body,'$.engineHash') AS engineHash, json_extract(body,'$.modelMode') AS modelMode, json_extract(body,'$.verdict') AS verdict,
        json_extract(body,'$.eventHead.seq') AS seq, json_extract(body,'$.eventHead.hash') AS hash, json_extract(body,'$.error') AS error FROM runs WHERE id=?`).get(id);
      if (row && row.workflowHash) return { ...base, status: row.status, workflowHash: row.workflowHash, workflowId: row.workflowId, createdAt: row.createdAt, updatedAt: row.updatedAt, cost: row.cost, steps: row.steps,
        engineHash: row.engineHash ?? null, modelMode: row.modelMode ?? null, verdict: parse(row.verdict), error: parse(row.error), eventHead: row.seq != null ? { seq: row.seq, hash: row.hash } : null, headerSource: 'blob' };
    }
    if (this.shape === 'rows-v2' && this.runColumns.size) {
      const cols = Object.fromEntries(Object.entries(HEADER_COLUMNS).map(([k, names]) => [k, pick(this.runColumns, names)]));
      if (cols.workflowHash) {
        const select = Object.entries(cols).filter(([, c]) => c).map(([k, c]) => `"${c}" AS "${k}"`).join(', ');
        const idCol = this.runColumns.has('id') ? 'id' : this.runColumns.has('run_id') ? 'run_id' : null;
        const row = idCol ? this.db.prepare(`SELECT ${select} FROM runs WHERE "${idCol}"=?`).get(id) : null;
        if (row) return { ...base, status: row.status ?? null, workflowHash: row.workflowHash, workflowId: row.workflowId ?? null, createdAt: row.createdAt ?? null, updatedAt: row.updatedAt ?? null, cost: row.cost ?? null,
          steps: row.steps ?? null, engineHash: row.engineHash ?? null, modelMode: row.modelMode ?? null, verdict: typeof row.verdict === 'string' && row.verdict.startsWith('{') ? parse(row.verdict) : row.verdict ? { verdict: row.verdict } : null,
          error: null, eventHead: row.eventSeq != null ? { seq: row.eventSeq, hash: row.eventHash ?? null } : null, headerSource: 'columns' };
      }
    }
    return this.#headerFromEvents(base);
  }
  // The event chain is the source of truth: a header can always be derived from it (cost with the same rules as the viewer's reducer).
  #headerFromEvents(base) {
    const rows = this.db.prepare('SELECT body FROM events WHERE run_id=? ORDER BY seq').all(base.id).map(r => parse(r.body)).filter(Boolean);
    const created = rows.find(e => e.type === 'run.created'), last = rows.at(-1);
    const terminal = [...rows].reverse().find(e => /^run\.(succeeded|failed|cancelled|stopped|waiting)/.test(e.type));
    const verdict = [...rows].reverse().find(e => e.type === 'run.verdict');
    let cost = 0, steps = 0; const seen = new Set();
    for (const e of rows) {
      if (e.type === 'node.started' || e.type === 'tool.intent') { steps++; cost += e.reservedCost ?? 0; }
      else if (e.type === 'oracle.dispatched') cost += e.reservedCost ?? 0;
      else if (e.type === 'model.cancelled') cost += e.costUsd ?? 0;
      else if (e.type === 'model.called' || e.type === 'node.recovered_from_journal') { const k = `${e.nodeKey}#${e.journalId}`; if (e.journalId != null && seen.has(k)) continue; seen.add(k); cost += e.costUsd ?? 0; }
    }
    return { ...base, status: terminal ? (terminal.type === 'run.stopped' ? (terminal.error?.code === 'CANCELLED' ? 'cancelled' : 'failed') : terminal.type.slice(4)) : 'running', workflowHash: created?.workflowHash ?? null,
      workflowId: null, createdAt: created?.at ?? null, updatedAt: last?.at ?? null, cost, steps, engineHash: created?.engineHash ?? null, modelMode: created?.modelMode ?? null,
      verdict: verdict ? { verdict: verdict.verdict, code: verdict.code ?? null, authority: verdict.authority ?? null } : null, error: terminal?.error ?? null,
      eventHead: last ? { seq: last.seq, hash: null } : null, headerSource: 'events' };
  }

  /** The hash-chained events of one run, verified exactly as Store.events does (seq, previousHash, digest). With `header`, the head is also compared. */
  events(id, { header = null, afterSeq = 0, previousHash = null } = {}) {
    let previous = previousHash, count = afterSeq;
    const events = [];
    for (const row of this.db.prepare('SELECT body,hash FROM events WHERE run_id=? AND seq>? ORDER BY seq').iterate(id, afterSeq)) {
      const event = JSON.parse(row.body);
      if (event.seq !== count + 1 || event.previousHash !== previous || digest(event) !== row.hash) return { ok: false, events, count, head: previous, reason: `chain breaks at seq ${count + 1}` };
      previous = row.hash; count++; events.push({ ...event, hash: row.hash });
    }
    const head = header?.eventHead;
    // A header whose head is unavailable (events-derived) cannot be compared; a rows-v2 header may carry only the sequence number.
    if (head && (head.seq !== count || (head.hash && head.hash !== previous))) return { ok: false, events, count, head: previous, reason: 'checkpoint head does not match the event chain' };
    return { ok: true, events, count, head: previous };
  }
  firstSeq(id) { return this.db.prepare('SELECT MIN(seq) AS seq FROM events WHERE run_id=?').get(id)?.seq ?? null; }

  /** The immutable workflow version, checked against its hash. {workflow:null, reason} when missing or when the stored body does not match. */
  workflow(hash) {
    if (!hash || !this.tables.has('workflows')) return { workflow: null, reason: 'no workflows table' };
    const row = this.db.prepare('SELECT body, id, version FROM workflows WHERE hash=?').get(hash);
    if (!row) return { workflow: null, reason: 'workflow version missing from this store' };
    const workflow = parse(row.body);
    if (!workflow || digest(workflow) !== hash) return { workflow: null, reason: 'stored workflow does not match its hash' };
    return { workflow };
  }
  decisions(id) { return this.tables.has('decisions') ? this.db.prepare('SELECT body FROM decisions WHERE run_id=? ORDER BY rowid').all(id).map(r => parse(r.body)).filter(Boolean) : []; }

  /** Tests only: the runtime's own per-node status, from the blob checkpoint or the per-node rows, as Map(nodeKey -> status). */
  checkpoint(id) {
    const out = new Map();
    if (this.shape === 'blob-v1') {
      const run = parse(this.db.prepare('SELECT body FROM runs WHERE id=?').get(id)?.body);
      for (const [key, n] of Object.entries(run?.nodes ?? {})) out.set(`root/${key}`, n.status);
      for (const [frame, f] of Object.entries(run?.frames ?? {})) for (const [key, n] of Object.entries(f.nodes ?? {})) out.set(`${frame}/${key}`, n.status);
    } else if (this.nodeTable) {
      const cols = columnsOf(this.db, this.nodeTable), keyCol = pick(cols, ['node_key', 'key']), statusCol = pick(cols, ['status', 'state']), runCol = pick(cols, ['run_id', 'run']);
      if (keyCol && statusCol && runCol) for (const r of this.db.prepare(`SELECT "${keyCol}" AS k, "${statusCol}" AS s FROM ${this.nodeTable} WHERE "${runCol}"=?`).all(id)) out.set(r.k, r.s);
    }
    return out;
  }
  /** Journal rows in the store itself (a Journal may share the store database). */
  hasJournal() { return this.tables.has('model_calls'); }
}
