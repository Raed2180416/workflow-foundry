// The run index: discovery, joins J1-J3, fidelity, honesty, splits, duplicates, the scan cache, and the rule that the index holds ids and numbers, never content.
//   node --test tools/run-view/test/index.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync, cpSync, readFileSync, utimesSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { buildIndex, discover, readResultFile } from '../index-runs.mjs';
import { tempDir, writeRun, storeFile, finished, nested, gated, writeJournal, jsonl, resultLine, treeDigest } from './fixtures.mjs';
await import('../history-core.js');
const H = globalThis.HistoryCore;

// One shared tree: a real finished run (full), journal-only runs joined by J1 and by the J2 naming convention, a result-only baseline, a kept trial workspace for J3.
async function tree(t) {
  const root = tempDir(t), exp = path.join(root, 'exp');
  const ws = path.join(exp, 'workspaces', 'run-a'), spec = gated();
  const { runId } = await writeRun(ws, spec.workflow, spec);
  // the journal first: a trial's result line is written after its last model call (the J2 join checks that order)
  writeJournal(path.join(exp, 'journal.sqlite'), [
    { runId: 'journal-run-1', nodeKey: 'root/answer', costUsd: 0.002, prompt: 'PROMPT-MARKER one', reply: 'REPLY-MARKER one' },
    { runId: 'journal-run-1', nodeKey: 'root/answer', costUsd: 0.004, modelId: 'claude-sonnet-5-5' },
    { runId: 'b0call-haiku:records:test:d4:s5003:t0', nodeKey: 'b0', costUsd: 0.003 },
    { runId: 'b0call-haiku:records:test:d4:s5003:t0:notes', nodeKey: 'notes', costUsd: 0.001 },
    { runId: 'orphan-run', nodeKey: 'root/x', ok: false, errorCode: 'MODEL_RATE_LIMIT', costUsd: 0 }
  ]);
  const after = new Date(Date.now() + 1000).toISOString();
  // a result line that names the real run: Foundry said pass, the independent oracle failed
  const lines = [
    resultLine({ arm: 'F-haiku', taskKey: 'records:dev:d3:s101', pass: false, score: 0.91, meta: { runId, status: 'succeeded', verdict: 'pass', calls: 9, escalations: 2 }, oracleDetails: JSON.stringify({ entities: 10, predicted: 12, extra: 2, hidden_truth: 'SECRET TRUTH TEXT', pairF1: 0.9 }) }),
    resultLine({ arm: 'F-haiku', taskKey: 'records:dev:d3:s102', trial: 0, pass: true, score: 1, meta: { runId: 'journal-run-1', status: 'succeeded', verdict: 'pass', calls: 2 }, at: '2026-10-07T10:05:00.000Z' }),
    resultLine({ arm: 'b0call-haiku', taskKey: 'records:test:d4:s5003', trial: 0, pass: false, score: 0, meta: { tokensIn: 5 }, at: after }),
    resultLine({ arm: 'b1-script', taskKey: 'records:dev:d3:s103', trial: 0, pass: true, score: 1, meta: {}, at: '2026-10-07T10:15:00.000Z' })
  ];
  jsonl(path.join(exp, 'results.jsonl'), lines);
  return { root, exp, ws, runId };
}

