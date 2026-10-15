// Arm A1-C of PREREG-AB-v1 ("code-owned", harness version a1c-v1): the host runner is the workflow engine and every
// model call is a node. Run with `node experiments/autobench/run.mjs --harness codeowned ...`.
//
// Per task, in order (research/architecture-20261015/FABLE-WHAT-WE-MISS.md I-1..I-6):
//   1. INVENTORY  code, no model (inventory.mjs): every app listed through the same bridge mailbox the agent uses; 401 =
//                 out of scope; entity look-ups, spreadsheets by title, precedents; <= 16 world steps.
//   2. LEDGERS    K = 3 clean-context model calls (ledger.mjs), each over the request + inventory; code copies every
//                 literal verbatim from the cited span, drops negatives without a cited rule, unions for recall, dedups,
//                 settles conflicts by the newer / more specific source; one adjudication call only when code cannot.
//   3. POSTCONDITIONS code from the ledger (postconditions.mjs), written BEFORE acting; one mapping call only for the
//                 requirements code cannot turn into a check.
//   4. ACT        one agent session on the existing executor path: the official system prompt verbatim + A0's tool
//                 section (with the AM-9 date note when on) + a code-generated work brief; the official user message.
//   5. CHECK      code re-reads the world and evaluates the checks; a clean-context checker call only for what code
//                 cannot decide (it sees requirement, cited source span and re-read state, never the transcript).
//   6. TERMINATION code-owned (checker.mjs): repair sessions given only the failing checks and their evidence, until all
//                 hard checks pass or no round fits the remaining responses, steps, money or time.
// Every model call counts toward the 50 model responses (the same counting as accounting.mjs), every world step
// (code-issued or session-issued) toward the bridge's 49; both are audited per task (auditPipeline). Nothing here
// reads the task's name, the prepared task files, the initial-world dump, assertions, grades or host directories: the
// pipeline receives the official prompt, the tool catalog and a mailbox, and writes host-side logs it never reads back.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, constants as fsc } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_KEEP_RO } from '../../../src/executors/claude-code.mjs';
import { CHILD_ENV_ALLOWED } from '../../../src/models/policy.mjs';
import { DATE_NOTE, REPO, adapterText, sha256 } from '../lib.mjs';
import { auditSession, readStream } from '../accounting.mjs';
import { corpusPin, localImports, writeCliGuard } from './foundry.mjs';
import { bridgeClient } from './bridge-client.mjs';
import { buildInventory, renderInventory } from './inventory.mjs';
import { ADJUDICATE_SYSTEM, LEDGER_SYSTEM, adjudicatePrompt, applyDecisions, conflictSpans, ledgerPrompt, mergeLedgers, normalizeLedger, parseJsonReply, readDecisions, settleByCode, sourceMap } from './ledger.mjs';
import { CHECKER_SYSTEM, PCMAP_SYSTEM, checkerPrompt, evaluate, pcmapPrompt, postconditionsFromLedger, validateMapped } from './postconditions.mjs';
import { BRIEF_FILES, briefSection, renderChecks, repairSection, runChecks, terminationDecision } from './checker.mjs';

export const HARNESS_ID = 'codeowned';
export const HARNESS_VERSION = 'a1c-v1';
export const ROLES = Object.freeze(['ledger', 'adjudicate', 'pcmap', 'checker', 'act', 'repair']);
export const PIPELINE_DEFAULTS = Object.freeze({ K: 3, inventorySteps: 16, checkSteps: 3, maxRounds: 2, actReserveResponses: 8, minRepairResponses: 4, nodeTimeoutMs: 240_000,
  inlineInventoryChars: 60_000, ledgerInventoryChars: 150_000, nodeBudgetShare: 0.1, reserveShare: 0.25, pcmap: true });

/** H8: every knowledge source compiled into A1-C. Update with every harness version. */
export const KNOWLEDGE = Object.freeze([
  'architect-written pipeline (claude-opus-5-5, build time) from research/architecture-20261015/FABLE-WHAT-WE-MISS.md (I-1..I-6) and the dev-side a1-dev-first6 diagnosis (dev split only): discovery is the bottleneck, host-date anchoring, eligibility misreads, unsupported "forbidden" items, unverified decisions, self-judged stopping',
  'the enumeration plan (inventory.mjs ENUM_PLAN): list endpoints and child relations derived from the API schemas shipped with the environment (the index api_search searches) and the URL routing it documents for api_fetch; checked host-side on dev worlds only',
  'the check grammar (postconditions.mjs): message sent / not sent, channel post / no post, record field, record created / deleted, sheet row; generic per system, no task content',
  'the official system prompt and the api tool catalog, as every session receives them (no task-specific content)',
]);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.resolve(HERE, '../run.mjs');

