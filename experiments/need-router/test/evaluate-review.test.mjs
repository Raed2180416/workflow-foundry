// Regression tests for the adversarial review of the need-router evaluator (2026-10-15): one test per fixed defect.
// $0: synthetic matrices only, no model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  evaluate, commitDecisions, verifyEnvelope, loadLabels, readingOf, coPrimaryHolm, readC7a, needDetection, sliderCalibration, seedChecks, shuffledNull,
  sbsTrain, familyIdentityRouter, makeContext, publicView, shortcutView, fitOn, routingChecks, renderReport,
} from '../evaluate.mjs';
import { HEADLINE, GRID, makeCell, needTable, needLabels, fragility, signFlipTest } from '../metrics.mjs';
import { balancedAccuracyInterval } from '../prereg-rules.mjs';
import { wilson } from '../../lib/stats.mjs';
import { canonical, sha256 } from '../../../beds/lib/canonical.mjs';
import { plantedWorld, judgeAlwaysAgent } from './worlds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAST = { reps: 60, bootReps: 0, l2Perms: 0, randomDraws: 20, attacks: false, leak: false };
const trainOnly = W => ({ rows: W.rows.filter(r => W.meta[r.job].split === 'train'), builds: W.builds.filter(b => W.meta[b.job].split === 'train') });
const DRAWS = { 'direct-H': 2, 'agent-H': 2, 'agent-O': 1 };
const pad = t => `t${String(t).padStart(2, '0')}`;

/**
 * A deterministic matrix: every draw of a (job, mode) passes every task at the given per-task dollars. jobs: [{ id,
 * cluster, split, cost: { mode: usd } }]; the declared menu is the modes given.
 */
function detWorld(jobs) {
  const rows = [], meta = {};
  for (const j of jobs) {
    meta[j.id] = { cluster: j.cluster, split: j.split, family: j.cluster, kind: 'oneshot', modes: Object.keys(j.cost), exampleSeeds: [601, 602, 603],
      features: { logInputTokens: 3, maxListLength: 0.5, logSchemaLeaves: 1, itemLists: 1, freeText: 0, multiSource: 0, conventionsInProse: 0, verifiable: 1 } };
    const base = j.split === 'train' ? 610 : 8801;
    for (const [mode, usd] of Object.entries(j.cost)) for (let t = 0; t < 12; t++) for (let rep = 0; rep < DRAWS[mode]; rep++) {
      rows.push({ job: j.id, mode, task: pad(t), rep, seed: base + t, taskHash: `h-${j.id}-${t}`, pass: true, delivered: true, schemaValid: true, usdRepriced: usd, usdImputed: 0 });
    }
  }
  return { rows, builds: [], meta };
}
const always = (name, mode) => ({ name, role: 'primary', fit: () => () => ({ mode }) });

// ------------------------------------------------------------------------------------------------ blocker 1: Holm
test('blocker 1: Holm rejects neither co-primary at p = (0.03, 0.04), so neither reads SUPPORTED or SUPERIOR', () => {
  const H = coPrimaryHolm([0.03, 0.04]);
  assert.deepEqual(H.reject, [false, false]);
  assert.deepEqual(H.level, [0.025, 0.025], 'the second policy is never tested at α: its step is never reached');
  assert.deepEqual(H.adjusted, [0.06, 0.06]);
  assert.deepEqual(coPrimaryHolm([0.01, 0.04]).reject, [true, true]);
  assert.deepEqual(coPrimaryHolm([0.01, 0.04]).level, [0.025, 0.05]);
  // The reviewer's case: every other condition of SUPPORTED holds, but Holm does not reject.
  const cal = { calibrated: true, predicted: true }, ok = { complete: true, lo: 0.01 }, perV = [0.1, 1, 10].map(V => ({ V, lo: 0.001, hi: 0.2 }));
  const base = { headline: { mean: 0.05, lo: 0.001, hi: 0.2 }, perV, vsTuned: ok, vsJudge: ok, slider: cal };
  assert.equal(readingOf({ ...base, holmReject: true }).reading, 'SUPPORTED');
  assert.equal(readingOf({ ...base, holmReject: false }).reading, 'INCONCLUSIVE');
  assert.equal(readingOf(base).reading, 'INCONCLUSIVE', 'no Holm decision supplied: never SUPPORTED');
  assert.equal(readingOf({ ...base, headline: { mean: 0.01, lo: 0.001, hi: 0.2 }, holmReject: false }).reading, 'INCONCLUSIVE', 'nor SUPERIOR');

  // End to end, 6 held-out clusters: NR-static's cluster Δ give p = 3/64 (0.047), NR-probe's 2/64 (0.031).
  const dS = [0.02, 0.02, 0.02, 0.02, 0.003, -0.004], dP = [0.02, 0.02, 0.02, 0.02, 0.02, -0.004];
  const W = detWorld([
    ...[0, 1].map(i => ({ id: `T${i}-j0`, cluster: `T${i}`, split: 'train', cost: { 'direct-H': 0, 'agent-H': 0.3, 'agent-O': 0.3 } })),
    ...dS.map((d, i) => ({ id: `H${i}-j0`, cluster: `H${i}`, split: 'heldout', cost: { 'direct-H': 0.03, 'agent-H': 0.03 - d, 'agent-O': 0.03 - dP[i] } })),
  ]);
  const R = evaluate({ ...W, split: 'heldout', policies: [always('NR-static', 'agent-H'), always('NR-probe', 'agent-O'), sbsTrain()], ...FAST });
  assert.ok(Math.abs(R.holm.pValues['NR-static'] - 3 / 64) < 1e-12 && Math.abs(R.holm.pValues['NR-probe'] - 2 / 64) < 1e-12, JSON.stringify(R.holm.pValues));
  assert.deepEqual(R.holm.reject, { 'NR-static': false, 'NR-probe': false });
  for (const n of ['NR-static', 'NR-probe']) {
    assert.equal(R.primary[n].holmLevel, 0.025, n);
    assert.equal(R.primary[n].reading, 'INCONCLUSIVE', `${n}: ${R.primary[n].reading}`);
    assert.ok(!(R.primary[n].headline.lo > 0), `${n}: no lower bound above 0 at an unreached level`);
  }
  // Before the fix NR-static took level α = 0.05, where its p of 0.047 gives a positive bound, and read SUPERIOR.
  assert.ok(signFlipTest(dS, { alpha: 0.05 }).lo > 0);
});

