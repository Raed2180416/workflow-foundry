// The condition tracker (task #60; owner, 2026-10-14: "log the conditions specified by user ... and check against logic and stuff
// demanded", "we shouldn't over engineer here"). Design and evidence: research/tracker-20261021/ (DOSSIER.md, RESULT-TRACKER.md).
//
//   the person's words ──capture──▶ conditions (quotes by pointer) ──bind──▶ one template check each (vocabulary only, linted)
//                                        │                                          │
//                     the person confirms, edits (version-bound proposals),         ▼
//                     waives (bound to condition version + workflow hash)     practice runs of a build (base, targeted, repeat),
//                                                                                    then every live run (./live.mjs)
//                                        │                                          │
//                                        └──────────── status per condition: met / unmet / unknown (why) / waived ◀──┘
//
// Not built, on purpose: no temporal-logic language, no model judging a status, no automatic repair of a check after a build was seen,
// no pattern-library conditions the person did not state.
import { evaluate, renderCheck, semanticsLevel } from './checks.mjs';
import { statusOf, tally } from './status.mjs';
import { realShape, crossBuild } from './gates.mjs';
import { scenarioRows } from './scenarios.mjs';
import { practiceViews, practiceWorkspace } from './practice.mjs';
import { appVocabulary } from './vocab.mjs';
import { capture, captureRule, bind } from './model.mjs';
import { ConditionStore } from './store.mjs';
import { wordsOf } from './words.mjs';
import { DEFAULT_SEMANTICS, prepareCheck, overlapRule, selectorRule, unknownObjects, contradictions, qualifierRule } from './semantics.mjs';

export const TRACKER_VERSION = 'tracker/2';

/**
 * Status of every condition over a set of views of ONE build. conditions: [{ id, version, quote, check, verification, missing, ... }].
 * gateViews: views (of any build of the same request) the real-shape gate may use; defaults to this build's views.
 * semantics: 'v4' (default: deviations D2 + D3 + D4, ./semantics.mjs; needs the person's `words`), 'v3' (D2 + D3, the preregistered
 * held-out product), 'v2' (D2 only) or 'v1' (the frozen tracker-checks/1, for replays).
 */
export function judgeViews(conditions, views, { workflowHash = null, waivers = {}, gateViews = null, suspects = new Set(), semantics = DEFAULT_SEMANTICS, words = [], schemas = {} } = {}) {
  const lvl = semanticsLevel(semantics);
  const prepared = conditions.map(c => (c.check && lvl >= 2 ? { ...c, check: prepareCheck(c.check, { quote: c.quote, words, semantics }) } : c));
  const results = new Map(prepared.filter(c => c.check).map(c => [c.id, views.map(v => evaluate(c.check, v, { semantics }))]));
  const objects = lvl >= 2 ? unknownObjects(prepared, gateViews ?? views, { semantics, schemas }) : new Map();
  const contra = lvl >= 3 ? contradictions(prepared) : new Map();
  if (lvl >= 2) { overlapRule(prepared, results, views, { semantics }); selectorRule(prepared, results, views, { words }); }
  if (lvl >= 3) qualifierRule(prepared, results, views, { words });
  const out = {};
  for (const c of prepared) {
    const flags = [];
    let gate = null;
    if (c.check) {
      gate = realShape(c.check, gateViews ?? views, { semantics });
      if (gate.exercised && gate.teeth === false) flags.push('suspect', 'no-teeth');
      if (suspects.has(c.id)) flags.push('suspect', 'fails-on-every-build');
      if (objects.has(c.id)) flags.push('suspect', 'unknown-object');
      if (contra.has(c.id)) flags.push('suspect', 'contradictory');
    }
    out[c.id] = { ...statusOf(c, { results: results.get(c.id) ?? null, workflowHash, waiver: waivers[c.id] ?? null, flags }), gate, check: c.check ? renderCheck(c.check) : null,
      ...(objects.has(c.id) ? { objectWhy: objects.get(c.id) } : {}), ...(contra.has(c.id) ? { contradiction: contra.get(c.id) } : {}),
      ...(c.check?.closedWorld ? { closedWorld: c.check.closedWorld } : {}) };
  }
  return out;
}

/** Run one workflow version on practice data (base, targeted, repeat) for these conditions' checks. */
export async function viewsFor(workflow, conditions, { practice = practiceWorkspace(), root = null, targeted = true, repeat = true, semantics = DEFAULT_SEMANTICS } = {}) {
  const checks = conditions.map(c => c.check).filter(Boolean);
  return practiceViews(workflow, { practice, root, repeat, scenarioRows: targeted ? base => scenarioRows(checks, base, { semantics }) : null });
}

