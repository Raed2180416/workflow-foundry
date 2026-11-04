// Swarm ladder rung 1 analysis (research/swarm-20261021/PREREG-SWARM-R1.md §7, §8). $0: reads the run records and the
// archive, rebuilds the hidden truth analyst-side, writes the capability table, the paired comparisons and one root-cause
// line per error unit of every failed trial.
//   node experiments/swarm/analyze-r1.mjs [--stage heldout|calibrate] [--out research/swarm-20261021]
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadFamily, makeTasks, solverView } from '../lib/beds.mjs';
import { auditSession, voidUnderAmendment2 } from './void-audit.mjs';
import { pairedBootstrap, mcnemar, wilson } from '../lib/stats.mjs';
import { rng } from '../../beds/lib/rng.mjs';
import { readEvents } from './spawn-tree.mjs';
import { errorUnits, agentLocus, trapCounts, truthOf } from './rootcause.mjs';
import { codeSession, replays } from './coord.mjs';
import { LIVE, FAMILY, DIFFICULTY } from './run-r1.mjs';

export const ARMS = Object.freeze({ A: 'A-agent-haiku', S: 'S-swarm-haiku', W: 'W-workflow-haiku' });
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const gz = f => (existsSync(f) ? gunzipSync(readFileSync(f)).toString('utf8') : null);
const median = xs => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const mean = xs => { const s = xs.filter(Number.isFinite); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN; };

/** The archived record of one trial: answer, transcript events, tree, files the session wrote, W's stdout/stderr/calls. */
export function archiveOf(live, arm, taskKey, trial = 0) {
  const dir = path.join(live, 'archive', arm, `${taskKey.replaceAll(':', '_')}_t${trial}`);
  const read = f => (existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f), 'utf8') : null);
  const out = { dir, answer: null, events: [], tree: null, workFiles: {}, stdout: null, stderr: null, calls: [] };
  try { out.answer = JSON.parse(read('answer.json')); } catch {}
  const tx = gz(path.join(dir, 'transcript.jsonl.gz')); if (tx) out.events = readEvents(tx);
  try { out.tree = JSON.parse(read('tree.json')); } catch {}
  try { out.workFiles = JSON.parse(gz(path.join(dir, 'work-files.json.gz')) ?? '{}'); } catch {}
  out.stdout = gz(path.join(dir, 'solve.stdout.gz')); out.stderr = gz(path.join(dir, 'solve.stderr.gz'));
  const calls = gz(path.join(dir, 'calls.jsonl.gz')); if (calls) out.calls = calls.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (!out.answer && out.stdout) { try { out.answer = JSON.parse(out.stdout.trim().split('\n').filter(Boolean).at(-1)); } catch {} }
  return out;
}

/** Score difference (A − B) with a paired bootstrap over tasks (oracle score, 0..1). */
export function pairedScoreDiff(rows, a, b, { iterations = 10000, seed = 'swarm-r1' } = {}) {
  const by = arm => new Map(rows.filter(r => r.arm === arm).map(r => [r.taskKey, r.score ?? 0]));
  const A = by(a), B = by(b), tasks = [...A.keys()].filter(t => B.has(t));
  const d = tasks.map(t => A.get(t) - B.get(t));
  const r = rng(seed, a, b), boots = [];
  for (let i = 0; i < iterations; i++) { let s = 0; for (let j = 0; j < d.length; j++) s += d[r.int(0, d.length - 1)]; boots.push(s / Math.max(1, d.length)); }
  boots.sort((x, y) => x - y);
  return { tasks: tasks.length, point: mean(d), lo: boots[Math.floor(0.025 * (iterations - 1))], hi: boots[Math.floor(0.975 * (iterations - 1))] };
}

