// Triviality attack (audit step 4): a <=40-line deterministic regex solver that reads only prompt + inputs and encodes what a script author learns from dev tasks.
const T = { '°C': 0, K: 0, '°F': 0 }, A = (...ks) => Object.fromEntries(ks.flatMap(([k, v]) => k.split('|').map(x => [x, v]))), MON = 'January|February|March|April|May|June|July|August|September|October|November|December';
const PU = { 'aqueous solubility': A(['mg/mL|mg mL⁻¹|mg·mL⁻¹|g/L|g L⁻¹', 1], ['µg/mL|μg mL⁻¹|µg·mL⁻¹|mg/L|mg L⁻¹', 1e-3], ['mg/100 mL|mg per 100 mL', .01]), 'melting point': T, 'optimal growth temperature': T, 'plasma half-life': A(['h|hours|hr', 1], ['min|minutes', 1 / 60], ['days', 24]), 'enzyme IC50': A(['nM', 1], ['µM|μM', 1e3], ['pM', 1e-3], ['M', 1e9]),
  density: A(['g/cm³|g cm⁻³|g/cc|g/mL', 1], ['kg/m³|kg m⁻³', 1e-3]), 'tensile strength': A(['MPa|N/mm²', 1], ['GPa', 1e3], ['ksi', 6.894757], ['psi', 0.006894757]), 'thermal conductivity': A(['W/(m·K)|W m⁻¹ K⁻¹|W/m·K', 1], ['mW/(m·K)|mW m⁻¹ K⁻¹', 1e-3], ['W/(cm·K)|W cm⁻¹ K⁻¹', 100]), 'band gap': A(['eV', 1], ['meV', 1e-3]),
  'doubling time': A(['min|minutes', 1], ['h|hours', 60], ['s|seconds', 1 / 60]), 'genome size': A(['Mbp|Mb', 1], ['kbp|kb', 1e-3], ['bp', 1e-6]), 'cell length': A(['µm|μm|micrometres', 1], ['nm', 1e-3]) };
