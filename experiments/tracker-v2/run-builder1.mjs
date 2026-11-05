#!/usr/bin/env node
// The tracker on BUILDER-1 (research/tracker-20261021/PREREG-TRACKER.md). Steps, each writing JSON under --out:
//
//   capture   --model claude-haiku-5-5 --samples 3      the person's words of all 24 cases -> conditions (and the $0 rule, no model)
//   bind      --capture capture-<model>-s<k>.json       conditions of the 21 fit cases -> checks (vocabulary only, linted)
//   judge     --bind bind-...json                        every archived build (101) on practice data -> status per condition (T2) and
//                                                         its own practice verdict (T0). $0.
//   prose     --capture capture-...json                  T1: one cheap-model checklist review per build
//   score     (reads the directory)                      capture recall vs the frozen gold; defects caught and false alarms per arm
//
// Paid steps take --budget (USD, Haiku) or --token-cap (Mercury) and stop before a call that would pass it. Environment faults
// (rate or usage limits, provider down) are not scored: the step stops, and a rerun resumes from the files already written.
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelPort } from '../lib/models.mjs';
import { capture, captureRule, bind, CAPTURE_PROMPT_ID, BIND_PROMPT_ID } from '../../app/core/tracker/model.mjs';
import { appVocabulary } from '../../app/core/tracker/vocab.mjs';
import { practiceWorkspace, practiceViews } from '../../app/core/tracker/practice.mjs';
import { scenarioRows } from '../../app/core/tracker/scenarios.mjs';
import { judgeViews, crossBuild, schemasOf } from '../../app/core/tracker/index.mjs';
import { tally } from '../../app/core/tracker/status.mjs';
import { dataCatalog } from '../surface/b0.mjs';
import { prose, practiceText, sheetsText, PROSE_PROMPT_ID } from './prose.mjs';
import { loadCases, wordsFor, archivedBuilds, scoreCapture, GOLD_FILE, ROOT, sha256 } from './builder1.mjs';

const ENV_FAULTS = ['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT'];
const readJson = f => JSON.parse(readFileSync(f, 'utf8'));
const writeJson = (f, v) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, `${JSON.stringify(v, null, 1)}\n`); };
const round = n => Math.round(n * 1e6) / 1e6;
export const vocabulary = () => appVocabulary({ catalog: dataCatalog(), sheets: practiceWorkspace().sheets });

function portFor({ model, out, tokenCap = null }) {
  const remote = /^mercury/.test(model);
  return createModelPort({ journalFile: path.join(out, 'journal', `${model}.sqlite`), allowedModels: [...new Set(['claude-haiku-5-5', model])], maxBudgetUsdPerCall: 0.2, timeoutMs: 240_000,
    ...(remote ? { tokenCap, callTokens: 30_000 } : {}) });
}
const faultOf = e => (ENV_FAULTS.includes(e?.details?.code ?? e?.code) ? (e.details?.code ?? e.code) : null);

