import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { estimateTokens, sha256 } from '../lib/canonical.mjs';
import { hashSeed } from '../lib/rng.mjs';
import { family, outputSchema, generate, oracle, referenceSolve, badControls, validateOutput, PASS_RULE } from './index.mjs';
import { build, KNOBS, renderPrompt, VERSION } from './gen.mjs';
import { FAULT_CLASSES, FAULTS, SECONDARY, ONSET_ALT, CALLEE_LINES, DECOY, NOTES, NOTE_MIXED, SIBLING_CLASS } from './catalog.mjs';
import { heuristics } from './baseline.mjs';
import { blameChainSolve, adaptedSolve, strongSolve } from './attack.mjs';
import { heuristicSolve, noteSolve } from './heuristic.mjs';
import { adaptedHeuristicSolve } from './heuristic2.mjs';
import { fourthHeuristicSolve } from './heuristic4.mjs';
import { ceilingHeuristicSolve } from './heuristic-ceiling.mjs';

const DIFFS = [1, 2, 3, 4, 5];
const SEEDS = Array.from({ length: 20 }, (_, i) => i);
const SEEDS30 = Array.from({ length: 30 }, (_, i) => i);
const TEST30 = Array.from({ length: 30 }, (_, i) => 5000 + i); // the held-out seed range used by experiments
const LEVEL_TAGS = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR']);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September'];
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const logLines = task => task.inputs.log.trim().split('\n');
const byIdOf = task => new Map(logLines(task).map(l => [l.split(' ')[0], l]));
const msgOf = line => line.split(' ').slice(3).join(' ');
const codeLines = file => readFileSync(new URL(file, import.meta.url), 'utf8').split('\n').filter(l => l.trim() && !l.trim().startsWith('//')).length;

// Portable schema subset (beds/CONTRACT.md): no pattern / oneOf / uniqueItems / $ref / format.
const PORTABLE = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'description', 'const']);
function nonPortableKeys(node, path = '#') {
  const bad = [];
  for (const [k, v] of Object.entries(node)) {
    if (!PORTABLE.has(k)) bad.push(`${path}/${k}`);
    if (k === 'properties') for (const [name, child] of Object.entries(v)) bad.push(...nonPortableKeys(child, `${path}/properties/${name}`));
    if (k === 'items' || (k === 'additionalProperties' && typeof v === 'object')) bad.push(...nonPortableKeys(v, `${path}/${k}`));
  }
  return bad;
}

test('interface: family metadata, portable output schema, exports', async () => {
  assert.equal(family.id, 'incident');
  assert.equal(family.kind, 'oneshot');
  assert.equal(family.version, VERSION);
  assert.equal(VERSION, '3.0.0');
  assert.ok(family.version && family.description && family.domain);
  assert.deepEqual(nonPortableKeys(outputSchema), []);
  // Cross-check with the runtime's own portability checker when it is present in this checkout.
  const subset = await import('../../src/schema-subset.mjs').catch(() => null);
  if (subset?.portableSchemaViolations) assert.deepEqual(subset.portableSchemaViolations(outputSchema), []);
  assert.deepEqual(outputSchema.properties.fault_class.enum, FAULT_CLASSES);
  assert.ok(FAULT_CLASSES.length >= 8);
  assert.equal(typeof generate, 'function');
  assert.equal(typeof oracle, 'function');
  assert.equal(typeof referenceSolve, 'function');
  for (const name of ['empty', 'shuffled-or-corrupted', 'plausible-but-wrong']) assert.ok(badControls.some(c => c.name === name), name);
});

test('determinism: identical calls give byte-identical tasks; seed and split change the task', () => {
  for (const difficulty of DIFFS) {
    const a = JSON.stringify(generate({ seed: 7, split: 'dev', difficulty }));
    const b = JSON.stringify(generate({ seed: 7, split: 'dev', difficulty }));
    assert.equal(a, b, `d${difficulty} not deterministic`);
    assert.notEqual(a, JSON.stringify(generate({ seed: 8, split: 'dev', difficulty })));
    assert.notEqual(JSON.stringify(generate({ seed: 7, split: 'test', difficulty }).inputs), JSON.stringify(JSON.parse(a).inputs));
    assert.equal(JSON.stringify(generate({ seed: 5003, split: 'test', difficulty })), JSON.stringify(generate({ seed: 5003, split: 'test', difficulty })));
  }
  assert.equal(JSON.stringify(build(3, 'test', 4).truth), JSON.stringify(build(3, 'test', 4).truth));
});

test('regression (audit v3): test-split seeds >= 5000 never reuse a dev task (RNG seeds and task content)', () => {
  // Every random choice is seeded by hashSeed('incident', VERSION, split, seed, difficulty, attempt|'class').
  for (const difficulty of DIFFS) for (const label of [0, 1, 'class']) {
    const dev = new Set(Array.from({ length: 20000 }, (_, s) => hashSeed('incident', VERSION, 'dev', s, difficulty, label)));
    for (let s = 5000; s < 6000; s++) assert.ok(!dev.has(hashSeed('incident', VERSION, 'test', s, difficulty, label)), `d${difficulty} ${label}: test ${s} shares an RNG seed with a dev seed`);
  }
  const devInputs = new Set(Array.from({ length: 300 }, (_, s) => sha256(JSON.stringify(generate({ seed: s, split: 'dev', difficulty: 3 }).inputs))));
  for (const seed of TEST30) assert.ok(!devInputs.has(sha256(JSON.stringify(generate({ seed, split: 'test', difficulty: 3 }).inputs))), `test ${seed} equals a dev task`);
});

test('regression: difficulty must be an integer 1..5 (a string difficulty used to build a different task with the same truth)', () => {
  for (const bad of ['3', 3.5, 0, 6, null, '__proto__']) assert.throws(() => generate({ seed: 1, split: 'dev', difficulty: bad }), TypeError, String(bad));
  assert.throws(() => generate({ seed: 1.5, split: 'dev', difficulty: 3 }), TypeError);
  assert.throws(() => generate({ seed: 1, split: 'train', difficulty: 3 }), TypeError);
  const task = generate({ seed: 1, split: 'dev', difficulty: 3 });
  const good = referenceSolve(task);
  assert.equal(oracle({ ...task, difficulty: '3' }, good).pass, false);
  assert.equal(oracle({ ...task, seed: '1' }, good).pass, false);
});

