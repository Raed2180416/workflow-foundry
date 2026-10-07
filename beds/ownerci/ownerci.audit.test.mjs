// Regression tests for the 2026-10-07 adversarial audit of the ownerci bed (see AUDIT.md). Each
// test names the finding it pins. Candidate code only ever runs through the bed's own runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as bed from './index.mjs';
import { MODULES, MODULE_IDS } from './modules.mjs';
import { classify, fixtureFiles, runAsync, runSync, sandboxAvailable } from './runner.mjs';
import { applyEdits } from './mutate.mjs';
import { BYPASS_PROBES } from './attacks/bypass.mjs';
import { EQUIVALENTS } from './attacks/equivalents.mjs';
import { heuristicRepair } from './attacks/heuristic.mjs';
import { canonical, sha256 } from '../lib/canonical.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const originalOf = id => fixtureFiles(id)[MODULES[id].modulePath];
async function pool(jobs, worker, n = 4) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await worker(jobs[i], i); }
  }));
  return out;
}

test('F1 assert monkeypatch: rejected by the import allowlist, and the runtime freeze stops it behind the guard', () => {
  const task = bed.generate({ seed: 4, split: 'test', difficulty: 3 });
  const inst = bed.instance(task);
  const control = bed.badControls.find(c => c.name === 'assert-monkeypatch');
  const out = bed.oracle(task, control.make(task));
  assert.equal(out.pass, false);
  assert.equal(out.details.reason, 'diff guard violated');
  assert.ok(out.details.guard.violations.some(v => /does not import/.test(v)), JSON.stringify(out.details.guard));
  // Defence in depth: run the same source with the static guard skipped. harden.mjs has frozen
  // the assert objects, so the module throws while loading and nothing passes.
  const run = runSync(inst.module, control.make(task).patched_source, { exportsSpec: bed.CATALOG.modules[inst.module].exports });
  const verdict = bed.scoreRun(inst.module, run);
  assert.equal(verdict.pass, false);
  assert.equal(verdict.score, 0, JSON.stringify(verdict.details));
});

test('F2 guard escapes and runtime tricks: every bypass probe fails at its stage, the oracle never throws', async () => {
  const tasks = [[4, 3], [9, 1], [12, 5]].map(([seed, difficulty]) => bed.generate({ seed, split: 'test', difficulty }));
  const jobs = tasks.flatMap(task => BYPASS_PROBES.map(probe => ({ task, probe })));
  const results = await pool(jobs, async ({ task, probe }) => ({ task, probe, out: await bed.oracleAsync(task, { patched_source: probe.make(task) }) }));
  for (const { task, probe, out } of results) {
    assert.equal(out.pass, false, `${probe.name} passed ${task.id}`);
    assert.ok(out.score < 1, `${probe.name} ${task.id}`);
    if (probe.stage === 'guard') {
      assert.equal(out.details.reason, 'diff guard violated', `${probe.name} ${task.id}`);
      assert.equal(out.details.sandbox, undefined, `${probe.name} reached the runner`);
    } else assert.notEqual(out.details.reason, 'diff guard violated', `${probe.name} should be stopped at run time, not by the guard`);
  }
  const codeGen = results.find(r => r.probe.name === 'code-generation');
  assert.equal(codeGen.out.details.reason, 'module failed to load (no test could run)', 'code generation from strings must be disabled');
});

test('F2 sandbox: inside the run the repository and the bed directory are not visible (trusted probe)', { skip: !sandboxAvailable() && 'no user namespaces here' }, () => {
  // Trusted host code, run through runSync directly (the guard would reject the fs import).
  const id = 'verdict';
  const probe = `import { existsSync } from 'node:fs';\nif (existsSync(${JSON.stringify(HERE)}) || existsSync(${JSON.stringify(path.join(REPO, 'src'))})) throw new Error('host repository visible');\n${originalOf(id)}`;
  const run = runSync(id, probe, { exportsSpec: bed.CATALOG.modules[id].exports });
  const verdict = bed.scoreRun(id, run);
  assert.equal(verdict.pass, true, JSON.stringify(verdict.details));
});

