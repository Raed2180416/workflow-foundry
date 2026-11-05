// FoundryApp's condition-tracker methods, kept out of service.mjs so the service gains only narrow hooks (DESIGN rule: new files,
// narrow hooks). Each takes the app as its first argument.
//
//   conditions({ flowId, proposalId? })        what the person asked for: each condition, its quote, its check in plain words, its status
//   checkConditions({ proposalId | flowId })   run that exact version on practice data and judge every condition (records the results)
//   proposeConditionEdit({ flowId, changes, by, channel })   version-bound edits: a model's wait for a person; a person's apply at once
//   decideCondition({ flowId, action, ... , channel })        a person only: accept / reject an edit, confirm, waive (with why), unwaive
//   checkRun({ runId })                        the same checks on what one LIVE run read and did (./live.mjs); FoundryApp calls it after
//                                              every run that finishes
import { mkdirSync } from 'node:fs';
import { FoundryError } from '../../../src/data.mjs';
import { HUMAN_CHANNELS } from '../ledger.mjs';
import { locate } from './words.mjs';
import { practiceWorkspace } from './practice.mjs';
import { liveView } from './live.mjs';
import { readOutbox, readWorld } from '../stand-ins.mjs';
import { templateOf } from '../library.mjs';
import { SAMPLE_INPUT } from '../builder.mjs';

function versionOf(app, { proposalId = null, flowId = null }) {
  if (proposalId) { const p = app.foundry.store.proposal(proposalId); return { flowId: p.workflow.id, workflow: p.workflow, workflowHash: p.workflowHash, proposalId }; }
  try { const h = app.foundry.store.workflow(flowId); return { flowId, workflow: h.workflow, workflowHash: h.hash, proposalId: null }; }
  catch (error) { if (error.code === 'NOT_FOUND') return { flowId, workflow: null, workflowHash: null, proposalId: null }; throw error; }
}
const latestProposal = (app, flowId) => app.foundry.store.proposals().filter(p => p.workflow.id === flowId).at(-1) ?? null;

/** Called by FoundryApp.propose after a version-bound proposal is made: read the person's words into the flow's condition ledger. */
export async function trackProposal(app, { flowId, request, answers }) {
  try {
    const r = await app.tracker.captureFrom({ flowId, request, answers });
    const v = app.tracker.view({ flowId });
    return { ledgerVersion: v.ledgerVersion, added: r.added, count: v.conditions.length, unconfirmed: v.conditions.filter(c => !c.confirmed).length,
      next: 'See what was understood with the conditions tool (or the dashboard); the person confirms or edits each one.' };
  } catch (error) { return { error: { code: error.code ?? 'ERROR', message: String(error.message).slice(0, 300) } }; }
}

export function conditions(app, { flowId = null, proposalId = null }) {
  const v = versionOf(app, { proposalId, flowId });
  const hash = v.workflowHash ?? latestProposal(app, v.flowId)?.workflowHash ?? null;
  return { ok: true, ...app.tracker.view({ flowId: v.flowId, workflowHash: hash }), workflowHash: hash };
}

export async function checkConditions(app, { proposalId = null, flowId = null }) {
  let v = versionOf(app, { proposalId, flowId });
  if (!v.workflow && v.flowId) { const p = latestProposal(app, v.flowId); if (p) v = versionOf(app, { proposalId: p.id }); }
  if (!v.workflow) throw new FoundryError('NOT_FOUND', `No flow or proposal to check for ${flowId ?? proposalId}`);
  // A library flow practises on the person's practice workspace (every sheet); the preview weekly report on its sample input.
  const practice = templateOf(v.workflow) ? practiceWorkspace() : { now: null, sheets: {}, input: SAMPLE_INPUT };
  mkdirSync(app.practiceRoot, { recursive: true, mode: 0o700 });
  const r = await app.tracker.check({ flowId: v.flowId, workflow: v.workflow, workflowHash: v.workflowHash, practice, root: app.practiceRoot });
  return { ok: true, ...r, proposalId: v.proposalId,
    caveat: 'Practice data with stand-ins: a met condition means this version did it on practice data, not that it will in your live data.' };
}

/**
 * changes: [{ op: 'add', quote, summary? } | { op: 'change', conditionId, summary?, quote? } | { op: 'remove', conditionId }].
 * A quote must be the person's own words. A person (dashboard, CLI) may add new words; a model (MCP) may only point at words already said.
 */
