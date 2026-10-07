// contracts-lib acceptance (research/kev-20261007/JUDGE-BUILD-PLAN.json, group "contracts-lib").
// Runs alone: node --test experiments/kev-data/test/contracts-lib.test.mjs
// Development evidence only: no training, no model calls; Python runs only the pinned tokenizer and
// Kev's loaders (/opt/kev-venv, python -I, offline). Bed fixtures come from a frozen copy of this
// repository's pinned beds (train-range dev seeds 401-440 only; never a test seed, never beds/sealed/).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { toSystemOneQuestion as directToSystemOne } from '../../../src/judgment.mjs';
import * as render from '../lib/render.mjs';
import { loadSpec, validateSpec, checkRouteAgainstPolicy, PORT_IDS, LEDGER_IDS, WAVE1 } from '../lib/contracts.mjs';
import { coverage, PROGRAM } from '../lib/coverage.mjs';
import * as tokens from '../lib/tokens.mjs';
import { checkStateKeys, SpanRegistry, WordingGuard } from '../lib/leakage.mjs';
import { reservationOf, reservedViolation, assertNoReserved, isReserved } from '../lib/registry.mjs';
import { canonical, skeletonText, stateHash, spanHash, skeletonBucket } from '../lib/hash.mjs';
import { repairLeaks, listProvider, replaceSentence, rerender } from '../lib/counterfactual.mjs';
import { trainProbe, evaluate, topFeatures } from '../lib/probe.mjs';
import { capRatio, balanceWithin, sampleAtRate, importanceWeights, positionHistogram, checkPositionUniform, optionOrder } from '../lib/balance.mjs';
import { bedPin, worktreeDiff, freezeBeds, frozenBeds, BED_ALLOWLIST } from '../lib/pin.mjs';
import { buildKev, verifyBuildDir, checkRecord, SLICES, RESERVED, seedsFor } from '../build.mjs';
import { exportKev, readKevFile, metaFileOf } from '../export-kev.mjs';
import { definePortKit, assertPortState, FORBIDDEN_STATE_KEYS } from '../judges/kit.mjs';
import * as H from '../lib/harness.mjs';

const TEST_FILE = fileURLToPath(import.meta.url);
const KEV_DATA = path.resolve(path.dirname(TEST_FILE), '..');
const MUTANT_RUN = process.env.KEV_DATA_MUTANT_RUN === '1';
const SEALED = /beds[\\/]sealed(?:[\\/]|$)/;

const once = f => { let done = false, v; return () => { if (!done) { done = true; v = f(); } return v; }; };
const SPEC = once(() => loadSpec());
const C = () => SPEC().contracts;
const REAL = once(() => H.frozenRepoBeds());                       // frozen copy of this repository's beds
const fill = (t, slots) => t.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n) => slots[n]);
const sampleSlots = c => Object.fromEntries(Object.entries(c.slots ?? {}).map(([n, s]) => [n, s.values?.[0] ?? `the sample ${n}`]));
function sampleOptions(c, k = 3) {
  if (c.options) return {};
  const src = c.optionSource, n = Math.min(src.max, Math.max(src.min ?? 2, k));
  const names = Array.from({ length: n }, (_, i) => (src.pattern === '^C[1-8]$' ? `C${i + 1}` : src.pattern?.startsWith('^c') ? `c${i + 1}` : `option_${i + 1}`));
  return { options: names, optionDescriptions: Object.fromEntries(names.map(o => [o, `the description of ${o}`])) };
}
const paragraphOf = (notes, S) => notes.split(/\n\s*\n/).find(p => p.startsWith(`${S}.`)) ?? null;
const insertAfterFirstSentence = (text, s) => text.replace(/^(.+?[.!?])\s+/s, (_, a) => `${a} ${s} `);

// An R1 record in the factory shape (§2.2).
function r1Record(state, { seed = 401, variant = 'clean', label = 'dmy', wording = 'Q0', target, masks, worlds } = {}) {
  return { state, questions: { R1: render.labelledQuestion(C().R1, { wording, slots: { system: state.system }, label, ...(target ? { target } : {}) }) },
    meta: { family: 'records', bed: 'records', seed, difficulty: 3, variant, labelSource: 'generator', ...(masks ? { masks } : {}), ...(worlds ? { worlds } : {}) } };
}
// A generator over fixed records per slice.
const inlineGen = (bySlice, group = 'inline') => ({ group, ports: ['R1'], *records(slice) { for (const r of bySlice[slice] ?? []) yield structuredClone(r); } });

// A throwaway bed repository: three allow-listed paths, a sealed bed and a non-allow-listed one.
const FIXTURE_BED = [
  "export const VERSION = '0.0.1-fixture';",
  "const ORDER = { dmy: 'day first', mdy: 'month first', ymd: 'year first' };",
  'export const note = (system, order, seed) => `${system}. Numeric birth dates are written ${ORDER[order]}. Row ids start at ${seed * 7}.`;',
  'export const where = import.meta.url;', ''].join('\n');
function stubBedRepo() {
  return H.tempBedRepo({ 'beds/records/index.mjs': FIXTURE_BED, 'beds/records/README.md': '# fixture bed\n', 'beds/lib/canonical.mjs': 'export const canonical = JSON.stringify;\n',
    'beds/CONTRACT.md': '# fixture contract\n', 'beds/sealed/secret.mjs': 'export const hidden = 1;\n', 'beds/scratch/x.mjs': 'export const x = 1;\n' });
}
function walk(dir, rel = '') {
  return readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap(e => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(dir, r) : [r];
  }).sort();
}

// Export fixtures: multi-question, soft-target unknowable, variable options, companion question, X5 not_stated.
function exportFixtures() {
  const c = C(), Q = render.labelledQuestion;
  const base = { family: 'records', bed: 'records', difficulty: 3, labelSource: 'generator' };
  const note = 'ATLAS. Birth dates are written day first (DD/MM/YYYY). The "owed" column is what the supplier owes us.';
  const train = [
    { state: { system: 'ATLAS', source_note: note }, questions: { R1: Q(c.R1, { wording: 'Q1', slots: { system: 'ATLAS' }, label: 'dmy' }), R3: Q(c.R3, { wording: 'Q2', slots: { system: 'ATLAS' }, label: 'same' }) },
      meta: { ...base, seed: 401, variant: 'clean' } },
    { state: { system: 'ATLAS', source_note: 'ATLAS. VENDEX writes numeric dates month first; ATLAS balances keep their sign.' },
      questions: { R1: Q(c.R1, { slots: { system: 'ATLAS' }, label: 'dmy', target: render.uniformTarget(Object.keys(c.R1.options)) }) }, meta: { ...base, seed: 402, variant: 'unknowable' } },
    { state: { notice: { type: 'Retraction notice', venue: 'J. Appl. Kinet.', date: '2021-03-04', title: 'Retraction: rate constants of AX-7', text: 'The authors retract the article on AX-7 rate constants.' } },
      questions: { S1: Q(c.S1, { options: ['c1', 'c2', 'c3'], optionDescriptions: { c1: 'Rate constants of AX-7 — Ito, Sato; J. Appl. Kinet., 2019', c2: 'AX-7 binding — Ito; Preprint, 2018', c3: 'BX-2 rates — Weber; J. Phys. Chem., 2020' }, label: 'c1' }),
        S1_present: Q(render.questionContract('S1_present', c).contract, { label: 'yes' }) }, meta: { family: 'synth', bed: 'synth', seed: 403, difficulty: 4, variant: 'clean', labelSource: 'generator' } },
    { state: { source_text: 'VENDEX. Dates are written month first. Balances keep their sign.' },
      questions: { X5: Q(c.X5, { wording: 'Q3', slots: { assumption: 'ATLAS writes numeric birth dates day first' }, label: 'not_stated' }) }, meta: { ...base, seed: 404, variant: 'unknowable' } },
    { state: { bug_report: 'Saving a document loses its title.', module_outline: 'def parse(text, *, strict=False)\ndef render(doc)\ndef save(doc, path)' },
      questions: { F2: Q(c.F2, { options: ['parse', 'render', 'save'], optionDescriptions: { parse: 'def parse(text, *, strict=False)', render: 'def render(doc)', save: 'def save(doc, path)' }, label: 'save' }) },
      meta: { family: 'codefix', bed: 'codefix', seed: 405, difficulty: 3, variant: 'clean', labelSource: 'generator' } },
  ];
  const evaluation = [
    { state: { system: 'KOBO', marker: 'SAMPLE', source_note: 'KOBO. Test orders are kept for audits; LEDGR marks cancelled rows storniert.' },
      questions: { R2: Q(c.R2, { slots: { system: 'KOBO', value: 'SAMPLE' }, label: 'void' }) }, meta: { ...base, seed: 4500, variant: 'unknowable' } },
    { state: { system: 'KOBO', marker: 'SAMPLE', source_note: 'KOBO. Rows marked SAMPLE are test orders and must not be migrated.' },
      questions: { R2: Q(c.R2, { wording: 'Q3', slots: { system: 'KOBO', value: 'SAMPLE' }, label: 'void' }) }, meta: { ...base, seed: 4501, variant: 'clean' } },
  ];
  return { train, evaluation };
}

