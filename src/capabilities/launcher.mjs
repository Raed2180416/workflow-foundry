// Construction and launch, ARCHITECTURE.md §3.6. construct(): qualify → resolve (lock) → lower → lint. launch(): refuse on any lint
// error, preflight (re-list against pins, canaries, credential presence), require the person's approval of the exact subject
// (lowered workflow hash, lock hash, envelope and catalog digests, dry run), compile the registry with an EXPLICIT allow-list, create the
// run. resume(): recompile from the stored lock; any difference fails closed with CAPABILITY_DRIFT in the runtime.
import { Runtime } from '../runtime.mjs';
import { digest, fail } from './common.mjs';
import { envelopeDigest as envelopeDigestOf } from './envelope.mjs';
import { typesDigest as typesDigestOf, typeMatch } from './types.mjs';
import { resolve, lockMembers, walkNodes } from './resolve.mjs';
import { lowerWorkflow } from './lower.mjs';
import { lint } from './lint.mjs';
import { compileRegistry, allowedCapabilities } from './registry.mjs';
import { NodecapLedger } from './ledger.mjs';
import { renderBody } from './skills.mjs';

export const workflowHashOf = workflow => digest(workflow);

export async function construct({ workflow, sidecar, host, envelope, types = null, catalogDigest }) {
  // Only entries a requirement or an acquire clause could use are qualified (an MCP server nothing can bind is never spawned), plus the
  // entries of Tier-0 members the workflow names directly.
  const tier0 = [];
  walkNodes(workflow.nodes, node => { if ((sidecar.tier0 ?? []).includes(node.id) && typeof node.tool === 'string') tier0.push(node.tool.split('.')[1]); });
  await host.qualify({ only: [...host.candidateEntries(sidecar, { typeMatch }), ...tier0] });
  const envelopeDigest = envelopeDigestOf(envelope), typesDigest = types ? typesDigestOf(types) : null;
  const { lock, lockHash, gaps, ties } = resolve({ workflow, sidecar, members: [...host.members.values()], catalogDigest, envelope, envelopeDigest, types, typesDigest });
  const skillBodies = {};
  for (const section of Object.values(lock.nodes)) for (const id of section.skills) {
    const m = lock.members[id], skill = host.skills.get(m.entryId);
    try { skillBodies[id] = renderBody(skill, { maxTokens: Math.min(m.skillMaxTokens ?? envelope.limits.skillTokens, envelope.limits.skillTokens) }); } catch { skillBodies[id] = '(over budget: refused by lint)'; }
  }
  const lowered = lowerWorkflow(workflow, lock, { skillBodies });
  const report = lint({ workflow, lock, envelope, types, gaps, skills: host.skills, catalog: host.catalog });
  return { lock, lockHash, gaps, ties, lowered, workflowHash: workflowHashOf(lowered), lint: report, envelopeDigest, typesDigest, catalogDigest };
}

/** The approval subject a person signs off (dashboard or CLI) for one constructed version. */
export const subjectOf = (c, dryRunId = null) => ({ workflowHash: c.workflowHash, lockHash: c.lockHash, envelopeDigest: c.envelopeDigest, catalogDigest: c.catalogDigest, dryRunId });

export function runtimeFor({ store, host, ledger, construction, envelope, models = null, modelPolicy = null, mode = 'live', maxCost = null }) {
  const registry = compileRegistry({ lock: construction.lock, lockHash: construction.lockHash, host, envelope, envelopeDigest: construction.envelopeDigest, ledger, mode });
  const allowed = allowedCapabilities(registry, construction.lowered);
  const budget = construction.lowered.budget.maxCost ?? 0, nodeBudgets = Object.values(construction.lock.nodes).map(n => n.budgetUsd).filter(v => typeof v === 'number');
  const cap = maxCost ?? (nodeBudgets.length ? Math.min(budget, nodeBudgets.reduce((a, b) => a + b, 0)) : budget);
  return { registry, runtime: new Runtime(store, registry, { allowedCapabilities: allowed, maxCost: cap }, { models, modelPolicy }) };
}

export async function launch({ store, ledger, host, construction, envelope, models = null, modelPolicy = null, input = {}, runOptions = {}, dryRunId = null, mode = 'live', maxCost = null }) {
  if (construction.lint.errors.length) fail('NODECAP_LINT', `Lint refused the version: ${construction.lint.errors.map(f => f.code).join(', ')}`, { findings: construction.lint.errors });
  // In a later process nothing has qualified yet: qualify exactly the lock's entries (no other server is spawned), then check the pins.
  await host.qualify({ only: [...new Set(lockMembers(construction.lock).map(id => construction.lock.members[id].entryId))] });
  const preflight = await host.preflight(lockMembers(construction.lock), construction.lock);
  if (!preflight.ok) fail('PREFLIGHT_FAILED', `Preflight failed: ${preflight.problems.map(p => `${p.entry}:${p.code}`).join(', ')}`, { problems: preflight.problems });
  if (!ledger.lockApproval(subjectOf(construction, dryRunId))) fail('LOCK_UNAPPROVED', 'No person approved this exact version (workflow, lock, envelope, catalog, dry run)');
  ledger.putLock(construction.lock);
  const { registry, runtime } = runtimeFor({ store, host, ledger, construction, envelope, models, modelPolicy, mode, maxCost });
  const saved = store.saveWorkflow(construction.lowered, { expectedHash: store.db.prepare('SELECT hash FROM heads WHERE id=?').get(construction.lowered.id)?.hash ?? null });
  if (saved.hash !== construction.workflowHash) fail('WORKFLOW_HASH', 'The saved workflow differs from the approved one');
  const run = runtime.create(construction.lowered, input, runOptions);
  return { runtime, registry, run, execute: () => executeRun({ runtime, host, runId: run.id }) };
}

/** Execute (or resume) a run; UI sessions are closed when the run reaches a terminal status (a parked run keeps its session). */
export async function executeRun({ runtime, host, runId }) {
  const result = await runtime.execute(runId);
  if (['succeeded', 'failed', 'cancelled', 'uncertain'].includes(result.status)) await host.closeRun(runId);
  return result;
}
export { NodecapLedger };
