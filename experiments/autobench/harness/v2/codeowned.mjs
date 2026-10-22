// Arm A1-C v2 ("code-owned", harness version a1c-v2): run with `node experiments/autobench/run.mjs --harness codeowned-v2 ...`.
// Spec as built, deviations and the paid commands: research/automationbench-20261014/A1C-V2-DESIGN.md.
//
// Per task, in order:
//   1. INVENTORY  code, no model (v2/inventory.mjs): v1's enumeration, with the host clock recorded and, under the date
//                 note, load-time stamps kept out of record dates (M5).
//   2. LEDGERS    K = 3 clean-context readers over the standing instructions (the official system prompt, pointer
//                 "system"), the request and the inventory (v2/ledger.mjs); one re-ask when >= 2 readers fail to parse;
//                 code copies every literal, types it (v2/literals.mjs: values vs instruction clauses vs placeholders),
//                 merges on entity keys, attaches content negatives to the positive they limit; adjudication as v1.
//   3. CHECKS     code from the ledger before acting (v2/postconditions.mjs): app-faithful from the schema-derived effect
//                 table (effects.json), hard per literal, content limits as bodyNot / row_not_exists / record_unchanged,
//                 unsatisfiable bans dropped; one mapping call for what code cannot compile.
//   4. ACT        one session (the official system prompt verbatim + A0's tool section + the brief; the official user
//                 message). With the pre-send lint on (P0 decides the default), the session's client is tool-gated.mjs.
//   5. CHECK      one round of code checks + the clean-context checker (instrumentation: recorded, never acted on).
//   6. STOP       single pass: repairs are off (maxRounds 0); the round-0 result is recorded with the reason.
// Accounting, the audit (auditPipeline), environment-fault handling (pipelineStop) and the act system prompt are v1's,
// imported unchanged. Nothing here reads the task's name, the prepared task files, the initial-world dump, assertions,
// grades or host directories: the pipeline receives the official prompt, the tool catalog and a mailbox, and writes
// host-side logs it never reads back (the gate log is read back from the session's own mailbox directory only).
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, constants as fsc } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_KEEP_RO } from '../../../../src/executors/claude-code.mjs';
import { CHILD_ENV_ALLOWED } from '../../../../src/models/policy.mjs';
import { DATE_NOTE, REPO, sha256 } from '../../lib.mjs';
import { auditSession, readStream } from '../../accounting.mjs';
import { ENV_FAULTS } from '../../../lib/runner.mjs';
import { corpusPin, localImports, writeCliGuard } from '../foundry.mjs';
import { bridgeClient } from '../bridge-client.mjs';
import { auditPipeline, pipelineStop, INFRA_FAULT, servedSteps, nodeTokens, nodeModels, parseNodeModels, actSystemPrompt, ROLES } from '../codeowned.mjs';
import { buildInventory, renderInventory } from './inventory.mjs';
import { ADJUDICATE_SYSTEM, LEDGER_SYSTEM, adjudicatePrompt, applyDecisions, conflictSpans, ledgerPrompt, majorityOf, mergeLedgers, normalizeLedger, parseJsonReply, readDecisions, readerFailed, settleByCode, sourceMap, typeLedger } from './ledger.mjs';
import { CHECKER_SYSTEM, PCMAP_SYSTEM, applyMapped, checkerPrompt, evaluate, pcmapPrompt, postconditionsFromLedger, EFFECTS } from './postconditions.mjs';
import { BRIEF_END, BRIEF_FILES, briefSection, renderChecks, repairSection, runChecks, terminationDecision } from './checker.mjs';
import { GATE_ENV, GATE_LOG, gateConfig, gateSummary, readGateLog, writeGate } from './gate.mjs';

export { auditPipeline, pipelineStop, INFRA_FAULT, servedSteps, nodeTokens, nodeModels, parseNodeModels, actSystemPrompt, ROLES };

export const HARNESS_ID = 'codeowned-v2';
export const HARNESS_VERSION = 'a1c-v2';
export const ARM = 'A1-C v2 (code-owned harness)';
/** A dev-phase arm until a PREREG addendum names it: run.mjs runs assertDevOnly even when --harness-hash is given, so a
 * task list holding a test (or devCheck-by-mistake) task is refused before anything is prepared. */
export const DEV_ONLY = true;
export const PIPELINE_DEFAULTS = Object.freeze({ K: 3, inventorySteps: 16, checkSteps: 3, maxRounds: 0, actReserveResponses: 8, singlePassReserveResponses: 4, minRepairResponses: 4, nodeTimeoutMs: 240_000,
  inlineInventoryChars: 70_000, ledgerInventoryChars: 150_000, systemMaxBytes: 90_000, nodeBudgetShare: 0.1, reserveShare: 0.25, pcmap: true, parallelLedgers: true,
  minCheckerMs: 45_000,
  systemToReaders: true, reaskWhenFailed: 2, reaskMinMsLeft: 600_000,
  valueTyping: true, clauseWords: 9, clauseLenRatio: 3, clauseMinChars: 40,
  completeness: 'asked', derivedAgreement: 2, humanizeMachineValues: true,
  effectTable: 'effects.json', unobservable: 'null',
  contentConstraints: true,
  preSendLint: false, // set by the P0 rule (A1C-V2-DESIGN.md §8) before the v2 hash is frozen
  lintPerPair: 1, lintPerSession: 2,
  loadStampWindowMs: 43_200_000, entityKeyMerge: true });

