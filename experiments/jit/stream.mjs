// JIT stream runner (SPEC §6). One recurring stream of tasks, several arms:
//   agent:<model>                 interpret every task (independent; run under the concurrency cap)
//   static:<solve.mjs>            a fixed compiled script; deopt/crash/timeout/invalid -> claude-haiku-5-5 interpreter
//   jit:<interpreter>/<compiler>  warmup -> compile -> run compiled; deopt -> interpret + recompile; shadows,
//                                 adjudication by majority, regressions, reject-if-worse, one Opus fallback per compile
// Work layout (outside the repo): <workRoot>/<experiment>/<armSlug>/ holds compiled runs and compile/ builds;
// <workRoot>/<experiment>/w/<id> holds every interpreter-family session (agent, fallback, shadow, adjudicator) with an
// arm- and role-neutral name (see sessionIdOf); the 'interpret' event and trace file record the path.
// Every arm writes only its own directory (results.jsonl, events.jsonl, faults.jsonl, journal.sqlite, traces/,
// versions/, regressions/), so arms can run as separate processes and resume independently. The bed oracle scores the
// delivered answer only; nothing it says ever reaches an interpreter, a compiler or the JIT state.
// CLI: node experiments/jit/stream.mjs --config <file> [--arms a,b] [--dry] [--run-root dir] [--work-root dir]
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, rmSync, copyFileSync, readdirSync, statSync, renameSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { canonical } from '../../beds/lib/canonical.mjs';
import { loadPolicy } from '../../src/models/policy.mjs';
import { ENV_FAULTS, metEnvFault } from '../lib/runner.mjs';
import { createModelPort as createModelPortSync } from '../lib/models.mjs';
import { promptVersionOf, flowFileOf } from './prompts.mjs';
import { tolerantEqual, tolerance } from './compare.mjs';
import { judgeAcceptance, acceptanceModeOf, minPartialOf, caseTasks, applyRefusals, acceptanceIdsOf, readVerdicts, VERDICTS_FILE } from './acceptance.mjs';
import { requestDigestOf, looseDigestOf } from './run-compiled.mjs';
import { Ledger } from '../lib/services.mjs';
import { createRegistry, createCallHost, withCallModel, HARD_MAX_DEPTH, DEFAULT_MAX_DEPTH, DEFAULT_INTERPRET_FLOOR_USD, NOVEL_MODES, REGISTRY_FILE } from './call-host.mjs';
import { learnProfile, checkOptionsOf, PARAMS_V2, TOLERANT_CHECK } from './profile.mjs';
import { DEFAULT_AGENT_FLOOR_USD, TEXT_LABELS } from './agent-node.mjs';
import { assertSeedsAllowed, defaultPurpose, loadLedger } from './seeds.mjs';

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
//     events and rows then carry the reason ('schedule' | 'flag' | 'schedule+flag'; 'floor' | 'flag' | 'floor+flag' with
//     jit.shadowFloor, below). jit.shadowEvery 0 = no scheduled
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
// Step-0 options (BLOCKER-SYNTHESIS S0-1, S0-5, S0-6):
//   seedPurpose (default 'jit-heldout' on the test split, 'jit-dev' otherwise): the purpose the seed ledger
//     (research/jit-20261008/SEED-LEDGER.json, seeds.mjs) checks every segment's seeds against. Not hashed.
//   jit.adoptRequiresAcceptance (default false: today's rule, a usable version is adopted even with accepted: false): when
//     true, a version the acceptance check did not accept is never adopted (the current version, if any, is kept). Either
//     way an 'adoption' event records the verdict. Dropped at false, so no hash moves; true defines a new arm.
//   persist.commitDir (default unset: no mirror): every export (below) is also mirrored into this committed directory
//     (relative to the repository; '{experiment}' is replaced by config.experiment; true means DEFAULT_COMMIT_DIR).
//     persist.maxBodyBytes (default 262144): journal request/response bodies above it are written to bodies/<sha256>.json
//     in the local export (never mirrored) and the row keeps the digest and that path. Not hashed.
//   The export itself always runs: <runDir>/export/<arm>/ holds results.jsonl, events.jsonl, faults.jsonl, arm.json,
//   journal.jsonl (every model-call row of journal.sqlite), solvers/ (every versions/<v>/ solve.mjs, BUILD-NOTES.md and
//   compile.json), traces/ and regressions/; <runDir>/export/MANIFEST.json has a sha256 per file. It is rewritten
//   idempotently after every result row, every fault, at the end of each arm and by resume-streams.mjs.
// Every result row also carries host: the in-flight task count of this process, os.loadavg(), free memory and the
// wall-clock start and end (S0-7; additive).
// Step-0 integration options (opt-in; dropped at their defaults, so no hash moves):
//   compile.acceptanceIds 'exact' (default) | 'lenient' | 'structured' and compile.allowSharedExplanation (default false;
//     needs compile.acceptance 'strict'): acceptance.mjs's S0-6 options, passed to every compile attempt and to the recheck
//     (which reads verdicts.json for 'structured'); 'structured' also gives the builder the verdicts.json instructions
//     (prompts.mjs). A version's verdicts.json is kept beside its BUILD-NOTES.md. Set, they define a new JIT arm.
//   jit.replayJournal (default unset): an exported journal.jsonl ('{slug}' = the arm slug) that JIT arms' gateway calls
//     are answered from first, at $0, with live calls for misses (replayPort below). Set, it defines a new JIT arm.
//   armSpendStopUsd (default unset; not hashed): {<arm spec>: dollars}, a per-arm spend stop beside spendStopUsd.
//   _blocked (any value): the config is refused until it is removed; an explicit null tolerance is refused too.
//   library (default unset: no library; FLOW-V3-SLICE2 §3–§4, slice 2a): {mode: 'cur' | 'iso', childBudgetUsd, concurrency,
//     parentMarginUsd, from?, maxDepth?, check?, novelMode?, interpretFloorUsd?, register?}. Needs compile.promptVersion 5
//     (flow-v3). A JIT arm keeps a library registry at <armDir>/library/ (call-host.mjs createRegistry): 'iso' wipes it when
//     the arm starts fresh (no recorded row); 'cur' keeps it, and seeds a fresh one from `from` ('{slug}' = the arm slug,
//     relative to the run root: the previous rung's '<experiment>/{slug}/library'). Every adopted, accepted version is
//     registered (solve bytes, contract {input: null, output: the bed's outputSchema, taskTemplate: the newest trace's
//     prompt}, profile = learnProfile(its compile traces, PARAMS_V2), checkOptions = check (default profile.mjs
//     TOLERANT_CHECK), novelMode (default 'refuse'), evidence). Every compiled run gets a call host over the registry
//     (maxDepth default 3; the arm's interpreter answers onRefuse/onDeopt 'interpret' at interpretFloorUsd, default $0.10),
//     a gateway Ledger it holds child reservations on, and withCallModel(models); host events go to <armDir>/calls.jsonl
//     (childId = the call's name), its journal to calls-journal.jsonl, and the row gains calls (host totals). The builder
//     sees library/index.json and its runs and host check call through a host too (compile.mjs). Each compiled run records
//     its answers (run-compiled.mjs resume), and the retry after an environment fault resumes from the first attempt's
//     completed answers (item 1b; the compiled event says resumed: n). The budget rule is
//     validated: perTaskUsd >= concurrency × childBudgetUsd + parentMarginUsd (parentMarginUsd > 0), so the reservations of
//     `concurrency` children in flight stay strictly below the parent's budget. Set, it defines a new JIT arm.
//     Slice 2b (each absent unless set, so a slice 2a library config keeps its hash): library.agent = {budgetUsd, model?,
//     stallMs?, textLabel? ('synthetic', the default, or 'third-party', which refuses every agent node: D10)} gives every
//     compiled run (and the builder's runs and host check) agent nodes: the arm's interpreter model (or model) runs each node
//     in an arm- and role-neutral session directory (role 'agent'), its trace is kept in traces/ (role 'agent-node') with an
//     'agent-node' event, its cost reaches the row through the run that asked (as interpret-child), and harvested scripts are
//     copied to <armDir>/harvest/ (exported). The budget rule becomes perTaskUsd >= concurrency × childBudgetUsd +
//     agent.budgetUsd + parentMarginUsd (W-BED-R5-NOTES item 15), and the builder is told about flow.agent (prompts.mjs).
//     library.wide = true tells the builder about flow.wide (FLOW-V3 §2.3: only arms preregistered to use it).
//   jit.shadowFloor (number in [0, 1]; default unset: the shadowEvery schedule): on every compiled ok, a seeded draw
//     u = shadowDrawOf(jit.shadowSeed, idx) shadows the row iff u < shadowFloor; it replaces the periodic schedule, so
//     jit.shadowEvery with it is refused. Flag-triggered shadows (shadowOnFlags) still fire. jit.shadowSeed (default
//     config.seed, else config.experiment) is written into the normalized config, so the draws are part of the arm hash.
//     Rows: shadowPropensity on every compiled ok row (1 flagged, shadowFloor under the floor, null under shadowEvery),
//     shadowDraw (floor only) and shadowReason 'floor' | 'flag' | 'floor+flag'. For stats.mjs's IPW estimator a compiled
//     row is {verified: it had a shadow, propensity: shadowPropensity, wrong: the shadow disagreed and the adjudicator
//     sided against the compiled answer (delivered 'adjudicated')}. The export copies rows verbatim.

