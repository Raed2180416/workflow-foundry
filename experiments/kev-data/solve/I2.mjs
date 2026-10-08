// I2 log_line_role: state-only solver (JUDGE-PROGRAM.md §2.7 step 1; see incident-lib.mjs).
//   solve({ state, question }, sc) -> { label, via } | { label: null, reason, ... }
// A solver sees the exported state { line, emitting_service, calls } and the exported catalog, nothing else. The line is
// matched to the catalog's templates (the pools it can have been written from, with the emitting service's own name
// required where a template writes it); the pools name the tags the bed emits them under, and the contract's tag table
// turns tags into options. Reasons it does not decide:
//   malformed-state  the state is not an I2 state
//   unmatched        no template of the catalog writes this message
//   collision        templates of different options write it (the state does not say which): the factory gives such a
//                    row a soft target, or drops it from a gated set
//   excluded         every pool that writes it is emitted only under a tag the table excludes (echo, consequence, shadow)
import { makeSolverContext, splitLine, topPools, labelsOfPools } from './incident-lib.mjs';
export { makeSolverContext };
export const PORT = 'I2';
export function solve({ state }, sc) {
  if (!state || typeof state.line !== 'string' || typeof state.emitting_service !== 'string' || !Array.isArray(state.calls)) return { label: null, reason: 'malformed-state' };
  const l = splitLine(state.line);
  if (!l) return { label: null, reason: 'malformed-state' };
  const pools = topPools(sc, l.message, state.emitting_service);
  if (!pools.length) return { label: null, reason: 'unmatched' };
  const { labels, excluded, unknown } = labelsOfPools(sc, pools);
  if (unknown.length) return { label: null, reason: 'unknown-pool', unknown };
  if (labels.size === 1) return { label: [...labels][0], via: pools.slice(0, 3), excludedTags: [...excluded] };
  if (labels.size === 0) return { label: null, reason: 'excluded', tags: [...excluded] };
  return { label: null, reason: 'collision', labels: [...labels].sort(), pools: pools.slice(0, 6) };
}
