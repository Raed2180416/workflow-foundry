// FH-1 review finding M1 ($0, post hoc, development worlds; written after the result, not frozen): do the healed programs stay
// healed off the grading block, under faults and under drift, and how do they compare with the bed's hand-written reference
// policy? No model call. No arm or session ever saw any world used here (the heal sessions saw only practice 1235-1237).
//   part faults  the COMP-1 fault battery (experiments/compose/faults.mjs: none, restart, crash, dup-delayed, dup-same,
//                downstream) on the COMP-1 fault worlds 1161 d2 (size 40), 1162 d3 (40), 1164 d5 (60), RESULT-COMP1 §6;
//   part seeds   nine more dev worlds, E-bed dev seeds 1191-1193 x d2, d3, d5 at the default size (the shape of the grading
//                block), fault-free; per subject also ticks, effects emitted and wake-ups, and the same counts for the
//                reference policy (beds/ebed/oracle/policy.mjs, timing earliest) on the same worlds;
//   part drift   the D1 drift (review-timeout-clears, R2.2; experiments/compose/drift.mjs) on 1165 d2 and 1166 d3 (size 30),
//                COMP-1 §8, with no new patch: does a heal survive a spec change it was not built for?
// Subjects: each incident's original build and its H-C k1 kept program, then ch-e8-3 H-C k2 (heal-until-clean), ch-e8-3 H-0 k1
// and cht-e8-3 H-N k1 (the other accepted patches with grading recoveries). Kept programs are rebuilt from runs/<label>/patch.json
// and their bundle digest is checked against the attempt's record (lean.mjs).
//   node experiments/fh/durability.mjs --part faults|seeds|drift [--subjects a,b] --out <json>
//   node experiments/fh/durability.mjs --report <faults.json> <seeds.json> <drift.json>
import path from 'node:path';
import os from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { runReference } from '../../beds/ebed/oracle/policy.mjs';
import { behaviourDigest } from '../../beds/ebed/e8/defects.mjs';
import { subjectOf as armSubject, runUnder } from '../compose/fault-run.mjs';
import { FAULTS, faultedWorld } from '../compose/faults.mjs';
import { poolsFor, assess } from '../compose/run.mjs';
import { driftRun } from '../compose/drift-run.mjs';
import { ROOT } from './grade.mjs';
import { BUILDS } from './baseline.mjs';
import { INCIDENTS } from './heal.mjs';
import { reconstruct } from './lean.mjs';

export const FAULT_WORLDS = Object.freeze([{ seed: 1161, d: 2, size: 40 }, { seed: 1162, d: 3, size: 40 }, { seed: 1164, d: 5, size: 60 }]);
export const SEED_WORLDS = Object.freeze([1191, 1192, 1193].flatMap(seed => [2, 3, 5].map(d => ({ seed, d }))));
export const DRIFT_WORLDS = Object.freeze([{ seed: 1165, d: 2, size: 30 }, { seed: 1166, d: 3, size: 30 }]);
const DEV = s => s >= 1001 && s <= 1199;
export const SUBJECTS = Object.freeze([...INCIDENTS.flatMap(i => [i, `${i}.H-C.k1`]), 'ch-e8-3.H-C.k2', 'ch-e8-3.H-0.k1', 'cht-e8-3.H-N.k1']);
const RUN_DIR = path.join(ROOT, 'research/heal-20261021/fh1/runs');

/** Journal counts of one run: ticks (arm calls), effects emitted, wake-ups. */
export function effort(rows) {
  let ticks = 0, effects = 0, wakeups = 0;
  for (const r of rows) {
    if (r.type === 'call') ticks += 1;
    else if (r.type === 'effect.emit') effects += 1;
    else if (r.type === 'wakeup.commit') wakeups += 1;
  }
  return { ticks, effects, wakeups };
}

/** A subject label -> an arm subject (bundled now, so later file changes cannot affect the run). */
function loadSubject(label, tmp) {
  if (BUILDS[label]) {
    const spec = BUILDS[label].spec.startsWith('program:') ? `program:${path.join(ROOT, BUILDS[label].spec.slice(8))}` : `solver:${path.join(ROOT, BUILDS[label].spec.slice(7))}`;
    return { ...armSubject(spec), label, incident: label, arm: 'original' };
  }
  const rec = JSON.parse(readFileSync(path.join(RUN_DIR, label, 'record.json'), 'utf8'));
  if (!rec.gate.accept) throw new Error(`${label}: its gate rejected the patch; the kept program is the original`);
  const r = reconstruct(label, path.join(tmp, label));
  return { ...armSubject(r.spec), label, incident: rec.incident, arm: `${rec.arm} k${rec.k}`, digest: r.digest };
}

