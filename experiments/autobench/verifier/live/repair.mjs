#!/usr/bin/env node
// VL-1R (VERIFIER-LAB.md §4.2, §5 step 6; secondary, pre-declared): one verifier-driven repair round on the primary pick
// of each task whose RL2 checks hold at least one FAILING HARD check of a high-precision type (msg_to, msg_has,
// created_has, created_in, effect_any). Run after step 4 (selection committed) and BEFORE step 5, so it stays blind: this
// file never opens a grade. The bridge writes each world's grade into its host directory; score.mjs reads them later.
//
//   node repair.mjs --selection <selection.json> [--primary P2/R3] --vlab <live lab> --rl2 <RL2 out> --rl2-tag look2
//       --live-root <runs root> --checkout <runner checkout (the pin)> --out <work dir> [--cap 1] [--budget 0.1]
//       [--model claude-haiku-5-5] [--timeout-min 20] [--plan-only] [--control-only] [--limit N (smoke runs only)]
//
// Per treated task, two bridge serves start from the pick's exported final world (the lab's copy) and the task's prep input:
//   control    no session (no model call); grade at stop. Measures how far a regrade of an exported world drifts from the
//              live grade (including in-memory state an export loses).
//   treatment  one claude-haiku-5-5 session: the official system prompt + the A0 tool section (date note on) + a generic
//              brief listing the failing requirements (the ledger's statement and the check's evidence); the official user
//              message. World steps are capped at min(10, 49 - steps the pick used) and model responses at
//              50 - responses the pick used; --budget per session, --cap for the whole round; the session is audited as
//              the runner audits one (H3/L5 violations are recorded and score the treatment as a fail).
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPAIR_VERSION = 'vl1-repair-v1';
export const HP_TYPES = Object.freeze(['msg_to', 'msg_has', 'created_has', 'created_in', 'effect_any']);
export const MAX_REPAIR_STEPS = 10, STEP_LIMIT = 49, RESPONSE_LIMIT = 50;
const RESULTS_ALLOW = ['steps', 'session'];

export const BRIEF_HEAD = `## Repair round
This task was already worked once, and the systems are in the state that work left. An independent check of the result
against the request and the records found the requirements below not met. Each line gives the requirement and what the
check saw.`;
export const BRIEF_RULES = `How to repair:
- Read the current state first.
- Do not repeat any effect that already exists (a message, record, row or update that is already there).
- Change only what the listed requirements need.
- If the records show that a listed requirement is wrong, leave it as it is.`;

/** The generic repair brief: requirement statements and check evidence only (RL2's own ledger, untrusted data). */
export function repairBrief(failing) {
  const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
  const lines = failing.map((f, i) => `${i + 1}. ${clip(f.statement || f.type, 300)} (check saw: ${clip(f.evidence, 200)})`);
  return `${BRIEF_HEAD}\n${lines.join('\n')}\n\n${BRIEF_RULES}`;
}

/** World-step and response caps for the repair session, from what the pick already used. */
export function repairCaps({ pickSteps, pickResponses }) {
  const worldSteps = Math.min(MAX_REPAIR_STEPS, STEP_LIMIT - (Number.isFinite(pickSteps) ? pickSteps : STEP_LIMIT));
  const responses = RESPONSE_LIMIT - (Number.isFinite(pickResponses) ? pickResponses : RESPONSE_LIMIT);
  return { worldSteps, responses };
}

/** Treated tasks: the primary pick of each task with at least one failing hard check of a high-precision type. */
export function repairPlan(selection, primary, checks) {
  const s = selection.selections.find(x => `${x.pool}/${x.rule}` === primary);
  if (!s) throw new Error(`repair: selection ${primary} not found`);
  const out = [];
  for (const [task, rowId] of Object.entries(s.rows)) {
    if (!rowId) continue;
    const c = checks.get(rowId);
    const failing = (c?.code ?? []).filter(k => k.hard && k.pass === false && HP_TYPES.includes(k.type)).map(k => ({ type: k.type, key: k.key, statement: k.statement ?? null, evidence: k.evidence ?? null }));
    if (failing.length) out.push({ task, rowId, run: rowId.slice(0, rowId.indexOf('/')), failing });
  }
  return out.sort((a, b) => a.task.localeCompare(b.task));
}

/** Per-fork fields this step reads from a run's results.jsonl (allowlist; no grade field). */
export function usedByPick(resultsFile, task) {
  if (!existsSync(resultsFile)) return { pickSteps: null, pickResponses: null };
  let rec = null;
  for (const l of readFileSync(resultsFile, 'utf8').split('\n').filter(Boolean)) {
    const d = JSON.parse(l);
    if (d.task === task) rec = Object.fromEntries(RESULTS_ALLOW.map(k => [k, d.forks?.[0]?.[k] ?? null]));
  }
  return { pickSteps: rec?.steps ?? null, pickResponses: rec?.session?.modelResponses ?? null };
}

/**
 * One treated task. deps: {startServe, materializeWorkdir, adapterText, runner, writeCliGuard, auditSession, readCalls,
 * readStream, keepRo}. Returns the record for repair.json; never reads a grade.
 */