/** H8: every knowledge source compiled into A1-C v2 (v1's four, then v2's). */
export const KNOWLEDGE = Object.freeze([
  'architect-written pipeline (claude-opus-5-5, build time) from research/architecture-20261015/FABLE-WHAT-WE-MISS.md (I-1..I-6) and the dev-side a1-dev-first6 diagnosis (dev split only): discovery is the bottleneck, host-date anchoring, eligibility misreads, unsupported "forbidden" items, unverified decisions, self-judged stopping',
  'the enumeration plan (inventory.mjs ENUM_PLAN): list endpoints and child relations derived from the API schemas shipped with the environment (the index api_search searches) and the URL routing it documents for api_fetch; checked host-side on dev worlds only',
  'the check grammar (postconditions.mjs): message sent / not sent, channel post / no post, record field, record created / deleted, sheet row; generic per system, no task content',
  'the official system prompt and the api tool catalog, as every session receives them (no task-specific content)',
  'a1c-v2 revisions (claude-opus-5-5, build time) from the a1c-dev60-dn anatomy and check-precision study (devTrain dev60, in-sample): repairs produced no pass; checks compiled to the wrong app or kind; instruction sentences and slots treated as values; content limits compiled as recipient bans; load-time stamps taken as business dates; items on different records merged',
  `the effect table (v2/effects.json), generated by v2/build-effects.mjs from tools/api/schemas/index.txt (sha256 ${EFFECTS.source.indexTxtSha256}) and <app>.jsonc (sha256 each recorded in effects.json), with the messaging-channel column from one stated rule over every operation's index description (build-effects.mjs MESSAGING_RULE)`,
  'the official system prompt given to ledger readers as the operator\'s standing instructions (pointer "system")',
  'with the date note on, timestamps within 12 h before (5 min after) the host clock at inventory time are treated as load stamps (observed on dev worlds)',
  // D21 (research/decisions-20261021.md): generic rules and thresholds tuned against dev60 GRADER results are allowed as
  // disclosed in-sample development; each one is listed here, and the check-precision study that drove them is committed
  // (research/automationbench-20261014/a1c-v2/precision/). Claims come only from tasks disjoint from dev60, drawn by a
  // committed seeded rule before the run (replay/heldout-look2.mjs).
  'D21 grader-tuned (dev60 in-sample, check-precision study and the B4 replay gate, which align checks with the grader verdicts): the value-typing thresholds clauseWords 9, clauseLenRatio 3, clauseMinChars 40, derivedAgreement 2, the sheet-wide share (>= 50% of >= 3 row checks) and the text-containment length 80 were set against the study\'s false-reject causes',
  'D21 grader-tuned: the B4 targets (aligned hard false rejects <= 25, hard false accepts <= 28, passing worlds rejected <= 3) were set from the study\'s hand-labelled v1 counts, and commits 2b52d5d (posts on an app whose listing shows no posts are unobservable; DMs match the member\'s im channels), 0de452b (a row added in another app than the spreadsheets is a record of that app) and a7ec52e (a kind named with its parent is the child kind; <kind>_list listings hold <kind> records) were made after reading B4 rows of dev60 grader comparisons',
  'D21 grader-tuned: the hand-written operation-word lists of v2/build-effects.mjs (CREATE, UPDATE, DELETE, READ and SEND token lists, VERB_SEG, SCOPE_PARAM) and its MESSAGING_RULE word patterns were written while reading dev60 compile failures against the grader verdicts; the messaging rule is applied to every operation of the shipped index, never per task',
  'D21 grader-tuned: the 12 h load-stamp window relies on how the simulator stamps records at world load (default_factory=datetime.now in the environment\'s schema files), observed while reading dev60 failures; it is active only with --date-note',
  'D21 review fixes of 2026-10-21 (after reading the three adversarial reviews, which cite B4 dev60 rows): observability decided from what the first read listed (a listed-but-empty kind fails), undecided hard checks reported as their own termination category, whole-batch lint refusals, completeness values only when the item\'s own source asks and never another recipient\'s, majority over the readers that answered, mapped checks with no majority value advisory, child records tied to their parent by exact field value only',
  'D21 grader-tuned (dev60 in-sample, set while reading dev60 compile failures): the value-typing rules of v2/literals.mjs: a restatement of the requirement is a clause when >= 60% of the statement\'s content words appear in a value of >= 5 words; a value of <= 8 words is short text (accepted); a slot of <= 3 alternatives joined by "or" or "/" is a slot, not a value; and v2/ledger.mjs: a hard literal is at most 160 characters',
  'D21 review fixes of 2026-10-21, routing and kinds (written while reading the reviews, which cite B4 dev60 rows): an e-mail item without an app goes to Gmail only when Gmail is connected; an unresolved channel is no channel (never the target\'s first word); a parent kind is dropped only when named next to its child; a deciding value the item\'s own source asks for stays in the message; an internal note (intercom, helpscout) is its own channel, apart from a reply',
  'D21 re-review fixes of 2026-10-21 (after the two re-reviews of the second build; no new dev60 grader row was read): a re-read cut by its step budget, a listing cap or a later page is no evidence of absence (not re-read); a post is observable per kind its operations create (effect table); a post without an app goes to Slack only when Slack is the one connected app that posts; a completeness value only for a record that links to no person outside the item\'s recipients (own address, or a referenced record by id or name); a mapped check pinned by a recipient, channel, parent, kind or spreadsheet stays hard; a held call sent on its own is never resent with its batch',
  'D21: the P0 pre-send lint decision (preSendLint) is taken by hand-reviewing each lint refusal of the dev60 replay against the recorded dev60 grades (A1C-V2-DESIGN.md §5 rule); the lint rules themselves are generic (left-out literals of the compiled content limits)',
]);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.resolve(HERE, '../../run.mjs');
const GATED_CLIENT = path.join(HERE, 'tool-gated.mjs');

