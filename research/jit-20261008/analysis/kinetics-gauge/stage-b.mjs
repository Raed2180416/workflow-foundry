// Kinetics comparator gauge, Stage B driver (BLOCKER-SYNTHESIS row 2; README "What Stage B must add").
//
// For each kinetics dev seed (201-224, difficulty as experiments/jit/configs/dev-kinetics-1.json: d4 for 201-216, d5 for
// 217-224) it runs N independent sandboxed agent interpretations of the task through the JIT engine's interpret() (the
// same call the stream makes: B0 instructions, answer.json contract, bed outputSchema), each in its own workdir, and
// scores each answer with the bed oracle exactly as the stream does (experiments/lib/beds.mjs score()).
//
//   node --max-old-space-size=1024 stage-b.mjs [--seeds 201-224] [--n 2] [--cap 0.45] [--spend-stop 5]
//        [--model claude-haiku-5-5] [--out DIR] [--work DIR] [--concurrency 2] [--minutes 15] [--max-env-faults 3]
//        [--dry-run] [--stub [--stub-wrong-every 7]]
//
// Writes under --out (default out/stage-b/, or out/stage-b-stub/ with --stub):
//   run.json         mode (live | stub), model, caps; a restart must match mode and model
//   sessions.jsonl   one row per finished session (appended); a restart skips (seed, session) pairs already here
//   ledger.jsonl     one row per attempt, faulted ones included: booked cost, actual cost estimate (the spend stop's input)
//   faults.jsonl     environment-fault attempts (ENV_FAULTS, as the stream): not outcomes; retried once inline, and a
//                    restart retries them again
//   traces/s<seed>-k<session>-a<attempt>.json  a copy of each attempt's trace.json (answer, scripts, commands, usage)
// Session workdirs (trace.json, the CLI transcript, the agent's files) go under --work: by default
// /var/tmp/foundry-work/kinetics-stage-b/<hash of --out>/ for live runs (WORK_ROOT of src/executors/claude-code.mjs, where
// the sandbox expects executor workdirs; on disk, never auto-cleaned) and <out>/sessions/ for stub runs.
//
// Spend: per-session cap --cap (the CLI's --max-budget-usd); --spend-stop on the ACTUAL ledger: no session starts once the
// ledger has reached it, so the worst-case total is spend-stop + concurrency x cap. "Actual" = the CLI-reported cost; for
// a cost-unknown session it is $0 when the stream shows zero tokens (the CLI never reached the API, as in the laptop
// smoke's root-check failure, which the harness books at the full cap) and the full cap otherwise.
//
// --stub replaces interpret() with a test interpreter (the bed's referenceSolve answer, deterministically perturbed, and a
// deliberately wrong answer every k-th session; fake cost $0.01). It exists only to test this driver and the analysis;
// its rows carry stub: true and it refuses to write into a directory holding live rows (and vice versa).
//
// Owner rules: dev seeds 201-224 only (refused otherwise; the seed ledger is checked as the stream checks it), no sealed
// beds, the model id must be listed in policy/models.json under the claude-cli provider, the token comes from the
// environment (CLAUDE_CODE_OAUTH_TOKEN, checked for presence only, never read or printed here).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '../../../..');
const imp = rel => import(pathToFileURL(path.join(REPO, rel)).href);

export const FAMILY = 'kinetics';
export const CONFIG_FILE = path.join(REPO, 'experiments/jit/configs/dev-kinetics-1.json');
export const DEFAULTS = Object.freeze({ seeds: '201-224', n: 2, cap: 0.45, spendStop: 5, model: 'claude-haiku-5-5', concurrency: 2, minutes: null, maxEnvFaults: 3, stubWrongEvery: 7 });
export const WORK_ROOT = '/var/tmp/foundry-work';       // = src/executors/claude-code.mjs WORK_ROOT (not imported: stub runs must not load the executor)
export const MAX_CONCURRENCY = 2;            // laptop: 14 GB RAM and a GPU job running
export const PRIOR_USD_PER_SESSION = 0.088;   // FRONTIER-GAPS §0: kinetics Haiku agent stream, $2.10 for 24 tasks (before the 2026-10-08 CLI flags)

