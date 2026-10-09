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
// Cross-family split (--tune <otherFamilyRunDir>, review 2026-10-09): profile params are selected on the other family's
// task stream (segment labels only, no oracle; tuneCrossFamily) and this run is replayed with them, so no number in the
// replay was tuned on the tasks it scores. The counterfactual also reports net $ (minus the compiled/shadow cost a
// re-route avoids) and a paired reading (the same task in the interpreter model's agent arm).
//
// CLI: node experiments/jit/eval-profiles.mjs <runDir> [--warmup 3] [--nversion file.json] [--tune otherRunDir] [--json] [--out file.json]
import path from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { learnProfile, checkProfile, widenProfile, SIZE_FEATURES, PARAMS } from './profile.mjs';
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
// The part of a row's cost a re-route to the interpreter would not have spent: the compiled run, its shadow and adjudicator.
// Compile costs billed to the row are not avoidable (the recompile was already pending before the task); rows without a
// breakdown count their whole cost.
const AVOIDABLE = ['compiled', 'shadow', 'adjudicator'];
export const avoidableUsdOf = r => (r.costBreakdown ? AVOIDABLE.reduce((s, k) => s + (Number(r.costBreakdown[k]) || 0), 0) : Number(r.costUsd) || 0);

// rows: one arm's rows (any order); taskOf(row) -> task object; returns per-row verdicts and summaries for each policy.
// params: profile parameters (profile.mjs PARAMS shape) for every profile this replay learns; default PARAMS.
export function evaluateArm(rows, taskOf, { warmup = 3, kind = rows[0]?.kind, ignore = [], params = PARAMS } = {}) {
  const R = [...new Map(rows.map(r => [r.idx, r])).values()].sort((a, b) => a.idx - b.idx);
  const tasks = R.map(r => taskOf(r));
  const pos = new Map(R.map((r, p) => [r.idx, p]));
  const opts = { ignore };
  const base = learnProfile(tasks.slice(0, warmup).filter(Boolean), params);
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
          prof = pool.length ? learnProfile(pool, params) : base;
        }
      }
      const c = checkProfile(prof, task, opts);
      verdicts.push({ idx: r.idx, taskKey: r.taskKey, difficulty: r.difficulty ?? parseTaskKey(r.taskKey)?.difficulty ?? null, outcome: outcomeOf(r, p, warmup),
        delivered: r.delivered, deoptKind: r.deoptKind ?? null, pass: !!r.pass, costUsd: Number(r.costUsd) || 0, avoidableUsd: avoidableUsdOf(r), novel: c.novel, score: r3(c.score),
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
// netAddedUsd subtracts what the re-routed rows would not have spent (compiled run, shadow, adjudicator; avoidableUsdOf).
// pairedOf(taskKey) -> {usd, pass} (makePairedOf: the same task in the interpreter model's agent arm) gives the paired
// reading: actual cost, and passes gained or lost on exactly those tasks, instead of difficulty averages.
// Not modelled (review 2026-10-09): in a live JIT a re-route is a deopt, so two of them trigger a recompile (about $0.4-$8
// on these runs) and the new trace widens the version profile; these numbers are a lower bound on cost for JIT arms.
export function counterfactual(verdicts, priceOf, pairedOf = null) {
  const v = verdicts.filter(x => !x.skipped && x.novel && (x.outcome === 'compiled-pass' || x.outcome === 'silent-miss'));
  let addedUsd = 0, gained = 0, lost = 0, savedCompiledUsd = 0, avoidable = 0;
  const paired = { n: 0, missing: 0, usd: 0, gained: 0, lost: 0 };
  for (const x of v) {
    const pr = priceOf(x.difficulty);
    addedUsd += pr.usd ?? 0; savedCompiledUsd += x.costUsd ?? 0; avoidable += x.avoidableUsd ?? x.costUsd ?? 0;
    if (x.outcome === 'silent-miss') gained += pr.passRate ?? 0; else lost += 1 - (pr.passRate ?? 1);
    const pa = pairedOf ? pairedOf(x.taskKey) : null;
    if (!pa) { paired.missing++; continue; }
    paired.n++; paired.usd += pa.usd;
    if (x.outcome === 'silent-miss' && pa.pass) paired.gained++;
    if (x.outcome === 'compiled-pass' && !pa.pass) paired.lost++;
  }
  const all = verdicts.filter(x => !x.skipped);
  return { caught: v.filter(x => x.outcome === 'silent-miss').length, silentMisses: all.filter(x => x.outcome === 'silent-miss').length,
    correctRerouted: v.filter(x => x.outcome === 'compiled-pass').length, compiledPasses: all.filter(x => x.outcome === 'compiled-pass').length,
    addedInterpreterUsd: r3(addedUsd), compiledUsdNotSpent: r3(savedCompiledUsd), avoidableUsd: r3(avoidable), netAddedUsd: r3(addedUsd - avoidable),
    expectedPassesGained: r3(gained), expectedPassesLost: r3(lost), expectedNetPasses: r3(gained - lost),
    paired: pairedOf ? { n: paired.n, missing: paired.missing, addedUsd: r3(paired.usd), netAddedUsd: r3(paired.usd - avoidable), passesGained: paired.gained, passesLost: paired.lost, netPasses: paired.gained - paired.lost } : null };
}

// pairedOf factory: the same taskKey in the interpreter model's agent arm of the same run (null when there is none).
export function makePairedOf(arms, arm) {
  const model = interpreterModelOf(arm.meta), agent = arms.find(a => (a.meta.spec ?? '') === `agent:${model}`);
  if (!agent) return null;
  const by = new Map(agent.rows.map(r => [r.taskKey, r]));
  return key => { const r = by.get(key); return r ? { usd: Number(r.costUsd) || 0, pass: !!r.pass } : null; };
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

export async function evaluateRun(runDir, { warmup = 3, families, params = PARAMS } = {}) {
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
    const kind = a.meta.kind ?? a.rows[0]?.kind, priceOf = makePriceOf(arms, a), pairedOf = makePairedOf(arms, a);
    const all = evaluateArm(a.rows, taskOf, { warmup, kind, params }), noSize = evaluateArm(a.rows, taskOf, { warmup, kind, ignore: SIZE_FEATURES, params });
    for (const ev of [all, noSize]) for (const p of Object.values(ev.policies)) p.counterfactual = counterfactual(p.verdicts, priceOf, pairedOf);
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

export async function evaluateNVersion(nvFile, runDir, { ignore = [], params = PARAMS } = {}) {
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
    const prof = learnProfile(await Promise.all(pool.taskKeys.map(taskOfKey)), params);
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
      counterfactual: counterfactual([...wrong.map(x => ({ ...x, outcome: 'silent-miss', costUsd: 0 })), ...right.map(x => ({ ...x, outcome: 'compiled-pass', costUsd: 0 }))], priceOf, makePairedOf(arms, arm)),
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
    L.push(`| ${s.name} | v${s.version} (${s.adoptedAt}) | ${s.pool.length} | ${s.wrongNovel}/${s.wrong} | ${s.rightNovel}/${s.right} | ${d4 ? `${d4.wrongNovel}/${d4.wrong}, ${d4.rightNovel}/${d4.right}` : '–'} | ${s.refusedNovel}/${s.refused} | $${(c.addedInterpreterUsd ?? 0).toFixed(2)} (+${c.expectedPassesGained} -${c.expectedPassesLost}${c.paired ? `; paired $${c.paired.addedUsd.toFixed(2)} +${c.paired.passesGained} -${c.paired.passesLost}` : ''}) | ${Object.entries(tops).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ') || '–'} |`);
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
    '| arm | features | policy | silent misses caught | correct compiled answers turned into deopts | + interpreter $ (net of avoided compiled/shadow $) | expected passes +gained -lost (net) | paired (same task, agent arm): + $ net, passes +gained -lost |', '|---|---|---|---|---|---|---|---|');
  for (const a of res.arms) for (const [feat, ev] of [['all', a.all], ['no-size', a.noSize]]) for (const [policy, { counterfactual: c }] of Object.entries(ev.policies)) {
    if (a.kind === 'agent' || !c) continue;
    const pd = c.paired ? `$${(c.paired.netAddedUsd ?? 0).toFixed(2)}, +${c.paired.passesGained} -${c.paired.passesLost}${c.paired.missing ? ` (${c.paired.missing} unpaired)` : ''}` : '–';
    L.push(`| ${short(a.spec)} | ${feat} | ${policy} | ${c.caught}/${c.silentMisses} | ${c.correctRerouted}/${c.compiledPasses} | $${(c.addedInterpreterUsd ?? 0).toFixed(2)} ($${(c.netAddedUsd ?? 0).toFixed(2)}) | +${c.expectedPassesGained} -${c.expectedPassesLost} (${c.expectedNetPasses}) | ${pd} |`);
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------------------------------- cross-family tuning
// Review 2026-10-09: PARAMS were set while looking at these same dev streams, so in-family numbers are optimistic. This
// selects profile parameters on one family's task stream and scores them, frozen, on the other's. The objective uses no
// oracle and no arm outcome: the stream's difficulty segments only (normal = the first row's difficulty, drift = the
// other), J = mean over the 'frozen' and 'baseline' policies of (drift novel rate - normal novel rate). Ties go to the
// lower normal rate, then to the point nearest PARAMS (fewest changed coordinates), then to the key. Observation is
// independent of params (profile.mjs), so each policy's profile sequence is learned once and re-checked per grid point.
export const TUNE_GRID = Object.freeze({
  'rate.k': [1, 2, 4], 'numMargin.span': [0.25, 0.5, 1], 'numMargin.rel': [0.1, 0.25, 0.5],
  'countMargin.span': [0.1, 0.25, 0.5], 'countMargin.rel': [0.05, 0.15, 0.3], enumGT: [0.1, 0.2, 0.35],
});
const getPath = (o, k) => k.split('.').reduce((x, p) => x?.[p], o);
export function paramsOf(point, base = PARAMS) {
  const out = JSON.parse(JSON.stringify(base));
  for (const [k, v] of Object.entries(point)) { const ks = k.split('.'), last = ks.pop(); ks.reduce((x, p) => x[p], out)[last] = v; }
  return out;
}
export function gridPoints(grid = TUNE_GRID) {
  let pts = [{}];
  for (const [k, vs] of Object.entries(grid)) pts = pts.flatMap(p => vs.map(v => ({ ...p, [k]: v })));
  return pts;
}
const pointKey = pt => Object.entries(pt).map(([k, v]) => `${k}=${v}`).join(' ');
const changedFromDefault = pt => Object.entries(pt).filter(([k, v]) => getPath(PARAMS, k) !== v).length;

// The checks a stream implies under 'frozen' and 'baseline' (rows: one arm's rows; any arm of a run sees the same stream).
export function streamChecks(rows, taskOf, { warmup = 3 } = {}) {
  const R = [...new Map(rows.map(r => [r.idx, r])).values()].sort((a, b) => a.idx - b.idx);
  const diffOf = r => r?.difficulty ?? parseTaskKey(r?.taskKey)?.difficulty ?? null, baseD = diffOf(R[0]);
  const tasks = R.map(taskOf), base = learnProfile(tasks.slice(0, warmup).filter(Boolean));
  const out = { frozen: [], baseline: [] };
  let wide = base;
  for (let p = warmup; p < R.length; p++) {
    const t = tasks[p];
    if (!t) continue;
    const drift = diffOf(R[p]) !== baseD;
    out.frozen.push({ idx: R[p].idx, drift, profile: base, task: t });
    out.baseline.push({ idx: R[p].idx, drift, profile: wide, task: t });
    if (!drift) wide = widenProfile(wide, t);
  }
  return out;
}

export function scoreChecks(checks, params, { ignore = [] } = {}) {
  const per = {};
  for (const [policy, cs] of Object.entries(checks)) {
    let n0 = 0, f0 = 0, n1 = 0, f1 = 0;
    for (const c of cs) {
      const novel = checkProfile({ ...c.profile, params }, c.task, { ignore }).novel;
      if (c.drift) { n1++; f1 += novel; } else { n0++; f0 += novel; }
    }
    per[policy] = { normal: `${f0}/${n0}`, drift: `${f1}/${n1}`, fa: rate(f0, n0), recall: rate(f1, n1), j: r3((n1 ? f1 / n1 : 0) - (n0 ? f0 / n0 : 0)) };
  }
  const ps = Object.values(per), mean = k => r3(ps.reduce((s, x) => s + (x[k] ?? 0), 0) / ps.length);
  return { j: mean('j'), fa: mean('fa'), recall: mean('recall'), per };
}

// streams: [{ family, checks }] (two or more). Returns, for each train family and each other (test) family, the selected
// point and its train and test scores, next to PARAMS and to the test family's own best point (an in-sample upper bound).
export function tuneCrossFamily(streams, { grid = TUNE_GRID, ignore = [] } = {}) {
  const pts = gridPoints(grid), scored = new Map();
  for (const s of streams) scored.set(s.family, pts.map(pt => ({ pt, key: pointKey(pt), ...scoreChecks(s.checks, paramsOf(pt), { ignore }) })));
  const best = rows => [...rows].sort((a, b) => b.j - a.j || a.fa - b.fa || changedFromDefault(a.pt) - changedFromDefault(b.pt) || a.key.localeCompare(b.key))[0];
  const defaultKey = pointKey(Object.fromEntries(Object.keys(grid).map(k => [k, getPath(PARAMS, k)])));
  const out = [];
  for (const tr of streams) for (const te of streams) {
    if (tr === te) continue;
    const sel = best(scored.get(tr.family)), onTest = scored.get(te.family).find(x => x.key === sel.key);
    const def = scored.get(te.family).find(x => x.key === defaultKey) ?? { ...scoreChecks(te.checks, PARAMS, { ignore }), key: 'PARAMS' };
    const defTrain = scored.get(tr.family).find(x => x.key === defaultKey) ?? { ...scoreChecks(tr.checks, PARAMS, { ignore }), key: 'PARAMS' };
    const teBest = best(scored.get(te.family));
    const tied = scored.get(tr.family).filter(x => x.j === sel.j).length;
    out.push({ train: tr.family, test: te.family, ignore, gridSize: pts.length, tiedAtTrainOptimum: tied,
      selected: { point: sel.pt, train: strip(sel), test: strip(onTest) }, defaults: { train: strip(defTrain), test: strip(def) }, testBest: { point: teBest.pt, test: strip(teBest) } });
  }
  return out;
}
const strip = x => ({ j: x.j, fa: x.fa, recall: x.recall, per: x.per });

// One family's stream from a run directory: the longest agent arm (else the longest arm), tasks regenerated (dev only).
export async function loadStream(runDir) {
  const { makeTasks } = await import('../lib/beds.mjs');
  const arms = loadArms(runDir), arm = [...arms].sort((a, b) => (b.meta.kind === 'agent') - (a.meta.kind === 'agent') || b.rows.length - a.rows.length)[0];
  const cache = new Map();
  for (const r of arm.rows) {
    const k = parseTaskKey(r.taskKey);
    if (!k || k.split !== 'dev') throw new Error(`eval-profiles: ${r.taskKey} is not on the dev split`);
    const [t] = await makeTasks(k.familyId, { split: k.split, seeds: [k.seed], difficulty: k.difficulty });
    if (r.taskHash && t.taskHash !== r.taskHash) throw new Error(`${r.taskKey}: regenerated task hash differs from the row's`);
    cache.set(r.taskKey, { prompt: t.task.prompt, inputs: t.task.inputs, ...(t.task.files ? { files: t.task.files } : {}) });
  }
  return { family: parseTaskKey(arm.rows[0]?.taskKey)?.familyId ?? path.basename(runDir), arm: arm.meta.spec ?? arm.meta.slug, rows: arm.rows, taskOf: r => cache.get(r.taskKey) ?? null };
}

export function renderTune(results) {
  const f = x => `J ${x.j} (normal ${x.per.frozen.normal} / ${x.per.baseline.normal}, drift ${x.per.frozen.drift} / ${x.per.baseline.drift})`;
  const L = ['', '## Cross-family parameter selection (no oracle: segment labels only; frozen / baseline policies)', '',
    '| features | train -> test | selected point (changed from PARAMS) | ties at train optimum | train score | test score | PARAMS on test | test family\'s own best (in-sample) |', '|---|---|---|---|---|---|---|---|'];
  for (const r of results) {
    const changed = Object.entries(r.selected.point).filter(([k, v]) => getPath(PARAMS, k) !== v).map(([k, v]) => `${k}=${v}`).join(', ') || 'none (= PARAMS)';
    L.push(`| ${r.ignore.length ? 'no-size' : 'all'} | ${r.train} -> ${r.test} | ${changed} | ${r.tiedAtTrainOptimum}/${r.gridSize} | ${f(r.selected.train)} | ${f(r.selected.test)} | ${f(r.defaults.test)} | ${f(r.testBest.test)} |`);
  }
  return L.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const valued = ['--nversion', '--out', '--warmup', '--tune'];
  const args = process.argv.slice(2), dir = args.find((a, i) => !a.startsWith('--') && !/^\d+$/.test(a) && !valued.includes(args[i - 1]));
  const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  if (!dir || !existsSync(dir)) { console.error('usage: node experiments/jit/eval-profiles.mjs <runDir> [--warmup 3] [--nversion file.json] [--tune <otherFamilyRunDir>] [--json] [--out file.json]'); process.exit(2); }
  const warmup = Number(val('--warmup', 3));
  // --tune: select params on the other family's stream (both feature sets), then evaluate this run with them.
  let tune = null, pAll = PARAMS, pNo = PARAMS;
  if (val('--tune')) {
    const streams = [];
    for (const d of [path.resolve(dir), path.resolve(val('--tune'))]) { const st = await loadStream(d); streams.push({ family: st.family, arm: st.arm, checks: streamChecks(st.rows, st.taskOf, { warmup }) }); }
    tune = [...tuneCrossFamily(streams), ...tuneCrossFamily(streams, { ignore: SIZE_FEATURES })];
    const pick = ig => tune.find(t => t.test === streams[0].family && (t.ignore.length > 0) === ig).selected.point;
    pAll = paramsOf(pick(false)); pNo = paramsOf(pick(true));
  }
  const res = await evaluateRun(path.resolve(dir), { warmup, params: pAll });
  if (tune) {
    const noSize = await evaluateRun(path.resolve(dir), { warmup, params: pNo });
    res.arms.forEach((a, i) => { a.noSize = noSize.arms[i].noSize; });
    res.tune = tune; res.params = { all: pAll, noSize: pNo, note: 'selected on the other family (cross-family split)' };
  }
  if (val('--nversion')) {
    res.nversion = await evaluateNVersion(path.resolve(val('--nversion')), path.resolve(dir), { params: pAll });
    res.nversionNoSize = await evaluateNVersion(path.resolve(val('--nversion')), path.resolve(dir), { ignore: SIZE_FEATURES, params: pNo });
  }
  if (val('--out')) writeFileSync(val('--out'), JSON.stringify(res, null, 1));
  if (args.includes('--json')) console.log(JSON.stringify(res, null, 1));
  else {
    if (tune) console.log(renderTune(tune), '\n\nThe replay below uses the params selected on the other family.\n');
    console.log(renderEval(res));
    if (res.nversion) console.log(renderNVersion(res.nversion), '\n\nWithout size features:', renderNVersion(res.nversionNoSize));
  }
}
