// POST-HOC (review minor 5, 2026-11-04, $0): trace the wrong cells rootcause.mjs leaves `unexplained` (no single bed
// mistake reproduces the row's value and source). For each such unit it re-runs the bed's resolver with
//   (a) every PAIR of the single mistakes (CELL_MISTAKES), and
//   (b) `winner-missed`: the true winning document's claim never extracted (the next candidate wins), alone and with each
//       single mistake;
//   (c) for the W arm, W's own two code facts: technical reports are not research (its type list omits the kind, so their
//       claims never count) and its fixed ranking (n first unless the prompt says sample size does not matter), alone and
//       with each single mistake;
// and lists the combinations that reproduce the row exactly. A unit nothing reproduces stays `unexplained`, with the
// answer's row, the truth and the ranked candidates for the reader. Analyst side only; nothing calls a model.
//   node experiments/swarm/trace-unexplained.mjs [--rootcause research/swarm-20261021/ROOTCAUSE-R1.jsonl] [--out file.jsonl]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as bed from '../../beds/wbed/r6/index.mjs';
import { voidKeys } from '../../beds/wbed/r6/pipeline.mjs';
import { PROPS } from '../../beds/wbed/r6/vocab.mjs';
import { truthOf, CELL_MISTAKES, _resolveAlt as resolveAlt } from './rootcause.mjs';
import { archiveOf, ARMS } from './analyze-r1.mjs';
import { LIVE } from './run-r1.mjs';

const merge = (...ms) => { const fs = ms.map(m => m.vis).filter(Boolean);
  return { voidOpts: Object.assign({}, ...ms.map(m => m.voidOpts ?? {})), opts: Object.assign({}, ...ms.map(m => m.opts ?? {})), vis: fs.length ? vis => fs.reduce((v, f) => f(v), vis) : null }; };
/** W's code facts as mistakes (experiments/swarm runs/w-build solve.mjs): technical reports dropped; n-first ranking. */
export const W_FACTS = Object.freeze([
  ['W:techreport-not-research', { vis: vis => vis.filter(d => d.kind !== 'techreport') }],
  ['W:policy-n-first', { opts: { policy: 'P3' } }],
]);

function resolveWith(t, e, p, m) {
  const voids = Object.keys(m.voidOpts).length ? voidKeys(t.world, t.vis, m.voidOpts) : t.voids;
  const vis = m.vis ? m.vis(t.vis) : t.vis;
  const world = m.opts.policy ? { ...t.world, policy: m.opts.policy } : t.world;
  return resolveAlt(world, vis, voids, e.id, p, m.opts);
}

/** Combinations of mistakes that reproduce a wrong row exactly: [[name, name], …]. */
export function traceCell(task, code, p, row, { arm = null } = {}) {
  const t = truthOf(task), e = t.entByCode.get(code);
  const got = { canon: Math.round(Number(row.value) * 10 ** PROPS[p].dec), source: String(row.source_doc_id ?? '').trim().toUpperCase() };
  const truth = t.cells.get(`${code}|${p}`);
  const missed = ['winner-missed', { vis: vis => vis.filter(d => d.id !== truth.source) }];
  const single = [...CELL_MISTAKES.map(([n, m]) => [n, m]), missed];
  const pool = arm === ARMS.W ? [...single, ...W_FACTS] : single;
  const hits = [];
  const tryCombo = names => {
    const ms = names.map(n => pool.find(([x]) => x === n)[1]);
    const policies = ms.map(m => m.opts?.policy).filter(Boolean);
    if (new Set(policies).size > 1) return;
    const c = resolveWith(t, e, p, merge(...ms));
    if (c && c.canon === got.canon && c.source === got.source) hits.push(names);
  };
  tryCombo(['winner-missed']);
  if (arm === ARMS.W) for (const [n] of W_FACTS) tryCombo([n]);
  if (arm === ARMS.W) tryCombo(W_FACTS.map(([n]) => n));
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) tryCombo([pool[i][0], pool[j][0]]);
  if (arm === ARMS.W) for (const [n] of single) tryCombo([...W_FACTS.map(([x]) => x), n]);
  // the smallest explanations first
  const min = hits.length ? Math.min(...hits.map(h => h.length)) : 0;
  return { got, truth, exact: hits.filter(h => h.length === min) };
}

export async function traceAll({ rootcauseFile, live = LIVE } = {}) {
  const lines = readFileSync(rootcauseFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const out = [];
  for (const x of lines) {
    const units = (x.unitsDetail ?? []).filter(u => u.unit === 'wrong-cell' && (u.traps ?? []).some(k => k.startsWith('unexplained')));
    if (!units.length) continue;
    const seed = Number(x.taskKey.split(':s')[1]);
    const task = bed.generate({ seed, split: 'test', difficulty: 5 });
    const arc = archiveOf(live, x.arm, x.taskKey);
    const t = truthOf(task);
    for (const u of units) {
      const row = (arc.answer?.table ?? []).find(r => t.resolve(r.entity) === u.code && r.property === u.property);
      const r = traceCell(task, u.code, u.property, row, { arm: x.arm });
      out.push({ arm: x.arm, taskKey: x.taskKey, inComparison: x.inComparison ?? true, code: u.code, property: u.property, got: r.got, truth: { canon: r.truth.canon, source: r.truth.source },
        gotSourceKind: t.byId.get(r.got.source)?.kind ?? null, truthSourceKind: t.byId.get(r.truth.source)?.kind ?? null, explainedBy: r.exact, explained: r.exact.length > 0 });
    }
  }
  return out;
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const res = await traceAll({ rootcauseFile: arg('--rootcause', 'research/swarm-20261021/ROOTCAUSE-R1.jsonl') });
  const out = arg('--out', null);
  if (out) writeFileSync(out, res.map(x => JSON.stringify(x)).join('\n') + '\n');
  const by = res.reduce((m, x) => { const k = `${x.arm}|${x.explained ? 'explained' : 'unexplained'}`; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  console.log(JSON.stringify({ units: res.length, by }, null, 1));
  for (const x of res.filter(r => r.arm !== ARMS.W || !r.explained)) console.log(JSON.stringify(x));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