// ------------------------------------------------------------------------- blocker 2: held-out outcomes in the fit
function selfCheckWorld({ heldoutLies }) {
  // agent-H: 5/12 pass, 1 delivered wrong; construct-H (3 lineages): 6/12 pass, 6 delivered wrong. TRAIN self-checks catch
  // every wrong answer; held-out ones pass every wrong answer when heldoutLies (pooled F11 over all rows would trip).
  const rows = [], builds = [], meta = {};
  const jobs = [['T0-j0', 'T0', 'train'], ['T1-j0', 'T1', 'train'], ['H0-j0', 'H0', 'heldout'], ['H1-j0', 'H1', 'heldout']];
  for (const [job, cluster, split] of jobs) {
    meta[job] = { cluster, split, family: cluster, kind: 'oneshot', modes: ['agent-H', 'construct-H'], exampleSeeds: [601, 602, 603],
      features: { logInputTokens: 3 + (cluster.endsWith('1') ? 0.5 : 0), maxListLength: 0.5, logSchemaLeaves: 1, itemLists: 1, freeText: 0, multiSource: 0, conventionsInProse: 0, verifiable: 1 } };
    const base = split === 'train' ? 610 : 8801;
    for (let t = 0; t < 12; t++) {
      for (const rep of [0, 1]) rows.push({ job, mode: 'agent-H', task: pad(t), rep, seed: base + t, taskHash: `h-${job}-${t}`, pass: t < 5, delivered: t < 6, schemaValid: true, usdRepriced: 0.05, usdImputed: 0 });
      for (const rep of [0, 1, 2]) {
        const pass = t < 6, selfVerdict = pass ? 'pass' : split === 'heldout' && heldoutLies ? 'pass' : 'fail';
        rows.push({ job, mode: 'construct-H', task: pad(t), rep, seed: base + t, taskHash: `h-${job}-${t}`, pass, delivered: true, schemaValid: true, selfVerdict, usdRepriced: 0.01, usdImputed: 0 });
      }
    }
    for (const rep of [0, 1, 2]) builds.push({ job, mode: 'construct-H', rep, usd: 0.1, failed: false, scoreChecks: 0, probeSeeds: [601 + 3 * rep, 602 + 3 * rep, 603 + 3 * rep], hiddenPathAttempts: 0, nestedModelAttempts: 0 });
  }
  return { rows, builds, meta };
}

test('blocker 2: held-out self-check outcomes never reach the fit; the scored decisions are the sealed ones', () => {
  const lying = selfCheckWorld({ heldoutLies: true }), honest = selfCheckWorld({ heldoutLies: false });
  const a = evaluate({ ...lying, split: 'heldout', ...FAST }), b = evaluate({ ...honest, split: 'heldout', ...FAST });
  // F11 is computed per split: TRAIN's build path is clean; the held-out lineages' false passes only touch held-out rows.
  assert.deepEqual(a.validity.selfTest.f11, { train: [], eval: ['construct-H'] });
  assert.deepEqual(b.validity.selfTest.f11, { train: [], eval: [] });
  // Every decision (all policies but the peek controls) is the same whatever the held-out self verdicts say.
  for (const n of Object.keys(a.scores).filter(n => !['peek', 'SBS-test'].includes(n))) {
    for (const c of GRID) assert.deepEqual(a.scores[n][c.key].perJob.map(x => x.mode), b.scores[n][c.key].perJob.map(x => x.mode), `${n} ${c.key}`);
  }
  // With self-check credit on TRAIN, construct-H is the TRAIN SBS at the headline; held-out construct-H is scored unverified.
  assert.deepEqual(a.scores['SBS-train'][HEADLINE.key].perJob.map(x => x.mode), ['construct-H', 'construct-H']);
  assert.ok(a.scores['SBS-train'][HEADLINE.key].perJob.every(x => x.q === 0.5), 'held-out deliveries carry no self-check credit (eval F11)');
  // The envelope sealed from TRAIN rows alone is what evaluate scores, and L6 compares the scored decisions with it.
  const committed = commitDecisions({ ...trainOnly(lying), meta: lying.meta, reps: 60, createdAt: '2026-10-24T00:00:00Z' });
  const sealed = new Map(committed.payload.decisions.map(d => [`${d.policy}|${d.job}|${d.cell}`, d.mode]));
  const R = evaluate({ ...lying, committed, split: 'heldout', ...FAST, leak: true, l2Perms: 10 });
  assert.equal(R.leaks.L6.ok, true, JSON.stringify(R.leaks.L6.problems));
  assert.ok(R.leaks.L6.scoredCompared > 0);
  for (const n of ['NR-static', 'SBS-train', 'always-construct-H']) for (const x of R.scores[n][HEADLINE.key].perJob) assert.equal(x.mode, sealed.get(`${n}|${x.job}|${HEADLINE.key}`), `${n}/${x.job}`);
  // A scored decision that is not the sealed one fails L6 (here: the envelope tampered and re-hashed).
  const tampered = structuredClone(committed), d0 = tampered.payload.decisions.find(d => d.policy === 'SBS-train' && d.job === 'H0-j0' && d.cell === HEADLINE.key);
  d0.mode = 'agent-H';
  tampered.sha256 = sha256(canonical(tampered.payload));
  const T = evaluate({ ...lying, committed: tampered, split: 'heldout', ...FAST, leak: true, l2Perms: 10 });
  assert.equal(T.leaks.L6.ok, false);
  assert.ok(T.leaks.L6.problems.some(p => /changed after commit: SBS-train\|H0-j0\|/.test(p)), T.leaks.L6.problems.join('\n'));
  assert.equal(T.scores['SBS-train'][HEADLINE.key].perJob.find(x => x.job === 'H0-j0').mode, 'agent-H', 'what is scored is what was sealed');
});

