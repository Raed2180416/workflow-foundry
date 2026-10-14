// need-stage bed tests (node:test, built-ins only). Development seeds 601-640 only; nothing here is held-out evidence.
//   node --test beds/need-stage/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as bed from './index.mjs';
import { canonical } from '../lib/canonical.mjs';
import { refKey } from '../wbed/lib/domain.mjs';
import * as rungR1 from '../wbed/r1/index.mjs';
import * as rungR2 from '../wbed/r2/index.mjs';
import * as rungR3 from '../wbed/r3/index.mjs';
import * as rungR6 from '../wbed/r6/index.mjs';
import { buildWide } from '../wbed/r6/world.mjs';
import { workerSlice } from '../wbed/r6/budget.mjs';

const SEEDS = Array.from({ length: 40 }, (_, i) => 601 + i);
const DIFFICULTIES = [1, 2, 3, 4, 5];
const gen = (seed, difficulty, extra = {}) => bed.generate({ seed, split: 'dev', difficulty, ...extra });
const kindOf = task => bed.describeTask(task).stage;
const visible = task => `${task.prompt}\n${JSON.stringify(task.inputs)}\n${Object.values(task.files ?? {}).join('\n')}`;

// Cold timings first (worlds and cases are memoised in-process, so this test must run before the others build them).
test('runtime: generate and oracle each under 2 s at difficulty 5 (cold rung worlds)', () => {
  for (const seed of SEEDS.slice(0, 8)) {
    let t = performance.now();
    const task = gen(seed, 5);
    const g = performance.now() - t;
    assert.ok(g < 2000, `generate d5 seed ${seed}: ${g.toFixed(0)} ms`);
    // the oracle on a kind whose case (and rung world) is not built yet: knobs.stage forces another kind
    const other = bed.STAGES.find(s => s !== kindOf(task));
    t = performance.now();
    const o = bed.oracle({ ...task, knobs: { stage: other } }, {});
    const dt = performance.now() - t;
    assert.equal(o.pass, false);
    assert.ok(dt < 2000, `oracle (cold ${other}) d5 seed ${seed}: ${dt.toFixed(0)} ms`);
  }
});

test('contract: family, schemas (portable subset), exports, controls', () => {
  assert.equal(bed.family.id, 'need-stage');
  assert.equal(bed.family.version, '1.0.0');
  assert.equal(bed.family.kind, 'oneshot');
  assert.equal(bed.family.role, 'need-anchor');
  assert.ok(bed.family.domain && bed.family.description);
  assert.match(bed.family.description, /[Hh]ypothesis/);
  for (const fn of ['generate', 'oracle', 'referenceSolve', 'describeTask', 'stageOf', 'outputSchemaOf', 'deployableCheck', 'kindFamily']) assert.equal(typeof bed[fn], 'function');
  const forbidden = new Set(['pattern', 'oneOf', 'anyOf', 'allOf', 'uniqueItems', '$ref', 'format']);
  const walk = s => { if (s && typeof s === 'object') for (const [k, v] of Object.entries(s)) { assert.ok(!forbidden.has(k), `schema uses ${k}`); walk(v); } };
  walk(bed.outputSchema);
  for (const s of Object.values(bed.stageSchemas)) walk(s);
  assert.deepEqual(Object.keys(bed.stageSchemas).sort(), [...bed.STAGES].sort());
  const names = bed.badControls.map(c => c.name);
  for (const n of ['empty', 'shuffled-or-corrupted', 'plausible-but-wrong']) assert.ok(names.includes(n), n);
  assert.ok(bed.badControls.every(c => typeof c.make === 'function'));
});

test('task shape: contract fields only, JSON-serialisable, output form stated, files only for the R6 worker', () => {
  for (const d of DIFFICULTIES) for (const seed of SEEDS.slice(0, 8)) {
    const task = gen(seed, d);
    const kind = kindOf(task);
    const keys = ['budget', 'difficulty', 'family', 'id', 'inputs', 'prompt', 'seed', 'split', ...(kind === 'r6-worker' ? ['files'] : [])].sort();
    assert.deepEqual(Object.keys(task).sort(), keys);
    assert.equal(task.family, 'need-stage');
    assert.equal(task.id, `need-stage/dev/d${d}/${seed}`);
    assert.deepEqual(JSON.parse(JSON.stringify(task)), task);
    assert.match(task.prompt, /Return only JSON/);
    assert.match(task.prompt, /ONE /);
    assert.ok(task.budget.inputTokensEstimate > 0 && task.budget.suggestedOutputTokens > 0);
  }
});

