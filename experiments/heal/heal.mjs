#!/usr/bin/env node
// Auto-heal driver (research/heal-20261008/DESIGN.md). One incident, offline, in this order:
//   DETECT -> CLASSIFY -> LOCALISE (counterfactual replay, $0) -> PROPOSE (mechanical lint-debt ops; model ops through the journaled
//   model layer) -> VERIFY V0..V8 (all code) -> PROMOTE (pure decision, compare-and-swap, lineage) -> LEARN (lesson proposals).
// The model only proposes. Code applies patches, runs every gate and promotes or rolls back. Dev/diagnostic evidence only: the three
// incidents it was built on are already-inspected test seeds.
//
//   node experiments/heal/heal.mjs --run F-haiku/codefix:test:d3:s6004/0 \
//        --workflow research/construction-20261006/artifacts/F-haiku-codefix-k1/workflow.json --budget-usd 2 [options]
//   node experiments/heal/heal.mjs --run fhand-haiku/records:test:d3:s5002/1 --workflow preset:p1-fhand-haiku --budget-usd 1
//
//   --run REF                 run id, or ARM/TASKKEY/TRIAL (trial key), or TASKKEY#TRIAL
//   --workflow PATH|preset:   the workflow the run executed (JSON file, or preset:p1-fhand-haiku / preset:p1-fhand-sonnet); the harness proves it by replay
//   --budget-usd N            cap on every dollar this driver may cause (default 0 = replay-only, nothing live)
//   --live                    allow live calls (changed nodes in V3/V4/V7, the proposer, the variance test) through the claude -p route
//   --proposer none|claude|scripted:FILE   who proposes the defect patch (default: claude with --live, otherwise none)
//   --lint-debt strict|defer  V1 on defect proposals: strict (default with --promote) needs zero lint errors; defer allows the open debt and blocks promotion
//   --no-fresh                skip the fresh-task gate (V7): the verification stays pending, never promotable
//   --promote                 act on decision `promote`: compare-and-swap on the lineage head, one line in lineage.jsonl (default: dry)
//   --stages V0,V1,...        run only these stages;  --max-rounds N;  --concurrency N;  --write-lessons;  --out FILE;  --state DIR
//   approve  --proposal ID --owner NAME     promote a queued owner-review proposal (an explicit owner action)
//   rollback --workflow-id ID --to HASH     restore a parent's content as a new head version
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { REPO, WORK_ROOT, loadKit, assertNotSealed } from './kit.mjs';
import { loadGate } from './pin-gate.mjs';
import { allTrials, findTrial, loadWorkflow, p1Workflow, openCtx, replayRun, fidelity, taskOf, bedsLib, acceptedCalls, pmap, SOURCES } from './replay.mjs';
import { detect, classifyEarly, classifyLate } from './detect.mjs';
import { localise, varianceTest } from './localise.mjs';
import { allowedOpsFor } from './ops.mjs';
import { buildBrief, codeRootEvidence, locusNodeIds, mechanicalProposal, proposeLoop, scriptedProviders, liveProviders, bindOf } from './propose.mjs';
import { verify, gradersHash } from './verify.mjs';
import { decide, Lineage } from './promote.mjs';
import { lessonFor, writeLesson, LESSON_DIR, population as workflowPopulation } from './learn.mjs';
import { buildLeakIndex, taskTexts } from './scan.mjs';
import { Budget } from './budget.mjs';
import { loadLedger, saveLedger, isUsed } from './seeds.mjs';
import { resolveNode, shapeKey, digest, canonical, getAt } from './ir.mjs';

export const RUN = 'heal-run/1';
const log = (...a) => process.stderr.write(`[heal] ${a.join(' ')}\n`);
const PRESETS = { 'preset:p1-fhand-haiku': () => p1Workflow('M'), 'preset:p1-fhand-sonnet': () => p1Workflow('L') };

