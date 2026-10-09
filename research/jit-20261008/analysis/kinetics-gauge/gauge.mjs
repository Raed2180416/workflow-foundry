// Kinetics comparator gauge, Stage A ($0): row 2 Stage A + row 37 of research/jit-20261008/BLOCKER-SYNTHESIS.md.
//   node --max-old-space-size=1024 research/jit-20261008/analysis/kinetics-gauge/gauge.mjs [outDir]
// Inputs: kinetics dev seeds 201-224 only (d4 for 201-216, d5 for 217-224, as experiments/jit/configs/dev-kinetics-1.json).
// Nothing from seeds 225+ or the sealed beds is touched (the SEEDS guard below).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, oracle, referenceSolve, badControls, _internals } from '../../../../beds/kinetics/index.mjs';
import { fitA, fitB, SOP_FITTERS, VARIANT_FITTERS, fitAnswer, sigfig } from './fitters.mjs';
import { retainedPoints, refitAnswer } from './refit.mjs';
// dist(), same(), quant() and TK live in metric.mjs (shared with stage-b-analyze.mjs); re-exported here.
import { TK, same, dist, quant } from './metric.mjs';
export { TK, same, dist, quant };

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });

const SEEDS = []; for (let s = 201; s <= 224; s++) SEEDS.push(s);
if (SEEDS.some(s => s < 201 || s > 224)) throw new Error('seed guard: kinetics dev 201-224 only');
const diffOf = s => (s <= 216 ? 4 : 5);
const RELTOLS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05];
const FINE_RELTOLS = [1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4];            // how small can relTol go before fitter noise matters
const LOOSE_RELTOLS = [0.08, 0.10, 0.15, 0.20];                          // above compare.mjs MAX_REL_TOL 0.05: allowLooseTolerance (README precision 0.08, prompt +-10%)

const rate = (n, d) => (d ? n / d : null);

const rows = [];            // one record per (seed, answer-name)
const answers = {};         // seed -> { name: answer }
const meta = [];
for (const seed of SEEDS) {
  const difficulty = diffOf(seed);
  const task = generate({ seed, split: 'dev', difficulty });
  const { world, shown } = _internals(task);
  const truthSet = new Set(world.wells.filter(w => w.status === 'outlier').map(w => w.id));   // SOP exclusion set = the oracle's
  const retained = retainedPoints(world, shown, truthSet);
  const A = fitAnswer(world.conds, retained, truthSet, fitA);
  const B = fitAnswer(world.conds, retained, truthSet, fitB);
  const ref = referenceSolve(task);                  // bed's own fit.mjs, third implementation of the same estimator
  const ans = { A, B, ref };
  for (const [n, f] of Object.entries(VARIANT_FITTERS)) ans[`var:${n}`] = fitAnswer(world.conds, retained, truthSet, f);
  for (const d of [2, 3, 4]) ans[`var:round${d}sf`] = { ...A, conditions: A.conditions.map(c => ({ ...c, vmax: sigfig(c.vmax, d), km: sigfig(c.km, d) })) };
  for (const bc of badControls) ans[`ctl:${bc.name}`] = bc.make(task);
  answers[seed] = ans;
  const orc = {};
  for (const [n, a] of Object.entries(ans)) { const r = oracle(task, a); orc[n] = { pass: r.pass, score: r.score, evaluatorValid: r.details?.evaluatorValid }; }
  // distance of the reference from the generating truth (how much slack the 10% oracle leaves around a careful fit)
  const o = oracle(task, A);
  const refErr = o.details.perCondition.flatMap(p => [p.vmaxRelErr, p.kmRelErr]);
  meta.push({ seed, difficulty, nConds: world.conds.length, nWells: world.wells.length, nExcluded: truthSet.size, dose: !!world.dose, orc, truthRelErrMax: Math.max(...refErr), truthRelErrMedian: quant(refErr, 0.5) });
}

// ------------- correct-correct pairs -------------
const pass = (seed, n) => meta.find(m => m.seed === seed).orc[n].pass;
const cc = [];   // {kind, seed, a, b, dist}
const addPair = (kind, seed, an, bn) => { const d = dist(answers[seed][an], answers[seed][bn]); cc.push({ kind, seed, a: an, b: bn, ...d }); };
for (const seed of SEEDS) {
  addPair('sop:A-vs-B', seed, 'A', 'B');
  addPair('sop:A-vs-bedfit', seed, 'A', 'ref');
  addPair('sop:B-vs-bedfit', seed, 'B', 'ref');
  for (const n of Object.keys(VARIANT_FITTERS)) if (pass(seed, 'A') && pass(seed, `var:${n}`)) addPair(`nonsop:A-vs-${n}`, seed, 'A', `var:${n}`);
  for (const d of [2, 3, 4]) if (pass(seed, `var:round${d}sf`)) addPair(`round:A-vs-${d}sf`, seed, 'A', `var:round${d}sf`);
}
const ccKinds = [...new Set(cc.map(p => p.kind))];
const variantPassRate = Object.fromEntries(['A', 'B', 'ref', ...Object.keys(VARIANT_FITTERS).map(n => `var:${n}`), 'var:round2sf', 'var:round3sf', 'var:round4sf'].map(n => [n, SEEDS.filter(s => pass(s, n)).length]));