test('task shape: fields, files mirror inputs, line ids and timestamps are well formed', () => {
  for (const difficulty of DIFFS) {
    const task = generate({ seed: 11, split: 'dev', difficulty });
    assert.deepEqual(Object.keys(task).sort(), ['budget', 'difficulty', 'family', 'files', 'id', 'inputs', 'prompt', 'seed', 'split']);
    assert.equal(task.family, 'incident');
    assert.equal(task.files['system.md'], task.inputs.system);
    assert.equal(task.files['ticket.txt'], task.inputs.ticket);
    assert.equal(task.files['logs/bundle.log'], task.inputs.log);
    const lines = logLines(task);
    let prev = 0;
    const ids = new Set();
    for (const line of lines) {
      const m = /^(L\d{4,}) (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) (\S+) (.+)$/.exec(line);
      assert.ok(m, `malformed line: ${line}`);
      const t = Date.parse(m[2]);
      assert.ok(t >= prev, 'log must be in timestamp order');
      prev = t;
      assert.ok(!ids.has(m[1]));
      ids.add(m[1]);
    }
    assert.ok(Date.parse(lines.at(-1).split(' ')[1]) - Date.parse(lines[0].split(' ')[1]) <= 1800 * 1000);
  }
});

test('controls: referenceSolve passes 30/30 seeds at d1, d3, d5 (dev 0-29 and test 5000-5029) and 20/20 at d2, d4', () => {
  for (const difficulty of DIFFS) for (const split of ['dev', 'test']) for (const seed of (difficulty % 2 ? SEEDS30 : SEEDS).map(s => (split === 'test' ? 5000 + s : s))) {
    const task = generate({ seed, split, difficulty });
    const out = referenceSolve(task);
    assert.deepEqual(validateOutput(out), []);
    const verdict = oracle(task, out);
    assert.equal(verdict.pass, true, `${task.id}: ${JSON.stringify(verdict.details)}`);
    assert.equal(verdict.score, 1);
    // The reference answer survives a JSON round trip (what model arms actually return).
    assert.equal(oracle(task, JSON.parse(JSON.stringify(out))).pass, true);
  }
});

test('controls: every bad control fails 30/30 seeds at d1, d3, d5 (dev and test) and 20/20 at d2, d4', () => {
  assert.ok(badControls.length >= 9);
  for (const difficulty of DIFFS) for (const split of ['dev', 'test']) for (const seed of (difficulty % 2 ? SEEDS30 : SEEDS).map(s => (split === 'test' ? 5000 + s : s))) {
    const task = generate({ seed, split, difficulty });
    for (const control of badControls) {
      const verdict = oracle(task, control.make(task));
      assert.equal(verdict.pass, false, `${control.name} passed on ${task.id}`);
      assert.ok(verdict.score < 1, `${control.name} scored 1 on ${task.id}`);
    }
  }
});

test('oracle rejects schema-invalid output and enforces the exact pass rule', () => {
  const task = generate({ seed: 5, split: 'dev', difficulty: 3 });
  const good = referenceSolve(task);
  const invalid = [
    null, 'text', [], 42, {}, true, undefined, NaN,
    { ...good, extra: 1 },
    JSON.parse(JSON.stringify(good).replace('{', '{"__proto__":{"pass":true},')),
    { ...good, constructor: 'x' },
    { ...good, root_service: '' },
    { ...good, root_service: 7 },
    { ...good, root_service: [good.root_service] },
    { ...good, root_service: 'x'.repeat(81) },
    { ...good, fault_class: 'gremlins' },
    { ...good, fault_class: good.fault_class.toUpperCase() },
    { ...good, fault_class: [good.fault_class] },
    { ...good, first_bad_timestamp: 'yesterday afternoon' },
    { ...good, first_bad_timestamp: 'NaN' },
    { ...good, first_bad_timestamp: 'Infinity' },
    { ...good, first_bad_timestamp: NaN },
    { ...good, first_bad_timestamp: Date.parse(good.first_bad_timestamp) },
    { ...good, first_bad_timestamp: good.first_bad_timestamp.replace('Z', '') },
    { ...good, first_bad_timestamp: good.first_bad_timestamp.replace('T', ' ') },
    { ...good, first_bad_timestamp: good.first_bad_timestamp.slice(0, 10) },
    { ...good, impacted_services: [] },
    { ...good, impacted_services: 'all' },
    { ...good, impacted_services: [1, 2] },
    { ...good, impacted_services: [''] },
    { ...good, impacted_services: [null] },
    { ...good, impacted_services: Array.from({ length: 41 }, (_, i) => `svc-${i}`) },
    { ...good, evidence_line_ids: 'L0001' },
    { ...good, evidence_line_ids: Array.from({ length: 51 }, (_, i) => `L${i}`) },
    Object.fromEntries(Object.entries(good).filter(([k]) => k !== 'evidence_line_ids')),
  ];
  for (const out of invalid) {
    const verdict = oracle(task, out);
    assert.equal(verdict.pass, false, JSON.stringify(out)?.slice(0, 80));
    assert.equal(verdict.score, 0);
    assert.equal(verdict.details.schemaValid ?? false, false);
  }
  const T = Date.parse(good.first_bad_timestamp);
  const iso = ms => new Date(ms).toISOString();
  assert.equal(oracle(task, { ...good, first_bad_timestamp: iso(T + 60000) }).pass, true, '+60 s is inside the tolerance');
  assert.equal(oracle(task, { ...good, first_bad_timestamp: iso(T - 60000) }).pass, true, '-60 s is inside the tolerance');
  assert.equal(oracle(task, { ...good, first_bad_timestamp: iso(T + 61000) }).pass, false);
  assert.equal(oracle(task, { ...good, first_bad_timestamp: iso(T - 61000) }).pass, false);
  const offset = new Date(T + 2 * 3600000).toISOString().slice(0, 19) + '+02:00';
  assert.equal(oracle(task, { ...good, first_bad_timestamp: offset }).pass, true, 'offset timestamps are accepted');
  assert.equal(oracle(task, { ...good, root_service: good.root_service.toUpperCase() }).pass, true, 'service names compare case-insensitively');
  assert.equal(oracle(task, { ...good, root_service: ` ${good.root_service}\n` }).pass, true, 'service names are trimmed');
  assert.equal(oracle(task, { ...good, evidence_line_ids: [] }).pass, true, 'evidence does not gate the pass');
  assert.equal(oracle(task, { ...good, impacted_services: [...good.impacted_services, ...good.impacted_services] }).pass, true, 'duplicates collapse');
  assert.equal(oracle(task, { ...good, impacted_services: good.impacted_services.map(s => s.toUpperCase()).reverse() }).pass, true, 'impacted names: any order and case');
  assert.equal(oracle(task, Object.fromEntries(Object.entries(good).reverse())).pass, true, 'key order is irrelevant');
  assert.equal(oracle({ ...task, family: 'other' }, good).pass, false);
  // Jaccard threshold: adding one wrong service to a set of n>=4 stays >= 0.8, dropping enough fails.
  const truth = build(5, 'dev', 3).truth;
  const extra = truth.services.find(s => !truth.impacted_services.includes(s));
  const j = truth.impacted_services.length / (truth.impacted_services.length + 1);
  assert.equal(oracle(task, { ...good, impacted_services: [...good.impacted_services, extra] }).pass, j >= 0.8);
  // Details never carry the true values.
  const d = JSON.stringify(oracle(task, { ...good, root_service: 'nope' }).details);
  assert.ok(!d.includes(good.root_service) && !d.includes(good.first_bad_timestamp));
  assert.match(PASS_RULE, /Jaccard/);
});

