#!/usr/bin/env node
// The tracker on the held-out set (research/tracker-20261021/PREREG-TRACKER-H.md). Same tracker, prompts and evaluation as the BUILDER-1
// run; new requests (by mercury-3), new hidden worlds, oracles and gold (by the analyst, before any build or tracker call). Steps, each
// writing JSON under --out (default research/tracker-20261021/heldout):
//
//   builds  --arm REF|CONTROL|B-H|B-M|B0-H    builds of the 14 requests, each run once in its hidden world and judged by the oracle
//                                             (experiments/surface/oracle.mjs); records in runs/<arm>/records/<case>[-k].json
//   capture --model claude-haiku-5-5 --samples 3   the person's words -> conditions (and the $0 rule)
//   bind    --capture FILE --model ID              conditions -> checks (vocabulary only, linted)
//   judge   --bind FILE [--semantics v1,v2,v3]     every build on practice data -> statuses (T2 with and without G3) and T0. $0
//   prose   --capture FILE --model ID              T1: one cheap-model checklist review per build
//   repair  --feedback t2|t1|none --judge J --prose P --bind B   H7 (exploratory): one B0-H repair round per build with that feedback
//   score                                          recall vs the frozen gold; caught / false alarms per arm; repair outcomes (scores.json)
//
// Paid steps take --budget (USD) or --token-cap (Mercury) and stop before passing it. Environment faults (rate or usage limits, provider
// down or timed out) are not scored: the step stops (exit 75) and a rerun resumes from the files already written.
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModelBuilder, createBuilderPort } from '../../../app/core/builder-model.mjs';
import { createModelPort } from '../../lib/models.mjs';
import { B0Builder, b0Prompt, B0_SYSTEM } from '../../surface/b0.mjs';
import { runCase } from '../../surface/run-builder-eval.mjs';
import { validateStrict } from '../../../app/core/practice.mjs';
import { practiceWorkspace, practiceViews } from '../../../app/core/tracker/practice.mjs';
import { scenarioRows } from '../../../app/core/tracker/scenarios.mjs';
import { judgeViews, crossBuild, schemasOf } from '../../../app/core/tracker/index.mjs';
import { tally } from '../../../app/core/tracker/status.mjs';
import { prose, practiceText, sheetsText, PROSE_PROMPT_ID } from '../prose.mjs';
import { wordsFor, scoreCapture, sha256 } from '../builder1.mjs';
import { stepCapture, stepBind, vocabulary } from '../run-builder1.mjs';
import { loadHeldout, slotsBuilder, controlSlots, HELDOUT_DIR, ROOT, BY_DESIGN_DEFECTIVE } from './cases.mjs';

export const ARMS = Object.freeze(['REF', 'CONTROL', 'B-H', 'B-M', 'B0-H']);
export const GOLD_FILE = path.join(HELDOUT_DIR, 'gold-heldout.json');
const ENV_FAULTS = ['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT'];
const readJson = f => JSON.parse(readFileSync(f, 'utf8'));
const writeJson = (f, v) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, `${JSON.stringify(v, null, 1)}\n`); };
const round = n => Math.round(n * 1e6) / 1e6;
const WORLDS = '/var/tmp/foundry-work/tracker-v2/heldout-worlds';