test('determinism: byte-identical on repeat, fresh objects, split and seed matter', () => {
  for (const d of DIFFICULTIES) for (const seed of SEEDS.slice(0, 12)) {
    const a = gen(seed, d), b = gen(seed, d);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(canonical(bed.referenceSolve(a)), canonical(bed.referenceSolve(b)));
    assert.deepEqual(bed.oracle(a, bed.referenceSolve(a)), bed.oracle(b, bed.referenceSolve(b)));
  }
  const t = gen(610, 3);
  t.inputs.tampered = true; t.prompt = 'x';
  assert.notEqual(JSON.stringify(gen(610, 3)), JSON.stringify(t));
  assert.equal(bed.oracle(t, bed.referenceSolve(gen(610, 3))).pass, true); // the oracle never reads the task's text
  const ref = bed.referenceSolve(t); ref.tampered = 1;
  assert.equal('tampered' in bed.referenceSolve(t), false);
  assert.notEqual(JSON.stringify(gen(610, 3)), JSON.stringify(bed.generate({ seed: 610, split: 'test', difficulty: 3 })));
  assert.notEqual(JSON.stringify(gen(610, 3)), JSON.stringify(gen(611, 3)));
});

test('stage kinds: each of the four kinds occurs at every difficulty; the kind does not depend on difficulty; overrides', () => {
  for (const d of DIFFICULTIES) {
    const count = Object.fromEntries(bed.STAGES.map(s => [s, 0]));
    for (const seed of SEEDS) count[kindOf(gen(seed, d))]++;
    for (const s of bed.STAGES) assert.ok(count[s] >= 9, `d${d} ${s}: ${count[s]}`);
  }
  for (const seed of SEEDS) assert.equal(bed.stageOf(seed), kindOf(gen(seed, 1)));
  for (const seed of SEEDS.slice(0, 4)) for (const stage of bed.STAGES) {
    const task = gen(seed, 2, { stage });
    assert.equal(kindOf(task), stage);
    const overridden = stage !== bed.stageOf(seed);
    assert.equal(task.id, `need-stage/dev/d2/${seed}${overridden ? `/${stage}` : ''}`);
    assert.deepEqual(task.knobs, overridden ? { stage } : undefined);
    assert.equal(bed.oracle(task, bed.referenceSolve(task)).pass, true);
    assert.equal(bed.outputSchemaOf(task), bed.stageSchemas[stage]);
  }
  assert.throws(() => gen(601, 2, { stage: 'r4-consolidate' }));
  assert.throws(() => gen(601, 0));
  assert.throws(() => gen(601, 6));
  assert.throws(() => bed.generate({ seed: 601, split: 'heldout', difficulty: 2 }));
});

test('referenceSolve passes for every dev seed at every difficulty (40 per level)', () => {
  for (const d of DIFFICULTIES) {
    let pass = 0;
    for (const seed of SEEDS) {
      const task = gen(seed, d);
      const o = bed.oracle(task, bed.referenceSolve(task));
      assert.equal(o.pass, true, `d${d} seed ${seed}: ${JSON.stringify(o.details)}`);
      assert.equal(o.score, 1);
      pass++;
    }
    assert.ok(pass >= 20);
  }
});

test('every bad control fails for every dev seed at every difficulty (40 per level)', () => {
  for (const c of bed.badControls) for (const d of DIFFICULTIES) {
    let fails = 0;
    for (const seed of SEEDS) {
      const task = gen(seed, d);
      const o = bed.oracle(task, c.make(task));
      assert.equal(o.pass, false, `${c.name} passes d${d} seed ${seed}`);
      assert.ok(o.score < 1);
      fails++;
    }
    assert.ok(fails >= 20);
  }
});

test('near misses are the rung\'s own mistakes and each one fails; the item always has at least one', () => {
  const seen = new Set();
  for (const d of DIFFICULTIES) for (const seed of SEEDS) {
    const task = gen(seed, d);
    const desc = bed.describeTask(task);
    assert.ok(desc.nearMisses.length >= 1);
    for (const n of desc.nearMisses) seen.add(`${desc.stage}:${n}`);
  }
  // the knob-specific mistakes of every kind show up somewhere in the dev seeds
  for (const n of ['r1-normalise:date-order-flipped', 'r1-normalise:atlas-switch-ignored', 'r1-normalise:ignore-close-date',
    'r2-route:keyword-router', 'r2-route:undecidable-handled', 'r2-route:injection-obeyed', 'r2-route:decidable-escalated',
    'r3-classify:timing-window-ignored', 'r3-classify:notes-ignored', 'r3-classify:payment-diff-always-fx', 'r3-classify:memo-means-price',
    'r6-worker:scope-alias-missed', 'r6-worker:retracted-claims-used', 'r6-worker:no-unit-conversion']) assert.ok(seen.has(n), n);
});

