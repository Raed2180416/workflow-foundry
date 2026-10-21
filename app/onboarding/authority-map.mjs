// "Who decides what": the authority map (proposal authority-map-v1, owner decision O-H; SPEC §8). A validated, versioned,
// hash-chained local document in the constitution-v0 vocabulary: layers (regulation > org-policy > entity-rule > process > workflow),
// roles, principals, parameters, bounds, who approves what, rules that never break (each confirmed by examples that become its tests),
// where it runs, and change control.
//
// What it does today: it is checked when an automation is made and tested (app/onboarding/proposal-check.mjs prefills and caps a
// card's settings it bounds). It is NOT enforced while automations run: that needs named approvers with their own identity (engine
// bump D15; hosted Team plan, D10). Every org page says so.
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, appendFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FoundryError, digest, clone } from '../../src/data.mjs';
import { validateData } from '../../src/validate.mjs';
import { generateExamples, evaluate, flips, exampleProblems } from './rule-examples.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA = JSON.parse(readFileSync(path.join(here, 'schema', 'authority-map-v1.schema.json'), 'utf8'));
export const LAYERS = Object.freeze(['regulation', 'org-policy', 'entity-rule', 'process', 'workflow']);
export const LAYER_NAMES = Object.freeze({ regulation: 'Regulation', 'org-policy': 'Org policy', 'entity-rule': 'Entity rule', process: 'Process', workflow: 'Workflow' });
export const ROLES = Object.freeze([
  { id: 'admin', name: 'Admin', description: 'Sets Foundry up and changes who decides what.' },
  { id: 'builder', name: 'Builder', description: 'Makes and tests automations.' },
  { id: 'approver', name: 'Approver', description: 'Says yes or no to what an automation would do.' },
  { id: 'rule-owner', name: 'Rule owner', description: 'Owns a rule that never breaks; nobody else may change it.' },
  { id: 'auditor', name: 'Auditor', description: 'Reads records and evidence; changes nothing.' }]);
export const NOT_ENFORCED = 'Checked when an automation is made and tested. Not yet enforced while it runs: that needs named approvers, which are planned.';
const hashOf = map => digest(map);

// ------------------------------------------------------------------------------------------------ starters
export function starter(kind, { now = new Date(), entity = 'Your business' } = {}) {
  const base = { kind: 'foundry.authority-map/v1', id: 'org', version: 0, supersedes: null, entity, createdAt: now.toISOString(), starter: kind, layers: [...LAYERS], roles: clone(ROLES),
    principals: [{ id: 'you', name: 'You', kind: 'human', roles: ROLES.map(r => r.id), self: true }], parameters: {}, bounds: [], approvals: [], clauses: [],
    where: { allowedAI: 'none', practiceOnly: false, records: 'this-computer' },
    change: { proposerRoles: ['admin', 'rule-owner'], approverRole: 'admin', proposerMayApprove: false, approvalBeforeEffective: true }, signedBy: [] };
  if (kind === 'just-me' || kind === 'blank') return kind === 'blank' ? { ...base, principals: base.principals } : base;
  if (kind === 'small-team') return { ...base, approvals: [
    { id: 'A1', actionClass: 'money-out', approverRole: 'approver', approverPrincipal: 'you', remindAfterHours: 24, stopAfterHours: 72, excluded: ['requester'] },
    { id: 'A2', actionClass: 'message-outside', approverRole: 'approver', approverPrincipal: 'you', remindAfterHours: 24, stopAfterHours: 72, excluded: [] }] };
  if (kind === 'refund') {
    // The refund-authority starter mirrors experiments/constitution/instances/v1.json (E8): T = EUR 500, an org-policy bound of
    // EUR 1,000, a finance approver who may not have entered the case, change control by a controller. toConstitutionV0 exports it.
    const map = { ...base, entity: 'Refund authority example', roles: [...clone(ROLES)],
      principals: [{ id: 'you', name: 'You', kind: 'human', roles: ['admin', 'builder', 'auditor'], self: true },
        { id: 'p-controller', name: 'Controller', kind: 'human', roles: ['admin', 'rule-owner'] },
        { id: 'p-finance', name: 'Head of finance', kind: 'human', roles: ['rule-owner', 'approver'] },
        { id: 'svc-workflow', name: 'The order automation', kind: 'service', roles: [] }],
      parameters: { refundApprovalAbove: { value: 500, unit: 'EUR', label: 'Refunds above this need approval' } },
      bounds: [{ id: 'B1', layer: 'org-policy', owner: 'p-controller', parameter: 'refundApprovalAbove', min: 0, max: 1000, statement: 'Group policy: no refund above EUR 1,000 leaves without an approval. An entity rule may set a lower threshold, never a higher one.' }],
      approvals: [{ id: 'A1', actionClass: 'money-out', aboveParameter: 'refundApprovalAbove', approverRole: 'approver', approverPrincipal: 'p-finance', remindAfterHours: 24, stopAfterHours: 72, excluded: ['requester', 'entered-by'] }],
      change: { proposerRoles: ['rule-owner', 'admin'], approverRole: 'admin', proposerMayApprove: false, approvalBeforeEffective: true } };
    map.clauses = [ruleFromApproval(map, 'A1', { layer: 'entity-rule', narrows: ['B1'], title: 'Refund authority with separation of duties' })];
    return map;
  }
  throw new FoundryError('ORG_STARTER', 'Start from just-me, small-team, refund or blank');
}