test('F3 run integrity: duplicate, unexpected or crashed reports and a non-zero exit never pass', () => {
  const id = 'verdict';
  const info = bed.CATALOG.modules[id];
  const pass = (file, name) => ({ name, file, nesting: 0, status: 'pass', error: null });
  const clean = [...info.visibleTests.map(n => pass(MODULES[id].testPath, n)), ...info.hiddenTests.map(n => pass('hidden.test.mjs', n)),
    pass('__ownerci_exports__.test.mjs', bed.GUARD_TEST)];
  const result = (tests, exitStatus = 0) => ({ ok: true, sandbox: 'test', exitStatus, tests, wallMs: 1 });
  assert.equal(bed.scoreRun(id, result(clean)).pass, true, 'a clean all-pass run passes (the rule is not vacuous)');
  const failed = { ...clean[0], status: 'fail', error: { message: 'x' } };
  const cases = {
    duplicateAfterFailure: [failed, ...clean],
    duplicatePass: [...clean, clean[0]],
    crashedFile: [...clean, { name: 'hidden.test.mjs', file: 'hidden.test.mjs', nesting: 0, status: 'fail', error: { message: 'test failed' } }],
    unexpectedName: [...clean, pass(MODULES[id].testPath, 'a test that does not exist')],
  };
  for (const [name, tests] of Object.entries(cases)) {
    const v = bed.scoreRun(id, result(tests));
    assert.equal(v.pass, false, name);
    assert.ok(v.score < 1, name);
  }
  assert.equal(classify(id, result(cases.duplicateAfterFailure)).visible.get(failed.name).status, 'fail', 'a failing report is never overwritten by a later pass');
  const nonZero = bed.scoreRun(id, result(clean, 1));
  assert.equal(nonZero.pass, false);
  assert.match(nonZero.details.reason, /integrity/);
  assert.equal(bed.scoreRun(id, { ok: false, error: 'no reporter output', sandbox: 'test' }).pass, false);
});

test('F3 the oracle never throws on degenerate sources', async () => {
  const task = bed.generate({ seed: 6, split: 'test', difficulty: 2 });
  const src = task.inputs.module_source;
  const weird = ['\u0000'.repeat(src.length), `${src}\n}}}}`, `${src}\n/*`, `${src}\n\`unterminated`, `${src}\nconst s = '\ud800';`, src.replace(/\n/g, ' '),
    `${src}\nwhile (false) {}`, 'x'.repeat(src.length), `${src}\nexport default 1;`, `${src}\nthrow new Error('boom');`];
  const results = await pool(weird, s => bed.oracleAsync(task, { patched_source: s }));
  for (const [i, out] of results.entries()) {
    assert.equal(out.pass, false, `case ${i}`);
    assert.ok(typeof out.details.reason === 'string', `case ${i}`);
  }
});

test('F4 truth leakage: no original module, original mutated line, hidden test or runner artifact in 1000 tasks', () => {
  for (const difficulty of [1, 2, 3, 4, 5]) for (let seed = 1; seed <= 100; seed++) for (const split of ['dev', 'test']) {
    const task = bed.generate({ seed, split, difficulty });
    const inst = bed.instance(task);
    const text = [task.prompt, canonical(task.inputs), ...Object.values(task.files)].join('\n');
    const report = task.files['ci/job-summary.txt'];
    assert.ok(!text.includes(inst.original), `${task.id}: original module`);
    assert.ok(!Object.hasOwn(task.inputs.related_sources, MODULES[inst.module].modulePath), `${task.id}: module among related sources`);
    assert.doesNotMatch(text, /\/tmp\/|ownerci-[a-z]|\{ROOT\}|hidden\.test|__ownerci/, `${task.id}: runner artifact`);
    for (const name of bed.CATALOG.modules[inst.module].hiddenTests) assert.ok(!text.includes(name), `${task.id}: hidden test name`);
    const lines = inst.original.split('\n');
    for (const m of inst.mutants) {
      const orig = lines.slice(m.lineStart - 1, m.lineEnd).join('\n').trim();
      if (orig.length >= 8) assert.ok(!report.includes(orig), `${task.id}: CI report quotes the original line of ${m.id}`);
    }
  }
});

