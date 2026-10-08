#!/usr/bin/env node
// Runs every control against the oracle and writes controls/report.json (raw numbers; nothing is hand-edited).
//   node experiments/replicate/items/n8n-20281/controls/run-controls.mjs [--seeds 20]
// The ORIGINAL-definition controls need /opt/corpus/n8n/workflows/20281.json.gz (sha256-pinned); without it they are recorded as unavailable.
import { writeFileSync } from 'node:fs';
import * as bed from '../index.mjs';
import { configFor } from '../spec.mjs';
import { replay, driveSync } from '../env.mjs';
import { snapshot as freezeSnapshot } from '../freeze.mjs';
import { readJson } from '../spec.mjs';
import { makeFaithful } from './reference.mjs';
import { makeImproved } from './improved.mjs';
import { runKeywordSolution } from './heuristic.mjs';
import { originalAvailable, loadOriginal, rebind, makeOriginalHandler, analyse, ORIGINAL } from './n8n-emulator.mjs';
import { canonical, hashOf } from '../../../../../beds/lib/canonical.mjs';

const N = Number(process.argv[process.argv.indexOf('--seeds') + 1]) || 20;
const seeds = Array.from({ length: N }, (_, i) => i);
const task = (seed, difficulty, variant) => bed.generate({ seed, split: 'dev', difficulty, variant });
const tally = (arr, f) => arr.reduce((n, x) => n + (f(x) ? 1 : 0), 0);
const avg = (arr, f) => Number((arr.reduce((a, x) => a + f(x), 0) / arr.length).toFixed(4));
const timed = f => { const t = Date.now(); const v = f(); return [v, Date.now() - t]; };
const codesOf = r => Object.keys(r.details.violationsByCode ?? {});
const gatesFailed = r => Object.entries(r.details.gates ?? {}).filter(([, v]) => !v).map(([k]) => `gate:${k}`);
const merge = (target, keys) => { for (const k of keys) target[k] = (target[k] ?? 0) + 1; };

const report = { item: bed.ITEM, harness: bed.VERSION, seeds: N, status: 'development/diagnostic; not a sealed evaluation', freeze: freezeSnapshot().files, controls: {} };
const freezeFile = readJson('./fixtures/FREEZE.json');
report.freezeMatches = Object.entries(freezeFile.files).every(([f, h]) => freezeSnapshot().files[f] === h);

// 1. known-good references -----------------------------------------------------------------------------------------------------------------
for (const [name, variant, mk] of [['faithful-transcription', 'T2', cfg => makeFaithful(cfg)], ['improved', 'T3', cfg => makeImproved(cfg)]]) {
  const byDifficulty = {};
  for (const d of [1, 2, 3, 4, 5]) {
    const n = d === 3 ? N : 3;
    const rs = seeds.slice(0, n).map(s => { const t = task(s, d, variant); return bed.oracle(t, driveSync(t, mk(configFor(d)))); });
    byDifficulty[`d${d}`] = { seeds: n, pass: tally(rs, r => r.pass), meanScore: avg(rs, r => r.score), categoryAccuracy: rs[0].details.accuracy.category, priorityAccuracy: rs[0].details.accuracy.priority,
      meanModelUsd: avg(rs, r => r.details.cost.model.usd), meanModelCalls: avg(rs, r => r.details.cost.model.calls), meanExternalCalls: avg(rs, r => r.details.cost.externalCalls), meanLatencyMs: avg(rs, r => r.details.cost.latencyMs) };
  }
  report.controls[name] = { variant, byDifficulty };
}
{ // The faithful transcription judged as a T3 answer: which probes and cost targets does the original fail?
  const probeFails = {}, codes = {};
  const rs = seeds.slice(0, 5).map(s => { const t = task(s, 3, 'T3'); return bed.oracle(t, driveSync(t, makeFaithful(configFor(3)))); });
  for (const r of rs) for (const p of r.details.probes) if (!p.pass) probeFails[p.id] = (probeFails[p.id] ?? 0) + 1;
  for (const r of rs) for (const p of r.details.probes) for (const c of Object.keys(p.codes)) codes[c] = (codes[c] ?? 0) + 1;
  report.controls['faithful-transcription'].onT3 = { seeds: rs.length, corePass: tally(rs, r => r.details.corePass), probesFailedBySeedCount: probeFails, probeCodesBySeedCount: codes, costWithinTarget: tally(rs, r => r.details.costOk), pass: tally(rs, r => r.pass) };
  const imp = seeds.slice(0, 5).map(s => { const t = task(s, 3, 'T3'); return bed.oracle(t, driveSync(t, makeImproved(configFor(3)))); });
  const t0 = task(0, 3, 'T3');
  report.controls.improved.onT3 = { seeds: imp.length, pass: tally(imp, r => r.pass), probesPassed: imp.map(r => r.details.probes.filter(p => p.pass).length), ratios: { modelUsd: avg(imp, r => r.details.cost.model.usd / t0.budget.baseline.modelUsd), externalCalls: avg(imp, r => r.details.cost.externalCalls / t0.budget.baseline.externalCalls), latencyMs: avg(imp, r => r.details.cost.latencyMs / t0.budget.baseline.latencyMs) }, target: t0.budget.target, baseline: t0.budget.baseline };
}