test('oracle rejects schema-invalid output for every kind', () => {
  const fn = () => 1;
  const bad = {
    'r1-normalise': [null, [], 'x', { invoices: 'x' }, { invoices: [{ invoice: 'A', row: '1', date: '2025-01-01', usd_cents: 1, live: true }] },
      { invoices: [{ invoice: 'A', row: 1, date: '2025-01-01', usd_cents: 1.5, live: true }] }, { invoices: [{ invoice: 'A', row: 1, date: '2025-01-01', usd_cents: 1 }] }],
    'r2-route': [null, {}, { doc: 1 }, { doc: '1', kind: 'invoice' }, { doc: 1, kind: 'bill' }, { kind: 'invoice' }],
    'r3-classify': [null, {}, { reason: 'timing' }, { reason: 'LATE' }, { reason: 5 }],
    'r6-worker': [null, {}, { in_scope: 'yes', cells: [], void_doc_ids: [] }, { in_scope: true, cells: [{ property: 'colour', value: 1, source_doc_id: 'D001' }], void_doc_ids: [] },
      { in_scope: true, cells: [{ property: 'pka', value: '6.25', source_doc_id: 'D001' }], void_doc_ids: [] }, { in_scope: false, cells: [] }],
  };
  for (const stage of bed.STAGES) for (const seed of SEEDS.slice(0, 3)) {
    const task = gen(seed, 3, { stage });
    const ref = bed.referenceSolve(task);
    const cases = [...bad[stage], { ...ref, extra_field: 1 }, { ...ref, f: fn },
      stage === 'r3-classify' ? { doc: 1, kind: 'invoice' } : { reason: 'TIMING' }]; // another kind's shape
    for (const out of cases) {
      const o = bed.oracle(task, out);
      assert.equal(o.pass, false, `${stage} accepted ${JSON.stringify(out)}`);
      assert.equal(o.score, 0);
      assert.equal(o.details.reason, 'schema-invalid');
    }
    const proxy = new Proxy(ref, { get: (t, k) => t[k] });
    assert.equal(bed.oracle(task, proxy).pass, false);
  }
});

test('comparison rules: order-free R1 records and loose invoice numbers, exact fields; R6 float noise, id case; duplicates fail', () => {
  for (const seed of SEEDS.slice(0, 4)) {
    const t1 = gen(seed, 3, { stage: 'r1-normalise' });
    const ref = bed.referenceSolve(t1);
    const loose = { invoices: [...ref.invoices].reverse().map(x => ({ ...x, invoice: x.invoice.toLowerCase() })) };
    assert.equal(bed.oracle(t1, loose).pass, true);
    assert.equal(bed.oracle(t1, { invoices: [...ref.invoices, ref.invoices[0]] }).pass, false);
    assert.equal(bed.oracle(t1, { invoices: ref.invoices.slice(1) }).pass, false);
    const off = structuredClone(ref); off.invoices[0].usd_cents += 1;
    assert.equal(bed.oracle(t1, off).pass, false);
    const t6 = gen(seed, 3, { stage: 'r6-worker' });
    const r6 = bed.referenceSolve(t6);
    const noisy = { ...r6, cells: r6.cells.map(c => ({ ...c, value: c.value + 1e-9, source_doc_id: ` ${c.source_doc_id.toLowerCase()} ` })), void_doc_ids: [...r6.void_doc_ids].reverse() };
    assert.equal(bed.oracle(t6, noisy).pass, true);
    if (r6.cells.length) assert.equal(bed.oracle(t6, { ...r6, cells: [...r6.cells, r6.cells[0]] }).pass, false);
    assert.equal(bed.oracle(t6, { ...r6, in_scope: !r6.in_scope }).pass, false);
    const t2 = gen(seed, 3, { stage: 'r2-route' });
    const r2 = bed.referenceSolve(t2);
    assert.equal(bed.oracle(t2, { ...r2, doc: r2.doc + 1 }).pass, false);
  }
});