// ---------------------------------------------------------------------------- major 3: silent drop-outs
test('major 3: declared or sealed jobs without rows or without their full menu are dropped and listed, never lost', () => {
  const W = plantedWorld({ train: 4, heldout: 4, jobs: 2, seed: 21 });
  const committed = commitDecisions({ ...trainOnly(W), meta: W.meta, reps: 60, createdAt: '2026-10-24T00:00:00Z' });
  assert.equal(committed.payload.targets.length, 8);
  // H3-j1 lost every task row (a crashed stage; its build rows remain); H2-j0 lost agent-H's second draw and H1-j1 three
  // tasks of construct-H lineage 2 (a stage stopped at its cap). Before the fix the first vanished from Δ silently and the
  // last made needTable throw for the whole evaluation.
  const rows = W.rows.filter(r => r.job !== 'H3-j1' && !(r.job === 'H2-j0' && r.mode === 'agent-H' && r.rep === 1)
    && !(r.job === 'H1-j1' && r.mode === 'construct-H' && r.rep === 2 && ['t09', 't10', 't11'].includes(r.task)));
  const R = evaluate({ ...W, rows, committed, split: 'heldout', ...FAST, leak: true, l2Perms: 10 });
  assert.equal(R.jobs.eval, 5); assert.equal(R.jobs.dropped, 3);
  const why = Object.fromEntries(R.validity.dropped.eval.map(d => [d.job, d.reason]));
  assert.equal(why['H3-j1'], 'no rows (5 build row(s) kept)');
  assert.match(why['H2-j0'], /agent-H: 12 task\(s\) with fewer than 2 first-pass draws/);
  assert.equal(why['H1-j1'], 'construct-H lineage 2: rows for 9 of 12 tasks');
  assert.equal(R.leaks.L6.ok, true, JSON.stringify(R.leaks.L6.problems));
  assert.match(renderReport(R), /DROPPED \(PREREG §5 missing data[^\n]*H3-j1 \(no rows/);
  // A sealed target that is neither scored nor listed fails L6.
  const v = verifyEnvelope(committed, committed, { accounted: new Set(['H0-j0']), split: 'heldout', meta: W.meta });
  assert.ok(v.problems.some(p => /sealed target H1-j0 was neither scored nor listed as dropped/.test(p)));
  // A TRAIN job missing a whole arm leaves TRAIN (the fit), listed; it is never fitted without that mode.
  const noO = W.rows.filter(r => !(r.job === 'T1-j0' && r.mode === 'agent-O'));
  const env = commitDecisions({ rows: noO.filter(r => W.meta[r.job].split === 'train'), builds: trainOnly(W).builds, meta: W.meta, reps: 60 });
  assert.deepEqual(env.payload.trainDropped, ['T1-j0']);
  assert.ok(evaluate({ ...W, rows: noO, split: 'heldout', ...FAST }).validity.dropped.train.some(d => d.job === 'T1-j0' && /agent-O: no rows/.test(d.reason)));
  // Rows for a mode the job's menu masks are a data error.
  const masked = { ...W.meta, 'H0-j0': { ...W.meta['H0-j0'], masked: ['direct-H'] } };
  assert.throws(() => evaluate({ ...W, meta: masked, split: 'heldout', ...FAST }), /H0-j0: rows for direct-H, which its jobs.json menu does not declare/);
});

// ------------------------------------------------------------------------------------- major 4: masked modes
test('major 4: a declared masked mode never crashes: fixed policies take the pre-registered substitute, counted', () => {
  const W = plantedWorld({ train: 4, heldout: 4, jobs: 2, seed: 22 });
  const meta = { ...W.meta, 'H1-j0': { ...W.meta['H1-j0'], masked: ['direct-H'] } };
  const rows = W.rows.filter(r => !(r.job === 'H1-j0' && r.mode === 'direct-H'));
  const env = commitDecisions({ ...trainOnly(W), meta, reps: 60, createdAt: '2026-10-24T00:00:00Z' });
  const d = env.payload.decisions.find(x => x.policy === 'always-direct-H' && x.job === 'H1-j0' && x.cell === HEADLINE.key);
  assert.notEqual(d.mode, 'direct-H'); assert.equal(d.fallback.from, 'direct-H');
  const R = evaluate({ ...W, meta, rows, committed: env, split: 'heldout', ...FAST });
  assert.deepEqual(R.validity.fallbacks['always-direct-H'].jobs, ['H1-j0']);
  assert.ok(!R.scores['always-direct-H'][HEADLINE.key].perJob.some(x => x.job !== 'H1-j0' && x.mode !== 'direct-H'));
  // The substitute is SBS-train's ranking: on the masked job both route to the same mode.
  const mode = n => R.scores[n][HEADLINE.key].perJob.find(x => x.job === 'H1-j0').mode;
  assert.equal(mode('always-direct-H'), mode('SBS-train'));
  assert.ok(!R.modes.includes('direct-H->agent-H') || !R.scores['NR-static'][HEADLINE.key].perJob.some(x => x.job === 'H1-j0' && x.mode === 'direct-H->agent-H'));
  assert.match(renderReport(R), /SUBSTITUTES \(PREREG §7 masked modes\): [^\n]*always-direct-H/);
});

// ----------------------------------------------------------------------------------------- major 5: routing dollars
test('major 5: recorded routing dollars are required, reconciled with the probe rows, and sealed', () => {
  const W = plantedWorld({ train: 4, heldout: 4, jobs: 1, seed: 23 });
  const held = Object.keys(W.meta).filter(j => W.meta[j].split === 'heldout');
  const probes = held.flatMap(job => [{ job, mode: 'direct-H', draw: 0, usdRepriced: 0.03, usdImputed: 0 }, { job, mode: 'direct-H', draw: 1, usdRepriced: 0.03, usdImputed: 0 }, { job, mode: 'agent-H', draw: 0, usdRepriced: 0.1, usdImputed: 0 }]);
  const probe = usd => held.map(job => ({ policy: 'NR-probe', job, cell: null, mode: 'agent-H', routingUsd: usd, probe: { ran: true, modes: ['direct-H', 'agent-H'], k: 3, costUsd: usd } }));
  // No routingUsd on a recorded row: refused, never charged $0.
  const bare = held.map(job => ({ policy: 'judge-H', job, cell: null, mode: 'agent-H' }));
  assert.throws(() => evaluate({ ...W, recorded: bare, split: 'heldout', ...FAST }), /needs routingUsd/);
  assert.throws(() => commitDecisions({ ...trainOnly(W), meta: W.meta, recorded: bare, reps: 60 }), /needs routingUsd/);
  // Charged below what its probe rows cost: the claims are blocked.
  const low = evaluate({ ...W, recorded: probe(0.05), probes, split: 'heldout', ...FAST });
  assert.equal(low.validity.routing.ok, false);
  assert.match(low.validity.routing.problems[0], /charged \$0\.05 < \$0\.160000 measured on its probe rows/);
  assert.ok(low.blocked.some(b => /routing dollars/.test(b)));
  const fair = evaluate({ ...W, recorded: probe(0.16), probes, split: 'heldout', ...FAST });
  assert.equal(fair.validity.routing.ok, true); assert.equal(fair.validity.routing.checked, held.length);
  assert.equal(routingChecks([{ policy: 'NR-probe', job: held[0], routingUsd: 0.1 }], probes).ok, false, 'a charge with no probe object covers all the probe rows');
  // A routing charge lowered, or a need call changed, after the commit fails L6 (mode alone is not the decision).
  const committed = commitDecisions({ ...trainOnly(W), meta: W.meta, recorded: probe(0.16), reps: 60, createdAt: '2026-10-24T00:00:00Z' });
  const later = evaluate({ ...W, recorded: probe(0.12), probes, committed, split: 'heldout', ...FAST, leak: true, l2Perms: 5 });
  assert.ok(later.leaks.L6.problems.some(p => /changed after commit: NR-probe\|H\d-j0\|\* agent-H \$0\.16 .* -> agent-H \$0\.12/.test(p)), later.leaks.L6.problems.join('\n'));
  const nw = v => held.map(job => ({ policy: 'judge-H', job, cell: null, mode: 'agent-H', routingUsd: 0.09, needsWorkflow: v }));
  const c2 = commitDecisions({ ...trainOnly(W), meta: W.meta, recorded: nw(true), reps: 60 });
  const r2 = commitDecisions({ ...trainOnly(W), meta: W.meta, recorded: nw(false), reps: 60, createdAt: c2.createdAt });
  assert.ok(verifyEnvelope(c2, r2).problems.some(p => /judge-H\|.*needsWorkflow=true -> agent-H \$0\.09 needsWorkflow=false/.test(p)));
  // loadLabels reads label-run's probes.jsonl.
  const dir = mkdtempSync(path.join(tmpdir(), 'nr-probes-'));
  writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(W.meta));
  writeFileSync(path.join(dir, 'matrix.jsonl'), W.rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(path.join(dir, 'probes.jsonl'), probes.map(r => JSON.stringify(r)).join('\n') + '\n');
  assert.equal(loadLabels(dir).probes.length, probes.length);
});

// ------------------------------------------------------------------------------------------ major 6: voided draws
test('major 6: a voided agent draw is listed and blocks claims; it scores as a failure', () => {
  const W = plantedWorld({ train: 4, heldout: 4, jobs: 1, seed: 24 });
  let hit = null;
  const rows = W.rows.map(r => {
    if (hit || r.job !== 'H0-j0' || r.mode !== 'agent-H' || !r.pass) return r;
    hit = r;
    return { ...r, pass: false, rawPass: true, delivered: false, error: 'VOIDED', void: 'nestedModelAttempts=1' };
  });
  const T = needTable(rows, W.builds);
  assert.deepEqual(T.voidedDraws.map(v => [v.job, v.mode, v.task, v.rep, v.reasons[0]]), [['H0-j0', 'agent-H', hit.task, hit.rep, 'nestedModelAttempts=1']]);
  assert.equal(T.voided.length, 0, 'lineage voids stay apart');
  // A void row that still says pass is scored as a failure all the same.
  const T2 = needTable(rows.map(r => (r.void ? { ...r, pass: true, delivered: true } : r)), W.builds);
  assert.equal(T2.cell('H0-j0', 'agent-H').byTask.get(hit.task).get(hit.rep).pass, false);
  // The error code alone (a draw mode) is a void too.
  assert.equal(needTable(rows.map(r => (r.void ? { ...r, void: undefined } : r)), W.builds).voidedDraws.length, 1);
  const R = evaluate({ ...W, rows, split: 'heldout', ...FAST });
  assert.equal(R.validity.voidedDraws.length, 1);
  assert.ok(R.blocked.some(b => /1 voided agent draw/.test(b)), R.blocked.join('\n'));
});

// ------------------------------------------------------------------------------------ major 7: versions and meters
test('major 7: LEGACY rows, mixed arm versions and fallback meters are refused or leave the job unlabelled; the envelope seals the meter', () => {
  const row = (job, mode, t, rep, extra = {}) => ({ job, mode, task: `t${t}`, rep, seed: 610 + t, pass: true, delivered: true, schemaValid: true, usdRepriced: 0.01, ...extra });
  const ok = [0, 1].flatMap(t => [row('j', 'direct-H', t, 0), row('j', 'agent-H', t, 0)]);
  assert.doesNotThrow(() => needTable(ok));
  assert.throws(() => needTable([...ok.slice(1), { ...ok[0], legacy: true }]), /LEGACY row is never pooled/);
  assert.throws(() => needTable([...ok.slice(1), { ...ok[0], evidence: 'LEGACY' }]), /LEGACY/);
  const lin = [0, 1].flatMap(t => [0, 1].map(rep => row('j', 'construct-H', t, rep, { armHash: `c${rep}` })));
  const b = rep => ({ job: 'j', mode: 'construct-H', rep, usd: 0.5 });
  assert.throws(() => needTable([...ok, ...lin], [b(0), b(1), { ...b(2), legacy: true }]), /LEGACY build/);
  // One arm version per (job, mode); per lineage for a lineage mode (each lineage's arm id differs).
  assert.throws(() => needTable(ok.map((r, i) => ({ ...r, armHash: r.mode === 'agent-H' && i === 3 ? 'v2' : 'v1' }))), /j\/agent-H: rows from 2 arm versions \(armHash v1, v2\)/);
  assert.throws(() => needTable(ok.map((r, i) => (i === 3 ? { ...r, armHash: 'v1' } : r))), /arm versions/, 'a row without an armHash is its own version');
  assert.doesNotThrow(() => needTable([...ok, ...lin], [b(0), b(1)]));
  assert.throws(() => needTable([...ok, ...lin.map((r, i) => (i === 3 ? { ...r, armHash: 'cX' } : r))], [b(0), b(1)]), /construct-H lineage 1: rows from 2 arm versions/);
  // A row label-run could not re-price leaves its job unlabelled at every cell (counted, not dropped).
  const L = needLabels(needTable(ok.map((r, i) => (i === 0 ? { ...r, repriced: false } : r))), { cells: GRID, reps: 50 });
  for (const c of GRID) { assert.match(L.at('j', c).unlabelled, /rows not re-priced in direct-H/); assert.equal(L.at('j', c).confident, false); }
  // One meter: no fallback from usdRepriced to usdReported under requireRepriced (evaluate.mjs sets it).
  const noRp = ok.map((r, i) => (i === 0 ? { ...r, usdRepriced: undefined, usdReported: 0.01 } : r));
  assert.doesNotThrow(() => needTable(noRp));
  assert.throws(() => needTable(noRp, [], { requireRepriced: true }), /no finite usdRepriced/);
  const W = plantedWorld({ train: 4, heldout: 4, jobs: 1, seed: 25 });
  assert.throws(() => evaluate({ ...W, rows: W.rows.map((r, i) => (i === 0 ? { ...r, usdRepriced: undefined, usdReported: 0.01 } : r)), split: 'heldout', ...FAST }), /no finite usdRepriced/);
  // The envelope seals the meter and the frozen inputs, and L6 compares them.
  const stageInfo = [{ stage: 'nl1', splits: ['train'], priceTable: 'need-v1-prices@2026-10-14', stamp: 'abc' }];
  const tagged = { rows: trainOnly(W).rows.map(r => ({ ...r, armHash: `${r.mode}-h` })), builds: trainOnly(W).builds };
  const env = commitDecisions({ ...tagged, meta: W.meta, reps: 60, createdAt: '2026-10-24T00:00:00Z', stageInfo });
  assert.deepEqual(env.payload.meter.priceTables, ['need-v1-prices@2026-10-14']); assert.deepEqual(env.payload.meter.stamps, { nl1: 'abc' });
  assert.deepEqual(env.payload.meter.armHashes['agent-H'], ['agent-H-h']);
  const same = commitDecisions({ ...tagged, meta: W.meta, reps: 60, createdAt: env.createdAt, stageInfo });
  assert.equal(verifyEnvelope(env, same).ok, true);
  const moved = structuredClone(same); moved.payload.routerShas['router.mjs'] = 'deadbeef';
  assert.ok(verifyEnvelope(env, moved).problems.some(p => /frozen file router\.mjs changed after commit/.test(p)));
  const retagged = commitDecisions({ rows: tagged.rows.map((r, i) => (i < 10 ? { ...r, usdRepriced: r.usdRepriced + 0.001 } : r)), builds: tagged.builds, meta: W.meta, reps: 60, createdAt: env.createdAt, stageInfo });
  assert.ok(verifyEnvelope(env, retagged).problems.some(p => /trainRows changed after commit/.test(p)));
  const restamped = commitDecisions({ ...tagged, meta: W.meta, reps: 60, createdAt: env.createdAt, stageInfo: [{ ...stageInfo[0], stamp: 'other' }] });
  assert.ok(verifyEnvelope(env, restamped).problems.some(p => /meter .* changed after commit/.test(p)));
  // Two price tables across the stages read: one meter is required, claims are blocked.
  const R = evaluate({ ...W, split: 'heldout', ...FAST, stageInfo: [...stageInfo, { stage: 'nl2', splits: ['heldout'], priceTable: 'other-prices', stamp: null }] });
  assert.ok(R.blocked.some(b => /meter: rows priced with 2 price tables/.test(b)), R.blocked.join('\n'));
  assert.deepEqual(R.validity.meter.unstamped, ['nl2']);
  // loadLabels carries each stage's price table and stamp.
  const dir = mkdtempSync(path.join(tmpdir(), 'nr-meter-'));
  writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(W.meta));
  writeFileSync(path.join(dir, 'rows.jsonl'), W.rows.slice(0, 3).map(r => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ priceTable: 'need-v1-prices@2026-10-14' }));
  writeFileSync(path.join(dir, 'STAMP.json'), JSON.stringify({ stage: 'x' }));
  const S = loadLabels(dir).stageInfo[0];
  assert.equal(S.priceTable, 'need-v1-prices@2026-10-14'); assert.match(S.stamp, /^[0-9a-f]{64}$/); assert.deepEqual(S.splits, ['heldout', 'train']);
});

