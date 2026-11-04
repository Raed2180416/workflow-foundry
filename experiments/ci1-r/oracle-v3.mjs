// CI-1 oracle v3 candidate (review finding 2), for FUTURE bed freezes only: no frozen or reported CI-1 capability number uses it.
// v3 is oracle v2 (experiments/ci1-posthoc/oracle-v2.mjs, unchanged) plus the three wave-2 corrections that are general rather than
// item-specific (the other w2x transforms in rescore-w2x.mjs read one item's description and stay declarations):
//   a. e-mail addresses are case-insensitive: v1/v2 lower-case message recipients but compare an address written into a sheet cell or a
//      JSON answer exactly, so 17771's NOOR.FAIRHURST@... failed against noor.fairhurst@...; v3 lower-cases every cell and answer value
//      that is a whole address, on both sides;
//   b. words of categorical cells (computed over the frozen worlds, decl.categorical) do not identify other rows: 18797's Owner
//      "Pavel Okonkwo" no longer identifies the invoice whose client is "Pavel Rothwell" (w2x's withoutCategoricalWords);
//   c. sheets the bed author DECLARES as settings at freeze time (decl.settings, e.g. 19014's onboarding-config) are not data rows:
//      mentioning their values is not a leak. Not detected automatically: a row-count rule ("one row in every world") was tried and
//      matches neither 19014 (its generator varies the config sheet from 0 to 3 rows) nor anything else, while it would exempt data
//      sheets that happen to hold one row; the probe's settings-mention rewrite flags candidates for the author to read instead.
// Each change only removes a distinction (a v2 pass stays a pass). The must-fail half of fn-probe.mjs checks what v3 still catches.
import { equivalentV2, rowIdentitiesWithAddresses } from '../ci1-posthoc/oracle-v2.mjs';
import { withoutCategoricalWords } from '../ci1-posthoc/rescore-w2x.mjs';

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const ADDRESS = /^\s*[\w.+-]+@[\w-]+(\.[\w-]+)+\s*$/;
/** A value with every whole-address string lower-cased (deep, for JSON answers). */
export const lowerAddresses = v => (typeof v === 'string' && ADDRESS.test(v) ? v.trim().toLowerCase()
  : Array.isArray(v) ? v.map(lowerAddresses) : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, lowerAddresses(x)])) : v);
/** A canonical effect set with address-like sheet cells and answer values lower-cased. */
export function canonLowerAddresses(c) {
  if (!c) return c;
  return { ...c, respond: (c.respond ?? []).map(r => ({ ...r, body: lowerAddresses(r.body) })),
    sheets: Object.fromEntries(Object.entries(c.sheets ?? {}).map(([name, rows]) => [name, rows.map(r => lowerAddresses(r))])) };
}
/** v3 row identities for the leak check: declared settings sheets left out, categorical words removed from the other cells. */
export function rowsV3(world, vocab, categorical, settings = []) {
  const set = new Set(settings);
  const data = { ...world, sheets: Object.fromEntries(Object.entries(world.sheets ?? {}).filter(([k]) => !set.has(k))) };
  return rowIdentitiesWithAddresses(withoutCategoricalWords(data, [...categorical]), vocab, categorical);
}
/** decl as for equivalentV2; pass decl.rowsWithAddresses from rowsV3 to get changes b and c. */
export const equivalentV3 = (ref, cand, decl) => equivalentV2(canonLowerAddresses(ref), canonLowerAddresses(cand), decl);
