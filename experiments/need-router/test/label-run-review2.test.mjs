// label-run.mjs: regression tests for the second adversarial review of the label harness (2026-10-15). One test (or more)
// per fixed defect: a --dry run's stub outcomes never become paid labels (run kinds in stamps, arm hashes, the spend ledger,
// plan and report; --dry never writes under the runs directory or the paid work root); held-out --dry reads the Freeze from
// the committed preregistration; a stage is paid for once across directories (STAGE_ALREADY_RUN); jobs.json for
// evaluate.mjs; build rows carry `repriced`; racing lineage top-ups name the lowest missing lineage and log a no-op.
// $0: stub ports only (no model, no claude binary); work roots are temporary directories.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as LR from '../label-run.mjs';
import { STAGES_FILE, PREREG_FILE, aFreezeShas, heldoutDryRefusal } from '../prereg-check.mjs';
import { needTable } from '../metrics.mjs';
import { armHash } from '../../lib/runner.mjs';
import { b0Call } from '../../lib/arms/b0-call.mjs';
import { WHITELIST } from '../features.mjs';

const tmp = t => { const d = mkdtempSync(path.join(tmpdir(), 'label-run-review2-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []);
const STAGES = JSON.parse(readFileSync(STAGES_FILE, 'utf8'));
const PREREG_TEXT = readFileSync(PREREG_FILE, 'utf8');
const quiet = () => {};
const sha256 = s => createHash('sha256').update(s).digest('hex');
function spec(dir, { runs, capUsd = 400, approved = false, status = 'draft', jobs = ['records-lo', 'wbed-r0'], name = 'spec.json' } = {}) {
  const doc = { ...STAGES, status, jobs: STAGES.jobs.filter(j => jobs.includes(j.id)), stages: [{ id: 'NL-T', grade: 'development', estUsd: 1, capUsd, approved, runs }] };
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify(doc, null, 1));
  return file;
}
const R0_DIRECT = [{ job: 'wbed-r0', arms: ['direct-H'], seedRoles: ['trainEval'] }];
const cleanStamp = stage => ({ labelEngine: { stage, commit: 'c0ffee', dirty: 0, files: {}, trees: {}, beds: {}, prereg: {}, ledgerNeed: null, node: process.version }, analysis: { files: {} }, documents: {} });
/** A frozen, approved spec stage whose sha256 the (test) preregistration lists: what a paid run of NL-T needs (stub ports). */
function paidSpec(dir, { runs, capUsd = 400, name = 'paid-spec.json' } = {}) {
  const file = spec(dir, { runs, capUsd, approved: true, status: 'frozen', name });
  const text = `${PREREG_TEXT}\n<!-- test addendum: spec ${sha256(readFileSync(file))} -->\n`, prereg = path.join(dir, `${name}.prereg.md`);
  writeFileSync(prereg, text);
  const paidDeps = { preregFile: prereg, frozenSha: () => sha256(text), checkStagesFn: () => ({ errors: [], warnings: [] }), stampOf: () => cleanStamp('NL-T'),
    meterGate: () => ({ schema: 'need-meter-gate/1', status: 'clear', reasons: [] }), meterVerification: () => null };
  return { file, prereg, paidDeps };
}
/** Live-kind ports that fail on any use: a paid run that reaches them would be a live call. */
function trapPorts() {
  const calls = { n: 0 };
  const boom = () => { calls.n += 1; throw Object.assign(new Error('LIVE CALL'), { code: 'LIVE' }); };
  return { calls, ports: { kind: 'live', model: { policy: null, policyHash: null, providers: {}, journal: null, timeoutMs: 1, call: async () => boom() },
    executor: async () => boom(), script: () => boom(), selfCheck: async () => boom(), kitBase: null, close() {} } };
}

// ------------------------------------------------------------------------------- blocker: --dry then paid on one directory
test('blocker: a paid run over the work root and --out a --dry run used is refused before any call; stub records carry ports in stamp and arm hash', async t => {
  const dir = tmp(t), live = path.join(dir, 'live'), out = path.join(dir, 'out');
  // The reviewer's sequence: NL0 --dry, then the same --work-root and --out without --dry.
  const base = { stageId: 'NL0', stagesFile: STAGES_FILE, workRoot: live, out, jobs: ['wbed-r0'], arms: ['direct-H'], racing: false, log: quiet };
  const d = await LR.labelRun({ ...base, dry: true });
  assert.equal(d.totals.rows, 24); assert.equal(d.dry, true); assert.equal(d.ports, 'stub');
  // Every record says it was made on stub ports: the stamp, the spend ledger, plan.json; the stub arm's runtime hash differs from the live arm's.
  const rows = readJsonl(path.join(out, 'rows.jsonl'));
  assert.ok(rows.every(r => r.stamp?.ports === 'stub'));
  const def = STAGES.arms['direct-H'], liveArm = b0Call({ id: 'direct-H', model: def.model, modelPort: null, reasoning: def.reasoning, maxTokens: def.maxTokens });
  assert.ok(rows.every(r => r.armHash === armHash({ id: 'direct-H', def: { ...liveArm.def, ports: 'stub' } }) && r.armHash !== armHash(liveArm)), 'strictResume refuses a live arm over stub trials');
  assert.ok(readJsonl(path.join(live, LR.SPEND_FILE)).every(e => e.dry === true && e.ports === 'stub'));
  assert.equal(JSON.parse(readFileSync(path.join(out, LR.PLAN_FILE), 'utf8')).dry, true);
  const { calls, ports } = trapPorts();
  const paidDeps = { stampOf: () => cleanStamp('NL0'), frozenSha: () => sha256(PREREG_TEXT), meterGate: () => ({ schema: 'need-meter-gate/1', status: 'clear', reasons: [] }), meterVerification: () => null };
  const before = readFileSync(path.join(out, 'report.json'));
  await assert.rejects(LR.labelRun({ ...base, dry: false, prereg: PREREG_FILE, allowDraft: true, deviation: 'test', ports, paidDeps, enforceGates: false, stageRoots: [] }),
    e => e.code === 'RUN_KIND_MIXED' && /--dry run's report/.test(e.message) && /no STAMP\.json/.test(e.message) && /--dry run \(or of a run that recorded no kind\)/.test(e.message));
  assert.equal(calls.n, 0, 'no live call'); assert.ok(readFileSync(path.join(out, 'report.json')).equals(before), 'nothing rewritten');
  assert.equal(existsSync(path.join(out, LR.STAMP_FILE)), false, 'no paid stamp written over --dry files');
  // Only the --out was reused (a fresh work root): refused on the --out's files.
  await assert.rejects(LR.labelRun({ ...base, workRoot: path.join(dir, 'live2'), dry: false, prereg: PREREG_FILE, allowDraft: true, deviation: 'test', ports, paidDeps, enforceGates: false, stageRoots: [] }),
    e => e.code === 'RUN_KIND_MIXED' && e.message.includes(path.join(out, 'report.json')));
  assert.equal(calls.n, 0);
});

test('blocker: defence in depth: --dry trials copied beside a paid stamp are refused by the record stamps (ports), before any call', async t => {
  const dir = tmp(t), dryLive = path.join(dir, 'dry-live');
  await LR.labelRun({ stageId: 'NL0', stagesFile: STAGES_FILE, workRoot: dryLive, out: path.join(dir, 'dry-out'), jobs: ['wbed-r0'], arms: ['direct-H'], racing: false, log: quiet, dry: true });
  // A work root that looks paid (STAMP.json beside the records, no --dry report, plan or spend): only the records' own kind is left to catch it.
  const live = path.join(dir, 'live'), out = path.join(dir, 'out');
  mkdirSync(live, { recursive: true }); mkdirSync(out, { recursive: true });
  copyFileSync(path.join(dryLive, 'results.jsonl'), path.join(live, 'results.jsonl'));
  for (const d of [live, out]) writeFileSync(path.join(d, LR.STAMP_FILE), JSON.stringify(cleanStamp('NL0')));
  const { calls, ports } = trapPorts();
  const paidDeps = { stampOf: () => cleanStamp('NL0'), frozenSha: () => sha256(PREREG_TEXT), meterGate: () => ({ schema: 'need-meter-gate/1', status: 'clear', reasons: [] }), meterVerification: () => null };
  await assert.rejects(LR.labelRun({ stageId: 'NL0', stagesFile: STAGES_FILE, workRoot: live, out, jobs: ['wbed-r0'], arms: ['direct-H'], racing: false, log: quiet, prereg: PREREG_FILE,
    allowDraft: true, deviation: 'test', ports, paidDeps, enforceGates: false, stageRoots: [] }), e => e.code === 'RESUME_MIXES_VERSIONS' && /trial wbed-r0\/direct-H\//.test(e.message));
  assert.equal(calls.n, 0);
  // recordStamp names the kind; two stamps of different kinds never compare equal.
  const ctx = { stages: STAGES, stageSha: 'x', prompts: {}, portKind: 'stub' };
  assert.equal(LR.recordStamp(ctx, 'direct-H').ports, 'stub');
  assert.notDeepEqual(LR.recordStamp(ctx, 'direct-H'), LR.recordStamp({ ...ctx, portKind: 'live' }, 'direct-H'));
});

test('blocker: --dry never writes under the runs directory nor on the paid work root, and never into a paid run\'s directories', async t => {
  const dir = tmp(t), file = spec(dir, { runs: R0_DIRECT });
  const inRuns = path.join(LR.OUT_ROOT, `nl-t-review2-${process.pid}`);
  await assert.rejects(LR.labelRun({ stageId: 'NL-T', specFile: file, workRoot: path.join(dir, 'w'), out: inRuns, dry: true, racing: false, log: quiet }), e => e.code === 'DRY_OUT_IN_RUNS');
  assert.equal(existsSync(inRuns), false); assert.equal(existsSync(path.join(dir, 'w')), false);
  const paidRoot = path.join(LR.LIVE_ROOT, 'nl-t');
  const had = existsSync(paidRoot);
  await assert.rejects(LR.labelRun({ stageId: 'NL-T', specFile: file, workRoot: paidRoot, dry: true, racing: false, log: quiet }), e => e.code === 'DRY_ON_PAID_WORK_ROOT');
  assert.equal(existsSync(paidRoot), had, 'nothing created');
  // A paid run's directories (stub ports here) are refused to a later --dry run.
  const { file: pf, prereg, paidDeps } = paidSpec(dir, { runs: R0_DIRECT });
  const live = path.join(dir, 'live'), out = path.join(dir, 'out');
  const p = await LR.labelRun({ stageId: 'NL-T', specFile: pf, prereg, workRoot: live, out, ports: 'stub', paidDeps, racing: false, enforceGates: false, log: quiet, stageRoots: [] });
  assert.equal(p.dry, false); assert.ok(existsSync(path.join(out, LR.STAMP_FILE)));
  assert.ok(readJsonl(path.join(out, LR.SPEND_FILE)).every(e => e.dry === false && e.ports === 'stub'));
  await assert.rejects(LR.labelRun({ stageId: 'NL-T', specFile: pf, workRoot: live, out, dry: true, racing: false, log: quiet }),
    e => e.code === 'RUN_KIND_MIXED' && /holds a paid run's STAMP\.json and LAUNCH\.json/.test(e.message) && /entries of a paid run/.test(e.message));
  // The kind check itself: no problem on clean or same-kind directories.
  assert.deepEqual(LR.runKindProblems({ dirs: [live, out], stageId: 'NL-T', dry: false, ports: 'stub' }), []);
  assert.equal(LR.runKindProblems({ dirs: [live, out], stageId: 'NL-T', dry: false, ports: 'live' }).length, 1);
  assert.deepEqual(LR.runKindProblems({ dirs: [path.join(dir, 'none')], stageId: 'NL-T', dry: true, ports: 'stub' }), []);
});

// ------------------------------------------------------------------------------ major: held-out seeds from a $0 dev path
test('major: --dry on a held-out stage reads the Freeze from the committed preregistration: a --prereg file with an A-Freeze row does not open it', async t => {
  const dir = tmp(t);
  const frozen = PREREG_TEXT.replace(/^\|\s*A-Freeze \(analysis stamp\)\s*\|[^\n]*/m, `| A-Freeze (analysis stamp) | \`router.mjs\` \`${'a'.repeat(64)}\` |`);
  assert.ok(aFreezeShas(frozen), 'the edited text carries a filled A-Freeze row');
  const units = LR.stageUnits(STAGES, STAGES.stages.find(s => s.id === 'NL2'), { jobs: ['synth-lo'], arms: ['direct-H'] }).units;
  assert.equal(heldoutDryRefusal({ units, preregText: frozen }), null, 'that text would allow it');
  const fake = path.join(dir, 'PREREG-frozen.md');
  writeFileSync(fake, frozen);
  // The reviewer's command: --stage NL2 --dry --jobs synth-lo --arms direct-H --no-racing, now also with that --prereg.
  for (const prereg of [null, fake]) {
    await assert.rejects(LR.labelRun({ stageId: 'NL2', stagesFile: STAGES_FILE, prereg, workRoot: path.join(dir, 'w'), out: path.join(dir, 'o'), dry: true, jobs: ['synth-lo'], arms: ['direct-H'], racing: false, log: quiet }),
      e => e.code === 'HELDOUT_DRY_REFUSED', String(prereg));
    assert.equal(existsSync(path.join(dir, 'w')), false, 'refused before any work root or task');
  }
  // committedPrereg reads the HEAD blob only.
  assert.equal(LR.committedPrereg(PREREG_FILE, { show: () => Buffer.from('committed text') }), 'committed text');
  assert.equal(LR.committedPrereg(PREREG_FILE, { show: () => null }), null);
});

// -------------------------------------------------------------------------------------- major: a stage is paid for once
test('major: a paid stage that ran to its cap cannot run again with a fresh --out and work root (STAGE_ALREADY_RUN); a --dry run beside it does not count', async t => {
  const dir = tmp(t), runsDir = path.join(dir, 'runs'), workDir = path.join(dir, 'work');
  // The cap admits exactly one start: every direct-H call times out, so each start is charged its $1 bound; the second does not
  // fit under $1.50. (A cap below the $1 bound would admit none and leave no spend-ledger evidence.)
  const { file, prereg, paidDeps } = paidSpec(dir, { runs: R0_DIRECT, capUsd: 1.5 });
  // A --dry run of the same stage beside it (its own work root and --out): no paid evidence.
  await LR.labelRun({ stageId: 'NL-T', specFile: file, workRoot: path.join(workDir, 'nl-t-dry'), out: path.join(runsDir, 'nl-t-dry'), dry: true, racing: false, log: quiet });
  const A = { stageId: 'NL-T', specFile: file, prereg, ports: 'stub', paidDeps, racing: false, enforceGates: false, log: quiet, stubForce: { call: { 'direct-H': 'timeout' } } };
  const a = await LR.labelRun({ ...A, workRoot: path.join(workDir, 'nl-t'), out: path.join(runsDir, 'nl-t') });
  assert.match(a.stopped, /^STAGE_CAP/); assert.equal(a.totals.spend.meterUsd, 1, 'one start, charged at its $1 bound');
  const paidEntries = readJsonl(path.join(runsDir, 'nl-t', LR.SPEND_FILE)).filter(e => e.op === 'settle' && e.dry === false);
  assert.equal(paidEntries.length, 1, 'the ledger holds the paid start');
  // B: a fresh --out and a fresh work root, the same stage: its meter would start at $0.
  const B = { ...A, workRoot: path.join(workDir, 'nl-t-again'), out: path.join(runsDir, 'nl-t-again') };
  await assert.rejects(LR.labelRun(B), e => e.code === 'STAGE_ALREADY_RUN' && e.found.length === 2
    && e.found.every(f => f.dir.endsWith(`${path.sep}nl-t`) && f.evidence.includes(LR.LAUNCH_FILE) && f.evidence.some(x => x.startsWith(LR.SPEND_FILE))));
  assert.equal(existsSync(B.workRoot), false); assert.equal(existsSync(B.out), false);
  // Resuming A in its own directories is allowed (it stops at the cap again, spending nothing more).
  const a2 = await LR.labelRun({ ...A, workRoot: path.join(workDir, 'nl-t'), out: path.join(runsDir, 'nl-t') });
  assert.equal(a2.totals.spend.meterUsd, a.totals.spend.meterUsd);
  // The evidence rule on its own: --dry directories carry none; a legacy spend ledger with no kind counts.
  assert.deepEqual(LR.paidStageEvidence(path.join(runsDir, 'nl-t-dry'), 'NL-T'), []);
  const legacy = path.join(dir, 'legacy');
  mkdirSync(legacy);
  writeFileSync(path.join(legacy, LR.SPEND_FILE), JSON.stringify({ stage: 'NL-T', op: 'settle', id: 'x', charged: 1 }) + '\n');
  assert.deepEqual(LR.paidStageEvidence(legacy, 'NL-T'), [`${LR.SPEND_FILE} (1 entry)`]);
  assert.deepEqual(LR.paidStageEvidence(legacy, 'NL-U'), []);
});

// --------------------------------------------------------------------------- major: jobs.json for the analysis pipeline
test('major: label-run writes jobs.json, so evaluate.mjs loads the stage (end to end from --dry output: rows, builds, L4 seed checks)', async t => {
  const { loadLabels, seedChecks, publicView } = await import('../evaluate.mjs');
  const dir = tmp(t), root = path.join(dir, 'runs'), out = path.join(root, 'nl-t');
  const runs = [{ job: 'records-lo', arms: ['direct-H', 'construct-H'], seedRoles: ['examples', 'trainEval'] }, ...R0_DIRECT];
  const rep = await LR.labelRun({ stageId: 'NL-T', specFile: spec(dir, { runs }), workRoot: path.join(dir, 'live'), out, dry: true, racing: false, log: quiet, stubForce: { builder: { 'construct-H-L': 'ok' } } });
  const J = JSON.parse(readFileSync(path.join(out, LR.JOBS_FILE), 'utf8'));
  assert.deepEqual(Object.keys(J), ['records-lo', 'wbed-r0']);
  for (const [id, m] of Object.entries(J)) {
    const job = STAGES.jobs.find(j => j.id === id);
    assert.equal(m.cluster, job.cluster); assert.equal(m.split, 'train'); assert.equal(m.family, job.family); assert.deepEqual(m.modes, job.modes); assert.deepEqual(m.band, job.band);
    assert.equal(m.verifier, job.verifier); assert.deepEqual(m.requirements, []); assert.equal(typeof m.kind, 'string');
    assert.deepEqual(m.exampleSeeds, [601, 602, 603, 604, 605, 606, 607, 608, 609]); assert.equal(m.exampleHashes.length, 9);
    assert.deepEqual(m.featureSeeds, [601, 602, 603]);
    assert.deepEqual(Object.keys(m.features).sort(), [...WHITELIST].sort()); assert.ok(Object.values(m.features).every(Number.isFinite));
  }
  // evaluate.loadLabels opens the stage directory (it reads only directories holding jobs.json) and finds every row and build.
  const L = loadLabels(root);
  assert.deepEqual(L.stages, [path.relative(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..'), out)]);
  assert.equal(L.rows.length, rep.totals.rows); assert.equal(L.builds.length, rep.totals.builds);
  assert.equal(L.stageInfo[0].priceTable, STAGES.priceTable.id);
  const table = needTable(L.rows, L.builds.map(b => ({ ...b, usd: b.usdRepriced })));
  const sc = seedChecks(table, L.meta);
  assert.equal(sc.ok, true, sc.problems.join('; '));
  // The public view carries the trusted structure features, never the family.
  const v = publicView('records-lo', L.meta['records-lo'], ['direct-H']);
  assert.ok(Object.keys(v.features).length >= 8); assert.equal(v.family, undefined);
  // A resume writes the same jobs.json; a changed description is refused.
  await LR.labelRun({ stageId: 'NL-T', specFile: path.join(dir, 'spec.json'), workRoot: path.join(dir, 'live'), out, dry: true, racing: false, log: quiet, stubForce: { builder: { 'construct-H-L': 'ok' } } });
  assert.deepEqual(JSON.parse(readFileSync(path.join(out, LR.JOBS_FILE), 'utf8')), J);
  assert.throws(() => LR.writeJobsRecord({ files: [path.join(out, LR.JOBS_FILE)], entries: [['wbed-r0', { ...J['wbed-r0'], modes: ['direct-H'] }]] }), e => e.code === 'JOBS_CHANGED');
});

test('major: jobsEntry maps stages.json splits to evaluate.mjs splits (conditional held-out, forced) and keeps the declared menu and requirements', () => {
  const plan = { exampleSeeds: [601], exampleHashes: ['h'], features: { logInputTokens: 1 }, featureSeeds: [601] };
  const job = id => STAGES.jobs.find(j => j.id === id);
  const runbook = LR.jobsEntry(job('runbook'), plan), gameqa = LR.jobsEntry(job('gameqa'), plan), r3p = LR.jobsEntry(job('r3p'), plan), rec = LR.jobsEntry(job('records-hi'), plan);
  assert.equal(runbook.split, 'heldout'); assert.equal(runbook.forced, true); assert.deepEqual(runbook.requirements, job('runbook').requirements);
  assert.equal(gameqa.split, 'heldout'); assert.deepEqual(gameqa.modes, ['agent-H', 'agent-O', 'agent-H+proc', 'construct-H'], 'direct-H masked by the menu');
  assert.equal(r3p.near, true); assert.equal(rec.split, 'train'); assert.equal(rec.forced, undefined);
  assert.equal(rec.tolerance, undefined, 'only a { scoreThreshold } tolerance is evaluate\'s shape');
});

// ------------------------------------------------------------------------------------------- minor: build rows repriced
test('minor: build rows carry repriced; a builder priced from the CLI figure is listed in report.validity and its job stays unlabelled', async t => {
  const dir = tmp(t), out = path.join(dir, 'out');
  const runs = [{ job: 'records-lo', arms: ['agent-H+proc', 'construct-H'], seedRoles: ['examples', 'trainEval'] }];
  const rep = await LR.labelRun({ stageId: 'NL-T', specFile: spec(dir, { runs }), workRoot: path.join(dir, 'live'), out, dry: true, racing: false, log: quiet,
    stubForce: { builder: { 'construct-H-L1': 'ok', 'construct-H-L2': 'unpriced', 'construct-H-L3': 'ok' } } });
  const builds = readJsonl(path.join(out, 'builds.final.jsonl')), b = (m, k) => builds.find(x => x.mode === m && x.lineage === k);
  assert.equal(b('construct-H', 1).repriced, true); assert.equal(b('construct-H', 2).repriced, false); assert.equal(b('agent-H+proc', 1).repriced, true);
  assert.deepEqual(rep.validity.notRepricedBuilds, ['records-lo/construct-H#2']);
  assert.match(readFileSync(path.join(out, 'report.txt'), 'utf8'), /builds not re-priced from tokens \(their jobs stay unlabelled\): records-lo\/construct-H#2/);
  const table = needTable(readJsonl(path.join(out, 'rows.jsonl')), builds.map(x => ({ ...x, usd: x.usdRepriced })));
  assert.ok(table.cell('records-lo', 'construct-H').notRepriced > 0, 'metrics counts the build off the meter');
  // The writer call: priced from the table, or at its own figure for a model the table does not price.
  const P = STAGES.priceTable, u = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };
  assert.equal(LR.meterOf({ kind: 'call', priceTable: P, bound: 1, r: { costUsd: 0.01 }, calls: [{ modelId: 'claude-haiku-5-5', usage: u, costUsd: 0.01 }] }).repriced, true);
  assert.equal(LR.meterOf({ kind: 'call', priceTable: P, bound: 1, r: { costUsd: 0.01 }, calls: [{ modelId: 'gpt-x', usage: u, costUsd: 0.01 }] }).repriced, false);
  assert.equal(LR.meterOf({ kind: 'call', priceTable: P, bound: 1, r: { costUsd: 0.01 }, calls: [] }).repriced, false, 'a reported figure with no recorded call');
  assert.equal(LR.meterOf({ kind: 'session', priceTable: P, model: 'claude-haiku-5-5', bound: 2, r: { costUsd: 0.2, meta: {} } }).repriced, false, 'a session with no usage record');
});

// ------------------------------------------------------------------------------------- minor: racing lineage top-ups
test('minor: a racing lineage top-up builds the lowest lineage with no build row; a top-up that leaves no row is logged unbuilt, not counted', async t => {
  assert.deepEqual(LR.lineageTopUp([{ mode: 'construct-H', lineage: 1 }, { mode: 'construct-H', lineage: 3 }, { mode: 'agent-H+proc', lineage: 2 }], 'construct-H'), { count: 2, next: 2 });
  assert.deepEqual(LR.lineageTopUp([1, 2, 3].map(lineage => ({ mode: 'construct-H', lineage })), 'construct-H'), { count: 3, next: 4 });
  assert.deepEqual(LR.lineageTopUp([], 'construct-H'), { count: 0, next: 1 });
  // racingPlan takes the lineage number from `next` (draw modes keep current + 1).
  const rows = [], tasks = Array.from({ length: 4 }, (_, i) => `t${i}`);
  for (const t of tasks) for (const rep of [0, 1]) rows.push({ job: 'j', mode: 'agent-H', task: t, rep, pass: (t === 't0') === (rep === 0), delivered: true, schemaValid: true, usdRepriced: 0.01, usdImputed: 0, armHash: 'a' });
  for (const t of tasks) for (const k of [1, 3]) rows.push({ job: 'j', mode: 'construct-H', arm: `construct-H#${k}`, task: t, rep: k - 1, lineage: k, pass: t !== 't1', delivered: true, schemaValid: true, usdRepriced: 0.01, usdImputed: 0, armHash: `c${k}` });
  const builds = [1, 3].map(k => ({ job: 'j', mode: 'construct-H', rep: k - 1, lineage: k, usd: 0.01, usdRepriced: 0.01, failed: false }));
  const table = needTable(rows, builds);
  const p = LR.racingPlan({ table, job: 'j', stages: { ...STAGES, reps: { labelBootstrap: 200 } }, current: { 'agent-H': 2, 'construct-H': 2 }, next: { 'construct-H': 2 }, labelModes: ['agent-H', 'construct-H'] });
  if (p.add['construct-H'] !== undefined) assert.equal(p.add['construct-H'], 2, 'the missing lineage, not count + 1 = 3 (which exists)');
  if (p.add['agent-H'] !== undefined) assert.equal(p.add['agent-H'], 3);
  // End to end: lineage 2 faulted (environment) in the first pass; a recorded racing round asks for it again; it faults again:
  // the round logs it as unbuilt, adds nothing, and the report says so.
  const dir = tmp(t), live = path.join(dir, 'live'), out = path.join(dir, 'out');
  const file = spec(dir, { runs: [{ job: 'records-lo', arms: ['construct-H'], seedRoles: ['examples', 'trainEval'] }] });
  const stubForce = { builder: { 'construct-H-L2': 'envfault', 'construct-H-L1': 'ok', 'construct-H-L3': 'ok' } };
  await LR.labelRun({ stageId: 'NL-T', specFile: file, workRoot: live, out, dry: true, racing: false, log: quiet, stubForce });
  assert.deepEqual(readJsonl(path.join(live, 'builds.jsonl')).map(b => b.lineage).sort(), [1, 3]);
  const plan = LR.loadPlan({ stageId: 'NL-T', specFile: file });
  const stamp = LR.recordStamp({ stages: plan.stages, stageSha: LR.stageSha(plan.stages, plan.stage), prompts: LR.promptShas(), portKind: 'stub' });
  writeFileSync(path.join(live, 'racing.jsonl'), JSON.stringify({ stage: 'NL-T', round: 1, job: 'records-lo', pBest: null, label: 'either', acceptable: ['construct-H'], add: { 'construct-H': 2 }, agentOTasks: [], stamp }) + '\n');
  const rep = await LR.labelRun({ stageId: 'NL-T', specFile: file, workRoot: live, out, dry: true, racing: true, log: quiet, stubForce });
  const r1 = rep.racing.find(r => r.round === 1);
  assert.deepEqual(r1.unbuilt, ['construct-H#2']);
  assert.equal(rep.racing.some(r => r.round === 2), false, 'nothing was added, so no second round');
  assert.match(readFileSync(path.join(out, 'report.txt'), 'utf8'), /not built \(no row: fault or cap\): construct-H#2/);
  assert.equal(rep.totals.constructionFaults, 3, 'lineage 2 tried three times (first pass, resume of the first pass, the top-up), each set aside');
});
