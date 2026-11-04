// Tests for C2-2 (consumer conformance gate and its blind-spot suppliers). No model is called ($0); no sandbox needed.
//   nice -n 15 node --test --test-concurrency=1 experiments/reuse/test/c22.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { admitByConformance, gateItem, widenedProfiles } from '../conformance.mjs';
import { learnInputProfile, learnTraceProfile, traceDoc } from '../gate.mjs';
import { C22_SIZES, HIST_SMALL, T_KINDS, generateC22, historyOf, labelOf, worldsC22 } from '../gen-c22.mjs';
import { CLASSES, SOURCES, sopScoreOf, truthOf } from '../program-b.mjs';
import { callTool, makeWorld, DG_TOOLS, TEXT_FIELDS } from '../world-b.mjs';
import { gateMetrics, gateVerdicts, projection } from '../c22.mjs';

const BANK = Array.from({ length: 20 }, (_, i) => ({ row: i + 1, total: 4 + (i % 17) }));
const ORDER = Object.keys(DG_TOOLS);

test('admission: all-labels rule; M3 serves only with 60 conforming decisions and no failure', () => {
  const d = (n, bad = 0) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, conform: i >= bad }));
  assert.equal(admitByConformance(d(15)).admit, true);
  assert.equal(admitByConformance(d(15, 1)).admit, false);
  assert.equal(admitByConformance([]).admit, false);
  const m15 = admitByConformance(d(15), { rule: 'm3' });
  assert.equal(m15.admit, false);                         // too few decisions for the M3 rule
  assert.equal(m15.m3.decision, 'no-decision');
  const m60 = admitByConformance(d(60), { rule: 'm3' });
  assert.equal(m60.admit, true);
  assert.ok(m60.m3.upper <= 0.05);
  assert.equal(admitByConformance(d(60, 1), { rule: 'm3' }).admit, false);
  assert.throws(() => admitByConformance(d(3), { rule: 'x' }));
});

// A synthetic run of the dangerous_goods tools (the host's call log and the workflow's trace events).
const runOf = (scores, { answer = 'Hazard Class B', asString = false, error = null, path = ['5.1', '5.2', '5.3', '5.4', '5.5', '5.6', '5.7'] } = {}) => ({
  calls: ORDER.map((name, i) => ({ name, content: error ? `Error: ${error}` : JSON.stringify({ product_id: 'P_10000', [DG_TOOLS[name].key]: asString ? String(scores[i]) : scores[i] }) })),
  events: path.map(name => ({ kind: 'phase-start', name })), answer: { hazard_class: answer }, status: 'done' });
const texts = ['Severe irritant', 'Low health risk', 'Strong oxidant', 'Compressed neon', 'Eye irritant', 'High explosive', 'Contact toxicity', 'Infectious agent', 'Minimal impact', 'Cryogenic substance', 'Pyrophoric solid', 'Water reactive gas'];
const taskOf = i => ({ inputs: { product_id: `P_1${String(3000 + i * 7).padStart(4, '0')}`, sds_label_text: texts[i % texts.length] } });

test('widened profiles: a branch only the consumer\'s conforming history reached is admitted; a new shape still is not', () => {
  const profiles = { input: learnInputProfile(Array.from({ length: 12 }, (_, i) => taskOf(i))),
    trace: learnTraceProfile(Array.from({ length: 12 }, (_, i) => runOf([1 + (i % 5), 2 + (i % 4), 1 + (i % 3), 5 - (i % 5)], { answer: CLASSES[i % 4] }))) };
  const unable = runOf([3, 3, 3, 3], { answer: 'Unable to Decide' });
  assert.equal(gateItem(profiles, taskOf(1), traceDoc(unable)).accept, false);       // A's proof never answered Unable
  const hist = [{ task: taskOf(2), doc: traceDoc(unable), conform: true }, { task: taskOf(3), doc: traceDoc(unable), conform: true }];
  const wide = widenedProfiles(profiles, hist);
  assert.equal(gateItem(wide, taskOf(1), traceDoc(unable)).accept, true);
  assert.equal(gateItem(wide, taskOf(1), traceDoc(runOf([3, 3, 3, 3], { asString: true }))).accept, false);
  // A history run that missed its label does not widen anything.
  const notWide = widenedProfiles(profiles, hist.map(h => ({ ...h, conform: false })));
  assert.equal(gateItem(notWide, taskOf(1), traceDoc(unable)).accept, false);
  assert.equal(notWide.trace, profiles.trace);
});