// What verify needs to know about the incident (dev oracle data stays inside heal code; the proposer never sees it).
export async function buildIncident({ kit, trial, workflow, pool, localisation, ctx0, base, bed }) {
  const lib = await bedsLib(), fam = await lib.loadFamily(trial.family);
  const failing = [], passing = [], tasks = {}, baseRuns = {};
  // Pool the trials of this workflow: the failing ones are the incident, the passing ones are the regression slice. A pooled trial
  // whose replay does not reproduce its record cannot be healed or regressed against: excluded and reported.
  const excluded = [];
  await pmap(pool, 3, async t => {
    const c = await openCtx(t.source, { kit, name: 'pool' });
    try {
      const task = t.key === trial.key ? bed.task : await taskOf(t);
      const r = t.key === trial.key ? base : await replayRun(c, workflow, t, { task });
      // 2026-11-04 (FH-1 review m8): keep what diverged and how the replay ended, so a recurrence of the 10-21 P1 exclusion names
      // its cause (a wall-clock DEADLINE or TOOL_TIMEOUT under CPU starvation, or a real divergence) instead of only the label.
      const f = fidelity(t, r);
      if (!f.identical) { excluded.push({ trial: t.key, why: 'REPLAY_INFIDELITY', diverged: Object.keys(f.checks).filter(k => !f.checks[k]), status: r.status ?? null, error: r.error?.code ?? null }); return; }
      tasks[t.key] = task; baseRuns[t.key] = { outputs: r.outputs, answer: r.answer, taskHash: r.taskHash };
      (t.pass ? passing : failing).push(t);
    } finally { c.close(); }
  });
  failing.sort((a, b) => a.key.localeCompare(b.key)); passing.sort((a, b) => a.key.localeCompare(b.key));
  const answerKeys = base.answer && typeof base.answer === 'object' && !Array.isArray(base.answer) ? Object.keys(base.answer) : [];
  // recorded values per node, for the tighten proof: templates (all), wrong (the flipped rows of failing runs), accepted (passing runs)
  const recorded = {};
  const place = (nodeKey, runKind, value) => { const id = shapeKey(nodeKey).split('/').slice(1).join('/'); const r = recorded[id] ??= { templates: [], wrong: [], accepted: [] }; r.templates.push(value); r[runKind].push(value); };
  for (const t of [...passing, ...failing]) for (const row of acceptedCalls(ctx0.journal, t.runId)) place(row.nodeKey, t.pass ? 'accepted' : 'templates', row.response.value);
  for (const f of localisation.suspects?.[0]?.flips ?? []) { const row = f.rowId != null ? ctx0.journal.get(f.rowId) : null; if (row) place(row.nodeKey, 'wrong', row.response.value); }
  // check inputs for relax proofs: the resolved args of every code node, from the primary failing trial
  const checkInputs = {};
  for (const n of workflow.nodes.filter(x => x.kind === 'code' && x.lang === 'python')) {
    try { const args = kit.data.resolve(n.args ?? {}, { input: { prompt: bed.task.task.prompt, inputs: bed.task.task.inputs ?? {} }, nodes: base.outputs }); checkInputs[n.id] = { args, moduleSource: args.source ?? null, texts: [bed.task.task.prompt, ...Object.values(bed.task.task.inputs ?? {}).filter(v => typeof v === 'string')] }; } catch { /* a node whose args need a map frame has no battery */ }
  }
  const reference = fam.referenceSolve(bed.task.task);
  // The controls are pinned into one recorded run (V5), so that run's other evidence must agree with the truth: a failing run's evidence
  // is partly wrong by definition (P1: a mis-judged status in merge), and a consistency check would then rightly reject the bed's own
  // reference answer. So the host is a recorded PASSING run (first by key) and the controls are made from that run's task; the failing
  // run hosts them only when no recorded run of this workflow passed.
  const host = passing[0] ?? trial, hostTask = host.key === trial.key ? bed.task.task : tasks[host.key].task;
  const controls = { answerKeys, trialKey: host.key, items: [{ name: 'reference', expect: 'accept', output: fam.referenceSolve(hostTask) }, ...fam.badControls.map(c => { try { return { name: c.name, expect: 'reject', output: c.make(hostTask) }; } catch { return null; } }).filter(Boolean)] };
  // Public text of the family: its description and output schema; plus the FULL text (prompt, inputs, files) of six other tasks. A phrase or
  // number that recurs in ALL of those tasks is a template constant, not a literal of the failing task (live run 1, 2026-10-08: rule 1
  // rejected "the system's name" and "source notes" as copied task text). Text shared with only some tasks (a convention sentence that
  // two tasks happen to share) is still a literal (review 2026-10-08).
  const other = await lib.makeTasks(trial.family, { split: 'dev', seeds: [9101, 9102, 9103, 9104, 9105, 9106], difficulty: trial.difficulty });
  const flips = localisation.suspects?.[0]?.flips ?? [];
  const leakIndex = buildLeakIndex({ tasks: failing.map(t => tasks[t.key].task), outputs: failing.map(t => baseRuns[t.key].outputs), truthStrings: [JSON.stringify(reference)],
    truthPairs: flips.filter(f => f.identity && f.to != null).flatMap(f => Object.values(f.identity).map(id => ({ id, value: String(f.to) }))),
    publicTexts: [fam.family?.description ?? '', JSON.stringify(fam.outputSchema ?? {})], familyTasks: other.map(o => taskTexts(o.task)), baseWorkflow: workflow });
  const costs = [...failing, ...passing].map(t => t.costUsd);
  return { family: trial.family, oracle: true, failing, passing, tasks, baseRuns, excluded, recorded, checkInputs, controls, leakIndex, gradersBefore: gradersHash(trial.family),
    sample: localisation.root?.sample ?? null, classes: (localisation.classes ?? []).map(c => c.code), meanBaseCostUsd: costs.reduce((s, c) => s + c, 0) / Math.max(1, costs.length), id: null };
}