// 2. known-bad controls ---------------------------------------------------------------------------------------------------------------------
report.controls.bad = {};
for (const c of bed.badControls) {
  const diffs = c.appliesAt ?? [3];
  const runs = diffs.flatMap(d => seeds.slice(0, d === 3 ? N : 3).map(s => { const t = task(s, d, 'T2'); return { d, r: bed.oracle(t, c.make(t)) }; }));
  const codes = {}; for (const { r } of runs) merge(codes, [...codesOf(r), ...gatesFailed(r)]);
  report.controls.bad[c.name] = { describe: c.describe, difficulties: diffs, runs: runs.length, passedOracle: tally(runs, x => x.r.pass), meanScore: avg(runs, x => x.r.score), expected: c.expect,
    expectedHit: c.expect.map(e => tally(runs, x => [...codesOf(x.r), ...gatesFailed(x.r)].includes(e))), seenBySeedCount: codes };
}

// 3. the ORIGINAL definition, executed in the emulator -------------------------------------------------------------------------------------------
const effectSig = (records, rows) => records.map(sr => sr.events.map(ev => ({
  m: ev.calls.filter(c => c.name === 'model.complete').length,
  e: ev.calls.flatMap(c => c.effects ?? []).map(x => [x.type, x.key ?? x.channel ?? x.provider ?? '', (x.to ?? []).join('|'), x.type === 'mail.send' || x.type === 'mail.draft' ? x.provider : ''].join(':')),
})));
const AUDIT_COLS = ['Source', 'From Email', 'Customer Request', 'Category', 'Priority', 'Confidence', 'Jira Key', 'Follow-up', 'Slack Sent', 'Customer Ack', 'Status', 'Classified By', 'Message ID'];
const auditSig = rec => rec.dump.rows.map(r => AUDIT_COLS.map(c => r[c]).join('|'));

