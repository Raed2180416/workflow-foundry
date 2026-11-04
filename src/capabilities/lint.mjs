// Nodecap lint, ARCHITECTURE.md §3.6. The launcher refuses to start on any error. Codes:
//   UNBOUND_REQUIREMENT        a requirement, skill or Tier-0 tool with no qualified member (a gap: a proposal, not a guess)
//   BINDING_NODE_SCOPE         a task or verify node names a member that is not declared Tier-0 (a standby member is never directly callable)
//   BINDING_EFFECT_CEILING     a bound member's effects exceed its type's ceiling or the node's acquire.effectsMax
//   SCHEMA_PROFILE_UNSUPPORTED a member view or a tool node's answer schema outside the portable subset
//   NODECAP_TAINT              an untrusted member's output reaches effect arguments or control without a quarantined agent or approval
//   RULE_OF_TWO                one tool node could hold untrusted input, private data and a third-party egress at once
//   BROKER_SELF_PROVISIONING   a deny-listed (connection-managing, self-provisioning) member anywhere in the lock
//   TOOLSET_TOO_LARGE          more than 5 bound tools, 3 skills or 20 standby members on one node
//   SKILL_BUDGET / SKILL_REQUIRES_EXCEEDS_GRANT  a bound skill too long, or requiring what the node does not hold
//   VERIFY_SAME_SURFACE        a verify node checks an effect with the very tool that produced it
//   VIEW_NAME_PROTOCOL (warning) a tool node's view whose last name segment is a tool-protocol action (`x_act`, `x_find`): a model may read
//                              it as the action (review-cost M2). A warning since the fix round of 2026-11-04 (cost N4: as an error it refused
//                              ordinary names such as `inbox_mark_read` and `github_create_pull_request`; routing follows the tool's effects,
//                              so a confused action is recoverable)
//   SOURCE_LINT                the engine's strict lint (src/lint.mjs) on the SOURCE workflow, for findings at a tool node: lowering moves the
//                              node's model call into a loop body, where the engine's top-level rules (the read-role checks) no longer see
//                              it (fix round 2026-11-04, thesis N3). The engine's severity is kept.
//   ACQUIRE_AFTER_EFFECT (warning)       a tool node that can act may also acquire later (a mid-run gap after its effect cannot continue)
//   CONTINUATION_AFTER_EFFECT (warning)  an effect upstream of a tool node that acquires: a gap there ends the run with no continuation
import { portableSchemaViolations } from '../schema-subset.mjs';
import { lintWorkflow } from '../lint.mjs';
import { references } from '../data.mjs';
import { approxTokens, effectRank, isPrivate } from './common.mjs';
import { denyListed } from './envelope.mjs';
import { typeInfo } from './types.mjs';
import { checkSkillRequires } from './skills.mjs';
import { walkNodes } from './resolve.mjs';
import { ACTIONS } from './lower.mjs';

