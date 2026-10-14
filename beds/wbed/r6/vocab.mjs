// Static vocabulary of W-bed R6 "wide research table": properties with exact unit conversions, standard and
// non-standard conditions, labs, entity-name syllables, document kinds and ranking policies, and the difficulty knobs.
//
// Exactness. Every property has a canonical unit and a reporting precision (`dec` decimals). True values are integers
// in units of 10^-dec of the canonical unit ("canon"). Every non-canonical unit is printed from canon by an exact
// integer map (multiplication, or an affine shift for temperatures), so converting the printed number back to the
// canonical unit gives the true value exactly in decimal arithmetic. The oracle compares round(value * 10^dec) with
// canon, which is exact for any solver that converts correctly in floating point.

export const VERSION = '1.0.0';
export const MIN_D = 2, MAX_D = 5;

// unit: { id, label, dec (decimals printed), toPrinted(canon) -> integer in units of 10^-dec of this unit }
const U = (id, label, dec, toPrinted) => ({ id, label, dec, toPrinted });
export const PROPS = {
  melting_point: {
    id: 'melting_point', label: 'melting point', canonUnit: '°C', dec: 1, range: [800, 3000],
    std: 'at atmospheric pressure (a melting point given without a pressure is at atmospheric pressure)',
    units: [U('C', '°C', 1, c => c), U('K', 'K', 2, c => c * 10 + 27315), U('F', '°F', 2, c => c * 18 + 3200)],
    stdText: [(e, v) => `The melting point of ${e} was ${v}`, (e, v) => `${e} melted at ${v}`],
    nonstdText: [(e, v) => `Under 5 bar of nitrogen, ${e} melted at ${v}`, (e, v) => `In a sealed capillary at 3 bar, the melting point of ${e} was ${v}`],
    bound: null,
  },
  solubility: {
    id: 'solubility', label: 'aqueous solubility', canonUnit: 'mg/mL', dec: 2, range: [5, 4000],
    std: 'in pure water at 25 °C',
    units: [U('mgmL', 'mg/mL', 2, c => c), U('ugmL', 'µg/mL', 0, c => c * 10), U('gL', 'g/L', 2, c => c), U('mg100', 'mg/100 mL', 0, c => c)],
    stdText: [(e, v) => `In water at 25 °C, ${e} dissolved to ${v}`, (e, v) => `The solubility of ${e} in pure water at 25 °C was ${v}`],
    nonstdText: [(e, v) => `In phosphate buffer (pH 7.4) at 37 °C, ${e} dissolved to ${v}`, (e, v) => `The solubility of ${e} in 0.1 M hydrochloric acid at 25 °C was ${v}`],
    bound: (e, v) => `The solubility of ${e} in pure water at 25 °C was below the quantification limit of ${v}`,
  },
  half_life: {
    id: 'half_life', label: 'plasma half-life', canonUnit: 'h', dec: 1, range: [5, 720],
    std: 'in human plasma',
    units: [U('h', 'h', 1, c => c), U('min', 'min', 0, c => c * 6)],
    stdText: [(e, v) => `The half-life of ${e} in human plasma was ${v}`, (e, v) => `In human plasma, ${e} showed a half-life of ${v}`],
    nonstdText: [(e, v) => `The half-life of ${e} in rat plasma was ${v}`, (e, v) => `In human liver microsomes, ${e} showed a half-life of ${v}`],
    bound: (e, v) => `In human plasma, ${e} was stable for the whole experiment: its half-life was longer than ${v}`,
  },
  ic50: {
    id: 'ic50', label: 'IC50 against KTR1 kinase', canonUnit: 'nM', dec: 0, range: [3, 20000],
    std: 'in the standard biochemical KTR1 kinase assay',
    units: [U('nM', 'nM', 0, c => c), U('uM', 'µM', 3, c => c), U('pM', 'pM', 0, c => c * 1000)],
    stdText: [(e, v) => `${e} inhibited KTR1 kinase in the standard biochemical assay with an IC50 of ${v}`, (e, v) => `In the standard biochemical KTR1 assay, the IC50 of ${e} was ${v}`],
    nonstdText: [(e, v) => `In the cell-based KTR1 assay, ${e} gave an IC50 of ${v}`, (e, v) => `Against KTR2 kinase, the IC50 of ${e} was ${v}`],
    bound: (e, v) => `${e} did not inhibit KTR1 kinase in the standard biochemical assay up to the highest concentration tested: its IC50 was above ${v}`,
  },
  logp: {
    id: 'logp', label: 'log P (octanol/water)', canonUnit: '', dec: 2, range: [-150, 600],
    std: 'the octanol/water partition coefficient (log P), not a distribution coefficient (log D)',
    units: [U('logp', '', 2, c => c)],
    stdText: [(e, v) => `The octanol/water partition coefficient of ${e} gave log P = ${v}`, (e, v) => `For ${e}, log P (octanol/water) was ${v}`],
    nonstdText: [(e, v) => `The distribution coefficient of ${e} at pH 7.4 was log D = ${v}`, (e, v) => `For ${e}, log D (pH 6.5) was ${v}`],
    bound: null,
  },
  density: {
    id: 'density', label: 'density', canonUnit: 'g/cm³', dec: 3, range: [800, 2500],
    std: 'of the solid at 20 °C',
    units: [U('gcm3', 'g/cm³', 3, c => c), U('kgm3', 'kg/m³', 0, c => c), U('gmL', 'g/mL', 3, c => c)],
    stdText: [(e, v) => `The density of ${e} at 20 °C was ${v}`, (e, v) => `At 20 °C, solid ${e} had a density of ${v}`],
    nonstdText: [(e, v) => `At 60 °C, the density of ${e} was ${v}`, (e, v) => `The density of molten ${e} was ${v}`],
    bound: null,
  },
  pka: {
    id: 'pka', label: 'pKa', canonUnit: '', dec: 2, range: [100, 1300],
    std: 'at 25 °C',
    units: [U('pka', '', 2, c => c)],
    stdText: [(e, v) => `${e} has a pKa of ${v} at 25 °C`, (e, v) => `At 25 °C, the pKa of ${e} was ${v}`],
    nonstdText: [(e, v) => `At 37 °C, the pKa of ${e} was ${v}`, (e, v) => `In 50% methanol, ${e} showed a pKa of ${v}`],
    bound: null,
  },
};
export const PROP_IDS = Object.keys(PROPS);
export const BOUND_PROPS = PROP_IDS.filter(p => PROPS[p].bound);
export const unitOf = (prop, unitId) => PROPS[prop].units.find(u => u.id === unitId);

