// "Does this need a workflow at all?" for the product surface (app/ and both MCP servers): the ROUTER-1 need router
// (./router.mjs) with a plain-words reply. Code only by default: $0, no network, well under a millisecond per request.
// A judge for the close-call band is optional and must be passed in by the host (a ModelPort-backed judge from
// ./router.mjs modelJudge); nothing here reads a key or picks a model.
import { needCheck, needDecide, DEFAULT_SENSITIVITY } from './router.mjs';

const SAY = {
  none: 'No workflow needed: just do it directly.',
  checklist: 'No workflow needed, but it has an irreversible effect: write a short plan and check the result before and after.',
  workflow: 'This needs a workflow: it has steps that must be checked, waited on or applied to many items.',
  recurring: 'This needs a recurring workflow: it repeats on a schedule or trigger.'
};

/** The router's decision trimmed for people and agents. `context` hints (recurrence, systems, volume, irreversible...) only raise need. */
export async function needAdvice({ request, sensitivity = DEFAULT_SENSITIVITY, context = {}, judge = null } = {}) {
  const card = judge ? await needDecide(request, { sensitivity, context, judge }) : needCheck(request, { sensitivity, context });
  const reasons = card.primitives.slice(0, 4).map(p => ({ signal: p.name, strength: Math.round(p.score * 100) / 100, words: p.cues.slice(0, 2).map(c => c.match) }));
  const against = card.dampeners.slice(0, 3).map(d => ({ signal: d.name, strength: Math.round(d.score * 100) / 100 }));
  return {
    ok: true, needsWorkflow: card.needsWorkflow, mode: card.mode, probability: card.p, threshold: card.threshold, sensitivity: card.sensitivity,
    closeCall: card.band === 'middle', decidedBy: card.decidedBy, why: card.why, reasons, against,
    say: `${SAY[card.mode]}${card.band === 'middle' ? ' (A close call.)' : ''}`,
    router: card.router, ...(card.judge ? { judge: card.judge } : {})
  };
}

const contextSchema = { type: 'object', additionalProperties: false, description: 'Optional facts that only raise need: a known schedule, the systems or people involved, how many items, whether an effect cannot be undone.',
  properties: { recurrence: { type: 'string', maxLength: 60 }, waits: { type: 'boolean' }, systems: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 60 } },
    parties: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 60 } }, volume: { type: 'integer', minimum: 0 }, irreversible: { type: 'boolean' }, audit: { type: 'boolean' }, rules: { type: 'boolean' }, reuse: { type: 'boolean' } } };

/** One tool spec, shared by the app MCP server (need_check) and the engine MCP server (foundry_need_check). */
export function needToolSpec(name = 'need_check') {
  return {
    name,
    description: 'Before building anything, check whether a request needs a workflow at all: none (just do it), checklist (one sitting, irreversible effect), workflow, or recurring workflow. Code only, free, instant. sensitivity 0..1 is the user\'s slider (0.5 default: tuned so requests that do not need a workflow do not trigger one; 1 always triggers, 0 never). Pass the person\'s exact words in request.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['request'],
      properties: { request: { type: 'string', minLength: 1, maxLength: 30000 }, sensitivity: { type: 'number', minimum: 0, maximum: 1 }, context: contextSchema } }
  };
}
