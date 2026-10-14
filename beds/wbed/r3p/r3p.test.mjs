// Oracle health for W-bed R3' "planted-defect sweep" (beds/CONTRACT.md rules; W-BED §2.2, §2.4; PROOF-LEDGER J5). Loaded by
// path; the registration shim beds/wbed-r3p/index.mjs makes it loadable as family 'wbed-r3p'. $0: no model calls.
// Seeds: the tuning block dev 449-472 of SEED-LEDGER wbed-r3p-dev only (review 2026-10-14, finding 8: the rehearsal
// streams 401-448 stay untouched by tuning; no held-out seed is generated here).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as bed from './index.mjs';
import { buildSweep, redrawStats, obsGen, LOUD_SHARE } from './world.mjs';
import { FAMILIES, words as wordsOf } from './families.mjs';
import { observe, argsOk, makeContext, canonValue } from './exec.mjs';
import { witnessHolds, passes } from './score.mjs';
import { SPEC, randomValue, roundRational } from './spec.mjs';
import { AREAS, LIB } from './vocab.mjs';
import { parseFunctions, linterFindings } from './lint.mjs';
import { CLASSES, TODOS, NOTES } from './vocab.mjs';
import { canonical, sha256, estimateTokens, rng } from '../lib/prng.mjs';
import { inlineRender, loadFamily } from '../../../experiments/lib/beds.mjs';
import { portableSchemaViolations } from '../../../src/schema-subset.mjs';
import { plan, runStub, RUNGS } from '../attacks/triviality.mjs';

const SEEDS = Array.from({ length: 20 }, (_, i) => 449 + i); // dev 449-468 (SEED-LEDGER wbed-r3p-dev, tuning block 449-472)
const DS = [2, 3, 4, 5];
const applies = (c, d) => d >= (c.minDifficulty ?? 0);
const hashOf = t => sha256(canonical(t));
const task = (seed, d, split = 'dev') => bed.generate({ seed, split, difficulty: d });
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