const specKey = a => (a.startsWith('scripted:') ? 'scripted' : a);

export async function healIncident(o) {
  const started = Date.now(), runsDir = o.runsDir ?? path.join(WORK_ROOT, 'runs', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(runsDir, { recursive: true });
  const kit = await loadKit(), gate = await loadGate();
  const budget = o.budget ?? new Budget(o.budgetUsd ?? 0, { file: path.join(runsDir, 'spend.jsonl') });
  const trials = o.trials ?? allTrials(), trial = o.trial ?? findTrial(o.run, trials);
  assertNotSealed(trial);
  const workflow = typeof o.workflow === 'string' && PRESETS[o.workflow] ? await PRESETS[o.workflow]() : await loadWorkflow(o.workflow);
  const out = { schema: RUN, started: new Date().toISOString(), trial: { key: trial.key, runId: trial.runId, family: trial.family, split: trial.split, seed: trial.seed, pass: trial.pass, score: trial.score }, kit: { hash: kit.kitHash, commit: kit.commit, policyHash: kit.ownerPolicyHash },
    gate: { source: gate.source, commit: gate.commit, live: gate.live }, mode: { live: !!o.live, promote: !!o.promote, proposer: o.proposer ?? 'none' }, stages: {}, proposals: [], decisions: [] };
  // Evidence tier (AGENTS.md): every heal is development/diagnostic. A seed the ledger does not know is consumed by this heal, never fresh again.
  const ledger = o.ledger ?? loadLedger(), inspected = isUsed(ledger, trial.family, trial.split, trial.difficulty, trial.seed);
  out.evidence = { tier: 'development/diagnostic', split: trial.split, seed: trial.seed, inspected, note: inspected ? 'the seed is already in the seed ledger (INSPECTED): this proves plumbing, not a fix rate' : 'the seed was not in the seed ledger: it is consumed by this heal and can never be fresh again' };
  if (!inspected) { ledger.entries.push({ family: trial.family, split: trial.split, difficulty: trial.difficulty, seeds: [trial.seed], by: `heal incident ${trial.key}`, at: new Date().toISOString() }); (o.saveLedger ?? saveLedger)(ledger); }
  const done = () => { out.budget = budget.summary(); out.ms = Date.now() - started; out.runsDir = runsDir; return out; };

  // ---- 1. base replay, DETECT, CLASSIFY (early) ------------------------------------------------------------------------------------
  const ctx0 = await openCtx(trial.source, { kit, name: 'base' });
  let incidentRef = null;   // closed in the finally below: its fresh-task journal handle (V7) must be released so the WAL is checkpointed
  try {
    const bed = { task: await taskOf(trial) };
    const base = await replayRun(ctx0, workflow, trial, { task: bed.task });
    out.fidelity = fidelity(trial, base);
    const population = trials.filter(t => t.source === trial.source && t.armId === trial.armId && t.family === trial.family);
    const det = await detect({ trial, workflow, base, population, kit, ctx: ctx0, gate, withVacuity: o.vacuity !== false });
    out.signals = det.byKind; out.lint = { counts: det.lint.counts, codes: det.lint.codes }; out.verdict = { pinned: det.verdict.verdict, code: det.verdict.code };
    const early = classifyEarly({ trial, fidelity: out.fidelity, base });
    out.classification = early;
    if (!early.heal) return done();

    // ---- 2. LOCALISE ---------------------------------------------------------------------------------------------------------------
    log('localising', trial.key);
    const loc = await localise({ trial, workflow, kit, trials, concurrency: o.concurrency ?? 3, onProgress: o.progress ? (d, n) => log(`candidate ${d}/${n}`) : null });
    out.localisation = { root: loc.root, classes: loc.classes, mode: loc.mode, coverage: loc.coverage, intermediates: loc.intermediates, variance: loc.variance, flippers: loc.flippers, ms: loc.ms, blocked: loc.blocked ?? null };
    let variance = null;
    // the per-call cap of the claude -p route never exceeds what the driver may still spend
    const providers = o.providers ?? (o.live ? liveProviders(kit, undefined, Math.min(o.perCallCapUsd ?? 1, Math.max(0.01, budget.capUsd))) : null);
    if (loc.root?.sample?.type === 'inject' && providers && o.live && budget.remaining() >= 0.1) {
      const j = kit.emptyJournal(path.join(runsDir, 'variance', 'journal.sqlite'));
      const port = new kit.ModelPort({ policy: ctx0.policy, providers, journal: j.journal, mode: 'live' });
      variance = await varianceTest({ journal: ctx0.journal, port, workflow, trial, rowId: loc.root.sample.rowId, path: loc.root.sample.pathArr, passingValue: loc.root.sample.to });
      budget.charge(variance.costUsd, 'variance test'); j.db.close(); out.variance = variance;
    }
    const late = classifyLate({ localisation: loc, variance });
    out.classification = { ...late, early: early.class };
    const incident = incidentRef = await buildIncident({ kit, trial, workflow, pool: population, localisation: loc, ctx0, base, bed });
    incident.id = `${trial.family}-${digest(workflow).slice(0, 8)}`;
    incident.freshDir = path.join(runsDir, 'fresh');   // the V7 journal is evidence: keep it with the run, not only in the work root
    out.incident = { id: incident.id, failing: incident.failing.map(t => t.key), passing: incident.passing.length, excluded: incident.excluded };

    // ---- 3. lineage, lint debt first ---------------------------------------------------------------------------------------------------
    const lineage = new Lineage({ kit, dir: o.stateDir ?? path.join(WORK_ROOT, 'state', incident.id), file: o.lineageFile });
    try {
      let head = lineage.open(workflow);
      const modelPolicy = ctx0.policy, env = { classOrder: modelPolicy.classOrder, classOf: id => kit.policy.modelById(modelPolicy, id).class, isStrong: gate.isStrong };
      const policy = { lintDebt: o.lintDebt ?? (o.promote ? 'strict' : 'defer'), fresh: { enabled: o.fresh !== false, ...(o.freshOpts ?? {}) }, ...(o.verifyPolicy ?? {}) };
      const stages = o.stages ? o.stages.split(',') : null;
      const runVerify = async proposal => {
        const v = await verify({ kit, gate, budget, base: { workflow: head.workflow, hash: head.hash }, proposal, incident, providers: o.live ? providers : (o.providers ?? null), policy, hooks: o.hooks ?? {}, stages, sourcePolicy: modelPolicy,
          evidenceFile: path.join(runsDir, 'verify-live', `${proposal.id}.sqlite`) });
        const d = decide(v, proposal, o.decidePolicy);
        out.decisions.push({ proposal: proposal.id, kind: proposal.kind, ops: proposal.ops.map(x => x.op), decision: d.decision, reasons: d.reasons, rejectCode: v.rejectCode, stages: v.stages.map(s => ({ id: s.id, ok: s.ok, code: s.code, detail: s.detail, costUsd: s.costUsd })), costUsd: v.costUsd, costRatio: v.costRatio ?? null });
        return { v, d };
      };
      const act = (proposal, v, d) => {
        mkdirSync(path.join(lineage.dir, 'proposals'), { recursive: true });
        writeFileSync(path.join(lineage.dir, 'proposals', `${proposal.id}.json`), JSON.stringify({ proposal, verification: v, decision: d }, null, 1));
        if (d.decision === 'promote' && o.promote) {
          const r = lineage.promote({ proposal, verification: v, decision: d, kitHash: kit.kitHash, lintPin: { commit: gate.commit, blobs: gate.blobs }, policyHash: kit.ownerPolicyHash });
          head = lineage.head(workflow.id); return { promoted: r };
        }
        if (d.decision === 'owner-review') { lineage.queueReview({ proposal, verification: v, decision: d }); return { queued: true }; }
        return {};
      };

      const mech = mechanicalProposal({ base: head.workflow, baseHash: head.hash, lint: gate.lintWorkflow(head.workflow, { modelPolicy }), env, bind: bindOf({ kit, gate, workflow: head.workflow, hash: head.hash }) });
      out.lintDebt = { ops: mech.proposal?.ops ?? [], needsProposer: mech.needsProposer, ...(mech.errors ? { errors: mech.errors } : {}) };
      if (mech.proposal) {
        out.proposals.push({ id: mech.proposal.id, kind: 'lint-debt', ops: mech.proposal.ops });
        const { v, d } = await runVerify(mech.proposal);
        Object.assign(out.decisions.at(-1), act(mech.proposal, v, d));
        out.lintDebt.decision = d.decision;
      }

      // ---- 4. PROPOSE the defect patch, VERIFY, PROMOTE -----------------------------------------------------------------------------------
      if (late.heal && loc.root) {
        const allowed = allowedOpsFor(loc.classes.map(c => c.code), { allocatorOnly: late.allocatorOnly });
        const loci = locusNodeIds(loc, head.workflow), locus = loci.map(l => l.in ? `${l.in}/${l.node}` : l.node);
        const lint = gate.lintWorkflow(head.workflow, { modelPolicy });
        // An agent root has a journaled prompt (what the node read). A code root (a check) has none: give it the task statement and inputs
        // plus its own failure report (2026-10-08 live run 1 found the proposer blind there and falling back to a no-op probe).
        const agentRoot = loc.root.sample.rowId != null, codeEv = agentRoot ? null : codeRootEvidence({ task: bed.task.task, output: base.outputs?.[loc.root.node] });
        const excerptSources = agentRoot ? [{ label: 'what the node read', text: ctx0.journal.get(loc.root.sample.rowId)?.request?.prompt }] : codeEv.sources;
        const recordedOutput = agentRoot ? ctx0.journal.get(loc.root.sample.rowId)?.response?.value : codeEv.recordedOutput;
        const excerptTokens = codeEv?.tokens ?? [], roundRobin = !agentRoot;
        const proposerSpec = o.proposer ?? (o.live ? 'claude' : 'none');
        out.proposer = { spec: proposerSpec, allowed, locus };
        if (proposerSpec !== 'none' && (proposerSpec.startsWith('scripted:') || (o.live && budget.remaining() >= 0.05))) {
          const pp = proposerSpec.startsWith('scripted:') ? scriptedProviders(kit, JSON.parse(readFileSync(proposerSpec.slice(9), 'utf8'))) : providers;
          const buildFor = priorRejects => buildBrief({ incidentId: incident.id, workflow: head.workflow, signals: det.byKind, classification: late, localisation: loc, lint, classes: loc.classes, allowedOps: allowed, excerptSources, excerptTokens, roundRobin, recordedOutput, failingRunKeys: incident.failing.map(t => t.key), variance, priorRejects, budget: { remainingUsd: +budget.remaining().toFixed(3) } });
          const loop = await proposeLoop({ kit, gate, workflow: head.workflow, base: head.workflow, buildFor, allowed, locus, classes: loc.classes, providers: pp, journalDir: path.join(runsDir, 'proposer'), budget, maxRounds: o.maxRounds ?? 4, ...env,
            check: async proposal => { proposal.depth = lineage.depthOf(workflow.id); proposal.healedWithoutOracle = false; const { v, d } = await runVerify(proposal); proposal.__v = v; proposal.__d = d; return { ok: d.decision === 'promote' || d.decision === 'owner-review' || d.decision === 'blocked', pending: d.decision === 'pending', rejectCode: v.rejectCode }; } });
          out.proposerRounds = loop.attempts; out.proposerEvents = loop.events;
          if (loop.proposal) {
            const { __v: v, __d: d, ...proposal } = loop.proposal;
            out.proposals.push({ id: proposal.id, kind: 'defect', ops: proposal.ops, rationale: proposal.rationale, citations: proposal.citations, proposer: proposal.proposer });
            Object.assign(out.decisions.at(-1), act(proposal, v, d));
            out.result = { decision: d.decision, reasons: d.reasons };
            out.healedWorkflow = proposal.workflow;
          } else out.result = { decision: 'exhausted', reasons: loop.priorRejects };
        } else out.proposer.skipped = proposerSpec === 'none' ? 'no proposer selected (offline run: localisation and lint debt only)' : 'live proposer needs --live and budget';
      }
      out.head = { hash: head.hash, version: head.workflow.version };
    } finally { lineage.close(); }

    // ---- 5. LEARN ---------------------------------------------------------------------------------------------------------------------
    const flips = loc.candidates.filter(c => c.node === loc.root?.sample?.node && !c.needsLive && c.ran !== false);
    const fragility = loc.root ? { [loc.root.node]: Math.max(0, ...flips.map(c => c.changedShare)) } : {};
    const probeTrials = trials.filter(t => t.source === trial.source && t.armId === trial.armId && t.family === trial.family && t.kind === 'probes');
    const rootNode = loc.root && workflow.nodes.find(n => n.id === loc.root.node);
    const probes = rootNode?.kind === 'agent' && probeTrials.length ? { returns: rootNode.returns, outputs: probeTrials.flatMap(t => acceptedCalls(ctx0.journal, t.runId).filter(r => r.nodeKey === `root/${rootNode.id}`).map(r => r.response.value)) } : null;
    const pop = [...workflowPopulation(), { name: 'records-v3(M)', workflow: await p1Workflow('M') }, { name: 'records-v3(L)', workflow: await p1Workflow('L') }];
    const lesson = lessonFor({ incidentId: incident.id, classes: loc.classes, base: workflow, healed: out.healedWorkflow ?? null, population: pop, fragility, probes, signalCounts: det.byKind, vacuity: det.vacuity ?? [] });
    if (lesson) { out.lesson = { id: lesson.id, lesson: lesson.lesson, lintRule: lesson.lintRule, firing: lesson.firing, status: lesson.status }; if (o.writeLessons) out.lesson.file = writeLesson(lesson, o.lessonsDir ?? LESSON_DIR); }
    return done();
  } finally { ctx0.close(); try { incidentRef?.freshCtx?.close(); } catch { /* already closed */ } }
}

// ---- CLI ---------------------------------------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const o = { _: [] }, flags = new Set(['live', 'promote', 'no-fresh', 'write-lessons', 'progress', 'no-vacuity']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    if (flags.has(k)) o[k.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = true; else o[k.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  return o;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a._[0] === 'approve' || a._[0] === 'rollback') {
    const kit = await loadKit(), lineage = new Lineage({ kit, dir: a.state ?? path.join(WORK_ROOT, 'state', a.stateName ?? 'default'), file: a.lineageFile });
    try {
      if (a._[0] === 'approve') {
        const f = path.join(lineage.dir, 'proposals', `${a.proposal}.json`), { proposal, verification, decision } = JSON.parse(readFileSync(f, 'utf8'));
        console.log(JSON.stringify(lineage.approveReview({ proposal, verification, owner: a.owner, decision }), null, 1));
      } else console.log(JSON.stringify(lineage.rollback({ id: a.workflowId, toHash: a.to, reason: a.reason ?? 'manual rollback' }), null, 1));
    } finally { lineage.close(); }
    return;
  }
  if (!a.run || !a.workflow) { console.error('usage: heal.mjs --run <runId|trial key> --workflow <path|preset:p1-fhand-haiku> --budget-usd N [--live] [--promote] ... (see the header of this file)'); process.exit(2); }
  const result = await healIncident({ run: a.run, workflow: a.workflow, budgetUsd: Number(a.budgetUsd ?? 0), live: !!a.live, promote: !!a.promote, proposer: a.proposer, lintDebt: a.lintDebt, fresh: !a.noFresh,
    stages: a.stages, maxRounds: a.maxRounds ? Number(a.maxRounds) : undefined, concurrency: a.concurrency ? Number(a.concurrency) : undefined, writeLessons: !!a.writeLessons, stateDir: a.state, lineageFile: a.lineageFile,
    runsDir: a.runs, progress: !!a.progress, vacuity: !a.noVacuity });
  const text = JSON.stringify(result, null, 1);
  if (a.out) { mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true }); writeFileSync(a.out, text + '\n'); }
  console.log(text);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().then(() => process.exit(0), e => { console.error(e.stack ?? e); process.exit(1); });
