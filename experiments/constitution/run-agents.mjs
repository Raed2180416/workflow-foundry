// OT-0 paid agent arms on the sized overlay world (research/org-20261021/PREREG-OT0.md, FROZEN at 27ff324; amended by
// research/org-20261021/PREREG-OT0-AMEND-1.md: environment faults stop the run):
//   A-F   a frontier agent alone, one fresh session per case-tick (experiments/ebed/agent-arm.mjs agentArm), with the
//         constitution in its prompt and contract (arms.mjs) and the registry in ctx.files: Sonnet 5.5, and Opus 5.5
//   A-HV  agent-H + validator (experiments/agentv/arm.mjs agentVArm, Haiku 5.5) with the same constitution inputs
// The world is E8 1232 d2 size 12 under the overlay (14 completed cases; one refund needs approval: o0012's EUR 437.93).
// METERED: every tick is a model session; a total cap stops the stream with a host QuotaStop (cases still open are
// censored). Grading ($0, analyst side): the E8 oracle, E8 + C2 overlay, the observer's C1-C3 and the auditor.
// ENVIRONMENT FAULTS (AMEND-1): a session that ends in a rate, usage or session limit, HTTP 429/529, overload, an
// unavailable model or no sandbox (envFaultOf) is not an outcome. The session runner raises EnvFaultStop (a host
// QuotaStop): the host freezes at its last commit and discards the fault's round, so the tick gets no call row, no
// arm.error and no carry.lost. The run writes faults.jsonl and no result.json and exits 3, and the same command resumes
// from the last commit (launch.jsonl refuses a resume with other settings or another runner).
//   node experiments/constitution/run-agents.mjs --arm A-F --model claude-sonnet-5-5 --label af-sonnet-s12-r1 --cap 20
//   node experiments/constitution/run-agents.mjs --arm A-F --model claude-opus-5-5 --label af-opus-s12-r1 --cap 45
//   node experiments/constitution/run-agents.mjs --arm A-HV --model claude-haiku-5-5 --label ahv-s12-r1 --cap 5
//   node experiments/constitution/run-agents.mjs --arm A-F --model claude-sonnet-5-5 --label dry-af --dry    ($0 wiring check)
//   ... --dry --dry-env-fault-at N   the Nth scripted session ends in MODEL_RATE_LIMIT once ($0 check of stop and resume)
// Exit codes: 0 graded (result.json written); 3 stopped on an environment fault (resume with the same command); 4 graded
// but contaminated by a late fault (a session faulted after the host had already timed its call out: re-run fresh).
import { writeFileSync, mkdirSync, existsSync, readFileSync, copyFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createHost, bindItem } from '../../beds/ebed/host/host.mjs';
import { resumeRun } from '../../beds/ebed/host/replay.mjs';
import { agentArm } from '../ebed/agent-arm.mjs';
import { agentVArm, EnvFaultStop, ENV_FAULT_CODES, PRELAUNCH_THROW_CODES } from '../agentv/arm.mjs';
import { contractText } from '../ebed/build.mjs';
import { capped } from '../ebed/run-agent.mjs';
import { runClaudeCode } from '../../src/executors/claude-code.mjs';
import { executorForModel } from '../../src/executors/openai-chat.mjs';
import { loadPolicy } from '../../src/models/policy.mjs';
import { baseWorld, overlayWorld, overlayBinding } from './overlay.mjs';
import { buildRegistry } from './registry.mjs';
import { withConstitutionFiles, constitutionRunner, contractWithConstitution } from './arms.mjs';
import { assessRun, ROOT } from './run.mjs';
import { preregCheck } from './freeze.mjs';

export const SIZED = Object.freeze({ seed: 1232, d: 2, size: 12 });
export const PAID_MODELS = Object.freeze({ 'A-F': ['claude-sonnet-5-5', 'claude-opus-5-5'], 'A-HV': ['claude-haiku-5-5'] });
export const LIVE_ROOT = '/var/tmp/foundry-work/ot0-arms', DRY_ROOT = '/var/tmp/foundry-work/ot0-dry';
export const EXIT = Object.freeze({ ok: 0, envFault: 3, lateFault: 4 });
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);
const usdOf = r => (r?.costUnknown ? (r.costUpperUsd ?? 0) : (r?.costUsd ?? 0));
const sha256 = text => createHash('sha256').update(text).digest('hex');

