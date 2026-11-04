// Root cause of every wrong answer on W-bed R6 (swarm ladder, research/swarm-20261021/PREREG-SWARM-R1.md §8). Analyst
// side only: it rebuilds the hidden world from (seed, split, difficulty) and is never shown to an arm. Nothing here calls
// a model.
//
// Step 1 (classify): every oracle error is cut into units: a missing compound, an extra compound, an unknown entity string,
// a missing or extra cell, a duplicate row, a wrong cell, a missing or extra excluded document.
// Step 2 (trap): each unit is mapped to the bed trap it hit, from the world's construction roles (W-BED-R6-NOTES §2):
//   scope    alias:abbr | alias:former | code-only | novel-date (the d5 split-specific test-date form) | plain-missed;
//            extra: T1 tested-before-cutoff | T2 quote-only | T3 retracted-only | T4 planned | T6 namesake | bg-*;
//   cell     by counterfactual: the bed's own resolver re-run with one mistake switched on (retracted kept, superseded kept,
//            non-standard counted, bounds, quotes, predictions, errata skipped, erratum cited, recency only, no unit
//            conversion, concern voids, retraction by title, novel kind mis-ranked); the mistakes whose (value, source)
//            equal the wrong row's are its trap; none: `unexplained`;
//   excluded why the document is (not) void, and whether it is a cascade of a missing or extra compound.
// Step 3 (locus) is per arm and lives with the arm's record (coord.mjs for the swarm, readLocus here for agent sessions).
import '../../beds/wbed/r6/index.mjs';   // installs the decisiveness verifier: buildWide refuses to build without it
import { buildWide, isResearch, tierOfDoc, testsOf, printedCanon } from '../../beds/wbed/r6/world.mjs';
import { runPipeline, voidKeys } from '../../beds/wbed/r6/pipeline.mjs';
import { resolveWith } from '../../beds/wbed/r6/score.mjs';
import { PROPS, canonValue, unitOf, rankKey, cmpKeys } from '../../beds/wbed/r6/vocab.mjs';

const memo = new Map();
/** The analyst-side truth of one task ({seed, split, difficulty}), cached per spec. */
export function truthOf(task) {
  const key = `${task.split ?? 'dev'}|${task.difficulty ?? 3}|${task.seed}`;
  if (memo.has(key)) return memo.get(key);
  const world = buildWide(task.seed, task.split ?? 'dev', task.difficulty ?? 3);
  const tr = runPipeline(world, { traces: false });
  const vis = world.docs, voids = voidKeys(world, vis);
  const X = world.labs.find(l => l.isX);
  const byId = new Map(world.docs.map(d => [d.id, d]));
  const entByCode = new Map(world.entities.map(e => [e.code, e]));
  const entById = new Map(world.entities.map(e => [e.id, e]));
  const lookup = new Map();
  for (const e of world.entities) { lookup.set(e.code.toUpperCase(), e.code); lookup.set(e.name.toLowerCase(), e.code); }
  const resolve = s => resolveWith(lookup, s);
  const inScope = new Set(tr.worker.items.filter(x => x.in_scope).map(x => resolve(x.entity)));
  const cells = new Map();
  for (const r of tr.reduce.table) cells.set(`${resolve(r.entity)}|${r.property}`, { canon: Math.round(r.value * 10 ** PROPS[r.property].dec), source: r.source_doc_id });
  for (const c of world.truthCells) { const k = `${entById.get(c.e).code}|${c.p}`; if (cells.has(k)) Object.assign(cells.get(k), { traps: c.traps, winnerKey: c.winner }); }
  // The documents that put a compound in scope: lab X's own surviving research documents testing it on or after the cut-off.
  const establishing = new Map();
  for (const code of inScope) {
    const e = entByCode.get(code);
    establishing.set(code, vis.filter(d => isResearch(d) && d.lab === world.X && !voids.has(d.key) && testsOf(d).has(e.id) && d.testDay != null && d.testDay >= world.Y).map(d => d.id).sort());
  }
  const t = { world, X, vis, voids, byId, entByCode, entById, resolve, inScope, cells, excluded: new Set(tr.reduce.excluded_doc_ids), establishing,
    candidates: tr.plan.candidates.map(s => resolve(s)), tier: world.tier };
  memo.set(key, t);
  return t;
}