/** checkWorkflow(...) → { statuses, tally, run, views } for one build. */
export async function checkWorkflow({ conditions, workflow, workflowHash = null, waivers = {}, practice, root = null, words = [], semantics = DEFAULT_SEMANTICS, schemas = {} }) {
  const { views } = await viewsFor(workflow, conditions, { practice, root, semantics });
  const statuses = judgeViews(conditions, views, { workflowHash, waivers, words, semantics, schemas });
  return { statuses, tally: tally(Object.values(statuses)), run: views[0].run, views };
}

/**
 * The product tracker: one condition ledger per flow in the app workspace. A port (journaled ModelPort) is optional: without one the
 * tracker captures by the $0 rule and binds nothing (every condition reads unknown: no-check until a person or a model binds it).
 */
export class Tracker {
  constructor({ file, port = null, model = 'claude-haiku-5-5', vocabulary = null, now = Date.now } = {}) {
    this.store = new ConditionStore(file, { now });
    this.port = port; this.model = model;
    this.vocabulary = vocabulary ?? (() => appVocabulary({ sheets: practiceWorkspace().sheets }));
  }
  close() { this.store.close(); }

  /** Read the person's words (request, answers, later edits) and propose the conditions they state. Applied at once, unconfirmed. */
  async captureFrom({ flowId, request, answers = {}, edits = [] }) {
    // The person's words are append-only: a revision's request, or an answer not seen before, becomes a new turn.
    const before = this.store.ledger(flowId).words ?? [];
    const merged = [...before];
    for (const w of wordsOf({ request, answers, edits })) {
      if (merged.some(m => m.text === w.text)) continue;
      merged.push({ ...w, turn: merged.length, kind: merged.length === 0 ? 'request' : w.kind === 'request' ? 'edit' : w.kind });
    }
    const words = this.store.setWords(flowId, merged);
    const known = new Set(this.store.conditions(flowId, { all: true }).map(c => `${c.source?.turn}:${c.source?.start}:${c.source?.end}`));
    const fresh = words.slice(before.length);
    if (!fresh.length) return { flowId, added: [], conditions: this.store.conditions(flowId) };
    let found;
    if (this.port) found = (await capture({ port: this.port, model: this.model, words: fresh, runId: `tracker-capture-${flowId}` })).conditions;
    else found = captureRule(fresh);
    found = found.filter(c => !known.has(`${c.source.turn}:${c.source.start}:${c.source.end}`));
    if (!found.length) return { flowId, added: [], conditions: this.store.conditions(flowId) };
    const p = this.store.propose({ flowId, by: 'tracker', delta: found.map(condition => ({ op: 'ADDED', condition })) });
    await this.bindPending(flowId);
    return { flowId, proposalId: p.id, added: p.applied.map(a => a.id), conditions: this.store.conditions(flowId) };
  }

  /** Bind a check to every condition that has none yet (a model call; nothing without a port). Each binding is a MODIFIED version. */
  async bindPending(flowId) {
    if (!this.port) return [];
    const open = this.store.conditions(flowId).filter(c => !c.check && c.verification === 'test' && !c.bound);
    if (!open.length) return [];
    const words = this.store.ledger(flowId).words;
    const vocab = this.vocabulary();
    const r = await bind({ port: this.port, model: this.model, vocab, words, conditions: open, runId: `tracker-bind-${flowId}` });
    const delta = open.map(c => {
      const b = r.get(c.id);
      const next = { ...withoutMeta(c), bound: true, binder: { model: this.model, decision: b?.decision ?? 'missing', lint: b?.lint ?? [] } };
      if (b?.decision === 'check' && b.check) Object.assign(next, { check: b.check, verification: 'test', why: null, missing: [] });
      else if (b?.decision === 'inspection') Object.assign(next, { verification: 'inspection', why: b.why ?? 'a run cannot show it' });
      else if (b?.decision === 'needs-answer') Object.assign(next, { missing: [b.question ?? 'A detail is missing'] });
      else if (b?.decision === 'not-a-condition') Object.assign(next, { verification: 'inspection', why: 'no requirement in these words', notACondition: true });
      else Object.assign(next, { why: b?.why ?? 'no check could be made' });
      return { op: 'MODIFIED', id: c.id, baseVersion: c.version, condition: next };
    });
    return this.store.propose({ flowId, by: 'tracker', delta }).applied;
  }

