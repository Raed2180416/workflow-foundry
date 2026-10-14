// The bed's own exact solver for R6, written as the reference outline's stages (W-BED §3.6):
//   index  (code)  mention index over the corpus text: codes by pattern, names from the register and "name (CODE)"
//   plan   (judge) candidate compounds: every compound mentioned in a research document of lab X (any of its names)
//                  published on or after Y. Recall-complete by construction, since a test on/after Y is published
//                  on/after Y; workers restore precision.
//   worker (judge chain per candidate) in scope? (an own test by lab X dated on/after Y in a surviving document) ->
//                  per requested property the winning claim; plus the void documents that mention the compound
//   reduce (code)  the table of the in-scope items and the union of their void documents
// referenceSolve runs it with no options; each control runs it with one option reproducing one plausible mistake. The
// attention-limited stand-ins (sequential single context, best-of-n, grep agent) run it with `unseen`: documents the
// reader never saw.
import { CODE_RE, rankKey, cmpKeys, canonValue, unitOf } from './vocab.mjs';
import { isResearch, tierOfDoc, testsOf, printedCanon } from './world.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// index (code)
const wordRe = s => new RegExp(`(?<![A-Za-z0-9-])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9-])`, 'i');
/** Mention index from text alone: { entities: [{ code, name, docs }], byDoc: Map(docId -> Set(code)) }. */
export function textIndex(files, registerEntries = []) {
  const pairs = new Map(); // code -> name
  for (const x of registerEntries) pairs.set(x.code, x.name.toLowerCase());
  const docs = Object.entries(files).filter(([p]) => p.startsWith('corpus/')).map(([p, t]) => [p.slice('corpus/'.length).replace(/\.txt$/, ''), t]);
  const codes = new Set(pairs.keys());
  for (const [, t] of docs) {
    for (const m of t.matchAll(CODE_RE)) codes.add(m[0]);
    for (const m of t.matchAll(/(?<![A-Za-z])([A-Za-z][a-z]+) \(([A-Z]{2,3}-\d{3,4})\)/g)) if (!pairs.has(m[2])) pairs.set(m[2], m[1].toLowerCase());
  }
  const res = [...codes].sort().map(code => ({ code, name: pairs.get(code) ?? '', re: [wordRe(code), ...(pairs.has(code) ? [wordRe(pairs.get(code))] : [])] }));
  const byDoc = new Map();
  const entities = res.map(x => {
    const ds = docs.filter(([, t]) => x.re.some(re => re.test(t))).map(([id]) => id).sort();
    for (const id of ds) { if (!byDoc.has(id)) byDoc.set(id, new Set()); byDoc.get(id).add(x.code); }
    return { code: x.code, name: x.name, docs: ds };
  });
  return { entities, byDoc };
}

// ---------------------------------------------------------------------------------------------------------------------
// world-side reading under options
const visibleOf = (world, opts) => (opts.unseen ? world.docs.filter(d => !opts.unseen.has(d.key)) : world.docs);

/** Keys of void documents among the visible ones. */
export function voidKeys(world, vis, opts = {}) {
  const out = new Set();
  for (const d of vis) {
    if (d.kind === 'retraction') {
      if (d.target && !opts.retractedKept) out.add(d.target);
      if (!d.target && opts.retractionByTitle && d.notice?.titleOf) out.add(d.notice.titleOf);
    }
    if (d.supersedes && !opts.supersededKept) out.add(d.supersedes);
    if (d.kind === 'concern' && opts.concernVoids) out.add(d.target);
  }
  // a document the reader never saw is not "known void"
  if (opts.unseen) for (const k of [...out]) if (opts.unseen.has(k)) out.delete(k);
  return out;
}

const labIsX = (world, d, opts) => (d.lab === world.X && (!opts.aliasMissed || d.affil === 'full')) || (opts.namesakeLab && d.lab && d.lab === world.NS);

/** Does lab X test compound `e` on or after Y in a surviving visible document? */
export function inScopeOf(world, vis, voids, e, opts = {}) {
  for (const d of vis) {
    if (!isResearch(d) || !labIsX(world, d, opts)) continue;
    if (voids.has(d.key) && !opts.scopeVoidKept) continue;
    const tested = testsOf(d).has(e) || (opts.plansCounted && d.plans.includes(e)) || (opts.mentionsCounted && Boolean(d.styles[e]));
    if (!tested) continue;
    const day = opts.byPubDate ? d.pubDay : d.testDay;
    if (day >= world.Y) return true;
  }
  return false;
}

/** Erratum (visible) that corrects claim `c` of document `d`, or null. */
function erratumOf(vis, d, c) {
  return vis.find(n => n.kind === 'erratum' && n.target === d.key && n.notice.e === c.e && n.notice.p === c.p) ?? null;
}

