// DUR-1 stream driver (PREREG-DUR-1 §4-§6; BUILD-PLAN row 11). One (arm, lineage, stream): world after world, the version
// carries over; per world the arm runs under its version TIMELINE; the monitor reads the journal day by day; incidents
// open; heals run (stub or paid sessions); a gated candidate runs in shadow through the next world-day (canary) and is
// promoted by compare-and-swap at the following day boundary; the world is then re-run with the extended timeline (its
// journal before the swap is byte-identical, V-6, checked on every re-run); a promotion is rolled back if within two
// world-days it shows a contract-violation class the incumbent's shadow lacks. Static arms run each world once.
// Arms: 'static' (S-H*, S-H, REF-S, R-static, c-oss; also the W-M0 view: the static journal with the full monitor),
// 'heal' (MH-H; options: opusAfter (MH-H->O fork), stale: ['R1'] (MH-STALE: no C-O at R1 and no verifier-blind C-O)).
// Complaints already delivered are history: a re-run never retracts them (complaints.mjs draws are per case, the same
// for every arm). Everything a session sees is built from the arm's own journal, delivered complaints, the spec and
// rulebook and API files in force or announced, and practice worlds under the visible configuration (heal-adapter.mjs).
import path from 'node:path';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildBundle, visibleConfig, evidenceBundle } from './changes.mjs';
import { referencePools, gradeRun } from './oracle.mjs';
import { runBundle, samePrefix, journalDigest, programVersion, referenceVersion } from './arms.mjs';
import { signalsOfRun, IncidentBook, contractsFor, BASE_READINGS, orderState, journalFindings, orderOfArgs } from './monitor.mjs';
import { trueComplaints, falseComplaints, adversarialComplaint } from './complaints.mjs';
import { exposedTo } from './exposure.mjs';
import { VersionRegistry } from './registry.mjs';
import { evidenceSets, evidenceRun, patchSession, gate, LIMITS, HAIKU_PATCH, OPUS_PATCH, spendOf, EnvFault, ENV_WAIT_MS, BudgetStop, StopError } from './heal-adapter.mjs';
import { coSession, certifyReadings, verifierBlindAccept, reading as mkReading, withReading } from './contracts-owner.mjs';
import { dayStart, HORIZON_DAYS, streamDay, T0_MS, DAY_MS, CHANGES, PRACTICE, isoLocal, assertDurSeeds } from './schedule.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
export const CANARY_DAYS = 1, ROLLBACK_DAYS = 2;

// ---------------------------------------------------------------------------------------------------------------------
// Contract owner store: announced-change readings are certified once and shared by every stream and lineage. Verifier-
// blind: AT MOST ONE C-O session per stream (prereg §5 C-O "<= 1 per change per stream", §12 P2; fix 2026-11-04, review
// B5): the deployment cannot tell changes apart, so the oracle-free form of the prereg's count is one session per stream,
// spent on the stream's first verifier-blind incident and shared by its lineages and REF-M. Every later verifier-blind
// incident of the stream (any lineage, any topic) is re-judged with that reading on ITS OWN journal (acceptance per
// lineage-stream and incident, review B3); without an accepted reading it is a loud "needs human".

export const VB_SESSIONS_PER_STREAM = 1;

