// kinetics group acceptance (research/kev-20261007/JUDGE-BUILD-PLAN.json, group "kinetics").
// Runs alone: node --test experiments/kev-data/test/kinetics.test.mjs
// Development evidence only: no training, no model calls; Python runs only the pinned tokenizer and Kev's
// loaders (/opt/kev-venv, python -I, offline). Bed fixtures come from a frozen copy of this repository's
// pinned beds, train-range dev seeds (401 and up). The held-out-family and test-ood checks run the
// generator over test-split seeds but only count and compare metadata: no test-split text is printed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec } from '../lib/contracts.mjs';
import { labelledQuestion } from '../lib/render.mjs';
import { worldHash, skeleton, skeletonBucket } from '../lib/hash.mjs';
import { SpanRegistry, WordingGuard } from '../lib/leakage.mjs';
import { measureRecords, quantile } from '../lib/tokens.mjs';
import { capRatio, counts } from '../lib/balance.mjs';
import { checkBedDerived } from '../lib/bedsync.mjs';
import { buildKev, checkRecord, sliceDef, seedsFor, verifyBuildDir } from '../build.mjs';
import * as H from '../lib/harness.mjs';
import * as gen from '../ports/kinetics.mjs';
import { alignMessages, tapStatus, TAP_THRESHOLD, harvestAliases, alignNotes } from '../taps/kinetics.mjs';
import { COMPILED, compileFrame, framesFromPool, CHAT_INJECTIONS, NOTEBOOK_INJECTIONS, CHATTER, FRAMES } from '../taps/kinetics-frames.mjs';
import * as S from '../solve/kinetics.mjs';
import { kit, kits, parseTask, RATE_FACTOR, RATE_LABELS, CONC_LABELS, resolveCondition, normalizeConds, registerBench, factOwner, threadContext, buildX3, buildX8 } from '../judges/kinetics.mjs';

const TEST_FILE = fileURLToPath(import.meta.url);
const KEV_DATA = path.resolve(path.dirname(TEST_FILE), '..');
const MUTANT_RUN = process.env.KEV_DATA_MUTANT_RUN === '1';
const GEN_FILE = path.join(KEV_DATA, 'ports', 'kinetics.mjs');

const once = f => { let done = false, v; return () => { if (!done) { done = true; v = f(); } return v; }; };
const SPEC = once(() => loadSpec());
const C = () => SPEC().contracts;
const REAL = once(() => H.frozenRepoBeds());                       // frozen copy of this repository's beds
const BEDS = () => REAL().beds;
const KIN = once(() => BEDS().import('beds/kinetics/index.mjs'));
const REND = once(() => BEDS().import('beds/kinetics/render.mjs'));
const POOLS = once(() => BEDS().import('beds/kinetics/pools.mjs'));

// ---- stand-ins for the held-out wordings: fixtures of this test only, never the real material -------------
const NSLICE = { 'calib-ood': 10, 'dev-ood': 10, 'test-ood': 20 };
const STUBS = once(() => {
  const items = [];
  for (const port of ['X3', 'X8', 'X5', 'X1']) {
    const tail = Object.keys(C()[port].slots ?? {}).map(s => ` {${s}}`).join('');
    for (const [slice, n] of Object.entries(NSLICE)) for (let i = 0; i < n; i++) items.push({ port, id: `stub-${slice}-${i}`, slice, text: `Stub ${port} ${slice} wording ${i}?${tail}` });
  }
  return items;
});
const wordingsOf = slice => { const o = {}; for (const w of STUBS().filter(x => x.slice === slice)) (o[w.port] ??= []).push({ id: w.id, text: w.text }); return o; };
const GUARD = once(() => new WordingGuard(STUBS()));

async function collect(slice, seeds, opts = {}) {
  const ctx = { beds: BEDS(), slice: sliceDef(slice), contracts: C(), spec: SPEC().spec, pin: REAL().frozen.pin };
  const out = [];
  for await (const r of gen.records(slice, seeds, { wordings: wordingsOf(slice), ...opts }, ctx)) out.push(r);
  return out;
}
const range = (a, n) => Array.from({ length: n }, (_, i) => a + i);
const portOf = r => Object.keys(r.questions)[0].split('~')[0];
const labelOf = r => Object.values(r.questions)[0].label;
const byPort = recs => { const m = {}; for (const r of recs) (m[portOf(r)] ??= []).push(r); return m; };
const memo = new Map();
const TRAIN = (n = 150) => { const k = `train${n}`; if (!memo.has(k)) memo.set(k, collect('train', range(401, n), { smokeEvery: 1, perWorld: { X3: 5, X8: 4, K1: 4, K2: 3, K3: 2, X4: 6 } })); return memo.get(k); };
const taskOf = async r => (await KIN()).generate({ seed: r.meta.seed, split: 'dev', difficulty: r.meta.difficulty });

