#!/usr/bin/env node
// Mutation check for the run-board prototype's tests (research/memory-20261021/MEMORY-MODEL.md §5), revision 2. It applies one
// single-site mutant to experiments/memory/board.mjs at a time, runs experiments/memory/test/board.test.mjs, and restores the
// file in a `finally` (run it on a clean checkout; an interrupted run is undone with `git checkout experiments/memory/board.mjs`).
// A mutant is KILLED when at least one test fails. $0, no model calls.
//   node experiments/memory/mutation-check.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const target = fileURLToPath(new URL('./board.mjs', import.meta.url)), testFile = 'experiments/memory/test/board.test.mjs';
export const MUTANTS = [
  ['M1 no label ceiling', 'if (!flowsTo(label, topic.label)) return refuse', 'if (false) return refuse'],
  ['M2 checkpoint ignored on fold', 'const state = this.checkpoint ? clone(this.checkpoint.states[topicName]) : emptyState(topic.reducer);', 'const state = emptyState(topic.reducer);'],
  ['M3 labels not joined into views', "if (e.label !== 'trusted' && !state.labels.includes(e.label)) state.labels.push(e.label);", ';'],
  ['M4 same writer counted twice', '|| writers.has(s.writer) ||', '||'],
  ['M5 no writer check', 'if (!topic.writers.includes(writer)) return refuse', 'if (false) return refuse'],
  ['M6 no reader check', 'if (!topic.readers.includes(reader)) fail(', 'if (false) fail('],
  ['M7 quota not enforced', 'if ((state.perWriter[writer] ?? 0) >= topic.maxEventsPerWriter) return refuse', 'if (false) return refuse'],
  ['M8 refusal mutates head', 'const refuse = (code, message) => {', "const refuse = (code, message) => { this.head = 'x';"],
  ['M9 reads not logged (no derived provenance)', 'this.reads.push({ reader, topic: topicName, atSeq });', ';'],
  ['M10 receipt sourceRefs ignored', '[...declared, ...fromReceipt, ...this.#readRefs(writer)]', '[...declared, ...this.#readRefs(writer)]'],
  ['M11 board:<topic>@<seq> not followed in ancestry', 'else if (b) { for (const n of this.topicSeqs[b[1]] ?? []) { if (n > +b[2]) break; add(n); } }', 'else if (b) {}'],
  ['M12 common external source ignored', '|| [...anc.external].some(x => counted.has(x))) continue;', ') continue;'],
  ['M13 page in seq order (no per-writer fairness)', '(groups[r.writer] ??= [])', '(groups[rows[0].writer] ??= [])'],
  ['M14 no round-robin of unused shares', 'for (let progress = true; progress;) {', 'for (let progress = false; progress;) {'],
  ['M15 no continuation cursor (silent cut)', 'const next = Object.keys(omitted).length ?', 'const next = false ?'],
  ['M16 omissions not reported', 'const omitted = Object.fromEntries(writers.filter(w => left(w) > 0).map(w => [w, left(w)]));', 'const omitted = {};'],
  ['M17 verify ignores the fold state', 'if (digest(state) !== digest(this.states[name])) return false;', ';'],
  ['M18 verify ignores the checkpoint hash', 'if (this.checkpoint && digest(this.checkpoint.states) !== this.checkpoint.statesHash) return false;', ';'],
  ['M19 root without the state hash', 'seq: this.seq, head: this.head, statesHash: digest(this.states),', 'seq: this.seq, head: this.head,'],
  ['M20 verify ignores lineage', 'return this.events.every(e => canonical(this.lineage.get(e.seq))', 'return true || this.events.every(e => canonical(this.lineage.get(e.seq))'],
  ['M21 no page-fit check on declarations', 'if (PAGED.includes(t.reducer) && Math.ceil(maxEventBytes / 4) + 1 + frame > maxViewTokens)', 'if (false)'],
  ['M22 view label keeps only the last source', "value, label: joinLabels(['trusted', ...state.labels]), events", "value, label: joinLabels(['trusted', ...state.labels.slice(-1)]), events"],
  ['M23 independentSupport without a reader check', 'const { topic, state } = this.#read(reader, topicName, atSeq);', 'const topic = this.decl.topics[topicName], state = this.#fold(topicName, atSeq);'],
  ['M24 compaction resets the fold state', '[n, clone(this.#fold(n, atSeq))]', '[n, emptyState(this.decl.topics[n].reducer)]'],
  ['M25 no compare-and-swap', "if (meta.expectSeq !== current) return refuse('BOARD_STALE'", "if (false) return refuse('BOARD_STALE'"],
  // Expected to survive: the event hash already covers the value, so this comparison is redundant (an equivalent mutant).
  ['M26 verify ignores value hash (equivalent)', '|| digest(body.value) !== body.valueHash) return false;', ') return false;'],
];

export function mutationCheck() {
  const original = readFileSync(target, 'utf8'), results = [];
  try {
    for (const [name, from, to] of MUTANTS) {
      if (original.split(from).length !== 2) { results.push({ name, status: 'PATTERN_NOT_UNIQUE' }); continue; }
      writeFileSync(target, original.replace(from, to));
      const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', testFile], { cwd: root, encoding: 'utf8' });
      const failed = Number(/ℹ fail (\d+)/.exec(r.stdout)?.[1] ?? NaN);
      results.push({ name, status: failed > 0 ? 'KILLED' : 'SURVIVED', failedTests: failed });
    }
  } finally { writeFileSync(target, original); }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = mutationCheck();
  for (const r of results) console.log(`${r.status.padEnd(18)} ${r.name}`);
  console.log(`killed ${results.filter(r => r.status === 'KILLED').length}/${results.length}`);
}
