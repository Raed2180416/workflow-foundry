// Offline, $0 evaluation of input profiles (profile.mjs) on a finished JIT stream run (development code). For every arm it
// regenerates each row's task from its taskKey (dev split only: a test-split run is refused, since held-out task text is
// never opened outside the stream), replays the stream in order and asks: had a profile been checked before each task,
// which tasks would it have called novel, and how does that line up with what actually happened (deopts, silent
// compiled misses, overruled answers)? No model call, no solver run. The oracle's pass/fail on rows is the experimenter's
// view and is used only to score the profile here, never to build it.
//
// Policies (each a profile over the same stream; the first `warmup` rows of the arm only build the initial one):
// - frozen   learn from the first `warmup` tasks, never widen. The static-solver question (DEV-NOTES D5): would a
//            fence learned once have signalled the drift segment? For a static arm this is also the version policy.
// - interp   frozen, then widen with every task the interpreter handled in the stream (a row delivered by the
//            interpreter or adjudicated). The naive policy: the profile follows the stream, not the solver.
// - baseline frozen, then widen with every task of the stream's baseline difficulty (the first row's: d3 records, d4
//            kinetics) once it has been checked, whatever happened on it: "everything normal seen so far". It reads the
//            difficulty label, which a deployed system would not have, so it is the experimenter's reference fence for
//            "does the drift segment look different from the normal regime", not a deployable policy.
// - version  JIT arms: the domain of the compiled version that is about to run: the tasks of the trace pool it was
//            compiled from (stateAfter.traces of the row before its adoption) plus every later task on which it ran
//            and a shadow agreed with it. The profile widens only when the solver does (a recompile) or when an
//            independent check confirmed the solver on that input; an interpretation alone never widens it.
// Read as a router (novel -> interpreter instead of compiled code), a policy's numbers are the compiled deliveries it
// would have re-routed and the silent misses among them. Each policy runs with every feature ('all') and without the
// size features ('no-size': array lengths, string lengths, line counts), to separate "more input" from "different input".
//
// N-version mode (--nversion <file>, the probe in research/jit-20261008/nversion-records-dev.json): each compiled solver
// there ran on every task of the stream, including tasks outside its domain. Each solver gets its version profile (the
// trace pool it was compiled from, found through its arm's rows) and every task is checked against it; the question is
// D9's: of the tasks a solver answered wrongly, how many would its own profile have refused?
//
// CLI: node experiments/jit/eval-profiles.mjs <runDir> [--warmup 3] [--nversion file.json] [--json] [--out file.json]
import path from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { learnProfile, checkProfile, widenProfile, SIZE_FEATURES } from './profile.mjs';
import { loadArms } from './durability.mjs';

export const POLICIES = Object.freeze(['frozen', 'baseline', 'interp', 'version']);
const r3 = x => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const rate = (a, b) => (b ? r3(a / b) : null);

export function parseTaskKey(key) {
  const m = /^(.+):([a-z]+):d(\d+):s(\d+)$/.exec(String(key ?? ''));
  return m ? { familyId: m[1], split: m[2], difficulty: Number(m[3]), seed: Number(m[4]) } : null;
}

// What happened on a row, from the stream's own fields.
export function outcomeOf(row, position, warmup) {
  if (position < warmup) return 'warmup';
  if (row.compiledStatus == null) return 'interpreted';
  if (row.compiledStatus !== 'ok') return 'deopt';
  if (row.delivered === 'adjudicated') return 'overruled';
  if (row.delivered === 'compiled') return row.pass ? 'compiled-pass' : 'silent-miss';
  return 'other';
}
const handledByInterpreter = row => row.delivered === 'interpreter' || row.delivered === 'adjudicated';

