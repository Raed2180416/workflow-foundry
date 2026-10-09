// Oracle health for W-bed R5 "legacy dump" (beds/CONTRACT.md rules; W-BED §2.2, §2.4, §3.5). Loaded by path; the
// registration shim beds/wbed-r5/index.mjs makes it loadable as family 'wbed-r5'. No model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as bed from './index.mjs';
import * as R1 from '../r1/index.mjs';
import * as R4 from '../r4/index.mjs';
import { buildDump, dumpLayer, LEVELS } from './world.mjs';
import { decodeStage, mistakesFor, rowsEqual, verifyPredicate, GENERIC_MISTAKES } from './decode.mjs';
import { r1TraceOnRows } from './pipeline.mjs';
import { FORMATS, FORMAT_BY_ID, formatOf, classOf, DEV_FORMAT_IDS } from './catalogue.mjs';
import { DECODER_TEXT, decode as toolDecode } from './decoder-tool.mjs';
import { childSeedOf } from '../r4/children.mjs';
import { canonical, sha256, estimateTokens } from '../lib/prng.mjs';
import { trailerKey } from '../lib/legacy.mjs';
import { inlineRender, loadFamily } from '../../../experiments/lib/beds.mjs';
import { portableSchemaViolations } from '../../../src/schema-subset.mjs';
import { plan, runStub } from '../attacks/triviality.mjs';

const SEEDS = Array.from({ length: 20 }, (_, i) => 301 + i); // dev 301-320 (wbed-dev)
const DS = [2, 3, 4, 5];
const hashOf = t => sha256(canonical(t));
const gen = (seed, d, split = 'dev') => bed.generate({ seed, split, difficulty: d });
const r5 = (...a) => console.log('[r5]', ...a);
const TEXT_ONLY = /^[^\u0000-\u0009\u000B-\u001F\u007F]*$/u; // text files: no control characters but newline

