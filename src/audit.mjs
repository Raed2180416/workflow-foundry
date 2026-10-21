// Audit binding (research/review-20261007/07 §4.4, ROADMAP-AMENDMENTS R-21). The per-run event hash chain commits to its own
// events; this module defines what else the chain binds, so editing it afterwards is detectable (`foundry verify-run`):
//   - every model call: the journal row's request/response hashes and a digest of the whole row, on the event that charges it; a replayed
//     call also records whether its recording was checked (replaySource), and each attempt's context.compiled the journal's high-water
//     mark (journalMark), so a "recovered" row seeded before the attempt is refused;
//   - every decision record: `decision.recorded {id, kind, decisionHash}`;
//   - the run's identity: verify-run compares the run record with its birth event (workflow, input, policy, engine, model binding);
//   - every executor transcript: `executor.finished {transcriptHash}`;
//   - the seal: `run.verdict` carries a Merkle root over the run's journal rows and a hash of the state the verdict was computed from;
//   - the chain head, exported as an anchor record that can be stored outside the database file.
// Threat model (07 §4.4): accidental corruption, buggy code and an agent editing evidence; not a privileged attacker who
// rewrites the database AND every copy of the anchors.
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { digest, FoundryError } from './data.mjs';

export const AUDIT = 'foundry-audit/1';
export const ANCHOR_SCHEMA = 'foundry-anchor/1';
export const sha256 = data => createHash('sha256').update(data).digest('hex');

// Every model_calls column except the two large text columns, which are bound by their own hashes. A column added to the
// journal later needs a new `v` here; rows keep verifying under the version their events were written with.
const ROW_COLUMNS = Object.freeze(['id', 'replay_key', 'run_id', 'node_key', 'attempt', 'sample_index', 'model_id', 'provider', 'engine_version', 'decoding',
  'receipt_hash', 'prompt_hash', 'ok', 'error_code', 'input_tokens', 'output_tokens', 'cost_usd', 'imputed_usd', 'latency_ms', 'created_at',
  'cache_read_tokens', 'cache_write_tokens']);

/** The hashes an event binds for one journal row, computed from the row exactly as stored (raw SQLite columns). The request
 *  and response are hashed as their stored text, so a single edited byte changes the hash. */
export function bindRow(raw) {
  const requestHash = raw.request == null ? null : sha256(raw.request), responseHash = raw.response == null ? null : sha256(raw.response);
  const fields = Object.fromEntries(ROW_COLUMNS.map(column => [column, raw[column] ?? null]));
  return { journalRowHash: digest({ v: 1, ...fields, request: requestHash, response: responseHash }), requestHash, responseHash };
}

/** Binary Merkle root over hex digests (leaves and nodes are domain-separated; an odd node is carried up). Null when empty. */
export function merkleRoot(hashes) {
  if (!hashes.length) return null;
  let level = hashes.map(hash => sha256(`leaf:${hash}`));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? sha256(`node:${level[i]}:${level[i + 1]}`) : level[i]);
    level = next;
  }
  return level[0];
}

const hasJournal = db => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='model_calls'").get();
/** The raw journal row `id`, or null (also when the database has no journal table). */
export const journalRow = (db, id) => hasJournal(db) ? db.prepare('SELECT * FROM model_calls WHERE id=?').get(id) ?? null : null;
/** Seal of a run's journal: how many rows, the highest id and the Merkle root over their row digests, for rows with id <= upTo. */
export function journalSeal(db, runId, upTo = Number.MAX_SAFE_INTEGER) {
  if (!hasJournal(db)) return { calls: 0, maxId: 0, root: null };
  const hashes = []; let maxId = 0;
  for (const raw of db.prepare('SELECT * FROM model_calls WHERE run_id=? AND id<=? ORDER BY id').iterate(runId, upTo)) { hashes.push(bindRow(raw).journalRowHash); maxId = raw.id; }
  return { calls: hashes.length, maxId, root: merkleRoot(hashes) };
}
/** Rows of a run written after `afterId`: id, whether replay lookup could serve them, and the error code. */
export function journalRowsAfter(db, runId, afterId) {
  if (!hasJournal(db)) return [];
  return db.prepare('SELECT id, ok, error_code FROM model_calls WHERE run_id=? AND id>? ORDER BY id').all(runId, afterId);
}

