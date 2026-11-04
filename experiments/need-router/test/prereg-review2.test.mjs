// Regression tests for the second adversarial review of PREREG-NEED-V1.md (2026-10-15, §13 D9): one test or more per
// defect, each failing on the code and files before the fix. $0: no model, no network; no held-out task is generated.
//   node --test experiments/need-router/test/prereg-review2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadLedger } from '../../jit/seeds.mjs';
import { canonical, sha256 } from '../../../beds/lib/canonical.mjs';
import {
  STAGES_FILE, PREREG_FILE, POLICY_FILE, checkStages, sectionOf, aFreezeShas, envelopeLaunchCheck, launchJobsOf, heldoutDryRefusal,
  e2eDraw,
} from '../prereg-check.mjs';
import { c7aReading, c7aPower, c7aMinimumCounts, powerGate, missingDataRule, C7A_USEFUL, NEAR_CLUSTERS } from '../prereg-rules.mjs';
import { needTable, needLabels, makeCell, cellStats } from '../metrics.mjs';
import { verifyEnvelope, envelopeProvenance, loadLabels, ROUTER_FILES } from '../evaluate.mjs';
import * as LR from '../label-run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../../..');
const STAGES = JSON.parse(readFileSync(STAGES_FILE, 'utf8'));
const TEXT = readFileSync(PREREG_FILE, 'utf8');
const ledger = loadLedger();
const policy = JSON.parse(readFileSync(POLICY_FILE, 'utf8'));
const check = (s, text = TEXT) => checkStages(s, { ledger, policy, preregText: text });
const mutate = fn => { const s = structuredClone(STAGES); fn(s); return s; };
const hasError = (res, re) => res.errors.some(e => re.test(e));
const st = (s, id) => s.stages.find(x => x.id === id);
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);
const quiet = () => {};

