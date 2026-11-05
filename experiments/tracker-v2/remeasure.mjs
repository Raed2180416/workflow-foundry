#!/usr/bin/env node
// PREREG-TRACKER-H2 (research/tracker-20261021/PREREG-TRACKER-H2.md): the corrected re-measure on the opened held-out set. Outputs
// under research/tracker-20261021/heldout/h2/ (B0-H2 records under heldout/runs/b0-h2/records, beside the other arms). Steps:
//
//   builds                         B0-H again through the identity-isolated provider (paid, Haiku; --budget)
//   conversations                  each model build's own words; distinct conversations other than the key's ($0)
//   capture --samples 3            own-words captures of those conversations (paid; --budget)
//   bind --sample sK               own-words bind of capture sK (paid; --budget)
//   prose --k K                    T1 sample K on each build's own words, capture s0's list (paid; --budget; concurrency 3)
//   judge --setting key|own --sample sK [--semantics v3,v4] [--arms ...]   T2solo per build (+ G3 over the model pool, key) ($0)
//   repair --feedback t2|t1|none   H7 on B0-H2 (paid; --budget)
//   score                          the settings orig-key, corr-key, corr-own; H1-H5 per setting; T-lit; H7 (scores-h2.json)
//
// Paid steps stop before passing --budget. Environment faults (rate or usage limits, provider down or timed out) stop the step with
// exit 75 and are never scored; a rerun resumes from the files already written.
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelPort } from '../lib/models.mjs';
import { B0Builder, b0Prompt, B0_SYSTEM } from '../surface/b0.mjs';
import { runCase } from '../surface/run-builder-eval.mjs';
import { validateStrict } from '../../app/core/practice.mjs';
import { practiceWorkspace, practiceViews } from '../../app/core/tracker/practice.mjs';
import { scenarioRows } from '../../app/core/tracker/scenarios.mjs';
import { judgeViews, crossBuild, schemasOf } from '../../app/core/tracker/index.mjs';
import { tally } from '../../app/core/tracker/status.mjs';
import { prose, practiceText, sheetsText } from './prose.mjs';
import { wordsFor, sha256, scoreCapture } from './builder1.mjs';
import { stepCapture, stepBind, vocabulary } from './run-builder1.mjs';
import { heldoutBuilds, repairFeedback, REPAIR_FEEDBACK } from './heldout/run-heldout.mjs';
import { loadHeldout, HELDOUT_DIR } from './heldout/cases.mjs';
import { identityHashes, findIdentities } from '../../scripts/identity-scan.mjs';

export const OUT = HELDOUT_DIR;
export const H2 = path.join(OUT, 'h2');
export const OWN = path.join(H2, 'own-words');
const H = 'claude-haiku-5-5';
const WORLDS = '/var/tmp/foundry-work/tracker-v2/heldout-worlds';
const ENV_FAULTS = ['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT'];
const readJson = f => JSON.parse(readFileSync(f, 'utf8'));
const writeJson = (f, v) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, `${JSON.stringify(v, null, 1)}\n`); };
const round = n => Math.round(n * 1e6) / 1e6;
export const MODEL_ARMS = Object.freeze(['B-H', 'B-M', 'B0-H2']);
export const ORIG_ARMS = Object.freeze(['REF', 'CONTROL', 'B-H', 'B-M', 'B0-H']);
export const CORR_ARMS = Object.freeze(['REF', 'CONTROL', 'B-H', 'B-M', 'B0-H2']);
const keyBindFile = s => path.join(OUT, `bind-${H}-${s}__${H}.json`);
const keyCaptureFile = s => path.join(OUT, `capture-${H}-${s}.json`);
const ownBindFile = s => path.join(OWN, `bind-${H}-${s}__${H}.json`);
const ownCaptureFile = s => path.join(OWN, `capture-${H}-${s}.json`);
const fault = e => { const c = e?.details?.code ?? e?.code; return ENV_FAULTS.includes(c) ? c : null; };