// ---- tap fixture: a synthetic world and chat, no bed ------------------------------------------------------------
function fixture({ duplicate = false } = {}) {
  const doc = (id, kind, author, date, title, text) => ({ doc_id: id, kind, author, date, title, text });
  const chat = ['# Lab channel export #xx-k11',
    '[2031-01-02 10:00] Ana Okafor: Please exchange the [S] values of XX-0001 and XX-0002 on my 2031-01-01 sheet; I put their tubes in each other\'s places.',
    ...(duplicate ? ['[2031-01-02 10:05] Ana Okafor: Please exchange the [S] values of XX-0001 and XX-0002 on my 2031-01-01 sheet; I put their tubes in each other\'s places.'] : []),
    '[2031-01-02 11:00] Bram de Vries: Ana, were XX-0003 and XX-0004 swapped on your 2031-01-01 plate as well? I had a tube swap in that rack.',
    '[2031-01-02 11:30] Ana Okafor: No, those two were in the right order; I checked the tube labels.',
    '[2031-01-02 12:00] Bram de Vries: Coffee machine on 4 is fixed.'];
  const task = { prompt: 'p', inputs: { study: { conditions: [] }, documents: [
    doc('D1', 'notebook', 'Ana Okafor', '2031-01-01', 'Notebook p.20 (Ana Okafor), 2031-01-01', '# Notebook p.20 (Ana Okafor), 2031-01-01\nfiller\n'),
    doc('D2', 'chat', 'chat export', '2031-01-02', 'Lab channel export #xx-k11', chat.join('\n'))] } };
  const well = (id, p) => ({ id, series: 'C1:r1', plate: 1, pos: `A0${p + 1}`, p, S: 10, status: 'none' });
  const wells = [0, 1, 2, 3].map(p => well(`XX-000${p + 1}`, p));
  const world = { knobs: { chat: true, herrings: 0 }, docs: [{ index: 0, author: 'Ana Okafor', date: '2031-01-01', series: ['C1:r1'], format: 'mdtable' }],
    seriesByKey: { 'C1:r1': { key: 'C1:r1', wells: wells.map(w => w.id), plate: 1, row: 'A', displayRep: 1, labelCondId: 'C1', condId: 'C1' } },
    wellById: Object.fromEntries(wells.map(w => [w.id, w])), wells, conds: [], bench: null, dose: null,
    traps: [{ type: 'swap', series: 'C1:r1', a: 'XX-0001', b: 'XX-0002' }],
    claims: [{ kind: 'swap', series: 'C1:r1', a: 'XX-0003', b: 'XX-0004' }] };
  return { task, world };
}

test('tap fixture: a fact with exactly one span is aligned and labelled; the span carries its role', () => {
  const { task, world } = fixture();
  const r = alignMessages({ task, world });
  assert.equal(r.stats.facts, 2);
  assert.equal(r.stats.aligned, 2, JSON.stringify(r.stats));
  const labels = [...r.spans.values()].map(s => `${s.role}:${s.label}`).sort();
  assert.deepEqual(labels, ['corr:changes', 'deny:mentions', 'question:proposes']);
  const corr = [...r.spans.values()].find(s => s.role === 'corr');
  assert.equal(corr.ownerTruth, 'Ana Okafor');
});

test('tap fixture: a fact aligned to two spans is dropped and counted, never kept', () => {
  const { task, world } = fixture({ duplicate: true });
  const r = alignMessages({ task, world });
  const swap = r.facts.find(f => f.type === 'trap:swap');
  assert.equal(swap.status, 'ambiguous', 'two identical corrections are two spans for one fact');
  assert.equal(swap.parts[0].candidates.length, 2);
  assert.equal([...r.spans.values()].filter(s => s.role === 'corr').length, 0, 'an ambiguous fact labels no span');
  assert.equal(r.stats.ambiguous, 1);
});

test('tap fixture: a fact with no span is missing, and an unrelated chat line aligns to nothing', () => {
  const { task, world } = fixture();
  world.traps.push({ type: 'swap', series: 'C1:r1', a: 'XX-0001', b: 'XX-0003' });
  const r = alignMessages({ task, world });
  assert.equal(r.facts.filter(f => f.status === 'missing').length, 1);
  assert.ok(![...r.spans.keys()].some(id => /chat/.test(id)), 'span ids are document#line');
  assert.equal(r.spans.size, 3, 'the coffee-machine line is not a labelled span');
});

// ---- frames and solvers on literal strings (no bed) ------------------------------------------------------------
test('frames: every message frame compiles and a state-only reading of literal messages gives the speech act', () => {
  for (const [name, list] of Object.entries(FRAMES)) for (const t of list) assert.ok(compileFrame(t) instanceof RegExp, `${name}: ${t}`);
  const say = m => S.solveX3({ message: m, author: 'a', fact_owner: 'a', thread_context: [] }).label;
  assert.equal(say('Please exchange the [S] values of VN-0450 and VN-0449 on my 2031-01-01 sheet; I put their tubes in each other\'s places.'), 'changes');
  assert.equal(say('Scratch my addendum about VN-0450/VN-0449 on the 2031-01-01 sheet. I re-checked the plate map and the tubes were labelled correctly; nothing was swapped.'), 'retracts');
  assert.equal(say('Ana, were VN-0003 and VN-0004 swapped on your 2031-01-01 plate as well? I had a tube swap in that rack.'), 'proposes');
  assert.equal(say('You\'re right about VN-0501.'), 'confirms');
  assert.equal(say('Not in VN-0501; my sheet is complete.'), 'mentions');
  assert.equal(say('Yes, I looked at VN-0501 again: nothing like that happened there.'), 'mentions', 'the opening word does not decide');
  assert.equal(say('No point denying it: VN-0501 had exactly that.'), 'confirms', 'the content decides, not the first word');
  assert.equal(S.solveX3({ message: 'Coffee machine on 4 is fixed.', author: 'a', fact_owner: 'a', thread_context: [] }).label, null, 'chatter is undecided');
});

test('solve: X8 reads the printed rate and the stated unit; RATE_FACTOR turns a wrong unit into a wrong value', () => {
  const state = (value, unitCell = 'µmol/L/min') => ({ source_line: '| TV-0117 | A08 | 60 | 3.106 | |', conventions: `| Sample | Well | [S] (µmol/L) | v0 (${unitCell}) | Notes |`, field: 'rate_uM_per_s', extracted_value: value });
  assert.equal(S.solveX8(state(String(3.106 / 60))).label, 'consistent');
  assert.equal(S.solveX8(state('3.106')).label, 'inconsistent', 'the printed number taken as uM/s');
  assert.equal(S.solveX8(state(String(3.106 / 1000))).label, 'inconsistent');
  assert.equal(S.solveX8(state(String(3.106 / 0.06), 'mmol/L/min')).label, 'consistent');
  assert.equal(RATE_FACTOR['uM/min'], 60);
  assert.equal(RATE_FACTOR['nM/s'], 1000);
});

