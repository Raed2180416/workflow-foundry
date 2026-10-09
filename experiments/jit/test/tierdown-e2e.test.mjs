// tierdown-e2e.mjs at $0: the source rewrite (only the target judge's tiers change, ambiguity is refused), the comparison
// math, the dev-only rule, and the replay loop with scripted dependencies. One test runs the real runCompiled in the B1
// sandbox against a scripted model port (skipped without user namespaces).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { findJudges, rewriteJudgeTiers, compareTask, summarize, markdown, judgeStats, assertDev, parseTaskKey, tierdownE2E, readArchived, TierdownError, tokenize } from '../tierdown-e2e.mjs';

const HAIKU = 'claude-haiku-5-5', SONNET = 'claude-sonnet-5-5', OPUS = 'claude-opus-5-5';
const MODELS = [HAIKU, SONNET, OPUS];
const NEW = [HAIKU, SONNET];
const sha = t => createHash('sha256').update(t).digest('hex');
const tmp = t => { const d = mkdtempSync(path.join(tmpdir(), 'tierdown-e2e-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const refuses = (fn, code, re) => assert.throws(fn, e => e instanceof TierdownError && e.code === code && (!re || re.test(e.message)), `expected ${code}`);
const refusesAsync = (p, code) => assert.rejects(p, e => e instanceof TierdownError && e.code === code, `expected ${code}`);

// Two judges: `alpha` with an inline literal, `beta-${i}` (one call site, many instances) through a shared const.
// The comment, the string and the regex mention judge( and tiers but are not calls.
const SOLVE = `import { createFlow } from './tools/flow.mjs';
const TIERS = ['${HAIKU}', '${SONNET}'];
const S = { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] };
const flow = createFlow({ budgetUsd: 1 });
const task = flow.input();
// flow.judge('alpha', { tiers: ['${HAIKU}'] }) in a comment is not a call
const note = "flow.judge('alpha', { tiers: [] })";
const re = /['"\`]judge\\(/g;
const ratio = task.inputs.rows.length / 2 / 1;
const a = await flow.judge('alpha', {
  tiers: ['${OPUS}'], system: \`sys \${\`nested \${note.length}\`}\`, prompt: 'classify ' + task.inputs.rows.length + (re.test(note) ? '' : '') + ratio, schema: S,
  check: v => (/^[a-z]+$/.test(v.label) ? null : 'bad label'),
});
const bs = await flow.map(task.inputs.rows, (r, i) => flow.judge(\`beta-\${i}\`, { tiers: TIERS, system: 's', prompt: 'row ' + r, schema: S }), { concurrency: 2 });
flow.done({ records: task.inputs.rows.map((id, i) => ({ id, label: a.label, kind: bs[i].label })) });
`;
const SCHEMA = { type: 'object', required: ['records'], properties: { records: { type: 'array', items: { type: 'object' } } } };

// ---------------------------------------------------------------------------------------------- rewrite
test('findJudges: two call sites, literal and const-bound tiers resolved; comments, strings, regexes and templates are skipped', () => {
  const { sites, unrecognized } = findJudges(SOLVE);
  assert.deepEqual(unrecognized, []);
  assert.deepEqual(sites.map(s => [s.pattern, s.receiver, s.tiers.kind, s.tiers.values, s.error]), [
    ['alpha', 'flow', 'literal', [OPUS], null],
    ['beta-*', 'flow', 'identifier', [HAIKU, SONNET], null],
  ]);
  assert.equal(sites[1].tiers.binding.line, 2);
  assert.ok(tokenize(SOLVE).toks.some(t => t.type === 'regex' && t.value.startsWith('/[\'"`]judge')));
});

test('rewrite of alpha changes only alpha: one span, the shared const and beta untouched, node --check passes', () => {
  const r = rewriteJudgeTiers(SOLVE, 'alpha', NEW);
  assert.equal(r.pattern, 'alpha'); assert.equal(r.scope, 'one judge');
  assert.deepEqual(r.oldTiers, [OPUS]); assert.deepEqual(r.newTiers, NEW);
  assert.equal(r.diff.length, 1); assert.equal(r.diff[0].line, 11);
  assert.match(r.diff[0].before, /tiers: \['claude-opus-5-5'\]/); assert.match(r.diff[0].after, /tiers: \['claude-haiku-5-5', 'claude-sonnet-5-5'\]/);
  assert.match(r.unified, /^@@ line 11 @@\n-  tiers: \['claude-opus-5-5'\]/);
  // Exactly one contiguous change, inside alpha's tiers literal.
  const a = SOLVE, b = r.source;
  let p = 0; while (a[p] === b[p]) p++;
  let s = 0; while (a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const lit = a.indexOf(`['${OPUS}']`);
  assert.ok(lit <= p && a.length - s <= lit + `['${OPUS}']`.length, 'the only changed bytes are inside alpha\'s tiers literal');
  const again = findJudges(b).sites;
  assert.deepEqual(again[0].tiers.values, NEW);
  assert.equal(again[1].tiers.text, 'TIERS'); assert.deepEqual(again[1].tiers.values, [HAIKU, SONNET]);
  assert.deepEqual(r.otherJudges, [{ pattern: 'beta-*', line: 14, tiers: [HAIKU, SONNET] }]);
  assert.equal(r.originalSha256, sha(SOLVE)); assert.equal(r.variantSha256, sha(b));
});

test('rewrite of a templated judge by instance name: the call site gets a literal, the shared const stays for the others', () => {
  for (const name of ['beta-1', 'beta-*']) {
    const r = rewriteJudgeTiers(SOLVE, name, [SONNET]);
    assert.equal(r.pattern, 'beta-*'); assert.equal(r.scope, 'every instance of beta-*');
    assert.deepEqual(r.oldTiers, [HAIKU, SONNET]);
    assert.equal(r.diff[0].was, 'TIERS'); assert.deepEqual(r.diff[0].binding, { name: 'TIERS', line: 2, text: `['${HAIKU}', '${SONNET}']` });
    assert.ok(r.source.includes(`const TIERS = ['${HAIKU}', '${SONNET}'];`));
    assert.ok(r.source.includes(`flow.judge(\`beta-\${i}\`, { tiers: ['${SONNET}'], system: 's'`));
    assert.ok(r.source.includes(`tiers: ['${OPUS}'], system:`), 'alpha untouched');
  }
});

test('string concatenation names and shorthand tiers bound to a const literal are located', () => {
  const src = `const flow = createFlow();
const VT = ['${HAIKU}'];
for (let i = 0; i < 2; i++) await flow.judge('vendex-' + i, { tiers: VT, prompt: 'p', schema: {} });
async function rules() {
  const tiers = ['${OPUS}'];
  return flow.judge("rules", { system: 's', tiers, schema: {} });
}
`;
  assert.deepEqual(findJudges(src).sites.map(s => s.pattern), ['vendex-*', 'rules']);
  const r = rewriteJudgeTiers(src, 'vendex-0', [SONNET]);
  assert.ok(r.source.includes(`flow.judge('vendex-' + i, { tiers: ['${SONNET}'], prompt`));
  const r2 = rewriteJudgeTiers(src, 'rules', [HAIKU, SONNET]);
  assert.ok(r2.source.includes(`{ system: 's', tiers: ['${HAIKU}', '${SONNET}'], schema: {} }`));
  assert.ok(r2.source.includes(`const tiers = ['${OPUS}'];`));
  assert.equal(r2.diff[0].binding.name, 'tiers');
});

test('refusals: anything that cannot be located unambiguously is refused, never guessed', () => {
  const j = (name, opts) => `await flow.judge(${name}, ${opts});`;
  const base = `const flow = createFlow();\nconst T = ['${HAIKU}'];\n`;
  const cases = [
    [`const tiers = big ? ['${HAIKU}'] : ['${SONNET}'];\n` + j("'g'", '{ tiers, schema: {} }'), 'g', 'TIERS_UNRESOLVED', /not bound to an array literal/],
    [j("'g'", `{ tiers: big ? ['${HAIKU}'] : ['${SONNET}'], schema: {} }`), 'g', 'TIERS_UNRESOLVED', /not an array literal or an identifier/],
    [j("'g'", `{ tiers: T.slice(1), schema: {} }`), 'g', 'TIERS_UNRESOLVED', /not an array literal/],
    [j("'alpha'", '{ tiers: T }') + j('name', '{ tiers: T }'), 'alpha', 'AMBIGUOUS', /computed name/],
    [j('`x-${a}`', '{ tiers: T }') + j("'x-1'", '{ tiers: T }'), 'x-1', 'AMBIGUOUS', /different call sites/],
    [j("'g'", 'opts'), 'g', 'TIERS_UNRESOLVED', /not an object literal/],
    [j("'g'", '{ tiers: T, ...extra }'), 'g', 'TIERS_UNRESOLVED', /spread \.\.\.extra after tiers/],
    [`const extra = { schema: {}, tiers: ['${OPUS}'] };\n` + j("'g'", '{ tiers: T, ...extra }'), 'g', 'TIERS_UNRESOLVED', /could override/],
    [`const extra = { ...more };\n` + j("'g'", '{ tiers: T, ...extra }'), 'g', 'TIERS_UNRESOLVED', /could override/],
    [j("'g'", '{ tiers: T, ...f() }'), 'g', 'TIERS_UNRESOLVED', /could override/],
    [j("'g'", '{ [k]: T, tiers: T }'), 'g', 'TIERS_UNRESOLVED', /computed/],
    [j("'g'", `{ tiers: T, tiers: ['${SONNET}'] }`), 'g', 'TIERS_UNRESOLVED', /2 tiers properties/],
    [j("'g'", '{ schema: {} }'), 'g', 'TIERS_UNRESOLVED', /0 tiers properties/],
    [`function f() { const T = ['${OPUS}']; return T; }\n` + j("'g'", '{ tiers: T }'), 'g', 'TIERS_UNRESOLVED', /declared 2 times/],
    [`T = ['${OPUS}'];\n` + j("'g'", '{ tiers: T }'), 'g', 'TIERS_UNRESOLVED', /assigned/],
    [`T.push('${OPUS}');\n` + j("'g'", '{ tiers: T }'), 'g', 'TIERS_UNRESOLVED', /mutated/],
    [`const run = (T) => flow.judge('g', { tiers: T });\n`, 'g', 'TIERS_UNRESOLVED', /parameter/],
    [`const j2 = flow.judge.bind(flow);\n` + j("'g'", '{ tiers: T }'), 'g', 'UNRECOGNIZED_JUDGE_USE', /bind/],
    [j("'g'", '{ tiers: T }'), 'zeta', 'JUDGE_NOT_FOUND', /judges: g/],
    [j("'g'", '{ tiers: T }'), 'g', 'BAD_TIERS', null, ['Not A Model!']],
    [j("'g'", '{ tiers: T }'), 'g', 'SAME_TIERS', null, [HAIKU]],
    [j("'g'", '{ tiers: T '), 'g', 'PARSE', /unclosed|unbalanced/],
  ];
  for (const [body, name, code, re, tiers = [SONNET]] of cases) refuses(() => rewriteJudgeTiers(base + body, name, tiers), code, re);
  // a spread after tiers of a const object literal without tiers is safe (kinetics opus v1: { tiers: [...], ...judgeArgs })
  const spread = rewriteJudgeTiers(base + `const args = { system: 's', schema: {}, check: v => null };\n` + j("'g'", '{ tiers: T, ...args }'), 'g', [SONNET]);
  assert.ok(spread.source.includes(`{ tiers: ['${SONNET}'], ...args }`));
  // an unrelated judge with a dynamic tiers expression does not block a rewrite of a well-formed one
  const ok = rewriteJudgeTiers(base + j("'g'", `{ tiers: T }`) + j("'h'", `{ tiers: big ? T : T }`), 'g', [SONNET]);
  assert.equal(ok.diff.length, 1);
});

// ---------------------------------------------------------------------------------------------- comparison math
const ev = (name, costUsd, tier, tried = [tier]) => ({ kind: 'judge', name, ok: true, tier, costUsd, escalations: tried.length - 1, tiersTried: tried.map(model => ({ model, ok: true })) });
test('compareTask: exact, order-insensitive and partial agreement (original is the reference), judge cost by pattern, off-list tiers', () => {
  const o = { status: 'ok', output: { records: [{ id: 1, l: 'a' }, { id: 2, l: 'b' }] }, costUsd: 0.05, trace: [ev('alpha', 0.03, OPUS), ev('beta-0', 0.001, HAIKU), ev('beta-1', 0.002, HAIKU)] };
  const v = { status: 'ok', output: { records: [{ id: 2, l: 'b' }, { id: 1, l: 'x' }] }, costUsd: 0.01, trace: [ev('alpha', 0.004, SONNET, [HAIKU, SONNET]), ev('beta-0', 0.001, OPUS)] };
  const c = compareTask(o, v, { pattern: 'alpha', oldTiers: [OPUS], newTiers: NEW });
  assert.equal(c.exact, false); assert.equal(c.exactUnordered, false); assert.equal(c.partial, 0.75);
  assert.deepEqual(c.judgeUsd, { original: 0.03, variant: 0.004 }); assert.deepEqual(c.costUsd, { original: 0.05, variant: 0.01 });
  assert.deepEqual(c.judge.variant.tiersUsed, { [SONNET]: 1 }); assert.equal(c.judge.variant.escalations, 1); assert.equal(c.judge.variant.offList, 0);
  const reordered = compareTask(o, { ...v, output: { records: [o.output.records[1], o.output.records[0]] } }, { pattern: 'alpha' });
  assert.equal(reordered.exact, false); assert.equal(reordered.exactUnordered, true); assert.equal(reordered.partial, 1);
  const beta = judgeStats(o.trace, 'beta-*', [SONNET]);
  assert.equal(beta.calls, 2); assert.equal(beta.costUsd, 0.003); assert.equal(beta.offList, 2);
  const deopt = compareTask({ ...o, status: 'deopt', output: null }, v, { pattern: 'alpha' });
  assert.equal(deopt.exact, null); assert.equal(deopt.partial, null); assert.equal(deopt.bothOk, false);
});

test('summarize: rates over both-ok and over all, transitions, oracle flips and cost deltas', () => {
  const mk = (so, sv, oo, ov, jo, jv, co, cv, exact, partial) => ({ compare: { statuses: { original: so, variant: sv }, bothOk: so === 'ok' && sv === 'ok', exact, exactUnordered: exact, partial,
    judge: { original: { calls: 1, tiersUsed: { [OPUS]: 1 }, offList: 0 }, variant: { calls: 1, tiersUsed: { [HAIKU]: 1 }, offList: 0 } }, judgeUsd: { original: jo, variant: jv }, costUsd: { original: co, variant: cv } },
    oracle: { original: oo, variant: ov } });
  const P = s => ({ pass: true, score: s }), F = s => ({ pass: false, score: s });
  const s = summarize([
    mk('ok', 'ok', P(1), P(1), 0.03, 0.001, 0.04, 0.011, true, 1),
    mk('ok', 'ok', P(1), F(0.5), 0.03, 0.002, 0.04, 0.012, false, 0.5),
    mk('deopt', 'ok', F(0), P(0.9), 0.03, 0.001, 0.035, 0.01, null, null),
  ]);
  assert.equal(s.compared, 3); assert.equal(s.bothOk, 2); assert.equal(s.exact, 1);
  assert.equal(s.exactRateBothOk, 0.5); assert.equal(s.exactRateAll, 0.333333); assert.equal(s.meanPartialBothOk, 0.75);
  assert.deepEqual(s.transitions, { 'ok->ok': 2, 'deopt->ok': 1 });
  assert.deepEqual(s.original.statuses, { ok: 2, deopt: 1 }); assert.deepEqual(s.variant.statuses, { ok: 3 });
  assert.equal(s.original.judgeUsd, 0.09); assert.equal(s.variant.judgeUsd, 0.004); assert.equal(s.original.meanJudgeUsd, 0.03);
  assert.equal(s.delta.judgeUsd, -0.086); assert.equal(s.delta.totalUsd, -0.082);
  assert.equal(s.delta.passToFail, 1); assert.equal(s.delta.failToPass, 1); assert.equal(s.delta.meanScore, 0.133333);
  assert.deepEqual(s.original.oracle, { n: 3, pass: 2, passRate: 0.666667, meanScore: 0.666667 });
  assert.deepEqual(s.variant.tiersUsed, { [HAIKU]: 3 });
});

// ---------------------------------------------------------------------------------------------- dev only
test('assertDev and taskKey parsing', () => {
  assert.deepEqual(parseTaskKey('records:dev:d3:s204'), { familyId: 'records', split: 'dev', difficulty: 3, seed: 204 });
  assert.equal(parseTaskKey('nope'), null);
  assertDev({ split: 'dev', seed: 204, where: 'x' });
  refuses(() => assertDev({ split: 'test', seed: 7003, where: 'x' }), 'TEST_SPLIT');
  refuses(() => assertDev({ split: null, seed: 7001, where: 'x' }), 'TEST_SPLIT');
  refuses(() => assertDev({ split: undefined, seed: 201, where: 'x' }), 'NOT_DEV');
});

// ---------------------------------------------------------------------------------------------- the replay loop with fakes
const EXP = 'jit-dev-fake-1', SLUG = 'jit-claude-sonnet-5-5--claude-haiku-5-5';
const taskOf = seed => ({ id: `fake:dev:d3:${seed}`, seed, prompt: `task ${seed}`, inputs: { rows: [seed, seed + 1, seed + 2] } });
const view = task => JSON.stringify({ prompt: task.prompt, inputs: task.inputs });
const outOf = (seed, label) => ({ records: taskOf(seed).inputs.rows.map(id => ({ id, label, kind: 'std' })) });

function fixtureArm(t, { split = 'dev', keys = null } = {}) {
  const root = tmp(t);
  const armDir = path.join(root, 'work', EXP, SLUG), runDir = path.join(root, 'runs', EXP, SLUG);
  mkdirSync(path.join(runDir, 'versions', 'v1-haiku55'), { recursive: true });
  writeFileSync(path.join(runDir, 'versions', 'v1-haiku55', 'solve.mjs'), SOLVE);
  writeFileSync(path.join(runDir, 'arm.json'), JSON.stringify({ experiment: EXP, spec: 'jit:claude-sonnet-5-5/claude-haiku-5-5', slug: SLUG, kind: 'jit',
    def: { familyId: 'fake', split, perTaskUsd: 1, models: [HAIKU, OPUS, SONNET], compiledMinutes: 1 } }));
  const rows = [3, 4, 5].map(idx => ({ experiment: EXP, idx, taskKey: keys?.[idx] ?? `fake:${split}:d3:s${200 + idx}`, taskHash: `h${200 + idx}`, compiledStatus: idx === 4 ? 'deopt' : 'ok' }));
  writeFileSync(path.join(runDir, 'results.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const dir = (name, idx, solve, files) => {
    const d = path.join(armDir, name); mkdirSync(path.join(d, 'tools'), { recursive: true });
    writeFileSync(path.join(d, 'solve.mjs'), solve); writeFileSync(path.join(d, 'task.json'), view(taskOf(200 + idx)));
    for (const [f, c] of Object.entries(files)) writeFileSync(path.join(d, f), c);
    return d;
  };
  const trace = (...evs) => evs.map(e => JSON.stringify(e)).join('\n') + '\n';
  // #3 ok (alpha on Opus), #4 deopted, #5 ran another version, #6 has no results row; an older #3 dir is ignored.
  const old = dir('i003-compiled-000000', 3, SOLVE, { '.solve.stdout': JSON.stringify({ records: [] }) + '\n' });
  utimesSync(old, new Date(2000, 1, 1), new Date(2000, 1, 1));
  dir('i003-compiled-aaaaaa', 3, SOLVE, { '.solve.stdout': 'progress\n' + JSON.stringify(outOf(203, 'vip')) + '\n',
    'trace.jsonl': trace(ev('alpha', 0.03, OPUS), ev('beta-0', 0.001, HAIKU), { kind: 'done', name: 'done', spentUsd: 0.031 }),
    'tools/calls.jsonl': trace({ ok: true, costUsd: 0.03 }, { ok: true, costUsd: 0.001 }) });
  dir('i004-compiled-bbbbbb', 4, SOLVE, { 'deopt.json': JSON.stringify({ kind: 'judge', name: 'beta-1' }), 'trace.jsonl': trace(ev('alpha', 0.03, OPUS)), 'tools/calls.jsonl': trace({ ok: true, costUsd: 0.03 }) });
  dir('i005-compiled-cccccc', 5, SOLVE.replace('budgetUsd: 1', 'budgetUsd: 2'), { '.solve.stdout': JSON.stringify(outOf(205, 'vip')) });
  dir('i006-compiled-dddddd', 6, SOLVE, {});
  return { root, armDir, runDir, workRoot: path.join(root, 'out') };
}

function fakeDeps({ runCost = 0.002, onRun = () => {} } = {}) {
  const calls = { runCompiled: [], makeTasks: [], port: null };
  const deps = {
    policyIds: [...MODELS], validateOutput: (schema, out) => ({ valid: Array.isArray(out?.records) }),
    loadFamily: async () => ({ outputSchema: SCHEMA }),
    makeTasks: async (familyId, { split, seeds, difficulty }) => { calls.makeTasks.push({ split, seeds }); return seeds.map(seed => ({ task: taskOf(seed), taskKey: `${familyId}:${split}:d${difficulty}:s${seed}`, taskHash: `h${seed}` })); },
    score: async (familyId, task, output) => { const pass = output.records.every(r => r.label === 'vip'); return { pass, score: pass ? 1 : 0.5 }; },
    createModelPort: async a => { calls.port = a; return { port: { call: async () => ({ ok: true }) }, db: { close() { calls.closed = true; } } }; },
    async runCompiled(a) {
      const src = readFileSync(a.solvePath, 'utf8'), variant = src.includes(`tiers: ['${HAIKU}', '${SONNET}'], system: \`sys`);
      calls.runCompiled.push({ variant, perTaskUsd: a.perTaskUsd, workdir: a.workdir, allowedModels: a.allowedModels, idx: a.task.seed - 200 });
      onRun(a);
      return { status: 'ok', output: outOf(a.task.seed, variant ? 'std' : 'vip'), deopt: null, costUsd: runCost, costUnknown: false,
        trace: variant ? [ev('alpha', 0.0005, HAIKU), ev('beta-0', 0.001, HAIKU)] : [ev('alpha', 0.03, OPUS)] };
    },
  };
  return { deps, calls };
}

test('replay: archived originals reused when they ran this sha, variants run fresh, oracle and costs compared, files written', async t => {
  const f = fixtureArm(t), { deps, calls } = fakeDeps();
  const report = await tierdownE2E({ armDir: f.armDir, version: 'v1-haiku55', judge: 'alpha', tiers: NEW.join(','), capUsd: 1, runRoot: path.join(f.root, 'runs'), workRoot: f.workRoot, label: 'unit' }, deps);
  assert.deepEqual(report.tasks.map(x => [x.idx, x.skipped ?? x.originalSource]), [[3, 'archived'], [4, 'archived'], [6, 'no results row with a taskKey for this idx']]);
  assert.deepEqual(calls.runCompiled.map(c => [c.idx, c.variant]), [[3, true], [4, true]], 'only the variants ran; #5 ran another version');
  assert.deepEqual(calls.port.allowedModels.sort(), [...MODELS].sort());
  assert.ok(calls.closed);
  const [t3, t4] = report.tasks;
  assert.equal(t3.dir.endsWith('i003-compiled-aaaaaa'), true, 'the latest #3 dir that ran this sha');
  assert.deepEqual(t3.compare.statuses, { original: 'ok', variant: 'ok' });
  assert.equal(t3.compare.exact, false); assert.equal(t3.compare.partial, 0.666667);
  assert.deepEqual(t3.compare.judgeUsd, { original: 0.03, variant: 0.0005 }); assert.deepEqual(t3.compare.costUsd, { original: 0.031, variant: 0.002 });
  assert.deepEqual(t3.oracle, { original: { pass: true, score: 1 }, variant: { pass: false, score: 0.5 } });
  assert.deepEqual(t4.compare.statuses, { original: 'deopt', variant: 'ok' }); assert.equal(t4.original.deopt.name, 'beta-1');
  assert.equal(report.summary.delta.passToFail, 1); assert.deepEqual(report.summary.transitions, { 'ok->ok': 1, 'deopt->ok': 1 });
  assert.equal(report.spentUsd, 0.004); assert.equal(report.rewrite.pattern, 'alpha');
  const out = path.join(f.workRoot, 'unit');
  for (const file of ['report.json', 'report.md', 'rewrite.json', 'rewrite.diff', 'original.solve.mjs', 'variant/solve.mjs']) assert.ok(existsSync(path.join(out, file)), file);
  assert.equal(readFileSync(path.join(out, 'original.solve.mjs'), 'utf8'), SOLVE);
  const md = readFileSync(path.join(out, 'report.md'), 'utf8');
  assert.match(md, /\| 3 \| fake:dev:d3:s203 \| ok\* \| ok \| no \| 0\.667 \|/); assert.match(md, /pass->fail 1/);
  assert.equal(md, markdown(report));
  await refusesAsync(tierdownE2E({ armDir: f.armDir, version: 'v1-haiku55', judge: 'alpha', tiers: NEW, runRoot: path.join(f.root, 'runs'), workRoot: f.workRoot, label: 'unit' }, deps), 'EXISTS');
});

test('replay options: --rerun-original, --limit, --all-tasks, and the session cap', async t => {
  const f = fixtureArm(t);
  const go = (deps, o) => tierdownE2E({ armDir: f.armDir, version: 'v1-haiku55', judge: 'alpha', tiers: NEW, runRoot: path.join(f.root, 'runs'), workRoot: f.workRoot, force: true, ...o }, deps);
  let x = fakeDeps(); let r = await go(x.deps, { label: 'rerun', rerunOriginal: true, limit: 1 });
  assert.deepEqual(x.calls.runCompiled.map(c => [c.idx, c.variant]), [[3, false], [3, true]]);
  assert.equal(r.tasks.length, 1); assert.equal(r.tasks[0].originalSource, 'fresh'); assert.equal(r.tasks[0].compare.judgeUsd.original, 0.03);
  x = fakeDeps(); r = await go(x.deps, { label: 'all', allTasks: true });
  assert.deepEqual(r.tasks.map(t2 => [t2.idx, t2.originalSource ?? t2.skipped]), [[3, 'archived'], [4, 'archived'], [5, 'fresh'], [6, 'no results row with a taskKey for this idx']]);
  // the cap: each run costs $0.002 against a $0.003 cap -> the second variant gets only the remainder, then the loop stops
  x = fakeDeps(); r = await go(x.deps, { label: 'cap', capUsd: 0.003, allTasks: true });
  assert.deepEqual(x.calls.runCompiled.map(c => [c.idx, c.perTaskUsd]), [[3, 0.003], [4, 0.001]]);
  assert.equal(r.tasks.find(t2 => t2.idx === 5).skipped, 'cap reached'); assert.match(r.stopped, /cap \$0\.003 reached/);
  // dry: the rewrite and the task list, no model port, no runs
  x = fakeDeps(); r = await go(x.deps, { label: 'dry', dry: true });
  assert.equal(x.calls.port, null); assert.equal(x.calls.runCompiled.length, 0); assert.deepEqual(r.tasks.map(t2 => t2.idx), [3, 4, 6]);
  // tiers outside the owner policy are refused before anything runs
  await refusesAsync(go(fakeDeps().deps, { label: 'bad', tiers: ['claude-made-up-1'] }), 'BAD_TIERS');
});

test('test split: a test arm, or any test-split task row, is refused before a task is generated or run', async t => {
  for (const setup of [{ split: 'test' }, { keys: { 4: 'fake:test:d3:s7002' } }, { keys: { 5: 'fake:dev:d3:s7003' }, allTasks: true }]) {
    const f = fixtureArm(t, setup), { deps, calls } = fakeDeps();
    const p = tierdownE2E({ armDir: f.armDir, version: 'v1-haiku55', judge: 'alpha', tiers: NEW, runRoot: path.join(f.root, 'runs'), workRoot: f.workRoot, allTasks: !!setup.allTasks }, deps);
    if (setup.keys?.[5]) {   // a dev-split row with a high seed is still dev: allowed (here it fails the task.json check instead)
      const r = await p;
      assert.equal(r.tasks.find(x => x.idx === 5).skipped, 'regenerated task differs from the archived task.json');
      continue;
    }
    await refusesAsync(p, 'TEST_SPLIT');
    assert.equal(calls.makeTasks.length, 0); assert.equal(calls.runCompiled.length, 0); assert.equal(calls.port, null);
  }
});

test('readArchived: ok, deopt, crash, invalid, and unreadable directories', t => {
  const root = tmp(t);
  const mk = (name, files) => { const d = path.join(root, name); mkdirSync(path.join(d, 'tools'), { recursive: true }); for (const [f, c] of Object.entries(files)) writeFileSync(path.join(d, f), c); return d; };
  const validate = o => Array.isArray(o?.records);
  assert.equal(readArchived(mk('ok', { '.solve.stdout': 'x\n{"records":[]}\n', 'tools/calls.jsonl': '{"ok":true,"costUsd":0.01}\n{"ok":true}\n' }), { validate }).status, 'ok');
  assert.equal(readArchived(path.join(root, 'ok'), { validate }).costUnknown, true);
  assert.equal(readArchived(mk('inv', { '.solve.stdout': '{"rows":[]}\n' }), { validate }).status, 'invalid');
  assert.equal(readArchived(mk('crash', { 'trace.jsonl': '{"kind":"crash","name":"uncaught","spentUsd":0.2}\n' }), { validate }).costUsd, 0.2);
  assert.equal(readArchived(mk('dz', { 'deopt.json': '{"kind":"guard","name":"g"}' })).deopt.name, 'g');
  assert.equal(readArchived(mk('none', {})), null);
});

// ---------------------------------------------------------------------------------------------- the real sandbox
const { sandboxAvailable } = await import('../../../src/executors/claude-code.mjs');
const skip = sandboxAvailable() ? false : 'no user namespaces';
test('end to end in the B1 sandbox with the real runCompiled and flow.mjs, scripted models: only the variant moves alpha off Opus', { skip }, async t => {
  const { loadPolicy } = await import('../../../src/models/policy.mjs');
  const { ModelPort } = await import('../../../src/models/port.mjs');
  const { Journal } = await import('../../../src/journal.mjs');
  const { ScriptedProvider } = await import('../../../src/models/providers/scripted.mjs');
  const { subsetPolicy } = await import('../../lib/models.mjs');
  const { runCompiled } = await import('../run-compiled.mjs');
  const { validateOutput } = await import('../interpret.mjs');
  const LABEL = { [OPUS]: 'vip', [SONNET]: 'gold', [HAIKU]: 'std' }, COST = { [OPUS]: 0.03, [SONNET]: 0.01, [HAIKU]: 0.001 };
  const provider = new ScriptedProvider(args => ({ value: { label: LABEL[args.modelEntry.id] }, costUsd: COST[args.modelEntry.id] }));
  const port = new ModelPort({ policy: subsetPolicy(loadPolicy().policy, MODELS), journal: new Journal(new DatabaseSync(':memory:')), providers: { 'claude-cli': provider } });
  const f = fixtureArm(t);
  const deps = { ...fakeDeps().deps, validateOutput, runCompiled, createModelPort: async () => ({ port, db: null }) };
  const report = await tierdownE2E({ armDir: f.armDir, version: 'v1-haiku55', judge: 'alpha', tiers: NEW, runRoot: path.join(f.root, 'runs'), workRoot: f.workRoot, label: 'sandbox',
    rerunOriginal: true, limit: 1, capUsd: 0.5, minutes: 1 }, deps);
  const [r] = report.tasks;
  assert.deepEqual(r.compare.statuses, { original: 'ok', variant: 'ok' }, JSON.stringify(r));
  assert.equal(r.compare.exact, false);
  assert.equal(r.compare.partial, 0.666667, 'the 3 alpha labels differ, ids and beta kinds agree');
  assert.deepEqual(r.compare.judge.original.tiersUsed, { [OPUS]: 1 }); assert.deepEqual(r.compare.judge.variant.tiersUsed, { [HAIKU]: 1 });
  assert.equal(r.compare.judge.variant.offList, 0);
  assert.equal(r.compare.judgeUsd.original, 0.03); assert.equal(r.compare.judgeUsd.variant, 0.001);
  assert.equal(r.compare.costUsd.original, 0.033); assert.equal(r.compare.costUsd.variant, 0.004);
  assert.deepEqual(r.oracle, { original: { pass: true, score: 1 }, variant: { pass: false, score: 0.5 } });
  assert.equal(report.spentUsd, 0.037);
  assert.deepEqual(provider.calls.filter(c => c.prompt.startsWith('classify')).map(c => c.modelId), [OPUS, HAIKU]);
});
