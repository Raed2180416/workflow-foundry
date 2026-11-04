#!/usr/bin/env node
// AppWorld parity and $0 oracle gates (PLAN §5.4; research/breadth-20261021/appworld/PARITY.md). No model, $0.
//
// OUR PATH: a sandboxed `bridge.py serve` process (public view, load_ground_truth=False) opens the world; every code
// chunk goes through the arm's own path (MCP relay mcp.mjs -> mailbox -> host facade facade.mjs -> serve); the world is
// closed, its outputs snapshotted host-side and graded by the separate host-only `grade-serve` process (AppWorld's
// evaluate_task). REFERENCE PATH: upstream's own procedure in one host-only process (`bridge.py official`: a world with
// ground_truth_mode="full", world.execute per chunk until world.task_completed(), then world.evaluate(); verify.py's
// gold check). PARITY on a (task, policy) = the same success, the same pass and fail counts, the same assertion
// fingerprints and the same post-state digest. Also: upstream's dataset evaluator (evaluate_tasks, what `appworld
// evaluate` runs) over OUR gold and null snapshots; determinism (a second run in fresh processes, identical digest);
// side-effect mutants (BG-3); and the run.mjs per-unit path (one fresh serve process per unit) for the $0 baselines.
//
//   nice -n 15 node experiments/breadth/appworld/parity.mjs [--concurrency 3] [--limit N] [--out research/breadth-20261021/appworld/parity.json]
// Batteries are cached host-only under a key of the code hashes; a rerun with the same code re-renders parity.json.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, linkSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { BRIDGE, BridgeServer, DATA_DIR, HERE, HOST_ROOT, LIVE_ROOT, PIN, REPO, RESEARCH, WORLD_PROFILES, buildPublicView, buildServeRoot, fileSize, freeBytes, pool, readJson, readJsonl,
  runHost, scenarioOf, sha256, shaCanon, snapshotOutputs, verifyInstall, writeJson } from './lib.mjs';
import { Facade } from './facade.mjs';
import { armTools } from './mcp.mjs';
import { materializeSession } from './session.mjs';
import { loadSplit } from './split.mjs';
import { plansFor, runUnits, scriptedSession } from './run.mjs';

export const CODE_FILES = ['bridge.py', 'lib.mjs', 'facade.mjs', 'mcp.mjs', 'run.mjs'];
export const codeSha256 = () => sha256(CODE_FILES.map(f => sha256(readFileSync(path.join(HERE, f)))).join(':'));
const COMPARE = ['success', 'passCount', 'failCount', 'passSha256', 'failSha256', 'post'];
const slim = (row, extra = {}) => ({ success: row.success, passCount: row.passCount, failCount: row.failCount, passSha256: row.passSha256, failSha256: row.failSha256,
  post: row.postDigest?.sha256 ?? row.post, noOpPassFailures: (row.failures ?? []).filter(f => f.label === 'no_op_pass').length, ...extra });

/** Items of a battery: { key: "<task>/<policy>", taskId, policy, chunks, profile }. */
export function batteryItems(plans, ids, policies) {
  const items = [];
  for (const id of ids) {
    const p = plans.get(id);
    for (const pol of policies) {
      const [name, profile] = pol.split('@');
      const chunks = name === 'null' ? [] : p.plans[name];
      if (!chunks) continue; // e.g. no write -> no write mutant
      items.push({ key: name.startsWith('mut:') ? `${id}/${name}` : `${id}/${pol}`, taskId: id, policy: pol, chunks, profile });
    }
  }
  return items;
}

/** Upstream's reference path over items, in `workers` host-only processes. */
export async function officialBattery(items, { workers = 2, dir }) {
  const parts = Array.from({ length: workers }, () => []);
  items.forEach((it, i) => parts[i % workers].push({ key: it.key, taskId: it.taskId, chunks: it.chunks, settings: WORLD_PROFILES[it.profile] }));
  const rows = new Map();
  await Promise.all(parts.map(async (part, w) => {
    if (!part.length) return;
    const spec = path.join(dir, `official-spec-${w}.json`);
    writeJson(spec, { items: part });
    const r = await runHost(['official', spec], { root: path.join(dir, `official-root-${w}`) });
    for (const x of r.proto.filter(p => p.kind === 'official')) rows.set(x.key, x.error ? { error: x.error } : { ...x.row });
    rmSync(spec, { force: true });
  }));
  return rows;
}

