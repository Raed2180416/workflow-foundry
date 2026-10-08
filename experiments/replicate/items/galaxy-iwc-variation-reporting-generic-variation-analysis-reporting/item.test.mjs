// R-bench item tests: galaxy:iwc/variation-reporting/Generic-variation-analysis-reporting
// Run: node --test experiments/replicate/items/galaxy-iwc-variation-reporting-generic-variation-analysis-reporting/item.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { hashOf } from '../../../../beds/lib/canonical.mjs';
import * as item from './index.mjs';
import { pyFloat, javaFloat, g14, pyRound6 } from './formats.mjs';
import { compilePython, compileSnpSift } from './miniexpr.mjs';
import { runJob, MUTATIONS, parseVcf } from './reference.mjs';
import { runOriginalWorkflow, loadGa } from './original-emulator.mjs';
import { batteryInputs, exampleCase, shippedCase, TABLES, N_DERIVED } from './cases.mjs';
import { battery, expectedOf, judgeCase } from './oracle.mjs';
import { compareTable, diffLineCount } from './compare.mjs';
import { snapshot } from './freeze.mjs';
import { runCommandCandidate } from './candidate.mjs';
import { solverView, inlineRender } from '../../../lib/beds.mjs';

const task = (over = {}) => item.generate({ seed: 1, split: 'test', difficulty: 3, taskType: 'T2', ...over });
const fx = rel => readFileSync(new URL(`./fixtures/${rel}`, import.meta.url), 'utf8');
const mutationControl = name => item.badControls.find(c => c.name === `mutation:${name}`);

test('number formatters match Python / Java / printf behaviour', () => {
  assert.equal(pyFloat(1), '1.0'); assert.equal(pyFloat(0.888889), '0.888889'); assert.equal(pyFloat(5e-5), '5e-05');
  assert.equal(pyFloat(1e-4), '0.0001'); assert.equal(pyFloat(1e16), '1e+16'); assert.equal(pyFloat(0.1 + 0.2), '0.30000000000000004');
  assert.equal(pyRound6(0.0078125), 0.007812); // exact binary tie: Python rounds half to even
  assert.equal(pyRound6(0.0234375), 0.023438);
  assert.equal(pyFloat(pyRound6(24 / 24)), '1.0');
  assert.equal(javaFloat(1), '1.0'); assert.equal(javaFloat(0.958333), '0.958333'); assert.throws(() => javaFloat(1e-5));
  assert.equal(g14(1), '1'); assert.equal(g14(0.888889), '0.888889'); assert.equal(g14(0.1), '0.1');
});

test('mini expression engines evaluate the original expressions', () => {
  const rec = { chrom: 'c', pos: '1', info: new Map([['DP', '24'], ['AF', '0.5'], ['DP4', '0,0,16,8']]) };
  assert.equal(compileSnpSift('( ( DP4[2] + DP4[3] ) < ( 0.05 * DP ) ) | ( DP < 1 ) | ( ( AF * DP ) < ( 10 - 0.5 ) )')(rec), false);
  assert.equal(compileSnpSift('DP >= 25')(rec), false);
  assert.throws(() => compileSnpSift('DP ** 2'), /unsupported|unexpected/);
  const py = compilePython('round((c17 + c18) / c6, 6)');
  assert.equal(py.str(py.eval({ c17: 16n, c18: 8n, c6: 24n })), '1.0');
  const p2 = compilePython("str(int(c3)) + ':' + str(c19)");
  assert.equal(p2.str(p2.eval({ c3: 689n, c19: 'C>T' })), '689:C>T');
  assert.equal(compilePython("c4=='PASS' or c4=='.'").eval({ c4: '.' }), true);
  assert.throws(() => compilePython('__import__("os")'), /unsupported/);
});

test('evaluator health gate: the reference reproduces the four shipped tables exactly', () => {
  assert.deepEqual(item.evaluatorHealth(), { ok: true, problems: [] });
  const s = shippedCase(), out = runJob(s.inputs);
  assert.equal(out.af_recalculated[Object.keys(s.expected.af_recalculated)[0]], Object.values(s.expected.af_recalculated)[0]);
  for (const t of TABLES.slice(1)) assert.equal(out[t], s.expected[t], t);
});

