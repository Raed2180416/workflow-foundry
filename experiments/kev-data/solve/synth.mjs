// State-only solvers for the synth ports (JUDGE-PROGRAM.md §2.7 step 1: "solve/<port>.mjs reads only the exported
// state and question; for template ports a template match on the state string with the exported pools, in the manner
// of beds/records/solve-text.mjs, restricted to the state"). A solver sees a state (and the slots a question carries)
// and returns { label, basis } or { label: null, reason }: undecidable from the state. It never reads a world, a seed,
// a template id or any meta.
//
// S2 reads the clause that holds `value`:
//   instruction-like   the bed's three injection sentences (taps/synth-frames.mjs INJECTION_CUE)
//   projected          nine prediction / design-target templates
//   quoted             eleven attribution templates, and the ten two-value sentences when `value` is the quoted one
//   own_measurement    a clause of the document's own work: no attribution, no prediction cue
// The fixed templates are the bed's render.mjs sentences with their slots as wildcards; the pins in
// test/synth.test.mjs keep them equal to the bed.
import { sentenceSpans, occurrences, kindOfType, normaliseTemperatures, isCsvValue } from '../judges/synth.mjs';
import { INJECTION_CUE, unitsOf, toCanon, relDiff, PROP_FORMS, PROPERTIES, CONDITIONS, COND_PARTS, POLICY_TEXT, VARIANT_FORMS, UNMODIFIED_FORMS, KIND_OF_TYPE, TYPE_LABELS, KINDS } from '../taps/synth-frames.mjs';
import { X5_POLICY, X5_POLICY_LEADS, X5_COND_FRAMES } from '../ports/synth-lines.mjs';
import { skeletonText } from '../lib/hash.mjs';
import { stringLeaves } from '../lib/leakage.mjs';

const decided = (label, basis) => ({ label, basis });
const undecided = reason => ({ label: null, reason });
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const W = '.+?', Y = '\\d{4}';

