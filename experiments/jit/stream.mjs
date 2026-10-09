// JIT stream runner (SPEC §6). One recurring stream of tasks, several arms:
//   agent:<model>                 interpret every task (independent; run under the concurrency cap)
//   static:<solve.mjs>            a fixed compiled script; deopt/crash/timeout/invalid -> claude-haiku-5-5 interpreter
//   jit:<interpreter>/<compiler>  warmup -> compile -> run compiled; deopt -> interpret + recompile; shadows,
//                                 adjudication by majority, regressions, reject-if-worse, one Opus fallback per compile
// Every arm writes only its own directory (results.jsonl, events.jsonl, faults.jsonl, journal.sqlite, traces/,
// versions/, regressions/), so arms can run as separate processes and resume independently. The bed oracle scores the
// delivered answer only; nothing it says ever reaches an interpreter, a compiler or the JIT state.
// CLI: node experiments/jit/stream.mjs --config <file> [--arms a,b] [--dry] [--run-root dir] [--work-root dir]
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, rmSync, copyFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonical } from '../../beds/lib/canonical.mjs';
import { loadPolicy } from '../../src/models/policy.mjs';
import { ENV_FAULTS, metEnvFault } from '../lib/runner.mjs';
import { createModelPort as createModelPortSync } from '../lib/models.mjs';
import { promptVersionOf, flowFileOf } from './prompts.mjs';
import { tolerantEqual, tolerance } from './compare.mjs';
import { judgeAcceptance, acceptanceModeOf, minPartialOf, caseTasks } from './acceptance.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url))), HERE = path.dirname(fileURLToPath(import.meta.url));
export const RUN_ROOT = path.join(REPO, 'experiments/runs/jit'), WORK_ROOT = '/var/tmp/foundry-work/jit';
export const POLICY_MODELS = Object.freeze(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
export const DEFAULT_JIT = Object.freeze({ warmup: 3, shadowEvery: 4, recompileOnDeopts: 2, maxTraces: 8, compilerFallback: 'claude-opus-5-5', maxFallbacks: null, compare: 'canonical' });
// SPEC §3.5: builder Haiku high $3 + $1.5 gateway 30 min; the fallback Opus high $8 + $1.5 gateway 45 min. checkUsd caps the
// host acceptance check (compile.mjs hostCheck); a check with budget deopts is re-run once at twice that cap.
export const DEFAULT_COMPILE = Object.freeze({ builderEffort: 'high', builderBudgetUsd: 3, gatewayUsd: 1.5, checkUsd: 1.5, minutes: 30,
  fallback: Object.freeze({ builderEffort: 'high', builderBudgetUsd: 8, gatewayUsd: 1.5, checkUsd: 1.5, minutes: 45 }) });
const STATIC_FALLBACK = 'claude-haiku-5-5';
export const JIT_COMPARE_MODES = Object.freeze(['canonical', 'unordered', 'tolerant']);
const TOL_KEYS = ['relTol', 'absTol', 'tolerantKeys', 'allowLooseTolerance'];
// The tolerance fields of a normalized jit or compile config (compare.mjs tolerance() options).
const tolOf = c => Object.fromEntries(TOL_KEYS.filter(k => c?.[k] != null).map(k => [k, c[k]]));
// v2 options (opt-in, never in the defaults above, so a v1 config keeps its arm hash):
//   jit.shadowOnFlags (default false): also shadow a compiled ok run that raised uncertainty flags (flow.flag); shadow
//     events and rows then carry the reason ('schedule' | 'flag' | 'schedule+flag'). jit.shadowEvery 0 = no scheduled
//     shadows (flag-only when shadowOnFlags is on).
//   compile.promptVersion (default 1): the builder prompt text (prompts.mjs) and the SDK version (flowFileOf: version 2
//     builds, checks and runs on flow-v2.mjs); applies to the fallback compiler too (compile.fallback.promptVersion is refused).
//     With shadowOnFlags or promptVersion 2, a row whose compiled answer was not delivered also records compiledPass (the
//     oracle on the compiled answer; the experimenter's view for report.mjs, never read by the JIT state).
// v2.1 options (opt-in, same rule: at their defaults they leave the normalized config, so no hash moves):
//   jit.compare 'tolerant' (default 'canonical'; 'unordered' as before): shadows and adjudication compare answers with
//     compare.mjs tolerantEqual, at jit.relTol (default 0.01) and jit.absTol (default 1e-9), written into the normalized
//     config so the hash is the same whether or not they are spelled out. Shadow events then also say canonicalAgree.
//     jit.tolerantKeys (e.g. ['vmax', 'km']) limits tolerance to numbers under those keys (all others exact); without it two
//     integers are still compared exactly. relTol > 0.05 or absTol > 1e-6 is refused unless jit.allowLooseTolerance: true.
//   compile.compare 'tolerant' (default 'canonical', or 'tolerant' when jit.compare is 'tolerant': regression cases come
//     from tolerant adjudications, so an explicit canonical is then refused), compile.relTol / absTol / tolerantKeys /
//     allowLooseTolerance (default: jit's when jit.compare is 'tolerant', else 0.01 / 1e-9 / none / false): the host check
//     (and the builder's own check-traces) compare tolerantly.
//   compile.acceptance 'strict' (default 'named'; needs compile.promptVersion 3), compile.minPartial (default 0.9):
//     acceptance.mjs's strict rule.
//   compile.promptVersion 3: prompt v3 (prompts.mjs) on flow-v2.mjs.
//   None of the compile options can be set on compile.fallback: they apply to the fallback compiler too.
// Set to their defaults they are dropped from the normalized config, so writing them out explicitly changes no hash.

const sha = s => createHash('sha256').update(s).digest('hex');
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const round = x => Math.round(x * 1e6) / 1e6;
const uniq = xs => [...new Set(xs)];

// ---------------------------------------------------------------------------------------------- config and arms
function seedList(seeds) {
  if (Array.isArray(seeds)) return seeds.map(Number);
  const m = typeof seeds === 'string' && seeds.match(/^(\d+)\.\.(\d+)$/);
  if (m) return Array.from({ length: Number(m[2]) - Number(m[1]) + 1 }, (_, i) => Number(m[1]) + i);
  if (seeds && Number.isInteger(seeds.from) && Number.isInteger(seeds.to)) return seedList(`${seeds.from}..${seeds.to}`);
  throw new Error(`segment seeds must be a list, "a..b" or {from,to}: ${JSON.stringify(seeds)}`);
}

export function normalizeConfig(raw) {
  for (const k of ['experiment', 'familyId', 'split']) if (typeof raw?.[k] !== 'string' || !raw[k]) throw new Error(`config.${k} is required`);
  if (!/^[\w.-]+$/.test(raw.experiment)) throw new Error('config.experiment must match [\\w.-]+');
  if (!Array.isArray(raw.segments) || !raw.segments.length) throw new Error('config.segments must be a non-empty list');
  if (!Array.isArray(raw.arms) || !raw.arms.length) throw new Error('config.arms must be a non-empty list');
  const segments = raw.segments.map(s => ({ difficulty: Number(s.difficulty ?? 3), seeds: seedList(s.seeds) }));
  // SPEC §6.4: held-out streams use fresh test seeds >= 7001 (5001-5006 and 6001-6004 are burned).
  if (raw.split === 'test' && segments.some(s => s.seeds.some(x => x < 7001))) throw new Error('test-split streams must use fresh seeds >= 7001');
  const jit = { ...DEFAULT_JIT, ...(raw.jit ?? {}) };
  if (jit.shadowEvery != null && jit.shadowEvery !== false && !(Number.isInteger(jit.shadowEvery) && jit.shadowEvery >= 0)) throw new Error('config.jit.shadowEvery must be an integer >= 0 (0: no scheduled shadows)');
  if (jit.shadowOnFlags != null && typeof jit.shadowOnFlags !== 'boolean') throw new Error('config.jit.shadowOnFlags must be true or false');
  if (!jit.shadowOnFlags) delete jit.shadowOnFlags;
  if (jit.compare != null && !JIT_COMPARE_MODES.includes(jit.compare)) throw new Error(`config.jit.compare must be one of ${JIT_COMPARE_MODES.join(', ')}`);
  if (jit.compare === 'tolerant') { delete jit.allowLooseTolerance; Object.assign(jit, tolerance(raw.jit)); }
  else if (TOL_KEYS.some(k => jit[k] != null)) throw new Error('config.jit.relTol, absTol, tolerantKeys and allowLooseTolerance need jit.compare \'tolerant\'');
  else for (const k of TOL_KEYS) delete jit[k];
  const compile = { ...DEFAULT_COMPILE, ...(raw.compile ?? {}), fallback: { ...DEFAULT_COMPILE.fallback, ...(raw.compile?.fallback ?? {}) } };
  if (compile.promptVersion != null) compile.promptVersion = promptVersionOf(compile);
  if (raw.compile?.fallback && 'promptVersion' in raw.compile.fallback) throw new Error('config.compile.fallback.promptVersion is not supported: compile.promptVersion applies to the fallback compiler too');
  for (const k of ['compare', ...TOL_KEYS, 'acceptance', 'minPartial']) if (raw.compile?.fallback && k in raw.compile.fallback) throw new Error(`config.compile.fallback.${k} is not supported: compile.${k} applies to the fallback compiler too`);
  if (compile.promptVersion == null || compile.promptVersion === 1) delete compile.promptVersion;
  // A tolerant stream stores shadow answers (fitted numbers) as regression cases, which a canonical host check would then
  // require digit for digit: so a tolerant jit.compare makes the host check tolerant too, and refuses an explicit canonical.
  if (jit.compare === 'tolerant' && compile.compare === 'canonical') throw new Error('config.compile.compare \'canonical\' with jit.compare \'tolerant\': regression cases taken from tolerant adjudications would have to match to the last digit; leave compile.compare unset (it follows jit) or set it \'tolerant\'');
  compile.compare ??= jit.compare === 'tolerant' ? 'tolerant' : 'canonical';
  if (!['canonical', 'tolerant'].includes(compile.compare)) throw new Error('config.compile.compare must be canonical or tolerant');
  if (compile.compare === 'tolerant') {
    const from = jit.compare === 'tolerant' ? jit : {}, t = Object.fromEntries(TOL_KEYS.map(k => [k, compile[k] ?? from[k]]));
    for (const k of TOL_KEYS) delete compile[k];
    Object.assign(compile, tolerance(t));
  } else if (TOL_KEYS.some(k => compile[k] != null)) throw new Error('config.compile.relTol, absTol, tolerantKeys and allowLooseTolerance need compile.compare \'tolerant\'');
  else { delete compile.compare; for (const k of TOL_KEYS) delete compile[k]; }
  compile.acceptance = acceptanceModeOf(compile.acceptance);
  if (compile.acceptance === 'strict' && (compile.promptVersion ?? 1) < 3) throw new Error('config.compile.acceptance \'strict\' needs compile.promptVersion 3 (earlier prompts never ask for verbatim quotes)');
  if (compile.acceptance === 'strict') compile.minPartial = minPartialOf(compile.minPartial);
  else if (compile.minPartial != null) throw new Error('config.compile.minPartial needs compile.acceptance \'strict\'');
  else { delete compile.acceptance; delete compile.minPartial; }
  return {
    ...raw, segments, jit, compile,
    perTaskUsd: raw.perTaskUsd ?? 1, agentBudgetUsd: raw.agentBudgetUsd ?? 1, agentMinutes: raw.agentMinutes ?? 15, agentEffort: raw.agentEffort ?? null,
    compiledMinutes: raw.compiledMinutes ?? 20, concurrency: raw.concurrency ?? 3, staticFallback: raw.staticFallback ?? STATIC_FALLBACK,
    gatewayModels: raw.gatewayModels ?? [...POLICY_MODELS], spendStopUsd: raw.spendStopUsd ?? null,
  };
}

const slugify = s => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
export function parseArm(spec, config, { policyIds = null } = {}) {
  const i = spec.indexOf(':');
  const kind = spec.slice(0, i), rest = spec.slice(i + 1);
  let arm;
  if (kind === 'agent') arm = { kind, model: rest, models: [rest], slug: `agent-${slugify(rest)}` };
  else if (kind === 'static') {
    const scriptPath = path.resolve(REPO, rest);
    const p = path.parse(scriptPath);
    arm = { kind, scriptPath, fallback: config.staticFallback, models: uniq([...config.gatewayModels, config.staticFallback]).sort(),
      slug: `static-${slugify(path.basename(p.dir))}-${slugify(p.name)}` };
  } else if (kind === 'jit') {
    const [interpreter, compiler] = rest.split('/');
    if (!interpreter || !compiler) throw new Error(`jit arm needs <interpreter>/<compiler>: ${spec}`);
    arm = { kind, interpreter, compiler, fallback: config.jit.compilerFallback,
      models: uniq([...config.gatewayModels, interpreter, compiler, ...(config.jit.compilerFallback ? [config.jit.compilerFallback] : [])]).sort(),
      slug: `jit-${slugify(interpreter)}--${slugify(compiler)}` };
  } else throw new Error(`unknown arm kind in ${spec} (agent:, static:, jit:)`);
  arm.spec = spec;
  // Model ids only from the owner policy file (SPEC §6.4); nothing falls back silently.
  const ids = policyIds ?? loadPolicy().policy.models.map(m => m.id);
  for (const m of uniq([...arm.models, arm.model, arm.interpreter, arm.compiler, arm.fallback].filter(Boolean))) if (!ids.includes(m)) throw new Error(`${spec}: model ${m} is not in policy/models.json`);
  // The arm definition hash: a resume never mixes rows recorded under another definition (tasks are checked per row).
  const def = { spec, familyId: config.familyId, split: config.split, perTaskUsd: config.perTaskUsd, agentBudgetUsd: config.agentBudgetUsd, agentMinutes: config.agentMinutes,
    agentEffort: config.agentEffort, models: arm.models,
    ...(kind === 'static' ? { scriptSha: existsSync(arm.scriptPath) ? sha(readFileSync(arm.scriptPath)) : null, compiledMinutes: config.compiledMinutes, fallback: arm.fallback } : {}),
    ...(kind === 'jit' ? { jit: config.jit, compile: config.compile, compiledMinutes: config.compiledMinutes } : {}) };
  arm.def = def; arm.hash = sha(canonical(def)).slice(0, 16);
  return arm;
}

export const matchArm = (arm, filters) => !filters?.length || filters.some(f => f === arm.spec || f === arm.slug || f === arm.kind);

// ---------------------------------------------------------------------------------------------- JIT helpers
// SPEC §6.2: answers are compared as canonical JSON. 'unordered' (opt-in) treats every array as a multiset. 'tolerant'
// (opt-in, v2.1) is compare.mjs tolerantEqual at tol.relTol / tol.absTol (defaults 0.01 / 1e-9): arrays as multisets too.
export function sameAnswer(a, b, mode = 'canonical', tol = {}) {
  if (a == null || b == null) return false;
  if (mode === 'tolerant') return tolerantEqual(a, b, tolOf(tol));
  if (mode === 'unordered') {
    const norm = v => Array.isArray(v) ? v.map(norm).sort((x, y) => (canonical(x) < canonical(y) ? -1 : canonical(x) > canonical(y) ? 1 : 0))
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)])) : v;
    return canonical(norm(a)) === canonical(norm(b));
  }
  return canonical(a) === canonical(b);
}

