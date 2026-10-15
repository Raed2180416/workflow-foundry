// X1 (MEMORY-ROUTING-RECURSION §3.2 "Memory tests"): no truth-domain bytes under any sandbox, workdir or prompt, checked
// executably at $0 on what the arms are actually given: the library solver's workdir (M2), the files a B1 / construct
// sandbox and an agent get for a task, and the inline prompt of a direct call, on the NL0 families' dev seeds. A planted
// leak is found first (the scan can fail): the whole answer, and also one field, one row and one hidden test case of the
// real truth of a bed task. No model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanLeaks, truthNeedles, taskTruth, TRUTH_FILE_NAMES } from '../leak-scan.mjs';
import { runSolver } from '../../library/run.mjs';
import { openLibrary } from '../../library/store.mjs';
import { makeTasks, loadFamily, solverView, inlineRender } from '../../lib/beds.mjs';
import { taskFiles } from '../../c0/construct.mjs';
import { canonical } from '../../../beds/lib/canonical.mjs';

const tmp = (t, p = 'x1-') => { const d = mkdtempSync(path.join(tmpdir(), p)); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const writeTree = (dir, files) => { for (const [rel, text] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); } };

test('X1 control: a planted truth file, truth bytes in a workdir file and truth bytes in a prompt are all found', t => {
  const dir = tmp(t);
  const answer = { entities: [{ id: 'E1', family_name: 'van den Berg', birth_date: '1961-04-02' }] };
  const needles = truthNeedles([answer]);
  assert.ok(needles.length >= 2 && needles.every(n => n.length >= 32));
  writeTree(dir, { 'sub/evidence.jsonl': '{"oracle":"pass"}\n', 'notes.txt': `cached: ${JSON.stringify(answer)}\n`, 'clean.txt': 'nothing here' });
  const r = scanLeaks({ roots: [dir], needles, prompts: { direct: `prompt ... ${JSON.stringify(answer, null, 2)}` } });
  assert.equal(r.ok, false);
  assert.deepEqual([...new Set(r.hits.map(h => h.kind))].sort(), ['bytes', 'file', 'prompt']);
  assert.ok(r.hits.some(h => h.kind === 'file' && h.where.endsWith('sub/evidence.jsonl')));
  assert.ok(r.hits.every(h => !String(h.where).endsWith('clean.txt')));
  assert.deepEqual(TRUTH_FILE_NAMES, ['evidence.jsonl', 'judgments.jsonl']);
});

test('X1 control: needles reach into the truth; a raw field, one truth row and one hidden test case are each found', async t => {
  // MEM-0 review: whole-object needles alone missed these (scanLeaks ok=true, hits []). Real dev tasks, d3, seed 201.
  const [{ task: cf }] = await makeTasks('codefix', { split: 'dev', seeds: [201], difficulty: 3 });
  const [{ task: rec }] = await makeTasks('records', { split: 'dev', seeds: [201], difficulty: 3 });
  const cfTruth = await taskTruth('codefix', cf), recTruth = await taskTruth('records', rec);
  const [cfRef, hidden, refHidden] = cfTruth, recRef = recTruth[0];
  assert.equal(cfTruth.length, 3, 'codefix: the reference answer, the hidden test cases and their expected results');
  assert.ok(Array.isArray(hidden) && hidden.length >= 15 && refHidden.length === hidden.length);
  const hiddenCase = hidden.find(c => !inlineRender(cf).includes(c.title)) ?? hidden[0];
  const plants = {
    'raw patched_source in fixed.py': [cfTruth, { 'fixed.py': cfRef.patched_source }],
    'patched_source inside a JSON file': [cfTruth, { 'cache.json': JSON.stringify({ cached: cfRef.patched_source }) }],
    'one hidden test case': [cfTruth, { 'notes/cases.txt': `case: ${JSON.stringify(hiddenCase)}\n` }],
    'one hidden expected result': [cfTruth, { 'expected.json': JSON.stringify(refHidden[3], null, 2) }],
    'the entity array alone': [recTruth, { 'records.json': JSON.stringify(recRef.records) }],
    'one truth row': [recTruth, { 'row.json': JSON.stringify(recRef.records[7], null, 2) }],
    'one truth row, canonical': [recTruth, { 'row.txt': canonical(recRef.records[0]) }],
  };
  const pub = task => [inlineRender(task), ...Object.values(solverView(task).files), ...Object.values(taskFiles(task))];
  for (const [what, [truth, files]] of Object.entries(plants)) {
    const task = truth === cfTruth ? cf : rec, needles = truthNeedles(truth, { publicTexts: pub(task) });
    const dir = tmp(t);
    writeTree(dir, files);
    const r = scanLeaks({ roots: [dir], needles });
    assert.equal(r.ok, false, `${what}: found`);
    assert.ok(r.hits.every(h => h.kind === 'bytes'), what);
    // The task as the solver gets it is clean under the same needles (the plant, not the task, is the hit).
    const clean = tmp(t);
    writeTree(clean, { ...solverView(task).files, ...taskFiles(task) });
    assert.deepEqual(scanLeaks({ roots: [clean], needles, prompts: { inline: inlineRender(task) } }).hits, [], `${what}: the task itself is clean`);
  }
  // The old whole-object needles missed every one of these.
  for (const [what, [truth, files]] of Object.entries(plants)) {
    const old = truth.slice(0, 1).flatMap(v => [canonical(v), JSON.stringify(v), JSON.stringify(v, null, 1), JSON.stringify(v, null, 2)]).filter(n => n.length >= 32);
    const dir = tmp(t);
    writeTree(dir, files);
    assert.equal(scanLeaks({ roots: [dir], needles: old }).ok, true, `${what}: invisible to whole-answer needles`);
  }
  // A string leaf is a needle as itself; a needle shown to the solver anyway is dropped.
  assert.ok(truthNeedles([{ a: { b: ['x'.repeat(40)] } }]).includes('x'.repeat(40)));
  assert.deepEqual(truthNeedles([{ a: 'y'.repeat(40) }], { publicTexts: [`... ${'y'.repeat(40)} ...`] }).filter(n => n === 'y'.repeat(40)), []);
});