/** The winning claim of cell (e, p): { canon, unit, source (doc id), viaErratum } or null. */
export function resolveCell(world, vis, voids, e, p, opts = {}) {
  const cands = [];
  for (const d of vis) {
    if (!isResearch(d) || voids.has(d.key)) continue;
    for (const c of d.claims) {
      if (c.e !== e || c.p !== p) continue;
      const counts = (c.kind === 'own' && c.cond === 'std') || (opts.nonstdCounted && c.kind === 'own' && c.cond === 'nonstd') || (opts.boundsCounted && c.kind === 'bound');
      if (!counts) continue;
      const er = opts.errataSkipped ? null : erratumOf(vis, d, c);
      cands.push({ d, canon: er ? er.notice.to : printedCanon(c), unit: c.unit, n: c.n, er });
    }
    if (opts.quotesCounted) for (const q of d.quotes) if (q.e === e && q.p === p) cands.push({ d, canon: q.canon, unit: q.unit, n: q.n, er: null });
    if (opts.predictionsCounted) for (const q of d.predictions) if (q.e === e && q.p === p) cands.push({ d, canon: q.canon, unit: q.unit, n: q.n ?? d.docN ?? 1, er: null });
  }
  if (!cands.length) return null;
  const key = x => (opts.recencyOnly ? [-x.d.pubDay] : rankKey(world.policy, tierOfDoc(x.d), x.n, x.d.pubDay));
  cands.sort((a, b) => cmpKeys(key(a), key(b)));
  const w = cands[0];
  return { canon: w.canon, unit: w.unit, source: opts.erratumCited && w.er ? w.er.id : w.d.id, viaErratum: Boolean(w.er) };
}

const valueOf = (p, cell, opts) => {
  if (!opts.noUnitConversion) return canonValue(p, cell.canon);
  // the printed number, read as if it were in the canonical unit
  const u = unitOf(p, cell.unit);
  return u.toPrinted(cell.canon) / 10 ** u.dec;
};

// ---------------------------------------------------------------------------------------------------------------------
// stages
export function plan(world, vis, opts = {}) {
  if (opts.fixedList) {
    const X = world.labs.find(l => l.isX);
    return { candidates: world.render.inputs.register.entries.filter(x => x.registered_by === X.name).map(x => x.code) };
  }
  const ent = new Map(world.entities.map(e => [e.id, e]));
  const out = [];
  const seen = new Set();
  for (const d of vis) {
    if (!isResearch(d) || !labIsX(world, d, opts) || d.pubDay < world.Y) continue;
    for (const id of Object.keys(d.styles)) if (!seen.has(id)) { seen.add(id); out.push(id); }
  }
  out.sort();
  const strings = [];
  for (const id of out) {
    const e = ent.get(id);
    strings.push(e.code);
    if (opts.codeAndNameTwice && e.sub === 'codeonly') strings.push(e.name);
  }
  return { candidates: strings };
}

export const entityByString = (world, s) => {
  const t = String(s).trim();
  return world.entities.find(e => e.code === t.toUpperCase() || e.name === t.toLowerCase()) ?? null;
};

export function worker(world, vis, voids, candidates, opts = {}) {
  const items = [];
  for (const s of candidates) {
    const e = entityByString(world, s);
    if (!e) continue;
    const inScope = inScopeOf(world, vis, voids, e.id, opts);
    const cells = [];
    if (inScope) for (const p of world.props) {
      const c = resolveCell(world, vis, voids, e.id, p, opts);
      if (c) cells.push({ property: p, value: valueOf(p, c, opts), source_doc_id: c.source });
    }
    const voidDocs = vis.filter(d => isResearch(d) && voids.has(d.key) && d.styles[e.id]).map(d => d.id).sort();
    items.push({ entity: s, in_scope: inScope, cells, void_doc_ids: voidDocs });
  }
  if (opts.nullFiltered) {
    // one in-scope worker failed, its null result was filtered out (the `.filter(Boolean)` idiom)
    const k = items.map(x => x.in_scope).lastIndexOf(true);
    if (k >= 0) items.splice(k, 1);
  }
  return { items };
}

export function reduce(world, vis, voids, items, opts = {}) {
  let inItems = items.filter(x => x.in_scope);
  if (opts.lostItem && inItems.length) inItems = inItems.slice(0, -1);
  let cellsOf = inItems.map(x => x.cells);
  if (opts.misjoin && inItems.length > 1) cellsOf = cellsOf.map((_, i) => cellsOf[(i + 1) % cellsOf.length]);
  const table = inItems.flatMap((x, i) => cellsOf[i].map(c => ({ entity: x.entity, property: c.property, value: c.value, source_doc_id: c.source_doc_id })));
  let excluded = [...new Set((opts.excludedAll ? items : inItems).flatMap(x => x.void_doc_ids))].sort();
  if (opts.excludedCorpusWide) excluded = vis.filter(d => isResearch(d) && voids.has(d.key)).map(d => d.id).sort();
  if (opts.oneExcludedMissing) excluded = excluded.slice(1);
  return { table, excluded_doc_ids: excluded };
}

/** The index stage as a trace hand-off (over the visible documents). */
export function indexStage(world, vis) {
  const ids = new Set(vis.map(d => d.id));
  const full = world.index ?? (world.index = textIndex(world.render.files, world.render.inputs.register.entries));
  if (ids.size === world.docs.length) return { entities: full.entities.map(x => ({ ...x, docs: [...x.docs] })) };
  const files = Object.fromEntries(Object.entries(world.render.files).filter(([p]) => ids.has(p.slice(7, -4))));
  const regs = world.render.inputs.register.entries;
  return { entities: textIndex(files, regs).entities };
}

/** Full trace { index, plan, worker, reduce } under `opts` (default: the exact solver). */
export function runPipeline(world, opts = {}) {
  const vis = visibleOf(world, opts);
  const voids = voidKeys(world, vis, opts);
  const idx = opts.traces === false ? null : indexStage(world, vis);
  const pl = plan(world, vis, opts);
  const wk = worker(world, vis, voids, pl.candidates, opts);
  return { index: idx, plan: pl, worker: wk, reduce: reduce(world, vis, voids, wk.items, opts) };
}
export const solveOutput = (world, opts = {}) => runPipeline(world, { ...opts, traces: false }).reduce;
