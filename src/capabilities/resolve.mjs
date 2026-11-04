// The construction-time resolver (L0), ARCHITECTURE.md §2.3, §2.4 and §3.6. Deterministic code: the same workflow, sidecar, qualified
// members, envelope and types give the same lock and lockHash. The lock is the approval subject: per tool node its `bound` set (callable
// now, at most 5 tools and 3 skills) and its `standby` set (acquirable in-run, at most 20, all listed for the approver), plus Tier-0
// bindings of task and verify nodes that name a member directly. Requirements with no eligible member are gaps (proposals), never guesses.
import { checkData, clone, references } from '../data.mjs';
import { validateData } from '../validate.mjs';
import { CUSTODY, DATA_CLASSES, digest, effectRank, EFFECTS, fail, isPrivate, joinLabels, TRUST } from './common.mjs';
import { denyListed } from './envelope.mjs';
import { typeInfo, typeMatch } from './types.mjs';
import { indexMembers } from './rank.mjs';

const ID = '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$';
export const sidecarSchema = { type: 'object', additionalProperties: false, required: ['schema', 'nodes'], properties: {
  schema: { const: 'foundry-nodecap-toolnodes/1' },
  tier0: { type: 'array', maxItems: 200, uniqueItems: true, items: { type: 'string', pattern: ID } },
  nodes: { type: 'object', maxProperties: 50, propertyNames: { pattern: ID }, additionalProperties: { type: 'object', additionalProperties: false, required: ['maxTurns'], properties: {
    requires: { type: 'array', maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['as', 'type'], properties: { as: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,40}$' }, type: { type: 'string', maxLength: 120 } } } },
    skills: { type: 'array', maxItems: 3, uniqueItems: true, items: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,40}$' } },
    acquire: { type: 'object', additionalProperties: false, required: ['systems', 'objects', 'effectsMax', 'max'], properties: {
      systems: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,40}$' } },
      objects: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,40}$' } },
      effectsMax: { enum: EFFECTS }, max: { type: 'integer', minimum: 0, maximum: 10 },
      // lazy (default): standby is an index the model reaches by name, find and request. static: no find; the standby members are listed
      // with the bound tools as full views, still granted by the broker's rules on first use; request stays for a need outside the lock.
      mode: { enum: ['lazy', 'static'] } } },
    maxTurns: { type: 'integer', minimum: 1, maximum: 30 }, budgetUsd: { type: 'number', minimum: 0, maximum: 10 },
    maxCallsPerMember: { type: 'integer', minimum: 1, maximum: 100 },
    // The data class of the workflow input the node reads (owner declaration); unknown input counts as private (Rule of Two).
    inputClass: { enum: DATA_CLASSES } } } } } };
export function checkSidecar(sidecar) { checkData(sidecar); validateData(sidecarSchema, sidecar, 'nodecap tool-node sidecar', { trustedSchema: true }); return clone(sidecar); }

/** Every node of a workflow with its frame path (top level and nested bodies). */
export function walkNodes(nodes, visit, prefix = '') {
  for (const node of nodes ?? []) { visit(node, prefix); if (node.body) walkNodes(node.body.nodes, visit, `${prefix}${node.id}/`); }
}
const custodyRank = c => CUSTODY.indexOf(c ?? 'C0');
const trustRank = t => TRUST.indexOf(t);
/** Deterministic tie-break of candidates for one requirement: exact type > subtype; custody C0 < C1 < C2; cost; trust tier; id. */
export function orderCandidates(candidates, type) {
  const key = m => [-typeMatch(m.type, type), custodyRank(m.custody), m.cost ?? 0, trustRank(m.trust)];
  const sorted = [...candidates].sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return a.id < b.id ? -1 : 1; });
  const tie = sorted.length > 1 && JSON.stringify(key(sorted[0])) === JSON.stringify(key(sorted[1]));
  return { sorted, tie };
}

/**
 * resolve({ workflow, sidecar, members, catalogDigest, envelope, envelopeDigest, types, typesDigest }) → { lock, gaps, ties }.
 * `members`: the qualified member records (NodecapHost.qualify()). Only those are ever bound or put on standby.
 */
