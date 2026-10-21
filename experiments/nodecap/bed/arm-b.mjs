// NC-1 arm B, the "raw MCP config" baseline (ARCHITECTURE.md §4.3). A BASELINE, not product code: it shows what a node looks like when
// every catalog member is exposed at once, the way a client configured with every server does it:
//   - every MCP tool of every catalog entry (deny-listed, untrusted-server, distractor and rug-pull tools included), named
//     `<entry>_<tool>`, presented with the SERVER's description, input schema and annotations;
//   - every skill (the third-party one included) with its own SKILL.md description, and the ui.* members (Foundry's computer-use adapter
//     is the only browser backend in the bed, so its network gate stays in place: arm B is not a test of the CUA gate);
//   - no pins, no broker, no envelope, no scrub check, server error text passed to the model (the MCP spec's SHOULD);
//   - naive annotation mapping: readOnlyHint true -> no approval; anything else is an effect that needs approval;
//   - the ENGINE gates intact: the same lowering onto the same loop node, nodecap.act still requiresApproval, the same scripted person.
// So arm B differs from arm A only in what the node is shown and in the Foundry-side checks, which is the contrast NC-1 measures.
import { createDefaultRegistry } from '../../../src/capabilities.mjs';
import { Runtime } from '../../../src/runtime.mjs';
import { digest } from '../../../src/data.mjs';
import { lowerWorkflow } from '../../../src/capabilities/lower.mjs';
import { Dispatcher } from '../../../src/capabilities/broker.mjs';
import { allowedCapabilities } from '../../../src/capabilities/registry.mjs';
import { viewIndex } from '../../../src/capabilities/resolve.mjs';
import { refusal, toolNodeOf } from '../../../src/capabilities/common.mjs';