test('regression (audit v3): accepted timestamp variants (minute precision, fractions, lower-case t/z, offsets)', () => {
  for (const seed of [5000, 5001, 5002]) {
    const task = generate({ seed, split: 'test', difficulty: 3 });
    const good = referenceSolve(task);
    const T = Date.parse(good.first_bad_timestamp);
    const variants = [
      new Date(T).toISOString(), // with .000
      new Date(T).toISOString().slice(0, 16) + 'Z', // minutes only (v2 rejected it as too short)
      good.first_bad_timestamp.toLowerCase(), // RFC 3339 allows t and z
      good.first_bad_timestamp.replace('Z', '+00:00'),
      new Date(T - 5 * 3600000).toISOString().slice(0, 19) + '-05:00',
      new Date(T + 1500).toISOString().replace('Z', '123Z').replace(/\.(\d{3})123Z$/, '.$1123Z'),
    ];
    for (const ts of variants) {
      assert.deepEqual(validateOutput({ ...good, first_bad_timestamp: ts }), [], ts);
      assert.equal(oracle(task, { ...good, first_bad_timestamp: ts }).pass, true, ts);
    }
  }
});

test('regression (audit v3): the oracle never throws and only reads plain data (getters, proxies, holes, toJSON, prototypes)', () => {
  const task = generate({ seed: 5007, split: 'test', difficulty: 3 });
  const good = referenceSolve(task);
  let reads = 0;
  const hostile = [
    new Proxy({}, { get() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); } }),
    new Proxy({ ...good }, {}),
    Object.defineProperty({ ...good }, 'root_service', { get() { throw new Error('getter'); }, enumerable: true }),
    Object.defineProperty({ ...good }, 'root_service', { get() { return reads++ < 2 ? 'x' : good.root_service; }, enumerable: true }),
    { ...good, impacted_services: new Array(3) },
    { ...good, impacted_services: Object.assign([...good.impacted_services], { length: good.impacted_services.length + 2 }) },
    { toJSON: () => good },
    { ...good, [Symbol('x')]: 1 },
    Object.assign(Object.create({ inherited: true }), good),
    { ...good, first_bad_timestamp: new Date(good.first_bad_timestamp) },
    { ...good, impacted_services: Array.from({ length: 5000 }, () => good.root_service) },
    { ...good, evidence_line_ids: [[[[['L0001']]]]] },
    { ...good, root_service: () => good.root_service },
  ];
  for (const out of hostile) {
    let verdict;
    assert.doesNotThrow(() => { verdict = oracle(task, out); });
    assert.equal(verdict.pass, false);
    assert.equal(verdict.score, 0);
  }
  // A null-prototype object of plain data is fine.
  assert.equal(oracle(task, Object.assign(Object.create(null), good)).pass, true);
  // A huge string field fails the length limit without crashing.
  assert.equal(oracle(task, { ...good, root_service: 'x'.repeat(5e6) }).pass, false);
  assert.doesNotThrow(() => oracle(null, good));
  assert.doesNotThrow(() => oracle({ family: 'incident' }, good));
});

test('regression: degenerate "all candidates" outputs fail (every serving service, every service, every class)', () => {
  for (const difficulty of DIFFS) for (const seed of SEEDS) {
    const task = generate({ seed, split: 'dev', difficulty });
    const t = build(seed, 'dev', difficulty).truth;
    const good = referenceSolve(task);
    const serving = t.services.filter(s => !t.noisy.includes(s));
    assert.equal(oracle(task, { ...good, impacted_services: serving }).pass, false, `${task.id}: all serving services pass the Jaccard rule`);
    assert.equal(oracle(task, { ...good, impacted_services: t.services }).pass, false, `${task.id}: all services pass the Jaccard rule`);
    assert.equal(FAULT_CLASSES.filter(c => oracle(task, { ...good, fault_class: c }).pass).length, 1);
  }
});