// ---------------------------------------------------------------------------------------------------------------
// Manifest (PREREG-AB-v1 §6.1, AM-6): the files A1-C reads or runs and the settings that change what its models see.

export function manifestFiles() {
  const extra = ['experiments/autobench/bridge.py', 'experiments/autobench/tool.mjs'].map(p => path.join(REPO, p));
  return [...new Set([...localImports(RUNNER), ...localImports(fileURLToPath(import.meta.url)), ...extra])].map(f => path.relative(REPO, f)).sort();
}
/** The model per node role: --model for every role unless --node-models role=id,... overrides one. */
export function nodeModels(model, overrides = {}) {
  const out = Object.fromEntries(ROLES.map(r => [r, model ?? null]));
  for (const [k, v] of Object.entries(overrides ?? {})) { if (!ROLES.includes(k)) throw new Error(`unknown node role ${k} (one of ${ROLES.join(', ')})`); out[k] = v; }
  return out;
}
export const parseNodeModels = s => Object.fromEntries(String(s ?? '').split(',').filter(Boolean).map(x => { const [k, v] = x.split('='); if (!k || !v) throw new Error(`--node-models expects role=model,...: ${x}`); return [k.trim(), v.trim()]; }));
function policyFor(models, file = path.join(REPO, 'policy/models.json')) {
  const p = JSON.parse(readFileSync(file, 'utf8'));
  return { provider: p.providers?.['claude-cli'] ?? null, models: Object.fromEntries([...new Set(Object.values(models).filter(Boolean))].sort().map(id => [id, (p.models ?? []).find(m => m.id === id) ?? null])) };
}
export function codeownedConfig(o) {
  const models = nodeModels(o.model, o.nodeModels);
  return { harness: HARNESS_ID, version: HARNESS_VERSION, model: o.model ?? null, nodeModels: models, effort: o.effort ?? null, budgetUsd: o.budgetUsd, timeoutMin: o.timeoutMin,
    maxSteps: o.maxSteps, tools: o.tools, det: o.det, k: o.k, concurrency: o.concurrency, dateNote: Boolean(o.dateNote), pipeline: { ...PIPELINE_DEFAULTS, ...(o.pipeline ?? {}) },
    executor: 'src/executors/claude-code.mjs runClaudeCode, DEFAULT_HIDDEN, DEFAULT_KEEP_RO + per-node step-guard directories; model nodes with no tools and --max-turns 1', cli: o.cli ?? null,
    childEnv: o.childEnv ?? Object.fromEntries(CHILD_ENV_ALLOWED.map(k => [k, typeof process.env[k] === 'string' ? process.env[k] : null])),
    policy: o.policy ?? policyFor(models), corpus: o.corpus ?? corpusPin(), knowledge: o.knowledge ?? [...KNOWLEDGE] };
}
const canon = v => JSON.stringify(sortKeys(v));
function sortKeys(v) { if (Array.isArray(v)) return v.map(sortKeys); if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])); return v; }
export function codeownedManifest(config) {
  const files = manifestFiles().map(p => ({ path: p, sha256: sha256(readFileSync(path.join(REPO, p))) }));
  return { files, config, sha256: sha256(canon({ files, config })) };
}

