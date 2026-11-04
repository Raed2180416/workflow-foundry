#!/usr/bin/env node
// AppWorld runner (experiments/breadth/appworld; research/breadth-20261021/appworld/NOTES.md). Modelled on the
// AutomationBench runner (experiments/autobench/run.mjs), SOP-Bench (experiments/sopbench/) and the AgentDojo bed.
//
// Per unit (one AppWorld task, one repeat): a PUBLIC VIEW of the task's data (no ground truth) and a fresh serve root are
// laid out; a fresh sandboxed `bridge.py serve` process opens a fresh world (load_ground_truth=False); a host facade
// answers the session's mailbox; ONE sandboxed `claude -p` session (session.mjs) sees only `execute`, `api_docs`, `python`
// and, for A-HN, the notes tools, through the MCP relay (mcp.mjs). When the session ends, the world is closed, its
// outputs are copied to a host-only snapshot, and a SEPARATE host-only grader process (`bridge.py grade-serve`) runs
// AppWorld's own evaluator on the snapshot (evaluate_task: what world.evaluate() runs). Scripted ($0) policies drive the
// SAME relay -> facade -> serve path in-process instead of a model.
//
//   node experiments/breadth/appworld/run.mjs --scripted null|docs|gold --split devTrain|devCheck|dev       ($0)
//   node experiments/breadth/appworld/run.mjs --arm A-H --split devTrain --pilot --cap 8                     (dev pilot)
//   node experiments/breadth/appworld/run.mjs --arm A-H --split devCheck --look 1 --cap 15                   (dev hold-back)
//   node experiments/breadth/appworld/run.mjs --arm A-H --sealed --freeze <SEALED-FREEZE.json> --subset haiku --cap 45
// Options: --budget USD (per session; arm default) --max-turns 50 --max-executes 100 --timeout-min 15 --concurrency 2
//   --limit N (a prefix of the hashed run order) --repeat K --card FILE (bed card, appended to the system prompt; hashed)
//   --run-id ID --resume --offline (the $0 init probe: every session stops at its init event) --keep (workdirs)
//   --profile arm|verify (world settings; default arm)
// Split hygiene: test_challenge is never run; devCheck needs --look 1..3 (logged host-side, a 4th look is refused);
// test_normal needs --sealed and a freeze naming this split; sealed results never leave the host-only directories.
// Environment faults (rate or usage limit, model unavailable, no sandbox, a serve/grader failure, a CONFIG_MISMATCH,
// low disk) are never scored: the record goes to results.faults.jsonl, no new session starts and the run stops
// (exit 3); `--resume` with the same command keeps every recorded unit. The cap stops the run (exit 4); the usage meter
// gate (5-hour utilisation >= 0.80) stops it before a new session (exit 5).
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { loadPolicy, modelById } from '../../../src/models/policy.mjs';
import { ENV_FAULTS } from '../../lib/runner.mjs';
import { BRIDGE, BridgeServer, HOST_ROOT, LIVE_ROOT, PIN, RESEARCH, SPLIT_FILE, WORLD_PROFILES, buildPublicView, buildServeRoot, freeBytes, pool, readJson, readJsonl,
  scenarioOf, sha256, shaCanon, snapshotOutputs, writeJson } from './lib.mjs';
import { Facade, memoryNotes } from './facade.mjs';
import { SERVER, armTools, makeServer } from './mcp.mjs';
import { materializeSession, meterGate, runSession } from './session.mjs';
import { loadSplit, roleOf, runOrder, sonnetSubset } from './split.mjs';

/** Frozen arm presets (PLAN §5.2, §8.2; D19). F-H runs through the F-kit, which is not part of this adapter. Per-session
 * budgets are ceilings, replaced by 1.5 x each arm's dev-pilot p99 before the sealed run (PLAN §5.2 "Caps"). */
export const ARMS = Object.freeze({
  'A-H': Object.freeze({ model: 'claude-haiku-5-5', effort: 'high', budgetUsd: 0.60, notes: false }),
  'A-HN': Object.freeze({ model: 'claude-haiku-5-5', effort: 'high', budgetUsd: 0.70, notes: true }),
  'A-S': Object.freeze({ model: 'claude-sonnet-5-5', effort: 'high', budgetUsd: 4.00, notes: false }),
  'A-O': Object.freeze({ model: 'claude-opus-5-5', effort: 'xhigh', budgetUsd: 10.00, notes: false }),
});
export const SCRIPTED = Object.freeze(['null', 'docs', 'gold']);
/** Dev-pilot prefix of SPLIT.json pilotOrder per arm (the cost gate, PLAN §9; about $55 at the §10 anchors). */
export const PILOT_SIZES = Object.freeze({ 'A-H': 30, 'A-HN': 30, 'A-S': 12, 'A-O': 6 });
/** AppWorld has no single official step cap (README: the agent loop runs `for _ in range(MAX_STEPS)`; the environment's
 * max_interactions is 1000). Declared here, identical for every arm, revisited with the dev pilot's p99. */