const DEOPT_KINDS = new Set(['guard', 'invariant', 'judge', 'budget', 'unknown', 'crash', 'timeout', 'invalid']);
// SPEC §3.1: up to max traces, newest first, every deopt kind seen so far represented (its newest trace).
export function selectTraces(pool, max) {
  const newest = [...pool].sort((a, b) => b.idx - a.idx || b.seq - a.seq);
  const picked = [], seen = new Set();
  for (const t of newest) if (DEOPT_KINDS.has(t.kind) && !seen.has(t.kind) && picked.length < max) { seen.add(t.kind); picked.push(t); }
  for (const t of newest) if (picked.length < max && !picked.includes(t)) picked.push(t);
  return picked.sort((a, b) => b.idx - a.idx || b.seq - a.seq);
}

// check-traces records (compile.mjs): {exact (count), exactRate, partial, deopts, crashes, regressions, regressionsPassed,
// perCase: [{id: 'trace-<i>'|'case-<i>', ref: traceId|caseId, kind: 'trace'|'regression', status: exact|diff|deopt|crash|
// timeout|unlabeled, exact?, partial?}]}. Cases are matched across compiles by ref (the positional id changes).
const caseId = e => e?.ref ?? e?.traceId ?? e?.regressionId ?? e?.caseId ?? e?.id ?? e?.name ?? null;
const compactCheck = ct => (ct ? { exact: ct.exact ?? null, exactRate: ct.exactRate ?? null, partial: ct.partial ?? null, deopts: ct.deopts ?? null, crashes: ct.crashes ?? null,
  timeouts: ct.timeouts ?? null, deoptKinds: ct.deoptKinds ?? null, cases: ct.cases ?? null, labeled: ct.labeled ?? null, diffs: ct.diffs ?? null,
  regressions: ct.regressions ?? null, regressionsPassed: ct.regressionsPassed ?? null, clean: ct.clean ?? null, unexplained: ct.unexplained ?? null,
  accepted: ct.accepted ?? null, error: ct.error ?? null, recheck: ct.recheck ?? null,
  ...(ct.compare ? { compare: ct.compare, canonicalExact: ct.canonicalExact ?? null } : {}), ...(ct.acceptance ? { acceptance: ct.acceptance } : {}),
  perCase: perCaseList(ct).map(e => ({ id: e.id ?? null, ref: caseId(e), kind: e.kind ?? null, status: e.status ?? null, exact: caseExact(e) === 1, partial: e.partial ?? null })) } : null);
