// Memory designs compared by the MEM-0b battery (battery.mjs), all behind one adapter interface so every scenario runs the same
// script against each. The baselines are the common shapes in shipping frameworks as of 2026-11, reduced to their sharing
// semantics (no model calls anywhere):
//   N0 shared notes   One append-only notes file every agent reads and writes (a shared NOTES.md, a group-chat message pool, Letta
//                     memory_insert on a shared block). No writer control, no labels, persisted across runs.
//   N1 shared dict    One key/value state object, last write wins (a LangGraph channel without a reducer or a cross-thread store
//                     item, Letta memory_rethink). No writer control, no labels, no compare-and-swap, persisted across runs.
//   N2 labelled store N0 plus integrity and confidentiality labels that propagate and gate sinks (the FIDES model), but labels are
//                     self-describing: a value carrying a `security_label` object is labelled by it (the APIsec 2026 finding in the
//                     FIDES middleware). No writer or reader control. Labels survive compaction. Persisted across runs.
//   F  Foundry board  experiments/memory/board.mjs: declared topics, writers, readers, label ceilings, clearance, quotas, CAS,
//                     pinned-seq reads, exact compaction; the run board does not outlive the run (cross-run memory is VersionNotes).
import { canonical, clone } from '../../src/data.mjs';
import { estimateTokens, joinLabels } from '../../src/context.mjs';
import { Board, joinConfidentiality } from './board.mjs';

const tokensOf = value => estimateTokens(canonical(value));
// A reader with a token budget over an unbounded notes list keeps the most recent notes that fit (a tail window: what a
// summarise-or-truncate context manager keeps). Board views are never cut; they are refused when over their cap.
const tail = (items, budget) => {
  if (budget === undefined) return items;
  const kept = []; let used = 0;
  for (let i = items.length - 1; i >= 0; i--) { const t = tokensOf(items[i]); if (used + t > budget) break; used += t; kept.unshift(items[i]); }
  return kept;
};

export class SharedNotes {
  static id = 'N0-shared-notes';
  constructor({ carry } = {}) { this.notes = carry ? clone(carry) : []; }
  write(writer, topic, value) { this.notes.push({ topic, writer, value: clone(value) }); return { ok: true }; }
  read(reader, topic, { budgetTokens } = {}) {
    const items = tail(this.notes.filter(n => n.topic === topic).map(n => n.value), budgetTokens);
    return { ok: true, value: items, label: 'trusted', confidentiality: 'public' };
  }
  readKey(reader, topic, keyField, key) { const hit = this.notes.filter(n => n.topic === topic && n.value?.[keyField] === key).at(-1); return { value: hit?.value ?? null, version: null }; }
  writeKey(writer, topic, value) { return this.write(writer, topic, value); }
  supporters(reader, topic, member) { return this.notes.filter(n => n.topic === topic && canonical(n.value) === canonical(member)).length; }
  compact(topic) { const kept = this.notes.filter(n => n.topic !== topic), summary = { topic, writer: 'summarizer', value: { summary: this.notes.filter(n => n.topic === topic).map(n => n.value) } }; this.notes = [...kept, summary]; }
  readCompacted(reader, topic) { const s = this.notes.filter(n => n.topic === topic).at(-1); return { ok: true, value: s?.value ?? null, label: 'trusted', confidentiality: 'public' }; }
  carry() { return clone(this.notes); }
}

export class SharedDict {
  static id = 'N1-shared-dict';
  constructor({ carry } = {}) { this.state = carry ? clone(carry) : {}; }
  write(writer, topic, value) { this.state[topic] = clone(value); return { ok: true }; }
  // A topic read returns the topic's own value and every keyed entry under it (what a node reading "the state" sees).
  read(reader, topic) {
    const keyed = Object.keys(this.state).filter(k => k.startsWith(`${topic}/`)).sort().map(k => this.state[k]);
    return { ok: true, value: [...(this.state[topic] === undefined ? [] : [this.state[topic]]), ...keyed], label: 'trusted', confidentiality: 'public' };
  }
  readKey(reader, topic, keyField, key) { const v = this.state[`${topic}/${key}`]; return { value: v ?? null, version: null }; }
  writeKey(writer, topic, value, { keyField }) { this.state[`${topic}/${value[keyField]}`] = clone(value); return { ok: true }; }
  supporters(reader, topic, member) { return this.state[topic] !== undefined && canonical(this.state[topic]) === canonical(member) ? 1 : 0; }
  compact() {}
  readCompacted(reader, topic) { return this.read(reader, topic); }
  carry() { return clone(this.state); }
}