// ---------------------------------------------------------------------------------------------------------------
// Manifest (PREREG-AB-v1 §6.1, AM-6): v1's rule, plus the effect table and the gated client.

export function manifestFiles() {
  const extra = ['experiments/autobench/bridge.py', 'experiments/autobench/tool.mjs', 'experiments/autobench/harness/v2/effects.json', 'experiments/autobench/harness/v2/tool-gated.mjs'].map(p => path.join(REPO, p));
  return [...new Set([...localImports(RUNNER), ...localImports(fileURLToPath(import.meta.url)), ...extra])].map(f => path.relative(REPO, f)).sort();
}
function policyFor(models, file = path.join(REPO, 'policy/models.json')) {
  const p = JSON.parse(readFileSync(file, 'utf8'));
  const ids = [...new Set(Object.values(models).filter(Boolean))].sort();
  const execs = ids.map(id => (p.executorModels ?? []).find(m => m.id === id)).filter(Boolean);
  return { provider: p.providers?.['claude-cli'] ?? null, models: Object.fromEntries(ids.map(id => [id, (p.models ?? []).find(m => m.id === id) ?? execs.find(m => m.id === id) ?? null])),
    ...(execs.length ? { remoteProviders: Object.fromEntries([...new Set(execs.map(m => m.provider))].sort().map(n => [n, p.providers?.[n] ?? null])) } : {}) };
}
export function codeownedConfig(o) {
  const models = nodeModels(o.model, o.nodeModels);
  return { harness: HARNESS_ID, version: HARNESS_VERSION, model: o.model ?? null, nodeModels: models, effort: o.effort ?? null, budgetUsd: o.budgetUsd, timeoutMin: o.timeoutMin,
    maxSteps: o.maxSteps, tools: o.tools, det: o.det, k: o.k, concurrency: o.concurrency, dateNote: Boolean(o.dateNote), pipeline: { ...PIPELINE_DEFAULTS, ...(o.pipeline ?? {}) },
    executor: o.executor ?? 'src/executors/claude-code.mjs runClaudeCode, DEFAULT_HIDDEN, DEFAULT_KEEP_RO + per-node step-guard directories; model nodes with no tools and --max-turns 1', cli: o.cli ?? null,
    childEnv: o.childEnv ?? Object.fromEntries(CHILD_ENV_ALLOWED.map(k => [k, typeof process.env[k] === 'string' ? process.env[k] : null])),
    policy: o.policy ?? policyFor(models), corpus: o.corpus ?? corpusPin(), knowledge: o.knowledge ?? [...KNOWLEDGE],
    gate: { envVar: GATE_ENV, client: 'harness/v2/tool-gated.mjs' } };
}
const canon = v => JSON.stringify(sortKeys(v));
function sortKeys(v) { if (Array.isArray(v)) return v.map(sortKeys); if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])); return v; }
export function codeownedManifest(config) {
  const files = manifestFiles().map(p => ({ path: p, sha256: sha256(readFileSync(path.join(REPO, p))) }));
  return { files, config, sha256: sha256(canon({ files, config })) };
}

// ---------------------------------------------------------------------------------------------------------------
// Host-side helpers (v1's, not exported there)

function copyTranscript(src, dst) {
  try { if (!lstatSync(src).isFile()) return false; } catch { return false; }
  try { mkdirSync(path.dirname(dst), { recursive: true }); copyFileSync(src, dst, fsc.COPYFILE_EXCL); return true; } catch { return false; }
}
const lastText = events => { const a = events.filter(e => e?.type === 'assistant').flatMap(e => (e.message?.content ?? []).filter(c => c?.type === 'text').map(c => c.text)); return a.at(-1) ?? null; };

// ---------------------------------------------------------------------------------------------------------------
// The pipeline

