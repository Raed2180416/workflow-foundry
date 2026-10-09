// The subsidiary packs of W-bed R4: each child is an R1 ("receivables close") or R3 ("statement audit") task produced
// by that rung's own generate() with a child seed derived from the parent seed. The child's oracle, reference output,
// trace and composed oracle are that rung's own; R4 never re-implements them. One addition: a planted child (the
// composition test, W-BED §3.4) has one billing system's invoice list re-rendered in a date dialect no R1 draw uses
// (lib/dialects JULIAN_CYYDDD) and its ledger notes say so. Re-rendering changes surface text only (the same days), so
// the R1 oracle, recomputed from the child seed, is still the child's oracle.
import * as R1 from '../r1/index.mjs';
import * as R3 from '../r3/index.mjs';
import { buildLedger } from '../r1/world.mjs';
import { buildAudit } from '../r3/world.mjs';
import { extract as r1Extract, normalise as r1Normalise, reconcile as r1Reconcile, report as r1Report } from '../r1/pipeline.mjs';
import { statusLiveOf } from '../r1/vocab.mjs';
import { scoreReport } from '../r1/score.mjs';
import { scoreAudit } from '../r3/score.mjs';
import { makeStages as r1MakeStages, composeOracle as r1ComposeOracle } from '../r1/stages.mjs';
import { fmtJulian, JULIAN_TEXT, OUTSIDE_R1_DATE_STYLES } from '../lib/dialects.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// Child seed derivation. childSeed = 1,000,000 + 64 * parentSeed + 16 * (difficulty - 2) + k, k = slot 0..15.
// Injective in (parentSeed, difficulty, k) for parentSeed >= 0, difficulty 2..5, k < 16; every child seed is >= 1,000,000,
// above every bounded range of research/jit-20261008/SEED-LEDGER.json on either split (the largest bounded `to` is 8524).
// The child keeps the parent's split. On the test split the open-ended `test-clean` row (7200..) covers every seed by
// definition (status 'clean': no owner, no reservation); see W-BED-R4-NOTES §4.
export const CHILD_SEED_BASE = 1000000;
export const CHILD_SLOTS = 16;
export function childSeedOf(parentSeed, difficulty, k) {
  if (!Number.isInteger(parentSeed) || parentSeed < 0) throw new Error(`wbed-r4: parent seed must be a non-negative integer, got ${parentSeed}`);
  if (!Number.isInteger(k) || k < 0 || k >= CHILD_SLOTS) throw new Error(`wbed-r4: child slot ${k} out of range`);
  if (!(difficulty >= 2 && difficulty <= 5)) throw new Error(`wbed-r4: difficulty ${difficulty}`);
  return CHILD_SEED_BASE + parentSeed * 64 + (difficulty - 2) * CHILD_SLOTS + k;
}

export const FAMILIES = { 'wbed-r1': R1, 'wbed-r3': R3 };
// A pack's oracle is its rung's: R1 oracle(task, out) = scoreReport(truthOf(task).report, out) and referenceSolve(task) =
// that report; R3 likewise with scoreAudit and the reduced result. Scoring against the pack's cached reference output
// with the rung's own scorer is the same function without rebuilding the child world (the tests pin the agreement).
const SCORERS = { 'wbed-r1': scoreReport, 'wbed-r3': scoreAudit };
export function childOracle(kid, output) { return SCORERS[kid.family](kid.output, output); }
export const reportDateOf = (family, spec) => (family === 'wbed-r1' ? buildLedger(spec.seed, spec.split, spec.difficulty).conv.close : buildAudit(spec.seed, spec.split, spec.difficulty).S);

