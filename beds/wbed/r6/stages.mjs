// Stage contracts, stage oracles and cross-item relations for W-bed R6 (W-BED §2.1 `stages`, §2.2 items 2-3).
//
// Stage oracles (analyst-side diagnostics, never success criteria) score only what their stage owns:
//   index   the mention index from text: per compound code, its name and the documents that mention it (exact)
//   plan    the candidate list: covers every in-scope compound exactly once (by code or name), no two strings for one
//           compound, no unknown string, at most MAX_FANOUT entries. Extra (out-of-scope) candidates are allowed:
//           the plan is recall-oriented and workers restore precision
//   worker  per item, independently: the in-scope verdict; for in-scope items the cells (value at the stated
//           precision, source) and the void documents that mention the compound; out-of-scope items carry no cells
//   reduce  local only: one row per (compound, property), every listed compound has every requested property, the
//           excluded list has no repeats, ids look like document ids
// What no single stage owns is the fan-out / fan-in (cross-item relations):
//   Y1 plan-index: every candidate resolves through the trace's own index to exactly one compound; no two candidates
//      resolve to the same compound (the "check: code mention index (gaps, duplicates)" of the reference)
//   Y2 worker coverage: one worker item per plan candidate, none dropped (typed coverage, no silent `null`)
//   Y3 table carried: the table is exactly the in-scope items' cells, each under its own compound
//   Y4 void union: excluded_doc_ids is exactly the union of the in-scope items' void documents
//   Y5 sources live: every row's source mentions its compound (trace index) and is not in excluded_doc_ids
import { contract, int, str, arr, obj, bool } from '../lib/contracts.mjs';
import { canonical } from '../lib/prng.mjs';
import { PROPS, PROP_IDS, MAX_FANOUT } from './vocab.mjs';
import { outputSchema } from './score.mjs';

const num = { type: 'number' };
const cell = obj({ property: str(40), value: num, source_doc_id: str(20) });
export const CONTRACTS = {
  input: contract('wbed-r6/input', obj({ question: { type: 'object' }, properties: arr({ type: 'object' }, 10), register: { type: 'object' }, corpus: { type: 'object' } })),
  index: contract('wbed-r6/index', obj({ entities: arr(obj({ code: str(20), name: str(80), docs: arr(str(20), 1000) }), 500) })),
  plan: contract('wbed-r6/plan', obj({ candidates: arr(str(80), 200) })),
  worker: contract('wbed-r6/worker', obj({ items: arr(obj({ entity: str(80), in_scope: bool, cells: arr(cell, 10), void_doc_ids: arr(str(20), 400) }), 200) })),
  reduce: contract('wbed-r6/reduce', outputSchema),
};
void int;

const resolverOf = entities => {
  const m = new Map();
  for (const e of entities) { m.set(e.code.toUpperCase(), e.code); if (e.name) m.set(e.name.toLowerCase(), e.code); }
  return s => { const t = String(s ?? '').trim(); return m.get(t.toUpperCase()) ?? m.get(t.toLowerCase()) ?? null; };
};
const cellKey = c => `${c.property}|${Math.round(c.value * 10 ** (PROPS[c.property]?.dec ?? 0))}|${String(c.source_doc_id).trim().toUpperCase()}`;
const fail = (errors) => ({ pass: false, details: { reason: 'contract', errors: errors.slice(0, 8) } });

/** Local reduce checks: the reduced answer's own consistency (no hand-off, no truth). */
export function reduceLocal(out, props) {
  const errors = CONTRACTS.reduce.check(out);
  if (errors.length) return fail(errors);
  const problems = [];
  const seen = new Set(), propsOf = new Map();
  for (const r of out.table) {
    const k = `${String(r.entity).trim().toLowerCase()}|${r.property}`;
    if (seen.has(k)) problems.push('row-twice');
    seen.add(k);
    const e = String(r.entity).trim().toLowerCase();
    if (!propsOf.has(e)) propsOf.set(e, new Set());
    propsOf.get(e).add(r.property);
    if (!/^D\d{3}$/.test(String(r.source_doc_id).trim().toUpperCase())) problems.push('source-id-shape');
  }
  for (const [, ps] of propsOf) if (props.some(p => !ps.has(p)) || [...ps].some(p => !props.includes(p))) { problems.push('compound-incomplete'); break; }
  if (new Set(out.excluded_doc_ids).size !== out.excluded_doc_ids.length) problems.push('excluded-twice');
  return { pass: problems.length === 0, details: { problems: [...new Set(problems)] } };
}