test('no hidden truth leaks into prompt, inputs or files', () => {
  for (const d of DIFFICULTIES) for (const seed of SEEDS) {
    const task = gen(seed, d);
    const truth = bed.referenceSolve(task);
    const desc = bed.describeTask(task);
    const text = visible(task);
    assert.ok(!JSON.stringify(task).includes(canonical(truth)), `canonical truth in task d${d} ${seed}`);
    assert.ok(!/"(role|traps|variant|hedged|firstReading|truth|plan)"/.test(JSON.stringify(task.inputs)), `world metadata in inputs d${d} ${seed}`);
    switch (desc.stage) {
      case 'r1-normalise':
        assert.deepEqual(Object.keys(task.inputs).sort(), ['invoice_list', 'ledger_notes', 'ledger_spec']);
        if (desc.item.system !== 'VERITAS') for (const x of truth.invoices) assert.ok(!text.includes(x.date), `ISO date ${x.date} visible (${desc.item.system}) d${d} ${seed}`);
        for (const x of truth.invoices) assert.ok(!text.includes(`"usd_cents":${x.usd_cents}`) && !text.includes(canonical(x)));
        break;
      case 'r2-route':
        assert.deepEqual(Object.keys(task.inputs).sort(), ['document', 'notes', 'parties']);
        assert.ok(!text.includes(`"kind":"${truth.kind}"`));
        assert.ok(!/\b(variant|decoy|hedged|undecidable)\b/i.test(task.inputs.document));
        break;
      case 'r3-classify': {
        assert.deepEqual(Object.keys(task.inputs).sort(), ['ap_notes', 'audit_spec', 'difference', 'statement', 'supplier']);
        const notSpec = `${JSON.stringify(task.inputs.difference)}\n${task.inputs.supplier}\n${task.inputs.statement}\n${task.inputs.ap_notes}`;
        assert.ok(!notSpec.includes(truth.reason), `reason code ${truth.reason} outside the spec d${d} ${seed}`);
        assert.deepEqual(Object.keys(task.inputs.difference).sort(), ['amount_minor', 'date', 'ledger_count', 'ref', 'stmt_count', 'type']);
        break;
      }
      case 'r6-worker':
        assert.deepEqual(Object.keys(task.inputs).sort(), ['candidate', 'corpus', 'properties', 'question', 'register']);
        assert.ok(!/\b(in_scope|void_doc_ids)\b/.test(JSON.stringify(task.inputs)) && !/\b(in_scope|void_doc_ids)\b/.test(Object.values(task.files).join('\n')));
        assert.ok(!/\bT[1-6]\b/.test(task.prompt));
        break;
      default: assert.fail(desc.stage);
    }
  }
});

