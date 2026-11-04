// Coordination-failure coder for the swarm arm (swarm ladder, research/swarm-20261021/PREREG-SWARM-R1.md §8.2). Exact, by
// program, against the bed's ground truth (rootcause.mjs truthOf), never by an LLM judge: Who&When (arXiv 2505.00212)
// found automated attribution picks the failing agent at most 53.5% of the time and the failing step 14.2%.
//
// Input: the task, the spawn tree (spawn-tree.mjs), the final answer, the session facts (error code, the CLI's
// subagent_stats, model drift) and the files the workers wrote (path -> text, from the run archive).
// Output: { codes: {K1..K11: bool}, detail: {...}, mast: [...] }.
//
//   K1  serial collapse         <= 1 worker (Kimi K2.5's term)
//   K2  over-fan-out            > 32 workers, or more than 1.5x the plan candidates (Kimi's spurious parallelism)
//   K3  plan coverage gap       an in-scope compound missing from the answer that no brief assigned (by code, name or a
//                               document range holding its establishing document), no worker returned and the lead never saw
//   K4  duplicate assignment    an in-scope compound named in two or more briefs
//   K5  aggregation loss        a worker returned the right row (no other worker disagreed); the answer lost or altered it
//   K6  worker error            the answer's wrong row equals a worker's wrong row, or a worker ended in error
//   K7  conflict resolved wrong two workers disagreed on a cell, one was right, the answer is not
//   K8  write collision         two workers wrote one path, or a worker wrote ./answer.json (the lead owns it)
//   K9  limit hit               session timeout or budget stop, or the CLI refused or killed a subagent (depth, concurrency,
//                               budget)
//   K10 premature termination   a worker never returned, or the session ended without ./answer.json
//   K11 model drift             a model other than Haiku 5.5 served a message (voids the trial)
import { truthOf, seenDocs } from './rootcause.mjs';
import { PROPS } from '../../beds/wbed/r6/vocab.mjs';

export const MAX_WORKERS_RUNG1 = 32, OVERFAN_RATIO = 1.5;
// MAST (arXiv 2503.13657 v3) modes per code; [] where MAST has no mode (a harness limit, Kimi's metrics).
export const MAST = Object.freeze({
  K1: [], K2: [], K3: ['FM-1.1'], K4: ['FM-1.3'], K5: ['FM-2.4', 'FM-2.5'], K6: [], K7: ['FM-3.3'], K8: ['FM-1.2'], K9: [], K10: ['FM-3.1', 'FM-1.5'], K11: [],
});
export const CODES = Object.freeze(Object.keys(MAST));

// ---------------------------------------------------------------------------------------------------------------------
// Rows a worker returned: every JSON value in its report text or in a file it wrote, walked for row-shaped objects.
/** JSON values embedded in free text: the whole text, fenced blocks, then each balanced {...} / [...] that parses. */
export function jsonValuesIn(text) {
  const s = String(text ?? '');
  const out = [];
  const tryParse = x => { try { out.push(JSON.parse(x)); return true; } catch { return false; } };
  if (tryParse(s.trim())) return out;
  for (const m of s.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) tryParse(m[1].trim());
  if (out.length) return out;
  // balanced scan, outermost first
  for (let i = 0; i < s.length; i++) {
    const open = s[i];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const ch = s[j];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) { if (tryParse(s.slice(i, j + 1))) i = j; break; }
    }
  }
  return out;
}
const ENTITY_KEYS = ['entity', 'compound', 'code', 'name', 'id'];
const VALUE_KEYS = ['value', 'accepted_value', 'val'];
const SOURCE_KEYS = ['source_doc_id', 'source', 'doc', 'doc_id', 'document', 'source_doc'];
const first = (o, keys) => { for (const k of keys) if (o && o[k] != null && typeof o[k] !== 'object') return o[k]; return undefined; };
/** Row-shaped objects in a JSON value: {entity, property, value, source} and the per-compound shape
 *  {compound|code|entity, cells|properties|values: {prop: {value, source}} | [{property, value, source}]}. */
