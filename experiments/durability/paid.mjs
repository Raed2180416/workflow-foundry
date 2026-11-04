// DUR-1 paid stages and the analysis of a real run (PREREG-DUR-1 §12-§13; called by run.mjs). Every model call here is
// metered on one ledger (research/durability-20261021/runs/spend.jsonl, the FH-1 start/end pattern): a session starts
// only if (a) the freeze holds, (b) total committed + its cap <= $80, (c) its row has room (prereg §12 priority order,
// unspent cap flowing down to later rows), (d) its lineage-stream has room (<= $1.50). Records are written per
// lineage-stream; a stage resumes by skipping every unit whose record exists (a unit killed mid-way is re-run from its
// start: its spend so far stays on the ledger, disclosed).
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { worldsOf, STREAM_IDS, REHEARSAL, T0_MS, DAY_MS, CHANGES } from './schedule.mjs';
import { buildBundle, loadSealed, ROOT, WORK } from './changes.mjs';
import { referencePools, gradeRun } from './oracle.mjs';
import { programVersion, versionOfSpec, LINEAGES, REF_SOLVERS, controlVersion } from './arms.mjs';
import { runStream, ContractOwner } from './stream.mjs';
import { HAIKU_PATCH, OPUS_PATCH, spendOf, LIMITS } from './heal-adapter.mjs';
import { CO_SESSION } from './contracts-owner.mjs';
import { streamExposure, attributeRecord, modelOf, certifyRecord } from './model.mjs';
import { report } from './report.mjs';
import { selectWindow, runWindow, WINDOW_CHANGES, K_DEFAULT, K_FALLBACK, AGENT } from './windows.mjs';
import { runLD, LATENT } from './ld.mjs';
import { search, confirm, BUDGET, GROUP_A } from './wc-search.mjs';
import { redTeamSession, blindBaseline, RT_SESSIONS } from './redteam/session.mjs';
import { ruleVersion } from './rmaint.mjs';
import { signalsOfRun } from './monitor.mjs';
import { RES, RUNS, SPEND, TOTAL_CAP, PRIORITY, capOf } from './run.mjs';
import { SEALED_DIR } from './author.mjs';

/** The prereg §12 row of a ledger scope. */
export function rowOf(scope) {
  const s = String(scope);
  if (/^P0|^p0/.test(s)) return 'P0';
  if (/^P1$|^author/.test(s)) return 'P1';
  if (/^co-/.test(s)) return 'P2';
  if (/^MH-H\.[^.]+\.s3/.test(s) || /^A-H\..*s3/.test(s)) return 'P5';
  if (/^MH-H\./.test(s)) return 'P3';
  if (/^A-H\./.test(s)) return 'P4';
  if (/^REF-M\./.test(s)) return 'P6';
  if (/^J2|^RT-|^A-H-RT/.test(s)) return 'P7';
  if (/^A-Ox/.test(s)) return 'P8';
  if (/^MH-stale|^LD-H|^MH-HO/.test(s)) return 'P9';
  return 'reserve';
}

/** Room left in a row: cumulative caps through it minus committed spend (upper: open sessions at their cap) through it. */
export function rowRoom(row, ledger = SPEND) {
  const order = PRIORITY.map(p => p.row);
  const i = order.indexOf(row);
  if (i < 0) return 0;
  const s = spendOf(ledger);
  const capThrough = PRIORITY.slice(0, i + 1).reduce((a, p) => a + p.cap, 0);
  const spentThrough = Object.entries(s.byScope).filter(([sc]) => order.indexOf(rowOf(sc)) <= i).reduce((a, [, v]) => a + v, 0);
  return Math.min(capThrough - spentThrough, TOTAL_CAP - s.upperUsd);
}

/** A per-session gate: freeze still holds and the row has room for this session's cap. */
const sessionGate = (freeze, row, capUsd) => () => {
  if (!freeze?.ok) return { ok: false, reason: 'freeze' };
  const room = rowRoom(row);
  return room >= capUsd ? { ok: true } : { ok: false, reason: `row ${row} has $${room.toFixed(2)} left, session cap $${capUsd}` };
};

