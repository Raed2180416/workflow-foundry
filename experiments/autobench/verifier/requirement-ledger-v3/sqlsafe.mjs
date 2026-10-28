// requirement-ledger-v3 (Δ* v1): the sandboxed evaluator for reader-written predicates and SELECTs.
//
// The reader writes SQL; CODE builds the tables (from the inventory or the world, never from the reader), runs the SQL,
// and owns every value that comes back. The SQL is untrusted data. Defences, each tested in rl3.test.mjs:
//   1. a static check: exactly one statement, which starts with SELECT or WITH, under a length cap (node:sqlite's prepare
//      silently compiles only the first statement of "SELECT 1; DROP TABLE t", so a trailing statement is refused here
//      rather than ignored);
//   2. SQLite limits on the connection: no attached databases, short strings, shallow expressions, few compound terms;
//   3. setAuthorizer, deny by default, installed after the tables are loaded: SELECT, READ of the loaded tables, RECURSIVE
//      and the functions of FUNCTIONS below; everything else (ATTACH, PRAGMA, INSERT, UPDATE, DELETE, CREATE, DROP,
//      TRANSACTION, any other function such as randomblob, zeroblob, load_extension, printf) is refused. The skeptic's
//      probe (ATTACK §6 Move 1) showed `PRAGMA query_only` alone is insufficient: ATTACH wrote a file and randomblob(1e8)
//      allocated 100 MB;
//   4. a separate worker PROCESS with a hard kill timeout. A worker thread is not enough: Worker.terminate() cannot
//      interrupt a native SQLite step (an unbounded recursive CTE never returns to JavaScript), so the evaluator runs in a
//      child node process that receives SIGKILL at the deadline, with a small V8 heap and an empty environment;
//   5. caps on returned rows and on the size of the reply.
// Generic by construction (PREREG-AB-v1 H7/H8): nothing here names a task, a grader check or a hidden assertion.
import { spawnSync } from 'node:child_process';
import { DatabaseSync, constants as C } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export const SQL_VERSION = 'rl3-sql-v1';
const SELF = fileURLToPath(import.meta.url);

/** Functions a reader's SQL may call (lower case). Aggregates, dates, text and arithmetic only; no randomness, no blobs,
 *  no formatting with unbounded width, no extension or file access. LIKE and GLOB operators call like/glob. */
export const FUNCTIONS = Object.freeze(new Set([
  'abs', 'avg', 'ceil', 'ceiling', 'coalesce', 'count', 'date', 'datetime', 'floor', 'glob', 'group_concat', 'ifnull', 'iif',
  'instr', 'julianday', 'length', 'like', 'lower', 'ltrim', 'max', 'min', 'nullif', 'replace', 'round', 'rtrim', 'sign',
  'strftime', 'string_agg', 'substr', 'substring', 'sum', 'time', 'total', 'trim', 'typeof', 'unixepoch', 'upper',
]));

export const LIMITS = Object.freeze({ length: 200_000, sqlLength: 20_000, column: 200, exprDepth: 100, compoundSelect: 20, attach: 0, functionArg: 8, likePatternLength: 200, variableNumber: 32, triggerDepth: 1 });
export const DEFAULTS = Object.freeze({ timeoutMs: 3000, maxRows: 2000, heapMb: 48 });

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/** Static check of one reader statement: {ok, reason}. Strings, quoted identifiers and comments are masked first, so a
 *  semicolon inside a literal is not a second statement. */
export function checkSqlText(sql, { maxLength = LIMITS.sqlLength } = {}) {
  if (typeof sql !== 'string' || !sql.trim()) return { ok: false, reason: 'empty' };
  if (sql.length > maxLength) return { ok: false, reason: 'too long' };
  let masked = '';
  for (let i = 0; i < sql.length;) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      for (; j < sql.length; j++) { if (sql[j] === close) { if (close !== ']' && sql[j + 1] === close) { j++; continue; } break; } }
      if (j >= sql.length) return { ok: false, reason: 'unterminated quote' };
      masked += ' '.repeat(j - i + 1); i = j + 1; continue;
    }
    if (c === '-' && sql[i + 1] === '-') { const j = sql.indexOf('\n', i); const end = j < 0 ? sql.length : j; masked += ' '.repeat(end - i); i = end; continue; }
    if (c === '/' && sql[i + 1] === '*') { const j = sql.indexOf('*/', i + 2); if (j < 0) return { ok: false, reason: 'unterminated comment' }; masked += ' '.repeat(j + 2 - i); i = j + 2; continue; }
    masked += c; i++;
  }
  const body = masked.trim().replace(/;\s*$/, '');
  if (body.includes(';')) return { ok: false, reason: 'more than one statement' };
  if (!/^(select|with)\b/i.test(body)) return { ok: false, reason: 'not a SELECT' };
  return { ok: true, reason: null };
}

/** A table spec for the evaluator: {name, columns: [{name, type: 'num'|'text'}], rows: [[...]]}. Names are checked. */
function checkTables(tables) {
  if (!Array.isArray(tables)) throw new Error('tables must be an array');
  for (const t of tables) {
    if (!IDENT.test(t.name)) throw new Error(`bad table name ${t.name}`);
    if (!Array.isArray(t.columns) || !t.columns.length || t.columns.length > LIMITS.column) throw new Error(`bad columns for ${t.name}`);
  }
}
const qi = s => `"${String(s).replace(/"/g, '""')}"`;

