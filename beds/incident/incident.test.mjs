import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { estimateTokens } from '../lib/canonical.mjs';
import { family, outputSchema, generate, oracle, referenceSolve, badControls, validateOutput } from './index.mjs';
import { build, KNOBS, renderPrompt } from './gen.mjs';
import { FAULT_CLASSES, FAULTS, SECONDARY, ONSET_ALT, CALLEE_LINES, DECOY, NOTES, NOTE_MIXED } from './catalog.mjs';
import { heuristics } from './baseline.mjs';
import { blameChainSolve, adaptedSolve, strongSolve } from './attack.mjs';

const DIFFS = [1, 2, 3, 4, 5];
const SEEDS = Array.from({ length: 20 }, (_, i) => i);
const SEEDS30 = Array.from({ length: 30 }, (_, i) => i);
const LEVEL_TAGS = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR']);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const logLines = task => task.inputs.log.trim().split('\n');
const byIdOf = task => new Map(logLines(task).map(l => [l.split(' ')[0], l]));
const msgOf = line => line.split(' ').slice(3).join(' ');

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

test('controls: referenceSolve passes 30/30 seeds at d1, d3, d5 (both splits) and 20/20 at d2, d4', () => {
  for (const difficulty of DIFFS) for (const split of ['dev', 'test']) for (const seed of difficulty % 2 ? SEEDS30 : SEEDS) {
    const task = generate({ seed, split, difficulty });
    const out = referenceSolve(task);
    assert.deepEqual(validateOutput(out), []);
    const verdict = oracle(task, out);
    assert.equal(verdict.pass, true, `${task.id}: ${JSON.stringify(verdict.details)}`);
    assert.equal(verdict.score, 1);
  }
});

