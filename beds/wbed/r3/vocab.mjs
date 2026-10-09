// Vocabulary of W-bed R3 "statement audit": reason codes, the statement dialects (one per billing system, reusing R1's
// date styles and amount formats through lib/dialects.mjs), and the prose of supplier cover notes and our AP clerk's
// notes. Reason codes are decided from prose: a price change, a currency conversion, or an agreed credit is only a
// reason when a note says so for that document.
import { fmtDate, fmtAmount, minorDigits, isoDay } from '../lib/domain.mjs';
import { BASE_STYLE, amountIn, numberIn } from '../lib/dialects.mjs';

export const REASONS = ['TIMING', 'PRICE', 'FX', 'DUPLICATE', 'MISSING_CREDIT', 'UNEXPLAINED'];
/** Differences we post now (they change our ledger); the others are left to clear or to query. */
export const ACCEPTED = new Set(['PRICE', 'FX', 'MISSING_CREDIT']);
export const CR_SYSTEMS = ['BRIGHTDESK', 'ATLAS', 'TALLY'];

const TYPE_WORDS = {
  BRIGHTDESK: { INV: 'INVOICE', CRN: 'CREDIT', PMT: 'PAYMENT', BF: 'BALANCE B/F' },
  LEDGR: { INV: 'Rechnung', CRN: 'Gutschrift', PMT: 'Zahlung', BF: 'Saldovortrag' },
  ATLAS: { INV: 'INV', CRN: 'CRN', PMT: 'RCPT', BF: 'B/FWD' },
  VERITAS: { INV: 'invoice', CRN: 'credit', PMT: 'payment', BF: 'opening' },
  TALLY: { INV: 'inv', CRN: 'crn', PMT: 'pmt', BF: 'bf' },
  KOBO: { INV: '請求', CRN: '返品', PMT: '入金', BF: '繰越' },
};
export const dateStyleOf = (system, atlasOrder) => (system === 'ATLAS' ? atlasOrder : system === 'VENDEX' ? 'WORDS_DMY' : BASE_STYLE[system]);

/** One statement line. `amount` is signed from the supplier's view (what we owe it): invoices +, credits and payments -. */
export function statementLine(st, line, balance, rr) {
  const { system, currency, cr, dateStyle } = st;
  const date = fmtDate(line.day, dateStyle);
  const abs = Math.abs(line.amount), neg = line.amount < 0;
  const T = TYPE_WORDS[system];
  const signed = () => (cr && neg ? `${amountIn(system, currency, abs, rr)} CR` : `${neg ? '-' : ''}${amountIn(system, currency, abs, rr)}`);
  const bal = numberIn(system, currency, balance);
  switch (system) {
    case 'BRIGHTDESK': {
      const a = cr && neg ? `"${fmtAmount(abs, minorDigits(currency))} CR"` : `"${neg ? '-' : ''}${fmtAmount(abs, minorDigits(currency))}"`;
      return `${date},${T[line.type]},${line.ref},${a},"${bal}"`;
    }
    case 'LEDGR': return `${date};${T[line.type]};${line.ref};${neg ? '-' : ''}${numberIn('LEDGR', currency, abs)};${bal}`;
    case 'ATLAS': return `${date}  ${T[line.type].padEnd(5)} ${line.ref.padEnd(12)} ${signed().padStart(16)}  bal ${currency} ${bal}`;
    case 'VERITAS': return `{"date":"${date}","doc":"${line.ref}","type":"${T[line.type]}","amount":"${neg ? '-' : ''}${numberIn('VERITAS', currency, abs)}","balance":"${bal}"}`;
    case 'TALLY': return `TALLY ${date} ${T[line.type]} ${line.ref} amt=${signed()} bal=${currency} ${bal}`;
    case 'KOBO': return `${date} | ${T[line.type]} | ${line.ref} | ${neg ? '-' : ''}${amountIn('KOBO', currency, abs, rr)} | 残高 ${bal}`;
    case 'VENDEX': {
      const a = `${currency} ${fmtAmount(abs, minorDigits(currency))}`, b = `balance ${currency} ${bal}`;
      if (line.type === 'BF') return `Brought forward on ${date}: ${b}.`;
      if (line.type === 'INV') return `On ${date} we invoiced ${line.ref} for ${a}; ${b}.`;
      if (line.type === 'CRN') return `On ${date} we credited ${line.ref} for ${a}; ${b}.`;
      return `On ${date} we received your payment ${line.ref} of ${a}; ${b}.`;
    }
    default: throw new Error(`unknown statement system ${system}`);
  }
}

