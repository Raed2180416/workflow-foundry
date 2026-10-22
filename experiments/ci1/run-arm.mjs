#!/usr/bin/env node
// CI-1 runner (research/ci1-20261021/PREREG-CI1.md). One arm, one split, K builds per item:
//
//   node experiments/ci1/run-arm.mjs --arm A0|A0t|A1|A1c|A2|A2-M|REF|EMPTY --label NAME --split dev|test [--k 3] [--items 14177,16364]
//        [--concurrency 2] [--cap-usd 3] [--token-cap 450000] [--resume] [--manifest research/ci1-20261021/MANIFEST.json]
//
// Per (item, k): the builder sees the item's description (request) and workspace; questions get the item's answer key or the fixed
// fallback (at most 2 rounds); a 'ready' workflow runs once in every hidden world of the frozen oracle and passes the item only when
// its effects are equivalent to the reference's in every hidden world (canon.mjs). The compose arms also get the item's PUBLIC world
// for practice (never a hidden one). Builds stop being launched when the arm's spend reaches --cap-usd.
// Environment faults (rate or session limits, an unreachable provider, a provider timeout) are recorded under faults/, never scored,
// and stop the run with exit code 75 so the detached wrapper waits 30 minutes and resumes with --resume.
// Records (built workflows, effects, reasons) stay outside git under RUNS/<label>; the committed summary has scores, costs, reasons.
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelPort } from '../lib/models.mjs';
import { createBuilderPort } from '../../app/core/builder-model.mjs';
import { BED, scoreBuilt } from './bed.mjs';
import { OneShotBuilder, TemplateArm, ComposeBuilder } from './builders.mjs';
import { retrieve, buildIndex } from './retrieve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
export const RUNS = process.env.CI1_RUNS ?? '/var/tmp/foundry-work/ci1-20261021/runs';
export const SUMMARIES = path.join(root, 'research/ci1-20261021/runs');
export const SPLIT_FILE = path.join(root, 'research/ci1-20261021/SPLIT.json');
export const MAX_QUESTION_ROUNDS = 2;
export const ENVIRONMENT_FAULTS = Object.freeze(['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT']);
export const FALLBACK = "Everything I know is in my request. Please go with sensible defaults, and don't contact anyone or change anything I didn't mention.";
export const ARMS = Object.freeze(['A0', 'A0t', 'A1', 'A1c', 'A2', 'A2-M', 'REF', 'EMPTY']);
const sha = t => createHash('sha256').update(t).digest('hex');
/** The committed summary keeps only synthetic addresses (.example / .test domains): any other address a model wrote (for instance the
 *  session account's own, which the claude CLI route exposes: research/surface-20261021/BUILDER-1.md §3) is redacted. */
export const scrubAddresses = text => String(text).replace(/[\w.+-]+@([\w-]+\.)+[\w-]+/g, m => /@([\w-]+\.)*(example(\.(com|org|net))?|test)$/i.test(m) ? m : '<redacted-address>');
const faultOf = e => { const code = e?.details?.code ?? e?.code; return ENVIRONMENT_FAULTS.includes(code) ? code : null; };

export function loadBedItem(id) {
  const dir = path.join(BED, 'items', String(id));
  const spec = JSON.parse(readFileSync(path.join(dir, 'spec.json'), 'utf8'));
  const answersFile = path.join(dir, 'answers.json');
  return { id: String(id), request: readFileSync(path.join(dir, 'description.md'), 'utf8'), workspace: spec.workspace,
    answerKey: existsSync(answersFile) ? JSON.parse(readFileSync(answersFile, 'utf8')) : {},
    oracle: JSON.parse(readFileSync(path.join(BED, 'oracle', `${id}.json`), 'utf8')),
    transliteration: JSON.parse(readFileSync(path.join(dir, 'ref.foundry.json'), 'utf8')) };
}
/** The simulated person: an answer-key entry whose patterns match the question, else the fixed fallback. */
export function respond(answerKey, question) {
  const hits = (answerKey.answers ?? []).filter(a => (a.match ?? []).some(rx => new RegExp(rx, 'i').test(question.question ?? '')));
  return hits.length ? { text: hits.map(h => h.answer).join(' '), matched: true } : { text: FALLBACK, matched: false };
}
export const EMPTY_WORKFLOW = { schemaVersion: '1.0', id: 'ci1-empty', version: 1, title: 'Does nothing', goal: 'Control: no effects.', domain: 'general',
  envelope: { assumptions: [], risks: [], successCriteria: ['nothing'] }, inputSchema: { type: 'object', additionalProperties: false, required: ['now'], properties: { now: { type: 'string' } } },
  budget: { maxSteps: 5, maxConcurrency: 1, maxDurationMs: 60000, maxCost: 0 },
  nodes: [{ id: 'noop', kind: 'task', needs: [], description: 'nothing', tool: 'core.identity', args: { value: 1 }, timeoutMs: 1000, retry: { maxAttempts: 1 } }],
  acceptance: [{ op: 'eq', left: { $ref: 'nodes.noop.value' }, right: 1 }] };

