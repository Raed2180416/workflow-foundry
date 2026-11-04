// Memory designs compared by the MEM-0b battery (battery.mjs, revision 2), all behind ONE adapter contract, so every scenario
// runs the same script against each and no scenario branches on which design it is talking to:
//   new Design({decl, runId, carry?})            every design gets the same board-style declaration (the baselines ignore what
//                                                 they have no concept of)
//   write(writer, topic, value, meta)            -> {ok} | {ok: false, code}
//   writeKey(writer, topic, value, {keyField, version, label}) and readKey(reader, topic, keyField, key) -> {value, version}
//   read(reader, topic, {budgetTokens, cursor})  -> {ok, inputs (src/context.mjs compileContext inputs), next, confidentiality}
//                                                 The battery compiles `inputs` with the real context compiler and scores what
//                                                 the PROMPT contains; `next` is the design's own continuation (null: none).
//   supporters(reader, topic, member), compact(topic), carry(), dispose()
//
// Designs (no model calls anywhere):
//   N0 shared notes   One append-only notes list every agent reads and writes (a shared NOTES.md, a group-chat pool, Letta
//                     memory_insert on a shared block). No writer control, no labels, persisted across runs. A read over the
//                     budget shows the newest notes that fit (what a summarise-or-truncate context manager keeps); `next` scrolls
//                     to older notes.
//   N1 shared dict    One key/value object, last write wins (a LangGraph channel without a reducer, a cross-thread store item,
//                     Letta memory_rethink). No writer control, no labels, no compare-and-swap, persisted across runs.
//   N2 labelled store N0 plus integrity and confidentiality labels that propagate and gate sinks (the FIDES model), but labels are
//                     self-describing: a value carrying a `security_label` object is labelled by it (the APIsec 2026 finding).
//   E0 plain edges    Foundry today: typed edges between nodes plus src/state.mjs slots (review finding #4; the R-10 comparator).
//                     An lww topic is a `record` state slot run by the REAL StateStore (src/state.mjs: compare-and-swap with
//                     ifVersion, bounds, a durable cross-run scope), with the slot's declared writers (validate.mjs STATE_WRITER)
//                     and its label ceiling (runtime.mjs LABEL_POLICY UNTRUSTED_STATE_WRITE); a read carries the slot label.
//                     Every other topic is a set of edges: each declared writer node's typed output (a list, maxItems =
//                     maxEventsPerWriter) wired to each declared reader. A reader's context has one input per wired writer,
//                     labelled by the runtime from that writer's inputs, with a static per-input cap of budget / writers (the
//                     compiler truncates over it and says so in the prompt and the receipt). There is no paging, no mid-flight
//                     read (a reader runs after its upstream nodes complete), no compaction (outputs are immutable) and no
//                     provenance-aware counting: a reader counts the upstream outputs that contain a claim.
//   F  board          experiments/memory/board.mjs revision 2: declared topics, writers, readers, label ceilings, quotas, CAS,
//                     pinned-seq reads, fair paging, derived provenance, exact compaction; it does not outlive the run.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonical, clone } from '../../src/data.mjs';
import { estimateTokens, joinLabels } from '../../src/context.mjs';
import { declarationHash, stateRequest } from '../../src/state.mjs';
import { stateLabelMessage, validateData } from '../../src/validate.mjs';
import { Store } from '../../src/store.mjs';

import { Board, flowsTo } from './board.mjs';