export const rawName = (entryId, tool) => `${entryId}_${tool}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64);
const textOf = result => (result?.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n');

/** Authored view name -> raw name, so the scripted models of the bed can follow the same plan in arm B. */
export function renameMap(catalog) {
  const map = new Map();
  for (const entry of catalog.entries.filter(e => e.kind.startsWith('mcp'))) for (const [tool, a] of Object.entries(entry.members ?? {})) map.set(a.view.name, rawName(entry.id, tool));
  return map;
}

/** Every member a raw configuration would expose: live MCP listings (no pins) plus every skill and ui.* member the host loaded. */
export async function rawMembers(host) {
  const members = [];
  for (const entry of host.catalog.entries.filter(e => e.kind.startsWith('mcp'))) {
    const listing = await host.pool.get(entry.id).listAll();
    for (const tool of listing.tools) {
      const readOnly = tool.annotations?.readOnlyHint === true, name = rawName(entry.id, tool.name);
      members.push({ id: `mcp.${entry.id}.${tool.name}`, entryId: entry.id, kind: entry.kind, tool: tool.name, raw: true, trust: entry.trust,
        effects: readOnly ? 'none' : 'non-idempotent', risk: readOnly ? 'low' : 'high', requiresApproval: !readOnly, system: entry.id, objects: ['any'], verbs: ['read'],
        outputLabel: `untrusted:mcp.${entry.id}`, dataClass: 'internal', egress: 'local',
        view: { name, summary: String(tool.description ?? tool.name).slice(0, 2000), inputSchema: tool.inputSchema ?? { type: 'object' } },
        rawDefinition: { name, description: tool.description ?? '', inputSchema: tool.inputSchema ?? {}, ...(tool.annotations ? { annotations: tool.annotations } : {}) } });
    }
  }
  for (const m of host.members.values()) {
    if (m.kind !== 'skill' && m.kind !== 'cua') continue;
    // A skill body is offered as a tool with the skill's OWN description (a raw client loads it as the author wrote it).
    const summary = m.kind === 'skill' && !m.script ? host.skills.get(m.entryId)?.description ?? m.view.summary : m.view.summary;
    members.push({ ...m, view: { ...m.view, summary }, rawDefinition: { name: m.view.name, description: summary, inputSchema: m.view.inputSchema } });
  }
  return members;
}

/** The raw dispatcher: what a client with every tool and no Foundry checks does, behind the same engine gate. */
class RawDispatcher {
  constructor({ host, lock, envelope }) {
    Object.assign(this, { host, lock });
    this.base = new Dispatcher({ host, lock, lockHash: 'raw', envelope, envelopeDigest: 'raw', ledger: null }); // log and close only
  }
  async do(args, ctx) {
    const { node } = toolNodeOf(ctx.nodeKey), decision = args.decision;
    if (decision.action !== 'read') return refusal('ACTION_UNSUPPORTED');
    const id = viewIndex(this.lock, node).get(decision.tool);
    if (!id) return refusal('TOOL_ABSENT');
    const member = this.lock.members[id];
    if (member.effects !== 'none') return refusal('EFFECT_CLASS_MISMATCH', { hint: 'This tool changes something: use action act' });
    return this.#call(ctx, node, member, decision);
  }
  async act(args, ctx) {
    const { node } = toolNodeOf(ctx.nodeKey), decision = args.decision;
    // The engine gate (requiresApproval on nodecap.act) is intact; the same chain check as the Foundry dispatcher.
    const header = ctx.store.rows.header(ctx.runId);
    const approvalId = digest({ workflowHash: header.workflowHash, registryHash: header.registryHash, nodeKey: ctx.nodeKey, tool: 'nodecap.act', args, idempotencyKey: ctx.idempotencyKey });
    if (!ctx.store.events(ctx.runId).some(e => e.type === 'approval.decided' && e.approvalId === approvalId && e.approved === true && e.actor === 'user')) throw new Error('approval missing');
    const id = viewIndex(this.lock, node).get(decision.tool);
    if (!id) return refusal('TOOL_ABSENT');
    return this.#call(ctx, node, this.lock.members[id], decision);
  }
  async #call(ctx, node, member, decision) {
    try {
      if (member.raw) {
        const result = await this.host.pool.get(member.entryId).call(member.tool, decision.args ?? {}, { scope: member.effects === 'none' ? 'read' : 'write', timeoutMs: 15000 });
        if (result?.isError) return { ok: false, member: member.id, tool: member.view.name, error: textOf(result).slice(0, 2000) };
        return { ok: true, member: member.id, tool: member.view.name, result: result?.structuredContent ?? textOf(result) };
      }
      const result = await this.host.invoke(member.id, decision.args ?? {}, { runId: ctx.runId, node, signal: ctx.signal, idempotencyKey: ctx.idempotencyKey, artifactsDir: ctx.artifactsDir });
      return { ok: true, member: member.id, tool: member.view.name, result };
    } catch (error) {
      // Raw: whatever the error says goes to the model.
      return { ok: false, member: member.id, tool: member.view.name, error: String(error?.message ?? error).slice(0, 2000) };
    }
  }
}

/** Lower and launch one arm-B episode on the bed's host. Returns { construction, runtime, run } shaped like the Foundry arms'. */
export async function launchArmB({ store, host, envelope, source, maxTurns, models, modelPolicy }) {
  if (!host.members.size) await host.qualify();
  const members = await rawMembers(host);
  const lock = { schema: 'nc1-armB-raw/1', flowId: source.id, tier0: {}, members: Object.fromEntries(members.map(m => [m.id, m])),
    nodes: { work: { bound: members.map(m => m.id), skills: [], standby: [], acquire: null, maxTurns, maxCallsPerMember: 100, budgetUsd: null,
      returns: source.nodes[0].returns, controlLabel: 'untrusted:nodecap.work' } } };
  const lowered = lowerWorkflow(source, lock);
  // What a raw client puts in front of the model: each tool's own definition (server description, schema, annotations).
  const step = lowered.nodes.find(n => n.kind === 'loop').body.nodes[0], tools = step.context.inputs.find(i => i.name === 'tools');
  tools.value = members.map(m => JSON.stringify(m.rawDefinition)).join('\n');
  const dispatcher = new RawDispatcher({ host, lock, envelope }), registry = createDefaultRegistry();
  const base = { version: '1', implementation: `sha256:${digest({ adapter: 'nc1-armB-raw/1', members: members.map(m => m.rawDefinition) })}`, maxTimeoutMs: 120000, cost: 0, cancellation: 'cooperative' };
  const DECISION_IN = { type: 'object', additionalProperties: false, required: ['decision'], properties: { decision: { type: 'object' } } }, OPEN = { type: 'object' };
  registry.register({ ...base, name: 'nodecap.do', description: 'Raw read.', inputSchema: DECISION_IN, outputSchema: OPEN, effects: 'none', risk: 'low', requiresApproval: false, execute: (a, c) => dispatcher.do(a, c) });
  registry.register({ ...base, name: 'nodecap.act', description: 'Raw effect (engine approval).', inputSchema: DECISION_IN, outputSchema: OPEN, effects: 'non-idempotent', risk: 'high', requiresApproval: true, execute: (a, c) => dispatcher.act(a, c) });
  registry.register({ ...base, name: 'nodecap.log', description: 'Transcript.', inputSchema: { type: 'object', required: ['decision'], properties: { decision: OPEN, result: {}, effect: {}, previous: {} } }, outputSchema: OPEN, effects: 'none', risk: 'low', requiresApproval: false, execute: async a => dispatcher.base.log(a) });
  registry.register({ ...base, name: 'nodecap.close', description: 'Close.', inputSchema: { type: 'object', additionalProperties: false, required: ['log'], properties: { log: OPEN } }, outputSchema: OPEN, effects: 'none', risk: 'low', requiresApproval: false, execute: (a, c) => dispatcher.base.close(a, c) });
  const runtime = new Runtime(store, registry, { allowedCapabilities: allowedCapabilities(registry, lowered), maxCost: 0 }, { models, modelPolicy });
  store.saveWorkflow(lowered, { expectedHash: null });
  const run = runtime.create(lowered, {}, {});
  return { construction: { lock, lowered, lockHash: 'raw', workflowHash: digest(lowered), lint: { errors: [], warnings: [] } }, runtime, run };
}
