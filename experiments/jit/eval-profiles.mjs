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
// - version  JIT arms: the domain of the compiled version that is about to run: the tasks of the trace pool it was
//            compiled from (stateAfter.traces of the row before its adoption) plus every later task on which it ran
//            and a shadow agreed with it. The profile widens only when the solver does (a recompile) or when an
//            independent check confirmed the solver on that input; an interpretation alone never widens it.
// Read as a router (novel -> interpreter instead of compiled code), a policy's numbers are the compiled deliveries it
// would have re-routed and the silent misses among them. Each policy runs with every feature ('all') and without the
// size features ('no-size': array lengths, string lengths, line counts), to separate "more input" from "different input".
//
// CLI: node experiments/jit/eval-profiles.mjs <runDir> [--warmup 3] [--json] [--out file.json]
import path from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { learnProfile, checkProfile, widenProfile, SIZE_FEATURES } from './profile.mjs';
import { loadArms } from './durability.mjs';

export const POLICIES = Object.freeze(['frozen', 'interp', 'version']);
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
        delivered: r.delivered, deoptKind: r.deoptKind ?? null, pass: !!r.pass, novel: c.novel, score: r3(c.score),
        reasons: c.reasons.slice(0, 4).map(x => `${x.feature}${x.path ? `@${x.path}` : ''}`) });
      if (policy === 'interp' && handledByInterpreter(r)) prof = widenProfile(prof, task);
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
    const kind = a.meta.kind ?? a.rows[0]?.kind;
    result.arms.push({ spec: a.meta.spec ?? a.meta.slug, kind,
      all: evaluateArm(a.rows, taskOf, { warmup, kind }), noSize: evaluateArm(a.rows, taskOf, { warmup, kind, ignore: SIZE_FEATURES }) });
  }
  return result;
}

export function renderEval(res) {
  const short = s => String(s).replace(/^static:.*\/([^/]+)\/solve\.mjs$/, 'static:$1');
  const pct = x => (x == null ? '–' : `${(100 * x).toFixed(0)}%`);
  const L = [`# Input-profile replay: ${res.runDir}`, '', `Evidence: ${res.evidence}. Warmup ${res.warmup} rows build the profile. Recall/false alarms use the oracle (experimenter's view).`, ''];
  if (res.problems.length) L.push(...res.problems.map(p => `- problem: ${p}`), '');
  L.push('| arm | features | policy | novel / checked | novel by difficulty (first idx) | deopts novel | silent misses novel (recall) | compiled passes novel (false alarm) | overruled novel | top reasons |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const a of res.arms) for (const [feat, ev] of [['all', a.all], ['no-size', a.noSize]]) for (const [policy, { summary: s }] of Object.entries(ev.policies)) {
    if (a.kind === 'agent' && policy !== 'frozen') continue;
    const diff = Object.entries(s.byDifficulty).map(([d, x]) => `${d} ${x.novel}/${x.checked}${x.firstNovelIdx != null ? ` (${x.firstNovelIdx})` : ''}`).join(', ');
    const top = Object.entries(s.reasonsByFeature).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([f, c]) => `${f} ${c}`).join(', ') || '–';
    L.push(`| ${short(a.spec)} | ${feat} | ${policy} | ${s.novel}/${s.checked} | ${diff} | ${s.deoptsNovel}/${s.deopts} | ${s.silentMissesNovel}/${s.silentMisses} (${pct(s.recallOnSilentMisses)}) | ${s.compiledPassesNovel}/${s.compiledPasses} (${pct(s.falseAlarmRate)}) | ${s.overruledNovel}/${s.overruled} | ${top} |`);
  }
  return L.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), dir = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a));
  const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  if (!dir || !existsSync(dir)) { console.error('usage: node experiments/jit/eval-profiles.mjs <runDir> [--warmup 3] [--json] [--out file.json]'); process.exit(2); }
  const res = await evaluateRun(path.resolve(dir), { warmup: Number(val('--warmup', 3)) });
  if (val('--out')) writeFileSync(val('--out'), JSON.stringify(res, null, 1));
  console.log(args.includes('--json') ? JSON.stringify(res, null, 1) : renderEval(res));
}
