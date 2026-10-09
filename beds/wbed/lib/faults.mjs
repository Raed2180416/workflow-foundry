// R8 fault overlay (W-BED §3.8): the hook points are designed and wired into every W-bed generator now, but every
// hook is a no-op in v1 and asking for a fault throws. Injection is implemented in round 2, after the R1-R4 round.
//
// Where each fault enters:
//   f1 schema drift        generator    hooks.schemaDrift(world, spec, r)    a renamed column, a new system, a convention
//                                                                           switch at a scheduled stream index
//   f2 tool failure        host layer   hooks.toolFailure(call, spec)        gateway 5xx/timeouts on k% of judge calls, a
//                                                                           decoder that fails on first call; never visible
//                                                                           in the task; an env_fault, not a model outcome
//   f3 adversarial content generator    hooks.adversarialContent(docs, spec, r)  planted instructions in documents
//
// Faults are scheduled at preregistered stream task indices (§8 "Fault schedule"), identical across arms and lineages,
// so `faultsAt(index)` is pure data. A generator receives `faults` (default none) and must produce a byte-identical
// task when no fault is requested; that is what the fault-free tests pin.

export const FAULT_KINDS = Object.freeze({
  f1: Object.freeze({ id: 'f1', name: 'schema drift', injectedBy: 'generator', rungs: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'],
    healthy: 'guard or invariant deopt -> interpret -> recompile with the new trace' }),
  f2: Object.freeze({ id: 'f2', name: 'tool failure', injectedBy: 'host', rungs: ['R1', 'R2', 'R3', 'R4', 'R5'],
    healthy: 'retry/escalation inside the judge, agent retry; no recompile (env_fault)' }),
  f3: Object.freeze({ id: 'f3', name: 'adversarial content', injectedBy: 'generator', rungs: ['R2', 'R3', 'R6'],
    healthy: 'no change in control flow; data dropped only via contract rule ids' }),
});

/** Preregistered schedule (W-BED §8): 1-based stream task index -> fault ids. */
export const PREREG_SCHEDULE = Object.freeze({ 5: ['f2'], 6: ['f2'], 9: ['f1'], 11: ['f3'], 13: ['f2'], 17: ['f1'], 20: ['f3'] });
export const faultsAt = index => [...(PREREG_SCHEDULE[index] ?? [])];

/** Normalise a generator's `faults` argument. v1: only "no faults" is accepted. */
export function requireNoFaults(faults) {
  if (faults === undefined || faults === null) return null;
  const ids = Array.isArray(faults) ? faults : Object.keys(faults);
  if (ids.length === 0) return null;
  throw new Error(`wbed: fault injection (${ids.join(', ')}) is designed but not implemented in v1 (W-BED §3.8, round 2)`);
}

// The hook points. Each returns its input unchanged. A rung calls them at the documented place so round 2 only has to
// replace these bodies (and lift requireNoFaults), not re-plumb the generators.
export const hooks = Object.freeze({
  schemaDrift: (world /* , spec, r */) => world,
  adversarialContent: (docs /* , spec, r */) => docs,
  toolFailure: (/* call, spec */) => ({ fail: false }),
});