test('truth never leaks into prompt, inputs or files', () => {
  assert.equal(generate({ seed: 1, split: 'dev', difficulty: 2 }).prompt, renderPrompt(), 'prompt is static');
  for (const difficulty of DIFFS) for (const seed of SEEDS) {
    const { task, truth } = build(seed, 'dev', difficulty);
    const text = [task.prompt, task.inputs.system, task.inputs.ticket, task.inputs.log, JSON.stringify(task.budget)].join('\n');
    const data = [task.inputs.system, task.inputs.ticket, task.inputs.log].join('\n');
    // The true class id never appears in the data (the prompt lists all ids equally).
    assert.ok(!data.includes(truth.fault_class) || (truth.idsByTag.inject || []).length, `${task.id}: class id leaked`);
    // Class ids appear in the log only inside injected (adversarial) lines.
    const injected = new Set(truth.idsByTag.inject || []);
    for (const line of logLines(task)) {
      if (FAULT_CLASSES.some(c => line.includes(c))) assert.ok(injected.has(line.split(' ')[0]), `${task.id}: class id outside an injected line`);
    }
    assert.ok(!task.inputs.ticket.includes(truth.root_service), `${task.id}: ticket names the root`);
    assert.ok(!task.inputs.system.includes(truth.fault_class), `${task.id}: class id in the service map`);
    for (const [, hm] of task.inputs.ticket.matchAll(/\b(\d\d:\d\d) UTC by|about (\d\d:\d\d)/g).map(m => [m, m[1] || m[2]])) {
      let lag = (Date.parse(`${truth.first_bad_timestamp.slice(0, 11)}${hm}:00Z`) - Date.parse(truth.first_bad_timestamp)) / 1000;
      if (lag < -43200) lag += 86400;
      assert.ok(lag > 60, `${task.id}: ticket time ${hm} is within the tolerance of T`);
    }
    assert.ok(!text.includes(JSON.stringify(truth.impacted_services)), `${task.id}: impacted list leaked`);
    for (const line of logLines(task).filter(l => /root_service|root cause/i.test(l))) {
      const id = line.split(' ')[0];
      assert.ok(injected.has(id) || (truth.idsByTag.mislead || []).includes(id), `${task.id}: verdict-like line that is not a planted herring`);
      assert.ok(!(line.includes(truth.root_service) && /root/i.test(line) && line.includes(truth.fault_class)), `${task.id}: verdict line states the truth`);
    }
    // v3: claims and injections never name the true root (their class is drawn independently of the truth).
    for (const claim of truth.herrings.claims) assert.notEqual(claim.svc, truth.root_service, `${task.id}: a misleading claim names the true root`);
    assert.ok(!Object.keys(task.inputs).some(k => /truth|answer|solution/i.test(k)));
  }
});

// Statistical leaks found by the v3 audit (AUDIT.md). Each rate is measured over 120 test-split seeds
// per difficulty; v2 values are in the messages. Bounds sit well above the v3 values and well below v2's.
test('regression (audit v3): prose notes, claims and the topology no longer point at the root or the blast radius', () => {
  for (const difficulty of [3, 4, 5]) {
    const c = { added: [0, 0], edge: [0, 0], stale: [0, 0], claimHop: [0, 0], claimSib: [0, 0], legacyImp: [0, 0], indeg: [0, 0], deployImp: [0, 0] };
    for (let i = 0; i < 120; i++) {
      const { task, truth } = build(5000 + i, 'test', difficulty);
      for (const [, b] of truth.added) { c.added[1]++; if (b === truth.root_service) c.added[0]++; }
      for (const r of task.inputs.system.matchAll(/^\| ([a-z0-9-]+) \| [^|]+ \| (?!edge)\w+ \| ([^|]+) \|/gm)) for (const x of r[2].split(',').map(y => y.trim()).filter(y => y !== '-')) { c.edge[1]++; if (x === truth.root_service) c.edge[0]++; }
      for (const [, b] of truth.stale) { c.stale[1]++; if (b === truth.root_service) c.stale[0]++; }
      for (const cl of truth.herrings.claims.filter(x => x.kind === 'mislead')) {
        c.claimHop[1]++; if (truth.firstHopCallers.includes(cl.svc)) c.claimHop[0]++;
        c.claimSib[1]++; if (cl.cls === SIBLING_CLASS[truth.fault_class]) c.claimSib[0]++;
      }
      const m = /(\S+) still ships its logs|Log lines from (\S+) carry/.exec(task.inputs.system);
      if (m) { c.legacyImp[1]++; if (truth.impacted_services.includes(m[1] || m[2])) c.legacyImp[0]++; }
      for (const d of truth.herrings.deploys) { c.deployImp[1]++; if (truth.impacted_services.includes(d)) c.deployImp[0]++; }
      const rows = [...task.inputs.system.matchAll(/^\| ([a-z0-9-]+) \| [^|]+ \| (\w+) \| ([^|]+) \|/gm)].filter(r => r[1] !== 'Service');
      const indeg = new Map(rows.map(r => [r[1], 0]));
      for (const r of rows) for (const x of r[3].split(',').map(y => y.trim())) if (indeg.has(x)) indeg.set(x, indeg.get(x) + 1);
      const cands = rows.filter(r => r[2] !== 'edge' && r[2] !== 'batch').map(r => r[1]);
      const max = Math.max(...cands.map(x => indeg.get(x)));
      c.indeg[1]++; if (cands.filter(x => indeg.get(x) === max).length === 1 && indeg.get(truth.root_service) === max) c.indeg[0]++;
    }
    const rate = ([a, b]) => (b ? a / b : 0);
    // The note's callee is the root about as often as the callee of any non-gateway table row is.
    assert.ok(rate(c.added) <= rate(c.edge) + 0.12, `d${difficulty}: "not in the table" note names the root in ${c.added} vs ${c.edge} for table rows (v2: 0.89 at d3)`);
    assert.ok(rate(c.stale) <= 0.3, `d${difficulty}: stale-row note names the root in ${c.stale} (v2: 0.71 at d4)`);
    assert.ok(rate(c.claimHop) <= 0.45, `d${difficulty}: misleading claim targets a direct caller of the root in ${c.claimHop} (v2: 0.83)`);
    assert.ok(rate(c.claimSib) <= 0.35, `d${difficulty}: misleading claim names the sibling of the true class in ${c.claimSib} (v2: about 0.5)`);
    assert.ok(rate(c.legacyImp) <= 0.6, `d${difficulty}: legacy-source service is impacted in ${c.legacyImp} (v2: 1.0)`);
    assert.ok(rate(c.indeg) <= 0.3, `d${difficulty}: root is the unique busiest callee of the table in ${c.indeg} (v2: 0.54 at d3)`);
    assert.ok(rate(c.deployImp) <= 0.6, `d${difficulty}: routine-deploy service is impacted in ${c.deployImp} (v2: 0.77 at d3)`);
  }
});

