// C2-2's items (research/reuse-20261021/PREREG-C2-2.md §1): fresh suppliers of every C2-1 kind with a longer labelled
// history (60 products: the first 15 are the C2-1 history, build 5 + repair 10), plus four kinds aimed at the blind spots
// of consumer conformance. Built from C2-1's frozen generator and oracle (gen-b.mjs generate, program-b.mjs truthOf and
// rawOf, unchanged): a T kind is generated as supplier S0 (A's conventions) under its own seed and then changed in the one
// respect that defines it. Truth never changes: it is the product's real SOP scores under B's matrix. What changes is
// what the supplier's systems STORE (raw) or how its scoring service ANSWERS, and, for T4, one label in B's records.
//
//   T1 temporal semantic drift: the history is stored on the SOP scale; after it, the supplier's scoring service stores
//      scores inverted (6 − s), as S4. Conformance sees only the past: it admits, and every check of shape passes.
//   T2 temporal shape drift: after the history, the service answers scores as strings (as H1). Conformance admits; the
//      per-run trace check should refuse.
//   T3 sparse semantic drift: a sub-brand (about 10% of the products, history and stream alike) is stored inverted.
//      Conformance catches it only if the history holds a sub-brand product whose class the inversion changes.
//   T4 label noise: B's records hold one wrong label among the first 15 history products (an adjacent class).
//      Conformance refuses a supplier the entry serves correctly (a false deopt by construction).
import { generate } from './gen-b.mjs';
import { CLASSES, SOURCES, rawOf } from './program-b.mjs';
import { COMPONENTS } from './world-b.mjs';
import { canon, rng, sha256, shuffled } from './lib.mjs';

export const C22_SCHEMA = 'c2-manifest/2';
export const C22_SIZES = Object.freeze({ pool: 60, build: 5, shipments: 10, itemWeights: [0.3, 0.4, 0.3], zeroRate: 0.03 });
/** The C2-1 history: the first 15 pool products (what a C2-1 builder learned from). */
export const HIST_SMALL = 15;
export const T_KINDS = Object.freeze({
  T1: { label: 'temporal semantic drift (scores stored inverted after the history)', base: 'S0', evalAs: 'S4', harmful: true },
  T2: { label: 'temporal shape drift (scores answered as strings after the history)', base: 'S0', evalResponse: Object.freeze({ valueAs: 'string' }), harmful: true },
  T3: { label: 'sparse semantic drift (a sub-brand, ~10% of products, stored inverted)', base: 'S0', sparse: Object.freeze({ as: 'S4', rate: 0.1 }), harmful: 'partly' },
  T4: { label: 'label noise (one wrong label among the first 15 history products)', base: 'S0', noisy: true, harmful: false },
});
export const C22_SOURCES = Object.freeze([...Object.keys(SOURCES), ...Object.keys(T_KINDS)]);
export const kindOf = s => (SOURCES[s] ? { ...SOURCES[s], kind: 'c2-1' } : { ...T_KINDS[s], kind: 't' });

const restore = (source, p) => Object.fromEntries(COMPONENTS.map(c => [c, rawOf(source, p.sop[c])]));

/** generateC22({ seed, bank }) -> manifest (schema c2-manifest/2). Deterministic; ids unique across the manifest. */
export function generateC22({ seed, bank, sizes = C22_SIZES }) {
  const base = generate({ seed, bank, sizes, sources: Object.keys(SOURCES) });
  const products = base.products.map(p => ({ ...p })), shipments = base.shipments.map(s => ({ ...s, items: [...s.items] }));
  const perSource = { ...base.sources };
  const used = new Set(products.map(p => p.id));
  const r = rng(`c2-22:${seed}`);
  let index = products.length;
  for (const [T, kind] of Object.entries(T_KINDS)) {
    const m = generate({ seed: `${seed}:${T}`, bank, sizes, sources: [kind.base] });
    const remap = new Map();
    for (const p0 of m.products) {
      let id = p0.id;
      while (used.has(id)) id = `P_${20000 + Math.floor(r() * 80000)}`;
      used.add(id); remap.set(p0.id, id);
      const p = { ...p0, id, index: index++, source: T, label: null };
      if (kind.evalAs && p.role === 'eval') { p.raw = restore(kind.evalAs, p); p.drift = 'stored'; }
      if (kind.evalResponse && p.role === 'eval') p.drift = 'response';
      if (kind.sparse && r() < kind.sparse.rate) { p.raw = restore(kind.sparse.as, p); p.drift = 'stored'; p.subBrand = true; }
      products.push(p);
    }
    const src = m.sources[kind.base];
    perSource[T] = { build: src.build.map(id => remap.get(id)), repair: src.repair.map(id => remap.get(id)), shipments: src.shipments.map(s => s.replace(`${kind.base}-`, `${T}-`)) };
    for (const s of m.shipments) shipments.push({ ...s, id: s.id.replace(`${kind.base}-`, `${T}-`), source: T, items: s.items.map(id => remap.get(id)) });
    if (kind.noisy) {
      // One wrong label in B's records: the first of the first 15 history products (in a seeded order) with a class A–D.
      const hist = [...perSource[T].build, ...perSource[T].repair].slice(0, HIST_SMALL);
      const byId = new Map(products.map(p => [p.id, p]));
      const target = shuffled(hist, r).map(id => byId.get(id)).find(p => CLASSES.includes(p.truth.hazard_class));
      const k = CLASSES.indexOf(target.truth.hazard_class);
      target.label = CLASSES[k === CLASSES.length - 1 ? k - 1 : k + 1];
    }
  }
  const order = shuffled(shipments.map(s => s.id), r);
  const manifest = { schema: C22_SCHEMA, seed, sizes, histSmall: HIST_SMALL, bank: base.bank, kinds: T_KINDS, sources: perSource, products, shipments, order };
  manifest.sha256 = sha256(canon({ ...manifest, sha256: undefined }));
  return manifest;
}

/** The label B's records hold for a history product (the truth, except T4's noisy one). */
export const labelOf = p => p.label ?? p.truth.hazard_class;
/** A supplier's history products in pool order (build then repair); n caps it (HIST_SMALL for the C2-1 history). */
export function historyOf(manifest, source, n = Infinity) {
  const byId = new Map(manifest.products.map(p => [p.id, p]));
  return [...manifest.sources[source].build, ...manifest.sources[source].repair].slice(0, n).map(id => byId.get(id));
}
/**
 * The supplier worlds at the two times C2-2 needs: history (when B's records were made) and stream (the eval items).
 * Every in-master product of the supplier is served in both; what differs is how the scoring service answers (T2).
 */
export function worldsC22(manifest, { toolOrder, makeWorld }) {
  const out = {};
  for (const source of Object.keys(manifest.sources)) {
    const k = kindOf(source);
    const products = manifest.products.filter(p => p.source === source && p.inMaster).map(p => ({ id: p.id, raw: p.raw }));
    const histResponse = k.kind === 'c2-1' ? k.response : null, evalResponse = k.kind === 'c2-1' ? k.response : (k.evalResponse ?? null);
    out[source] = { history: makeWorld({ name: `B2:${source}:history`, products, response: histResponse, toolOrder }),
      stream: makeWorld({ name: `B2:${source}:stream`, products, response: evalResponse, toolOrder }) };
  }
  return out;
}