/** Build one item once (with the question loop), then score the result. */
export async function runOne(item, { arm, builder, k, label }) {
  const rec = { arm, item: item.id, k, label, turns: [], questions: [], answers: {}, cost: { usd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tokens: 0, calls: 0 },
    callLog: [], practice: [], repairs: [], retrieval: null, selection: null, wallMs: 0 };
  let final = null;
  for (let turn = 0; turn <= MAX_QUESTION_ROUNDS; turn++) {
    const t0 = Date.now();
    let built;
    if (arm === 'REF') built = { status: 'ready', workflow: item.transliteration, buildReport: null };
    else if (arm === 'EMPTY') built = { status: 'ready', workflow: EMPTY_WORKFLOW, buildReport: null };
    else try { built = await builder.build({ request: item.request, workspace: item.workspace, answers: { ...rec.answers }, runId: `ci1-${label}-${item.id}-k${k}-t${turn}`, practiceWorld: item.oracle.public.world }); }
    catch (error) { built = { status: 'error', error: { code: error.code ?? 'ERROR', message: String(error.message).slice(0, 500), details: error.details ?? null }, buildReport: error.buildReport ?? null, fault: faultOf(error) }; }
    rec.wallMs += Date.now() - t0;
    const r = built.buildReport;
    if (r) {
      for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) rec.cost[key] += r[key] ?? 0;
      rec.cost.usd = Math.round((rec.cost.usd + (r.costUsd ?? 0)) * 1e6) / 1e6; rec.cost.calls += r.calls ?? 0;
      rec.cost.tokens = rec.cost.inputTokens + rec.cost.outputTokens + rec.cost.cacheReadTokens + rec.cost.cacheWriteTokens;
      rec.callLog.push(...(r.callLog ?? []).map(c => ({ turn, ...c })));
      rec.practice.push(...(r.practiceRuns ?? []).map(p => ({ turn, ...p }))); rec.repairs.push(...(r.repairs ?? []).map(p => ({ turn, ...p })));
      if (r.retrieval) rec.retrieval = r.retrieval; if (r.selection) rec.selection = r.selection;
    }
    rec.turns.push({ turn, status: built.status, template: built.template ?? null, reply: built.reply ?? built.reason ?? null, error: built.error ?? null, reviewed: built.reviewed ?? null,
      questions: (built.questions ?? []).map(q => ({ id: q.id, question: q.question })) });
    if (built.status === 'needs_answers' && turn < MAX_QUESTION_ROUNDS) {
      for (const q of built.questions) { const a = respond(item.answerKey, q); rec.questions.push({ turn, id: q.id, question: q.question, matched: a.matched }); rec.answers[q.id] = a.text; }
      continue;
    }
    final = built.status === 'needs_answers' ? { ...built, status: 'too_many_questions' } : built;
    break;
  }
  rec.outcome = final.status; rec.template = final.template ?? null; rec.error = final.error ?? null;
  rec.environmentFault = final.fault ?? (final.status === 'error' ? faultOf(final.error) : null);
  if (rec.environmentFault) return rec;
  if (final.status === 'ready') {
    rec.workflow = final.workflow; rec.workflowSha256 = sha(JSON.stringify(final.workflow));
    const s = await scoreBuilt(item.oracle, final.workflow);
    rec.pass = s.pass; rec.worlds = s.worlds;
  } else { rec.pass = false; rec.worlds = []; if (final.workflow) rec.workflow = final.workflow; }
  return rec;
}

