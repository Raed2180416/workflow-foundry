// Mutation check of the oracle-side libraries (E-BED §9.5: "goldens + controls + metamorphic checks kill >= 95%; each
// survivor is equivalent or gets a new golden"). Each mutant is one source edit using an operator of §9.5 (relational
// boundary, hit-policy swap, precedence swap, calendar swap, anchor swap, missing key, compensation order reversal,
// deleted pause condition, deleted guard, ...). The CLI copies beds/ebed/lib and beds/lib into a temporary directory
// (os.tmpdir(), honours TMPDIR), applies one mutant, runs this directory's *.test.mjs there, and counts a mutant as
// killed when any test fails. $0: no model calls; nothing in the repository is modified.
//
//   node beds/ebed/lib/mutants.mjs [--jobs 2] [--only id,id]      prints one line per mutant and the kill rate
//
// Equivalent mutants found while writing this list (excluded, with the reason): warning thresholds floor -> ceil
// (targets are whole minutes, so target * percent is always divisible by 100); calendar.subtract `<=` -> `<` (a cut
// that only touches an interval leaves it whole either way).
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const BEDS = join(HERE, '..', '..');

// [id, file, operator, find, replace]; `find` must occur exactly once in `file`.
export const MUTANTS = [
  ['T1', 'time.mjs', 'calendar swap', 'mod(day + 3, 7) + 1', 'mod(day + 4, 7) + 1'],
  ['T2', 'time.mjs', 'rule swap', 'EU: (y) => ({ start: lastSunday(y, 3) * DAY + 1 * HOUR', 'EU: (y) => ({ start: lastSunday(y, 3) * DAY + 2 * HOUR'],
  ['T3', 'time.mjs', 'rule swap', 'start: nthSunday(y, 3, 2) * DAY', 'start: nthSunday(y, 3, 1) * DAY'],
  ['T4', 'time.mjs', 'relational boundary', '(t >= start && t < end)', '(t > start && t < end)'],
  ['T5', 'time.mjs', 'disambiguation swap', "return disambiguation === 'earlier' ? lo : hi;", "return disambiguation === 'later' ? hi : lo;"],
  ['T6', 'time.mjs', 'disambiguation swap', "return disambiguation === 'later' ? valid[1] : valid[0];", "return disambiguation === 'earlier' ? valid[0] : valid[1];"],
  ['T7', 'time.mjs', 'disambiguation swap', '  if (valid.length) return valid[0];\n  const year', '  if (valid.length) return valid[valid.length - 1];\n  const year'],
  ['T8', 'time.mjs', 'sign swap', "off = (m[8][0] === '-' ? -1 : 1)", "off = (m[8][0] === '-' ? 1 : -1)"],
  ['T9', 'time.mjs', 'deleted guard', "  if (valid.length) return valid[0];\n  const year = new Date(day * DAY).getUTCFullYear();", "  if (valid.length) return valid[0];\n  return hi;\n  const year = new Date(day * DAY).getUTCFullYear();"],
  ['C1', 'calendar.mjs', 'deleted guard (holidays)', 'const cuts = c.closures.get(day);', 'const cuts = null;'],
  ['C2', 'calendar.mjs', 'anchor swap', 'd = step(cal, d, dir, false);', 'd = step(cal, d, dir, k === 0);'],
  ['C3', 'calendar.mjs', 'interval end swap', 'for (let d = da + 1; d <= db; d++)', 'for (let d = da; d < db; d++)'],
  ['C4', 'calendar.mjs', 'relational boundary', 'if (acc + (E - s) >= ms) return s + (ms - acc);', 'if (acc + (E - s) > ms) return s + (ms - acc);'],
  ['C5', 'calendar.mjs', 'deleted guard', "return f.slice(0, 7) === month(day) ? f : previousBusinessDay", "return true ? f : previousBusinessDay"],
  ['C6', 'calendar.mjs', 'deleted clip', 'const s = Math.max(S, a), e = Math.min(E, b);', 'const s = S, e = Math.min(E, b);'],
  ['C7', 'calendar.mjs', 'calendar swap (24x7)', 'const S = wallStart(day, s, c.tz), E = wallStart(day, e, c.tz);', 'const S = day * 86400000 - 0, E = S + (e - s);'],
  ['C8', 'calendar.mjs', 'deleted guard', 'export const isBusinessDay = (cal, date) => wallIntervals(cal, date).length > 0;', 'export const isBusinessDay = (cal, date) => calendar(cal).hours[weekdayOf(toDay(date))].length > 0;'],
  ['E1', 'editions.mjs', 'relational boundary', 'return s.from <= d && d < s.to;', 'return s.from <= d && d <= s.to;'],
  ['E2', 'editions.mjs', 'latest wins', 'if (hits.length !== 1) {', 'if (hits.length === 0) {'],
  ['E3', 'editions.mjs', 'edition by run date', 'const known = asOf === undefined ? editions :', 'const known = true ? editions :'],
  ['D1', 'dtable.mjs', 'relational boundary', '(u.loIn ? x >= u.lo.v : x > u.lo.v)', '(u.loIn ? x > u.lo.v : x > u.lo.v)'],
  ['D2', 'dtable.mjs', 'relational boundary', "case 'lt': return x < u.v.v;", "case 'lt': return x <= u.v.v;"],
  ['D3', 'dtable.mjs', 'precedence swap', 'if (pa[k] !== pb[k]) return pa[k] - pb[k];', 'if (pa[k] !== pb[k]) return pb[k] - pa[k];'],
  ['D4', 'dtable.mjs', 'hit-policy swap', "case 'PRIORITY': hits = [[...matched].sort((a, b) => comparePriority(c, a, b))[0]]; break;", "case 'PRIORITY': hits = [matched[0]]; break;"],
  ['D5', 'dtable.mjs', 'deleted guard', "if (matched.length > 1) fail('HIT_POLICY'", "if (matched.length > 99) fail('HIT_POLICY'"],
  ['D6', 'dtable.mjs', 'deleted guard', 'if (matched.some(r => canonical(r.out) !== first)) fail(', 'if (false) fail('],
  ['D7', 'dtable.mjs', 'no-hit semantics', 'result: c.hasDefault ? outputOf(c, c.dflt) : null, matched: []', 'result: c.hasDefault ? outputOf(c, c.dflt) : (MULTI.has(c.policy) ? [] : null), matched: []'],
  ['D8', 'dtable.mjs', 'aggregation swap', "case 'COUNT': return hits.length;", "case 'COUNT': return new Set(hits.map(r => canonical(r.out))).size;"],
  ['D9', 'dtable.mjs', 'null semantics', "if (test.k === 'any') return x !== null || dashMatchesNull;", "if (test.k === 'any') return true;"],
  ['D10', 'dtable.mjs', 'negation semantics', "if (test.k === 'not') return listValue(test.list, x) === false;", "if (test.k === 'not') return listValue(test.list, x) !== true;"],
  ['D11', 'dtable.mjs', 'deleted check (gaps)', "      if (!c.hasDefault) {\n        gaps++;", "      if (false) {\n        gaps++;"],
  ['D12', 'dtable.mjs', 'witness boundary', 'Math.floor(x) + 1]))]', 'Math.floor(x) + 2]))]'],
  ['D13', 'dtable.mjs', 'deleted guard (domain)', 'if (x !== null && inp.values && !satisfies(inp.values, x, false)) fail(', 'if (false) fail('],
  ['D14', 'dtable.mjs', 'hit-policy swap', "case 'OUTPUT ORDER': hits = [...matched].sort((a, b) => comparePriority(c, a, b)); break;", "case 'OUTPUT ORDER': hits = matched; break;"],
  ['D15', 'dtable.mjs', 'deleted check (ANY conflict)', "if (canonical(active[i].out) !== canonical(active[j].out)) pair('TABLE_OVERLAP'", "if (false) pair('TABLE_OVERLAP'"],
  ['K1', 'clock.mjs', 'relational boundary', "breached = dueAt !== null && (def.boundary === 'inclusive' ? now > dueAt : now >= dueAt);", "breached = dueAt !== null && (def.boundary === 'inclusive' ? now >= dueAt : now >= dueAt);"],
  ['K2', 'clock.mjs', 'deleted pause condition', 'const businessElapsedMs = sumBiz(segs), businessPauseMs = sumBiz(pauses);', 'const businessElapsedMs = sumBiz([...segs, ...pauses]), businessPauseMs = sumBiz(pauses);'],
  ['K3', 'clock.mjs', 'reset not restarting', "case 'reset': st.segments = []; st.pauses = [];", "case 'reset': st.segments = [[st.startedAt, t]]; st.pauses = [];"],
  ['K4', 'clock.mjs', 'relational boundary', "breached = dueAt !== null && (def.boundary === 'inclusive' ? st.endedAt > dueAt : st.endedAt >= dueAt);", "breached = dueAt !== null && (def.boundary === 'inclusive' ? st.endedAt >= dueAt : st.endedAt >= dueAt);"],
  ['K5', 'clock.mjs', 'end-of-day swap', 'dayBounds(date, c.tz).end - SECOND', 'dayBounds(date, c.tz).end'],
  ['K6', 'clock.mjs', 'anchor swap (zone)', ': localDate(anchor, c.tz);', ": localDate(anchor, 'UTC');"],
  ['K7', 'clock.mjs', 'deleted pause condition (projection)', "  if (st.state === 'running') return positionOf(def, st.segStart, need - acc);\n  return null;", "  return positionOf(def, st.segStart ?? st.pauseStart ?? st.endedAt, need - acc);"],
  ['K8', 'clock.mjs', 'calendar swap', 'const measureOf = (def, s, e) => (def.business ? businessMs(def.cal, s, e) : e - s);', 'const measureOf = (def, s, e) => e - s;'],
  ['S1', 'saga.mjs', 'compensation order reversal', ': [...committed].reverse();', ': [...committed];'],
  ['S2', 'saga.mjs', 'unknown outcome ignored', "if (u.status === 'committed') return 'committed';", "if (u.status === 'committed') return 'not-applied';"],
  ['S3', 'saga.mjs', 'guess instead of query', "if (u.status === undefined || u.status === null || u.status === 'pending') return 'undetermined';", "if (u.status === undefined || u.status === null || u.status === 'pending') return 'not-applied';"],
  ['S4', 'saga.mjs', 'missing key part', "${itemId === null || itemId === undefined ? '' : `:${enc(itemId)}`}", ''],
  ['S5', 'saga.mjs', 'deleted guard (pivot)', 'if (failed && pivotCommitted && failed.stepIndex > pivotIndex) {', 'if (false) {'],
  ['S6', 'saga.mjs', 'compensation order reversal (seq)', 'sort((a, b) => b.seq - a.seq)', 'sort((a, b) => a.seq - b.seq)'],
  ['S7', 'saga.mjs', 'deleted order', '    after = key;', '    after = null;'],
  ['S8', 'saga.mjs', 'deleted guard (abort)', "if (abort && pivotCommitted) return { action: 'abort-refused', reason: 'pivot-committed' };", ''],
  ['L1', 'ledger.mjs', 'relational boundary', 'if (t > c.window.latest) { s.status', 'if (t >= c.window.latest) { s.status'],
  ['L2', 'ledger.mjs', 'relational boundary', 'if (t < c.window.earliest) { s.status', 'if (t <= c.window.earliest) { s.status'],
  ['L3', 'ledger.mjs', 'deleted check (duplicate)', "if (s.satisfied) { div(t, 'duplicate', { row: idx, lid: c.lid, money: c.money }); return; }", 'if (s.satisfied) { return; }'],
  ['L4', 'ledger.mjs', 'deleted check (key-split)', 'if (s.attempts > 0 && key !== s.key)', 'if (false)'],
  ['L5', 'ledger.mjs', 'deleted check (key-reuse)', "else if (prev !== owner) div(at, 'key-reuse'", "else if (false) div(at, 'key-reuse'"],
  ['L6', 'ledger.mjs', 'deleted check (order)', 'if (!(ps.satisfied && ps.commitIdx < idx))', 'if (false)'],
  ['L7', 'ledger.mjs', 'deleted check (withdrawal)', "if (!s.satisfied && e.withdrawnAt <= e.window.latest) { s.status = 'withdrawn'; continue; }", ''],
  ['L8', 'ledger.mjs', 'censoring removed', 'if (e.window.latest <= endMs)', 'if (true)'],
  ['L9', 'ledger.mjs', 'sign swap (PLB)', "const expected = paid - adj(remit.plb, 'PLB')", "const expected = paid + adj(remit.plb, 'PLB')"],
  ['L10', 'ledger.mjs', 'dropped term', '- adj(c.adjustments, `claim ${c.id}`) - lineAdj', '- adj(c.adjustments, `claim ${c.id}`)'],
  ['L11', 'ledger.mjs', 'side swap', 'if (l.side === \'debit\') c.d += a; else c.c += a;', 'c.d += a;'],
  ['L12', 'ledger.mjs', 'deleted guard (committed)', 'if (!r.committed || !select(r)) return;', 'if (!select(r)) return;'],
  ['L13', 'ledger.mjs', 'deleted guard (opening)', 't >= e.openedAt && argsMatch', 'argsMatch'],
];