test('the .ga emulator (original control) reproduces the shipped tables exactly and agrees with the reference on every case of 3 batteries', () => {
  const s = shippedCase(), out = runOriginalWorkflow(s.inputs);
  for (const t of TABLES.slice(1)) assert.equal(out[t], s.expected[t], `emulator ${t}`);
  assert.deepEqual(out.af_recalculated, s.expected.af_recalculated);
  for (const seed of [1, 2, 3]) for (const c of batteryInputs({ seed, split: 'test', difficulty: 3 })) {
    const a = runJob(c.inputs), b = runOriginalWorkflow(c.inputs);
    for (const t of TABLES.slice(1)) assert.equal(a[t], b[t], `${c.caseId} ${t} (seed ${seed})`);
    assert.deepEqual(a.af_recalculated, b.af_recalculated, `${c.caseId} af_recalculated (seed ${seed})`);
  }
});

test('the emulator really executes the .ga: changing a parameter inside the workflow changes the output; unsupported tools are refused', () => {
  const ga = loadGa();
  const s = shippedCase();
  const changed = structuredClone(ga);
  const st = JSON.parse(changed.steps[16].tool_state);
  st.cond = "str(int(c3)) + '/' + str(c19)";
  changed.steps[16].tool_state = JSON.stringify(st);
  assert.match(runOriginalWorkflow(s.inputs, changed).all_variants_all_samples, /\t689\/C>T/);
  const unknown = structuredClone(ga);
  unknown.steps[10].tool_id = 'toolshed.g2.bx.psu.edu/repos/iuc/mystery/mystery_tool/1.0';
  assert.throws(() => runOriginalWorkflow(s.inputs, unknown), /no emulator/);
  const joinType = structuredClone(ga);
  const js = JSON.parse(joinType.steps[22].tool_state); js.jointype = '-a 1'; joinType.steps[22].tool_state = JSON.stringify(js);
  assert.throws(() => runOriginalWorkflow(s.inputs, joinType), /not emulated/);
});

test('shape: the bed contract surface and a portable output schema', () => {
  for (const name of ['family', 'outputSchema', 'generate', 'oracle', 'referenceSolve', 'badControls', 'evalInputs', 'originalControls']) assert.ok(name in item, name);
  assert.equal(item.family.kind, 'oneshot');
  const walk = (o, path = '$') => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { assert.ok(!['pattern', 'oneOf', 'uniqueItems', '$ref', 'format'].includes(k), `${path}.${k}`); walk(v, `${path}.${k}`); } };
  walk(item.outputSchema);
  for (const taskType of item.TASK_TYPES) {
    const t = task({ taskType });
    assert.equal(typeof t.prompt, 'string'); assert.equal(t.taskType, taskType); assert.deepEqual(JSON.parse(JSON.stringify(t)), t);
    for (const [rel, text] of Object.entries(t.files)) assert.equal(typeof text, 'string', rel);
  }
  // the experiment runner renders a task for arms with these two helpers (experiments/lib/beds.mjs); they must accept our tasks
  const t = task({ taskType: 'T2' }), view = solverView(t);
  assert.equal(view.prompt, t.prompt); assert.ok('inputs.json' in view.files); assert.ok('files/description.md' in view.files);
  assert.ok(inlineRender(t).includes('TASK T2'));
});

test('determinism: identical tasks, batteries and expected tables; seeds and splits change the derived cases only', () => {
  for (const taskType of item.TASK_TYPES) assert.equal(hashOf(task({ taskType })), hashOf(task({ taskType })));
  const a = batteryInputs({ seed: 1, split: 'test', difficulty: 3 }), b = batteryInputs({ seed: 1, split: 'test', difficulty: 3 });
  assert.equal(hashOf(a), hashOf(b));
  assert.notEqual(hashOf(a.slice(1)), hashOf(batteryInputs({ seed: 2, split: 'test', difficulty: 3 }).slice(1)));
  assert.notEqual(hashOf(a.slice(1)), hashOf(batteryInputs({ seed: 1, split: 'dev', difficulty: 3 }).slice(1)));
  assert.equal(hashOf(a[0]), hashOf(batteryInputs({ seed: 9, split: 'dev', difficulty: 2 })[0]), 'the shipped case never changes');
  // the three task types are scored on the same hidden battery
  assert.equal(hashOf(item.evalInputs(task({ taskType: 'T1' }))), hashOf(item.evalInputs(task({ taskType: 'T3' }))));
});

