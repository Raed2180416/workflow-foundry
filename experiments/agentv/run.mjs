// AGENTV-E8 runner (FIRST-CLASS-PROGRAMS §1.5; preregistration research/enterprise-20261014/AGENTV-E8-PREREG.md). It
// mirrors experiments/ebed/run-agent.mjs (same world generator call, reference pools, host options, grading summary,
// resumable on-disk journal, live files outside the repository) with the arm "agent-H + validator" (./arm.mjs). METERED:
// every session is one model call. The meter is the need router's §12 one cap meter (FIRST-CLASS-PROGRAMS §0.3): each
// session's bound is reserved before launch (up to `--concurrency` in flight), a session is charged max(reported,
// re-priced) when its cost was observed and its bound when it was not, and a start that does not fit under the cap is a
// host QuotaStop (the clock freezes; cases still open are censored, not failed). Every reservation and charge goes to
// spend.jsonl in the live directory, so a resumed run starts from what was already spent.
// Resumes: launch.jsonl stamps each invocation (settings, prereg sha, code sha); a resume with other settings is refused,
// and with other code unless --allow-changed-code. The first environment fault stops the run at its last commit (prereg
// §6: contaminated from that tick) with exit code 3 and no result.json; the same command resumes. wall.jsonl gets a
// heartbeat each minute so a killed invocation's wall time is kept. P1 is read from the committed host journal.
//   node experiments/agentv/run.mjs --model claude-haiku-5-5 --label agentv-e8-s12 --seeds 1232 --difficulties 2 \
//        --size 12 --tick-budget 0.4 --tick-minutes 6 --cap 5 --concurrency 4 --retries 1
// --dry (label must start with dry-): a scripted session instead of the model ($0, no model call) that checks a minimal
// draft through validate.mjs and writes it; results stay in the live directory. A wiring check of this file, not a row.
// --dry-env-fault-at N (dry only): the Nth scripted session ends in MODEL_RATE_LIMIT, to check the stop and the resume.
// Before any paid call it prints the preregistration's banner (MDE, prediction, what refutes) from the prereg file and
// refuses to start without it. Grading (the oracle and the reference pools) happens here, in the analyst process; the arm
// and its validator never import it.
import { writeFileSync, mkdirSync, existsSync, readFileSync, copyFileSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { createHost, QuotaStop, bindItem } from '../../beds/ebed/host/host.mjs';
import { resumeRun } from '../../beds/ebed/host/replay.mjs';
import { CONTROL_TYPES } from '../../beds/ebed/host/journal.mjs';
import { hashOf, sha256 } from '../../beds/lib/canonical.mjs';
import { summarize } from '../ebed/run-agent.mjs';
import { contractText } from '../ebed/build.mjs';
import { addUsage, cacheReadShare, zeroUsage } from '../memory/cache-share.mjs';
import { StageBudget, loadSpend, meterOf } from '../need-router/label-run.mjs';
import { messageUsageOf } from '../c0/construct.mjs';
import { sandboxAvailable } from '../../src/executors/claude-code.mjs';
import { agentVArm, ENV_FAULT_CODES, problemClass } from './arm.mjs';
import { buildMde, MIN_CASES_PER_BUILD } from '../lib/stats-builds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const PREREG_FILE = path.join(ROOT, 'research/enterprise-20261014/AGENTV-E8-PREREG.md');
export const LIVE_ROOT = '/var/tmp/foundry-work/agentv-arms';
export const AGENTH_JOURNAL = '/var/tmp/foundry-work/ebed-arms/agenth-e8-s12/journal-w1232-d2.jsonl';
/** The world agent-H s12 and the built workflows were graded on (run.start world digest of agenth-e8-s12). */
export const EXPECTED_WORLDS = Object.freeze({ '1232/2/12': '56971c9b3aaa4886229ac81fd55dcc4f9d41640a7be06fae2651ba0b087f1bff' });
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

/**
 * The banner block of the preregistration (```prereg-banner … ```) and the file's sha256; throws when either is missing.
 * Build-level inference (register B7; research/PREREGISTRATION-TEMPLATE.md §4): a banner whose `UNIT` line says `build`
 * must also give `K` (builds per arm), `CASES` (graded cases per build), `SD_RATES` (measured SD of build pass rates at
 * that case count) or `SIGMA_B` (between-build SD), and `STOP` (the K schedule and stop rule); the returned `buildLevel`
 * carries the MDE computed from them by experiments/lib/stats-builds.mjs, which the runner prints under the banner in
 * place of trusting a case-level McNemar MDE. A banner without a UNIT line is a legacy case-unit banner (AGENTV-E8):
 * accepted, and labelled so.
 */
export function preregBanner(file = PREREG_FILE) {
  if (!existsSync(file)) throw new Error(`no preregistration at ${file}: write it before any paid row (FIRST-CLASS-PROGRAMS §0.3)`);
  const text = readFileSync(file, 'utf8');
  const m = text.match(/```prereg-banner\n([\s\S]*?)\n```/);
  if (!m) throw new Error(`${file} has no prereg-banner block (MDE, prediction, refutation)`);
  for (const k of ['MDE', 'PREDICTION', 'REFUTED']) if (!m[1].includes(k)) throw new Error(`the prereg banner lacks ${k}`);
  return { text: m[1], sha256: sha256(text), ...bannerUnit(m[1]) };
}

/** The unit fields of a prereg banner (see preregBanner). */
export function bannerUnit(text) {
  const field = k => text.match(new RegExp(`^${k}[ \\t]+(.+)$`, 'm'))?.[1]?.trim() ?? null;
  const unit = field('UNIT');
  if (!unit) return { unit: 'case (legacy banner: no UNIT line; no build-level inference declared)', buildLevel: null };
  if (!/^build\b/i.test(unit)) return { unit, buildLevel: null };
  const K = parseInt(field('K') ?? '', 10), cases = parseInt(field('CASES') ?? '', 10), stop = field('STOP');
  const sdRates = parseFloat(field('SD_RATES') ?? ''), sigmaB = parseFloat(field('SIGMA_B') ?? '');
  const missing = [!(K >= 2) && 'K (an integer >= 2)', !(cases > 0) && 'CASES', !(Number.isFinite(sdRates) || Number.isFinite(sigmaB)) && 'SD_RATES or SIGMA_B', !stop && 'STOP'].filter(Boolean);
  if (missing.length) throw new Error(`the prereg banner declares UNIT build but lacks ${missing.join(', ')}`);
  const r = buildMde({ K, m: cases, ...(Number.isFinite(sdRates) ? { sdRates } : { sigmaB }) });
  const spread = Number.isFinite(sdRates) ? `sd of build rates ${sdRates}` : `between-build SD ${sigmaB} + binomial`;
  const line = r.resolvable
    ? `BUILD-LEVEL MDE (computed by experiments/lib/stats-builds.mjs, ${r.method}): ${(100 * r.mde).toFixed(1)} points at K = ${K} per arm, ${cases} cases per build, ${spread}, alpha 0.05, power 0.8${r.casesBelowMinimum ? ` (below the template's ${MIN_CASES_PER_BUILD} cases per build)` : ''}`
    : `BUILD-LEVEL: cannot resolve at K = ${K} per arm (the exact build-level permutation test never reaches p < 0.05); only intervals can be reported`;
  return { unit: 'build', buildLevel: { K, cases, ...(Number.isFinite(sdRates) ? { sdRates } : { sigmaB }), stop, mde: r.mde, resolvable: r.resolvable, line } };
}

/**
 * The §12 one cap meter over a spend ledger (PREREG-NEED-V1 §12 K5; label-run.mjs StageBudget and meterOf, imported
 * read-only). before() reserves a session's bound or throws QuotaStop; after() charges it. A resumed meter starts from
 * the ledger: settled charges, plus reservations never settled at their bound.
 */
export function makeMeter({ capUsd, stage, spendFile, priceTable }) {
  const prior = loadSpend([spendFile], stage);
  const budget = new StageBudget(capUsd, prior.totalUsd, { stage, files: [spendFile], attempts: prior.attempts });
  return {
    budget, prior,
    before({ model, bound, instance, now, attempt }) {
      const tok = budget.reserve(bound, { kind: 'session', key: `${instance}|${now}|a${attempt}`, model });
      if (!tok) throw new QuotaStop(`cap $${capUsd} reached on the §12 meter (spent $${budget.spentUsd.toFixed(4)}, in flight $${budget.reservedUsd.toFixed(2)}, next bound $${bound})`);
      return { ...tok, model };
    },
    after(tok, r) {
      const messageUsage = r?.transcript ? messageUsageOf(r.transcript) : null;
      const m = meterOf({ kind: 'session', priceTable, model: tok.model, bound: tok.bound,
        r: { costUsd: r?.costUsd ?? null, costUnknown: r?.costUsd === null || r?.costUsd === undefined, error: r?.error ?? null, meta: { messageUsage, streamUsage: r?.streamUsage ?? null } } });
      budget.settle(tok, m.charged, { reported: m.reported, measured: m.measured, imputed: m.imputed, unknown: m.unknown, error: typeof r?.error === 'string' ? r.error : r?.error?.code ?? null });
      return m.charged;
    },
  };
}

/** Completed-case verdicts of a run (pass, class, first divergence), for the paired comparison. */
export function perCase(world, rows, pools, label) {
  return e8.oracle(world, rows, { pools, arm: label }).cases.filter(c => c.pool === 'completed')
    .map(c => ({ case: c.case, class: c.class, pass: !!c.pass, armCensored: !!c.armCensored, divergence: c.firstDivergence ? `L${c.firstDivergence.layer}:${c.firstDivergence.code}` : null }));
}

/** Content rows of a host journal file (control rows dropped, chain fields stripped), as host.journal.contentRows(). */
export function journalContentRows(file) {
  return readJsonl(file).filter(r => !CONTROL_TYPES.has(r.type)).map(({ seq, prev, hash, ...c }) => c);
}

/** Exact two-sided McNemar p from the discordant counts b (A pass, B fail) and c (A fail, B pass). */
export function mcnemarExact(b, c) {
  const n = b + c;
  if (!n) return 1;
  let tail = 0, coef = 1;
  for (let i = 0; i <= Math.min(b, c); i++) { tail += coef; coef = coef * (n - i) / (i + 1); }
  return Math.min(1, 2 * tail / 2 ** n);
}

/** Paired table of two per-case lists on the same world (only cases completed in both). */
export function paired(a, b) {
  const byB = new Map(b.map(x => [x.case, x]));
  let both = 0, aOnly = 0, bOnly = 0, neither = 0;
  const flips = [];
  for (const x of a) {
    const y = byB.get(x.case);
    if (!y) continue;
    if (x.pass && y.pass) both++; else if (x.pass) { aOnly++; flips.push({ case: x.case, class: x.class, pass: 'A' }); }
    else if (y.pass) { bOnly++; flips.push({ case: x.case, class: x.class, pass: 'B' }); } else neither++;
  }
  return { n: both + aOnly + bOnly + neither, both, aOnly, bOnly, neither, mcnemarP: mcnemarExact(aOnly, bOnly), flips };
}

/** Totals over the validator journal (one row per tick). */
export function validatorStats(rows) {
  const s = { ticks: rows.length, sessions: 0, retries: 0, ticksRetried: 0, retryFixed: 0, finalInvalid: 0, finalMissing: 0, quotaStops: 0, envStops: 0,
    validateCalls: 0, ticksUsingValidator: 0, validateInvalid: 0, inSessionProblemClasses: {}, firstGateRefusalClasses: {}, envFaultSessions: 0, reportedUsd: 0, chargedUsd: 0, usage: zeroUsage() };
  for (const r of rows) {
    s.sessions += r.sessions.length; s.retries += r.retries; s.validateCalls += r.validateCalls; s.validateInvalid += r.validateInvalid;
    if (r.validateCalls) s.ticksUsingValidator += 1;
    if (r.retries) { s.ticksRetried += 1; if (r.final === 'valid') s.retryFixed += 1; }
    if (r.final === 'invalid' || r.final === 'not-json' || r.final === 'link') s.finalInvalid += 1;
    if (r.final === 'missing') s.finalMissing += 1;
    if (r.final === 'quota-stop') s.quotaStops += 1;
    if (r.final === 'env-stop') s.envStops += 1;
    for (const [k, v] of Object.entries(r.problemsSeen ?? {})) s.inSessionProblemClasses[k] = (s.inSessionProblemClasses[k] ?? 0) + v;
    const g1 = r.gates?.[0];
    if (g1 && g1.kind !== 'valid') for (const p of g1.problems) s.firstGateRefusalClasses[problemClass(p)] = (s.firstGateRefusalClasses[problemClass(p)] ?? 0) + 1;
    for (const x of r.sessions) {
      if (ENV_FAULT_CODES.has(x.error)) s.envFaultSessions += 1;
      s.reportedUsd += x.costUsd ?? 0; s.chargedUsd += x.charged ?? 0; addUsage(s.usage, x.tokens);
    }
  }
  s.cacheReadShare = cacheReadShare(s.usage);
  return s;
}

/**
 * The validator rows of the ticks a host journal committed. validator.jsonl gets a row for every tick attempted, and a
 * round discarded by a freeze (cap, environment fault) or a killed process is re-run on resume, so a tick can appear more
 * than once. Per world|instance|now: the last n rows, n = the committed case calls at that key (an instance can be called
 * in two rounds of one instant). Returns { rows, committedCalls, matched }.
 */
export function committedValidatorRows(valRows, contentRows, world) {
  const want = new Map();
  for (const r of contentRows) if (r.type === 'call' && r.kind === 'case') { const k = `${r.target}|${r.at}`; want.set(k, (want.get(k) ?? 0) + 1); }
  const byKey = new Map();
  for (const v of valRows) {
    if (world != null && v.world != null && v.world !== world) continue;
    const k = `${v.instance}|${v.now}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(v);
  }
  const rows = [];
  let committedCalls = 0;
  for (const [k, n] of want) { committedCalls += n; rows.push(...(byKey.get(k) ?? []).slice(-n)); }
  return { rows, committedCalls, matched: rows.length };
}

/** Arm errors of a host journal's content rows, by code (P1 reads `invalid-output`: refused outputs that reached the host). */
export function armErrorsOf(contentRows) {
  const byCode = {};
  for (const r of contentRows) if (r.type === 'arm.error' && r.instance !== undefined) byCode[r.code] = (byCode[r.code] ?? 0) + 1;
  return { byCode, invalidOutputs: byCode['invalid-output'] ?? 0 };
}

/** Wall time over every invocation of one world, from wall.jsonl (heartbeat rows every minute, so a killed invocation counts to its last beat). */
export function wallOf(rows, seed, d) {
  const byInv = new Map();
  rows.filter(x => x.seed === seed && x.d === d).forEach((x, i) => { const k = x.inv ?? `row-${i}`; byInv.set(k, Math.max(byInv.get(k) ?? 0, x.wallMs ?? 0)); });
  return { invocations: byInv.size, wallMs: [...byInv.values()].reduce((a, x) => a + x, 0) };
}

/** Code whose change mid-run would mix two arms in one row (a resume compares their sha256 with the first launch). */
export const STAMPED_CODE = Object.freeze(['experiments/agentv/arm.mjs', 'experiments/agentv/validator.mjs', 'experiments/agentv/run.mjs',
  'experiments/ebed/agent-arm.mjs', 'beds/ebed/host/output.mjs']);

/**
 * One launch row per invocation (launch.jsonl in the live directory). A resume must carry the first launch's settings
 * exactly (model, budgets, retries, concurrency, cap, world, prereg sha) and, unless allowChangedCode, the same code.
 */
export function checkLaunch(file, launch, { allowChangedCode = false } = {}) {
  const prior = readJsonl(file);
  if (prior.length) {
    const first = prior[0];
    if (JSON.stringify(first.settings) !== JSON.stringify(launch.settings)) throw new Error(`this run was launched with other settings: ${JSON.stringify(first.settings)} (now ${JSON.stringify(launch.settings)}); a resume must use the same command`);
    const changed = Object.keys(launch.code).filter(f => first.code?.[f] !== launch.code[f]);
    if (changed.length && !allowChangedCode) throw new Error(`code changed since the first launch: ${changed.join(', ')} (one row must not mix two arms; --allow-changed-code records the change and resumes)`);
    launch = { ...launch, changedCode: changed };
  }
  appendFileSync(file, JSON.stringify(launch) + '\n');
  return [...prior, launch];
}

/**
 * One world, resumable: a fresh host run, or (when its journal exists) resumeRun from the last commit, where the
 * committed prefix replays at $0 and live calls pick up at the interrupted wake-up. Returns { status, host, world, pools }.
 */
export async function runWorldV({ seed, d, size, liveDir, armFor, concurrency, callTimeoutMs, allowNewWorld = false }) {
  const w = e8.generateWorld({ seed, difficulty: d, mix: 'tail', ...(size ? { size } : {}) });
  const digest = hashOf(w), want = EXPECTED_WORLDS[`${seed}/${d}/${size ?? ''}`];
  if (want && digest !== want && !allowNewWorld) throw new Error(`world ${seed}/d${d}/size ${size} digest ${digest} is not the agent-H/workflow world ${want}: the paired cases would differ`);
  // The preregistration names one world (§3: "adding 1233 needs an amendment here first"); any other needs --allow-new-world.
  if (!want && !allowNewWorld) throw new Error(`world ${seed}/d${d}/size ${size ?? 'full'} is not in this preregistration (EXPECTED_WORLDS): amend it, then pass --allow-new-world`);
  const { pools } = await e8.referenceRuns(w);
  const workRoot = path.join(liveDir, `w${seed}-d${d}`);
  const journalFile = path.join(liveDir, `journal-w${seed}-d${d}.jsonl`), blobDir = path.join(liveDir, `blobs-w${seed}-d${d}`);
  const hostOpts = { item: e8.binding, world: w, arm: armFor(workRoot), concurrency, callTimeoutMs, journalFile, blobDir };
  let status, host, resumed = false;
  if (existsSync(journalFile)) { resumed = true; const r = await resumeRun(hostOpts); status = r.status; host = r.host; }
  else { host = createHost(hostOpts); status = (await host.run()).status; }
  return { status, host, world: w, digest, pools, resumed, journalFile };
}

/** --dry: a scripted session (no model, $0): it checks a minimal draft through validate.mjs, then writes it. */
export async function dryRunner({ workdir }) {
  const input = JSON.parse(readFileSync(path.join(workdir, 'task.json'), 'utf8'));
  const subject = input.events.find(e => typeof e.payload?.orderId === 'string')?.payload.orderId ?? input.carry?.subject ?? null;
  const out = { decisions: { subject }, effects: [], carry: { subject } };
  writeFileSync(path.join(workdir, 'draft.json'), JSON.stringify(out));
  const code = await new Promise(res => { const c = spawn(process.execPath, ['validate.mjs', 'draft.json'], { cwd: workdir, stdio: 'ignore' }); c.on('close', res); c.on('error', () => res(-1)); });
  if (code === 0) writeFileSync(path.join(workdir, 'output.json'), JSON.stringify(out));
  return { costUsd: 0, turns: 1, error: null, streamUsage: zeroUsage() };
}

/** --dry with --dry-env-fault-at N: the Nth scripted session ends in MODEL_RATE_LIMIT (a $0 check of the stop-and-resume path). */
export function dryRunnerWith({ envFaultAt = null } = {}) {
  let n = 0;
  return async opts => { n += 1; return n === envFaultAt ? { costUsd: 0, turns: 0, error: { code: 'MODEL_RATE_LIMIT' }, streamUsage: zeroUsage() } : dryRunner(opts); };
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const POLICY = JSON.parse(readFileSync(path.join(ROOT, 'policy', 'models.json'), 'utf8'));
  const STAGES = JSON.parse(readFileSync(path.join(ROOT, 'research/need-router-20261014/prereg/stages.json'), 'utf8'));
  const model = arg('--model', null);
  if (!POLICY.models.some(m => m.id === model)) throw new Error(`--model must be a policy model id (policy/models.json): ${model}`);
  if (!STAGES.priceTable?.models?.[model]) throw new Error(`no §12 price table entry for ${model} (research/need-router-20261014/prereg/stages.json)`);
  const label = arg('--label', null);
  if (!label || !/^[\w.-]+$/.test(label)) throw new Error('--label is required (letters, digits, . _ -)');
  const dry = process.argv.includes('--dry');
  if (dry !== label.startsWith('dry-')) throw new Error('--dry runs, and only they, carry a label starting with dry-');
  // A paid run with no sandbox would turn every tick into an arm error (and, before this check, a bound on the meter).
  if (!dry && !sandboxAvailable()) throw new Error('no executor sandbox (user/mount/pid namespaces): refusing to start a paid run');
  const preregFile = arg('--prereg', PREREG_FILE);
  const banner = preregBanner(preregFile);
  console.log(`AGENTV-E8 preregistration (sha256 ${banner.sha256.slice(0, 16)}…):\n${banner.text}\n${banner.buildLevel ? banner.buildLevel.line : `UNIT: ${banner.unit}`}\n`);
  const liveDir = path.join(LIVE_ROOT, label);
  const out = dry ? path.join(liveDir, 'result') : path.join(ROOT, 'research/enterprise-20261014/runs', label);
  if (existsSync(path.join(out, 'result.json'))) throw new Error(`${out}/result.json exists`);
  const [s0, s1] = arg('--seeds', '1232').split('-').map(Number);
  const seeds = Array.from({ length: (s1 ?? s0) - s0 + 1 }, (_, i) => s0 + i);
  const difficulties = arg('--difficulties', '2').split(',').map(Number);
  const size = arg('--size', null) === null ? undefined : Number(arg('--size'));
  const cap = Number(arg('--cap', '5')), tickBudget = Number(arg('--tick-budget', '0.4')), tickMinutes = Number(arg('--tick-minutes', '6'));
  const concurrency = Number(arg('--concurrency', '4')), retries = Number(arg('--retries', '1')), effort = arg('--effort', null);
  if (!(cap > 0 && tickBudget > 0 && tickMinutes > 0 && concurrency >= 1 && concurrency <= 4)) throw new Error('bad --cap/--tick-budget/--tick-minutes/--concurrency (concurrency 1..4, §12)');
  if (!(seeds.length && seeds.every(Number.isInteger) && difficulties.every(Number.isInteger) && (size === undefined || Number.isInteger(size)))) throw new Error('bad --seeds/--difficulties/--size');
  // Live files stay outside the repository while the run is in flight; they are copied in when it ends.
  mkdirSync(liveDir, { recursive: true });
  const liveTicks = path.join(liveDir, 'ticks.jsonl'), liveVal = path.join(liveDir, 'validator.jsonl'), spendFile = path.join(liveDir, 'spend.jsonl'), wallFile = path.join(liveDir, 'wall.jsonl');
  // A resume must be the same arm: same settings and prereg, same code (launch.jsonl keeps one row per invocation).
  const launches = checkLaunch(path.join(liveDir, 'launch.jsonl'), {
    at: new Date().toISOString(), pid: process.pid,
    settings: { label, model, effort, tickBudget, tickMinutes, retries, concurrency, cap, seeds, difficulties, size: size ?? null, dry, prereg: path.relative(ROOT, preregFile), preregSha256: banner.sha256 },
    code: Object.fromEntries(STAMPED_CODE.map(f => [f, sha256(readFileSync(path.join(ROOT, f), 'utf8'))])),
  }, { allowChangedCode: process.argv.includes('--allow-changed-code') });
  const meter = makeMeter({ capUsd: cap, stage: label, spendFile, priceTable: STAGES.priceTable });
  if (meter.prior.totalUsd) console.log(`  resuming: $${meter.prior.totalUsd.toFixed(4)} already on the meter (${meter.prior.openUsd ? `$${meter.prior.openUsd.toFixed(2)} of it unsettled reservations at their bound` : 'all settled'})`);
  const schemas = bindItem(e8.binding).schemas;
  // Both sessions of a retried tick must fit in one host call.
  const callTimeoutMs = ((1 + retries) * tickMinutes + 1) * 60_000;
  const rows = [], envStops = [];
  const envFaultAt = dry && arg('--dry-env-fault-at', null) !== null ? Number(arg('--dry-env-fault-at')) : null;
  const dryRun = dry ? dryRunnerWith({ envFaultAt }) : null;
  let stoppedOnEnvFault = false;
  for (const d of difficulties) for (const seed of seeds) {
    const armFor = workRoot => {
      const a = agentVArm({ id: label, model, workRoot, contract: contractText(), effort, budgetUsdPerTick: tickBudget, minutesPerTick: tickMinutes,
        journal: liveTicks, validatorJournal: liveVal, schemas, retries, meter, stopOnEnvFault: true, ...(dry ? { runner: dryRun } : {}) });
      return { ...a, async tick(input, ctx) { try { return await a.tick(input, ctx); } catch (e) { if (e?.envFault) envStops.push({ code: e.envFault, instance: input.instance, now: input.now }); throw e; } } };
    };
    const t = Date.now(), startedAt = new Date().toISOString(), inv = randomUUID();
    // Heartbeat: a background job limit kills this process without warning, so wall time is written every minute.
    const beat = status => appendFileSync(wallFile, JSON.stringify({ inv, seed, d, startedAt, at: new Date().toISOString(), wallMs: Date.now() - t, status }) + '\n');
    beat('started');
    const hb = setInterval(() => { try { beat('running'); } catch { /* next beat */ } }, 60_000);
    hb.unref();
    let r;
    try { r = await runWorldV({ seed, d, size, liveDir, armFor, concurrency, callTimeoutMs, allowNewWorld: process.argv.includes('--allow-new-world') }); }
    catch (e) { clearInterval(hb); beat('host-error'); rows.push({ seed, d, size: size ?? null, status: `host-error: ${String(e?.message ?? e).slice(0, 200)}`, wallMs: Date.now() - t }); console.log(`  d${d} seed ${seed}: ${rows.at(-1).status}`); continue; }
    clearInterval(hb);
    beat(r.status);
    if (r.status === 'frozen' && envStops.length) {
      // Contaminated from the first environment fault (prereg §6): the host froze at its last commit, the fault's round was
      // discarded. Nothing is graded and no result.json is written, so the same command resumes once the fault clears.
      stoppedOnEnvFault = true;
      writeFileSync(path.join(liveDir, 'result.partial.json'), JSON.stringify({ label, model, rows, envStops }, null, 1));
      console.log(`  d${d} seed ${seed}: stopped on an environment fault (${[...new Set(envStops.map(x => x.code))].join(', ')} at ${envStops[0].instance} ${envStops[0].now}); the journal ends at the last commit`);
      break;
    }
    const content = r.host.journal.contentRows();
    const s = summarize(r.world, content, r.pools, label);
    const cases = perCase(r.world, content, r.pools, label);
    const errs = armErrorsOf(content);
    const committed = committedValidatorRows(readJsonl(liveVal), content, r.world.publicId ?? r.world.id);
    const wall = wallOf(readJsonl(wallFile), seed, d);
    const row = { seed, d, size: size ?? null, worldDigest: r.digest, status: r.status, wallMs: Date.now() - t, wallAllInvocationsMs: wall.wallMs, invocations: wall.invocations, ...s,
      invalidOutputsAtHost: errs.invalidOutputs, armErrorsByCode: errs.byCode,
      validatorCommitted: { ...validatorStats(committed.rows), committedCalls: committed.committedCalls, matched: committed.matched }, cases };
    if (`${seed}/${d}/${size ?? ''}` in EXPECTED_WORLDS && existsSync(arg('--paired-with', AGENTH_JOURNAL))) {
      const hRows = journalContentRows(arg('--paired-with', AGENTH_JOURNAL));
      row.pairedVsAgentH = paired(cases, perCase(r.world, hRows, r.pools, 'agenth-e8-s12'));   // A = agent-H + V, B = agent-H
    }
    rows.push(row);
    console.log(`  d${d} seed ${seed}${size ? ` size ${size}` : ''}: ${r.status}; ${s.passed}/${s.completed} completed pass (${s.armCensored} open at freeze), critical ${s.critical}, arm errors ${s.armErrors} (${errs.invalidOutputs} invalid outputs), ${s.ticks} ticks, $${s.costUsd.toFixed(2)} reported`);
    if (row.pairedVsAgentH) console.log(`    paired vs agent-H: both ${row.pairedVsAgentH.both}, V only ${row.pairedVsAgentH.aOnly}, H only ${row.pairedVsAgentH.bOnly}, neither ${row.pairedVsAgentH.neither}; exact McNemar p ${row.pairedVsAgentH.mcnemarP.toFixed(3)}`);
    writeFileSync(path.join(liveDir, 'result.partial.json'), JSON.stringify({ label, model, rows }, null, 1));
    if (r.status === 'frozen') break;
  }
  const spend = loadSpend([spendFile], label);
  if (stoppedOnEnvFault) {
    console.log(`STOPPED on an environment fault: metered $${spend.totalUsd.toFixed(4)} of $${cap} so far (it stays on the meter). No result.json; re-run the same command to resume from the last commit.`);
    process.exitCode = 3;
    return;
  }
  const vstats = validatorStats(readJsonl(liveVal));
  if (vstats.envFaultSessions) console.log(`WARNING: ${vstats.envFaultSessions} session(s) ended in an environment fault (${[...ENV_FAULT_CODES].join(', ')}) in an earlier invocation; their rounds were discarded at the freeze and re-run.`);
  mkdirSync(out, { recursive: true });
  const invalidOutputsAtHost = rows.reduce((a, x) => a + (x.invalidOutputsAtHost ?? 0), 0);
  const result = { label, experiment: 'AGENTV-E8', arm: 'agent-H+V', ...(dry ? { dry: 'scripted sessions, no model: a wiring check, not a row' } : {}), prereg: { file: path.relative(ROOT, preregFile), sha256: banner.sha256 },
    item: e8.family.id, spec: e8.specE.sha256, model, effort, tickBudgetUsd: tickBudget, tickMinutes, retries, concurrency, callTimeoutMs, launches,
    meter: { capUsd: cap, totalUsd: spend.totalUsd, settledUsd: spend.settledUsd, unsettledAtBoundUsd: spend.openUsd, rule: 'PREREG-NEED-V1 §12 K5 (label-run.mjs StageBudget, meterOf)' },
    prediction: { P1invalidOutputsAtHost: invalidOutputsAtHost, P3meteredUsd: spend.totalUsd, source: 'P1 from the committed host journal (arm.error invalid-output); P2/P4 from rows[].cases and rows[].pairedVsAgentH' },
    validatorAllAttempts: { ...vstats, scope: 'every tick attempted, including rounds discarded by a freeze or a killed process (re-run on resume); rows[].validatorCommitted is the committed ticks only' },
    seeds, difficulties, size: size ?? null, rows,
    claimRow: { schema: 'claim-row/0 fields for back-fill (experiments/claims/ not built yet, SPINE-0)', program: 'F1', experiment: 'AGENTV-E8', arm: 'agent-H+V',
      bed: 'ebed-e8', origin: 'our generator', fidelityTier: null, evidence: 'development', K: 1,
      usd: { run: spend.totalUsd, build: 0, world: null, upkeep: 0, imputedInMeter: spend.entries.filter(e => e.settled).reduce((a, e) => a + (e.imputed ?? 0), 0), reservedUnsettled: spend.openUsd },
      timing: { wallMs: rows.reduce((a, x) => a + (x.wallAllInvocationsMs ?? x.wallMs ?? 0), 0), concurrency }, envFaults: vstats.envFaultSessions } };
  writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 1));
  for (const f of ['ticks.jsonl', 'validator.jsonl', 'spend.jsonl', 'wall.jsonl', 'launch.jsonl']) if (existsSync(path.join(liveDir, f))) copyFileSync(path.join(liveDir, f), path.join(out, f));
  console.log(`metered $${spend.totalUsd.toFixed(4)} of $${cap} (reported $${vstats.reportedUsd.toFixed(4)}); validator: ${vstats.validateCalls} calls in ${vstats.ticksUsingValidator}/${vstats.ticks} ticks attempted, ${vstats.ticksRetried} ticks retried (${vstats.retryFixed} fixed); ${invalidOutputsAtHost} invalid outputs reached the host (journal); prompt-cache read share ${vstats.cacheReadShare ?? '–'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
