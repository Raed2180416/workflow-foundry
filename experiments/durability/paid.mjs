// DUR-1 paid stages and the analysis of a real run (PREREG-DUR-1 §12-§13; called by run.mjs). Every model call here is
// metered on one ledger (research/durability-20261021/runs/spend.jsonl, the FH-1 start/end pattern): a session starts
// only if (a) the freeze holds, (b) total committed + its cap <= $80, (c) its row has room (prereg §12 priority order,
// unspent cap flowing down to later rows), (d) its lineage-stream has room (<= $1.50). Records are written per
// lineage-stream; a stage resumes by skipping every unit whose record exists (a unit killed mid-way is re-run from its
// start: its spend so far stays on the ledger, disclosed).
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { worldsOf, STREAM_IDS, REHEARSAL, T0_MS, DAY_MS, CHANGES, CHANGE_IDS, dayStart, HORIZON_DAYS, PRACTICE } from './schedule.mjs';
import { buildBundle, loadSealed, evidenceBundle, ROOT, WORK } from './changes.mjs';
import { referencePools, gradeRun } from './oracle.mjs';
import { programVersion, versionOfSpec, LINEAGES, REF_SOLVERS, controlVersion, runBundle } from './arms.mjs';
import { runStream, ContractOwner, lastEffectAt, readingsFor } from './stream.mjs';
import { HAIKU_PATCH, OPUS_PATCH, spendOf, LIMITS, BudgetStop, StopError } from './heal-adapter.mjs';
import { CO_SESSION, stubCO, withReading, reading as mkReading } from './contracts-owner.mjs';
import { calibrate, runDetector, instanceTasks } from './edetector.mjs';
import { streamExposure, attributeRecord, modelOf, certifyRecord, critRegressionDays } from './model.mjs';
import { report } from './report.mjs';
import { selectWindow, runWindow, WINDOW_CHANGES, K_DEFAULT, K_FALLBACK, AGENT } from './windows.mjs';
import { runLD, LATENT } from './ld.mjs';
import { search, confirm, evaluate, BUDGET, GROUP_A } from './wc-search.mjs';
import { redTeamSession, blindBaseline, RT_SESSIONS } from './redteam/session.mjs';
import { ruleVersion } from './rmaint.mjs';
import { signalsOfRun, BASE_READINGS } from './monitor.mjs';
import { envInvalid, silentDeadline, silent, VISIBLE } from './analyze.mjs';
import { RES, RUNS, SPEND, TOTAL_CAP, PRIORITY, capOf, rowOf, rowRoom } from './run.mjs';
export { rowOf, rowRoom };
import { SEALED_DIR } from './author.mjs';

/** The ledger meter for per-tick agents (agentVArm's meter interface: before reserves, after settles). */
export function ledgerMeter({ scope, row, file = SPEND }) {
  let n = 0;
  return {
    before({ model, bound }) {
      // Synchronous (agentVArm's meter interface): the same lock directory as meteredRun, taken with a short spin.
      const lock = `${file}.lock`;
      for (let i = 0; ; i++) { try { mkdirSync(lock); break; } catch (e) { if (e.code !== 'EEXIST') throw e; let age = 0; try { age = Date.now() - statSync(lock).mtimeMs; } catch { continue; } if (age > 60_000) { rmSync(lock, { recursive: true, force: true }); continue; } const t = Date.now() + 100; while (Date.now() < t) { /* spin */ } } }
      try {
        const room = rowRoom(row, file);
        if (room < bound || spendOf(file).upperUsd + bound > TOTAL_CAP) throw Object.assign(new Error(`DUR1_BUDGET: ${scope} (row ${row} room $${room.toFixed(2)})`), { code: 'DUR1_BUDGET', quota: true });   // quota: the host freezes the run at its last commit instead of scoring an arm error
        const id = `${scope}#${++n}@${new Date().toISOString()}`;
        appendFileSync(file, JSON.stringify({ id, phase: 'start', label: scope, scope, model, capUsd: bound, at: new Date().toISOString() }) + '\n');
        return { id, model, bound };
      } finally { rmSync(lock, { recursive: true, force: true }); }
    },
    after(tok, r) {
      if (!tok) return null;
      appendFileSync(file, JSON.stringify({ id: tok.id, phase: 'end', label: scope, scope, model: tok.model, capUsd: tok.bound, costUsd: r?.costUsd ?? null, costUpperUsd: r?.costUsd === null || r?.costUsd === undefined ? tok.bound : null, error: r?.error?.code ?? null, at: new Date().toISOString() }) + '\n');
      return r?.costUsd ?? tok.bound;
    },
  };
}

/** Is a process alive (signal 0)? */
const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export const LOCK_MAX_AGE_MS = 4 * 3_600_000;   // a C-O critical section is <= 2 sessions x 30 min + certification
/**
 * A directory lock owned by (host, pid, time). Held by another live process on this host: wait. Held by a process that is
 * gone (a container restart, a killed worker) or older than LOCK_MAX_AGE_MS: reclaimed (review R2-M3: a stale lock made the
 * next run wait 2 h, then exit 75 forever). `done()` is checked before every attempt and again inside the lock, so a
 * worker that arrives after another finished never pays a second session.
 */
export async function underLock(lockDir, { done, run, pollMs = 15_000, log = () => {} }) {
  for (;;) {
    const have = done();
    if (have) return have;
    let mine = false;
    try { mkdirSync(lockDir); mine = true; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (mine) {
      writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ host: hostname(), pid: process.pid, at: Date.now() }));
      try { return done() ?? await run(); } finally { rmSync(lockDir, { recursive: true, force: true }); }
    }
    let owner = null;
    try { owner = JSON.parse(readFileSync(path.join(lockDir, 'owner.json'), 'utf8')); } catch { /* being written */ }
    let age = 0;
    try { age = Date.now() - (owner?.at ?? statSync(lockDir).mtimeMs); } catch { continue; }
    const dead = owner ? (owner.host === hostname() && !pidAlive(owner.pid)) : age > 120_000;
    if (dead || age > LOCK_MAX_AGE_MS) { log(`reclaiming the stale lock ${path.basename(lockDir)} (${owner ? `pid ${owner.pid}` : 'no owner'}, ${Math.round(age / 60_000)} min)`); rmSync(lockDir, { recursive: true, force: true }); continue; }
    await new Promise(r => setTimeout(r, pollMs));
  }
}