test('fidelity, joins and honesty: full / journal-only / result-only rows, each saying how it was joined', async t => {
  const { root, runId } = await tree(t);
  const index = buildIndex({ roots: [root] });
  const by = Object.fromEntries(index.rows.map(r => [r.key, r]));
  const full = by[runId];
  assert.equal(full.fidelity, 'full'); assert.equal(full.kind, 'run'); assert.deepEqual(full.joins, ['J1']);
  assert.equal(full.verdict.verdict, 'pass'); assert.equal(full.oracle.pass, false);
  assert.equal(full.honesty, 'mismatch-pass-fail', 'Foundry pass + oracle fail is the headline column');
  assert.ok(full.labels.includes('mismatch'));
  assert.equal(full.integrity.chain, 'ok'); assert.ok(full.integrity.events > 10);
  assert.equal(full.cost.source, 'run'); assert.ok(full.cost.usd >= 0);
  assert.equal(full.workflow.id, 'GameQANested');

  const j1 = by['journal-run-1'];
  assert.equal(j1.fidelity, 'journal-only'); assert.deepEqual(j1.joins, ['J1']);
  assert.equal(j1.calls.n, 2); assert.equal(j1.escalations, 1, 'a model change within one node key is counted as an inferred escalation');
  assert.equal(j1.escalationsInferred, true); assert.equal(j1.cost.source, 'journal'); assert.ok(Math.abs(j1.cost.usd - 0.006) < 1e-9);
  assert.equal(j1.honesty, 'agree');

  const j2 = by['b0call-haiku:records:test:d4:s5003:t0'];
  assert.equal(j2.fidelity, 'journal-only'); assert.deepEqual(j2.joins, ['J2'], 'joined to its result line by the naming convention, and says so');
  assert.equal(j2.calls.n, 2, 'the :notes journal run belongs to the same trial');
  assert.equal(j2.split, 'test'); assert.equal(j2.honesty, 'no-verdict');
  assert.equal(by['b0call-haiku:records:test:d4:s5003:t0:notes'], undefined);

  const trial = index.rows.find(r => r.fidelity === 'result-only');
  assert.equal(trial.kind, 'trial'); assert.match(trial.key, /^trial:exp-a:b1-script:records:dev:d3:s103:t0$/); assert.equal(trial.verdict, null); assert.equal(trial.honesty, 'no-verdict');

  const orphan = by['orphan-run'];
  assert.equal(orphan.fidelity, 'journal-only'); assert.equal(orphan.oracle, null); assert.equal(orphan.honesty, 'no-verdict');
  assert.equal(orphan.failedCount, 1); assert.equal(orphan.failed[0].code, 'MODEL_RATE_LIMIT'); assert.equal(orphan.failed[0].class, 'environment');
  assert.equal(index.report.byFidelity.full, 1);
});

test('honesty matrix: pass or finding against the oracle; the opposite case is a mismatch of its own; missing evidence is never read as agreement', () => {
  const h = H.honestyOf;
  assert.equal(h({ verdict: 'pass' }, { pass: false }), 'mismatch-pass-fail');
  assert.equal(h({ verdict: 'finding' }, { pass: false }), 'mismatch-pass-fail');
  assert.equal(h({ verdict: 'fail' }, { pass: true }), 'mismatch-fail-pass');
  assert.equal(h({ verdict: 'env_fault' }, { pass: true }), 'mismatch-fail-pass');
  assert.equal(h({ verdict: 'pass' }, { pass: true }), 'agree');
  assert.equal(h({ verdict: 'env_fault' }, { pass: false }), 'agree');
  assert.equal(h({ verdict: 'pass' }, null), 'no-oracle');
  assert.equal(h(null, { pass: false }), 'no-verdict');
  assert.equal(h(null, null), 'no-verdict');
});

test('splits come from the task key; a sources file can mark seeds as already inspected (and the content rule follows)', async t => {
  const { root } = await tree(t);
  const plain = buildIndex({ roots: [root] }), over = buildIndex({ roots: [root], sources: { splitOverrides: [{ taskKey: 'records:test:d4:s500*', split: 'test', inspected: true, reason: 'diagnosed in a report' }] } });
  const pick = idx => idx.rows.find(r => r.key.startsWith('b0call-haiku:records:test'));
  assert.equal(pick(plain).split, 'test'); assert.equal(pick(plain).inspected, false); assert.equal(H.contentPolicy(pick(plain)), 'optin');
  assert.equal(pick(over).inspected, true); assert.equal(H.contentPolicy(pick(over)), 'open');
  assert.equal(H.splitOf('records:dev:d3:s1').split, 'dev'); assert.equal(H.splitOf('records:sealed:d3:s1').split, 'sealed'); assert.equal(H.splitOf('x').split, 'unknown');
  assert.equal(H.contentPolicy({ split: 'sealed' }), 'never'); assert.equal(H.contentPolicy({ split: 'unknown' }), 'optin'); assert.equal(H.contentPolicy({ split: 'dev' }), 'open');
});

