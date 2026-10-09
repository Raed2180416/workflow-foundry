// Vocabulary of W-bed R4 "group consolidation": intercompany charge kinds with the seller's and the buyer's wording,
// period renderings, and the house styles of the subsidiaries' intercompany schedules. Shared by world.mjs and
// render.mjs. Every name is fictional.
import { fmtAmount, minorDigits } from '../lib/domain.mjs';
import { MONTHS } from '../lib/domain.mjs';

// Intercompany charge kinds. `period`: what one charge covers. `fixed`: a flat recurring fee (the same amount every
// period: the sibling decoys use these). Seller phrases go on the receivable, buyer phrases on the payable; {cp} is the
// counterparty's short name. The two sides never share a phrase, so pairing reads meaning, not string equality.
export const IC_KINDS = {
  it: { period: 'quarter', fixed: false,
    seller: ['Recharge of IT support', 'IT services recharge', 'Group IT platform recharge'],
    buyer: ['IT support charged by {cp}', 'IT services from {cp}', 'Share of the group IT platform, billed by {cp}'] },
  mgmt: { period: 'month', fixed: true,
    seller: ['Management fee', 'Management services fee'],
    buyer: ['Group management charge from {cp}', 'Management services, {cp}'] },
  rent: { period: 'month', fixed: true,
    seller: ['Office rent recharge', 'Recharge of shared office rent'],
    buyer: ['Rent for shared offices, recharged by {cp}', 'Office space charge from {cp}'] },
  royalty: { period: 'quarter', fixed: false,
    seller: ['Brand licence royalty', 'Trademark royalty'],
    buyer: ['Royalty for use of the group brand, {cp}', 'Brand licence fee owed to {cp}'] },
  goods: { period: 'month', fixed: false,
    seller: ['Stock transfer to {cp}', 'Sale of goods to {cp}'],
    buyer: ['Goods received from {cp}', 'Inventory transferred in from {cp}'] },
  interest: { period: 'quarter', fixed: false,
    seller: ['Interest on intercompany loan to {cp}', 'Loan interest receivable'],
    buyer: ['Interest on loan from {cp}', 'Intercompany loan interest payable'] },
  insurance: { period: 'quarter', fixed: true,
    seller: ['Recharge of group insurance premium', 'Insurance premium share'],
    buyer: ['Share of group insurance cover, recharged by {cp}', 'Group insurance recharge'] },
};
export const KIND_IDS = Object.keys(IC_KINDS);

const MON3 = MONTHS.map(m => m.slice(0, 3));
const ORD = ['1st', '2nd', '3rd', '4th'];
const ORDW = ['first', 'second', 'third', 'fourth'];
const QMONTHS = q => `${MONTHS[3 * q - 3]}-${MONTHS[3 * q - 1]}`;
const QMON3 = q => `${MON3[3 * q - 3]}-${MON3[3 * q - 1]}`;
/** A period is { kind: 'month', m } or { kind: 'quarter', q }, always in 2025. */
export const periodKey = p => (p.kind === 'month' ? `M${p.m}` : `Q${p.q}`);
export const prevPeriod = p => (p.kind === 'month' ? (p.m > 1 ? { kind: 'month', m: p.m - 1 } : null) : (p.q > 1 ? { kind: 'quarter', q: p.q - 1 } : null));
export function sellerPeriod(p, rr) {
  if (p.kind === 'month') return rr.pick([`${MONTHS[p.m - 1]} 2025`, `${String(p.m).padStart(2, '0')}/2025`, `${MON3[p.m - 1]} 2025`]);
  return rr.pick([`Q${p.q} 2025`, `${ORD[p.q - 1]} quarter 2025`]);
}
export function buyerPeriod(p, rr) {
  if (p.kind === 'month') return rr.pick([`for ${MONTHS[p.m - 1]}`, `${MON3[p.m - 1]}-25`, `month of ${MONTHS[p.m - 1]} 2025`, `2025-${String(p.m).padStart(2, '0')}`]);
  return rr.pick([`${QMONTHS(p.q)} 2025`, `${QMON3(p.q)} 25`, `Q${p.q}/25`, `${ORDW[p.q - 1]} quarter`]);
}

// House styles of the intercompany schedules: legal form, book currency, side words and amount format.
export const STYLES = {
  CSV: { legal: 'Inc.', book: 'USD', side: { R: 'due from', P: 'due to' } },
  UK: { legal: 'Ltd', book: 'GBP', side: { R: 'due from', P: 'due to' } },
  DE: { legal: 'GmbH', book: 'EUR', side: { R: 'Forderung', P: 'Verbindlichkeit' } },
  JSON: { legal: 'B.V.', book: 'EUR', side: { R: 'receivable', P: 'payable' } },
  CH: { legal: 'AG', book: 'CHF', side: { R: 'Guthaben', P: 'Schuld' } },
  JP: { legal: 'KK', book: 'JPY', side: { R: '債権', P: '債務' } },
};

/** An amount (minor units) as a schedule in `style` prints it, currency included. */
export function amountInStyle(style, currency, minor, rr) {
  const md = minorDigits(currency);
  switch (style) {
    case 'CSV': return `"${fmtAmount(minor, md)}"`;
    case 'DE': return `${fmtAmount(minor, md, { thou: '.', dec: ',' })} ${currency}`;
    case 'JSON': return fmtAmount(minor, md, { group: false });
    case 'CH': return `${currency} ${fmtAmount(minor, md, { thou: "'" })}`;
    case 'JP': return currency === 'JPY' ? (rr.chance(0.5) ? `¥${fmtAmount(minor, md)}` : `${fmtAmount(minor, md)}円`) : `${currency} ${fmtAmount(minor, md)}`;
    default: return `${currency} ${fmtAmount(minor, md)}`;
  }
}

export const PACKS = { 'wbed-r1': 'receivables-close', 'wbed-r3': 'statement-audit' };
