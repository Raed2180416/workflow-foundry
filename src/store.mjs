import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, realpathSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, clone, digest, FoundryError, checkData } from './data.mjs';
import { AUDIT, journalSeal, sha256, verdictInputsHash } from './audit.mjs';
import { installRunTables, MATERIALIZE, RunRows, rowText, STATE_LIMITS } from './run-rows.mjs';
import { installStateTables, StateStore } from './state.mjs';

const processStart = pid => { try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19]; } catch { return null; } };
function liveJobOwner(job) {
  try { process.kill(job.pid, 0); } catch (error) { return error.code !== 'ESRCH'; }
  const observed = processStart(job.pid);
  return !job.processStart || !observed || observed === job.processStart;
}

const COUNT_EVERY = 64;
const timerRow = row => ({ runId: row.run_id, nodeKey: row.node_key, wakeAt: row.wake_at });

export class Store {
  // The updateRun in progress (its run id and the decisions recorded during it), so a decision commits with its chain event.
  #scope = null;
  #depth = 0;
  #sinceCount = new Map();
  constructor(workspace) {
    mkdirSync(workspace, { recursive: true });
    this.workspace = realpathSync(workspace);
    this.directory = path.join(this.workspace, '.foundry');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (lstatSync(this.directory).isSymbolicLink()) throw new FoundryError('STATE_PATH', '.foundry must not be a symlink');
    for (const file of ['foundry.sqlite', 'foundry.sqlite-wal', 'foundry.sqlite-shm']) {
      const target = path.join(this.directory, file);
      try { if (lstatSync(target).isSymbolicLink()) throw new FoundryError('STATE_PATH', 'SQLite files must not be symlinks'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    this.db = new DatabaseSync(path.join(this.directory, 'foundry.sqlite'));
    chmodSync(path.join(this.directory, 'foundry.sqlite'), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS workflows(hash TEXT PRIMARY KEY, id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL, UNIQUE(id,version));
      CREATE TABLE IF NOT EXISTS heads(id TEXT PRIMARY KEY, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(run_id TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(run_id,seq));
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fixtures(run_id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS effects(key TEXT PRIMARY KEY, run_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS generation_jobs(id TEXT PRIMARY KEY, request_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS qualifications(id TEXT PRIMARY KEY, workflow_hash TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trials(id TEXT PRIMARY KEY, request_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS diagnostic_repairs(run_id TEXT PRIMARY KEY, request_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS decisions_run ON decisions(run_id);
      CREATE TABLE IF NOT EXISTS timers(run_id TEXT NOT NULL, node_key TEXT NOT NULL, wake_at INTEGER NOT NULL, PRIMARY KEY(run_id,node_key));
      CREATE INDEX IF NOT EXISTS timers_due ON timers(wake_at);
      CREATE TABLE IF NOT EXISTS run_children(run_id TEXT NOT NULL, pid INTEGER NOT NULL, pgid INTEGER NOT NULL, start TEXT, kind TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(run_id,pid));
      CREATE TABLE IF NOT EXISTS signals(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, digest TEXT NOT NULL, at INTEGER NOT NULL);
    `);
    // Run state is per-node rows (src/run-rows.mjs). `limits` are the state bounds; an instance may lower them (tests do).
    installRunTables(this.db);
    this.limits = { ...STATE_LIMITS }; this.rows = new RunRows(this);
    // Cross-run keyed state of the workflows in this workspace and its operation journal (src/state.mjs).
    installStateTables(this.db); this.state = new StateStore(this);
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE'); this.#depth++;
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally { this.#depth--; }
  }
  #workflow(hash) {
    const row = this.db.prepare('SELECT body FROM workflows WHERE hash=?').get(hash);
    if (!row) throw new FoundryError('NOT_FOUND', 'Workflow version not found');
    return JSON.parse(row.body);
  }
  workflow(idOrHash) {
    // Immutable addressing wins over any legacy head that used a digest-shaped
    // id. New public workflows reject that ambiguous namespace entirely.
    const immutable = /^[0-9a-f]{64}$/.test(idOrHash ?? '') && this.db.prepare('SELECT hash FROM workflows WHERE hash=?').get(idOrHash);
    const head = immutable ? null : this.db.prepare('SELECT hash FROM heads WHERE id=?').get(idOrHash);
    const hash = head?.hash ?? idOrHash;
    const workflow = this.#workflow(hash);
    if (digest(workflow) !== hash) throw new FoundryError('CORRUPT_WORKFLOW', 'Stored workflow hash does not match its content');
    return { hash, workflow };
  }
  workflows() {
    return this.db.prepare('SELECT h.id,h.hash,w.version,w.body FROM heads h JOIN workflows w ON h.hash=w.hash ORDER BY w.created DESC').all().map(row => ({
      id: row.id, hash: row.hash, version: row.version, title: JSON.parse(row.body).title, workflow: JSON.parse(row.body)
    }));
  }
  saveWorkflow(workflow, { expectedHash = null } = {}) {
    return this.transaction(() => this.#saveWorkflow(workflow, expectedHash));
  }
  #saveWorkflow(workflow, expectedHash) {
    checkData(workflow); const hash = digest(workflow);
    const current = this.db.prepare('SELECT hash FROM heads WHERE id=?').get(workflow.id)?.hash ?? null;
    if (current === hash) return { hash, workflow: clone(workflow), unchanged: true };
    if (current !== expectedHash) throw new FoundryError('STALE_WORKFLOW', 'Current workflow differs from the expected base', { expectedHash, currentHash: current });
    if (current && workflow.version !== this.#workflow(current).version + 1) throw new FoundryError('VERSION_CONFLICT', 'Workflow version must increment by exactly one');
    if (!current && workflow.version !== 1) throw new FoundryError('VERSION_CONFLICT', 'The first workflow version must be 1');
    this.db.prepare('INSERT INTO workflows VALUES(?,?,?,?,?)').run(hash, workflow.id, workflow.version, canonical(workflow), new Date().toISOString());
    this.db.prepare('INSERT INTO heads VALUES(?,?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash').run(workflow.id, hash);
    return { hash, workflow: clone(workflow), unchanged: false };
  }
  stageEvaluationWorkflow(workflow) {
    // Host-only staging preserves the exact candidate hash/version in an isolated
    // evaluation store. It does not advance a reusable workflow head.
    checkData(workflow); const hash = digest(workflow);
    this.db.prepare('INSERT OR IGNORE INTO workflows VALUES(?,?,?,?,?)').run(hash, workflow.id, workflow.version, canonical(workflow), new Date().toISOString());
    const saved = this.workflow(hash);
    if (saved.hash !== hash) throw new FoundryError('EVALUATION_STAGE', 'Candidate staging did not preserve its exact identity');
    return saved;
  }
  // `binding` holds runtime-owned model/identity fields (DESIGN §5.1, §6); its hashes enter the birth event.
  // `journal` says where the run's model journal lives ('workspace': this database; 'external': another one), so a verifier knows what to look for.
  createRun(workflowHash, input, registryHash, policy, { fixture = null, extra = {}, engineHash = null, id = randomUUID(), binding = null, journal = null } = {}) {
    checkData(input); checkData(policy); const { workflow } = this.workflow(workflowHash);
    if (binding && (checkData(binding), Object.keys(binding).some(key => !['modelPolicyHash', 'modelMode', 'sampleSalt', 'assignment', 'assignmentHash', 'identity'].includes(key)))) throw new FoundryError('RUN_BINDING', 'Unsupported run binding field');
    const now = Date.now();
    const run = {
      id, workflowHash, workflowId: workflow.id, registryHash, engineHash, input: clone(input),
      policy: clone(policy), createdAt: now, updatedAt: now,
      deadline: now + Math.min(workflow.budget.maxDurationMs, policy.maxDurationMs),
      status: 'ready', steps: 0, cost: 0, nodes: {}, outputs: {}, frames: {},
      approvals: {}, error: null, extra: clone(extra), ...(binding ? clone(binding) : {})
    };
    const bound = binding ? { modelPolicyHash: binding.modelPolicyHash ?? null, modelMode: binding.modelMode ?? null, sampleSalt: binding.sampleSalt ?? null,
      assignmentHash: binding.assignmentHash ?? null, identityHash: binding.identity ? digest(binding.identity) : null } : {};
    this.transaction(() => {
      this.rows.insert(run);
      if (fixture) this.db.prepare('INSERT INTO fixtures VALUES(?,?)').run(id, canonical({ ...fixture, actions: [], wrongActions: 0 }));
      const event = this.#event(id, { type: 'run.created', audit: AUDIT, ...(journal ? { journal } : {}), workflowHash, registryHash, engineHash, inputHash: digest(input), policyHash: digest(policy), ...bound });
      run.eventHead = { seq: event.seq, hash: event.hash };
      this.rows.setHeader(run);
    });
    return run;
  }
  /** The cancel request recorded in a run's header (Runtime.requestCancel), or null. A point read of the one field, cheap enough to poll. */
  cancelRequest(id) {
    const row = this.rows.stmt("SELECT json_extract(body,'$.cancelRequest') AS request FROM runs WHERE id=?").get(id);
    return row?.request ? JSON.parse(row.request) : null;
  }
  // The process groups a run has started and that have not ended (src/children.mjs): recorded as they start, forgotten as they end, so the ones a
  // dead owner left behind can be found.
  recordChild(runId, { pid, pgid, start = null, kind }) { this.rows.stmt('INSERT OR REPLACE INTO run_children(run_id,pid,pgid,start,kind,at) VALUES(?,?,?,?,?,?)').run(runId, pid, pgid, start, kind, Date.now()); }
  forgetChild(runId, pid) { this.rows.stmt('DELETE FROM run_children WHERE run_id=? AND pid=?').run(runId, pid); }
  forgetChildren(runId) { this.rows.stmt('DELETE FROM run_children WHERE run_id=?').run(runId); }
  children(runId) { return this.rows.stmt('SELECT pid,pgid,start,kind,at FROM run_children WHERE run_id=? ORDER BY at,pid').all(runId).map(row => ({ ...row })); }
  /** The ids of runs that have recorded process groups still on file. */
  childRunIds() { return this.rows.stmt('SELECT DISTINCT run_id FROM run_children ORDER BY run_id').all().map(row => row.run_id); }
  /** The ids of every run that has not reached a final status (succeeded, failed, cancelled), oldest first: what is running, parked or uncertain. */
  openRunIds() {
    return this.rows.stmt("SELECT id FROM runs WHERE json_extract(body,'$.status') NOT IN ('succeeded','failed','cancelled') ORDER BY rowid").all().map(row => row.id);
  }
  /** The whole run record: header, input, nodes, outputs and frames. Reads every row of the run; the runtime's hot path uses `store.rows` instead. */
  run(id) { return this.rows.run(id); }
  runs() { return this.db.prepare('SELECT id FROM runs ORDER BY rowid DESC LIMIT 100').all().map(r => this.rows.run(r.id)); }
  /** Split every run record written by the whole-run store into rows (they are also split by the first write to them). */
  migrateRuns() { return this.rows.migrateAll(); }
  /**
   * Compare-and-swap update of one run: `mutate(run)` sees the run through lazily loaded rows (it reads and writes `run.nodes[id]`, `run.frames[key]`,
   * `run.outputs[id]` and the header fields as before), and only the rows it changed are written, with the events, in one transaction. The chain
   * head, every row's revision and the run's byte bound are checked first. `event` is an event, a function of the run returning events, or a list.
   * Returns the run record afterwards; `{ result: 'header' }` returns only its own fields (the hot path never needs the rest). `final`: a
   * terminal update (the verdict seal or failure receipt), which may use the headroom kept below the absolute whole-run bounds (run-rows.mjs).
   */
  updateRun(id, mutate, event, { result = 'run', final = false } = {}) {
    return this.transaction(() => {
      const session = this.rows.open(id), run = session.draft;
      const tail = this.#tail(id);
      // The tail must be the head the checkpoint names, on every update. That the chain below it has no hole (as many events as the head's
      // sequence number) is a scan of the run's events, so it is made on a Store's first update of a run and then every COUNT_EVERY updates
      // (resume and verify-run check the whole chain regardless); doing it on every event made each one cost in proportion to the run.
      const since = this.#sinceCount.get(id), full = since === undefined || since >= COUNT_EVERY;
      const count = full ? this.rows.stmt('SELECT COUNT(*) AS count FROM events WHERE run_id=?').get(id).count : run.eventHead?.seq;
      if (!run.eventHead || tail?.seq !== run.eventHead.seq || tail?.hash !== run.eventHead.hash || count !== run.eventHead.seq) throw new FoundryError('CORRUPT_EVENTS', 'Refusing to append over missing or truncated checkpoint evidence');
      this.#sinceCount.delete(id); this.#sinceCount.set(id, full ? 0 : since + 1);
      if (this.#sinceCount.size > 256) this.#sinceCount.delete(this.#sinceCount.keys().next().value);
      const scope = this.#scope = { runId: id, decisions: [] };
      let items;
      try {
        mutate(run); run.updatedAt = Date.now();
        items = [event].flat().flatMap(e => typeof e === 'function' ? [e(run)].flat() : [e]).filter(Boolean);
      } finally { this.#scope = null; }
      // Audit binding (src/audit.mjs): a decision recorded in this update gets its chain event ahead of the update's own events, and a verdict
      // event that the writer did not seal itself (the runtime does, against its own journal) is sealed here against this database's journal.
      let previous = tail;
      for (const item of [...scope.decisions, ...items.map(item => item.type === 'run.verdict' && item.journalRoot === undefined ? { ...item, ...this.sealBinding(id, run) } : item)]) {
        previous = this.#event(id, item, previous);
        run.eventHead = { seq: previous.seq, hash: previous.hash };
      }
      const header = session.flush({ final });
      if (result === 'header') return header;
      // A run still held as a whole-run record was split by open(); either way the result is the record after the update, in the key order
      // the whole-run store returned (session.record()).
      return session.record();
    });
  }
  /** The seal a `run.verdict` event carries: the Merkle root of the run's journal rows (in `journalDb`, default this database) and the hash of
   *  the state the verdict was computed from. */
  sealBinding(id, run, journalDb = this.db) {
    const seal = journalSeal(journalDb, id);
    return { journalRoot: seal.root, journalCalls: seal.calls, journalMaxId: seal.maxId, boardRoot: null, verdictInputsHash: verdictInputsHash(run[MATERIALIZE]?.() ?? run) };
  }
  #tail(id) { return this.rows.stmt('SELECT seq,hash FROM events WHERE run_id=? ORDER BY seq DESC LIMIT 1').get(id); }
  // Append one event to the chain after `prev` (default: the stored tail). The hash is the digest() of the event: sha256 of its canonical text.
  #event(id, data, prev = this.#tail(id)) {
    checkData(data, { maxBytes: 1024 * 1024 });
    const event = { seq: (prev?.seq ?? 0) + 1, at: Date.now(), previousHash: prev?.hash ?? null, ...data };
    const text = rowText(event), hash = sha256(text);
    this.rows.stmt('INSERT INTO events VALUES(?,?,?,?)').run(id, event.seq, text, hash);
    return { ...event, hash };
  }
  // The verified event chain of a run, or the first place it breaks: {events, error: {seq, message, reason} | null}. `events` holds the
  // events up to (not including) the break. events() throws on a break; verifyRun (src/verify-run.mjs) reports it.
  // One read snapshot: the head and the events it names are read together (a writer in another process could otherwise append in between).
  chain(id) { return this.rows.snapshot(() => this.#chain(id)); }
  #chain(id) {
    const head = this.rows.header(id).eventHead;
    let previousHash = null;
    const events = [];
    const broken = (seq, reason, message = 'Event chain verification failed') => ({ events, error: { seq, reason, message } });
    for (const [i, row] of this.db.prepare('SELECT body,hash FROM events WHERE run_id=? ORDER BY seq').all(id).entries()) {
      let event;
      try { event = JSON.parse(row.body); } catch { return broken(i + 1, 'event body is not JSON'); }
      if (event.seq !== i + 1) return broken(i + 1, `sequence ${event.seq} where ${i + 1} was expected (event removed or reordered)`);
      if (event.previousHash !== previousHash) return broken(i + 1, 'previousHash does not continue the chain');
      if (digest(event) !== row.hash) return broken(i + 1, 'event body does not match its recorded hash (edited)');
      previousHash = row.hash; events.push({ ...event, hash: row.hash });
    }
    if (!head || head.seq !== events.length || head.hash !== previousHash) return broken(events.length + 1, 'checkpoint head differs from the event history (truncated, appended or rewritten)', 'Checkpoint/event head mismatch or truncated event history');
    return { events, error: null };
  }
  events(id) {
    const { events, error } = this.chain(id);
    if (error) throw new FoundryError('CORRUPT_EVENTS', error.message, { seq: error.seq, reason: error.reason });
    return events;
  }
  // Decision/trace records (DESIGN §6). Ids are deterministic: a journal-recovered replay of the
  // same decision keeps the first record (append-only, first write wins).
  recordDecision(runId, decision) {
    checkData(decision, { maxBytes: 256 * 1024 });
    const insert = () => {
      const text = canonical(decision);
      const inserted = this.db.prepare('INSERT OR IGNORE INTO decisions VALUES(?,?,?,?)').run(decision.id, runId, decision.kind, text).changes === 1;
      // First write wins only within one run (a recovered replay of the same decision). A row under this id that belongs to another run
      // would silently swallow this run's decision, so it is refused (decision ids begin with their run id; a collision is a planted row).
      if (!inserted) {
        const owner = this.db.prepare('SELECT run_id FROM decisions WHERE id=?').get(decision.id)?.run_id;
        if (owner !== undefined && owner !== runId) throw new FoundryError('DECISION_CONFLICT', `Decision ${String(decision.id).slice(0, 120)} is already recorded for another run`);
      }
      // The decision enters the run's hash chain in the same commit: its id, kind and the hash of the stored text (src/audit.mjs).
      // (Named decisionHash, not hash: events() puts the event's own chain hash in `hash`.)
      if (inserted && this.#scope?.runId === runId) this.#scope.decisions.push({ type: 'decision.recorded', id: decision.id, kind: decision.kind, decisionHash: sha256(text) });
      return inserted;
    };
    // Inside this run's updateRun the chain event rides along. Called on its own, a decision for a run with a chain is recorded through one
    // (a decision outside any run, or inside someone else's transaction, is stored unbound, as before).
    const chained = this.#scope?.runId !== runId && this.#depth === 0 && this.db.prepare("SELECT 1 FROM runs WHERE id=? AND json_extract(body,'$.eventHead.seq') IS NOT NULL").get(runId);
    if (!chained) return insert();
    let inserted = false;
    this.updateRun(runId, () => { inserted = insert(); }, [], { result: 'header' });
    return inserted;
  }
  decisions(runId) { return this.db.prepare('SELECT body FROM decisions WHERE run_id=? ORDER BY rowid').all(runId).map(row => JSON.parse(row.body)); }
  /** Decision rows exactly as stored (the text the chain event hashes). */
  decisionRows(runId) { return this.db.prepare('SELECT id, kind, body FROM decisions WHERE run_id=? ORDER BY rowid').all(runId); }
  /** Bind an executor transcript into the run's hash chain: `executor.finished {transcriptHash}`. The file is hashed, and by default copied
   *  into the workspace (artifacts/<run>/transcripts/) so it can be re-hashed later; with copy:false it stays where it is (location is
   *  informational, and a verifier that cannot find it reports the hash as unchecked, not as wrong). */
  bindTranscript(runId, { nodeKey, file, label = null, copy = true } = {}) {
    this.run(runId); // NOT_FOUND before anything is written
    if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(runId) || runId === '.' || runId === '..') throw new FoundryError('TRANSCRIPT', 'Run ids that are not plain names cannot hold transcripts');
    if (typeof nodeKey !== 'string' || !nodeKey || nodeKey.length > 512) throw new FoundryError('TRANSCRIPT', 'A transcript is bound to a node key');
    if (typeof file !== 'string' || !file) throw new FoundryError('TRANSCRIPT', 'A transcript file path is required');
    if (label !== null && (typeof label !== 'string' || label.length > 200)) throw new FoundryError('TRANSCRIPT', 'A transcript label is a string of at most 200 characters');
    const source = path.resolve(file);
    let info;
    try { info = lstatSync(source); } catch (error) { throw new FoundryError('TRANSCRIPT', `Transcript file not found: ${error.code ?? 'unreadable'}`); }
    if (info.isSymbolicLink() || !info.isFile()) throw new FoundryError('TRANSCRIPT', 'A transcript must be a regular file, not a symlink');
    if (info.size > 256 * 1024 * 1024) throw new FoundryError('TRANSCRIPT', 'A transcript larger than 256 MiB cannot be bound');
    const data = readFileSync(source), transcriptHash = sha256(data);
    let location = { kind: 'external', path: source };
    if (copy) {
      const relative = path.join('artifacts', runId, 'transcripts', `${transcriptHash.slice(0, 16)}${path.extname(source).replace(/[^.A-Za-z0-9]/g, '')}`);
      const target = path.join(this.directory, relative);
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      // The copy stays inside the workspace state directory: a symlinked artifacts/ or run directory must not redirect it.
      if (!realpathSync(path.dirname(target)).startsWith(this.directory + path.sep)) throw new FoundryError('TRANSCRIPT', 'The transcript directory resolves outside the workspace state directory');
      // The name is derived from the hash, so an existing copy is this transcript bound before; anything else there is refused, not bound.
      if (!existsSync(target)) writeFileSync(target, data, { flag: 'wx', mode: 0o600 });
      else {
        const held = lstatSync(target);
        if (!held.isFile() || held.size !== data.length || sha256(readFileSync(target)) !== transcriptHash) throw new FoundryError('TRANSCRIPT', 'A different file already occupies this transcript\'s workspace copy');
      }
      location = { kind: 'workspace', path: relative };
    }
    const bound = this.updateRun(runId, () => {}, { type: 'executor.finished', nodeKey, label, transcriptHash, bytes: data.length, location }, { result: 'header' });
    return { runId, nodeKey, label, transcriptHash, bytes: data.length, location, seq: bound.eventHead.seq };
  }
  // Signal ids are idempotency keys, unique in the workspace (src/signals.mjs): the run that took an id and the digest of what it carried
  // ({name, key, payload}). Written in the same transaction as the delivery (the run's inbox and its signal.delivered event), so the index
  // and the runs never disagree; the run's chain, not this table, is the evidence.
  signalRecord(id) {
    const row = this.rows.stmt('SELECT id, run_id, digest, at FROM signals WHERE id=?').get(id);
    return row ? { id: row.id, runId: row.run_id, digest: row.digest, at: row.at } : null;
  }
  recordSignal(id, runId, digestText, at) { this.rows.stmt('INSERT INTO signals(id, run_id, digest, at) VALUES(?,?,?,?)').run(id, runId, digestText, at); }
  /** The parked, unresolved signal waits of open runs subscribed to `name` with this correlation key hash: [{runId, nodeKey}]. */
  openSignalWaits(name, keyHash, limit = 64) {
    return this.rows.stmt(`SELECT DISTINCT n.run_id AS run_id, n.node_key AS node_key FROM run_nodes n JOIN runs r ON r.id=n.run_id, json_each(n.body, '$.subscriptions') s
      WHERE n.status='waiting' AND json_type(n.body, '$.resolution') IS NULL AND json_extract(s.value, '$.signal')=? AND json_extract(s.value, '$.keyHash')=?
        AND json_extract(r.body, '$.status') NOT IN ('succeeded','failed','cancelled') ORDER BY n.run_id, n.node_key LIMIT ?`).all(name, keyHash, limit).map(row => ({ runId: row.run_id, nodeKey: row.node_key }));
  }
  /** The last event of a run of this type whose `field` equals `value`, checked against its own recorded hash (the whole chain is verified
   *  when a run is taken over and by verify-run); null when there is none. A point lookup for what the runtime must read back from the chain. */
  findEvent(runId, type, field, value) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(field)) throw new FoundryError('EVENT_FIELD', 'An event field name is a plain identifier');
    const row = this.rows.stmt(`SELECT body, hash FROM events WHERE run_id=? AND json_extract(body, '$.type')=? AND json_extract(body, '$.${field}')=? ORDER BY seq DESC LIMIT 1`).get(runId, type, value);
    if (!row) return null;
    const event = JSON.parse(row.body);
    if (digest(event) !== row.hash) throw new FoundryError('CORRUPT_EVENTS', `Event ${event.seq} (${type}) does not match its recorded hash`, { seq: event.seq });
    return { ...event, hash: row.hash };
  }
  // Durable wake-ups for wait nodes (DESIGN §5.4). The runtime writes them inside its updateRun
  // transaction, so a timer row and the node state that needs it commit together.
  setTimer(runId, nodeKey, wakeAt) {
    if (typeof runId !== 'string' || typeof nodeKey !== 'string' || !Number.isSafeInteger(wakeAt) || wakeAt < 0) throw new FoundryError('TIMER', 'A timer needs a run id, node key and integer wake time');
    this.db.prepare('INSERT INTO timers VALUES(?,?,?) ON CONFLICT(run_id,node_key) DO UPDATE SET wake_at=excluded.wake_at').run(runId, nodeKey, wakeAt);
  }
  clearTimer(runId, nodeKey) { this.db.prepare('DELETE FROM timers WHERE run_id=? AND node_key=?').run(runId, nodeKey); }
  clearTimers(runId) { this.db.prepare('DELETE FROM timers WHERE run_id=?').run(runId); }
  timers(runId) { return this.db.prepare('SELECT run_id,node_key,wake_at FROM timers WHERE run_id=? ORDER BY wake_at,node_key').all(runId).map(timerRow); }
  dueTimers(now = Date.now(), limit = 100) {
    if (!Number.isFinite(now) || !Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new FoundryError('TIMER', 'dueTimers needs a finite time and a limit of 1-10000');
    return this.db.prepare('SELECT run_id,node_key,wake_at FROM timers WHERE wake_at<=? ORDER BY wake_at,run_id,node_key LIMIT ?').all(Math.floor(now), limit).map(timerRow);
  }
  fixture(id) { const row = this.db.prepare('SELECT body FROM fixtures WHERE run_id=?').get(id); return row ? JSON.parse(row.body) : null; }
  fixtureEffect(runId, key, action) {
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT body FROM effects WHERE key=?').get(key);
      if (prior) return JSON.parse(prior.body);
      const world = this.fixture(runId);
      if (!world) throw new FoundryError('NO_FIXTURE', 'No simulator attached');
      world.actions.push(action);
      if (action === world.correctAction) world.healthy = true;
      else if (action !== 'none') world.wrongActions += 1;
      const result = { attempted: action };
      this.db.prepare('UPDATE fixtures SET body=? WHERE run_id=?').run(canonical(world), runId);
      this.db.prepare('INSERT INTO effects VALUES(?,?,?)').run(key, runId, canonical(result));
      return result;
    });
  }
  createRequest({ workflowId = null, baseHash = null, text, source = 'user' }) {
    if (typeof text !== 'string' || !text.trim() || text.length > 30000) throw new FoundryError('REQUEST_TEXT', 'Request text must contain 1–30000 characters');
    if (workflowId) {
      const current = this.workflow(workflowId);
      if (baseHash && baseHash !== current.hash) throw new FoundryError('STALE_WORKFLOW', 'The request targets an obsolete workflow');
      baseHash = current.hash;
    } else if (baseHash) throw new FoundryError('REQUEST_BASE', 'A base hash requires a workflow id');
    const request = { id: randomUUID(), workflowId, baseHash, text, source, status: 'pending', createdAt: Date.now() };
    this.db.prepare('INSERT INTO requests VALUES(?,?)').run(request.id, canonical(request));
    return request;
  }
  createAgentDesignRequest({ task, workflowId = null, expectedHash = null }) {
    return this.transaction(() => {
      const request = this.createRequest({ text: task, workflowId, baseHash: expectedHash, source: 'agent-request' });
      const result = { ...request, status: 'diagnostic', automaticGeneration: false,
        provenance: 'Task relayed or composed by the host agent; not direct user consent or an authority grant' };
      this.db.prepare('UPDATE requests SET body=? WHERE id=?').run(canonical(result), request.id);
      return result;
    });
  }
  requests() { return this.db.prepare('SELECT body FROM requests ORDER BY rowid DESC LIMIT 100').all().map(r => JSON.parse(r.body)); }
  pendingRequests(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new FoundryError('REQUEST_LIMIT', 'Invalid pending request page size');
    return this.db.prepare("SELECT body FROM requests WHERE json_extract(body,'$.status')='pending' ORDER BY rowid ASC LIMIT ?").all(limit).map(row => JSON.parse(row.body));
  }
  request(id) { const row = this.db.prepare('SELECT body FROM requests WHERE id=?').get(id); if (!row) throw new FoundryError('NOT_FOUND', 'Request not found'); return JSON.parse(row.body); }
  createTrial({ requestId, workflow, registryHash, inputHash, policyHash, maxPerRequest, maxTotal }) {
    return this.transaction(() => {
      const request = this.request(requestId);
      if (!['pending', 'diagnostic', 'proposed', 'failed', 'interrupted'].includes(request.status)) throw new FoundryError('TRIAL_REQUEST_STATE', 'Trial requires an open draft or diagnostic request; applied/processing/cancelled requests cannot be reused');
      const base = request.baseHash ? this.workflow(request.baseHash).workflow : null;
      const current = this.db.prepare('SELECT hash FROM heads WHERE id=?').get(request.workflowId ?? workflow.id)?.hash ?? null;
      if (current !== request.baseHash) throw new FoundryError('STALE_WORKFLOW', 'The draft request no longer targets the current workflow head');
      if (workflow.version !== (base?.version ?? 0) + 1 || (request.workflowId && request.workflowId !== workflow.id)) throw new FoundryError('REQUEST_VERSION', 'Draft must preserve the requested identity and next version');
      if (request.source === 'agent-diagnostic' && (workflow.goal !== request.goal || digest(workflow.envelope.successCriteria) !== digest(request.successCriteria))) throw new FoundryError('REPAIR_INTENT', 'A diagnostic draft must preserve its declared goal and success criteria');
      const perRequest = this.db.prepare('SELECT COUNT(*) AS n FROM trials WHERE request_id=?').get(requestId).n;
      const total = this.db.prepare('SELECT COUNT(*) AS n FROM trials').get().n;
      if (perRequest >= maxPerRequest || total >= maxTotal) throw new FoundryError('TRIAL_BUDGET', 'The host diagnostic trial budget is exhausted; no execution was started');
      const trial = { id: randomUUID(), requestId, baseHash: request.baseHash, workflowId: workflow.id,
        workflowVersion: workflow.version, workflowHash: digest(workflow), registryHash, inputHash, policyHash,
        ordinal: perRequest + 1, status: 'running', createdAt: Date.now(), pid: process.pid, processStart: processStart(process.pid),
        runId: null, taskOutcomeQualified: false, qualificationLevel: 'construction',
        qualification: 'Isolated diagnostic execution only. Local acceptance is model-authored; no independent outcome qualification.' };
      this.db.prepare('INSERT INTO trials VALUES(?,?,?)').run(trial.id, requestId, canonical(trial));
      return trial;
    });
  }
  trial(id) {
    const row = this.db.prepare('SELECT body FROM trials WHERE id=?').get(id);
    if (!row) throw new FoundryError('NOT_FOUND', 'Diagnostic trial not found');
    const trial = JSON.parse(row.body);
    if (trial.status === 'running' && !liveJobOwner(trial)) return this.finishTrial(id, {
      status: 'interrupted', error: { code: 'TRIAL_PROCESS_LOST', message: 'Trial owner exited without a final receipt; no automatic retry or qualification.' }
    });
    return trial;
  }
  finishTrial(id, evidence) {
    checkData(evidence);
    return this.transaction(() => {
      const row = this.db.prepare('SELECT body FROM trials WHERE id=?').get(id);
      if (!row) throw new FoundryError('NOT_FOUND', 'Diagnostic trial not found');
      const trial = JSON.parse(row.body);
      if (trial.status !== 'running') throw new FoundryError('TRIAL_CLOSED', 'A diagnostic receipt cannot be overwritten');
      const allowed = new Set(['status', 'error', 'runId', 'runStatus', 'eventHead', 'outputHash', 'steps', 'cost', 'artifactReceipts', 'localAcceptancePassed']);
      if (Object.keys(evidence).some(key => !allowed.has(key)) || !['finished', 'failed', 'interrupted'].includes(evidence.status)) throw new FoundryError('TRIAL_RECEIPT', 'Unsupported trial evidence fields or terminal state');
      const result = { ...trial, ...clone(evidence), finishedAt: Date.now() };
      this.db.prepare('UPDATE trials SET body=? WHERE id=?').run(canonical(result), id);
      return result;
    });
  }
  trials(requestId = null) {
    const rows = requestId ? this.db.prepare('SELECT id FROM trials WHERE request_id=? ORDER BY rowid DESC LIMIT 100').all(requestId)
      : this.db.prepare('SELECT id FROM trials ORDER BY rowid DESC LIMIT 100').all();
    return rows.map(row => this.trial(row.id));
  }
  createDiagnosticRepair({ requestId, failedRunId, expectedHash, diagnostic = '', maxDepth = 3 }) {
    if (typeof diagnostic !== 'string' || diagnostic.length > 4000) throw new FoundryError('REPAIR_DIAGNOSTIC', 'Diagnostic commentary must be a string of at most 4000 characters');
    if (!/^[0-9a-f]{64}$/.test(expectedHash ?? '')) throw new FoundryError('REPAIR_HASH', 'An exact expected workflow hash is required');
    return this.transaction(() => {
      const parent = this.request(requestId), run = this.run(failedRunId);
      const prior = this.db.prepare('SELECT request_id FROM diagnostic_repairs WHERE run_id=?').get(failedRunId);
      if (prior) {
        const existing = this.request(prior.request_id);
        if (existing.parentRequestId !== requestId || existing.baseHash !== expectedHash) throw new FoundryError('REPAIR_CONFLICT', 'This failure already belongs to a different diagnostic request binding');
        return { ...existing, reused: true };
      }
      if (parent.status !== 'applied') throw new FoundryError('REPAIR_REQUEST_STATE', 'The failed run must belong to an already applied request');
      const proposalRow = this.db.prepare("SELECT body FROM proposals WHERE json_extract(body,'$.requestId')=? AND json_extract(body,'$.status')='applied' AND json_extract(body,'$.workflowHash')=?").get(requestId, run.workflowHash);
      if (!proposalRow) throw new FoundryError('REPAIR_PROVENANCE', 'No applied proposal connects this request to the exact failed workflow');
      const proposal = JSON.parse(proposalRow.body);
      if (run.workflowHash !== expectedHash || this.workflow(run.workflowId).hash !== expectedHash || proposal.workflow.id !== run.workflowId) throw new FoundryError('STALE_WORKFLOW', 'Repair must target the current head and exact failed run version');
      if (run.status !== 'failed' || run.owner) throw new FoundryError('REPAIR_RUN_STATE', 'Only a terminal failed run can open an automatic diagnostic repair; paused, cancelled or uncertain effects need explicit reconciliation');
      const events = this.events(failedRunId);
      if (!events.length || !run.error) throw new FoundryError('REPAIR_EVIDENCE', 'A verified failure and event chain are required');
      const depth = (parent.repairDepth ?? 0) + 1;
      if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 10 || depth > maxDepth) throw new FoundryError('REPAIR_BUDGET', 'The host diagnostic repair depth is exhausted');
      const rootRequestId = parent.rootRequestId ?? parent.id, root = this.request(rootRequestId);
      const request = {
        id: randomUUID(), workflowId: run.workflowId, baseHash: expectedHash, text: root.text,
        source: 'agent-diagnostic', status: 'diagnostic', createdAt: Date.now(),
        parentRequestId: parent.id, rootRequestId, repairDepth: depth, appliedProposalId: proposal.id,
        failedRunId, failureEventHead: clone(run.eventHead), failure: clone(run.error),
        diagnostic, diagnosticAuthority: 'Untrusted agent commentary; not a new requirement, consent, policy or success oracle',
        goal: proposal.workflow.goal, successCriteria: clone(proposal.workflow.envelope.successCriteria),
        automaticGeneration: false
      };
      this.db.prepare('INSERT INTO requests VALUES(?,?)').run(request.id, canonical(request));
      this.db.prepare('INSERT INTO diagnostic_repairs VALUES(?,?)').run(failedRunId, request.id);
      return { ...request, reused: false };
    });
  }
  createProposal({ requestId, workflow, rationale, validation }) {
    return this.transaction(() => this.#createProposal({ requestId, workflow, rationale, validation }));
  }
  #createProposal({ requestId, workflow, rationale, validation }) {
    const request = this.request(requestId);
    if (request.status === 'applied') throw new FoundryError('REQUEST_CLOSED', 'This request already has an applied proposal');
    if (!validation?.valid || validation.hash !== digest(workflow)) throw new FoundryError('UNVALIDATED_PROPOSAL', 'A matching valid workflow receipt is required');
    if (typeof rationale !== 'string' || !rationale.trim() || rationale.length > 20000) throw new FoundryError('PROPOSAL_RATIONALE', 'A bounded rationale is required');
    if (request.workflowId && workflow.id !== request.workflowId) throw new FoundryError('PROPOSAL_ID', 'A revision cannot silently switch workflow identity');
    const base = request.baseHash ? this.workflow(request.baseHash).workflow : null;
    if (workflow.version !== (base?.version ?? 0) + 1) throw new FoundryError('VERSION_CONFLICT', 'Proposal must increment the base version exactly once');
    if (request.source === 'agent-diagnostic' && (workflow.goal !== request.goal || digest(workflow.envelope.successCriteria) !== digest(request.successCriteria))) throw new FoundryError('REPAIR_INTENT', 'A diagnostic repair cannot change the declared goal or success criteria; ask for a separate user revision');
    const before = new Map((base?.nodes ?? []).map(n => [n.id, digest(n)]));
    const after = new Map(workflow.nodes.map(n => [n.id, digest(n)]));
    const impact = {
      added: [...after.keys()].filter(k => !before.has(k)), removed: [...before.keys()].filter(k => !after.has(k)),
      changed: [...after.keys()].filter(k => before.has(k) && before.get(k) !== after.get(k)),
      acceptanceChanged: base ? digest(base.acceptance) !== digest(workflow.acceptance) : true,
      budgetChanged: base ? digest(base.budget) !== digest(workflow.budget) : true,
      activeRunsMigrated: false
    };
    const proposal = { id: randomUUID(), requestId, baseHash: request.baseHash, workflow: clone(workflow), workflowHash: validation.hash, rationale, impact, validation, status: 'proposed', createdAt: Date.now() };
    this.db.prepare('INSERT INTO proposals VALUES(?,?)').run(proposal.id, canonical(proposal));
    this.db.prepare('UPDATE requests SET body=? WHERE id=?').run(canonical({ ...request, status: 'proposed' }), requestId);
    return proposal;
  }
  proposal(id) { const row = this.db.prepare('SELECT body FROM proposals WHERE id=?').get(id); if (!row) throw new FoundryError('NOT_FOUND', 'Proposal not found'); return JSON.parse(row.body); }
  proposals() { return this.db.prepare('SELECT body FROM proposals ORDER BY rowid DESC LIMIT 100').all().map(r => JSON.parse(r.body)); }
  applyProposal(id) {
    return this.transaction(() => {
      const proposal = this.proposal(id);
      if (proposal.status !== 'proposed') throw new FoundryError('PROPOSAL_CLOSED', 'Proposal is no longer applicable');
      const request = this.request(proposal.requestId);
      if (request.status === 'applied') throw new FoundryError('REQUEST_CLOSED', 'Another proposal already applied this request');
      if (proposal.workflowHash !== digest(proposal.workflow) || request.baseHash !== proposal.baseHash) throw new FoundryError('PROPOSAL_CORRUPT', 'Proposal content or request binding changed');
      // Program insertion, head CAS, proposal state and request consumption form
      // one SQLite commit. A crash cannot publish a new head while leaving the
      // same request available for an unrelated second application.
      const saved = this.#saveWorkflow(proposal.workflow, proposal.baseHash);
      this.db.prepare('UPDATE proposals SET body=? WHERE id=?').run(canonical({ ...proposal, status: 'applied', appliedAt: Date.now() }), id);
      this.db.prepare('UPDATE requests SET body=? WHERE id=?').run(canonical({ ...request, status: 'applied' }), request.id);
      return { ...proposal, status: 'applied', ...saved };
    });
  }
  createGenerationJob(requestId, descriptor, limits) {
    checkData(descriptor); checkData(limits);
    return this.transaction(() => {
      const request = this.request(requestId);
      if (!['pending', 'diagnostic'].includes(request.status)) throw new FoundryError('REQUEST_NOT_PENDING', 'A request is already being processed or has a proposal');
      const job = { id: randomUUID(), requestId, provider: clone(descriptor), limits: clone(limits), status: 'running', createdAt: Date.now(), updatedAt: Date.now(), attempts: [], pid: process.pid, processStart: processStart(process.pid), proposalId: null, error: null };
      this.db.prepare('INSERT INTO generation_jobs VALUES(?,?,?)').run(job.id, requestId, canonical(job));
      this.db.prepare('UPDATE requests SET body=? WHERE id=?').run(canonical({ ...request, status: 'processing', generationJobId: job.id }), requestId);
      return job;
    });
  }
  generationJob(id) {
    const row = this.db.prepare('SELECT body FROM generation_jobs WHERE id=?').get(id);
    if (!row) throw new FoundryError('NOT_FOUND', 'Generation job not found');
    const job = JSON.parse(row.body);
    if (job.status === 'running' && !liveJobOwner(job)) return this.updateGenerationJob(id, current => {
      current.status = 'interrupted'; current.finishedAt = Date.now();
      current.error = { code: 'GENERATOR_PROCESS_LOST', message: 'The owning process exited before committing a terminal generation receipt. No automatic retry is authorized.' };
    });
    return job;
  }
  generationJobs() { return this.db.prepare('SELECT id FROM generation_jobs ORDER BY rowid DESC LIMIT 100').all().map(row => this.generationJob(row.id)); }
  recordQualification(report) {
    checkData(report); const id = digest(report);
    if (!/^[0-9a-f]{64}$/.test(report.workflowHash ?? '') || !/^[0-9a-f]{64}$/.test(report.registryHash ?? '') || typeof report.passed !== 'boolean' || typeof report.evaluatorId !== 'string' || !report.evaluatorId.trim() || report.evaluatorId.length > 1000) throw new FoundryError('QUALIFICATION', 'An identified evaluation report bound to workflow and registry hashes is required');
    if (report.qualificationLevel !== undefined && !['construction', 'task-outcome'].includes(report.qualificationLevel)) throw new FoundryError('QUALIFICATION', 'Evaluation level must explicitly be construction or task-outcome; omitted levels remain unclassified');
    this.db.prepare('INSERT OR IGNORE INTO qualifications VALUES(?,?,?)').run(id, report.workflowHash, canonical(report));
    return { id, ...clone(report) };
  }
  qualifications(workflowHash = null) {
    const rows = workflowHash ? this.db.prepare('SELECT body FROM qualifications WHERE workflow_hash=? ORDER BY rowid DESC LIMIT 100').all(workflowHash) : this.db.prepare('SELECT body FROM qualifications ORDER BY rowid DESC LIMIT 100').all();
    return rows.map(row => ({ id: digest(JSON.parse(row.body)), ...JSON.parse(row.body) }));
  }
  updateGenerationJob(id, mutate) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT body FROM generation_jobs WHERE id=?').get(id);
      if (!row) throw new FoundryError('NOT_FOUND', 'Generation job not found');
      const job = JSON.parse(row.body); mutate(job); job.updatedAt = Date.now();
      checkData(job); this.db.prepare('UPDATE generation_jobs SET body=? WHERE id=?').run(canonical(job), id);
      if (['failed', 'cancelled', 'interrupted'].includes(job.status)) {
        const request = this.request(job.requestId);
        if (request.status === 'processing' && request.generationJobId === id) this.db.prepare('UPDATE requests SET body=? WHERE id=?').run(canonical({ ...request, status: job.status }), request.id);
      }
      return job;
    });
  }
}
