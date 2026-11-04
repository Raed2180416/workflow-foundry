// Program B, the SECOND program (research/reuse-20261021/PREREG-C2-1.md §1): the "Hazmat Shipment Desk" (HSD). It books
// outbound shipments for several suppliers. For every line item it needs the product's dangerous-goods hazard class
// under the company's dangerous-goods procedure: the same procedure (SOP-Bench dangerous_goods, sop.txt) whose workflow
// program A (the SOP-Bench phase-2 build) proved. Around that sub-task HSD has its own logic, written here as code:
// hold, mode choice, reroute and escort. HSD is authored for this experiment; nothing in it reads a workflow's code.
//
// This file holds B's spec as code, used by every arm alike:
// - SOURCES: the suppliers, each with its own product-master conventions (generated in gen-b.mjs);
// - truthClass(): B's ORACLE for the sub-task, written from the procedure text (sop.txt §5.1–5.7) and B's own hazard
//   matrix. Not independent of the proven workflow in authorship: its author had read the frozen workflow's
//   lib/hazard.mjs (while surveying candidates) before writing this. It shares no code with it;
// - decideShipment(): B's composition rules, applied to whatever item classes an arm produced.
//
// B's hazard matrix. sop.txt §5.7 names four classes over the 4–20 total ("Higher score gets higher severity, D being
// the highest") but no cut-offs. HSD's compliance team uses equal bands over the 17 totals, the wider band at the bottom:
// A 4–8, B 9–12, C 13–16, D 17–20. On SOP-Bench's 20 dev rows (the proven evidence) totals 5–7 are A, 9 is B, 15–16 are
// C and 17–20 are D, so the bands agree with every dev label; totals 8 and 10–14 are not pinned by those rows. The proven
// workflow uses the same bands (it fitted the same rows), so in-profile agreement on band edges is by construction, not
// evidence about SOP-Bench's sealed labels; the in-profile stratum tests the reuse machinery and the procedure's other
// rules (validation, missing and zero components, imputation), not the band cut-offs.

export const UNABLE = 'Unable to Decide';
export const CLASSES = Object.freeze(['Hazard Class A', 'Hazard Class B', 'Hazard Class C', 'Hazard Class D']);
export const BANDS = Object.freeze([[8, 'Hazard Class A'], [12, 'Hazard Class B'], [16, 'Hazard Class C'], [20, 'Hazard Class D']]);

/**
 * The suppliers (sources). What differs from the proven program's data, as B's integration team knows it after the fact;
 * nothing here is visible to a workflow, the gate or the agent except through the data itself.
 *   idStyle   'proof' P_NNNNN (the procedure's format) | 'hyphen' P-NNNNN | 'lower' p_NNNNN (this supplier's master)
 *   textStyle 'proof' (the vocabulary of the proven rows) | 'ghs' (GHS hazard/precaution statements) | 'de' (German
 *             documents); 'ghs' and 'de' are authored for B (gen-b.mjs)
 *   scale     'sop' 1–5 | 'ten' 1–10 stored, SOP score = ceil(v/2) | 'inverted' 1–5 stored, SOP score = 6 − v |
 *             'offset' 0–4 stored, SOP score = v + 1
 *   response  how the supplier's scoring service answers: extra fields appended (extra), the score as a string
 *             (valueAs 'string'), or under another key (scoreKey)
 *   edge      products that exercise procedure branches the proven rows never reached
 *   set       'dev+test': in both manifests (the drift kinds the gate was developed on) | 'test': held-out drift kinds,
 *             defined before the test manifest was generated and after the gate was frozen (PREREG-C2-1.md §1.3)
 */
