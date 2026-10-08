// Wave-2 smoke sets and the wave-3 S5 of the synth group (JUDGE-PROGRAM.md §1.2 S1, S3, S4, S5, X2, X4, X7; §10 "Wave-2 ports get a
// smoke set only: about 300 train and 100 dev-select rows per port"). Each builder gives candidates per world; a candidate is a
// row the port's state-only solver (solve/synth.mjs) reproduces ("undecidable rows are listed with reasons and removed", §2.7
// step 1: x?:undecidable counts them).
//   S3  condition_standard   a claim's stated condition against the property's standard condition; labels from claim.cond (no tap);
//                            two families, the raw text and the text with temperatures in kelvin. Wave-1 size when the tap fails.
//   S4  variant_form         the requested entity itself or a salt, hydrate, doped, composite, porous or mutant form of it
//   S1  notice_target        a notice and its 2-8 candidate documents (target present, or absent: S1_present only)
//   X2  same_entity          a name and a code of one entity, or two different entities (a near-name distractor)
//   X4  statement_standing   a statement of a superseded document against one of a current document
//   X7  item_needed          a document against a sub-question about one cell
//   S5  document_kind        the 7 kinds of TYPE_LABELS; unseen type names (family unseen-names) in test-ood when supplied
import { labelledQuestion, questionId, companionContract } from '../lib/render.mjs';
import { optionOrder, counts } from '../lib/balance.mjs';
import { spanHash, skeleton, skeletonBucket } from '../lib/hash.mjs';
import { KIND_OF_TYPE, KINDS, TYPE_LABELS, PROP_FORMS, CONDITIONS } from '../taps/synth-frames.mjs';
import { stateS3, stateS4, stateS5, stateS1, stateX2, stateX4, stateX7, candidateOptions, normaliseTemperatures, sentenceSpans, kindOfType, parseTask, authorRoleOf } from '../judges/synth.mjs';
import * as SOL from '../solve/synth.mjs';
import { needsConversion } from './synth-x5.mjs';
import { SMOKE, makeRecord, hnum, sha, byHash, unit01, bump, bucketAllows, formOf, textAllowed, noTestOodSentences, drawAtRates, pickBy, fail, aliasText, BUCKET_OF_SLICE } from './synth-core.mjs';

export { SMOKE };
const even = labels => Object.fromEntries(labels.map(l => [l, 1 / labels.length]));
// Rows of a smoke port in the slice. When the synth-values tap missed its gate (opts.s2Wave 2) S3, whose labels need no tap, takes
// S2's wave-1 size in every slice (JUDGE-BUILD-PLAN.json acceptance 1).
export const sizeOf = (G, port, targets) => G.opts.rows?.[port] ?? (port === 'S3' && G.opts.s2Wave === 2 ? targets.S2[G.slice] : (G.opts.smokeRows ?? SMOKE)[G.slice]) ?? 0;

