#!/usr/bin/env node
// The tracker on E8 (research/tracker-20261021/PREREG-TRACKER.md §E8). Practice worlds 1235 (d2), 1236 (d3), 1237 (d5) only; no dev
// or sealed world is touched. Steps, each writing JSON under --out (default research/tracker-20261021/e8):
//
//   prepare   conditions from the person's text (frozen SPEC-E 48535bb): the 2026-10-14 Haiku extraction s0 plus the $0 coverage
//             rule (every normative sentence no quote covers becomes a condition); capture recall vs the frozen gold; the vocabulary
//             (systems' op schemas + the inbound message shapes of the practice traces); analyst-side oracle labels per build.
//   bind      --model claude-haiku-5-5 --budget USD    checks for every condition (batches of 8; vocabulary only, linted)
//   judge     --bind FILE                              every build on the practice worlds -> status per condition (T2), run health (T0)
//   prose     --model claude-haiku-5-5 --budget USD    T1: one checklist review per build (conditions + solver source + run health)
//   score
//
// Builds: the seven archived B1 solvers (research/enterprise-20261014/runs/*/solver.mjs) and the three specificity solvers
// (beds/ebed/e8/specificity/*.mjs, run as black boxes: their source goes to the sandbox and to T1, never read here). Oracle labels are
// analyst-side only: neither the tracker, its binder nor T1 sees them.
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { runBuild } from '../tracker/run.mjs';
import { indexText, buildLedger } from '../tracker/ledger.mjs';
import { scoreExtraction } from '../tracker/eval-e8.mjs';
import { createModelPort } from '../lib/models.mjs';
import { bind } from '../../app/core/tracker/model.mjs';
import { judgeViews, crossBuild } from '../../app/core/tracker/index.mjs';
import { tally } from '../../app/core/tracker/status.mjs';
import { viewOfTrace, e8Vocabulary } from './e8.mjs';
import { prose } from './prose.mjs';
import { ROOT, sha256 } from './builder1.mjs';

export const SPEC_COMMIT = '48535bb', SPEC_SHA256 = 'c013c04c80636682f46fd9bdbc2bf436712ed53233b03a06ba74bd88824f8cf1';
export const PRACTICE = Object.freeze({ seeds: [1235, 1236, 1237], difficulties: [2, 3, 5] });
export const BUILDS = Object.freeze([
  ...['b1lh-e8-1', 'b1lh-e8-2', 'b1lh-e8-3', 'b1h-e8-1', 'b1nh-e8-2', 'b1nh-e8-3', 'b1o-e8-1'].map(l => ({ id: l, file: `research/enterprise-20261014/runs/${l}/solver.mjs` })),
  ...['s1-state-machine', 's2-reconciler', 's3-saga-engine'].map(l => ({ id: l, file: `beds/ebed/e8/specificity/${l}.mjs` })),
]);
const ITEM = { binding: e8.binding, generateWorld: e8.generateWorld, oracleItem: e8.oracleItem };
const readJson = f => JSON.parse(readFileSync(f, 'utf8'));
const writeJson = (f, v) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, `${JSON.stringify(v, null, 1)}\n`); };
const ENV_FAULTS = ['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT'];
const round = n => Math.round(n * 1e6) / 1e6;

/** The frozen SPEC-E text (the gold's source), checked by hash. */
export function specText() {
  const text = execFileSync('git', ['show', `${SPEC_COMMIT}:beds/ebed/e8/spec/SPEC-E.md`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 });
  if (sha256(text) !== SPEC_SHA256) throw new Error('frozen SPEC-E hash mismatch');
  return text;
}
const words = text => [{ turn: 0, kind: 'request', text }];

