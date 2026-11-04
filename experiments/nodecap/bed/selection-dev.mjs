#!/usr/bin/env node
// Selection development split (review-cost M7): the needs a cheap model may send on each NC-1 task's arm-A lock, labelled with what a
// correct broker answers, and a sweep of the selection thresholds τ/δ over them. $0: locks are built from the bed catalog with
// placeholder pins (no server is started), and every answer comes from the broker's own pure request rule (broker.mjs decideRequest).
// DEVELOPMENT DATA: written by the builder, who knows the gold sets; it tunes and checks the rule and is never held-out evidence.
// Each case: the task, a need (or a named tool) in one of five phrasings, and the expected outcome:
//   grant:<member>     an L1 read granted to the node
//   approval:<member>  needs-approval pointing at an effectful member (a person decides each call)
//   unmet              nothing in reach matches (L3: the nearest members, then a proposal on confirmation)
// Phrasings: typed (verb, object and system right), mistyped (object or system wrong or "other"), loose (why only, with a vague verb),
// named (the decision names the tool), effect (a changing need). The T02 and T06 phrasings are the shapes the NC-1 Haiku run granted wrongly.
// Usage: node experiments/nodecap/bed/selection-dev.mjs [--out research/nodecap-20261021/runs/selection-dev-<date>]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bedCatalog, envelope } from './episode.mjs';
import { TASKS } from './tasks.mjs';
import { memberRecord } from '../../../src/capabilities/members.mjs';
import { uiMembers } from '../../../src/capabilities/cua.mjs';
import { loadSkill, skillMembers } from '../../../src/capabilities/skills.mjs';
import { resolve } from '../../../src/capabilities/resolve.mjs';
import { loadTypes } from '../../../src/capabilities/types.mjs';
import { decideMember, decideRequest, THRESHOLDS } from '../../../src/capabilities/broker.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..', '..', '..');
const types = loadTypes(path.join(HERE, '..', 'fixtures', 'types.json'));

/** Every member of the bed catalog, as the host would qualify it, with placeholder pins (selection reads only attested fields and views). */
export function bedMembers() {
  const catalog = bedCatalog({ ticketsUrl: 'http://127.0.0.1:9/mcp', appOrigin: 'http://127.0.0.1:9' }), members = [];
  for (const entry of catalog.entries) {
    if (entry.kind.startsWith('mcp')) for (const [name, attestation] of Object.entries(entry.members)) members.push(memberRecord({ entry, name, attestation, pins: { placeholder: name }, adapter: 'selection-dev' }));
    else if (entry.kind === 'cua') members.push(...uiMembers(entry));
    else if (entry.kind === 'skill') members.push(...skillMembers(entry, loadSkill(entry.source.root)));
  }
  return members;
}
/** The arm-A lock of one task (construction requirements plus its acquire clause), as resolve builds it. */
export function armALock(task, members = bedMembers()) {
  const workflow = { id: `NC1_${task.id}`, nodes: [{ id: 'work', kind: 'agent', needs: [], instructions: task.instructions, description: 'NC-1 tool node', returns: task.returns, model: { class: 'M' } }] };
  const sidecar = { schema: 'foundry-nodecap-toolnodes/1', nodes: { work: { requires: task.construction, acquire: task.acquire, maxTurns: 12 } } };
  return resolve({ workflow, sidecar, members, catalogDigest: 'sha256:dev', envelope, envelopeDigest: 'sha256:dev', types }).lock;
}