// ---------------------------------------------------------------------------------------------------------------------------------
// Builds.
/** One arm's builds of every held-out case; resumable per record. Model arms reuse BUILDER-1's builder code unchanged. */
export async function stepBuilds({ out, arm, budget = 0.5, tokenCap = 150000, cases = loadHeldout(), log = console.error }) {
  if (!ARMS.includes(arm)) throw new Error(`arm must be one of ${ARMS.join(', ')}`);
  const dir = path.join(out, 'runs', arm.toLowerCase(), 'records');
  mkdirSync(dir, { recursive: true });
  const worldsRoot = path.join(WORLDS, arm.toLowerCase());
  let port = null, db = null, tokens = () => null, builder = null;
  if (arm === 'B-H' || arm === 'B-M') {
    const model = arm === 'B-H' ? 'claude-haiku-5-5' : 'mercury-3';
    const p = await createBuilderPort({ model, journalFile: path.join(out, 'journal', `builder-${arm.toLowerCase()}.sqlite`), ...(arm === 'B-M' ? { tokenCap, callTokens: 20000 } : {}) });
    port = p.port; db = p.db; tokens = p.tokens;
    builder = new ModelBuilder({ port, model, practiceRoot: null });
  } else if (arm === 'B0-H') {
    const p = createModelPort({ journalFile: path.join(out, 'journal', 'builder-b0-h.sqlite'), allowedModels: ['claude-haiku-5-5'], maxBudgetUsdPerCall: 0.5, timeoutMs: 300000 });
    port = p.port; db = p.db;
    builder = new B0Builder({ port });
  }
  let spent = 0;
  try {
    for (const c of cases) {
      const jobs = arm === 'CONTROL' ? c.controls.map((ctl, k) => ({ file: `${c.id}-${k}.json`, builder: slotsBuilder(c, controlSlots(c, k), `control ${k}: ${ctl.why}`) }))
        : [{ file: `${c.id}.json`, builder: arm === 'REF' ? slotsBuilder(c, c.reference) : builder }];
      for (const job of jobs) {
        const f = path.join(dir, job.file);
        if (existsSync(f)) continue;
        if (spent >= budget) { log(`builds ${arm}: budget $${budget} reached`); return; }
        let rec;
        for (let attempt = 0; attempt < 3; attempt++) {
          rec = await runCase(c, { arm, builder: job.builder, worldsRoot, attempt });
          spent += rec.cost?.usd ?? 0;
          if (!rec.environmentFault) break;
          log(`builds ${arm} ${c.id}: environment fault ${rec.environmentFault} (attempt ${attempt}); not scored`);
          if (attempt === 2) { const e = new Error(`environment fault ${rec.environmentFault}`); e.code = rec.environmentFault; throw e; }
          await new Promise(r => setTimeout(r, 30000 * (attempt + 1)));
        }
        writeJson(f, rec);
        log(`builds ${arm} ${job.file}: ${rec.outcome} verified=${rec.judgement.verified} $${(rec.cost?.usd ?? 0).toFixed(4)} tok=${rec.cost?.tokens ?? 0}`);
      }
    }
  } finally { db?.close?.(); rmSync(worldsRoot, { recursive: true, force: true }); }
  writeJson(path.join(out, 'runs', arm.toLowerCase(), 'summary.json'), { arm, spentUsd: round(spent), tokenMeter: tokens() });
}

/** Every held-out build that exists and is strictly valid: { id, arm, case, workflow, verified, ... }. */
export function heldoutBuilds({ out = HELDOUT_DIR, arms = ARMS } = {}) {
  const builds = [];
  for (const arm of arms) {
    const dir = path.join(out, 'runs', arm.toLowerCase(), 'records');
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
      const r = readJson(path.join(dir, f));
      if (r.judgement?.kind !== 'fit' || r.outcome !== 'ready' || r.builtValid !== true || !r.workflow) continue;
      builds.push({ id: `${arm.toLowerCase()}/${f.replace(/\.json$/, '')}`, arm, case: r.case, workflow: r.workflow, workflowHash: sha256(JSON.stringify(r.workflow)),
        verified: r.judgement.verified === true, reasons: r.judgement.reasons ?? [], builderCostUsd: r.cost?.usd ?? 0 });
    }
  }
  return builds;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Judge ($0) and prose (T1).
const viewCache = new Map();
async function viewsOf(build, checks, practice, semantics) {
  let cached = viewCache.get(build.id);
  if (!cached) {
    const { views } = await practiceViews(build.workflow, { practice, repeat: true });
    cached = { base: views.find(v => v.id === 'base'), repeat: views.find(v => v.id === 'repeat') ?? null, targeted: new Map() };
    viewCache.set(build.id, cached);
  }
  const extra = scenarioRows(checks, cached.base, { semantics });
  const key = JSON.stringify(extra);
  let targeted = cached.targeted.get(key);
  if (targeted === undefined) {
    targeted = null;
    if (Object.values(extra).some(r => r.length)) {
      const { views } = await practiceViews(build.workflow, { practice: { ...practice, sheets: Object.fromEntries(Object.entries(practice.sheets).map(([k, rows]) => [k, [...rows, ...(extra[k] ?? [])]])) }, repeat: false });
      targeted = { ...views[0], id: 'targeted' };
    }
    cached.targeted.set(key, targeted);
  }
  return [cached.base, targeted, cached.repeat].filter(Boolean);
}