test('exports the bed interface plus the W-specific and sweep-specific exports; loadFamily works', async () => {
  for (const k of ['family', 'outputSchema', 'generate', 'oracle', 'referenceSolve', 'badControls', 'necessityControls', 'version', 'difficulty', 'stages',
    'structure', 'relations', 'composedOracle', 'referenceTrace', 'manifestOf', 'trapsOf', 'checkWitness', 'costPerVerifiedFinding', 'aggregateSweeps',
    'impactManifestOf', 'callLogFor', 'scoreImpact', 'scoreReplay', 'invariants', 'sizeOf', 'taskTokens', 'contractFuzz', 'STREAM_CORPUS']) assert.ok(k in bed, k);
  assert.equal(bed.family.id, 'wbed-r3p');
  assert.equal(bed.version, '1.1.0');
  assert.deepEqual(bed.stages.map(s => s.id), ['inventory', 'candidates', 'verify', 'reduce']);
  assert.equal(bed.structure.shape, 'fan-out-verify-fan-in');
  assert.ok(bed.structure.outline.some(l => /map\(files/.test(l)) && bed.structure.outline.some(l => /root cause \(code\)/.test(l)));
  assert.equal((await loadFamily('wbed-r3p')).family.id, 'wbed-r3p');
});

test('output schema and stage contracts are in the portable subset', () => {
  assert.deepEqual(portableSchemaViolations(bed.outputSchema), []);
  for (const s of bed.stages) assert.deepEqual(portableSchemaViolations(s.outputSchema), [], s.id);
});

test('generator is deterministic: same seed -> same task hash, also in a fresh process; split and seed change the task', () => {
  for (const d of DS) for (const seed of [449, 470]) assert.equal(hashOf(task(seed, d)), hashOf(task(seed, d)));
  const here = fileURLToPath(new URL('./index.mjs', import.meta.url));
  const code = `const m = await import(${JSON.stringify(here)}); const { canonical, sha256 } = await import(${JSON.stringify(fileURLToPath(new URL('../lib/prng.mjs', import.meta.url)))});`
    + `console.log(JSON.stringify([[449,3],[450,5],[451,2]].map(([s,d]) => sha256(canonical(m.generate({ seed: s, split: 'dev', difficulty: d }))))));`;
  const fresh = JSON.parse(execFileSync(process.execPath, ['--max-old-space-size=1024', '--input-type=module', '-e', code], { encoding: 'utf8' }));
  assert.deepEqual(fresh, [[449, 3], [450, 5], [451, 2]].map(([s, d]) => hashOf(task(s, d))));
  assert.notEqual(hashOf(task(449, 3)), hashOf(task(449, 3, 'test')));
  assert.notEqual(hashOf(task(449, 3)), hashOf(task(450, 3)));
});

for (const d of DS) {
  test(`d${d}: referenceSolve passes; every bad and every necessity control fails on ${SEEDS.length} seeds`, t => {
    const controls = [...bed.badControls, ...bed.necessityControls].filter(c => applies(c, d) && !c.slow); // contract-fuzz: own test below
    const worst = {};
    for (const seed of SEEDS) {
      const tk = task(seed, d);
      const ref = bed.oracle(tk, bed.referenceSolve(tk));
      assert.ok(ref.pass, `reference fails seed ${seed}: ${JSON.stringify(ref.details).slice(0, 300)}`);
      assert.equal(ref.details.precision, 1); assert.equal(ref.details.recall, 1);
      assert.equal(ref.details.witness.witnessed, ref.details.defects, 'every reference witness reproduces');
      for (const c of controls) {
        const s = bed.oracle(tk, c.make(tk));
        assert.equal(s.pass, false, `control ${c.name} passes seed ${seed} d${d}`);
        worst[c.name] = Math.max(worst[c.name] ?? 0, s.score);
      }
    }
    t.diagnostic(`d${d} best F1 of each control over ${SEEDS.length} seeds: ${JSON.stringify(Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, Math.round(v * 100) / 100])))}`);
  });
}

test('every probe of every family lies in its own domain; every family can be drawn in every role it declares', () => {
  const house = { rounding: 'HALF_AWAY', band: 'incl', pageBase: 1 };
  let n = 0;
  for (const F of Object.values(FAMILIES)) {
    const roles = [{ kind: 'clean' }, ...F.can.defect.map(cls => ({ kind: 'defect', cls })), ...F.can.decoy.map(cls => ({ kind: 'decoy', cls }))];
    for (const role of roles) for (const h of [house, { rounding: 'HALF_EVEN', band: 'excl', pageBase: 0 }]) {
      const used = new Set();
      const api = rng('wbed-r3p-test', F.id, n);
      const p = F.draw(api, { house: h, name: ts => { const nm = ts[0].replace('{N}', 'Item').replace('{n}', 'item') + used.size; used.add(nm); return nm; } }, role);
      if (F.kind === 'caller') p.helper = 'helperFn';
      const fn = { domain: F.domain(p) };
      for (const a of F.probes(p, api)) assert.ok(argsOk(fn, a), `${F.id} ${JSON.stringify(role)} probe ${JSON.stringify(a)}`);
      assert.equal(typeof F.body(p, 'planted'), 'string'); assert.equal(typeof F.body(p, 'correct'), 'string');
      if (role.kind === 'clean') assert.equal(F.body(p, 'planted'), F.body(p, 'correct'), `${F.id}: a clean instance plants the correct body`);
      else assert.ok(p.variant, `${F.id}: a ${role.kind} draws a variant`);
      n++;
    }
  }
  assert.ok(n > 150, `${n} family x role x house draws`);
});

test('the manifest is proved by execution: defects reproduce on the bed witness, decoys equal the correct code on every probe, callers classified', t => {
  const tally = { defects: 0, decoys: 0, affected: 0, unaffected: 0 };
  for (const d of DS) for (const seed of SEEDS.slice(0, 6)) {
    const w = buildSweep(seed, 'dev', d);
    assert.ok(w.manifest.filter(m => m.loud).length <= Math.floor(LOUD_SHARE * w.L.defects), `d${d} s${seed}: at most ${LOUD_SHARE} of the defects are loud`);
    for (const f of w.fns) {
      if (f.role === 'defect') {
        tally.defects++;
        assert.ok(argsOk(f, f.witness), `${f.name}: witness inside the domain`);
        assert.notEqual(canonical(observe(w.planted, f.name, f.witness)), canonical(observe(w.correct, f.name, f.witness)), `${f.family}/${f.p.variant} reproduces`);
        assert.ok(w.L.classes.includes(f.cls), 'defects only of in-scope classes');
      }
      if (f.role === 'decoy') {
        tally.decoys++;
        for (const a of f.probes) assert.equal(canonical(observe(w.planted, f.name, a)), canonical(observe(w.correct, f.name, a)), `decoy ${f.family}/${f.p.variant} on ${JSON.stringify(a)}`);
        assert.ok(f.smell, 'every decoy looks like some class');
      }
      if (f.kind === 'caller' && w.defectiveHelpers.includes(f.helperFamily)) {
        if (f.affected) { tally.affected++; assert.notEqual(canonical(observe(w.planted, f.name, f.witness)), canonical(observe(w.correct, f.name, f.witness))); }
        else { tally.unaffected++; assert.equal(f.family, 'sum-lines'); }
        assert.equal(f.role, 'clean', 'a caller of a defective helper hosts no defect of its own');
      }
    }
    assert.equal(w.manifest.length, w.L.defects);
    assert.equal(w.fns.filter(f => f.role === 'decoy').length, w.L.decoys);
    assert.ok(w.fns.filter(f => f.affected).length >= Math.ceil((w.L.defects + 1) / 9), 'enough inheriting callers for the root-cause rule to bite');
  }
  t.diagnostic(`execution-checked over d2-d5 x seeds 401-406: ${JSON.stringify(tally)}`);
});

test('controls: CONTRACT minimums, the four required sweep controls, >= 12 per difficulty, relation and necessity controls; pipeline controls are labelled by-construction', () => {
  const names = bed.badControls.map(c => c.name);
  for (const n of ['empty', 'shuffled-or-corrupted', 'grep-for-TODO', 'linter-only', 'single-pass-no-verify', 'report-everything', 'class-confused', 'contract-fuzz-script', 'contract-fuzz-stream']) assert.ok(names.includes(n), n);
  // review 2026-10-14 finding 4: every control built from the bed's pipeline reads the manifest roles, so it is a
  // conditional stand-in; only the text controls (files only) are measurements
  for (const c of [...bed.badControls, ...bed.necessityControls]) assert.equal(c.byConstruction, ['stage', 'relation', 'necessity'].includes(c.kind) || c.name === 'shuffled-or-corrupted', c.name);
  for (const c of bed.necessityControls) assert.match(c.why, /construction/, c.name);
  assert.equal(new Set(names).size, names.length);
  for (const d of DS) assert.ok(bed.badControls.filter(c => applies(c, d)).length >= 12, `d${d}`);
  assert.ok(bed.badControls.filter(c => c.kind === 'relation').length >= 2);
  assert.deepEqual(bed.necessityControls.map(c => c.name).sort(), ['fan-out-no-root-cause', 'fan-out-no-verify', 'sequential-single-context']);
});

test('text controls read the rendered files only: the linter and the TODO grep run on a task\'s files without its world', () => {
  const tk = task(455, 4);
  const lint = linterFindings(tk.files, tk.inputs.defect_classes.map(c => c.code));
  assert.deepEqual(lint, bed.badControls.find(c => c.name === 'linter-only').make(tk));
  assert.ok(lint.findings.length > 0);
  const d = bed.oracle(tk, lint).details;
  assert.ok(d.fpCauses.decoy + d.fpCauses.clean > 0, 'the linter flags correct code (decoys and clean functions)');
});

test('relation controls pass every stage oracle and the reduce stage\'s local checks but fail a cross-stage relation', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 4)) {
    const tk = task(seed, d);
    for (const c of [...bed.badControls.filter(x => x.kind === 'relation'), bed.necessityControls.find(x => x.name === 'fan-out-no-root-cause')]) {
      const co = bed.composedOracle(tk, c.trace(tk));
      for (const [id, r] of Object.entries(co.stages)) assert.ok(r.pass, `${c.name} d${d} s${seed}: stage ${id} fails ${JSON.stringify(r.details).slice(0, 200)}`);
      assert.ok(Object.values(co.relations).some(r => !r.pass), `${c.name} d${d} s${seed}: no relation fails`);
    }
  }
});

