// VERIFY (DESIGN §8): stages V0..V8, all in code, cheapest first. The first failing stage stops the run and returns its reject
// code; a stage that cannot run without a live provider or budget returns ok:null ("pending"), which is never a pass.
//
//   V0 static   compile on the frozen kit, locus, literal-leak scan, code safety
//   V1 lint     pinned strict lint: zero errors (defects), fewer errors (lint debt), no new warnings
//   V2 weakening + proofs (tighten implication, relax quote + mutant battery)
//   V3 failing case   replay-or-live on a fresh journal copy per replica, K replicas
//   V4 regression slice   every recorded passing run of the base version
//   V5 acceptance discrimination   the bed's reference and bad controls pinned along the answer chain
//   V6 cost bound   V7 fresh paired tasks   V8 locked graders unchanged
import path from 'node:path';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { REPO, HEAL_DIR, PINS_FILE, sha256, walk, WORK_ROOT } from './kit.mjs';
import { openCtx, replayRun, readsOf, bedsLib, pmap, fidelity } from './replay.mjs';
import { weakening, scanLeaks, unsafeAdditions, taskTexts } from './scan.mjs';
import { tightenProof, relaxProof } from './proofs.mjs';
import { compileOps } from './ops.mjs';
import { canonical, digest, clone } from './ir.mjs';
import { draw, loadLedger, saveLedger } from './seeds.mjs';

export const VERIFICATION = 'heal-verification/1';
export const DEFAULT_POLICY = Object.freeze({ K: 3, concurrency: 3, costBound: 1.25, costBoundMax: 1.5, regressionRerun: 3, alarmShare: 0.05, lintDebt: 'strict', replicaEstimateUsd: 0.15,
  fresh: { enabled: true, n: 12, k: 2, perStratumMin: 3 } });

const accepted = r => r.status === 'succeeded';
const GATE_CODES = ['ACCEPTANCE_FAILED', 'VERIFY_FAILED', 'ASSERTION_FAILED', 'NODE_CHECK_FAILED'];
const needsLive = r => r.error?.code === 'MODEL_PROVIDER_MISSING' || r.error?.code === 'REPLAY_MISS';
const pinnedVerdict = (gate, r, workflow) => { try { return gate.verdictOf(r.run, { workflow })?.verdict ?? null; } catch { return null; } };

// One replica = one fresh copy of the recorded journal: unchanged nodes hit it, changed nodes go to the provider table.
async function replica({ kit, trial, workflow, providers, task, source }) {
  const ctx = await openCtx(trial.source ?? source, { kit, name: 'verify', providers: providers ?? {} });
  try { return await replayRun(ctx, workflow, trial, { mode: 'replay-or-live', task }); } finally { ctx.close(); }
}

// ---- grader hashes (V8) --------------------------------------------------------------------------------------------------------
export function gradersHash(family) {
  const files = [];
  const add = dir => { if (existsSync(dir)) for (const f of walk(dir)) if (/\.(mjs|js|py|json)$/.test(f) && !/\.test\.mjs$/.test(f) && !/node_modules/.test(f)) files.push(f); };
  add(path.join(REPO, 'beds', family)); add(path.join(REPO, 'beds/lib'));
  files.push(path.join(REPO, 'experiments/lib/beds.mjs'), PINS_FILE); add(path.join(HEAL_DIR, 'pinned'));
  const h = createHash('sha256');
  for (const f of files.filter(existsSync).sort()) h.update(path.relative(REPO, f)).update('\0').update(readFileSync(f)).update('\0');
  return { hash: h.digest('hex'), files: files.length };
}