// One Python process for every tokenizer and Kev-loader check (Kev's import costs about 5 s).
const PY = once(async () => {
  const { beds } = REAL();
  const { build } = await beds.import('beds/incident/gen.mjs');
  const { buildWorld } = await beds.import('beds/records/world.mjs');
  const fx = [];
  for (const seed of [401, 402, 403]) {
    const { task, truth } = build(seed, 'dev', 3);
    const byId = new Map(task.inputs.log.split('\n').map(l => [l.slice(0, l.indexOf(' ')), l]));
    const ids = truth.linesBySvc[truth.root_service].filter(x => x.t >= truth.T && x.t <= truth.T + 120).slice(0, 8).map(x => x.id);
    const w = buildWorld(seed, 'dev', 3);
    fx.push({ seed, log: ids.map(i => byId.get(i)).join('\n'), table: w.exportText.split('\n').slice(0, 6).join('\n'), prose: w.notes });
  }
  const literals = ['hello world', 'L0001 2026-11-19T07:24:01Z api-gateway-2ae8d {"level":"info","msg":"handled GET /api/v1/category status=200 dur=20ms"}', 'Balances keep their sign in the master.'];
  const lines = build(401, 'dev', 3).task.inputs.log.split('\n');
  const sizes = [3, 4, 5, 6, 7, 8, 150, 155, 160, 165, 170, 175, 180];
  const fitsRecords = sizes.map(n => ({ state: { log_lines: lines.slice(0, n).join('\n') }, questions: { I1: render.labelledQuestion(C().I1, { label: 'disk_full' }) } }));
  const dir = H.tempDir('kev-export-'), ex = exportFixtures();
  const trainEx = exportKev(ex.train, { file: path.join(dir, 'train.jsonl'), contracts: C(), slice: 'train' });
  const evalEx = exportKev(ex.evaluation, { file: path.join(dir, 'dev-select.jsonl'), contracts: C(), slice: 'dev-select' });
  const texts = [...literals, ...fx.flatMap(f => [f.log, f.table, f.prose])];
  const t0 = Date.now();
  const [count, measure, loadTrain, loadEval] = tokens.kevBatch([
    { op: 'count', texts }, { op: 'measure', records: fitsRecords, maxState: 8192 },
    { op: 'load_file', path: trainEx.file, maxState: 8192 }, { op: 'load_file', path: evalEx.file, maxState: 8192 }]);
  return { fx, literals, counts: count.counts, measure, sizes, trainEx, evalEx, loadTrain, loadEval, ex, ms: Date.now() - t0 };
});

// ---------------------------------------------------------------------------------------------
// Acceptance 1
test('spec/ports.json validates: 42 ports + 3 ledger-only contracts with every required field', () => {
  const { spec } = SPEC();
  assert.deepEqual(validateSpec(spec).errors, []);
  assert.deepEqual(Object.keys(spec.ports), PORT_IDS);
  assert.deepEqual(Object.keys(spec.ledgerOnly), LEDGER_IDS);
  assert.deepEqual(Object.keys(spec.ports).filter(id => spec.ports[id].wave === 1).sort(), [...WAVE1].sort());
  for (const [id, c] of Object.entries(spec.ports)) {
    for (const q of ['Q0', 'Q1', 'Q2', 'Q3']) assert.ok(c.wordings[q]?.trim(), `${id} ${q}`);
    const k = c.options ? Object.keys(c.options).length : c.optionSource.max;
    assert.ok(k >= 2 && k <= 64, `${id} options ${k}`);
    if (c.options) assert.ok(Object.values(c.options).every(d => typeof d === 'string' && d.trim()), `${id} option descriptions`);
    assert.ok(Array.isArray(c.criteria) && c.criteria.length <= 32, `${id} criteria`);
    const longest = Object.fromEntries(Object.entries(c.slots ?? {}).map(([n, s]) => [n, s.values?.length ? s.values.reduce((a, b) => (b.length > a.length ? b : a)) : 'x'.repeat(s.maxChars)]));
    for (const [w, t] of Object.entries(c.wordings)) assert.ok(fill(t, longest).length <= 4000, `${id} ${w} at its longest slot filling`);
    for (const [key, p] of Object.entries(c.state.keys)) assert.ok(p.event?.trim() && p.source?.trim(), `${id} state key ${key} provenance`);
    assert.ok(['bed-natural', 'balanced-within-entity', 'uniform'].includes(c.deploymentRate), `${id} deploymentRate`);
    assert.ok(Array.isArray(c.allowedKnowledge), `${id} allowedKnowledge`);
    assert.ok(Number.isInteger(c.budget.typical) && Number.isInteger(c.budget.max) && c.budget.typical <= c.budget.max && c.budget.max <= 8192 && ['M', 'E'].includes(c.budget.evidence), `${id} budget`);
    assert.ok(c.families.train.length && Array.isArray(c.families.heldOut) && c.holdouts, `${id} families/holdouts`);
    assert.ok([1, 2, 3].includes(c.wave) && ['gating', 'advisory'].includes(c.authority), `${id} wave/authority`);
    assert.ok(c.labelSource?.trim() && !/\b(llm|gpt|claude)\b/i.test(c.labelSource), `${id} label source`);
  }
  for (const [id, c] of Object.entries(spec.ledgerOnly)) {
    assert.ok(c.wordings.Q0 && (c.options || c.optionSource) && Object.values(c.state.keys).every(p => p.event && p.source), id);
    assert.equal(c.training, 'none'); assert.equal(c.gate, 'none');
  }
  // The validator is not vacuous: each seeded spec defect is caught.
  const defects = [
    ['missing Q3', s => { delete s.ports.R2.wordings.Q3; }, /^R2: missing wording Q3/],
    ['65 options', s => { s.ports.R3.options = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`o${i}`, 'd'])); }, /^R3: has 65 options/],
    ['33 criteria', s => { s.ports.I2.criteria = Array.from({ length: 33 }, (_, i) => `criterion ${i}`); }, /^I2: criteria/],
    ['a 4,001-character question', s => { s.ports.X1.wordings.Q2 = 'x'.repeat(4001); }, /^X1: wording Q2 does not render/],
    ['a slot at its longest overflows', s => { s.ports.X5.slots.assumption.maxChars = 4000; }, /^X5: wording Q0 does not render/],
    ['a state key without provenance', s => { s.ports.S2.state.keys.passage = { event: 'x' }; }, /^S2: state key passage needs field provenance/],
    ['a forbidden state key', s => { s.ports.F1.state.keys.kind = { event: 'e', source: 's' }; }, /^F1: state key kind uses a forbidden name/],
    ['no deploymentRate', s => { delete s.ports.X5.deploymentRate; }, /^X5: deploymentRate/],
    ['no allowedKnowledge', s => { delete s.ports.R1.allowedKnowledge; }, /^R1: allowedKnowledge/],
    ['a bytes/4 budget', s => { s.ports.I1.budget.evidence = 'bytes/4'; }, /^I1: budget/],
    ['an undeclared slot', s => { s.ports.R4.wordings.Q1 = 'Is the {column} of {system} reliable?'; }, /^R4: wording Q1 uses undeclared slot \{column\}/],
    ['a ledger contract with training', s => { s.ledgerOnly.L3.training = 'J2'; }, /^L3: ledger-only/],
    ['41 ports', s => { delete s.ports.C9; }, /expected the 42 ports/],
  ];
  for (const [name, mutate, re] of defects) {
    const s = structuredClone(spec); mutate(s);
    const r = validateSpec(s);
    assert.ok(!r.ok && r.errors.some(e => re.test(e)), `${name}: ${JSON.stringify(r.errors.slice(0, 3))}`);
  }
});

