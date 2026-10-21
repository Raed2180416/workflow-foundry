#!/usr/bin/env node
// BUILDER-1 runner (research/surface-20261021/PREREG-BUILDER-1.md). One arm at a time over the frozen cases:
//
//   node experiments/surface/run-builder-eval.mjs --arm B-H  --label b-h-1  [--cases W1,I2] [--concurrency 2] [--cap-usd 1.4]
//   node experiments/surface/run-builder-eval.mjs --arm B0-H --label b0-h-1 [--cap-usd 1.4]
//   node experiments/surface/run-builder-eval.mjs --arm B-M  --label b-m-1  --token-cap 380000     (INCEPTION_API_KEY in the environment)
//   node experiments/surface/run-builder-eval.mjs --arm REF  --label ref-1                         (reference slots, no model, $0)
//
// Per case: the builder converses with the simulated person (at most 3 rounds of questions; person.mjs answers from the answer key),
// its final workflow must pass strict validation, then it runs ONCE in the case's hidden world with the live registry (every send and
// post asks; the harness approves each as the person and counts it), and the oracle judges the effects (oracle.mjs). Every model call
// goes through one journaled ModelPort per arm (journal.sqlite in the run directory). Records: runs/<label>/records/<case>.json.
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModelBuilder, createBuilderPort } from '../../app/core/builder-model.mjs';
import { loadLibrary, templateById, instantiate, libraryHash } from '../../app/core/library.mjs';
import { validateStrict, runInWorld } from '../../app/core/practice.mjs';
import { createModelPort } from '../lib/models.mjs';
import { B0Builder } from './b0.mjs';
import { respond } from './person.mjs';
import { judge } from './oracle.mjs';
import { recordNumbers, summarize } from './metrics.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
export const CASES_FILE = path.join(root, 'research/surface-20261021/eval/cases.json');
export const MAX_QUESTION_ROUNDS = 3;
// Environment faults (owner rule, 2026-10-21): a session that dies on a usage or rate limit, an unreachable provider or a provider timeout
// is recorded (runs/<label>/faults/), never scored, and rerun with fresh run ids. Our own caps (MODEL_BUDGET) are not faults.
export const ENVIRONMENT_FAULTS = Object.freeze(['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT']);
const faultOf = built => { const code = built?.error?.details?.code ?? built?.error?.code; return ENVIRONMENT_FAULTS.includes(code) ? code : null; };
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The reference "builder": the case's reference slots on the expected template, no model ($0). Used for oracle validity and as the ceiling. */
export function referenceBuilder(caseDef) {
  return { id: 'reference-slots/1 (no model)', async: true, build: async () => {
    if (caseDef.template === 'none') return { status: 'unsupported', builder: 'reference', reply: 'none', buildReport: null };
    const t = templateById(caseDef.template);
    return { status: 'ready', builder: 'reference', template: t.id, workflow: instantiate(t, caseDef.reference, { builder: 'reference' }), understood: { slots: caseDef.reference }, buildReport: null };
  } };
}

