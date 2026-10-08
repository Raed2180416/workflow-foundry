// Generator for the construction-crossfamily group (JUDGE-PROGRAM.md §1.2 X5 bedtype, C1, C2, C7, C8, C9; §2.2; plan group
// "construction-crossfamily"):
//   X5:bedtype  precondition_holds across task families: the assumption is a bed family's task statement (trusted, in the
//               question), the state is another task's prompt head and inputs head (untrusted). Wave 1; kinetics and runbook are
//               held out for test-ood. See crossfamily-bedtype.mjs.
//   C1, C2      objective_requirements / objective_ungrounded from the objective composer (wave-2 smoke: train and dev-select)
//   C7          transcript_gaming from the tool-call composer (wave-2 smoke)
//   C8, C9      notes_leak / same_task_family (wave 3, the group's cut line; smoke sets)
// C1-real (hand labels) is not built until the owner names annotators (O5). The regex baselines (REQUIREMENT_LIBRARY, the C0
// hidden-path regex) are imported from src/construction-objective.mjs and experiments/c0/construct.mjs, read-only, by
// crossfamily-baselines.mjs (they are baselines to compare against, never label sources).
//
// Pure: the same (slice, seeds, opts, factory version, bed pin) gives the same records in the same order. Every choice is a salted
// hash of the record key: no Math.random, no clock, no network. Beds are imported through ctx.beds (the frozen copy); nothing here
// reads the held-out directory.
//
// opts (plain data, all optional):
//   ports      port ids to generate (default: the slice's ports)
//   rows       { X5: n | {slice: n}, C1: ... } row targets (default: JUDGE-PROGRAM.md §4.3 and the plan's estimatedRecords;
//              rows are questions: a C1 record holds 12, an X5 paraphrase record 3)
//   wordings   { X5: [{id, text}] | { slice: [{id, text}] } } the held-out wordings of THIS slice, or of every slice by name (required in
//              calib-ood, dev-ood, test-ood)
//   readmeAnchors  the README anchors of the beds (default: README_ANCHORS of crossfamily-bedtype.mjs; tests with stub beds pass theirs)
import { bedtypeRecords, GENERATOR_VERSION as BEDTYPE_VERSION, heldoutSpans as bedHeldoutSpans, registerHeldout as bedRegisterHeldout } from './crossfamily-bedtype.mjs';
import { cRecords, C_PORTS, C_SLICES } from './crossfamily-cports.mjs';

export const group = 'construction-crossfamily';
export const ports = ['X5:bedtype', 'C1', 'C2', 'C7', 'C8', 'C9'];
export const GENERATOR_VERSION = `construction-crossfamily@1+${BEDTYPE_VERSION}`;
export const CUT_LINE_PORTS = Object.freeze(['C8', 'C9']);

// Which ports a slice asks for by default. X5 bedtype in every slice but the reserves; the smoke sets of C1, C2, C7, C8, C9 in
// train and dev-select (§4.3, §10).
export const SLICE_PORTS = Object.freeze({
  train: ['X5', ...C_PORTS], 'calib-in': ['X5'], 'calib-ood': ['X5'], 'dev-select': ['X5', ...C_PORTS], 'dev-ood': ['X5'], 'test-in': ['X5'], 'test-ood': ['X5'], 'real-reserve': [], 'e2e-reserve': [],
});

export async function* records(slice, seeds, opts = {}, ctx) {
  const wanted = (opts.ports ?? SLICE_PORTS[slice] ?? []).map(p => String(p).split(':')[0]);
  if (wanted.includes('X5')) yield* bedtypeRecords(slice, seeds, opts, ctx);
  for (const port of C_PORTS) if (wanted.includes(port) && C_SLICES.includes(slice)) yield* cRecords(port, slice, seeds, opts, ctx);
}

export const heldoutSpans = bedHeldoutSpans;
export const registerHeldout = bedRegisterHeldout;
