// Mock Google Sheets append for the audit log. The sheet already has the author's header; a row is an object keyed by column name.
//   appendRow {row} | appendRows {rows}  -> 200 {updates:{updatedRows, updatedRange}}   400 unknown column / not an object   503 injected transient failure
// Faults: fail503 = indexes of append calls (0-based, either operation) that fail without writing anything.
import { ok, fail, isObj } from './common.mjs';
import { SHEET_COLUMNS } from '../spec.mjs';
export class Sheets {
  constructor({ faults = {} }) { this.opts = { faults }; this.state = { rows: [], calls: 0 }; }
  #append(rows) {
    const idx = this.state.calls++;
    if ((this.opts.faults.fail503 ?? []).includes(idx)) return fail(503, 'SERVICE_UNAVAILABLE', 'The service is currently unavailable.');
    if (!Array.isArray(rows) || !rows.length || rows.length > 100) return fail(400, 'BAD_REQUEST', 'rows must be a list of 1..100 rows');
    for (const r of rows) {
      if (!isObj(r)) return fail(400, 'BAD_REQUEST', 'a row is an object keyed by column name');
      const bad = Object.keys(r).filter(k => !SHEET_COLUMNS.includes(k));
      if (bad.length) return fail(400, 'UNKNOWN_COLUMN', `unknown column(s): ${bad.join(', ')}`);
    }
    const first = this.state.rows.length + 2;
    for (const r of rows) this.state.rows.push(Object.fromEntries(SHEET_COLUMNS.map(c => [c, r[c] === undefined || r[c] === null ? '' : String(r[c])])));
    return ok(200, { updates: { updatedRows: rows.length, updatedRange: `Triage!A${first}:Z${first + rows.length - 1}` } });
  }
  appendRow({ row } = {}) { return this.#append([row]); }
  appendRows({ rows } = {}) { return this.#append(rows); }
}
