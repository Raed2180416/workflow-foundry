// Static, accessible HTML for a compiled form spec. No script, no external asset, no inline style attribute, no URL:
// one hashed <style> block and a strict CSP. Every string from the workflow or a person is escaped; workflow text is
// also passed through displayText (hidden and bidi characters become visible markers).
//
// Accessibility pattern (GOV.UK Design System style, written from its public guidance, no code copied):
//   - one <h1>: the question; for a single-answer form it is the field's <label> or the group's <legend>;
//   - every control has a <label for>; radio and checkbox groups are <fieldset> + <legend>; nested objects are
//     <fieldset class="group">;
//   - hints and errors are linked with aria-describedby; an invalid control has aria-invalid="true";
//   - after a rejected submission an error summary (role="alert", autofocus) lists every error, each linking to its
//     control, and the title starts with "Error: ";
//   - the form is novalidate: the host is the only validator (README "Why the browser does not validate").
//     Constraint attributes that differ from JSON Schema are left out: maxlength counts UTF-16 units (JSON Schema
//     counts code points), pattern uses the v flag and is anchored, type=number drops "12abc" to "" before
//     submission. Limits are stated in the hint text instead.
import { createHash } from 'node:crypto';
import { displayText, escapeHtml } from './common.mjs';

export const FORM_CSS = [
  ':root{color-scheme:light dark;--fg:#0b0c0c;--bg:#fff;--muted:#484949;--err:#a8190f;--line:#0b0c0c;--focus:#ffdd00;--chip:#f3f2f1}',
  '@media (prefers-color-scheme:dark){:root{--fg:#f3f2f1;--bg:#0b0c0c;--muted:#c8c8c8;--err:#ff9c94;--line:#f3f2f1;--chip:#262626}}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:var(--bg);color:var(--fg);font:1rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  'main{max-width:42rem;margin:0 auto;padding:1rem}',
  'h1{font-size:1.5rem;line-height:1.3;margin:0 0 .75rem;white-space:pre-line;overflow-wrap:anywhere}',
  'h1 label{font-weight:inherit}',
  'h2{font-size:1.2rem;margin:0 0 .5rem}',
  '.trust{display:inline-block;margin:0 0 1.25rem;padding:.1rem .5rem;background:var(--chip);color:var(--muted);font-size:.875rem}',
  '.field{margin:0 0 1.5rem;padding:0;border:0;min-width:0}',
  'fieldset{margin:0 0 1.5rem;padding:0;border:0;min-width:0}',
  'fieldset.group{border-left:4px solid var(--muted);padding-left:.75rem}',
  'legend{padding:0;font-weight:700;overflow-wrap:anywhere;white-space:pre-line}',
  'legend.q{font-weight:400}',
  'label{display:block;font-weight:700;overflow-wrap:anywhere;white-space:pre-line}',
  '.option label{display:inline;font-weight:400}',
  '.req{font-weight:400;color:var(--muted)}',
  '.hint{margin:.25rem 0 .5rem;color:var(--muted);white-space:pre-line;overflow-wrap:anywhere}',
  '.error-message{margin:.25rem 0 .5rem;color:var(--err);font-weight:700;overflow-wrap:anywhere}',
  '.field-error{border-left:4px solid var(--err);padding-left:.75rem}',
  'input[type=text],textarea,select{display:block;width:100%;max-width:100%;font:inherit;color:var(--fg);background:var(--bg);border:2px solid var(--line);border-radius:0;padding:.4rem}',
  'textarea{min-height:6rem;resize:vertical}',
  '.field-error input[type=text],.field-error textarea,.field-error select{border-color:var(--err)}',
  '.option{display:flex;gap:.5rem;align-items:flex-start;margin:.35rem 0}',
  '.option input{width:1.5rem;height:1.5rem;margin:0;flex:none;accent-color:var(--fg)}',
  'button{font:inherit;font-weight:700;padding:.6rem 1.2rem;color:#fff;background:#00703c;border:2px solid transparent;border-radius:0;box-shadow:0 2px 0 #002d18;cursor:pointer}',
  ':focus-visible{outline:3px solid var(--focus);outline-offset:0;box-shadow:0 0 0 6px var(--fg)}',
  'button:focus-visible{background:var(--focus);color:#0b0c0c;box-shadow:0 2px 0 #0b0c0c}',
  '.error-summary{border:4px solid var(--err);padding:1rem;margin:0 0 1.5rem}',
  '.error-summary:focus{outline:3px solid var(--focus)}',
  '.error-summary ul{margin:0;padding-left:1.25rem}',
  '.error-summary a{color:var(--err);font-weight:700;overflow-wrap:anywhere}',
  'pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--chip);padding:.75rem}',
  '.vh{position:absolute!important;width:1px!important;height:1px!important;margin:0!important;padding:0!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;clip-path:inset(50%)!important;border:0!important;white-space:nowrap!important}',
  '@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}',
].join('\n');

