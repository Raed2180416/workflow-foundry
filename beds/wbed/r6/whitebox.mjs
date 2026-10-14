// White-box script for R6 (W-BED §2.4 item 4: reported, not gating). Written WITH the generator's templates (vocab.mjs,
// render.mjs): it parses every sentence form the renderer can produce and applies the prompt's rules, reading only the
// task (prompt, inputs, files). Two uses:
//   1. decidability witness: it must reproduce the oracle's truth on every task, which shows the text conveys the truth
//      (no hidden fact, no ambiguity the rules leave open) - tested on dev and held-out seeds at every difficulty;
//   2. the white-box attack: a code-writing arm that had the generator source would solve R6 outright. As for synth
//      (catalog-aware script 89-99%), R6 then measures cost and orchestration, not judgment, for such an arm; the B6
//      comparison is between two model arms (wide vs best_of_n) and is unaffected.
import { PROPS, PROP_IDS, POLICIES, rankKey, cmpKeys } from './vocab.mjs';
import { textIndex } from './pipeline.mjs';
import { parseCorpus, RESEARCH_LABELS } from './verify.mjs';
import { parseDay } from './heuristic.mjs';

const TIER = { 'Journal article': 0, Letter: 0, 'Full paper': 0, Preprint: 1, 'Conference abstract': 1, 'Lab note': 2, 'Technical memo': 2, 'Technical report': 2 };
const ENT = '([A-Za-z][a-z]+(?: \\([A-Z]{2,3}-\\d{3,4}\\))?|[A-Z]{2,3}-\\d{3,4})';
const UNITS = ['mg/100 mL', 'mg/mL', 'µg/mL', 'g/L', 'g/cm³', 'kg/m³', 'g/mL', '°C', '°F', 'K', 'min', 'h', 'nM', 'µM', 'pM'];
const VAL = `(-?[\\d,]+(?:\\.\\d+)?)(?: (${UNITS.map(u => u.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')}))?`;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const N = '(?: \\(n = (\\d+)\\))?\\.';
const START = '(?<=^|\\. )';
function tpl(fn) {
  const raw = esc(fn('@E@', '@V@'));
  const first = /^[A-Za-z]/.test(raw) ? `[${raw[0].toUpperCase()}${raw[0].toLowerCase()}]${raw.slice(1)}` : raw;
  const order = raw.indexOf('@E@') < raw.indexOf('@V@') ? ['e', 'v'] : ['v', 'e'];
  return { re: new RegExp(`${START}${first.replace('@E@', ENT).replace('@V@', VAL)}${N}`, 'g'), order };
}
const FORMS = PROP_IDS.flatMap(p => [
  ...PROPS[p].stdText.map(f => ({ p, kind: 'own', cond: 'std', ...tpl(f) })),
  ...PROPS[p].nonstdText.map(f => ({ p, kind: 'own', cond: 'nonstd', ...tpl(f) })),
  ...(PROPS[p].bound ? [{ p, kind: 'bound', cond: 'std', ...tpl(PROPS[p].bound) }] : []),
]);
const toCanon = (p, num, unitLabel) => {
  const u = PROPS[p].units.find(x => x.label === (unitLabel ?? ''));
  if (!u) return null;
  const n = Math.round(Number(num.replace(/,/g, '')) * 10 ** u.dec);
  switch (`${p}:${u.id}`) {
    case 'melting_point:K': return (n - 27315) / 10;
    case 'melting_point:F': return (n - 3200) / 18;
    case 'solubility:ugmL': return n / 10;
    case 'half_life:min': return n / 6;
    case 'ic50:pM': return n / 1000;
    default: return n;
  }
};