const caseExact = e => (typeof e?.exact === 'boolean' ? (e.exact ? 1 : 0) : typeof e?.exact === 'number' ? (e.exact >= 1 ? 1 : 0) : e?.status === 'exact' ? 1 : 0);
const perCaseList = ct => (Array.isArray(ct?.perCase) ? ct.perCase : ct?.perCase && typeof ct.perCase === 'object' ? Object.entries(ct.perCase).map(([id, v]) => ({ id, ...(typeof v === 'object' ? v : { exact: v }) })) : []);
export function exactOf(ct) {
  if (!ct) return 0;
  if (typeof ct.exactRate === 'number') return ct.exactRate;
  const cases = perCaseList(ct).filter(e => e.status !== 'unlabeled');
  if (cases.length) return cases.reduce((s, e) => s + caseExact(e), 0) / cases.length;
  const n = Number(ct.cases ?? ct.total ?? 0), x = Number(ct.exact ?? 0);
  return x > 1 && n ? x / n : x > 1 ? 1 : x;
}
// Acceptance is compile.mjs's verdict: the host check is clean (no crash, deopt or timeout on any case, every regression
// case passes) and every diff case is named in BUILD-NOTES.md. exactOf() is a logged diagnostic only.
export const accepted = ct => ct?.accepted === true;
// Exact cases on the old version's cases, matched by ref (traceId / caseId); cases the new check did not run are left out.
export function exactOnOld(newCt, oldCt) {
  const oldCases = perCaseList(oldCt).filter(e => caseId(e) != null), newById = new Map(perCaseList(newCt).filter(e => caseId(e) != null).map(e => [caseId(e), e]));
  const shared = oldCases.filter(e => newById.has(caseId(e)));
  return { shared: shared.length, oldExact: shared.reduce((s, e) => s + caseExact(e), 0), newExact: shared.reduce((s, e) => s + caseExact(newById.get(caseId(e))), 0) };
}
// SPEC §6.2.4 (as reconciled with compile.mjs): a recompiled version replaces the current one only if its host check is
// clean and its exact count on the old cases is no lower. Returns the reason to reject, or null.
export function rejectReason(newCt, oldCt) {
  if (!oldCt) return null;
  if (!newCt?.clean) return 'not clean';
  const o = exactOnOld(newCt, oldCt);
  if (o.shared) return o.newExact < o.oldExact ? `fewer exact on the old cases (${o.newExact} < ${o.oldExact} of ${o.shared})` : null;
  return exactOf(newCt) + 1e-9 < exactOf(oldCt) ? 'lower exact rate (no shared case ids)' : null;
}
export const worseOnOld = (newCt, oldCt) => rejectReason(newCt, oldCt) != null;

// checkTraces from a hostCheck() result, by compile.mjs's rule (acceptance.mjs): by default accepted = clean and every diff
// case named in BUILD-NOTES.md; opts.acceptance 'strict' (with opts.minPartial, opts.traces and opts.regressions, the case
// inputs) applies the strict rule; opts.compare (the comparison object) is recorded as compile.mjs records it.
export function checkFromSummary(check, workdir, regressions = 0, opts = {}) {
  const s = check?.summary ?? null;
  const notesFile = workdir ? path.join(workdir, 'BUILD-NOTES.md') : null;
  const notes = notesFile && existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : null;
  const verdict = judgeAcceptance({ summary: s, notes, mode: opts.acceptance ?? 'named', minPartial: opts.minPartial, tasks: caseTasks(opts.traces ?? [], opts.regressions ?? []) });
  const unexplained = verdict.unexplained;
  return {
    exact: s?.exact ?? 0, partial: s?.partial ?? null, deopts: s?.deopts ?? 0, crashes: s?.crashes ?? 0, perCase: s?.perCase ?? [],
    cases: s?.cases ?? 0, labeled: s?.labeled ?? 0, exactRate: s?.exactRate ?? null, diffs: s?.diffs ?? 0, deoptKinds: s?.deoptKinds ?? {}, timeouts: s?.timeouts ?? 0,
    regressions: s?.regressions ?? regressions, regressionsPassed: s?.regressionsPassed ?? 0, clean: !!s?.clean, unexplained,
    accepted: verdict.accepted, costUsd: check?.costUsd ?? 0, calls: check?.calls ?? 0, unknownCalls: check?.unknownCalls ?? 0, refusals: check?.refusals ?? {},
    durationMs: check?.durationMs ?? null, error: check?.error ?? null,
    ...(opts.compare ? { compare: opts.compare, canonicalExact: s?.canonicalExact ?? null } : {}), ...(verdict.acceptance ? { acceptance: verdict.acceptance } : {}),
  };
}

