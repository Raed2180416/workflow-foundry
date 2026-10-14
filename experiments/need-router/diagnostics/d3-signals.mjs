// D3: ex-ante against post-hoc (Dekoninck, Baader and Vechev, "A Unified Approach to Routing and Cascading"; DESIGN §7 M0 item 10).
// Routing pays when quality can be estimated BEFORE running a mode; cascading pays only when estimates made AFTER seeing the output
// are much better. Do deployable post-hoc signals predict the oracle better than the structure features the router reads?
//   unit        one delivered answer of one archived arm (a timeout or crash is itself a free post-hoc signal, so the question is
//               whether signals separate right from wrong among answers the user would receive: the silent misses W x q charges)
//   target      the oracle pass flag
//   ex-ante     the 8 trusted structure features of the task (regenerated from the task key; the taskHash is checked against the archive)
//   post-hoc    signals a user could see without the oracle: schema validity, agent turns and tool uses, the run's cost, output tokens,
//               workflow node calls and escalations, the workflow's own verdict. NEVER score, oracle details or the pass flag.
//               Wall time is left out: DESIGN §2 calls it confounded by concurrency and stalls (one stall lasted 187 minutes).
//   score       parameter-free, with a direction fixed in advance (a bigger value predicts a failure: more input tokens, a longer list,
//               a costlier run, more turns, an invalid schema, a failed own verdict). Nothing is fitted, so there is no selection and no
//               leave-one-out bias at these sample sizes (8 to 36 rows per arm).
//   AUC         within difficulty: only (pass, fail) pairs of the same difficulty band are compared, because in these dev sets the
//               band mixes differ in input size and in pass rate (P1 records d4 inputs are larger and pass MORE often than d3), which
//               would confound a between-band comparison. The router sees the band as part of the job.
//   primary     AUC of -logInputTokens (ex-ante) against AUC of -logCost (post-hoc), per arm, with a seeded bootstrap over tasks of
//               the difference; the summary counts arms, it does not pool them.
// Within one family the structure features are nearly constant across tasks (see structureKeysThatVary), so the ex-ante side is bounded
// by that. The router decides per job, not per task: this measures the instance-level gap Dekoninck et al. describe, not the job-level
// decision. Also reported: each workflow arm's own verdict against the oracle (a first, tiny F11-style false-pass rate).
// Evidence grade: LEGACY/dev.
import { makeTasks, loadFamily } from '../../lib/beds.mjs';
import { taskFeatures } from '../features.mjs';
import { TRUSTED8 } from './census.mjs';
import { auc, quantile, rng, round } from './common.mjs';
import { clopperPearson } from '../../lib/stats-ebed.mjs';

