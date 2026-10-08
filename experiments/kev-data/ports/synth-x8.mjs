// X8:synth value_consistent (JUDGE-PROGRAM.md §1.2 X8: "synth: a cell value after toCanon against the uncorrected or wrong-unit value
// (world.mjs:101-108)"; §3.4: synth is a HELD-OUT family of X8, test-ood only). The state is {source_line, conventions, field,
// extracted_value}: the sentence that holds a measured value of a requested property (or an erratum's printed and corrected values),
// the task's own Units paragraph, the extraction node's field ("melting point in °C") and the value it extracted.
//   consistent    the value after toCanon, in the property's canonical unit, to four significant figures
//   inconsistent  the near misses of the bed: the printed number left unconverted, the number converted as another unit of the
//                 property (a wrong factor), a decimal slip; for an erratum line the printed value left uncorrected
// A row needs a line the state-only solver can read: exactly one value of the property in the sentence (a second number in the
// property's units, for instance a storage temperature of a melting point, makes the extraction ambiguous and the row is dropped).
// The label-bearing source line must be one sentence of the span registry's splitting, in the test-ood skeleton bucket; the lines are
// registered as the family's held-out spans (heldoutSpans), so no train, calib or dev state carries them (§2.3 rule 7).
import { spanHash, skeleton, skeletonBucket, sentences as registrySentences } from '../lib/hash.mjs';
import { PROP_FORMS, unitsOf, toCanon, relDiff, plain } from '../taps/synth-frames.mjs';
import { sentenceSpans, stateX8, locateValue, kindOfType, occurrences } from '../judges/synth.mjs';
import { valueExpressions, solveX8 } from '../solve/synth.mjs';
import { makeRecord, paraphraseOf, hnum, sha, byHash, unit01, bump, formOf, pickBy } from './synth-core.mjs';
import { counts } from '../lib/balance.mjs';

// units whose conversion the Units paragraph spells out (the others need the SI prefixes or ordinary time and volume factors)
const SPELLED = new Set(['K', '°F', 'ksi', 'psi', 'g/mL', 'N/mm²', 'g/cc', 'Mb', 'kb']);
export const fmt4 = x => String(Number(Number(x).toPrecision(4)));
export const fieldOf = prop => `${prop} in ${PROP_FORMS[prop].unit}`;

const KINDS = Object.freeze({ unconverted: 0.4, 'wrong-factor': 0.3, slip: 0.3 });
function inconsistentValue(prop, value, unitId, key) {
  const units = unitsOf(prop), truth = toCanon(prop, value, unitId), canonical = PROP_FORMS[prop].unit, applicable = [];
  if (unitId !== canonical && relDiff(value, truth) > 0.05) applicable.push(['unconverted', value]);
  const others = units.filter(u => u.id !== unitId).map(u => [u, value * u.f + u.o]).filter(([, v]) => relDiff(v, truth) > 0.05 && Math.abs(v - value) > 1e-12 * Math.abs(value));
  if (others.length) { const [u, v] = others[hnum(`${key}|wf`) % others.length]; applicable.push(['wrong-factor', v, u.id]); }
  applicable.push(['slip', unit01(`${key}|slip`) < 0.5 ? truth * 10 : truth / 10]);
  const w = applicable.map(a => KINDS[a[0]]), tot = w.reduce((a, b) => a + b, 0);
  let x = unit01(`${key}|kind`) * tot, i = 0;
  while (i < applicable.length - 1 && (x -= w[i]) >= 0) i++;
  const [kind, v, via] = applicable[i];
  return { kind, extracted: fmt4(v), via: via ?? null };
}

