#!/usr/bin/env node
// CI-1 wave 2 runner (research/ci1-20261021/w2/PREREG-CI1-W2.md). The wave-1 arms, unchanged (experiments/ci1/builders.mjs,
// prompt.mjs, retrieve.mjs, run-arm.mjs's builder factory and question loop), on the wave-2 bed, scored by the wave-2 oracle
// (bed2.mjs scoreBuilt2: oracle v2 primary, v1 recorded beside it). One arm, K builds per item:
//
//   CI1_BED=/var/tmp/foundry-work/ci1-20261021/bed-w2 node experiments/ci1-w2/run-w2.mjs --arm A0|A0t|A1c|A2|REF|EMPTY --label NAME
//        [--k 3] [--items 18797,19187] [--concurrency 2] [--cap-usd 3] [--resume] [--no-manifest] [--drop P12]
//
// The test split runs only against research/ci1-20261021/w2/MANIFEST-W2.json (manifest-w2.mjs): any changed or added frozen file
// refuses the run. --no-manifest is for the $0 control arms (REF, EMPTY) before the freeze. Environment faults are recorded under
// faults/, never scored, and stop the run with exit code 75 (run-detached-w2.sh waits 30 minutes and resumes), as in wave 1.
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelPort } from '../lib/models.mjs';
import { BED, scoreBuilt2 } from './bed2.mjs';
import { respond, EMPTY_WORKFLOW, makeBuilderFactory, scrubAddresses, ENVIRONMENT_FAULTS, MAX_QUESTION_ROUNDS } from '../ci1/run-arm.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
export const RUNS = process.env.CI1_RUNS ?? '/var/tmp/foundry-work/ci1-20261021/runs';
export const SUMMARIES = path.join(root, 'research/ci1-20261021/runs');
export const SPLIT_FILE = path.join(root, 'research/ci1-20261021/w2/SPLIT-W2.json');
export const MANIFEST_FILE = path.join(root, 'research/ci1-20261021/w2/MANIFEST-W2.json');
export const ARMS = Object.freeze(['A0', 'A0t', 'A1c', 'A2', 'REF', 'EMPTY']);
const sha = t => createHash('sha256').update(t).digest('hex');
const faultOf = e => { const code = e?.details?.code ?? e?.code; return ENVIRONMENT_FAULTS.includes(code) ? code : null; };

/** The wave-2 bed is a separate directory: refuse to run against the wave-1 bed by accident. */
export function assertWave2Bed(bed = BED) {
  if (path.basename(bed) !== 'bed-w2') throw new Error(`CI1_BED must point at the wave-2 bed (…/bed-w2), not ${bed}`);
}
export function loadItem2(id) {
  const dir = path.join(BED, 'items', String(id));
  const spec = JSON.parse(readFileSync(path.join(dir, 'spec.json'), 'utf8'));
  const answersFile = path.join(dir, 'answers.json');
  const oracle = JSON.parse(readFileSync(path.join(BED, 'oracle', `${id}.json`), 'utf8'));
  if (oracle.schema !== 'foundry.ci1.oracle/2') throw new Error(`${id}: not a wave-2 oracle (${oracle.schema})`);
  return { id: String(id), request: readFileSync(path.join(dir, 'description.md'), 'utf8'), workspace: spec.workspace,
    answerKey: existsSync(answersFile) ? JSON.parse(readFileSync(answersFile, 'utf8')) : {}, oracle,
    transliteration: JSON.parse(readFileSync(path.join(dir, 'ref.foundry.json'), 'utf8')) };
}

/** Wave 1's runOne (experiments/ci1/run-arm.mjs) with the wave-2 scorer: build with the question loop, then score (v2 primary). */
export async function runOne2(item, { arm, builder, k, label }) {
  const rec = { arm, item: item.id, k, label, wave: 2, turns: [], questions: [], answers: {}, cost: { usd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tokens: 0, calls: 0 },
    callLog: [], practice: [], repairs: [], retrieval: null, selection: null, wallMs: 0 };
  let final = null;
  for (let turn = 0; turn <= MAX_QUESTION_ROUNDS; turn++) {
    const t0 = Date.now();
    let built;
    if (arm === 'REF') built = { status: 'ready', workflow: item.transliteration, buildReport: null };
    else if (arm === 'EMPTY') built = { status: 'ready', workflow: EMPTY_WORKFLOW, buildReport: null };
    else try { built = await builder.build({ request: item.request, workspace: item.workspace, answers: { ...rec.answers }, runId: `ci1w2-${label}-${item.id}-k${k}-t${turn}`, practiceWorld: item.oracle.public.world }); }
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
    const s = await scoreBuilt2(item.oracle, final.workflow);
    rec.pass = s.pass; rec.passV1 = s.passV1; rec.worlds = s.worlds;
  } else { rec.pass = false; rec.passV1 = false; rec.worlds = []; if (final.workflow) rec.workflow = final.workflow; }
  return rec;
}

/** The committed per-build summary row (no workflow, addresses scrubbed later). */
export function summaryRow(r) {
  const fail = r.worlds.find(w => !w.pass);
  return { item: r.item, k: r.k, outcome: r.outcome, pass: r.pass, passV1: r.passV1 ?? null, worldsPassed: r.worlds.filter(w => w.pass).length, worlds: r.worlds.length,
    usd: r.cost.usd, tokens: r.cost.tokens, calls: r.cost.calls, wallMs: r.wallMs, questions: r.questions.length, repairs: r.repairs.length, practice: r.practice.map(p => p.status),
    reviewedOk: r.turns.at(-1)?.reviewed ?? null,
    retrieval: r.retrieval?.rounds?.[0] ? { patterns: r.retrieval.rounds[0].patterns.map(p => p.id), exemplars: r.retrieval.rounds[0].exemplars.map(e => e.id), excluded: r.retrieval.rounds[0].excluded } : null,
    firstFailure: fail ? { world: fail.id, reasons: fail.reasons.slice(0, 3).map(x => String(x).slice(0, 240)), status: fail.status, error: fail.error ?? null }
      : (r.pass ? null : { outcome: r.outcome, error: r.error ? `${r.error.code ?? ''} ${String(r.error.message ?? '').slice(0, 200)}` : null }) };
}

