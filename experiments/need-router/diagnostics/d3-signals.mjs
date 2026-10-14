// D3: ex-ante against post-hoc (Dekoninck, Baader and Vechev, "A Unified Approach to Routing and Cascading"; DESIGN §7 M0 item 10).
// Routing pays when quality can be estimated BEFORE running a mode; cascading pays only when estimates made AFTER seeing the output
// are much better. Do deployable post-hoc signals predict the oracle better than the structure features the router reads?
//   unit        one delivered answer of one archived arm; the target is the oracle pass flag
//   ex-ante     the 8 trusted structure features of the task (regenerated from the task key; the taskHash is checked against the archive)
//   post-hoc    signals a user could see without the oracle: schema validity, agent turns and tool uses, the run's cost, latency, output
//               tokens, workflow node calls and escalations, the workflow's own verdict. NEVER score, oracle details or the pass flag.
//   primary     two parameter-free scores with a direction fixed in advance (more input tokens, or a costlier run, means a lower chance of
//               a pass): AUC of -logInputTokens (ex-ante) against AUC of -logCost (post-hoc); nothing is fitted, so there is no
//               leave-one-out bias at these sample sizes
//   secondary   ridge logistic regression (lambda 3) on the whole feature vector, leave-one-TASK-out (all trials of a task are held out
//               together), AUC of the pooled out-of-fold predictions; the post-hoc vector is the arm kind's signals without wall time,
//               which DESIGN §2 calls confounded by concurrency and stalls. Leave-one-out AUC is biased below 0.5 for weak signals.
//               Intervals are seeded bootstraps over tasks of the AUC difference.
//   scope       delivered answers only: a timeout or crash is itself a free post-hoc signal, so the question is whether the signals
//               separate right from wrong among answers the user would actually receive (the silent misses that W x q charges)
// Within one family the structure features are nearly constant across tasks, so ex-ante AUC is bounded by that; the router decides per
// job, not per task. This diagnostic measures the instance-level gap Dekoninck et al. describe, not the job-level decision.
// Also reported: each workflow arm's own verdict against the oracle (a first, tiny F11-style false-pass rate on archived runs).
// Evidence grade: LEGACY/dev.
import { makeTasks, loadFamily } from '../../lib/beds.mjs';
import { taskFeatures } from '../features.mjs';
import { TRUSTED8 } from './census.mjs';
import { auc, fitLogistic, mean, quantile, rng, round } from './common.mjs';
import { clopperPearson } from '../../lib/stats-ebed.mjs';

export const POSTHOC_NAMES = Object.freeze(['schemaInvalid', 'logTurns', 'logTools', 'logCost', 'logLatency', 'logTokensOut', 'logCalls', 'escalations', 'verdictFail']);
const L = x => (Number.isFinite(x) ? Math.log10(1 + Math.max(0, x)) : null);
/** The deployable post-hoc signals of a row (null = not recorded for this arm). Reads no oracle field. */
export function postHocSignals(r) {
  return {
    schemaInvalid: r.schemaValid === false ? 1 : 0, logTurns: L(r.turns), logTools: L(r.tools), logCost: L(r.usdReported), logLatency: L(r.latencyMs),
    logTokensOut: L(r.tokensOut), logCalls: L(r.calls), escalations: Number.isFinite(r.escalations) ? r.escalations : null,
    verdictFail: r.verdict == null ? null : r.verdict === 'pass' ? 0 : 1,
  };
}
/** The fitted post-hoc vector per arm kind: DESIGN's named signals (schema validity, turns, cost) and each kind's analogue of work done. */
export const POSTHOC_BY_KIND = Object.freeze({
  agent: ['schemaInvalid', 'logTurns', 'logTools', 'logCost'], direct: ['schemaInvalid', 'logCost', 'logTokensOut'],
  workflow: ['schemaInvalid', 'logCost', 'logCalls', 'escalations', 'verdictFail'], script: ['schemaInvalid', 'logCost', 'logCalls'],
});
const KIND = mode => (/^direct/.test(mode) ? 'direct' : /^agent/.test(mode) ? 'agent' : /^(hand|wf)-/.test(mode) ? 'workflow' : /^script-/.test(mode) ? 'script' : null);