test('necessity: without verification every decoy is reported; without root cause every inheriting caller is; both fail', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 5)) {
    const tk = task(seed, d), traps = bed.trapsOf(tk);
    const nv = bed.oracle(tk, bed.necessityControls.find(c => c.name === 'fan-out-no-verify').make(tk)).details;
    assert.equal(nv.recall, 1); assert.equal(nv.fpCauses.decoy, traps.decoys.length);
    const nr = bed.oracle(tk, bed.necessityControls.find(c => c.name === 'fan-out-no-root-cause').make(tk)).details;
    assert.equal(nr.recall, 1); assert.equal(nr.fpCauses.caller, traps.inheritingCallers.length);
    const co = bed.composedOracle(tk, bed.necessityControls.find(c => c.name === 'fan-out-no-root-cause').trace(tk));
    assert.equal(co.relations['V3-root-cause'].pass, false);
  }
});

test('necessity: a sequential single-context sweep fails on size at d4-d5 (the inline task is above the budget)', t => {
  const sizes = {};
  for (const d of [4, 5]) {
    const toks = SEEDS.map(s => estimateTokens(inlineRender(task(s, d))));
    sizes[d] = { min: Math.min(...toks), mean: Math.round(toks.reduce((a, b) => a + b, 0) / toks.length), max: Math.max(...toks) };
    assert.ok(sizes[d].min > bed.SEQUENTIAL_BUDGET_TOKENS, `d${d}: every task exceeds the ${bed.SEQUENTIAL_BUDGET_TOKENS}-token budget`);
    const seq = bed.necessityControls.find(c => c.name === 'sequential-single-context');
    for (const seed of SEEDS) { const tk = task(seed, d); assert.ok(bed.sizeOf(tk).skimmed >= 1); assert.equal(bed.oracle(tk, seq.make(tk)).pass, false); }
  }
  assert.ok(sizes[5].mean >= 55000, `d5 mean ${sizes[5].mean}`);
  t.diagnostic(`inline tokens (utf8/4) d4-d5: ${JSON.stringify(sizes)}`);
});

test('sizes, fan-out width and planted counts by difficulty', t => {
  const rows = {};
  for (const d of DS) {
    const xs = SEEDS.slice(0, 10).map(s => { const tk = task(s, d); return { ...bed.sizeOf(tk), inline: estimateTokens(inlineRender(tk)) }; });
    const mean = k => Math.round(xs.reduce((a, x) => a + x[k], 0) / xs.length);
    rows[d] = Object.fromEntries(['sourceFiles', 'functions', 'sourceLines', 'defects', 'decoys', 'inheritingCallers', 'testedFunctions', 'sourceTokens', 'inline', 'skimmed'].map(k => [k, mean(k)]));
  }
  assert.deepEqual(DS.map(d => rows[d].sourceFiles), [8, 16, 32, 48]);
  assert.deepEqual(DS.map(d => rows[d].defects), [6, 10, 16, 24]);
  for (let d = 2; d < 5; d++) for (const k of ['functions', 'sourceLines', 'inline']) assert.ok(rows[d + 1][k] > rows[d][k], `${k} d${d + 1}`);
  assert.equal(rows[2].skimmed, 0);
  t.diagnostic(`R3' sizes (means over seeds 401-410): ${JSON.stringify(rows)}`);
});

test('drift: classes in scope per difficulty, new classes only at higher difficulty, every in-scope class planted', () => {
  assert.deepEqual(bed.classesAt(2), ['OFF_BY_ONE', 'LOGIC_ERROR', 'MISSING_GUARD', 'ROUNDING']);
  for (let d = 2; d < 5; d++) assert.ok(bed.classesAt(d).every(c => bed.classesAt(d + 1).includes(c)), `d${d} subset of d${d + 1}`);
  assert.deepEqual(bed.CLASS_FROM, { OFF_BY_ONE: 2, LOGIC_ERROR: 2, MISSING_GUARD: 2, ROUNDING: 2, INPUT_MUTATION: 3, DATE_ARITH: 4, ESCAPING: 4, SWALLOWED_ERROR: 5, UNIT_MISMATCH: 5 });
  for (const d of DS) for (const seed of SEEDS.slice(0, 8)) {
    const tk = task(seed, d), m = bed.manifestOf(tk);
    assert.deepEqual(tk.inputs.defect_classes.map(c => c.code), bed.classesAt(d));
    for (const c of bed.classesAt(d)) assert.ok(m.some(x => x.class === c), `d${d} s${seed}: no ${c} planted`);
    assert.ok(m.every(x => bed.classesAt(d).includes(x.class)));
  }
});

test('hidden truth does not leak: no class code in the repository, no manifest function in prompt or inputs; comments independent of the roles', () => {
  let todoDef = 0, todoAll = 0, nDef = 0, nAll = 0;
  for (const d of DS) for (const seed of SEEDS.slice(0, 8)) {
    const tk = task(seed, d), w = buildSweep(seed, 'dev', d);
    const repo = Object.values(tk.files).join('\n');
    for (const c of CLASSES) assert.ok(!repo.includes(c), `class code ${c} in the repository`);
    const asked = canonical({ prompt: tk.prompt, inputs: tk.inputs });
    for (const m of w.manifest) assert.ok(!asked.includes(m.function), `${m.function} named in prompt or inputs`);
    for (const f of w.fns) { nAll++; if (f.todo) todoAll++; if (f.role === 'defect') { nDef++; if (f.todo) todoDef++; } }
  }
  for (const s of [...TODOS, ...NOTES]) assert.ok(!/off.by|round|guard|mutat|escap|leap|swallow|unit|bug|wrong|broken|incorrect/i.test(s), `comment pool: ${s}`);
  // TODOs are placed independently of the roles: on defects about as often as anywhere (loose band over many draws)
  assert.ok(Math.abs(todoDef / nDef - todoAll / nAll) < 0.08, `TODO rate on defects ${todoDef}/${nDef} vs all ${todoAll}/${nAll}`);
});

