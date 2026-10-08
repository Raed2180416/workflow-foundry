// R4 timestamp_reliability: state-only solver (see records-lib.mjs). solve({ state, question }, solverContext)
//   -> { label: 'reliable' | 'restamped', via } | { label: null, reason }
import { makeSolverContext, solveStamp } from './records-lib.mjs';
export { makeSolverContext };
export const PORT = 'R4';
export function solve({ state }, sc) {
  if (!state || typeof state.system !== 'string' || typeof state.source_note !== 'string') return { label: null, reason: 'malformed-state' };
  return solveStamp(sc, state);
}