export const DEFAULTS = Object.freeze({ maxTurns: 50, maxExecutes: 100, timeoutMin: 15, concurrency: 2, minFreeBytes: 300 * 1024 * 1024 });
export const RUNS_ROOT = LIVE_ROOT;
const INFRA_FAULT = /ENOSPC|EDQUOT|EMFILE|ENFILE|bridge (?:exited|is closed)|environment failed to answer|low disk/;
export const isEnvFault = r => ENV_FAULTS.has(r?.sessionError) || r?.sessionError === 'CONFIG_MISMATCH' || INFRA_FAULT.test(`${r?.harnessError ?? ''} ${r?.facade?.bridgeError ?? ''}`);
/** Attempts to reach the benchmark's distribution, host files, processes or the network in code an arm runs (L5 audit;
 * a hit fails the unit). Deliberately NOT the bare word "appworld": the arm's own prompt names the AppWorld environment,
 * so a comment or a print may mention it; what counts is importing the package or touching its files. */
export const BENCH_REF = /\b(?:import|from)\s+appworld\b|__import__\(\s*['"]appworld|ground_truth|\/var\/tmp|benches\/|appworld-host|site-packages|stonybrook|huggingface\.co|\bhf_hub\b|pip\s+install|urllib|requests\.(?:get|post)|\bsocket\b|\bsubprocess\b/i;

// ---- prompts ---------------------------------------------------------------------------------------------------------
export const SYSTEM_PREAMBLE = `You are an autonomous agent that completes tasks for a person (your supervisor) by operating their apps through the AppWorld environment. Work on your own: there is no one to ask, and input() is not available.`;
export const FACADE_NOTE = `## Tools
Your tools are offered by the "appworld" tool server: \`execute\` runs Python code in the AppWorld environment (the \`apis\` object reaches every app), \`api_docs\` looks up API documentation, and \`python\` is a separate sandboxed interpreter for computing or checking that cannot see the apps. Look up an API's documentation before calling it. Account passwords are available from apis.supervisor.show_account_passwords(). When you have finished, call apis.supervisor.complete_task() inside \`execute\` (pass answer=... when the task asks for information; call complete_task(status="fail") if it cannot be done). Then give a one-line final message.`;
export const DATE_NOTE = `## Date
Today's date and time are whatever the AppWorld environment reports (for example DateTime.now() inside \`execute\`). Do not use your own idea of the current date.`;
export const NOTES_NOTE = `## Notes
You have a notes file (read_notes, write_notes) that is kept across a series of related tasks. Use it as you see fit.`;
export function systemPrompt({ notes = false, card = null }) {
  return [SYSTEM_PREAMBLE, FACADE_NOTE, DATE_NOTE, ...(notes ? [NOTES_NOTE] : []), ...(card ? [`## Bed card\n${card.trim()}`] : [])].join('\n\n');
}
/** The task prompt: AppWorld's own convention (the supervisor's identity, then the task instruction). */
export function taskPrompt(ready) {
  const s = ready.supervisor;
  return `My name is ${s.first_name} ${s.last_name}. My personal email is ${s.email} and my phone number is ${s.phone_number}.\n\nTask: ${ready.instruction}`;
}

// ---- units and split hygiene ----------------------------------------------------------------------------------------
export const unitKey = (id, r = 0) => `${id}#${r}`;
const LOOK_LOG = path.join(HOST_ROOT, 'devcheck-looks.jsonl');
/** Refuse what the split forbids. Returns the role of the units. */
export function assertUnits(split, ids, { sealed = false, freeze = null, look = null, armFamily = null, record = true } = {}) {
  const roles = new Set(ids.map(id => roleOf(split, id)));
  if (roles.has(null)) throw new Error('a unit is outside train, dev and test_normal (test_challenge is never run)');
  if (roles.size !== 1) throw new Error(`units mix roles (${[...roles].join(', ')})`);
  const role = [...roles][0];
  if (role === 'sealed') {
    if (!sealed || !freeze || !existsSync(freeze)) throw new Error('test_normal units need --sealed --freeze <SEALED-FREEZE.json>');
    const f = readJson(freeze);
    if (f.kind !== 'appworld-sealed-freeze' || f.splitSha256 !== split.splitSha256) throw new Error('the freeze file does not freeze this split');
    return { role, freeze: f };
  }
  if (sealed) throw new Error('--sealed applies to test_normal units only');
  if (role === 'devCheck' && armFamily) {
    const n = Number(look);
    if (!(n >= 1 && n <= 3)) throw new Error('devCheck (the dev hold-back) needs --look 1|2|3');
    const prior = readJsonl(LOOK_LOG).filter(l => l.armFamily === armFamily);
    if (prior.some(l => l.look === n)) throw new Error(`look ${n} for ${armFamily} is already recorded (${LOOK_LOG}); at most 3 looks`);
    if (record) { mkdirSync(path.dirname(LOOK_LOG), { recursive: true }); appendFileSync(LOOK_LOG, JSON.stringify({ armFamily, look: n, at: new Date().toISOString(), units: ids.length }) + '\n'); }
  }
  return { role, freeze: null };
}

// ---- the scripted client: the relay in-process, the same mailbox, facade and serve process as a session ---------------
export function scriptedSession(chunks, tools) {
  return async ({ workdir }) => {
    const box = path.join(workdir, '.tools');
    let last = null;
    const handle = makeServer({ tools, box, waitMs: 600_000, write: m => { last = m; } });
    let id = 0;
    const t0 = Date.now();
    const outputs = [];
    for (const code of chunks) {
      await handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'execute', arguments: { code } } });
      const text = last?.result?.content?.[0]?.text;
      if (text === undefined) throw new Error('relay gave no result');
      outputs.push(text);
    }
    return { ok: true, error: null, result: 'done', resultSubtype: 'success', costUsd: 0, costUnknown: false, costUpperUsd: 0, turns: chunks.length + 1, durationMs: Date.now() - t0,
      toolUses: [], nestedModelUses: 0, meter: [], initFingerprint: null, streamUsage: null, outputsSha256: sha256(JSON.stringify(outputs.map(o => sha256(o)))) };
  };
}