/** The engine a run's chain binds (research/engine-20261021/ENGINE-BUMP.md §1): the birth event's engine, then each `engine.migrated`
 *  event in order, each of which must start from the engine bound before it. -> {valid, hash, engines: [birth, ...targets], migrations}.
 *  Pure function of the chain; whether a migration was allowed is the migrating engine's lineage, recorded in the event. */
export function engineBinding(events) {
  const birth = events?.[0];
  let hash = birth?.engineHash ?? null, valid = true;
  const engines = [hash], migrations = [];
  for (const e of events ?? []) {
    if (e?.type !== 'engine.migrated') continue;
    if (e.from !== hash || typeof e.to !== 'string' || e.to === hash) valid = false;
    migrations.push({ seq: e.seq ?? null, from: e.from ?? null, to: e.to ?? null, fromVersion: e.fromVersion ?? null, toVersion: e.toVersion ?? null });
    hash = e.to ?? null; engines.push(hash);
  }
  return { valid, hash, engines, migrations };
}

/** The identity fields of a run record that no longer match its immutable birth event: the workflow, input, policy, engine, registry and
 *  model binding the run was created with. Nothing rewrites these after creation, so every name returned is an edit of the record (the
 *  runtime refuses to resume such a run; verify-run reports it). A field the birth event does not carry (an older run) is not compared.
 *  The one exception is the engine, which a recorded `engine.migrated` event may move: with `events`, the record's engine is compared
 *  with the engine the chain binds (engineBinding), and an inconsistent migration chain is reported as `engineMigration`. */
export function identityChanges(run, birth, events = null) {
  const changed = [];
  const same = (name, actual, expected) => { if (expected !== undefined && (actual ?? null) !== (expected ?? null)) changed.push(name); };
  same('workflowHash', run.workflowHash, birth?.workflowHash);
  same('registryHash', run.registryHash, birth?.registryHash);
  // The engine is the one the chain binds now: the birth engine, or the target of the last recorded migration (engineBinding).
  const engine = events ? engineBinding(events) : null;
  if (engine && !engine.valid) changed.push('engineMigration');
  same('engineHash', run.engineHash, engine?.valid ? engine.hash : birth?.engineHash);
  same('input', digest(run.input ?? null), birth?.inputHash);
  same('policy', digest(run.policy ?? null), birth?.policyHash);
  if (birth && Object.hasOwn(birth, 'modelPolicyHash')) {
    for (const key of ['modelPolicyHash', 'modelMode', 'sampleSalt', 'assignmentHash']) same(key, run[key], birth[key]);
    if (birth.assignmentHash != null) same('assignment', digest(run.assignment ?? null), birth.assignmentHash);
    same('identity', run.identity ? digest(run.identity) : null, birth.identityHash);
  }
  return changed;
}

/** What the verdict was computed from: the run's identity, terminal status, error, findings and every node state and output. */
export const verdictInputsHash = run => digest({ v: 1, workflowHash: run.workflowHash, status: run.status, error: run.error ?? null, findings: run.findings ?? [],
  steps: run.steps ?? 0, cost: run.cost ?? 0, nodes: run.nodes ?? {}, outputs: run.outputs ?? {}, frames: run.frames ?? {} });

/** The anchor of a run's chain head: small enough to commit in a manifest or append to a file outside the workspace. It is a function of the
 *  run's evidence only (no clock): the head, the run's status and the journal root of its latest seal (or, before any seal, the journal's
 *  current rows when a journal database is given). `events` must be a verified chain (store.events or verifyRun's own check). */