// ---- cross-item relations
export const RELATIONS = [
  { id: 'Y1-plan-index', stages: ['index', 'plan'],
    text: 'every plan candidate resolves through the index to exactly one compound, and no two candidates to the same compound',
    check: trace => {
      const res = resolverOf(trace.index.entities);
      const codes = trace.plan.candidates.map(res);
      const unknown = codes.filter(c => !c).length, dup = codes.length - new Set(codes.filter(Boolean)).size - unknown;
      return { pass: !unknown && !dup, details: { unknown, duplicates: dup } };
    } },
  { id: 'Y2-worker-coverage', stages: ['plan', 'worker'],
    text: 'one worker item per plan candidate; no candidate dropped (typed coverage)',
    check: trace => {
      const a = [...trace.plan.candidates].sort(), b = trace.worker.items.map(x => x.entity).sort();
      return { pass: canonical(a) === canonical(b), details: { candidates: a.length, items: b.length } };
    } },
  { id: 'Y3-table-carried', stages: ['worker', 'reduce'],
    text: 'the table is exactly the in-scope items\' cells, each under its own compound',
    check: trace => {
      const want = trace.worker.items.filter(x => x.in_scope).flatMap(x => x.cells.map(c => `${String(x.entity).trim().toLowerCase()}|${cellKey(c)}`)).sort();
      const got = trace.reduce.table.map(r => `${String(r.entity).trim().toLowerCase()}|${cellKey(r)}`).sort();
      return { pass: canonical(want) === canonical(got), details: { want: want.length, got: got.length } };
    } },
  { id: 'Y4-void-union', stages: ['worker', 'reduce'],
    text: 'excluded_doc_ids is the union of the in-scope items\' void documents',
    check: trace => {
      const want = [...new Set(trace.worker.items.filter(x => x.in_scope).flatMap(x => x.void_doc_ids))].sort();
      const got = [...new Set(trace.reduce.excluded_doc_ids.map(x => String(x).trim().toUpperCase()))].sort();
      return { pass: canonical(want) === canonical(got), details: { want: want.length, got: got.length } };
    } },
  { id: 'Y5-sources-live', stages: ['index', 'reduce'],
    text: 'every row\'s source mentions its compound and is not an excluded (void) document',
    check: trace => {
      const res = resolverOf(trace.index.entities);
      const docsOf = new Map(trace.index.entities.map(e => [e.code, new Set(e.docs)]));
      const excl = new Set(trace.reduce.excluded_doc_ids.map(x => String(x).trim().toUpperCase()));
      const bad = trace.reduce.table.filter(r => { const c = res(r.entity), s = String(r.source_doc_id).trim().toUpperCase(); return !c || !docsOf.get(c)?.has(s) || excl.has(s); }).length;
      return { pass: bad === 0, details: { rows: bad } };
    } },
];

/**
 * truthOf(task) -> the reference trace; worldOf(task) -> the world (for name resolution and the truth sets).
 */
