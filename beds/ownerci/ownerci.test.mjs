// ownerci bed: metadata, determinism, task shape, truth isolation, difficulty sanity, schema and
// static-guard checks. Oracle health (reference and bad controls) is in ownerci.controls.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bed from './index.mjs';
import { MODULES, MODULE_IDS } from './modules.mjs';
import { fixtureFiles } from './runner.mjs';
import { applyEdits, enumerateMutations, tokenize } from './mutate.mjs';
import { canonical, estimateTokens, sha256 } from '../lib/canonical.mjs';

const DIFFS = [1, 2, 3, 4, 5];
const publicText = task => [task.prompt, canonical(task.inputs), ...Object.values(task.files ?? {})].join('\n\u0000\n');
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test('family metadata and output schema use the portable subset', () => {
  assert.equal(bed.family.id, 'ownerci');
  assert.equal(bed.family.kind, 'oneshot');
  assert.ok(bed.family.version && bed.family.domain && bed.family.description);
  const banned = ['pattern', 'oneOf', 'uniqueItems', '$ref', 'format'];
  const walk = s => { for (const [k, v] of Object.entries(s)) { assert.ok(!banned.includes(k), `schema uses ${k}`); if (v && typeof v === 'object') walk(v); } };
  walk(bed.outputSchema);
  assert.deepEqual(bed.outputSchema.required, ['patched_source']);
  assert.equal(typeof bed.generate, 'function'); assert.equal(typeof bed.oracle, 'function'); assert.equal(typeof bed.referenceSolve, 'function');
  for (const name of ['empty', 'shuffled-or-corrupted', 'near-miss-fix-one']) assert.ok(bed.badControls.some(c => c.name === name), name);
});

test('fixtures match MANIFEST.json (frozen commit, sha256 of every frozen and hidden file)', () => {
  assert.match(bed.MANIFEST.commit, /^[0-9a-f]{40}$/);
  for (const id of MODULE_IDS) {
    const files = fixtureFiles(id);
    const entry = bed.MANIFEST.modules[id];
    assert.ok(entry, id);
    for (const [rel, meta] of Object.entries(entry.files)) assert.equal(sha256(files[rel]), meta.sha256, `${id}/${rel}`);
    assert.equal(sha256(files['hidden.test.mjs']), entry.hidden.sha256, `${id}/hidden.test.mjs`);
    assert.equal(bed.CATALOG.modules[id].originalSha256, sha256(files[MODULES[id].modulePath]), `${id}: catalog built from this module`);
    assert.ok(bed.CATALOG.modules[id].hiddenTests.length >= 8, `${id}: at least 8 hidden tests`);
  }
});

test('catalog: every mutant applies, re-enumerates from the frozen module and has a recorded failing test', () => {
  assert.ok(bed.CATALOG.mutants.length >= 150, `catalog has ${bed.CATALOG.mutants.length} mutants`);
  const enumerated = Object.fromEntries(MODULE_IDS.map(id => [id, new Set(enumerateMutations(fixtureFiles(id)[MODULES[id].modulePath])
    .map(c => `${c.start}:${c.end}:${c.replacement}`))]));
  for (const m of bed.CATALOG.mutants) {
    const original = fixtureFiles(m.module)[MODULES[m.module].modulePath];
    assert.ok(enumerated[m.module].has(`${m.edit.start}:${m.edit.end}:${m.edit.replacement}`), `${m.id} is not an operator output`);
    assert.equal(original.slice(m.edit.start, m.edit.end), m.from, m.id);
    assert.notEqual(applyEdits(original, [m.edit]), original, m.id);
    assert.ok(m.visibleFailing.length + m.hiddenFailing.length > 0, m.id);
    assert.ok(m.visibleFailing.length < bed.CATALOG.modules[m.module].visibleTests.length, `${m.id}: every visible test fails`);
    assert.ok(m.hiddenFailing.length < bed.CATALOG.modules[m.module].hiddenTests.length, `${m.id}: every hidden test fails`);
    assert.equal(m.failures.length, m.visibleFailing.length, m.id);
  }
  for (const d of [3, 4, 5]) for (const c of bed.CATALOG.combos[d]) {
    const ms = c.mutants.map(id => bed.CATALOG.mutants.find(m => m.id === id));
    assert.equal(ms.length, d === 3 ? 2 : 3, c.id);
    assert.equal(new Set(ms.map(m => `${m.visibleFailing}|${m.hiddenFailing}`)).size, ms.length, `${c.id}: failing-test sets must differ`);
    assert.ok(c.visibleFailing.length > 0, c.id);
    assert.ok(c.nearMiss.visibleFailing.length + c.nearMiss.hiddenFailing.length > 0, `${c.id}: near miss would pass`);
  }
});