export const SOURCES = Object.freeze({
  S0: { label: 'in-profile replica', idStyle: 'proof', textStyle: 'proof', scale: 'sop', response: null, edge: false, set: 'dev+test', harmful: false },
  S1: { label: 'benign input drift (GHS text style)', idStyle: 'proof', textStyle: 'ghs', scale: 'sop', response: null, edge: false, set: 'dev+test', harmful: false },
  S2: { label: 'harmful input drift (id format P-NNNNN)', idStyle: 'hyphen', textStyle: 'proof', scale: 'sop', response: null, edge: false, set: 'dev+test', harmful: true },
  S3: { label: 'harmful environment drift (scores stored 1-10)', idStyle: 'proof', textStyle: 'proof', scale: 'ten', response: null, edge: false, set: 'dev+test', harmful: true },
  S4: { label: 'silent semantic drift (scores stored inverted)', idStyle: 'proof', textStyle: 'proof', scale: 'inverted', response: null, edge: false, set: 'dev+test', harmful: true },
  S5: { label: 'benign environment drift (extra response fields)', idStyle: 'proof', textStyle: 'proof', scale: 'sop', response: { extra: { scale: '1-5', model_version: 'dg-score-2.3', scored_at: '2026-10-01T09:30:00Z' } }, edge: false, set: 'dev+test', harmful: false },
  S6: { label: 'in-domain unproven branches (missing scores, bad ids, blank documents)', idStyle: 'proof', textStyle: 'proof', scale: 'sop', response: null, edge: true, set: 'dev+test', harmful: false },
  H1: { label: 'held-out: type drift (scores returned as strings)', idStyle: 'proof', textStyle: 'proof', scale: 'sop', response: { valueAs: 'string' }, edge: false, set: 'test', harmful: true },
  H2: { label: 'held-out: field rename (score under "score")', idStyle: 'proof', textStyle: 'proof', scale: 'sop', response: { scoreKey: 'score' }, edge: false, set: 'test', harmful: true },
  H3: { label: 'held-out: id case drift (p_NNNNN)', idStyle: 'lower', textStyle: 'proof', scale: 'sop', response: null, edge: false, set: 'test', harmful: true },
  H4: { label: 'held-out: offset scale (scores stored 0-4)', idStyle: 'proof', textStyle: 'proof', scale: 'offset', response: null, edge: false, set: 'test', harmful: true },
  H5: { label: 'held-out: language drift (German documents)', idStyle: 'proof', textStyle: 'de', scale: 'sop', response: null, edge: false, set: 'test', harmful: false },
});
export const SOURCE_IDS = Object.freeze(Object.keys(SOURCES));
export const sourcesOfSet = set => SOURCE_IDS.filter(s => set === 'test' || SOURCES[s].set === 'dev+test');

/** B's id rule per supplier: the supplier master's format. An id in another format cannot be resolved (sop.txt §5.1). */
export function validIdFor(source, id) {
  const style = SOURCES[source].idStyle;
  return typeof id === 'string' && (style === 'hyphen' ? /^P-\d{5}$/ : style === 'lower' ? /^p_\d{5}$/ : /^P_\d{5}$/).test(id);
}

/** The SOP-scale score (1–5, 0 = missing) a stored value means at a supplier; null stays null. */
export function sopScoreOf(source, raw) {
  if (raw === null || raw === undefined) return null;
  const scale = SOURCES[source].scale;
  if (scale === 'offset') return raw + 1;
  if (raw === 0) return 0;
  if (scale === 'ten') return Math.ceil(raw / 2);
  if (scale === 'inverted') return 6 - raw;
  return raw;
}
/** The stored value a supplier keeps for an SOP-scale score s (the generator's direction); r in [0,1) breaks the 1–10 tie. */
export function rawOf(source, s, r = 0) {
  const scale = SOURCES[source].scale;
  if (scale === 'offset') return s === null || s === undefined || s === 0 ? null : s - 1;   // no stored value for a missing score
  if (s === null || s === undefined || s === 0) return s;
  if (scale === 'ten') return 2 * s - (r < 0.5 ? 1 : 0);
  if (scale === 'inverted') return 6 - s;
  return s;
}

