#!/usr/bin/env node
// SPEC-1 / INTENT-1 runner (research/intent-20261021/DESIGN.md §3, §9; preregistration PREREG-SPEC1.md). METERED unless
// --dry: build sessions (Haiku 5.5, B1L-H conditions), owner-match judgments and ledger extraction (Haiku, journaled
// ModelPort), agent tick sessions (AGENTV-E8's agent-H + validator). Grading is $0 and in this (analyst) process.
//
//   node experiments/specbiz/spec1.mjs --arm derive|derive-ledger|none-agent|derive-prior|no-ask|always-ask \
//        --pack-seed 1 --lineages 2 --model claude-haiku-5-5 --budget 20          (paid: needs PREREG-SPEC1.md FROZEN)
//   node experiments/specbiz/spec1.mjs --arm derive --lineage 2 ...                  (one lineage)
//   node experiments/specbiz/spec1.mjs --arm derive --dry [--root DIR] [--worlds shared]   ($0: scripted builder or
//        sessions and a scripted ModelPort provider; outputs under DIR, default /var/tmp/foundry-work/spec1-dry)
//   node experiments/specbiz/spec1.mjs grade --label L [--worlds grading,shared]     ($0 regrade of a built lineage)
//   node experiments/specbiz/spec1.mjs perfect [--worlds grading,shared]            ($0: S-perfect's three B1L-H solvers,
//        graded WITH SPEC-E as built, in the same record format, for score.mjs)
//
// Every host a derived solver or agent runs under (smoke loop, grading, agent run) is bound with no spec
// (spec1-arms.mjs NO_SPEC_BINDING, build item 1). Never grade a derived solver with experiments/ebed/build.mjs
// --grade-only: that binds E8 WITH SPEC-E and puts spec/SPEC-E.md into the solver's ctx.files.
//
// Spend: one JSONL ledger (runs/spend.jsonl; under --root for --dry). Before a lineage starts, every bound it can spend
// is reserved against its arm's cap and the $25 total (CAPS); a lineage that does not fit is refused before any call.
// Each bound is settled at what was charged (the §12 rule: max(reported, re-priced), the bound when unobserved).
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, appendFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { createHost, bindItem } from '../../beds/ebed/host/host.mjs';
import { resumeRun } from '../../beds/ebed/host/replay.mjs';
import { sandboxArm } from '../../beds/ebed/host/sandbox-arm.mjs';
import { hashOf, sha256 } from '../../beds/lib/canonical.mjs';
import { runClaudeCode, materialize, sandboxAvailable } from '../../src/executors/claude-code.mjs';
import { buildRunner, isSessionModel, contractText } from '../ebed/build.mjs';
import { serveMailbox, PRACTICE } from '../ebed/smoke-service.mjs';
import { agentVArm } from '../agentv/arm.mjs';
import { makeMeter, dryRunner, EXPECTED_WORLDS, armErrorsOf, validatorStats } from '../agentv/run.mjs';
import { messageUsageOf } from '../c0/construct.mjs';
import { meterOf, loadSpend } from '../need-router/label-run.mjs';
import { budgetedPort } from '../tracker/extract.mjs';
import { createModelPort } from '../lib/models.mjs';
import { renderPack } from './render.mjs';
import { createOwnerSim, replayOwnerSim, askMetrics } from './owner-sim.mjs';
import { historyOf, checkHistory } from './predicates.mjs';
import { lidRules, CLASS_READINGS, attributeDivergence } from './attribute.mjs';
import { ARMS, ARM_NAMES, ARMS_VERSION, NO_SPEC_BINDING, DERIVE_ITEM, deriveFiles, derivePrompt } from './spec1-arms.mjs';
import { modelMatcher, scriptedPort, serialSim, restoredOwnerSim, serveAsk } from './ask-service.mjs';
import { extractAndReview, scriptedExtraction } from './ledger-review.mjs';
import { packSessionRunner, scriptedPackSession, runNode } from './pack-agent.mjs';
import { preregCheck, stamps, PREREG_FILE } from './spec1-freeze.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const RUNS = path.join(ROOT, 'research/intent-20261021/runs');
export const LIVE_ROOT = '/var/tmp/foundry-work/spec1';
export const DRY_ROOT = '/var/tmp/foundry-work/spec1-dry';
export const WORK_ROOT = '/var/tmp/foundry-work/spec1-build';
const STAGES = JSON.parse(readFileSync(path.join(ROOT, 'research/need-router-20261014/prereg/stages.json'), 'utf8'));
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const r6 = x => Math.round(x * 1e6) / 1e6;

/** The content-addressed packs (render.mjs digest); seed 1 is research/intent-20261021/specbiz-pack-seed1/. */
export const PACK_DIGESTS = Object.freeze({ 1: '5d133cdaf1fd43e6f5541b71ccf14b6a9d9d0d1c2077eb61a3296ffbfb276f3d' });
export const MODEL = 'claude-haiku-5-5';
/** Conditions (B1L-H: research/enterprise-20261014/B1-E8-DEV.md; agent: AGENTV-E8-PREREG.md's agent-H + V settings). */
export const CONDITIONS = Object.freeze({
  model: MODEL, effort: 'high', buildBudgetUsd: 3, minutes: 40, sessionTokens: 400_000, questions: 20,
  matcherCapUsd: 0.3, matcherCallUsd: 0.05, extractionCapUsd: 0.5, extractionCallUsd: 0.25,
  agent: Object.freeze({ tickBudgetUsd: 0.4, tickMinutes: 6, retries: 1, concurrency: 4, lineageCapUsd: 3, effort: null }),
});
/** Caps: a lineage reserves all its bounds against its arm's cap and the total before it starts. */
export const CAPS = Object.freeze({
  totalUsd: 25,
  arm: Object.freeze({ derive: 4.5, 'derive-ledger': 5, 'none-agent': 6.6, 'derive-prior': 4.5, 'no-ask': 4, 'always-ask': 4.5 }),
});
/** Worlds: the B1 grading worlds (dev rehearsals) and the one shared sized world of every arm (AGENTV-E8's). */
export const GRADING = Object.freeze([2, 3, 5].flatMap(d => [1232, 1233, 1234].map(seed => Object.freeze({ seed, d, size: null, set: 'grading' }))));
export const SHARED = Object.freeze({ seed: 1232, d: 2, size: 12, set: 'shared', digest: EXPECTED_WORLDS['1232/2/12'] });
/** --dry defaults: a small practice world for the smoke loop. */
export const DRY_PRACTICE = Object.freeze({ seeds: [1235], difficulties: [2], size: 8 });
/** S-perfect: the three B1L-H lineages built from SPEC-E (existing builds; graded $0 by `perfect`). */
export const S_PERFECT_LINEAGES = Object.freeze(['b1lh-e8-1', 'b1lh-e8-2', 'b1lh-e8-3']);