export const FORM_STYLE_HASH = `sha256-${createHash('sha256').update(FORM_CSS).digest('base64')}`;
// The meta policy. frame-ancestors is not allowed in a meta policy (Chromium logs an error), so it is only in the header.
export const FORM_CSP = `default-src 'none'; style-src '${FORM_STYLE_HASH}'; img-src 'none'; script-src 'none'; connect-src 'none'; form-action 'self'; base-uri 'none'`;
export const FORM_CSP_HEADER = `${FORM_CSP}; frame-ancestors 'none'`;
/** Response headers a host should send with a rendered form. */
export const FORM_HEADERS = Object.freeze({
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': FORM_CSP_HEADER,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
});

const t = value => escapeHtml(displayText(value)); // workflow text
const v = value => escapeHtml(value); // a person's own input, echoed back
const attrs = pairs => pairs.filter(([, value]) => value !== undefined && value !== false && value !== null)
  .map(([name, value]) => value === true ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`).join('');

// Constraint text shown in the hint (the browser enforces none of it; the host does).
export function ruleText(field) {
  const c = field.constraints, n = x => String(x);
  switch (field.valueType) {
    case 'string': {
      const parts = [];
      if (c.minLength !== undefined && c.maxLength !== undefined) parts.push(c.minLength === c.maxLength ? `Use exactly ${n(c.minLength)} characters.` : `Use ${n(c.minLength)} to ${n(c.maxLength)} characters.`);
      else if (c.maxLength !== undefined) parts.push(`Use at most ${n(c.maxLength)} characters.`);
      else if (c.minLength !== undefined && c.minLength > 0) parts.push(`Use at least ${n(c.minLength)} characters.`);
      if (c.pattern !== undefined) parts.push(`Format: ${c.pattern}`);
      return parts.join(' ');
    }
    case 'number': case 'integer': {
      const what = field.valueType === 'integer' ? 'a whole number' : 'a number';
      if (c.minimum !== undefined && c.maximum !== undefined) return `Enter ${what} from ${n(c.minimum)} to ${n(c.maximum)}.`;
      if (c.minimum !== undefined) return `Enter ${what} of at least ${n(c.minimum)}.`;
      if (c.maximum !== undefined) return `Enter ${what} of at most ${n(c.maximum)}.`;
      return `Enter ${what}.`;
    }
    case 'enum-array': {
      const lo = c.minItems ?? 0, hi = c.maxItems;
      if (hi !== undefined && lo > 0) return lo === hi ? `Select ${n(lo)}.` : `Select ${n(lo)} to ${n(hi)}.`;
      if (hi !== undefined) return `Select up to ${n(hi)}.`;
      if (lo > 0) return `Select at least ${n(lo)}.`;
      return 'Select all that apply.';
    }
    default: return '';
  }
}

function fieldHtml(spec, field, { values, errorsByField, single }) {
  const error = errorsByField.get(field.name)?.[0];
  const rules = ruleText(field), description = field.description;
  const hintId = description || rules ? `${field.id}-hint` : undefined, errorId = error ? `${field.id}-error` : undefined;
  const described = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  // A required field inside an optional group is required only when the group is answered.
  const group = field.group ? spec.groups.find(g => g.id === field.group) : null;
  const marker = single ? '' : ` <span class="req">${!field.required ? '(optional)' : group && !group.required ? '(required with this group)' : '(required)'}</span>`;
  const labelText = single ? t(spec.question) : t(field.label);
  const hint = hintId ? `<p class="hint" id="${hintId}">${[description ? t(description) : '', rules ? t(rules) : ''].filter(Boolean).join('\n')}</p>\n` : '';
  const err = error ? `<p class="error-message" id="${errorId}"><span class="vh">Error: </span>${t(error.message)}</p>\n` : '';
  const raw = values?.[field.name];
  const cls = `field${error ? ' field-error' : ''}`;
  const required = single || (field.required && (!group || group.required));

  if (field.componentType === 'Input' || field.componentType === 'TextArea' || field.componentType === 'Select') {
    const label = single ? `<h1><label for="${field.id}">${labelText}</label></h1>\n` : `<label for="${field.id}">${labelText}${marker}</label>\n`;
    let control;
    const common = [['id', field.id], ['name', field.name], ['aria-describedby', described], ['aria-invalid', error ? 'true' : undefined], ['required', required]];
    if (field.componentType === 'Input') {
      const numeric = field.valueType === 'number' || field.valueType === 'integer';
      control = `<input${attrs([...common.slice(0, 2), ['type', 'text'], ['inputmode', numeric ? field.inputMode : undefined], ['autocomplete', 'off'], ['spellcheck', numeric ? 'false' : undefined], ...common.slice(2), ['value', typeof raw === 'string' ? raw : '']])}>`;
    } else if (field.componentType === 'TextArea') {
      // The newline after the start tag keeps a leading newline of the value (the HTML parser drops the first one).
      control = `<textarea${attrs([...common, ['rows', '5'], ['spellcheck', 'true']])}>\n${typeof raw === 'string' ? v(raw) : ''}</textarea>`;
    } else {
      const selected = typeof raw === 'string' ? raw : '';
      const options = [`<option value=""${selected === '' ? ' selected' : ''}>Choose an option</option>`,
        ...field.options.map(o => `<option value="${escapeHtml(o.token)}"${selected === o.token ? ' selected' : ''}>${t(o.label)}</option>`)];
      control = `<select${attrs(common)}>\n${options.join('\n')}\n</select>`;
    }
    return `<div class="${cls}" id="${field.id}-field">\n${label}${hint}${err}${control}\n</div>\n`;
  }
  // RadioGroup / CheckBoxGroup
  const multiple = field.componentType === 'CheckBoxGroup';
  const checked = multiple ? new Set(Array.isArray(raw) ? raw : []) : new Set(typeof raw === 'string' ? [raw] : []);
  const legend = single ? `<legend class="q"><h1>${labelText}</h1></legend>\n` : `<legend>${labelText}${marker}</legend>\n`;
  const options = field.options.map((o, j) => {
    const id = `${field.id}-o${j}`;
    return `<div class="option"><input${attrs([['type', multiple ? 'checkbox' : 'radio'], ['id', id], ['name', field.name], ['value', o.token], ['required', !multiple && required], ['checked', checked.has(o.token)]])}><label for="${id}">${t(o.label)}</label></div>`;
  });
  return `<fieldset${attrs([['class', cls], ['id', `${field.id}-field`], ['aria-describedby', described]])}>\n${legend}${hint}${err}${options.join('\n')}\n</fieldset>\n`;
}

/** The anchor an error summary entry links to: the control itself, or the first option of a group. */
export const errorTarget = field => field.componentType === 'RadioGroup' || field.componentType === 'CheckBoxGroup' ? `${field.id}-o0` : field.id;

function page({ title, body, lang }) {
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(FORM_CSP)}">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<style>${FORM_CSS}</style>
</head>
<body>
${body}</body>
</html>
`;
}