test('X1: the library solver\'s workdir holds no truth file and no byte of the library\'s verdict or label rows', async t => {
  const lib = openLibrary(tmp(t, 'x1-lib-'));
  const e = lib.register({ layer: 'L2', name: 'sum', contract: { output: { type: 'object' }, taskTemplate: 'Sum the rows.' }, stub: async () => ({ output: {} }), tags: ['compose'],
    provenance: { source: 'maintainer', ref: 'fixture', licence: 'internal', redistributable: false } });
  lib.addEvidence(e.hash, { kind: 'run', ok: true, oracle: 'pass', runId: 'x1-planted-verdict-0001' });
  const id = lib.recordJudgment({ port: 'applicability', engine: 'jev', model: 'jev-1.13.0', request: { options: ['false', 'true'], state: { task: 'Sum the rows.' } },
    result: { probabilities: { false: 0.9, true: 0.1 }, chosen: 'false', confidence: 0.9 }, split: 'calibration', meta: {} });
  lib.labelJudgment(id, 'true', { source: 'oracle' });
  const truthRows = [lib.files.evidence, lib.files.judgments].flatMap(f => readFileSync(f, 'utf8').trim().split('\n'));
  const work = tmp(t, 'x1-work-');
  const r = await runSolver({ source: 'console.log(JSON.stringify({ ok: true }))', task: { prompt: 'Sum the rows.', inputs: { rows: [1, 2] } }, library: lib, workdir: work });
  assert.equal(r.status, 'ok', r.stderr);
  const scan = scanLeaks({ roots: [work], needles: truthNeedles(truthRows) });
  assert.ok(scan.files > 0);
  assert.deepEqual(scan.hits, [], 'no truth file or truth row under the solver\'s workdir');
});

test('X1: B1 / construct sandbox files, agent files and the direct prompt of the NL0 families\' dev tasks hold no byte of the task\'s truth (answer, trace, hidden suite)', async t => {
  let scanned = 0, dropped = 0, total = 0;
  for (const [family, seeds] of [['records', [201, 202]], ['wbed-r0', [301, 302]], ['wbed-r3', [301, 302]], ['codefix', [201]]]) {
    const fam = await loadFamily(family);
    for (const { task, taskKey } of await makeTasks(family, { split: 'dev', seeds, difficulty: 3 })) {
      // Every part of the reference answer, the reference trace and held-out material (codefix's hidden suite), minus the
      // few needles the task shows anyway (a hidden case whose title is a visible test's).
      const truth = await taskTruth(family, task), all = truthNeedles(truth);
      const needles = truthNeedles(truth, { publicTexts: [inlineRender(task), ...Object.values(solverView(task).files), ...Object.values(taskFiles(task))] });
      assert.ok(needles.length, `${taskKey}: the reference answer is long enough to scan for`);
      assert.ok(truthNeedles([await fam.referenceSolve(task)]).every(n => needles.includes(n)), `${taskKey}: no part of the answer is public`);
      dropped += all.length - needles.length; total += all.length;
      const dir = tmp(t, 'x1-bed-');
      writeTree(path.join(dir, 'b1'), taskFiles(task));
      writeTree(path.join(dir, 'agent'), solverView(task).files);
      const r = scanLeaks({ roots: [dir], needles, prompts: { inline: inlineRender(task), prompt: task.prompt } });
      assert.deepEqual(r.hits, [], `${taskKey}: ${JSON.stringify(r.hits.slice(0, 3))}`);
      scanned += r.files;
    }
  }
  assert.ok(scanned >= 20);
  assert.ok(total > 2000 && dropped / total < 0.01, `needles ${total}, dropped as public ${dropped}`);
});