test('frozen battery: canonical cases, expected tables and task texts match fixtures/frozen-battery.json', () => {
  const frozen = JSON.parse(fx('frozen-battery.json')), now = snapshot();
  assert.deepEqual(now.cases, frozen.cases);
  assert.deepEqual(now.tasks, frozen.tasks);
  assert.equal(now.batterySha256, frozen.batterySha256);
});

test('battery shape: shipped + 20 derived, 2 to 5 samples, shifted thresholds, boundary records, pre-flagged and multi-effect inputs', () => {
  const cases = batteryInputs({ seed: 1, split: 'test', difficulty: 3 });
  assert.equal(cases.length, 1 + N_DERIVED);
  assert.equal(cases[0].caseId, 'shipped');
  const derived = cases.slice(1);
  assert.deepEqual([...new Set(derived.map(c => c.inputs.samples.length))].sort(), [2, 3, 4, 5]);
  assert.ok(derived.filter(c => c.inputs.params.af !== 0.05 || c.inputs.params.dp !== 1 || c.inputs.params.dp_alt !== 10).length >= 14, 'most cases use shifted thresholds');
  assert.ok(derived.every(c => c.features.engineered.includes('boundary-af') && c.features.engineered.includes('low-af') && c.features.engineered.includes('low-dp-alt')));
  assert.ok(derived.some(c => c.features.preflagged) && derived.some(c => !c.features.preflagged) && derived.some(c => c.features.multiEffect));
  for (const c of derived) {
    const ids = c.inputs.samples.map(s => s.id);
    assert.deepEqual(ids, [...ids].sort(), 'collection order is sorted by id (documented tie behaviour)');
    assert.equal(new Set(ids).size, ids.length);
    for (const s of c.inputs.samples) assert.ok(parseVcf(s.vcf).length >= 8);
  }
  // multi-effect records really are present in the multi-effect cases
  assert.ok(derived.filter(c => c.features.multiEffect).every(c => c.inputs.samples.some(s => /EFF=[^;\t]*\),[A-Z]/.test(s.vcf))));
});

test('worked examples (T2) come from a separate stream and never equal an evaluation case', () => {
  const evalCases = batteryInputs({ seed: 1, split: 'test', difficulty: 3 }), evalVcfs = new Set(evalCases.flatMap(c => c.inputs.samples.map(s => s.vcf)));
  const evalIds = new Set(evalCases.flatMap(c => c.inputs.samples.map(s => s.id)));
  for (let i = 0; i < 3; i++) {
    const ex = exampleCase({ seed: 1, split: 'dev', difficulty: 3, index: i });
    for (const s of ex.inputs.samples) { assert.ok(!evalVcfs.has(s.vcf)); assert.ok(!evalIds.has(s.id), `example sample id ${s.id} is also an evaluation sample id`); }
  }
});

test('what each task type shows: T1/T3 the definition, T2 the description and 3 examples, T3 the target; none shows hidden truth', () => {
  const t1 = task({ taskType: 'T1' }), t2 = task({ taskType: 'T2' }), t3 = task({ taskType: 'T3' });
  assert.deepEqual(Object.keys(t1.files).sort(), ['original/Generic-variation-analysis-reporting-tests.yml', 'original/Generic-variation-analysis-reporting.ga']);
  assert.deepEqual(Object.keys(t3.files).sort(), Object.keys(t1.files).sort());
  assert.ok(t3.budget.target.nodes <= 8 && t3.budget.target.modelCalls === 0 && /ms per job/.test(t3.prompt));
  assert.ok(!('target' in t1.budget));
  assert.ok(!Object.keys(t2.files).some(k => k.startsWith('original/')), 'T2 gets no workflow definition');
  assert.match(t2.files['description.md'], /AF Filter \(default 0\.05\): Allele Frequency Filter/);
  for (let i = 1; i <= 3; i++) for (const f of ['job.json', 'expected/all_variants_all_samples.tabular', 'expected/by_variant_report.tabular', 'expected/combined_variant_report.tabular']) assert.ok(t2.files[`examples/example-${i}/${f}`], f);
  // leakage: no row of any shipped table and no evaluation sample appears anywhere in any task text
  const hidden = [];
  for (const t of ['all_variants_all_samples', 'by_variant_report', 'combined_variant_report']) hidden.push(...fx(`shipped/${t}.tabular`).split('\n').slice(1, 40).filter(l => l.length > 30));
  hidden.push(...fx('shipped/input.vcf').split('\n').filter(l => !l.startsWith('#')).slice(0, 30));
  for (const c of batteryInputs({ seed: 1, split: 'test', difficulty: 3 }).slice(1)) for (const s of c.inputs.samples) hidden.push(s.id);
  for (const t of [t1, t2, t3]) {
    const text = t.prompt + JSON.stringify(t.inputs) + Object.values(t.files).join('\n');
    for (const h of hidden) assert.ok(!text.includes(h), `${t.taskType} leaks: ${h.slice(0, 60)}`);
  }
});