const caseMap = a => new Map(a.oracle.failing.map(f => [f.case, f.class]));
const summary = (a, rows) => ({ completed: a.oracle.completed, passed: a.oracle.passed, critical: a.oracle.critical, failing: a.oracle.failing.map(f => [f.case, f.class]),
  contracts: `${a.capabilities.passed}/${a.capabilities.completed}`, dup: a.faults.exactlyOnce.duplicates.length, dupMoney: a.faults.exactlyOnce.money,
  comp: `${a.faults.compensation.complete}/${a.faults.compensation.due}`, armErrors: a.armErrors, ...effort(rows) });

async function partFaults(labels, tmp, log) {
  const pools = new Map(), out = { part: 'faults', worlds: FAULT_WORLDS, faults: FAULTS, subjects: {} };
  for (const label of labels) {
    const s = loadSubject(label, tmp);
    out.subjects[label] = { incident: s.incident, arm: s.arm, digest: s.digest ?? null, cells: [] };
    for (const w of FAULT_WORLDS) {
      if (!DEV(w.seed)) throw new Error('dev seeds only');
      const W = e8.generateWorld({ seed: w.seed, difficulty: w.d, mix: 'tail', size: w.size });
      let base = null;
      for (const fault of FAULTS) {
        const t = Date.now();
        const r = await runUnder(s, W, fault);
        const key = `${w.seed}:${w.d}:${w.size}:${fault}`;
        if (!pools.has(key)) pools.set(key, (await poolsFor(r.world, { binding: r.binding })).pools);
        const a = assess({ world: r.world, rows: r.rows, pools: pools.get(key), manifest: s.manifest });
        const digest = behaviourDigest(r.rows);
        if (fault === 'none') base = digest;
        const cell = { seed: w.seed, d: w.d, size: w.size, fault, status: r.status, injected: r.faults.length, ms: Date.now() - t,
          sameAsFaultFree: fault === 'none' ? null : digest === base, ...summary(a, r.rows) };
        out.subjects[label].cells.push(cell);
        log(`${label} ${w.seed} d${w.d} ${fault}: ${cell.passed}/${cell.completed} crit ${cell.critical} dup ${cell.dup}(${cell.dupMoney}) comp ${cell.comp} [${cell.ms} ms]`);
      }
    }
  }
  return out;
}

async function partSeeds(labels, tmp, log) {
  const out = { part: 'seeds', worlds: SEED_WORLDS, reference: {}, subjects: {} };
  const worlds = new Map(), pools = new Map();
  for (const w of SEED_WORLDS) {
    if (!DEV(w.seed)) throw new Error('dev seeds only');
    const W = e8.generateWorld({ seed: w.seed, difficulty: w.d, mix: 'tail' });
    worlds.set(`${w.seed}:${w.d}`, W);
    const p = await poolsFor(W);
    pools.set(`${w.seed}:${w.d}`, p.pools);
    const ref = await runReference({ item: e8.oracleItem, binding: e8.binding, world: W, timing: 'earliest' });
    const a = assess({ world: W, rows: ref.rows, pools: p.pools });
    out.reference[`${w.seed}:${w.d}`] = summary(a, ref.rows);
    log(`reference ${w.seed} d${w.d}: ${a.oracle.passed}/${a.oracle.completed} ${JSON.stringify(effort(ref.rows))}`);
  }
  for (const label of labels) {
    const s = loadSubject(label, tmp);
    out.subjects[label] = { incident: s.incident, arm: s.arm, digest: s.digest ?? null, cells: [] };
    for (const w of SEED_WORLDS) {
      const k = `${w.seed}:${w.d}`, t = Date.now();
      const r = await runUnder(s, worlds.get(k), 'none');
      const a = assess({ world: r.world, rows: r.rows, pools: pools.get(k), manifest: s.manifest });
      const cell = { seed: w.seed, d: w.d, status: r.status, ms: Date.now() - t, ...summary(a, r.rows) };
      out.subjects[label].cells.push(cell);
      log(`${label} ${w.seed} d${w.d}: ${cell.passed}/${cell.completed} ticks ${cell.ticks} effects ${cell.effects} [${cell.ms} ms]`);
    }
  }
  return out;
}