// --- environment faults (PREREG-OT0-AMEND-1 §4) ----------------------------------------------------------------------
/** Limit wording in an error end's stderr, message or result (claude-code.mjs LIMITED, widened: session and weekly limits, 429/529). */
export const LIMIT_TEXT = /rate.?limit|usage limit|session limit|weekly limit|hit your (?:usage |session |weekly )?limit|limit reached|too many requests|overloaded|\b(?:429|529)\b/i;
/** A CLI limit notice printed as the result of a session with no error code. Stricter: E8's own `rate-limited` effect status never matches. */
export const LIMIT_NOTICE = /usage limit reached|session limit reached|weekly limit reached|hit your (?:usage |session |weekly )?limit|limit reached\s*[·∙|]|API Error:?\s*(?:429|529)|rate_limit_error|overloaded_error/i;

/** The status of the stream's last API error event when nothing came after it (no assistant message): 429, 529, 'limit' or null. */
export function streamEndsInLimit(workdir) {
  const f = workdir ? path.join(workdir, '.executor-transcript.jsonl') : null;
  if (!f || !existsSync(f)) return null;
  let lastApi = null, lastAssistant = -1, i = 0;
  for (const e of readJsonl(f)) {
    i += 1;
    if (e?.type === 'assistant') lastAssistant = i;
    else if (e?.type === 'system' && /api_(?:error|retry)/.test(String(e.subtype ?? ''))) lastApi = { i, e };
  }
  if (!lastApi || lastApi.i < lastAssistant) return null;
  const s = Number(lastApi.e.status ?? lastApi.e.error_status ?? lastApi.e.api_error_status);
  if (s === 429 || s === 529) return s;
  const text = [lastApi.e.error, lastApi.e.detail, lastApi.e.message].map(x => (typeof x === 'string' ? x : JSON.stringify(x ?? ''))).join(' ');
  return LIMIT_TEXT.test(text) ? 'limit' : null;
}

/**
 * Whether a session's end is an environment fault: { code, by } or null. Faults: an environment code (MODEL_RATE_LIMIT,
 * MODEL_UNAVAILABLE, SANDBOX_UNAVAILABLE); any other error end except a budget stop whose text names a limit, 429/529 or
 * overload, or whose stream ends in a 429/529 API error; a session with no error code that printed a CLI limit notice as
 * its result and wrote no output.json. Anything else (a budget stop, a timeout, a missing or bad output) is the arm's.
 */
export function envFaultOf(r, { workdir = null } = {}) {
  const err = r?.error ?? null;
  const code = typeof err === 'string' ? err : (err?.code ?? null);
  if (code && ENV_FAULT_CODES.has(code)) return { code, by: `session error ${code}` };
  if (code && code !== 'EXECUTOR_BUDGET') {
    const text = [err?.stderr, err?.message, r?.result].filter(x => typeof x === 'string').join(' ');
    if (LIMIT_TEXT.test(text)) return { code: 'MODEL_RATE_LIMIT', by: `${code} with limit text` };
    const api = streamEndsInLimit(workdir);
    if (api) return { code: 'MODEL_RATE_LIMIT', by: `${code} after a ${api} API error at the end of the stream` };
    return null;
  }
  if (!code && typeof r?.result === 'string' && LIMIT_NOTICE.test(r.result) && !(workdir && existsSync(path.join(workdir, 'output.json')))) {
    return { code: 'MODEL_RATE_LIMIT', by: 'a CLI limit notice as the result, no output.json' };
  }
  return null;
}

const faultStop = (f, session) => Object.assign(new EnvFaultStop(f.code, f.by), { code: f.code, session: { by: f.by, ...session } });

/**
 * The session runner with the fault stop: a session that ends in an environment fault (or a runner that throws an
 * environment code) raises EnvFaultStop, a host QuotaStop, instead of returning. Its transcript is kept in faultDir.
 */
