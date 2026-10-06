// Triviality attack (audit step 4): a <=40-line deterministic regex solver that reads only prompt + inputs and
// encodes everything a script author learns from looking at a few dev tasks. Not part of the oracle.
const T = { '°C': 0, K: 0, '°F': 0 }, A = (o, ...ks) => Object.fromEntries(ks.flatMap(([k, v]) => k.split('|').map(x => [x, v])));
const PU = { 'aqueous solubility': A({}, ['mg/mL|mg mL⁻¹|mg·mL⁻¹|g/L|g L⁻¹', 1], ['µg/mL|μg mL⁻¹|µg·mL⁻¹|mg/L|mg L⁻¹', 1e-3], ['mg/100 mL|mg per 100 mL', .01]), 'melting point': T, 'optimal growth temperature': T,
  'plasma half-life': A({}, ['h|hours|hr', 1], ['min|minutes', 1 / 60], ['days', 24]), 'enzyme IC50': A({}, ['nM', 1], ['µM|μM', 1e3], ['pM', 1e-3], ['M', 1e9]),
  density: A({}, ['g/cm³|g cm⁻³|g/cc|g/mL', 1], ['kg/m³|kg m⁻³', 1e-3]), 'tensile strength': A({}, ['MPa|N/mm²', 1], ['GPa', 1e3], ['ksi', 6.894757], ['psi', 0.006894757]),
  'thermal conductivity': A({}, ['W/(m·K)|W m⁻¹ K⁻¹|W/m·K', 1], ['mW/(m·K)|mW m⁻¹ K⁻¹', 1e-3], ['W/(cm·K)|W cm⁻¹ K⁻¹', 100]), 'band gap': A({}, ['eV', 1], ['meV', 1e-3]),
  'doubling time': A({}, ['min|minutes', 1], ['h|hours', 60], ['s|seconds', 1 / 60]), 'genome size': A({}, ['Mbp|Mb', 1], ['kbp|kb', 1e-3], ['bp', 1e-6]), 'cell length': A({}, ['µm|μm|micrometres', 1], ['nm', 1e-3]) };
