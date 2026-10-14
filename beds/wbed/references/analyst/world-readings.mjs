// Analyst-side judge readings from the bed's generator world (PROOF-LEDGER B10 review, 2026-10-14, finding 4): the answers
// a correct reader gives to the judges a frozen reference asks, taken from the generator's own world instead of an author's
// reading, so the references' code can be measured at $0 on dev seeds the author never saw (validate.mjs --policies world).
// It measures the code given correct readings, never a model, and it is not evidence about judges.
//
// Host side only: this module reads generator internals (beds/wbed/r1/world.mjs, the records world under it, records'
// country and city pools, R3's referenceSolve). What reaches the sandbox is the flow-override JSON this returns, read by
// world-override.mjs (R1) or author/author-override.mjs (R3) through flow-v3's override hook (tools/flow-override.mjs,
// harness only). Dev split only: validate.mjs never generates another split, and readingsFor refuses one.
import { COUNTRIES, ALL_CITIES } from '../../../records/pools.mjs';
import { isoDay } from '../../lib/domain.mjs';

const ORDER = o => String(o).toUpperCase();
const other = o => (o === 'DMY' ? 'MDY' : 'DMY');
const orderEntry = (order, switchDay = null, after = null) => ({ order, switch_date: switchDay == null ? '' : isoDay(switchDay), order_after_switch: switchDay == null ? other(order) : after });

/** Place aliases [text, ISO code, kind]: the pools a records world draws place text from (codes, names, typos, prose,
 *  demonyms, cities). */
export function placeAliases() {
  const out = [];
  for (const [iso, c] of Object.entries(COUNTRIES)) {
    out.push([iso, iso, 'code']);
    for (const a of [...c.en, ...c.de, ...c.typo, ...c.prose]) out.push([a, iso, 'name']);
    out.push([c.demonym, iso, 'demonym']);
    for (const a of ALL_CITIES[iso] ?? []) out.push([a, iso, 'city']);
  }
  return out;
}

/** R1: the per-task conventions the notes state, as the generator drew them. */
export async function r1Readings(seed, difficulty) {
  await import('../../r1/index.mjs'); // registers the verifier, as generate() does
  const { buildLedger } = await import('../../r1/world.mjs');
  const w = buildLedger(seed, 'dev', difficulty), ctx = w.rw.ctx, conv = ctx.conv;
  // Numeric birth dates (records/world.mjs: atlasMonthFirst(date) = (conv.atlas === 'mdy') !== (date >= atlasCutoff), where
  // date is the row's last-change date). LEDGR writes day.month.year and KOBO year first in every task.
  const atlas = ORDER(conv.atlas);
  const dob = {
    BRIGHTDESK: orderEntry(ORDER(conv.bd)),
    VENDEX: orderEntry(ORDER(conv.vendex)),
    ATLAS: ctx.cutoff == null ? orderEntry(atlas) : orderEntry(atlas, ctx.cutoff, other(atlas)),
    LEDGR: orderEntry('DMY'),
  };
  // Numeric invoice dates (R1 world: ATLAS uses atlasPre before atlasSwitch, atlasPost from it).
  const dateOrder = { ATLAS: w.conv.atlasSwitch == null ? orderEntry(w.conv.atlasPost) : orderEntry(w.conv.atlasPre, w.conv.atlasSwitch, w.conv.atlasPost) };
  return {
    world: {
      dob, dateOrder,
      rowMarkers: conv.flags.map(f => ({ system: f.system, token: f.token, meaning: f.polarity === 'void' ? 'VOID' : 'KEEP' })),
      invoiceStatuses: w.flags.map(f => ({ system: f.system, word: f.word, meaning: f.polarity === 'void' ? 'DOES_NOT_COUNT' : 'COUNTS' })),
      places: placeAliases(),
    },
  };
}

/** R3: the reason of every discrepancy, from the bed's labelled output (as author/fixture-answers.json holds them). */
export async function r3Readings(seed, difficulty) {
  const bed = await import('../../r3/index.mjs');
  const ref = bed.referenceSolve(bed.generate({ seed, split: 'dev', difficulty }));
  const reason = {};
  for (const st of ref.statements) for (const d of st.discrepancies) reason[`${st.vendor_id}|${d.ref}`] = d.reason;
  return { answers: { reason } };
}

export async function readingsFor(rung, seed, difficulty, split = 'dev') {
  if (split !== 'dev') throw new Error('world readings are for dev seeds only');
  if (rung === 'r1') return r1Readings(seed, difficulty);
  if (rung === 'r3') return r3Readings(seed, difficulty);
  throw new Error(`no world readings for ${rung}`);
}