test('exports the bed interface plus the W-specific and R5-specific exports', async () => {
  for (const k of ['family', 'outputSchema', 'generate', 'oracle', 'referenceSolve', 'badControls', 'necessityControls', 'version', 'difficulty', 'stages',
    'structure', 'relations', 'composedOracle', 'referenceTrace', 'invariants', 'verifyPredicate', 'restoreInputs', 'dumpOf', 'childTask', 'CATALOGUE', 'formatOf']) assert.ok(k in bed, k);
  assert.equal(bed.family.id, 'wbed-r5');
  assert.equal(bed.family.version, '1.0.0');
  assert.equal(bed.version, '1.0.0');
  assert.equal(bed.family.kind, 'oneshot');
  assert.deepEqual(bed.stages.map(s => s.id), ['decode', 'children', 'translate', 'pair', 'eliminate', 'report']);
  for (const s of bed.stages) for (const k of ['inputSchema', 'outputSchema', 'oracle', 'project']) assert.ok(s[k], `${s.id}.${k}`);
  assert.equal(bed.structure.shape, 'agentic-node');
  assert.equal(bed.structure.features.agentNodes, 1);
  const o = bed.structure.outline.join('\n');
  assert.match(o, /flow\.agent\("decode-dump", .*verify: .*verifyPredicate/);
  assert.match(o, /flow\.call\(R1_REF_HASH, restored inputs/);
  for (const re of [/step restore/, /judge intercompany/, /step eliminate/, /invariant conservation/]) assert.match(o, re);
  assert.equal((await loadFamily('wbed-r5')).family.id, 'wbed-r5');
  assert.ok(readFileSync(new URL('../../wbed-r5/index.mjs', import.meta.url), 'utf8').includes("'../wbed/r5/index.mjs'"));
});

test('output schema and stage contracts are in the portable subset', () => {
  assert.deepEqual(portableSchemaViolations(bed.outputSchema), []);
  for (const s of bed.stages) { assert.deepEqual(portableSchemaViolations(s.inputSchema), [], s.id); assert.deepEqual(portableSchemaViolations(s.outputSchema), [], s.id); }
});

test('generator is deterministic: same seed -> same task hash, also in a fresh process', () => {
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

// ---------------------------------------------------------------------------------------------------------------------
const necessity = bed.necessityControls[0];
const verifyStats = { wrong: 0, missOwn: 0, missTrue: 0, weakMissOwn: 0, byControl: {} };
for (const d of DS) {
  test(`d${d}: referenceSolve passes, every applicable bad control fails, the necessity control fails exactly on non-dev formats (${SEEDS.length} seeds)`, () => {
    let redraws = 0, applied = 0, necFail = 0;
    const formats = {};
    for (const seed of SEEDS) {
      const task = gen(seed, d), w = buildDump(seed, 'dev', d);
      redraws += w.attempt;
      formats[w.format.id] = (formats[w.format.id] ?? 0) + 1;
      const ref = bed.oracle(task, bed.referenceSolve(task));
      assert.ok(ref.pass, `reference fails seed ${seed}: ${JSON.stringify(ref.details).slice(0, 300)}`);
      assert.equal(ref.score, 1);
      const controls = bed.badControls.filter(c => c.applies(task));
      assert.ok(controls.length >= 12, `${controls.length} controls at d${d}`);
      applied += controls.length;
      for (const c of controls) {
        const r = bed.oracle(task, c.make(task));
        assert.equal(r.pass, false, `control ${c.name} passes seed ${seed} d${d}`);
        assert.ok(r.score < 1);
      }
      // Verify predicate on every decode control's own decode (what the agent node would hand its verify).
      for (const m of mistakesFor(w.format)) {
        const x = decodeStage(w, m);
        verifyStats.wrong++;
        const own = verifyPredicate(x.rows, x.trailer) === null, tru = verifyPredicate(x.rows, w.trailer) === null;
        if (own) verifyStats.missOwn++;
        if (tru) verifyStats.missTrue++;
        if (verifyPredicate(x.rows, x.trailer, { hashes: false }) === null) verifyStats.weakMissOwn++;
      }
      assert.equal(verifyPredicate(w.rows, w.trailer), null, 'verify accepts the truth');
      // Necessity: R4 reference + dev-format parsers. Passes on dev formats, fails (rows and the R4 part) elsewhere.
      const nOut = necessity.make(task), n = bed.oracle(task, nOut);
      const dev = DEV_FORMAT_IDS.includes(w.format.id);
      assert.equal(n.pass, dev, `necessity on ${w.format.id} seed ${seed} d${d}`);
      assert.equal(dev, classOf(seed, d) === 'dev');
      if (!dev) {
        necFail++;
        const { dump, ...r4part } = nOut; void dump;
        assert.equal(R4.oracle(task, r4part).pass, false, 'without the dump\'s rows the pack (and so R4) fails too');
      }
    }
    const share = necFail / SEEDS.length;
    assert.ok(share >= 0.5, `necessity fails ${necFail}/${SEEDS.length} at d${d}`);
    if (d === 5) assert.equal(necFail, SEEDS.length);
    r5(`d${d}: formats ${JSON.stringify(formats)}; applicable controls per task ${(applied / SEEDS.length).toFixed(1)}; dump re-draws ${redraws}; necessity fails ${necFail}/${SEEDS.length}`);
  });
}

test('controls: CONTRACT minimums, the brief\'s decode mistakes, R4 inherited, relation control, necessity', () => {
  const names = bed.badControls.map(c => c.name);
  assert.equal(new Set(names).size, names.length);
  for (const n of ['empty', 'shuffled-or-corrupted', 'codepage-standard', 'fixed-width-off-by-one', 'header-drift-mismapped', 'schema-switch-ignored',
    'decoys-kept', 'trailer-as-row', 'decoder-wrong-flags', 'totals-forced', 'amount-units-misread', 'dump-rows-raw-reported',
    'amount-only-pairing', 'fx-direction-inverted', 'child-error-propagated', 'outside-profile-reused']) assert.ok(names.includes(n), n);
  assert.equal(bed.badControls.filter(c => c.inherited === 'wbed-r4').length, R4.badControls.length);
  for (const f of FORMATS) assert.ok(bed.badControls.some(c => c.name === f.mistake.name && c.formats?.[0] === f.id), f.id);
  assert.ok(bed.badControls.length >= 12);
  assert.deepEqual(bed.necessityControls.map(c => c.name), ['necessity:dev-parsers-only']);
});

// ---------------------------------------------------------------------------------------------------------------------
// The catalogue on bare R1 packs: every format over 20 packs (child seeds of dev parents 301-320; R1 at d3 and d4) at
// every vagueness level. Every format's decoder reproduces the truth; each of its decode mistakes changes the rows on
// every pack (so each format-specific control fails on >= 20 tasks); the verify predicate's miss rate is measured.
const PACKS = Array.from({ length: 20 }, (_, i) => ({ seed: childSeedOf(301 + i, i < 10 ? 3 : 4, 0), split: 'dev', difficulty: i < 10 ? 3 : 4 }));
test('catalogue: >= 8 formats; each decodes its own dump exactly on 20 R1 packs; every decode mistake changes the rows; verify miss rate', () => {
  assert.ok(FORMATS.length >= 8);
  assert.equal(new Set(FORMATS.map(f => f.id)).size, FORMATS.length);
  assert.ok(new Set(FORMATS.map(f => f.mistake.name)).size === FORMATS.length);
  const stats = { layers: 0, wrong: 0, missOwn: 0, missTrue: 0, weakMissOwn: 0, weakMissTrue: 0, redraws: 0, byMistake: {} };
  const tokens = {};
  PACKS.forEach((spec, i) => {
    const kidTask = R1.generate(spec);
    const L = LEVELS[2 + (i % 4)];
    for (const f of FORMATS) {
      const layer = dumpLayer({ spec: { ...spec, difficulty: 2 + (i % 4) }, L, kidTask, kidSpec: spec, subInfo: { id: 'S1', name: 'Hollin Testbed Ltd', short: 'Hollin Testbed' }, format: f });
      stats.layers++; stats.redraws += layer.attempt;
      for (const [n, t] of Object.entries(layer.files)) assert.ok(typeof t === 'string' && TEXT_ONLY.test(t), `${f.id} ${n} is text`);
      const dec = f.decode(layer.files);
      assert.ok(rowsEqual(layer.rows, dec.rows) && trailerKey(dec.trailer) === trailerKey(layer.trailer), `${f.id} decodes pack ${i}`);
      assert.equal(verifyPredicate(dec.rows, dec.trailer), null);
      (tokens[f.id] ??= []).push(Object.values(layer.files).reduce((a, t) => a + estimateTokens(t), 0));
      for (const m of mistakesFor(f)) {
        const x = decodeStage(layer, m);
        assert.ok(!rowsEqual(layer.rows, x.rows), `${f.id} ${m} pack ${i}: the mistake changes the rows`);
        const b = (stats.byMistake[m] ??= { n: 0, missOwn: 0, weakMissOwn: 0 });
        b.n++; stats.wrong++;
        if (verifyPredicate(x.rows, x.trailer) === null) { stats.missOwn++; b.missOwn++; }
        if (verifyPredicate(x.rows, layer.trailer) === null) stats.missTrue++;
        if (verifyPredicate(x.rows, x.trailer, { hashes: false }) === null) { stats.weakMissOwn++; b.weakMissOwn++; }
        if (verifyPredicate(x.rows, layer.trailer, { hashes: false }) === null) stats.weakMissTrue++;
      }
    }
  });
  const weakBy = Object.fromEntries(Object.entries(stats.byMistake).filter(([, b]) => b.weakMissOwn).map(([m, b]) => [m, `${b.weakMissOwn}/${b.n}`]));
  r5(`catalogue: ${stats.layers} dumps (${FORMATS.length} formats x ${PACKS.length} packs), re-draws ${stats.redraws}; wrong decodes ${stats.wrong}`);
  r5(`verify miss rate (full predicate): ${stats.missOwn}/${stats.wrong} with the misreading's own trailer, ${stats.missTrue}/${stats.wrong} with the true trailer`);
  r5(`verify miss rate (count + row ids + amounts only, no hash totals): ${stats.weakMissOwn}/${stats.wrong} own trailer, ${stats.weakMissTrue}/${stats.wrong} true trailer; by mistake ${JSON.stringify(weakBy)}`);
  r5('dump tokens per format (R1 packs at d3/d4; mean, min-max):', JSON.stringify(Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, `${Math.round(v.reduce((a, b) => a + b, 0) / v.length)} (${Math.min(...v)}-${Math.max(...v)})`]))));
  // The measured numbers (W-BED §3.5 falsifier: the verify predicate may miss a wrong decode at most 1 in 20).
  assert.equal(stats.wrong, FORMATS.length * PACKS.length * (GENERIC_MISTAKES.length + 1));
  assert.equal(stats.missOwn, 0);
  assert.equal(stats.missTrue, 0);
  assert.ok(stats.missOwn / stats.wrong <= 1 / 20);
  // Without the hash totals the predicate misses the misreadings that touch text only: dropped continuation lines cut
  // dates and status texts but (on 16 of 20 packs) no number, so count, row ids and amounts still tie out.
  assert.equal(stats.weakMissOwn, 16);
  assert.deepEqual(weakBy, { 'continuation-dropped': '16/20' });
});

test('verify predicate on the R5 tasks: accepts every truth, misses no wrong decode (d2-d5 x 20 seeds, measured in the control loop)', () => {
  assert.ok(verifyStats.wrong >= DS.length * SEEDS.length * (GENERIC_MISTAKES.length + 1), `${verifyStats.wrong} wrong decodes measured`);
  r5(`verify on R5 tasks: wrong decodes ${verifyStats.wrong}, missed (own trailer) ${verifyStats.missOwn}, missed (true trailer) ${verifyStats.missTrue}, weak predicate missed ${verifyStats.weakMissOwn}`);
  assert.equal(verifyStats.missOwn, 0);
  assert.equal(verifyStats.missTrue, 0);
  assert.equal(verifyStats.weakMissOwn, 18, 'the weaker predicate (no hash totals) misses 18: keyed-stanzas tasks with continuation-dropped');
  // Reasons are specific: a count mismatch, a total or a hash total.
  const w = buildDump(304, 'dev', 3);
  assert.match(verifyPredicate(decodeStage(w, 'decoys-kept').rows, w.trailer), /record count/);
  assert.match(verifyPredicate(decodeStage(w, 'totals-forced').rows, w.trailer), /total/);
  assert.equal(verifyPredicate(null, w.trailer), 'rows is not a list');
  assert.equal(verifyPredicate(w.rows, null), 'no trailer');
});

test('novel formats: never drawn at d <= 4; at d5 split dev and split test draw disjoint pools that no d <= 4 task uses', () => {
  const at = { low: new Set(), d5dev: new Set(), d5test: new Set() };
  const dev = Array.from({ length: 90 }, (_, i) => 301 + i), held = [8201, 8301, 8401, 8501].flatMap(a => Array.from({ length: 24 }, (_, i) => a + i));
  for (const [split, seeds] of [['dev', dev], ['test', held]]) for (const seed of seeds) {
    for (const d of [2, 3, 4]) {
      const f = formatOf({ seed, split, difficulty: d });
      assert.ok(f.tier === 'dev' || f.tier === 'wild', `${f.id} at d${d}`);
      if (d === 2) assert.ok(f.grade <= 1);
      at.low.add(f.id);
    }
    const f5 = formatOf({ seed, split, difficulty: 5 });
    assert.equal(f5.tier, split === 'dev' ? 'novel-dev' : 'novel-test');
    at[split === 'dev' ? 'd5dev' : 'd5test'].add(f5.id);
  }
  for (const id of at.d5dev) { assert.ok(!at.low.has(id)); assert.ok(!at.d5test.has(id)); }
  for (const id of at.d5test) assert.ok(!at.low.has(id));
  assert.deepEqual([...at.d5dev].sort(), bed.NOVEL_IDS.dev.slice().sort());
  assert.deepEqual([...at.d5test].sort(), bed.NOVEL_IDS.test.slice().sort());
  assert.equal(at.low.size, 7, 'every dev and wild format is drawn at d <= 4');
  // The necessity share by construction: seeds with seed mod 3 != 0 (two in three) carry a wild format at d2-d4.
  for (const d of [2, 3, 4]) {
    const nonDev = dev.filter(s => !DEV_FORMAT_IDS.includes(formatOf({ seed: s, split: 'dev', difficulty: d }).id)).length;
    assert.equal(nonDev, 60);
  }
  r5(`format pools: d<=4 ${[...at.low].join(', ')}; d5 dev ${[...at.d5dev].join(', ')}; d5 test ${[...at.d5test].join(', ')}`);
});

test('held-out d5 tasks carry a test-only novel format and still decode exactly (4 held-out seeds)', () => {
  for (const seed of [8201, 8202, 8301, 8302]) {
    const task = gen(seed, 5, 'test');
    const w = buildDump(seed, 'test', 5);
    assert.equal(w.format.tier, 'novel-test');
    assert.ok(bed.oracle(task, bed.referenceSolve(task)).pass);
    assert.equal(bed.oracle(task, necessity.make(task)).pass, false);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
test('composed oracle (decode stage AND D1-D3 AND R4\'s composed oracle) agrees with the end-to-end oracle on every trace', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 2)) {
    const task = gen(seed, d);
    const ref = bed.composedOracle(task, bed.referenceTrace(task));
    assert.ok(ref.pass, JSON.stringify(ref).slice(0, 600));
    for (const c of [...bed.badControls, ...bed.necessityControls].filter(x => x.trace && x.applies(task))) {
      const tr = c.trace(task);
      const co = bed.composedOracle(task, tr);
      assert.equal(co.pass, bed.oracle(task, tr.report).pass, `${c.name} d${d} s${seed}`);
      if (c.kind === 'necessity') continue;
      assert.equal(co.pass, false, c.name);
      if (c.kind === 'stage') assert.ok([...Object.values(co.children), ...Object.values(co.stages)].some(r => !r.pass), `${c.name}: some child or stage oracle must see a stage mistake`);
      if (c.stage === 'decode') assert.equal(co.stages.decode.pass, false, `${c.name}: the decode stage oracle sees it`);
    }
  }
});

test('the relation control passes the decode stage, every R4 stage and every child, and fails only D3', () => {
  const c = bed.badControls.find(x => x.name === 'dump-rows-raw-reported');
  for (const d of DS) for (const seed of SEEDS.slice(0, 3)) {
    const task = gen(seed, d);
    const co = bed.composedOracle(task, c.trace(task));
    for (const [id, r] of Object.entries(co.children)) assert.ok(r.pass, `child ${id}`);
    for (const [id, r] of Object.entries(co.stages)) assert.ok(r.pass, `stage ${id}`);
    assert.deepEqual(Object.entries(co.relations).filter(([, r]) => !r.pass).map(([id]) => id), ['D3-rows-carried']);
    assert.equal(bed.oracle(task, c.make(task)).pass, false);
  }
});

test('stage hand-offs of the reference trace satisfy their contracts; the decode stage oracle passes on the truth and rejects an empty hand-off', () => {
  for (const d of DS) {
    const task = gen(311, d);
    const tr = bed.referenceTrace(task);
    assert.deepEqual(bed.CONTRACTS.decode.check(tr.decode), []);
    assert.deepEqual(bed.CONTRACTS.report.check(tr.report), []);
    const st = bed.stages[0].project(task);
    assert.deepEqual(bed.CONTRACTS.input.check(st.input), []);
    assert.ok(bed.stages[0].oracle(st, tr.decode).pass);
    assert.equal(bed.stages[0].oracle(st, {}).pass, false);
    assert.equal(bed.stages[0].oracle(st, { rows: [], trailer: tr.decode.trailer }).pass, false);
    for (const x of bed.relations.filter(r => r.id.startsWith('D'))) assert.ok(x.check(tr, buildDump(311, 'dev', d)).pass, x.id);
  }
});

test('oracle rejects schema-invalid and hostile outputs; rows order free; one row changed, one extra row or a wrong subsidiary fails', () => {
  const task = gen(305, 4);
  const ref = bed.referenceSolve(task);
  const bad = [null, 42, 'x', {}, { ...ref, dump: undefined }, { ...ref, dump: { sub_id: ref.dump.sub_id, rows: 'none' } },
    { ...ref, dump: { ...ref.dump, rows: ref.dump.rows.map((r, i) => (i ? r : { ...r, amount_minor: String(r.amount_minor) })) } }, new Proxy(ref, {})];
  for (const out of bad) assert.equal(bed.oracle(task, out).pass, false);
  const shuffled = structuredClone(ref);
  shuffled.dump.rows.reverse(); shuffled.subsidiaries.reverse();
  assert.ok(bed.oracle(task, shuffled).pass);
  const one = structuredClone(ref); one.dump.rows[0].status_text += ' ';
  assert.equal(bed.oracle(task, one).pass, false);
  const extra = structuredClone(ref); extra.dump.rows.push(extra.dump.rows[0]);
  assert.equal(bed.oracle(task, extra).pass, false);
  const sub = structuredClone(ref); sub.dump.sub_id = 'S9';
  assert.equal(bed.oracle(task, sub).pass, false);
  const v = bed.oracle(task, one);
  assert.equal(v.details.dump.missing, 1); assert.equal(v.details.r4.pass, true);
});

test('composition: every other child and every parent input is R4\'s byte for byte; the dump pack is R1\'s minus its invoice lists', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 4)) {
    const task = gen(seed, d), t4 = R4.generate({ seed, split: 'dev', difficulty: d }), w = buildDump(seed, 'dev', d);
    assert.deepEqual(Object.keys(task.inputs), [...Object.keys(t4.inputs), 'dump_spec']);
    for (const k of Object.keys(t4.inputs)) if (k !== 'subsidiaries') assert.equal(canonical(task.inputs[k]), canonical(t4.inputs[k]), k);
    for (const [id, s] of Object.entries(t4.inputs.subsidiaries)) {
      if (id !== w.sub.id) { assert.equal(canonical(task.inputs.subsidiaries[id]), canonical(s), id); continue; }
      const mine = task.inputs.subsidiaries[id];
      assert.equal(mine.pack, 'receivables-close'); assert.equal(mine.prompt, s.prompt);
      const { invoices, ...rest } = s.inputs; void invoices;
      assert.equal(canonical(mine.inputs), canonical(rest));
      assert.equal(mine.dump, `files/dump/${id}/`);
    }
    assert.ok(Object.keys(task.files).every(p => p.startsWith(`dump/${w.sub.id}/`)));
    assert.ok(task.prompt.startsWith(t4.prompt.split('\n').slice(0, -1).join('\n')));
    assert.ok(R1.oracle(bed.childTask(task, w.sub.id), R1.referenceSolve(bed.childTask(task, w.sub.id))).pass);
    // R1 run on the truth rows is R1's own answer (the pipeline's model of R1 over decoded rows is exact on the truth).
    assert.equal(canonical(r1TraceOnRows(w.sub, w.rows).report), canonical(R1.referenceSolve(w.sub.task)));
  }
});

