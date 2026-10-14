// D3: ex-ante against post-hoc (Dekoninck, Baader and Vechev, "A Unified Approach to Routing and Cascading"; DESIGN §7 M0 item 10).
// Routing pays when quality can be estimated BEFORE running a mode; cascading pays only when estimates made AFTER seeing the output
// are much better. Do deployable post-hoc signals predict the oracle better than the structure features the router reads?
//   unit        one delivered answer of one archived arm; the target is the oracle pass flag
//   ex-ante     the 8 trusted structure features of the task (regenerated from the task key; the taskHash is checked against the archive)
//   post-hoc    signals a user could see without the oracle: schema validity, agent turns and tool uses, the run's cost, latency, output
//               tokens, workflow node calls and escalations, the workflow's own verdict. NEVER score, oracle details or the pass flag.
//   estimator   ridge logistic regression, leave-one-TASK-out (all trials of a task are held out together), AUC of the pooled
//               out-of-fold predictions; the interval is a seeded bootstrap over tasks of the AUC difference
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

/** AUCs of one (job, mode) group. `structure` is Map(taskKey -> {vector}). Returns null with a reason when the group cannot be scored. */
export function evaluateGroup(rows, structure, { boot = 1000, seed = 20261014, minEach = 4 } = {}) {
  const y = rows.map(r => (r.pass ? 1 : 0));
  const passes = y.reduce((a, b) => a + b, 0), fails = rows.length - passes;
  if (passes < minEach || fails < minEach) return { skipped: `needs >= ${minEach} passes and >= ${minEach} failures among delivered answers (has ${passes} / ${fails})`, rows: rows.length, passes, fails };
  const sig = rows.map(postHocSignals);
  const names = POSTHOC_NAMES.filter(n => sig.some(s => s[n] !== null) && new Set(sig.map(s => s[n])).size > 1);
  const exFeat = r => structure.get(r.taskKey).vector;
  const idx = new Map(rows.map((r, i) => [r, i]));
  const postFeat = r => names.map(n => sig[idx.get(r)][n] ?? 0);
  const both = r => [...exFeat(r), ...postFeat(r)];
  const pEx = oofPredictions(rows, exFeat, y), pPost = names.length ? oofPredictions(rows, postFeat, y) : null, pBoth = names.length ? oofPredictions(rows, both, y) : null;
  const single = {};
  for (const n of names) single[n] = round(auc(oofPredictions(rows, r => [sig[idx.get(r)][n] ?? 0], y), y), 3);
  const aEx = auc(pEx, y), aPost = pPost ? auc(pPost, y) : null, aBoth = pBoth ? auc(pBoth, y) : null;
  // Bootstrap over tasks of AUC(post-hoc) - AUC(ex-ante), holding the out-of-fold predictions fixed.
  let ci = null;
  if (pPost) {
    const tasks = [...new Set(rows.map(r => r.taskKey))], byTask = new Map(tasks.map(t => [t, rows.map((r, i) => (r.taskKey === t ? i : -1)).filter(i => i >= 0)]));
    const r = rng(seed), ds = [];
    for (let b = 0; b < boot; b++) {
      const ix = tasks.flatMap(() => byTask.get(tasks[Math.floor(r() * tasks.length)]));
      const yy = ix.map(i => y[i]), a = auc(ix.map(i => pEx[i]), yy), p = auc(ix.map(i => pPost[i]), yy);
      if (a !== null && p !== null) ds.push(p - a);
    }
    if (ds.length >= boot / 2) ci = [round(quantile(ds, 0.025), 3), round(quantile(ds, 0.975), 3)];
  }
  const structureVariance = TRUSTED8.map((k, j) => { const v = rows.map(r => structure.get(r.taskKey).vector[j]); return new Set(v.map(x => round(x, 6))).size > 1; });
  return {
    rows: rows.length, tasks: new Set(rows.map(r => r.taskKey)).size, passes, fails, postHocSignals: names, singleSignalAuc: single,
    aucExAnte: round(aEx, 3), aucPostHoc: aPost === null ? null : round(aPost, 3), aucBoth: aBoth === null ? null : round(aBoth, 3),
    deltaPostMinusExAnte: aPost === null ? null : round(aPost - aEx, 3), deltaCI: ci, deltaExcludesZero: ci ? ci[0] > 0 || ci[1] < 0 : null,
    structureKeysThatVary: TRUSTED8.filter((_, j) => structureVariance[j]),
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
    ...evaluateGroup(g.delivered, st, { boot }), selfVerdict: selfVerdictRates(g.all),
  }));
  const scored = per.filter(p => p.aucExAnte !== undefined && p.aucPostHoc !== null && p.aucPostHoc !== undefined);
  const bySign = scored.filter(p => p.deltaCI && p.deltaCI[0] > 0).length, against = scored.filter(p => p.deltaCI && p.deltaCI[1] < 0).length;
  return {
    id: 'D3', grade: 'LEGACY/dev', question: 'Do deployable post-hoc signals predict the oracle better than structure features? (delivered answers, leave-one-task-out)',
    postHocSignalsAllowed: POSTHOC_NAMES, exAnteFeatures: TRUSTED8, hashesChecked: [...st.values()].every(v => v.hashOk), taskCount: st.size,
    groups: per,
    summary: {
      groupsScored: scored.length, groupsSkipped: per.length - scored.length, medianAucExAnte: scored.length ? round(quantile(scored.map(p => p.aucExAnte), 0.5), 3) : null,
      medianAucPostHoc: scored.length ? round(quantile(scored.map(p => p.aucPostHoc), 0.5), 3) : null, medianDelta: scored.length ? round(quantile(scored.map(p => p.deltaPostMinusExAnte), 0.5), 3) : null,
      postHocBetterCIExcludesZero: bySign, exAnteBetterCIExcludesZero: against, meanAucExAnte: scored.length ? round(mean(scored.map(p => p.aucExAnte)), 3) : null,
      meanAucPostHoc: scored.length ? round(mean(scored.map(p => p.aucPostHoc)), 3) : null,
    },
  };
}