// ---------------------------------------------------------------------------------------------------------------------------------
// Builds: B0-H again, through the provider's default (identity isolated).
export async function stepBuilds({ budget = 0.2, cases = loadHeldout(), log = console.error }) {
  const dir = path.join(OUT, 'runs', 'b0-h2', 'records');
  mkdirSync(dir, { recursive: true });
  const worldsRoot = path.join(WORLDS, 'b0-h2');
  const { port, db } = createModelPort({ journalFile: path.join(OUT, 'journal', 'builder-b0-h2.sqlite'), allowedModels: [H], maxBudgetUsdPerCall: 0.5, timeoutMs: 300000 });
  const builder = new B0Builder({ port });
  const hosts = identityHashes();
  let spent = 0;
  try {
    for (const c of cases) {
      const f = path.join(dir, `${c.id}.json`);
      if (existsSync(f)) continue;
      if (spent >= budget) { log(`builds B0-H2: budget $${budget} reached`); return; }
      let rec;
      for (let attempt = 0; attempt < 3; attempt++) {
        rec = await runCase(c, { arm: 'B0-H', builder, worldsRoot, attempt });
        spent += rec.cost?.usd ?? 0;
        if (!rec.environmentFault) break;
        log(`builds B0-H2 ${c.id}: environment fault ${rec.environmentFault} (attempt ${attempt}); not scored`);
        if (attempt === 2) { const e = new Error(`environment fault ${rec.environmentFault}`); e.code = rec.environmentFault; throw e; }
        await new Promise(r => setTimeout(r, 30000 * (attempt + 1)));
      }
      // The record must not carry the host identity (checked by hash; the identity is never written).
      const leak = hosts.size ? findIdentities(JSON.stringify(rec), hosts).length : null;
      rec.rerun = { of: 'b0-h', why: 'PREREG-TRACKER-H2: the same writer through the identity-isolated claude-cli provider', hostIdentityOccurrences: leak };
      writeJson(f, rec);
      log(`builds B0-H2 ${c.id}: ${rec.outcome} verified=${rec.judgement?.verified} $${(rec.cost?.usd ?? 0).toFixed(4)} host-identity=${leak}`);
    }
  } finally { db?.close?.(); rmSync(worldsRoot, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Conversations: the product's input is the request plus the answers the build actually received.
/** The person's words as one build received them: the request, then each answer in the order asked. */
export function ownWordsOf(caseDef, record) {
  return [{ turn: 0, kind: 'request', text: caseDef.request }, ...(record.questions ?? []).map((q, i) => ({ turn: i + 1, kind: 'answer', question: q.id, text: q.answer }))];
}
/** { same: true, id: case } when the build's answers are the key's (as a multiset), else a synthetic case for its conversation. */
export function conversationOf(caseDef, record) {
  const key = (caseDef.questions ?? []).map(q => q.answer).sort();
  const got = (record.questions ?? []).map(q => q.answer);
  if (JSON.stringify([...got].sort()) === JSON.stringify(key)) return { same: true, id: caseDef.id };
  const id = `${caseDef.id}~${sha256(JSON.stringify(got)).slice(0, 8)}`;
  return { same: false, id, synth: { id, template: caseDef.template, request: caseDef.request, questions: got.map((a, i) => ({ id: `q${i + 1}`, answer: a })) } };
}
const recordOf = b => readJson(path.join(OUT, 'runs', b.arm.toLowerCase(), 'records', `${b.id.split('/')[1]}.json`));
export function stepConversations({ cases = loadHeldout() } = {}) {
  const byId = Object.fromEntries(cases.map(c => [c.id, c]));
  const builds = {}, synth = {};
  for (const b of heldoutBuilds({ out: OUT, arms: [...MODEL_ARMS, 'B0-H'] })) {
    const conv = conversationOf(byId[b.case], recordOf(b));
    builds[b.id] = { case: b.case, arm: b.arm, conv: conv.id, same: conv.same, answers: (recordOf(b).questions ?? []).length };
    if (!conv.same) synth[conv.id] = conv.synth;
  }
  // Only the corrected set's conversations are captured (B0-H's are listed for the record).
  const needed = new Set(Object.values(builds).filter(b => MODEL_ARMS.includes(b.arm) && !b.same).map(b => b.conv));
  const doc = { note: 'Each model build\'s own conversation (PREREG-TRACKER-H2 §2.2). same: the answers are the key\'s, so the key capture and bind apply.', builds,
    conversations: Object.fromEntries(Object.entries(synth).filter(([id]) => needed.has(id))) };
  writeJson(path.join(OWN, 'conversations.json'), doc);
  return doc;
}
const loadConversations = () => readJson(path.join(OWN, 'conversations.json'));

// ---------------------------------------------------------------------------------------------------------------------------------
// Inputs per build and setting.
function inputsFor(b, { setting, sample, cases, convs, binds, captures }) {
  const c = cases[b.case];
  const own = setting === 'own' && MODEL_ARMS.includes(b.arm) ? convs.builds[b.id] : null;
  if (own && !own.same) {
    const synth = convs.conversations[own.conv];
    return { words: wordsFor(synth), conditions: (binds.own(sample).cases[own.conv] ?? []), capture: captures.own(sample).cases[own.conv] ?? [], conv: own.conv };
  }
  return { words: wordsFor(c), conditions: binds.key(sample).cases[b.case] ?? [], capture: captures.key(sample).cases[b.case] ?? [], conv: b.case };
}
const memo = f => { const m = new Map(); return k => { if (!m.has(k)) m.set(k, f(k)); return m.get(k); }; };
const sources = () => ({
  binds: { key: memo(s => readJson(keyBindFile(s))), own: memo(s => (existsSync(ownBindFile(s)) ? readJson(ownBindFile(s)) : { cases: {} })) },
  captures: { key: memo(s => readJson(keyCaptureFile(s))), own: memo(s => (existsSync(ownCaptureFile(s)) ? readJson(ownCaptureFile(s)) : { cases: {} })) },
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Judge ($0): T2solo per build; G3 over the model pool per request (key setting).
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
const pick = s => Object.fromEntries(Object.entries(s).map(([id, x]) => [id, { status: x.status, reason: x.reason ?? null, decided: x.decided, violated: x.violated,
  evidence: (x.evidence ?? []).slice(0, 2).map(e => ({ item: e.item?.id ?? null, ok: e.ok, why: e.why, view: e.view ?? null })) }]));

export async function stepJudge({ setting, sample, semantics = ['v3', 'v4'], arms = null, log = console.error }) {
  const cases = Object.fromEntries(loadHeldout().map(c => [c.id, c]));
  const convs = setting === 'own' ? loadConversations() : { builds: {}, conversations: {} };
  const src = sources();
  const practice = practiceWorkspace();
  const schemas = schemasOf(vocabulary());
  const list = heldoutBuilds({ out: OUT, arms: arms ?? (setting === 'own' ? MODEL_ARMS : [...new Set([...ORIG_ARMS, ...CORR_ARMS])]) })
    .filter(b => setting !== 'own' || !convs.builds[b.id]?.same);   // own words equal to the key: the key judge applies unchanged
  const results = Object.fromEntries(semantics.map(s => [s, { setting, sample, semantics: s, builds: {} }]));
  for (const sem of semantics) {
    const byCase = new Map();
    for (const b of list) {
      const inp = inputsFor(b, { setting, sample, cases, convs, ...src });
      const conditions = inp.conditions.map(c => ({ ...c, version: 1 }));
      const views = await viewsOf(b, conditions.map(c => c.check).filter(Boolean), practice, sem);
      const solo = judgeViews(conditions, views, { gateViews: views, semantics: sem, words: inp.words, schemas });
      results[sem].builds[b.id] = { case: b.case, arm: b.arm, conv: inp.conv, verified: b.verified, t0: { passed: views[0].run.passed }, t2Solo: pick(solo), tallySolo: tally(Object.values(solo)) };
      if (MODEL_ARMS.includes(b.arm) && setting === 'key') { if (!byCase.has(b.case)) byCase.set(b.case, []); byCase.get(b.case).push({ b, conditions, views, words: inp.words }); }
      log(`judge ${setting} ${sample} ${sem} ${b.id}: oracle=${b.verified ? 'ok' : 'BAD'} T0=${views[0].run.passed ? 'pass' : 'FAIL'} solo unmet=${tally(Object.values(solo)).unmet}`);
    }
    // m2: G3 over the builds a person could have (the model builds of the request), never the reference or the controls.
    for (const [, pool] of byCase) {
      const gateViews = pool.flatMap(p => p.views);
      const first = pool.map(p => judgeViews(p.conditions, p.views, { gateViews, semantics: sem, words: p.words, schemas }));
      const g3 = crossBuild(first.map(s => Object.fromEntries(Object.entries(s).map(([id, x]) => [id, x.status]))));
      pool.forEach((p, i) => {
        const withG3 = g3.size ? judgeViews(p.conditions, p.views, { gateViews, suspects: g3, semantics: sem, words: p.words, schemas }) : first[i];
        Object.assign(results[sem].builds[p.b.id], { g3Model: [...g3], poolSize: pool.length, tallyG3Model: tally(Object.values(withG3)) });
      });
    }
  }
  return semantics.map(sem => { const f = path.join(H2, `judge-${setting}-${sem}-${sample}.json`); writeJson(f, results[sem]); return f; });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// T1 (prose checklist) sample k on each build's own words (capture s0's list), concurrency 3.
export async function stepProse({ k, budget = 0.15, concurrency = 3, log = console.error }) {
  const cases = Object.fromEntries(loadHeldout().map(c => [c.id, c]));
  const convs = loadConversations();
  const src = sources();
  const file = path.join(H2, `prose-own-k${k}.json`);
  const doc = existsSync(file) ? readJson(file) : { prompt: 'tracker-prose-checklist/1', model: H, sample: k, setting: 'own', builds: {}, costUsd: 0, reused: 0 };
  const orig = readJson(path.join(OUT, `prose-${H}-s0__${H}.json`));
  const practice = practiceWorkspace();
  const { port, db } = createModelPort({ journalFile: path.join(H2, 'journal', `${H}.sqlite`), allowedModels: [H], maxBudgetUsdPerCall: 0.2, timeoutMs: 240_000 });
  let spent = 0, stop = null;
  const todo = heldoutBuilds({ out: OUT, arms: CORR_ARMS }).filter(b => !doc.builds[b.id]);
  try {
    // Sample 0 reuses the preregistered T1 result where the inputs are identical (the key's words on the same build).
    if (k === 0) for (const b of todo) {
      const own = convs.builds[b.id];
      if ((!MODEL_ARMS.includes(b.arm) || own?.same) && b.arm !== 'B0-H2' && orig.builds[b.id]) { doc.builds[b.id] = { ...orig.builds[b.id], reusedFrom: 'prose-claude-haiku-5-5-s0' }; doc.reused++; }
    }
    const queue = todo.filter(b => !doc.builds[b.id]);
    const worker = async () => {
      while (queue.length && !stop) {
        if (spent >= budget) { stop = stop ?? 'budget'; break; }
        const b = queue.shift();
        const inp = inputsFor(b, { setting: 'own', sample: 's0', cases, convs, ...src });
        if (!inp.capture.length) { doc.builds[b.id] = { verdicts: {}, ready: true, flagged: false, cost: { usd: 0 }, note: 'no conditions' }; continue; }
        const { views } = await practiceViews(b.workflow, { practice, repeat: false });
        try {
          const r = await prose({ port, model: H, words: inp.words, conditions: inp.capture, build: JSON.stringify(b.workflow), practice: practiceText(views[0]), data: sheetsText(practice.sheets), runId: `t1h2-${b.id}-k${k}` });
          doc.builds[b.id] = { ...r, conv: inp.conv }; spent += r.cost.usd; doc.costUsd = round(doc.costUsd + r.cost.usd);
          log(`prose k${k} ${b.id}: flagged=${r.flagged} $${r.cost.usd.toFixed(4)}`);
        } catch (error) {
          if (fault(error)) { stop = error; break; }
          doc.builds[b.id] = { error: error.code ?? 'ERROR', flagged: null, cost: error.cost ?? { usd: 0 } };
        }
        writeJson(file, doc);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally { writeJson(file, doc); db?.close?.(); }
  if (stop && stop !== 'budget') throw stop;
  if (stop === 'budget') log(`prose k${k}: budget $${budget} reached`);
  return file;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// H7 again on B0-H2 (the same writer, feedback wording and arms as PREREG-TRACKER-H §5).
const B0_REPAIR_SCHEMA = { type: 'object', additionalProperties: false, required: ['decision', 'reason', 'questions', 'workflow'], properties: {
  decision: { type: 'string', enum: ['build', 'ask', 'none'] }, reason: { type: 'string' },
  questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'question'], properties: { id: { type: 'string' }, question: { type: 'string' } } } },
  workflow: { type: 'object' } } };
export async function stepRepair({ feedback, budget = 0.07, log = console.error }) {
  if (!REPAIR_FEEDBACK.includes(feedback)) throw new Error(`feedback must be one of ${REPAIR_FEEDBACK.join(', ')}`);
  const cases = Object.fromEntries(loadHeldout().map(c => [c.id, c]));
  const convs = loadConversations();
  const src = sources();
  const judge = readJson(path.join(H2, 'judge-own-v3-s0.json')), keyJudge = readJson(path.join(H2, 'judge-key-v3-s0.json'));
  const proseDoc = readJson(path.join(H2, 'prose-own-k0.json'));
  const dir = path.join(H2, 'runs', `repair-${feedback}`, 'records');
  mkdirSync(dir, { recursive: true });
  const worldsRoot = path.join(WORLDS, `repair2-${feedback}`);
  const { port, db } = createModelPort({ journalFile: path.join(H2, 'journal', 'builder-b0-h2-repair.sqlite'), allowedModels: [H], maxBudgetUsdPerCall: 0.5, timeoutMs: 300000 });
  let spent = 0;
  try {
    for (const b of heldoutBuilds({ out: OUT, arms: ['B0-H2'] })) {
      const f = path.join(dir, `${b.case}.json`);
      if (existsSync(f)) continue;
      const own = convs.builds[b.id];
      const inp = inputsFor(b, { setting: 'own', sample: 's0', cases, convs, ...src });
      const j = { builds: { [b.id]: (own?.same ? keyJudge : judge).builds[b.id] } };
      const text = repairFeedback(feedback, { judge: j, proseDoc, bind: { cases: { [inp.conv]: inp.conditions } }, buildId: b.id, caseId: inp.conv });
      if (!text) continue;
      if (spent >= budget) { log(`repair ${feedback}: budget $${budget} reached`); break; }
      const c = cases[b.case];
      const original = recordOf(b);
      const builder = { id: `b0-repair-${feedback}`, async: true, build: async () => {
        const prompt = `${b0Prompt({ request: c.request, answers: original.answers ?? {} })}\n\nYour workflow:\n${JSON.stringify(b.workflow)}\n\n${text}\n\nReturn the corrected workflow with decision build.`;
        const calls = [];
        let value = null, usd = 0;
        for (let attempt = 0; attempt <= 2 && !value; attempt++) {
          const r = await port.call({ runId: `t2h2-repair-${feedback}-${b.case}`, nodeKey: 'repair', attempt, modelId: H, system: B0_SYSTEM, prompt, schema: B0_REPAIR_SCHEMA, decoding: { maxTokens: 16000 } })
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
      const rec = await runCase(c, { arm: `B0-H2+repair-${feedback}`, builder, worldsRoot });
      if (rec.environmentFault) { const e = new Error(`environment fault ${rec.environmentFault}`); e.code = rec.environmentFault; throw e; }
      rec.repairOf = { build: b.id, verifiedBefore: b.verified, feedback: text };
      spent += rec.cost?.usd ?? 0;
      writeJson(f, rec);
      log(`repair ${feedback} ${b.case}: before verified=${b.verified} after verified=${rec.judgement?.verified} (${rec.outcome}) $${(rec.cost?.usd ?? 0).toFixed(4)}`);
    }
  } finally { db?.close?.(); rmSync(worldsRoot, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Score.
// T-lit ($0): the literals a person gives that a build must carry: e-mail addresses, #channels, numbers of two or more digits.
const LITERAL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+|#[A-Za-z][\w-]*|\b\d{2,}\b/g;
export function literalsOf(words) { return [...new Set(words.flatMap(w => [...String(w.text ?? '').matchAll(LITERAL)].map(m => m[0].replace(/\.$/, '').toLowerCase())))]; }
export function tlitFlags(words, workflow) {
  const hay = JSON.stringify(workflow).toLowerCase();
  const missing = literalsOf(words).filter(l => !(/^\d+$/.test(l) ? new RegExp(`(?<!\\d)${l}(?!\\d)`).test(hay) : hay.includes(l)));
  return { flagged: missing.length > 0, missing: missing.length };
}
// T-lit± (post hoc, added 2026-11-04 after the preregistered T-lit flagged 8 verified builds whose thresholds are encoded as
// "up to 49.99" for "under $50" or 201 for "over 200"): a number n is also carried as n-1, n+1 or n-0.01. Reported beside T-lit,
// labelled post hoc; it is the strongest $0 literal baseline found, so the tracker is compared with it too.
export function tlitTolerantFlags(words, workflow) {
  const hay = JSON.stringify(workflow).toLowerCase();
  const has = l => { if (!/^\d+$/.test(l)) return hay.includes(l); const n = Number(l); return [n, n - 1, n + 1, (n - 0.01).toFixed(2)].some(v => new RegExp(`(?<![\\d.])${String(v).replace('.', '\\.')}(?!\\d)`).test(hay)); };
  const missing = literalsOf(words).filter(l => !has(l));
  return { flagged: missing.length > 0, missing: missing.length };
}
function armScore(flags, defective) {
  const ids = Object.keys(flags).filter(id => flags[id] === true || flags[id] === false);
  const flagged = ids.filter(id => flags[id]);
  const caught = flagged.filter(id => defective.has(id)), fa = flagged.filter(id => !defective.has(id));
  return { builds: ids.length, defective: ids.filter(id => defective.has(id)).length, caught: caught.length, falseAlarms: fa.length, precision: flagged.length ? round(caught.length / flagged.length) : null, falseAlarmIds: fa };
}
const subset = (flags, keep) => Object.fromEntries(Object.entries(flags).filter(([id]) => keep(id)));
const isModel = id => /^(b-h|b-m|b0-h2?)\//.test(id);

export function stepScore({ log = console.log } = {}) {
  const cases = Object.fromEntries(loadHeldout().map(c => [c.id, c]));
  const convs = loadConversations();
  const all = heldoutBuilds({ out: OUT, arms: [...new Set([...ORIG_ARMS, ...CORR_ARMS])] });
  const defective = new Set(all.filter(b => !b.verified).map(b => b.id));
  const settings = { 'orig-key': ORIG_ARMS, 'corr-key': CORR_ARMS, 'corr-own': CORR_ARMS };
  const origProse = readJson(path.join(OUT, `prose-${H}-s0__${H}.json`));
  const prosek = [0, 1, 2].map(k => (existsSync(path.join(H2, `prose-own-k${k}.json`)) ? readJson(path.join(H2, `prose-own-k${k}.json`)) : null));
  const judgeFile = (setting, sem, s) => {
    // v3 on the 97 preregistered builds: the PREREG-TRACKER-H judge files (the h2 v3 run on s0 re-derives them as a regression check);
    // B0-H2 and the model-pool G3 come from h2. v4: h2 only.
    const committed = sem === 'v3' ? readJson(path.join(OUT, `judge-v3-${H}-${s}__${H}.json`)) : null;
    if (setting === 'orig-key' && committed) return committed;
    const f = path.join(H2, `judge-key-${sem}-${s}.json`);
    const h2 = existsSync(f) ? readJson(f) : null;
    if (!h2 && !committed) return null;
    return { builds: { ...(committed?.builds ?? {}), ...(h2?.builds ?? {}) } };
  };
  const doc = { scoredAt: new Date().toISOString(), prereg: 'research/tracker-20261021/PREREG-TRACKER-H2.md', settings: {} };
  for (const [name, arms] of Object.entries(settings)) {
    const ids = all.filter(b => arms.includes(b.arm));
    const inSet = new Set(ids.map(b => b.id));
    const own = name === 'corr-own';
    const wordsOf = b => (own && MODEL_ARMS.includes(b.arm) && !convs.builds[b.id]?.same ? wordsFor(convs.conversations[convs.builds[b.id].conv]) : wordsFor(cases[b.case]));
    const t0 = {}, tlit = {}, tlitTol = {};
    for (const b of ids) { tlit[b.id] = tlitFlags(wordsOf(b), b.workflow).flagged; tlitTol[b.id] = tlitTolerantFlags(wordsOf(b), b.workflow).flagged; }
    // T1: orig-key is the preregistered single sample; corr-own has K = 3 on each build's own words; corr-key has no T1 run.
    const t1 = [0, 1, 2].map(k => {
      const f = {};
      for (const b of ids) {
        if (name === 'orig-key') { if (k === 0) f[b.id] = origProse.builds[b.id]?.flagged ?? null; continue; }
        if (own) f[b.id] = prosek[k]?.builds?.[b.id]?.flagged ?? null;
      }
      return f;
    });
    const t1maj = {};
    for (const id of inSet) { const v = t1.map(f => f[id]).filter(x => x === true || x === false); if (v.length === 3) t1maj[id] = v.filter(Boolean).length >= 2; }
    const per = {};
    for (const s of ['s0', 's1', 's2']) for (const sem of ['v3', 'v4']) {
      const key = judgeFile(name === 'orig-key' ? 'orig-key' : 'corr-key', sem, s);
      if (!key) continue;
      const ownJ = own && existsSync(path.join(H2, `judge-own-${sem}-${s}.json`)) ? readJson(path.join(H2, `judge-own-${sem}-${s}.json`)) : null;
      const solo = {}, g3m = {}, both = {};
      for (const b of ids) {
        const j = (ownJ?.builds?.[b.id]) ?? key.builds[b.id];
        if (!j) continue;
        t0[b.id] = !j.t0.passed;
        solo[b.id] = j.tallySolo.unmet > 0; both[b.id] = t0[b.id] || solo[b.id];
        if (!own && j.tallyG3Model) g3m[b.id] = j.tallyG3Model.unmet > 0;
      }
      per[`${sem}-${s}`] = { T2solo: armScore(solo, defective), 'T0+T2solo': armScore(both, defective), T2soloModel: armScore(subset(solo, isModel), defective),
        ...(Object.keys(g3m).length ? { G3modelPool: armScore(g3m, defective) } : {}), missing: ids.filter(b => solo[b.id] === undefined).map(b => b.id) };
    }
    const t1s = t1.map(f => (Object.keys(f).length ? { all: armScore(f, defective), model: armScore(subset(f, isModel), defective) } : null));
    const t1m = Object.keys(t1maj).length ? { all: armScore(t1maj, defective), model: armScore(subset(t1maj, isModel), defective) } : null;
    const T0 = armScore(t0, defective), T0m = armScore(subset(t0, isModel), defective);
    // H1-H5 per sample and semantics, the PREREG-TRACKER-H thresholds unchanged; H4 against every T1 sample and the majority.
    const rules = {};
    for (const [k, v] of Object.entries(per)) {
      const solo = v.T2solo, t1list = [...t1s.filter(Boolean).map(x => x.all), ...(t1m ? [t1m.all] : [])];
      rules[k] = { H1: solo.precision !== null && solo.precision >= 0.95, H2: solo.falseAlarms === 0, H3: v['T0+T2solo'].caught - T0.caught >= 10,
        H4: t1list.length > 0 && t1list.every(t => solo.precision !== null && t.precision !== null && solo.precision >= t.precision && solo.falseAlarms <= t.falseAlarms),
        H4against: t1list.length };
    }
    doc.settings[name] = { arms, builds: ids.length, defective: ids.filter(b => defective.has(b.id)).length, modelBuilt: ids.filter(b => isModel(b.id)).length,
      modelDefective: ids.filter(b => isModel(b.id) && defective.has(b.id)).length, T0, T0model: T0m, Tlit: armScore(tlit, defective), TlitModel: armScore(subset(tlit, isModel), defective),
      TlitTolerantPostHoc: armScore(tlitTol, defective), TlitTolerantPostHocModel: armScore(subset(tlitTol, isModel), defective),
      T1: t1s, T1majority: t1m, T2: per, rules };
  }
  // H5 (pointer recall) on the key captures, as preregistered; the own-words captures have no gold anchors on their turns.
  const gold = readJson(path.join(OUT, 'gold-heldout.json'));
  doc.H5 = Object.fromEntries(['s0', 's1', 's2'].map(s => { const cap = readJson(keyCaptureFile(s)); let cov = 0, tot = 0; for (const c of Object.values(cases)) { const r = scoreCapture(cap.cases[c.id] ?? [], gold.cases[c.id], wordsFor(c)); cov += r.covered; tot += r.gold; } return [s, { covered: cov, total: tot }]; }));
  // H7 on B0-H2.
  doc.H7 = {};
  for (const kind of REPAIR_FEEDBACK) {
    const dir = path.join(H2, 'runs', `repair-${kind}`, 'records');
    if (!existsSync(dir)) continue;
    const recs = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => readJson(path.join(dir, f)));
    const after = r => r.judgement?.verified === true;
    doc.H7[kind] = { repaired: recs.length, fixed: recs.filter(r => !r.repairOf.verifiedBefore && after(r)).map(r => r.case), broken: recs.filter(r => r.repairOf.verifiedBefore && !after(r)).map(r => r.case),
      stillDefective: recs.filter(r => !r.repairOf.verifiedBefore && !after(r)).map(r => r.case), costUsd: round(recs.reduce((s, r) => s + (r.cost?.usd ?? 0), 0)) };
  }
  // Spend of this re-measure, from the output files.
  const b0h2 = heldoutBuilds({ out: OUT, arms: ['B0-H2'] });
  const fileCost = f => (existsSync(f) ? readJson(f).costUsd ?? 0 : 0);
  doc.spendUsd = { b0h2Builds: round(b0h2.reduce((s, b) => s + b.builderCostUsd, 0)), ownCapture: round(['s0', 's1', 's2'].reduce((s, x) => s + fileCost(ownCaptureFile(x)), 0)),
    ownBind: round(['s0', 's1', 's2'].reduce((s, x) => s + fileCost(ownBindFile(x)), 0)), t1: round(prosek.reduce((s, p) => s + (p?.costUsd ?? 0), 0)),
    h7: round(Object.values(doc.H7).reduce((s, x) => s + x.costUsd, 0)) };
  doc.spendUsd.total = round(Object.values(doc.spendUsd).reduce((a, b) => a + b, 0));
  doc.b0h2 = { builds: b0h2.length, defective: b0h2.filter(b => !b.verified).length, hostIdentity: b0h2.map(b => recordOf(b).rerun?.hostIdentityOccurrences ?? null) };
  doc.conversations = { modelBuilds: Object.values(convs.builds).filter(b => MODEL_ARMS.includes(b.arm)).length, ownWords: Object.values(convs.builds).filter(b => MODEL_ARMS.includes(b.arm) && !b.same).length,
    distinct: Object.keys(convs.conversations).length };
  writeJson(path.join(H2, 'scores-h2.json'), doc);
  return doc;
}

async function main() {
  const { values: a, positionals } = parseArgs({ allowPositionals: true, options: { budget: { type: 'string' }, samples: { type: 'string' }, sample: { type: 'string' },
    k: { type: 'string' }, setting: { type: 'string' }, semantics: { type: 'string' }, arms: { type: 'string' }, feedback: { type: 'string' } } });
  const step = positionals[0];
  if (step === 'builds') await stepBuilds({ budget: Number(a.budget ?? 0.2) });
  else if (step === 'conversations') { const d = stepConversations(); console.error(`conversations: ${Object.keys(d.conversations).length} distinct own-words conversations to capture`); }
  else if (step === 'capture') { const synth = Object.values(loadConversations().conversations); if (synth.length) await stepCapture({ out: OWN, model: H, samples: Number(a.samples ?? 3), budget: Number(a.budget ?? 0.05), cases: synth }); }
  else if (step === 'bind') { const synth = Object.values(loadConversations().conversations); if (synth.length) await stepBind({ out: OWN, captureFile: ownCaptureFile(a.sample), model: H, budget: Number(a.budget ?? 0.15), cases: synth }); }
  else if (step === 'prose') await stepProse({ k: Number(a.k), budget: Number(a.budget ?? 0.15) });
  else if (step === 'judge') await stepJudge({ setting: a.setting, sample: a.sample, semantics: (a.semantics ?? 'v3,v4').split(','), arms: a.arms ? a.arms.split(',') : null });
  else if (step === 'repair') await stepRepair({ feedback: a.feedback, budget: Number(a.budget ?? 0.07) });
  else if (step === 'score') console.log(JSON.stringify(stepScore(), null, 1));
  else throw new Error('usage: remeasure.mjs builds|conversations|capture|bind|prose|judge|repair|score ...');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`${error.code ?? 'ERROR'}: ${error.message}`); process.exitCode = fault(error) ? 75 : 1; });
