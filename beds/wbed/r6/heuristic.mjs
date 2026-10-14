// The keyword/heuristic control of R6 (CONTRACT: "a 20-line deterministic script that solves the family from the
// inputs alone is not acceptable"). A dev-era rule that reads only the task text: the compounds are those mentioned in
// documents whose Affiliation line is lab X's full name and that were published on or after the date; a property value
// is the first number after the property's keyword in a sentence naming the compound, converted by its unit; the best
// document is a journal one, then the most recent; void documents are those whose title a retraction notice or a
// version-2 sentence quotes. It ignores test dates, abbreviations and former names, quotes, predictions, conditions,
// bounds, errata and the ranking policy. It is a bad control: it must fail on every task (index.mjs verifier).
//
// It is a weak keyword rule, NOT the answer to W-BED §2.4 items 2 and 4 (review 2026-10-14, finding 1). The corpus is a
// closed template grammar: a parser of the sentence forms visible in dev text (whitebox.mjs with
// `{ phrasing: 'dev-visible' }`, about 60 dense lines) solves every dev task and every held-out task at d2-d4; only the
// d5 split-specific test-date phrasing is unseen. See W-BED-R6-NOTES §3 and §13.
import { textIndex } from './pipeline.mjs';
import { parseCorpus, parseDay } from './verify.mjs';

export { parseDay };
const KEY = { melting_point: /melt/i, solubility: /solubil|dissolved/i, half_life: /half-life/i, ic50: /IC50/, logp: /log [PD]\b/, density: /density/i, pka: /pKa/ };
const UNIT = { '°C': 1, K: x => x - 273.15, '°F': x => (x - 32) / 1.8, 'mg/mL': 1, 'µg/mL': 0.001, 'g/L': 1, 'mg/100 mL': 0.01, h: 1, min: 1 / 60, nM: 1, 'µM': 1000, pM: 0.001, 'g/cm³': 1, 'kg/m³': 0.001, 'g/mL': 1 };
const NUM = /(-?\d[\d,]*(?:\.\d+)?)\s*(mg\/100 mL|mg\/mL|µg\/mL|g\/L|g\/cm³|kg\/m³|g\/mL|°C|°F|K|min|h|nM|µM|pM)?(?![\w/])/;

export function keywordScript(task) {
  const q = task.inputs.question, cut = parseDay(q.tested_on_or_after);
  const docs = parseCorpus(task.files), idx = textIndex(task.files, task.inputs.register.entries);
  const voidTitles = new Set(docs.flatMap(d => [...d.body.matchAll(/(?:Retraction of|version 2 of the preprint) “([^”]+)”/g)].map(m => m[1])));
  const scoped = new Set(docs.filter(d => d.affiliation === q.lab && parseDay(d.published) >= cut).map(d => d.id));
  const ents = idx.entities.filter(e => e.docs.some(id => scoped.has(id)));
  const table = [];
  for (const e of ents) for (const p of q.properties) {
    let best = null;
    for (const d of docs.filter(x => e.docs.includes(x.id) && !voidTitles.has(x.title) && !/Erratum|Retraction|Review|concern|notice/.test(x.type))) {
      for (const s of d.body.split(/(?<=\.)\s+/)) {
        if (!KEY[p].test(s) || !(s.includes(e.code) || (e.name && s.toLowerCase().includes(e.name)))) continue;
        const m = s.slice(s.search(KEY[p])).match(NUM);
        if (!m) continue;
        const f = UNIT[m[2]] ?? 1, x = Number(m[1].replace(/,/g, ''));
        const rank = [/Journal|Letter|Full paper/.test(d.type) ? 0 : 1, -parseDay(d.published)];
        if (!best || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && rank[1] < best.rank[1])) best = { rank, value: typeof f === 'function' ? f(x) : x * f, id: d.id };
        break;
      }
    }
    if (best) table.push({ entity: e.code, property: p, value: Math.round(best.value * 1000) / 1000, source_doc_id: best.id });
  }
  const excluded = docs.filter(d => voidTitles.has(d.title) && ents.some(e => e.docs.includes(d.id))).map(d => d.id);
  return { table, excluded_doc_ids: excluded };
}