/** A "rule that never breaks" made from a who-approves-what row (approval-above-threshold), with six generated examples. */
export function ruleFromApproval(map, approvalId, { layer = 'org-policy', narrows = [], title = null } = {}) {
  const a = map.approvals.find(x => x.id === approvalId);
  if (!a?.aboveParameter) throw new FoundryError('ORG_RULE', 'This row has no amount, so it can\'t become a money rule');
  const p = map.parameters[a.aboveParameter], who = map.principals.find(x => x.id === a.approverPrincipal)?.name ?? 'the approver';
  const owner = a.approverPrincipal && map.principals.find(x => x.id === a.approverPrincipal)?.roles.includes('rule-owner') ? a.approverPrincipal : 'you';
  const clause = { id: `R${map.clauses.length + 1}`, title: title ?? 'Money out above a limit needs a yes', layer, owner: { role: 'rule-owner', principal: owner }, assurance: ['provable'],
    statement: `Money out above ${p.unit === 'EUR' ? '€' : ''}${p.value}${p.unit === 'EUR' ? '' : ` ${p.unit}`} needs ${who}'s yes; whoever asked for it can't approve it.`,
    check: { kind: 'approval-above-threshold', parameter: a.aboveParameter, approverRole: a.approverRole, excludeRequester: a.excluded.includes('requester') },
    narrows, exceptions: [], evidence: [{ id: 'E1', what: 'the approval, bound to the case and the amount, with who gave it', source: 'Foundry run record and decision ledger' }],
    force: 'stop-unless-override', mode: 'preview', examples: [], doesNotCover: 'Only automations run by Foundry. Payments made directly in your bank or payment app are outside this rule.' };
  clause.examples = generateExamples(clause, map);
  return clause;
}

