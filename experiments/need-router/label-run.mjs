// Need router v1 label harness (research/need-router-20261014/DESIGN.md §2 and §7 M0 items 3-4; PREREG-NEED-V1.md §3-§5).
// METERED unless --dry. Runs one preregistered stage of the label factory: every mode of a job on the same tasks, scored only
// by the bed oracle, with one re-priced cost meter. Wraps runExperiment (experiments/lib/runner.mjs) and construct()
// (experiments/c0/construct.mjs); it never edits the seed ledger, the policy or stages.json.
//
//   node experiments/need-router/label-run.mjs --stage <ID> [--stages FILE | --stage-spec FILE] [--prereg FILE]
//        [--work-root DIR] [--out DIR] [--dry] [--jobs a,b] [--arms a,b] [--concurrency 1-4] [--no-racing]
//        [--with-conditional] [--allow-draft] [--deviation TEXT]
//
// What it does, per stage:
//   plan      reads prereg/stages.json (or, when that file is absent or --stage-spec is given, a spec file of the same
//             schema); per job: the preregistered tasks (prereg-check.mjs planTasks: per-seed difficulty, stage kinds),
//             assertSeedsAllowed for EVERY task (L4), example and evaluation tasks disjoint by taskHash (a collided
//             evaluation seed is replaced by the lowest unused reserve seed at the same difficulty and kind);
//   build     lineage modes: construct-H and build-O through construct({selfCheck:true}), agent-H+proc through one
//             procedure-writer call; each lineage is a build row (a fixed cost B, never folded into per-task cost);
//   run       every mode on the job's evaluation tasks through runExperiment (envFaultRule, strictResume); construct-H
//             answers are checked by the lineage's check.mjs after each task (selfVerdict);
//   probe     NR-probe rows on the probe example (two direct-H draws, one agent-H run): deployable signals only, the
//             oracle is never called on them;
//   racing    after the first pass, jobs with P(best class) < 0.8 at the headline cell get one more draw or lineage
//             for each mode in their acceptable set (up to 4 per mode); agent-O gets a second draw on every task where
//             it is in the draw-1 per-task acceptable set (PREREG §4.3);
//   price     every row and build re-priced from recorded tokens with the pinned price table (stages.json priceTable);
//             killed sessions and timeouts charged at their bound; measured and imputed dollars kept apart;
//   void      a lineage (or an agent draw) with hiddenPathAttempts > 0 or nestedModelAttempts > 0 is voided; ownerci
//             construct-H solvers holding example module text are voided (AUDIT F10);
//   cap       a trial or build starts only if its bound fits under the stage cap next to spend and work in flight (K5).
//             The cap meter (PREREG §12) charges each start max(reported, re-priced), its bound when its spend was not
//             observed (timeout, killed, costUnknown); every reservation and settlement is appended to spend.jsonl in the
//             work root AND in --out, so a resume starts from what was spent (faulted attempts, builds, probes included),
//             a start in flight when a process died counts at its bound, and a new work root over an --out that already
//             holds this stage's spend is refused;
//   faults    per (job, mode): attempts and environment faults of trials (results + results.faults) and builds
//             (builds + construction-faults); an arm over the 25% limit is invalid (K4): report.validity.invalidArms and
//             arm-faults.jsonl, which evaluate.mjs reads;
//   resume    build, probe and racing records carry a stamp (stageSha: the plan restricted to what this stage reads; the
//             arm's computed settings hash; the prompt shas; the price-table id); a resume over records with another
//             stamp is refused, as runExperiment's strictResume refuses trials of another arm version;
//   paid      a run without --dry checks its plan first (paidRunChecks): the canonical stages.json or a spec whose sha256
//             the preregistration lists, prereg-check's checkStages with no error, every arm's settingsSha = armSha, the
//             preregistration equal to its frozen (committed) text, a clean label-engine stamp (written to STAMP.json
//             before the first paid call and compared on resume), approval, and --jobs/--arms or --allow-draft only with a
//             recorded deviation (report.deviations);
//   files     live files stay outside the repository (/var/tmp/foundry-work/need/<stage>); results, rows, builds,
//             probes, calls, the report and small build artefacts are copied to --out at the end (also after a stop).
// --dry swaps every port for a deterministic stub ($0: no model, no claude binary, no sandbox) and gives a byte-identical
// report on rerun. Row fields follow metrics.mjs needTable: total charged = usdRepriced (measured) + usdImputed.
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runExperiment, armHash, metEnvFault, ENV_FAULTS, faultsFileOf } from '../lib/runner.mjs';
import { loadFamily, inlineRender } from '../lib/beds.mjs';
import { canonical, sha256 } from '../../beds/lib/canonical.mjs';
import { b0Call } from '../lib/arms/b0-call.mjs';
import { b0Agent, PROCEDURE_LINE } from '../lib/arms/b0-agent.mjs';
import { b1Script } from '../lib/arms/b1-script.mjs';
import { construct, runSelfCheck, SELF_CHECK_PARAGRAPH, SELF_CHECK_FILE, BUILD_ENV_FAULTS, taskFiles } from '../c0/construct.mjs';
import { builderPrompt } from '../c0/prompts.mjs';
import { createModelPort, subsetPolicy } from '../lib/models.mjs';
import { loadPolicy, policyHash } from '../../src/models/policy.mjs';
import { materialize } from '../../src/executors/claude-code.mjs';
import { compileDataSchema } from '../../src/validate.mjs';
import { assertSeedsAllowed, loadLedger } from '../jit/seeds.mjs';
import { STAGES_FILE, PREREG_FILE, ROLES, planTasks, exampleSet, span, checkStages, armSha, canonicalJson, stamp as engineStamp, stampDiff } from './prereg-check.mjs';
import { needTable, needLabels, HEADLINE, DELTA, MODES, ENV_FAULT_LIMIT } from './metrics.mjs';
import { guardMeter, readMeterGate, readVerification, meterGateDecision, OUTPUT_TOLERANCE } from './meter-gate.mjs';
import { perArm, cacheShareCell } from '../memory/cache-share.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const LIVE_ROOT = '/var/tmp/foundry-work/need';
export const OUT_ROOT = path.join(REPO, 'research/need-router-20261014/runs');
export const REPORT_SCHEMA = 'need-label-report/1';
export const ROW_SCHEMA = 'need-label-row/1';
const EVAL_ROLES = new Set(['trainEval', 'heldoutEval', 'e2e', 'drift']);
const RESERVE_OF = { trainEval: 'trainReserve', heldoutEval: 'heldoutReserve', e2e: 'heldoutReserve', drift: 'heldoutReserve' };
// Arms this harness does not run (yet): they are skipped with the reason in the report.
const NOT_HERE = {
  'ref-R1': 'static@v3 reference with live judges: needs the stream.mjs static@v3 arm and an engine stamp carrying it',
  'ref-R3': 'static@v3 reference with live judges: needs the stream.mjs static@v3 arm and an engine stamp carrying it',
  'judge-H': 'judge-H baseline: its prompt and runner are a separate M0 piece',
  'router-choice': 'E2E lane: needs the frozen router (decision cards)',
};

const sha16 = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
const r6 = x => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : x);
const sum = xs => xs.reduce((a, b) => a + b, 0);
/** FNV-1a (stub outcomes and per-key choices; deterministic, order-free). */
export function fnv(s) { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
const sortKeys = v => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v);
/** JSON with object keys sorted at every depth (the report's byte-stable form). */
export const stableJson = v => JSON.stringify(sortKeys(v), null, 1) + '\n';
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const zeroUsage = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
const addUsage = (a, u) => { for (const k of Object.keys(a)) a[k] += Number.isFinite(u?.[k]) ? u[k] : 0; return a; };

// ---------------------------------------------------------------------------------------------------------------------
// Plan

/** The stage document: stages.json when present (and no spec file is named), else the spec file (same schema). */
export function loadPlan({ stageId, stagesFile = STAGES_FILE, specFile = null }) {
  const file = specFile ?? (existsSync(stagesFile) ? stagesFile : null);
  if (!file) throw new Error(`no stage plan: ${stagesFile} is absent; pass --stage-spec FILE`);
  const text = readFileSync(file, 'utf8'), stages = JSON.parse(text);
  if (stages?.schema !== 'need-prereg-stages/1') throw new Error(`${file}: schema must be need-prereg-stages/1`);
  const stage = (stages.stages ?? []).find(s => s.id === stageId);
  if (!stage) throw new Error(`${file}: no stage ${stageId} (stages: ${(stages.stages ?? []).map(s => s.id).join(', ')})`);
  return { stages, stage, source: specFile ? 'spec' : 'stages.json', file, planSha: sha16(text), planSha256: createHash('sha256').update(text).digest('hex') };
}

/** The arms and jobs a stage names (unfiltered: a filtered run and the full run of one stage share one stageSha). */
function stageNames(stages, stage) {
  const runs = stage.runs ?? [];
  return { arms: [...new Set(runs.flatMap(r => r.arms ?? []).filter(a => stages.arms?.[a]))].sort(), jobs: [...new Set(runs.map(r => r.job).filter(Boolean))].sort() };
}
// The job fields a label depends on (hypotheses, notes and observations may be revised without changing a label).
const JOB_LABEL_FIELDS = ['id', 'family', 'ledgerBed', 'band', 'stageKinds', 'split', 'cluster', 'agentOBudgetUsd', 'modes', 'ceiling', 'bedStatus', 'interactive'];
/**
 * The stage sha: sha256 (16 hex) of the plan restricted to what this stage reads: its id, runs and cap; the definitions of
 * the arms it names; the label fields of its jobs; seeds, grid, derived cascades, the price table, the bootstrap reps and
 * seed racing uses. Approval flags, descriptions and other stages do not enter it. Build, probe and racing records carry
 * it; a resume over records with another stageSha is refused.
 */
export function stageSha(stages, stage) {
  const { arms, jobs } = stageNames(stages, stage);
  const job = id => { const j = (stages.jobs ?? []).find(x => x.id === id) ?? {}; return Object.fromEntries(JOB_LABEL_FIELDS.filter(k => j[k] !== undefined).map(k => [k, j[k]])); };
  return sha16(canonicalJson({ stage: { id: stage.id, runs: stage.runs ?? [], capUsd: stage.capUsd ?? null }, arms: Object.fromEntries(arms.map(a => [a, stages.arms[a]])),
    jobs: jobs.map(job), seeds: stages.seeds ?? null, grid: stages.grid ?? null, derived: stages.derived ?? null, priceTable: stages.priceTable ?? null,
    racing: { reps: stages.reps?.labelBootstrap ?? null, seed: stages.rng?.labelBootstrap ?? null } }));
}

const lineageOf = arm => !!arm?.build;
const evalRoleOf = run => (run.seedRoles ?? []).find(r => EVAL_ROLES.has(r)) ?? null;

/** Group a stage's runs by job: which arms run on which evaluation role, which probe arms, and what is skipped. */
export function stageUnits(stages, stage, { jobs = null, arms = null, withConditional = false } = {}) {
  const units = new Map(), skipped = [];
  for (const [ri, run] of (stage.runs ?? []).entries()) {
    const where = `${stage.id}.runs[${ri}]${run.job ? ` (${run.job})` : run.bed ? ` (${run.bed})` : ''}`;
    if (!run.job) { skipped.push({ where, reason: run.eligible ? NOT_HERE['router-choice'] : 'explicit-seed runs (M1) have their own runner (m1-run.mjs)' }); continue; }
    if (jobs && !jobs.includes(run.job)) { skipped.push({ where, reason: 'filtered by --jobs/--arms', filtered: 'job' }); continue; }
    const job = stages.jobs.find(j => j.id === run.job);
    if (!job) throw new Error(`${where}: unknown job ${run.job}`);
    if (run.condition && !withConditional) { skipped.push({ where, reason: `conditional run (${run.condition}); pass --with-conditional once it holds` }); continue; }
    if (run.seedsFrom) { skipped.push({ where, reason: `seeds from ${run.seedsFrom}: not planned by this harness` }); continue; }
    if (job.bedStatus !== 'exists' || !job.family) { skipped.push({ where, reason: `bed ${job.family ?? '(none)'} is ${job.bedStatus ?? 'not written'}` }); continue; }
    if (job.split === 'sealed' || job.family.startsWith('sealed')) { skipped.push({ where, reason: 'sealed families run only from the NL3 session' }); continue; }
    if (!job.band) { skipped.push({ where, reason: `no frozen band (${job.bandStatus ?? 'TBD'})` }); continue; }
    const u = units.get(job.id) ?? { job, evalRole: null, arms: [], probeArms: [], runs: [] };
    u.runs.push(where);
    const roles = run.seedRoles ?? [];
    for (const a of run.arms ?? []) {
      if (arms && !arms.includes(a)) { skipped.push({ where, reason: `${a}: filtered by --jobs/--arms`, filtered: 'arm' }); continue; }
      if (NOT_HERE[a]) { skipped.push({ where, reason: `${a}: ${NOT_HERE[a]}` }); continue; }
      const def = stages.arms[a];
      if (!def) throw new Error(`${where}: unknown arm ${a}`);
      if (roles.includes('probe')) { if (!u.probeArms.includes(a)) u.probeArms.push(a); continue; }
      const er = evalRoleOf(run);
      if (!er) { skipped.push({ where, reason: `${a}: no evaluation seed role` }); continue; }
      if (u.evalRole && u.evalRole !== er) throw new Error(`${where}: job ${job.id} on two evaluation roles (${u.evalRole}, ${er})`);
      u.evalRole = er;
      if (lineageOf(def) && !roles.includes('examples')) throw new Error(`${where}: lineage arm ${a} needs the examples role`);
      if (!u.arms.includes(a)) u.arms.push(a);
    }
    units.set(job.id, u);
  }
  return { units: [...units.values()].filter(u => u.arms.length || u.probeArms.length), skipped };
}

const taskKeyOf = (family, t) => `${family}:${t.split}:d${t.difficulty}:s${t.seed}${t.stage ? `:${t.stage}` : ''}`;
async function makeTask(family, t) {
  const fam = await loadFamily(family);
  const task = fam.generate({ seed: t.seed, split: t.split, difficulty: t.difficulty, ...(t.stage ? { stage: t.stage } : {}) });
  return { ...t, familyId: family, task, taskKey: taskKeyOf(family, t), taskHash: sha256(canonical(task)) };
}

/**
 * The tasks of one job: evaluation tasks (role), example sets (lineage builders), the probe example. Every seed is checked
 * against the ledger (assertSeedsAllowed, one call per task); example and evaluation tasks must differ by taskHash and no
 * evaluation task repeats within the job; a collided evaluation seed is replaced from the reserve range.
 */
export async function planJob(stages, unit, { ledger, examplesNeeded = [], probe = false, taken = null }) {
  const job = unit.job, bed = job.ledgerBed ?? job.family, purposes = stages.seeds.purposes;
  let seedChecks = 0;
  const check = (role, seed) => {
    const meta = ROLES[role];
    assertSeedsAllowed({ bed, split: meta.split, seeds: [seed], purpose: purposes[meta.purposeKey], ledger });
    seedChecks += 1;
  };
  const examples = {};
  const allExamples = planTasks(stages, job.id, 'examples');
  for (const k of examplesNeeded) {
    const seeds = exampleSet(stages, k);
    examples[k] = [];
    for (const t of allExamples.filter(x => seeds.includes(x.seed))) { check('examples', t.seed); examples[k].push(await makeTask(job.family, { ...t, role: 'examples' })); }
  }
  const exampleHashes = new Set(Object.values(examples).flat().map(t => t.taskHash));
  // Every example of the job counts for disjointness, whether or not a builder in this stage reads it.
  for (const t of allExamples) exampleHashes.add((await makeTask(job.family, t)).taskHash);
  let probeTask = null;
  if (probe) { const [t] = planTasks(stages, job.id, 'probe'); check('probe', t.seed); probeTask = await makeTask(job.family, { ...t, role: 'probe' }); }
  const evalTasks = [], replacements = [];
  if (unit.evalRole) {
    const reserveRole = RESERVE_OF[unit.evalRole];
    const planned = planTasks(stages, job.id, unit.evalRole);
    const reserve = reserveRole && stages.seeds[reserveRole] ? span(stages.seeds[reserveRole]) : [];
    // Reserve seeds already taken as replacements of this family (other jobs of this stage, other stages' reports: `taken`,
    // family -> Set) are never handed out again, so no task of a family is evaluated twice across roles or stages.
    const prior = taken?.get(bed) ?? new Set();
    const used = new Set([...planned.map(t => t.seed), ...prior]), seen = new Set();
    for (const t0 of planned) {
      let t = t0, made;
      for (;;) {
        check(t === t0 ? unit.evalRole : reserveRole, t.seed);
        made = await makeTask(job.family, { ...t, role: t === t0 ? unit.evalRole : reserveRole });
        if (!exampleHashes.has(made.taskHash) && !seen.has(made.taskHash)) break;
        const next = reserve.find(s => !used.has(s));
        if (next === undefined) throw new Error(`${job.id}: task ${made.taskKey} collides and the reserve range is exhausted`);
        used.add(next);
        if (taken) taken.set(bed, new Set([...(taken.get(bed) ?? []), next]));
        replacements.push({ from: t.seed, to: next, difficulty: t.difficulty, ...(t.stage ? { stage: t.stage } : {}), why: exampleHashes.has(made.taskHash) ? 'example collision' : 'repeated evaluation task' });
        t = { ...t0, seed: next, split: ROLES[reserveRole].split };
      }
      seen.add(made.taskHash); evalTasks.push(made);
    }
  }
  return { evalTasks, examples, probeTask, replacements, seedChecks, bed };
}

