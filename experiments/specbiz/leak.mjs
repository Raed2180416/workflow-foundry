// SPEC-0 leak gates (FIRST-CLASS-PROGRAMS §4.4: "no 8-word shingle of SPEC-E appears outside its assigned carrier").
// $0, pure. Three checks, all must pass:
//   L1 shingles   no unit-specific 8-word shingle of SPEC-E appears in a file whose carrier may not state that unit.
//                 Unit-specific: the shingle occurs in exactly one unit and not in the platform zone (which is exact by
//                 design). Shingles shared by several units are generic and reported, not scored.
//   L2 placement  every fragment the renderer placed (unit, role current) sits in a file of an allowed carrier; stale
//                 variants sit only in SOP files; precedents only in records files.
//   L3 anchors    each unit's rendering anchor (content.mjs) appears only in files of its allowed carriers, so a paraphrase
//                 cannot leak into the wrong carrier either (L1 only sees SPEC-E's own wording).
// Also reported: the verbatim share of each unit's specific shingles inside its own carrier (how close the rendering
// is to a copy of SPEC-E), and the same over the owner's pre-rendered answers.
import { specUnits, loadSpec } from './spec-units.mjs';
import { allowedCarriers } from './carriers.mjs';
import { UNITS } from './content.mjs';

export const K = 8;

/** Normalised word tokens: lower case, markdown and punctuation removed (Unicode letters and digits kept). */
export function words(text) {
  return text.toLowerCase().replace(/[`*_>#|]/g, ' ').replace(/[^\p{L}\p{N}.\-+]+/gu, ' ').replace(/(?<!\d)[.](?!\d)/g, ' ')
    .split(/\s+/).filter(Boolean);
}

export function shingles(text, k = K) {
  const w = words(text), out = new Set();
  for (let i = 0; i + k <= w.length; i++) out.add(w.slice(i, i + k).join(' '));
  return out;
}

/** Unit-specific shingles of SPEC-E: occurring in exactly one rule/reading unit and not in the platform zone. */
export function unitShingles(units, k = K) {
  const per = {}, count = new Map();
  for (const [id, u] of Object.entries(units)) {
    if (id === 'PLATFORM' || id === 'REF') continue;
    per[id] = shingles(u.text, k);
    for (const s of per[id]) count.set(s, (count.get(s) ?? 0) + 1);
  }
  const platform = shingles(units.PLATFORM.text, k);
  const specific = {}, generic = new Set();
  for (const [id, set] of Object.entries(per)) {
    specific[id] = new Set();
    for (const s of set) { if (count.get(s) === 1 && !platform.has(s)) specific[id].add(s); else generic.add(s); }
  }
  return { specific, generic };
}

export function leakTest(pack, { k = K, root } = {}) {
  const units = specUnits(loadSpec(root).text);
  const { specific, generic } = unitShingles(units, k);
  const fileSh = Object.fromEntries(Object.entries(pack.files).map(([f, t]) => [f, shingles(t, k)]));
  const fileLower = Object.fromEntries(Object.entries(pack.files).map(([f, t]) => [f, t.toLowerCase()]));
  const carrierOf = id => pack.assignment.units[id]?.carrier;
  const L1 = [], L2 = [], L3 = [], verbatim = {};
  for (const [id, set] of Object.entries(specific)) {
    const allowed = allowedCarriers(carrierOf(id));
    let own = 0, ownFiles = 0;
    for (const [f, sh] of Object.entries(fileSh)) {
      const ok = allowed.includes(pack.fileCarrier[f]);
      let hits = 0;
      for (const s of set) if (sh.has(s)) { hits += 1; if (!ok) L1.push({ unit: id, carrier: carrierOf(id), file: f, fileCarrier: pack.fileCarrier[f], shingle: s }); }
      if (ok) { own = Math.max(own, hits); ownFiles += 1; }
    }
    verbatim[id] = set.size ? own / set.size : 0;
  }
  for (const fr of pack.fragments) {
    const fc = pack.fileCarrier[fr.file], c = carrierOf(fr.unit);
    const ok = fr.role === 'current' ? allowedCarriers(c).includes(fc) : fr.role === 'stale' ? fc === 'sop' : fr.role === 'precedent' ? fc === 'records' && c === 'records' : false;
    if (!ok) L2.push({ ...fr, fileCarrier: fc, carrier: c });
  }
  for (const [id, u] of Object.entries(UNITS)) {
    const a = u.anchor.toLowerCase(), allowed = allowedCarriers(carrierOf(id));
    if (!u.core.toLowerCase().includes(a)) L3.push({ unit: id, problem: 'anchor not in core' });
    for (const [f, t] of Object.entries(fileLower)) if (t.includes(a) && !allowed.includes(pack.fileCarrier[f])) L3.push({ unit: id, file: f, fileCarrier: pack.fileCarrier[f] });
  }
  // Anchors must be unique to their unit, or L3 proves nothing.
  for (const [id, u] of Object.entries(UNITS)) for (const [j, v] of Object.entries(UNITS)) if (id !== j && v.core.toLowerCase().includes(u.anchor.toLowerCase())) L3.push({ unit: id, problem: `anchor also in ${j}` });
  // Owner answers: verbatim share only (the owner may state any unit; withholding is the owner simulator's job).
  const ownerVerbatim = {};
  for (const rec of pack.owner.records) for (const id of rec.units) {
    const sh = shingles(rec.answer, k), set = specific[id] ?? new Set();
    ownerVerbatim[id] = set.size ? [...set].filter(s => sh.has(s)).length / set.size : 0;
  }
  const vals = Object.values(verbatim);
  return {
    pass: L1.length === 0 && L2.length === 0 && L3.length === 0,
    k, leaks: { L1, L2, L3 },
    stats: {
      units: Object.keys(specific).length,
      specificShingles: Object.values(specific).reduce((s, x) => s + x.size, 0), genericShingles: generic.size,
      verbatimShareMax: Math.max(...vals), verbatimShareMean: vals.reduce((a, b) => a + b, 0) / vals.length,
      ownerVerbatimShareMax: Math.max(0, ...Object.values(ownerVerbatim)),
    },
    verbatim,
  };
}