// The stage truth equals what the full rung's own computation says for that item (the rung's exported referenceTrace on
// the rung task with the same seed, split and rung difficulty), and the surface is the rung's own text, byte for byte.
test('cross-check: every stage truth equals the full rung\'s truth for that item (>= 10 seeds per kind), surface is the rung\'s', () => {
  const checked = Object.fromEntries(bed.STAGES.map(s => [s, 0]));
  for (const d of DIFFICULTIES) for (const seed of SEEDS) {
    const task = gen(seed, d);
    const desc = bed.describeTask(task);
    const truth = bed.referenceSolve(task);
    const rt = { seed, split: 'dev', difficulty: desc.rungDifficulty };
    assert.equal(desc.rungDifficulty, bed.RUNG_DIFFICULTY[d]);
    switch (desc.stage) {
      case 'r1-normalise': {
        const rungTask = rungR1.generate(rt);
        const trace = rungR1.referenceTrace(rungTask);
        const nos = new Set(desc.rungRef.invoices);
        const rung = trace.normalise.invoices.filter(x => nos.has(x.invoice));
        assert.equal(canonical(rung), canonical(truth.invoices), `r1 d${d} ${seed}`);
        assert.equal(rung.length, truth.invoices.length);
        assert.equal(task.inputs.invoice_list, rungTask.inputs.invoices[desc.item.system]);
        // every invoice of the rung's extract for this system is in the list, none of another system
        assert.equal(trace.extract.invoices.filter(x => x.system === desc.item.system).length, truth.invoices.length);
        const [head, para] = task.inputs.ledger_notes.split('\n\n');
        assert.ok(rungTask.inputs.ledger_notes.startsWith(head) && rungTask.inputs.ledger_notes.includes(`\n\n${para}\n\n`));
        for (const p of task.inputs.ledger_spec.split('\n\n')) assert.ok(rungTask.inputs.ledger_spec.includes(p));
        break;
      }
      case 'r2-route': {
        const rungTask = rungR2.generate(rt);
        const trace = rungR2.referenceTrace(rungTask);
        const rung = trace.route.routing.find(x => x.doc === desc.rungRef.doc);
        assert.equal(canonical(rung), canonical(truth), `r2 d${d} ${seed}`);
        assert.ok(rungTask.inputs.inbox.includes(task.inputs.document));
        assert.ok(rungTask.inputs.inbox.split('\n\n=== DOC ').length > 1);
        assert.equal(task.inputs.notes, rungTask.inputs.notes);
        assert.equal(task.inputs.parties, rungTask.inputs.parties);
        break;
      }
      case 'r3-classify': {
        const rungTask = rungR3.generate(rt);
        const trace = rungR3.referenceTrace(rungTask);
        const { vendor_id: vid, ref } = desc.rungRef;
        const disc = trace.classify.items.find(x => x.vendor_id === vid).discrepancies.filter(x => refKey(x.ref) === refKey(ref));
        assert.equal(disc.length, 1);
        assert.equal(disc[0].reason, truth.reason, `r3 d${d} ${seed}`);
        assert.equal(trace.reduce.statements.find(s => s.vendor_id === vid).discrepancies.find(x => refKey(x.ref) === refKey(ref)).reason, truth.reason);
        const mdiff = trace.match.items.find(x => x.vendor_id === vid).differences.find(x => refKey(x.ref) === refKey(ref));
        assert.equal(canonical(mdiff), canonical(task.inputs.difference));
        const file = task.inputs.supplier.split(' | ').at(-1);
        assert.equal(task.inputs.statement, rungTask.inputs.statements[file]);
        assert.equal(task.inputs.ap_notes, rungTask.inputs.ap_notes);
        assert.ok(rungTask.inputs.vendors.split('\n').includes(task.inputs.supplier));
        for (const p of task.inputs.audit_spec.split('\n\n')) for (const line of p.split('\n')) assert.ok(rungTask.inputs.audit_spec.includes(line));
        break;
      }
      case 'r6-worker': {
        const rungTask = rungR6.generate(rt);
        const trace = rungR6.referenceTrace(rungTask);
        const item = trace.worker.items.find(x => x.entity === desc.rungRef.entity);
        assert.ok(trace.plan.candidates.includes(desc.rungRef.entity));
        const { entity, ...rest } = item;
        assert.equal(entity, desc.rungRef.entity);
        assert.equal(canonical(rest), canonical(truth), `r6 d${d} ${seed}`);
        // in-scope workers reach the rung's final answer: their cells are the rung's table rows for the compound
        const rows = rungR6.referenceSolve(rungTask).table.filter(r => r.entity === entity);
        assert.equal(rows.length, truth.in_scope ? truth.cells.length : 0);
        for (const [p, f] of Object.entries(task.files)) assert.equal(f, rungTask.files[p], p);
        const w = buildWide(seed, 'dev', desc.rungDifficulty);
        assert.equal(Object.keys(task.files).length, workerSlice(w, entity).length);
        for (const line of task.prompt.split('\n').filter(l => /^([1-8]\. |- |Question: )/.test(l))) assert.ok(rungTask.prompt.split('\n').includes(line), line);
        assert.equal(canonical(task.inputs.register), canonical(rungTask.inputs.register));
        break;
      }
      default: assert.fail(desc.stage);
    }
    checked[desc.stage]++;
  }
  for (const s of bed.STAGES) assert.ok(checked[s] >= 10, `${s}: ${checked[s]} cross-checked`);
});

