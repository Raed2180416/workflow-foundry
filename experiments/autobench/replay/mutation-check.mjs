#!/usr/bin/env node
// Mutation check for the Δ* v1.1 / harness/v3 / replay-scoring test suites (review of 2026-11-04, finding 15: the
// "32 of 32" claim had no committed harness). DEVELOPER TOOL, $0, no benchmark data.
//
//   nice -n 15 node experiments/autobench/replay/mutation-check.mjs --work <empty scratch dir> --out <result.json> [--only 'name|name']
//
// It mirrors experiments/autobench/{verifier/requirement-ledger-v3, harness/v3, replay} into --work (about 1 MB; never
// the worktree), checks that each suite passes unmutated, then applies every mutant below (one deliberately broken
// variant of the code, each a list of exact text edits that must match exactly once) and runs the suite that should
// catch it. A mutant is KILLED when its suite fails. Exit code 1 when a baseline fails, a mutant does not apply, or a
// mutant survives. Mutants marked `fix` revert one fix of the 2026-11-04 review (so a killed `fix` mutant is a test
// that fails on the old behaviour). The mirror is removed at the end unless --keep is given.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AB = path.resolve(HERE, '..');
const DIRS = ['verifier/requirement-ledger-v3', 'harness/v3', 'replay'];
const SUITES = { rl3: 'verifier/requirement-ledger-v3/rl3.test.mjs', gate: 'harness/v3/gate.test.mjs', replay: 'replay/dstar-replay.test.mjs' };
const RL3 = 'verifier/requirement-ledger-v3';