export async function stepJudge({ out, bindFile, semantics = ['v1', 'v2', 'v3'], log = console.error }) {
  const bound = readJson(bindFile);
  const practice = practiceWorkspace();
  const cases = Object.fromEntries(loadHeldout().map(c => [c.id, c]));
  const builds = heldoutBuilds({ out });
  const schemas = schemasOf(vocabulary());
  const results = Object.fromEntries(semantics.map(s => [s, { bind: path.basename(bindFile), bindSha256: sha256(readFileSync(bindFile)), semantics: s, builds: {} }]));
  const byCase = new Map();
  for (const b of builds) { if (!byCase.has(b.case)) byCase.set(b.case, []); byCase.get(b.case).push(b); }
  for (const [caseId, list] of byCase) {
    const conditions = (bound.cases[caseId] ?? []).map(c => ({ ...c, version: 1 }));
    const checks = conditions.map(c => c.check).filter(Boolean);
    const words = wordsFor(cases[caseId]);
    for (const sem of semantics) {
      const views = new Map();
      for (const b of list) views.set(b.id, await viewsOf(b, checks, practice, sem));
      const opts = { gateViews: [...views.values()].flat(), semantics: sem, words, schemas };
      const first = Object.fromEntries(list.map(b => [b.id, judgeViews(conditions, views.get(b.id), opts)]));
      const g3 = crossBuild(list.map(b => Object.fromEntries(Object.entries(first[b.id]).map(([id, s]) => [id, s.status]))));
      // The product with one build in hand: the real-shape gate sees only that build's own runs (no other build of the request).
      const solo = Object.fromEntries(list.map(b => [b.id, judgeViews(conditions, views.get(b.id), { ...opts, gateViews: views.get(b.id) })]));
      for (const b of list) {
        const withG3 = g3.size ? judgeViews(conditions, views.get(b.id), { ...opts, suspects: g3 }) : first[b.id];
        const base = views.get(b.id)[0];
        const pick = s => Object.fromEntries(Object.entries(s).map(([id, x]) => [id, { status: x.status, reason: x.reason ?? null, decided: x.decided, violated: x.violated, notActedOn: x.notActedOn,
          flags: x.flags ?? [], gate: x.gate ? { exercised: x.gate.exercised, teeth: x.gate.teeth } : null,
          evidence: (x.evidence ?? []).slice(0, 2).map(e => ({ item: e.item?.id ?? null, ok: e.ok, why: e.why, view: e.view ?? null, question: e.question, was: e.was })),
          questions: x.questions, objectWhy: x.objectWhy, closedWorld: x.closedWorld }]));
        results[sem].builds[b.id] = { case: caseId, arm: b.arm, verified: b.verified, oracleReasons: b.reasons.slice(0, 4),
          t0: { passed: base.run.passed, status: base.run.status, error: base.run.error }, views: views.get(b.id).map(v => ({ id: v.id, effects: v.effects.length, status: v.run?.status ?? null })),
          g3: [...g3], t2: pick(withG3), t2NoG3: pick(first[b.id]), t2Solo: pick(solo[b.id]),
          tally: tally(Object.values(withG3)), tallyNoG3: tally(Object.values(first[b.id])), tallySolo: tally(Object.values(solo[b.id])) };
        log(`judge ${sem} ${b.id}: oracle=${b.verified ? 'ok' : 'BAD'} T0=${base.run.passed ? 'pass' : 'FAIL'} T2 unmet=${tally(Object.values(withG3)).unmet} (noG3 ${tally(Object.values(first[b.id])).unmet}, solo ${tally(Object.values(solo[b.id])).unmet})`);
      }
    }
  }
  const tag = path.basename(bindFile, '.json').replace(/^bind-/, '');
  return semantics.map(sem => { const f = path.join(out, `judge-${sem}-${tag}.json`); writeJson(f, results[sem]); return f; });
}

