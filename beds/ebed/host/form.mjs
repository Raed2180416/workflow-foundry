// The form route of human answers (E-BED §2.7, §7; OPENUI.md §5.4; BED-CONTRACT-v1.1 §4.4). A declared share of actor
// answers is entered through a form compiled from the arm's `answerSchema` and arrives as OpenUI-shaped `formState`
// (`{ <field path>: { value, componentType } }`, OPENUI `spec/language.md:442–446` [doc]). The host adapter maps the
// form state to a typed answer by a STRICT parse and re-validates it against `answerSchema`: the form is untrusted,
// and an OpenUI-style client rule would accept "12abc" as numeric (parseFloat), so the host must not.
//
// This module is the host-side stand-in for the tier-0 form (E-BED §8.1 step 8 replaces `toFormState` with the real
// compiled form; the adapter `fromFormState` is the host part and stays). Field paths are dotted ("lines.0.qty");
// arrays are repeaters with a row-count entry ("lines.__rows"); a free-form object is one JSON text area.
//
// What a round trip preserves: every *dense* value (all declared properties present, no null, no empty string) comes
// back identical. A single text box cannot tell the rest apart, so the adapter reads an empty optional field as absent,
// an empty required nullable field as null, an unchecked box as false, and always builds declared groups.
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const types = s => (s.type === undefined ? [] : [].concat(s.type));
const INT = /^-?(0|[1-9]\d*)$/;
const NUM = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const ROWS = '__rows';

function componentOf(s) {
  if (s.enum) return 'Select';
  const t = types(s).filter(x => x !== 'null');
  if (t.length === 1 && t[0] === 'boolean') return 'Checkbox';
  if (t.length === 1 && (t[0] === 'integer' || t[0] === 'number')) return 'NumberInput';
  if (t.length === 1 && t[0] === 'string') return (s.maxLength ?? 0) > 200 ? 'TextArea' : 'TextInput';
  return 'JsonTextArea';                                // unions and free-form values: JSON text
}
const isGroup = s => types(s).length === 1 && types(s)[0] === 'object' && isObj(s.properties);
const isRepeater = s => types(s).length === 1 && types(s)[0] === 'array' && isObj(s.items);
const enumText = m => (typeof m === 'string' ? m : JSON.stringify(m));

/** The form state a user produces by entering `value` into the form compiled from `schema`. */
export function toFormState(schema, value) {
  const state = {};
  const walk = (s, v, p) => {
    if (isGroup(s)) { for (const [k, sub] of Object.entries(s.properties)) walk(sub, isObj(v) ? v[k] : undefined, p ? `${p}.${k}` : k); return; }
    if (isRepeater(s)) {
      const rows = Array.isArray(v) ? v : [];
      state[`${p}.${ROWS}`] = { value: String(rows.length), componentType: 'Repeater' };
      rows.forEach((x, i) => walk(s.items, x, `${p}.${i}`));
      return;
    }
    const componentType = componentOf(s);
    let text;
    if (v === undefined || v === null) text = componentType === 'Checkbox' ? false : '';
    else if (componentType === 'Checkbox') text = v === true;
    else if (componentType === 'Select') text = enumText(v);
    else if (componentType === 'JsonTextArea') text = JSON.stringify(v);
    else text = String(v);
    state[p] = { value: text, componentType };
  };
  walk(schema, value, '');
  return state;
}

/** Strict adapter: form state -> typed answer. Unparseable entries are kept as the raw string, so validation fails. */
export function fromFormState(schema, formState) {
  const get = p => (isObj(formState) && Object.prototype.hasOwnProperty.call(formState, p) && isObj(formState[p]) ? formState[p].value : undefined);
  const build = (s, p, required) => {
    if (isGroup(s)) {
      const out = {};
      for (const [k, sub] of Object.entries(s.properties)) {
        const v = build(sub, p ? `${p}.${k}` : k, (s.required ?? []).includes(k));
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    if (isRepeater(s)) {
      const n = get(`${p}.${ROWS}`);
      if (typeof n !== 'string' || !INT.test(n)) return required ? [] : undefined;
      const rows = [];
      for (let i = 0; i < Math.min(Number(n), 10_000); i++) rows.push(build(s.items, `${p}.${i}`, true));
      return rows;
    }
    const raw = get(p);
    const nullable = types(s).includes('null') || (s.enum ?? []).includes(null);
    if (raw === '' || raw === undefined) return !required ? undefined : nullable ? null : (componentOf(s) === 'Checkbox' ? false : raw ?? '');
    switch (componentOf(s)) {
      case 'Checkbox': return raw === true ? true : raw === false ? false : raw;
      case 'Select': { const m = s.enum.find(x => enumText(x) === raw); return m === undefined ? raw : m; }
      case 'NumberInput': {
        const integer = types(s).includes('integer');
        if (typeof raw !== 'string') return raw;
        const t = raw.trim();
        if (integer ? INT.test(t) : NUM.test(t)) return Number(t);
        return raw;                                        // "12abc": kept as a string, rejected by validation
      }
      case 'JsonTextArea': { if (typeof raw !== 'string') return raw; try { return JSON.parse(raw); } catch { return raw; } }
      default: return raw;
    }
  };
  return build(schema, '', true);
}

/** OpenUI's client `numeric` rule (spec/language.md:378–382): any non-blank string whose parseFloat is not NaN. */
export const clientNumericAccepts = s => typeof s === 'string' && s.trim() !== '' && !Number.isNaN(Number.parseFloat(s));

/** Plant one invalid entry ("<n>abc") in the first numeric field (sorted path order); null if the form has none. */
export function plantInvalid(formState) {
  const path = Object.keys(formState).sort().find(p => formState[p].componentType === 'NumberInput' && formState[p].value !== '');
  if (!path) return null;
  return { path, formState: { ...formState, [path]: { ...formState[path], value: `${formState[path].value}abc` } } };
}