export function rowsIn(value, props) {
  const rows = [];
  const visit = (v, ctxEntity) => {
    if (Array.isArray(v)) { v.forEach(x => visit(x, ctxEntity)); return; }
    if (!v || typeof v !== 'object') return;
    const ent = first(v, ENTITY_KEYS) ?? ctxEntity;
    const prop = v.property ?? v.prop;
    const val = first(v, VALUE_KEYS);
    if (ent != null && typeof prop === 'string' && val != null && Number.isFinite(Number(val))) rows.push({ entity: String(ent), property: prop, value: Number(val), source_doc_id: first(v, SOURCE_KEYS) ?? null });
    for (const [k, x] of Object.entries(v)) {
      if (props.includes(k) && x && typeof x === 'object' && !Array.isArray(x)) {
        const val2 = first(x, VALUE_KEYS);
        if (ent != null && val2 != null && Number.isFinite(Number(val2))) rows.push({ entity: String(ent), property: k, value: Number(val2), source_doc_id: first(x, SOURCE_KEYS) ?? null });
      } else if (x && typeof x === 'object') visit(x, ent);
    }
  };
  visit(value, undefined);
  return rows;
}

const lc = s => String(s ?? '').toLowerCase();
const mentioned = (text, e) => { const t = lc(text); return t.includes(lc(e.code)) || new RegExp(`(?<![a-z])${lc(e.name)}(?![a-z])`).test(t); };
/** Document ids a brief assigns: explicit Dnnn ids, ranges (D001-D050, D001 to D050, documents 1-50) and globs (D0*). */
export function briefDocs(text) {
  const s = String(text ?? '');
  const ids = new Set();
  const add = n => { if (n >= 1 && n <= 999) ids.add(`D${String(n).padStart(3, '0')}`); };
  for (const m of s.matchAll(/\bD(\d{3})\s*(?:-|–|—|to|through|\.\.)\s*D?(\d{1,3})\b/g)) { const a = Number(m[1]), b = Number(m[2]); for (let n = a; n <= Math.min(b, a + 999); n++) add(n); }
  for (const m of s.matchAll(/\bdocuments?\s+(\d{1,3})\s*(?:-|–|—|to|through)\s*(\d{1,3})\b/gi)) { const a = Number(m[1]), b = Number(m[2]); for (let n = a; n <= b; n++) add(n); }
  for (const m of s.matchAll(/\bD(\d{1,2})\*/g)) { const p = m[1], lo = Number(p.padEnd(3, '0')), hi = Number(p.padEnd(3, '9')); for (let n = lo; n <= hi; n++) add(n); }
  for (const m of s.matchAll(/\bD(\d{3})\b/g)) add(Number(m[1]));
  return ids;
}
const sameCell = (truth, row, p) => Math.round(Number(row.value) * 10 ** PROPS[p].dec) === truth.canon && String(row.source_doc_id ?? '').trim().toUpperCase() === truth.source;

/**
 * Code one swarm session. workFiles: { path: text } of files under the workdir the session wrote (archived). Every count
 * is about in-scope compounds and their cells (the oracle's units).
 */
