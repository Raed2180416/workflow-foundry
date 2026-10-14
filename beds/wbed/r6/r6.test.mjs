// Oracle health for W-bed R6 "wide research table" (beds/CONTRACT.md rules; W-BED §2.2, §2.4, §3.6). Loaded by path; the
// registration shim beds/wbed-r6/index.mjs makes it loadable as family 'wbed-r6'. No model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as bed from './index.mjs';
import { buildWide } from './world.mjs';
import { textIndex, runPipeline } from './pipeline.mjs';
import { PROPS, MAX_FANOUT, valueText, canonOf, printedNumber, PROP_IDS } from './vocab.mjs';
import { parseDay } from './heuristic.mjs';
import { readingOrder, unseenPast, workerSlice, agentTokens, callUsd, THINKING_CAP, HAIKU_PRICE, SEQUENTIAL_BUDGET_TOKENS } from './budget.mjs';
import { voidKeys, worker, reduce } from './pipeline.mjs';
import { whiteboxSolve } from './whitebox.mjs';
import { canonical, sha256, estimateTokens } from '../lib/prng.mjs';
import { dayNum } from '../lib/domain.mjs';
import { inlineRender, loadFamily } from '../../../experiments/lib/beds.mjs';
import { portableSchemaViolations } from '../../../src/schema-subset.mjs';
import { THINKING } from '../../../src/models/port.mjs';
import { plan, runStub } from '../attacks/triviality.mjs';

const SEEDS = Array.from({ length: 20 }, (_, i) => 301 + i); // dev 301-320 (wbed-dev)
const HELD = [8201, 8202, 8301, 8302]; // wbed-heldout-a/-b (test split): generator checks only, no arm sees them
const DS = [2, 3, 4, 5];
const applies = (c, d) => d >= (c.minDifficulty ?? 0);
const hashOf = t => sha256(canonical(t));
const gen = (seed, d, split = 'dev') => bed.generate({ seed, split, difficulty: d });
const allControls = [...bed.badControls, ...bed.necessityControls];

test('exports the bed interface plus the W-specific and R6-specific exports; the shim registers wbed-r6', async () => {
  for (const k of ['family', 'outputSchema', 'generate', 'oracle', 'referenceSolve', 'badControls', 'necessityControls', 'version', 'difficulty', 'stages',
    'structure', 'relations', 'composedOracle', 'referenceTrace', 'invariants', 'unitChecks', 'codePlan', 'coverageIssues', 'keywordScript', 'textIndex', 'tokenAccounting', 'bestOfNRun',
    'planAblation', 'grepAgentRun', 'scopeOf', 'sizeOf']) assert.ok(k in bed, k);
  assert.equal(bed.family.id, 'wbed-r6');
  assert.equal(bed.version, '1.1.0');
  assert.equal(bed.family.kind, 'oneshot');
  assert.deepEqual(bed.stages.map(s => s.id), ['index', 'plan', 'worker', 'reduce']);
  for (const s of bed.stages) for (const k of ['inputSchema', 'outputSchema', 'oracle', 'project']) assert.ok(s[k], `${s.id}.${k}`);
  assert.equal(bed.structure.shape, 'planned-swarm');
  assert.equal(bed.structure.features.wideNodes, 1);
  const o = bed.structure.outline.join('\n');
  for (const re of [/flow\.wide\("wide-table"/, /plan: codePlan/, /check: .*coverageIssues/, /maxFanout: 32/, /judge in_scope/, /reduce: /, /verify: \{ panel: \{ n: 3 \}, sample: 0.2, code: unitChecks \}/]) assert.match(o, re);
  // the B6 protocol the PREREG must adopt (review 2026-10-14, findings 1, 4, 5, 6)
  for (const k of ['wideArm', 'bestOfNArm', 'budget', 'fixBeforeN', 'selectorAsymmetry', 'sizeEvidence']) assert.ok(bed.structure.b6[k], `structure.b6.${k}`);
  assert.match(bed.structure.b6.wideArm, /model-executed/);
  assert.match(bed.structure.b6.bestOfNArm, /agent solves/);
  assert.match(bed.structure.b6.budget, /thinking/);
  assert.equal((await loadFamily('wbed-r6')).family.id, 'wbed-r6');
  assert.ok(readFileSync(new URL('../../wbed-r6/index.mjs', import.meta.url), 'utf8').includes("'../wbed/r6/index.mjs'"));
});

test('output schema and stage contracts are in the portable subset', () => {
  assert.deepEqual(portableSchemaViolations(bed.outputSchema), []);
  for (const s of bed.stages) { assert.deepEqual(portableSchemaViolations(s.inputSchema), [], s.id); assert.deepEqual(portableSchemaViolations(s.outputSchema), [], s.id); }
});

test('generator is deterministic: same seed -> same task hash, also in a fresh process; split and seed salt it', () => {
  for (const d of DS) for (const seed of [301, 350]) {
    const a = gen(seed, d), b = gen(seed, d);
    assert.equal(hashOf(a), hashOf(b));
    assert.notEqual(a.inputs, b.inputs, 'each call returns a fresh object');
  }
  const here = fileURLToPath(new URL('./index.mjs', import.meta.url));
  const code = `const m = await import(${JSON.stringify(here)}); const { canonical, sha256 } = await import(${JSON.stringify(fileURLToPath(new URL('../lib/prng.mjs', import.meta.url)))});`
    + `console.log(JSON.stringify([[301,3],[302,5],[303,2]].map(([s,d]) => sha256(canonical(m.generate({ seed: s, split: 'dev', difficulty: d }))))));`;
  const fresh = JSON.parse(execFileSync(process.execPath, ['--max-old-space-size=1024', '--input-type=module', '-e', code], { encoding: 'utf8' }));
  assert.deepEqual(fresh, [[301, 3], [302, 5], [303, 2]].map(([s, d]) => hashOf(gen(s, d))));
  assert.notEqual(hashOf(gen(301, 3)), hashOf(gen(301, 3, 'test')));
  assert.notEqual(hashOf(gen(301, 3)), hashOf(gen(302, 3)));
});

test('review finding 9: the world cannot be built without the decisiveness verifier (fresh process, world.mjs alone)', () => {
  const world = fileURLToPath(new URL('./world.mjs', import.meta.url));
  const code = `const m = await import(${JSON.stringify(world)}); try { m.buildWide(301, 'dev', 3); console.log('built'); } catch (e) { console.log(String(e.message)); }`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }).trim();
  assert.match(out, /needs the decisiveness verifier/);
});

