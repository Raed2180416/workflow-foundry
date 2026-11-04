// Foundry memory model, $0 prototype (research/memory-20261021/MEMORY-MODEL.md). Development code for the MEM-0b battery and
// the MEM-1 experiment; it is NOT wired into src/runtime.mjs (ROADMAP §6 rule 12: no new subsystem before the preregistered
// experiment that needs it) and it is not in src/engine.mjs's identity list, so it changes no engine hash.
//
// Four scopes, each with one rule for who writes, who reads, how long it lives and what label it carries:
//   node     Scratch: a node attempt's private notes. Free inside the node; they leave only through the node's typed output, or as
//            a full fork for repair or escalation under a receipt. Never read by siblings, parents or later runs.
//   run      Board: typed topics for one run. Each topic declares a schema, a reducer, its writers, its readers, an integrity label
//            ceiling, a confidentiality level and quotas. Append-only, hash-chained events; a deterministic kernel validates every
//            write and records refusals; reads are folds at a pinned sequence number, so a replay sees byte-identical views.
//   version  VersionNotes: immutable lessons bound to one workflow version and one fingerprint (model ids, policy, engine). Only
//            the promotion ladder admits a note, with replay evidence on runs disjoint from the ones it was mined from. A new note
//            makes a new version hash. A fingerprint change sends every note to shadow (not served).
//   org      OrgMemoryPort: AMP's claims, read through a byte-budgeted, bi-temporal, receipted query. Foundry may propose a claim;
//            it never writes one.
//
// Labels come only from the kernel's metadata, never from the data: a value that carries its own `label` or `security_label`
// field is data like any other (the label-forging failure APIsec found in Microsoft's FIDES middleware, 2026).
import { canonical, checkData, clone, digest, FoundryError } from '../../src/data.mjs';
import { checkLabel, estimateTokens, joinLabels } from '../../src/context.mjs';
import { validateData } from '../../src/validate.mjs';

export const MEMORY_MODEL = 'foundry-memory/1';
export const REDUCERS = Object.freeze(['append', 'lww', 'setUnion', 'max', 'counter']);
export const CONFIDENTIALITY = Object.freeze(['public', 'internal', 'secret']);
export const REFUSALS = Object.freeze(['BOARD_TOPIC', 'BOARD_WRITER', 'BOARD_LABEL', 'BOARD_CONFIDENTIALITY', 'BOARD_SIZE', 'BOARD_SCHEMA',
  'BOARD_FULL', 'BOARD_QUOTA', 'BOARD_STALE', 'BOARD_VALUE']);
export const LIMITS = Object.freeze({ topics: 32, maxEvents: 100000, maxEventBytes: 64 * 1024, defaultEventBytes: 4096, defaultViewTokens: 2000 });
const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const GENESIS = 'genesis';

const fail = (code, message, details) => { throw new FoundryError(code, message, details); };
const bytes = value => Buffer.byteLength(canonical(value), 'utf8');
const rank = level => { const r = CONFIDENTIALITY.indexOf(level); if (r < 0) fail('MEMORY_CONFIDENTIALITY', `Unknown confidentiality level: ${String(level)}`); return r; };
export const joinConfidentiality = levels => CONFIDENTIALITY[Math.max(0, ...levels.map(rank))];
const sourcesOf = label => checkLabel(label) === 'trusted' ? [] : label.slice('untrusted:'.length).split('+');
/** Integrity order: `from` may flow into a container labelled `to` when every untrusted source of `from` is one `to` admits. */
export const flowsTo = (from, to) => { const allowed = new Set(sourcesOf(to)); return sourcesOf(from).every(s => allowed.has(s)); };

// ------------------------------------------------------------------ declaration (static, before any run)

/**
 * Checks and freezes a board declaration: {topics: {name: {schema?, reducer, key?, writers, readers, label?, confidentiality?,
 * maxEvents, maxEventsPerWriter?, maxEventBytes?, maxViewTokens?}}, clearance?: {nodeId: level}}. Returns it with `declHash`.
 * Declarations are code-owned (the workflow author or the construction ladder writes them); a model never chooses at run time
 * what it may read or write.
 */