test('controls: every bad control fails 30/30 seeds at d1, d3, d5 and 20/20 at d2, d4', () => {
  assert.ok(badControls.length >= 9);
  for (const difficulty of DIFFS) for (const seed of difficulty % 2 ? SEEDS30 : SEEDS) {
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
    null, 'text', [], 42, {}, true,
    { ...good, extra: 1 },
    JSON.parse(JSON.stringify(good).replace('{', '{"__proto__":{"pass":true},')),
    { ...good, root_service: '' },
    { ...good, root_service: 7 },
    { ...good, root_service: 'x'.repeat(81) },
    { ...good, fault_class: 'gremlins' },
    { ...good, fault_class: good.fault_class.toUpperCase() },
    { ...good, first_bad_timestamp: 'yesterday afternoon' },
    { ...good, first_bad_timestamp: 'NaN' },
    { ...good, first_bad_timestamp: Date.parse(good.first_bad_timestamp) },
    { ...good, first_bad_timestamp: good.first_bad_timestamp.replace('Z', '') },
    { ...good, first_bad_timestamp: good.first_bad_timestamp.toLowerCase() },
    { ...good, impacted_services: [] },
    { ...good, impacted_services: 'all' },
    { ...good, impacted_services: [1, 2] },
    { ...good, impacted_services: [''] },
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
  const offset = new Date(T + 2 * 3600000).toISOString().slice(0, 19) + '+02:00';
  assert.equal(oracle(task, { ...good, first_bad_timestamp: offset }).pass, true, 'offset timestamps are accepted');
  assert.equal(oracle(task, { ...good, root_service: good.root_service.toUpperCase() }).pass, true, 'service names compare case-insensitively');
  assert.equal(oracle(task, { ...good, evidence_line_ids: [] }).pass, true, 'evidence does not gate the pass');
  assert.equal(oracle(task, { ...good, impacted_services: [...good.impacted_services, ...good.impacted_services] }).pass, true, 'duplicates collapse');
  assert.equal(oracle({ ...task, family: 'other' }, good).pass, false);
  // Jaccard threshold: adding one wrong service to a set of n>=4 stays >= 0.8, dropping enough fails.
  const truth = build(5, 'dev', 3).truth;
  const extra = truth.services.find(s => !truth.impacted_services.includes(s));
  const j = truth.impacted_services.length / (truth.impacted_services.length + 1);
  assert.equal(oracle(task, { ...good, impacted_services: [...good.impacted_services, extra] }).pass, j >= 0.8);
  // Details never carry the true values.
  const d = JSON.stringify(oracle(task, { ...good, root_service: 'nope' }).details);
  assert.ok(!d.includes(good.root_service) && !d.includes(good.first_bad_timestamp));
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
    assert.ok(!data.includes(truth.fault_class), `${task.id}: class id leaked`);
    // Class ids appear in the log only inside injected (adversarial) lines.
    const injected = new Set(truth.idsByTag.inject || []);
    for (const line of logLines(task)) {
      if (FAULT_CLASSES.some(c => line.includes(c))) assert.ok(injected.has(line.split(' ')[0]), `${task.id}: class id outside an injected line`);
    }
    assert.ok(!task.inputs.ticket.includes(truth.root_service), `${task.id}: ticket names the root`);
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
    for (const claim of truth.herrings.claims) {
      assert.notEqual(claim.svc, truth.root_service, `${task.id}: a misleading claim names the true root`);
      assert.notEqual(claim.cls, truth.fault_class, `${task.id}: a misleading claim names the true class`);
    }
    assert.ok(!Object.keys(task.inputs).some(k => /truth|answer|solution/i.test(k)));
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

test('ordering does not leak the root (table position, first erroring service)', () => {
  const positions = new Set();
  let firstErr = 0;
  for (const seed of SEEDS30) {
    const { task, truth } = build(seed, 'dev', 3);
    positions.add(truth.services.indexOf(truth.root_service));
    const first = logLines(task).find(l => /ERROR|"error"|level=error|^E:/.test(msgOf(l).slice(0, 24)));
    if (first && first.split(' ')[2].startsWith(truth.root_service)) firstErr++;
  }
  assert.ok(positions.size >= 4, `root sits at only ${positions.size} table positions`);
  assert.ok(firstErr / SEEDS30.length < 0.2, `first ERROR line is the root's in ${firstErr}/30`);
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
      if (svc === truth.anonymous) continue; // checked in the next test
      const msg = text.get(l.id);
      const blamed = res.filter(([re]) => re.test(msg)).map(([, n]) => n);
      assert.ok(blamed.some(b => b !== svc && impacted.has(b)), `${task.id} ${l.id} (${svc}) names no impacted callee: ${msg}`);
    }
  }
});

test('regression (v2 traps stay solvable): soft callers documented, anonymous service linked, decoys healthy', () => {
  for (const difficulty of [3, 4, 5]) for (const seed of SEEDS) {
    const { task, truth } = build(seed, 'dev', difficulty);
    const sys = task.inputs.system;
    const sentences = sys.split('\n').filter(l => l.startsWith('- '));
    // (1) Every soft edge is stated in a note that names both services (optional or mixed note).
    for (const [from, to] of truth.softEdges) {
      assert.ok(sentences.some(s => s.includes(from) && s.includes(to) && /optional|fall|soft|instead|keeps serving|wraps/.test(s)), `${task.id}: soft edge ${from}->${to} undocumented`);
    }
    assert.ok(truth.degraded.length >= 1, `${task.id}: d3+ needs at least one caller that falls back`);
    assert.ok(truth.softEdges.some(e => e[2] === 'silent' && truth.degraded.includes(e[0])), `${task.id}: d3+ needs a silent soft caller`);
    // (2) The anonymous service has a documented edge (table row or prose note) to an impacted callee.
    if (truth.anonymous) {
      const row = sys.split('\n').find(l => l.startsWith(`| ${truth.anonymous} |`));
      const calls = row.split('|')[4].split(',').map(x => x.trim());
      const viaTable = calls.some(c => truth.impacted_services.includes(c));
      const viaProse = truth.added.some(([a, b]) => a === truth.anonymous && truth.impacted_services.includes(b));
      assert.ok(viaTable || viaProse, `${task.id}: anonymous ${truth.anonymous} has no documented impacted callee`);
      assert.ok(truth.impacted_services.includes(truth.anonymous));
    }
    // (3) Decoys are healthy: not impacted, no dependency failures, no 5xx in their own lines, and
    // their loud lines start shortly before T.
    const byId = byIdOf(task);
    for (const d of truth.herrings.decoys) {
      assert.ok(!truth.impacted_services.includes(d.svc), `${task.id}: decoy ${d.svc} is impacted`);
      const lines = truth.linesBySvc[d.svc];
      assert.ok(!lines.some(l => l.tag === 'dep'), `${task.id}: decoy logs dependency failures`);
      assert.ok(lines.filter(l => l.tag === 'bg').every(l => !/( |status=|-> )5\d\d( |\(|$)/.test(msgOf(byId.get(l.id)))), `${task.id}: decoy serves 5xx`);
      assert.ok(d.t < truth.T && d.t >= truth.T - 300, `${task.id}: decoy timing`);
    }
    // (4) Sibling-vocabulary and callee-naming root lines never precede the onset.
    for (const l of truth.linesBySvc[truth.root_service].filter(x => x.tag === 'root')) assert.ok(l.t >= truth.T);
    // (5) Gradual faults (disk, pool) start as a trend well before they turn fatal.
    if (['disk_full', 'connection_pool_exhaustion'].includes(truth.fault_class)) assert.ok(truth.symFrom - truth.T >= 90, `${task.id}: lead too short`);
    if (truth.fault_class === 'poisoned_cache') assert.ok(truth.symFrom - truth.T >= 70, `${task.id}: cache symptoms too early`);
    if (truth.fault_class === 'bad_config_deploy') assert.ok(truth.symFrom - truth.T >= 30, `${task.id}: config symptoms too early`);
    // (6) Large clock skew is the only case where a clock-skew root uses certificate words at onset.
    if (truth.fault_class === 'clock_skew' && !truth.bigSkew) assert.ok(!/x509|certificate/i.test(msgOf(byId.get(truth.onsetId))));
  }
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
        assert.ok(tags.decoy?.length && tags.baseline?.length && tags.soft?.length, `${task.id}: decoy, baselines and fallback callers`);
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
    assert.ok(Math.abs(lines[difficulty] - KNOBS[difficulty].lines) / KNOBS[difficulty].lines < 0.25, `d${difficulty}: ${lines[difficulty]} lines vs target ${KNOBS[difficulty].lines}`);
  }
  for (const d of [2, 3, 4, 5]) assert.ok(tokens[d] > tokens[d - 1] && lines[d] > lines[d - 1]);
  assert.ok(tokens[3] >= 6000 && tokens[3] <= 15500, `d3 median tokens ${tokens[3]}`);
});

test('paraphrase pools are used from d3 (notes are not a single fixed template)', () => {
  const seen = new Set();
  for (const seed of SEEDS) {
    const sys = generate({ seed, split: 'dev', difficulty: 4 }).inputs.system;
    for (const line of sys.split('\n').filter(l => l.startsWith('- '))) seen.add(line.replace(/[a-z0-9-]+-(svc|api|db|engine|store|bff|gateway|door|scorer|lookup|flags|proxy|gw|index|bus|broker|cache)\b/g, 'S').slice(0, 18));
  }
  assert.ok(seen.size >= 12, `only ${seen.size} distinct note openings`);
  assert.ok(NOTES.optional.length >= 4 && NOTES.added.length >= 4 && NOTE_MIXED.length >= 3);
  for (const cls of FAULT_CLASSES) assert.ok(SECONDARY[cls].length >= 3 && FAULTS[cls].onset.length >= 2, cls);
  assert.ok(Object.keys(CALLEE_LINES).length >= 8 && Object.keys(DECOY).length >= 5 && Object.keys(ONSET_ALT).length >= 2);
});

// Triviality attack (audit): short deterministic scripts that read only prompt + inputs. The bar
// from the audit brief: each passes < 20% of seeds at difficulty 3 (30 seeds).
test('surface-statistics and adversarial scripts pass < 20% at difficulty 3 (bed needs judgment)', t => {
  const scripts = { ...heuristics, blameChain: blameChainSolve, adapted: adaptedSolve, strong: strongSolve };
  const report = [];
  for (const difficulty of [1, 3, 5]) {
    const passes = Object.fromEntries(Object.keys(scripts).map(k => [k, 0]));
    for (const seed of SEEDS30) {
      const task = generate({ seed, split: 'dev', difficulty });
      for (const [name, h] of Object.entries(scripts)) if (oracle(task, h(task)).pass) passes[name]++;
    }
    report.push(`d${difficulty} ${JSON.stringify(passes)}`);
    if (difficulty >= 3) for (const [name, n] of Object.entries(passes)) assert.ok(n / SEEDS30.length < 0.2, `d${difficulty} ${name} passes ${n}/${SEEDS30.length}`);
  }
  t.diagnostic(`script passes of ${SEEDS30.length}: ${report.join('; ')}`);
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
  // Peak memory of a fresh process that generates and scores one difficulty-5 task.
  const script = `const m = await import(${JSON.stringify(new URL('./index.mjs', import.meta.url).href)});
    const before = process.resourceUsage().maxRSS;
    const t0 = performance.now();
    const task = m.generate({ seed: 4242, split: 'dev', difficulty: 5 });
    const t1 = performance.now();
    m.oracle(task, m.referenceSolve(task));
    console.log(JSON.stringify({ base: before, peak: process.resourceUsage().maxRSS, gen: t1 - t0, orc: performance.now() - t1 }));`;
  const { base, peak, gen, orc } = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
  assert.ok((peak - base) * 1024 < 200 * 1024 * 1024, `generate+oracle grew RSS by ${Math.round((peak - base) / 1024)} MB`);
  assert.ok(gen < 2000 && orc < 2000, `cold generate ${gen} ms, oracle ${orc} ms`);
});