/** A contract owner whose readings persist across processes (resume) and are shared by every stage and worker. */
export class PersistentContractOwner extends ContractOwner {
  constructor(opts) {
    super(opts);
    this.dir = opts.dir ?? path.join(RUNS, 'co');
    mkdirSync(this.dir, { recursive: true });
    this.load();
  }
  load() {
    for (const f of readdirSync(this.dir).filter(x => x.endsWith('.reading.json'))) {
      const r = JSON.parse(readFileSync(path.join(this.dir, f), 'utf8'));
      if (r.kind === 'announced') this.announced.set(r.id, r.rec); else if (r.kind === 'vb') this.vb.set(r.key, r.rec);
    }
  }
  async forAnnounced(id, bundle, atMs) {
    if (this.announced.has(id)) return this.announced.get(id);
    // One C-O session per announced change across parallel workers and restarts.
    const file = path.join(this.dir, `announced-${id}.reading.json`);
    const read = () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).rec : null);
    const rec = await underLock(path.join(this.dir, `announced-${id}.lock`), { done: read, log: this.log, run: async () => {
      const r = await super.forAnnounced(id, bundle, atMs);
      writeFileSync(file, JSON.stringify({ kind: 'announced', id, rec: r }, null, 1));
      return r;
    } });
    this.announced.set(id, rec);
    return rec;
  }
  async vbSessionOf(args) {
    const key = args.stream;
    if (this.vb.has(key)) return { ...this.vb.get(key), fresh: false };
    // The stream's one verifier-blind session, across workers and restarts (review R2-M2: the verifier-blind path had no lock).
    const file = path.join(this.dir, `vb-${key}.reading.json`);
    const read = () => (existsSync(file) ? { ...JSON.parse(readFileSync(file, 'utf8')).rec, fresh: false } : null);
    const rec = await underLock(path.join(this.dir, `vb-${key}.lock`), { done: read, log: this.log, run: async () => {
      const r = await super.vbSessionOf(args);
      const { fresh, ...keep } = r;
      writeFileSync(file, JSON.stringify({ kind: 'vb', key, rec: keep }, null, 1));
      return r;
    } });
    const { fresh, ...keep } = rec;
    this.vb.set(key, keep);
    return rec;
  }
}

/**
 * The ledger scope of this attempt of a lineage-stream (review R2-M4): a stream that an environment fault stopped is re-run
 * as a new attempt with its own scope `<label>#a<n>`, so the faulted attempt's spend stays on the ledger and in the row and
 * total, but never counts against the restarted stream's $1.50 cap. Attempt n's sessions live under sessions/a<n>.
 */
export function attemptOf(dir, label) {
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${label.replace(/[^\w.-]/g, '_')}.attempts`);
  const n = (existsSync(f) ? Number(readFileSync(f, 'utf8')) || 0 : 0) + 1;
  writeFileSync(f, String(n));
  return { n, scope: n === 1 ? label : `${label}#a${n}` };
}

/** The run's sealed bundle (hash-checked against SEALED.json). */
export function loadRunSealed() {
  const meta = JSON.parse(readFileSync(path.join(RES, 'SEALED.json'), 'utf8'));
  if (meta.status !== 'sealed') throw new Error(`DUR1_SEALED: SEALED.json status is ${meta.status}`);
  return loadSealed(meta.file ?? path.join(SEALED_DIR, 'bundle.json'), { sha256: meta.sha256 });
}

/** The P0 rehearsal mini-stream (1207-1208): R1 starts in world 1 (published d2, effective d5) and is carried into world 2. */
export function rehearsalWorlds() {
  const at = (d, h = 0) => T0_MS + (d - 1) * DAY_MS + h * 3_600_000;
  return [
    { stream: 'p0', k: 1, seed: REHEARSAL.miniStream[0], size: 80, difficulty: 3, mix: 'tail', changes: [{ id: 'R1', cls: 'CHG-A', kind: 'rule', startsHere: true, onsetMs: at(5), publishMs: at(2, 9) }] },
    { stream: 'p0', k: 2, seed: REHEARSAL.miniStream[1], size: 80, difficulty: 3, mix: 'tail', changes: [{ id: 'R1', cls: 'CHG-A', kind: 'rule', startsHere: false, onsetMs: T0_MS, effMs: at(5), publishMs: null }] },
  ];
}

const recFile = (dir, label) => path.join(dir, `${label.replace(/[^\w.-]/g, '_')}.stream.json`);
/** P6 over its three solvers. */
export const REFM_USD_PER_SOLVER = 2.0;
/** The ledger's rows. */
const readLedger = f => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

/** Window k from the P0 measurement (prereg §12 row 0: if A-H $/case x 8 x 12 > $19, k = 4). */
export function windowK() {
  const f = path.join(RUNS, 'p0', 'P0.json');
  if (!existsSync(f)) throw new StopError('window k: P0.json is missing (P0 sets k; review B4: a silent default of 6 is refused)');
  const k = JSON.parse(readFileSync(f, 'utf8')).k;
  if (![K_DEFAULT, K_FALLBACK].includes(k)) throw new StopError(`window k: P0.json has k = ${k}`);
  return k;
}

/** One routed window run; returns the window record (agent per-case pass, silent, cost). */
export const WINDOW_ENV_ATTEMPTS = 3;
async function windowRecord({ spec, change, sealed, ex, kind, label, cases = null, k = windowK(), dir, meter, readingsOf = () => BASE_READINGS }) {
  mkdirSync(dir, { recursive: true });
  // Environment-fault restarts are capped (review R2-B4): each faulted attempt re-pays its ticks; after 3 the window is
  // recorded as invalid (prereg §13.2 ENV_FAULT_LIMIT) and excluded from pairing, so the chain moves on.
  const attF = path.join(dir, `${label}.attempts.json`);
  const att = existsSync(attF) ? JSON.parse(readFileSync(attF, 'utf8')) : { envFaults: 0, harness: 0 };
  if (att.envFaults >= WINDOW_ENV_ATTEMPTS) {
    const rec = { label, kind, stream: spec.stream, k: spec.k, change, status: 'invalid-env', envFaults: att.envFaults, cases: [] };
    writeFileSync(path.join(dir, `${label}.window.json`), JSON.stringify(rec, null, 1));
    return rec;
  }
  const b = await buildBundle(spec, { sealed });
  const ref = await referencePools(b);
  const ch = spec.changes.find(c => c.id === change);
  const sel = cases ? { exposed: cases, controls: [] } : selectWindow({ stream: spec.stream, change, exposed: ex.of(spec.k)[change] ?? new Set(), pools: ref.pools, W: b.W, onsetMs: ch.onsetMs, k });
  const ids = [...sel.exposed, ...sel.controls];
  const r = await runWindow({ bundle: b, cases: ids, kind, label, meter });
  if (r.status !== 'complete') {   // never scored, no record written
    if (r.status === 'frozen') {   // the budget meter or an environment fault froze the run at its last commit
      const budget = rowRoom(rowOf(label)) < AGENT[kind].budgetUsdPerTick;
      if (!budget) { att.envFaults += 1; writeFileSync(attF, JSON.stringify(att)); }
      throw Object.assign(new Error(`${budget ? 'DUR1_BUDGET' : 'DUR1_ENV_FAULT'}: window ${label} stopped (${r.status})`), { code: budget ? 'DUR1_BUDGET' : 'DUR1_ENV_FAULT' });
    }
    att.harness += 1; writeFileSync(attF, JSON.stringify(att));
    throw Object.assign(new Error(`DUR1_HARNESS: window ${label} did not complete (${String(r.status).slice(0, 160)})`), { code: 'DUR1_HARNESS' });   // a timeout is a harness error, never an environment fault
  }
  const g = gradeRun(b, r.rows, ref.pools);
  // The agent's journal under the FULL monitor too (m1-m3 with the readings in force at the world's end; review M11): D-5 (d)
  // compares like with like; `silent` keeps the prereg's agent view (m1 only).
  const sig = await signalsOfRun({ bundle: b, rows: r.rows, pools: ref.pools, readings: readingsOf(b) });
  const first = new Map();
  for (const d of Object.values(sig.days)) for (const s of d) if (['m1', 'm2', 'm3'].includes(s.ch) && s.case) { const o = first.get(s.case) ?? {}; if (o[s.ch] === undefined || s.at < o[s.ch]) o[s.ch] = s.at; first.set(s.case, o); }
  const last = lastEffectAt(b, r.rows);
  const cases_ = g.cases.filter(c => ids.includes(c.case)).map(c => {
    const v = { lastAt: last.get(c.case) ?? null, firstAt: c.firstAt ?? null, signals: first.get(c.case) ?? {} };
    return { case: c.case, pass: c.pass ? 1 : 0, critical: c.critical ? 1 : 0, exposed: sel.exposed.includes(c.case), signals: v.signals, lastAt: v.lastAt, firstAt: v.firstAt,
      silent: !c.pass && silent(v, ['m1']) ? 1 : 0, silentFull: !c.pass && silent(v, ['m1', 'm2', 'm3']) ? 1 : 0 };
  });
  const rec = { label, kind, stream: spec.stream, k: spec.k, change, selected: sel, cases: cases_, ticks: r.ticks, costUsd: r.costUsd, sessions: r.sessions, status: r.status, envFaultAttempts: att.envFaults };
  writeFileSync(path.join(dir, `${label}.window.json`), JSON.stringify(rec, null, 1));
  return rec;
}