// ---------------------------------------------------------------------------------------- major 8: the L2 null
test('major 8: L2 needs a null centred at or below 0, and a SUPPORTED or SUPERIOR router must beat its 95th percentile', () => {
  // A label-independent "router" that is a little better than SBS everywhere: the shuffled-label null equals it (Δ = 0.005).
  const W = detWorld([
    ...[0, 1].map(i => ({ id: `T${i}-j0`, cluster: `T${i}`, split: 'train', cost: { 'direct-H': 0, 'agent-H': 0.3, 'agent-O': 0.3 } })),
    ...[0, 1, 2, 3, 4, 5].map(i => ({ id: `H${i}-j0`, cluster: `H${i}`, split: 'heldout', cost: { 'direct-H': 0.03, 'agent-H': 0.025, 'agent-O': 0.3 } })),
  ]);
  const R = evaluate({ ...W, split: 'heldout', policies: [always('NR-static', 'agent-H'), sbsTrain()], reps: 60, bootReps: 0, l2Perms: 20, randomDraws: 20, attacks: false, leak: true });
  const L2 = R.leaks.L2;
  assert.ok(Math.abs(L2.nullMean - 0.005) < 1e-9 && L2.tolerance === 0, JSON.stringify(L2));
  assert.equal(L2.ok, false, 'a null centred above 0 fails L2 (the old 0.01 tolerance passed it)');
  assert.equal(L2.realExceeds95, false);
  assert.equal(R.holm.reject['NR-static'], true, 'p = 1/64 passes Holm');
  assert.equal(R.primary['NR-static'].reading, 'INCONCLUSIVE', 'before the fix: SUPERIOR, BELOW USEFUL EFFECT');
  assert.ok(R.primary['NR-static'].unmet.some(u => /shuffled-label null/.test(u)));
  assert.ok(R.blocked.some(b => /F6/.test(b)));
  const base = { headline: { mean: 0.08, lo: 0.04, hi: 0.12 }, perV: [0.1, 1, 10].map(V => ({ V, lo: 0.01, hi: 0.2 })), vsTuned: { lo: 0.01 }, vsJudge: { lo: 0.01 }, slider: { calibrated: true, predicted: true }, holmReject: true };
  assert.equal(readingOf({ ...base, vsNull: { assessed: true, realExceeds95: true } }).reading, 'SUPPORTED');
  assert.equal(readingOf({ ...base, vsNull: { assessed: true, realExceeds95: false } }).reading, 'INCONCLUSIVE');
  assert.equal(readingOf({ ...base, vsNull: { assessed: false } }).reading, 'INCONCLUSIVE', 'leak tests on but L2 not run: no SUPPORTED');
  assert.equal(shuffledNull({ policy: null }).assessed, false);
});