// ---- one unit -------------------------------------------------------------------------------------------------------
export async function runUnit(o) {
  const { id, r, live, hostRoot } = o;
  const key = unitKey(id, r);
  const tag = key.replace('#', '__r');
  const hostDir = path.join(hostRoot, 'units', tag);
  const unitLive = path.join(live, 'u', tag);
  const workdir = path.join(unitLive, 'w'), pub = path.join(unitLive, 'pub'), serveRoot = path.join(unitLive, 'serve');
  const rec = { key, taskId: id, scenario: scenarioOf(id), r, arm: o.armName ?? null, model: o.arm?.model ?? null, scripted: o.policy ?? null, profile: o.profile };
  let facade = null, handle = null, started = false, s = null, serve = null;
  try {
    if ((await freeBytes('/var/tmp')) < (o.minFreeBytes ?? DEFAULTS.minFreeBytes)) throw new Error('low disk: fewer free bytes than the run minimum (D16)');
    rmSync(unitLive, { recursive: true, force: true }); rmSync(hostDir, { recursive: true, force: true });
    mkdirSync(hostDir, { recursive: true }); mkdirSync(workdir, { recursive: true });
    buildPublicView(pub, [id]);
    buildServeRoot(serveRoot, pub);
    serve = new BridgeServer({ cmd: 'serve', serveRoot, publicDir: pub });
    await serve.hello;
    handle = serve.handle('u');
    const ready = await serve.open(handle, id, WORLD_PROFILES[o.profile]);
    if (ready.groundTruthLoaded) throw new Error('the serve world loaded ground truth');
    const prompt = taskPrompt(ready);
    Object.assign(rec, { preDigest: ready.preDigest.sha256, promptSha256: sha256(prompt) });
    writeJson(path.join(hostDir, 'prompt.json'), { prompt, datetime: ready.datetime }); // host-only (task content)
    const tools = armTools(Boolean(o.arm?.notes));
    const { mcpConfig } = materializeSession(workdir, tools);
    facade = new Facade({ workdir, bridge: serve, handle, notes: o.notes ?? null, log: o.log, maxExecutes: o.maxExecutes ?? DEFAULTS.maxExecutes }).start();
    started = true;
    const sys = systemPrompt({ notes: Boolean(o.arm?.notes), card: o.card });
    rec.systemPromptSha256 = sha256(sys);
    if (o.policy) s = await scriptedSession(o.plan ?? [], tools)({ workdir });
    else {
      s = await runSession({ model: o.arm.model, effort: o.arm.effort, prompt, workdir, mcpConfig, toolNames: tools.map(t => t.name), budgetUsd: o.budgetUsd,
        maxTurns: o.maxTurns, systemPrompt: sys, timeoutMs: o.timeoutMin * 60_000, offline: o.offline, onMeter: o.onMeter });
    }
    Object.assign(rec, { costUsd: s.costUsd ?? s.costUpperUsd ?? o.budgetUsd, costUnknown: Boolean(s.costUnknown), turns: s.turns, durationMs: s.durationMs, sessionError: s.error?.code ?? null,
      sessionDetail: s.error ? { mismatch: s.error.mismatch ?? null, stderr: String(s.error.stderr ?? '').slice(-400) } : null, resultSubtype: s.resultSubtype ?? null,
      streamUsage: s.streamUsage ?? null, modelUsage: s.modelUsage ?? null, init: s.initFingerprint ?? null, meterLast: s.meter?.at(-1) ?? null, toolUses: (s.toolUses ?? []).map(t => t.name),
      outputsSha256: s.outputsSha256 ?? null });
    rec.facade = await facade.stop();
    facade = null;
    writeFileSync(path.join(hostDir, 'final.txt'), String(s.result ?? '')); // host-only
    const closed = await serve.close(handle);
    handle = null;
    Object.assign(rec, { executes: closed.executes, completed: closed.completed, postDigest: closed.postDigest.sha256, logsDigest: closed.apiCallsDigest.sha256 });
    snapshotOutputs(serveRoot, closed.outputRel, path.join(hostDir, 'output'));
    rec.audit = auditSession(s, tools);
  } catch (e) {
    rec.harnessError = String(e?.message ?? e).slice(0, 800);
  } finally {
    if (facade) rec.facade = await facade.stop().catch(() => null);
    if (handle && serve) await serve.close(handle).catch(() => {});
    if (serve) await serve.quit().catch(() => {});
    if (!s && started && !o.policy) Object.assign(rec, { costUsd: o.budgetUsd, costUnknown: true });
    rec.costUsd ??= 0;
    try { writeFileSync(path.join(hostDir, 'transcript.jsonl'), readFileSync(path.join(workdir, '.executor-transcript.jsonl'))); } catch {}
    if (!o.keep) rmSync(unitLive, { recursive: true, force: true });
  }
  rec.hostDir = hostDir;
  return { rec, started };
}