export function x8Candidates(G, W) {
  const out = [];
  const nBySentence = new Map();
  for (const r of W.tap.claims) if (r.status === 'aligned') nBySentence.set(`${r.doc}|${r.sentenceIndex}`, (nBySentence.get(`${r.doc}|${r.sentenceIndex}`) ?? 0) + 1);
  for (const r of W.tap.claims) {
    if (r.status !== 'aligned' || !r.requested || r.mode !== 'measured' || r.press) continue;
    if (nBySentence.get(`${r.doc}|${r.sentenceIndex}`) !== 1) { bump(G, 'x8:several-claims-in-sentence'); continue; }
    if (registrySentences(r.sentence).length !== 1 || skeletonBucket(formOf(r.sentence, W.masks)) !== 'test-ood') { bump(G, 'x8:bucket'); continue; }
    // the line names the property (an extraction row whose sentence says only "The result was 12 GPa." has nothing to check the field against)
    if (!PROP_FORMS[r.prop].names.some(n => r.sentence.toLowerCase().includes(n.toLowerCase()))) { bump(G, 'x8:property-not-named'); continue; }
    const exprs = valueExpressions(r.sentence, r.prop);
    if (exprs.length !== 1) { bump(G, 'x8:ambiguous-value-expression'); continue; }
    const c = W.world.claims[r.cid], key = `${G.slice}|X8|${W.seed}|${r.cid}`;
    const truth = toCanon(r.prop, c.value, c.unit);
    if (Math.abs(truth - toCanon(r.prop, exprs[0].value, exprs[0].unit)) > 0.01 * Math.abs(truth)) { bump(G, 'x8:expression-disagrees'); continue; }
    const wrong = inconsistentValue(r.prop, c.value, c.unit, key), consistent = unit01(`${key}|label`) < 0.5;
    out.push({ id: `${W.seed}:${r.cid}`, seed: W.seed, row: r, claim: c, kind: 'unit', label: consistent ? 'consistent' : 'inconsistent', extracted: consistent ? fmt4(truth) : wrong.extracted, wrong: consistent ? null : wrong,
      needsConversion: c.unit !== PROP_FORMS[r.prop].unit, spelled: SPELLED.has(c.unit) || c.unit === PROP_FORMS[r.prop].unit, field: fieldOf(r.prop),
      slots: { document: r.doc, located: r.anchor, field: fieldOf(r.prop), value: consistent ? fmt4(truth) : wrong.extracted }, sentence: r.sentence, form: formOf(r.sentence, W.masks) });
  }
  return out;
}

// An erratum's printed and corrected values (errata of kind 'value': the same unit, the corrected value is the truth of the cell):
// the extraction node read the notice; the near miss is the printed value left uncorrected.
export function x8ErratumCandidates(G, W) {
  const out = [], reqProps = new Set(W.world.requested.map(c => c.prop));
  for (const er of W.world.errata) {
    if (er.kind !== 'value' || !reqProps.has(er.prop)) continue;
    const dr = W.world.docMap.get(er.doc), doc = W.parsed.byId[dr.id];
    const syms = unitsOf(er.prop).find(u => u.id === er.unit).sym;
    const find = v => { const forms = syms.map(s => `${plain(v)} ${s}`), hits = forms.flatMap(f => occurrences(doc.text, f).map(o => ({ ...o, text: f }))); return hits.length === 1 ? hits[0] : null; };
    const oldA = find(er.oldValue), newA = find(er.value);
    if (!oldA || !newA || oldA.text === newA.text) { bump(G, 'x8:erratum-values-not-found'); continue; }
    const spans = sentenceSpans(doc.text), at = a => spans.findIndex(sp => sp.start <= a.start && a.end <= sp.end + 1);
    const i = at(oldA), j = at(newA);
    if (i < 0 || j < 0) continue;
    const block = doc.text.slice(spans[Math.min(i, j)].start, spans[Math.max(i, j)].end);
    if (skeletonBucket(skeleton(registrySentences(block).join(' '), W.masks)) !== 'test-ood') { bump(G, 'x8:bucket'); continue; }
    const key = `${G.slice}|X8|${W.seed}|${er.doc}`, truth = toCanon(er.prop, er.value, er.unit), oldCanon = toCanon(er.prop, er.oldValue, er.oldUnit);
    if (relDiff(truth, oldCanon) <= 0.05) continue;
    const consistent = unit01(`${key}|label`) < 0.5, extracted = fmt4(consistent ? truth : oldCanon), field = fieldOf(er.prop);
    const slots = { document: dr.id, located: newA.text, from: oldA.text, field, value: extracted };
    let state;
    try { state = stateX8(W.task, slots); } catch { bump(G, 'x8:erratum-kit'); continue; }
    if (solveX8(state).label !== (consistent ? 'consistent' : 'inconsistent')) { bump(G, 'x8:erratum-undecidable'); continue; }
    out.push({ id: `${W.seed}:${er.doc}`, seed: W.seed, row: { prop: er.prop, docKind: 'erratum' }, claim: { unit: er.unit }, kind: 'erratum', label: consistent ? 'consistent' : 'inconsistent', extracted, wrong: consistent ? null : { kind: 'uncorrected' },
      needsConversion: false, spelled: true, field, slots, sentence: block, form: formOf(block, W.masks) });
  }
  return out;
}

