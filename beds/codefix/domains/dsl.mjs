// Tiny DSL for hidden/visible test cases. A case is { title, steps }; steps are interpreted
// by harness.py and rendered to pytest by render.mjs.
export const New = (v, cls, args = [], kw = {}) => ['new', v, cls, args, kw];
export const Call = (v, meth, args = [], kw = {}, as = null) => (as ? ['call', v, meth, args, kw, as] : ['call', v, meth, args, kw]);
export const Fn = (fn, args = [], kw = {}, as = null) => (as ? ['fn', fn, args, kw, as] : ['fn', fn, args, kw]);
export const Get = (v, attr) => ['get', v, attr];
export const Ref = name => ({ $ref: name });
export const Tup = (...items) => ({ $tuple: items });
export const Case = (title, steps) => ({ title, steps });

// Distinct-ish identifiers drawn from the RNG.
export function codes(r, prefix, n, lo = 100, hi = 999) {
  const out = new Set();
  while (out.size < n) out.add(`${prefix}-${r.int(lo, hi)}`);
  return [...out];
}