// --------------------------------------------------------------------------------------- minor 9: the dev reading
test('minor 9: the development reading never reads held-out rows; the CLI refuses a held-out reading without the envelope', () => {
  const W = plantedWorld({ train: 4, heldout: 3, jobs: 2, seed: 26 });
  const withHeld = evaluate({ ...W, split: 'train', ...FAST }), without = evaluate({ ...W, ...trainOnly(W), split: 'train', ...FAST });
  assert.ok(withHeld.validity.ignoredRows > 0); assert.equal(without.validity.ignoredRows, 0);
  for (const n of Object.keys(without.scores)) assert.deepEqual(withHeld.scores[n][HEADLINE.key].perJob, without.scores[n][HEADLINE.key].perJob, n);
  const root = mkdtempSync(path.join(tmpdir(), 'nr-cli9-')), cli = path.join(here, '..', 'evaluate.mjs');
  const dir = path.join(root, 'nl'); mkdirSync(dir);
  writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(W.meta));
  writeFileSync(path.join(dir, 'matrix.jsonl'), W.rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [cli, '--labels', root, '--split', 'heldout'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 2); assert.match(r.stderr, /needs --decisions/);
});

// --------------------------------------------------------------------------------------- minor 10: the slider rule
test('minor 10: the slider monotonicity rule is the preregistered literal rule by default', () => {
  const stub = { stats: (j, m) => ({ s: { a: 0.95, b: 0.96, c: 0.956 }[m] }), usd: (j, c, m) => ({ a: 0.1, b: 0.2, c: 0.3 }[m]) };
  const d = new Map([['j', new Map([0.1, 1, 10].map((V, i) => [makeCell(V, 10).key, { mode: 'abc'[i], routingUsd: 0, pred: { p: [0.95, 0.96, 0.956][i], usd: [0.1, 0.2, 0.3][i] } }]))]]);
  const s = sliderCalibration(stub, d, ['j']);
  assert.equal(s.monotoneTolP, 0); assert.equal(s.monotone, false); assert.equal(s.calibrated, false);
});