test('generate is deterministic and the split salts the instance', () => {
  for (const difficulty of DIFFS) for (const seed of [1, 2, 3]) {
    const a = bed.generate({ seed, split: 'dev', difficulty });
    const b = bed.generate({ seed, split: 'dev', difficulty });
    assert.equal(canonical(a), canonical(b), `nondeterministic d${difficulty} s${seed}`);
    const t = bed.generate({ seed, split: 'test', difficulty });
    assert.notEqual(t.prompt, a.prompt);
  }
});

test('generate validates its arguments', () => {
  assert.throws(() => bed.generate({ seed: 1, split: 'train', difficulty: 1 }));
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 6 }));
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 0 }));
  assert.throws(() => bed.generate({ seed: 1.5, split: 'dev', difficulty: 1 }));
});

test('task shape: prompt, inputs and files are consistent and carry no truth fields', () => {
  for (const difficulty of DIFFS) {
    const task = bed.generate({ seed: 7, split: 'dev', difficulty });
    const m = MODULES[bed.instance(task).module];
    assert.equal(task.family, 'ownerci');
    assert.deepEqual([task.seed, task.split, task.difficulty], [7, 'dev', difficulty]);
    assert.match(task.prompt, /patched_source/);
    assert.deepEqual(Object.keys(task.inputs).sort(), ['module_path', 'module_source', 'related_sources', 'test_path', 'test_source']);
    assert.equal(task.inputs.module_path, m.modulePath);
    assert.equal(task.inputs.test_path, m.testPath);
    assert.deepEqual(Object.keys(task.inputs.related_sources), [...m.related]);
    assert.equal(task.files[m.modulePath], task.inputs.module_source);
    assert.equal(task.files[m.testPath], task.inputs.test_source);
    assert.ok(task.files['ci/job-summary.txt'] && task.prompt.includes(task.files['ci/job-summary.txt']));
    assert.doesNotMatch(JSON.stringify(Object.keys(task.inputs)) + JSON.stringify(Object.keys(task.files)), /reference|hidden|truth|answer|solution|original/i);
    assert.ok(task.budget.suggestedOutputTokens > 0);
  }
});

test('truth never leaks: original source, replaced lines and hidden tests are absent from the task', () => {
  for (const difficulty of DIFFS) for (let seed = 1; seed <= 15; seed++) {
    const split = seed % 2 ? 'dev' : 'test';
    const task = bed.generate({ seed, split, difficulty });
    const inst = bed.instance(task);
    const files = fixtureFiles(inst.module);
    const text = publicText(task);
    assert.ok(!text.includes(inst.original), `original module leaked in ${task.id}`);
    assert.ok(!text.includes(files['hidden.test.mjs'].slice(200, 600)), `hidden tests leaked in ${task.id}`);
    for (const name of bed.CATALOG.modules[inst.module].hiddenTests) assert.ok(!text.includes(name), `hidden test name leaked: ${name}`);
    const visibleMaterial = [task.inputs.test_source, ...Object.values(task.inputs.related_sources)].join('\n');
    const origLines = inst.original.split('\n');
    for (const m of inst.mutants) {
      const lines = origLines.slice(m.lineStart - 1, m.lineEnd).join('\n');
      // only lines unique to the answer: once in the original module and nowhere in the visible material
      if (lines.trim().length < 12 || inst.original.split(lines).length !== 2 || visibleMaterial.includes(lines)) continue;
      assert.ok(!text.includes(lines), `replaced line leaked in ${task.id}: ${lines.slice(0, 80)}`);
    }
  }
});