/** The acting session's system prompt: official system prompt verbatim + A0's tool section + the brief. */
export function actSystemPrompt(officialSystem, catalog, maxSteps, { dateNote = false, brief }) {
  if (typeof officialSystem !== 'string' || !officialSystem) throw new Error('the official system prompt is required');
  return `${officialSystem}\n\n${adapterText(catalog, maxSteps, { dateNote })}\n\n${brief}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Host-side helpers

/** Copy a node transcript into the host directory only if it is a regular file (the workdir is agent-writable). */
function copyTranscript(src, dst) {
  try { if (!lstatSync(src).isFile()) return false; } catch { return false; }
  try { mkdirSync(path.dirname(dst), { recursive: true }); copyFileSync(src, dst, fsc.COPYFILE_EXCL); return true; } catch { return false; }
}
/** World steps the bridge has served so far (answers carrying results), read from the mailbox. */
export function servedSteps(mailbox) {
  let n = 0;
  try {
    for (const f of readdirSync(mailbox)) {
      if (!/^res-\d+\.json$/.test(f)) continue;
      try { const st = lstatSync(path.join(mailbox, f)); if (!st.isFile()) continue; if (JSON.parse(readFileSync(path.join(mailbox, f), 'utf8')).results) n += 1; } catch { /* partial */ }
    }
  } catch { /* no mailbox */ }
  return n;
}
const lastText = events => { const a = events.filter(e => e?.type === 'assistant').flatMap(e => (e.message?.content ?? []).filter(c => c?.type === 'text').map(c => c.text)); return a.at(-1) ?? null; };

// ---------------------------------------------------------------------------------------------------------------
// The pipeline

/**
 * runPipeline(o) -> a runner-shaped result ({ ok, error, costUsd, costUnknown, costUpperUsd, turns, durationMs, toolUses })
 * plus { nodes, pipeline (statistics), clientLog }.
 * o: { official: {system, user}, catalog, workdir (the session workdir: tool client + mailbox), nodeRoot, hostDir, guardDir,
 *      maxSteps, budgetUsd, timeoutMs, dateNote, models (per role), effort, tools, runner (sessions), nodeRunner (model
 *      nodes), cliTarget, scripted, pipeline (overrides of PIPELINE_DEFAULTS), log }
 */
export async function runPipeline(o) {
  const P = { ...PIPELINE_DEFAULTS, ...(o.pipeline ?? {}) };
  const log = o.log ?? (() => {});
  const t0 = Date.now();
  const B = o.budgetUsd, maxSteps = o.maxSteps, maxWorldSteps = maxSteps - 1;
  const models = o.models;
  const mailbox = path.join(o.workdir, '.tools');
  const pdir = path.join(o.hostDir, 'pipeline');
  mkdirSync(pdir, { recursive: true });
  const hostWrite = (name, obj) => writeFileSync(path.join(pdir, name), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1));
  const nodes = [];
  let responses = 0, spent = 0, upper = 0, unknown = false;
  const toolUses = [];
  const client = bridgeClient({ mailbox, responsesSoFar: () => responses });
  const msLeft = () => o.timeoutMs - (Date.now() - t0);
  const usdLeft = () => B - upper;
  const settle = (r, budget) => {
    const known = typeof r?.costUsd === 'number' && Number.isFinite(r.costUsd);
    if (known) { spent += r.costUsd; upper += r.costUsd; } else { unknown = true; upper += r?.costUpperUsd ?? budget; }
    return known ? r.costUsd : null;
  };
  const guardOne = writeCliGuard(path.join(o.guardDir, 'node'), { maxTurns: 1, target: o.cliTarget ?? 'claude' });
  const nodeDir = name => { const d = path.join(o.nodeRoot, `${String(nodes.length).padStart(2, '0')}-${name}`); rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); return d; };
  const transcriptPath = name => path.join(pdir, 'nodes', `${String(nodes.length).padStart(2, '0')}-${name}.jsonl`);

  async function modelNode(name, role, system, prompt) {
    const model = models[role];
    const budget = Math.max(0.005, Math.min(P.nodeBudgetShare * B, usdLeft()));
    const dir = nodeDir(name), tfile = transcriptPath(name);
    const started = Date.now() / 1000;
    let r;
    try {
      r = await o.nodeRunner({ model, prompt, systemPrompt: system, workdir: dir, files: {}, budgetUsd: budget, timeoutMs: Math.max(30_000, Math.min(P.nodeTimeoutMs, msLeft() - 60_000)), effort: o.effort ?? null,
        tools: [], task: { name: role, fork: 0 }, maxTurns: 1, binary: guardOne.binary, keepRo: [...DEFAULT_KEEP_RO, guardOne.dir] });
    } catch (e) { r = { ok: false, error: { code: 'NODE_ERROR', message: String(e?.message ?? e).slice(0, 300) }, costUsd: null, costUnknown: true, costUpperUsd: budget }; }
    const ended = Date.now() / 1000;
    const copied = copyTranscript(path.join(dir, '.executor-transcript.jsonl'), tfile);
    const events = copied ? readStream(tfile) : [];
    const audit = auditSession({ events, calls: [], maxSteps, expectModel: o.scripted ? null : model });
    const resp = events.length ? audit.modelResponses : (r?.turns ?? 1);
    responses += resp;
    const cost = settle(r, budget);
    const text = typeof r?.result === 'string' ? r.result : lastText(events);
    const json = parseJsonReply(text);
    nodes.push({ idx: nodes.length, name, kind: 'model', role, model, responses: resp, costUsd: cost, costUpperUsd: r?.costUpperUsd ?? budget, started, ended, transcript: copied ? path.relative(o.hostDir, tfile) : null,
      parsed: Boolean(json), error: r?.error?.code ?? null });
    hostWrite(`${String(nodes.length - 1).padStart(2, '0')}-${name}.reply.txt`, String(text ?? ''));
    return json;
  }

  async function sessionNode(name, role, brief, cap, budget) {
    const model = models[role];
    const guard = writeCliGuard(path.join(o.guardDir, name), { maxTurns: cap, target: o.cliTarget ?? 'claude' });
    const systemPrompt = actSystemPrompt(o.official.system, o.catalog, maxSteps, { dateNote: o.dateNote, brief });
    const tfile = transcriptPath(name), live = path.join(o.workdir, '.executor-transcript.jsonl');
    rmSync(live, { force: true });
    const started = Date.now() / 1000;
    let r;
    try {
      r = await o.runner({ model, prompt: o.official.user, systemPrompt, workdir: o.workdir, files: {}, budgetUsd: budget, timeoutMs: Math.max(60_000, msLeft() - 3 * 60_000), effort: o.effort ?? null,
        tools: o.tools ?? ['Bash'], task: { name: role, fork: 0 }, maxTurns: cap, binary: guard.binary, keepRo: [...DEFAULT_KEEP_RO, guard.dir] });
    } catch (e) { r = { ok: false, error: { code: 'SESSION_ERROR', message: String(e?.message ?? e).slice(0, 300) }, costUsd: null, costUnknown: true, costUpperUsd: budget }; }
    const ended = Date.now() / 1000;
    const copied = copyTranscript(live, tfile);
    rmSync(live, { force: true });
    const events = copied ? readStream(tfile) : [];
    const audit = auditSession({ events, calls: [], maxSteps, expectModel: o.scripted ? null : model });
    const resp = events.length ? audit.modelResponses : (r?.turns ?? 0);
    responses += resp;
    const cost = settle(r, budget);
    toolUses.push(...(r?.toolUses ?? []));
    hostWrite(`${String(nodes.length).padStart(2, '0')}-${name}.system.txt`, systemPrompt);
    nodes.push({ idx: nodes.length, name, kind: 'session', role, model, cap, responses: resp, costUsd: cost, costUpperUsd: r?.costUpperUsd ?? budget, started, ended, transcript: copied ? path.relative(o.hostDir, tfile) : null,
      stopReason: audit.stopReason, error: r?.error?.code ?? null });
    return r;
  }

  const codeNode = async (name, fn) => {
    const started = Date.now() / 1000, before = client.log.length;
    const out = await fn();
    nodes.push({ idx: nodes.length, name, kind: 'code', responses: 0, steps: client.log.slice(before).filter(e => !e.refused).length, started, ended: Date.now() / 1000 });
    return out;
  };

  const stats = { inventory: null, ledger: null, checks: [], rounds: 0, termination: null };
  let actError = null;
  try {
    // 1. INVENTORY
    const inv = await codeNode('inventory', () => buildInventory({ request: o.official.user, client, maxSteps: P.inventorySteps, node: 'inventory' }));
    const fullText = renderInventory(inv, { maxChars: 4_000_000 });
    writeFileSync(path.join(o.workdir, BRIEF_FILES.inventory), fullText);
    hostWrite('inventory.json', inv);
    stats.inventory = { steps: inv.steps, calls: inv.calls, connected: inv.connected.length, outOfScope: inv.outOfScope.length, records: inv.records.length, truncated: inv.truncated.length, entities: inv.entities.length, titleProbes: inv.titleProbes.length, precedents: inv.precedents.length, chars: fullText.length, errors: inv.errors.length };
    log(`[codeowned] inventory: ${inv.records.length} records in ${inv.steps} steps; connected ${inv.connected.join(',')}`);

    // 2. LEDGERS (K clean contexts; independent readers see the inventory in a different app order)
    const sources = sourceMap(o.official.user, inv);
    const dateNote = o.dateNote ? DATE_NOTE : null;
    const ledgers = [];
    for (let k = 0; k < P.K; k++) {
      const text = renderInventory(inv, { maxChars: P.ledgerInventoryChars, order: k === 0 ? null : k });
      const json = await modelNode(`ledger-${k + 1}`, 'ledger', LEDGER_SYSTEM, ledgerPrompt({ request: o.official.user, inventoryText: text, precedents: inv.precedents, dateNote }));
      ledgers.push(normalizeLedger(json, sources, { reader: k + 1 }));
    }
    const merged = mergeLedgers(ledgers, { sources });
    const { settled, open } = settleByCode(merged.conflicts, sources);
    const decisions = settled.map(s => ({ conflict: s.conflict, choice: s.choice, by: 'code', rule: s.rule }));
    if (open.length && responses + 1 <= maxSteps - P.actReserveResponses) {
      const reply = await modelNode('adjudicate', 'adjudicate', ADJUDICATE_SYSTEM, adjudicatePrompt({ request: o.official.user, conflicts: open, sourceSpans: conflictSpans(open, sources), dateNote }));
      decisions.push(...readDecisions(reply, open));
    } else for (const c of open) decisions.push({ conflict: c, choice: null, by: 'unsettled (no budget)' });
    applyDecisions(merged, decisions);
    hostWrite('ledgers.json', { ledgers, merged });

    // 3. POSTCONDITIONS (before acting)
    let pcs = postconditionsFromLedger(merged, inv);
    const judgedItems = [...new Set(pcs.filter(p => p.type === 'judged' && p.polarity === 'positive').map(p => p.item))].map(id => merged.items.find(i => i.id === id)).filter(Boolean);
    let mapped = 0;
    if (P.pcmap && judgedItems.length && responses + 1 <= maxSteps - P.actReserveResponses) {
      const reply = await modelNode('pcmap', 'pcmap', PCMAP_SYSTEM, pcmapPrompt({ items: judgedItems, inventoryText: renderInventory(inv, { maxChars: 40_000 }), dateNote }));
      for (const c of Array.isArray(reply?.checks) ? reply.checks : []) {
        const item = judgedItems.find(i => i.id === String(c?.requirement));
        const params = item ? validateMapped(c, sources, inv) : null;
        if (!params) continue;
        const idx = pcs.findIndex(p => p.item === item.id && p.type === 'judged');
        if (idx < 0) continue;
        pcs[idx] = { ...pcs[idx], type: c.type, params, hard: pcs[idx].hard || item.support >= Math.ceil(merged.readers / 2), why: 'mapped by the mapping call; values found in sources' };
        mapped += 1;
      }
    }
    pcs = pcs.map((p, i) => ({ ...p, id: `P${i + 1}` }));
    const atStart = pcs.map(p => ({ id: p.id, ...evaluate(p, inv, inv) }));
    writeFileSync(path.join(o.workdir, BRIEF_FILES.ledger), JSON.stringify({ today: merged.today, requirements: merged.items.filter(i => !i.superseded), notRules: merged.dropped }, null, 1));
    writeFileSync(path.join(o.workdir, BRIEF_FILES.checks), JSON.stringify(pcs.map(p => ({ id: p.id, requirement: p.item, type: p.type, hard: p.hard, params: p.params, statement: p.statement })), null, 1));
    hostWrite('postconditions.json', { pcs, atStart });
    const items = merged.items.filter(i => !i.superseded);
    stats.ledger = { readersOk: merged.readersOk, readers: merged.readers, items: items.length, positive: items.filter(i => i.polarity === 'positive').length, negative: items.filter(i => i.polarity === 'negative').length,
      majority: items.filter(i => i.support >= Math.ceil(merged.readers / 2)).length, conflicts: merged.conflicts.length, settledByCode: settled.length, adjudicated: open.length, droppedNegatives: merged.dropped.length,
      literals: items.reduce((s, i) => s + i.fields.length, 0), unverifiedLiterals: items.reduce((s, i) => s + i.fields.filter(f => !f.verified).length, 0), today: merged.today ? 'set' : 'unset',
      checks: pcs.length, hardChecks: pcs.filter(p => p.hard).length, judgedChecks: pcs.filter(p => p.type === 'judged').length, mappedChecks: mapped, trueAtStart: atStart.filter(a => a.pass === true).length };

    // 4. ACT
    const inlineText = renderInventory(inv, { maxChars: P.inlineInventoryChars });
    const inline = !inlineText.includes('left out of this listing');
    const actCap = Math.max(3, Math.min(maxSteps - 1, maxSteps - responses - P.actReserveResponses));
    const brief = briefSection({ inv, merged, pcs, stepsLeft: maxWorldSteps - servedSteps(mailbox) - P.checkSteps, responseCap: actCap, inventoryText: inlineText, inline });
    const actBudget = Math.max(0.02, usdLeft() - P.reserveShare * B);
    const act = await sessionNode('act', 'act', brief, actCap, actBudget);
    actError = act?.error?.code ?? null;

    // 5-6. CHECK, then code-owned TERMINATION with repair rounds
    const judge = async its => (responses + 1 <= maxSteps ? modelNode(`checker-${stats.rounds}`, 'checker', CHECKER_SYSTEM, checkerPrompt({ items: its, dateNote })) : null);
    for (;;) {
      const chk = await codeNode(`check-${stats.rounds}`, () => runChecks({ client, inv, pcs, maxSteps: P.checkSteps, judge, sources, node: `check-${stats.rounds}` }));
      const row = { round: stats.rounds, checks: chk.results.length, pass: chk.results.filter(r => r.pass === true).length, fail: chk.results.filter(r => r.pass === false).length, undecided: chk.results.filter(r => r.pass === null).length,
        hardFail: chk.results.filter(r => r.pc.hard && r.pass === false).length, judged: chk.judged, steps: chk.steps };
      stats.checks.push(row);
      hostWrite(`check-${stats.rounds}.json`, chk.results.map(r => ({ id: r.pc.id, hard: r.pc.hard, type: r.pc.type, pass: r.pass, by: r.by, evidence: r.evidence })));
      const decision = terminationDecision({ results: chk.results, responsesUsed: responses, maxResponses: maxSteps, stepsUsed: servedSteps(mailbox), maxWorldSteps, round: stats.rounds, maxRounds: P.maxRounds, usdLeft: usdLeft(), msLeft: msLeft(), minRepairResponses: P.minRepairResponses, checkSteps: P.checkSteps });
      log(`[codeowned] check round ${stats.rounds}: ${row.pass}/${row.checks} pass, ${row.hardFail} hard fail -> ${decision.repair ? 'repair' : `stop (${decision.reason})`}`);
      if (!decision.repair) { stats.termination = { reason: decision.reason, failingHard: row.hardFail }; break; }
      stats.rounds += 1;
      const failing = chk.results.filter(r => r.pc.hard && r.pass === false).map(r => ({ pc: r.pc, evidence: r.evidence, sourceText: r.pc.source && r.pc.source !== 'request' ? String(sources.get(r.pc.source)?.text ?? '').replace(/\s+/g, ' ').slice(0, 800) : '' }));
      const passing = chk.results.filter(r => r.pass === true);
      const cap = Math.max(2, maxSteps - responses - 1);
      const rb = repairSection({ failing, passing, stepsLeft: maxWorldSteps - servedSteps(mailbox) - P.checkSteps, responseCap: cap, round: stats.rounds });
      writeFileSync(path.join(o.workdir, BRIEF_FILES.repair), `${renderChecks(failing.map(f => f.pc))}\n\n${failing.map(f => `${f.pc.id}: ${f.evidence}`).join('\n')}\n`);
      await sessionNode(`repair-${stats.rounds}`, 'repair', rb, cap, Math.max(0.01, usdLeft() - P.nodeBudgetShare * B));
    }
  } catch (e) {
    actError = actError ?? 'PIPELINE_ERROR';
    stats.error = String(e?.stack ?? e).slice(0, 1500);
    log(`[codeowned] pipeline error: ${String(e?.message ?? e).slice(0, 300)}`);
  }
  hostWrite('client-log.json', client.log);
  hostWrite('nodes.json', nodes);
  return { ok: !actError, error: actError ? { code: actError } : null, costUsd: unknown ? null : spent, costUnknown: unknown, costUpperUsd: upper, turns: responses, durationMs: Date.now() - t0, toolUses,
    nodes, clientLog: client.log, pipeline: { ...stats, responses, nodes: nodes.map(n => ({ name: n.name, kind: n.kind, model: n.model ?? null, responses: n.responses, steps: n.steps ?? null, cap: n.cap ?? null, costUsd: n.costUsd ?? null, error: n.error ?? null, parsed: n.parsed ?? null })) }, label: `pipeline:${HARNESS_ID}` };
}

// ---------------------------------------------------------------------------------------------------------------
// The per-task audit over the whole pipeline (H3 on the SUM of model responses; L5 on every transcript)

/**
 * auditPipeline({ nodes, clientLog, calls, maxSteps, hostDir, scripted }) -> the same shape auditSession returns (so run.mjs
 * and accountingSummary treat it alike), with per-node rows. Model responses are counted per node exactly as
 * accounting.mjs counts a session (distinct assistant message ids + compactions) and summed over every node, in order.
 * H3: the sum over 50, or a world step issued when the pipeline had already used >= 50 responses (a session's step is
 * placed at the offset of the responses before it plus its own issuing response). L5: every node's transcript, with the
 * model that node was configured to use.
 */
export function auditPipeline({ nodes = [], clientLog = [], calls = [], maxSteps = 50, hostDir, scripted = false }) {
  const rows = [], violations = [];
  let before = 0, maxWorld = 0, unmapped = 0;
  const agg = { toolResponses: 0, textOnlyResponses: 0, compactions: 0, l5Flags: 0, numTurns: 0, sessionToolUses: 0, parallelToolResponses: 0, subagentResponses: 0, worldCommandResponses: 0, resultEvents: 0 };
  const models = new Set();
  let stopReason = null, resultSubtype = null;
  const used = new Set();
  for (const n of nodes) {
    if (n.kind === 'code') {
      const mine = clientLog.filter(e => e.node === n.name || e.node.startsWith(`${n.name}`));
      const late = mine.filter(e => !e.refused && e.responsesAtIssue >= maxSteps).length;
      if (late) violations.push(`${late} code-issued world step(s) after ${maxSteps} model responses (${n.name})`);
      calls.forEach((c, i) => { if (typeof c.t === 'number' && c.t >= n.started - 1 && c.t <= n.ended + 1) used.add(i); });
      rows.push({ name: n.name, kind: 'code', responses: 0, steps: mine.filter(e => !e.refused).length });
      continue;
    }
    const events = n.transcript ? readStream(path.join(hostDir, n.transcript)) : [];
    const windowCalls = n.kind === 'session' ? calls.filter((c, i) => { const hit = typeof c.t === 'number' && c.t >= n.started - 1 && c.t <= n.ended + 1; if (hit) used.add(i); return hit; }) : [];
    const a = auditSession({ events, calls: windowCalls, maxSteps: Infinity, fallbackTurns: n.responses ?? null, expectModel: scripted ? null : n.model });
    if (!scripted && !events.length) violations.push(`L5: no host transcript for ${n.name} (step and model accounting unavailable)`);
    for (const v of a.violations) if (v.startsWith('L5')) violations.push(`${v} (${n.name})`);
    const resp = a.modelResponses;
    if (a.maxWorldResponse) { const g = before + a.maxWorldResponse; maxWorld = Math.max(maxWorld, g); if (g >= maxSteps) violations.push(`world step(s) issued by pipeline response ${g} >= ${maxSteps} (${n.name})`); }
    unmapped += a.unmappedWorldSteps ?? 0;
    for (const k of Object.keys(agg)) agg[k] += typeof a[k] === 'number' ? a[k] : 0;
    a.models.forEach(m => models.add(m));
    if (n.kind === 'session') { stopReason = stopReason ?? a.stopReason; resultSubtype = a.resultSubtype ?? resultSubtype; }
    rows.push({ name: n.name, kind: n.kind, model: n.model, responses: resp, offset: before, steps: windowCalls.length, mapping: a.mapping, stopReason: a.stopReason });
    before += resp;
  }
  const strays = calls.filter((_, i) => !used.has(i)).length;
  if (before > maxSteps) violations.unshift(`model responses ${before} > ${maxSteps} (sum over ${rows.filter(r => r.kind !== 'code').length} model call(s))`);
  return { modelResponses: before, ...agg, models: [...models].sort(), resultSubtype, stopReason, mapping: 'pipeline', maxWorldResponse: maxWorld || null, unmappedWorldSteps: unmapped + strays,
    extraModelCalls: rows.filter(r => r.kind === 'model').length + Math.max(0, rows.filter(r => r.kind === 'session').length - 1), worldSteps: calls.length,
    codeSteps: rows.filter(r => r.kind === 'code').reduce((s, r) => s + r.steps, 0), sessionSteps: rows.filter(r => r.kind === 'session').reduce((s, r) => s + r.steps, 0), nodes: rows, violations };
}