test('oracle: schema-invalid and hostile outputs fail; matching is exact on (file, function, class); duplicates and callers cost precision', () => {
  const tk = task(453, 3), ref = bed.referenceSolve(tk), m = bed.manifestOf(tk);
  for (const out of [null, {}, { findings: 'x' }, { findings: [{ file: 'a' }] }, { findings: [{ ...ref.findings[0], class: 'TYPO' }] }, new Proxy(ref, {})]) assert.equal(bed.oracle(tk, out).pass, false);
  const sh = structuredClone(ref); sh.findings.reverse(); for (const f of sh.findings) { f.file = `./${f.file.toUpperCase()}`; delete f.witness; delete f.line; }
  const s1 = bed.oracle(tk, sh); assert.ok(s1.pass, 'order, case of the path, a ./ prefix and missing optional fields do not matter'); assert.equal(s1.details.witness.given, 0);
  const dup = structuredClone(ref); dup.findings.push(dup.findings[0]);
  const s2 = bed.oracle(tk, dup).details; assert.equal(s2.fpCauses.duplicate, 1); assert.equal(s2.verified, m.length);
  const wrong = structuredClone(ref); wrong.findings[0].class = CLASSES.find(c => c !== wrong.findings[0].class && bed.classesAt(3).includes(c));
  const s3 = bed.oracle(tk, wrong).details; assert.equal(s3.fpCauses.wrongClass, 1); assert.equal(s3.missed, 1);
  const traps = bed.trapsOf(tk);
  const withCaller = { findings: [...ref.findings, { file: traps.inheritingCallers[0].file, function: traps.inheritingCallers[0].function, class: 'ROUNDING' }] };
  assert.equal(bed.oracle(tk, withCaller).details.fpCauses.caller, 1);
  const outOfScope = { findings: [...ref.findings, { ...ref.findings[0], class: 'UNIT_MISMATCH' }] };
  assert.equal(bed.oracle(tk, outOfScope).details.fpCauses.outOfScope, 1);
  // the pass thresholds. Recall: 20/24 passes, 19/24 fails (d5). Precision: one false positive on 10 defects passes (10/11),
  // two fail (10/12) (d3).
  const big = task(453, 5), bref = bed.referenceSolve(big), D = bref.findings.length;
  const drop = n => ({ findings: bref.findings.slice(n) });
  assert.equal(bed.oracle(big, drop(Math.floor(D * 0.2))).pass, true);
  assert.equal(bed.oracle(big, drop(Math.floor(D * 0.2) + 1)).pass, false);
  const decoys = traps.decoys.map(x => ({ file: x.file, function: x.function, class: x.looksLike }));
  assert.equal(bed.oracle(tk, { findings: [...ref.findings, decoys[0]] }).pass, true);
  assert.equal(bed.oracle(tk, { findings: [...ref.findings, decoys[0], decoys[1]] }).pass, false);
});

test('witnesses are run: valid ones count, outside-domain ones are not executed, non-reproducing ones do not count', () => {
  const tk = task(454, 4), m = bed.manifestOf(tk), ref = bed.referenceSolve(tk);
  for (const x of m) assert.deepEqual(bed.checkWitness(tk, x.file, x.function, x.witness), { ok: true });
  const w = buildSweep(454, 'dev', 4);
  const f = w.byName.get(m[0].function);
  const agree = f.probes.find(a => canonical(observe(w.planted, f.name, a)) === canonical(observe(w.correct, f.name, a)));
  if (agree) assert.deepEqual(bed.checkWitness(tk, m[0].file, m[0].function, agree), { ok: false, why: 'no-difference' });
  assert.deepEqual(bed.checkWitness(tk, m[0].file, m[0].function, ['x'.repeat(5000)]), { ok: false, why: 'outside-domain' });
  const bad = structuredClone(ref); bad.findings[0].witness = { args: [1e300, 'zz', null, [], {}] };
  const s = bed.oracle(tk, bad).details;
  assert.equal(s.witness.outsideDomain, 1); assert.equal(s.witness.witnessed, ref.findings.length - 1); assert.equal(s.verified, ref.findings.length, 'a bad witness does not cancel a verified finding');
});

test('composed oracle agrees with the end-to-end oracle on every trace; stage controls fail a stage oracle', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 3)) {
    const tk = task(seed, d);
    assert.ok(bed.composedOracle(tk, bed.referenceTrace(tk)).pass);
    for (const c of [...bed.badControls, ...bed.necessityControls].filter(x => x.trace && applies(x, d))) {
      const tr = c.trace(tk), co = bed.composedOracle(tk, tr);
      assert.equal(co.pass, bed.oracle(tk, tr.reduce).pass, `${c.name} d${d} s${seed}`);
      if (c.kind === 'stage') assert.ok(Object.values(co.stages).some(r => !r.pass), `${c.name}: some stage oracle must see it`);
    }
  }
});

test('stage hand-offs of the reference trace satisfy their contracts; stage oracles pass on the truth and fail on nothing', () => {
  for (const d of DS) {
    const tk = task(459, d), tr = bed.referenceTrace(tk);
    for (const s of ['inventory', 'candidates', 'verify', 'reduce']) assert.deepEqual(bed.CONTRACTS[s].check(tr[s]), [], `${s} d${d}`);
    assert.deepEqual(bed.CONTRACTS.input.check(tk.inputs), []);
    for (const s of bed.stages) { assert.ok(s.oracle(s.project(tk), tr[s.id]).pass, `${s.id} d${d}`); assert.equal(s.oracle(s.project(tk), {}).pass, false); }
  }
});

test('the inventory a solver can parse from the files equals the generator\'s spans', () => {
  for (const d of DS) {
    const tk = task(460, d), inv = bed.referenceTrace(tk).inventory;
    for (const file of inv.files) assert.deepEqual(parseFunctions(tk.files[file.path]).map(f => ({ name: f.name, start_line: f.start, end_line: f.end })), file.functions, file.path);
  }
});