export async function runCase(caseDef, { arm, builder, worldsRoot, onRecord = null, attempt = 0 }) {
  const rec = { arm, case: caseDef.id, expected: caseDef.template, templateArm: arm !== 'B0-H', turns: [], questions: [], modelQuestions: [], answers: {},
    cost: { usd: 0, tokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, calls: 0, unknown: 0 }, callLog: [], builderWallMs: 0, repairs: 0, practiceRuns: 0 };
  let final = null;
  for (let turn = 0; turn <= MAX_QUESTION_ROUNDS; turn++) {
    const t0 = Date.now();
    let built;
    try { built = await builder.build({ request: caseDef.request, answers: { ...rec.answers }, runId: `builder1-${arm}-${caseDef.id}-a${attempt}-t${turn}` }); }
    catch (error) { built = { status: 'error', error: { code: error.code ?? 'ERROR', message: String(error.message).slice(0, 500), details: error.details ?? null }, buildReport: error.buildReport ?? null }; }
    rec.builderWallMs += Date.now() - t0;
    const r = built.buildReport;
    if (r) {
      Object.assign(rec.cost, { usd: rec.cost.usd + r.costUsd, inputTokens: rec.cost.inputTokens + r.inputTokens, outputTokens: rec.cost.outputTokens + r.outputTokens,
        cacheReadTokens: rec.cost.cacheReadTokens + r.cacheReadTokens, cacheWriteTokens: rec.cost.cacheWriteTokens + r.cacheWriteTokens, calls: rec.cost.calls + r.calls,
        unknown: rec.cost.unknown + r.callLog.filter(c => c.costUnknown).length });
      rec.cost.tokens = rec.cost.inputTokens + rec.cost.outputTokens + rec.cost.cacheReadTokens + rec.cost.cacheWriteTokens;
      rec.callLog.push(...r.callLog.map(c => ({ turn, ...c })));
      rec.repairs += r.repairs?.length ?? 0; rec.practiceRuns += r.practiceRuns?.length ?? 0;
    }
    rec.turns.push({ turn, status: built.status, template: built.template ?? null, selection: r?.selection ?? null, repairs: r?.repairs ?? [], practiceRuns: r?.practiceRuns ?? [],
      escalations: r?.escalations ?? [], questions: (built.questions ?? []).map(q => ({ id: q.id, slot: q.slot ?? null, question: q.question })), reply: built.reply ?? null, error: built.error ?? null });
    if (built.modelQuestions) rec.modelQuestions.push(...built.modelQuestions.map(q => ({ turn, ...q })));
    if (built.status === 'needs_answers' && turn < MAX_QUESTION_ROUNDS) {
      for (const q of built.questions) {
        const answer = respond(caseDef, q);
        rec.questions.push({ turn, id: q.id, slot: q.slot ?? null, question: q.question, matched: answer.matched, answer: answer.text });
        rec.answers[q.id] = answer.text;
      }
      continue;
    }
    final = built.status === 'needs_answers' ? { ...built, status: 'too_many_questions' } : built;
    break;
  }
  rec.outcome = final.status; rec.error = final.error ?? null; rec.attempt = attempt;
  rec.environmentFault = faultOf(final);
  if (rec.environmentFault) { rec.judgement = { kind: 'environment-fault', verified: null, correctRefusal: null, reasons: [`not scored: ${rec.environmentFault}`], trap: null }; onRecord?.(rec); return rec; }
  rec.template = final.template ?? null; rec.slots = final.understood?.slots ?? null;
  let run = null;
  if (final.status === 'ready') {
    rec.workflow = final.workflow;
    const v = validateStrict(final.workflow);
    rec.builtValid = v.valid;
    if (!v.valid) rec.validationErrors = v.errors.slice(0, 20);
    if (v.valid && caseDef.hidden) {
      mkdirSync(worldsRoot, { recursive: true });
      run = await runInWorld(final.workflow, { sheets: caseDef.hidden.sheets, input: { now: caseDef.hidden.now }, mode: 'live', approve: async () => true, keep: true, root: worldsRoot });
      rec.hidden = { status: run.status, verdict: run.verdict, passed: run.passed, approvals: run.approvals, error: run.error, effects: run.effects, dir: run.dir,
        checks: run.explained?.checks ?? null, failedStep: run.explained?.failedStep ?? null };
    }
  } else if (final.status === 'build_failed' && final.workflow) { rec.workflow = final.workflow; rec.builtValid = false; rec.validationErrors = final.validation?.errors ?? null; }
  rec.judgement = judge(caseDef, { status: final.status, built: final.status === 'ready' && rec.builtValid === true, run });
  rec.numbers = recordNumbers(caseDef, rec);
  onRecord?.(rec);
  return rec;
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}