// ------------------------------------------------------------------------------------------------ validation
export function mapProblems(map) {
  try { validateData(SCHEMA, map, 'authority map'); }
  catch (error) { return { problems: [`The document's shape is wrong: ${(error.details ?? []).slice(0, 3).map(e => `${e.instancePath || '/'} ${e.message}`).join('; ') || error.message}`], warnings: [] }; }
  const problems = [], warnings = [];
  if (map.layers.join('>') !== LAYERS.join('>')) problems.push(`Layers must be ${LAYERS.join(' > ')}`);
  const roles = new Set(map.roles.map(r => r.id)), principals = new Map(map.principals.map(p => [p.id, p]));
  const dup = (list, what) => { const seen = new Set(); for (const x of list) { if (seen.has(x.id)) problems.push(`Two ${what} have the id ${x.id}`); seen.add(x.id); } };
  dup(map.roles, 'roles'); dup(map.principals, 'people'); dup(map.clauses, 'rules'); dup(map.approvals, 'approval rows'); dup(map.bounds, 'bounds');
  for (const p of map.principals) for (const r of p.roles) if (!roles.has(r)) problems.push(`${p.name} has an unknown role ${r}`);
  const holds = (pid, role) => principals.get(pid)?.roles.includes(role) ?? false;
  for (const a of map.approvals) {
    if (!roles.has(a.approverRole)) problems.push(`Approval row ${a.id}: unknown role ${a.approverRole}`);
    if (a.approverPrincipal && !holds(a.approverPrincipal, a.approverRole)) problems.push(`${principals.get(a.approverPrincipal)?.name ?? a.approverPrincipal} approves ${a.actionClass} but doesn't hold the Approver role`);
    if (a.aboveParameter && !map.parameters[a.aboveParameter]) problems.push(`Approval row ${a.id}: no amount set`);
  }
  for (const c of map.clauses) {
    if (!roles.has(c.owner.role)) problems.push(`${c.title}: owner role ${c.owner.role} unknown`);
    else if (!holds(c.owner.principal, c.owner.role)) problems.push(`${c.title}: ${principals.get(c.owner.principal)?.name ?? c.owner.principal} owns it but doesn't hold the ${c.owner.role} role`);
    if (c.check.kind === 'approval-above-threshold' && !map.parameters[c.check.parameter]) problems.push(`${c.title}: its amount (${c.check.parameter}) is not set`);
    for (const e of c.exceptions) if (!roles.has(e.who) || !roles.has(e.reviewBy)) problems.push(`${c.title}: exception ${e.id} names an unknown role`);
    for (const id of c.narrows) {
      const b = map.bounds.find(x => x.id === id);
      if (!b) { problems.push(`${c.title}: narrows unknown bound ${id}`); continue; }
      if (!(LAYERS.indexOf(b.layer) < LAYERS.indexOf(c.layer))) problems.push(`${c.title}: bound ${id} (${b.layer}) is not above the rule's layer (${c.layer})`);
    }
    if (c.check.kind === 'separation-of-duties' && (c.check.roles ?? []).length === 2) {
      for (const p of map.principals) if (c.check.roles.every(r => p.roles.includes(r))) warnings.push(`${p.name} holds both ${c.check.roles.join(' and ')}, which "${c.title}" keeps apart.`);
    }
  }
  // A lower layer may only narrow: every bounded parameter stays inside its bounds.
  for (const b of map.bounds) {
    const v = map.parameters[b.parameter]?.value;
    if (typeof v !== 'number') { problems.push(`Bound ${b.id}: ${b.parameter} is not set`); continue; }
    if (typeof b.max === 'number' && v > b.max) problems.push(`Not allowed: ${b.parameter} = ${v} is above the ${LAYER_NAMES[b.layer]} limit of ${b.max} set by ${principals.get(b.owner)?.name ?? b.owner}. A lower layer may only narrow it.`);
    if (typeof b.min === 'number' && v < b.min) problems.push(`Not allowed: ${b.parameter} = ${v} is below the ${LAYER_NAMES[b.layer]} minimum of ${b.min}.`);
    if (!principals.has(b.owner)) problems.push(`Bound ${b.id}: unknown owner ${b.owner}`);
  }
  for (const r of [...map.change.proposerRoles, map.change.approverRole]) if (!roles.has(r)) problems.push(`Change control names an unknown role ${r}`);
  for (const c of map.clauses) for (const e of c.examples) if (e.confirmed && evaluate(c, map, e.case) !== e.answer && !flips(map).some(f => f.clause === c.id && f.n === e.n)) problems.push(`${c.title}: case ${e.n} disagrees with the rule`);
  // Every version is signed by the one person at this computer until a second person's own sign-in exists (Team plan).
  if ((map.signedBy?.length ?? 0) < 2) warnings.push('Started by one person. Rules need a second person to approve changes; until then, you approved your own setup. Review within 14 days.');
  return { problems, warnings };
}