const ccTable = ccKinds.map(kind => {
  const ps = cc.filter(p => p.kind === kind);
  const out = { kind, n: ps.length, allSetSame: ps.every(p => p.setSame), maxSymQ: [0, .5, .9, 1].map(q => quant(ps.map(p => p.maxSym), q)), vmaxMaxQ: [0, .5, 1].map(q => quant(ps.map(p => p.vmaxMax), q)), kmMaxQ: [0, .5, 1].map(q => quant(ps.map(p => p.kmMax), q)), falseDisagree: {} };
  for (const t of [...FINE_RELTOLS, ...RELTOLS]) out.falseDisagree[t] = ps.filter(p => !same(answers[p.seed][p.a], answers[p.seed][p.b], t)).length / ps.length;
  return out;
});

// ------------- correct-wrong pairs -------------
const CTL = badControls.map(b => b.name);
const cw = [];
for (const seed of SEEDS) for (const name of CTL) {
  const d = dist(answers[seed].A, answers[seed][`ctl:${name}`]);
  cw.push({ seed, name, passedOracle: pass(seed, `ctl:${name}`), ...d });
}
const ctlTable = CTL.map(name => {
  const ps = cw.filter(p => p.name === name);
  const sameSet = ps.filter(p => p.setSame);
  const out = {
    name, n: ps.length, passedOracle: ps.filter(p => p.passedOracle).length,
    exclusionSetDiffers: ps.filter(p => !p.setSame).length,
    maxSymQ_all: [0, .1, .5, .9, 1].map(q => quant(ps.map(p => p.maxSym), q)),
    sameSetN: sameSet.length,
    maxSymQ_sameSet: sameSet.length ? [0, .1, .5, .9, 1].map(q => quant(sameSet.map(p => p.maxSym), q)) : null,
    vmaxMaxMedian_sameSet: sameSet.length ? quant(sameSet.map(p => p.vmaxMax), .5) : null,
    kmMaxMedian_sameSet: sameSet.length ? quant(sameSet.map(p => p.kmMax), .5) : null,
    notFarFromCorrect: ps.filter(p => p.setSame && p.maxSym < 0.15).length,    // same exclusion set and within 15%
    falseAgree: {},
  };
  for (const t of RELTOLS) out.falseAgree[t] = ps.filter(p => same(answers[p.seed].A, answers[p.seed][`ctl:${name}`], t)).length / ps.length;
  return out;
});
const PBW = CTL.filter(n => n.startsWith('plausible-but-wrong:'));
const pbwAll = cw.filter(p => PBW.includes(p.name));
const falseAgreePBW = Object.fromEntries(RELTOLS.map(t => [t, pbwAll.filter(p => same(answers[p.seed].A, answers[p.seed][`ctl:${p.name}`], t)).length / pbwAll.length]));
const falseAgreeAll = Object.fromEntries(RELTOLS.map(t => [t, cw.filter(p => same(answers[p.seed].A, answers[p.seed][`ctl:${p.name}`], t)).length / cw.length]));
const falseAgreeNear = Object.fromEntries(RELTOLS.map(t => [t, cw.filter(p => p.name === 'near-miss:km-12pct' && same(answers[p.seed].A, answers[p.seed][`ctl:${p.name}`], t)).length / SEEDS.length]));
const claim = {
  pbwPairs: pbwAll.length,
  setDiffers: pbwAll.filter(p => !p.setSame).length,
  sameSetPairs: pbwAll.filter(p => p.setSame).length,
  sameSetAnd_ge15: pbwAll.filter(p => p.setSame && p.maxSym >= 0.15).length,
  sameSetAnd_lt15: pbwAll.filter(p => p.setSame && p.maxSym < 0.15).length,
  sameSetAnd_lt05: pbwAll.filter(p => p.setSame && p.maxSym < 0.05).length,
  sameSetAnd_lt02: pbwAll.filter(p => p.setSame && p.maxSym < 0.02).length,
  setDiffersOr_ge15: pbwAll.filter(p => !p.setSame || p.maxSym >= 0.15).length,
};
// If the exclusion set were NOT checked exactly (numbers only), how often would a numbers-only comparison agree?
const numbersOnly = Object.fromEntries(RELTOLS.map(t => [t, pbwAll.filter(p => {
  const a = { ...answers[p.seed].A, excluded_samples: [] }, b = { ...answers[p.seed][`ctl:${p.name}`], excluded_samples: [] };
  return same(a, b, t);
}).length / pbwAll.length]));

