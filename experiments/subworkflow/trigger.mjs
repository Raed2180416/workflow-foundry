// The observable sub-workflow trigger (review of RESULT-SW-1, defect 3). In SW-1 and SW-1b the parent-directed arms routed
// a node to a sub-workflow when the bed's world said its channel was a backlog (bed.channelKinds: analyst-side, right by
// construction). This is the trigger a parent can compute from the node's input alone, with no model and no world
// access. It was first written post hoc (trigger-check.mjs, after the 3-5 vs 45-281 record ranges were seen); PREREG-SW-1c
// freezes it, threshold included, before any run that uses it, and SW-1c's boundary stratum (golive d2 + d3: legacy
// backlogs of 28-36 and 44-56 rows) is where the size primitive can be wrong.
//   format: the export is not a JSON list (golive's simple channels hand over a JSON list; backlogs are legacy text);
//   size:   the export holds more than SIZE_ROWS records (data lines of a delimited export, @@ RECORD blocks, list items).
// The frozen rule (PREREG-SW-1c) is SIZE ONLY: route to a sub-workflow iff records(export) > SIZE_ROWS. "format OR size"
// fires on every legacy export in golive, whatever its size, so it cannot be wrong on this bed and tests nothing.
export const SIZE_ROWS = 40;

export const isJsonList = text => { try { return Array.isArray(JSON.parse(text)); } catch { return false; } };
export function records(text) {
  if (typeof text !== 'string') return 0;
  if (isJsonList(text)) return JSON.parse(text).length;
  const blocks = (text.match(/^@@ RECORD /gm) ?? []).length;
  if (blocks) return blocks;
  return Math.max(0, text.split('\n').filter(l => l.trim() && !l.startsWith('#')).length - 1); // minus the header line
}
export const primitives = Object.freeze({ format: input => !isJsonList(input.export), size: (input, rows = SIZE_ROWS) => records(input.export) > rows });
/** The frozen SW-1c trigger: true = the parent routes this node through a sub-workflow. */
export const observableTrigger = (input, { rows = SIZE_ROWS } = {}) => primitives.size(input, rows);
