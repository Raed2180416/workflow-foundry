// Code unit checks for an R6 answer, from the task alone (prompt, inputs, files): the "code unit checks" half of the
// reference's verify (W-BED §3.6: "panel of 3 on a 20% sample plus code unit checks"). No oracle, no world: any arm may
// run it, and best_of_n uses the same checks to select (the B6 comparison needs one verifier for both arms).
// Reported, not gating: its recall against the bed's controls is measured in the tests and in W-BED-R6-NOTES §6.
//
// Also the plan's code check (`codePlan`, `coverageIssues`): the reference's `check` made concrete. The review
// (2026-10-14, finding 2) showed it is a complete plan by itself: the lab's names come from two one-sentence consortium
// notices and the candidates from the header fields and the mention index, so a plan judge is optional.
import { validate } from '../lib/contracts.mjs';
import { MONTHS } from '../lib/domain.mjs';
import { outputSchema, resolveWith } from './score.mjs';
import { PROPS } from './vocab.mjs';
import { textIndex } from './pipeline.mjs';

export const RESEARCH_LABELS = new Set(['Journal article', 'Letter', 'Full paper', 'Preprint', 'Lab note', 'Technical memo', 'Conference abstract', 'Technical report']);
const field = (text, name) => (text.match(new RegExp(`^${name}: (.*)$`, 'm')) ?? [])[1] ?? null;

/** Day (ms since epoch, UTC) of a date in any of the corpus's printed styles; NaN otherwise. */
export function parseDay(s) {
  const t = String(s ?? '').trim();
  let m;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if ((m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})$/))) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  if ((m = t.match(/^(\d{1,2}) (\w+) (\d{4})$/))) return Date.UTC(+m[3], MONTHS.indexOf(m[2]), +m[1]);
  if ((m = t.match(/^(\w+) (\d{1,2})\w*, (\d{4})$/))) return Date.UTC(+m[3], MONTHS.indexOf(m[1]), +m[2]);
  return NaN;
}

/** Parsed corpus: [{ id, type, title, affiliation, published, body, text }]. */
export function parseCorpus(files) {
  return Object.entries(files).filter(([p]) => p.startsWith('corpus/')).map(([p, text]) => ({
    id: p.slice(7, -4), text, type: field(text, 'Type'), title: field(text, 'Title'), affiliation: field(text, 'Affiliation'), published: field(text, 'Published'),
    body: text.split('\n\n').slice(1).join('\n\n'),
  }));
}

const cache = new WeakMap();
function prepared(task) {
  if (cache.has(task.files)) return cache.get(task.files);
  const docs = parseCorpus(task.files);
  const byId = new Map(docs.map(d => [d.id, d]));
  const idx = textIndex(task.files, task.inputs.register.entries);
  const byString = new Map();
  for (const e of idx.entities) { byString.set(e.code.toUpperCase(), e); if (e.name) byString.set(e.name.toLowerCase(), e); }
  // titles quoted by retraction notices (with the first author when the notice names one), and preprints replaced by a
  // later version (code only; a notice that also gives a venue or date is not checked on those)
  const retracted = new Map(), replacedTitles = new Set();
  for (const d of docs) {
    for (const m of d.body.matchAll(/Retraction of “([^”]+)” \(([^)]*)\)/g)) {
      const author = (m[2].match(/^([A-Z]\. [^,]+?) et al\./) ?? [])[1] ?? null;
      if (!retracted.has(m[1])) retracted.set(m[1], []);
      retracted.get(m[1]).push(author);
    }
    for (const m of d.body.matchAll(/(?:version 2 of the preprint|peer-reviewed version of the preprint) “([^”]+)”/g)) replacedTitles.add(m[1]);
  }
  const p = { docs, byId, idx, byString, retracted, replacedTitles };
  cache.set(task.files, p);
  return p;
}
const firstAuthor = d => (d.text.match(/^Authors: ([^,\n]+)/m) ?? [])[1] ?? null;

/** Every name of lab `lab` the corpus states: the full name, its abbreviation (membership notice), a former name (rename notice). */
export function labNamesOf(docs, lab) {
  const names = new Set([lab]);
  for (const d of docs) {
    const mem = d.body.match(/abbreviations used in documents: (.+)\.\s*$/);
    if (mem) for (const part of mem[1].split('; ')) { const m = part.match(/^(.+) \(([A-Z]{2,5})\)$/); if (m && m[1] === lab) names.add(m[2]); }
    const ren = d.body.match(/^The (.+) was renamed the (.+) on .+?\. Lab notes/);
    if (ren && ren[2] === lab) names.add(ren[1]);
  }
  return names;
}