// ------------- row 37: decision-first comparison with one shared refit -------------
// For each (A, other) pair that DISAGREES at relTol t: does it vanish if both are re-fitted through the shared fitter
// using the exclusion sets of the two answers (only possible when the sets are equal)?
const row37 = {};
for (const t of [0.001, 0.005, 0.01, 0.02, 0.05]) {
  const bucket = (pairs, getOther) => {
    const dis = pairs.filter(p => !same(answers[p.seed].A, getOther(p), t));
    const vanish = dis.filter(p => {
      const o = getOther(p), task = generate({ seed: p.seed, split: 'dev', difficulty: diffOf(p.seed) }), { world, shown } = _internals(task);
      const sx = new Set(answers[p.seed].A.excluded_samples), sy = new Set(o.excluded_samples);
      if (sx.size !== sy.size || [...sx].some(x => !sy.has(x))) return false;       // decision-first: exclusion sets must match exactly
      return same(refitAnswer(world, shown, [...sx], fitA), refitAnswer(world, shown, [...sy], fitB), t);
    });
    return { pairs: pairs.length, disagree: dis.length, vanishAfterSharedRefit: vanish.length };
  };
  row37[t] = {
    correctCorrect_nonSop: bucket(cc.filter(p => p.kind.startsWith('nonsop:') || p.kind.startsWith('round:')), p => answers[p.seed][p.b]),
    correctWrong_pbw: bucket(pbwAll, p => answers[p.seed][`ctl:${p.name}`]),
  };
}

// loose tolerances: the README precision (0.05 / 0.08) and the prompt's +-10% rule (0.10), and 0.15 / 0.20 for two passers
const loose = {};
for (const t of [0.05, ...LOOSE_RELTOLS]) {
  const ccNon = cc.filter(p => p.kind.startsWith('nonsop:') || p.kind.startsWith('round:'));
  const near = cw.filter(p => p.name === 'near-miss:km-12pct');
  loose[t] = {
    falseDisagree_sopFitters: cc.filter(p => p.kind.startsWith('sop:')).filter(p => !same(answers[p.seed][p.a], answers[p.seed][p.b], t)).length / cc.filter(p => p.kind.startsWith('sop:')).length,
    falseDisagree_nonSop_passers: ccNon.filter(p => !same(answers[p.seed][p.a], answers[p.seed][p.b], t)).length / ccNon.length,
    falseAgree_pbw: pbwAll.filter(p => same(answers[p.seed].A, answers[p.seed][`ctl:${p.name}`], t)).length / pbwAll.length,
    falseAgree_nearMiss12: near.filter(p => same(answers[p.seed].A, answers[p.seed][`ctl:${p.name}`], t)).length / near.length,
    falseAgree_pbw_numbersOnly: pbwAll.filter(p => same({ ...answers[p.seed].A, excluded_samples: [] }, { ...answers[p.seed][`ctl:${p.name}`], excluded_samples: [] }, t)).length / pbwAll.length,
  };
}
// smallest distance of any same-exclusion-set wrong answer from the correct one, by control
const minDist = Object.fromEntries(CTL.map(n => { const ps = cw.filter(p => p.name === n && p.setSame); return [n, ps.length ? Math.min(...ps.map(p => p.maxSym)) : null]; }));
// largest separation two oracle-passing answers can have if each is within 10% of the truth (compare.mjs metric |a-b|/max)
const passersWorstCase = 0.2 / 1.1;

const out = { generated: new Date().toISOString().slice(0, 10), seeds: SEEDS, relTols: RELTOLS, fineRelTols: FINE_RELTOLS, meta, variantPassRate, ccTable, ctlTable, falseAgreePBW, falseAgreeAll, falseAgreeNear, numbersOnly, claim, row37, loose, minDist, passersWorstCase };
fs.writeFileSync(path.join(outDir, 'gauge-results.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(outDir, 'pairs-cc.jsonl'), cc.map(({ perCond, ...r }) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'pairs-cw.jsonl'), cw.map(({ perCond, ...r }) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'answers-A.json'), JSON.stringify(Object.fromEntries(SEEDS.map(s => [s, answers[s].A]))));
console.log('written', outDir, 'seeds', SEEDS.length, 'cc pairs', cc.length, 'cw pairs', cw.length);
