// The held-out set of PREREG-TRACKER-H (research/tracker-20261021/heldout/cases.json): loading, the person's words per case, and the
// $0 builds every case has without a model (the reference slots, and each bad-slot control). Analyst-side; the app tracker never
// imports it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { templateById, instantiate } from '../../../app/core/library.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const HELDOUT_DIR = path.join(ROOT, 'research/tracker-20261021/heldout');
export const HCASES_FILE = path.join(HELDOUT_DIR, 'cases.json');
/** Cases whose reference flow is defective by design: the words ask for what no template flow can do (cases.json oracleNote). */
export const BY_DESIGN_DEFECTIVE = Object.freeze(['HL2', 'HO1']);

export const loadHeldout = (file = HCASES_FILE) => JSON.parse(readFileSync(file, 'utf8')).cases;

/** A builder that returns fixed slots on the case's template (no model, $0): the reference, or a control. */
export function slotsBuilder(caseDef, slots, id = 'reference-slots/1 (no model)') {
  return { id, async: true, build: async () => {
    const t = templateById(caseDef.template);
    return { status: 'ready', builder: id, template: t.id, workflow: instantiate(t, slots, { builder: id }), understood: { slots }, buildReport: null };
  } };
}
export const controlSlots = (caseDef, k) => ({ ...caseDef.reference, ...caseDef.controls[k].slots });