// ---------------------------------------------------------------- arguments
export function parseSeeds(spec) {
  const out = [];
  for (const part of String(spec).split(',').map(s => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`--seeds: cannot read ${part}`);
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    if (b < a) throw new Error(`--seeds: empty range ${part}`);
    for (let s = a; s <= b; s++) out.push(s);
  }
  return [...new Set(out)];
}

export function parseArgs(argv) {
  const o = { ...DEFAULTS, stub: false, dryRun: false, out: null, work: null };
  const num = (k, v) => { const x = Number(v); if (!Number.isFinite(x)) throw new Error(`${k} needs a number`); return x; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--seeds') o.seeds = v();
    else if (a === '--n') o.n = num(a, v());
    else if (a === '--cap') o.cap = num(a, v());
    else if (a === '--spend-stop') o.spendStop = num(a, v());
    else if (a === '--model') o.model = v();
    else if (a === '--out') o.out = path.resolve(v());
    else if (a === '--work') o.work = path.resolve(v());
    else if (a === '--concurrency') o.concurrency = num(a, v());
    else if (a === '--minutes') o.minutes = num(a, v());
    else if (a === '--max-env-faults') o.maxEnvFaults = num(a, v());
    else if (a === '--stub-wrong-every') o.stubWrongEvery = num(a, v());
    else if (a === '--stub') o.stub = true;
    else if (a === '--dry-run') o.dryRun = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (!Number.isInteger(o.n) || o.n < 1 || o.n > 8) throw new Error('--n must be an integer 1..8');
  if (!(o.cap > 0 && o.cap <= 2)) throw new Error('--cap must be in (0, 2] dollars (the dev config agentBudgetUsd is 2)');
  if (!(o.spendStop > 0)) throw new Error('--spend-stop must be > 0');
  if (!Number.isInteger(o.concurrency) || o.concurrency < 1) throw new Error('--concurrency must be a positive integer');
  o.concurrency = Math.min(o.concurrency, MAX_CONCURRENCY);
  if (!Number.isInteger(o.stubWrongEvery) || o.stubWrongEvery < 2) throw new Error('--stub-wrong-every must be an integer >= 2');
  o.out ??= path.join(here, 'out', o.stub ? 'stage-b-stub' : 'stage-b');
  o.work ??= o.stub ? path.join(o.out, 'sessions') : path.join(WORK_ROOT, 'kinetics-stage-b', createHash('sha256').update(o.out).digest('hex').slice(0, 10));
  return o;
}

// ---------------------------------------------------------------- plan (mirrors the stream's task construction)
export function devConfig(file = CONFIG_FILE) {
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  if (cfg.familyId !== FAMILY || cfg.split !== 'dev') throw new Error(`${file} is not the kinetics dev config`);
  const diffOf = new Map();
  for (const seg of cfg.segments) for (const s of seg.seeds) diffOf.set(Number(s), Number(seg.difficulty ?? 3));
  return { cfg, diffOf };
}

export function checkModel(model) {
  const policy = JSON.parse(readFileSync(path.join(REPO, 'policy/models.json'), 'utf8'));
  const m = policy.models.find(x => x.id === model);
  if (!m) throw new Error(`model ${model} is not listed in policy/models.json`);
  if (m.provider !== 'claude-cli') throw new Error(`model ${model} is on provider ${m.provider}; interpret() needs a claude-cli model`);
  return { id: m.id, class: m.class, provider: m.provider, policyVersion: policy.policyVersion };
}

// Tasks exactly as stream.mjs builds them: per config segment, makeTasks(familyId, { split, seeds, difficulty }), which
// gives taskKey `kinetics:dev:d<d>:s<seed>` and taskHash sha256(canonical(task)).
export async function buildPlan(opts) {
  const { cfg, diffOf } = devConfig();
  const seeds = parseSeeds(opts.seeds);
  const bad = seeds.filter(s => !diffOf.has(s) || s < 201 || s > 224);
  if (bad.length) throw new Error(`seed guard: Stage B uses the kinetics dev seeds of ${path.basename(CONFIG_FILE)} (201-224) only; refused ${bad.join(',')}`);
  const { assertSeedsAllowed } = await imp('experiments/jit/seeds.mjs');
  assertSeedsAllowed({ bed: FAMILY, split: cfg.split, seeds, purpose: cfg.seedPurpose ?? 'jit-dev' });
  const { makeTasks } = await imp('experiments/lib/beds.mjs');
  const tasks = [];
  for (const seg of cfg.segments) {
    const segSeeds = seg.seeds.map(Number).filter(s => seeds.includes(s));
    if (segSeeds.length) tasks.push(...await makeTasks(FAMILY, { split: cfg.split, seeds: segSeeds, difficulty: Number(seg.difficulty ?? 3) }));
  }
  tasks.sort((a, b) => a.task.seed - b.task.seed);
  // Sessions of one seed are adjacent, so a spend stop leaves complete pairs for a prefix of the seeds.
  const jobs = [];
  for (const t of tasks) for (let k = 0; k < opts.n; k++) jobs.push({ ord: jobs.length, seed: t.task.seed, difficulty: t.task.difficulty, session: k, key: `${t.task.seed}:${k}`, t });
  return { cfg, tasks, jobs, timeoutMs: (opts.minutes ?? cfg.agentMinutes ?? 15) * 60 * 1000, effort: cfg.agentEffort ?? null };
}

// ---------------------------------------------------------------- cost
const tokensOf = u => (u ? Object.values(u).reduce((s, x) => s + (Number(x) || 0), 0) : null);
export function actualCost(trace, cap) {
  if (!trace.costUnknown) return { actualUsd: Number(trace.costUsd) || 0, actualBasis: 'reported' };
  const tok = tokensOf(trace.streamUsage);
  if (tok === 0) return { actualUsd: 0, actualBasis: 'unknown-zero-tokens' };
  return { actualUsd: cap, actualBasis: 'unknown-charged-at-cap' };
}

// ---------------------------------------------------------------- stub interpreter (driver tests only)
const h01 = s => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 12), 16) / 2 ** 48;
export const STUB_WRONG = ['near-miss:km+12%-one-condition', 'set:one-exclusion-dropped', 'scale:vmax-x0.5'];
export function stubMode(job, wrongEvery) {
  if ((job.ord + 1) % wrongEvery === 0) return STUB_WRONG[Math.floor(job.ord / wrongEvery) % STUB_WRONG.length];
  const u = h01(`mode:${job.seed}:${job.session}`);
  return u < 0.15 ? 'estimator:hanes' : u < 0.3 ? 'round:3sf' : u < 0.4 ? 'estimator:means' : 'noise:0.8%';
}
export async function stubInterpret(args, job, { wrongEvery = DEFAULTS.stubWrongEvery } = {}) {
  const { referenceSolve, _internals, validateOutput } = await imp('beds/kinetics/index.mjs');
  const { refitAnswer } = await import('./refit.mjs');
  const { fitHanes, fitMeans, sigfig } = await import('./fitters.mjs');
  const { task, workdir, traceId, budgetUsd, model } = args;
  const ref = referenceSolve(task), mode = stubMode(job, wrongEvery);
  let ans = structuredClone(ref);
  const { world, shown } = _internals(task);
  if (mode === 'estimator:hanes') ans = refitAnswer(world, shown, ref.excluded_samples, fitHanes);
  else if (mode === 'estimator:means') ans = refitAnswer(world, shown, ref.excluded_samples, fitMeans);
  else if (mode === 'round:3sf') ans.conditions = ans.conditions.map(c => ({ ...c, vmax: sigfig(c.vmax, 3), km: sigfig(c.km, 3) }));
  else if (mode === 'noise:0.8%') ans.conditions = ans.conditions.map(c => ({ ...c,
    vmax: sigfig(c.vmax * (1 + 0.016 * (h01(`v:${job.seed}:${job.session}:${c.condition_id}`) - 0.5)), 6),
    km: sigfig(c.km * (1 + 0.016 * (h01(`k:${job.seed}:${job.session}:${c.condition_id}`) - 0.5)), 6) }));
  else if (mode === 'near-miss:km+12%-one-condition') ans.conditions = ans.conditions.map((c, i) => (i === 0 ? { ...c, km: c.km * 1.12 } : c));
  else if (mode === 'set:one-exclusion-dropped') ans.excluded_samples = ans.excluded_samples.slice(1);
  else if (mode === 'scale:vmax-x0.5') ans.conditions = ans.conditions.map(c => ({ ...c, vmax: c.vmax * 0.5 }));
  const errs = validateOutput(ans);
  const trace = { traceId, stub: true, stubMode: mode, seed: task.seed, difficulty: task.difficulty, familyId: FAMILY, model, budgetUsd,
    answer: ans, answerValid: !errs.length, answerErrors: errs.length ? errs : null, costUsd: 0.01, costUnknown: false, latencyMs: 5, error: null,
    scripts: [], commands: [], turns: 0, tools: 0, nestedModelAttempts: 0, hiddenPathAttempts: 0, outsidePaths: [],
    streamUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, workdir, createdAt: new Date().toISOString() };
  writeFileSync(path.join(workdir, 'answer.json'), JSON.stringify(ans, null, 1));
  writeFileSync(path.join(workdir, 'trace.json'), JSON.stringify(trace, null, 1));
  return trace;
}

