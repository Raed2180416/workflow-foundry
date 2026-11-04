// Foundry run board, $0 prototype (research/memory-20261021/MEMORY-MODEL.md). It is the instrument the MEM-1 experiment needs to
// test whether a run board beats plain typed edges by at least 15% per dollar (ROADMAP §2.2, R-10). It is NOT wired into
// src/runtime.mjs (ROADMAP §6 rule 12) and it is not in src/engine.mjs's identity list, so it changes no engine hash.
//
// Revision 2 (2026-11-04, after the design review of commit 8a42d7a5). What is ADOPTED as design is only "private by default"
// (already the runtime's behaviour) and typed edges as the default sharing path. Revision 1 also built a node-scratch class,
// workflow-version notes, an org-memory stand-in and a confidentiality label axis. No preregistered experiment needs any of
// them (rules 5 and 12), so they were removed and are deferred behind MEM-2 and MEM-3; the code is recoverable from commit
// 8a42d7a5 (experiments/memory/board.mjs). Changes to the board itself:
//   - an over-cap view is PAGED fairly across the topic's declared writers instead of refused (review #2, #3): each writer with
//     items left gets an equal token share of the page first, the rest of the page is filled round-robin, and every page says
//     what it omitted per writer and how to continue. A view is never silently cut;
//   - provenance is DERIVED by the kernel (review #5): every read a node makes through the board is logged, and the node's
//     later writes carry `board:<topic>@<seq>` ancestry for everything it could have seen, plus the sourceRefs of a context
//     receipt it presents and any sources it declares (which can only add ancestry, never remove it);
//   - verify() re-derives the fold state and checks the checkpoint; root() binds the state hash (review #12).
//
// A topic declares a reducer, an optional schema, its writers, its readers, an integrity label ceiling and quotas. A
// deterministic kernel validates every write; accepted events are hash-chained; refusals are typed and kept for audit. Reads are
// folds at one pinned sequence number, so the receipt (sourceRef board:<topic>@<seq>) says exactly what a node saw. Labels come
// only from the kernel's metadata, never from the data: a value carrying its own `label` or `security_label` field is data like
// any other (the label-forging failure APIsec reported in Microsoft's FIDES middleware, 2026).
import { canonical, checkData, clone, digest, FoundryError } from '../../src/data.mjs';
import { checkLabel, estimateTokens, joinLabels } from '../../src/context.mjs';
import { validateData } from '../../src/validate.mjs';

export const MEMORY_MODEL = 'foundry-board/2';
export const REDUCERS = Object.freeze(['append', 'lww', 'setUnion', 'max', 'counter']);
/** Reducers whose views are lists of items and can be paged (max and counter views are one number). */
export const PAGED = Object.freeze(['append', 'lww', 'setUnion']);
export const REFUSALS = Object.freeze(['BOARD_TOPIC', 'BOARD_WRITER', 'BOARD_LABEL', 'BOARD_SIZE', 'BOARD_SCHEMA', 'BOARD_FULL', 'BOARD_QUOTA',
  'BOARD_STALE', 'BOARD_VALUE']);
