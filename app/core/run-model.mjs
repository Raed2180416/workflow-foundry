// The one place product code reaches the run-view reducer. tools/run-view/run-view.js is a browser script that defines
// globalThis.RunViewCore as a side effect (its UI starts only when a document exists); app/core reads the reducer only through this module,
// so moving the reducer into src/ or app/core (review m8, 2026-11-04) is a change to this file alone. Until then the import fails fast if
// the prototype stops exporting what app/core uses.
import '../../tools/run-view/run-view.js';

const NEEDED = ['RunModel', 'buildSemantic', 'layoutRanks', 'defOf', 'humanize', 'sanitizeDisplay', 'classifyError', 'combineStates', 'semAgg', 'semProgress', 'semLine', 'instLine',
  'fmtDur', 'STATES', 'ROLE_VERB'];
export const RunViewCore = globalThis.RunViewCore;
const missing = NEEDED.filter(k => RunViewCore?.[k] === undefined);
if (missing.length) throw new Error(`tools/run-view/run-view.js no longer provides ${missing.join(', ')} (app/core/run-model.mjs)`);