// ------------------------------------------------------------------------------------------------------------------
// The cell resolver, with one mistake switched on. With no option it equals the bed's resolveCell (tested on every cell
// of dev seeds); `tierOf` overrides the venue tier (the novel-kind mistake: a technical report or conference abstract
// ranked as a journal publication).
function resolveAlt(world, vis, voids, eId, p, opts = {}) {
  const tierFn = opts.tierOf ?? tierOfDoc;
  const cands = [];
  for (const d of vis) {
    if (!isResearch(d) || voids.has(d.key)) continue;
    for (const c of d.claims) {
      if (c.e !== eId || c.p !== p) continue;
      const counts = (c.kind === 'own' && c.cond === 'std') || (opts.nonstdCounted && c.kind === 'own' && c.cond === 'nonstd') || (opts.boundsCounted && c.kind === 'bound');
      if (!counts) continue;
      const er = opts.errataSkipped ? null : vis.find(n => n.kind === 'erratum' && n.target === d.key && n.notice.e === c.e && n.notice.p === c.p) ?? null;
      cands.push({ d, canon: er ? er.notice.to : printedCanon(c), unit: c.unit, n: c.n, er });
    }
    if (opts.quotesCounted) for (const q of d.quotes) if (q.e === eId && q.p === p) cands.push({ d, canon: q.canon, unit: q.unit, n: q.n, er: null });
    if (opts.predictionsCounted) for (const q of d.predictions) if (q.e === eId && q.p === p) cands.push({ d, canon: q.canon, unit: q.unit, n: q.n ?? d.docN ?? 1, er: null });
  }
  if (!cands.length) return null;
  const key = x => (opts.recencyOnly ? [-x.d.pubDay] : rankKey(world.policy, tierFn(x.d), x.n, x.d.pubDay));
  cands.sort((a, b) => cmpKeys(key(a), key(b)));
  const w = cands[0];
  const value = opts.noUnitConversion ? unitOf(p, w.unit).toPrinted(w.canon) / 10 ** unitOf(p, w.unit).dec : canonValue(p, w.canon);
  return { canon: Math.round(value * 10 ** PROPS[p].dec), source: opts.erratumCited && w.er ? w.er.id : w.d.id };
}
export { resolveAlt as _resolveAlt };

// One mistake each (names follow the bed's controls, beds/wbed/r6/controls.mjs). voidOpts change which documents are void.
export const CELL_MISTAKES = Object.freeze([
  ['retracted-claims-used', { voidOpts: { retractedKept: true } }],
  ['superseded-kept', { voidOpts: { supersededKept: true } }],
  ['concern-voids', { voidOpts: { concernVoids: true } }],
  ['retraction-by-title', { voidOpts: { retractionByTitle: true } }],
  ['nonstandard-counted', { opts: { nonstdCounted: true } }],
  ['bounds-counted', { opts: { boundsCounted: true } }],
  ['quotes-counted', { opts: { quotesCounted: true } }],
  ['predictions-counted', { opts: { predictionsCounted: true } }],
  ['errata-skipped', { opts: { errataSkipped: true } }],
  ['erratum-cited', { opts: { erratumCited: true } }],
  ['recency-only', { opts: { recencyOnly: true } }],
  ['no-unit-conversion', { opts: { noUnitConversion: true } }],
  // the d5 novel kinds: a technical report (test split) or conference abstract (dev split) ranked as a journal publication
  ['novel-kind-as-journal', { opts: { tierOf: d => (['techreport', 'conference'].includes(d.kind) ? 0 : tierOfDoc(d)) } }],
  ['novel-kind-as-preprint', { opts: { tierOf: d => (d.kind === 'techreport' ? 1 : tierOfDoc(d)) } }],
  ['policy-venue-first', { opts: { policy: 'P1' } }],
  ['policy-n-first', { opts: { policy: 'P3' } }],
  ['policy-recency-after-venue', { opts: { policy: 'P2' } }],
]);

