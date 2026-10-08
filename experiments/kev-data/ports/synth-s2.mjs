// S2 value_provenance for the synth bed (JUDGE-PROGRAM.md §1.2 S2; §2.3 rule 9; §2.5; §4.3; JUDGE-BUILD-PLAN.json group "synth").
// One row = one claim of the corpus: the state is {document_type, property, value, passage} and the label the claim's world mode
// (measured -> own_measurement, quoted -> quoted, predicted -> projected, injection -> instruction_like; a bound has no option and is
// left out). The value and the passage come from the synth-values tap (exact unique substring match of the formatted value).
//
// The population is the claims of the task's requested properties (the state's `property` is "the requested property named in the
// prompt"). Its natural rates are measured on the bed (NATURAL_RATES) and pinned by the test; deployment-rate sets are drawn at
// them, the train set is capped at 3:1, calib-OOD is enriched and carries importance weights back to the natural rate, balanced
// copies give per-class recall only (§2.3 rule 9).
import { labelledQuestion, questionId, uniformTarget } from '../lib/render.mjs';
import { optionOrder, importanceWeights, counts } from '../lib/balance.mjs';
import { skeleton, spanHash, skeletonBucket } from '../lib/hash.mjs';
import { PROP_FORMS } from '../taps/synth-frames.mjs';
import { S2_CARRIERS, S2_NONSETTLING } from './synth-lines.mjs';
import { sentenceSpans } from '../judges/synth.mjs';
import { SMOKE, makeRecord, paraphraseOf, pickBy, unit01, hnum, sha, byHash, bump, drawAtRates, enrichedRates, textAllowed, textBucketsAllowed, formOf, OOD } from './synth-core.mjs';

export const S2_LABELS = Object.freeze(['own_measurement', 'quoted', 'projected', 'instruction_like']);
// Measured on 900 train-range dev worlds (seeds 401-700 x d3-d5; 58,977 aligned claims of requested properties): the rates a
// deployed S2 node meets on this bed. The program quotes 90.1 / 7.7 / 1.6 / 0.5 % for the pre-v3 bed (synth 2.0.0); the current
// bed (3.0.0) writes more quoted values. test/synth.test.mjs re-measures them on other worlds and fails above 1 pp.
export const NATURAL_RATES = Object.freeze({ own_measurement: 0.8502, quoted: 0.1304, projected: 0.0144, instruction_like: 0.0051 });
// train: every label within 3:1 of the rarest (rule 9); instruction_like exists only at d5 and its bucket supply is small
export const TRAIN_RATES = Object.freeze({ own_measurement: 0.36, quoted: 0.30, projected: 0.22, instruction_like: 0.12 });
export const BALANCED_RATES = Object.freeze({ own_measurement: 0.25, quoted: 0.25, projected: 0.25, instruction_like: 0.25 });
export const ADVERSARIAL_RATES = Object.freeze({ own_measurement: 0.40, quoted: 0.30, projected: 0.20, instruction_like: 0.10 });
export const UNKNOWABLE_RATES = Object.freeze({ own_measurement: 0.25, quoted: 0.25, projected: 0.25, instruction_like: 0.25 });

// ---- candidates of a world --------------------------------------------------------------------------------------------------------------------
export function s2Candidates(G, W) {
  const out = [], { slice } = G;
  const byDoc = new Map();
  for (const r of W.tap.claims) if (r.status === 'aligned') (byDoc.get(r.doc) ?? byDoc.set(r.doc, []).get(r.doc)).push(r);
  for (const r of W.tap.claims) {
    if (r.status !== 'aligned' || !r.requested) continue;
    if (!r.label) { bump(G, `s2:excluded:${r.excluded}`); continue; }
    const doc = W.parsed.byId[r.doc], form = formOf(r.sentence, W.masks);
    if (!textAllowed(slice, form, r.passage, W.masks)) { bump(G, 's2:bucket'); continue; }
    // other claims whose value the passage also holds: a passage that mixes labels is a natural distractor
    const others = byDoc.get(r.doc).filter(x => x !== r.cid && x.cid !== r.cid && x.start >= r.passFrom && x.end <= r.passTo);
    const mixed = others.some(x => x.label && x.label !== r.label);
    out.push({
      id: `${W.seed}:${r.cid}`, seed: W.seed, label: r.label, form, row: r, doc,
      state: { document_type: doc.type, property: r.prop, value: r.anchor, passage: r.passage },
      slots: { document: r.doc, value: r.anchor, property: r.prop }, mixed, others: others.length,
    });
  }
  return out;
}

