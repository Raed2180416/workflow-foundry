// The template form builder: fills one frontier-written template (app/core/templates/*.json) from a form or from the settings a
// person's coding agent passes, with NO model ($0). It sits behind the same contract as the stub and the model builder
// (status ready | needs_answers | build_failed | unsupported), so FoundryApp, the MCP tools and the approval path are unchanged.
//
// What it guarantees (research/onboarding-20261021/SPEC.md §3 R3, §12.2):
//   - Every slot goes through the library's own resolution (typing, ranges, constraints, the question policy, visible defaults).
//   - Grounding: an address or channel counts as given only if the person wrote it. On the site form the person typed every value,
//     so the form's values are the person's words. On the agent path (origin 'agent') the person's words are the request and the
//     answers only, never the settings the agent filled: an address the agent invented becomes the template's own question.
//   - An optional policy hook (app/onboarding/proposal-check.mjs) prefills values a rule owner set and refuses a widening.
import { FoundryError } from '../../src/data.mjs';
import { loadLibrary, templateById, catalog, resolveSlots, instantiate, practiceOf } from '../core/library.mjs';
import { validateStrict } from '../core/practice.mjs';
import { applyCardText, cardPromises } from './card-text.mjs';
import { plainTextProblems, normaliseSettings } from '../core/plain-text.mjs';

// /2: the card's wording revisions (app/onboarding/card-text.json) are applied to what it builds; the template stays the authority for
// every step, check and capability.
export const FORM_BUILDER_ID = 'template-form/2 (no model; card text r2; the person or their agent filled the settings)';
export const ORIGINS = Object.freeze(['site-form', 'agent']);
const SCALAR = v => ['string', 'number', 'boolean'].includes(typeof v);

/** The strings a value contributes to "what the person wrote" (numbers as written, list rows field by field). */
function words(value) {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' && Number.isFinite(value)) return [String(value)];
  if (Array.isArray(value)) return value.flatMap(words);
  if (value && typeof value === 'object') return Object.values(value).flatMap(words);
  return [];
}

/** Check the shape of a settings object before anything reads it: scalars, or lists of flat objects of scalars. */
export function settingsProblems(template, settings) {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) return ['settings is an object of slot name to value'];
  const names = new Set(template.slots.map(s => s.name)), out = [];
  for (const [k, v] of Object.entries(settings)) {
    if (!names.has(k)) { out.push(`${template.id} has no setting named ${k.slice(0, 60)}`); continue; }
    const slot = template.slots.find(s => s.name === k);
    if (slot.type === 'list') {
      if (!Array.isArray(v) || v.length > 50 || !v.every(row => row && typeof row === 'object' && !Array.isArray(row) && Object.values(row).every(SCALAR))) out.push(`${k} is a list of rows`);
    } else if (!SCALAR(v)) out.push(`${k} must be text, a number or yes/no`);
  }
  // L8: plain text only (app/core/plain-text.mjs; the frozen library no longer carries this check).
  return out.length ? out : plainTextProblems(template, settings);
}

export class TemplateFormBuilder {
  /** library: the template list; policy: optional (templateId, settings) -> { prefill: {slot: value}, refusals: [{slot, message}], answered: [{slot, by}] }. */
  constructor({ library = loadLibrary(), policy = null } = {}) {
    this.library = library; this.policy = policy;
    this.id = FORM_BUILDER_ID; this.async = false;
  }

  build({ template, settings: given = {}, answers = {}, base = null, origin = 'site-form', request = null } = {}) {
    if (!ORIGINS.includes(origin)) throw new FoundryError('BUILDER_ORIGIN', `origin is one of ${ORIGINS.join(', ')}`);
    if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) throw new FoundryError('ANSWERS', 'answers is an object of question id to text');
    const t = typeof template === 'string' ? templateById(template, this.library) : null;
    if (!t) return { status: 'unsupported', builder: this.id, supported: catalog(this.library).map(c => ({ id: c.id, title: c.title })),
      reply: `There is no example called ${String(template ?? '').slice(0, 60) || '(none)'}. Nothing was created. To build something else, use construction_guide and pass the workflow to propose_flow.` };
    if (base?.template && base.template !== t.id) return { status: 'build_failed', builder: this.id, template: t.id,
      reply: `This automation was made from the "${base.template}" card, not "${t.id}". Start a new automation instead. Nothing was changed.`, problems: ['template differs from the existing automation'] };
    const settings = normaliseSettings(t, given);
    const shape = settingsProblems(t, settings ?? {});
    if (shape.length) return { status: 'build_failed', builder: this.id, template: t.id, problems: shape, reply: `Some settings are not usable: ${shape.join('; ')}. Nothing was created.` };

    // A rule owner's bound (the authority map) may answer a setting or refuse a widening before anything is built.
    const checked = this.policy ? this.policy(t.id, { ...(settings ?? {}) }) : { prefill: {}, refusals: [], answered: [] };
    if (checked.refusals?.length) return { status: 'build_failed', builder: this.id, template: t.id, refusals: checked.refusals, problems: checked.refusals.map(r => r.message),
      reply: checked.refusals.map(r => r.message).join(' ') };