test('difficulty moves item ambiguity with the rung\'s own knobs (rung difficulty, planted cases; surface baselines)', () => {
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const scores = {}, base = {};
  for (const d of DIFFICULTIES) for (const seed of SEEDS) {
    const task = gen(seed, d);
    const desc = bed.describeTask(task);
    (scores[desc.stage] ??= {})[d] ??= [];
    scores[desc.stage][d].push(desc.item.score);
    const b = bed.surfaceBaseline(task);
    if (b) { const k = `${desc.stage}:${d}`; base[k] ??= [0, 0]; base[k][1]++; if (bed.oracle(task, b).pass) base[k][0]++; }
  }
  for (const s of bed.STAGES) {
    for (let d = 2; d <= 5; d++) assert.ok(mean(scores[s][d]) >= mean(scores[s][d - 1]) - 0.5, `${s} ambiguity falls d${d - 1}->d${d}`);
    assert.ok(mean(scores[s][5]) > mean(scores[s][1]), `${s} ambiguity d5 vs d1`);
  }
  const rate = k => base[k][0] / base[k][1];
  // R2: every d1 document is routed right by the rung's keyword router; no d3-d5 document is
  assert.equal(rate('r2-route:1'), 1);
  for (const d of [3, 4, 5]) assert.equal(rate(`r2-route:${d}`), 0, `r2 keyword baseline d${d}`);
  // R3: counts and the cut-off decide every d1 discrepancy; from d2 the notes decide (UNEXPLAINED stays a default)
  assert.equal(rate('r3-classify:1'), 1);
  for (const d of [2, 3, 4, 5]) assert.ok(rate(`r3-classify:${d}`) <= 0.7, `r3 rule baseline d${d}: ${rate(`r3-classify:${d}`)}`);
});

test('input size per difficulty stays within the documented ranges (README table)', () => {
  // [min, max] tokens (utf8 bytes / 4 over prompt + inputs + files) per kind and difficulty, measured on dev 601-640, with slack
  const RANGE = {
    'r1-normalise': [[700, 2600], [700, 2600], [800, 3000], [800, 3000], [1500, 3500]],
    'r2-route': [[1000, 1500], [1000, 1500], [1100, 1600], [1200, 1800], [1300, 1900]],
    'r3-classify': [[900, 1800], [900, 1800], [1000, 2000], [1300, 2800], [1500, 3000]],
    'r6-worker': [[3000, 8000], [3000, 8000], [4000, 10000], [5000, 12000], [7500, 13000]],
  };
  for (const d of DIFFICULTIES) for (const seed of SEEDS) {
    const task = gen(seed, d);
    const kind = kindOf(task);
    const [lo, hi] = RANGE[kind][d - 1];
    const t = task.budget.inputTokensEstimate;
    assert.ok(t >= lo && t <= hi, `${kind} d${d} seed ${seed}: ${t} tokens outside [${lo}, ${hi}]`);
  }
});

// ---- regression tests for the adversarial review of 2026-10-14 (one per fixed defect) ----
const forbiddenKeys = new Set(['pattern', 'oneOf', 'anyOf', 'allOf', 'uniqueItems', '$ref', 'format']);
const portable = s => !s || typeof s !== 'object' || Object.entries(s).every(([k, v]) => !forbiddenKeys.has(k) && portable(v));
const KIND_SEEDS = SEEDS.slice(0, 20);

