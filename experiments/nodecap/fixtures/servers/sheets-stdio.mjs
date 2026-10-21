#!/usr/bin/env node
// Fixture spreadsheet (stdio): read_range and append_row (non-idempotent). The ledger is the oracle (rows exact, no duplicates).
import { argv, fixtureServer, ok, record, serveStdio } from './lib.mjs';

const rows = [['ticket', 'title'], ['42', 'Refund for order 7731']];
const str = (max = 200) => ({ type: 'string', maxLength: max });
const tools = () => [
  { name: 'read_range', description: 'Read all rows of the sheet.', inputSchema: { type: 'object', additionalProperties: false, properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'append_row', description: 'Append one row to the sheet.', inputSchema: { type: 'object', additionalProperties: false, required: ['cells'], properties: { cells: { type: 'array', maxItems: 10, items: str() } } },
    annotations: { readOnlyHint: false, destructiveHint: false } }
];
const handlers = {
  read_range: () => ok({ rows }),
  append_row: ({ cells }) => { rows.push(cells); record(argv('ledger'), { appended: cells }); return ok({ rows: rows.length }); }
};
await serveStdio(fixtureServer({ name: 'fixture-sheets', tools, handlers }));