const titleText = question => t(Array.from(displayText(question).replace(/\s+/g, ' ').trim()).slice(0, 120).join(''));

/**
 * Renders the form. options: action (a relative URL; default "" posts back to the page), token (a hidden per-task
 * token the host checks), values (raw values to echo after a rejected submission: field name -> string or token
 * list), errors (OpenUI-shaped errors from acceptSubmission), lang (default "en").
 */
export function renderForm(spec, { action = '', token = null, values = null, errors = [], lang = 'en' } = {}) {
  // Browsers strip leading and trailing spaces and C0 controls from a URL, so " //evil.example" would be
  // protocol-relative: surrounding whitespace is refused too.
  if (typeof action !== 'string' || /^[a-z][a-z0-9+.-]*:|^\/\/|\\|[\u0000-\u001F\u007F]|^\s|\s$/i.test(action)) throw new TypeError('action must be a relative URL (no scheme, no //, no backslash, no control characters, no surrounding whitespace)');
  const fieldsByName = new Map(spec.fields.map(f => [f.name, f]));
  const errorsByField = new Map();
  for (const e of errors) if (e.statementId && fieldsByName.has(e.statementId)) errorsByField.set(e.statementId, [...(errorsByField.get(e.statementId) ?? []), e]);
  const single = spec.rootKind === 'leaf';
  let body = '<main id="main">\n';
  if (errors.length) {
    const items = errors.map(e => {
      const field = e.statementId ? fieldsByName.get(e.statementId) : null;
      return field ? `<li><a href="#${errorTarget(field)}">${t(e.message)}</a></li>` : `<li>${t(e.message)}</li>`;
    });
    body += `<div class="error-summary" role="alert" aria-labelledby="error-summary-title" tabindex="-1" autofocus>\n<h2 id="error-summary-title">There is a problem</h2>\n<ul>\n${items.join('\n')}\n</ul>\n</div>\n`;
  }
  body += `<form method="post" action="${escapeHtml(action)}" novalidate accept-charset="utf-8">\n`;
  body += `<input type="hidden" name="_spec" value="${escapeHtml(spec.specHash)}">\n`;
  if (token !== null) body += `<input type="hidden" name="_token" value="${escapeHtml(token)}">\n`;
  body += '<p class="trust">Question and field text come from the workflow and are shown as written.</p>\n';
  if (!single) body += `<h1 id="question">${t(spec.question)}</h1>\n`;
  if (single) body += fieldHtml(spec, spec.fields[0], { values, errorsByField, single: true });
  else {
    let open = null;
    for (const field of spec.fields) {
      if (field.group !== open) {
        if (open) body += '</fieldset>\n';
        open = field.group;
        if (open) {
          const g = spec.groups.find(x => x.id === open);
          const hint = g.description ? `<p class="hint" id="${g.id}-hint">${t(g.description)}</p>\n` : '';
          body += `<fieldset${attrs([['class', 'group'], ['id', g.id], ['aria-describedby', g.description ? `${g.id}-hint` : undefined]])}>\n<legend>${t(g.label)} <span class="req">${g.required ? '(required)' : '(optional)'}</span></legend>\n${hint}`;
        }
      }
      body += fieldHtml(spec, field, { values, errorsByField, single: false });
    }
    if (open) body += '</fieldset>\n';
  }
  body += '<button type="submit">Submit answer</button>\n</form>\n</main>\n';
  return page({ title: `${errors.length ? 'Error: ' : ''}${titleText(spec.question)}`, body, lang });
}

/** A confirmation page after the host accepted an answer: the typed answer as text. */
export function renderAccepted(spec, answer, { lang = 'en' } = {}) {
  const body = `<main id="main">\n<h1>Answer recorded</h1>\n<p>${t(spec.question)}</p>\n<pre id="answer">${v(JSON.stringify(answer, null, 2))}</pre>\n</main>\n`;
  return page({ title: 'Answer recorded', body, lang });
}