async function partDrift(labels, tmp, log) {
  const out = { part: 'drift', drift: 'review-timeout-clears', worlds: DRIFT_WORLDS, subjects: {} };
  for (const label of labels) {
    const s = loadSubject(label, tmp);
    const r = await driftRun({ drift: 'review-timeout-clears', worlds: DRIFT_WORLDS, subject: s, log: () => {} });
    out.subjects[label] = { incident: s.incident, arm: s.arm, worlds: r.worlds.map(w => ({ seed: w.seed, d: w.d, converted: w.converted, subject: w.subject })) };
    log(`${label} drift: ${r.worlds.map(w => `${w.seed} d${w.d} ${w.subject.oracle} (changed cases pass ${w.subject.changedCasesPass}/${w.converted.length})`).join('; ')}`);
  }
  return out;
}

// ---- report (pure on the three JSON files) -----------------------------------------------------------------------------------
const pairOf = label => (BUILDS[label] ? null : label.split('.')[0]);
/** Case-level recovered/regressed of subject `b` against subject `a` over cells with the same world (and fault). */
export function pairCompare(cellsA, cellsB, key = c => `${c.seed}:${c.d}:${c.fault ?? 'none'}`) {
  const A = new Map(cellsA.map(c => [key(c), c])), out = { recovered: 0, regressed: 0, missing: 0, cells: 0 };
  for (const b of cellsB) {
    const a = A.get(key(b));
    if (!a) { out.missing += 1; continue; }
    if (a.completed !== b.completed) out.missing += 1;
    const fa = new Set(a.failing.map(([c]) => c)), fb = new Set(b.failing.map(([c]) => c));
    out.recovered += [...fa].filter(c => !fb.has(c)).length;
    out.regressed += [...fb].filter(c => !fa.has(c)).length;
    out.cells += 1;
  }
  return out;
}

