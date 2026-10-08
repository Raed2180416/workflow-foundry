// R2 status_meaning: state-only solver (see records-lib.mjs). solve({ state, question }, solverContext)
//   -> { label: 'void' | 'live', via } | { label: null, reason }
import { makeSolverContext, solveFlag } from './records-lib.mjs';
export { makeSolverContext };
export const PORT = 'R2';
export function solve({ state }, sc) {
  if (!state || typeof state.system !== 'string' || typeof state.marker !== 'string' || typeof state.source_note !== 'string') return { label: null, reason: 'malformed-state' };
  return solveFlag(sc, state);
}
