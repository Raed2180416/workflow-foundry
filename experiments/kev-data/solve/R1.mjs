// R1 date_order: state-only solver (see records-lib.mjs). solve({ state, question }, solverContext)
//   -> { label: 'dmy' | 'mdy' | 'ymd', via } | { label: null, reason }
import { makeSolverContext, solveOrderIn } from './records-lib.mjs';
export { makeSolverContext };
export const PORT = 'R1';
export function solve({ state }, sc) {
  if (!state || typeof state.system !== 'string' || typeof state.source_note !== 'string') return { label: null, reason: 'malformed-state' };
  return solveOrderIn(sc, state.source_note, state.system);
}