// AUDIT.md I-1 and I-7: no benign template family may be logged by the root alone, and the root must not stand
// out by volume. In v2 one regex over the benign "lookalike" templates named the root in 200/200 d3 tasks, and the
// root had the most WARN+ERROR lines in 61% of d3 tasks.
test('regression (audit v3): benign lookalike, stats and chronic lines are not root-only, and the root is not the loudest', () => {
  for (const difficulty of [3, 4, 5]) {
    let rootOnlyLook = 0, rootOnlyBase = 0, loudest = 0;
    const N = 60;
    for (let i = 0; i < N; i++) {
      const { truth } = build(5000 + i, 'test', difficulty);
      const by = tag => Object.entries(truth.linesBySvc).filter(([, ls]) => ls.some(l => l.tag === tag)).map(([s]) => s);
      const look = by('lookalike'), base = by('baseline');
      if (look.length === 1 && look[0] === truth.root_service) rootOnlyLook++;
      if (base.length === 1 && base[0] === truth.root_service) rootOnlyBase++;
      const loud = Object.entries(truth.linesBySvc).filter(([s]) => !truth.noisy.includes(s)).map(([s, ls]) => [s, ls.filter(l => l.level === 'WARN' || l.level === 'ERROR').length]).sort((a, b) => b[1] - a[1]);
      if (loud[0][0] === truth.root_service) loudest++;
    }
    assert.equal(rootOnlyLook, 0, `d${difficulty}: only the root logs lookalikes in ${rootOnlyLook}/${N}`);
    assert.equal(rootOnlyBase, 0, `d${difficulty}: only the root logs stats/chronic baselines in ${rootOnlyBase}/${N}`);
    assert.ok(loudest / N <= 0.2, `d${difficulty}: the root has the most WARN+ERROR lines in ${loudest}/${N}`);
  }
});

test('regression: the ticket no longer enumerates exactly the impacted customer features (d3+)', () => {
  let eligible = 0;
  for (const difficulty of [3, 4, 5]) for (const seed of SEEDS) {
    const { task, truth } = build(seed, 'dev', difficulty);
    const { impacted, reported } = truth.ticketFeatures;
    for (const f of reported) assert.ok(impacted.includes(f) && task.inputs.ticket.includes(f), `${task.id}: reported feature ${f}`);
    if (impacted.length >= 2 && reported.length) { eligible++; assert.ok(reported.length < impacted.length, `${task.id}: ticket lists every impacted feature`); }
  }
  assert.ok(eligible >= 5);
  // Below d3 the ticket still lists them all (easy levels).
  const { truth } = build(0, 'dev', 1);
  assert.deepEqual(truth.ticketFeatures.reported, truth.ticketFeatures.impacted);
});

test('ordering does not leak the root (table position, first erroring service; 100 seeds)', () => {
  const positions = new Set();
  let firstErr = 0;
  const N = 100;
  for (let seed = 0; seed < N; seed++) {
    const { task, truth } = build(seed, 'dev', 3);
    positions.add(truth.services.indexOf(truth.root_service));
    const first = logLines(task).find(l => /ERROR|"error"|level=error|^E:/.test(msgOf(l).slice(0, 24)));
    if (first && first.split(' ')[2].startsWith(truth.root_service)) firstErr++;
  }
  assert.ok(positions.size >= 6, `root sits at only ${positions.size} table positions`);
  assert.ok(firstErr / N < 0.15, `first ERROR line is the root's in ${firstErr}/${N}`);
});

test('structural invariants: onset, propagation, fallbacks and noise are consistent', () => {
  for (const difficulty of DIFFS) for (const seed of SEEDS) {
    const { task, truth } = build(seed, 'dev', difficulty);
    const K = KNOBS[difficulty];
    const byId = byIdOf(task);
    assert.equal(truth.services.length, K.services, `${task.id}: service count`);
    assert.ok(truth.impacted_services.includes(truth.root_service));
    assert.ok(truth.impacted_services.length >= 2, `${task.id}: blast radius must include a caller`);
    assert.equal((truth.idsByTag.onset || []).length, 1);
    assert.ok(byId.get(truth.onsetId).includes(` ${truth.first_bad_timestamp} `), `${task.id}: onset line carries T`);
    const rootLines = truth.linesBySvc[truth.root_service];
    const T = truth.T;
    assert.ok(!rootLines.some(l => l.t < T && (l.tag === 'root' || l.tag === 'dep')), `${task.id}: fault lines before T`);
    for (const svc of truth.impacted_services) {
      if (svc === truth.root_service) continue;
      const deps = truth.linesBySvc[svc].filter(l => l.tag === 'dep');
      assert.ok(deps.length >= 1, `${task.id}: impacted ${svc} shows no failure`);
      assert.ok(deps.every(l => l.t > T), `${task.id}: ${svc} failed before T`);
    }
    for (const svc of [...truth.degraded, ...truth.noisy]) assert.ok(!truth.impacted_services.includes(svc), `${task.id}: ${svc} wrongly impacted`);
    for (const svc of truth.degraded) assert.ok(!truth.linesBySvc[svc].some(l => l.tag === 'dep'));
    for (const lines of Object.values(truth.linesBySvc)) for (const l of lines) assert.ok(LEVEL_TAGS.has(l.level));
    for (const blip of truth.herrings.blips.filter(b => b.svc === truth.root_service)) {
      assert.ok(blip.end <= T - 60, `${task.id}: root blip must recover at least 60 s before T`);
      assert.ok(K.blipNear || blip.t < T - 300, `${task.id}: below d3 the root blip is far from T`);
    }
  }
});

// Documented names: every alias the generator records must literally appear in the service map.
test('regression: every documented alias appears in the service map, and dependent failures name an impacted callee', () => {
  for (const difficulty of DIFFS) for (const seed of SEEDS.slice(0, 12)) {
    const { task, truth } = build(seed, 'dev', difficulty);
    for (const alias of Object.keys(truth.aliasDoc)) assert.ok(task.inputs.system.includes(alias), `${task.id}: alias ${alias} undocumented`);
    const names = Object.keys(truth.aliasDoc).sort((a, b) => b.length - a.length);
    const res = names.map(n => [new RegExp(`(^|[^a-z0-9.-])${escapeRe(n)}($|[^a-z0-9-])`), truth.aliasDoc[n]]);
    const impacted = new Set(truth.impacted_services);
    const text = new Map(logLines(task).map(l => [l.split(' ')[0], msgOf(l)]));
    for (const [svc, lines] of Object.entries(truth.linesBySvc)) for (const l of lines.filter(x => x.tag === 'dep')) {
      if (truth.anonymous.includes(svc)) continue; // checked in the next test
      const msg = text.get(l.id);
      const blamed = res.filter(([re]) => re.test(msg)).map(([, n]) => n);
      assert.ok(blamed.some(b => b !== svc && impacted.has(b)), `${task.id} ${l.id} (${svc}) names no impacted callee: ${msg}`);
    }
  }
});