const selfLabel = value => {
  const s = value && typeof value === 'object' && !Array.isArray(value) ? value.security_label : undefined;
  return s && typeof s === 'object' ? { label: s.integrity === 'trusted' ? 'trusted' : 'untrusted:self', confidentiality: ['public', 'internal', 'secret'].includes(s.confidentiality) ? s.confidentiality : 'public' } : null;
};
export class LabelledStore {
  static id = 'N2-labelled-store';
  constructor({ carry } = {}) { this.notes = carry ? clone(carry) : []; }
  write(writer, topic, value, meta = {}) {
    const own = selfLabel(value);
    this.notes.push({ topic, writer, value: clone(value), label: own?.label ?? meta.label ?? 'trusted', confidentiality: own?.confidentiality ?? meta.confidentiality ?? 'public' });
    return { ok: true };
  }
  read(reader, topic, { budgetTokens } = {}) {
    const items = tail(this.notes.filter(n => n.topic === topic), budgetTokens);
    return { ok: true, value: items.map(n => n.value), label: joinLabels(['trusted', ...items.map(n => n.label)]), confidentiality: joinConfidentiality(items.map(n => n.confidentiality)) };
  }
  readKey(reader, topic, keyField, key) { const hit = this.notes.filter(n => n.topic === topic && n.value?.[keyField] === key).at(-1); return { value: hit?.value ?? null, version: null }; }
  writeKey(writer, topic, value, meta = {}) { return this.write(writer, topic, value, meta); }
  supporters(reader, topic, member) { return this.notes.filter(n => n.topic === topic && canonical(n.value) === canonical(member)).length; }
  compact(topic) {
    const mine = this.notes.filter(n => n.topic === topic);
    this.notes = [...this.notes.filter(n => n.topic !== topic), { topic, writer: 'summarizer', value: { summary: mine.map(n => n.value) }, label: joinLabels(['trusted', ...mine.map(n => n.label)]), confidentiality: joinConfidentiality(mine.map(n => n.confidentiality)) }];
  }
  readCompacted(reader, topic) { return this.read(reader, topic); }
  carry() { return clone(this.notes); }
}

/** The Foundry board behind the same interface. Refusals are returned (writes) or caught (reads) as {ok: false, code}. */
export class FoundryBoard {
  static id = 'F-board';
  // Readers read at the sequence number their receipt recorded, so a replay rebuilds the log and serves the same view.
  static pinnedReads = true;
  constructor({ decl, runId = 'run-1' } = {}) { this.board = new Board(decl, { runId }); this.decl = decl; }
  write(writer, topic, value, meta = {}) { return this.board.write(writer, topic, value, meta); }
  // Every read goes through the context path (Board.readsFor): declared reader, clearance, one pinned seq, the topic's token cap.
  read(reader, topic, { atSeq } = {}) {
    try {
      const r = this.board.readsFor(reader, [{ topic }], atSeq === undefined ? {} : { atSeq }), input = r.inputs[0];
      return { ok: true, value: Array.isArray(input.value) ? input.value : [input.value], label: input.label, confidentiality: r.confidentiality, atSeq: r.atSeq };
    } catch (e) { return { ok: false, code: e.code, value: [], label: 'trusted', confidentiality: 'public' }; }
  }
  readKey(reader, topic, keyField, key) {
    const v = this.read(reader, topic);
    const value = v.ok ? (v.value[0]?.[String(key)] ?? null) : null;
    return { value, version: this.board.version(topic, key) };
  }
  writeKey(writer, topic, value, meta = {}) { return this.write(writer, topic, value, { ...meta, expectSeq: meta.version }); }
  supporters(reader, topic, member) { return this.board.independentSupport(reader, topic, member).independent; }
  compact() { this.board.compact(); }
  readCompacted(reader, topic) { return this.read(reader, topic); }
  // The run board dies with the run. Cross-run memory is VersionNotes (admitNote), which needs replay evidence.
  carry() { return null; }
}

export const DESIGNS = Object.freeze([SharedNotes, SharedDict, LabelledStore, FoundryBoard]);
