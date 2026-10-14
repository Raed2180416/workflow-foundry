// Stage contracts, stage oracles and cross-stage relations for W-bed R3' (W-BED §2.1 `stages`, §2.2 items 2-3).
//
// Stage oracles (analyst-side diagnostics, never success criteria) score only what their stage owns:
//   inventory   per source file, the exact set of exported functions
//   candidates  per source file, every planted defect is a suspect with its true class (extra suspects are allowed:
//               a sweep may over-suspect and let verification sort it out)
//   verify      per suspect, the verdict "reproduced" equals the truth: the function misbehaves against its contract on
//               a valid input (a planted defect, or a caller inheriting a helper defect); decoys and clean code do not
//   reduce      local only: the report's own consistency (one finding per function, classes in scope)
// What no single stage owns is the fan-out coverage and the fan-in:
//   V1 sweep coverage: every inventoried file was swept exactly once
//   V2 verify before report: every reported finding was verified (reproduced) first
//   V3 root cause: no reported function is a caller whose reproduction is explained by a reproduced callee
//   V4 fan-in conservation: every reproduced, non-inherited suspect reaches the report
import { contract, int, str, arr, obj, bool } from '../lib/contracts.mjs';
import { outputSchema, normFile } from './score.mjs';
import { deviates, inheritedIn } from './pipeline.mjs';

const witness = { type: ['object', 'null'], properties: { args: { type: 'array', maxItems: 8 } } };
export const CONTRACTS = {
  input: contract('wbed-r3p/input', obj({ package: { type: 'object' }, source_files: arr(str(200), 100), defect_classes: arr(obj({ code: str(20), definition: str(600) }), 12), sweep_spec: str(4000) })),
  inventory: contract('wbed-r3p/inventory', obj({ files: arr(obj({ path: str(200), functions: arr(obj({ name: str(100), start_line: int, end_line: int }), 40) }), 100) })),
  candidates: contract('wbed-r3p/candidates', obj({ items: arr(obj({ path: str(200), candidates: arr(obj({ function: str(100), class: str(20) }), 200) }), 100) })),
  verify: contract('wbed-r3p/verify', obj({ items: arr(obj({ path: str(200), function: str(100), class: str(20), reproduced: bool, witness }, ['path', 'function', 'class', 'reproduced']), 4000) })),
  reduce: contract('wbed-r3p/reduce', outputSchema),
};

const fail = (errors) => ({ pass: false, details: { reason: 'contract', errors: errors.slice(0, 8) } });

function inventoryOracle(world, out) {
  const errors = CONTRACTS.inventory.check(out);
  if (errors.length) return fail(errors);
  const want = new Map(world.render.sourceFiles.map(p => [p, world.fns.filter(f => f.path === p).map(f => f.name).sort().join(',')]));
  const got = new Map(out.files.map(f => [normFile(f.path), f.functions.map(x => x.name).sort().join(',')]));
  const bad = [...want].filter(([p, names]) => got.get(p) !== names).map(([p]) => p);
  const extra = [...got.keys()].filter(p => !want.has(p));
  return { pass: !bad.length && !extra.length, details: { files: want.size, wrong: bad.length, extra: extra.length, first: bad[0] ?? extra[0] ?? null } };
}

function candidatesOracle(world, out) {
  const errors = CONTRACTS.candidates.check(out);
  if (errors.length) return fail(errors);
  const have = new Set(out.items.flatMap(it => it.candidates.map(c => `${normFile(it.path)}|${c.function}|${c.class}`)));
  const missing = world.manifest.filter(m => !have.has(`${m.file}|${m.function}|${m.class}`));
  return { pass: missing.length === 0, details: { defects: world.manifest.length, missing: missing.length, first: missing[0]?.id ?? null, suspects: have.size } };
}

function verifyOracle(world, out) {
  const errors = CONTRACTS.verify.check(out);
  if (errors.length) return fail(errors);
  const wrong = out.items.filter(x => x.reproduced !== deviates(world, x.function));
  return { pass: wrong.length === 0, details: { items: out.items.length, wrong: wrong.length, first: wrong[0] ? `${wrong[0].path}#${wrong[0].function}` : null } };
}