// ---------------------------------------------------------------------------------------------------------------------
const meanScore = {};
for (const d of DS) {
  test(`d${d}: referenceSolve passes; every applicable bad and necessity control fails (${SEEDS.length} seeds)`, t => {
    let redraws = 0;
    for (const seed of SEEDS) {
      const task = gen(seed, d);
      redraws += buildWide(seed, 'dev', d).attempt;
      const ref = bed.oracle(task, bed.referenceSolve(task));
      assert.ok(ref.pass, `reference fails seed ${seed}: ${JSON.stringify(ref.details).slice(0, 300)}`);
      for (const c of allControls.filter(x => applies(x, d))) {
        const o = bed.oracle(task, c.make(task));
        assert.equal(o.pass, false, `control ${c.name} passes seed ${seed} d${d}`);
        (meanScore[c.name] ??= {})[d] = ((meanScore[c.name][d] ?? 0) + o.score / SEEDS.length);
      }
    }
    t.diagnostic(`d${d}: generator re-draws over ${SEEDS.length} seeds: ${redraws}`);
    if (d === 5) t.diagnostic(`mean oracle score per control (d2..d5): ${JSON.stringify(Object.fromEntries(Object.entries(meanScore).map(([k, v]) => [k, DS.map(x => (v[x] === undefined ? null : Math.round(v[x] * 100) / 100))])))}`);
  });
}

test('held-out seeds (test split, wbed-heldout-a/-b): reference passes, controls fail, the d5 tier is novel-test', () => {
  for (const d of [3, 5]) for (const seed of HELD) {
    const task = gen(seed, d, 'test');
    assert.ok(bed.oracle(task, bed.referenceSolve(task)).pass);
    for (const c of allControls.filter(x => applies(x, d))) assert.equal(bed.oracle(task, c.make(task)).pass, false, `${c.name} s${seed} d${d}`);
    assert.equal(bed.scopeOf(task).tier, d === 5 ? 'novel-test' : 'dev');
  }
});

// ---------------------------------------------------------------------------------------------------------------------
test('the world is what the stated rules decide: construction = resolver; roles = scope; candidates = in-scope + T1-T4 <= 32', () => {
  const want = { 2: [8, 4], 3: [12, 5], 4: [16, 6], 5: [20, 7] }; // base in-scope and near-miss counts (+-2 and +-1 per task)
  const counts = new Set();
  for (const d of DS) for (const seed of SEEDS.slice(0, 8)) {
    const w = buildWide(seed, 'dev', d), task = gen(seed, d), tr = bed.referenceTrace(task), ref = tr.reduce;
    for (const c of w.truthCells) {
      const e = w.entities.find(x => x.id === c.e), wd = w.byKey.get(c.winner);
      const row = ref.table.find(r => r.entity === e.code && r.property === c.p);
      assert.ok(row && row.source_doc_id === wd.id && Math.round(row.value * 10 ** PROPS[c.p].dec) === c.canon, `cell ${e.code}/${c.p} d${d} s${seed}`);
    }
    const sc = bed.scopeOf(task);
    const inRole = w.entities.filter(e => e.role === 'in').map(e => e.code).sort();
    assert.deepEqual(sc.inScope.map(x => x.code).sort(), inRole, `in-scope = role 'in' d${d} s${seed}`);
    assert.deepEqual(sc.candidates.map(x => x.role).filter(r => r !== 'in').sort(), w.entities.filter(e => ['T1', 'T2', 'T3', 'T4'].includes(e.role)).map(e => e.role).sort());
    const nNear = sc.candidates.length - sc.inScope.length;
    assert.ok(Math.abs(sc.inScope.length - want[d][0]) <= 2 && nNear >= 4 && Math.abs(nNear - want[d][1]) <= 1, `${sc.inScope.length}/${nNear} d${d}`);
    counts.add(`${d}:${sc.inScope.length}`);
    assert.ok(sc.candidates.length <= MAX_FANOUT);
    for (const role of ['T2', 'T4']) assert.ok(w.docs.some(x => x.role === `near-${role}` && x.lab === w.X && x.pubDay >= w.Y && !x.claims.length), `a lab X document titled on a ${role} compound with no test d${d}`);
    for (const t of ['T1', 'T2', 'T3', 'T4']) assert.ok(w.entities.some(e => e.role === t), `${t} d${d}`);
    assert.equal(w.entities.some(e => e.role === 'T6'), d >= 4);
    for (const t of ['retracted', 'superseded', 'nonstd', 'quote', 'prediction', 'bound', 'recency', 'erratum', 'unit', ...(d >= 3 ? ['concern'] : []), ...(d >= 4 ? ['outOfCorpus'] : [])]) assert.ok(sc.traps[t] >= 1, `trap ${t} d${d} s${seed}`);
    assert.equal(ref.table.length, sc.inScope.length * w.props.length);
  }
  assert.ok(counts.size >= 8, 'the in-scope count varies per task');
});