/** Our path (battery mode: one sandboxed serve process and one grader per worker, scripted relay client per item). */
export async function oursBattery(items, { workers = 2, dir, snapRoot }) {
  const byWorker = Array.from({ length: workers }, () => []);
  items.forEach((it, i) => byWorker[i % workers].push(it));
  const rows = new Map();
  await Promise.all(byWorker.map(async (part, w) => {
    if (!part.length) return;
    const live = path.join(LIVE_ROOT, `parity-${process.pid}-w${w}`);
    rmSync(live, { recursive: true, force: true });
    const pub = buildPublicView(path.join(live, 'pub'), [...new Set(part.map(i => i.taskId))]);
    const serveRoot = buildServeRoot(path.join(live, 'serve'), pub);
    const serve = new BridgeServer({ cmd: 'serve', serveRoot, publicDir: pub });
    const grader = new BridgeServer({ cmd: 'grade-serve', root: path.join(dir, `grade-root-${w}`) });
    try {
      await serve.hello; await grader.hello;
      for (const it of part) {
        const workdir = path.join(live, 'w', it.key.replace(/[/@:]/g, '_'));
        rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
        const tools = armTools(false);
        materializeSession(workdir, tools);
        const h = serve.handle('p');
        try {
          const ready = await serve.open(h, it.taskId, WORLD_PROFILES[it.profile]);
          if (ready.groundTruthLoaded) throw new Error('ground truth loaded in the serve world');
          const facade = new Facade({ workdir, bridge: serve, handle: h, maxExecutes: 1e9 }).start();
          const s = await scriptedSession(it.chunks, tools)({ workdir });
          const fstats = await facade.stop();
          const closed = await serve.close(h);
          const snap = snapshotOutputs(serveRoot, closed.outputRel, path.join(snapRoot, it.key.replace(/[/@:]/g, '_')));
          const row = await grader.grade(it.taskId, snap);
          rows.set(it.key, { ...row, executes: closed.executes, completed: closed.completed, serveDigest: closed.postDigest.sha256, outputsSha256: s.outputsSha256, refused: fstats.refused, snap });
        } catch (e) {
          rows.set(it.key, { error: String(e?.message ?? e).slice(0, 500) });
          await serve.close(h).catch(() => {});
        }
        rmSync(workdir, { recursive: true, force: true });
      }
    } finally { await serve.quit(); await grader.quit(); rmSync(live, { recursive: true, force: true }); }
  }));
  return rows;
}

const cacheFile = (dir, name) => path.join(dir, `${name}.jsonl`);
async function cached(dir, name, n, compute) {
  const f = cacheFile(dir, name);
  const prior = readJsonl(f);
  if (prior.length === n && prior.every(r => r.key)) return new Map(prior.map(r => [r.key, r]));
  const rows = await compute();
  writeFileSync(f, [...rows.entries()].map(([key, r]) => JSON.stringify({ key, ...r })).join('\n') + '\n');
  return new Map([...rows.entries()].map(([key, r]) => [key, { key, ...r }]));
}

export function compareRows(a, b, keys) {
  const out = { compared: 0, equal: 0, mismatches: [], missing: [] };
  for (const k of keys) {
    const x = a.get(k), y = b.get(k);
    if (!x || !y || x.error || y.error) { out.missing.push({ key: k, a: x?.error ?? (x ? null : 'missing'), b: y?.error ?? (y ? null : 'missing') }); continue; }
    out.compared++;
    const sx = slim(x), sy = slim(y);
    const diff = COMPARE.filter(f => sx[f] !== sy[f]);
    if (diff.length) out.mismatches.push({ key: k, fields: diff }); else out.equal++;
  }
  return out;
}
export const batteryDigest = (rows, keys) => shaCanon(keys.map(k => { const r = rows.get(k); return r && !r.error ? [k, slim(r)] : [k, 'error']; }));
const count = (rows, keys, f) => keys.filter(k => { const r = rows.get(k); return r && !r.error && f(r); }).length;