/**
 * The plan as code, from the task text only: every compound (index code) mentioned in a research document whose
 * Affiliation is one of the lab's names and that was published on or after the date. Recall-complete by construction
 * (a test on or after the date is published on or after it); the workers restore precision. Sorted codes.
 */
export function codePlan(task) {
  const p = prepared(task);
  const q = task.inputs.question, cut = parseDay(q.tested_on_or_after);
  const names = labNamesOf(p.docs, q.lab);
  const ids = new Set(p.docs.filter(d => RESEARCH_LABELS.has(d.type) && names.has(d.affiliation) && parseDay(d.published) >= cut).map(d => d.id));
  return p.idx.entities.filter(e => e.docs.some(id => ids.has(id))).map(e => e.code).sort();
}

/**
 * The plan's code check (W-BED §3.6 "check: code mention index (gaps, duplicates)"): candidate strings that name no
 * indexed compound, compounds listed twice (e.g. by name and by code), and gaps (codePlan compounds not listed).
 */
export function coverageIssues(task, candidates) {
  const p = prepared(task);
  const codes = candidates.map(s => resolveWith(p.byString, s)?.code ?? null);
  const unknown = candidates.filter((_, i) => !codes[i]).map(String);
  const seen = new Set(), duplicates = [];
  for (const c of codes) if (c) { if (seen.has(c)) duplicates.push(c); seen.add(c); }
  const gaps = codePlan(task).filter(c => !seen.has(c));
  return { ok: !unknown.length && !duplicates.length && !gaps.length, unknown, duplicates, gaps };
}
const voidByTitle = (p, d) => p.replacedTitles.has(d.title) || (p.retracted.get(d.title) ?? []).some(a => a === null || a === firstAuthor(d));

/** { ok, issues: [{ check, at }] }. Checks: schema; a non-empty table; requested property; entity known; one row per (entity, property);
 *  every listed entity has every requested property; source exists, is a research document and mentions the entity;
 *  source not retracted or replaced by title; value inside the property's plausible range; excluded documents exist,
 *  are research documents and are void by title; no excluded document cited. */
export function unitChecks(task, output) {
  const issues = [];
  const errs = validate(outputSchema, output);
  if (errs.length) return { ok: false, issues: [{ check: 'schema', at: errs[0] }] };
  const p = prepared(task);
  const req = new Set(task.inputs.question.properties);
  const seen = new Set(), propsOf = new Map();
  const excluded = new Set(output.excluded_doc_ids.map(x => String(x).trim().toUpperCase()));
  if (!output.table.length) issues.push({ check: 'table-empty', at: 'table' });
  output.table.forEach((row, i) => {
    const at = `table[${i}]`;
    if (!req.has(row.property)) issues.push({ check: 'property-not-requested', at });
    const e = resolveWith(p.byString, row.entity);
    if (!e) { issues.push({ check: 'entity-unknown', at }); return; }
    const key = `${e.code}|${row.property}`;
    if (seen.has(key)) issues.push({ check: 'duplicate-row', at });
    seen.add(key);
    if (!propsOf.has(e.code)) propsOf.set(e.code, new Set());
    propsOf.get(e.code).add(row.property);
    const src = p.byId.get(String(row.source_doc_id).trim().toUpperCase());
    if (!src) { issues.push({ check: 'source-missing', at }); return; }
    if (!RESEARCH_LABELS.has(src.type)) issues.push({ check: 'source-not-research', at });
    if (!e.docs.includes(src.id)) issues.push({ check: 'source-does-not-mention', at });
    if (voidByTitle(p, src)) issues.push({ check: 'source-void-by-title', at });
    if (excluded.has(src.id)) issues.push({ check: 'source-excluded', at });
    const P = PROPS[row.property];
    if (P) {
      const [lo, hi] = P.range, v = row.value * 10 ** P.dec, pad = (hi - lo) * 0.5;
      if (!(v >= lo - pad && v <= hi + pad)) issues.push({ check: 'value-out-of-range', at });
    }
  });
  for (const [code, ps] of propsOf) for (const r of req) if (!ps.has(r)) issues.push({ check: 'entity-incomplete', at: code });
  for (const id of excluded) {
    const d = p.byId.get(id);
    if (!d) issues.push({ check: 'excluded-missing', at: id });
    else if (!RESEARCH_LABELS.has(d.type)) issues.push({ check: 'excluded-not-research', at: id });
    else if (!voidByTitle(p, d)) issues.push({ check: 'excluded-not-void-by-title', at: id });
  }
  return { ok: issues.length === 0, issues };
}