// ---------------------------------------------------------------- run state
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
export function openRun(out, meta, work) {
  mkdirSync(out, { recursive: true });
  const p = { run: path.join(out, 'run.json'), sessions: path.join(out, 'sessions.jsonl'), ledger: path.join(out, 'ledger.jsonl'), faults: path.join(out, 'faults.jsonl'), traces: path.join(out, 'traces'), work };
  mkdirSync(p.traces, { recursive: true });
  if (existsSync(p.run)) {
    const prev = JSON.parse(readFileSync(p.run, 'utf8'));
    if (prev.mode !== meta.mode) throw new Error(`${out} holds a ${prev.mode} run; refusing to add ${meta.mode} sessions (use another --out)`);
    if (prev.model !== meta.model) throw new Error(`${out} was run with ${prev.model}; refusing ${meta.model} (use another --out)`);
  } else writeFileSync(p.run, JSON.stringify({ ...meta, created: new Date().toISOString() }, null, 1) + '\n');
  if (meta.mode === 'stub') writeFileSync(path.join(out, 'STUB-DATA-NOT-LIVE.txt'), 'Every row in this directory comes from stage-b.mjs --stub (a test interpreter built from the bed reference solver). It is not agent data.\n');
  const sessions = readJsonl(p.sessions), ledger = readJsonl(p.ledger);
  for (const r of sessions) if ((r.stub === true) !== (meta.mode === 'stub')) throw new Error(`${p.sessions} mixes stub and live rows`);
  return { p, sessions, ledger };
}