// ---------------------------------------------------------------------------------------------- per-arm files
export const armPaths = (runDir, slug) => {
  const dir = path.join(runDir, slug);
  return { dir, results: path.join(dir, 'results.jsonl'), events: path.join(dir, 'events.jsonl'), faults: path.join(dir, 'faults.jsonl'), journal: path.join(dir, 'journal.sqlite'),
    traces: path.join(dir, 'traces'), versions: path.join(dir, 'versions'), regressions: path.join(dir, 'regressions') };
};

// The fault class of a component result: its own error, a builder session's error, or a model call it made.
const faultCode = r => r?.error?.code ?? r?.record?.builderError?.code ?? (Object.keys(r?.meta?.errors ?? {}).join(',') || null);
class EnvFault extends Error {
  constructor(component, result) {
    super(`${component}: environment fault ${faultCode(result)} (after one retry)`);
    this.code = 'ENV_FAULT'; this.component = component; this.result = result;
  }
}
class SpendStop extends Error { constructor(msg) { super(msg); this.code = 'SPEND_STOP'; } }

// Default dependencies (the live ones). Tests inject fakes for all of them.
// Each is imported on first use, so a dry run works before every module exists.
async function liveDeps() {
  const beds = await import('../lib/beds.mjs');
  return {
    interpret: async a => (await import('./interpret.mjs')).interpret(a),
    runCompiled: async a => (await import('./run-compiled.mjs')).runCompiled(a),
    compile: async a => (await import('./compile.mjs')).compile(a),
    // compile.mjs's host acceptance check again, on the solve.mjs the builder left, at a higher cap.
    recheck: async ({ workdir, solvePath, traces, regressions, modelPort, models, capUsd, label, promptVersion, compare }) => (await import('./compile.mjs')).hostCheck({
      dir: path.join(workdir, '.host-check-recheck'), solveSource: readFileSync(solvePath, 'utf8'), traces, regressions, modelPort, models, capUsd, label, promptVersion, compare }),
    createModelPort: a => createModelPortSync(a),
    score: beds.score, makeTasks: beds.makeTasks, loadFamily: beds.loadFamily,
  };
}

export async function streamTasks(config, deps) {
  const out = [];
  for (const seg of config.segments) for (const t of await deps.makeTasks(config.familyId, { split: config.split, seeds: seg.seeds, difficulty: seg.difficulty })) out.push({ ...t, idx: out.length });
  return out;
}

// One process per arm at a time: <armDir>/.lock holds the owner's pid; a lock whose process is gone is taken over.
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function lockArm(dir) {
  const file = path.join(dir, '.lock');
  for (let i = 0; i < 2; i++) {
    try { writeFileSync(file, String(process.pid), { flag: 'wx' }); return () => rmSync(file, { force: true }); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(readFileSync(file, 'utf8'));
      if (pid && pid !== process.pid && alive(pid)) throw new Error(`arm directory ${dir} is in use by process ${pid}`);
      if (pid === process.pid) throw new Error(`arm directory ${dir} is already open in this process`);
      rmSync(file, { force: true });
    }
  }
  throw new Error(`could not lock ${dir}`);
}

// ---------------------------------------------------------------------------------------------- one arm
class ArmRun {
  constructor({ arm, config, runDir, workRoot, deps, log, budget, binary }) {
    Object.assign(this, { arm, config, deps, log, budget, binary });
    this.p = armPaths(runDir, arm.slug);
    this.work = path.join(workRoot, config.experiment, arm.slug);
    for (const d of [this.p.dir, this.p.traces, this.p.versions, this.p.regressions]) mkdirSync(d, { recursive: true });
    this.rows = new Map();
    for (const r of readJsonl(this.p.results)) {
      if (r.experiment !== config.experiment) continue;
      if (r.armHash !== arm.hash) throw new Error(`resume would mix versions of ${arm.spec} (${r.armHash} vs ${arm.hash}): use a new experiment name`);
      this.rows.set(r.idx, r);
    }
    // Spend recorded by attempts that never finished a row (a crash or a fault): billed to the next row of that index.
    const billed = new Set([...this.rows.values()].flatMap(r => r.spendIds ?? []));
    this.unbilled = new Map();
    this.compileDone = new Map();
    for (const e of readJsonl(this.p.events)) {
      if (e.kind === 'spend' && !billed.has(e.id)) { if (!this.unbilled.has(e.idx)) this.unbilled.set(e.idx, []); this.unbilled.get(e.idx).push(e); }
      if (e.kind === 'compile-attempt' && e.key) this.compileDone.set(e.key, e);
    }
    // Last: a refused resume above takes no lock. Then this arm's definition, beside its rows (a per-arm file).
    this.unlock = lockArm(this.p.dir);
    writeFileSync(path.join(this.p.dir, 'arm.json'), JSON.stringify({ experiment: config.experiment, spec: arm.spec, slug: arm.slug, kind: arm.kind, hash: arm.hash, def: arm.def }, null, 1));
  }

  event(idx, kind, data = {}) {
    const e = { at: new Date().toISOString(), arm: this.arm.spec, idx, kind, ...data };
    appendFileSync(this.p.events, JSON.stringify(e) + '\n');
    return e;
  }

  begin(t) {
    if (this.config.spendStopUsd != null && this.budget.spent > this.config.spendStopUsd) throw new SpendStop(`spend stop: $${this.budget.spent.toFixed(2)} > $${this.config.spendStopUsd}`);
    const run = this;
    return {
      idx: t.idx, events: [], breakdown: {}, spendIds: [], costUnknown: false, started: Date.now(),
      ev(kind, data = {}) { const e = run.event(t.idx, kind, data); const { at, arm, idx, ...compact } = e; this.events.push(compact); return compact; },
      spend(component, usd, unknown = false) {
        const id = `${t.idx}-${component}-${randomUUID().slice(0, 8)}`, costUsd = round(Number(usd) || 0);
        run.event(t.idx, 'spend', { id, component, costUsd, costUnknown: !!unknown });
        this.breakdown[component] = round((this.breakdown[component] ?? 0) + costUsd); this.spendIds.push(id); this.costUnknown ||= !!unknown;
        run.budget.spent += costUsd;
      },
    };
  }

  async finish(tr, t, { delivered, output, version = null, compiledStatus = null, deoptKind = null, error = null, extra = {}, stateAfter }) {
    // Bill the spend of earlier, unfinished attempts at this index (crash, fault) so every dollar sits in some row.
    let orphanUsd = 0;
    for (const e of this.unbilled.get(t.idx) ?? []) { tr.breakdown[e.component] = round((tr.breakdown[e.component] ?? 0) + e.costUsd); tr.spendIds.push(e.id); orphanUsd += e.costUsd; tr.costUnknown ||= !!e.costUnknown; }
    this.unbilled.delete(t.idx);
    const verdict = output == null ? { pass: false, score: 0, details: { noOutput: true } } : await this.deps.score(this.config.familyId, t.task, output);
    const row = {
      experiment: this.config.experiment, arm: this.arm.spec, armSlug: this.arm.slug, armHash: this.arm.hash, kind: this.arm.kind,
      idx: t.idx, taskId: t.task.id ?? t.taskKey, taskKey: t.taskKey, taskHash: t.taskHash, seed: t.task.seed ?? null, difficulty: t.task.difficulty ?? null,
      delivered, pass: !!verdict.pass, score: verdict.score ?? null,
      costUsd: round(Object.values(tr.breakdown).reduce((s, x) => s + x, 0)), costBreakdown: tr.breakdown, costUnknown: tr.costUnknown, orphanUsd: round(orphanUsd),
      latencyMs: Date.now() - tr.started, events: tr.events, version, compiledStatus, deoptKind, error,
      oracleDetails: verdict.details ? JSON.stringify(verdict.details).slice(0, 2000) : null, spendIds: tr.spendIds, ...extra,
      ...(stateAfter ? { stateAfter } : {}), at: new Date().toISOString(),
    };
    appendFileSync(this.p.results, JSON.stringify(row) + '\n');
    this.rows.set(t.idx, row);
    this.log(`${this.arm.slug} #${t.idx} ${t.taskKey}: ${row.pass ? 'PASS' : 'fail'} score=${row.score} by=${delivered}${version ? ` v${version}` : ''} $${row.costUsd.toFixed(4)}`);
    return row;
  }