/** L5 audit of one session: only relay tools may appear; python code that references the benchmark or the network is
 * flagged; nested model use is flagged. */
export function auditSession(s, tools) {
  const allowed = new Set(tools.map(t => `mcp__${SERVER}__${t.name}`));
  const violations = [];
  for (const t of s.toolUses ?? []) {
    if (!allowed.has(t.name)) violations.push(`L5: tool ${t.name} outside the arm's set`);
    if (/__(python|execute)$/.test(t.name) && BENCH_REF.test(String(t.input?.code ?? ''))) violations.push('L5: code references the benchmark distribution or the network');
  }
  if (s.nestedModelUses) violations.push(`nested model use x${s.nestedModelUses}`);
  return { violations: [...new Set(violations)] };
}

// ---- outcome ---------------------------------------------------------------------------------------------------------
/** Per-unit outcome. tgc: AppWorld's task success (every assertion of the task's evaluation passes) = the margin
 * outcome (TGC). subGoal: the share of the task's assertions that pass (the per-assertion sub-goal measure, PREREG §4).
 * collateral (BG-11): an assertion labelled no_op_pass failed, i.e. something the do-nothing agent leaves intact was
 * broken. An L5 violation scores the unit as a failure. */
export function outcome(verdict, audit) {
  const v = verdict ?? {};
  const violated = Boolean(audit?.violations?.length);
  const total = (v.passCount ?? 0) + (v.failCount ?? 0);
  return { tgc: !violated && v.success === true, subGoal: total ? (violated ? 0 : v.passCount / total) : null,
    collateral: (v.failures ?? []).some(f => f.label === 'no_op_pass') };
}
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
/** TGC, SGC (a scenario counts when every one of its run variants passes), sub-goal and collateral rates. */
export function summarize(results) {
  const byScenario = new Map();
  for (const r of results) { if (!byScenario.has(r.scenario)) byScenario.set(r.scenario, []); byScenario.get(r.scenario).push(r.outcome.tgc); }
  return { n: results.length, tgc: mean(results.map(r => (r.outcome.tgc ? 1 : 0))), sgc: mean([...byScenario.values()].map(xs => (xs.every(Boolean) ? 1 : 0))), scenarios: byScenario.size,
    subGoal: mean(results.map(r => r.outcome.subGoal).filter(x => x !== null)), collateral: mean(results.map(r => (r.outcome.collateral ? 1 : 0))),
    maxTurnsHits: results.filter(r => r.sessionError === 'MAX_TURNS').length, notCompleted: results.filter(r => !r.completed).length,
    violations: results.filter(r => r.audit?.violations?.length).length };
}

