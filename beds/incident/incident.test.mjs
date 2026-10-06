import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { estimateTokens } from '../lib/canonical.mjs';
import { family, outputSchema, generate, oracle, referenceSolve, badControls, validateOutput } from './index.mjs';
import { build, KNOBS, renderPrompt } from './gen.mjs';
import { FAULT_CLASSES } from './catalog.mjs';
import { heuristics } from './baseline.mjs';

const DIFFS = [1, 2, 3, 4, 5];
const SEEDS = Array.from({ length: 20 }, (_, i) => i);
const LEVEL_TAGS = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR']);

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
  }
  assert.equal(JSON.stringify(build(3, 'test', 4).truth), JSON.stringify(build(3, 'test', 4).truth));
});

test('task shape: fields, files mirror inputs, line ids and timestamps are well formed', () => {
  for (const difficulty of DIFFS) {
    const task = generate({ seed: 11, split: 'dev', difficulty });
    assert.deepEqual(Object.keys(task).sort(), ['budget', 'difficulty', 'family', 'files', 'id', 'inputs', 'prompt', 'seed', 'split']);
    assert.equal(task.family, 'incident');
    assert.equal(task.files['system.md'], task.inputs.system);
    assert.equal(task.files['ticket.txt'], task.inputs.ticket);
    assert.equal(task.files['logs/bundle.log'], task.inputs.log);
    const lines = task.inputs.log.trim().split('\n');
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

test('referenceSolve passes for 20 seeds per difficulty on both splits', () => {
  for (const difficulty of DIFFS) for (const split of ['dev', 'test']) for (const seed of SEEDS) {
    const task = generate({ seed, split, difficulty });
    const out = referenceSolve(task);
    assert.deepEqual(validateOutput(out), []);
    const verdict = oracle(task, out);
    assert.equal(verdict.pass, true, `${task.id}: ${JSON.stringify(verdict.details)}`);
    assert.equal(verdict.score, 1);
  }
});

test('every bad control fails for 20 seeds per difficulty', () => {
  for (const difficulty of DIFFS) for (const seed of SEEDS) {
    const task = generate({ seed, split: 'dev', difficulty });
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
    null, 'text', [], 42, {},
    { ...good, extra: 1 },
    { ...good, root_service: '' },
    { ...good, root_service: 7 },
    { ...good, fault_class: 'gremlins' },
    { ...good, first_bad_timestamp: 'yesterday afternoon' },
    { ...good, first_bad_timestamp: good.first_bad_timestamp.replace('Z', '') },
    { ...good, impacted_services: [] },
    { ...good, impacted_services: 'all' },
    { ...good, impacted_services: [1, 2] },
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
  const offset = new Date(T + 2 * 3600000).toISOString().slice(0, 19) + '+02:00';
  assert.equal(oracle(task, { ...good, first_bad_timestamp: offset }).pass, true, 'offset timestamps are accepted');
  assert.equal(oracle(task, { ...good, root_service: good.root_service.toUpperCase() }).pass, true, 'service names compare case-insensitively');
  assert.equal(oracle(task, { ...good, evidence_line_ids: [] }).pass, true, 'evidence does not gate the pass');
  assert.equal(oracle({ ...task, family: 'other' }, good).pass, false);
  // Jaccard threshold: adding one wrong service to a set of n>=4 stays >= 0.8, dropping enough fails.
  const truth = build(5, 'dev', 3).truth;
  const extra = truth.services.find(s => !truth.impacted_services.includes(s));
  const j = truth.impacted_services.length / (truth.impacted_services.length + 1);
  assert.equal(oracle(task, { ...good, impacted_services: [...good.impacted_services, extra] }).pass, j >= 0.8);
});

test('truth never leaks into prompt, inputs or files', () => {
  assert.equal(generate({ seed: 1, split: 'dev', difficulty: 2 }).prompt, renderPrompt(), 'prompt is static');
  for (const difficulty of DIFFS) for (const seed of SEEDS) {
    const { task, truth } = build(seed, 'dev', difficulty);
    const text = [task.prompt, task.inputs.system, task.inputs.ticket, task.inputs.log, JSON.stringify(task.budget)].join('\n');
    const data = [task.inputs.system, task.inputs.ticket, task.inputs.log].join('\n');
    // The true class id never appears in the data (the prompt lists all ids equally).
    assert.ok(!data.includes(truth.fault_class), `${task.id}: class id leaked`);
    // Class ids appear in the log only inside injected (adversarial) lines.
    const injected = new Set(truth.idsByTag.inject || []);
    for (const line of task.inputs.log.split('\n')) {
      if (FAULT_CLASSES.some(c => line.includes(c))) assert.ok(injected.has(line.split(' ')[0]), `${task.id}: class id outside an injected line`);
    }
    assert.ok(!task.inputs.ticket.includes(truth.root_service), `${task.id}: ticket names the root`);
    for (const [, hm] of task.inputs.ticket.matchAll(/\b(\d\d:\d\d) UTC by|about (\d\d:\d\d)/g).map(m => [m, m[1] || m[2]])) {
      let lag = (Date.parse(`${truth.first_bad_timestamp.slice(0, 11)}${hm}:00Z`) - Date.parse(truth.first_bad_timestamp)) / 1000;
      if (lag < -43200) lag += 86400;
      assert.ok(lag > 60, `${task.id}: ticket time ${hm} is within the tolerance of T`);
    }
    assert.ok(!text.includes(JSON.stringify(truth.impacted_services)), `${task.id}: impacted list leaked`);
    for (const line of task.inputs.log.split('\n').filter(l => /root_service|root cause/i.test(l))) {
      const id = line.split(' ')[0];
      assert.ok(injected.has(id) || (truth.idsByTag.mislead || []).includes(id), `${task.id}: verdict-like line that is not a planted herring`);
      assert.ok(!(line.includes(truth.root_service) && /root/i.test(line) && line.includes(truth.fault_class)), `${task.id}: verdict line states the truth`);
    }
    for (const claim of truth.herrings.claims) {
      assert.notEqual(claim.svc, truth.root_service, `${task.id}: a misleading claim names the true root`);
      assert.notEqual(claim.cls, truth.fault_class, `${task.id}: a misleading claim names the true class`);
    }
    assert.ok(!Object.keys(task.inputs).some(k => /truth|answer|solution/i.test(k)));
  }
});

test('structural invariants: onset, propagation, fallbacks and noise are consistent', () => {
  for (const difficulty of DIFFS) for (const seed of SEEDS) {
    const { task, truth } = build(seed, 'dev', difficulty);
    const K = KNOBS[difficulty];
    const byId = new Map(task.inputs.log.trim().split('\n').map(l => [l.split(' ')[0], l]));
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
    for (const blip of truth.herrings.blips.filter(b => b.svc === truth.root_service)) assert.ok(blip.t < T - 240, 'root blips recover well before T');
  }
});

// Every documented way of naming a service: table name, other names column, prose aliases, addresses.
function documentedAliases(system) {
  const alias = new Map();
  for (const line of system.split('\n')) {
    const row = /^\| ([a-z0-9-]+) \| [^|]+ \| [^|]+ \| [^|]+ \| ([^|]+) \|$/.exec(line);
    if (row && row[1] !== 'Service') {
      alias.set(row[1], row[1]);
      for (const other of row[2].split(',').map(x => x.trim().replace(/^'|'$/g, '')).filter(x => x && x !== '-')) alias.set(other, row[1]);
    }
    const prose = /refer to ([a-z0-9-]+) by its pre-migration name '([^']+)'/.exec(line);
    if (prose) alias.set(prose[2], prose[1]);
    const addr = /^- ([a-z0-9-]+): (10\.[0-9.]+:\d+)$/.exec(line);
    if (addr) alias.set(addr[2], addr[1]);
  }
  return alias;
}

test('every dependent failure names an impacted callee through a documented alias', () => {
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const difficulty of DIFFS) for (const seed of SEEDS.slice(0, 12)) {
    const { task, truth } = build(seed, 'dev', difficulty);
    const alias = documentedAliases(task.inputs.system);
    const impacted = new Set(truth.impacted_services);
    const text = new Map(task.inputs.log.trim().split('\n').map(l => [l.split(' ')[0], l.split(' ').slice(3).join(' ')]));
    const names = [...alias.keys()];
    for (const [svc, lines] of Object.entries(truth.linesBySvc)) for (const l of lines.filter(x => x.tag === 'dep')) {
      const msg = text.get(l.id);
      const blamed = names.filter(n => new RegExp(`(^|[^a-z0-9.-])${escape(n)}($|[^a-z0-9-])`).test(msg)).map(n => alias.get(n));
      assert.ok(blamed.some(b => b !== svc && impacted.has(b)), `${task.id} ${l.id} (${svc}) names no impacted callee: ${msg}`);
    }
  }
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
        assert.ok(/Not yet in the table|treats .* as optional|no longer calls/.test(task.inputs.system) || truth.added.length === 0);
      }
      if (difficulty >= 4) {
        assert.ok(tags.mislead?.length, `${task.id}: misleading claim`);
        assert.match(task.inputs.system, /## Service addresses/);
      }
      if (difficulty === 5) {
        assert.equal(tags.inject?.length, 1, `${task.id}: injected instruction`);
        assert.match(task.inputs.system, /old application name/);
      }
      if (difficulty <= 2) assert.match(task.inputs.system, /Known issue/);
    }
    tokens[difficulty] = med(toks);
    lines[difficulty] = med(ls);
    assert.ok(Math.abs(lines[difficulty] - KNOBS[difficulty].lines) / KNOBS[difficulty].lines < 0.25, `d${difficulty}: ${lines[difficulty]} lines vs target ${KNOBS[difficulty].lines}`);
  }
  for (const d of [2, 3, 4, 5]) assert.ok(tokens[d] > tokens[d - 1] && lines[d] > lines[d - 1]);
  assert.ok(tokens[3] >= 6000 && tokens[3] <= 16000, `d3 median tokens ${tokens[3]}`);
});