test('the repository is real code: every module imports, its own test suite passes, and witnesses reproduce in real Node', () => {
  for (const [seed, d] of [[461, 3], [462, 5]]) {
    const tk = task(seed, d), w = buildSweep(seed, 'dev', d);
    const dir = mkdtempSync(path.join(tmpdir(), 'wbed-r3p-repo-'));
    try {
      for (const [rel, text] of Object.entries(tk.files)) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); }
      const out = execFileSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH } });
      assert.match(out, /# fail 0/); assert.match(out, /# pass [1-9]/);
      const calls = w.manifest.map(m => ({ mod: pathToFileURL(path.join(dir, m.file)).href, name: m.function, args: m.witness }));
      const code = `const calls = ${JSON.stringify(calls)}; const out = []; for (const c of calls) { const m = await import(c.mod); const a = structuredClone(c.args); try { out.push({ r: m[c.name](...a), a }); } catch (e) { out.push({ e: e.name, a }); } }`
        + ` const { canonValue } = await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL('./exec.mjs', import.meta.url))).href)}); console.log(JSON.stringify(out.map(o => o.e ? { throws: o.e, argsAfter: canonValue(o.a) } : { returns: canonValue(o.r), argsAfter: canonValue(o.a) })));`;
      const real = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, encoding: 'utf8' }));
      w.manifest.forEach((m, i) => {
        const o = observe(w.planted, m.function, m.witness);
        assert.deepEqual(real[i], o.throws ? { throws: o.throws, argsAfter: o.argsAfter } : { returns: o.returns, argsAfter: o.argsAfter }, `${m.id}: vm and real Node agree`);
      });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('cost per verified finding and stream aggregation (cost comes from the host, never from the output)', () => {
  const rows = [449, 450, 451].map(seed => { const tk = task(seed, 3); return { result: bed.oracle(tk, bed.referenceSolve(tk)), costUsd: 0.5 }; });
  const tk = task(452, 3);
  rows.push({ result: bed.oracle(tk, bed.necessityControls.find(c => c.name === 'fan-out-no-verify').make(tk)), costUsd: 0.25 });
  rows.push({ result: bed.oracle(tk, { nope: 1 }), costUsd: 0.1, defects: 10 });
  const agg = bed.aggregateSweeps(rows);
  assert.equal(agg.tasks, 5); assert.equal(agg.passes, 3); assert.equal(agg.verified, 40); assert.equal(agg.missed, 10);
  assert.equal(agg.costPerVerifiedFinding, (1.5 + 0.25 + 0.1) / 40);
  assert.ok(agg.precision < 1 && agg.byClass.OFF_BY_ONE.tp >= 4);
  const one = bed.costPerVerifiedFinding(rows[0].result, 0.5);
  assert.equal(one.verified, 10); assert.equal(one.perVerified, 0.05); assert.equal(one.perWitnessed, 0.05);
  assert.equal(bed.costPerVerifiedFinding(rows[4].result, 0.1).perVerified, null);
});

test('retroactive sweep (F2): exact impact sets and an exact replay of a production call log', () => {
  for (const d of [3, 5]) {
    const tk = task(463, d), imp = bed.impactManifestOf(tk);
    const helperDefects = imp.filter(x => x.affected.length || x.unaffected.length);
    assert.ok(helperDefects.length >= 1);
    const perfect = { impacts: imp.map(x => ({ file: x.file, function: x.function, affected: x.affected })) };
    assert.deepEqual(bed.scoreImpact(tk, perfect).f1, 1);
    const overMark = { impacts: imp.map(x => ({ file: x.file, function: x.function, affected: [...x.affected, ...x.unaffected] })) };
    const unaffected = helperDefects.reduce((s, x) => s + x.unaffected.length, 0);
    if (unaffected) assert.ok(bed.scoreImpact(tk, overMark).precision < 1, 'marking every caller (no replay) over-marks');
    const log = bed.callLogFor(tk);
    assert.deepEqual(bed.callLogFor(tk), log, 'the call log is deterministic');
    assert.ok(log.some(c => c.wrong) && log.some(c => !c.wrong));
    assert.equal(bed.scoreReplay(tk, log, { wrong: log.filter(c => c.wrong).map(c => c.id) }).f1, 1);
    const byFunction = new Set(imp.flatMap(x => [x.function, ...x.affected.map(a => a.function)]));
    const coarse = bed.scoreReplay(tk, log, { wrong: log.filter(c => byFunction.has(c.function)).map(c => c.id) });
    assert.ok(coarse.precision < 1, 'marking every recorded call of an affected function over-marks: some calls were right');
  }
});

test('seed ledger: wbed-r3p has its own disjoint dev and held-out ranges; the tests and the attack plan use them', () => {
  const ledger = JSON.parse(readFileSync(path.join(ROOT, 'research/jit-20261008/SEED-LEDGER.json'), 'utf8'));
  const mine = ledger.ranges.filter(r => r.beds.includes('wbed-r3p'));
  assert.deepEqual(mine.map(r => [r.id, r.split, r.from, r.to]).sort(), [['wbed-r3p-dev', 'dev', 401, 490], ['wbed-r3p-heldout-a', 'test', 8601, 8624], ['wbed-r3p-heldout-b', 'test', 8701, 8724]]);
  for (const r of mine) for (const o of ledger.ranges) {
    if (o === r || o.split !== r.split || o.to === null) continue;
    assert.ok(o.to < r.from || o.from > r.to, `${r.id} overlaps ${o.id}`);
  }
  const dev = mine.find(r => r.id === 'wbed-r3p-dev');
  for (const s of [...SEEDS, ...RUNGS.r3p.seeds]) assert.ok(s >= dev.from && s <= dev.to);
  assert.deepEqual(RUNGS.r3p.seeds, Array.from({ length: 12 }, (_, i) => 479 + i));
  for (const s of SEEDS) assert.ok(s >= 449 && s <= 472, 'tests use the tuning block only, never the rehearsal streams 401-448');
});

test('triviality driver plans R3\' dry on its own attack seeds and scores stubs through the oracle', async () => {
  const p = await plan({ rungs: ['r3p'] });
  assert.deepEqual(p[0].seeds, RUNGS.r3p.seeds);
  assert.equal(p[0].calls, 24);
  assert.match(p[0].necessity, /verify/);
  const q = await plan({ rungs: ['r3p'], seeds: [479, 480] });
  for (const x of await runStub(q, 'reference')) assert.equal(x.pass, x.n);
  for (const x of await runStub(q, 'fan-out-no-verify')) assert.equal(x.pass, 0);
  for (const x of await runStub(q, 'linter-only')) assert.equal(x.pass, 0);
  // review finding 8: an explicit seed outside the rung's own ledger rows is refused (e.g. --rung all --seeds 379-390)
  await assert.rejects(plan({ rungs: ['r3p'], seeds: [379, 380] }), /SEED_REFUSED/);
  await assert.rejects(plan({ rungs: ['r3p'], seeds: [8601] }), /SEED_REFUSED/);
});