export function defineBoard(spec, { nodes } = {}) {
  if (!spec || typeof spec !== 'object' || !spec.topics || typeof spec.topics !== 'object') fail('BOARD_DECL', 'A board needs a topics object');
  const known = nodes ? new Set(nodes) : null;
  const names = Object.keys(spec.topics);
  if (!names.length || names.length > LIMITS.topics) fail('BOARD_DECL', `A board declares 1..${LIMITS.topics} topics`);
  const topics = {};
  for (const name of names.sort()) {
    const t = spec.topics[name];
    if (!NAME.test(name)) fail('BOARD_DECL', `Bad topic name: ${name}`);
    if (!REDUCERS.includes(t.reducer)) fail('BOARD_DECL', `Topic ${name}: reducer must be one of ${REDUCERS.join(', ')}`);
    if (t.reducer === 'lww' && (typeof t.key !== 'string' || !t.key)) fail('BOARD_DECL', `Topic ${name}: an lww topic names the key field of its values`);
    for (const role of ['writers', 'readers']) {
      if (!Array.isArray(t[role]) || !t[role].length || !t[role].every(id => typeof id === 'string' && id)) fail('BOARD_DECL', `Topic ${name}: ${role} must be a non-empty list of node ids`);
      if (known) for (const id of t[role]) if (!known.has(id)) fail('BOARD_DECL', `Topic ${name}: ${role} names unknown node ${id}`);
    }
    if (!Number.isSafeInteger(t.maxEvents) || t.maxEvents < 1 || t.maxEvents > LIMITS.maxEvents) fail('BOARD_DECL', `Topic ${name}: maxEvents is required (1..${LIMITS.maxEvents})`);
    const maxEventsPerWriter = t.maxEventsPerWriter ?? t.maxEvents;
    if (!Number.isSafeInteger(maxEventsPerWriter) || maxEventsPerWriter < 1 || maxEventsPerWriter > t.maxEvents) fail('BOARD_DECL', `Topic ${name}: maxEventsPerWriter must be 1..maxEvents`);
    const maxEventBytes = t.maxEventBytes ?? LIMITS.defaultEventBytes;
    if (!Number.isSafeInteger(maxEventBytes) || maxEventBytes < 1 || maxEventBytes > LIMITS.maxEventBytes) fail('BOARD_DECL', `Topic ${name}: maxEventBytes must be 1..${LIMITS.maxEventBytes}`);
    const label = checkLabel(t.label ?? 'trusted'), confidentiality = t.confidentiality ?? 'public'; rank(confidentiality);
    if (t.schema !== undefined) { checkData(t.schema); compileProbe(t.schema); }
    topics[name] = Object.freeze({ reducer: t.reducer, key: t.key ?? null, schema: t.schema ?? null, writers: Object.freeze([...t.writers].sort()),
      readers: Object.freeze([...t.readers].sort()), label, confidentiality, maxEvents: t.maxEvents, maxEventsPerWriter, maxEventBytes,
      maxViewTokens: t.maxViewTokens ?? LIMITS.defaultViewTokens });
  }
  const clearance = {};
  for (const [id, level] of Object.entries(spec.clearance ?? {}).sort(([a], [b]) => a.localeCompare(b))) { rank(level); clearance[id] = level; }
  const decl = { model: MEMORY_MODEL, topics, clearance };
  return Object.freeze({ ...decl, declHash: digest(decl) });
}
// Compiles a topic schema at declaration time: a schema that does not compile is a declaration error, not a run-time refusal.
// (validateData compiles, then tests a probe value; the probe failing its schema is expected and ignored.)
function compileProbe(schema) { try { validateData(schema, null, 'probe'); } catch (e) { if (e.code !== 'SCHEMA_MISMATCH') fail('BOARD_DECL', `Topic schema does not compile: ${e.message}`); } }

// ------------------------------------------------------------------ fold state (shared by views and checkpoints)

const emptyState = reducer => ({ reducer, count: 0, perWriter: {}, labels: [], confidentiality: 'public',
  ...(reducer === 'append' ? { items: [] } : reducer === 'lww' ? { entries: {} } : reducer === 'setUnion' ? { members: {} } : reducer === 'max' ? { best: null } : { total: 0 }) });