// ---- axes of a slice -------------------------------------------------------------------------------------------------------------------------------
// [{ name, n, rates, label axis }] in drawing order: the deployment-rate set first (it must match the natural rates), then the
// balanced copy, then the adversarial pairs, the presence-matched unknowables and the paraphrase records take what is left.
export function s2Axes(slice, n, { share = {} } = {}) {
  const sh = { injection: 0.05, unknowable: 0.05, ...share };
  if (slice === 'train') {
    const pairs = Math.round(n * sh.injection), unk = Math.round(n * sh.unknowable);
    return [{ name: 'train', n: n - 2 * pairs - unk, rates: TRAIN_RATES, set: 'train' }, { name: 'adversarial', pairs, rates: TRAIN_RATES, set: 'train' }, { name: 'unknowable', n: unk, rates: UNKNOWABLE_RATES, set: 'unknowable' }];
  }
  if (slice === 'calib-ood') return [{ name: 'enriched', n, rates: enrichedRates(NATURAL_RATES, 'own_measurement', 3), set: 'enriched', fill: 'own_measurement' }];
  if (slice === 'test-ood') {
    const f = n / 2500;
    return [
      { name: 'natural', n: Math.round(600 * f), rates: NATURAL_RATES, set: 'natural' },
      { name: 'balanced', n: Math.round(400 * f), rates: BALANCED_RATES, set: 'balanced' },
      { name: 'adversarial', pairs: Math.round(400 * f), rates: ADVERSARIAL_RATES, set: 'adversarial' },
      { name: 'unknowable', n: Math.round(300 * f), rates: UNKNOWABLE_RATES, set: 'unknowable' },
      { name: 'paraphrase', records: Math.round(134 * f), rates: NATURAL_RATES, set: 'paraphrase' },
    ];
  }
  return [{ name: 'natural', n, rates: NATURAL_RATES, set: 'natural' }];
}

// ---- records -----------------------------------------------------------------------------------------------------------------------------------------------
function s2Meta(G, W, c, extra) {
  const r = c.row;
  return {
    seed: W.seed, difficulty: W.difficulty, worldHash: W.wh, variant: 'clean', formId: c.form, surface: { source: 'bed', slice: G.slice, lineHash: spanHash(r.sentence) }, masks: W.masks,
    kit: { port: 'S2', slots: c.slots },
    s2: { stratum: r.press ? 'press-release' : 'research', mode: r.mode, anchor: r.kind, docKind: r.docKind, cond: r.cond, variantEntity: Boolean(r.variant), mixed: c.mixed, set: 'train', ...extra },
  };
}
const optionsOf = G => Object.keys(G.contracts.S2.options);
function recordOf(G, W, c, key, set, extraMeta = {}, over = {}) {
  return makeRecord({ contract: G.contracts.S2, slice: G.slice, opts: G.opts, key, state: over.state ?? c.state, label: over.label ?? c.label, target: over.target,
    meta: { ...s2Meta(G, W, c, { set }), ...extraMeta, ...(over.meta ?? {}) } });
}