// Major 1: the router harness featurises and labels per family id and calls generate({seed, split, difficulty}) without
// `stage` (experiments/lib/beds.mjs makeTasks; features.mjs familyFeatures at seeds 601-603, d3), so need-stage alone
// gives one blended vector. Each kind is also a homogeneous family `need-stage/<kind>` that the same loader resolves.
test('regression (major 1): per-kind families load through the harness loader and are homogeneous, same cases as need-stage', async () => {
  const { loadFamily, makeTasks } = await import('../../experiments/lib/beds.mjs');
  assert.deepEqual(bed.family.kindFamilies, bed.STAGES.map(s => `need-stage/${s}`));
  assert.deepEqual(Object.values(bed.KIND_FAMILY_IDS), bed.family.kindFamilies);
  // the README caveat: the mixed family's harness example seeds blend three kinds and never sample r1-normalise
  assert.deepEqual([601, 602, 603].map(s => bed.stageOf(s)), ['r3-classify', 'r2-route', 'r6-worker']);
  for (const stage of bed.STAGES) {
    const id = bed.KIND_FAMILY_IDS[stage];
    const K = await loadFamily(id);
    const direct = await import(`./${stage}/index.mjs`);
    assert.equal(K.generate, direct.generate, `${id} resolves to beds/need-stage/${stage}/index.mjs`);
    assert.equal(K.family.id, id);
    assert.equal(K.family.version, '1.0.0');
    assert.equal(K.family.kind, 'oneshot');
    assert.equal(K.family.role, 'need-anchor');
    assert.equal(K.family.parent, 'need-stage');
    assert.equal(K.family.stage, stage);
    assert.match(K.family.description, /Hypothesis \(not a fact\)/);
    assert.equal(K.outputSchema, bed.stageSchemas[stage], 'the kind\'s strict schema, not the union envelope');
    assert.ok(portable(K.outputSchema));
    for (const n of ['empty', 'shuffled-or-corrupted', 'plausible-but-wrong']) assert.ok(K.badControls.some(c => c.name === n), n);
    for (const d of DIFFICULTIES) {
      const made = await makeTasks(id, { seeds: [601, 602, 603], difficulty: d });
      for (const { task } of made) {
        assert.equal(K.describeTask(task).stage, stage, `${id} d${d} seed ${task.seed}`);
        assert.equal(task.family, id);
        assert.equal(task.id, `${id}/dev/d${d}/${task.seed}`);
        assert.deepEqual(task.knobs, { stage });
        assert.equal(JSON.stringify(K.generate({ seed: task.seed, split: 'dev', difficulty: d })), JSON.stringify(task));
        // the same case as need-stage with the stage override: surface, budget and truth identical
        const p = gen(task.seed, d, { stage });
        for (const k of ['prompt', 'inputs', 'files', 'budget']) assert.equal(JSON.stringify(task[k]), JSON.stringify(p[k]), `${id} ${k}`);
        assert.equal(canonical(K.referenceSolve(task)), canonical(bed.referenceSolve(p)));
        assert.equal(bed.oracle(task, K.referenceSolve(task)).pass, true, 'need-stage scores a per-kind task through knobs.stage');
      }
    }
    const other = bed.STAGES.find(s => s !== stage);
    assert.throws(() => K.generate({ seed: 601, split: 'dev', difficulty: 3, stage: other }));
    assert.equal(K.generate({ seed: 601, split: 'dev', difficulty: 3, stage }).family, id);
    // the per-kind oracle fixes its kind: a forged knobs.stage on the task changes nothing
    const t = K.generate({ seed: 605, split: 'dev', difficulty: 3 });
    assert.equal(K.oracle({ ...t, knobs: { stage: other } }, K.referenceSolve(t)).pass, true);
    assert.equal(K.oracle({ ...t, knobs: { stage: other } }, bed.referenceSolve({ ...t, knobs: { stage: other } })).pass, false);
  }
});

test('regression (major 1): per-kind families pass the contract checks (reference passes, every bad control fails, 20 seeds x 5 levels)', async () => {
  for (const stage of bed.STAGES) {
    const K = await import(`./${stage}/index.mjs`);
    for (const d of DIFFICULTIES) {
      let pass = 0;
      const fails = Object.fromEntries(K.badControls.map(c => [c.name, 0]));
      for (const seed of KIND_SEEDS) {
        const task = K.generate({ seed, split: 'dev', difficulty: d });
        const o = K.oracle(task, K.referenceSolve(task));
        assert.equal(o.pass, true, `${stage} d${d} ${seed}: ${JSON.stringify(o.details)}`);
        pass++;
        for (const c of K.badControls) {
          const b = K.oracle(task, c.make(task));
          assert.equal(b.pass, false, `${stage} ${c.name} passes d${d} ${seed}`);
          assert.ok(b.score < 1);
          fails[c.name]++;
        }
      }
      assert.ok(pass >= 20);
      for (const [n, f] of Object.entries(fails)) assert.ok(f >= 20, `${stage} d${d} ${n}`);
    }
  }
});

test('regression (major 1): router features of a per-kind family describe that kind only', async () => {
  const { familyFeatures, taskFeatures, schemaLeaves } = await import('../../experiments/need-router/features.mjs');
  const med = xs => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const feats = {};
  for (const stage of bed.STAGES) {
    const f = feats[stage] = await familyFeatures(bed.KIND_FAMILY_IDS[stage]); // the harness defaults: dev seeds 601-603, d3
    const rows = [601, 602, 603].map(s => taskFeatures(gen(s, 3, { stage }), bed.stageSchemas[stage]));
    for (const k of Object.keys(f)) assert.equal(f[k], +med(rows.map(r => r[k])).toFixed(4), `${stage} ${k}`);
    assert.equal(f.logSchemaLeaves, +Math.log10(1 + schemaLeaves(bed.stageSchemas[stage])).toFixed(4));
  }
  // the kinds differ where their hypotheses differ: the worker slice is several times the size of one routed document
  assert.ok(feats['r6-worker'].logInputTokens > feats['r2-route'].logInputTokens + 0.3);
  // the mixed family's vector at the same seeds equals none of r1's (it never samples r1 there)
  const mixed = await familyFeatures('need-stage');
  assert.notDeepEqual(mixed, feats['r1-normalise']);
});