export function codeSession({ task, tree, output, error = null, stats = null, drift = [], workFiles = {}, events = [] }) {
  const t = truthOf(task);
  const props = t.world.props;
  const workers = tree.workers ?? [];
  const inScope = [...t.inScope];
  // rows per worker (report + files it wrote)
  const fileText = p => workFiles[p] ?? workFiles[String(p).replace(/^.*?\/(work\/)/, '$1')] ?? null;
  const rowsBy = workers.map(w => {
    const texts = [w.report ?? w.result ?? '', ...(w.writes ?? []).map(fileText).filter(x => x != null)];
    const rows = texts.flatMap(x => jsonValuesIn(x)).flatMap(v => rowsIn(v, props));
    return rows.map(r => ({ ...r, code: t.resolve(r.entity) })).filter(r => r.code);
  });
  const answerRows = new Map();
  for (const r of Array.isArray(output?.table) ? output.table : []) { const c = t.resolve(r?.entity); if (c && !answerRows.has(`${c}|${r.property}`)) answerRows.set(`${c}|${r.property}`, r); }
  const answerCodes = new Set([...answerRows.keys()].map(k => k.split('|')[0]));

  const d = {};
  // K1, K2
  d.workers = workers.length; d.candidates = t.candidates.length;
  const K1 = workers.length <= 1;
  const K2 = workers.length > MAX_WORKERS_RUNG1 || workers.length > OVERFAN_RATIO * t.candidates.length;
  // assignment by brief
  const assigned = new Map(inScope.map(c => [c, []]));
  workers.forEach((w, i) => {
    const docs = briefDocs(w.brief);
    for (const c of inScope) {
      const e = t.entByCode.get(c);
      const byName = mentioned(w.brief, e), byDoc = (t.establishing.get(c) ?? []).some(id => docs.has(id));
      if (byName || byDoc) assigned.get(c).push({ worker: i, byName, byDoc });
    }
  });
  const returnedBy = new Map(inScope.map(c => [c, new Set()]));
  rowsBy.forEach((rows, i) => { for (const r of rows) if (returnedBy.has(r.code)) returnedBy.get(r.code).add(i); });
  workers.forEach((w, i) => { for (const c of inScope) if (mentioned(w.report ?? w.result ?? '', t.entByCode.get(c))) returnedBy.get(c).add(i); });
  const leadSeen = seenDocs(events, { parent: null });
  const missing = inScope.filter(c => !answerCodes.has(c));
  d.missing = missing.length;
  d.planGap = missing.filter(c => !assigned.get(c).length && !returnedBy.get(c).size && !(t.establishing.get(c) ?? []).some(id => leadSeen.has(id)));
  const K3 = d.planGap.length > 0;
  d.duplicateAssigned = inScope.filter(c => assigned.get(c).filter(a => a.byName).length >= 2);
  const K4 = d.duplicateAssigned.length > 0;
  d.unassigned = inScope.filter(c => !assigned.get(c).length);
  // K5, K6, K7 per cell
  const loss = [], conflictWrong = [], workerErr = [];
  for (const c of inScope) for (const p of props) {
    const k = `${c}|${p}`, truth = t.cells.get(k);
    const offered = rowsBy.flatMap((rows, i) => rows.filter(r => r.code === c && r.property === p).map(r => ({ ...r, worker: i })));
    if (!offered.length) continue;
    const right = offered.filter(r => sameCell(truth, r, p)), wrong = offered.filter(r => !sameCell(truth, r, p));
    const a = answerRows.get(k), aOk = a && sameCell(truth, a, p);
    if (aOk) continue;
    if (right.length && !wrong.length) loss.push(k);
    else if (right.length && wrong.length) conflictWrong.push(k);
    else if (a && wrong.some(r => Math.round(Number(r.value) * 10 ** PROPS[p].dec) === Math.round(Number(a.value) * 10 ** PROPS[p].dec) && lc(r.source_doc_id) === lc(a.source_doc_id))) workerErr.push(k);
  }
  d.aggregationLoss = loss; d.conflictWrong = conflictWrong; d.workerWrongPropagated = workerErr;
  d.workerErrors = workers.filter(w => w.isError || (w.resultMeta?.status && w.resultMeta.status !== 'completed')).map(w => w.id);
  const K5 = loss.length > 0, K7 = conflictWrong.length > 0, K6 = workerErr.length > 0 || d.workerErrors.length > 0;
  // K8 writes
  const writers = new Map();
  workers.forEach((w, i) => { for (const p of w.writes ?? []) { const n = String(p).replace(/^\.\//, ''); writers.set(n, [...(writers.get(n) ?? []), i]); } });
  d.collisions = [...writers.entries()].filter(([, ws]) => new Set(ws).size > 1).map(([p]) => p);
  d.workerWroteAnswer = [...writers.keys()].some(p => /(^|\/)answer\.json$/.test(p));
  const K8 = d.collisions.length > 0 || d.workerWroteAnswer;
  // K9 limits
  const refused = stats?.refused ?? {}, killed = stats?.killed ?? {};
  d.limit = { error: error?.code ?? null, refused: Object.values(refused).reduce((a, b) => a + (b ?? 0), 0), killed: Object.values(killed).reduce((a, b) => a + (b ?? 0), 0) };
  const K9 = ['EXECUTOR_TIMEOUT', 'EXECUTOR_BUDGET'].includes(d.limit.error) || d.limit.refused > 0 || d.limit.killed > 0;
  // K10
  d.unreturned = workers.filter(w => w.result == null).map(w => w.id);
  const K10 = d.unreturned.length > 0 || output == null;
  const K11 = (drift ?? []).length > 0;
  const codes = { K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11 };
  return { codes, detail: d, mast: [...new Set(CODES.filter(k => codes[k]).flatMap(k => MAST[k]))].sort() };
}

/** $0 counterfactual replays for a failed swarm session (§8.3): what the answer would score if the lead had carried every
 *  worker row (ties: the most frequent value/source), and what the plan's code coverage check (rung 2's guard) would have
 *  flagged on the briefs. `bed` is the wbed-r6 module (oracle, coverageIssues). */
export function replays({ task, tree, output, workFiles = {}, bed }) {
  const t = truthOf(task), props = t.world.props;
  const fileText = p => workFiles[p] ?? workFiles[String(p).replace(/^.*?\/(work\/)/, '$1')] ?? null;
  const offered = (tree.workers ?? []).flatMap(w => [w.report ?? w.result ?? '', ...(w.writes ?? []).map(fileText).filter(x => x != null)])
    .flatMap(x => jsonValuesIn(x)).flatMap(v => rowsIn(v, props)).map(r => ({ ...r, code: t.resolve(r.entity) })).filter(r => r.code && props.includes(r.property));
  const votes = new Map();
  for (const r of offered) {
    const k = `${r.code}|${r.property}`, v = `${Math.round(r.value * 10 ** PROPS[r.property].dec)}|${String(r.source_doc_id ?? '').toUpperCase()}`;
    const m = votes.get(k) ?? new Map(); m.set(v, { n: (m.get(v)?.n ?? 0) + 1, r }); votes.set(k, m);
  }
  const answerRows = new Map((output?.table ?? []).map(r => [`${t.resolve(r?.entity)}|${r?.property}`, r]));
  const carried = { table: [], excluded_doc_ids: output?.excluded_doc_ids ?? [] };
  const keys = new Set([...answerRows.keys()].filter(k => !k.startsWith('null|')));
  for (const k of votes.keys()) keys.add(k);
  for (const k of keys) {
    const m = votes.get(k);
    if (m) { const best = [...m.values()].sort((a, b) => b.n - a.n)[0].r; carried.table.push({ entity: best.code, property: best.property, value: best.value, source_doc_id: best.source_doc_id ?? '' }); }
    else carried.table.push(answerRows.get(k));
  }
  const carriedVerdict = bed.oracle(task, carried);
  // the plan as the briefs state it: every compound (any form) a brief names
  const named = [...new Set((tree.workers ?? []).flatMap(w => t.world.entities.filter(e => mentioned(w.brief, e)).map(e => e.code)))];
  const cov = bed.coverageIssues(task, named);
  const answerCodes = new Set((output?.table ?? []).map(r => t.resolve(r?.entity)).filter(Boolean));
  const missing = [...t.inScope].filter(c => !answerCodes.has(c));
  return { carried: { pass: carriedVerdict.pass, score: carriedVerdict.score, rows: carried.table.length, offeredRows: offered.length },
    briefPlan: { named: named.length, ok: cov.ok, unknown: cov.unknown.length, duplicates: cov.duplicates.length, gaps: cov.gaps.length,
      missingFlagged: missing.filter(c => cov.gaps.includes(c)).length, missing: missing.length } };
}