export class ContractOwner {
  constructor({ session, runDir, sealed = null, log = () => {}, practice = PRACTICE }) { this.practice = practice; this.session = session; this.runDir = runDir; this.sealed = sealed; this.log = log; this.announced = new Map(); this.vb = new Map(); this.sessions = []; }
  /** The certified reading of an announced rule change (or a quarantine record: K-2, or no room in P2). */
  async forAnnounced(id, bundle, atMs) {
    if (this.announced.has(id)) return this.announced.get(id);
    const S = id === 'R1' ? null : this.sealed?.change(id);
    const change = id === 'R1' ? 'R2.2: a fraud review with no usable answer by its deadline no longer cancels the order; it is cleared just after the deadline (orders placed on or after the effective time).'
      : `${S?.label ?? id}`;
    const certBundles = [];
    for (const p of this.practice) certBundles.push(await evidenceBundle(p, { rules: [{ id, effMs: T0_MS }], editions: [], renames: [] }, { sealed: this.sealed }));
    const stale = W => { const w = structuredClone(W); delete w.truth.dur1Eff[id]; return w; };
    let rec = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let out;
      try {
        out = await coSession({ label: `co-${id}-a${attempt}`, kind: 'announced', change: attempt === 1 ? change : `${change}\n\nYour first update was not certified; disagreeing practice cases: ${JSON.stringify(rec?.cert?.disagreements?.slice(0, 12) ?? [])}`,
          spec: bundle.specAt(atMs + 1), previousSpec: bundle.specAt(T0_MS - 31 * DAY_MS), session: this.session(id), runDir: this.runDir, log: this.log });
      } catch (e) {
        if (!(e instanceof BudgetStop)) throw e;
        rec = { id, status: 'quarantined', reason: `budget-stop: ${e.message}`, attempt, budgetStop: true };   // no room in P2: the change runs without a C-O update (reported)
        break;
      }
      this.sessions.push(out.record);
      if (!out.reading) { rec = { id, status: 'quarantined', reason: 'no update written', attempt }; continue; }
      const readings = withReading(BASE_READINGS, mkReading({ id, fromMs: -Infinity, rules: out.reading.rules, module: out.reading.module }));
      const cert = await certifyReadings({ readings, bundles: certBundles, stale });
      rec = { id, status: cert.ok ? 'certified' : 'quarantined', reading: out.reading, cert, attempt };
      if (cert.ok) break;
    }
    this.announced.set(id, rec);
    this.log(`C-O ${id}: ${rec.status}${rec.cert ? ` (drifted flags ${rec.cert.driftedFlags}, exposed share ${rec.cert.exposedShare.toFixed(2)}, precision ${rec.cert.precision.toFixed(2)})` : ''}`);
    return rec;
  }
  /** The stream's verifier-blind session record (run it if the stream has none yet). { key, status, reading?, fresh }. */
  async vbSessionOf({ stream, k, topic, complaints, bundle, atMs }) {
    const key = stream;
    if (this.vb.has(key)) return { ...this.vb.get(key), fresh: false };
    const text = complaints.map(c => `- ${isoLocal(c.at)} about ${c.order}:\n  > ${String(c.text).replace(/\n/g, ' ')}`).join('\n');
    let rec;
    try {
      const out = await coSession({ label: `co-vb-${stream}-W${k}-${topic}`, kind: 'verifier-blind', complaints: text, spec: bundle.specAt(atMs), session: this.session(`vb:${stream}`), runDir: this.runDir, log: this.log });
      this.sessions.push(out.record);
      rec = { key, status: out.reading ? 'written' : 'no-update', reading: out.reading ?? null, first: { k, topic } };
    } catch (e) {
      if (!(e instanceof BudgetStop)) throw e;
      rec = { key, status: 'budget-stop', reason: e.message, reading: null, first: { k, topic } };
    }
    this.vb.set(key, rec);
    this.log(`C-O verifier-blind ${key} (W${k} ${topic}): ${rec.status}`);
    return { ...rec, fresh: true };
  }
  /**
   * A verifier-blind incident: the stream's one session (run now if none yet), then acceptance on THIS arm's journal
   * (`check(reading)` -> verifierBlindAccept). Returns { status: 'accepted' | 'rejected' | 'cap' | 'budget-stop', reading?,
   * acceptance?, reused }.
   */
  async forVerifierBlind({ stream, k, topic, complaints, bundle, atMs, check }) {
    const s = await this.vbSessionOf({ stream, k, topic, complaints, bundle, atMs });
    if (!s.reading) return { key: s.key, status: s.status === 'budget-stop' ? 'budget-stop' : s.fresh ? 'rejected' : 'cap', reason: s.reason ?? (s.fresh ? 'no update written' : 'the stream\'s verifier-blind session wrote no update'), reused: !s.fresh };
    const acc = await check(s.reading);
    return { key: s.key, status: acc.accept ? 'accepted' : 'rejected', reading: s.reading, acceptance: acc, reused: !s.fresh };
  }
}

/** The contract readings for a bundle at time T: base, the certified announced readings visible by T, and VB readings. */
export function readingsFor(bundle, T, { co, vbReadings = [], stale = [] }) {
  let rs = [...BASE_READINGS];
  for (const r of visibleConfig(bundle, T).rules) {
    if (stale.includes(r.id)) continue;
    const a = co?.announced.get(r.id);
    if (a?.status === 'certified') rs = withReading(rs, mkReading({ id: r.id, fromMs: r.effMs, rules: a.reading.rules, module: a.reading.module, base: rs }));
  }
  for (const v of vbReadings) rs = withReading(rs, mkReading({ id: v.id, fromMs: -Infinity, rules: v.rules, module: v.module, base: rs }));
  return rs;
}

// ---------------------------------------------------------------------------------------------------------------------

/** Per-case findings of a world-day: Set('<case>|<cls>') of m1, m2 and m3 signals (the canary and rollback compare these). */
export const findingsOnDay = (signals, d) => new Set((signals.days[d] ?? []).filter(s => ['m1', 'm2', 'm3'].includes(s.ch)).map(s => `${s.case ?? s.order ?? '?'}|${s.cls}`));
/** Findings the candidate shows on day d that the incumbent lacks (per case, every defect channel; review R2-M1). */
export const newFindings = (cand, inc, d) => { const a = findingsOnDay(inc, d); return [...findingsOnDay(cand, d)].filter(x => !a.has(x)); };
const judgedUpTo = (judgedAt, d) => new Set([...judgedAt].filter(([, day]) => day <= d).map(([c]) => c));
const serial = (k, v) => (k === 'rows' ? undefined : v === Infinity ? 'Infinity' : v === -Infinity ? '-Infinity' : v);
/** World run time limit (a hang guard, sized to the world: 30 min per 80 arriving orders). */
export const worldTimeoutMs = b => 30 * 60_000 * Math.max(1, Math.ceil((b?.spec?.size ?? 80) / 80));
/** A world run that did not complete is never graded (review R2-M5): a harness error (exit 1; the chain retries once). */
export function mustComplete(run, what) {
  if (run.status !== 'complete') throw Object.assign(new Error(`DUR1_HARNESS: ${what}: the world run did not complete (${String(run.status).slice(0, 200)}); never graded`), { code: 'DUR1_HARNESS' });
  return run;
}