    // Answers to the template's own questions are keyed by slot name; they fill that slot.
    const answered = Object.fromEntries(Object.entries(answers).filter(([k, v]) => typeof v === 'string' && v.trim() && t.slots.some(s => s.name === k && s.type !== 'list')).map(([k, v]) => [k, v.trim()]));
    const slots = { ...(settings ?? {}), ...(checked.prefill ?? {}), ...answered };
    // An address for a part that is off by default ("summary to me@...") means that part is wanted: the toggle follows, so the
    // address is grounded or asked like any other, never silently dropped (found by the P1 journeys: an agent's guessed summary
    // address was dropped together with the summary, and the person's own "summary to me" lost the summary).
    for (const s of t.slots) if (s.askWhen && !Object.hasOwn(slots, s.askWhen) && typeof slots[s.name] === 'string' && slots[s.name].trim()) slots[s.askWhen] = true;
    const fill = { slots, notStated: t.slots.map(s => s.name).filter(n => !Object.hasOwn(slots, n)), questions: [], assumptions: [] };
    // What the person wrote: on the form, every value they typed (and answers); on the agent path, their request and answers only.
    const personWrote = origin === 'site-form'
      ? [...words(settings ?? {}), ...words(checked.prefill ?? {}), ...Object.values(answered)]
      : [typeof request === 'string' ? request : '', ...Object.values(answered)];
    const r = resolveSlots(t, fill, { text: personWrote.join('\n'), base: base?.slots ?? null });
    const understood = { template: t.id, slots: r.values, defaults: r.defaults, assumptions: [], notCovered: [], ungrounded: r.ungrounded, origin,
      setBy: checked.answered ?? [] };
    if (r.questions.length) {
      // Say why a value the agent filled was not used: the person never wrote it.
      const notWritten = r.ungrounded.map(u => ({ slot: u.slot, value: u.value, why: 'The person never wrote this address, so it was not used.' }));
      return { status: 'needs_answers', builder: this.id, template: t.id, questions: r.questions, understood, notWritten };
    }
    if (r.problems.length) return { status: 'build_failed', builder: this.id, template: t.id, understood, problems: r.problems,
      reply: `These settings do not fit together: ${r.problems.join('; ')}. Change them and try again. Nothing was created.` };
    const workflow = applyCardText(t, instantiate(t, r.values, { version: base ? base.version + 1 : 1, id: base?.id ?? null, builder: this.id }), r.values).workflow;
    const validation = validateStrict(workflow);
    if (!validation.valid) return { status: 'build_failed', builder: this.id, template: t.id, understood, problems: validation.errors.map(e => `${e.code}: ${e.message}`).slice(0, 6),
      reply: 'These settings make an automation that does not pass Foundry\'s own checks. Nothing was created.' };
    const { willDo, willNotDo } = cardPromises(t, r.values);
    return { status: 'ready', builder: this.id, template: t.id, workflow, understood, sampleInput: practiceOf(t).input, willDo, willNotDo,
      args: { template: t.id, settings, answers, origin, request } };
  }

  /** The same settings as a new version of an existing automation (no new questions). */
  rebase(built, base) {
    if (built.status !== 'ready') return built;
    const t = templateById(built.template, this.library);
    return { ...built, workflow: applyCardText(t, instantiate(t, built.understood.slots, { version: base.version + 1, id: base.id, builder: this.id }), built.understood.slots).workflow };
  }
}

/** The restatement shown on the make page while the person edits: what it will and will not do, the open questions, problems. */
export function restate({ template, settings = {}, library = loadLibrary(), policy = null }) {
  const t = templateById(template, library);
  if (!t) throw new FoundryError('NOT_FOUND', `No template named ${String(template).slice(0, 60)}`);
  const shape = settingsProblems(t, settings);
  if (shape.length) return { template: t.id, problems: shape, questions: [], willDo: [], willNotDo: [], defaults: [] };
  settings = normaliseSettings(t, settings);
  const checked = policy ? policy(t.id, { ...settings }) : { prefill: {}, refusals: [], answered: [] };
  const slots = { ...settings, ...(checked.prefill ?? {}) };
  const r = resolveSlots(t, { slots, notStated: t.slots.map(s => s.name).filter(n => !Object.hasOwn(slots, n)), questions: [], assumptions: [] }, { text: words(slots).join('\n') });
  const placeholder = s => s.type === 'email' ? 'the address you give' : s.type === 'channel' ? 'the channel you give' : ['number', 'integer'].includes(s.type) ? 'the amount you choose' : null;
  const shown = Object.fromEntries(t.slots.map(s => { const v = r.values[s.name] ?? s.default ?? null; return [s.name, v === null || v === '' ? placeholder(s) ?? v : v]; }));
  const { willDo, willNotDo } = cardPromises(t, shown);
  return { template: t.id, values: r.values, defaults: r.defaults, questions: r.questions, problems: [...(checked.refusals ?? []).map(x => x.message), ...r.problems],
    setBy: checked.answered ?? [], willDo, willNotDo };
}