// rows: one arm's rows (any order); taskOf(row) -> task object; returns per-row verdicts and summaries for each policy.
export function evaluateArm(rows, taskOf, { warmup = 3, kind = rows[0]?.kind, ignore = [] } = {}) {
  const R = [...new Map(rows.map(r => [r.idx, r])).values()].sort((a, b) => a.idx - b.idx);
  const tasks = R.map(r => taskOf(r));
  const pos = new Map(R.map((r, p) => [r.idx, p]));
  const opts = { ignore };
  const base = learnProfile(tasks.slice(0, warmup).filter(Boolean));
  const diffOf = r => r?.difficulty ?? parseTaskKey(r?.taskKey)?.difficulty ?? null, baseD = diffOf(R[0]);
  const out = {};
  for (const policy of POLICIES) {
    if (policy === 'version' && kind !== 'jit') continue;
    let prof = base, cur = null;
    const verdicts = [];
    for (let p = warmup; p < R.length; p++) {
      const r = R[p], task = tasks[p];
      if (!task) { verdicts.push({ idx: r.idx, skipped: 'no task' }); continue; }
      if (policy === 'version') {
        const v = r.stateAfter?.version ?? null;
        if (v && v.n !== cur) {   // a new version: its compile pool is the state before the task it was adopted at
          cur = v.n;
          const before = R[(pos.get(v.adoptedAt) ?? p) - 1]?.stateAfter?.traces ?? [];
          const pool = before.map(t => pos.get(t.idx)).filter(q => q != null && tasks[q]).map(q => tasks[q]);
          prof = pool.length ? learnProfile(pool) : base;
        }
      }
      const c = checkProfile(prof, task, opts);
      verdicts.push({ idx: r.idx, taskKey: r.taskKey, difficulty: r.difficulty ?? parseTaskKey(r.taskKey)?.difficulty ?? null, outcome: outcomeOf(r, p, warmup),
        delivered: r.delivered, deoptKind: r.deoptKind ?? null, pass: !!r.pass, costUsd: Number(r.costUsd) || 0, novel: c.novel, score: r3(c.score),
        reasons: c.reasons.slice(0, 4).map(x => `${x.feature}${x.path ? `@${x.path}` : ''}`) });
      if (policy === 'interp' && handledByInterpreter(r)) prof = widenProfile(prof, task);
      if (policy === 'baseline' && baseD != null && diffOf(r) === baseD) prof = widenProfile(prof, task);
      if (policy === 'version' && r.version === cur && (r.events ?? []).some(e => e.kind === 'shadow' && e.agree === true)) prof = widenProfile(prof, task);
    }
    out[policy] = { verdicts, summary: summarize(verdicts) };
  }
  return { tasks: R.length, warmup, policies: out };
}

export function summarize(verdicts) {
  const v = verdicts.filter(x => !x.skipped), by = o => v.filter(x => x.outcome === o);
  const novel = v.filter(x => x.novel);
  const pass = by('compiled-pass'), miss = by('silent-miss'), deopt = by('deopt'), over = by('overruled');
  const n = xs => xs.filter(x => x.novel).length;
  const byDifficulty = {};
  for (const x of v) {
    const d = byDifficulty[`d${x.difficulty}`] ??= { checked: 0, novel: 0, firstNovelIdx: null };
    d.checked++; if (x.novel) { d.novel++; d.firstNovelIdx ??= x.idx; }
  }
  for (const d of Object.values(byDifficulty)) d.novelRate = rate(d.novel, d.checked);
  const features = {};
  for (const x of novel) for (const f of new Set(x.reasons.map(s => s.split('@')[0]))) features[f] = (features[f] ?? 0) + 1;
  return {
    checked: v.length, novel: novel.length, novelRate: rate(novel.length, v.length), byDifficulty,
    // Oracle view (experimenter only): how novelty lines up with the compiled path's outcomes.
    silentMisses: miss.length, silentMissesNovel: n(miss), recallOnSilentMisses: rate(n(miss), miss.length),
    compiledPasses: pass.length, compiledPassesNovel: n(pass), falseAlarmRate: rate(n(pass), pass.length),
    precisionOnCompiled: rate(n(miss), n(miss) + n(pass)),
    overruled: over.length, overruledNovel: n(over),
    // System view: does the profile agree with the solver's own refusals?
    deopts: deopt.length, deoptsNovel: n(deopt), agreementWithDeopts: rate(n(deopt), deopt.length),
    // As a router (gate policy reading): compiled deliveries it would re-route, and the silent misses among them.
    reroutedCompiled: n(pass) + n(miss) + n(over), silentMissesAvoided: n(miss), silentMissesLeft: miss.length - n(miss),
    reasonsByFeature: features,
  };
}