test('difficulty sanity: mutant counts, hidden-only mutants, report content and input sizes', () => {
  const sizes = {};
  for (const difficulty of DIFFS) {
    sizes[difficulty] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const task = bed.generate({ seed, split: 'dev', difficulty });
      const inst = bed.instance(task);
      const report = task.files['ci/job-summary.txt'];
      sizes[difficulty].push(estimateTokens(task.prompt) + estimateTokens(task.inputs));
      assert.equal(inst.mutants.length, bed.KNOBS[difficulty].mutants, task.id);
      const silent = inst.mutants.filter(m => !m.visibleFailing.length).length;
      assert.equal(silent, bed.KNOBS[difficulty].hiddenOnly, `${task.id}: hidden-only mutants`);
      assert.ok(inst.visibleFailing.length > 0, `${task.id}: CI must show at least one visible failure`);
      for (const name of inst.visibleFailing) assert.ok(report.includes(`✖ ${name} (`), `${task.id}: failing test ${name} missing from report`);
      assert.match(report, new RegExp(`ℹ fail ${inst.visibleFailing.length}\\n`));
      if (difficulty === 3) assert.notDeepEqual(inst.mutants[0].visibleFailing, inst.mutants[1].visibleFailing);
      const noisy = /Restored dependency cache/.test(report) && /npm warn deprecated/.test(report);
      assert.equal(noisy, difficulty >= 3, `${task.id}: noise lines only from d3`);
      assert.equal(/some failures may not be visible/.test(report), difficulty >= 4, task.id);
      assert.equal(/passed on retry/.test(report), difficulty >= 5, task.id);
      if (difficulty >= 3) assert.ok((report.match(/^▶ /gm) ?? []).length >= 3, `${task.id}: unrelated suites present`);
    }
  }
  const med = Object.fromEntries(DIFFS.map(d => [d, median(sizes[d])]));
  for (const d of DIFFS) assert.ok(med[d] > 2000 && med[d] < 20000, `d${d} median tokens ${med[d]}`);
  assert.ok(median(sizes[5]) >= median(sizes[1]), `d5 ${med[5]} smaller than d1 ${med[1]}`);
});

test('generate is fast (< 2 s at difficulty 5)', () => {
  const t0 = performance.now();
  for (let seed = 1; seed <= 20; seed++) bed.generate({ seed, split: 'test', difficulty: 5 });
  assert.ok((performance.now() - t0) / 20 < 2000);
});

test('oracle rejects schema-invalid output without running anything', () => {
  const task = bed.generate({ seed: 3, split: 'dev', difficulty: 2 });
  const proto = Object.create({ patched_source: task.inputs.module_source });
  const getter = { get patched_source() { return 'x'; } };
  for (const bad of [null, undefined, 'source', [], {}, { patched_source: 5 }, { patched_source: 'x', extra: 1 }, { source: 'x' }, proto, getter]) {
    const out = bed.oracle(task, bad);
    assert.equal(out.pass, false); assert.equal(out.score, 0);
    assert.match(out.details.reason, /schema-invalid/);
  }
  assert.match(bed.oracle(task, { patched_source: '   ' }).details.reason, /empty/);
});

test('static diff guard: size bounds, banned capabilities, exports; comments are not code', () => {
  for (const id of MODULE_IDS) {
    const src = fixtureFiles(id)[MODULES[id].modulePath];
    assert.deepEqual(bed.staticGuard(id, src), [], id);
    assert.deepEqual(bed.staticGuard(id, `// process the rows; never touch globalThis here\n${src}`), [], `${id}: comment`);
    assert.match(bed.staticGuard(id, src + src + src).join(';'), /size/);
    assert.match(bed.staticGuard(id, src.slice(0, Math.floor(src.length * 0.4))).join(';'), /size/);
    for (const [label, snippet] of [['process.env', 'const e = process.env.X;'], ['globalThis', 'const g = globalThis;'], ['node:test', "import t from 'node:test';"],
      ['process.exit', 'if (0) process.exit(0);'], ['node:fs', "import fs from 'node:fs';"], ['dynamic import()', "const m = import('x');"], ['eval', 'eval("1");'],
      ['Function constructor', 'const f = Function("return 1");'], ['process (any use)', 'const p = process;']]) {
      assert.ok(bed.staticGuard(id, `${snippet}\n${src}`).some(v => v.includes(label)), `${id}: ${label}`);
    }
    const first = bed.CATALOG.modules[id].exports[0].name;
    assert.ok(bed.staticGuard(id, src.replace(new RegExp(`export (async )?(function|const|class) ${first}\\b`), (m, a, k) => `${a ?? ''}${k} ${first}`))
      .includes(`missing export ${first}`), `${id}: missing export`);
  }
});

test('tokenizer covers every module without losing code tokens', () => {
  for (const id of MODULE_IDS) {
    const src = fixtureFiles(id)[MODULES[id].modulePath];
    const toks = tokenize(src);
    let at = 0;
    for (const t of toks) {
      assert.ok(t.start >= at, `${id}: overlapping tokens`);
      assert.match(src.slice(at, t.start), /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*$/, `${id}: code skipped before line ${t.line}`);
      at = t.end;
    }
    assert.match(src.slice(at), /^\s*$/);
    assert.ok(toks.some(t => t.type === 'regex') || id !== 'context', 'context.mjs has regex literals');
  }
});