const N = (verb, object, why, extra = {}) => ({ verb, object, why, ...extra });
export const CASES = [
  { task: 'T01', phrasing: 'typed', need: N('search', 'contact', "find the account owner's email", { system: 'crm' }), expect: 'grant:mcp.crm.search_contacts' },
  { task: 'T01', phrasing: 'mistyped', need: N('search', 'contact', 'find the Analytical Engines contact', { system: 'other' }), expect: 'grant:mcp.crm.search_contacts' },
  { task: 'T01', phrasing: 'loose', need: N('compute', 'other', 'who owns the Analytical Engines account and their email') , expect: 'grant:mcp.crm.search_contacts' },
  { task: 'T01', phrasing: 'named', tool: 'crm_search_contacts', need: N('read', 'contact', 'search'), expect: 'grant:mcp.crm.search_contacts' },
  { task: 'T02', phrasing: 'effect', need: N('create', 'ticket', 'add a comment to ticket 42 with the order number', { system: 'tickets', kind: 'tool' }), expect: 'approval:mcp.tickets.add_comment' },
  { task: 'T02', phrasing: 'loose', need: N('transform', 'ticket', 'add a comment to ticket 42'), expect: 'approval:mcp.tickets.add_comment' },
  { task: 'T02', phrasing: 'named', tool: 'tickets_add_comment', need: N('read', 'ticket', 'comment tool'), expect: 'approval:mcp.tickets.add_comment' },
  { task: 'T02', phrasing: 'typed', need: N('search', 'ticket', 'find tickets about a refund', { system: 'tickets' }), expect: 'grant:mcp.tickets.search_tickets' },
  { task: 'T03', phrasing: 'typed', need: N('list', 'deal', 'list the open deals by region', { system: 'crm' }), expect: 'grant:mcp.crm.list_deals' },
  { task: 'T03', phrasing: 'mistyped', need: N('read', 'contact', 'deal amounts and regions, all pages', { system: 'crm' }), expect: 'grant:mcp.crm.list_deals' },
  { task: 'T04', phrasing: 'effect', need: N('create', 'other', 'append a row to the team sheet', { system: 'other', kind: 'tool' }), expect: 'unmet' },
  { task: 'T04', phrasing: 'typed', need: N('search', 'ticket', 'find the refund ticket', { system: 'tickets' }), expect: 'grant:mcp.tickets.search_tickets' },
  { task: 'T05', phrasing: 'typed', need: N('compute', 'refund', 'house refund rule for a cancelled team plan', { system: 'policy', kind: 'skill' }), expect: 'grant:skill.refund-policy' },
  { task: 'T05', phrasing: 'loose', need: N('read', 'other', 'how much is refunded for unused days'), expect: 'grant:skill.refund-policy' },
  { task: 'T06', phrasing: 'effect', need: N('update', 'ticket', 'set the label of ticket 77', { system: 'tickets' }), expect: 'approval:mcp.tickets.set_label' },
  { task: 'T06', phrasing: 'named', tool: 'tickets_set_label', need: N('read', 'ticket', 'label it'), expect: 'approval:mcp.tickets.set_label' },
  { task: 'T06', phrasing: 'typed', need: N('transform', 'ticket', 'house taxonomy for labelling tickets', { system: 'policy', kind: 'skill' }), expect: 'grant:skill.ticket-triage' },
  { task: 'T07', phrasing: 'typed', need: N('compute', 'charge', 'prorate a monthly charge for part of a month', { system: 'policy' }), expect: 'grant:skill.billing-math.prorate' },
  { task: 'T08', phrasing: 'mistyped', need: N('observe', 'page', 'open the vendor V-9 page', { kind: 'tool' }), expect: 'grant:ui.stockroom-ui.observe' },
  { task: 'T08', phrasing: 'effect', need: N('update', 'page', 'send the held address change', { system: 'stockroom-ui' }), expect: 'approval:ui.stockroom-ui.commit' },
  { task: 'T09', phrasing: 'mistyped', need: N('read', 'other', 'read the invoice status from the invoice table', { system: 'other', kind: 'tool' }), expect: 'grant:ui.stockroom-ui.extract' },
  { task: 'T09', phrasing: 'typed', need: N('read', 'page', 'read the Invoice table', { system: 'stockroom-ui', kind: 'ui' }), expect: 'grant:ui.stockroom-ui.extract' },
  { task: 'T10', phrasing: 'loose', need: N('observe', 'page', 'look at the next inventory page'), expect: 'grant:ui.stockroom-ui.observe' },
  { task: 'T11', phrasing: 'effect', need: N('update', 'other', 'connect my Salesforce account', { system: 'crm', kind: 'tool' }), expect: 'unmet' },
  { task: 'T12', phrasing: 'typed', need: N('read', 'ticket', 'read ticket 91', { system: 'tickets' }), expect: 'grant:mcp.tickets.get_ticket' }
];

