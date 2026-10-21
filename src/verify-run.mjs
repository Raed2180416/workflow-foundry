// `foundry verify-run RUN` (07 §4.4 item 5, R-21): recompute everything the run's hash chain binds (src/audit.mjs) and report
// what no longer matches. Read-only. A finding is an error (evidence was edited, removed or never bound), a warning (evidence is
// unchecked, or not committed by the chain) or info. `ok` means no errors; `clean` means no errors and no warnings.
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { digest } from './data.mjs';
import { AUDIT, anchorOfEvents, bindRow, engineBinding, identityChanges, journalRow, journalRowsAfter, journalSeal, sha256, verdictInputsHash } from './audit.mjs';
import { REPLAYABLE_ERRORS } from './journal.mjs';
import { verdictOf } from './verdict.mjs';
import { engineHash, engineOf } from './engine.mjs';
import { replayWaits, signalCheckpointDrift } from './signals.mjs';
import { stateOpHash } from './state.mjs';

const CALL_EVENTS = new Set(['model.called', 'node.recovered_from_journal', 'model.cancelled']);
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'uncertain']);
// What the runtime writes right after a seal, in the same commit: the terminal event, or the approval decision that rejected the run.
const CLOSING_EVENTS = new Set(['run.succeeded', 'run.failed', 'run.cancelled', 'run.uncertain', 'run.stopped', 'approval.decided']);
const TRANSCRIPT_MAX_BYTES = 256 * 1024 * 1024;
const HEX64 = /^[0-9a-f]{64}$/;
const replayable = row => row.ok === 1 || REPLAYABLE_ERRORS.includes(row.error_code);
const differing = (actual, expected) => Object.keys(expected).filter(key => actual[key] !== expected[key]);

/**
 * @param store      a Store (events, run, decisionRows, workflow, db)
 * @param runId
 * @param opts.journalDb  database holding the journal (default: the store's, unless the run's birth event says its journal is external)
 * @param opts.expectHead {seq, hash} the chain must contain this event (a head recorded elsewhere)
 * @param opts.anchors    anchor records (readAnchors; null when none were supplied): the chain must contain every anchored head
 * @param opts.requireBound  for claim-bearing runs: a run without the audit marker, and evidence the chain binds but this check could not
 *                           re-read (an external journal not supplied, a missing external transcript, an unverified replay source), are errors
 */
