// The per-run registry compiled from a lock, ARCHITECTURE.md §3.6. Contents: core.* (createDefaultRegistry), Tier-0 members (task and
// verify nodes that name a member), and the dispatchers nodecap.do / act / log / close. Standby members are NOT registered: they are
// reachable only through a dispatcher, so a task node cannot call one directly. Every pin, view and attestation enters the registry hash
// (Tier-0 members through their `implementation`, the rest through the dispatchers' implementation digest over the lock section), so any
// drift makes a resume fail closed with CAPABILITY_DRIFT (src/runtime.mjs). Practice mode simulates effects and hashes differently.
import { createDefaultRegistry } from '../capabilities.mjs';
import { digest, fail, joinLabels } from './common.mjs';
import { walkNodes } from './resolve.mjs';
import { Dispatcher } from './broker.mjs';

const DECISION_IN = { type: 'object', additionalProperties: false, required: ['decision'], properties: { decision: { type: 'object' } } };
const OPEN = { type: 'object' };

/** Interim taint rule (b): when a lock binds any untrusted-labelled member, every Tier-0 effect member is compiled approval-gated. */
export const untrustedLock = lock => Object.values(lock.members).some(m => m.outputLabel !== 'trusted') || Object.keys(lock.nodes).length > 0;

export function compileRegistry({ lock, lockHash, host, envelope, envelopeDigest, ledger = null, mode = 'live' }) {
  if (!['live', 'practice'].includes(mode)) fail('REGISTRY_MODE', 'mode is live or practice');
  const registry = createDefaultRegistry(), gateEffects = untrustedLock(lock);
  for (const memberId of [...new Set(Object.values(lock.tier0))]) {
    const m = lock.members[memberId];
    registry.register({ name: m.id, description: m.view.summary, version: '1', implementation: `${m.implementation}${mode === 'practice' ? '+practice' : ''}`,
      inputSchema: m.view.inputSchema, outputSchema: m.outputSchema, effects: m.effects, risk: m.risk,
      requiresApproval: m.requiresApproval === true || (gateEffects && m.effects !== 'none'), maxTimeoutMs: m.maxTimeoutMs, cost: m.cost,
      cancellation: 'protocol-request-only; external effect reconciliation may be required',
      execute: async (args, ctx) => host.invoke(m.id, args, { runId: ctx.runId, node: ctx.nodeKey, signal: ctx.signal, idempotencyKey: ctx.idempotencyKey, artifactsDir: ctx.artifactsDir, practice: mode === 'practice' }) });
  }
  if (Object.keys(lock.nodes).length) {
    const dispatcher = new Dispatcher({ host, lock, lockHash, envelope, envelopeDigest, ledger, mode });
    const section = { nodes: lock.nodes, members: Object.fromEntries(Object.entries(lock.members).filter(([id]) => Object.values(lock.nodes).some(n => [...n.bound, ...n.skills, ...n.standby].includes(id)))) };
    const implementation = `sha256:${digest({ adapter: 'nodecap-dispatch/1', lockSection: section, envelopeDigest, mode })}`;
    const base = { version: '1', implementation, maxTimeoutMs: 120000, cost: 0, cancellation: 'cooperative' };
    registry.register({ ...base, name: 'nodecap.do', description: 'Run one read, find or typed request of a tool node (effects none).', inputSchema: DECISION_IN, outputSchema: OPEN,
      effects: 'none', risk: 'low', requiresApproval: false, execute: (args, ctx) => dispatcher.do(args, ctx) });
    registry.register({ ...base, name: 'nodecap.act', description: 'Run one effectful call of a tool node, after a person approves it.', inputSchema: DECISION_IN, outputSchema: OPEN,
      effects: 'non-idempotent', risk: 'high', requiresApproval: true, execute: (args, ctx) => dispatcher.act(args, ctx) });
    registry.register({ ...base, name: 'nodecap.log', description: 'Append one turn to a tool node transcript (bounded).', inputSchema: { type: 'object', required: ['decision'], properties: { decision: OPEN, result: {}, effect: {}, previous: {} } },
      outputSchema: OPEN, effects: 'none', risk: 'low', requiresApproval: false, execute: async args => dispatcher.log(args) });
    registry.register({ ...base, name: 'nodecap.close', description: 'Validate a tool node answer and end its sessions.', inputSchema: { type: 'object', additionalProperties: false, required: ['log'], properties: { log: OPEN } },
      outputSchema: OPEN, effects: 'none', risk: 'low', requiresApproval: false, execute: (args, ctx) => dispatcher.close(args, ctx) });
  }
  return registry;
}

/** The explicit allow-list of a lowered workflow: exactly the tools its task and verify nodes name (never the runtime default). */
export function allowedCapabilities(registry, lowered) {
  const names = new Set();
  walkNodes(lowered.nodes, node => { if (node.tool) names.add(node.tool); });
  for (const name of names) if (!registry.get(name)) fail('UNKNOWN_TOOL', `The lowered workflow names ${name}, which the compiled registry does not hold`);
  return [...names].sort();
}
export { joinLabels };
