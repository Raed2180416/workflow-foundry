// The deterministic summariser and the pure history core: facts from recorded events, the verdict-vs-oracle flag, the cause classes, lanes, compare, list maths, and
// the rule that run text never reaches a fact or a summary.
//   node --test tools/run-view/test/summary.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { StoreReader } from '../store-adapter.mjs';
import { buildIndex } from '../index-runs.mjs';
import { buildRunDoc } from '../run-doc.mjs';
import { tempDir, writeRun, storeFile, finished, nested, gated, envfault, jsonl, resultLine, writeJournal } from './fixtures.mjs';
await import('../run-view.js');
await import('../history-core.js');
const R = globalThis.RunViewCore, H = globalThis.HistoryCore;
const here = path.dirname(fileURLToPath(import.meta.url));

const eventsOf = (ws, runId) => { const reader = StoreReader.open(storeFile(ws)); try { return reader.snapshot(() => { const header = reader.header(runId), chain = reader.events(runId, { header }); return { events: chain.events, workflow: reader.workflow(header.workflowHash).workflow, header }; }); } finally { reader.close(); } };
async function run(t, build) { const ws = tempDir(t), spec = build(), { runId } = await writeRun(ws, spec.workflow, spec); return { ws, runId, ...eventsOf(ws, runId) }; }
const reduce = (workflow, events) => { const m = new R.RunModel({ workflow }); for (const e of events) m.apply(e); return m; };

for (const [name, build] of [['finished', finished], ['nested', nested], ['envfault', envfault]]) {
  test(`foldFacts agrees with the viewer's reducer on a real runtime run (${name}): calls, escalations, check failures, retries, cost, failed instances`, async t => {
    const { events, workflow, header } = await run(t, build);
    const f = H.foldFacts(events, workflow), m = reduce(workflow, events);
    assert.equal(f.calls.n, m.run.calls, 'calls');
    assert.equal(f.escalations.length, m.run.escalations, 'escalations');
    assert.equal(f.checkFails, m.run.checkFails, 'check failures');
    assert.equal(f.retries, m.run.retries, 'retries');
    assert.ok(Math.abs(f.cost - m.run.cost) < 1e-9, `cost ${f.cost} vs ${m.run.cost}`);
    assert.ok(Math.abs(f.cost - header.cost) < 1e-9, 'and the run header');
    const failedInst = [...m.insts.values()].filter(i => i.status === 'failed').length;
    assert.equal(f.failed.length, failedInst, 'failed instances');
    assert.equal(f.status, m.run.status);
    assert.equal(f.verdict?.verdict, m.run.verdict?.verdict);
  });
}