/** Conditions: the stored Haiku s0 extraction plus every coverage-list sentence (the $0 rule). */
export function conditionsFromLedger(text) {
  const s0 = readJson(path.join(ROOT, 'research/need-router-20261014/tracker-e8/extraction/haiku.s0.json'));
  const extra = (s0.uncovered ?? []).map(u => ({ quote: u.text, kind: 'must', summary: u.text, rule: true }));
  const ledger = buildLedger({ text, source: { file: 'beds/ebed/e8/spec/SPEC-E.md' }, extractor: { model: 'claude-haiku-5-5 s0 + coverage rule', prompt: 'tracker-extract/1' },
    entries: [...s0.requirements.map(r => ({ quote: r.quote, kind: r.kind, summary: r.summary })), ...extra] });
  const conditions = ledger.requirements.map((r, i) => ({ id: `C-${String(i + 1).padStart(3, '0')}`, quote: r.quote, summary: r.summary, kind: r.kind, span: r.span, verification: 'test', check: null, missing: [] }));
  return { ledger, conditions };
}

async function runAll(build, log) {
  const source = readFileSync(path.join(ROOT, build.file), 'utf8');
  return runBuild({ item: ITEM, solverSource: source, practice: PRACTICE, log: s => log(`  ${build.id}${s}`) });
}

/** Analyst-side oracle labels of one build's practice runs (never shown to the tracker or T1). */
const poolsCache = new Map();
async function labelsOf(runs) {
  const out = {};
  for (const [i, run] of runs.entries()) {
    const world = e8.generateWorld({ seed: PRACTICE.seeds[i], difficulty: PRACTICE.difficulties[i], mix: 'tail' });
    if (!poolsCache.has(i)) poolsCache.set(i, (await e8.referenceRuns(world)).pools);
    const pools = poolsCache.get(i);
    const v = e8.oracle(world, run.rows, { pools, arm: 'tracker-label' });
    const comp = v.cases.filter(c => c.pool === 'completed');
    out[run.world] = { completed: comp.length, passed: comp.filter(c => c.pass).length, failingSubjects: comp.filter(c => !c.pass).map(c => c.subject), passingSubjects: comp.filter(c => c.pass).map(c => c.subject) };
  }
  return out;
}
const healthOf = runs => Object.fromEntries(runs.map(r => [r.world, { status: r.status, effects: r.trace.effects.length, refused: r.trace.refused.length,
  firstRefusal: r.trace.refused[0] ? `${r.trace.refused[0].code ?? ''}: ${JSON.stringify(r.trace.refused[0].detail ?? '').slice(0, 160)}` : null,
  byOp: r.trace.effects.reduce((m, e) => ({ ...m, [`${e.system}.${e.op}`]: (m[`${e.system}.${e.op}`] ?? 0) + 1 }), {}) }]));

export async function stepPrepare({ out, log = console.error }) {
  const text = specText();
  const { ledger, conditions } = conditionsFromLedger(text);
  const gold = readJson(path.join(ROOT, 'research/need-router-20261014/tracker-e8/gold.json'));
  const s0 = readJson(path.join(ROOT, 'research/need-router-20261014/tracker-e8/extraction/haiku.s0.json'));
  writeJson(path.join(out, 'conditions-s0rule.json'), { source: { commit: SPEC_COMMIT, sha256: SPEC_SHA256 }, conditions,
    recall: { s0: scoreExtraction(s0, gold, text), s0PlusRule: scoreExtraction({ ...ledger, extractor: { ...ledger.extractor, costUsd: s0.extractor.costUsd } }, gold, text) } });
  const traces = [], labels = {};
  for (const b of BUILDS) {
    log(`prepare ${b.id}`);
    const runs = await runAll(b, log);
    traces.push(...runs.map(r => ({ inbound: r.trace.inbound })));
    labels[b.id] = { worlds: await labelsOf(runs), health: healthOf(runs), solverSha256: sha256(readFileSync(path.join(ROOT, b.file))) };
  }
  writeJson(path.join(out, 'vocab.json'), e8Vocabulary({ traces }));
  writeJson(path.join(out, 'labels.json'), labels);
}