/** Apply one mutant to source text; throws unless `find` occurs exactly once. */
export function applyMutant(text, find, replace) {
  const n = text.split(find).length - 1;
  if (n !== 1) throw new Error(`mutant pattern occurs ${n} times: ${find.slice(0, 60)}`);
  return text.replace(find, () => replace);
}

function runOne([id, file, op, find, replace], root) {
  const dir = mkdtempSync(join(root, `${id}-`));
  cpSync(join(BEDS, 'lib'), join(dir, 'beds', 'lib'), { recursive: true });
  mkdirSync(join(dir, 'beds', 'ebed'), { recursive: true });
  cpSync(HERE, join(dir, 'beds', 'ebed', 'lib'), { recursive: true });
  const target = join(dir, 'beds', 'ebed', 'lib', file);
  writeFileSync(target, applyMutant(readFileSync(target, 'utf8'), find, replace));
  const lib = join(dir, 'beds', 'ebed', 'lib');
  const tests = readdirSync(lib).filter(f => f.endsWith('.test.mjs') && f !== 'mutants.test.mjs').map(f => join(lib, f));
  return new Promise(resolve => {
    const t0 = Date.now();
    const p = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=dot', ...tests], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', code => {
      rmSync(dir, { recursive: true, force: true });
      resolve({ id, file, op, killed: code !== 0, ms: Date.now() - t0, failures: (out.match(/^not ok|✖/gm) ?? []).length });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const jobs = Number(args[args.indexOf('--jobs') + 1] ?? 2) || 2;
  const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
  const list = MUTANTS.filter(m => !only || only.has(m[0]));
  const root = mkdtempSync(join(tmpdir(), 'ebed-lib-mutants-'));
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, list.length) }, async () => {
    while (next < list.length) {
      const m = list[next++];
      const r = await runOne(m, root);
      results.push(r);
      console.log(`${r.killed ? 'killed  ' : 'SURVIVED'} ${r.id.padEnd(4)} ${r.file.padEnd(13)} ${r.op} (${r.ms} ms)`);
    }
  }));
  rmSync(root, { recursive: true, force: true });
  const killed = results.filter(r => r.killed).length;
  console.log(`mutants ${results.length}, killed ${killed}, survived ${results.length - killed}, score ${(killed / results.length).toFixed(3)}`);
  process.exitCode = killed / results.length >= 0.95 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