test('C2-2 generator: deterministic, unique ids, truth = real SOP scores; T1 stream inverted, T2 answers strings, T3 sub-brand, T4 one wrong label', () => {
  const m = generateC22({ seed: 'unit', bank: BANK });
  const again = generateC22({ seed: 'unit', bank: BANK });
  assert.equal(m.sha256, again.sha256);
  assert.notEqual(generateC22({ seed: 'unit-2', bank: BANK }).sha256, m.sha256);
  assert.equal(new Set(m.products.map(p => p.id)).size, m.products.length);
  assert.deepEqual(Object.keys(m.sources), [...Object.keys(SOURCES), ...Object.keys(T_KINDS)]);
  for (const s of Object.keys(m.sources)) assert.equal(historyOf(m, s).length, C22_SIZES.pool);
  const texts0 = Object.fromEntries(TEXT_FIELDS.map(f => [f, 'x']));
  const real = p => truthOf({ source: 'S0', id: p.id, raw: p.sop, inMaster: p.inMaster, texts: texts0 }).hazard_class;
  for (const T of Object.keys(T_KINDS)) for (const p of m.products.filter(x => x.source === T)) assert.equal(p.truth.hazard_class, real(p), `${T} ${p.id}`);
  const t1 = m.products.filter(p => p.source === 'T1');
  for (const p of t1.filter(x => x.role === 'pool')) assert.deepEqual(p.raw, p.sop);
  const t1e = t1.filter(x => x.role === 'eval');
  assert.ok(t1e.length > 0 && t1e.every(p => p.drift === 'stored' && Object.keys(p.raw).every(c => sopScoreOf('S4', p.raw[c]) === p.sop[c])));
  assert.ok(m.products.filter(p => p.source === 'T2' && p.role === 'eval').every(p => p.drift === 'response'));
  const t3 = m.products.filter(p => p.source === 'T3');
  const sub = t3.filter(p => p.subBrand);
  assert.ok(sub.length > 0 && sub.length < t3.length / 4, `sub-brand ${sub.length}/${t3.length}`);
  const t4 = historyOf(m, 'T4');
  const noisy = t4.filter(p => labelOf(p) !== p.truth.hazard_class);
  assert.equal(noisy.length, 1);
  assert.ok(t4.slice(0, HIST_SMALL).includes(noisy[0]));
  assert.ok(CLASSES.includes(noisy[0].label) && Math.abs(CLASSES.indexOf(noisy[0].label) - CLASSES.indexOf(noisy[0].truth.hazard_class)) === 1);
  // Worlds: T2's stream answers strings, its history numbers; S5 adds its fields at both times.
  const w = worldsC22(m, { toolOrder: ORDER, makeWorld });
  const p2 = m.products.find(p => p.source === 'T2' && p.role === 'eval' && Number.isInteger(p.raw.safety) && p.raw.safety > 0);
  const args = JSON.stringify({ product_id: p2.id, sds_label_text: 'x' });
  assert.match(callTool(w.T2.stream, 'calculate_sds_label_score', args).content, /"sds_label_score": "\d"/);
  assert.match(callTool(w.T2.history, 'calculate_sds_label_score', args).content, /"sds_label_score": \d/);
  const p5 = m.products.find(p => p.source === 'S5' && Number.isInteger(p.raw.safety));
  assert.match(callTool(w.S5.history, 'calculate_sds_label_score', JSON.stringify({ product_id: p5.id, sds_label_text: 'x' })).content, /model_version/);
});

test('gate verdicts and metrics: admission per supplier, b3c per item, wrong reuse, false deopt, builds needed, accuracy bound', () => {
  const profiles = { input: learnInputProfile(Array.from({ length: 12 }, (_, i) => taskOf(i))),
    trace: learnTraceProfile(Array.from({ length: 12 }, (_, i) => runOf([1 + (i % 5), 2 + (i % 4), 1 + (i % 3), 5 - (i % 5)], { answer: CLASSES[i % 4] }))) };
  const h = (src, n, bad = 0) => Array.from({ length: n }, (_, i) => ({ id: `${src}h${i}`, conform: i >= bad, task: taskOf(i), doc: traceDoc(runOf([3, 3, 3, 3])) }));
  const hist = new Map([['A', h('A', 60)], ['B', h('B', 60, 1)], ['C', h('C', 15)]]);
  const ok = { g2: { accept: true }, g3: { accept: true } };
  const s = (id, source, correct, run = runOf([3, 3, 3, 3])) => ({ id, source, shipment: `${source}-sh`, correct, task: taskOf(1), doc: traceDoc(run), variants: ok });
  const stream = [s('a1', 'A', true), s('a2', 'A', false), s('a3', 'A', true, runOf([3, 3, 3, 3], { asString: true })), s('b1', 'B', true), s('c1', 'C', true)];
  const v = gateVerdicts({ profiles, hist, stream });
  const g = id => v.find(x => x.id === id).gates;
  assert.equal(g('a1')['G0-M3+b3c'], true);
  assert.equal(g('a2')['G0-M3+b3c'], true);            // conformance cannot see a wrong answer of a known shape
  assert.equal(g('a3')['G0-M3+b3c'], false);           // a new response type is refused per item
  assert.equal(g('b1')['G0-15'], false);               // the one failed history label is among the first 15
  assert.equal(g('c1')['G0-15'], true);
  assert.equal(g('c1')['G0-M3'], false);               // 15 history items cannot satisfy M3
  const m = gateMetrics(v, 'G0-M3+b3c');
  assert.deepEqual([m.accepted, m.wrongReuse, m.deopt, m.falseDeopt, m.buildsNeeded], [2, 1, 3, 3, 3]);
  const pr = projection(m, { nSources: 3, runMsPerItem: 1000 });
  assert.equal(pr.accuracyGapLowerBound, -1 / 5);
  assert.ok(pr.reuseUsdPerItem <= pr.scratchUsdPerItem);
});
