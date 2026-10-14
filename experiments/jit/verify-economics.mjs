#!/usr/bin/env node
// M2: priced verification, set by the slider (research/jit-20261008/ATTACK-20261014.md §3 M2; PROOF-LEDGER K2).
// $0: no model call of any kind. Reads only the committed stream exports (results.jsonl, events.jsonl, arm.json, traces/)
// under research/jit-20261008/runs/, and re-scores archived shadow and adjudicator answers with the bed oracle (local
// code; beds/records and beds/kinetics are not sealed beds).
//
// What it prices. For every JIT arm, the steady-state $ per task of each (shadow tier, shadow rate), with and without
// adjudication, against every agent arm of the same stream; the break-even shadow rate against each agent; the
// system-view miss bound (a Wilson upper bound on detectable-wrong among randomly shadowed compiled deliveries, at the
// shadowFloor propensity); and the Dodge CSP-1 AOQL table for long streams, with a perfect and with the measured
// (imperfect) inspector. `decide` applies the section's rule: if no (tier, rate) with rate >= the random floor beats the
// Haiku agent's $ per task, the PREREG H1 cost claim against the Haiku agent is withdrawn for that family.
//
// The cost model (all per post-warmup task; W = rows with idx >= warmup, n = |W|, O = the compiled-ok rows of W, q = |O|/n):
//   base L0 = compiled-run $ / n                          (the ATTACK's "compiled" term)
//   base L1 = L0 + interpreter $ in W / n                 (deopt fallbacks: they recur at the measured deopt rate)
//   base L2 = L1 + (compile $ in W - the first compile) / n   (recompiles)
//   v(tier, adj) = shadow $ + [adj] P(disagree) x adjudication $        (per shadowed compiled-ok delivery)
//   steady(level, tier, r, adj) = base_level + r x q x v(tier, adj)
//   break-even r* = (agent $/task - base_level) / (q x v)
// Shadows are only drawn on compiled-ok deliveries (stream.mjs: a deopt already falls back to the interpreter).
//
// Tiers.
//   interp   the arm's own interpreter (what stream.mjs runs: "Shadow: the arm's interpreter"). Cost: the arm's measured
//            shadow sessions; adjudication: its adjudicator sessions. P(disagree): the as-run shadow outcomes, re-evaluated
//            under the family's current comparator where the compiled answer's oracle details are known.
//   haiku    a Haiku-agent shadow: the Haiku agent arm's own answer on the same seed (a real session on the same task) is
//            compared with the compiled answer through their oracle details (proxyCompare). Cost: that arm's measured $ on
//            those seeds. Adjudication: the arm's interpreter (default), or a second Haiku session (variant 'haiku+hadj').
//            Not realizable without an engine change: stream.mjs shadows only with the arm's interpreter.
//   witness  kinetics only: an exact check of the excluded-sample set. Its detection is computed against the reference
//            set, so it is a CEILING (a $0 code witness with that recall does not exist at run time: the exclusion
//            evidence is natural language, beds/kinetics/README.md); a flag deopts to the interpreter.
//
// Comparator proxy (proxyCompare). A row keeps no compiled answer, only its oracle details. records: two answers are taken
// to agree iff their oracle details are identical with the mismatch list read as a set (different details => different
// answers, certain; identical details => the same answer, assumed; two capped mismatch lists that differ => ambiguous). kinetics (the R0-K comparator: relTol 0.05 on vmax/km, everything else exact): different
// excluded-sample sets (exact from missing/extra) => disagree; otherwise each vmax/km pair is classified from the two
// unsigned relative errors to the generating truth over all sign and rounding corners: agree / disagree / ambiguous. The
// proxy is validated against the real comparator on every pair of archived answers that share a seed (validateProxy).
//
// usage: node experiments/jit/verify-economics.mjs [--runs <dir>] [--out <dir>] [--json]
//   default --runs research/jit-20261008/runs, --out research/jit-20261008/analysis/verify-economics/out
import path from 'node:path';
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonical } from '../../beds/lib/canonical.mjs';
import { tolerantEqual } from './compare.mjs';
import { wilson } from '../lib/stats.mjs';
import { ipwMissEstimate } from './stats.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_RUNS = path.join(REPO, 'research/jit-20261008/runs');
export const DEFAULT_OUT = path.join(REPO, 'research/jit-20261008/analysis/verify-economics/out');
export const STREAMS = Object.freeze([
  { experiment: 'jit-dev-records-1', family: 'records' },
  { experiment: 'jit-dev-kinetics-1', family: 'kinetics' },
  { experiment: 'jit-r0-records', family: 'records' },
]);
export const FLOOR = 0.25;                       // PREREG-stream §2 random shadow floor (epsilon = 0.25)
export const RATES = Object.freeze([0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.75, 1]);
export const KINETICS_TOL = Object.freeze({ relTol: 0.05, absTol: 1e-9, tolerantKeys: ['vmax', 'km'] });   // R0-K (D23, D25 §3)
export const COMPILE_KEYS = Object.freeze(['compileBuilder', 'compileGateway', 'compileCheck']);
export const LEVELS = Object.freeze(['L0', 'L1', 'L2']);
const MODEL_SHORT = { 'claude-haiku-5-5': 'H', 'claude-sonnet-5-5': 'S', 'claude-opus-5-5': 'O' };

// ------------------------------------------------------------------------------------------------ small statistics
// The repo's Wilson (experiments/lib/stats.mjs); real-valued counts are allowed (expected counts in projections).
export const wilsonHi = (w, n, z = 1.96) => (n > 0 ? wilson(w, n, z).hi : 1);
// stream.mjs shadowDrawOf, replicated (stream.mjs is under concurrent edit): u in [0, 1) from sha256(`${seed}:${idx}:shadow`).
export const shadowDrawOf = (seed, idx) => parseInt(createHash('sha256').update(`${seed}:${idx}:shadow`).digest('hex').slice(0, 13), 16) / 2 ** 52;
const sum = xs => xs.reduce((s, x) => s + x, 0);
const mean = xs => (xs.length ? sum(xs) / xs.length : null);

// ------------------------------------------------------------------------------------------------ comparators
// The family's comparator as of R0/R0-K (stream.mjs sameAnswer, replicated): records 'unordered' (every array a multiset,
// canonical JSON); kinetics 'tolerant' at KINETICS_TOL.
export function sameAnswer(family, a, b) {
  if (a == null || b == null) return false;
  if (family === 'kinetics') return tolerantEqual(a, b, KINETICS_TOL);
  const norm = v => (Array.isArray(v) ? v.map(norm).sort((x, y) => (canonical(x) < canonical(y) ? -1 : canonical(x) > canonical(y) ? 1 : 0))
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)])) : v);
  return canonical(norm(a)) === canonical(norm(b));
}

export function detailsOf(row) {
  const d = row?.oracleDetails;
  if (d == null) return null;
  if (typeof d !== 'string') return d;
  try { return JSON.parse(d); } catch { return null; }
}

// One vmax or km pair: a = T(1 ± ea), b = T(1 ± eb), the errors rounded to 4 dp. Agree iff |a − b| <= relTol·max(a, b) at every
// sign and rounding corner; disagree iff it fails at every corner; otherwise ambiguous.
export function numericProxy(ea, eb, relTol = KINETICS_TOL.relTol, half = 5e-5) {
  if (![ea, eb].every(Number.isFinite)) return 'ambiguous';
  let yes = 0, no = 0;
  for (const sa of [-1, 1]) for (const sb of [-1, 1]) for (const da of [-half, half]) for (const db of [-half, half]) {
    const a = 1 + sa * Math.max(0, ea + da), b = 1 + sb * Math.max(0, eb + db);
    if (Math.abs(a - b) <= relTol * Math.max(Math.abs(a), Math.abs(b))) yes++; else no++;
  }
  return no === 0 ? 'agree' : yes === 0 ? 'disagree' : 'ambiguous';
}