export async function stepProse({ out, captureFile, model, budget = 0.5, log = console.error }) {
  const cap = readJson(captureFile);
  const tag = `${path.basename(captureFile, '.json').replace(/^capture-/, '')}__${model}`;
  const file = path.join(out, `prose-${tag}.json`);
  const doc = existsSync(file) ? readJson(file) : { capture: path.basename(captureFile), prompt: PROSE_PROMPT_ID, model, builds: {}, costUsd: 0 };
  const practice = practiceWorkspace();
  const cases = Object.fromEntries(loadHeldout().map(c => [c.id, c]));
  const { port, db } = createModelPort({ journalFile: path.join(out, 'journal', `${model}.sqlite`), allowedModels: ['claude-haiku-5-5', model], maxBudgetUsdPerCall: 0.2, timeoutMs: 240_000 });
  let spent = 0;
  try {
    for (const b of heldoutBuilds({ out })) {
      if (doc.builds[b.id]) continue;
      if (spent >= budget) { log(`prose: budget $${budget} reached`); break; }
      const conditions = cap.cases[b.case] ?? [];
      if (!conditions.length) { doc.builds[b.id] = { verdicts: {}, ready: true, flagged: false, cost: { usd: 0 }, note: 'no conditions' }; continue; }
      const { views } = await practiceViews(b.workflow, { practice, repeat: false });
      try {
        const r = await prose({ port, model, words: wordsFor(cases[b.case]), conditions, build: JSON.stringify(b.workflow), practice: practiceText(views[0]), data: sheetsText(practice.sheets), runId: `t1h-${b.id}` });
        doc.builds[b.id] = r; spent += r.cost.usd; doc.costUsd = round(doc.costUsd + r.cost.usd);
        log(`prose ${b.id}: flagged=${r.flagged} $${r.cost.usd.toFixed(4)}`);
      } catch (error) {
        const fault = ENV_FAULTS.includes(error.details?.code ?? error.code);
        log(`prose ${b.id}: ${error.code} ${fault ? '(environment fault: stop, not scored)' : ''}`);
        if (fault) { writeJson(file, doc); throw error; }
        doc.builds[b.id] = { error: error.code ?? 'ERROR', flagged: null, cost: error.cost ?? { usd: 0 } };
      }
      writeJson(file, doc);
    }
  } finally { db?.close?.(); }
  return file;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Repair (PREREG-TRACKER-H §5 H7, exploratory): the tracker's findings given back to the builder. Each B0-H build gets ONE repair round
// from the same one-shot writer (prompt b0-one-shot/1 plus its own workflow plus feedback), is strictly validated, run once in its hidden
// world and judged by the oracle. Feedback arms:
//   t2    the conditions T2solo (v3, capture s0's binding) found unmet, each with its quote and first evidence (flagged builds only)
//   t1    the conditions the prose checklist (T1, capture s0) ticked unmet, each with its summary and why (flagged builds only)
//   none  no finding: "check that it does everything the person asked and fix what it misses" (every B0-H build; self-review)
export const REPAIR_FEEDBACK = Object.freeze(['t2', 't1', 'none']);
export function repairFeedback(kind, { judge = null, proseDoc = null, bind = null, buildId, caseId }) {
  if (kind === 'none') return 'Before it runs for real, check that it does everything the person asked, and nothing they would not want. Fix whatever it misses.';
  if (kind === 't2') {
    const b = judge?.builds?.[buildId];
    const unmet = Object.entries(b?.t2Solo ?? {}).filter(([, s]) => s.status === 'unmet');
    if (!unmet.length) return null;
    const conds = Object.fromEntries((bind?.cases?.[caseId] ?? []).map(c => [c.id, c]));
    return `When it ran on practice data, these of the person's conditions were not met:\n${unmet.map(([id, s]) => `- "${conds[id]?.quote ?? id}": ${s.evidence?.[0]?.why ?? 'not met'}`).join('\n')}\nFix the workflow so it meets them.`;
  }
  const r = proseDoc?.builds?.[buildId];
  const unmet = Object.entries(r?.verdicts ?? {}).filter(([, v]) => v.verdict === 'unmet');
  if (!r?.flagged || !unmet.length) return null;
  return `A reviewer checked it against the person's conditions and found these not met:\n${unmet.map(([id, v]) => `- ${id}: ${v.why}`).join('\n')}\nFix the workflow so it meets them.`;
}

export async function stepRepair({ out, feedback, judgeFile, proseFile, bindFile, budget = 0.2, cases = loadHeldout(), log = console.error }) {
  if (!REPAIR_FEEDBACK.includes(feedback)) throw new Error(`feedback must be one of ${REPAIR_FEEDBACK.join(', ')}`);
  const judge = judgeFile && existsSync(judgeFile) ? readJson(judgeFile) : null, proseDoc = proseFile && existsSync(proseFile) ? readJson(proseFile) : null, bind = bindFile && existsSync(bindFile) ? readJson(bindFile) : null;
  const dir = path.join(out, 'runs', `repair-${feedback}`, 'records');
  mkdirSync(dir, { recursive: true });
  const worldsRoot = path.join(WORLDS, `repair-${feedback}`);
  const { port, db } = createModelPort({ journalFile: path.join(out, 'journal', 'builder-b0-h-repair.sqlite'), allowedModels: ['claude-haiku-5-5'], maxBudgetUsdPerCall: 0.5, timeoutMs: 300000 });
  const byCase = Object.fromEntries(cases.map(c => [c.id, c]));
  let spent = 0;
  try {
    for (const b of heldoutBuilds({ out, arms: ['B0-H'] })) {
      const f = path.join(dir, `${b.case}.json`);
      if (existsSync(f)) continue;
      const text = repairFeedback(feedback, { judge, proseDoc, bind, buildId: b.id, caseId: b.case });
      if (!text) continue;
      if (spent >= budget) { log(`repair ${feedback}: budget $${budget} reached`); break; }
      const c = byCase[b.case];
      const original = readJson(path.join(out, 'runs', 'b0-h', 'records', `${b.case}.json`));
      const builder = { id: `b0-repair-${feedback}`, async: true, build: async () => {
        const prompt = `${b0Prompt({ request: c.request, answers: original.answers ?? {} })}\n\nYour workflow:\n${JSON.stringify(b.workflow)}\n\n${text}\n\nReturn the corrected workflow with decision build.`;
        const calls = [];
        let value = null, usd = 0;
        for (let attempt = 0; attempt <= 2 && !value; attempt++) {
          const r = await port.call({ runId: `t2h-repair-${feedback}-${b.case}`, nodeKey: 'repair', attempt, modelId: 'claude-haiku-5-5', system: B0_SYSTEM, prompt, schema: B0_REPAIR_SCHEMA, decoding: { maxTokens: 16000 } })
            .catch(error => ({ ok: false, error: { code: error.code ?? 'ERROR', message: error.message } }));
          usd += r.costUsd ?? 0; calls.push({ attempt, ok: !!r.ok, error: r.ok ? null : r.error?.code ?? null, costUsd: r.costUsd ?? 0, inputTokens: r.usage?.inputTokens ?? 0, outputTokens: r.usage?.outputTokens ?? 0 });
          if (r.ok) value = r.value;
          else if (r.error?.code !== 'MODEL_SCHEMA') { const e = new Error(`repair: ${r.error?.code}`); e.code = r.error?.code; e.buildReport = { costUsd: usd, callLog: calls, calls: calls.length, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, repairs: [], practiceRuns: [] }; throw e; }
        }
        const report = { costUsd: usd, callLog: calls, calls: calls.length, inputTokens: calls.reduce((s, x) => s + x.inputTokens, 0), outputTokens: calls.reduce((s, x) => s + x.outputTokens, 0), cacheReadTokens: 0, cacheWriteTokens: 0, repairs: [{ kind: feedback, feedback: text }], practiceRuns: [] };
        const workflow = value?.workflow ?? {};
        if (!value || value.decision !== 'build' || !validateStrict(workflow).valid) return { status: 'build_failed', builder: `b0-repair-${feedback}`, workflow, buildReport: report };
        return { status: 'ready', builder: `b0-repair-${feedback}`, template: null, workflow, buildReport: report };
      } };
      const rec = await runCase(c, { arm: `B0-H+repair-${feedback}`, builder, worldsRoot });
      if (rec.environmentFault) { const e = new Error(`environment fault ${rec.environmentFault}`); e.code = rec.environmentFault; throw e; }
      rec.repairOf = { build: b.id, verifiedBefore: b.verified, feedback: text };
      spent += rec.cost?.usd ?? 0;
      writeJson(f, rec);
      log(`repair ${feedback} ${b.case}: before verified=${b.verified} after verified=${rec.judgement.verified} (${rec.outcome}) $${(rec.cost?.usd ?? 0).toFixed(4)}`);
    }
  } finally { db?.close?.(); rmSync(worldsRoot, { recursive: true, force: true }); }
}
const B0_REPAIR_SCHEMA = { type: 'object', additionalProperties: false, required: ['decision', 'reason', 'questions', 'workflow'], properties: {
  decision: { type: 'string', enum: ['build', 'ask', 'none'] }, reason: { type: 'string' },
  questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'question'], properties: { id: { type: 'string' }, question: { type: 'string' } } } },
  workflow: { type: 'object' } } };