/** Per-trial anatomy: error units with traps, the arm's locus per unit, coordination codes (S), replays (S), side per unit. */
export function anatomyOf({ row, task, arc, bed, gradeConsistent }) {
  const units = row.pass ? [] : errorUnits(task, arc.answer);
  const out = { arm: row.arm, taskKey: row.taskKey, pass: row.pass, score: row.score, error: row.error?.code ?? null, units: units.length, traps: trapCounts(units) };
  let located = units;
  if (row.arm === ARMS.A) located = agentLocus(task, units, arc.events, { parent: null });
  if (row.arm === ARMS.S) {
    const lead = agentLocus(task, units, arc.events, { parent: null }), any = agentLocus(task, units, arc.events, { parent: 'any' });
    located = units.map((u, i) => ({ ...u, seenByLead: lead[i].seen, seenAny: any[i].seenAny, seen: any[i].seen, contextTokens: lead[i].contextTokens }));
    if (arc.tree) {
      const result = [...arc.events].reverse().find(e => e?.type === 'result');
      const coord = codeSession({ task, tree: arc.tree, output: arc.answer, error: row.error, stats: result?.subagent_stats ?? row.meta?.subagentStats ?? null,
        drift: row.meta?.drift ?? [], workFiles: arc.workFiles, events: arc.events });
      out.coord = coord;
      if (!row.pass) out.replays = replays({ task, tree: arc.tree, output: arc.answer, workFiles: arc.workFiles, bed });
      const d = coord.detail;
      // a cell unit matches its cell; a missing-compound unit matches any cell of that compound
      const inSet = (xs, u) => (xs ?? []).includes(u.code) || (u.property ? (xs ?? []).includes(`${u.code}|${u.property}`) : (u.code && (xs ?? []).some(k => k.startsWith(`${u.code}|`))));
      located = located.map(u => ({ ...u, coordination: [inSet(d.planGap, u) && 'K3', inSet(d.aggregationLoss, u) && 'K5', inSet(d.workerWrongPropagated, u) && 'K6', inSet(d.conflictWrong, u) && 'K7'].filter(Boolean) }));
    }
  }
  if (row.arm === ARMS.W) {
    out.workflow = { calls: arc.calls.length, modelExecuted: arc.calls.length > 0, stderrTail: (arc.stderr ?? '').slice(-300) };
  }
  // fault side (§8.1): bed if the grader disagrees with the task text; harness if the arm's structure lost it (a limit with no
  // answer, a coordination code a code guard would fix); model otherwise (search: the evidence was never in front of the
  // model; judgment: it was).
  const limit = ['EXECUTOR_TIMEOUT', 'EXECUTOR_BUDGET', 'SCRIPT_TIMEOUT'].includes(out.error) && !arc.answer;
  out.unitsDetail = located.map(u => {
    let side, why;
    if (!gradeConsistent) { side = 'bed'; why = 'grader-vs-text'; }
    else if (limit) { side = 'harness'; why = 'limit-no-answer'; }
    else if ((u.coordination ?? []).some(k => ['K3', 'K5', 'K7'].includes(k))) { side = 'harness'; why = `coordination:${u.coordination.join('+')}`; }
    else if (row.arm === ARMS.W) { side = 'model'; why = arc.answer ? 'builder-code' : `builder-code:${out.error ?? 'no-output'}`; }
    else if (u.seen === false) { side = 'model'; why = 'search:not-seen'; }
    else if (u.seen === true) { side = 'model'; why = 'judgment:seen'; }
    else { side = 'model'; why = 'judgment'; }
    return { ...u, side, why };
  });
  out.sides = out.unitsDetail.reduce((m, u) => ({ ...m, [`${u.side}:${u.why}`]: (m[`${u.side}:${u.why}`] ?? 0) + 1 }), {});
  return out;
}