/**
 * runStream(opts) → the lineage-stream record. opts: { arm: 'static' | 'heal', label, start (version), worlds (specs),
 * sealed, heal: { session(kind, { scope }) → session config, opusAfter?: true, stale?: ['R1', 'vb'] }, co (ContractOwner),
 * runDir, log, keepRows?, spendFile?, scope? (ledger scope of this attempt; default label), usdCap? (per lineage-stream,
 * default $1.50), complaintsFor?({ spec, bundle, ref }) → fixed complaints of a world (LD-H) }.
 * Stops (never graded): K-1 (a control fails on a world: StopError), V-6 (a re-run's prefix differs: StopError), a world
 * run that does not complete (DUR1_HARNESS). Budget (review B4): a session starts only if the lineage-stream's spend so far
 * + the session's cap <= usdCap and its row and the total have room; otherwise the open incidents are `budget-stop` and the
 * stream continues without heals (prereg §6.3, K-3).
 */
export async function runStream({ arm, label, start, worlds, sealed = null, heal = null, co = null, runDir, recordDir = runDir, log = () => {}, keepRows = false, spendFile = null, complaintsFor = null, timelineFor = null, regressionW1 = null, practice = PRACTICE, scope: scopeIn = null, usdCap = LIMITS.usdPerLineageStream }) {
  assertDurSeeds(worlds.map(w => w.seed));
  mkdirSync(runDir, { recursive: true });
  mkdirSync(recordDir, { recursive: true });
  const stream = worlds[0].stream;
  const stale = heal?.stale ?? [];
  const registry = new VersionRegistry({ label, genesis: { id: start.id, digest: start.digest }, at: isoLocal(T0_MS) });
  const book = new IncidentBook({ label });
  const versions = new Map([[start.digest, start]]);
  let current = start, carried = [], pending = null, w1 = null;
  const vbReadings = [];
  const out = { label, arm, stream, scope: scopeIn ?? label, usdCap, start: { id: start.id, digest: start.digest, spec: start.spec }, worlds: [], sessions: [], promotions: [], rollbacks: [], canaries: [], envFaults: 0, vb: [] };
  const scope = scopeIn ?? label;
  const spentHere = () => (spendFile ? spendOf(spendFile).byScope[scope] ?? 0 : out.sessions.reduce((s, x) => s + (x.session?.costUsd ?? 0), 0));
  let healStopped = null;   // a budget stop of the row or the total ends every later session of this stream
  const runW = async (b, opts, what) => mustComplete(await runBundle(b, { ...opts, worldTimeoutMs: worldTimeoutMs(b) }), `${label} ${b.key} ${what}`);
  for (const spec of worlds) {
    const bundle = await buildBundle(spec, { sealed });
    if (spec.k === 1) w1 = bundle;
    else if (!w1 && regressionW1) w1 = await buildBundle(regressionW1, { sealed });   // a fork that starts after W1 (MH-stale) keeps W1 in its regression set
    const ref = await referencePools(bundle);
    // K-1 (prereg §13.2): a control failing on a world it is used on stops everything; never a warning (review B6/R2-B3).
    if (!ref.control.ok) throw new StopError(`K-1 ${bundle.key}: ${ref.control.problems.slice(0, 3).join('; ')}`);
    // C-O for this world's announced rule changes runs once (shared); readingsFor uses it only once it is visible.
    if (co) for (const id of ['R1', 'R2s']) if (spec.changes.some(c => c.id === id) && !stale.includes(id)) await co.forAnnounced(id, bundle, T0_MS);
    const wrec = { key: bundle.key, k: spec.k, seed: spec.seed, worldDigest: bundle.worldDigest, itemDigest: bundle.itemDigest, runs: [], timeline: null, days: {}, control: ref.control, prefixChecks: [] };
    const frozen = carried.map(c => ({ ...c }));
    carried = [];
    const falseC = falseComplaints({ stream, worldSeed: spec.seed, worldKey: bundle.key, ends: ref.ends, subjects: ref.subjects });
    const advC = spec.changes.some(c => c.id === 'ADV' && c.startsHere) ? [adversarialComplaint({ stream, worldSeed: spec.seed, worldKey: bundle.key, day: CHANGES.ADV.complaintDay, ends: ref.ends, subjects: ref.subjects })] : [];
    const templates = spec.changes.some(c => c.id === 'U1s') && sealed?.change('U1s')?.complaintTemplates?.length
      ? { cases: await exposedTo(spec, 'U1s', { sealed, bundle }), texts: sealed.change('U1s').complaintTemplates, topic: sealed.change('U1s').complaintTopic ?? 'notice', fromMs: bundle.W.truth.dur1Eff.U1s ?? -Infinity } : null;
    let processedUntil = T0_MS - 1;
    // LD-H: the manifest's planted complaints (true and false) are the m5 channel, fixed whatever the version does.
    const fixedComplaints = complaintsFor ? complaintsFor({ spec, bundle, ref }) : null;
    const complaintsOf = rows => {
      if (fixedComplaints) return { all: [...frozen, ...fixedComplaints.filter(c => c.at > processedUntil)].sort((a, b) => a.at - b.at), carriedNext: [] };
      const grade = gradeRun(bundle, rows, ref.pools);
      const tc = trueComplaints({ stream, worldSeed: spec.seed, worldKey: bundle.key, grade, templates });
      const fresh = [...falseC, ...advC, ...tc.filter(c => !c.carried)].filter(c => c.at > processedUntil);
      return { all: [...frozen, ...fresh].sort((a, b) => a.at - b.at), carriedNext: tc.filter(c => c.carried) };
    };
    const judgedAt = new Map();
    const evalSignals = async (rows, fromDay, toDay = HORIZON_DAYS, complaints = cmp.all, extraJudged = null) => {
      const s = await signalsOfRun({ bundle, rows, pools: ref.pools, readings: arm === 'static' ? readingsFor(bundle, dayStart(HORIZON_DAYS + 1), { co, vbReadings, stale }) : readings,
        complaints, fromDay, toDay, judgedBefore: extraJudged ?? judgedUpTo(judgedAt, fromDay - 1) });
      return s;
    };
    // Static comparators with scheduled switches (R-maint(L), R-ceil: rmaint.mjs) pass timelineFor; nothing else does.
    let timeline = timelineFor && arm === 'static' ? await timelineFor(spec, bundle) : [{ fromMs: -Infinity, version: current }];
    for (const e of timeline) versions.set(e.version.digest, e.version);
    let run = await runW(bundle, { timeline }, 'run');
    const pushRun = () => wrec.runs.push({ timeline: timeline.map(e => [e.fromMs, e.version.digest]), status: run.status, digest: journalDigest(run.rows), ms: run.ms });
    pushRun();
    let readings = readingsFor(bundle, T0_MS, { co, vbReadings, stale });
    let cmp = complaintsOf(run.rows);
    let signals = await evalSignals(run.rows, 1);
    for (const [c, d] of signals.judgedAt) judgedAt.set(c, d);
    let prevRun = null, deterministic = null, day = 1, noHealDay = null;
    const promotedAt = [];
    const rerun = async (fromDay, why) => {
      prevRun = { rows: run.rows, signals };
      run = await runW(bundle, { timeline }, `re-run (${why})`);
      const ok = samePrefix(prevRun.rows, run.rows, dayStart(fromDay));
      wrec.prefixChecks.push({ kind: why, at: dayStart(fromDay), identical: ok });
      // V-6: the journal before the swap must be identical; a mismatch voids the harness (stop, never a warning).
      if (!ok) throw new StopError(`V-6 prefix mismatch ${bundle.key} at day ${fromDay} (${why})`);
      pushRun();
      deterministic = null;
      cmp = complaintsOf(run.rows);
      for (const [c, d] of [...judgedAt]) if (d >= fromDay) judgedAt.delete(c);
      signals = await evalSignals(run.rows, fromDay);
      // The days before the swap keep the delivered (incumbent's) signals: they are history (review B2: without them the
      // canary day was never monitored and the deferred canary's day 1 was processed with no signals).
      for (let d = 1; d < fromDay; d++) if (prevRun.signals.days[d] && !signals.days[d]) signals.days[d] = prevRun.signals.days[d];
      for (const [c, d] of signals.judgedAt) judgedAt.set(c, d);
    };
    // A candidate gated at the previous world's last day: its canary is this world's day 1, its promotion day 2.
    let canaryFirst = pending && !pending.canaried ? pending : null;
    if (pending && pending.canaried) {
      registry.promote({ expectHead: registry.head().hash, version: pending.cand, proposer: pending.session, approver: 'code-gate', at: isoLocal(T0_MS), reason: 'canaried on the previous world\'s last day; promoted at the world boundary' });
      out.promotions.push({ k: spec.k, day: 1, from: current.digest, to: pending.cand.digest, incidents: pending.incidents, boundary: true });
      for (const id of pending.incidents) { const inc = book.incidents.find(x => x.id === id); if (inc) { inc.status = 'healed'; inc.promotions.push({ k: spec.k, day: 1, to: pending.cand.digest }); } }
      current = pending.cand; timeline = [{ fromMs: -Infinity, version: current }]; pending = null;
      run = await runW(bundle, { timeline }, 'run (boundary promotion)'); pushRun(); cmp = complaintsOf(run.rows);
      judgedAt.clear(); signals = await evalSignals(run.rows, 1); for (const [c, d] of signals.judgedAt) judgedAt.set(c, d);
    }
    pending = null;

    /** Canary + promotion of an accepted candidate gated at the end of day d (alarm T = dayStart(d+1)). */
    const tryPromote = async ({ cand, d, incidents, sessionLabel, reason }) => {
      const shadow = await runW(bundle, { timeline: [...timeline, { fromMs: dayStart(d + 1), version: cand }] }, 'shadow');
      const shadowSig = await evalSignals(shadow.rows, d + 1, d + 1, [], judgedUpTo(judgedAt, d));
      // Per case and every defect channel (m1 incl. arm errors, m2, m3): a finding on that day's cases the incumbent lacks.
      const fresh = newFindings(shadowSig, signals, d + 1);
      out.canaries.push({ k: spec.k, day: d + 1, kind: 'shadow', candidate: cand.digest, newFindings: fresh.slice(0, 5), pass: fresh.length === 0 });
      if (fresh.length) { for (const i of incidents) i.rejected.push(`canary:${fresh[0]}`); return false; }
      const P = d + 2;
      if (P > HORIZON_DAYS) { pending = { cand, incidents: incidents.map(i => i.id), canaried: true, session: sessionLabel }; return false; }
      registry.promote({ expectHead: registry.head().hash, version: cand, proposer: sessionLabel, approver: 'code-gate', at: isoLocal(dayStart(P)), reason });
      out.promotions.push({ k: spec.k, day: P, from: current.digest, to: cand.digest, incidents: incidents.map(i => i.id), gate: reason, session: sessionLabel });
      for (const i of incidents) { i.status = 'healed'; i.promotions.push({ k: spec.k, day: P, to: cand.digest }); }
      promotedAt.push({ day: P, incumbent: current, incidents: incidents.map(i => i.id) });
      timeline = [...timeline, { fromMs: dayStart(P), version: cand }];
      current = cand;
      await rerun(P, 'promotion');
      // The canary day d+1 is still monitored (its signals are the incumbent's, which delivered it): the loop resumes
      // there; no heal session starts on it (a candidate is in canary).
      day = d + 1; noHealDay = d + 1;
      return true;
    };
    if (canaryFirst) {
      const incs = canaryFirst.incidents.map(id => book.incidents.find(x => x.id === id)).filter(Boolean);
      const shadow = await runW(bundle, { timeline: [{ fromMs: -Infinity, version: canaryFirst.cand }] }, 'shadow (deferred)');
      const shadowSig = await evalSignals(shadow.rows, 1, 1, [], new Set());
      const fresh = newFindings(shadowSig, signals, 1);
      out.canaries.push({ k: spec.k, day: 1, kind: 'shadow (deferred)', candidate: canaryFirst.cand.digest, newFindings: fresh.slice(0, 5), pass: !fresh.length });
      if (!fresh.length) {
        registry.promote({ expectHead: registry.head().hash, version: canaryFirst.cand, proposer: canaryFirst.session, approver: 'code-gate', at: isoLocal(dayStart(2)), reason: 'deferred canary passed' });
        out.promotions.push({ k: spec.k, day: 2, from: current.digest, to: canaryFirst.cand.digest, incidents: canaryFirst.incidents });
        for (const i of incs) { i.status = 'healed'; i.promotions.push({ k: spec.k, day: 2, to: canaryFirst.cand.digest }); }
        promotedAt.push({ day: 2, incumbent: current, incidents: canaryFirst.incidents });
        timeline = [...timeline, { fromMs: dayStart(2), version: canaryFirst.cand }];
        current = canaryFirst.cand;
        await rerun(2, 'promotion');
        noHealDay = 1;
      } else for (const i of incs) { i.status = 'open'; i.rejected.push(`canary (deferred):${fresh[0]}`); }
    }

    dayLoop:
    while (day <= HORIZON_DAYS) {
      for (let d = day; d <= HORIZON_DAYS; d++) {
        const T = dayStart(d + 1);
        const sig = signals.days[d] ?? [];
        for (const c of cmp.all) if (c.at >= dayStart(d) && c.at < T && !frozen.some(x => x.id === c.id)) frozen.push(c);
        processedUntil = T - 1;
        wrec.days[d] = { signals: sig.map(s => ({ ch: s.ch, cls: s.cls, order: s.order, case: s.case, at: s.at })) };
        if (arm === 'static') continue;
        const res = book.ingest(sig, { k: spec.k, day: d, worldKey: bundle.key, streamDay: streamDay(spec.k, d) });
        // Rule 1 ladder: re-execute; an identical journal up to T means a workflow defect (retry is never the action).
        if (res.opened.some(i => i.kind === 'defect') && deterministic === null) {
          const again = await runW(bundle, { timeline }, 're-execution');
          deterministic = samePrefix(run.rows, again.rows, T);
          wrec.prefixChecks.push({ kind: 're-execution', at: T, identical: deterministic });
        }
        if (deterministic === false) for (const i of res.opened) if (i.kind === 'defect') { i.status = 'flake'; i.note = 'did not reproduce on re-execution: retry, no patch'; }
        // Rule 2: announcements and config changes -> the $0 canary on practice under the visible configuration.
        const newReadings = readingsFor(bundle, T, { co, vbReadings, stale });
        if (res.m4.length) {
          const sets = await evidenceSets({ bundle, alarmAt: T, w1, sealed, practice });
          const failing = [];
          for (const b of sets.practice) {
            const r = await evidenceRun(current, b, { readings: newReadings });
            for (const [o, cls] of r.findings) for (const c of cls) failing.push({ ch: c.split('|')[0], cls: c, order: o, world: b.key, at: T - 1, day: d, detail: `practice ${b.key}: ${c}`, practice: true });
          }
          out.canaries.push({ k: spec.k, day: d, kind: 'announcement', failing: failing.length, triggers: res.m4.map(s => s.cls) });
          const byCls = new Map();
          for (const f of failing) { if (!byCls.has(f.cls)) byCls.set(f.cls, []); byCls.get(f.cls).push(f); }
          for (const [cls, list] of byCls) if (!book.active(`canary:${cls}`)) book.open('canary', { cls: `canary:${cls}`, k: spec.k, day: d, at: T - 1, signals: list.slice(0, 12) });
        }
        // Rule 4: verifier-blind incidents -> the stream's one C-O session (shared); acceptance on this arm's own journal;
        // an accepted reading re-judges the complained orders (rule 1).
        for (const inc of res.verifierBlind) {
          if (!co || stale.includes('vb')) { inc.status = 'needs-human'; inc.note = 'verifier-blind; no contract owner in this arm'; continue; }
          const complained = new Set(inc.complaints.map(c => c.case).filter(Boolean));
          const others = new Set(Object.keys(bundle.W.truth.cases).filter(c => ref.pools[c] === 'completed' && bundle.W.truth.cases[c].subject && !complained.has(c) && (judgedAt.get(c) ?? 99) <= d));
          const r = await co.forVerifierBlind({ stream, k: spec.k, topic: inc.topic, complaints: inc.complaints, bundle, atMs: T,
            check: async rd => {
              const rs = withReading(newReadings, mkReading({ id: `vb-${stream}`, fromMs: -Infinity, rules: rd.rules, module: rd.module, base: newReadings }));
              let cv;
              try { cv = await contractsFor(bundle, run.rows, { pools: ref.pools, readings: rs, cases: [...complained, ...others] }); }
              catch (e) { if (e?.code !== 'DUR1_CONTRACT_MODULE') throw e; return { accept: false, error: e.message.slice(0, 300) }; }   // the sandboxed module failed: not accepted
              return verifierBlindAccept({ flaggedCases: [...cv.entries()].filter(([, v]) => !v.pass).map(([c]) => c), complainedCases: complained, otherCases: others });
            } });
          out.vb.push({ k: spec.k, day: d, incident: inc.id, topic: inc.topic, status: r.status, reused: r.reused, acceptance: r.acceptance ?? null });
          if (r.status !== 'accepted') { inc.status = 'needs-human'; inc.note = r.status === 'budget-stop' ? 'verifier-blind C-O: no room in P2 (budget)' : r.status === 'cap' ? 'verifier-blind C-O: the stream\'s one session wrote no update' : `verifier-blind C-O ${r.status}`; continue; }
          if (!vbReadings.some(v => v.id === `vb-${stream}`)) vbReadings.push({ id: `vb-${stream}`, rules: r.reading.rules, module: r.reading.module });
          inc.status = 'converted'; inc.note = `C-O update ${r.reused ? 'reused and ' : ''}accepted on this journal; rule 1 applies under the updated contracts`;
          readings = readingsFor(bundle, T, { co, vbReadings, stale });
          const again = await evalSignals(run.rows, 1, d, [], new Set());
          for (const list of Object.values(again.days)) book.ingest(list.filter(s => s.ch !== 'm5'), { k: spec.k, day: d, worldKey: bundle.key, streamDay: streamDay(spec.k, d) });
        }
        readings = readingsFor(bundle, T, { co, vbReadings, stale });
        // Rollback: a promotion within ROLLBACK_DAYS that shows a finding (per case; m1, m2, m3) the incumbent's shadow lacks.
        const lastP = promotedAt.at(-1);
        if (lastP && prevRun && d >= lastP.day && d < lastP.day + ROLLBACK_DAYS && d + 1 <= HORIZON_DAYS) {
          const fresh = newFindings(signals, prevRun.signals, d);
          if (fresh.length) {
            const back = lastP.incumbent;
            registry.rollback({ expectHead: registry.head().hash, to: back, at: isoLocal(dayStart(d + 1)), reason: `new findings after promotion: ${fresh.slice(0, 3).join('; ')}` });
            out.rollbacks.push({ k: spec.k, day: d + 1, to: back.digest, findings: fresh.slice(0, 5) });
            for (const id of lastP.incidents) { const inc = book.incidents.find(x => x.id === id); if (inc) inc.status = 'open'; }
            timeline = [...timeline, { fromMs: dayStart(d + 1), version: back }];
            current = back;
            promotedAt.pop();
            await rerun(d + 1, 'rollback');
            day = d + 1;
            continue dayLoop;
          }
        }
        if (d === noHealDay) continue;   // the canary day of a promoted candidate: monitored, no session
        // Heal: every open incident of the lineage-stream in one batch (FAILURES.md: <= 8 classes); <= 2 sessions each.
        const cap = LIMITS.sessionsPerIncident + (heal?.opusAfter ? 1 : 0);
        const open = book.openIncidents().filter(i => i.sessions < cap);
        if (!open.length || !heal) continue;
        const useOpus = !!heal.opusAfter && open.every(i => i.sessions >= LIMITS.sessionsPerIncident);
        const sessionCap = c => (c?.kind === 'stub' ? 0 : Number(c?.budgetUsd ?? 0));
        const stopFor = why => { for (const i of open) { i.status = 'budget-stop'; i.note = why; } out.budgetStop ??= { k: spec.k, day: d, why }; };
        if (healStopped) { stopFor(healStopped); continue; }
        let conf0;
        try { conf0 = heal.session(useOpus ? 'opus' : 'haiku', { scope }); } catch (e) { if (!(e instanceof BudgetStop)) throw e; if (e.why !== 'scope') healStopped = e.message; stopFor(e.message); continue; }
        if (spentHere() + sessionCap(conf0) > usdCap + 1e-9) { stopFor(`lineage-stream cap $${usdCap}: spent $${spentHere().toFixed(3)} + session cap $${sessionCap(conf0)}`); continue; }
        const sets = await evidenceSets({ bundle, alarmAt: T, w1, sealed, practice });
        const proactive = open.every(i => i.kind === 'canary');
        const announced = (bundle.announcements ?? []).filter(a => a.at < T).map(a => `- ${a.id} (${a.kind}) published ${isoLocal(a.at)}, effective for orders placed from ${isoLocal(a.effectiveAt)}`).join('\n') || null;
        const rowsByWorld = {};
        if (open.some(i => i.evidence.some(e => e.practice))) for (const b of sets.practice) rowsByWorld[b.key] = (await evidenceRun(current, b, { readings })).rows;
        const nSessions = useOpus ? 1 : Math.max(0, LIMITS.sessionsPerIncident - Math.max(...open.map(i => i.sessions)));
        let best = null, envRetried = false;
        const tries = [];
        for (let s = 1; s <= nSessions; s++) {
          let conf;
          try {
            conf = heal.session(useOpus ? 'opus' : 'haiku', { scope });
            if (spentHere() + sessionCap(conf) > usdCap + 1e-9) throw new BudgetStop(`lineage-stream cap $${usdCap}: spent $${spentHere().toFixed(3)} + session cap $${sessionCap(conf)}`, 'scope');
          } catch (e) { if (!(e instanceof BudgetStop)) throw e; if (e.why !== 'scope') healStopped = e.message; stopFor(e.message); break; }
          const sessLabel = `${label}.W${spec.k}d${d}.s${s}${useOpus ? '.opus' : ''}${scope !== label ? `.${scope.slice(label.length).replace(/[^\w]/g, '')}` : ''}`;
          let p;
          try {
            p = await patchSession({ label: sessLabel, incumbent: current, incidents: open, bundle, rows: run.rows, rowsByWorld, alarmAt: T, sets, readings,
              session: conf, runDir: path.join(runDir, 'sessions'), announced, log });
          } catch (e) { if (!(e instanceof BudgetStop)) throw e; if (e.why !== 'scope') healStopped = e.message; stopFor(e.message); break; }
          for (const i of open) i.sessions += 1;
          out.sessions.push(p.record);
          if (p.record.envFault) {
            // Environment fault (prereg §13.2): never scored. Wait 30 minutes and re-run the session once fresh (its spend
            // stays on the ledger); a second fault stops the stream so the chain waits and resumes it as a new attempt.
            out.envFaults += 1;
            for (const i of open) i.sessions -= 1;
            if (envRetried) throw new EnvFault(sessLabel, p.record.envFault);
            envRetried = true;
            log(`${sessLabel}: environment fault ${p.record.envFault}; waiting ${Math.round(ENV_WAIT_MS / 60_000)} min, then one fresh session`);
            await new Promise(r => setTimeout(r, ENV_WAIT_MS));
            s -= 1;
            continue;
          }
          const g = await gate({ incumbent: current, candidate: p.candidate, incidents: open, sets, readings, proactive });
          p.record.gate = { accept: g.accept, reason: g.reason, fixed: g.fixed?.length ?? 0, still: g.stillFlagged?.length ?? 0, regressions: g.regressions?.length ?? 0, regressionExamples: (g.regressions ?? []).slice(0, 5) };
          writeFileSync(path.join(runDir, 'sessions', sessLabel.replace(/[^\w.-]/g, '_'), 'record.json'), JSON.stringify(p.record, null, 1));
          tries.push({ label: sessLabel, gate: p.record.gate });
          if (g.accept) { if (p.candidate) versions.set(p.candidate.digest, p.candidate); if (!best || (g.stillFlagged?.length ?? 0) < (best.g.stillFlagged?.length ?? 0)) best = { p, g }; if (g.clean) break; }
        }
        for (const i of open) i.rejected.push(...tries.filter(t => !t.gate.accept).map(t => `${t.label}: ${t.gate.reason}`));
        if (!best) {
          for (const i of open) if (i.status === 'open' && i.sessions >= cap) { i.status = 'needs-human'; i.note = 'no accepted patch'; }
          continue;
        }
        if (d + 1 > HORIZON_DAYS) { pending = { cand: best.p.candidate, incidents: open.map(i => i.id), canaried: false, session: best.p.record.label }; out.canaries.push({ k: spec.k, day: d, kind: 'deferred-to-next-world', candidate: best.p.candidate.digest }); continue; }
        if (await tryPromote({ cand: best.p.candidate, d, incidents: open, sessionLabel: best.p.record.label, reason: best.g.reason })) continue dayLoop;
      }
      break;
    }
    carried = cmp.carriedNext.map(c => ({ ...c, carriedFrom: bundle.key }));
    // The delivered run's per-case outcomes (analysis only; never seen by the loop): [pass, critical, firstAt, placedAt, class, epoch, lastAt].
    const g = gradeRun(bundle, run.rows, ref.pools);
    const lastAt = lastEffectAt(bundle, run.rows);
    wrec.grade = Object.fromEntries(g.cases.filter(c => c.graded).map(c => [c.case, [c.pass ? 1 : 0, c.critical ? 1 : 0, c.firstAt ?? null, c.placedAt ?? null, c.class ?? null, c.epoch ?? null, lastAt.get(c.case) ?? null]]));
    wrec.gradeSummary = { completed: g.completed, passed: g.passed, critical: g.critical, oracleErrors: g.oracleErrors };
    wrec.timeline = timeline.map(e => ({ fromMs: e.fromMs, version: e.version.id, digest: e.version.digest }));
    wrec.final = { status: run.status, digest: journalDigest(run.rows) };
    wrec.complaints = frozen.map(c => ({ id: c.id, kind: c.kind, case: c.case, topic: c.topic, at: c.at, world: c.world }));
    if (keepRows) wrec.rows = run.rows;
    out.worlds.push(wrec);
    log(`${label} ${bundle.key}: ${wrec.runs.length} run(s), promotions ${out.promotions.filter(p => p.k === spec.k).length}, open incidents ${book.openIncidents().length}`);
  }
  out.incidents = book.incidents.map(i => ({ ...i, evidence: i.evidence.slice(0, 20).map(({ raw, ...e }) => e) }));
  out.registry = registry.toJSON();
  out.versions = [...versions.values()].map(v => ({ id: v.id, digest: v.digest, spec: v.spec }));
  out.final = { id: current.id, digest: current.digest, spec: current.spec };
  out.vbReadings = vbReadings.map(v => ({ id: v.id, rules: v.rules ?? null, module: v.module ? path.basename(v.module) : null }));
  writeFileSync(path.join(recordDir, `${label.replace(/[^\w.-]/g, '_')}.stream.json`), JSON.stringify(out, serial, 1));
  out.versionMap = versions;
  return out;
}