async function main() {
  const { values: a } = parseArgs({ options: { arm: { type: 'string' }, label: { type: 'string' }, cases: { type: 'string' }, concurrency: { type: 'string' }, 'cap-usd': { type: 'string' },
    'token-cap': { type: 'string' }, 'call-tokens': { type: 'string' }, out: { type: 'string' } } });
  if (!['B-H', 'B-M', 'B0-H', 'REF'].includes(a.arm) || !a.label) throw new Error('usage: --arm B-H|B-M|B0-H|REF --label NAME');
  const doc = JSON.parse(readFileSync(CASES_FILE, 'utf8'));
  const wanted = a.cases ? new Set(a.cases.split(',')) : null;
  const cases = doc.cases.filter(c => !wanted || wanted.has(c.id));
  const outDir = path.resolve(a.out ?? path.join(root, 'research/surface-20261021/runs', a.label));
  const worldsRoot = path.join('/var/tmp/foundry-work/surface-20261021/builder-1', a.label, 'worlds');
  mkdirSync(path.join(outDir, 'records'), { recursive: true });
  const capUsd = Number(a['cap-usd'] ?? 1.4), concurrency = Number(a.concurrency ?? 2);
  let port = null, tokens = () => null, db = null, makeBuilder;
  if (a.arm === 'B-H' || a.arm === 'B-M') {
    const model = a.arm === 'B-H' ? 'claude-haiku-5-5' : 'mercury-3';
    const p = await createBuilderPort({ model, journalFile: path.join(outDir, 'journal.sqlite'), ...(a.arm === 'B-M' ? { tokenCap: Number(a['token-cap'] ?? 380000), callTokens: Number(a['call-tokens'] ?? 20000) } : {}) });
    port = p.port; tokens = p.tokens; db = p.db;
    const builder = new ModelBuilder({ port, model, practiceRoot: null });
    makeBuilder = () => builder;
  } else if (a.arm === 'B0-H') {
    const p = createModelPort({ journalFile: path.join(outDir, 'journal.sqlite'), allowedModels: ['claude-haiku-5-5'], maxBudgetUsdPerCall: 0.5, timeoutMs: 300000 });
    port = p.port; db = p.db;
    const builder = new B0Builder({ port });
    makeBuilder = () => builder;
  } else makeBuilder = c => referenceBuilder(c);
  const started = new Date().toISOString();
  let spent = 0; const skipped = [], faults = [];
  mkdirSync(path.join(outDir, 'faults'), { recursive: true });
  const manifestFile = path.join(root, 'research/surface-20261021/eval/MANIFEST.json');
  const records = (await pool(cases, concurrency, async c => {
    if (a.arm !== 'B-M' && spent >= capUsd) { skipped.push(c.id); return null; }
    let rec;
    for (let attempt = 0; attempt < 3; attempt++) {
      rec = await runCase(c, { arm: a.arm, builder: makeBuilder(c), worldsRoot, attempt });
      spent += rec.cost.usd;
      if (!rec.environmentFault) break;
      faults.push({ case: c.id, attempt, code: rec.environmentFault, usd: rec.cost.usd });
      writeFileSync(path.join(outDir, 'faults', `${c.id}-a${attempt}.json`), `${JSON.stringify(rec, null, 1)}\n`);
      process.stderr.write(`${a.arm} ${c.id}: environment fault ${rec.environmentFault} (attempt ${attempt}); not scored, rerunning\n`);
      await new Promise(r => setTimeout(r, 30000 * (attempt + 1)));
    }
    if (rec.environmentFault) { skipped.push(c.id); return null; }
    writeFileSync(path.join(outDir, 'records', `${c.id}.json`), `${JSON.stringify(rec, null, 1)}\n`);
    process.stderr.write(`${a.arm} ${c.id}: ${rec.outcome}${rec.template ? ` ${rec.template}` : ''} verified=${rec.judgement.verified} refusal=${rec.judgement.correctRefusal} trap=${rec.judgement.trap?.violated ?? '-'} $${rec.cost.usd.toFixed(4)} tok=${rec.cost.tokens} ${Math.round(rec.builderWallMs / 1000)}s\n`);
    return rec;
  })).filter(Boolean);
  const summary = { arm: a.arm, label: a.label, started, finished: new Date().toISOString(), casesFile: path.relative(root, CASES_FILE), casesSha256: sha(CASES_FILE),
    manifestSha256: existsSync(manifestFile) ? sha(manifestFile) : null, libraryHash: libraryHash(loadLibrary()), capUsd, notScored: skipped, environmentFaults: faults,
    spentUsdIncludingFaults: Math.round(spent * 1e6) / 1e6,
    tokenMeter: tokens(), ...summarize(records, doc.cases) };
  writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
  db?.close();
  process.stdout.write(`${JSON.stringify(summary, null, 1)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${error.code ?? 'ERROR'}: ${error.message}\n`); process.exitCode = 1; });
