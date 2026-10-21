// Card wording revisions (app/onboarding/card-text.json): applied by the site's form builder to the workflow it instantiates from a
// frozen template, and to the card's "It will / It won't" promises. Words only: a revision never changes a step, a check, a capability,
// a state key or a stage value (the tests in app/onboarding/test/card-text.test.mjs hold every revision to that).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as templatePromises } from '../core/library.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CARD_TEXT = JSON.parse(readFileSync(path.join(here, 'card-text.json'), 'utf8'));
export const CARD_TEXT_REVISION = CARD_TEXT.revision;

// [[slot]] and the template's derived *Text values, and {if} entries, resolved by the library's own promises() (one interpolation rule).
const list = (template, values, entries) => templatePromises({ ...template, willDo: entries ?? [], willNotDo: [] }, values).willDo;
const one = (template, values, text) => list(template, values, [text])[0];

/** The pairs that apply to this card and these values: [{ from, to, re }] (interpolated). */
export function revisionsFor(template, values) {
  const spec = CARD_TEXT.templates[template.id] ?? {};
  const pairs = [...(CARD_TEXT.all.replace ?? []), ...(spec.replace ?? []), ...Object.entries(spec.replaceIf ?? {}).filter(([slot]) => values?.[slot]).flatMap(([, p]) => p)]
    .map(([from, to]) => ({ from: one(template, values, from), to: one(template, values, to) }));
  const res = (spec.replaceRe ?? []).map(([re, to]) => ({ re: new RegExp(re), to }));
  return { strip: CARD_TEXT.all.strip ?? [], pairs, res, successCriteria: spec.successCriteria ? list(template, values, spec.successCriteria) : null };
}

/** Revise a freshly instantiated workflow in place (its metadata is left alone). Returns { workflow, matched: Set of `from` texts that matched }. */
export function applyCardText(template, workflow, values) {
  const r = revisionsFor(template, values), matched = new Set();
  const fix = s => {
    let out = s;
    for (const x of r.strip) out = out.split(x).join('');
    for (const p of r.pairs) if (out.includes(p.from)) { out = out.split(p.from).join(p.to); matched.add(p.from); }
    for (const p of r.res) if (p.re.test(out)) { out = out.replace(p.re, p.to); matched.add(String(p.re)); }
    return out;
  };
  const walk = v => typeof v === 'string' ? fix(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
  for (const key of Object.keys(workflow)) if (key !== 'metadata' && key !== 'id') workflow[key] = walk(workflow[key]);
  if (r.successCriteria) workflow.envelope.successCriteria = r.successCriteria;
  if (workflow.metadata) workflow.metadata.sources = [...(workflow.metadata.sources ?? []), `app/onboarding/card-text.json ${CARD_TEXT_REVISION}`];
  return { workflow, matched };
}

/** "It will" and "It won't" for a card and its values: the revised wording when the card has it, else the template's own. */
export function cardPromises(template, values) {
  const spec = CARD_TEXT.templates[template.id];
  if (!spec?.willDo) return templatePromises(template, values);
  return { willDo: list(template, values, spec.willDo), willNotDo: list(template, values, spec.willNotDo) };
}
