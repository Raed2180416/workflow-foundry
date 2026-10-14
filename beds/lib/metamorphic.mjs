// Metamorphic variants of bed tasks and witness tags (ATTACK-20261014 §3 M1; PROOF-LEDGER K3, K4). Pure helpers shared by
// the per-bed relation lists (beds/<family>/invariance.mjs, re-exported by the bed's index as `invariance`, `witness`,
// `witnessOf`, `witnessCheck`). A relation reads only a task's own prompt and inputs and, where it says so, the output the
// solver gave on the original task; it never reads the hidden world, so it can run beside a deployed solver (no oracle).
//
// The relation contract (experiments/jit/invariance.mjs runs it):
//   { id, kind: 'invariant' | 'transform', distribution: 'in' | 'out', text, needsOutput?: boolean,
//     make(task, { seed, output }) -> { task: variantTask, info } | { skip: reason },
//     check(originalOutput, variantOutput, info, opts) -> violations: [{ level, ... }]   (empty = the relation holds) }
// 'invariant': the variant's correct output is the original's (compared in the bed's own normal form); 'transform': it is a
// stated function of the original's (e.g. the original minus one entity). Every relation must hold for a correct solver.
// A variant keeps every task field but prompt and inputs; a prompt sentence that states a property the variant changes
// (a row count, an order) is rewritten to stay true. distribution 'out' marks a variant that leaves a regularity every
// generated task has but no task states as a rule (a listing order): it also flags a solver that leans on that regularity
// while its answer is right (equivalence modulo inputs keeps variants inside the profiled inputs; an 'out' relation does
// not). 'in' variants keep every such regularity the bed author knows of.
import { rng } from './rng.mjs';
import { canonical } from './canonical.mjs';

// Witness tags (M1 b). A witness is a structure that code can check without the oracle:
//   hash-total     the input carries control totals (counts, sums, text hash totals) the output must reproduce;
//   exclusion-set  the output has an exact discrete component that any second answer can be compared with exactly;
//   conservation   an arithmetic identity over the output (and its inputs) that every correct output satisfies;
//   count          the output's cardinality is fixed by the input (one entry per input item);
//   none           witness-free: no such structure.
// `scope` says what a check ties together: 'input' (output against the task's inputs), 'output' (the output against
// itself), 'cross-run' (two answers to the same or a variant task).
export const WITNESS_TAGS = Object.freeze(['hash-total', 'exclusion-set', 'conservation', 'count', 'none']);
export const WITNESS_SCOPES = Object.freeze(['input', 'output', 'cross-run']);
export function witnessDescriptor(primary, checks, note = null) {
  if (!WITNESS_TAGS.includes(primary)) throw new Error(`witness: unknown tag ${primary}`);
  for (const c of checks) {
    if (!WITNESS_TAGS.includes(c.tag) || c.tag === 'none') throw new Error(`witness: bad check tag ${c.tag}`);
    if (!WITNESS_SCOPES.includes(c.scope)) throw new Error(`witness: bad scope ${c.scope}`);
  }
  const tags = primary === 'none' ? ['none'] : [...new Set([primary, ...checks.map(c => c.tag)])];
  return Object.freeze({ primary, tags: Object.freeze(tags), checks: Object.freeze(checks.map(c => Object.freeze({ ...c }))), ...(note ? { note } : {}) });
}

// A seeded generator per (seed, relation, ...). The same seed gives the same variant.
export const rngOf = (seed, ...parts) => rng('metamorphic', seed, ...parts);

// A seeded permutation of `list` that differs from the identity whenever a different order exists.
export function permute(list, r) {
  if (list.length < 2) return [...list];
  for (let i = 0; i < 16; i++) {
    const p = r.shuffle(list);
    if (p.some((x, j) => x !== list[j])) return p;
  }
  return [...list.slice(1), list[0]];   // a rotation: never the identity for distinct items
}

// Permute the lines inside every maximal run of consecutive lines that classOf(line, i, lines) puts in the same class (a
// truthy key; null or false = not a row). Runs of one line stay. Returns { lines, runs: number of runs permuted, moved:
// number of lines whose position changed }.
export function shuffleRuns(lines, classOf, r) {
  const out = [...lines];
  let runs = 0, moved = 0;
  for (let i = 0; i < lines.length;) {
    const c = classOf(lines[i], i, lines);
    if (!c) { i++; continue; }
    let j = i;
    while (j + 1 < lines.length && classOf(lines[j + 1], j + 1, lines) === c) j++;
    if (j > i) {
      const block = lines.slice(i, j + 1), p = permute(block, r);
      p.forEach((x, k) => { out[i + k] = x; if (x !== block[k]) moved++; });
      runs++;
    }
    i = j + 1;
  }
  return { lines: out, runs, moved };
}

// A copy of the task with new inputs (and prompt): every other field is kept.
export function variantTask(task, { inputs, prompt = task.prompt }) {
  return { ...task, prompt, inputs };
}

// Violations are capped so a hostile or degenerate output cannot make a huge record.
export const MAX_VIOLATIONS = 20;
export function capped(violations) {
  return violations.length > MAX_VIOLATIONS ? [...violations.slice(0, MAX_VIOLATIONS), { level: 'more', count: violations.length - MAX_VIOLATIONS }] : violations;
}

// The output is not an object of the expected shape: one violation, never a throw.
export const shapeViolation = (which, why) => [{ level: 'shape', which, why }];

// Numbers equal within a relative tolerance (and an absolute floor for values near zero).
export function numClose(a, b, relTol = 0, absTol = 0) {
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  const d = Math.abs(a - b);
  return d <= absTol || d <= relTol * Math.max(Math.abs(a), Math.abs(b));
}

// Compare two lists of objects keyed by `key` (each side's duplicates are a violation of their own). `same(e, g)` returns a
// list of field violations for one key. Returns violations with level 'entity-set' (keys missing or extra), 'duplicate-key'
// and whatever `same` returns.
export function compareKeyed(expected, got, key, same, label = 'entity') {
  const index = (xs, side, v) => {
    const m = new Map();
    for (const x of xs) {
      const k = x?.[key];
      if (m.has(k)) v.push({ level: 'duplicate-key', side, [label]: k });
      else m.set(k, x);
    }
    return m;
  };
  const v = [];
  const E = index(expected, 'expected', v), G = index(got, 'variant', v);
  const missing = [...E.keys()].filter(k => !G.has(k)), extra = [...G.keys()].filter(k => !E.has(k));
  if (missing.length || extra.length) v.push({ level: 'entity-set', missing: missing.slice(0, 10), extra: extra.slice(0, 10), nMissing: missing.length, nExtra: extra.length });
  for (const [k, e] of E) { const g = G.get(k); if (g !== undefined) for (const x of same(e, g)) v.push({ [label]: k, ...x }); }
  return capped(v);
}

// Canonical equality for small values (null and undefined are the same "absent" value).
export const sameValue = (a, b) => canonical(a ?? null) === canonical(b ?? null);
export const sortedInts = xs => (Array.isArray(xs) ? [...xs].map(Number).sort((a, b) => a - b) : xs);
