// M1 (ATTACK-20261014 §3; PROOF-LEDGER K3, K4): output-invariance contracts, run beside a compiled solver.
// A bed declares metamorphic relations beside its oracle (beds/<family>/invariance.mjs, exported by the bed's index as
// `invariance`; contract in beds/lib/metamorphic.mjs) and a witness tag (`witness`, `witnessOf(task)`, `witnessCheck`).
// This module is the engine side:
//   - invarianceOf(raw, { seedDefault }): the stream option jit.invariance, normalized (null when absent, so no arm hash
//     moves);
//   - invarianceDrawOf(seed, idx): the seeded draw that samples a task (u < share), independent of the shadow draw;
//   - selectRelations(relations, opts): which declared relations a sampled task runs (ids, distribution, perTask);
//   - runVariants({ relations, task, output, seed, runVariant, compare }): make each variant from the original task (and
//     its output where the relation needs it), run it through `runVariant(variantTask, relation)` (run-compiled.mjs: the
//     same solver, model port and flow in a fresh workdir), and check it. The first relation whose variant ran ok and
//     whose check returns violations is the disagreement; run-compiled turns it into a deopt of kind 'invariance'.
// Policy (documented choices): a variant that does not run ok (deopt, crash, timeout, invalid, environment fault) is
// recorded and never counts as a disagreement; a relation that cannot build a variant (skip) is recorded. No model is
// called here: model calls happen only inside runVariant, through the caller's port.
import { createHash } from 'node:crypto';
import { WITNESS_TAGS } from '../../beds/lib/metamorphic.mjs';

export { WITNESS_TAGS };
export const INVARIANCE_KIND = 'invariance';
export const DISTRIBUTIONS = Object.freeze(['in', 'out']);

// u in [0, 1) from sha256(`${seed}:${idx}:invariance`) (52 bits): a resume or replay of the same stream draws the same u, and
// it is independent of the shadow draw (stream.mjs shadowDrawOf uses the suffix ':shadow').
export const invarianceDrawOf = (seed, idx) => parseInt(createHash('sha256').update(`${seed}:${idx}:invariance`).digest('hex').slice(0, 13), 16) / 2 ** 52;

// A relation list as a bed exports it: validated, never mutated.
export function validateRelations(list, familyId = '?') {
  if (!Array.isArray(list)) throw new Error(`bed ${familyId}: invariance must be a list of relations`);
  const ids = new Set();
  for (const r of list) {
    if (!r || typeof r.id !== 'string' || !r.id) throw new Error(`bed ${familyId}: a relation without an id`);
    if (ids.has(r.id)) throw new Error(`bed ${familyId}: relation ${r.id} declared twice`);
    ids.add(r.id);
    if (typeof r.make !== 'function' || typeof r.check !== 'function') throw new Error(`bed ${familyId}: relation ${r.id} needs make() and check()`);
    if (!['invariant', 'transform'].includes(r.kind)) throw new Error(`bed ${familyId}: relation ${r.id} kind must be invariant or transform`);
    if (!DISTRIBUTIONS.includes(r.distribution)) throw new Error(`bed ${familyId}: relation ${r.id} distribution must be in or out`);
  }
  return list;
}

// jit.invariance (opt-in): { share, seed?, relations?, distribution?, perTask?, relTol? }.
//   share         the probability a compiled ok run is checked, in (0, 1];
//   seed          the draw seed (default config.seed, else config.experiment; written out, so it is hashed);
//   relations     relation ids to run (default: every declared one, filtered by distribution);
//   distribution  'in' (default: only relations whose variants keep the generator's regularities) or 'all';
//   perTask       at most this many relations per sampled task, drawn seeded (default: all selected);
//   relTol        the numeric tolerance handed to the relation's check (default: the relation's own).
// Absent, null is returned and the normalized config has no key, so no arm hash moves.
export function invarianceOf(raw, { seedDefault } = {}) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('config.jit.invariance must be an object');
  const KEYS = ['share', 'seed', 'relations', 'distribution', 'perTask', 'relTol'];
  for (const k of Object.keys(raw)) if (!KEYS.includes(k)) throw new Error(`config.jit.invariance.${k} is not supported (${KEYS.join(', ')})`);
  if (typeof raw.share !== 'number' || !Number.isFinite(raw.share) || !(raw.share > 0) || raw.share > 1) throw new Error('config.jit.invariance.share must be a number in (0, 1]');
  if (raw.seed != null && typeof raw.seed !== 'string' && !Number.isInteger(raw.seed)) throw new Error('config.jit.invariance.seed must be a string or an integer');
  if (raw.relations != null && (!Array.isArray(raw.relations) || !raw.relations.length || raw.relations.some(x => typeof x !== 'string' || !x))) throw new Error('config.jit.invariance.relations must be a non-empty list of relation ids');
  const distribution = raw.distribution ?? 'in';
  if (!['in', 'all'].includes(distribution)) throw new Error("config.jit.invariance.distribution must be 'in' or 'all'");
  if (raw.perTask != null && !(Number.isInteger(raw.perTask) && raw.perTask >= 1)) throw new Error('config.jit.invariance.perTask must be an integer >= 1');
  if (raw.relTol != null && !(typeof raw.relTol === 'number' && raw.relTol >= 0 && raw.relTol <= 0.05)) throw new Error('config.jit.invariance.relTol must be a number in [0, 0.05]');
  return { share: raw.share, seed: String(raw.seed ?? seedDefault), ...(raw.relations ? { relations: [...raw.relations] } : {}), distribution,
    ...(raw.perTask != null ? { perTask: raw.perTask } : {}), ...(raw.relTol != null ? { relTol: raw.relTol } : {}) };
}

