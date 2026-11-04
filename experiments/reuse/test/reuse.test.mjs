// Tests for the C2 reuse experiment (experiments/reuse). No model is called anywhere ($0).
//   nice -n 15 node --test --test-concurrency=1 experiments/reuse/test/reuse.test.mjs
// The host test runs the frozen SOP-Bench dangerous_goods workflow in the execution sandbox and skips without it; the oracle
// control reads the proof bank of a prove.mjs run (LIVE_ROOT/c2-dev) and skips without it. Temporary directories are removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canon, pyDumps, readJson, LIVE_ROOT, FROZEN_P2 } from '../lib.mjs';
import { DG_TOOLS, callTool, makeWorld, serveMailbox } from '../world-b.mjs';
import { SOURCES, UNABLE, decideShipment, normaliseClass, rawOf, sopScoreOf, sourcesOfSet, truthOf, validIdFor } from '../program-b.mjs';
import { contractHashOf, contractOf, createRegistry } from '../registry.mjs';
import { gateAll, gateInput, gateTraceDoc, learnInputProfile, learnTraceProfile, traceDoc } from '../gate.mjs';
import { generate, subtaskOf, textsOf, worldsOf } from '../gen-b.mjs';
import { composeArm, GATES, pairedShipmentBootstrap } from '../analyze.mjs';
import { agentClassOf } from '../agent-b.mjs';
import { strictOf } from '../build-b.mjs';

const tmp = p => mkdtempSync(path.join(os.tmpdir(), `c2-${p}-`));
const ORDER = ['calculate_disposal_score', 'calculate_handling_score', 'calculate_transportation_score', 'calculate_sds_label_score'];
const world = (products, response = null, allowed = null) => makeWorld({ name: 't', products, response, allowed, toolOrder: ORDER });

// ---------------------------------------------------------------------------------------------------- python fidelity
test('pyDumps prints what python json.dumps prints (checked against the SOP-Bench venv, Python 3.13)', () => {
  assert.equal(pyDumps({ product_id: 'P_13248', sds_label_score: 5, note: 'é' }), '{"product_id": "P_13248", "sds_label_score": 5, "note": "\\u00e9"}');
  assert.equal(pyDumps([1, 'a', null, true]), '[1, "a", null, true]');
});

test('world: tool answers follow the upstream tools.py and ToolManager wording', () => {
  const w = world([{ id: 'P_10001', raw: { safety: 4, handling: null, transportation: 0, disposal: 2 } }]);
  assert.equal(callTool(w, 'calculate_sds_label_score', '{"product_id":"P_10001","sds_label_text":"x"}').content, '{"product_id": "P_10001", "sds_label_score": 4}');
  assert.equal(callTool(w, 'calculate_transportation_score', '{"product_id":"P_10001","transportation_requirements":"x"}').content, '{"product_id": "P_10001", "transportation_score": 0}');
  assert.equal(callTool(w, 'calculate_handling_score', '{"product_id":"P_10001","handling_and_storage_guidelines":"x"}').content, 'Error: cannot convert float NaN to integer');
  assert.equal(callTool(w, 'calculate_disposal_score', '{"product_id":"P_99999","disposal_guidelines":"x"}').content, 'Error: No product found with ID: P_99999');
  assert.equal(callTool(w, 'calculate_disposal_score', '{"product_id":"P_10001","disposal_guidelines":""}').content, 'Error: Missing required parameters: product_id or disposal_guidelines');
  assert.equal(callTool(w, 'calculate_handling_score', '{"product_id":"P_10001","handling_and_storage_guidelines":"x","assessmentFormId":"CAF-01-0001"}').content,
    "Error: DangerousGoodsManager.calculate_handling_score() got an unexpected keyword argument 'assessmentFormId'");
  assert.equal(callTool(w, 'calculate_handling_score', '{}').content,
    "Error: DangerousGoodsManager.calculate_handling_score() missing 2 required positional arguments: 'product_id' and 'handling_and_storage_guidelines'");
  assert.match(callTool(w, 'nope', '{}').content, /^Error: Tool 'nope' not found\. Available tools: calculate_disposal_score, /);
  assert.equal(callTool(w, 'calculate_sds_label_score', '[1]').content, 'Error: arguments must be a JSON object');
});