/**
 * B's oracle for one product: the hazard class the procedure gives, under B's matrix and the supplier's conventions.
 * product: { source, id, texts: {field: text}, raw: {component: stored value | null}, inMaster: boolean }.
 * - §5.1: an id that fails the supplier's format, or that the master cannot resolve, gets Unable to Decide.
 * - §5.2–5.5: a component is scored from its document; a blank document or a missing stored value leaves it missing.
 *   The stored value is read in SOP units (sopScoreOf). A score outside 1–5 fails §5.2–5.5's validation (missing).
 * - §5.6: a missing or 0 component takes the max of the others; more than two missing gives Unable to Decide; a total
 *   outside 4–20 is not acceptable (Unable to Decide).
 * - §5.7: B's bands.
 */
export function truthOf(product) {
  const { source, id } = product;
  if (!validIdFor(source, id) || product.inMaster === false) return { hazard_class: UNABLE, hazard_score: 0, reason: 'id' };
  const fieldOf = { safety: 'sds_label_text', handling: 'handling_and_storage_guidelines', transportation: 'transportation_requirements', disposal: 'disposal_guidelines' };
  const sc = {};
  for (const c of Object.keys(fieldOf)) {
    const text = product.texts?.[fieldOf[c]];
    const s = typeof text === 'string' && text.trim() ? sopScoreOf(source, product.raw?.[c] ?? null) : null;
    sc[c] = Number.isInteger(s) && s >= 1 && s <= 5 ? s : null;
  }
  const present = Object.values(sc).filter(v => v !== null);
  const missing = 4 - present.length;
  if (missing > 2) return { hazard_class: UNABLE, hazard_score: 0, reason: 'missing>2' };
  const fill = Math.max(...present);
  const total = Object.values(sc).reduce((a, v) => a + (v ?? fill), 0);
  if (total < 4 || total > 20) return { hazard_class: UNABLE, hazard_score: 0, reason: 'range' };
  return { hazard_class: BANDS.find(([max]) => total <= max)[1], hazard_score: total, reason: missing ? 'imputed' : 'complete' };
}
export const truthClass = p => truthOf(p).hazard_class;

// ------------------------------------------------------------------------------------------------ HSD composition
export const MODES = Object.freeze(['air', 'sea', 'road']);
const rank = c => CLASSES.indexOf(c);
/** Modes HSD may book for a shipment class: air up to B, sea up to C, road always. */
export const allowedModes = cls => MODES.filter(m => (m === 'air' ? rank(cls) <= 1 : m === 'sea' ? rank(cls) <= 2 : true));

/**
 * HSD's decision for one shipment from its items' hazard classes (strings as an arm produced them) and the requested mode.
 * - any item without a recognised class (Unable to Decide, a deopt, an unreadable answer) → hold for manual review;
 * - shipment class = the most severe item class;
 * - requested mode allowed → book it; else reroute to the first allowed of sea, road;
 * - road with class D needs an escort.
 */
export function decideShipment(itemClasses, requestedMode) {
  if (!itemClasses.length || itemClasses.some(c => rank(c) < 0)) return { decision: 'hold', mode: null, escort: false, shipment_class: null };
  const cls = itemClasses.reduce((a, c) => (rank(c) > rank(a) ? c : a));
  const ok = allowedModes(cls);
  const mode = ok.includes(requestedMode) ? requestedMode : ['sea', 'road'].find(m => ok.includes(m));
  return { decision: mode === requestedMode ? 'book' : 'reroute', mode, escort: mode === 'road' && cls === 'Hazard Class D', shipment_class: cls };
}
export const sameDecision = (a, b) => a.decision === b.decision && a.mode === b.mode && a.escort === b.escort && a.shipment_class === b.shipment_class;

/** Normalise an arm's answer to a class string the way the strict scorer compares labels (case, _/- and spaces folded). */
export function normaliseClass(v) {
  if (typeof v !== 'string') return null;
  const f = s => s.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
  const hit = [...CLASSES, UNABLE].find(c => f(c) === f(v));
  return hit ?? null;
}