// ------------------------------------------------------------------------------------------------ versions (hash chain)
export class AuthorityMaps {
  constructor(root, { now = () => Date.now() } = {}) { this.dir = path.join(root, 'org'); this.now = now; }
  #history() { const f = path.join(this.dir, 'history.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; }
  versions() { return this.#history(); }
  current() {
    const h = this.#history(), last = h.at(-1);
    if (!last) return null;
    const map = JSON.parse(readFileSync(path.join(this.dir, `authority-map.v${last.version}.json`), 'utf8'));
    if (hashOf(map) !== last.hash) throw new FoundryError('ORG_TAMPERED', `authority-map.v${last.version}.json does not match its recorded hash`);
    return { map, hash: last.hash, version: last.version };
  }
  /** History chain check: each line names the previous line's hash and the version it supersedes. */
  verify() {
    let prev = null, prevHash = null;
    for (const line of this.#history()) {
      const { lineHash, ...rest } = line;
      if (digest(rest) !== lineHash || rest.previousLine !== prev || rest.supersedes !== prevHash) return { ok: false, at: line.version };
      const file = path.join(this.dir, `authority-map.v${line.version}.json`);
      if (!existsSync(file) || hashOf(JSON.parse(readFileSync(file, 'utf8'))) !== line.hash) return { ok: false, at: line.version };
      prev = lineHash; prevHash = line.hash;
    }
    return { ok: true, versions: this.#history().length };
  }
  /** Validate and save the next version. Refused on problems, open examples or flipped examples (the person confirms each flip). */
  save(draft, { signer = 'you' } = {}) {
    const cur = this.current();
    const map = clone(draft);
    map.version = (cur?.version ?? 0) + 1; map.supersedes = cur?.hash ?? null; map.createdAt = new Date(this.now()).toISOString(); map.signedBy = [signer];
    const flipped = flips(map);
    if (flipped.length) throw Object.assign(new FoundryError('ORG_FLIPPED', flipped.map(f => f.message).join(' ')), { flips: flipped });
    const open = exampleProblems(map);
    const { problems, warnings } = mapProblems(map);
    if (open.length || problems.length) throw Object.assign(new FoundryError('ORG_INVALID', [...problems, ...open].join(' ')), { problems: [...problems, ...open] });
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const file = path.join(this.dir, `authority-map.v${map.version}.json`), tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(map, null, 2), { mode: 0o600 }); renameSync(tmp, file);
    const prev = this.#history().at(-1)?.lineHash ?? null;
    const line = { version: map.version, hash: hashOf(map), supersedes: map.supersedes, at: map.createdAt, signedBy: map.signedBy, previousLine: prev };
    appendFileSync(path.join(this.dir, 'history.jsonl'), `${JSON.stringify({ ...line, lineHash: digest(line) })}\n`, { mode: 0o600 });
    return { saved: true, version: map.version, hash: line.hash, warnings, map };
  }
}

// ------------------------------------------------------------------------------------------------ export to constitution v0
/**
 * The refund-authority map as a constitution-v0 document (experiments/constitution), to show the vocabulary is the same.
 * v0 is E8-specific (clauses C1-C3, a refund threshold in EUR minor units). C2 comes from the map's refund rule; C3 from its change
 * control; C1 (conservation) has no evaluable form in the map and is carried as the E8 family's stated clause.
 */
export function toConstitutionV0(map, { effectiveFrom = '2026-01-01T00:00:00+01:00' } = {}) {
  const rule = map.clauses.find(c => c.check.kind === 'approval-above-threshold');
  const p = rule ? map.parameters[rule.check.parameter] : null;
  if (!rule || !p || p.unit !== 'EUR') throw new FoundryError('ORG_V0', 'Only a map with a money rule in EUR exports to constitution v0');
  const roleIds = new Set(map.roles.map(r => r.id));
  const ownerOf = role => map.principals.find(x => x.roles.includes(role))?.id;
  const bound = rule.narrows.map(id => map.bounds.find(b => b.id === id)).filter(Boolean);
  const doc = {
    kind: 'foundry.constitution/v0', constitution: map.id, version: Math.max(1, map.version), supersedes: map.supersedes, entity: map.entity, effectiveFrom, layers: [...map.layers],
    roles: map.roles.map(r => ({ id: r.id, description: r.description ?? r.name })),
    principals: map.principals.map(x => ({ id: x.id, kind: x.kind, roles: x.roles.filter(r => roleIds.has(r)), description: x.name })),
    bounds: bound.map(b => ({ id: b.id, layer: b.layer, owner: map.principals.find(x => x.id === b.owner)?.roles.includes('admin') ? 'admin' : 'rule-owner', parameter: 'refundApprovalThresholdMinor',
      ...(typeof b.min === 'number' ? { min: Math.round(b.min * 100) } : {}), ...(typeof b.max === 'number' ? { max: Math.round(b.max * 100) } : {}), statement: b.statement })),
    parameters: { refundApprovalThresholdMinor: Math.round(p.value * 100), currency: 'EUR' },
    clauses: [
      { id: 'C1', title: 'Conservation and exactly-once money movement', layer: 'org-policy', owner: { role: 'admin', principal: ownerOf('admin') }, assurance: ['monitorable'],
        statement: 'Money captured less money refunded equals what the customer owes for what was delivered; nothing is charged twice. (Carried from the E8 family: the authority map has no evaluable form for it.)',
        check: { kind: 'conservation', objects: ['order', 'fulfilment', 'payment'] }, narrows: [], exceptions: [], evidence: [{ id: 'C1-E1', what: 'every charge and refund attempt with its key and amount', source: 'host journal' }] },
      { id: 'C2', title: rule.title, layer: rule.layer, owner: { role: rule.owner.role, principal: rule.owner.principal }, assurance: rule.assurance, statement: rule.statement,
        check: { kind: 'approval-above-threshold', effect: 'billing.refund', amountArg: 'amountMinor', parameter: 'refundApprovalThresholdMinor', approverRole: rule.check.approverRole,
          taskKind: 'refundApproval', taskSubject: 'fulfilmentId', sodExclude: ['entered-amend', 'entered-cancel'] },
        narrows: rule.narrows, exceptions: rule.exceptions, evidence: rule.evidence },
      { id: 'C3', title: 'Change control and pinning', layer: 'org-policy', owner: { role: map.change.approverRole, principal: ownerOf(map.change.approverRole) }, assurance: ['provable'],
        statement: 'The rules change only by a new version proposed by a holder of a proposer role and approved, before it takes effect, by someone else holding the approver role.',
        check: { kind: 'change-control', proposerRoles: map.change.proposerRoles, approverRole: map.change.approverRole, sodExclude: ['proposer'], approvalBeforeEffective: map.change.approvalBeforeEffective, pinAt: 'order.placedAt' },
        narrows: [], exceptions: [], evidence: [{ id: 'C3-E1', what: 'every version with proposer and approvals', source: 'authority map history (hash-chained)' }] }],
    change: { proposerRoles: map.change.proposerRoles, approverRole: map.change.approverRole, proposerMayApprove: map.change.proposerMayApprove, approvalBeforeEffective: map.change.approvalBeforeEffective }
  };
  return doc;
}
export { hashOf, readdirSync };