export async function stepBind({ out, model, budget = 1, batch = 8, sample = 0, log = console.error, port: given = null }) {
  const conds = readJson(path.join(out, 'conditions-s0rule.json')).conditions;
  const vocab = readJson(path.join(out, 'vocab.json'));
  // Sample 0 keeps the frozen file name and run ids; a later sample (PREREG-TRACKER §3: "K = 2 if budget allows") gets its own of both,
  // so the journal never replays sample 0's answers.
  const tag = sample ? `-b${sample}` : '';
  const file = path.join(out, `bind-${model}${tag}.json`);
  const doc = existsSync(file) ? readJson(file) : { model, conditions: {}, calls: [], costUsd: 0 };
  const { port, db } = given ? { port: given, db: null } : createModelPort({ journalFile: path.join(out, 'journal', `${model}.sqlite`), allowedModels: ['claude-haiku-5-5', model], maxBudgetUsdPerCall: 0.2, timeoutMs: 300_000 });
  const w = words(specText());
  let spent = 0;
  try {
    const todo = conds.filter(c => !doc.conditions[c.id]);
    for (let i = 0; i < todo.length; i += batch) {
      if (spent >= budget) { log(`bind: budget $${budget} reached`); break; }
      const list = todo.slice(i, i + batch), calls = [];
      let r;
      try { r = await bind({ port, model, vocab, words: w, conditions: list, runId: `e8-bind-${list[0].id}${tag}`, log: x => calls.push(x) }); }
      catch (error) {
        const fault = ENV_FAULTS.includes(error.details?.code ?? error.code);
        log(`bind ${list[0].id}..: ${error.code} ${fault ? '(environment fault: stop, not scored)' : ''} ${String(error.message).slice(0, 200)}`);
        if (fault) { writeJson(file, doc); throw error; }
        r = new Map(list.map(c => [c.id, { decision: 'error', why: error.code ?? 'ERROR', lint: [] }]));
      }
      for (const c of list) {
        const b = r.get(c.id) ?? { decision: 'missing' };
        doc.conditions[c.id] = { decision: b.decision, check: b.decision === 'check' ? b.check : null, why: b.why ?? null, question: b.question ?? null, lint: b.lint ?? [], retried: !!b.retried, dropped: b.dropped ?? null };
      }
      const usd = calls.reduce((a, x) => a + x.costUsd, 0);
      spent += usd; doc.costUsd = round(doc.costUsd + usd); doc.calls.push(...calls);
      log(`bind ${list[0].id}..${list.at(-1).id}: ${list.filter(c => doc.conditions[c.id].check).length}/${list.length} checks $${usd.toFixed(4)}`);
      writeJson(file, doc);
    }
  } finally { db?.close?.(); }
  return file;
}

const boundConditions = (conds, bound) => conds.map(c => {
  const b = bound.conditions[c.id] ?? { decision: 'missing' };
  if (b.decision === 'check' && b.check) return { ...c, version: 1, check: b.check };
  if (b.decision === 'inspection' || b.decision === 'not-a-condition') return { ...c, version: 1, verification: 'inspection', why: b.why ?? b.decision };
  if (b.decision === 'needs-answer') return { ...c, version: 1, missing: [b.question ?? 'a detail is missing'] };
  return { ...c, version: 1, why: b.why ?? b.decision };
});

