// E-bed seed confinement (BED-CONTRACT-v1.1 §10.1; adversarial review of step 0, finding 10). $0, pure.
//
// experiments/jit/seeds.mjs refuses a seed only when a range covering it forbids the purpose or is spent; a seed that no
// E-bed range covers passes (ebed-heldout at 9105 or 8900 on ebed-e1, ebed-sealed at 9999, ebed-heldout on another bed),
// and then escapes the per-item `used` record. The E-bed runner calls assertEbedSeeds instead, which adds two rules on
// top of the ledger's own refusals:
//   - an E-bed purpose (ebed-rehearsal | ebed-heldout | ebed-sealed | ebed-scale) is for the E-bed beds only;
//   - on an E-bed bed (ebed-e1 … ebed-e13), every seed must lie in an `owner: ebed` range of that bed whose allow list
//     names the purpose (its own block).
import { loadLedger, rangeCovers, seedRefusals } from '../jit/seeds.mjs';

export const EBED_PURPOSES = Object.freeze(['ebed-rehearsal', 'ebed-heldout', 'ebed-sealed', 'ebed-scale']);
export const isEbedBed = bed => /^ebed-e([1-9]|1[0-3])$/.test(String(bed));

export function ebedSeedRefusals(ledger, { bed, split, seed, purpose }) {
  const out = seedRefusals(ledger, { bed, split, seed, purpose });
  if (EBED_PURPOSES.includes(purpose) && !isEbedBed(bed)) out.push(`purpose ${purpose} is for the E-bed beds (ebed-e1 … ebed-e13), not ${bed}`);
  if (isEbedBed(bed)) {
    const home = ledger.ranges.filter(r => r.owner === 'ebed' && rangeCovers(r, { bed, split, seed }) && Array.isArray(r.allow) && r.allow.includes(purpose));
    if (!home.length) out.push(`seed ${seed} is outside every E-bed block of ${bed} (${split}) that allows ${purpose}`);
  }
  return out;
}

export function assertEbedSeeds({ bed, split, seeds, purpose, ledger = null }) {
  const L = ledger ?? loadLedger();
  const refused = seeds.map(seed => ({ seed, reasons: ebedSeedRefusals(L, { bed, split, seed, purpose }) })).filter(x => x.reasons.length);
  if (refused.length) {
    const e = new Error(`SEED_REFUSED: ${refused.length} ${bed}:${split} seed(s) refused for ${purpose}: ${refused.slice(0, 4).map(x => `s${x.seed} (${x.reasons.join('; ')})`).join(', ')}${refused.length > 4 ? ', ...' : ''}`);
    e.code = 'SEED_REFUSED'; e.details = refused; throw e;
  }
  return { bed, split, purpose, seeds: seeds.length };
}
