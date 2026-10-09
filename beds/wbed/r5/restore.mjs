// From decoded rows back to the pack's R1 inputs: the step between the agent node and flow.call(R1_REF_HASH, ...) in
// the reference outline. Each row becomes one line of its billing system's invoice list, in the line format the pack's
// ledger notes document (R1 render.mjs). Where R1 chooses a surface form at random (KOBO "¥" or "円", VENDEX's two
// sentence shapes) the restore uses the first; the facts on every line are the row's, so the R1 answer is unchanged.
import { amountIn } from '../lib/dialects.mjs';
import { normRow } from '../lib/legacy.mjs';

const FIRST = { chance: () => true }; // amountIn's random choice, fixed to its first branch
const LINE = {
  BRIGHTDESK: (x, a) => `${x.invoice},${x.row},${x.date_text},${a},${x.status_text}`,
  LEDGR: (x, a) => `${x.invoice};${x.row};${x.date_text};${a};${x.status_text}`,
  ATLAS: (x, a) => `INV ${x.invoice} :: acct #${x.row} :: dated ${x.date_text} :: ${a} :: ${x.status_text}`,
  VENDEX: (x, a) => `Invoice ${x.invoice} raised against Vendex entry ${x.row} on ${x.date_text} for ${a} — ${x.status_text}.`,
  KOBO: (x, a) => `KOBO-INV/${x.invoice} member ${x.row} | ${x.date_text} | ${a} | ${x.status_text}`,
  VERITAS: (x, a) => `{"invoice":"${x.invoice}","row":${x.row},"issued":"${x.date_text}","amount":"${a}","ccy":"${x.currency}","state":"${x.status_text}"}`,
  TALLY: (x, a) => `TALLY ${x.invoice} cust=${x.row} date=${x.date_text} amt=${a} st=${x.status_text}`,
};
const HEADER = { BRIGHTDESK: 'invoice_no,account_row,invoice_date,amount_usd,status', LEDGR: 'Rechnung;Satz-Nr;Rechnungsdatum;Betrag;Status' };

/** { system: invoice-list text } for the rows (systems in first-appearance order, rows in their order). */
export function invoiceListsOf(rows) {
  const out = {};
  for (const x of rows.map(normRow)) {
    if (!LINE[x.system]) continue;
    out[x.system] ??= HEADER[x.system] ? [HEADER[x.system]] : [];
    out[x.system].push(LINE[x.system](x, amountIn(x.system, x.currency, x.amount_minor, FIRST)));
  }
  return Object.fromEntries(Object.entries(out).map(([s, l]) => [s, l.join('\n')]));
}

/** The R1 inputs of the dump pack, rebuilt from decoded rows (key order as R1's generate writes them). */
export function restoreInputsOf(packInputs, rows) {
  const { customer_export, customer_notes, customer_spec, payments, ledger_notes, ledger_spec } = packInputs;
  return { customer_export, customer_notes, customer_spec, invoices: invoiceListsOf(rows), payments, ledger_notes, ledger_spec };
}