export function report(faults, seeds, drift) {
  const L = [];
  if (seeds) {
    const ref = Object.values(seeds.reference);
    const R = ref.reduce((s, c) => ({ passed: s.passed + c.passed, completed: s.completed + c.completed, ticks: s.ticks + c.ticks, effects: s.effects + c.effects }), { passed: 0, completed: 0, ticks: 0, effects: 0 });
    L.push(`### Nine more unseen dev worlds (1191-1193 x d2, d3, d5), fault-free, beside the reference policy`, '',
      `Reference policy (hand-written, reads world truth): ${R.passed}/${R.completed} cases, ${R.ticks} ticks, ${R.effects} effects.`, '',
      '| Subject | Oracle passed | vs original: +recovered / −regressed | Ticks (× reference) | Effects (× reference) | Duplicate effects | Arm errors |', '|---|---|---|---|---|---|---|');
    for (const [label, s] of Object.entries(seeds.subjects)) {
      const t = s.cells.reduce((a, c) => ({ passed: a.passed + c.passed, completed: a.completed + c.completed, ticks: a.ticks + c.ticks, effects: a.effects + c.effects, dup: a.dup + c.dup, ae: a.ae + c.armErrors }), { passed: 0, completed: 0, ticks: 0, effects: 0, dup: 0, ae: 0 });
      const base = pairOf(label) ? seeds.subjects[pairOf(label)] : null;
      const pc = base ? pairCompare(base.cells, s.cells) : null;
      L.push(`| ${label} | ${t.passed}/${t.completed} (${(100 * t.passed / t.completed).toFixed(1)}%) | ${pc ? `+${pc.recovered} / −${pc.regressed}${pc.missing ? ` (${pc.missing} cells not comparable)` : ''}` : '—'} | ${t.ticks} (${(t.ticks / R.ticks).toFixed(2)}) | ${t.effects} (${(t.effects / R.effects).toFixed(2)}) | ${t.dup} | ${t.ae} |`);
    }
    L.push('');
  }
  if (faults) {
    L.push('### Fault battery (COMP-1 worlds 1161 d2 s40, 1162 d3 s40, 1164 d5 s60): oracle passed over the three worlds', '',
      `| Subject | ${faults.faults.join(' | ')} | Cases lost to faults (Σ over faults, vs own fault-free) | Duplicate effects (money) | Compensation complete | Critical | vs original under faults: +rec / −reg |`, `|---|${faults.faults.map(() => '---').join('|')}|---|---|---|---|---|`);
    for (const [label, s] of Object.entries(faults.subjects)) {
      const by = f => s.cells.filter(c => c.fault === f).reduce((a, c) => ({ passed: a.passed + c.passed, completed: a.completed + c.completed }), { passed: 0, completed: 0 });
      const none = by('none');
      const lost = faults.faults.filter(f => f !== 'none').reduce((a, f) => a + Math.max(0, none.passed - by(f).passed), 0);
      const dup = s.cells.reduce((a, c) => a + c.dup, 0), money = s.cells.reduce((a, c) => a + c.dupMoney, 0);
      const comp = s.cells.reduce((a, c) => { const [x, y] = c.comp.split('/').map(Number); return [a[0] + x, a[1] + y]; }, [0, 0]);
      const crit = s.cells.reduce((a, c) => a + c.critical, 0);
      const base = pairOf(label) ? faults.subjects[pairOf(label)] : null;
      const pc = base ? pairCompare(base.cells.filter(c => c.fault !== 'none'), s.cells.filter(c => c.fault !== 'none')) : null;
      L.push(`| ${label} | ${faults.faults.map(f => { const x = by(f); return `${x.passed}/${x.completed}`; }).join(' | ')} | ${lost} | ${dup} (${money}) | ${comp[0]}/${comp[1]} | ${crit} | ${pc ? `+${pc.recovered} / −${pc.regressed}` : '—'} |`);
    }
    L.push('');
  }
  if (drift) {
    L.push('### Drift D1 (review-timeout-clears, R2.2) on 1165 d2 and 1166 d3 (size 30), no new patch', '',
      '| Subject | Oracle passed | Drift-changed cases passing | vs original under drift |', '|---|---|---|---|');
    for (const [label, s] of Object.entries(drift.subjects)) {
      const p = s.worlds.reduce((a, w) => { const [x, y] = w.subject.oracle.split('/').map(Number); return [a[0] + x, a[1] + y, a[2] + w.subject.changedCasesPass, a[3] + w.converted.length]; }, [0, 0, 0, 0]);
      const base = pairOf(label) ? drift.subjects[pairOf(label)] : null;
      const bp = base ? base.worlds.reduce((a, w) => a + Number(w.subject.oracle.split('/')[0]), 0) : null;
      L.push(`| ${label} | ${p[0]}/${p[1]} | ${p[2]}/${p[3]} | ${bp === null ? '—' : `${p[0] - bp >= 0 ? '+' : ''}${p[0] - bp} passed`} |`);
    }
  }
  return L.join('\n');
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--report')) {
    const i = process.argv.indexOf('--report');
    // each argument may list several JSON files of the same part (comma-separated, e.g. subject partitions run in parallel)
    const load = arg => { const files = (arg ?? '').split(',').filter(p => p && existsSync(p)); if (!files.length) return null;
      const parts = files.map(p => JSON.parse(readFileSync(p, 'utf8')));
      return { ...parts[0], subjects: Object.assign({}, ...parts.map(x => x.subjects)), reference: Object.assign({}, ...parts.map(x => x.reference ?? {})) }; };
    const [f, s, d] = process.argv.slice(i + 1, i + 4).map(load);
    console.log(report(f, s, d));
  } else {
    const part = arg('--part', null), out = arg('--out', null);
    if (!['faults', 'seeds', 'drift'].includes(part) || !out) { console.error('usage: durability.mjs --part faults|seeds|drift --out <json>'); process.exit(2); }
    const labels = arg('--subjects', null)?.split(',') ?? SUBJECTS;
    const tmp = mkdtempSync(path.join(process.env.FH_DUR_TMP ?? os.tmpdir(), 'fh-dur-'));
    try {
      const t0 = Date.now();
      const res = await { faults: partFaults, seeds: partSeeds, drift: partDrift }[part](labels, tmp, console.log);
      res.at = new Date().toISOString(); res.wallMs = Date.now() - t0; res.evidence = 'development (dev worlds), post hoc after the FH-1 result, $0';
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(res, null, 1));
      console.log(`written ${out} (${Math.round(res.wallMs / 1000)} s)`);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
}
