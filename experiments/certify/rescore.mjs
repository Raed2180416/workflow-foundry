// Move 0 re-scores at $0 (research/blockers-20261021/ATTACK.md §6 Move 0; decision D28 (4)-(6); write-up in
// research/blockers-20261021/MOVE0-CERTIFY.md). Every number is re-derived from stored records, read-only, through
// experiments/lib/certify.mjs:
//   e8     the stored E8 requirement-extraction ledgers scored at unit (sentence) level against the gold anchors, beside
//          the $0 null baselines (every cue sentence, the structural zone prior, the coverage-list baseline, a random
//          selection of the same size), with exact intervals and the certificate an elusion audit could issue
//   heal   the 2026-10-08 incidents (H-p1, H-cfx, H-rec) and FH-1 through certifyHeal's three modes
//   need   the M1 need negatives: ICC, design effect, n_eff, and the never-trigger bound they can support
//   dev60  the AutomationBench dev60 arms: strict, reachable-subset and conservative columns, n_eff (also across arms),
//          and every node's effort / temperature / cap from the launch records (effort unset: non-conforming)
//
//   node experiments/certify/rescore.mjs <e8|heal|need|dev60|all> [--out DIR] [--fh1-ref REF | --fh1-dir DIR]
//        [--autobench-root DIR] [--strata FILE]
//
// Development/diagnostic evidence only. It reads no look-2/look-3, devCheck or test task and no sealed bed: dev60 runs are
// read through an explicit run-id allowlist, and every row read must be a task of the dev60 selection. Only generic
// mechanisms live here; the ceiling strata (task names) come from a research file and are used for scoring only.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clopperPearson, npMinN, npUmbrellaRank, elusionAuditPlan, selectionNullP, mcnemarExactCounts,
  certifyHeal, verifierValidity, sprtOperatingPoint, effectiveN, kishEffectiveN, iccAnova, exactBinomialBounds,
  manifestFromLaunch, checkManifest, headlineRow, headlineTable,
} from '../lib/certify.mjs';
import { indexText, isNormative } from '../tracker/ledger.mjs';
import { frozenSpecE, scoreExtraction, GOLD_FILE } from '../tracker/eval-e8.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rel = p => path.relative(ROOT, p);
const sha256 = s => createHash('sha256').update(s).digest('hex');
const inputs = {};
function readText(p) { const t = readFileSync(p, 'utf8'); inputs[rel(p).startsWith('..') ? p : rel(p)] = sha256(t); return t; }
const readJson = p => JSON.parse(readText(p));
const readJsonl = p => readText(p).split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
const round = (x, d = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);
const cp = (x, n, o) => { const c = clopperPearson(x, n, o); return { x, n, p: round(c.p), lo: round(c.lo), hi: round(c.hi) }; };

// ================================================================================================ e8 (unit level)
const E8 = 'research/need-router-20261014/tracker-e8';
export const E8_LEDGERS = Object.freeze([
  ...['haiku.s0', 'haiku.s1', 'haiku.s2', 'sonnet.s0', 'sonnet.s1', 'sonnet.s2'].map(s => ({ id: s, file: `${E8}/extraction/${s}.json`, kind: 'model' })),
  ...['s0.g0', 's0.g1', 's0.g2', 's1.g0', 's2.g0'].map(s => ({ id: `glean.${s}`, file: `${E8}/glean/${s}.json`, kind: 'model+glean' })),
  ...['s0', 's1', 's2'].map(s => ({ id: `coverage-list.${s}`, file: `${E8}/glean/${s}.baseline.json`, kind: 'null (coverage-list baseline, $0)' })),
]);

/**
 * Units are the tracker's own sentences (ledger.mjs sentencesOf: paragraphs, list items and table rows, split at
 * sentence ends), so the coverage guard, the coverage-list baseline and this scorer share one segmentation.
 */
