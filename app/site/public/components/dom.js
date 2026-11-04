// DOM helpers. Every value from the workspace, a template or the person is put on the page as text (text nodes),
// never parsed as markup: no string is ever turned into HTML anywhere in the site (app/site/test/security.test.mjs checks).
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) { if (dv !== undefined && dv !== null) node.dataset[dk] = dv; }
    else if (k === 'value' && 'value' in node) node.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open' || k === 'hidden' || k === 'required' || k === 'multiple') { node[k] = !!v; if (v === true && k !== 'checked' && k !== 'selected') node.setAttribute(k, ''); }
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  append(node, children);
  return node;
}
export function append(node, children) {
  for (const c of [children].flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === '') continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
export const frag = (...children) => append(document.createDocumentFragment(), children);
export const text = s => document.createTextNode(String(s ?? ''));
let uid = 0;
export const id = prefix => `${prefix}-${++uid}`;
export function clear(node) { while (node.firstChild) node.firstChild.remove(); return node; }
/** Plural helper for counts rendered from data: n and the right noun form. */
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** A time for people: "21 Oct 2026, 18:42 GMT+1" (local, with the zone named, so it is never ambiguous; P5 walkthrough M6). */
export const when = t => { if (!t) return ''; const d = new Date(t); return Number.isFinite(d.getTime()) ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }) : String(t); };
/** A time for records: "21 Oct 2026, 18:42:36 UTC". */
export const whenUtc = t => { if (!t) return ''; const d = new Date(t); return Number.isFinite(d.getTime()) ? `${d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' })} UTC` : String(t); };
/** A day: "21 Oct 2026". */
export const day = t => { if (!t) return ''; const d = new Date(t); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : String(t); };
/** replaceChildren that skips null, undefined, false and '' (DOM replaceChildren writes null as the text "null": P2 walkthrough M4). */
export function replace(node, ...children) { clear(node); return append(node, children); }
