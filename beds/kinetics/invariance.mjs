// Output-invariance relations and the witness tag of the `kinetics` bed (ATTACK-20261014 §3 M1; PROOF-LEDGER K3, K4).
// Host code beside the oracle: no system component sees it. A relation reads the task's prompt and inputs only (never the
// hidden world). Contract: beds/lib/metamorphic.mjs. Why each relation holds for a correct answer:
//   shuffle-samples    every table row names its sample, plate, well, condition and values (and a grouped sheet's rows sit
//                      under their condition line); exclusion (SOP §2), re-reads (§3), corrections (§4) and the fit (§5) are
//                      per well or per condition, and an ordinal well reference ("the first study well (counting from the
//                      left) of plate 5, row A") counts plate columns, which the rows print. So permuting the rows inside
//                      each table leaves the answer unchanged. Prose sentences, chat lines and comments are not moved.
//                      distribution 'out': the generator always lists a plate row's wells left to right, so this variant
//                      also flags a solver that reads an ordinal reference as a table position (the white-box parser
//                      attacks/whitebox-v4.mjs does: 47 of 87 variants of its 29 right d3 answers disagree, eval-invariance
//                      part B; d3 s201 is pinned in beds/lib/metamorphic.test.mjs).
//   shuffle-series     whole plate rows move, each keeping its left-to-right order (details at seriesKeyOf below), so the
//                      generator's listing regularity is kept; distribution 'in'.
//   shuffle-documents  documents carry their own authors and dates; the SOP in force is named by revision and status,
//                      and "the raw export value is the one used" names a document kind. It is not in ATTACK M1's list; it is
//                      added as the order probe for "which source wins" logic (the white-box parser applies a tube-swap
//                      correction only to wells it has already read: d3 s218). Review fix (2026-10-14, M1 review finding 3):
//                      the generator shuffles the documents only at d >= 4 (render.mjs:863; at d2 and d3 every task has the
//                      same document order) and always numbers them by position (render.mjs:864, doc_id D1..Dn; no text
//                      names a doc_id, the ids are assigned after the texts). So the variant renumbers doc_id by its new
//                      position, and its label depends on the task: 'in' at d >= 4, 'out' below (distributionOf; the static
//                      label is 'out'). Built as 'in' at every difficulty, with the old ids kept.
// Regularities (`regularities`, audited by beds/lib/metamorphic.test.mjs): doc_id is D<position>; at d <= 3 the documents are
// in the generator's fixed order; inside every table each plate row's study wells are listed left to right (blank wells
// aside) and a grouped sheet lists [S] ascending (2,520 of 2,520 generated documents, dev 201-260 d2-d5).
// Comparison: the exclusion set exactly, every condition's vmax and km within opts.relTol (default 1e-6: a correct solver
// that fits the same points in another order differs only by rounding; the grading tolerance is 10%).
import { rngOf, permute, shuffleRuns, variantTask, compareKeyed, numClose, shapeViolation, capped, witnessDescriptor } from '../lib/metamorphic.mjs';

// The generator shuffles inputs.documents only from this difficulty on (render.mjs:863).
export const DOCS_SHUFFLED_FROM = 4;

const ID = /\b[A-Z]{2,4}-\d{2,4}\b/;
// The table-row class of a document line, or null: markdown tables, CSV and semicolon exports, reader exports (well, then
// sample), the instrument raw export (plate, well, sample) and grouped summary lines ("  [S] = ...").
export function rowClassOf(line) {
  if (/^\|/.test(line) && !/^\|\s*-/.test(line) && ID.test(line)) return 'pipe';
  if (/^[A-P]\d{2}\s{2,}\S/.test(line) && ID.test(line)) return 'reader';
  if (/^\d{1,2}\s+[A-P]\d{1,2}\s+\S/.test(line) && ID.test(line)) return 'raw';
  if (/^ {2}\[S\] = /.test(line)) return 'grouped';
  if (/^[A-Z]{2,4}-\d{2,4}[,;]/.test(line)) return 'delim';
  return null;
}

const documentsOf = task => (Array.isArray(task.inputs?.documents) ? task.inputs.documents : []);
const DEFAULT_REL_TOL = 1e-6;