// ---------------------------------------------------------------------------------------------------------------------
// The planted dialect. For each plantable system: the sentence of R1's ledger notes that states its date format, and
// its replacement. R1's render writes these sentences verbatim (r1/render.mjs ledgerNotes); a missing match throws.
const PLANT_NOTES = {
  BRIGHTDESK: ['Invoice dates are written MM/DD/YYYY (US style).',
    `This subsidiary's BRIGHTDESK instance exports through the finance bridge of its former parent company: invoice dates are written as ${JULIAN_TEXT}.`],
  LEDGR: ['Rechnungsdatum (DD.MM.YYYY)', `Rechnungsdatum (this subsidiary's LEDGR exports invoice dates as ${JULIAN_TEXT})`],
  KOBO: ['| YYYY/MM/DD |', `| <invoice date, as ${JULIAN_TEXT}> |`],
};
// VERITAS (JSON lines, "issued":"2025-05-31") is not plantable: measured on dev seeds, the slice-1 input profile
// (experiments/jit/profile.mjs) does not see a CYYDDD value inside a JSON-lines string, so a planted VERITAS pack would
// pass the profile and turn the composition test into a test of the profile's blind spot (W-BED-R4-NOTES §5).
export const UNPLANTABLE_NOTE = { VERITAS: ['issued (ISO date)', `issued (the invoice date, exported as ${JULIAN_TEXT})`] };
export const PLANTABLE_SYSTEMS = Object.keys(PLANT_NOTES);
export const PLANTED_STYLE = 'JULIAN_CYYDDD';
if (!OUTSIDE_R1_DATE_STYLES[PLANTED_STYLE]) throw new Error('wbed-r4: planted style missing from lib/dialects');

const countOf = (text, s) => text.split(s).length - 1;

/** Re-render system `S` of an R1 task's inputs in the planted dialect. Returns the new inputs (the original is not changed). */
export function plantInputs(world, inputs, S) {
  const out = structuredClone(inputs);
  const mine = world.invoices.filter(i => i.system === S);
  const lines = out.invoices[S].split('\n');
  const head = lines.length - mine.length;
  if (head < 0 || head > 1) throw new Error(`wbed-r4: ${S} list has ${lines.length} lines for ${mine.length} invoices`);
  mine.forEach((inv, i) => {
    const t = world.render.invText.get(inv.no);
    const line = lines[head + i];
    if (line !== t.line || countOf(line, t.date) !== 1) throw new Error(`wbed-r4: cannot re-date ${inv.no}`);
    lines[head + i] = line.replace(t.date, fmtJulian(inv.day));
  });
  out.invoices[S] = lines.join('\n');
  const [from, to] = PLANT_NOTES[S];
  if (countOf(out.ledger_notes, from) !== 1) throw new Error(`wbed-r4: notes sentence for ${S} not found once`);
  out.ledger_notes = out.ledger_notes.replace(from, to);
  return out;
}

/** The exact R1 trace of a planted child: R1's own, with the surface date text of system S as the pack prints it. */
export function plantedTrace(world, refTrace, S) {
  const tr = structuredClone(refTrace);
  const day = new Map(world.invoices.map(i => [i.no, i]));
  for (const x of tr.extract.invoices) if (x.system === S) x.date_text = fmtJulian(day.get(x.invoice).day);
  return tr;
}

/**
 * What a reused R1 solver does with a planted pack (control `outside-profile-reused`): its parser has no rule for the
 * dialect, the dates of system S do not parse, and the close-date filter lets every S invoice through. Returns the
 * full R1 trace of that run.
 */
export function misreadTrace(world, S) {
  const ex = r1Extract(world);
  const day = new Map(world.invoices.map(i => [i.no, i]));
  for (const x of ex.invoices) if (x.system === S) x.date_text = fmtJulian(day.get(x.invoice).day);
  const no = r1Normalise(world);
  no.invoices = no.invoices.map(n => { const w = day.get(n.invoice); return w.system === S ? { ...n, live: statusLiveOf(w) } : n; });
  const rc = r1Reconcile(world);
  return { extract: ex, normalise: no, reconcile: rc, report: r1Report(world, ex, no, rc) };
}

/** Systems of an R1 world that can carry the plant decisively: present, plantable, and misreading them changes the report. */
export function plantableSystems(world, truthReport) {
  const out = [];
  for (const S of PLANTABLE_SYSTEMS) {
    if (!world.systems.includes(S)) continue;
    const mine = world.invoices.filter(i => i.system === S);
    if (mine.length < 4 || !mine.some(i => i.day <= world.conv.close)) continue;
    if (scoreReport(truthReport, misreadTrace(world, S).report).pass) continue;
    out.push(S);
  }
  return out;
}

/** Stage oracles of a planted child: R1's own stage definitions over the planted truth and inputs. */
export function plantedComposedOracle(childTask, trace, truth, inputs) {
  const stages = r1MakeStages(() => truth, () => structuredClone(inputs));
  return r1ComposeOracle(stages, childTask, trace);
}

export { buildLedger, buildAudit };
