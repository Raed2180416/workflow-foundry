// Stage contracts, stage oracles and relations for W-bed R5 (W-BED §2.1 `stages`, §2.2 items 2-3).
//   decode   the dump subsidiary's rows (multiset, exact against the generator truth) and its trailer (exact)
//   then R4's stages unchanged (children, translate, pair, eliminate, report), each child scored by its own rung
// Relations owned by no single stage:
//   D1 trailer count     the decode hand-off's row count equals its trailer's record count
//   D2 control totals    the decode hand-off's rows reproduce its trailer's row-id total, amount totals per currency
//                        and text hash totals (the agent node's verify predicate, decode.mjs verifyPredicate)
//   D3 rows carried      the report's dump.rows are the decode hand-off's rows, the dump pack's child trace consumed
//                        exactly those rows, and the report names the dump subsidiary
//   then R4's W1-W4.
// The composed oracle is (decode stage) AND D1-D3 AND R4's composed oracle (every child's composed oracle, R4's parent
// stages, W1-W4). On every trace it agrees with the end-to-end oracle (tests: reference and every control).
import { contract, str, arr, obj } from '../lib/contracts.mjs';
import { trailerKey } from '../lib/legacy.mjs';
import * as R4 from '../r4/index.mjs';
import { verifyPredicate, rowsDiff } from './decode.mjs';
import { ROW_SCHEMA, outputSchema } from './score.mjs';

const trailerSchema = { type: ['object', 'null'] };
export const CONTRACTS = {
  decode: contract('wbed-r5/decode', obj({ rows: arr(ROW_SCHEMA, 5000), trailer: trailerSchema })),
  report: contract('wbed-r5/report', outputSchema),
  input: contract('wbed-r5/input', obj({ files: { type: 'object' }, readme: str(2e5), sub_id: str(8) })),
};

const result = (errors, problems, extra = {}) => (errors.length ? { pass: false, details: { reason: 'contract', errors: errors.slice(0, 8) } }
  : { pass: problems.length === 0, details: { problems: problems.slice(0, 8), ...extra } });

export const DUMP_RELATIONS = [
  { id: 'D1-trailer-count', stages: ['decode'], text: 'the decoded row count equals the trailer\'s record count',
    check: trace => { const d = trace.decode; const pass = Boolean(d?.trailer) && Array.isArray(d.rows) && d.rows.length === d.trailer.records; return { pass, details: { rows: d?.rows?.length ?? null, trailer: d?.trailer?.records ?? null } }; } },
  { id: 'D2-control-totals', stages: ['decode'], text: 'the decoded rows reproduce the trailer\'s row-id total, amount totals per currency and text hash totals',
    check: trace => { const why = verifyPredicate(trace.decode?.rows, trace.decode?.trailer); return { pass: why === null, details: { reason: why } }; } },
  { id: 'D3-rows-carried', stages: ['decode', 'children', 'report'], text: 'the report\'s dump rows are the decode hand-off\'s rows, the dump pack\'s child trace consumed exactly those rows, and the dump subsidiary is named',
    check: (trace, world) => {
      const bad = [];
      const dec = trace.decode?.rows ?? [];
      if (trace.report?.dump?.sub_id !== world.sub.id) bad.push('sub_id');
      if (!rowsDiff(dec, trace.report?.dump?.rows).exact) bad.push('report-rows');
      const kid = (trace.children ?? []).find(c => c?.sub_id === world.sub.id);
      if (!kid?.trace || !rowsDiff(dec, kid.trace.extract?.invoices).exact) bad.push('child-rows');
      return { pass: bad.length === 0, details: { bad } };
    } },
];
export const RELATIONS = [...DUMP_RELATIONS, ...R4.relations];

/** Stage definitions: decode, then R4's stages (their projections read the R4 world of the same seed). */
export function makeStages(worldOf, inputOf) {
  const decode = {
    id: 'decode', inputSchema: CONTRACTS.input.schema, outputSchema: CONTRACTS.decode.schema,
    project: task => ({ task, input: inputOf(task) }),
    oracle: (st, out) => {
      const errors = CONTRACTS.decode.check(out);
      if (errors.length) return result(errors, []);
      const w = worldOf(st.task);
      const d = rowsDiff(w.rows, out.rows);
      const problems = [];
      if (!d.exact) problems.push('rows');
      if (trailerKey(out.trailer) !== trailerKey(w.trailer)) problems.push('trailer');
      return result([], problems, { expected: w.rows.length, got: out.rows.length, missing: d.missing, extra: d.extra });
    },
  };
  return [decode, ...R4.stages];
}

/** Decode stage, D1-D3 and R4's composed oracle on the trace. */
export function composeOracle(stages, task, trace, world) {
  const dec = stages[0].oracle(stages[0].project(task), trace.decode);
  const rel = {};
  for (const x of DUMP_RELATIONS) {
    try { rel[x.id] = x.check(trace, world); } catch (e) { rel[x.id] = { pass: false, details: { error: String(e.message ?? e) } }; }
  }
  let r4;
  try { r4 = R4.composedOracle(task, trace); } catch (e) { r4 = { pass: false, children: {}, stages: {}, relations: { error: { pass: false, details: { error: String(e.message ?? e) } } } }; }
  const pass = dec.pass && Object.values(rel).every(r => r.pass) && r4.pass;
  return { pass, children: r4.children, stages: { decode: dec, ...r4.stages }, relations: { ...rel, ...r4.relations } };
}