async function pool(jobs, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, jobs.length)) }, async () => { while (next < jobs.length) { const i = next++; await fn(jobs[i], i); } }));
}

async function main() {
  const { values: a } = parseArgs({ options: { arm: { type: 'string' }, label: { type: 'string' }, k: { type: 'string' }, items: { type: 'string' },
    concurrency: { type: 'string' }, 'cap-usd': { type: 'string' }, resume: { type: 'boolean' }, 'no-manifest': { type: 'boolean' }, drop: { type: 'string' } } });
  if (!ARMS.includes(a.arm) || !a.label) throw new Error(`usage: --arm ${ARMS.join('|')} --label NAME`);
  if (!a.label.startsWith('w2-')) throw new Error('wave-2 labels start with "w2-"');
  assertWave2Bed();
  const split = JSON.parse(readFileSync(SPLIT_FILE, 'utf8'));
  let ids = split.test;
  if (a.items) { const want = a.items.split(','); const bad = want.filter(x => !ids.includes(x)); if (bad.length) throw new Error(`not in the wave-2 split: ${bad.join(', ')}`); ids = want; }
  const paid = !['REF', 'EMPTY'].includes(a.arm);
  if (paid && a['no-manifest']) throw new Error('--no-manifest is for the $0 control arms only');
  let manifestSha256 = null;
  if (!a['no-manifest']) {
    const { checkManifestW2 } = await import('./manifest-w2.mjs');
    const bad = checkManifestW2(MANIFEST_FILE);
    if (bad.length) throw new Error(`the wave-2 manifest does not match (${bad.slice(0, 5).join('; ')}): refusing to run`);
    manifestSha256 = sha(readFileSync(MANIFEST_FILE));
  }
  const K = Number(a.k ?? 3), concurrency = Number(a.concurrency ?? 2), capUsd = Number(a['cap-usd'] ?? 3);
  const outDir = path.join(RUNS, a.label), recDir = path.join(outDir, 'records'), faultDir = path.join(outDir, 'faults');
  mkdirSync(recDir, { recursive: true }); mkdirSync(faultDir, { recursive: true });
  const model = 'claude-haiku-5-5';
  let port = null, db = null;
  if (paid) { const p = createModelPort({ journalFile: path.join(outDir, 'journal.sqlite'), allowedModels: [model], maxBudgetUsdPerCall: 0.5, timeoutMs: 600000 }); port = p.port; db = p.db; }
  const drop = a.drop ? a.drop.split(',') : [];
  if (drop.length && a.arm !== 'A2') throw new Error('--drop applies to the retrieval arm only');
  const factory = makeBuilderFactory(a.arm, { port, model, drop });
  const items = new Map(ids.map(id => [id, loadItem2(id)]));
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
    const rec = await runOne2(items.get(j.id), { arm: a.arm, builder: factory(items.get(j.id)), k: j.k, label: a.label });
    spent += rec.cost.usd;
    if (rec.environmentFault) { fault = rec.environmentFault; writeFileSync(path.join(faultDir, `${j.id}-k${j.k}-${Date.now()}.json`), JSON.stringify(rec, null, 1)); process.stderr.write(`${a.arm} ${j.id} k${j.k}: ENVIRONMENT FAULT ${fault}; not scored\n`); return; }
    writeFileSync(recFile(j), JSON.stringify(rec, null, 1));
    process.stderr.write(`${a.arm} ${j.id} k${j.k}: ${rec.outcome} pass=${rec.pass} v1=${rec.passV1} worlds=${rec.worlds.filter(w => w.pass).length}/${rec.worlds.length} $${rec.cost.usd.toFixed(4)} tok=${rec.cost.tokens} ${Math.round(rec.wallMs / 1000)}s\n`);
  });
  const recs = jobs.map(j => existsSync(recFile(j)) ? JSON.parse(readFileSync(recFile(j), 'utf8')) : null).filter(Boolean);
  const summary = { wave: 2, oracle: 'v2 (primary), v1 recorded', arm: a.arm, label: a.label, split: 'test', ...(drop.length ? { dropPatterns: drop } : {}), model: paid ? model : null, K, items: ids, manifestSha256,
    started, finished: new Date().toISOString(), capUsd, spentUsd: Math.round(spent * 1e6) / 1e6, notRun: skipped, environmentFault: fault, records: recs.map(summaryRow) };
  mkdirSync(path.join(SUMMARIES, a.label), { recursive: true });
  writeFileSync(path.join(SUMMARIES, a.label, 'summary.json'), `${scrubAddresses(JSON.stringify(summary, null, 1))}\n`);
  db?.close();
  const n = summary.records.length, p = summary.records.filter(r => r.pass).length, p1 = summary.records.filter(r => r.passV1).length;
  process.stdout.write(`${a.arm} ${a.label}: ${p}/${n} builds pass (v1 ${p1}); $${summary.spentUsd}; fault=${fault}\n`);
  if (fault) process.exitCode = 75;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${error.code ?? 'ERROR'}: ${error.message}\n`); process.exitCode = 1; });