export async function proposeConditionEdit(app, { flowId, changes, by = 'model', channel = null, note = null }) {
  if (!Array.isArray(changes) || !changes.length) throw new FoundryError('TRACKER_DELTA', 'No changes given');
  const person = by === 'person';
  if (person && !HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `A person's edit comes from ${HUMAN_CHANNELS.join(', ')}, not ${channel}`);
  let words = app.tracker.store.ledger(flowId).words ?? [];
  const delta = [];
  for (const c of changes) {
    if (c.op === 'add' || (c.op === 'change' && c.quote)) {
      let at = locate(words, c.quote);
      if (!at && person) { words = app.tracker.store.setWords(flowId, [...words, { turn: words.length, kind: 'edit', text: String(c.quote).slice(0, 2000) }]); at = locate(words, c.quote); }
      if (!at) throw new FoundryError('TRACKER_QUOTE', `“${String(c.quote).slice(0, 80)}” is not in the person's words; a condition quotes what they said`);
      const condition = { quote: at.text, source: { turn: at.turn, kind: at.kind, start: at.start, end: at.end }, summary: String(c.summary ?? at.text).slice(0, 300), kind: 'other',
        origin: 'user', verification: 'test', why: null, check: null, missing: [], bound: false };
      if (c.op === 'add') delta.push({ op: 'ADDED', condition });
      else { const cur = app.tracker.store.condition(flowId, c.conditionId); delta.push({ op: 'MODIFIED', id: c.conditionId, baseVersion: cur.version, condition }); }
    } else if (c.op === 'change') {
      const cur = app.tracker.store.condition(flowId, c.conditionId);
      const { id, version, state, confirmed, ...body } = cur;
      delta.push({ op: 'MODIFIED', id: c.conditionId, baseVersion: cur.version, condition: { ...body, summary: String(c.summary ?? body.summary).slice(0, 300), check: null, bound: false } });
    } else if (c.op === 'remove') {
      const cur = app.tracker.store.condition(flowId, c.conditionId);
      delta.push({ op: 'REMOVED', id: c.conditionId, baseVersion: cur.version });
    } else throw new FoundryError('TRACKER_DELTA', `op must be add, change or remove, not ${c.op}`);
  }
  const p = app.tracker.store.propose({ flowId, delta, by: person ? 'person' : 'model', channel, note });
  if (p.status === 'accepted') await app.tracker.bindPending(flowId);
  return { ok: true, proposal: p, status: p.status, next: p.status === 'proposed' ? 'The person accepts or rejects this edit (dashboard, or the dialog your client shows); you cannot.' : 'Applied.' };
}

/** action: accept | reject (an edit), confirm (a condition), waive | unwaive (a condition, for one workflow version). A person only. */
export async function decideCondition(app, { flowId, action, proposalId = null, conditionId = null, why = null, workflowHash = null, channel, principal = 'local-user' }) {
  if (!HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `Only a person decides on conditions, not ${channel}`);
  switch (action) {
    case 'accept': case 'reject': {
      const p = app.tracker.store.decide(proposalId, action === 'accept', { channel, principal });
      if (p.status === 'accepted') await app.tracker.bindPending(p.flowId);
      return { ok: true, proposal: p };
    }
    case 'confirm': return { ok: true, condition: app.tracker.store.confirm(flowId, conditionId, { channel, principal }) };
    case 'waive': {
      const hash = workflowHash ?? conditions(app, { flowId }).workflowHash;
      return { ok: true, waiver: app.tracker.store.waive(flowId, conditionId, { workflowHash: hash, why, channel, principal }) };
    }
    case 'unwaive': app.tracker.store.unwaive(flowId, conditionId, { channel }); return { ok: true };
    default: throw new FoundryError('TRACKER_ACTION', 'action is accept, reject, confirm, waive or unwaive');
  }
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'uncertain']);
/** Judge every condition of the run's flow on what that live run read and did (./live.mjs). Records the statuses per run. */
export async function checkRun(app, { runId }) {
  const run = app.foundry.publicRun(app.foundry.store.run(runId));
  if (!TERMINAL.has(run.status)) return { ok: false, problem: { code: 'RUN_NOT_FINISHED', details: `The run is ${run.status}; conditions are checked when it ends.` } };
  const { workflow } = app.foundry.store.workflow(run.workflowHash);
  if (!app.tracker.store.conditions(workflow.id).length) return { ok: true, runId, conditions: [], tally: null, note: 'No conditions are logged for this flow.' };
  const view = liveView({ runId, workflow, events: app.foundry.store.events(runId), outbox: readOutbox(app.outboxDir), world: readWorld(app.worldDir), now: run.input?.now ?? null });
  const r = app.tracker.checkLive({ flowId: workflow.id, workflowHash: run.workflowHash, runId, view });
  return { ok: true, ...r, runStatus: run.status,
    caveat: 'Checked on what this live run read and did. A condition its data never reached stays unknown (not exercised); it is not met.' };
}
/** FoundryApp's hook after a run returns: attach the live check when the run has ended (never fails the run's own answer). */
export async function afterRun(app, answer) {
  if (!answer?.ok || !answer.runId || !TERMINAL.has(answer.status)) return answer;
  try {
    const c = await checkRun(app, { runId: answer.runId });
    if (!c.ok || !c.tally) return answer;
    const unmet = c.conditions.filter(x => x.status === 'unmet');
    return { ...answer, conditions: { tally: c.tally, unmet: unmet.map(x => ({ id: x.id, quote: x.quote, evidence: x.evidence[0]?.why ?? null })),
      next: unmet.length ? 'Some of the person\'s conditions were not met in this run: show them (conditions tool) before running it again.' : 'No condition was broken in this run.' } };
  } catch (error) { return { ...answer, conditions: { error: { code: error.code ?? 'ERROR', message: String(error.message).slice(0, 200) } } }; }
}