/** [name, suite, file, [[find, replace], ...], fix?] */
export const MUTANTS = [
  // ---- sandbox (sqlsafe.mjs)
  ['sqlsafe: authorizer allows by default', 'rl3', `${RL3}/sqlsafe.mjs`, [['    return C.SQLITE_DENY;\n  });', '    return C.SQLITE_OK;\n  });']]],
  ['sqlsafe: randomblob and zeroblob on the allow-list', 'rl3', `${RL3}/sqlsafe.mjs`, [["'abs', 'avg',", "'abs', 'randomblob', 'zeroblob', 'avg',"]]],
  ['sqlsafe: trailing statements allowed', 'rl3', `${RL3}/sqlsafe.mjs`, [["if (body.includes(';')) return { ok: false, reason: 'more than one statement' };", '']]],
  ['sqlsafe: any table readable', 'rl3', `${RL3}/sqlsafe.mjs`, [["const ok = dbName === null || (dbName === 'main' && loaded.has(String(a1 ?? '').toLowerCase()));", 'const ok = true;']]],
  ['sqlsafe: timeout reported as a crash', 'rl3', `${RL3}/sqlsafe.mjs`, [["if (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGKILL') return", 'if (false) return']]],
  ['sqlsafe: the host clock is readable (finding 2)', 'rl3', `${RL3}/sqlsafe.mjs`, [['if (why) throw new Error(', 'if (false) throw new Error(']], 'fix'],
  ["sqlsafe: only the exact literal 'now' is refused (finding 2)", 'rl3', `${RL3}/sqlsafe.mjs`, [['const HOST_TIME = /^\\s*now\\s*$/i;', 'const HOST_TIME = /^now$/;']], 'fix'],
  ['sqlsafe: localtime and utc modifiers allowed (finding 2)', 'rl3', `${RL3}/sqlsafe.mjs`, [['const HOST_ZONE = /^\\s*(localtime|utc)\\s*$/i;', 'const HOST_ZONE = /^$x/;']], 'fix'],
  ['sqlsafe: no file-size cap on the worker (finding 3)', 'rl3', `${RL3}/sqlsafe.mjs`, [['`ulimit -f ${FILE_CAP_BLOCKS} && exec "$0" "$@"`', '`exec "$0" "$@"`']], 'fix'],
  ['sqlsafe: the time budget is ignored (finding 14)', 'rl3', `${RL3}/sqlsafe.mjs`, [['if (left() <= 0) {', 'if (false) {']], 'fix'],
  ['sqlsafe: a failed batch is retried query by query (finding 14)', 'rl3', `${RL3}/sqlsafe.mjs`, [['const g = groupOf ? groupOf(q, k) : k;', 'const g = k;']], 'fix'],
  ['sqlsafe: an oversized reply is reported as a timeout (finding 14)', 'rl3', `${RL3}/sqlsafe.mjs`, [["if (r.error?.code === 'ENOBUFS')", 'if (false)']], 'fix'],
  ['sqlsafe: a predicate may close its own parenthesis (finding 4)', 'rl3', `${RL3}/sqlsafe.mjs`, [["if (depth < 0) return { ok: false, reason: 'a parenthesis closes the predicate' };", '']], 'fix'],
  ['sqlsafe: reads are not traced (finding 4)', 'rl3', `${RL3}/sqlsafe.mjs`, [['if (ok && reads && dbName === \'main\') reads.add(`${a1}.${a2}`);', '']], 'fix'],
  // ---- Δ* (dstar.mjs)
  ['dstar: every vote counts as verified', 'rl3', `${RL3}/dstar.mjs`, [["const verified = d => vs.filter(v => v.d === d && ['predicate', 'quote'].includes(v.basis.kind));", 'const verified = d => vs.filter(v => v.d === d);']]],
  ['dstar: clock flips become exclusions', 'rl3', `${RL3}/dstar.mjs`, [["else if (ins.every(x => !x)) vote(m, 'exclude', { kind: 'predicate', where, executed: true, complement: true });", "else if (!ins[0]) vote(m, 'exclude', { kind: 'predicate', where, executed: true, complement: true });"]]],
  ['dstar: a bare reader exclusion is hard', 'rl3', `${RL3}/dstar.mjs`, [["vote(m, want === 'include' ? 'include' : 'unknown', want === 'include' ? { kind: 'reader', verified: false, pointer: how } : { kind: 'null',", "vote(m, want, want === 'include' ? { kind: 'reader', verified: false, pointer: how } : { kind: 'quote',"]]],
  ['dstar: quotes are not verified', 'rl3', `${RL3}/dstar.mjs`, [["  if (q.length < 4) return false;\n  if (grounded(q, requestText)) return 'request';", "  return 'request';"]]],
  ['dstar: a list posing as a predicate executes (finding 4)', 'rl3', `${RL3}/dstar.mjs`, [['if (L.list) {', 'if (false) {']], 'fix'],
  ['dstar: identifying columns are not a list (finding 4)', 'rl3', `${RL3}/dstar.mjs`, [['const ids = own.filter(c => ID_COLUMN.test(c) || (labelColumn && c === labelColumn));', 'const ids = [];']], 'fix'],
  // the whole old mechanism (no text check, a WHERE splice, no read trace); reverting only the check and the splice
  // survives, because the read trace still refuses the injected text (defence in depth, measured 2026-11-04)
  ['dstar: the predicate is spliced into WHERE again, untraced (finding 4)', 'rl3', `${RL3}/dstar.mjs`, [['const pc = checkPredicateText(it.where);', 'const pc = { ok: true };'], ['sql = `SELECT _mid, CASE WHEN (\\n${it.where}\\n) THEN 1 ELSE 0 END AS _hit FROM "${it.table}"`;', 'sql = `SELECT _mid, 1 AS _hit FROM "${it.table}" WHERE (${it.where})`;'], ['trace = `SELECT CASE WHEN (\\n${it.where}\\n) THEN 1 ELSE 0 END FROM "${it.table}"`;', 'trace = undefined;']], 'fix'],
  ['dstar: an induced rule counts as a reader predicate (finding 7)', 'rl3', `${RL3}/dstar.mjs`, [["if (d) vote(m, d, { kind: 'induced',", "if (d) vote(m, d, { kind: 'predicate',"]], 'fix'],
  ['dstar: one claim per side induces a rule (finding 7)', 'rl3', `${RL3}/dstar.mjs`, [['export const INDUCE_MIN_PER_SIDE = 2;', 'export const INDUCE_MIN_PER_SIDE = 1;']], 'fix'],
  ['dstar: an induced threshold extrapolates (finding 7)', 'rl3', `${RL3}/dstar.mjs`, [["const side = x => (x === null ? null : x >= inLo && x <= inHi ? 'include' : x >= outLo && x <= outHi ? 'exclude' : null);", "const side = x => (x === null ? null : inHi < outLo ? (x <= inHi ? 'include' : x >= outLo ? 'exclude' : null) : (x >= inLo ? 'include' : x <= outHi ? 'exclude' : null));"]], 'fix'],
  ['dstar: an unverified include outvotes an unverified exclusion (finding 7)', 'rl3', `${RL3}/dstar.mjs`, [["!vs.some(v => v.d === 'exclude')", '!exc.length']], 'fix'],
  ['dstar: literals compile hard without grounding (finding 6)', 'rl3', `${RL3}/dstar.mjs`, [['const litOk = !ground || P.lit === undefined || ground.literal(P.lit);', 'const litOk = true;']], 'fix'],
  ['dstar: targets compile hard without grounding (finding 6)', 'rl3', `${RL3}/dstar.mjs`, [['const targetOk = !ground || !target || ground.target(target);', 'const targetOk = true;']], 'fix'],
  ['dstar: content literals are never compiled (finding 6)', 'rl3', `${RL3}/dstar.mjs`, [['for (const lit of uniq((ob.literals ?? [])', 'for (const lit of uniq(([])']], 'fix'],
  ['dstar: a figure to an ungrounded target is hard (finding 6)', 'rl3', `${RL3}/dstar.mjs`, [['const hard = ground ? ground.target(target) : true;', 'const hard = true;']], 'fix'],
  ['dstar: a failed soft check passes the verdict (finding 5)', 'rl3', `${RL3}/dstar.mjs`, [["const v = pass === true ? 'SUPPORTED' : pass === false && a.status === 'hard' ? 'FAILED' : 'UNKNOWN';", "const v = pass === false && a.status === 'hard' ? 'FAILED' : 'SUPPORTED';"]], 'fix'],
  ['dstar: undecided checks are not on the assumption list (finding 5)', 'rl3', `${RL3}/dstar.mjs`, [['const assumptions = [...dstar.unknowns, ...unknownRows.map(', 'const assumptions = [...dstar.unknowns, ...[].map(']], 'fix'],
  ["dstar: a record's 'as of' becomes the work's today (finding 13)", 'rl3', `${RL3}/dstar.mjs`, [['grounded(str(R.today.quote), requestText)', 'verifyQuote(R.today.quote, { requestText, records })']], 'fix'],
  // ---- clock, pointers, universes
  ['clock: load stamps are business dates', 'rl3', `${RL3}/clock.mjs`, [['if (instant !== null && stamp(instant)) continue;', '']]],
  ['clock: the weak domain is one-sided', 'rl3', `${RL3}/clock.mjs`, [['domain: [addDays(a.date, -horizonDays), addDays(a.date, horizonDays)]', 'domain: [a.date, addDays(a.date, horizonDays)]']]],
  ['clock: schedule fields count as past events (finding 13)', 'rl3', `${RL3}/clock.mjs`, [['eventKind && !SCHEDULE_FIELD.test(field) &&', 'eventKind &&']], 'fix'],
  ['clock: scheduled kinds count as past events (finding 13)', 'rl3', `${RL3}/clock.mjs`, [['const EVENT_KIND = /(message|mail|conversation|ticket|post|', 'const EVENT_KIND = /(message|mail|conversation|ticket|event|meeting|post|']], 'fix'],
  ['pointers: ambiguity resolves to the first match', 'rl3', `${RL3}/pointers.mjs`, [['const unique = list => (list?.length === 1 ? list[0] : null);', 'const unique = list => (list?.[0] ?? null);']]],
  ["pointers: an app-qualified pointer falls back to another app's id (finding 18)", 'rl3', `${RL3}/pointers.mjs`, [["if (index.universes.some(u => u.app === app)) return miss('unresolved');", '']], 'fix'],
  ['universes: common words become mention forms', 'rl3', `${RL3}/universe.mjs`, [["return [...forms].filter(f => f.length >= 3 && !COMMON.has(f) && (f === full || !clash(f)));", 'return [...forms].filter(f => f.length >= 3 && (f === full || !clash(f)));']]],
  // ---- registry and gate
  ["registry: identity uses the caller's key", 'gate', 'harness/v3/registry.mjs', [["if (k === 'raw' || CALLER_KEY.test(k ?? '')) continue;", "if (k === 'raw') continue;"]]],
  ["registry: a nested reference's name is the entity's name", 'gate', 'harness/v3/registry.mjs', [['const entityLevel = (parent, depth) => depth <= 1 || (depth === 2 && WRAPPER.test(parent ?? \'\'));', 'const entityLevel = () => true;']]],
  ['gate: message keys ignore the members they are about', 'gate', 'harness/v3/gate.mjs', [["const key = members.length ? `${base}|about:${members.join(',')}` : base;", 'const key = base;']]],
  ["gate: a mention ban ignores the ban's target", 'gate', 'harness/v3/gate.mjs', [['const lit = toTarget ? namesAny(facts.text, r.lits) : null;', 'const lit = namesAny(facts.text, r.lits);']]],
  ['gate: recipient bans are off', 'gate', 'harness/v3/gate.mjs', [["if (r.kind === 'recipient' && isMessage && facts.recipients.includes(r.email))", 'if (false)']]],
  ['gate: duplicates are not refused', 'gate', 'harness/v3/gate.mjs', [["if (violations.length || duplicate) action = 'refuse';", "if (violations.length) action = 'refuse';"]]],
  ['gate: a failed write keeps its key', 'gate', 'harness/v3/gate.mjs', [['if (decision?.action === \'admit\' && !ok) registry.forget(decision.key);', '']]],
  ['gate: an unknown tool is a read (finding 10)', 'gate', 'harness/v3/gate.mjs', [['if (name !== WRITE_TOOL) return hold(', "if (name !== WRITE_TOOL) return { action: 'read' }; if (false) return hold("]], 'fix'],
  ['gate: unparseable arguments are a read (finding 10)', 'gate', 'harness/v3/gate.mjs', [["try { args = JSON.parse(args); } catch { return hold('the arguments do not parse'); }", "try { args = JSON.parse(args); } catch { return { action: 'read' }; }"]], 'fix'],
  ['gate: a body without a method is a read (finding 10)', 'gate', 'harness/v3/gate.mjs', [["if (method === null && hasBody) return hold('a body without a method');", '']], 'fix'],
  ['gate: unexplained writes are admitted by default (finding 11)', 'gate', 'harness/v3/gate.mjs', [['holdUnexplained = true,', 'holdUnexplained = false,']], 'fix'],
  ['gate: unenforceable bans are dropped silently (finding 10)', 'gate', 'harness/v3/gate.mjs', [['else unenforced.push(', 'else void (']], 'fix'],
  ["gate: a witness holds on the tool's word (finding 11)", 'gate', 'harness/v3/gate.mjs', [['export function witnessHolds(w, diff) {', 'export function witnessHolds(w, diff) { return true;']], 'fix'],
  // ---- replay scoring
  ['replay: Move 2 mention threshold 5', 'replay', 'replay/gate-replay.mjs', [['mentionRefused: 6,', 'mentionRefused: 5,']]],
  ['replay: Move 1 kill below 3 tasks', 'replay', 'replay/dstar-replay.mjs', [['killTasksBelow: 4,', 'killTasksBelow: 3,']]],
  ['replay: the 30% task share is ignored', 'replay', 'replay/dstar-replay.mjs', [["success: closureTasks >= T.successTasks && maxShare('reachedClosure') <= T.maxTaskShare &&", 'success: closureTasks >= T.successTasks &&']]],
  ['replay: duplicate attribution counts unrefused writes', 'replay', 'replay/gate-replay.mjs', [['prevented += Math.min(cs.length - 1, writes.filter(w => w.refused).length);', 'prevented += Math.min(cs.length - 1, writes.length);']]],
  ['replay: a refusal with no channel aligns with a channel guardrail (finding 1)', 'replay', 'replay/gate-replay.mjs', [['if (!ref.channels.some(c =>', 'if (ref.channels.length && !ref.channels.some(c =>']], 'fix'],
  ['replay: a refused non-message aligns with a mention break (finding 1)', 'replay', 'replay/gate-replay.mjs', [['if (!MESSAGE_KINDS.has(ref.channelKind)) return false;', '']], 'fix'],
  ['replay: Move 2 counts worlds, not refusals (finding 16)', 'replay', 'replay/gate-replay.mjs', [["falseRefusals: sum(passing, 'refusedP') + sum(passing, 'refusedKDiffers'),", 'falseRefusals: falseRefusalWorlds.length,']], 'fix'],
  ['replay: Move 2 verdict on six arms (finding 8)', 'replay', 'replay/gate-replay.mjs', [['prereg: { ...verdict(five),', 'prereg: { ...verdict(six),']], 'fix'],
  ['replay: matched controls ignore the domain (finding 8)', 'replay', 'replay/dstar-replay.mjs', [['let i = left.findIndex(t => dom(t) === dom(b));', 'let i = 0;']], 'fix'],
  ['replay: Move 1 verdict on all passing worlds (finding 8)', 'replay', 'replay/dstar-replay.mjs', [['...verdictOn(flaggedM),', '...verdictOn(flagged6),']], 'fix'],
];

