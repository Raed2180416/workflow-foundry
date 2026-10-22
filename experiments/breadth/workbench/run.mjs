#!/usr/bin/env node
// WorkBench arm runner on the breadth facade (PLAN §4.3 T1-1, §5.1, §5.2; runner patterns of experiments/autobench/run.mjs
// and experiments/sopbench/run.mjs). Per task and arm: a fresh world (bed.py serve, network off), the facade host, and
// ONE hardened, sandboxed `claude -p` session whose only MCP server is the bed relay (27 WorkBench tools + `python`);
// the official system prompt (src/evals/inference.py datetime prefix + ACT_WITHOUT_CONFIRMATION_SUFFIX), the declared
// date note and synthetic identity (AM-9, C7), the official turn cap (20) and time cap (600 s). The init event is checked
// against the arm's frozen fingerprint (INIT-PROBE.json) as it streams; every rate_limit_event is journaled and gates new
// sessions. Grading is host-side only (bed.py grade: WorkBench's is_correct and has_side_effects on the logged actions,
// plus the independent live-state check), after the session ends. Environment faults (rate or usage limit, model
// unavailable, no sandbox, CLI protocol, init mismatch, bed or python sandbox down, disk) are never scored: the task goes
// to faults.jsonl, no new session starts, and the run exits 3; `--resume` with the same command reruns only those.
//
//   $0:   node run.mjs --arms A-H --pool dev --n 4 --dry-run              (selection, prompts and argv; no session)
//   paid: node run.mjs --arms H45 --pool anchor --cap 4                    (Haiku 4.5 harness-parity anchor, 40 dev)
//         node run.mjs --arms A-H,A-S --pool screen --n 40 --cap 8         (A-H vs A-S screen: same tasks, interleaved)
//         node run.mjs --arms A-H,A-S,A-O --pool dev --n 100 --cap 12      (probe battery on non-sealed items)
//         node run.mjs --probe identity --arms A-H,A-S,A-O,H45 --cap 0.5    (C7: one "what is my e-mail?" call per arm)
//         node run.mjs --probe dose --arms A-H --sessions 40 --cap 1        (day-1 meter dose test on real dev tasks: one
//                                                                            0.01 tick is about $0.2 of Haiku list cost,
//                                                                            so cents cannot move it; run on a quiet account)
//         node run.mjs --arms A-H,A-S,A-O --pool sealed --sealed-ack wb-sealed-v1 --cap 35   (only after the dev gate)
// Options: --k N (repeats per task, default 1) --budget USD (per session; default per arm) --concurrency N (default 2)
//   --run-id ID --resume --card FILE (bed card appended to every arm's system prompt; its sha256 is recorded)
//   --ids a,b (explicit dev ids) --no-init-check (diagnostic only: such a run is labelled diagnostic)
//   --arm-n A-S=77,A-O=20 (an arm runs only on the first n tasks of the salt-keyed hashed order)
import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statfsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_FAULTS } from '../../lib/runner.mjs';
import { fingerprintHash } from '../facade/init-check.mjs';
import { doseSummary, gate, meterJournal } from '../facade/meter.mjs';
import { runFacadeSession } from '../facade/session.mjs';
import { ARMS, armModel } from './arms.mjs';
import { foreignAddresses, identityVerdict, worldAddresses } from './audit.mjs';
import { BENCH, CLONE, HOST_ONLY, MAX_EXECUTION_S, MAX_ITERATIONS, RESEARCH, catalogFrom, gradeTrajectories, materializeFacadeBin, readJson, readJsonl, runTaskThroughFacade, sha256, shippedTasks, startWorld, systemPrompt, writeJson, writeJsonl } from './lib.mjs';
import { anchorInstances } from './prescreen.mjs';

export const RUNNER_VERSION = 'wb-run-v1';
export const SEALED_ACK = 'wb-sealed-v1';
/** Per-session budget (USD) by arm: about 3x a long dev task at list price; the CLI checks it between turns. */
export const DEFAULT_BUDGET = Object.freeze({ 'A-H': 0.25, 'A-S': 1.5, 'A-O': 4, H45: 0.6 });
/** Expected cost per task (USD) for estimates (C-obs from PLAN §10 per-bed costs and policy prices; refined by the dev pilot). */
export const EST_PER_TASK = Object.freeze({ 'A-H': 0.016, 'A-S': 0.12, 'A-O': 0.3, H45: 0.075 });
export const TIMEOUT_MS = (MAX_EXECUTION_S + 60) * 1000; // official 600 s + CLI start-up
export const OUTCOME_ERRORS = Object.freeze({ MAX_TURNS: 'Agent stopped due to iteration limit or time limit.', EXECUTOR_TIMEOUT: 'Agent stopped due to iteration limit or time limit.',
  EXECUTOR_BUDGET: 'session budget reached', EXECUTOR_ERROR: 'session error' });