const setKey = xs => canonical([...new Set(xs ?? [])].sort());
// records oracle details (beds/records/score.mjs): the mismatch list follows the answer's record order and stops at 12, so
// it is compared as a set; two capped lists that differ may hide equal answers (ambiguous).
export const RECORDS_MISMATCH_CAP = 12;
function recordsProxy(da, db) {
  const norm = d => ({ ...d, mismatches: Array.isArray(d.mismatches) ? d.mismatches.map(m => canonical(m)).sort() : d.mismatches });
  const a = norm(da), b = norm(db);
  if (canonical(a) === canonical(b)) return 'agree';
  const capped = d => Array.isArray(d.mismatches) && d.mismatches.length >= RECORDS_MISMATCH_CAP;
  const rest = d => canonical({ ...d, mismatches: null });
  return capped(a) && capped(b) && rest(a) === rest(b) ? 'ambiguous' : 'disagree';
}
// 'agree' | 'disagree' | 'ambiguous' | 'unknown' for two answers known only through their oracle details.
export function proxyCompare(family, da, db, { relTol = KINETICS_TOL.relTol } = {}) {
  if (!da || !db) return 'unknown';
  if (family !== 'kinetics') return recordsProxy(da, db);
  const ca = da.perCondition, cb = db.perCondition;
  if (!Array.isArray(ca) || !Array.isArray(cb)) return Array.isArray(ca) === Array.isArray(cb) ? 'unknown' : 'disagree';
  if (setKey(da.excluded?.missing) !== setKey(db.excluded?.missing) || setKey(da.excluded?.extra) !== setKey(db.excluded?.extra)) return 'disagree';
  if (setKey(da.unknownConditions) !== setKey(db.unknownConditions) || setKey(da.duplicateConditions) !== setKey(db.duplicateConditions)) return 'disagree';
  const mb = new Map(cb.map(c => [c.id, c]));
  if (ca.length !== cb.length || ca.some(c => !mb.has(c.id))) return 'disagree';
  let ambiguous = false;
  for (const c of ca) for (const k of ['vmaxRelErr', 'kmRelErr']) {
    const v = numericProxy(c[k], mb.get(c.id)[k], relTol);
    if (v === 'disagree') return 'disagree';
    if (v === 'ambiguous') ambiguous = true;
  }
  return ambiguous ? 'ambiguous' : 'agree';
}

// The kinetics witness (ceiling): the excluded-sample set differs from the reference set.
export const witnessFlags = d => (d?.excluded ? d.excluded.exact === false : null);

// ------------------------------------------------------------------------------------------------ loading (I/O)
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
export function loadArm(dir) {
  const meta = JSON.parse(readFileSync(path.join(dir, 'arm.json'), 'utf8'));
  const rows = readJsonl(path.join(dir, 'results.jsonl')).sort((a, b) => a.idx - b.idx);
  return { slug: path.basename(dir), dir, meta, rows, events: readJsonl(path.join(dir, 'events.jsonl')) };
}
export function loadStream(runsDir, { experiment, family }) {
  const runDir = path.join(runsDir, experiment);
  const arms = readdirSync(runDir, { withFileTypes: true }).filter(d => d.isDirectory() && existsSync(path.join(runDir, d.name, 'arm.json')))
    .map(d => loadArm(path.join(runDir, d.name)));
  return { experiment, family, runDir, arms };
}
export const parseSpec = spec => {
  const [kind, rest = ''] = spec.split(':');
  if (kind === 'jit') { const [interp, compiler] = rest.split('/'); return { kind, interp, compiler, short: `${MODEL_SHORT[interp] ?? interp}→${MODEL_SHORT[compiler] ?? compiler}` }; }
  if (kind === 'agent') return { kind, model: rest, short: `${MODEL_SHORT[rest] ?? rest} agent` };
  return { kind, short: kind };
};
const readTrace = (arm, traceId) => {
  const f = path.join(arm.dir, 'traces', `${traceId}.json`);
  return traceId && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};