/** The mistakes that reproduce a wrong cell row exactly (value and source), or only its value or only its source. */
export function cellTraps(t, code, p, row) {
  const e = t.entByCode.get(code);
  const got = { canon: Math.round(Number(row.value) * 10 ** PROPS[p].dec), source: String(row.source_doc_id ?? '').trim().toUpperCase() };
  const exact = [], valueOnly = [], sourceOnly = [];
  for (const [name, { voidOpts, opts }] of CELL_MISTAKES) {
    const voids = voidOpts ? voidKeys(t.world, t.vis, voidOpts) : t.voids;
    const world = opts?.policy ? { ...t.world, policy: opts.policy } : t.world;
    if (opts?.policy && opts.policy === t.world.policy) continue;
    const c = resolveAlt(world, t.vis, voids, e.id, p, opts ?? {});
    if (!c) continue;
    const truth = t.cells.get(`${code}|${p}`);
    if (truth && c.canon === truth.canon && c.source === truth.source) continue;   // this mistake does not change the cell
    if (c.canon === got.canon && c.source === got.source) exact.push(name);
    else if (c.canon === got.canon) valueOnly.push(name);
    else if (c.source === got.source) sourceOnly.push(name);
  }
  return { exact, valueOnly, sourceOnly };
}

const lc = s => String(s ?? '').toLowerCase();
/** Every way a document can mention a compound: its code and its name. */
export const mentionsOf = (t, code) => { const e = t.entByCode.get(code); return [e.code, e.name]; };

/** Why a compound is in scope and how hard it is to find: the bed traps on its scope (sub-role and test-date phrasing). */
export function scopeTrapsOf(t, code) {
  const e = t.entByCode.get(code);
  const traps = [];
  if (e.sub === 'abbr') traps.push('alias:abbr');
  if (e.sub === 'former') traps.push('alias:former');
  if (e.sub === 'codeonly') traps.push('code-only');
  const est = (t.establishing.get(code) ?? []).map(id => t.byId.get(id));
  if (est.length && est.every(d => d.testForm === 'relative')) traps.push('novel-date:relative');
  if (est.length && est.every(d => d.testForm === 'log')) traps.push('novel-date:log');
  if (est.length && est.every(d => d.affil === 'abbr')) traps.push('affil:abbr-only');
  if (est.length && est.every(d => d.affil === 'former')) traps.push('affil:former-only');
  return traps.length ? traps : ['plain'];
}
const EXTRA_ROLE = { T1: 'T1:tested-before-cutoff', T2: 'T2:quote-only', T3: 'T3:retracted-only', T4: 'T4:planned', T6: 'T6:namesake' };
/** The trap an out-of-scope compound in the answer hit. */
export function extraTrapsOf(t, code) {
  const e = t.entByCode.get(code);
  if (EXTRA_ROLE[e.role]) {
    const traps = [EXTRA_ROLE[e.role]];
    if (e.role === 'T1') {
      const docs = t.vis.filter(d => isResearch(d) && d.lab === t.world.X && testsOf(d).has(e.id) && d.pubDay >= t.world.Y);
      if (docs.some(d => d.testForm === 'relative')) traps.push('novel-date:relative');
      if (docs.some(d => d.testForm === 'log')) traps.push('novel-date:log');
    }
    return traps;
  }
  // a background compound: tested by the namesake organisation, mentioned (not tested) by lab X on or after the cut-off,
  // or unrelated
  if (t.world.NS && t.vis.some(d => isResearch(d) && d.lab === t.world.NS && testsOf(d).has(e.id) && (d.testDay ?? d.pubDay) >= t.world.Y)) return ['bg:namesake-tested'];
  const xMentions = t.vis.some(d => isResearch(d) && d.lab === t.world.X && d.pubDay >= t.world.Y && d.styles[e.id]);
  return [xMentions ? 'bg:mentioned-by-lab' : 'bg:unrelated'];
}
/** Why a document is void (or not) and which compounds it mentions. */
export function docVoidStatus(t, id) {
  const d = t.byId.get(id);
  if (!d) return { known: false };
  const reasons = [];
  if (t.vis.some(n => n.kind === 'retraction' && n.target === d.key)) reasons.push('retracted');
  const later = t.vis.find(n => n.supersedes === d.key);
  if (later) reasons.push(later.supersedeForm === 'journal' ? 'replaced-by-journal' : 'replaced-by-v2');
  const concern = t.vis.some(n => n.kind === 'concern' && n.target === d.key);
  const byTitle = t.vis.some(n => n.kind === 'retraction' && !n.target && n.notice?.titleOf === d.key);
  const mentions = Object.keys(d.styles).map(eid => t.entById.get(eid).code);
  return { known: true, research: isResearch(d), void: t.voids.has(d.key), reasons, concern, byTitle, mentions };
}