test('surface-statistics scripts rarely pass from difficulty 3 (bed needs judgment)', t => {
  const report = [];
  for (const difficulty of DIFFS) {
    const passes = Object.fromEntries(Object.keys(heuristics).map(k => [k, 0]));
    for (const seed of SEEDS) {
      const task = generate({ seed, split: 'dev', difficulty });
      for (const [name, h] of Object.entries(heuristics)) if (oracle(task, h(task)).pass) passes[name]++;
    }
    report.push(`d${difficulty} ${JSON.stringify(passes)}`);
    if (difficulty >= 3) for (const [name, n] of Object.entries(passes)) assert.ok(n / SEEDS.length <= 0.25, `d${difficulty} ${name} passes ${n}/${SEEDS.length}`);
  }
  t.diagnostic(`script baselines (passes of ${SEEDS.length}): ${report.join('; ')}`);
});

test('runtime limits at difficulty 5: generate and oracle under 2 s', () => {
  for (const seed of [0, 1, 2]) {
    let t0 = performance.now();
    const task = generate({ seed: 900 + seed, split: 'test', difficulty: 5 });
    assert.ok(performance.now() - t0 < 2000, 'generate too slow');
    t0 = performance.now();
    oracle(task, referenceSolve(task));
    assert.ok(performance.now() - t0 < 2000, 'oracle too slow');
  }
  // Peak memory of a fresh process that generates and scores one difficulty-5 task.
  const script = `const m = await import(${JSON.stringify(new URL('./index.mjs', import.meta.url).href)});
    const before = process.resourceUsage().maxRSS;
    const task = m.generate({ seed: 4242, split: 'dev', difficulty: 5 });
    m.oracle(task, m.referenceSolve(task));
    console.log(JSON.stringify({ base: before, peak: process.resourceUsage().maxRSS }));`;
  const { base, peak } = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
  assert.ok((peak - base) * 1024 < 200 * 1024 * 1024, `generate+oracle grew RSS by ${Math.round((peak - base) / 1024)} MB`);
});