// Re-score archived shadow and adjudicator answers with the bed oracle ($0, local), keyed `${slug}:${traceId}`.
export async function scoreShadowTraces(stream) {
  const { makeTasks, score } = await import('../lib/beds.mjs');
  const out = new Map();
  for (const arm of stream.arms.filter(a => a.meta.kind === 'jit')) for (const r of arm.rows) for (const id of [r.shadowTraceId, r.adjudicatorTraceId]) {
    const tr = id && readTrace(arm, id);
    if (!tr) continue;
    const [t] = await makeTasks(stream.family, { split: tr.split ?? 'dev', seeds: [r.seed], difficulty: r.difficulty });
    if (t.taskHash !== r.taskHash) throw new Error(`${arm.slug} #${r.idx}: regenerated task hash differs from the row's`);
    const s = await score(stream.family, t.task, tr.answer);
    out.set(`${arm.slug}:${id}`, { pass: !!s.pass, score: s.score, details: s.details, costUsd: tr.costUsd, answer: tr.answer });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ cost model
const bd = (r, k) => r.costBreakdown?.[k] ?? 0;
export const compileUsdOf = r => sum(COMPILE_KEYS.map(k => bd(r, k)));
const imputedAdj = r => !!r.costUnknown && (r.events ?? []).some(e => e.kind === 'interpret' && e.role === 'adjudicator' && e.error);

export function steadyState({ base, q, shadowUsd, adjUsd = 0, pD = 0, rate, adjudicate }) {
  return base + rate * q * (shadowUsd + (adjudicate ? pD * adjUsd : 0));
}
// r* with steady(r*) = target; +Infinity: beats at every rate (verification costs nothing); -Infinity: never.
export function breakEvenRate({ base, q, shadowUsd, adjUsd = 0, pD = 0, adjudicate, target }) {
  const v = q * (shadowUsd + (adjudicate ? pD * adjUsd : 0));
  if (!(v > 0)) return base < target ? Infinity : -Infinity;
  return (target - base) / v;
}

// Verdict tallies for one tier over the compiled-ok deliveries. items: [{ wrong: bool|null, verdict }]. Ambiguous counts as
// agree in pD (the JIT-favourable reading; D23/D25: 0 of 22 correct–correct kinetics pairs disagree at 0.05) and as
// disagree in pDhi.
export function tally(items) {
  const known = items.filter(i => i.verdict !== 'unknown');
  const c = { n: items.length, known: known.length, unknown: items.length - known.length, disagree: 0, ambiguous: 0, wrong: 0, right: 0, wrongUnlabelled: 0,
    detectedWrong: 0, falseAlarm: 0, missedWrong: 0, ambiguousWrong: 0 };
  for (const i of known) {
    if (i.verdict === 'disagree') c.disagree++;
    if (i.verdict === 'ambiguous') c.ambiguous++;
    if (i.wrong == null) { c.wrongUnlabelled++; continue; }
    if (i.wrong) { c.wrong++; if (i.verdict === 'disagree') c.detectedWrong++; else if (i.verdict === 'ambiguous') c.ambiguousWrong++; else c.missedWrong++; }
    else { c.right++; if (i.verdict === 'disagree') c.falseAlarm++; }
  }
  const k = c.known || NaN;
  return { ...c, pD: c.disagree / k, pDhi: (c.disagree + c.ambiguous) / k, pDci: c.known ? wilson(c.disagree, c.known) : null,
    d: c.detectedWrong / k, delta: c.wrong ? c.detectedWrong / c.wrong : null, phi: c.right ? c.falseAlarm / c.right : null, pWrong: (c.wrong + c.right) ? c.wrong / (c.wrong + c.right) : null };
}

// ------------------------------------------------------------------------------------------------ CSP-1 (Dodge)
// Clearance number i, sampling fraction f. pf = the probability that an inspected unit is flagged (true detections plus
// false alarms: p·delta + (1 − p)·phi). u = mean units in the 100% phase, v = mean units in the sampling phase.
export function csp1Afi(pf, i, f) {
  if (!(pf > 0)) return f;
  if (pf >= 1) return 1;
  const qi = (1 - pf) ** i, u = (1 - qi) / (pf * qi), v = 1 / (f * pf);
  return (u + f * v) / (u + v);
}
// Outgoing quality: a wrong unit leaves wrong unless it was inspected and the inspector caught it (then it is replaced).
export function csp1({ p, i, f, delta = 1, phi = 0 }) {
  const pf = p * delta + (1 - p) * phi, afi = csp1Afi(pf, i, f);
  return { pf, afi, aoq: p * (1 - afi * delta) };
}
// The worst case over p in (0, pMax]. With delta = 0 nothing is ever caught and AOQ = p rises to pMax: that is reported as
// unbounded (the AOQL guarantee needs an inspector that detects).
export function aoql({ i, f, delta = 1, phi = 0, pMax = 0.6 }) {
  if (!(delta > 0)) return { aoql: null, pAt: null, unbounded: true };
  let best = { p: 0, aoq: 0 };
  for (let s = 1; s <= Math.round(pMax / 1e-4); s++) { const p = s * 1e-4, a = csp1({ p, i, f, delta, phi }).aoq; if (a > best.aoq) best = { p, aoq: a }; }
  for (let step = 1e-5; step > 1e-9; step /= 10) {
    const lo = Math.max(step, best.p - 10 * step), hi = Math.min(pMax, best.p + 10 * step);
    for (let s = 0; lo + s * step <= hi; s++) { const p = lo + s * step, a = csp1({ p, i, f, delta, phi }).aoq; if (a > best.aoq) best = { p, aoq: a }; }
  }
  return { aoql: best.aoq, pAt: best.p, unbounded: best.p >= pMax - 1e-9 };
}
export const CSP_GRID = Object.freeze({ i: [5, 10, 20, 40, 60, 100], f: [0.05, 0.1, 0.25, 0.5] });
export const aoqlTable = ({ delta = 1, phi = 0 } = {}) => CSP_GRID.i.map(i => ({ i, cells: CSP_GRID.f.map(f => ({ f, ...aoql({ i, f, delta, phi }) })) }));

// ------------------------------------------------------------------------------------------------ system view
// Projected Wilson upper bound on detectable-wrong among randomly shadowed deliveries of an N-task stream at rate r:
// expected n = r·q·N shadows, of which d·n are detected wrong (d measured per compiled-ok delivery).
export function projectedBound({ d, q, rate, N }) {
  const n = rate * q * N;
  return { n, hi: wilsonHi(d * n, n), hiAtZero: wilsonHi(0, n) };
}

// ------------------------------------------------------------------------------------------------ per-arm analysis
// agents: Map(model -> { rows, bySeed, usdPerTask, ... }); scored: scoreShadowTraces output.
export function armEconomics({ stream, arm, agents, scored = new Map(), floor = FLOOR, rates = RATES }) {
  const fam = stream.family, spec = parseSpec(arm.meta.spec), warmup = arm.meta.def?.jit?.warmup ?? 3;
  const rows = arm.rows, W = rows.filter(r => r.idx >= warmup), n = W.length;
  const O = W.filter(r => r.compiledStatus === 'ok'), q = n ? O.length / n : 0;
  const wrongOf = r => (r.delivered === 'compiled' ? !r.pass : r.compiledPass != null ? !r.compiledPass : null);
  const compiledDetails = r => (r.delivered === 'compiled' ? detailsOf(r) : null);
  // Costs.
  const firstCompileRow = W.find(r => compileUsdOf(r) > 0);
  const c = {
    warmupInterp: sum(rows.filter(r => r.idx < warmup).map(r => bd(r, 'interpreter'))),
    compileTotal: sum(rows.map(compileUsdOf)), firstCompile: firstCompileRow ? compileUsdOf(firstCompileRow) : 0,
    compiledW: sum(W.map(r => bd(r, 'compiled'))), fallbackW: sum(W.map(r => bd(r, 'interpreter'))), compileW: sum(W.map(compileUsdOf)),
    shadowW: sum(W.map(r => bd(r, 'shadow'))), adjW: sum(W.map(r => bd(r, 'adjudicator'))), totalAll: sum(rows.map(r => r.costUsd)), totalW: sum(W.map(r => r.costUsd)),
  };
  const base = n ? { L0: c.compiledW / n, L1: (c.compiledW + c.fallbackW) / n, L2: (c.compiledW + c.fallbackW + c.compileW - c.firstCompile) / n } : null;
  // As-run verification.
  const shadowRows = O.filter(r => (r.events ?? []).some(e => e.kind === 'shadow'));
  const shadowCosts = shadowRows.map(r => bd(r, 'shadow')).filter(x => x > 0);
  const adjRows = W.filter(r => bd(r, 'adjudicator') > 0), adjCosts = adjRows.filter(r => !imputedAdj(r)).map(r => bd(r, 'adjudicator'));
  const interpSessions = rows.filter(r => bd(r, 'interpreter') > 0).map(r => bd(r, 'interpreter'));
  const fallbackSessions = W.filter(r => bd(r, 'interpreter') > 0).map(r => bd(r, 'interpreter'));
  const sI = mean(shadowCosts) ?? mean(interpSessions), aI = mean(adjCosts) ?? sI, actI = mean(fallbackSessions) ?? mean(interpSessions);
  const asRun = {
    shadows: shadowRows.length, rate: O.length ? shadowRows.length / O.length : null, adjudications: adjRows.length, imputedAdjudications: adjRows.length - adjCosts.length,
    flagged: O.filter(r => r.shadowReason && r.shadowReason.includes('flag')).length, floorDrawn: O.filter(r => r.shadowReason && r.shadowReason.includes('floor')).length,
    propensityLogged: O.some(r => r.shadowPropensity != null), shadowUsdMean: mean(shadowCosts), adjUsdMean: mean(adjCosts), interpSessionUsdMean: mean(interpSessions),
    outcomes: shadowRows.map(r => ({ idx: r.idx, seed: r.seed, delivered: r.delivered, pass: r.pass, wrong: wrongOf(r), agreeAsRun: (r.events.find(e => e.kind === 'shadow') ?? {}).agree ?? null,
      adjudicate: (r.events.find(e => e.kind === 'adjudicate') ?? {}).outcome ?? null, reason: r.shadowReason ?? null })),
  };
  // Tier verdicts.
  const interpItems = shadowRows.map(r => {
    const ev = r.events.find(e => e.kind === 'shadow'), sh = scored.get(`${arm.slug}:${r.shadowTraceId}`);
    const recorded = ev?.agree === true ? 'agree' : ev?.agree === false ? 'disagree' : 'unknown';
    const dc = compiledDetails(r);
    const reeval = dc && sh ? proxyCompare(fam, dc, sh.details) : null;
    return { idx: r.idx, seed: r.seed, wrong: wrongOf(r), recorded, reeval, verdict: reeval ?? recorded, shadowPass: sh?.pass ?? null };
  });
  const haiku = agents.get('claude-haiku-5-5');
  const agentItems = model => {
    const ag = agents.get(model);
    if (!ag) return null;
    return O.map(r => {
      const a = ag.bySeed.get(r.seed), dc = compiledDetails(r);
      return { idx: r.idx, seed: r.seed, wrong: wrongOf(r), verdict: a ? proxyCompare(fam, dc, detailsOf(a)) : 'unknown', agentPass: a?.pass ?? null, agentUsd: a?.costUsd ?? null };
    });
  };
  const haikuItems = agentItems('claude-haiku-5-5'), interpProxyItems = spec.interp === 'claude-haiku-5-5' ? null : agentItems(spec.interp);
  const haikuShadowUsd = haikuItems ? mean(haikuItems.map(i => i.agentUsd).filter(x => x != null)) : null;
  const tiers = [];
  const addTier = (t, items, extra) => tiers.push({ tier: t, ...extra, counts: items ? tally(items) : null, items: items ?? [] });
  addTier('interp', interpItems, { label: `arm interpreter (${MODEL_SHORT[spec.interp]})`, realizable: true, shadowUsd: sI, adjUsd: aI, source: 'as-run shadows, re-evaluated' });
  if (haikuItems) {
    addTier('haiku', haikuItems, { label: 'Haiku agent, interpreter adjudicates', realizable: false, shadowUsd: haikuShadowUsd, adjUsd: aI, source: 'Haiku agent arm, same seeds' });
    addTier('haiku+hadj', haikuItems, { label: 'Haiku agent, Haiku adjudicates', realizable: false, shadowUsd: haikuShadowUsd, adjUsd: haikuShadowUsd, source: 'Haiku agent arm, same seeds' });
  }
  if (fam === 'kinetics') {
    const witnessItems = O.map(r => { const dc = compiledDetails(r), f = witnessFlags(dc); return { idx: r.idx, seed: r.seed, wrong: wrongOf(r), verdict: f == null ? 'unknown' : f ? 'disagree' : 'agree' }; });
    addTier('witness', witnessItems, { label: 'exclusion-set witness (ceiling; flag deopts to the interpreter)', realizable: false, ceiling: true, shadowUsd: 0, adjUsd: actI, source: 'compiled oracle details' });
  }
  const proxies = interpProxyItems ? { tier: 'interp-agent-proxy', label: `${MODEL_SHORT[spec.interp]} agent arm on the same seeds (sensitivity)`, counts: tally(interpProxyItems), items: interpProxyItems } : null;
  // Planning values per tier. pWrong is the arm's oracle wrong rate over every labelled compiled-ok delivery (not only the
  // shadowed ones); delta and phi come from the tier's own comparisons when they include a wrong (right) delivery, else
  // from the same-model agent-arm proxy (interp tier), else delta = 1 / phi = 0 (assumed, and marked so).
  const labelled = O.map(wrongOf).filter(w => w != null), pWrongArm = labelled.length ? labelled.filter(Boolean).length / labelled.length : null;
  for (const t of tiers) {
    const k = t.counts, pk = t.tier === 'interp' ? proxies?.counts : null;
    const delta = k?.delta ?? pk?.delta ?? null, phi = k?.phi ?? pk?.phi ?? null;
    t.plan = { pWrong: pWrongArm, labelled: labelled.length, delta: delta ?? 1, deltaSource: k?.delta != null ? 'tier' : pk?.delta != null ? 'agent-arm proxy' : 'assumed 1',
      phi: phi ?? 0, phiSource: k?.phi != null ? 'tier' : pk?.phi != null ? 'agent-arm proxy' : 'assumed 0' };
    t.plan.d = (pWrongArm ?? 0) * t.plan.delta;
  }
  // Agents and targets.
  const agentTargets = [...agents.entries()].map(([model, ag]) => ({ model, short: MODEL_SHORT[model], usdPerTask: ag.usdPerTask, usdPerSuccess: ag.usdPerSuccess, passRate: ag.passRate,
    pairedUsdPerTask: mean(W.map(r => ag.bySeed.get(r.seed)?.costUsd).filter(x => x != null)) }));
  // Tables.
  const table = [], breakEven = [];
  const variants = tiers.flatMap(t => (t.tier === 'witness' ? [{ t, adjudicate: true }] : [{ t, adjudicate: false }, { t, adjudicate: true }]));
  for (const { t, adjudicate } of variants) {
    if (t.shadowUsd == null || !t.counts) continue;
    const pD = Number.isFinite(t.counts.pD) ? t.counts.pD : 0, p = { q, shadowUsd: t.shadowUsd, adjUsd: t.adjUsd, pD, adjudicate };
    for (const level of LEVELS) {
      const ratesHere = t.tier === 'witness' ? [1] : rates;
      table.push({ tier: t.tier, adjudicate, level, usd: ratesHere.map(rate => ({ rate, usd: steadyState({ base: base[level], rate, ...p }) })) });
      for (const ag of agentTargets) breakEven.push({ tier: t.tier, adjudicate, level, agent: ag.short, target: ag.usdPerTask, rStar: breakEvenRate({ base: base[level], target: ag.usdPerTask, ...p }) });
    }
  }
  // As-run effective rate at the floor-or-flag policy (R0): what the configured policy actually costs.
  const effRate = asRun.rate;
  const passW = n ? W.filter(r => r.pass).length / n : null, passAll = rows.length ? rows.filter(r => r.pass).length / rows.length : null;
  // The PREREG's 24-task stream: warmup + every compile measured + (24 − warmup) tasks at the L1 steady state of a tier.
  const stream24 = (tier, rate, adjudicate) => {
    const t = tiers.find(x => x.tier === tier);
    if (!t || t.shadowUsd == null || !t.counts) return null;
    const steady = steadyState({ base: base.L1, q, shadowUsd: t.shadowUsd, adjUsd: t.adjUsd, pD: t.counts.pD || 0, rate, adjudicate });
    const total = c.warmupInterp + c.compileTotal + (24 - warmup) * steady;
    return { tier, rate, adjudicate, total, perTask: total / 24, perSuccess: passAll ? total / (24 * passAll) : null };
  };
  // System view.
  const seed = arm.meta.def?.jit?.shadowSeed ?? stream.experiment;
  const systemView = { seed, floor, realized: null, emulated: [], projected: [] };
  if (asRun.propensityLogged) {
    const floorRows = O.filter(r => r.shadowDraw != null && r.shadowDraw < floor);
    const wrongSys = floorRows.filter(r => r.delivered === 'adjudicated').length;
    const detected = floorRows.filter(r => wrongOf(r) === true && (r.events ?? []).some(e => e.kind === 'shadow' && e.agree === false)).length;
    const missed = floorRows.filter(r => wrongOf(r) === true && !(r.events ?? []).some(e => e.kind === 'adjudicate' && e.outcome === 'interpreter')).length;
    const items = O.map(r => ({ verified: r.shadowDraw != null && r.shadowDraw < floor, propensity: floor, wrong: r.delivered === 'adjudicated' }));
    systemView.realized = { kind: 'logged floor draws', deliveries: O.length, n: floorRows.length, idx: floorRows.map(r => r.idx), systemWrong: wrongSys, wilsonHiSystem: wilsonHi(wrongSys, floorRows.length),
      oracleWrong: floorRows.filter(r => wrongOf(r) === true).length, detectedWrong: detected, unresolvedOrMissedWrong: missed, wilsonHiDetected: wilsonHi(detected, floorRows.length), ipw: ipwMissEstimate(items) };
  }
  // Emulated floor: tiers whose verdict is known on every compiled-ok delivery (the Haiku agent arm; the same-model agent
  // arm as the interpreter's proxy). The as-run interp shadows are a periodic, not a random, sample and are not re-drawn.
  const emulate = [...tiers.filter(t => t.tier === 'haiku'), ...(proxies ? [proxies] : [])];
  for (const t of emulate) {
    const draws = t.items.filter(i => i.verdict !== 'unknown').map(i => ({ ...i, u: shadowDrawOf(seed, i.idx) }));
    const sampled = draws.filter(i => i.u < floor), det = sampled.filter(i => i.wrong === true && i.verdict === 'disagree').length;
    systemView.emulated.push({ tier: t.tier, deliveries: draws.length, n: sampled.length, idx: sampled.map(i => i.idx), detectedWrong: det, wilsonHi: wilsonHi(det, sampled.length),
      ipw: ipwMissEstimate(draws.map(i => ({ verified: i.u < floor, propensity: floor, wrong: i.wrong === true && i.verdict === 'disagree' }))) });
  }
  for (const t of tiers.filter(x => x.plan && x.tier !== 'haiku+hadj')) for (const N of [24, 100, 1000, 10000]) for (const rate of [0.1, 0.25, 0.5, 1])
    systemView.projected.push({ tier: t.tier, N, rate, d: t.plan.d, ...projectedBound({ d: t.plan.d, q, rate, N }) });
  // CSP-1 at the arm's measured p and the tier's planning delta, phi (marked when assumed).
  const csp = tiers.filter(t => t.plan?.pWrong != null && t.counts && t.tier !== 'haiku+hadj' && t.tier !== 'witness').flatMap(t => [[20, 0.1], [60, 0.25], [10, 0.25]].map(([i, f]) => {
    const { pWrong: p, delta, phi, deltaSource, phiSource } = t.plan, r = csp1({ p, i, f, delta, phi });
    return { tier: t.tier, i, f, p, delta, deltaSource, phi, phiSource, ...r, aoqlImperfect: aoql({ i, f, delta, phi }).aoql,
      usdPerTaskL1: steadyState({ base: base.L1, q, shadowUsd: t.shadowUsd, adjUsd: t.adjUsd, pD: t.counts.pD || 0, rate: r.afi, adjudicate: true }) };
  }));
  return { experiment: stream.experiment, family: fam, slug: arm.slug, spec: arm.meta.spec, short: spec.short, interp: spec.interp, warmup, rows: rows.length, n, compiledOk: O.length,
    compiledDelivered: O.filter(r => r.delivered === 'compiled').length, q,
    passW, passAll, costs: c, base, asRun, effRate, tiers: tiers.map(({ items, ...t }) => ({ ...t, items })), interpAgentProxy: proxies, agents: agentTargets, table, breakEven,
    stream24: [...['interp', 'haiku', 'haiku+hadj'].flatMap(t => [true, false].map(a => stream24(t, floor, a))), stream24('interp', 1, true)].filter(Boolean), systemView, csp };
}

export function agentTable(stream) {
  const m = new Map();
  for (const arm of stream.arms.filter(a => a.meta.kind === 'agent')) {
    const rows = arm.rows, model = parseSpec(arm.meta.spec).model, passes = rows.filter(r => r.pass).length, usd = sum(rows.map(r => r.costUsd));
    m.set(model, { slug: arm.slug, rows, bySeed: new Map(rows.map(r => [r.seed, r])), tasks: rows.length, passes, usd, usdPerTask: usd / rows.length, passRate: passes / rows.length, usdPerSuccess: passes ? usd / passes : null });
  }
  return m;
}

// ------------------------------------------------------------------------------------------------ proxy validation
// Every pair of archived answers on the same seed of one stream that has both the answer (trace) and its oracle details:
// agent rows and JIT rows delivered by the interpreter, plus re-scored shadow and adjudicator answers. Real comparator vs proxy.
export function validateProxy(stream, scored = new Map()) {
  const items = [];
  for (const arm of stream.arms.filter(a => a.meta.kind !== 'static')) {
    for (const r of arm.rows) if (r.delivered === 'interpreter' && r.traceId) {
      const tr = readTrace(arm, r.traceId);
      if (tr) items.push({ who: `${arm.slug}#${r.idx}`, seed: r.seed, answer: tr.answer, details: detailsOf(r) });
    }
    for (const r of arm.rows) for (const id of [r.shadowTraceId, r.adjudicatorTraceId]) {
      const s = id && scored.get(`${arm.slug}:${id}`);
      if (s) items.push({ who: `${arm.slug}:${id}`, seed: r.seed, answer: s.answer, details: s.details });
    }
  }
  const m = { agree: { agree: 0, disagree: 0 }, disagree: { agree: 0, disagree: 0 }, ambiguous: { agree: 0, disagree: 0 }, unknown: { agree: 0, disagree: 0 } }, wrongProxyAgree = [];
  const bySeed = new Map();
  for (const it of items) { if (!bySeed.has(it.seed)) bySeed.set(it.seed, []); bySeed.get(it.seed).push(it); }
  for (const group of bySeed.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const a = group[i], b = group[j], actual = sameAnswer(stream.family, a.answer, b.answer) ? 'agree' : 'disagree', proxy = proxyCompare(stream.family, a.details, b.details);
    m[proxy][actual]++;
    if (proxy !== 'ambiguous' && proxy !== 'unknown' && proxy !== actual) wrongProxyAgree.push({ a: a.who, b: b.who, seed: a.seed, proxy, actual });
  }
  return { answers: items.length, pairs: sum(Object.values(m).map(x => x.agree + x.disagree)), matrix: m, contradictions: wrongProxyAgree };
}

// Witness recall over every wrong kinetics answer the streams hold (rows of every arm and re-scored shadows).
export function witnessRecall(stream, scored = new Map()) {
  const wrong = [];
  for (const arm of stream.arms) for (const r of arm.rows) { const d = detailsOf(r); if (!r.pass && d?.perCondition) wrong.push({ who: `${arm.slug}#${r.idx}`, role: r.delivered, flag: witnessFlags(d) }); }
  for (const [k, s] of scored) if (!s.pass && s.details?.perCondition) wrong.push({ who: k, role: 'shadow/adjudicator', flag: witnessFlags(s.details) });
  const flagged = wrong.filter(w => w.flag === true).length;
  return { wrong: wrong.length, flagged, recall: wrong.length ? flagged / wrong.length : null, ci: wrong.length ? wilson(flagged, wrong.length) : null, missed: wrong.filter(w => w.flag !== true).map(w => w.who) };
}

// ------------------------------------------------------------------------------------------------ the ATTACK's arithmetic
// ATTACK-20261014 §1.3 P6 [M], reproduced from the stream for reconciliation: compiled $ per compiled delivery, the mean
// as-run shadow, shadow plus adjudication per shadow, the realized steady state, break-even rates and 10% horizons, with
// the rate applied per task (not per compiled-ok delivery) and deopt fallbacks excluded, as the ATTACK did.
export function attackArithmetic(e, agentUsd) {
  const compiledPerOk = e.costs.compiledW / e.compiledDelivered, shadow = e.asRun.shadowUsdMean, shAdj = shadow + e.costs.adjW / e.asRun.shadows;
  const steady = (e.costs.compiledW + e.costs.shadowW + e.costs.adjW) / e.n;
  const horizon = v => e.costs.compileTotal / (agentUsd - (compiledPerOk + 0.1 * v));
  return { compiledPerOk, shadow, shadowPlusAdj: shAdj, steady, beShadow: (agentUsd - compiledPerOk) / shadow, beAdj: (agentUsd - compiledPerOk) / shAdj, horizonShadow: horizon(shadow), horizonAdj: horizon(shAdj) };
}

// ------------------------------------------------------------------------------------------------ slider and decision
// The cheapest (tier, rate >= floor) whose projected detectable-wrong bound at N is <= bound. Engine semantics: adjudicate.
export function slider(e, { bound, N, floor = FLOOR, rates = RATES, level = 'L1', realizableOnly = false }) {
  const opts = [];
  for (const t of e.tiers.filter(x => x.counts && x.plan && x.shadowUsd != null && x.tier !== 'witness' && (!realizableOnly || x.realizable))) for (const rate of rates.filter(r => r >= floor)) {
    const b = projectedBound({ d: t.plan.d, q: e.q, rate, N });
    if (b.hi <= bound) opts.push({ tier: t.tier, rate, bound: b.hi, usd: steadyState({ base: e.base[level], q: e.q, shadowUsd: t.shadowUsd, adjUsd: t.adjUsd, pD: t.counts.pD || 0, rate, adjudicate: true }) });
  }
  opts.sort((a, b) => a.usd - b.usd);
  if (opts.length) return { feasible: true, ...opts[0] };
  const ds = e.tiers.filter(x => x.plan && x.tier !== 'witness').map(x => x.plan.d);
  return { feasible: false, reason: ds.length && Math.min(...ds) >= bound ? `every tier's measured detectable-wrong rate (min ${Math.min(...ds).toFixed(3)}) is >= the bound` : `too few shadows at N = ${N}` };
}

// The section rule, per family and cost level: does any (tier, rate >= floor) beat the Haiku agent's $ per task at the
// steady state? Every rate above the floor costs more than the floor (steady state rises with r), so the floor decides; the
// witness ceiling runs at 100%. H→H is PREREG-stream §2's negative control, so a family's verdict is given with and without it.
export const NEGATIVE_CONTROL = 'H→H';
export function decide(econ, { floor = FLOOR, levels = LEVELS } = {}) {
  const out = [];
  for (const family of [...new Set(econ.map(e => e.family))]) for (const level of levels) {
    const rowsOut = [];
    for (const e of econ.filter(x => x.family === family)) {
      const H = e.agents.find(a => a.short === 'H');
      if (!H) continue;
      const cands = [];
      for (const t of e.tiers.filter(x => x.counts && x.shadowUsd != null)) for (const adjudicate of t.tier === 'witness' ? [true] : [true, false]) {
        const rate = t.tier === 'witness' ? 1 : floor;
        cands.push({ tier: t.tier, realizable: t.realizable, ceiling: !!t.ceiling, adjudicate, rate,
          usd: steadyState({ base: e.base[level], q: e.q, shadowUsd: t.shadowUsd, adjUsd: t.adjUsd, pD: t.counts.pD || 0, rate, adjudicate }) });
      }
      const pick = f => cands.filter(f).sort((a, b) => a.usd - b.usd)[0] ?? null;
      const mark = x => x && { ...x, beats: x.usd < H.usdPerTask };
      const s24 = e.stream24.filter(s => s.rate === floor).sort((a, b) => a.perSuccess - b.perSuccess)[0] ?? null;
      rowsOut.push({ experiment: e.experiment, arm: e.short, negativeControl: e.short === NEGATIVE_CONTROL, haikuUsdPerTask: H.usdPerTask, haikuUsdPerSuccess: H.usdPerSuccess,
        base: e.base[level], engine: mark(pick(x => x.realizable && x.adjudicate)), engineNoAdj: mark(pick(x => x.realizable && !x.adjudicate)),
        anyModel: mark(pick(x => !x.ceiling && x.adjudicate)), anyModelNoAdj: mark(pick(x => !x.ceiling)), ceiling: mark(pick(x => x.ceiling)),
        stream24: s24 && { ...s24, beatsPerTask: s24.perTask < H.usdPerTask, beatsPerSuccess: s24.perSuccess != null && s24.perSuccess < H.usdPerSuccess } });
    }
    const claimed = rowsOut.filter(r => !r.negativeControl), some = (rs, k) => rs.some(r => r[k]?.beats);
    const verdictOf = rs => (some(rs, 'engine') ? 'not withdrawn (the engine as built beats at the floor)'
      : some(rs, 'anyModel') ? 'not withdrawn only with an engine change (Haiku-agent shadows); withdrawn for the engine as built'
        : some(rs, 'engineNoAdj') || some(rs, 'anyModelNoAdj') ? 'withdrawn with adjudication; only shadows that never adjudicate (a floor kept for system-view counts only, an engine change) beat'
          : 'WITHDRAWN: no (tier, rate >= floor) beats the Haiku agent');
    out.push({ family, level, floor, arms: rowsOut, verdictClaimedArms: verdictOf(claimed), verdictAllArms: verdictOf(rowsOut),
      stream24BeatsPerSuccess: rowsOut.some(r => r.stream24?.beatsPerSuccess), ceilingBeats: some(rowsOut, 'ceiling') });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ driver and rendering
export async function analyze({ runsDir = DEFAULT_RUNS, streams = STREAMS, floor = FLOOR } = {}) {
  const econ = [], validation = [], witness = [];
  for (const s of streams) {
    const stream = loadStream(runsDir, s), agents = agentTable(stream), scored = await scoreShadowTraces(stream);
    for (const arm of stream.arms.filter(a => a.meta.kind === 'jit')) econ.push(armEconomics({ stream, arm, agents, scored, floor }));
    validation.push({ experiment: s.experiment, family: s.family, ...validateProxy(stream, scored) });
    if (s.family === 'kinetics') witness.push({ experiment: s.experiment, ...witnessRecall(stream, scored) });
  }
  return { generatedFrom: streams.map(s => s.experiment), floor, econ, validation, witness, aoqlPerfect: aoqlTable(), decision: decide(econ, { floor }) };
}

const $ = x => (x == null || !Number.isFinite(x) ? '–' : `$${x.toFixed(4)}`);
const pct = x => (x == null || !Number.isFinite(x) ? '–' : `${(100 * x).toFixed(1)}%`);
const rs = x => (x === Infinity ? 'any rate' : x === -Infinity || x < 0 ? 'never' : x >= 1 ? '≥ 100%' : pct(x));
const k = c => (c ? `${c.disagree}/${c.known}${c.ambiguous ? ` (+${c.ambiguous} amb.)` : ''}` : '–');

export function renderTables(res) {
  const L = [];
  L.push('# verify-economics: generated tables', '', `*Generated by \`node experiments/jit/verify-economics.mjs\` from ${res.generatedFrom.map(x => `\`${x}\``).join(', ')} (committed exports). $0, no model calls. Floor ${res.floor}.*`, '');
  L.push('## 1. Inputs per JIT arm (post-warmup window W)', '', '| stream | arm | rows | n (W) | compiled ok (q) | pass W | base L0 | base L1 | base L2 | as-run shadows (rate) | interp shadow $ | adjudicator $ | warmup $ | compile $ (all) |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const e of res.econ) L.push(`| ${e.experiment} | ${e.short} | ${e.rows} | ${e.n} | ${e.compiledOk} (${e.q.toFixed(3)}) | ${pct(e.passW)} | ${$(e.base.L0)} | ${$(e.base.L1)} | ${$(e.base.L2)} | ${e.asRun.shadows} (${pct(e.asRun.rate)}${e.asRun.flagged ? `; ${e.asRun.flagged} flagged` : ''}) | ${$(e.asRun.shadowUsdMean)} | ${$(e.asRun.adjUsdMean)}${e.asRun.imputedAdjudications ? ` (${e.asRun.imputedAdjudications} imputed excl.)` : ''} | ${$(e.costs.warmupInterp)} | ${$(e.costs.compileTotal)} |`);
  L.push('', '**Agents** ($ per task over all rows; $ per success):', '', '| stream | agent | tasks | pass | $/task | $/success |', '|---|---|---|---|---|---|');
  const seen = new Set();
  for (const e of res.econ) for (const a of e.agents) { const key = `${e.experiment}:${a.short}`; if (seen.has(key)) continue; seen.add(key); L.push(`| ${e.experiment} | ${a.short} agent | – | ${pct(a.passRate)} | ${$(a.usdPerTask)} | ${$(a.usdPerSuccess)} |`); }
  L.push('', '## 2. Tiers: cost and disagreement per arm', '', 'P(disagree), δ and φ are over the deliveries the tier compared (interp: the as-run shadows only). The planning d = (the arm\'s oracle wrong rate over all labelled compiled-ok deliveries) × δ, with δ from the tier, else the same-model agent-arm proxy, else assumed 1.', '',
    '| stream | arm | tier | realizable | shadow $ | adjudication / action $ | P(disagree) | compiled wrong (compared) | detected wrong (δ) | false alarms (φ) | arm wrong rate | planning d (δ source) |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const e of res.econ) {
    for (const t of e.tiers) L.push(`| ${e.experiment} | ${e.short} | ${t.tier} | ${t.realizable ? 'yes' : t.ceiling ? 'ceiling' : 'engine change'} | ${$(t.shadowUsd)} | ${$(t.adjUsd)} | ${k(t.counts)} = ${pct(t.counts?.pD)} | ${t.counts ? `${t.counts.wrong}/${t.counts.wrong + t.counts.right}${t.counts.wrongUnlabelled ? ` (+${t.counts.wrongUnlabelled} unlabelled)` : ''}` : '–'} | ${t.counts ? `${t.counts.detectedWrong} (${pct(t.counts.delta)})` : '–'} | ${t.counts ? `${t.counts.falseAlarm} (${pct(t.counts.phi)})` : '–'} | ${t.plan ? `${pct(t.plan.pWrong)} of ${t.plan.labelled}` : '–'} | ${t.plan ? `${pct(t.plan.d)} (${t.plan.deltaSource})` : '–'} |`);
    if (e.interpAgentProxy) { const c = e.interpAgentProxy.counts; L.push(`| ${e.experiment} | ${e.short} | interp, agent-arm proxy (sensitivity) | – | – | – | ${k(c)} = ${pct(c.pD)} | ${c.wrong}/${c.wrong + c.right} | ${c.detectedWrong} (${pct(c.delta)}) | ${c.falseAlarm} (${pct(c.phi)}) | – | – |`); }
  }
  L.push('', '## 3. Steady-state $ per task by (tier, rate), level L1 (compiled + deopt fallbacks + verification)', '');
  for (const e of res.econ) {
    const H = e.agents.find(a => a.short === 'H');
    L.push(`**${e.experiment} ${e.short}** (Haiku agent ${$(H?.usdPerTask)}/task; L0 and L2 in the JSON)`, '', `| tier | adjudication | ${RATES.map(r => pct(r)).join(' | ')} |`, `|---|---|${RATES.map(() => '---').join('|')}|`);
    for (const row of e.table.filter(x => x.level === 'L1')) {
      const cells = RATES.map(r => { const c = row.usd.find(u => u.rate === r); return c ? `${$(c.usd)}${H && c.usd < H.usdPerTask ? ' ✓' : ''}` : ''; });
      L.push(`| ${row.tier} | ${row.adjudicate ? 'yes' : 'no'} | ${cells.join(' | ')} |`);
    }
    L.push('');
  }
  L.push('✓ = below the Haiku agent\'s $ per task. Witness rows are at 100% (a $0 check runs on every delivery).', '');
  L.push('## 4. Break-even shadow rate against each agent', '', '| stream | arm | tier | adj. | level | vs H agent | vs S agent | vs O agent |', '|---|---|---|---|---|---|---|---|');
  for (const e of res.econ) for (const t of e.tiers) for (const adjudicate of t.tier === 'witness' ? [true] : [false, true]) for (const level of ['L0', 'L1']) {
    const be = s => e.breakEven.find(b => b.tier === t.tier && b.adjudicate === adjudicate && b.level === level && b.agent === s);
    L.push(`| ${e.experiment} | ${e.short} | ${t.tier} | ${adjudicate ? 'yes' : 'no'} | ${level} | ${be('H') ? rs(be('H').rStar) : '–'} | ${be('S') ? rs(be('S').rStar) : '–'} | ${be('O') ? rs(be('O').rStar) : '–'} |`);
  }
  L.push('', '"never": the base cost alone (no verification) is at or above the agent; "any rate": verification is free and the base is below.', '');
  L.push('## 5. The PREREG 24-task stream (warmup + every measured compile + 21 tasks at the L1 steady state)', '', '| stream | arm | tier | rate | adj. | total $ | $/task | $/success (as-run pass rate) | Haiku agent $/task, $/success |', '|---|---|---|---|---|---|---|---|---|');
  for (const e of res.econ) { const H = e.agents.find(a => a.short === 'H'); for (const s of e.stream24) L.push(`| ${e.experiment} | ${e.short} | ${s.tier} | ${pct(s.rate)} | ${s.adjudicate ? 'yes' : 'no'} | ${$(s.total)} | ${$(s.perTask)} | ${$(s.perSuccess)} | ${$(H?.usdPerTask)}, ${$(H?.usdPerSuccess)} |`); }
  L.push('', '## 6. System view', '', '**Realized random floor** (logged `shadowDraw` < floor; only `jit-r0-records` logs propensities):', '', '| stream | arm | compiled ok | floor-sampled (idx) | system "wrong" (adjudicated) | Wilson hi | oracle wrong among them | detected (shadow disagreed) | Wilson hi | IPW (finite CI) |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const e of res.econ.filter(x => x.systemView.realized)) { const r = e.systemView.realized; L.push(`| ${e.experiment} | ${e.short} | ${r.deliveries} | ${r.n} (${r.idx.join(', ')}) | ${r.systemWrong} | ${pct(r.wilsonHiSystem)} | ${r.oracleWrong} | ${r.detectedWrong} | ${pct(r.wilsonHiDetected)} | ${pct(r.ipw.rate)} [${pct(r.ipw.lo)}, ${pct(r.ipw.hi)}] |`); }
  L.push('', '**Emulated floor** (draw = shadowDrawOf(shadowSeed or experiment, idx) < floor over compiled-ok deliveries whose tier verdict is known; detected = compiled wrong and the tier disagrees):', '', '| stream | arm | tier | deliveries | sampled (idx) | detected wrong | Wilson hi | IPW point [finite CI] |', '|---|---|---|---|---|---|---|---|');
  for (const e of res.econ) for (const s of e.systemView.emulated) L.push(`| ${e.experiment} | ${e.short} | ${s.tier} | ${s.deliveries} | ${s.n} (${s.idx.join(', ')}) | ${s.detectedWrong} | ${pct(s.wilsonHi)} | ${pct(s.ipw.rate)} [${pct(s.ipw.lo)}, ${pct(s.ipw.hi)}] |`);
  L.push('', '**Projected bound** (expected shadows n = rate·q·N; Wilson upper at the planning d; and at 0 detected):', '', '| stream | arm | tier | planning d | N=24 @25% | N=100 @25% | N=1000 @25% | N=10000 @25% | N=1000 @100% | 0-detected bound N=24 @25% |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const e of res.econ) for (const t of [...new Set(e.systemView.projected.map(p => p.tier))]) {
    const g = (N, rate) => e.systemView.projected.find(p => p.tier === t && p.N === N && p.rate === rate);
    L.push(`| ${e.experiment} | ${e.short} | ${t} | ${pct(g(24, 0.25).d)} | ${pct(g(24, 0.25).hi)} (n ${g(24, 0.25).n.toFixed(1)}) | ${pct(g(100, 0.25).hi)} | ${pct(g(1000, 0.25).hi)} | ${pct(g(10000, 0.25).hi)} | ${pct(g(1000, 1).hi)} | ${pct(g(24, 0.25).hiAtZero)} |`);
  }
  L.push('', '**Slider** (cheapest tier and rate ≥ floor whose projected detectable-wrong bound ≤ B; L1, with adjudication):', '', '| stream | arm | B | N=24 | N=1000 | N=10000 |', '|---|---|---|---|---|---|');
  for (const e of res.econ) for (const B of [0.05, 0.1, 0.2, 0.4]) {
    const c = N => { const s = slider(e, { bound: B, N, floor: res.floor }); return s.feasible ? `${s.tier} @ ${pct(s.rate)}: ${$(s.usd)} (bound ${pct(s.bound)})` : `infeasible: ${s.reason}`; };
    L.push(`| ${e.experiment} | ${e.short} | ${pct(B)} | ${c(24)} | ${c(1000)} | ${c(10000)} |`);
  }
  L.push('', '## 7. CSP-1 (Dodge) for long streams', '', '**AOQL, perfect inspector** (worst-case long-run share of wrong deliveries; p at the worst case):', '', `| i \\ f | ${CSP_GRID.f.join(' | ')} |`, `|---|${CSP_GRID.f.map(() => '---').join('|')}|`);
  for (const row of res.aoqlPerfect) L.push(`| ${row.i} | ${row.cells.map(c => `${pct(c.aoql)} (p ${pct(c.pAt)})`).join(' | ')} |`);
  L.push('', '**At the measured inspector** (p = the arm\'s compiled wrong rate, δ = P(disagree | wrong), φ = P(disagree | right), with their sources; a false alarm also sends CSP-1 back to 100%; AFI = average fraction inspected):', '', '| stream | arm | tier | (i, f) | p | δ | φ | AFI | AOQ | AOQL (this inspector) | $/task L1 at AFI |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const e of res.econ) for (const c of e.csp) L.push(`| ${e.experiment} | ${e.short} | ${c.tier} | (${c.i}, ${c.f}) | ${pct(c.p)} | ${pct(c.delta)}${c.deltaSource === 'tier' ? '' : ` (${c.deltaSource})`} | ${pct(c.phi)}${c.phiSource === 'tier' ? '' : ` (${c.phiSource})`} | ${pct(c.afi)} | ${pct(c.aoq)} | ${c.aoqlImperfect == null ? 'unbounded (δ = 0)' : pct(c.aoqlImperfect)} | ${$(c.usdPerTaskL1)} |`);
  L.push('', '## 8. Comparator proxy validation (real comparator vs proxy on archived answer pairs sharing a seed)', '', '| stream | answers | pairs | proxy agree: real agree / disagree | proxy disagree: real agree / disagree | proxy ambiguous: real agree / disagree | proxy unknown | contradictions |', '|---|---|---|---|---|---|---|---|');
  for (const v of res.validation) { const m = v.matrix; L.push(`| ${v.experiment} | ${v.answers} | ${v.pairs} | ${m.agree.agree} / ${m.agree.disagree} | ${m.disagree.agree} / ${m.disagree.disagree} | ${m.ambiguous.agree} / ${m.ambiguous.disagree} | ${m.unknown.agree + m.unknown.disagree} | ${v.contradictions.length} |`); }
  for (const w of res.witness) L.push('', `**Kinetics exclusion-set witness recall** (${w.experiment}, every wrong answer the stream holds): ${w.flagged}/${w.wrong} = ${pct(w.recall)} (Wilson ${pct(w.ci?.lo)}–${pct(w.ci?.hi)}); missed: ${w.missed.join(', ') || 'none'}.`);
  L.push('', '## 9. Decision (ATTACK §3 M2 rule: rate = floor; the witness ceiling at 100%)', '', '| level | family | stream | arm | Haiku agent $/task | base (no verification) | engine: interp + adj. | interp, no adj. | best model tier + adj. | best model tier, no adj. | witness ceiling | 24-task stream best $/success vs Haiku |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  const f = x => (x ? `${x.tier}: ${$(x.usd)} ${x.beats ? '**beats**' : 'no'}` : '–');
  for (const d of res.decision) for (const a of d.arms)
    L.push(`| ${d.level} | ${d.family} | ${a.experiment} | ${a.arm}${a.negativeControl ? ' (neg. control)' : ''} | ${$(a.haikuUsdPerTask)} | ${$(a.base)} | ${f(a.engine)} | ${f(a.engineNoAdj)} | ${f(a.anyModel)} | ${f(a.anyModelNoAdj)} | ${f(a.ceiling)} | ${a.stream24 ? `${$(a.stream24.perSuccess)} vs ${$(a.haikuUsdPerSuccess)} (${a.stream24.beatsPerSuccess ? 'beats' : 'no'})` : '–'} |`);
  L.push('');
  for (const d of res.decision) L.push(`- **${d.family}, ${d.level}**: claimed arms (S→H, O→H): ${d.verdictClaimedArms}. With the negative control H→H: ${d.verdictAllArms}. Witness ceiling beats: ${d.ceilingBeats ? 'yes' : 'no'}. A 24-task stream beats the Haiku agent per success: ${d.stream24BeatsPerSuccess ? 'yes' : 'no'}.`);
  return L.join('\n') + '\n';
}

const replacer = (key, v) => (v instanceof Map ? Object.fromEntries(v) : v === Infinity ? 'Infinity' : v === -Infinity ? '-Infinity' : v);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
  const res = await analyze({ runsDir: path.resolve(arg('runs', DEFAULT_RUNS)) });
  const out = path.resolve(arg('out', DEFAULT_OUT));
  mkdirSync(out, { recursive: true });
  const slim = { ...res, econ: res.econ.map(e => ({ ...e, tiers: e.tiers.map(({ items, ...t }) => ({ ...t, items: items.map(({ answer, ...i }) => i) })) })) };
  writeFileSync(path.join(out, 'verify-economics.json'), JSON.stringify(slim, replacer, 1) + '\n');
  writeFileSync(path.join(out, 'tables.generated.md'), renderTables(res));
  if (process.argv.includes('--json')) console.log(JSON.stringify(res.decision, replacer, 1));
  else console.log(`wrote ${path.relative(REPO, out)}/verify-economics.json and tables.generated.md\n` + res.decision.map(d => `${d.family} ${d.level}: claimed arms: ${d.verdictClaimedArms} | all arms: ${d.verdictAllArms}`).join('\n'));
}