/** Repair outcomes per feedback arm: builds repaired, fixed (defective → verified), broken (verified → not), unchanged. */
export function repairScore({ out }) {
  const res = {};
  for (const kind of REPAIR_FEEDBACK) {
    const dir = path.join(out, 'runs', `repair-${kind}`, 'records');
    if (!existsSync(dir)) continue;
    const recs = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => readJson(path.join(dir, f)));
    const after = r => r.judgement?.verified === true;
    res[kind] = { repaired: recs.length, fixed: recs.filter(r => !r.repairOf.verifiedBefore && after(r)).map(r => r.case), broken: recs.filter(r => r.repairOf.verifiedBefore && !after(r)).map(r => r.case),
      stillDefective: recs.filter(r => !r.repairOf.verifiedBefore && !after(r)).map(r => r.case), stillVerified: recs.filter(r => r.repairOf.verifiedBefore && after(r)).map(r => r.case),
      costUsd: round(recs.reduce((s, r) => s + (r.cost?.usd ?? 0), 0)) };
  }
  return res;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Score.
export function stepScore({ out }) {
  const gold = readJson(GOLD_FILE);
  const cases = loadHeldout();
  const files = readdirSync(out);
  const recall = {};
  for (const f of files.filter(f => /^capture-.*\.json$/.test(f))) {
    const cap = readJson(path.join(out, f));
    let covered = 0, total = 0, testable = 0, testableCovered = 0, captured = 0;
    const missed = [];
    for (const c of cases) {
      const s = scoreCapture(cap.cases[c.id] ?? [], gold.cases[c.id], wordsFor(c));
      covered += s.covered; total += s.gold; testable += s.testableGold; testableCovered += s.testableCovered; captured += s.captured;
      for (const r of s.rows) if (!r.covered) missed.push(r.id);
    }
    recall[f] = { recall: covered / total, covered, total, testableRecall: testableCovered / testable, captured, missed, costUsd: cap.costUsd ?? 0 };
  }
  const builds = heldoutBuilds({ out });
  const defective = new Set(builds.filter(b => !b.verified).map(b => b.id));
  const armScore = (flags, subset = null) => {
    const ids = Object.keys(flags).filter(id => flags[id] !== null && flags[id] !== undefined && (!subset || subset(id)));
    const flagged = ids.filter(id => flags[id] === true);
    const caught = flagged.filter(id => defective.has(id)), fa = flagged.filter(id => !defective.has(id));
    return { builds: ids.length, defective: ids.filter(id => defective.has(id)).length, good: ids.filter(id => !defective.has(id)).length, caught: caught.length, falseAlarms: fa.length,
      precision: flagged.length ? caught.length / flagged.length : null, caughtIds: caught, falseAlarmIds: fa, missedIds: ids.filter(id => defective.has(id) && !flags[id]) };
  };
  const arms = {};
  const modelBuilt = id => /^(b-h|b-m|b0-h)\//.test(id);
  for (const f of files.filter(f => /^judge-.*\.json$/.test(f))) {
    const j = readJson(path.join(out, f));
    const t0 = {}, t2 = {}, t2n = {}, t2s = {}, both = {}, bothSolo = {};
    for (const [id, b] of Object.entries(j.builds)) {
      t0[id] = !b.t0.passed; t2[id] = b.tally.unmet > 0; t2n[id] = b.tallyNoG3.unmet > 0; t2s[id] = b.tallySolo.unmet > 0; both[id] = t0[id] || t2[id]; bothSolo[id] = t0[id] || t2s[id];
    }
    arms[f] = { T0: armScore(t0), T2: armScore(t2), T2noG3: armScore(t2n), T2solo: armScore(t2s), 'T0+T2': armScore(both), 'T0+T2solo': armScore(bothSolo),
      T2modelBuilt: armScore(t2, modelBuilt), T2soloModelBuilt: armScore(t2s, modelBuilt), statuses: tally(Object.values(j.builds).flatMap(b => Object.values(b.t2))),
      statusesSolo: tally(Object.values(j.builds).flatMap(b => Object.values(b.t2Solo))) };
  }
  for (const f of files.filter(f => /^prose-.*\.json$/.test(f))) {
    const p = readJson(path.join(out, f));
    const flags = Object.fromEntries(Object.entries(p.builds).map(([id, r]) => [id, r.flagged]));
    arms[f] = { T1: armScore(flags), T1modelBuilt: armScore(flags, modelBuilt), costUsd: p.costUsd, perBuildUsd: p.costUsd / Math.max(1, Object.keys(p.builds).length) };
  }
  const doc = { scoredAt: new Date().toISOString(), builds: builds.length, defective: defective.size, byDesignDefective: BY_DESIGN_DEFECTIVE, byArm: Object.fromEntries(ARMS.map(a => [a, { builds: builds.filter(b => b.arm === a).length, defective: builds.filter(b => b.arm === a && !b.verified).length }])), recall, arms, repair: repairScore({ out }) };
  writeJson(path.join(out, 'scores.json'), doc);
  return doc;
}