// ---------------------------------------------------------------------------------- minor 11: C7a's interval
test('minor 11: C7a reads the exact joint interval of PREREG §7, and an unpowered count reads INCONCLUSIVE, not REFUTED', () => {
  const stubFor = (pos, neg, hitPos, hitNeg) => {
    const jobs = [...Array.from({ length: pos }, (_, i) => `p${i}`), ...Array.from({ length: neg }, (_, i) => `n${i}`)];
    const label = j => (j[0] === 'p' ? 'workflow' : 'no-workflow');
    const labels = { at: j => ({ confident: true, label: label(j), unlabelled: null }) };
    const call = j => (j[0] === 'p' ? Number(j.slice(1)) < hitPos : Number(j.slice(1)) >= hitNeg);
    const dec = new Map(jobs.map(j => [j, new Map([['V=1 N=1 W=1V', { mode: 'agent-H', needsWorkflow: call(j) }]])]));
    return { jobs, labels, dec };
  };
  const { jobs, labels, dec } = stubFor(6, 6, 5, 6);
  const x = needDetection(labels, dec, jobs, makeCell(1, 1));
  assert.deepEqual(x.counts, { tp: 5, fn: 1, tn: 6, fp: 0 });
  assert.deepEqual({ ...x.balancedAccuracy }, balancedAccuracyInterval({ tp: 5, fn: 1, tn: 6, fp: 0 }));
  assert.equal(x.balancedAccuracy.method, 'exact joint (unconditional test inversion)');
  const old = (wilson(5, 6).lo + wilson(6, 6).lo) / 2;
  assert.ok(Math.abs(old - 0.523) < 0.002 && Math.abs(x.balancedAccuracy.lo - old) > 0.01, `${x.balancedAccuracy.lo} vs the old ${old}`);
  // One confident positive and seven negatives, all right: a perfect H0 is not powered, so C7a cannot be REFUTED.
  const one = stubFor(1, 7, 1, 7), y = needDetection(one.labels, one.dec, one.jobs, makeCell(1, 1));
  const rd = readC7a({ h0: y.counts, tunedPoint: 0.5, coverage: 1 });
  assert.equal(rd.reading, 'INCONCLUSIVE'); assert.equal(rd.f12, false); assert.match(rd.why, /not powered/);
  assert.ok((wilson(1, 1).lo + wilson(7, 7).lo) / 2 <= 0.5, 'the old construction read REFUTED (F12) here');
  assert.equal(readC7a({ h0: y.counts, fit: { fit: false, why: 'H0 not fitted: 0 confident positive(s) < 2' } }).reading, 'INCONCLUSIVE');
});