test('restore: decoded rows rebuild the pack\'s invoice lists (identical text, or line-equivalent where R1 draws a surface form)', () => {
  for (const d of [2, 4]) for (const seed of SEEDS.slice(0, 4)) {
    const task = gen(seed, d), w = buildDump(seed, 'dev', d);
    const orig = bed.childTask(task, w.sub.id).inputs;
    const back = bed.restoreInputs(task, w.rows);
    assert.deepEqual(Object.keys(back), Object.keys(orig));
    for (const k of Object.keys(orig)) if (k !== 'invoices') assert.equal(back[k], orig[k], k);
    assert.deepEqual(Object.keys(back.invoices).sort(), Object.keys(orig.invoices).sort());
    for (const [s, text] of Object.entries(orig.invoices)) {
      if (s !== 'KOBO' && s !== 'VENDEX') { assert.equal(back.invoices[s], text, s); continue; }
      const a = text.split('\n'), b = back.invoices[s].split('\n');
      assert.equal(a.length, b.length);
      const mine = w.rows.filter(r => r.system === s);
      b.forEach((line, i) => { for (const v of [mine[i].invoice, String(mine[i].row), mine[i].date_text, mine[i].status_text]) assert.ok(line.includes(v) && a[i].includes(v), `${s} line ${i}`); });
    }
  }
});