/** The ledger meter for per-tick agents (agentVArm's meter interface: before reserves, after settles). */
export function ledgerMeter({ scope, row, file = SPEND }) {
  let n = 0;
  return {
    before({ model, bound }) {
      const room = rowRoom(row, file);
      if (room < bound || spendOf(file).upperUsd + bound > TOTAL_CAP) throw Object.assign(new Error(`DUR1_BUDGET: ${scope} (row ${row} room $${room.toFixed(2)})`), { code: 'DUR1_BUDGET' });
      const id = `${scope}#${++n}@${new Date().toISOString()}`;
      appendFileSync(file, JSON.stringify({ id, phase: 'start', label: scope, scope, model, capUsd: bound, at: new Date().toISOString() }) + '\n');
      return { id, model, bound };
    },
    after(tok, r) {
      if (!tok) return null;
      appendFileSync(file, JSON.stringify({ id: tok.id, phase: 'end', label: scope, scope, model: tok.model, capUsd: tok.bound, costUsd: r?.costUsd ?? null, costUpperUsd: r?.costUsd === null || r?.costUsd === undefined ? tok.bound : null, error: r?.error?.code ?? null, at: new Date().toISOString() }) + '\n');
      return r?.costUsd ?? tok.bound;
    },
  };
}

/** A contract owner whose certified readings persist across processes (resume) and are shared by every stage. */
export class PersistentContractOwner extends ContractOwner {
  constructor(opts) {
    super(opts);
    this.dir = path.join(RUNS, 'co');
    mkdirSync(this.dir, { recursive: true });
    for (const f of readdirSync(this.dir).filter(x => x.endsWith('.reading.json'))) {
      const r = JSON.parse(readFileSync(path.join(this.dir, f), 'utf8'));
      if (r.kind === 'announced') this.announced.set(r.id, r.rec); else this.vb.set(r.key, r.rec);
    }
  }
  async forAnnounced(id, bundle, atMs) {
    const had = this.announced.has(id);
    const rec = await super.forAnnounced(id, bundle, atMs);
    if (!had) writeFileSync(path.join(this.dir, `announced-${id}.reading.json`), JSON.stringify({ kind: 'announced', id, rec }, null, 1));
    return rec;
  }
  async forVerifierBlind(args) {
    const key = `${args.stream}|${args.k}|${args.topic}`;
    const had = this.vb.has(key);
    const rec = await super.forVerifierBlind(args);
    if (!had) writeFileSync(path.join(this.dir, `vb-${key.replace(/\|/g, '_')}.reading.json`), JSON.stringify({ kind: 'vb', key, rec: { ...rec, reused: undefined } }, null, 1));
    return rec;
  }
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
    { stream: 'p0', k: 2, seed: REHEARSAL.miniStream[1], size: 80, difficulty: 3, mix: 'tail', changes: [{ id: 'R1', cls: 'CHG-A', kind: 'rule', startsHere: false, onsetMs: T0_MS, publishMs: null }] },
  ];
}

const recFile = (dir, label) => path.join(dir, `${label.replace(/[^\w.-]/g, '_')}.stream.json`);

/** Window k from the P0 measurement (prereg §12 row 0: if A-H $/case x 8 x 12 > $19, k = 4). */
export function windowK() {
  const f = path.join(RUNS, 'p0', 'P0.json');
  if (!existsSync(f)) return K_DEFAULT;
  return JSON.parse(readFileSync(f, 'utf8')).k ?? K_DEFAULT;
}