test('review finding 3: separable under the declared worker slice (budget.mjs workerSlice, the slice the accounting prices): the exact worker on it reproduces the truth on every task', () => {
  let v2s = 0;
  const run = (seed, d, split) => {
    const task = gen(seed, d, split), w = buildWide(seed, split, d);
    for (const v2 of w.docs.filter(x => x.supersedes)) {
      const v1 = w.byKey.get(v2.supersedes);
      for (const id of Object.keys(v1.styles)) assert.ok(v2.styles[id], `${v2.id} omits a compound of ${v1.id} d${d} ${split} s${seed}`);
      v2s++;
    }
    const items = [];
    for (const code of bed.referenceTrace(task).plan.candidates) {
      const keys = new Set(workerSlice(w, code));
      const vis = w.docs.filter(x => keys.has(x.key));
      const unseen = new Set(w.docs.filter(x => !keys.has(x.key)).map(x => x.key));
      items.push(...worker(w, vis, voidKeys(w, vis, { unseen }), [code]).items);
    }
    const o = bed.oracle(task, reduce(w, w.docs, new Set(), items));
    assert.ok(o.pass, `declared slice fails d${d} ${split} s${seed}: ${JSON.stringify(o.details)}`);
  };
  for (const d of DS) { for (const seed of SEEDS) run(seed, d, 'dev'); for (const seed of HELD) run(seed, d, 'test'); }
  assert.ok(v2s > 0);
});

test('no completeness shortcut: every plan candidate (in scope or not) and the namesake compound have a surviving claim for every requested property', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 8)) {
    const w = buildWide(seed, 'dev', d);
    const all = runPipeline(w, { mentionsCounted: true, plansCounted: true, byPubDate: true, scopeVoidKept: true, namesakeLab: true, traces: false }).reduce;
    const sc = bed.scopeOf(gen(seed, d));
    const rowsOf = code => all.table.filter(r => r.entity === code).length;
    for (const c of [...sc.candidates.map(x => x.code), ...sc.namesake]) assert.equal(rowsOf(c), w.props.length, `${c} d${d} s${seed}`);
  }
});

test('text conveys the structure: the code mention index equals the world\'s mentions; every compound\'s name<->code is recoverable', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 4)) {
    const w = buildWide(seed, 'dev', d), task = gen(seed, d);
    const idx = textIndex(task.files, task.inputs.register.entries);
    const byCode = new Map(idx.entities.map(e => [e.code, e]));
    for (const e of w.entities) {
      const x = byCode.get(e.code);
      if (!w.docs.some(doc => doc.styles[e.id])) continue;
      assert.ok(x, `${e.code} indexed d${d}`);
      assert.equal(x.name, e.name, `${e.code} name recoverable d${d} s${seed}`);
      const want = w.docs.filter(doc => (doc.kind !== 'erratum' && doc.kind !== 'retraction' && doc.kind !== 'concern' && doc.kind !== 'office') && doc.styles[e.id]).map(doc => doc.id).sort();
      const got = x.docs.filter(id => { const doc = w.docs.find(z => z.id === id); return !['erratum', 'retraction', 'concern', 'office'].includes(doc.kind); });
      assert.deepEqual(got, want, `${e.code} mentions d${d} s${seed}`);
    }
    assert.equal(idx.entities.length, w.entities.filter(e => w.docs.some(doc => doc.styles[e.id]) || e.registeredBy).length);
  }
});

test('decidability witness: the white-box script (generator templates, task text only) reproduces the truth on every task', () => {
  for (const d of DS) {
    for (const seed of SEEDS) { const t = gen(seed, d); assert.ok(bed.oracle(t, whiteboxSolve(t)).pass, `d${d} s${seed}`); }
    for (const seed of HELD) { const t = gen(seed, d, 'test'); assert.ok(bed.oracle(t, whiteboxSolve(t)).pass, `d${d} test s${seed}`); }
  }
});

test('review finding 1 (triviality, W-BED §2.4 items 2 and 4): a text-only parser of the dev-visible sentence forms solves dev and held-out at d2-d4; only the d5 test-split phrasing defeats it', t => {
  const dv = task => bed.oracle(task, whiteboxSolve(task, { phrasing: 'dev-visible' })).pass;
  for (const d of DS) for (const seed of SEEDS.slice(0, 5)) assert.ok(dv(gen(seed, d)), `dev d${d} s${seed}`);
  for (const d of [2, 3, 4]) for (const seed of HELD) assert.ok(dv(gen(seed, d, 'test')), `held-out d${d} s${seed}: a dev-visible parser solves the stream difficulties`);
  const d5 = HELD.filter(seed => dv(gen(seed, 5, 'test'))).length;
  assert.equal(d5, 0, 'the d5 test-split test-date phrasing is the only form dev text never shows');
  // the keyword script is a strawman next to it, not the triviality answer
  for (const d of DS) assert.equal(bed.oracle(gen(301, d), bed.keywordScript(gen(301, d))).pass, false);
  t.diagnostic(`dev-visible parser: dev 5/5 per difficulty, held-out d2-d4 12/12, held-out d5 (test split) ${d5}/${HELD.length}`);
});

