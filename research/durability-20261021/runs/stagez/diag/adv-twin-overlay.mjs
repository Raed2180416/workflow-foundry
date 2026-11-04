// $0 diagnostic (post hoc): (1) generateWorld(injection) differs only in id, publicId and documents?
// (2) ADV twin decomposition per W5/W6 world on designer-known changes; (3) document-only overlay keeps the id -> twin like-for-like?
const WT = '/home/user/workflow-foundry/.claude/worktrees/wf_bd674a6e-71f-11';
const { worldsOf, SEALED } = await import(`${WT}/experiments/durability/schedule.mjs`);
const { buildBundle } = await import(`${WT}/experiments/durability/changes.mjs`);
const { referencePools } = await import(`${WT}/experiments/durability/oracle.mjs`);
const { caseSignatures } = await import(`${WT}/experiments/durability/exposure.mjs`);
const { generateWorld } = await import(`${WT}/beds/ebed/e8/world.mjs`);
const out = [];
for (const stream of ['s1', 's2', 's3']) for (const k of [5, 6]) {
  const w = worldsOf(stream)[k - 1];
  const g0 = generateWorld({ seed: w.seed, difficulty: 3, mix: 'tail', size: w.size }), g1 = generateWorld({ seed: w.seed, difficulty: 3, mix: 'tail', size: w.size, injection: true });
  const strip = g => JSON.stringify({ ...g, id: null, publicId: null, arrivals: g.arrivals.map(a => ({ ...a, doc: undefined })) });
  const docs = new Map(g1.arrivals.filter(a => typeof a.doc === 'string').map(a => [a.id, a.doc]));
  const spec = { ...w, changes: w.changes.filter(c => !SEALED.includes(c.id)) };
  const A = await buildBundle(spec), Bx = await buildBundle(spec, { exclude: ['ADV'] });
  const D = await buildBundle(spec, { exclude: ['ADV'] });   // the proposed fix: ADV = document-only overlay, id unchanged
  D.W = { ...D.W, arrivals: D.W.arrivals.map(a => (docs.has(a.id) ? { ...a, doc: docs.get(a.id) } : a)) }; D.worldDigest += '-docov';
  const s = async B => { const p = await referencePools(B, { keepRows: true }); return { sig: caseSignatures(B, p.rows.earliest), pools: p.pools, ok: p.control.ok }; };
  const sa = await s(A), sb = await s(Bx), sd = await s(D);
  const diff = (x, y) => [...x.sig].filter(([c, v]) => y.sig.get(c) !== v && x.pools[c] === 'completed').length;
  const docOrders = [...docs.keys()].length;
  out.push({ world: `${stream}-W${k}`, changes: spec.changes.map(c => c.id).join(','), sameExceptIdAndDocs: strip(g0) === strip(g1), docArrivals: docOrders,
    completed: Object.values(sa.pools).filter(p => p === 'completed').length, refOk: [sa.ok, sb.ok, sd.ok],
    twinDiffFrozen: diff(sa, sb), twinDiffDocOverlay: diff(sd, sb) });
}
console.log(JSON.stringify(out, null, 0));