export async function repairTask(item, { liveRoot, labDir, outDir, deps, model, budgetUsd, timeoutMs, ledger, controlOnly = false }) {
  const prep = path.join(liveRoot, item.run, 'prep', item.task);
  const readJson = f => JSON.parse(readFileSync(f, 'utf8'));
  const meta = readJson(path.join(prep, 'meta.json')), prompt = readJson(path.join(prep, 'prompt.json')), catalog = readJson(path.join(prep, 'catalog.json'));
  const base = path.join(outDir, item.task);
  mkdirSync(base, { recursive: true });
  const worldFile = path.join(base, 'pick-final-world.json');
  const gz = path.join(labDir, 'worlds', item.run, `${item.task}.final.json.gz`);
  const world = JSON.parse(gunzipSync(readFileSync(gz)).toString('utf8'));
  // the bridge's --world takes a prep-style file ({task, contract_sha256, world}) or a bare world; keep the prep shape
  writeFileSync(worldFile, JSON.stringify({ task: item.task, contract_sha256: meta.contract_sha256, world }));
  const rec = { task: item.task, rowId: item.rowId, run: item.run, failing: item.failing, caps: item.caps, worldSha256: createHash('sha256').update(JSON.stringify(world)).digest('hex') };

  // control: no session, no model call
  const controlHost = path.join(base, 'control');
  const cw = path.join(base, 'w-control');
  rmSync(cw, { recursive: true, force: true });
  deps.materializeWorkdir(cw, catalog);
  const c = deps.startServe({ liveDir: base, input: path.join(prep, 'input.json'), world: worldFile, mailbox: path.join(cw, '.tools'), hostDir: controlHost, det: 'record', maxSteps: 2, fork: 0, expectContract: meta.contract_sha256 });
  await c.ready;
  const cdone = await c.stop();
  rec.control = { host: controlHost, steps: cdone?.steps ?? null };
  rec.controlHost = controlHost;
  rmSync(cw, { recursive: true, force: true });
  if (controlOnly) return rec;

  if (!(item.caps.worldSteps >= 1 && item.caps.responses >= 2)) { rec.treatment = { skipped: `no room: ${JSON.stringify(item.caps)}` }; return rec; }
  if (!ledger.reserve(budgetUsd)) { rec.treatment = { skipped: `cap: spent ${ledger.spent.toFixed(4)} + ${budgetUsd} > ${ledger.cap}` }; return rec; }
  const treatmentHost = path.join(base, 'treatment');
  const tw = path.join(base, 'w-treatment');
  rmSync(tw, { recursive: true, force: true });
  deps.materializeWorkdir(tw, catalog);
  const maxSteps = item.caps.worldSteps + 1;   // the bridge and the tool section allow maxSteps - 1 world steps
  const guard = deps.writeCliGuard(path.join(outDir, 'harness-bin', item.task), { maxTurns: item.caps.responses });
  const t = deps.startServe({ liveDir: base, input: path.join(prep, 'input.json'), world: worldFile, mailbox: path.join(tw, '.tools'), hostDir: treatmentHost, det: 'record', maxSteps, fork: 0, expectContract: meta.contract_sha256 });
  let r = null;
  try {
    await t.ready;
    const systemPrompt = `${prompt.system}\n\n${deps.adapterText(catalog, maxSteps, { dateNote: true })}\n\n${repairBrief(item.failing)}`;
    r = await deps.runner({ model, prompt: prompt.user, systemPrompt, workdir: tw, files: {}, budgetUsd, timeoutMs, effort: null, tools: ['Bash'], task: { name: item.task, fork: 0 },
      maxTurns: item.caps.responses, binary: guard.binary, keepRo: [...deps.keepRo, guard.dir] });
  } finally {
    const tdone = await t.stop().catch(e => ({ error: String(e?.message ?? e) }));
    ledger.settle(budgetUsd, r);
    const transcript = path.join(tw, '.executor-transcript.jsonl');
    if (existsSync(transcript)) writeFileSync(path.join(treatmentHost, 'transcript.jsonl'), readFileSync(transcript));
    const calls = deps.readCalls(path.join(treatmentHost, 'calls.jsonl'));
    const events = deps.readStream(path.join(treatmentHost, 'transcript.jsonl'));
    // the runner's audit with the round's own response allowance (50 - responses the pick used): over it is H3; L5 as usual
    const audit = deps.auditSession({ events, calls, maxSteps: item.caps.responses, fallbackTurns: r?.turns ?? null, expectModel: r?.label === 'scripted' ? null : model });
    const violations = [...(audit.violations ?? [])];
    if (r?.label !== 'scripted' && !events.length) violations.push('L5: no host transcript');
    rec.treatment = { host: treatmentHost, steps: tdone?.steps ?? null, worldCalls: calls.length, costUsd: r?.costUsd ?? null, costUnknown: Boolean(r?.costUnknown), turns: r?.turns ?? null,
      sessionError: r?.error?.code ?? null, modelResponses: audit.modelResponses ?? null, violations, stopError: tdone?.error ?? null };
    rec.treatmentHost = treatmentHost;
    rmSync(tw, { recursive: true, force: true });
  }
  return rec;
}