test('T2 sufficiency: every plausible fault the oracle checks is visible in at least one worked example', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const ex = [0, 1, 2].map(index => exampleCase({ seed, split: 'dev', difficulty: 3, index }));
    for (const m of MUTATIONS) assert.ok(ex.some(e => hashOf(runJob(e.inputs)) !== hashOf(runJob(e.inputs, { mutation: m }))), `${m} not visible in the examples of seed ${seed}`);
  }
});

test('controls: the reference and the original pass; the plan\'s broken controls and every other bad control fail', () => {
  const t = task();
  for (const c of item.originalControls) { const v = item.oracle(t, c.make(t)); assert.equal(v.pass, true, c.name); assert.equal(v.score, 1, c.name); assert.equal(v.details.derived.exact, N_DERIVED, c.name); }
  const must = ['empty', 'do-nothing (right headers, no rows)', 'mutation:af-boundary-inclusive', 'mutation:no-dp-alt-term', 'mutation:first-sample-only'];
  for (const n of must) assert.ok(item.badControls.some(c => c.name === n), `missing control ${n}`);
  for (const c of item.badControls) { const v = item.oracle(t, c.make(t)); assert.equal(v.pass, false, c.name); assert.ok(v.score < 1, c.name); }
});

test('kill matrix: some faults are invisible on the shipped job and only the derived cases catch them', () => {
  const t = task();
  const onlyDerived = ['af-boundary-inclusive', 'first-sample-only', 'unsorted-combined', 'one-row-per-effect'];
  for (const m of onlyDerived) {
    const v = item.oracle(t, mutationControl(m).make(t));
    assert.equal(v.details.shipped.strict, true, `${m} should pass the shipped job alone`);
    assert.equal(v.pass, false, m);
  }
  for (const m of ['no-dp-alt-term', 'text-sort-pos', 'ignore-upstream-filter', 'no-recalc-swap']) assert.equal(item.oracle(t, mutationControl(m).make(t)).details.shipped.strict, false, `${m} is caught by the shipped job`);
  // dp-boundary-inclusive: only the derived boundary records can catch it
  const dpb = item.oracle(t, mutationControl('dp-boundary-inclusive').make(t));
  assert.equal(dpb.pass, false); assert.ok(dpb.details.derived.strict <= 17);
});

test('shipped looseness is real: Galaxy lines_diff 6 accepts a corrupted cell that the strict oracle rejects', () => {
  const t = task(), v = item.diagnose(t, item.badControls.find(c => c.name === 'one-corrupted-cell').make(t));
  assert.equal(v.perCase.shipped.strict, false);
  assert.equal(v.perCase.shipped.diff6, true, 'one changed row is 2 diff lines, within the shipped lines_diff of 6');
  assert.equal(v.details.derived.diff6, N_DERIVED);
});