export function statementHeader(st) {
  const { system } = st;
  const head = {
    BRIGHTDESK: 'date,type,reference,amount,balance',
    LEDGR: 'Datum;Art;Beleg;Betrag;Saldo',
    ATLAS: null, VERITAS: null, TALLY: null, KOBO: '日付 | 区分 | 伝票 | 金額 | 残高', VENDEX: null,
  }[system];
  return head;
}

// How each system's statement is read (stated in the audit notes, the way R1's ledger notes state invoice formats).
export const SYSTEM_NOTE = {
  BRIGHTDESK: 'BRIGHTDESK statements are CSV (date,type,reference,amount,balance) with US dates (MM/DD/YYYY) and amounts in quotes; types INVOICE, CREDIT, PAYMENT, BALANCE B/F.',
  LEDGR: 'LEDGR statements are semicolon-separated (Datum;Art;Beleg;Betrag;Saldo) with dates DD.MM.YYYY and German numbers ("." groups thousands, "," is the decimal separator); Art is Rechnung (invoice), Gutschrift (credit note), Zahlung (payment received) or Saldovortrag (balance brought forward).',
  ATLAS: null, // per task: the date order
  VERITAS: 'VERITAS statements are JSON lines with ISO dates; type invoice, credit, payment or opening.',
  TALLY: 'TALLY statements print dates DD-MM-YY (20YY); types inv, crn, pmt, bf.',
  KOBO: 'KOBO statements print dates YYYY/MM/DD and amounts in yen; 区分 is 請求 (invoice), 返品 (credit note for returned goods), 入金 (payment received) or 繰越 (balance brought forward).',
  VENDEX: 'VENDEX statements are written as sentences, one per document, with dates in words.',
};
export const atlasNote = order => `ATLAS statements print dates ${order === 'DMY' ? 'day first (DD/MM/YYYY)' : 'month first (MM/DD/YYYY)'}; types INV, CRN, RCPT (payment received), B/FWD.`;

// ---------------------------------------------------------------------------------------------------------------------
// Notes. Each explanation names the document it explains; noise sentences name other documents without explaining a
// difference, so "the note mentions this document" is not the rule: the note must explain the difference.
export const EXPLAIN = {
  PRICE: {
    memo: [x => `Invoice ${x.ref} was re-issued at the revised unit price agreed with your buyer in ${x.month}.`,
      x => `Please note the corrected price on ${x.ref}: the ${x.item} were re-priced after your buyer accepted our new rate card.`],
    ap: [x => `${x.vendor}: buyer confirmed the price increase on ${x.ref} (${x.item}); our bill was posted at the old price.`,
      x => `${x.vendor}: ${x.ref} posted at the original quote; the agreed new unit price applies.`],
  },
  FX: {
    memo: [x => `Your transfer ${x.ref} was sent in US dollars and credited to your account as ${x.amount} after our bank's conversion.`],
    ap: [x => `${x.vendor}: ${x.ref} was paid from our US-dollar account and booked in ${x.currency} at our own rate.`,
      x => `${x.vendor}: payment ${x.ref} went out in USD; the supplier's bank converted it on receipt.`],
  },
  MISSING_CREDIT: {
    memo: [x => `Our credit note ${x.ref} for the ${x.qty} returned ${x.item} is included on this statement.`],
    ap: [x => `${x.vendor}: agreed with ${x.contact} on ${x.date} a credit of ${x.amount} for ${x.qty} returned ${x.item}; the credit note has not reached us yet.`,
      x => `${x.vendor}: allowance of ${x.amount} for the damaged ${x.item} agreed by phone; expect a credit note.`],
  },
};
export const NOISE = {
  memo: [x => `Invoice ${x.ref} was delivered to your ${x.city} site.`, x => `Thank you for your payment ${x.pay}.`,
    () => 'Please quote our customer number with every payment.', () => 'Our offices close for the bank holiday on Monday.',
    x => `Questions about ${x.ref}? Call our accounts desk.`],
  ap: [x => `${x.vendor}: remind them about the new delivery address.`, x => `${x.vendor}: ${x.ref} approved by the warehouse.`,
    x => `${x.vendor}: price list for next year expected in ${x.month}.`],
};
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export { isoDay };