export async function paidStage(cmd, { opt, flag, list, log, guardPaid, paidSession }) {
  const ROW = { p0: 'P0', heal: 'P3', windows: 'P4', refm: 'P6', redteam: 'P7', forks: 'P9' };
  const fz = await guardPaid(cmd, ROW[cmd]);
  const sealed = cmd === 'p0' ? null : loadRunSealed();
  // C-O: row P2; no room is a BudgetStop the contract owner turns into a quarantine (announced) or a needs-human (VB).
  const coSession = id => paidSession(CO_SESSION, { scope: `co-${id}`, row: 'P2', freeze: fz });
  const co = new PersistentContractOwner({ session: coSession, runDir: path.join(RUNS, 'co'), sealed, log });
  // Heal sessions: freeze and row room checked apart (preflight); the per-lineage-stream cap is the stream's own rule.
  const healSession = (row, scope, conf = HAIKU_PATCH, usdCap = LIMITS.usdPerLineageStream) => (kind) => paidSession(kind === 'opus' ? OPUS_PATCH : conf, { scope, row, freeze: fz, scopeCap: usdCap });
  const lineages = list('lineages', Object.keys(LINEAGES));
  if (cmd === 'p0') {
    const dir = path.join(RUNS, 'p0');
    mkdirSync(dir, { recursive: true });
    const worlds = rehearsalWorlds();
    // P0 rehearses the heal loop and the agent window, not C-O: the analyst's R1 reading stands in ($0), as for K-0.
    const p0co = new ContractOwner({ session: () => stubCO('analyst-R1'), runDir: dir, log });
    // <= 3 Haiku sessions over P0 (counted on the ledger, so a restart cannot re-spend them); a 4th is a BudgetStop the
    // stream records as budget-stop, and P0 still measures k (review B4: the old throw left P0.json unwritten).
    const p0Sessions = () => readLedger(SPEND).filter(l => l.phase === 'start' && /^P0\.MH-H\./.test(l.scope)).length;
    for (const l of ['b1lh-e8-1', 'ch-e8-1']) {
      const label = `P0.MH-H.${l}`;
      if (existsSync(recFile(dir, label))) continue;
      const { scope } = attemptOf(dir, label);
      const mk = healSession('P0', scope);
      await runStream({ arm: 'heal', label, scope, start: programVersion(LINEAGES[l], { id: l }), worlds, heal: { session: kind => { if (p0Sessions() >= 3) throw new BudgetStop('P0: <= 3 Haiku sessions', 'row'); return mk(kind); } }, co: p0co, runDir: dir, log, spendFile: SPEND });
    }
    const wSpec = { stream: 'p0', k: 1, seed: REHEARSAL.agentWindow, size: 80, difficulty: 3, mix: 'tail', changes: [{ id: 'R1', cls: 'CHG-A', kind: 'rule', startsHere: true, onsetMs: T0_MS + 4 * DAY_MS, effMs: T0_MS + 4 * DAY_MS, publishMs: T0_MS + DAY_MS + 9 * 3_600_000 }] };
    const ex = await streamExposure([wSpec]);
    let w = null, why = null;
    try { w = await windowRecord({ spec: wSpec, change: 'R1', sealed: null, ex, kind: 'A-H', label: 'P0.A-H.R1', k: 2, dir, meter: ledgerMeter({ scope: 'P0.A-H', row: 'P0' }), readingsOf: b => readingsFor(b, dayStart(HORIZON_DAYS + 1), { co: p0co }) }); }
    catch (e) { if (e?.code !== 'DUR1_BUDGET') throw e; why = e.message; }
    const perCase = w?.cases?.length ? w.costUsd / w.cases.length : null;
    // Unmeasured (P0 out of room): the budget-safe k = 4, disclosed.
    const k = perCase === null ? K_FALLBACK : perCase * 8 * 12 > 19 ? K_FALLBACK : K_DEFAULT;
    writeFileSync(path.join(dir, 'P0.json'), JSON.stringify({ agentUsdPerCase: perCase, k, measured: perCase !== null, why, rule: 'prereg §12 P0: if A-H $/case x 8 x 12 > $19 then k = 4 (unmeasured: k = 4)', window: w ? { cases: w.cases.length, costUsd: w.costUsd } : null }, null, 1));
    log(`P0: A-H $/case ${perCase?.toFixed(3) ?? 'not measured'}; k = ${k}`);
    return;
  }
  if (cmd === 'heal') {
    const streams = list('streams', ['s1', 's2']);
    for (const s of streams) {
      if (s === 's3') {
        const s1 = Object.entries(spendOf(SPEND).byScope).filter(([sc]) => /^MH-H\.[^.]+\.s1(#a\d+)?$/.test(sc)).reduce((a, [, v]) => a + v, 0);
        if (s1 > 8) { log(`K-4: MH-H spent $${s1.toFixed(2)} on s1 (> $8): s3 is dropped for MH-H and A-H; D-3 is directional`); writeFileSync(path.join(RUNS, 'K4.json'), JSON.stringify({ fired: true, s1Usd: s1 })); return; }
      }
      const dir = path.join(RUNS, 'heal', s);
      const worlds = worldsOf(s, { sealedOnsets: sealed.onsets() });
      for (const l of lineages) {
        const label = `MH-H.${l}.${s}`;
        if (existsSync(recFile(dir, label))) { log(`${label}: record exists, skipped`); continue; }
        const { scope, n } = attemptOf(dir, label);
        await runStream({ arm: 'heal', label, scope, start: programVersion(LINEAGES[l], { id: l }), worlds, sealed, heal: { session: healSession(s === 's3' ? 'P5' : 'P3', scope) }, co, runDir: path.join(dir, n === 1 ? '' : `a${n}`), recordDir: dir, log, spendFile: SPEND });
      }
    }
    return;
  }
  if (cmd === 'windows') {
    const kind = opt('kind', 'A-H');
    const streams = list('streams', ['s1', 's2']);
    if (kind === 'A-Ox') {
      // A-Ox: R2s-s1 #1, E2s-s1 #1, R2s-s1 #2, ... up to 6 cases; before each case stop if 1.5 x mean $/case > P8 room.
      const worlds = worldsOf('s1', { sealedOnsets: sealed.onsets() });
      const ex = await streamExposure(worlds, { sealed });
      const sel = {};
      for (const c of ['R2s', 'E2s']) {
        const spec = worlds.find(w => w.changes.some(x => x.id === c && x.startsHere));
        const b = await buildBundle(spec, { sealed }); const ref = await referencePools(b);
        sel[c] = { spec, cases: selectWindow({ stream: 's1', change: c, exposed: ex.of(spec.k)[c] ?? new Set(), pools: ref.pools, W: b.W, onsetMs: spec.changes.find(x => x.id === c).onsetMs, k: 3 }).exposed };
      }
      const order = [0, 1, 2].flatMap(i => ['R2s', 'E2s'].map(c => [c, sel[c].cases[i]])).filter(([, x]) => x);
      const costs = [];
      for (const [c, x] of order) {
        const label = `A-Ox.s1.${c}.${x}`;
        if (existsSync(path.join(RUNS, 'aox', `${label}.window.json`))) continue;
        const mean = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : AGENT['A-Ox'].budgetUsdPerTick;
        if (1.5 * mean > rowRoom('P8')) { log(`A-Ox stop rule: 1.5 x $${mean.toFixed(2)} > P8 room $${rowRoom('P8').toFixed(2)}`); break; }
        const w = await windowRecord({ spec: sel[c].spec, change: c, sealed, ex, kind: 'A-Ox', label, cases: [x], dir: path.join(RUNS, 'aox'), meter: ledgerMeter({ scope: label, row: 'P8' }), readingsOf: b => readingsFor(b, dayStart(HORIZON_DAYS + 1), { co }) });
        costs.push(w.costUsd);
      }
      return;
    }
    for (const s of streams) {
      if (s === 's3' && existsSync(path.join(RUNS, 'K4.json'))) { log('K-4 fired: no s3 windows (D-3 directional)'); continue; }
      const worlds = worldsOf(s, { sealedOnsets: sealed.onsets() });
      const ex = await streamExposure(worlds, { sealed });
      const row = s === 's3' ? 'P5' : 'P4';
      for (const c of WINDOW_CHANGES) {
        const spec = worlds.find(w => w.changes.some(x => x.id === c && x.startsHere));
        for (const rep of s === 's1' && c === 'R2s' ? ['', '.rep'] : ['']) {
          const label = `A-H.${s}.${c}${rep}`;
          if (existsSync(path.join(RUNS, 'windows', `${label}.window.json`))) { log(`${label}: exists, skipped`); continue; }
          await windowRecord({ spec, change: c, sealed, ex, kind: 'A-H', label, dir: path.join(RUNS, 'windows'), meter: ledgerMeter({ scope: label, row }), readingsOf: b => readingsFor(b, dayStart(HORIZON_DAYS + 1), { co }) });
        }
      }
    }
    return;
  }
  if (cmd === 'refm') {
    const dir = path.join(RUNS, 'refm');
    const worlds = worldsOf('s1', { sealedOnsets: sealed.onsets() });
    for (const sv of Object.keys(REF_SOLVERS)) {
      const label = `REF-M.${sv}.s1`;
      if (existsSync(recFile(dir, label))) continue;
      const { scope, n } = attemptOf(dir, label);
      // REF-M's cap per solver-stream is P6's cap over the three solvers ($2.00; review B4: it inherited MH-H's $1.50 and
      // its $1.00 Opus sessions threw at the second session).
      const usdCap = REFM_USD_PER_SOLVER;
      await runStream({ arm: 'heal', label, scope, usdCap, start: programVersion(REF_SOLVERS[sv], { id: sv }), worlds, sealed, heal: { session: healSession('P6', scope, OPUS_PATCH, usdCap) }, co, runDir: path.join(dir, n === 1 ? '' : `a${n}`), recordDir: dir, log, spendFile: SPEND });
    }
    return;
  }
  if (cmd === 'redteam') {
    const dir = path.join(RUNS, 'redteam');
    const targets = [['RT-O1', 'b1lh-e8-1', 'opus'], ['RT-O2', 'ch-e8-1', 'opus'], ['RT-H', 'b1lh-e8-1', 'haiku']];
    for (const [id, t, kind] of targets) {
      if (existsSync(path.join(dir, `${id}.record.json`))) continue;
      const conf = RT_SESSIONS[kind];
      const version = programVersion(LINEAGES[t], { id: t });
      let r;
      try { r = await redTeamSession({ id, targetId: t, version, session: paidSession(conf, { scope: `J2.${id}`, row: 'P7', freeze: fz }), runDir: dir, sealed, log }); }
      catch (e) { if (!(e instanceof BudgetStop)) throw e; log(`${id}: ${e.message}`); writeFileSync(path.join(dir, `${id}.budget-stop.json`), JSON.stringify({ id, why: e.message })); continue; }
      // D-11: the most silent failing cases of a valid red-team world on its target, against blind search with the same 25 probes.
      let best = 0;
      for (const v of r.validated.filter(x => x.valid)) best = Math.max(best, (await evaluate(t, version, v.vector, { sealed })).silent ?? 0);
      const blind = kind === 'opus' ? await blindBaseline({ targetId: t, version, sealed, log }) : null;
      writeFileSync(path.join(dir, `${id}.best.json`), JSON.stringify({ id, target: t, kind, best, blindBest: blind ? Math.max(0, ...blind.evaluated.map(e => e.silent ?? 0)) : null, blindUsed: blind?.used ?? null }, null, 1));
    }
    return;
  }
  if (cmd === 'forks') {
    const dir = path.join(RUNS, 'forks');
    // MH-stale: s1 from W3 with MH-H's W3 starting version; no C-O at R1 and no verifier-blind C-O.
    const worlds = worldsOf('s1', { sealedOnsets: sealed.onsets() });
    for (const l of lineages) {
      const label = `MH-stale.${l}.s1`;
      if (existsSync(recFile(dir, label))) continue;
      const hf = recFile(path.join(RUNS, 'heal', 's1'), `MH-H.${l}.s1`);
      if (!existsSync(hf)) { log(`${label}: MH-H s1 record missing; skipped`); continue; }
      const rec = JSON.parse(readFileSync(hf, 'utf8'));
      const w3 = rec.worlds.find(w => w.k === 3);
      const startDigest = w3?.timeline?.[0]?.digest ?? rec.start.digest;
      const v = rec.versions.find(x => x.digest === startDigest);
      const start = v?.spec ? await versionOfSpec(v.spec, { id: v.id }) : programVersion(LINEAGES[l], { id: l });
      const { scope, n } = attemptOf(dir, label);
      await runStream({ arm: 'heal', label, scope, start, worlds: worlds.filter(w => w.k >= 3), sealed, heal: { session: healSession('P9', scope), stale: ['R1', 'vb'] }, co, runDir: path.join(dir, n === 1 ? '' : `a${n}`), recordDir: dir, log, spendFile: SPEND, regressionW1: worlds[0] });
    }
    for (const id of LATENT) {
      if (existsSync(path.join(dir, `LD-H.${id}.analysis.json`))) continue;
      const { scope } = attemptOf(dir, `LD-H.${id}`);
      await runLD({ id, heal: { session: healSession('P9', scope) }, co, runDir: dir, log, spendFile: SPEND, streamOpts: { scope } });
    }
    // MH-H->O (B-tier, last): s1 re-run with one Opus xhigh patch after two rejected Haiku sessions on an incident, for the
    // lineages whose MH-H s1 record left an incident at needs-human (the fork point is the stream start: disclosed).
    for (const l of lineages) {
      const label = `MH-HO.${l}.s1`;
      if (existsSync(recFile(dir, label))) continue;
      const hf = recFile(path.join(RUNS, 'heal', 's1'), `MH-H.${l}.s1`);
      if (!existsSync(hf) || !JSON.parse(readFileSync(hf, 'utf8')).incidents.some(i => i.status === 'needs-human')) continue;
      if (rowRoom('P9') < OPUS_PATCH.budgetUsd) { log(`${label}: P9 has no room for an Opus patch`); break; }
      const { scope, n } = attemptOf(dir, label);
      const usdCap = LIMITS.usdPerLineageStream + OPUS_PATCH.budgetUsd;   // the Haiku cap plus the one Opus patch
      await runStream({ arm: 'heal', label, scope, usdCap, start: programVersion(LINEAGES[l], { id: l }), worlds, sealed, heal: { session: healSession('P9', scope, HAIKU_PATCH, usdCap), opusAfter: true }, co, runDir: path.join(dir, n === 1 ? '' : `a${n}`), recordDir: dir, log, spendFile: SPEND });
    }
    return;
  }
  throw new Error(`unknown paid stage ${cmd}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// $0 stages that read the paid records: WC-1 passes and the analysis.

/**
 * The readings in force at stream end for a knob-vector world (review mi2): the base contracts plus every certified
 * announced reading (runs/co), each from its overlay's effective time in that world (W.truth.dur1Eff); a world without the
 * overlay keeps the base reading.
 */
export function endReadings(sealed) {
  const co = new PersistentContractOwner({ session: () => { throw new Error('DUR1: no C-O session at $0'); }, runDir: path.join(RUNS, 'co'), sealed });
  return b => {
    let rs = [...BASE_READINGS];
    for (const id of ['R1', 'R2s']) {
      const a = co.announced.get(id), eff = b?.W?.truth?.dur1Eff?.[id];
      if (a?.status === 'certified' && eff !== undefined) rs = withReading(rs, mkReading({ id, fromMs: eff, rules: a.reading.rules, module: a.reading.module, base: rs }));
    }
    return rs;
  };
}

/**
 * WC-1 pass ($0, prereg §8.2). when 't0': the starting versions of the nine lineages and S1-S3; 'end': each MH-H
 * lineage-stream's final version and REF-M's finals. Budget 400 per group-A target, 150 per group-B target; top 10
 * re-drawn on 5 fresh salts; confirmed vectors found on group A are run on group B and vice versa (transfer). Resumes per
 * target (a file per target). Returns { targets: { [id]: { used, ht, cvar10, confirmed } }, transfer }.
 */
export async function wc1Stage({ when = 't0', log = () => {}, sealed = undefined, budgets = BUDGET, only = null, poolSize = 400, maxSize = 200, salts = undefined } = {}) {
  const sl = sealed === undefined ? loadRunSealed() : sealed;
  const dir = path.join(RUNS, `wc1-${when}`);
  mkdirSync(dir, { recursive: true });
  const targets = [];
  if (when === 't0') {
    for (const [id, spec] of Object.entries(LINEAGES)) targets.push({ id, group: GROUP_A.includes(id) ? 'A' : 'B', version: programVersion(spec, { id }) });
    for (const [id, spec] of Object.entries(REF_SOLVERS)) targets.push({ id, group: GROUP_A.includes(id) ? 'A' : 'B', version: programVersion(spec, { id }) });
  } else {
    for (const rec of [...readRecords(path.join(RUNS, 'heal')), ...readRecords(path.join(RUNS, 'refm'))]) {
      const unit = rec.label.split('.')[1];
      const v = (await versionsOf(rec)).get(rec.final.digest);
      if (v) targets.push({ id: `${rec.label}.final`, group: GROUP_A.includes(unit) ? 'A' : 'B', version: v });
    }
  }
  const out = { when, targets: {}, transfer: [] };
  for (const t of targets.filter(x => !only || only.includes(x.id))) {
    const f = path.join(dir, `${t.id}.json`);
    if (existsSync(f)) { out.targets[t.id] = JSON.parse(readFileSync(f, 'utf8')); continue; }
    // The end pass judges with the readings in force at stream end and samples the sealed overlays too (§8.2; review mi2).
    const readings = when === 'end' && sl ? endReadings(sl) : BASE_READINGS;
    const s = await search({ targetId: t.id, version: t.version, budget: t.group === 'A' ? budgets.groupA : budgets.groupB, sealed: sl, poolSize, maxSize, log, readings, sealedOverlays: when === 'end' && !!sl });
    const c = await confirm({ targetId: t.id, version: t.version, top: s.top, sealed: sl, readings, ...(salts ? { salts } : {}) });
    const rec = { id: t.id, group: t.group, used: s.used, budget: s.budget, ht: s.ht, cvar10: s.cvar10, bedFindings: s.bedFindings.length, top: s.top.map(x => ({ key: x.key, vector: x.vector, score: x.score, silent: x.silent, silentCritical: x.silentCritical, classes: x.classes })), confirmed: c };
    writeFileSync(f, JSON.stringify(rec, null, 1));
    out.targets[t.id] = rec;
  }
  // Transfer (selection-bias guard): confirmed vectors of group A on group B targets and vice versa.
  const conf = g => Object.values(out.targets).filter(x => x.group === g).flatMap(x => x.confirmed.filter(c => c.confirmed).map(c => ({ from: x.id, vector: c.vector })));
  for (const t of targets.filter(x => !only || only.includes(x.id))) for (const c of conf(t.group === 'A' ? 'B' : 'A')) {
    const e = await evaluate(t.id, t.version, c.vector, { sealed: sl, readings: when === 'end' && sl ? endReadings(sl) : BASE_READINGS });
    out.transfer.push({ target: t.id, from: c.from, key: e.key, valid: e.valid, failing: e.failing, silent: e.silent, silentCritical: e.silentCritical });
  }
  writeFileSync(path.join(dir, 'TRANSFER.json'), JSON.stringify(out.transfer, null, 1));
  return out;
}

/**
 * ADV-SET (prereg §8.3): the confirmed worlds of the t0 WC-1 pass and the valid J2 worlds, frozen when P7 ends, cross-run
 * at $0 on every code arm at t0 and at stream end. Returns { set, cross: [{ arm, target, key, n, failing, silent, silentCritical }] }.
 */
export async function advSetStage({ log = () => {}, sealed = undefined } = {}) {
  const sl = sealed === undefined ? loadRunSealed() : sealed;
  const set = [];
  const wdir = path.join(RUNS, 'wc1-t0');
  if (existsSync(wdir)) for (const f of readdirSync(wdir).filter(x => x.endsWith('.json') && x !== 'TRANSFER.json')) for (const c of JSON.parse(readFileSync(path.join(wdir, f), 'utf8')).confirmed) if (c.confirmed) set.push({ source: `wc1:${f.slice(0, -5)}`, vector: c.vector });
  const rdir = path.join(RUNS, 'redteam');
  if (existsSync(rdir)) for (const f of readdirSync(rdir).filter(x => x.endsWith('.record.json'))) for (const v of JSON.parse(readFileSync(path.join(rdir, f), 'utf8')).validated ?? []) if (v.valid) set.push({ source: `j2:${f.split('.')[0]}`, vector: v.vector });
  const file = path.join(RUNS, 'ADV-SET.json');
  if (!existsSync(file)) writeFileSync(file, JSON.stringify({ frozenAt: new Date().toISOString(), set }, null, 1));
  const frozen = JSON.parse(readFileSync(file, 'utf8')).set;
  const cross = [];
  const arms = [...Object.entries(LINEAGES).map(([id, s]) => ['S-H*', id, programVersion(s, { id })]), ...Object.entries(REF_SOLVERS).map(([id, s]) => ['REF-S', id, programVersion(s, { id })])];
  for (const rec of readRecords(path.join(RUNS, 'heal'))) { const v = (await versionsOf(rec)).get(rec.final.digest); if (v) arms.push(['MH-H.final', rec.label, v]); }
  // Every arm on the same worlds under the same readings (those in force at stream end; review mi2 / M7: like for like).
  const rsEnd = sl ? endReadings(sl) : BASE_READINGS;
  for (const [arm, id, v] of arms) for (const w of frozen) {
    const e = await evaluate(`adv-${id}`, v, w.vector, { sealed: sl, readings: rsEnd });
    cross.push({ arm, target: id, source: w.source, world: JSON.stringify(w.vector), vector: w.vector, key: e.key, valid: e.valid, n: e.n, failing: e.failing, silent: e.silent, silentCritical: e.silentCritical });
  }
  writeFileSync(path.join(RUNS, 'ADV-CROSS.json'), JSON.stringify(cross, null, 1));
  log(`ADV-SET: ${frozen.length} worlds x ${arms.length} arm units`);
  return { set: frozen, cross };
}

/** The report's adv (D-5 b) and redTeam (D-11) inputs from the run directory (null when those stages did not run). */
function redAndAdv() {
  const cf = path.join(RUNS, 'ADV-CROSS.json');
  const cross = existsSync(cf) ? JSON.parse(readFileSync(cf, 'utf8')) : [];
  const rdir = path.join(RUNS, 'redteam');
  const best = existsSync(rdir) ? readdirSync(rdir).filter(f => f.endsWith('.best.json')).map(f => JSON.parse(readFileSync(path.join(rdir, f), 'utf8'))) : [];
  const { adv } = advInputs(cross);
  const redTeam = best.filter(b => b.kind === 'opus').map(b => ({ target: `${b.id}:${b.target}`, redTeamBest: b.best, blindBest: b.blindBest ?? 0 }));
  return { adv, redTeam: redTeam.length ? redTeam : null };
}

/**
 * The A-H red-team windows of P7 (prereg §7): on the two top valid ADV-SET worlds (ranked by the S-H* t0 versions' silent
 * failing cases, median lineage; ties to the lowest salt), the <= 8 cases the median lineage fails, routed to A-H. This
 * favours the agent ("is the agent also broken where we are worst?"), declared. Descriptive.
 */
export async function rtWindowsStage({ log = () => {}, meterOf = label => ledgerMeter({ scope: label, row: 'P7' }), runner = null, sealed = undefined } = {}) {
  const sl = sealed === undefined ? loadRunSealed() : sealed;
  const cross = JSON.parse(readFileSync(path.join(RUNS, 'ADV-CROSS.json'), 'utf8')).filter(x => x.arm === 'S-H*' && x.valid);
  const byWorld = new Map();
  for (const x of cross) { if (!byWorld.has(x.world)) byWorld.set(x.world, []); byWorld.get(x.world).push(x); }
  const ranked = [...byWorld.entries()].map(([key, rows0]) => {
    const rows = [...rows0].sort((a, b) => a.silent - b.silent || (a.target < b.target ? -1 : 1));
    return { key, med: rows[Math.floor((rows.length - 1) / 2)], vector: rows[0].vector };
  }).sort((a, b) => b.med.silent - a.med.silent || a.vector.salt - b.vector.salt).slice(0, 2);
  const { vectorBundle } = await import('./knobs.mjs');
  const out = [];
  for (const [i, r] of ranked.entries()) {
    const label = `A-H-RT.${i + 1}`;
    const f = path.join(RUNS, 'rtwindows', `${label}.window.json`);
    if (existsSync(f)) { out.push(JSON.parse(readFileSync(f, 'utf8'))); continue; }
    const b = await vectorBundle(`rtw-${r.med.target}`, r.vector, { sealed: sl });
    const ref = await referencePools(b);
    const median = await runBundle(b, { version: programVersion(LINEAGES[r.med.target], { id: r.med.target }) });
    const gm = gradeRun(b, median.rows, ref.pools);
    const cases = gm.cases.filter(c => c.graded && !c.pass).map(c => c.case).sort().slice(0, 8);
    if (!cases.length) { log(`${label}: the median lineage fails no case of ${r.key}`); continue; }
    const w = await runWindow({ bundle: b, cases, kind: 'A-H', label, meter: meterOf(label), ...(runner ? { runner } : {}) });
    if (w.status !== 'complete') throw Object.assign(new Error(`DUR1_ENV_FAULT: ${label} stopped (${w.status})`), { code: rowRoom('P7') < AGENT['A-H'].budgetUsdPerTick ? 'DUR1_BUDGET' : 'DUR1_ENV_FAULT' });
    const g = gradeRun(b, w.rows, ref.pools);
    const rec = { label, world: r.key, medianLineage: r.med.target, cases, agentPass: g.cases.filter(c => cases.includes(c.case) && c.pass).length, n: cases.length, costUsd: w.costUsd };
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify(rec, null, 1));
    out.push(rec);
  }
  return out;
}

/**
 * D-5 (b) and D-11 inputs from the ADV cross-run and the red-team records. (b) is judged PER WORLD (review M7): on each valid
 * ADV-SET world, the MH-H finals' maximum silent failing cases against REF-S's maximum on the same world (one vector is one
 * world for every arm since the B1 fix in knobs.mjs).
 */
export function advInputs(cross, redRecords = [], blind = {}) {
  const heal = cross.filter(x => x.arm === 'MH-H.final' && x.valid), refs = cross.filter(x => x.arm === 'REF-S' && x.valid);
  const maxBy = (rows, k) => rows.reduce((m, r) => Math.max(m, r[k] ?? 0), 0);
  const worldsH = [...new Set(heal.map(r => r.world))];
  const perWorld = worldsH.map(w => { const h = heal.filter(r => r.world === w), rf = refs.filter(r => r.world === w); return { world: h[0]?.key ?? w, healMax: maxBy(h, 'silent'), refsMax: rf.length ? maxBy(rf, 'silent') : null, n: Math.max(0, ...h.map(r => r.n ?? 0)) }; })
    .map(x => ({ ...x, refsMax: x.refsMax ?? 0, refMissing: x.refsMax === null }));
  const adv = heal.length ? { silentCritical: heal.reduce((a, r) => a + (r.silentCritical ?? 0), 0), perWorld, maxSilentPerWorld: maxBy(heal, 'silent'), refsMax: maxBy(refs, 'silent'), n: Math.max(0, ...heal.map(r => r.n ?? 0)) } : null;
  const redTeam = redRecords.filter(r => r.kind === 'opus').map(r => ({ target: r.target, redTeamBest: r.best, blindBest: blind[r.id] ?? 0 }));
  return { adv, redTeam };
}

/** Rebuild a record's version map (programs from their kept specs; rule versions from their digests; c-oss). */
export async function versionsOf(rec) {
  const m = new Map();
  for (const v of rec.versions ?? []) {
    if (v.spec) m.set(v.digest, Object.freeze({ ...(await versionOfSpec(v.spec, { id: v.id })), digest: v.digest }));
    else if (String(v.digest).startsWith('rule-')) { const ids = v.digest.slice(5) === 'base' ? [] : v.digest.slice(5).split('+'); m.set(v.digest, ruleVersion(ids, { label: v.id })); }
    else if (v.digest === 'control-c-oss') m.set(v.digest, Object.freeze({ ...controlVersion('c-oss'), digest: v.digest }));
  }
  return m;
}

/**
 * Arm and unit of a record label (review R2-M6): `<arm>.<unit>.<stream>` for lineage and solver arms; single-unit arms
 * (`R-static.s1`, `R-maint2.s1`, `R-ceil.s1`, `c-oss.s1`) are the unit 'ref' (they were filed under the stream id, so D-4
 * read NOT RUN). Attempt suffixes never reach a label.
 */
export function unitOfLabel(label) {
  const parts = String(label).split('.');
  const arm = parts[0] === 'S-Hstar' ? 'S-H*' : parts[0];
  return parts.length >= 3 ? { arm, unit: parts[1] } : { arm, unit: 'ref' };
}

/** FH-1's build + commissioning $ per lineage: 8 programs built for $8.25 and healed for $1.14 (RESULT-FH1.md:343). */
export const FH1_ALLIN_USD_PER_LINEAGE = (8.25 + 1.14) / 8;

/**
 * m6 (prereg §6.1, §10 D-6; review M13: it was never computed in the real analysis). Arm-neutral: the input profile reads
 * inbound messages and documents, so each stream is scored on the reference's journals of its worlds, W1 to W6 in order,
 * against the frozen calibration of practice 1235-1237. Per onset: the share of its exposed cases novel to the frozen
 * profile (score > 0) and the delay in exposed cases from the onset to the first alarm; per stream: W1's alarms.
 */
export async function m6Analysis({ worlds, exposure, sealed, log = () => {}, practice = PRACTICE }) {
  const cal0 = [];
  for (const p of practice) { const b = await evidenceBundle(p, { rules: [], editions: [], renames: [] }, { sealed }); const ref = await referencePools(b, { keepRows: true }); cal0.push({ rows: ref.rows.earliest, world: b.W }); }
  const cal = calibrate(cal0);
  const onsets = [], w1Alarms = {};
  for (const [st, specs] of Object.entries(worlds)) {
    const tasks = [];
    for (const spec of specs) {
      const b = await buildBundle(spec, { sealed });
      const ref = await referencePools(b, { keepRows: true });
      const caseOfInst = new Map();
      for (const r of ref.rows.earliest) if (r.type === 'deliver' && r.instance && r.event?.id && !caseOfInst.has(r.instance)) { const c = b.W.truth.eventCase?.[r.event.id]; if (c) caseOfInst.set(r.instance, c); }
      tasks.push(...instanceTasks(ref.rows.earliest, b.W).map(t => ({ ...t, world: spec.k, case: caseOfInst.get(t.instance) ?? null })));
    }
    const det = runDetector(cal, tasks);
    w1Alarms[st] = det.alarms.filter(a => a.world === 1).length;
    const trace = det.trace.map((t, i) => ({ ...t, case: tasks[i].case }));
    for (const spec of specs) for (const ch of spec.changes.filter(c => c.startsHere && c.onsetMs !== null)) {
      const ex = exposure[st].of(spec.k)?.[ch.id] ?? new Set();
      const after = trace.filter(t => t.world === spec.k && t.at >= ch.onsetMs && t.case && ex.has(t.case));
      if (!after.length) continue;
      const novel = after.filter(t => t.score > 0).length / after.length;
      const alarmIdx = trace.findIndex(t => t.alarm && (t.world > spec.k || (t.world === spec.k && t.at >= ch.onsetMs)));
      const delayCases = alarmIdx < 0 ? null : trace.slice(0, alarmIdx + 1).filter(t => t.world === spec.k && t.at >= ch.onsetMs && t.case && ex.has(t.case)).length;
      onsets.push({ stream: st, change: ch.id, world: spec.k, novelShare: novel, delayCases, exposed: after.length });
    }
    log(`m6 ${st}: ${det.alarms.length} alarms (W1 ${w1Alarms[st]})`);
  }
  return { onsets, w1Alarms, calibration: cal.n };
}

const readRecords = dir => (existsSync(dir) ? readdirSync(dir, { recursive: true }).filter(f => String(f).endsWith('.stream.json')).map(f => JSON.parse(readFileSync(path.join(dir, String(f)), 'utf8'))) : []);

/** The analysis of the real run (prereg §9-§10, §14): reads every record under runs/, writes REPORT.json. */
export async function analyzeRuns({ log = () => {} } = {}) {
  const sealed = loadRunSealed();
  const worlds = Object.fromEntries(STREAM_IDS.map(s => [s, worldsOf(s, { sealedOnsets: sealed.onsets() })]));
  const exposure = {};
  for (const s of STREAM_IDS) exposure[s] = await streamExposure(worlds[s], { sealed });
  const arms = {}, certs = {}, records = { 'MH-H': {}, 'REF-M': {} }, invalid = [];
  const put = (arm, unit, stream, m) => { ((arms[arm] ??= {})[unit] ??= {})[stream] = m; };
  for (const rec of [...readRecords(path.join(RUNS, 'stagez')), ...readRecords(path.join(RUNS, 'heal')), ...readRecords(path.join(RUNS, 'refm')), ...readRecords(path.join(RUNS, 'forks'))]) {
    const { arm: armName, unit } = unitOfLabel(rec.label);
    if (!worlds[rec.stream]) continue;
    // ENV_FAULT_LIMIT (prereg §13.2; review R2-M4): an arm unit with > 25% of its sessions impaired by environment faults is invalid.
    if (envInvalid(rec.envFaults ?? 0, (rec.sessions?.length ?? 0))) { invalid.push({ label: rec.label, envFaults: rec.envFaults, sessions: rec.sessions?.length ?? 0, why: 'ENV_FAULT_LIMIT' }); log(`${rec.label}: invalid (environment faults)`); continue; }
    rec.versionMap = await versionsOf(rec);
    const needsAttr = ['S-H*', 'MH-H', 'REF-M', 'REF-S'].includes(armName);
    const at = needsAttr ? await attributeRecord({ rec, worlds: worlds[rec.stream], ex: exposure[rec.stream], sealed }) : null;
    put(armName, unit, rec.stream, modelOf(rec, at, exposure[rec.stream].of));
    if (armName === 'MH-H') { (records['MH-H'][unit] ??= {})[rec.stream] = rec; (certs[unit] ??= {})[rec.stream] = await certifyRecord({ rec, worlds: worlds[rec.stream], sealed, attribution: at, exposure: exposure[rec.stream].of }); }
    if (armName === 'REF-M') (records['REF-M'][unit] ??= {})[rec.stream] = rec;
    log(`analysed ${rec.label}`);
  }
  // Windows: pairs of MH-H's outcome (from its stream record) and A-H's routed outcome on the same case.
  const pairs = [];
  const wdir = path.join(RUNS, 'windows');
  let agentUsd = 0, agentCases = 0;
  if (existsSync(wdir)) for (const f of readdirSync(wdir).filter(x => x.endsWith('.window.json') && !x.includes('.rep.'))) {
    const w = JSON.parse(readFileSync(path.join(wdir, f), 'utf8'));
    if (w.status !== 'complete') { invalid.push({ label: w.label, why: w.status }); continue; }   // invalid-env windows are excluded from pairing
    agentUsd += w.costUsd; agentCases += w.cases.length;
    for (const [l, by] of Object.entries(records['MH-H'])) {
      const g = by[w.stream]?.worlds.find(x => x.k === w.k)?.grade ?? {};
      const hm = arms['MH-H']?.[l]?.[w.stream]?.worlds?.[w.k]?.cases ?? {};
      // The same silent rule on both sides (review M10): last effect + 1 world-day; MH-H sees m1-m3 and m5.
      // D-5 (d) like for like (review M11): both sides under m1-m3 (the full monitor without complaints) and under m1 only.
      for (const c of w.cases) if (g[c.case]) {
        const hs = chs => (g[c.case][0] ? 0 : (hm[c.case] && silent(hm[c.case], chs) ? 1 : 0));
        pairs.push({ lineage: l, window: `${w.stream}-${w.change}`, case: c.case, heal: g[c.case][0], agent: c.pass,
          healSilent: hs(VISIBLE.heal), agentSilent: c.silent, healSilentFull: hs(VISIBLE.healNoComplaints), agentSilentFull: c.silentFull ?? null, healSilentM1: hs(['m1']), agentSilentM1: c.silent });
      }
    }
  }
  const perCase = agentCases ? agentUsd / agentCases : null;
  const agentProjected = perCase === null ? null : Object.fromEntries(STREAM_IDS.map(s => [s, perCase * (arms['S-H*'] ? Object.values(Object.values(arms['S-H*'])[0]?.[s]?.worlds ?? {}).reduce((a, w) => a + Object.keys(w.cases).length, 0) : 0)]));
  const ld = existsSync(path.join(RUNS, 'forks')) ? readdirSync(path.join(RUNS, 'forks')).filter(f => f.endsWith('.analysis.json')).map(f => JSON.parse(readFileSync(path.join(RUNS, 'forks', f), 'utf8'))) : null;
  const ledger = spendOf(SPEND).byScope;
  const coUsd = {};
  for (const [sc, v] of Object.entries(ledger)) if (sc.startsWith('co-')) { const id = sc.slice(3).split('-a')[0]; coUsd[id] = (coUsd[id] ?? 0) + v; }
  // Marginal $ per MH-H lineage-stream from the LEDGER (every attempt, env-faulted ones included) plus its share of C-O $
  // (announced: over every MH-H and REF-M lineage-stream; verifier-blind: over the stream's lineage-streams). Review M15.
  const lsAll = [...Object.entries(records['MH-H']), ...Object.entries(records['REF-M'])].flatMap(([u, b]) => Object.keys(b).map(st => ({ u, st })));
  const announcedCo = Object.entries(coUsd).filter(([id]) => !id.startsWith('vb:')).reduce((a, [, v]) => a + v, 0);
  const scopeUsd = label => Object.entries(ledger).filter(([sc]) => sc === label || sc.startsWith(`${label}#a`)).reduce((a, [, v]) => a + v, 0);
  const healMarginal = Object.entries(records['MH-H']).flatMap(([l, b]) => Object.keys(b).map(st => ({ lineage: l, stream: st,
    usd: scopeUsd(`MH-H.${l}.${st}`) + announcedCo / Math.max(1, lsAll.length) + (coUsd[`vb:${st}`] ?? 0) / Math.max(1, lsAll.filter(x => x.st === st).length), source: 'ledger + C-O share' })));
  // D-7 (review M17): the A-Ox cases against MH-H on the same cases (s1), all-in $/case.
  const aoxDir = path.join(RUNS, 'aox');
  const aoxW = existsSync(aoxDir) ? readdirSync(aoxDir).filter(f => f.endsWith('.window.json')).map(f => JSON.parse(readFileSync(path.join(aoxDir, f), 'utf8'))).filter(w => w.status === 'complete') : [];
  let aox = null;
  if (aoxW.length && Object.keys(records['MH-H']).length) {
    const cs = aoxW.flatMap(w => w.cases.map(c => ({ ...c, k: w.k, stream: w.stream })));
    const healOn = cs.map(c => { const xs = Object.values(records['MH-H']).map(b => b[c.stream]?.worlds.find(x => x.k === c.k)?.grade?.[c.case]?.[0]).filter(x => x === 0 || x === 1); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }).filter(x => x !== null);
    const allIn = Object.entries(records['MH-H']).map(([l, b]) => {
      let usd = FH1_ALLIN_USD_PER_LINEAGE, n = 0;
      for (const [st, rec] of Object.entries(b)) { usd += healMarginal.find(x => x.lineage === l && x.stream === st)?.usd ?? 0; for (const w of rec.worlds) n += Object.keys(w.grade ?? {}).length; }
      return n ? usd / n : null;
    }).filter(x => x !== null).sort((a, b) => a - b);
    aox = { n: cs.length, aoxRate: cs.reduce((a, c) => a + c.pass, 0) / cs.length, healRate: healOn.length ? healOn.reduce((a, b) => a + b, 0) / healOn.length : NaN,
      aoxUsdPerCase: aoxW.reduce((a, w) => a + (w.costUsd ?? 0), 0) / cs.length, healUsdPerCase: allIn.length ? allIn[Math.floor((allIn.length - 1) / 2)] : NaN,
      allIn: `median over lineages of (FH-1 build + commissioning $${FH1_ALLIN_USD_PER_LINEAGE.toFixed(3)} + stream marginal incl. C-O share) / graded cases; RESULT-FH1.md:343` };
  }
  const m6 = await m6Analysis({ worlds, exposure, sealed, log });
  const rcf = path.join(RUNS, 'ROOT-CAUSE-REVIEW.json');
  const rcReview = existsSync(rcf) ? JSON.parse(readFileSync(rcf, 'utf8')) : null;
  const r = report({ worlds, exposure, arms, certs, windows: pairs.length || aox ? { pairs, agentUsdPerCase: perCase, ...(aox ? { aox } : {}) } : null, ld: ld?.length ? ld : null, costs: { agentProjected, coUsd, healMarginal },
    sDropped: existsSync(path.join(RUNS, 'K4.json')), records, invalid, m6, rcReview, ...redAndAdv() });
  writeFileSync(path.join(RUNS, 'REPORT.json'), JSON.stringify(r, (k, v) => (v instanceof Set ? [...v] : v === Infinity ? 'Infinity' : v), 1));
  return r;
}