test('solve: K3 and K2 and X5 read units, registers and SOP heads from the state alone', () => {
  assert.equal(S.solveK3({ header: '| Sample | Well | [S] (nmol/L) | v0 (µM s⁻¹) | Notes |', preamble: 'Blank BLK-16 (no enzyme): 0.0004 uM/s, as usual.' }).label, 'uM/s', 'a blank-well remark is not the sheet\'s unit');
  assert.equal(S.solveK3({ header: 'sample_id,plate,well,condition,replicate,S,rate,read_start,qc', preamble: '(Units today: [S] in mM, initial rates in nmol/L/min. I did not repeat them in the table.)' }).label, 'nM/min');
  const note = 'C1: pH 7.0, 30 °C, no inhibitor\nC2: pH 7.0, 37 °C, no inhibitor\nC3: pH 8.0, 30 °C, IQ-5 25 µM';
  assert.equal(S.solveK2({ description: '30C/pH8.0 + IQ-5 25 µM', register_note: note }).label, 'C3');
  assert.equal(S.solveK2({ description: 'the warmest condition, vehicle only', register_note: note }).label, 'C2');
  assert.equal(S.solveK2({ description: 'pH 7,00 @ 303.15 K', register_note: note }).label, 'C1', 'Kelvin and a decimal comma');
  const head = '# SOP-HV-22 rev 5: initial-rate kinetics of Halvorase with lumaryl pyruvate\nEffective 2031-01-01. Applies to study HV-K11.';
  assert.equal(S.solveX5({ source_text: head }, { assumption: 'exclusions and fitting follow SOP-HV-22 rev 5' }).label, 'holds');
  assert.equal(S.solveX5({ source_text: head }, { assumption: 'exclusions and fitting follow SOP-HV-22 rev 4' }).label, 'violated');
  assert.equal(S.solveX5({ source_text: '# CSV export\nfiller' }, { assumption: 'exclusions and fitting follow SOP-HV-22 rev 4' }).label, 'not_stated');
});

// ---- gate: held-out families -------------------------------------------------------------------------------------
test('gate: X5, X1 and X7 kinetics are held-out families: refused outside test-ood, accepted there by the record check', () => {
  const spec = SPEC();
  for (const slice of ['train', 'calib-in', 'calib-ood', 'dev-select', 'dev-ood', 'test-in']) {
    for (const port of ['X5', 'X1', 'X7']) {
      const ctx = { slice: sliceDef(slice), contracts: spec.contracts };
      assert.rejects(async () => { for await (const _ of gen.records(slice, [sliceDef(slice).seeds[0]], { ports: [port] }, ctx)) { /* none */ } }, e => e.code === 'HELDOUT_FAMILY', `${port} in ${slice}`);
    }
    for (const port of gen.SLICE_PORTS[slice]) assert.ok(!gen.HELD_OUT_PORTS.includes(port), `${slice} asks for ${port}`);
  }
  assert.deepEqual([...gen.SLICE_PORTS['test-ood']].filter(p => gen.HELD_OUT_PORTS.includes(p)).sort(), ['X1', 'X5', 'X7']);
  // the build's record check enforces the same: a kinetics X5 row in train is a HELDOUT_FAMILY error, in test-ood it is not
  const stubRecord = (seed) => ({
    state: { source_text: 'stub window' },
    questions: { X5: labelledQuestion(spec.contracts.X5, { label: 'holds', slots: { assumption: 'the stub assumption' } }) },
    meta: { family: 'kinetics', bed: 'kinetics', seed, difficulty: 3, worldHash: worldHash({ prompt: `stub ${seed}` }), variant: 'clean', labelSource: 'generator' },
  });
  const inTrain = checkRecord(stubRecord(450), { slice: 'train', contracts: spec.contracts, variants: spec.spec.conventions.variants });
  assert.ok(inTrain.errors.some(e => e.code === 'HELDOUT_FAMILY'), JSON.stringify(inTrain.errors.map(e => e.code)));
  const inTest = checkRecord(stubRecord(6001), { slice: 'test-ood', contracts: spec.contracts, variants: spec.spec.conventions.variants, wordings: H.emptyHeldout().wordings });
  assert.ok(!inTest.errors.some(e => e.code === 'HELDOUT_FAMILY'), 'test-ood accepts the held-out family');
  // X3, X8 and the smoke ports are train families of this bed
  for (const port of ['X3', 'X8', 'K1', 'K2', 'K3', 'X4']) assert.ok(spec.contracts[port].families.train.includes('kinetics'), port);
});

test('splits: a reserved dev world (seeds 1-400) is refused by the record check in every file', () => {
  const spec = SPEC();
  const rec = seed => ({
    state: { message: 'Coffee machine on 4 is fixed.', author: 'a', fact_owner: 'a', thread_context: [] },
    questions: { X3: labelledQuestion(spec.contracts.X3, { label: 'mentions' }) },
    meta: { family: 'kinetics', bed: 'kinetics', seed, difficulty: 3, worldHash: worldHash({ prompt: `stub ${seed}` }), variant: 'clean', labelSource: 'generator' },
  });
  for (const slice of ['train', 'calib-in', 'dev-select']) {
    const planted = checkRecord(rec(101), { slice, contracts: spec.contracts, variants: spec.spec.conventions.variants });
    assert.ok(planted.errors.some(e => e.code === 'RESERVED_WORLD'), `${slice}: ${JSON.stringify(planted.errors.map(e => e.code))}`);
  }
  assert.ok(!checkRecord(rec(401), { slice: 'train', contracts: spec.contracts, variants: spec.spec.conventions.variants }).errors.some(e => e.code === 'RESERVED_WORLD'));
});

