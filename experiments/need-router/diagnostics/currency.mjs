// Is the committed analysis/m0/diagnostics.json current? It records, beside every number, the sha256 of the file the number came from (stages.json,
// the census, the corpus, SPEC-E.md, the anchor beds' module graphs, the archive) and a fingerprint of the diagnostics' own code. Comparing the whole
// file byte for byte conflates two things the reader needs apart:
//   - the RESULTS (every number and label): they must reproduce exactly from the same inputs and code, so a difference with nothing moved is a bug;
//   - the PROVENANCE (those hashes): when an input moves (a stage cap added to stages.json, a line edited in SPEC-E.md, an anchor bed revised), the
//     committed file is out of date whether or not its numbers change, and the honest message is "inputs moved, re-run run.mjs --report", not a
//     failed mismatch. An edit to stages.json that leaves D0 unchanged must not break the suite.
// splitProvenance separates the two; compareCurrency says, per section, which kind of difference (if any) there is.
//   current       nothing differs
//   inputsMoved   provenance hashes differ; the results of every section match, or differ only in sections whose own inputs moved
//   codeMoved     the diagnostics' own code fingerprint differs
//   resultsDiffer sections whose results differ with none of their inputs moved: not reproducible, or the committed file predates a code change
export const PROVENANCE_KEYS = Object.freeze(['sha256', 'bytes', 'chars', 'files', 'dirs']);
// Sections that read the archived rows (inputs.legacySources) rather than files of their own.
export const ARCHIVE_SECTIONS = Object.freeze(['d2', 'd3', 'd4', 'd6']);

/** { results, hashes }: `results` is a deep copy of the document without provenance; `hashes` maps each object's path to the provenance it carried. */
export function splitProvenance(doc) {
  const hashes = {};
  const walk = (v, p) => {
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${p}[${i}]`));
    if (!v || typeof v !== 'object') return v;
    const out = {};
    const prov = typeof v.sha256 === 'string';
    if (prov) {
      hashes[p] = {};
      for (const k of PROVENANCE_KEYS) if (k in v) hashes[p][k] = v[k];
      if ('bed' in v && 'version' in v) hashes[p].version = v.version;
    }
    for (const [k, x] of Object.entries(v)) {
      if (prov && (PROVENANCE_KEYS.includes(k) || (k === 'version' && 'bed' in v))) continue;
      out[k] = walk(x, p ? `${p}.${k}` : k);
    }
    return out;
  };
  const { code, ...rest } = doc;
  const results = walk(rest, '');
  if (code) hashes.code = code;
  return { results, hashes };
}
const sectionOf = p => p.split(/[.[]/)[0];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Compare a committed document with a fresh run. */
export function compareCurrency(committed, fresh) {
  const c = splitProvenance(committed), f = splitProvenance(fresh);
  const moved = [];
  for (const p of new Set([...Object.keys(c.hashes), ...Object.keys(f.hashes)])) {
    if (!same(c.hashes[p], f.hashes[p])) moved.push({ at: p, was: c.hashes[p] ?? null, now: f.hashes[p] ?? null });
  }
  moved.sort((a, b) => (a.at < b.at ? -1 : 1));
  const codeMoved = moved.filter(m => m.at === 'code').length > 0;
  const inputsMoved = moved.filter(m => m.at !== 'code');
  const movedSections = new Set(inputsMoved.map(m => sectionOf(m.at)));
  const archiveMoved = movedSections.has('inputs');
  const sectionMoved = s => movedSections.has(s) || (ARCHIVE_SECTIONS.includes(s) && archiveMoved);
  const resultsDiffer = [], staleBecauseInputsMoved = [];
  for (const s of new Set([...Object.keys(c.results), ...Object.keys(f.results)])) {
    if (same(c.results[s], f.results[s])) continue;
    (sectionMoved(s) ? staleBecauseInputsMoved : resultsDiffer).push(s);
  }
  resultsDiffer.sort(); staleBecauseInputsMoved.sort();
  return {
    current: !moved.length && !resultsDiffer.length && !staleBecauseInputsMoved.length,
    inputsMoved, codeMoved, staleBecauseInputsMoved, resultsDiffer,
    // exit code of run.mjs --check: 0 current, 2 inputs or code moved (re-run), 1 results differ with nothing of theirs moved
    status: resultsDiffer.length ? 'results-differ' : (inputsMoved.length || codeMoved || staleBecauseInputsMoved.length) ? 'inputs-moved' : 'current',
  };
}

/** One line for a person. */
export function describeCurrency(r) {
  if (r.status === 'current') return 'diagnostics.json is current';
  const parts = [];
  if (r.resultsDiffer.length) parts.push(`results differ with no input moved in ${r.resultsDiffer.join(', ')} (not reproducible, or the file predates a change of code)`);
  if (r.inputsMoved.length) parts.push(`inputs moved: ${r.inputsMoved.map(m => m.at).join(', ')}`);
  if (r.codeMoved) parts.push('the diagnostics code changed');
  if (r.staleBecauseInputsMoved.length) parts.push(`numbers differ in ${r.staleBecauseInputsMoved.join(', ')} because their inputs moved`);
  return `${r.status === 'inputs-moved' ? 'inputs moved, re-run run.mjs --report: ' : 'MISMATCH: '}${parts.join('; ')}`;
}