export function verifyRun(store, runId, options = {}) {
  // One read snapshot, so a run another process is still writing to is judged on a single consistent state.
  const own = !store.db.isTransaction;
  if (own) store.db.exec('BEGIN');
  try { return check(store, runId, options); } finally { if (own) store.db.exec('COMMIT'); }
}
function check(store, runId, { journalDb: given = null, expectHead = null, anchors = null, requireBound = false }) {
  const run = store.run(runId); // NOT_FOUND propagates
  const findings = [];
  const add = (severity, code, message, details = {}) => findings.push({ severity, code, message, ...details });
  const { events, error } = store.chain(runId);
  // A run whose ModelPort journaled into another database says so in its birth event; without that database its rows cannot be checked.
  // A run that journaled into the workspace is always checked against the workspace: a journal named on the command line cannot stand in
  // for it (a pristine copy would hide an edited workspace journal).
  const external = events[0]?.journal === 'external';
  const journalDb = external ? given : store.db;
  const checks = { chain: error ? 'broken' : 'ok', events: events.length, journal: null, decisions: null, transcripts: null, seals: null, state: null, stateOps: null };
  const result = () => {
    const ok = !findings.some(f => f.severity === 'error');
    return { schema: 'foundry-verify/1', runId, ok, clean: ok && !findings.some(f => f.severity === 'warn'), status: run.status, bound, audit: events[0]?.audit ?? null,
      head: error ? null : { seq: events.length, hash: events.at(-1)?.hash ?? null }, anchor: error ? null : anchorOfEvents({ runId, events, status: run.status, journalDb }), checks, findings };
  };
  let bound = false;
  if (error) { add('error', 'CHAIN_BROKEN', `${error.message}: event ${error.seq} (${error.reason})`, { seq: error.seq }); return result(); }

  // 1. The head recorded elsewhere. A later chain extends an earlier one, so every anchored (seq, hash) must still be in it.
  const contains = (seq, hash) => Number.isSafeInteger(seq) && seq >= 1 && seq <= events.length && events[seq - 1].hash === hash;
  if (expectHead && !contains(expectHead.seq, expectHead.hash)) add('error', 'HEAD_MISMATCH', `The chain has no event ${expectHead.seq} with hash ${expectHead.hash}${expectHead.seq > events.length ? ` (it holds ${events.length} events: truncated)` : ' (rewritten)'}`, { expected: expectHead });
  const mine = (anchors ?? []).filter(a => a.runId === runId);
  if (anchors && !mine.length) add('warn', 'ANCHOR_NONE', 'No anchor for this run was found in the supplied anchors; nothing outside the database vouches for its head');
  for (const anchor of mine) {
    if (!contains(anchor.headSeq, anchor.headHash)) add('error', 'ANCHOR_MISMATCH', `The anchored head (event ${anchor.headSeq}, ${anchor.headHash.slice(0, 12)}) is not in this chain${anchor.headSeq > events.length ? ': truncated' : ': rewritten'}`, { anchor });
    else if (journalDb && anchor.journalRoot !== undefined && anchor.journalMaxId !== undefined) {
      const seal = journalSeal(journalDb, runId, anchor.journalMaxId);
      if (seal.root !== anchor.journalRoot || seal.calls !== anchor.journalCalls) add('error', 'ANCHOR_JOURNAL_MISMATCH', `The journal rows up to ${anchor.journalMaxId} no longer match the anchored journal root`, { anchor });
    }
  }

  // 1a. The run's node rows (src/run-rows.mjs): the runtime acts on their status and label columns (which nodes run, the taint a reference
  // inherits) while the seal below hashes the node states, so a column that no longer repeats its state was edited on its own.
  for (const row of store.rows?.mismatchedRows?.(runId) ?? []) add('error', 'STATE_ROW_EDITED', `Node row ${row.nodeKey}: ${row.reason}; the run's state rows were edited`, { nodeKey: row.nodeKey });
  if (given && !external && !error) add('warn', 'JOURNAL_ARGUMENT_IGNORED', 'This run journaled its model calls in the workspace database (its birth event says so); it is checked against that, not against the journal that was passed');
  bound = events[0]?.audit === AUDIT;
  if (!bound) {
    add(requireBound ? 'error' : 'warn', 'LEGACY_UNBOUND', `This run predates audit binding (its birth event has no ${AUDIT} marker): only its event chain is verified, not its model responses, decisions or verdict`);
    return result();
  }
  // Evidence the chain binds but this check could not re-read (another database, a missing external file, an unverifiable replay
  // source) is a warning, and an error for a claim-bearing run (requireBound).
  const unchecked = requireBound ? 'error' : 'warn';

  // 1b. The run record's identity against its immutable birth event: the workflow, input, policy, engine, registry and model binding
  // the run was created with. Nothing rewrites these after creation, so any difference is an edit (07 §4.4).
  const birth = events[0], identity = identityChanges(run, birth, events);
  if (identity.length) add('error', 'RUN_IDENTITY_EDITED', `The run record no longer matches its birth event (${identity.join(', ')})`, { changed: identity });
  // Engine migrations (research/engine-20261021/ENGINE-BUMP.md §1): each one recorded is reported; a chain whose migrations do not follow
  // on from each other is an error (identityChanges names it too). Whether each was allowed was the migrating engine's lineage.
  const engines = engineBinding(events);
  if (!engines.valid) add('error', 'ENGINE_MIGRATION_INVALID', 'The run\'s engine.migrated events do not follow on from its birth engine and from each other');
  for (const m of engines.migrations) add('info', 'ENGINE_MIGRATED', `The run moved from engine ${String(m.from).slice(0, 12)} (version ${m.fromVersion ?? '?'}) to ${String(m.to).slice(0, 12)} (version ${m.toVersion ?? '?'}) at event ${m.seq}${engineOf(m.to) ? '' : '; this engine does not know the target engine'}`, { seq: m.seq, fromVersion: m.fromVersion, toVersion: m.toVersion });
  // The workflow the run executed, by its content hash: an edited or deleted body cannot be the one the chain names.
  let workflow = null;
  try { workflow = store.workflow(birth.workflowHash).workflow; }
  catch (cause) {
    if (cause.code === 'CORRUPT_WORKFLOW') add('error', 'WORKFLOW_EDITED', `The stored workflow ${String(birth.workflowHash).slice(0, 12)} no longer hashes to the hash the birth event names`);
    else if (cause.code === 'NOT_FOUND') add('error', 'WORKFLOW_MISSING', `The workflow ${String(birth.workflowHash).slice(0, 12)} the run executed is gone from the store`);
    else throw cause;
  }
  if (workflow && run.workflowId !== undefined && run.workflowId !== workflow.id) add('error', 'RUN_IDENTITY_EDITED', `The run record names workflow ${run.workflowId}, not ${workflow.id}`, { changed: ['workflowId'] });

  // 2. Journal rows: each model call event commits to the row it charged.
  const referenced = new Set(), perCall = { bound: 0 };
  if (!journalDb && events.some(e => CALL_EVENTS.has(e.type) && e.journalId != null))
    add(unchecked, 'JOURNAL_EXTERNAL', 'This run journaled its model calls in another database (its birth event says so); pass that database (--journal FILE) to check its responses and the sealed journal root');
  for (const event of events) {
    if (!journalDb || !CALL_EVENTS.has(event.type) || event.journalId == null) continue;
    referenced.add(event.journalId);
    if (!event.journalRowHash) { add('error', 'JOURNAL_UNBOUND', `Event ${event.seq} (${event.type}) charges journal row ${event.journalId} but binds no hash`, { seq: event.seq, journalId: event.journalId }); continue; }
    const raw = journalRow(journalDb, event.journalId);
    if (!raw) { add('error', 'JOURNAL_ROW_MISSING', `Journal row ${event.journalId} (event ${event.seq}, ${event.nodeKey}) is gone`, { seq: event.seq, journalId: event.journalId }); continue; }
    if (raw.run_id !== runId) { add('error', 'JOURNAL_ROW_FOREIGN', `Journal row ${event.journalId} (event ${event.seq}) now belongs to run ${raw.run_id}`, { seq: event.seq, journalId: event.journalId }); continue; }
    const changed = differing(bindRow(raw), { journalRowHash: event.journalRowHash, requestHash: event.requestHash, responseHash: event.responseHash });
    if (changed.length) add('error', 'JOURNAL_ROW_EDITED', `Journal row ${event.journalId} (event ${event.seq}, ${event.nodeKey}) was edited after the chain bound it (${changed.join(', ')})`, { seq: event.seq, journalId: event.journalId, changed });
    else perCall.bound++;
  }

  // 2b. Replayed responses: the runtime checked each against what its recording run's chain committed to, and recorded the outcome
  // (replaySource). Only a recording its run's chain bound (an event of that run charged the row) is verified provenance. Anything else
  // (its run is not in this store, predates the binding, or never charged the row) is unverified: a forged journal row can only enter a run
  // that way. A row its run merely sealed was never used by that run, and a row planted while the run was open is sealed the same way (an
  // earlier engine recorded that case as check 'sealed').
  for (const event of events) {
    if (!CALL_EVENTS.has(event.type) || event.replayed !== true) continue;
    const source = event.replaySource ?? null;
    if (source?.check === 'bound') continue;
    const reason = source?.reason ?? (source?.check === 'sealed' ? `run ${source.runId ?? '?'} only sealed the row; no event of it charged it` : null);
    add(unchecked, 'REPLAY_UNVERIFIED', `Event ${event.seq} (${event.nodeKey}) served a replayed response from journal row ${event.replayedFrom ?? '?'} that nothing verified${reason ? `: ${reason}` : ' (no replay provenance was recorded)'}`,
      { seq: event.seq, journalId: event.journalId ?? null, replayedFrom: event.replayedFrom ?? null });
  }

  // 2c. Cross-run state operations (src/state.mjs): each `state.op` event binds its state_ops row, written in the same commit. So every row of
  // the run is bound by an event, and a row no event binds was written by something other than the runtime. A replayed operation is checked
  // again here, not taken from what its event says about itself (replaySource): the recording row must still be the one the recording run's
  // chain bound, and this run's row must hold that row's replay key and result. The state journal is never external, so anything that cannot
  // be checked is an error.
  const stateEvents = events.filter(e => e.type === 'state.op'), stateBound = new Set(), recordings = new Map();
  // The state.op bindings (opId -> opHash) of a recording run's own (not replayed) operations, from its chain; null when the chain is unusable.
  const recordingBindings = id => {
    if (!recordings.has(id)) {
      let bindings = null;
      try { const chain = store.chain(id); if (!chain.error) bindings = new Map(chain.events.filter(e => e.type === 'state.op' && e.replayed !== true).map(e => [e.opId, e.opHash])); }
      catch (cause) { if (cause.code !== 'NOT_FOUND') throw cause; }
      recordings.set(id, bindings);
    }
    return recordings.get(id);
  };
  for (const event of stateEvents) {
    const where = { seq: event.seq, opId: event.opId ?? null, nodeKey: event.nodeKey };
    const raw = Number.isSafeInteger(event.opId) && store.state ? store.state.rawOp(event.opId) : null;
    if (!raw) { add('error', 'STATE_OP_MISSING', `State operation ${event.opId} (event ${event.seq}, ${event.nodeKey}) is gone from the state journal`, where); continue; }
    stateBound.add(raw.id);
    if (raw.run_id !== runId) { add('error', 'STATE_OP_FOREIGN', `State operation ${event.opId} (event ${event.seq}) now belongs to run ${raw.run_id}`, where); continue; }
    if (stateOpHash(raw) !== event.opHash) add('error', 'STATE_OP_EDITED', `State operation ${event.opId} (event ${event.seq}, ${event.nodeKey}) was edited after the chain bound it`, where);
    if (event.replayed !== true) continue;
    const unverified = reason => add('error', 'STATE_REPLAY_UNVERIFIED', `Event ${event.seq} (${event.nodeKey}) served recorded state operation ${raw.replayed_from ?? event.replayedFrom ?? '?'}, which does not verify: ${reason}`, where);
    if (event.replaySource?.check !== 'bound') { unverified(`the runtime did not verify it${event.replaySource?.reason ? ` (${event.replaySource.reason})` : ''}`); continue; }
    const source = Number.isSafeInteger(raw.replayed_from) && raw.replayed_from === event.replayedFrom ? store.state.rawOp(raw.replayed_from) : null;
    if (!source) { unverified('the recording row is gone, or this run\'s row and event name different recordings'); continue; }
    const bindings = source.replayed_from === null ? recordingBindings(source.run_id) : null;
    if (!bindings) { unverified(`its recording run ${source.run_id} is not in this store, its chain is broken, or the row is itself a replay`); continue; }
    if (!bindings.has(source.id)) { unverified(`the chain of run ${source.run_id} does not bind it`); continue; }
    if (bindings.get(source.id) !== stateOpHash(source)) { unverified(`it was edited after run ${source.run_id} bound it`); continue; }
    if (source.replay_key !== raw.replay_key || source.result !== raw.result) unverified('this run\'s row holds another replay key or result than the recording');
  }
  const stateRows = store.state ? store.state.opsForRun(runId) : [];
  for (const row of stateRows) if (!stateBound.has(row.id)) add('error', 'STATE_OP_UNBOUND', `State operation ${row.id} (${row.nodeKey}, ${row.op} on slot ${row.slot}) is journaled for this run but no chain event binds it`, { opId: row.id, nodeKey: row.nodeKey });
  checks.stateOps = { bound: stateBound.size, rows: stateRows.length };

  // 3. Seals: the journal root and the verdict inputs committed when the run reached a terminal state.
  const seals = events.filter(e => e.type === 'run.verdict');
  for (const seal of seals) {
    if (seal.journalRoot === undefined || seal.verdictInputsHash === undefined) { add('error', 'SEAL_UNBOUND', `Verdict event ${seal.seq} carries no journal root or verdict-input hash`, { seq: seal.seq }); continue; }
    if (!journalDb) continue;
    const now = journalSeal(journalDb, runId, seal.journalMaxId);
    if (now.root !== seal.journalRoot || now.calls !== seal.journalCalls || now.maxId !== seal.journalMaxId)
      add('error', 'JOURNAL_ROOT_MISMATCH', `The journal rows of this run no longer match the root sealed at event ${seal.seq} (${seal.journalCalls} rows sealed, ${now.calls} found)`, { seq: seal.seq, sealed: seal.journalCalls, found: now.calls });
  }
  const last = seals.at(-1), lastIndex = last ? events.indexOf(last) : -1;
  // A final verdict (anything but 'uncertain') closes the run; the seal that did is the run's last legitimate one (see below).
  const closing = seals.find(seal => seal.verdict !== 'uncertain'), closingIndex = closing ? events.indexOf(closing) : -1;
  const lateFrom = (closing ?? last)?.journalMaxId ?? 0;
  const late = (last && journalDb ? journalRowsAfter(journalDb, runId, lateFrom) : []).filter(row => !referenced.has(row.id));
  for (const row of late) add('warn', 'JOURNAL_ROW_LATE', `Journal row ${row.id}${row.error_code ? ` (${row.error_code})` : ''} was written after the run was sealed and no event binds it${replayable(row) ? '; replay lookup could serve it' : ''}`, { journalId: row.id, replayable: replayable(row) });
  // A row the seal covers that no event charged: the run never used that response. A genuine one is rare (a charge lost to a cancellation
  // race, or the copy a refused replay journaled); a row planted under a run while it was still open looks exactly like this, and the
  // seal alone would otherwise vouch for it. Replay does not count a seal as provenance for such a row (Invocation.checkReplay).
  const unreferenced = (last && journalDb ? journalRowsAfter(journalDb, runId, 0) : []).filter(row => row.id <= lateFrom && !referenced.has(row.id));
  for (const row of unreferenced) add(replayable(row) ? 'warn' : 'info', 'JOURNAL_ROW_UNREFERENCED', `Journal row ${row.id}${row.error_code ? ` (${row.error_code})` : ''} is covered by the seal but no event of the run charged it${replayable(row) ? '; replay lookup could serve it, unverified' : ''}`, { journalId: row.id, replayable: replayable(row) });
  checks.journal = { boundCalls: perCall.bound, referencedRows: referenced.size, unreferencedLate: late.length, unreferencedSealed: unreferenced.length };
  checks.seals = seals.length;
  // The runtime seals every terminal state of a bound run in the commit that sets it, so a terminal record without a seal had its tail removed.
  if (TERMINAL.has(run.status) && !last) add('error', 'SEAL_MISSING', `The run is ${run.status} but its chain holds no verdict seal (the tail of its chain was removed, or its status was edited)`);
  // A final verdict (anything but 'uncertain', which reconciliation may resume) closes the run: the runtime never resumes, answers,
  // continues or re-seals it afterwards. The commit that seals it writes one more event (its terminal event); after that only annotations
  // (a decision or a transcript bound later) may follow. Anything else was appended by a writer that is not the runtime, and appending
  // needs no rewrite, so neither the chain nor an anchor taken at the close would show it: a second seal with an edited verdict and
  // edited outputs would otherwise verify clean.
  if (closing) {
    const [terminal, ...after] = events.slice(closingIndex + 1);
    const extended = (event, why) => add('error', ['runner.acquired', 'human.answered'].includes(event.type) ? 'RUN_REOPENED' : 'RUN_EXTENDED',
      `The run was closed with a final verdict (${closing.verdict}) at event ${closing.seq}, but event ${event.seq} (${event.type}) ${why}`, { seq: event.seq, closedAt: closing.seq });
    if (terminal && !CLOSING_EVENTS.has(terminal.type)) extended(terminal, 'follows the seal instead of its terminal event');
    for (const event of after) {
      if (event.type === 'decision.recorded') add('warn', 'BOUND_AFTER_CLOSE', `Decision ${event.id} was bound at event ${event.seq}, after the run closed at event ${closing.seq}: the run did not make it`, { seq: event.seq, id: event.id });
      else if (event.type === 'executor.finished') add('info', 'BOUND_AFTER_CLOSE', `A transcript of ${event.nodeKey} was bound at event ${event.seq}, after the run closed at event ${closing.seq}`, { seq: event.seq });
      else extended(event, 'continues it');
    }
  }

  // The current seal: the one that closed the run, whatever follows it or the record's status now says (a closed run cannot change);
  // otherwise the last 'uncertain' one while the run is terminal and has not been resumed since (a resume appends runner.acquired).
  const current = closing ?? (!last ? null
    : TERMINAL.has(run.status) && !events.slice(lastIndex + 1).some(e => e.type === 'runner.acquired') ? last : null);
  if (current && current.verdictInputsHash !== undefined) {
    const inputsMatch = verdictInputsHash(run) === current.verdictInputsHash;
    if (!inputsMatch) add('error', 'VERDICT_INPUTS_MISMATCH', `The run record (status, error, node states or outputs) differs from the state its verdict was sealed on at event ${current.seq}`, { seq: current.seq });
    const stored = run.verdict ?? null;
    const framing = new Set(['type', 'seq', 'at', 'previousHash', 'hash', 'journalRoot', 'journalCalls', 'journalMaxId', 'boardRoot', 'verdictInputsHash']);
    const edited = stored ? [...new Set([...Object.keys(stored), ...Object.keys(current)])].filter(key => !framing.has(key) && digest(stored[key] ?? null) !== digest(current[key] ?? null)) : ['verdict'];
    if (edited.length) add('error', 'VERDICT_EDITED', `The run's stored verdict differs from the verdict sealed in the chain at event ${current.seq} (${edited.join(', ')})`, { seq: current.seq, changed: edited });
    else if (inputsMatch) {
      // Informational unless the engine is unchanged: a later engine may grade the same evidence differently.
      // The engine identity comes from the chain (birth event and recorded migrations), not the (editable) run record.
      const sameEngine = engines.valid && engines.hash === engineHash;
      let recomputed = null;
      if (workflow) try { recomputed = verdictOf(run, { workflow }); } catch (cause) { add('warn', 'VERDICT_NOT_RECOMPUTED', `The verdict could not be recomputed: ${cause.code ?? cause.message}`); }
      if (recomputed && ['verdict', 'code', 'authority'].some(key => (recomputed[key] ?? null) !== (current[key] ?? null)))
        add(sameEngine ? 'error' : 'warn', 'VERDICT_RECOMPUTE_DIFFERS', `Recomputing the verdict from the recorded state gives ${recomputed.verdict} (${recomputed.code ?? 'no code'}), not the sealed ${current.verdict} (${current.code ?? 'no code'})${sameEngine ? '' : '; the engine changed since the run'}`, { seq: current.seq });
    }
  }

  // 4. Decisions: every stored decision row is hashed in a decision.recorded event, and every such event still has its row.
  const recorded = new Map(events.filter(e => e.type === 'decision.recorded').map(e => [e.id, e]));
  const rows = store.decisionRows(runId), seen = new Set();
  for (const row of rows) {
    const event = recorded.get(row.id);
    seen.add(row.id);
    if (!event) { add('error', 'DECISION_UNBOUND', `Decision ${row.id} (${row.kind}) is stored for this run but no chain event binds it`, { id: row.id }); continue; }
    let body = null;
    try { body = JSON.parse(row.body); } catch { /* reported as edited */ }
    if (sha256(row.body) !== event.decisionHash || body?.id !== row.id || body?.kind !== event.kind || row.kind !== event.kind) add('error', 'DECISION_EDITED', `Decision ${row.id} was edited after event ${event.seq} bound it`, { id: row.id, seq: event.seq });
  }
  for (const [id, event] of recorded) if (!seen.has(id)) add('error', 'DECISION_MISSING', `Decision ${id} (event ${event.seq}) is gone`, { id, seq: event.seq });
  checks.decisions = { bound: recorded.size, rows: rows.length };

  // 5. Executor transcripts, by hash.
  // The location comes from an event, which any writer can append: only a regular file of bounded size is read (never a device, FIFO
  // or symlink), and a workspace copy must resolve inside the workspace state directory.
  const transcripts = events.filter(e => e.type === 'executor.finished'), workspaceRoot = store.directory;
  for (const event of transcripts) {
    const where = { seq: event.seq, nodeKey: event.nodeKey };
    if (typeof event.transcriptHash !== 'string' || !HEX64.test(event.transcriptHash)) { add('error', 'TRANSCRIPT_UNBOUND', `Event ${event.seq} (executor.finished) binds no transcript hash`, where); continue; }
    const kind = event.location?.kind, recorded = typeof event.location?.path === 'string' ? event.location.path : null;
    const file = !recorded ? null : kind === 'workspace' ? path.resolve(workspaceRoot, recorded) : path.resolve(recorded);
    if (kind === 'workspace' && file && !file.startsWith(workspaceRoot + path.sep)) { add('error', 'TRANSCRIPT_LOCATION', `Transcript of ${event.nodeKey} (event ${event.seq}) names a workspace copy outside the workspace state directory`, where); continue; }
    let info = null;
    try { info = file ? lstatSync(file) : null; } catch { /* missing */ }
    if (!info) { add(kind === 'workspace' ? 'error' : unchecked, kind === 'workspace' ? 'TRANSCRIPT_MISSING' : 'TRANSCRIPT_UNCHECKED', `Transcript of ${event.nodeKey} (event ${event.seq}) is not at ${recorded ?? 'its recorded location'}; its hash ${event.transcriptHash.slice(0, 12)} is bound but could not be re-checked`, where); continue; }
    if (!info.isFile() || info.size > TRANSCRIPT_MAX_BYTES || (kind === 'workspace' && !realpathSync(file).startsWith(workspaceRoot + path.sep))) {
      add(kind === 'workspace' ? 'error' : unchecked, kind === 'workspace' ? 'TRANSCRIPT_EDITED' : 'TRANSCRIPT_UNCHECKED', `Transcript of ${event.nodeKey} (event ${event.seq}) is not a regular file of at most ${TRANSCRIPT_MAX_BYTES} bytes at ${recorded}; it was not read`, where);
      continue;
    }
    if (sha256(readFileSync(file)) !== event.transcriptHash) add('error', 'TRANSCRIPT_EDITED', `Transcript of ${event.nodeKey} (event ${event.seq}) no longer matches the hash the chain bound`, where);
  }
  checks.transcripts = { bound: transcripts.length };

  // 6. The checkpoint's node outputs against the chain: every output equals what the node.completed (or human.answered) event recorded.
  const completed = new Map(), answered = new Map();
  for (const event of events) {
    if (event.type === 'node.completed' || event.type === 'node.handled_error') completed.set(event.nodeKey, event.outputHash);
    else if (event.type === 'human.answered') answered.set(event.nodeKey, event.answerHash);
  }
  let compared = 0;
  const frames = [['root', run], ...Object.entries(run.frames ?? {})];
  for (const [frameKey, frame] of frames) {
    for (const [id, output] of Object.entries(frame.outputs ?? {})) {
      const nodeKey = `${frameKey}/${id}`, expected = completed.get(nodeKey), answer = answered.get(nodeKey);
      const actual = expected !== undefined ? digest(output) : answer !== undefined ? digest(output?.answer) : null;
      compared++;
      if (actual === null) add('error', 'STATE_OUTPUT_UNBOUND', `The run record holds an output for ${nodeKey} that no chain event produced`, { nodeKey });
      else if (actual !== (expected ?? answer)) add('error', 'STATE_OUTPUT_EDITED', `The output of ${nodeKey} in the run record differs from what the chain recorded`, { nodeKey });
      const stateHash = frame.nodes?.[id]?.outputHash;
      if (expected !== undefined && stateHash !== undefined && stateHash !== expected) add('error', 'STATE_OUTPUT_EDITED', `The output hash of ${nodeKey} in the run record differs from what the chain recorded`, { nodeKey });
    }
  }
  // 6b. Approvals: the record's copy of each request and of the user's decision against approval.requested / approval.decided. The runtime
  // gates an effect on the chain's decision (Invocation.approvedInChain), so an edited record cannot fire one; this reports the edit.
  const requests = new Map(), decided = new Map();
  for (const event of events) {
    if (event.type === 'approval.requested') requests.set(event.approvalId, event);
    else if (event.type === 'approval.decided') decided.set(event.approvalId, event);
  }
  const approvals = run.approvals && typeof run.approvals === 'object' ? run.approvals : {};
  for (const [id, approval] of Object.entries(approvals)) {
    const request = requests.get(id), decision = decided.get(id);
    if (!request) { add('error', 'APPROVAL_UNBOUND', `The run record holds approval ${id.slice(0, 12)} that no approval.requested event made`, { approvalId: id }); continue; }
    const expected = decision ? (decision.approved === true ? 'approved' : 'rejected') : 'pending', changed = [];
    if (approval?.status !== expected) changed.push('status');
    if (decision && approval?.actor !== decision.actor) changed.push('actor');
    if (approval?.tool !== request.tool) changed.push('tool');
    if (digest(approval?.args ?? null) !== request.argsHash) changed.push('args');
    if (Object.hasOwn(request, 'argsLabel') && ((approval?.argsLabel ?? 'trusted') !== request.argsLabel || (approval?.controlLabel ?? 'trusted') !== request.controlLabel)) changed.push('labels');
    if (changed.length) add('error', 'APPROVAL_EDITED', `Approval ${id.slice(0, 12)} in the run record differs from its chain events (${changed.join(', ')})`, { approvalId: id, changed });
  }
  for (const [id, event] of requests) if (!Object.hasOwn(approvals, id)) add('error', 'APPROVAL_MISSING', `Approval ${String(id).slice(0, 12)} (event ${event.seq}) is gone from the run record`, { approvalId: id, seq: event.seq });
  checks.state = { outputsCompared: compared, approvalsCompared: Object.keys(approvals).length };

  // 6c. Signal waits (src/signals.mjs): every decision re-derived from the chain alone (which signal a wait took, which wait a delivery
  // went to, when a timeout was due, what the completed wait output), against what the chain recorded; and the record's inbox and wait
  // decisions against the chain. A re-derived decision that differs is an error on the engine that recorded it (the rule is a pure function
  // of the chain), a warning on another (a later engine may decide differently). Read-only.
  const replay = replayWaits(events);
  // The waits were decided by every engine the run ran under: an error only when that was this engine throughout.
  const onlyThisEngine = engines.valid && engines.engines.every(hash => hash === engineHash);
  for (const miss of replay.mismatches) add(onlyThisEngine ? 'error' : 'warn', 'WAIT_REPLAY_MISMATCH', `Event ${miss.seq}${miss.nodeKey ? ` (${miss.nodeKey})` : ''}: ${miss.message} [${miss.code}]`, { seq: miss.seq, nodeKey: miss.nodeKey, rule: miss.code });
  for (const drift of signalCheckpointDrift(run, events)) add('error', 'SIGNAL_EDITED', `The run record's ${drift} differs from what its chain recorded`, { drift });
  checks.waits = { waits: replay.waits, deliveries: replay.deliveries, decisions: replay.decisions, mismatches: replay.mismatches.length };
  return result();
}