export function makeLedger(cap) {
  return { cap, spent: 0, reserved: 0,
    reserve(b) { if (this.spent + this.reserved + b > this.cap + 1e-12) return false; this.reserved += b; return true; },
    settle(b, r) { this.reserved -= b; this.spent += r ? (r.costUsd ?? r.costUpperUsd ?? b) : b; } };
}

/** Real dependencies, from the runner checkout (so the bridge and accounting are the forks' own). */
export async function checkoutDeps(checkout) {
  const u = p => pathToFileURL(path.join(checkout, p)).href;
  const lib = await import(u('experiments/autobench/lib.mjs'));
  const acc = await import(u('experiments/autobench/accounting.mjs'));
  const harness = await import(u('experiments/autobench/harness/foundry.mjs'));
  const exec = await import(u('src/executors/claude-code.mjs'));
  return { startServe: lib.startServe, materializeWorkdir: lib.materializeWorkdir, adapterText: lib.adapterText, runner: exec.runClaudeCode,
    writeCliGuard: harness.writeCliGuard, auditSession: acc.auditSession, readCalls: acc.readCalls, readStream: acc.readStream, keepRo: exec.DEFAULT_KEEP_RO,
    policy: await import(u('src/models/policy.mjs')) };
}

export async function runRepair(o, deps) {
  const selection = JSON.parse(readFileSync(o.selection, 'utf8'));
  const tag = o.rl2Tag ? `-${o.rl2Tag}` : '';
  const checks = new Map(readFileSync(path.join(o.rl2, `checks${tag}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(c => [c.rowId, c]));
  const plan = repairPlan(selection, o.primary, checks);
  if (o.limit) plan.splice(Number(o.limit));   // smoke runs only
  for (const it of plan) it.caps = repairCaps(usedByPick(path.join(o.liveRoot, it.run, 'results.jsonl'), it.task));
  const out = { version: REPAIR_VERSION, primary: o.primary, selectionSha256: createHash('sha256').update(readFileSync(o.selection)).digest('hex'), model: o.model, capUsd: o.cap, budgetUsd: o.budget,
    hpTypes: HP_TYPES, planned: plan.map(p => ({ task: p.task, rowId: p.rowId, nFailing: p.failing.length, caps: p.caps })), treated: [], startedAt: new Date().toISOString() };
  if (o.planOnly) return out;
  const ledger = makeLedger(o.cap);
  for (const it of plan) {
    try { out.treated.push(await repairTask(it, { liveRoot: o.liveRoot, labDir: o.vlab, outDir: o.out, deps, model: o.model, budgetUsd: o.budget, timeoutMs: o.timeoutMin * 60_000, ledger, controlOnly: o.controlOnly })); }
    catch (e) { out.treated.push({ task: it.task, rowId: it.rowId, error: String(e?.message ?? e).slice(0, 500) }); }
    writeFileSync(path.join(o.out, 'repair.json'), JSON.stringify(out, null, 1) + '\n');
  }
  out.spentUsd = ledger.spent;
  out.finishedAt = new Date().toISOString();
  return out;
}

function args(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument ${argv[i]}`);
    const k = argv[i].slice(2);
    if (['plan-only', 'control-only'].includes(k)) a[k] = true; else a[k] = argv[++i];
  }
  return a;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const a = args(process.argv.slice(2));
    for (const k of ['selection', 'vlab', 'rl2', 'live-root', 'checkout', 'out']) if (!a[k]) throw new Error(`--${k} is required`);
    const o = { selection: a.selection, primary: a.primary ?? 'P2/R3', vlab: path.resolve(a.vlab), rl2: path.resolve(a.rl2), rl2Tag: a['rl2-tag'] ?? '', liveRoot: path.resolve(a['live-root']),
      out: path.resolve(a.out), cap: Number(a.cap ?? 1), budget: Number(a.budget ?? 0.1), model: a.model ?? 'claude-haiku-5-5', timeoutMin: Number(a['timeout-min'] ?? 20),
      planOnly: Boolean(a['plan-only']), controlOnly: Boolean(a['control-only']), limit: a.limit ? Number(a.limit) : null };
    if (!(o.cap > 0 && o.cap <= 1)) throw new Error('--cap must be in (0, 1] (VL-1R is capped at $1)');
    mkdirSync(o.out, { recursive: true });
    const deps = await checkoutDeps(path.resolve(a.checkout));
    deps.policy.modelById(deps.policy.loadPolicy().policy, o.model);   // the model id must be in the owner policy
    const res = await runRepair(o, deps);
    writeFileSync(path.join(o.out, 'repair.json'), JSON.stringify(res, null, 1) + '\n');
    console.log(JSON.stringify({ planned: res.planned.length, treated: res.treated.length, spentUsd: res.spentUsd ?? 0, out: path.join(o.out, 'repair.json') }));
  } catch (e) { console.error(e.stack ?? String(e)); process.exit(1); }
}
