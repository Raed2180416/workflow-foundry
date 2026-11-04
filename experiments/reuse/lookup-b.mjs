// Program B's registry lookup (review of C2-1/C2-2, finding 3). The C2 drivers fetched the proven entry by a hard-coded
// id (registry.get(PROVEN_ID) in c2.mjs, c22.mjs, posthoc.mjs; those files are frozen and stay so), while the write-ups
// said "B asks for the contract and gets A's entry". This module is that path: B computes its OWN contract from its own
// procedure text, tool catalog and columns (registry.mjs contractOf), looks it up with its supplier as the source, and
// applies a declared choice rule to the candidates. lookup-check.mjs runs it, $0, against the registries the C2 runs
// used and records whether it returns the entry they fetched by id.
//
// The choice rule (declared 2026-11-04, before lookup-check.mjs was first run):
//   reuse candidates = live (unrevoked) entries with B's contract hash that are NOT scoped to a source (an entry scoped
//   to a supplier is that supplier's own rebuild, the deopt target, not a candidate for reuse) and whose origin program
//   is not B; ordered by registration; B takes the first one and then decides admission with its gate (C2-1: b3;
//   post-hoc and C2-2: conformance on the supplier's history). The supplier's own scoped entries are returned
//   separately as `own` (registration order), for the deopt path.
// With several reuse candidates this rule takes the oldest; C2 has one, so the rule is untested beyond that, and a
// second proven entry (RESULT-C2-1 §7, next step 2) needs a rule that is measured, not declared.
import { contractHashOf, contractOf } from './registry.mjs';

export const CHOICE_RULE = 'first-registered live unscoped entry whose origin program is not the caller';
export const PROGRAM_B = 'B (Hazmat Shipment Desk)';

/** B's contract for the dangerous-goods sub-task, from B's own inputs: { contract, hash }. */
export function contractOfB({ procedureText, catalog, inputColumns, outputColumns = ['hazard_class'] }) {
  const contract = contractOf({ procedureText, catalog, inputColumns, outputColumns });
  return { contract, hash: contractHashOf(contract) };
}

const fromProgram = (e, program) => String(e.origin?.program ?? '').startsWith(program);

/**
 * lookupForReuse(registry, { hash, source, program }) -> { hash, rule, candidates: [id], chosen: entry | null, own: [id] }.
 * registry: registry.mjs createRegistry(...). A miss (no entry for the hash) returns chosen null and empty lists.
 */
export function lookupForReuse(registry, { hash, source, program = PROGRAM_B }) {
  const live = registry.lookup(hash, { source });
  const candidates = live.filter(e => !e.scope?.source && !fromProgram(e, program));
  const own = live.filter(e => e.scope?.source === source);
  return { hash, rule: CHOICE_RULE, candidates: candidates.map(e => e.id), chosen: candidates[0] ?? null, own: own.map(e => e.id) };
}