/** Printed number text of `canon` in `unitId` (exact; optional thousands separators). */
export function printedNumber(prop, canon, unitId, { thousands = false } = {}) {
  const u = unitOf(prop, unitId);
  const n = u.toPrinted(canon);
  const neg = n < 0, a = Math.abs(n);
  const div = 10 ** u.dec;
  let units = String(Math.floor(a / div));
  if (thousands && units.length > 3) units = units.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = u.dec ? `.${String(a % div).padStart(u.dec, '0')}` : '';
  return `${neg ? '-' : ''}${units}${frac}`;
}
/** "412.35 K", "1240 µg/mL", "log P 2.31" style value text. */
export function valueText(prop, canon, unitId, opts) {
  const u = unitOf(prop, unitId);
  const num = printedNumber(prop, canon, unitId, opts);
  return u.label ? `${num} ${u.label}` : num;
}
/** The canonical-unit float the oracle expects (canon / 10^dec). */
export const canonValue = (prop, canon) => canon / 10 ** PROPS[prop].dec;
/** Parse a printed value back to canon (used by the white-box parsers and tests). */
export function canonOf(prop, unitId, printed) {
  const u = unitOf(prop, unitId);
  const n = Math.round(Number(String(printed).replace(/,/g, '')) * 10 ** u.dec);
  switch (`${prop}:${unitId}`) {
    case 'melting_point:K': return (n - 27315) / 10;
    case 'melting_point:F': return (n - 3200) / 18;
    case 'solubility:ugmL': return n / 10;
    case 'half_life:min': return n / 6;
    case 'ic50:pM': return n / 1000;
    default: return n;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Labs. `stem` is shared with the namesake organisation at d >= 4.
export const LAB_POOL = [
  { stem: 'Varnholt', name: 'Varnholt Institute for Molecular Pharmacology', abbr: 'VIMP', short: 'the Varnholt Institute' },
  { stem: 'Kessler', name: 'Kessler Laboratory of Physical Chemistry', abbr: 'KLPC', short: 'the Kessler Laboratory' },
  { stem: 'Sallow', name: 'Sallow Centre for Drug Discovery', abbr: 'SCDD', short: 'the Sallow Centre' },
  { stem: 'Okonkwo', name: 'Okonkwo Pharmacology Group', abbr: 'OPG', short: 'the Okonkwo group' },
  { stem: 'Halvard', name: 'Halvard Institute of Chemistry', abbr: 'HIC', short: 'the Halvard Institute' },
  { stem: 'Ruskin', name: 'Ruskin Applied Sciences Centre', abbr: 'RASC', short: 'the Ruskin Centre' },
  { stem: 'Morrow', name: 'Morrow Biochemical Laboratory', abbr: 'MBL', short: 'the Morrow Laboratory' },
  { stem: 'Ilves', name: 'Ilves Materials and Formulation Lab', abbr: 'IMFL', short: 'the Ilves Lab' },
  { stem: 'Castellan', name: 'Castellan Screening Facility', abbr: 'CSF', short: 'the Castellan Facility' },
  { stem: 'Thorne', name: 'Thorne Centre for Medicinal Chemistry', abbr: 'TCMC', short: 'the Thorne Centre' },
];
export const FORMER_NAMES = ['Brenner Laboratory', 'Ashdown Research Unit', 'Pellow Chemical Laboratory', 'Quarrie Analytical Unit', 'Dunmore Testing Laboratory'];
export const NAMESAKE_SUFFIX = [{ name: s => `${s} Foundation Clinic`, abbr: s => `${s[0]}FC` }, { name: s => `${s} Contract Analytics`, abbr: s => `${s[0]}CA` }];

// Entity names: prefix + middle + suffix (invented, lower case). Codes: 2-3 capitals, a hyphen, 3-4 digits.
export const NAME_PREFIX = ['lu', 'to', 'va', 'qui', 'ser', 'ma', 'de', 'ri', 'po', 'fe', 'ca', 'zo', 'ne', 'bi', 'ta', 'xe', 'mo', 'pe', 'sa', 'ki', 'ha', 'jo', 'gu', 'we'];
export const NAME_MIDDLE = ['me', 'va', 'li', 'ro', 'te', 'ni', 'sa', 'do', 'ra', 'ce', 'pi', 'lo', 'fu', 'ga', 'bo', 'ze'];
export const NAME_SUFFIX = ['prazine', 'rexin', 'libant', 'tamide', 'zolol', 'fenib', 'cillate', 'ostat', 'mycin', 'vudine', 'dronate', 'tinib', 'lumab', 'pirox'];
export const CODE_PREFIX = ['VX', 'KT', 'BRX', 'SC', 'HX', 'MRL', 'QT', 'ZN', 'PD', 'LT', 'RV', 'CX'];
export const CODE_RE = /\b[A-Z]{2,3}-\d{3,4}\b/g;

// ---------------------------------------------------------------------------------------------------------------------
// Documents. tier: 0 journal (peer reviewed), 1 preprint, 2 lab note; null for non-research documents.
export const KINDS = {
  journal: { tier: 0, research: true },
  preprint: { tier: 1, research: true },
  labnote: { tier: 2, research: true },
  conference: { tier: 1, research: true, novel: 'novel-dev' },
  techreport: { tier: 2, research: true, novel: 'novel-test' },
  review: { tier: null, research: false },
  erratum: { tier: null, research: false },
  retraction: { tier: null, research: false },
  concern: { tier: null, research: false },
  office: { tier: null, research: false },
};
export const LABELS = {
  journal: { 2: ['Journal article'], 3: ['Journal article', 'Letter', 'Full paper'] },
  preprint: { 2: ['Preprint'] },
  labnote: { 2: ['Lab note'], 3: ['Lab note', 'Technical memo'] },
  conference: { 2: ['Conference abstract'] },
  techreport: { 2: ['Technical report'] },
  review: { 2: ['Review'] },
  erratum: { 2: ['Erratum'], 3: ['Erratum', 'Correction'] },
  retraction: { 2: ['Retraction notice'] },
  concern: { 2: ['Expression of concern'] },
  office: { 2: ['Consortium notice'] },
};
export const labelsFor = (kind, d) => { const t = LABELS[kind]; return t[Math.max(...Object.keys(t).map(Number).filter(k => k <= d))]; };
export const JOURNALS = ['Journal of Applied Pharmacochemistry', 'Molecular Property Letters', 'Annals of Compound Characterisation', 'Physical Pharmaceutics Quarterly'];
export const SERVERS = ['PharmArchive', 'ChemPreprints'];
export const CONFERENCE = 'Spring Symposium on Compound Profiling';
export const REPORT_SERIES = 'Consortium Report Series';

export const POLICIES = {
  P1: { id: 'P1', text: 'Rank the surviving claims for a cell by venue first (journal publications above preprints, preprints above lab notes), then by sample size n (larger first), then by publication date (more recent first).' },
  P2: { id: 'P2', text: 'Rank the surviving claims for a cell by venue first (journal publications above preprints, preprints above lab notes), then by publication date (more recent first). Sample size does not matter.' },
  P3: { id: 'P3', text: 'Rank the surviving claims for a cell by sample size n first (larger first), then by venue (journal publications above preprints, preprints above lab notes), then by publication date (more recent first).' },
};
/** Smaller key ranks higher. `n` is the claim's sample size, `day` the publication day. */
export function rankKey(policy, tier, n, day) {
  switch (policy) {
    case 'P1': return [tier, -n, -day];
    case 'P2': return [tier, -day];
    case 'P3': return [-n, tier, -day];
    default: throw new Error(`unknown policy ${policy}`);
  }
}
export function cmpKeys(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }

// ---------------------------------------------------------------------------------------------------------------------
// Difficulty knobs (W-BED §2.5: d -> d+1 widens the fan-out and adds drift).
//   docs: corpus size; entities: compounds in the world; inScope: the answer's compounds (the fan-out width);
//   near: plan candidates that are not in scope (one per trap kind T1-T4, the rest spread); props: requested
//   properties per compound; labs; alias: lab X appears under its abbreviation (1) and also a former name (2);
//   namesake: an organisation sharing lab X's stem; dates: publication/test date styles; policies drawn from;
//   units: unit variants per property (first = canonical); styles: entity mention styles; review/concern/out-of-corpus
//   notices; fill: filler sentences per research document (corpus size); tier: test-date phrasing (d5: novel, split-specific).
export const LEVELS = {
  2: { docs: 200, entities: 30, inScope: 8, near: 4, props: 3, labs: 5, alias: 0, namesake: false, dates: ['ISO'], policies: ['P1'],
    units: 2, styles: ['both'], reviews: 0, concerns: 0, outOfCorpus: 0, decoyDates: false, docN: 0, thousands: false, extraLosers: 0.3, fill: [5, 8] },
  3: { docs: 260, entities: 40, inScope: 12, near: 5, props: 4, labs: 6, alias: 1, namesake: false, dates: ['ISO', 'WORDS_DMY'], policies: ['P1', 'P2'],
    units: 3, styles: ['both', 'name', 'code'], reviews: 4, concerns: 2, outOfCorpus: 0, decoyDates: true, docN: 0.3, thousands: false, extraLosers: 0.4, fill: [5, 8] },
  4: { docs: 320, entities: 50, inScope: 16, near: 6, props: 4, labs: 7, alias: 2, namesake: true, dates: ['ISO', 'WORDS_DMY', 'DMY_DOT'], policies: ['P1', 'P2', 'P3'],
    units: 4, styles: ['both', 'name', 'code'], reviews: 6, concerns: 3, outOfCorpus: 1, decoyDates: true, docN: 0.35, thousands: true, extraLosers: 0.4, fill: [5, 8] },
  5: { docs: 400, entities: 60, inScope: 20, near: 7, props: 5, labs: 8, alias: 2, namesake: true, dates: ['ISO', 'WORDS_DMY', 'DMY_DOT', 'WORDS_MDY'], policies: ['P1', 'P2', 'P3'],
    units: 4, styles: ['both', 'name', 'code'], reviews: 8, concerns: 4, outOfCorpus: 2, decoyDates: true, docN: 0.35, thousands: true, extraLosers: 0.4, fill: [6, 9] },
};
/** The maximum fan-out of flow.wide without evidence (FLOW-V3 §2.3, ROADMAP §2.1). Candidates never exceed it. */
export const MAX_FANOUT = 32;
/** Test-date phrasing tier: 'dev' at d2-d4 (both splits); at d5 'novel-dev' on split dev, 'novel-test' on split test. */
export const tierOf = (split, d) => (d < 5 ? 'dev' : split === 'test' ? 'novel-test' : 'novel-dev');