/** BG-3: per operator, mutants that change the post-state (non-equivalent) and whether the evaluator fails them. */
export function mutationScore(official, ours, ids, ops) {
  const byOp = {};
  let killed = 0, scored = 0;
  for (const op of ops) {
    const r = { generated: 0, equivalent: 0, killed: 0, survived: [], errors: 0, disagreements: 0 };
    for (const id of ids) {
      const m = official.get(`${id}/${op}`), g = official.get(`${id}/gold@verify`), mo = ours.get(`${id}/${op}`);
      if (!m) continue;
      r.generated++;
      if (m.error || !g || g.error) { r.errors++; continue; }
      if (mo && !mo.error && (mo.success !== m.success || slim(mo).post !== slim(m).post)) r.disagreements++;
      if (slim(m).post === slim(g).post) { r.equivalent++; continue; }
      scored++;
      if (!m.success) { r.killed++; killed++; } else r.survived.push(id);
    }
    r.score = r.generated - r.equivalent - r.errors ? r.killed / (r.generated - r.equivalent - r.errors) : null;
    byOp[op] = r;
  }
  return { byOp, killed, scored, score: scored ? killed / scored : null };
}

/** Upstream's dataset evaluator (evaluate_tasks) over our snapshots of one policy. */
async function evaluateDir(rows, ids, policy, dir) {
  const exp = `foundry-ours-${policy.replace(/[@:]/g, '-')}`;
  const root = path.join(dir, `evaldir-${policy.replace(/[@:]/g, '-')}`);
  rmSync(path.join(root, 'experiments'), { recursive: true, force: true });
  const use = ids.filter(id => rows.get(`${id}/${policy}`)?.snap);
  for (const id of use) {
    const src = path.join(rows.get(`${id}/${policy}`).snap, 'dbs');
    const dst = path.join(root, 'experiments/outputs', exp, 'tasks', id, 'dbs');
    mkdirSync(dst, { recursive: true });
    for (const f of readdirSync(src)) linkSync(path.join(src, f), path.join(dst, f));
  }
  const spec = path.join(dir, `evaldir-${policy.replace(/[@:]/g, '-')}.json`);
  writeJson(spec, { taskIds: use, experimentName: exp });
  const r = await runHost(['evaluate-dir', spec], { root });
  const ev = r.proto.find(p => p.kind === 'evaluated');
  const agree = use.filter(id => ev.perTaskSuccess[id] === rows.get(`${id}/${policy}`).success).length;
  rmSync(path.join(root, 'experiments'), { recursive: true, force: true });
  return { n: use.length, aggregate: ev.aggregate, upstreamSuccess: Object.values(ev.perTaskSuccess).filter(Boolean).length, agreeWithOurGrader: agree };
}

