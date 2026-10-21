// Constitution v0 as data (OT-0, research/org-20261021; ATTACK-FABLE §3.3). A constitution version is a JSON document
// (schema/constitution-v0.schema.json, the portable subset) with principals and roles, parameter bounds by layer, and
// clauses C1-C3, each with an accountable owner, a layer, an assurance class, authorised exceptions and an evidence
// requirement. This module loads and checks documents; the registry (registry.mjs) decides which version is in force.
// Pure, $0. Validation reuses the E-bed host's portable-subset validator (imported read-only).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, schemaProblems } from '../../beds/ebed/host/schema.mjs';
import { hashOf } from '../../beds/lib/canonical.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = f => JSON.parse(readFileSync(path.join(here, f), 'utf8'));

export const SCHEMA = Object.freeze(readJson('schema/constitution-v0.schema.json'));
export const LAYERS = Object.freeze(['regulation', 'org-policy', 'entity-rule', 'process', 'workflow']);
export const INSTANCES = Object.freeze({ v1: readJson('instances/v1.json'), v2: readJson('instances/v2.json'), v3: readJson('instances/v3-planted.json') });

/** The version hash: sha256 of the document's canonical JSON. */
export const docHash = doc => hashOf(doc);
export const thresholdOf = doc => doc.parameters.refundApprovalThresholdMinor;
export const clauseOf = (doc, id) => doc.clauses.find(c => c.id === id) ?? null;

/** Roles of a principal under a document (`cust:<id>` matches the customer class `cust:*`). */
export function rolesOf(doc, principal) {
  if (typeof principal !== 'string') return [];
  const p = doc.principals.find(x => x.id === principal) ?? (principal.startsWith('cust:') ? doc.principals.find(x => x.id === 'cust:*') : null);
  return p ? [...p.roles] : [];
}
export const holds = (doc, principal, role) => rolesOf(doc, principal).includes(role);

/** Parameters outside the bounds that a higher layer than the clause using them sets ("a lower layer may only narrow"). */
export function boundProblems(doc, boundsFrom = doc) {
  const out = [];
  const rank = l => LAYERS.indexOf(l);
  for (const c of doc.clauses) {
    for (const id of c.narrows) {
      const b = boundsFrom.bounds.find(x => x.id === id);
      if (!b) { out.push(`${c.id}: narrows unknown bound ${id}`); continue; }
      if (!(rank(b.layer) < rank(c.layer))) out.push(`${c.id}: bound ${id} (${b.layer}) is not above the clause's layer (${c.layer})`);
      const v = doc.parameters[b.parameter];
      if (typeof v !== 'number') { out.push(`${c.id}: parameter ${b.parameter} missing`); continue; }
      if (typeof b.max === 'number' && v > b.max) out.push(`${c.id}: ${b.parameter} = ${v} above the ${b.layer} bound ${id} (max ${b.max}): a lower layer may only narrow`);
      if (typeof b.min === 'number' && v < b.min) out.push(`${c.id}: ${b.parameter} = ${v} below the ${b.layer} bound ${id} (min ${b.min})`);
    }
  }
  return out;
}

/** Schema and semantic problems of one document ([] when it is a well-formed version). */
export function docProblems(doc) {
  const sp = schemaProblems(SCHEMA);
  if (sp.length) return [`schema itself: ${sp[0]}`];
  const errs = validate(SCHEMA, doc);
  if (errs.length) return errs;
  const out = [];
  if (doc.layers.join('>') !== LAYERS.join('>')) out.push(`layers must be ${LAYERS.join(' > ')}`);
  const roles = new Set(doc.roles.map(r => r.id));
  for (const p of doc.principals) for (const r of p.roles) if (!roles.has(r)) out.push(`principal ${p.id}: unknown role ${r}`);
  for (const c of doc.clauses) {
    if (!roles.has(c.owner.role)) out.push(`${c.id}: owner role ${c.owner.role} unknown`);
    if (!holds(doc, c.owner.principal, c.owner.role)) out.push(`${c.id}: owner ${c.owner.principal} does not hold ${c.owner.role}`);
    for (const x of c.exceptions) { if (!roles.has(x.who)) out.push(`${c.id}/${x.id}: role ${x.who} unknown`); if (!roles.has(x.reviewBy)) out.push(`${c.id}/${x.id}: reviewer role ${x.reviewBy} unknown`); }
  }
  for (const id of ['C1', 'C2', 'C3']) if (!clauseOf(doc, id)) out.push(`clause ${id} missing`);
  if (!roles.has(doc.change.approverRole)) out.push(`change.approverRole ${doc.change.approverRole} unknown`);
  out.push(...boundProblems(doc));
  return out;
}

/** The constitution as text for a builder or an agent prompt (rendered from the document; the JSON stays the source). */
export function renderText(doc, { hash = docHash(doc) } = {}) {
  const L = [];
  L.push(`# Constitution ${doc.constitution} v${doc.version} (${doc.entity})`, '');
  L.push(`hash ${hash}; effective from ${doc.effectiveFrom}; supersedes ${doc.supersedes ?? 'nothing'}.`, '');
  L.push(`Layers, highest first: ${doc.layers.join(' > ')}. A lower layer may only narrow what a higher layer allows.`, '');
  L.push(`Parameters: refund-approval threshold T = ${doc.parameters.refundApprovalThresholdMinor} minor units (${doc.parameters.currency}).`, '');
  L.push('## Bounds set by higher layers', '');
  for (const b of doc.bounds) L.push(`- ${b.id} (${b.layer}, owner ${b.owner}): ${b.statement}`);
  L.push('', '## Principals and roles', '');
  for (const p of doc.principals) L.push(`- ${p.id} (${p.kind}): ${p.roles.join(', ')}${p.description ? ` — ${p.description}` : ''}`);
  L.push('', '## Clauses', '');
  for (const c of doc.clauses) {
    L.push(`### ${c.id} ${c.title}`, '', `Layer ${c.layer}; owner ${c.owner.principal} (${c.owner.role}); assurance ${c.assurance.join(' + ')}.`, '', c.statement, '');
    for (const x of c.exceptions) L.push(`Exception ${x.id} (${x.kind}): ${x.who} may authorise when ${x.when}; requires ${x.requires.join(', ')}; reviewed by ${x.reviewBy} within ${x.reviewWithinHours} h.`);
    L.push(`Evidence: ${c.evidence.map(e => `${e.what} (${e.source})`).join('; ')}.`, '');
  }
  L.push('## Change rule', '', `A new version is proposed by a holder of ${doc.change.proposerRoles.join(' or ')} and approved by a holder of ${doc.change.approverRole} `
    + `under the version in force${doc.change.proposerMayApprove ? '' : ', who is not the proposer'}${doc.change.approvalBeforeEffective ? ', before the new version\'s effectiveFrom' : ''}; `
    + 'every parameter must stay within the bounds of higher layers. A version that fails any of these is not in force, whatever it says about itself.', '');
  return L.join('\n');
}