/** capture: one file per sample; resumable per case. */
export async function stepCapture({ out, model, samples = 3, budget = 1, cases = loadCases(), log = console.error, port: given = null }) {
  const rule = Object.fromEntries(cases.map(c => [c.id, captureRule(wordsFor(c)).map((x, i) => ({ id: `C-${String(i + 1).padStart(3, '0')}`, ...x }))]));
  writeJson(path.join(out, 'capture-rule.json'), { method: 'rule', prompt: null, model: null, cases: rule, costUsd: 0 });
  if (!model) return;
  const { port, db } = given ? { port: given, db: null } : portFor({ model, out });
  let spent = 0;
  try {
    for (let s = 0; s < samples; s++) {
      const file = path.join(out, `capture-${model}-s${s}.json`);
      const doc = existsSync(file) ? readJson(file) : { method: 'model', prompt: CAPTURE_PROMPT_ID, model, sample: s, cases: {}, dropped: {}, calls: [], costUsd: 0 };
      for (const c of cases) {
        if (doc.cases[c.id]) continue;
        if (spent >= budget) { log(`capture: budget $${budget} reached`); writeJson(file, doc); return; }
        const calls = [];
        try {
          const r = await capture({ port, model, words: wordsFor(c), runId: `t2-capture-${c.id}-s${s}`, log: x => calls.push(x) });
          doc.cases[c.id] = r.conditions.map((x, i) => ({ id: `C-${String(i + 1).padStart(3, '0')}`, ...x }));
          doc.dropped[c.id] = r.dropped;
        } catch (error) {
          const fault = faultOf(error);
          log(`capture ${c.id} s${s}: ${error.code} ${fault ? '(environment fault: stop, not scored)' : ''} ${String(error.message).slice(0, 200)}`);
          if (fault) { writeJson(file, doc); throw error; }
          doc.cases[c.id] = []; doc.dropped[c.id] = [{ error: error.code ?? 'ERROR' }];
        }
        const usd = calls.reduce((a, x) => a + x.costUsd, 0);
        spent += usd; doc.costUsd = round(doc.costUsd + usd); doc.calls.push(...calls.map(x => ({ case: c.id, ...x })));
        log(`capture ${model} s${s} ${c.id}: ${doc.cases[c.id].length} conditions, $${usd.toFixed(4)}`);
        writeJson(file, doc);
      }
    }
  } finally { db?.close?.(); }
}

/** bind: checks for the conditions of one capture file (fit cases only; the none cases have no build to check). */
export async function stepBind({ out, captureFile, model, budget = 1, tokenCap = null, cases = loadCases(), log = console.error, port: given = null }) {
  const cap = readJson(captureFile);
  const tag = `${path.basename(captureFile, '.json').replace(/^capture-/, '')}__${model}`;
  const file = path.join(out, `bind-${tag}.json`);
  const doc = existsSync(file) ? readJson(file) : { capture: path.basename(captureFile), captureSha256: sha256(readFileSync(captureFile)), prompt: BIND_PROMPT_ID, model, cases: {}, calls: [], costUsd: 0, tokens: 0 };
  const vocab = vocabulary();
  const { port, db, tokens } = given ? { port: given, db: null, tokens: null } : portFor({ model, out, tokenCap });
  let spent = 0;
  try {
    for (const c of cases.filter(c => c.template !== 'none')) {
      if (doc.cases[c.id]) continue;
      if (spent >= budget) { log(`bind: budget $${budget} reached`); break; }
      const conds = cap.cases[c.id] ?? [];
      const toBind = conds.filter(x => x.verification === 'test');
      const calls = [];
      let result = new Map();
      try { if (toBind.length) result = await bind({ port, model, vocab, words: wordsFor(c), conditions: toBind, runId: `t2-bind-${c.id}-${tag}`, log: x => calls.push(x) }); }
      catch (error) {
        const fault = faultOf(error);
        log(`bind ${c.id}: ${error.code} ${fault ? '(environment fault: stop, not scored)' : ''} ${String(error.message).slice(0, 200)}`);
        if (fault) { writeJson(file, doc); throw error; }
        result = new Map(toBind.map(x => [x.id, { decision: 'error', why: error.code ?? 'ERROR', lint: [] }]));
      }
      doc.cases[c.id] = conds.map(x => {
        if (x.verification !== 'test') return { ...x, binding: { decision: 'capture-inspection' } };
        const b = result.get(x.id) ?? { decision: 'missing' };
        const next = { ...x, binding: { decision: b.decision, why: b.why ?? null, question: b.question ?? null, lint: b.lint ?? [], retried: !!b.retried, dropped: b.dropped ?? null } };
        if (b.decision === 'check' && b.check) Object.assign(next, { check: b.check });
        else if (b.decision === 'inspection' || b.decision === 'not-a-condition') Object.assign(next, { verification: 'inspection', why: b.why ?? b.decision });
        else if (b.decision === 'needs-answer') Object.assign(next, { missing: [b.question ?? 'a detail is missing'] });
        return next;
      });
      const usd = calls.reduce((a, x) => a + x.costUsd, 0), tok = calls.reduce((a, x) => a + x.inputTokens + x.outputTokens + x.cacheReadTokens + x.cacheWriteTokens, 0);
      spent += usd; doc.costUsd = round(doc.costUsd + usd); doc.tokens += tok; doc.calls.push(...calls.map(x => ({ case: c.id, ...x })));
      log(`bind ${model} ${c.id}: ${doc.cases[c.id].filter(x => x.check).length}/${conds.length} checks, $${usd.toFixed(4)} ${tok} tok`);
      writeJson(file, doc);
    }
  } finally { db?.close?.(); }
  doc.tokenMeter = tokens?.() ?? null;
  writeJson(file, doc);
  return file;
}