// Deopt-on-novelty counterfactual (oracle view): every novel compiled delivery (pass or silent miss) is re-routed to the
// arm's interpreter instead. price(d) and passRate(d) come from priceOf (the interpreter model's agent arm in the same
// run at that difficulty, else the arm's own interpreter-only rows). Overruled rows already paid an interpreter and are
// left out. Expected passes: a caught silent miss gains passRate(d); a rerouted correct answer loses 1 - passRate(d).
export function counterfactual(verdicts, priceOf) {
  const v = verdicts.filter(x => !x.skipped && x.novel && (x.outcome === 'compiled-pass' || x.outcome === 'silent-miss'));
  let addedUsd = 0, gained = 0, lost = 0, savedCompiledUsd = 0;
  for (const x of v) {
    const pr = priceOf(x.difficulty);
    addedUsd += pr.usd ?? 0; savedCompiledUsd += x.costUsd ?? 0;
    if (x.outcome === 'silent-miss') gained += pr.passRate ?? 0; else lost += 1 - (pr.passRate ?? 1);
  }
  const all = verdicts.filter(x => !x.skipped);
  return { caught: v.filter(x => x.outcome === 'silent-miss').length, silentMisses: all.filter(x => x.outcome === 'silent-miss').length,
    correctRerouted: v.filter(x => x.outcome === 'compiled-pass').length, compiledPasses: all.filter(x => x.outcome === 'compiled-pass').length,
    addedInterpreterUsd: r3(addedUsd), compiledUsdNotSpent: r3(savedCompiledUsd), expectedPassesGained: r3(gained), expectedPassesLost: r3(lost), expectedNetPasses: r3(gained - lost) };
}

export function interpreterModelOf(meta) {
  const spec = String(meta?.spec ?? '');
  if (spec.startsWith('jit:')) return spec.slice(4).split('/')[0];
  if (spec.startsWith('agent:')) return spec.slice(6);
  return meta?.def?.fallback ?? null;
}

// priceOf factory for one arm: the interpreter model's agent arm in the same run (by difficulty), else this arm's own
// interpreter-only rows (compiledStatus null, any difficulty).
export function makePriceOf(arms, arm) {
  const model = interpreterModelOf(arm.meta), agent = arms.find(a => (a.meta.spec ?? '') === `agent:${model}`);
  const stat = rows => rows.length ? { usd: rows.reduce((s, r) => s + (Number(r.costUsd) || 0), 0) / rows.length, passRate: rows.filter(r => r.pass).length / rows.length, n: rows.length } : null;
  const own = stat(arm.rows.filter(r => r.compiledStatus == null && r.delivered === 'interpreter'));
  return d => {
    const a = agent ? stat(agent.rows.filter(r => (r.difficulty ?? parseTaskKey(r.taskKey)?.difficulty) === d)) : null;
    return a ? { ...a, model, source: `agent:${model} d${d}` } : own ? { ...own, model, source: 'own interpreter rows' } : { usd: null, passRate: null, model, source: 'none' };
  };
}