// ---- pins to the bed ------------------------------------------------------------------------------------------------
test('bed pins: RATE_FACTOR, the message frames, the injection lines and the chatter equal the bed', async () => {
  const R = await REND(), P = await POOLS();
  assert.deepEqual(RATE_FACTOR, R.RATE_FACTOR);
  assert.deepEqual(Object.keys(R.RATE_FACTOR), Object.keys(RATE_LABELS));
  assert.deepEqual(Object.keys(R.CONC_FACTOR), Object.keys(CONC_LABELS));
  const src = BEDS().read('beds/kinetics/render.mjs');
  for (const [unit, labels] of Object.entries(RATE_LABELS)) for (const l of labels) assert.ok(src.includes(`'${l}'`), `rate label ${l} of ${unit}`);
  for (const [unit, labels] of Object.entries(CONC_LABELS)) for (const l of labels) assert.ok(src.includes(`'${l}'`), `conc label ${l} of ${unit}`);
  // frames derived from the bed's own pool functions are the copies in the frames file
  const same = (copy, derived) => { assert.equal(copy.length, derived.length); copy.forEach((t, i) => assert.equal(compileFrame(t).source, derived[i].source, t)); };
  same(FRAMES.answerConfirm, framesFromPool(P.ANSWERS.confirm));
  same(FRAMES.answerDeny, framesFromPool(P.ANSWERS.deny));
  same(FRAMES.withdraw, framesFromPool(P.WITHDRAW));
  same(FRAMES.redirect, framesFromPool(P.REDIRECT, 3));
  assert.deepEqual(CHAT_INJECTIONS, P.INJECTIONS.map(f => f()));
  for (const l of NOTEBOOK_INJECTIONS) assert.ok(src.includes(l), l);
  for (const l of CHATTER) assert.ok(src.includes(l.replace(/'/g, "\\'")) || src.includes(l), l);
  const errors = await checkBedDerived(C(), BEDS(), ['K3']);
  assert.deepEqual(errors, [], 'K3 options are the bed\'s RATE_FACTOR keys plus mAU/min');
});

// ---- acceptance 1: tap alignment ---------------------------------------------------------------------------------------
test('tap: aligns >= 95% of facts to exactly one span on 200 worlds, or X3 moves to wave 2 and the status records it', async t => {
  const s = await tapStatus({ beds: BEDS() });
  t.diagnostic(`tap v${s.tapVersion}: ${s.aligned}/${s.facts} facts aligned over ${s.worlds} worlds (${(s.rate * 100).toFixed(2)}%), ${s.labelledSpans} labelled spans; threshold ${TAP_THRESHOLD}; X3 wave ${s.x3Wave}`);
  t.diagnostic(`by difficulty: ${Object.entries(s.byDifficulty).map(([d, x]) => `d${d} ${x.aligned}/${x.facts}`).join(', ')}`);
  t.diagnostic(`by fact type: ${Object.entries(s.byType).map(([k, x]) => `${k} ${x.aligned}/${x.facts}`).join('; ')}`);
  assert.equal(s.worlds, 200);
  assert.equal(s.pass, s.rate >= TAP_THRESHOLD);
  assert.equal(s.x3Wave, s.pass ? 1 : 2, 'a failing tap moves X3 to wave 2 with S3 in');
  assert.ok(s.pass, `the message tap is below ${TAP_THRESHOLD}; X3 must run as wave 2 (opts.x3Wave: 2)`);
  // the row-level taps: notes (K1) and condition aliases (K2)
  const K = await KIN();
  let notes = 0, droppedNotes = 0, aliases = 0, resolved = 0, ambiguous = 0;
  for (const d of [3, 4, 5]) for (const seed of range(401, 30)) {
    const task = K.generate({ seed, split: 'dev', difficulty: d }), { world } = K._internals(task), parsed = parseTask(task);
    for (const n of alignNotes({ parsed, world })) { notes++; if (n.dropped) droppedNotes++; }
    const conds = normalizeConds(parsed.study), bench = registerBench(parsed);
    for (const a of harvestAliases({ parsed, world })) { aliases++; const r = resolveCondition(a.alias, conds, bench); if (r === a.label) resolved++; else if (r === null) ambiguous++; }
  }
  t.diagnostic(`K1 notes: ${notes - droppedNotes}/${notes} decidable from the note alone (the rest need the read window); K2 aliases: ${resolved}/${aliases} resolve to the labelled condition, ${ambiguous} are duplicate register rows`);
  assert.ok(resolved + ambiguous === aliases, 'an alias either resolves to its condition or to none (a duplicate register row), never to another');
});

// ---- acceptance 2: X8 second code path ------------------------------------------------------------------------------------
test('X8 kinetics second code path: applying RATE_FACTOR reproduces the wrong value on 200 rows', async t => {
  const R = await REND(), K = await KIN();
  const recs = byPort(await TRAIN(250)).X8 ?? [];
  const wrong = recs.filter(r => labelOf(r) === 'inconsistent'), right = recs.filter(r => labelOf(r) === 'consistent');
  assert.ok(wrong.length >= 200, `${wrong.length} inconsistent rows`);
  const fmt = v => String(Number(v.toPrecision(4)));
  for (const r of wrong.slice(0, 200)) {
    const { printed, wrongUnit, rateUnit } = r.meta.x8;
    assert.ok(wrongUnit && wrongUnit !== rateUnit);
    assert.equal(r.state.extracted_value, fmt(printed / R.RATE_FACTOR[wrongUnit]), `${r.meta.seed}`);
  }
  for (const r of right.slice(0, 200)) assert.equal(r.state.extracted_value, String(Number((r.meta.x8.printed / R.RATE_FACTOR[r.meta.x8.rateUnit]).toPrecision(4))));
  // the printed number the kit parses is the number the bed printed
  for (const r of recs.slice(0, 100)) {
    const task = await taskOf(r), { shown } = K._internals(task);
    assert.equal(shown[r.meta.kit.slots.sample].rawRate, r.meta.x8.printed);
  }
  t.diagnostic(`X8: ${wrong.length} inconsistent and ${right.length} consistent rows in 250 train worlds; wrong units used: ${JSON.stringify(counts(wrong, r => r.meta.x8.wrongUnit))}; formats ${JSON.stringify(counts(recs, r => r.meta.x8.format))}`);
});

// ---- acceptance 3: size ---------------------------------------------------------------------------------------------------
test('states: every state <= 4K real tokens, windowed to one document; no all-documents variant exists', async t => {
  const recs = [...(await TRAIN(120)), ...await collect('test-ood', range(6000, 24))];
  const res = measureRecords(recs.map(r => ({ state: r.state, questions: r.questions })), { maxState: 8192 });
  const per = {};
  recs.forEach((r, i) => { const p = portOf(r) + (r.meta.variant === 'long' ? ':long' : ''); (per[p] ??= []).push(res[i].stateTokens); });
  for (const [p, xs] of Object.entries(per).sort()) t.diagnostic(`${p}: n ${xs.length}, real tokens p50 ${quantile(xs, 0.5)} p90 ${quantile(xs, 0.9)} max ${Math.max(...xs)}`);
  assert.ok(res.every(r => r.ok && r.fits), 'every record fits Kev at the bridge maxState');
  assert.ok(res.every(r => r.stateTokens <= 4096), `max ${Math.max(...res.map(r => r.stateTokens))} real tokens`);
  // a state quotes at most one document: one title line at most, and no state is the whole task text
  for (const r of recs) {
    const text = Object.values(r.state).flat().filter(x => typeof x === 'string').join('\n');
    assert.ok((text.match(/^# (?!export |units:)/gm) ?? []).length <= 1, 'a state holds the lines of one document');
  }
  assert.ok(Math.max(...res.map(r => r.stateTokens)) < 3000, 'long variants are windows of one document, far from the 12K of all documents');
  // the kit's window parameter is bounded: there is no builder that takes more than one document
  const kitSrc = readFileSync(path.join(KEV_DATA, 'judges', 'kinetics.mjs'), 'utf8');
  assert.ok(!/documents\.map\(|docs\.map\(d => d\.text\)|allDocuments/.test(kitSrc), 'no all-documents builder');
});

// ---- acceptance 4: held-out families appear only in test-ood and their spans are registered ----------------------------------------
test('held-out families: X5 and X1 kinetics rows appear only in test-ood files; their spans are registered and absent from every train state', async t => {
  const trainLike = {};
  for (const [slice, first] of [['train', 401], ['calib-in', 4000], ['dev-select', 4500]]) trainLike[slice] = await collect(slice, range(first, slice === 'train' ? 200 : 60), { smokeEvery: 1 });
  for (const [slice, recs] of Object.entries(trainLike)) {
    const ports = new Set(recs.flatMap(r => Object.keys(r.questions).map(q => q.split('~')[0])));
    for (const p of ['X5', 'X1', 'X7']) assert.ok(!ports.has(p), `${slice} carries ${p}`);
  }
  const test = await collect('test-ood', range(6000, 40));
  const held = test.filter(r => ['X5', 'X1', 'X7'].includes(portOf(r)));
  const heldPorts = counts(held, portOf);
  assert.ok(heldPorts.X5 > 0 && heldPorts.X1 > 0 && heldPorts.X7 > 0, JSON.stringify(heldPorts));
  assert.deepEqual(H.checkRecords(test, { slice: 'test-ood', wordings: GUARD() }), [], 'test-ood records pass the build\'s record checks');
  const registry = new SpanRegistry();
  const nSpans = gen.registerHeldout(registry, held);
  assert.ok(nSpans >= 20 && registry.size >= 20, `${nSpans} spans registered`);
  let hits = 0, states = 0;
  const hitPorts = {};
  for (const recs of Object.values(trainLike)) for (const r of recs) { states++; const h = registry.scanState(r.state, { names: r.meta.masks.names, markers: r.meta.masks.markers, slice: 'train' }); hits += h.length; for (const x of h) { const k = `${portOf(r)}<-${x.entry.port}`; hitPorts[k] = (hitPorts[k] ?? 0) + 1; } }
  t.diagnostic(`held-out rows ${JSON.stringify(heldPorts)}; ${registry.size} registered spans scanned against ${states} train-like states: ${hits} hits`);
  assert.equal(hits, 0, `no registered span of X1, X5 or X7 kinetics is in a train, calib-in or dev-select state: ${JSON.stringify(hitPorts)}`);
  // the same registry flags a planted span: the scan is not vacuous
  const plant = held.find(r => portOf(r) === 'X1');
  assert.ok(registry.scanState({ text: plant.state.text }, { names: plant.meta.masks.names, markers: plant.meta.masks.markers, slice: 'train' }).length > 0);
  // test-ood is the only slice that holds the family; the other OOD slices do not
  for (const slice of ['calib-ood', 'dev-ood']) assert.ok(!(await collect(slice, range(sliceDef(slice).seeds[0], 12))).some(r => ['X5', 'X1', 'X7'].includes(portOf(r))), slice);
});

// ---- acceptance 5: class support --------------------------------------------------------------------------------------------------
test('X3 class support per difficulty is printed; a class with < 30 forms in a test cell is marked diagnostic', async t => {
  const K = await KIN();
  // every X3 candidate of 90 dev worlds per difficulty, split by the skeleton bucket the test-ood slice reads
  const rows = [];
  for (const d of [1, 2, 3, 4, 5]) for (const seed of range(401, 90)) {
    const task = K.generate({ seed, split: 'dev', difficulty: d }), { world } = K._internals(task), tap = alignMessages({ task, world });
    const masks = gen.masksOf(world);
    for (const sp of tap.spans.values()) {
      if (!sp.label) continue;
      const state = buildX3(task, { message: sp.id }), form = skeleton(state.message, masks);
      rows.push({ questions: { X3: { label: sp.label } }, meta: { difficulty: d, seed, formId: form, bucket: skeletonBucket(form) } });
    }
  }
  const all = gen.classSupport(rows), testCell = gen.classSupport(rows.filter(r => r.meta.bucket === 'test-ood'));
  const show = (name, table) => {
    for (const [l, byD] of Object.entries(table).sort()) t.diagnostic(`${name} ${l.padEnd(8)} ${Object.entries(byD).sort().map(([d, c]) => `${d}: ${c.rows} rows/${c.forms} forms${c.diagnostic ? ' (diagnostic)' : ''}`).join('; ')}`);
  };
  show('all buckets', all); show('test-ood bucket', testCell);
  for (const table of [all, testCell]) for (const byD of Object.values(table)) for (const c of Object.values(byD)) assert.equal(c.diagnostic, c.forms < 30);
  assert.ok(Object.values(testCell).every(byD => Object.values(byD).every(c => c.forms < 30 === c.diagnostic)));
  assert.ok(Object.values(testCell).flatMap(byD => Object.values(byD)).some(c => c.diagnostic), 'with 20% of the forms, some test cells are thin and are marked');
  assert.ok(!all.retracts?.d1 && !all.retracts?.d2, 'retracts exist only from d3 (withdrawn late reports) and d5 (retracted swap)');
  assert.ok(all.retracts?.d3 && all.retracts?.d5);
  assert.ok(Object.keys(all).sort().join() === 'changes,confirms,mentions,proposes,retracts');
});

// ---- acceptance 6: kit identity and the decidability audit ------------------------------------------------------------------------------
test('port kit byte-identity: the factory state equals kit.buildState on the task for 200 tasks, and the served question equals the trained one', async t => {
  const recs = await TRAIN(220), tasks = new Map();
  const sample = [];
  for (const r of recs) { const k = `${r.meta.seed}|${r.meta.difficulty}`; if (!tasks.has(k)) tasks.set(k, await taskOf(r)); sample.push(r); }
  assert.ok(tasks.size >= 200, `${tasks.size} tasks`);
  let checked = 0, requests = 0;
  const seenPorts = new Set();
  for (const r of sample) {
    const { port, slots } = r.meta.kit, task = tasks.get(`${r.meta.seed}|${r.meta.difficulty}`);
    const state = kits[port].buildState(task, slots);
    assert.deepEqual(state, r.state, `${port} ${r.meta.seed}`);
    assert.equal(JSON.stringify(state), JSON.stringify(r.state), 'byte for byte');
    assert.deepEqual(kit.buildState(task, { ...slots, port }), r.state, 'the aggregate kit agrees');
    checked++; seenPorts.add(port);
    if (r.meta.variant === 'clean' && port !== 'K2' && requests < 120) {
      // the JudgmentPort request a runtime node sends: its System One form is the question the factory trained on
      const qid = Object.keys(r.questions)[0], q = r.questions[qid], wordingId = r.meta.wordingId;
      const wslots = port === 'X8' ? { field: r.state.field, value: r.state.extracted_value } : {};
      const served = kits[port].questions(port, wslots, { wording: wordingId, optionOrder: Object.keys(q.criteria) })[port];
      assert.equal(served.instructions, q.instructions);
      assert.deepEqual(Object.entries(served.criteria), Object.entries(q.criteria), 'criteria in the same order');
      const req = kits[port].request(port, task, { ...slots, ...wslots }, { wording: wordingId, optionOrder: Object.keys(q.criteria) });
      assert.deepEqual(req.state, r.state);
      requests++;
    }
  }
  t.diagnostic(`${checked} records over ${tasks.size} tasks, ports ${[...seenPorts].sort().join(', ')}; ${requests} served-question checks`);
  for (const p of ['X3', 'X8', 'K1', 'K2', 'K3', 'X4']) assert.ok(seenPorts.has(p), p);
});

test('decidability audit: state-only solvers reproduce the X3 and X8 labels; exact-state collisions under 1% (X3 masked too); every state key is declared', async t => {
  const reports = [];
  for (const [slice, first, n] of [['train', 401, 160], ['dev-select', 4500, 200], ['calib-in', 4000, 150]]) {
    const recs = byPort(await collect(slice, range(first, n), { perWorld: { X3: 6, X8: 6 }, ports: ['X3', 'X8'] }));
    for (const port of ['X3', 'X8']) {
      const rows = recs[port].map(r => ({ id: `${r.meta.seed}:${JSON.stringify(r.meta.kit.slots).slice(0, 40)}`, state: r.state, label: labelOf(r), masks: r.meta.masks, question: port, variant: r.meta.variant }));
      const a = S.audit(rows, port === 'X3' ? S.solveX3 : S.solveX8);
      const col = S.collisions(rows.filter(r => r.variant === 'clean')), colx = S.collisions(rows.filter(r => r.variant === 'clean'), { exact: true });
      reports.push({ slice, port, rows: rows.length, ...a, collisions: col.share, collisionsExact: colx.share });
      t.diagnostic(`${slice} ${port}: ${rows.length} rows, solver decides ${a.decided} (${(a.coverage * 100).toFixed(1)}%) and agrees on ${(a.accuracy * 100).toFixed(2)}%; masked-state collisions ${(col.share * 100).toFixed(2)}% (exact state ${(colx.share * 100).toFixed(2)}%); undecided ${JSON.stringify(a.undecided)}`);
      assert.ok(rows.length >= 400, `${slice} ${port}: ${rows.length} rows`);
      assert.ok(a.accuracy >= 0.995, `${slice} ${port}: ${a.wrong.slice(0, 3).map(w => JSON.stringify(w)).join(' ')}`);
      assert.ok(a.coverage >= 0.99, `${slice} ${port} coverage ${a.coverage}`);
      assert.ok(colx.share < 0.01, `${slice} ${port}: ${colx.share}`);
      if (port === 'X3') assert.ok(col.share < 0.01, `${slice} X3 masked collisions ${col.share}`);
      // time of decision: every state key is a key the contract declares with its provenance
      const declared = new Set(Object.keys(C()[port].state.keys).map(k => k.split('.')[0]));
      for (const r of recs[port]) for (const k of Object.keys(r.state)) assert.ok(declared.has(k), `${port}: undeclared state key ${k}`);
    }
  }
  assert.ok(reports.length === 6);
  // the smoke ports: units, registers, SOP lines and notes
  const rowsOf = async (port, solver, extra = {}) => {
    const recs = (byPort(await TRAIN(150))[port] ?? []);
    const rows = recs.map(r => ({ id: `${r.meta.seed}`, state: r.state, label: labelOf(r), question: port, masks: r.meta.masks }));
    const a = S.audit(rows, solver);
    t.diagnostic(`train ${port}: ${rows.length} rows, decided ${(a.coverage * 100).toFixed(1)}%, agree ${(a.accuracy * 100).toFixed(2)}%`);
    return a;
  };
  for (const [port, solver] of [['K3', S.solveK3], ['K2', S.solveK2], ['X4', S.solveX4]]) { const a = await rowsOf(port, solver); assert.ok(a.accuracy >= 0.995 && a.coverage >= 0.99, `${port}: ${a.wrong.slice(0, 2).map(w => JSON.stringify(w))}`); }
  const index = S.buildK1Index(await POOLS());
  const k1 = await rowsOf('K1', st => S.solveK1(st, index));
  assert.ok(k1.accuracy >= 0.995, `K1 ${k1.wrong.slice(0, 2).map(w => JSON.stringify(w))}`);
  assert.ok(k1.coverage >= 0.85, `K1 pool coverage ${k1.coverage}`);
});

// ---- the common acceptance -----------------------------------------------------------------------------------------------------------
test('records pass the build checks in every slice; labels are balanced; seeds stay out of the reserved range', async t => {
  const spec = SPEC();
  for (const [slice, first, n] of [['train', 401, 120], ['calib-in', 4000, 40], ['calib-ood', 4200, 60], ['dev-select', 4500, 40], ['dev-ood', 4700, 60], ['test-in', 5000, 20], ['test-ood', 6000, 20]]) {
    const recs = await collect(slice, range(first, n), { smokeEvery: 1 });
    assert.ok(recs.length > 0, slice);
    assert.deepEqual(H.checkRecords(recs, { slice, wordings: GUARD() }), [], slice);
    assert.ok(recs.every(r => r.meta.seed >= 401 && r.meta.bed === 'kinetics' && r.meta.family === 'kinetics' && r.meta.labelSource === 'generator'), `${slice}: dev seeds 1-400 are reserved`);
    assert.ok(recs.every(r => /^sha256:/.test(r.meta.worldHash) && /^sha256:/.test(r.meta.formId)));
    t.diagnostic(`${slice}: ${recs.length} records from ${n} worlds: ${Object.entries(byPort(recs)).map(([p, rs]) => `${p} ${rs.length}`).join(', ')}`);
    for (const [p, rs] of Object.entries(byPort(recs))) t.diagnostic(`  ${slice} ${p} distinct masked forms per label: ${JSON.stringify(gen.formsPerLabel(rs))}`);
  }
  // train label balance within 1:3 over 300 worlds (before the assembly's own cap)
  const pool = byPort(await collect('train', range(401, 300), { ports: ['X3', 'X8'] }));
  for (const port of ['X3', 'X8']) {
    const c = counts(pool[port], labelOf), ratio = Math.max(...Object.values(c)) / Math.min(...Object.values(c));
    t.diagnostic(`train ${port} labels ${JSON.stringify(c)} (ratio ${ratio.toFixed(2)})`);
    assert.ok(ratio <= 3, `${port}: ${ratio}`);
    assert.equal(capRatio(pool[port], { label: labelOf, maxRatio: 3 }).dropped.length, 0, 'the 3:1 cap drops nothing');
  }
});

test('twins: an X8 flip twin changes the unit statement only and flips the label; the solver reads both', async t => {
  const recs = byPort(await collect('test-ood', range(6000, 60), { ports: ['X8'] })).X8;
  const pairs = {};
  for (const r of recs.filter(x => x.meta.variant === 'flip')) (pairs[r.meta.pairId] ??= []).push(r);
  const full = Object.values(pairs);
  t.diagnostic(`${recs.length} X8 test-ood rows, ${full.length} flip pairs`);
  assert.ok(full.length >= 10);
  for (const [a, b] of full) {
    assert.equal(full.length > 0 && [a, b].every(Boolean), true);
    assert.notEqual(labelOf(a), labelOf(b), 'the label flips');
    assert.deepEqual({ ...a.state, conventions: 0 }, { ...b.state, conventions: 0 }, 'the row and the value are the same');
    assert.notEqual(a.state.conventions, b.state.conventions);
    assert.equal(S.solveX8(a.state).label, labelOf(a));
    assert.equal(S.solveX8(b.state).label, labelOf(b));
  }
  assert.ok(recs.some(r => r.meta.variant === 'paraphrase') || recs.length < 100, 'paraphrase-consistency records carry Q0 and two test wordings of one state');
});

test('determinism: two runs give the same records; the author-swap twin changes the author only', async () => {
  const a = await collect('train', range(401, 25), { smokeEvery: 1 }), b = await collect('train', range(401, 25), { smokeEvery: 1 });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const twins = a.filter(r => r.meta.variant === 'invariance');
  assert.ok(twins.length > 0);
  for (const tw of twins) {
    const orig = a.find(r => r.meta.pairId === tw.meta.pairId && r !== tw);
    assert.ok(orig && labelOf(orig) === labelOf(tw));
    assert.deepEqual({ ...tw.state, author: orig.state.author }, orig.state, 'only the author differs');
    assert.notEqual(tw.state.author, orig.state.fact_owner);
  }
});

test('build: this generator builds a verified Kev dataset from a frozen bed copy (train and dev-select, real token fits)', async t => {
  // a throwaway repository holding only the kinetics bed and beds/lib, so the shared drift record of this repository is untouched
  const files = {};
  const take = (dir, rel) => { for (const f of readdirSync(path.join(dir, rel))) { const p = path.join(dir, rel, f); if (statSync(p).isFile() && !/\.test\.mjs$/.test(f)) files[`${rel}/${f}`] = readFileSync(p, 'utf8'); } };
  take(BEDS().dir, 'beds/kinetics'); take(BEDS().dir, 'beds/lib'); files['beds/CONTRACT.md'] = readFileSync(path.join(BEDS().dir, 'beds/CONTRACT.md'), 'utf8');
  const repo = H.tempBedRepo(files);
  const build = await buildKev({ root: repo, outRoot: H.tempDir('kev-kin-build-'), generators: [GEN_FILE], slices: ['train', 'dev-select'],
    seeds: { train: range(401, 40), 'dev-select': range(4500, 20) }, opts: { smokeEvery: 2 }, ...H.emptyHeldout() });
  const m = build.manifest;
  const ports = Object.keys(m.slices.train.perPort);
  t.diagnostic(`build ${build.buildId}: train ${m.slices.train.records} records ${JSON.stringify(Object.fromEntries(ports.map(p => [p, m.slices.train.perPort[p].questions])))}, dev-select ${m.slices['dev-select'].records}; job maxState ${m.jobMaxState}`);
  assert.ok(ports.includes('X3') && ports.includes('X8') && ports.includes('K3'));
  assert.deepEqual(Object.keys(m.slices.train.dropped).filter(k => k !== 'duplicate'), [], `only exact duplicates are dropped: ${JSON.stringify(m.slices.train.dropped)}`);
  assert.ok(verifyBuildDir(build.dir).ok);
  const again = await buildKev({ root: repo, outRoot: H.tempDir('kev-kin-build-'), generators: [GEN_FILE], slices: ['train', 'dev-select'],
    seeds: { train: range(401, 40), 'dev-select': range(4500, 20) }, opts: { smokeEvery: 2 }, ...H.emptyHeldout() });
  assert.equal(again.buildId, build.buildId);
  assert.equal(JSON.stringify(again.manifest), JSON.stringify(m), 'a second build gives a byte-identical manifest');
});

test('kit: refuses what the runtime must not do (a missing slot, an unknown message, a missing note)', async () => {
  const task = await taskOf({ meta: { seed: 401, difficulty: 4 } });
  assert.throws(() => kits.X3.buildState(task, {}), e => e.code === 'KIT_SLOT');
  assert.throws(() => kits.X3.buildState(task, { message: 'D99#1' }), e => e.code === 'KIT_SLOT');
  assert.throws(() => kit.buildState(task, {}), e => e.code === 'KIT_SLOT');
  assert.throws(() => kits.X8.buildState(task, { sample: 'ZZ-0000', value: '1' }), e => e.code === 'KIT_SLOT');
  const s = kits.X3.buildState(task, { message: parseTask(task).messages[0].id });
  assert.ok(Object.keys(s).every(k => !['truth', 'label', 'kind', 'role', 'seed', 'difficulty'].includes(k)));
});

// ---- acceptance 7: the test file fails on seeded defects ---------------------------------------------------------------------------------------
test('seeded defect: this file runs alone with node --test and fails on seeded defects (a fact aligned to two spans kept)', { skip: MUTANT_RUN ? 'inside a mutant run' : false, timeout: 10 * 60 * 1000 }, () => {
  // the tests that need no frozen bed (a mutant copy has none)
  const pattern = '^(tap fixture|frames: |solve: |gate: |splits: )';
  const mutants = [
    { name: 'tap keeps a fact aligned to two spans', mutations: [
      { file: 'taps/kinetics.mjs', from: 'p.span = p.candidates.length === 1 ? p.candidates[0] : null;', to: 'p.span = p.candidates[0] ?? null;' },
      { file: 'taps/kinetics.mjs', from: "p.status = p.shared ? 'ambiguous' : p.candidates.length === 1 ? 'aligned'", to: "p.status = p.shared ? 'ambiguous' : p.candidates.length >= 1 ? 'aligned'" }] },
    { name: 'X5 is no longer a held-out family of the generator', mutations: [{ file: 'ports/kinetics.mjs', from: "export const HELD_OUT_PORTS = Object.freeze(['X5', 'X1', 'X7']);", to: "export const HELD_OUT_PORTS = Object.freeze(['X1', 'X7']);" }] },
    { name: 'RATE_FACTOR of uM/min drifts', mutations: [{ file: 'judges/kinetics.mjs', from: "'uM/min': 60, 'nM/s'", to: "'uM/min': 6, 'nM/s'" }] },
    { name: 'the X8 solver accepts anything', mutations: [{ file: 'solve/kinetics.mjs', from: '<= 2e-3 * Math.abs(expected)', to: '<= 2e3 * Math.abs(expected)' }] },
    { name: 'a retraction frame is removed', mutations: [{ file: 'taps/kinetics-frames.mjs', from: "'Scratch my addendum about {}/{} on the {d} sheet. I re-checked the plate map and the tubes were labelled correctly; nothing was swapped.',", to: '' }] },
    { name: 'a reserved world is no longer reserved', mutations: [{ file: 'lib/registry.mjs', from: 'seeds: [1, 400]', to: 'seeds: [1, 100]' }] },
  ];
  const r = H.seededDefect({ file: TEST_FILE, pattern, mutants, env: { KEV_DATA_MUTANT_RUN: '1' } });
  assert.equal(r.control.status, 0, r.control.stdout.split('\n').filter(l => /not ok/.test(l)).join('\n'));
  assert.ok(r.control.passed.length >= 6, `${r.control.passed.length} bed-free tests passed in the control run`);
  for (const m of r.mutants) assert.ok(m.failed.length > 0 && m.status !== 0, `mutant "${m.name}" was not caught`);
});
