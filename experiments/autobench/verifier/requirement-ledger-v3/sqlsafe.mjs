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
//   5. caps on returned rows and on the size of the reply;
//   6. (v2, review of 2026-11-04) the host clock is unreachable: date, time, datetime, julianday, unixepoch and strftime
//      are replaced in the worker by versions that refuse 'now' (also when the string is built at run time), a call
//      with no time value, and the host-time-zone modifiers 'localtime' and 'utc'; every other argument is computed by
//      SQLite's own function on a private connection that runs no reader text. "Today" reaches SQL only as :today,
//      bound by code under the D28 clock ruling (clock.mjs);
//   7. (v2) bounded disk: SQLite spills sorts and temporary tables to files, and the worker's file-size limit
//      (ulimit -f, FILE_CAP_BLOCKS of 512 bytes) makes a spill beyond the cap fail at once with SQL_SPILL instead of
//      filling the shared disk (a measured probe: a 10,000-row DISTINCT over 4 KB strings wrote 327 MB in about 1 s).
//      In-memory temp storage is not used because this build does not enforce SQLite's heap limits (measured: 110 MB
//      resident under PRAGMA hard_heap_limit = 4 MB), so it would trade a disk risk for an unbounded memory one;
//   8. (v2) a time budget per call of runSelect: a failed batch is retried by GROUP (dstar.mjs groups every day-variant
//      of one predicate), never variant by variant, and nothing starts after the budget is spent;
//   9. (v2) every result carries the columns the statement READS (from the authorizer), so dstar.mjs can tell a rule
//      over attributes from a list of names or ids posing as a predicate.
// Generic by construction (PREREG-AB-v1 H7/H8): nothing here names a task, a grader check or a hidden assertion.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { DatabaseSync, constants as C } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export const SQL_VERSION = 'rl3-sql-v2';
const SELF = fileURLToPath(import.meta.url);

/** Functions a reader's SQL may call (lower case). Aggregates, dates, text and arithmetic only; no randomness, no blobs,
 *  no formatting with unbounded width, no extension or file access. LIKE and GLOB operators call like/glob. */
export const FUNCTIONS = Object.freeze(new Set([
  'abs', 'avg', 'ceil', 'ceiling', 'coalesce', 'count', 'date', 'datetime', 'floor', 'glob', 'group_concat', 'ifnull', 'iif',
  'instr', 'julianday', 'length', 'like', 'lower', 'ltrim', 'max', 'min', 'nullif', 'replace', 'round', 'rtrim', 'sign',
  'strftime', 'string_agg', 'substr', 'substring', 'sum', 'time', 'total', 'trim', 'typeof', 'unixepoch', 'upper',
]));

export const LIMITS = Object.freeze({ length: 200_000, sqlLength: 20_000, column: 200, exprDepth: 100, compoundSelect: 20, attach: 0, functionArg: 8, likePatternLength: 200, variableNumber: 32, triggerDepth: 1 });
export const DEFAULTS = Object.freeze({ timeoutMs: 3000, maxRows: 2000, heapMb: 48, budgetMs: 20_000, maxReplyBytes: 8 * 1024 * 1024 });
/** The worker's file-size limit in 512-byte blocks (dash and POSIX sh units): 8 MiB per worker. */
export const FILE_CAP_BLOCKS = 16_384;
const SHELL = '/bin/sh';

/** SQLite's date and time functions, each of which reads the host clock when given 'now' or no time value. */
export const CLOCK_FUNCTIONS = Object.freeze({ date: 0, time: 0, datetime: 0, julianday: 0, unixepoch: 0, strftime: 1 });
const HOST_TIME = /^\s*now\s*$/i;
const HOST_ZONE = /^\s*(localtime|utc)\s*$/i;
/** Why a call of a clock function would read the host's clock or zone, or null when it is a pure date computation. */
export function hostClockUse(name, args) {
  const at = CLOCK_FUNCTIONS[name];
  if (at === undefined) return null;
  if (args.length <= at) return 'no time value (the host clock)';
  const v = args[at];
  if (typeof v === 'string' && HOST_TIME.test(v)) return "'now' (the host clock)";
  for (const m of args.slice(at + 1)) if (typeof m === 'string' && HOST_ZONE.test(m)) return `the '${m.trim()}' modifier (the host time zone)`;
  return null;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/** The SQL text with string literals, quoted identifiers and comments blanked out (same length), or null when a quote or
 *  a comment is unterminated. */
export function maskSql(sql) {
  let masked = '';
  for (let i = 0; i < sql.length;) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      for (; j < sql.length; j++) { if (sql[j] === close) { if (close !== ']' && sql[j + 1] === close) { j++; continue; } break; } }
      if (j >= sql.length) return null;
      masked += ' '.repeat(j - i + 1); i = j + 1; continue;
    }
    if (c === '-' && sql[i + 1] === '-') { const j = sql.indexOf('\n', i); const end = j < 0 ? sql.length : j; masked += ' '.repeat(end - i); i = end; continue; }
    if (c === '/' && sql[i + 1] === '*') { const j = sql.indexOf('*/', i + 2); if (j < 0) return null; masked += ' '.repeat(j + 2 - i); i = j + 2; continue; }
    masked += c; i++;
  }
  return masked;
}