test('decoder.mjs: the shipped text is the bed\'s decoder (data: import) and runs as a command with the README\'s flags', async () => {
  let w = null;
  for (let s = 301; s < 390 && !w; s++) { const f = formatOf({ seed: s, split: 'dev', difficulty: 3 }); if (f.id === 'decoder-tool') w = buildDump(s, 'dev', 3); }
  assert.ok(w, 'a decoder-tool task among dev 301-389 at d3');
  assert.equal(w.files['decoder.mjs'], DECODER_TEXT);
  const mod = await import(`data:text/javascript;base64,${Buffer.from(DECODER_TEXT).toString('base64')}`);
  const flags = { key: w.params.key, layout: w.params.layout };
  assert.equal(mod.decode(w.files['LEDGER.PDX'], flags), toolDecode(w.files['LEDGER.PDX'], flags));
  const dir = mkdtempSync(path.join(tmpdir(), 'wbed-r5-dec-'));
  try {
    writeFileSync(path.join(dir, 'decoder.mjs'), DECODER_TEXT);
    const out = execFileSync(process.execPath, [path.join(dir, 'decoder.mjs'), `--key=${flags.key}`, `--layout=${flags.layout}`], { input: w.files['LEDGER.PDX'], encoding: 'utf8' });
    assert.equal(out, `${toolDecode(w.files['LEDGER.PDX'], flags)}\n`);
    const plainFlags = execFileSync(process.execPath, [path.join(dir, 'decoder.mjs'), `--key=${flags.key}`], { input: w.files['LEDGER.PDX'], encoding: 'utf8' });
    assert.notEqual(plainFlags, out, 'without --layout the decoder runs and prints the wrong fields');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every dump file is text; the task carries no hidden truth and no construction labels', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 10)) {
    const task = gen(seed, d);
    for (const [p, t] of Object.entries(task.files)) assert.ok(typeof t === 'string' && TEXT_ONLY.test(t), `${p} is text`);
    const text = canonical(task.inputs) + task.prompt + Object.values(task.files).join('\n');
    const ref = bed.referenceSolve(task);
    for (const f of ['receivables_minor', 'payables_minor', 'eliminated_minor']) {
      const v = ref.consolidated[f];
      if (Math.abs(v) < 100000) continue;
      assert.ok(!text.includes(String(v)), `d${d} s${seed}: consolidated.${f} ${v} appears in the task`);
    }
    assert.ok(!/outside.?profile|planted|decoy|sibling|phantom|before-image/i.test(text), 'no construction labels in the task');
  }
});