export const CONFIDENTIALITY = Object.freeze(['public', 'internal', 'secret']);
const joinConfidentiality = levels => CONFIDENTIALITY[Math.max(0, ...levels.map(l => CONFIDENTIALITY.indexOf(l)))];
const tokensOf = value => estimateTokens(canonical(value)) + 1;
const inputName = (topic, suffix) => `${topic}${suffix ? `_${suffix}` : ''}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
// Newest-first pages over a list: the first read shows the newest items that fit the budget (in chronological order); `next`
// is how many of the newest items were already shown, so a reader can scroll back to older ones.
function newestFirst(items, budget = Infinity, cursor = 0) {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > items.length) return { error: 'BAD_CURSOR' };
  const kept = []; let used = 0, i = items.length - 1 - cursor;
  for (; i >= 0; i--) { const t = tokensOf(items[i]); if (used + t > budget - 2) break; used += t; kept.unshift(items[i]); }
  return { items: kept, next: i >= 0 && kept.length ? cursor + kept.length : null };
}

// Journal-before-observe for a store Foundry does not journal itself: the journal must hold what the reader observed (the
// content), and a replay serves it from there.
const contentJournal = r => ({ bytes: Buffer.byteLength(canonical(r.inputs.map(i => i.value))), replay: () => clone(r.inputs) });
const refBytes = r => Buffer.byteLength(canonical(r.inputs.map(i => i.sourceRef ?? null)));

export class SharedNotes {
  static id = 'N0-shared-notes';
  constructor({ carry } = {}) { this.notes = carry ? clone(carry) : []; }
  write(writer, topic, value) { this.notes.push({ topic, writer, value: clone(value) }); return { ok: true }; }
  read(reader, topic, { budgetTokens, cursor } = {}) {
    const page = newestFirst(this.notes.filter(n => n.topic === topic).map(n => n.value), budgetTokens, cursor ?? 0);
    if (page.error) return { ok: false, code: page.error };
    return { ok: true, inputs: [{ name: inputName(topic), value: page.items, label: 'trusted', render: 'json' }], next: page.next, confidentiality: 'public' };
  }
  journal(r) { return contentJournal(r); }
  readKey(reader, topic, keyField, key) { const hit = this.notes.filter(n => n.topic === topic && n.value?.[keyField] === key).at(-1); return { value: hit?.value ?? null, version: null }; }
  writeKey(writer, topic, value) { return this.write(writer, topic, value); }
  supporters(reader, topic, member) { return this.notes.filter(n => n.topic === topic && canonical(n.value) === canonical(member)).length; }
  compact(topic) { const kept = this.notes.filter(n => n.topic !== topic), summary = { topic, writer: 'summarizer', value: { summary: this.notes.filter(n => n.topic === topic).map(n => n.value) } }; this.notes = [...kept, summary]; }
  carry() { return clone(this.notes); }
  dispose() {}
}

export class SharedDict {
  static id = 'N1-shared-dict';
  constructor({ carry } = {}) { this.state = carry ? clone(carry) : {}; }
  write(writer, topic, value) { this.state[topic] = clone(value); return { ok: true }; }
  // A topic read sees the topic's own value and every keyed entry under it (what a node reading "the state" sees).
  read(reader, topic, { budgetTokens, cursor } = {}) {
    const keyed = Object.keys(this.state).filter(k => k.startsWith(`${topic}/`)).sort().map(k => this.state[k]);
    const page = newestFirst([...(this.state[topic] === undefined ? [] : [this.state[topic]]), ...keyed], budgetTokens, cursor ?? 0);
    if (page.error) return { ok: false, code: page.error };
    return { ok: true, inputs: [{ name: inputName(topic), value: page.items, label: 'trusted', render: 'json' }], next: page.next, confidentiality: 'public' };
  }
  journal(r) { return contentJournal(r); }
  readKey(reader, topic, keyField, key) { const v = this.state[`${topic}/${key}`]; return { value: v ?? null, version: null }; }
  writeKey(writer, topic, value, { keyField }) { this.state[`${topic}/${value[keyField]}`] = clone(value); return { ok: true }; }
  supporters(reader, topic, member) { return this.state[topic] !== undefined && canonical(this.state[topic]) === canonical(member) ? 1 : 0; }
  compact() {}
  carry() { return clone(this.state); }
  dispose() {}
}

const selfLabel = value => {
  const s = value && typeof value === 'object' && !Array.isArray(value) ? value.security_label : undefined;
  return s && typeof s === 'object' ? { label: s.integrity === 'trusted' ? 'trusted' : 'untrusted:self', confidentiality: CONFIDENTIALITY.includes(s.confidentiality) ? s.confidentiality : 'public' } : null;
};
export class LabelledStore {
  static id = 'N2-labelled-store';
  constructor({ carry } = {}) { this.notes = carry ? clone(carry) : []; }
  write(writer, topic, value, meta = {}) {
    const own = selfLabel(value);
    this.notes.push({ topic, writer, value: clone(value), label: own?.label ?? meta.label ?? 'trusted', confidentiality: own?.confidentiality ?? meta.confidentiality ?? 'public' });
    return { ok: true };
  }
  read(reader, topic, { budgetTokens, cursor } = {}) {
    const mine = this.notes.filter(n => n.topic === topic), at = cursor ?? 0, page = newestFirst(mine.map(n => n.value), budgetTokens, at);
    if (page.error) return { ok: false, code: page.error };
    const shown = mine.slice(mine.length - at - page.items.length, mine.length - at);
    return { ok: true, inputs: [{ name: inputName(topic), value: page.items, label: joinLabels(['trusted', ...shown.map(n => n.label)]), render: 'json' }], next: page.next,
      confidentiality: joinConfidentiality(shown.map(n => n.confidentiality)) };
  }
  journal(r) { return contentJournal(r); }
  readKey(reader, topic, keyField, key) { const hit = this.notes.filter(n => n.topic === topic && n.value?.[keyField] === key).at(-1); return { value: hit?.value ?? null, version: null }; }
  writeKey(writer, topic, value, meta = {}) { return this.write(writer, topic, value, meta); }
  supporters(reader, topic, member) { return this.notes.filter(n => n.topic === topic && canonical(n.value) === canonical(member)).length; }
  compact(topic) {
    const mine = this.notes.filter(n => n.topic === topic);
    this.notes = [...this.notes.filter(n => n.topic !== topic), { topic, writer: 'summarizer', value: { summary: mine.map(n => n.value) }, label: joinLabels(['trusted', ...mine.map(n => n.label)]), confidentiality: joinConfidentiality(mine.map(n => n.confidentiality)) }];
  }
  carry() { return clone(this.notes); }
  dispose() {}
}

let e0Count = 0;
export class PlainEdges {
  static id = 'E0-edges+state';
  // A reader runs after its upstream nodes complete: there is no read in the middle of its writers' work.
  static midFlightReads = false;
  constructor({ decl, runId = 'run-1', carry } = {}) {
    this.decl = decl; this.runId = runId; this.outputs = {}; this.keys = {}; this.clock = 1;
    // State slots are durable and shared by every run of the workflow (src/state.mjs): a carried store is the same workflow.
    if (carry) { // the next run of the same workflow: same store and workflow id; the store's ownership moves to this run
      this.store = carry.store; this.dir = carry.dir; this.workflowId = carry.workflowId; this.keys = clone(carry.keys);
      this.ownsStore = true; carry.from.ownsStore = false;
    }
    else { this.store = null; this.workflowId = `wf-e0-${++e0Count}`; this.ownsStore = true; }
  }
  // The SQLite store is opened on the first state operation (most scenarios use edges only).
  #db() { if (!this.store) { this.dir = mkdtempSync(path.join(os.tmpdir(), 'mem0b-e0-')); this.store = new Store(this.dir); } return this.store; }
  #topic(name) { return this.decl.topics[name]; }
  #slot(name) { const t = this.#topic(name); return { type: 'record', writer: [...t.writers], maxItems: t.maxEvents, label: t.label, ...(t.schema ? { schema: t.schema } : {}) }; }
  #state(name, op, args, writer) {
    const slot = this.#slot(name), request = stateRequest(this.workflowId, name, op, args, declarationHash(slot, []));
    const store = this.#db();
    return store.transaction(() => store.state.apply(slot, request, { now: this.clock++, runId: this.runId, nodeKey: writer,
      check: (schema, value) => { if (schema) validateData(schema, value, 'state value'); } }));
  }
  write(writer, topic, value, meta = {}) {
    const t = this.#topic(topic);
    if (!t || t.reducer === 'lww') return { ok: false, code: 'EDGE_NOT_WIRED' };
    // An output that is not wired to the reader never reaches it (validate.mjs: a $ref names a declared upstream node).
    if (!t.writers.includes(writer)) return { ok: false, code: 'EDGE_NOT_WIRED' };
    const mine = ((this.outputs[topic] ??= {})[writer] ??= []);
    if (mine.length >= t.maxEventsPerWriter) return { ok: false, code: 'OUTPUT_SCHEMA' };   // the output's maxItems
    if (Buffer.byteLength(canonical(value)) > t.maxEventBytes) return { ok: false, code: 'OUTPUT_SCHEMA' };
    mine.push({ value: clone(value), label: joinLabels([meta.label ?? 'trusted']) });
    return { ok: true };
  }
  writeKey(writer, topic, value, { keyField, version, label = 'trusted' } = {}) {
    const t = this.#topic(topic);
    if (!t.writers.includes(writer)) return { ok: false, code: 'STATE_WRITER' };
    const flowing = joinLabels([label]);
    if (!flowsTo(flowing, t.label)) return { ok: false, code: 'LABEL_POLICY', message: stateLabelMessage(topic, t.label, flowing) };
    const key = String(value[keyField]), r = this.#state(topic, 'put', { key, value, ifVersion: version ?? 0 }, writer);
    if (r.ok) (this.keys[topic] ??= []).includes(key) || this.keys[topic].push(key);
    return r.ok ? { ok: true } : { ok: false, code: r.error.code };
  }
  readKey(reader, topic, keyField, key) { const r = this.#state(topic, 'get', { key: String(key) }, reader); return { value: r.output.value ?? null, version: r.output.version }; }
  // Node outputs are journaled once as the run record and are immutable once their node completes, so a read journals only its
  // $ref sourceRefs and a replay re-resolves them.
  journal(r) { return { bytes: refBytes(r), replay: () => this.read(r.request.reader, r.request.topic, r.request.opts).inputs }; }
  read(reader, topic, opts = {}) {
    const r = this.#read(reader, topic, opts);
    return { ...r, request: { reader, topic, opts } };
  }
  #read(reader, topic, { budgetTokens = Infinity, cursor } = {}) {
    if (cursor !== undefined) return { ok: false, code: 'NO_CONTINUATION' };
    const t = this.#topic(topic);
    if (t.reducer === 'lww') {
      const values = (this.keys[topic] ?? []).map(k => this.readKey(reader, topic, t.key, k).value).filter(v => v !== null);
      return { ok: true, inputs: [{ name: inputName(topic), value: values, label: t.label, render: 'json', ...(Number.isFinite(budgetTokens) ? { maxTokens: budgetTokens } : {}), sourceRef: `state:${topic}` }], next: null, confidentiality: 'public' };
    }
    if (!t.readers.includes(reader)) return { ok: true, inputs: [], next: null, confidentiality: 'public' };   // not wired: no such input
    const per = Number.isFinite(budgetTokens) ? Math.max(1, Math.floor(budgetTokens / t.writers.length)) : undefined;
    const inputs = t.writers.filter(w => this.outputs[topic]?.[w]?.length).map(w => ({ name: inputName(topic, w), value: this.outputs[topic][w].map(o => o.value),
      label: joinLabels(['trusted', ...this.outputs[topic][w].map(o => o.label)]), render: 'json', ...(per ? { maxTokens: per } : {}), sourceRef: `$ref:${w}.output` }));
    return { ok: true, inputs, next: null, confidentiality: 'public' };
  }
  supporters(reader, topic, member) { return Object.values(this.outputs[topic] ?? {}).filter(out => out.some(o => canonical(o.value) === canonical(member))).length; }
  compact() {}
  // Edges die with the run; state slots are cross-run by design (the next run of the workflow sees them).
  carry() { return Object.keys(this.keys).length ? { store: this.store, dir: this.dir, workflowId: this.workflowId, keys: this.keys, from: this } : null; }
  dispose() { if (this.ownsStore && this.store) { this.store.close(); rmSync(this.dir, { recursive: true, force: true }); } this.ownsStore = false; }
}

/** The Foundry board behind the same contract. Write refusals are returned; read refusals are caught as {ok: false, code}. */
export class FoundryBoard {
  static id = 'F-board';
  constructor({ decl, runId = 'run-1' } = {}) { this.board = new Board(decl, { runId }); this.decl = decl; }
  write(writer, topic, value, meta = {}) { return this.board.write(writer, topic, value, meta); }
  // Every read goes through the context path (Board.readsFor): declared reader, one pinned seq, a fair page when over the cap.
  read(reader, topic, { budgetTokens, cursor } = {}) {
    const spec = { topic, ...(Number.isFinite(budgetTokens) ? { maxTokens: budgetTokens } : {}), ...(cursor !== undefined ? { cursor } : {}) };
    try {
      const r = this.board.readsFor(reader, [spec]);
      return { ok: true, inputs: r.inputs, next: r.pages[0]?.next ?? null, confidentiality: 'public', atSeq: r.atSeq, request: { reader, spec } };
    } catch (e) { return { ok: false, code: e.code }; }
  }
  // The board's events are the journal; a read journals only its sourceRefs (board:<topic>@<seq>[#cursor]). A replay rebuilds
  // the board from the recorded events (Board.replay re-validates and re-hashes every one) and folds it at the recorded seq.
  journal(r) {
    return { bytes: refBytes(r), replay: () => Board.replay(this.decl, { runId: this.board.runId, events: this.board.events }).readsFor(r.request.reader, [r.request.spec], { atSeq: r.atSeq }).inputs };
  }
  readKey(reader, topic, keyField, key) {
    let value = null;
    try { value = this.board.view(reader, topic).value?.[String(key)] ?? null; } catch { value = null; }
    return { value, version: this.board.version(topic, key) };
  }
  writeKey(writer, topic, value, meta = {}) { return this.write(writer, topic, value, { ...meta, expectSeq: meta.version }); }
  supporters(reader, topic, member) { return this.board.independentSupport(reader, topic, member).independent; }
  compact() { this.board.compact(); }
  // The run board dies with the run.
  carry() { return null; }
  dispose() {}
}

export const DESIGNS = Object.freeze([SharedNotes, SharedDict, LabelledStore, PlainEdges, FoundryBoard]);