/** Structure features of the tasks behind the rows: Map(taskKey -> {vector, hashOk}). Regenerates tasks (code only, no oracle). */
export async function structureOf(rows) {
  const keys = new Map();
  for (const r of rows) keys.set(r.taskKey, r.taskHash);
  const out = new Map(), fams = new Map();
  for (const [taskKey, taskHash] of keys) {
    const [family, split, d, s] = taskKey.split(':');
    const fam = fams.get(family) ?? fams.set(family, await loadFamily(family)).get(family);
    const [t] = await makeTasks(family, { split, seeds: [Number(s.slice(1))], difficulty: Number(d.slice(1)) });
    const f = taskFeatures(t.task, fam.outputSchema);
    out.set(taskKey, { vector: TRUSTED8.map(k => f[k]), hashOk: !taskHash || t.taskHash === taskHash });
  }
  return out;
}

function oofPredictions(rows, featureOf, y, { lambda = 1 } = {}) {
  const pred = new Array(rows.length).fill(null);
  for (const t of new Set(rows.map(r => r.taskKey))) {
    const tr = [], te = [];
    rows.forEach((r, i) => (r.taskKey === t ? te : tr).push(i));
    const m = fitLogistic(tr.map(i => featureOf(rows[i])), tr.map(i => y[i]), { lambda });
    for (const i of te) pred[i] = m.predict(featureOf(rows[i]));
  }
  return pred;
}

/** AUCs of one (job, mode) group. `structure` is Map(taskKey -> {vector}). Returns a `skipped` reason when the group cannot be scored. */
export function evaluateGroup(rows, structure, { kind = 'agent', boot = 1000, seed = 20261014, minEach = 4, lambda = 3 } = {}) {
  const y = rows.map(r => (r.pass ? 1 : 0));
  const passes = y.reduce((a, b) => a + b, 0), fails = rows.length - passes;
  if (passes < minEach || fails < minEach) return { skipped: `needs >= ${minEach} passes and >= ${minEach} failures among delivered answers (has ${passes} / ${fails})`, rows: rows.length, passes, fails };
  const sig = rows.map(postHocSignals), idx = new Map(rows.map((r, i) => [r, i]));
  const varies = n => sig.some(x => x[n] !== null) && new Set(sig.map(x => x[n])).size > 1;
  const names = (POSTHOC_BY_KIND[kind] ?? []).filter(varies);
  const exFeat = r => structure.get(r.taskKey).vector, tokIdx = TRUSTED8.indexOf('logInputTokens');
  const postFeat = r => names.map(n => sig[idx.get(r)][n] ?? 0), both = r => [...exFeat(r), ...postFeat(r)];
  const tasks = [...new Set(rows.map(r => r.taskKey))], byTask = new Map(tasks.map(t => [t, rows.map((r, i) => (r.taskKey === t ? i : -1)).filter(i => i >= 0)]));
  // Parameter-free scores (direction fixed in advance: a bigger value predicts a failure).
  const dirScores = { logInputTokens: rows.map(r => -exFeat(r)[tokIdx]) };
  for (const n of POSTHOC_NAMES) if (varies(n)) dirScores[n] = sig.map(x => -(x[n] ?? 0));
  const directional = Object.fromEntries(Object.entries(dirScores).map(([n, v]) => [n, round(auc(v, y), 3)]));
  const pEx = oofPredictions(rows, exFeat, y, { lambda }), pPost = names.length ? oofPredictions(rows, postFeat, y, { lambda }) : null, pBoth = names.length ? oofPredictions(rows, both, y, { lambda }) : null;
  const boots = (a, b) => {
    const r = rng(seed), ds = [];
    for (let k = 0; k < boot; k++) {
      const ix = tasks.flatMap(() => byTask.get(tasks[Math.floor(r() * tasks.length)])), yy = ix.map(i => y[i]);
      const u = auc(ix.map(i => a[i]), yy), v = auc(ix.map(i => b[i]), yy);
      if (u !== null && v !== null) ds.push(v - u);
    }
    return ds.length >= boot / 2 ? [round(quantile(ds, 0.025), 3), round(quantile(ds, 0.975), 3)] : null;
  };
  const primaryEx = auc(dirScores.logInputTokens, y), primaryPost = dirScores.logCost ? auc(dirScores.logCost, y) : null;
  const primaryCI = primaryPost === null ? null : boots(dirScores.logInputTokens, dirScores.logCost);
  const aEx = auc(pEx, y), aPost = pPost ? auc(pPost, y) : null, aBoth = pBoth ? auc(pBoth, y) : null;
  const fittedCI = pPost ? boots(pEx, pPost) : null;
  const structureKeysThatVary = TRUSTED8.filter((_, j) => new Set(rows.map(r => round(structure.get(r.taskKey).vector[j], 6))).size > 1);
  return {
    rows: rows.length, tasks: tasks.length, passes, fails, directional,
    primary: { exAnte: round(primaryEx, 3), postHoc: primaryPost === null ? null : round(primaryPost, 3), delta: primaryPost === null ? null : round(primaryPost - primaryEx, 3), ci: primaryCI, excludesZero: primaryCI ? primaryCI[0] > 0 || primaryCI[1] < 0 : null },
    fitted: { postHocSignals: names, exAnte: round(aEx, 3), postHoc: aPost === null ? null : round(aPost, 3), both: aBoth === null ? null : round(aBoth, 3), delta: aPost === null ? null : round(aPost - aEx, 3), ci: fittedCI, excludesZero: fittedCI ? fittedCI[0] > 0 || fittedCI[1] < 0 : null },
    structureKeysThatVary,
  };
}

