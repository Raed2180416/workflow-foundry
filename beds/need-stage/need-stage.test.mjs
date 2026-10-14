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
  for (const fn of ['generate', 'oracle', 'referenceSolve', 'describeTask', 'stageOf', 'outputSchemaOf']) assert.equal(typeof bed[fn], 'function');
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
    'r6-worker': [[3000, 8000], [3000, 8000], [4000, 10000], [6000, 12000], [7500, 13000]],
  };
  for (const d of DIFFICULTIES) for (const seed of SEEDS) {
    const task = gen(seed, d);
    const kind = kindOf(task);
    const [lo, hi] = RANGE[kind][d - 1];
    const t = task.budget.inputTokensEstimate;
    assert.ok(t >= lo && t <= hi, `${kind} d${d} seed ${seed}: ${t} tokens outside [${lo}, ${hi}]`);
  }
});