test('the test split generates and passes the reference (on a tuning seed, never a held-out one); held-out wording appears only there; faults are a no-op by default', () => {
  const tk = task(471, 4, 'test'); assert.ok(bed.oracle(tk, bed.referenceSolve(tk)).pass);
  // the last main-sentence wording of every family is drawn on the test split only (families.mjs words())
  let testOnly = 0;
  for (const seed of [471, 472]) for (const split of ['dev', 'test']) for (const f of buildSweep(seed, split, 4).fns) {
    if (!f.p.w) continue;
    const F = FAMILIES[f.family], n = F.draw.toString().match(/words\(r, ctx, \[(\d+)/)?.[1];
    if (!n || f.p.w[0] !== Number(n) - 1) continue;
    assert.equal(split, 'test', `${f.family}: held-out wording drawn on dev`); testOnly++;
  }
  assert.ok(testOnly > 0, 'the test split uses held-out wording');
  assert.equal(hashOf(bed.generate({ seed: 449, split: 'dev', difficulty: 3, faults: [] })), hashOf(task(449, 3)));
  assert.throws(() => bed.generate({ seed: 449, split: 'dev', difficulty: 3, faults: ['f3'] }), /not implemented/);
});

test('runtime: generate under 2 s and oracle under 2 s at difficulty 5 (cold)', t => {
  const t0 = performance.now();
  const tk = bed.generate({ seed: 472, split: 'dev', difficulty: 5 });
  const t1 = performance.now();
  bed.oracle(tk, bed.referenceSolve(tk));
  const t2 = performance.now();
  assert.ok(t1 - t0 < 2000, `generate ${Math.round(t1 - t0)} ms`);
  assert.ok(t2 - t1 < 2000, `oracle ${Math.round(t2 - t1)} ms`);
  t.diagnostic(`d5 cold: generate ${Math.round(t1 - t0)} ms, oracle ${Math.round(t2 - t1)} ms; generator re-draws so far ${JSON.stringify(redrawStats)}`);
});


// ---------------------------------------------------------------------------------------------------------------------
// Regression tests for the adversarial review of 2026-10-14 (W-BED-R3P-NOTES §17).

const unperm = (f, args) => { const perm = f.p.order; if (!perm) return args; const out = []; perm.forEach((i, j) => { out[i] = args[j]; }); return out; };
const specObs = (fn, args) => {
  const a = JSON.parse(JSON.stringify(args));
  try { return { returns: canonValue(fn(...a)), throws: null, argsAfter: canonValue(a) }; } catch (e) { return { returns: null, throws: e.name, argsAfter: canonValue(a) }; }
};
const sameAsSpec = (o, w) => o.returns === w.returns && o.throws === w.throws && o.argsAfter === w.argsAfter;

test('finding 2 (P1): every correct body and every decoy meets an independent spec of its contract on random in-domain inputs', t => {
  // family level: every family x role x knob draw, both house rules, both splits; the spec (spec.mjs) is written from the
  // contract text in exact integer arithmetic, not from the bodies
  let runs = 0, draws = 0;
  for (const F of Object.values(FAMILIES)) {
    const roles = [{ kind: 'clean' }, ...F.can.decoy.map(cls => ({ kind: 'decoy', cls }))];
    for (const role of roles) for (let k = 0; k < 16; k++) {
      const house = { rounding: k % 2 ? 'HALF_AWAY' : 'HALF_EVEN', band: k % 3 ? 'incl' : 'excl', pageBase: k % 4 < 2 ? 1 : 0 };
      const r = rng('wbed-r3p-spec', F.id, role.kind, k);
      let i = 0;
      const p = F.draw(r, { house, name: ts => `${ts[0].replace('{N}', 'Item').replace('{n}', 'item')}${i++}`, split: k % 3 ? 'dev' : 'test' }, role);
      const helper = [];
      if (F.kind === 'caller') {
        p.helper = 'helperFn';
        const H = FAMILIES[F.helper], hp = H.draw(rng('wbed-r3p-spec-helper'), { house, name: () => 'helperFn' }, { kind: 'clean' });
        helper.push(`function helperFn(${H.sig(hp).join(', ')}) {\n${H.body(hp, 'correct')}\n}`);
      }
      const fn = { domain: F.domain(p) }, spec = SPEC[F.id](p, house);
      const ctxs = ['correct', ...(role.kind === 'decoy' ? ['planted'] : [])].map(w => [w, makeContext([...helper, `function f(${F.sig(p).join(', ')}) {\n${F.body(p, w)}\n}`])]);
      const hints = (JSON.stringify(F.doc(p)).match(/'[^']{1,20}'/g) ?? []).map(x => x.slice(1, -1));
      const inputs = [...F.probes(p, r)];
      for (let n = 0, tries = 0; n < 25 && tries < 750; tries++) { const a = fn.domain.params.map(s => randomValue(s, r, hints)); if (argsOk(fn, a)) { inputs.push(a); n++; } }
      for (const a of inputs) for (const [w, ctx] of ctxs) {
        runs++;
        assert.ok(sameAsSpec(observe(ctx, 'f', a), specObs(spec, a)), `${F.id} ${role.kind} (${w}) breaks its contract on ${JSON.stringify(a).slice(0, 200)}; p=${JSON.stringify(p).slice(0, 200)}`);
      }
      draws++;
    }
  }
  // world level: every clean function and decoy of real tasks (permuted parameters, real helpers, the task's house rules)
  for (const [seed, d] of [[464, 3], [465, 5]]) {
    const w = buildSweep(seed, 'dev', d), r = rng('wbed-r3p-spec-world', seed, d);
    for (const f of w.fns) {
      if (f.role === 'defect' || f.affected) continue;
      const spec = SPEC[f.family](f.p, w.house), hints = (JSON.stringify(f.contract).match(/'[^']{1,20}'/g) ?? []).map(x => x.slice(1, -1));
      const inputs = [...f.probes];
      for (let n = 0, tries = 0; n < 12 && tries < 400; tries++) { const a = f.domain.params.map(s => randomValue(s, r, hints)); if (argsOk(f, a)) { inputs.push(a); n++; } }
      for (const a of inputs) { runs++; assert.ok(sameAsSpec(observe(w.planted, f.name, a), specObs(spec, unperm(f, a))), `${f.name} (${f.family}, ${f.role}) on ${JSON.stringify(a).slice(0, 200)}`); }
    }
  }
  t.diagnostic(`contract specs: ${draws} family draws, ${runs} executions, 0 deviations`);
});

test('finding 2 (P1): the reviewer\'s two contract-faithful reports are right now: fee-rate in percent rounds halves up, safe-get reads own properties', () => {
  const house = { rounding: 'HALF_AWAY', band: 'incl', pageBase: 1 };
  const draw = (id, want) => { for (let k = 0; k < 400; k++) { const p = FAMILIES[id].draw(rng('wbed-r3p-f2', id, k), { house, name: ts => ts[0] }, { kind: 'clean' }); if (want(p)) return p; } throw new Error(id); };
  const fee = draw('fee-rate', p => p.unit === 'pct' && p.rule === 'half-up');
  const feeCtx = makeContext([`function f(${FAMILIES['fee-rate'].sig(fee).join(', ')}) {\n${FAMILIES['fee-rate'].body(fee, 'correct')}\n}`]);
  assert.deepEqual(FAMILIES['fee-rate'].domain(fee).params[1], { t: 'int', min: 0, max: 100 }, 'a percent rate is a whole number: the fee is an exact rational');
  for (const [a, rate, want] of [[5500, 7, 385], [50, 25, 13], [150, 1, 2], [250, 1, 3], [12345, 50, 6173]]) assert.equal(observe(feeCtx, 'f', [a, rate]).returns, String(want), `${a} at ${rate}%`);
  const sg = draw('safe-get', p => p.miss === 'undefined' && p.sep === '.');
  const sgCtx = makeContext([`function f(${FAMILIES['safe-get'].sig(sg).join(', ')}) {\n${FAMILIES['safe-get'].body(sg, 'correct')}\n}`]);
  assert.deepEqual(observe(sgCtx, 'f', [{}, 'constructor']).returns, '{"$undefined":true}', 'a prototype member is not an own property');
  assert.equal(observe(sgCtx, 'f', [{ n: null }, 'n']).returns, 'null', 'the contract now says a final null is returned as null');
  assert.match(FAMILIES['safe-get'].doc(sg).lines[0], /Object\.hasOwn/);
  assert.equal(roundRational(77, 2, 'half-up'), 39); assert.equal(roundRational(-5, 2, 'even'), -2); assert.equal(roundRational(-7, 2, 'floor'), -4);
});

test('finding 3 (P1): a defect whose class two definitions fit is verified under either; both at once is one hit and one duplicate', () => {
  let checked = 0;
  for (const seed of SEEDS) for (const d of [4, 5]) {
    const tk = task(seed, d), m = bed.manifestOf(tk).find(x => x.accepted.length > 1);
    if (!m) continue;
    const ref = bed.referenceSolve(tk), alt = m.accepted.find(c => c !== m.class && bed.classesAt(d).includes(c));
    if (!alt) continue;
    const swapped = { findings: ref.findings.map(f => (f.function === m.function ? { ...f, class: alt } : f)) };
    const s = bed.oracle(tk, swapped).details;
    assert.equal(s.verified, s.defects, `${m.family}/${m.variant} as ${alt} is verified`); assert.equal(s.verifiedViaAcceptedClass, 1); assert.equal(s.falsePositives, 0);
    const both = bed.oracle(tk, { findings: [...ref.findings, { file: m.file, function: m.function, class: alt }] }).details;
    assert.equal(both.verified, both.defects); assert.equal(both.fpCauses.duplicate, 1);
    checked++;
    if (checked >= 3) break;
  }
  assert.ok(checked >= 1, 'some task in the tuning block plants an ambiguous variant');
  // the class definitions no longer overlap where the review found them overlapping
  assert.match(bed.DEFINITIONS.LOGIC_ERROR, /an empty, null or zero input is MISSING_GUARD/);
  assert.match(bed.DEFINITIONS.ROUNDING, /rounding at the wrong step/);
  assert.deepEqual(FAMILIES['split-evenly'].accept['le-extra'], ['OFF_BY_ONE', 'ROUNDING']);
  assert.deepEqual(FAMILIES['to-major'].accept['always-100'], ['UNIT_MISMATCH', 'LOGIC_ERROR']);
});

test('finding 3 (P1): one false positive is always tolerated (a 6-defect task no longer fails on one extra finding); two are not', () => {
  assert.equal(passes(6, 1, 6), true); assert.equal(passes(6, 2, 6), false); assert.equal(passes(5, 1, 6), true); assert.equal(passes(4, 0, 6), false);
  assert.equal(passes(10, 1, 10), true); assert.equal(passes(10, 2, 10), false); assert.equal(passes(18, 2, 20), true); assert.equal(passes(18, 3, 20), false);
  const tk = task(449, 2), ref = bed.referenceSolve(tk), traps = bed.trapsOf(tk);
  const decoy = traps.decoys.map(x => ({ file: x.file, function: x.function, class: x.looksLike }));
  assert.equal(bed.oracle(tk, { findings: [...ref.findings, decoy[0]] }).pass, true);
  assert.equal(bed.oracle(tk, { findings: [...ref.findings, decoy[0], decoy[1]] }).pass, false);
  // the root-cause trap stays decisive under the tolerance: at least two inheriting callers at d2
  for (const seed of SEEDS.slice(0, 6)) assert.ok(bed.trapsOf(task(seed, 2)).inheritingCallers.length >= 2);
});

test('finding 1 (P0): the contract-fuzz script fails on single tasks and with a corpus of earlier tasks; no contract template repeats within a task', t => {
  const fuzz = bed.badControls.find(c => c.name === 'contract-fuzz-script'), stream = bed.badControls.find(c => c.name === 'contract-fuzz-stream');
  assert.ok(fuzz.slow && stream.slow && !fuzz.byConstruction);
  const rows = [];
  for (const [d, seeds] of [[3, [449, 450, 451, 452]], [4, [453]]]) for (const seed of seeds) {
    const tk = task(seed, d), s = bed.oracle(tk, fuzz.make(tk));
    rows.push({ mode: 'single', d, seed, pass: s.pass, recall: s.details.recall, precision: s.details.precision });
  }
  const corpus = [457, 458, 459, 460, 461, 462, 463, 464].map(s => task(s, 3).files); // eight earlier tasks, unlabelled
  for (const seed of [465, 466]) {
    const tk = task(seed, 3), out = stream.make(tk, { corpus }), s = bed.oracle(tk, out);
    rows.push({ mode: 'corpus', d: 3, seed, pass: s.pass, recall: s.details.recall, precision: s.details.precision });
  }
  for (const x of rows) { assert.equal(x.pass, false, JSON.stringify(x)); assert.ok(x.recall < 0.6, JSON.stringify(x)); }
  t.diagnostic(`contract-fuzz rows: ${JSON.stringify(rows)}`);
  for (const d of DS) for (const seed of SEEDS.slice(0, 3)) {
    const keys = buildSweep(seed, 'dev', d).fns.map(f => f.template).filter(Boolean);
    assert.equal(new Set(keys).size, keys.length, `d${d} s${seed}: a contract template repeats within the repository`);
  }
});

test('finding 1 (P0): the same contract text rarely recurs across a stream of 24 tasks (the vote has almost nobody to vote with)', t => {
  const seen = new Map();
  for (let seed = 449; seed <= 472; seed++) for (const f of buildSweep(seed, 'dev', 3).fns) if (f.template) seen.set(f.template, (seen.get(f.template) ?? 0) + 1);
  let defects = 0, voted = 0;
  for (let seed = 449; seed <= 472; seed++) for (const f of buildSweep(seed, 'dev', 3).fns) if (f.role === 'defect') { defects++; if (seen.get(f.template) >= 3) voted++; }
  assert.ok(voted / defects < 0.1, `${voted}/${defects} defects share their exact contract with >= 2 other functions of the 24 tasks`);
  t.diagnostic(`d3, 24 tasks: ${voted}/${defects} defects have >= 2 same-template peers; ${seen.size} distinct templates`);
});

test('finding 1 (P0): loud defects (crash, NaN, changed argument, wrong error type, the shared helpers) are capped; silent variants exist for MISSING_GUARD and SWALLOWED_ERROR', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 8)) {
    const w = buildSweep(seed, 'dev', d), loud = w.manifest.filter(m => m.loud).length;
    assert.ok(loud <= Math.floor(LOUD_SHARE * w.L.defects), `d${d} s${seed}: ${loud} loud of ${w.L.defects}`);
    assert.equal(w.manifest.filter(m => m.class === 'INPUT_MUTATION').length, w.L.classes.includes('INPUT_MUTATION') ? (d === 3 ? 1 : 2) : 0, 'INPUT_MUTATION keeps its quota minimum only');
  }
  for (const id of ['average', 'ratio', 'display-name', 'safe-get', 'max-by', 'parse-amount', 'read-settings']) {
    const F = FAMILIES[id], quiet = new Set();
    for (let k = 0; k < 200; k++) { const p = F.draw(rng('wbed-r3p-quiet', id, k), { house: { rounding: 'HALF_AWAY', band: 'incl', pageBase: 1 }, name: ts => ts[0] }, { kind: 'defect', cls: F.can.defect[0] }); if (!F.loud.includes(p.variant)) quiet.add(p.variant); }
    assert.ok(quiet.size >= 1, `${id} has a silent defect variant`);
  }
});

test('finding 5 (P2, fixed part): a converted slot stays inside its file\'s area pool; test inputs come from a shuffled probe list', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 5)) {
    const w = buildSweep(seed, 'dev', d);
    for (const f of w.fns) {
      const lib = LIB.find(l => l.path === f.path), area = AREAS.find(a => f.path.startsWith(`src/${a.dir}/`));
      const pool = lib ? [lib.helper, ...lib.families] : area.families;
      assert.ok(pool.includes(f.family), `d${d} s${seed}: ${f.family} in ${f.path} is outside the file's pool`);
    }
  }
});

