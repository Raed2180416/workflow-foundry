// Spawn-tree parser (experiments/swarm/spawn-tree.mjs) on a real recorded session: the capability probe of 2026-11-04
// (fixtures/probe-transcript.jsonl: one Haiku lead, three Haiku workers started in one message, CLI 2.1.318 with
// --forward-subagent-text), plus synthetic edge cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSpawnTree, readEvents, writesOf, pathsOf, reportOf, unionMs, maxOverlap } from '../spawn-tree.mjs';

const events = readEvents(readFileSync(new URL('./fixtures/probe-transcript.jsonl', import.meta.url), 'utf8'));
const probe = JSON.parse(readFileSync(new URL('./fixtures/probe-result.json', import.meta.url), 'utf8'));

test('the recorded probe: three workers in one batch, each forwarded, each on Haiku, each returned its word', () => {
  const tree = parseSpawnTree(events);
  assert.equal(tree.workers.length, 3);
  assert.equal(tree.batches.length, 1); assert.equal(tree.batches[0].size, 3); assert.equal(tree.maxConcurrent, 3);
  assert.deepEqual(Object.keys(tree.models), ['claude-haiku-5-5']);
  const words = Object.values(probe.expected);
  for (const w of tree.workers) {
    assert.ok(w.events > 0, 'worker turns were forwarded (parent_tool_use_id)');
    assert.ok(w.turns >= 1); assert.equal(w.isError, false);
    assert.deepEqual(Object.keys(w.models), ['claude-haiku-5-5']);
    assert.ok(words.some(x => w.report.includes(x)), w.report);
    assert.ok(Number.isFinite(w.durationMs) && w.durationMs > 0);
  }
  // the workers ran in parallel: their intervals overlap, and the union is shorter than the sum
  assert.equal(tree.timing.overlapMax, 3);
  assert.ok(tree.timing.workerMsUnion < tree.timing.workerMsSum);
  // Kimi's critical steps: lead turns plus the slowest worker of the one batch
  assert.equal(tree.criticalSteps, tree.lead.turns + Math.max(...tree.workers.map(w => w.turns)));
  assert.equal(tree.stats.spawned, 3); assert.equal(tree.stats.max_depth, 1);
  assert.ok(tree.lead.writes.some(p => p.endsWith('answer.json')), 'the lead wrote answer.json');
});

test('two lead messages make two batches; a forwarded event of an unknown parent is ignored', () => {
  const spawn = (mid, id) => ({ type: 'assistant', message: { id: mid, model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id, name: 'Agent', input: { prompt: `brief ${id}`, description: 'd' } }] } });
  const ev = [spawn('m1', 'a'), spawn('m2', 'b'),
    { type: 'assistant', parent_tool_use_id: 'zzz', message: { id: 'x', model: 'claude-opus-5-5', content: [] } },
    { type: 'assistant', parent_tool_use_id: 'a', message: { id: 'w1', model: 'claude-haiku-5-5', content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'work/a/out.json', content: '{}' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: 'ok a' }] }] } }];
  const tree = parseSpawnTree(ev);
  assert.equal(tree.batches.length, 2); assert.equal(tree.maxConcurrent, 1);
  assert.equal(tree.workers[0].result, 'ok a'); assert.equal(tree.workers[1].result, null, 'b never returned');
  assert.deepEqual(tree.workers[0].writes, ['work/a/out.json']);
  assert.equal(tree.models['claude-opus-5-5'], undefined, 'an orphan event does not enter the model census');
});

test('writesOf: file tools and Bash redirections; reads are not writes', () => {
  assert.deepEqual(writesOf({ name: 'Write', input: { file_path: 'a.json' } }), ['a.json']);
  assert.deepEqual(writesOf({ name: 'Bash', input: { command: 'grep x files/corpus/*.txt > work/w1/hits.txt 2>&1 && cat a | tee -a work/w1/log' } }), ['work/w1/hits.txt', 'work/w1/log']);
  assert.deepEqual(writesOf({ name: 'Bash', input: { command: 'cat x > /dev/null; echo 2>&1' } }), []);
  assert.deepEqual(writesOf({ name: 'Read', input: { file_path: 'a' } }), []);
  assert.deepEqual(pathsOf({ name: 'Bash', input: { command: 'cat files/corpus/D012.txt files/corpus/D013.txt' } }), ['files/corpus/D012.txt', 'files/corpus/D013.txt']);
});

test('reportOf strips the harness frame; interval helpers', () => {
  assert.equal(reportOf('Agent done. The report follows:\n  line 1\n    line 2\nagentId: abc-1'), 'line 1\n  line 2');
  assert.equal(reportOf('plain'), 'plain');
  assert.equal(unionMs([[0, 10], [5, 20], [30, 40]]), 30);
  assert.equal(maxOverlap([[0, 10], [5, 20], [30, 40]]), 2);
});