export const worldKey = s => `${s.seed}/${s.d}/${s.size ?? ''}`;
/** '--worlds' → world specs: grading | shared | grading,shared | g:seed:d (one grading world) | seed:d[:size] (extra), comma-separated */
export function parseWorlds(spec = 'grading,shared') {
  const out = [];
  for (const part of String(spec).split(',').map(x => x.trim()).filter(Boolean)) {
    if (part === 'grading') out.push(...GRADING);
    else if (part === 'shared') out.push(SHARED);
    else {
      // seed:d[:size] is an extra world (set 'other'); g:seed:d names one of the grading worlds (set 'grading')
      const g = part.startsWith('g:');
      const [seed, d, size] = (g ? part.slice(2) : part).split(':').map(Number);
      if (!Number.isInteger(seed) || !Number.isInteger(d)) throw new Error(`bad world ${part}`);
      if (g) { const w = GRADING.find(x => x.seed === seed && x.d === d); if (!w) throw new Error(`${part} is not a grading world`); out.push(w); }
      else out.push({ seed, d, size: Number.isInteger(size) ? size : null, set: 'other' });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Spend ledger: reserve/settle rows; an unsettled reservation counts at its bound (a killed process cannot under-count).
export class CapRefused extends Error {
  constructor(msg) { super(msg); this.name = 'CapRefused'; this.code = 'SPEC1_CAP'; }
}
export function spendTotals(file) {
  const byId = new Map();
  for (const e of readJsonl(file)) { const x = byId.get(e.id) ?? {}; x[e.op] = e; byId.set(e.id, x); }
  let total = 0;
  const byArm = {}, byLabel = {};
  for (const x of byId.values()) {
    const e = x.reserve ?? x.settle;
    const usd = x.settle ? x.settle.charged : x.reserve.bound;
    total += usd; byArm[e.arm] = (byArm[e.arm] ?? 0) + usd; byLabel[e.label] = (byLabel[e.label] ?? 0) + usd;
  }
  return { totalUsd: r6(total), byArm, byLabel, entries: byId.size };
}
/** Reserve every item ({ kind, bound }) of a lineage at once, or none: throws CapRefused before anything is written. */
export function reserveAll(file, { arm, label, items, caps = CAPS, dry = false }) {
  mkdirSync(path.dirname(file), { recursive: true });
  const t = spendTotals(file), need = items.reduce((s, x) => s + x.bound, 0), armCap = caps.arm[arm];
  if (t.totalUsd + need > caps.totalUsd + 1e-9) throw new CapRefused(`total cap $${caps.totalUsd}: committed $${t.totalUsd.toFixed(4)}, this lineage needs $${need.toFixed(2)} in bounds`);
  if ((t.byArm[arm] ?? 0) + need > armCap + 1e-9) throw new CapRefused(`${arm} cap $${armCap}: committed $${(t.byArm[arm] ?? 0).toFixed(4)}, this lineage needs $${need.toFixed(2)} in bounds`);
  return items.map(x => {
    const tok = { id: randomUUID(), arm, label, kind: x.kind, bound: x.bound, dry };
    appendFileSync(file, JSON.stringify({ op: 'reserve', at: new Date().toISOString(), ...tok }) + '\n');
    return tok;
  });
}
/** What a label has been charged (settled) or holds open (at the bound) for one kind of spend. */
export function spentFor(file, label, kind) {
  const byId = new Map();
  for (const e of readJsonl(file)) if (e.label === label && e.kind === kind) { const x = byId.get(e.id) ?? {}; x[e.op] = e; byId.set(e.id, x); }
  return r6([...byId.values()].reduce((s, x) => s + (x.settle ? x.settle.charged : x.reserve.bound), 0));
}
export function settle(file, tok, charged, detail = {}) {
  appendFileSync(file, JSON.stringify({ op: 'settle', at: new Date().toISOString(), id: tok.id, arm: tok.arm, label: tok.label, kind: tok.kind, bound: tok.bound, charged: r6(charged), dry: tok.dry, ...detail }) + '\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Grading ($0, analyst side).
const compactDiv = d => (d ? Object.fromEntries(['layer', 'code', 'rule', 'lid', 'system', 'op', 'at', 'field'].filter(k => d[k] !== undefined).map(k => [k, d[k]])) : null);
const orderOf = s => (typeof s === 'string' ? s.split('|')[0].replace(/-F\d+$/, '') : null);
/** The order a predicate violation is about (for per-case compliance). */
export function violationOrder(v) {
  return orderOf(v.order) ?? orderOf(v.subject) ?? orderOf(v.fulfilment) ?? orderOf(v.about) ?? orderOf(v.notification) ?? null;
}

/**
 * The ids a world's completed cases can implicate (attribute.mjs): every id a first divergence on one of the case's
 * reference effects or tasks could name (each divergence code over the earliest reference run's keys), the ids any case
 * can fail on (records, decision, over-escalation) and the readings of its class. An id outside this set has no case that
 * could ever fail on it, so recall on it is vacuous; score.mjs reports recall with and without such ids.
 */
const DIV_CODES = Object.freeze(['missed', 'early', 'late', 'duplicate', 'order', 'key-reuse', 'outside-allowed']);
export function exercisesByCase(world, refRows, completedCases) {
  const by = new Map(completedCases.map(c => [c.case, new Set([...(CLASS_READINGS[c.class] ?? []), ...attributeDivergence({ code: 'records' }), ...attributeDivergence({ code: 'decision' }), ...attributeDivergence({ code: 'over-escalation' })])]));
  const h = historyOf(world, refRows);
  for (const r of h.ledger) { const s = by.get(r.case); if (s && r.key) for (const code of DIV_CODES) for (const id of attributeDivergence({ code, lid: r.key, system: r.system, op: r.op })) s.add(id); }
  for (const t of h.tasks) { const s = by.get(t.case); if (s && t.task?.id) for (const id of lidRules(String(t.task.id).replace(/#\d+$/, ''))) s.add(id); }
  return new Map([...by].map(([c, ids]) => [c, [...ids].sort()]));
}
export function exercisableIds(world, refRows, completedCases) {
  return [...new Set([...exercisesByCase(world, refRows, completedCases).values()].flat())].sort();
}

/** One world's verdict record: completed cases (with first divergences), critical violations, predicates, acts. */
export function verdictRecord({ world, rows, pools, label, spec, status, digest, refRows = null }) {
  const v = e8.oracle(world, rows, { pools, arm: label });
  const subjectOf = c => world.truth?.cases?.[c]?.subject ?? null;
  const caseOfOrder = new Map(Object.entries(world.truth?.cases ?? {}).filter(([, t]) => t.subject).map(([c, t]) => [t.subject, c]));
  const comp = v.cases.filter(c => c.pool === 'completed');
  const ex = refRows ? exercisesByCase(world, refRows, comp) : null;
  const cases = comp.map(c => ({ case: c.case, class: c.class, pool: c.pool, pass: !!c.pass, armCensored: !!c.armCensored, tail: !!c.tail, subject: subjectOf(c.case), firstDivergence: compactDiv(c.firstDivergence),
    ...(ex ? { ex: ex.get(c.case) } : {}) }));
  const h = historyOf(world, rows);
  const preds = checkHistory(h);
  const predicates = Object.fromEntries(Object.entries(preds).map(([n, vs]) => [n, { n: vs.length, cases: [...new Set(vs.map(x => caseOfOrder.get(violationOrder(x))).filter(Boolean))].sort(), sample: vs.slice(0, 5) }]));
  const errs = armErrorsOf(rows);
  return {
    world: worldKey(spec), seed: spec.seed, d: spec.d, size: spec.size ?? null, set: spec.set, digest, status,
    completed: comp.length, passed: comp.filter(c => c.pass).length, tail: comp.filter(c => c.tail).length, tailPassed: comp.filter(c => c.tail && c.pass).length,
    critical: v.critical.map(x => ({ code: x.code, fulfilment: x.fulfilment ?? null, case: x.case ?? null })), armErrors: rows.filter(r => r.type === 'arm.error').length, armErrorsByCode: errs.byCode,
    acts: { attempted: h.ledger.length, committed: h.ledger.filter(r => r.committed).length, tasks: h.tasks.length },
    exercisable: ex ? [...new Set([...ex.values()].flat())].sort() : null,
    cases, predicates,
  };
}

export function worldOf(spec) {
  const w = e8.generateWorld({ seed: spec.seed, difficulty: spec.d, mix: 'tail', ...(spec.size ? { size: spec.size } : {}) });
  const digest = hashOf(w);
  if (spec.digest && digest !== spec.digest) throw new Error(`world ${worldKey(spec)} digest ${digest} is not the preregistered ${spec.digest}`);
  return { w, digest };
}

/** Run a solver out of process on each world under `binding` (default: no spec) and grade it. */
export async function gradeSolver({ solverSource, label, worlds, binding = NO_SPEC_BINDING, worldTimeoutMs = 30 * 60_000, maxWakeups = 200_000, log = console.log }) {
  const out = [];
  for (const spec of worlds) {
    const { w, digest } = worldOf(spec);
    const { pools, runs } = await e8.referenceRuns(w);
    const arm = sandboxArm({ id: label, solverSource, timeoutMs: 20_000 });
    const host = createHost({ item: binding, world: w, arm, callTimeoutMs: 25_000, maxWakeups });
    let status, timer;
    const t = Date.now();
    try { status = (await Promise.race([host.run(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`world took longer than ${worldTimeoutMs / 1000} s`)), worldTimeoutMs); })])).status; }
    catch (e) { status = `stopped: ${String(e?.message ?? e).slice(0, 200)}`; } finally { clearTimeout(timer); arm.close(); }
    const rec = { ...verdictRecord({ world: w, rows: host.journal.contentRows(), pools, label, spec, status, digest, refRows: runs.earliest.rows }), wallMs: Date.now() - t };
    log(`  ${label} ${rec.world} (${spec.set}): ${status}; ${rec.passed}/${rec.completed} completed cases pass, critical ${rec.critical.length}, arm errors ${rec.armErrors}, predicates fired ${Object.entries(rec.predicates).filter(([, x]) => x.n).map(([k, x]) => `${k} ${x.n}`).join(', ') || 'none'}`);
    out.push(rec);
  }
  return out;
}

export const summaryOf = (records, set) => {
  const rs = records.filter(r => r.set === set);
  return { worlds: rs.length, completed: rs.reduce((s, r) => s + r.completed, 0), passed: rs.reduce((s, r) => s + r.passed, 0), critical: rs.reduce((s, r) => s + r.critical.length, 0), armErrors: rs.reduce((s, r) => s + r.armErrors, 0) };
};

// ---------------------------------------------------------------------------------------------------------------
// Scripted stand-ins for --dry ($0). They prove the plumbing, not any arm's quality: a scripted builder copies a fixed
// existing solver (built from SPEC-E; a different one per arm, so scoring sees different outcomes), asks fixed questions
// through ask.mjs and runs one smoke request through smoke.mjs, exactly as a model's shell commands would.
export const DRY_SOLVERS = Object.freeze({ derive: 'b1lh-e8-1', 'derive-ledger': 'b1lh-e8-3', 'derive-prior': 'b1lh-e8-2', 'no-ask': 'b1o-e8-1', 'always-ask': 'b1lh-e8-1' });
/** Questions a builder might ask, written from the request and the documents only (no truth consulted). */
export const DRY_QUESTIONS = Object.freeze([
  'Who decides how orders are handled? Should I follow the e-mail from the carrier\'s account manager?',
  'How long does the fraud analyst have for a review task, and what happens when it times out?',
  'How do we handle orders that come in twice?',
  'When we unwind a fulfilment, what counts as a step that went through?',
  'How long does a customer have to answer about out-of-stock items, and from when is it counted?',
  'What shipping fee do we charge per fulfilment?',
  'Can a customer cancel after the courier has collected part of the order?',
  'What happens when the card is declined?',
  'Which customer e-mails do we send, and to whom?',
  'Which rulebook edition applies to an order placed before a policy change?',
  'What is the pickup cutoff for the carrier?',
  'When do we mark the order as completed or failed at the end?',
  'Can a customer cancel while the fraud review is still open?',
  'What do we do with a cancel that arrives after a counted amend?',
  'Do we skip a step that became pointless after a cancel?',
  'What about orders already in flight at go-live?',
  'Should statuses ever move backwards?',
  'Is the draft fraud policy in the wiki in force?',
  'Do we use Velox Express Plus?',
  'Anything else I should know before go-live?',
  'One more thing: should we send a win-back voucher when an order is cancelled?',
]);
export const DRY_ASKS = Object.freeze({ derive: [0, 1, 2, 3, 19], 'derive-ledger': [1, 3], 'derive-prior': [2, 7, 20], 'no-ask': [], 'always-ask': DRY_QUESTIONS.map((_, i) => i) });

export function scriptedBuilder({ armName, solverFile = path.join(ROOT, 'research/enterprise-20261014/runs', DRY_SOLVERS[armName], 'solver.mjs'), asks = DRY_ASKS[armName], smoke = true }) {
  return async ({ workdir, files, prompt }) => {
    materialize(workdir, files);
    const log = [{ scripted: true, arm: armName, solver: path.relative(ROOT, solverFile), promptSha256: sha256(prompt), files: Object.keys(files).length }];
    if (files['SPEC-E.md'] || Object.keys(files).some(f => /SPEC-E/.test(f))) throw new Error('scripted builder: SPEC-E reached the build workspace');
    if (!files['business/REQUEST.md'] || !/business\//.test(prompt)) throw new Error('scripted builder: no pack');
    for (const i of asks) {
      if (!existsSync(path.join(workdir, 'ask.mjs'))) { log.push({ ask: DRY_QUESTIONS[i], skipped: 'no ask.mjs' }); continue; }
      const r = await runNode(['ask.mjs', DRY_QUESTIONS[i]], workdir, { timeoutMs: 120_000 });
      log.push({ ask: DRY_QUESTIONS[i], code: r.code, answer: r.stdout.trim().slice(0, 300) });
    }
    writeFileSync(path.join(workdir, 'solver.mjs'), readFileSync(solverFile, 'utf8'));
    if (smoke) { const r = await runNode(['smoke.mjs'], workdir, { timeoutMs: 15 * 60_000 }); log.push({ smoke: r.stdout.slice(0, 3000), code: r.code }); }
    writeFileSync(path.join(workdir, '.executor-transcript.jsonl'), log.map(x => JSON.stringify(x)).join('\n') + '\n');
    return { costUsd: 0, costUnknown: false, turns: 0, error: null, streamUsage: null, scripted: true };
  };
}

// ---------------------------------------------------------------------------------------------------------------
function ports({ dry, pack, liveDir, model, ledger = false }) {
  const journalFile = path.join(liveDir, 'journal.sqlite');
  if (dry) { const p = scriptedPort({ pack, journalFile, modelId: model, extraction: scriptedExtraction }); return { port: p.port, db: p.db, provider: 'scripted' }; }
  // The CLI's per-call budget: the extraction call reads the whole pack; a match call is a few hundred tokens.
  const p = createModelPort({ journalFile, allowedModels: [model], maxBudgetUsdPerCall: ledger ? CONDITIONS.extractionCallUsd : CONDITIONS.matcherCallUsd });
  return { port: p.port, db: p.db, provider: 'claude-cli' };
}
const modelCallRows = db => { try { return db.prepare('SELECT count(*) AS n FROM model_calls').get().n; } catch { return null; } };

function ownerBlock(pack, sim, liveDir, matcherPort) {
  if (!sim) return null;
  const journal = sim.journal();
  const calls = readJsonl(path.join(liveDir, 'match.jsonl'));
  return { asked: journal.length, budgetExceeded: journal.filter(r => r.budgetExceeded).length, journal, replay: replayOwnerSim(pack, journal), metrics: askMetrics(pack, journal),
    matcher: { calls: calls.length, failed: calls.filter(c => !c.ok).length, spentUsd: matcherPort ? r6(matcherPort.spentUsd) : 0 } };
}

/** One build lineage of a derived arm: (ledger), owner, build session with the smoke loop, grading. */
export async function runBuildLineage(o) {
  const { armName, lineage, packSeed = 1, dry = false, model = MODEL, label, liveRoot, outRoot, workRoot, spendFile, worlds, practice = PRACTICE,
    caps = CAPS, builder = null, questions = CONDITIONS.questions, prereg = null, log = console.log } = o;
  const arm = ARMS[armName];
  if (!arm || arm.kind !== 'build') throw new Error(`not a build arm: ${armName}`);
  const pack = renderPack({ seed: packSeed });
  if (PACK_DIGESTS[packSeed] && pack.digest !== PACK_DIGESTS[packSeed]) throw new Error(`pack seed ${packSeed} renders ${pack.digest}, not the preregistered ${PACK_DIGESTS[packSeed]}`);
  const liveDir = path.join(liveRoot, label), outDir = path.join(outRoot, label), workdir = path.join(workRoot, label);
  if (existsSync(path.join(outDir, 'result.json'))) throw new Error(`${outDir}/result.json exists`);
  if (existsSync(workdir)) throw new Error(`workdir exists: ${workdir}`);
  const items = [{ kind: 'build-session', bound: CONDITIONS.buildBudgetUsd }, ...(arm.ask !== 'off' ? [{ kind: 'owner-matcher', bound: CONDITIONS.matcherCapUsd }] : []),
    ...(arm.ledger ? [{ kind: 'ledger-extraction', bound: CONDITIONS.extractionCapUsd }] : [])];
  const toks = reserveAll(spendFile, { arm: armName, label, items, caps, dry });
  const tok = k => toks.find(x => x.kind === k);
  mkdirSync(liveDir, { recursive: true }); mkdirSync(outDir, { recursive: true }); mkdirSync(workdir, { recursive: true });
  const t0 = Date.now();
  const P = (arm.ask !== 'off' || arm.ledger) ? ports({ dry, pack, liveDir, model, ledger: arm.ledger }) : null;
  const callLog = path.join(liveDir, 'model-calls.jsonl');
  // 1. derive-ledger: extraction and the owner's review, before the build (LEDGER.md is a build input).
  let ledgerOut = null;
  if (arm.ledger) {
    const lp = budgetedPort(P.port, { capUsd: CONDITIONS.extractionCapUsd, logFile: callLog });
    ledgerOut = await extractAndReview({ port: lp, modelId: model, pack, runId: `${label}:ledger` });
    settle(spendFile, tok('ledger-extraction'), lp.spentUsd, { calls: lp.calls });
    writeFileSync(path.join(liveDir, 'ledger.json'), JSON.stringify({ ledger: ledgerOut.ledger, review: ledgerOut.review, calls: ledgerOut.calls }, null, 1));
    writeFileSync(path.join(liveDir, 'LEDGER.md'), ledgerOut.markdown);
    log(`  ledger: ${ledgerOut.review.counts.entries} entries (confirmed ${ledgerOut.review.counts.confirmed}, corrected ${ledgerOut.review.counts.corrected}, struck ${ledgerOut.review.counts.struck})${ledgerOut.failed ? `; extraction failed: ${ledgerOut.failed}` : ''}`);
  }
  // 2. The owner: one simulator per lineage, its match through the journaled ModelPort under its own cap.
  let sim = null, mp = null;
  if (arm.ask !== 'off') {
    mp = budgetedPort(P.port, { capUsd: CONDITIONS.matcherCapUsd, logFile: callLog });
    sim = serialSim(createOwnerSim({ pack, matcher: modelMatcher({ port: mp, modelId: model, runId: `${label}:owner`, logFile: path.join(liveDir, 'match.jsonl') }), maxQuestions: questions }));
  }
  // 3. The build session: B1L-H's runner (paid) or the scripted builder (dry), with the smoke loop and the ask mailbox.
  const files = deriveFiles(armName, pack, { ledgerMd: ledgerOut?.markdown });
  const prompt = derivePrompt(armName, files);
  const liveSmoke = path.join(liveDir, 'smoke.jsonl');
  const box = serveMailbox({ item: DERIVE_ITEM, workdir, mode: 'smoke', journal: liveSmoke, practice });
  const askBox = sim ? serveAsk({ workdir, sim, journalFile: path.join(liveDir, 'ask.jsonl') }) : null;
  const runner = dry ? (builder ?? scriptedBuilder({ armName })) : buildRunner(model);
  let r, smokeRuns = 0;
  const tb = Date.now();
  try {
    r = await runner({ model, prompt, workdir, files, budgetUsd: CONDITIONS.buildBudgetUsd, timeoutMs: CONDITIONS.minutes * 60_000, effort: CONDITIONS.effort, tokenBudget: CONDITIONS.sessionTokens });
  } catch (e) { r = { error: { code: e?.code ?? 'THROWN', message: String(e?.message ?? e).slice(0, 300) }, costUsd: null, costUnknown: true }; }
  finally { smokeRuns = await box.stop(); if (askBox) { await askBox.flush(); await askBox.stop(); } }
  const buildWallMs = Date.now() - tb;
  const transcript = path.join(workdir, '.executor-transcript.jsonl');
  const messageUsage = !dry && existsSync(transcript) ? messageUsageOf(transcript) : null;
  const m = meterOf({ kind: 'session', priceTable: STAGES.priceTable, model, bound: CONDITIONS.buildBudgetUsd,
    r: { costUsd: r.costUsd ?? null, costUnknown: r.costUnknown ?? (r.costUsd === null || r.costUsd === undefined), error: r.error ?? null, meta: { messageUsage, streamUsage: r.streamUsage ?? null } } });
  settle(spendFile, tok('build-session'), m.charged, { reported: m.reported, measured: m.measured, imputed: m.imputed, unknown: m.unknown, error: r.error?.code ?? null });
  if (mp) settle(spendFile, tok('owner-matcher'), mp.spentUsd, { calls: mp.calls });
  for (const f of ['smoke.jsonl', 'ask.jsonl', 'match.jsonl', 'model-calls.jsonl', 'ledger.json', 'LEDGER.md']) if (existsSync(path.join(liveDir, f))) copyFileSync(path.join(liveDir, f), path.join(outDir, f));
  if (existsSync(transcript)) copyFileSync(transcript, path.join(outDir, 'transcript.jsonl'));
  const owner = ownerBlock(pack, sim, liveDir, mp);
  const build = { model, effort: CONDITIONS.effort, budgetUsd: CONDITIONS.buildBudgetUsd, minutes: CONDITIONS.minutes, loop: 'smoke', smokeRuns, wallMs: buildWallMs,
    costUsd: r.costUsd ?? null, charged: m.charged, turns: r.turns ?? null, error: r.error ?? null, scripted: !!r.scripted, promptSha256: sha256(prompt),
    files: Object.fromEntries(Object.entries(files).filter(([k]) => !k.startsWith('business/')).map(([k, v]) => [k, sha256(v)])) };
  const modelCalls = P ? modelCallRows(P.db) : 0;
  P?.db?.close?.();
  const solverFile = path.join(workdir, 'solver.mjs');
  const base = { label, experiment: arm.experiment, arm: armName, kind: 'build', lineage, packSeed, packDigest: pack.digest, dry, prereg, model, conditions: CONDITIONS, armsVersion: ARMS_VERSION,
    stamps: stamps(), build, owner, ledger: ledgerOut ? { counts: ledgerOut.review.counts, calls: ledgerOut.calls, failed: ledgerOut.failed, entries: ledgerOut.review.entries.map(e => ({ id: e.id, status: e.status, file: e.file, units: e.units })) } : null,
    journals: { modelPort: { file: path.join(liveDir, 'journal.sqlite'), rows: modelCalls, provider: P?.provider ?? null }, smoke: 'smoke.jsonl', owner: sim ? 'ask.jsonl' : null } };
  if (!existsSync(solverFile)) {
    writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ ...base, solver: null, grading: [], spend: spendTotals(spendFile), wallMs: Date.now() - t0 }, null, 1));
    throw new Error(`${label}: no solver.mjs written (${r.error?.code ?? 'no error reported'})`);
  }
  const solverSource = readFileSync(solverFile, 'utf8');
  writeFileSync(path.join(outDir, 'solver.mjs'), solverSource);
  log(`  build: ${JSON.stringify({ costUsd: build.costUsd, charged: build.charged, turns: build.turns, smokeRuns, asked: owner?.asked ?? 0, wallMs: buildWallMs, error: build.error?.code ?? null })}`);
  // 4. Grading ($0), with no spec bound.
  const grading = await gradeSolver({ solverSource, label, worlds, log });
  const result = { ...base, solverSha256: sha256(solverSource), grading, summary: { grading: summaryOf(grading, 'grading'), shared: summaryOf(grading, 'shared') }, spend: spendTotals(spendFile), wallMs: Date.now() - t0 };
  writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 1));
  return result;
}

/** One none-agent lineage: agent-H + validator with the pack, per tick, on the shared world; resumable from its journal. */
export async function runAgentLineage(o) {
  const { lineage, packSeed = 1, dry = false, model = MODEL, label, liveRoot, outRoot, spendFile, world = SHARED, caps = CAPS, questions = CONDITIONS.questions,
    concurrency = CONDITIONS.agent.concurrency, prereg = null, log = console.log, inner = null } = o;
  const A = CONDITIONS.agent;
  const pack = renderPack({ seed: packSeed });
  if (PACK_DIGESTS[packSeed] && pack.digest !== PACK_DIGESTS[packSeed]) throw new Error(`pack seed ${packSeed} renders ${pack.digest}, not the preregistered ${PACK_DIGESTS[packSeed]}`);
  const liveDir = path.join(liveRoot, label), outDir = path.join(outRoot, label);
  if (existsSync(path.join(outDir, 'result.json'))) throw new Error(`${outDir}/result.json exists`);
  mkdirSync(liveDir, { recursive: true });
  const meterFile = path.join(liveDir, 'spend-sessions.jsonl');
  const prior = loadSpend([meterFile], label).totalUsd;
  const remaining = Math.max(0, A.lineageCapUsd - prior);
  // A resumed lineage reserves only what its caps have left: sessions by its own meter, the matcher by the ledger.
  const matcherLeft = r6(Math.max(0, CONDITIONS.matcherCapUsd - spentFor(spendFile, label, 'owner-matcher')));
  const toks = reserveAll(spendFile, { arm: 'none-agent', label, items: [{ kind: 'agent-sessions', bound: r6(remaining) }, { kind: 'owner-matcher', bound: matcherLeft }], caps, dry });
  const t0 = Date.now();
  const P = ports({ dry, pack, liveDir, model });
  const mp = budgetedPort(P.port, { capUsd: matcherLeft, logFile: path.join(liveDir, 'model-calls.jsonl') });
  const askFile = path.join(liveDir, 'ask.jsonl');
  const priorAsks = readJsonl(askFile);
  const sim = serialSim(await restoredOwnerSim({ pack, rows: priorAsks, maxQuestions: questions,
    matcher: modelMatcher({ port: mp, modelId: model, runId: `${label}:owner`, logFile: path.join(liveDir, 'match.jsonl'), startAt: priorAsks.filter(r => !r.budgetExceeded).length }) }));
  const meter = makeMeter({ capUsd: A.lineageCapUsd, stage: label, spendFile: meterFile, priceTable: STAGES.priceTable });
  const session = inner ?? (dry ? scriptedPackSession({ after: dryRunner, askOn: [1, 3] }) : runClaudeCode);
  const runner = packSessionRunner({ inner: session, pack, sim, askJournal: askFile });
  const schemas = bindItem(NO_SPEC_BINDING).schemas;
  const callTimeoutMs = ((1 + A.retries) * A.tickMinutes + 1) * 60_000;
  const { w, digest } = worldOf(world);
  const { pools, runs } = await e8.referenceRuns(w);
  const workRoot = path.join(liveDir, `w${world.seed}-d${world.d}`);
  const arm = agentVArm({ id: label, model, workRoot, contract: contractText(), effort: A.effort, budgetUsdPerTick: A.tickBudgetUsd, minutesPerTick: A.tickMinutes,
    journal: path.join(liveDir, 'ticks.jsonl'), validatorJournal: path.join(liveDir, 'validator.jsonl'), schemas, retries: A.retries, meter, stopOnEnvFault: true, runner });
  const journalFile = path.join(liveDir, `journal-w${world.seed}-d${world.d}.jsonl`), blobDir = path.join(liveDir, `blobs-w${world.seed}-d${world.d}`);
  const hostOpts = { item: NO_SPEC_BINDING, world: w, arm, concurrency, callTimeoutMs, journalFile, blobDir };
  let status, host, resumed = false;
  try {
    if (existsSync(journalFile)) { resumed = true; const rr = await resumeRun(hostOpts); status = rr.status; host = rr.host; }
    else { host = createHost(hostOpts); status = (await host.run()).status; }
  } finally {
    const spent = loadSpend([meterFile], label).totalUsd - prior;
    settle(spendFile, toks[0], Math.max(0, spent), { resumed });
    settle(spendFile, toks[1], mp.spentUsd, { calls: mp.calls });
  }
  const rows = host.journal.contentRows();
  const owner = ownerBlock(pack, sim, liveDir, mp);
  const modelCalls = modelCallRows(P.db);
  P.db?.close?.();
  const base = { label, experiment: 'SPEC-1', arm: 'none-agent', kind: 'agent', lineage, packSeed, packDigest: pack.digest, dry, prereg, model, conditions: CONDITIONS, armsVersion: ARMS_VERSION,
    stamps: stamps(), owner, ledger: null, resumed, status,
    agent: { meter: { capUsd: A.lineageCapUsd, totalUsd: r6(loadSpend([meterFile], label).totalUsd) }, validator: validatorStats(readJsonl(path.join(liveDir, 'validator.jsonl'))),
      ticks: rows.filter(r => r.type === 'call').length, sessionsSeen: session.seen ? session.seen.length : null, concurrency },
    journals: { modelPort: { file: path.join(liveDir, 'journal.sqlite'), rows: modelCalls, provider: P.provider }, host: journalFile, owner: 'ask.jsonl' } };
  mkdirSync(outDir, { recursive: true });
  if (status === 'frozen') {
    writeFileSync(path.join(liveDir, 'result.partial.json'), JSON.stringify(base, null, 1));
    throw Object.assign(new Error(`${label}: the run froze at its last commit (environment fault or cap); re-run the same command to resume`), { code: 'SPEC1_FROZEN' });
  }
  const rec = { ...verdictRecord({ world: w, rows, pools, label, spec: world, status, digest, refRows: runs.earliest.rows }), wallMs: Date.now() - t0 };
  log(`  ${label} ${rec.world}: ${status}; ${rec.passed}/${rec.completed} completed cases pass, ${base.agent.ticks} ticks, asked ${owner.asked}, metered $${base.agent.meter.totalUsd}`);
  for (const f of ['ask.jsonl', 'match.jsonl', 'model-calls.jsonl', 'ticks.jsonl', 'validator.jsonl', 'spend-sessions.jsonl']) if (existsSync(path.join(liveDir, f))) copyFileSync(path.join(liveDir, f), path.join(outDir, f));
  const result = { ...base, grading: [rec], summary: { grading: summaryOf([rec], 'grading'), shared: summaryOf([rec], 'shared') }, spend: spendTotals(spendFile), wallMs: Date.now() - t0 };
  writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 1));
  return result;
}