/** Run every query against freshly loaded tables in THIS process (the worker's body). `staticCheck: false` exists only so
 *  tests can show that the authorizer alone also refuses what the static check refuses (defence in depth). */
export function evaluateInProcess({ tables, queries, maxRows = DEFAULTS.maxRows, staticCheck = true }) {
  checkTables(tables);
  const db = new DatabaseSync(':memory:', { limits: { ...LIMITS } });
  try { db.enableDefensive(true); } catch { /* older builds */ }
  const loaded = new Set();
  for (const t of tables) {
    db.exec(`CREATE TABLE ${qi(t.name)} (${t.columns.map(c => `${qi(c.name)} ${c.type === 'num' ? 'REAL' : 'TEXT'}`).join(', ')})`);
    const ins = db.prepare(`INSERT INTO ${qi(t.name)} VALUES (${t.columns.map(() => '?').join(', ')})`);
    for (const r of t.rows) ins.run(...t.columns.map((c, i) => { const v = r[i]; return v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v; }));
    loaded.add(t.name.toLowerCase());
  }
  // Deny by default from here on (arguments: action, arg1, arg2, database, trigger/view). A READ with no database is a
  // common table expression's own rows (a recursive CTE reads itself that way); every schema object, including
  // sqlite_master and the pragma_* table-valued functions, carries a database name and must be a loaded table.
  db.setAuthorizer((action, a1, a2, dbName) => {
    if (action === C.SQLITE_SELECT || action === C.SQLITE_RECURSIVE) return C.SQLITE_OK;
    if (action === C.SQLITE_READ) return dbName === null || (dbName === 'main' && loaded.has(String(a1 ?? '').toLowerCase())) ? C.SQLITE_OK : C.SQLITE_DENY;
    if (action === C.SQLITE_FUNCTION) return FUNCTIONS.has(String(a2 ?? '').toLowerCase()) ? C.SQLITE_OK : C.SQLITE_DENY;
    return C.SQLITE_DENY;
  });
  const out = [];
  for (let k = 0; k < queries.length; k++) {
    const q = queries[k];
    const st = staticCheck ? checkSqlText(q.sql) : { ok: typeof q.sql === 'string', reason: 'not text' };
    if (!st.ok) { out.push({ ok: false, error: { code: 'SQL_REFUSED', message: st.reason } }); continue; }
    try {
      const stmt = db.prepare(q.sql);
      stmt.setAllowUnknownNamedParameters(true);   // code binds the same named parameters (:today) to every query
      const rows = [];
      let over = false;
      for (const row of stmt.iterate(q.params ?? {})) { if (rows.length >= maxRows) { over = true; break; } rows.push({ ...row }); }
      out.push(over ? { ok: false, error: { code: 'SQL_ROWS', message: `more than ${maxRows} rows` } } : { ok: true, rows, columns: stmt.columns().map(c => c.name) });
    } catch (e) {
      out.push({ ok: false, error: { code: /not authorized|prohibited/i.test(e.message) ? 'SQL_DENIED' : 'SQL_ERROR', message: String(e.message).slice(0, 200) } });
    }
  }
  db.close();
  return out;
}

/**
 * Run reader queries in a child process with a hard kill timeout.
 *   tables: [{name, columns: [{name, type}], rows}], queries: [{sql, params}] -> [{ok, rows, columns} | {ok: false, error}]
 * A batch that times out or crashes is retried one query at a time, so one runaway query cannot hide the others' results.
 */
export function runSelect({ tables, queries, timeoutMs = DEFAULTS.timeoutMs, maxRows = DEFAULTS.maxRows, heapMb = DEFAULTS.heapMb }) {
  checkTables(tables);
  if (!queries.length) return [];
  const once = qs => {
    const input = JSON.stringify({ tables, queries: qs, maxRows });
    const r = spawnSync(process.execPath, [`--max-old-space-size=${heapMb}`, '--no-warnings', SELF, '--sql-worker'], { input, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', env: {} });
    if (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGKILL') return { timeout: true };
    if (r.status !== 0) return { crash: String(r.stderr ?? '').slice(0, 300) || `exit ${r.status}` };
    try { return { results: JSON.parse(r.stdout) }; } catch { return { crash: 'unparsable worker reply' }; }
  };
  const first = once(queries);
  if (first.results) return first.results;
  if (queries.length === 1) return [{ ok: false, error: first.timeout ? { code: 'SQL_TIMEOUT', message: `no answer within ${timeoutMs} ms` } : { code: 'SQL_CRASH', message: first.crash } }];
  return queries.flatMap(q => runSelect({ tables, queries: [q], timeoutMs, maxRows, heapMb }));
}

// ---------------------------------------------------------------------------------------------------------------
// Worker entry: node sqlsafe.mjs --sql-worker  (stdin: {tables, queries, maxRows}; stdout: results JSON). The reply never
// carries anything but rows of the loaded tables and error codes.
if (process.argv[2] === '--sql-worker' && process.argv[1] && SELF === process.argv[1]) {
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    let res;
    try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); res = evaluateInProcess({ tables: j.tables, queries: j.queries, maxRows: j.maxRows }); }
    catch (e) { process.stderr.write(String(e?.message ?? e).slice(0, 300)); process.exit(2); }
    process.stdout.write(JSON.stringify(res));
  });
}