// ---- the templates (render.mjs claimSentenceCore, quoteOwnSentence) with {V} the asked value ---------------------------------
const compile = (src, V) => new RegExp(`^${src.replace('{V}', V)}$`, 's');
export const QUOTED = Object.freeze([
  `For comparison, ${W} et al\\. \\(${Y}\\) reported an? ${W} of {V} for ${W}\\.`,
  `This differs from the {V} reported earlier by ${W} and co-workers \\(${Y}\\) for the ${W}\\.`,
  `A previous study \\(${W} et al\\., ${Y}\\) gave {V} as the ${W}; we did not repeat that measurement\\.`,
  `${W}'s group obtained {V} for the ${W}, a value we use here only for comparison\\.`,
  `Literature value \\(${W}, ${Y}\\): ${W} = {V}; not re-measured here\\.`,
  `Our data can be set against the {V} listed for the ${W} by ${W} and colleagues in ${Y}\\.`,
  `Earlier work from ${W} and co-authors \\(${Y}\\) put the ${W} at {V}; we take that number from their paper\\.`,
  `In the literature, {V} is quoted for the ${W} \\(${W} et al\\., ${Y}\\); no new measurement of it is reported here\\.`,
  `According to ${W} et al\\. \\(${Y}\\), the ${W} is {V}\\.`,
  `${W} et al\\. \\(${Y}\\) measured {V} for ${W} \\(${W}\\); that result is quoted, not ours\\.`,
  `The {V} that ${W} and colleagues \\(${Y}\\) published for the ${W} is reproduced here for reference only\\.`,
]);
export const PREDICTED = Object.freeze([
  `Our ${W} predicts an? ${W} of about {V} for ${W}; this value has not yet been measured\\.`,
  `Based on an? ${W}, the ${W} is expected to be around {V}, although we did not measure it\\.`,
  `The design target for the next ${W} batch is an? ${W} of {V} ${W}\\.`,
  `Simulations put the ${W} at {V}; no measurement has been made yet\\.`,
  `Extrapolating from related ${W}, the ${W} should be close to {V} \\(not measured\\)\\.`,
  `${W} gives {V} for the ${W}; we have not yet confirmed this experimentally\\.`,
  `Model estimates suggest an? ${W} near {V} for ${W}; experimental confirmation is pending\\.`,
  `If the trend across related ${W} holds, ${W} should show an? ${W} of roughly {V} ${W}; this is a forecast, not a result\\.`,
  `We aim for an? ${W} of {V} for ${W} in the next round; the current batches have not been tested against it\\.`,
]);
// two values in one sentence: [template, whichSlot is the quoted one]; V1 is the quoted value, V2 the document's own
export const QUOTE_OWN = Object.freeze([
  `${W} et al\\. \\(${Y}\\) reported {V1} for the ${W}; we obtained {V2} under the same conditions\\.`,
  `Our ${W}, {V2}, is (?:higher|lower) than the {V1} reported by ${W} and co-workers \\(${Y}\\)\\.`,
  `Whereas ${W}'s group found {V1}, we measured an? ${W} of {V2} for ${W}\\.`,
  `We obtained {V2} for the ${W}; ${W} et al\\. \\(${Y}\\) had reported {V1}\\.`,
  `Contrary to ${W} et al\\. \\(${Y}\\), who gave {V1}, we measured {V2} for the ${W}\\.`,
  `${W}'s ${Y} value for the ${W} was {V1}; ours is {V2}\\.`,
  `We found {V2} for the ${W}, against {V1} from ${W} and colleagues \\(${Y}\\)\\.`,
  `Unlike the {V1} of ${W} et al\\. \\(${Y}\\), our ${W} for ${W} came to {V2}\\.`,
  `The ${W} was {V2} here; ${W} et al\\. \\(${Y}\\) obtained {V1}\\.`,
  `Our {V2} for the ${W} sits (?:above|below) the {V1} quoted from ${W} et al\\. \\(${Y}\\)\\.`,
]);
// a bound sentence (not a claim) and the attribution cues that make an unmatched sentence undecidable
const ATTRIBUTION = /\bet al\b|co-workers|colleagues|co-authors|'s group|\bliterature\b|\bquoted\b|\bcite\b|\breported earlier\b|\bpreviously reported\b/i;
const PREDICTION = /\bpredict|\bdesign target\b|\bforecast\b|\bnot (?:yet )?(?:been )?measured\b|\bSimulations?\b|\bExtrapolat|\bModel estimates\b|\bwe aim for\b/i;
// a clause of the document's own work after a protocol / expectation lead ("Following the protocol of X et al. (y), we measured ...")
const OWN_LEAD = /^(?:Following the protocol of|Using the method of) .+? (?:et al\.|and co-workers) \(\d{4}\), /;

const unit = (re, V) => new RegExp(re.source.replace('{V}', V), re.flags);
// the sentence of a passage holding `value` and the value's start in it
function locate(state) {
  const passage = String(state.passage ?? ''), value = String(state.value ?? '');
  if (!passage || !value) return null;
  const hits = occurrences(passage, value, { csv: isCsvValue(value) });
  if (hits.length !== 1) return { error: hits.length ? 'value-several-times' : 'value-not-in-passage' };
  const spans = sentenceSpans(passage), at = hits[0];
  const s = spans.find(x => x.start <= at.start && at.end <= x.end + 1);
  return s ? { sentence: s.text, offset: at.start - s.start, value, passage } : { error: 'no-sentence' };
}
// the table of the doc: a row of "Property | Condition | Value" or CSV is the document's own result
const TABLE_ROW = /(?:\|.*\||^"[^"]+","[^"]+",)/;