/** Local reduce checks: the report's own consistency (no hand-off, no truth). */
export function reduceLocal(world, out) {
  const errors = CONTRACTS.reduce.check(out);
  if (errors.length) return fail(errors);
  const problems = [];
  const locs = out.findings.map(f => `${normFile(f.file)}|${f.function}`);
  if (new Set(locs).size !== locs.length) problems.push('function-twice');
  if (out.findings.some(f => !world.L.classes.includes(f.class))) problems.push('class-out-of-scope');
  return { pass: problems.length === 0, details: { problems } };
}

const loc = (p, f) => `${normFile(p)}|${f}`;
export const RELATIONS = [
  { id: 'V1-sweep-coverage', stages: ['inventory', 'candidates'], text: 'every inventoried source file was swept exactly once',
    check: trace => {
      const want = trace.inventory.files.map(f => normFile(f.path)).sort(), got = trace.candidates.items.map(x => normFile(x.path)).sort();
      return { pass: want.join(',') === got.join(','), details: { want: want.length, got: got.length } };
    } },
  { id: 'V2-verify-before-report', stages: ['verify', 'reduce'], text: 'every reported finding was verified (reproduced) before the report',
    check: trace => {
      const ok = new Set(trace.verify.items.filter(x => x.reproduced).map(x => loc(x.path, x.function)));
      const bad = trace.reduce.findings.filter(f => !ok.has(loc(f.file, f.function)));
      return { pass: bad.length === 0, details: { unverified: bad.length, first: bad[0] ? `${bad[0].file}#${bad[0].function}` : null } };
    } },
  { id: 'V3-root-cause', stages: ['verify', 'reduce'], text: 'no reported function only inherits the misbehaviour of a reproduced callee',
    check: (trace, world) => {
      const inherited = inheritedIn(world, trace.verify.items);
      const bad = trace.reduce.findings.filter(f => inherited(f.function));
      return { pass: bad.length === 0, details: { callers: bad.length, first: bad[0] ? `${bad[0].file}#${bad[0].function}` : null } };
    } },
  { id: 'V4-fan-in-conservation', stages: ['verify', 'reduce'], text: 'every reproduced suspect that is not inherited reaches the report',
    check: (trace, world) => {
      const inherited = inheritedIn(world, trace.verify.items);
      const reported = new Set(trace.reduce.findings.map(f => `${loc(f.file, f.function)}|${f.class}`));
      const lost = trace.verify.items.filter(x => x.reproduced && !inherited(x.function) && !reported.has(`${loc(x.path, x.function)}|${x.class}`));
      return { pass: lost.length === 0, details: { lost: lost.length, first: lost[0] ? `${lost[0].path}#${lost[0].function}` : null } };
    } },
];

export function makeStages(worldOf, inputOf, truthOf) {
  return [
    { id: 'inventory', inputSchema: CONTRACTS.input.schema, outputSchema: CONTRACTS.inventory.schema,
      project: task => ({ task, input: inputOf(task) }), oracle: (st, out) => inventoryOracle(worldOf(st.task), out) },
    { id: 'candidates', inputSchema: CONTRACTS.inventory.schema, outputSchema: CONTRACTS.candidates.schema,
      project: task => ({ task, input: truthOf(task).inventory }), oracle: (st, out) => candidatesOracle(worldOf(st.task), out) },
    { id: 'verify', inputSchema: CONTRACTS.candidates.schema, outputSchema: CONTRACTS.verify.schema,
      project: task => ({ task, input: truthOf(task).candidates }), oracle: (st, out) => verifyOracle(worldOf(st.task), out) },
    { id: 'reduce', inputSchema: CONTRACTS.verify.schema, outputSchema: CONTRACTS.reduce.schema,
      project: task => ({ task, input: truthOf(task).verify }), oracle: (st, out) => reduceLocal(worldOf(st.task), out) },
  ];
}

export function composeOracle(stages, task, trace, world) {
  const per = {};
  for (const s of stages) {
    try { per[s.id] = s.oracle(s.project(task), trace[s.id]); } catch (e) { per[s.id] = { pass: false, details: { error: String(e.message ?? e) } }; }
  }
  const rel = {};
  for (const x of RELATIONS) {
    try { rel[x.id] = x.check(trace, world); } catch (e) { rel[x.id] = { pass: false, details: { error: String(e.message ?? e) } }; }
  }
  const pass = Object.values(per).every(r => r.pass) && Object.values(rel).every(r => r.pass);
  return { pass, stages: per, relations: rel };
}
