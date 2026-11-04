// A setting is plain text (security review 2026-10-21, L8). Control characters and Unicode line, paragraph and direction marks are
// refused in every text setting, including the fields of a list entry; line breaks and tabs only in a longer text (a canned reply,
// slot type "text"). A one-line setting with a line break could otherwise draw lines of its own into the dialog or a card ("Practice
// run ... passed 9 of 9"), and a direction mark could make a line read differently from what it holds.
//
// Fix round 2026-10-21 (review:honesty new defect 7): this check lived in app/core/library.mjs, which the BUILDER-1 manifest freezes. It
// is applied here instead, at both doors a setting comes in by: the form builder (app/onboarding/form-builder.mjs: the site's form and a
// coding agent's settings) before the library reads them, and FoundryApp.propose (app/core/service.mjs) on every built workflow's
// settings, whichever builder made it (a model builder's output included).
export const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const STRINGY = new Set(['string', 'text', 'email', 'channel']);

/** A text value as kept: Windows line ends in a longer text become \n (the rest of the checks then see one kind of line break). */
export const normalised = (type, v) => (type === 'text' && typeof v === 'string' ? v.replace(/\r\n/g, '\n') : v);

/** The problem with one value of a text slot (or field), or null. */
export function plainProblem(name, type, value) {
  if (!STRINGY.has(type) || typeof value !== 'string') return null;
  const v = normalised(type, value);
  if (CONTROL.test(v) || (type !== 'text' && /[\t\n]/.test(v))) return `${name} must be ${type === 'text' ? 'plain text' : 'one line of plain text'} (no control characters${type === 'text' ? '' : ' or line breaks'})`;
  return null;
}

/** Every problem in a set of settings for `template` (slot name -> value; a list slot's rows checked field by field). */
export function plainTextProblems(template, settings) {
  const out = [];
  if (!settings || typeof settings !== 'object') return out;
  for (const slot of template?.slots ?? []) {
    const v = settings[slot.name];
    if (v === undefined || v === null) continue;
    if (slot.type === 'list' && Array.isArray(v)) {
      v.forEach((row, i) => { for (const f of slot.fields ?? []) { const p = plainProblem(`${slot.name}[${i}].${f.name}`, f.type, row?.[f.name]); if (p) out.push(p); } });
    } else { const p = plainProblem(slot.name, slot.type, v); if (p) out.push(p); }
  }
  return out;
}

/** The same settings with every longer text's Windows line ends made \n (lists field by field). */
export function normaliseSettings(template, settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return settings;
  const out = { ...settings };
  for (const slot of template?.slots ?? []) {
    if (!Object.hasOwn(out, slot.name)) continue;
    const v = out[slot.name];
    if (slot.type === 'list' && Array.isArray(v)) out[slot.name] = v.map(row => row && typeof row === 'object' ? Object.fromEntries(Object.entries(row).map(([k, x]) => [k, normalised(slot.fields?.find(f => f.name === k)?.type, x)])) : row);
    else out[slot.name] = normalised(slot.type, v);
  }
  return out;
}