export function solveS2(state) {
  const loc = locate(state);
  if (!loc || loc.error) return undecided(loc?.error ?? 'no-value');
  const { sentence, value } = loc, V = esc(value);
  if (INJECTION_CUE.test(sentence)) return decided('instruction_like', 'injection sentence');
  for (const t of PREDICTED) if (compile(t, V).test(sentence)) return decided('projected', 'prediction template');
  for (const t of QUOTED) if (compile(t, V).test(sentence)) return decided('quoted', 'attribution template');
  // two values: the asked value in the quoted slot, or in the document's own slot
  for (const t of QUOTE_OWN) {
    const asQuoted = new RegExp(`^${t.replace('{V1}', V).replace('{V2}', '.+?')}$`, 's'), asOwn = new RegExp(`^${t.replace('{V2}', `(?:.*?)${V}(?:.*?)`).replace('{V1}', '.+?')}$`, 's');
    if (asQuoted.test(sentence)) return decided('quoted', 'quote-and-own sentence (quoted slot)');
    if (asOwn.test(sentence)) return decided('own_measurement', 'quote-and-own sentence (own slot)');
  }
  // a prediction / attribution cue the templates do not cover: not decidable here
  if (PREDICTION.test(sentence)) return undecided('prediction cue outside the templates');
  const stripped = sentence.replace(OWN_LEAD, '');
  if (ATTRIBUTION.test(stripped)) return undecided('attribution cue outside the templates');
  if (TABLE_ROW.test(sentence)) return decided('own_measurement', 'result table row');
  return decided('own_measurement', 'no attribution, no prediction');
}

// ---- value expressions (X8) ---------------------------------------------------------------------------------------------------------------
// The values of one property that a line writes, as [{ text, value, unit, start, end }]: a number with one of the property's unit symbols or
// words, the central value of "lo-hi unit (mean m unit)" and of a list of three replicates, "n ± s unit", "n(u) unit" and "H h M min".
// Independent of the tap (which enumerates what the bed writes from the world): this reads only the text.
const NUM = '(?:[−-]?\\d[\\d,]*(?:\\.\\d+)?(?:e[−-]?\\d+)?|\\d+(?:\\.\\d+)? × 10(?:\\^[−-]?\\d+|[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+))';
const num = t => {
  const s = String(t).replace('−', '-');
  const m = /^(-?[\d.]+) × 10\^?(.+)$/.exec(s);
  if (m) { const e = m[2].replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]/g, c => ({ '⁻': '-', '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' })[c]); return Number(m[1]) * 10 ** Number(e); }
  return Number(s.replace(/,/g, ''));
};
export function valueExpressions(line, prop) {
  const text = String(line), out = [], taken = [];
  const free = (a, b) => !taken.some(([x, y]) => a < y && x < b);
  const add = (m, v, unitId, text0 = m[0]) => { const a = m.index, b = a + m[0].length; if (!free(a, b)) return; taken.push([a, b]); out.push({ text: text0, value: v, unit: unitId, start: a, end: b }); };
  const units = unitsOf(prop), syms = u => [...new Set([...u.sym, ...u.w])].sort((a, b) => b.length - a.length);
  const left = '(?<![\\p{L}\\p{N}_.,])';
  for (const u of units) for (const s of syms(u)) {
    const S = esc(s), tail = '(?![\\p{L}\\p{N}_])';
    for (const m of text.matchAll(new RegExp(`${left}(${NUM}), (${NUM}) and (${NUM}) ${S} (?:\\(three replicates\\)|in three replicate runs)`, 'gu'))) add(m, (num(m[1]) + num(m[2]) + num(m[3])) / 3, u.id);
    for (const m of text.matchAll(new RegExp(`${left}(${NUM})–(${NUM}) ${S} \\(mean (${NUM}) ${S}\\)`, 'gu'))) add(m, num(m[3]), u.id);
  }
  for (const m of text.matchAll(/(?<![\p{L}\p{N}_.,])(\d+) h (\d+) min(?![\p{L}\p{N}_])/gu)) if (['doubling time', 'plasma half-life'].includes(prop)) {
    const mins = Number(m[1]) * 60 + Number(m[2]), u = units.find(x => x.id === 'min') ?? units.find(x => x.id === 'h');
    add(m, u.id === 'min' ? mins : mins / 60, u.id);
  }
  for (const u of units) for (const s of syms(u)) {
    const S = esc(s), tail = '(?![\\p{L}\\p{N}_])';
    for (const m of text.matchAll(new RegExp(`${left}(${NUM})\\((\\d+)\\) ${S}${tail}`, 'gu'))) add(m, num(m[1]), u.id);
    for (const m of text.matchAll(new RegExp(`${left}(${NUM}) ± ${NUM} ${S}${tail}`, 'gu'))) add(m, num(m[1]), u.id);
    for (const m of text.matchAll(new RegExp(`${left}(${NUM}) ${S}${tail}`, 'gu'))) add(m, num(m[1]), u.id);
  }
  return out.sort((a, b) => a.start - b.start);
}
const NEW_CUE = /(?:correct value is|should read|replaced by|correct entry is|should have been reported as|measured value is|\bread|right figure is)\s*$/;
const canonOf = (prop, e) => toCanon(prop, e.value, e.unit);
export function propertyOfField(field) { const f = String(field); return PROPERTIES.find(p => f === p || f.startsWith(`${p} in `)) ?? null; }
// X8: is the extracted value what the source line says, in the property's canonical unit?
export function solveX8(state) {
  const prop = propertyOfField(state.field);
  if (!prop) return undecided('field names no property');
  const x = Number(String(state.extracted_value).replace(/,/g, ''));
  if (!Number.isFinite(x)) return undecided('extracted value is not a number');
  const exprs = valueExpressions(state.source_line, prop);
  let target;
  if (exprs.length === 2 && /\b(?:published version|Correction|transcription error|should (?:read|have been)|incorrect|wrong|erro|instead of|rather than)/i.test(state.source_line)) {
    const marks = exprs.map(e => NEW_CUE.test(state.source_line.slice(Math.max(0, e.start - 45), e.start)));
    if (marks.filter(Boolean).length !== 1) return undecided('erratum line: no single corrected value');
    target = exprs[marks.findIndex(Boolean)];
  } else if (exprs.length === 1) target = exprs[0];
  else return undecided(exprs.length ? 'several values of the property in the line' : 'no value of the property in the line');
  const expected = canonOf(prop, target);
  return decided(Math.abs(x - expected) <= 0.01 * Math.abs(expected) ? 'consistent' : 'inconsistent', 'canonical value from the unit table');
}

