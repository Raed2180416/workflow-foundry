#!/usr/bin/env node
// Mutation check for the memory prototype's tests (research/memory-20261021/MEMORY-MODEL.md §5). It applies one single-line
// mutant to experiments/memory/board.mjs at a time, runs experiments/memory/test/board.test.mjs, and restores the file in a
// `finally` (run it on a clean checkout; an interrupted run is undone with `git checkout experiments/memory/board.mjs`).
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
  ['M4 same writer counted twice', '|| writers.has(s.writer)) continue;', ') continue;'],
  ['M5 fingerprint not checked on admission', 'if (evidence.fingerprint !== current.fingerprint) return no', 'if (false) return no'],
  ['M6 in-sample evidence accepted', 'if (runs.some(r => mined.has(r))) return no', 'if (false) return no'],
  ['M7 no writer check', 'if (!topic.writers.includes(writer)) return refuse', 'if (false) return refuse'],
  ['M8 no clearance check', 'if (rank(clearance) < rank(topic.confidentiality)) fail', 'if (false) fail'],
  ['M9 view cut instead of refused', 'if (tokens > cap) fail(', 'if (false) fail('],
  ['M10 quota not enforced', 'if ((state.perWriter[writer] ?? 0) >= topic.maxEventsPerWriter) return refuse', 'if (false) return refuse'],
  ['M11 derived org claims trusted', "c.origin === 'authored' && this.trusted.has(c.principal)", 'this.trusted.has(c.principal)'],
  ['M12 superseded claims served', '(c.validTo === null || at < Date.parse(c.validTo))', 'true'],
  ['M13 refusal mutates head', 'const refuse = (code, message) => {', "const refuse = (code, message) => { this.head = 'x';"],
  // Expected to survive: the event hash already covers the value, so this comparison is redundant (an equivalent mutant).
  ['M14 verify ignores value hash (equivalent)', '|| digest(body.value) !== body.valueHash) return false;', ') return false;'],
];

export function mutationCheck() {
  const original = readFileSync(target, 'utf8'), results = [];
  try {
    for (const [name, from, to] of MUTANTS) {
      if (!original.includes(from)) { results.push({ name, status: 'PATTERN_NOT_FOUND' }); continue; }
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
  for (const r of results) console.log(`${r.status.padEnd(9)} ${r.name}`);
  console.log(`killed ${results.filter(r => r.status === 'KILLED').length}/${results.length}`);
}