/**
 * runPipeline(o) -> a runner-shaped result plus { nodes, pipeline (statistics), clientLog } (v1's contract).
 * o: { official: {system, user}, catalog, workdir, nodeRoot, hostDir, guardDir, maxSteps, budgetUsd, timeoutMs, dateNote,
 *      models (per role), effort, tools, runner (sessions), nodeRunner (model nodes), cliTarget, scripted, pipeline, log }
 */
export async function runPipeline(o) {
  const P = { ...PIPELINE_DEFAULTS, ...(o.pipeline ?? {}) };
  const log = o.log ?? (() => {});
  const t0 = Date.now();
  const B = o.budgetUsd, maxSteps = o.maxSteps, maxWorldSteps = maxSteps - 1;
  const models = o.models;
  const mailbox = path.join(o.workdir, '.tools');
  const pdir = path.join(o.hostDir, 'pipeline');
  if (existsSync(pdir)) { let n = 1; while (existsSync(`${pdir}.prev-${n}`)) n += 1; renameSync(pdir, `${pdir}.prev-${n}`); }
  mkdirSync(pdir, { recursive: true });
  const hostWrite = (name, obj) => writeFileSync(path.join(pdir, name), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1));
  const nodes = [];
  let responses = 0, spent = 0, upper = 0, unknown = false, envFault = null;
  const tokensBy = {};
  const noteTokens = (model, r) => {
    const t = nodeTokens(r); if (!t || !model) return t;
    const b = (tokensBy[model] ??= { input: 0, output: 0, cachedInput: 0, total: 0, nodes: 0 });
    for (const k of ['input', 'output', 'cachedInput', 'total']) b[k] += t[k]; b.nodes += 1;
    return t;
  };
  const HALT = Symbol('environment fault');
  const halt = () => { if (envFault) throw HALT; };
  const noteFault = code => { if (ENV_FAULTS.has(code)) envFault ??= code; };
  const toolUses = [];
  const client = bridgeClient({ mailbox, responsesSoFar: () => responses, maxResponses: maxSteps });
  const msLeft = () => o.timeoutMs - (Date.now() - t0);
  const usdLeft = () => B - upper;
  const settle = (r, budget) => {
    const known = typeof r?.costUsd === 'number' && Number.isFinite(r.costUsd);
    if (known) { spent += r.costUsd; upper += r.costUsd; } else { unknown = true; upper += r?.costUpperUsd ?? budget; }
    return known ? r.costUsd : null;
  };
  const guardOne = writeCliGuard(path.join(o.guardDir, 'node'), { maxTurns: 1, target: o.cliTarget ?? 'claude' });
  const slot = () => { nodes.push(null); return nodes.length - 1; };
  const tag = idx => String(idx).padStart(2, '0');
  const nodeDir = (idx, name) => { const d = path.join(o.nodeRoot, `${tag(idx)}-${name}`); rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); return d; };
  const transcriptPath = (idx, name) => path.join(pdir, 'nodes', `${tag(idx)}-${name}.jsonl`);

  async function modelNode(name, role, system, prompt, meta = null) {
    const model = models[role];
    const budget = Math.max(0.005, Math.min(P.nodeBudgetShare * B, usdLeft()));
    const idx = slot();
    const dir = nodeDir(idx, name), tfile = transcriptPath(idx, name);
    const started = Date.now() / 1000;
    let r;
    try {
      r = await o.nodeRunner({ model, prompt, systemPrompt: system, workdir: dir, files: {}, budgetUsd: budget, timeoutMs: Math.max(30_000, Math.min(P.nodeTimeoutMs, msLeft() - 60_000)), effort: o.effort ?? null,
        tools: [], task: { name: role, fork: 0 }, maxTurns: 1, binary: guardOne.binary, keepRo: [...DEFAULT_KEEP_RO, guardOne.dir] });
    } catch (e) { r = { ok: false, error: { code: ENV_FAULTS.has(e?.code) ? e.code : 'NODE_ERROR', message: String(e?.message ?? e).slice(0, 300) }, costUsd: null, costUnknown: true, costUpperUsd: budget }; }
    noteFault(r?.error?.code);
    const ended = Date.now() / 1000;
    const copied = copyTranscript(path.join(dir, '.executor-transcript.jsonl'), tfile);
    const events = copied ? readStream(tfile) : [];
    const audit = auditSession({ events, calls: [], maxSteps, expectModel: o.scripted ? null : model });
    const resp = events.length ? audit.modelResponses : (r?.turns ?? 1);
    responses += resp;
    const cost = settle(r, budget);
    const text = typeof r?.result === 'string' ? r.result : lastText(events);
    const json = parseJsonReply(text);
    nodes[idx] = { idx, name, kind: 'model', role, model, responses: resp, costUsd: cost, costUpperUsd: r?.costUpperUsd ?? budget, started, ended, transcript: copied ? path.relative(o.hostDir, tfile) : null,
      parsed: Boolean(json), error: r?.error?.code ?? null, tokens: noteTokens(model, r) };
    hostWrite(`${tag(idx)}-${name}.reply.txt`, String(text ?? ''));
    if (meta) Object.assign(meta, { error: r?.error?.code ?? null, completed: !r?.error && typeof text === 'string' && text.length > 0 });
    return json;
  }

  const sys = brief => actSystemPrompt(o.official.system, o.catalog, maxSteps, { dateNote: o.dateNote, brief });
  const fit = (...briefs) => {
    for (const b of briefs) if (Buffer.byteLength(sys(b)) <= P.systemMaxBytes) return b;
    const b = briefs.at(-1), room = P.systemMaxBytes - Buffer.byteLength(sys('')) - 400;
    let cut = b.slice(0, Math.max(0, room));
    while (Buffer.byteLength(cut) > room) cut = cut.slice(0, Math.floor(cut.length * 0.95));
    return `${cut}\n…(brief cut for size: ${BRIEF_FILES.ledger}, ${BRIEF_FILES.checks} and ${BRIEF_FILES.inventory} in your working directory hold all of it)\n${BRIEF_END}`;
  };

  // A session node; `gate` (the act session with the pre-send lint on): gate.json in the session's read-only step-guard
  // directory, the gated client over tool.mjs, AB_GATE_DIR in the session environment, the log read back afterwards.
  async function sessionNode(name, role, brief, cap, budget, gate = null) {
    const model = models[role];
    const guard = writeCliGuard(path.join(o.guardDir, name), { maxTurns: cap, target: o.cliTarget ?? 'claude' });
    if (gate) {
      writeGate(guard.dir, gate);
      rmSync(path.join(o.workdir, 'tool.mjs'), { force: true });
      copyFileSync(GATED_CLIENT, path.join(o.workdir, 'tool.mjs'));
      rmSync(path.join(mailbox, GATE_LOG), { force: true, recursive: true });
    }
    const systemPrompt = sys(brief);
    const idx = slot();
    const stepsBefore = servedSteps(mailbox);
    const tfile = transcriptPath(idx, name), live = path.join(o.workdir, '.executor-transcript.jsonl');
    rmSync(live, { force: true });
    const started = Date.now() / 1000;
    let r;
    try {
      r = await o.runner({ model, prompt: o.official.user, systemPrompt, workdir: o.workdir, files: {}, budgetUsd: budget, timeoutMs: Math.max(60_000, msLeft() - 3 * 60_000), effort: o.effort ?? null,
        tools: o.tools ?? ['Bash'], task: { name: role, fork: 0 }, maxTurns: cap, binary: guard.binary, keepRo: [...DEFAULT_KEEP_RO, guard.dir], ...(gate ? { env: { [GATE_ENV]: guard.dir } } : {}) });
    } catch (e) { r = { ok: false, error: { code: ENV_FAULTS.has(e?.code) ? e.code : 'SESSION_ERROR', message: String(e?.message ?? e).slice(0, 300) }, costUsd: null, costUnknown: true, costUpperUsd: budget }; }
    noteFault(r?.error?.code);
    const ended = Date.now() / 1000;
    const copied = copyTranscript(live, tfile);
    rmSync(live, { force: true });
    const events = copied ? readStream(tfile) : [];
    const audit = auditSession({ events, calls: [], maxSteps, expectModel: o.scripted ? null : model });
    const resp = events.length ? audit.modelResponses : (r?.turns ?? 0);
    responses += resp;
    const cost = settle(r, budget);
    toolUses.push(...(r?.toolUses ?? []));
    hostWrite(`${tag(idx)}-${name}.system.txt`, systemPrompt);
    nodes[idx] = { idx, name, kind: 'session', role, model, cap, responses: resp, costUsd: cost, costUpperUsd: r?.costUpperUsd ?? budget, started, ended, transcript: copied ? path.relative(o.hostDir, tfile) : null,
      stopReason: audit.stopReason, error: r?.error?.code ?? null, tokens: noteTokens(model, r) };
    if (gate) {
      const g = readGateLog(path.join(mailbox, GATE_LOG));
      hostWrite('gate-log.json', { status: g.status, lines: g.lines });
      const sum = gateSummary(g.lines), steps = servedSteps(mailbox) - stepsBefore;
      // Fail-open made visible: the session reached the world but no client invocation loaded the configuration.
      const active = sum.loaded > 0 ? true : steps > 0 ? false : null;
      nodes[idx].gate = { ...sum, installed: true, active, worldSteps: steps, rules: gate.rules.length, log: g.status, client: { path: 'harness/v2/tool-gated.mjs', sha256: sha256(readFileSync(GATED_CLIENT)) } };
      if (active === false) log(`[codeowned-v2] pre-send lint NOT active: ${steps} world step(s) and no client invocation loaded gate.json`);
    }
    return r;
  }

  const codeNode = async (name, fn) => {
    const idx = slot(), started = Date.now() / 1000;
    nodes[idx] = { idx, name, kind: 'code', responses: 0, steps: 0, started, ended: null };
    const out = await fn();
    nodes[idx].steps = client.log.filter(e => e.node === name && !e.refused).length;
    nodes[idx].ended = Date.now() / 1000;
    return out;
  };

  const stats = { inventory: null, ledger: null, checks: [], rounds: 0, termination: null, nullHard: null, gate: null };
  let actError = null, acted = false, rethrow = null;
  try {
    // 1. INVENTORY
    const inv = await codeNode('inventory', () => buildInventory({ request: o.official.user, client, maxSteps: P.inventorySteps, node: 'inventory', dateNote: Boolean(o.dateNote), windowMs: P.loadStampWindowMs }));
    const fullText = renderInventory(inv, { maxChars: 4_000_000 });
    writeFileSync(path.join(o.workdir, BRIEF_FILES.inventory), fullText);
    hostWrite('inventory.json', inv);
    stats.inventory = { steps: inv.steps, calls: inv.calls, connected: inv.connected.length, outOfScope: inv.outOfScope.length, records: inv.records.length, truncated: inv.truncated.length, entities: inv.entities.length, titleProbes: inv.titleProbes.length, precedents: inv.precedents.length, chars: fullText.length, errors: inv.errors.length };
    log(`[codeowned-v2] inventory: ${inv.records.length} records in ${inv.steps} steps; connected ${inv.connected.join(',')}`);

    // 2. LEDGERS (K clean contexts over the standing instructions, the request and the inventory)
    const system = P.systemToReaders ? o.official.system : null;
    const sources = sourceMap(o.official.user, inv, { system, dateNote: Boolean(o.dateNote), windowMs: P.loadStampWindowMs });
    const dateNote = o.dateNote ? DATE_NOTE : null;
    const reader = async (k, name = `ledger-${k + 1}`) => {
      const text = renderInventory(inv, { maxChars: P.ledgerInventoryChars, order: k === 0 ? null : k });
      const meta = {};
      const json = await modelNode(name, 'ledger', LEDGER_SYSTEM, ledgerPrompt({ request: o.official.user, system, inventoryText: text, precedents: inv.precedents, dateNote }), meta);
      return { json, ledger: normalizeLedger(json, sources, { reader: k + 1 }), ...meta };
    };
    const reads = [];
    if (P.parallelLedgers) reads.push(...await Promise.all(Array.from({ length: P.K }, (_, k) => reader(k))));
    else for (let k = 0; k < P.K; k++) reads.push(await reader(k));
    halt();
    // Ride-along 1: one re-ask when >= reaskWhenFailed readers gave no ledger. Only a reader whose reply COMPLETED but did
    // not parse is asked again (a timeout or a budget stop would fail the same way), and only with time to spare.
    const failed = reads.map((r, k) => (readerFailed(r.json) ? k : -1)).filter(k => k >= 0);
    let reasked = null;
    if (P.reaskWhenFailed && failed.length >= P.reaskWhenFailed) {
      const k = failed.find(i => reads[i].completed);
      if (k === undefined) reasked = { reader: null, parsed: false, skipped: 'no failed reader completed its reply (timeouts or stops are not re-asked)' };
      else if (!(responses + 1 <= maxSteps - P.actReserveResponses)) reasked = { reader: k + 1, parsed: false, skipped: 'response budget' };
      else if (msLeft() < (P.reaskMinMsLeft ?? 0)) reasked = { reader: k + 1, parsed: false, skipped: 'time budget' };
      else {
        const again = await reader(k, `ledger-${k + 1}b`);
        halt();
        reasked = { reader: k + 1, parsed: !readerFailed(again.json) };
        if (!readerFailed(again.json)) reads[k] = again;
      }
    }
    const ledgers = reads.map(r => r.ledger);
    const merged = mergeLedgers(ledgers, { sources, entityKeyMerge: P.entityKeyMerge });
    const { settled, open } = settleByCode(merged.conflicts, sources);
    const decisions = settled.map(s => ({ conflict: s.conflict, choice: s.choice, by: 'code', rule: s.rule }));
    if (open.length && responses + 1 <= maxSteps - P.actReserveResponses) {
      const reply = await modelNode('adjudicate', 'adjudicate', ADJUDICATE_SYSTEM, adjudicatePrompt({ request: o.official.user, conflicts: open, sourceSpans: conflictSpans(open, sources), dateNote }));
      halt();
      decisions.push(...readDecisions(reply, open));
    } else for (const c of open) decisions.push({ conflict: c, choice: null, by: 'unsettled (no budget)' });
    applyDecisions(merged, decisions);
    const typing = typeLedger(merged, sources, inv, P);
    hostWrite('ledgers.json', { ledgers, merged, reasked });

    // 3. CHECKS (before acting); support is counted over the readers that answered (majorityOf).
    const majority = majorityOf(merged);
    let pcs = postconditionsFromLedger(merged, inv, { sources, P, majority });
    const satisfiability = pcs.satisfiability, compileStats = pcs.stats;
    const judgedItems = [...new Set(pcs.filter(p => p.type === 'judged' && p.polarity === 'positive').map(p => p.item))].map(id => merged.items.find(i => i.id === id)).filter(Boolean);
    let mapped = 0;
    if (P.pcmap && judgedItems.length && responses + 1 <= maxSteps - P.actReserveResponses) {
      const reply = await modelNode('pcmap', 'pcmap', PCMAP_SYSTEM, pcmapPrompt({ items: judgedItems, inventoryText: renderInventory(inv, { maxChars: 40_000 }), dateNote }));
      halt();
      ({ pcs, mapped } = applyMapped(pcs, reply, { itemFor: c => judgedItems.find(i => i.id === String(c?.requirement)), sources, inv, majority, P }));
    }
    pcs = pcs.map((p, i) => ({ ...p, id: `P${i + 1}` }));
    const atStart = pcs.map(p => ({ id: p.id, ...evaluate(p, inv, inv) }));
    writeFileSync(path.join(o.workdir, BRIEF_FILES.ledger), JSON.stringify({ today: merged.today, requirements: merged.items.filter(i => !i.superseded), unsupportedNegatives: merged.dropped }, null, 1));
    writeFileSync(path.join(o.workdir, BRIEF_FILES.checks), JSON.stringify(pcs.map(p => ({ id: p.id, requirement: p.item, type: p.type, hard: p.hard, params: p.params, statement: p.statement })), null, 1));
    hostWrite('postconditions.json', { pcs, atStart });
    hostWrite('satisfiability.json', satisfiability);
    const items = merged.items.filter(i => !i.superseded);
    stats.ledger = { readersOk: merged.readersOk, readers: merged.readers, supportNeeded: majority, reasked, items: items.length, positive: items.filter(i => i.polarity === 'positive').length, negative: items.filter(i => i.polarity === 'negative').length,
      majority: items.filter(i => i.support >= majority).length, conflicts: merged.conflicts.length, settledByCode: settled.length, adjudicated: open.length, droppedNegatives: merged.dropped.length,
      literals: items.reduce((s, i) => s + i.fields.length, 0), unverifiedLiterals: items.reduce((s, i) => s + i.fields.filter(f => !f.verified).length, 0), today: merged.today ? 'set' : 'unset',
      checks: pcs.length, hardChecks: pcs.filter(p => p.hard).length, judgedChecks: pcs.filter(p => p.type === 'judged').length, mappedChecks: mapped, trueAtStart: atStart.filter(a => a.pass === true).length,
      demotedLiterals: typing.demotedLiterals, slotsFilled: typing.slotsFilled, softLiterals: typing.softLiterals, clauseLiterals: typing.clauseLiterals, completenessLiterals: typing.completenessLiterals,
      contentLimits: compileStats.contentLimits, standingExclusions: typing.standingExclusions, satisfiabilityDrops: compileStats.satisfiabilityDrops, unattachedContent: merged.unattachedContent.length,
      unobservableChecks: pcs.filter(p => atStart.find(a => a.id === p.id)?.unobservable).length, sheetWide: compileStats.sheetWide };
    if (merged.readersOk < merged.readers) log(`[codeowned-v2] degraded ledger: ${merged.readersOk} of ${merged.readers} readers answered (majority ${majority})`);

    // 4. ACT (the lint is installed only when the compile produced at least one rule).
    const gateCfg = P.preSendLint ? gateConfig(pcs, { merged, perPair: P.lintPerPair, perSession: P.lintPerSession }) : null;
    const gate = gateCfg?.rules.length ? gateCfg : null;
    const inlineText = renderInventory(inv, { maxChars: P.inlineInventoryChars });
    const inline = !inlineText.includes('left out of this listing');
    // Responses kept back after the act session: repairs (maxRounds > 0), else the checker (1) plus the AM-1 drift (3).
    const reserve = P.maxRounds === 0 ? (P.singlePassReserveResponses ?? P.actReserveResponses) : P.actReserveResponses;
    const actCap = Math.max(3, Math.min(maxSteps - 1, maxSteps - responses - reserve));
    const briefArgs = { inv, merged, pcs, stepsLeft: maxWorldSteps - servedSteps(mailbox) - P.checkSteps, responseCap: actCap, inventoryText: inlineText, gate: Boolean(gate), singlePass: P.maxRounds === 0 };
    const brief = fit(...(inline ? [briefSection({ ...briefArgs, inline: true })] : []), briefSection({ ...briefArgs, inline: false }));
    const actBudget = Math.max(0.02, usdLeft() - P.reserveShare * B);
    const act = await sessionNode('act', 'act', brief, actCap, actBudget, gate);
    stats.gate = nodes.find(n => n?.name === 'act')?.gate ?? (gate ? { installed: true } : { installed: false, rules: gateCfg ? 0 : null });
    actError = act?.error?.code ?? null;
    halt();
    acted = true;

    // 5. CHECK (one round, recorded), then the code-owned stop (repairs off by default).
    const judge = async its => (responses + 1 <= maxSteps && msLeft() >= P.minCheckerMs && (stats.rounds === 0 || its.some(x => x.hard)) ? modelNode(`checker-${stats.rounds}`, 'checker', CHECKER_SYSTEM, checkerPrompt({ items: its, dateNote })) : null);
    for (;;) {
      const chk = await codeNode(`check-${stats.rounds}`, () => runChecks({ client, inv, pcs, maxSteps: P.checkSteps, judge, sources, node: `check-${stats.rounds}` }));
      halt();
      const row = { round: stats.rounds, checks: chk.results.length, pass: chk.results.filter(r => r.pass === true).length, fail: chk.results.filter(r => r.pass === false).length, undecided: chk.results.filter(r => r.pass === null).length,
        hardFail: chk.results.filter(r => r.pc.hard && r.pass === false).length, nullHard: chk.results.filter(r => r.pc.hard && r.pass === null).length, unobservable: chk.results.filter(r => !r.observable).length,
        notReread: chk.results.filter(r => r.notReread).length, judged: chk.judged, steps: chk.steps };
      stats.checks.push(row);
      stats.nullHard = row.nullHard;
      hostWrite(`check-${stats.rounds}.json`, chk.results.map(r => ({ id: r.pc.id, hard: r.pc.hard, type: r.pc.type, pass: r.pass, by: r.by, observable: r.observable, notReread: r.notReread, evidence: r.evidence })));
      const decision = terminationDecision({ results: chk.results, responsesUsed: responses, maxResponses: maxSteps, stepsUsed: servedSteps(mailbox), maxWorldSteps, round: stats.rounds, maxRounds: P.maxRounds, usdLeft: usdLeft(), msLeft: msLeft(), minRepairResponses: P.minRepairResponses, checkSteps: P.checkSteps });
      log(`[codeowned-v2] check round ${stats.rounds}: ${row.pass}/${row.checks} pass, ${row.hardFail} hard fail, ${row.nullHard} hard undecided -> ${decision.repair ? 'repair' : `stop (${decision.reason})`}`);
      if (!decision.repair) { stats.termination = { reason: decision.reason, category: decision.category ?? null, failingHard: row.hardFail, undecidedHard: row.nullHard }; break; }
      // Repair rounds (maxRounds > 0 only; v1 semantics, not part of the v2 evaluation).
      stats.rounds += 1;
      const failing = chk.results.filter(r => r.pc.hard && r.pass === false).map(r => ({ pc: r.pc, evidence: r.evidence, sourceText: r.pc.source && r.pc.source !== 'request' ? String(sources.get(r.pc.source)?.text ?? '').replace(/\s+/g, ' ').slice(0, 800) : '' }));
      const passing = chk.results.filter(r => r.pass === true);
      const cap = Math.max(2, maxSteps - responses - 1);
      const rb = fit(repairSection({ failing, passing, stepsLeft: maxWorldSteps - servedSteps(mailbox) - P.checkSteps, responseCap: cap, round: stats.rounds }));
      writeFileSync(path.join(o.workdir, BRIEF_FILES.repair), `${renderChecks(failing.map(f => f.pc))}\n\n${failing.map(f => `${f.pc.id}: ${f.evidence}`).join('\n')}\n`);
      await sessionNode(`repair-${stats.rounds}`, 'repair', rb, cap, Math.max(0.01, usdLeft() - P.nodeBudgetShare * B));
      halt();
    }
  } catch (e) {
    ({ actError, rethrow } = pipelineStop({ e, halted: e === HALT, envFault, acted, actError, stats, log, tag: '[codeowned-v2]', last: nodes.filter(Boolean).at(-1)?.name }));
  }
  try {
    hostWrite('client-log.json', client.log);
    for (let i = 0; i < nodes.length; i++) if (!nodes[i]) nodes[i] = { idx: i, name: 'unfinished', kind: 'code', responses: 0, steps: 0, started: 0, ended: 0 };
    hostWrite('nodes.json', nodes);
  } catch (e) { if (!rethrow) throw e; }
  if (rethrow) throw rethrow;
  const tokenSum = k => Object.values(tokensBy).reduce((s, b) => s + b[k], 0);
  return { ok: !actError, error: actError ? { code: actError } : null, costUsd: unknown ? null : spent, costUnknown: unknown, costUpperUsd: upper, turns: responses, durationMs: Date.now() - t0, toolUses,
    tokens: Object.keys(tokensBy).length ? { input: tokenSum('input'), output: tokenSum('output'), cachedInput: tokenSum('cachedInput'), total: tokenSum('total'), byModel: tokensBy } : null,
    nodes, clientLog: client.log, pipeline: { ...stats, responses, nodes: nodes.map(n => ({ name: n.name, kind: n.kind, model: n.model ?? null, responses: n.responses, steps: n.steps ?? null, cap: n.cap ?? null, costUsd: n.costUsd ?? null, error: n.error ?? null, parsed: n.parsed ?? null, ...(n.tokens ? { tokens: n.tokens.total } : {}), ...(n.gate ? { gate: n.gate } : {}) })) }, label: `pipeline:${HARNESS_ID}` };
}