export function anchorOfEvents({ runId, events, status, journalDb = null }) {
  // The seal in force: the final one that closed the run (nothing after it is the run's), else the latest 'uncertain' one.
  const head = events.at(-1), seal = events.find(e => e.type === 'run.verdict' && e.verdict !== 'uncertain') ?? events.findLast(e => e.type === 'run.verdict');
  const journal = seal ? { root: seal.journalRoot ?? null, calls: seal.journalCalls ?? 0, maxId: seal.journalMaxId ?? 0 }
    : journalDb ? journalSeal(journalDb, runId) : { root: null, calls: 0, maxId: 0 };
  return { schema: ANCHOR_SCHEMA, runId, headSeq: head.seq, headHash: head.hash, headAt: head.at, journalRoot: journal.root, journalCalls: journal.calls, journalMaxId: journal.maxId,
    boardRoot: null, status };
}

/** The anchor of a run kept in `store`, from its verified events (a run whose journal is in another database anchors its sealed root only). */
export const anchorInWorkspace = (store, { runId, events, status }) => anchorOfEvents({ runId, events, status, journalDb: events[0]?.journal === 'external' ? null : store.db });

// Anchor file: JSON lines, each carrying the hash of the previous line, so a deleted or edited line is itself detectable.
function readLines(file) {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  return text.split('\n').filter(Boolean);
}
export function readAnchors(file) {
  const lines = readLines(file), anchors = [];
  let previous = null;
  for (const [index, line] of lines.entries()) {
    let anchor;
    try { anchor = JSON.parse(line); } catch { throw new FoundryError('ANCHOR_FILE', `Anchor file line ${index + 1} is not JSON`); }
    if (anchor?.schema !== ANCHOR_SCHEMA || typeof anchor.runId !== 'string' || !Number.isSafeInteger(anchor.headSeq) || typeof anchor.headHash !== 'string')
      throw new FoundryError('ANCHOR_FILE', `Anchor file line ${index + 1} is not a ${ANCHOR_SCHEMA} record`);
    if ((anchor.previous ?? null) !== previous) throw new FoundryError('ANCHOR_FILE', `Anchor file line ${index + 1} does not continue the previous line (a line was edited, removed or reordered)`);
    anchors.push(anchor); previous = sha256(line);
  }
  return anchors;
}
// Writers of one anchor file (parallel runs, several verify-run processes) take turns: each line names the hash of the line before it,
// so two writers that read the same tail would fork the file and every later read would reject it. The lock is an exclusive lock file
// next to it; one left by a writer that died is taken over after STALE_LOCK_MS.
const LOCK_WAIT_MS = 15000, STALE_LOCK_MS = 30000;
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function withAnchorLock(file, fn) {
  const lock = `${file}.lock`, deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { const fd = openSync(lock, 'wx', 0o600); try { writeSync(fd, String(process.pid)); } finally { closeSync(fd); } break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let age = 0;
      try { age = Date.now() - statSync(lock).mtimeMs; } catch { continue; } // released between the two calls
      if (age > STALE_LOCK_MS) { rmSync(lock, { force: true }); continue; }
      if (Date.now() > deadline) throw new FoundryError('ANCHOR_FILE', `The anchor file is locked by another writer (${lock})`);
      pause(10 + Math.floor(Math.random() * 20));
    }
  }
  try { return fn(); } finally { rmSync(lock, { force: true }); }
}
/** Append an anchor, stamped with the time it was taken, to an append-only file (created 0600). A repeat of the run's latest anchor (same head and journal root) is not written twice. */
export function appendAnchor(file, anchor) {
  return withAnchorLock(file, () => {
    const anchors = readAnchors(file);
    const latest = anchors.findLast(a => a.runId === anchor.runId);
    if (latest && latest.headHash === anchor.headHash && latest.journalRoot === anchor.journalRoot && latest.status === anchor.status) return { appended: false, anchor: latest };
    const lines = readLines(file);
    const line = JSON.stringify({ ...anchor, at: Date.now(), previous: lines.length ? sha256(lines.at(-1)) : null });
    appendFileSync(file, `${line}\n`, { flag: 'a', mode: 0o600 });
    return { appended: true, anchor: JSON.parse(line) };
  });
}
