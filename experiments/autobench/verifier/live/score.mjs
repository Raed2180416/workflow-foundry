#!/usr/bin/env node
// VL-1 step 5: score a COMMITTED selection against the forks' headline grades (VERIFIER-LAB.md §4.3, §5 step 5).
// Run only after selection.json is committed (the blind boundary) and after every fork's run has finished; it refuses an
// uncommitted or modified selection unless --allow-uncommitted is given (development replays only).
//
//   node score.mjs --selection <selection.json> --live-root <runs dir> --default v1m --ref a0o-look2-1
//       [--compare A0=a0-look2,...] [--primary P2/R3] [--rl2 <dir> --rl2-tag look2] [--dj <dir>]
//       [--repair <repair.json>] [--strata <task -> class JSON, analysis only>] [--tasks-subset <file>] --out <RESULT.json>
//
// Strict pass is each fork's headline `final` in its results.jsonl (so the runner's H3/L5 overrides apply); a task with no
// record, no final or no pick is a fail. A selection's pass on a task is the headline of the fork it picked. Paired
// statistics per selection: exact two-sided McNemar and a 10,000-sample task bootstrap of the pass difference (fixed
// seed), against the default fork alone, the reference run and every --compare run. Costs: every fork of the pool runs,
// so a pool's acting cost per task is the sum of its forks' costUsd; verifier cost is read from the verifier output
// files (per-call costUsd) and attributed by candidate share; Mercury tokens are reported apart.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCORE_VERSION = 'vl1-score-v1';
export const HP_TYPES = Object.freeze(['msg_to', 'msg_has', 'created_has', 'created_in', 'effect_any']);
export const BOOT_SEED = 20261022, BOOT_B = 10000;
const jsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

/** Per task: the headline of the last run (in the list) that recorded it. {task -> {pass, final, costUsd, mercuryTokens, run, override}} */
export function headlines(liveRoot, runs) {
  const out = new Map();
  for (const run of runs) {
    for (const r of jsonl(path.join(liveRoot, run, 'results.jsonl'))) {
      const merc = (r.forks ?? []).reduce((s, f) => s + (f.tokens?.byModel?.['mercury-3']?.total ?? 0), 0);
      out.set(r.task, { run, pass: r.final ? (r.final.task_completed_correctly === 1 ? 1 : 0) : 0, partialCredit: r.final?.partial_credit ?? 0,
        costUsd: r.costUsd ?? 0, mercuryTokens: merc, override: r.headlineOverride ?? null });
    }
  }
  return out;
}