test('the lane-6 recorded run (samples/records-v3-dev-d4-s108.json, development split): the design\'s worked example reproduces from the recorded events', () => {
  const doc = JSON.parse(readFileSync(path.join(here, '..', 'samples', 'records-v3-dev-d4-s108.json'), 'utf8'));
  const f = H.foldFacts(doc.events.filter(e => !e.derived), doc.workflow);
  assert.equal(f.calls.n, 26); assert.deepEqual(Object.fromEntries(Object.entries(f.calls.byModel).map(([k, v]) => [k, v.n])), { 'claude-haiku-5-5': 24, 'claude-sonnet-5-5': 2 });
  assert.equal(f.escalations.length, 2); assert.ok(f.escalations.every(e => e.rule === 'E2' && e.code === 'NODE_CHECK_FAILED'));
  assert.equal(f.failed.length, 1); assert.equal(f.failed[0].nodeKey, 'root/dates:2/judge'); assert.equal(f.failed[0].code, 'MODEL_ESCALATION_EXHAUSTED'); assert.equal(f.failed[0].handledBy, 'collected');
  assert.deepEqual(f.costTop.slice(0, 2).map(c => c.node), ['dates', 'perspective']);
  assert.ok(Math.abs(f.costTop[0].usd - 0.00996) < 1e-5 && Math.abs(f.costTop[1].usd - 0.00993) < 1e-5);
  assert.deepEqual(f.acceptance, { n: 1, ops: ['exists'], existenceOnly: true });
  assert.equal(f.verdict.verdict, 'pass'); assert.equal(Math.round(f.durationMs / 100) / 10, 50.3);
  const ex = doc.external[0];
  const row = { key: doc.run.id, kind: 'run', fidelity: 'full', status: f.status, split: 'dev', taskKey: ex.taskKey, arm: ex.arm, workflow: { id: doc.workflow.id, version: doc.workflow.version, hash: doc.run.workflowHash }, durationMs: f.durationMs,
    verdict: f.verdict, oracle: { pass: ex.pass, score: ex.score, details: ex.details }, cost: { usd: f.cost, source: 'run', unknownCalls: 0 }, calls: f.calls, escalations: f.escalations.length, escalationList: f.escalations, retries: f.retries, checkFails: f.checkFails,
    failed: f.failed, failedCount: f.failed.length, acceptance: f.acceptance, costTop: f.costTop, integrity: { chain: 'ok' } };
  row.honesty = H.honestyOf(row.verdict, row.oracle);
  assert.equal(row.honesty, 'mismatch-pass-fail');
  const s = H.summarise(row);
  assert.match(s.one_line, /^records-v3-hand v1 on records:dev:d4:s108 \(dev\): Foundry PASS; oracle FAIL 0\.9465; MISMATCH\. 50 s, \$0\.0320, 26 calls \(24 haiku-5-5, 2 sonnet-5-5\), 2 escalations, 1 failed: dates:2\/judge\.$/);
  assert.match(s.what_failed[0].text, /Foundry reported PASS but the independent oracle FAILED this run \(score 0\.9465\)/);
  assert.match(s.what_failed[1].text, /MODEL_ESCALATION_EXHAUSTED/); assert.match(s.what_failed[1].text, /collected by a map/);
  assert.equal(s.likely_cause.class, 'weak_acceptance'); assert.match(s.likely_cause.text, /only acceptance predicate checks that a value exists/); assert.match(s.likely_cause.text, /not recorded/);
  assert.match(s.suggested_fix.text, /acceptance predicate that a well-formed but wrong answer can fail/);
  const ids = new Set(s.facts.map(x => x.id));
  for (const id of ['R1', 'V1', 'O1', 'A1', 'N1', 'E1', 'E2', 'C1']) assert.ok(ids.has(id), `fact ${id}`);
  for (const list of [s.cites, ...s.what_failed.map(w => w.cites), s.likely_cause.cites]) for (const id of list) assert.ok(ids.has(id), `every cited id exists: ${id}`);
});

test('verdict vs oracle: Foundry pass + oracle fail is flagged in the row, the one-liner, the first failure line and the labels; an honest unverified is not a mismatch', () => {
  const base = { key: 'k', kind: 'run', fidelity: 'full', status: 'succeeded', split: 'dev', taskKey: 'records:dev:d3:s1', arm: 'A', workflow: { id: 'wf', version: 1, hash: 'h' }, durationMs: 1000, cost: { usd: 0.01, source: 'run' }, calls: { n: 1, errors: 0, byModel: {} },
    escalations: 0, retries: 0, checkFails: 0, failed: [], failedCount: 0, acceptance: { n: 1, ops: ['gte'], existenceOnly: false }, integrity: { chain: 'ok' } };
  const pass = { ...base, verdict: { verdict: 'pass' }, oracle: { pass: false, score: 0.4, details: {} } }; pass.honesty = H.honestyOf(pass.verdict, pass.oracle); pass.labels = H.labelsFor(pass);
  const s = H.summarise(pass);
  assert.equal(pass.honesty, 'mismatch-pass-fail'); assert.ok(pass.labels.includes('mismatch'));
  assert.match(s.one_line, /MISMATCH/); assert.match(s.what_failed[0].text, /Foundry reported PASS but the independent oracle FAILED/);
  assert.equal(s.likely_cause.class, 'unknown', 'a gating acceptance exists, so the summary does not guess a cause'); assert.match(s.likely_cause.text, /do not show why the answer was wrong/);
  assert.equal(s.suggested_fix, null, 'no fix is invented for an unknown cause');
  const honest = { ...base, verdict: { verdict: 'unverified', code: 'ACCEPTANCE_EXISTENCE_ONLY' }, oracle: { pass: false, score: 0.4, details: {} }, acceptance: { n: 1, ops: ['exists'], existenceOnly: true } }; honest.honesty = H.honestyOf(honest.verdict, honest.oracle);
  assert.equal(honest.honesty, 'agree'); const h = H.summarise(honest);
  assert.ok(!/MISMATCH/.test(h.one_line)); assert.equal(h.likely_cause.class, 'weak_acceptance'); assert.match(h.likely_cause.text, /did not claim success/);
  const reverse = { ...base, verdict: { verdict: 'inconclusive' }, oracle: { pass: true, score: 1, details: {} } }; reverse.honesty = H.honestyOf(reverse.verdict, reverse.oracle);
  assert.equal(reverse.honesty, 'mismatch-fail-pass'); assert.match(H.summarise(reverse).one_line, /mismatch \(oracle passed\)/);
});