const sha = s => createHash('sha256').update(s).digest('hex');
// The shadow-floor draw for task idx: u in [0, 1) from sha256(`${seed}:${idx}:shadow`) (52 bits), so a resume or a replay
// of the same stream draws the same u, whatever ran before; every JIT arm of a stream shares the draw for a task.
export const shadowDrawOf = (seed, idx) => parseInt(sha(`${seed}:${idx}:shadow`).slice(0, 13), 16) / 2 ** 52;
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

export const DEFAULT_COMMIT_DIR = 'research/jit-20261008/runs/{experiment}';
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
// persist options of a raw config, normalized (commitDir absolute); null when the config has none.
export const persistOf = (raw, { commit = false } = {}) => normalizePersist(commit && raw.persist?.commitDir == null ? { ...(raw.persist ?? {}), commitDir: true } : raw.persist, raw.experiment);
function normalizePersist(p, experiment) {
  if (p == null) return null;
  if (typeof p !== 'object' || Array.isArray(p)) throw new Error('config.persist must be an object');
  for (const k of Object.keys(p)) if (!['commitDir', 'maxBodyBytes'].includes(k)) throw new Error(`config.persist.${k} is not supported (commitDir, maxBodyBytes)`);
  let commitDir = p.commitDir === true ? DEFAULT_COMMIT_DIR : p.commitDir === false ? null : p.commitDir ?? null;
  if (commitDir != null) {
    if (typeof commitDir !== 'string' || !commitDir.trim()) throw new Error('config.persist.commitDir must be a path, true (the default directory) or false');
    const abs = path.resolve(REPO, commitDir.replaceAll('{experiment}', experiment)), ignored = path.join(REPO, 'experiments/runs');
    if (abs === ignored || abs.startsWith(ignored + path.sep)) throw new Error(`config.persist.commitDir must not be under experiments/runs/ (gitignored): ${commitDir}`);
    commitDir = abs;
  }
  const maxBodyBytes = p.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) throw new Error('config.persist.maxBodyBytes must be a positive integer');
  return { commitDir, maxBodyBytes };
}

// armSpendStopUsd (opt-in, not hashed): {<arm spec>: dollars}; an arm stops starting tasks once its own recorded spend
// exceeds its cap, as spendStopUsd stops every arm of the process. Unset: no per-arm cap.
function armCapsOf(raw) {
  const caps = raw.armSpendStopUsd;
  if (caps == null) return null;
  if (typeof caps !== 'object' || Array.isArray(caps)) throw new Error('config.armSpendStopUsd must be an object {<arm spec>: dollars}');
  for (const [spec, usd] of Object.entries(caps)) {
    if (!raw.arms.includes(spec)) throw new Error(`config.armSpendStopUsd: ${spec} is not one of config.arms`);
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) throw new Error(`config.armSpendStopUsd.${spec} must be a positive number of dollars`);
  }
  return { ...caps };
}

// Slice 2a: the library option, normalized (defaults written out, so spelling them changes no hash) and the stream budget
// rule checked: perTaskUsd >= concurrency × childBudgetUsd + parentMarginUsd, with parentMarginUsd > 0 (the reservations of
// the children in flight must stay strictly below the parent's budget, FLOW-V3 §1.3). null when the config has none.
export const LIBRARY_MODES = Object.freeze(['cur', 'iso']);
export function libraryOf(raw, { perTaskUsd = 1, promptVersion = 1 } = {}) {
  const L = raw?.library;
  if (L == null) return null;
  if (typeof L !== 'object' || Array.isArray(L)) throw new Error('config.library must be an object');
  const KEYS = ['mode', 'from', 'childBudgetUsd', 'concurrency', 'parentMarginUsd', 'maxDepth', 'check', 'novelMode', 'interpretFloorUsd', 'register', 'agent', 'wide'];
  for (const k of Object.keys(L)) if (!KEYS.includes(k)) throw new Error(`config.library.${k} is not supported (${KEYS.join(', ')})`);
  if (!LIBRARY_MODES.includes(L.mode)) throw new Error(`config.library.mode must be one of ${LIBRARY_MODES.join(', ')}`);
  if (L.from != null && (typeof L.from !== 'string' || !L.from.trim() || L.mode !== 'cur')) throw new Error("config.library.from must be a path template, and only with mode 'cur'");
  if (promptVersion < 5) throw new Error('config.library needs compile.promptVersion 5 (flow-v3: the builder learns flow.call only there)');
  const pos = (k, v) => { if (typeof v !== 'number' || !Number.isFinite(v) || !(v > 0)) throw new Error(`config.library.${k} must be a positive number of dollars`); return v; };
  const childBudgetUsd = pos('childBudgetUsd', L.childBudgetUsd), parentMarginUsd = pos('parentMarginUsd', L.parentMarginUsd);
  if (!Number.isInteger(L.concurrency) || L.concurrency < 1) throw new Error('config.library.concurrency must be an integer >= 1 (the most child calls in flight at once)');
  const agent = agentOptsOf(L.agent);
  if (L.wide != null && typeof L.wide !== 'boolean') throw new Error('config.library.wide must be true or false');
  const need = L.concurrency * childBudgetUsd + (agent?.budgetUsd ?? 0) + parentMarginUsd;
  if (perTaskUsd + 1e-9 < need) throw new Error(agent
    ? `config.library: perTaskUsd ${perTaskUsd} is below concurrency × childBudgetUsd + agent.budgetUsd + parentMarginUsd = ${L.concurrency} × ${childBudgetUsd} + ${agent.budgetUsd} + ${parentMarginUsd} = ${round(need)} (the stream budget rule, FLOW-V3-SLICE2 §3 and §9)`
    : `config.library: perTaskUsd ${perTaskUsd} is below concurrency × childBudgetUsd + parentMarginUsd = ${L.concurrency} × ${childBudgetUsd} + ${parentMarginUsd} = ${round(need)} (the stream budget rule, FLOW-V3-SLICE2 §3)`);
  const maxDepth = L.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > HARD_MAX_DEPTH) throw new Error(`config.library.maxDepth must be an integer in 1..${HARD_MAX_DEPTH}`);
  const novelMode = L.novelMode ?? 'refuse';
  if (!NOVEL_MODES.includes(novelMode)) throw new Error(`config.library.novelMode must be one of ${NOVEL_MODES.join(', ')}`);
  const interpretFloorUsd = L.interpretFloorUsd ?? DEFAULT_INTERPRET_FLOOR_USD;
  if (typeof interpretFloorUsd !== 'number' || !(interpretFloorUsd >= 0)) throw new Error('config.library.interpretFloorUsd must be a number >= 0');
  if (L.register != null && typeof L.register !== 'boolean') throw new Error('config.library.register must be true or false');
  return { mode: L.mode, ...(L.from ? { from: L.from } : {}), childBudgetUsd, concurrency: L.concurrency, parentMarginUsd, maxDepth, check: checkOptionsOf(L.check ?? TOLERANT_CHECK), novelMode,
    interpretFloorUsd, register: L.register ?? true, ...(agent ? { agent } : {}), ...(L.wide ? { wide: true } : {}) };
}
// Slice 2b: config.library.agent, normalized (null when absent).
export function agentOptsOf(A) {
  if (A == null) return null;
  if (typeof A !== 'object' || Array.isArray(A)) throw new Error('config.library.agent must be an object {budgetUsd, model?, stallMs?, textLabel?}');
  for (const k of Object.keys(A)) if (!['budgetUsd', 'model', 'stallMs', 'textLabel'].includes(k)) throw new Error(`config.library.agent.${k} is not supported (budgetUsd, model, stallMs, textLabel)`);
  if (typeof A.budgetUsd !== 'number' || !(A.budgetUsd >= DEFAULT_AGENT_FLOOR_USD)) throw new Error(`config.library.agent.budgetUsd must be a number >= ${DEFAULT_AGENT_FLOOR_USD} (the agent floor)`);
  if (A.model != null && (typeof A.model !== 'string' || !A.model)) throw new Error('config.library.agent.model must be a model id');
  if (A.stallMs != null && !(Number.isInteger(A.stallMs) && A.stallMs > 0)) throw new Error('config.library.agent.stallMs must be a positive integer');
  // Review fix (FLOW-V3-SLICE2 §Review I4): D10 is a declaration the config must make; there is no default, so a config on
  // corpus or enterprise text that forgets it cannot hand third-party text to an agent node.
  const textLabel = A.textLabel;
  if (!TEXT_LABELS.includes(textLabel)) throw new Error(`config.library.agent.textLabel is required and must be one of ${TEXT_LABELS.join(', ')} (D10: what text the run's tasks carry)`);
  return { budgetUsd: A.budgetUsd, model: A.model ?? null, stallMs: A.stallMs ?? null, textLabel };
}