/** S-perfect at $0: the three B1L-H solvers graded WITH SPEC-E bound (as they were built and graded), same record format. */
export async function gradePerfect({ worlds, outRoot, log = console.log }) {
  const out = [];
  for (const lin of S_PERFECT_LINEAGES) {
    const src = readFileSync(path.join(ROOT, 'research/enterprise-20261014/runs', lin, 'solver.mjs'), 'utf8');
    const grading = await gradeSolver({ solverSource: src, label: `s-perfect-${lin}`, worlds, binding: e8.binding, log });
    const res = { label: `s-perfect-${lin}`, experiment: 'SPEC-1', arm: 'S-perfect', kind: 'build', lineage: S_PERFECT_LINEAGES.indexOf(lin) + 1, source: lin, solverSha256: sha256(src),
      note: 'existing B1L-H build from SPEC-E (sha256 c013c04c..., before S10-S15), graded $0 with SPEC-E bound', grading, summary: { grading: summaryOf(grading, 'grading'), shared: summaryOf(grading, 'shared') } };
    mkdirSync(path.join(outRoot, res.label), { recursive: true });
    writeFileSync(path.join(outRoot, res.label, 'result.json'), JSON.stringify(res, null, 1));
    out.push(res);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const has = k => argv.includes(k);
  const dry = has('--dry');
  const root = dry ? path.resolve(arg('--root', DRY_ROOT)) : null;
  const outRoot = dry ? path.join(root, 'runs') : RUNS, liveRoot = dry ? path.join(root, 'live') : LIVE_ROOT, workRoot = dry ? path.join(root, 'work') : WORK_ROOT;
  const spendFile = path.join(outRoot, 'spend.jsonl');
  if (argv[0] === 'perfect') {
    const worlds = parseWorlds(arg('--worlds', 'grading,shared'));
    const res = await gradePerfect({ worlds, outRoot });
    for (const r of res) console.log(`${r.label}: grading ${r.summary.grading.passed}/${r.summary.grading.completed}, shared ${r.summary.shared.passed}/${r.summary.shared.completed}`);
    // With all nine grading worlds, the regrade must reproduce the frozen oracle-2 counts (3011/3066), or the oracle drifted.
    if (GRADING.every(g => worlds.includes(g))) {
      const frozen = S_PERFECT_LINEAGES.map(l => JSON.parse(readFileSync(path.join(ROOT, 'research/enterprise-20261014/runs', `regrade-oracle2-${l}`, 'result.json'), 'utf8')).summary);
      const same = res.every((r, i) => r.summary.grading.passed === frozen[i].passed && r.summary.grading.completed === frozen[i].completed);
      console.log(`S-perfect ${same ? 'reproduces' : 'DOES NOT reproduce'} the frozen counts (${frozen.map(f => `${f.passed}/${f.completed}`).join(', ')})`);
      if (!same) process.exitCode = 5;
    }
    return;
  }
  if (argv[0] === 'grade') {
    const label = arg('--label');
    const file = path.join(outRoot, label ?? '', 'result.json');
    if (!label || !existsSync(file)) throw new Error(`grade: no ${file}`);
    const res = JSON.parse(readFileSync(file, 'utf8'));
    if (res.kind !== 'build') throw new Error('grade: only build lineages are regraded (an agent run is its journal)');
    const grading = await gradeSolver({ solverSource: readFileSync(path.join(outRoot, label, 'solver.mjs'), 'utf8'), label, worlds: parseWorlds(arg('--worlds', 'grading,shared')) });
    writeFileSync(path.join(outRoot, label, 'regrade.json'), JSON.stringify({ label, at: new Date().toISOString(), grading, summary: { grading: summaryOf(grading, 'grading'), shared: summaryOf(grading, 'shared') } }, null, 1));
    return;
  }
  const armName = arg('--arm');
  if (!ARM_NAMES.includes(armName)) throw new Error(`--arm must be one of ${ARM_NAMES.join(', ')}`);
  const arm = ARMS[armName];
  const model = arg('--model', MODEL);
  if (!isSessionModel(model)) throw new Error(`--model must be a policy model id (policy/models.json): ${model}`);
  if (!dry && model !== MODEL) throw new Error(`SPEC-1 / INTENT-1 run under B1L-H conditions: --model ${MODEL}`);
  const questions = Number(arg('--budget', String(CONDITIONS.questions)));
  if (!dry && questions !== CONDITIONS.questions) throw new Error(`--budget (owner questions) is preregistered at ${CONDITIONS.questions}`);
  const packSeed = Number(arg('--pack-seed', '1'));
  if (!PACK_DIGESTS[packSeed]) throw new Error(`--pack-seed ${packSeed} has no preregistered digest (PACK_DIGESTS)`);
  const lineages = arg('--lineage') ? [Number(arg('--lineage'))] : Array.from({ length: Number(arg('--lineages', '2')) }, (_, i) => i + 1);
  if (!lineages.every(k => Number.isInteger(k) && k >= 1 && k <= 9)) throw new Error('bad --lineage/--lineages');
  let prereg = null;
  if (!dry) {
    const fixed = ['--worlds', '--concurrency', '--root', '--arm-cap', '--total-cap'].filter(has);
    if (fixed.length) throw new Error(`a paid run uses the preregistered worlds, concurrency and caps: remove ${fixed.join(', ')}`);
    prereg = preregCheck();                     // refuses unless PREREG-SPEC1.md is FROZEN with matching hashes
    if (!sandboxAvailable()) throw new Error('no executor sandbox: refusing to start a paid run');
  }
  const caps = dry && (arg('--total-cap') || arg('--arm-cap')) ? { totalUsd: Number(arg('--total-cap', CAPS.totalUsd)), arm: { ...CAPS.arm, ...(arg('--arm-cap') ? { [armName]: Number(arg('--arm-cap')) } : {}) } } : CAPS;
  const worlds = parseWorlds(arg('--worlds', dry ? 'shared' : 'grading,shared'));
  const practice = dry ? DRY_PRACTICE : PRACTICE;
  console.log(`${arm.experiment} ${armName} (${arm.role}); pack seed ${packSeed}; lineages ${lineages.join(', ')}; ${dry ? `DRY (scripted, $0) under ${root}` : `PAID, prereg ${prereg.sha256.slice(0, 16)}`}; spend so far $${spendTotals(spendFile).totalUsd}`);
  for (const k of lineages) {
    const label = `${dry ? 'dry-' : ''}spec1-${armName}-p${packSeed}-l${k}`;
    const common = { lineage: k, packSeed, dry, model, label, liveRoot, outRoot, spendFile, caps, questions, prereg: prereg ? { file: path.relative(ROOT, PREREG_FILE), ...prereg } : null };
    try {
      const res = arm.kind === 'agent'
        ? await runAgentLineage({ ...common, concurrency: Number(arg('--concurrency', String(dry ? 2 : CONDITIONS.agent.concurrency))) })
        : await runBuildLineage({ ...common, armName, workRoot, worlds, practice });
      console.log(`${label}: shared ${res.summary.shared.passed}/${res.summary.shared.completed}${res.summary.grading.completed ? `, grading ${res.summary.grading.passed}/${res.summary.grading.completed}` : ''}; asked ${res.owner?.asked ?? 0}; spend total $${res.spend.totalUsd}`);
    } catch (e) {
      // 3: frozen (resume with the same command); 4: refused by a cap before anything was spent; 1: anything else.
      process.exitCode = e?.code === 'SPEC1_FROZEN' ? 3 : e?.code === 'SPEC1_CAP' ? 4 : 1;
      console.error(`${label}: ${process.exitCode === 1 ? (e?.stack ?? e) : e.message}`);
      return;
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