test('cause classes, first match wins, from codes and verdicts only: env_fault, harness_fault, integrity, budget, weak_acceptance, none, unknown', () => {
  const row = (over = {}) => ({ key: 'k', kind: 'run', fidelity: 'full', status: 'failed', split: 'dev', cost: { usd: 0 }, calls: { n: 0, byModel: {} }, escalations: 0, failed: [], failedCount: 0, integrity: { chain: 'ok' }, verdict: null, oracle: null, ...over });
  const cls = r => H.summarise({ ...r, honesty: H.honestyOf(r.verdict, r.oracle) }).likely_cause.class;
  assert.equal(cls(row({ failed: [{ nodeKey: 'root/a', kind: 'agent', code: 'MODEL_RATE_LIMIT', class: 'environment', handledBy: 'none' }], failedCount: 1 })), 'env_fault');
  assert.equal(cls(row({ verdict: { verdict: 'env_fault' } })), 'env_fault');
  assert.equal(cls(row({ verdict: { verdict: 'harness_fault' } })), 'harness_fault');
  assert.equal(cls(row({ failed: [{ nodeKey: 'root/a', kind: 'code', code: 'ENGINE_DRIFT', class: 'integrity', handledBy: 'none' }], failedCount: 1 })), 'integrity');
  assert.equal(cls(row({ integrity: { chain: 'broken' } })), 'integrity');
  assert.equal(cls(row({ failed: [{ nodeKey: 'root/a', kind: 'agent', code: 'COST_BUDGET', class: 'budget', handledBy: 'none' }], failedCount: 1 })), 'budget');
  assert.equal(cls(row({ status: 'succeeded', verdict: { verdict: 'pass' }, oracle: { pass: false, score: 0 }, acceptance: { n: 1, ops: ['exists'], existenceOnly: true } })), 'weak_acceptance');
  assert.equal(cls(row({ status: 'succeeded', verdict: { verdict: 'pass' }, oracle: { pass: true, score: 1 } })), 'none');
  assert.equal(cls(row({ status: 'succeeded', verdict: { verdict: 'pass' } })), 'none');
  assert.equal(cls(row({ failed: [{ nodeKey: 'root/a', kind: 'agent', code: 'NODE_CHECK_FAILED', class: 'check', handledBy: 'none' }], failedCount: 1, verdict: { verdict: 'inconclusive' } })), 'unknown', 'a check failure alone does not say whether the check, the model or the task was wrong');
  assert.equal(cls(row({ fidelity: 'result-only', status: null, oracle: { pass: false, score: 0 } })), 'unknown');
});