// ---- controls (V5): pin the answer chain ------------------------------------------------------------------------------------------
// Pin every root node that carries the answer's keys (an agent whose schema has them, or a code node whose recorded output does) so
// the bed's reference / bad answer flows through the gates exactly where the real answer would; unpinned nodes replay.
export function pinChain(workflow, baseOutputs, answerKeys, control) {
  const fields = Object.fromEntries(answerKeys.map(k => [k, control[k]]));
  const chain = workflow.nodes.filter(n => n.id === 'answer' || (n.kind === 'agent' ? answerKeys.every(k => n.returns?.properties?.[k]) : baseOutputs?.[n.id] && typeof baseOutputs[n.id] === 'object' && answerKeys.every(k => Object.hasOwn(baseOutputs[n.id], k))));
  const ids = new Set(chain.map(n => n.id));
  const nodes = workflow.nodes.map(n => !ids.has(n.id) ? n : { id: n.id, kind: 'code', lang: 'js', needs: n.needs ?? [], ...(n.when ? { when: n.when } : {}), ...(n.join ? { join: n.join } : {}),
    description: `heal control pin of ${n.id}`, args: readsOf(n), source: `export default function main() { return ${JSON.stringify({ ...(n.kind === 'agent' ? {} : baseOutputs?.[n.id] ?? {}), ...fields })}; }`, timeoutMs: 20000 });
  return { workflow: { ...workflow, nodes }, pinned: [...ids] };
}

async function controlOutcome({ kit, trial, workflow, baseOutputs, answerKeys, control, task, policy }) {
  const ctx = await openCtx(trial.source, { kit, name: 'control' });
  try {
    const { workflow: pinned } = pinChain(workflow, baseOutputs, answerKeys, control);
    const r = await replayRun(ctx, pinned, trial, { mode: 'replay', task });
    if (needsLive(r)) return { accepted: null, indeterminate: true, code: r.error?.code };
    return { accepted: accepted(r), status: r.status, code: r.error?.code ?? null };
  } finally { ctx.close(); }
}

// ---- strata for V7 (oracle-side; never shown to the proposer) --------------------------------------------------------------------------
// A bed adapter returns the hidden value the localised field should take on a task, so that a hard-coded convention fails the other
// stratum. Only the records bed has one so far (BRIGHTDESK / ATLAS / VENDEX numeric date order).
export const STRATA = {
  async records(task, identity) {
    const { buildWorld } = await import(path.join(REPO, 'beds/records/world.mjs'));
    const w = buildWorld(task.seed, task.split, task.difficulty), sys = identity?.system;
    return ({ BRIGHTDESK: w.conv?.bd, ATLAS: w.conv?.atlas, VENDEX: w.conv?.vendex })[sys] ?? null;
  },
};