// --------------------------------------------------------------------------------- minor 12: smaller silent defaults
test('minor 12: imputed dollars per (job, cell); untested tolerances reported; example seeds required; two matrix files refused; L3 fallback complete', () => {
  // (a) The imputed rule is per cell: construct-H's build is 90% imputed, which matters at N = 1 and not at N = 100.
  const rows = [], row = (mode, t, pass, usd, extra = {}) => ({ job: 'j', mode, task: `t${t}`, rep: 0, seed: 610 + t, pass, delivered: true, schemaValid: true, usdRepriced: usd, usdImputed: 0, ...extra });
  for (let t = 0; t < 20; t++) { rows.push(row('direct-H', t, t < 17, 0.01)); rows.push(row('construct-H', t, true, 0.05)); rows.push(row('agent-O', t, t < 10, 0.1, { usdImputed: 0.4 })); }
  const L = needLabels(needTable(rows, [{ job: 'j', mode: 'construct-H', rep: 0, usd: 0.1, usdImputed: 0.9 }]), { cells: [makeCell(1, 1), makeCell(1, 100)], reps: 100 });
  assert.match(L.at('j', makeCell(1, 1)).unlabelled, /imputed dollars over 0.3 in construct-H/);
  assert.equal(L.at('j', makeCell(1, 100)).unlabelled, null, 'at N = 100 the build is a small share, and agent-O (80% imputed) cannot reach A');
  assert.equal(L.at('j', makeCell(1, 100)).label, 'workflow');
  // (b) A delivered row of a job with a tolerance spec but no score is reported, not passed silently.
  const fr = [0, 1, 2].flatMap(t => [{ job: 'k', mode: 'direct-H', task: `t${t}`, rep: 0, seed: 610 + t, pass: true, delivered: true, score: t === 1 ? undefined : 0.99, usdRepriced: 0.01 },
    { job: 'k', mode: 'agent-H', task: `t${t}`, rep: 0, seed: 610 + t, pass: true, delivered: true, score: 0.99, usdRepriced: 0.1 }]);
  const F = fragility(fr, [], { tolerance: () => ({ scoreThreshold: 0.97 }) });
  assert.deepEqual(F.untested, ['k']); assert.deepEqual(F.unscored, [{ job: 'k', mode: 'direct-H', task: 't1', rep: 0 }]);
  // (c) Unrecorded example seeds are a problem, not assumed to be 601-603.
  const W = plantedWorld({ train: 2, heldout: 1, jobs: 1, seed: 27 });
  const T = needTable(W.rows, W.builds), meta = { ...W.meta, 'T0-j0': { ...W.meta['T0-j0'], exampleSeeds: undefined } };
  assert.ok(seedChecks(T, meta).problems.some(p => /T0-j0: example seeds not recorded/.test(p)));
  // (d) Two matrix files in one stage are refused.
  const dir = mkdtempSync(path.join(tmpdir(), 'nr-two-'));
  writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(W.meta));
  for (const f of ['matrix.jsonl', 'rows.jsonl']) writeFileSync(path.join(dir, f), W.rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  assert.throws(() => loadLabels(dir), /both matrix.jsonl and rows.jsonl exist/);
  // (e) The family-identity router sends an unseen family to SBS-train exactly (complete pool), never to a mode some TRAIN job lacks.
  const D = detWorld([
    { id: 'A-j0', cluster: 'A', split: 'train', cost: { 'agent-H': 0.1, 'agent-O': 0.3 } },
    { id: 'B-j0', cluster: 'B', split: 'train', cost: { 'direct-H': 0, 'agent-H': 0.1, 'agent-O': 0.3 } },
    { id: 'C-j0', cluster: 'C', split: 'heldout', cost: { 'direct-H': 0, 'agent-H': 0.1, 'agent-O': 0.3 } },
  ]);
  const fit = fitOn({ ...trainOnly(D), meta: D.meta, reps: 30 });
  const ctx = makeContext(fit.labels, fit.TRAIN, D.meta, { modes: fit.modes });
  const avail = ['direct-H', 'agent-H', 'agent-O'], view = publicView('C-j0', D.meta['C-j0'], avail), sv = shortcutView('C-j0', D.meta['C-j0'], avail);
  const fi = familyIdentityRouter().fit(ctx)(view, HEADLINE, sv), sb = sbsTrain().fit(ctx)(view, HEADLINE);
  assert.equal(sb.mode, 'agent-H'); assert.equal(fi.mode, sb.mode, 'the old fallback ranked direct-H first on the one TRAIN job that has it');
});