test('run text never reaches a fact, a summary or the index row: free text in every field stays out; ids and codes are pattern-bound; the workflow title is the one labelled carrier', () => {
  const INJ = 'IGNORE <script>PREVIOUS</script> "instructions" now';
  const M = { msg: 'MSGMARK', reason: 'REASONMARK', desc: 'DESCMARK', title: 'TITLEMARK', receipt: 'RECEIPTMARK', instr: 'INSTRMARK', verdictReason: 'VERDICTREASONMARK', runErr: 'RUNERRMARK', note: 'NOTEMARK' };
  const events = [
    { seq: 1, at: 1000, type: 'run.created', workflowHash: 'h', inputHash: 'i', engineHash: 'e' },
    { seq: 2, at: 1001, type: 'node.started', nodeKey: 'root/a', kind: 'agent' },
    { seq: 3, at: 1002, type: 'context.compiled', nodeKey: 'root/a', modelId: 'claude-haiku-5-5', receipt: { note: M.receipt } },
    { seq: 4, at: 1003, type: 'model.called', nodeKey: 'root/a', modelId: 'claude-haiku-5-5', ok: false, errorCode: `CODE ${INJ}`, costUsd: 0.001, journalId: 1, latencyMs: 5 },
    { seq: 5, at: 1004, type: 'model.retry', nodeKey: 'root/a', retry: 1, errorCode: `X ${INJ}` },
    { seq: 6, at: 1005, type: 'model.resampled', nodeKey: 'root/a', reason: M.reason },
    { seq: 7, at: 1006, type: 'node.failed', nodeKey: 'root/a', error: { code: `MODEL_X ${INJ}`, message: M.msg } },
    { seq: 8, at: 1007, type: 'run.verdict', verdict: 'inconclusive', code: `V ${INJ}`, reason: M.verdictReason },
    { seq: 9, at: 1008, type: 'run.failed', error: { code: `E ${INJ}`, message: M.runErr } }
  ];
  const workflow = { id: 'wf', title: M.title, description: M.desc, nodes: [{ id: 'a', kind: 'agent', description: M.desc, instructions: M.instr }], acceptance: [{ op: 'exists', value: { $ref: 'nodes.a.x' }, note: M.note }] };
  const f = H.foldFacts(events, workflow);
  const row = { key: 'k', kind: 'run', fidelity: 'full', status: f.status, error: f.error, split: H.splitOf(`records:dev:${INJ}`).split, taskKey: H.safeId(`records:dev:${INJ}`), arm: H.safeId(INJ), workflow: { id: H.safeId(workflow.id), version: 1, hash: 'h', title: H.clip(workflow.title, 120) },
    durationMs: f.durationMs, verdict: f.verdict, oracle: null, cost: { usd: f.cost, source: 'run' }, calls: f.calls, escalations: 0, escalationList: f.escalations, retries: f.retries, checkFails: f.checkFails, failed: f.failed, failedCount: f.failed.length, acceptance: f.acceptance, costTop: f.costTop, integrity: { chain: 'ok' } };
  row.honesty = H.honestyOf(row.verdict, row.oracle);
  const summary = JSON.stringify(H.summarise(row)), noTitle = JSON.stringify({ ...row, workflow: { ...row.workflow, title: '' } });
  for (const marker of Object.values(M)) { assert.ok(!summary.includes(marker), `summary leaked ${marker}`); if (marker !== M.title) assert.ok(!noTitle.includes(marker), `row leaked ${marker}`); }
  for (const text of [summary, noTitle]) { assert.ok(!/[<>]/.test(text), `no angle bracket from run text survives: ${(text.match(/.{40}[<>].{40}/) ?? [''])[0]}`); assert.ok(!text.includes('IGNORE ') && !text.includes('instructions\\"'), 'no prose from an injected code or id survives'); }
  const idish = [row.taskKey, row.arm, ...row.failed.map(n => n.code), ...Object.keys(f.retriesByCode), f.verdict?.code ?? '', f.error?.code ?? ''];
  for (const v of idish) assert.ok(/^[A-Za-z0-9._:/@+=#?…-]*$/.test(v), `pattern-bound: ${v}`);
  assert.ok(JSON.stringify(row).includes(M.title), 'the workflow title is kept (rendered as text, labelled as the workflow\'s own)');
  assert.equal(H.safeId('a b<c>"d').match(/[ <>"]/), null);
});

test('sanitizeDisplay agrees with the single-run viewer\'s on a corpus of control, bidi and zero-width characters (the two copies must not drift)', () => {
  const corpus = ['plain', 'a\u0000b', 'x\u202ey', 'z\u200bw', '؜', '\ufeffbom', 'tab\tok\nnl', 'lone\ud800surrogate', '\u2028\u2029', 'ok é 中', '\u007f\u0085', '\u2066x\u2069'];
  for (const text of corpus) assert.deepEqual(H.sanitizeDisplay(text), R.sanitizeDisplay(text), JSON.stringify(text));
});

test('lanes: one per root node that appears in the events, with states, calls, density for a container, a critical path and honest notes', async t => {
  const ws = tempDir(t), spec = finished(), { runId } = await writeRun(ws, spec.workflow, spec);
  jsonl(path.join(ws, 'results.jsonl'), [resultLine({ meta: { runId, status: 'succeeded' } })]);
  const index = buildIndex({ roots: [ws] }), row = index.rows.find(r => r.key === runId);
  assert.equal(row.split, 'dev');
  const { doc, meta } = buildRunDoc(row);
  assert.ok(doc && !meta.withheld, 'a development run keeps its content');
  const lanes = H.buildLanes(doc);
  const rootNodes = new Set(doc.events.filter(e => e.nodeKey).map(e => e.nodeKey.split('/')[1].replace(/:\d+$/, '')));
  assert.deepEqual(new Set(lanes.lanes.map(l => l.id)), rootNodes);
  const map = lanes.lanes.find(l => l.id === 'visual_understanding');
  assert.equal(map.container, true); assert.ok(map.itemCount >= 3 && map.density.length > 1 && map.maxActive >= 1); assert.ok(map.maxActive <= map.itemCount);
  assert.ok(map.escalations >= 1, 'the map escalated at least one frame');
  assert.ok(lanes.lanes.some(l => l.marks.some(m => m.kind === 'escalation')));
  assert.ok(lanes.t1 > lanes.t0 && lanes.critical.length >= 2);
  assert.equal(lanes.lanes.at(-1).id === 'report' || lanes.critical.at(-1) === 'report', true, 'the critical path ends at the last node');
  for (const l of lanes.lanes) for (const c of l.calls) { assert.ok(c.start <= c.end); assert.ok(c.start >= lanes.t0); }
});
test('a journal-only record becomes lanes by node key, with escalations inferred (and labelled) from a model change', async t => {
  const root = tempDir(t);
  writeJournal(path.join(root, 'journal.sqlite'), [{ runId: 'jr', nodeKey: 'root/a', latencyMs: 300 }, { runId: 'jr', nodeKey: 'root/a', latencyMs: 400, modelId: 'claude-sonnet-5-5' }, { runId: 'jr', nodeKey: 'root/b', latencyMs: 200, ok: false, errorCode: 'MODEL_SCHEMA' }]);
  const row = buildIndex({ roots: [root] }).rows.find(r => r.key === 'jr');
  assert.equal(row.fidelity, 'journal-only'); assert.equal(row.escalations, 1); assert.equal(row.escalationsInferred, true);
  const { doc } = buildRunDoc(row, { allowHeldout: true });
  assert.equal(doc.fidelity, 'journal-only');
  const lanes = H.buildLanes(doc);
  assert.deepEqual(lanes.lanes.map(l => l.id).sort(), ['a', 'b']);
  assert.ok(lanes.notes.some(n => /Reconstructed from the model journal/.test(n)));
  assert.ok(lanes.lanes.find(l => l.id === 'a').marks.some(m => m.kind === 'escalation' && /inferred/.test(m.label)));
  assert.equal(lanes.lanes.find(l => l.id === 'b').state, 'failed');
});

test('compare: same workflow and input aligns outputs by hash and names the first node that differs; a different input makes no divergence claim; versions diff structurally', () => {
  const mk = hashes => ({ fidelity: 'full', run: { status: 'succeeded' }, workflow: { nodes: [{ id: 'a', kind: 'code' }, { id: 'b', kind: 'agent', needs: ['a'], model: { class: 'M' }, checks: [{}] }, { id: 'c', kind: 'code', needs: ['b'] }], acceptance: [] },
    events: [{ seq: 1, at: 0, type: 'run.created' }, ...Object.entries(hashes).map(([k, h], i) => ({ seq: 2 + i, at: 10 + i, type: 'node.completed', nodeKey: `root/${k}`, outputHash: h })), { seq: 9, at: 100, type: 'run.succeeded' }], calls: {} });
  const row = (over = {}) => ({ key: 'k', fidelity: 'full', workflow: { id: 'wf', version: 1, hash: 'same' }, honesty: 'agree', cost: { usd: 1 }, calls: { n: 1 }, escalations: 0, failedCount: 0, durationMs: 100, status: 'succeeded', ...over });
  const A = { row: row(), doc: mk({ a: 'h1', b: 'h2', c: 'h3' }), inputHash: 'in' };
  const same = H.compareDocs(A, { row: row({ cost: { usd: 3 } }), doc: mk({ a: 'h1', b: 'h2', c: 'h3' }), inputHash: 'in' });
  assert.equal(same.divergence.nodeKey, null); assert.match(same.divergence.text, /same hash/);
  assert.equal(same.header.find(r => r.field === 'Cost').changed, true); assert.equal(same.header.find(r => r.field === 'Cost').deltaText, '+$2.00');
  const diff = H.compareDocs(A, { row: row(), doc: mk({ a: 'h1', b: 'XX', c: 'YY' }), inputHash: 'in' });
  assert.equal(diff.divergence.nodeKey, 'root/b'); assert.match(diff.divergence.text, /first differ at b/);
  const other = H.compareDocs(A, { row: row(), doc: mk({ a: 'h1', b: 'XX', c: 'YY' }), inputHash: 'different' });
  assert.equal(other.divergence.nodeKey, null); assert.match(other.divergence.text, /Different inputs/);
  assert.ok(other.nodes.length === 3 && other.timelines, 'nodes are aligned by id');
  const wfB = JSON.parse(JSON.stringify(A.doc.workflow)); wfB.nodes[1].checks = []; wfB.nodes[1].instruction = 'new'; wfB.nodes.push({ id: 'd', kind: 'code' }); wfB.nodes.splice(0, 1);
  const v = H.workflowDiff(A.doc.workflow, wfB);
  assert.deepEqual(v.added, ['d']); assert.deepEqual(v.removed, ['a']); assert.deepEqual(v.changed.map(c => c.id), ['b']); assert.ok(v.changed[0].diffs.includes('check count') && v.changed[0].diffs.includes('instruction or body'));
  const vs = H.compareDocs({ row: row(), doc: A.doc, inputHash: 'in' }, { row: row({ workflow: { id: 'wf', version: 2, hash: 'other' } }), doc: { ...mk({ a: 'h1' }), workflow: wfB }, inputHash: 'in' });
  assert.ok(vs.versions && /Different workflow versions/.test(vs.notes.join(' ')));
  const partial = H.compareDocs({ row: row(), doc: null }, { row: row({ fidelity: 'journal-only' }), doc: A.doc });
  assert.match(partial.notes.join(' '), /only the header fields are compared/);
});

test('list maths: filters, stable sorts with missing values last, honest totals (cost per verified success counts oracle passes), the task matrix', () => {
  const mkRow = (i, o = {}) => ({ key: `r${i}`, kind: 'run', fidelity: 'full', split: 'dev', experiment: 'e', arm: i % 2 ? 'A' : 'B', taskKey: `records:dev:d1:s${i % 3}`, startedAt: 1000 * i, durationMs: 100 * i, cost: { usd: i }, calls: { n: i, byModel: {} }, escalations: 0, failedCount: 0, labels: [], honesty: 'agree',
    verdict: { verdict: 'pass' }, oracle: { pass: i % 4 !== 0, score: i / 10 }, ...o });
  const rows = Array.from({ length: 9 }, (_, i) => mkRow(i + 1));
  rows.push(mkRow(10, { oracle: null, honesty: 'no-oracle', cost: { usd: null } }), mkRow(11, { honesty: 'mismatch-pass-fail', oracle: { pass: false, score: 0 }, fidelity: 'journal-only' }));
  assert.equal(H.filterRows(rows, { honesty: 'mismatch' }).length, 1); assert.equal(H.filterRows(rows, { fidelity: 'journal-only' }).length, 1); assert.equal(H.filterRows(rows, { oracle: 'none' }).length, 1);
  assert.equal(H.filterRows(rows, { oracle: 'fail' }).length, 3 + 0, 'i=4, i=8 fail the oracle, plus the mismatch row'); assert.equal(H.filterRows(rows, { arm: 'A', q: 'S1' }).length, H.filterRows(rows, { arm: 'A' }).filter(r => /s1/.test(r.taskKey)).length);
  assert.equal(H.filterRows(rows, { from: 4000, to: 6000 }).length, 3);
  const byCost = H.sortRows(rows, 'cost', -1); assert.equal(byCost[0].key, 'r11'); assert.equal(byCost.at(-1).key, 'r10', 'a row without a cost sorts last in both directions'); assert.equal(H.sortRows(rows, 'cost', 1).at(-1).key, 'r10');
  assert.deepEqual(H.sortRows([{ key: 'x', cost: { usd: 1 } }, { key: 'y', cost: { usd: 1 } }], 'cost', -1).map(r => r.key), ['x', 'y'], 'stable');
  const a = H.aggregate(rows);
  assert.equal(a.n, 11); assert.equal(a.noOracle, 1); assert.equal(a.withOracle, 10); assert.equal(a.mismatches, 1); assert.equal(a.full, 10); assert.equal(a.survivorBias, false);
  const passes = rows.filter(r => r.oracle?.pass), spend = passes.reduce((s, r) => s + r.cost.usd, 0) + rows.filter(r => r.oracle && !r.oracle.pass).reduce((s, r) => s + r.cost.usd, 0);
  assert.ok(Math.abs(a.costPerVerifiedSuccess - spend / passes.length) < 1e-12, 'cost per verified success = all cost over rows that have an oracle / oracle passes');
  assert.equal(H.aggregate(rows.map(r => ({ ...r, fidelity: 'journal-only' }))).survivorBias, true);
  const m = H.taskMatrix(rows);
  assert.deepEqual(m.arms, ['A', 'B']); assert.equal(m.tasks.length, 3); assert.equal(m.tasks.flatMap(t => [...t.cells.values()]).reduce((s, c) => s + c.trials, 0), 10, 'only trials with an oracle result');
});
