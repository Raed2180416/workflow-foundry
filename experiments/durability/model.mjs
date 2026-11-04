// DUR-1 analysis adapter (BUILD-PLAN row 17, "the adapter that builds the model from the run directory"). $0, analyst
// side. It turns stream records (stream.mjs runStream) into the normalised result model analyze.mjs's rules read:
//   exposure    per stream world: the completed cases exposed to each change (exposure.mjs exposureOf, on the frozen
//               reference), cached on disk by world and item digest;
//   attribution change-induced failures of one arm's record: the arm's own version TIMELINE replayed on each incremental
//               twin (and twin0), only for changes with exposed failing cases (no failure, nothing to attribute);
//   model       { worlds: { [k]: { cases: { [c]: Case }, induced: { [change]: [c] }, base: [c] } }, incidents, promotions,
//               sessions, usd } with Case = { graded, pass, critical, placedAt (ms), firstAt, topic, class, epoch,
//               signals: { m1, m2, m3, m5 } (first attributable signal time per channel) };
//   certify     every promotion of a built arm gets a certifyHeal verdict (deterministic mode) under the frozen evidence
//               mapping of prereg §10 (analyze.mjs certEvidence): determinism from 3 replays of the incumbent on the
//               incident's evidence (the history replay at the alarm), failing = the incident's evidence cases failing
//               under the incumbent, fixed iff they pass the ORACLE under the candidate (never shown to the gate),
//               regressions = the regression set's cases passing under the incumbent (practice under the visible
//               configuration, the world's cases ended in the 3 world-days before the alarm, W1), fresh strata = the
//               stream's cases placed after the promotion (rest of world k and world k+1), by the incumbent's first-
//               divergence rule.
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildBundle, evidenceBundle, historyBundle, visibleConfig, WORK } from './changes.mjs';
import { referencePools, gradeRun } from './oracle.mjs';
import { runBundle, journalDigest } from './arms.mjs';
import { exposureOf, attribute } from './exposure.mjs';
import { timelineOf } from './stream.mjs';
import { certEvidence, certify } from './analyze.mjs';
import { T0_MS, DAY_MS, HORIZON_DAYS, PRACTICE, CHANGES, dayStart } from './schedule.mjs';

const toMs = x => (typeof x === 'number' ? x : typeof x === 'string' ? Date.parse(x) : null);
const toSets = obj => Object.fromEntries(Object.entries(obj).map(([c, xs]) => [c, new Set(xs)]));

// ---------------------------------------------------------------------------------------------------------------------
// Exposure (oracle side, frozen reference; cached by world and item digest)

/**
 * streamExposure(worlds, { sealed }) → { byK: { [k]: { [change]: Set(completed exposed cases) } }, floors: { [k]: { [c]:
 * { completed, floor, meets } } }, twins: { [k]: { [c]: bundle } } (in memory only), twin0: { [k]: bundle } }.
 */
export async function streamExposure(worlds, { sealed = null, keepTwins = false } = {}) {
  const byK = {}, floors = {}, twins = {}, twin0 = {}, bundles = {};
  for (const spec of worlds) {
    const b = await buildBundle(spec, { sealed });
    bundles[spec.k] = b;
    const file = path.join(WORK, 'exposure-v1', `${b.worldDigest}-${b.itemDigest}.json`);
    let rec = null;
    if (existsSync(file)) rec = JSON.parse(readFileSync(file, 'utf8'));
    if (!rec || keepTwins) {
      const ex = await exposureOf(spec, { sealed, bundle: b });
      rec = { changes: Object.fromEntries(Object.entries(ex.changes).map(([c, e]) => [c, { completed: [...e.completed].sort(), exposed: e.exposed.size, floor: e.floor, meets: e.meets, startsHere: e.startsHere }])) };
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(rec));
      twins[spec.k] = ex.twins; twin0[spec.k] = ex.twin0;
    }
    byK[spec.k] = toSets(Object.fromEntries(Object.entries(rec.changes).map(([c, e]) => [c, e.completed])));
    floors[spec.k] = Object.fromEntries(Object.entries(rec.changes).map(([c, e]) => [c, { completed: e.completed.length, exposed: e.exposed, floor: e.floor, meets: e.meets, startsHere: e.startsHere }]));
  }
  return { byK, floors, twins, twin0, bundles, of: k => byK[k] ?? {} };
}