// Practice views per build: base and repeat do not depend on the checks (cached per process); targeted does.
const viewCache = new Map();
/** Practice views of one build: base and repeat are shared; the targeted view depends on the checks and the semantics' scenario rule. */
async function viewsOf(build, checks, practice, semantics = 'v1') {
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

/**
 * judge: T2 statuses (with and without G3) and T0 for every archived build, from one bind file. $0. One pass runs every build's practice
 * views once and judges them under each semantics: 'v1' (frozen, PREREG-TRACKER) writes judge-<tag>.json, 'v2' (deviation D2,
 * app/core/tracker/semantics.mjs) judge-v2-<tag>.json, 'v3' (D2 + D3) judge-v3-<tag>.json.
 */
export async function stepJudge({ out, bindFile, log = console.error, only = null, semantics = ['v1', 'v2', 'v3'] }) {
  const bound = readJson(bindFile);
  const practice = practiceWorkspace();
  const cases = Object.fromEntries(loadCases().map(c => [c.id, c]));
  const builds = archivedBuilds().filter(b => !only || only.includes(b.case));
  const schemas = schemasOf(vocabulary());   // v3 R-objects+: each sheet's columns from the data catalog and the practice sheets
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
      const gateViews = [...views.values()].flat();
      const opts = { gateViews, semantics: sem, words, schemas };
      const first = Object.fromEntries(list.map(b => [b.id, judgeViews(conditions, views.get(b.id), opts)]));
      const g3 = crossBuild(list.map(b => Object.fromEntries(Object.entries(first[b.id]).map(([id, s]) => [id, s.status]))));
      // D3: the product with one build in hand (t2Solo): the real-shape gate sees only this build's own runs, and there is no G3.
      const solo = Object.fromEntries(list.map(b => [b.id, judgeViews(conditions, views.get(b.id), { ...opts, gateViews: views.get(b.id) })]));
      for (const b of list) {
        const noG3 = first[b.id];
        const withG3 = g3.size ? judgeViews(conditions, views.get(b.id), { ...opts, suspects: g3 }) : noG3;
        const base = views.get(b.id)[0];
        const pick = s => Object.fromEntries(Object.entries(s).map(([id, x]) => [id, { status: x.status, reason: x.reason ?? null, decided: x.decided, violated: x.violated, notActedOn: x.notActedOn,
          flags: x.flags ?? [], gate: x.gate ? { exercised: x.gate.exercised, teeth: x.gate.teeth } : null,
          evidence: (x.evidence ?? []).slice(0, 2).map(e => ({ item: e.item?.id ?? null, ok: e.ok, why: e.why, view: e.view ?? null, question: e.question, was: e.was })),
          questions: x.questions, objectWhy: x.objectWhy, closedWorld: x.closedWorld }]));
        results[sem].builds[b.id] = { case: caseId, arm: b.arm, verified: b.verified, runPassedHidden: b.runPassed, oracleReasons: b.reasons.slice(0, 4), trapViolated: b.trapViolated,
          t0: { passed: base.run.passed, status: base.run.status, error: base.run.error }, views: views.get(b.id).map(v => ({ id: v.id, effects: v.effects.length, status: v.run?.status ?? null })),
          g3: [...g3], t2: pick(withG3), t2NoG3: pick(noG3), tally: tally(Object.values(withG3)), tallyNoG3: tally(Object.values(noG3)),
          ...(sem === 'v1' ? {} : { t2Solo: pick(solo[b.id]), tallySolo: tally(Object.values(solo[b.id])) }) };
        log(`judge ${sem} ${b.id}: oracle=${b.verified ? 'ok' : 'BAD'} T0=${base.run.passed ? 'pass' : 'FAIL'} T2 unmet=${tally(Object.values(withG3)).unmet} (noG3 ${tally(Object.values(noG3)).unmet})`);
      }
    }
  }
  const tag = path.basename(bindFile, '.json').replace(/^bind-/, '');
  const files = semantics.map(sem => {
    const { semantics: _s, ...doc } = results[sem];
    const file = path.join(out, `judge-${sem === 'v1' ? '' : `${sem}-`}${tag}.json`);
    writeJson(file, sem === 'v1' ? doc : results[sem]);   // the v1 file keeps the frozen layout exactly
    return file;
  });
  return files;
}