async function main() {
  const { values: a, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, arm: { type: 'string' }, model: { type: 'string' }, samples: { type: 'string' },
    budget: { type: 'string' }, 'token-cap': { type: 'string' }, capture: { type: 'string' }, bind: { type: 'string' }, semantics: { type: 'string' },
    feedback: { type: 'string' }, judge: { type: 'string' }, prose: { type: 'string' } } });
  const out = path.resolve(a.out ?? HELDOUT_DIR);
  const step = positionals[0];
  const cases = loadHeldout();
  if (step === 'builds') await stepBuilds({ out, arm: a.arm, budget: Number(a.budget ?? 0.5), tokenCap: Number(a['token-cap'] ?? 150000) });
  else if (step === 'capture') await stepCapture({ out, model: a.model ?? null, samples: Number(a.samples ?? 3), budget: Number(a.budget ?? 0.2), cases });
  else if (step === 'bind') await stepBind({ out, captureFile: path.resolve(a.capture), model: a.model, budget: Number(a.budget ?? 0.3), tokenCap: a['token-cap'] ? Number(a['token-cap']) : null, cases });
  else if (step === 'judge') await stepJudge({ out, bindFile: path.resolve(a.bind), semantics: (a.semantics ?? 'v1,v2,v3').split(',') });
  else if (step === 'prose') await stepProse({ out, captureFile: path.resolve(a.capture), model: a.model, budget: Number(a.budget ?? 0.5) });
  else if (step === 'repair') await stepRepair({ out, feedback: a.feedback, judgeFile: a.judge ? path.resolve(a.judge) : null, proseFile: a.prose ? path.resolve(a.prose) : null, bindFile: a.bind ? path.resolve(a.bind) : null, budget: Number(a.budget ?? 0.2) });
  else if (step === 'score') console.log(JSON.stringify(stepScore({ out }), null, 1));
  else throw new Error('usage: run-heldout.mjs builds|capture|bind|judge|prose|repair|score [--out DIR] ...');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`${error.code ?? 'ERROR'}: ${error.message}`); process.exitCode = ENV_FAULTS.includes(error.details?.code ?? error.code) ? 75 : 1; });