test('F5 triviality: d3 pairs are masked, and the static heuristic stays under 20% on 30 d3 test seeds', async () => {
  for (const c of bed.CATALOG.combos[3]) {
    const ms = c.mutants.map(id => bed.CATALOG.mutants.find(m => m.id === id));
    assert.equal(c.masked, true, c.id);
    for (const m of ms) assert.deepEqual(m.visibleFailing, c.visibleFailing, `${c.id}: fixing the other member alone would change the visible failures`);
    assert.deepEqual(c.nearMiss.visibleFailing, c.visibleFailing, c.id);
    assert.notDeepEqual(ms[0].hiddenFailing, ms[1].hiddenFailing, c.id);
    assert.ok(ms.every(m => m.silentEligible), `${c.id}: masked members must look locally wrong`);
  }
  const tasks = Array.from({ length: 30 }, (_, i) => bed.generate({ seed: i + 1, split: 'test', difficulty: 3 }));
  const verdicts = await pool(tasks, task => bed.oracleAsync(task, heuristicRepair(task)));
  const passes = verdicts.filter(v => v.pass).length;
  assert.ok(passes / tasks.length < 0.2, `static heuristic passes ${passes}/30 at d3`);
  // the reference still passes every one of these tasks
  const refs = await pool(tasks, task => bed.oracleAsync(task, bed.referenceSolve(task)));
  assert.equal(refs.filter(v => v.pass).length, 30);
});

test('F6 no false negatives: reformatted, renamed and alternative-fix sources pass', async () => {
  const jobs = MODULE_IDS.flatMap(id => EQUIVALENTS.map(([name, f]) => ({ id, name, src: f(originalOf(id)) })));
  // Alternative correct fixes at mutated sites, written differently from the original token.
  const alt = (id, pairs) => pairs.reduce((s, [from, to]) => { assert.equal(s.split(from).length, 2, `${id}: ${from}`); return s.replace(from, to); }, originalOf(id));
  jobs.push(
    { id: 'context', name: 'alt-fix typeof', src: alt('context', [['input.priority !== undefined', "typeof input.priority !== 'undefined'"], ['context.persona !== undefined', "typeof context.persona !== 'undefined'"]]) },
    { id: 'stats', name: 'alt-fix commuted comparisons', src: alt('stats', [['k < 0 || k > n', 'k < 0 || n < k'], ['for (let i = 1; i <= k; i++)', 'for (let i = 1; i < k + 1; i++)'], ['n - c < k ?', 'k > n - c ?']]) },
    { id: 'verdict', name: 'alt-fix guard form', src: alt('verdict', [['f?.confirmed === true', 'Boolean(f) && f.confirmed === true']]) },
  );
  const results = await pool(jobs, async j => ({ ...j, out: await bed.evaluateSourceAsync(j.id, j.src) }));
  const failures = results.filter(r => !r.out.pass).map(r => `${r.id}/${r.name}: ${r.out.details.reason} ${JSON.stringify(r.out.details.guard?.violations ?? r.out.details.tests?.visibleFailed ?? '')}`);
  assert.deepEqual(failures, []);
});

test('F7 hidden suites: previously surviving, non-equivalent mutants are now killed by hidden tests', () => {
  const pins = [
    ['context', 'logic-swap', /if \(!node \|\| typeof node !== 'object'\)/, /\|\| -> &&/],
    ['context', 'off-by-one', /if \(over\(\) > 0\) throw new FoundryError\('CONTEXT_OVERFLOW'/, /^0 -> 1$/],
    ['schema-subset', 'off-by-one', /add = \(path, problem\)/, /^0 -> 1$/],
    ['journal', 'bool-swap', /str\(entry\.modelId, 'modelId', true\)/, /true -> false/],
    ['stats', 'default-arg', /seed = 'bootstrap'/, /seed = 'bootstrap'/],
    ['stats', 'arg-swap', /hat\.push\(passHatK\(tn, tc, k\)\)/, /swap tn <-> tc/],
    ['distill', 'default-arg', /maxErrorRate = 0\.1/, /maxErrorRate = 0\.1/],
    ['distill', 'cmp-flip', /relTol \* Math\.max\(1, Math\.abs\(v\)\)/, /<= -> </],
  ];
  for (const [id, operator, line, note] of pins) {
    const lines = originalOf(id).split('\n');
    const kept = bed.CATALOG.mutants.filter(m => m.module === id && m.operator === operator && line.test(lines[m.line - 1]) && note.test(m.note));
    assert.ok(kept.length > 0, `${id} ${operator} ${note}: not in the catalog (no test kills it)`);
    assert.ok(kept.every(m => m.hiddenFailing.length > 0), `${id} ${operator} ${note}: hidden suite does not kill it`);
  }
  const counts = Object.fromEntries(MODULE_IDS.map(id => [id, bed.CATALOG.modules[id].hiddenTests.length]));
  assert.deepEqual(counts, { verdict: 10, context: 18, 'schema-subset': 12, journal: 11, stats: 10, distill: 10 });
});

test('F9 freezing: generate reads nothing outside beds/ownerci and beds/lib (Node permission model)', () => {
  const script = `const bed = await import(${JSON.stringify(path.join(HERE, 'index.mjs'))});
    const ids = []; for (const d of [1, 2, 3, 4, 5]) for (const seed of [1, 2]) ids.push(bed.generate({ seed, split: 'test', difficulty: d }).id);
    console.log(JSON.stringify(ids));`;
  const r = spawnSync(process.execPath, ['--permission', `--allow-fs-read=${HERE}/*`, `--allow-fs-read=${path.join(REPO, 'beds', 'lib')}/*`,
    '--allow-fs-read=/usr/bin/timeout', '--allow-fs-read=/bin/timeout', '--allow-fs-read=/usr/bin/unshare', '--allow-fs-read=/bin/unshare',
    '--input-type=module', '-e', script], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).length, 10);
});

