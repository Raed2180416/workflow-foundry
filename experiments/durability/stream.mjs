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
import { signalsOfRun, IncidentBook, contractsFor, BASE_READINGS, orderState, journalFindings } from './monitor.mjs';
import { trueComplaints, falseComplaints, adversarialComplaint } from './complaints.mjs';
import { exposedTo } from './exposure.mjs';
import { VersionRegistry } from './registry.mjs';
import { evidenceSets, evidenceRun, patchSession, gate, LIMITS, HAIKU_PATCH, OPUS_PATCH, spendOf } from './heal-adapter.mjs';
import { coSession, certifyReadings, verifierBlindAccept, reading as mkReading, withReading } from './contracts-owner.mjs';
import { dayStart, HORIZON_DAYS, streamDay, T0_MS, DAY_MS, CHANGES, PRACTICE, isoLocal, assertDurSeeds } from './schedule.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
export const CANARY_DAYS = 1, ROLLBACK_DAYS = 2;

// ---------------------------------------------------------------------------------------------------------------------
// Contract owner store: announced-change readings are certified once and shared by every stream and lineage; verifier-
// blind readings are per stream (at most one C-O session per stream, world and topic: the change is unknown to the
// deployment, so this is the oracle-free stand-in for "per change per stream").

export class ContractOwner {
  constructor({ session, runDir, sealed = null, log = () => {} }) { this.session = session; this.runDir = runDir; this.sealed = sealed; this.log = log; this.announced = new Map(); this.vb = new Map(); this.sessions = []; }
  /** The certified reading of an announced rule change (or a quarantine record, K-2). */
  async forAnnounced(id, bundle, atMs) {
    if (this.announced.has(id)) return this.announced.get(id);
    const S = id === 'R1' ? null : this.sealed?.change(id);
    const change = id === 'R1' ? 'R2.2: a fraud review with no usable answer by its deadline no longer cancels the order; it is cleared just after the deadline (orders placed on or after the effective time).'
      : `${S?.label ?? id}`;
    const certBundles = [];
    for (const p of PRACTICE) certBundles.push(await evidenceBundle(p, { rules: [{ id, effMs: T0_MS }], editions: [], renames: [] }, { sealed: this.sealed }));
    const stale = W => { const w = structuredClone(W); delete w.truth.dur1Eff[id]; return w; };
    let rec = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const out = await coSession({ label: `co-${id}-a${attempt}`, kind: 'announced', change: attempt === 1 ? change : `${change}\n\nYour first update was not certified; disagreeing practice cases: ${JSON.stringify(rec?.cert?.disagreements?.slice(0, 12) ?? [])}`,
        spec: bundle.specAt(atMs + 1), previousSpec: bundle.specAt(T0_MS - 31 * DAY_MS), session: this.session(id), runDir: this.runDir, log: this.log });
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
  /** A verifier-blind C-O session (<= 1 per stream, world and topic). */
  async forVerifierBlind({ stream, k, topic, complaints, bundle, atMs, check }) {
    const key = `${stream}|${k}|${topic}`;
    if (this.vb.has(key)) return { ...this.vb.get(key), reused: true };
    const text = complaints.map(c => `- ${isoLocal(c.at)} about ${c.order}:\n  > ${String(c.text).replace(/\n/g, ' ')}`).join('\n');
    const out = await coSession({ label: `co-vb-${stream}-W${k}-${topic}`, kind: 'verifier-blind', complaints: text, spec: bundle.specAt(atMs), session: this.session(`vb:${topic}`), runDir: this.runDir, log: this.log });
    this.sessions.push(out.record);
    let rec = { key, status: 'rejected', reason: 'no update written' };
    if (out.reading) { const acc = await check(out.reading); rec = { key, status: acc.accept ? 'accepted' : 'rejected', reading: out.reading, acceptance: acc }; }
    this.vb.set(key, rec);
    this.log(`C-O verifier-blind ${key}: ${rec.status}`);
    return rec;
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

const classesOnDay = (signals, d) => new Set((signals.days[d] ?? []).filter(s => s.ch === 'm2').map(s => s.cls));
const judgedUpTo = (judgedAt, d) => new Set([...judgedAt].filter(([, day]) => day <= d).map(([c]) => c));
const serial = (k, v) => (k === 'rows' ? undefined : v === Infinity ? 'Infinity' : v === -Infinity ? '-Infinity' : v);

/**
 * runStream(opts) → the lineage-stream record. opts: { arm: 'static' | 'heal', label, start (version), worlds (specs),
 * sealed, heal: { session(kind, { scope }) → session config, opusAfter?: true, stale?: ['R1', 'vb'] }, co (ContractOwner),
 * runDir, log, keepRows?, spendFile?, complaintsFor?({ spec, bundle, ref }) → fixed complaints of a world (LD-H) }.
 */
export async function runStream({ arm, label, start, worlds, sealed = null, heal = null, co = null, runDir, log = () => {}, keepRows = false, spendFile = null, complaintsFor = null }) {
  assertDurSeeds(worlds.map(w => w.seed));
  mkdirSync(runDir, { recursive: true });
  const stream = worlds[0].stream;
  const stale = heal?.stale ?? [];
  const registry = new VersionRegistry({ label, genesis: { id: start.id, digest: start.digest }, at: isoLocal(T0_MS) });
  const book = new IncidentBook({ label });
  const versions = new Map([[start.digest, start]]);
  let current = start, carried = [], pending = null, w1 = null;
  const vbReadings = [];
  const out = { label, arm, stream, start: { id: start.id, digest: start.digest, spec: start.spec }, worlds: [], sessions: [], promotions: [], rollbacks: [], canaries: [], envFaults: 0 };
  const scope = label;
  const spentHere = () => (spendFile ? spendOf(spendFile).byScope[scope] ?? 0 : out.sessions.reduce((s, x) => s + (x.session?.costUsd ?? 0), 0));
  for (const spec of worlds) {
    const bundle = await buildBundle(spec, { sealed });
    if (spec.k === 1) w1 = bundle;
    const ref = await referencePools(bundle);
    if (!ref.control.ok) log(`K-1 WARNING ${bundle.key}: ${ref.control.problems.slice(0, 3).join('; ')}`);
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
    let timeline = [{ fromMs: -Infinity, version: current }];
    let run = await runBundle(bundle, { timeline });
    const pushRun = () => wrec.runs.push({ timeline: timeline.map(e => [e.fromMs, e.version.digest]), status: run.status, digest: journalDigest(run.rows), ms: run.ms });
    pushRun();
    let readings = readingsFor(bundle, T0_MS, { co, vbReadings, stale });
    let cmp = complaintsOf(run.rows);
    let signals = await evalSignals(run.rows, 1);
    for (const [c, d] of signals.judgedAt) judgedAt.set(c, d);
    let prevRun = null, deterministic = null, day = 1;
    const promotedAt = [];
    const rerun = async (fromDay, why) => {
      prevRun = { rows: run.rows, signals };
      run = await runBundle(bundle, { timeline });
      const ok = samePrefix(prevRun.rows, run.rows, dayStart(fromDay));
      wrec.prefixChecks.push({ kind: why, at: dayStart(fromDay), identical: ok });
      if (!ok) log(`V-6 PREFIX MISMATCH ${bundle.key} at day ${fromDay} (${why})`);
      pushRun();
      deterministic = null;
      cmp = complaintsOf(run.rows);
      for (const [c, d] of [...judgedAt]) if (d >= fromDay) judgedAt.delete(c);
      signals = await evalSignals(run.rows, fromDay);
      for (const [c, d] of signals.judgedAt) judgedAt.set(c, d);
    };
    // A candidate gated at the previous world's last day: its canary is this world's day 1, its promotion day 2.
    let canaryFirst = pending && !pending.canaried ? pending : null;
    if (pending && pending.canaried) {
      registry.promote({ expectHead: registry.head().hash, version: pending.cand, proposer: pending.session, approver: 'code-gate', at: isoLocal(T0_MS), reason: 'canaried on the previous world\'s last day; promoted at the world boundary' });
      out.promotions.push({ k: spec.k, day: 1, from: current.digest, to: pending.cand.digest, incidents: pending.incidents, boundary: true });
      for (const id of pending.incidents) { const inc = book.incidents.find(x => x.id === id); if (inc) { inc.status = 'healed'; inc.promotions.push({ k: spec.k, day: 1, to: pending.cand.digest }); } }
      current = pending.cand; timeline = [{ fromMs: -Infinity, version: current }]; pending = null;
      run = await runBundle(bundle, { timeline }); pushRun(); cmp = complaintsOf(run.rows);
      judgedAt.clear(); signals = await evalSignals(run.rows, 1); for (const [c, d] of signals.judgedAt) judgedAt.set(c, d);
    }
    pending = null;

    /** Canary + promotion of an accepted candidate gated at the end of day d (alarm T = dayStart(d+1)). */
    const tryPromote = async ({ cand, d, incidents, sessionLabel, reason }) => {
      const shadow = await runBundle(bundle, { timeline: [...timeline, { fromMs: dayStart(d + 1), version: cand }] });
      const shadowSig = await evalSignals(shadow.rows, d + 1, d + 1, [], judgedUpTo(judgedAt, d));
      const inc = classesOnDay(signals, d + 1), cnd = classesOnDay(shadowSig, d + 1);
      const newCls = [...cnd].filter(c => !inc.has(c));
      out.canaries.push({ k: spec.k, day: d + 1, kind: 'shadow', candidate: cand.digest, newClasses: newCls.slice(0, 5), pass: newCls.length === 0 });
      if (newCls.length) { for (const i of incidents) i.rejected.push(`canary:${newCls[0]}`); return false; }
      const P = d + 2;
      if (P > HORIZON_DAYS) { pending = { cand, incidents: incidents.map(i => i.id), canaried: true, session: sessionLabel }; return false; }
      registry.promote({ expectHead: registry.head().hash, version: cand, proposer: sessionLabel, approver: 'code-gate', at: isoLocal(dayStart(P)), reason });
      out.promotions.push({ k: spec.k, day: P, from: current.digest, to: cand.digest, incidents: incidents.map(i => i.id), gate: reason, session: sessionLabel });
      for (const i of incidents) { i.status = 'healed'; i.promotions.push({ k: spec.k, day: P, to: cand.digest }); }
      promotedAt.push({ day: P, incumbent: current, incidents: incidents.map(i => i.id) });
      timeline = [...timeline, { fromMs: dayStart(P), version: cand }];
      current = cand;
      await rerun(P, 'promotion');
      day = P;
      return true;
    };
    if (canaryFirst) {
      const incs = canaryFirst.incidents.map(id => book.incidents.find(x => x.id === id)).filter(Boolean);
      const shadow = await runBundle(bundle, { timeline: [{ fromMs: -Infinity, version: canaryFirst.cand }] });
      const shadowSig = await evalSignals(shadow.rows, 1, 1, [], new Set());
      const newCls = [...classesOnDay(shadowSig, 1)].filter(c => !classesOnDay(signals, 1).has(c));
      out.canaries.push({ k: spec.k, day: 1, kind: 'shadow (deferred)', candidate: canaryFirst.cand.digest, pass: !newCls.length });
      if (!newCls.length) {
        registry.promote({ expectHead: registry.head().hash, version: canaryFirst.cand, proposer: canaryFirst.session, approver: 'code-gate', at: isoLocal(dayStart(2)), reason: 'deferred canary passed' });
        out.promotions.push({ k: spec.k, day: 2, from: current.digest, to: canaryFirst.cand.digest, incidents: canaryFirst.incidents });
        for (const i of incs) { i.status = 'healed'; i.promotions.push({ k: spec.k, day: 2, to: canaryFirst.cand.digest }); }
        promotedAt.push({ day: 2, incumbent: current, incidents: canaryFirst.incidents });
        timeline = [...timeline, { fromMs: dayStart(2), version: canaryFirst.cand }];
        current = canaryFirst.cand;
        await rerun(2, 'promotion');
      }
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
          const again = await runBundle(bundle, { timeline });
          deterministic = samePrefix(run.rows, again.rows, T);
          wrec.prefixChecks.push({ kind: 're-execution', at: T, identical: deterministic });
        }
        if (deterministic === false) for (const i of res.opened) if (i.kind === 'defect') { i.status = 'flake'; i.note = 'did not reproduce on re-execution: retry, no patch'; }
        // Rule 2: announcements and config changes -> the $0 canary on practice under the visible configuration.
        const newReadings = readingsFor(bundle, T, { co, vbReadings, stale });
        if (res.m4.length) {
          const sets = await evidenceSets({ bundle, alarmAt: T, w1, sealed });
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
        // Rule 4: verifier-blind incidents -> one C-O session; an accepted reading re-judges the complained orders (rule 1).
        for (const inc of res.verifierBlind) {
          if (!co || stale.includes('vb')) { inc.status = 'needs-human'; inc.note = 'verifier-blind; no contract owner in this arm'; continue; }
          const complained = new Set(inc.complaints.map(c => c.case).filter(Boolean));
          const others = new Set(Object.keys(bundle.W.truth.cases).filter(c => ref.pools[c] === 'completed' && bundle.W.truth.cases[c].subject && !complained.has(c) && (judgedAt.get(c) ?? 99) <= d));
          const r = await co.forVerifierBlind({ stream, k: spec.k, topic: inc.topic, complaints: inc.complaints, bundle, atMs: T,
            check: async rd => {
              const rs = withReading(newReadings, mkReading({ id: `vb-${inc.topic}`, fromMs: -Infinity, rules: rd.rules, module: rd.module, base: newReadings }));
              const cv = await contractsFor(bundle, run.rows, { pools: ref.pools, readings: rs, cases: [...complained, ...others] });
              return verifierBlindAccept({ flaggedCases: [...cv.entries()].filter(([, v]) => !v.pass).map(([c]) => c), complainedCases: complained, otherCases: others });
            } });
          if (r.status !== 'accepted') { inc.status = 'needs-human'; inc.note = `verifier-blind C-O ${r.status}`; continue; }
          if (!r.reused) vbReadings.push({ id: `vb-${stream}-${spec.k}-${inc.topic}`, rules: r.reading.rules, module: r.reading.module });
          inc.status = 'converted'; inc.note = 'C-O update accepted; rule 1 applies under the updated contracts';
          readings = readingsFor(bundle, T, { co, vbReadings, stale });
          const again = await evalSignals(run.rows, 1, d, [], new Set());
          for (const list of Object.values(again.days)) book.ingest(list.filter(s => s.ch !== 'm5'), { k: spec.k, day: d, worldKey: bundle.key, streamDay: streamDay(spec.k, d) });
        }
        readings = readingsFor(bundle, T, { co, vbReadings, stale });
        // Rollback: a promotion within ROLLBACK_DAYS that shows a contract class the incumbent's shadow lacks.
        const lastP = promotedAt.at(-1);
        if (lastP && prevRun && d >= lastP.day && d < lastP.day + ROLLBACK_DAYS && d + 1 <= HORIZON_DAYS) {
          const newCls = [...classesOnDay(signals, d)].filter(c => !classesOnDay(prevRun.signals, d).has(c));
          if (newCls.length) {
            const back = lastP.incumbent;
            registry.rollback({ expectHead: registry.head().hash, to: back, at: isoLocal(dayStart(d + 1)), reason: `new contract classes after promotion: ${newCls.slice(0, 3).join('; ')}` });
            out.rollbacks.push({ k: spec.k, day: d + 1, to: back.digest, classes: newCls.slice(0, 5) });
            for (const id of lastP.incidents) { const inc = book.incidents.find(x => x.id === id); if (inc) inc.status = 'open'; }
            timeline = [...timeline, { fromMs: dayStart(d + 1), version: back }];
            current = back;
            promotedAt.pop();
            await rerun(d + 1, 'rollback');
            day = d + 1;
            continue dayLoop;
          }
        }
        // Heal: every open incident of the lineage-stream in one batch (FAILURES.md: <= 8 classes); <= 2 sessions each.
        const cap = LIMITS.sessionsPerIncident + (heal?.opusAfter ? 1 : 0);
        const open = book.openIncidents().filter(i => i.sessions < cap);
        if (!open.length || !heal) continue;
        if (spentHere() >= LIMITS.usdPerLineageStream) { for (const i of open) i.status = 'budget-stop'; out.budgetStop ??= { k: spec.k, day: d }; continue; }
        const sets = await evidenceSets({ bundle, alarmAt: T, w1, sealed });
        const proactive = open.every(i => i.kind === 'canary');
        const announced = (bundle.announcements ?? []).filter(a => a.at < T).map(a => `- ${a.id} (${a.kind}) published ${isoLocal(a.at)}, effective for orders placed from ${isoLocal(a.effectiveAt)}`).join('\n') || null;
        const rowsByWorld = {};
        if (open.some(i => i.evidence.some(e => e.practice))) for (const b of sets.practice) rowsByWorld[b.key] = (await evidenceRun(current, b, { readings })).rows;
        const useOpus = !!heal.opusAfter && open.every(i => i.sessions >= LIMITS.sessionsPerIncident);
        const nSessions = useOpus ? 1 : Math.max(0, LIMITS.sessionsPerIncident - Math.max(...open.map(i => i.sessions)));
        let best = null;
        const tries = [];
        for (let s = 1; s <= nSessions; s++) {
          if (spentHere() >= LIMITS.usdPerLineageStream) break;
          const sessLabel = `${label}.W${spec.k}d${d}.s${s}${useOpus ? '.opus' : ''}`;
          const p = await patchSession({ label: sessLabel, incumbent: current, incidents: open, bundle, rows: run.rows, rowsByWorld, alarmAt: T, sets, readings,
            session: heal.session(useOpus ? 'opus' : 'haiku', { scope }), runDir: path.join(runDir, 'sessions'), announced, log });
          for (const i of open) i.sessions += 1;
          out.sessions.push(p.record);
          if (p.record.envFault) { out.envFaults += 1; continue; }
          const g = await gate({ incumbent: current, candidate: p.candidate, incidents: open, sets, readings, proactive });
          p.record.gate = { accept: g.accept, reason: g.reason, fixed: g.fixed?.length ?? 0, still: g.stillFlagged?.length ?? 0, regressions: g.regressions?.length ?? 0, regressionExamples: (g.regressions ?? []).slice(0, 5) };
          writeFileSync(path.join(runDir, 'sessions', sessLabel.replace(/[^\w.-]/g, '_'), 'record.json'), JSON.stringify(p.record, null, 1));
          tries.push({ label: sessLabel, gate: p.record.gate });
          if (g.accept) { if (p.candidate) versions.set(p.candidate.digest, p.candidate); if (!best || (g.stillFlagged?.length ?? 0) < (best.g.stillFlagged?.length ?? 0)) best = { p, g }; if (g.clean) break; }
        }
        for (const i of open) i.rejected.push(...tries.filter(t => !t.gate.accept).map(t => `${t.label}: ${t.gate.reason}`));
        if (!best) {
          for (const i of open) if (i.sessions >= cap) { i.status = 'needs-human'; i.note = 'no accepted patch'; }
          continue;
        }
        if (d + 1 > HORIZON_DAYS) { pending = { cand: best.p.candidate, incidents: open.map(i => i.id), canaried: false, session: best.p.record.label }; out.canaries.push({ k: spec.k, day: d, kind: 'deferred-to-next-world', candidate: best.p.candidate.digest }); continue; }
        if (await tryPromote({ cand: best.p.candidate, d, incidents: open, sessionLabel: best.p.record.label, reason: best.g.reason })) continue dayLoop;
      }
      break;
    }
    carried = cmp.carriedNext.map(c => ({ ...c, carriedFrom: bundle.key }));
    // The delivered run's per-case outcomes (analysis only; never seen by the loop): [pass, critical, firstAt, placedAt, class, epoch].
    const g = gradeRun(bundle, run.rows, ref.pools);
    wrec.grade = Object.fromEntries(g.cases.filter(c => c.graded).map(c => [c.case, [c.pass ? 1 : 0, c.critical ? 1 : 0, c.firstAt ?? null, c.placedAt ?? null, c.class ?? null, c.epoch ?? null]]));
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
  writeFileSync(path.join(runDir, `${label.replace(/[^\w.-]/g, '_')}.stream.json`), JSON.stringify(out, serial, 1));
  out.versionMap = versions;
  return out;
}

/** The version timeline of a lineage-stream's world k (from its record), for replays (attribution, version matrix). */
export function timelineOf(rec, k, versions) {
  const w = rec.worlds.find(x => x.k === k);
  return w.timeline.map(e => ({ fromMs: e.fromMs === '-Infinity' ? -Infinity : e.fromMs, version: versions.get(e.digest) }));
}