/** Units of error of one answer: [{ unit, code?, property?, doc?, traps: [...], detail }] (empty when it passes). */
export function errorUnits(task, output) {
  const t = truthOf(task);
  const units = [];
  if (!output || typeof output !== 'object' || !Array.isArray(output.table)) return [{ unit: 'no-answer', traps: ['no-answer'] }];
  const props = new Set(t.world.props);
  const rows = new Map(), seenCodes = new Set();
  for (const row of output.table) {
    const code = t.resolve(row?.entity);
    if (!code) { units.push({ unit: 'unknown-entity', traps: ['unknown-entity'], detail: { entity: String(row?.entity).slice(0, 60) } }); continue; }
    seenCodes.add(code);
    const k = `${code}|${row.property}`;
    if (rows.has(k)) { units.push({ unit: 'duplicate-row', code, property: row.property, traps: ['duplicate-row'] }); continue; }
    rows.set(k, row);
  }
  for (const code of t.inScope) if (!seenCodes.has(code)) units.push({ unit: 'missing-compound', code, traps: scopeTrapsOf(t, code), detail: { establishing: t.establishing.get(code) } });
  for (const code of seenCodes) if (!t.inScope.has(code)) units.push({ unit: 'extra-compound', code, traps: extraTrapsOf(t, code) });
  for (const [k, row] of rows) {
    const [code, p] = k.split('|');
    if (!t.inScope.has(code)) continue;
    if (!props.has(p)) { units.push({ unit: 'extra-property', code, property: p, traps: ['extra-property'] }); continue; }
    const truth = t.cells.get(k);
    const got = { canon: Math.round(Number(row.value) * 10 ** PROPS[p].dec), source: String(row.source_doc_id ?? '').trim().toUpperCase() };
    if (got.canon === truth.canon && got.source === truth.source) continue;
    const m = cellTraps(t, code, p, row);
    const traps = m.exact.length ? m.exact : [...m.valueOnly.map(x => `${x}~value`), ...m.sourceOnly.map(x => `${x}~source`)];
    const how = got.canon === truth.canon ? 'source-wrong' : got.source === truth.source ? 'value-wrong' : 'both-wrong';
    units.push({ unit: 'wrong-cell', code, property: p, traps: traps.length ? traps : [`unexplained:${how}`], detail: { how, cellTraps: truth.traps ?? [] } });
  }
  for (const code of t.inScope) if (seenCodes.has(code)) for (const p of props) if (!rows.has(`${code}|${p}`)) units.push({ unit: 'missing-cell', code, property: p, traps: ['missing-cell'] });
  const got = new Set((Array.isArray(output.excluded_doc_ids) ? output.excluded_doc_ids : []).map(x => String(x).trim().toUpperCase()));
  const missingCodes = new Set(units.filter(u => u.unit === 'missing-compound').map(u => u.code));
  const extraCodes = new Set(units.filter(u => u.unit === 'extra-compound').map(u => u.code));
  for (const id of t.excluded) if (!got.has(id)) {
    const s = docVoidStatus(t, id);
    const cascade = s.mentions.filter(c => t.inScope.has(c)).every(c => missingCodes.has(c));
    units.push({ unit: 'missing-excluded', doc: id, traps: [cascade ? 'cascade:missing-compound' : `void-missed:${s.reasons.join('+') || 'unknown'}`] });
  }
  for (const id of got) if (!t.excluded.has(id)) {
    const s = docVoidStatus(t, id);
    let trap;
    if (!s.known) trap = 'not-a-document';
    else if (s.void && !s.mentions.some(c => t.inScope.has(c))) trap = s.mentions.some(c => extraCodes.has(c)) ? 'cascade:extra-compound' : 'void-but-out-of-scope';
    else if (!s.research) trap = 'notice-listed';
    else if (s.concern) trap = 'concern-voids';
    else if (s.byTitle) trap = 'retraction-by-title';
    else trap = 'not-void';
    units.push({ unit: 'extra-excluded', doc: id, traps: [trap] });
  }
  return units;
}