function applyEvent(state, e, topic) {
  state.count++; state.perWriter[e.writer] = (state.perWriter[e.writer] ?? 0) + 1;
  if (e.label !== 'trusted' && !state.labels.includes(e.label)) state.labels.push(e.label);
  state.confidentiality = joinConfidentiality([state.confidentiality, e.confidentiality]);
  if (state.reducer === 'append') state.items.push({ seq: e.seq, writer: e.writer, value: e.value });
  else if (state.reducer === 'lww') { const k = String(e.value[topic.key]); state.entries[k] = { seq: e.seq, writer: e.writer, value: e.value }; }
  else if (state.reducer === 'setUnion') {
    const k = canonical(e.value), m = state.members[k] ?? (state.members[k] = { value: e.value, firstSeq: e.seq, supporters: [] });
    m.supporters.push({ seq: e.seq, writer: e.writer, sources: e.sources });
  } else if (state.reducer === 'max') { if (state.best === null || e.value > state.best.value) state.best = { seq: e.seq, writer: e.writer, value: e.value }; }
  else state.total += e.value;
  return state;
}
const viewValue = state => state.reducer === 'append' ? state.items.map(i => i.value)
  : state.reducer === 'lww' ? Object.fromEntries(Object.entries(state.entries).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, v.value]))
  : state.reducer === 'setUnion' ? Object.keys(state.members).sort().map(k => state.members[k].value)
  : state.reducer === 'max' ? (state.best?.value ?? null) : state.total;

// ------------------------------------------------------------------ the run board

export class Board {
  /** `decl` from defineBoard; `runId` names the run (a board never outlives it). */
  constructor(decl, { runId }) {
    if (!decl?.declHash || decl.model !== MEMORY_MODEL) fail('BOARD_DECL', 'Board needs a declaration from defineBoard');
    if (typeof runId !== 'string' || !runId) fail('BOARD_DECL', 'Board needs a runId');
    this.decl = decl; this.runId = runId; this.seq = 0; this.events = []; this.refusals = []; this.base = 0;
    this.head = digest({ model: MEMORY_MODEL, declHash: decl.declHash, runId, genesis: GENESIS });
    this.checkpoint = null; this.states = Object.fromEntries(Object.entries(decl.topics).map(([n, t]) => [n, emptyState(t.reducer)]));
  }