/** Static check of one reader statement: {ok, reason}. Strings, quoted identifiers and comments are masked first, so a
 *  semicolon inside a literal is not a second statement. */
export function checkSqlText(sql, { maxLength = LIMITS.sqlLength } = {}) {
  if (typeof sql !== 'string' || !sql.trim()) return { ok: false, reason: 'empty' };
  if (sql.length > maxLength) return { ok: false, reason: 'too long' };
  const masked = maskSql(sql);
  if (masked === null) return { ok: false, reason: /\/\*/.test(sql) && !/\*\//.test(sql) ? 'unterminated comment' : 'unterminated quote' };
  const body = masked.trim().replace(/;\s*$/, '');
  if (body.includes(';')) return { ok: false, reason: 'more than one statement' };
  if (!/^(select|with)\b/i.test(body)) return { ok: false, reason: 'not a SELECT' };
  return { ok: true, reason: null };
}

/** Static check of a reader PREDICATE (the boolean expression of a selection, evaluated by code once per member):
 *  balanced parentheses that never close more than they open, and no statement keyword outside parentheses, so the text
 *  cannot end the expression and append its own query (a UNION of hand-picked ids, a second SELECT). A subquery inside
 *  parentheses stays possible ("Amount" > (SELECT avg(...) ...)). */
export function checkPredicateText(where, { maxLength = LIMITS.sqlLength } = {}) {
  if (typeof where !== 'string' || !where.trim()) return { ok: false, reason: 'empty predicate' };
  if (where.length > maxLength) return { ok: false, reason: 'too long' };
  const masked = maskSql(where);
  if (masked === null) return { ok: false, reason: 'unterminated quote or comment' };
  let depth = 0, top = '';
  for (const c of masked) {
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth < 0) return { ok: false, reason: 'a parenthesis closes the predicate' }; }
    else if (depth === 0) top += c;
  }
  if (depth !== 0) return { ok: false, reason: 'unbalanced parentheses' };
  if (masked.includes(';')) return { ok: false, reason: 'a statement separator' };
  const kw = /\b(select|union|intersect|except|from|where|group|having|order|limit|offset|window|values|returning|insert|update|delete|attach|pragma)\b/i.exec(top);
  if (kw) return { ok: false, reason: `the keyword ${kw[1].toUpperCase()} outside parentheses` };
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
  db.exec('PRAGMA temp_store = FILE');   // spills go to files, which the worker's file-size limit caps (header, 7)
  // the clock functions without the host clock (header, 6): SQLite's own implementation on a private connection
  const pure = new DatabaseSync(':memory:');
  const stmts = new Map();
  for (const name of Object.keys(CLOCK_FUNCTIONS)) {
    db.function(name, { varargs: true, deterministic: true }, (...args) => {
      const why = hostClockUse(name, args);
      if (why) throw new Error(`${name}() with ${why} is refused: today is the bound parameter :today`);
      const k = `${name}/${args.length}`;
      if (!stmts.has(k)) stmts.set(k, pure.prepare(`SELECT ${name}(${args.map(() => '?').join(', ')}) AS v`));
      return stmts.get(k).get(...args).v;
    });
  }
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
  let reads = null;   // the columns the statement being prepared reads (table.column), for the caller's list check
  db.setAuthorizer((action, a1, a2, dbName) => {
    if (action === C.SQLITE_SELECT || action === C.SQLITE_RECURSIVE) return C.SQLITE_OK;
    if (action === C.SQLITE_READ) {
      const ok = dbName === null || (dbName === 'main' && loaded.has(String(a1 ?? '').toLowerCase()));
      if (ok && reads && dbName === 'main') reads.add(`${a1}.${a2}`);
      return ok ? C.SQLITE_OK : C.SQLITE_DENY;
    }
    if (action === C.SQLITE_FUNCTION) return FUNCTIONS.has(String(a2 ?? '').toLowerCase()) ? C.SQLITE_OK : C.SQLITE_DENY;
    return C.SQLITE_DENY;
  });
  const out = [];
  for (let k = 0; k < queries.length; k++) {
    const q = queries[k];
    const st = staticCheck ? checkSqlText(q.sql) : { ok: typeof q.sql === 'string', reason: 'not text' };
    if (!st.ok) { out.push({ ok: false, error: { code: 'SQL_REFUSED', message: st.reason } }); continue; }
    try {
      // q.trace (optional): a second statement, prepared and never run, whose reads are reported instead (dstar.mjs
      // traces a predicate without the _mid column its own wrapper projects)
      const traced = new Set();
      if (q.trace !== undefined) {
        const tc = staticCheck ? checkSqlText(q.trace) : { ok: true };
        if (!tc.ok) { out.push({ ok: false, error: { code: 'SQL_REFUSED', message: tc.reason } }); continue; }
        reads = traced; db.prepare(q.trace); reads = null;
      } else reads = traced;
      const stmt = db.prepare(q.sql);
      reads = null;
      const readCols = [...traced].sort();
      stmt.setAllowUnknownNamedParameters(true);   // code binds the same named parameters (:today) to every query
      const rows = [];
      let over = false;
      for (const row of stmt.iterate(q.params ?? {})) { if (rows.length >= maxRows) { over = true; break; } rows.push({ ...row }); }
      out.push(over ? { ok: false, error: { code: 'SQL_ROWS', message: `more than ${maxRows} rows` } } : { ok: true, rows, columns: stmt.columns().map(c => c.name), reads: readCols });
    } catch (e) {
      reads = null;
      const m = String(e?.message ?? e);
      out.push({ ok: false, error: { code: /not authorized|prohibited/i.test(m) ? 'SQL_DENIED' : /disk I\/O error|database or disk is full/i.test(m) ? 'SQL_SPILL' : /host clock|host time zone/.test(m) ? 'SQL_CLOCK' : 'SQL_ERROR', message: m.slice(0, 200) } });
    }
  }
  db.close();
  pure.close();
  return out;
}