export async function evaluateRun(runDir, { warmup = 3, families } = {}) {
  const { makeTasks } = await import('../lib/beds.mjs');
  const arms = loadArms(runDir), cache = new Map(), problems = [];
  for (const a of arms) for (const r of a.rows) {
    const k = parseTaskKey(r.taskKey);
    if (!k) { problems.push(`unparseable taskKey ${r.taskKey}`); continue; }
    if (k.split !== 'dev') throw new Error(`eval-profiles: ${r.taskKey} is not on the dev split; held-out task text is not opened here`);
    if (families && !families.includes(k.familyId)) continue;
    if (cache.has(r.taskKey)) continue;
    const [t] = await makeTasks(k.familyId, { split: k.split, seeds: [k.seed], difficulty: k.difficulty });
    if (r.taskHash && t.taskHash !== r.taskHash) { problems.push(`${r.taskKey}: regenerated task hash differs from the row's (bed changed?); skipped`); cache.set(r.taskKey, null); continue; }
    cache.set(r.taskKey, { prompt: t.task.prompt, inputs: t.task.inputs, ...(t.task.files ? { files: t.task.files } : {}) });
  }
  const taskOf = r => cache.get(r.taskKey) ?? null;
  const result = { runDir, warmup, evidence: 'development / diagnostic (dev split; oracle used only to score the profile)', problems: [...new Set(problems)], arms: [] };
  for (const a of arms) {
    const kind = a.meta.kind ?? a.rows[0]?.kind, priceOf = makePriceOf(arms, a);
    const all = evaluateArm(a.rows, taskOf, { warmup, kind }), noSize = evaluateArm(a.rows, taskOf, { warmup, kind, ignore: SIZE_FEATURES });
    for (const ev of [all, noSize]) for (const p of Object.values(ev.policies)) p.counterfactual = counterfactual(p.verdicts, priceOf);
    const ds = [...new Set(a.rows.map(r => r.difficulty))].sort();
    result.arms.push({ spec: a.meta.spec ?? a.meta.slug, kind, interpreter: Object.fromEntries(ds.map(d => [`d${d}`, priceOf(d)])), all, noSize });
  }
  return result;
}

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export function versionPoolTasks(rows, versionDir) {
  const R = [...new Map(rows.map(r => [r.idx, r])).values()].sort((a, b) => a.idx - b.idx);
  const at = R.find(r => r.stateAfter?.version?.dir === versionDir);
  if (!at) return null;
  const adoptedAt = at.stateAfter.version.adoptedAt, before = R.filter(r => r.idx < adoptedAt).at(-1);
  const byIdx = new Map(R.map(r => [r.idx, r.taskKey]));
  return { version: at.stateAfter.version.n, adoptedAt, taskKeys: (before?.stateAfter?.traces ?? []).map(t => byIdx.get(t.idx)).filter(Boolean) };
}