// ------------------------------------------------------------------- major 7, second pass: builds, settings, price tables
test('major 7 (second pass): builds stay on the one meter; one arm setting per (job, mode) across lineages; one price table', () => {
  const stamp = (settingsSha, priceTable = 'need-v1-prices@2026-10-14') => ({ stageSha: 's', settingsSha, prompts: {}, priceTable });
  const row = (mode, t, rep, extra = {}) => ({ job: 'j', mode, task: `t${t}`, rep, seed: 610 + t, pass: t === 0, delivered: true, schemaValid: true, usdRepriced: 0.01, usdImputed: 0, ...extra });
  const rows = (st = {}) => [0, 1].flatMap(t => [row('direct-H', t, 0, { stamp: stamp('d1') }), ...[0, 1].map(rep => row('construct-H', t, rep, { armHash: `c${rep}`, stamp: st[rep] ?? stamp('c1') }))]);
  const b = (rep, extra = {}) => ({ job: 'j', mode: 'construct-H', rep, usd: 0.5, usdRepriced: 0.5, stamp: stamp('c1'), ...extra });
  assert.doesNotThrow(() => needTable(rows(), [b(0), b(1)], { requireRepriced: true }));
  // (a) A build charged only at the CLI's figure: refused under the one meter (before: usdReported was used silently).
  assert.throws(() => needTable(rows(), [b(0), { job: 'j', mode: 'construct-H', rep: 1, usdReported: 0.5, stamp: stamp('c1') }], { requireRepriced: true }), /build row j\/construct-H\/1: no finite usdRepriced/);
  assert.doesNotThrow(() => needTable(rows(), [b(0), { job: 'j', mode: 'construct-H', rep: 1, usdReported: 0.5 }]), 'outside the strict meter the v0 fallback stays');
  assert.throws(() => needTable(rows(), [b(0), b(1, { usd: 0.4 })], { requireRepriced: true }), /usd 0.4 and usdRepriced 0.5 disagree/);
  assert.equal(needTable(rows(), [b(0), { ...b(1), usd: undefined }], { requireRepriced: true }).cell('j', 'construct-H').lineageMap.get(1).usd, 0.5, 'usdRepriced alone is enough');
  const W = plantedWorld({ train: 3, heldout: 3, jobs: 1, seed: 28 });
  const noRp = W.builds.map((x, i) => (i === 0 ? { ...x, usd: undefined, usdReported: x.usd } : x));
  assert.throws(() => evaluate({ ...W, builds: noRp, split: 'heldout', ...FAST }), /no finite usdRepriced/);
  // (b) A build label-run could not re-price leaves its job unlabelled at every cell, like such a row.
  const L = needLabels(needTable(rows(), [b(0), b(1, { repriced: false })]), { cells: [HEADLINE], reps: 20 });
  assert.match(L.at('j', HEADLINE).unlabelled, /rows not re-priced in construct-H/); assert.equal(L.at('j', HEADLINE).confident, false);
  assert.equal(needLabels(needTable(rows(), [b(0), b(1)]), { cells: [HEADLINE], reps: 20 }).at('j', HEADLINE).unlabelled, null);
  // (c) Lineage 1 built and run under edited arm settings (a top-up in a later stage): each lineage has its own armHash, so
  // only the stamp shows it. Refused in the rows and in the builds.
  assert.throws(() => needTable(rows({ 1: stamp('c2') }), [b(0), b(1)]), /j\/construct-H: rows or builds under 2 arm settings \(stamp.settingsSha c1, c2\)/);
  assert.throws(() => needTable(rows(), [b(0), b(1, { stamp: stamp('c2') })]), /under 2 arm settings/);
  assert.doesNotThrow(() => needTable(rows({ 1: stamp('c1') }), [b(0), b(1, { stamp: { ...stamp('c1'), stageSha: 'later' } })]), 'another stage, same settings: pooled');
  // (d) One price table per table; across TRAIN and the evaluated split, evaluate blocks the claims.
  assert.throws(() => needTable(rows({ 1: stamp('c1', 'other-prices') }), [b(0), b(1)]), /priced with 2 price tables \(stamp.priceTable need-v1-prices@2026-10-14, other-prices\)/);
  const tag = (x, pt) => ({ ...x, stamp: stamp(`${x.mode}-s`, pt) });
  const mixed = { rows: W.rows.map(r => tag(r, W.meta[r.job].split === 'train' ? 'p1' : 'p2')), builds: W.builds.map(x => tag(x, W.meta[x.job].split === 'train' ? 'p1' : 'p2')) };
  const R = evaluate({ ...W, ...mixed, split: 'heldout', ...FAST });
  assert.deepEqual(R.validity.meter.priceTables, ['p1', 'p2']);
  assert.ok(R.blocked.some(x => /meter: rows priced with 2 price tables \(p1, p2\)/.test(x)), R.blocked.join('\n'));
  const one = evaluate({ ...W, rows: W.rows.map(r => tag(r, 'p1')), builds: W.builds.map(x => tag(x, 'p1')), split: 'heldout', ...FAST });
  assert.deepEqual(one.validity.meter.priceTables, ['p1']); assert.ok(!one.blocked.some(x => /meter/.test(x)));
});