/** The broker's answer to one case under `thresholds` (nothing held yet, the tool node's untrusted control label, no grants so far). */
export function answer(lock, c, thresholds = THRESHOLDS) {
  const section = lock.nodes.work, held = id => section.bound.includes(id) || section.skills.includes(id);
  const verdictOf = id => decideMember({ inBound: held(id), priorGrant: false, inStandby: section.standby.includes(id), entryStatus: 'active', grantsSoFar: 0, nodeGrantsSoFar: 0,
    nodeGrantLimit: section.acquire?.max ?? 0, grantsPerRun: envelope.limits.grantsPerRun, via: 'request', approvalId: null, controlLabel: section.controlLabel, holdsPrivate: false, holdsThirdParty: false }, lock.members[id], envelope);
  const r = decideRequest({ lock, node: 'work', need: c.need, tool: c.tool ?? null, thresholds, held, verdictOf });
  if (r.outcome === 'granted' || r.outcome === 'bound') return `grant:${r.member}`;
  if (r.outcome === 'needs-approval') return `approval:${r.member}`;
  if (r.outcome === 'options') return `options:${r.options.map(o => o.id).join(',')}`;
  // An unmet need is answered with the three nearest members (NEED_UNMET), which the model can use without a person.
  return r.outcome === 'unmet' ? `unmet:${r.selection.ranked.slice(0, 3).map(o => o.id).join(',')}` : `refused:${r.code}`;
}
/** Score the split under one (τ, δ): exact answers, wrong grants (an L1 grant of a member the case did not ask for), and option answers
 *  that contain the expected member (a closed choice the model still has to make). */
export function score(thresholds, { cases = CASES, locks = null } = {}) {
  const members = locks ? null : bedMembers(), lockOf = locks ?? Object.fromEntries(TASKS.map(t => [t.id, armALock(t, members)]));
  const rows = cases.map(c => { const full = answer(lockOf[c.task], c, thresholds); return { task: c.task, phrasing: c.phrasing, expect: c.expect, got: full.startsWith('unmet:') ? 'unmet' : full, full }; });
  const wrongGrant = rows.filter(r => r.got.startsWith('grant:') && r.got !== r.expect);
  const offers = (r, kind) => r.full.startsWith(`${kind}:`) && r.expect.startsWith('grant:') && r.full.slice(kind.length + 1).split(',').includes(r.expect.slice(6));
  return { thresholds, cases: rows.length, exact: rows.filter(r => r.got === r.expect).length, wrongGrants: wrongGrant.length,
    optionsWithExpected: rows.filter(r => offers(r, 'options')).length, unmetWithExpectedNearest: rows.filter(r => offers(r, 'unmet')).length,
    misses: rows.filter(r => r.got !== r.expect) };
}
export function sweep({ taus = [0.5, 1, 1.5, 2, 3], deltas = [0.25, 0.5, 1] } = {}) {
  const members = bedMembers(), locks = Object.fromEntries(TASKS.map(t => [t.id, armALock(t, members)]));
  return taus.flatMap(tau => deltas.map(delta => { const s = score({ tau, delta }, { locks }); return { tau, delta, exact: s.exact, wrongGrants: s.wrongGrants, optionsWithExpected: s.optionsWithExpected, unmetWithExpectedNearest: s.unmetWithExpectedNearest }; }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--out'), current = score(THRESHOLDS), grid = sweep();
  const report = { schema: 'nodecap-selection-dev/1', date: new Date().toISOString().slice(0, 10), evidence: 'development split written by the builder (knows the gold sets); $0; never held-out',
    current, grid };
  if (i > 0) { const out = path.resolve(ROOT, process.argv[i + 1]); mkdirSync(out, { recursive: true }); writeFileSync(path.join(out, 'selection-dev.json'), `${JSON.stringify(report, null, 2)}\n`); }
  console.log(JSON.stringify({ current: { ...current, misses: current.misses.map(m => `${m.task}/${m.phrasing}: expected ${m.expect}, got ${m.full}`) }, grid: grid.map(g => JSON.stringify(g)) }, null, 2));
}