// ---- ledger --------------------------------------------------------------------------------------------------------------
export function makeLedger(capUsd) {
  const l = { capUsd, spent: 0, reserved: 0, unknown: 0 };
  l.tryReserve = b => { if (l.spent + l.reserved + b <= capUsd + 1e-9) { l.reserved += b; return true; } return false; };
  l.reserve = async b => { while (!l.tryReserve(b)) { if (l.reserved <= 1e-9) return false; await new Promise(res => setTimeout(res, 250)); } return true; };
  l.settle = (b, cost, unknown) => { l.reserved -= b; l.spent += cost; if (unknown) l.unknown += 1; };
  return l;
}

/** Scripted plans (host-only plan process; train/dev only, never test). */
export async function plansFor(ids, { runHostImpl } = {}) {
  const { DATA_DIR, runHost } = await import('./lib.mjs');
  const spec = path.join(HOST_ROOT, 'plans', `spec-${process.pid}-${Date.now()}.json`);
  writeJson(spec, { dataDir: DATA_DIR, taskIds: ids });
  const r = await (runHostImpl ?? runHost)(['plan', spec], { root: path.join(HOST_ROOT, 'plan-root') });
  rmSync(spec, { force: true });
  const out = new Map();
  for (const p of r.proto.filter(x => x.kind === 'plan')) { if (p.error) throw new Error(`plan ${p.taskId}: ${p.error}`); out.set(p.taskId, p); }
  return out;
}