const NAMES = { 'aqueous solubility': 'solubility', 'melting point': 'melting', 'plasma half-life': 'half-life', 'enzyme IC50': 'IC50', density: 'density', 'tensile strength': 'tensile strength|UTS', 'thermal conductivity': 'thermal conductivity', 'band gap': 'band ?gap', 'doubling time': 'doubling time|generation time', 'genome size': 'genome size|genome length', 'cell length': 'cell length', 'optimal growth temperature': 'growth temperature|temperature optimum for growth' };
const BAD = /\b(37 °C|310 K|ethanol|DMSO|acid|buffer|4 °C|GPa of|MPa of|diamond|mice|rats|dogs|monkeys|in vitro|whole-cell|cultured cells|cell-based|powder|foam|900 °C|porosity|600 °C|77 K|−196|873 K|800 K|500 °C|4 K|10 K|minimal|15 °C|288 K|anaerobic|draft|pulsed-field|stationary|starvation|colonies|pH 5|NaCl|pH 9|et al|co-workers|previous study|predict|expected|design target|NOTE TO|instruction|language model|hydrochloride|sodium salt|monohydrate|doped|composite|mutant|derivative)\b|ΔpilA|ΔrecA|plasmid-cured/;
const WORDS = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' '), SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const num = s => { const m = /^([\d.]+)\s*(?:×\s*10\^?([⁻\-]?[\d⁰¹²³⁴⁵⁶⁷⁸⁹]+)|e(-?\d+))?/.exec(s.replace(/,(?=\d{3})/g, '')); const e = m[2] ? Number([...m[2]].map(c => (SUP.includes(c) ? SUP.indexOf(c) : c === '⁻' ? '-' : c)).join('')) : m[3] ? Number(m[3]) : 0; return Number(m[1]) * 10 ** e; };
const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const valRe = prop => new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?(?:\\s*×\\s*10\\^?[⁻\\-]?[\\d⁰¹²³⁴⁵⁶⁷⁸⁹]+|e-?\\d+)?)(?:\\s*±\\s*[\\d.]+)?\\s*(${Object.keys(PU[prop]).sort((a, b) => b.length - a.length).map(esc).join('|')})(?![\\w/·⁻])`, 'g');
const canon = (prop, x, u) => (u === 'K' ? x - 273.15 : u === '°F' ? (x - 32) * 5 / 9 : u === '°C' ? x : x * PU[prop][u]);
const firstVal = (prop, s) => { const v = [...s.matchAll(valRe(prop))].filter(m => !/^(at|At) $/.test(s.slice(Math.max(0, m.index - 3), m.index)))[0]; return v && canon(prop, num(v[1]), v[2]); };
export function heuristicSolve(task) {
  const docs = task.inputs.documents, P = task.prompt, all = docs.map(d => d.text).join(' ');
  const pol = /whatever the venue/.test(P) ? 'n' : /\(3\) sample size n only/.test(P) ? 'date' : 'venue', three = /three levels/.test(P);
  const kind = d => (/press|news|media/i.test(d.type) ? 'press' : /preprint/i.test(d.type) ? 'preprint' : /memo|notebook|lab note/i.test(d.type) ? 'lab' : /retract|erratum|correct|corrigendum|concern/i.test(d.type) ? 'notice' : 'journal');
  const byTitle = t => docs.filter(d => d.title === t && kind(d) !== 'notice');
  const voidIds = new Set(), corr = new Map();
  for (const d of docs) {
    if (/this version is superseded|^(Version|Revision) 1\.|\bVersion 1\. |Revision 1\. /.test(d.text)) voidIds.add(d.id);
    for (const m of d.text.matchAll(/(?:Retraction of|version of the preprint) "(.+?)"/g)) byTitle(m[1]).filter(x => kind(d) === 'notice' || kind(x) === 'preprint').forEach(x => voidIds.add(x.id));
    const e = /^(?:Correction to|Erratum for|Corrigendum to) "(.+?)"[^]*? of ([^]+?) was given as ([^]+?)\. (?:The correct value is ([^]+?)\. |The number is right but the unit is wrong: it should read ([^,.]+))/.exec(d.text);
    if (e) for (const x of byTitle(e[1])) for (const p of Object.keys(PU)) if (new RegExp(NAMES[p], 'i').test(e[2]) || new RegExp(NAMES[p], 'i').test(d.text.split(' was given')[0].slice(-80))) corr.set(`${x.id}|${p}`, firstVal(p, e[4] ? e[4] : e[3].replace(/\s*\S+$/, ` ${e[5]}`)));
  }
  const nOf = d => { const m = /n = (\d+)|Replicates: (\w+)|(?:on|of|used|Ran) (\w+) (?:independent batches|specimens|biological replicates|subjects)/.exec(d.text); const v = m && (m[1] || m[2] || m[3]); return v ? (WORDS.includes(v) ? WORDS.indexOf(v) : Number(v)) : 0; };
  const table = [], conflicts = [];
  for (const { entity, property } of task.inputs.requested) {
    const a = new RegExp(`${esc(entity)} \\((?:code |now named )?(?:isolate )?([A-Z]+-\\d+)\\)|(?:isolate )?([A-Z]+-\\d+) \\((?:now named )?${esc(entity)}\\)`, 'i').exec(all);
    const ent = new RegExp(`(^|[^\\w-])(${esc(entity)}${a ? `|${a[1] || a[2]}` : ''})(?![\\w-])`, 'i'), cands = [];
    for (const d of docs) if (!voidIds.has(d.id) && kind(d) !== 'notice') for (const s of d.text.split(/(?<=\.)\s+(?=[A-Z"[])|;\s|, whereas | and (?=\d)/)) {
      if (!ent.test(s) || !new RegExp(NAMES[property], 'i').test(s) || BAD.test(s)) continue;
      const v = corr.has(`${d.id}|${property}`) ? corr.get(`${d.id}|${property}`) : firstVal(property, s); if (v != null) cands.push({ d, v });
    }
    const pr = cands.some(c => kind(c.d) !== 'press') ? cands.filter(c => kind(c.d) !== 'press') : cands;
    const tier = d => (kind(d) === 'journal' ? 3 : kind(d) === 'preprint' && three ? 2 : kind(d) === 'press' ? 0 : 1);
    const key = c => (pol === 'n' ? [nOf(c.d), tier(c.d), Date.parse(c.d.date)] : pol === 'date' ? [tier(c.d), Date.parse(c.d.date), nOf(c.d)] : [tier(c.d), nOf(c.d), Date.parse(c.d.date)]);
    pr.sort((x, y) => { const p = key(x), q = key(y); for (let i = 0; i < 3; i++) if (p[i] !== q[i]) return q[i] - p[i]; return x.d.id < y.d.id ? -1 : 1; });
    if (pr[0]) table.push({ entity, property, value: pr[0].v, source_doc_id: pr[0].d.id });
    if (new Set(pr.map(c => c.d.id)).size > 1) conflicts.push({ entity, property, doc_ids: [...new Set(pr.map(c => c.d.id))].sort() });
  }
  return { table, conflicts, excluded_doc_ids: [...voidIds].sort() };
}
