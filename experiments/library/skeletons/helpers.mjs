// Solver-side helpers, inlined verbatim (minus `export`) into every assembled solve.mjs by assemble.mjs: a solver runs
// in the B1 sandbox with tools/ only, so it can import nothing else. Pure functions; reviewed library code (the
// composition checker scans skeletons and slot bodies, not these).
export const chunk = (xs, n) => { const out = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };
export const groupBy = (xs, f) => xs.reduce((m, x) => { const k = String(f(x)); (m[k] ??= []).push(x); return m; }, {});
export const countBy = (xs, f) => xs.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] ?? 0) + 1; return m; }, {});
export const sumMinor = (xs, f = v => v) => xs.reduce((n, v) => n + f(v), 0);
export const sameIds = (rows, batch) => Array.isArray(rows) && rows.length === batch.length
  && JSON.stringify(rows.map(r => String(r?.id)).sort()) === JSON.stringify(batch.map(b => String(b.id)).sort());
// Union-find over row ids; pairs [{a, b}]. Clusters keep the input order of their first row.
export function unionFind(rows, pairs) {
  const parent = new Map(rows.map(r => [r.id, r.id]));
  const find = a => (parent.get(a) === a ? a : (parent.set(a, find(parent.get(a))), parent.get(a)));
  for (const p of pairs) { const ra = find(p.a.id), rb = find(p.b.id); if (ra !== rb) parent.set(rb, ra); }
  const groups = new Map();
  for (const r of rows) { const k = find(r.id); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  return [...groups.values()];
}
// Blocking: rows sharing any key form candidate pairs (each pair once, in input order).
export function candidatePairs(rows, block) {
  const byKey = new Map(), seen = new Set(), out = [];
  rows.forEach((r, i) => { for (const k of block(r)) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(i); } });
  for (const idx of byKey.values()) for (let x = 0; x < idx.length; x++) for (let y = x + 1; y < idx.length; y++) {
    const key = `${idx[x]}:${idx[y]}`;
    if (!seen.has(key)) { seen.add(key); out.push({ a: rows[idx[x]], b: rows[idx[y]] }); }
  }
  return out.sort((p, q) => rows.indexOf(p.a) - rows.indexOf(q.a) || rows.indexOf(p.b) - rows.indexOf(q.b));
}
// A small validator for the portable schema subset (the solver cannot import the repo's): type, enum, const, required,
// properties, additionalProperties false, items, minimum, maximum, minItems, maxItems.
export function validates(s, v) {
  if (!s || s === true) return true;
  const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const ok = types.some(x => x === t || (x === 'integer' && Number.isInteger(v)) || (x === 'number' && t === 'number' && Number.isFinite(v)));
    if (!ok) return false;
    if (types.includes('number') && t === 'number' && !Number.isFinite(v)) return false;
  }
  if (s.enum && !s.enum.some(e => JSON.stringify(e) === JSON.stringify(v))) return false;
  if (s.const !== undefined && JSON.stringify(s.const) !== JSON.stringify(v)) return false;
  if (typeof v === 'number' && ((s.minimum != null && v < s.minimum) || (s.maximum != null && v > s.maximum))) return false;
  if (t === 'object') {
    for (const k of s.required ?? []) if (!(k in v)) return false;
    for (const [k, sub] of Object.entries(s.properties ?? {})) if (k in v && !validates(sub, v[k])) return false;
    if (s.additionalProperties === false && Object.keys(v).some(k => !(k in (s.properties ?? {})))) return false;
  }
  if (t === 'array') {
    if ((s.minItems != null && v.length < s.minItems) || (s.maxItems != null && v.length > s.maxItems)) return false;
    if (s.items && !v.every(x => validates(s.items, x))) return false;
  }
  return true;
}
// A flow.judge request from a judge slot value J ({tiers, system, prompt(input), schema, check?(value, input), samples?})
// plus the skeleton's own parts (extra.schema, extra.check). The skeleton's check runs first; null / undefined = ok.
export function judgeSpec(J, input, extra = {}) {
  const checks = [extra.check, J.check ? v => J.check(v, input) : null].filter(Boolean);
  return { tiers: J.tiers, system: J.system ?? '', prompt: extra.prompt ?? J.prompt(input), schema: extra.schema ?? J.schema,
    check: checks.length ? v => { for (const c of checks) { const r = c(v); if (r != null && r !== true) return r; } return null; } : null,
    ...(J.samples > 1 ? { samples: J.samples } : {}) };
}