/** prose: T1 per build (BUILDER-1), from a capture file's conditions. */
export async function stepProse({ out, captureFile, model, budget = 1, log = console.error, port: given = null, only = null }) {
  const cap = readJson(captureFile);
  const tag = `${path.basename(captureFile, '.json').replace(/^capture-/, '')}__${model}`;
  const file = path.join(out, `prose-${tag}.json`);
  const doc = existsSync(file) ? readJson(file) : { capture: path.basename(captureFile), prompt: PROSE_PROMPT_ID, model, builds: {}, costUsd: 0 };
  const practice = practiceWorkspace();
  const cases = Object.fromEntries(loadCases().map(c => [c.id, c]));
  const { port, db } = given ? { port: given, db: null } : portFor({ model, out });
  let spent = 0;
  try {
    for (const b of archivedBuilds().filter(b => !only || only.includes(b.case))) {
      if (doc.builds[b.id]) continue;
      if (spent >= budget) { log(`prose: budget $${budget} reached`); break; }
      const conditions = cap.cases[b.case] ?? [];
      if (!conditions.length) { doc.builds[b.id] = { verdicts: {}, ready: true, flagged: false, cost: { usd: 0 }, note: 'no conditions' }; continue; }
      let base = viewCache.get(b.id)?.base;
      if (!base) { const { views } = await practiceViews(b.workflow, { practice, repeat: false }); base = views[0]; }
      try {
        const r = await prose({ port, model, words: wordsFor(cases[b.case]), conditions, build: JSON.stringify(b.workflow), practice: practiceText(base), data: sheetsText(practice.sheets), runId: `t1-${b.id}` });
        doc.builds[b.id] = r; spent += r.cost.usd; doc.costUsd = round(doc.costUsd + r.cost.usd);
        log(`prose ${b.id}: flagged=${r.flagged} $${r.cost.usd.toFixed(4)}`);
      } catch (error) {
        const fault = faultOf(error);
        log(`prose ${b.id}: ${error.code} ${fault ? '(environment fault: stop, not scored)' : ''}`);
        if (fault) { writeJson(file, doc); throw error; }
        doc.builds[b.id] = { error: error.code ?? 'ERROR', flagged: null, cost: error.cost ?? { usd: 0 } };
        spent += error.cost?.usd ?? 0; doc.costUsd = round(doc.costUsd + (error.cost?.usd ?? 0));
      }
      writeJson(file, doc);
    }
  } finally { db?.close?.(); }
  return file;
}

