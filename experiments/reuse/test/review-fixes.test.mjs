// Tests for the fixes made after the 2026-11-04 review of C2-1/C2-2 (findings 1, 3, 8, 9, 10) and for C2-3's agent arm.
// No model is called ($0). Tests that read the C2 run records under LIVE_ROOT skip without them. Temporary directories
// are removed.
//   nice -n 15 node --test --test-concurrency=1 experiments/reuse/test/review-fixes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { HERE, LIVE_ROOT, RESEARCH, readJson, readJsonl, sha256 } from '../lib.mjs';
import { contractHashOf, createRegistry } from '../registry.mjs';
import { contractOfB, lookupForReuse } from '../lookup-b.mjs';
import { admitAll, composeConformanceArm, m3Views } from '../posthoc.mjs';
import { assertNoRecordsBeforeFreeze, auditFrozenCode } from '../freeze-guard.mjs';
import { ALLOWED_MANIFEST_CHANGES } from '../../autobench/test/manifest-allowances.mjs';
import { historyBlock, withHistory, runAgentHItem, HISTORY_HEADER } from '../agent-h.mjs';
import { systemPrompt, userPrompt } from '../../sopbench/run.mjs';
import { DG_TOOLS, callTool, makeWorld } from '../world-b.mjs';
import { generate } from '../gen-b.mjs';

const tmp = p => mkdtempSync(path.join(os.tmpdir(), `c2r-${p}-`));
const CATALOG = Object.entries(DG_TOOLS).map(([name, d]) => ({ name, description: `score ${d.comp}`, input_schema: { type: 'object', properties: { product_id: { type: 'string' }, [d.field]: { type: 'string' } } } }));
const COLS = ['product_id', 'sds_label_text', 'handling_and_storage_guidelines', 'transportation_requirements', 'disposal_guidelines'];
const SOP = 'Dangerous goods procedure.\n5.1 Validate the id.\n5.7 Classify.\n';
const HAVE_C21 = existsSync(path.join(LIVE_ROOT, 'c2-1', 'test', 'reuse.jsonl'));
const HAVE_C22 = existsSync(path.join(LIVE_ROOT, 'c2-2', 'stream.jsonl'));