  fault(t, err) {
    appendFileSync(this.p.faults, JSON.stringify({ experiment: this.config.experiment, arm: this.arm.spec, idx: t.idx, taskKey: t.taskKey, component: err.component,
      error: err.result?.error ?? null, metaErrors: err.result?.meta?.errors ?? null, builderError: err.result?.record?.builderError ?? null, at: new Date().toISOString() }) + '\n');
    this.event(t.idx, 'fault', { component: err.component, code: faultCode(err.result) });
    this.log(`${this.arm.slug} #${t.idx}: ENV FAULT in ${err.component} (not recorded as an outcome; a resume retries it)`);
  }

  // Environment faults are retried once, then raised as EnvFault (never a task failure).
  async retrying(tr, component, fn, isFault) {
    for (let attempt = 0; ; attempt++) {
      const r = await fn(attempt);
      if (!isFault(r)) return r;
      if (attempt === 0) { tr.ev('fault-retry', { component, code: faultCode(r) }); continue; }
      throw new EnvFault(component, r);
    }
  }

  async interpret(tr, t, role, model) {
    return this.retrying(tr, role, async attempt => {
      const traceId = `i${String(t.idx).padStart(3, '0')}-${role}-${randomUUID().slice(0, 6)}`;
      const workdir = path.join(this.work, traceId);
      rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
      const trace = await this.deps.interpret({ task: t.task, familyId: this.config.familyId, outputSchema: this.outputSchema, model, budgetUsd: this.config.agentBudgetUsd,
        timeoutMs: this.config.agentMinutes * 60 * 1000, workdir, effort: this.config.agentEffort, traceId, ...(this.binary ? { binary: this.binary } : {}) });
      writeFileSync(path.join(this.p.traces, `${trace.traceId}.json`), JSON.stringify(trace));
      tr.spend(role, trace.costUsd ?? 0, trace.costUnknown);
      tr.ev('interpret', { role, model, traceId: trace.traceId, answer: trace.answer != null, error: trace.error?.code ?? null, costUsd: trace.costUsd ?? 0, attempt,
        nestedModelAttempts: trace.nestedModelAttempts ?? 0, hiddenPathAttempts: trace.hiddenPathAttempts ?? 0 });
      return trace;
    }, trace => ENV_FAULTS.has(trace?.error?.code));
  }

  async compiled(tr, t, solvePath, version) {
    return this.retrying(tr, 'compiled', async attempt => {
      const workdir = path.join(this.work, `i${String(t.idx).padStart(3, '0')}-compiled-${randomUUID().slice(0, 6)}`);
      rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
      const rc = await this.deps.runCompiled({ solvePath, task: t.task, modelPort: this.port, perTaskUsd: this.config.perTaskUsd, timeoutMs: this.config.compiledMinutes * 60 * 1000,
        workdir, familyId: this.config.familyId, outputSchema: this.outputSchema, allowedModels: this.arm.models, label: `${this.config.experiment}:${this.arm.slug}:${t.idx}:v${version ?? 0}`,
        ...(this.flowPath ? { flowPath: this.flowPath } : {}) });
      tr.spend('compiled', rc.costUsd ?? 0, rc.costUnknown);
      tr.ev('compiled', { version, status: rc.status, deoptKind: rc.deopt?.kind ?? null, costUsd: rc.costUsd ?? 0, attempt, error: rc.error?.code ?? null,
        ...(rc.flags?.count ? { flags: rc.flags.count } : {}) });
      return rc;
    }, rc => rc?.status !== 'ok' && metEnvFault(rc));
  }

  async runTask(t) {
    const tr = this.begin(t);
    if (this.arm.kind === 'agent') {
      const trace = await this.interpret(tr, t, 'interpreter', this.arm.model);
      return this.finish(tr, t, { delivered: 'interpreter', output: trace.answer, error: trace.error ?? null, extra: { traceId: trace.traceId } });
    }
    // static
    const rc = await this.compiled(tr, t, this.arm.scriptPath, null);
    if (rc.status === 'ok') return this.finish(tr, t, { delivered: 'compiled', output: rc.output, compiledStatus: 'ok' });
    const dk = rc.status === 'deopt' ? rc.deopt?.kind ?? 'unknown' : rc.status;
    tr.ev(rc.status === 'deopt' ? 'deopt' : rc.status, { deoptKind: dk, detail: rc.deopt?.name ?? rc.error?.code ?? null });
    tr.ev('fallback', { model: this.arm.fallback });
    const trace = await this.interpret(tr, t, 'fallback', this.arm.fallback);
    return this.finish(tr, t, { delivered: 'interpreter', output: trace.answer, compiledStatus: rc.status, deoptKind: dk, error: trace.error ?? null, extra: { traceId: trace.traceId } });
  }
}

// ---------------------------------------------------------------------------------------------- the JIT arm
const freshState = () => ({ traces: [], regressions: [], version: null, versionsCount: 0, deoptsSinceCompile: 0, compiledOks: 0, pendingCompile: 'initial', fallbacksUsed: 0 });

class JitRun extends ArmRun {
  // Prompt version 2 solvers run on flow-v2.mjs; version 1 keeps run-compiled's default (flow.mjs, frozen), passing nothing.
  get flowPath() { const v = this.config.compile.promptVersion; return v && v >= 2 ? path.join(HERE, flowFileOf({ promptVersion: v })) : null; }
  get v2() { return !!(this.config.jit.shadowOnFlags || (this.config.compile.promptVersion ?? 1) >= 2); }
  // v2.1 compile options, only when set (a default arm passes exactly what it passed before).
  get compileOpts() {
    const c = this.config.compile;
    return { ...(c.compare ? { compare: c.compare, ...tolOf(c) } : {}), ...(c.acceptance ? { acceptance: c.acceptance, minPartial: c.minPartial } : {}) };
  }
  get compareOf() { const c = this.config.compile; return c.compare === 'tolerant' ? { mode: 'tolerant', ...tolOf(c) } : null; }

  addTrace(state, trace, t, role, kind) {
    if (trace?.answer == null) return false;   // the compiler distils answers, not failures
    state.traces.push({ traceId: trace.traceId, idx: t.idx, seq: state.traces.length, role, kind });
    return true;
  }
  loadTrace(id) { return JSON.parse(readFileSync(path.join(this.p.traces, `${id}.json`), 'utf8')); }