test('spec: route model ids resolve in policy/models.json with their classes (O1: Haiku 5.5)', () => {
  const { spec } = SPEC();
  assert.deepEqual(checkRouteAgainstPolicy(spec).errors, []);
  assert.equal(spec.route.weak.modelId, 'claude-haiku-5-5');
});

test('spec: bed-derived option sets and the I2 tag table match the frozen beds at the current pin (drift check)', async () => {
  const { beds } = REAL(), p = SPEC().spec.ports;
  const cat = await beds.import('beds/incident/catalog.mjs');
  assert.deepEqual(Object.keys(p.I1.options), cat.FAULT_CLASSES);
  for (const k of cat.FAULT_CLASSES) assert.equal(p.I1.options[k], cat.CLASS_SUMMARY[k], `I1 ${k}`);
  assert.equal(p.I2.labelMap.bedVersion, (await beds.import('beds/incident/gen.mjs')).VERSION, 'I2 tag table is pinned to the incident bed version');
  assert.equal(Object.keys(p.I2.labelMap.tags).length, 24);
  const bugs = await beds.import('beds/gameqa/bugs.mjs'), text = await beds.import('beds/gameqa/text.mjs');
  assert.deepEqual(Object.keys(p.Q5.options), bugs.BUG_CLASSES);
  for (const k of bugs.BUG_CLASSES) assert.equal(p.Q5.options[k], text.CLASS_DEFS[k], `Q5 ${k}`);
  assert.deepEqual(p.R5.options, (await beds.import('beds/records/pools.mjs')).COUNTRY_NAME);
  const TL = (await beds.import('beds/synth/catalog.mjs')).TYPE_LABELS;
  assert.deepEqual(Object.fromEntries(Object.entries(p.S5.options)), Object.fromEntries(Object.entries(TL).map(([k, v]) => [k, v.plain])));
  assert.deepEqual(Object.keys(p.K3.options), [...Object.keys((await beds.import('beds/kinetics/render.mjs')).RATE_FACTOR), 'mAU/min']);
});

test('frozen copy: runtime bed modules resolve their relative imports inside the frozen copy', () => {
  const { frozen } = REAL(), bad = [];
  // import/export statements at the start of a line, and import('literal') calls; template-literal
  // specifiers (code that writes code) are not imports of the bed itself
  const re = /^\s*(?:import|export)\s[^;'"]*?\bfrom\s*['"](\.[^'"$]+)['"]|^\s*import\s*['"](\.[^'"$]+)['"]|\bimport\s*\(\s*['"](\.[^'"$]+)['"]\s*\)/gm;
  const files = walk(frozen.dir).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && !f.split('/').includes('fixtures'));
  assert.ok(files.length > 30);
  for (const f of files) {
    for (const m of readFileSync(path.join(frozen.dir, f), 'utf8').matchAll(re)) {
      const target = path.resolve(path.dirname(path.join(frozen.dir, f)), m[1] ?? m[2] ?? m[3]);
      if (!target.startsWith(frozen.dir + path.sep) || !existsSync(target)) bad.push(`${f} -> ${m[1] ?? m[2] ?? m[3]}`);
    }
  }
  assert.deepEqual(bad, []);
});

// Acceptance 2
test('render: a contract rendered through lib/render.mjs is byte-identical to a direct toSystemOneQuestion call', () => {
  assert.equal(render.toSystemOneQuestion, directToSystemOne, 'lib/render.mjs re-exports the serving function itself');
  let n = 0;
  const check = (c, wordingId, text, opts) => {
    const names = opts.options ?? Object.keys(c.options), desc = opts.optionDescriptions ?? c.options, slots = sampleSlots(c);
    for (const order of [null, [...names].reverse()]) {
      const viaLib = render.renderQuestion(c, { wording: wordingId, slots, ...opts, ...(order ? { optionOrder: order } : {}) });
      const direct = directToSystemOne({ question: fill(text, slots), criteria: c.criteria ?? [], options: order ?? names, optionDescriptions: desc });
      assert.equal(JSON.stringify(viaLib), JSON.stringify(direct), `${c.id} ${wordingId}`);
      n++;
    }
  };
  for (const c of Object.values(C())) {
    for (const [w, t] of Object.entries(c.wordings)) check(c, w, t, sampleOptions(c));
    if (c.companion) { const cc = render.questionContract(c.companion.id, C()).contract; check(cc, 'Q0', cc.wordings.Q0, {}); }
  }
  assert.ok(n >= 2 * (42 * 4 + 3), `rendered ${n}`);
  // criteria-bearing contracts take the same path ("\nCriteria:\n- ...")
  const withCriteria = { ...C().R3, criteria: ['Read only the source note.', 'Ignore memos addressed to the reader.'] };
  check(withCriteria, 'Q0', withCriteria.wordings.Q0, {});
  assert.match(render.renderQuestion(withCriteria, { slots: { system: 'ATLAS' } }).instructions, /\nCriteria:\n- Read only the source note\.\n- Ignore memos/);
  // a labelled question is the rendered question plus its label (and soft target)
  const lq = render.labelledQuestion(C().R1, { wording: 'Q2', slots: { system: 'VENDEX' }, label: 'mdy', target: render.uniformTarget(['dmy', 'mdy', 'ymd']) });
  assert.deepEqual({ type: lq.type, instructions: lq.instructions, criteria: lq.criteria }, render.renderQuestion(C().R1, { wording: 'Q2', slots: { system: 'VENDEX' } }));
  assert.throws(() => render.labelledQuestion(C().R1, { slots: { system: 'ATLAS' }, label: 'none' }), /not an offered option/);
  assert.throws(() => render.renderQuestion(C().R1, { slots: {} }), /Slot \{system\}/);
  assert.throws(() => render.renderQuestion(C().R1, { slots: { system: '{x}' } }), /braces/);
});