export async function analyze({ live = LIVE, stage = 'heldout' } = {}) {
  const rows = readJsonl(path.join(live, stage, 'results.jsonl'));
  const faults = readJsonl(path.join(live, stage, 'results.faults.jsonl'));
  const bed = await loadFamily(FAMILY);
  const split = stage === 'heldout' ? 'test' : 'dev';
  const seeds = [...new Set(rows.map(r => Number(r.taskKey.split(':s')[1])))].sort((a, b) => a - b);
  const tasks = new Map((await makeTasks(FAMILY, { split, seeds, difficulty: DIFFICULTY })).map(t => [t.taskKey, t]));
  // complete blocks only (§5.1): a task enters the comparison when every arm has a recorded, non-void row for it.
  // Frozen void rule: a model other than Haiku served a message (K11), or any hidden-path or repository-path attempt.
  // Amendment 2 (2026-11-04, after the run): the frozen rule voided 11 of 14 held-out A/S trials for paths that are
  // sandbox-private scratch (files the session wrote under /var/tmp, the CLI's tool-result spill files under /root/.claude,
  // the tmpfs directory above its own workdir); void-audit.mjs classifies every flagged path, and a trial is void only for
  // drift, a repository-path mention, or a flagged path of kind `other`. Both counts are reported.
  const frozenVoid = r => (r.meta?.drift ?? []).length > 0 || (r.meta?.hiddenPathAttempts ?? 0) > 0 || (r.meta?.repoPathMentions ?? 0) > 0;
  const audits = new Map();
  const auditOf = r => {
    const k = `${r.arm}|${r.taskKey}`;
    if (!audits.has(k)) {
      const arc = archiveOf(live, r.arm, r.taskKey, r.trial);
      const uses = arc.events.filter(e => e?.type === 'assistant').flatMap(e => (e.message?.content ?? []).filter(c => c?.type === 'tool_use').map(c => ({ name: c.name, input: c.input })));
      const init = arc.events.find(e => e?.type === 'system' && e.subtype === 'init');
      const view = solverView(tasks.get(r.taskKey).task);
      audits.set(k, uses.length && init?.cwd ? auditSession(uses, { workdir: init.cwd, taskTexts: [view.prompt, view.files] }) : []);
    }
    return audits.get(k);
  };
  const isVoid = r => voidUnderAmendment2({ drift: r.meta?.drift ?? [], repoPathMentions: r.meta?.repoPathMentions ?? 0, audit: (r.meta?.hiddenPathAttempts ?? 0) > 0 ? auditOf(r) : [] });
  const arms = [...new Set(rows.map(r => r.arm))].sort();
  const complete = [...tasks.keys()].filter(k => arms.every(a => rows.some(r => r.arm === a && r.taskKey === k && !isVoid(r))));
  const completeFrozen = [...tasks.keys()].filter(k => arms.every(a => rows.some(r => r.arm === a && r.taskKey === k && !frozenVoid(r))));
  const use = rows.filter(r => complete.includes(r.taskKey));
  const voids = rows.filter(isVoid).map(r => ({ arm: r.arm, taskKey: r.taskKey, drift: r.meta?.drift ?? [], hiddenPath: r.meta?.hiddenPathAttempts ?? 0, repoPath: r.meta?.repoPathMentions ?? 0 }));
  const frozenRule = { voids: rows.filter(frozenVoid).length, completeBlocks: completeFrozen.length,
    flaggedPaths: [...audits.values()].flat().reduce((m, x) => ({ ...m, [x.kind]: (m[x.kind] ?? 0) + 1 }), {}) };
  if (!use.length) return { stage, split, tasks: 0, incomplete: [...tasks.keys()], voids, frozenRule, faults: faults.length, table: {}, comparisons: [], anatomy: [] };
  const build = existsSync(path.join(live, 'build', 'construction.json')) ? JSON.parse(readFileSync(path.join(live, 'build', 'construction.json'), 'utf8')) : null;
  // the decidability witness on every task (the grader agrees with the task text)
  const grade = new Map([...tasks].map(([k, t]) => [k, bed.oracle(t.task, bed.whiteboxSolve(t.task)).pass]));
  const anatomy = use.map(row => anatomyOf({ row, task: tasks.get(row.taskKey).task, arc: archiveOf(live, row.arm, row.taskKey, row.trial), bed, gradeConsistent: grade.get(row.taskKey) }));
  const table = {};
  for (const a of arms) {
    const rs = use.filter(r => r.arm === a), an = anatomy.filter(x => x.arm === a);
    const pass = rs.filter(r => r.pass).length;
    const det = rs.map(r => { try { return JSON.parse(r.oracleDetails ?? '{}'); } catch { return {}; } });
    table[a] = {
      n: rs.length, pass, passRate: rs.length ? pass / rs.length : NaN, wilson95: wilson(pass, rs.length), meanScore: mean(rs.map(r => r.score ?? 0)),
      cellsCorrect: mean(det.map(d => (d.cells ? d.correct / d.cells : 0))), missingCompounds: mean(det.map(d => d.missingEntities ?? NaN)),
      excludedOk: det.filter(d => d.excludedOk).length,
      costUsd: rs.reduce((s, r) => s + (r.costUsd ?? 0), 0), costPerTrial: mean(rs.map(r => r.costUsd ?? 0)), costPerPass: pass ? rs.reduce((s, r) => s + (r.costUsd ?? 0), 0) / pass : null,
      costUnknown: rs.filter(r => r.costUnknown).length,
      ...(a === ARMS.W && build ? { buildUsd: build.constructionCostUsd, costPerPassInclBuild: pass ? (rs.reduce((s, r) => s + (r.costUsd ?? 0), 0) + build.constructionCostUsd) / pass : null,
        buildArtifact: build.artifact, buildScoreChecks: build.scoreLog?.length ?? null, buildFirstPassAtCheck: build.firstPassAtCheck ?? null } : {}),
      wallMedianS: median(rs.map(r => r.latencyMs / 1000)), wallMaxS: Math.max(...rs.map(r => r.latencyMs / 1000)),
      errors: rs.filter(r => r.error).reduce((m, r) => ({ ...m, [r.error.code]: (m[r.error.code] ?? 0) + 1 }), {}),
      drift: rs.filter(r => (r.meta?.drift ?? []).length).length,
      hiddenPathVoid: rs.filter(r => (r.meta?.hiddenPathAttempts ?? 0) > 0 || (r.meta?.repoPathMentions ?? 0) > 0).length,
      workers: a === ARMS.S ? { median: median(rs.map(r => r.meta?.workers)), max: Math.max(...rs.map(r => r.meta?.workers ?? 0)), criticalStepsMedian: median(rs.map(r => r.meta?.criticalSteps)),
        coord: Object.fromEntries(['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8', 'K9', 'K10', 'K11'].map(k => [k, an.filter(x => x.coord?.codes?.[k]).length])) } : undefined,
      traps: an.reduce((m, x) => { for (const [k, v] of Object.entries(x.traps)) m[k] = (m[k] ?? 0) + v; return m; }, {}),
      sides: an.reduce((m, x) => { for (const [k, v] of Object.entries(x.sides)) m[k] = (m[k] ?? 0) + v; return m; }, {}),
    };
  }
  const pairs = [[ARMS.S, ARMS.A], [ARMS.W, ARMS.A], [ARMS.S, ARMS.W]].filter(([x, y]) => arms.includes(x) && arms.includes(y));
  const constructionUsd = build ? { [ARMS.W]: { [FAMILY]: build.constructionCostUsd } } : null;
  const comparisons = pairs.map(([x, y]) => ({ a: x, b: y, mcnemar: mcnemar(use, x, y), passBootstrap: pairedBootstrap(use, x, y, { iterations: 10000, seed: 'swarm-r1', constructionUsd }), score: pairedScoreDiff(use, x, y) }));
  return { stage, split, tasks: complete.length, incomplete: [...tasks.keys()].filter(k => !complete.includes(k)), voids, frozenRule, faults: faults.length, gradeConsistent: [...grade.values()].every(Boolean), table, comparisons, anatomy };
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const stage = arg('--stage', 'heldout'), out = arg('--out', null);
  const res = await analyze({ stage });
  const { anatomy, ...summary } = res;
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, `SUMMARY-R1-${stage}.json`), JSON.stringify(summary, null, 1) + '\n');
    writeFileSync(path.join(out, `ROOTCAUSE-R1${stage === 'heldout' ? '' : '-' + stage}.jsonl`), anatomy.map(x => JSON.stringify(x)).join('\n') + '\n');
  }
  console.log(JSON.stringify(summary, null, 1));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