export const POSTHOC_NAMES = Object.freeze(['schemaInvalid', 'logTurns', 'logTools', 'logCost', 'logTokensOut', 'logCalls', 'escalations', 'verdictFail']);
const L = x => (Number.isFinite(x) ? Math.log10(1 + Math.max(0, x)) : null);
/** The deployable post-hoc signals of a row (null = not recorded for this arm). Reads no oracle field. */
export function postHocSignals(r) {
  return {
    schemaInvalid: r.schemaValid === false ? 1 : 0, logTurns: L(r.turns), logTools: L(r.tools), logCost: L(r.usdReported),
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

/** AUCs of one (job, mode) group. `structure` is Map(taskKey -> {vector}). Returns a `skipped` reason when the group cannot be scored. */
export function evaluateGroup(rows, structure, { boot = 1000, seed = 20261014, minEach = 4 } = {}) {
  const y = rows.map(r => (r.pass ? 1 : 0));
  const passes = y.reduce((a, b) => a + b, 0), fails = rows.length - passes;
  if (passes < minEach || fails < minEach) return { skipped: `needs >= ${minEach} passes and >= ${minEach} failures among delivered answers (has ${passes} / ${fails})`, rows: rows.length, passes, fails };
  const sig = rows.map(postHocSignals), strata = rows.map(r => r.difficulty);
  const A = (sc, yy = y, st = strata) => auc(sc, yy, st);
  const varies = v => new Set(v.map(x => round(x ?? 0, 9))).size > 1;
  const tasks = [...new Set(rows.map(r => r.taskKey))], byTask = new Map(tasks.map(t => [t, rows.map((r, i) => (r.taskKey === t ? i : -1)).filter(i => i >= 0)]));
  // Scores with the direction fixed in advance: a bigger value predicts a failure, so the score is the negative.
  const exScores = {}, postScores = {};
  TRUSTED8.forEach((k, j) => { const v = rows.map(r => structure.get(r.taskKey).vector[j]); if (varies(v)) exScores[k] = v.map(x => -x); });
  for (const n of POSTHOC_NAMES) { const v = sig.map(x => x[n]); if (v.some(x => x !== null) && varies(v)) postScores[n] = v.map(x => -(x ?? 0)); }
  const auces = sc => Object.fromEntries(Object.entries(sc).map(([n, v]) => [n, round(A(v), 3)]));
  const boots = (a, b) => {
    const r = rng(seed), ds = [];
    for (let k = 0; k < boot; k++) {
      const ix = tasks.flatMap(() => byTask.get(tasks[Math.floor(r() * tasks.length)])), yy = ix.map(i => y[i]), ss = ix.map(i => strata[i]);
      const u = A(ix.map(i => a[i]), yy, ss), v = A(ix.map(i => b[i]), yy, ss);
      if (u !== null && v !== null) ds.push(v - u);
    }
    return ds.length >= boot / 2 ? [round(quantile(ds, 0.025), 3), round(quantile(ds, 0.975), 3)] : null;
  };
  const exP = exScores.logInputTokens ?? null, postP = postScores.logCost ?? null;
  const ci = exP && postP ? boots(exP, postP) : null;
  const exA = exP ? A(exP) : null, postA = postP ? A(postP) : null;
  return {
    rows: rows.length, tasks: tasks.length, passes, fails, difficulties: [...new Set(strata)].sort(),
    structureKeysThatVary: Object.keys(exScores), exAnteAuc: auces(exScores), postHocAuc: auces(postScores),
    primary: { exAnte: exA === null ? null : round(exA, 3), postHoc: postA === null ? null : round(postA, 3), delta: exA === null || postA === null ? null : round(postA - exA, 3), ci, excludesZero: ci ? ci[0] > 0 || ci[1] < 0 : null },
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
  const scored = per.filter(p => p.primary && p.primary.postHoc !== null && p.primary.exAnte !== null);
  const med = f => (scored.length ? round(quantile(scored.map(f), 0.5), 3) : null);
  // Every varying signal across scored-or-not groups with enough of both classes: the share with AUC above 0.5 (direction right).
  const evaluated = per.filter(p => p.postHocAuc);
  const bySignal = {};
  for (const p of evaluated) for (const [n, a] of Object.entries(p.postHocAuc)) (bySignal[n] ??= []).push(a);
  const exBy = {};
  for (const p of evaluated) for (const [n, a] of Object.entries(p.exAnteAuc)) (exBy[n] ??= []).push(a);
  const roll = obj => Object.fromEntries(Object.entries(obj).map(([n, v]) => [n, { groups: v.length, median: round(quantile(v, 0.5), 3), above: v.filter(a => a > 0.5).length, below: v.filter(a => a < 0.5).length }]));
  const verdictRows = per.filter(p => p.selfVerdict && p.selfVerdict.oracleFail > 0);
  const fp = verdictRows.reduce((a, p) => a + p.selfVerdict.falsePass, 0), fail = verdictRows.reduce((a, p) => a + p.selfVerdict.oracleFail, 0);
  return {
    id: 'D3', grade: 'LEGACY/dev', question: 'Do deployable post-hoc signals predict the oracle better than structure features? (delivered answers, within difficulty)',
    postHocSignalsAllowed: POSTHOC_NAMES, exAnteFeatures: TRUSTED8, hashesChecked: [...st.values()].every(v => v.hashOk), taskCount: st.size,
    groups: per,
    summary: {
      groups: per.length, groupsScored: scored.length, groupsSkipped: per.length - evaluated.length,
      primary: {
        medianAucExAnte: med(p => p.primary.exAnte), medianAucPostHoc: med(p => p.primary.postHoc), medianDelta: med(p => p.primary.delta),
        postHocBetter: scored.filter(p => p.primary.delta > 0).length, exAnteBetter: scored.filter(p => p.primary.delta < 0).length,
        postHocBetterCIExcludesZero: scored.filter(p => p.primary.ci && p.primary.ci[0] > 0).length, exAnteBetterCIExcludesZero: scored.filter(p => p.primary.ci && p.primary.ci[1] < 0).length,
      },
      exAnteBySignal: roll(exBy), postHocBySignal: roll(bySignal),
      selfVerdict: { arms: verdictRows.length, oracleFailures: fail, falsePass: fp, falsePassRate: fail ? round(fp / fail, 3) : null, lowerBound95: fail ? round(clopperPearson(fp, fail, 'lower').lower, 3) : null },
    },
  };
}