export function normalizeConfig(raw, { ledger = null } = {}) {
  for (const k of ['experiment', 'familyId', 'split']) if (typeof raw?.[k] !== 'string' || !raw[k]) throw new Error(`config.${k} is required`);
  if (!/^[\w.-]+$/.test(raw.experiment)) throw new Error('config.experiment must match [\\w.-]+');
  if (!Array.isArray(raw.segments) || !raw.segments.length) throw new Error('config.segments must be a non-empty list');
  if (!Array.isArray(raw.arms) || !raw.arms.length) throw new Error('config.arms must be a non-empty list');
  // A config parked on an open decision (e.g. a tolerance still to be measured) says so in _blocked and never runs.
  if (raw._blocked != null) throw new Error(`config ${raw.experiment} is blocked: ${raw._blocked}`);
  // compare.mjs tolerance() reads a null tolerance as its default; here an explicit null is an unset placeholder, refused.
  for (const part of ['jit', 'compile']) for (const k of TOL_KEYS) if (raw[part] && k in raw[part] && raw[part][k] === null) throw new Error(`config.${part}.${k} is null: set a value (a null tolerance is a placeholder, not the default)`);
  const segments = raw.segments.map(s => ({ difficulty: Number(s.difficulty ?? 3), seeds: seedList(s.seeds) }));
  // SPEC §6.4: held-out streams use fresh test seeds >= 7001 (5001-5006 and 6001-6004 are burned).
  if (raw.split === 'test' && segments.some(s => s.seeds.some(x => x < 7001))) throw new Error('test-split streams must use fresh seeds >= 7001');
  // S0-5: the per-(bed, split) seed ledger (seeds.mjs): reserved-by-other ranges, used ranges for a fresh purpose, and
  // held-out seeds below 8001 are refused.
  if (raw.seedPurpose != null && typeof raw.seedPurpose !== 'string') throw new Error('config.seedPurpose must be a ledger purpose name');
  const L = ledger ?? loadLedger();
  for (const s of segments) assertSeedsAllowed({ bed: raw.familyId, split: raw.split, seeds: s.seeds, purpose: raw.seedPurpose ?? defaultPurpose(raw.split), ledger: L });
  const persist = normalizePersist(raw.persist, raw.experiment);
  const jit = { ...DEFAULT_JIT, ...(raw.jit ?? {}) };
  if (jit.shadowEvery != null && jit.shadowEvery !== false && !(Number.isInteger(jit.shadowEvery) && jit.shadowEvery >= 0)) throw new Error('config.jit.shadowEvery must be an integer >= 0 (0: no scheduled shadows)');
  if (jit.shadowOnFlags != null && typeof jit.shadowOnFlags !== 'boolean') throw new Error('config.jit.shadowOnFlags must be true or false');
  // Shadow floor (opt-in; PREREG-stream §2): a seeded Bernoulli(shadowFloor) draw per compiled ok replaces the schedule.
  if (jit.shadowFloor != null) {
    if (typeof jit.shadowFloor !== 'number' || !Number.isFinite(jit.shadowFloor) || jit.shadowFloor < 0 || jit.shadowFloor > 1) throw new Error('config.jit.shadowFloor must be a number in [0, 1]');
    if (raw.jit?.shadowEvery != null) throw new Error('config.jit.shadowEvery and jit.shadowFloor together: the floor replaces the periodic schedule; leave shadowEvery out');
    delete jit.shadowEvery;
    if (jit.shadowSeed != null && typeof jit.shadowSeed !== 'string' && !Number.isInteger(jit.shadowSeed)) throw new Error('config.jit.shadowSeed must be a string or an integer');
    jit.shadowSeed = String(jit.shadowSeed ?? raw.seed ?? raw.experiment);
  } else if (jit.shadowSeed != null) throw new Error('config.jit.shadowSeed needs jit.shadowFloor');
  else delete jit.shadowFloor;
  if (!jit.shadowOnFlags) delete jit.shadowOnFlags;
  // v2.2 (DEV-NOTES D9, opt-in): a recompile must keep every refusal it cannot handle; see doCompile and acceptance.mjs applyRefusals.
  if (jit.preserveRefusals != null && typeof jit.preserveRefusals !== 'boolean') throw new Error('config.jit.preserveRefusals must be true or false');
  if (!jit.preserveRefusals) delete jit.preserveRefusals;
  // S0-6 (opt-in): adopt only versions the acceptance check accepted.
  if (jit.adoptRequiresAcceptance != null && typeof jit.adoptRequiresAcceptance !== 'boolean') throw new Error('config.jit.adoptRequiresAcceptance must be true or false');
  if (!jit.adoptRequiresAcceptance) delete jit.adoptRequiresAcceptance;
  // Integration (opt-in): answer gateway model calls from an exported journal first ($0 replays; run-compiled.mjs createMemoPort).
  if (jit.replayJournal != null && (typeof jit.replayJournal !== 'string' || !jit.replayJournal.trim())) throw new Error('config.jit.replayJournal must be the path of an exported journal.jsonl');
  if (jit.replayJournal == null) delete jit.replayJournal;
  if (jit.compare != null && !JIT_COMPARE_MODES.includes(jit.compare)) throw new Error(`config.jit.compare must be one of ${JIT_COMPARE_MODES.join(', ')}`);
  if (jit.compare === 'tolerant') { delete jit.allowLooseTolerance; Object.assign(jit, tolerance(raw.jit)); }
  else if (TOL_KEYS.some(k => jit[k] != null)) throw new Error('config.jit.relTol, absTol, tolerantKeys and allowLooseTolerance need jit.compare \'tolerant\'');
  else for (const k of TOL_KEYS) delete jit[k];
  const compile = { ...DEFAULT_COMPILE, ...(raw.compile ?? {}), fallback: { ...DEFAULT_COMPILE.fallback, ...(raw.compile?.fallback ?? {}) } };
  if (compile.promptVersion != null) compile.promptVersion = promptVersionOf(compile);
  if (raw.compile?.fallback && 'promptVersion' in raw.compile.fallback) throw new Error('config.compile.fallback.promptVersion is not supported: compile.promptVersion applies to the fallback compiler too');
  for (const k of ['compare', ...TOL_KEYS, 'acceptance', 'minPartial', 'acceptanceIds', 'allowSharedExplanation']) if (raw.compile?.fallback && k in raw.compile.fallback) throw new Error(`config.compile.fallback.${k} is not supported: compile.${k} applies to the fallback compiler too`);
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
  // S0-6 (opt-in): how BUILD-NOTES.md names cases ('exact' default | 'lenient' | 'structured': verdicts.json), and the
  // shared-text exception (strict acceptance only). Dropped at their defaults, so no hash moves.
  compile.acceptanceIds = acceptanceIdsOf(compile.acceptanceIds);
  if (compile.acceptanceIds === 'exact') delete compile.acceptanceIds;
  if (compile.allowSharedExplanation != null && typeof compile.allowSharedExplanation !== 'boolean') throw new Error('config.compile.allowSharedExplanation must be true or false');
  if (compile.allowSharedExplanation && compile.acceptance !== 'strict') throw new Error('config.compile.allowSharedExplanation needs compile.acceptance \'strict\'');
  if (!compile.allowSharedExplanation) delete compile.allowSharedExplanation;
  const armSpendStopUsd = armCapsOf(raw);
  const library = libraryOf(raw, { perTaskUsd: raw.perTaskUsd ?? 1, promptVersion: compile.promptVersion ?? 1 });
  const { library: _rawLibrary, ...rest } = raw;
  return {
    ...rest, segments, jit, compile, ...(library ? { library } : {}),
    perTaskUsd: raw.perTaskUsd ?? 1, agentBudgetUsd: raw.agentBudgetUsd ?? 1, agentMinutes: raw.agentMinutes ?? 15, agentEffort: raw.agentEffort ?? null,
    compiledMinutes: raw.compiledMinutes ?? 20, concurrency: raw.concurrency ?? 3, staticFallback: raw.staticFallback ?? STATIC_FALLBACK,
    gatewayModels: raw.gatewayModels ?? [...POLICY_MODELS], spendStopUsd: raw.spendStopUsd ?? null,
    ...(persist ? { persist } : {}), ...(armSpendStopUsd ? { armSpendStopUsd } : {}),
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
    ...(kind === 'jit' ? { jit: config.jit, compile: config.compile, compiledMinutes: config.compiledMinutes, ...(config.library ? { library: config.library } : {}) } : {}) };
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

const DEOPT_KINDS = new Set(['guard', 'invariant', 'judge', 'budget', 'unknown', 'crash', 'timeout', 'invalid', 'call']);
// SPEC §3.1: up to max traces, newest first, every deopt kind seen so far represented (its newest trace).
export function selectTraces(pool, max) {
  const newest = [...pool].sort((a, b) => b.idx - a.idx || b.seq - a.seq);
  const picked = [], seen = new Set();
  for (const t of newest) if (DEOPT_KINDS.has(t.kind) && !seen.has(t.kind) && picked.length < max) { seen.add(t.kind); picked.push(t); }
  for (const t of newest) if (picked.length < max && !picked.includes(t)) picked.push(t);
  return picked.sort((a, b) => b.idx - a.idx || b.seq - a.seq);
}

// v2.2: the trace-pool entries that came from a refusal (a compiled deopt handed to the interpreter). Crashes, timeouts and
// invalid outputs are failures to fix, not refusals.
export const REFUSAL_KINDS = Object.freeze(new Set(['guard', 'invariant', 'judge', 'budget', 'unknown', 'call']));
export const refusalPool = pool => pool.filter(x => x.role === 'fallback' && REFUSAL_KINDS.has(x.kind));
// Every refusal trace joins the compile (up to `extra` beyond maxTraces, newest first), so the check can see whether each
// refusal is kept, handled, or lost.
export function withRefusals(picked, pool, extra = 8) {
  const out = [...picked], have = new Set(picked.map(x => x.traceId));
  for (const r of [...refusalPool(pool)].sort((a, b) => b.idx - a.idx || b.seq - a.seq)) if (!have.has(r.traceId) && out.length < picked.length + extra) { out.push(r); have.add(r.traceId); }
  return out;
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
  ...(ct.refusalCheck ? { refusalCheck: ct.refusalCheck } : {}), ...(ct.ids ? { ids: ct.ids } : {}),
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
// S0-6, as compile.mjs: opts.ids ('lenient' | 'structured'; for 'structured' the verdicts.json beside BUILD-NOTES.md is
// read) and opts.allowSharedExplanation (strict only). Unset, the verdict is what it was.
export async function checkFromSummary(check, workdir, regressions = 0, opts = {}) {
  const { summary: s, refusalCheck } = applyRefusals(check?.summary ?? null, opts.refusals ?? []);
  const notesFile = workdir ? path.join(workdir, 'BUILD-NOTES.md') : null;
  const notes = notesFile && existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : null;
  const ids = acceptanceIdsOf(opts.ids);
  const verdicts = ids === 'structured' && workdir ? await readVerdicts(workdir) : undefined;
  const judged = judgeAcceptance({ summary: s, notes, mode: opts.acceptance ?? 'named', minPartial: opts.minPartial, tasks: caseTasks(opts.traces ?? [], opts.regressions ?? []),
    ...(ids !== 'exact' ? { ids } : {}), ...(opts.allowSharedExplanation ? { allowSharedExplanation: true } : {}), ...(verdicts !== undefined ? { verdicts } : {}) });
  const verdict = refusalCheck ? { ...judged, accepted: judged.accepted && refusalCheck.ok } : judged;
  const unexplained = verdict.unexplained;
  return {
    exact: s?.exact ?? 0, partial: s?.partial ?? null, deopts: s?.deopts ?? 0, crashes: s?.crashes ?? 0, perCase: s?.perCase ?? [],
    cases: s?.cases ?? 0, labeled: s?.labeled ?? 0, exactRate: s?.exactRate ?? null, diffs: s?.diffs ?? 0, deoptKinds: s?.deoptKinds ?? {}, timeouts: s?.timeouts ?? 0,
    regressions: s?.regressions ?? regressions, regressionsPassed: s?.regressionsPassed ?? 0, clean: !!s?.clean, unexplained,
    accepted: verdict.accepted, costUsd: check?.costUsd ?? 0, calls: check?.calls ?? 0, unknownCalls: check?.unknownCalls ?? 0, refusals: check?.refusals ?? {},
    durationMs: check?.durationMs ?? null, error: check?.error ?? null,
    ...(opts.compare ? { compare: opts.compare, canonicalExact: s?.canonicalExact ?? null } : {}), ...(verdict.acceptance ? { acceptance: verdict.acceptance } : {}),
    ...(refusalCheck ? { refusalCheck } : {}), ...(verdict.ids ? { ids: verdict.ids } : {}),
  };
}

// ---------------------------------------------------------------------------------------------- per-arm files
export const armPaths = (runDir, slug) => {
  const dir = path.join(runDir, slug);
  return { dir, results: path.join(dir, 'results.jsonl'), events: path.join(dir, 'events.jsonl'), faults: path.join(dir, 'faults.jsonl'), journal: path.join(dir, 'journal.sqlite'),
    traces: path.join(dir, 'traces'), versions: path.join(dir, 'versions'), regressions: path.join(dir, 'regressions') };
};

// ---------------------------------------------------------------------------------------------- S0-1: durable text export
// <runDir>/export/ mirrors every arm directory as text: no SQLite (the journal becomes journal.jsonl), no tarballs. Every
// file is rewritten only when its bytes change, and MANIFEST.json carries no clock, so a re-export of unchanged data
// changes nothing. Arms run as separate processes, so the export holds <export>/.lock while it writes.
export const EXPORT_SCHEMA = 'jit-export/1';
const EXPORT_SKIP = new Set(['export', 'logs']);
const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function writeIfChanged(file, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (existsSync(file) && readFileSync(file).equals(buf)) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, buf); renameSync(tmp, file);
  return true;
}
// Regular files under dir (relative, '/'-separated, sorted); names starting with '.' (locks, scratch) are skipped.
function listFiles(dir, rel = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter(d => !d.name.startsWith('.') && !d.name.includes('.tmp-')).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap(d => (d.isDirectory() ? listFiles(path.join(dir, d.name), `${rel}${d.name}/`) : d.isFile() ? [`${rel}${d.name}`] : []));
}
const copyTree = (src, dst, changed, tag) => { for (const f of listFiles(src)) if (writeIfChanged(path.join(dst, f), readFileSync(path.join(src, f)))) changed.push(`${tag}/${f}`); };

// Every model-call row of a journal.sqlite as JSON lines: ids, keys, model, tokens, cost, latency, and the request and
// response as {sha256, bytes, body} (sha256 of the stored canonical JSON text), or {sha256, bytes, path} with the body
// in bodies/<sha256>.json when it is larger than maxBodyBytes.
// Replay keys (run-compiled.mjs createMemoPort): requestDigest = requestDigestOf({modelId, system, prompt, schema, decoding})
// with the decoding the caller requested, when the row's request records it (request.decoding); a ModelPort row today
// keeps only the provider's effective decoding (maxTokens erased), so otherwise the row carries requestDigestLoose
// (looseDigestOf: model, prompt, schema and reasoning level) instead, which the memo port serves by its loose key, also
// when the request body itself stays in bodies/. Rows without request text (a replayed call) carry neither.
export function journalToJsonl(file, { maxBodyBytes = DEFAULT_MAX_BODY_BYTES, bodies = new Map() } = {}) {
  if (!existsSync(file)) return null;
  const db = new DatabaseSync(file);
  let rows;
  try {
    db.exec('PRAGMA busy_timeout=5000;');
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='model_calls'").get();
    rows = has ? db.prepare('SELECT * FROM model_calls ORDER BY id').all() : [];
  } finally { db.close(); }
  const body = text => {
    if (text == null) return null;
    const bytes = Buffer.byteLength(text), digest = sha(text);
    if (bytes <= maxBodyBytes) return { sha256: digest, bytes, body: JSON.parse(text) };
    bodies.set(digest, text);
    return { sha256: digest, bytes, path: `bodies/${digest}.json` };
  };
  const keys = r => {
    let req;
    try { req = r.request == null ? null : JSON.parse(r.request); } catch { req = null; }
    if (!req || typeof req.prompt !== 'string') return {};
    const q = { modelId: r.model_id, system: req.system ?? '', prompt: req.prompt, schema: req.schema };
    // null fields are unset (a normalized decoding), as tools/model.mjs omits them.
    if (req.decoding && typeof req.decoding === 'object') return { requestDigest: requestDigestOf({ ...q, decoding: Object.fromEntries(Object.entries(req.decoding).filter(([, v]) => v != null)) }) };
    const effective = r.decoding == null ? null : JSON.parse(r.decoding);
    return { requestDigestLoose: looseDigestOf({ ...q, reasoning: effective?.reasoning }) };
  };
  return rows.map(r => JSON.stringify({
    id: r.id, replayKey: r.replay_key, runId: r.run_id, nodeKey: r.node_key, attempt: r.attempt, sampleIndex: r.sample_index, modelId: r.model_id, provider: r.provider,
    engineVersion: r.engine_version, decoding: r.decoding == null ? null : JSON.parse(r.decoding), receiptHash: r.receipt_hash, promptHash: r.prompt_hash,
    ok: r.ok === 1, errorCode: r.error_code, inputTokens: r.input_tokens, outputTokens: r.output_tokens, cacheReadTokens: r.cache_read_tokens ?? null,
    cacheWriteTokens: r.cache_write_tokens ?? null, costUsd: r.cost_usd, imputedUsd: r.imputed_usd, latencyMs: r.latency_ms, createdAt: r.created_at,
    request: body(r.request), response: body(r.response), ...keys(r),
  }) + '\n').join('');
}

function exportArm(armDir, outDir, slug, { maxBodyBytes, changed }) {
  for (const f of ['results.jsonl', 'events.jsonl', 'faults.jsonl', 'arm.json']) {
    const src = path.join(armDir, f);
    if (existsSync(src) && writeIfChanged(path.join(outDir, f), readFileSync(src))) changed.push(`${slug}/${f}`);
  }
  const bodies = new Map(), journal = journalToJsonl(path.join(armDir, 'journal.sqlite'), { maxBodyBytes, bodies });
  if (journal != null && writeIfChanged(path.join(outDir, 'journal.jsonl'), journal)) changed.push(`${slug}/journal.jsonl`);
  for (const [digest, text] of bodies) if (writeIfChanged(path.join(outDir, 'bodies', `${digest}.json`), text)) changed.push(`${slug}/bodies/${digest}.json`);
  copyTree(path.join(armDir, 'versions'), path.join(outDir, 'solvers'), changed, `${slug}/solvers`);
  copyTree(path.join(armDir, 'traces'), path.join(outDir, 'traces'), changed, `${slug}/traces`);
  copyTree(path.join(armDir, 'regressions'), path.join(outDir, 'regressions'), changed, `${slug}/regressions`);
  // Slice 2a (library arms only; absent elsewhere): the call host log and journal, and the library registry with its solvers.
  for (const f of ['calls.jsonl', 'calls-journal.jsonl']) {
    const src = path.join(armDir, f);
    if (existsSync(src) && writeIfChanged(path.join(outDir, f), readFileSync(src))) changed.push(`${slug}/${f}`);
  }
  copyTree(path.join(armDir, 'library'), path.join(outDir, 'library'), changed, `${slug}/library`);
  copyTree(path.join(armDir, 'harvest'), path.join(outDir, 'harvest'), changed, `${slug}/harvest`);   // slice 2b (agent arms only)
}

function lockExport(dir, waitMs = 60000) {
  const file = path.join(dir, '.lock'), until = Date.now() + waitMs;
  for (;;) {
    try { writeFileSync(file, String(process.pid), { flag: 'wx' }); return () => rmSync(file, { force: true }); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(readFileSync(file, 'utf8'));
      // The export is synchronous, so a lock with this pid is a leftover of this process; a dead owner's lock is taken over.
      if (pid && (pid === process.pid || !alive(pid))) { rmSync(file, { force: true }); continue; }
      if (Date.now() > until) throw new Error(`export ${dir} is locked by process ${pid || '?'}`);
      sleepSync(50);
    }
  }
}

// A bodies/ file (journal bodies above the cap) stays in the local export: listed in the manifest as local, never mirrored.
const isLocalOnly = rel => rel.split('/')[1] === 'bodies';
const hashCache = new Map();
function fileSha(file) {
  const st = statSync(file), c = hashCache.get(file);
  if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c.sha256;
  const digest = sha(readFileSync(file));
  hashCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, sha256: digest });
  return digest;
}
export const armDirsOf = runDir => (existsSync(runDir) ? readdirSync(runDir, { withFileTypes: true })
  .filter(d => d.isDirectory() && !EXPORT_SKIP.has(d.name) && (existsSync(path.join(runDir, d.name, 'results.jsonl')) || existsSync(path.join(runDir, d.name, 'arm.json'))))
  .map(d => d.name).sort() : []);