export const LIMITS = Object.freeze({ topics: 32, maxEvents: 100000, maxEventBytes: 64 * 1024, defaultEventBytes: 4096, defaultViewTokens: 2000 });
const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const BOARD_REF = /^board:([A-Za-z][A-Za-z0-9_-]{0,63})@(\d+)(?:#.*)?$/;
const EVENT_REF = /^event:(\d+)$/;
const GENESIS = 'genesis';

const fail = (code, message, details) => { throw new FoundryError(code, message, details); };
const bytes = value => Buffer.byteLength(canonical(value), 'utf8');
const itemTokens = value => estimateTokens(canonical(value)) + 1; // + the separator in the page's list
const sourcesOf = label => checkLabel(label) === 'trusted' ? [] : label.slice('untrusted:'.length).split('+');
/** Integrity order: `from` may flow into a container labelled `to` when every untrusted source of `from` is one `to` admits. */
export const flowsTo = (from, to) => { const allowed = new Set(sourcesOf(to)); return sourcesOf(from).every(s => allowed.has(s)); };
// The token cost of a page's frame ({next, omitted, page: []}) when every declared writer appears with a 7-digit count.
const frameTokens = writers => { const big = Object.fromEntries(writers.map(w => [w, 9999999])); return estimateTokens(canonical({ next: big, omitted: big, page: [] })); };

// ------------------------------------------------------------------ declaration (static, before any run)

/**
 * Checks and freezes a board declaration: {topics: {name: {schema?, reducer, key?, writers, readers, label?, maxEvents,
 * maxEventsPerWriter?, maxEventBytes?, maxViewTokens?}}}. Returns it with `declHash`. Declarations are code-owned (the workflow
 * author or the construction ladder writes them); a model never chooses at run time what it may read or write.
 * Static guarantee: every single event fits one page of its topic's view (so paging always makes progress).
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
    const maxViewTokens = t.maxViewTokens ?? LIMITS.defaultViewTokens;
    const writers = Object.freeze([...new Set(t.writers)].sort()), frame = frameTokens(writers);
    if (!Number.isSafeInteger(maxViewTokens) || maxViewTokens < 1) fail('BOARD_DECL', `Topic ${name}: maxViewTokens must be a positive integer`);
    if (PAGED.includes(t.reducer) && Math.ceil(maxEventBytes / 4) + 1 + frame > maxViewTokens)
      fail('BOARD_DECL', `Topic ${name}: one event (up to ${maxEventBytes} bytes) plus the page frame (${frame} tokens) must fit a ${maxViewTokens}-token page`);
    const label = checkLabel(t.label ?? 'trusted');
    if (t.schema !== undefined) { checkData(t.schema); compileProbe(t.schema); }
    topics[name] = Object.freeze({ reducer: t.reducer, key: t.key ?? null, schema: t.schema ?? null, writers,
      readers: Object.freeze([...new Set(t.readers)].sort()), label, maxEvents: t.maxEvents, maxEventsPerWriter, maxEventBytes, maxViewTokens, frameTokens: frame });
  }
  const decl = { model: MEMORY_MODEL, topics };
  return Object.freeze({ ...decl, declHash: digest(decl) });
}
// Compiles a topic schema at declaration time: a schema that does not compile is a declaration error, not a run-time refusal.
// (validateData compiles, then tests a probe value; the probe failing its schema is expected and ignored.)
function compileProbe(schema) { try { validateData(schema, null, 'probe'); } catch (e) { if (e.code !== 'SCHEMA_MISMATCH') fail('BOARD_DECL', `Topic schema does not compile: ${e.message}`); } }

// ------------------------------------------------------------------ fold state (shared by views and checkpoints)

const emptyState = reducer => ({ reducer, count: 0, perWriter: {}, labels: [],
  ...(reducer === 'append' ? { items: [] } : reducer === 'lww' ? { entries: {} } : reducer === 'setUnion' ? { members: {} } : reducer === 'max' ? { best: null } : { total: 0 }) });

function applyEvent(state, e, topic) {
  state.count++; state.perWriter[e.writer] = (state.perWriter[e.writer] ?? 0) + 1;
  if (e.label !== 'trusted' && !state.labels.includes(e.label)) state.labels.push(e.label);
  if (state.reducer === 'append') state.items.push({ seq: e.seq, writer: e.writer, value: e.value });
  else if (state.reducer === 'lww') { const k = String(e.value[topic.key]); state.entries[k] = { seq: e.seq, writer: e.writer, value: e.value }; }
  else if (state.reducer === 'setUnion') {
    const k = canonical(e.value), m = state.members[k] ?? (state.members[k] = { value: e.value, firstSeq: e.seq, supporters: [] });
    m.supporters.push({ seq: e.seq, writer: e.writer });
  } else if (state.reducer === 'max') { if (state.best === null || e.value > state.best.value) state.best = { seq: e.seq, writer: e.writer, value: e.value }; }
  else state.total += e.value;
  return state;
}
const sortedKeys = obj => Object.keys(obj).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
const viewValue = state => state.reducer === 'append' ? state.items.map(i => i.value)
  : state.reducer === 'lww' ? Object.fromEntries(sortedKeys(state.entries).map(k => [k, state.entries[k].value]))
  : state.reducer === 'setUnion' ? sortedKeys(state.members).map(k => state.members[k].value)
  : state.reducer === 'max' ? (state.best?.value ?? null) : state.total;
// The items of a list view grouped by the writer they are credited to, each group in a stable order: append items by seq, lww
// entries by key (credited to the writer of the current value), setUnion members by first seq (credited to their first supporter).
function itemsByWriter(state) {
  const rows = state.reducer === 'append' ? state.items.map(i => ({ seq: i.seq, writer: i.writer, value: i.value }))
    : state.reducer === 'lww' ? sortedKeys(state.entries).map(k => ({ seq: state.entries[k].seq, writer: state.entries[k].writer, value: state.entries[k].value }))
    : Object.values(state.members).sort((a, b) => a.firstSeq - b.firstSeq).map(m => ({ seq: m.firstSeq, writer: m.supporters[0].writer, value: m.value }));
  const groups = {};
  for (const r of rows) (groups[r.writer] ??= []).push({ ...r, tokens: itemTokens(r.value) });
  return groups;
}

// ------------------------------------------------------------------ the run board

export class Board {
  /** `decl` from defineBoard; `runId` names the run (a board never outlives it). */
  constructor(decl, { runId }) {
    if (!decl?.declHash || decl.model !== MEMORY_MODEL) fail('BOARD_DECL', 'Board needs a declaration from defineBoard');
    if (typeof runId !== 'string' || !runId) fail('BOARD_DECL', 'Board needs a runId');
    this.decl = decl; this.runId = runId; this.seq = 0; this.events = []; this.refusals = []; this.reads = []; this.base = 0;
    // Provenance of every event ever accepted (seq -> {topic, sources}); kept across compaction, so ancestry never goes dark.
    this.lineage = new Map(); this.topicSeqs = Object.fromEntries(Object.keys(decl.topics).map(n => [n, []]));
    this.head = this.#genesis();
    this.checkpoint = null; this.states = Object.fromEntries(Object.entries(decl.topics).map(([n, t]) => [n, emptyState(t.reducer)]));
  }
  #genesis() { return digest({ model: MEMORY_MODEL, declHash: this.decl.declHash, runId: this.runId, genesis: GENESIS }); }

  /**
   * Proposes one write. Returns {ok: true, seq, hash} or {ok: false, code, message}. A refusal changes no state and is kept in
   * `refusals` (with the head it was evaluated against), so the audit shows what was attempted, by whom, and why it was refused.
   * meta: {label = 'trusted', sources = [], receipt?, expectSeq (lww: the key's version the writer read; 0 = absent)}. The label
   * is the writer's own (the runtime computes it from the writer's inputs); never read from `value`. The event's sources are the
   * union of (a) the reads this writer made through the board (board:<topic>@<seq>), (b) the sourceRefs of `receipt` (a
   * src/context.mjs receipt) and (c) `sources`: a writer can add ancestry, it cannot remove what the kernel saw it read.
   */
  write(writer, topicName, value, meta = {}) {
    const refuse = (code, message) => { const r = { ok: false, code, message, writer, topic: topicName, at: this.seq, head: this.head, valueHash: safeDigest(value) }; this.refusals.push(r); return r; };
    const topic = Object.hasOwn(this.decl.topics, topicName) ? this.decl.topics[topicName] : undefined;
    if (!topic) return refuse('BOARD_TOPIC', `No topic ${String(topicName)}`);
    if (!topic.writers.includes(writer)) return refuse('BOARD_WRITER', `${writer} is not a declared writer of ${topicName}`);
    let label;
    try { label = joinLabels([meta.label ?? 'trusted']); } catch (e) { return refuse('BOARD_LABEL', e.message); }
    if (!flowsTo(label, topic.label)) return refuse('BOARD_LABEL', `${topicName} admits ${topic.label}; this write carries ${label}`);
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
    if (meta.receipt !== undefined && !Array.isArray(meta.receipt?.inputs)) return refuse('BOARD_VALUE', 'receipt must be a context receipt (an object with inputs[])');
    if (meta.sources !== undefined && !Array.isArray(meta.sources)) return refuse('BOARD_VALUE', 'sources must be a list');
    const declared = (meta.sources ?? []).map(String), fromReceipt = (meta.receipt?.inputs ?? []).map(i => i?.sourceRef).filter(r => typeof r === 'string' && r);
    const sources = [...new Set([...declared, ...fromReceipt, ...this.#readRefs(writer)])].sort();
    const event = { seq: this.seq + 1, topic: topicName, writer, value: clone(value), valueHash: digest(value), label, sources, prev: this.head };
    const hash = digest(event);
    this.events.push({ ...event, hash }); this.seq = event.seq; this.head = hash;
    this.lineage.set(event.seq, { topic: topicName, writer, sources }); this.topicSeqs[topicName].push(event.seq);
    applyEvent(state, this.events.at(-1), topic);
    return { ok: true, seq: event.seq, hash };
  }
  // The latest board read of each topic by `node` (a read at seq 0 saw nothing and adds no ancestry).
  #readRefs(node) {
    const latest = {};
    for (const r of this.reads) if (r.reader === node && r.atSeq > 0) latest[r.topic] = Math.max(latest[r.topic] ?? 0, r.atSeq);
    return Object.entries(latest).map(([t, n]) => `board:${t}@${n}`);
  }

  /** The version of an lww key at `atSeq` (0 when absent): what a writer passes as expectSeq. */
  version(topicName, key, atSeq = this.seq) { return this.#fold(topicName, atSeq).entries?.[String(key)]?.seq ?? 0; }

  #fold(topicName, atSeq) {
    const topic = Object.hasOwn(this.decl.topics, topicName) ? this.decl.topics[topicName] : undefined;
    if (!topic) fail('BOARD_TOPIC', `No topic ${String(topicName)}`);
    if (!Number.isSafeInteger(atSeq) || atSeq < 0 || atSeq > this.seq) fail('BOARD_SEQ', `Sequence ${atSeq} is outside 0..${this.seq}`);
    if (atSeq < this.base) fail('BOARD_COMPACTED', `Sequence ${atSeq} was compacted (base ${this.base}); read the archive`);
    if (atSeq === this.seq) return this.states[topicName];
    const state = this.checkpoint ? clone(this.checkpoint.states[topicName]) : emptyState(topic.reducer);
    for (const e of this.events) { if (e.seq > atSeq) break; if (e.topic === topicName) applyEvent(state, e, topic); }
    return state;
  }
  // Declared-reader check plus the read log (what derived provenance is built from).
  #read(reader, topicName, atSeq) {
    const topic = Object.hasOwn(this.decl.topics, topicName) ? this.decl.topics[topicName] : undefined;
    if (!topic) fail('BOARD_TOPIC', `No topic ${String(topicName)}`);
    if (!topic.readers.includes(reader)) fail('BOARD_READER', `${reader} is not a declared reader of ${topicName}`);
    const state = this.#fold(topicName, atSeq);
    this.reads.push({ reader, topic: topicName, atSeq });
    return { topic, state };
  }

  /**
   * A reader's whole view of one topic at `atSeq` (default: now), for audit and small topics. Refused (thrown: a workflow defect,
   * not data) when the reader is not declared. The view's label is the join of every accepted event's label in the topic
   * (conservative: which value won can depend on every write).
   */
  view(reader, topicName, { atSeq = this.seq } = {}) {
    const { state } = this.#read(reader, topicName, atSeq), value = clone(viewValue(state));
    return { topic: topicName, atSeq, value, label: joinLabels(['trusted', ...state.labels]), events: state.count, valueHash: digest(value) };
  }

  /**
   * Board reads as context-compiler inputs (src/context.mjs compileContext({inputs})): one per spec {topic, as?, maxTokens?,
   * priority?, cursor?}, all at ONE sequence number. A view within its cap (min(spec.maxTokens, topic.maxViewTokens)) is the whole
   * view, sourceRef board:<topic>@<seq>. A larger view (or any read with a cursor) is one FAIR PAGE: value {page: [...items in seq
   * order], omitted: {writer: items left}, next: cursor | null}, sourceRef board:<topic>@<seq>#<cursor>. Every page states what it
   * left out; following `next` reaches every item exactly once. Returns {atSeq, inputs, pages: [{topic, next, omitted} | null]}.
   */
  readsFor(reader, specs, { atSeq = this.seq } = {}) {
    const out = specs.map(spec => {
      const { topic, state } = this.#read(reader, spec.topic, atSeq);
      const cap = Math.min(spec.maxTokens ?? Infinity, topic.maxViewTokens), label = joinLabels(['trusted', ...state.labels]);
      const whole = viewValue(state), tokens = estimateTokens(canonical(whole));
      const base = { name: spec.as ?? spec.topic, label, render: 'json', maxTokens: cap, priority: spec.priority ?? 0 };
      if (spec.cursor === undefined && tokens <= cap) return { input: { ...base, value: clone(whole), sourceRef: `board:${spec.topic}@${atSeq}` }, page: null };
      if (!PAGED.includes(topic.reducer)) fail('BOARD_VIEW_BUDGET', `${spec.topic} at ${atSeq} needs ~${tokens} tokens; the cap is ${cap}`, { tokens, cap });
      const page = fairPage(state, topic, cap, spec.cursor);
      return { input: { ...base, value: page.value, sourceRef: `board:${spec.topic}@${atSeq}#${canonical(page.from)}` }, page: { topic: spec.topic, next: page.value.next, omitted: page.value.omitted } };
    });
    return { atSeq, inputs: out.map(o => o.input), pages: out.map(o => o.page) };
  }

  /**
   * How many independent supporters a setUnion member has at `atSeq`. Supporters are counted in seq order; one is independent when
   * (1) no other supporting event of the member is in its ancestry, (2) its writer was not counted already, and (3) its external
   * sources (anything that is not an event:<n> or board:<topic>@<seq> reference, followed transitively) share nothing with a
   * counted supporter's: two posts of the same forum item are one source. Ancestry follows event:<n>, and board:<t>@<n> as "every
   * event of topic t up to n", which is what the kernel derives from the writer's own reads. A "confirmation" written after
   * reading the claim is therefore an echo even when the writer declares no sources. This is conservative: an honest
   * reproduction made after reading the claim also counts as an echo (the kernel cannot verify a re-derivation).
   */
  independentSupport(reader, topicName, member, { atSeq = this.seq } = {}) {
    const { topic, state } = this.#read(reader, topicName, atSeq);
    if (topic.reducer !== 'setUnion') fail('BOARD_TOPIC', `${topicName} is not a setUnion topic`);
    const m = state.members[canonical(member)];
    if (!m) return { supporters: 0, independent: 0, echoes: 0 };
    const supporting = new Set(m.supporters.map(s => s.seq)), writers = new Set(), counted = new Set();
    let independent = 0;
    for (const s of m.supporters) {
      const anc = this.ancestry(s.seq);
      if ([...supporting].some(o => o !== s.seq && anc.events.has(o)) || writers.has(s.writer) || [...anc.external].some(x => counted.has(x))) continue;
      writers.add(s.writer); for (const x of anc.external) counted.add(x); independent++;
    }
    return { supporters: m.supporters.length, independent, echoes: m.supporters.length - independent };
  }

  /** The transitive ancestry of event `seq`: {events: Set of seqs, external: Set of non-board sources}. */
  ancestry(seq) {
    const events = new Set(), external = new Set(), stack = [seq];
    const add = n => { if (n !== seq && !events.has(n) && this.lineage.has(n)) { events.add(n); stack.push(n); } };
    while (stack.length) for (const s of this.lineage.get(stack.pop())?.sources ?? []) {
      const e = EVENT_REF.exec(s), b = e ? null : BOARD_REF.exec(s);
      if (e) add(+e[1]);
      else if (b) { for (const n of this.topicSeqs[b[1]] ?? []) { if (n > +b[2]) break; add(n); } }
      else external.add(s);
    }
    return { events, external };
  }

  /**
   * Fold compaction at `atSeq`: the fold state of every topic becomes the checkpoint and events at or below it leave the hot log
   * (returned, for the run's archive). Views at or after `atSeq` are unchanged (tested); reads below it are refused. Labels,
   * quotas and lww versions survive in the fold state, and provenance survives in `lineage`, so compaction can neither launder
   * taint, nor reset a quota, nor hide an echo. A model-written summary is only ever a derived view that names its seq range.
   */
  compact(atSeq = this.seq) {
    if (!Number.isSafeInteger(atSeq) || atSeq < this.base || atSeq > this.seq) fail('BOARD_SEQ', `Compaction point ${atSeq} is outside ${this.base}..${this.seq}`);
    const states = Object.fromEntries(Object.keys(this.decl.topics).map(n => [n, clone(this.#fold(n, atSeq))]));
    const archived = this.events.filter(e => e.seq <= atSeq);
    const headAt = archived.at(-1)?.hash ?? this.checkpoint?.headAt ?? this.#genesis();
    this.checkpoint = { base: atSeq, headAt, states, statesHash: digest(states) };
    this.events = this.events.filter(e => e.seq > atSeq); this.base = atSeq;
    return { checkpoint: { base: atSeq, headAt, statesHash: this.checkpoint.statesHash }, archived };
  }

  /**
   * True when (1) the hot log's hash chain recomputes from the checkpoint (or genesis): no event edited, dropped or reordered;
   * (2) the checkpoint's states still hash to its statesHash; (3) folding the checkpoint plus the hot log re-derives the live
   * fold state of every topic (so an edited view, label list or quota counter is caught); (4) the lineage of every hot event is
   * its recorded sources.
   */
  verify() {
    let prev = this.checkpoint?.headAt ?? this.#genesis(), seq = this.base;
    for (const e of this.events) {
      const { hash, ...body } = e;
      if (body.prev !== prev || body.seq !== seq + 1 || digest(body) !== hash || digest(body.value) !== body.valueHash) return false;
      prev = hash; seq = body.seq;
    }
    if (prev !== this.head || seq !== this.seq) return false;
    if (this.checkpoint && digest(this.checkpoint.states) !== this.checkpoint.statesHash) return false;
    for (const [name, topic] of Object.entries(this.decl.topics)) {
      const state = this.checkpoint ? clone(this.checkpoint.states[name]) : emptyState(topic.reducer);
      for (const e of this.events) if (e.topic === name) applyEvent(state, e, topic);
      if (digest(state) !== digest(this.states[name])) return false;
    }
    return this.events.every(e => canonical(this.lineage.get(e.seq)) === canonical({ topic: e.topic, writer: e.writer, sources: e.sources }));
  }

  /** The run's board root for the seal (ROADMAP §2.10 "a board root once a board exists"): head, sequence, state and declaration. */
  root() {
    return { model: MEMORY_MODEL, declHash: this.decl.declHash, runId: this.runId, seq: this.seq, head: this.head, statesHash: digest(this.states),
      checkpoint: this.checkpoint ? { base: this.checkpoint.base, headAt: this.checkpoint.headAt, statesHash: this.checkpoint.statesHash } : null,
      refusals: this.refusals.length, reads: this.reads.length };
  }

  /** Rebuilds a board from a recorded log (replay): every event must re-validate and re-hash to the recorded hash, or REPLAY_DIVERGENCE. */
  static replay(decl, { runId, events }) {
    const board = new Board(decl, { runId });
    for (const e of events) {
      const lww = decl.topics[e.topic]?.reducer === 'lww';
      const r = board.write(e.writer, e.topic, e.value, { label: e.label, sources: e.sources,
        ...(lww ? { expectSeq: board.version(e.topic, e.value?.[decl.topics[e.topic].key]) } : {}) });
      if (!r.ok || r.hash !== e.hash) fail('REPLAY_DIVERGENCE', `Recorded event ${e.seq} does not replay (${r.ok ? 'hash differs' : r.code})`);
    }
    return board;
  }
}
const safeDigest = value => { try { return digest(value); } catch { return null; } };

/**
 * One fair page of a list view (a pure function of the fold state, the topic and the cursor, so a replay at the same seq and
 * cursor serves the same page). Pass 1: every declared writer with items left gets an equal share of the page's token budget and
 * takes its next items while they fit that share. Pass 2: the rest of the budget goes round-robin, one item per writer per turn.
 * So a writer whose next item fits budget / (writers with items left) is on the page however much the others wrote: per-writer
 * quotas bound one flooder, and this bounds a sybil flood by several declared writers within quota. (The bound fails when the
 * declared writers times the honest item size exceeds the page: a measured negative, battery A13c.)
 */
export function fairPage(state, topic, cap, cursor) {
  const groups = itemsByWriter(state), writers = topic.writers;
  if (cursor !== undefined && (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)
    || !Object.entries(cursor).every(([w, n]) => writers.includes(w) && Number.isSafeInteger(n) && n >= 0 && n <= (groups[w]?.length ?? 0))))
    fail('BOARD_CURSOR', 'A cursor is the `next` object of an earlier page of this view');
  const pos = Object.fromEntries(writers.map(w => [w, cursor?.[w] ?? 0])), from = { ...pos };
  const left = w => (groups[w]?.length ?? 0) - pos[w];
  const budget = cap - topic.frameTokens, chosen = [];
  let used = 0;
  const active = writers.filter(w => left(w) > 0), share = Math.floor(budget / Math.max(1, active.length));
  for (const w of active) {
    let mine = 0;
    while (left(w) > 0 && mine + groups[w][pos[w]].tokens <= share) { mine += groups[w][pos[w]].tokens; chosen.push(groups[w][pos[w]]); pos[w]++; }
    used += mine;
  }
  for (let progress = true; progress;) {
    progress = false;
    for (const w of writers) if (left(w) > 0 && used + groups[w][pos[w]].tokens <= budget) { used += groups[w][pos[w]].tokens; chosen.push(groups[w][pos[w]]); pos[w]++; progress = true; }
  }
  if (!chosen.length && active.length) fail('BOARD_VIEW_BUDGET', `No item of ${topic.reducer} view fits a ${cap}-token page`);
  const omitted = Object.fromEntries(writers.filter(w => left(w) > 0).map(w => [w, left(w)]));
  const next = Object.keys(omitted).length ? Object.fromEntries(writers.filter(w => groups[w]).map(w => [w, pos[w]])) : null;
  return { from: Object.fromEntries(writers.filter(w => groups[w]).map(w => [w, from[w]])),
    value: { page: chosen.sort((a, b) => a.seq - b.seq).map(c => clone(c.value)), omitted, next } };
}
