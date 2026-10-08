// Catalog-aware "ceiling" attacker for the synth bed (audit step 5, the white-box tier).
//
// It reads only task.prompt and task.inputs, like a solver would, but it knows the generator's vocabulary (property
// names, unit spellings, condition phrases, entity-code patterns) and the sentence templates of every family. It is
// NOT a 40-line heuristic: about 400 lines (33k characters), written and tuned over several hours against dev seeds. Its purpose is
// twofold. (1) Witness: a completely independent reading of the corpus reproduces the oracle's truth (cell accuracy
// 0.99 at difficulty 3), so the rendered text really conveys the truth. (2) Ceiling: what a determined script that
// has the generator's source can reach. Measured pass rates are in AUDIT.md; see README "Limits" for what they mean.
//
// Exports: ceilingAnswer(task) -> output JSON; ceilingSolve(task) -> extracted claims, voids and corrections.
import { PROPS, MONTHS, COND } from './catalog.mjs';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const toInt = w => (WORDS.includes(String(w).toLowerCase()) ? WORDS.indexOf(String(w).toLowerCase()) : Number(w));
const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const MONRE = MONTHS.join('|');
const DATE_RE = `\\d{4}-\\d\\d-\\d\\d|\\d{1,2} (?:${MONRE}) \\d{4}|(?:${MONRE}) \\d{1,2}, \\d{4}|\\d{4} [A-Z][a-z]{2} \\d{1,2}`;
const MON3 = MONTHS.map(m => m.slice(0, 3));
export function parseDate(s) {
  let m;
  if ((m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s))) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5;
  if ((m = /^(\d{1,2}) (\w+) (\d{4})$/.exec(s))) return Date.UTC(+m[3], MONTHS.indexOf(m[2]), +m[1]) / 864e5;
  if ((m = /^(\w+) (\d{1,2}), (\d{4})$/.exec(s))) return Date.UTC(+m[3], MONTHS.indexOf(m[1]), +m[2]) / 864e5;
  if ((m = /^(\d{4}) (\w{3}) (\d{1,2})$/.exec(s))) return Date.UTC(+m[1], MON3.indexOf(m[2]), +m[3]) / 864e5;
  return NaN;
}
const ymOf = day => { const d = new Date(day * 864e5); return [d.getUTCFullYear(), d.getUTCMonth()]; };