export async function stepJudge({ out, bindFile, log = console.error, semantics = ['v1', 'v2', 'v3'] }) {
  const conds = boundConditions(readJson(path.join(out, 'conditions-s0rule.json')).conditions, readJson(bindFile));
  const w = words(specText());
  // Deviation D1 (PREREG-TRACKER §8): on this shared machine a tick can exceed the 25 s call limit, or a world the 240 s limit. Those
  // runs are environment faults: a (build, world) whose run here OR in `prepare` (labels.json) hit a call timeout or did not complete
  // is excluded from the views and from scoring, never scored.
  const labels = readJson(path.join(out, 'labels.json'));
  const faulted = h => !h || !/^complete/.test(h.status) || /timeout/.test(h.firstRefusal ?? '');
  const views = {}, excluded = {}, health = {};
  for (const b of BUILDS) {
    // A build whose every world already faulted in `prepare` is excluded whatever this run does (D1): not run again. Running it held a
    // stalled world for 240 s and took the judge past its heap (2026-10-22 03:20Z, RESULT-TRACKER.md §7).
    const pre = Object.entries(labels[b.id]?.health ?? {});
    if (pre.length && pre.every(([, h]) => faulted(h))) {
      health[b.id] = labels[b.id].health; excluded[b.id] = pre.map(([w]) => w); views[b.id] = [];
      log(`judge: skip ${b.id} (every world faulted in prepare)`);
      continue;
    }
    log(`judge: run ${b.id}`);
    const runs = await runAll(b, () => {});
    health[b.id] = healthOf(runs);
    excluded[b.id] = runs.filter(r => faulted(health[b.id][r.world]) || faulted(labels[b.id]?.health?.[r.world])).map(r => r.world);
    views[b.id] = runs.filter(r => !excluded[b.id].includes(r.world)).map(r => viewOfTrace(r.trace, { id: `${b.id}:${r.world}` }));
  }
  const gateViews = Object.values(views).flat();
  const live = BUILDS.filter(b => views[b.id].length);
  // Deviation D2: the same views judged under the frozen semantics (v1, judge-<bind>.json) and under v2 (judge-v2-<bind>.json).
  const files = [];
  for (const sem of semantics) {
    const opts = { gateViews, semantics: sem, words: w };
    const first = Object.fromEntries(live.map(b => [b.id, judgeViews(conds, views[b.id], opts)]));
    const g3 = crossBuild(live.map(b => Object.fromEntries(Object.entries(first[b.id]).map(([id, s]) => [id, s.status]))));
    const result = { bind: path.basename(bindFile), ...(sem === 'v1' ? {} : { semantics: sem }), g3: [...g3], excluded, health, builds: {} };
    for (const b of live) {
      const withG3 = g3.size ? judgeViews(conds, views[b.id], { ...opts, suspects: g3 }) : first[b.id];
      const pick = s => Object.fromEntries(Object.entries(s).map(([id, x]) => [id, { status: x.status, reason: x.reason ?? null, decided: x.decided, violated: x.violated, flags: x.flags ?? [],
        evidence: (x.evidence ?? []).slice(0, 3).map(e => ({ subject: e.item?.subject ?? null, view: e.view ?? null, why: e.why, question: e.question })), questions: x.questions }]));
      result.builds[b.id] = { t2: pick(withG3), t2NoG3: pick(first[b.id]), tally: tally(Object.values(withG3)), tallyNoG3: tally(Object.values(first[b.id])) };
      // D3: the product with one build in hand (the real-shape gate on this build's own runs only, no G3).
      if (sem !== 'v1') { const solo = judgeViews(conds, views[b.id], { ...opts, gateViews: views[b.id] }); Object.assign(result.builds[b.id], { t2Solo: pick(solo), tallySolo: tally(Object.values(solo)) }); }
      log(`judge ${sem} ${b.id}: unmet ${result.builds[b.id].tally.unmet} (no G3 ${result.builds[b.id].tallyNoG3.unmet}${result.builds[b.id].tallySolo ? `, solo ${result.builds[b.id].tallySolo.unmet}` : ''})`);
    }
    const file = path.join(out, `judge-${sem === 'v1' ? '' : `${sem}-`}${path.basename(bindFile, '.json').replace(/^bind-/, '')}.json`);
    writeJson(file, result);
    files.push(file);
  }
  return files;
}

