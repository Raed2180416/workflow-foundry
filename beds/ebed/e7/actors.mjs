// E7 actors (BED-CONTRACT v1.1 §4.4; DESIGN.md §5): the assignment groups' resolvers and the callers (counterparties),
// and the incident managers (human tasks). Policies are keyed by (world, truth case, assignment, notice template) or by
// (world, truth case, role, kind, ordinal), never by request text; every instant comes from the world's truth timeline
// (world anchors, DESIGN §4.9), never from the arm's commit time, so every arm acting inside its windows meets the same
// timeline.
//
// Resolvers react to a committed `itsm.assign` whose (group, at) is the incident's true assignment k: the steps of that
// assignment (accept, hold, resume, reclassify, reassign, resolve) as guarded counterparty steps (host H-29) on the
// incident's `state`, each a `resolver.update` quoting the arm's `ref` (routed to the instance that placed it, H-25). A
// wrong group or instant gets silence (the case has already diverged). Go-live incidents' updates are world arrivals.
// Callers react to the arm's `awaiting-caller` and `resolved` notices sent to them: a reply or confirmation at its
// planned instant, or nothing. Caller messages never quote a ref (SPEC §1: they start new instances). Incident managers
// answer `majorIncidentApproval` tasks by the case's approval plan; noise is the host's (world.noise, d3+).
import { rng } from '../../lib/rng.mjs';
import { msOf } from './world.mjs';

const sameInstant = (a, b) => typeof a === 'string' && typeof b === 'string' && Number.isFinite(msOf(a)) && msOf(a) === msOf(b);
const norm = s => String(s ?? '').trim().toLowerCase();

function counterparty(world, ctx) {
  const t = world.truth.cases[ctx.case];
  if (!t || t.subject === null || t.backlog) return null;
  const { system, op, args } = ctx.effect;
  if (system === 'itsm' && op === 'assign') {
    if (args?.number !== t.subject) return null;
    const asg = t.assignments.find(a => a.group === args.group && sameInstant(args.at, a.at));
    if (!asg) return null;
    const steps = t.steps.filter(s => s.k === asg.k).map(s => ({
      at: s.at,
      guard: { system: 'itsm', table: 'incidents', pk: t.subject, field: 'state', in: s.guard },
      event: { type: 'resolver.update', source: 'workspace', quoteRef: true, payload: { ...s.payload } },
    }));
    return steps.length ? { steps } : null;
  }
  if (system === 'notify' && op === 'send') {
    if (args?.about !== t.subject || !t.email || norm(args.to) !== norm(t.email)) return null;
    const m = args.template === 'awaiting-caller' ? t.caller?.reply : args.template === 'resolved' ? t.caller?.confirm : null;
    if (!m || m.via !== args.template) return null;
    return { steps: [{ at: m.at, event: { type: 'caller.message', source: 'mail', payload: { ...m.payload } } }] };
  }
  return null;
}

function answer(world, ctx) {
  if (ctx.kind !== 'majorIncidentApproval') return null;
  const t = world.truth.cases[ctx.case];
  if (!t || t.subject === null) return null;
  const plan = t.approval ?? { decision: 'approve', delay: null };
  const r = rng('ebed/e7/manager', world.id, ctx.case, ctx.ordinal);
  const text = d => `${d} - ${d === 'approve' ? 'declare it a major incident' : 'handle it as a normal P1'}`;
  if (ctx.ordinal > 1) {
    // A re-ask after an unusable, withdrawn or rejected answer: the deadline does not move (R7.2).
    const decision = plan.decision ?? 'approve';
    return { value: { decision }, delayMinutes: r.int(3, 12), text: text(decision) };
  }
  if (plan.none) return null;                                     // silent: the task times out
  if (plan.late !== undefined) return { value: { decision: plan.decision }, delayMinutes: plan.late, text: text(plan.decision) };        // 45+ min: after the deadline
  return { value: { decision: plan.decision }, delayMinutes: plan.delay ?? r.int(5, 15), text: text(plan.decision) };
}

export const actors = Object.freeze({ answer, counterparty });