const NAMES = { 'aqueous solubility': 'solubility', 'melting point': 'melting', 'plasma half-life': 'half-life', 'enzyme IC50': 'IC50', density: 'density', 'tensile strength': 'tensile strength|UTS', 'thermal conductivity': 'conductivity', 'band gap': 'band ?gap', 'doubling time': 'doubling time|generation time', 'genome size': 'genome size|genome length', 'cell length': 'cell length', 'optimal growth temperature': 'growth temperature|temperature optimum for growth' };
const WIN = { 'aqueous solubility': [24, 26], density: [20, 25], 'tensile strength': [20, 25], 'thermal conductivity': [21.8, 31.9], 'band gap': [16.8, 26.9], 'doubling time': [29, 31] };
const NONSTD = /buffer \(|hydrochloric|saline|gastric|ethanol|DMSO|hydroxide|GPa of|GPa in|at \d GPa|diamond|MPa of|MPa in|kbar|atm of|mice|rats|dogs|monkeys|minipigs|in vitro|microsomes|hepatocytes|whole-cell|cultured cells|cell-based|HEK293|whole blood|powder|foam|porosity|sintered|salt-spray|irradiated|cold-rolled|heat-aged|minimal|anaerobic|without oxygen|draft|pulsed-field|k-mer|cytometry|stationary|starvation|colonies|scraped|filaments|agar plates|pH [4589]\.|NaCl/;
const NOTCLAIM = /reported|previous study|for comparison|only for comparison|re-measured|did not repeat|listed for|Literature value|predict|expected to be|design target|Simulations put|Extrapolating|not measured|no measurement|NOTE TO|instruction|language model|hydrochloride|sodium salt|monohydrate|dihydrate|mesylate|\bdoped|composite|porous|mutant|derivative|descendant|Δ/;
const WORDS = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' '), SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹', int = w => (WORDS.includes(w.toLowerCase()) ? WORDS.indexOf(w.toLowerCase()) : Number(w));
const num = s => { const m = /^([\d.]+)\s*(?:×\s*10\^?([⁻\-]?[\d⁰¹²³⁴⁵⁶⁷⁸⁹]+)|e(-?\d+))?/.exec(s.replace(/,(?=\d{3})/g, '')); const e = m[2] ? Number([...m[2]].map(c => (SUP.includes(c) ? SUP.indexOf(c) : c === '⁻' ? '-' : c)).join('')) : m[3] ? Number(m[3]) : 0; return Number(m[1]) * 10 ** e; };
const REF = `("[^"]+" by [^)]+\\)|the \\w+ by (?:[A-Z]\\. )+[A-Z][\\w-]+ and co-authors \\([^)]*\\)|the (?:${MON}) \\d{4} \\w+ by [A-Z][\\w-]+ and colleagues in [^.;]+?(?=\\.|;|, which))`;
const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), DATE = new RegExp(`\\d{4}-\\d\\d-\\d\\d|\\d{1,2} (?:${MON}) \\d{4}|(?:${MON}) \\d{1,2}, \\d{4}|\\d{4} [A-Z][a-z]{2} \\d{1,2}`, 'g'), day = s => Date.parse(s.replace(/^(\d{4}) ([A-Z][a-z]{2}) (\d+)$/, '$2 $3, $1'));
const valRe = prop => new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?(?:\\s*×\\s*10\\^?[⁻\\-]?[\\d⁰¹²³⁴⁵⁶⁷⁸⁹]+|e-?\\d+)?)(?:\\s*±\\s*[\\d.]+)?\\s*(${Object.keys(PU[prop]).sort((a, b) => b.length - a.length).map(esc).join('|')})(?![\\w/·⁻])`, 'g');
const canon = (prop, x, u) => (u === 'K' ? x - 273.15 : u === '°F' ? (x - 32) * 5 / 9 : u === '°C' ? x : x * PU[prop][u]);
const vals = (prop, s) => [...s.matchAll(valRe(prop))].filter(m => !/(at|At|to|of) $/.test(s.slice(Math.max(0, m.index - 3), m.index)) || !T[m[2]] && m[2] !== undefined);
const tempsOk = (prop, s) => !WIN[prop] || [...s.matchAll(/([−-]?\d+(?:\.\d+)?) (°C|K|°F)\b/g)].every(m => { const c = canon('melting point', Number(m[1].replace('−', '-')), m[2]); return c >= WIN[prop][0] && c <= WIN[prop][1]; });
export function heuristicSolve(task) {
  const docs = task.inputs.documents, P = task.prompt, kind = d => (/press|news|media/i.test(d.type) ? 'press' : /preprint/i.test(d.type) ? 'preprint' : /memo|notebook|lab note/i.test(d.type) ? 'lab' : /retract|erratum|correct|corrigendum|concern/i.test(d.type) ? 'notice' : 'journal');
  const pol = /whatever the venue/.test(P) ? 'n' : /\(3\) sample size n only/.test(P) ? 'date' : 'venue', three = /three levels/.test(P), research = docs.filter(d => kind(d) !== 'notice' && kind(d) !== 'press');
  const refTo = s => { const ds = (s.match(DATE) || []).map(day), my = new RegExp(`the (${MON}) (\\d{4})`).exec(s), sur = (/by (?:[A-Z]\. )*([A-Z][\w-]+)/.exec(s) || [])[1], ti = (/^"(.+?)" by/.exec(s) || [])[1];
    return research.filter(d => d.authors.split(', ')[0].endsWith(sur) && (ti ? d.title === ti : true) && (ds.length ? ds.includes(day(d.date)) : my && new Date(day(d.date)).getUTCMonth() === MON.split('|').indexOf(my[1]) && new Date(day(d.date)).getUTCFullYear() === +my[2]) && (!/ in ([^,]+?) on the /.test(s) || s.includes(` in ${d.venue} on`))); };
  const voidIds = new Set(), corr = new Map(), nFix = new Map();
  for (const d of docs) {
    if (/this version is superseded|superseded by its published/.test(d.text)) voidIds.add(d.id);
    const v = new RegExp(`(?:posted on|first posted|first version posted|revision 1 dated|the entry of) (${DATE.source})`).exec(d.text); if (v) research.filter(x => x !== d && x.venue === d.venue && day(x.date) === day(v[1])).forEach(x => voidIds.add(x.id));
    const s = new RegExp(`(?:Retraction of|version of the preprint|posted as) ${REF}`).exec(d.text); if (s && (kind(d) === 'notice' || /preprint|posted as/.test(s[0]))) refTo(s[1]).filter(x => kind(d) === 'notice' || kind(x) === 'preprint').forEach(x => voidIds.add(x.id));
    const e = new RegExp(`^(?:Correction to|Erratum for|Corrigendum to) ${REF}\\. ([^]*)$`).exec(d.text); if (!e) continue;
    const tg = refTo(e[1]), b = e[2], nm = /(?:made on|misreported as) (\d+)[^;]*; (?:the correct number is|all values are in fact based on) (\d+)/.exec(b);
    const w = /(?:given as|appears as|value of|as) (\d[^.;]*?(?:\.\d+[^.;]*?)?)[.;] .*?(?:correct value is|should read|replaced by|correct entry is|unit should be|it should read) ([^,]+?)(?:, i\.e\.|\. |\.$)/.exec(b);
    for (const x of tg) { if (nm) nFix.set(x.id, +nm[2]); else if (w) corr.set(`${x.id}|${num(w[1])}`, /^\d/.test(w[2]) ? w[2] : w[1].replace(/ \(SD.*|\s*±\s*[\d.]+/, '').replace(/\s\S+$/, ` ${w[2]}`)); }
  }
  const nOf = d => { if (nFix.has(d.id)) return nFix.get(d.id); const t = d.text, g = /(?:Of the|started with|Set up) (\w+)|^(?:\W*)?(\w+) (?:\w+ )+?(?:were prepared|were enrolled|started)|(\w+) (?:volunteers|\w+ \w+) were (?:enrolled|prepared)/.exec(t), k = /(\w+) (?:failed|had to be discarded|withdrew|was excluded|were excluded|was lost|were lost|lost to)/.exec(t), r = /remaining (\w+)/.exec(t);
    if (r) return int(r[1]); if (g && k) return int(g[1] || g[2] || g[3]) - int(k[1]); const m = /n = (\d+)|Replicates: (\w+)|(?:on|of|used|Ran|pooled) (\w+) (?:independent batches|specimens|biological replicates|subjects)/.exec(t); return m ? int(m[1] || m[2] || m[3]) : 0; };
  const table = [], conflicts = [];
  for (const { entity, property } of task.inputs.requested) {
    const all = docs.map(d => d.text).join(' '), a = new RegExp(`${esc(entity)} \\((?:code |now named )?(?:isolate )?([A-Z]+-\\d+)\\)|(?:isolate )?([A-Z]+-\\d+) \\((?:now named )?${esc(entity)}\\)`, 'i').exec(all);
    const ent = new RegExp(`(^|[^\\w-])(${esc(entity)}${a ? `|${a[1] || a[2]}` : ''})(?![\\w-])`, 'i'), cands = [];
    for (const d of docs) if (!voidIds.has(d.id) && kind(d) !== 'notice') {
      const own = ent.test(d.text.split(/(?<=\.) (?=[A-Z])/).slice(0, 3).find(s => !/^(Version|Revision|\[|This revised|Second version|Updated entry)/.test(s)) || '');
      for (const sen of d.text.split(/(?<=\.)\s+(?=[A-Z"[])/)) {
        if (!(ent.test(sen) || own && /the compound|this compound|the material|this material|the isolate|this strain|the organism/i.test(sen)) || !new RegExp(NAMES[property], 'i').test(sen) || NOTCLAIM.test(sen)) continue;
        for (const part of sen.split(/; |, whereas | and (?=[\d−])/)) { if (NONSTD.test(part) || !tempsOk(property, part.replace(valRe(property), ''))) continue; const v = vals(property, part)[0]; if (!v) continue;
          const fx = corr.get(`${d.id}|${num(v[1])}`), fv = fx ? vals(property, fx)[0] : null; cands.push({ d, v: fv ? canon(property, num(fv[1]), fv[2]) : canon(property, num(v[1]), v[2]) }); }
      }
    }
    const pr = cands.some(c => kind(c.d) !== 'press') ? cands.filter(c => kind(c.d) !== 'press') : cands, tier = d => (kind(d) === 'journal' ? 3 : kind(d) === 'preprint' && three ? 2 : kind(d) === 'press' ? 0 : 1);
    const key = c => (pol === 'n' ? [nOf(c.d), tier(c.d), day(c.d.date)] : pol === 'date' ? [tier(c.d), day(c.d.date), nOf(c.d)] : [tier(c.d), nOf(c.d), day(c.d.date)]);
    pr.sort((x, y) => { const p = key(x), q = key(y); for (let i = 0; i < 3; i++) if (p[i] !== q[i]) return q[i] - p[i]; return x.d.id < y.d.id ? -1 : 1; });
    if (pr[0]) table.push({ entity, property, value: pr[0].v, source_doc_id: pr[0].d.id });
    if (new Set(pr.map(c => c.d.id)).size > 1) conflicts.push({ entity, property, doc_ids: [...new Set(pr.map(c => c.d.id))].sort() });
  }
  return { table, conflicts, excluded_doc_ids: [...voidIds].sort() };
}