  /** Statuses of every active condition for one workflow version; runs it on practice data. Records the results. */
  async check({ flowId, workflow, workflowHash, practice = undefined, root = null }) {
    const conditions = this.store.conditions(flowId);
    const waivers = Object.fromEntries(conditions.map(c => [c.id, this.store.waiver(flowId, c.id, { workflowHash })]).filter(([, w]) => w));
    const res = await checkWorkflow({ conditions, workflow, workflowHash, waivers, practice, root, words: this.store.ledger(flowId).words ?? [], schemas: schemasOf(this.vocabulary()) });
    for (const c of conditions) {
      const s = res.statuses[c.id];
      this.store.recordResult({ flowId, conditionId: c.id, conditionVersion: c.version, workflowHash, status: s.status, reason: s.reason ?? null,
        body: { thin: s.thin ?? false, decided: s.decided, violated: s.violated, notActedOn: s.notActedOn, evidence: s.evidence, flags: s.flags ?? [], gate: s.gate, check: s.check, question: s.question ?? null, questions: s.questions ?? [], why: s.why ?? null } });
    }
    return { flowId, workflowHash, ledgerVersion: this.store.ledger(flowId).version, run: res.run, tally: res.tally, conditions: this.view({ flowId, workflowHash }).conditions };
  }

  /**
   * Statuses of every active condition on one LIVE run (./live.mjs view), recorded per run. Waivers apply as on practice data. The
   * real-shape gate sees only this run; G3 does not apply (one build). Returns the same shape as check().
   */
  checkLive({ flowId, workflowHash, runId, view }) {
    const conditions = this.store.conditions(flowId);
    const waivers = Object.fromEntries(conditions.map(c => [c.id, this.store.waiver(flowId, c.id, { workflowHash })]).filter(([, w]) => w));
    const statuses = judgeViews(conditions, [view], { workflowHash, waivers, words: this.store.ledger(flowId).words ?? [], schemas: schemasOf(this.vocabulary()) });
    for (const c of conditions) {
      const s = statuses[c.id];
      this.store.recordLiveResult({ flowId, conditionId: c.id, conditionVersion: c.version, workflowHash, runId, status: s.status, reason: s.reason ?? null,
        body: { decided: s.decided, violated: s.violated, evidence: s.evidence, flags: s.flags ?? [], check: s.check, questions: s.questions ?? [], why: s.why ?? null } });
    }
    return { flowId, workflowHash, runId, live: true, tally: tally(Object.values(statuses)),
      conditions: conditions.map(c => ({ id: c.id, version: c.version, quote: c.quote, status: statuses[c.id].status, reason: statuses[c.id].reason ?? null,
        evidence: (statuses[c.id].evidence ?? []).slice(0, 3), questions: statuses[c.id].questions ?? [] })) };
  }

  /** What the person sees: each condition, its quote, its check in plain words, and its latest status for this workflow hash. */
  view({ flowId, workflowHash = null }) {
    const conditions = this.store.conditions(flowId).map(c => {
      const r = workflowHash ? this.store.result(flowId, c.id, c.version, workflowHash) : null;
      const w = workflowHash ? this.store.waiver(flowId, c.id, { workflowHash }) : null;
      const status = w ? { status: 'waived', why: w.why, by: w.by } : r ? r : statusOf(c);
      const live = this.store.latestLive(flowId, c.id, c.version, workflowHash);
      return { id: c.id, version: c.version, quote: c.quote, summary: c.summary, kind: c.kind, origin: c.origin, confirmed: c.confirmed, verification: c.verification,
        why: c.why ?? null, question: c.missing?.[0] ?? status.question ?? null, questions: status.questions ?? [], check: c.check ? renderCheck(c.check) : null, status: status.status, reason: status.reason ?? null,
        evidence: (status.evidence ?? []).slice(0, 3), thin: !!status.thin, waived: w ? { why: w.why, by: w.by, at: w.at } : null,
        lastLive: live ? { runId: live.runId, status: live.status, reason: live.reason, at: live.at, evidence: (live.evidence ?? []).slice(0, 2) } : null };
    });
    return { flowId, ledgerVersion: this.store.ledger(flowId).version, words: this.store.ledger(flowId).words, conditions, pending: this.store.pending(flowId), tally: tally(conditions) };
  }
}
const withoutMeta = ({ id, version, state, confirmed, ...rest }) => rest;
/** Sheet columns from a vocabulary (./vocab.mjs): { <sheet>: [column] } for semantics R-objects+. */
export const schemasOf = vocab => Object.fromEntries(Object.entries(vocab?.sources ?? {}).map(([name, s]) => [name, Object.keys(s.columns ?? {})]));
export { crossBuild, captureRule, wordsOf, appVocabulary, practiceWorkspace };
