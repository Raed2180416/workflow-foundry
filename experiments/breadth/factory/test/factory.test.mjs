// Family factory (node V) tests, $0: nice -n 15 node --test --test-concurrency=1 experiments/breadth/factory/test/factory.test.mjs
// Python steps run with the system python3 (standard library only); the AutomationBench-venv and D16-venv checks are
// skipped when those interpreters are absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSeeds, estimate, parseSeeds, summarize, ARMS, FAMILIES } from '../run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const AB = path.join(REPO, 'experiments/autobench');
const PY = 'python3';
const FACTORY_PY = '/var/tmp/foundry-work/benches/factory/venv/bin/python';
const AB_PY = process.env.FACTORY_AB_PY || path.join(REPO, 'corpus/AutomationBench/.venv/bin/python');
const py = (args, opts = {}) => execFileSync(PY, ['-I', '-B', ...args], { cwd: os.tmpdir(), encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
const lastJson = s => JSON.parse(s.trim().split('\n').pop());
const sha = s => createHash('sha256').update(s).digest('hex');

test('frozen split: the hash rule reproduces SPLIT.json byte for byte, 8 per family, 4 messy each', () => {
  const file = path.join(REPO, 'research/breadth-20261021/factory/SPLIT.json');
  const text = readFileSync(file, 'utf8');
  assert.equal(sha(text), 'd7ed9e496bd47d748d450556546277199d643c7cdb52690b81bcbb0fb802c5f6');
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'split-'));
  try {
    py([path.join(REPO, 'experiments/breadth/factory/split.py'), '--write', path.join(tmp, 'S.json')]);
    assert.equal(readFileSync(path.join(tmp, 'S.json'), 'utf8'), text);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  const s = JSON.parse(text);
  const all = Object.values(s.sealed_by_family).flat();
  assert.deepEqual(all.map(r => r.seed).sort((a, b) => a - b), Array.from({ length: 24 }, (_, i) => 8850 + i));
  for (const rows of Object.values(s.sealed_by_family)) {
    assert.equal(rows.length, 8);
    assert.equal(rows.filter(r => r.intake === 'messy').length, 4);
  }
});

test('seed ledger registers the V blocks before any generation and the generators refuse sealed seeds', () => {
  const L = JSON.parse(readFileSync(path.join(REPO, 'research/jit-20261008/SEED-LEDGER.json'), 'utf8'));
  const r = Object.fromEntries(L.ranges.map(x => [x.id, x]));
  assert.deepEqual([r['factory-v-sealed'].from, r['factory-v-sealed'].to], [8850, 8873]);
  assert.deepEqual([r['factory-v-dev'].from, r['factory-v-dev'].to], [2101, 2160]);
  for (const f of FAMILIES) {
    assert.throws(() => py([path.join(AB, 'families', f, 'model.py'), '--seed', '8851'], { stdio: 'pipe' }), /sealed/);
  }
});

test('run.mjs split hygiene and cost estimate', () => {
  assert.deepEqual(parseSeeds('2113-2115,2120'), [2113, 2114, 2115, 2120]);
  assert.throws(() => checkSeeds([8850]), /refused/);
  assert.throws(() => checkSeeds([2099]), /refused/);
  assert.throws(() => checkSeeds([8850], { sealed: true, prereg: 'x' }), /not frozen|refused/);
  assert.equal(checkSeeds([2113, 2160]), true);
  const e = estimate('A-H', { streams: 24, triggers: 160 });
  assert.equal(e.sessions, 3840);
  assert.ok(e.cachedUsd < e.upperUsd && e.upperUsd > 0);
  assert.equal(estimate('scripted', { streams: 3, triggers: 10 }).upperUsd, 0);
  assert.ok(ARMS['A-O'].effort === 'xhigh' && ARMS['F-H'].mode === 'construct');
  const s = summarize([{ family: 'f', seed: 1, k: 0, week: 0, pass: true }, { family: 'f', seed: 1, k: 1, week: 1, pass: false, hard_violations: 1 }]);
  assert.equal(s.cleanStreams, 0); assert.equal(s.cleanWeeks, '1/2'); assert.equal(s.hardViolations, 1);
});

test('family.spec compiles: POLICY.md and compiled.json are fresh, G0 static lint passes', () => {
  for (const f of FAMILIES) {
    const out = lastJson(py([path.join(AB, 'abr/lib/factory/spec.py'), path.join(AB, 'families', f), '--check']));
    assert.equal(out.pass, true, f);
  }
});

test('messy intake: answerability lint and reference classification pass on all 60 practice/dev seeds', () => {
  for (const f of FAMILIES) {
    const out = JSON.parse(py([path.join(AB, 'abr/lib/factory/intake.py'), 'lint', '--family', f]));
    assert.equal(out.pass, true, `${f}: ${out.problems.join('; ')}`);
    assert.equal(out.seeds_checked, 60);
  }
});

test('golden tests from the rule text (clock engine and each reference, N-version) pass', () => {
  const out = lastJson(py([path.join(HERE, 'clock_props.py')]));
  assert.deepEqual(out.golden_failures, []);
});

test('Hypothesis properties and the frozen holiday table (D16 factory venv)', { skip: !existsSync(FACTORY_PY) && 'factory venv absent' }, () => {
  const out = lastJson(execFileSync(FACTORY_PY, ['-I', path.join(HERE, 'clock_props.py')], { cwd: os.tmpdir(), encoding: 'utf8' }));
  assert.equal(out.properties.ran, true);
  assert.deepEqual(out.properties.failures, []);
  assert.equal(out.holidays.frozen_table_matches, true);
});

test('UCI-mined SLA thresholds behind the itsm golden tests come from the params file', () => {
  const p = JSON.parse(readFileSync(path.join(REPO, 'research/breadth-20261021/factory/params/uci-498-params.json'), 'utf8'));
  assert.equal(p.priority['3 - Moderate'].mined_sla_threshold_hours, 91.68);
  assert.equal(p.priority['4 - Low'].mined_sla_threshold_hours, 328.53);
  const spec = JSON.parse(readFileSync(path.join(AB, 'families/abr-itsm-queue/family.spec.json'), 'utf8'));
  assert.equal(spec.params.targets.P3, Math.ceil(91.68));
  assert.equal(spec.params.targets.P4, Math.ceil(328.53));
});

for (const f of FAMILIES) {
  test(`${f}: N-version truth engine and observable-only reference agree on a dev stream; controls are detected`, () => {
    const H = path.join(AB, 'abr/lib/factory/harness.py');
    const ref = lastJson(py([H, '--family', f, 'run', '--solver', 'reference', '--seeds', '2125']));
    assert.equal(ref.pass_rate, 1, JSON.stringify(ref.outcomes));
    assert.equal(ref.clean_streams, 1);
    assert.equal(ref.hard_violations, 0);
    const nul = lastJson(py([H, '--family', f, 'run', '--solver', 'null', '--seeds', '2125']));
    assert.equal(nul.clean_streams, 0);
    assert.ok(nul.pass_rate < 1);
    const mem = lastJson(py([H, '--family', f, 'run', '--solver', 'memoryless', '--seeds', '2125']));
    assert.equal(mem.clean_streams, 0);
  });
}

test('B0: shared harness extracted; every AB-R family imports it (AutomationBench venv)', { skip: !existsSync(AB_PY) && 'AutomationBench venv absent' }, () => {
  const out = JSON.parse(execFileSync(AB_PY, ['-I', '-B', path.join(AB, 'abr/tools/import_check.py')], { cwd: os.tmpdir(), encoding: 'utf8' }));
  assert.ok(Object.values(out).every(v => v === 'ok'), JSON.stringify(out));
  const rep = JSON.parse(readFileSync(path.join(REPO, 'research/breadth-20261021/factory/b0/b0-extract-report.json'), 'utf8'));
  assert.equal(Object.keys(rep.replaced).length, 12);
});