// Minor 2: label-run's schemaValid / deployableVerdict compile fam.outputSchema; the need-stage envelope has no
// `required`, so {} and another kind's shape were schema-valid and deployable. deployableCheck applies the kind's schema.
test('regression (minor 2): deployableCheck rejects {} and other kinds\' shapes; the envelope alone would accept them', async () => {
  const { compileDataSchema } = await import('../../src/validate.mjs');
  const envelope = compileDataSchema(bed.outputSchema, { trustedSchema: true });
  const shapes = { 'r1-normalise': { invoices: [] }, 'r2-route': { doc: 1, kind: 'invoice' }, 'r3-classify': { reason: 'TIMING' },
    'r6-worker': { in_scope: false, cells: [], void_doc_ids: [] } };
  // the reviewer's case: task 604 at d3 is r1-normalise
  const t604 = gen(604, 3);
  assert.equal(kindOf(t604), 'r1-normalise');
  for (const out of [{}, { reason: 'TIMING' }, { doc: 1, kind: 'invoice' }, { in_scope: false, cells: [], void_doc_ids: [] }]) {
    assert.equal(envelope(out), true, `envelope accepts ${JSON.stringify(out)}`);
    assert.equal(bed.deployableCheck(t604, out), false, `deployableCheck accepts ${JSON.stringify(out)}`);
  }
  for (const stage of bed.STAGES) {
    const K = await import(`./${stage}/index.mjs`);
    const strict = compileDataSchema(K.outputSchema, { trustedSchema: true });
    for (const seed of SEEDS.slice(0, 5)) {
      for (const [task, check] of [[gen(seed, 3, { stage }), bed.deployableCheck], [K.generate({ seed, split: 'dev', difficulty: 3 }), K.deployableCheck]]) {
        assert.equal(check(task, bed.referenceSolve(task)), true);
        // deployable means schema-valid, not right: the planted near misses are deployable and fail the oracle
        for (const c of bed.badControls.filter(x => x.name.startsWith('plausible-but-wrong'))) assert.equal(check(task, c.make(task)), true, `${stage} ${c.name}`);
        assert.equal(check(task, {}), false);
        assert.equal(check(task, { ...bed.referenceSolve(task), extra_field: 1 }), false);
        assert.equal(check(task, null), false);
        for (const [s2, shape] of Object.entries(shapes)) if (s2 !== stage) {
          assert.equal(check(task, shape), false, `${stage} task accepts the ${s2} shape`);
          assert.equal(bed.oracle(task, shape).pass, false);
        }
        assert.equal(check(task, shapes[stage]), true, `${stage} own minimal shape`);
      }
      assert.equal(strict({}), false, `${stage} strict outputSchema accepts {} in the harness compiler`);
    }
  }
});

// Minor 3: at level 4 the out-of-scope roles scored 1-2 against WANT 3, so every level-4 R6 item was in scope and a
// constant in_scope:true prior got every scope verdict right. Level 4 now draws its scope side first.
test('regression (minor 3): r6-worker level 4 has a reachable out-of-scope share; level 5 is in scope by design', async () => {
  const K = await import('./r6-worker/index.mjs');
  for (const split of ['dev', 'test']) {
    let out = 0;
    for (const seed of SEEDS) {
      const task = K.generate({ seed, split, difficulty: 4 });
      const truth = K.referenceSolve(task), item = K.describeTask(task).item;
      assert.equal(truth.in_scope, item.role === 'in', `${split} ${seed}`);
      if (!truth.in_scope) {
        out++;
        assert.ok(['T1', 'T2', 'T3', 'T4'].includes(item.role));
        assert.equal(truth.cells.length, 0);
        // the constant prior is wrong here, and so is any answer that only gets the void set right
        assert.equal(K.oracle(task, { in_scope: true, cells: [], void_doc_ids: truth.void_doc_ids }).pass, false);
      } else assert.ok(item.score >= 2, `${split} ${seed}: an in-scope level-4 item has ambiguity 3 (2 when no 3 has a near miss)`);
    }
    assert.ok(out >= 12 && out <= 28, `${split} level 4 out of scope: ${out}/40`);
  }
  // level 5: in scope by design (README); the cells, not the scope verdict, carry the difficulty
  for (const seed of KIND_SEEDS) {
    const task = K.generate({ seed, split: 'dev', difficulty: 5 });
    assert.equal(K.referenceSolve(task).in_scope, true);
    assert.ok(K.describeTask(task).item.score >= 3);
  }
});