// ---- X5: the authored statements against the prompt windows ----------------------------------------------------------------------------------
const POLICY_OF = (() => {
  const m = new Map();
  for (const [p, list] of Object.entries(X5_POLICY)) for (const c of list) for (const lead of X5_POLICY_LEADS) m.set(lead + c, p);
  return m;
})();
const COND_FRAME_RE = X5_COND_FRAMES.map(f => new RegExp(`^${esc(f).replace('\\{prop\\}', '(?<prop>.+?)').replace('\\{cond\\}', '(?<cond>.+)')}$`, 's'));
export function parseAssumption(text) {
  const t = String(text).trim();
  if (POLICY_OF.has(t)) return { kind: 'policy', policy: POLICY_OF.get(t) };
  for (const re of COND_FRAME_RE) {
    const m = re.exec(t);
    if (m && PROPERTIES.includes(m.groups.prop)) {
      const C = CONDITIONS[m.groups.prop], cond = m.groups.cond;
      if (C.std.includes(cond)) return { kind: 'condition', property: m.groups.prop, std: true };
      if (C.nonstd.includes(cond)) return { kind: 'condition', property: m.groups.prop, std: false };
    }
  }
  return null;
}
export function solveX5(state, { assumption }) {
  const a = parseAssumption(assumption);
  if (!a) return undecided('assumption outside the authored statements');
  const text = String(state.source_text);
  if (a.kind === 'policy') {
    const here = Object.entries(POLICY_TEXT).find(([, t]) => text.includes(t));
    if (!here) return decided('not_stated', 'the window holds no ranking bullet');
    return decided(here[0] === a.policy ? 'holds' : 'violated', 'ranking bullet');
  }
  const line = text.split('\n').find(l => l.startsWith(`- ${a.property}: `));
  if (!line) return decided('not_stated', 'the window has no standard condition for the property');
  return decided(a.std ? 'holds' : 'violated', 'standard condition line');
}

