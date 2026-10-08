// R3 sign_convention: state-only solver (see records-lib.mjs). solve({ state, question }, solverContext)
//   -> { label: 'same' | 'opposite', via } | { label: null, reason }
import { makeSolverContext, solveSide } from './records-lib.mjs';
export { makeSolverContext };
export const PORT = 'R3';
export function solve({ state }, sc) {
  if (!state || typeof state.system !== 'string' || typeof state.source_note !== 'string') return { label: null, reason: 'malformed-state' };
  return solveSide(sc, state);
}