// exportRun(runDir, {arms, commitDir, maxBodyBytes}) -> {exportDir, manifest, changed, commitDir, mirrored}. arms: the arm
// slugs to refresh (default: every arm directory); the manifest always covers the whole export. With commitDir, every
// non-local file and MANIFEST.json are mirrored there, and the mirror is verified against the manifest.
export function exportRun(runDir, { arms = null, commitDir = null, maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  const exportDir = path.join(runDir, 'export');
  mkdirSync(exportDir, { recursive: true });
  const unlock = lockExport(exportDir);
  try {
    const changed = [];
    for (const slug of arms ?? armDirsOf(runDir)) exportArm(path.join(runDir, slug), path.join(exportDir, slug), slug, { maxBodyBytes, changed });
    const files = {};
    for (const rel of listFiles(exportDir)) if (rel !== 'MANIFEST.json') {
      const f = path.join(exportDir, rel);
      files[rel] = { sha256: fileSha(f), bytes: statSync(f).size, ...(isLocalOnly(rel) ? { local: true } : {}) };
    }
    const manifest = { schema: EXPORT_SCHEMA, experiment: path.basename(runDir), files };
    const text = JSON.stringify(manifest, null, 1) + '\n';
    if (writeIfChanged(path.join(exportDir, 'MANIFEST.json'), text)) changed.push('MANIFEST.json');
    let mirrored = null;
    if (commitDir) {
      mirrored = [];
      for (const [rel, m] of Object.entries(files)) {
        if (m.local) continue;
        const dst = path.join(commitDir, rel);
        if (writeIfChanged(dst, readFileSync(path.join(exportDir, rel)))) mirrored.push(rel);
        if (fileSha(dst) !== m.sha256) throw new Error(`export mirror ${dst}: sha256 differs from the manifest`);
      }
      if (writeIfChanged(path.join(commitDir, 'MANIFEST.json'), text)) mirrored.push('MANIFEST.json');
    }
    return { exportDir, manifest, changed, commitDir, mirrored };
  } finally { unlock(); }
}

// S0-7: in-flight tasks of this process (every arm), sampled with the host load at the start and end of each row.
export function hostTracker() {
  const active = new Map();
  const sample = () => ({ loadAvg: os.loadavg().map(round), freeMemMb: Math.round(os.freemem() / 2 ** 20) });
  return {
    enter(key) {
      const e = { inFlightStart: active.size + 1, inFlightMax: active.size + 1, startedAt: new Date().toISOString(), start: sample() };
      active.set(key, e);
      for (const x of active.values()) x.inFlightMax = Math.max(x.inFlightMax, active.size);
      return e;
    },
    exit(key) {
      const e = active.get(key);
      if (!e) return null;
      active.delete(key);
      return { inFlightStart: e.inFlightStart, inFlightMax: e.inFlightMax, inFlightEnd: active.size + 1, cpus: os.cpus().length, startedAt: e.startedAt, endedAt: new Date().toISOString(),
        loadAvgStart: e.start.loadAvg, freeMemMbStart: e.start.freeMemMb, ...(({ loadAvg, freeMemMb }) => ({ loadAvgEnd: loadAvg, freeMemMbEnd: freeMemMb }))(sample()) };
    },
    get inFlight() { return active.size; },
  };
}

// The fault class of a component result: its own error, a builder session's error, a model call it made, or (library
// arms) an environment fault the call host met inside a child, the local interpreter or an agent node.
const faultCode = r => r?.error?.code ?? r?.record?.builderError?.code ?? (Object.keys(r?.meta?.errors ?? {}).join(',') || null) ?? (r?.calls?.envFaultCodes?.join(',') || null);
// Review fix (FLOW-V3-SLICE2 §Review C1/I5): a compiled run that did not end ok is an environment fault when it met one
// itself (its error or a gateway model call) or when its call host met one anywhere in the call tree (rc.calls.envFaults).
// A library arm then retries the run as a v2 arm retries a run whose judge met a rate limit, instead of recording a
// capability deopt (kind call) with a paid interpreter fallback.
export const compiledFaultOf = rc => rc?.status !== 'ok' && (metEnvFault(rc) || (rc?.calls?.envFaults ?? 0) > 0);
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
    recheck: async ({ workdir, solvePath, traces, regressions, modelPort, models, capUsd, label, promptVersion, compare, library, interpreter, callHost }) => (await import('./compile.mjs')).hostCheck({
      dir: path.join(workdir, '.host-check-recheck'), solveSource: readFileSync(solvePath, 'utf8'), traces, regressions, modelPort, models, capUsd, label, promptVersion, compare,
      ...(library ? { library, interpreter, callHost } : {}) }),
    // Slice 2b: one agent-node attempt (agent-node.mjs agentNodeRunner; a.binary is the CLI).
    agentNode: async a => (await import('./agent-node.mjs')).agentNodeRunner({ ...(a.binary ? { binary: a.binary } : {}) })(a),
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
// Interpreter-family sessions (agent, fallback, shadow, adjudicator) run in <workRoot>/<experiment>/w/<id>. The model sees
// that path (pwd, tool paths), so it must not name the arm or the role: <id> is 12 hex chars of
// sha256(`${armHash}:${idx}:${role}:${rand}`). The mapping lives in the 'interpret' event (workdir, relative to workRoot,
// beside traceId and role), in the trace file (workdirRel) and in trace.json inside the session directory.
export const SESSION_DIR = 'w';
export const sessionIdOf = (armHash, idx, role, rand) => sha(`${armHash}:${idx}:${role}:${rand}`).slice(0, 12);

class ArmRun {
  constructor({ arm, config, runDir, workRoot, deps, log, budget, binary, host = hostTracker() }) {
    Object.assign(this, { arm, config, deps, log, budget, binary, host, runDir, workRoot });
    this.exportErrors = [];
    this.p = armPaths(runDir, arm.slug);
    this.work = path.join(workRoot, config.experiment, arm.slug);   // compiled runs and compile/ builds (not model-read session dirs)
    this.sessions = path.join(workRoot, config.experiment, SESSION_DIR);   // interpreter-family sessions: arm- and role-neutral (sessionIdOf)
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
    // This arm's own recorded spend (rows and unbilled attempts), for config.armSpendStopUsd.
    this.spent = [...this.rows.values()].reduce((s, r) => s + (r.costUsd ?? 0), 0) + [...this.unbilled.values()].flat().reduce((s, e) => s + e.costUsd, 0);
    // Last: a refused resume above takes no lock. Then this arm's definition, beside its rows (a per-arm file).
    this.unlock = lockArm(this.p.dir);
    writeFileSync(path.join(this.p.dir, 'arm.json'), JSON.stringify({ experiment: config.experiment, spec: arm.spec, slug: arm.slug, kind: arm.kind, hash: arm.hash, def: arm.def }, null, 1));
  }

  // S0-1: refresh this arm's export (and the mirror, with persist.commitDir). A failure never ends the stream (its data is
  // still in the arm directory and a resume re-exports), but it is logged and reported as an arm error.
  exportNow() {
    try { return exportRun(this.runDir, { arms: [this.arm.slug], commitDir: this.config.persist?.commitDir ?? null, maxBodyBytes: this.config.persist?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES }); }
    catch (e) {
      const msg = `export: ${e.message}`;
      if (!this.exportErrors.includes(msg)) this.exportErrors.push(msg);
      this.log(`${this.arm.slug}: EXPORT FAILED ${e.message}`);
      return null;
    }
  }
  hostKey(idx) { return `${this.arm.slug}#${idx}`; }

  event(idx, kind, data = {}) {
    const e = { at: new Date().toISOString(), arm: this.arm.spec, idx, kind, ...data };
    appendFileSync(this.p.events, JSON.stringify(e) + '\n');
    return e;
  }

  begin(t) {
    if (this.config.spendStopUsd != null && this.budget.spent > this.config.spendStopUsd) throw new SpendStop(`spend stop: $${this.budget.spent.toFixed(2)} > $${this.config.spendStopUsd}`);
    const cap = this.config.armSpendStopUsd?.[this.arm.spec];
    if (cap != null && this.spent > cap) throw new SpendStop(`arm spend stop: ${this.arm.spec} $${this.spent.toFixed(2)} > $${cap}`);
    const run = this;
    this.host.exit(this.hostKey(t.idx));   // a leftover of an attempt that threw before its row
    this.host.enter(this.hostKey(t.idx));
    return {
      idx: t.idx, events: [], breakdown: {}, spendIds: [], costUnknown: false, started: Date.now(),
      ev(kind, data = {}) { const e = run.event(t.idx, kind, data); const { at, arm, idx, ...compact } = e; this.events.push(compact); return compact; },
      spend(component, usd, unknown = false) {
        const id = `${t.idx}-${component}-${randomUUID().slice(0, 8)}`, costUsd = round(Number(usd) || 0);
        run.event(t.idx, 'spend', { id, component, costUsd, costUnknown: !!unknown });
        this.breakdown[component] = round((this.breakdown[component] ?? 0) + costUsd); this.spendIds.push(id); this.costUnknown ||= !!unknown;
        run.budget.spent += costUsd; run.spent += costUsd;
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
    const host = this.host.exit(this.hostKey(t.idx));
    if (host) row.host = host;
    appendFileSync(this.p.results, JSON.stringify(row) + '\n');
    this.rows.set(t.idx, row);
    this.exportNow();
    this.log(`${this.arm.slug} #${t.idx} ${t.taskKey}: ${row.pass ? 'PASS' : 'fail'} score=${row.score} by=${delivered}${version ? ` v${version}` : ''} $${row.costUsd.toFixed(4)}`);
    return row;
  }

  fault(t, err) {
    appendFileSync(this.p.faults, JSON.stringify({ experiment: this.config.experiment, arm: this.arm.spec, idx: t.idx, taskKey: t.taskKey, component: err.component,
      error: err.result?.error ?? null, metaErrors: err.result?.meta?.errors ?? null, builderError: err.result?.record?.builderError ?? null, at: new Date().toISOString() }) + '\n');
    this.event(t.idx, 'fault', { component: err.component, code: faultCode(err.result) });
    this.host.exit(this.hostKey(t.idx));
    this.exportNow();
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
      const workdir = path.join(this.sessions, sessionIdOf(this.arm.hash, t.idx, role, randomUUID().slice(0, 8)));
      const workdirRel = path.relative(this.workRoot, workdir);
      rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
      const trace = await this.deps.interpret({ task: t.task, familyId: this.config.familyId, outputSchema: this.outputSchema, model, budgetUsd: this.config.agentBudgetUsd,
        timeoutMs: this.config.agentMinutes * 60 * 1000, workdir, effort: this.config.agentEffort, traceId, ...(this.binary ? { binary: this.binary } : {}) });
      writeFileSync(path.join(this.p.traces, `${trace.traceId}.json`), JSON.stringify({ ...trace, workdirRel }));
      tr.spend(role, trace.costUsd ?? 0, trace.costUnknown);
      tr.ev('interpret', { role, model, traceId: trace.traceId, workdir: workdirRel, answer: trace.answer != null, error: trace.error?.code ?? null, costUsd: trace.costUsd ?? 0, attempt,
        nestedModelAttempts: trace.nestedModelAttempts ?? 0, hiddenPathAttempts: trace.hiddenPathAttempts ?? 0 });
      return trace;
    }, trace => ENV_FAULTS.has(trace?.error?.code));
  }

  // Slice 2a: a library arm's compiled run goes through a call host (JitRun.callSetup); every other arm passes nothing new.
  callSetup() { return null; }

  async compiled(tr, t, solvePath, version, state = null) {
    // Library arms (slice 2a item 1b): every compiled run records its model and call answers (run-compiled.mjs
    // createResumePort), and the retry after an environment fault resumes from the first attempt's completed answers.
    let prior = null;
    return this.retrying(tr, 'compiled', async attempt => {
      const workdir = path.join(this.work, `i${String(t.idx).padStart(3, '0')}-compiled-${randomUUID().slice(0, 6)}`);
      rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
      const label = `${this.config.experiment}:${this.arm.slug}:${t.idx}:v${version ?? 0}`;
      const lib = this.callSetup({ tr, t, workdir, label, state });
      const rc = await this.deps.runCompiled({ solvePath, task: t.task, modelPort: lib?.port ?? this.port, perTaskUsd: this.config.perTaskUsd, timeoutMs: this.config.compiledMinutes * 60 * 1000,
        workdir, familyId: this.config.familyId, outputSchema: this.outputSchema, allowedModels: lib?.allowed ?? this.arm.models, label,
        ...(this.flowPath ? { flowPath: this.flowPath } : {}), ...(lib ? { ledger: lib.ledger, resume: attempt > 0 && prior ? prior : true } : {}) });
      if (lib) { rc.calls = lib.done({ version, attempt }); prior = rc.meta?.resume?.rows ?? null; }
      tr.spend('compiled', rc.costUsd ?? 0, rc.costUnknown);
      tr.ev('compiled', { version, status: rc.status, deoptKind: rc.deopt?.kind ?? null, costUsd: rc.costUsd ?? 0, attempt, error: rc.error?.code ?? null,
        ...(rc.flags?.count ? { flags: rc.flags.count } : {}), ...(rc.meta?.memo ? { memo: { requests: rc.meta.memo.requests, hits: rc.meta.memo.hits, reused: rc.meta.memo.reused, live: rc.meta.memo.live } } : {}),
        ...(rc.calls ? { calls: rc.calls } : {}), ...(rc.meta?.resume?.stats?.served ? { resumed: rc.meta.resume.stats.served } : {}) });
      return rc;
    }, compiledFaultOf);
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
    return { ...(c.compare ? { compare: c.compare, ...tolOf(c) } : {}), ...(c.acceptance ? { acceptance: c.acceptance, minPartial: c.minPartial } : {}),
      ...(c.acceptanceIds ? { acceptanceIds: c.acceptanceIds } : {}), ...(c.allowSharedExplanation ? { allowSharedExplanation: true } : {}) };
  }
  get compareOf() { const c = this.config.compile; return c.compare === 'tolerant' ? { mode: 'tolerant', ...tolOf(c) } : null; }

  // ---- slice 2a: the arm's library (config.library) ----
  get library() { return this.config.library ?? null; }
  get libraryDir() { return path.join(this.p.dir, 'library'); }
  // The registry, set up once per process: 'iso' wipes it when the arm starts fresh; 'cur' seeds a fresh one from `from`.
  registryOf() {
    const L = this.library;
    if (!L) return null;
    if (this._registry) return this._registry;
    const dir = this.libraryDir;
    if (L.mode === 'iso' && this.rows.size === 0) rmSync(dir, { recursive: true, force: true });
    if (L.mode === 'cur' && L.from && !existsSync(path.join(dir, REGISTRY_FILE))) {
      const src = path.resolve(path.dirname(this.runDir), L.from.replaceAll('{slug}', this.arm.slug));
      if (!existsSync(path.join(src, REGISTRY_FILE))) throw new Error(`config.library.from: ${src} has no ${REGISTRY_FILE}`);
      for (const f of listFiles(src)) { mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); copyFileSync(path.join(src, f), path.join(dir, f)); }
      this.event(null, 'library-seeded', { from: path.relative(path.dirname(this.runDir), src), files: listFiles(dir).length });
    }
    mkdirSync(dir, { recursive: true });
    this._registry = createRegistry({ dir });
    return this._registry;
  }
  get callHostOpts() { const L = this.library; return { maxDepth: L.maxDepth, profileCheck: L.check, novelMode: L.novelMode, interpretFloorUsd: L.interpretFloorUsd }; }
  // Slice 2b: the call host options of one task (with agent nodes when config.library.agent is set).
  callHostOptsFor(tr, t) { const a = this.agentHostOpts(tr, t); return { ...this.callHostOpts, ...(a ? { agent: a } : {}) }; }
  // Agent nodes (FLOW-V3 §2.2): the arm's interpreter model (or library.agent.model) in an arm- and role-neutral session
  // directory, as the interpreter's own sessions; the node trace is kept (role 'agent-node'); its cost reaches the row through
  // the run that asked (the gateway charges the request's costUsd), so it is not spent here.
  agentHostOpts(tr, t) {
    const A = this.library?.agent;
    if (!A) return null;
    const model = A.model ?? this.arm.interpreter;
    const runner = async a => {
      const rand = randomUUID().slice(0, 8), traceId = `i${String(t.idx).padStart(3, '0')}-agent-${rand.slice(0, 6)}`;
      const workdir = path.join(this.sessions, sessionIdOf(this.arm.hash, t.idx, 'agent', rand)), workdirRel = path.relative(this.workRoot, workdir);
      rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
      const r = await this.deps.agentNode({ ...a, workdir, ...(this.binary ? { binary: this.binary } : {}) });
      const { prompt: _p, ...kept } = r ?? {};
      writeFileSync(path.join(this.p.traces, `${traceId}.json`), JSON.stringify({ traceId, role: 'agent-node', name: a.name, span: a.span, path: a.path, attempt: a.attempt, model: a.model,
        retryReason: a.retryReason ?? null, workdirRel, files: Object.keys(a.files ?? {}).length, ...kept }));
      tr.ev('agent-node', { name: a.name, span: a.span, attempt: a.attempt, model: a.model, traceId, workdir: workdirRel, answer: r?.answer != null, error: r?.error?.code ?? null,
        costUsd: r?.costUsd ?? 0, nestedModelAttempts: r?.nestedModelAttempts ?? 0, hiddenPathAttempts: r?.hiddenPathAttempts ?? 0, scripts: r?.scripts?.length ?? 0 });
      return { ...r, traceId };
    };
    return { runner, models: [...new Set([model, ...(this.arm.models ?? [])])], model, ...(A.stallMs ? { stallMs: A.stallMs } : {}), textLabel: A.textLabel };
  }
  // FLOW-V3 §1.5: the arm's interpreter answers a refused or deopted child alone (onRefuse/onDeopt 'interpret'), in an arm-
  // and role-neutral session directory; the trace is kept (role 'child', not in this arm's own compile pool). Its cost reaches
  // the row through the run that made the call (the gateway charges the call's costUsd), so it is not spent here.
  childInterpreter(tr, t) {
    return async ({ task, outputSchema, budgetUsd, callee, path: childPath, reason }) => {
      const rand = randomUUID().slice(0, 8), traceId = `i${String(t.idx).padStart(3, '0')}-child-${rand.slice(0, 6)}`;
      const workdir = path.join(this.sessions, sessionIdOf(this.arm.hash, t.idx, 'child', rand)), workdirRel = path.relative(this.workRoot, workdir);
      rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
      const e = this._registry?.get(callee);
      const trace = await this.deps.interpret({ task, familyId: e?.evidence?.familyId ?? this.config.familyId, outputSchema, model: this.arm.interpreter, budgetUsd,
        timeoutMs: Math.min(this.config.agentMinutes, this.config.compiledMinutes) * 60 * 1000, workdir, effort: this.config.agentEffort, traceId, ...(this.binary ? { binary: this.binary } : {}) });
      writeFileSync(path.join(this.p.traces, `${trace.traceId}.json`), JSON.stringify({ ...trace, workdirRel, role: 'child', callee, childPath, reason }));
      tr.ev('interpret-child', { model: this.arm.interpreter, traceId: trace.traceId, callee, path: childPath, reason, workdir: workdirRel, answer: trace.answer != null,
        error: trace.error?.code ?? null, costUsd: trace.costUsd ?? 0, nestedModelAttempts: trace.nestedModelAttempts ?? 0, hiddenPathAttempts: trace.hiddenPathAttempts ?? 0 });
      if ((trace.nestedModelAttempts ?? 0) > 0) return { answer: null, error: { code: 'NESTED_MODEL' }, costUsd: trace.costUsd ?? 0, costUnknown: !!trace.costUnknown, traceId: trace.traceId };
      return { answer: trace.answer, costUsd: trace.costUsd ?? 0, costUnknown: !!trace.costUnknown, error: trace.error ?? null, traceId: trace.traceId };
    };
  }
  // A compiled run of a library arm: a call host over the registry (root budget perTaskUsd, a gateway Ledger it can hold
  // child reservations on, the version's own hash on the ancestor chain), and done() writes the host log and journal.
  callSetup({ tr, t, workdir, label, state }) {
    if (!this.library) return null;
    const registry = this.registryOf(), ledger = new Ledger({ capUsd: this.config.perTaskUsd, label });
    const host = createCallHost({ registry, modelPort: this.port, workRoot: path.join(workdir, 'calls-root'), allowedModels: this.arm.models, arm: this.arm.slug, taskKey: t.taskKey,
      ...this.callHostOptsFor(tr, t), interpreter: this.childInterpreter(tr, t) });
    const port = host.port({ budgetUsd: this.config.perTaskUsd, ledger, selfHash: state?.version?.libraryHash ?? null });
    return { port, ledger, allowed: withCallModel(this.arm.models), host,
      done: ({ version, attempt }) => {
        const tag = { experiment: this.config.experiment, armSpec: this.arm.spec, idx: t.idx, version, attempt };
        for (const e of host.events) appendFileSync(path.join(this.p.dir, 'calls.jsonl'), JSON.stringify({ ...tag, childId: e.name ?? null, ...e }) + '\n');
        for (const j of host.journalRows()) appendFileSync(path.join(this.p.dir, 'calls-journal.jsonl'), JSON.stringify({ ...tag, ...j }) + '\n');
        // Slice 2b: agent-node harvests (scripts, task, answer) are kept in the arm for a later sub-compile.
        for (const e of host.events) {
          if (!e.harvestFile) continue;
          const src = path.join(workdir, 'calls-root', e.harvestFile), dst = path.join(this.p.dir, 'harvest', path.basename(e.harvestFile));
          if (existsSync(src) && !existsSync(dst)) { mkdirSync(path.dirname(dst), { recursive: true }); copyFileSync(src, dst); }
        }
        return host.totals();
      } };
  }
  // On adoption of an accepted version: register it (FLOW-V3 §1.2): the solver bytes (copied into the library), the contract,
  // a PARAMS_V2 profile of its compile traces, the configured check options and novelMode, and its evidence.
  registerVersion(tr, t, state, traces, best) {
    const L = this.library, registry = this.registryOf();
    const src = readFileSync(path.join(best.dir, 'solve.mjs')), rel = `solvers/${best.solveSha.slice(0, 16)}.mjs`;
    if (!existsSync(path.join(this.libraryDir, rel))) { mkdirSync(path.join(this.libraryDir, 'solvers'), { recursive: true }); writeFileSync(path.join(this.libraryDir, rel), src); }
    const tasks = traces.map(x => x.task).filter(Boolean);
    const entry = registry.register({ solvePath: rel, flowVersion: 3, contract: { input: null, output: this.outputSchema ?? { type: 'object' }, taskTemplate: tasks[0]?.prompt ?? '' },
      profile: tasks.length ? learnProfile(tasks, PARAMS_V2) : null, ...(Object.keys(L.check).length ? { checkOptions: L.check } : {}), ...(L.novelMode !== 'refuse' ? { novelMode: L.novelMode } : {}),
      evidence: { familyId: this.config.familyId, experiment: this.config.experiment, arm: this.arm.slug, version: state.version.n, adoptedAt: t.idx, traces: tasks.length,
        exactRate: exactOf(best.checkTraces), accepted: true }, effects: 'none' });
    state.version.libraryHash = entry.hash;
    tr.ev('library-register', { version: state.version.n, hash: entry.hash, entryVersion: entry.version, profileTasks: entry.profile?.n ?? 0 });
    return entry;
  }

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
        ...this.compileOpts, ...(inputs.refusals?.length ? { refusals: inputs.refusals } : {}), modelPort: this.port, workRoot: path.join(this.work, 'compile'), label: `v${n}-${tag}${attempt ? `-r${attempt}` : ''}`, models: this.arm.models, version: n,
        ...(this.library ? { library: this.registryOf(), interpreter: this.childInterpreter(tr, t), callHost: this.callHostOptsFor(tr, t) } : {}),
        ...(this.library?.agent ? { agentBudgetUsd: this.library.agent.budgetUsd } : {}), ...(this.library?.wide ? { wide: true } : {}) });
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
        ...(this.compareOf ? { compare: this.compareOf } : {}), ...(this.library ? { library: this.registryOf(), interpreter: this.childInterpreter(tr, t), callHost: this.callHostOptsFor(tr, t) } : {}) });
      recheckUsd = rc.costUsd ?? 0;
      tr.spend('compileCheck', recheckUsd, (rc.unknownCalls ?? 0) > 0);
      const C = this.config.compile;
      const how = C.acceptance || this.compareOf || inputs.refusals?.length || C.acceptanceIds || C.allowSharedExplanation ? { acceptance: C.acceptance, minPartial: C.minPartial, compare: this.compareOf,
        traces: inputs.traces, regressions: inputs.regressions, ...(inputs.refusals?.length ? { refusals: inputs.refusals } : {}),
        ...(C.acceptanceIds ? { ids: C.acceptanceIds } : {}), ...(C.allowSharedExplanation ? { allowSharedExplanation: true } : {}) } : {};
      rec.checkTraces = { ...(await checkFromSummary(rc, res.workdir, inputs.regressions.length, how)), recheck: { capUsd, firstCheck: compactCheck(rec.checkTraces) } };
    }
    mkdirSync(vdir, { recursive: true });
    if (hasSolve) copyFileSync(res.solvePath, path.join(vdir, 'solve.mjs'));
    if (res.workdir && existsSync(path.join(res.workdir, 'BUILD-NOTES.md'))) copyFileSync(path.join(res.workdir, 'BUILD-NOTES.md'), path.join(vdir, 'BUILD-NOTES.md'));
    if (res.workdir && existsSync(path.join(res.workdir, VERDICTS_FILE))) copyFileSync(path.join(res.workdir, VERDICTS_FILE), path.join(vdir, VERDICTS_FILE));   // S0-6 'structured'
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
    const picked = selectTraces(pool, this.config.jit.maxTraces), chosen = this.config.jit.preserveRefusals ? withRefusals(picked, pool) : picked;
    const traces = chosen.map(x => this.loadTrace(x.traceId));
    // v2.2: the positional case ids (trace-<i>, in compile order) of the refusal traces in this compile.
    const refusalIds = new Set(this.config.jit.preserveRefusals ? refusalPool(pool).map(x => x.traceId) : []);
    const refusals = chosen.map((x, i) => (refusalIds.has(x.traceId) ? `trace-${i}` : null)).filter(Boolean);
    const regressions = state.regressions.map(id => JSON.parse(readFileSync(path.join(this.p.regressions, `${id}.json`), 'utf8')));
    const previous = state.version ? readFileSync(path.join(this.p.dir, state.version.dir, 'solve.mjs'), 'utf8') : null;
    const inputs = { traces, regressions, previous, ...(refusals.length ? { refusals } : {}),
      hash: sha(canonical({ t: traces.map(x => x.traceId), r: state.regressions, p: previous ? sha(previous) : null, ...(refusals.length ? { f: refusals } : {}) })).slice(0, 12) };
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
    // v2.2: a version that answers a refused input differently from the agent (or never ran it) is rejected outright.
    const lost = best.checkTraces?.refusalCheck && !best.checkTraces.refusalCheck.ok ? best.checkTraces.refusalCheck : null;
    const why = lost ? `refusal lost (${[...lost.lost, ...lost.missing, ...lost.failed].join(', ')})`
      : state.version ? rejectReason(best.checkTraces, state.version.checkTraces) : null;
    // S0-6: the adoption decision and the acceptance verdict, logged whatever the rule (jit.adoptRequiresAcceptance).
    const rule = this.config.jit.adoptRequiresAcceptance ? 'requires-acceptance' : 'any-usable';
    const adoption = (adopted, extra = {}) => tr.ev('adoption', { version: n, builderModel: best.builderModel, adopted, accepted: ok(best), rule, keep: adopted ? null : state.version?.n ?? null,
      clean: !!best.checkTraces?.clean, exactRate: exactOf(best.checkTraces), ...(this.config.compile.acceptanceIds ? { acceptanceIds: this.config.compile.acceptanceIds } : {}), ...extra });
    if (why) {
      adoption(false, { reason: 'rejected' });
      tr.ev('rejected', { version: n, keep: state.version?.n ?? null, why, ...(state.version ? exactOnOld(best.checkTraces, state.version.checkTraces) : {}), newExactRate: exactOf(best.checkTraces),
        ...(lost ? { refusalCheck: lost } : {}),
        oldExactRate: state.version ? exactOf(state.version.checkTraces) : null, builderModel: best.builderModel });
      return;
    }
    if (this.config.jit.adoptRequiresAcceptance && !ok(best)) { adoption(false, { reason: 'not accepted' }); return; }
    adoption(true);
    const kind = state.version ? 'recompile' : 'compile';
    state.version = { n, dir: path.relative(this.p.dir, best.dir), sha: best.solveSha, builderModel: best.builderModel, checkTraces: best.checkTraces, adoptedAt: t.idx, accepted: ok(best) };
    if (this.library?.register && ok(best)) this.registerVersion(tr, t, state, traces, best);
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
    const rc = await this.compiled(tr, t, this.solvePathOf(state), version, state);
    if (rc.status !== 'ok') {
      const dk = rc.status === 'deopt' ? rc.deopt?.kind ?? 'unknown' : rc.status;
      tr.ev(rc.status === 'deopt' ? 'deopt' : rc.status, { version, deoptKind: dk, detail: rc.deopt?.name ?? rc.error?.code ?? null });
      const { trace } = await fallbackInterpret(dk, rc);
      return this.finish(tr, t, { delivered: 'interpreter', output: trace.answer, version, compiledStatus: rc.status, deoptKind: dk, error: trace.error ?? null,
        extra: { traceId: trace.traceId, ...(rc.calls ? { calls: rc.calls } : {}) }, stateAfter: structuredClone(state) });
    }
    state.compiledOks++;
    let delivered = 'compiled', output = rc.output;
    const extra = rc.calls ? { calls: rc.calls } : {};
    const flags = rc.flags?.count ?? 0;
    if (flags > 0) extra.flags = { count: flags, names: rc.flags.names ?? [] };
    // Scheduled shadows (every shadowEvery-th compiled ok, or with jit.shadowFloor a seeded draw u < shadowFloor) and,
    // opt-in, flag-triggered ones (the run raised flags). Every compiled ok row records shadowPropensity, the probability
    // it was shadowed: 1 when flagged (a forced verification), shadowFloor under the floor, null under a periodic schedule
    // (not a sample with a known propensity); with the floor, also shadowDraw (u, 6 dp).
    const floor = J.shadowFloor != null, u = floor ? shadowDrawOf(J.shadowSeed, t.idx) : null;
    const scheduled = floor ? u < J.shadowFloor : !!(J.shadowEvery && state.compiledOks % J.shadowEvery === 0), flagged = !!(J.shadowOnFlags && flags > 0);
    extra.shadowPropensity = flagged ? 1 : floor ? J.shadowFloor : null;
    if (floor) extra.shadowDraw = round(u);
    if (scheduled || flagged) {
      const reason = floor ? (scheduled && flagged ? 'floor+flag' : scheduled ? 'floor' : 'flag')
        : J.shadowOnFlags ? (scheduled && flagged ? 'schedule+flag' : scheduled ? 'schedule' : 'flag') : null;
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
      caps: { perTaskUsd: config.perTaskUsd, agentBudgetUsd: config.agentBudgetUsd, agentMinutes: config.agentMinutes, compile: config.compile, jit: config.jit, spendStopUsd: config.spendStopUsd,
        ...(config.armSpendStopUsd ? { armSpendStopUsd: config.armSpendStopUsd } : {}) },
      worstCaseUsd: Object.fromEntries(arms.map(a => [a.spec, worstCase(a, config, tasks.length)])) };
    log(JSON.stringify(plan, null, 1));
    return { runDir, plan, arms: [], rows: [] };
  }
  mkdirSync(runDir, { recursive: true });
  const fam = deps.loadFamily ? await deps.loadFamily(config.familyId) : null;
  const outputSchema = deps.outputSchema ?? fam?.outputSchema ?? null;
  // Spend already recorded by these arms (for the optional spend stop).
  const budget = { spent: 0 }, host = hostTracker();
  const runs = [];
  try {
    for (const arm of arms) {
      const R = arm.kind === 'jit' ? JitRun : ArmRun;
      const run = new R({ arm, config, runDir, workRoot, deps, log, budget, binary, host });
      runs.push(run);
      run.outputSchema = outputSchema;
      budget.spent += run.spent;
    }
    return await driveArms({ runs, tasks, config, deps, log, runDir });
  } finally { for (const run of runs) run.unlock?.(); }
}