test('exact units: every printed unit converts back to the canonical integer exactly; the oracle compares at the stated precision', () => {
  for (const p of PROP_IDS) {
    const [lo, hi] = PROPS[p].range;
    for (let c = lo; c <= hi; c += Math.max(1, Math.floor((hi - lo) / 97))) for (const u of PROPS[p].units) {
      assert.equal(canonOf(p, u.id, printedNumber(p, c, u.id)), c, `${p} ${u.id} ${c}`);
      assert.ok(valueText(p, c, u.id).length > 0);
    }
  }
  const t = gen(305, 4), ref = bed.referenceSolve(t);
  const nudged = structuredClone(ref); nudged.table[0].value += 0.4 / 10 ** PROPS[nudged.table[0].property].dec;
  assert.ok(bed.oracle(t, nudged).pass, 'float noise below half a unit of the stated precision passes');
  const off = structuredClone(ref); off.table[0].value += 1 / 10 ** PROPS[off.table[0].property].dec;
  assert.equal(bed.oracle(t, off).pass, false, 'one unit of the stated precision fails');
});

test('tests are dated by the measurement and never straddle the cut-off; test-date phrasing is parseable', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 6)) {
    const w = buildWide(seed, 'dev', d);
    for (const doc of w.docs.filter(x => x.testDay != null)) {
      assert.ok(doc.testDay <= doc.pubDay - 10, `${doc.id} tested before publication`);
      if (doc.testForm === 'between') assert.ok((doc.testDay >= w.Y) === (doc.testEnd >= w.Y));
      if (doc.testForm === 'week') assert.ok((doc.testDay >= w.Y) === (doc.testDay + 6 >= w.Y));
    }
  }
  assert.equal(parseDay('2025-03-04'), Date.UTC(2025, 2, 4));
  assert.equal(parseDay('04.03.2025'), Date.UTC(2025, 2, 4));
  assert.equal(parseDay('4 March 2025'), Date.UTC(2025, 2, 4));
  assert.equal(parseDay('March 4th, 2025'), Date.UTC(2025, 2, 4));
  assert.equal(dayNum(2025, 3, 4) * 86400000, Date.UTC(2025, 2, 4));
});

// ---------------------------------------------------------------------------------------------------------------------
test('controls: CONTRACT minimums, the two size stand-ins (necessity controls), several relation controls', () => {
  const names = bed.badControls.map(c => c.name);
  for (const n of ['empty', 'shuffled-or-corrupted', 'heuristic:keyword-script']) assert.ok(names.includes(n), n);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(bed.necessityControls.map(c => c.name), ['sequential-single-context', 'best-of-n:equal-tokens']);
  assert.ok(names.includes('plan-register-list'), 'the register list stays as a bad control (a plausible mistake), not a necessity control');
  for (const d of DS) assert.ok(bed.badControls.filter(c => applies(c, d)).length >= 20, `d${d}`);
  assert.ok(bed.badControls.filter(c => c.kind === 'relation').length >= 4);
});

test('relation controls pass every stage oracle and the reduce stage\'s local checks but fail a cross-item relation', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 4)) {
    const task = gen(seed, d);
    for (const c of bed.badControls.filter(x => x.kind === 'relation')) {
      const co = bed.composedOracle(task, c.trace(task));
      for (const [id, r] of Object.entries(co.stages)) assert.ok(r.pass, `${c.name} d${d} s${seed}: stage ${id} fails ${JSON.stringify(r.details).slice(0, 200)}`);
      assert.ok(Object.values(co.relations).some(r => !r.pass), `${c.name} d${d} s${seed}: no relation fails`);
    }
  }
});

test('composed oracle agrees with the end-to-end oracle on every trace; stage controls fail a stage oracle', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 3)) {
    const task = gen(seed, d);
    assert.ok(bed.composedOracle(task, bed.referenceTrace(task)).pass);
    for (const c of allControls.filter(x => x.trace && applies(x, d))) {
      const tr = c.trace(task), co = bed.composedOracle(task, tr);
      assert.equal(co.pass, bed.oracle(task, tr.reduce).pass, `${c.name} d${d} s${seed}`);
      if (c.kind === 'stage') assert.ok(Object.values(co.stages).some(r => !r.pass), `${c.name}: some stage oracle must see it`);
    }
  }
});

test('stage hand-offs of the reference trace satisfy their contracts; stage oracles pass on the truth and fail on {}', () => {
  for (const d of DS) {
    const task = gen(311, d), tr = bed.referenceTrace(task);
    for (const s of ['index', 'plan', 'worker', 'reduce']) assert.deepEqual(bed.CONTRACTS[s].check(tr[s]), [], `${s} d${d}`);
    assert.deepEqual(bed.CONTRACTS.input.check(task.inputs), []);
    for (const s of bed.stages) {
      assert.ok(s.oracle(s.project(task), tr[s.id]).pass, `${s.id} d${d}`);
      assert.equal(s.oracle(s.project(task), {}).pass, false);
    }
    // the plan stage is recall-oriented: extra candidates are allowed, a missing or duplicated compound is not
    const pl = bed.stages.find(s => s.id === 'plan');
    const st = pl.project(task);
    const outsider = buildWide(311, 'dev', d).entities.find(e => e.role === 'bg').code;
    assert.ok(pl.oracle(st, { candidates: [...tr.plan.candidates, outsider] }).pass, 'an extra (out-of-scope) candidate is allowed');
    assert.equal(pl.oracle(st, { candidates: tr.plan.candidates.slice(1) }).pass, tr.worker.items[0].in_scope ? false : true);
  }
});