test('measured: dump and task sizes in tokens (utf8 bytes / 4) at d3-d5', () => {
  const rows = {};
  for (const d of [3, 4, 5]) {
    const xs = SEEDS.slice(0, 10).map(s => ({ size: bed.sizeOf(gen(s, d)), inline: estimateTokens(inlineRender(gen(s, d))) }));
    const m = f => Math.round(xs.reduce((a, x) => a + f(x), 0) / xs.length);
    rows[d] = { dumpMean: m(x => x.size.dumpTokens), dumpMin: Math.min(...xs.map(x => x.size.dumpTokens)), dumpMax: Math.max(...xs.map(x => x.size.dumpTokens)),
      rows: m(x => x.size.rows), extras: m(x => x.size.extras), inlineMean: m(x => x.inline), inlineMax: Math.max(...xs.map(x => x.inline)), dumpFormats: [...new Set(xs.map(x => x.size.format))].join('/') };
    assert.ok(rows[d].dumpMin > 1000);
  }
  r5('sizes (seeds 301-310):', JSON.stringify(rows));
  assert.ok(rows[5].inlineMean > rows[3].inlineMean);
});

test('drift knob: extra records, README vagueness, schema switches and header layouts follow LEVELS', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 6)) {
    const w = buildDump(seed, 'dev', d);
    assert.equal(w.records.length - w.rows.length, LEVELS[d].extras);
    assert.equal(w.L.vague, LEVELS[d].vague);
  }
  const mc = FORMAT_BY_ID['monthly-csv'], jv = FORMAT_BY_ID['jsonl-versions'];
  const kid = R1.generate(PACKS[0]);
  for (const d of DS) {
    const L = LEVELS[d];
    const a = dumpLayer({ spec: { ...PACKS[0], difficulty: d }, L, kidTask: kid, kidSpec: PACKS[0], subInfo: { id: 'S1', name: 'Hollin Testbed Ltd', short: 'Hollin Testbed' }, format: jv });
    assert.equal(a.params.cuts.length, L.switches);
    const b = dumpLayer({ spec: { ...PACKS[0], difficulty: d }, L, kidTask: kid, kidSpec: PACKS[0], subInfo: { id: 'S1', name: 'Hollin Testbed Ltd', short: 'Hollin Testbed' }, format: mc });
    assert.equal(b.params.layouts, L.layouts);
  }
});