/** score: capture recall per capture file; defects caught / false alarms per arm per judge and prose file. */
export function stepScore({ out, only = null }) {
  const gold = readJson(GOLD_FILE);
  const cases = loadCases();
  const files = readdirSync(out);
  const recall = {};
  for (const f of files.filter(f => /^capture-.*\.json$/.test(f))) {
    const cap = readJson(path.join(out, f));
    let covered = 0, total = 0, testable = 0, testableCovered = 0, captured = 0, agree = 0, agreeN = 0;
    const missed = [];
    for (const c of cases.filter(c => !only || only.includes(c.id))) {
      const s = scoreCapture(cap.cases[c.id] ?? [], gold.cases[c.id], wordsFor(c));
      covered += s.covered; total += s.gold; testable += s.testableGold; testableCovered += s.testableCovered; captured += s.captured;
      for (const r of s.rows) { if (!r.covered) missed.push(r.id); if (r.verificationAgrees !== null) { agreeN++; if (r.verificationAgrees) agree++; } }
    }
    recall[f] = { recall: covered / total, covered, total, testableRecall: testableCovered / testable, captured, verificationAgreement: agreeN ? agree / agreeN : null, missed, costUsd: cap.costUsd ?? 0 };
  }
  const arms = {};
  const builds = archivedBuilds().filter(b => !only || only.includes(b.case));
  const defective = new Set(builds.filter(b => !b.verified).map(b => b.id));
  const armScore = flags => {
    const flagged = Object.entries(flags).filter(([, f]) => f === true).map(([id]) => id);
    const known = Object.entries(flags).filter(([, f]) => f !== null);
    return { builds: known.length, defective: [...defective].filter(id => flags[id] !== null && flags[id] !== undefined).length,
      caught: flagged.filter(id => defective.has(id)).length, falseAlarms: flagged.filter(id => !defective.has(id)).length,
      precision: flagged.length ? flagged.filter(id => defective.has(id)).length / flagged.length : null,
      caughtIds: flagged.filter(id => defective.has(id)), falseAlarmIds: flagged.filter(id => !defective.has(id)), missedIds: [...defective].filter(id => flags[id] === false) };
  };
  for (const f of files.filter(f => /^judge-.*\.json$/.test(f))) {
    const j = readJson(path.join(out, f));
    const t0 = {}, t2 = {}, t2n = {}, both = {};
    for (const [id, b] of Object.entries(j.builds)) {
      t0[id] = !b.t0.passed; t2[id] = b.tally.unmet > 0; t2n[id] = b.tallyNoG3.unmet > 0; both[id] = t0[id] || t2[id];
    }
    const statuses = Object.values(j.builds).flatMap(b => Object.values(b.t2));
    arms[f] = { T0: armScore(t0), T2: armScore(t2), T2noG3: armScore(t2n), 'T0+T2': armScore(both),
      statuses: tally(statuses), conditionsPerBuild: statuses.length / Object.keys(j.builds).length };
  }
  for (const f of files.filter(f => /^prose-.*\.json$/.test(f))) {
    const p = readJson(path.join(out, f));
    arms[f] = { T1: armScore(Object.fromEntries(Object.entries(p.builds).map(([id, r]) => [id, r.flagged]))), costUsd: p.costUsd, perBuildUsd: p.costUsd / Math.max(1, Object.keys(p.builds).length) };
  }
  const doc = { scoredAt: new Date().toISOString(), defective: defective.size, builds: builds.length, recall, arms };
  writeJson(path.join(out, 'scores.json'), doc);
  return doc;
}

async function main() {
  const { values: a, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, model: { type: 'string' }, samples: { type: 'string' }, budget: { type: 'string' },
    'token-cap': { type: 'string' }, capture: { type: 'string' }, bind: { type: 'string' }, semantics: { type: 'string' } } });
  const out = path.resolve(a.out ?? path.join(ROOT, 'research/tracker-20261021/builder1'));
  const step = positionals[0];
  if (step === 'capture') await stepCapture({ out, model: a.model ?? null, samples: Number(a.samples ?? 3), budget: Number(a.budget ?? 1) });
  else if (step === 'bind') await stepBind({ out, captureFile: path.resolve(a.capture), model: a.model, budget: Number(a.budget ?? 1), tokenCap: a['token-cap'] ? Number(a['token-cap']) : null });
  else if (step === 'judge') await stepJudge({ out, bindFile: path.resolve(a.bind), semantics: (a.semantics ?? 'v1,v2,v3').split(',') });
  else if (step === 'prose') await stepProse({ out, captureFile: path.resolve(a.capture), model: a.model, budget: Number(a.budget ?? 1) });
  else if (step === 'score') console.log(JSON.stringify(stepScore({ out }), null, 1));
  else throw new Error('usage: run-builder1.mjs capture|bind|judge|prose|score [--out DIR] ...');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`${error.code ?? 'ERROR'}: ${error.message}`); process.exitCode = ['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT'].includes(error.details?.code ?? error.code) ? 75 : 1; });