test('the index holds ids, codes and numbers, never content: no prompt, reply, task text, error message or hidden truth', async t => {
  const { root } = await tree(t);
  const text = JSON.stringify(buildIndex({ roots: [root] }));
  for (const marker of ['PROMPT-MARKER', 'REPLY-MARKER', 'SECRET TRUTH TEXT', 'hidden_truth', 'Simulated provider', 'Choose the glitch cases']) assert.ok(!text.includes(marker), `${marker} must not be in the index`);
  assert.ok(!/"(prompt|reply|system|message|request|response)"\s*:/.test(text), 'no content-bearing key in the index');
});

test('indexing writes nothing: every file under the roots is byte-identical afterwards', async t => {
  const { root } = await tree(t);
  const before = treeDigest(root);
  buildIndex({ roots: [root] });
  assert.deepEqual(treeDigest(root), before);
});

test('discovery: symlinks are never followed, excluded directories and unreadable paths are counted, nothing is dropped silently', async t => {
  const { root, ws } = await tree(t);
  mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true }); writeFileSync(path.join(root, 'node_modules', 'x', 'results.jsonl'), '{}\n');
  mkdirSync(path.join(root, 'bench'), { recursive: true });
  symlinkSync(ws, path.join(root, 'link-to-ws')); symlinkSync(path.join(ws, '.foundry', 'foundry.sqlite'), path.join(root, 'link.sqlite'));
  const found = discover([root, path.join(root, 'does-not-exist')]);
  assert.equal(found.stores.length, 1, 'the store is found once, not through the symlink');
  assert.equal(found.skipped.symlinks, 2); assert.equal(found.skipped.excludedDirs, 2);
  assert.ok(found.errors.some(e => /no such directory/.test(e)));
  const deep = path.join(root, ...Array.from({ length: 14 }, (_, i) => `d${i}`)); mkdirSync(deep, { recursive: true });
  assert.ok(discover([root]).skipped.tooDeep >= 1, 'a directory deeper than the limit is counted');
});

test('a result file is recognised by its shape, not its name; only numeric oracle fields are kept; a log that repeats a results file is one trial', async t => {
  const root = tempDir(t);
  jsonl(path.join(root, 'weird-name.jsonl'), [resultLine({ arm: 'A', meta: { runId: 'r1' }, oracleDetails: JSON.stringify({ pairF1: 0.5, note: 'text is dropped', entities: 3 }) })]);
  jsonl(path.join(root, 'not-results.jsonl'), [{ hello: 'world' }]);
  // the records-v3 dev-log.jsonl pattern: same arm/task/trial/minute, no run id, no experiment, `task` only
  const { experiment, taskKey, ...bare } = resultLine({ arm: 'A', meta: undefined, verdict: 'pass', status: 'succeeded' });
  jsonl(path.join(root, 'dev-log.jsonl'), [bare]);
  const index = buildIndex({ roots: [root] });
  assert.equal(index.rows.length, 1, 'the repeated line is not a second trial');
  const r = index.rows[0];
  assert.equal(r.experiment, 'exp-a'); assert.deepEqual(Object.keys(r.oracle.details).sort(), ['entities', 'pairF1']);
  assert.equal(readResultFile(path.join(root, 'weird-name.jsonl')).length, 1);
});