if (!originalAvailable()) report.controls.original = { available: false, why: `${ORIGINAL.rawPath} is not present in this environment` };
else {
  const def = loadOriginal();
  const info = analyse(def); delete info.byName;
  const orig = { available: true, sha256: ORIGINAL.sha256, how: 'controls/n8n-emulator.mjs executes the definition\'s own nodes, code and expressions against the mock services (see the header of that file for what is assumed)', definition: info };
  const allHandlers = [];
  const runOne = (wf, cfg, variant, s, d, opts) => { const t = task(s, d, variant); const h = makeOriginalHandler(wf, cfg, opts); allHandlers.push(h); const rec = driveSync(t, h); return { t, rec, h, r: bed.oracle(t, rec) }; };
  const byDifficulty = {};
  for (const d of [1, 2, 3, 4, 5]) {
    const cfg = configFor(d), wf = rebind(def, cfg);
    const rs = seeds.slice(0, d === 3 ? N : 3).map(s => runOne(wf, cfg, 'T2', s, d));
    byDifficulty[`d${d}`] = { seeds: rs.length, pass: tally(rs, x => x.r.pass), violations: rs.reduce((n, x) => n + x.r.details.coreViolations, 0), handlerErrors: rs.reduce((n, x) => n + x.rec.meta.handlerErrorCount, 0),
      categoryAccuracy: rs[0].r.details.accuracy.category, priorityAccuracy: rs[0].r.details.accuracy.priority, fidelity: rs[0].r.details.fidelity, modelCalls: rs[0].r.details.cost.model.calls, modelUsd: rs[0].r.details.cost.model.usd, externalCalls: rs[0].r.details.cost.externalCalls, latencyMs: rs[0].r.details.cost.latencyMs,
      binding: d === 3 ? wf.__binding : undefined };
  }
  orig.byDifficulty = byDifficulty;
  // as a T3 answer: the probes and the cost targets
  { const cfg = configFor(3), wf = rebind(def, cfg);
    const rs = seeds.slice(0, 5).map(s => runOne(wf, cfg, 'T3', s, 3));
    const probeFails = {}; for (const x of rs) for (const p of x.r.details.probes) if (!p.pass) probeFails[p.id] = (probeFails[p.id] ?? 0) + 1;
    orig.onT3 = { seeds: rs.length, corePass: tally(rs, x => x.r.details.corePass), probesFailedBySeedCount: probeFails, costWithinTarget: tally(rs, x => x.r.details.costOk), pass: tally(rs, x => x.r.pass) };
    const primary = [...allHandlers];                                              // runs of the unmutated definition (the mutants run later)
    const union = (f) => new Set(primary.flatMap(h => [...f(h)]));
    const seenNodes = union(h => h.coverage.nodes), seenExpr = union(h => h.coverage.expressionsEvaluated);
    orig.coverage = { nodesExecuted: seenNodes.size, of: info.nodes, notExecuted: [...analyse(def).byName.keys()].filter(n => !seenNodes.has(n)), expressionsEvaluated: seenExpr.size, expressionsInDefinition: info.expressionsUnique,
      nodeErrorsContinued: [...new Set(primary.flatMap(h => h.coverage.nodeErrors.map(e => `${e.node}: ${e.message.replace(/\d{4,}/g, '#')}`)))], executionErrors: primary.flatMap(h => h.coverage.executionErrors).slice(0, 5),
      note: 'union over the unmutated runs at difficulties 1-5 (acknowledgement modes off, send, draft; Teams on and off) and the T3 probe scenarios' };
    // cost of the original vs the faithful transcription's baseline (the baseline uses a re-worded prompt of the same size)
    const t0 = task(0, 3, 'T3');
    orig.costVsBaseline = { originalModelUsd: rs[0].r.details.cost.model.usd, baselineModelUsd: t0.budget.baseline.modelUsd, ratio: Number((rs[0].r.details.cost.model.usd / t0.budget.baseline.modelUsd).toFixed(4)), externalCalls: [rs[0].r.details.cost.externalCalls, t0.budget.baseline.externalCalls] };
  }
  // trace identity: emulated original vs the independent transcription (effects per mail and audit rows)
  { let same = 0, total = 0, firstDiff = null;
    for (const d of [1, 2, 3, 4, 5]) for (const s of seeds.slice(0, d === 3 ? 6 : 2)) {
      const t = task(s, d, 'T3'), cfg = configFor(d);
      const a = replay(t, driveSync(t, makeOriginalHandler(rebind(def, cfg), cfg)).actions).env._records();
      const b = replay(t, driveSync(t, makeFaithful(cfg)).actions).env._records();
      const sa = canonical({ e: effectSig(a), r: a.map(auditSig) }), sb = canonical({ e: effectSig(b), r: b.map(auditSig) });
      total++; if (sa === sb) same++; else firstDiff ??= { seed: s, difficulty: d };
    }
    orig.traceIdenticalToTranscription = { identical: same, of: total, firstDiff, compared: 'per mail: model call count and the committed effects (type, key/channel, recipient, mail service); audit rows on the columns ' + AUDIT_COLS.join(', ') }; }
  // broken variants of the original definition
  const MUTANTS = {
    'no-dedupe': { describe: 'the "Check If Ticket Exists" condition is always false: every escalation creates a ticket', expect: ['JIRA_CREATE_UNEXPECTED'], apply: wf => { const n = wf.nodes.find(x => x.name === 'Check If Ticket Exists'); n.parameters.conditions.conditions[0].leftValue = '={{ false }}'; } },
    'ack-mode-inverted': { describe: 'the acknowledgement route sends where draft is configured and drafts where send is configured', appliesAt: [2, 3, 4, 5], expect: ['ACK_MODE'], apply: wf => {
      const n = wf.nodes.find(x => x.name === 'Build Acknowledgement Reply'); n.parameters.jsCode = n.parameters.jsCode.replace("(mode === 'send' ? 'gmail-send' : 'gmail-draft')", "(mode === 'send' ? 'gmail-draft' : 'gmail-send')");
      const o = wf.nodes.find(x => x.name === 'Send Outlook Reply'); o.parameters.options.saveAsDraft = "={{ $json.ackMode !== 'draft' }}"; } },
    'confidence-gate-removed': { describe: 'the escalate rule ignores the confidence threshold', expect: ['JIRA_CREATE_UNEXPECTED', 'gate:ambiguousReview'], apply: wf => { const n = wf.nodes.find(x => x.name === 'Route by Classification Outcome'); const c = n.parameters.rules.values[0].conditions.conditions[0]; c.leftValue = c.leftValue.replace(" && Number($json.confidence) >= Number($json.minConfidence)", ''); } },
    'filter-removed': { describe: 'no internal domain and no automated-sender pattern is configured', expect: ['FILTER_MODEL_CALL'], apply: wf => { for (const a of wf.nodes.find(x => x.name === 'Set Workflow Configuration').parameters.assignments.assignments) if (['internalDomains', 'ignoreSenderPatterns'].includes(a.name)) a.value = ''; } },
    'everything-bug': { describe: 'the combine step overwrites the category with Bug', expect: ['gate:categoryAccuracy'], apply: wf => { const n = wf.nodes.find(x => x.name === 'Combine Email and Classification'); n.parameters.jsCode = n.parameters.jsCode.replace("category: ok ? ai.category : 'Unclassified'", "category: ok ? 'Bug' : 'Unclassified'"); } },
  };
  orig.mutants = {};
  for (const [name, m] of Object.entries(MUTANTS)) {
    const diffs = m.appliesAt ?? [3];
    const runs = diffs.flatMap(d => seeds.slice(0, 3).map(s => { const cfg = configFor(d); const wf = rebind(def, cfg); m.apply(wf); return runOne(wf, cfg, 'T2', s, d).r; }));
    const seen = {}; for (const r of runs) merge(seen, [...codesOf(r), ...gatesFailed(r)]);
    orig.mutants[name] = { describe: m.describe, difficulties: diffs, runs: runs.length, passedOracle: tally(runs, r => r.pass), expected: m.expect, expectedHit: m.expect.map(e => tally(runs, r => [...codesOf(r), ...gatesFailed(r)].includes(e))), seenBySeedCount: seen };
  }
  report.controls.original = orig;
}