export function lint({ workflow, lock, envelope, types = null, gaps = [], skills = new Map(), catalog = null }) {
  const findings = [], add = (code, node, message, severity = 'error') => findings.push({ code, severity, node, message });
  const member = id => lock.members[id];
  for (const gap of gaps) add('UNBOUND_REQUIREMENT', gap.node, `No qualified member for ${gap.type ?? gap.skill ?? gap.tool}`);
  const tier0 = new Set(Object.keys(lock.tier0)), scoped = new Set(Object.values(lock.nodes).flatMap(n => [...n.bound, ...n.skills, ...n.standby]));
  const all = new Map();
  walkNodes(workflow.nodes, node => all.set(node.id, node));
  for (const node of all.values()) if (node.tool && (scoped.has(node.tool) || lock.members[node.tool]) && !tier0.has(node.id))
    add('BINDING_NODE_SCOPE', node.id, `${node.tool} is not declared Tier-0 for ${node.id}; tool-node members are reachable only through the broker`);
  for (const [id, section] of Object.entries(lock.nodes)) {
    const bound = [...section.bound, ...section.skills].map(member), standby = section.standby.map(member), reach = [...bound, ...standby];
    if (section.bound.length > envelope.limits.boundPerNode || section.skills.length > envelope.limits.skillsPerNode || section.standby.length > envelope.standby.maxPerNode)
      add('TOOLSET_TOO_LARGE', id, `bound ${section.bound.length}/${envelope.limits.boundPerNode}, skills ${section.skills.length}/${envelope.limits.skillsPerNode}, standby ${section.standby.length}/${envelope.standby.maxPerNode}`);
    for (const m of bound) {
      const ceiling = typeInfo(types, m.type)?.effectCeiling;
      if (ceiling && effectRank(m.effects) > effectRank(ceiling)) add('BINDING_EFFECT_CEILING', id, `${m.id} (${m.effects}) exceeds the ${m.type} ceiling ${ceiling}`);
    }
    if (section.acquire) for (const m of standby) if (effectRank(m.effects) > effectRank(section.acquire.effectsMax)) add('BINDING_EFFECT_CEILING', id, `${m.id} exceeds acquire.effectsMax`);
    for (const m of reach) if (portableSchemaViolations(m.view.inputSchema).length) add('SCHEMA_PROFILE_UNSUPPORTED', id, `${m.id} view schema is outside the subset`);
    if (portableSchemaViolations(section.returns).length) add('SCHEMA_PROFILE_UNSUPPORTED', id, 'the answer schema is outside the portable subset');
    for (const m of reach) if (denyListed(envelope, m)) add('BROKER_SELF_PROVISIONING', id, `${m.id} manages connections or provisions tools`);
    for (const m of reach) if (ACTIONS.includes(m.view.name.split(/[_.-]/).at(-1).toLowerCase())) add('VIEW_NAME_PROTOCOL', id, `${m.view.name} ends with a tool-protocol action; consider renaming the view`, 'warning');
    // Rule of Two (egress-aware): untrusted input + private data + a third-party egress reachable without a person.
    // (Untrusted input is always present: a tool node's transcript carries tool output.) Private data counts whether it comes from a
    // member the node can reach or through the node's inputs (resolve records their class as inputClass).
    const privateData = reach.some(m => isPrivate(m.dataClass)) || isPrivate(section.inputClass);
    const egress = reach.filter(m => m.egress === 'third-party' && m.effects === 'none' && !m.requiresApproval);
    if (privateData && egress.length) add('RULE_OF_TWO', id, `untrusted input, private data and third-party egress (${egress.map(m => m.id).join(', ')}) in one node`);
    for (const skillId of section.skills) {
      const m = member(skillId), skill = skills.get(m.entryId);
      if (skill && approxTokens(skill.body) > Math.min(m.skillMaxTokens ?? envelope.limits.skillTokens, envelope.limits.skillTokens)) add('SKILL_BUDGET', id, `${skillId} body is over ${envelope.limits.skillTokens} tokens`);
      const entry = catalog?.entries.find(e => e.id === m.entryId) ?? null;
      if (entry?.requires) { try { checkSkillRequires(entry, new Set([...section.bound, ...section.standby])); } catch (error) { add('SKILL_REQUIRES_EXCEEDS_GRANT', id, error.message); } }
    }
    if (section.acquire && reach.some(m => m.effects !== 'none')) add('ACQUIRE_AFTER_EFFECT', id, 'this node can act and also acquire; a gap after its own effect ends the run without a continuation', 'warning');
  }
  // Taint through Tier-0 members (fills, in lint, the engine's interim hole: a task's output label is its arguments' label).
  const untrustedNodes = new Set();
  for (const [nodeId, memberId] of Object.entries(lock.tier0)) if (member(memberId).outputLabel !== 'trusted') untrustedNodes.add(nodeId);
  for (const id of Object.keys(lock.nodes)) untrustedNodes.add(id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of all.values()) {
      if (untrustedNodes.has(node.id) || node.quarantined === true) continue;
      const refs = references([node.args ?? null, node.when ?? null, node.items ?? null, node.input ?? null, ...(node.context?.inputs ?? []).map(i => i.ref ? { $ref: i.ref } : null)]);
      if (refs.some(r => untrustedNodes.has(r.split('.')[1]))) { untrustedNodes.add(node.id); changed = true; }
    }
  }
  for (const [nodeId, memberId] of Object.entries(lock.tier0)) {
    const m = member(memberId), node = all.get(nodeId);
    if (m.effects === 'none' || m.requiresApproval) continue;
    const refs = references([node.args ?? null, node.when ?? null]);
    if (refs.some(r => untrustedNodes.has(r.split('.')[1]))) add('NODECAP_TAINT', nodeId, `${m.id} is an effect whose arguments or control derive from untrusted member output without approval`);
  }
  for (const node of all.values()) {
    if (node.kind !== 'verify' || node.method !== 'capability') continue;
    const subjects = references(node.subject ?? null).map(r => r.split('.')[1]).map(id => all.get(id)).filter(Boolean);
    if (subjects.some(s => s.tool && s.tool === node.tool)) add('VERIFY_SAME_SURFACE', node.id, `${node.tool} verifies its own effect`);
  }
  // An effect upstream of a tool node that acquires.
  const effectNodes = new Set(Object.entries(lock.tier0).filter(([, m]) => member(m).effects !== 'none').map(([n]) => n));
  const upstream = id => { const seen = new Set(), stack = [...(all.get(id)?.needs ?? [])]; while (stack.length) { const n = stack.pop(); if (!seen.has(n)) { seen.add(n); stack.push(...(all.get(n)?.needs ?? [])); } } return seen; };
  for (const [id, section] of Object.entries(lock.nodes)) if (section.acquire && [...upstream(id)].some(n => effectNodes.has(n))) add('CONTINUATION_AFTER_EFFECT', id, 'an effect runs before this node; a gap here cannot be continued', 'warning');
  // The engine's own checks of each tool node as written (the source workflow), which the lowered loop hides from its top-level rules.
  let source = null;
  try { source = lintWorkflow(workflow); } catch { source = null; }
  for (const f of source?.findings ?? []) if (f.node && lock.nodes[f.node]) add('SOURCE_LINT', f.node, `${f.code}: ${String(f.message).slice(0, 300)}`, f.severity === 'error' ? 'error' : 'warning');
  return { findings, errors: findings.filter(f => f.severity === 'error'), warnings: findings.filter(f => f.severity === 'warning') };
}