// An injection insert (§2.5): a sentence that urges a wrong option, at a random sentence boundary of the passage. The pair (clean
// twin, inserted twin) is one cluster. A carrier is used only where the passage still obeys the slice's skeleton buckets.
export function carrierPool(G, label) {
  const own = [];
  const fromOpts = (G.opts.lines ?? []).filter(l => l && l.port === 'S2' && l.role === 'carrier' && typeof l.text === 'string' && (OOD.has(G.slice) ? l.slice === G.slice : (l.slice ?? 'train') === 'train'));
  for (const l of fromOpts) if ((l.target ?? l.label) !== label && S2_LABELS.includes(l.target ?? l.label)) own.push({ text: l.text, urges: l.target ?? l.label, filter: l.filter?.status ?? l.filter ?? l.filters?.twoModel ?? 'pending', source: 'heldout' });
  if (!OOD.has(G.slice) && G.opts.builtin !== false) for (const [urges, list] of Object.entries(S2_CARRIERS)) if (urges !== label) for (const t of list) own.push({ text: t, urges, filter: 'pending', source: 'authored-builtin' });
  return own;
}
export function insertCarrier(passage, carrier, key) {
  const spans = sentenceSpans(passage), at = hnum(`${key}|at`) % (spans.length + 1);
  const pos = at === spans.length ? passage.length : spans[at].start;
  return at === spans.length ? `${passage} ${carrier}` : `${passage.slice(0, pos)}${carrier} ${passage.slice(pos)}`;
}
function injectedTwin(G, W, c, rec, key) {
  const pool = carrierPool(G, c.label).sort((a, b) => byHash(sha(`${key}|${a.text}`), sha(`${key}|${b.text}`)));
  for (const k of pool) {
    const passage = insertCarrier(c.state.passage, k.text, key);
    if (!textBucketsAllowed(G.slice, passage, W.masks)) continue;
    const state = { ...c.state, passage }, pairId = `s2i:${G.slice}:${c.id}`;
    rec.meta.pairId = pairId; rec.meta.variant = 'clean';
    return recordOf(G, W, c, `${key}|inj`, 'adversarial', { variant: 'injection', pairId, surface: { source: 'bed', slice: G.slice, lineHash: spanHash(c.row.sentence), carrier: { source: k.source, filter: k.filter, urges: k.urges, lineHash: spanHash(k.text) } },
      kit: { port: 'S2', slots: c.slots, reproducible: false } }, { state });
  }
  bump(G, 's2:injection-no-carrier');
  return null;
}
// A presence-matched unknowable (§2.5): the sentence holding the value is replaced by a same-register sentence that mentions the
// value and does not say where it comes from.
function unknowableOf(G, W, c, key) {
  const r = c.row, spans = sentenceSpans(c.state.passage), at = spans.findIndex(s => s.text === r.sentence);
  if (at < 0) { bump(G, 's2:unknowable-no-sentence'); return null; }
  const names = PROP_FORMS[r.prop].names, ent = W.world.entMap.get(r.ent);
  for (const f of [...S2_NONSETTLING].sort((a, b) => byHash(sha(`${key}|${a}`), sha(`${key}|${b}`)))) {
    const sentence = f.replace('{V}', r.anchor).replace('{pn}', pickBy(names, `${key}|pn`)).replace('{E}', pickBy([ent.name, ent.alias], `${key}|E`));
    const passage = `${c.state.passage.slice(0, spans[at].start)}${sentence}${c.state.passage.slice(spans[at].end)}`;
    if (!textAllowed(G.slice, formOf(sentence, W.masks), passage, W.masks)) continue;
    const state = { ...c.state, passage }, options = optionsOf(G);
    return recordOf(G, W, c, `${key}|unk`, 'unknowable', { variant: 'unknowable', formId: formOf(sentence, W.masks), surface: { source: 'authored-builtin', slice: G.slice, lineHash: spanHash(sentence), filter: 'pending' }, kit: { port: 'S2', slots: c.slots, reproducible: false },
      counterfactual: { swapped: true, from: 'decisive sentence', to: 'non-settling value sentence', path: 'passage' }, labelSource: 'authored-brief' },
    { state, target: uniformTarget(options) });
  }
  bump(G, 's2:unknowable-no-frame');
  return null;
}

