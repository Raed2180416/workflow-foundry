// Kinetics comparator gauge, Stage B analysis (README "What Stage B must add", items 1-4; row 37 for item 3).
//   node --max-old-space-size=1024 stage-b-analyze.mjs [DIR]       (DIR default out/stage-b; reads DIR/sessions.jsonl)
// Writes DIR/STAGE-B.md and DIR/stage-b.json. $0, no model calls. Pairs are scored with metric.mjs dist()/same(), the code
// gauge.mjs (Stage A) uses; the shared refit is refit.mjs (SOP section 5, fitter A, B as cross-check).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TK, same, dist, quant } from './metric.mjs';
import { fitA, fitB, VARIANT_FITTERS, fitAnswer } from './fitters.mjs';
import { retainedPoints, refitAnswer } from './refit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../../../..');
const imp = rel => import(pathToFileURL(path.join(REPO, rel)).href);
export const RELTOLS = [0.001, 0.005, 0.01, 0.02, 0.05, 0.1];
export const CANDIDATE = 0.05;
export const CAUSES = ['precision/rounding', 'estimator', 'exclusion-set', 'non-convergence/other'];
const STAGE_A_EDGE = 0.134;   // Stage A: closest same-set plausible-but-wrong control (apply-rejected-claims)
const SLACK = 1e-5;           // an answer within rounding + 1e-5 of an estimator's fit "is" that estimator's fit

// ---------------------------------------------------------------- answer explanation (item 3)
// Significant digits as printed (shortest round-trip form; trailing zeros are not significant).
export function sigDigits(x) {
  if (!Number.isFinite(x) || x === 0) return 17;
  return Math.max(1, Math.abs(x).toExponential().split('e')[0].replace('.', '').replace(/0+$/, '').length);
}
// Every number of `ans` equals `target`'s up to the rounding of the digits `ans` printed (+ slack).
export function matchesUpToRounding(ans, target, slack = SLACK) {
  const mt = new Map(target.conditions.map(c => [c.condition_id, c]));
  if (ans.conditions.length !== target.conditions.length) return false;
  for (const c of ans.conditions) {
    const o = mt.get(c.condition_id);
    if (!o) return false;
    for (const k of TK) {
      const sf = sigDigits(c[k]), bound = sf >= 15 ? 0 : 0.5 * 10 ** (1 - sf);
      if (!(Math.abs(c[k] - o[k]) / Math.max(Math.abs(o[k]), 1e-300) <= bound * (1 + 1e-9) + slack)) return false;
    }
  }
  return true;
}
const minSf = a => Math.min(...a.conditions.flatMap(c => TK.map(k => sigDigits(c[k]))));

// Which estimator, on the shared points (world displayed values) and the answer's own exclusion set, reproduces the answer?
export function explainAnswer(ctx, ans) {
  const set = new Set(ans.excluded_samples);
  const retained = retainedPoints(ctx.world, ctx.shown, set);
  const sop = fitAnswer(ctx.world.conds, retained, set, fitA);
  const sf = minSf(ans), dSop = dist(sop, ans).maxSym;
  if (matchesUpToRounding(ans, sop)) return { cls: sf >= 7 ? 'sop' : `sop-rounded-${sf}sf`, minSf: sf, distSop: dSop };
  const variants = { ...VARIANT_FITTERS };
  const freeConds = ctx.world.conds.map(c => ({ ...c, parentId: null }));
  const cands = Object.entries(variants).map(([n, f]) => [n, fitAnswer(ctx.world.conds, retained, set, f)]);
  cands.push(['free-vmax-inhibitor', fitAnswer(freeConds, retained, set, fitA)]);
  for (const [n, fit] of cands) if (matchesUpToRounding(ans, fit)) return { cls: `estimator:${n}`, minSf: sf, distSop: dSop };
  if (dSop <= 1e-3) return { cls: 'loose-optimiser', minSf: sf, distSop: dSop };
  return { cls: 'other', minSf: sf, distSop: dSop };
}
export function pairCause(setSame, ea, eb) {
  if (!setSame) return 'exclusion-set';
  const c = [ea.cls, eb.cls];
  if (c.some(x => x === 'other' || x === 'loose-optimiser')) return 'non-convergence/other';
  if (c.some(x => x.startsWith('estimator:'))) return 'estimator';
  return 'precision/rounding';
}