// ---------------------------------------------------------------------------------------------------------------------
// Attribution (change-induced failures under the arm's own timeline)

const gradeCache = new Map();
async function gradeTimeline(bundle, timeline) {
  const key = `${bundle.worldDigest}|${bundle.itemDigest}|${timeline.map(e => `${e.fromMs}:${e.version.digest}`).join(',')}`;
  if (gradeCache.has(key)) return gradeCache.get(key);
  const ref = await referencePools(bundle);
  const run = await runBundle(bundle, { timeline });
  const g = gradeRun(bundle, run.rows, ref.pools);
  gradeCache.set(key, g);
  return g;
}

/**
 * attributeRecord({ rec, worlds, ex, sealed }) → { [k]: { induced: { [c]: [case] }, exposedFailing: { [c]: [case] }, base:
 * [case] } }. The world's own grade comes from the record (the delivered run); twins are replayed under the record's
 * timeline of that world (versionMap from runStream).
 */
export async function attributeRecord({ rec, worlds, ex, sealed = null }) {
  const out = {};
  for (const w of rec.worlds) {
    const spec = worlds.find(s => s.k === w.k);
    const failW = new Set(Object.entries(w.grade).filter(([, g]) => g[0] === 0).map(([c]) => c));
    const exK = ex.of(w.k);
    const timeline = timelineOf(rec, w.k, rec.versionMap);
    const gradeW = { cases: Object.entries(w.grade).map(([c, g]) => ({ case: c, graded: true, pass: g[0] === 1 })) };
    const gradeTwins = {};
    for (const c of Object.keys(exK)) {
      if (![...exK[c]].some(x => failW.has(x))) continue;
      const twin = ex.twins[w.k]?.[c] ?? await buildBundle(spec, { sealed, exclude: [c] });
      gradeTwins[c] = await gradeTimeline(twin, timeline);
    }
    const anyFail = failW.size > 0;
    const t0 = anyFail ? (ex.twin0[w.k] ?? await buildBundle(spec, { sealed, base: true })) : null;
    const gradeTwin0 = t0 ? await gradeTimeline(t0, timeline) : null;
    const a = attribute({ ex: { changes: Object.fromEntries(Object.entries(exK).map(([c, s]) => [c, { completed: s }])) }, gradeW, gradeTwins, gradeTwin0 });
    out[w.k] = {
      induced: Object.fromEntries(Object.entries(a.changes).map(([c, v]) => [c, [...v.induced].sort()])),
      exposedFailing: Object.fromEntries(Object.entries(a.changes).map(([c, v]) => [c, [...v.exposedFailing].sort()])),
      base: [...a.base].sort(),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The model of one stream record

/** First attributable signal time per channel per case, from the record's per-day signals. */
export function signalTimes(wrec) {
  const out = {};
  for (const d of Object.values(wrec.days ?? {})) for (const s of d.signals ?? []) {
    if (!s.case || !['m1', 'm2', 'm3', 'm5'].includes(s.ch)) continue;
    const o = (out[s.case] ??= {});
    if (o[s.ch] === undefined || s.at < o[s.ch]) o[s.ch] = s.at;
  }
  return out;
}

/** modelOf(rec, attribution?) → the analysis model of one (arm, unit, stream). */
export function modelOf(rec, attribution = null, exposure = null) {
  const worlds = {};
  for (const w of rec.worlds) {
    const sig = signalTimes(w);
    const cases = {};
    for (const [c, g] of Object.entries(w.grade ?? {})) {
      cases[c] = { graded: true, pass: g[0] === 1, critical: g[1] === 1, firstAt: g[2], placedAt: toMs(g[3]), class: g[4], epoch: g[5], signals: sig[c] ?? {} };
    }
    worlds[w.k] = { cases, induced: attribution?.[w.k]?.induced ?? {}, exposedFailing: attribution?.[w.k]?.exposedFailing ?? {}, base: attribution?.[w.k]?.base ?? [] };
  }
  const usd = (rec.sessions ?? []).reduce((s, x) => s + (x.session?.costUsd ?? 0), 0);
  // Maintenance $ per change (prereg §9 item 6): a session's $ goes to the change most of its incidents' evidence cases
  // are induced failures of (oracle side), else 'base'.
  const sessions = (rec.sessions ?? []).map(s => ({ ...s, attributedChange: attribution ? promotionChange({ incidents: s.incidents ?? [] }, rec, attribution, exposure) : null }));
  return { label: rec.label, arm: rec.arm, stream: rec.stream, worlds, incidents: rec.incidents ?? [], promotions: rec.promotions ?? [], rollbacks: rec.rollbacks ?? [], sessions, usd, budgetStop: rec.budgetStop ?? null };
}

/** Stream day of the onset of change c (fractional days ignored: the onset's world-day), or null. */
export function onsetDay(worlds, c) {
  const spec = worlds.find(w => w.changes.some(x => x.id === c && x.startsHere));
  if (!spec) return null;
  const ch = spec.changes.find(x => x.id === c);
  if (ch.onsetMs === null) return null;
  return 14 * (spec.k - 1) + Math.floor((ch.onsetMs - T0_MS) / DAY_MS) + 1;
}

/**
 * The change a promotion (or session) is attributed to: the change holding most of its incidents' evidence cases as
 * c-induced failures of the delivered run; when none is (a heal can repair the very cases that raised the alarm, so they
 * pass by the world's end), the change most of them are exposed to (exposure(k) -> { [c]: Set }); else 'base'.
 */
export function promotionChange(p, rec, attribution, exposure = null) {
  const tally = sets => {
    const count = new Map();
    for (const id of p.incidents ?? []) {
      const inc = (rec.incidents ?? []).find(i => i.id === id);
      for (const e of inc?.evidence ?? []) {
        if (!e.case || e.practice) continue;
        for (const [c, s] of Object.entries(sets(e.k) ?? {})) if (s instanceof Set ? s.has(e.case) : s.includes(e.case)) count.set(c, (count.get(c) ?? 0) + 1);
      }
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
  };
  return tally(k => attribution?.[k]?.induced) ?? (exposure ? tally(exposure) : null) ?? 'base';
}

// ---------------------------------------------------------------------------------------------------------------------
// Certification of promotions (D28 (5); prereg §10 Certification)

async function gradeVersion(bundle, version) { return gradeTimeline(bundle, [{ fromMs: -Infinity, version }]); }

/**
 * certifyPromotion({ rec, p, worlds, sealed, w1Bundle }) → { verdict, label, reasons, evidence }. Uses only replays at $0.
 */
export async function certifyPromotion({ rec, p, worlds, sealed = null, practice = PRACTICE }) {
  const versions = rec.versionMap;
  const inc = versions.get(p.from), cand = versions.get(p.to);
  if (!inc || !cand) return { verdict: 'inconclusive', label: 'missing-version', reasons: ['a version of the promotion is not in the record'] };
  const spec = worlds.find(w => w.k === p.k);
  const bundle = await buildBundle(spec, { sealed });
  const alarm = dayStart(Math.max(1, p.day - (p.boundary ? 0 : 1)));
  // Determinism: 3 replays of the incumbent on the history replay at the alarm.
  const hist = historyBundle(bundle, alarm);
  const replays = [];
  for (let i = 0; i < 3; i++) replays.push(journalDigest((await runBundle(hist, { version: inc })).rows));
  const gI = await gradeVersion(bundle, inc), gC = await gradeVersion(bundle, cand);
  const passI = new Map(gI.cases.filter(c => c.graded).map(c => [c.case, c])), passC = new Map(gC.cases.filter(c => c.graded).map(c => [c.case, c]));
  // Failing: the incidents' evidence cases (this world, not practice) that fail under the incumbent.
  const evid = new Set();
  const rules = new Set();
  for (const id of p.incidents ?? []) for (const e of (rec.incidents ?? []).find(i => i.id === id)?.evidence ?? []) if (e.case && !e.practice && e.k === p.k) evid.add(e.case);
  const failing = [...evid].filter(c => passI.get(c) && !passI.get(c).pass).map(c => { rules.add(passI.get(c).first?.rule ?? passI.get(c).first?.code ?? 'unknown'); return { case: c, incumbentPass: false, candidatePass: !!passC.get(c)?.pass }; });
  // Regressions: cases of the regression set passing under the incumbent.
  const ref = await referencePools(bundle);
  const recent = Object.entries(ref.ends).filter(([, e]) => e !== null && e >= alarm - 3 * DAY_MS && e < alarm).map(([c]) => c);
  const regressions = recent.filter(c => passI.get(c)?.pass).map(c => ({ case: `${p.k}/${c}`, incumbentPass: true, candidatePass: !!passC.get(c)?.pass }));
  const w1 = worlds.find(w => w.k === 1);
  if (w1 && p.k !== 1) {
    const b1 = await buildBundle(w1, { sealed });
    const a = await gradeVersion(b1, inc), b = await gradeVersion(b1, cand);
    const pb = new Map(b.cases.filter(c => c.graded).map(c => [c.case, c.pass]));
    for (const c of a.cases.filter(x => x.graded && x.pass)) regressions.push({ case: `1/${c.case}`, incumbentPass: true, candidatePass: !!pb.get(c.case) });
  }
  const cfg = visibleConfig(bundle, alarm);
  for (const pr of practice) {
    const pb = await evidenceBundle(pr, cfg, { sealed });
    const a = await gradeVersion(pb, inc), b = await gradeVersion(pb, cand);
    const m = new Map(b.cases.filter(c => c.graded).map(c => [c.case, c.pass]));
    for (const c of a.cases.filter(x => x.graded && x.pass)) regressions.push({ case: `${pb.key}/${c.case}`, incumbentPass: true, candidatePass: !!m.get(c.case) });
  }
  // Fresh strata: cases placed after the promotion (rest of world k) and every case of world k + 1, never shown.
  const promotedAt = p.boundary ? T0_MS : dayStart(p.day);
  const fresh = [];
  for (const c of gI.cases.filter(x => x.graded && toMs(x.placedAt) >= promotedAt && !evid.has(x.case))) fresh.push({ case: `${p.k}/${c.case}`, rule: c.pass ? 'pass' : (c.first?.rule ?? c.first?.code ?? 'unknown'), incumbentPass: c.pass, candidatePass: !!passC.get(c.case)?.pass });
  const next = worlds.find(w => w.k === p.k + 1);
  if (next) {
    const bn = await buildBundle(next, { sealed });
    const a = await gradeVersion(bn, inc), b = await gradeVersion(bn, cand);
    const m = new Map(b.cases.filter(c => c.graded).map(c => [c.case, c.pass]));
    for (const c of a.cases.filter(x => x.graded)) fresh.push({ case: `${p.k + 1}/${c.case}`, rule: c.pass ? 'pass' : (c.first?.rule ?? c.first?.code ?? 'unknown'), incumbentPass: c.pass, candidatePass: !!m.get(c.case) });
  }
  const evidence = certEvidence({ replays, failing, regressions, fresh, incidentRules: rules.size ? [...rules] : null });
  const v = certify(evidence);
  return { ...v, evidence: { determinism: evidence.determinism, failing: evidence.failing, regressions: evidence.regressions, fresh: evidence.fresh.map(s => ({ stratum: s.stratum, failing: s.failing, base: s.base, cand: s.cand })) } };
}

/** Certify every promotion of a record; returns [{ k, day, from, to, change, verdict, label, reasons }]. */
export async function certifyRecord({ rec, worlds, sealed = null, attribution = null, practice = PRACTICE, exposure = null }) {
  const out = [];
  for (const p of rec.promotions ?? []) {
    const c = await certifyPromotion({ rec, p, worlds, sealed, practice });
    out.push({ k: p.k, day: p.day, from: p.from, to: p.to, change: promotionChange(p, rec, attribution, exposure), verdict: c.verdict, label: c.label, reasons: c.reasons, evidence: c.evidence });
  }
  return out;
}

/** certifiedOf for analyze.cellDurability: the verdict of the LAST promotion attributed to the cell's change (null: none). */
export function certifiedOfCells(certs) {
  return cell => {
    const list = (certs[cell.lineage]?.[cell.stream] ?? []).filter(x => x.change === cell.change);
    return list.length ? list.at(-1).verdict : null;
  };
}

export { CHANGES, HORIZON_DAYS };