test('regression (v3 traps stay solvable): every optional call documented, dated notes resolvable, fallbacks with providers, anonymous services linked, decoys healthy', () => {
  let withDegraded = 0, n = 0;
  for (const difficulty of [3, 4, 5]) for (const seed of SEEDS) {
    const { task, truth } = build(seed, 'dev', difficulty);
    const sys = task.inputs.system;
    n++;
    // (1) Every soft edge has a note naming both services that states its current behaviour; a dated pair's
    // later note is the one that matches the truth.
    for (const [from, to, , provider] of truth.softEdges) {
      const docs = truth.edgeDocs.filter(d => d.from === from && d.to === to);
      assert.ok(docs.length >= 1 && docs.every(d => sys.includes(d.text) && d.text.includes(from) && d.text.includes(to)), `${task.id}: soft edge ${from}->${to} undocumented`);
      if (provider) assert.ok(docs.some(d => d.kind === 'provider' && d.text.includes(provider)), `${task.id}: provider ${provider} of ${from}->${to} undocumented`);
    }
    for (const [from, to, now] of truth.revised) {
      const docs = truth.edgeDocs.filter(d => d.from === from && d.to === to && d.kind.startsWith('dated'));
      assert.equal(docs.length, 2, `${task.id}: dated pair for ${from}->${to}`);
      const month = d => MONTHS.findIndex(m => d.text.includes(m));
      const [then, later] = [docs.find(d => d.kind === 'dated-then'), docs.find(d => d.kind === 'dated-now')];
      assert.ok(month(then) >= 0 && month(later) > month(then), `${task.id}: dated notes for ${from}->${to} out of order`);
      assert.equal(now === 'soft', truth.softEdges.some(e => e[0] === from && e[1] === to), `${task.id}: revised edge state`);
    }
    // (2) A caller whose optional callee fails is impacted exactly when the callee's fallback provider fails too
    // (unless a hard dependency already failed it).
    for (const [from, to, , provider] of truth.softEdges.filter(e => e[3] && truth.impacted_services.includes(e[1]))) {
      if (truth.impacted_services.includes(provider)) assert.ok(truth.impacted_services.includes(from), `${task.id}: ${from} keeps serving although ${to} and its provider ${provider} failed`);
      else assert.ok(truth.impacted_services.includes(from) || truth.degraded.includes(from), `${task.id}: ${from} is neither impacted nor degraded`);
    }
    if (truth.degraded.length) {
      withDegraded++;
      assert.ok(truth.softEdges.some(e => e[2] === 'silent' && truth.degraded.includes(e[0])), `${task.id}: falling-back callers include a silent one`);
    }
    // (3) Every anonymous service has a documented edge (table row or prose note) to an impacted callee.
    for (const anon of truth.anonymous) {
      const row = sys.split('\n').find(l => l.startsWith(`| ${anon} |`));
      const calls = row.split('|')[4].split(',').map(x => x.trim());
      const viaTable = calls.some(c => truth.impacted_services.includes(c));
      const viaProse = truth.added.some(([a, b]) => a === anon && truth.impacted_services.includes(b));
      assert.ok(viaTable || viaProse, `${task.id}: anonymous ${anon} has no documented impacted callee`);
      assert.ok(truth.impacted_services.includes(anon));
    }
    // (4) Decoys are healthy: not impacted, no dependency failures, no 5xx in their own request lines, and their
    // loud lines start shortly before T.
    const byId = byIdOf(task);
    for (const d of truth.herrings.decoys) {
      assert.ok(!truth.impacted_services.includes(d.svc), `${task.id}: decoy ${d.svc} is impacted`);
      const lines = truth.linesBySvc[d.svc];
      assert.ok(!lines.some(l => l.tag === 'dep'), `${task.id}: decoy logs dependency failures`);
      // HTTP status positions only (v2's pattern also matched counts such as "expired 596 keys").
      assert.ok(lines.filter(l => l.tag === 'bg').every(l => !/(status=|-> |(GET|POST|PUT|DELETE) \/\S* )5\d\d\b/.test(msgOf(byId.get(l.id)))), `${task.id}: decoy serves 5xx`);
      assert.ok(d.t < truth.T && d.t >= truth.T - 300, `${task.id}: decoy timing`);
    }
    // (5) Fault-wording lines of the root (consequences, repeats, partial recoveries) never precede the onset;
    // every blip, in any service, ends with its recovery line.
    for (const l of truth.linesBySvc[truth.root_service].filter(x => x.tag === 'root')) assert.ok(l.t >= truth.T);
    for (const b of truth.herrings.blips.filter(x => x.end !== undefined)) assert.ok(b.end > b.t);
    // (6) Gradual faults (disk, pool) start as a trend well before they turn fatal; cache and config symptoms lag.
    if (['disk_full', 'connection_pool_exhaustion'].includes(truth.fault_class)) assert.ok(truth.symFrom - truth.T >= 90, `${task.id}: lead too short`);
    if (truth.fault_class === 'poisoned_cache') assert.ok(truth.symFrom - truth.T >= 70, `${task.id}: cache symptoms too early`);
    if (truth.fault_class === 'bad_config_deploy') assert.ok(truth.symFrom - truth.T >= 30, `${task.id}: config symptoms too early`);
    // (7) Large clock skew is the only case where a clock-skew root uses certificate words at onset.
    if (truth.fault_class === 'clock_skew' && !truth.bigSkew) assert.ok(!/x509|certificate/i.test(msgOf(byId.get(truth.onsetId))));
  }
  assert.ok(withDegraded / n >= 0.35, `only ${withDegraded}/${n} d3+ tasks have a caller that falls back`);
});

