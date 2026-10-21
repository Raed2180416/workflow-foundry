// Running a workflow in a world of local stand-ins, by code (no model): the builder's practice loop, the service's dry run of a library
// flow, and the evaluation harness's hidden-world runs all go through here.
//
//   practice  the practice registry: outbox.send and chat.post write practice files and ask nobody (a practice pass is evidence about
//             the workflow, not about delivery).
//   live      the live registry: every send and post asks a person first (engine approval bound to tool, arguments and workflow hash).
//             `approve(pending)` stands in for that person: it returns true or false per paused action, and each decision is counted.
//
// The world is a fresh directory per run: sheets seeded from the given data, an empty outbox and chat. Nothing leaves the machine.
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Foundry } from '../../src/foundry.mjs';
import { validateWorkflow, requireWorkflow } from '../../src/validate.mjs';
import { errorData } from '../../src/data.mjs';
import { appRegistry } from './capabilities.mjs';
import { explainRun } from './explain.mjs';
import { seedWorld, readWorld, readOutbox } from './stand-ins.mjs';

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'uncertain']);

/** Strict validation against the LIVE registry (so a retried send is refused as UNSAFE_RETRY), as FoundryApp.propose requires. */
export function validateStrict(workflow) {
  const registry = appRegistry({ mode: 'live', outboxDir: path.join(tmpdir(), 'foundry-validate-only', 'outbox') });
  try { return validateWorkflow(workflow, { registry, strict: true }); }
  catch (error) { return { valid: false, errors: [errorData(error)], warnings: [] }; }
}

/**
 * Run `workflow` once in a fresh world. Returns { status, verdict, passed, run, explained, effects, world, approvals, error, dir }.
 * effects: { outbox: [{to, subject, body}], chat: {channel: [text]}, appended: {sheet: rows} } left by this run.
 * Keeps the directory only when keep is true (the caller then removes it).
 */
export async function runInWorld(workflow, { sheets = {}, input = {}, mode = 'practice', approve = null, keep = false, root = null, maxResumes = 200 } = {}) {
  const dir = mkdtempSync(path.join(root ?? tmpdir(), `foundry-${mode}-`));
  const worldDir = path.join(dir, 'world'), outboxDir = path.join(dir, 'outbox');
  mkdirSync(worldDir, { recursive: true, mode: 0o700 });
  seedWorld(worldDir, { sheets });
  const registry = appRegistry({ mode, outboxDir, worldDir });
  const foundry = new Foundry(path.join(dir, 'store'), { registry });
  const out = { dir, mode, status: 'not-started', verdict: null, passed: false, approvals: { asked: 0, approved: 0, refused: 0 }, error: null };
  try {
    // Validate, then stage the exact version (its id, version number and hash) without a head, as FoundryApp's dry run does.
    let staged;
    try { requireWorkflow(workflow, { registry, modelPolicy: foundry.modelPolicy }); staged = foundry.store.stageEvaluationWorkflow(workflow); }
    catch (error) { out.status = 'invalid'; out.error = { ...errorData(error), details: error.details ?? null }; return out; }
    let run;
    try { run = foundry.createRun(staged.hash, input); }
    catch (error) { out.status = 'input-refused'; out.error = { ...errorData(error), details: error.details ?? null }; return out; }
    let current = await foundry.startRun(run.id).catch(error => ({ status: 'failed', error: errorData(error) }));
    current = foundry.publicRun(foundry.store.run(run.id));
    for (let i = 0; i < maxResumes && current.status === 'awaiting_approval'; i++) {
      const pending = Object.values(current.approvals ?? {}).filter(a => a.status === 'pending');
      if (!pending.length || typeof approve !== 'function') break;
      for (const a of pending) {
        out.approvals.asked++;
        const yes = await approve({ tool: a.tool, args: a.args, nodeKey: a.nodeKey });
        if (yes) out.approvals.approved++; else out.approvals.refused++;
        foundry.runtime.approve(run.id, a.id, !!yes, 'user');
        if (!yes) break;
      }
      current = foundry.publicRun(foundry.store.run(run.id));
      if (TERMINAL.has(current.status)) break;
      await foundry.startRun(run.id).catch(() => {});
      current = foundry.publicRun(foundry.store.run(run.id));
    }
    const events = foundry.store.events(run.id);
    out.run = current; out.status = current.status; out.verdict = current.verdict?.verdict ?? null;
    out.passed = current.status === 'succeeded' && out.verdict === 'pass';
    out.error = current.error ?? null;
    out.explained = explainRun(current, workflow, events);
    const world = readWorld(worldDir);
    out.world = world;
    out.effects = {
      outbox: readOutbox(outboxDir).filter(m => m.runId === run.id).map(m => ({ to: m.to, subject: m.subject, body: m.body })),
      chat: Object.fromEntries(Object.entries(world.chat).map(([c, posts]) => [c, posts.filter(p => p.runId === run.id).map(p => p.text)]).filter(([, p]) => p.length)),
      appended: Object.fromEntries(Object.entries(world.sheets).map(([name, rows]) => [name, rows.slice((sheets[name] ?? []).length)]).filter(([, r]) => r.length))
    };
    return out;
  } finally {
    await foundry.close();
    if (!keep) rmSync(dir, { recursive: true, force: true });
  }
}

/** A short, model-facing account of why a practice run did not pass: the failure, the failed step and every check that did not hold. */
export function practiceFeedback(result) {
  const lines = [];
  if (result.status === 'invalid') lines.push(`The workflow was refused before running: ${result.error?.code}: ${result.error?.message}`);
  else if (result.status === 'input-refused') lines.push(`The practice input was refused: ${result.error?.code}: ${result.error?.message}`);
  else {
    lines.push(`Practice run ended ${result.status}${result.verdict ? ` (verdict ${result.verdict})` : ''}.`);
    if (result.error) lines.push(`Failure: ${result.error.code}: ${String(result.error.message).slice(0, 400)}`);
    if (result.explained?.failedStep) lines.push(`Failed step: ${result.explained.failedStep}`);
    for (const c of result.explained?.checks ?? []) if (c.passed === false) lines.push(`Check failed: ${c.plain ?? c.exact}`);
  }
  return lines.join('\n');
}