test('F9 freezing: MANIFEST hashes match the fixtures and, when git is available, the frozen commit', () => {
  const git = spawnSync('git', ['-C', REPO, 'cat-file', '-e', `${bed.MANIFEST.commit}^{commit}`], { encoding: 'utf8' });
  for (const id of MODULE_IDS) {
    const files = fixtureFiles(id);
    for (const [rel, meta] of Object.entries(bed.MANIFEST.modules[id].files)) {
      assert.equal(sha256(files[rel]), meta.sha256, `${id}/${rel}`);
      if (!meta.transforms.length) assert.equal(meta.sha256, meta.sourceSha256, `${id}/${rel}: untransformed copy differs from source`);
      if (git.status === 0) {
        const blob = spawnSync('git', ['-C', REPO, 'show', `${bed.MANIFEST.commit}:${meta.source}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        assert.equal(sha256(blob.stdout), meta.sourceSha256, `${id}/${rel} differs from ${bed.MANIFEST.commit.slice(0, 7)}:${meta.source}`);
      }
    }
    assert.equal(sha256(files['hidden.test.mjs']), bed.MANIFEST.modules[id].hidden.sha256, `${id}/hidden.test.mjs`);
  }
});

test('F8 determinism: a fresh process generates byte-identical tasks', () => {
  const keys = [[1, 'dev', 1], [2, 'test', 3], [3, 'test', 5], [4, 'dev', 4]];
  const script = `const bed = await import(${JSON.stringify(path.join(HERE, 'index.mjs'))});
    const { canonical, sha256 } = await import(${JSON.stringify(path.join(REPO, 'beds', 'lib', 'canonical.mjs'))});
    console.log(JSON.stringify(${JSON.stringify(keys)}.map(([seed, split, difficulty]) => sha256(canonical(bed.generate({ seed, split, difficulty }))))));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', TZ: 'Pacific/Kiritimati', LANG: 'tr_TR.UTF-8' }, cwd: tmpdir(), timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), keys.map(([seed, split, difficulty]) => sha256(canonical(bed.generate({ seed, split, difficulty })))));
});

test('controls: the near-miss control is the documented one for multi-mutant tasks (fix only the first mutant)', () => {
  const task = bed.generate({ seed: 8, split: 'test', difficulty: 3 });
  const inst = bed.instance(task);
  const near = bed.badControls.find(c => c.name === 'near-miss-fix-one').make(task).patched_source;
  assert.equal(near, applyEdits(inst.original, [inst.mutants[1].edit]));
});

test('runAsync and runSync agree on a reference run', async () => {
  const id = 'stats';
  const a = runSync(id, originalOf(id), { exportsSpec: bed.CATALOG.modules[id].exports });
  const b = await runAsync(id, originalOf(id), { exportsSpec: bed.CATALOG.modules[id].exports });
  const key = r => r.tests.filter(t => t.nesting === 0).map(t => `${t.file}::${t.name}::${t.status}`).sort();
  assert.deepEqual(key(a), key(b));
  assert.equal(a.exitStatus, 0);
  assert.equal(b.exitStatus, 0);
});