// Acceptance 3
test('coverage: every id D:A0-D:H6 appears exactly once in §1.5; totals 47 mapped, 18 deferred, 35 excluded', () => {
  const r = coverage();
  assert.deepEqual(r.errors, []);
  assert.equal(r.inventory, 100);
  assert.deepEqual(r.totals, { mapped: 47, deferred: 18, excluded: 35 });
  assert.deepEqual(r.stated, r.totals);
  const cli = spawnSync(process.execPath, [path.join(KEV_DATA, 'lib', 'coverage.mjs')], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  const text = readFileSync(PROGRAM, 'utf8');
  assert.ok(coverage({ programText: text.replace('**D:B2** deferred.', '**D:B2** deferred. **D:B2** deferred.') }).errors.some(e => /^D:B2 appears 2 times/.test(e)));
  assert.ok(coverage({ programText: text.replace('**D:H6** deferred.', '') }).errors.some(e => /^D:H6 appears 0 times/.test(e)));
});

// Acceptance 4
test('tokens: lib/tokens.mjs counts fixtures with the pinned tokenizer; real/bytes-4 is near 2x for logs and tables and near 1.1x for prose', async t => {
  assert.equal(tokens.checkKevPin().kev.commit, '5e42a7a03f28134853dd3ff77461457e921e5ec1');
  assert.equal(tokens.TOKENIZER.revision, 'dc7cdfe2ee4154fa7e30f5b51ca41bfa40174e68');
  const r = await PY();
  assert.deepEqual(r.counts.slice(0, 3), [2, 59, 9], 'pinned counts of literal fixtures');
  const per = { log: [0, 0], table: [0, 0], prose: [0, 0] };
  r.fx.forEach((f, i) => {
    const [log, table, prose] = r.counts.slice(3 + i * 3, 6 + i * 3);
    for (const [k, real] of [['log', log], ['table', table], ['prose', prose]]) { per[k][0] += real; per[k][1] += tokens.bytes4(f[k]); }
    assert.ok(log / tokens.bytes4(f.log) > 1.5 && table / tokens.bytes4(f.table) > 1.5, `seed ${f.seed}: logs and tables cost more than bytes/4`);
    assert.ok(prose / tokens.bytes4(f.prose) < 1.25, `seed ${f.seed}: prose is close to bytes/4`);
  });
  const ratio = Object.fromEntries(Object.entries(per).map(([k, [real, b4]]) => [k, real / b4]));
  t.diagnostic(`real/bytes-4: log ${ratio.log.toFixed(2)} (${per.log.join('/')}), table ${ratio.table.toFixed(2)} (${per.table.join('/')}), prose ${ratio.prose.toFixed(3)} (${per.prose.join('/')}); one Python batch ${r.ms} ms`);
  assert.ok(ratio.log >= 1.7 && ratio.log <= 2.6, `log ${ratio.log}`);
  assert.ok(ratio.table >= 1.7 && ratio.table <= 2.6, `table ${ratio.table}`);
  assert.ok(ratio.prose >= 1.0 && ratio.prose <= 1.2, `prose ${ratio.prose}`);
});

// Acceptance 5
test('tokens: the fits() wrapper rejects a 9K-token record at maxState 8192 and accepts a 300-token record', async t => {
  const r = await PY(), res = r.measure.results.map((x, i) => ({ ...x, lines: r.sizes[i] }));
  assert.deepEqual(r.measure.context, { max_state: 8192, max_branch: 8832, max_packed: 9856 });
  const closest = target => res.reduce((a, b) => (Math.abs(b.stateTokens - target) < Math.abs(a.stateTokens - target) ? b : a));
  const big = closest(9000), small = closest(300);
  t.diagnostic(`9K record: ${big.lines} log lines, ${big.stateTokens} state tokens, fits ${big.fits}; 300 record: ${small.lines} lines, ${small.stateTokens} state tokens (${small.packedTokens} packed), fits ${small.fits}`);
  assert.ok(big.stateTokens >= 8550 && big.stateTokens <= 9450, `big ${big.stateTokens}`);
  assert.equal(big.fits, false); assert.match(big.error, /state exceeds 8192 tokens/);
  assert.ok(small.stateTokens >= 270 && small.stateTokens <= 330, `small ${small.stateTokens}`);
  assert.equal(small.fits, true);
  assert.ok(res.every(x => x.fits === (x.stateTokens <= 8192)), 'fits() at 8192 is exactly the state limit for these records');
  assert.equal(tokens.jobMaxState([300, 500, 9000]), 8192); assert.equal(tokens.jobMaxState([100, 200]), 384);
});

// Acceptance 6
test('leakage: a state key named kind fails and source_kind passes (exact names, any depth)', () => {
  assert.equal(checkStateKeys({ source_kind: 'vendor documentation', text: 'x' }).ok, true);
  const bad = checkStateKeys({ kind: 'erratum', text: 'x' });
  assert.equal(bad.ok, false); assert.deepEqual(bad.hits.map(h => h.path), ['kind']);
  assert.deepEqual(checkStateKeys({ source: { kind: 'memo' } }).hits.map(h => h.path), ['source.kind']);
  assert.deepEqual(checkStateKeys({ items: [{ text: 'a' }, { kind: 'b' }] }).hits.map(h => h.path), ['items.1.kind']);
  for (const k of FORBIDDEN_STATE_KEYS) assert.equal(checkStateKeys({ [k]: 1 }).ok, false, k);
  for (const k of ['node_kind', 'author_role', 'kinds', 'tags', 'template_text', 'Kind']) assert.equal(checkStateKeys({ [k]: 1 }).ok, true, k);
  assert.throws(() => assertPortState({ system: 'ATLAS', kind: 'note' }), /forbidden key/);
  const rec = r1Record({ system: 'ATLAS', source_note: 'ATLAS. Dates are day first.', kind: 'note' });
  const { errors } = checkRecord(rec, { slice: 'train', contracts: C(), variants: SPEC().spec.conventions.variants });
  assert.ok(errors.some(e => e.code === 'FORBIDDEN_KEY'), JSON.stringify(errors));
});

test('leakage: a planted perspTpl-3 sentence skeleton in an R1 training state is detected (and repaired or refused)', async () => {
  const { beds } = REAL();
  const { PERSP_NOTE } = await beds.import('beds/records/render.mjs');
  const { buildWorld, SYSTEM_ORDER } = await beds.import('beds/records/world.mjs');
  const names = [...SYSTEM_ORDER];
  const registry = new SpanRegistry();
  for (const S of Object.keys(PERSP_NOTE)) for (const side of ['recv', 'pay']) registry.add(PERSP_NOTE[S][side][3], { slice: 'heldout', source: `PERSP_NOTE[${S}].${side}[3]`, port: 'R3', kind: 'bed-template', names });
  assert.equal(registry.size, 8);
  let found = null;
  for (let seed = 401; seed < 441 && !found; seed++) {
    const w = buildWorld(seed, 'dev', 3);
    for (const S of ['ATLAS', 'BRIGHTDESK', 'LEDGR']) {
      const para = paragraphOf(w.notes, S);
      if (para && w.ctx.choices.perspTpl?.[S] !== 3 && !registry.scanState({ system: S, source_note: para }, { names, slice: 'train' }).length) { found = { seed, S, para }; break; }
    }
  }
  assert.ok(found, 'a clean R1 state in a train-range world');
  const clean = { system: found.S, source_note: found.para };
  const planted = PERSP_NOTE.KOBO.pay[3].replaceAll('KOBO', found.S);
  assert.notEqual(planted, PERSP_NOTE.KOBO.pay[3]);
  const leaky = { ...clean, source_note: insertAfterFirstSentence(found.para, planted) };
  const hits = registry.scanState(leaky, { names, slice: 'train' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].sentence, planted); assert.equal(hits[0].entry.source, 'PERSP_NOTE[KOBO].pay[3]'); assert.equal(hits[0].path, 'source_note');
  // another system's exact template is caught in every slice it may not reach, and not in test-OOD
  const exact = { ...clean, source_note: insertAfterFirstSentence(found.para, PERSP_NOTE.LEDGR.recv[3]) };
  for (const slice of ['train', 'calib-in', 'dev-select', 'calib-ood', 'dev-ood']) assert.equal(registry.scanState(exact, { names, slice }).length, 1, slice);
  assert.equal(registry.scanState(exact, { names, slice: 'test-ood' }).length, 0);
  // registry.json round trip (heldout/registry.json holds hashes, never text)
  const json = JSON.stringify(registry.toJSON());
  assert.ok(!json.includes('payables'));
  assert.equal(SpanRegistry.fromJSON(JSON.parse(json)).scanState(leaky, { names, slice: 'train' }).length, 1);
  // leak repair: the one sentence is re-rendered with a non-held-out template of the same pool and label
  const provider = listProvider({ persp: [{ text: PERSP_NOTE.KOBO.pay[1].replaceAll('KOBO', found.S), from: 'PERSP_NOTE[KOBO].pay[1]' }] });
  const fixed = repairLeaks(leaky, { registry, slice: 'train', provider, request: () => ({ key: 'persp', index: 0 }), skeletonOpts: { names } });
  assert.ok(fixed.ok, JSON.stringify(fixed));
  assert.equal(registry.scanState(fixed.state, { names, slice: 'train' }).length, 0);
  assert.equal(fixed.swaps.length, 1); assert.equal(fixed.state.source_note, leaky.source_note.replace(planted, PERSP_NOTE.KOBO.pay[1].replaceAll('KOBO', found.S)));
  // a provider that only offers held-out lines cannot repair it: the record is dropped and counted by the caller
  const stuck = repairLeaks(leaky, { registry, slice: 'train', provider: listProvider({ persp: [{ text: PERSP_NOTE.KOBO.recv[3], from: 'held-out' }] }), request: () => ({ key: 'persp' }), skeletonOpts: { names } });
  assert.equal(stuck.ok, false);
  // the build refuses the planted record (§10 global acceptance 2)
  const repo = stubBedRepo();
  await assert.rejects(buildKev({ root: repo, outRoot: H.tempDir(), generators: [inlineGen({ train: [r1Record(leaky, { seed: 401, masks: { names } })] })], registry, measure: false }),
    e => e.code === 'SPAN_LEAK' && /PERSP_NOTE\[KOBO\]\.pay\[3\]/.test(e.message));
});

// Acceptance 7
test('registry: a planted records:dev:d3:s101 in a train file fails the build', async () => {
  assert.equal(reservationOf('records:dev:d3:s101').id, 'probe-pilot');
  assert.equal(isReserved('records:dev:d5:s400'), true);
  assert.equal(isReserved('records:dev:d3:s401'), false);
  assert.equal(reservationOf('records:test:d4:s7001').id, 'real-reserve');
  assert.equal(reservedViolation('records:test:d4:s7001', 'real-reserve'), null);
  assert.ok(reservedViolation('records:test:d4:s7001', 'test-ood'));
  assert.equal(reservationOf('gameqa:test:d3:s7100').id, 'e2e-reserve');
  assert.throws(() => assertNoReserved(['incident:dev:d3:s7', 'records:dev:d3:s101'], 'train'), e => e.code === 'RESERVED_WORLD' && e.details.length === 2);
  const repo = stubBedRepo();
  const good = r1Record({ system: 'ATLAS', source_note: 'ATLAS. Numeric birth dates are written day first.' }, { seed: 401 });
  const planted = r1Record({ system: 'VENDEX', source_note: 'VENDEX. Numeric birth dates are written month first.' }, { seed: 101, label: 'mdy' });
  await assert.rejects(buildKev({ root: repo, outRoot: H.tempDir(), generators: [inlineGen({ train: [good, planted] })], measure: false }),
    e => e.code === 'RESERVED_WORLD' && /records:dev:d3:s101/.test(e.message));
  const viaWorlds = r1Record({ system: 'ATLAS', source_note: 'ATLAS. Day first.' }, { seed: 402, worlds: ['records:dev:d3:s101'] });
  await assert.rejects(buildKev({ root: repo, outRoot: H.tempDir(), generators: [inlineGen({ train: [viaWorlds] })], measure: false }), e => e.code === 'RESERVED_WORLD');
  // a planted line in a written train file fails the build verifier
  const built = await buildKev({ root: repo, outRoot: H.tempDir(), generators: [inlineGen({ train: [good] })], measure: false });
  assert.deepEqual(verifyBuildDir(built.dir).errors, []);
  const file = path.join(built.dir, 'kev', 'train.jsonl');
  const kept = readKevFile(file).map(({ state, questions, meta }) => ({ state, questions, meta }));
  exportKev([...kept, { ...planted, meta: { ...planted.meta, split: 'train' } }], { file, contracts: C(), slice: 'train' });
  const v = verifyBuildDir(built.dir);
  assert.ok(v.errors.some(e => e.code === 'RESERVED_WORLD' && /records:dev:d3:s101/.test(e.message)), JSON.stringify(v.errors));
});

// Acceptance 8
test('bed pin: adding a file under beds/sealed/ leaves the pin hash unchanged, and an fs-access spy shows no path under beds/sealed/ was opened', () => {
  const repo = stubBedRepo();
  let spy = H.accessSpy(), p1;
  try { p1 = bedPin(repo); worktreeDiff(repo, p1); } finally { spy.restore(); }
  const first = spy;
  H.writeFiles(repo, { 'beds/sealed/new-case.mjs': 'export const hidden = 2;\n' }); H.commitAll(repo, 'sealed case');
  H.writeFiles(repo, { 'beds/sealed/untracked.mjs': 'export const hidden = 3;\n' });
  spy = H.accessSpy(); let p2, d2;
  try { p2 = bedPin(repo); d2 = worktreeDiff(repo, p2); freezeBeds(repo, { outRoot: H.tempDir() }); } finally { spy.restore(); }
  assert.equal(p2.pin, p1.pin, 'the pin ignores beds/sealed/');
  assert.notEqual(p2.commit, p1.commit);
  assert.equal(d2.clean, true, 'an untracked sealed file is not part of the working-tree diff');
  assert.deepEqual(p1.files.map(f => f.path), ['beds/CONTRACT.md', 'beds/lib/canonical.mjs', 'beds/records/README.md', 'beds/records/index.mjs']);
  for (const s of [first, spy]) {
    assert.ok(s.paths.length > 0 && s.commands.length > 0, 'the spy saw the pin work');
    assert.deepEqual(s.touched(SEALED), []);
    for (const c of s.commands.filter(x => x[0] === 'git')) { const i = c.indexOf('--'); if (i >= 0) for (const p of c.slice(i + 1)) assert.ok(BED_ALLOWLIST.includes(p), `git pathspec ${p}`); }
  }
  // positive controls: an allow-listed change moves the pin; a non-allow-listed bed does not
  H.writeFiles(repo, { 'beds/scratch/y.mjs': 'export const y = 2;\n' }); H.commitAll(repo, 'scratch');
  assert.equal(bedPin(repo).pin, p1.pin);
  H.writeFiles(repo, { 'beds/records/extra.mjs': 'export const extra = 1;\n' }); H.commitAll(repo, 'extra');
  assert.notEqual(bedPin(repo).pin, p1.pin);
  // this repository: the real pin never touches beds/sealed/
  spy = H.accessSpy(); let real;
  try { real = bedPin(H.REPO_ROOT); worktreeDiff(H.REPO_ROOT, real); } finally { spy.restore(); }
  assert.deepEqual(spy.touched(SEALED), []);
  assert.ok(real.files.length > 100 && !real.files.some(f => SEALED.test(f.path)));
  assert.equal(real.versions['beds/incident/gen.mjs'], SPEC().spec.ports.I2.labelMap.bedVersion);
});

// Acceptance 9
test('frozen copy: builds import beds only from .foundry/kev-data/frozen/<pin>/; a changed working-tree diff hash between two runs refuses the build', async () => {
  // the default outRoot: <root>/.foundry/kev-data, so the copy is <root>/.foundry/kev-data/frozen/<pin>/
  const repo = stubBedRepo(), outRoot = path.join(repo, '.foundry', 'kev-data');
  const fz = freezeBeds(repo);
  assert.equal(fz.dir, path.join(repo, '.foundry', 'kev-data', 'frozen', fz.pinHex));
  assert.deepEqual(walk(fz.dir), ['FROZEN.json', 'beds/CONTRACT.md', 'beds/lib/canonical.mjs', 'beds/records/README.md', 'beds/records/index.mjs']);
  const handle = frozenBeds(fz), frozenUrl = pathToFileURL(fz.dir).href + '/';
  assert.ok((await handle.import('beds/records/index.mjs')).where.startsWith(frozenUrl));
  for (const p of ['beds/sealed/secret.mjs', 'beds/scratch/x.mjs', 'beds/records/../sealed/secret.mjs', '../beds/records/index.mjs']) assert.throws(() => handle.path(p), /BED_PATH/, p);
  // a build hands generators the frozen copy, and records carry its pin
  const seen = [];
  const gen = { group: 'frozen-check', ports: ['R1'], async *records(slice, seeds, opts, ctx) {
    const m = await ctx.beds.import('beds/records/index.mjs'); seen.push(m.where);
    for (const seed of seeds) yield r1Record({ system: 'ATLAS', source_note: m.note('ATLAS', 'dmy', seed) }, { seed });
  } };
  const b = await buildKev({ root: repo, generators: [gen], seeds: { train: { count: 2 } }, measure: false });
  assert.ok(seen.length && seen.every(w => w.startsWith(frozenUrl)));
  assert.equal(b.frozen.dir, fz.dir); assert.equal(b.frozen.created, false);
  assert.equal(path.dirname(b.dir), outRoot);
  assert.equal(b.manifest.beds.pin, fz.pin);
  assert.ok(readKevFile(path.join(b.dir, 'kev', 'train.jsonl')).every(r => r.meta.bedPin === fz.pin));
  // generators that reach the live beds tree are refused: a static import and a runtime import
  const liveFile = path.join(H.tempDir('kev-gen-'), 'live-gen.mjs');
  writeFileSync(liveFile, `import { note } from ${JSON.stringify(pathToFileURL(path.join(repo, 'beds', 'records', 'index.mjs')).href)};\nexport const group = 'live';\nexport function* records() {}\n`);
  await assert.rejects(buildKev({ root: repo, outRoot, generators: [liveFile], measure: false }), e => e.code === 'LIVE_BED_IMPORT');
  const sneaky = { group: 'sneaky', async *records() { const p = [repo, 'beds', 'records', 'index.mjs'].join(path.sep); await import(pathToFileURL(p).href); } };
  await assert.rejects(buildKev({ root: repo, outRoot, generators: [sneaky], measure: false }), e => e.code === 'LIVE_BED_IMPORT');
  // an uncommitted bed edit changes the working-tree diff hash: the next build is refused
  H.writeFiles(repo, { 'beds/records/index.mjs': FIXTURE_BED + '// edited\n' });
  assert.throws(() => freezeBeds(repo, { outRoot }), e => e.code === 'BED_DRIFT');
  await assert.rejects(buildKev({ root: repo, outRoot, generators: [gen], seeds: { train: { count: 1 } }, measure: false }), e => e.code === 'BED_DRIFT');
  // reverting restores the recorded diff hash; committing makes a new pin and a new frozen copy
  H.writeFiles(repo, { 'beds/records/index.mjs': FIXTURE_BED });
  assert.equal(freezeBeds(repo, { outRoot }).created, false);
  H.writeFiles(repo, { 'beds/records/index.mjs': FIXTURE_BED + '// edited\n' }); H.commitAll(repo, 'edit');
  const fz2 = freezeBeds(repo, { outRoot });
  assert.equal(fz2.created, true); assert.notEqual(fz2.pin, fz.pin);
});

// Acceptance 10
test('export-kev: output passes kev.data.load_records and materialize on CPU; unknowables carry _meta.source = "unknowable"; the meta sidecar is keyed by _meta.id', async t => {
  const r = await PY();
  for (const [ex, load, recs] of [[r.trainEx, r.loadTrain, r.ex.train], [r.evalEx, r.loadEval, r.ex.evaluation]]) {
    assert.equal(load.records, recs.length);
    assert.ok(load.results.every(x => x.ok && x.fits && !x.error), JSON.stringify(load.results.filter(x => !x.ok || !x.fits)));
    const lines = readFileSync(ex.file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const side = readFileSync(metaFileOf(ex.file), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.deepEqual(side.map(s => s.id), lines.map(l => l._meta.id), 'sidecar keyed by _meta.id, in file order');
    assert.deepEqual(load.results.map(x => x.id), lines.map(l => l._meta.id), 'Kev reads the same ids');
    for (const l of lines) {
      assert.deepEqual(Object.keys(l).sort(), ['_meta', 'questions', 'state']);
      assert.ok(Object.keys(l._meta).every(k => ['id', 'source'].includes(k)));
      for (const [qid, q] of Object.entries(l.questions)) assert.deepEqual(Object.keys(q).filter(k => !['type', 'instructions', 'criteria', 'label', 'src', 'target'].includes(k)), [], qid);
      assert.ok(!JSON.stringify(l).includes('"labelSource"') && !JSON.stringify(l).includes('"seed"'), 'no meta in the Kev file');
    }
    const back = readKevFile(ex.file);
    assert.deepEqual(back.map(b => b.meta.seed), recs.map(x => x.meta.seed));
  }
  const tr = r.loadTrain.results;
  assert.deepEqual(tr.map(x => x.source), ['custom', 'unknowable', 'custom', 'custom', 'custom'], 'soft-target unknowable -> unknowable; X5 not_stated stays a scored class');
  assert.deepEqual(tr.map(x => x.src), [['kevdata_R1', 'kevdata_R3'], ['kevdata_R1'], ['kevdata_S1', 'kevdata_S1_present'], ['kevdata_X5'], ['kevdata_F2']]);
  assert.deepEqual(r.loadEval.results.map(x => x.source), ['unknowable', 'custom']);
  assert.equal(r.trainEx.unknowable, 1); assert.equal(r.evalEx.unknowable, 1);
  t.diagnostic(`state tokens of the export fixtures: ${tr.map(x => x.stateTokens).join(', ')}`);
  // refusals
  const dir = H.tempDir('kev-export-bad-'), f = path.join(dir, 'x.jsonl');
  const noTarget = r1Record({ system: 'ATLAS', source_note: 'ATLAS. VENDEX is month first.' }, { variant: 'unknowable' });
  assert.throws(() => exportKev([noTarget], { file: f, contracts: C(), slice: 'train' }), e => e.code === 'EXPORT_UNKNOWABLE');
  assert.equal(exportKev([noTarget], { file: f, contracts: C(), slice: 'test-in' }).unknowable, 1, 'evaluation unknowables need no target');
  const offList = r1Record({ system: 'ATLAS', source_note: 'x' }); offList.questions.R1.label = 'iso';
  assert.throws(() => exportKev([offList], { file: f, contracts: C(), slice: 'train' }), e => e.code === 'EXPORT_QUESTION');
  const ledger = { state: { task_summary: 'x' }, questions: { L3: render.labelledQuestion(C().L3, { label: 'reuse' }) }, meta: {} };
  assert.throws(() => exportKev([ledger], { file: f, contracts: C(), slice: 'train' }), e => e.code === 'EXPORT_PORT');
  const extra = r1Record({ system: 'ATLAS', source_note: 'x' }); extra.questions.R1.template = 3;
  assert.throws(() => exportKev([extra], { file: f, contracts: C(), slice: 'train' }), e => e.code === 'EXPORT_QUESTION');
  const guard = new WordingGuard([{ port: 'R1', id: 'dev-01', slice: 'dev-ood', text: 'Per the vendor memo, how does {system} order day, month and year?' }]);
  const leaked = r1Record({ system: 'ATLAS', source_note: 'x' });
  leaked.questions.R1 = render.labelledQuestion(C().R1, { wordingText: 'Per the vendor memo, how does {system} order day, month and year?', slots: { system: 'ATLAS' }, label: 'dmy' });
  assert.throws(() => exportKev([leaked], { file: f, contracts: C(), slice: 'train', guard }), e => e.code === 'HELDOUT_WORDING');
  assert.equal(exportKev([leaked], { file: f, contracts: C(), slice: 'dev-ood', guard }).records, 1);
});

// Acceptance 11
test('determinism: a stub generator built twice is byte-identical', async t => {
  const repo = stubBedRepo();
  const genFile = path.join(H.tempDir('kev-gen-'), 'stub.mjs');
  writeFileSync(genFile, [
    `import { labelledQuestion, uniformTarget } from ${JSON.stringify(pathToFileURL(path.join(KEV_DATA, 'lib', 'render.mjs')).href)};`,
    `import { optionOrder } from ${JSON.stringify(pathToFileURL(path.join(KEV_DATA, 'lib', 'balance.mjs')).href)};`,
    "export const group = 'stub';",
    "export const ports = ['R1'];",
    'export async function* records(slice, seeds, opts, ctx) {',
    "  const bed = await ctx.beds.import('beds/records/index.mjs'), c = ctx.contracts.R1, options = Object.keys(c.options);",
    '  for (const seed of seeds) {',
    "    const system = ['BRIGHTDESK', 'ATLAS', 'VENDEX'][seed % 3], label = options[Math.floor(seed / 3) % 3];",
    "    const unknowable = slice === 'train' && seed % opts.unknowableEvery === 0;",
    '    const state = { system, source_note: bed.note(system, label, seed) };',
    "    const q = labelledQuestion(c, { wording: `Q${seed % 4}`, slots: { system }, label, optionOrder: optionOrder(options, `${slice}:${seed}`), ...(unknowable ? { target: uniformTarget(options) } : {}) });",
    "    yield { state, questions: { R1: q }, meta: { family: 'records', bed: 'records', seed, difficulty: 3 + (seed % 3), variant: unknowable ? 'unknowable' : 'clean', labelSource: 'generator', formId: null } };",
    '  }',
    '}', ''].join('\n'));
  const cfg = { root: repo, generators: [genFile], slices: ['train', 'calib-in', 'dev-select'], seeds: { train: { count: 12 }, 'calib-in': { count: 4 }, 'dev-select': { count: 4 } }, opts: { unknowableEvery: 5 } };
  const a = await buildKev({ ...cfg, outRoot: H.tempDir('kev-build-a-') });
  const b = await buildKev({ ...cfg, outRoot: H.tempDir('kev-build-b-') });
  assert.equal(a.buildId, b.buildId);
  const fa = walk(a.dir), fb = walk(b.dir);
  assert.deepEqual(fa, fb);
  assert.deepEqual(fa, ['kev/calib-in.jsonl', 'kev/calib-in.meta.jsonl', 'kev/dev-select.jsonl', 'kev/dev-select.meta.jsonl', 'kev/train.jsonl', 'kev/train.meta.jsonl', 'manifest.json', 'timing.json']);
  for (const f of fa.filter(x => x !== 'timing.json')) assert.ok(readFileSync(path.join(a.dir, f)).equals(readFileSync(path.join(b.dir, f))), `${f} differs between two builds`);
  const m = a.manifest;
  assert.deepEqual(Object.fromEntries(Object.entries(m.slices).map(([s, x]) => [s, x.records])), { train: 12, 'calib-in': 4, 'dev-select': 4 });
  assert.equal(m.slices.train.unknowable, 2);
  assert.ok(m.slices.train.perPort.R1.stateTokens.max > 0 && m.jobMaxState === 384, 'real-token stats from Kev fits()');
  assert.equal(m.beds.pin, a.frozen.pin);
  assert.deepEqual(verifyBuildDir(a.dir).errors, []);
  const timing = JSON.parse(readFileSync(path.join(a.dir, 'timing.json'), 'utf8'));
  t.diagnostic(`build ${a.buildId}: ${timing.totalMs} ms total (measure ${timing.measureMs} ms); second build ${b.timing.totalMs} ms; R1 state tokens p50 ${m.slices.train.perPort.R1.stateTokens.p50}`);
  // a different generator option is a different build id (same seeds, different records)
  const c = await buildKev({ ...cfg, opts: { unknowableEvery: 7 }, outRoot: H.tempDir('kev-build-c-'), measure: false });
  assert.notEqual(c.buildId, a.buildId);
});

// Acceptance 12
test('seeded defect: this file runs alone with node --test and fails on seeded defects', { skip: MUTANT_RUN ? 'inside a mutant run' : false, timeout: 10 * 60 * 1000 }, t => {
  const pattern = '^(spec/ports\\.json validates|render: |registry: |leakage: a state key)';
  const mutants = [
    { name: 'spec: R2 loses Q3', mutations: [{ file: 'spec/ports.json', from: '"Q3": "What does the marker {value} mean for a {system} row?"', to: '"Q9": "What does the marker {value} mean for a {system} row?"' }], expect: /^spec\/ports\.json validates/ },
    { name: 'render: the kit pads the question', mutations: [{ file: 'judges/kit.mjs', from: 'const question = fillWording(text, slots);', to: "const question = fillWording(text, slots) + ' ';" }], expect: /^render: / },
    { name: 'registry: the probe reserve shrinks to 1-100', mutations: [{ file: 'lib/registry.mjs', from: 'seeds: [1, 400]', to: 'seeds: [1, 100]' }], expect: /^registry: / },
    { name: 'leakage: kind is no longer forbidden', mutations: [{ file: 'judges/kit.mjs', from: "'tag', 'kind', 'tpl'", to: "'tag', 'tpl'" }], expect: /^leakage: a state key/ },
  ];
  const t0 = Date.now();
  const r = H.seededDefect({ file: TEST_FILE, pattern, mutants, env: { KEV_DATA_MUTANT_RUN: '1' } });
  assert.equal(r.control.status, 0, `unmutated copy must pass:\n${r.control.stdout.slice(-3000)}\n${r.control.stderr.slice(-2000)}`);
  assert.equal(r.control.passed.length, 4, `control passed: ${r.control.passed.join(' | ')}`);
  r.mutants.forEach((m, i) => {
    assert.notEqual(m.status, 0, `${m.name} was not caught`);
    assert.ok(m.failed.some(n => mutants[i].expect.test(n)), `${m.name}: failed ${JSON.stringify(m.failed)}`);
  });
  t.diagnostic(`control passed ${r.control.passed.length}; mutants caught: ${r.mutants.map(m => `${m.name} -> ${m.failed.join(', ')}`).join('; ')} (${Date.now() - t0} ms)`);
});

// ---------------------------------------------------------------------------------------------
// Module checks other groups rely on
test('build: the §3.1 slice table has disjoint seed ranges above the reserved range; seeds are checked', () => {
  const all = [RESERVED, ...SLICES];
  for (const a of all) for (const b of all) if (a !== b && a.bedSplit === b.bedSplit) assert.ok(a.seeds[1] < b.seeds[0] || b.seeds[1] < a.seeds[0], `${a.id} and ${b.id} overlap`);
  assert.deepEqual(SLICES.map(s => s.id), ['train', 'calib-in', 'calib-ood', 'dev-select', 'dev-ood', 'test-in', 'test-ood', 'real-reserve', 'e2e-reserve']);
  assert.ok(SLICES.filter(s => s.bedSplit === 'test').every(s => s.seeds[0] >= 5000));
  assert.deepEqual(seedsFor('train', { count: 3 }), [401, 402, 403]);
  assert.throws(() => seedsFor('train', [100]), e => e.code === 'SEED_RANGE');
  assert.throws(() => seedsFor('calib-in', [4200]), e => e.code === 'SEED_RANGE');
  const base = r1Record({ system: 'ATLAS', source_note: 'ATLAS. Day first.' }, { seed: 4000 });
  const v = SPEC().spec.conventions.variants;
  assert.ok(checkRecord(base, { slice: 'train', contracts: C(), variants: v }).errors.some(e => e.code === 'SEED_RANGE'));
  assert.deepEqual(checkRecord(base, { slice: 'calib-in', contracts: C(), variants: v }).errors, []);
  const llm = r1Record({ system: 'ATLAS', source_note: 'x' }); llm.meta.labelSource = 'llm';
  assert.ok(checkRecord(llm, { slice: 'train', contracts: C(), variants: v }).errors.some(e => e.code === 'LABEL_SOURCE'));
  const reworded = r1Record({ system: 'ATLAS', source_note: 'x' }); reworded.questions.R1.instructions += ' Answer carefully.';
  assert.ok(checkRecord(reworded, { slice: 'train', contracts: C(), variants: v }).errors.some(e => e.code === 'WORDING'));
  const ood = r1Record({ system: 'ATLAS', source_note: 'x' }, { seed: 4200 });
  assert.ok(checkRecord(ood, { slice: 'calib-ood', contracts: C(), variants: v }).errors.some(e => e.code === 'WORDING'), 'OOD slices need held-out wordings');
  const two = r1Record({ system: 'ATLAS', source_note: 'x' }, { seed: 4500 });
  two.questions['R1~b'] = render.labelledQuestion(C().R1, { wording: 'Q1', slots: { system: 'ATLAS' }, label: 'dmy' });
  assert.deepEqual(checkRecord(two, { slice: 'dev-select', contracts: C(), variants: v }).errors, []);
  assert.deepEqual(H.checkRecords([two], { slice: 'dev-select' }), []);
  assert.ok(H.checkRecords([base], { slice: 'train' }).some(e => e.code === 'SEED_RANGE' && e.index === 0));
  // test slices: one question per port per state (an authored record with no bed world, so no test seed is involved)
  const authored = { ...two, meta: { ...two.meta, bed: null, seed: null, difficulty: null, family: 'authored', labelSource: 'authored-brief' } };
  assert.ok(checkRecord(authored, { slice: 'test-in', contracts: C(), variants: v }).errors.some(e => e.code === 'QUESTION_LIMIT'));
  assert.deepEqual(checkRecord({ ...authored, meta: { ...authored.meta, variant: 'paraphrase' } }, { slice: 'test-in', contracts: C(), variants: v }).errors, []);
});

test('build: a test slice refuses a second question of one port on the same state, across records', async () => {
  const a = r1Record({ system: 'ATLAS', source_note: 'ATLAS. Numeric birth dates are written day first.' });
  a.meta = { ...a.meta, bed: null, seed: null, difficulty: null, family: 'authored', labelSource: 'authored-brief' };
  const b = structuredClone(a); b.questions.R1 = render.labelledQuestion(C().R1, { wording: 'Q2', slots: { system: 'ATLAS' }, label: 'dmy' });
  const repo = stubBedRepo();
  await assert.rejects(buildKev({ root: repo, outRoot: H.tempDir(), slices: ['test-in'], seeds: { 'test-in': [] }, generators: [inlineGen({ 'test-in': [a, b] })], measure: false }), e => e.code === 'QUESTION_LIMIT');
  const ok = await buildKev({ root: repo, outRoot: H.tempDir(), slices: ['test-in'], seeds: { 'test-in': [] }, generators: [inlineGen({ 'test-in': [a] })], measure: false });
  assert.equal(ok.manifest.slices['test-in'].records, 1);
});

test('hash: canonical() matches beds/lib/canonical.mjs in the frozen copy; skeletons mask names, dates, digits and quotes', async () => {
  const bedCanonical = (await REAL().beds.import('beds/lib/canonical.mjs')).canonical;
  for (const v of [{ b: [1, { z: null, a: 'x' }], a: true }, 'é', [], {}, 1.5]) assert.equal(canonical(v), bedCanonical(v));
  assert.equal(stateHash({ a: 1, b: 2 }), stateHash({ b: 2, a: 1 }));
  assert.equal(spanHash('  A  b\n'), spanHash('A b'));
  const opts = { names: ['ATLAS', 'VENDEX'] };
  assert.equal(skeletonText('ATLAS wrote 12/03/2024 for row 1182 ("owed").', opts), skeletonText('VENDEX wrote 2023-01-09 for row 7 ("due").', opts));
  assert.equal(skeletonText('ATLAS wrote 12/03/2024 for row 1182 ("owed").', opts), '<n> wrote <t> for row <d> (<q>).');
  assert.ok(['train', 'calib-ood', 'dev-ood', 'test-ood'].includes(skeletonBucket(spanHash('x'))));
});

test('counterfactual: one-sentence re-render through an opaque line provider', () => {
  assert.deepEqual(replaceSentence('A. B. A.', 'A.', 'C.'), { ok: false, reason: 'sentence-ambiguous', occurrences: 2 });
  assert.equal(replaceSentence('A. B.', 'B.', 'C$&.').text, 'A. C$&.');
  const state = { system: 'ATLAS', source_note: 'ATLAS. Balances keep their sign in the master. Dates are day first.' };
  const calls = [];
  const provider = req => { calls.push(req); return req.attempt === 0 ? { text: 'Balances change sign in the master.', from: 'PERSP_NOTE[BRIGHTDESK].pay[3]' } : null; };
  const r = rerender(state, { path: 'source_note', sentence: 'Balances keep their sign in the master.', request: { port: 'R3', label: 'opposite', from: 'PERSP_NOTE[BRIGHTDESK].recv[3]' }, provider });
  assert.ok(r.ok);
  assert.equal(r.state.source_note, 'ATLAS. Balances change sign in the master. Dates are day first.');
  assert.deepEqual(r.counterfactual, { swapped: true, from: 'PERSP_NOTE[BRIGHTDESK].recv[3]', to: 'PERSP_NOTE[BRIGHTDESK].pay[3]', path: 'source_note', sentence: 'Balances keep their sign in the master.' });
  assert.equal(state.source_note.includes('keep'), true, 'the input state is not mutated');
  assert.equal(calls[0].port, 'R3');
  assert.equal(rerender(state, { path: 'source_note', sentence: 'Not there.', provider }).reason, 'sentence-not-found');
  assert.equal(rerender(state, { path: 'source_note', sentence: 'Dates are day first.', provider: () => null }).reason, 'provider-exhausted');
});

test('probe: the bag-of-words logistic probe (unigrams + bigrams) is deterministic and finds the decisive words', () => {
  const ex = [];
  for (let i = 0; i < 40; i++) {
    ex.push({ text: `note ${i}: the sign is reversed for row ${i}`, label: 'opposite' });
    ex.push({ text: `note ${i}: the sign is kept for row ${i}`, label: 'same' });
  }
  const m1 = trainProbe(ex), m2 = trainProbe(ex);
  assert.deepEqual(m1, m2);
  assert.equal(evaluate(m1, ex).accuracy, 1);
  assert.equal(evaluate(m1, [{ text: 'the sign is reversed', label: 'opposite' }, { text: 'the sign is kept', label: 'same' }]).accuracy, 1);
  assert.ok(topFeatures(m1, 'opposite', 3).some(([f]) => /reversed/.test(f)));
});

test('balance: 3:1 cap, within-entity balance, deployment-rate draws, importance weights and option positions', () => {
  const rows = [...Array(30)].map((_, i) => ({ id: i, system: i % 2 ? 'KOBO' : 'ATLAS', label: i < 24 ? 'void' : 'live' }));
  const cap = capRatio(rows, { label: r => r.label, key: r => r.id });
  assert.deepEqual(cap.counts, { void: 18, live: 6 });
  assert.deepEqual(capRatio(rows, { label: r => r.label, key: r => r.id }).kept, cap.kept, 'deterministic');
  const within = balanceWithin(rows, { group: r => r.system, label: r => r.label, labels: ['void', 'live'], key: r => r.id });
  for (const s of ['ATLAS', 'KOBO']) { const k = within.kept.filter(r => r.system === s); assert.equal(k.filter(r => r.label === 'void').length, k.filter(r => r.label === 'live').length); }
  const kobo = balanceWithin(rows.filter(r => r.system === 'KOBO' && r.label === 'void'), { group: r => r.system, label: r => r.label, labels: ['void', 'live'], key: r => r.id });
  assert.deepEqual(kobo.missing, [{ group: 'KOBO', labels: ['live'] }], 'a missing label is reported for counterfactual rows, never padded');
  const draw = sampleAtRate(rows, { label: r => r.label, rates: { void: 0.75, live: 0.25 }, n: 12, key: r => r.id });
  assert.deepEqual(draw.taken, { void: 9, live: 3 });
  const w = importanceWeights(rows.slice(18), { label: r => r.label, target: { void: 0.9, live: 0.1 } });
  assert.ok(w.void > w.live);
  const qs = [...Array(300)].map((_, i) => { const o = optionOrder(['dmy', 'mdy', 'ymd'], `r${i}`); return { criteria: Object.fromEntries(o.map(x => [x, ''])), label: 'dmy' }; });
  assert.ok(checkPositionUniform(positionHistogram(qs), { tolerance: 0.08 }).ok);
  assert.equal(checkPositionUniform(positionHistogram(qs.map(q => ({ criteria: { dmy: '', mdy: '', ymd: '' }, label: 'dmy' })))).ok, false);
});

test('kit: definePortKit builds checked states and renders questions from frozen contracts', () => {
  const kit = definePortKit({ bed: 'records', contracts: { R1: C().R1, R3: C().R3 }, buildState: (task, { system }) => ({ system, source_note: task.notes[system] }) });
  const task = { notes: { ATLAS: 'ATLAS. Dates are day first.' } };
  assert.deepEqual(kit.buildState(task, { system: 'ATLAS' }), { system: 'ATLAS', source_note: 'ATLAS. Dates are day first.' });
  assert.deepEqual(kit.questions('R1', { system: 'ATLAS' }), { R1: render.renderQuestion(C().R1, { slots: { system: 'ATLAS' } }) });
  assert.throws(() => kit.questions('R2', { system: 'ATLAS' }), /no port R2/);
  const leaky = definePortKit({ bed: 'records', contracts: { R1: C().R1 }, buildState: () => ({ system: 'ATLAS', tpl: 3 }) });
  assert.throws(() => leaky.buildState({}, {}), /forbidden key/);
});