// ---- S3: a stated condition against the property's standard condition -----------------------------------------------------------------------
const toCelsius = (v, u) => (u === '°C' ? v : u === 'K' ? v - 273.15 : (v - 32) * 5 / 9);
export function firstTemperature(text) {
  const m = /(−|-)?(\d+(?:\.\d+)?) ?(°C|°F|K)\b/.exec(text);
  return m ? toCelsius((m[1] ? -1 : 1) * Number(m[2]), m[3]) : null;
}
export function solveS3(state) {
  const prop = state.property, stated = String(state.stated_condition).trim(), C = COND_PARTS[prop], F = CONDITIONS[prop];
  if (!C) return undecided('unknown property');
  if (F.std.includes(stated) || (C.fixed?.[0] ?? []).includes(stated)) return decided('yes', 'fixed standard phrase');
  if (F.nonstd.includes(stated) || (C.fixed?.[1] ?? []).includes(stated)) return decided('no', 'fixed non-standard phrase');
  let deviates = 0;
  for (const [name, [stdOpts, devOpts]] of Object.entries(C.parts)) {
    if (name === 'temp') {
      const t = firstTemperature(stated);
      if (t === null) return undecided('no temperature');
      const near = list => list.some(x => Math.abs(x - t) <= 0.8);
      if (near(devOpts)) deviates++; else if (!near(stdOpts)) return undecided('temperature outside the lists');
      continue;
    }
    const opts = [...devOpts.map(o => [o, true]), ...stdOpts.map(o => [o, false])].filter(([o]) => o !== '').sort((a, b) => b[0].length - a[0].length);
    const hit = opts.find(([o]) => stated.includes(o));
    if (hit) { if (hit[1]) deviates++; } else if (!stdOpts.includes('')) return undecided(`no ${name} option`);
  }
  return decided(deviates ? 'no' : 'yes', 'part-by-part reading');
}

// ---- S4: a salt, hydrate, doped, composite, porous or mutant form of the entity -------------------------------------------------------------------
const formRe = (list, name = '[^.;,()]+?') => list.flat().map(f => new RegExp(esc(f).replace('\\{n\\}', name)));
const VARIANT_RES = formRe(Object.values(VARIANT_FORMS)), UNMODIFIED_RES = formRe(Object.values(UNMODIFIED_FORMS));
export function solveS4(state) {
  const p = String(state.passage);
  if (VARIANT_RES.some(re => re.test(p))) return decided('modified', 'variant phrase');
  if (UNMODIFIED_RES.some(re => re.test(p))) return decided('unmodified', 'explicitly the entity itself');
  return decided('unmodified', 'no variant phrase');
}

// ---- S5: the code table (catalog TYPE_LABELS) --------------------------------------------------------------------------------------------------
export function solveS5(state) {
  const k = KIND_OF_TYPE.get(String(state.type_label).trim());
  return k ? decided(k, 'TYPE_LABELS') : undecided('type label outside the table');
}

// ---- X1 (synth) ---------------------------------------------------------------------------------------------------------------------------------
// pool: the authored lines [{text, label}] the rows were composed from (train pool, held-out store lines); the bed's own text decides by its pattern
export function solveX1(state, { pool = [] } = {}) {
  const t = String(state.text);
  if (INJECTION_CUE.test(t)) return decided('yes', 'the bed\'s injection sentence');
  const hits = new Set(pool.filter(l => t.includes(l.text)).map(l => l.label));
  if (hits.has('yes')) return decided('yes', hits.size > 1 ? 'authored injection line (its neighbour is a pool "no" line, e.g. a bed noise sentence)' : 'authored line');
  if (hits.size) return decided('no', 'authored line');
  return decided('no', 'no instruction pattern');
}

// ---- X2 (synth): references to one entity or two ------------------------------------------------------------------------------------------------
export function solveX2(state) {
  const a = String(state.a), b = String(state.b), c = String(state.context);
  if (a === b) return decided('same', 'identical references');
  const maps = (x, y) => [`${x} (${y})`, `${x} (code ${y})`, `${x} (now named ${y})`, `previously referred to as ${x} is named ${y}`].some(p => c.includes(p));
  return decided(maps(a, b) || maps(b, a) ? 'same' : 'different', 'code-mapping sentence');
}

