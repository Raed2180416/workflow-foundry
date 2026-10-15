// label-run.mjs (need router v1 label harness, DESIGN §7 M0 items 3-4) and its arm pieces: selfCheck in construct(),
// procedureFile in b0Agent. $0: stub ports only (no model, no claude binary); the work roots are temporary directories.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as LR from '../label-run.mjs';
import { needTable } from '../metrics.mjs';
import { perArm, cacheShareCell } from '../../memory/cache-share.mjs';
import { STAGES_FILE } from '../prereg-check.mjs';
import { b0Agent, PROCEDURE_LINE, checksVerdict, outsidePaths } from '../../lib/arms/b0-agent.mjs';
import { construct, runSelfCheck, SELF_CHECK_PARAGRAPH, messageUsageOf } from '../../c0/construct.mjs';
import { builderPrompt } from '../../c0/prompts.mjs';
import { loadFamily } from '../../lib/beds.mjs';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { loadHiddenPathDetector } from '../../kev-data/ports/crossfamily-baselines.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = path.join(REPO, 'experiments/need-router/label-run.mjs');
const tmp = t => { const d = mkdtempSync(path.join(tmpdir(), 'label-run-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []);
const STAGES = JSON.parse(readFileSync(STAGES_FILE, 'utf8'));
const FIVE = ['direct-H', 'agent-H', 'agent-O', 'agent-H+proc', 'construct-H'];
// A stage spec of the stages.json schema: the preregistered arms, seeds, prices and jobs, one test stage.
function spec(dir, { runs, capUsd = 400, approved = false, status = 'draft', seeds = STAGES.seeds, jobs = ['records-lo', 'wbed-r0'] } = {}) {
  const doc = { ...STAGES, status, seeds, jobs: STAGES.jobs.filter(j => jobs.includes(j.id)),
    stages: [{ id: 'NL-T', grade: 'development', estUsd: 1, capUsd, approved, runs: runs ?? [
      { job: 'records-lo', arms: FIVE, seedRoles: ['examples', 'trainEval'] },
      { job: 'records-lo', arms: ['direct-H', 'agent-H'], seedRoles: ['probe'] },
      { job: 'wbed-r0', arms: ['direct-H', 'agent-H'], seedRoles: ['trainEval'] },
      { job: 'wbed-r0', arms: ['ref-R3'], seedRoles: ['trainEval'], condition: 'engine stamp carries static@v3:' },
    ] }] };
  const file = path.join(dir, 'spec.json');
  writeFileSync(file, JSON.stringify(doc, null, 1));
  return file;
}
const quiet = () => {};

test('one meter: tiers by prompt tokens, cache rates, timeouts and killed sessions charged at their bound', () => {
  const P = STAGES.priceTable;
  // Haiku: <= 100K prompt tokens at $0.10/$0.50, cache read $0.01, write $0.125; above, every token at the long tier.
  assert.equal(LR.priceUsage(P, 'claude-haiku-5-5', { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }), 0.5);
  assert.equal(LR.priceUsage(P, 'claude-haiku-5-5', { inputTokens: 50000, outputTokens: 1e6, cacheReadTokens: 50000, cacheWriteTokens: 0 }), (50000 * 0.1 + 1e6 * 0.5 + 50000 * 0.01) / 1e6);
  assert.equal(LR.priceUsage(P, 'claude-haiku-5-5', { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 100000, cacheWriteTokens: 0 }), (1000 * 0.5 + 100000 * 0.05) / 1e6);
  assert.equal(LR.priceUsage(P, 'claude-opus-5-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1e6 }), 5);
  assert.equal(LR.priceUsage(P, 'gpt-x', { inputTokens: 1 }), null);
  const u = { inputTokens: 2000, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const one = LR.priceUsage(P, 'claude-haiku-5-5', u);
  const ok = LR.priceCalls(P, [{ modelId: 'claude-haiku-5-5', usage: u, costUsd: 9 }]);
  assert.equal(ok.measured, one); assert.equal(ok.imputed, 0, 'the reported $9 is not the meter: tokens are');
  const to = LR.priceCalls(P, [{ modelId: 'claude-haiku-5-5', usage: u, errorCode: 'MODEL_TIMEOUT' }], { boundUsd: 1 });
  assert.equal(to.measured + to.imputed, 1, 'a timed-out direct call costs its $1 bound, never $0');
  const killed = LR.priceCalls(P, [{ modelId: 'claude-haiku-5-5', usage: null, costUnknown: true, costUpperUsd: 1 }]);
  assert.deepEqual([killed.measured, killed.imputed], [0, 1]);
  // Agent sessions: per message, each at its own tier and model; a killed session is charged at its budget.
  const msgs = [[1000, 100, 150000, 0, 'claude-haiku-5-5'], [1000, 100, 0, 0, null], [10, 10, 0, 0, 'claude-unknown-1']];
  const s = LR.priceSession(P, 'claude-haiku-5-5', { messageUsage: msgs });
  assert.equal(s.measured, (1000 * 0.5 + 100 * 2.5 + 150000 * 0.05) / 1e6 + (1000 * 0.1 + 100 * 0.5) / 1e6 + (10 * 0.1 + 10 * 0.5) / 1e6);
  assert.equal(s.modelFallback, 1); assert.equal(s.imputed, 0);
  const k = LR.priceSession(P, 'claude-opus-5-5', { messageUsage: [[100, 10, 0, 0, 'claude-opus-5-5']], costUnknown: true, boundUsd: 4 });
  assert.equal(r6(k.measured + k.imputed), 4); assert.ok(k.imputed > 3.99);
  const none = LR.priceSession(P, 'claude-haiku-5-5', { reportedUsd: 0.2 });
  assert.deepEqual([none.measured, none.repriced], [0.2, false], 'no usage recorded: the reported figure, flagged not re-priced');
});
const r6 = x => Math.round(x * 1e6) / 1e6;

test('plan: stage units skip what this harness cannot run; the ledger is asked for every task; a refused seed stops the stage', async t => {
  const dir = tmp(t), file = spec(dir);
  const { stages, stage } = LR.loadPlan({ stageId: 'NL-T', specFile: file });
  const { units, skipped } = LR.stageUnits(stages, stage);
  assert.deepEqual(units.map(u => [u.job.id, u.evalRole, u.arms, u.probeArms]), [
    ['records-lo', 'trainEval', FIVE, ['direct-H', 'agent-H']], ['wbed-r0', 'trainEval', ['direct-H', 'agent-H'], []]]);
  assert.match(skipped[0].reason, /conditional run/);
  const withCond = LR.stageUnits(stages, stage, { withConditional: true });
  assert.match(withCond.skipped[0].reason, /^ref-R3: static@v3/);
  const ledger = (await import('../../jit/seeds.mjs')).loadLedger();
  const plan = await LR.planJob(stages, units[0], { ledger, examplesNeeded: [1, 2, 3], probe: true });
  assert.equal(plan.evalTasks.length, 12); assert.equal(plan.seedChecks, 9 + 1 + 12, 'every example, the probe and every evaluation task');
  assert.deepEqual(plan.evalTasks.map(x => x.seed), Array.from({ length: 12 }, (_, i) => 610 + i));
  assert.deepEqual(plan.evalTasks.map(x => x.difficulty), [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2], 'records-lo band [1, 2]: contiguous blocks');
  assert.deepEqual(plan.examples[2].map(x => [x.seed, x.difficulty]), [[604, 2], [605, 1], [606, 2]]);
  assert.equal(new Set(plan.evalTasks.map(x => x.taskHash)).size, 12);
  // A purpose on the wrong split is refused before anything runs (L4).
  const bad = spec(dir, { seeds: { ...STAGES.seeds, purposes: { ...STAGES.seeds.purposes, train: 'need-heldout' } } });
  await assert.rejects(LR.labelRun({ stageId: 'NL-T', specFile: bad, workRoot: path.join(dir, 'w'), out: path.join(dir, 'o'), dry: true, log: quiet }), e => e.code === 'SEED_REFUSED');
  assert.equal(existsSync(path.join(dir, 'w', 'results.jsonl')), false, 'nothing ran');
});

test('a paid run needs an approved stage and a frozen plan; the work root must be outside the repository', async t => {
  const dir = tmp(t);
  await assert.rejects(LR.labelRun({ stageId: 'NL-T', specFile: spec(dir), workRoot: path.join(dir, 'w'), log: quiet }), /not approved/);
  await assert.rejects(LR.labelRun({ stageId: 'NL-T', specFile: spec(dir, { approved: true }), workRoot: path.join(dir, 'w'), log: quiet }), /draft, not frozen/);
  await assert.rejects(LR.labelRun({ stageId: 'NL-T', specFile: spec(dir), workRoot: path.join(REPO, 'tmp-x'), dry: true, log: quiet }), /outside the repository/);
  assert.equal(existsSync(path.join(REPO, 'tmp-x')), false);
  assert.throws(() => LR.loadPlan({ stageId: 'NL-T', stagesFile: path.join(dir, 'absent.json') }), /pass --stage-spec/);
  assert.throws(() => LR.loadPlan({ stageId: 'NOPE', specFile: spec(dir) }), /no stage NOPE/);
});

test('--dry: every mode, builds as fixed costs, probe rows without the oracle, rows that needTable accepts, files copied out', async t => {
  const dir = tmp(t), live = path.join(dir, 'live'), out = path.join(dir, 'out');
  const rep = await LR.labelRun({ stageId: 'NL-T', specFile: spec(dir), prereg: path.join(REPO, 'research/need-router-20261014/PREREG-NEED-V1.md'), workRoot: live, out, dry: true, log: quiet });
  assert.equal(rep.dry, true); assert.equal(rep.ports, 'stub'); assert.equal(rep.stopped, null);
  const rl = rep.jobs.find(j => j.job === 'records-lo');
  assert.deepEqual(Object.keys(rl.modes).sort(), [...FIVE].sort());
  assert.equal(rl.modes['direct-H'].reps, 2); assert.equal(rl.modes['construct-H'].reps, rl.builds.filter(b => b.mode === 'construct-H').length);
  assert.ok(rl.builds.filter(b => b.mode === 'construct-H').length >= 3 && rl.builds.filter(b => b.mode === 'agent-H+proc').length >= 2);
  assert.equal(rl.pairing, 'ok'); assert.equal(rl.probes.length, 3);
  assert.match(rep.jobs.find(j => j.job === 'wbed-r0').r0Control.perDraw[0], /^\d+\/12$/);
  assert.match(rep.rules.gates, /reported only/, '--dry reports K2 but does not stop on stub outcomes');
  for (const f of ['results.jsonl', 'calls.jsonl', 'builds.jsonl', 'builds.final.jsonl', 'probes.jsonl', 'rows.jsonl', 'report.json', 'report.txt', 'racing.jsonl']) assert.ok(existsSync(path.join(out, f)), f);
  assert.ok(existsSync(path.join(out, 'artifacts/records-lo/construct-H-L1/construction.json')) || rl.builds.find(b => b.mode === 'construct-H' && b.lineage === 1).failed);
  const rows = readJsonl(path.join(out, 'rows.jsonl')), builds = readJsonl(path.join(out, 'builds.final.jsonl'));
  const table = needTable(rows, builds);
  assert.deepEqual(table.jobs.sort(), ['records-lo', 'wbed-r0']);
  for (const r of rows) {
    assert.equal(r.schema, 'need-label-row/1');
    for (const k of ['pass', 'delivered', 'schemaValid', 'selfVerdict', 'deployableVerdict', 'usdReported', 'usdRepriced', 'usdImputed', 'ms', 'tokens', 'error']) assert.ok(k in r, k);
    assert.ok(r.usdRepriced >= 0 && r.usdImputed >= 0);
    if (r.mode === 'construct-H' || r.mode === 'agent-H+proc') assert.equal(r.rep, r.lineage - 1); else assert.equal(r.lineage, null);
    if (!r.delivered) assert.equal(r.selfVerdict, null);
  }
  assert.ok(rows.some(r => r.mode === 'construct-H' && r.selfVerdict !== null), 'construct-H answers carry the self-check verdict');
  assert.ok(rows.some(r => r.mode === 'agent-H+proc' && r.selfVerdict !== null), 'agent-H+proc answers carry the checks.json verdict');
  assert.ok(rows.filter(r => r.mode === 'direct-H').every(r => r.selfVerdict === null));
  // Builds are fixed costs: never folded into a task row.
  for (const b of builds) { assert.equal(b.schema, 'need-build-row/1'); assert.ok(b.usdRepriced >= 0); assert.equal(b.rep, b.lineage - 1); }
  // Probe rows: deployable signals only; no oracle verdict anywhere in them.
  const probes = readJsonl(path.join(out, 'probes.jsonl'));
  assert.deepEqual(probes.map(p => [p.mode, p.draw, p.seed]), [['direct-H', 0, 601], ['direct-H', 1, 601], ['agent-H', 0, 601]]);
  for (const p of probes) for (const k of ['pass', 'score', 'oracleDetails']) assert.equal(k in p, false, k);
  assert.equal(readJsonl(path.join(out, 'results.jsonl')).some(r => r.taskKey.endsWith(':s601')), false, 'the probe example is never scored');
  // One meter: the totals are the sums of rows, builds and probes; charged = measured + imputed.
  const T = rep.totals;
  assert.equal(r6(T.usdMeasured + T.usdImputed), T.usdCharged);
  assert.equal(r6(T.usdTaskRows.usdRepriced), r6(rows.reduce((a, r) => a + r.usdRepriced, 0)));
  // Live files stay in the work root; the report names no path.
  assert.doesNotMatch(readFileSync(path.join(out, 'report.json'), 'utf8'), new RegExp(dir.replaceAll('/', '\\/')));
  assert.equal(rep.prompts.selfCheckParagraph.length, 16);
  assert.ok(rep.preregSha);
  // MEM-0: every arm's usage and prompt-cache read share over its task rows, builds and probe rows, in report.json and report.txt.
  for (const b of builds) assert.ok(b.tokens && Number.isFinite(b.tokens.cacheReadTokens), `build ${b.mode} L${b.lineage} carries its tokens`);
  assert.ok(builds.some(b => b.factory === 'construct' && b.tokens.cacheReadTokens > 0), 'a builder session\'s cache reads count toward its arm');
  const want = perArm([...rows, ...builds, ...probes]);
  assert.deepEqual(Object.keys(rep.arms), Object.keys(want));
  for (const [a, x] of Object.entries(rep.arms)) {
    assert.deepEqual(x.usage, want[a].usage, a); assert.equal(x.cacheReadShare, want[a].cacheReadShare, a);
    assert.ok(x.cacheReadShare === null || (x.cacheReadShare >= 0 && x.cacheReadShare <= 1), a);
  }
  assert.ok(Object.values(rep.arms).some(x => x.cacheReadShare > 0), 'the stub sessions read from the cache');
  const txt = readFileSync(path.join(out, 'report.txt'), 'utf8');
  assert.match(txt, /prompt-cache read share per arm \(MEM-0\):/);
  for (const [a, x] of Object.entries(rep.arms)) assert.ok(txt.includes(`  ${a.padEnd(14)} ${cacheShareCell(x.usage)}`), a);
});

test('--dry gives a byte-identical report on rerun: a fresh work root, and a resume in the same one (CLI)', t => {
  const dir = tmp(t), file = spec(dir);
  const run = w => {
    const r = spawnSync(process.execPath, [SCRIPT, '--stage-spec', file, '--stage', 'NL-T', '--dry', '--work-root', path.join(dir, w)], { encoding: 'utf8', cwd: REPO });
    assert.equal(r.status, 0, r.stderr + r.stdout.slice(-2000));
    return ['report.json', 'report.txt'].map(f => readFileSync(path.join(dir, w, 'dry-out', f)));
  };
  const a = run('w1'), b = run('w2'), c = run('w1');
  assert.ok(a[0].equals(b[0]) && a[1].equals(b[1]), 'fresh rerun: identical report');
  assert.ok(a[0].equals(c[0]) && a[1].equals(c[1]), 'resume in the same work root: identical report');
  assert.equal(readJsonl(path.join(dir, 'w1', 'results.jsonl')).length, readJsonl(path.join(dir, 'w2', 'results.jsonl')).length, 'the resume ran nothing twice');
  assert.match(a[1].toString(), /DRY: stub ports/);
});

test('voids, failed builds, killed builders and environment faults (stub outcomes forced)', async t => {
  const dir = tmp(t), out = path.join(dir, 'out');
  const runs = [{ job: 'records-lo', arms: ['agent-H', 'agent-H+proc', 'construct-H'], seedRoles: ['examples', 'trainEval'] }];
  const stubForce = {
    builder: { 'construct-H-L1': 'nested', 'construct-H-L2': 'fail', 'construct-H-L3': 'killed' },
    agent: { 'agent-H+proc#1/records_dev_d1_s610_t0': 'nested', 'agent-H/records_dev_d1_s611_t0': 'nested' },
  };
  const rep = await LR.labelRun({ stageId: 'NL-T', specFile: spec(dir, { runs }), workRoot: path.join(dir, 'live'), out, dry: true, racing: false, stubForce, log: quiet });
  const builds = readJsonl(path.join(out, 'builds.final.jsonl')), rows = readJsonl(path.join(out, 'rows.jsonl'));
  const b = (mode, k) => builds.find(x => x.mode === mode && x.lineage === k);
  assert.equal(b('construct-H', 1).nestedModelAttempts, 1);
  assert.equal(rows.filter(r => r.arm === 'construct-H#1').length, 0, 'a lineage voided at build time is not run');
  assert.equal(b('construct-H', 2).failed, true); assert.equal(rows.filter(r => r.arm === 'construct-H#2').length, 0, 'a failed build runs nothing');
  assert.ok(b('construct-H', 3).usdImputed > 2.9, 'a killed builder is charged at its $3 budget bound');
  assert.equal(rows.filter(r => r.arm === 'construct-H#3').length, 12, 'a killed builder that left a solver still runs');
  assert.match(b('agent-H+proc', 1).void, /run sessions: nestedModelAttempts=1/, 'a nested model call in a procedure lineage run voids the lineage');
  assert.equal(b('agent-H+proc', 2).void, null);
  const draw = rows.find(r => r.arm === 'agent-H' && r.task === 'records:dev:d1:s611' && r.rep === 0);
  assert.equal(draw.void, 'nestedModelAttempts=1'); assert.equal(draw.pass, false); assert.equal(draw.error, 'VOIDED'); assert.equal(typeof draw.rawPass, 'boolean');
  const table = needTable(rows, builds);
  assert.deepEqual(table.voided.map(v => `${v.mode}#${v.rep + 1}`).sort(), ['agent-H+proc#1', 'construct-H#1']);
  const c = table.cell('records-lo', 'construct-H');
  assert.equal(c.byTask.get('records:dev:d1:s610').get(1).error, 'BUILD_FAILED');
  const jb = rep.jobs[0].builds;
  assert.match(jb.find(x => x.mode === 'construct-H' && x.lineage === 1).void, /nestedModelAttempts=1/);
  // An environment fault in a build is not an outcome: kept aside, no build row, a resume retries it.
  const d2 = tmp(t);
  const r2 = await LR.labelRun({ stageId: 'NL-T', specFile: spec(d2, { runs: [{ job: 'records-lo', arms: ['construct-H'], seedRoles: ['examples', 'trainEval'] }] }), workRoot: path.join(d2, 'live'),
    out: path.join(d2, 'out'), dry: true, racing: false, stubForce: { builder: { 'construct-H-L2': 'envfault' } }, log: quiet });
  assert.equal(r2.totals.constructionFaults, 1);
  assert.deepEqual(readJsonl(path.join(d2, 'out', 'builds.final.jsonl')).map(x => x.lineage), [1, 3]);
  assert.match(r2.jobs[0].pairing, /^incomplete|ok/);
});

test('the stage cap: nothing starts unless its bound fits beside spend and work in flight; the run stops and is analysed as it stands', async t => {
  const dir = tmp(t), out = path.join(dir, 'out');
  const runs = [{ job: 'wbed-r0', arms: ['direct-H', 'agent-H'], seedRoles: ['trainEval'] }];
  const rep = await LR.labelRun({ stageId: 'NL-T', specFile: spec(dir, { runs, capUsd: 3.5 }), workRoot: path.join(dir, 'live'), out, dry: true, racing: false, concurrency: 2, log: quiet });
  assert.match(rep.stopped, /^STAGE_CAP/);
  const j = rep.jobs[0];
  // (Pairing may be complete or not: since the K2 fix direct-H on wbed-r0 runs first, so which starts the cap refuses depends
  // on the order; the stop, the refusals and the spend under the cap are the point.)
  assert.ok(j.notRunCap > 0); assert.match(j.pairing, /^(incomplete|ok)/);
  assert.ok(rep.totals.spend.meterUsd <= 3.5 + 1e-9, 'the cap meter stays under the cap');
  const results = readJsonl(path.join(out, 'results.jsonl')).filter(r => r.error?.code !== 'STAGE_CAP');
  assert.ok(results.length > 0 && results.length < 48);
  assert.ok(results.reduce((a, r) => a + (r.costUsd ?? 0), 0) <= 3.5 + 1e-9, 'reported spend stays under the cap');
  assert.ok(rep.totals.notRun > 0);
});

test('K2: the wbed-r0 negative control runs first; below 10/12 on a direct-H draw the stage stops before anything else runs', async t => {
  const dir = tmp(t), out = path.join(dir, 'out');
  const runs = [{ job: 'records-lo', arms: ['direct-H'], seedRoles: ['examples', 'trainEval'] }, { job: 'wbed-r0', arms: ['direct-H'], seedRoles: ['trainEval'] }];
  const rep = await LR.labelRun({ stageId: 'NL-T', specFile: spec(dir, { runs }), workRoot: path.join(dir, 'live'), out, dry: true, enforceGates: true,
    stubForce: { call: { 'direct-H:wbed-r0:': 'wrong' } }, log: quiet });
  assert.match(rep.stopped, /^K2: direct-H on wbed-r0 0\/12, 0\/12/);
  assert.equal(readJsonl(path.join(out, 'results.jsonl')).filter(r => r.family === 'records').length, 0, 'records-lo never started');
  assert.deepEqual(rep.racing, []);
  assert.equal(LR.r0Gate([{ mode: 'direct-H', rep: 0, pass: true }], 'records-lo'), null);
  const ok = LR.r0Gate(Array.from({ length: 24 }, (_, i) => ({ mode: 'direct-H', rep: i % 2, pass: i >= 4 })), 'wbed-r0');
  assert.deepEqual(ok, { ok: true, perDraw: ['10/12', '10/12'] });
});

test('racing: an unconfident job gets one more draw per acceptable mode; decisions persist; a confident job gets none', async t => {
  const dir = tmp(t), out = path.join(dir, 'out');
  const runs = [{ job: 'records-lo', arms: ['direct-H', 'agent-H', 'agent-O'], seedRoles: ['examples', 'trainEval'] }];
  const rep = await LR.labelRun({ stageId: 'NL-T', specFile: spec(dir, { runs }), workRoot: path.join(dir, 'live'), out, dry: true, log: quiet });
  const racing = readJsonl(path.join(out, 'racing.jsonl'));
  assert.ok(racing.length >= 1); assert.deepEqual(rep.racing.map(r => r.round), racing.map(r => r.round));
  const rows = readJsonl(path.join(out, 'rows.jsonl'));
  for (const r of racing) {
    const conf = Math.max(r.pBest.workflow, r.pBest['no-workflow']);
    if (conf >= 0.8) assert.deepEqual(r.add, {}, 'confident: no top-up');
    else for (const m of Object.keys(r.add)) assert.ok(r.acceptable.includes(m));
  }
  const reps = m => Math.max(...rows.filter(r => r.mode === m).map(r => r.rep)) + 1;
  for (const m of ['direct-H', 'agent-H']) assert.ok(reps(m) >= 2 && reps(m) <= 4, `${m}: at most 4 draws`);
  // agent-O: a second draw only on tasks where its draw 1 was in the per-task acceptable set (or on all, if raced).
  const agentO = rows.filter(r => r.mode === 'agent-O');
  const second = new Set(agentO.filter(r => r.rep === 1).map(r => r.task));
  const listed = new Set(racing.flatMap(r => r.agentOTasks));
  if (!racing.some(r => r.add['agent-O'])) assert.deepEqual([...second].sort(), [...listed].sort());
  // A confident job (P = 1) is left alone.
  const plan = LR.racingPlan({ table: needTable([
    ...['a', 'b', 'c', 'd'].flatMap(task => [{ job: 'j', mode: 'direct-H', task, rep: 0, pass: true, delivered: true, usdRepriced: 0.01 }, { job: 'j', mode: 'direct-H', task, rep: 1, pass: true, delivered: true, usdRepriced: 0.01 },
      { job: 'j', mode: 'agent-H', task, rep: 0, pass: false, delivered: true, usdRepriced: 0.1 }, { job: 'j', mode: 'agent-H', task, rep: 1, pass: false, delivered: true, usdRepriced: 0.1 }])]),
  job: 'j', stages: STAGES, current: { 'direct-H': 2, 'agent-H': 2 }, labelModes: ['direct-H', 'agent-H'] });
  assert.equal(plan.pBest['no-workflow'], 1); assert.deepEqual(plan.add, {});
});

test('procedure writer: example prompts in full, inputs cut to 30K tokens in total, the schema; never answers; PROCEDURE.md capped at 1,500 words', async () => {
  const fam = await loadFamily('records');
  const examples = [601, 602, 603].map(seed => ({ task: fam.generate({ seed, split: 'dev', difficulty: 1 }) }));
  const p = LR.procedureWriterPrompt({ examples, outputSchema: fam.outputSchema });
  for (const e of examples) assert.ok(p.includes(e.task.prompt));
  assert.ok(p.includes(JSON.stringify(fam.outputSchema, null, 1)));
  const answer = JSON.stringify(fam.referenceSolve(examples[0].task));
  assert.ok(!p.includes(answer.slice(0, 200)), 'no reference answer');
  const big = [{ task: { prompt: 'p', inputs: { blob: 'x'.repeat(500000) } } }, { task: { prompt: 'q', inputs: { blob: 'y'.repeat(500000) } } }];
  const pb = LR.procedureWriterPrompt({ examples: big, outputSchema: {} });
  assert.ok(pb.length < 30000 * 4 + 5000, `${pb.length}`); assert.match(pb, /truncated: \d+ more characters/);
  const md = LR.procedureMarkdown({ procedure: 'w '.repeat(2000), checks: ['a', 'b'] });
  assert.equal(md.words, 1500); assert.equal(md.truncatedWords, 500); assert.match(md.text, /# Checks\n\n1\. a\n2\. b\n/);
});

// A stand-in for runClaudeCode: writes what a session would, returns its result shape, records the call.
function fakeSession(calls, { answer = null, checks = undefined, toolUses = [], files: write = {} } = {}) {
  return async args => {
    calls.push(args);
    mkdirSync(args.workdir, { recursive: true });
    for (const [rel, c] of Object.entries(args.files ?? {})) { mkdirSync(path.dirname(path.join(args.workdir, rel)), { recursive: true }); writeFileSync(path.join(args.workdir, rel), c); }
    if (answer !== null) writeFileSync(path.join(args.workdir, 'answer.json'), JSON.stringify(answer));
    if (checks !== undefined) writeFileSync(path.join(args.workdir, 'checks.json'), JSON.stringify(checks));
    for (const [rel, c] of Object.entries(write)) writeFileSync(path.join(args.workdir, rel), c);
    const tr = path.join(args.workdir, '.executor-transcript.jsonl');
    writeFileSync(tr, [{ type: 'assistant', message: { id: 'a', model: args.model, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } },
      { type: 'assistant', message: { id: 'a', model: args.model, usage: { input_tokens: 10, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } },
      { type: 'assistant', message: { id: 'b', usage: { input_tokens: 3, output_tokens: 1 } } }].map(x => JSON.stringify(x)).join('\n') + '\n');
    return { ok: true, error: null, costUsd: 0.01, costUnknown: false, costUpperUsd: 0.01, streamUsage: null, turns: 2, usage: null, toolUses, sessionId: 's', durationMs: 5, transcript: tr };
  };
}

test('b0Agent procedureFile: PROCEDURE.md and one prompt line, checks.json as selfVerdict; without it the arm is unchanged', async t => {
  const dir = tmp(t), proc = path.join(dir, 'PROCEDURE.md');
  writeFileSync(proc, '# Procedure\n\nDo it.\n\n# Checks\n\n1. schema\n');
  const plain = b0Agent({ id: 'agent-H', model: 'claude-haiku-5-5', budgetUsd: 2, timeoutMs: 900000 });
  assert.deepEqual(Object.keys(plain.def), ['kind', 'model', 'budgetUsd', 'timeoutMs', 'effort', 'tools', 'notesWords'], 'no new definition keys without a procedure (arm hashes of earlier runs hold)');
  const calls = [];
  const withProc = b0Agent({ id: 'agent-H+proc#1', model: 'claude-haiku-5-5', budgetUsd: 2, timeoutMs: 900000, procedureFile: proc,
    executor: fakeSession(calls, { answer: { records: [] }, checks: [{ check: 'schema', pass: true }, { check: 'rules', pass: false }],
      toolUses: [{ name: 'Bash', input: { command: 'cat /home/user/secret ./inputs.json' } }, { name: 'Bash', input: { command: 'claude -p hi' } }] }) });
  assert.match(withProc.def.procedureSha, /^[0-9a-f]{16}$/); assert.match(withProc.def.procedureLineSha, /^[0-9a-f]{16}$/);
  const task = { prompt: 'Extract the records.', inputs: { a: 1 } };
  const r = await withProc.run({ task, familyId: 'records', outputSchema: { type: 'object' }, workdir: path.join(dir, 'w'), state: {} });
  assert.equal(calls[0].files['PROCEDURE.md'], readFileSync(proc, 'utf8'));
  assert.ok(calls[0].prompt.endsWith(`\n\n${PROCEDURE_LINE}`)); assert.ok(calls[0].prompt.startsWith('Extract the records.'));
  assert.deepEqual(r.output, { records: [] }); assert.equal(r.meta.selfVerdict, 'fail'); assert.equal(r.meta.checks, 2);
  assert.equal(r.meta.nestedModelAttempts, 1); assert.equal(r.meta.hiddenPathAttempts, 1); assert.deepEqual(r.meta.outsidePaths, ['/home/user/secret']);
  assert.deepEqual(r.meta.messageUsage, [[10, 7, 100, 0, 'claude-haiku-5-5'], [3, 1, 0, 0, null]], 'one entry per message id, its last usage');
  const calls2 = [];
  const r2 = await b0Agent({ id: 'agent-H', model: 'claude-haiku-5-5', executor: fakeSession(calls2, { answer: { x: 1 } }) }).run({ task, familyId: 'records', outputSchema: { type: 'object' }, workdir: path.join(dir, 'w2'), state: {} });
  assert.equal(calls2[0].files['PROCEDURE.md'], undefined); assert.ok(!calls2[0].prompt.includes('PROCEDURE.md'));
  assert.equal('selfVerdict' in r2.meta, false);
  assert.equal(checksVerdict([{ pass: true }, { pass: true }]), 'pass'); assert.equal(checksVerdict({ a: true, b: false }), 'fail');
  for (const bad of [null, [], [{ pass: 'yes' }], 'x']) assert.equal(checksVerdict(bad), null);
  assert.deepEqual(outsidePaths([{ input: { command: 'ls /etc/ssh /var/tmp/w/x /tmp/y' } }], ['/var/tmp/w']).paths, ['/etc/ssh']);
});

test('construct selfCheck: one prompt paragraph, check.mjs recorded, per-seed probe difficulty, dev probes only; C0 callers unchanged', async t => {
  const dir = tmp(t);
  const { port } = { port: LR.stubPorts({ tasks: [], models: ['claude-haiku-5-5'] }).model };
  const fam = await loadFamily('records');
  const calls = [];
  const common = { arm: 'B1', familyId: 'records', builderModel: 'claude-haiku-5-5', builderBudgetUsd: 3, constructionModelUsd: 1.5, perTaskUsd: 1, minutes: 30, scoreChecks: 0,
    modelPort: port, models: ['claude-haiku-5-5'], kitBase: path.join(dir, 'kit') };
  const exec = fakeSession(calls, { files: { 'solve.mjs': 'process.stdout.write("{}")', 'check.mjs': 'process.exit(0)' },
    toolUses: [{ name: 'Bash', input: { command: './tools/run-solver probes/probe-0' } }, { name: 'Bash', input: { command: './tools/run-solver probes/probe-1 > a.json' } }] });
  const probeSeeds = [{ seed: 604, difficulty: 2 }, { seed: 605, difficulty: 1 }];
  const res = await construct({ ...common, probeSeeds, workRoot: dir, label: 'L1', selfCheck: true, executor: exec });
  assert.ok(calls[0].prompt.endsWith(SELF_CHECK_PARAGRAPH));
  assert.equal(res.record.check, 'check.mjs'); assert.match(res.record.checkSha256, /^[0-9a-f]{64}$/); assert.equal(res.checkPath, path.join(dir, 'L1', 'check.mjs'));
  assert.equal(res.record.runSolverCalls, 2); assert.equal(res.record.difficulty, null); assert.deepEqual(res.record.probeSeeds, probeSeeds);
  assert.deepEqual(res.record.builderMessageUsage, messageUsageOf(path.join(dir, 'L1', '.executor-transcript.jsonl')));
  for (const [i, p] of probeSeeds.entries()) {
    const want = fam.generate({ seed: p.seed, split: 'dev', difficulty: p.difficulty });
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'L1', `probes/probe-${i}/task.json`), 'utf8')).inputs, want.inputs, 'each probe at its own difficulty');
  }
  // Without selfCheck: the C0 prompt exactly (its sha is pre-registered), no check recorded even if a file is there.
  const calls2 = [];
  const res2 = await construct({ ...common, probeSeeds: [1, 2], difficulty: 3, workRoot: dir, label: 'L2', executor: fakeSession(calls2, { files: { 'solve.mjs': 'x', 'check.mjs': 'y' } }) });
  assert.ok(!calls2[0].prompt.includes('check.mjs')); assert.equal(res2.record.check, null); assert.equal(res2.record.selfCheck, false); assert.equal(res2.record.difficulty, 3);
  assert.equal(calls2[0].prompt, builderPrompt('B1', { probes: 2, minutes: 30, constructionModelUsd: 1.5, perTaskUsd: 1, scoreChecks: 0, models: ['claude-haiku-5-5'],
    classes: res2.record.models.map(id => `${port.policy.models.find(m => m.id === id).class} = ${id}`).join(', '), kitDir: res2.record.kitDir }));
  await assert.rejects(construct({ ...common, probeSeeds: [{ seed: 8801, difficulty: 3, split: 'test' }], workRoot: dir, label: 'L3', executor: exec }), /dev split only/);
  await assert.rejects(construct({ ...common, arm: 'F', probeSeeds: [1], workRoot: dir, label: 'L4', selfCheck: true, executor: exec }), /B1 arm only/);
  // The kev-data C7 baseline reads construct()'s hidden-path closure as text: it must still be there, unchanged in shape.
  assert.doesNotThrow(() => loadHiddenPathDetector());
});

test('runSelfCheck: exit 0 pass, 1 fail, anything else error; no answer, no check; a launch failure is recorded', async t => {
  const dir = tmp(t), check = path.join(dir, 'check.mjs');
  writeFileSync(check, 'process.exit(0)');
  const task = { prompt: 'p', inputs: { n: 1 } };
  const runner = code => async ({ command, args, workdir, network }) => {
    assert.equal(command, 'node'); assert.deepEqual(args, ['check.mjs', 'task.json', 'answer.json']); assert.equal(network, false);
    assert.deepEqual(JSON.parse(readFileSync(path.join(workdir, 'answer.json'), 'utf8')), { v: 1 });
    assert.ok(existsSync(path.join(workdir, 'task.json')) && existsSync(path.join(workdir, 'check.mjs')));
    return code === 'timeout' ? { code: null, timedOut: true, sandboxReady: true, stderr: '' } : { code, timedOut: false, sandboxReady: true, stderr: '' };
  };
  const v = async c => (await runSelfCheck({ checkPath: check, task, output: { v: 1 }, workdir: dir, runner: runner(c) })).selfVerdict;
  assert.equal(await v(0), 'pass'); assert.equal(await v(1), 'fail'); assert.equal(await v(2), 'error'); assert.equal(await v('timeout'), 'error');
  assert.equal((await runSelfCheck({ checkPath: check, task, output: null, workdir: dir })).selfVerdict, null);
  const thrown = await runSelfCheck({ checkPath: check, task, output: { v: 1 }, workdir: dir, runner: async () => { throw Object.assign(new Error('no ns'), { code: 'SANDBOX_UNAVAILABLE' }); } });
  assert.deepEqual([thrown.selfVerdict, thrown.error.code], [null, 'SANDBOX_UNAVAILABLE']);
});

test('runSelfCheck in the real sandbox: the check reads task.json and answer.json, has no network', { skip: sandboxAvailable() ? false : 'no user namespaces' }, async t => {
  const dir = path.join('/var/tmp/foundry-work', `label-run-test-${process.pid}`);
  mkdirSync(dir, { recursive: true }); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const check = path.join(dir, 'check.mjs');
  writeFileSync(check, `import { readFileSync } from 'node:fs';
const task = JSON.parse(readFileSync(process.argv[2], 'utf8')), ans = JSON.parse(readFileSync(process.argv[3], 'utf8'));
let net = false; try { await fetch('http://example.com', { signal: AbortSignal.timeout(2000) }); net = true; } catch {}
process.exit(!net && ans.n === task.inputs.n ? 0 : 1);`);
  const task = { prompt: 'p', inputs: { n: 7 } };
  assert.equal((await runSelfCheck({ checkPath: check, task, output: { n: 7 }, workdir: path.join(dir, 'a') })).selfVerdict, 'pass');
  assert.equal((await runSelfCheck({ checkPath: check, task, output: { n: 8 }, workdir: path.join(dir, 'b') })).selfVerdict, 'fail');
});
