// The 2026-10-14 probe's three hand-written properties, ported to code-owned templates, must give the same verdicts on the three
// frozen E8 builds on practice world 1237 (d5) (experiments/tracker/test/run.test.mjs holds the property versions): lineage 3 fails
// line 162 on the 4 partial reserves, B1-O fails per-item keys on its REFUSED proposals, lineage 1 passes; R1.1 passes for all three.
// $0: builds run out of process in the executor sandbox (skipped where the sandbox is unavailable).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import * as e8 from '../../../beds/ebed/e8/index.mjs';
import { runBuild } from '../../tracker/run.mjs';
import { evaluate } from '../../../app/core/tracker/checks.mjs';
import { statusOf } from '../../../app/core/tracker/status.mjs';
import { realShape } from '../../../app/core/tracker/gates.mjs';
import { lintCheck } from '../../../app/core/tracker/vocab.mjs';
import { viewOfTrace, e8Vocabulary, PROBES } from '../e8.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ITEM = { binding: e8.binding, generateWorld: e8.generateWorld, oracleItem: e8.oracleItem };
const skip = !sandboxAvailable() && 'sandbox unavailable';
const BUILD = l => readFileSync(path.join(ROOT, `research/enterprise-20261014/runs/${l}/solver.mjs`), 'utf8');

test('probe templates reproduce the probe verdicts on lineage 1, lineage 3 and B1-O (world 1237, d5)', { skip, timeout: 300_000 }, async () => {
  const views = {};
  for (const label of ['b1lh-e8-1', 'b1lh-e8-3', 'b1o-e8-1']) {
    const runs = await runBuild({ item: ITEM, solverSource: BUILD(label), practice: { seeds: [1237], difficulties: [5] } });
    views[label] = viewOfTrace(runs[0].trace, { id: `${label}:1237` });
  }
  const vocab = e8Vocabulary({ traces: [] });
  for (const [line, check] of Object.entries(PROBES)) if (!check.source?.startsWith('inbound:')) assert.deepEqual(lintCheck(check, { vocab, words: [{ turn: 0, kind: 'request', text: readFileSync(path.join(ROOT, 'beds/ebed/e8/spec/SPEC-E.md'), 'utf8') }] }), [], `probe ${line} uses only vocabulary names`);
  const st = (label, line) => statusOf({ id: line, version: 1, check: PROBES[line], verification: 'test' }, { results: [evaluate(PROBES[line], views[label])] });
  const l1 = st('b1lh-e8-1', 162), l3 = st('b1lh-e8-3', 162), bo = st('b1o-e8-1', 162);
  assert.deepEqual([l1.status, l1.decided, l1.violated], ['met', 4, 0], 'lineage 1 resubmits the 4 partial reserves');
  assert.deepEqual([l3.status, l3.decided, l3.violated], ['unmet', 4, 4], 'lineage 3 releases instead of resubmitting, 4 of 4');
  assert.match(l3.evidence[0].why, /inventory\.release came first/);
  assert.equal(l3.evidence[0].item.subject, 'ORD-1237-0062', 'the first failing case is the one the oracle fails');
  assert.deepEqual([bo.status, bo.reason], ['unknown', 'not-exercised'], 'B1-O never gets a reserve applied: not exercised, never met');
  const k1 = st('b1lh-e8-1', 47), k3 = st('b1lh-e8-3', 47), kb = st('b1o-e8-1', 47);
  assert.deepEqual([k1.status, k3.status, kb.status], ['met', 'met', 'unmet']);
  assert.equal(kb.decided, kb.violated, 'every B1-O reserve it tried keys the batch');
  assert.ok(kb.evidence.every(i => /refused/.test(i.why)), 'B1-O fails on refused proposals');
  for (const label of ['b1lh-e8-1', 'b1lh-e8-3', 'b1o-e8-1']) {
    const r = st(label, 104), placed = views[label].sources['inbound:order.placed'];
    assert.deepEqual([r.status, r.decided], ['met', placed.length], `${label}: R1.1 holds for every order.placed message (the probe counted the 200 distinct orders once)`);
    assert.equal(new Set(placed.map(m => m.subject)).size, 200);
  }
  for (const line of [162, 47, 104]) assert.equal(realShape(PROBES[line], [views['b1lh-e8-1']]).teeth, true, `probe ${line} has teeth on a real lineage-1 instance`);
  // Deviation D2: the v2 semantics give the same verdicts on these time-ordered traces (no wording, scope, sheet or order rule applies).
  for (const label of ['b1lh-e8-1', 'b1lh-e8-3', 'b1o-e8-1']) for (const line of [162, 47, 104]) {
    const v1 = evaluate(PROBES[line], views[label]), v2 = evaluate(PROBES[line], views[label], { semantics: 'v2' });
    assert.deepEqual([v2.decided, v2.violated], [v1.decided, v1.violated], `${label} probe ${line}: v2 = v1`);
  }
});