/**
 * The time of each case's last effect in a journal (ms; the silent rule's deadline is its last effect + 1 world-day,
 * prereg §9 item 2; review M10). Cases with no effect have no entry.
 */
export function lastEffectAt(bundle, rows) {
  const out = new Map();
  const caseOfOrder = new Map(Object.entries(bundle.W.truth.cases).filter(([, t]) => t.subject).map(([c, t]) => [t.subject, c]));
  let now = null;
  const emits = new Map();
  for (const r of rows) {
    if (r.type === 'wakeup') now = Date.parse(r.at);
    if (r.type === 'effect.emit') emits.set(r.emission, r.effect);
    if (r.type !== 'ledger') continue;
    const order = orderOfArgs(emits.get(r.emission)?.args ?? null);
    const c = r.subjectCase ?? (order ? caseOfOrder.get(order) : null) ?? null;   // analysis side: the host's instance binding
    const t = typeof r.at === 'string' ? Date.parse(r.at) : now;
    if (c && Number.isFinite(t) && (!out.has(c) || t > out.get(c))) out.set(c, t);
  }
  return out;
}

/** The version timeline of a lineage-stream's world k (from its record), for replays (attribution, version matrix). */
export function timelineOf(rec, k, versions) {
  const w = rec.worlds.find(x => x.k === k);
  return w.timeline.map(e => ({ fromMs: e.fromMs === '-Infinity' ? -Infinity : e.fromMs, version: versions.get(e.digest) }));
}