test('oracle: schema-invalid and hostile outputs fail; order-insensitive; compound by code or name; duplicates and extras fail', () => {
  const t = gen(305, 3), ref = bed.referenceSolve(t), sc = bed.scopeOf(t);
  for (const out of [null, {}, { table: ref.table }, { ...ref, table: ref.table.slice(1) }, new Proxy(ref, {}),
    { ...ref, table: ref.table.map((r, i) => (i ? r : { ...r, value: String(r.value) })) },
    { ...ref, table: ref.table.map((r, i) => (i ? r : { ...r, property: 'colour' })) }]) assert.equal(bed.oracle(t, out).pass, false);
  const sh = structuredClone(ref);
  sh.table.reverse(); sh.excluded_doc_ids.reverse();
  const w = buildWide(305, 'dev', 3);
  for (const r of sh.table) { r.entity = ` ${w.entities.find(e => e.code === r.entity).name.toUpperCase()} `; r.source_doc_id = r.source_doc_id.toLowerCase(); }
  assert.ok(bed.oracle(t, sh).pass, 'names instead of codes, any case and order');
  const dup = structuredClone(ref); dup.table.push({ ...dup.table[0], entity: w.entities.find(e => e.code === dup.table[0].entity).name });
  assert.equal(bed.oracle(t, dup).pass, false, 'one cell under code and under name is a duplicate');
  // review finding 8: "name (CODE)", the corpus's own form, names the compound when both halves agree
  const pair = structuredClone(ref);
  for (const r of pair.table) { const e = w.entities.find(x => x.code === r.entity); r.entity = `${e.name} (${e.code})`; }
  assert.ok(bed.oracle(t, pair).pass, '"name (CODE)" is accepted');
  assert.deepEqual(bed.unitChecks(t, pair).issues, [], 'and the code verifier reads it too');
  const mixed = structuredClone(ref);
  const other = w.entities.find(x => x.code !== mixed.table[0].entity);
  mixed.table[0].entity = `${other.name} (${mixed.table[0].entity})`;
  assert.equal(bed.oracle(t, mixed).pass, false, 'a pair whose halves name different compounds names nothing');
  const extra = structuredClone(ref);
  const outCode = sc.candidates.find(c => c.role !== 'in').code;
  extra.table.push({ entity: outCode, property: w.props[0], value: 1, source_doc_id: 'D001' });
  assert.equal(bed.oracle(t, extra).pass, false, 'a row for an out-of-scope compound fails');
  const unreq = structuredClone(ref);
  unreq.table.push({ ...unreq.table[0], property: PROP_IDS.find(p => !w.props.includes(p)) });
  assert.equal(bed.oracle(t, unreq).pass, false, 'a row for an unrequested property fails');
  const ex = structuredClone(ref); ex.excluded_doc_ids.push('D999');
  assert.equal(bed.oracle(t, ex).pass, false);
  const o = bed.oracle(t, bed.badControls.find(c => c.name === 'recency-only').make(t));
  assert.ok(!/D\d{3}|[A-Z]{2,3}-\d{3,4}/.test(JSON.stringify(o.details)), 'details carry counts, not answers');
});

test('hidden truth does not leak: the compound list, the void set and the roles are not in the task', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 6)) {
    const t = gen(seed, d), text = canonical({ prompt: t.prompt, inputs: t.inputs }), all = canonical(t), ref = bed.referenceSolve(t), sc = bed.scopeOf(t);
    assert.ok(!all.includes(canonical(ref.excluded_doc_ids)), 'void set');
    const codes = sc.inScope.map(x => x.code);
    assert.ok(!text.includes(canonical([...codes].sort())) && !text.includes(codes.join(', ')), 'compound list');
    for (const k of ['"role"', '"sub"', 'near-void', 'trap-', 'T1', 'codeonly']) assert.ok(!all.includes(k), `${k} d${d}`);
    const registeredByX = t.inputs.register.entries.filter(x => x.registered_by === t.inputs.question.lab).map(x => x.code).sort();
    assert.notDeepEqual(registeredByX, [...codes].sort(), 'the register is not the answer');
  }
});

// ---------------------------------------------------------------------------------------------------------------------
test('review finding 2: the plan is not necessary for correctness; it is needed for width, and it is code', t => {
  const widths = {};
  const plan = bed.stages.find(s => s.id === 'plan');
  for (const d of DS) for (const seed of SEEDS) {
    const task = gen(seed, d), tr = bed.referenceTrace(task);
    // R6 without a plan: the exact workers over every indexed compound solve the task
    const ab = bed.planAblation(task);
    assert.ok(bed.oracle(task, ab.output).pass, `map over the index d${d} s${seed}`);
    (widths[d] ??= []).push(ab.workers);
    if (d >= 3) assert.ok(ab.overFanout, `d${d}: the plan-less map is wider than MAX_FANOUT`);
    // the plan as code (lab names from the two notices, header fields, mention index) is the reference plan exactly
    const cp = bed.codePlan(task);
    assert.deepEqual(cp, [...tr.plan.candidates].sort(), `codePlan d${d} s${seed}`);
    assert.ok(cp.length <= MAX_FANOUT);
    assert.ok(plan.oracle(plan.project(task), { candidates: cp }).pass);
    // the register list misses >= 2 in-scope compounds by construction (why it is a bad control, not a necessity control)
    const fixed = new Set(task.inputs.register.entries.filter(x => x.registered_by === task.inputs.question.lab).map(x => x.code));
    assert.ok(bed.scopeOf(task).inScope.filter(x => !fixed.has(x.code)).length >= 2, `d${d} s${seed}`);
  }
  for (const seed of HELD) for (const d of DS) { const task = gen(seed, d, 'test'); assert.deepEqual(bed.codePlan(task), [...bed.referenceTrace(task).plan.candidates].sort()); }
  t.diagnostic(`plan-less map width (workers) per difficulty: ${JSON.stringify(Object.fromEntries(Object.entries(widths).map(([d, xs]) => [d, [Math.min(...xs), Math.max(...xs)]])))}`);
});

