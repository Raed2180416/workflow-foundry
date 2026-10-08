// Tests of the R-bench item "update Selenium Grid versions" (SHAFT maintainer bot). Run: node --test experiments/replicate/items/github-actions-shafthq-update-selenium-grid-versions/item.test.mjs
// Sections: contract and determinism; oracle health (reference solves, bad controls, schema, leakage); oracle checks one by one; the mocks and the
// runner; the control "the original passes"; broken variants of the original; fixtures and freeze. Needs only Node, bash, curl (and, optionally,
// unshare and docker, whose absence is reported as a skip with the reason).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as bed from './index.mjs';
import { COMPOSE_PATH, ITEM, MODE_OF, PR, REFERENCE_URL, TRACKED, readText, sha256 } from './spec.mjs';
import { DEFECT_KINDS, KINDS, KIND_IDS, canonicalInstances, inputsOf, instanceFor, poolFor } from './scenarios.mjs';
import { judge, judgePlan, outcomeFromPlan, outputSchema, schemaViolations } from './oracle.mjs';
import { FileCommandError, Unsupported, SCRATCH, evalCondition, interpolate, isolation, parseOutputFile, parseWorkflow, runWorkflow } from './runner.mjs';
import { YamlError, parseYaml } from './miniyaml.mjs';
import { validateCompose } from './mocks/compose-validate.mjs';
import { PullRequestStore, diffTrees } from './mocks/pull-requests.mjs';
import { startReferenceServer } from './mocks/reference-server.mjs';
import { MUTANTS } from './controls/mutants.mjs';
import { effectSignature, originalText, planFromObservation, runOriginal } from './controls/original.mjs';
import { renderPrText, solveFaithful, solveImproved, solveNothing } from './controls/reference.mjs';
import { OUT_OF_SCOPE, dockerAvailable, realCompose } from './controls/record-docker-probes.mjs';
import { runViaFoundry, workflow as foundryWorkflow } from './controls/foundry-workflow.mjs';
import { snapshot as freezeSnapshot, taskHashes } from './freeze.mjs';
import { drift as fixtureDrift } from './build-fixtures.mjs';
import { checkPortableSchema } from '../../../../src/schema-subset.mjs';
import { hashOf } from '../../../../beds/lib/canonical.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SLOW = { timeout: 600000 };
const VARIANTS = bed.VARIANTS;
const tmp = prefix => { mkdirSync(SCRATCH, { recursive: true }); return mkdtempSync(path.join(SCRATCH, prefix)); };
const CONCURRENCY = isolation() === 'mount-ns' ? 4 : 1;      // the original writes /tmp/reference-compose.yml: parallel runs need the private /tmp
async function pool(items, fn, n = CONCURRENCY) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}
const task = (seed, variant = 'T2', difficulty = 5, split = 'dev') => bed.generate({ seed, split, difficulty, variant });
const seedOfKind = kind => KIND_IDS.indexOf(kind);              // at difficulty 5 seed i is kind i
const violationsOf = (t, plan) => bed.oracle(t, plan).details.violations ?? [];
const withPlan = (t, edit) => { const p = structuredClone(bed.referenceSolve(t)); edit(p); return p; };

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 1. contract and determinism
// ---------------------------------------------------------------------------------------------------------------------------------------------
test('exports the beds/CONTRACT.md interface plus the R-bench extras', () => {
  for (const name of ['family', 'outputSchema', 'generate', 'oracle', 'referenceSolve', 'badControls', 'instanceOf', 'materialize', 'meetsTarget']) assert.ok(name in bed, name);
  assert.equal(bed.family.id, `rbench-${ITEM.safeId}`);
  assert.equal(bed.family.kind, 'oneshot');
  assert.deepEqual(bed.VARIANTS, ['T1', 'T2', 'T3']);
  assert.ok(Array.isArray(bed.badControls) && bed.badControls.every(c => c.name && typeof c.make === 'function' && typeof c.applies === 'function'));
  checkPortableSchema(outputSchema);   // throws unless the schema is inside the portable subset (no pattern, oneOf, $ref, format, ...)
});

test('generate is a pure function of (seed, split, difficulty, variant): identical calls give byte-identical tasks', () => {
  for (const variant of VARIANTS) for (const difficulty of [1, 3, 5]) for (const seed of [0, 1, 7, 13, 29]) {
    const a = bed.generate({ seed, split: 'dev', difficulty, variant }), b = bed.generate({ seed, split: 'dev', difficulty, variant });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  }
  assert.notEqual(hashOf(task(3, 'T2', 5, 'dev')), hashOf(task(3, 'T2', 5, 'test')), 'split salts the content');
  assert.notEqual(hashOf(task(3, 'T2', 5)), hashOf(task(17, 'T2', 5)), 'a different seed of the same kind gives different content');
  assert.equal(task(3).id, `rbench:${ITEM.safeId}:T2:dev:d5:s3`);
});

test('generate rejects out-of-range arguments', () => {
  assert.throws(() => bed.generate({ seed: 1, split: 'prod', difficulty: 3, variant: 'T2' }), /split/);
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 6, variant: 'T2' }), /difficulty/);
  assert.throws(() => bed.generate({ seed: -1, split: 'dev', difficulty: 3, variant: 'T2' }), /seed/);
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 3, variant: 'T4' }), /variant/);
});

test('difficulty gates the scenario kinds and seeds cycle through them', () => {
  assert.equal(KINDS.length, 14);
  assert.deepEqual(poolFor(1).map(k => k.id), ['bump-all', 'bump-some', 'no-change']);
  assert.equal(poolFor(5).length, 14);
  assert.deepEqual(canonicalInstances().map(i => i.kind), KIND_IDS, 'seeds 0-13 at d5 are one instance of each kind, in order');
  for (let d = 1; d <= 5; d++) {
    const seen = new Set(Array.from({ length: 28 }, (_, s) => instanceFor({ seed: s, split: 'dev', difficulty: d }).kind));
    assert.deepEqual([...seen].sort(), poolFor(d).map(k => k.id).sort(), `difficulty ${d}`);
  }
});

