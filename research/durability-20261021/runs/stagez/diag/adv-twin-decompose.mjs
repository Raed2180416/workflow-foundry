// $0 diagnostic (post hoc, never a DUR-1 result): decompose ADV twin differences on designer-known changes only.
const WT = '/home/user/workflow-foundry/.claude/worktrees/wf_bd674a6e-71f-11';
const { worldsOf, SEALED } = await import(`${WT}/experiments/durability/schedule.mjs`);
const { buildBundle } = await import(`${WT}/experiments/durability/changes.mjs`);
const { referencePools } = await import(`${WT}/experiments/durability/oracle.mjs`);
const { caseSignatures } = await import(`${WT}/experiments/durability/exposure.mjs`);
const [stream, k] = [process.argv[2] ?? 's1', Number(process.argv[3] ?? 5)];
const w = worldsOf(stream)[k - 1];
const spec = { ...w, changes: w.changes.filter(c => !SEALED.includes(c.id)) };
const ids = spec.changes.map(c => c.id);
const sig = async B => { const p = await referencePools(B, { keepRows: true }); return { sig: caseSignatures(B, p.rows.earliest), pools: p.pools, ok: p.control.ok, probs: p.control.problems }; };
const A = await buildBundle(spec);                          // ADV on: id -inj, L1/F drawn on -inj, actors on -inj
const Bx = await buildBundle(spec, { exclude: ['ADV'] });   // ADV off: plain id everywhere
const E = await buildBundle(spec, { exclude: ['ADV'] });    // ADV off, but id forced to -inj: only actor draws move
E.W = { ...E.W, id: A.W.id }; E.worldDigest = E.worldDigest + '-idinj';
const sa = await sig(A), sb = await sig(Bx), se = await sig(E);
const diff = (x, y) => { let n = 0, nc = 0; for (const [c, s] of x.sig) { if (y.sig.get(c) !== s) { n++; if (x.pools[c] === 'completed') nc++; } } return { cases: n, completed: nc }; };
const completed = Object.values(sa.pools).filter(p => p === 'completed').length;
console.log(JSON.stringify({ world: `${stream}-W${k}`, designerKnownChanges: ids, ids: { on: A.W.id, off: Bx.W.id },
  completedWithADV: completed, refOk: { on: sa.ok, off: sb.ok, idOnly: se.ok }, refProblems: { on: sa.probs, off: sb.probs, idOnly: se.probs },
  L1touched: { on: A.touched.L1?.size ?? 0, off: Bx.touched.L1?.size ?? 0, idOnly: E.touched.L1?.size ?? 0 },
  sigDiff_onVsOff: diff(sa, sb), sigDiff_idOnlyVsOff_actorsOnly: diff(se, sb), sigDiff_onVsIdOnly_L1Fredraw: diff(sa, se) }));