test('the plan\'s code check (coverageIssues) accepts the reference plan and names each plan mistake', () => {
  for (const d of [3, 4, 5]) for (const seed of SEEDS.slice(0, 4)) {
    const task = gen(seed, d), cands = bed.referenceTrace(task).plan.candidates;
    assert.ok(bed.coverageIssues(task, cands).ok);
    const ctl = name => bed.badControls.find(c => c.name === name).trace(task).plan.candidates;
    assert.ok(bed.coverageIssues(task, ctl('scope-alias-missed')).gaps.length > 0, `alias-missed has gaps d${d} s${seed}`);
    assert.ok(bed.coverageIssues(task, ctl('scope-code-and-name-twice')).duplicates.length > 0, `code-and-name-twice d${d} s${seed}`);
    assert.ok(bed.coverageIssues(task, ctl('plan-register-list')).gaps.length > 0, `register list d${d} s${seed}`);
    assert.deepEqual(bed.coverageIssues(task, [...cands, 'zz-not-a-compound']).unknown, ['zz-not-a-compound']);
    const e = buildWide(seed, 'dev', d).entities.find(x => x.code === cands[0]);
    assert.ok(bed.coverageIssues(task, [...cands.slice(1), `${e.name} (${e.code})`]).ok, '"name (CODE)" resolves');
  }
});

test('necessity: one sequential context fails on size at every difficulty (inline task above the budget; documents unread)', t => {
  const sizes = {};
  for (const d of DS) {
    const toks = SEEDS.map(s => estimateTokens(inlineRender(gen(s, d))));
    sizes[d] = { min: Math.min(...toks), mean: Math.round(toks.reduce((a, b) => a + b, 0) / toks.length), max: Math.max(...toks) };
    assert.ok(sizes[d].min > bed.SEQUENTIAL_BUDGET_TOKENS, `d${d}: every task exceeds the ${bed.SEQUENTIAL_BUDGET_TOKENS}-token single-context budget`);
    for (const seed of SEEDS.slice(0, 5)) assert.ok(bed.sizeOf(gen(seed, d)).sequentialUnseen >= 50, `d${d} s${seed}`);
  }
  assert.ok(sizes[2].mean >= 40000 && sizes[5].mean >= 90000, JSON.stringify(sizes));
  assert.ok(sizes[5].max > 100000, 'some d5 tasks cross the 100K-token price step (policy/models.json)');
  t.diagnostic(`inline tokens (utf8/4) over dev 301-320: ${JSON.stringify(sizes)}`);
});

test('best_of_n at equal tokens with the same verifier: every candidate fails, not only the selected one', t => {
  const rows = {};
  for (const d of DS) for (const seed of SEEDS.slice(0, 5)) {
    const task = gen(seed, d), b = bed.bestOfNRun(task), acc = bed.tokenAccounting(task);
    assert.ok(b.N >= 3 && b.N === Math.max(3, acc.bestOfN.nAtEqualTokens));
    assert.equal(bed.oracle(task, b.output).pass, false);
    const w = buildWide(seed, 'dev', d);
    for (const c of b.candidates) assert.ok(c.unseen > 0, 'every candidate leaves documents unread');
    const passes = b.candidates.filter((_, i) => {
      return bed.oracle(task, runPipeline(w, { unseen: unseenPast(w, readingOrder(w, Math.floor((i * w.docs.length) / b.N))), traces: false }).reduce).pass;
    }).length;
    assert.equal(passes, 0, `d${d} s${seed}: a best_of_n candidate passes`);
    rows[d] ??= []; rows[d].push({ N: b.N, eq: acc.bestOfN.nAtEqualTokens, lean: acc.bestOfN.nLean, ratio: acc.bestOfN.ratio, pick: b.pick });
  }
  t.diagnostic(`best_of_n (seeds 301-305): ${JSON.stringify(rows)}`);
});

test('review finding 4: an agent with tools and no workflow (every lab name, both strings, later versions) solves every task when it loses nothing; only the 32K attention hypothesis separates it from wide', t => {
  const reads = {};
  for (const d of DS) for (const seed of SEEDS) {
    const task = gen(seed, d), g = bed.grepAgentRun(task);
    assert.ok(bed.oracle(task, g.output).pass, `grep agent d${d} s${seed}`);
    assert.ok(g.read < bed.tokenAccounting(task).inline, 'it reads less than the inline task');
    (reads[d] ??= []).push(g.read);
    if (d >= 3) assert.ok(g.overBudget && g.read > SEQUENTIAL_BUDGET_TOKENS, `d${d} s${seed}: above the attention budget`);
  }
  for (const seed of HELD) for (const d of DS) { const task = gen(seed, d, 'test'); assert.ok(bed.oracle(task, bed.grepAgentRun(task).output).pass, `held-out d${d} s${seed}`); }
  t.diagnostic(`grep agent read (tokens) per difficulty, min-max: ${JSON.stringify(Object.fromEntries(Object.entries(reads).map(([d, xs]) => [d, [Math.min(...xs), Math.max(...xs)]])))}`);
});