export function e8Units(text) {
  const ix = indexText(text);
  const lines = text.split('\n');
  const at = re => { const i = lines.findIndex(l => re.test(l)); return i < 0 ? Infinity : i + 1; };
  const rules = at(/^## 4\./), readings = at(/^## 5\./), reference = at(/^## 6\./);
  const units = ix.sentences().map((s, i) => ({ i, ...s,
    zone: s.line >= reference ? 'reference' : s.line >= readings ? 'readings' : s.line >= rules ? 'rules' : 'platform', cue: isNormative(s.text) }));
  return { ix, units };
}
const unitOf = (units, a) => units.find(u => a.start >= u.start && a.start < u.end) ?? units.find(u => u.start < a.end && a.start < u.end) ?? null;

/** Gold units: the unit holding each gold clause anchor and each U-statement anchor. */
export function e8GoldUnits(ix, units, gold) {
  const byUnit = new Map(), unlocated = [];
  const add = (id, anchor) => {
    const a = ix.locate(anchor); const u = a && unitOf(units, a);
    if (!u) { unlocated.push(id); return; }
    if (!byUnit.has(u.i)) byUnit.set(u.i, []);
    byUnit.get(u.i).push(id);
  };
  for (const c of gold.clauses) add(c.id, c.anchor);
  for (const [k, u] of Object.entries(gold.u)) add(k, u.anchor);
  return { byUnit, unlocated };
}

/** The units a ledger selects: every unit a located requirement quote overlaps. */
export function e8Selected(ledger, ix, units) {
  const sel = new Set();
  for (const r of ledger.requirements ?? []) {
    const a = ix.locate(r.quote);
    if (!a) continue;
    for (const u of units) if (u.start < a.end && a.start < u.end) sel.add(u.i);
  }
  return sel;
}

/**
 * U statements scored two ways: by span (eval-e8.mjs: a quote whose lines lie inside the statement's span counts) and by
 * unit (a quote must overlap the unit that holds the statement's anchor). A statement counted by span and not by unit was
 * covered by a sibling sentence.
 */
export function e8SiblingCheck(ledger, ix, units, gold) {
  const ranges = (ledger.requirements ?? []).map(r => ({ at: ix.locate(r.quote), span: r.span })).filter(r => r.at);
  const out = { bySpan: [], byUnit: [], siblingOnly: [] };
  for (const [k, u] of Object.entries(gold.u)) {
    const span = ranges.some(r => r.span.line >= u.span[0] && r.span.lineEnd <= u.span[1]);
    const a = ix.locate(u.anchor), unit = a && unitOf(units, a);
    const hit = !!unit && ranges.some(r => r.at.start < unit.end && unit.start < r.at.end);
    if (span) out.bySpan.push(k);
    if (hit) out.byUnit.push(k);
    if (span && !hit) out.siblingOnly.push(k);
  }
  return out;
}

/** One design's unit-level score with its exact interval, the random-selection null and an elusion-audit plan. */
export function e8UnitScore(sel, goldSet, N, { auditSample = 30, target = 0.9 } = {}) {
  const k = sel.size, G = goldSet.size;
  const hits = [...goldSet].filter(i => sel.has(i)).length;
  const excluded = N - k, missed = G - hits;
  const plan = excluded > 0 ? elusionAuditPlan({ found: hits, excluded, missed, sampled: Math.min(auditSample, excluded), target }) : null;
  return {
    selected: k, hits, gold: G, units: N, recall: cp(hits, G), precision: k ? round(hits / k) : null,
    randomSelectionP: round(selectionNullP({ N, G, k, hits }), 6),
    elusionAudit: plan && { sampled: Math.min(auditSample, excluded), excluded, missed, pZeroHits: round(plan.pZeroHits),
      expectedRecallLower: round(plan.expectedRecallLower), pCertifiesTarget: round(plan.pCertifiesTarget), target },
  };
}

export function rescoreE8() {
  const text = frozenSpecE();
  const gold = readJson(path.join(ROOT, GOLD_FILE));
  const { ix, units } = e8Units(text);
  const { byUnit, unlocated } = e8GoldUnits(ix, units, gold);
  const goldSet = new Set(byUnit.keys()), N = units.length;
  const designs = {};
  const nullSets = {
    'all units': new Set(units.map(u => u.i)),
    'cue regex (coverage guard CUES)': new Set(units.filter(u => u.cue).map(u => u.i)),
    'zone prior (§4 rules, §5 readings)': new Set(units.filter(u => u.zone === 'rules' || u.zone === 'readings').map(u => u.i)),
    'zone prior ∪ cue regex': new Set(units.filter(u => u.cue || u.zone === 'rules' || u.zone === 'readings').map(u => u.i)),
  };
  for (const [name, s] of Object.entries(nullSets)) designs[name] = { kind: 'null ($0, no model)', ...e8UnitScore(s, goldSet, N) };
  const sels = {};
  const cue = nullSets['cue regex (coverage guard CUES)'];
  for (const L of E8_LEDGERS) {
    const ledger = readJson(path.join(ROOT, L.file));
    const sel = e8Selected(ledger, ix, units); sels[L.id] = sel;
    const span = scoreExtraction(ledger, gold, text);
    const sib = e8SiblingCheck(ledger, ix, units, gold);
    const s = e8UnitScore(sel, goldSet, N);
    // paired against the $0 cue regex on the gold units (b: only the ledger, c: only the regex)
    const b = [...goldSet].filter(i => sel.has(i) && !cue.has(i)).length, c = [...goldSet].filter(i => !sel.has(i) && cue.has(i)).length;
    designs[L.id] = { kind: L.kind, ...s, vsCueRegex: { ledgerOnly: b, regexOnly: c, mcnemarP: round(mcnemarExactCounts(b, c).p, 6) },
      spanMetrics: { idsCovered: span.idsCovered, ids: Object.keys(gold.ids).length, uBySpan: sib.bySpan.length, uByUnit: sib.byUnit.length, uSiblingOnly: sib.siblingOnly,
        clauseCoverage: round(span.clauseCoverage), costUsd: span.costUsd } };
  }
  const union = ids => new Set(ids.flatMap(id => [...sels[id]]));
  designs['union haiku.s0-s2 (K = 3 same view)'] = { kind: 'model union', ...e8UnitScore(union(['haiku.s0', 'haiku.s1', 'haiku.s2']), goldSet, N) };
  designs['union of all six samples'] = { kind: 'model union', ...e8UnitScore(union(['haiku.s0', 'haiku.s1', 'haiku.s2', 'sonnet.s0', 'sonnet.s1', 'sonnet.s2']), goldSet, N) };
  // gold units no design and no sample reaches, and the gold units the $0 zone ∪ cue prior misses
  const allSel = union(Object.keys(sels));
  const missedByAll = [...goldSet].filter(i => !allSel.has(i)).map(i => byUnit.get(i));
  const priorMiss = [...goldSet].filter(i => !nullSets['zone prior ∪ cue regex'].has(i)).map(i => ({ ids: byUnit.get(i), zone: units[i].zone }));
  return {
    part: 'e8', evidence: 'development/diagnostic: one spec (frozen SPEC-E 48535bb), stored 2026-10-14 and 2026-10-21 ledgers, k = 1 reads; SPEC-E is in-sample for the gleaning prompt',
    text: { sha256: ix.sha256, units: N, byZone: Object.fromEntries(['platform', 'rules', 'readings', 'reference'].map(z => [z, units.filter(u => u.zone === z).length])) },
    gold: { units: goldSet.size, clauses: gold.clauses.length, u: Object.keys(gold.u).length, unlocated, sharedUnits: [...byUnit.values()].filter(v => v.length > 1).length },
    designs, missedByEverything: missedByAll, zonePriorCueMisses: priorMiss,
  };
}

// ================================================================================================ heal
const HEAL = 'experiments/heal/runs';
/** The 2026-10-08 incidents, from the stored records (no kit is loaded, nothing is replayed). */
export function rescoreHeal10_08() {
  const out = {};
  // H-p1: a rare stochastic error; the natural-rate retry control and the mechanism injection
  const retry = readJson(path.join(ROOT, HEAL, 'live-20261008-r4/p1-retry.json'));
  const mech = readJson(path.join(ROOT, HEAL, 'review-20261008/p1-mechanism.json'));
  const fail = a => ({ runs: a.n, failures: a.n - a.pass });
  const stoch = certifyHeal({ mode: 'stochastic', base: fail(retry.base), cand: fail(retry.healed) });
  const byTrial = new Map();
  for (const r of mech.B.rows) byTrial.set(r.trial, (byTrial.get(r.trial) ?? 0) + 1);
  const mechanism = certifyHeal({ mode: 'mechanism', faults: mech.B.faults, parentWrong: mech.B.faults - mech.B.parentPass, candRight: mech.B.healedPass,
    clusters: [...byTrial.values()].map(n => ({ n })) });
  // what sampling would cost: SPRT for "failure rate 1/36 (unhealed) vs 0.5% (healed)", alpha = beta = 0.05
  const sprt = p => sprtOperatingPoint({ p0: 0.005, p1: 1 / 36, alpha: 0.05, beta: 0.05, p, maxN: 5000 });
  const atH1 = sprt(1 / 36), atH0 = sprt(0.005);
  out['H-p1'] = {
    recorded: { retryControl: `base ${retry.base.pass}/${retry.base.n} pass, healed ${retry.healed.pass}/${retry.healed.n} pass`, mechanism: `parent wrong ${mech.B.faults - mech.B.parentPass}/${mech.B.faults}, healed right ${mech.B.healedPass}/${mech.B.faults} over ${byTrial.size} trials`, promoted: 'v3 (the 10-08 decision)' },
    stochastic: stoch, mechanism,
    samplingPlan: { test: 'exact truncated SPRT, H0 healed 0.5% vs H1 unhealed 1/36, alpha = beta = 0.05', expectedRunsIfUnhealed: round(atH1.expectedN, 1), expectedRunsIfHealed: round(atH0.expectedN, 1), errorAtH1: round(atH1.decideH0), errorAtH0: round(atH0.decideH1) },
    verdict: 'heal claim: inconclusive (non-evidential control); mechanism certified on the injected class only',
  };
  // H-cfx: a deterministic defect in a check; three proposers' candidates
  const audit = readJson(path.join(ROOT, HEAL, 'review-20261008/audit.json'));
  const relax = readJson(path.join(ROOT, HEAL, 'review-20261008/audit-relax.json'));
  const fid = audit.cfx.baseFidelity;
  // the recorded trials replayed from their journals (0 live calls): same pass and the same score to 1e-6
  const determinism = { replays: fid.length, identical: fid.filter(r => r.recordedPass === r.replayPass && Math.abs(r.recordedScore - r.replayScore) < 1e-6).length };
  const state = { 'live-20261008-r2': 'live2-cfx', 'live-20261008-r3': 'live3-cfx', 'live-20261008-r4': 'live4-cfx' };
  const cands = [];
  for (const c of audit.cfx.candidates) {
    const mut = relax.relax.find(r => r.run === c.run && r.proposal === c.proposal);
    const st = readJson(path.join(ROOT, HEAL, 'live-20261008/archive/state', state[c.run], `${c.proposal}.json`));
    const v7 = (st.verification?.stages ?? []).find(s => s.id === 'V7');
    const fresh = v7?.stratified
      ? v7.strata.map(s => ({ stratum: s.stratum, failing: /has-/.test(s.stratum), base: { n: s.tasks, pass: s.base }, cand: { n: s.tasks, pass: s.cand } }))
      : [{ stratum: 'unstratified', failing: false, base: { n: v7?.seeds ?? 0, pass: v7?.base ?? 0 }, cand: { n: v7?.seeds ?? 0, pass: v7?.cand ?? 0 } }];
    const e = { mode: 'deterministic', determinism, failing: { n: c.v3.length, fixed: c.v3.filter(r => !r.base && r.cand).length },
      regressions: { n: c.v4.n, broken: c.v4.regressions.length }, mutants: { n: mut.mutants, violations: mut.violations.length }, fresh };
    // the same evidence read as if the defect were stochastic: the base reproduced on only the replayed failing cases
    const asStochastic = certifyHeal({ mode: 'stochastic', base: { runs: c.v3.length, failures: c.v3.filter(r => !r.base).length }, cand: { runs: c.v3.length, failures: c.v3.filter(r => !r.cand).length } });
    cands.push({ run: c.run, proposal: c.proposal, proposer: mut.proposer, evidence: e, deterministic: certifyHeal(e), asStochastic: { verdict: asStochastic.verdict, label: asStochastic.label } });
  }
  out['H-cfx'] = { candidates: cands, verdict: 'accepted only in deterministic mode, for the one candidate with a stratified fresh discrimination; the others are rejected (mutant) or inconclusive (no fresh discrimination)' };
  // H-rec: a deterministic bias the workflow's own verdict cannot see; 16 proposer rounds
  const esc = readJson(path.join(ROOT, HEAL, 'live-20261008-r4/rec-escalate.json'));
  const rounds = [];
  for (const d of ['live-20261008', 'live-20261008-r2', 'live-20261008-r3', 'live-20261008-r4']) rounds.push(...readJson(path.join(ROOT, HEAL, d, 'rec.json')).proposerRounds);
  const tally = rounds.reduce((m, r) => { const k = r.pending ? 'pending' : r.reject ?? 'none'; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const baseScores = esc.runs.filter(r => r.arm === 'base').map(r => r.score);
  const recDet = { replays: baseScores.length, identical: baseScores.filter(s => s === baseScores[0]).length };
  const reachedV3 = tally.HEAL_FAILING_CASE_STILL_FAILS ?? 0;
  out['H-rec'] = {
    recorded: { retry: `base oracle ${esc.base.pass}/${esc.base.n}, own verdict pass ${esc.base.verdictPass}/${esc.base.n}`, escalate: `${esc.arm2}: oracle ${esc.healed.pass}/${esc.healed.n}, verdict pass ${esc.healed.verdictPass}/${esc.healed.n}`, proposerRounds: tally },
    verifier: verifierValidity({ verdictPass: esc.base.verdictPass + esc.healed.verdictPass, oraclePass: esc.base.pass + esc.healed.pass, n: esc.base.n + esc.healed.n }),
    determinism: recDet,
    candidatesThatReachedReplay: { n: reachedV3, each: certifyHeal({ mode: 'deterministic', determinism: recDet, failing: { n: 1, fixed: 0 }, regressions: { n: 9, broken: 0 } }) },
    escalationAsCandidate: certifyHeal({ mode: 'stochastic', base: { runs: esc.base.n, failures: esc.base.n - esc.base.pass }, cand: { runs: esc.healed.n, failures: esc.healed.n - esc.healed.pass } }),
    verdict: 'reject: no candidate fixed the failing case; the workflow verdict is an invalid evaluator for this incident',
  };
  return out;
}

const FH1 = 'research/heal-20261021/fh1';
function fh1Source({ dir, ref }) {
  if (dir) {
    return { where: `dir ${dir}`, list: () => readdirSync(path.join(dir, 'runs')), read: p => { const f = path.join(dir, p); return existsSync(f) ? readJson(f) : null; } };
  }
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const commit = git('rev-parse', ref).trim();
  return { where: `git ${ref} @ ${commit}`, commit,
    list: () => git('ls-tree', '--name-only', `${commit}:${FH1}/runs`).trim().split('\n'),
    read: p => { try { const t = git('show', `${commit}:${FH1}/${p}`); inputs[`${ref}:${FH1}/${p}`] = sha256(t); return JSON.parse(t); } catch { return null; } } };
}

/**
 * Map one FH-1 attempt to certifyHeal's deterministic evidence. Determinism: the incident's retry gave byte-identical
 * journals on all 12 worlds. Failing replays: the practice worlds' oracle-failing orders the patcher could see (fixed =
 * net oracle gain there). Regressions: the grading cases that passed before. Fresh: each failure class on the grading
 * worlds (never shown to the patcher) is a failing stratum: base 0 of its cases, candidate the cases kept.
 */
export function fh1Evidence(rec, base) {
  const worlds = (base.grading.worlds?.length ?? 0) + (base.practice.worlds?.length ?? 0);
  const failingByClass = {};
  for (const w of base.grading.worlds ?? []) for (const c of w.cases ?? []) if (c.oracle === false) failingByClass[c.class] = (failingByClass[c.class] ?? 0) + 1;
  const pb = rec.practice.before, pa = rec.practice.after ?? rec.practice.before;
  const kept = rec.grading.kept ?? { nRecovered: 0, nRegressed: 0, recoveredByClass: {} };
  return {
    mode: 'deterministic',
    determinism: { replays: base.retry?.identicalJournals ? worlds : 0, identical: base.retry?.identicalJournals ? worlds : 0 },
    failing: { n: pb.oracleN - pb.oraclePassed, fixed: Math.max(0, pa.oraclePassed - pb.oraclePassed) },
    regressions: { n: rec.grading.before.oraclePassed, broken: kept.nRegressed },
    fresh: Object.entries(failingByClass).map(([k, n]) => ({ stratum: k, failing: true, base: { n, pass: 0 }, cand: { n, pass: kept.recoveredByClass?.[k] ?? 0 } })),
  };
}

export function rescoreFH1(src) {
  const runs = src.list().filter(r => !r.endsWith('.dry'));
  const bases = {}, rows = [];
  for (const r of runs) {
    const rec = src.read(`runs/${r}/record.json`);
    if (!rec) { rows.push({ attempt: r, verdict: 'no record', label: 'environment-fault' }); continue; }
    if (rec.dryRun) continue;
    bases[rec.incident] ??= src.read(`baseline/${rec.incident}.json`);
    const base = bases[rec.incident];
    const e = fh1Evidence(rec, base);
    const session = !(rec.session?.capUsd === 0 && rec.changed === false);
    const c = session ? certifyHeal(e) : { verdict: 'reject', label: 'no-candidate', reasons: ['no session: the arm\'s verifier raised no signal'] };
    const failing = e.fresh.reduce((s, f) => s + f.base.n, 0), kept = e.fresh.reduce((s, f) => s + f.cand.pass, 0);
    rows.push({ attempt: r, incident: rec.incident, arm: rec.arm, k: rec.k, ownGate: rec.gate?.accept ?? null, verdict: c.verdict, label: c.label, reasons: c.reasons,
      practice: `${e.failing.fixed}/${e.failing.n}`, grading: `${kept}/${failing}`, regressed: e.regressions.broken,
      manifest: checkManifest(manifestFromLaunch(rec, { runId: r })).nodes.join('; ') });
  }
  const arms = {};
  for (const r of rows.filter(x => x.arm)) {
    const key = `${r.arm} k${r.k}`; arms[key] ??= { attempts: 0, accept: 0, reject: 0, inconclusive: 0, ownGateAccept: 0 };
    arms[key].attempts++; arms[key][r.verdict]++; if (r.ownGate) arms[key].ownGateAccept++;
  }
  for (const a of Object.values(arms)) a.acceptCI = cp(a.accept, a.attempts);
  // cases are not independent: a deterministic fix of a class fixes every case of it, so the cell is the unit
  const cells = [];
  for (const r of rows.filter(x => x.arm === 'H-C' && x.k === 1)) {
    const rec = src.read(`runs/${r.attempt}/record.json`), e = fh1Evidence(rec, bases[rec.incident]);
    for (const f of e.fresh) cells.push({ n: f.base.n, wrong: f.base.n - f.cand.pass });
  }
  const eff = effectiveN(cells, { rho: 0 });
  return { source: src.where, attempts: rows, byArm: arms,
    hcK1Cases: { failing: cells.reduce((s, c) => s + c.n, 0), recovered: cells.reduce((s, c) => s + c.n - c.wrong, 0), cells: cells.length,
      cellsRecovered: cells.filter(c => c.wrong === 0).length, rhoHat: round(eff.rhoHat), nEff: round(eff.nEff, 1) } };
}

// ================================================================================================ need (M1 negatives)
const NR = 'research/need-router-20261014';
export function m1Cells(rows) {
  const task = new Map();
  for (const x of rows) {
    const [fam, , d] = x.taskKey.split(':');
    const t = task.get(x.taskKey) ?? { fam, d, pass: false };
    t.pass ||= !!x.pass; task.set(x.taskKey, t);
  }
  const cells = new Map();
  for (const t of task.values()) { const k = `${t.fam}@${t.d}`; const c = cells.get(k) ?? { cell: k, n: 0, pass: 0 }; c.n++; if (t.pass) c.pass++; cells.set(k, c); }
  return [...cells.values()];
}

export function rescoreNeed() {
  const rows = [...readJsonl(path.join(ROOT, NR, 'runs/m1/results.jsonl')), ...readJsonl(path.join(ROOT, NR, 'runs/m1-d5/results.jsonl'))];
  const cells = m1Cells(rows);
  const rho = iccAnova(cells.map(c => ({ n: c.n, wrong: c.pass })));
  const negCells = cells.filter(c => c.pass > 0), N = negCells.reduce((s, c) => s + c.pass, 0);
  const nominalM = Math.max(...cells.map(c => c.n));
  const nEff = {
    nominal: { m: nominalM, deff: round(1 + (nominalM - 1) * rho), nEff: round(N / (1 + (nominalM - 1) * rho), 2) },
    kish: { sizes: negCells.map(c => c.pass), nEff: round(kishEffectiveN(negCells.map(c => c.pass), rho), 2) },
    clusters: negCells.length,
  };
  const at = n => ({ n: round(n, 2), zeroFalseTriggerUpper95: round(exactBinomialBounds(0, n, { level: 0.95 }).hi) });
  const ns = [nEff.nominal.nEff, nEff.kish.nEff, negCells.length];
  const lo = Math.min(...ns), hi = Math.max(...ns);
  const second = { population: 'SWE-rebench, one issue per repo (the need-router sweep of 2026-10-21; counts carried, re-bounded here)', n: 351,
    rules: Object.fromEntries([['keyword router (any cue)', 191], ['hard cues only', 20], ['size ≥ 30K tokens', 0]].map(([k, x]) => [k, { fired: x, ...cp(x, 351, { sides: 1 }) }])),
    npUmbrella: { alpha: 0.01, delta: 0.05, nMin: npMinN(0.01, 0.05), rank: npUmbrellaRank(351, 0.01, 0.05) } };
  return {
    part: 'need', evidence: 'development/diagnostic: archived M1 rows (144 tasks, 12 family × difficulty cells), K = 1',
    tasks: cells.reduce((s, c) => s + c.n, 0), cells, iccOneCallOutcome: round(rho, 3),
    negatives: { tasks: N, cells: negCells.length, nEff, range: [round(lo, 1), round(hi, 1)] },
    neverTriggerAtNeff: [at(lo), at(hi)],
    npUmbrella: { 'alpha 0.05, delta 0.05': { nMin: npMinN(0.05, 0.05), rankAtNeff: npUmbrellaRank(Math.floor(hi), 0.05, 0.05) }, 'alpha 0.01, delta 0.05': { nMin: npMinN(0.01, 0.05), rankAtNeff: npUmbrellaRank(Math.floor(hi), 0.01, 0.05) } },
    secondPopulation: second,
    verdict: `the M1 negatives are worth ${round(lo, 1)}-${round(hi, 1)} independent clusters: zero false triggers there bounds the rate only below ${round(at(hi).zeroFalseTriggerUpper95, 2)}-${round(at(lo).zeroFalseTriggerUpper95, 2)}; the NP umbrella refuses (n_min 59 for 5%, 299 for 1%); a C7c claim needs a pre-declared independent population`,
  };
}

// ================================================================================================ dev60
const AB = 'research/automationbench-20261014/runs';
export const DEV60_ARMS = Object.freeze([
  { arm: 'haiku-a0', runs: ['a0-dev60-dn'] },
  { arm: 'sonnet-a0', runs: ['a0s-dev60-dn'] },
  { arm: 'haiku-a1', runs: ['a1-dev60-dn', 'a1-dev60-dn-fill'] },
  { arm: 'sonnet-a1', runs: ['a1s-dev60-dn', 'a1s-dev60-dn-fill'] },
  { arm: 'haiku-a1c', runs: ['a1c-dev60-dn'] },
  { arm: 'm3-a1c', runs: ['m3-a1c-dev60-dn', 'm3-a1c-dev60-dn-fill'] },
]);
export const RUN_ID_OK = id => /dev60/.test(id) && !/devcheck|look|test|sealed/i.test(id);
const LEGACY = 'pre-D28 dev run: effort unset in the launch record (the CLI then applied its default; not recorded)';

/** Merge run rows in order: a later run's row for a task replaces an earlier one (fill runs re-run the non-outcomes). */
export function mergeRows(runRows, dev60) {
  const by = new Map();
  for (const rows of runRows) for (const r of rows) {
    if (!dev60.has(r.task)) throw new Error(`dev60 re-score: task ${r.task} is not in the dev60 selection; refusing to read it`);
    by.set(r.task, r);
  }
  return by;
}

export function rescoreDev60({ autobenchRoot = '/var/tmp/foundry-work/autobench', strataFile } = {}) {
  const strata = readJson(strataFile);
  const hard = new Set(strata.hard), soft = new Set(strata.soft);
  const sel = readJson(path.join(ROOT, AB, 'a0-dev60-dn/summary.json'));
  if (!(sel.selection?.pool === 'devTrain' && sel.selection?.subset === 60 && String(sel.selection?.seed) === '21' && sel.tasks?.length === 60)) throw new Error('dev60 re-score: the anchor run is not the dev60 draw');
  const dev60 = new Set(sel.tasks);
  for (const t of [...hard, ...soft]) if (!dev60.has(t)) throw new Error(`strata task ${t} is not in dev60`);
  const runDir = id => { if (!RUN_ID_OK(id)) throw new Error(`run id ${id} is not on the dev60 allowlist`); const a = path.join(ROOT, AB, id); return existsSync(path.join(a, 'results.jsonl')) ? a : path.join(autobenchRoot, id); };
  const arms = [], vectors = {};
  for (const A of DEV60_ARMS) {
    const by = mergeRows(A.runs.map(id => readJsonl(path.join(runDir(id), 'results.jsonl'))), dev60);
    if (by.size !== 60) throw new Error(`${A.arm}: ${by.size} tasks, not 60`);
    const pass = t => by.get(t)?.final?.task_completed_correctly === 1;
    const tasks = [...dev60];
    vectors[A.arm] = tasks.map(t => (pass(t) ? 1 : 0));
    const cost = [...by.values()].reduce((s, r) => s + (r.costUsd ?? r.forks?.[0]?.costUsd ?? 0), 0);
    // the launch records: summary (has harness.nodeModels) where present, else launch.json; every run's effort is checked
    const recs = A.runs.map(id => { const d = runDir(id); const f = ['summary.json', 'launch.json'].map(x => path.join(d, x)).find(existsSync); return { id, rec: readJson(f) }; });
    const withNodes = recs.find(r => r.rec.harness?.nodeModels) ?? recs[0];
    const manifest = manifestFromLaunch(withNodes.rec, { runId: A.runs.join('+') });
    const efforts = recs.map(r => ({ run: r.id, effort: r.rec.effort ?? null, temperature: r.rec.temperature ?? null,
      budgetUsdPerSession: r.rec.budgetUsdPerSession ?? r.rec.budgetUsd ?? null, capUsd: r.rec.capUsd ?? null,
      // token caps of the metered (Mercury) calls, where the run had them: per call, per session, per run
      callTokens: r.rec.callTokens ?? r.rec.tokens?.callTokens ?? null, sessionTokens: r.rec.sessionTokens ?? r.rec.tokens?.sessionBudget ?? null,
      tokenCap: r.rec.tokenCap ?? r.rec.tokens?.cap ?? null }));
    const reach = tasks.filter(t => !hard.has(t)), cons = reach.filter(t => !soft.has(t));
    const row = headlineRow({ label: A.arm, passes: tasks.filter(pass).length, n: 60,
      reachable: { passes: reach.filter(pass).length, n: reach.length, source: 'dev60 minus the 7 hard benchmark defects (VERIFIER-LAB §2)' },
      conservative: { passes: cons.filter(pass).length, n: cons.length }, manifest, legacy: LEGACY, costUsd: cost });
    arms.push({ ...row, runs: A.runs, efforts, hardDefectPasses: tasks.filter(t => hard.has(t) && pass(t)).length });
  }
  // effective number of arms (Kish over arms: K / (1 + (K − 1)·mean pairwise phi)), on all 60 and on the reachable 53
  const neffArms = mask => {
    const ks = Object.keys(vectors), idx = [...dev60].map((t, i) => (mask(t) ? i : -1)).filter(i => i >= 0);
    const phi = (a, b) => { const n = idx.length; let sa = 0, sb = 0, sab = 0; for (const i of idx) { sa += a[i]; sb += b[i]; sab += a[i] * b[i]; } const pa = sa / n, pb = sb / n; const den = Math.sqrt(pa * (1 - pa) * pb * (1 - pb)); return den > 0 ? (sab / n - pa * pb) / den : 0; };
    const ps = []; for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) ps.push(phi(vectors[ks[i]], vectors[ks[j]]));
    const mean = ps.reduce((s, x) => s + x, 0) / ps.length;
    return { arms: ks.length, tasks: idx.length, meanPhi: round(mean, 3), nEff: round(ks.length / (1 + (ks.length - 1) * mean), 2) };
  };
  const tasks = [...dev60];
  const oracle = tasks.filter((t, i) => Object.values(vectors).some(v => v[i])).length;
  const best = 'm3-a1c', vs = {};
  for (const k of Object.keys(vectors)) if (k !== best) {
    const b = vectors[best].filter((x, i) => x && !vectors[k][i]).length, c = vectors[k].filter((x, i) => x && !vectors[best][i]).length;
    vs[k] = { bestOnly: b, otherOnly: c, mcnemarP: round(mcnemarExactCounts(b, c).p, 4) };
  }
  return {
    part: 'dev60', evidence: 'development/diagnostic: devTrain dev60 (seed 21), k = 1, in-sample for A1-C; stored grades only',
    strata: { file: rel(strataFile), hard: hard.size, soft: soft.size },
    arms, table: headlineTable(arms),
    unionOfArms: { passes: oracle, n: 60, reachable: `${oracle}/${60 - hard.size}` },
    armsNeff: { all60: neffArms(() => true), reachable53: neffArms(t => !hard.has(t)) },
    pairedVsBest: { best, note: 'exact McNemar on discordant tasks; identical on the reachable subset because no arm passes a hard-defect task', ...vs },
  };
}

// ================================================================================================ CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const part = args[0] ?? 'all';
  const outDir = path.resolve(get('out', path.join(ROOT, 'research/blockers-20261021/move0')));
  mkdirSync(outDir, { recursive: true });
  const write = (name, obj) => {
    const body = { generatedBy: 'experiments/certify/rescore.mjs', ...obj, inputs: { ...inputs } };
    writeFileSync(path.join(outDir, `${name}.json`), `${JSON.stringify(body, null, 1)}\n`);
    console.log(`wrote ${rel(path.join(outDir, `${name}.json`))}`);
  };
  if (part === 'e8' || part === 'all') write('e8-units', rescoreE8());
  if (part === 'heal' || part === 'all') {
    const fh1 = get('fh1-dir') ? fh1Source({ dir: path.resolve(get('fh1-dir')) }) : fh1Source({ ref: get('fh1-ref', 'worktree-wf_0f86d12b-ab5-2') });
    write('heal', { part: 'heal', evidence: 'development/diagnostic: stored heal records (10-08 incidents on inspected test seeds; FH-1 on dev worlds)', '2026-10-08': rescoreHeal10_08(), fh1: rescoreFH1(fh1) });
  }
  if (part === 'need' || part === 'all') write('need-m1', rescoreNeed());
  if (part === 'dev60' || part === 'all') {
    const r = rescoreDev60({ autobenchRoot: get('autobench-root', '/var/tmp/foundry-work/autobench'), strataFile: path.resolve(get('strata', path.join(ROOT, 'research/blockers-20261021/move0/dev60-ceiling-strata.json'))) });
    write('dev60', r); console.log(r.table);
  }
}