export function resolve({ workflow, sidecar, members, catalogDigest, envelope, envelopeDigest, types = null, typesDigest = null }) {
  const spec = checkSidecar(sidecar), byId = new Map(members.map(m => [m.id, m])), gaps = [], ties = [];
  const nodes = new Map();
  walkNodes(workflow.nodes, (node, prefix) => nodes.set(node.id, { node, prefix }));
  const lock = { schema: 'foundry-nodecap-lock/1', flowId: workflow.id, catalogDigest, envelopeDigest, typesDigest, tier0: {}, nodes: {}, members: {} };
  const use = member => { lock.members[member.id] = clone(member); return member.id; };
  for (const id of spec.tier0 ?? []) {
    const found = nodes.get(id);
    if (!found || !['task', 'verify'].includes(found.node.kind)) fail('SIDECAR_NODE', `tier0 names ${id}, which is not a task or verify node`);
    const member = byId.get(found.node.tool);
    if (!member) { gaps.push({ node: id, code: 'UNBOUND_REQUIREMENT', tool: found.node.tool }); continue; }
    lock.tier0[id] = use(member);
  }
  for (const [id, toolNode] of Object.entries(spec.nodes)) {
    const found = nodes.get(id);
    if (!found || found.node.kind !== 'agent') fail('SIDECAR_NODE', `Tool node ${id} must be an agent node of the workflow`);
    if (found.prefix) fail('SIDECAR_NODE', `Tool node ${id} is nested; the spike lowers top-level tool nodes only`);
    const bound = [], skills = [];
    for (const requirement of toolNode.requires ?? []) {
      // A skill body is bound through `skills`; an admitted skill SCRIPT is a typed member and may satisfy a requirement. Code binds only
      // members of trusted sources (the auto-bind trust tiers): an untrusted (T2) member reaches a lock only through a proposal a person
      // decides, flagged T2 (review m2: a T2 server's own attestation of "effects none" is never what lets code bind it).
      const eligible = members.filter(m => typeMatch(m.type, requirement.type) > 0 && !(m.kind === 'skill' && !m.script) && !denyListed(envelope, m) && envelope.autoBind.trust.includes(m.trust)
        && effectRank(m.effects) <= effectRank(typeInfo(types, m.type)?.effectCeiling ?? 'non-idempotent'));
      if (!eligible.length) { gaps.push({ node: id, as: requirement.as, type: requirement.type, code: 'UNBOUND_REQUIREMENT' }); continue; }
      const { sorted, tie } = orderCandidates(eligible, requirement.type);
      if (tie) ties.push({ node: id, as: requirement.as, candidates: sorted.slice(0, 5).map(m => m.id) });
      if (!bound.includes(sorted[0].id)) bound.push(use(sorted[0]));
    }
    for (const skillId of toolNode.skills ?? []) {
      const member = byId.get(`skill.${skillId}`);
      if (!member) { gaps.push({ node: id, skill: skillId, code: 'UNBOUND_REQUIREMENT' }); continue; }
      skills.push(use(member));
    }
    const acquire = toolNode.acquire ?? null, held = new Set([...bound, ...skills]);
    let standby = [];
    if (acquire) {
      const order = new Map(acquire.systems.map((s, i) => [s, i]));
      // (A member attested `toolNode: false` is not for a tool node's model: the UI trace export and assert; review-cost M3.)
      standby = members.filter(m => !held.has(m.id) && m.toolNode !== false && order.has(m.system) && m.objects.some(o => acquire.objects.includes(o))
        && effectRank(m.effects) <= effectRank(acquire.effectsMax) && envelope.standby.trust.includes(m.trust) && !denyListed(envelope, m));
      if (standby.length > envelope.standby.maxPerNode) {
        // Over the cap: keep the members most relevant to the node's own instructions (authored text only), then a stable order.
        const ranked = indexMembers(standby).rank(`${found.node.instructions} ${found.node.description}`, standby.length).map(r => r.id);
        // (De-duplicated before the cut: the ranked ids are also in the stable order, and counting them twice kept fewer than the cap,
        // found by the scale world of review-cost M8.)
        const keep = new Set([...new Set([...ranked, ...standby.map(m => m.id)])].slice(0, envelope.standby.maxPerNode));
        standby = standby.filter(m => keep.has(m.id));
      }
      standby = standby.sort((a, b) => (order.get(a.system) - order.get(b.system)) || (a.id < b.id ? -1 : 1)).map(use);
    }
    const all = [...bound, ...skills, ...standby].map(m => lock.members[m]);
    const views = all.map(m => m.view.name);
    if (new Set(views).size !== views.length) fail('VIEW_COLLISION', `Tool node ${id} would expose two members under one view name`);
    lock.nodes[id] = { bound, skills, standby, acquire: acquire ? clone(acquire) : null, maxTurns: toolNode.maxTurns, budgetUsd: toolNode.budgetUsd ?? null,
      maxCallsPerMember: toolNode.maxCallsPerMember ?? 20, returns: clone(found.node.returns), instructionsHash: `sha256:${digest({ i: found.node.instructions })}`,
      // The transcript of a tool node carries tool output, so its control is untrusted whatever it binds (interim taint rule (c)).
      controlLabel: joinLabels([`untrusted:nodecap.${id}`, ...all.map(m => m.outputLabel)]),
      // The owner's declaration of the workflow input's class, kept so lock N+1 recomputes inputClass from the lock alone (fix round M7).
      declaredInputClass: toolNode.inputClass ?? null };
  }
  for (const [id, cls] of inputClasses(workflow, lock)) lock.nodes[id].inputClass = cls;
  return { lock, lockHash: `sha256:${digest(lock)}`, gaps, ties };
}