async function pool(jobs, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, jobs.length)) }, async () => { while (next < jobs.length) { const i = next++; await fn(jobs[i], i); } }));
}

export function makeBuilderFactory(arm, { port, model, drop = [] }) {
  if (arm === 'A0') { const b = new OneShotBuilder({ port, model }); return () => b; }
  if (arm === 'A0t') { const b = new OneShotBuilder({ port, model, reasoning: 'medium', runPrefix: 'ci1-a0t' }); return () => b; }
  if (arm === 'A1') { const b = new TemplateArm({ port, model }); return () => b; }
  if (arm === 'A1c') { const b = new ComposeBuilder({ port, model }); return () => b; }
  if (arm === 'A2' || arm === 'A2-M') {
    const index = buildIndex();
    return item => new ComposeBuilder({ port, model, runPrefix: 'ci1-a2', retrieval: ({ request, workspace, draft }) => retrieve({ request, workspace, targetId: item.id, index, draft, drop }) });
  }
  return () => null;
}

async function main() {
  const { values: a } = parseArgs({ options: { arm: { type: 'string' }, label: { type: 'string' }, split: { type: 'string' }, k: { type: 'string' }, items: { type: 'string' },
    concurrency: { type: 'string' }, 'cap-usd': { type: 'string' }, 'token-cap': { type: 'string' }, resume: { type: 'boolean' }, manifest: { type: 'string' },
    drop: { type: 'string' } } });
  if (!ARMS.includes(a.arm) || !a.label || !['dev', 'test'].includes(a.split)) throw new Error(`usage: --arm ${ARMS.join('|')} --label NAME --split dev|test`);
  const split = JSON.parse(readFileSync(SPLIT_FILE, 'utf8'));
  let ids = split[a.split];
  if (a.items) { const want = a.items.split(','); const bad = want.filter(x => !ids.includes(x)); if (bad.length) throw new Error(`not in the ${a.split} split: ${bad.join(', ')}`); ids = want; }
  // the test split runs only against the frozen manifest: every hashed file must be unchanged
  let manifestSha256 = null;
  if (a.split === 'test' || a.manifest) {
    const file = path.join(root, a.manifest ?? 'research/ci1-20261021/MANIFEST.json');
    const { checkManifest } = await import('./manifest.mjs');
    const bad = checkManifest(file);
    if (bad.length) throw new Error(`the manifest does not match (${bad.slice(0, 5).join('; ')}): refusing to run`);
    manifestSha256 = sha(readFileSync(file));
  }
  const K = Number(a.k ?? 3), concurrency = Number(a.concurrency ?? 2), capUsd = Number(a['cap-usd'] ?? 3);
  const outDir = path.join(RUNS, a.label), recDir = path.join(outDir, 'records'), faultDir = path.join(outDir, 'faults');
  mkdirSync(recDir, { recursive: true }); mkdirSync(faultDir, { recursive: true });
  const model = a.arm === 'A2-M' ? 'mercury-3' : 'claude-haiku-5-5';
  let port = null, db = null, tokens = () => null;
  if (!['REF', 'EMPTY'].includes(a.arm)) {
    if (a.arm === 'A2-M') { const p = await createBuilderPort({ model, journalFile: path.join(outDir, 'journal.sqlite'), tokenCap: Number(a['token-cap'] ?? 450000), callTokens: 60000 }); port = p.port; db = p.db; tokens = p.tokens; }
    else { const p = createModelPort({ journalFile: path.join(outDir, 'journal.sqlite'), allowedModels: [model], maxBudgetUsdPerCall: 0.5, timeoutMs: 600000 }); port = p.port; db = p.db; }
  }
  // --drop P42[,P16]: leave-one-pattern-out attribution runs (A2 only; preregistered as exploratory, PREREG-CI1.md §4)
  const drop = a.drop ? a.drop.split(',') : [];
  if (drop.length && !['A2', 'A2-M'].includes(a.arm)) throw new Error('--drop applies to the retrieval arms only');
  const factory = makeBuilderFactory(a.arm, { port, model, drop });
  const items = new Map(ids.map(id => [id, loadBedItem(id)]));
  const jobs = ids.flatMap(id => Array.from({ length: K }, (_, k) => ({ id, k })));
  const recFile = j => path.join(recDir, `${j.id}-k${j.k}.json`);
  let spent = 0;
  for (const j of jobs) if (existsSync(recFile(j))) spent += JSON.parse(readFileSync(recFile(j), 'utf8')).cost.usd;
  for (const f of existsSync(faultDir) ? readdirSync(faultDir) : []) spent += JSON.parse(readFileSync(path.join(faultDir, f), 'utf8')).cost?.usd ?? 0;
  let fault = null; const skipped = [];
  const started = new Date().toISOString();
  await pool(jobs, concurrency, async j => {
    if (fault) return;
    if (a.resume && existsSync(recFile(j))) return;
    if (spent >= capUsd) { skipped.push(`${j.id}-k${j.k}`); return; }
    const rec = await runOne(items.get(j.id), { arm: a.arm, builder: factory(items.get(j.id)), k: j.k, label: a.label });
    spent += rec.cost.usd;
    if (rec.environmentFault) { fault = rec.environmentFault; writeFileSync(path.join(faultDir, `${j.id}-k${j.k}-${Date.now()}.json`), JSON.stringify(rec, null, 1)); process.stderr.write(`${a.arm} ${j.id} k${j.k}: ENVIRONMENT FAULT ${fault}; not scored\n`); return; }
    writeFileSync(recFile(j), JSON.stringify(rec, null, 1));
    process.stderr.write(`${a.arm} ${j.id} k${j.k}: ${rec.outcome} pass=${rec.pass} worlds=${rec.worlds.filter(w => w.pass).length}/${rec.worlds.length} $${rec.cost.usd.toFixed(4)} tok=${rec.cost.tokens} ${Math.round(rec.wallMs / 1000)}s\n`);
  });
  const recs = jobs.map(j => existsSync(recFile(j)) ? JSON.parse(readFileSync(recFile(j), 'utf8')) : null).filter(Boolean);
  const summary = { arm: a.arm, label: a.label, split: a.split, ...(drop.length ? { dropPatterns: drop } : {}), model: ['REF', 'EMPTY'].includes(a.arm) ? null : model, K, items: ids, manifestSha256, started, finished: new Date().toISOString(),
    capUsd, spentUsd: Math.round(spent * 1e6) / 1e6, notRun: skipped, environmentFault: fault, tokenMeter: tokens(),
    records: recs.map(r => ({ item: r.item, k: r.k, outcome: r.outcome, pass: r.pass, worldsPassed: r.worlds.filter(w => w.pass).length, worlds: r.worlds.length,
      usd: r.cost.usd, tokens: r.cost.tokens, calls: r.cost.calls, wallMs: r.wallMs, questions: r.questions.length, repairs: r.repairs.length, practice: r.practice.map(p => p.status),
      reviewedOk: r.turns.at(-1)?.reviewed ?? null, retrieval: r.retrieval?.rounds?.[0] ? { patterns: r.retrieval.rounds[0].patterns.map(p => p.id), exemplars: r.retrieval.rounds[0].exemplars.map(e => e.id), excluded: r.retrieval.rounds[0].excluded } : null,
      firstFailure: r.worlds.find(w => !w.pass) ? { world: r.worlds.find(w => !w.pass).id, reasons: r.worlds.find(w => !w.pass).reasons.slice(0, 3).map(x => String(x).slice(0, 240)), status: r.worlds.find(w => !w.pass).status } : (r.pass ? null : { outcome: r.outcome, error: r.error ? `${r.error.code ?? ''} ${String(r.error.message ?? '').slice(0, 200)}` : null }) })) };
  mkdirSync(path.join(SUMMARIES, a.label), { recursive: true });
  writeFileSync(path.join(SUMMARIES, a.label, 'summary.json'), `${scrubAddresses(JSON.stringify(summary, null, 1))}\n`);
  db?.close();
  const n = summary.records.length, p = summary.records.filter(r => r.pass).length;
  process.stdout.write(`${a.arm} ${a.label}: ${p}/${n} builds pass; $${summary.spentUsd}; fault=${fault}\n`);
  if (fault) process.exitCode = 75;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${error.code ?? 'ERROR'}: ${error.message}\n`); process.exitCode = 1; });