test('a result file with one line and no trailing newline is still recognised; a big file with a partial last line is not misread', async t => {
  const root = tempDir(t);
  writeFileSync(path.join(root, 'one.jsonl'), JSON.stringify(resultLine({ arm: 'solo' })));
  const idx = buildIndex({ roots: [root] });
  assert.equal(idx.rows.length, 1); assert.equal(idx.rows[0].arm, 'solo');
  const big = path.join(root, 'big.jsonl'), line = JSON.stringify(resultLine({ arm: 'big', meta: { pad: 'x'.repeat(2000) } }));
  writeFileSync(big, Array.from({ length: 60 }, () => line).join('\n').slice(0, 70000));
  assert.ok(buildIndex({ roots: [root] }).rows.some(r => r.arm === 'big'));
});

test('duplicates: a copied workspace is one row; the copy with the longest verified chain wins and the copy count is kept', async t => {
  const { root, ws } = await tree(t);
  const copy = path.join(root, 'copy-of-run-a'); cpSync(ws, copy, { recursive: true });
  const db = new DatabaseSync(storeFile(copy)); db.exec("DELETE FROM events WHERE seq > 8"); db.close();     // a truncated, therefore broken, copy
  const index = buildIndex({ roots: [root] });
  const full = index.rows.filter(r => r.fidelity === 'full');
  assert.equal(full.length, 1);
  assert.equal(full[0].copies, 2); assert.equal(full[0].integrity.chain, 'ok');
  assert.ok(full[0].sources[0].label.includes('run-a'), 'the intact copy is the one indexed');
});

test('J3: a kept trial workspace named <exp>/<arm>/<task>_t<trial>/ws is joined to its result line when the line carries no run id', async t => {
  const root = tempDir(t), spec = nested();
  const ws = path.join(root, 'exp', 'work', 'exp-a', 'F-haiku', 'records_dev_d3_s101_t0', 'ws');
  const { runId } = await writeRun(ws, spec.workflow, spec);
  jsonl(path.join(root, 'exp', 'results.jsonl'), [resultLine({ arm: 'F-haiku', pass: true, meta: { status: 'succeeded' } })]);
  const index = buildIndex({ roots: [root] });
  const row = index.rows.find(r => r.key === runId);
  assert.deepEqual(row.joins, ['J3']); assert.equal(row.arm, 'F-haiku'); assert.equal(row.oracle.pass, true);
  assert.equal(index.rows.length, 1, 'the result line is attached to the run, not repeated as a trial');
});

test('scan cache: a rescan with nothing new does not reopen a source; a changed source is rescanned alone; the rows are identical', async t => {
  const { root, exp } = await tree(t), cacheDir = tempDir(t);
  const first = buildIndex({ roots: [root], cacheDir }), second = buildIndex({ roots: [root], cacheDir });
  assert.equal(second.report.scanned, 0); assert.ok(second.report.cached >= first.report.scanned);
  assert.deepEqual(second.rows, first.rows);
  const file = path.join(exp, 'results.jsonl'), lines = readFileSync(file, 'utf8');
  writeFileSync(file, lines + JSON.stringify(resultLine({ arm: 'new-arm', taskKey: 'records:dev:d3:s999', at: '2026-10-08T10:00:00.000Z' })) + '\n');
  const third = buildIndex({ roots: [root], cacheDir });
  assert.equal(third.report.scanned, 2, 'the results file (parsed and sniffed) is rescanned, nothing else');
  assert.equal(third.rows.length, first.rows.length + 1);
});

test('a broken chain is indexed, not hidden: the row says chain broken and carries the label', async t => {
  const { root, ws, runId } = await tree(t);
  const db = new DatabaseSync(storeFile(ws)); db.exec("UPDATE events SET body = json_set(body, '$.at', 1) WHERE seq = 4"); db.close();
  const row = buildIndex({ roots: [root] }).rows.find(r => r.key === runId);
  assert.equal(row.integrity.chain, 'broken'); assert.ok(row.labels.includes('chain-broken'));
  assert.equal(H.summarise(row).likely_cause.class, 'integrity');
});