  // One builder session (or its record from before a crash: compile-attempt events are reused, never re-bought).
  async compileAttempt(tr, t, state, n, builderModel, settings, inputs) {
    const tag = builderModel.replace(/^claude-/, '').replace(/[^a-z0-9]+/gi, '');
    const key = `v${n}-${tag}-${inputs.hash}`;
    const vdir = path.join(this.p.versions, `v${n}-${tag}`);
    const prior = this.compileDone.get(key);
    if (prior) {
      tr.ev('compile-reused', { version: n, builderModel, key });
      return { ...prior.result, dir: vdir, reused: true };
    }
    const res = await this.retrying(tr, 'compile', async attempt => {
      const r = await this.deps.compile({ familyId: this.config.familyId, traces: inputs.traces, previous: inputs.previous, regressions: inputs.regressions, builderModel,
        builderEffort: settings.builderEffort, builderBudgetUsd: settings.builderBudgetUsd, gatewayUsd: settings.gatewayUsd, checkUsd: settings.checkUsd ?? settings.gatewayUsd,
        minutes: settings.minutes, perTaskUsd: this.config.perTaskUsd, ...(this.config.compile.promptVersion ? { promptVersion: this.config.compile.promptVersion } : {}),
        ...this.compileOpts, modelPort: this.port, workRoot: path.join(this.work, 'compile'), label: `v${n}-${tag}${attempt ? `-r${attempt}` : ''}`, models: this.arm.models, version: n });
      const rec = r.record ?? {};
      // Every dollar of the compile: the builder session, its gateway calls, and the host acceptance check.
      tr.spend('compileBuilder', rec.builderCostUsd ?? 0, rec.builderCostUnknown);
      tr.spend('compileGateway', rec.gatewayCostUsd ?? 0, (rec.gatewayUnknownCalls ?? 0) > 0);
      if (rec.checkCostUsd) tr.spend('compileCheck', rec.checkCostUsd, (rec.checkTraces?.unknownCalls ?? 0) > 0);
      return r;
    }, r => ENV_FAULTS.has(r?.record?.builderError?.code) || ENV_FAULTS.has(r?.record?.checkTraces?.error?.code));
    const rec = res.record ?? {};
    const hasSolve = !!(res.solvePath && existsSync(res.solvePath));
    // A host check that hit budget deopts is re-run once at twice the check cap before acceptance is judged.
    let recheckUsd = 0;
    if (hasSolve && (rec.checkTraces?.deoptKinds?.budget ?? 0) > 0) {
      const capUsd = 2 * (settings.checkUsd ?? settings.gatewayUsd);
      tr.ev('recheck', { version: n, builderModel, reason: 'budget deopts in the host check', budgetDeopts: rec.checkTraces.deoptKinds.budget, capUsd });
      const rc = await this.deps.recheck({ workdir: res.workdir, solvePath: res.solvePath, traces: inputs.traces, regressions: inputs.regressions, modelPort: this.port, models: this.arm.models,
        capUsd, label: `v${n}-${tag}-recheck`, ...(this.config.compile.promptVersion ? { promptVersion: this.config.compile.promptVersion } : {}),
        ...(this.compareOf ? { compare: this.compareOf } : {}) });
      recheckUsd = rc.costUsd ?? 0;
      tr.spend('compileCheck', recheckUsd, (rc.unknownCalls ?? 0) > 0);
      const how = this.config.compile.acceptance || this.compareOf ? { acceptance: this.config.compile.acceptance, minPartial: this.config.compile.minPartial, compare: this.compareOf,
        traces: inputs.traces, regressions: inputs.regressions } : {};
      rec.checkTraces = { ...checkFromSummary(rc, res.workdir, inputs.regressions.length, how), recheck: { capUsd, firstCheck: compactCheck(rec.checkTraces) } };
    }
    mkdirSync(vdir, { recursive: true });
    if (hasSolve) copyFileSync(res.solvePath, path.join(vdir, 'solve.mjs'));
    if (res.workdir && existsSync(path.join(res.workdir, 'BUILD-NOTES.md'))) copyFileSync(path.join(res.workdir, 'BUILD-NOTES.md'), path.join(vdir, 'BUILD-NOTES.md'));
    writeFileSync(path.join(vdir, 'compile.json'), JSON.stringify({ ...rec, inputs: { traceIds: inputs.traces.map(x => x.traceId), regressionIds: inputs.regressions.map(x => x.regressionId), previousSha: inputs.previous ? sha(inputs.previous) : null } }, null, 1));
    const result = { version: n, builderModel, hasSolve, solveSha: hasSolve ? sha(readFileSync(path.join(vdir, 'solve.mjs'))) : null, checkTraces: compactCheck(rec.checkTraces),
      nestedModelAttempts: rec.nestedModelAttempts ?? 0, hiddenPathAttempts: rec.hiddenPathAttempts ?? 0,
      costUsd: (rec.compileCostUsd ?? (rec.builderCostUsd ?? 0) + (rec.gatewayCostUsd ?? 0) + (rec.checkCostUsd ?? 0)) + recheckUsd,
      builderError: rec.builderError?.code ?? null, checkError: rec.checkTraces?.error?.code ?? null, builderAccepted: rec.checkTraces?.accepted ?? null,
      ...(this.config.compile.promptVersion ? { promptVersion: rec.promptVersion ?? this.config.compile.promptVersion } : {}) };
    const e = this.event(t.idx, 'compile-attempt', { key, result });
    this.compileDone.set(key, e);
    tr.events.push({ kind: 'compile-attempt', key, version: n, builderModel, exactRate: exactOf(result.checkTraces), accepted: accepted(result.checkTraces), clean: !!result.checkTraces?.clean,
      hasSolve, costUsd: result.costUsd });
    return { ...result, dir: vdir };
  }

  async doCompile(tr, t, state) {
    const pool = state.traces.map(x => ({ ...x }));
    if (!pool.length) { tr.ev('compile-skipped', { reason: 'no usable trace yet' }); return; }
    const n = state.versionsCount + 1;
    const traces = selectTraces(pool, this.config.jit.maxTraces).map(x => this.loadTrace(x.traceId));
    const regressions = state.regressions.map(id => JSON.parse(readFileSync(path.join(this.p.regressions, `${id}.json`), 'utf8')));
    const previous = state.version ? readFileSync(path.join(this.p.dir, state.version.dir, 'solve.mjs'), 'utf8') : null;
    const inputs = { traces, regressions, previous, hash: sha(canonical({ t: traces.map(x => x.traceId), r: state.regressions, p: previous ? sha(previous) : null })).slice(0, 12) };
    const reason = state.pendingCompile;
    const ok = a => a.hasSolve && a.nestedModelAttempts === 0 && accepted(a.checkTraces);
    const attempts = [await this.compileAttempt(tr, t, state, n, this.arm.compiler, this.config.compile, inputs)];
    const fb = this.arm.fallback;
    if (!ok(attempts[0]) && fb && fb !== this.arm.compiler && (this.config.jit.maxFallbacks == null || state.fallbacksUsed < this.config.jit.maxFallbacks)) {
      state.fallbacksUsed++;
      tr.ev('fallback-compile', { version: n, from: this.arm.compiler, to: fb, exactRate: exactOf(attempts[0].checkTraces), clean: !!attempts[0].checkTraces?.clean, hasSolve: attempts[0].hasSolve });
      attempts.push(await this.compileAttempt(tr, t, state, n, fb, this.config.compile.fallback, inputs));
    }
    state.versionsCount = n; state.deoptsSinceCompile = 0; state.pendingCompile = null;
    for (const a of attempts) if (a.nestedModelAttempts > 0) tr.ev('void', { version: n, builderModel: a.builderModel, nestedModelAttempts: a.nestedModelAttempts });
    // The best usable attempt: accepted first, then clean, then exact rate, then partial (the later attempt on a tie).
    const usable = attempts.filter(a => a.hasSolve && a.nestedModelAttempts === 0);
    const rank = a => [ok(a) ? 1 : 0, a.checkTraces?.clean ? 1 : 0, exactOf(a.checkTraces), Number(a.checkTraces?.partial ?? 0)];
    const best = usable.reverse().sort((a, b) => { const x = rank(a), y = rank(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] || y[3] - x[3]; })[0];
    if (!best) { tr.ev('compile-failed', { version: n, reason, attempts: attempts.map(a => a.builderModel) }); return; }
    const why = state.version ? rejectReason(best.checkTraces, state.version.checkTraces) : null;
    if (why) {
      tr.ev('rejected', { version: n, keep: state.version.n, why, ...exactOnOld(best.checkTraces, state.version.checkTraces), newExactRate: exactOf(best.checkTraces),
        oldExactRate: exactOf(state.version.checkTraces), builderModel: best.builderModel });
      return;
    }
    const kind = state.version ? 'recompile' : 'compile';
    state.version = { n, dir: path.relative(this.p.dir, best.dir), sha: best.solveSha, builderModel: best.builderModel, checkTraces: best.checkTraces, adoptedAt: t.idx, accepted: ok(best) };
    tr.ev(kind, { version: n, reason, builderModel: best.builderModel, exactRate: exactOf(best.checkTraces), accepted: ok(best), clean: !!best.checkTraces?.clean,
      traces: traces.length, regressions: regressions.length });
  }