// 4. trivial solutions and the triviality attack -------------------------------------------------------------------------------------------
{
  const t = task(0, 3, 'T2');
  const nothing = bed.oracle(t, driveSync(t, () => {})), empty = bed.oracle(t, { actions: [] });
  const kw = seeds.slice(0, 5).map(s => { const tt = task(s, 3, 'T2'); return bed.oracle(tt, runKeywordSolution(tt)); });
  report.controls.trivial = { 'do-nothing': { pass: nothing.pass, score: nothing.score, codes: codesOf(nothing) }, empty: { pass: empty.pass, score: empty.score },
    keywordRule: { describe: 'faithful plumbing + a ~25-line keyword classifier, no model; written once without tuning', seeds: kw.length, pass: tally(kw, r => r.pass), categoryAccuracy: kw[0].details.accuracy.category, priorityAccuracy: kw[0].details.accuracy.priority,
      ambiguousReview: kw[0].details.ambiguousReview, clearEscalation: kw[0].details.clearEscalation, gatesFailed: gatesFailed(kw[0]) } };
}

// 5. determinism and speed ----------------------------------------------------------------------------------------------------------------
{
  const a = task(3, 4, 'T3'), b = task(3, 4, 'T3');
  const [va, ms] = timed(() => bed.oracle(a, bed.referenceSolve(a)));
  const vb = bed.oracle(b, bed.referenceSolve(b));
  const [, genMs] = timed(() => task(7, 5, 'T3'));
  report.determinism = { tasksEqual: canonical(a) === canonical(b), verdictsEqual: canonical(va) === canonical(vb), taskHash: hashOf(a), oracleMsT3: ms, generateMsT3d5: genMs };
}

writeFileSync(new URL('./report.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
const summary = {
  freezeMatches: report.freezeMatches, faithful: report.controls['faithful-transcription'].byDifficulty.d3.pass + '/' + N, improvedT3: report.controls.improved.onT3.pass + '/' + report.controls.improved.onT3.seeds,
  badPassing: Object.entries(report.controls.bad).filter(([, v]) => v.passedOracle).map(([k]) => k), original: report.controls.original.available ? { d3: report.controls.original.byDifficulty.d3.pass + '/' + N, mutantsPassing: Object.entries(report.controls.original.mutants).filter(([, v]) => v.passedOracle).map(([k]) => k), trace: report.controls.original.traceIdenticalToTranscription } : 'unavailable',
  trivial: { nothing: report.controls.trivial['do-nothing'].pass, keyword: report.controls.trivial.keywordRule.pass },
};
console.log(JSON.stringify(summary, null, 1));
