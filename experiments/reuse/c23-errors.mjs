#!/usr/bin/env node
// C2-3 failure anatomy ($0, after the run; post-hoc, not preregistered): every AGENT-H answer that missed, with what the
// supplier stored, the SOP-scale scores and total the oracle used, the class the agent gave and the direction of the miss;
// the same table for SCRATCH (lineage 1) on the same items; and every arm's accuracy split by whether the supplier's 15
// labelled history products DETERMINE the item's class.
//
// History-pinned (per supplier, from the history's SOP-scale totals and recorded classes; classes are monotone in the
// total, sop.txt §5.7 "higher score gets higher severity"): a class item with total T is pinned when some history item
// has total T, or T lies between two history totals of the same class, or T is at or below a history total of class A,
// or at or above one of class D. Otherwise T falls in a gap between two classes the history does not resolve, and B's
// matrix alone decides it (equal bands, which the reused workflow and SCRATCH's builder default to by construction;
// program-b.mjs header). Items whose truth is Unable to Decide are a third stratum (rules stated in the procedure).
// Reads LIVE records only; writes aggregates and synthetic values (no SOP-Bench text) to runs/c2-3/errors.json.
//   node experiments/reuse/c23-errors.mjs
import path from 'node:path';
import { ctxOf } from './c2.mjs';
import { itemsOf } from './gen-b.mjs';
import { CLASSES, UNABLE, sopScoreOf } from './program-b.mjs';
import { armsOf, OUT, RECORDS, historyIds } from './c23.mjs';
import { readJsonl, writeJson } from './lib.mjs';

const rank = c => (c === UNABLE ? -1 : CLASSES.indexOf(c));

/** Whether a supplier's labelled history pins total T. history: [{ total, cls }] (class items only). */
export function historyPins(history, T) {
  const r = history.map(h => ({ t: h.total, k: rank(h.cls) })).filter(h => h.k >= 0);
  if (r.some(h => h.t === T)) return true;
  if (r.some(h => h.k === 0 && T <= h.t) || r.some(h => h.k === 3 && T >= h.t)) return true;
  return r.some(a => r.some(b => a.k === b.k && a.t <= T && T <= b.t));
}
/** The stratum of an item: 'unable' (truth Unable), 'pinned' or 'gap'. */
export const stratumOf = (history, truth) => (truth.hazard_class === UNABLE ? 'unable' : historyPins(history, truth.hazard_score) ? 'pinned' : 'gap');
/** Map product id -> stratum for every stream item of a manifest, each judged against its supplier's history. */
export function strataOf(manifest) {
  const byId = new Map(manifest.products.map(p => [p.id, p]));
  const histories = Object.fromEntries(Object.keys(manifest.sources).map(s => [s, historyIds(manifest, s).map(id => byId.get(id).truth).filter(t => t.hazard_class !== UNABLE).map(t => ({ total: t.hazard_score, cls: t.hazard_class }))]));
  return new Map(itemsOf(manifest).items.map(it => [it.product.id, stratumOf(histories[it.source], it.product.truth)]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ctx = ctxOf('c2-1', 'test');
  const { items } = itemsOf(ctx.manifest);
  const byId = new Map(ctx.manifest.products.map(p => [p.id, p]));
  const stratum = strataOf(ctx.manifest);
  const kindOf = (got, truth) => (got == null ? 'no-answer' : got === UNABLE ? 'unable-for-class' : truth === UNABLE ? 'class-for-unable' : rank(got) > rank(truth) ? 'over' : 'under');
  const rowOf = (r, extra = {}) => {
    const p = byId.get(r.id);
    const sop = Object.fromEntries(Object.entries(p.raw).map(([c, v]) => [c, sopScoreOf(r.source, v)]));
    return { id: r.id, source: r.source, truth: p.truth.hazard_class, total: p.truth.hazard_score, reason: p.truth.reason, got: r.answer, kind: kindOf(r.answer, p.truth.hazard_class), stratum: stratum.get(r.id), stored: p.raw, sop, edge: p.edgeKind ?? null, ...extra };
  };
  const agentH = readJsonl(path.join(ctx.setLive, RECORDS)).filter(r => !r.envFault);
  const wrongH = agentH.filter(r => !r.correct).map(r => rowOf(r, { k: r.k, turns: r.turns, steps: r.steps, toolCalls: r.toolCalls }));
  const scratch = readJsonl(path.join(ctx.setLive, 'built.jsonl')).filter(b => b.lineage === 1 && !b.correct).map(r => rowOf(r));
  const tally = (rows, f) => rows.reduce((m, r) => { const k = f(r); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const ks = [...new Set(agentH.map(r => r.k))].sort();
  const wrongBy = k => new Set(agentH.filter(r => r.k === k && !r.correct).map(r => r.id));
  const both = ks.length > 1 ? [...wrongBy(ks[0])].filter(id => wrongBy(ks[1]).has(id)) : [];
  // Accuracy of every arm per stratum.
  const { arms } = armsOf(ctx);
  const strata = ['pinned', 'gap', 'unable'];
  const byStratum = Object.fromEntries(Object.entries(arms).map(([name, a]) => [name, Object.fromEntries(strata.map(s => { const os = a.out.filter(o => stratum.get(o.id) === s); return [s, `${os.filter(o => o.correct).length}/${os.length}`]; }))]));
  const sizes = tally(items, it => stratum.get(it.product.id));
  const gapBySource = tally(items.filter(it => stratum.get(it.product.id) === 'gap'), it => it.source);
  const out = { kind: 'c23-errors', note: 'post-hoc: AGENT-H misses with synthetic stored values and the oracle\'s SOP-scale scores; SCRATCH@L1 misses on the same items; every arm by history-pinned stratum',
    strata: { sizes, gapBySource, byArm: byStratum },
    agentH: { wrong: wrongH.length, byKind: tally(wrongH, r => `${r.source}:${r.kind}`), byStratum: tally(wrongH, r => `k${r.k}:${r.stratum}`), wrongInBothReps: both.length, wrongInBothRepsIds: both, rows: wrongH },
    scratchL1: { wrong: scratch.length, byKind: tally(scratch, r => `${r.source}:${r.kind}`), byStratum: tally(scratch, r => r.stratum), rows: scratch } };
  writeJson(path.join(OUT, 'errors.json'), out);
  console.log(JSON.stringify({ strata: out.strata, agentH: { wrong: wrongH.length, byKind: out.agentH.byKind, byStratum: out.agentH.byStratum, wrongInBothReps: both.length }, scratchL1: { wrong: scratch.length, byKind: out.scratchL1.byKind, byStratum: out.scratchL1.byStratum } }, null, 1));
}
