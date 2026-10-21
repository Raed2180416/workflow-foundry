// Where the person's rows go. Two targets:
//   practice  returned to the caller only, for a test of the exact version on the person's own list (FoundryApp.dryRun sheets);
//   live      written to <workspace>/world/sheets/<sheet>.json, the file the live stand-ins read. The previous file, if any, is kept in
//             <workspace>/world/sheets/.history/ first. Writes are atomic (temp file + rename) and private (0600 in a 0700 folder).
// Only the mapped columns are kept (the drop page says so); nothing else from the file is stored.
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, lstatSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { FoundryError } from '../../src/data.mjs';
import { convert, inputSheets, sheetSpec } from './csv.mjs';

const SHEET = /^[a-z][a-z0-9-]{0,40}$/;
function sheetsDir(app) {
  const dir = path.join(app.worldDir, 'sheets');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (lstatSync(dir).isSymbolicLink()) throw new FoundryError('WORLD_PATH', 'The sheets folder must not be a symlink');
  return dir;
}
const fileOf = (app, sheet) => { if (!SHEET.test(sheet ?? '')) throw new FoundryError('SHEET_NAME', 'A sheet name is lowercase letters, digits and dashes'); return path.join(sheetsDir(app), `${sheet}.json`); };

/** Write rows as the live sheet, keeping the previous version. Returns { sheet, rows, replaced, backup }. */
export function writeLiveSheet(app, sheet, rows, { now = Date.now } = {}) {
  if (!Array.isArray(rows) || !rows.every(r => r && typeof r === 'object' && !Array.isArray(r))) throw new FoundryError('SHEET_SHAPE', 'Rows must be a list of objects');
  const file = fileOf(app, sheet);
  let backup = null;
  if (existsSync(file)) {
    const hist = path.join(path.dirname(file), '.history');
    mkdirSync(hist, { recursive: true, mode: 0o700 });
    backup = path.join(hist, `${sheet}.${new Date(now()).toISOString().replace(/[:.]/g, '-')}.json`);
    copyFileSync(file, backup);
  }
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(rows, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
  return { sheet, rows: rows.length, replaced: !!backup, backup: backup ? path.basename(backup) : null };
}

/** The live sheets a template reads, and how many rows each has (null: not given yet). */
export function liveSheets(app, template) {
  return Object.fromEntries(inputSheets(template).map(sheet => {
    const file = fileOf(app, sheet);
    if (!existsSync(file)) return [sheet, null];
    try { const rows = JSON.parse(readFileSync(file, 'utf8')); return [sheet, { rows: Array.isArray(rows) ? rows.length : 0, updatedAt: statSync(file).mtime.toISOString() }]; }
    catch { return [sheet, { rows: 0, unreadable: true }]; }
  }));
}

/** Convert a dropped file and store it: target 'practice' returns the rows; 'live' writes the sheet. */
export function commit(app, { template, sheet, text, mapping, answers = {}, target }) {
  if (!['practice', 'live'].includes(target)) throw new FoundryError('DATA_TARGET', 'target is practice or live');
  sheetSpec(template, sheet);
  const converted = convert({ template, sheet, text, mapping, answers });
  if (!converted.rows.length) throw new FoundryError('CSV_EMPTY', 'No usable rows were left after reading the file');
  const out = { sheet, rows: converted.rows.length, kept: converted.kept, dropped: converted.dropped, skipped: converted.skipped, problems: converted.problems };
  if (target === 'practice') return { ...out, target, data: converted.rows };
  return { ...out, target, ...writeLiveSheet(app, sheet, converted.rows) };
}

/** Earlier versions of a live sheet (newest first), for "replace file" undo. */
export function history(app, sheet) {
  const hist = path.join(sheetsDir(app), '.history');
  if (!existsSync(hist)) return [];
  return readdirSync(hist).filter(f => f.startsWith(`${sheet}.`) && f.endsWith('.json')).sort().reverse();
}