/** One routed window run; returns the window record (agent per-case pass, silent, cost). */
async function windowRecord({ spec, change, sealed, ex, kind, label, cases = null, k = windowK(), dir, meter }) {
  const b = await buildBundle(spec, { sealed });
  const ref = await referencePools(b);
  const ch = spec.changes.find(c => c.id === change);
  const sel = cases ? { exposed: cases, controls: [] } : selectWindow({ stream: spec.stream, change, exposed: ex.of(spec.k)[change] ?? new Set(), pools: ref.pools, W: b.W, onsetMs: ch.onsetMs, k });
  const ids = [...sel.exposed, ...sel.controls];
  const r = await runWindow({ bundle: b, cases: ids, kind, label, meter });
  const g = gradeRun(b, r.rows, ref.pools);
  const sig = await signalsOfRun({ bundle: b, rows: r.rows, pools: ref.pools });
  const m1 = new Map();
  for (const d of Object.values(sig.days)) for (const s of d) if (s.ch === 'm1' && s.case && !m1.has(s.case)) m1.set(s.case, s.at);
  const cases_ = g.cases.filter(c => ids.includes(c.case)).map(c => ({ case: c.case, pass: c.pass ? 1 : 0, critical: c.critical ? 1 : 0, exposed: sel.exposed.includes(c.case),
    silent: !c.pass && !(m1.has(c.case) && m1.get(c.case) <= (c.firstAt ?? Infinity) + DAY_MS) ? 1 : 0 }));
  const rec = { label, kind, stream: spec.stream, k: spec.k, change, selected: sel, cases: cases_, ticks: r.ticks, costUsd: r.costUsd, sessions: r.sessions, status: r.status };
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${label}.window.json`), JSON.stringify(rec, null, 1));
  return rec;
}

export async function paidStage(cmd, { opt, flag, list, log, guardPaid, paidSession }) {
  const ROW = { p0: 'P0', heal: 'P3', windows: 'P4', refm: 'P6', redteam: 'P7', forks: 'P9' };
  const fz = await guardPaid(cmd, ROW[cmd]);
  const sealed = cmd === 'p0' ? null : loadRunSealed();
  const coSession = id => { const g = sessionGate(fz, 'P2', CO_SESSION.budgetUsd)(); if (!g.ok) throw Object.assign(new Error(`DUR1_BUDGET: C-O ${id}: ${g.reason}`), { code: 'DUR1_BUDGET' }); return paidSession(CO_SESSION, { scope: `co-${id}`, row: 'P2', freeze: fz }); };
  const co = new PersistentContractOwner({ session: coSession, runDir: path.join(RUNS, 'co'), sealed, log });
  const healSession = (row, label, conf = HAIKU_PATCH) => (kind) => {
    const c = kind === 'opus' ? OPUS_PATCH : conf;
    return { ...paidSession(c, { scope: label, row, freeze: fz }), spend: { file: SPEND, scope: label, totalCap: TOTAL_CAP, scopeCap: LIMITS.usdPerLineageStream }, checkFreeze: sessionGate(fz, row, c.budgetUsd) };
  };
  const lineages = list('lineages', Object.keys(LINEAGES));
  if (cmd === 'p0') {
    const dir = path.join(RUNS, 'p0');
    mkdirSync(dir, { recursive: true });
    const worlds = rehearsalWorlds();
    const p0co = new ContractOwner({ session: id => paidSession(CO_SESSION, { scope: `P0-co-${id}`, row: 'P0', freeze: fz }), runDir: dir, log });
    let sessions = 0;
    for (const l of ['b1lh-e8-1', 'ch-e8-1']) {
      const label = `P0.MH-H.${l}`;
      if (existsSync(recFile(dir, label))) continue;
      const mk = healSession('P0', label);
      await runStream({ arm: 'heal', label, start: programVersion(LINEAGES[l], { id: l }), worlds, heal: { session: kind => { if (++sessions > 3) throw Object.assign(new Error('DUR1_P0: <= 3 Haiku sessions'), { code: 'DUR1_BUDGET' }); return mk(kind); } }, co: p0co, runDir: dir, log, spendFile: SPEND });
    }
    const wSpec = { stream: 'p0', k: 1, seed: REHEARSAL.agentWindow, size: 80, difficulty: 3, mix: 'tail', changes: [{ id: 'R1', cls: 'CHG-A', kind: 'rule', startsHere: true, onsetMs: T0_MS + 4 * DAY_MS, publishMs: T0_MS + DAY_MS + 9 * 3_600_000 }] };
    const ex = await streamExposure([wSpec]);
    const w = await windowRecord({ spec: wSpec, change: 'R1', sealed: null, ex, kind: 'A-H', label: 'P0.A-H.R1', k: 2, dir, meter: ledgerMeter({ scope: 'P0.A-H', row: 'P0' }) });
    const perCase = w.cases.length ? w.costUsd / w.cases.length : null;
    const k = perCase !== null && perCase * 8 * 12 > 19 ? K_FALLBACK : K_DEFAULT;
    writeFileSync(path.join(dir, 'P0.json'), JSON.stringify({ agentUsdPerCase: perCase, k, rule: 'prereg §12 P0: if A-H $/case x 8 x 12 > $19 then k = 4', window: { cases: w.cases.length, costUsd: w.costUsd } }, null, 1));
    log(`P0: A-H $/case ${perCase?.toFixed(3)}; k = ${k}`);
    return;
  }
  if (cmd === 'heal') {
    const streams = list('streams', ['s1', 's2']);
    for (const s of streams) {
      if (s === 's3') {
        const s1 = Object.entries(spendOf(SPEND).byScope).filter(([sc]) => /^MH-H\.[^.]+\.s1$/.test(sc)).reduce((a, [, v]) => a + v, 0);
        if (s1 > 8) { log(`K-4: MH-H spent $${s1.toFixed(2)} on s1 (> $8): s3 is dropped for MH-H and A-H; D-3 is directional`); writeFileSync(path.join(RUNS, 'K4.json'), JSON.stringify({ fired: true, s1Usd: s1 })); return; }
      }
      const dir = path.join(RUNS, 'heal', s);
      const worlds = worldsOf(s, { sealedOnsets: sealed.onsets() });
      for (const l of lineages) {
        const label = `MH-H.${l}.${s}`;
        if (existsSync(recFile(dir, label))) { log(`${label}: record exists, skipped`); continue; }
        await runStream({ arm: 'heal', label, start: programVersion(LINEAGES[l], { id: l }), worlds, sealed, heal: { session: healSession(s === 's3' ? 'P5' : 'P3', label) }, co, runDir: dir, log, spendFile: SPEND });
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
        const w = await windowRecord({ spec: sel[c].spec, change: c, sealed, ex, kind: 'A-Ox', label, cases: [x], dir: path.join(RUNS, 'aox'), meter: ledgerMeter({ scope: label, row: 'P8' }) });
        costs.push(w.costUsd);
      }
      return;
    }
    for (const s of streams) {
      const worlds = worldsOf(s, { sealedOnsets: sealed.onsets() });
      const ex = await streamExposure(worlds, { sealed });
      const row = s === 's3' ? 'P5' : 'P4';
      for (const c of WINDOW_CHANGES) {
        const spec = worlds.find(w => w.changes.some(x => x.id === c && x.startsHere));
        for (const rep of s === 's1' && c === 'R2s' ? ['', '.rep'] : ['']) {
          const label = `A-H.${s}.${c}${rep}`;
          if (existsSync(path.join(RUNS, 'windows', `${label}.window.json`))) { log(`${label}: exists, skipped`); continue; }
          await windowRecord({ spec, change: c, sealed, ex, kind: 'A-H', label, dir: path.join(RUNS, 'windows'), meter: ledgerMeter({ scope: label, row }) });
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
      await runStream({ arm: 'heal', label, start: programVersion(REF_SOLVERS[sv], { id: sv }), worlds, sealed, heal: { session: healSession('P6', label, OPUS_PATCH) }, co, runDir: dir, log, spendFile: SPEND });
    }
    return;
  }
  if (cmd === 'redteam') {
    const dir = path.join(RUNS, 'redteam');
    const targets = [['RT-O1', 'b1lh-e8-1', 'opus'], ['RT-O2', 'ch-e8-1', 'opus'], ['RT-H', 'b1lh-e8-1', 'haiku']];
    for (const [id, t, kind] of targets) {
      if (existsSync(path.join(dir, `${id}.record.json`))) continue;
      const conf = RT_SESSIONS[kind];
      const g = sessionGate(fz, 'P7', conf.budgetUsd)();
      if (!g.ok) { log(`${id}: ${g.reason}`); continue; }
      await redTeamSession({ id, targetId: t, version: programVersion(LINEAGES[t], { id: t }), session: paidSession(conf, { scope: `J2.${id}`, row: 'P7', freeze: fz }), runDir: dir, sealed, log });
      if (kind === 'opus') { const b = await blindBaseline({ targetId: t, version: programVersion(LINEAGES[t], { id: t }), sealed, log }); writeFileSync(path.join(dir, `${id}.blind.json`), JSON.stringify(b, (k, v) => (v instanceof Set ? [...v] : v), 1)); }
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
      await runStream({ arm: 'heal', label, start, worlds: worlds.filter(w => w.k >= 3), sealed, heal: { session: healSession('P9', label), stale: ['R1', 'vb'] }, co, runDir: dir, log, spendFile: SPEND, regressionW1: worlds[0] });
    }
    for (const id of LATENT) {
      if (existsSync(path.join(dir, `LD-H.${id}.analysis.json`))) continue;
      await runLD({ id, heal: { session: healSession('P9', `LD-H.${id}`) }, co, runDir: dir, log, spendFile: SPEND });
    }
    return;
  }
  throw new Error(`unknown paid stage ${cmd}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// $0 stages that read the paid records: WC-1 passes and the analysis.

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

const readRecords = dir => (existsSync(dir) ? readdirSync(dir, { recursive: true }).filter(f => String(f).endsWith('.stream.json')).map(f => JSON.parse(readFileSync(path.join(dir, String(f)), 'utf8'))) : []);

/** The analysis of the real run (prereg §9-§10, §14): reads every record under runs/, writes REPORT.json. */
export async function analyzeRuns({ log = () => {} } = {}) {
  const sealed = loadRunSealed();
  const worlds = Object.fromEntries(STREAM_IDS.map(s => [s, worldsOf(s, { sealedOnsets: sealed.onsets() })]));
  const exposure = {};
  for (const s of STREAM_IDS) exposure[s] = await streamExposure(worlds[s], { sealed });
  const arms = {}, certs = {}, records = { 'MH-H': {} };
  const put = (arm, unit, stream, m) => { ((arms[arm] ??= {})[unit] ??= {})[stream] = m; };
  for (const rec of [...readRecords(path.join(RUNS, 'stagez')), ...readRecords(path.join(RUNS, 'heal')), ...readRecords(path.join(RUNS, 'refm')), ...readRecords(path.join(RUNS, 'forks'))]) {
    const [arm, unit] = rec.label.split('.');
    const armName = arm === 'S-Hstar' ? 'S-H*' : arm;
    if (!worlds[rec.stream]) continue;
    rec.versionMap = await versionsOf(rec);
    const needsAttr = ['S-H*', 'MH-H', 'REF-M'].includes(armName);
    const at = needsAttr ? await attributeRecord({ rec, worlds: worlds[rec.stream], ex: exposure[rec.stream], sealed }) : null;
    put(armName, unit ?? 'ref', rec.stream, modelOf(rec, at));
    if (armName === 'MH-H') { (records['MH-H'][unit] ??= {})[rec.stream] = rec; (certs[unit] ??= {})[rec.stream] = await certifyRecord({ rec, worlds: worlds[rec.stream], sealed, attribution: at }); }
    log(`analysed ${rec.label}`);
  }
  // Windows: pairs of MH-H's outcome (from its stream record) and A-H's routed outcome on the same case.
  const pairs = [];
  const wdir = path.join(RUNS, 'windows');
  let agentUsd = 0, agentCases = 0;
  if (existsSync(wdir)) for (const f of readdirSync(wdir).filter(x => x.endsWith('.window.json') && !x.includes('.rep.'))) {
    const w = JSON.parse(readFileSync(path.join(wdir, f), 'utf8'));
    agentUsd += w.costUsd; agentCases += w.cases.length;
    for (const [l, by] of Object.entries(records['MH-H'])) {
      const g = by[w.stream]?.worlds.find(x => x.k === w.k)?.grade ?? {};
      const hm = arms['MH-H']?.[l]?.[w.stream]?.worlds?.[w.k]?.cases ?? {};
      for (const c of w.cases) if (g[c.case]) pairs.push({ lineage: l, window: `${w.stream}-${w.change}`, case: c.case, heal: g[c.case][0], agent: c.pass,
        healSilent: g[c.case][0] ? 0 : (Object.values(hm[c.case]?.signals ?? {}).some(t => t <= (hm[c.case]?.firstAt ?? 0) + DAY_MS) ? 0 : 1), agentSilent: c.silent });
    }
  }
  const perCase = agentCases ? agentUsd / agentCases : null;
  const agentProjected = perCase === null ? null : Object.fromEntries(STREAM_IDS.map(s => [s, perCase * (arms['S-H*'] ? Object.values(Object.values(arms['S-H*'])[0]?.[s]?.worlds ?? {}).reduce((a, w) => a + Object.keys(w.cases).length, 0) : 0)]));
  const ld = existsSync(path.join(RUNS, 'forks')) ? readdirSync(path.join(RUNS, 'forks')).filter(f => f.endsWith('.analysis.json')).map(f => JSON.parse(readFileSync(path.join(RUNS, 'forks', f), 'utf8'))) : null;
  const coUsd = {};
  for (const [sc, v] of Object.entries(spendOf(SPEND).byScope)) if (sc.startsWith('co-')) { const id = sc.slice(3).split('-a')[0]; coUsd[id] = (coUsd[id] ?? 0) + v; }
  const r = report({ worlds, exposure, arms, certs, windows: pairs.length ? { pairs, agentUsdPerCase: perCase } : null, ld: ld?.length ? ld : null, costs: { agentProjected, coUsd },
    sDropped: existsSync(path.join(RUNS, 'K4.json')), records });
  writeFileSync(path.join(RUNS, 'REPORT.json'), JSON.stringify(r, (k, v) => (v instanceof Set ? [...v] : v === Infinity ? 'Infinity' : v), 1));
  return r;
}