// ---- units --------------------------------------------------------------------------------------------
const UNITS = {};
for (const [p, P] of Object.entries(PROPS)) {
  UNITS[p] = [];
  for (const u of P.units) for (const t of [...u.sym, ...(u.w || []), u.id]) UNITS[p].push({ text: t, f: u.f, o: u.o });
  UNITS[p].sort((a, b) => b.text.length - a.text.length);
}
const NUM = '\\d[\\d,]*(?:\\.\\d+)?';
const SUPD = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const SCI = `${NUM}(?: × 10(?:⁻?[${SUPD}]+|\\^-?\\d+)|e-?\\d+)`;
const unitRe = p => `(${UNITS[p].map(u => esc(u.text)).join('|')})(?![\\w/·⁻²³])`;
const VALRE = {};
for (const p of Object.keys(PROPS)) VALRE[p] = new RegExp(`(?<![\\w.])(?:(\\d+) h (\\d+) min|(${SCI}|${NUM}) ${unitRe(p)})`, 'g');
const sciNum = s => {
  let m;
  if ((m = /^([\d.,]+) × 10(⁻?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/.exec(s))) return Number(m[1]) * 10 ** Number([...m[2]].map(c => (c === '⁻' ? '-' : SUPD.indexOf(c))).join(''));
  if ((m = /^([\d.,]+) × 10\^(-?\d+)$/.exec(s))) return Number(m[1]) * 10 ** Number(m[2]);
  if ((m = /^([\d.]+)e(-?\d+)$/.exec(s))) return Number(m[1]) * 10 ** Number(m[2]);
  return Number(s.replace(/,/g, ''));
};
const canonOf = (p, x, ut) => { const u = UNITS[p].find(v => v.text === ut); return x * u.f + u.o; };
const MEANRE = /[\d.,]+–[\d.,]+ (.+?) \(mean ([\d.,]+) \1\)/g;
const neutralise = s => s.replace(/([\d.]+), ([\d.]+) and ([\d.]+) (.+?)(?: \(three replicates\)| in three replicate runs)/g, (_, a, b, c, u) => `${(Number(a) + Number(b) + Number(c)) / 3} ${u}`).replace(MEANRE, '$2 $1').replace(/(\d)\((\d+)\)(?= \S)/g, '$1').replace(/ ± [\d.]+/g, '').replace(/ \(SD [\d.]+\)/g, '');
function valuesIn(p, s) {
  const out = [];
  for (const m of s.matchAll(VALRE[p])) {
    const canon = m[1] != null ? (p === 'doubling time' ? +m[1] * 60 + +m[2] : +m[1] + +m[2] / 60) : canonOf(p, sciNum(m[3]), m[4]);
    out.push({ canon, at: m.index, len: m[0].length });
  }
  return out;
}

// ---- conditions ---------------------------------------------------------------------------------------
const TEMPRE = /(−?\d+(?:\.\d+)?) (°C|K|°F)\b/g;
const tempsC = s => [...s.matchAll(TEMPRE)].map(m => { const x = Number(m[1].replace('−', '-')); return m[2] === '°C' ? x : m[2] === 'K' ? x - 273.15 : (x - 32) * 5 / 9; });
const WIN = { 'aqueous solubility': [24.5, 25.5], density: [19.5, 25.5], 'tensile strength': [19.5, 25.5], 'thermal conductivity': [21.5, 32], 'band gap': [16.5, 27], 'doubling time': [29.5, 30.5] };
const NONRE = {
  'aqueous solubility': /(?<!un)buffer|hydrochloric|saline|gastric|ethanol|DMSO|hydroxide/, 'melting point': /GPa|MPa|kbar|atm of|diamond/,
  'plasma half-life': /mice|rats|dogs|monkeys|minipigs|in vitro|microsomes|hepatocytes/, 'enzyme IC50': /whole-cell|cultured cells|cell-based|HEK293|whole blood/,
  density: /powder|foam|porosity|sintered|porous|partially/, 'tensile strength': /salt-spray|irradiated|cold-rolled|heat-aged/, 'thermal conductivity': /(?!)/,
  'band gap': /GPa|diamond/, 'doubling time': /minimal|M9|anaerobic|without oxygen/, 'genome size': /draft|pulsed-field|k-mer|cytometry|fragmented/,
  'cell length': /stationary|starvation|colonies|agar plates|filaments/, 'optimal growth temperature': /NaCl|agar plates|acidified/,
};
function isStd(p, c) {
  if (NONRE[p].test(c)) return false;
  if (p === 'optimal growth temperature') { const ph = /pH (\d+(?:\.\d+)?)/.exec(c); return !ph || (+ph[1] >= 6.5 && +ph[1] <= 7.5); }
  const w = WIN[p];
  return !w || tempsC(c).every(t => t >= w[0] && t <= w[1]);
}

const CONDPH = {};
for (const [p, C] of Object.entries(COND)) {
  const set = new Set();
  for (const [k, lists] of Object.entries(C.parts)) if (k !== 'temp') for (const l of lists) for (const x of l) if (x.trim().length >= 4) set.add(x.trim());
  for (const l of C.fixed || []) for (const x of l) set.add(x);
  for (const x of [...PROPS[p].std, ...PROPS[p].nonstd]) set.add(x);
  CONDPH[p] = [...set];
}
const hasCond = (p, t) => tempsC(t).length > 0 && p !== 'melting point' && p !== 'optimal growth temperature' || CONDPH[p].some(x => t.toLowerCase().includes(x.toLowerCase())) || /\bpH \d/.test(t);
const METHOD = [/starting from a [\d.]+ mg\/mL suspension/i, /at a heating rate of [\d.]+ °C per minute/i, /after a [\d.]+ h infusion/i, /in the presence of [\d.]+ µM ATP/i, /calibrated against a [\d.]+ g\/cm³ metal standard/i,
  /after a [\d.]+ MPa preload/i, /against a reference sample of [\d.]+ W\/\(m·K\)/i, /with [\d.]+ eV excitation/i, /after a [\d.]+ min lag phase/i, /from [\d.]+ kb long reads/i, /using [\d.]+ nm beads as a size standard/i, /with cultures pre-grown at [\d.]+ °C/i];
const PRED = /predicts|expected to be around|design target|Simulations put|Extrapolating|not measured|no measurement has|has not yet been measured|did not measure|not yet confirmed|confirmation is pending|Model estimates suggest|if the trend|forecast|We aim for|gives .* for the .*; we have not/i;
const INJ = /NOTE TO|System instruction|any language model/;
const BOUND = /\bbelow\b|\babove\b|did not exceed|\bexceeded\b|at least|detection limit|limit of quantification|greater than|off scale|highest level tested|upper limit of the assay/i;
const DECOYQ = /\s*\((?:sample stored at|after pre-equilibration at|instrument calibrated at|sample dried at|calibration standard|stock solution|plasma sampled for|last sample taken|reference inhibitor control at|compound pre-incubated at|check standard|reference steel checked at|reference foam checked at|spectra recorded up to|optical density read every|inoculum grown overnight at|contigs longer than|reads of|scale bar|calibration grid|block pre-heated to|stock kept at)(?:[^()]|\([^()]*\))*\)(?=\.)/gi;
const LABRE = '(?:Protocol|Series|Run|Condition set) (?:II|I|A|B|1|2)\\b';
const VAR = /hydrochloride|sodium salt|monohydrate|mesylate|dihydrate|-doped|composite|porous (?!foam form)|Δ(?:pilA|recA)|plasmid-cured|streptomycin-resistant|evolved descendant|foam$/;
const CONTRAST = [/Unlike our earlier attempt .*?, which gave no usable data,/, / instead of .*? and obtained/, / could not be determined .*?, but/, /^Rather than .*?, /, /^A first attempt .*? failed;/,
  /^Although the standard protocol calls for measurement .*?, /, /^No measurement .*? was possible; /];


// ---- template DSL -----------------------------------------------------------------------------------------
const PNALT = Object.values(PROPS).flatMap(P => P.names).concat(['IC50']).sort((a, b) => b.length - a.length).map(esc).join('|');
const PREP = '(?:in|at|by|under|for|using|from|during|on|against|based|as|with|of|after|estimated|via|following)';
function tpl(str, anchored = true) {
  const src = esc(str).replace(/\\\{(\w+)\\\}/g, (_, n) => {
    if (n === 'pn') return `(?:${PNALT})`;
    if (n === 'an') return '(?:an?)';
    if (n === 'hl') return '(?:higher|lower|above|below)';
    if (n === 'any') return '.+?';
    if (n === 'who') return "[A-Z][\\w-]+";
    if (n === 'year') return '\\d{4}';
    if (/^[CNS]p/.test(n)) return `(?<${n.replace('p', '')}>${PREP} .+?)`;
    if (/^[ECNSu]/.test(n) && !/^N\d/.test(n)) return `(?<${n}>.+?)`;
    if (/^N\d/.test(n)) return `(?<${n}>[\\d.,]+)`;
    if (/^V/.test(n)) return `⟦(?<${n}>\\d)⟧`;
    throw new Error(`placeholder ${n}`);
  });
  return new RegExp(anchored ? `^${src}$` : src, 'i');
}
const T_PAIR = ['The {pn} of {E} was {V1} {Cp1} and {V2} {Cp2}.', '{Cp2} the {pn} of {E} was {V2}, whereas {Cp1} it was {V1}.', '{pn} of {E}: {V1} ({Cp1}); {V2} ({Cp2}).',
  'While the {pn} of {E} {Cp1} was {V1}, {Cp2} it was {V2}.', '{Cp1} we found {V1} for the {pn} of {E}; {Cp2} the value was {V2}.', 'Changing the setting from "{Cp1}" to "{Cp2}" took the {pn} of {E} from {V1} to {V2}.',
  '{E} was run twice for the {pn}: {Cp1} ({V1}) and {Cp2} ({V2}).', 'The {pn} of {E} came to {V2} {Cp2} but {V1} {Cp1}.'].map(tpl);
const T_CMP = ['{Cp}, the {pn} was {V1} for {E1} and {V2} for {E2}.', 'The {pn} of {E1} {Cp} was {V1}, compared with {V2} for {E2}.', '{E1} and {E2} had {pn} values of {V1} and {V2}, respectively, {Cp}.',
  '{E1} gave {an} {pn} of {V1} {Cp}, against {V2} for {E2}.', 'We compared {E1} with {E2} {Cp}: the former had {an} {pn} of {V1}, the latter {V2}.', 'We compared {E2} with {E1} {Cp}: the latter had {an} {pn} of {V1}, the former {V2}.',
  '{pn} values ({u}) {Cp}: {N1} for {E1} and {N2} for {E2}.', '{Cp}: {E1} gave {V1}, {E2} {V2} ({pn}).', 'For {E1}, the {pn} {Cp} was {V1}; for {E2} it was {V2}.', '{E2} ({V2}) and {E1} ({V1}) were compared for {pn} {Cp}.',
  'The {pn} {Cp} was {V1} for {E1} versus {V2} for {E2}.', '{E1} reached {V1} and {E2} {V2} in terms of {pn} {Cp}.', 'Side by side {Cp}, {E1} showed {an} {pn} of {V1} and {E2} one of {V2}.',
  'Relative to {E2} ({V2}), {E1} gave {V1} {Cp} for the {pn}.', '{E2} had {V2} and {E1} had {V1} for the {pn} {Cp}.'].map(tpl);
const T_OWN = ['{who} et al. ({year}) reported {Vq} for the {pn} of {E} {Cp}; we obtained {Vo} under the same conditions.', 'Our {pn} for {E} {Cp}, {Vo}, is {hl} than the {Vq} reported by {who} and co-workers ({year}).',
  "Whereas {who}'s group found {Vq}, we measured {an} {pn} of {Vo} for {E} {Cp}.", 'We obtained {Vo} for the {pn} of {E} {Cp}; {who} et al. ({year}) had reported {Vq}.',
  'Contrary to {who} et al. ({year}), who gave {Vq}, we measured {Vo} for the {pn} of {E} {Cp}.', "{who}'s {year} value for the {pn} of {E} {Cp} was {Vq}; ours is {Vo}.",
  'We found {Vo} for the {pn} of {E} {Cp}, against {Vq} from {who} and colleagues ({year}).', 'Unlike the {Vq} of {who} et al. ({year}), our {pn} for {E} {Cp} came to {Vo}.',
  'The {pn} of {E} {Cp} was {Vo} here; {who} et al. ({year}) obtained {Vq}.', 'Our {Vo} for the {pn} of {E} {Cp} sits {hl} the {Vq} quoted from {who} et al. ({year}).'].map(tpl);
const T_ONE = ['Unlike our earlier attempt {Np}, which gave no usable data, the {pn} of {E} {Cp} was {V}.', 'We measured the {pn} of {E} {Cp} instead of {Np} and obtained {V}.',
  'The {pn} of {E} could not be determined {Np}, but {Cp} it came to {V}.', 'Rather than {Np}, the {pn} of {E} was measured {Cp}: {V}.', 'A first attempt {Np} failed; a repeat {Cp} gave {an} {pn} of {V} for {E}.',
  'A trial {Np} was abandoned; the {pn} of {E} {Cp} came to {V}.', 'The {pn} of {E} {Cp} was {V}; the same measurement {Np} did not give usable data.', 'Although we also tried {Np}, only the run {Cp} produced a result: {V} for the {pn} of {E}.',
  'We did not obtain {an} {pn} for {E} {Np}, but {Cp} it was {V}.', 'Although the standard protocol calls for measurement {Sp}, the {pn} of {E} was determined {Cp} and came to {V}.', 'No measurement {Sp} was possible; {Cp} the {pn} of {E} was {V}.',
  'The {pn} of {E} could not be measured {Sp}; {Cp} it was {V}.', 'Since a measurement {Sp} was not feasible, we determined the {pn} of {E} {Cp}: {V}.', 'Instead of measuring {Sp}, we measured the {pn} of {E} {Cp} and found {V}.'].map(tpl);
const ER_VAL = ['In the published version the {pn} of {E} {Cp} was given as {Vold}. The correct value is {Vnew}.', 'Owing to a transcription error, the {pn} of {E} {Cp} appears as {Vold}; it should read {Vnew}.',
  'The value of {Vold} given for the {pn} of {E} {Cp} is incorrect and should be replaced by {Vnew}.', 'Table 1 lists the {pn} of {E} {Cp} as {Vold}; the correct entry is {Vnew}.',
  'The {pn} of {E} {Cp} should have been reported as {Vnew} rather than {Vold}.', '{Vold} is wrong for the {pn} of {E} {Cp}; the measured value is {Vnew}.', 'For the {pn} of {E} {Cp}, read {Vnew} instead of {Vold}.',
  'A calculation error led to {Vold} being printed for the {pn} of {E} {Cp}; the right figure is {Vnew}.', 'For the genome size of {E} {Cp}, read {Vnew} instead of {Vold}.'].map(t => tpl(t, false));

// ---- main ----------------------------------------------------------------------------------------------
export function ceilingSolve(task, dbg = {}) {
  const docs = task.inputs.documents.map(d => ({ ...d })), P = task.prompt, requested = task.inputs.requested;
  const kindOf = d => (/press|news|media/i.test(d.type) ? 'press' : /preprint/i.test(d.type) ? 'preprint' : /notebook|memo|lab note/i.test(d.type) ? 'labnote'
    : /retraction|erratum|correction|corrigendum|concern/i.test(d.type) ? 'notice' : 'journal');
  for (const d of docs) { d.kind = kindOf(d); d.day = parseDate(d.date); d.lastNames = d.authors.split(', ').map(a => a.split(' ').pop()); }
  const byId = new Map(docs.map(d => [d.id, d]));
  const research = docs.filter(d => ['journal', 'preprint', 'labnote'].includes(d.kind));
  const all = docs.map(d => `${d.title} ${d.text}`).join(' \n ');
  // entities and codes
  const ents = [...new Set(requested.map(r => r.entity))].map(name => {
    const n = esc(name);
    const m = new RegExp(`${n} \\((?:code |isolate |now named )?([A-Z]{2}-\\d+)\\)|(?:isolate )?([A-Z]{2}-\\d+) \\((?:now named )?${n}\\)|referred to as (?:isolate )?([A-Z]{2}-\\d+) is named ${n}`, 'i').exec(all);
    return { name, code: m ? m[1] || m[2] || m[3] : null };
  });
  const entSrc = ents.map(e => `(?<![\\w-])(?:${esc(e.name)}${e.code ? `|(?:isolate )?${esc(e.code)}` : ''})(?![\\w-])`);
  const mentions = s => { const o = []; ents.forEach((e, i) => { for (const m of s.matchAll(new RegExp(entSrc[i], 'gi'))) o.push({ i, at: m.index, len: m[0].length }); }); return o.sort((a, b) => a.at - b.at); };
  const firstEnt = s => { const m = mentions(s); return m.length ? m[0].i : -1; };
  const ANA = /\b(?:the|this) (?:compound|material|isolate|strain|organism)\b/i;
  for (const d of docs) d.own = d.kind === 'notice' ? -1 : firstEnt(d.title);

  const propsIn = s => Object.keys(PROPS).filter(p => PROPS[p].names.some(n => s.toLowerCase().includes(n.toLowerCase().replace(/ \(ic50\)$/, '').replace('half-maximal inhibitory concentration', 'ic50'))));
  const propOfName = nm => Object.keys(PROPS).find(p => PROPS[p].names.some(n => n.toLowerCase() === nm.toLowerCase()));
  // ---- references ---------------------------------------------------------------------------------------
  const authorsMatch = (d, short) => (short.endsWith(' et al.') ? d.lastNames[0] === short.slice(0, -7) && d.lastNames.length > 2
    : d.lastNames.length === short.split(' and ').length && short.split(' and ').every((x, i) => d.lastNames[i] === x));
  const venueOk = (d, v) => (v.startsWith('internal memo, ') ? d.kind === 'labnote' && d.venue.endsWith(v.slice(15)) : d.venue === v);
  const entOk = (d, str) => new RegExp(`(?<![\\w-])${esc(str)}(?![\\w-])`, 'i').test(`${d.title} ${d.text.slice(0, 400)}`);
  function refDocs(text) {
    let m;
    if ((m = /\[document (D\d+)\]/.exec(text))) return [byId.get(m[1])].filter(Boolean);
    if ((m = /^"([^"]+)" by ([^()]+?) \(((?:internal memo, )?[^,()]+), ([^()]+)\)/.exec(text))) {
      const day = parseDate(m[4]);
      return research.filter(d => d.title === m[1] && authorsMatch(d, m[2]) && venueOk(d, m[3]) && d.day === day);
    }
    if ((m = new RegExp(`^[Tt]he (\\w+) (\\d{4}) (?:article|paper|preprint) by (\\S+) and colleagues in (.+?) on the (${Object.values(PROPS).flatMap(P => P.names).map(esc).join('|')}) of (.+)$`).exec(text))) {
      const [y, mo] = [+m[2], MONTHS.indexOf(m[1])];
      return research.filter(d => { const [dy, dm] = ymOf(d.day); return dy === y && dm === mo && d.lastNames[0] === m[3] && venueOk(d, m[4]) && entOk(d, m[6]) && propsIn(d.text).includes(propOfName(m[5])); });
    }
    if ((m = /^[Tt]he (?:article|paper|preprint|memo) by ((?:[A-Z]\. )+[A-Z][\w-]+) and co-authors \(((?:internal memo, )?[^,()]+), ([^()]+)\)/.exec(text))) {
      const day = parseDate(m[3]);
      return research.filter(d => d.authors.split(', ')[0] === m[1] && venueOk(d, m[2]) && d.day === day);
    }
    if ((m = /^([A-Z][\w-]+(?: et al\.| and [A-Z][\w-]+)) \((\d{4}), ((?:internal memo, )?[^()]+)\)$/.exec(text))) return research.filter(d => authorsMatch(d, m[1]) && ymOf(d.day)[0] === +m[2] && venueOk(d, m[3]));
    if ((m = /^"([^"]+)"$/.exec(text))) return research.filter(d => d.title.toLowerCase() === m[1].toLowerCase());
    if ((m = /^([A-Z][\w-]+)'s (\d{4}) (?:article|paper|preprint|memo) on (.+)$/.exec(text))) {
      return research.filter(d => d.lastNames[0] === m[1] && ymOf(d.day)[0] === +m[2] && entOk(d, m[3]));
    }
    return [];
  }
  const ENTTAIL = '(?:(?:isolate )?[A-Z]{2}-\\d+|[A-Z][a-z]+ [a-z]+|[a-z]+)';
  const REFSRC = `("[^"]+" by [^()]+? \\([^()]*\\)(?: \\[document D\\d+\\])?|[Tt]he \\w+ \\d{4} \\w+ by \\S+ and colleagues in [^.;]+? on the (?:${PNALT}) of ${ENTTAIL}|[Tt]he \\w+ by (?:[A-Z]\\. )+[A-Z][\\w-]+ and co-authors \\([^()]*\\)|[A-Z][\\w-]+'s \\d{4} \\w+ on ${ENTTAIL}|[A-Z][\\w-]+(?: et al\\.| and [A-Z][\\w-]+) \\(\\d{4}, [^()]+\\)|"[^"]+"(?! by))`;
  const REFRE = new RegExp(REFSRC);

  const voidIds = new Set(), valueFix = [], nFix = new Map();
  for (const d of docs) {
    const T = d.text;
    if (d.kind === 'notice') {
      const rf = REFRE.exec(T)?.[1];
      const tg = rf ? refDocs(rf) : [];
      if (/retract/i.test(d.type)) tg.forEach(x => voidIds.add(x.id));
      else if (/erratum|correction|corrigendum/i.test(d.type) && tg.length === 1) {
        const after = T.slice(T.indexOf(rf) + rf.length);
        const m = /(?:made on|misreported as|stated incorrectly as) (\w+)[^;]*; (?:the correct number is|all values are in fact based on|the data come from) (\w+)/.exec(after) || /n should read (\w+), not (\w+)/.exec(after) && [0, 0, /n should read (\w+)/.exec(after)[1]]
          || /"(\w+) [\w ]+" should be "(\w+) [\w ]+"/.exec(after);
        if (m) nFix.set(tg[0].id, toInt(m[2])); else valueFix.push({ target: tg[0].id, after });
      }
      continue;
    }
    // banner on an old preprint
    if (/^\[.*?(?:this version is superseded|superseded by its published|replaced by that article|was superseded when)/.test(T)) voidIds.add(d.id);
    // a newer version naming the older one by date
    if (d.kind !== 'journal') {
      for (const m of T.matchAll(new RegExp(`(?:supersede[sd]?|replac\\w+)\\b[^.;\\[\\]]{0,70}?(${DATE_RE})|the one of (${DATE_RE}) is replaced|first version posted (${DATE_RE})`, 'gi'))) {
        const day = parseDate(m[1] || m[2] || m[3]);
        research.filter(x => x !== d && x.venue === d.venue && x.day === day).forEach(x => voidIds.add(x.id));
      }
    }
    // a journal version naming the preprint it supersedes
    for (const m of T.matchAll(new RegExp(REFSRC, 'g'))) {
      const before = T.slice(0, m.index), inBracket = before.lastIndexOf('[') > before.lastIndexOf(']');
      const ctxt = T.slice(Math.max(0, m.index - 70), m.index + m[0].length + 60);
      if (!inBracket && /supersed|replaces/.test(ctxt)) refDocs(m[0]).filter(x => x.id !== d.id).forEach(x => voidIds.add(x.id));
    }
  }

  // ---- claims ----------------------------------------------------------------------------------------------
  const claims = [];
  const MARK = i => `⟦${i}⟧`;
  for (const d of docs) {
    if (d.kind === 'notice' || voidIds.has(d.id)) continue;
    let defCond = '';
    const dm = /(?:Unless stated otherwise, all measurements below were made|Measurements were carried out) (.+?)(?: unless noted otherwise)?\.(?: |$)/.exec(d.text);
    if (dm) defCond = dm[1];
    let text = d.text;
    // results tables (pipe or CSV)
    text = text.replace(/\n(Table \d[.:] [^\n]*)\n((?:(?:[^\n]* \| [^\n]*|"[^\n]*",[^\n]*|property,condition,value,unit)\n)+)/g, (_, cap, rowsTxt) => {
      const rows = rowsTxt.trim().split('\n'), head = rows.shift(), ei = firstEnt(cap);
      for (const row of rows) {
        let pnT, C, vT;
        if (head.startsWith('property,')) { const m = /^"([^"]*)","([^"]*)",([^,]*),(.*)$/.exec(row); if (!m) continue; [pnT, C, vT] = [m[1], m[2], `${m[3]} ${m[4]}`]; }
        else { const c = row.split(' | '); if (head.startsWith('Condition')) [C, pnT, vT] = c; else [pnT, C, vT] = [c[0], c[1], c.length === 4 ? `${c[2]} ${c[3]}` : c[2]]; }
        const p = propsIn(pnT)[0], vv = p && valuesIn(p, neutralise(vT))[0];
        if (vv && ei >= 0) claims.push({ doc: d.id, ent: ei, prop: p, canon: vv.canon, std: isStd(p, C) });
      }
      return ' ';
    });
    // named protocols: definitions are removed, labels are replaced by the condition they stand for
    text = text.replace(/Conditions: (?=(?:Protocol|Series|Run|Condition set) )/g, '').replace('Two protocols were used. ', '');
    const defs = new Map();
    text = text.replace(new RegExp(`(${LABRE})(?:: | means | — )(${PREP} .+?)(?=[.;](?:\\s|$))[.;]?`, 'g'), (_, l, c) => { defs.set(l, c); return ' '; });
    const raw = text.split(/(?<=[.!?])\s+(?=[A-Z"\[0-9])/), sents = [];
    for (const x of raw) {
      // a value sentence that names no property continues the previous sentence ("... was measured last. It was 4.66 µm.")
      if (sents.length && !propsIn(x).length && propsIn(sents[sents.length - 1]).length === 1 && /^(?:It|The (?:result|outcome))\b/.test(x)) sents[sents.length - 1] += ` ${x}`; else sents.push(x);
    }
    let prevS = '';
    for (const s00 of sents) {
      let s0 = (defs.size ? s00.replace(new RegExp(LABRE, 'g'), l => defs.get(l) ?? l) : s00).replace(DECOYQ, '');
      // "Its ..." refers to the entity of the previous sentence
      if (/^Its\b|\bfor its\b/.test(s0)) { const pe = firstEnt(prevS); if (pe < 0) { prevS = s0; continue; } s0 = s0.replace(/^Its\b/, `The ${ents[pe].name}'s`.replace(/^The /, '')).replace(/\bfor its\b/, `for ${ents[pe].name}'s`); }
      prevS = s0;
      if (INJ.test(s0) || PRED.test(s0)) continue;
      const ps = propsIn(s0);
      if (!ps.length) continue;
      if (/^Results \(quantity \| condition \| value\):/.test(s0)) {
        for (const row of s0.replace(/^[^:]+: /, '').replace(/\.$/, '').split('; ')) {
          const [q, c, v] = row.split(' | ');
          const p = propsIn(q)[0]; if (!p) continue;
          const ei = firstEnt(q) >= 0 ? firstEnt(q) : ANA.test(q) ? d.own : -1;
          const vv = valuesIn(p, neutralise(v))[0];
          if (vv && ei >= 0 && !VAR.test(q)) claims.push({ doc: d.id, ent: ei, prop: p, canon: vv.canon, std: isStd(p, c) });
        }
        continue;
      }
      const p = ps[0];
      let s = neutralise(s0);
      for (const re of METHOD) s = s.replace(re, ' ');
      if (VAR.test(s)) continue;
      let m7;
      if ((m7 = /^.*? values \((.+?)\) (.+?): ([\d.,]+) for (.+?) and ([\d.,]+) for (.+)\.$/.exec(s))) {
        const a = firstEnt(m7[4]) >= 0 ? firstEnt(m7[4]) : -1, b = firstEnt(m7[6]);
        const u = UNITS[p].find(x => x.text === m7[1]);
        if (u) { const [va, vb] = [Number(m7[3].replace(/,/g, '')), Number(m7[5].replace(/,/g, ''))]; if (a >= 0) claims.push({ doc: d.id, ent: a, prop: p, canon: va * u.f + u.o, std: isStd(p, m7[2]) }); else if (b >= 0) claims.push({ doc: d.id, ent: b, prop: p, canon: vb * u.f + u.o, std: isStd(p, m7[2]) }); }
        continue;
      }
      const vals = valuesIn(p, s);
      if (!vals.length) continue;
      // number the values
      let marked = '', last = 0;
      vals.forEach((v, i) => { marked += s.slice(last, v.at) + MARK(i); last = v.at + v.len; });
      marked += s.slice(last);
      const emit = (valIdx, entIdx, cond) => { if (entIdx >= 0 && vals[valIdx]) claims.push({ doc: d.id, ent: entIdx, prop: p, canon: vals[valIdx].canon, std: isStd(p, cond) }); };
      const entOf = str => (firstEnt(str) >= 0 ? firstEnt(str) : ANA.test(str) ? d.own : -1);
      let m;
      const rest = (str, ...drop) => { let r = str.replace(/⟦\d⟧/g, ' '); for (const x of drop) r = r.replace(x, ' '); return r; };
      // template families: own+quoted, comparison, pair, decoy-bearing single-value forms
      const tryT = (list, fn) => { for (const re of list) { const g = re.exec(marked)?.groups; if (g) { fn(g); return true; } } return false; };
      if (tryT(T_OWN, g => emit(+g.Vo, entOf(g.E), g.C))) continue;
      if (BOUND.test(s0)) continue;
      if (/\bet al\.|and (?:co-workers|colleagues|co-authors)|'s group|Literature value|\(\d{4}\)|set against|quoted|in the literature/.test(marked) && !/(?:protocol|method) of [A-Z]/.test(marked)) continue;
      if (tryT(T_CMP, g => { const a = entOf(g.E1), b = entOf(g.E2); if (a >= 0) emit(+g.V1, a, g.C); else if (b >= 0) emit(+g.V2, b, g.C); })) continue;
      if (tryT(T_PAIR, g => { const e = entOf(g.E); emit(+g.V1, e, g.C1); emit(+g.V2, e, g.C2); })) continue;
      if (tryT(T_ONE, g => emit(+g.V, entOf(g.E), g.C))) continue;
      // everything else: one value, the entity is the single mention (or the anaphor), the condition is the remainder
      if (vals.length !== 1) continue;
      let c = marked; for (const re of CONTRAST) c = c.replace(re, ' ');
      const mm = mentions(c);
      const e = mm.length ? mm[0].i : ANA.test(c) ? d.own : -1;
      if (e < 0) continue;
      let cond = rest(c).replace(new RegExp(PNALT, 'gi'), ' ');
      if (!hasCond(p, cond)) cond = defCond;
      emit(0, e, cond);
    }
  }
  return { docs, claims, voidIds, valueFix, nFix, ents };
}

// ---- full answer ---------------------------------------------------------------------------------------------
export function ceilingAnswer(task, dbg) {
  const ex = ceilingSolve(task);
  const { docs, claims, voidIds, valueFix, nFix, ents } = ex;
  const P = task.prompt;
  // errata
  const propsIn = s => Object.keys(PROPS).filter(p => PROPS[p].names.some(n => s.toLowerCase().includes(n.toLowerCase().replace(/ \(ic50\)$/, '').replace('half-maximal inhibitory concentration', 'ic50'))));
  for (const f of valueFix) {
    const a = neutralise(f.after);
    let old = null, nw = null, p = null;
    const cm = /(?:was in fact measured|the measurement was made|was actually obtained|refers to a run) (.+?)(?:;\s|\.\s|\.$)/.exec(a);
    if (cm) { // condition erratum: the value stands, the condition it was measured under is corrected
      const ps0 = propsIn(a); if (!ps0.length) continue;
      const v0 = valuesIn(ps0[0], a)[0]; if (!v0) continue;
      for (const c of claims.filter(c => c.doc === f.target && c.prop === ps0[0] && Math.abs(c.canon - v0.canon) <= 0.003 * Math.abs(v0.canon) + 1e-9)) c.std = isStd(ps0[0], cm[1]);
      continue;
    }
    const fm = /too (large|high|small|low) by a factor of (\d+)|should be (divided|multiplied) by (\d+)|a factor (\d+) too (high|low)/.exec(a);
    if (fm) {
      const F = Number(fm[2] || fm[4] || fm[5]), down = /large|high|divided/.test(`${fm[1] || ''}${fm[3] || ''}${fm[6] || ''}`);
      const ps0 = propsIn(a); if (!ps0.length) continue;
      const v0 = valuesIn(ps0[0], a)[0]; if (!v0) continue;
      for (const c of claims.filter(c => c.doc === f.target && c.prop === ps0[0] && Math.abs(c.canon - v0.canon) <= 0.003 * Math.abs(v0.canon) + 1e-9)) c.canon = down ? v0.canon / F : v0.canon * F;
      continue;
    }
    {
      const ps = propsIn(a);
      if (ps.length) {
        const vs = valuesIn(ps[0], a);
        let marked = '', last = 0; vs.forEach((v, i) => { marked += a.slice(last, v.at) + `⟦${i}⟧`; last = v.at + v.len; }); marked += a.slice(last);
        for (const re of ER_VAL) { const g = re.exec(marked)?.groups; if (g) { p = ps[0]; old = vs[+g.Vold]; nw = vs[+g.Vnew]; break; } }
      }
    }
    if (!old) { // unit errata: the number stays, the unit changes
      const ps = propsIn(a); if (!ps.length) continue; p = ps[0];
      const vs = valuesIn(p, a); if (!vs.length) continue; old = vs[0];
      const um = /(?:it should read|the unit should be|figure is to be read in|should carry the unit) ([^,.;]+?)(?:,| i\.e\.|;|\.(?: |$))/.exec(a);
      if (!um) continue;
      const unit = UNITS[p].find(u => u.text === um[1].trim()); if (!unit) continue;
      const num = Number(/(\d[\d,]*(?:\.\d+)?)/.exec(a.slice(old.at, old.at + old.len))[1].replace(/,/g, ''));
      nw = vs[1] ? vs[1] : { canon: num * unit.f + unit.o };
    }
    if (!nw) continue;
    for (const c of claims.filter(c => c.doc === f.target && c.prop === p && Math.abs(c.canon - old.canon) <= 0.003 * Math.abs(old.canon) + 1e-9)) c.canon = nw.canon;
  }
  // sample size
  const nOf = d => {
    if (nFix.has(d.id)) return nFix.get(d.id);
    const w = '(\\d+|' + WORDS.join('|') + ')';
    const sents = d.text.split(/(?<=\.)\s+(?=[A-Z0-9])/);
    const S = sents.find(x => /independent batches|specimens|biological replicates|subjects|participants|volunteers|^Replicates:|^n = |^Sample count/.test(x) && !/\bfor the (?:compound|material)\b/.test(x) || /^Topic:.*n = \d+/.test(x));
    if (!S) return 0;
    const t0 = S.replace(/Topic: [^.]*?(?:\([^)]*\))?\. /, '').replace(/[A-Z]{2}-\d+/g, ' ').replace(/\b(?:over|from|in) \d+ (?:weeks|laboratories)\b/g, ' ').replace(new RegExp(`\\b(?:${MONTHS.join('|')})\\b`, 'g'), ' ');
    let m;
    if ((m = new RegExp(`remaining ${w}`, 'i').exec(t0))) return toInt(m[1]);
    const nums = [...t0.matchAll(new RegExp(`\\b${w}\\b`, 'gi'))].map(x => toInt(x[1]));
    if (/\b(?:failed|lost|withdrew|excluded|discarded|dropped|scrapped|unusable|left out|out)\b|dropped out/.test(t0)) return nums.length >= 3 ? nums[nums.length - 1] : Math.abs(nums[0] - nums[1]);
    if (/another|in a second|from the second|in the second/.test(t0)) return nums[0] + nums[1];
    if ((m = /n = (\d+)/.exec(t0))) return +m[1];
    return nums[0] ?? 0;
  };
  const byId = new Map(docs.map(d => [d.id, d]));
  const policy = /whatever the venue/.test(P) ? 'P3' : /three levels/.test(P) ? 'P4' : /sample size n only matters/.test(P) ? 'P2' : 'P1';
  const tier = d => (d.kind === 'journal' ? (policy === 'P4' ? 3 : 2) : d.kind === 'preprint' ? (policy === 'P4' ? 2 : 1) : d.kind === 'labnote' ? 1 : 0);
  const key = d => { const n = d.kind === 'press' ? 0 : nOf(d); return policy === 'P3' ? [n, tier(d), d.day] : policy === 'P2' ? [tier(d), d.day, n] : [tier(d), n, d.day]; };
  const table = [];
  for (const r of task.inputs.requested) {
    const ei = ents.findIndex(e => e.name === r.entity);
    let cands = claims.filter(c => c.std && c.ent === ei && c.prop === r.property && !voidIds.has(c.doc) && byId.get(c.doc).kind !== 'notice');
    if (cands.some(c => byId.get(c.doc).kind !== 'press')) cands = cands.filter(c => byId.get(c.doc).kind !== 'press');
    cands.sort((a, b) => { const x = key(byId.get(a.doc)), y = key(byId.get(b.doc)); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return a.doc < b.doc ? -1 : 1; });
    if (cands[0]) table.push({ entity: r.entity, property: r.property, value: cands[0].canon, source_doc_id: cands[0].doc });
  }
  if (dbg) { dbg.nOf = nOf; dbg.claims = claims; dbg.ex = ex; }
  return { table, conflicts: [], excluded_doc_ids: [...voidIds].sort() };
}

export const heuristicSolve = ceilingAnswer;