test('regression (audit v3): onset rules — canary releases, per-pod echoes, stats keep running after T', () => {
  let canaries = 0, echoes = 0, stats = 0, statsOnsets = 0, configs = 0;
  for (const difficulty of [3, 4, 5]) for (let seed = 0; seed < 60; seed++) {
    const { task, truth } = build(seed, 'dev', difficulty);
    const byId = byIdOf(task);
    const onset = msgOf(byId.get(truth.onsetId));
    const rootMsgs = truth.linesBySvc[truth.root_service].map(l => ({ ...l, msg: msgOf(byId.get(l.id)) }));
    if (truth.fault_class === 'bad_config_deploy') {
      configs++;
      if (/canary|traffic split/.test(onset)) {
        canaries++;
        const promote = rootMsgs.find(l => /promoting the canary/.test(l.msg));
        assert.ok(promote && promote.t - truth.T >= 70 && promote.t - truth.T <= 160, `${task.id}: canary promotion 70-160 s after the onset`);
        // Before the promotion has reached every pod, the stats lines still report the old release.
        const newVer = /release (\S+?);|by (\S+) \(canary\)|running (\S+) as/.exec(onset).slice(1).find(Boolean);
        assert.ok(newVer && rootMsgs.some(l => l.t > promote.t && l.msg.includes(newVer)), `${task.id}: new release ${newVer} visible after the promotion`);
        assert.ok(rootMsgs.filter(l => l.t > truth.T && l.t < promote.t && /config watch: no changes/.test(l.msg)).every(l => !l.msg.includes(newVer)), `${task.id}: stats report the canary release too early`);
      }
      if (rootMsgs.some(l => /pod \S+ loaded configuration bundle/.test(l.msg) && l.t > truth.T)) echoes++;
    }
    if (truth.fault_class === 'poisoned_cache') {
      const snap = /(snap-[0-9a-f]+)/.exec(onset)[1];
      assert.ok(rootMsgs.filter(l => l.t > truth.T && l.msg.includes(snap) && /refill|warm-up/.test(l.msg)).length >= 1, `${task.id}: replicas echo the bad snapshot`);
    }
    // The root's periodic stats lines run on after T (v2 stopped them at T, which dated the fault).
    if (truth.idsByTag.baseline?.length && !['bad_config_deploy', 'poisoned_cache'].includes(truth.fault_class)) {
      stats++;
      assert.ok(rootMsgs.some(l => l.t > truth.T + 30 && (l.tag === 'root' || l.tag === 'bg') && /stats:|disk usage|heap after gc|handshakes\/min|lookups\/min|ntp offset|quota usage/.test(l.msg)), `${task.id}: root stats stop at T`);
    }
    if (/stats:|^(\[\w+\] |\w+ |\w: |level=\w+ msg=")?(disk usage|heap after gc|TLS listener|resolver|ntp offset)|quota usage/.test(onset)) statsOnsets++;
  }
  assert.ok(configs >= 10 && canaries >= 3 && echoes >= 5, `config tasks ${configs}, canary onsets ${canaries}, per-pod echoes ${echoes}`);
  assert.ok(stats >= 40 && statsOnsets >= 20, `stats ${stats}, stats-form onsets ${statsOnsets}`);
});

test('regression: gradual onsets are the first abnormal value after same-vocabulary baselines', () => {
  let checked = 0;
  for (const difficulty of [3, 4, 5]) for (let seed = 0; seed < 60 && checked < 12; seed++) {
    const { task, truth } = build(seed, 'dev', difficulty);
    if (truth.fault_class !== 'disk_full') continue;
    const byId = byIdOf(task);
    const pct = id => Number((/(\d+)% on|usage on \S+ jumped to (\d+)%|at (\d+)%|usage (\d+)%/.exec(msgOf(byId.get(id))) || []).slice(1).find(Boolean));
    const base = truth.linesBySvc[truth.root_service].filter(l => l.tag === 'baseline' && l.t < truth.T && /disk usage \d+% on/.test(msgOf(byId.get(l.id))));
    assert.ok(base.length >= 3, `${task.id}: baseline usage lines before T`);
    const vals = base.map(l => pct(l.id));
    assert.ok(Math.max(...vals) - Math.min(...vals) <= 2, `${task.id}: baseline is steady`);
    const onset = pct(truth.onsetId);
    assert.ok(!Number.isFinite(onset) || onset >= Math.max(...vals) + 2, `${task.id}: onset value ${onset} is not clearly above the baseline ${vals}`);
    checked++;
  }
  assert.ok(checked >= 5);
});

test('the root is rarely the service with the most ERROR lines', () => {
  for (const difficulty of DIFFS) {
    let top = 0;
    for (const seed of SEEDS) {
      const { truth } = build(seed, 'dev', difficulty);
      const counts = Object.entries(truth.linesBySvc).map(([s, ls]) => [s, ls.filter(l => l.level === 'ERROR').length]).sort((a, b) => b[1] - a[1]);
      if (counts[0][0] === truth.root_service) top++;
    }
    assert.ok(top / SEEDS.length <= 0.2, `d${difficulty}: root is the top ERROR emitter in ${top}/${SEEDS.length}`);
  }
});

test('difficulty scales size and adversarial content as documented', () => {
  const med = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  const tokens = {}, lines = {};
  for (const difficulty of DIFFS) {
    const toks = [], ls = [];
    for (const seed of SEEDS.slice(0, 10)) {
      const { task, truth } = build(seed, 'dev', difficulty);
      toks.push(estimateTokens(task.prompt) + estimateTokens(task.inputs));
      ls.push(truth.lineCount);
      const tags = truth.idsByTag;
      if (difficulty >= 2) assert.ok(tags.deploy?.length, `${task.id}: routine deploy herring`);
      if (difficulty >= 2) assert.ok(tags['blip-same']?.length || truth.fault_class === 'upstream_rate_limiting', `${task.id}: same-class blip elsewhere`);
      if (difficulty >= 3) {
        assert.ok(tags['blip-root']?.length && tags.chronic?.length, `${task.id}: root blip and chronic herring`);
        assert.ok(tags.decoy?.length && tags.baseline?.length, `${task.id}: decoy and baselines`);
        assert.ok(!truth.degraded.length || tags.soft?.length, `${task.id}: falling-back callers log`);
        assert.ok(truth.herrings.decoys.length >= 1, `${task.id}: decoy`);
        assert.match(task.inputs.system, /Teams choose their own log levels/);
      }
      if (difficulty >= 4) {
        assert.ok(tags.mislead?.length, `${task.id}: misleading claim`);
        assert.match(task.inputs.system, /## Service addresses/);
      }
      if (difficulty === 5) {
        assert.equal(tags.inject?.length, 1, `${task.id}: injected instruction`);
        assert.ok(truth.herrings.decoys.length >= 2, `${task.id}: two decoys`);
      }
      if (difficulty <= 2) assert.match(task.inputs.system, /Known issue/);
    }
    tokens[difficulty] = med(toks);
    lines[difficulty] = med(ls);
    assert.ok(Math.abs(lines[difficulty] - KNOBS[difficulty].lines) / KNOBS[difficulty].lines < 0.3, `d${difficulty}: ${lines[difficulty]} lines vs target ${KNOBS[difficulty].lines}`);
  }
  for (const d of [2, 3, 4, 5]) assert.ok(tokens[d] > tokens[d - 1] && lines[d] > lines[d - 1]);
  assert.ok(tokens[3] >= 6000 && tokens[3] <= 17000, `d3 median tokens ${tokens[3]}`);
});

test('paraphrase pools are used from d3 (notes are not a single fixed template)', () => {
  const seen = new Set();
  for (const seed of SEEDS) {
    const sys = generate({ seed, split: 'dev', difficulty: 4 }).inputs.system;
    for (const line of sys.split('\n').filter(l => l.startsWith('- '))) seen.add(line.replace(/[a-z0-9-]+-(svc|api|db|engine|store|bff|gateway|door|scorer|lookup|flags|proxy|gw|index|bus|broker|cache)\b/g, 'S').slice(0, 18));
  }
  assert.ok(seen.size >= 12, `only ${seen.size} distinct note openings`);
  assert.ok(NOTES.optional.length >= 8 && NOTES.added.length >= 6 && NOTES.hard.length >= 7 && NOTES.provider.length >= 4 && NOTE_MIXED.length >= 6);
  for (const cls of FAULT_CLASSES) assert.ok(SECONDARY[cls].length >= 3 && FAULTS[cls].onset.length >= 2, cls);
  assert.ok(Object.keys(CALLEE_LINES).length >= 8 && Object.keys(DECOY).length >= 5 && Object.keys(ONSET_ALT).length >= 2);
});

// Triviality attack (audit). Short deterministic scripts that read only prompt + inputs; each must pass < 20% of
// the 30 held-out seeds (test split, 5000-5029) at difficulty 3 and 5. The attacker files are fixtures; the
// compliant ones stay within 40 non-comment lines. The over-budget ceiling attacker is a tripwire (< 50%).
test('surface-statistics and adversarial scripts pass < 20% at difficulty 3 and 5 on held-out seeds (bed needs judgment)', t => {
  for (const file of ['heuristic.mjs', 'heuristic2.mjs', 'heuristic4.mjs']) assert.ok(codeLines(file) <= 40, `${file} has ${codeLines(file)} code lines`);
  const scripts = { ...heuristics, blameChain: blameChainSolve, adapted: adaptedSolve, strong: strongSolve, A1: heuristicSolve, A1note: noteSolve, A2: adaptedHeuristicSolve, A4: fourthHeuristicSolve };
  const report = [];
  for (const difficulty of [1, 3, 5]) {
    const passes = Object.fromEntries([...Object.keys(scripts), 'ceiling'].map(k => [k, 0]));
    for (const seed of TEST30) {
      const task = generate({ seed, split: 'test', difficulty });
      for (const [name, h] of Object.entries(scripts)) if (oracle(task, h(task)).pass) passes[name]++;
      if (oracle(task, ceilingHeuristicSolve(task)).pass) passes.ceiling++;
    }
    report.push(`d${difficulty} ${JSON.stringify(passes)}`);
    if (difficulty >= 3) {
      for (const name of Object.keys(scripts)) assert.ok(passes[name] / TEST30.length < 0.2, `d${difficulty} ${name} passes ${passes[name]}/${TEST30.length}`);
      assert.ok(passes.ceiling / TEST30.length < 0.5, `d${difficulty} over-budget ceiling attacker passes ${passes.ceiling}/${TEST30.length}`);
    }
  }
  t.diagnostic(`script passes of ${TEST30.length} held-out seeds: ${report.join('; ')}`);
});

test('runtime limits at difficulty 5: generate and oracle under 2 s and 200 MB', () => {
  for (const seed of [0, 1, 2]) {
    let t0 = performance.now();
    const task = generate({ seed: 900 + seed, split: 'test', difficulty: 5 });
    assert.ok(performance.now() - t0 < 2000, 'generate too slow');
    t0 = performance.now();
    oracle(task, referenceSolve(task));
    assert.ok(performance.now() - t0 < 2000, 'oracle too slow');
  }
  // Peak memory of a fresh process that generates and scores one difficulty-5 task (cold, no truth cache).
  const script = `const m = await import(${JSON.stringify(new URL('./index.mjs', import.meta.url).href)});
    const before = process.resourceUsage().maxRSS;
    const t0 = performance.now();
    const task = m.generate({ seed: 4242, split: 'dev', difficulty: 5 });
    const t1 = performance.now();
    m.oracle(task, { root_service: 'x', fault_class: 'disk_full', first_bad_timestamp: '2026-01-01T00:00:00Z', impacted_services: ['x'], evidence_line_ids: [] });
    console.log(JSON.stringify({ base: before, peak: process.resourceUsage().maxRSS, gen: t1 - t0, orc: performance.now() - t1 }));`;
  const { base, peak, gen, orc } = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
  assert.ok((peak - base) * 1024 < 200 * 1024 * 1024, `generate+oracle grew RSS by ${Math.round((peak - base) / 1024)} MB`);
  assert.ok(gen < 2000 && orc < 2000, `cold generate ${gen} ms, oracle ${orc} ms`);
});