  /**
   * Proposes one write. Returns {ok: true, seq, hash} or {ok: false, code, message}. A refusal changes no state and is kept in
   * `refusals` (with the head it was evaluated against), so the audit shows what was attempted, by whom, and why it was refused.
   * meta: {label = 'trusted', confidentiality = 'public', sources = [], expectSeq (lww: the key's version the writer read; 0 = absent)}.
   * The label and confidentiality are the writer's own (the runtime computes them from the writer's inputs); never read from `value`.
   */
  write(writer, topicName, value, meta = {}) {
    const refuse = (code, message) => { const r = { ok: false, code, message, writer, topic: topicName, at: this.seq, head: this.head, valueHash: safeDigest(value) }; this.refusals.push(r); return r; };
    const topic = this.decl.topics[topicName];
    if (!topic) return refuse('BOARD_TOPIC', `No topic ${String(topicName)}`);
    if (!topic.writers.includes(writer)) return refuse('BOARD_WRITER', `${writer} is not a declared writer of ${topicName}`);
    let label, confidentiality;
    try { label = joinLabels([meta.label ?? 'trusted']); confidentiality = meta.confidentiality ?? 'public'; rank(confidentiality); } catch (e) { return refuse('BOARD_LABEL', e.message); }
    if (!flowsTo(label, topic.label)) return refuse('BOARD_LABEL', `${topicName} admits ${topic.label}; this write carries ${label}`);
    if (rank(confidentiality) > rank(topic.confidentiality)) return refuse('BOARD_CONFIDENTIALITY', `${topicName} is ${topic.confidentiality}; this write carries ${confidentiality} data`);
    try { checkData(value, { maxBytes: topic.maxEventBytes + 1 }); } catch (e) { return refuse('BOARD_SIZE', e.message); }
    if (bytes(value) > topic.maxEventBytes) return refuse('BOARD_SIZE', `${topicName} events are at most ${topic.maxEventBytes} bytes`);
    if (topic.schema) { try { validateData(topic.schema, value, `${topicName} event`); } catch (e) { return refuse('BOARD_SCHEMA', e.message); } }
    const state = this.states[topicName];
    if (state.count >= topic.maxEvents) return refuse('BOARD_FULL', `${topicName} holds at most ${topic.maxEvents} events`);
    if ((state.perWriter[writer] ?? 0) >= topic.maxEventsPerWriter) return refuse('BOARD_QUOTA', `${writer} may write at most ${topic.maxEventsPerWriter} events to ${topicName}`);
    if ((topic.reducer === 'max' || topic.reducer === 'counter') && !(typeof value === 'number' && (topic.reducer === 'max' ? Number.isFinite(value) : Number.isSafeInteger(value))))
      return refuse('BOARD_VALUE', `${topicName} (${topic.reducer}) takes ${topic.reducer === 'max' ? 'a finite number' : 'a safe integer delta'}`);
    if (topic.reducer === 'counter' && !Number.isSafeInteger(state.total + value)) return refuse('BOARD_VALUE', `${topicName} would overflow`);
    if (topic.reducer === 'lww') {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !['string', 'number'].includes(typeof value[topic.key])) return refuse('BOARD_VALUE', `${topicName} values are objects with a string or number ${topic.key}`);
      const current = state.entries[String(value[topic.key])]?.seq ?? 0;
      if (meta.expectSeq !== current) return refuse('BOARD_STALE', `${topicName}[${value[topic.key]}] is at version ${current}; the writer read ${meta.expectSeq === undefined ? 'nothing (expectSeq is required)' : meta.expectSeq}`);
    }
    const sources = [...new Set(meta.sources ?? [])].map(String).sort();
    const event = { seq: this.seq + 1, topic: topicName, writer, value: clone(value), valueHash: digest(value), label, confidentiality, sources, prev: this.head };
    const hash = digest(event);
    this.events.push({ ...event, hash }); this.seq = event.seq; this.head = hash;
    applyEvent(state, this.events.at(-1), topic);
    return { ok: true, seq: event.seq, hash };
  }

  /** The version of an lww key at `atSeq` (0 when absent): what a writer passes as expectSeq. */
  version(topicName, key, atSeq = this.seq) { return this.#fold(topicName, atSeq).entries?.[String(key)]?.seq ?? 0; }

  #fold(topicName, atSeq) {
    const topic = this.decl.topics[topicName];
    if (!topic) fail('BOARD_TOPIC', `No topic ${String(topicName)}`);
    if (!Number.isSafeInteger(atSeq) || atSeq < 0 || atSeq > this.seq) fail('BOARD_SEQ', `Sequence ${atSeq} is outside 0..${this.seq}`);
    if (atSeq < this.base) fail('BOARD_COMPACTED', `Sequence ${atSeq} was compacted (base ${this.base}); read the archive`);
    if (atSeq === this.seq) return this.states[topicName];
    const state = this.checkpoint ? clone(this.checkpoint.states[topicName]) : emptyState(topic.reducer);
    for (const e of this.events) { if (e.seq > atSeq) break; if (e.topic === topicName) applyEvent(state, e, topic); }
    return state;
  }

  /**
   * A reader's view of one topic at `atSeq` (default: now). Refused (thrown, it is a workflow defect, not data) when the reader is not
   * declared or lacks clearance. The view's label is the join of every accepted event's label in the topic (conservative: which value
   * won can depend on every write), and its confidentiality is the highest written.
   */
  view(reader, topicName, { atSeq = this.seq } = {}) {
    const topic = this.decl.topics[topicName];
    if (!topic) fail('BOARD_TOPIC', `No topic ${String(topicName)}`);
    if (!topic.readers.includes(reader)) fail('BOARD_READER', `${reader} is not a declared reader of ${topicName}`);
    const clearance = this.decl.clearance[reader] ?? 'public';
    if (rank(clearance) < rank(topic.confidentiality)) fail('BOARD_CLEARANCE', `${topicName} is ${topic.confidentiality}; ${reader} is cleared for ${clearance}`);
    const state = this.#fold(topicName, atSeq), value = clone(viewValue(state));
    const label = joinLabels(['trusted', ...state.labels]);
    return { topic: topicName, atSeq, value, label, confidentiality: state.confidentiality, events: state.count, valueHash: digest(value) };
  }

  /**
   * Board reads as context-compiler inputs (src/context.mjs compileContext({inputs})): one per spec {topic, as?, maxTokens?, priority?},
   * all at ONE sequence number, so the receipt's sourceRef (board:<topic>@<seq>) and sourceHash pin exactly what the node saw. The
   * view is refused when it is over its topic's token cap rather than silently cut (a cut view could drop the item that matters).
   */
  readsFor(reader, specs, { atSeq = this.seq } = {}) {
    const views = specs.map(spec => [spec, this.view(reader, spec.topic, { atSeq })]);
    const inputs = views.map(([spec, v]) => {
      const cap = Math.min(spec.maxTokens ?? Infinity, this.decl.topics[spec.topic].maxViewTokens), tokens = estimateTokens(canonical(v.value));
      if (tokens > cap) fail('BOARD_VIEW_BUDGET', `${spec.topic} at ${atSeq} needs ~${tokens} tokens; the cap is ${cap}`, { tokens, cap });
      return { name: spec.as ?? spec.topic, value: v.value, label: v.label, render: 'json', maxTokens: cap, priority: spec.priority ?? 0, sourceRef: `board:${spec.topic}@${atSeq}` };
    });
    return { atSeq, inputs, confidentiality: joinConfidentiality(views.map(([, v]) => v.confidentiality)) };
  }

  /**
   * How many independent supporters a setUnion member has at `atSeq`: supporting events by distinct writers whose ancestry (sources,
   * followed through `event:<seq>` references) contains no other supporting event. A "confirmation" written after reading the claim
   * is an echo, not a second source (A-MemGuard's self-reinforcing loop; Mesh Memory Protocol's echo recognition).
   */
  independentSupport(reader, topicName, member, { atSeq = this.seq } = {}) {
    this.view(reader, topicName, { atSeq });
    if (this.decl.topics[topicName].reducer !== 'setUnion') fail('BOARD_TOPIC', `${topicName} is not a setUnion topic`);
    const m = this.#fold(topicName, atSeq).members[canonical(member)];
    if (!m) return { supporters: 0, independent: 0, echoes: 0 };
    const bySeq = new Map(this.events.map(e => [e.seq, e]));
    const ancestors = seq => {
      const seen = new Set(), stack = [seq];
      while (stack.length) for (const s of bySeq.get(stack.pop())?.sources ?? []) {
        const n = /^event:(\d+)$/.exec(s); if (n && !seen.has(+n[1])) { seen.add(+n[1]); stack.push(+n[1]); }
      }
      return seen;
    };
    const supporting = new Set(m.supporters.map(s => s.seq)), writers = new Set();
    let independent = 0;
    for (const s of m.supporters) {
      const anc = ancestors(s.seq);
      if ([...supporting].some(o => o !== s.seq && anc.has(o)) || writers.has(s.writer)) continue;
      writers.add(s.writer); independent++;
    }
    return { supporters: m.supporters.length, independent, echoes: m.supporters.length - independent };
  }

  /**
   * Fold compaction at `atSeq`: the fold state of every topic becomes the checkpoint and events at or below it leave the hot log
   * (returned, for the run's archive). Views at or after `atSeq` are unchanged (tested); reads below it are refused. Labels,
   * confidentiality, quotas and lww versions survive in the fold state, so compaction can neither launder taint nor reset a quota.
   * This is the exact compaction; a model-written summary is only ever a derived view that names the sequence range it covers.
   */
  compact(atSeq = this.seq) {
    if (!Number.isSafeInteger(atSeq) || atSeq < this.base || atSeq > this.seq) fail('BOARD_SEQ', `Compaction point ${atSeq} is outside ${this.base}..${this.seq}`);
    const states = Object.fromEntries(Object.keys(this.decl.topics).map(n => [n, clone(this.#fold(n, atSeq))]));
    const archived = this.events.filter(e => e.seq <= atSeq);
    const headAt = archived.at(-1)?.hash ?? this.checkpoint?.headAt ?? digest({ model: MEMORY_MODEL, declHash: this.decl.declHash, runId: this.runId, genesis: GENESIS });
    this.checkpoint = { base: atSeq, headAt, states, statesHash: digest(states) };
    this.events = this.events.filter(e => e.seq > atSeq); this.base = atSeq;
    return { checkpoint: { base: atSeq, headAt, statesHash: this.checkpoint.statesHash }, archived };
  }

  /** Recomputes the hash chain of the hot log from the checkpoint (or genesis). True when no event was edited, dropped or reordered. */
  verify() {
    let prev = this.checkpoint?.headAt ?? digest({ model: MEMORY_MODEL, declHash: this.decl.declHash, runId: this.runId, genesis: GENESIS }), seq = this.base;
    for (const e of this.events) {
      const { hash, ...body } = e;
      if (body.prev !== prev || body.seq !== seq + 1 || digest(body) !== hash || digest(body.value) !== body.valueHash) return false;
      prev = hash; seq = body.seq;
    }
    return prev === this.head;
  }

  /** The run's board root for the seal (ROADMAP §2.10 "a board root once a board exists"): head, sequence and declaration. */
  root() { return { model: MEMORY_MODEL, declHash: this.decl.declHash, runId: this.runId, seq: this.seq, head: this.head, refusals: this.refusals.length }; }

  /** Rebuilds a board from a recorded log (replay): every event must re-validate and re-hash to the recorded hash, or REPLAY_DIVERGENCE. */
  static replay(decl, { runId, events }) {
    const board = new Board(decl, { runId });
    for (const e of events) {
      const lww = decl.topics[e.topic]?.reducer === 'lww';
      const r = board.write(e.writer, e.topic, e.value, { label: e.label, confidentiality: e.confidentiality, sources: e.sources,
        ...(lww ? { expectSeq: board.version(e.topic, e.value?.[decl.topics[e.topic].key]) } : {}) });
      if (!r.ok || r.hash !== e.hash) fail('REPLAY_DIVERGENCE', `Recorded event ${e.seq} does not replay (${r.ok ? 'hash differs' : r.code})`);
    }
    return board;
  }
}
const safeDigest = value => { try { return digest(value); } catch { return null; } };

// ------------------------------------------------------------------ node scratch (private)

export const FORK_REASONS = Object.freeze(['repair', 'escalation']);
export class Scratch {
  constructor({ runId, nodeKey, attempt = 0 }) { Object.assign(this, { runId, nodeKey, attempt }); this.notes = []; this.labels = []; }
  /** Appends a private note with the label of what it was derived from. Free inside the node; no schema, no quota. */
  note(value, { label = 'trusted' } = {}) { checkData(value); const l = joinLabels([label]); if (l !== 'trusted' && !this.labels.includes(l)) this.labels.push(l); this.notes.push({ value: clone(value), label: l }); return this.notes.length; }
  get label() { return joinLabels(['trusted', ...this.labels]); }
  /** What the journal binds: the notes' hash (auditors read the notes; no prompt does). */
  digest() { return digest({ runId: this.runId, nodeKey: this.nodeKey, attempt: this.attempt, notes: this.notes }); }
  /** Scratch never flows sideways or into a later run: the only exits are the node's typed output and fork(). */
  share() { fail('SCRATCH_PRIVATE', `Scratch of ${this.nodeKey} leaves the node only through its typed output (or a repair/escalation fork)`); }
  /** A full copy for a repair or escalation of THIS node, with a receipt; any other reason is refused. */
  fork(reason, { by }) {
    if (!FORK_REASONS.includes(reason)) fail('SCRATCH_FORK', `Scratch forks only for ${FORK_REASONS.join(' or ')}, not ${String(reason)}`);
    if (typeof by !== 'string' || !by) fail('SCRATCH_FORK', 'A fork names the node that receives it');
    return { notes: clone(this.notes), label: this.label, receipt: { from: this.nodeKey, attempt: this.attempt, reason, by, scratchHash: this.digest() } };
  }
}

// ------------------------------------------------------------------ workflow-version notes (immutable, evidence-gated)

export const NOTE_POLICY = Object.freeze({ minRuns: 5, minGain: 1, maxRegressions: 0, maxNotes: 32, maxNoteBytes: 2048, allowUntrusted: false });
const notesHash = (workflowHash, fingerprint, notes) => digest({ model: MEMORY_MODEL, workflowHash, fingerprint, notes });

/** The empty notes of a workflow version under a fingerprint (model ids, policy hash, engine hash). */
export function emptyNotes(workflowHash, fingerprint) {
  if (typeof workflowHash !== 'string' || !workflowHash || typeof fingerprint !== 'string' || !fingerprint) fail('NOTE_DECL', 'Notes need a workflow hash and a fingerprint');
  const notes = Object.freeze([]);
  return Object.freeze({ workflowHash, fingerprint, notes, hash: notesHash(workflowHash, fingerprint, notes), versionId: digest({ workflowHash, notes: notesHash(workflowHash, fingerprint, notes) }) });
}

/**
 * The promotion ladder's admission of one lesson. candidate: {id, value, label, confidentiality?, sourceRuns}. evidence:
 * {kind: 'replay-proof', fingerprint, runs: [runId...], withNote: {pass}, withoutNote: {pass}, regressions}. The note must win on
 * runs disjoint from those it was mined from, with no regression, under the current fingerprint; its label is kept, never raised.
 * Returns {ok: true, notes} (a NEW immutable object: a new version id) or {ok: false, code, message}.
 */
export function admitNote(current, candidate, evidence, policy = NOTE_POLICY) {
  const no = (code, message) => ({ ok: false, code, message });
  if (!candidate || typeof candidate.id !== 'string' || !NAME.test(candidate.id)) return no('NOTE_SHAPE', 'A note has an identifier id');
  if (current.notes.some(n => n.id === candidate.id)) return no('NOTE_SHAPE', `Note ${candidate.id} exists; a changed lesson is a new id`);
  if (current.notes.length >= policy.maxNotes) return no('NOTE_FULL', `A version carries at most ${policy.maxNotes} notes`);
  try { checkData(candidate.value); } catch (e) { return no('NOTE_SHAPE', e.message); }
  if (bytes(candidate.value) > policy.maxNoteBytes) return no('NOTE_SHAPE', `A note is at most ${policy.maxNoteBytes} bytes`);
  let label; try { label = joinLabels([candidate.label ?? 'trusted']); rank(candidate.confidentiality ?? 'public'); } catch (e) { return no('NOTE_LABEL', e.message); }
  if (label !== 'trusted' && !policy.allowUntrusted) return no('NOTE_LABEL', `Note ${candidate.id} is derived from ${label}; untrusted lessons are not served`);
  if (evidence?.kind !== 'replay-proof') return no('NOTE_EVIDENCE', 'Admission needs replay evidence (notes on vs notes off on the same recorded inputs)');
  if (evidence.fingerprint !== current.fingerprint) return no('NOTE_STALE', 'The evidence was gathered under another fingerprint');
  const runs = [...new Set(evidence.runs ?? [])];
  if (runs.length < policy.minRuns) return no('NOTE_EVIDENCE', `Admission needs at least ${policy.minRuns} distinct runs`);
  const mined = new Set(candidate.sourceRuns ?? []);
  if (runs.some(r => mined.has(r))) return no('NOTE_IN_SAMPLE', 'The evidence runs must be disjoint from the runs the lesson was mined from');
  const on = evidence.withNote?.pass, off = evidence.withoutNote?.pass;
  if (![on, off].every(n => Number.isSafeInteger(n) && n >= 0 && n <= runs.length)) return no('NOTE_EVIDENCE', 'pass counts must be integers within the run count');
  if (on - off < policy.minGain) return no('NOTE_NO_GAIN', `The note gains ${on - off} passes; ${policy.minGain} needed`);
  if (!Number.isSafeInteger(evidence.regressions) || evidence.regressions > policy.maxRegressions) return no('NOTE_REGRESSION', `${evidence.regressions} regressions; at most ${policy.maxRegressions}`);
  const note = Object.freeze({ id: candidate.id, value: clone(candidate.value), label, confidentiality: candidate.confidentiality ?? 'public',
    evidence: Object.freeze({ runs: runs.sort(), withNote: on, withoutNote: off, regressions: evidence.regressions, sourceRuns: [...mined].sort() }) });
  const notes = Object.freeze([...current.notes, note].sort((a, b) => a.id.localeCompare(b.id)));
  const hash = notesHash(current.workflowHash, current.fingerprint, notes);
  return { ok: true, notes: Object.freeze({ workflowHash: current.workflowHash, fingerprint: current.fingerprint, notes, hash, versionId: digest({ workflowHash: current.workflowHash, notes: hash }) }) };
}

/** What a run of the version is served: every note under the matching fingerprint, none (all to shadow) under another. */
export function servedNotes(notes, fingerprint) {
  return fingerprint === notes.fingerprint ? { served: notes.notes, shadow: [] } : { served: [], shadow: notes.notes, reason: 'fingerprint changed (model, policy or engine)' };
}
/** The served notes as one context-compiler input (label: join of the notes' labels). Null when nothing is served. */
export function notesInput(notes, fingerprint, { maxTokens = 1000 } = {}) {
  const { served } = servedNotes(notes, fingerprint);
  if (!served.length) return null;
  return { name: 'version_notes', value: served.map(n => ({ id: n.id, note: n.value })), label: joinLabels(['trusted', ...served.map(n => n.label)]), render: 'json', maxTokens, priority: 0, sourceRef: `notes:${notes.hash}` };
}

// ------------------------------------------------------------------ org memory (the AMP seam; read-only for Foundry)

/**
 * A local stand-in for AMP's compile_context-shaped query. Claims: {id, version, topic, value, principal, origin ('authored' |
 * 'derived'), confidentiality, validFrom, validTo (null = open)}. A claim is trusted only when a trusted principal authored it;
 * anything derived (from documents, mail, the web, a model) keeps an untrusted label, so a policy-formatted upload can never
 * re-emerge as trusted context (Semantic Norm Drift, arXiv 2605.22842). Validity is bi-temporal in the Zep/Graphiti sense:
 * a superseded claim is invalidated, never deleted, and a query `asOf` an instant sees what was valid then.
 */
export class LocalOrgMemory {
  constructor(claims, { trustedPrincipals = ['owner'] } = {}) {
    this.claims = claims.map(c => Object.freeze(clone(c))); this.trusted = new Set(trustedPrincipals); this.proposals = [];
  }
  labelOf(c) { return c.origin === 'authored' && this.trusted.has(c.principal) ? 'trusted' : `untrusted:org-${String(c.origin).replace(/[^A-Za-z0-9_.:-]/g, '_')}`; }
  query({ topic, asOf, maxBytes = 4096, clearance = 'public' }) {
    const at = Date.parse(asOf);
    if (!Number.isFinite(at)) fail('ORG_QUERY', 'asOf must be an ISO instant (the receipt pins it, so a replay sees the same claims)');
    const valid = this.claims.filter(c => c.topic === topic && Date.parse(c.validFrom) <= at && (c.validTo === null || at < Date.parse(c.validTo)));
    const items = [], withheld = [], truncated = []; let used = 0;
    for (const c of valid.sort((a, b) => a.id.localeCompare(b.id))) {
      if (rank(c.confidentiality ?? 'public') > rank(clearance)) { withheld.push(c.id); continue; }
      const item = { id: c.id, version: c.version, value: c.value, label: this.labelOf(c), confidentiality: c.confidentiality ?? 'public' };
      const size = bytes(item);
      if (used + size > maxBytes) { truncated.push(c.id); continue; }
      used += size; items.push(item);
    }
    const receipt = { asOf, topic, items: items.map(i => `${i.id}@${i.version}`), withheld: withheld.length, truncated, bytes: used };
    return { items, label: joinLabels(['trusted', ...items.map(i => i.label)]), receipt: { ...receipt, hash: digest(receipt) } };
  }
  /** Foundry may propose a claim with evidence handles; AMP decides. Nothing here changes what query() returns. */
  propose(claim, evidence) { const p = { claim: clone(claim), evidence: clone(evidence), status: 'proposed' }; this.proposals.push(p); return { accepted: false, proposal: p }; }
}