export function x8Record(G, W, c, key) {
  const state = stateX8(W.task, c.slots), r = c.row;
  return makeRecord({ contract: G.contracts.X8, slice: G.slice, opts: G.opts, key, state, label: c.label, slots: { field: c.field, value: c.slots.value },
    meta: { seed: W.seed, difficulty: W.difficulty, worldHash: W.wh, variant: 'clean', formId: c.form, surface: { source: 'bed', slice: G.slice, lineHash: spanHash(c.sentence) }, masks: W.masks, kit: { port: 'X8', slots: c.slots },
      needsWorldKnowledge: c.needsConversion && !c.spelled,
      x8: { kind: c.kind, property: r.prop, unit: c.claim.unit, canonical: PROP_FORMS[r.prop].unit, needsConversion: c.needsConversion, spelled: c.spelled, wrong: c.wrong?.kind ?? null, docKind: r.docKind } } });
}

export function x8Records(G, cands, worlds) {
  const slice = G.slice, n = G.opts.rows?.['X8:synth'] ?? G.targets['X8:synth']?.[slice];
  if (!n) return { records: [], report: null };
  const sorted = [...cands].sort((a, b) => byHash(sha(`${slice}|X8pick|${a.id}`), sha(`${slice}|X8pick|${b.id}`)));
  const half = (list, k) => ({ c: list.filter(x => x.label === 'consistent').slice(0, Math.ceil(k / 2)), i: list.filter(x => x.label === 'inconsistent').slice(0, Math.floor(k / 2)) });
  // erratum lines take a fifth of the rows (when the worlds supply them), the rest are unit rows; half of each consistent
  const err = sorted.filter(x => x.kind === 'erratum'), unit = sorted.filter(x => x.kind === 'unit');
  const e = half(err, Math.round(n * 0.2)), u = half(unit, n - (e.c.length + e.i.length));
  const kept = [...e.c, ...e.i, ...u.c, ...u.i].sort((a, b) => byHash(sha(`${slice}|X8o|${a.id}`), sha(`${slice}|X8o|${b.id}`)));
  const records = [];
  for (const c of kept) {
    const W = worlds.get(c.seed), key = `${slice}|X8|${c.id}`;
    let rec = x8Record(G, W, c, key);
    if (unit01(`${key}|para`) < 0.1) rec = paraphraseOf(rec, G.contracts.X8, slice, G.opts, key, { field: c.field, value: c.slots.value }) ?? rec;
    records.push(rec);
  }
  const labels = {}, kinds = {};
  for (const r of records) { const l = Object.values(r.questions)[0].label; labels[l] = (labels[l] ?? 0) + 1; const k = r.meta.x8.wrong ?? 'consistent'; kinds[k] = (kinds[k] ?? 0) + 1; }
  return { records, report: { slice, n, rows: records.length, supply: { consistent: sorted.filter(x => x.label === 'consistent').length, inconsistent: sorted.filter(x => x.label === 'inconsistent').length, erratum: err.length, unit: unit.length }, labels, kinds, rowKinds: counts(records, r => r.meta.x8.kind) } };
}

// ---- the held-out family's spans, for the span registry (§2.3 rule 7) ---------------------------------------------------------------
// The label-bearing source line of every X8:synth record. The assembly registers them with
// registry.add(text, { slice: 'heldout', source: 'synth', port: 'X8', kind: 'family-span', names, markers }).
export function heldoutSpans(record) {
  const masks = record.meta?.masks ?? { names: [], markers: [] }, out = [];
  const ports = Object.keys(record.questions).map(q => q.split('~')[0]);
  if (ports.includes('X8') && record.meta?.family === 'synth') out.push({ text: record.state.source_line, port: 'X8', kind: 'family-span', masks });
  return out.filter(s => s.text);
}
export function registerHeldout(registry, recs) {
  let n = 0;
  for (const r of recs) for (const s of heldoutSpans(r)) { registry.add(s.text, { slice: 'heldout', source: 'synth', port: s.port, kind: s.kind, names: s.masks.names, markers: s.masks.markers }); n++; }
  return n;
}