  solvePathOf(state) {
    const p = path.join(this.p.dir, state.version.dir, 'solve.mjs');
    // Pinned: the executed script is the copy whose hash the state recorded.
    if (!existsSync(p) || sha(readFileSync(p)) !== state.version.sha) throw new Error(`${this.arm.slug}: version v${state.version.n} solve.mjs is missing or changed`);
    return p;
  }

  async runJitTask(t, state) {
    const tr = this.begin(t);
    const J = this.config.jit, model = this.arm.interpreter;
    const fallbackInterpret = async (statusKind, rc) => {
      const trace = await this.interpret(tr, t, 'interpreter', model);
      this.addTrace(state, trace, t, 'fallback', statusKind);
      state.deoptsSinceCompile++;
      if (state.deoptsSinceCompile >= J.recompileOnDeopts) state.pendingCompile ??= statusKind === 'no-version' ? 'no-version' : 'deopts';
      return { trace, rc };
    };
    if (t.idx >= J.warmup && state.pendingCompile) await this.doCompile(tr, t, state);
    if (t.idx < J.warmup) {
      const trace = await this.interpret(tr, t, 'interpreter', model);
      this.addTrace(state, trace, t, 'warmup', 'warmup');
      return this.finish(tr, t, { delivered: 'interpreter', output: trace.answer, error: trace.error ?? null, extra: { traceId: trace.traceId }, stateAfter: structuredClone(state) });
    }
    if (!state.version) {
      tr.ev('no-version');
      const { trace } = await fallbackInterpret('no-version');
      return this.finish(tr, t, { delivered: 'interpreter', output: trace.answer, error: trace.error ?? null, extra: { traceId: trace.traceId }, stateAfter: structuredClone(state) });
    }
    const version = state.version.n;
    const rc = await this.compiled(tr, t, this.solvePathOf(state), version);
    if (rc.status !== 'ok') {
      const dk = rc.status === 'deopt' ? rc.deopt?.kind ?? 'unknown' : rc.status;
      tr.ev(rc.status === 'deopt' ? 'deopt' : rc.status, { version, deoptKind: dk, detail: rc.deopt?.name ?? rc.error?.code ?? null });
      const { trace } = await fallbackInterpret(dk, rc);
      return this.finish(tr, t, { delivered: 'interpreter', output: trace.answer, version, compiledStatus: rc.status, deoptKind: dk, error: trace.error ?? null,
        extra: { traceId: trace.traceId }, stateAfter: structuredClone(state) });
    }
    state.compiledOks++;
    let delivered = 'compiled', output = rc.output;
    const extra = {};
    const flags = rc.flags?.count ?? 0;
    if (flags > 0) extra.flags = { count: flags, names: rc.flags.names ?? [] };
    // Scheduled shadows (every shadowEvery-th compiled ok) and, opt-in, flag-triggered ones (the run raised flags).
    const scheduled = !!(J.shadowEvery && state.compiledOks % J.shadowEvery === 0), flagged = !!(J.shadowOnFlags && flags > 0);
    if (scheduled || flagged) {
      const reason = J.shadowOnFlags ? (scheduled && flagged ? 'schedule+flag' : scheduled ? 'schedule' : 'flag') : null;
      // Tolerant arms: did the tolerant agreement with the compiled answer also hold under canonical JSON? (a diagnostic)
      const canon = ans => (J.compare === 'tolerant' ? { canonicalAgree: sameAnswer(ans, rc.output) } : {});
      const why = reason ? { reason } : {};
      if (reason) extra.shadowReason = reason;
      // Shadow: the arm's interpreter on the same task, fresh session; it never sees the compiled answer.
      let s1 = null;
      try { s1 = await this.interpret(tr, t, 'shadow', model); }
      catch (e) { if (e.code !== 'ENV_FAULT') throw e; this.fault(t, e); tr.ev('shadow-fault', why); }
      if (s1) extra.shadowTraceId = s1.traceId;
      if (s1 && s1.answer == null) tr.ev('shadow', { version, agree: null, note: 'shadow gave no answer', ...why });
      else if (s1 && sameAnswer(s1.answer, rc.output, J.compare, J)) { tr.ev('shadow', { version, agree: true, ...why, ...canon(s1.answer) }); this.addTrace(state, s1, t, 'shadow', 'shadow'); }
      else if (s1) {
        tr.ev('shadow', { version, agree: false, ...why }); tr.ev('disagree', { version });
        let s2 = null;
        try { s2 = await this.interpret(tr, t, 'adjudicator', model); }
        catch (e) { if (e.code !== 'ENV_FAULT') throw e; this.fault(t, e); tr.ev('adjudicator-fault'); }
        if (s2) extra.adjudicatorTraceId = s2.traceId;
        if (s2 && sameAnswer(s2.answer, rc.output, J.compare, J)) tr.ev('adjudicate', { version, outcome: 'compiled', ...canon(s2.answer) });
        else if (s2 && sameAnswer(s2.answer, s1.answer, J.compare, J)) {
          // Compiled answer in the minority: deliver the majority, keep the case (never the oracle's verdict).
          delivered = 'adjudicated'; output = s1.answer;
          const regressionId = `reg-${String(t.idx).padStart(3, '0')}-${randomUUID().slice(0, 6)}`;
          writeFileSync(path.join(this.p.regressions, `${regressionId}.json`), JSON.stringify({ ...s1, regressionId, caseId: regressionId, expected: s1.answer, compiledOutput: rc.output, version,
            shadowTraceId: s1.traceId, adjudicatorTraceId: s2.traceId, idx: t.idx }));
          state.regressions.push(regressionId);
          this.addTrace(state, s1, t, 'shadow', 'shadow');
          tr.ev('adjudicate', { version, outcome: 'interpreter' }); tr.ev('regression', { version, regressionId });
          state.pendingCompile = 'regression';
        } else { tr.ev('adjudicate', { version, outcome: 'none' }); tr.ev('unresolved', { version }); }
      }
    }
    // The experimenter's view (v2 arms only, so v1 rows are unchanged): did the compiled answer itself pass, when another
    // answer was delivered? report.mjs compares flagged and unflagged compiled runs on it. Row only; no JIT state reads it.
    if (this.v2 && delivered !== 'compiled') extra.compiledPass = !!(await this.deps.score(this.config.familyId, t.task, rc.output))?.pass;
    return this.finish(tr, t, { delivered, output, version, compiledStatus: 'ok', extra, stateAfter: structuredClone(state) });
  }
}

// ---------------------------------------------------------------------------------------------- the stream
async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } }));
}