// ---- S3 ----------------------------------------------------------------------------------------------------------------------------
export function s3Candidates(G, W) {
  const out = [], seen = new Set(), stds = W.parsed.stdConditions;
  for (const c of W.world.claims) {
    const r = W.rowOf.get(c.cid);
    if (c.mode !== 'measured' || !W.parsed.properties.includes(c.prop) || !c.condText || !r) continue;
    const d = W.world.docMap.get(c.doc), doc = W.parsed.byId[d.id];
    if (!doc.text.toLowerCase().includes(c.condText.toLowerCase())) { bump(G, 's3:condition-not-in-text'); continue; }
    if (seen.has(`${c.prop}|${c.condText}`)) continue;
    seen.add(`${c.prop}|${c.condText}`);
    const label = c.cond === 'std' ? 'yes' : 'no', fam = unit01(`${G.slice}|S3|${W.seed}|${c.cid}|fam`) < 0.5 ? 'raw' : 'normalised';
    const norm = fam === 'normalised' ? normaliseTemperatures : x => x;
    const state = { property: c.prop, standard_condition: norm(stds[c.prop]), stated_condition: norm(c.condText) };
    const form = formOf(state.stated_condition, W.masks);
    if (!bucketAllows(G.slice, form)) { bump(G, 's3:bucket'); continue; }
    const solved = SOL.solveS3(state);
    if (solved.label !== label) { bump(G, `s3:undecidable`); continue; }
    out.push({ id: `${W.seed}:${c.cid}`, seed: W.seed, label, state, form, family: `synth:${fam}`, slots: { document: d.id, condition: c.condText, property: c.prop, normalised: fam === 'normalised' }, wk: needsConversion(state.stated_condition, state.standard_condition) && fam === 'raw' });
  }
  return out;
}
// ---- S4 ----------------------------------------------------------------------------------------------------------------------------
export function s4Candidates(G, W) {
  const out = [], reqEnts = new Set(W.world.requested.map(c => c.ent));
  const inPassage = r => W.tap.claims.filter(o => o.status === 'aligned' && o.doc === r.doc && o.start >= r.passFrom && o.end <= r.passTo);
  for (const r of W.tap.claims) {
    if (r.status !== 'aligned' || r.mode !== 'measured' || !reqEnts.has(r.ent) || !r.requested) continue;
    // the state carries no value pointer: every claim the passage holds is about the same entity in the same form (or the only one)
    if (inPassage(r).some(o => o.ent !== r.ent || Boolean(o.variant) !== Boolean(r.variant))) { bump(G, 's4:mixed-passage'); continue; }
    const form = formOf(r.sentence, W.masks);
    if (!textAllowed(G.slice, form, r.passage, W.masks)) { bump(G, 's4:bucket'); continue; }
    const name = W.world.entMap.get(r.ent).name, state = { requested_entity: name, passage: r.passage }, label = r.variant ? 'modified' : 'unmodified';
    if (SOL.solveS4(state).label !== label) { bump(G, 's4:undecidable'); continue; }
    out.push({ id: `${W.seed}:${r.cid}`, seed: W.seed, label, state, form, slots: { document: r.doc, value: r.anchor, entity: name }, sentence: r.sentence, variantEntity: Boolean(r.variant) });
  }
  return out;
}
// ---- S5 ----------------------------------------------------------------------------------------------------------------------------
export function s5Candidates(G, W) {
  const out = [];
  for (const d of W.parsed.documents) {
    const kind = KIND_OF_TYPE.get(String(d.type).trim());
    if (!kind) continue;
    out.push({ id: `${W.seed}:${d.id}`, seed: W.seed, label: kind, state: { type_label: d.type, venue: d.venue, title: d.title }, form: formOf(d.type, W.masks), slots: { document: d.id }, docKind: kind, host: d });
  }
  return out;
}
export function s5Unseen(G, W, unseen) {
  const out = [];
  if (!unseen?.length) return out;
  const byKind = {};
  for (const d of W.parsed.documents) { const k = KIND_OF_TYPE.get(String(d.type).trim()); if (k) (byKind[k] ??= []).push(d); }
  for (const u of unseen) {
    if (!KINDS.includes(u.kind) || !byKind[u.kind]?.length) continue;
    const key = `${G.slice}|S5u|${W.seed}|${u.name}`, d = pickBy(byKind[u.kind], key);
    out.push({ id: `${W.seed}:u:${u.name}`, seed: W.seed, label: u.kind, state: { type_label: u.name, venue: d.venue, title: d.title }, form: formOf(u.name, W.masks), slots: { document: d.id }, unseen: true, host: d, reproducible: false });
  }
  return out;
}
// ---- S1 ----------------------------------------------------------------------------------------------------------------------------
const NOTICE_KINDS = new Set(['erratum', 'retraction', 'concern']);
const WORDS = new WeakMap();
const wordSet = (d, f) => { let s = WORDS.get(d); if (!s) WORDS.set(d, s = f()); return s; };
function overlapScore(notice, d) {
  const words = wordSet(d, () => new Set(`${d.title} ${d.venue} ${d.authors}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 3)));
  const text = wordSet(notice, () => new Set(notice.text.toLowerCase().split(/[^\p{L}\p{N}]+/u)));
  let n = 0; for (const w of words) if (text.has(w)) n++;
  return n;
}
export function s1Candidates(G, W) {
  const out = [], research = W.parsed.documents.filter(d => ['journal', 'preprint', 'labnote', 'press'].includes(kindOfType(d.type)));
  const keyToId = k => W.world.docMap.get(k)?.id;
  for (const n of W.parsed.documents) {
    if (!NOTICE_KINDS.has(kindOfType(n.type))) continue;
    const d = W.world.docs.find(x => x.id === n.id), kind = d.kind;
    const tkey = kind === 'erratum' ? W.world.errata.find(x => x.doc === d.key)?.target : kind === 'retraction' ? W.world.retractions.find(x => x.doc === d.key)?.target : W.world.concerns.find(x => x.doc === d.key)?.target;
    const target = tkey ? keyToId(tkey) : null, key = `${G.slice}|S1|${W.seed}|${n.id}`;
    const k = 3 + (hnum(`${key}|k`) % 6);
    const others = research.filter(x => x.id !== target && x.id !== n.id).sort((a, b) => overlapScore(n, b) - overlapScore(n, a) || byHash(sha(`${key}|${a.id}`), sha(`${key}|${b.id}`)));
    const ids = [...(target ? [target] : []), ...others.slice(0, k - (target ? 1 : 0)).map(x => x.id)].sort((a, b) => byHash(sha(`${key}|o|${a}`), sha(`${key}|o|${b}`)));
    const slots = { document: n.id, candidates: ids };
    if (!textAllowed(G.slice, null, n.text, W.masks)) { bump(G, 's1:bucket'); continue; }
    const state = stateS1(W.task, slots), { options, optionDescriptions } = candidateOptions(W.task, slots);
    const label = target ? options[ids.indexOf(target)] : null, args = { options, optionDescriptions };
    const pres = SOL.solveS1Present(state, args), wantPresent = target ? 'yes' : 'no';
    if (target) { const pick = SOL.solveS1(state, args); if (pick.label !== label) { bump(G, 's1:undecidable'); continue; } }
    if (pres.label !== wantPresent) { bump(G, 's1:present-undecidable'); continue; }
    out.push({ id: `${W.seed}:${n.id}`, seed: W.seed, label, present: wantPresent, state, options, optionDescriptions, form: formOf(n.text, W.masks), slots, noticeKind: kind, ref: 'notice' });
  }
  return out;
}
// ---- X2 ----------------------------------------------------------------------------------------------------------------------------
const hasBoth = (doc, a, b) => sentenceSpans(doc.text).find(s => s.text.includes(a) && s.text.includes(b));
export function x2Candidates(G, W) {
  const out = [], world = W.world, ents = world.entities.filter(e => !e.phantom && !e.comparator);
  const note = 'Entities with similar names or codes are different entities.';
  for (const e of ents) {
    const aliasE = aliasText(e);
    const mapDoc = W.parsed.documents.find(d => hasBoth(d, e.name, aliasE) || hasBoth(d, aliasE, e.name));
    if (mapDoc) {
      const [a, b] = unit01(`${G.slice}|X2|${W.seed}|${e.key}|ord`) < 0.5 ? [e.name, aliasE] : [aliasE, e.name];
      out.push({ id: `${W.seed}:${e.key}:same`, seed: W.seed, label: 'same', kind: 'name-code', slots: { a, b, document: mapDoc.id } });
    }
    if (e.distractor) {
      const dEnt = world.entMap.get(e.distractor), dAlias = aliasText(dEnt);
      const pairs = [[e.name, dEnt.name], [aliasE, dAlias], [e.name, dAlias], [aliasE, dEnt.name]];
      const [a, b] = pairs[hnum(`${G.slice}|X2|${W.seed}|${e.key}|dp`) % pairs.length];
      const doc = W.parsed.documents.find(d => hasBoth(d, a, b)) ?? W.parsed.documents.find(d => d.text.includes(a)) ?? W.parsed.documents.find(d => d.text.includes(b));
      if (doc) out.push({ id: `${W.seed}:${e.key}:near`, seed: W.seed, label: 'different', kind: 'near-name', slots: { a, b, document: doc.id, note } });
    }
  }
  const req = ents.filter(e => e.requested);
  for (let i = 0; i + 1 < req.length; i += 2) {
    const [x, y] = [req[i], req[i + 1]], a = x.name, b = unit01(`${G.slice}|X2|${W.seed}|${y.key}|u`) < 0.5 ? y.name : aliasText(y);
    const doc = W.parsed.documents.find(d => d.text.includes(a)) ?? W.parsed.documents[0];
    out.push({ id: `${W.seed}:${x.key}:${y.key}:other`, seed: W.seed, label: 'different', kind: 'unrelated', slots: { a, b, document: doc.id } });
  }
  const kept = [];
  for (const c of out) {
    let state;
    try { state = stateX2(W.task, c.slots); } catch { bump(G, 'x2:no-sentence'); continue; }
    const form = formOf(`${state.a} // ${state.b} // ${state.context}`, W.masks);
    if (!bucketAllows(G.slice, form) || !textAllowed(G.slice, null, state.context, W.masks)) { bump(G, 'x2:bucket'); continue; }
    if (SOL.solveX2(state).label !== c.label) { bump(G, 'x2:undecidable'); continue; }
    kept.push({ ...c, state, form });
  }
  return kept;
}
// ---- X4 ----------------------------------------------------------------------------------------------------------------------------
export function x4Candidates(G, W) {
  const out = [], world = W.world;
  const oldKeys = new Set(world.supersessions.map(s => s.old)), void_ = new Set(world.retractions.filter(r => r.target).map(r => r.target));
  const rowsOf = id => W.tap.claims.filter(r => r.status === 'aligned' && r.doc === id && r.mode === 'measured' && r.requested);
  const supSentence = (doc, re) => sentenceSpans(doc.text).map(s => s.text).find(t => re.test(t));
  for (const s of world.supersessions) {
    const oldD = world.docMap.get(s.old), newD = world.docMap.get(s.new);
    const oldDoc = W.parsed.byId[oldD.id], newDoc = W.parsed.byId[newD.id];
    const own = supSentence(oldDoc, /this version is superseded|has been superseded by its published journal version|is replaced by that article|this preprint was superseded/);
    const other = supSentence(newDoc, /replaces version 1|supersedes the version first posted|first version posted|Version 2, replacing|is replaced by it|Supersedes the .+? posting|replaces revision 1|it supersedes the entry|replaces the memo of|supersedes the revision 1 entry|which it supersedes|this article supersedes it|has been superseded by the present article|which it replaces|is superseded by this article/);
    const related = [own ?? other].filter(Boolean);
    if (!related.length) { bump(G, 'x4:no-supersession-sentence'); continue; }
    for (const r of rowsOf(oldD.id).slice(0, 2)) out.push({ id: `${W.seed}:${r.cid}`, seed: W.seed, label: 'superseded', doc: oldDoc, row: r, related, style: s.style });
  }
  for (const d of world.docs) {
    if (oldKeys.has(d.key) || void_.has(d.key) || !['journal', 'preprint', 'labnote'].includes(d.kind)) continue;
    const doc = W.parsed.byId[d.id];
    const self = supSentence(doc, /replaces version 1|supersedes the version first posted|first version posted|Version 2, replacing|is replaced by it|Supersedes the .+? posting|replaces revision 1|it supersedes the entry|replaces the memo of|supersedes the revision 1 entry|which it supersedes|this article supersedes it|has been superseded by the present article|which it replaces|is superseded by this article/);
    for (const r of rowsOf(d.id).slice(0, 1)) out.push({ id: `${W.seed}:${r.cid}`, seed: W.seed, label: 'binding', doc, row: r, related: self ? [self] : [], style: 'none' });
  }
  const kept = [];
  for (const c of out) {
    const slots = { document: c.doc.id, statement: c.row.sentence, related: c.related };
    const state = stateX4(W.task, slots), form = formOf(c.row.sentence, W.masks);
    if (!textAllowed(G.slice, form, c.row.sentence, W.masks) || c.related.some(t => !textAllowed(G.slice, null, t, W.masks))) { bump(G, 'x4:bucket'); continue; }
    if (SOL.solveX4(state).label !== c.label) { bump(G, 'x4:undecidable'); continue; }
    kept.push({ ...c, state, form, slots });
  }
  return kept;
}
// ---- X7 ----------------------------------------------------------------------------------------------------------------------------
export function x7Candidates(G, W) {
  const out = [], world = W.world, cells = world.requested.filter(c => !c.feats.includes('pressOnly'));
  if (!cells.length) return out;
  const cell = cells[hnum(`${G.slice}|X7|${W.seed}|cell`) % cells.length], ent = world.entMap.get(cell.ent), names = [ent.name, aliasText(ent)];
  const sub = `What is the accepted ${cell.prop} of ${ent.name} (also written ${aliasText(ent)})?`;
  const hasClaim = new Set(world.claims.filter(c => c.ent === cell.ent && c.prop === cell.prop).map(c => world.docMap.get(c.doc).id));
  for (const d of W.parsed.documents) {
    const kind = kindOfType(d.type);
    if (!['journal', 'preprint', 'labnote', 'press'].includes(kind)) continue;
    if (!noTestOodSentences(G.slice, d.text, W.masks)) { bump(G, 'x7:bucket'); continue; }
    const label = hasClaim.has(d.id) ? 'needed' : 'not_needed', state = stateX7(W.task, { document: d.id });
    if (SOL.solveX7(state, { property: cell.prop, names }).label !== label) { bump(G, 'x7:undecidable'); continue; }
    const form = formOf(`${d.type} ${d.title}`, W.masks);
    out.push({ id: `${W.seed}:${d.id}`, seed: W.seed, label, state, sub, form, slots: { document: d.id }, cellProp: cell.prop });
  }
  return out;
}

// ---- records ------------------------------------------------------------------------------------------------------------------------------------
function rec(G, W, port, c, key, meta = {}, extra = {}) {
  const contract = G.contracts[port];
  const base = { seed: W.seed, difficulty: W.difficulty, worldHash: W.wh, variant: 'clean', formId: c.form, surface: { source: 'bed', slice: G.slice, lineHash: spanHash(c.form) }, masks: W.masks, kit: { port, slots: c.slots, ...(c.reproducible === false ? { reproducible: false } : {}) } };
  if (port === 'S1') {
    const names = c.options, order = optionOrder(names, key), questions = {};
    const present = labelledQuestion(companionContract(contract), { label: c.present, wording: 'Q0', optionOrder: optionOrder(['yes', 'no'], `${key}|present`) });
    const rec0 = c.label ? makeRecord({ contract, slice: G.slice, opts: G.opts, key, state: c.state, label: c.label, options: c.options, optionDescriptions: c.optionDescriptions, extraQuestions: { S1_present: present }, meta: { ...base, ...meta } })
      : { state: c.state, questions: { S1_present: present }, meta: { family: 'synth', bed: 'synth', labelSource: 'generator', needsWorldKnowledge: false, wordingId: 'Q0', ...base, ...meta } };
    return rec0;
  }
  const slots = port === 'X7' ? { subquestion: c.sub } : {};
  return makeRecord({ contract, slice: G.slice, opts: G.opts, key, state: c.state, label: c.label, slots, meta: { ...base, ...meta, ...extra } });
}
const LABELS = { S3: ['yes', 'no'], S4: ['unmodified', 'modified'], S5: KINDS, X2: ['same', 'different'], X4: ['superseded', 'binding'], X7: ['needed', 'not_needed'], S1: ['present', 'absent'] };
export function smokeRecords(G, port, cands, worlds, { n = null } = {}) {
  const slice = G.slice, size = n ?? sizeOf(G, port, G.targets);
  if (!size) return { records: [], report: null };
  const labelOf = c => (port === 'S1' ? (c.present === 'yes' ? 'present' : 'absent') : c.label);
  const labels = LABELS[port], rates = port === 'S1' ? { present: 0.8, absent: 0.2 } : even(labels);
  const r = drawAtRates(cands, { label: labelOf, rates, n: size, key: c => c.id, salt: `${slice}|${port}`, fill: labels[0] });
  const records = [];
  for (const c of r.kept) {
    const W = worlds.get(c.seed), key = `${slice}|${port}|${c.id}`;
    const meta = {};
    if (port === 'S3') { meta.family = c.family; meta.s3 = { family: c.family }; meta.needsWorldKnowledge = c.wk; }
    if (port === 'S4') meta.s4 = { variantEntity: c.variantEntity };
    if (port === 'S1') meta.s1 = { present: c.present, k: c.options.length, noticeKind: c.noticeKind };
    if (port === 'X2') meta.x2 = { kind: c.kind };
    if (port === 'X4') meta.x4 = { style: c.style };
    if (port === 'X7') meta.x7 = { property: c.cellProp };
    if (port === 'S5') { meta.s5 = { kind: c.docKind ?? c.label, unseen: Boolean(c.unseen) }; if (c.unseen) { meta.family = 'unseen-names'; } }
    records.push(rec(G, W, port, c, key, meta));
  }
  return { records, report: { port, slice, n: size, taken: r.taken, shortfall: r.shortfall, supply: r.supply } };
}