/**
 * Run reader queries in a child process with a hard kill timeout, a file-size cap and a time budget.
 *   tables: [{name, columns: [{name, type}], rows}], queries: [{sql, params, trace?}]
 *   -> [{ok, rows, columns, reads} | {ok: false, error: {code, message}}]
 * A batch that fails (timeout, crash, an oversized reply) is retried one GROUP at a time (groupOf(query, index); by
 * default each query is its own group), so one runaway query cannot hide the others' results, and the day-variants of
 * one predicate are never rerun one by one. Nothing starts after budgetMs; what is left gets SQL_BUDGET.
 */
export function runSelect({ tables, queries, timeoutMs = DEFAULTS.timeoutMs, maxRows = DEFAULTS.maxRows, heapMb = DEFAULTS.heapMb, budgetMs = DEFAULTS.budgetMs, maxReplyBytes = DEFAULTS.maxReplyBytes, groupOf = null }) {
  checkTables(tables);
  if (!queries.length) return [];
  const fail = (code, message) => ({ ok: false, error: { code, message } });
  if (!existsSync(SHELL)) return queries.map(() => fail('SQL_SANDBOX', `no ${SHELL}: the worker cannot be given its file-size limit, so no reader SQL runs`));
  const deadline = Date.now() + budgetMs;
  const once = (qs, tmo) => {
    const input = JSON.stringify({ tables, queries: qs, maxRows });
    const r = spawnSync(SHELL, ['-c', `ulimit -f ${FILE_CAP_BLOCKS} && exec "$0" "$@"`, process.execPath, `--max-old-space-size=${heapMb}`, '--no-warnings', SELF, '--sql-worker'],
      { input, timeout: tmo, killSignal: 'SIGKILL', maxBuffer: maxReplyBytes, encoding: 'utf8', env: {} });
    if (r.error?.code === 'ENOBUFS') return { error: fail('SQL_REPLY', `the reply exceeds ${maxReplyBytes} bytes`) };
    if (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGKILL') return { error: fail('SQL_TIMEOUT', `no answer within ${tmo} ms`) };
    if (r.signal === 'SIGXFSZ') return { error: fail('SQL_SPILL', 'a temporary file exceeded the file-size cap') };
    if (r.status !== 0) return { error: fail('SQL_CRASH', String(r.stderr ?? '').slice(0, 300) || `exit ${r.status}`) };
    try { return { results: JSON.parse(r.stdout) }; } catch { return { error: fail('SQL_CRASH', 'unparsable worker reply') }; }
  };
  const left = () => deadline - Date.now();
  const first = once(queries, Math.max(1, Math.min(timeoutMs, left())));
  if (first.results) return first.results;
  const groups = new Map();
  queries.forEach((q, k) => { const g = groupOf ? groupOf(q, k) : k; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(k); });
  const out = new Array(queries.length);
  if (groups.size === 1) { queries.forEach((_, k) => { out[k] = first.error; }); return out; }
  for (const ks of groups.values()) {
    if (left() <= 0) { for (const k of ks) out[k] = fail('SQL_BUDGET', `the ${budgetMs} ms budget of this evaluation is spent`); continue; }
    const r = once(ks.map(k => queries[k]), Math.max(1, Math.min(timeoutMs, left())));
    ks.forEach((k, i) => { out[k] = r.results ? r.results[i] : r.error; });
  }
  return out;
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