export async function stepProse({ out, model, budget = 1, log = console.error, port: given = null }) {
  const conds = readJson(path.join(out, 'conditions-s0rule.json')).conditions;
  const labels = readJson(path.join(out, 'labels.json'));
  const file = path.join(out, `prose-${model}.json`);
  const doc = existsSync(file) ? readJson(file) : { model, builds: {}, costUsd: 0 };
  const { port, db } = given ? { port: given, db: null } : createModelPort({ journalFile: path.join(out, 'journal', `${model}.sqlite`), allowedModels: ['claude-haiku-5-5', model], maxBudgetUsdPerCall: 0.3, timeoutMs: 300_000 });
  const w = words(specText());
  let spent = 0;
  try {
    for (const b of BUILDS) {
      if (doc.builds[b.id]) continue;
      if (spent >= budget) { log(`prose: budget $${budget} reached`); break; }
      // Run health only (what the builder's own smoke loop shows); the oracle labels in labels.json are NOT passed.
      const health = Object.entries(labels[b.id].health).map(([wd, h]) => `world ${wd}: run ${h.status}; ${h.effects} effects (${Object.entries(h.byOp).map(([k, n]) => `${k} ${n}`).join(', ')}); ${h.refused} refused tick outputs${h.firstRefusal ? ` (first: ${h.firstRefusal})` : ''}`).join('\n');
      try {
        const r = await prose({ port, model, words: w, conditions: conds, build: readFileSync(path.join(ROOT, b.file), 'utf8'), practice: health, runId: `e8-prose-${b.id}`, maxTokens: 16000 });
        doc.builds[b.id] = r; spent += r.cost.usd; doc.costUsd = round(doc.costUsd + r.cost.usd);
        log(`prose ${b.id}: flagged=${r.flagged} unmet=${Object.values(r.verdicts).filter(v => v.verdict === 'unmet').length} $${r.cost.usd.toFixed(4)}`);
      } catch (error) {
        const fault = ENV_FAULTS.includes(error.details?.code ?? error.code);
        log(`prose ${b.id}: ${error.code}`);
        if (fault) { writeJson(file, doc); throw error; }
        doc.builds[b.id] = { error: error.code ?? 'ERROR', flagged: null, cost: error.cost ?? { usd: 0 } };
      }
      writeJson(file, doc);
    }
  } finally { db?.close?.(); }
  return file;
}