/** The workflow's own verdict against the oracle, per (job, mode): false-pass = verdict pass among delivered oracle failures. */
export function selfVerdictRates(rows) {
  const d = rows.filter(r => r.delivered && r.verdict != null);
  if (!d.length) return null;
  const fail = d.filter(r => !r.pass), pass = d.filter(r => r.pass);
  const fp = fail.filter(r => r.verdict === 'pass').length, ff = pass.filter(r => r.verdict !== 'pass').length;
  const cp = (x, n) => (n ? clopperPearson(x, n, 'two-sided') : null);
  return {
    delivered: d.length, oracleFail: fail.length, falsePass: fp, falsePassRate: fail.length ? round(fp / fail.length, 3) : null,
    falsePassCI: fail.length ? [round(cp(fp, fail.length).lower, 3), round(cp(fp, fail.length).upper, 3)] : null,
    oraclePass: pass.length, falseFail: ff, falseFailRate: pass.length ? round(ff / pass.length, 3) : null, f11Eligible: fail.length >= 10, f11Trips: fail.length >= 10 && fp / fail.length > 0.2,
  };
}

export async function runD3(jobs, { structure = null, boot = 1000 } = {}) {
  const groups = [];
  for (const job of jobs) for (const mode of [...new Set(job.allRows.map(r => r.mode))].sort()) {
    if (!KIND(mode)) continue;
    const all = job.allRows.filter(r => r.mode === mode);
    groups.push({ job, mode, kind: KIND(mode), all, delivered: all.filter(r => r.delivered) });
  }
  const st = structure ?? await structureOf(groups.flatMap(g => g.delivered));
  const per = groups.map(g => ({
    job: g.job.id, mode: g.mode, kind: g.kind, family: g.job.family, source: g.job.sources, rowsAll: g.all.length, rowsDelivered: g.delivered.length,
    ...evaluateGroup(g.delivered, st, { kind: g.kind, boot }), selfVerdict: selfVerdictRates(g.all),
  }));
  const scored = per.filter(p => p.primary && p.primary.postHoc !== null);
  const med = f => (scored.length ? round(quantile(scored.map(f), 0.5), 3) : null);
  const fitted = scored.filter(p => p.fitted.postHoc !== null);
  const medF = f => (fitted.length ? round(quantile(fitted.map(f), 0.5), 3) : null);
  return {
    id: 'D3', grade: 'LEGACY/dev', question: 'Do deployable post-hoc signals predict the oracle better than structure features? (delivered answers)',
    postHocSignalsAllowed: POSTHOC_NAMES, postHocByKind: POSTHOC_BY_KIND, exAnteFeatures: TRUSTED8, hashesChecked: [...st.values()].every(v => v.hashOk), taskCount: st.size,
    groups: per,
    summary: {
      groups: per.length, groupsScored: scored.length, groupsSkipped: per.length - scored.length,
      primary: {
        medianAucExAnte: med(p => p.primary.exAnte), medianAucPostHoc: med(p => p.primary.postHoc), medianDelta: med(p => p.primary.delta),
        postHocBetter: scored.filter(p => p.primary.delta > 0).length, exAnteBetter: scored.filter(p => p.primary.delta < 0).length,
        postHocBetterCIExcludesZero: scored.filter(p => p.primary.ci && p.primary.ci[0] > 0).length, exAnteBetterCIExcludesZero: scored.filter(p => p.primary.ci && p.primary.ci[1] < 0).length,
      },
      fitted: {
        groups: fitted.length, medianAucExAnte: medF(p => p.fitted.exAnte), medianAucPostHoc: medF(p => p.fitted.postHoc), medianDelta: medF(p => p.fitted.delta),
        postHocBetterCIExcludesZero: fitted.filter(p => p.fitted.ci && p.fitted.ci[0] > 0).length, exAnteBetterCIExcludesZero: fitted.filter(p => p.fitted.ci && p.fitted.ci[1] < 0).length,
      },
    },
  };
}