/** Counts of trap labels over a list of units ({trap: n}); a unit with several labels counts once under each. */
export const trapCounts = units => units.flatMap(u => u.traps).reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});

// ------------------------------------------------------------------------------------------------------------------
// Step 3 for agent-shaped sessions (the single agent, the swarm's lead): did the session see the documents a missed
// compound or a wrong cell needed, and how large was its context when it did? Seen = the document's header line
// ("Document Dnnn") or its path (Dnnn.txt) appears in a tool result the session received.
export function seenDocs(events, { parent = null } = {}) {
  const seen = new Map();   // doc id -> { firstAt (event index), contextTokens (the next assistant message's prompt size) }
  let pending = [];
  events.forEach((e, i) => {
    const p = e?.parent_tool_use_id ?? null;
    if (parent !== 'any' && p !== parent) return;
    if (e?.type === 'user' && Array.isArray(e.message?.content)) {
      for (const c of e.message.content) {
        if (c?.type !== 'tool_result') continue;
        const text = typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map(x => x?.text ?? '').join('\n') : '';
        for (const m of text.matchAll(/\bDocument (D\d{3})\b|\b(D\d{3})\.txt\b/g)) {
          const id = m[1] ?? m[2];
          if (!seen.has(id)) { seen.set(id, { firstAt: i, contextTokens: null }); pending.push(id); }
        }
      }
    } else if (e?.type === 'assistant' && e.message?.usage && pending.length) {
      const u = e.message.usage, ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      for (const id of pending) seen.get(id).contextTokens = ctx;
      pending = [];
    }
  });
  return seen;
}
/** Locus for each unit of an agent-shaped session: { seen: bool, contextTokens } of the documents it needed. */
export function agentLocus(task, units, events, opts = {}) {
  const t = truthOf(task);
  const seen = seenDocs(events, opts);
  const maxCtx = Math.max(0, ...events.filter(e => e?.type === 'assistant' && e.message?.usage && (opts.parent === 'any' || (e.parent_tool_use_id ?? null) === (opts.parent ?? null)))
    .map(e => (e.message.usage.input_tokens ?? 0) + (e.message.usage.cache_read_input_tokens ?? 0) + (e.message.usage.cache_creation_input_tokens ?? 0)));
  return units.map(u => {
    let needed = [];
    if (u.unit === 'missing-compound') needed = t.establishing.get(u.code) ?? [];
    else if (u.unit === 'wrong-cell' || u.unit === 'missing-cell') needed = [t.cells.get(`${u.code}|${u.property}`)?.source].filter(Boolean);
    else if (u.doc) needed = [u.doc];
    const hits = needed.filter(id => seen.has(id));
    return { ...u, needed, seen: needed.length ? hits.length === needed.length : null, seenAny: hits.length > 0,
      contextTokens: hits.length ? Math.max(...hits.map(id => seen.get(id).contextTokens ?? 0)) : null, sessionMaxContext: maxCtx };
  });
}

/** The fault side of one unit given its locus: 'model' (the evidence was in front of the model), 'harness' (the arm's
 *  structure lost it: a limit, an aggregation, a brief), or 'bed' (the grader disagrees with the task text; never expected:
 *  the decidability witness passes every task). */
export function faultSide(u, { gradeConsistent = true } = {}) {
  if (!gradeConsistent) return 'bed';
  if (u.harness) return 'harness';
  return 'model';
}