/** score: build-level defects caught / false alarms per arm; instance-level alarm precision against the oracle on the same runs. */
export function stepScore({ out }) {
  const labels = readJson(path.join(out, 'labels.json'));
  // Labels over the worlds the judge kept (deviation D1); a build with every world excluded is not scored.
  const judgeFiles = readdirSync(out).filter(f => /^judge-.*\.json$/.test(f));
  const excludedOf = judgeFiles.length ? readJson(path.join(out, judgeFiles[0])).excluded ?? {} : {};
  const keptWorlds = id => Object.entries(labels[id].worlds).filter(([w]) => !(excludedOf[id] ?? []).includes(w));
  const good = new Set(Object.keys(labels).filter(id => keptWorlds(id).length && keptWorlds(id).every(([, w]) => w.passed === w.completed)));
  const scored = new Set(Object.keys(labels).filter(id => keptWorlds(id).length));
  const flagsScore = flags => {
    const ids = Object.keys(flags).filter(id => flags[id] !== null && scored.has(id));
    const flagged = ids.filter(id => flags[id]);
    return { builds: ids.length, defective: ids.filter(id => !good.has(id)).length, caught: flagged.filter(id => !good.has(id)).length, falseAlarms: flagged.filter(id => good.has(id)).length,
      caughtIds: flagged.filter(id => !good.has(id)), falseAlarmIds: flagged.filter(id => good.has(id)), missedIds: ids.filter(id => !good.has(id) && !flags[id]) };
  };
  const arms = {};
  for (const f of readdirSync(out).filter(f => /^judge-.*\.json$/.test(f))) {
    const j = readJson(path.join(out, f));
    const t0 = Object.fromEntries(Object.keys(j.builds).map(id => [id, Object.entries(labels[id].health).filter(([w]) => !(j.excluded?.[id] ?? []).includes(w)).some(([, h]) => h.refused > 0 || !/complete/.test(h.status))]));
    const t2 = Object.fromEntries(Object.entries(j.builds).map(([id, b]) => [id, b.tally.unmet > 0]));
    const t2n = Object.fromEntries(Object.entries(j.builds).map(([id, b]) => [id, b.tallyNoG3.unmet > 0]));
    const t2s = Object.fromEntries(Object.entries(j.builds).filter(([, b]) => b.tallySolo).map(([id, b]) => [id, b.tallySolo.unmet > 0]));
    // Instance-level: every failing instance of an unmet condition, joined by subject to the oracle's verdict on that world.
    const inst = { onFailingCase: 0, onPassingCase: 0, unjoined: 0 };
    const perCondition = {};
    for (const [id, b] of Object.entries(j.builds)) for (const [cid, s] of Object.entries(b.t2)) {
      if (s.status !== 'unmet') continue;
      (perCondition[cid] ??= []).push(id);
      for (const e of s.evidence) {
        const world = String(e.view ?? '').split(':').pop(), l = labels[id].worlds[world];
        if (!l || !e.subject) { inst.unjoined++; continue; }
        if (l.failingSubjects.includes(e.subject)) inst.onFailingCase++; else if (l.passingSubjects.includes(e.subject)) inst.onPassingCase++; else inst.unjoined++;
      }
    }
    arms[f] = { T0: flagsScore(t0), T2: flagsScore(t2), T2noG3: flagsScore(t2n), ...(Object.keys(t2s).length ? { T2solo: flagsScore(t2s) } : {}), statuses: tally(Object.values(j.builds).flatMap(b => Object.values(b.t2))), instances: inst,
      unmetByCondition: perCondition, g3: j.g3, knownGood: [...good] };
  }
  for (const f of readdirSync(out).filter(f => /^prose-.*\.json$/.test(f))) {
    const p = readJson(path.join(out, f));
    arms[f] = { T1: flagsScore(Object.fromEntries(Object.entries(p.builds).map(([id, r]) => [id, r.flagged]))), costUsd: p.costUsd };
  }
  const doc = { scoredAt: new Date().toISOString(), knownGood: [...good], scored: [...scored], excluded: excludedOf, arms, recall: readJson(path.join(out, 'conditions-s0rule.json')).recall };
  writeJson(path.join(out, 'scores.json'), doc);
  return doc;
}

async function main() {
  const { values: a, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, model: { type: 'string' }, budget: { type: 'string' }, bind: { type: 'string' }, semantics: { type: 'string' }, sample: { type: 'string' } } });
  const out = path.resolve(a.out ?? path.join(ROOT, 'research/tracker-20261021/e8'));
  const step = positionals[0];
  if (step === 'prepare') await stepPrepare({ out });
  else if (step === 'bind') await stepBind({ out, model: a.model, budget: Number(a.budget ?? 0.5), sample: Number(a.sample ?? 0) });
  else if (step === 'judge') await stepJudge({ out, bindFile: path.resolve(a.bind), semantics: (a.semantics ?? 'v1,v2,v3').split(',') });
  else if (step === 'prose') await stepProse({ out, model: a.model, budget: Number(a.budget ?? 0.5) });
  else if (step === 'score') console.log(JSON.stringify(stepScore({ out }), null, 1));
  else throw new Error('usage: run-e8.mjs prepare|bind|judge|prose|score [--out DIR] ...');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`${error.code ?? 'ERROR'}: ${error.message}`); process.exitCode = ['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT'].includes(error.details?.code ?? error.code) ? 75 : 1; });