// The relations a sampled task runs: by id (in the order declared), else by distribution; then at most perTask, drawn with
// the task's own seed so a replay picks the same ones.
export function selectRelations(relations, { ids = null, distribution = 'in', perTask = null, seed = '', idx = 0 } = {}) {
  let list = ids ? relations.filter(r => ids.includes(r.id)) : relations.filter(r => distribution === 'all' || r.distribution === distribution);
  if (ids) { const missing = ids.filter(id => !relations.some(r => r.id === id)); if (missing.length) throw new Error(`invariance: unknown relation ${missing.join(', ')}`); }
  if (perTask != null && list.length > perTask) {
    const key = r => createHash('sha256').update(`${seed}:${idx}:${r.id}:pick`).digest('hex');
    const keep = new Set([...list].sort((a, b) => (key(a) < key(b) ? -1 : 1)).slice(0, perTask).map(r => r.id));
    list = list.filter(r => keep.has(r.id));
  }
  return list;
}

// Run each relation's variant and check it. Returns { results: [{relation, status, ...}], violated: result | null, costUsd,
// costUnknown }. result.status: 'agree' (the variant ran ok and the relation holds), 'disagree' (violations), 'skip' (no
// variant could be built), 'variant-<status>' (the variant did not run ok; not a disagreement), 'error' (a relation threw:
// recorded, never a disagreement). stopOnViolation (default true) stops at the first disagreement, as a deopt does.
export async function runVariants({ relations, task, output, seed, runVariant, compare = {}, stopOnViolation = true }) {
  const results = [];
  let costUsd = 0, costUnknown = false, violated = null;
  for (const rel of relations) {
    let made;
    try { made = rel.make(structuredClone(task), { seed: `${seed}:${rel.id}`, output: rel.needsOutput ? structuredClone(output) : undefined }); }
    catch (error) { results.push({ relation: rel.id, status: 'error', error: String(error?.message ?? error).slice(0, 300) }); continue; }
    if (!made || made.skip) { results.push({ relation: rel.id, status: 'skip', reason: made?.skip ?? 'no variant' }); continue; }
    const run = await runVariant(made.task, rel);
    costUsd += run?.costUsd ?? 0; costUnknown ||= !!run?.costUnknown;
    const base = { relation: rel.id, distribution: rel.distribution, info: made.info ?? null, costUsd: run?.costUsd ?? 0 };
    if (run?.status !== 'ok') {
      results.push({ ...base, status: `variant-${run?.status ?? 'missing'}`, ...(run?.deopt ? { deopt: { kind: run.deopt.kind ?? null, name: run.deopt.name ?? null } } : {}), ...(run?.error?.code ? { error: run.error.code } : {}) });
      continue;
    }
    let violations;
    try { violations = rel.check(output, run.output, made.info ?? {}, compare); }
    catch (error) { results.push({ ...base, status: 'error', error: String(error?.message ?? error).slice(0, 300) }); continue; }
    const r = violations?.length ? { ...base, status: 'disagree', violations, ...(run.output !== undefined ? { variantOutput: run.output } : {}) } : { ...base, status: 'agree' };
    results.push(r);
    if (r.status === 'disagree' && !violated) { violated = r; if (stopOnViolation) break; }
  }
  return { results, violated, costUsd, costUnknown };
}

// A compact view of a runVariants result for an event or a row (no outputs).
export const invarianceSummary = v => ({ ran: v.results.filter(r => r.status === 'agree' || r.status === 'disagree').length, relations: v.results.map(r => r.relation),
  statuses: Object.fromEntries(v.results.map(r => [r.relation, r.status])), violated: v.violated?.relation ?? null, costUsd: Math.round(v.costUsd * 1e6) / 1e6,
  ...(v.violated ? { levels: [...new Set(v.violated.violations.map(x => x.level))] } : {}) });