// ------------------------------------------------------------------------------------------------ major 1: C7a
test('major 1: an uninformative C7a interval is never REFUTED; F12 needs the upper bound below 0.7; power is a chance', () => {
  // The reviewer's case: one error on a positive at 2 + 8 (point 0.75, interval [0.320, 0.994]). The first draft read REFUTED.
  const r = c7aReading({ h0: { tp: 1, fn: 1, tn: 8, fp: 0 }, tunedPoint: 0.5, coverage: 1 });
  assert.notEqual(r.reading, 'REFUTED');
  assert.equal(r.reading, 'INCONCLUSIVE');
  assert.equal(r.f12, false);
  close(r.interval.point, 0.75, 1e-12); close(r.interval.lo, 0.320, 0.001); close(r.interval.hi, 0.994, 0.001);
  // The precondition is P(lower bound > 0.5) for a TPR = TNR = 0.9 classifier, not a perfect classifier's bound.
  assert.match(r.why, /not powered: .*TPR = TNR = 0\.9 excludes 0\.5 with probability 0\.659 < 0\.8/);
  const p = c7aPower(2, 8);
  assert.ok(p.perfectLowerBound > 0.5, 'the first draft\'s precondition held here');
  assert.equal(p.powered, false);
  // Powered (6 + 10, pExclude 0.953): lo <= 0.5 < 0.7 <= hi is uninformative, not REFUTED.
  const u = c7aReading({ h0: { tp: 4, fn: 2, tn: 7, fp: 3 }, tunedPoint: 0.5, coverage: 1 });
  assert.ok(u.power.powered);
  assert.ok(u.interval.lo <= 0.5 && u.interval.hi >= C7A_USEFUL, `${u.interval.lo} ${u.interval.hi}`);
  assert.equal(u.reading, 'INCONCLUSIVE'); assert.equal(u.f12, false); assert.match(u.why, /uninformative/);
  // Powered and the upper bound below 0.7: F12 trips.
  const f = c7aReading({ h0: { tp: 2, fn: 4, tn: 5, fp: 5 }, tunedPoint: 0.5, coverage: 1 });
  assert.ok(f.interval.hi < C7A_USEFUL && f.interval.lo <= 0.5);
  assert.equal(f.reading, 'REFUTED'); assert.equal(f.f12, true);
  // Above chance but a useful accuracy excluded (threshold raised here so a small count shows the branch).
  const a = c7aReading({ h0: { tp: 6, fn: 0, tn: 10, fp: 0 }, tunedPoint: 0.5, coverage: 1 }, { useful: 1.01 });
  assert.equal(a.reading, 'ABOVE-CHANCE-BELOW-USEFUL'); assert.equal(a.f12, false);
  // The rule is the preregistered one, in the text and in stages.json.
  assert.equal(STAGES.analysis.c7a.usefulBalancedAccuracy, C7A_USEFUL);
  assert.deepEqual(STAGES.analysis.c7a.powerAlternative, { tpr: 0.9, tnr: 0.9 });
  assert.match(sectionOf(TEXT, /^## 9\./m), /F12 at N = 1, H0's held-out balanced accuracy is shown not to be useful: its\nexact joint interval's upper bound is below 0\.7/);
  assert.match(sectionOf(TEXT, /^## 8\./m), /lower bound ≤ 0\.5 < 0\.7 ≤ upper bound\*\* holds both chance and a\s+useful accuracy/);
});

// ------------------------------------------------------------------------------------------- major 2: power gate
test('major 2: the power gate is computed without r3p too, and passes only when both sets pass', () => {
  // The reviewer's case: 8 clusters at agreement 0.25. Full set 6 informative (1/64); without r3p 5.25 -> 5 (1/32 > 0.025).
  const g = powerGate({ clusters: 8, agreeShare: 0.25, sigma: 0.02 });
  assert.equal(g.expectedInformative, 6); assert.equal(g.floorAtExpected, 1 / 64);
  assert.equal(g.withoutNear.clusters, 7); assert.equal(g.withoutNear.expectedInformative, 5.25); assert.equal(g.withoutNear.floorAtExpected, 1 / 32);
  assert.equal(g.floorOk, false); assert.equal(g.binding, 'without near');
  assert.match(g.outcome, /expected INCONCLUSIVE \(without the 1 near cluster/);
  assert.equal(powerGate({ clusters: 8, agreeShare: 0.25, sigma: 0.02, nearClusters: 0 }).outcome, 'powered', 'the first draft\'s gate approved it');
  assert.equal(powerGate({ clusters: 8, agreeShare: 0, sigma: 0.02 }).outcome, 'powered');
  // The default near count is the preregistered one: the clusters a claim must survive dropping.
  assert.equal(NEAR_CLUSTERS, STAGES.analysis.powerGate.nearClusters);
  assert.equal(NEAR_CLUSTERS, STAGES.analysis.mandatorySensitivities.filter(m => m.drop).flatMap(m => m.drop).length);
  assert.match(sectionOf(TEXT, /^## 11\./m), /The gate is also computed without r3p/);
});

// ----------------------------------------------------------------------------------- major 3: L6 as a launch gate
const PIN = Object.fromEntries(ROUTER_FILES.map((f, i) => [f, String(i).repeat(64).slice(0, 64)]));
const FROZEN_TEXT = TEXT.replace(/^\|\s*A-Freeze \(analysis stamp\)\s*\|[^\n]*/m, `| A-Freeze (analysis stamp) | ${ROUTER_FILES.map(f => `\`${f}\` \`${PIN[f]}\``).join(', ')} |`);
const envelopeText = (routerShas, targets = st(STAGES, 'NL2p').decides) => { const payload = { schema: 'need-decisions/2', routerShas, targets, decisions: [] }; return JSON.stringify({ createdAt: '2026-10-01T00:00:00Z', sha256: sha256(canonical(payload)), payload }); };
const hist = (text, commits = [{ commit: 'a1', committedAt: '2026-10-25T08:00:00Z' }], work = text) => () => ({ commits, head: commits.length ? text : null, work });

test('major 3: a stage that needs an envelope launches only on a committed one whose router shas are the A-Freeze row', () => {
  assert.equal(aFreezeShas(TEXT), null, 'today the A-Freeze row is TBD-FREEZE');
  assert.deepEqual(aFreezeShas(FROZEN_TEXT), PIN);
  assert.deepEqual([...ROUTER_FILES].sort(), STAGES.engineStamp.analysis.files.map(f => path.posix.basename(f)).sort(), 'the envelope seals every A-Freeze file');
  const nl2 = st(STAGES, 'NL2'), launchJobs = launchJobsOf(STAGES, nl2);
  const now = Date.parse('2026-10-26T00:00:00Z');
  const run = (history, text = FROZEN_TEXT, at = now) => envelopeLaunchCheck({ stages: STAGES, stage: nl2, launchJobs, preregText: text, history, now: at });
  const good = run(hist(envelopeText(PIN)));
  assert.deepEqual(good.errors, []);
  assert.deepEqual(good.envelopes.map(e => [e.stage, e.file, e.committedAt]), [['NL2p', 'research/need-router-20261014/envelopes/NL2p.json', '2026-10-25T08:00:00Z']]);
  assert.ok(run(hist(envelopeText(PIN)), TEXT).errors.some(e => /Freeze addendum is not in the preregistration/.test(e)), 'no A-Freeze row: refused');
  assert.ok(run(hist(envelopeText(PIN), [])).errors.some(e => /is in no commit/.test(e)), 'an uncommitted envelope: refused');
  assert.ok(run(hist(envelopeText(PIN)), FROZEN_TEXT, Date.parse('2026-10-25T07:00:00Z')).errors.some(e => /not before this launch/.test(e)), 'committed after the launch time: refused');
  // The reviewer's bypass: the router edited after the held-out matrix was seen, then re-enveloped (a second commit, an
  // earlier self-reported createdAt, and router shas that are no longer the A-Freeze ones).
  const edited = { ...PIN, 'router.mjs': 'f'.repeat(64) };
  const twice = [{ commit: 'a1', committedAt: '2026-10-25T08:00:00Z' }, { commit: 'b2', committedAt: '2026-10-29T08:00:00Z' }];
  const bypass = run(hist(envelopeText(edited), twice));
  assert.ok(bypass.errors.some(e => /changed after its first commit/.test(e)));
  assert.ok(bypass.errors.some(e => /router file router\.mjs is sealed as ffffffffffffffff, the A-Freeze row pins/.test(e)));
  assert.ok(run(hist(envelopeText(PIN), undefined, '{}')).errors.some(e => /working-tree .* differs from its committed text/.test(e)));
  const tampered = JSON.parse(envelopeText(PIN)); tampered.payload.targets = [];
  assert.ok(run(hist(JSON.stringify(tampered))).errors.some(e => /payload does not match its sha256/.test(e)));
  assert.ok(run(hist(envelopeText(PIN, ['incident']))).errors.some(e => /launched job synth-lo has no sealed decision/.test(e)));
  // label-run's paidRunChecks runs it (today: no Freeze addendum, no committed envelope, so NL2 is refused on L6).
  const plan = LR.loadPlan({ stageId: 'NL2', stagesFile: STAGES_FILE }), { units } = LR.stageUnits(plan.stages, plan.stage);
  let seen = null;
  const deps = { stampOf: () => null, checkStagesFn: () => ({ errors: [] }), meterGate: () => ({ schema: 'need-meter-gate/1', status: 'clear', reasons: [] }), meterVerification: () => null };
  LR.paidRunChecks({ plan, units, prereg: PREREG_FILE, allowDraft: true, deps: { ...deps, envelopeCheck: x => { seen = x; return { errors: ['stub'], envelopes: [] }; } } });
  assert.equal(seen.stage.id, 'NL2'); assert.deepEqual(seen.launchJobs, units.map(u => u.job.id).sort());
  const real = LR.paidRunChecks({ plan, units, prereg: PREREG_FILE, allowDraft: true, deps }).errors.filter(e => e.startsWith('envelope (L6)'));
  assert.ok(real.some(e => /Freeze addendum is not in the preregistration/.test(e)), real.join('\n'));
  assert.ok(real.some(e => /NL2p\.json is in no commit/.test(e)), real.join('\n'));
  // A stage that names no envelope is not affected (NL0 passes as before: label-run-review.test.mjs).
  assert.deepEqual(envelopeLaunchCheck({ stages: STAGES, stage: st(STAGES, 'NL0'), launchJobs: ['wbed-r0'], preregText: TEXT }).errors, []);
});

test('major 3: evaluate orders the envelope by its git commit, fails without one, and compares with the A-Freeze row', () => {
  const payload = { routerShas: PIN, targets: [], decisions: [], trainRows: 'x', trainBuilds: 'y', labelSet: 'today', reps: 60, seed: 1, cells: [], meter: null };
  const committed = { createdAt: '2026-10-01T00:00:00Z', sha256: sha256(canonical(payload)), payload }, recomputed = { payload };
  const pv = over => ({ committedAt: '2026-10-25T08:00:00Z', commits: 1, aFreeze: PIN, firstHeldoutAt: '2026-10-25T10:00:00Z', launched: [{ stage: 'nl2', sha256: committed.sha256 }], ...over });
  assert.equal(verifyEnvelope(committed, recomputed, { provenance: pv() }).ok, true);
  assert.equal(verifyEnvelope(committed, recomputed, { provenance: pv() }).provenance, 'checked');
  // The reviewer's case: createdAt (self-reported) is early, the commit is after the first held-out launch.
  const late = verifyEnvelope(committed, recomputed, { provenance: pv({ committedAt: '2026-10-26T00:00:00Z' }) });
  assert.ok(late.problems.some(p => /not before the first held-out launch/.test(p)));
  // A missing commit time fails (the first draft skipped the check when createdAt was absent).
  assert.ok(verifyEnvelope(committed, recomputed, { provenance: pv({ committedAt: null }) }).problems.some(p => /no git commit time/.test(p)));
  assert.ok(verifyEnvelope(committed, recomputed, { provenance: pv({ firstHeldoutAt: null }) }).problems.some(p => /no launch time for the held-out matrix/.test(p)));
  assert.ok(verifyEnvelope(committed, recomputed, { provenance: pv({ aFreeze: null }) }).problems.some(p => /TBD-FREEZE/.test(p)));
  assert.ok(verifyEnvelope(committed, recomputed, { provenance: pv({ aFreeze: { ...PIN, 'voi.mjs': 'e'.repeat(64) } }) }).problems.some(p => /router file voi\.mjs sealed as/.test(p)));
  assert.ok(verifyEnvelope(committed, recomputed, { provenance: pv({ commits: 2 }) }).problems.some(p => /never rewritten/.test(p)));
  assert.ok(verifyEnvelope(committed, recomputed, { provenance: pv({ launched: [{ stage: 'nl2', sha256: 'd'.repeat(64) }] }) }).problems.some(p => /launched against envelope dddd/.test(p)));
  // The provenance the CLI builds: the git history of the decisions file and the held-out stages' LAUNCH.json.
  const dir = mkdtempSync(path.join(tmpdir(), 'nr-launch-'));
  writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify({ h: { cluster: 'c', split: 'heldout' } }));
  writeFileSync(path.join(dir, 'LAUNCH.json'), JSON.stringify({ schema: 'need-launch/1', stage: 'NL2', launchedAt: '2026-10-25T10:00:00Z', envelopes: [{ stage: 'NL2p', sha256: committed.sha256 }] }));
  const L = loadLabels(dir);
  assert.equal(L.stageInfo[0].launchedAt, '2026-10-25T10:00:00Z');
  const prov = envelopeProvenance({ decFile: path.join(REPO, 'research/need-router-20261014/envelopes/NL2p.json'), preregText: FROZEN_TEXT, stageInfo: L.stageInfo, split: 'heldout',
    history: () => ({ commits: [{ commit: 'a1', committedAt: '2026-10-25T08:00:00Z' }], head: 'x', work: 'x' }) });
  assert.deepEqual({ ...prov, aFreeze: !!prov.aFreeze }, { file: 'research/need-router-20261014/envelopes/NL2p.json', committedAt: '2026-10-25T08:00:00Z', commits: 1, uncommittedEdit: false,
    aFreeze: true, firstHeldoutAt: '2026-10-25T10:00:00Z', launched: [{ stage: path.basename(dir), sha256: committed.sha256 }] });
  // An envelope that is not committed (here: a file outside the repository) has no commit time, so L6 fails.
  const loose = envelopeProvenance({ decFile: path.join(dir, 'decisions.json'), preregText: FROZEN_TEXT, stageInfo: L.stageInfo, split: 'heldout' });
  assert.equal(loose.committedAt, null);
  assert.equal(verifyEnvelope(committed, recomputed, { provenance: loose }).ok, false);
});

test('minor 12: E2E needs NL2bp only when gameqa is drawn, in stages.json and at launch', () => {
  const e2e = st(STAGES, 'E2E');
  assert.deepEqual(e2e.requiresEnvelope, ['NL2p', 'NL2bp']);
  assert.deepEqual(e2e.conditionalEnvelopes, { NL2bp: ['gameqa'] });
  // Today gameqa has no frozen band, so it is not admitted and cannot be drawn: NL2bp is not needed.
  const today = launchJobsOf(STAGES, e2e);
  assert.ok(!today.includes('gameqa'));
  assert.deepEqual(envelopeLaunchCheck({ stages: STAGES, stage: e2e, launchJobs: today, preregText: FROZEN_TEXT, history: hist(envelopeText(PIN)), now: Date.parse('2026-10-30T00:00:00Z') }).skipped, ['NL2bp']);
  // Admitted and drawn (no far families: the §12 draw holds gameqa): NL2bp is needed, and checked.
  const adm = mutate(s => { s.jobs.find(j => j.id === 'gameqa').band = [2, 3, 4]; });
  const drawn = launchJobsOf(adm, st(adm, 'E2E'));
  assert.deepEqual(drawn, e2eDraw(['incident', 'synth-lo', 'synth-hi', 'ownerci', 'r3p', 'need-constraint', 'gameqa'], adm.rng.e2eDraw, 6).sort());
  assert.ok(drawn.includes('gameqa'));
  const r = envelopeLaunchCheck({ stages: adm, stage: st(adm, 'E2E'), launchJobs: drawn, preregText: FROZEN_TEXT, history: () => ({ commits: [], head: null, work: null }), now: Date.parse('2026-10-30T00:00:00Z') });
  assert.deepEqual(r.required, ['NL2p', 'NL2bp']);
  assert.ok(r.errors.some(e => /envelope NL2bp: .*NL2bp\.json is in no commit/.test(e)));
  // The checker: a conditional envelope must be required and decide the jobs it names; every envelope stage names its file.
  assert.ok(hasError(check(mutate(s => { st(s, 'E2E').conditionalEnvelopes = { NL2bp: ['incident'] }; })), /conditionalEnvelopes\.NL2bp names incident, which NL2bp does not decide/));
  assert.ok(hasError(check(mutate(s => { st(s, 'E2E').conditionalEnvelopes = { NL2: ['gameqa'] }; })), /conditionalEnvelopes names NL2, which requiresEnvelope does not list/));
  assert.ok(hasError(check(mutate(s => { delete st(s, 'NL2p').envelopeFile; })), /NL2p: an envelope stage names its committed decisions file/));
  assert.match(sectionOf(TEXT, /^## 12\./m), /envelope NL2p, and NL2bp only when `gameqa` is in the drawn set/);
});

// ------------------------------------------------------------------------------------------ major 4: the meter gate
test('major 4: a meterUnverified session enters utility at the reported figure, and its gap is not an imputed bound', () => {
  const P = STAGES.priceTable, job = { id: 'j', cluster: 'W', split: 'train', family: 'records' };
  const rows = [];
  // agent-H reports what the pinned table re-prices its usage at ((10*0.1 + 300*0.5 + 30000*0.01)/1e6 = $0.000451), so only agent-O
  // is meterUnverified (guardMeter's price band flags any re-price far from the reported figure; a $0.02 report would flag agent-H too).
  close(LR.priceSession(P, 'claude-haiku-5-5', { messageUsage: [[10, 300, 30000, 0, 'claude-haiku-5-5']] }).measured, 0.000451, 1e-12, 'the fixture\'s agent-H figure is its re-price');
  for (let t = 0; t < 6; t++) for (const [mode, model, usage, out, usd] of [['agent-H', 'claude-haiku-5-5', [10, 300, 30000, 0], 310, 0.000451], ['agent-O', 'claude-opus-5-5', [10, 40, 50000, 8000], 20000, 0.7]]) {
    // agent-H passes 4 of 6, so agent-O would lead if its gap were dropped: the 30% rule bites only in the sensitivity.
    const rec = { arm: mode, taskKey: `records:dev:d3:s${610 + t}`, trial: 0, costUsd: usd, taskHash: `h${t}`, pass: mode === 'agent-O' || t < 4, error: null,
      meta: { delivered: true, schemaValid: true, messageUsage: [[...usage, model]], finalUsage: { output_tokens: out }, costUpperUsd: 4 } };
    rows.push(LR.matrixRow(rec, { stage: 'NL0', job, armDef: { factory: 'b0Agent', model }, priceTable: P, book: null, taskInfo: { seed: 610 + t, difficulty: 3 }, meter: { tolerance: 0.05 } }));
  }
  const o = rows.find(r => r.mode === 'agent-O');
  assert.equal(o.meterUnverified, true);
  assert.ok(rows.filter(r => r.mode === 'agent-H').every(r => !r.meterUnverified && r.usdImputed === 0), 'agent-H is verified: its report equals its re-price');
  close(o.usdMeterGap, o.usdImputed, 1e-9, 'label-run records the gap');
  close(o.usdRepriced + o.usdImputed, 0.7, 1e-5, 'the reported figure');
  const cell = makeCell(1, 10, 1);
  const primary = needTable(rows, []), sens = needTable(rows, [], { meterGapAs: 'imputed' });
  close(cellStats(primary, 'j', 'agent-O').c, 0.7, 1e-5, 'utility charges the reported $0.70, not the re-price');
  assert.equal(cellStats(primary, 'j', 'agent-O').imputedShare, 0, 'the gap is observed dollars');
  assert.ok(cellStats(sens, 'j', 'agent-O').imputedShare > 0.5, 'the not-primary sensitivity counts it');
  assert.equal(needLabels(primary, { reps: 0, cells: [cell] }).at('j', cell).unlabelled, null, 'primary: agent-O cells keep their labels');
  assert.match(needLabels(sens, { reps: 0, cells: [cell] }).at('j', cell).unlabelled, /imputed dollars over 0\.3 in agent-O/);
  assert.throws(() => needTable([{ ...o, usdMeterGap: o.usdImputed + 1 }], []), /usdMeterGap .* exceeds usdImputed/);
  // Preregistered: the rule, the cache-write rate billed, the launch switch, the waiver as a deviation, D6 as its source.
  const m = STAGES.analysis.meterGate;
  assert.match(m.utility, /CLI-reported figure/); assert.match(m.imputedRule, /does not count toward the 30%-imputed rule/);
  assert.match(m.cacheWrite, /1-hour rate/); assert.match(m.waiver, /§13 deviation/); assert.match(m.informedBy, /^D6/);
  const s5 = sectionOf(TEXT, /^## 5\./m), s12 = sectionOf(TEXT, /^## 12\./m), s13 = sectionOf(TEXT, /^## 13\./m);
  assert.match(s5, /The meter-gate rule/); assert.match(s5, /\*Utility\* for a meterUnverified session uses the \*\*reported\*\* figure/);
  assert.match(s5, /The 30%-imputed rule does not count the gap/); assert.match(s5, /The cache-write rate billed/); assert.match(s5, /\*The waiver\.\*/);
  assert.match(s12, /FORCE_PROMPT_CACHING_5M=1 CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(s13, /\*\*Informed by D6\*\*/);
  assert.doesNotMatch(s5, /utility uses the re-priced one\. Timeouts/, 'the old unconditional sentence is gone');
});

// ------------------------------------------------------------------------------------------ major 5: committed spend
test('major 5: the totals and the soft-cap check count recorded spend above a cap, and externally budgeted stages', () => {
  const t = check(STAGES).summary.totals;
  const m1 = st(STAGES, 'M1'), m1r = st(STAGES, 'M1-R');
  const meterOf = s => Object.values(s.observed).reduce((a, o) => a + Math.max(o.meterUsd ?? 0, o.meterWithSetAsideUsd ?? 0), 0);
  close(meterOf(m1), 62.9156, 1e-9); close(meterOf(m1r), 25.8934, 1e-9);
  close(t.committedUsd, t.capUsd - m1.capUsd + 62.9156, 0.006, 'M1 counts at its $62.92 on the meter, not its $15 cap');
  close(t.externalCommittedUsd, 25.89, 1e-9, 'M1-R joins the soft-cap check');
  close(t.softCapCheckUsd, t.committedUsd + t.recurringCapUsd + t.externalCommittedUsd, 0.006);
  // Overruns that accumulate are refused once they pass the soft cap.
  assert.ok(hasError(check(mutate(s => { st(s, 'M1').observed.m1.meterUsd = 300; })), /committed spend \$1593\.92 \(each stage at max\(cap, recorded meter\)\).*is over the \$1500 session soft cap/));
  assert.ok(hasError(check(mutate(s => { st(s, 'M1-R').observed['m1-r'].meterWithSetAsideUsd = 200; })), /externally budgeted stages \$200 is over the \$1500 session soft cap/));
  assert.match(sectionOf(TEXT, /^## 12\./m), /\*\*Committed spend, not caps\*\*/);
});

// --------------------------------------------------------------------------------------- major 6: owner tasks
test('major 6: owner tasks run in their own capped stage, with a per-task estimate and bound, stated lineages and K7', () => {
  const nl0 = st(STAGES, 'NL0'), own = st(STAGES, 'NL0-owner'), job = STAGES.jobs.find(j => j.id === 'owner-dev');
  assert.ok(!nl0.runs.some(r => r.job === 'owner-dev'), 'NL0\'s cap stop and racing never fall on owner tasks');
  assert.equal(nl0.estUsd, 110); assert.equal(nl0.capUsd, 140); assert.equal(nl0.approved, true);
  assert.deepEqual(own.runs, [{ job: 'owner-dev', arms: ['direct-H', 'agent-H', 'agent-O', 'agent-H+proc', 'construct-H'], seedsFrom: 'owner tasks', replicates: 1, lineages: 1 }]);
  assert.equal(own.approved, false); assert.ok(own.capUsd <= 500 && own.estUsd >= job.maxTasks * job.estPerTaskUsd);
  // The per-task bound is the sum of the arm bounds at K = 1 (agent-O at its large-input $8).
  const A = STAGES.arms;
  const bound = A['direct-H'].maxBudgetUsdPerCall + A['agent-H'].budgetUsd + A['agent-O'].budgetUsdLargeInputs + 1 + A['agent-H'].budgetUsd
    + A['construct-H'].build.builderBudgetUsd + A['construct-H'].build.constructionModelUsd + A['construct-H'].build.perTaskUsd;
  close(job.boundPerTaskUsd, bound, 1e-9, 'bound per owner task');
  assert.match(own.k7, /1\.5 x estPerTaskUsd \(\$4\.50\)/);
  assert.ok(hasError(check(mutate(s => { delete st(s, 'NL0-owner').runs[0].lineages; })), /states its replicates and lineages/));
  assert.ok(hasError(check(mutate(s => { delete s.jobs.find(j => j.id === 'owner-dev').estPerTaskUsd; })), /needs estPerTaskUsd > 0/));
  assert.ok(hasError(check(mutate(s => { st(s, 'NL0-owner').estUsd = 5; })), /estimate \$5 is below 5 owner tasks at \$3/));
  assert.match(sectionOf(TEXT, /^## 12\./m), /\*\*K7\*\* NL0 cost per job over 1\.5× the estimate → re-plan before NL1\. For owner tasks \(NL0-owner\)/);
});

// --------------------------------------------------------------------------- minor 7: held-out tasks before Freeze
test('minor 7: label-run --dry refuses held-out evaluation roles before Freeze; the refusal comes before any task is made', async () => {
  const planned = LR.stageUnits(STAGES, st(STAGES, 'NL2')).units;
  assert.ok(planned.some(u => u.evalRole === 'heldoutEval'));
  assert.match(heldoutDryRefusal({ units: planned, preregText: TEXT }), /--dry would generate held-out tasks in this process before Freeze/);
  assert.match(heldoutDryRefusal({ units: planned, preregText: TEXT, allow: 'D99' }), /not a deviation id .* that PREREG §13 names/);
  assert.equal(heldoutDryRefusal({ units: planned, preregText: TEXT, allow: 'D9' }), null, 'an allowance names a recorded deviation');
  assert.equal(heldoutDryRefusal({ units: planned, preregText: FROZEN_TEXT }), null, 'after the Freeze addendum');
  assert.equal(heldoutDryRefusal({ units: LR.stageUnits(STAGES, st(STAGES, 'NL0')).units, preregText: TEXT }), null, 'TRAIN stages are unaffected');
  for (const id of ['NL2', 'DRIFT']) {
    const dir = mkdtempSync(path.join(tmpdir(), `nr-dry-${id}-`));
    await assert.rejects(LR.labelRun({ stageId: id, dry: true, workRoot: path.join(dir, 'w'), out: path.join(dir, 'o'), log: quiet }), e => e.code === 'HELDOUT_DRY_REFUSED', id);
    assert.ok(!existsSync(path.join(dir, 'w')) && !existsSync(path.join(dir, 'o')), 'refused before any work root or task');
  }
  assert.match(sectionOf(TEXT, /^### 3\.3\b/m), /\*\*Enforced since D9\*\*/);
});

// ------------------------------------------------------------------------------------- minor 8: Jev features and r3p
test('minor 8: the Freeze decision on Jev features never reads r3p (J-NEED-2 recomputed without it)', () => {
  const r3p = STAGES.jobs.find(j => j.id === 'r3p');
  assert.ok(r3p.devObserved.some(x => /^J-NEED-2\b/.test(x)));
  assert.deepEqual(STAGES.analysis.jevFeatureDecision.excludeFamilies, ['wbed-r3p']);
  assert.ok(hasError(check(mutate(s => { s.analysis.jevFeatureDecision.excludeFamilies = []; })), /excludeFamilies must name wbed-r3p/));
  assert.ok(hasError(check(mutate(s => { delete s.analysis.jevFeatureDecision; })), /analysis\.jevFeatureDecision must say how/));
  assert.match(sectionOf(TEXT, /^## 6\./m), /J-NEED-2 \*\*recomputed without `wbed-r3p`\*\*/);
});

// ------------------------------------------------------------------------------------------ minor 9: policy version
test('minor 9: the policy version in force for NL0 is pinned; a mismatch warns while draft and refuses once frozen', () => {
  assert.equal(STAGES.policy.policyVersion, policy.policyVersion);
  assert.match(STAGES.priceTable.sources[0], new RegExp(`policyVersion ${policy.policyVersion.replace(/\./g, '\\.')}, in force for NL0`));
  const other = mutate(s => { s.policy.policyVersion = '2026-10-09.1'; });
  const draft = check(other);
  assert.ok(draft.warnings.some(w => /policy version .* differs/.test(w)) && !hasError(draft, /policy version/));
  other.status = 'frozen';
  assert.ok(hasError(check(other, TEXT.replace('Status: **DRAFT', 'Status: **FROZEN')), /policy version .* differs .*a paid stage would run under another policy/));
});

// -------------------------------------------------------------------------------------------- minor 10: voids
test('minor 10: a voided lineage scores as failures in the primary analysis; it is never a missing-data reason', () => {
  const rows = [], builds = [];
  for (let t = 0; t < 3; t++) {
    rows.push({ job: 'j', mode: 'agent-H', task: `t${t}`, rep: 0, pass: true, delivered: true, usdRepriced: 0.1 });
    for (let k = 0; k < 3; k++) rows.push({ job: 'j', mode: 'construct-H', task: `t${t}`, rep: k, pass: true, delivered: true, usdRepriced: 0.01 });
  }
  for (let k = 0; k < 3; k++) builds.push({ job: 'j', mode: 'construct-H', rep: k, usd: 0.5, nestedModelAttempts: 1 });
  const T = needTable(rows, builds);
  assert.equal(T.voided.length, 3);
  assert.equal(cellStats(T, 'j', 'construct-H').s, 0, 'every voided lineage scores as failures: the cheating builder counts against construct-H');
  assert.deepEqual(missingDataRule([{ id: 'j', cluster: 'c', required: ['agent-H', 'construct-H'], present: T.modes }]).kept, ['j'], 'the job stays in Delta and C7a');
  assert.throws(() => needTable(rows, builds, { voidPolicy: 'drop' }), /every lineage was voided and dropped/, 'drop is the sensitivity, never the default');
  assert.match(STAGES.analysis.voidPolicy, /^fail: /);
  const s5 = sectionOf(TEXT, /^## 5\./m), reasons = /Reasons include:[^\n]*/.exec(s5)[0];
  assert.doesNotMatch(reasons, /voided/);
  assert.match(s5, /\*\*A voided lineage or draw is not missing\*\*/);
});

// --------------------------------------------------------------------------------- minor 11: probe purposes
test('minor 11: the NR-probe rows name the probe task (§3.3), not example 601; the departure from DESIGN §3 is recorded', () => {
  const purposes = STAGES.stages.flatMap(s => (s.runs ?? []).map(r => r.purpose)).filter(Boolean);
  assert.ok(!purposes.some(p => /example 601/.test(p)));
  assert.equal(st(STAGES, 'NL1').runs.filter(r => (r.seedRoles ?? []).includes('probe')).filter(r => /the probe task: seed 601 at the band's median level/.test(r.purpose)).length, 15);
  assert.match(sectionOf(TEXT, /^## 14\./m), /\*\*The probe task \(DESIGN §3, "on example 601 only"\)\*\*/);
});

// ---------------------------------------------------------------------------------------- minor 13: overshoot
test('minor 13: budget overshoot is stated, and its archived measurement holds ($0, recounted from the archived rows)', () => {
  const root = path.join(REPO, 'research/jit-20261008/runs'), ratios = [];
  for (const exp of readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory())) for (const arm of readdirSync(path.join(root, exp.name), { withFileTypes: true }).filter(d => d.isDirectory())) {
    const af = path.join(root, exp.name, arm.name, 'arm.json'), rf = path.join(root, exp.name, arm.name, 'results.jsonl');
    if (!existsSync(af) || !existsSync(rf)) continue;
    const b = JSON.parse(readFileSync(af, 'utf8')).def?.agentBudgetUsd;
    if (!b) continue;
    for (const l of readFileSync(rf, 'utf8').split('\n').filter(Boolean)) for (const e of JSON.parse(l).events ?? []) {
      if ((['interpret', 'agent', 'adjudicate'].includes(e.kind) || e.role === 'interpreter') && typeof e.costUsd === 'number') ratios.push(e.costUsd / b);
    }
  }
  ratios.sort((x, y) => y - x);
  assert.equal(ratios.length, 273);
  close(ratios[0], 1, 1e-9, 'largest'); close(ratios[1], 0.373, 0.001, 'next');
  const C = readFileSync(path.join(REPO, 'research/need-router-20261014/archive/c0-dev/constructions.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.equal(C.length, 8);
  assert.ok(Math.max(...C.map(c => c.builderCostReportedUsd / c.builderBudgetUsd)) < 0.29);
  assert.ok(C.every(c => c.gatewayOvershootUsd === 0));
  assert.match(STAGES.spendMeter.overshoot, /273 JIT agent and interpreter sessions/);
  assert.match(sectionOf(TEXT, /^## 12\./m), /\*\*Overshoot: the bound is not a hard ceiling\*\*/);
});

// ------------------------------------------------------------------------- refresh (2026-10-15): text against code
test('major 1 (refresh): the planned-count chances and the minimum confident counts printed in §7 are what c7aPower computes', () => {
  const s7 = sectionOf(TEXT, /^## 7\./m);
  const planned = /Planned counts \(pExclude\):([^\n]*\n[^\n]*)/.exec(s7)[1];
  const pairs = [...planned.matchAll(/(\d+) \+ (\d+): (\d\.\d{3})/g)].map(m => [Number(m[1]), Number(m[2]), Number(m[3])]);
  assert.equal(pairs.length, 7, planned);
  for (const [p, n, want] of pairs) close(c7aPower(p, n).pExclude, want, 0.0005, `pExclude ${p} + ${n}`);
  // The minimum counts: the frontier of c7aMinimumCounts (a count of positives whose minimum equals the previous one adds
  // nothing), the same list stages.json holds, and powered in both orders (symmetric).
  const listed = [.../\*\*Minimum confident counts\*\*[^:]*:([^.]*)\./.exec(s7)[1].matchAll(/(\d+) \+ (\d+)/g)].map(m => [Number(m[1]), Number(m[2])]);
  let prev = Infinity;
  const frontier = c7aMinimumCounts({ maxPos: 10 }).filter(x => x.minNeg != null && x.minNeg < prev && (prev = x.minNeg, true)).map(x => [x.pos, x.minNeg]);
  assert.deepEqual(listed, frontier);
  assert.deepEqual(STAGES.analysis.c7a.minimumConfidentCounts.map(x => [x.pos, x.neg]), frontier);
  for (const [p, n] of frontier) { assert.ok(c7aPower(p, n).powered && c7aPower(n, p).powered, `${p} + ${n}`); assert.ok(!c7aPower(p, n - 1).powered, `${p} + ${n - 1}`); }
});

test('minor 13 (refresh): the overshoot reporting the preregistration states is what label-run records', () => {
  // A start settled above its bound is an overrun on its ledger entry and in the report's totals.spend (label-run.mjs, third
  // label-harness review); the text and stages.json name exactly those fields, and the 10% rule reads overBoundUsd.
  const dir = mkdtempSync(path.join(tmpdir(), 'nr-over-')), file = path.join(dir, LR.SPEND_FILE);
  const b = new LR.StageBudget(10, 0, { stage: 'NL-T', files: [file] });
  const t1 = b.reserve(2, { kind: 'trial', key: 'a' }), t2 = b.reserve(1, { kind: 'trial', key: 'b' });
  b.settle(t1, 2.5); b.settle(t2, 0.4);
  assert.deepEqual(b.overruns.map(o => [o.key, o.overBoundUsd]), [['a', 0.5]]);
  const led = LR.loadSpend([file], 'NL-T');
  assert.equal(led.entries.find(e => e.key === 'a').overBoundUsd, 0.5);
  assert.deepEqual(LR.overBound(led), { starts: 1, usd: 0.5 });
  const src = readFileSync(path.join(here, '..', 'label-run.mjs'), 'utf8');
  for (const f of ['overBoundStarts', 'overBoundUsd', 'overCapUsd', 'STAGE_CAP_OVERRUN']) {
    assert.ok(src.includes(f), `label-run.mjs has ${f}`);
    assert.ok(STAGES.spendMeter.overshoot.includes(f), `stages.json spendMeter.overshoot names ${f}`);
    assert.ok(sectionOf(TEXT, /^## 12\./m).includes(`\`${f}\``), `PREREG §12 names ${f}`);
  }
  assert.match(sectionOf(TEXT, /^## 12\./m), /total overshoot \(`totals\.spend\.overBoundUsd`\) exceeds 10% of its cap/);
  // The CLI's budget is a soft bound by a code comment, not by a measurement: the text says so.
  // The cited line is found by its text (engine work moves it); the PREREG must cite the line it is on now.
  const execLines = readFileSync(path.join(REPO, 'src/executors/claude-code.mjs'), 'utf8').split('\n');
  const softAt = execLines.findIndex(l => /soft bound: the CLI checks it between turns/.test(l)) + 1;
  assert.ok(softAt > 0, 'the executor still says its budget is a soft bound');
  assert.match(sectionOf(TEXT, /^## 12\./m), new RegExp(`the executor's own comment at \`:${softAt}\`; a\\s+documentation claim, not measured here`));
  assert.doesNotMatch(sectionOf(TEXT, /^## 12\./m), /A listing in the stage report is open/);
});