// runStream: returns { runDir, arms: [{spec, slug, done, errors}], rows }.
export async function runStream({ config: rawConfig, arms: filters = null, runRoot = RUN_ROOT, workRoot = WORK_ROOT, deps: injected = null, log = console.log, dry = false, binary = null,
  allowWorkInRepo = false }) {
  const config = normalizeConfig(rawConfig);
  const runDir = path.join(runRoot, config.experiment);
  // Sandboxed sessions hide the repository; workdirs live outside it (runner.mjs rule), traces and versions inside.
  if (!allowWorkInRepo && path.resolve(workRoot).startsWith(REPO + path.sep)) throw new Error(`workRoot must be outside the repository: ${workRoot}`);
  const deps = { ...(injected ? {} : await liveDeps()), ...(injected ?? {}) };
  if (!deps.makeTasks) deps.makeTasks = (await import('../lib/beds.mjs')).makeTasks;
  const policyIds = deps.policyIds ?? null;
  const arms = config.arms.map(spec => parseArm(spec, config, { policyIds })).filter(a => matchArm(a, filters));
  if (!arms.length) throw new Error(`no arm matches --arms ${filters?.join(',')}`);
  const tasks = await streamTasks(config, deps);
  if (dry) {
    const plan = { experiment: config.experiment, runDir, workRoot: path.join(workRoot, config.experiment), familyId: config.familyId, split: config.split,
      tasks: tasks.map(t => `#${t.idx} ${t.taskKey} ${t.taskHash?.slice(0, 12)}`),
      arms: arms.map(a => ({ spec: a.spec, slug: a.slug, hash: a.hash, models: a.models, done: readJsonl(armPaths(runDir, a.slug).results).filter(r => r.experiment === config.experiment).length })),
      caps: { perTaskUsd: config.perTaskUsd, agentBudgetUsd: config.agentBudgetUsd, agentMinutes: config.agentMinutes, compile: config.compile, jit: config.jit, spendStopUsd: config.spendStopUsd },
      worstCaseUsd: Object.fromEntries(arms.map(a => [a.spec, worstCase(a, config, tasks.length)])) };
    log(JSON.stringify(plan, null, 1));
    return { runDir, plan, arms: [], rows: [] };
  }
  mkdirSync(runDir, { recursive: true });
  const fam = deps.loadFamily ? await deps.loadFamily(config.familyId) : null;
  const outputSchema = deps.outputSchema ?? fam?.outputSchema ?? null;
  // Spend already recorded by these arms (for the optional spend stop).
  const budget = { spent: 0 };
  const runs = [];
  try {
    for (const arm of arms) {
      const R = arm.kind === 'jit' ? JitRun : ArmRun;
      const run = new R({ arm, config, runDir, workRoot, deps, log, budget, binary });
      runs.push(run);
      run.outputSchema = outputSchema;
      budget.spent += [...run.rows.values()].reduce((s, r) => s + (r.costUsd ?? 0), 0) + [...run.unbilled.values()].flat().reduce((s, e) => s + e.costUsd, 0);
    }
    return await driveArms({ runs, tasks, config, deps, log, runDir });
  } finally { for (const run of runs) run.unlock?.(); }
}

async function driveArms({ runs, tasks, config, deps, log, runDir }) {
  for (const run of runs) {
    for (const [idx, r] of run.rows) if (tasks[idx] && r.taskHash !== tasks[idx].taskHash) throw new Error(`${run.arm.slug}: recorded task #${idx} (${r.taskKey}) differs from the config's: use a new experiment name`);
    // One journal per arm directory (SQLite contention between arm processes); agent arms need no gateway.
    if (run.arm.kind !== 'agent') run.port = deps.createModelPort({ journalFile: run.p.journal, allowedModels: run.arm.models, concurrency: { 'claude-cli': 16 } }).port;
  }
  const status = new Map(runs.map(r => [r.arm.slug, { spec: r.arm.spec, slug: r.arm.slug, done: 0, faults: 0, errors: [] }]));
  const note = (run, error) => {
    const s = status.get(run.arm.slug);
    if (error.code === 'SPEND_STOP') { s.errors.push(error.message); return; }
    s.errors.push(String(error.stack ?? error.message ?? error).slice(0, 2000));
    log(`${run.arm.slug}: ERROR ${error.message}`);
  };
  // Agent and static arms: independent tasks under the concurrency cap, arm order rotated per task.
  const flat = runs.filter(r => r.arm.kind !== 'jit'), jobs = [];
  tasks.forEach((t, ti) => flat.forEach((_, ai) => { const run = flat[(ai + ti) % flat.length]; if (!run.rows.has(t.idx)) jobs.push([run, t]); }));
  const flatDone = pool(jobs, config.concurrency, async ([run, t]) => {
    const s = status.get(run.arm.slug);
    try { await run.runTask(t); s.done++; }
    catch (error) { if (error.code === 'ENV_FAULT') { run.fault(t, error); s.faults++; } else note(run, error); }
  });
  // JIT arms: sequential, in stream order; state comes from the last finished row.
  const streams = runs.filter(r => r.arm.kind === 'jit').map(async run => {
    const s = status.get(run.arm.slug);
    let state = freshState();
    for (const t of tasks) {
      const prior = run.rows.get(t.idx);
      if (prior) { state = structuredClone(prior.stateAfter ?? state); continue; }
      try { await run.runJitTask(t, state); s.done++; }
      catch (error) {
        if (error.code === 'ENV_FAULT') { run.fault(t, error); s.faults++; log(`${run.arm.slug}: stream stops at #${t.idx} (resume continues it here)`); }
        else note(run, error);
        return;
      }
    }
  });
  await Promise.all([flatDone, ...streams]);
  return { runDir, arms: [...status.values()], rows: runs.flatMap(r => [...r.rows.values()]) };
}

// Worst-case dollars per arm at the configured caps (planning only; real spend is measured).
function worstCase(arm, c, n) {
  // A compile: builder + gateway + host check, plus a recheck at twice the check cap.
  const cost = k => k.builderBudgetUsd + k.gatewayUsd + 3 * (k.checkUsd ?? k.gatewayUsd);
  const agent = c.agentBudgetUsd, comp = cost(c.compile), fb = cost(c.compile.fallback);
  if (arm.kind === 'agent') return round(n * agent);
  if (arm.kind === 'static') return round(n * (c.perTaskUsd + agent));
  const post = Math.max(0, n - c.jit.warmup);
  const compiles = 1 + Math.floor(post / Math.max(1, c.jit.recompileOnDeopts));
  return round(c.jit.warmup * agent + post * (c.perTaskUsd + 2 * agent) + compiles * (comp + (arm.fallback ? fb : 0)));
}

// ---------------------------------------------------------------------------------------------- CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, dflt = null) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : dflt);
  const file = arg('config');
  if (!file) { console.error('usage: node experiments/jit/stream.mjs --config <file> [--arms a,b] [--dry] [--run-root dir] [--work-root dir]'); process.exit(2); }
  const config = JSON.parse(readFileSync(path.resolve(file), 'utf8'));
  const filters = arg('arms')?.split(',').map(s => s.trim()).filter(Boolean) ?? null;
  const res = await runStream({ config, arms: filters, dry: process.argv.includes('--dry'), runRoot: path.resolve(arg('run-root', RUN_ROOT)), workRoot: path.resolve(arg('work-root', WORK_ROOT)) });
  if (res.arms.length) console.log(JSON.stringify(res.arms, null, 1));
  // 1: a harness error stopped an arm; 3: an environment fault stopped work (a resume continues it); 0: done.
  process.exit(res.arms.some(a => a.errors.length) ? 1 : res.arms.some(a => a.faults) ? 3 : 0);
}