/**
 * Reserve seeds earlier stages took as replacements, per family (ledger bed): read from the report.json of every other
 * stage directory under `root` (the parent of --out: research/need-router-20261014/runs). The held-out evaluation, E2E and
 * DRIFT roles share one reserve range (8813-8824); "lowest unused" is then computed over every stage, not one process.
 */
export function priorReplacementSeeds(root, stageId) {
  const out = new Map();
  let dirs = [];
  try { dirs = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(root, d.name)); } catch { return out; }
  for (const d of dirs.sort()) {
    const f = path.join(d, 'report.json');
    if (!existsSync(f)) continue;
    let rep; try { rep = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    if (rep?.schema !== REPORT_SCHEMA || rep.stage === stageId) continue;
    for (const j of rep.jobs ?? []) for (const r of j.replacements ?? []) {
      const fam = j.bed ?? j.family;
      if (!fam || !Number.isInteger(r.to)) continue;
      out.set(fam, new Set([...(out.get(fam) ?? []), r.to]));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Prices: one meter

/** The price of one request: every token at the tier its prompt tokens (input + cache read + cache write) fall in.
 *  null for a model the table does not price. */
export function priceUsage(priceTable, modelId, u) {
  const tiers = priceTable?.models?.[modelId]?.tiers;
  if (!tiers) return null;
  const inp = u?.inputTokens ?? 0, out = u?.outputTokens ?? 0, cr = u?.cacheReadTokens ?? 0, cw = u?.cacheWriteTokens ?? 0;
  const t = tiers.find(x => x.maxPromptTokens == null || inp + cr + cw <= x.maxPromptTokens) ?? tiers.at(-1);
  return (inp * t.input + out * t.output + cr * t.cacheRead + cw * t.cacheWrite5m) / 1e6;
}

/** Gateway calls (metered port records): measured = re-priced tokens; a call whose spend was not observed (killed, or a
 *  timeout) is charged at its bound (boundUsd, else the port's costUpperUsd), the excess over its measured tokens imputed. */
export function priceCalls(priceTable, calls, { boundUsd = null } = {}) {
  let measured = 0, imputed = 0, fallback = 0;
  const tokens = zeroUsage();
  for (const c of calls) {
    addUsage(tokens, c.usage);
    let m = priceUsage(priceTable, c.modelId, c.usage ?? zeroUsage());
    if (m === null) { m = c.costUsd ?? 0; fallback += 1; }
    measured += m;
    if (c.costUnknown || c.errorCode === 'MODEL_TIMEOUT') imputed += Math.max(0, (boundUsd ?? c.costUpperUsd ?? 0) - m);
    imputed += c.imputedUsd ?? 0;   // imputed compute (local providers); 0 on the CLI
  }
  return { measured, imputed, tokens, fallback };
}

/** USD per output token of one per-message usage line [input, output, cacheRead, cacheWrite, model], at the tier its own request falls in (the session
 *  model when the line names none or one the table does not price); null when neither is priced. */
export function outputRateOf(priceTable, model, [i, , cr, cw, m]) {
  const u = { inputTokens: i, cacheReadTokens: cr, cacheWriteTokens: cw };
  const id = m && priceUsage(priceTable, m, u) !== null ? m : model;
  const hi = priceUsage(priceTable, id, { ...u, outputTokens: 1e6 });
  return hi === null ? null : (hi - priceUsage(priceTable, id, { ...u, outputTokens: 0 })) / 1e6;
}

/** An agent session: per-message usage priced at each message's own tier and model (the session model when the message
 *  names none or one the table does not price); a killed session (costUnknown) is charged at its budget bound. */
export function priceSession(priceTable, model, { messageUsage = null, streamUsage = null, costUnknown = false, boundUsd = 0, reportedUsd = 0, finalUsage = null, meter = null } = {}) {
  const tokens = zeroUsage();
  let measured = 0, approx = false, repriced = true, modelFallback = 0;
  if (Array.isArray(messageUsage)) {
    for (const [i, o, cr, cw, m] of messageUsage) {
      const u = { inputTokens: i, outputTokens: o, cacheReadTokens: cr, cacheWriteTokens: cw };
      addUsage(tokens, u);
      let p = m ? priceUsage(priceTable, m, u) : null;
      if (p === null) { p = priceUsage(priceTable, model, u) ?? 0; if (m && m !== model) modelFallback += 1; }
      measured += p;
    }
  } else if (streamUsage) {   // no per-message record: the aggregate at the session model's tier for its total (approximate)
    addUsage(tokens, streamUsage); measured = priceUsage(priceTable, model, streamUsage) ?? 0; approx = true;
  } else { measured = costUnknown ? 0 : reportedUsd; repriced = false; }
  const imputed = costUnknown ? Math.max(0, boundUsd - measured) : 0;
  const cost = { measured, imputed, tokens, approx, repriced, modelFallback };
  // Cost-meter gate (meter-gate.mjs, D6): with `meter` set (live runs) a session whose per-message output tokens are not within the tolerance of the CLI's
  // final result usage has the missing output tokens priced from that usage and is accepted only if the result lands within the price band of the
  // reported figure (`outputFromFinal`); any other such session, or one with no final usage, is booked at the reported figure: the re-price's shortfall
  // is imputed and flagged `meterUnverified`.
  return meter ? guardMeter(cost, { messageUsage, streamUsage, finalUsage }, { reportedUsd, tolerance: meter.tolerance, outputRateOf: line => outputRateOf(priceTable, model, line) }) : cost;
}

/** Metered gateway calls of a run, persisted (calls.jsonl) so a resume re-prices rows recorded by an earlier process. */
export class CallBook {
  constructor(file) { this.file = file; this.calls = readJsonl(file); this.seq = this.calls.length; }
  add(c) { const rec = { seq: this.seq++, ...c }; this.calls.push(rec); appendFileSync(this.file, JSON.stringify(rec) + '\n'); }
  exact(runId) { return this.calls.filter(c => c.runId === runId); }
  /** Calls of one attempt: an exact run id (b0Call, the procedure writer) or a run-id prefix (b1Script, construct: a fresh
   *  uuid per attempt), recorded while the attempt ran (seq in [from, to)). A retried b0Call reuses its run id, so without
   *  the seq range a row would also be charged the calls of its faulted attempts. */
  attempt({ exact = null, prefix = null, seq = null }) {
    return this.calls.filter(c => (exact != null ? c.runId === exact : String(c.runId ?? '').startsWith(prefix)) && (!seq || (c.seq >= seq[0] && c.seq < seq[1])));
  }
  /** Calls of the last attempt under a run-id prefix (b1Script and construct add a fresh uuid per attempt). */
  latest(prefix) {
    const mine = this.calls.filter(c => c.runId?.startsWith(prefix));
    if (!mine.length) return [];
    const last = mine.reduce((a, c) => (c.seq > a.seq ? c : a)).runId;
    return mine.filter(c => c.runId === last);
  }
}

/** A port view that records every call (usage, cost, spend facts; never prompts) and can set a per-call timeout. */
export function meteredPort(port, { book, timeoutMs = null }) {
  return {
    policy: port.policy, policyHash: port.policyHash, providers: port.providers, journal: port.journal, timeoutMs: timeoutMs ?? port.timeoutMs,
    async call(req) {
      let r, thrown;
      try { r = await port.call(timeoutMs && req.timeoutMs == null ? { ...req, timeoutMs } : req); } catch (e) { thrown = e; }
      const src = r ?? thrown?.details ?? {};
      book.add({ runId: req.runId, nodeKey: req.nodeKey, modelId: src.modelId ?? req.modelId, ok: !!r?.ok, errorCode: r?.error?.code ?? thrown?.code ?? null,
        usage: src.usage ?? null, costUsd: src.costUsd ?? 0, imputedUsd: src.imputedUsd ?? 0, costUnknown: !!src.costUnknown, costUpperUsd: src.costUpperUsd ?? null, thrown: !!thrown });
      if (thrown) throw thrown;
      return r;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The procedure writer (agent-H+proc build: one Haiku call per lineage, example set k, no answers, no oracle)

export const PROCEDURE_MAX_WORDS = 1500, PROCEDURE_INPUT_TOKENS = 30000, CHARS_PER_TOKEN = 4;
export const PROCEDURE_WRITER_SYSTEM = 'You write working procedures for an AI agent that will solve many tasks of one family, one task at a time. You never see answers to the tasks.';
export const PROCEDURE_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false, required: ['procedure', 'checks'], properties: {
  procedure: { type: 'string', maxLength: 16000 }, checks: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 400 } } } });
/** The procedure-writer prompt: the example prompts in full, their inputs (and files) truncated to 30K tokens in total, the
 *  output schema. Nothing else: no answer, no score, no oracle, no held-out seed (L7). */
export function procedureWriterPrompt({ examples, outputSchema }) {
  const per = Math.floor((PROCEDURE_INPUT_TOKENS * CHARS_PER_TOKEN) / Math.max(1, examples.length));
  const cut = s => (s.length > per ? `${s.slice(0, per)}\n[... truncated: ${s.length - per} more characters]` : s);
  const parts = [
    'Below are example tasks from one task family: exactly what the agent will receive for each task (the task text, its inputs, and the JSON Schema its final answer must match). You see no answers, and nothing here has been checked.',
    '',
    `Write a procedure (at most ${PROCEDURE_MAX_WORDS} words) that an agent should follow to solve NEW tasks of this family correctly: the steps to take, `
      + 'how to read the inputs, the rules and conventions the task text states, the pitfalls, and how to assemble an answer that matches the schema. '
      + 'Keep it general: do not include answers or values specific to these examples.',
    '',
    'Also list checks: short statements the agent can verify about its own final answer before it finishes, each checkable from the task and the answer alone.',
    '', '## Output schema of every answer', '```json', JSON.stringify(outputSchema, null, 1), '```',
  ];
  examples.forEach((t, i) => {
    const inputs = [JSON.stringify(t.task.inputs ?? {}, null, 1), ...Object.entries(t.task.files ?? {}).map(([rel, c]) => `--- files/${rel}\n${c}`)].join('\n');
    parts.push('', `## Example ${i + 1}: task text`, t.task.prompt, '', `## Example ${i + 1}: inputs`, '```', cut(inputs), '```');
  });
  return parts.join('\n');
}
/** PROCEDURE.md from the writer's value; the procedure is cut at 1,500 words. */
export function procedureMarkdown({ procedure, checks }) {
  const words = String(procedure ?? '').split(/\s+/).filter(Boolean);
  const body = words.length > PROCEDURE_MAX_WORDS ? words.slice(0, PROCEDURE_MAX_WORDS).join(' ') : String(procedure ?? '').trim();
  const list = (checks ?? []).map((c, i) => `${i + 1}. ${String(c).replace(/\s+/g, ' ').trim()}`).join('\n');
  return { text: `# Procedure\n\n${body}\n\n# Checks\n\n${list || '(none)'}\n`, words: Math.min(words.length, PROCEDURE_MAX_WORDS), truncatedWords: Math.max(0, words.length - PROCEDURE_MAX_WORDS), checks: (checks ?? []).length };
}
export async function writeProcedure({ port, model, reasoning = 'medium', examples, outputSchema, runId, file }) {
  const prompt = procedureWriterPrompt({ examples, outputSchema });
  const r = await port.call({ runId, nodeKey: 'procedure-writer', modelId: model, system: PROCEDURE_WRITER_SYSTEM, prompt, schema: PROCEDURE_SCHEMA,
    decoding: { reasoning, maxTokens: 16000 }, salt: runId });
  if (!r.ok) return { ok: false, error: r.error?.code ?? 'MODEL_ERROR', costUsd: r.costUsd ?? 0, promptSha: sha16(prompt) };
  const md = procedureMarkdown(r.value);
  mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, md.text);
  return { ok: true, file, sha: sha16(md.text), words: md.words, truncatedWords: md.truncatedWords, checks: md.checks, costUsd: r.costUsd ?? 0, promptSha: sha16(prompt) };
}
// The pinned prompt texts (engine stamp S1: "sha256 of the selfCheck prompt paragraph, the procedure-writer prompt").
// builderB1Template: the B1 builder prompt at fixed arguments (a change to its text changes the sha; build rows carry the
// prompt shas, and a resume over builds made under other prompts is refused).
export const promptShas = () => ({ selfCheckParagraph: sha16(SELF_CHECK_PARAGRAPH), procedureWriterSystem: sha16(PROCEDURE_WRITER_SYSTEM),
  procedureWriterTemplate: sha16(procedureWriterPrompt({ examples: [], outputSchema: {} })), procedureLine: sha16(PROCEDURE_LINE),
  builderB1Template: sha16(builderPrompt('B1', { probes: 3, minutes: 30, constructionModelUsd: 1.5, perTaskUsd: 1, scoreChecks: 0, models: ['m'], classes: 'c = m', kitDir: '/kit' })) });

// ---------------------------------------------------------------------------------------------------------------------
// ownerci leak scan (AUDIT F10): a solver that carries module text from the example tasks can rebuild the original module
// by majority vote across tasks. Rule [P]: >= 3 distinct example lines of >= 40 characters found verbatim in solve.mjs.
export const COPY_SCAN = Object.freeze({ minLineChars: 40, maxLines: 2 });
export function copiedExampleLines(source, exampleTasks, { minLineChars = COPY_SCAN.minLineChars } = {}) {
  const lines = new Set();
  const visit = v => { if (typeof v === 'string') { for (const l of v.split('\n')) { const t = l.trim(); if (t.length >= minLineChars) lines.add(t); } } else if (v && typeof v === 'object') Object.values(v).forEach(visit); };
  for (const t of exampleTasks) { visit(t.task.inputs); visit(t.task.files); }
  return [...lines].filter(l => source.includes(l)).length;
}

// ---------------------------------------------------------------------------------------------------------------------
// Stage budget (K5): a trial or a build starts only when its bound fits under the cap beside spend and work in flight.
// The one cap meter (PREREG §12, stages.json spendMeter): each settled start at max(reported, re-priced), at least its bound
// when its spend was not observed; each start in flight at its bound. Every reservation and settlement is appended to the
// stage's spend ledger (spend.jsonl, in the work root and in --out), so the meter survives the process: a resume starts
// from the ledger, and a reservation that was never settled (the process died with the start in flight) counts at its bound.
export const SPEND_FILE = 'spend.jsonl', ARM_FAULTS_FILE = 'arm-faults.jsonl', STAMP_FILE = 'STAMP.json';
export class StageBudget {
  constructor(capUsd, spentUsd = 0, { stage = null, files = [], attempts = new Map() } = {}) {
    Object.assign(this, { capUsd, spentUsd, reservedUsd: 0, refused: 0, stage, files: [...new Set(files)], attempts: new Map(attempts) });
  }
  write(e) { const line = JSON.stringify({ stage: this.stage, ...e }) + '\n'; for (const f of this.files) appendFileSync(f, line); }
  /** Reserve a start's bound; null (refused, counted) when it does not fit. info: { kind, key, ...detail }. */
  reserve(bound, { kind = 'start', key = null, ...detail } = {}) {
    if (this.spentUsd + this.reservedUsd + bound > this.capUsd + 1e-9) { this.refused += 1; return null; }
    this.reservedUsd += bound;
    const n = key == null ? null : (this.attempts.get(key) ?? 0) + 1;
    if (key != null) this.attempts.set(key, n);
    const tok = { id: randomUUID(), bound, kind, key, n };
    this.write({ op: 'reserve', id: tok.id, kind, key, n, bound, ...detail });
    return tok;
  }
  /** Settle a reservation at what the start was charged on the meter (detail: reported, repriced, imputed, error, ...). */
  settle(tok, charged, detail = {}) {
    this.reservedUsd = Math.max(0, this.reservedUsd - tok.bound); this.spentUsd += charged;
    this.write({ op: 'settle', id: tok.id, kind: tok.kind, key: tok.key, n: tok.n, bound: tok.bound, charged, ...detail });
  }
}
const sortedSum = xs => sum([...xs].sort((a, b) => a - b));
/** A stage's spend ledger read from one or more files (entries joined by id): settled charges, reservations never settled
 *  (at their bound), carried figures (a legacy work root's spend rebuilt from its files), and per-key attempt counts. */
export function loadSpend(files, stageId) {
  const byId = new Map();
  for (const f of [...new Set(files)]) for (const e of readJsonl(f)) {
    if (e.stage !== stageId || !e.id) continue;
    const x = byId.get(e.id) ?? {};
    x[e.op === 'reserve' ? 'reserve' : e.op === 'settle' ? 'settle' : 'carry'] = e;
    byId.set(e.id, x);
  }
  const settled = [], open = [], carried = [], attempts = new Map(), entries = [];
  for (const [id, x] of byId) {
    const e = x.settle ?? x.reserve ?? x.carry;
    if (x.carry) carried.push(x.carry.charged ?? 0);
    else if (x.settle) settled.push(x.settle.charged ?? 0);
    else open.push(x.reserve.bound ?? 0);
    if (e.key != null && Number.isInteger(e.n)) attempts.set(e.key, Math.max(attempts.get(e.key) ?? 0, e.n));
    entries.push({ id, ...e, settled: !!x.settle, carried: !!x.carry });
  }
  const settledUsd = sortedSum(settled), openUsd = sortedSum(open), carriedUsd = sortedSum(carried);
  return { ids: new Set(byId.keys()), entries, attempts, settledUsd, openUsd, carriedUsd, totalUsd: settledUsd + openUsd + carriedUsd };
}
const capError = budget => Object.assign(new Error(`stage cap $${budget.capUsd} reached (spent $${budget.spentUsd.toFixed(2)}, in flight $${budget.reservedUsd.toFixed(2)})`), { code: 'STAGE_CAP' });

/**
 * One start on the meter. measured = re-priced tokens (an agent session from its per-message usage, gateway calls from
 * calls.jsonl), imputed = the bound's excess over them when the spend was not observed, reported = the arm's own figure.
 * charged (the cap meter) = max(reported, measured + imputed), and at least the bound when the spend was not observed
 * (a timeout, a killed session, costUnknown on the result or on any of its calls). kind: 'call' (b0Call, the procedure
 * writer: bound per call), 'script' (b1Script: each call's own upper bound, the per-task bound on the attempt), 'session'.
 */
export function meterOf({ kind, priceTable, model = null, bound = 0, r = null, calls = [] }) {
  const reported = (r?.costUsd ?? 0) + (r?.imputedUsd ?? 0);
  let measured, imputed, unknown, tokens;
  if (kind === 'session') {
    const p = priceSession(priceTable, model, { messageUsage: r?.meta?.messageUsage, streamUsage: r?.meta?.streamUsage, costUnknown: !!r?.costUnknown, boundUsd: bound, reportedUsd: r?.costUsd ?? 0 });
    measured = p.measured; imputed = p.imputed; unknown = !!r?.costUnknown; tokens = p.tokens;
  } else {
    const p = priceCalls(priceTable, calls, { boundUsd: kind === 'call' ? bound : null });
    measured = p.measured; imputed = p.imputed; tokens = p.tokens;
    unknown = !!r?.costUnknown || r?.error?.code === 'MODEL_TIMEOUT' || calls.some(c => c.costUnknown || c.errorCode === 'MODEL_TIMEOUT');
  }
  return { reported, measured, imputed, unknown, tokens, charged: Math.max(reported, measured + imputed, unknown ? bound : 0) };
}
/** The probe-row and legacy figure: what a result reported, at least its bound when the spend was not observed. */
const chargeOf = (r, bound) => {
  const c = (r?.costUsd ?? 0) + (r?.imputedUsd ?? 0);
  return r?.costUnknown || r?.error?.code === 'MODEL_TIMEOUT' ? Math.max(c, bound) : c;
};

// Self-check infrastructure failures (no sandbox, the check could not launch) are environment faults, not verdicts: their
// code goes into meta.errors, so the runner keeps a failed trial aside and a resume retries it (a passing trial is
// recorded with selfVerdict null and selfCheckError set; it is counted in the report).
const SELF_CHECK_ENV = code => (ENV_FAULTS.has(code) ? code : 'EXECUTOR_LAUNCH');

// Every arm's run goes through this: the cap (reserve, then settle on the meter, with the attempt in the spend ledger), then
// the deployable signals of its answer (delivered, schema validity, the family-handed check when a bed exports
// deployableCheck), then the post-run self-check of a construct-H lineage. attemptOf(a): which calls.jsonl entries belong
// to the attempt (b0Call: exact run id; b1Script: run-id prefix); the seq range is recorded in meta.callSeq.
function withSignals(arm, { ctx, job, kind, model = null, bound, schemaTest, fam, selfCheck = null, attemptOf = null, ledgerKind = 'trial' }) {
  const { budget, book, stages } = ctx;
  return {
    ...arm, def: selfCheck ? { ...arm.def, selfCheckSha: selfCheck.sha } : arm.def,
    async run(a) {
      const key = `${job}|${arm.id}|${a.taskKey}|t${a.trial}`;
      const tok = budget.reserve(bound, { kind: ledgerKind, key, job, arm: arm.id, task: a.taskKey, trial: a.trial });
      if (!tok) throw capError(budget);
      const seq0 = book.seq;
      let r, thrown = null, m = null, envFault = false;
      try {
        try { r = await arm.run(a); } catch (e) { thrown = e; }
        const seq = [seq0, book.seq], calls = kind === 'session' || !attemptOf ? [] : book.attempt({ ...attemptOf(a), seq });
        // A thrown session (runClaudeCode throws only before the CLI starts) spent nothing; thrown calls are priced from the book.
        m = meterOf({ kind, priceTable: stages.priceTable, model, bound, r: r ?? null, calls });
        if (thrown) throw thrown;
        const out = r.output, delivered = out != null;
        let schemaValid = null;
        if (delivered && schemaTest) { try { schemaValid = schemaTest(out) === true; } catch { schemaValid = false; } }
        let deployableVerdict = delivered ? (schemaValid === false ? 'fail' : 'pass') : null;
        if (delivered && typeof fam.deployableCheck === 'function') { try { if ((await fam.deployableCheck(a.task, out)) === false) deployableVerdict = 'fail'; } catch { deployableVerdict = 'fail'; } }
        const meta = { ...(r.meta ?? {}), delivered, schemaValid, deployableVerdict, ...(kind !== 'session' && attemptOf ? { callSeq: seq } : {}) };
        if (selfCheck) {
          const sc = delivered ? await selfCheck.run({ checkPath: selfCheck.checkPath, task: a.task, output: out, workdir: a.workdir }) : null;
          // A crashing or timed-out check did not say "pass": it withholds the answer like a failing one (detail kept).
          meta.selfVerdict = !sc ? null : sc.selfVerdict === 'error' ? 'fail' : sc.selfVerdict ?? null;
          meta.selfCheck = sc ? { verdict: sc.selfVerdict ?? null, exitCode: sc.exitCode ?? null, error: sc.error?.code ?? null } : null;
          if (sc && sc.selfVerdict == null && sc.error) {
            const code = SELF_CHECK_ENV(sc.error.code);
            meta.errors = { ...(meta.errors ?? {}), [code]: (meta.errors?.[code] ?? 0) + 1 };
          }
        }
        r = { ...r, meta };
        envFault = metEnvFault(r);
        return r;
      } finally {
        m ??= meterOf({ kind, priceTable: stages.priceTable, model, bound, r: null, calls: [] });
        budget.settle(tok, m.charged, { job, arm: arm.id, task: a.taskKey, trial: a.trial, reported: m.reported, repriced: m.measured, imputed: m.imputed,
          unknown: m.unknown, error: thrown ? (thrown.code ?? 'ARM_ERROR') : r?.error?.code ?? null, envFault });
      }
    },
  };
}
const schemaTestOf = fam => { try { return compileDataSchema(fam.outputSchema, { trustedSchema: true }); } catch { return null; } };

// ---------------------------------------------------------------------------------------------------------------------
// Ports. Live: the journaled ModelPort (session models only), runClaudeCode, b1Script, the sandboxed self-check.

export function livePorts({ live, models }) {
  const { port, db } = createModelPort({ journalFile: path.join(live, 'journal.sqlite'), allowedModels: models, maxBudgetUsdPerCall: 1 });
  let open = true;
  return { kind: 'live', model: port, executor: undefined, script: opts => b1Script(opts), selfCheck: runSelfCheck, kitBase: undefined, close: () => { if (open) { open = false; db.close(); } } };
}

/**
 * Stub ports for --dry and tests ($0, deterministic, order-free). The model port, the session executor (builder and agent
 * sessions), the script runner and the self-check answer from a table of the planned tasks: a correct answer
 * (referenceSolve), a wrong one (a bed bad control), none, a timeout or a killed session, chosen by a hash of the call's
 * own key (run id, workdir tail), never by call order. The outcomes are fake; only the harness around them is real.
 * `force` overrides an outcome by key substring (tests): { builder: {labelPart: 'fail'|'nested'|'hidden'|'ok'|'killed'|'envfault'|'nocheck'},
 * call: {runIdPart: 'right'|'wrong'|'schema'|'timeout'|'ratelimit'}, writer: {runIdPart: 'envfault'|'timeout'}, agent: {workdirPart: 'right'|'wrong'|
 * 'none'|'killed'|'nested'|'hidden'|'mention'|'envfault'}, script: {...}, selfcheck: {workdirPart: 'sandbox'|'launch'} }.
 */
export function stubPorts({ tasks, models, force = {} }) {
  const owner = loadPolicy(), policy = subsetPolicy(owner.policy, models), hash = policyHash(policy);
  const byPrompt = new Map(), byInputs = new Map(), byTask = new Map();
  for (const t of tasks) { byPrompt.set(sha16(inlineRender(t.task)), t); byInputs.set(sha16(JSON.stringify(t.task.inputs ?? {}, null, 2)), t); byTask.set(sha16(canonical(t.task)), t); }
  const list = (m, u) => ((u.inputTokens + 0.1 * u.cacheReadTokens + 1.25 * u.cacheWriteTokens) * (m?.price?.inputPerMTok ?? 0) + u.outputTokens * (m?.price?.outputPerMTok ?? 0)) / 1e6;
  const forced = (kind, key) => Object.entries(force[kind] ?? {}).find(([k]) => key.includes(k))?.[1];
  const answer = async (t, pick) => {
    const fam = await loadFamily(t.familyId);
    if (pick === 'right') return fam.referenceSolve(t.task);
    if (pick === 'wrong') return (fam.badControls.find(c => c.name === 'shuffled-or-corrupted') ?? fam.badControls[0]).make(t.task);
    return null;
  };
  const isRight = async (t, out) => canonical(out) === canonical((await loadFamily(t.familyId)).referenceSolve(t.task));
  const model = {
    policy, policyHash: hash, providers: { 'claude-cli': { maxBudgetUsd: 1 } }, journal: null, timeoutMs: 300000,
    async call(req) {
      const entry = policy.models.find(m => m.id === req.modelId);
      if (!entry) throw Object.assign(new Error(`model ${req.modelId} is not in the session policy`), { code: 'MODEL_NOT_IN_POLICY' });
      const h = fnv(`${req.runId}|${req.nodeKey}|${req.salt ?? ''}`);
      const usage = { inputTokens: Math.ceil((req.system.length + req.prompt.length) / CHARS_PER_TOKEN), outputTokens: 150 + (h % 400), cacheReadTokens: 0, cacheWriteTokens: 0 };
      const base = { usage, costUsd: list(entry, usage), imputedUsd: 0, latencyMs: 800 + (h % 700), modelId: entry.id, provider: 'stub' };
      if (req.nodeKey === 'procedure-writer') {
        const w = forced('writer', req.runId);
        if (w === 'envfault') return { ...base, usage: zeroUsage(), costUsd: 0, ok: false, error: { code: 'MODEL_RATE_LIMIT', message: 'stub rate limit' } };
        if (w === 'timeout') return { ...base, usage: zeroUsage(), costUsd: 0, ok: false, error: { code: 'MODEL_TIMEOUT', message: 'stub timeout' }, costUnknown: true, costUpperUsd: 1 };
        return { ...base, ok: true, value: { procedure: `Stub procedure (label-run --dry, ${h % 97}). Read the task text, follow its rules step by step, and assemble the answer to match the schema.`,
          checks: ['The answer matches the output schema.', 'Every rule stated in the task text is applied.'] } };
      }
      const t = byPrompt.get(sha16(req.prompt));
      const pick = forced('call', req.runId) ?? (h % 40 === 0 ? 'timeout' : h % 20 < 3 ? 'schema' : h % 20 < 7 ? 'wrong' : 'right');
      if (pick === 'timeout') return { ...base, usage: zeroUsage(), costUsd: 0, ok: false, error: { code: 'MODEL_TIMEOUT', message: 'stub timeout' }, costUnknown: true, costUpperUsd: 1 };
      if (pick === 'ratelimit') return { ...base, ok: false, error: { code: 'MODEL_RATE_LIMIT', message: 'stub rate limit' } };   // billed: the tokens of the attempt
      if (!t) return { ...base, ok: true, value: {} };   // a script's own gateway call
      if (pick === 'schema') return { ...base, ok: false, error: { code: 'MODEL_SCHEMA', message: 'stub schema-invalid output' } };
      return { ...base, ok: true, value: await answer(t, pick) };
    },
  };
  const transcript = (workdir, mdl, n, h, toolUses) => {
    const lines = [{ type: 'system', subtype: 'init', session_id: `stub-${h}` }];
    for (let i = 0; i < n; i++) lines.push({ type: 'assistant', message: { id: `msg_${i}`, model: mdl, content: i < toolUses.length ? [{ type: 'tool_use', name: toolUses[i].name, input: toolUses[i].input }] : [{ type: 'text', text: 'stub' }],
      usage: { input_tokens: 400 + ((h >> i) % 300), output_tokens: 120 + ((h >> (i + 3)) % 200), cache_read_input_tokens: 2000 * i, cache_creation_input_tokens: i === 0 ? 3000 : 300 } } });
    const file = path.join(workdir, '.executor-transcript.jsonl');
    writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    const u = zeroUsage();
    for (const l of lines.filter(x => x.type === 'assistant')) {
      const x = l.message.usage;
      addUsage(u, { inputTokens: x.input_tokens, outputTokens: x.output_tokens, cacheReadTokens: x.cache_read_input_tokens, cacheWriteTokens: x.cache_creation_input_tokens });
    }
    return { file, usage: u };
  };
  const executor = async ({ model: mdl, prompt, workdir, files = {}, budgetUsd = 1 }) => {
    materialize(workdir, files);
    const entry = policy.models.find(m => m.id === mdl) ?? owner.policy.models.find(m => m.id === mdl);
    const builder = prompt.startsWith('You are building a reusable solver');
    // Keys never include the work root, so two --dry runs in different directories draw the same outcomes.
    const key = builder ? path.basename(workdir) : workdir.split(path.sep).slice(-3).join('/'), h = fnv(`${mdl}|${key}`);
    if (builder) {
      const pick = forced('builder', key) ?? (h % 9 === 0 ? 'fail' : h % 9 === 1 ? 'nested' : 'ok');
      if (pick === 'envfault') {   // rate-limited after it had spent: the session's tokens are real dollars
        const tr = transcript(workdir, mdl, 3, h, []);
        return { ok: false, error: { code: 'MODEL_RATE_LIMIT' }, costUsd: list(entry, tr.usage), costUnknown: false, costUpperUsd: list(entry, tr.usage), streamUsage: tr.usage, turns: null, usage: null,
          toolUses: [], sessionId: null, durationMs: 1000, transcript: tr.file };
      }
      const toolUses = [{ name: 'Bash', input: { command: './tools/run-solver probes/probe-0 > a.json' } }, { name: 'Bash', input: { command: './tools/run-solver probes/probe-1' } }];
      if (pick === 'nested') toolUses.push({ name: 'Bash', input: { command: 'claude -p "solve it"' } });
      if (pick === 'hidden') toolUses.push({ name: 'Bash', input: { command: 'ls /home/user/workflow-foundry/beds' } });
      if (pick !== 'fail') {
        writeFileSync(path.join(workdir, 'solve.mjs'), `// stub solver (label-run --dry) for ${key}\nprocess.stdout.write('null\\n');\n`);
        if (prompt.includes(SELF_CHECK_FILE) && pick !== 'nocheck') writeFileSync(path.join(workdir, SELF_CHECK_FILE), '// stub self-check (label-run --dry)\nprocess.exit(0);\n');
        writeFileSync(path.join(workdir, 'BUILD-NOTES.md'), 'stub build (label-run --dry)\n');
      }
      const tr = transcript(workdir, mdl, 6, h, toolUses), killed = pick === 'killed';   // killed: a session cut at its timeout (solver left behind)
      return { ok: !killed, error: killed ? { code: 'EXECUTOR_TIMEOUT' } : null, costUsd: killed ? null : list(entry, tr.usage), costUnknown: killed, costUpperUsd: killed ? budgetUsd : list(entry, tr.usage),
        streamUsage: tr.usage, turns: killed ? null : 6, usage: null, toolUses, sessionId: `stub-${h}`, durationMs: 60000 + (h % 60000), transcript: tr.file };
    }
    const t = byInputs.get(sha16(files['inputs.json'] ?? ''));
    const pick = forced('agent', key) ?? (h % 40 === 0 ? 'killed' : h % 40 === 1 ? 'nested' : h % 20 < 6 ? 'wrong' : h % 20 === 6 ? 'none' : 'right');
    const toolUses = [{ name: 'Read', input: { file_path: 'inputs.json' } }];
    if (pick === 'nested') toolUses.push({ name: 'Bash', input: { command: 'claude -p "help"' } });
    if (pick === 'hidden') toolUses.push({ name: 'Read', input: { file_path: '/home/user/workflow-foundry/beds/records/score.mjs' } });
    // mention: host paths in data only (answer content, a Grep pattern, a heredoc body), as incident and ownerci answers have.
    if (pick === 'mention') toolUses.push({ name: 'Write', input: { file_path: 'answer.json', content: '{"root_cause_volume":"/var/lib/postgresql/data"}' } },
      { name: 'Grep', input: { pattern: '/var/log', path: 'files' } }, { name: 'Bash', input: { command: "cat > notes.txt <<'EOF'\nbackups go to /var/lib/backup and /srv/objects\nEOF" } });
    if (pick === 'envfault') {   // the session died on an environment fault after it had spent
      const tr = transcript(workdir, mdl, 3, h, toolUses);
      return { ok: false, error: { code: 'EXECUTOR_PROTOCOL' }, costUsd: list(entry, tr.usage), costUnknown: false, costUpperUsd: list(entry, tr.usage), streamUsage: tr.usage, turns: null, usage: null,
        toolUses, sessionId: `stub-${h}`, durationMs: 1000, transcript: tr.file };
    }
    const out = t && pick !== 'killed' && pick !== 'none' ? await answer(t, ['nested', 'hidden', 'mention'].includes(pick) ? 'right' : pick) : null;
    if (out != null) writeFileSync(path.join(workdir, 'answer.json'), JSON.stringify(out));
    if (files['PROCEDURE.md'] != null && out != null) {
      const right = await isRight(t, out);
      writeFileSync(path.join(workdir, 'checks.json'), JSON.stringify([{ check: 'schema', pass: true }, { check: 'rules', pass: right ? h % 11 !== 0 : h % 4 === 0 }]));
    }
    const tr = transcript(workdir, mdl, pick === 'killed' ? 2 : 4, h, toolUses);
    const killed = pick === 'killed';
    return { ok: !killed, error: killed ? { code: 'EXECUTOR_TIMEOUT' } : null, costUsd: killed ? null : list(entry, tr.usage), costUnknown: killed, costUpperUsd: killed ? budgetUsd : list(entry, tr.usage),
      streamUsage: tr.usage, turns: killed ? null : 4, usage: null, toolUses, sessionId: `stub-${h}`, durationMs: 30000 + (h % 30000), transcript: tr.file };
  };
  const script = ({ id, scriptPath, modelPort, perTaskUsd = 1 }) => ({
    id, stateful: false, def: { kind: 'b1-script', stub: true, scriptSha: sha16(readFileSync(scriptPath, 'utf8')), perTaskUsd },
    async run({ task, taskKey, trial, workdir }) {
      const h = fnv(`${id}|${taskKey}|${trial}`), t = { familyId: taskKey.split(':')[0], task };
      for (const [rel, c] of Object.entries(taskFiles(task))) { mkdirSync(path.dirname(path.join(workdir, rel)), { recursive: true }); writeFileSync(path.join(workdir, rel), c); }
      const r = await modelPort.call({ runId: `${id}:${taskKey}:t${trial}:stub`, nodeKey: 'gateway/solve/0', modelId: models[0], system: '', prompt: `stub ${taskKey}`, schema: { type: 'object' } });
      const pick = forced('script', `${id}|${taskKey}|${trial}`) ?? (h % 10 < 6 ? 'right' : h % 10 < 8 ? 'wrong' : 'none');
      const output = await answer(t, pick);
      return { output, costUsd: r.costUsd ?? 0, imputedUsd: 0, costUnknown: !!r.costUnknown, latencyMs: 2000 + (h % 1000), error: output == null ? { code: 'SCRIPT_OUTPUT' } : null,
        meta: { calls: 1, errors: {}, refusals: {}, unknownCalls: r.costUnknown ? 1 : 0 } };
    },
  });
  const selfCheck = async ({ task, output, workdir }) => {
    if (output == null) return { selfVerdict: null };
    const key = workdir.split(path.sep).slice(-2).join('/'), h = fnv(key), sc = forced('selfcheck', key);
    if (sc === 'sandbox') return { selfVerdict: null, error: { code: 'SANDBOX_UNAVAILABLE', message: 'stub: no user namespaces' } };
    if (sc === 'launch') return { selfVerdict: null, error: { code: 'SELF_CHECK_LAUNCH', message: 'stub: launch failed' } };
    const t = byTask.get(sha16(canonical(task)));
    if (!t) return { selfVerdict: 'error', exitCode: null };
    const right = await isRight(t, output);
    return { selfVerdict: right ? (h % 9 === 0 ? 'fail' : 'pass') : h % 4 === 0 ? 'pass' : 'fail', exitCode: null };
  };
  return { kind: 'stub', model, executor, script, selfCheck, kitBase: null, close: () => {} };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rows

/** The runtime arm id of a mode and lineage (lineage modes: `construct-H#2`), and back. */
export const runArmId = (mode, k = null) => (k == null ? mode : `${mode}#${k}`);
export function parseArmId(id) { const m = /^(.*)#(\d+)$/.exec(id); return m ? { mode: m[1], lineage: Number(m[2]) } : { mode: id, lineage: null }; }

/** A runner record as a needTable matrix row (one meter: usdRepriced measured + usdImputed). */
export function matrixRow(rec, { stage, job, armDef, priceTable, book, taskInfo, meter = null }) {
  const { mode, lineage } = parseArmId(rec.arm), meta = rec.meta ?? {};
  const factory = armDef.run?.factory ?? armDef.factory;
  let cost;
  // The recorded attempt's own calls (meta.callSeq); rows written before callSeq existed fall back to every call of the run id.
  const seq = Array.isArray(meta.callSeq) ? meta.callSeq : null;
  if (factory === 'b0Call') {
    const exact = `${rec.arm}:${rec.taskKey}:t${rec.trial}`;
    cost = priceCalls(priceTable, seq ? book.attempt({ exact, seq }) : book.exact(exact), { boundUsd: armDef.timeoutChargeUsd ?? 1 });
  } else if (factory === 'b1Script') {
    const prefix = `${rec.arm}:${rec.taskKey}:t${rec.trial}:`;
    cost = priceCalls(priceTable, seq ? book.attempt({ prefix, seq }) : book.latest(prefix));
  }
  else {
    const model = armDef.run?.model ?? armDef.model;
    cost = priceSession(priceTable, model, { messageUsage: meta.messageUsage, streamUsage: meta.streamUsage, costUnknown: !!rec.costUnknown, boundUsd: meta.costUpperUsd ?? rec.costUsd ?? 0, reportedUsd: rec.costUsd,
      finalUsage: meta.finalUsage ?? null, meter });
  }
  const delivered = typeof meta.delivered === 'boolean' ? meta.delivered : rec.oracleDetails !== '{"noOutput":true}';
  const voidReasons = [];
  // An agent draw is its own lineage of one: the lineage void rule applies to it (lineage modes are voided by build row).
  if (lineage == null && (meta.nestedModelAttempts ?? 0) > 0) voidReasons.push(`nestedModelAttempts=${meta.nestedModelAttempts}`);
  if (lineage == null && (meta.hiddenPathAttempts ?? 0) > 0) voidReasons.push(`hiddenPathAttempts=${meta.hiddenPathAttempts}`);
  const voided = voidReasons.length > 0;
  return {
    schema: ROW_SCHEMA, stage, job: job.id, cluster: job.cluster, split: job.split, family: job.family, mode, arm: rec.arm, armHash: rec.armHash,
    rep: lineage == null ? rec.trial : lineage - 1, lineage, task: rec.taskKey, seed: taskInfo?.seed ?? null, difficulty: taskInfo?.difficulty ?? null,
    ...(taskInfo?.stage ? { kind: taskInfo.stage } : {}), taskHash: rec.taskHash ?? null,
    pass: voided ? false : !!rec.pass, rawPass: !!rec.pass, score: rec.score ?? null, delivered: voided ? false : delivered,
    schemaValid: meta.schemaValid ?? null, selfVerdict: meta.selfVerdict ?? null, deployableVerdict: meta.deployableVerdict ?? null,
    ...(meta.selfCheck?.error ? { selfCheckError: meta.selfCheck.error } : {}),
    usdReported: r6((rec.costUsd ?? 0) + (rec.imputedUsd ?? 0)), usdRepriced: r6(cost.measured), usdImputed: r6(cost.imputed), repriced: cost.repriced !== false && !cost.fallback,
    ...(cost.meterUnverified ? { meterUnverified: true } : {}), ...(cost.outputFromFinal ? { outputFromFinal: true } : {}),
    ms: rec.latencyMs ?? null, tokens: cost.tokens, turns: meta.turns ?? null, error: voided ? 'VOIDED' : rec.error?.code ?? null, rawError: rec.error?.code ?? null,
    void: voided ? voidReasons.join('; ') : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Builds

const buildKey = (job, mode, k) => `${job}|${mode}|${k}`;
const buildVoided = b => !!b.void || (b.hiddenPathAttempts ?? 0) > 0 || (b.nestedModelAttempts ?? 0) > 0;

/** The version stamp of a build, probe or racing record (mode null: racing). A resume over a record whose stamp differs
 *  is refused: it was made under other arm settings, prompts, prices or plan. */
export function recordStamp(ctx, mode = null) {
  const def = mode ? ctx.stages.arms?.[mode] : null;
  return { stageSha: ctx.stageSha, settingsSha: mode ? (def ? armSha(def) : null) : null, prompts: ctx.prompts, priceTable: ctx.stages.priceTable?.id ?? null };
}
const sameStamp = (a, b) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

async function buildLineage({ ctx, unit, mode, k, examples }) {
  const { stages, stage, live, book, budget, ports } = ctx, job = unit.job, def = stages.arms[mode], b = def.build;
  const label = `${stage.id}.${job.id}.${mode}-L${k}`, dir = path.join(live, 'builds', label);
  const setNo = Number(Object.entries(stages.seeds.exampleSets).find(([, s]) => String(s) === String(exampleSet(stages, k)))?.[0] ?? 0);
  const probeSeeds = examples.map(t => ({ seed: t.seed, difficulty: t.difficulty, ...(t.stage ? { stage: t.stage } : {}) }));
  const head = { schema: 'need-build-row/1', stage: stage.id, job: job.id, mode, rep: k - 1, lineage: k, exampleSet: setNo, probeSeeds, stamp: recordStamp(ctx, mode) };
  const key = buildKey(job.id, mode, k);
  if (b.factory === 'procedureWriter') {
    const bound = 1, runId = `procedure:${label}`;
    const tok = budget.reserve(bound, { kind: 'build', key, job: job.id, mode, lineage: k });
    if (!tok) return { capped: true };
    const fam = await loadFamily(job.family), seq0 = book.seq;
    let w, m = null;
    try { w = await writeProcedure({ port: ctx.metered(), model: b.model, reasoning: b.reasoning, examples, outputSchema: fam.outputSchema, runId, file: path.join(dir, 'PROCEDURE.md') }); }
    finally {
      // One gateway call on the meter: a timed-out or unobserved writer call costs its $1 bound, never $0.
      m = meterOf({ kind: 'call', priceTable: stages.priceTable, bound, r: w ? { costUsd: w.costUsd ?? 0, error: w.ok ? null : { code: w.error } } : null, calls: book.attempt({ exact: runId, seq: [seq0, book.seq] }) });
      budget.settle(tok, m.charged, { job: job.id, mode, lineage: k, reported: m.reported, repriced: m.measured, imputed: m.imputed, unknown: m.unknown, error: w?.ok ? null : w?.error ?? 'ARM_ERROR',
        envFault: !!w && !w.ok && BUILD_ENV_FAULTS.has(w.error) });
    }
    // An environment fault on the writer call is not an outcome (as for a construction): kept aside, retried on resume, K4.
    if (!w.ok && BUILD_ENV_FAULTS.has(w.error)) return { fault: { stage: stage.id, job: job.id, mode, lineage: k, factory: 'procedureWriter', error: { code: w.error }, costUsd: w.costUsd ?? 0,
      usdReported: r6(m.reported), usdRepriced: r6(m.measured), usdImputed: r6(m.imputed), stamp: head.stamp } };
    return { row: { ...head, factory: 'procedureWriter', model: b.model, usdReported: r6(w.costUsd ?? 0), usdRepriced: r6(m.measured), usdImputed: r6(m.imputed), usd: r6(m.measured), tokens: m.tokens,
      minutes: null, artifactSha: w.ok ? w.sha : null, artifactPath: w.ok ? w.file : null, failed: !w.ok, error: w.ok ? null : w.error, runSolverCalls: null,
      hiddenPathAttempts: 0, nestedModelAttempts: 0, words: w.words ?? null, truncatedWords: w.truncatedWords ?? null, checks: w.checks ?? null, promptSha: w.promptSha, void: null } };
  }
  if (b.factory !== 'construct') throw new Error(`${mode}: unknown build factory ${b.factory}`);
  const bound = b.builderBudgetUsd + b.constructionModelUsd;
  const tok = budget.reserve(bound, { kind: 'build', key, job: job.id, mode, lineage: k });
  if (!tok) return { capped: true };
  let res, cost = null;
  try {
    res = await construct({ arm: b.arm, armId: runArmId(mode, k), familyId: job.family, probeSeeds, builderModel: b.builderModel, builderEffort: b.builderEffort,
      builderBudgetUsd: b.builderBudgetUsd, constructionModelUsd: b.constructionModelUsd, perTaskUsd: b.perTaskUsd, minutes: b.minutes, scoreChecks: b.scoreChecks,
      modelPort: ctx.metered(), workRoot: path.dirname(dir), label, models: b.models, selfCheck: !!b.selfCheck, executor: ports.executor, kitBase: ports.kitBase ?? undefined });
    cost = buildCost(stages, b, res.record, book, label, ctx.meter ?? null);
  } finally {
    const charged = cost ? cost.charged : bound;   // construct() threw after the builder may have started: its bound
    budget.settle(tok, charged, { job: job.id, mode, lineage: k, reported: cost?.reported ?? null, repriced: cost?.measured ?? 0, imputed: cost ? cost.imputed : bound,
      unknown: !cost, error: res?.record?.builderError?.code ?? (res ? null : 'ARM_ERROR'), envFault: !!res && BUILD_ENV_FAULTS.has(res.record.builderError?.code) });
  }
  const rec = res.record;
  if (rec.builderError && BUILD_ENV_FAULTS.has(rec.builderError.code)) return { fault: { stage: stage.id, job: job.id, mode, lineage: k, factory: 'construct', error: rec.builderError, costUsd: rec.constructionCostUsd,
    usdReported: r6(cost.reported), usdRepriced: r6(cost.measured), usdImputed: r6(cost.imputed), stamp: head.stamp } };
  const reasons = [];
  let copied = null;
  if (job.family === 'ownerci' && res.artifactPath) {
    copied = copiedExampleLines(readFileSync(res.artifactPath, 'utf8'), examples);
    if (copied > COPY_SCAN.maxLines) reasons.push(`ownerci copy scan: ${copied} example lines in solve.mjs (AUDIT F10)`);
  }
  // hiddenPathAttempts is construct()'s accessed-path scan (hiddenPathAccesses; probe-stated paths ignored): it voids. Its
  // text scan of every tool-input string (hiddenPathAttempts there) is kept for review by hand as pathMentions.
  const hidden = rec.hiddenPathAccesses ?? rec.hiddenPathAttempts;
  return { row: { ...head, factory: 'construct', model: b.builderModel, usdReported: r6(rec.constructionCostUsd), usdRepriced: r6(cost.measured), usdImputed: r6(cost.imputed),
    usd: r6(cost.measured), tokens: cost.tokens, minutes: r6(rec.durationMs / 60000), artifactSha: rec.artifactSha256, artifactPath: res.artifactPath, failed: !res.artifactPath,
    error: rec.builderError?.code ?? null, runSolverCalls: rec.runSolverCalls, hiddenPathAttempts: hidden, nestedModelAttempts: rec.nestedModelAttempts,
    outsidePaths: (rec.accessedOutsidePaths ?? rec.outsidePaths ?? []).slice(0, 10), pathMentions: rec.hiddenPathAttempts ?? null, mentionedPaths: (rec.outsidePaths ?? []).slice(0, 10),
    selfCheck: rec.selfCheck, checkPath: res.checkPath, checkSha256: rec.checkSha256, builderPromptSha256: rec.promptSha256 ?? null, copiedExampleLines: copied,
    constructionJson: path.join(dir, 'construction.json'), void: reasons.length ? reasons.join('; ') : null } };
}

/** A construction on the meter: the builder session re-priced from its messages (its budget bound when killed) plus its
 *  gateway calls; reported = construct()'s own constructionCostUsd. */
function buildCost(stages, b, rec, book, label, meter = null) {
  const builder = priceSession(stages.priceTable, b.builderModel, { messageUsage: rec.builderMessageUsage, streamUsage: rec.builderStreamUsage, costUnknown: rec.builderCostUnknown,
    boundUsd: b.builderBudgetUsd, reportedUsd: rec.builderCostReportedUsd ?? 0, finalUsage: rec.builderUsage ?? null, meter });
  const gw = priceCalls(stages.priceTable, book.latest(`construct:${label}:`));
  const reported = rec.constructionCostUsd ?? 0, measured = builder.measured + gw.measured, imputed = builder.imputed + gw.imputed;
  return { reported, measured, imputed, tokens: addUsage(addUsage(zeroUsage(), builder.tokens), gw.tokens), charged: Math.max(reported, measured + imputed) };
}

// ---------------------------------------------------------------------------------------------------------------------
// The run

function runArmsFor({ ctx, unit, fam, schemaTest, mode, k = null, build = null }) {
  const { stages, ports } = ctx, def = stages.arms[mode], job = unit.job, id = runArmId(mode, k), sig = { ctx, job: job.id, schemaTest, fam };
  if (def.factory === 'b0Call') {
    return withSignals(b0Call({ id, model: def.model, modelPort: ctx.metered({ timeoutMs: def.providerTimeoutMs ?? null }), reasoning: def.reasoning, maxTokens: def.maxTokens }),
      { ...sig, kind: 'call', bound: def.maxBudgetUsdPerCall ?? 1, attemptOf: a => ({ exact: `${id}:${a.taskKey}:t${a.trial}` }) });
  }
  if (def.factory === 'b0Agent') {
    const budgetUsd = mode === 'agent-O' ? job.agentOBudgetUsd ?? def.budgetUsd : def.budgetUsd;
    return withSignals(b0Agent({ id, model: def.model, budgetUsd, timeoutMs: def.timeoutMs, ...(ports.executor ? { executor: ports.executor } : {}) }), { ...sig, kind: 'session', model: def.model, bound: budgetUsd });
  }
  if (def.build?.factory === 'procedureWriter') {
    return withSignals(b0Agent({ id, model: def.run.model, budgetUsd: def.run.budgetUsd, timeoutMs: def.run.timeoutMs, procedureFile: build.artifactPath, ...(ports.executor ? { executor: ports.executor } : {}) }),
      { ...sig, kind: 'session', model: def.run.model, bound: def.run.budgetUsd });
  }
  if (def.build?.factory === 'construct') {
    const arm = ports.script({ id, scriptPath: build.artifactPath, modelPort: ctx.metered(), perTaskUsd: def.run.perTaskUsd });
    const selfCheck = build.checkPath ? { checkPath: build.checkPath, sha: sha16(readFileSync(build.checkPath, 'utf8')), run: ports.selfCheck } : null;
    return withSignals(arm, { ...sig, kind: 'script', bound: def.run.perTaskUsd, selfCheck, attemptOf: a => ({ prefix: `${id}:${a.taskKey}:t${a.trial}:` }) });
  }
  throw new Error(`${mode}: no runner for factory ${def.factory ?? def.build?.factory}`);
}

const replicatesOf = def => def.replicates ?? def.replicatesPerLineage ?? 1;

async function runGroups({ ctx, unit, plan, groups }) {
  // groups: [{ arms: [arm objects], trials, tasks? }]
  for (const g of groups) {
    if (!g.arms.length) continue;
    const tasks = (g.tasks ?? plan.evalTasks).map(t => ({ familyId: t.familyId, task: t.task, taskKey: t.taskKey, taskHash: t.taskHash }));
    await runExperiment({ experiment: `${ctx.stage.id}.${unit.job.id}`, arms: g.arms, tasks, trials: g.trials, workRoot: path.join(ctx.live, 'work'), resultsFile: ctx.resultsFile,
      concurrency: ctx.concurrency, log: ctx.log, envFaultRule: true, strictResume: true });
  }
}

async function ensureBuilds({ ctx, unit, plan, want }) {
  // want: [{mode, k}]; returns the build rows available (existing or new), in order; capped and faulted ones are absent.
  const out = [];
  for (const { mode, k } of want) {
    const key = buildKey(unit.job.id, mode, k);
    let row = ctx.builds.get(key);
    if (row && !sameStamp(row.stamp, recordStamp(ctx, mode))) throw new Error(`resume would mix build versions: ${key} was built under another plan, arm settings, prompts or prices; use a new work root and --out`);
    if (!row) {
      if (!plan.examples[k]) plan.examples[k] = (await planJob(ctx.stages, { ...unit, evalRole: null }, { ledger: ctx.ledger, examplesNeeded: [k] })).examples[k];
      const r = await buildLineage({ ctx, unit, mode, k, examples: plan.examples[k] });
      if (r.capped) { ctx.notRun.push({ job: unit.job.id, mode, lineage: k, why: 'STAGE_CAP' }); continue; }
      if (r.fault) { appendFileSync(path.join(ctx.live, 'construction-faults.jsonl'), JSON.stringify(r.fault) + '\n'); continue; }
      row = r.row; ctx.builds.set(key, row); appendFileSync(ctx.buildsFile, JSON.stringify(row) + '\n');
    }
    out.push(row);
  }
  return out;
}

async function runProbes({ ctx, unit, plan }) {
  const job = unit.job, fam = await loadFamily(job.family), schemaTest = schemaTestOf(fam), t = plan.probeTask;
  const draws = { 'direct-H': 2, 'agent-H': 1 };   // NR-probe: k <= 2 direct-H draws, one agent-H run, on the probe example
  for (const mode of unit.probeArms) {
    const def = ctx.stages.arms[mode];
    for (let d = 0; d < (draws[mode] ?? 1); d++) {
      const key = `${job.id}|${mode}|${d}`;
      if (ctx.probes.has(key)) continue;
      const id = `probe/${mode}`, call = def.factory === 'b0Call';
      const inner = call
        ? b0Call({ id, model: def.model, modelPort: ctx.metered({ timeoutMs: def.providerTimeoutMs ?? null }), reasoning: def.reasoning, maxTokens: def.maxTokens })
        : b0Agent({ id, model: def.model, budgetUsd: def.budgetUsd, timeoutMs: def.timeoutMs, ...(ctx.ports.executor ? { executor: ctx.ports.executor } : {}) });
      const bound = call ? def.maxBudgetUsdPerCall ?? 1 : def.budgetUsd;
      const arm = withSignals(inner, { ctx, job: job.id, kind: call ? 'call' : 'session', model: def.model, bound, schemaTest, fam, ledgerKind: 'probe',
        attemptOf: call ? a => ({ exact: `${id}:${a.taskKey}:t${a.trial}` }) : null });
      const workdir = path.join(ctx.live, 'work', `${ctx.stage.id}.${job.id}.probe`, mode, `${t.taskKey.replaceAll(':', '_')}_t${d}`);
      rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
      let r;
      try { r = await arm.run({ task: t.task, familyId: t.familyId, taskKey: t.taskKey, trial: d, outputSchema: fam.outputSchema, workdir, state: {} }); }
      catch (e) {
        if (e.code === 'STAGE_CAP') { ctx.notRun.push({ job: job.id, mode, probe: d, why: 'STAGE_CAP' }); continue; }
        r = { output: null, costUsd: 0, error: { code: e.code ?? 'ARM_ERROR', message: String(e.message).slice(0, 300) }, meta: { delivered: false } };
      }
      const rec = { arm: id, taskKey: t.taskKey, trial: d, costUsd: r.costUsd ?? 0, imputedUsd: r.imputedUsd ?? 0, costUnknown: !!r.costUnknown, meta: r.meta, error: r.error };
      const seq = r.meta?.callSeq;
      const cost = call ? priceCalls(ctx.stages.priceTable, seq ? ctx.book.attempt({ exact: `${id}:${t.taskKey}:t${d}`, seq }) : ctx.book.exact(`${id}:${t.taskKey}:t${d}`), { boundUsd: def.timeoutChargeUsd ?? 1 })
        : priceSession(ctx.stages.priceTable, def.model, { messageUsage: r.meta?.messageUsage, streamUsage: r.meta?.streamUsage, costUnknown: !!r.costUnknown, boundUsd: def.budgetUsd, reportedUsd: r.costUsd ?? 0, finalUsage: r.meta?.finalUsage ?? null, meter: ctx.meter ?? null });
      const row = { schema: 'need-probe-row/1', stage: ctx.stage.id, job: job.id, mode, draw: d, seed: t.seed, difficulty: t.difficulty, task: t.taskKey, taskHash: t.taskHash,
        delivered: !!r.meta?.delivered, schemaValid: r.meta?.schemaValid ?? null, deployableVerdict: r.meta?.deployableVerdict ?? null,
        outputHash: r.output != null ? sha16(canonical(r.output)) : null, turns: r.meta?.turns ?? null, usdReported: r6(chargeOf(rec, 0)), usdRepriced: r6(cost.measured), usdImputed: r6(cost.imputed),
        tokens: cost.tokens, error: r.error?.code ?? null, nestedModelAttempts: r.meta?.nestedModelAttempts ?? 0, hiddenPathAttempts: r.meta?.hiddenPathAttempts ?? 0,
        armHash: armHash(inner), stamp: recordStamp(ctx, mode) };
      ctx.probes.set(key, row); appendFileSync(ctx.probesFile, JSON.stringify(row) + '\n');
    }
  }
}

// K2 (PREREG §11): direct-H on the wbed-r0 negative control must pass >= 10/12 on each draw (NL0), else the stage stops.
export const R0_CONTROL = Object.freeze({ job: 'wbed-r0', mode: 'direct-H', minPass: 10, of: 12 });
export function r0Gate(rows, jobId) {
  if (jobId !== R0_CONTROL.job) return null;
  const d = rows.filter(r => r.mode === R0_CONTROL.mode);
  if (!d.length) return null;
  const reps = [...new Set(d.map(r => r.rep))].sort((a, b) => a - b);
  const perDraw = reps.map(rep => { const x = d.filter(r => r.rep === rep); return `${x.filter(r => r.pass).length}/${x.length}`; });
  return { ok: reps.every(rep => d.filter(r => r.rep === rep && r.pass).length >= R0_CONTROL.minPass), perDraw };
}

/** The rows and builds of one job, in a stable order (task, mode, rep). */
function jobRows(ctx, unit, plan) {
  const exp = `${ctx.stage.id}.${unit.job.id}`, info = new Map(plan.evalTasks.map(t => [t.taskKey, t]));
  const recs = readJsonl(ctx.resultsFile).filter(r => r.experiment === exp);
  const rows = [], capped = [];
  for (const rec of recs) {
    const { mode } = parseArmId(rec.arm);
    if (rec.error?.code === 'STAGE_CAP') { capped.push(rec); continue; }
    rows.push(matrixRow(rec, { stage: ctx.stage.id, job: unit.job, armDef: ctx.stages.arms[mode], priceTable: ctx.stages.priceTable, book: ctx.book, taskInfo: info.get(rec.taskKey), meter: ctx.meter ?? null }));
  }
  rows.sort((a, b) => (a.task < b.task ? -1 : a.task > b.task ? 1 : a.mode < b.mode ? -1 : a.mode > b.mode ? 1 : a.rep - b.rep));
  const builds = [...ctx.builds.values()].filter(b => b.job === unit.job.id).sort((a, b) => (a.mode < b.mode ? -1 : a.mode > b.mode ? 1 : a.lineage - b.lineage));
  return { rows, builds, capped };
}

/** Lineage voids from the lineage's own runs (agent-H+proc sessions that tried a nested model or a hidden path). */
function runVoids(ctx, unit) {
  const exp = `${ctx.stage.id}.${unit.job.id}`, out = new Map();
  for (const rec of readJsonl(ctx.resultsFile).filter(r => r.experiment === exp)) {
    const { mode, lineage } = parseArmId(rec.arm);
    if (lineage == null) continue;
    const n = rec.meta?.nestedModelAttempts ?? 0, hp = rec.meta?.hiddenPathAttempts ?? 0;
    if (n > 0 || hp > 0) { const k = buildKey(unit.job.id, mode, lineage), v = out.get(k) ?? { nested: 0, hidden: 0 }; v.nested += n; v.hidden += hp; out.set(k, v); }
  }
  return out;
}
function withRunVoids(builds, voids, jobId) {
  return builds.map(b => {
    const v = voids.get(buildKey(jobId, b.mode, b.lineage));
    if (!v) return b;
    const why = `run sessions: nestedModelAttempts=${v.nested}, hiddenPathAttempts=${v.hidden}`;
    return { ...b, void: b.void ? `${b.void}; ${why}` : why };
  });
}

/** The table for one job (needTable), or the reason it cannot be built yet (unpaired: env faults, cap). */
function tableOf(rows, builds) {
  try { return { table: needTable(rows, builds.map(b => ({ ...b, usd: b.usdRepriced }))) }; } catch (e) { return { error: String(e.message).slice(0, 300) }; }
}

/** Racing top-ups (PREREG §4.3) for one job at the headline cell; returns {pBest, acceptable, draws: {mode: n}, lineages: {mode: K}, agentOTasks}. */
export function racingPlan({ table, job, stages, current, labelModes }) {
  const conf = stages.grid?.confident ?? 0.8, maxPer = stages.grid?.racingMaxPerMode ?? 4, delta = stages.grid?.delta ?? DELTA;
  const labels = needLabels(table, { cells: [HEADLINE], reps: stages.reps?.labelBootstrap ?? 2000, seed: stages.rng?.labelBootstrap ?? 1, modes: labelModes, delta });
  const e = labels.at(job, HEADLINE), p = e.pBest ? Math.max(e.pBest.workflow, e.pBest['no-workflow']) : 0;
  const plan = { pBest: e.pBest, label: e.label, acceptable: e.acceptable, add: {}, agentOTasks: [] };
  if (p < conf) for (const m of e.acceptable) if ((current[m] ?? 0) < maxPer) plan.add[m] = (current[m] ?? 0) + 1;
  // agent-O: a second draw where it is in the draw-1 per-task acceptable set (draw modes on rep 0, lineage modes averaged).
  if (table.has(job, 'agent-O') && (current['agent-O'] ?? 0) < 2) {
    const c = HEADLINE, ms = table.modesOf(job).filter(m => labelModes.includes(m));
    for (const t of table.taskIds(job)) {
      const u = new Map();
      for (const m of ms) {
        const cell = table.cell(job, m);
        if (cell.lineage) {
          const L = cell.lineageList, xs = L.map(l => cell.byTask.get(t).get(l.rep));
          const B = sum(L.map(l => l.usd + l.imputed)) / L.length;
          u.set(m, sum(xs.map(x => x.succ1 - x.cost / c.V - c.wOverV * x.wrong1)) / xs.length - B / (c.N * c.V));
        } else { const x = cell.byTask.get(t).get(0) ?? [...cell.byTask.get(t).values()][0]; u.set(m, x.succ1 - x.cost / c.V - c.wOverV * x.wrong1); }
      }
      const top = Math.max(...u.values());
      if (u.get('agent-O') >= top - delta - 1e-12 && (table.cell(job, 'agent-O').reps.get(t)?.length ?? 0) < 2) plan.agentOTasks.push(t);
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------------------------------
// Paid-run checks (DESIGN §7 M0 items 1 and 12; PREREG §4.4, §12, §13; L4/L7 held-out isolation through checkStages)

const gitBlobSha256 = file => {
  try {
    const rel = path.relative(REPO, path.resolve(file));
    if (rel.startsWith('..')) return null;
    return createHash('sha256').update(execFileSync('git', ['show', `HEAD:${rel}`], { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 })).digest('hex');
  } catch { return null; }
};
const sha256Hex = text => createHash('sha256').update(text).digest('hex');

/**
 * What a paid run (no --dry) must pass before anything is spent. Returns { errors, deviations, stamp }; the run is refused
 * on any error. deps (tests): { canonicalFile, preregFile, checkStagesFn, stampOf, frozenSha (file -> sha256 hex of its
 * frozen text, default: its committed HEAD blob), ledger, policy, meterGate (() -> D6's summary.meterGate or null), meterVerification (() -> the
 * verification record or null) }.
 *  - approval: the stage's approved flag (the owner's gate);
 *  - status: a frozen plan, or --allow-draft, which is recorded in report.deviations;
 *  - the plan: the canonical stages.json (same bytes), or a spec whose sha256 the preregistration text names (an addendum
 *    or a §13 deviation that lists it); its own approved/status fields never suffice;
 *  - prereg-check checkStages on the plan with the preregistration text: no error (held-out seeds before Freeze, TRAIN jobs
 *    on held-out seeds, held-out jobs on TRAIN seeds, envelopes, caps, ledger refusals, arm hashes, status agreement);
 *  - every arm the stage runs: settingsSha === armSha(definition);
 *  - the preregistration: the canonical file, equal to its frozen text (stages.json preregSha256 when the freeze records
 *    it, else the committed HEAD blob: no uncommitted edit);
 *  - the label-engine stamp (prereg-check stamp): a commit and no uncommitted change in the label engine;
 *  - the cost-meter gate (meter-gate.mjs; D6 of the M0 diagnostics): no stage with an agent arm while analysis/m0/diagnostics.json says
 *    block-until-verified and no passing meter-verification record is on file;
 *  - --jobs/--arms only with --deviation TEXT (both recorded in report.deviations).
 */
export function paidRunChecks({ plan, units, prereg, allowDraft = false, filters = null, deviation = null, deps = {} }) {
  const { canonicalFile = STAGES_FILE, preregFile = PREREG_FILE, checkStagesFn = checkStages, stampOf = engineStamp, frozenSha = gitBlobSha256, ledger = undefined, policy = undefined,
    meterGate = readMeterGate, meterVerification = readVerification } = deps;
  const { stages, stage } = plan, errors = [], deviations = [];
  if (stage.approved !== true) errors.push(`stage ${stage.id} is not approved (stages.json approved: ${stage.approved}); paid runs need the owner's gate`);
  if (stages.status !== 'frozen') {
    if (allowDraft) deviations.push({ kind: 'allow-draft', text: `--allow-draft: stage ${stage.id} ran on a ${stages.status} plan (not frozen); record it in PREREG §13 before its labels are used` });
    else errors.push(`the plan is ${stages.status}, not frozen: freeze the preregistration first (or pass --allow-draft, recorded as a deviation)`);
  }
  const preregPath = prereg ? path.resolve(prereg) : null;
  const preregText = preregPath && existsSync(preregPath) ? readFileSync(preregPath, 'utf8') : null;
  if (!preregText) errors.push('a paid run needs --prereg (the preregistration text)');
  const canonical = existsSync(canonicalFile) ? sha256Hex(readFileSync(canonicalFile)) : null;
  if (plan.planSha256 !== canonical && !(preregText && preregText.includes(plan.planSha256)))
    errors.push(`the plan ${plan.file} is neither the canonical stages.json nor a spec whose sha256 (${plan.planSha256}) the preregistration lists`);
  if (preregText) {
    if (preregPath !== path.resolve(preregFile) && sha256Hex(preregText) !== (existsSync(preregFile) ? sha256Hex(readFileSync(preregFile)) : null))
      errors.push(`--prereg ${prereg} is not the preregistration (${path.relative(REPO, preregFile)})`);
    const want = stages.preregSha256 ?? frozenSha(preregFile);
    if (!want) errors.push('the preregistration has no frozen hash (stages.json preregSha256, or a committed file)');
    else if (sha256Hex(preregText) !== want) errors.push(`the preregistration differs from its frozen text (sha256 ${sha256Hex(preregText).slice(0, 16)} vs ${String(want).slice(0, 16)})`);
  }
  const cs = checkStagesFn(stages, { preregText, ...(ledger ? { ledger } : {}), ...(policy ? { policy } : {}) });
  for (const e of cs.errors ?? []) errors.push(`prereg-check: ${e}`);
  for (const a of [...new Set(units.flatMap(u => [...u.arms, ...u.probeArms]))].sort()) {
    const def = stages.arms[a], h = armSha(def);
    if (def.settingsSha !== h) errors.push(`arm ${a}: settingsSha ${def.settingsSha} != armSha ${h} (the arm was edited after its hash was preregistered)`);
  }
  // The cost-meter gate (D6, meter-gate.mjs): a stage with an agent arm does not start while the committed gate is block-until-verified and no
  // passing meter-verification record is on file.
  const mg = meterGateDecision({ gate: meterGate(), verification: meterVerification(), arms: [...new Set(units.flatMap(u => [...u.arms, ...u.probeArms]))].sort().map(a => stages.arms[a]) });
  if (!mg.allow) errors.push(`meter gate: ${mg.why}`);
  let st = null;
  try { st = stampOf(stages, { stage: stage.id }); } catch (e) { errors.push(`engine stamp: ${e.message}`); }
  if (st) {
    if (!st.labelEngine?.commit) errors.push('engine stamp: no commit (the label engine must run from a commit)');
    if (st.labelEngine?.dirty) errors.push(`engine stamp: ${st.labelEngine.dirty} uncommitted change(s) in the label engine (files, trees or beds of this stage): commit before a paid run`);
  }
  if (filters) {
    const what = `${filters.jobs ? `--jobs ${filters.jobs.join(',')}` : ''}${filters.jobs && filters.arms ? ' ' : ''}${filters.arms ? `--arms ${filters.arms.join(',')}` : ''}`;
    if (!deviation) errors.push(`${what} on a paid run drops preregistered jobs or modes (racing then reads a subset of the modes): pass --deviation TEXT to record it`);
    else deviations.push({ kind: 'filter', jobs: filters.jobs ?? null, arms: filters.arms ?? null, text: deviation });
  } else if (deviation) deviations.push({ kind: 'note', text: deviation });
  return { errors, deviations, stamp: st };
}

// ---------------------------------------------------------------------------------------------------------------------
// Spend: a work root from before the spend ledger, and the attempts that left no row

/** Spend a work root recorded before it had a spend ledger, rebuilt conservatively from its files (each with its bound
 *  where the spend was not observed): runner records and faulted trials, builds and construction faults, probes. */
export function rebuildSpend({ live, stage, stages, book }) {
  const exp = `${stage.id}.`, jobs = new Map((stages.jobs ?? []).map(j => [j.id, j]));
  const boundOf = (jobId, armId) => {
    const { mode } = parseArmId(armId), def = stages.arms?.[mode];
    if (!def) return 1;
    if (def.factory === 'b0Call') return def.maxBudgetUsdPerCall ?? 1;
    if (def.factory === 'b0Agent') return mode === 'agent-O' ? jobs.get(jobId)?.agentOBudgetUsd ?? def.budgetUsd : def.budgetUsd;
    return def.run?.budgetUsd ?? def.run?.perTaskUsd ?? 1;
  };
  const jobOf = e => String(e).slice(exp.length);
  let rows = 0, faults = 0;
  for (const r of readJsonl(path.join(live, 'results.jsonl')).filter(x => x.experiment?.startsWith(exp) && x.error?.code !== 'STAGE_CAP')) {
    const bound = boundOf(jobOf(r.experiment), r.arm), { mode } = parseArmId(r.arm);
    let c = chargeOf(r, bound);
    if (stages.arms?.[mode]?.factory === 'b0Call') { const p = priceCalls(stages.priceTable, book.exact(`${r.arm}:${r.taskKey}:t${r.trial}`), { boundUsd: bound }); c = Math.max(c, p.measured + p.imputed); }
    rows += c;
  }
  for (const f of readJsonl(faultsFileOf(path.join(live, 'results.jsonl'))).filter(x => x.experiment?.startsWith(exp))) {
    const bound = boundOf(jobOf(f.experiment), f.arm);
    faults += f.costUsd == null || f.costUnknown ? Math.max(bound, f.costUsd ?? 0) : f.costUsd;
  }
  const builds = sum(readJsonl(path.join(live, 'builds.jsonl')).filter(b => b.stage === stage.id).map(b => Math.max(b.usdReported ?? 0, (b.usdRepriced ?? 0) + (b.usdImputed ?? 0))));
  const cfaults = sum(readJsonl(path.join(live, 'construction-faults.jsonl')).filter(f => f.stage === stage.id).map(f => Math.max(f.costUsd ?? 0, (f.usdRepriced ?? 0) + (f.usdImputed ?? 0))));
  const probes = sum(readJsonl(path.join(live, 'probes.jsonl')).filter(p => p.stage === stage.id).map(p => Math.max(p.usdReported ?? 0, (p.usdRepriced ?? 0) + (p.usdImputed ?? 0))));
  const parts = { rows, faults, builds, constructionFaults: cfaults, probes };
  return { usd: sum(Object.values(parts)), parts };
}

/**
 * The attempts of this stage that left no row, from the spend ledger: a trial attempt the runner kept aside as an
 * environment fault (every attempt of a key but its recorded one), a start in flight when a process died (never settled:
 * its bound), a build that raised. Returns per-job dollar parts { faulted, unrecorded } as {usdReported, usdRepriced, usdImputed}.
 */
export function unrecordedSpend({ spend, stageId, results }) {
  const recorded = new Map();
  for (const r of results) if (r.experiment?.startsWith(`${stageId}.`)) recorded.set(`${r.experiment.slice(stageId.length + 1)}|${r.arm}|${r.taskKey}|t${r.trial}`, r);
  const byKey = new Map();
  for (const e of spend.entries) if (!e.carried && e.key != null && (e.kind === 'trial' || e.kind === 'build' || e.kind === 'probe')) byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
  const zero = () => ({ usdReported: 0, usdRepriced: 0, usdImputed: 0 }), perJob = new Map();
  const add = (job, part, e) => {
    const j = perJob.get(job) ?? { faulted: zero(), unrecorded: zero(), faultedAttempts: 0, unrecordedAttempts: 0 };
    const x = j[part];
    if (e.settled) { x.usdReported += e.reported ?? 0; x.usdRepriced += e.repriced ?? 0; x.usdImputed += e.imputed ?? 0; } else x.usdImputed += e.bound ?? 0;
    j[`${part}Attempts`] += 1; perJob.set(job, j);
  };
  for (const [key, es] of byKey) {
    const job = es[0].job ?? String(key).split('|')[0];
    if (es[0].kind === 'trial') {
      const rec = recorded.get(key), live = rec && rec.error?.code !== 'STAGE_CAP';
      const lastN = live ? Math.max(...es.filter(e => e.settled).map(e => e.n ?? 0)) : null;
      for (const e of es) {
        if (live && e.settled && e.n === lastN) continue;
        add(job, e.settled ? 'faulted' : 'unrecorded', e);
      }
    } else for (const e of es) {
      // builds: faults are in construction-faults.jsonl (counted there); a build that raised or never settled left no record.
      if (!e.settled || (e.kind === 'build' && e.error === 'ARM_ERROR')) add(job, 'unrecorded', e);
    }
  }
  return perJob;
}

/** K4 per (job, mode): trial attempts and environment faults (results + results.faults) and build attempts and faults
 *  (builds + construction-faults); an arm over the limit on either is invalid for the stage. */
export function armFaultTable({ stageId, results, faults, builds, constructionFaults, limit = ENV_FAULT_LIMIT }) {
  const t = new Map(), at = (job, mode) => { const k = `${job}|${mode}`; if (!t.has(k)) t.set(k, { job, mode, trialAttempts: 0, trialFaults: 0, buildAttempts: 0, buildFaults: 0 }); return t.get(k); };
  const jobOfExp = e => String(e).slice(stageId.length + 1);
  for (const r of results) if (r.experiment?.startsWith(`${stageId}.`) && r.error?.code !== 'STAGE_CAP') at(jobOfExp(r.experiment), parseArmId(r.arm).mode).trialAttempts += 1;
  for (const f of faults) if (f.experiment?.startsWith(`${stageId}.`)) { const x = at(jobOfExp(f.experiment), parseArmId(f.arm).mode); x.trialAttempts += 1; x.trialFaults += 1; }
  for (const b of builds) if (b.stage === stageId) at(b.job, b.mode).buildAttempts += 1;
  for (const f of constructionFaults) if (f.stage === stageId) { const x = at(f.job, f.mode); x.buildAttempts += 1; x.buildFaults += 1; }
  return [...t.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : a.mode < b.mode ? -1 : a.mode > b.mode ? 1 : 0)).map(x => {
    const share = x.trialAttempts ? x.trialFaults / x.trialAttempts : 0, buildShare = x.buildAttempts ? x.buildFaults / x.buildAttempts : 0;
    return { schema: 'need-arm-faults/1', stage: stageId, ...x, share: r6(share), buildShare: r6(buildShare), limit, invalid: share > limit || buildShare > limit };
  });
}

// Family-handed deployable tests the DESIGN names (§2 deployableVerdict) that a bed may not export yet as deployableCheck.
export const FAMILY_HANDED_TESTS = Object.freeze({ codefix: 'visible tests', ownerci: 'visible tests', 'ebed-e8': 'smoke host' });

/**
 * Run one stage. Returns the report object (also written as report.json and report.txt to the live dir and --out).
 * opts: { stageId, stagesFile, specFile, prereg, workRoot, out, dry, jobs, arms, concurrency, racing, withConditional,
 *         allowDraft, deviation, enforceGates (default: live runs only), ports (override: tests; 'stub' = stub ports built from
 *         the plan), stubForce (stub outcome overrides), paidDeps (paidRunChecks deps: tests), log }
 */
export async function labelRun(opts) {
  const { stageId, stagesFile = STAGES_FILE, specFile = null, prereg = null, dry = false, jobs = null, arms = null, concurrency = 4, racing = true,
    withConditional = false, allowDraft = false, deviation = null, stubForce = {}, log = console.log, enforceGates = !dry, paidDeps = {} } = opts;
  if (!(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 4)) throw new Error(`--concurrency must be an integer from 1 to 4 (agent concurrency at most 4, DESIGN §7), got ${concurrency}`);
  const plan0 = loadPlan({ stageId, stagesFile, specFile }), { stages, stage, source, planSha } = plan0;
  const { units: planned, skipped } = stageUnits(stages, stage, { jobs, arms, withConditional });
  const deviations = [];
  let stampRec = null;
  if (!dry) {
    const v = paidRunChecks({ plan: plan0, units: planned, prereg, allowDraft, filters: jobs || arms ? { jobs, arms } : null, deviation, deps: paidDeps });
    if (v.errors.length) throw Object.assign(new Error(`paid run refused (${v.errors.length} problem(s)): ${v.errors.join('; ')}`), { code: 'PAID_RUN_REFUSED', errors: v.errors });
    deviations.push(...v.deviations); stampRec = v.stamp;
  } else if (deviation) deviations.push({ kind: 'note', text: deviation });
  const id = stage.id.toLowerCase();
  const live = path.resolve(opts.workRoot ?? path.join(LIVE_ROOT, dry ? `${id}-dry` : id));
  if (live === REPO || live.startsWith(REPO + path.sep)) throw new Error(`the work root must be outside the repository: ${live}`);
  const out = path.resolve(opts.out ?? (dry ? path.join(live, 'dry-out') : path.join(OUT_ROOT, id)));
  // The spend ledger lives in the work root and in --out. A new work root over an --out that holds this stage's spend
  // would restart the meter from $0: refused.
  const liveSpendFile = path.join(live, SPEND_FILE), outSpendFile = path.join(out, SPEND_FILE);
  {
    const ls = loadSpend([liveSpendFile], stage.id), os = loadSpend([outSpendFile], stage.id);
    const foreign = [...os.ids].filter(x => !ls.ids.has(x));
    if (foreign.length) throw Object.assign(new Error(`--out ${out} already holds $${os.totalUsd.toFixed(2)} of stage ${stage.id} spend (${foreign.length} spend-ledger entr${foreign.length === 1 ? 'y' : 'ies'}) that the work root ${live} does not hold: resume with the work root that spent it, or use another --out`), { code: 'SPEND_ELSEWHERE' });
  }
  mkdirSync(live, { recursive: true }); mkdirSync(out, { recursive: true });
  // The label-engine stamp of a paid run: written before the first paid call; a resume on another engine is refused.
  if (stampRec) {
    const sf = path.join(out, STAMP_FILE);
    if (existsSync(sf)) {
      const prev = JSON.parse(readFileSync(sf, 'utf8')), d = stampDiff(prev.labelEngine, stampRec.labelEngine);
      if (!d.ok) throw Object.assign(new Error(`resume on a changed label engine: ${d.deviations.slice(0, 5).map(x => x.key).join(', ')} differ from ${sf}; finish or analyse the stage as it stands`), { code: 'ENGINE_CHANGED' });
    } else writeFileSync(sf, JSON.stringify(stampRec, null, 1) + '\n');
    copyFileSync(sf, path.join(live, STAMP_FILE));
  }
  const ledger = loadLedger();
  // The negative control (K2) runs first, then the stage's own order.
  const units = [...planned.filter(u => u.job.id === R0_CONTROL.job), ...planned.filter(u => u.job.id !== R0_CONTROL.job)];

  // Plan every job first (seed refusals stop the stage before anything is spent). Reserve seeds taken as replacements by
  // other stages (their reports beside --out) or by an earlier job of this stage are not handed out again.
  const plans = new Map(), allTasks = [], taken = priorReplacementSeeds(path.dirname(out), stage.id);
  for (const u of units) {
    const lineageModes = u.arms.filter(a => lineageOf(stages.arms[a]));
    const examplesNeeded = [...new Set(lineageModes.flatMap(a => Array.from({ length: stages.arms[a].lineages ?? 1 }, (_, i) => i + 1)))];
    const p = await planJob(stages, u, { ledger, examplesNeeded, probe: u.probeArms.length > 0, taken });
    plans.set(u.job.id, p);
    allTasks.push(...p.evalTasks, ...Object.values(p.examples).flat(), ...(p.probeTask ? [p.probeTask] : []));
  }
  const gatewayModels = [...new Set(units.flatMap(u => [...u.arms, ...u.probeArms]).flatMap(a => {
    const d = stages.arms[a]; return d.factory === 'b0Call' ? [d.model] : d.build?.factory === 'procedureWriter' ? [d.build.model] : d.build?.factory === 'construct' ? d.build.models : [];
  }))].sort();
  const constructModels = [...new Set(units.flatMap(u => u.arms).filter(a => stages.arms[a].build?.factory === 'construct').flatMap(a => stages.arms[a].build.models))].sort();
  if (constructModels.length && gatewayModels.join() !== constructModels.join()) throw new Error(`the gateway models (${gatewayModels.join(', ')}) must equal the construction session models (${constructModels.join(', ')})`);
  const portModels = gatewayModels.length ? gatewayModels : ['claude-haiku-5-5'];
  const ports = opts.ports === 'stub' ? stubPorts({ tasks: allTasks, models: portModels, force: stubForce })
    : opts.ports ?? (gatewayModels.length || units.length ? (dry ? stubPorts({ tasks: allTasks, models: portModels, force: stubForce }) : livePorts({ live, models: portModels })) : null);
  if (dry && ports?.kind !== 'stub' && !opts.ports) throw new Error('--dry must run on stub ports');
  if (ports && ports.kitBase === null) ports.kitBase = path.join(live, 'kit');

  const resultsFile = path.join(live, 'results.jsonl'), buildsFile = path.join(live, 'builds.jsonl'), probesFile = path.join(live, 'probes.jsonl');
  const book = new CallBook(path.join(live, 'calls.jsonl'));
  const builds = new Map(readJsonl(buildsFile).filter(b => b.stage === stage.id).map(b => [buildKey(b.job, b.mode, b.lineage), b]));
  const probes = new Map(readJsonl(probesFile).filter(p => p.stage === stage.id).map(p => [`${p.job}|${p.mode}|${p.draw}`, p]));
  // Racing decisions are persisted (racing.jsonl): a resume replays the recorded rounds instead of re-deciding them on data
  // that already holds their top-ups, so a rerun reaches the same rows and the same report.
  const racingFile = path.join(live, 'racing.jsonl');
  const decided = new Map(readJsonl(racingFile).filter(e => e.stage === stage.id).map(e => [`${e.round}|${e.job}`, e]));
  // Resume never mixes versions: every build, probe and racing record of this stage must carry the current stamp.
  const vctx = { stages, stageSha: stageSha(stages, stage), prompts: promptShas() };
  const mixed = [
    ...[...builds.values()].filter(b => !sameStamp(b.stamp, recordStamp(vctx, b.mode))).map(b => `build ${b.job}/${b.mode}#${b.lineage}`),
    ...[...probes.values()].filter(p => !sameStamp(p.stamp, recordStamp(vctx, p.mode))).map(p => `probe ${p.job}/${p.mode}/${p.draw}`),
    ...[...decided.values()].filter(e => !sameStamp(e.stamp, recordStamp(vctx))).map(e => `racing round ${e.round} ${e.job}`),
  ];
  if (mixed.length) throw Object.assign(new Error(`resume would mix versions: ${mixed.length} record(s) of stage ${stage.id} were made under another plan, arm settings, prompts or prices (${mixed.slice(0, 4).join(', ')}${mixed.length > 4 ? ', ...' : ''}): use a new work root and --out`), { code: 'RESUME_MIXES_VERSIONS' });

  // The meter at start: the spend ledger (work root and --out); a work root from before the ledger carries its files' spend.
  const spendFiles = [liveSpendFile, outSpendFile];
  let spend0 = loadSpend(spendFiles, stage.id);
  const budget = new StageBudget(stage.capUsd ?? 0, 0, { stage: stage.id, files: spendFiles, attempts: spend0.attempts });
  // Entries the work root holds and --out does not (a changed --out) are copied, so --out holds the whole ledger.
  { const os = loadSpend([outSpendFile], stage.id); for (const e of readJsonl(liveSpendFile)) if (e.stage === stage.id && !os.ids.has(e.id) && path.resolve(outSpendFile) !== path.resolve(liveSpendFile)) appendFileSync(outSpendFile, JSON.stringify(e) + '\n'); }
  if (!spend0.ids.size) {
    const legacy = rebuildSpend({ live, stage, stages, book });
    if (legacy.usd > 0) { budget.write({ op: 'carry', id: `carry-${randomUUID()}`, charged: legacy.usd, parts: legacy.parts, why: 'spend recorded before the spend ledger, rebuilt from the work root files' }); spend0 = loadSpend(spendFiles, stage.id); }
  }
  budget.spentUsd = spend0.totalUsd;
  const ctx = { stages, stage, live, resultsFile, buildsFile, probesFile, book, builds, probes, budget, ports, ledger, concurrency, log, notRun: [], stageSha: vctx.stageSha, prompts: vctx.prompts,
    // Cost-meter gate (meter-gate.mjs): live runs check every priced agent session's output tokens against the CLI's final usage; --dry stubs carry no such usage.
    meter: dry ? null : { tolerance: OUTPUT_TOLERANCE },
    metered: ({ timeoutMs = null } = {}) => meteredPort(ports.model, { book, timeoutMs }) };
  let stopped = null;
  const racingLog = new Map(decided);
  // K2 on the control's draws: a draw that cannot reach 10/12 even if its missing tasks passed stops the stage (fix the anchor
  // or the harness); a draw that is incomplete (faulted or capped tasks) stops it too, as not evaluable, before any other
  // mode is paid for (a resume completes the control first).
  const k2 = (u, plan) => {
    if (!enforceGates || u.job.id !== R0_CONTROL.job || !u.arms.includes(R0_CONTROL.mode)) return null;
    const rows = jobRows(ctx, u, plan).rows.filter(r => r.mode === R0_CONTROL.mode), draws = replicatesOf(stages.arms[R0_CONTROL.mode]);
    const per = Array.from({ length: draws }, (_, d) => { const x = rows.filter(r => r.rep === d); return { n: x.length, pass: x.filter(r => r.pass).length }; });
    const perDraw = per.map(x => `${x.pass}/${x.n}`).join(', ');
    if (per.some(x => x.pass + Math.max(0, R0_CONTROL.of - x.n) < R0_CONTROL.minPass)) return `K2: direct-H on ${u.job.id} ${perDraw} (needs >= ${R0_CONTROL.minPass}/${R0_CONTROL.of} per draw): fix the anchor or the harness`;
    if (per.some(x => x.n < R0_CONTROL.of)) return `K2 not evaluable: the direct-H control on ${u.job.id} is incomplete (${perDraw}; faulted or capped tasks): no other mode starts; resume to complete it`;
    return null;
  };
  try {
    for (const u of units) {
      const plan = plans.get(u.job.id), fam = await loadFamily(u.job.family), schemaTest = schemaTestOf(fam);
      // K2 before spend: on the negative control, direct-H (both draws) runs alone first; below 10/12 on a draw nothing
      // else of the stage starts (no build, no other mode, no other job).
      if (u.job.id === R0_CONTROL.job && u.arms.includes(R0_CONTROL.mode)) {
        await runGroups({ ctx, unit: u, plan, groups: [{ arms: [runArmsFor({ ctx, unit: u, fam, schemaTest, mode: R0_CONTROL.mode })], trials: replicatesOf(stages.arms[R0_CONTROL.mode]) }] });
        if ((stopped = k2(u, plan))) break;
      }
      // Builds (lineage modes), then every mode on the evaluation tasks, grouped by replicate count.
      const want = u.arms.filter(a => lineageOf(stages.arms[a])).flatMap(a => Array.from({ length: stages.arms[a].lineages ?? 1 }, (_, i) => ({ mode: a, k: i + 1 })));
      const built = await ensureBuilds({ ctx, unit: u, plan, want });
      const byTrials = new Map();
      for (const a of u.arms.filter(x => !lineageOf(stages.arms[x]))) { const n = replicatesOf(stages.arms[a]); byTrials.set(n, [...(byTrials.get(n) ?? []), runArmsFor({ ctx, unit: u, fam, schemaTest, mode: a })]); }
      // A failed build fails its tasks without running; a lineage voided at build time is not run either (its rows are void).
      const lineageArms = built.filter(b => !b.failed && !buildVoided(b)).map(b => runArmsFor({ ctx, unit: u, fam, schemaTest, mode: b.mode, k: b.lineage, build: b }));
      await runGroups({ ctx, unit: u, plan, groups: [...[...byTrials].map(([trials, a]) => ({ arms: a, trials })), { arms: lineageArms, trials: 1 }] });
      if (u.probeArms.length) await runProbes({ ctx, unit: u, plan });
      if ((stopped = k2(u, plan))) break;
    }
    // Racing: re-label each complete job at the headline cell; top up where the best class is not yet confident.
    for (let round = 1; racing && !stopped && round <= (stages.grid?.racingMaxPerMode ?? 4); round++) {
      let added = 0;
      for (const u of units.filter(x => x.arms.length)) {
        const plan = plans.get(u.job.id), fam = await loadFamily(u.job.family), schemaTest = schemaTestOf(fam), key = `${round}|${u.job.id}`;
        let rp = decided.get(key);
        if (!rp) {
          const { rows, builds: bs } = jobRows(ctx, u, plan);
          const t = tableOf(rows, withRunVoids(bs, runVoids(ctx, u), u.job.id));
          if (t.error) { racingLog.set(key, { stage: stage.id, round, job: u.job.id, skipped: t.error }); continue; }
          const labelModes = u.arms.filter(m => MODES[m] && !MODES[m].ceiling);
          const current = Object.fromEntries(u.arms.map(m => [m, lineageOf(stages.arms[m]) ? bs.filter(b => b.mode === m).length : Math.max(0, ...rows.filter(r => r.mode === m).map(r => r.rep + 1))]));
          let p;
          try { p = racingPlan({ table: t.table, job: u.job.id, stages, current, labelModes }); }
          catch (e) { racingLog.set(key, { stage: stage.id, round, job: u.job.id, skipped: String(e.message).slice(0, 200) }); continue; }
          rp = { stage: stage.id, round, job: u.job.id, pBest: p.pBest ? { workflow: r6(p.pBest.workflow), 'no-workflow': r6(p.pBest['no-workflow']) } : null, label: p.label,
            acceptable: p.acceptable, add: p.add, agentOTasks: p.agentOTasks, stamp: recordStamp(ctx) };
          appendFileSync(racingFile, JSON.stringify(rp) + '\n'); decided.set(key, rp);
        }
        racingLog.set(key, rp);
        const groups = [];
        for (const [m, n] of Object.entries(rp.add)) {
          if (lineageOf(stages.arms[m])) {
            const nb = await ensureBuilds({ ctx, unit: u, plan, want: [{ mode: m, k: n }] });
            for (const b of nb.filter(x => !x.failed && !buildVoided(x))) groups.push({ arms: [runArmsFor({ ctx, unit: u, fam, schemaTest, mode: m, k: b.lineage, build: b })], trials: 1 });
            added += 1;
          } else { groups.push({ arms: [runArmsFor({ ctx, unit: u, fam, schemaTest, mode: m })], trials: n }); added += 1; }
        }
        // agent-O's per-task second draw, unless this round already gives agent-O a draw on every task.
        if (rp.agentOTasks.length && !rp.add['agent-O']) {
          const tasks = plan.evalTasks.filter(x => rp.agentOTasks.includes(x.taskKey));
          groups.push({ arms: [runArmsFor({ ctx, unit: u, fam, schemaTest, mode: 'agent-O' })], trials: 2, tasks }); added += 1;
        }
        await runGroups({ ctx, unit: u, plan, groups });
      }
      if (!added) break;
    }
  } catch (e) {
    // A stall (runner, > 25% environment faults) stops the stage; anything else is a harness error: the raw files so far are
    // still copied out (failures are kept), then it is raised.
    if (/^STALL/.test(e.message)) stopped = e.message; else { copyOut(live, out, [...ctx.builds.values()]); throw e; }
  } finally { ports?.close?.(); }
  if (!stopped && budget.refused) stopped = `STAGE_CAP: $${budget.capUsd} reached; ${budget.refused} start(s) refused (K5: analysed as it stands, no reruns)`;

  // Rows, builds, probes, faults, spend, report.
  const results = readJsonl(resultsFile), runFaultRecs = readJsonl(faultsFileOf(resultsFile)), cfaults = readJsonl(path.join(live, 'construction-faults.jsonl')).filter(f => f.stage === stage.id);
  const spend = loadSpend(spendFiles, stage.id), unrec = unrecordedSpend({ spend, stageId: stage.id, results });
  const allRows = [], allBuilds = [], jobsOut = [];
  const zero = () => ({ usdReported: 0, usdRepriced: 0, usdImputed: 0 });
  const tot = rs => ({ usdReported: r6(sum(rs.map(r => r.usdReported ?? 0))), usdRepriced: r6(sum(rs.map(r => r.usdRepriced ?? 0))), usdImputed: r6(sum(rs.map(r => r.usdImputed ?? 0))) });
  const cfCost = f => ({ usdReported: f.usdReported ?? f.costUsd ?? 0, usdRepriced: f.usdRepriced ?? 0, usdImputed: f.usdImputed ?? (f.usdRepriced == null ? f.costUsd ?? 0 : 0) });
  for (const u of units) {
    const plan = plans.get(u.job.id);
    const { rows, builds: bs, capped } = jobRows(ctx, u, plan);
    const voidedBuilds = withRunVoids(bs, runVoids(ctx, u), u.job.id);
    allRows.push(...rows); allBuilds.push(...voidedBuilds);
    const t = rows.length ? tableOf(rows, voidedBuilds) : { error: 'no rows' };
    const modes = {};
    for (const m of [...new Set(rows.map(r => r.mode))].sort()) {
      const rs = rows.filter(r => r.mode === m), bsm = voidedBuilds.filter(b => b.mode === m);
      const usd = sum(rs.map(r => r.usdRepriced)) + sum(bsm.map(b => b.usdRepriced)), imp = sum(rs.map(r => r.usdImputed)) + sum(bsm.map(b => b.usdImputed));
      const errors = {};
      for (const r of rs) if (r.error) errors[r.error] = (errors[r.error] ?? 0) + 1;
      modes[m] = { rows: rs.length, pass: rs.filter(r => r.pass).length, delivered: rs.filter(r => r.delivered).length, schemaInvalid: rs.filter(r => r.delivered && r.schemaValid === false).length,
        selfPass: rs.filter(r => r.selfVerdict === 'pass').length, selfFail: rs.filter(r => r.selfVerdict === 'fail').length, selfCheckErrors: rs.filter(r => r.selfCheckError).length,
        voidedRows: rs.filter(r => r.void).length, reps: [...new Set(rs.map(r => r.rep))].length, usdReported: r6(sum(rs.map(r => r.usdReported)) + sum(bsm.map(b => b.usdReported))),
        usdRepriced: r6(usd), usdImputed: r6(imp), imputedShare: usd + imp > 0 ? r6(imp / (usd + imp)) : 0, notRepriced: rs.filter(r => !r.repriced).length, errors };
    }
    const runFaults = runFaultRecs.filter(f => f.experiment === `${stage.id}.${u.job.id}`).length;
    const jp = [...ctx.probes.values()].filter(p => p.job === u.job.id), jcf = cfaults.filter(f => f.job === u.job.id).map(cfCost), ju = unrec.get(u.job.id);
    const jobCharged = sum([...rows, ...voidedBuilds, ...jp, ...jcf].map(r => (r.usdRepriced ?? 0) + (r.usdImputed ?? 0)))
      + (ju ? ju.faulted.usdRepriced + ju.faulted.usdImputed + ju.unrecorded.usdRepriced + ju.unrecorded.usdImputed : 0);
    const est = Number.isFinite(u.job.estUsd) && u.job.estUsd > 0 ? u.job.estUsd : null;
    jobsOut.push({ job: u.job.id, cluster: u.job.cluster, split: u.job.split, family: u.job.family, bed: plan.bed, evalRole: u.evalRole, tasks: plan.evalTasks.length,
      seedChecks: plan.seedChecks, replacements: plan.replacements, arms: [...u.arms].sort(), probeArms: [...u.probeArms].sort(), modes,
      builds: voidedBuilds.map(b => ({ mode: b.mode, lineage: b.lineage, exampleSet: b.exampleSet, failed: b.failed, error: b.error ?? null,
        void: b.void ?? ((b.hiddenPathAttempts > 0 || b.nestedModelAttempts > 0) ? `hiddenPathAttempts=${b.hiddenPathAttempts}, nestedModelAttempts=${b.nestedModelAttempts}` : null),
        usdReported: b.usdReported, usdRepriced: b.usdRepriced, usdImputed: b.usdImputed, runSolverCalls: b.runSolverCalls ?? null, selfCheck: b.factory === 'construct' ? !!b.checkPath : null,
        pathMentions: b.pathMentions ?? null, artifactSha: b.artifactSha ?? null })),
      probes: jp.sort((a, b) => (a.mode < b.mode ? -1 : a.mode > b.mode ? 1 : a.draw - b.draw))
        .map(p => ({ mode: p.mode, draw: p.draw, delivered: p.delivered, schemaValid: p.schemaValid, outputHash: p.outputHash, usdRepriced: p.usdRepriced, usdImputed: p.usdImputed, error: p.error })),
      notRunCap: capped.length, envFaultedTrials: runFaults, constructionFaults: jcf.length, faultedAttempts: ju?.faultedAttempts ?? 0, unrecordedAttempts: ju?.unrecordedAttempts ?? 0,
      usdCharged: r6(jobCharged), estUsd: est, k7Ratio: est ? r6(jobCharged / est) : null, pairing: t.error ? `incomplete: ${t.error}` : 'ok',
      r0Control: r0Gate(rows, u.job.id) ?? undefined });
  }
  // The totals cover the jobs this report lists (a filtered run lists fewer); the cap meter (totals.spend) is the whole stage.
  const unitJobs = new Set(units.map(u => u.job.id)), unrecHere = [...unrec.entries()].filter(([job]) => unitJobs.has(job)).map(([, v]) => v);
  const allProbes = [...ctx.probes.values()].filter(p => unitJobs.has(p.job)).sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : a.mode < b.mode ? -1 : a.mode > b.mode ? 1 : a.draw - b.draw));
  const sumPart = (xs, k) => { const o = zero(); for (const x of xs) for (const f of Object.keys(o)) o[f] += x[k][f]; return Object.fromEntries(Object.entries(o).map(([f, v]) => [f, r6(v)])); };
  const parts = { usdTaskRows: tot(allRows), usdBuilds: tot(allBuilds), usdProbes: tot(allProbes), usdFaultedTrials: sumPart(unrecHere, 'faulted'),
    usdConstructionFaults: tot(cfaults.filter(f => unitJobs.has(f.job)).map(cfCost)), usdUnrecorded: sumPart(unrecHere, 'unrecorded') };
  const measured = sum(Object.values(parts).map(x => x.usdRepriced)), imputed = sum(Object.values(parts).map(x => x.usdImputed));
  const limit = stages.grid?.envFaultLimit ?? ENV_FAULT_LIMIT;
  const armFaults = armFaultTable({ stageId: stage.id, results, faults: runFaultRecs, builds: allBuilds, constructionFaults: cfaults, limit });
  const k7Limit = 1.5, famDeployable = new Map();
  // MEM-0 (MEMORY-ROUTING-RECURSION §3.2, §5 row 2): the prompt cache is an accidental memory; each arm's usage over its task
  // rows, builds and probe rows, and the share of its prompt tokens read from the cache.
  const cacheByArm = perArm([...allRows, ...allBuilds, ...allProbes]);
  for (const u of units) famDeployable.set(u.job.family, typeof (await loadFamily(u.job.family)).deployableCheck === 'function');
  const report = {
    schema: REPORT_SCHEMA, stage: stage.id, grade: stage.grade ?? null, dry, ports: ports?.kind ?? null, source, planSha, stageSha: vctx.stageSha, planStatus: stages.status, approved: stage.approved ?? null,
    preregSha: prereg && existsSync(prereg) ? sha16(readFileSync(prereg, 'utf8')) : null, capUsd: stage.capUsd ?? null, priceTable: stages.priceTable?.id ?? null,
    prompts: promptShas(), concurrency, racing, engine: stampRec ? { stampSha: sha16(canonicalJson(stampRec)), commit: stampRec.labelEngine?.commit ?? null } : null,
    arms: Object.fromEntries([...new Set(units.flatMap(u => [...u.arms, ...u.probeArms]))].sort().map(a => [a, { settingsSha: stages.arms[a].settingsSha ?? null, computedSha: armSha(stages.arms[a]),
      runtimeArmHashes: [...new Set(allRows.filter(r => r.mode === a).map(r => r.armHash))].sort(), usage: cacheByArm[a]?.usage ?? zeroUsage(), cacheReadShare: cacheByArm[a]?.cacheReadShare ?? null }])),
    jobs: jobsOut.sort((a, b) => (a.job < b.job ? -1 : 1)), skipped, deviations,
    racing: [...racingLog.values()].sort((a, b) => a.round - b.round || (a.job < b.job ? -1 : a.job > b.job ? 1 : 0)).map(({ stage: _s, stamp: _t, ...e }) => e),
    armFaults: armFaults.map(({ schema: _s, stage: _t, ...x }) => x),
    validity: {
      envFaultLimit: limit, invalidArms: armFaults.filter(x => x.invalid).map(x => `${x.job}/${x.mode}`),
      noSelfCheck: allBuilds.filter(b => b.factory === 'construct' && b.selfCheck && !b.failed && !b.checkPath).map(b => `${b.job}/${b.mode}#${b.lineage}`).sort(),
      selfCheckErrors: allRows.filter(r => r.selfCheckError).length,
      deployableGaps: units.filter(u => FAMILY_HANDED_TESTS[u.job.family] && !famDeployable.get(u.job.family)).map(u => ({ job: u.job.id, family: u.job.family, named: FAMILY_HANDED_TESTS[u.job.family], used: 'schema validity only' })),
      pathMentionsBuilds: allBuilds.filter(b => (b.pathMentions ?? 0) > (b.hiddenPathAttempts ?? 0)).length,
    },
    k7: { limit: k7Limit, perJobUsd: r6(jobsOut.length ? sum(jobsOut.map(j => j.usdCharged)) / jobsOut.length : 0), over: jobsOut.filter(j => j.k7Ratio != null && j.k7Ratio > k7Limit).map(j => j.job) },
    totals: { rows: allRows.length, builds: allBuilds.length, probes: allProbes.length, ...parts, usdMeasured: r6(measured), usdImputed: r6(imputed), usdCharged: r6(measured + imputed),
      imputedShare: measured + imputed > 0 ? r6(imputed / (measured + imputed)) : 0, notRun: ctx.notRun.length + jobsOut.reduce((a, j) => a + j.notRunCap, 0),
      constructionFaults: cfaults.length, envFaultedTrials: runFaultRecs.filter(f => f.experiment?.startsWith(`${stage.id}.`)).length,
      spend: { meterUsd: r6(spend.totalUsd), settledUsd: r6(spend.settledUsd), inFlightUsd: r6(spend.openUsd), carriedUsd: r6(spend.carriedUsd), capUsd: stage.capUsd ?? null } },
    stopped,
    rules: { rowCost: 'usdRepriced = measured tokens at the pinned table; usdImputed = bound minus measured for killed sessions and timeouts; total = sum',
      voids: 'lineage: build row hiddenPathAttempts or nestedModelAttempts > 0, or any of its agent sessions; agent draw: the same on the row (pass and delivered set false, rawPass kept). hiddenPathAttempts counts paths a tool use accesses (file-tool paths, Bash without heredoc bodies), never Write/Edit content or Grep patterns, and never a path the task states; pathMentions (every string scanned) is for review by hand',
      copyScan: `ownerci: more than ${COPY_SCAN.maxLines} distinct example lines of >= ${COPY_SCAN.minLineChars} characters in solve.mjs voids the lineage`,
      racing: 'headline cell; P(best class) < confident adds one draw or lineage per acceptable mode (max racingMaxPerMode); agent-O second draw on draw-1 per-task acceptable tasks',
      cap: 'the cap meter (PREREG §12): each start at max(reported, re-priced), at least its bound when unobserved (call $1, agent budget, script perTaskUsd, build builder + gateway budget), every start in flight at its bound; persisted in spend.jsonl (work root and --out); totals.spend.meterUsd',
      charged: 'totals.usdCharged = measured + imputed over task rows, builds, probes, faulted trial attempts, construction faults and attempts that left no record (the K7 figure per job: jobs[].usdCharged)',
      faults: `K4: an arm whose trial or build attempts are more than ${limit * 100}% environment faults is invalid (validity.invalidArms; arm-faults.jsonl)`,
      gates: `K2 stops the stage when direct-H on wbed-r0 is below 10/12 on a draw, before any other mode of the stage starts (${enforceGates ? 'enforced' : 'reported only'})`,
      cacheShare: 'arms[].cacheReadShare = cache read tokens / (input + cache read + cache write tokens) over the arm\'s task rows, builds and probe rows (MEM-0); null when none reported a prompt token' },
  };
  writeFileSync(path.join(live, 'rows.jsonl'), allRows.map(r => JSON.stringify(r)).join('\n') + (allRows.length ? '\n' : ''));
  writeFileSync(path.join(live, 'builds.final.jsonl'), allBuilds.map(b => JSON.stringify(b)).join('\n') + (allBuilds.length ? '\n' : ''));
  writeFileSync(path.join(live, ARM_FAULTS_FILE), armFaults.map(x => JSON.stringify(x)).join('\n') + (armFaults.length ? '\n' : ''));
  writeFileSync(path.join(live, 'report.json'), stableJson(report));
  writeFileSync(path.join(live, 'report.txt'), renderReport(report));
  copyOut(live, out, allBuilds);
  return report;
}

/** Copy the stage's result files and small build artefacts into --out (the repository side). The spend ledger is written
 *  to --out as it grows, never copied over. */
export function copyOut(live, out, builds) {
  mkdirSync(out, { recursive: true });
  for (const f of ['results.jsonl', 'results.faults.jsonl', 'calls.jsonl', 'builds.jsonl', 'builds.final.jsonl', 'construction-faults.jsonl', 'probes.jsonl', 'racing.jsonl', 'rows.jsonl',
    ARM_FAULTS_FILE, 'report.json', 'report.txt']) {
    if (existsSync(path.join(live, f)) && path.resolve(live, f) !== path.resolve(out, f)) copyFileSync(path.join(live, f), path.join(out, f));
  }
  for (const b of builds) {
    const dir = b.artifactPath ? path.dirname(b.artifactPath) : null;
    if (!dir) continue;
    const dest = path.join(out, 'artifacts', b.job, `${b.mode}-L${b.lineage}`);
    mkdirSync(dest, { recursive: true });
    for (const f of ['solve.mjs', SELF_CHECK_FILE, 'construction.json', 'BUILD-NOTES.md', 'PROCEDURE.md']) if (existsSync(path.join(dir, f))) copyFileSync(path.join(dir, f), path.join(dest, f));
  }
}

/** The report as text (no wall-clock figures: --dry reruns are byte-identical). */
export function renderReport(rep) {
  const usd = x => `$${x.toFixed(4)}`, L = [];
  L.push(`need label run ${rep.stage} (${rep.grade ?? '?'})${rep.dry ? ' DRY: stub ports, $0, outcomes are fake' : ''}`);
  L.push(`plan ${rep.source} ${rep.planSha} (${rep.planStatus}, approved ${rep.approved}); stage ${rep.stageSha}; cap $${rep.capUsd}; prices ${rep.priceTable}; racing ${rep.racing ? 'on' : 'off'}`);
  L.push(`prompts: ${Object.entries(rep.prompts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (rep.engine) L.push(`engine stamp ${rep.engine.stampSha} (commit ${rep.engine.commit})`);
  for (const d of rep.deviations ?? []) L.push(`DEVIATION (${d.kind}): ${d.text}${d.jobs || d.arms ? ` [jobs ${d.jobs?.join(',') ?? 'all'}; arms ${d.arms?.join(',') ?? 'all'}]` : ''}`);
  if (rep.stopped) L.push(`STOPPED: ${rep.stopped}`);
  for (const j of rep.jobs) {
    const k2 = j.r0Control ? `; R0 control (K2) direct-H ${j.r0Control.perDraw.join(', ')}${j.r0Control.ok ? '' : ' BELOW 10/12'}` : '';
    L.push('', `${j.job} [${j.cluster}/${j.split}] ${j.family} ${j.evalRole ?? '-'}: ${j.tasks} tasks, ${j.seedChecks} seed checks, `
      + `${j.replacements.length} replacement(s); pairing ${j.pairing}${k2}; charged ${usd(j.usdCharged)}${j.estUsd ? ` (estimate $${j.estUsd}, ${j.k7Ratio}x)` : ''}`);
    for (const [m, s] of Object.entries(j.modes)) {
      const errors = Object.entries(s.errors).map(([k, v]) => `${k}:${v}`).join(' ');
      L.push(`  ${m.padEnd(14)} ${String(s.pass).padStart(3)}/${String(s.rows).padEnd(3)} pass  delivered ${s.delivered}  self ${s.selfPass}/${s.selfFail}  void ${s.voidedRows}  `
        + `${usd(s.usdRepriced)} + imputed ${usd(s.usdImputed)} (reported ${usd(s.usdReported)})${errors ? `  ${errors}` : ''}${s.selfCheckErrors ? `  self-check errors ${s.selfCheckErrors}` : ''}`);
    }
    for (const b of j.builds) {
      const extra = `${b.runSolverCalls != null ? `, run-solver ${b.runSolverCalls}` : ''}${b.selfCheck != null ? `, check.mjs ${b.selfCheck ? 'yes' : 'no'}` : ''}`;
      L.push(`  build ${b.mode} L${b.lineage} (set ${b.exampleSet}): ${b.failed ? 'FAILED' : 'ok'}${b.void ? ` VOID (${b.void})` : ''} ${usd(b.usdRepriced)} + ${usd(b.usdImputed)}${extra}`);
    }
    for (const p of j.probes) L.push(`  probe ${p.mode} draw ${p.draw}: delivered ${p.delivered}, schema ${p.schemaValid}, ${usd(p.usdRepriced)} + ${usd(p.usdImputed)}${p.error ? ` ${p.error}` : ''}`);
    if (j.notRunCap || j.envFaultedTrials || j.constructionFaults || j.unrecordedAttempts) L.push(`  not run at cap: ${j.notRunCap}; env-faulted trials (resume retries): ${j.envFaultedTrials}; construction faults: ${j.constructionFaults}; attempts without a record: ${j.unrecordedAttempts}`);
  }
  if (rep.armFaults?.length) {
    const bad = rep.armFaults.filter(x => x.trialFaults || x.buildFaults);
    L.push('', `environment faults per arm (K4, limit ${rep.validity.envFaultLimit}): ${bad.length ? '' : 'none'}`, ...bad.map(x => `  ${x.job}/${x.mode}: trials ${x.trialFaults}/${x.trialAttempts} (${x.share}), builds ${x.buildFaults}/${x.buildAttempts} (${x.buildShare})${x.invalid ? ' INVALID' : ''}`));
  }
  const V = rep.validity;
  if (V && (V.invalidArms.length || V.noSelfCheck.length || V.selfCheckErrors || V.deployableGaps.length))
    L.push('', 'validity:', ...(V.invalidArms.length ? [`  invalid arms (K4): ${V.invalidArms.join(', ')}`] : []), ...(V.noSelfCheck.length ? [`  construct-H lineages without check.mjs: ${V.noSelfCheck.join(', ')}`] : []),
      ...(V.selfCheckErrors ? [`  rows whose self-check could not run: ${V.selfCheckErrors}`] : []), ...V.deployableGaps.map(g => `  ${g.job}: deployableVerdict is ${g.used}; DESIGN names ${g.named} (${g.family} exports no deployableCheck)`));
  const arms = Object.entries(rep.arms ?? {});
  if (arms.length) L.push('', 'prompt-cache read share per arm (MEM-0):', ...arms.map(([a, x]) => `  ${a.padEnd(14)} ${x.usage ? cacheShareCell(x.usage) : '–'}`));
  if (rep.racing.length) L.push('', 'racing:', ...rep.racing.map(r => `  round ${r.round} ${r.job}: ${r.skipped ? `skipped (${r.skipped})`
    : `P(best) ${JSON.stringify(r.pBest)} label ${r.label} A=[${r.acceptable.join(', ')}] add ${JSON.stringify(r.add)} agent-O tasks ${r.agentOTasks.length}`}`));
  if (rep.skipped.length) L.push('', 'skipped:', ...rep.skipped.map(s => `  ${s.where}: ${s.reason}`));
  const t = rep.totals, f = t.usdFaultedTrials, c = t.usdConstructionFaults;
  L.push('', `totals: ${t.rows} rows, ${t.builds} builds, ${t.probes} probe rows; measured ${usd(t.usdMeasured)} + imputed ${usd(t.usdImputed)} = ${usd(t.usdCharged)} `
    + `(imputed share ${t.imputedShare}); not run ${t.notRun}; construction faults ${t.constructionFaults} (${usd(c.usdRepriced + c.usdImputed)}); env-faulted trials ${t.envFaultedTrials} (${usd(f.usdRepriced + f.usdImputed)})`);
  L.push(`cap meter (K5): ${usd(t.spend.meterUsd)} of $${t.spend.capUsd}${t.spend.carriedUsd ? ` (carried from files ${usd(t.spend.carriedUsd)})` : ''}${t.spend.inFlightUsd ? `; never settled ${usd(t.spend.inFlightUsd)}` : ''}; K7 cost per job ${usd(rep.k7.perJobUsd)}${rep.k7.over.length ? `; over ${rep.k7.limit}x estimate: ${rep.k7.over.join(', ')}` : ''}`);
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const has = k => argv.includes(k);
  let stageId = arg('--stage'), specFile = arg('--stage-spec');
  if (stageId && /\.json$/.test(stageId) && existsSync(stageId)) { specFile = stageId; stageId = arg('--stage-id') ?? JSON.parse(readFileSync(stageId, 'utf8')).stages?.[0]?.id; }
  if (!stageId) {
    console.error('usage: label-run.mjs --stage <ID|spec.json> [--stages FILE] [--stage-spec FILE] [--prereg FILE] [--work-root DIR] [--out DIR] [--dry]\n'
      + '         [--jobs a,b] [--arms a,b] [--concurrency 1-4] [--no-racing] [--with-conditional] [--allow-draft] [--deviation TEXT] [--enforce-gates]');
    process.exit(2);
  }
  const conc = arg('--concurrency', '4');
  try {
    if (!/^[1-4]$/.test(String(conc))) throw new Error(`--concurrency must be an integer from 1 to 4, got ${conc}`);
    const rep = await labelRun({ stageId, stagesFile: arg('--stages', STAGES_FILE), specFile, prereg: arg('--prereg'), workRoot: arg('--work-root'), out: arg('--out'), dry: has('--dry'),
      jobs: arg('--jobs')?.split(',') ?? null, arms: arg('--arms')?.split(',') ?? null, concurrency: Number(conc), racing: !has('--no-racing'),
      withConditional: has('--with-conditional'), allowDraft: has('--allow-draft'), deviation: arg('--deviation'), ...(has('--enforce-gates') ? { enforceGates: true } : {}) });
    process.stdout.write(renderReport(rep));
    process.exit(rep.stopped ? 3 : 0);
  } catch (e) { console.error(`label-run: ${e.code ? `${e.code}: ` : ''}${e.message}`); process.exit(2); }
}
