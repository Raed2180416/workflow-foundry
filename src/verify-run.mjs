// `foundry verify-run RUN` (07 §4.4 item 5, R-21): recompute everything the run's hash chain binds (src/audit.mjs) and report
// what no longer matches. Read-only. A finding is an error (evidence was edited, removed or never bound), a warning (evidence is
// unchecked, or not committed by the chain) or info. `ok` means no errors; `clean` means no errors and no warnings.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { digest } from './data.mjs';
import { AUDIT, anchorOfEvents, bindRow, journalRow, journalRowsAfter, journalSeal, sha256, verdictInputsHash } from './audit.mjs';
import { REPLAYABLE_ERRORS } from './journal.mjs';
import { verdictOf } from './verdict.mjs';
import { engineHash } from './engine.mjs';

const CALL_EVENTS = new Set(['model.called', 'node.recovered_from_journal', 'model.cancelled']);
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'uncertain']);
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
  const external = events[0]?.journal === 'external';
  const journalDb = given ?? (external ? null : store.db);
  const checks = { chain: error ? 'broken' : 'ok', events: events.length, journal: null, decisions: null, transcripts: null, seals: null, state: null };
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
  const birth = events[0], identity = [];
  const same = (name, actual, expected) => { if (expected !== undefined && (actual ?? null) !== (expected ?? null)) identity.push(name); };
  same('workflowHash', run.workflowHash, birth.workflowHash);
  same('registryHash', run.registryHash, birth.registryHash);
  same('engineHash', run.engineHash, birth.engineHash);
  same('input', digest(run.input ?? null), birth.inputHash);
  same('policy', digest(run.policy ?? null), birth.policyHash);
  if (Object.hasOwn(birth, 'modelPolicyHash')) {
    for (const key of ['modelPolicyHash', 'modelMode', 'sampleSalt', 'assignmentHash']) same(key, run[key], birth[key]);
    if (birth.assignmentHash != null) same('assignment', digest(run.assignment ?? null), birth.assignmentHash);
    same('identity', run.identity ? digest(run.identity) : null, birth.identityHash);
  }
  if (identity.length) add('error', 'RUN_IDENTITY_EDITED', `The run record no longer matches its birth event (${identity.join(', ')})`, { changed: identity });
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
  // (replaySource). A response whose recording could not be checked (its run is not in this store, predates the binding or never
  // sealed the row) is unverified provenance: a forged journal row can only enter a run that way.
  for (const event of events) {
    if (!CALL_EVENTS.has(event.type) || event.replayed !== true) continue;
    const source = event.replaySource ?? null;
    if (source?.check === 'bound' || source?.check === 'sealed') continue;
    add(unchecked, 'REPLAY_UNVERIFIED', `Event ${event.seq} (${event.nodeKey}) served a replayed response from journal row ${event.replayedFrom ?? '?'} that nothing verified${source?.reason ? `: ${source.reason}` : ' (no replay provenance was recorded)'}`,
      { seq: event.seq, journalId: event.journalId ?? null, replayedFrom: event.replayedFrom ?? null });
  }

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
  const lateFrom = last?.journalMaxId ?? 0;
  const late = (last && journalDb ? journalRowsAfter(journalDb, runId, lateFrom) : []).filter(row => !referenced.has(row.id));
  for (const row of late) add('warn', 'JOURNAL_ROW_LATE', `Journal row ${row.id}${row.error_code ? ` (${row.error_code})` : ''} was written after the run was sealed and no event binds it${replayable(row) ? '; replay lookup could serve it' : ''}`, { journalId: row.id, replayable: replayable(row) });
  checks.journal = { boundCalls: perCall.bound, referencedRows: referenced.size, unreferencedLate: late.length };
  checks.seals = seals.length;
  // The runtime seals every terminal state of a bound run in the commit that sets it, so a terminal record without a seal had its tail removed.
  if (TERMINAL.has(run.status) && !last) add('error', 'SEAL_MISSING', `The run is ${run.status} but its chain holds no verdict seal (the tail of its chain was removed, or its status was edited)`);
  // A final verdict (anything but 'uncertain', which reconciliation may resume) closes the run: the runtime never resumes, answers or
  // continues it afterwards. Events that continue it mean the record was edited to reopen it (or a writer raced the seal).
  const closing = seals.find(seal => seal.verdict !== 'uncertain');
  const reopened = closing ? events.slice(events.indexOf(closing) + 1).find(e => e.type === 'runner.acquired' || e.type === 'human.answered') : null;
  if (reopened) add('error', 'RUN_REOPENED', `The run was closed with a final verdict (${closing.verdict}) at event ${closing.seq}, but event ${reopened.seq} (${reopened.type}) continues it`, { seq: reopened.seq, closedAt: closing.seq });

  // The current seal is the last one. A final seal stays current whatever the record's status now says (a closed run's status cannot
  // change); an 'uncertain' one is current while the run is terminal and has not been resumed since (a resume appends runner.acquired).
  const current = !last ? null : last.verdict !== 'uncertain' ? last
    : TERMINAL.has(run.status) && !events.slice(lastIndex + 1).some(e => e.type === 'runner.acquired') ? last : null;
  if (current && current.verdictInputsHash !== undefined) {
    const inputsMatch = verdictInputsHash(run) === current.verdictInputsHash;
    if (!inputsMatch) add('error', 'VERDICT_INPUTS_MISMATCH', `The run record (status, error, node states or outputs) differs from the state its verdict was sealed on at event ${current.seq}`, { seq: current.seq });
    const stored = run.verdict ?? null;
    const framing = new Set(['type', 'seq', 'at', 'previousHash', 'hash', 'journalRoot', 'journalCalls', 'journalMaxId', 'boardRoot', 'verdictInputsHash']);
    const edited = stored ? [...new Set([...Object.keys(stored), ...Object.keys(current)])].filter(key => !framing.has(key) && digest(stored[key] ?? null) !== digest(current[key] ?? null)) : ['verdict'];
    if (edited.length) add('error', 'VERDICT_EDITED', `The run's stored verdict differs from the verdict sealed in the chain at event ${current.seq} (${edited.join(', ')})`, { seq: current.seq, changed: edited });
    else if (inputsMatch) {
      // Informational unless the engine is unchanged: a later engine may grade the same evidence differently.
      // The engine identity comes from the birth event, not the (editable) run record.
      const sameEngine = birth.engineHash === engineHash;
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
  const transcripts = events.filter(e => e.type === 'executor.finished'), workspaceRoot = store.directory;
  for (const event of transcripts) {
    const file = event.location?.kind === 'workspace' ? path.join(workspaceRoot, event.location.path) : event.location?.path;
    if (!file || !existsSync(file)) { add(event.location?.kind === 'workspace' ? 'error' : unchecked, event.location?.kind === 'workspace' ? 'TRANSCRIPT_MISSING' : 'TRANSCRIPT_UNCHECKED', `Transcript of ${event.nodeKey} (event ${event.seq}) is not at ${event.location?.path ?? 'its recorded location'}; its hash ${event.transcriptHash.slice(0, 12)} is bound but could not be re-checked`, { seq: event.seq, nodeKey: event.nodeKey }); continue; }
    if (sha256(readFileSync(file)) !== event.transcriptHash) add('error', 'TRANSCRIPT_EDITED', `Transcript of ${event.nodeKey} (event ${event.seq}) no longer matches the hash the chain bound`, { seq: event.seq, nodeKey: event.nodeKey });
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
  checks.state = { outputsCompared: compared };
  return result();
}