export function whiteboxSolve(task) {
  const q = task.inputs.question, Y = parseDay(q.tested_on_or_after);
  const policy = Object.values(POLICIES).find(x => task.prompt.includes(x.text)).id;
  const docs = parseCorpus(task.files), byTitle = new Map(docs.map(d => [d.title, d]));
  const idx = textIndex(task.files, task.inputs.register.entries);
  const codeOf = s => { const m = s.match(/\(([A-Z]{2,3}-\d{3,4})\)$/); if (m) return m[1]; if (/^[A-Z]{2,3}-\d{3,4}$/.test(s)) return s; return idx.entities.find(e => e.name === s.toLowerCase())?.code ?? null; };
  // ---- labs: lab X's names
  const xNames = new Set([q.lab]);
  for (const d of docs) {
    for (const m of d.body.matchAll(/([A-Z][^;:()]+?) \(([A-Z]{2,5})\)/g)) if (m[1].trim() === q.lab) xNames.add(m[2]);
    const m = d.body.match(/^The (.+) was renamed the (.+) on (.+)\. Lab notes/);
    if (m && m[2] === q.lab) xNames.add(m[1]);
  }
  // ---- references: a notice refers to a corpus document only if every detail matches
  const matches = (doc, details) => {
    if (!doc) return false;
    const parts = details.split(/, |; /);
    for (const part of parts) {
      let m;
      if ((m = part.match(/^(.+) et al\.$/))) { if (m[1] !== doc.text.match(/^Authors: ([^,\n]+)/m)[1]) return false; }
      else if ((m = part.match(/^document (D\d{3})$/))) { if (m[1] !== doc.id) return false; }
      else if (/^\d{4}$/.test(part)) { if (new Date(parseDay(doc.published)).getUTCFullYear() !== Number(part)) return false; }
      else if (!Number.isNaN(parseDay(part))) { if (parseDay(part) !== parseDay(doc.published)) return false; }
      else if (part === 'internal lab note') { if (!/^Venue: internal$/m.test(doc.text)) return false; }
      else if (!doc.text.includes(`\nVenue: ${part}\n`)) return false;
    }
    return true;
  };
  const voids = new Set(), errata = [];
  for (const d of docs) {
    let m;
    if ((m = d.body.match(/Retraction of “([^”]+)” \(([^)]*)\)/)) && matches(byTitle.get(m[1]), m[2])) voids.add(byTitle.get(m[1]).id);
    if ((m = d.body.match(/(?:version 2 of the preprint|peer-reviewed version of the preprint) “([^”]+)” \(posted ([^)]+)\)/)) && parseDay(byTitle.get(m[1])?.published) === parseDay(m[2])) voids.add(byTitle.get(m[1]).id);
    if ((m = d.body.match(/Erratum to “([^”]+)” \(([^)]*)\)\. The (.+?) of (.+?) should read (.+?), not (.+?)\. The other values/)) && matches(byTitle.get(m[1]), m[2])) {
      const p = PROP_IDS.find(x => PROPS[x].label === m[3]), v = m[5].match(new RegExp(`^${VAL}$`));
      errata.push({ doc: byTitle.get(m[1]).id, code: codeOf(m[4]), p, canon: toCanon(p, v[1], v[2]) });
    }
  }
  // ---- research documents: claims, tests, test dates
  const research = docs.filter(d => RESEARCH_LABELS.has(d.type)).map(d => {
    const claims = [];
    for (const f of FORMS) for (const m of d.body.matchAll(f.re)) {
      const [e, v, u] = f.order[0] === 'e' ? [m[1], m[2], m[3]] : [m[3], m[1], m[2]];
      claims.push({ code: codeOf(e), p: f.p, kind: f.kind, cond: f.cond, canon: toCanon(f.p, v, u), n: m[4] ? Number(m[4]) : null });
    }
    const docN = Number((d.body.match(/each value is the mean of (\d+) independent samples/) ?? [])[1]) || null;
    for (const c of claims) c.n = c.n ?? docN;
    let test = null, m;
    if ((m = d.body.match(/made on ([^.]+?|\d{2}\.\d{2}\.\d{4})\.(?: |$)/))) test = parseDay(m[1]);
    else if ((m = d.body.match(/assayed between (.+?) and (.+?)\.(?: |$)/))) test = parseDay(m[1]);
    else if ((m = d.body.match(/week beginning (.+?)\.(?: |$)/))) test = parseDay(m[1]);
    else if ((m = d.body.match(/run (\d+) days after the site visit of (.+?)\.(?: |$)/))) test = parseDay(m[2]) + Number(m[1]) * 86400000;
    else if ((m = d.body.match(/\| assayed (.+)$/m))) test = parseDay(m[1]);
    return { ...d, claims, test, tier: TIER[d.type] };
  });
  const inScope = new Set();
  for (const d of research) if (xNames.has(d.affiliation) && !voids.has(d.id) && d.test >= Y) for (const c of d.claims) inScope.add(c.code);
  const table = [];
  for (const code of [...inScope].sort()) for (const p of q.properties) {
    const cands = research.filter(d => !voids.has(d.id)).flatMap(d => d.claims.filter(c => c.code === code && c.p === p && c.kind === 'own' && c.cond === 'std').map(c => {
      const er = errata.find(x => x.doc === d.id && x.code === code && x.p === p);
      return { d, canon: er ? er.canon : c.canon, n: c.n };
    }));
    cands.sort((a, b) => cmpKeys(rankKey(policy, a.d.tier, a.n, parseDay(a.d.published)), rankKey(policy, b.d.tier, b.n, parseDay(b.d.published))));
    if (cands.length) table.push({ entity: code, property: p, value: cands[0].canon / 10 ** PROPS[p].dec, source_doc_id: cands[0].d.id });
  }
  const excluded = research.filter(d => voids.has(d.id) && idx.entities.some(e => inScope.has(e.code) && e.docs.includes(d.id))).map(d => d.id).sort();
  return { table, excluded_doc_ids: excluded };
}