export async function evaluateNVersion(nvFile, runDir, { ignore = [] } = {}) {
  const { readFileSync } = await import('node:fs');
  const { makeTasks } = await import('../lib/beds.mjs');
  const nv = JSON.parse(readFileSync(nvFile, 'utf8'));
  const arms = loadArms(runDir), cache = new Map();
  const taskOfKey = async key => {
    if (cache.has(key)) return cache.get(key);
    const k = parseTaskKey(key);
    if (!k || k.split !== 'dev') throw new Error(`eval-profiles: ${key} is not on the dev split`);
    const [t] = await makeTasks(k.familyId, { split: k.split, seeds: [k.seed], difficulty: k.difficulty });
    const v = { prompt: t.task.prompt, inputs: t.task.inputs, ...(t.task.files ? { files: t.task.files } : {}) };
    cache.set(key, v); return v;
  };
  const out = [];
  for (const [name, solverPath] of Object.entries(nv.summary?.solvers ?? {})) {
    const abs = path.resolve(REPO, solverPath), versionDir = path.relative(path.dirname(path.dirname(path.dirname(abs))), path.dirname(abs));
    const arm = arms.find(a => abs.startsWith(a.dir + path.sep));
    const pool = arm ? versionPoolTasks(arm.rows, versionDir) : null;
    if (!pool || !pool.taskKeys.length) { out.push({ name, solverPath, problem: 'version pool not found in the run' }); continue; }
    const prof = learnProfile(await Promise.all(pool.taskKeys.map(taskOfKey)));
    const per = [];
    for (const row of nv.rows ?? []) {
      const run = row.runs?.[name];
      if (!run) continue;
      const c = checkProfile(prof, await taskOfKey(row.taskKey), { ignore });
      per.push({ taskKey: row.taskKey, difficulty: row.difficulty, inPool: pool.taskKeys.includes(row.taskKey), status: run.status, pass: run.pass, novel: c.novel,
        reasons: c.reasons.slice(0, 3).map(x => `${x.feature}${x.path ? `@${x.path}` : ''}`) });
    }
    const priceOf = makePriceOf(arms, arm);
    const ans = per.filter(x => x.status === 'ok' && !x.inPool), wrong = ans.filter(x => x.pass === false), right = ans.filter(x => x.pass === true), ref = per.filter(x => x.status !== 'ok' && !x.inPool);
    out.push({ name, solverPath, version: pool.version, adoptedAt: pool.adoptedAt, pool: pool.taskKeys,
      answered: ans.length, wrong: wrong.length, wrongNovel: wrong.filter(x => x.novel).length, right: right.length, rightNovel: right.filter(x => x.novel).length,
      refused: ref.length, refusedNovel: ref.filter(x => x.novel).length,
      byDifficulty: Object.fromEntries([...new Set(ans.map(x => x.difficulty))].sort().map(d => { const w = wrong.filter(x => x.difficulty === d), g = right.filter(x => x.difficulty === d);
        return [`d${d}`, { wrong: w.length, wrongNovel: w.filter(x => x.novel).length, right: g.length, rightNovel: g.filter(x => x.novel).length }]; })),
      counterfactual: counterfactual([...wrong.map(x => ({ ...x, outcome: 'silent-miss', costUsd: 0 })), ...right.map(x => ({ ...x, outcome: 'compiled-pass', costUsd: 0 }))], priceOf),
      interpreter: priceOf(4), perTask: per });
  }
  return { nvFile, evidence: 'development / diagnostic (dev split; tasks in a solver\'s own compile pool are left out of its counts)', solvers: out };
}

export function renderNVersion(res) {
  const L = ['', `## Version profiles on the N-version probe (${path.basename(res.nvFile)})`, '', res.evidence, '',
    '| solver | v (adopted at) | pool | answered: wrong novel / wrong | answered: right novel / right | d4: wrong novel / wrong, right novel / right | refused (deopt/crash): novel / refused | deopt-on-novelty: + interpreter $ (expected passes +gained -lost) | top reasons on wrong answers |', '|---|---|---|---|---|---|---|---|---|'];
  for (const s of res.solvers) {
    if (s.problem) { L.push(`| ${s.name} | – | – | ${s.problem} | | | | | |`); continue; }
    const tops = {};
    for (const x of s.perTask.filter(x => x.status === 'ok' && x.pass === false && !x.inPool)) for (const r of x.reasons) tops[r] = (tops[r] ?? 0) + 1;
    const d4 = s.byDifficulty.d4, c = s.counterfactual;
    L.push(`| ${s.name} | v${s.version} (${s.adoptedAt}) | ${s.pool.length} | ${s.wrongNovel}/${s.wrong} | ${s.rightNovel}/${s.right} | ${d4 ? `${d4.wrongNovel}/${d4.wrong}, ${d4.rightNovel}/${d4.right}` : '–'} | ${s.refusedNovel}/${s.refused} | $${(c.addedInterpreterUsd ?? 0).toFixed(2)} (+${c.expectedPassesGained} -${c.expectedPassesLost}) | ${Object.entries(tops).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ') || '–'} |`);
  }
  return L.join('\n');
}