test('fault overlay: default generation is fault-free and requesting a fault throws in v1', () => {
  const a = gen(301, 3);
  assert.equal(hashOf(bed.generate({ seed: 301, split: 'dev', difficulty: 3, faults: {} })), hashOf(a));
  assert.throws(() => bed.generate({ seed: 301, split: 'dev', difficulty: 3, faults: { f2: { at: 5 } } }), /not implemented/);
});

test('runtime: R5\'s own generation cost on top of R4\'s group draw is under 1 s at difficulty 5; oracle under 2 s', () => {
  // R5 generation = R4's group draw (children and group layer, R4's runtime test) + the dump layer. The group draw is
  // timed on its own so the R5 increment is measured independently of machine load.
  const t0 = performance.now();
  R4.generate({ seed: 389, split: 'test', difficulty: 5 });
  const t1 = performance.now();
  const task = bed.generate({ seed: 389, split: 'test', difficulty: 5 });
  const t2 = performance.now();
  bed.oracle(task, bed.referenceSolve(task));
  const t3 = performance.now();
  r5(`d5 cold: R4 group draw ${Math.round(t1 - t0)} ms, R5 increment (dump layer + task) ${Math.round(t2 - t1)} ms, oracle ${Math.round(t3 - t2)} ms`);
  assert.ok(t2 - t1 < 1000, `R5 increment ${t2 - t1} ms`);
  assert.ok(t3 - t2 < 2000, `oracle ${t3 - t2} ms`);
});

test('triviality driver lists R5 (dry run; stubs score through the oracle, no model)', async () => {
  const p = await plan({ rungs: ['r5'], seeds: [379, 380] });
  assert.equal(p[0].family, 'wbed-r5');
  for (const x of await runStub(p, 'reference')) assert.equal(x.pass, x.n);
  for (const x of await runStub(p, 'necessity:dev-parsers-only')) assert.equal(x.pass, 0);
  for (const x of await runStub(p, 'decoys-kept')) assert.equal(x.pass, 0);
});