// ---- the run -----------------------------------------------------------------------------------------------------------
export async function runUnits(o) {
  const log = o.log ?? (m => process.stderr.write(m + '\n'));
  const scripted = Boolean(o.policy);
  const arm = scripted ? null : ARMS[o.armName];
  if (!scripted) {
    if (!arm) throw new Error(`unknown arm ${o.armName} (${Object.keys(ARMS).join(', ')}; F-H runs through the F-kit)`);
    modelById(loadPolicy().policy, arm.model); // refuses ids the policy does not list
    if (!(o.capUsd > 0)) throw new Error('--cap (hard USD cap for the run) is required for model runs');
  } else if (!SCRIPTED.includes(o.policy)) throw new Error(`unknown scripted policy ${o.policy}`);
  const profile = o.profile ?? 'arm';
  if (!WORLD_PROFILES[profile]) throw new Error(`unknown --profile ${profile}`);
  const split = loadSplit(o.splitFile ?? SPLIT_FILE);
  const { role, freeze } = assertUnits(split, o.ids, { sealed: o.sealed, freeze: o.freeze, look: o.look, armFamily: scripted ? null : (o.armName === 'A-HN' ? 'A-H' : o.armName), record: !o.resume });
  if (scripted && role === 'sealed') throw new Error('scripted policies run on dev splits only');
  const repeat = o.repeat ?? 1;
  const budgetUsd = o.budgetUsd ?? arm?.budgetUsd ?? 0;
  const ids = runOrder(o.ids, split.salt);
  const runId = o.runId ?? `aw-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${sha256(String(Math.random())).slice(0, 6)}`;
  const live = o.liveRoot ?? path.join(RUNS_ROOT, runId);
  const hostRoot = path.join(o.hostRoot ?? HOST_ROOT, 'runs', runId);
  mkdirSync(live, { recursive: true }); mkdirSync(hostRoot, { recursive: true });
  const resultsFile = path.join(hostRoot, 'results.jsonl'), faultsFile = path.join(hostRoot, 'results.faults.jsonl'), launchFile = path.join(hostRoot, 'launch.json'), meterFile = path.join(hostRoot, 'meter.jsonl');
  const card = o.cardFile ? readFileSync(o.cardFile, 'utf8') : null;
  const launch = { ids, idsSha256: shaCanon(ids), role, arm: o.armName ?? null, model: arm?.model ?? null, effort: arm?.effort ?? null, policy: o.policy ?? null, profile,
    repeat, budgetUsd, maxTurns: o.maxTurns, maxExecutes: o.maxExecutes, timeoutMin: o.timeoutMin, sealed: Boolean(o.sealed), splitSha256: split.splitSha256, offline: Boolean(o.offline),
    cardSha256: card ? sha256(card) : null, capUsd: o.capUsd ?? null, look: o.look ?? null, runnerSha256: sha256(readFileSync(new URL(import.meta.url))) };
  let kept = [];
  if (existsSync(launchFile)) {
    if (!o.resume) throw new Error(`${hostRoot} already holds a run: pass --resume to continue it, or use a new --run-id`);
    const prior = readJson(launchFile);
    const settings = ({ capUsd, runnerSha256, history, ...rest }) => JSON.stringify(rest);
    if (settings(prior) !== settings(launch)) throw new Error(`resume refused: the settings differ from ${launchFile}`);
    if (launch.capUsd !== null && prior.capUsd !== null && launch.capUsd < prior.capUsd) throw new Error('resume refused: the cap can only be raised');
    writeJson(launchFile, { ...prior, capUsd: launch.capUsd, runnerSha256: launch.runnerSha256, history: [...(prior.history ?? []), { at: new Date().toISOString(), capUsd: [prior.capUsd, launch.capUsd] }] });
    kept = readJsonl(resultsFile);
  } else writeJson(launchFile, launch);
  const jobs = [];
  for (let r = 0; r < repeat; r++) for (const id of ids) jobs.push({ id, r });
  const done = new Set(kept.map(x => x.key));
  const ledger = makeLedger(scripted ? Infinity : o.capUsd);
  for (const x of [...kept, ...readJsonl(faultsFile)]) ledger.spent += x.costUsd ?? 0;
  log(`[appworld] run ${runId}: ${jobs.length} units (${ids.length} x ${repeat}, ${role}), ${scripted ? `scripted ${o.policy}` : `arm ${o.armName} (${arm.model}, ${arm.effort})`}${o.offline ? ', OFFLINE init probe' : ''}`);
  if (kept.length) log(`[appworld] resuming: ${kept.length}/${jobs.length} kept, $${ledger.spent.toFixed(4)} spent`);
  const plans = scripted && o.policy !== 'null' ? await plansFor(ids) : null;
  // A-HN: the variants of one scenario in one lineage run in sequence, carrying the notes file (hashed order).
  const notesOf = new Map();
  const notesFile = (r, id) => path.join(hostRoot, 'notes', String(r), `${scenarioOf(id)}.txt`);
  const groups = [];
  if (arm?.notes) {
    const g = new Map();
    for (const j of jobs) { const k = `${j.r}|${scenarioOf(j.id)}`; if (!g.has(k)) g.set(k, []); g.get(k).push(j); }
    for (const js of g.values()) groups.push(js.sort((a, b) => (sha256(`${split.salt}:notes:${a.r}:${a.id}`) < sha256(`${split.salt}:notes:${b.r}:${b.id}`) ? -1 : 1)));
  } else for (const j of jobs) groups.push([j]);
  const grader = o.offline ? null : new BridgeServer({ cmd: 'grade-serve', root: path.join(hostRoot, 'grade-root'), onExit: c => log(`[appworld] grader exited (${c})`) });
  if (grader) await grader.hello;
  const results = [...kept];
  let stopped = null, stopKind = null, lastMeter = null;
  const meterLog = m => { lastMeter = m; appendFileSync(meterFile, JSON.stringify({ at: new Date().toISOString(), ...m }) + '\n'); };
  try {
    await pool(groups, o.concurrency ?? DEFAULTS.concurrency, async group => {
      for (const { id, r } of group) {
        if (stopped || done.has(unitKey(id, r))) continue;
        const g = scripted || o.offline ? { ok: true } : meterGate(lastMeter);
        if (!g.ok) { stopped ??= `usage meter: ${g.reason}`; stopKind ??= 'meter'; return; }
        if (!(await ledger.reserve(budgetUsd))) { stopped ??= `the cap ($${ledger.spent.toFixed(4)} spent + ${budgetUsd} > ${o.capUsd})`; stopKind ??= 'cap'; return; }
        let notes = null;
        if (arm?.notes) {
          const f = notesFile(r, id);
          if (!notesOf.has(f)) notesOf.set(f, memoryNotes(existsSync(f) ? readFileSync(f, 'utf8') : ''));
          notes = notesOf.get(f);
        }
        const plan = plans ? plans.get(id).plans[o.policy] : [];
        const { rec, started } = await runUnit({ id, r, live, hostRoot, armName: o.armName, arm, policy: o.policy, plan, profile, budgetUsd, maxTurns: o.maxTurns, maxExecutes: o.maxExecutes,
          timeoutMin: o.timeoutMin, offline: o.offline, card, notes, keep: o.keep, onMeter: meterLog, log, minFreeBytes: o.minFreeBytes });
        ledger.settle(budgetUsd, rec.costUsd, rec.costUnknown);
        if (notes) { mkdirSync(path.dirname(notesFile(r, id)), { recursive: true }); writeFileSync(notesFile(r, id), notes.read()); }
        if (isEnvFault(rec) || (rec.harnessError && !started)) {
          appendFileSync(faultsFile, JSON.stringify({ ...rec, stoppedBy: 'environment fault' }) + '\n');
          stopped ??= `environment fault at ${rec.key}: ${rec.sessionError ?? rec.harnessError ?? rec.facade?.bridgeError}`; stopKind ??= 'environment';
          log(`[appworld] ${rec.key}: environment fault (${rec.sessionError ?? rec.harnessError}); not scored`);
          return;
        }
        if (o.offline) { results.push(rec); appendFileSync(resultsFile, JSON.stringify(rec) + '\n'); log(`[appworld] ${rec.key} offline init ok=${!rec.sessionError} tools=${rec.init?.tools?.length ?? 0}`); continue; }
        let verdict = null;
        try { verdict = await grader.grade(id, path.join(rec.hostDir, 'output')); } catch (e) { rec.gradeError = String(e?.message ?? e).slice(0, 400); }
        if (rec.gradeError || rec.harnessError) { // a grading or harness failure is a fault, never a task outcome
          appendFileSync(faultsFile, JSON.stringify({ ...rec, stoppedBy: rec.gradeError ? 'grading fault' : 'harness fault' }) + '\n');
          stopped ??= `${rec.gradeError ? 'grading' : 'harness'} fault at ${rec.key}: ${rec.gradeError ?? rec.harnessError}`; stopKind ??= 'environment';
          log(`[appworld] ${rec.key}: ${rec.gradeError ? 'grading' : 'harness'} fault; not scored`);
          return;
        }
        writeJson(path.join(rec.hostDir, 'verdict.json'), verdict); // host-only: assertion texts are task content
        rec.verdict = { success: verdict.success, passCount: verdict.passCount, failCount: verdict.failCount, passSha256: verdict.passSha256, failSha256: verdict.failSha256,
          gradedPostDigest: verdict.postDigest.sha256, noOpPassFailures: verdict.failures.filter(f => f.label === 'no_op_pass').length };
        rec.outcome = outcome(verdict, rec.audit);
        results.push(rec);
        appendFileSync(resultsFile, JSON.stringify(rec) + '\n');
        log(`[appworld] ${rec.key} tgc=${rec.outcome.tgc ? 1 : 0} asserts=${verdict.passCount}/${verdict.passCount + verdict.failCount} turns=${rec.turns ?? '-'} executes=${rec.executes ?? '-'} $${(rec.costUsd ?? 0).toFixed(4)}${rec.sessionError ? ` (${rec.sessionError})` : ''}${rec.audit?.violations?.length ? ` [${rec.audit.violations.join('; ')}]` : ''}`);
      }
    });
  } finally { if (grader) await grader.quit(); }
  const faults = readJsonl(faultsFile);
  const summary = {
    runId, label: scripted ? `scripted ${o.policy} (no model)` : `arm ${o.armName}: ${arm.model} at ${arm.effort}`, arm: o.armName ?? null, policy: o.policy ?? null, role,
    evidence: role === 'sealed' ? 'SEALED (test_normal, H1e); per-task results stay host-only' : `development/diagnostic (${role}); not held-out`, offline: Boolean(o.offline),
    stopped, complete: !stopped && results.length === jobs.length, ...(o.offline ? { n: results.length, of: jobs.length, initOk: results.filter(r => !r.sessionError).length } : summarize(results)),
    cost: { spentUsd: ledger.spent, perUnitUsd: results.length ? results.reduce((a, r) => a + (r.costUsd ?? 0), 0) / results.length : null, unknownCostSessions: ledger.unknown,
      faultSpendUsd: faults.reduce((a, r) => a + (r.costUsd ?? 0), 0), capUsd: o.capUsd ?? null, budgetUsdPerSession: budgetUsd,
      p99UsdPerUnit: results.length ? [...results.map(r => r.costUsd ?? 0)].sort((a, b) => a - b)[Math.min(results.length - 1, Math.ceil(0.99 * results.length) - 1)] : null },
    time: { p99MsPerUnit: results.length ? [...results.map(r => r.durationMs ?? 0)].sort((a, b) => a - b)[Math.min(results.length - 1, Math.ceil(0.99 * results.length) - 1)] : null },
    tokens: scripted ? null : ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'].reduce((a, k) => ({ ...a, [k]: results.reduce((x, r) => x + (r.streamUsage?.[k] ?? 0), 0) }), {}),
    meter: { readings: readJsonl(meterFile).length, last: lastMeter }, envFaults: faults.length,
    settings: { repeat, profile, world: WORLD_PROFILES[profile], budgetUsd, maxTurns: o.maxTurns, maxExecutes: o.maxExecutes, timeoutMin: o.timeoutMin, concurrency: o.concurrency },
    provenance: { pin: PIN, splitSha256: split.splitSha256, idsSha256: launch.idsSha256, freezeSha256: freeze ? shaCanon(freeze) : null, bridgeSha256: sha256(readFileSync(BRIDGE)),
      runnerSha256: launch.runnerSha256, relaySha256: sha256(readFileSync(new URL('./mcp.mjs', import.meta.url))), sessionSha256: sha256(readFileSync(new URL('./session.mjs', import.meta.url))),
      cardSha256: launch.cardSha256, node: process.version, cli: scripted ? null : cliVersion() },
    hostRoot, finishedAt: new Date().toISOString(),
  };
  writeJson(path.join(hostRoot, 'summary.json'), summary);
  // Only dev aggregates may enter the repository; sealed runs stay host-only (AppWorld's terms; PREREG §8.3).
  if (o.outDir !== null && role !== 'sealed') {
    const out = o.outDir ?? path.join(RESEARCH, 'runs', runId);
    mkdirSync(out, { recursive: true });
    writeJson(path.join(out, 'summary.json'), { ...summary, hostRoot: undefined });
    summary.copiedTo = out;
  }
  if (!o.keep) rmSync(live, { recursive: true, force: true });
  if (stopped) log(`[appworld] STOPPED: ${stopped}. ${results.length}/${jobs.length} units recorded, $${ledger.spent.toFixed(4)} spent.`);
  return { summary, results, stopped, stopKind };
}