// ---------------------------------------------------------------- formatting
const pc = x => (x == null ? '–' : `${(100 * x).toFixed(x > 0 && x < 0.01 ? 2 : 1)}%`);
const e1 = x => (x == null ? '–' : !Number.isFinite(x) ? '∞' : x === 0 ? '0' : x.toExponential(1));
const f3 = x => (x == null ? '–' : !Number.isFinite(x) ? '∞' : x.toFixed(3));
const usd = x => `$${(x ?? 0).toFixed(4)}`;
const frac = (k, n) => (n ? `${k}/${n} (${pc(k / n)})` : `0/0`);
const qs = (xs, ps = [0, 0.5, 0.9, 1]) => ps.map(p => quant(xs.filter(Number.isFinite), p));
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');

// ---------------------------------------------------------------- analysis
export async function analyze(dir) {
  const kin = await imp('beds/kinetics/index.mjs');
  const { canonical, sha256 } = await imp('beds/lib/canonical.mjs');
  const file = path.join(dir, 'sessions.jsonl');
  if (!fs.existsSync(file)) throw new Error(`no ${file}`);
  const byKey = new Map();
  for (const l of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); byKey.set(r.key, r); }
  const rows = [...byKey.values()].sort((a, b) => a.seed - b.seed || a.session - b.session);
  const run = fs.existsSync(path.join(dir, 'run.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')) : {};
  const stub = rows.some(r => r.stub);
  const stageA = (() => { try { return JSON.parse(fs.readFileSync(path.join(here, 'out', 'gauge-results.json'), 'utf8')); } catch { return null; } })();

  const ctxs = new Map(), warnings = [];
  const ctxOf = r => {
    if (!ctxs.has(r.seed)) {
      if (r.seed < 201 || r.seed > 224) throw new Error(`seed guard: ${r.seed} is not a kinetics dev seed 201-224`);
      const task = kin.generate({ seed: r.seed, split: 'dev', difficulty: r.difficulty });
      const { world, shown } = kin._internals(task);
      const ref = kin.referenceSolve(task);
      ctxs.set(r.seed, { task, world, shown, ref, hash: sha256(canonical(task)), inhib: new Set(world.conds.filter(c => c.parentId).map(c => c.id)), refOracle: kin.oracle(task, ref) });
    }
    const c = ctxs.get(r.seed);
    if (c.hash !== r.taskHash) warnings.push(`${r.key}: recorded taskHash ${r.taskHash.slice(0, 12)} differs from the bed's ${c.hash.slice(0, 12)}`);
    return c;
  };
  for (const r of rows) {
    const c = ctxOf(r);
    r._valid = r.answer != null && kin.validateOutput(r.answer).length === 0;
    if (r._valid) r._explain = explainAnswer(c, r.answer);
  }
  const seeds = [...new Set(rows.map(r => r.seed))];
  const passing = rows.filter(r => r.oracle.pass);

  // ---- 0. sessions
  const byDiff = d => rows.filter(r => r.difficulty === d);
  const errCounts = {}; for (const r of rows) if (r.error) errCounts[r.error] = (errCounts[r.error] ?? 0) + 1;
  const sessions = {
    n: rows.length, seeds: seeds.length, perSeed: run.n ?? null, stub,
    byDifficulty: Object.fromEntries([4, 5].map(d => [`d${d}`, { n: byDiff(d).length, answer: byDiff(d).filter(r => r.answer != null).length, schemaValid: byDiff(d).filter(r => r._valid).length, pass: byDiff(d).filter(r => r.oracle.pass).length }])),
    answer: rows.filter(r => r.answer != null).length, schemaValid: rows.filter(r => r._valid).length, pass: passing.length, errors: errCounts,
    actualUsd: rows.reduce((s, r) => s + (r.actualUsd ?? 0), 0), bookedUsd: rows.reduce((s, r) => s + (r.costUsd ?? 0), 0), costUnknown: rows.filter(r => r.costUnknown).length,
    actualUsdQ: qs(rows.map(r => r.actualUsd ?? 0)), durationSQ: qs(rows.map(r => (r.durationMs ?? 0) / 1000)),
    seedsBothPass: seeds.filter(s => passing.filter(r => r.seed === s).length >= 2).length,
  };
  const ledgerFile = path.join(dir, 'ledger.jsonl');
  if (fs.existsSync(ledgerFile)) {
    const led = fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    sessions.ledger = { attempts: led.length, envFaultAttempts: led.length - led.filter(x => byKey.get(x.key)?.attempt === x.attempt).length, actualUsd: led.reduce((s, x) => s + (x.actualUsd ?? 0), 0), bookedUsd: led.reduce((s, x) => s + (x.costUsd ?? 0), 0) };
  }

  // ---- 1. correct-correct pairs (both pass the oracle), one per pair of passing sessions of a seed
  const pairsOf = list => { const out = []; for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]); return out; };
  const cc = [];
  for (const s of seeds) for (const [a, b] of pairsOf(passing.filter(r => r.seed === s))) {
    const d = dist(a.answer, b.answer), c = ctxOf(a);
    const sameAt = Object.fromEntries(RELTOLS.map(t => [t, same(a.answer, b.answer, t)]));
    const cause = pairCause(d.setSame, a._explain, b._explain);
    const vanishAt = {};
    for (const t of RELTOLS) {
      if (sameAt[t]) continue;
      vanishAt[t] = d.setSame ? same(refitAnswer(c.world, c.shown, a.answer.excluded_samples, fitA), refitAnswer(c.world, c.shown, b.answer.excluded_samples, fitB), t) : false;
    }
    cc.push({ seed: s, difficulty: a.difficulty, a: a.key, b: b.key, maxSym: d.maxSym, vmaxMax: d.vmaxMax, kmMax: d.kmMax, setSame: d.setSame, nOnlyIn: d.nOnlyIn,
      perCond: d.perCond.map(p => ({ ...p, inhibitor: c.inhib.has(p.id) })), sameAt, cause, explainA: a._explain, explainB: b._explain, vanishAt });
  }
  const ccBucket = (label, ps) => ({ label, n: ps.length, maxSymQ: qs(ps.map(p => p.maxSym)), vmaxMax: qs(ps.map(p => p.vmaxMax))[3], kmMax: qs(ps.map(p => p.kmMax))[3],
    fd: Object.fromEntries(RELTOLS.map(t => [t, ps.length ? ps.filter(p => !p.sameAt[t]).length / ps.length : null])), fdCount: Object.fromEntries(RELTOLS.map(t => [t, ps.filter(p => !p.sameAt[t]).length])) });
  const ccTable = [ccBucket('all correct–correct', cc), ccBucket('same exclusion set', cc.filter(p => p.setSame)), ccBucket('different exclusion set', cc.filter(p => !p.setSame)),
    ccBucket('d4 seeds', cc.filter(p => p.difficulty === 4)), ccBucket('d5 seeds', cc.filter(p => p.difficulty === 5))];
  const nums = cc.flatMap(p => p.perCond);
  const numBucket = (label, xs) => ({ label, n: xs.length, q: qs(xs.map(x => x.sym)), over: Object.fromEntries(RELTOLS.map(t => [t, xs.length ? xs.filter(x => x.sym > t).length / xs.length : null])) });
  const perNumber = [numBucket('Vmax, inhibitor-free conditions', nums.filter(x => x.k === 'vmax' && !x.inhibitor)), numBucket('Vmax, inhibitor conditions (shared Vmax)', nums.filter(x => x.k === 'vmax' && x.inhibitor)),
    numBucket('Km, inhibitor-free conditions', nums.filter(x => x.k === 'km' && !x.inhibitor)), numBucket('Km (apparent), inhibitor conditions', nums.filter(x => x.k === 'km' && x.inhibitor)),
    numBucket('all Vmax', nums.filter(x => x.k === 'vmax')), numBucket('all Km', nums.filter(x => x.k === 'km'))];
  const perCondId = [...new Set(nums.map(x => x.id))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map(id => numBucket(id, nums.filter(x => x.id === id)));
  // any two schema-valid answers of a seed, regardless of the oracle (context for the set split)
  const anyPairs = [];
  for (const s of seeds) for (const [a, b] of pairsOf(rows.filter(r => r.seed === s && r._valid))) {
    const d = dist(a.answer, b.answer);
    anyPairs.push({ seed: s, setSame: d.setSame, maxSym: d.maxSym, passes: Number(a.oracle.pass) + Number(b.oracle.pass), sameAt: Object.fromEntries(RELTOLS.map(t => [t, same(a.answer, b.answer, t)])) });
  }
  const anyBucket = (label, ps) => ({ label, n: ps.length, maxSymQ: qs(ps.map(p => p.maxSym)), agree: Object.fromEntries(RELTOLS.map(t => [t, ps.length ? ps.filter(p => p.sameAt[t]).length / ps.length : null])) });
  const anyTable = [anyBucket('same set, both pass', anyPairs.filter(p => p.setSame && p.passes === 2)), anyBucket('same set, one or none passes', anyPairs.filter(p => p.setSame && p.passes < 2)),
    anyBucket('different set', anyPairs.filter(p => !p.setSame))];

  // ---- 2. wrong agent answers
  const wrongAll = rows.filter(r => r.answer != null && !r.oracle.pass);
  const noAnswer = rows.filter(r => r.answer == null);
  const wrong = wrongAll.filter(r => r._valid).map(r => {
    const c = ctxOf(r), dr = dist(c.ref, r.answer);
    const corr = passing.filter(p => p.seed === r.seed);
    const dc = corr.map(p => dist(p.answer, r.answer));
    const pcs = r.oracle.perCondition ?? [];
    const why = [];
    if (r.oracle.setExact === false) why.push(`set (−${r.oracle.missing?.length ?? 0}/+${r.oracle.extra?.length ?? 0})`);
    const offConds = pcs.filter(p => !p.ok && !p.missing).length, missConds = pcs.filter(p => p.missing).length;
    if (offConds) why.push(`${offConds} cond. off >10%`);
    if (missConds) why.push(`${missConds} cond. missing`);
    if (r.oracle.unknownConditions?.length) why.push(`${r.oracle.unknownConditions.length} unknown cond.`);
    if (r.oracle.duplicateConditions?.length) why.push('duplicate cond.');
    const truthErr = Math.max(0, ...pcs.filter(p => !p.missing).flatMap(p => [p.vmaxRelErr, p.kmRelErr]));
    const region = !dr.setSame ? 'set differs' : !Number.isFinite(dr.maxSym) ? 'missing conditions' : dr.maxSym < CANDIDATE ? `same set, < ${CANDIDATE}` : dr.maxSym < STAGE_A_EDGE ? `same set, ${CANDIDATE}–${STAGE_A_EDGE}` : `same set, ≥ ${STAGE_A_EDGE}`;
    return { key: r.key, seed: r.seed, difficulty: r.difficulty, why: why.join('; ') || 'other', setSame: dr.setSame, nOnlyIn: dr.nOnlyIn, distRef: dr.maxSym, vmaxRef: dr.vmaxMax, kmRef: dr.kmMax,
      distCorrectMin: dc.length ? Math.min(...dc.map(d => d.maxSym)) : null, nCorrect: corr.length, truthErrMax: truthErr, region, explain: r._explain,
      faRef: Object.fromEntries(RELTOLS.map(t => [t, same(c.ref, r.answer, t)])), faCorrect: Object.fromEntries(RELTOLS.map(t => [t, corr.filter(p => same(p.answer, r.answer, t)).length])) };
  });
  const regions = ['set differs', `same set, < ${CANDIDATE}`, `same set, ${CANDIDATE}–${STAGE_A_EDGE}`, `same set, ≥ ${STAGE_A_EDGE}`, 'missing conditions'];
  const wrongSummary = {
    n: wrong.length, schemaInvalid: wrongAll.length - wrong.length, noAnswer: noAnswer.length,
    regions: Object.fromEntries(regions.map(g => [g, wrong.filter(w => w.region === g).length])),
    sameSetDistQ: qs(wrong.filter(w => w.setSame).map(w => w.distRef), [0, 0.5, 1]),
    faRef: Object.fromEntries(RELTOLS.map(t => [t, wrong.filter(w => w.faRef[t]).length])),
    faCorrectPairs: Object.fromEntries(RELTOLS.map(t => [t, wrong.reduce((s, w) => s + w.faCorrect[t], 0)])), correctPairs: wrong.reduce((s, w) => s + w.nCorrect, 0),
  };

  // ---- 3. causes of correct-correct disagreements, and whether the shared refit removes them (row 37)
  const causes = Object.fromEntries(RELTOLS.map(t => {
    const dis = cc.filter(p => !p.sameAt[t]);
    return [t, { pairs: cc.length, disagree: dis.length, byCause: Object.fromEntries(CAUSES.map(k => [k, dis.filter(p => p.cause === k).length])), vanishAfterSharedRefit: dis.filter(p => p.vanishAt[t]).length }];
  }));
  const explainCounts = {}; for (const r of rows.filter(r => r._valid)) { const k = `${r.oracle.pass ? 'pass' : 'fail'}:${r._explain.cls}`; explainCounts[k] = (explainCounts[k] ?? 0) + 1; }

  // ---- 4. oracle-passing answers vs the reference and vs the generating truth
  const passRef = passing.map(r => { const c = ctxOf(r), d = dist(c.ref, r.answer); const pcs = r.oracle.perCondition ?? [];
    return { key: r.key, maxSym: d.maxSym, vmaxMax: d.vmaxMax, kmMax: d.kmMax, truthVmax: Math.max(0, ...pcs.map(p => p.vmaxRelErr ?? 0)), truthKm: Math.max(0, ...pcs.map(p => p.kmRelErr ?? 0)),
      refTruth: Math.max(0, ...c.refOracle.details.perCondition.flatMap(p => [p.vmaxRelErr, p.kmRelErr])), sameRef: Object.fromEntries(RELTOLS.map(t => [t, same(c.ref, r.answer, t)])) }; });
  const toRef = {
    n: passRef.length, maxSymQ: qs(passRef.map(p => p.maxSym)), vmaxQ: qs(passRef.map(p => p.vmaxMax)), kmQ: qs(passRef.map(p => p.kmMax)),
    truthQ: qs(passRef.map(p => Math.max(p.truthVmax, p.truthKm))), truthVmaxQ: qs(passRef.map(p => p.truthVmax)), truthKmQ: qs(passRef.map(p => p.truthKm)), refTruthQ: qs(passRef.map(p => p.refTruth)),
    withinRef: Object.fromEntries(RELTOLS.map(t => [t, passRef.filter(p => p.sameRef[t]).length])),
  };

  const out = { generated: new Date().toISOString(), dir: path.relative(REPO, dir) || dir, stub, run, relTols: RELTOLS, candidate: CANDIDATE, warnings, sessions,
    item1: { ccTable, perNumber, perCondId, anyTable, pairs: cc.map(({ perCond, ...p }) => p) }, item2: { summary: wrongSummary, wrong }, item3: { causes, explainCounts },
    item4: { ...toRef, answers: passRef } };
  return { out, md: render(out, stageA) };
}