// ---- the draw ----------------------------------------------------------------------------------------------------------------------------------------------------------
// cands: S2 candidates of every world of the call, with the world context in `W`. Returns the records and a report.
export function s2Records(G, cands, worlds) {
  const slice = G.slice, n = G.opts.rows?.S2 ?? (G.opts.s2Wave === 2 ? (G.opts.smokeRows ?? SMOKE)[slice] : G.targets.S2?.[slice]);
  if (!n) return { records: [], report: null };
  const axes = s2Axes(slice, n, { share: G.opts.share });
  const used = new Set(), records = [], report = { slice, n, axes: {}, supply: null };
  const worldOf = c => worlds.get(c.seed);
  report.supply = Object.fromEntries(S2_LABELS.map(l => [l, cands.filter(c => c.label === l).length]));
  for (const ax of axes) {
    const want = ax.records ? ax.records : ax.pairs ? ax.pairs : ax.n;
    // an adversarial axis draws its pairs; a paraphrase axis its records
    const r = drawAtRates(cands, { label: c => c.label, rates: ax.rates, n: want, key: c => c.id, salt: `${slice}|S2|${ax.name}`, fill: ax.fill, exclude: used });
    for (const c of r.kept) used.add(c.id);
    report.axes[ax.name] = { want, taken: r.taken, shortfall: r.shortfall, supply: r.supply };
    const weights = ax.set === 'enriched' ? importanceWeights(r.kept, { label: c => c.label, target: NATURAL_RATES }) : null;
    for (const c of r.kept) {
      const W = worldOf(c), key = `${slice}|S2|${c.id}`;
      if (ax.name === 'adversarial') {
        const clean = recordOf(G, W, c, key, 'adversarial', { variant: 'clean' });
        const inj = injectedTwin(G, W, c, clean, key);
        if (!inj) { bump(G, 's2:adversarial-dropped'); continue; }
        records.push(clean, inj); continue;
      }
      if (ax.name === 'unknowable') { const u = unknowableOf(G, W, c, key); if (u) records.push(u); continue; }
      if (ax.name === 'paraphrase') {
        const base = recordOf(G, W, c, key, 'paraphrase');
        records.push(paraphraseOf(base, G.contracts.S2, slice, G.opts, key) ?? base); continue;
      }
      const extra = { set: ax.set, ...(weights ? { weight: Number(weights[c.label].toFixed(6)) } : {}) };
      const rec = recordOf(G, W, c, key, ax.set, {}, {});
      rec.meta.s2.set = ax.set;
      if (weights) rec.meta.weight = extra.weight;
      if (ax.set === 'balanced') rec.meta.balancedCopy = true;
      records.push(rec);
    }
  }
  if (slice === 'train' && G.opts.cap !== false) return { records: capTrain(G, records, report), report };
  return { records, report };
}
// Rule 9: a train file caps every label at 3x the rarest label present. A label whose supply fell short (instruction_like exists only in
// the d5 worlds and only where the passage obeys the train bucket) lowers the cap; the surplus of the larger labels is dropped from the
// plain train axis (never one row of an adversarial pair or an unknowable twin) and counted in report.cap.
function capTrain(G, records, report) {
  const hard = r => r.meta.variant !== 'unknowable', labelOf = r => Object.values(r.questions)[0].label;
  const c = counts(records.filter(hard), labelOf), present = Object.values(c);
  report.cap = { before: c, maxRatio: 3, dropped: {} };
  if (present.length < 2) return records;
  const cap = Math.floor(Math.min(...present) * 3), drop = new Set();
  for (const l of Object.keys(c)) {
    let extra = c[l] - cap;
    if (extra <= 0) continue;
    const plain = records.filter(r => hard(r) && labelOf(r) === l && r.meta.s2.set === 'train' && !r.meta.pairId)
      .sort((a, b) => byHash(sha(`${G.slice}|S2|cap|${a.meta.seed}|${a.meta.surface.lineHash}|${a.meta.s2.anchor}`), sha(`${G.slice}|S2|cap|${b.meta.seed}|${b.meta.surface.lineHash}|${b.meta.s2.anchor}`)));
    for (const r of plain) { if (extra <= 0) break; drop.add(r); extra--; }
    report.cap.dropped[l] = c[l] - cap - extra;
    if (extra > 0) report.cap.unmet = { ...(report.cap.unmet ?? {}), [l]: extra };
  }
  bump(G, 's2:train-cap', drop.size);
  const kept = records.filter(r => !drop.has(r));
  report.cap.after = counts(kept.filter(hard), labelOf);
  return kept;
}
export { S2_LABELS as LABELS };