test('finding 6 (P2): the F2 call log covers one confirmed defect, its callers and clean distractors only', () => {
  const tk = task(467, 5), w = buildSweep(467, 'dev', 5);
  for (const m of bed.manifestOf(tk).slice(0, 4)) {
    const log = bed.callLogFor(tk, m.id), fns = new Set(log.map(c => c.function));
    const hit = new Set([m.function, ...w.fns.filter(f => f.calls === m.function).map(f => f.name)]);
    for (const name of fns) {
      const f = w.byName.get(name);
      if (hit.has(name)) continue;
      assert.ok(f.role !== 'defect' && !f.affected, `${name} (${f.role}) leaks into the log of ${m.id}`);
      assert.ok(log.filter(c => c.function === name).every(c => !c.wrong));
    }
    assert.ok(log.some(c => c.function === m.function && c.wrong), 'the confirmed defect has a wrong recorded output');
    assert.ok([...fns].filter(n => !hit.has(n)).length >= Math.min(4, hit.size), 'distractors matched in number');
  }
});

test('finding 7 (P2): a timeout is never an observation: generation throws, the witness check reports it apart', () => {
  const ctx = makeContext(['function spin() { for (;;) {} }', 'function one() { return 1; }']);
  assert.equal(observe(ctx, 'spin', [], 20).throws, 'Timeout');
  assert.throws(() => obsGen(ctx, 'spin', []), /timed out .* during generation/);
  const fake = { planted: ctx, correct: makeContext(['function spin() { return 1; }']) };
  assert.deepEqual(witnessHolds(fake, { name: 'spin', domain: { params: [] } }, []), { ok: false, why: 'timeout' });
});

test('wording: the main sentence\'s last option is drawn only on the test split', () => {
  const ctxDev = { split: 'dev' }, ctxTest = { split: 'test' }, seenDev = new Set(), seenTest = new Set();
  for (let k = 0; k < 400; k++) {
    const r1 = rng('wbed-r3p-words', k), r2 = rng('wbed-r3p-words', k);
    seenDev.add(wordsOf(r1, ctxDev, [3])[0]); seenTest.add(wordsOf(r2, ctxTest, [3])[0]);
  }
  assert.deepEqual([...seenDev].sort(), [0, 1]); assert.ok(seenTest.has(2));
});