test('equal-token accounting: wide reads several times the inline task under every design; most of it is a cacheable prefix', t => {
  const rows = {};
  for (const d of DS) {
    const xs = SEEDS.slice(0, 10).map(s => bed.tokenAccounting(gen(s, d)));
    const mean = f => Math.round(xs.reduce((a, x) => a + f(x), 0) / xs.length);
    const range = f => [Math.min(...xs.map(f)), Math.max(...xs.map(f))];
    rows[d] = { inline: mean(x => x.inline), plan: mean(x => x.wide.plan), workers: mean(x => x.wide.workers), workersOneCall: mean(x => x.wide.workersOneCall), workerMax: Math.max(...xs.map(x => x.wide.workerMax)),
      verify: mean(x => x.wide.verify), verifySourceOnly: mean(x => x.wide.verifySourceOnly), total: mean(x => x.wide.total), totalLean: mean(x => x.wide.totalLean), calls: xs[0].wide.calls,
      cacheableShare: Math.round(mean(x => x.wide.cacheableShare * 1000)) / 1000, nEq: range(x => x.bestOfN.nAtEqualTokens), nOneCall: range(x => x.bestOfN.nOneCall), nLean: range(x => x.bestOfN.nLean) };
    for (const x of xs) {
      assert.ok(x.wide.totalLean > x.inline, 'even the leanest wide reads more than one inline pass');
      assert.ok(x.wide.workerMax < bed.SEQUENTIAL_BUDGET_TOKENS, 'every worker context fits the single-context budget');
      assert.ok(x.wide.plan < bed.SEQUENTIAL_BUDGET_TOKENS, 'the plan digest fits the single-context budget');
      assert.ok(x.wide.workers > x.wide.workersOneCall && x.wide.verify > x.wide.verifySourceOnly);
      assert.ok(x.wide.cacheableShare > 0.5, 'most worker input is a cacheable prefix');
      assert.ok(x.bestOfN.nAtEqualTokens >= x.bestOfN.nOneCall && x.bestOfN.nOneCall >= x.bestOfN.nLean && x.bestOfN.nLean >= 1);
    }
  }
  t.diagnostic(`token accounting (means over dev 301-310): ${JSON.stringify(rows)}`);
});

test('review finding 5: the B6 accounting counts output and thinking tokens, prices the 100K-token step, and gives N per unit', t => {
  assert.deepEqual({ ...THINKING_CAP }, { ...THINKING }, 'thinking caps are the engine\'s (src/models/port.mjs)');
  const pol = JSON.parse(readFileSync(new URL('../../../policy/models.json', import.meta.url), 'utf8'));
  const price = pol.models.find(m => m.id === 'claude-haiku-5-5').price;
  assert.equal(price.inputPerMTok, HAIKU_PRICE.inputPerMTok);
  assert.equal(price.outputPerMTok, HAIKU_PRICE.outputPerMTok);
  assert.match(price.source, /up to 100K tokens, \$0\.50\/\$2\.50 beyond/, 'the long-prompt step the bed prices');
  assert.ok(Math.abs(callUsd(100000, 1000) - (0.01 + 0.0005)) < 1e-12 && Math.abs(callUsd(100001, 1000) - (100001 * 0.5 + 1000 * 2.5) / 1e6) < 1e-12);
  const a = agentTokens({ fixed: 3000, read: 40000, batch: 16000, cells: 10 });
  assert.deepEqual([a.calls, a.input], [4, 4 * 3000 + 16000 + 32000 + 40000], 'the agent re-sends its context every turn');
  const rows = {};
  for (const d of DS) for (const seed of SEEDS.slice(0, 5)) {
    const acc = bed.tokenAccounting(gen(seed, d)), W = acc.wide.byEffort, B = acc.bestOfN.byEffort;
    for (const e of ['none', 'medium']) {
      const w = W[e].declared;
      assert.equal(w.calls, 1 + acc.wide.calls.workers + acc.wide.calls.verify);
      assert.equal(w.input, acc.wide.total);
      assert.ok(w.output >= 60 * w.calls, 'every call writes output');
      assert.equal(w.thinking, w.calls * THINKING_CAP[e], 'thinking scales with the number of calls');
      assert.equal(B[e].candidate.thinking, THINKING_CAP[e]);
      assert.equal(B[e].declared.nTokens, Math.max(1, Math.floor(w.tokens / B[e].candidate.tokens)));
      assert.equal(B[e].declared.nUsd, Math.max(1, Math.floor(w.usd / B[e].candidate.usd)));
      for (const batch of [8000, 16000, 32000]) assert.ok(B[e].agent[batch].input > acc.bestOfN.agentRead);
      assert.ok(B[e].agent[8000].tokens > B[e].agent[32000].tokens, 'smaller tool batches: more turns, more re-read tokens');
      assert.ok(B[e].agent[8000].nTokens <= B[e].declared.nTokens, 'in agent units N is smaller than in one-call units');
    }
    assert.equal(acc.bestOfN.nAtEqualTokens, B.none.declared.nTokens);
    if (d === 5) {
      assert.ok(acc.over100k.inline && B.none.candidate.usd > B.none.candidate.input * HAIKU_PRICE.longInputPerMTok / 1e6 - 1e-9, 'd5 inline reads pay the long-prompt rate');
      assert.ok(B.none.declared.nUsd < B.none.declared.nTokens, 'at d5 equal dollars buys fewer best_of_n candidates than equal tokens');
    }
    (rows[d] ??= []).push({ none: [B.none.declared.nTokens, B.none.declared.nUsd, B.none.agent[16000].nTokens], medium: [B.medium.declared.nTokens, B.medium.declared.nUsd, B.medium.agent[16000].nTokens],
      wideUsd: [W.none.declared.usd, W.medium.declared.usd], candUsd: [B.none.candidate.usd, B.medium.candidate.usd] });
  }
  t.diagnostic(`N [one-call tokens, one-call dollars, agent tokens at 16K batches] and dollars (seeds 301-305): ${JSON.stringify(rows)}`);
});