// ---------------------------------------------------------------- report
function render(o, stageA) {
  const L = [], T = o.relTols, s = o.sessions;
  L.push(`# Kinetics comparator gauge, Stage B${o.stub ? ' — STUB DATA, NOT LIVE' : ''}`, '');
  if (o.stub) L.push('> **Every number below comes from `stage-b.mjs --stub`**, a test interpreter built from the bed\'s own reference solver (perturbed', '> deterministically, with a deliberately wrong answer every k-th session). It proves the driver and this analysis run end to end.', '> It says nothing about agents. Do not cite it.', '');
  L.push(`*Generated ${o.generated.slice(0, 16)}Z by \`stage-b-analyze.mjs\` from \`${o.dir}/sessions.jsonl\`. Model ${o.run.model ?? '?'}, cap $${o.run.capUsd ?? '?'}/session, ${o.run.mode ?? '?'} mode.*`, '');
  L.push(`**Scope.** ${s.n} sessions on ${s.seeds} kinetics dev seeds (201–224 range; d4 = 201–216, d5 = 217–224, as \`dev-kinetics-1.json\`), ${o.run.n ?? '?'} per seed. `
    + 'These seeds were seen during JIT development, so this is **dev calibration, not a freeze**: under FG §4.1 a relTol calibrated here enters the frozen PREREG only with owner decision O1; otherwise the fallback is the README-stated precision (0.05). Every rate below states its n; with n this small they are counts, not interval estimates.', '');
  if (o.warnings.length) L.push('**Warnings:** ' + o.warnings.join('; '), '');

  L.push('## Sessions', '');
  L.push(table(['', 'n', 'answer.json', 'schema-valid', 'oracle pass'], [
    ...['d4', 'd5'].map(d => [d, s.byDifficulty[d].n, s.byDifficulty[d].answer, s.byDifficulty[d].schemaValid, frac(s.byDifficulty[d].pass, s.byDifficulty[d].n)]),
    ['all', s.n, s.answer, s.schemaValid, frac(s.pass, s.n)]]), '');
  L.push(`- Seeds where at least two sessions pass (a correct–correct pair exists): ${s.seedsBothPass}/${s.seeds}.`);
  L.push(`- Error codes on recorded sessions: ${Object.keys(s.errors).length ? Object.entries(s.errors).map(([k, v]) => `${k} ${v}`).join(', ') : 'none'}.`);
  L.push(`- Cost (recorded sessions): actual ${usd(s.actualUsd)}, booked ${usd(s.bookedUsd)}; cost-unknown sessions ${s.costUnknown}; per session actual min/median/p90/max ${s.actualUsdQ.map(usd).join(' / ')}. Wall time per session min/median/p90/max ${s.durationSQ.map(x => `${Math.round(x ?? 0)} s`).join(' / ')}.`);
  if (s.ledger) L.push(`- Ledger (every attempt, faulted ones included): ${s.ledger.attempts} attempts, ${s.ledger.envFaultAttempts} not recorded as sessions (environment faults), actual ${usd(s.ledger.actualUsd)}, booked ${usd(s.ledger.bookedUsd)}.`);
  L.push('');

  const i1 = o.item1;
  L.push('## 1. Correct–correct pairs: spread and false-disagreement', '');
  L.push('Pairs of sessions on the same seed that both pass the oracle. Spread = `|a − b| / max(|a|, |b|)`, worst number of the pair (`dist().maxSym`). FD@t = share of pairs `same()` judges different at relTol t, with the exclusion set compared exactly (t = 0.1 sets `allowLooseTolerance`).', '');
  L.push(table(['pairs', 'n', 'spread min / median / p90 / max', 'max ΔVmax/Vmax', 'max ΔKm/Km', ...T.map(t => `FD@${t}`)],
    i1.ccTable.map(b => [b.label, b.n, b.maxSymQ.map(e1).join(' / '), e1(b.vmaxMax), e1(b.kmMax), ...T.map(t => (b.n ? `${pc(b.fd[t])} (${b.fdCount[t]})` : '–'))])), '');
  L.push('Two answers that both pass the oracle carry the true exclusion set (the oracle requires it exactly), so the "different exclusion set" row is empty by construction; the split below over all schema-valid pairs shows where set differences do occur.', '');
  L.push('**By number (Vmax / Km, inhibitor-free / inhibitor conditions)** — one entry per number per correct–correct pair; share of numbers whose spread exceeds t:', '');
  L.push(table(['numbers', 'n', 'spread min / median / p90 / max', ...T.map(t => `> ${t}`)], i1.perNumber.map(b => [b.label, b.n, b.q.map(e1).join(' / '), ...T.map(t => pc(b.over[t]))])), '');
  L.push('<details><summary>By condition id (ids are per task; C1… are not the same condition across seeds)</summary>', '');
  L.push(table(['condition', 'n numbers', 'spread min / median / p90 / max', ...T.map(t => `> ${t}`)], i1.perCondId.map(b => [b.label, b.n, b.q.map(e1).join(' / '), ...T.map(t => pc(b.over[t]))])), '', '</details>', '');
  L.push('**All schema-valid answer pairs of a seed, by exclusion set** (share judged the same at t):', '');
  L.push(table(['pairs', 'n', 'spread min / median / p90 / max', ...T.map(t => `same@${t}`)], i1.anyTable.map(b => [b.label, b.n, b.maxSymQ.map(e1).join(' / '), ...T.map(t => pc(b.agree[t]))])), '');

  const i2 = o.item2, w = i2.summary;
  L.push('## 2. Wrong agent answers, next to the Stage A controls', '');
  L.push(`Sessions that fail the oracle: ${w.n} schema-valid wrong answers, ${w.schemaInvalid} schema-invalid, ${w.noAnswer} without an answer.json. Distance is to the bed's reference answer (\`referenceSolve\`, fitter-A quality) and to the nearest passing agent answer of the same seed.`, '');
  L.push(table(['region (vs reference)', 'wrong answers'], regions(o).map(g => [g, `${w.regions[g]}/${w.n}`])), '');
  L.push(`Same-set wrong answers' distance from the reference, min / median / max: ${w.sameSetDistQ.map(f3).join(' / ')}. False agreement with the reference at t (of ${w.n}): ${T.map(t => `${t}: ${w.faRef[t]}`).join(', ')}. With passing agent answers of the same seed (of ${w.correctPairs} correct–wrong pairs): ${T.map(t => `${t}: ${w.faCorrectPairs[t]}`).join(', ')}.`, '');
  if (i2.wrong.length) {
    L.push(table(['session', 'd', 'oracle fails on', 'set = ref', 'Δset', 'dist to ref', 'ΔVmax', 'ΔKm', 'nearest passing agent', 'max truth err', 'estimator on own set'],
      i2.wrong.map(x => [x.key, x.difficulty, x.why, x.setSame ? 'yes' : 'no', x.nOnlyIn, f3(x.distRef), f3(x.vmaxRef), f3(x.kmRef), x.distCorrectMin == null ? '–' : f3(x.distCorrectMin), f3(x.truthErrMax), x.explain.cls])), '');
  }
  if (stageA) {
    L.push('Stage A controls (synthetic, fitter A vs control; `out/gauge-results.json`), n = 24 each, for comparison:', '');
    L.push(table(['control', 'n', 'exclusion set differs', 'same-set distance min / median / max', `FA@${CANDIDATE}`],
      [['**agent wrong answers (this run)**', w.n, `${w.regions['set differs']}/${w.n}`, w.sameSetDistQ.map(f3).join(' / '), `${w.faRef[CANDIDATE]}/${w.n} (vs reference)`],
        ...stageA.ctlTable.map(t => [t.name.replace('plausible-but-wrong:', 'pbw:'), t.n, `${t.exclusionSetDiffers}/${t.n}`, t.maxSymQ_sameSet ? [t.maxSymQ_sameSet[0], t.maxSymQ_sameSet[2], t.maxSymQ_sameSet[4]].map(f3).join(' / ') : '–', pc(t.falseAgree[CANDIDATE])])]), '');
  }

  const i3 = o.item3;
  L.push('## 3. Why correct–correct pairs disagree, and whether one shared refit removes it (row 37)', '');
  L.push('Each schema-valid answer is matched against fits on the shared points (the world\'s displayed values, as the reference solver sees them) with the answer\'s own exclusion set: the SOP fit (fitter A) up to the digits the answer printed (+1e-5) → `sop` / `sop-rounded-Nsf`; else one of the non-SOP estimators (replicate means, 1/v² weights, Hanes–Woolf, Lineweaver–Burk, Eadie–Hofstee, free Vmax for inhibitor conditions) → `estimator:*`; else within 1e-3 of the SOP fit → `loose-optimiser`; else `other` (a parse or data decision the shared points do not share, or an unidentified fit). A pair\'s cause: exclusion-set if the sets differ; non-convergence/other if either answer is `loose-optimiser` or `other`; estimator if either is `estimator:*`; else precision/rounding.', '');
  L.push(table(['relTol', 'correct–correct pairs', 'disagree', ...CAUSES, 'vanish after shared refit'],
    T.map(t => { const c = i3.causes[t]; return [t === CANDIDATE ? `**${t}**` : t, c.pairs, c.disagree, ...CAUSES.map(k => c.byCause[k]), c.disagree ? `${c.vanishAfterSharedRefit}/${c.disagree}` : '–']; })), '');
  const dis = o.item1.pairs.filter(p => !p.sameAt[CANDIDATE]);
  if (dis.length) {
    L.push(`Disagreeing pairs at the candidate relTol ${CANDIDATE}:`, '');
    L.push(table(['pair', 'spread', 'set same', 'cause', 'answer a', 'answer b', 'vanish after refit'], dis.map(p => [`${p.a} vs ${p.b}`, f3(p.maxSym), p.setSame ? 'yes' : 'no', p.cause, p.explainA.cls, p.explainB.cls, p.vanishAt[CANDIDATE] ? 'yes' : 'no'])), '');
  } else L.push(`No correct–correct pair disagrees at ${CANDIDATE} (n = ${o.item1.pairs.length} pairs).`, '');
  L.push(`Answer classes (all schema-valid answers, by oracle verdict): ${Object.entries(i3.explainCounts).sort().map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`, '');
  L.push('Caveat (Stage A, row 37): the shared refit uses the shared points, so it also erases unit, correction and dose mistakes; "vanishes after the shared refit" is safe only for answers that passed, or if each answer carries its own point table.', '');

  const i4 = o.item4;
  L.push('## 4. Oracle-passing answers: distance from the reference and from the generating truth', '');
  L.push(table(['n = ' + i4.n + ' passing answers', 'min', 'median', 'p90', 'max'], [
    ['dist to reference (worst number, Δ/max)', ...i4.maxSymQ.map(e1)], ['ΔVmax/Vmax to reference', ...i4.vmaxQ.map(e1)], ['ΔKm/Km to reference', ...i4.kmQ.map(e1)],
    ['worst relative error to truth (oracle)', ...i4.truthQ.map(f3)], ['Vmax error to truth', ...i4.truthVmaxQ.map(f3)], ['Km error to truth', ...i4.truthKmQ.map(f3)],
    ['the reference\'s own worst error to truth (same tasks)', ...i4.refTruthQ.map(f3)]]), '');
  L.push(`Passing answers judged the same as the reference at t (of ${i4.n}): ${T.map(t => `${t}: ${i4.withinRef[t]}`).join(', ')}. The oracle box is ±10% around the truth; the reference itself sits within 5% of it (README), so a passing answer far from the reference is using the slack between the two.`, '');

  L.push('## What this does not show', '');
  L.push(`- n is small: ${s.n} sessions, ${o.item1.pairs.length} correct–correct pairs, ${w.n} schema-valid wrong answers. Rates are counts on these sessions, not population estimates.`);
  L.push('- Dev calibration only (FG §4.1, O1): the seeds were used during development; a value chosen from these tables cannot be frozen without O1, and the README-precision fallback (0.05) stays available.');
  L.push('- Two sessions per seed give at most one correct–correct pair per seed; seeds where only one session passes contribute no pair.');
  return L.join('\n') + '\n';
}
const regions = () => ['set differs', `same set, < ${CANDIDATE}`, `same set, ${CANDIDATE}–${STAGE_A_EDGE}`, `same set, ≥ ${STAGE_A_EDGE}`, 'missing conditions'];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? path.join(here, 'out', 'stage-b'));
  try {
    const { out, md } = await analyze(dir);
    fs.writeFileSync(path.join(dir, 'stage-b.json'), JSON.stringify(out, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v), 1) + '\n');
    fs.writeFileSync(path.join(dir, 'STAGE-B.md'), md);
    console.log(`written ${path.join(dir, 'STAGE-B.md')} and stage-b.json: ${out.sessions.n} sessions, ${out.item1.pairs.length} correct–correct pairs, ${out.item2.summary.n} wrong answers${out.stub ? ' (STUB DATA)' : ''}`);
  } catch (e) { console.error(`stage-b-analyze: ${e.message}`); process.exitCode = 2; }
}