test('oracle tolerance: CRLF and a missing final newline are accepted; ties inside a sort key may be reordered; real reordering is not', () => {
  const tk = task(), s = shippedCase();
  const out = item.referenceSolve(tk).cases.shipped;
  const crlf = { ...out, all_variants_all_samples: out.all_variants_all_samples.replace(/\n$/, '').replace(/\n/g, '\r\n') };
  assert.equal(judgeCase(expectedOf(battery(tk)[0]), crlf).strict, true);
  assert.equal(judgeCase(expectedOf(battery(tk)[0]), crlf).exact, true, 'line endings are normalised before the exact comparison too');
  // ties: loosen thresholds so that the two records at POS 32029 / 135598 / 177899 pass, then swap them
  const raw = s.inputs.samples[0].vcf.split('\n').map(l => { if (!l || l.startsWith('#')) return l; const f = l.split('\t'); f[6] = f[6].replace(/;?min_af_[^;]*/g, '') || 'PASS'; return f.join('\t'); }).join('\n');
  const job = { params: { af: 0.02, dp: 1, dp_alt: 3 }, samples: [{ id: s.inputs.samples[0].id, vcf: raw }] };
  const exp = runJob(job), swap = text => { const ls = text.split('\n'); const i = ls.findIndex((l, k) => k > 1 && l.split('\t')[0] === ls[k - 1].split('\t')[0] && ls[k - 1] !== l); [ls[i - 1], ls[i]] = [ls[i], ls[i - 1]]; return ls.join('\n'); };
  const byVar = swap(exp.by_variant_report);
  assert.notEqual(byVar, exp.by_variant_report);
  assert.equal(compareTable('by_variant_report', exp.by_variant_report, byVar).strict, true);
  assert.equal(compareTable('by_variant_report', exp.by_variant_report, byVar).exact, false);
  const lines = exp.by_variant_report.split('\n'), moved = [lines[0], lines[5], lines[2], lines[3], lines[4], lines[1], ...lines.slice(6)].join('\n');
  assert.equal(compareTable('by_variant_report', exp.by_variant_report, moved).strict, false);
  assert.equal(compareTable('all_variants_all_samples', exp.all_variants_all_samples, swap(exp.all_variants_all_samples)).strict, false, 'unsorted tables must match line for line');
  assert.equal(compareTable('combined_variant_report', exp.combined_variant_report, 'x').level, 'fail');
  assert.equal(diffLineCount(['a', 'b', 'c'], ['a', 'x', 'c']), 2);
});

test('oracle rejects schema-invalid and incomplete output', () => {
  const t = task(), good = item.referenceSolve(t);
  const bad = [null, 7, 'x', [], {}, { cases: [] }, { cases: null },
    { cases: { ...good.cases, shipped: 'a string' } }, { cases: { ...good.cases, shipped: { ...good.cases.shipped, af_recalculated: 'not an object' } } },
    { cases: { ...good.cases, shipped: { ...good.cases.shipped, by_variant_report: 3 } } },
    { cases: { ...good.cases, shipped: { ...good.cases.shipped, af_recalculated: {} } } },
    { cases: { ...good.cases, shipped: { ...good.cases.shipped, af_recalculated: { ...good.cases.shipped.af_recalculated, 'extra sample': 'x\n' } } } }];
  for (const o of bad) { const v = item.oracle(t, o); assert.equal(v.pass, false, JSON.stringify(o)?.slice(0, 80)); }
  const missing = structuredClone(good); delete missing.cases['derived-07'];
  const v = item.oracle(t, missing);
  assert.equal(v.details.derived.strict, N_DERIVED - 1); assert.equal(v.pass, true, '19/20 derived still meets the 18/20 rule');
  const two = structuredClone(missing); delete two.cases['derived-08']; delete two.cases['derived-09'];
  assert.equal(item.oracle(t, two).pass, false, '17/20 derived does not');
  assert.equal(item.oracle(t, { cases: Object.fromEntries(Object.entries(good.cases).filter(([k]) => k !== 'shipped')) }).pass, false, 'the shipped job is mandatory');
});

test('self-reported cost never changes the verdict', () => {
  const t = task(), good = item.referenceSolve(t), bad = mutationControl('first-sample-only').make(t);
  assert.equal(item.oracle(t, { ...good, meta: { nodes: 1, modelCalls: 99, wallMs: 1 } }).pass, true);
  assert.equal(item.oracle(t, { ...bad, meta: { nodes: 1, modelCalls: 0, wallMs: 1 } }).pass, false);
});

test('oracle health over 20 seeds at difficulty 3: the reference and the original pass, every bad control fails', () => {
  const originalControl = item.originalControls[1];
  for (let seed = 1; seed <= 20; seed++) {
    const t = item.generate({ seed, split: 'test', difficulty: 3, taskType: 'T1' });
    const ref = item.oracle(t, item.referenceSolve(t));
    assert.equal(ref.pass, true, `reference, seed ${seed}`); assert.equal(ref.score, 1);
    if (seed <= 5) assert.equal(item.oracle(t, originalControl.make(t)).pass, true, `original, seed ${seed}`);
    for (const c of item.badControls) assert.equal(item.oracle(t, c.make(t)).pass, false, `${c.name}, seed ${seed}`);
  }
});