export function rngOf(seed) { let x = seed >>> 0; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
/** 95% interval of the summed paired difference over B task resamples (the lab's bootstrap, same generator and seed). */
export function bootstrap(diffs, B = BOOT_B, seed = BOOT_SEED) {
  const r = rngOf(seed), n = diffs.length, out = [];
  if (!n) return [0, 0];
  for (let b = 0; b < B; b++) { let t = 0; for (let i = 0; i < n; i++) t += diffs[Math.floor(r() * n)]; out.push(t); }
  out.sort((u, v) => u - v);
  return [out[Math.floor(0.025 * B)], out[Math.floor(0.975 * B)]];
}
/** Exact two-sided McNemar: binomial(b + c, 1/2) on the discordant pairs (exact integer arithmetic). */
export function mcnemarExact(b, c) {
  const n = b + c;
  if (!n) return 1;
  const k = Math.min(b, c);
  let term = 1n, sum = 0n;
  for (let i = 0; i <= k; i++) { if (i > 0) term = (term * BigInt(n - i + 1)) / BigInt(i); sum += term; }
  const den = 1n << BigInt(n);
  return Math.min(1, Number(2n * sum) / Number(den));
}
/** Paired comparison of two pass vectors over the same task order. */
export function paired(a, b, tasks) {
  let gains = 0, losses = 0;
  const diffs = tasks.map(t => { const d = (a.get(t) ?? 0) - (b.get(t) ?? 0); if (d > 0) gains++; if (d < 0) losses++; return d; });
  const passA = tasks.reduce((s, t) => s + (a.get(t) ?? 0), 0), passB = tasks.reduce((s, t) => s + (b.get(t) ?? 0), 0);
  return { n: tasks.length, passA, passB, diff: passA - passB, gains, losses, mcnemarP: +mcnemarExact(gains, losses).toPrecision(6), bootstrap95: bootstrap(diffs) };
}

function committed(file) {
  try {
    const dir = path.dirname(path.resolve(file));
    execFileSync('git', ['-C', dir, 'ls-files', '--error-unmatch', path.resolve(file)], { stdio: 'ignore' });
    execFileSync('git', ['-C', dir, 'diff', '--quiet', 'HEAD', '--', path.resolve(file)], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

export function scoreSelection({ selection, liveRoot, defaultArm, ref, compare = {}, primary = 'P2/R3', rl2Dir = null, rl2Tag = '', djDir = null, repair = null, strata = null, tasksSubset = null }) {
  const sel = selection;
  const tasks = (tasksSubset ?? Object.keys(sel.selections[0].picks)).slice().sort();
  const armRuns = sel.lab.arms;
  const H = {};
  for (const [arm, runs] of Object.entries(armRuns)) H[arm] = headlines(liveRoot, runs);
  const passOf = m => new Map(tasks.map(t => [t, m.get(t)?.pass ?? 0]));
  const comparators = { ...(ref ? { ref } : {}), ...compare };
  const CH = Object.fromEntries(Object.entries(comparators).map(([k, run]) => [k, headlines(liveRoot, [run])]));
  const runToArm = new Map(Object.entries(armRuns).flatMap(([a, rs]) => rs.map(r => [r, a])));
  if (!H[defaultArm]) throw new Error(`default arm ${defaultArm} is not in the selection's lab`);

  // RL2 checks, for the high-precision (HP) hard-check diagnostic on picks; verifier costs from the output files.
  const tag = t => (t ? `-${t}` : '');
  const checks = rl2Dir ? new Map(jsonl(path.join(rl2Dir, `checks${tag(rl2Tag)}.jsonl`)).map(c => [c.rowId, c])) : new Map();
  const hpFail = rowId => { const c = checks.get(rowId); return c ? c.code.some(k => k.hard && k.pass === false && HP_TYPES.includes(k.type)) : null; };
  // extraction: every call (ok or not) of the readers whose ledgers the checks used, on these tasks
  const readersUsed = new Set(rl2Dir ? jsonl(path.join(rl2Dir, `ledgers${tag(rl2Tag)}.jsonl`)).flatMap(l => l.readers ?? []) : []);
  const rl2ExtractUsd = rl2Dir ? jsonl(path.join(rl2Dir, 'extract.jsonl')).filter(j => tasks.includes(j.task) && readersUsed.has(j.reader)).reduce((s, j) => s + (j.costUsd ?? 0), 0) : 0;
  // per-candidate verifier calls (every attempt counts), attributed to a pool by the share of candidates it holds
  const candRows = Object.keys(sel.signals ?? {}).filter(id => tasks.includes(id.slice(id.indexOf('/') + 1)));
  const cand = new Set(candRows);
  const sumBy = rows => rows.filter(j => cand.has(j.rowId)).reduce((s, j) => s + (j.costUsd ?? 0), 0);
  const rl2JudgeUsd = rl2Dir ? sumBy(jsonl(path.join(rl2Dir, `judge${tag(rl2Tag)}.jsonl`))) : 0;
  const djUsd = djDir ? sumBy(jsonl(path.join(djDir, 'judgments-haiku-world.jsonl'))) : 0;
  const allCand = candRows.length || 1;

  const forks = Object.fromEntries(Object.entries(H).map(([arm, m]) => [arm, { runs: armRuns[arm], pass: tasks.reduce((s, t) => s + (m.get(t)?.pass ?? 0), 0), recorded: tasks.filter(t => m.has(t)).length,
    costUsdPerTask: tasks.reduce((s, t) => s + (m.get(t)?.costUsd ?? 0), 0) / tasks.length, mercuryTokens: tasks.reduce((s, t) => s + (m.get(t)?.mercuryTokens ?? 0), 0),
    overrides: tasks.filter(t => m.get(t)?.override).length }]));
  const refs = Object.fromEntries(Object.entries(CH).map(([k, m]) => [k, { run: comparators[k], pass: tasks.reduce((s, t) => s + (m.get(t)?.pass ?? 0), 0), recorded: tasks.filter(t => m.has(t)).length,
    costUsdPerTask: tasks.reduce((s, t) => s + (m.get(t)?.costUsd ?? 0), 0) / tasks.length }]));
  for (const k of Object.keys(refs)) refs[k].costUsdPerSuccess = refs[k].pass ? (refs[k].costUsdPerTask * tasks.length) / refs[k].pass : null;
  for (const k of Object.keys(forks)) forks[k].costUsdPerSuccess = forks[k].pass ? (forks[k].costUsdPerTask * tasks.length) / forks[k].pass : null;

  const domains = [...new Set(tasks.map(t => t.split('.')[0]))].sort();
  const results = [];
  for (const s of sel.selections) {
    const pass = new Map(tasks.map(t => { const run = s.picks[t]; const arm = run ? runToArm.get(run) : null; return [t, arm ? (H[arm].get(t)?.pass ?? 0) : 0]; }));
    const picks = tasks.map(t => s.rows[t]).filter(Boolean);
    const flagged = picks.filter(id => hpFail(id) === true);
    const flaggedFail = flagged.filter(id => { const t = id.slice(id.indexOf('/') + 1); return pass.get(t) === 0; });
    const actUsd = tasks.reduce((sum, t) => sum + s.arms.reduce((x, a) => x + (H[a]?.get(t)?.costUsd ?? 0), 0), 0);
    const poolCand = candRows.filter(id => s.arms.includes(runToArm.get(id.slice(0, id.indexOf('/'))))).length;
    const verUsd = rl2ExtractUsd + (rl2JudgeUsd + djUsd) * (poolCand / allCand);
    const mercury = tasks.reduce((sum, t) => sum + s.arms.reduce((x, a) => x + (H[a]?.get(t)?.mercuryTokens ?? 0), 0), 0);
    const nPass = tasks.reduce((x, t) => x + pass.get(t), 0);
    const row = {
      id: `${s.pool}/${s.rule}`, pool: s.pool, rule: s.rule, arms: s.arms, default: s.default, primary: `${s.pool}/${s.rule}` === primary,
      pass: nPass, n: tasks.length, passRate: nPass / tasks.length,
      vsDefault: paired(pass, passOf(H[s.default] ?? new Map()), tasks),
      vsComparators: Object.fromEntries(Object.entries(CH).map(([k, m]) => [k, paired(pass, passOf(m), tasks)])),
      oracle: tasks.filter(t => s.arms.some(a => H[a]?.get(t)?.pass === 1)).length,
      switchedFromDefault: tasks.filter(t => s.picks[t] && runToArm.get(s.picks[t]) !== s.default).length,
      byDomain: Object.fromEntries(domains.map(d => { const ts = tasks.filter(t => t.startsWith(d + '.')); return [d, { n: ts.length, pass: ts.reduce((x, t) => x + pass.get(t), 0) }]; })),
      cost: { actingUsdPerTask: actUsd / tasks.length, verifierUsdPerTask: verUsd / tasks.length, usdPerTask: (actUsd + verUsd) / tasks.length,
        usdPerSuccess: nPass ? (actUsd + verUsd) / nPass : null, mercuryTokens: mercury },
      hpOnPicks: { flagged: flagged.length, flaggedFailing: flaggedFail.length, precision: flagged.length ? flaggedFail.length / flagged.length : null },
      perTask: { selected: Object.fromEntries(tasks.map(t => [t, pass.get(t)])), default: Object.fromEntries(tasks.map(t => [t, H[s.default]?.get(t)?.pass ?? 0])) },
      ...(strata ? { failuresByClass: tasks.filter(t => pass.get(t) === 0).reduce((m, t) => { const c = strata[t] ?? 'unclassified'; m[c] = (m[c] ?? 0) + 1; return m; }, {}) } : {}),
    };
    results.push(row);
  }

  let repairOut = null;
  if (repair) {
    const prim = sel.selections.find(s => `${s.pool}/${s.rule}` === primary);
    const live = new Map(tasks.map(t => { const run = prim.picks[t]; const arm = run ? runToArm.get(run) : null; return [t, arm ? (H[arm].get(t)?.pass ?? 0) : 0]; }));
    const grade = d => { const f = path.join(d, 'grade.json'); if (!existsSync(f)) return null; const g = JSON.parse(readFileSync(f, 'utf8')); return g.task_completed_correctly === 1 ? 1 : 0; };
    const treated = (repair.treated ?? []).filter(x => tasks.includes(x.task));
    // a treatment session that broke the runner's audit (H3 step cap, L5) scores as a fail, as the headline would
    const rows = treated.map(x => ({ task: x.task, live: live.get(x.task), control: x.controlHost ? grade(x.controlHost) : null,
      treatment: x.treatmentHost ? (x.treatment?.violations?.length ? 0 : grade(x.treatmentHost)) : null, violations: x.treatment?.violations ?? [], error: x.error ?? null }));
    const vl1r = new Map(live);
    for (const r of rows) if (r.treatment !== null) vl1r.set(r.task, r.treatment);
    const valid = rows.filter(r => r.control !== null && r.treatment !== null);
    repairOut = { treated: rows.length, graded: valid.length,
      vsControl: { fixed: valid.filter(r => r.treatment === 1 && r.control === 0).length, broke: valid.filter(r => r.treatment === 0 && r.control === 1).length },
      vsLive: { fixed: valid.filter(r => r.treatment === 1 && r.live === 0).length, broke: valid.filter(r => r.treatment === 0 && r.live === 1).length },
      controlDrift: valid.filter(r => r.control !== r.live).length, hpPrecisionOnTreated: rows.length ? rows.filter(r => r.live === 0).length / rows.length : null,
      vl1r: { pass: tasks.reduce((x, t) => x + vl1r.get(t), 0), vsVl1: paired(vl1r, live, tasks) }, rows };
  }

  return { schema: 'foundry.vl1.result/v1', version: SCORE_VERSION, primary, defaultArm, tasks: tasks.length, forks, comparators: refs,
    verifierSpend: { rl2ExtractUsd, rl2JudgeUsd, djUsd }, selections: results, repair: repairOut, decisions: decide(results.find(r => r.primary), refs.ref ?? null, repairOut) };
}

/** The decision rules of PREREG-VL1 §7, fixed before any look-2 grade was read, applied mechanically. */
export function decide(p, ref, repair) {
  if (!p) return null;
  const d = p.vsDefault.diff, losses = p.vsDefault.losses;
  const selection = d >= 3 && losses <= 2 ? 'selection works on fresh tasks' : d <= 1 ? 'selection is not the lever' : 'inconclusive (neither rule fires)';
  const opus = ref ? { refPass: ref.pass, refUsdPerTask: ref.costUsdPerTask, vl1Pass: p.pass, vl1UsdPerTask: p.cost.usdPerTask,
    parity: p.pass >= ref.pass - 2 && p.cost.usdPerTask <= 0.2 * ref.costUsdPerTask } : null;
  const rep = repair ? { fixedVsControl: repair.vsControl.fixed, brokeVsControl: repair.vsControl.broke, hpPrecisionOnPicks: p.hpOnPicks.precision,
    carry: repair.vsControl.fixed > repair.vsControl.broke && (p.hpOnPicks.precision ?? 0) >= 0.7 } : null;
  return { primary: p.id, vsDefault: { diff: d, gains: p.vsDefault.gains, losses, mcnemarP: p.vsDefault.mcnemarP, bootstrap95: p.vsDefault.bootstrap95 }, selection, opus, repair: rep };
}

function args(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument ${argv[i]}`);
    const k = argv[i].slice(2);
    if (k === 'allow-uncommitted') a[k] = true; else a[k] = argv[++i];
  }
  return a;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const o = args(process.argv.slice(2));
    for (const k of ['selection', 'live-root', 'default', 'out']) if (!o[k]) throw new Error(`--${k} is required`);
    if (!o['allow-uncommitted'] && !committed(o.selection)) throw new Error('score: the selection file is not committed (or differs from HEAD); commit it before scoring (the blind boundary)');
    const selection = JSON.parse(readFileSync(o.selection, 'utf8'));
    const compare = Object.fromEntries((o.compare ?? '').split(',').filter(Boolean).map(s => s.split('=')));
    const res = scoreSelection({ selection, liveRoot: path.resolve(o['live-root']), defaultArm: o.default, ref: o.ref ?? null, compare, primary: o.primary ?? 'P2/R3',
      rl2Dir: o.rl2 ? path.resolve(o.rl2) : null, rl2Tag: o['rl2-tag'] ?? '', djDir: o.dj ? path.resolve(o.dj) : null,
      repair: o.repair ? JSON.parse(readFileSync(o.repair, 'utf8')) : null, strata: o.strata ? JSON.parse(readFileSync(o.strata, 'utf8')) : null,
      tasksSubset: o['tasks-subset'] ? JSON.parse(readFileSync(o['tasks-subset'], 'utf8')).tasks : null });
    res.selectionFile = o.selection; res.scoredAt = new Date().toISOString(); res.committedSelection = !o['allow-uncommitted'];
    mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
    writeFileSync(o.out, JSON.stringify(res, null, 1) + '\n');
    const line = r => `${r.id.padEnd(9)} ${String(r.pass).padStart(2)}/${r.n}  vs default ${r.vsDefault.diff >= 0 ? '+' : ''}${r.vsDefault.diff} (+${r.vsDefault.gains}/-${r.vsDefault.losses}) p=${r.vsDefault.mcnemarP} CI[${r.vsDefault.bootstrap95.join(', ')}]  $${r.cost.usdPerTask.toFixed(4)}/task`;
    console.log(res.selections.map(line).join('\n'));
  } catch (e) { console.error(e.stack ?? String(e)); process.exit(1); }
}
