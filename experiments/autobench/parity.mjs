#!/usr/bin/env node
// PARITY check ($0, no model): the same scripted action sequence, run (A) through the bridge (bridge.py serve, the
// file mailbox and real `node tool.mjs batch` processes, exactly the path an agent session uses) and (B) through the
// official environment API directly (AutomationBenchEnv.evaluate with a scripted vf.Client, as eval.py drives it),
// must give the same final world, the same tool results, the same assertion verdicts and the same scores. Exact:
// AutomationBench's own generators (uuid4, random, wall clock) are seeded identically in both paths (--det seed).
// A second check runs the official path with no patches (--det off) against the recording shim (--det record) to
// show that the shim changes nothing but generator draws.
//
//   node experiments/autobench/parity.mjs [--per-domain 2] [--seed parity-20261014] [--out research/automationbench-20261014/parity.json]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WORK_ROOT } from '../../src/executors/claude-code.mjs';
import { PUBLIC_DOMAINS, REPO, bridgeJson, listTasks, readJson, scriptedRunner, stratifiedSubset, writeJson } from './lib.mjs';
import { runTasks } from './run.mjs';
import { scriptFor } from './scripted.mjs';

export const canon = v => JSON.stringify(sortKeys(v));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]));
  return v;
}

export async function parity({ perDomain = 2, seed = 'parity-20261014', out = path.join(REPO, 'research/automationbench-20261014/parity.json'), live, tasks: given, log = m => process.stderr.write(m + '\n') } = {}) {
  live ??= path.join(WORK_ROOT, 'autobench', `parity-${Date.now()}`);
  mkdirSync(live, { recursive: true });
  const domains = [...PUBLIC_DOMAINS, 'simple'];
  const tasks = given ?? stratifiedSubset(await listTasks(domains, { liveDir: live }), perDomain * domains.length, seed, domains);
  const bridgeLive = path.join(live, 'bridge');
  const scripts = {};
  const stepsFor = ({ name }) => (scripts[name] ??= scriptFor(path.join(bridgeLive, 'prep', name), { violate: tasks.indexOf(name) % 2 === 1 }));
  // (A) bridge path: run.mjs with the scripted runner (no model), seeded generators, one fork per task.
  log(`[parity] ${tasks.length} tasks: bridge path`);
  const t0 = Date.now();
  const A = await runTasks({ tasks, runner: scriptedRunner(stepsFor), det: 'seed', k: 1, concurrency: 4, liveRoot: bridgeLive, outDir: null, log });
  const tA = Date.now() - t0;
  const scriptsFile = path.join(live, 'scripts.json');
  writeFileSync(scriptsFile, JSON.stringify(scripts));
  // (B) official path, seeded identically; (C) official unpatched; (D) official recording shim.
  log('[parity] official path (seed)');
  const offSeed = path.join(live, 'official-seed.json'), offOff = path.join(live, 'official-off.json'), offRec = path.join(live, 'official-record.json');
  const t1 = Date.now();
  await bridgeJson(['official', '--det', 'seed', '--scripts', scriptsFile, '--out', offSeed], { liveDir: live });
  const tB = Date.now() - t1;
  log('[parity] official path (off, record) for shim neutrality');
  await bridgeJson(['official', '--det', 'off', '--scripts', scriptsFile, '--out', offOff], { liveDir: live });
  await bridgeJson(['official', '--det', 'record', '--scripts', scriptsFile, '--out', offRec], { liveDir: live });
  const neutralFile = path.join(live, 'neutral.json');
  await bridgeJson(['neutral', '--a', offOff, '--b', offRec, '--out', neutralFile], { liveDir: live });
  const B = readJson(offSeed), N = readJson(neutralFile);

  const rows = tasks.map(task => {
    const host = path.join(bridgeLive, 'host', task, 'fork-0');
    const grade = readJson(path.join(host, 'grade.json'));
    const world = readJson(path.join(host, 'final-world.json'));
    const calls = readFileSync(path.join(host, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const toolA = calls.flatMap(c => c.results);
    const meta = readJson(path.join(bridgeLive, 'prep', task, 'meta.json'));
    const b = B[task];
    const checks = {
      final_world: canon(world) === canon(b.final_world),
      tool_results: canon(toolA) === canon(b.tool_results),
      assertion_results: canon(grade.assertion_results) === canon(b.assertion_results),
      partial_credit: grade.partial_credit === b.partial_credit,
      task_completed_correctly: grade.task_completed_correctly === b.task_completed_correctly,
      contract: grade.contract_sha256 === meta.contract_sha256,
    };
    const writes = calls.flatMap(c => c.calls).filter(c => { try { return ['POST', 'PATCH', 'PUT', 'DELETE'].includes(JSON.parse(c.arguments).method); } catch { return false; } }).length;
    return { task, exact: Object.values(checks).every(Boolean), checks, steps: calls.length, toolCalls: toolA.length, writes,
      partial_credit: grade.partial_credit, task_completed_correctly: grade.task_completed_correctly, n_scored: grade.n_scored, n_passed: grade.n_passed,
      world_sha256: createHash('sha256').update(canon(world)).digest('hex'), neutral: N[task] };
  });
  const resolved = rows;
  const report = {
    what: 'bridge vs official environment API, same scripted action sequence (no model, $0)', date: new Date().toISOString(), evidence: 'harness validation (development)',
    command: 'node experiments/autobench/parity.mjs', seed, det: 'seed (both paths)', tasks: resolved.length,
    exact: resolved.filter(r => r.exact).length, all_exact: resolved.every(r => r.exact),
    shim_neutrality: { ok: resolved.every(r => r.neutral?.ok), compared: 'official --det off vs official --det record, same scripts' },
    nonzero_scores: resolved.filter(r => r.partial_credit > 0).length, full_passes: resolved.filter(r => r.task_completed_correctly === 1).length,
    total_tool_calls: resolved.reduce((s, r) => s + r.toolCalls, 0), total_writes: resolved.reduce((s, r) => s + r.writes, 0),
    wall_ms: { bridge: tA, official_seed: tB }, costUsd: 0, provenance: A.summary.provenance, rows: resolved,
  };
  if (out) writeJson(out, report);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = Object.fromEntries(process.argv.slice(2).reduce((acc, x, i, arr) => (x.startsWith('--') ? [...acc, [x.slice(2), arr[i + 1]]] : acc), []));
  const r = await parity({ perDomain: a['per-domain'] ? Number(a['per-domain']) : 2, seed: a.seed ?? 'parity-20261014', out: a.out ?? undefined, tasks: a.tasks ? a.tasks.split(',') : undefined });
  process.stdout.write(JSON.stringify({ ...r, rows: r.rows.map(x => ({ task: x.task, exact: x.exact, pc: x.partial_credit, pass: x.task_completed_correctly, calls: x.toolCalls, writes: x.writes, neutral: x.neutral?.ok, failed: Object.entries(x.checks).filter(([, v]) => !v).map(([k]) => k) })) }, null, 1) + '\n');
  process.exit(r.all_exact && r.shim_neutrality.ok ? 0 : 1);
}