// shuffle-series: the generator always lists a plate row's wells left to right, and every exported text keeps that order.
// Solvers may lean on it (an ordinal well reference read as a table position), so the in-distribution relation moves whole
// plate rows (series) and keeps each one's internal order:
//   - CSV / semicolon exports and the instrument raw export (one table, several series): the rows of each (plate, row
//     letter) group, a series' blank well included, are permuted as groups;
//   - markdown sections ("### Plate ..."), reader sections ("Plate N | Assay: ...") and grouped-sheet sections
//     ("Condition: ...") are permuted as sections. A section runs to the next header; the last one ends at its last table
//     row (markdown, grouped) or at the blank line after its operator comments and re-reads (reader, whose comments name
//     wells by position), so the document's closing filler and addenda stay at the end.
const seriesKeyOf = (line, cls) => {
  if (cls === 'delim') { const f = line.split(/[,;]/); return f.length > 2 && /^[A-P]\d{1,2}$/.test(f[2]) ? `${f[1]}:${f[2][0]}` : null; }
  if (cls === 'raw') { const m = line.match(/^(\d{1,2})\s+([A-P])\d{1,2}\s/); return m ? `${m[1]}:${m[2]}` : null; }
  return null;
};
function permuteSeriesInTables(lines, r) {
  const out = [...lines];
  let groups = 0;
  for (let i = 0; i < lines.length;) {
    const c = rowClassOf(lines[i]);
    if (c !== 'delim' && c !== 'raw') { i++; continue; }
    let j = i;
    while (j + 1 < lines.length && rowClassOf(lines[j + 1]) === c) j++;
    const keys = [], byKey = new Map();
    let keyed = true;
    for (let k = i; k <= j; k++) {
      const key = seriesKeyOf(lines[k], c);
      if (key == null) { keyed = false; break; }
      if (!byKey.has(key)) { byKey.set(key, []); keys.push(key); }
      byKey.get(key).push(lines[k]);
    }
    if (keyed && keys.length > 1) {
      const order = permute(keys, r);
      let k = i;
      for (const key of order) for (const l of byKey.get(key)) out[k++] = l;
      groups += keys.length;
    }
    i = j + 1;
  }
  return { lines: out, groups };
}
const SECTIONS = [
  { header: /^### Plate /, row: 'pipe', endLast: 'rows' },
  { header: /^Plate \d+ \| Assay: /, row: 'reader', endLast: 'blank' },
  { header: /^Condition: /, row: 'grouped', endLast: 'rows' },
];
function permuteSections(lines, r) {
  for (const S of SECTIONS) {
    const heads = lines.map((l, i) => (S.header.test(l) ? i : -1)).filter(i => i >= 0);
    if (heads.length < 2) continue;
    const last = heads.at(-1);
    let end = last;
    for (let k = last + 1; k < lines.length; k++) {
      if (S.endLast === 'rows' && rowClassOf(lines[k]) === S.row) end = k;
      if (S.endLast === 'blank') { if (lines[k].trim() === '') break; end = k; }
    }
    const blocks = heads.map((h, n) => lines.slice(h, n + 1 < heads.length ? heads[n + 1] : end + 1));
    const order = permute(blocks.map((_, n) => n), r);
    return { lines: [...lines.slice(0, heads[0]), ...order.flatMap(n => blocks[n]), ...lines.slice(end + 1)], sections: heads.length };
  }
  return { lines, sections: 0 };
}

export function compareKinetics(expected, got, { relTol = DEFAULT_REL_TOL, absTol = 1e-12 } = {}) {
  const ok = o => o && typeof o === 'object' && Array.isArray(o.conditions) && Array.isArray(o.excluded_samples);
  if (!ok(expected)) return shapeViolation('original', 'no conditions / excluded_samples');
  if (!ok(got)) return shapeViolation('variant', 'no conditions / excluded_samples');
  const v = [];
  const E = new Set(expected.excluded_samples.map(String)), G = new Set(got.excluded_samples.map(String));
  const missing = [...E].filter(x => !G.has(x)).sort(), extra = [...G].filter(x => !E.has(x)).sort();
  if (missing.length || extra.length) v.push({ level: 'exclusion-set', missing, extra });
  v.push(...compareKeyed(expected.conditions, got.conditions, 'condition_id', (e, g) => ['vmax', 'km']
    .filter(f => !numClose(e?.[f], g?.[f], relTol, absTol)).map(f => ({ level: 'fit', field: f, expected: e?.[f] ?? null, got: g?.[f] ?? null })), 'condition'));
  return capped(v);
}

export const invariance = Object.freeze([
  {
    id: 'shuffle-samples', kind: 'invariant', distribution: 'out',
    text: 'Permute the sample rows inside every table of every document (seeded). Each row carries its own sample, well and values, so the answer is unchanged.',
    make(task, { seed }) {
      const r = rngOf(seed, 'kinetics', 'shuffle-samples');
      let runs = 0, moved = 0;
      const documents = documentsOf(task).map(d => {
        if (typeof d?.text !== 'string') return d;
        const s = shuffleRuns(d.text.split('\n'), rowClassOf, r);
        runs += s.runs; moved += s.moved;
        return { ...d, text: s.lines.join('\n') };
      });
      if (!moved) return { skip: 'no table with two or more sample rows' };
      return { task: variantTask(task, { inputs: { ...task.inputs, documents } }), info: { runs, moved } };
    },
    check: (orig, variant, info, opts = {}) => compareKinetics(orig, variant, opts),
  },
  {
    id: 'shuffle-series', kind: 'invariant', distribution: 'in',
    text: 'Permute whole plate rows (series) inside every table and document, keeping each plate row\'s wells in their left-to-right order (seeded). Every series carries its own plate, row, condition and replicate, so the answer is unchanged.',
    make(task, { seed }) {
      const r = rngOf(seed, 'kinetics', 'shuffle-series');
      let groups = 0, sections = 0, changed = 0;
      const documents = documentsOf(task).map(d => {
        if (typeof d?.text !== 'string') return d;
        const a = permuteSeriesInTables(d.text.split('\n'), r), b = permuteSections(a.lines, r);
        groups += a.groups; sections += b.sections;
        const text = b.lines.join('\n');
        if (text !== d.text) changed++;
        return text === d.text ? d : { ...d, text };
      });
      if (!changed) return { skip: 'no document with two or more series' };
      return { task: variantTask(task, { inputs: { ...task.inputs, documents } }), info: { groups, sections, documents: changed } };
    },
    check: (orig, variant, info, opts = {}) => compareKinetics(orig, variant, opts),
  },
  {
    id: 'shuffle-documents', kind: 'invariant', distribution: 'out',
    distributionOf: task => (Number(task?.difficulty) >= DOCS_SHUFFLED_FROM ? 'in' : 'out'),
    text: 'Permute the order of inputs.documents and renumber doc_id by position, as the generator does (seeded). Documents carry their own authors and dates, so the answer is unchanged.',
    make(task, { seed }) {
      const docs = documentsOf(task);
      if (docs.length < 2) return { skip: 'fewer than two documents' };
      const moved = permute(docs, rngOf(seed, 'kinetics', 'shuffle-documents'));
      const documents = moved.map((d, i) => (d && typeof d === 'object' && 'doc_id' in d ? { ...d, doc_id: `D${i + 1}` } : d));
      return { task: variantTask(task, { inputs: { ...task.inputs, documents } }), info: { order: moved.map(d => d?.doc_id ?? null) } };
    },
    check: (orig, variant, info, opts = {}) => compareKinetics(orig, variant, opts),
  },
]);

// ---- the generator's listing regularities ('in' variants keep them; beds/lib/metamorphic.mjs) ----
const docKey = d => `${d?.kind ?? ''}\u0000${d?.title ?? ''}\u0000${d?.author ?? ''}\u0000${d?.date ?? ''}`;
// A study well of a table row (blank wells, BLK-, aside): its series key and column; null when the line prints none.
function wellOf(line, cls) {
  if (/\bBLK-\d+/.test(line)) return null;
  let m;
  if (cls === 'delim') { const f = line.split(/[,;]/); m = /^([A-P])(\d{1,2})$/.exec(f[2] ?? ''); return m ? { key: `${f[1]}:${m[1]}`, col: Number(m[2]) } : null; }
  if (cls === 'raw') { m = line.match(/^(\d{1,2})\s+([A-P])(\d{1,2})\s/); return m ? { key: `${m[1]}:${m[2]}`, col: Number(m[3]) } : null; }
  if (cls === 'reader') { m = line.match(/^([A-P])(\d{2})\s/); return m ? { key: m[1], col: Number(m[2]) } : null; }
  if (cls === 'pipe') { m = line.match(/^\|[^|]*\|\s*([A-P])(\d{1,2})\s*\|/); return m ? { key: m[1], col: Number(m[2]) } : null; }
  return null;
}
const concOf = line => { const m = line.match(/^ {2}\[S\] = ([\d.]+(?:[eE][+-]?\d+)?)(?:×10\^(-?\d+))?/); return m ? Number(m[1]) * 10 ** Number(m[2] ?? 0) : null; };
// Inside every run of table rows: each series' study wells left to right; a grouped sheet's [S] ascending.
export function wellsInOrder(text) {
  const lines = String(text ?? '').split('\n');
  for (let i = 0; i < lines.length;) {
    const c = rowClassOf(lines[i]);
    if (!c) { i++; continue; }
    let j = i;
    while (j + 1 < lines.length && rowClassOf(lines[j + 1]) === c) j++;
    if (c === 'grouped') {
      const xs = lines.slice(i, j + 1).map(concOf).filter(x => x != null);
      if (!xs.every((x, k) => k === 0 || xs[k - 1] <= x)) return false;
    } else {
      const last = new Map();
      for (let k = i; k <= j; k++) { const w = wellOf(lines[k], c); if (!w) continue; if (last.has(w.key) && last.get(w.key) > w.col) return false; last.set(w.key, w.col); }
    }
    i = j + 1;
  }
  return true;
}
export const regularities = Object.freeze([
  { id: 'doc-ids-positional', text: 'inputs.documents[i].doc_id is D<i+1> (render.mjs:864)',
    holds: task => documentsOf(task).every((d, i) => d?.doc_id === `D${i + 1}`) },
  { id: 'doc-order-fixed-below-d4', text: 'at d <= 3 the documents are in the generator\'s fixed order (render.mjs:863): a variant keeps its original\'s',
    holds: (task, { original } = {}) => !original || Number(task?.difficulty) >= DOCS_SHUFFLED_FROM
      || documentsOf(task).map(docKey).join('\u0001') === documentsOf(original).map(docKey).join('\u0001') },
  { id: 'wells-left-to-right', text: 'inside every table each plate row\'s study wells are listed left to right (blank wells aside); a grouped sheet lists [S] ascending',
    holds: task => documentsOf(task).every(d => typeof d?.text !== 'string' || wellsInOrder(d.text)) },
]);

// Witness (M1 b): the exclusion set, an exact discrete part of every answer (13 of 13 wrong Stage B answers and 2 of 2 in the
// dev streams differ from a right one there, DEV-NOTES D23, D25). It is checkable only against a second answer (a shadow or
// a variant), not against the inputs. The input-tied count (one conditions entry per study condition, excluded ids of the
// study's well-id form) holds for almost every answer.
export const witness = witnessDescriptor('exclusion-set', [
  { tag: 'exclusion-set', scope: 'cross-run', text: 'excluded_samples equals a second answer\'s exactly (shadow or variant)' },
  { tag: 'count', scope: 'input', text: 'one conditions entry per inputs.study.conditions id; excluded ids have the study\'s TV-NNNN form' },
]);
export const witnessOf = () => witness;
// The input-tied part of the witness: violations of the count check (the exclusion set needs a second answer).
export function witnessCheck(task, output) {
  if (!output || typeof output !== 'object' || !Array.isArray(output.conditions) || !Array.isArray(output.excluded_samples)) return [{ level: 'shape', tag: 'count' }];
  const want = (task.inputs?.study?.conditions ?? []).map(c => c.condition_id).sort(), got = output.conditions.map(c => c?.condition_id).sort();
  const v = [];
  if (want.join('\u0000') !== got.join('\u0000')) v.push({ level: 'count', tag: 'count', want, got });
  const prefix = String(task.inputs?.study?.sample_id_pattern ?? '').slice(0, 2);
  const bad = output.excluded_samples.filter(x => !new RegExp(`^${prefix}-\\d{4}$`).test(String(x)));
  if (prefix && bad.length) v.push({ level: 'count', tag: 'count', notStudyWells: bad.slice(0, 10) });
  if (new Set(output.excluded_samples).size !== output.excluded_samples.length) v.push({ level: 'count', tag: 'count', duplicates: true });
  return v;
}