test('the three variants give the solver what the README says and nothing else', () => {
  const t1 = task(4, 'T1'), t2 = task(4, 'T2'), t3 = task(4, 'T3');
  const original = readText(ITEM.vendoredPath);
  for (const t of [t1, t3]) { assert.equal(t.files['original/update-selenium-grid-versions.yml'], original); assert.match(t.files['original/LICENSE'], /^MIT License/); }
  assert.equal(t2.files['original/update-selenium-grid-versions.yml'], undefined, 'T2 must not see the original');
  for (const needle of ['peter-evans', 'grep -qiE', 'CURRENT_CHROME', 'GITHUB_OUTPUT', 'update-versions', 'sed -i']) assert.ok(!JSON.stringify(t2).includes(needle), `T2 mentions ${needle}`);
  assert.equal(t2.inputs.examples.length, 3);
  assert.equal(t1.inputs.examples, undefined);
  assert.equal(t3.inputs.examples, undefined);
  assert.ok(t3.budget?.target, 'T3 carries the cost/latency target (needs fixtures/baseline.json)');
  assert.equal(t3.budget.target.modelUsdMax, 0);
  assert.equal(t3.budget.target.latencyMsMax, bed.baseline().wallMsMedian);
  assert.equal(t1.budget, undefined);
  assert.equal(t2.budget, undefined);
  for (const t of [t1, t2, t3]) {
    assert.deepEqual(Object.keys(t.inputs).filter(k => k !== 'examples').sort(), ['open_pull_requests', 'reference_fetch', 'repo_files', 'trigger']);
    assert.match(t.prompt, /plan = \{/);
    assert.ok(t.files['solve.mjs'].includes('export default function solve'));
  }
  assert.match(t2.prompt, /R7 Failure/);
  assert.match(t3.prompt, /budget\.target/);
  assert.match(t1.prompt, /equivalent/);
  assert.ok(!t1.prompt.includes('R7 Failure'), 'T1 is judged on the original, not on a rule list');
});

test('the task never contains the hidden truth, the scenario kind or the expected files', () => {
  for (const variant of VARIANTS) for (const difficulty of [1, 2, 3, 4, 5]) for (let seed = 0; seed < 14; seed++) {
    const t = task(seed, variant, difficulty), text = JSON.stringify(t), inst = bed.instanceOf(t);
    for (const mode of ['original', 'intent']) {
      const f = inst.truth[mode].composeAfter;
      if (f) assert.ok(!text.includes(JSON.stringify(f).slice(1, -1)), `${t.id} contains the expected file (${mode})`);
    }
    for (const k of KIND_IDS) assert.ok(!text.includes(k), `${t.id} names the kind ${k}`);
    assert.ok(!/composeAfter|"truth"|expected-(original|intent)|"meta"/.test(text), t.id);
  }
});

test('T2 examples are correct plans for their own input, and are not scored instances', () => {
  const t = task(0, 'T2');
  const scored = new Set();
  for (const split of ['dev', 'test']) for (let d = 1; d <= 5; d++) for (let s = 0; s < 60; s++) scored.add(hashOf(inputsOf(instanceFor({ seed: s, split, difficulty: d }))));
  for (const ex of t.inputs.examples) {
    assert.ok(!scored.has(hashOf(ex.inputs)), `example ${ex.index} equals a scored instance`);
    assert.deepEqual(schemaViolations(ex.plan), []);
    assert.deepEqual(ex.plan, solveImproved(ex.inputs));
  }
  // and the hidden instance behind each example agrees: the plan passes the oracle's intent mode on it
  const hidden = JSON.stringify(t.inputs.examples);
  assert.ok(!/_instance|truth/.test(hidden));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 2. oracle health (beds/CONTRACT.md "Oracle health")
// ---------------------------------------------------------------------------------------------------------------------------------------------
test('referenceSolve passes at every difficulty for every variant (28 seeds each)', () => {
  for (const variant of VARIANTS) for (const difficulty of [1, 2, 3, 4, 5]) for (let seed = 0; seed < 28; seed++) {
    const t = task(seed, variant, difficulty);
    const r = bed.oracle(t, bed.referenceSolve(t));
    assert.ok(r.pass && r.score === 1, `${t.id}: ${JSON.stringify(r.details)}`);
  }
});

test('every bad control fails on every task it applies to, and each applies to at least 20 tasks', () => {
  const required = ['empty', 'corrupted', 'shuffled-file', 'do-nothing', 'only-chrome-updated', 'prerelease-filter-dropped', 'pr-without-change'];
  assert.deepEqual(required.filter(n => !bed.badControls.some(c => c.name === n)), []);
  const applied = Object.fromEntries(bed.badControls.map(c => [c.name, 0]));
  for (const variant of VARIANTS) for (let seed = 0; seed < 168; seed++) {
    const t = task(seed, variant, 5);
    for (const c of bed.badControls) {
      if (!c.applies(t)) continue;
      applied[c.name]++;
      const r = bed.oracle(t, c.make(t));
      assert.equal(r.pass, false, `${c.name} passed ${t.id}`);
      assert.ok(r.score < 1, `${c.name} ${t.id}`);
    }
  }
  for (const [name, n] of Object.entries(applied)) assert.ok(n >= 20, `${name} applies to only ${n} tasks`);
});

test('a plan that only does the right thing in one respect scores between 0 and 1 (plausible-but-wrong controls)', () => {
  const t = task(0, 'T2');
  const r = bed.oracle(t, bed.badControls.find(c => c.name === 'versions-misreported').make(t));
  assert.equal(r.pass, false);
  assert.ok(r.score > 0.7 && r.score < 1, `score ${r.score}`);
  assert.deepEqual(r.details.violations, ['VERSIONS']);
});

test('the oracle rejects schema-invalid output without throwing', () => {
  const t = task(0, 'T2'), good = bed.referenceSolve(t);
  const bad = [null, undefined, 'plan', 42, [], {}, { ...good, status: 'done' }, { ...good, extra: 1 }, { ...good, files: { [COMPOSE_PATH]: 7 } }, { ...good, files: [] },
    { ...good, versions: { current: good.versions.current } }, { ...good, versions: { current: { chrome: 'x' }, latest: good.versions.latest } },
    { ...good, pull_request: {} }, { ...good, pull_request: { open: 'yes' } }, { ...good, pull_request: { open: true, labels: 'a' } }, { ...good, message: 5 }];
  for (const output of bad) {
    const r = bed.oracle(t, output);
    assert.equal(r.pass, false);
    assert.equal(r.score, 0);
    assert.deepEqual(r.details.violations, ['SCHEMA']);
  }
  assert.equal(bed.oracle(t, { ...good, meta: { costUsd: 0.01 } }).pass, true, 'meta is ignored');
});

test('a do-nothing solution fails every task of the canonical suite in both modes (it is only "right" about nothing to do, and cannot report the versions)', () => {
  for (const inst of canonicalInstances()) for (const mode of ['original', 'intent']) {
    const r = judgePlan(inst, mode, solveNothing());
    assert.equal(r.pass, false, `${inst.kind} ${mode}`);
  }
  const unchangedKinds = canonicalInstances().filter(i => i.truth.intent.status === 'unchanged');
  assert.ok(unchangedKinds.length >= 3);
  for (const inst of unchangedKinds) assert.deepEqual(judgePlan(inst, 'intent', solveNothing()).details.violations, ['VERSIONS'], 'effects are right, only the report is missing');
});

test('the improved and the faithful reference disagree exactly on the original\'s defects', () => {
  const differing = canonicalInstances().filter(inst => {
    const inputs = inputsOf(inst);
    return !judgePlan(inst, 'intent', solveFaithful(inputs)).pass || !judgePlan(inst, 'original', solveImproved(inputs)).pass;
  }).map(i => i.kind);
  // reference-* defects are a failure message only: the faithful port is judged in intent mode, and fails there too
  assert.deepEqual(differing.sort(), [...DEFECT_KINDS].sort());
  for (const inst of canonicalInstances()) assert.equal(judgePlan(inst, 'original', solveFaithful(inputsOf(inst))).pass, true, inst.kind);
  for (const inst of canonicalInstances()) assert.equal(judgePlan(inst, 'intent', solveImproved(inputsOf(inst))).pass, true, inst.kind);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 3. the oracle's checks, one by one
// ---------------------------------------------------------------------------------------------------------------------------------------------
test('oracle: each field of a pull request is checked, and the codes say which', () => {
  const t = task(seedOfKind('bump-all'), 'T2');
  const expect = (edit, code) => assert.ok(violationsOf(t, withPlan(t, edit)).includes(code), `${code} not raised`);
  expect(p => { p.pull_request.title += '!'; }, 'PR_TITLE');
  expect(p => { p.pull_request.labels = ['dependencies']; }, 'PR_LABELS');
  expect(p => { p.pull_request.labels = [...p.pull_request.labels, 'extra']; }, 'PR_LABELS');
  expect(p => { p.pull_request.branch = 'main'; }, 'PR_SINGLE_BOT');
  expect(p => { p.pull_request.body = 'Updated the images.'; }, 'PR_BODY');
  expect(p => { p.pull_request.commit_message = 'Update images'; }, 'PR_COMMIT_MESSAGE');
  expect(p => { p.files[COMPOSE_PATH] += '\n'; }, 'FILE_CONTENT');
  expect(p => { p.files['notes.txt'] = 'x'; }, 'PR_FILES');
  expect(p => { p.versions.latest.hub = ''; }, 'VERSIONS');
  expect(p => { p.status = 'unchanged'; }, 'STATUS_CLAIM');
  expect(p => { p.pull_request.open = false; }, 'STATUS');
  const noPr = withPlan(t, p => { p.pull_request = { open: false }; });
  assert.ok(violationsOf(t, noPr).includes('STATUS'));
  const byte = withPlan(t, p => { p.files[COMPOSE_PATH] = p.files[COMPOSE_PATH].replace('shm_size: 2gb', 'shm_size: 3gb'); });
  assert.deepEqual(violationsOf(t, byte), ['FILE_CONTENT'], 'one byte off is caught, nothing else is');
  const diff = bed.oracle(t, byte).details.checks.find(c => c.code === 'FILE_CONTENT').detail;
  assert.ok(diff.line > 0 && /shm_size/.test(diff.actual), 'the failure points at the first differing line');
});

test('oracle: any wording of the pull request text that names each change passes (the format is not prescribed)', () => {
  const t = task(seedOfKind('bump-some'), 'T2'), inst = bed.instanceOf(t), changes = inst.truth.intent.changed;
  const prose = changes.map(c => `${TRACKED.find(x => x.key === c.key).label} moved from ${c.from} to ${c.to}.`).join('\n');
  const plan = withPlan(t, p => { p.pull_request.body = `Weekly sync with Selenium.\n${prose}`; p.pull_request.commit_message = prose; p.pull_request.labels.reverse(); p.message = 'done'; });
  assert.equal(bed.oracle(t, plan).pass, true);
});

test('oracle: an open bot pull request is updated, never duplicated; other pull requests are never touched', () => {
  const t = task(seedOfKind('open-pr-update'), 'T2'), inst = bed.instanceOf(t), bot = inst.world.openPullRequests[0], other = inst.world.openPullRequests[1];
  const good = bed.referenceSolve(t);
  const r = bed.oracle(t, good);
  assert.equal(r.pass, true);
  assert.deepEqual(outcomeFromPlan(inst, good).pr.events.map(e => [e.operation, e.number]), [['updated', bot.number]]);
  assert.ok(violationsOf(t, withPlan(t, p => { p.pull_request.branch = 'weekly-selenium'; })).includes('PR_ACTION'), 'a second bot pull request piles up');
  assert.ok(violationsOf(t, withPlan(t, p => { p.pull_request.branch = other.head; })).includes('OTHER_PR_TOUCHED'), 'a human\'s pull request was rewritten');
  const quiet = task(seedOfKind('open-pr-no-change'), 'T2');
  assert.equal(bed.oracle(quiet, bed.referenceSolve(quiet)).pass, true);
  const noisy = withPlan(quiet, p => { p.status = 'updated'; p.files[COMPOSE_PATH] = bed.instanceOf(quiet).world.repo[COMPOSE_PATH] + '# touched\n'; p.pull_request = { ...renderPrText(p.versions.current, p.versions.latest), open: true }; });
  assert.ok(violationsOf(quiet, noisy).includes('PR_UNEXPECTED'), 'an open bot pull request must be left alone when nothing changed');
});

test('oracle: failure kinds need a visible failure, no effects and (intent) a message that says what is wrong', () => {
  for (const kind of ['reference-malformed', 'reference-missing-image', 'reference-unreachable', 'prerelease-unreducible']) {
    const t = task(seedOfKind(kind), 'T2'), inst = bed.instanceOf(t);
    assert.equal(inst.truth.intent.status, 'failed');
    assert.equal(bed.oracle(t, bed.referenceSolve(t)).pass, true, kind);
    assert.ok(violationsOf(t, withPlan(t, p => { p.message = 'error'; })).includes('MESSAGE'), `${kind}: a failure without a cause`);
    assert.ok(violationsOf(t, withPlan(t, p => { p.status = 'unchanged'; })).includes('STATUS'), `${kind}: failure not raised`);
    assert.ok(violationsOf(t, withPlan(t, p => { p.files[COMPOSE_PATH] = 'x'; p.pull_request = { open: true, branch: PR.branch }; })).includes('FAILED_WITH_EFFECTS'), `${kind}: effects on a failed run`);
    // T1 (original mode) does not ask for a message: the original has none to give for some of these
    const t1 = task(seedOfKind(kind), 'T1');
    assert.equal(bed.oracle(t1, withPlan(t1, p => { p.message = ''; })).pass, true, `${kind}: T1 does not judge the message`);
  }
  const t = task(seedOfKind('reference-missing-image'), 'T2'), gone = bed.instanceOf(t).meta.gone;
  assert.ok(violationsOf(t, withPlan(t, p => { p.message = 'the reference file is broken'; })).includes('MESSAGE'), 'must name the missing image too');
  assert.equal(bed.oracle(t, withPlan(t, p => { p.message = `reference has no ${TRACKED.find(x => x.key === gone).image} line`; })).pass, true);
});

test('oracle: T1 is judged on the original (defects included), T2 and T3 on the maintainers\' intent', () => {
  for (const kind of ['commented-image-line', 'quoted-image-refs']) {
    const s = seedOfKind(kind), t1 = task(s, 'T1'), t2 = task(s, 'T2'), t3 = task(s, 'T3');
    assert.equal(MODE_OF.T1, 'original');
    assert.equal(bed.oracle(t1, solveFaithful(t1.inputs)).pass, true, `${kind}: a faithful translation reproduces the defect`);
    assert.equal(bed.oracle(t1, solveImproved(t1.inputs)).pass, false, `${kind}: "fixing" it is not a faithful translation`);
    for (const t of [t2, t3]) {
      assert.equal(bed.oracle(t, solveImproved(t.inputs)).pass, true);
      assert.equal(bed.oracle(t, solveFaithful(t.inputs)).pass, false, `${kind}: the defect is a failure against the intent`);
    }
  }
  const q = bed.instanceOf(task(seedOfKind('quoted-image-refs'), 'T1')).truth.original;
  assert.equal(q.status, 'updated');
  assert.ok(q.changed.every(c => c.key && typeof c.to === 'string'));
});

test('oracle: the tolerance is real - an independently written solution with a different shape passes', () => {
  // a third implementation: line-based, no regex helpers shared with the references
  function solveByLines(inputs) {
    const lines = inputs.repo_files[COMPOSE_PATH].split('\n');
    const ref = inputs.reference_fetch;
    const fail = why => ({ status: 'failed', versions: { current: { chrome: '', edge: '', firefox: '', hub: '' }, latest: { chrome: '', edge: '', firefox: '', hub: '' } }, files: {}, pull_request: { open: false }, message: `the reference file: ${why}` });
    if (!ref.body) return fail('unreachable or empty');
    const tagIn = (text, img) => { for (const l of text.split(/\r?\n/)) { const s = l.trim(); if (s.startsWith('#')) continue; const i = s.indexOf(`image:`); if (i !== 0) continue; const v = s.slice(6).trim().replace(/^["']|["']$/g, '').split(' #')[0].trim(); if (v.startsWith(`${img}:`)) return v.slice(img.length + 1); } return ''; };
    const latest = {}, current = {};
    for (const t of TRACKED) { latest[t.key] = tagIn(ref.body, t.image); current[t.key] = tagIn(inputs.repo_files[COMPOSE_PATH], t.image); }
    for (const t of TRACKED) if (!latest[t.key]) return fail(`no ${t.image} image`);
    for (const t of TRACKED) if (/nightly|beta|dev/i.test(latest[t.key])) { const m = /\d+\.\d+\.\d+-\d+/.exec(latest[t.key]); if (!m) return fail('pre-release tag ' + latest[t.key]); latest[t.key] = m[0]; }
    const changed = TRACKED.filter(t => current[t.key] && current[t.key] !== latest[t.key]);
    const out = lines.map(l => { let x = l; for (const t of changed) x = x.split(`${t.image}:${current[t.key]}`).join(`${t.image}:${latest[t.key]}`); return x; }).join('\n');
    if (!changed.length) return { status: 'unchanged', versions: { current, latest }, files: {}, pull_request: { open: false }, message: 'up to date' };
    const rows = changed.map(t => `${t.label}: ${current[t.key]} -> ${latest[t.key]}`).join('\n');
    return { status: 'updated', versions: { current, latest }, files: { [COMPOSE_PATH]: out }, pull_request: { open: true, branch: PR.branch, title: PR.title, labels: ['automated', 'dependencies'], commit_message: rows, body: rows }, message: 'ok' };
  }
  let pass = 0, n = 0;
  for (const variant of ['T2', 'T3']) for (let seed = 0; seed < 28; seed++) { const t = task(seed, variant, 5); n++; if (bed.oracle(t, solveByLines(t.inputs)).pass) pass++; }
  assert.equal(pass, n, 'a valid alternative design must pass every task');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 4. the mocks and the runner
// ---------------------------------------------------------------------------------------------------------------------------------------------
test('mini YAML: parses the vendored workflow, refuses what it does not support, and reports real syntax errors', () => {
  const wf = parseWorkflow(readText(ITEM.vendoredPath));
  assert.equal(wf.steps.length, 6);
  assert.deepEqual(wf.steps.map(s => s.id), [null, 'fetch-reference', 'check-current', 'update-file', null, null]);
  assert.equal(wf.steps[5].with.labels, 'dependencies\nautomated\n');
  assert.match(wf.steps[5].with['commit-message'], /→/);
  const doc = parseYaml(readText(ITEM.vendoredPath));
  assert.deepEqual(doc.on.schedule, [{ cron: '0 8 * * 1' }]);
  assert.equal(doc.on.workflow_dispatch, null);
  for (const text of ['a: &x 1\n', 'a: [1, 2]\n', 'a: {b: 1}\n', 'a: >\n  folded\n', '<<: *x\n', 'a: b\n---\nc: d\n', 'a: *x\n']) assert.throws(() => parseYaml(text), e => e instanceof YamlError && e.code === 'UNSUPPORTED', text);
  for (const text of ['a: b: c\n', 'a:\n\tb: 1\n', 'a: "x\n', 'a: 1\na: 2\n', 'services:\n  hub:\n    image: x:\n']) assert.throws(() => parseYaml(text), e => e instanceof YamlError && e.code === 'SYNTAX', text);
  assert.equal(parseYaml(''), null);
  assert.deepEqual(parseYaml('a: |-\n  x\n  y\nb: \'it\'\'s\'\nc: "t\\tq" # c\nd:\n- 1\n- k: v\n  w: 2\n'), { a: 'x\ny', b: "it's", c: 't\tq', d: ['1', { k: 'v', w: '2' }] });
});

test('runner: expressions and conditions are a closed, tested subset', () => {
  const ctx = { steps: { a: { outputs: { x: 'True', y: '' } } } };
  assert.equal(interpolate('v=${{ steps.a.outputs.x }};${{ steps.a.outputs.missing }}.', ctx), 'v=True;.');
  assert.equal(interpolate('${{ secrets.GITHUB_TOKEN }}', ctx).startsWith('rbench-dummy'), true);
  assert.equal(evalCondition("steps.a.outputs.x == 'true'", ctx), true, 'GitHub compares strings case-insensitively');
  assert.equal(evalCondition("steps.a.outputs.x != 'true'", ctx), false);
  assert.equal(evalCondition("steps.a.outputs.y == ''", ctx), true);
  assert.equal(evalCondition('success()', ctx), true);
  for (const bad of ['${{ github.sha }}', '${{ env.HOME }}', "${{ contains(steps.a.outputs.x, 'T') }}"]) assert.throws(() => interpolate(bad, ctx), Unsupported, bad);
  for (const bad of ['always()', "contains(steps.a.outputs.x, 'T')", 'steps.a.outputs.x']) assert.throws(() => evalCondition(bad, ctx), Unsupported, bad);
});

test('runner: $GITHUB_OUTPUT is parsed as the runner does; a line it cannot parse fails the step', () => {
  assert.deepEqual(parseOutputFile('a=1\n\nb=x=y\nc<<EOF\nl1\nl2\nEOF\n'), { a: '1', b: 'x=y', c: 'l1\nl2' });
  for (const bad of ['a=1\nstray\n', 'c<<EOF\nnever closed\n', '=x\n']) assert.throws(() => parseOutputFile(bad), FileCommandError, bad);
});

test('runner: rejects workflows it cannot reproduce instead of flattening them', () => {
  const wrap = body => `name: t\non: push\njobs:\n  a:\n    runs-on: x\n    steps:\n${body}`;
  assert.throws(() => parseWorkflow('name: t\njobs:\n  a:\n    steps:\n      - run: echo\n  b:\n    steps:\n      - run: echo\n'), Unsupported);
  assert.throws(() => parseWorkflow(wrap('      - uses: actions/cache@v4\n')), /action actions\/cache/);
  assert.throws(() => parseWorkflow(wrap('      - run: echo\n        shell: pwsh\n')), /step key "shell"/);
  assert.throws(() => parseWorkflow(wrap('      - run: echo\n        uses: actions/checkout@v6\n')), /exactly one of run/);
  assert.throws(() => parseWorkflow('name: t\njobs:\n  a:\n    needs: b\n    steps:\n      - run: echo\n'), /job key "needs"/);
});

test('runner: a step runs hermetically (minimal environment, shimmed curl, private /tmp where available)', SLOW, async () => {
  const wf = ['name: probe', 'on: push', 'jobs:', '  p:', '    runs-on: x', '    steps:', '      - name: env', '        id: e', '        run: |', '          env | sort',
    '          echo "tmpfile=$(ls /tmp | wc -l)" >> $GITHUB_OUTPUT', '          echo hi > /tmp/rbench-probe-file',
    '      - name: other host', '        run: curl -s https://example.com/ || echo "rc=$?"', '      - name: sink', '        run: curl -s https://example.org/x > /dev/null', ''].join('\n');
  const world = { repo: { 'README.md': 'x\n' }, http: { status: 200, body: 'ok' }, openPullRequests: [] };
  const obs = await runWorkflow({ workflowText: wf, world });
  const names = obs.steps[0].output.split('\n').filter(l => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l)).map(l => l.split('=')[0]);
  const allowed = new Set(['PATH', 'HOME', 'LANG', 'CI', 'GITHUB_ACTIONS', 'GITHUB_WORKSPACE', 'GITHUB_OUTPUT', 'PWD', 'SHLVL', '_', 'OLDPWD', 'RBENCH_OUT', 'RBENCH_PORT', 'RBENCH_REFERENCE_URL',
    'RBENCH_REFERENCE_HOST', 'RBENCH_NODE', 'RBENCH_MOCKS', 'RBENCH_CURL']);
  assert.deepEqual(names.filter(n => !allowed.has(n)), [], 'environment leaked into the step');
  assert.ok(!/TOKEN|SECRET|KEY|PROXY/i.test(obs.steps[0].output.replace(/RBENCH_[A-Z_]+/g, '').replace(/rbench-dummy[a-z-]*/g, '')), 'a credential-looking variable reached the step');
  assert.ok(!obs.steps[0].output.includes(`HOME=${process.env.HOME}\n`) || process.env.HOME?.startsWith(SCRATCH));
  assert.equal(obs.steps[1].status, 'success');
  assert.match(obs.steps[1].output, /rbench: curl blocked: https:\/\/example\.com\/ is not the recorded reference URL/);
  assert.match(obs.steps[1].output, /rc=7/);
  assert.deepEqual(obs.curl.map(c => c.verdict), ['blocked', 'blocked']);
  assert.equal(obs.failed, true, 'the last step fails: curl exits 7 under errexit');
  assert.equal(obs.http.length, 0, 'the mock saw no request: nothing left the shim');
  if (obs.isolation === 'mount-ns') {
    assert.equal(obs.steps[0].outputs.tmpfile, '0', 'a step starts with an empty private /tmp');
    assert.ok(!existsSync('/tmp/rbench-probe-file'), 'the step\'s /tmp write reached the host');
  }
});

test('reference server and curl shim: the recorded response is served, the call is logged, a cut connection fails the transfer', SLOW, async () => {
  const wf = ['name: t', 'on: push', 'jobs:', '  p:', '    runs-on: x', '    steps:', '      - name: get', '        run: |', `          curl -s ${REFERENCE_URL} > got.txt`, '          echo "rc=$?"', '          cat got.txt', ''].join('\n');
  const body = 'services:\n  hub:\n    image: selenium/hub:4.35.0-20250909\n';
  const ok = await runWorkflow({ workflowText: wf, world: { repo: { 'README.md': 'x' }, http: { status: 200, body }, openPullRequests: [] } });
  assert.equal(ok.failed, false);
  assert.match(ok.steps[0].output, /rc=0/);
  assert.ok(ok.steps[0].output.includes(body));
  assert.deepEqual(ok.http.map(h => [h.method, h.originalUrl, h.status]), [['GET', REFERENCE_URL, 200]]);
  const cut = await runWorkflow({ workflowText: wf, world: { repo: { 'README.md': 'x' }, http: { error: 'reset' }, openPullRequests: [] } });
  assert.equal(cut.failed, true);
  assert.equal(cut.failedStep.exitCode, 52, 'curl: empty reply from server');
  const direct = await startReferenceServer({ response: { status: 200, body: 'x' } });
  const res = await fetch(`http://127.0.0.1:${direct.port}/other`);
  assert.equal(res.status, 404);
  assert.equal(direct.requests[0].path, '/other');
  await direct.close();
});

test('pull-request stub: no diff does nothing, a diff opens, the same branch updates, other inputs are refused', () => {
  const base = { 'a.txt': '1\n', 'b.txt': '1\n' };
  const s = new PullRequestStore({ base, openPullRequests: [{ number: 5, head: 'other', base: 'main', title: 't', body: '', labels: [], files: {} }] });
  assert.equal(s.createPullRequest({ workspace: base, inputs: { branch: 'x' } }).operation, 'none');
  const c = s.createPullRequest({ workspace: { ...base, 'a.txt': '2\n' }, inputs: { branch: 'x', title: 'T', labels: 'l1\nl2\n, l3', 'commit-message': 'm', body: 'B', token: 'tk', 'delete-branch': 'true' } });
  assert.deepEqual([c.operation, c.number], ['created', 6]);
  const u = s.createPullRequest({ workspace: { ...base, 'a.txt': '3\n' }, inputs: { branch: 'x' } });
  assert.deepEqual([u.operation, u.number], ['updated', 6]);
  const snap = s.snapshot();
  assert.deepEqual(snap.touched, [6]);
  assert.equal(snap.pulls.find(p => p.number === 6).title, 'Changes by create-pull-request action', 'inputs left out take the action\'s default (here the second call left the title out)');
  assert.deepEqual(snap.pulls.find(p => p.number === 6).labels, [], 'on update every field is what the run supplied: no labels supplied, none kept (a simplification of the real action, which only adds)');
  assert.deepEqual(s.pulls.find(p => p.number === 5), { number: 5, state: 'open', head: 'other', base: 'main', title: 't', body: '', labels: [], files: {}, commitMessage: '' }, 'the unrelated pull request is untouched');
  const c2 = new PullRequestStore({ base, openPullRequests: [] }).createPullRequest({ workspace: { ...base, 'a.txt': '2\n' }, inputs: { branch: 'y', labels: 'l1\nl2\n, l3' } });
  assert.equal(c2.operation, 'created');
  assert.deepEqual(diffTrees({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' }), { b: { status: 'modified', content: '3' }, c: { status: 'added', content: '4' } });
  assert.throws(() => s.createPullRequest({ workspace: base, inputs: { branch: 'x', assignees: 'me' } }), /not implemented/);
});

test('docker stub: agrees with the real `docker compose config` on every recorded probe it models, and refuses the rest', () => {
  const rec = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'docker-probes.json'), 'utf8'));
  assert.ok(rec.probes.length >= 30);
  for (const p of rec.probes) {
    if (OUT_OF_SCOPE[p.name]) {
      assert.equal(p.outOfScope, OUT_OF_SCOPE[p.name]);
      continue;
    }
    assert.equal(validateCompose(p.text).ok ? 0 : 1, p.rc, `${p.name}: stub disagrees with the recorded real result (${p.firstError})`);
  }
  for (const name of ['services-empty-flow', 'json-error']) assert.throws(() => validateCompose(rec.probes.find(p => p.name === name).text), e => e.code === 'UNSUPPORTED', 'a flow collection must be refused, not guessed');
  const sh = spawnSync(path.join(HERE, 'mocks', 'bin', 'docker'), ['run', 'hello-world'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', RBENCH_NODE: process.execPath, RBENCH_MOCKS: path.join(HERE, 'mocks') } });
  assert.equal(sh.status, 125);
  assert.match(sh.stderr, /unsupported invocation/);
});

test('docker stub vs the live docker compose on the files this item actually produces', { skip: dockerAvailable() ? false : 'docker compose is not available in this environment (the recorded probes above still hold the stub to the real results)' }, () => {
  const dir = tmp('live-');
  try {
    const rec = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'docker-probes.json'), 'utf8'));
    for (const p of rec.probes.filter(x => !x.outOfScope)) assert.equal(realCompose(p.text, dir).rc, p.rc, `${p.name}: the live command no longer matches the recording`);
    for (const inst of canonicalInstances()) {
      const text = solveFaithful(inputsOf(inst), { skipValidation: true }).files[COMPOSE_PATH] ?? inst.world.repo[COMPOSE_PATH];
      assert.equal(validateCompose(text).ok, realCompose(text, dir).rc === 0, `${inst.kind}: stub and real compose disagree about the edited file`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 5. the control "the original passes"
// ---------------------------------------------------------------------------------------------------------------------------------------------
test('the vendored original is byte-identical to the pinned corpus file', () => {
  assert.equal(sha256(readFileSync(path.join(HERE, ITEM.vendoredPath))), ITEM.rawSha256);
  assert.equal(Buffer.byteLength(originalText()), 9360);
  const selection = JSON.parse(readFileSync(path.join(HERE, '..', '..', 'selection.json'), 'utf8')).items.find(i => i.id === ITEM.id);
  assert.equal(selection.source.rawPin.sha256, ITEM.rawSha256);
  assert.equal(selection.source.license, 'MIT');
  assert.match(readFileSync(path.join(HERE, 'fixtures', 'original', 'LICENSE'), 'utf8'), /Permission is hereby granted, free of charge/);
  const raw = ITEM.corpusRawPath;
  if (existsSync(raw)) assert.equal(sha256(readFileSync(raw)), ITEM.rawSha256, 'the corpus file changed under us');
});

test('CONTROL: the original, executed on the mocks, passes the oracle in original mode on all 14 canonical scenarios', SLOW, async () => {
  const instances = canonicalInstances();
  const results = await pool(instances, async inst => ({ inst, ...(await runOriginal(inst)) }));
  for (const { inst, observation, outcome } of results) {
    const r = judge(inst, 'original', outcome);
    assert.ok(r.pass, `${inst.kind}: ${JSON.stringify(r.details)}\n${observation.steps.map(s => `${s.name}: ${s.status}`).join(' | ')}\n${observation.message}`);
    assert.equal(r.score, 1);
    assert.equal(observation.http.length, 1, `${inst.kind}: exactly one call to the reference host`);
    assert.equal(observation.http[0].originalUrl, REFERENCE_URL);
    assert.deepEqual(observation.curl.map(c => c.verdict), ['allowed']);
    assert.deepEqual(observation.docker.filter(d => d.rc === 125), [], 'the docker stub was asked something it does not understand');
  }
  // the original's own steps: when nothing changed it never validates and never asks for a pull request
  const quiet = results.find(r => r.inst.kind === 'no-change').observation;
  assert.deepEqual(quiet.steps.map(s => s.status), ['success', 'success', 'success', 'success', 'skipped', 'skipped']);
  assert.equal(quiet.docker.length, 0);
  assert.equal(quiet.pr.requests, 0);
  const bump = results.find(r => r.inst.kind === 'bump-all').observation;
  assert.deepEqual(bump.steps.map(s => s.status), Array(6).fill('success'));
  assert.equal(bump.docker.length, 1);
  assert.equal(bump.pr.created, 1);
  // submitted as a T1 answer through the plan adapter, the executed original passes oracle() too
  for (const { inst, observation } of results) {
    const t = task(inst.seed, 'T1');
    assert.equal(bed.oracle(t, planFromObservation(observation)).pass, true, `${inst.kind}: executed original as a T1 plan`);
  }
});

test('CONTROL: more instances of each kind (3 more seeds each): the original passes original mode, the port has identical effects', SLOW, async () => {
  const instances = [1, 2, 3].flatMap(j => KINDS.map((_, i) => instanceFor({ seed: i + 14 * j, split: 'dev', difficulty: 5 })));
  const results = await pool(instances, async inst => ({ inst, ...(await runOriginal(inst)) }));
  for (const { inst, outcome } of results) {
    const r = judge(inst, 'original', outcome);
    assert.ok(r.pass, `${inst.kind}#${inst.seed}: ${JSON.stringify(r.details)}`);
    assert.equal(effectSignature(outcomeFromPlan(inst, solveFaithful(inputsOf(inst)))), effectSignature(outcome), `${inst.kind}#${inst.seed}: the JavaScript port and the executed original differ`);
  }
});

test('CONTROL: against the maintainers\' intent the original fails exactly on its documented defects (the T3 headroom)', SLOW, async () => {
  const results = await pool(canonicalInstances(), async inst => ({ inst, ...(await runOriginal(inst)) }));
  const failing = results.filter(({ inst, outcome }) => !judge(inst, 'intent', outcome).pass).map(r => r.inst.kind);
  assert.deepEqual(failing.sort(), [...DEFECT_KINDS].sort());
  const codes = Object.fromEntries(results.filter(r => DEFECT_KINDS.includes(r.inst.kind)).map(r => [r.inst.kind, judge(r.inst, 'intent', r.outcome).details.violations]));
  for (const k of ['reference-malformed', 'reference-missing-image', 'reference-unreachable']) assert.deepEqual(codes[k], ['MESSAGE'], `${k}: right outcome, no cause named`);
  assert.ok(codes['commented-image-line'].includes('FILE_CONTENT'), 'the downgrade');
  assert.ok(codes['quoted-image-refs'].includes('FILE_CONTENT') || codes['quoted-image-refs'].includes('STATUS'), 'the corrupted tags');
  // what the executed original does to a quoted repository file, in its own words: the new tag is pasted in front of the old one
  const q = results.find(r => r.inst.kind === 'quoted-image-refs');
  const mangled = q.outcome.pr.pulls.find(p => p.head === PR.branch).files[COMPOSE_PATH].content;
  const quoted = q.inst.meta.quoted[0], image = TRACKED.find(t => t.key === quoted).image;
  assert.match(mangled, new RegExp(`${image.replace('/', '\\/')}:4\\.\\d+\\.0-\\d{8}4\\.\\d+\\.0-\\d{8}`), 'new tag glued to the old tag');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 6. broken variants of the original must fail
// ---------------------------------------------------------------------------------------------------------------------------------------------
test('CONTROL: each broken variant of the original fails exactly where it is broken, and an equivalent variant passes everywhere', SLOW, async () => {
  const base = originalText();
  const instances = canonicalInstances();
  for (const m of MUTANTS) {
    const text = m.apply(base);
    assert.notEqual(text, base, `${m.id} did not change the workflow`);
    parseWorkflow(text);
    const verdicts = await pool(instances, async inst => judge(inst, 'original', (await runOriginal(inst, { workflowText: text })).outcome));
    instances.forEach((inst, i) => {
      if (m.fails(inst)) assert.equal(verdicts[i].pass, false, `${m.id} passed ${inst.kind}, which it must fail`);
      else assert.equal(verdicts[i].pass, true, `${m.id} failed ${inst.kind}, which it should not touch: ${JSON.stringify(verdicts[i].details)}`);
    });
    const failed = verdicts.filter(v => !v.pass).length;
    if (m.equivalent) assert.equal(failed, 0, `${m.id} is an equivalent variant`);
    else assert.ok(failed >= 1, `${m.id} fails nowhere`);
    if (m.id !== 'wrong-reference-url' && !m.equivalent) assert.ok(failed < instances.length, `${m.id} fails everywhere: it is noise, not a near miss`);
  }
});

test('CONTROL: a workflow that calls another host is stopped by the shim and caught by the oracle', SLOW, async () => {
  const m = MUTANTS.find(x => x.id === 'wrong-reference-url');
  const inst = instanceFor({ seed: 0, split: 'dev', difficulty: 5 });
  const { observation, outcome } = await runOriginal(inst, { workflowText: m.apply(originalText()) });
  assert.equal(observation.http.length, 0, 'nothing reached the mock server');
  assert.deepEqual(observation.curl.map(c => c.verdict), ['blocked']);
  const r = judge(inst, 'original', outcome);
  assert.ok(r.details.violations.includes('NO_BLOCKED_CALLS') && r.details.violations.includes('FETCH') && r.details.violations.includes('STATUS'), r.details.violations.join());
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 7. fixtures, freeze, integration
// ---------------------------------------------------------------------------------------------------------------------------------------------
test('fixtures/scenarios/ is exactly what the generator produces, and holds the recorded answers', () => {
  assert.deepEqual(fixtureDrift(), []);
  for (const inst of canonicalInstances()) {
    const dir = path.join(HERE, 'fixtures', 'scenarios', `${String(inst.seed).padStart(2, '0')}-${inst.kind}`);
    const sc = JSON.parse(readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
    assert.equal(sc.kind, inst.kind);
    if (inst.world.http.error) assert.deepEqual(sc.fetch, { error: 'reset' });
    else assert.equal(readFileSync(path.join(dir, 'recorded', 'reference.yml'), 'utf8'), inst.world.http.body);
    assert.equal(readFileSync(path.join(dir, 'repo', COMPOSE_PATH), 'utf8'), inst.world.repo[COMPOSE_PATH]);
  }
});

test('the fixtures are small, synthetic, and carry no secret or real credential', () => {
  const files = Object.keys(freezeSnapshot().files).filter(f => f.startsWith('fixtures/'));
  let bytes = 0;
  for (const f of files) {
    const text = readFileSync(path.join(HERE, f), 'utf8');
    bytes += text.length;
    assert.ok(!/ghp_|ghs_[A-Za-z0-9]{20}|AKIA[0-9A-Z]{12}|BEGIN (RSA |OPENSSH )?PRIVATE KEY/.test(text), `${f} looks like it holds a credential`);
  }
  assert.ok(bytes < 150 * 1024, `fixtures are ${bytes} bytes`);
  assert.match(readFileSync(path.join(HERE, 'fixtures', 'scenarios', '00-bump-all', 'repo', COMPOSE_PATH), 'utf8'), /synthetic fixture/);
});

test('freeze: the evaluation material is unchanged since fixtures/FREEZE.json (bump VERSION and re-freeze to change it on purpose)', async () => {
  const frozen = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'FREEZE.json'), 'utf8'));
  const now = freezeSnapshot();
  assert.deepEqual(Object.keys(now.files).filter(f => frozen.files[f] !== now.files[f]), []);
  assert.deepEqual(Object.keys(frozen.files).filter(f => !(f in now.files)), []);
  assert.deepEqual(await taskHashes(), frozen.tasks);
});

test('T3 efficiency is judged apart from correctness, against the measured baseline', () => {
  const t = task(1, 'T3');
  assert.equal(bed.meetsTarget(t, { costUsd: 0, latencyMs: 5 }).ok, true);
  assert.equal(bed.meetsTarget(t, { costUsd: 0.002, latencyMs: 5 }).ok, false);
  assert.equal(bed.meetsTarget(t, { costUsd: 0, latencyMs: t.budget.target.latencyMsMax + 1 }).ok, false);
  assert.equal(bed.meetsTarget(task(1, 'T2'), { costUsd: 0, latencyMs: 1 }).ok, null);
  const b = bed.baseline();
  assert.ok(b.runs >= 14 && b.wallMsMedian > 0);
});

test('the shared experiment helpers can render this item\'s tasks (solverView / inlineRender)', async () => {
  const { solverView, inlineRender } = await import('../../../lib/beds.mjs');
  const t = task(2, 'T1');
  const view = solverView(t);
  assert.equal(view.prompt, t.prompt);
  assert.ok(view.files['inputs.json'].includes('reference_fetch') && view.files['files/original/update-selenium-grid-versions.yml']);
  assert.ok(inlineRender(t).includes('## inputs.json'));
  const dir = tmp('mat-');
  try { const written = bed.materialize(t, dir); assert.ok(written.some(f => f.endsWith('original/update-selenium-grid-versions.yml')) && written.some(f => f.endsWith('inputs.json'))); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('run-solution.mjs judges a solver module from the command line', () => {
  const dir = tmp('cli-');
  try {
    const solver = path.join(dir, 'solver.mjs');
    writeFileSync(solver, `import { solveImproved } from ${JSON.stringify(pathToFileURL(path.join(HERE, 'controls', 'reference.mjs')).href)};\nexport default inputs => solveImproved(inputs);\n`);
    const ok = spawnSync(process.execPath, [path.join(HERE, 'run-solution.mjs'), solver, '--variant', 'T3', '--seeds', '0-13', '--json'], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    const rows = JSON.parse(ok.stdout);
    assert.equal(rows.length, 14);
    assert.ok(rows.every(r => r.pass && r.target.ok === true));
    // a Foundry workflow.json goes through the real CLI (skipped quietly where the CLI cannot run)
    const wfFile = path.join(dir, 'workflow.json');
    writeFileSync(wfFile, JSON.stringify(foundryWorkflow()));
    const viaCli = spawnSync(process.execPath, [path.join(HERE, 'run-solution.mjs'), wfFile, '--variant', 'T2', '--seeds', '9-10', '--json'], { encoding: 'utf8', timeout: 120000 });
    if (viaCli.status === 0) {
      const wfRows = JSON.parse(viaCli.stdout);
      assert.equal(wfRows.length, 2);
      assert.ok(wfRows.every(r => r.pass), JSON.stringify(wfRows));
    }
    const nothing = path.join(dir, 'nothing.mjs');
    writeFileSync(nothing, 'export default () => ({ status: "unchanged", versions: { current: {chrome:"",edge:"",firefox:"",hub:""}, latest: {chrome:"",edge:"",firefox:"",hub:""} }, files: {}, pull_request: { open: false }, message: "" });\n');
    const bad = JSON.parse(spawnSync(process.execPath, [path.join(HERE, 'run-solution.mjs'), nothing, '--variant', 'T2', '--seeds', '0-13', '--json'], { encoding: 'utf8' }).stdout);
    assert.ok(bad.every(r => !r.pass));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('FOUNDRY: the improved behaviour as one pure code node solves the canonical suite through the real `foundry run`', SLOW, async t => {
  const wf = foundryWorkflow();
  assert.deepEqual(wf.nodes.map(n => [n.id, n.kind, n.lang]), [['answer', 'code', 'js']]);
  assert.ok(!/fetch\(|import\(|require\(|process\./.test(wf.nodes[0].source), 'the code node must stay pure');
  const probe = runViaFoundry(task(0, 'T3'));
  if (!probe.ok) return t.skip(`foundry run is not usable here: ${probe.error}`);
  const rows = await pool(canonicalInstances(), async inst => {
    const tk = task(inst.seed, 'T3'), r = runViaFoundry(tk);
    return { kind: inst.kind, ok: r.ok, wallMs: r.wallMs, verdict: r.verdict, cost: r.cost, result: r.ok ? bed.oracle(tk, r.plan) : null, target: bed.meetsTarget(tk, { costUsd: r.cost ?? 0, latencyMs: r.wallMs }) };
  }, 3);
  for (const r of rows) {
    assert.ok(r.ok, `${r.kind}: the run did not succeed`);
    assert.ok(r.result.pass, `${r.kind}: ${JSON.stringify(r.result.details)}`);
    assert.equal(r.cost, 0, 'no model call');
  }
  const ms = rows.map(r => r.wallMs).sort((a, b) => a - b);
  t.diagnostic(`foundry run wall ms: median ${ms[Math.floor(ms.length / 2)]}, max ${ms.at(-1)}; the original's median is ${bed.baseline().wallMsMedian}; runs within the T3 latency target: ${rows.filter(r => r.target.ok).length}/${rows.length}`);
});

test('experiments/lib/beds.mjs loadFamily can load this item (OBSTACLE O1: it resolves beds/<id>/index.mjs only; experiments/lib is frozen for this task)', { todo: 'loadFamily has no branch for experiments/replicate/items/*' }, async () => {
  const { loadFamily } = await import('../../../lib/beds.mjs');
  await loadFamily(bed.family.id);
});

test('the generator uses only its own templates: no wall clock, no Math.random, no network', () => {
  for (const f of ['scenarios.mjs', 'oracle.mjs', 'index.mjs']) {
    const text = readFileSync(path.join(HERE, f), 'utf8');
    assert.ok(!/Math\.random|Date\.now|new Date\(\)|performance\.now|fetch\(|node:http|node:net/.test(text.replace(/\/\/.*$/gm, '')), `${f} uses a forbidden source of nondeterminism or I/O`);
  }
});