// ---- the verifier ---------------------------------------------------------------------------------------------------------------------
export async function verify({ kit, gate, budget, base, proposal, incident, providers = null, policy = {}, hooks = {}, stages = null, sourcePolicy = null }) {
  const P = { ...DEFAULT_POLICY, ...policy, fresh: { ...DEFAULT_POLICY.fresh, ...(policy.fresh ?? {}) } };
  const cand = proposal.workflow, baseWf = base.workflow, kind = proposal.kind ?? 'defect';
  const modelPolicy = sourcePolicy ?? kit.sessionPolicy(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
  const rec = { schema: VERIFICATION, proposalId: proposal.id, kind, baseHash: base.hash ?? digest(baseWf), candidateHash: digest(cand), stages: [], ok: false, pending: false, rejectCode: null, costUsd: 0 };
  const data = { replicas: [], regression: null, controls: null, fresh: null };
  const want = id => !stages || stages.includes(id);
  const stage = async (id, name, fn) => {
    if (!want(id)) return { ok: true, skipped: true };
    const t0 = Date.now(), s0 = budget?.spent ?? 0;
    let r;
    try { r = await fn(); } catch (error) { r = { ok: false, code: error.code ?? 'HEAL_STAGE_ERROR', detail: String(error.message ?? error).slice(0, 300) }; }
    rec.stages.push({ id, name, ms: Date.now() - t0, costUsd: +((budget?.spent ?? 0) - s0).toFixed(6), ...r });
    if (r.ok !== true) { if (r.ok === null) rec.pending = true; else rec.rejectCode = r.code ?? `HEAL_${id}_FAILED`; }
    return r;
  };
  const finish = () => { rec.ok = rec.stages.length > 0 && rec.stages.every(s => s.ok === true) && !rec.pending && !rec.rejectCode; rec.costUsd = +(budget?.spent ?? 0).toFixed(6); rec.data = summarise(data); return rec; };
  const halt = r => r.ok !== true;

  // V0 ---------------------------------------------------------------------------------------------------------------------------------
  if (halt(await stage('V0', 'static', async () => {
    const again = compileOps(baseWf, proposal.ops, { classOrder: modelPolicy.classOrder, classOf: id => kit.policy.modelById(modelPolicy, id).class, isStrong: gate.isStrong, allowed: proposal.allowed ? new Set(proposal.allowed) : null, locus: proposal.locus ? new Set(proposal.locus) : null });
    if (again.errors.length) return { ok: false, code: again.errors[0].code, detail: again.errors[0].message };
    if (digest(again.workflow) !== rec.candidateHash) return { ok: false, code: 'HEAL_COMPILE_INVALID', detail: 'the candidate is not the compilation of its ops' };
    const v = kit.validateWorkflow(cand, modelPolicy);
    if (!v.valid) return { ok: false, code: 'HEAL_COMPILE_INVALID', detail: v.errors.slice(0, 3).map(e => `${e.code} ${e.path ?? ''}`).join('; ') };
    if (cand.version !== baseWf.version + 1 || cand.id !== baseWf.id) return { ok: false, code: 'HEAL_FORBIDDEN_FIELD', detail: 'version must be base+1 and the id unchanged' };
    const unsafe = unsafeAdditions(baseWf, cand);
    if (unsafe.length) return { ok: false, code: 'HEAL_CODE_UNSAFE', detail: `${unsafe[0].path}: ${unsafe[0].message}` };
    const leaks = incident.leakIndex ? scanLeaks(baseWf, cand, incident.leakIndex) : [];
    if (leaks.length) return { ok: false, code: 'HEAL_LITERAL_LEAK', detail: `rule ${leaks[0].rule} at ${leaks[0].path}`, leaks: leaks.map(l => ({ rule: l.rule, path: l.path })) };
    return { ok: true, nodes: v.nodeCount };
  }))) return finish();

  // V1 ---------------------------------------------------------------------------------------------------------------------------------
  let baseLint, candLint;
  if (halt(await stage('V1', 'strict lint', async () => {
    baseLint = gate.lintWorkflow(baseWf, { modelPolicy }); candLint = gate.lintWorkflow(cand, { modelPolicy });
    const key = f => `${f.code}|${f.node ?? f.path}`, had = new Set(baseLint.findings.map(key));
    const waived = new Set((proposal.waivers ?? []).filter(w => w.code === 'CLASS_ABOVE_DEFAULT_UNJUSTIFIED').map(w => String(w.node).split('/').pop()));
    const fresh = candLint.findings.filter(f => f.severity === 'warning' && !had.has(key(f)) && !(f.code === 'CLASS_ABOVE_DEFAULT_UNJUSTIFIED' && waived.has(f.node)) && f.code !== 'LINT_RULE_SKIPPED');
    if (fresh.length) return { ok: false, code: 'HEAL_LINT_NEW_WARNING', detail: fresh.map(f => `${f.code}@${f.node ?? f.path}`).join(', ') };
    const touched = new Set((proposal.touched ?? []).map(t => String(t).split('/').pop()));
    const stillOpen = baseLint.findings.filter(f => ['GLOBAL_READ_UNGUARDED', 'ESCALATION_WITHOUT_CHECKS'].includes(f.code) && touched.has(f.node)).filter(f => candLint.findings.some(g => key(g) === key(f)));
    if (stillOpen.length) return { ok: false, code: 'HEAL_LINT_NOT_CLEARED', detail: stillOpen.map(f => `${f.code}@${f.node}`).join(', ') };
    const e0 = baseLint.counts.error, e1 = candLint.counts.error;
    if (kind === 'lint-debt' && !(e1 < e0)) return { ok: false, code: 'HEAL_LINT_NO_PROGRESS', detail: `lint errors ${e0} -> ${e1}` };
    if (kind === 'defect' && e1 > 0 && !(P.lintDebt === 'defer' && e1 <= e0)) return { ok: false, code: 'HEAL_LINT_ERRORS', detail: `${e1} lint errors remain (${Object.keys(candLint.codes).join(', ')}); heal the lint debt first` };
    return { ok: true, errors: [e0, e1], lintDebtOpen: e1 > 0, codes: candLint.codes };
  }))) return finish();
  rec.lintDebtOpen = candLint ? candLint.counts.error > 0 : undefined;

  // V2 ---------------------------------------------------------------------------------------------------------------------------------
  if (halt(await stage('V2', 'no weakening, proofs', async () => {
    const proofs = clone(proposal.proofs ?? []), notes = [];
    for (const p of proofs) {
      if (p.type === 'patch' && (incident.classes ?? []).includes('OVERSTRICT_CHECK')) return { ok: false, code: 'HEAL_RELAX_UNPROVEN', detail: 'a patch to an over-strict check is a relaxation: use relax_check' };
      if (p.type === 'tighten') {
        const rcd = incident.recorded?.[p.node] ?? {};
        const t = tightenProof({ old: p.old, next: p.new, returns: p.returns, templates: rcd.templates ?? [], wrong: rcd.wrong ?? [], accepted: rcd.accepted ?? [], kit });
        p.verified = t.ok; notes.push({ node: p.node, type: 'tighten', ...t });
        if (!t.ok) return { ok: false, code: t.implies ? 'HEAL_TIGHTEN_NO_EFFECT' : 'HEAL_CHECK_REMOVED', detail: t.implies ? 'the new check rejects no recorded wrong output' : 'the new check accepts something the old one rejected' };
      }
      if (p.type === 'relax') {
        if (p.target !== 'source' || !incident.checkInputs?.[p.node]) { p.verified = false; return { ok: false, code: 'HEAL_RELAX_UNPROVEN', detail: 'no mutant battery for this check' }; }
        const node = baseWf.nodes.find(n => n.id === p.node), { moduleSource, args, texts } = incident.checkInputs[p.node];
        const t = await relaxProof({ proof: p, kit, node, args, moduleSource, taskTexts: texts });
        p.verified = t.ok; notes.push({ node: p.node, type: 'relax', quoteFound: t.quoteFound, mutants: t.mutants.length, violations: t.violations });
        if (!t.ok) return { ok: false, code: 'HEAL_RELAX_UNPROVEN', detail: t.violations[0] };
      }
    }
    const v = weakening(baseWf, cand, { proofs });
    if (v.length) return { ok: false, code: v[0].code, detail: `${v[0].path}: ${v[0].message}`, violations: v.map(x => x.code) };
    return { ok: true, proofs: notes };
  }))) return finish();

  // V3 ---------------------------------------------------------------------------------------------------------------------------------
  const failing = incident.failing ?? [];
  if (halt(await stage('V3', 'failing case', async () => {
    const out = [];
    for (const trial of failing) {
      const task = incident.tasks?.[trial.key];
      let reps = [];
      for (let k = 0; k < P.K; k++) {
        let release = () => {};
        if (k > 0) { try { release = budget.reserve(Math.max(P.replicaEstimateUsd, reps.at(-1)?.liveUsd ?? 0), `V3 replica ${k + 1} of ${trial.key}`); } catch (e) { return { ok: null, code: 'HEAL_BUDGET_EXHAUSTED', detail: e.message }; } }
        let r;
        try { r = await replica({ kit, trial, workflow: cand, providers, task }); } finally { release(); }
        budget?.chargeRun(r, `V3 ${trial.key} r${k}`);
        if (needsLive(r)) return { ok: null, code: 'HEAL_NEEDS_LIVE', detail: `${trial.key}: a changed node needs a live call and no provider was supplied (${r.error?.code})` };
        reps.push(r);
        if (r.liveCalls === 0) break;   // every call replayed: the result is deterministic, further replicas would be identical
      }
      const rows = reps.map(r => ({ pass: r.pass, score: r.score, status: r.status, verdict: pinnedVerdict(gate, r, cand), liveCalls: r.liveCalls, liveUsd: +r.liveUsd.toFixed(5), fullUsd: +r.fullUsd.toFixed(5), calls: r.calls, caught: !accepted(r) }));
      data.replicas.push({ trial: trial.key, recordedCostUsd: trial.costUsd, rows, outputs: reps.at(-1).outputs });
      // Lint debt does not claim to fix the failing case (its value is V5: the acceptance now discriminates); it must leave the run in a
      // defined state. A defect patch must make the oracle pass (dev), or, without an oracle, make a guard catch the failure.
      const okRow = r => kind === 'lint-debt' ? ['succeeded', 'failed'].includes(r.status) : incident.oracle ? r.pass : r.caught;
      if (!rows.every(okRow)) return { ok: false, code: kind === 'lint-debt' ? 'HEAL_FAILING_CASE_UNDEFINED' : 'HEAL_FAILING_CASE_STILL_FAILS', detail: `${trial.key}: ${rows.filter(r => !okRow(r)).length}/${rows.length} replicas fail (${rows.map(r => `${r.status}${r.pass ? '+oracle' : ''}`).join(',')})` };
      out.push({ trial: trial.key, replicas: rows.length, deterministic: rows.length < P.K });
    }
    for (const p of (proposal.proofs ?? []).filter(x => x.type === 'patch')) {
      const rep = data.replicas.find(r => r.trial === p.assertion.trial) ?? data.replicas[0];
      const got = rep?.outputs?.[p.node]; const val = got == null ? undefined : p.assertion.path.split('.').reduce((v, k) => v?.[k], got);
      if (canonical(val ?? null) !== canonical(p.assertion.equals)) return { ok: false, code: 'HEAL_ASSERTION_FAILED', detail: `${p.node}.${p.assertion.path} is not the asserted value` };
    }
    return { ok: true, trials: out };
  }))) return finish();

  // V4 ---------------------------------------------------------------------------------------------------------------------------------
  if (halt(await stage('V4', 'regression slice', async () => {
    const passing = incident.passing ?? [];
    if (!passing.length) return { ok: true, n: 0, note: 'no recorded passing run of this version' };
    let stop = null;
    const rows = await pmap(passing, P.concurrency, async trial => {
      if (stop) return null;
      const task = incident.tasks?.[trial.key];
      let release = () => {};
      try { release = budget && providers ? budget.reserve(0.01, 'V4') : release; } catch (e) { stop = { ok: null, code: 'HEAL_BUDGET_EXHAUSTED', detail: e.message }; return null; }
      let r;
      try { r = await replica({ kit, trial, workflow: cand, providers, task }); } finally { release(); }
      budget?.chargeRun(r, `V4 ${trial.key}`);
      if (needsLive(r)) { stop = { ok: null, code: 'HEAL_NEEDS_LIVE', detail: `${trial.key}: a changed node needs a live call and no provider was supplied` }; return null; }
      let reruns = [];
      if (!r.pass && incident.oracle) for (let i = 0; i < P.regressionRerun && r.liveCalls > 0; i++) reruns.push(await replica({ kit, trial, workflow: cand, providers, task }));
      for (const x of reruns) budget?.chargeRun(x, `V4 rerun ${trial.key}`);
      // A run the candidate's own gates stop (acceptance, a gating verify, an assert, a node check) is a verdict false alarm, not an oracle
      // regression: the answer it would have produced is unknown, and the recorded one passes the oracle by definition.
      const gateStopped = !accepted(r) && GATE_CODES.includes(r.error?.code);
      let regression = incident.oracle && !gateStopped && !r.pass && !(reruns.length === P.regressionRerun && reruns.every(x => x.pass)), infidelity = false;
      if (regression) {   // does the BASE reproduce this recorded pass? If not, the record is not a baseline to regress against.
        const b = await replica({ kit, trial, workflow: baseWf, providers: null, task });
        if (!fidelity(trial, b).identical) { infidelity = true; regression = false; }
      }
      return { trial: trial.key, recordedCostUsd: trial.costUsd, pass: r.pass, status: r.status, regression, infidelity, rejected: !accepted(r), gateStopped, liveUsd: r.liveUsd, fullUsd: r.fullUsd, calls: r.calls };
    });
    if (stop) return stop;
    const done = rows.filter(Boolean);
    data.regression = done;
    const regs = done.filter(r => r.regression);
    const allowed = Math.max(1, Math.ceil(P.alarmShare * done.length));
    // A verdict false alarm: the candidate rejects a run whose answer the oracle accepts. A rejected run that also fails the oracle is a regression.
    const falseAlarms = done.filter(r => r.gateStopped || (r.rejected && r.pass));
    if (regs.length) return { ok: false, code: 'HEAL_REGRESSION', detail: `${regs.length}/${done.length} previously passing runs now fail: ${regs.map(r => r.trial).slice(0, 3).join(', ')}`, n: done.length };
    if (falseAlarms.length > allowed) return { ok: false, code: 'HEAL_FALSE_ALARMS', detail: `${falseAlarms.length} oracle-passing runs now rejected (allowed ${allowed})`, n: done.length };
    return { ok: true, n: done.length, falseAlarms: falseAlarms.length, allowedFalseAlarms: allowed };
  }))) return finish();

  // V5 ---------------------------------------------------------------------------------------------------------------------------------
  if (halt(await stage('V5', 'acceptance discrimination', async () => {
    const c = incident.controls;
    if (!c?.items?.length) return { ok: true, skipped: true, note: 'no bed controls available' };
    const trial = failing[0] ?? incident.passing?.[0], task = incident.tasks?.[trial.key], baseOutputs = incident.baseRuns?.[trial.key]?.outputs;
    const run = (workflow, control) => controlOutcome({ kit, trial, workflow, baseOutputs, answerKeys: c.answerKeys, control, task, policy: P });
    const table = [];
    table.push(...await pmap(c.items, P.concurrency, async item => ({ name: item.name, expect: item.expect, base: await run(baseWf, item.output), cand: await run(cand, item.output) })));
    data.controls = table;
    const grade = gate.assessWorkflow(cand).acceptance.grade;
    const ref = table.find(t => t.expect === 'accept'), bad = table.filter(t => t.expect === 'reject');
    if (ref && ref.cand.accepted === false) return { ok: false, code: 'HEAL_REFERENCE_REJECTED', detail: 'the candidate rejects the bed reference answer' };
    const lost = bad.filter(t => t.base.accepted === false && t.cand.accepted === true);
    if (lost.length) return { ok: false, code: 'HEAL_CANARY_ACCEPTED', detail: `the candidate accepts a control the base rejected: ${lost.map(t => t.name).join(', ')}` };
    const rejects = bad.filter(t => t.cand.accepted === false).length;
    if (grade === 'gating' && bad.length && rejects < 1) return { ok: false, code: 'HEAL_NO_DISCRIMINATION', detail: 'the acceptance is gating but rejects none of the bed\'s bad controls' };
    return { ok: true, rejectsBad: rejects, badControls: bad.length, grade, ...(grade !== 'gating' ? { note: 'acceptance is not gating: controls cannot discriminate (lint debt open)' } : {}) };
  }))) return finish();

  // V6 ---------------------------------------------------------------------------------------------------------------------------------
  if (halt(await stage('V6', 'cost bound', async () => {
    const runs = [...data.replicas.map(r => ({ cand: r.rows.at(-1).fullUsd, base: r.recordedCostUsd })), ...(data.regression ?? []).map(r => ({ cand: r.fullUsd, base: r.recordedCostUsd }))].filter(r => r.base > 0);
    if (!runs.length) return { ok: true, note: 'no cost evidence' };
    const ratio = runs.reduce((s, r) => s + r.cand, 0) / runs.reduce((s, r) => s + r.base, 0), bound = Math.min(proposal.declaredCostRatio ?? P.costBound, P.costBoundMax);
    rec.costRatio = +ratio.toFixed(4);
    return ratio <= bound + 1e-9 ? { ok: true, ratio: +ratio.toFixed(4), bound } : { ok: false, code: 'HEAL_COST_BOUND', detail: `mean cost ratio ${ratio.toFixed(2)} > ${bound}` };
  }))) return finish();

  // V7 ---------------------------------------------------------------------------------------------------------------------------------
  if (halt(await stage('V7', 'fresh paired tasks', async () => {
    if (!P.fresh.enabled) return { ok: null, code: 'HEAL_FRESH_NOT_RUN', detail: 'fresh-task gate disabled (--no-fresh): the verification is incomplete' };
    if (!hooks.runTask && !providers) return { ok: null, code: 'HEAL_NEEDS_LIVE', detail: 'the fresh-task gate needs a live provider' };
    return await freshGate({ kit, base: baseWf, cand, incident, providers, budget, P, hooks, modelPolicy, sample: incident.sample, data });
  }))) return finish();

  // V8 ---------------------------------------------------------------------------------------------------------------------------------
  await stage('V8', 'locked graders', async () => {
    const now = (hooks.graders ?? gradersHash)(incident.family);
    return incident.gradersBefore && now.hash !== incident.gradersBefore.hash ? { ok: false, code: 'HEAL_GRADER_CHANGED', detail: 'a grader file changed during verification' } : { ok: true, hash: now.hash.slice(0, 16), files: now.files };
  });
  return finish();
}

// ---- V7 implementation -----------------------------------------------------------------------------------------------------------------
async function freshGate({ kit, base, cand, incident, providers, budget, P, hooks, modelPolicy, sample, data }) {
  const ref = incident.failing[0] ?? incident.passing[0], { n, k } = P.fresh;
  const ledger = hooks.ledger ?? loadLedger(), lib = await bedsLib();
  const makeTask = async seed => (await lib.makeTasks(ref.family, { split: 'dev', seeds: [seed], difficulty: ref.difficulty }))[0];
  const adapter = STRATA[ref.family], stratum = async t => adapter && sample?.identity ? adapter(t.task, sample.identity) : null;
  const counts = new Map(), perStratum = adapter && sample?.identity ? Math.ceil(n / 2) : n;
  const seeds = await draw({ ledger, family: ref.family, split: 'dev', difficulty: ref.difficulty, n, by: `heal fresh gate ${incident.id ?? ''}`.trim(), makeTask,
    keep: async task => { const s = await stratum(task); const c = counts.get(s) ?? 0; if (c >= perStratum) return false; counts.set(s, c + 1); return true; } });
  (hooks.saveLedger ?? saveLedger)(ledger);
  const estimate = seeds.length * k * ((incident.meanBaseCostUsd ?? 0.05) * 1.1 + 0.02);
  let release;
  try { release = budget.reserve(estimate, 'V7 fresh tasks'); } catch (e) { return { ok: null, code: 'HEAL_BUDGET_EXHAUSTED', detail: e.message, seeds: seeds.length }; }
  const runTask = hooks.runTask ?? (async ({ workflow, task, salt, seed, arm }) => {
    const pseudo = { source: ref.source, family: ref.family, split: 'dev', difficulty: ref.difficulty, seed, armId: `heal-fresh-${arm}`, trial: 0, key: `fresh/${seed}` };
    const ctx = incident.freshCtx ??= await openFreshCtx(kit, ref, providers, modelPolicy);
    const r = await replayRun(ctx, workflow, pseudo, { mode: 'replay-or-live', salt, task });
    return { pass: r.pass, costUsd: r.liveUsd + (r.unknownUpperUsd ?? 0), accepted: accepted(r) };
  });
  const rows = [];
  try {
    for (const seed of seeds) {
      const task = await makeTask(seed), s = await stratum(task);
      for (let i = 0; i < k; i++) {
        const salt = `heal-fresh:${seed}:${i}`;
        const b = await runTask({ workflow: base, task, salt, seed, arm: 'base' }); budget.charge(b.costUsd, `V7 base ${seed}#${i}`);
        const c = await runTask({ workflow: cand, task, salt, seed, arm: 'cand' }); budget.charge(c.costUsd, `V7 cand ${seed}#${i}`);
        rows.push({ seed, i, stratum: s, base: b.pass, cand: c.pass });
      }
    }
  } finally { release(); }
  data.fresh = rows;
  const sum = (arm, f = () => true) => rows.filter(f).reduce((s, r) => s + (r[arm] ? 1 : 0), 0);
  const bySeed = [...new Set(rows.map(r => r.seed))].map(seed => ({ seed, base: sum('base', r => r.seed === seed), cand: sum('cand', r => r.seed === seed) }));
  const strata = [...new Set(rows.map(r => r.stratum))].filter(Boolean).map(s => ({ stratum: s, tasks: new Set(rows.filter(r => r.stratum === s).map(r => r.seed)).size, base: sum('base', r => r.stratum === s), cand: sum('cand', r => r.stratum === s) }));
  const result = { seeds: seeds.length, k, base: sum('base'), cand: sum('cand'), strata, stratified: strata.length > 1 };
  if (result.cand < result.base) return { ok: false, code: 'HEAL_FRESH_WORSE', detail: `candidate ${result.cand} < base ${result.base} passes on ${rows.length} paired runs`, ...result };
  const lost = bySeed.filter(b => b.base === k && b.cand === 0);
  if (lost.length) return { ok: false, code: 'HEAL_FRESH_LOST_TASK', detail: `${lost.length} tasks the base passes ${k}/${k} and the candidate 0/${k}`, ...result };
  const worse = strata.filter(s => s.cand < s.base);
  if (worse.length) return { ok: false, code: 'HEAL_FRESH_STRATUM_WORSE', detail: `stratum ${worse.map(s => s.stratum).join(', ')} got worse`, ...result };
  return { ok: true, ...result };
}
async function openFreshCtx(kit, ref, providers, modelPolicy) {
  const file = path.join(WORK_ROOT, 'fresh', `fresh-${process.pid}-${Math.random().toString(36).slice(2, 7)}.sqlite`);
  const j = kit.emptyJournal(file), port = new kit.ModelPort({ policy: modelPolicy, providers: providers ?? {}, journal: j.journal, mode: 'replay-or-live', concurrency: { 'claude-cli': 8 } });
  return { kit, source: ref.source, policy: modelPolicy, port, journal: j.journal, db: j.db, file, runtime: { maxCost: 2, maxConcurrency: 8, maxDurationMs: 20 * 60 * 1000 }, close() { j.db.close(); } };
}

function summarise(d) {
  return { replicas: d.replicas.map(r => ({ trial: r.trial, rows: r.rows })), regression: d.regression?.map(({ trial, pass, status, regression, rejected, fullUsd }) => ({ trial, pass, status, regression, rejected, fullUsd })) ?? null, controls: d.controls, fresh: d.fresh };
}
