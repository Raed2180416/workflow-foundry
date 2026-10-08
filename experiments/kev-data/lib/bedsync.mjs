// Bed-derived contract parts (JUDGE-PROGRAM.md §2.1 bed pin; spec optionsFrom and the I2 tag table):
// option sets copied from bed constants, and the bed version a tag table is pinned to. They are
// re-checked against a frozen copy (lib/pin.mjs frozenBeds) by every build that asks one of these
// ports, and by the contracts-lib test at the current pin, so a bed edit that renames a class or bumps
// the incident version fails closed (BED_CONTRACT_DRIFT) instead of producing silently mislabelled data.
//   BED_DERIVED[port](beds) -> { options?: {name: description | null}, bedVersion? }   what the bed says now
//   checkBedDerived(contracts, beds, ports) -> [error strings]
// A null description means the bed names the option but not its text (the contract authored it).

const optionsOf = (names, describe = () => null) => Object.fromEntries(names.map(n => [n, describe(n)]));

export const BED_DERIVED = Object.freeze({
  R5: async beds => { const { COUNTRY_NAME } = await beds.import('beds/records/pools.mjs'); return { options: { ...COUNTRY_NAME } }; },
  I1: async beds => { const cat = await beds.import('beds/incident/catalog.mjs'); return { options: optionsOf(cat.FAULT_CLASSES, k => cat.CLASS_SUMMARY[k]) }; },
  I2: async beds => { const gen = await beds.import('beds/incident/gen.mjs'); return { bedVersion: gen.VERSION }; },
  S5: async beds => { const { TYPE_LABELS } = await beds.import('beds/synth/catalog.mjs'); return { options: Object.fromEntries(Object.entries(TYPE_LABELS).map(([k, v]) => [k, v.plain])) }; },
  K3: async beds => { const { RATE_FACTOR } = await beds.import('beds/kinetics/render.mjs'); return { options: optionsOf([...Object.keys(RATE_FACTOR), 'mAU/min']) }; },
  Q5: async beds => {
    const bugs = await beds.import('beds/gameqa/bugs.mjs'), text = await beds.import('beds/gameqa/text.mjs');
    return { options: optionsOf(bugs.BUG_CLASSES, k => text.CLASS_DEFS[k]) };
  },
});

export async function checkBedDerived(contracts, beds, ports = Object.keys(BED_DERIVED)) {
  const errors = [];
  for (const port of ports) {
    const probe = BED_DERIVED[port], c = contracts[port];
    if (!probe || !c) continue;
    let now;
    try { now = await probe(beds); } catch (e) { errors.push(`${port}: cannot read the bed constants from the frozen copy (${e.message})`); continue; }
    if (now.options) {
      const want = Object.keys(now.options), have = Object.keys(c.options ?? {});
      if (JSON.stringify(want) !== JSON.stringify(have)) errors.push(`${port}: options ${JSON.stringify(have)} != the bed's ${JSON.stringify(want)}`);
      else for (const k of want) if (now.options[k] !== null && now.options[k] !== c.options[k]) errors.push(`${port}: option ${k} is described ${JSON.stringify(c.options[k])}, the bed says ${JSON.stringify(now.options[k])}`);
    }
    if (now.bedVersion !== undefined && now.bedVersion !== c.labelMap?.bedVersion) {
      errors.push(`${port}: the tag table is pinned to bed version ${c.labelMap?.bedVersion}, the frozen bed is ${now.bedVersion} (re-measure the tag inventory, then re-pin)`);
    }
  }
  return errors;
}