export function renderEval(res) {
  const short = s => String(s).replace(/^static:.*\/([^/]+)\/solve\.mjs$/, 'static:$1');
  const pct = x => (x == null ? '–' : `${(100 * x).toFixed(0)}%`);
  const L = [`# Input-profile replay: ${res.runDir}`, '', `Evidence: ${res.evidence}. Warmup ${res.warmup} rows build the profile. Recall/false alarms use the oracle (experimenter's view).`, ''];
  if (res.problems.length) L.push(...res.problems.map(p => `- problem: ${p}`), '');
  L.push('| arm | features | policy | novel / checked | novel by difficulty (first idx) | deopts novel | silent misses novel (recall) | compiled passes novel (false alarm) | overruled novel | top reasons |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const a of res.arms) for (const [feat, ev] of [['all', a.all], ['no-size', a.noSize]]) for (const [policy, { summary: s }] of Object.entries(ev.policies)) {
    if (a.kind === 'agent' && policy !== 'frozen' && policy !== 'baseline') continue;
    const diff = Object.entries(s.byDifficulty).map(([d, x]) => `${d} ${x.novel}/${x.checked}${x.firstNovelIdx != null ? ` (${x.firstNovelIdx})` : ''}`).join(', ');
    const top = Object.entries(s.reasonsByFeature).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([f, c]) => `${f} ${c}`).join(', ') || '–';
    L.push(`| ${short(a.spec)} | ${feat} | ${policy} | ${s.novel}/${s.checked} | ${diff} | ${s.deoptsNovel}/${s.deopts} | ${s.silentMissesNovel}/${s.silentMisses} (${pct(s.recallOnSilentMisses)}) | ${s.compiledPassesNovel}/${s.compiledPasses} (${pct(s.falseAlarmRate)}) | ${s.overruledNovel}/${s.overruled} | ${top} |`);
  }
  L.push('', '## Deopt-on-novelty counterfactual (novel compiled delivery -> interpreter; oracle view)', '',
    'Price and pass rate per difficulty: the interpreter model\'s agent arm in this run at that difficulty (else the arm\'s own interpreter-only rows).', '',
    '| arm | features | policy | silent misses caught | correct compiled answers turned into deopts | + interpreter $ | expected passes +gained -lost (net) |', '|---|---|---|---|---|---|---|');
  for (const a of res.arms) for (const [feat, ev] of [['all', a.all], ['no-size', a.noSize]]) for (const [policy, { counterfactual: c }] of Object.entries(ev.policies)) {
    if (a.kind === 'agent' || !c) continue;
    L.push(`| ${short(a.spec)} | ${feat} | ${policy} | ${c.caught}/${c.silentMisses} | ${c.correctRerouted}/${c.compiledPasses} | $${(c.addedInterpreterUsd ?? 0).toFixed(2)} | +${c.expectedPassesGained} -${c.expectedPassesLost} (${c.expectedNetPasses}) |`);
  }
  return L.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), dir = args.find((a, i) => !a.startsWith('--') && !/^\d+$/.test(a) && !['--nversion', '--out', '--warmup'].includes(args[i - 1]));
  const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  if (!dir || !existsSync(dir)) { console.error('usage: node experiments/jit/eval-profiles.mjs <runDir> [--warmup 3] [--json] [--out file.json]'); process.exit(2); }
  const res = await evaluateRun(path.resolve(dir), { warmup: Number(val('--warmup', 3)) });
  if (val('--nversion')) {
    res.nversion = await evaluateNVersion(path.resolve(val('--nversion')), path.resolve(dir));
    res.nversionNoSize = await evaluateNVersion(path.resolve(val('--nversion')), path.resolve(dir), { ignore: SIZE_FEATURES });
  }
  if (val('--out')) writeFileSync(val('--out'), JSON.stringify(res, null, 1));
  if (args.includes('--json')) console.log(JSON.stringify(res, null, 1));
  else {
    console.log(renderEval(res));
    if (res.nversion) console.log(renderNVersion(res.nversion), '\n\nWithout size features:', renderNVersion(res.nversionNoSize));
  }
}
