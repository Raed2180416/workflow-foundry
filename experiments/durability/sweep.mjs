// DUR-1 retroactive sweep, K5 (PREREG-DUR-1 §8.4; $0, analysis-side). After every promotion of every arm: a shadow replay
// of all earlier cases of the stream on the new version; a case is MARKED when its effects differ from what the deployment
// delivered (exposure.mjs caseSignatures: committed effects, requests, expectation); precision and recall against the
// oracle's failing set of those earlier cases (LD-H: against the manifests' `before` sets). The sweep never feeds the loop.
import { buildBundle } from './changes.mjs';
import { runBundle } from './arms.mjs';
import { referencePools, gradeRun } from './oracle.mjs';
import { caseSignatures } from './exposure.mjs';
import { dayStart } from './schedule.mjs';
import { timelineOf } from './stream.mjs';

/** Precision and recall of a marked set against a truth set (null where undefined). */
export function precisionRecall(marked, truth) {
  const m = new Set(marked), t = new Set(truth);
  const tp = [...m].filter(c => t.has(c)).length;
  return { marked: m.size, truth: t.size, tp, precision: m.size ? tp / m.size : null, recall: t.size ? tp / t.size : null };
}

/**
 * One world's sweep: `rows` the delivered run, `version` the newly promoted one, `beforeMs` the promotion time (cases
 * placed before it are "earlier"; Infinity for an earlier world). Returns { earlier, marked, failing }.
 */
export async function sweepWorld({ bundle, rows, version, beforeMs = Infinity, pools = null }) {
  const ref = pools ? { pools } : await referencePools(bundle);
  const shadow = await runBundle(bundle, { version });
  const a = caseSignatures(bundle, rows), b = caseSignatures(bundle, shadow.rows);
  const g = gradeRun(bundle, rows, ref.pools);
  const earlier = g.cases.filter(c => c.graded && c.placedAt !== null && c.placedAt < beforeMs);
  return {
    key: bundle.key,
    earlier: earlier.map(c => c.case),
    marked: earlier.filter(c => a.get(c.case) !== b.get(c.case)).map(c => c.case),
    failing: earlier.filter(c => !c.pass).map(c => c.case),
  };
}

/**
 * The sweep of a lineage-stream record (stream.mjs): for each promotion (world k, day P) every earlier world j < k in
 * full and world k's cases placed before day P. `truthOf(key, sw)` overrides the truth set (LD-H: the manifest's
 * `before` set); default the oracle's failing set. `maxWorldsBack` bounds the replay cost. Returns per-promotion rows and
 * the pooled precision/recall.
 */
export async function sweepStream({ rec, specs, sealed = null, truthOf = null, maxWorldsBack = Infinity }) {
  const versions = rec.versionMap;
  const bundles = new Map(), delivered = new Map();
  const bundleOf = async spec => { if (!bundles.has(spec.k)) bundles.set(spec.k, await buildBundle(spec, { sealed })); return bundles.get(spec.k); };
  const rowsOf = async spec => {
    if (!delivered.has(spec.k)) delivered.set(spec.k, (await runBundle(await bundleOf(spec), { timeline: timelineOf(rec, spec.k, versions) })).rows);
    return delivered.get(spec.k);
  };
  const out = [];
  let marked = [], truth = [];
  for (const p of rec.promotions) {
    const v = versions.get(p.to);
    if (!v) continue;
    for (const spec of specs.filter(s => s.k <= p.k && s.k > p.k - 1 - maxWorldsBack)) {
      const b = await bundleOf(spec);
      const sw = await sweepWorld({ bundle: b, rows: await rowsOf(spec), version: v, beforeMs: spec.k < p.k ? Infinity : dayStart(p.day) });
      const t = truthOf ? truthOf(b.key, sw) : sw.failing;
      const tag = c => `${p.k}.${p.day}|${b.key}|${c}`;
      marked = marked.concat(sw.marked.map(tag)); truth = truth.concat(t.filter(c => sw.earlier.includes(c)).map(tag));
      out.push({ promotion: `${p.k}.${p.day}`, to: p.to, world: b.key, earlier: sw.earlier.length, ...precisionRecall(sw.marked, t.filter(c => sw.earlier.includes(c))) });
    }
  }
  return { rows: out, pooled: precisionRecall(marked, truth) };
}