// ---------------------------------------------------------------------------------------------------- finding 3
test("B's own lookup: its contract finds A's unscoped entry; scoped rebuilds and B's own entries are not reuse candidates; any contract change misses", () => {
  const dir = tmp('reg');
  try {
    const reg = createRegistry({ file: path.join(dir, 'registry.jsonl') });
    const { contract, hash } = contractOfB({ procedureText: SOP, catalog: CATALOG, inputColumns: COLS });
    const entry = (id, extra = {}) => ({ id, contractHash: contractHashOf(contract), contract, artifact: { dir: '/x', sha256: id }, origin: { program: 'SOP-Bench phase 2 (build once, frozen p2)', evidence: { pass: 20, of: 20 } }, profiles: { input: {}, trace: {} }, ...extra });
    reg.register(entry('A:dg'));
    reg.register(entry('B:S3-L1', { scope: { source: 'S3' }, origin: { program: 'B (Hazmat Shipment Desk), rebuilt', evidence: {} } }));
    reg.register(entry('B:shared', { origin: { program: 'B (Hazmat Shipment Desk), shared', evidence: {} } }));
    reg.register(entry('C:later'));
    const r = lookupForReuse(reg, { hash, source: 'S3' });
    assert.deepEqual(r.candidates, ['A:dg', 'C:later']);
    assert.equal(r.chosen.id, 'A:dg');                        // first registered, from another program
    assert.deepEqual(r.own, ['B:S3-L1']);
    assert.deepEqual(lookupForReuse(reg, { hash, source: 'S0' }).own, []);
    reg.revoke('A:dg', 'test');
    assert.equal(lookupForReuse(reg, { hash, source: 'S3' }).chosen.id, 'C:later');
    for (const v of [{ procedureText: SOP.replace('Classify.', 'Classify!'), catalog: CATALOG, inputColumns: COLS },
      { procedureText: SOP, catalog: CATALOG.map((t, i) => (i ? t : { ...t, description: t.description + ' ' })), inputColumns: COLS },
      { procedureText: SOP, catalog: CATALOG, inputColumns: [...COLS].reverse() }]) {
      const miss = contractOfB(v).hash;
      assert.notEqual(miss, hash);
      assert.equal(lookupForReuse(reg, { hash: miss, source: 'S3' }).chosen, null);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("lookup check on the real C2 registry: B's lookup chose the entry every run fetched by id", { skip: !existsSync(path.join(RESEARCH, 'runs/c2-1/lookup-check.json')) && 'no lookup-check.json' }, () => {
  const j = readJson(path.join(RESEARCH, 'runs/c2-1/lookup-check.json'));
  assert.equal(j.contractMatches, true);
  assert.equal(j.allChoseFetchedEntry, true);
  assert.equal(Object.keys(j.perSource).length, 28);
  for (const m of Object.values(j.misses)) assert.equal(m.hit, false);
});

// ---------------------------------------------------------------------------------------------------- findings 9, 10
test('post-hoc G0: no history admits nothing; the arm takes the entry on admitted suppliers and the build elsewhere, paying each refused supplier once', () => {
  assert.equal(admitAll({ pass: 0, of: 0 }), false);
  assert.equal(admitAll({ pass: 15, of: 15 }), true);
  assert.equal(admitAll({ pass: 14, of: 15 }), false);
  const reuse = [
    { id: 'a1', source: 'A', shipment: 's1', correct: true, durationMs: 10 },
    { id: 'a2', source: 'A', shipment: 's1', correct: false, durationMs: 10 },   // admitted supplier, entry wrong: a wrong reuse
    { id: 'b1', source: 'B', shipment: 's2', correct: false, durationMs: 10 },
    { id: 'b2', source: 'B', shipment: 's3', correct: true, durationMs: 10 },     // refused supplier, entry right: false deopt
    { id: 'c1', source: 'C', shipment: 's4', correct: true, durationMs: 10 },     // admitted but the per-item check refuses
  ];
  const builtBy = new Map([['b1#1', { correct: true, durationMs: 100 }], ['b2#1', { correct: false, durationMs: 100 }], ['c1#1', { correct: true, durationMs: 100 }], ['b1#2', { correct: false, durationMs: 1 }]]);
  const c = composeConformanceArm({ reuse, admit: s => s !== 'B', accept: r => r.id !== 'c1', builtBy, lineage: 1 });
  assert.deepEqual(c.out.map(o => o.route), ['reuse', 'reuse', 'build', 'build', 'build']);
  assert.deepEqual(c.out.map(o => o.correct), [true, false, true, false, true]);
  assert.equal(c.correct, 3);
  assert.equal(c.reused, 2);
  assert.equal(c.wrongReuse, 1);
  assert.deepEqual([...c.paid].sort(), ['B', 'C']);
  assert.equal(c.ms, 10 + 10 + 100 + 100 + 100);
  // Lineage 2 reads lineage 2's builds; a missing build record is wrong and flagged.
  const c2 = composeConformanceArm({ reuse, admit: s => s !== 'B', builtBy, lineage: 2 });
  assert.equal(c2.out.find(o => o.id === 'b1').correct, false);
  assert.equal(c2.out.find(o => o.id === 'b2').missing, true);
});

// ---------------------------------------------------------------------------------------------------- finding 1
test('M3 by admission unit: 98 clean decisions in 5 suppliers serve by shipment but not by supplier', () => {
  const sizes = { S0: 20, S1: 21, S5: 20, S6: 22, H5: 15 };
  const admitted = Object.entries(sizes).flatMap(([s, n]) => Array.from({ length: n }, (_, i) => ({ parent: `${s}-ship${Math.floor(i / 2)}`, entry: 'A', source: s, wrong: false })));
  const v = m3Views(admitted);
  assert.equal(v.parentExact.decision, 'serve');
  assert.equal(v.supplierExact.decision, 'no-decision');
  assert.equal(v.supplierExact.suppliers, 5);
  assert.ok(v.supplierExact.upper > 0.08 && v.supplierExact.upper < 0.09, String(v.supplierExact.upper));
  assert.ok(v.supplierExactRho1.upper > 0.4, String(v.supplierExactRho1.upper));   // five independent units
  assert.equal(m3Views([]), null);
});

test('C2-2 analysis note reproduces the preregistered shipment-clustered numbers and gives the supplier-clustered ones', { skip: !existsSync(path.join(RESEARCH, 'runs/c2-2/m3-supplier-c22.json')) && 'no m3-supplier-c22.json' }, () => {
  const note = readJson(path.join(RESEARCH, 'runs/c2-2/m3-supplier-c22.json')), sum = readJson(path.join(RESEARCH, 'runs/c2-2/summary-c22.json'));
  for (const g of Object.keys(sum.gates)) for (const k of ['all', 'c21Kinds', 'withoutT1']) {
    const a = note.gates[g][k], b = sum.gates[g][k];
    assert.equal(a.accepted, b.accepted, `${g} ${k}`);
    assert.equal(a.wrong, b.wrongReuse, `${g} ${k}`);
    if (b.m3) assert.equal(a.m3.parentExact.decision, b.m3.parentExact.decision, `${g} ${k}`);
  }
  const p = note.gates['G0-M3+b3c'].withoutT1.m3;
  assert.equal(p.parentExact.decision, 'serve');
  assert.equal(p.supplierExact.decision, 'no-decision');
});

// ---------------------------------------------------------------------------------------------------- finding 8, freezes
test('freeze guard: refuses when any result-feeding file holds a record; append-only audit of frozen code', () => {
  const dir = tmp('guard');
  try {
    const a = path.join(dir, 'history.jsonl'), b = path.join(dir, 'stream.jsonl');
    assert.deepEqual(assertNoRecordsBeforeFreeze([a, b]), { [a]: 0, [b]: 0 });
    writeFileSync(a, '{"id":1}\n');
    assert.throws(() => assertNoRecordsBeforeFreeze([a, b]), /history\.jsonl 1/);
    const f = path.join(dir, 'x.mjs');
    writeFileSync(f, 'line 1\nline 2\n');
    const code = { 'x.mjs': sha256('line 1\nline 2\n') };
    assert.deepEqual(auditFrozenCode(code, dir).unchanged, ['x.mjs']);
    writeFileSync(f, 'line 1\nline 2\nexport const y = 3;\n');
    assert.deepEqual(auditFrozenCode(code, dir).changed.map(c => [c.file, c.appendOnly]), [['x.mjs', true]]);
    writeFileSync(f, 'line 1 changed\nline 2\nexport const y = 3;\n');
    assert.deepEqual(auditFrozenCode(code, dir).changed.map(c => [c.file, c.appendOnly]), [['x.mjs', false]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the C2-1 and C2-2 freezes: every frozen file is unchanged except stats.mjs, whose change (the main-tree merge) is append-only', () => {
  for (const f of ['FREEZE-C2-1.json', 'FREEZE-C2-2.json']) {
    const a = auditFrozenCode(readJson(path.join(RESEARCH, f)).code, HERE);
    assert.deepEqual(a.changed.map(c => [c.file, c.appendOnly]), [['../lib/stats.mjs', true]], f);
  }
  // C2-3 was measured on its frozen bytes (11-04, in the gap-closure worktree). Main's engine work changed one of its files
  // afterwards by a recorded change: src/executors/claude-code.mjs, e6a23ca's bytes -> the recorded "after"
  // (experiments/autobench/test/manifest-allowances.mjs; research/automationbench-20261014/MANIFEST-ALLOWANCES.md). Any other
  // change, or any further change to that file, fails here. A C2-3 re-run from this tree would use the newer executor.
  const frozen3 = readJson(path.join(RESEARCH, 'FREEZE-C2-3.json')).code;
  const a3 = auditFrozenCode(frozen3, HERE);
  const repo = path.resolve(HERE, '../..');
  const unrecorded = a3.changed.filter(c => {
    const a = ALLOWED_MANIFEST_CHANGES[path.relative(repo, path.resolve(HERE, c.file))];
    return !(a && a.before === frozen3[c.file] && a.after === createHash('sha256').update(readFileSync(path.resolve(HERE, c.file))).digest('hex'));
  });
  assert.deepEqual(unrecorded, [], 'C2-3 frozen code changed without a recorded engine change');
  assert.deepEqual(a3.changed.map(c => c.file), ['../../src/executors/claude-code.mjs'], 'the recorded engine change is the only one');
});

/** Run fn while fs.readFileSync returns edits[suffix](text) for files whose path ends with a key of `edits` (ESM bindings
 * of node:fs synced, so modules that imported readFileSync see it too). */
function withEdits(edits, fn) {
  const orig = fs.readFileSync;
  fs.readFileSync = function (p, ...rest) {
    const out = orig.call(this, p, ...rest), k = Object.keys(edits).find(e => String(p).endsWith(e));
    return k && typeof out === 'string' ? edits[k](out) : out;
  };
  syncBuiltinESMExports();
  try { return fn(); } finally { fs.readFileSync = orig; syncBuiltinESMExports(); }
}
/** stats.mjs as it was frozen: the main-tree merge only appended to it (see the audit test), so cut it at the prefix. */
const STATS_PREFIX = auditFrozenCode(readJson(path.join(RESEARCH, 'FREEZE-C2-1.json')).code, HERE).changed.find(c => c.file === '../lib/stats.mjs')?.prefixBytes ?? null;
const frozenStats = { '/experiments/lib/stats.mjs': t => (STATS_PREFIX ? Buffer.from(t).subarray(0, STATS_PREFIX).toString('utf8') : t) };
const edited = t => `${t}\n// edited`;

test('C2-1 checkFreeze: passes on the frozen code, refuses after a frozen file or the manifest changes', async () => {
  const { checkFreeze, codeHashes } = await import('../c2.mjs');
  const f = readJson(path.join(RESEARCH, 'FREEZE-C2-1.json'));
  const ctx = { set: 'test', manifest: { sha256: f.manifestSha256 } };
  assert.deepEqual(checkFreeze(ctx, { strict: false }).changed, STATS_PREFIX ? ['../lib/stats.mjs'] : []);
  assert.deepEqual(withEdits(frozenStats, () => checkFreeze(ctx)), { ok: true, changed: [] });           // positive control
  assert.throws(() => withEdits({ ...frozenStats, '/experiments/reuse/gate.mjs': edited }, () => checkFreeze(ctx)), /changed since the freeze: gate\.mjs$/);
  assert.throws(() => withEdits(frozenStats, () => checkFreeze({ set: 'test', manifest: { sha256: 'other' } })), /changed since the freeze: manifest$/);
  assert.equal(codeHashes()['gate.mjs'], f.code['gate.mjs']);                                                  // the edit is gone
});

test('C2-2 `run` refuses after a frozen file changes (child process; conformance.mjs edited in memory, stats.mjs at its frozen prefix)', async () => {
  const { codeHashes } = await import('../c22.mjs');
  const f = readJson(path.join(RESEARCH, 'FREEZE-C2-2.json'));
  assert.deepEqual(withEdits(frozenStats, () => codeHashes()), f.code);                                       // positive control
  const dir = tmp('c22');
  try {
    const pre = path.join(dir, 'edit.mjs');
    writeFileSync(pre, `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
const orig = fs.readFileSync, cut = ${JSON.stringify(STATS_PREFIX)};
fs.readFileSync = function (p, ...r) { const o = orig.call(this, p, ...r); if (typeof o !== 'string') return o;
  if (String(p).endsWith('/experiments/reuse/conformance.mjs')) return o + '\\n// edited';
  if (cut && String(p).endsWith('/experiments/lib/stats.mjs')) return Buffer.from(o).subarray(0, cut).toString('utf8');
  return o; };
syncBuiltinESMExports();\n`);
    const r = spawnSync(process.execPath, ['--import', pre, path.join(HERE, 'c22.mjs'), 'run'], { encoding: 'utf8', timeout: 60_000 });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /C2-2 changed since the freeze: conformance\.mjs\n/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------- finding 10: C2-2 worlds
test('C2-2 run used the history world for history and the stream world for the stream (code, and T2 records)', () => {
  const src = readFileSync(path.join(HERE, 'c22.mjs'), 'utf8');
  const h0 = src.indexOf('await pool(histJobs'), s0 = src.indexOf('const { items } = itemsOf(m);', h0), s1 = src.indexOf("console.log(`c2-2 run:", s0);
  assert.ok(h0 > 0 && s0 > h0 && s1 > s0, 'cmdRun markers');
  const hist = src.slice(h0, s0), strm = src.slice(s0, s1);
  assert.match(hist, /world: worlds\[s\]\.history/);
  assert.doesNotMatch(hist, /\.stream/);
  assert.match(strm, /world: worlds\[it\.source\]\.stream/);
  assert.doesNotMatch(strm, /\.history/);
  if (!HAVE_C22) return;
  const scores = r => Object.values(r.doc.inputs.tools ?? {}).flat().flatMap(x => Object.entries(x).filter(([k]) => k.endsWith('_score')).map(([, v]) => v));
  const h = readJsonl(path.join(LIVE_ROOT, 'c2-2', 'history.jsonl')).filter(r => r.source === 'T2').flatMap(scores);
  const s = readJsonl(path.join(LIVE_ROOT, 'c2-2', 'stream.jsonl')).filter(r => r.source === 'T2').flatMap(scores);
  assert.ok(h.length > 100 && h.every(v => typeof v === 'number'), 'T2 history answered numbers');
  assert.ok(s.length > 20 && s.every(v => typeof v === 'string'), 'T2 stream answered strings');
});

// ---------------------------------------------------------------------------------------------------- C2-3 agent arm
const BANK = Array.from({ length: 20 }, (_, i) => ({ row: i + 1, total: 4 + (i % 17), inputs: Object.fromEntries(COLS.slice(1).map(f => [f, `${f} text ${i + 1}`])) }));
test('C2-3 history block: the supplier\'s history in builder order, the tool answers of its world, the recorded class; appended to the SOP-Bench system prompt only', async () => {
  const m = generate({ seed: 'unit-h', bank: BANK.map(b => ({ row: b.row, total: b.total })), sources: ['S4'] });
  const ids = [...m.sources.S4.build, ...m.sources.S4.repair];
  const byId = new Map(m.products.map(p => [p.id, p]));
  const w = makeWorld({ name: 'S4', products: m.products.filter(p => p.inMaster).map(p => ({ id: p.id, raw: p.raw })), toolOrder: Object.keys(DG_TOOLS) });
  const bankTexts = new Map(BANK.map(b => [b.row, b.inputs]));
  const block = historyBlock({ products: ids.map(id => byId.get(id)), world: w, bankTexts });
  assert.equal(block, historyBlock({ products: ids.map(id => byId.get(id)), world: w, bankTexts }));
  assert.equal((block.match(/### Record /g) ?? []).length, ids.length);
  assert.ok(block.includes(HISTORY_HEADER));
  const p0 = byId.get(ids[0]);
  assert.ok(block.indexOf(`product_id: ${p0.id}`) < block.indexOf(`product_id: ${byId.get(ids[1]).id}`));
  const t0 = callTool(w, 'calculate_sds_label_score', { product_id: p0.id, sds_label_text: 'x' }).content;
  if (!t0.startsWith('Error')) assert.ok(block.includes(`calculate_sds_label_score: ${t0}`));
  assert.ok(block.includes(`Recorded hazard_class: ${p0.truth.hazard_class}`));
  assert.throws(() => historyBlock({ products: [], world: w, bankTexts }), /no history/);
  const sys = systemPrompt(CATALOG, 10);
  assert.equal(withHistory(sys, block), `${sys}\n\n${block}`);
  assert.throws(() => withHistory('You are a helpful assistant.', block), /SOP-Bench system prompt/);
  assert.throws(() => withHistory(sys, 'no block'), /history block/);
  // runAgentHItem: the runner sees the block in the system prompt, the unchanged user prompt, and the $0.05 budget.
  const live = tmp('agenth');
  try {
    let seen = null;
    const task = { task_text: 'product_id: P_12345', output_columns: ['hazard_class'] };
    const r = await runAgentHItem({ task, truth: { hazard_class: 'Hazard Class A' }, world: w, catalog: CATALOG, sopText: SOP, live, tag: 't1', block,
      runner: async args => { seen = args; return { result: '<final_output>{"hazard_class": "Hazard Class A"}</final_output>', costUsd: 0.001, turns: 1, toolUses: [] }; } });
    assert.equal(seen.systemPrompt, `${sys}\n\n${block}`);
    assert.equal(seen.prompt, userPrompt(SOP, task.task_text, task.output_columns));
    assert.equal(seen.budgetUsd, 0.05);
    assert.equal(r.strict, true);
    assert.equal(r.cls, 'Hazard Class A');
  } finally { rmSync(live, { recursive: true, force: true }); }
});

test('C2-3 composition reproduces C2-1\'s published arms before any C2-3 record is used', { skip: !HAVE_C21 && 'no C2-1 records' }, async () => {
  const { armsOf } = await import('../c23.mjs');
  const { ctxOf } = await import('../c2.mjs');
  const { arms } = armsOf(ctxOf('c2-1', 'test'));
  const n = name => arms[name].out.filter(o => o.correct).length;
  assert.deepEqual([n('SCRATCH@L1'), n('SCRATCH@L2'), n('REUSE-b3@L1'), n('REUSE-b3@L2'), n('REUSE-G0@L1'), n('REUSE-G0@L2'), n('AGENT@k1'), n('AGENT@k2')], [230, 231, 200, 201, 230, 231, 134, 133]);
  for (const a of Object.values(arms)) assert.equal(a.out.length, 235);
});
