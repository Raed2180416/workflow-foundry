// Bad controls and the structure-necessity control of W-bed R5.
//
// Decode controls (kind 'stage', stage 'decode'): each is the bed's pipeline with one decode mistake, so its output is
// what that misreading produces end to end (the dump pack closed by R1 from the wrong rows, then translated and
// consolidated). Generic mistakes apply to every format; each format's characteristic misreading applies to tasks of
// that format only (`formats`), the way R4's controls apply from a minimum difficulty. The generator re-draws the dump
// layer until every applicable decode mistake changes the decoded rows (world.mjs), so each fails on every task it
// applies to.
// Relation control: passes the decode stage and every R4 stage, fails D3 only.
// Inherited controls: R4's 19 controls with the true decode (index.mjs), so every R4 mistake still fails at R5.
// Necessity (W-BED §2.4 item 3): "the R4 reference with code parsers for the dev formats only": a dev-format dump is
// decoded right (the control passes there); any other dump has no parser, the pack is closed with no invoices.
import { GENERIC_MISTAKES, NECESSITY_MISTAKE } from './decode.mjs';
import { FORMATS, DEV_FORMAT_IDS } from './catalogue.mjs';

export const DECODE_CONTROL_DEFS = [
  ...GENERIC_MISTAKES.map(m => ({ name: m.name, kind: 'stage', stage: 'decode', opts: { decode: m.name }, formats: null, why: m.why })),
  ...FORMATS.map(f => ({ name: f.mistake.name, kind: 'stage', stage: 'decode', opts: { decode: f.mistake.name }, formats: [f.id], why: `${f.id}: ${f.mistake.why}` })),
];
export const RELATION_DEFS = [
  { name: 'dump-rows-raw-reported', kind: 'relation', opts: { reportRaw: true }, formats: null,
    why: 'the pack is closed from the right rows, but the answer reports the raw decode (the excluded records included) as dump.rows; every stage passes; breaks D3' },
];
export const NECESSITY_DEFS = [
  { name: 'necessity:dev-parsers-only', kind: 'necessity', opts: { decode: NECESSITY_MISTAKE }, formats: null,
    why: `the R4 reference plus code parsers for the dev formats (${DEV_FORMAT_IDS.join(', ')}) and no agent node: a dump in any other format has no parser, its rows are empty and the pack is closed with no invoices` },
];

export const appliesTo = (def, task, formatId) => (task.difficulty ?? 3) >= (def.minDifficulty ?? 0) && (!def.formats || def.formats.includes(formatId));