test('reference passes and bad controls fail at every difficulty; limits: generate and oracle < 2 s and < 200 MB at difficulty 5', () => {
  for (const d of [1, 2, 4, 5]) {
    const t = item.generate({ seed: 3, split: 'dev', difficulty: d, taskType: 'T2' });
    assert.equal(item.oracle(t, item.referenceSolve(t)).pass, true, `d${d}`);
    for (const c of item.badControls) assert.equal(item.oracle(t, c.make(t)).pass, false, `${c.name} d${d}`);
  }
  // cold, in a fresh process so earlier tests' caches do not count
  const probe = `
    import * as item from ${JSON.stringify(new URL('./index.mjs', import.meta.url).href)};
    import { batteryInputs } from ${JSON.stringify(new URL('./cases.mjs', import.meta.url).href)};
    import { runJob } from ${JSON.stringify(new URL('./reference.mjs', import.meta.url).href)};
    const t0 = Date.now(), t = item.generate({ seed: 11, split: 'test', difficulty: 5, taskType: 'T2' }), tGen = Date.now() - t0;
    const answer = { cases: Object.fromEntries(batteryInputs({ seed: 11, split: 'test', difficulty: 5 }).map(c => [c.caseId, runJob(c.inputs)])) };
    const t1 = Date.now(), v = item.oracle(t, answer), tOracle = Date.now() - t1;
    console.log(JSON.stringify({ pass: v.pass, tGen, tOracle, heapMB: process.memoryUsage().heapUsed / 1048576, rssMB: process.memoryUsage().rss / 1048576 }));`;
  const r = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' }));
  assert.equal(r.pass, true);
  assert.ok(r.tGen < 2000, `generate ${r.tGen} ms`); assert.ok(r.tOracle < 2000, `oracle ${r.tOracle} ms`);
  assert.ok(r.heapMB < 200, `heap ${r.heapMB} MB`);
});

test('command candidates plug in: JSON on stdin, JSON on stdout; failures become missing cases', () => {
  const t = item.generate({ seed: 2, split: 'dev', difficulty: 1, taskType: 'T3' });
  const cli = new URL('./reference-cli.mjs', import.meta.url).pathname;
  const ok = runCommandCandidate(t, process.execPath, [cli]);
  assert.equal(ok.pass, true); assert.deepEqual(ok.details.candidateErrors, {});
  const crash = runCommandCandidate(t, process.execPath, ['-e', 'process.exit(3)']);
  assert.equal(crash.pass, false); assert.equal(Object.keys(crash.details.candidateErrors).length, 1 + N_DERIVED);
  const junk = runCommandCandidate(t, process.execPath, ['-e', 'console.log("not json")']);
  assert.equal(junk.pass, false); assert.match(Object.values(junk.details.candidateErrors)[0], /not JSON/);
});

test('runCandidate: an in-process candidate that throws on some jobs fails by the rule; it never sees the case id', async () => {
  const t = task();
  const failOn = bad => { let n = 0; return inputs => { assert.deepEqual(Object.keys(inputs), ['params', 'samples']); if (bad.includes(n++)) throw new Error('boom'); return runJob(inputs); }; };
  // call order is evalInputs order: 0 = shipped, 1 = derived-00, ...
  const flaky = await item.runCandidate(t, failOn([4, 5, 6]));
  assert.equal(flaky.pass, false); assert.deepEqual(Object.keys(flaky.details.candidateErrors).sort(), ['derived-03', 'derived-04', 'derived-05']);
  const one = await item.runCandidate(t, failOn([4]));
  assert.equal(one.pass, true, '19/20');
  const noShipped = await item.runCandidate(t, failOn([0]));
  assert.equal(noShipped.pass, false, 'the shipped job is mandatory');
});

test('fixtures are the pinned originals (sha256) and the licence travels with them', () => {
  const sha = rel => execFileSync('sha256sum', [new URL(`./fixtures/${rel}`, import.meta.url).pathname], { encoding: 'utf8' }).split(' ')[0];
  assert.equal(sha('original/Generic-variation-analysis-reporting.ga'), item.corpusItem.rawSha256);
  assert.equal(loadGa().license, 'MIT');
  assert.match(fx('PROVENANCE.md'), /MIT/);
  assert.match(fx('PROVENANCE.md'), /fc190a435262bb61ba29f316e987aa492eb5d18b/);
});

test('original control availability is recorded, not assumed (diagnostic)', t => {
  const present = ['planemo', 'galaxy', 'datamash', 'SnpSift', 'snpEff'].filter(bin => { try { execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' }); return true; } catch { return false; } });
  t.diagnostic(`original-run tools on PATH: ${present.length ? present.join(', ') : 'none'} (README "Original control" records why the .ga is emulated)`);
});