test('keyword script (text only) fails every task; the code verifier accepts the reference and flags the structural controls', t => {
  const recall = {};
  for (const d of DS) for (const seed of SEEDS.slice(0, 6)) {
    const task = gen(seed, d);
    assert.deepEqual(bed.unitChecks(task, bed.referenceSolve(task)).issues, [], `reference flagged d${d} s${seed}`);
    assert.equal(bed.oracle(task, bed.keywordScript(task)).pass, false);
    for (const c of allControls.filter(x => applies(x, d))) {
      const flagged = !bed.unitChecks(task, c.make(task)).ok;
      (recall[c.name] ??= [0, 0]); recall[c.name][0] += flagged ? 1 : 0; recall[c.name][1]++;
    }
  }
  const flaggedShare = Object.values(recall).filter(([a, n]) => a / n >= 0.5).length / Object.keys(recall).length;
  t.diagnostic(`unitChecks flags (tasks flagged / tasks) per control: ${JSON.stringify(recall)}`);
  assert.ok(flaggedShare > 0.3, `the code verifier flags a share of controls (${flaggedShare})`);
});

// ---------------------------------------------------------------------------------------------------------------------
test('drift knob changes the task distribution measurably; the d5 tier is split-specific (held-out phrasing never on split dev)', () => {
  const feat = (seed, d, split = 'dev') => {
    const w = buildWide(seed, split, d), text = Object.values(w.render.files).join('\n');
    return { docs: w.docs.length, policies: w.policy, abbr: w.docs.some(x => x.affil === 'abbr'), former: w.docs.some(x => x.affil === 'former'), ns: Boolean(w.NS),
      code: w.docs.some(x => Object.values(x.styles).includes('code')), log: text.includes('Sample log:'), conf: text.includes('Type: Conference abstract'),
      rel: text.includes('days after the site visit of'), rep: text.includes('Type: Technical report'), review: w.docs.some(x => x.kind === 'review') };
  };
  const by = Object.fromEntries(DS.map(d => [d, SEEDS.map(s => feat(s, d))]));
  assert.ok(by[2].every(x => !x.abbr && !x.former && !x.ns && !x.code && !x.review && x.policies === 'P1'));
  assert.ok(by[3].every(x => x.abbr && !x.former && !x.ns && x.code && x.review));
  assert.ok(by[4].every(x => x.former && x.ns));
  assert.deepEqual(new Set(by[4].map(x => x.policies)), new Set(['P1', 'P2', 'P3']));
  for (const d of [2, 3, 4]) assert.ok(by[d].every(x => !x.log && !x.conf && !x.rel && !x.rep), `no novel phrasing at d${d}`);
  assert.ok(by[5].every(x => x.log && x.conf && !x.rel && !x.rep), 'd5 dev: novel-dev only');
  for (const seed of HELD) { const x = feat(seed, 5, 'test'); assert.ok(x.rel && x.rep && !x.log && !x.conf, 'd5 test: novel-test only'); }
  for (const seed of HELD) { const x = feat(seed, 4, 'test'); assert.ok(!x.rel && !x.rep && !x.log && !x.conf); }
  for (let d = 2; d < 5; d++) assert.ok(Math.min(...by[d + 1].map(x => x.docs)) > Math.max(...by[d].map(x => x.docs)), `docs grow d${d + 1}`);
});

test('review finding 7: the rules do not reveal the split (d5 names both held-out-tier kinds on both splits); out-of-corpus retractions are not a winner prior', () => {
  const rule6 = p => p.split('\n').find(l => l.startsWith('6. '));
  for (const d of DS) for (const seed of [...SEEDS.slice(0, 3), ...HELD]) {
    const dev = gen(seed, d).prompt, test = gen(seed, d, 'test').prompt;
    for (const p of [dev, test]) {
      assert.equal(p.includes('conference abstracts, technical reports'), d === 5);
      assert.equal(p.includes('Conference abstracts rank with preprints. Technical reports rank with lab notes.'), d === 5);
    }
    assert.equal(rule6(dev), rule6(test), `rule 6 identical across splits d${d}`);
  }
  let onWinner = 0, offWinner = 0;
  for (const d of [4, 5]) for (const seed of SEEDS) {
    const w = buildWide(seed, 'dev', d);
    const winners = new Set(w.truthCells.map(c => c.winner));
    for (const n of w.docs.filter(x => x.notice?.outOfCorpus)) {
      if (winners.has(n.notice.titleOf)) onWinner++; else offWinner++;
      assert.equal(n.target, null);
    }
  }
  assert.ok(onWinner >= 40 && offWinner >= 40, `out-of-corpus retractions on winners ${onWinner}, elsewhere ${offWinner}`);
});

test('triviality driver plans R6 dry (no model call) and scores stubs through the oracle', async () => {
  const p = await plan({ rungs: ['r6'], seeds: [379, 380] });
  assert.equal(p[0].calls, 4);
  assert.match(p[0].necessity, /plan/);
  for (const x of await runStub(p, 'reference')) assert.equal(x.pass, x.n);
  for (const name of ['best-of-n:equal-tokens', 'sequential-single-context', 'plan-register-list', 'heuristic:keyword-script']) for (const x of await runStub(p, name)) assert.equal(x.pass, 0, name);
  assert.match(p[0].necessity, /none for correctness/);
});

test('fault overlay: default generation is fault-free and requesting a fault throws in v1', () => {
  assert.equal(hashOf(bed.generate({ seed: 301, split: 'dev', difficulty: 3, faults: [] })), hashOf(gen(301, 3)));
  assert.throws(() => bed.generate({ seed: 301, split: 'dev', difficulty: 3, faults: ['f3'] }), /not implemented/);
});

test('runtime: generate and oracle under 3 s at difficulty 5 (cold)', () => {
  const t0 = performance.now();
  // dev 321 (wbed-dev, not generated elsewhere in this file); review finding 9: no unassigned test-split seed
  const t = bed.generate({ seed: 321, split: 'dev', difficulty: 5 });
  const t1 = performance.now();
  bed.oracle(t, bed.referenceSolve(t));
  assert.ok(t1 - t0 < 3000, `generate ${t1 - t0} ms`);
  assert.ok(performance.now() - t1 < 3000);
});
