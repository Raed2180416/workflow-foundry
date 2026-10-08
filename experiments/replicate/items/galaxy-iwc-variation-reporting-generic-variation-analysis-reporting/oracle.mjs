// Oracle for the job. Judges the four report tables a candidate produced for every evaluation case;
// it never looks at how the candidate was built. Trusted host code: candidates must not see this file.
//
// Truth: the shipped case is judged against the tables the original Galaxy run shipped (fixtures/shipped/*).
// Derived cases are judged against reference.mjs, and only after the evaluator-health gate has shown that the
// reference reproduces the shipped tables exactly (AGENTS.md: an invalid evaluator blocks claims).
import { TABLES, batteryInputs, shippedCase, N_DERIVED } from './cases.mjs';
import { runJob } from './reference.mjs';
import { compareTable } from './compare.mjs';

export const PASS_RULE = `all four tables strict-equal on the shipped case AND on at least ${Math.ceil(0.9 * N_DERIVED)} of ${N_DERIVED} derived cases`;

const flat = out => ({ ...Object.fromEntries(Object.entries(out.af_recalculated).map(([id, t]) => [`af_recalculated[${id}]`, t])),
  all_variants_all_samples: out.all_variants_all_samples, by_variant_report: out.by_variant_report, combined_variant_report: out.combined_variant_report });

let health;
// The reference must reproduce the original's shipped tables exactly before any derived verdict is trusted.
export function evaluatorHealth() {
  if (health) return health;
  const c = shippedCase(), got = runJob(c.inputs), problems = [];
  for (const t of TABLES) {
    if (t === 'af_recalculated') { for (const [id, text] of Object.entries(c.expected.af_recalculated)) if (got.af_recalculated[id] !== text) problems.push(`af_recalculated[${id}]`); }
    else if (got[t] !== c.expected[t]) problems.push(t);
  }
  health = { ok: problems.length === 0, problems };
  return health;
}

const expectedCache = new WeakMap();
// Expected tables of one case: the shipped files, or the reference's output (cached; cases are immutable).
export function expectedOf(c) {
  if (c.kind === 'shipped') return c.expected;
  if (!expectedCache.has(c)) expectedCache.set(c, runJob(c.inputs));
  return expectedCache.get(c);
}

const batteryCache = new Map();
export function battery(params) {
  const key = `${params.seed}|${params.split}|${params.difficulty}`;
  if (!batteryCache.has(key)) {
    batteryCache.set(key, batteryInputs(params));
    if (batteryCache.size > 6) batteryCache.delete(batteryCache.keys().next().value); // bounded: a sweep over many seeds must not grow the heap
  }
  return batteryCache.get(key);
}

function schemaProblems(out) {
  const p = [];
  if (out === null || typeof out !== 'object' || Array.isArray(out)) return ['output is not an object'];
  if (out.cases === null || typeof out.cases !== 'object' || Array.isArray(out.cases)) return ['output.cases is not an object'];
  return p;
}
function caseProblems(c) {
  if (c === null || typeof c !== 'object') return ['case output is not an object'];
  const p = [];
  if (c.af_recalculated === null || typeof c.af_recalculated !== 'object' || Array.isArray(c.af_recalculated)) p.push('af_recalculated must be an object {sampleId: tsv}');
  for (const t of TABLES.slice(1)) if (typeof c[t] !== 'string') p.push(`${t} must be a string`);
  return p;
}

// Per-table verdicts of one candidate case output against the expected tables.
export function judgeCase(expectedTables, candidate) {
  const bad = caseProblems(candidate);
  const tables = {};
  const exp = flat(expectedTables);
  if (bad.length) { for (const k of Object.keys(exp)) tables[k] = { level: 'fail', exact: false, strict: false, diff6: false, why: bad[0] }; return { tables, strict: false, exact: false, diff6: false, schema: bad }; }
  const got = flat(candidate);
  for (const [k, text] of Object.entries(exp)) tables[k] = compareTable(k.startsWith('af_recalculated') ? 'af_recalculated' : k, text, got[k]);
  const extra = Object.keys(got).filter(k => !(k in exp));
  if (extra.length) tables[extra[0]] = { level: 'fail', exact: false, strict: false, diff6: false, why: `unexpected collection element ${extra[0]}` };
  const all = Object.values(tables);
  return { tables, strict: all.every(t => t.strict) && !extra.length, exact: all.every(t => t.exact) && !extra.length, diff6: all.every(t => t.diff6) && !extra.length };
}

export function evaluate(params, output) {
  const gate = evaluatorHealth();
  if (!gate.ok) return { pass: false, score: 0, details: { evaluatorInvalid: true, reason: 'reference does not reproduce the shipped tables', problems: gate.problems } };
  const sp = schemaProblems(output);
  if (sp.length) return { pass: false, score: 0, details: { schema: sp } };
  const cases = battery(params), perCase = {};
  for (const c of cases) {
    const expected = expectedOf(c);
    const cand = output.cases[c.caseId];
    perCase[c.caseId] = cand === undefined ? { tables: {}, strict: false, exact: false, diff6: false, schema: ['case missing from output'] } : judgeCase(expected, cand);
  }
  const derived = cases.filter(c => c.kind === 'derived'), need = Math.ceil(0.9 * derived.length);
  const count = k => derived.filter(c => perCase[c.caseId][k]).length;
  const shipped = perCase.shipped, derivedStrict = count('strict');
  const pass = shipped.strict && derivedStrict >= need;
  const strictAll = cases.filter(c => perCase[c.caseId].strict).length;
  const failed = cases.filter(c => !perCase[c.caseId].strict).map(c => c.caseId);
  let first = null;
  for (const id of failed) {
    const pc = perCase[id], t = Object.entries(pc.tables).find(([, v]) => !v.strict);
    first = { caseId: id, table: t?.[0] ?? null, why: t?.[1].why ?? pc.schema?.[0] ?? null };
    break;
  }
  return {
    pass, score: strictAll / cases.length,
    details: {
      rule: PASS_RULE,
      shipped: { strict: shipped.strict, exact: shipped.exact, diff6: shipped.diff6, tables: Object.fromEntries(Object.entries(shipped.tables).map(([k, v]) => [k, v.level])) },
      derived: { strict: derivedStrict, exact: count('exact'), diff6: count('diff6'), total: derived.length, need },
      failedCases: failed.slice(0, 12), firstFailure: first,
      selfReported: output.meta ?? null, // unverified claims about nodes / model calls / time; never used for the verdict
    },
    perCase, // full per-table detail, for diagnostics (callers may drop it)
  };
}