// ---- X4 (synth): is the statement's document superseded -----------------------------------------------------------------------------------------
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export function isoDates(text) {
  const out = [], t = String(text);
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.push(`${m[1]}-${m[2]}-${m[3]}`);
  const mi = name => String(MONTHS.findIndex(x => x.startsWith(name.toLowerCase().slice(0, 3))) + 1).padStart(2, '0');
  for (const m of t.matchAll(/\b(\d{1,2}) ([A-Z][a-z]+) (\d{4})\b/g)) if (MONTHS.some(x => x.startsWith(m[2].toLowerCase().slice(0, 3)))) out.push(`${m[3]}-${mi(m[2])}-${String(m[1]).padStart(2, '0')}`);
  for (const m of t.matchAll(/\b([A-Z][a-z]+) (\d{1,2}), (\d{4})\b/g)) if (MONTHS.some(x => x.startsWith(m[1].toLowerCase().slice(0, 3)))) out.push(`${m[3]}-${mi(m[1])}-${String(m[2]).padStart(2, '0')}`);
  for (const m of t.matchAll(/\b(\d{4}) ([A-Z][a-z]{2}) (\d{1,2})\b/g)) if (MONTHS.some(x => x.startsWith(m[2].toLowerCase()))) out.push(`${m[1]}-${mi(m[2])}-${String(m[3]).padStart(2, '0')}`);
  return out;
}
const SUPERSEDES = /replaces version 1|supersedes the version first posted|first version posted|Version 2, replacing|is replaced by it|Supersedes the .+? posting|replaces revision 1|it supersedes the entry|replaces the memo of|supersedes the revision 1 entry|which it supersedes|this article supersedes it|has been superseded by the present article|which it replaces|is superseded by this article/;
const SELF_SUPERSEDED = /this version is superseded|has been superseded by its published journal version|is replaced by that article|this preprint was superseded/;
export function solveX4(state) {
  const date = isoDates(state.source?.date ?? '')[0], related = (state.related_statements ?? []).map(String);
  if (related.some(r => SELF_SUPERSEDED.test(r))) return decided('superseded', 'the document says it is superseded');
  for (const r of related) {
    if (!SUPERSEDES.test(r)) continue;
    const ds = isoDates(r);
    if (ds.length) return decided(ds.includes(date) ? 'superseded' : 'binding', 'dated supersession sentence');
    const y = String(state.source?.date ?? '').match(/\d{4}/)?.[0];
    if (y && new RegExp(`\\b${y}\\b`).test(r)) return decided('superseded', 'supersession sentence naming the year');
    return decided('binding', 'supersession sentence of another document');
  }
  return decided('binding', 'no supersession sentence');
}

// ---- S1 (synth): which candidate document does the notice refer to ------------------------------------------------------------------------------
const descOf = d => { const m = /^(.*?) — (.*), ([^,]+(?:, [^,]+)?), ([^,]+)$/.exec(d); return m ? { title: m[1], authors: m[2], venue: m[3], date: m[4] } : null; };
export function solveS1(state, { options, optionDescriptions }) {
  const text = String(state.notice.text), dates = isoDates(text), years = [...text.matchAll(/\b(19|20)\d{2}\b/g)].map(m => m[0]);
  const scores = options.map(o => {
    const d = optionDescriptions[o], parts = d.split(' — '), title = parts[0], rest = parts.slice(1).join(' — ');
    const segs = rest.split(', ');
    const date = segs[segs.length - 1], venue = segs.slice(-3, -1).join(', ').replace(/^.*?, (?=.*group)/, ''), authors = segs.slice(0, -2).join(', ') || segs[0];
    const first = (authors.split(', ')[0] ?? '').trim().split(' ').pop();
    const venueTail = venue.includes(',') ? venue.split(', ').pop() : venue;
    const di = isoDates(date)[0];
    let sc = 0;
    const titleHit = text.includes(`"${title}"`);
    if (titleHit) sc += 3;
    if (first && new RegExp(`\\b${esc(first)}\\b`).test(text)) sc += 1;
    if (venueTail && text.includes(venueTail)) sc += 1;
    if (di && dates.includes(di)) sc += 2; else if (di && years.includes(di.slice(0, 4))) sc += 0.5;
    return { o, sc, titleHit };
  });
  const best = Math.max(...scores.map(s => s.sc)), top = scores.filter(s => s.sc === best);
  if (top.length !== 1 || best < 3) return undecided('no single best candidate');
  return decided(top[0].o, 'reference details');
}
export function solveS1Present(state, args) {
  const r = solveS1(state, args);
  if (r.label === null) return r;
  // a full reference ("Title" by Authors (Venue, Date)) must agree with the best candidate in every detail: a title can recur
  const text = String(state.notice.text), m = /"([^"]+)" by (.+?) \((.+), ([^,()]+)\)/.exec(text);
  if (m) {
    const d = args.optionDescriptions[r.label], first = (d.split(' — ')[1] ?? '').split(', ')[0].trim().split(' ').pop();
    const date = isoDates(d.split(', ').pop())[0], refDates = isoDates(m[4]);
    const ok = new RegExp(`\\b${esc(first)}\\b`).test(m[2]) && (!refDates.length || refDates.includes(date)) && d.includes(m[3].replace(/^internal memo, /, ''));
    return decided(ok ? 'yes' : 'no', 'full reference against the best candidate');
  }
  return decided('yes', 'best candidate');
}