async function driveArms({ runs, tasks, config, deps, log, runDir }) {
  for (const run of runs) {
    for (const [idx, r] of run.rows) if (tasks[idx] && r.taskHash !== tasks[idx].taskHash) throw new Error(`${run.arm.slug}: recorded task #${idx} (${r.taskKey}) differs from the config's: use a new experiment name`);
    // One journal per arm directory (SQLite contention between arm processes); agent arms need no gateway.
    if (run.arm.kind !== 'agent') run.port = deps.createModelPort({ journalFile: run.p.journal, allowedModels: run.arm.models, concurrency: { 'claude-cli': 16 } }).port;
    // jit.replayJournal (opt-in): JIT arms answer gateway calls from that exported journal first, live only on a miss.
    if (run.arm.kind === 'jit' && config.jit.replayJournal) run.port = await replayPort(config.jit.replayJournal, run.arm.slug, run.port, deps);
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
    catch (error) { run.host.exit(run.hostKey(t.idx)); if (error.code === 'ENV_FAULT') { run.fault(t, error); s.faults++; } else note(run, error); }
  });
  // JIT arms: sequential, in stream order; state comes from the last finished row.
  const streams = runs.filter(r => r.arm.kind === 'jit').map(async run => {
    const s = status.get(run.arm.slug);
    let state = freshState();
    // Slice 2a: the library registry is set up before the first task (ISO wipes it only when the arm starts fresh).
    try { run.registryOf(); } catch (error) { note(run, error); return; }
    for (const t of tasks) {
      const prior = run.rows.get(t.idx);
      if (prior) { state = structuredClone(prior.stateAfter ?? state); continue; }
      try { await run.runJitTask(t, state); s.done++; }
      catch (error) {
        run.host.exit(run.hostKey(t.idx));
        if (error.code === 'ENV_FAULT') { run.fault(t, error); s.faults++; log(`${run.arm.slug}: stream stops at #${t.idx} (resume continues it here)`); }
        else note(run, error);
        return;
      }
    }
  });
  await Promise.all([flatDone, ...streams]);
  // S0-1: a last export of every arm (faults and harness errors leave no row), and its failures as arm errors.
  for (const run of runs) { run.exportNow(); status.get(run.arm.slug).errors.push(...run.exportErrors); }
  return { runDir, arms: [...status.values()], rows: runs.flatMap(r => [...r.rows.values()]) };
}

// jit.replayJournal: a journal.jsonl as the S0-1 export writes it (journalToJsonl; '{slug}' is replaced by the arm slug,
// a relative path is taken from the repository), served by run-compiled.mjs createMemoPort with the arm's live port for
// misses. Memo hits cost $0; misses are live calls and are journaled as usual. The builder sessions are not replayed.
export function replayJournalPath(template, slug) { return path.resolve(REPO, template.replaceAll('{slug}', slug)); }
async function replayPort(template, slug, live, deps) {
  const file = replayJournalPath(template, slug);
  if (!existsSync(file)) throw new Error(`jit.replayJournal: ${file} does not exist`);
  const create = deps.createMemoPort ?? (await import('./run-compiled.mjs')).createMemoPort;
  return create({ journal: file, live });
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