export function makeStages(truthOf, worldOf, inputOf) {
  const truthSets = task => {
    const t = truthOf(task), w = worldOf(task);
    const res = resolverOf(w.entities);
    const inScope = new Set(t.worker.items.filter(x => x.in_scope).map(x => res(x.entity)));
    const cellsOf = new Map(t.worker.items.filter(x => x.in_scope).map(x => [res(x.entity), x.cells.map(cellKey).sort()]));
    const voidsOf = new Map(t.worker.items.map(x => [res(x.entity), [...x.void_doc_ids].sort()]));
    return { t, w, res, inScope, cellsOf, voidsOf };
  };
  return [
    { id: 'index', inputSchema: CONTRACTS.input.schema, outputSchema: CONTRACTS.index.schema,
      project: task => ({ task, input: inputOf(task) }),
      oracle: (st, out) => {
        const errors = CONTRACTS.index.check(out);
        if (errors.length) return fail(errors);
        const want = truthOf(st.task).index.entities.map(e => canonical({ code: e.code, name: e.name, docs: [...e.docs].sort() })).sort();
        const got = out.entities.map(e => canonical({ code: e.code, name: e.name, docs: [...e.docs].sort() })).sort();
        const missing = want.filter(x => !got.includes(x)).length, extra = got.filter(x => !want.includes(x)).length;
        return { pass: !missing && !extra, details: { entities: want.length, missing, extra } };
      } },
    { id: 'plan', inputSchema: CONTRACTS.index.schema, outputSchema: CONTRACTS.plan.schema,
      project: task => ({ task, input: truthOf(task).index }),
      oracle: (st, out) => {
        const errors = CONTRACTS.plan.check(out);
        if (errors.length) return fail(errors);
        const { res, inScope } = truthSets(st.task);
        const codes = out.candidates.map(res);
        const unknown = codes.filter(c => !c).length;
        const dup = codes.filter(Boolean).length - new Set(codes.filter(Boolean)).size;
        const missing = [...inScope].filter(c => !codes.includes(c)).length;
        const over = out.candidates.length > MAX_FANOUT;
        return { pass: !unknown && !dup && !missing && !over, details: { candidates: out.candidates.length, missing, duplicates: dup, unknown, overFanout: over } };
      } },
    { id: 'worker', inputSchema: CONTRACTS.plan.schema, outputSchema: CONTRACTS.worker.schema,
      project: task => ({ task, input: truthOf(task).plan }),
      oracle: (st, out) => {
        const errors = CONTRACTS.worker.check(out);
        if (errors.length) return fail(errors);
        const { res, inScope, cellsOf, voidsOf } = truthSets(st.task);
        let verdictWrong = 0, cellsWrong = 0, voidsWrong = 0, unknown = 0;
        for (const it of out.items) {
          const c = res(it.entity);
          if (!c) { unknown++; continue; }
          const want = inScope.has(c);
          if (it.in_scope !== want) { verdictWrong++; continue; }
          if (!want) { if (it.cells.length) cellsWrong++; continue; }
          if (canonical(it.cells.map(cellKey).sort()) !== canonical(cellsOf.get(c))) cellsWrong++;
          if (canonical([...it.void_doc_ids].sort()) !== canonical(voidsOf.get(c) ?? [])) voidsWrong++;
        }
        return { pass: !verdictWrong && !cellsWrong && !voidsWrong && !unknown, details: { items: out.items.length, verdictWrong, cellsWrong, voidsWrong, unknown } };
      } },
    { id: 'reduce', inputSchema: CONTRACTS.worker.schema, outputSchema: CONTRACTS.reduce.schema,
      project: task => ({ task, input: truthOf(task).worker }),
      oracle: (st, out) => reduceLocal(out, worldOf(st.task).props) },
  ];
}

export function composeOracle(stages, task, trace) {
  const per = {};
  for (const s of stages) {
    try { per[s.id] = s.oracle(s.project(task), trace[s.id]); } catch (e) { per[s.id] = { pass: false, details: { error: String(e.message ?? e) } }; }
  }
  const rel = {};
  for (const x of RELATIONS) {
    try { rel[x.id] = x.check(trace); } catch (e) { rel[x.id] = { pass: false, details: { error: String(e.message ?? e) } }; }
  }
  const pass = Object.values(per).every(r => r.pass) && Object.values(rel).every(r => r.pass);
  return { pass, stages: per, relations: rel };
}
export { PROP_IDS };