/** Every reference a node makes, its nested bodies and context inputs included (a reference that cannot be parsed counts as the input). */
function refsOf(node) {
  const out = [];
  const visit = n => {
    const { body, context, ...rest } = n ?? {};
    try { references(rest, out); } catch { out.push('input'); }
    for (const i of context?.inputs ?? []) if (typeof i?.ref === 'string') out.push(i.ref);
    for (const child of body?.nodes ?? []) visit(child);
  };
  visit(node);
  return out;
}
/**
 * The class of the data each tool node reads through its inputs (review M6; fix round 2026-11-04: transitively, and recomputed for every
 * lock N+1). A node's output carries PRIVATE data when it is a Tier-0 member of a private class, a tool node that can reach a private
 * member or reads private input, or ANY node (an ordinary agent, a task, a loop) that references such a node, at any distance. It carries
 * the WORKFLOW INPUT when it references `input` or a node that carries it. A tool node that reads private data has inputClass private; one
 * that reads the workflow input (directly or through other nodes) has the owner's declared class (sidecar `inputClass`, kept in the lock as
 * `declaredInputClass`), private when undeclared; otherwise null. The broker's Rule of Two and lint both count it. Pure: workflow + lock.
 */
export function inputClasses(workflow, lock) {
  const all = new Map();
  walkNodes(workflow.nodes, node => { const prev = all.get(node.id) ?? []; all.set(node.id, [...prev, ...refsOf(node)]); });
  const refs = new Map([...all].map(([id, list]) => [id, { input: list.some(r => r === 'input' || r.startsWith('input.')), nodes: [...new Set(list.filter(r => r.startsWith('nodes.')).map(r => r.split('.')[1]))] }]));
  const reach = id => lock.nodes[id] ? [...lock.nodes[id].bound, ...lock.nodes[id].skills, ...lock.nodes[id].standby].map(m => lock.members[m]) : [];
  const declared = id => lock.nodes[id]?.declaredInputClass ?? 'private';
  const priv = new Set([...all.keys()].filter(id => (lock.tier0[id] && isPrivate(lock.members[lock.tier0[id]].dataClass)) || reach(id).some(m => isPrivate(m.dataClass))));
  const carries = new Set([...all.keys()].filter(id => refs.get(id).input));
  for (let changed = true; changed;) {
    changed = false;
    for (const [id, r] of refs) {
      if (!carries.has(id) && r.nodes.some(n => carries.has(n))) { carries.add(id); changed = true; }
      // A tool node that reads the workflow input of a private (or undeclared) class passes private data on, like a private member.
      if (!priv.has(id) && (r.nodes.some(n => priv.has(n)) || (lock.nodes[id] && carries.has(id) && isPrivate(declared(id))))) { priv.add(id); changed = true; }
    }
  }
  return new Map(Object.keys(lock.nodes).map(id => {
    const r = refs.get(id) ?? { input: false, nodes: [] };
    return [id, r.nodes.some(n => priv.has(n)) ? 'private' : (r.input || r.nodes.some(n => carries.has(n))) ? declared(id) : null];
  }));
}
/** The member ids a lock can ever reach (Tier-0, bound, skills, standby). */
export const lockMembers = lock => [...new Set([...Object.values(lock.tier0), ...Object.values(lock.nodes).flatMap(n => [...n.bound, ...n.skills, ...n.standby])])];
export const viewIndex = (lock, node) => new Map([...lock.nodes[node].bound, ...lock.nodes[node].skills, ...lock.nodes[node].standby].map(id => [lock.members[id].view.name, id]));
