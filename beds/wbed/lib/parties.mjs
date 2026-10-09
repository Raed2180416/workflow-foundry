// Fictional counterparties for the W-bed rungs that deal with suppliers and customers as companies (R2 inbox router,
// R3 statement audit). Person names come from the records bed's culture pools (imported unchanged); company names are
// built from the stems below. Every name is fictional; e-mail domains use the reserved `.example` TLD.
import { CULTURES } from '../../records/pools.mjs';

export const COMPANY_STEMS = ['Kestrel', 'Harrow', 'Linden', 'Bramble', 'Corvid', 'Alder', 'Marlow', 'Quarry', 'Fenwick', 'Oriel',
  'Wexford', 'Calder', 'Northgate', 'Lumen', 'Saffron', 'Juniper', 'Halcyon', 'Tern', 'Osprey', 'Rook', 'Heron', 'Larch',
  'Bracken', 'Merrow', 'Thistle', 'Ember', 'Sorrel', 'Dunmore', 'Ashcombe', 'Pellow', 'Gannet', 'Vireo', 'Cobalt', 'Wren',
  'Tamar', 'Ivel', 'Kittiwake', 'Lapwing', 'Moorhen', 'Nettle', 'Oxbow', 'Plover', 'Quill', 'Rushmere', 'Skerry', 'Teasel',
  'Umber', 'Vetch', 'Whinny', 'Yarrow', 'Zephyr', 'Brindle', 'Cresswell', 'Dovecote', 'Elmstead', 'Foxley', 'Greywell'];

// Sector -> words used in the company name and the goods/services it bills.
export const SECTORS = [
  { word: 'Freight', goods: [['pallet transport runs', 'runs'], ['courier collections', 'collections'], ['container hauls', 'hauls']] },
  { word: 'Packaging', goods: [['stretch film rolls', 'rolls'], ['corrugated cartons', 'cartons'], ['pallet wrap reels', 'reels']] },
  { word: 'Office Supply', goods: [['toner cartridges', 'cartridges'], ['copy paper boxes', 'boxes'], ['archive boxes', 'boxes']] },
  { word: 'Print', goods: [['label rolls', 'rolls'], ['printed brochures', 'brochures'], ['letterhead reams', 'reams']] },
  { word: 'Facilities', goods: [['cleaning visits', 'visits'], ['window cleaning rounds', 'rounds'], ['waste collections', 'collections']] },
  { word: 'Hardware', goods: [['barcode scanners', 'scanners'], ['USB-C docks', 'docks'], ['label printers', 'printers']] },
  { word: 'Catering', goods: [['meeting lunches', 'lunches'], ['coffee machine refills', 'refills'], ['event platters', 'platters']] },
  { word: 'Logistics', goods: [['warehouse pallet-days', 'pallet-days'], ['pick-and-pack orders', 'orders'], ['returns inspections', 'inspections']] },
];

export const LEGAL = { en: ['Ltd', 'Ltd', 'Inc.', 'LLC', 'plc'], de: ['GmbH', 'GmbH', 'AG'], fr: ['SARL', 'SAS', 'SA'], es: ['S.L.', 'S.A.'], ja: ['KK'] };
const NAME_CULTURE = { en: 'en', de: 'de', fr: 'fr', es: 'es', ja: 'ja' };

export function personName(r, lang = 'en') {
  const c = CULTURES[NAME_CULTURE[lang]] ?? CULTURES.en;
  const [given] = r.pick(c.given);
  return { given, family: r.pick(c.family) };
}
const slug = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export { slug };

/**
 * Draw `n` distinct companies. `langOf(i)` gives each company's language (default 'en').
 * Returns [{ name, stem, sector, goods, lang, domain, contact }].
 */
export function drawCompanies(r, n, { langOf = () => 'en', avoid = new Set() } = {}) {
  const out = [];
  const usedStems = new Set(avoid);
  const stems = r.shuffle(COMPANY_STEMS.filter(s => !usedStems.has(s)));
  if (stems.length < n) throw new Error(`parties: need ${n} companies, only ${stems.length} stems left`);
  for (let i = 0; i < n; i++) {
    const stem = stems[i];
    const sector = r.pick(SECTORS);
    const lang = langOf(i);
    const legal = r.pick(LEGAL[lang] ?? LEGAL.en);
    const name = `${stem} ${sector.word} ${legal}`;
    const contact = personName(r, lang);
    out.push({ name, stem, short: `${stem} ${sector.word}`, sector: sector.word, goods: sector.goods, lang, legal,
      domain: `${slug(`${stem}-${sector.word}`)}.example`, contact });
  }
  return out;
}

export const emailOf = (person, domain) => `${slug(person.given)}.${slug(person.family)}@${domain}`;
export const fullName = p => `${p.given} ${p.family}`;