const INFRA_FAULT = /ENOSPC|EDQUOT|EMFILE|ENFILE|No usable temporary directory/;
/** Not a task outcome: the run stops and the task reruns on --resume. */
export const isEnvFault = r => ENV_FAULTS.has(r?.sessionError) || r?.sessionError === 'CONFIG_MISMATCH' || Boolean(r?.facadeEnvFault) || INFRA_FAULT.test(r?.hostError ?? '');

export const IDENTITY_BUDGET = 0.15; // one short answer, even at Opus xhigh
const IDENTITY_PROMPT = 'What is my e-mail address? Reply with the address only, or with the word unknown if you do not know it.';

function parseArgs(argv) {
  const o = { arms: null, pool: null, n: null, k: 1, cap: null, budget: null, concurrency: 2, runId: null, resume: false, dryRun: false, probe: null, sessions: 40, card: null, ids: null, sealedAck: null, initCheck: true, binary: null, armN: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === '--arms' || a === '--arm') o.arms = v().split(',');
    else if (a === '--pool') o.pool = v();
    else if (a === '--n') o.n = Number(v());
    else if (a === '--k') o.k = Number(v());
    else if (a === '--cap') o.cap = Number(v());
    else if (a === '--budget') o.budget = Number(v());
    else if (a === '--concurrency') o.concurrency = Number(v());
    else if (a === '--run-id') o.runId = v();
    else if (a === '--resume') o.resume = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--probe') o.probe = v();
    else if (a === '--sessions') o.sessions = Number(v());
    else if (a === '--card') o.card = v();
    else if (a === '--ids') o.ids = v().split(',');
    else if (a === '--sealed-ack') o.sealedAck = v();
    else if (a === '--no-init-check') o.initCheck = false;
    else if (a === '--arm-n') o.armN = Object.fromEntries(v().split(',').map(x => x.split('=')).map(([k, n]) => [k, Number(n)]));
    else if (a === '--binary') o.binary = v(); // tests only: a stand-in CLI (experiments/breadth/test/fake-claude.mjs)
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

/** Task selection, with split hygiene: dev pools hold dev-template instances only; sealed pools need the ack and the
 * manifest whose sha256 SPLIT.json committed. */
export function selectTasks({ pool, n, ids, sealedAck, shipped, split, prescreen, runKey }) {
  const devSet = new Set(split.devTemplates);
  const dev = shipped.filter(t => devSet.has(t.template_id));
  const devById = new Map(dev.map(t => [t.id, t]));
  if (pool === 'sealed' || pool === 'companion') {
    if (sealedAck !== SEALED_ACK) throw new Error(`the ${pool} pool needs --sealed-ack ${SEALED_ACK} (after the portfolio dev gate)`);
    const file = path.join(HOST_ONLY, 'sealed', pool === 'sealed' ? 'MANIFEST.json' : 'COMPANION.json');
    const m = readJson(file);
    const want = pool === 'sealed' ? split.sealed.manifestSha256 : split.regeneratedSelection?.manifestSha256;
    if (sha256(JSON.stringify(m)) !== want) throw new Error(`${pool} manifest hash differs from SPLIT.json`);
    return { tasks: m.instances.slice(0, n ?? Infinity), sealed: true };
  }
  if (ids) {
    const bad = ids.filter(id => !devById.has(id));
    if (bad.length) throw new Error(`not dev-template instances (refused): ${bad.slice(0, 5).join(', ')}`);
    return { tasks: ids.map(id => devById.get(id)), sealed: false };
  }
  if (pool === 'anchor') {
    const a = prescreen.anchor.ids;
    if (sha256(a.join('\n')) !== prescreen.anchor.idsSha256) throw new Error('anchor list hash differs from PRESCREEN.json');
    return { tasks: a.map(id => devById.get(id)).slice(0, n ?? Infinity), sealed: false };
  }
  if (pool === 'dev' || pool === 'screen') {
    // spread over dev templates (one per template per round), in a hash order keyed by the run key
    const order = anchorInstances(dev.map(t => ({ id: t.id, template_id: t.template_id })), `${split.salt.sha}:${pool}:${runKey}`, n ?? dev.length);
    return { tasks: order.map(id => devById.get(id)), sealed: false };
  }
  throw new Error(`unknown pool ${pool} (anchor, dev, screen, sealed, companion)`);
}

/** The arms' frozen init expectations (INIT-PROBE.json, from probe-init.mjs; $0). */
export function initExpectation(arm, initProbe) {
  const a = initProbe?.arms?.[arm];
  if (!a?.ok || !a.fingerprint) return null;
  const { cliVersion, model, permissionMode, tools, mcpServers, slashCommands, skills, plugins, agents, outputStyle } = a.fingerprint;
  return { cliVersion, model, permissionMode, tools, mcpServers, slashCommands, skills, plugins, agents, outputStyle };
}

function diskFreeBytes(p) { try { const s = statfsSync(p); return s.bavail * s.bsize; } catch { return null; } }

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.arms?.length) throw new Error('--arms is required');
  const arms = o.arms.map(a => ({ id: a, ...armModel(a) }));
  const split = readJson(path.join(RESEARCH, 'SPLIT.json'));
  const prescreen = readJson(path.join(RESEARCH, 'PRESCREEN.json'));
  const initProbe = existsSync(path.join(RESEARCH, 'INIT-PROBE.json')) ? readJson(path.join(RESEARCH, 'INIT-PROBE.json')) : null;
  const card = o.card ? readFileSync(o.card, 'utf8') : null;
  const sp = systemPrompt({ card });
  const cli = (() => { try { return execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(); } catch { return null; } })();
  const runKey = o.probe ? `probe-${o.probe}` : `${o.pool}-${o.n ?? 'all'}`;
  const runId = o.runId ?? `${o.probe ? `probe-${o.probe}` : o.pool}-${o.arms.join('+')}-${new Date().toISOString().slice(0, 16).replace(/-/g, '').replace(':', '').replace('T', '-')}`;
  const runDir = path.join(HOST_ONLY, 'runs', runId);
  const settings = { runner: RUNNER_VERSION, runnerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))), arms: o.arms, pool: o.pool, n: o.n, k: o.k, probe: o.probe, ids: o.ids,
    armN: o.armN, systemPromptSha256: sha256(sp), cardSha256: card ? sha256(card) : null, budget: o.budget, initCheck: o.initCheck, binary: o.binary ? 'stand-in' : 'claude', maxTurns: MAX_ITERATIONS, timeoutMs: TIMEOUT_MS, cli, splitSha256: split.splitSha256 };
  if (o.resume) {
    const prev = readJson(path.join(runDir, 'launch.json'));
    const diff = Object.keys(settings).filter(k => k !== 'cli' && JSON.stringify(settings[k]) !== JSON.stringify(prev[k]));
    if (diff.length) throw new Error(`resume refused: settings differ from launch.json (${diff.join(', ')})`);
  } else if (existsSync(path.join(runDir, 'results.jsonl'))) throw new Error(`run ${runId} exists: use --resume or a new --run-id`);
  for (const a of arms) if (o.initCheck && !initExpectation(a.id, initProbe) && !o.dryRun) throw new Error(`no frozen init fingerprint for ${a.id}: run probe-init.mjs ($0) first, or --no-init-check (diagnostic)`);
  if (!o.dryRun && !(o.cap > 0)) throw new Error('--cap USD is required for a paid run');
  const shipped = await shippedTasks({ cwd: path.join(BENCH, 'work') });

  let units, sealed = false;
  if (o.probe === 'identity') {
    const t = shipped.find(x => x.id === prescreen.anchor.ids[0]); // a dev world; the probe prompt replaces the task
    units = [{ task: t, k: 0, prompt: IDENTITY_PROMPT }];
  } else {
    // a dose probe is an ordinary dev run whose summary leads with meter movement per dollar
    const sel = o.probe === 'dose' ? selectTasks({ pool: 'dev', n: o.sessions, shipped, split, prescreen, runKey })
      : selectTasks({ pool: o.pool, n: o.n, ids: o.ids, sealedAck: o.sealedAck, shipped, split, prescreen, runKey });
    sealed = sel.sealed;
    units = sel.tasks.flatMap(t => Array.from({ length: o.k }, (_, k) => ({ task: t, k, prompt: t.task })));
    // hashed interleaved order (PLAN §5.2 "Interleaving"), keyed by the split salt so it is the same on every run and
    // resume: all arms of a unit run together on identical reset worlds, and a stopped run is an unbiased paired subset.
    const rank = id => sha256(`${split.salt.sha}:order:${id}`);
    units.sort((a, b) => (rank(a.task.id) < rank(b.task.id) ? -1 : rank(a.task.id) > rank(b.task.id) ? 1 : a.k - b.k));
  }
  // --arm-n A-S=77,A-O=20: an arm runs only on the first n distinct tasks of the hashed order (PLAN §8.2 n_eff subsets)
  const taskOrder = [...new Set(units.map(u => u.task.id))];
  const taskRank = new Map(taskOrder.map((id, i) => [id, i]));
  const armRuns = (arm, u) => !(arm.id in o.armN) || taskRank.get(u.task.id) < o.armN[arm.id];
  const estimate = Math.round(arms.reduce((s, a) => s + units.filter(u => armRuns(a, u)).length * (EST_PER_TASK[a.id] ?? 0.3), 0) * 100) / 100;
  if (o.dryRun) {
    console.log(JSON.stringify({ runId, settings, units: units.length, estimateUsd: estimate, sealed, first: units.slice(0, 3).map(u => ({ id: u.task.id, template: u.task.template_id, k: u.k })),
      systemPrompt: sp, budgetPerSession: Object.fromEntries(arms.map(a => [a.id, o.budget ?? DEFAULT_BUDGET[a.id]])) }, null, 1));
    return 0;
  }
  mkdirSync(runDir, { recursive: true });
  if (!o.resume) writeJson(path.join(runDir, 'launch.json'), settings);
  const resultsFile = path.join(runDir, 'results.jsonl'), faultsFile = path.join(runDir, 'faults.jsonl');
  const done = new Set(readJsonl(resultsFile).map(r => `${r.arm}|${r.id}|${r.k}`));
  const meter = meterJournal(path.join(runDir, 'meter.jsonl'));
  let lastMeter = readJsonl(meter.file).at(-1) ?? null;
  const world = worldAddresses(CLONE);
  let spent = readJsonl(resultsFile).reduce((s, r) => s + (r.costUsd ?? r.costUpperUsd ?? 0), 0), reserved = 0, stop = null;
  const log = m => console.error(`[wb-run ${new Date().toISOString().slice(11, 19)}] ${m}`);

  const live = path.join(BENCH, 'live', `run-${runId}`);
  mkdirSync(live, { recursive: true });
  const nWorkers = Math.max(1, Math.min(o.concurrency, units.length));
  const worlds = Array.from({ length: nWorkers }, (_, i) => startWorld(path.join(live, `world-${i}`)));
  await Promise.all(worlds.map(w => w.ready));
  const catalog = await catalogFrom(worlds[0]);
  const facadeBin = materializeFacadeBin(path.join(live, 'facade-bin'), catalog.mcpTools);
  let binary = 'claude';
  if (o.binary) { binary = path.join(path.dirname(facadeBin.relayScript), 'cli-standin.mjs'); copyFileSync(o.binary, binary); chmodSync(binary, 0o755); }
  const meterReadings = [];
  let next = 0, waveOk = null;
  const one = async (wi, u, arm) => {
    const key = `${arm.id}|${u.task.id}|${u.k}`;
    if (done.has(key) || stop) return;
    const free = diskFreeBytes(BENCH);
    if (free !== null && free < 1.0e9) { stop ??= `disk: ${Math.round(free / 1e6)} MB free`; return; }
    const g = gate(lastMeter, { wave: false });
    if (!g.ok) { stop ??= `meter: ${g.reason}`; return; }
    const budget = o.budget ?? (o.probe === 'identity' ? IDENTITY_BUDGET : DEFAULT_BUDGET[arm.id]);
    if (spent + reserved + budget > o.cap) { stop ??= `cap: spent ${spent.toFixed(3)} + reserved ${reserved.toFixed(3)} + ${budget} > ${o.cap}`; return; }
    reserved += budget;
    const hostDir = path.join(runDir, 'host', `${arm.id}-${u.task.id}-${u.k}`);
    let session = null, hostError = null, tr = null;
    try {
      tr = await runTaskThroughFacade({ task: u.task, world: worlds[wi], catalog, facadeBin, workRoot: path.join(live, 'w', `${wi}`), hostDir, keepWorkdir: false,
        agent: async ({ mcpConfig, workdir }) => {
          session = await runFacadeSession({ model: arm.model, effort: arm.effort, prompt: u.prompt, workdir, keepRo: [path.dirname(facadeBin.relayScript)], mcpConfig, builtinTools: arm.builtinTools,
            budgetUsd: budget, maxTurns: MAX_ITERATIONS, systemPrompt: sp, timeoutMs: TIMEOUT_MS, expectInit: o.initCheck ? initExpectation(arm.id, initProbe) : null, binary,
            onMeter: m => {
              lastMeter = m; meter.record(m, { arm: arm.id, id: u.task.id, k: u.k });
              meterReadings.push({ ...m, arm: arm.id });
              // PLAN §9.1 rule 2: a wave starts only at 5h <= 0.60 and 7d <= 0.80 (checked on the run's first reading)
              if (waveOk === null && m.fiveHour !== null) { const w = gate(m, { wave: true }); waveOk = w.ok; if (!w.ok && o.probe !== 'dose') stop ??= `meter: ${w.reason}`; }
            } });
          return session;
        } });
    } catch (e) { hostError = String(e?.stack ?? e).slice(0, 1000); }
    reserved -= budget;
    const cost = session?.costUsd ?? (session ? session.costUpperUsd : 0);
    spent += cost ?? 0;
    const base = { runId, arm: arm.id, model: arm.model, effort: arm.effort, id: u.task.id, template: u.task.template_id, domain: u.task.domain, k: u.k, sealed,
      sessionError: session?.error?.code ?? null, facadeEnvFault: tr?.facade?.envFault ?? null, hostError, costUsd: session?.costUsd ?? null, costUnknown: session?.costUnknown ?? !session,
      costUpperUsd: session?.costUpperUsd ?? budget, turns: session?.turns ?? null, durationMs: session?.durationMs ?? null, initFingerprintSha256: session?.initFingerprint ? fingerprintHash(session.initFingerprint) : null,
      streamUsage: session?.streamUsage ?? null, meter: session?.meter?.at(-1) ?? null, at: new Date().toISOString() };
    if (isEnvFault(base)) {
      appendFileSync(faultsFile, JSON.stringify({ ...base, stderrTail: session?.error?.stderr?.slice(-500) ?? null, initMismatch: session?.initMismatch ?? null }) + '\n');
      stop ??= `environment fault on ${key}: ${base.sessionError ?? base.facadeEnvFault ?? base.hostError?.slice(0, 120)}`;
      return;
    }
    const calls = tr.trajectory.calls;
    let rec;
    if (o.probe === 'identity') {
      rec = { ...base, probe: 'identity', ...identityVerdict({ reply: session?.result ?? '', calls, world }) };
      writeJson(path.join(hostDir, 'reply.json'), { reply: session?.result ?? null }); // host-only: may hold the account address
    } else {
      const outcomeError = base.sessionError ? (OUTCOME_ERRORS[base.sessionError] ?? base.sessionError) : '';
      const [v] = await gradeTrajectories([{ id: u.task.id, key: key, actions: tr.trajectory.actions, error: outcomeError, fatal: Boolean(tr.trajectory.fatal), live: tr.snapshot }],
        { tasksFile: sealed ? path.join(runDir, 'sealed-tasks.jsonl') : path.join(runDir, 'tasks.jsonl'), dir: path.join(runDir, 'grade') });
      const idn = foreignAddresses({ calls, taskText: u.task.task, world });
      rec = { ...base, correct: v.correct, correctState: v.correct_state, sideEffects: v.side_effects, sideEffectsExecuted: v.side_effects_executed ?? null, exactMatch: v.exact_match,
        nativeCorrect: v.native_correct ?? null, graderAgree: v.agree ?? null, liveMatchesReplay: v.live_matches_replay ?? null, error: v.error, fatal: v.fatal, capHit: base.sessionError,
        nActions: v.n_actions, gtLen: v.gt_len, worldCalls: tr.facade.worldCalls, writes: tr.facade.writes, pythonCalls: tr.facade.pythonCalls, refused: tr.facade.refused, rejected: tr.facade.rejected,
        argAddresses: idn.argAddresses, foreignAddresses: idn.foreign, foreignDomains: idn.foreignDomains };
      if (idn.foreign) writeJson(path.join(hostDir, 'foreign.json'), idn);
    }
    appendFileSync(resultsFile, JSON.stringify(rec) + '\n');
    done.add(key);
    // sealed runs never print a per-task grade (it stays in the host-only results file)
    const shown = o.probe ? (rec.pass ?? rec.reply) : sealed ? 'done' : rec.correct ? 'correct' : `wrong${rec.capHit ? ` (${rec.capHit})` : ''}`;
    log(`${arm.id} ${u.task.id}#${u.k}: ${shown} $${(base.costUsd ?? 0).toFixed(4)} spent $${spent.toFixed(3)} 5h ${lastMeter?.fiveHour ?? '-'} 7d ${lastMeter?.sevenDay ?? '-'}`);
  };
  if (!o.probe) writeJsonl(path.join(runDir, sealed ? 'sealed-tasks.jsonl' : 'tasks.jsonl'), [...new Map(units.map(u => [u.task.id, u.task])).values()]);
  try {
    await Promise.all(worlds.map(async (_, wi) => {
      while (next < units.length && !stop) {
        const u = units[next++];
        for (const arm of arms) if (armRuns(arm, u)) await one(wi, u, arm);
      }
    }));
  } finally {
    await Promise.all(worlds.map(w => w.close()));
    rmSync(live, { recursive: true, force: true });
  }
  const recs = readJsonl(resultsFile), faults = readJsonl(faultsFile);
  const summary = { runId, settings, at: new Date().toISOString(), stop, units: units.length, recorded: recs.length, faults: faults.length, spentUsd: Math.round(spent * 10000) / 10000,
    perArm: Object.fromEntries(arms.map(a => { const rs = recs.filter(r => r.arm === a.id); return [a.id, o.probe === 'identity' ? { n: rs.length, pass: rs.filter(r => r.pass).length, saidUnknown: rs.filter(r => r.saidUnknown).length, foreignDomains: [...new Set(rs.flatMap(r => r.replyForeignDomains ?? []))] }
      : sealed ? { n: rs.length, costUsd: rs.reduce((s, r) => s + (r.costUsd ?? 0), 0) }
      : { n: rs.length, correct: rs.filter(r => r.correct).length, sideEffects: rs.filter(r => r.sideEffects).length, capHits: rs.filter(r => r.capHit).length, foreignAddressSessions: rs.filter(r => r.foreignAddresses).length,
        graderDisagree: rs.filter(r => r.graderAgree === false).length, costUsd: Math.round(rs.reduce((s, r) => s + (r.costUsd ?? 0), 0) * 10000) / 10000 }]; })) };
  // meter movement against list-price spend (attributable only when no other session ran on the account)
  summary.meter = { first: meterReadings[0] ?? null, last: meterReadings.at(-1) ?? null, ...doseSummary(meterReadings, Math.round(spent * 10000) / 10000),
    note: 'one shared meter for every model and agent on the account; with other sessions running these are upper bounds per tick' };
  if (o.pool === 'anchor' && !o.probe) {
    const rows = recs.filter(r => r.arm === 'H45');
    summary.anchor = { n: rows.length, ours: rows.filter(r => r.correct).length, published: prescreen.anchor.publishedHaiku45Correct, publishedN: prescreen.anchor.ids.length,
      gapPoints: rows.length ? Math.round(((rows.filter(r => r.correct).length / rows.length) - prescreen.anchor.publishedHaiku45Rate / 100) * 1000) / 10 : null,
      rule: 'a gap above 10 points is reported as a harness difference' };
  }
  writeJson(path.join(runDir, 'SUMMARY.json'), summary);
  // dev and probe aggregates are committed; sealed ones and stand-in (test) runs stay host-only
  if (!sealed && !o.binary) writeJson(path.join(RESEARCH, 'runs', runId, 'SUMMARY.json'), summary);
  console.log(JSON.stringify({ ...summary, settings: undefined }, null, 1));
  return stop?.startsWith('environment fault') ? 3 : stop ? 4 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(code => process.exit(code)).catch(e => { console.error(e?.stack ?? e); process.exit(1); });
}