export const envFaultRunner = (run, { faultDir = null } = {}) => async opts => {
  let r;
  try { r = await run(opts); }
  catch (e) {
    if (e?.envFault) throw e;
    const code = typeof e?.code === 'string' && ENV_FAULT_CODES.has(e.code) ? e.code : LIMIT_TEXT.test(String(e?.message ?? '')) ? 'MODEL_RATE_LIMIT' : null;
    if (!code) throw e;
    const pre = PRELAUNCH_THROW_CODES.has(code);
    throw faultStop({ code, by: `the session runner threw (${String(e?.code ?? e?.name ?? 'error')})` },
      { costUsd: pre ? 0 : null, costUpperUsd: pre ? 0 : (opts.budgetUsd ?? null), turns: null, exitCode: null, detail: String(e?.message ?? e).slice(0, 300) });
  }
  const f = envFaultOf(r, { workdir: opts.workdir });
  if (!f) return r;
  const t = opts.workdir ? path.join(opts.workdir, '.executor-transcript.jsonl') : null;
  if (faultDir && t && existsSync(t)) {
    mkdirSync(faultDir, { recursive: true });
    copyFileSync(t, path.join(faultDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${path.basename(opts.workdir)}.transcript.jsonl`));
  }
  const known = typeof r?.costUsd === 'number' && Number.isFinite(r.costUsd);
  throw faultStop(f, { costUsd: known ? r.costUsd : null, costUpperUsd: known ? r.costUsd : (r?.costUpperUsd ?? opts.budgetUsd ?? null), turns: r?.turns ?? null,
    exitCode: r?.error?.exitCode ?? null, detail: String(r?.error?.stderr || r?.result || '').slice(-300) });
};

/**
 * The arm with the fault record: an EnvFaultStop from a tick records the faulted session's cost in the call (it reaches
 * the host's freeze record and the cap) and a row in faultLog, then propagates. A ctx that refuses the cost means the
 * host had already settled the call (a timeout): the row is marked late (the tick was scored; AMEND-1 §4).
 */
export function faultAware(arm, { model, faultLog = null, onFault = null } = {}) {
  return {
    ...arm,
    id: arm.id,
    async tick(input, ctx) {
      try { return await arm.tick(input, ctx); }
      catch (e) {
        if (!e?.envFault) throw e;
        const s = e.session ?? {};
        const cost = { source: 'executor:claude-code', model, costUsd: s.costUsd ?? null, costUnknown: s.costUsd === null || s.costUsd === undefined,
          costUpperUsd: s.costUpperUsd ?? null, turns: s.turns ?? null, envFault: e.envFault };
        let late = false;
        try { ctx.recordCost(cost); } catch { late = true; }
        const row = { at: new Date().toISOString(), instance: input.instance, now: input.now, events: input.events?.length ?? 0, code: e.envFault, by: s.by ?? null,
          ...cost, exitCode: s.exitCode ?? null, detail: s.detail ?? null, late };
        if (faultLog) appendFileSync(faultLog, JSON.stringify(row) + '\n');
        onFault?.(row);
        throw e;
      }
    },
  };
}

// --- the arms ----------------------------------------------------------------------------------------------------------
/** The $0 scripted session for --dry: it writes a minimal valid output (closes the instance), proving the wiring only. */
export const dryRunner = async ({ workdir, prompt }) => {
  if (!/Hollin Retail B\.V\. runs this order process under a constitution/.test(prompt)) throw new Error('dry: the constitution is not in the prompt');
  if (!existsSync(path.join(workdir, 'files/constitution/log.json'))) throw new Error('dry: the registry is not in the files');
  if (!readFileSync(path.join(workdir, 'CONTRACT.md'), 'utf8').includes('runs this order process under a constitution')) throw new Error('dry: the constitution is not in CONTRACT.md');
  writeFileSync(path.join(workdir, 'output.json'), JSON.stringify({ decisions: { subject: null, constitution: { pins: {} } }, carry: null, close: true }));
  return { costUsd: 0, turns: 0, error: null };
};

/**
 * --dry-env-fault-at N: the Nth scripted session of an invocation ends in MODEL_RATE_LIMIT (as the 2026-10-21 sessions
 * did: $0, one turn, exit 1, empty stderr). With `marker`, it fires once per run (the marker records it): the limit has
 * "reset" for the resumed invocation.
 */
export function dryRunnerWith({ envFaultAt = null, marker = null } = {}) {
  let n = 0;
  return async opts => {
    n += 1;
    if (envFaultAt !== null && n === envFaultAt && !(marker && existsSync(marker))) {
      if (marker) writeFileSync(marker, new Date().toISOString() + '\n');
      return { costUsd: 0, turns: 1, error: { code: 'MODEL_RATE_LIMIT', exitCode: 1, stderr: '' }, result: null };
    }
    return dryRunner(opts);
  };
}

/** Build the arm (no host). `runner` (in-process, dry only) replaces the scripted or real session executor. */
export function makeAgentArm({ arm, model, label, workRoot, journal, dry = false, tickBudget, tickMinutes, registry, runner = null, faultLog = null, faultDir = null, onFault = null }) {
  const contract = contractWithConstitution(contractText());
  const base = runner ?? (dry ? dryRunner : arm === 'A-HV' ? runClaudeCode : executorForModel(loadPolicy().policy, model).run);
  const session = envFaultRunner(constitutionRunner(base), { faultDir });
  const inner = arm === 'A-HV'
    ? agentVArm({ id: label, model, workRoot, contract, budgetUsdPerTick: tickBudget, minutesPerTick: tickMinutes, journal, schemas: bindItem(overlayBinding).schemas, retries: 1, runner: session })
    : agentArm({ id: label, model, workRoot, contract, budgetUsdPerTick: tickBudget, minutesPerTick: tickMinutes, journal, runner: session });
  return withConstitutionFiles(faultAware(inner, { model, faultLog, onFault }), registry);
}

// --- spend, launches -----------------------------------------------------------------------------------------------------
/**
 * What earlier invocations spent: the larger of (ticks.jsonl + faults.jsonl) and the host journal's committed call costs
 * plus its freeze records' discarded calls. Each is a lower bound: the journal loses a killed process's open round, and
 * ticks.jsonl misses a retried A-HV session's first attempt.
 */
export function priorSpend(liveDir) {
  const ticksUsd = readJsonl(path.join(liveDir, 'ticks.jsonl')).reduce((a, r) => a + usdOf(r), 0);
  const faultsUsd = readJsonl(path.join(liveDir, 'faults.jsonl')).reduce((a, r) => a + usdOf(r), 0);
  let journalUsd = 0;
  for (const r of readJsonl(path.join(liveDir, 'journal.jsonl'))) {
    if (r.type === 'call') journalUsd += (r.costs ?? []).reduce((a, c) => a + usdOf(c), 0);
    else if (r.type === 'clock.freeze') journalUsd += (r.discardedCalls ?? []).flatMap(c => c.costs ?? []).reduce((a, c) => a + usdOf(c), 0);
  }
  return { usd: Math.max(ticksUsd + faultsUsd, journalUsd), ticksUsd, faultsUsd, journalUsd };
}

/** Code whose change mid-run would mix two runners in one row. */
export const STAMPED_CODE = Object.freeze(['experiments/constitution/run-agents.mjs', 'experiments/constitution/freeze.mjs', 'experiments/ebed/agent-arm.mjs', 'experiments/agentv/arm.mjs']);

/** One row per invocation in launch.jsonl. A resume must carry the first launch's settings and code exactly. */
export function checkLaunch(file, launch) {
  const prior = readJsonl(file);
  if (prior.length) {
    const first = prior[0];
    if (JSON.stringify(first.settings) !== JSON.stringify(launch.settings)) throw new Error(`this run was launched with other settings: ${JSON.stringify(first.settings)} (now ${JSON.stringify(launch.settings)}); a resume must use the same command`);
    const changed = Object.keys(launch.code).filter(f => first.code?.[f] !== launch.code[f]);
    if (changed.length) throw new Error(`code changed since the first launch: ${changed.join(', ')} (one row must not mix two runners; start a new label)`);
  }
  appendFileSync(file, JSON.stringify(launch) + '\n');
  return [...prior, launch];
}

// --- one run -------------------------------------------------------------------------------------------------------------
/**
 * Run (or resume) one arm. Returns { exitCode, status, result?, faults, liveDir, outDir }. `runner`, `liveRoot` and
 * `outRoot` are for in-process tests and are accepted only with dry (a paid run uses the policy's executor and the
 * fixed directories).
 */
export async function runAgents({ arm, model, label, cap = null, dry = false, tickBudget = null, tickMinutes = 8, envFaultAt = null, runner = null, liveRoot = null, outRoot = null, log = console.log }) {
  if (!PAID_MODELS[arm]) throw new Error(`--arm must be ${Object.keys(PAID_MODELS).join(' or ')}`);
  if (!PAID_MODELS[arm].includes(model)) throw new Error(`--model for ${arm} must be one of ${PAID_MODELS[arm].join(', ')} (policy/models.json ids)`);
  if (!label) throw new Error('--label is required');
  if (dry && !label.startsWith('dry-')) throw new Error('a --dry label must start with dry-');
  if (!dry && (runner || liveRoot || outRoot || envFaultAt !== null)) throw new Error('a scripted runner, other directories and --dry-env-fault-at are for --dry only');
  cap = Number(cap ?? (dry ? 0 : NaN));
  if (!dry && !(cap > 0 && cap <= 50)) throw new Error('--cap (USD, at most 50 per arm) is required for a paid run');
  const prereg = dry ? null : preregCheck();            // a paid row needs the frozen PREREG-OT0.md (and its adopted amendments) with matching file hashes
  tickBudget = Number(tickBudget ?? (arm === 'A-HV' ? 0.4 : 1)); tickMinutes = Number(tickMinutes);
  const liveDir = path.join(liveRoot ?? (dry ? DRY_ROOT : LIVE_ROOT), label);
  const outDir = dry ? liveDir : path.join(outRoot ?? path.join(ROOT, 'research/org-20261021/runs'), label);
  if (existsSync(path.join(outDir, 'result.json'))) throw new Error(`${outDir}/result.json exists`);
  mkdirSync(liveDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
  const F = { ticks: path.join(liveDir, 'ticks.jsonl'), faults: path.join(liveDir, 'faults.jsonl'), launch: path.join(liveDir, 'launch.jsonl'),
    journal: path.join(liveDir, 'journal.jsonl'), blobs: path.join(liveDir, 'blobs'), faultDir: path.join(liveDir, 'faults'), marker: path.join(liveDir, 'dry-env-fault.fired') };
  const launches = checkLaunch(F.launch, {
    at: new Date().toISOString(), pid: process.pid,
    settings: { arm, model, label, cap, tickBudget, tickMinutes, dry, envFaultAt, prereg: prereg?.sha256 ?? null, amendments: (prereg?.amendments ?? []).map(a => a.sha256) },
    code: Object.fromEntries(STAMPED_CODE.map(f => [f, sha256(readFileSync(path.join(ROOT, f)))])),
  });
  const registry = buildRegistry();
  const W = overlayWorld(baseWorld(SIZED), { registry });
  const prior = priorSpend(liveDir);
  const spent = { usd: prior.usd };
  if (launches.length > 1) log(`${label}: resuming (invocation ${launches.length}); $${prior.usd.toFixed(4)} already spent`);
  const faults = [];
  const session = runner ?? (dry ? dryRunnerWith({ envFaultAt, marker: F.marker }) : null);
  const inner = makeAgentArm({ arm, model, label, workRoot: path.join(liveDir, 'work'), journal: F.ticks, dry, tickBudget, tickMinutes, registry, runner: session,
    faultLog: F.faults, faultDir: F.faultDir, onFault: row => faults.push(row) });
  const a = dry ? inner : capped(inner, cap, spent);
  const hostOpts = { item: overlayBinding, world: W, arm: a, concurrency: 4, callTimeoutMs: (tickMinutes + 1) * 60_000, journalFile: F.journal, blobDir: F.blobs };
  const t = Date.now();
  let status, host;
  try {
    if (existsSync(F.journal)) { const r = await resumeRun(hostOpts); status = r.status; host = r.host; }
    else { host = createHost(hostOpts); status = (await host.run()).status; }
  } catch (e) { status = `host-error: ${String(e?.message ?? e).slice(0, 200)}`; }
  if (!host) throw new Error(status);
  const keep = () => { if (!dry) for (const f of [F.ticks, F.faults, F.launch]) if (existsSync(f)) copyFileSync(f, path.join(outDir, path.basename(f))); };
  const stopping = faults.filter(f => !f.late);
  if (status === 'frozen' && stopping.length) {
    // AMEND-1: the fault's round was discarded at the freeze; nothing is graded and no result.json is written.
    keep();
    const f = stopping[0];
    log(`${label}: STOPPED on an environment fault (${[...new Set(stopping.map(x => x.code))].join(', ')} at ${f.instance} ${f.now}; ${stopping.length} session(s)); `
      + `the journal ends at its last commit; $${spent.usd.toFixed(4)} spent so far. No result.json: re-run the same command to resume.`);
    return { exitCode: EXIT.envFault, status, faults, liveDir, outDir };
  }
  const run = { world: W, rows: host.journal.contentRows(), full: host.journal.rows.map(r => ({ ...r })), status, port: null };
  const assessed = await assessRun({ spec: SIZED, arm, run, registry, workflowHash: null });
  const costs = run.rows.filter(r => r.type === 'call').flatMap(r => r.costs ?? []);
  const allFaults = readJsonl(F.faults), late = allFaults.filter(f => f.late);
  // A fault in a call the host had already settled (or, defensively, any fault on a run that did not freeze) was scored.
  const contaminated = late.length || (faults.length && status !== 'frozen') ? { from: (late[0] ?? faults[0]), reason: 'an environment fault in a call the host had already settled (scored as an outcome): re-run fresh under a new label' } : null;
  const freezes = run.full.filter(r => r.type === 'clock.freeze'), resumes = run.full.filter(r => r.type === 'run.resume');
  const result = { label, arm, model, dry, prereg, capUsd: cap, spentUsd: spent.usd, costUsd: costs.reduce((s, c) => s + (c.costUsd ?? 0), 0), costUnknown: costs.filter(c => c.costUnknown).length,
    discardedAtFreezeUsd: freezes.flatMap(r => r.discardedCalls ?? []).flatMap(c => c.costs ?? []).reduce((s, c) => s + usdOf(c), 0),
    envFaults: { sessions: allFaults.length, costUsd: allFaults.reduce((s, r) => s + usdOf(r), 0), late: late.length, first: allFaults[0] ?? null, freezes: freezes.length, resumes: resumes.length },
    contaminated, invocations: launches.length, launches,
    tickBudgetUsd: tickBudget, tickMinutes, wallMs: Date.now() - t, world: SIZED, ...assessed };
  writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 1));
  keep();
  log(`${label}: ${status}; E8 ${assessed.e8.passed}/${assessed.e8.completed}, +C2 ${assessed.overlay.passed}/${assessed.overlay.completed}; C1 ${JSON.stringify(assessed.observer.C1)} C2 ${JSON.stringify(assessed.observer.C2)} C3 ${JSON.stringify(assessed.observer.C3)}; `
    + `$${result.costUsd.toFixed(2)} committed, $${spent.usd.toFixed(2)} spent; ${allFaults.length} environment-fault session(s) over ${launches.length} invocation(s)${contaminated ? '; CONTAMINATED (late fault)' : ''}`);
  return { exitCode: contaminated ? EXIT.lateFault : EXIT.ok, status, result, faults, liveDir, outDir };
}

async function main() {
  const dry = process.argv.includes('--dry');
  const r = await runAgents({ arm: arg('--arm', null), model: arg('--model', null), label: arg('--label', null), cap: arg('--cap', null), dry,
    tickBudget: arg('--tick-budget', null), tickMinutes: arg('--tick-minutes', '8'), envFaultAt: arg('--dry-env-fault-at', null) === null ? null : Number(arg('--dry-env-fault-at')) });
  process.exitCode = r.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