function runSuite(root, suite, timeoutMs) {
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', SUITES[suite]], { cwd: root, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  const failing = /ℹ fail (\d+)/.exec(r.stdout ?? '')?.[1] ?? /# fail (\d+)/.exec(r.stdout ?? '')?.[1] ?? null;
  return { code: r.status, timeout: r.error?.code === 'ETIMEDOUT', failing };
}

async function main() {
  const a = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) { const k = argv[i].replace(/^--/, ''); if (k === 'keep') { a.keep = true; continue; } a[k] = argv[i + 1]; i++; }
  if (!a.work) throw new Error('--work <empty scratch dir> is required');
  if (existsSync(a.work) && readdirSync(a.work).length) throw new Error('--work must be empty or absent');
  const root = path.join(path.resolve(a.work), 'experiments', 'autobench');
  mkdirSync(root, { recursive: true });
  for (const d of DIRS) cpSync(path.join(AB, d), path.join(root, d), { recursive: true, filter: src => !/node_modules|\.gz$/.test(src) });
  const timeoutMs = Number(a.timeout ?? 240_000);
  const only = a.only ? new Set(a.only.split('|')) : null;
  const res = { version: 'mutation-check-v2', baseline: {}, results: [] };
  try {
    for (const s of Object.keys(SUITES)) res.baseline[s] = runSuite(root, s, timeoutMs);
    if (Object.values(res.baseline).some(b => b.code !== 0)) throw new Error(`a baseline suite fails: ${JSON.stringify(res.baseline)}`);
    for (const [name, suite, file, edits, kind] of MUTANTS) {
      if (only && !only.has(name)) continue;
      const f = path.join(root, file);
      const orig = readFileSync(f, 'utf8');
      let text = orig, applied = true;
      for (const [find, replace] of edits) { if (text.split(find).length !== 2) { applied = false; break; } text = text.replace(find, () => replace); }
      if (!applied) { res.results.push({ name, suite, fix: kind === 'fix', applied: false, killed: false }); continue; }
      writeFileSync(f, text);
      const r = runSuite(root, suite, timeoutMs);
      writeFileSync(f, orig);
      res.results.push({ name, suite, fix: kind === 'fix', applied: true, killed: r.code !== 0, failingTests: r.failing, timeout: r.timeout });
      process.stderr.write(`[mutation] ${r.code !== 0 ? 'killed  ' : 'SURVIVED'} ${name}\n`);
    }
  } finally {
    if (!a.keep) rmSync(path.resolve(a.work), { recursive: true, force: true });
  }
  const R = res.results;
  res.summary = { mutants: R.length, applied: R.filter(x => x.applied).length, killed: R.filter(x => x.killed).length, fixMutants: R.filter(x => x.fix).length, fixKilled: R.filter(x => x.fix && x.killed).length,
    survivors: R.filter(x => x.applied && !x.killed).map(x => x.name), notApplied: R.filter(x => !x.applied).map(x => x.name) };
  if (a.out) writeFileSync(a.out, JSON.stringify(res, null, 1));
  process.stdout.write(`${JSON.stringify(res.summary, null, 1)}\n`);
  if (res.summary.survivors.length || res.summary.notApplied.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