export async function runParity({ concurrency = 2, limit = null, out = path.join(RESEARCH, 'parity.json'), log = m => process.stderr.write(m + '\n') } = {}) {
  const t0 = Date.now();
  const split = loadSplit();
  let ids = [...split.roles.devTrain, ...split.roles.devCheck];
  if (limit) ids = ids.slice(0, limit);
  const code = codeSha256();
  const dir = path.join(HOST_ROOT, 'parity', code.slice(0, 16) + (limit ? `-l${limit}` : ''));
  mkdirSync(dir, { recursive: true });
  const snapRoot = path.join(dir, 'snap');
  log(`[parity] ${ids.length} train+dev tasks, code ${code.slice(0, 12)}, cache ${dir}, free disk ${((await freeBytes()) / 1e9).toFixed(2)} GB`);
  const bg0 = { install: await verifyInstall(), bundleSha256: PIN.dataSha256, bundleBytes: PIN.dataBytes };
  const bundle = path.join(path.dirname(DATA_DIR), '..', 'download', 'data-0.1.0.bundle');
  bg0.bundlePresent = fileSize(bundle) === PIN.dataBytes;
  log(`[parity] BG-0 install pass=${bg0.install.pass}`);
  const planFile = path.join(dir, 'plans.json');
  let plans;
  if (existsSync(planFile)) plans = new Map(Object.entries(readJson(planFile)));
  else { plans = await plansFor(ids); writeJson(planFile, Object.fromEntries(plans)); }
  const ops = ['mut:repeat-last-write', 'mut:extra-field', 'mut:touch-other-record'];
  // keys: "<task>/gold@verify" (verify.py's settings), "<task>/gold@arm", "<task>/null@arm", "<task>/docs@arm" (the arm world
  // profile) and "<task>/mut:<op>" (mutants of the gold, verify profile)
  const offPolicies = ['gold@verify', 'gold@arm', 'null@arm', 'docs@arm', ...ops.map(o => `${o}@verify`)];
  const offItems = batteryItems(plans, ids, offPolicies);
  log(`[parity] official battery: ${offItems.length} items`);
  const official = await cached(dir, 'official', offItems.length, () => officialBattery(offItems, { workers: concurrency, dir }));
  log(`[parity] official done (${Math.round((Date.now() - t0) / 1000)} s)`);
  const ourItems = offItems.filter(it => !it.policy.startsWith('gold@arm') && !it.policy.startsWith('docs@'));
  const ours = await cached(dir, 'ours-1', ourItems.length, () => oursBattery(ourItems, { workers: concurrency, dir, snapRoot: path.join(snapRoot, 'run1') }));
  log(`[parity] ours run 1 done (${Math.round((Date.now() - t0) / 1000)} s)`);
  const detItems = ourItems.filter(it => it.policy === 'gold@verify' || it.policy === 'null@arm');
  const ours2 = await cached(dir, 'ours-2', detItems.length, () => oursBattery(detItems, { workers: concurrency, dir, snapRoot: path.join(snapRoot, 'run2') }));
  log(`[parity] ours run 2 done (${Math.round((Date.now() - t0) / 1000)} s)`);
  // run.mjs per-unit path: the scripted $0 baselines (fresh serve process per unit, arm world profile)
  const baselines = {};
  for (const policy of ['null', 'docs', 'gold']) {
    const runId = `parity-${code.slice(0, 10)}-${policy}${limit ? `-l${limit}` : ''}`;
    const prior = readJsonl(path.join(HOST_ROOT, 'runs', runId, 'results.jsonl'));
    let res;
    if (prior.length === ids.length) res = prior;
    else res = (await runUnits({ ids, policy, profile: 'arm', runId, concurrency, maxTurns: 0, maxExecutes: 1e9, timeoutMin: 30, resume: prior.length > 0, outDir: null, log })).results;
    const rows = new Map(res.map(r => [`${r.taskId}/${policy}@arm`, { key: `${r.taskId}/${policy}@arm`, success: r.verdict?.success, passCount: r.verdict?.passCount, failCount: r.verdict?.failCount,
      passSha256: r.verdict?.passSha256, failSha256: r.verdict?.failSha256, post: r.verdict?.gradedPostDigest, servePost: r.postDigest, outcome: r.outcome }]));
    baselines[policy] = { runId, rows, tgc: count(rows, [...rows.keys()], r => r.success === true), n: rows.size,
      sgc: (() => { const by = new Map(); for (const r of res) { const s = scenarioOf(r.taskId); by.set(s, (by.get(s) ?? true) && r.verdict?.success === true); } return [...by.values()].filter(Boolean).length; })(),
      scenarios: new Set(res.map(r => scenarioOf(r.taskId))).size, collateral: res.filter(r => r.outcome?.collateral).length };
    log(`[parity] run.mjs ${policy}: ${baselines[policy].tgc}/${baselines[policy].n} (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  const keysOf = pol => ids.map(id => `${id}/${pol}`);
  const goldV = keysOf('gold@verify'), goldA = keysOf('gold@arm'), nullA = keysOf('null@arm'), docsA = keysOf('docs@arm');
  const mutKeys = ops.flatMap(op => ids.map(id => `${id}/${op}`).filter(k => official.has(k)));
  const unitRows = new Map([...baselines.null.rows, ...baselines.docs.rows, ...baselines.gold.rows]);
  const evalGold = await evaluateDir(ours, ids, 'gold@verify', dir);
  const evalNull = await evaluateDir(ours, ids, 'null@arm', dir);
  const goldCalls = ids.map(id => plans.get(id).meta.goldCalls).sort((a, b) => a - b);
  const writesN = ids.filter(id => plans.get(id).meta.goldWrites > 0).length;
  const parity = {
    oursVsOfficial: compareRows(ours, official, [...goldV, ...nullA, ...mutKeys]),
    runnerVsOfficial: compareRows(unitRows, official, [...goldA, ...nullA, ...docsA]),
    runnerServeVsGraded: [...unitRows.values()].filter(r => r.servePost !== r.post).length,
  };
  const det = { run1: batteryDigest(ours, detItems.map(i => i.key)), run2: batteryDigest(ours2, detItems.map(i => i.key)), items: detItems.length };
  det.equal = det.run1 === det.run2;
  const bg3 = mutationScore(official, ours, ids, ops);
  const res = {
    kind: 'appworld-parity', version: 1, evidence: 'development/diagnostic: scripted trajectories on the public train and dev splits, no model, $0',
    generatedAt: new Date().toISOString(), durationSec: Math.round((Date.now() - t0) / 1000), codeSha256: code, bridgeSha256: sha256(readFileSync(BRIDGE)), splitSha256: split.splitSha256,
    pin: PIN, tasks: ids.length, scenarios: new Set(ids.map(scenarioOf)).size, idsSha256: shaCanon([...ids].sort()),
    bg0: { pass: bg0.install.pass && bg0.bundlePresent, ...bg0, install: { ...bg0.install, recordMismatches: undefined, unlistedFiles: undefined } },
    bg1: {
      goldVerifyOfficial: count(official, goldV, r => r.success), goldVerifyOurs: count(ours, goldV, r => r.success), goldArmOfficial: count(official, goldA, r => r.success),
      goldArmRunner: baselines.gold.tgc, of: ids.length, goldCalls: { min: goldCalls[0], median: goldCalls[Math.floor(goldCalls.length / 2)], max: goldCalls.at(-1), total: goldCalls.reduce((a, b) => a + b, 0) },
      tasksWithWrites: writesN,
    },
    bg2: {
      nullOfficial: count(official, nullA, r => r.success), nullOurs: count(ours, nullA, r => r.success), nullRunner: baselines.null.tgc,
      docsOfficial: count(official, docsA, r => r.success), docsRunner: baselines.docs.tgc, of: ids.length,
      nullSubGoal: (() => { const xs = nullA.map(k => official.get(k)).filter(r => r && !r.error); const p = xs.reduce((a, r) => a + r.passCount, 0), t = xs.reduce((a, r) => a + r.passCount + r.failCount, 0); return t ? p / t : null; })(),
      docsSubGoal: (() => { const xs = docsA.map(k => official.get(k)).filter(r => r && !r.error); const p = xs.reduce((a, r) => a + r.passCount, 0), t = xs.reduce((a, r) => a + r.passCount + r.failCount, 0); return t ? p / t : null; })(),
    },
    parity, evaluateDir: { gold: evalGold, null: evalNull },
    bg3, bg4: det,
    baselines: Object.fromEntries(Object.entries(baselines).map(([k, v]) => [k, { runId: v.runId, tgc: v.tgc, n: v.n, sgc: v.sgc, scenarios: v.scenarios, collateralUnits: v.collateral }])),
  };
  const g = res.bg1, f = res.bg2;
  res.checks = {
    'BG-0 install and data pinned': res.bg0.pass,
    'BG-1 gold 147/147 on both paths (verify and arm profiles)': g.goldVerifyOfficial === ids.length && g.goldVerifyOurs === ids.length && g.goldArmOfficial === ids.length && g.goldArmRunner === ids.length,
    'BG-2 null 0/147 on every path': f.nullOfficial === 0 && f.nullOurs === 0 && f.nullRunner === 0,
    'docs-only replay 0/147': f.docsOfficial === 0 && f.docsRunner === 0,
    'parity: ours = upstream on every compared item': parity.oursVsOfficial.mismatches.length === 0 && parity.oursVsOfficial.missing.length === 0 && parity.runnerVsOfficial.mismatches.length === 0 && parity.runnerVsOfficial.missing.length === 0 && parity.runnerServeVsGraded === 0,
    'upstream evaluate_tasks on our snapshots agrees': evalGold.agreeWithOurGrader === evalGold.n && evalNull.agreeWithOurGrader === evalNull.n,
    'BG-4 determinism': det.equal,
    'BG-3 side-effect mutants >= 95% killed': bg3.score !== null && bg3.score >= 0.95,
  };
  res.pass = Object.values(res.checks).every(Boolean);
  if (out) writeJson(out, res);
  return res;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = Object.fromEntries(process.argv.slice(2).reduce((acc, x, i, xs) => (x.startsWith('--') ? [...acc, [x.slice(2), xs[i + 1]?.startsWith('--') || xs[i + 1] === undefined ? true : xs[i + 1]]] : acc), []));
  const res = await runParity({ concurrency: Number(a.concurrency ?? 2), limit: a.limit ? Number(a.limit) : null, out: a.out === 'none' ? null : (a.out ?? path.join(RESEARCH, 'parity.json')) });
  process.stdout.write(JSON.stringify({ pass: res.pass, checks: res.checks, bg1: res.bg1, bg2: res.bg2, bg3: { score: res.bg3.score, killed: res.bg3.killed, scored: res.bg3.scored }, bg4: res.bg4.equal, durationSec: res.durationSec }, null, 1) + '\n');
}