// ---------------------------------------------------------------- driver
export async function runStageB(opts, { interpretFn = null, log = console.log } = {}) {
  const mode = opts.stub ? 'stub' : 'live';
  const model = checkModel(opts.model);
  const plan = await buildPlan(opts);
  const liveDefault = path.join(here, 'out', 'stage-b');
  if (opts.stub && path.resolve(opts.out) === liveDefault) throw new Error('--stub may not write to the live output directory');
  const meta = { mode, model: model.id, policyVersion: model.policyVersion, family: FAMILY, config: path.relative(REPO, CONFIG_FILE), n: opts.n, capUsd: opts.cap,
    spendStopUsd: opts.spendStop, workDir: opts.work, timeoutMs: plan.timeoutMs, effort: plan.effort, concurrency: opts.concurrency };
  const state = opts.dryRun && !existsSync(path.join(opts.out, 'run.json')) ? { p: null, sessions: [], ledger: [] } : openRun(opts.out, meta, opts.work);
  const done = new Map(state.sessions.map(r => [r.key, r]));
  for (const j of plan.jobs) { const r = done.get(j.key); if (r && r.taskHash !== j.t.taskHash) throw new Error(`recorded ${j.key} has taskHash ${r.taskHash}, the config gives ${j.t.taskHash}: the bed or config changed; use a new --out`); }
  const todo = plan.jobs.filter(j => !done.has(j.key));
  const spent = { actual: state.ledger.reduce((s, r) => s + (r.actualUsd ?? 0), 0), booked: state.ledger.reduce((s, r) => s + (r.costUsd ?? 0), 0) };
  const attempts = new Map(); for (const r of state.ledger) attempts.set(r.key, (attempts.get(r.key) ?? 0) + 1);

  const head = [`Stage B ${mode}${opts.dryRun ? ' (dry run)' : ''}: ${plan.tasks.length} kinetics dev task(s) x n=${opts.n} = ${plan.jobs.length} sessions; ${done.size} already recorded, ${todo.length} to run`,
    `model ${model.id} (policy ${model.policyVersion}), cap $${opts.cap}/session, spend stop $${opts.spendStop} actual (ledger so far: $${spent.actual.toFixed(4)} actual, $${spent.booked.toFixed(4)} booked), timeout ${plan.timeoutMs / 60000} min, concurrency ${opts.concurrency}`,
    `out ${opts.out}; session workdirs ${opts.work}`,
    `worst case for the remaining sessions: $${(todo.length * opts.cap).toFixed(2)} (all at cap); spend stop bounds the total at $${(opts.spendStop + opts.concurrency * opts.cap).toFixed(2)}; at the prior kinetics Haiku agent mean ($${PRIOR_USD_PER_SESSION}/task) about $${(todo.length * PRIOR_USD_PER_SESSION).toFixed(2)}`];
  head.forEach(l => log(l));
  if (opts.dryRun) {
    for (const t of plan.tasks) log(`  ${t.taskKey} ${t.taskHash.slice(0, 12)}  sessions ${plan.jobs.filter(j => j.seed === t.task.seed).map(j => `k${j.session}${done.has(j.key) ? '(done)' : ''}`).join(' ')}`);
    return { plan, todo, dryRun: true };
  }
  if (!opts.stub && !process.env.CLAUDE_CODE_OAUTH_TOKEN) throw new Error('CLAUDE_CODE_OAUTH_TOKEN is not set in the environment (the sandboxed session authenticates with it)');

  const { score, loadFamily } = await imp('experiments/lib/beds.mjs');
  const { ENV_FAULTS } = await imp('experiments/lib/runner.mjs');
  const fam = await loadFamily(FAMILY);
  const interpret = interpretFn ?? (opts.stub ? (a, job) => stubInterpret(a, job, { wrongEvery: opts.stubWrongEvery })
    : (await imp('experiments/jit/interpret.mjs')).interpret);
  let envFaultStreak = 0, stopReason = null;
  const finished = [];

  async function runJob(job) {
    for (let tries = 0; tries < 2; tries++) {
      const attempt = attempts.get(job.key) ?? 0; attempts.set(job.key, attempt + 1);
      const name = `s${job.seed}-k${job.session}-a${attempt}`, workdir = path.join(state.p.work, name);
      rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
      const t0 = Date.now();
      let trace;
      try {
        trace = await interpret({ task: job.t.task, familyId: FAMILY, outputSchema: fam.outputSchema, model: model.id, budgetUsd: opts.cap,
          timeoutMs: plan.timeoutMs, workdir, effort: plan.effort, traceId: `stageb-${mode}-${name}` }, job);
      } catch (e) {
        // interpret() throws only on a harness bug; the spend is unknown, so the ledger charges the cap and the run stops.
        appendFileSync(state.p.ledger, JSON.stringify({ key: job.key, seed: job.seed, session: job.session, attempt, costUsd: opts.cap, costUnknown: true, actualUsd: opts.cap,
          actualBasis: 'harness-throw-charged-at-cap', error: 'HARNESS_THROW', message: String(e?.message ?? e).slice(0, 300), at: new Date().toISOString() }) + '\n');
        spent.actual += opts.cap; spent.booked += opts.cap; stopReason = `harness error in ${job.key}: ${String(e?.message ?? e).slice(0, 200)}`;
        throw e;
      }
      const durationMs = Date.now() - t0;
      const traceCopy = path.join(state.p.traces, `${name}.json`);
      writeFileSync(traceCopy, JSON.stringify(trace));
      const { actualUsd, actualBasis } = actualCost(trace, opts.cap);
      const code = trace.error?.code ?? null;
      const led = { key: job.key, seed: job.seed, session: job.session, attempt, costUsd: Number(trace.costUsd) || 0, costUnknown: !!trace.costUnknown, actualUsd, actualBasis, error: code, at: new Date().toISOString() };
      appendFileSync(state.p.ledger, JSON.stringify(led) + '\n');
      spent.actual += actualUsd; spent.booked += led.costUsd;
      if (ENV_FAULTS.has(code)) {
        appendFileSync(state.p.faults, JSON.stringify({ ...led, message: String(trace.error?.message ?? trace.error?.stderr ?? '').slice(0, 300), workdir, tracePath: path.relative(opts.out, traceCopy) }) + '\n');
        log(`  ${job.t.taskKey} k${job.session} a${attempt}: ENV FAULT ${code} (not an outcome)${tries === 0 ? '; retrying once' : ''}`);
        continue;
      }
      // Scored exactly as stream.mjs finish(): no answer -> fail with score 0, otherwise beds.score(familyId, task, answer).
      const verdict = trace.answer == null ? { pass: false, score: 0, details: { noOutput: true } } : await score(FAMILY, job.t.task, trace.answer);
      const d = verdict.details ?? {};
      const row = {
        stub: opts.stub || undefined, key: job.key, seed: job.seed, difficulty: job.difficulty, taskKey: job.t.taskKey, taskHash: job.t.taskHash, session: job.session, attempt,
        model: model.id, capUsd: opts.cap, answer: trace.answer ?? null, answerValid: trace.answerValid ?? null, answerErrors: trace.answerErrors ?? null,
        oracle: { pass: !!verdict.pass, score: verdict.score ?? null, reason: d.reason ?? (d.noOutput ? 'no-output' : d.oracleError ? 'oracle-error' : null),
          evaluatorValid: d.evaluatorValid ?? null, setExact: d.excluded?.exact ?? null, missing: d.excluded?.missing ?? null, extra: d.excluded?.extra ?? null,
          jaccard: d.excluded?.jaccard ?? null, unknownConditions: d.unknownConditions ?? null, duplicateConditions: d.duplicateConditions ?? null, perCondition: d.perCondition ?? null },
        costUsd: led.costUsd, costUnknown: led.costUnknown, actualUsd, actualBasis, streamUsage: trace.streamUsage ?? null, durationMs, latencyMs: trace.latencyMs ?? null,
        error: code, errorMessage: code ? String(trace.error?.message ?? trace.error?.stderr ?? '').slice(0, 300) : null,
        turns: trace.turns ?? null, tools: trace.tools ?? null, scripts: trace.scripts?.length ?? null, nestedModelAttempts: trace.nestedModelAttempts ?? 0, hiddenPathAttempts: trace.hiddenPathAttempts ?? 0,
        tracePath: path.relative(opts.out, traceCopy), workdir, traceId: trace.traceId ?? null, ...(trace.stubMode ? { stubMode: trace.stubMode } : {}), at: new Date().toISOString(),
      };
      appendFileSync(state.p.sessions, JSON.stringify(row) + '\n');
      finished.push(row);
      log(`  ${job.t.taskKey} k${job.session}: ${row.oracle.pass ? 'PASS' : 'fail'} score=${row.oracle.score} answer=${row.answer != null} err=${code ?? '-'} $${actualUsd.toFixed(4)} (${actualBasis}) ${Math.round(durationMs / 1000)}s; ledger $${spent.actual.toFixed(4)}`);
      return row;
    }
    return null;
  }

  const queue = [...todo];
  async function worker() {
    while (queue.length && !stopReason) {
      if (spent.actual >= opts.spendStop) { stopReason = `spend stop: ledger $${spent.actual.toFixed(4)} >= $${opts.spendStop}`; break; }
      if (envFaultStreak >= opts.maxEnvFaults) { stopReason = `${envFaultStreak} sessions in a row ended in environment faults`; break; }
      const job = queue.shift();
      const row = await runJob(job);
      envFaultStreak = row ? 0 : envFaultStreak + 1;
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, queue.length || 1) }, worker));
  const all = readJsonl(state.p.sessions);
  const summary = { mode, out: opts.out, planned: plan.jobs.length, recorded: all.length, finishedNow: finished.length, remaining: plan.jobs.length - all.length,
    passes: all.filter(r => r.oracle.pass).length, spentActualUsd: Number(spent.actual.toFixed(4)), spentBookedUsd: Number(spent.booked.toFixed(4)), stopReason };
  log(`done: ${JSON.stringify(summary)}`);
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const s = await runStageB(parseArgs(process.argv.slice(2)));
    if (s.stopReason) process.exitCode = 3;
  } catch (e) { console.error(`stage-b: ${e.message}`); process.exitCode = 2; }
}