// ---- X7 (synth): does the document hold a claim on the asked cell -------------------------------------------------------------------------------
// slots: { property, names: [entity name, code] } read from the sub-question the way a node would pass them
export function solveX7(state, { property, names }) {
  const t = String(state.item).toLowerCase();
  const ent = names.some(n => t.includes(String(n).toLowerCase()));
  const prop = PROP_FORMS[property].names.some(n => t.includes(n.toLowerCase()));
  return decided(ent && prop ? 'needed' : 'not_needed', 'entity and property mentioned');
}

// ---- audit helpers (shared shape with solve/kinetics.mjs) -----------------------------------------------------------------
export function audit(rows, solver, { slotsOf = () => ({}) } = {}) {
  let decidedN = 0, agree = 0; const wrong = [], und = {};
  for (const r of rows) {
    const out = solver(r.state, slotsOf(r));
    if (out.label === null) { und[out.reason] = (und[out.reason] ?? 0) + 1; continue; }
    decidedN++;
    if (out.label === r.label) agree++; else wrong.push({ id: r.id, solved: out.label, truth: r.label, basis: out.basis });
  }
  return { rows: rows.length, decided: decidedN, agree, accuracy: decidedN ? agree / decidedN : null, coverage: rows.length ? decidedN / rows.length : null, wrong, undecided: und };
}
// §2.7 step 2: group rows by skeleton(state) + question + slots; the share of groups with more than one label. The asked
// value of S2/S4 is a pointer into the passage, not a surface (the skeleton masks its digits): the pointer is the value's
// position in the passage and is part of the key, so two values of one sentence (a quoted and the document's own) are two
// groups; X8's extracted value is a slot filling and stays unmasked in the key.
const pointerOf = s => (typeof s.passage === 'string' && typeof s.value === 'string' ? s.passage.indexOf(s.value) : typeof s.extracted_value === 'string' ? s.extracted_value : '');
export function collisions(rows, { exact = false, pointer = pointerOf } = {}) {
  const groups = new Map();
  for (const r of rows) {
    const rest = { ...r.state }; delete rest.value; delete rest.extracted_value;
    const sk = exact ? JSON.stringify(r.state) : stringLeaves(rest).map(l => skeletonText(l.text, r.masks ?? {})).join(' | '), key = `${sk}|${r.question}|${JSON.stringify(r.slots ?? {})}|${exact ? '' : pointer(r.state)}`;
    const g = groups.get(key) ?? { labels: new Set(), n: 0, example: r.id };
    g.labels.add(r.label); g.n++; groups.set(key, g);
  }
  const mixed = [...groups.values()].filter(g => g.labels.size > 1);
  return { groups: groups.size, mixed: mixed.length, share: groups.size ? mixed.length / groups.size : 0, examples: mixed.slice(0, 5).map(g => g.example) };
}
export { unitsOf, toCanon, relDiff, PROP_FORMS, PROPERTIES, kindOfType, normaliseTemperatures, unit };