test('world: supplier response options (extra fields, string scores, renamed key) and an allow-list', () => {
  const p = [{ id: 'P_10001', raw: { safety: 3, handling: 3, transportation: 3, disposal: 3 } }];
  const a = '{"product_id":"P_10001","sds_label_text":"x"}';
  assert.equal(callTool(world(p, { extra: { scale: '1-5' } }), 'calculate_sds_label_score', a).content, '{"product_id": "P_10001", "sds_label_score": 3, "scale": "1-5"}');
  assert.equal(callTool(world(p, { valueAs: 'string' }), 'calculate_sds_label_score', a).content, '{"product_id": "P_10001", "sds_label_score": "3"}');
  assert.equal(callTool(world(p, { scoreKey: 'score' }), 'calculate_sds_label_score', a).content, '{"product_id": "P_10001", "score": 3}');
  assert.equal(callTool(world(p, null, ['P_10002']), 'calculate_sds_label_score', a).content, 'Error: No product found with ID: P_10001');
});

test('mailbox: the bridge protocol, one step per request, refusal past the step limit', async () => {
  const dir = tmp('box');
  try {
    const box = serveMailbox({ box: dir, world: world([{ id: 'P_10001', raw: { safety: 1, handling: 1, transportation: 1, disposal: 1 } }]), maxSteps: 1 });
    const ask = async (n, calls) => {
      writeFileSync(path.join(dir, `req-${n}.json`), JSON.stringify({ v: 1, calls }));
      for (let i = 0; i < 200 && !existsSync(path.join(dir, `res-${n}.json`)); i++) await new Promise(r => setTimeout(r, 10));
      return JSON.parse(readFileSync(path.join(dir, `res-${n}.json`), 'utf8'));
    };
    const r1 = await ask(1, [{ name: 'calculate_sds_label_score', arguments: '{"product_id":"P_10001","sds_label_text":"x"}', section: '5.2' }, { name: 'calculate_disposal_score', arguments: '{"product_id":"P_10001","disposal_guidelines":"y"}' }]);
    assert.equal(r1.results.length, 2);
    assert.equal(r1.results[0].content, '{"product_id": "P_10001", "sds_label_score": 1}');
    const r2 = await ask(2, [{ name: 'calculate_sds_label_score', arguments: '{}' }]);
    assert.match(r2.error, /step limit reached: this task allows 1 tool steps/);
    const done = await box.stop();
    assert.equal(done.steps, 1);
    assert.equal(done.calls.filter(c => c.name).length, 2);
    assert.equal(done.calls[0].section, '5.2');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------- program B
const prod = (source, id, raw, extra = {}) => ({ source, id, raw, inMaster: true, texts: { sds_label_text: 'a', handling_and_storage_guidelines: 'b', transportation_requirements: 'c', disposal_guidelines: 'd' }, ...extra });
test("B's oracle implements sop.txt §5.1-5.7 with B's bands and each supplier's conventions", () => {
  const all = v => ({ safety: v, handling: v, transportation: v, disposal: v });
  assert.equal(truthOf(prod('S0', 'P_10001', all(2))).hazard_class, 'Hazard Class A');          // 8
  assert.equal(truthOf(prod('S0', 'P_10001', { safety: 3, handling: 2, transportation: 2, disposal: 2 })).hazard_class, 'Hazard Class B'); // 9
  assert.equal(truthOf(prod('S0', 'P_10001', all(3))).hazard_class, 'Hazard Class B');          // 12
  assert.equal(truthOf(prod('S0', 'P_10001', { safety: 4, handling: 3, transportation: 3, disposal: 3 })).hazard_class, 'Hazard Class C'); // 13
  assert.equal(truthOf(prod('S0', 'P_10001', all(4))).hazard_class, 'Hazard Class C');          // 16
  assert.equal(truthOf(prod('S0', 'P_10001', { safety: 5, handling: 4, transportation: 4, disposal: 4 })).hazard_class, 'Hazard Class D'); // 17
  // missing or 0 -> max of the others; more than two missing -> Unable
  assert.deepEqual(truthOf(prod('S0', 'P_10001', { safety: 4, handling: 4, transportation: 4, disposal: 0 })), { hazard_class: 'Hazard Class C', hazard_score: 16, reason: 'imputed' });
  assert.equal(truthOf(prod('S0', 'P_10001', { safety: 5, handling: null, transportation: null, disposal: 1 })).hazard_class, 'Hazard Class C'); // 5+5+5+1 = 16
  assert.equal(truthOf(prod('S0', 'P_10001', { safety: 5, handling: null, transportation: null, disposal: 2 })).hazard_class, 'Hazard Class D'); // 5+5+5+2 = 17
  assert.equal(truthOf(prod('S0', 'P_10001', { safety: 5, handling: null, transportation: null, disposal: 0 })).hazard_class, UNABLE);
  assert.equal(truthOf(prod('S0', 'P_10001', all(3), { texts: { sds_label_text: '', handling_and_storage_guidelines: '', transportation_requirements: '', disposal_guidelines: 'd' } })).hazard_class, UNABLE);
  // ids: the supplier's format; an id the master cannot resolve
  assert.equal(truthOf(prod('S0', 'P-10001', all(3))).hazard_class, UNABLE);
  assert.equal(truthOf(prod('S2', 'P-10001', all(3))).hazard_class, 'Hazard Class B');
  assert.equal(truthOf(prod('H3', 'p_10001', all(3))).hazard_class, 'Hazard Class B');
  assert.equal(truthOf(prod('S0', 'P_10001', all(3), { inMaster: false })).hazard_class, UNABLE);
  // stored scales
  for (const s of ['S3', 'S4', 'H4']) for (let v = 1; v <= 5; v++) assert.equal(sopScoreOf(s, rawOf(s, v, 0.3)), v, `${s} ${v}`);
  assert.equal(rawOf('S3', 5, 0.7), 10); assert.equal(rawOf('S4', 5), 1); assert.equal(rawOf('H4', 1), 0); assert.equal(rawOf('H4', 0), null);
  assert.equal(truthOf(prod('S3', 'P_10001', all(8))).hazard_class, 'Hazard Class C');          // 4 x 4
  assert.equal(truthOf(prod('S4', 'P_10001', all(1))).hazard_class, 'Hazard Class D');          // 4 x 5
  assert.equal(truthOf(prod('H4', 'P_10001', all(0))).hazard_class, 'Hazard Class A');          // 4 x 1
  assert.ok(validIdFor('S0', 'P_12345') && !validIdFor('S0', 'P_1234') && !validIdFor('S0', 'p_12345') && validIdFor('S2', 'P-12345'));
  assert.deepEqual(sourcesOfSet('dev'), ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  assert.equal(sourcesOfSet('test').length, 12);
});

test("HSD composition: hold on any unclassified item, the most severe class decides the mode, D on road needs an escort", () => {
  assert.deepEqual(decideShipment(['Hazard Class A', 'Hazard Class B'], 'air'), { decision: 'book', mode: 'air', escort: false, shipment_class: 'Hazard Class B' });
  assert.deepEqual(decideShipment(['Hazard Class C'], 'air'), { decision: 'reroute', mode: 'sea', escort: false, shipment_class: 'Hazard Class C' });
  assert.deepEqual(decideShipment(['Hazard Class A', 'Hazard Class D'], 'sea'), { decision: 'reroute', mode: 'road', escort: true, shipment_class: 'Hazard Class D' });
  assert.equal(decideShipment(['Hazard Class A', UNABLE], 'road').decision, 'hold');
  assert.equal(decideShipment(['Hazard Class A', 'none'], 'road').decision, 'hold');
  assert.equal(normaliseClass('hazard_class_b'), 'Hazard Class B');
  assert.equal(normaliseClass('Class B'), null);
});

test('generator: deterministic, unique ids, truth recorded, no SOP-Bench text in the manifest', () => {
  const bank = [{ row: 1, total: 15 }, { row: 2, total: 9 }, { row: 3, total: 5 }, { row: 4, total: 20 }];
  const a = generate({ seed: 't', bank, sources: sourcesOfSet('test') }), b = generate({ seed: 't', bank, sources: sourcesOfSet('test') });
  assert.equal(a.sha256, b.sha256);
  assert.notEqual(generate({ seed: 'u', bank, sources: sourcesOfSet('test') }).sha256, a.sha256);
  const ids = a.products.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of a.products) {
    assert.ok(p.truth?.hazard_class, p.id);
    assert.ok(['proof', 'ghs', 'de'].includes(p.textRef.style));
    if (p.textRef.style === 'proof') assert.equal(Object.keys(p.textRef).sort().join(), 'row,style');
  }
  for (const s of Object.keys(a.sources)) { assert.equal(a.sources[s].build.length, 5); assert.equal(a.sources[s].repair.length, 10); assert.equal(a.sources[s].shipments.length, 10); }
  assert.equal(a.order.length, a.shipments.length);
  // texts: proof rows from the bank's inputs, authored banks for GHS / German, blanked fields stay blank
  const bankTexts = new Map(bank.map(x => [x.row, { sds_label_text: `s${x.row}`, handling_and_storage_guidelines: `h${x.row}`, transportation_requirements: `t${x.row}`, disposal_guidelines: `d${x.row}` }]));
  const ghs = a.products.find(p => p.textRef.style === 'ghs'), de = a.products.find(p => p.textRef.style === 'de'), blank = a.products.find(p => p.blank);
  assert.match(textsOf(ghs, bankTexts).sds_label_text, /GHS|Warning|Danger/);
  assert.ok(textsOf(de, bankTexts).disposal_guidelines.length > 3);
  assert.equal(textsOf(blank, bankTexts)[blank.blank], '');
  const st = subtaskOf(a.products[0], bankTexts);
  assert.deepEqual(Object.keys(st.inputs), ['product_id', 'sds_label_text', 'handling_and_storage_guidelines', 'transportation_requirements', 'disposal_guidelines']);
  const worlds = worldsOf(a, { toolOrder: ORDER, makeWorld });
  assert.ok(worlds.S5.response.extra && worlds.H1.response.valueAs === 'string' && worlds.H2.response.scoreKey === 'score');
  assert.equal([...worlds.S6.byId.values()].length, a.products.filter(p => p.source === 'S6' && p.inMaster).length);
});

// ---------------------------------------------------------------------------------------------------- registry and gate
test('registry: contract hash, append-only register/revoke, lookup by contract and scope', () => {
  const dir = tmp('reg');
  try {
    const c = contractOf({ procedureText: 'sop', catalog: [{ name: 'b', description: 'x', input_schema: {} }, { name: 'a', description: 'y', input_schema: { type: 'object' } }], inputColumns: ['x'], outputColumns: ['y'] });
    const c2 = contractOf({ procedureText: 'sop', catalog: [{ name: 'a', description: 'y', input_schema: { type: 'object' } }, { name: 'b', description: 'x', input_schema: {} }], inputColumns: ['x'], outputColumns: ['y'] });
    assert.equal(contractHashOf(c), contractHashOf(c2));      // tool order does not matter
    const other = contractOf({ procedureText: 'sop v2', catalog: [{ name: 'a', description: 'y', input_schema: {} }], inputColumns: ['x'], outputColumns: ['y'] });
    assert.notEqual(contractHashOf(other), contractHashOf(c));
    const reg = createRegistry({ file: path.join(dir, 'r.jsonl') });
    const e = { id: 'e1', contractHash: contractHashOf(c), contract: c, artifact: { dir: '/x', sha256: 'aa' }, origin: { program: 'A' }, profiles: { input: null, trace: null } };
    reg.register(e);
    assert.throws(() => reg.register(e), /already registered/);
    assert.throws(() => reg.register({ ...e, id: 'e2', contractHash: 'ff' }), /does not match/);
    reg.register({ ...e, id: 'e3', scope: { source: 'S2' } });
    assert.deepEqual(reg.lookup(contractHashOf(c)).map(x => x.id), ['e1']);
    assert.deepEqual(reg.lookup(contractHashOf(c), { source: 'S2' }).map(x => x.id), ['e1', 'e3']);
    assert.deepEqual(reg.lookup(contractHashOf(other)), []);
    reg.revoke('e1', 'test');
    assert.deepEqual(reg.lookup(contractHashOf(c), { source: 'S2' }).map(x => x.id), ['e3']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const runOf = (scores, { answer = 'Hazard Class C', extra = {}, asString = false, error = null, path: p = ['5.1 V', '5.2 S', '5.7 C'] } = {}) => ({
  status: 'done', answer: { hazard_class: answer },
  calls: Object.entries(DG_TOOLS).map(([name, t], i) => ({ name, content: error && i === 0 ? `Error: ${error}` : pyDumps({ product_id: 'P_10001', [t.key]: asString ? String(scores[i]) : scores[i], ...extra }) })),
  events: p.map(n => ({ kind: 'phase-start', name: n })),
});
test('gate: G2 refuses an id format the proof never saw; G3 refuses new types, errors and answers, tolerates added fields', () => {
  // Free text (12 distinct values) is checked by type only; a short field whose few values recur would be an enum.
  const texts = ['Severe irritant', 'Low health risk', 'Strong oxidant', 'Compressed neon', 'Eye irritant', 'High explosive', 'Contact toxicity', 'Infectious agent', 'Minimal impact', 'Cryogenic substance', 'Pyrophoric solid', 'Water reactive gas'];
  const tasks = Array.from({ length: 12 }, (_, i) => ({ inputs: { product_id: `P_1${String(3000 + i * 7).padStart(4, '0')}`, sds_label_text: texts[i] } }));
  const pin = learnInputProfile(tasks);
  assert.equal(gateInput(pin, { inputs: { product_id: 'P_14444', sds_label_text: 'Pyrophoric gas' } }).accept, true);
  const bad = gateInput(pin, { inputs: { product_id: 'P-14444', sds_label_text: 'Pyrophoric gas' } });
  assert.equal(bad.accept, false);
  assert.equal(bad.reasons[0].path, 'inputs.product_id');
  const runs = Array.from({ length: 12 }, (_, i) => runOf([1 + (i % 5), 2 + (i % 4), 1 + (i % 3), 5 - (i % 5)], { answer: ['Hazard Class A', 'Hazard Class B', 'Hazard Class C', 'Hazard Class D'][i % 4] }));
  const ptr = learnTraceProfile(runs);
  const ok = runOf([3, 3, 3, 3]);
  assert.equal(gateTraceDoc(ptr, traceDoc(ok)).accept, true);
  assert.equal(gateTraceDoc(ptr, traceDoc(runOf([3, 3, 3, 3], { asString: true }))).accept, false);
  assert.equal(gateTraceDoc(ptr, traceDoc(runOf([3, 3, 3, 3], { error: 'No product found with ID: P_1' }))).accept, false);
  assert.equal(gateTraceDoc(ptr, traceDoc(runOf([3, 3, 3, 3], { answer: UNABLE }))).accept, false);
  assert.equal(gateTraceDoc(ptr, traceDoc(runOf([9, 9, 9, 9]))).accept, false);
  const added = runOf([3, 3, 3, 3], { extra: { model_version: 'v2' } });
  const v = gateAll({ input: pin, trace: ptr }, tasks[0], traceDoc(added));
  assert.equal(v.g3.accept, true);          // primary: an added response field is a compatible change
  assert.equal(v.g3strict.accept, false);   // strict variant: every new path is novel
});

// ---------------------------------------------------------------------------------------------------- analysis
test('arms: reuse routes by the gate, deopts to the supplier build, charges each build once; sticky and scratch', () => {
  const items = ['a', 'b', 'c'].map((id, i) => ({ product: { id, truth: { hazard_class: 'Hazard Class A' } }, source: i < 2 ? 'S0' : 'S3', shipment: `sh${i}` }));
  const v = acc => ({ g2: { accept: true }, g3: { accept: acc }, g3strict: { accept: acc } });
  const reuseBy = new Map([['a', { correct: true, answer: 'Hazard Class A', variants: v(false), durationMs: 5 }], ['b', { correct: true, answer: 'Hazard Class A', variants: v(true), durationMs: 5 }],
    ['c', { correct: false, answer: 'Hazard Class B', variants: v(true), durationMs: 5 }]]);
  const builtBy = new Map(['a', 'b', 'c'].map(id => [`${id}#1`, { correct: true, answer: 'Hazard Class A', durationMs: 7 }]));
  const buildOf = (s, L) => ({ costUsd: 0.05, wallMs: 60000, source: s, lineage: L });
  const data = { items, reuseBy, builtBy, buildOf, agentBy: new Map() };
  const r = composeArm({ kind: 'reuse', gate: 'b3', lineage: 1 }, data);
  assert.deepEqual(r.out.map(o => o.route), ['build', 'reuse', 'reuse']);
  assert.deepEqual([...r.buildsCharged.keys()], ['S0']);
  assert.equal(r.out[0].ms, 7 + 5);   // the proven entry ran before G3 refused
  const s = composeArm({ kind: 'reuse', gate: 'b3', lineage: 1, sticky: true }, data);
  assert.deepEqual(s.out.map(o => o.route), ['build', 'build', 'reuse']);
  const o = composeArm({ kind: 'reuse', gate: 'oracle', lineage: 1 }, data);
  assert.deepEqual(o.out.map(x => x.correct), [true, true, true]);
  const sc = composeArm({ kind: 'scratch', lineage: 1 }, data);
  assert.equal(sc.buildsCharged.size, 2);
  assert.equal(GATES.b0(), true);
  const boot = pairedShipmentBootstrap(r.out, o.out, { iterations: 200 });
  assert.ok(boot.point < 0 && boot.lo <= boot.point && boot.hi >= boot.point);
});

test("agent answer parsing and the strict grade use SOP-Bench's parser and scorer", () => {
  assert.equal(agentClassOf('done\n<final_output>{"hazard_class": "Hazard Class C"}</final_output>'), 'Hazard Class C');
  assert.equal(agentClassOf('<final_output>{"hazard_class": "hazard class d"}</final_output>'), 'Hazard Class D');
  assert.equal(agentClassOf('no answer'), null);
  assert.equal(strictOf({ hazard_class: 'Hazard Class B' }, { hazard_class: 'Hazard Class B' }), true);
  assert.equal(strictOf({ hazard_class: 'Hazard Class C' }, { hazard_class: 'Hazard Class B' }), false);
});

// ---------------------------------------------------------------------------------------------------- live controls
const PROOF = path.join(LIVE_ROOT, 'c2-dev', 'proof');
const HAVE_PROOF = existsSync(path.join(PROOF, 'dangerous_goods.bank.json'));
test("oracle control: B's oracle reproduces SOP-Bench's labels on the 20 proven dev rows; a constant answer does not", { skip: !HAVE_PROOF && 'no proof bank (run prove.mjs --run-id c2-dev)' }, () => {
  const bank = readJson(path.join(PROOF, 'dangerous_goods.bank.json'));
  const prep = readJson(path.join(PROOF, 'dangerous_goods.prep.json'));
  let agree = 0, constant = 0;
  for (const b of bank) {
    const exp = readJson(path.join(prep.prepDir, 'rows', String(b.row), 'expected.json')).expected.hazard_class.str;
    const t = truthOf({ source: 'S0', id: b.inputs.product_id, raw: b.scores, inMaster: true, texts: b.inputs });
    if (t.hazard_class === exp) agree++;
    if (exp === 'Hazard Class D') constant++;
  }
  assert.equal(agree, bank.length);
  assert.ok(constant < bank.length);
});

test('host: the frozen dangerous_goods workflow runs byte-identical in B\'s world (in-profile right, hyphen id Unable)', { skip: !existsSync(path.join(FROZEN_P2, 'dangerous_goods/solve.mjs')) && 'no frozen workflow' }, async t => {
  const { sandboxAvailable } = await import('../../../src/executors/claude-code.mjs');
  if (!sandboxAvailable()) return t.skip('no execution sandbox');
  const { runArtifact } = await import('../host.mjs');
  const { artifactFiles } = await import('../../sopbench/exec.mjs');
  const catalogFile = path.join(LIVE_ROOT, 'c2-dev', 'proof', 'dangerous_goods.prep.json');
  if (!existsSync(catalogFile)) return t.skip('no prepared catalog');
  const catalog = readJson(readJson(catalogFile).catalogFile);
  const live = tmp('host');
  try {
    const files = artifactFiles(path.join(FROZEN_P2, 'dangerous_goods'));
    const w = makeWorld({ name: 't', products: [{ id: 'P_20001', raw: { safety: 4, handling: 4, transportation: 4, disposal: 0 } }, { id: 'P-20002', raw: { safety: 2, handling: 2, transportation: 2, disposal: 2 } }], toolOrder: catalog.map(x => x.name) });
    const texts = { sds_label_text: 'Strong oxidant', handling_and_storage_guidelines: 'Oxidizer storage', transportation_requirements: 'Segregated transport', disposal_guidelines: 'Chemical disposal' };
    const task = id => ({ sop: 'dangerous_goods', row: 1, inputs: { product_id: id, ...texts }, task_text: '', output_columns: ['hazard_class'] });
    const a = await runArtifact({ files, sdkDir: path.join(FROZEN_P2, 'sdk'), catalog, outputColumns: ['hazard_class'], task: task('P_20001'), world: w, live, tag: 'a' });
    assert.equal(a.status, 'done');
    assert.equal(a.answer.hazard_class, 'Hazard Class C');   // 4+4+4+imputed 4 = 16
    assert.equal(a.calls.filter(c => c.name).length, 4);
    const b = await runArtifact({ files, sdkDir: path.join(FROZEN_P2, 'sdk'), catalog, outputColumns: ['hazard_class'], task: task('P-20002'), world: w, live, tag: 'b' });
    assert.equal(b.answer.hazard_class, UNABLE);            // the proven workflow keeps sop.txt §5.1's format rule
    assert.equal(b.calls.filter(c => c.name).length, 0);
  } finally { rmSync(live, { recursive: true, force: true }); }
});