function cliVersion() { try { return execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 30_000 }).trim(); } catch { return null; } }

export function parseArgs(argv) {
  const a = {}, flags = new Set(['keep', 'no-copy', 'resume', 'sealed', 'offline', 'pilot']);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`unexpected argument ${k}`);
    const name = k.slice(2);
    if (flags.has(name)) a[name] = true; else a[name] = argv[++i];
  }
  return a;
}

/** The task ids of a CLI invocation. */
export function idsFor(a, split = loadSplit()) {
  if (a.sealed) {
    const f = readJson(a.freeze);
    if (f.kind !== 'appworld-sealed-freeze' || f.splitSha256 !== split.splitSha256) throw new Error('the freeze file does not freeze this split');
    const subset = a.subset ?? 'haiku';
    if (subset === 'haiku') return [...split.roles.sealed];
    if (subset === 'A-S') return sonnetSubset(split, f.sonnetIcc ?? null);
    if (subset === 'A-O') return [...split.sealed.opusAnchors];
    throw new Error(`unknown --subset ${subset} (haiku, A-S, A-O)`);
  }
  if (a.subset) throw new Error('--subset applies to sealed runs only');
  if (a.pilot) {
    const n = PILOT_SIZES[a.arm];
    if (!n) throw new Error('--pilot needs a model arm');
    return split.pilotOrder.slice(0, n);
  }
  const s = a.split ?? 'devTrain';
  if (s === 'devTrain') return [...split.roles.devTrain];
  if (s === 'devCheck') return [...split.roles.devCheck];
  if (s === 'dev') { if (!a.scripted) throw new Error('--split dev (train + dev) is for scripted policies; model arms use devTrain or devCheck'); return [...split.roles.devTrain, ...split.roles.devCheck]; }
  throw new Error(`unknown --split ${s} (devTrain, devCheck, dev; or --sealed --freeze)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  const num = (v, d) => (v === undefined ? d : Number(v));
  if (a.scripted && !SCRIPTED.includes(a.scripted)) throw new Error(`--scripted must be one of ${SCRIPTED.join(', ')}`);
  if (!a.scripted && !a.arm) throw new Error('--arm A-H|A-HN|A-S|A-O or --scripted null|docs|gold');
  const split = loadSplit();
  let ids = idsFor(a, split);
  // --limit takes the first N ids in the hashed run order, so a limited run is an unbiased subset (PLAN §5.2)
  if (a.limit) ids = runOrder(ids, split.salt).slice(0, Number(a.limit));
  const { summary, stopped, stopKind } = await runUnits({
    ids, armName: a.arm, policy: a.scripted, capUsd: num(a.cap, undefined), budgetUsd: num(a.budget, undefined), profile: a.profile ?? 'arm',
    repeat: num(a.repeat, 1), maxTurns: num(a['max-turns'], DEFAULTS.maxTurns), maxExecutes: num(a['max-executes'], DEFAULTS.maxExecutes), timeoutMin: num(a['timeout-min'], DEFAULTS.timeoutMin),
    concurrency: num(a.concurrency, DEFAULTS.concurrency), cardFile: a.card, runId: a['run-id'], outDir: a['no-copy'] ? null : a.out, keep: Boolean(a.keep), resume: Boolean(a.resume),
    sealed: Boolean(a.sealed), freeze: a.freeze, look: a.look ?? null, offline: Boolean(a.offline),
  });
  process.stdout.write(JSON.stringify(summary, null, 1) + '\n');
  if (stopped) process.exit(stopKind === 'cap' ? 4 : stopKind === 'meter' ? 5 : 3);
}
