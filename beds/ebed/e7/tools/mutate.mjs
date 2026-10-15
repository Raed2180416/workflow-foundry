// Oracle mutation testing for E7 (E-BED §9.5, K1: mutation score >= 0.95; DESIGN §10). $0, no model calls. A port of
// beds/ebed/e8/tools/mutate.mjs to an oracle in two modules: mutants of `transition.mjs` (ids t1..) and of its SLA engine
// `sla.mjs` (ids e1..). A mutant is killed by either of two independent checks:
//   1. the goldens (golden.mjs): a golden that passes the original oracle fails the mutant (a golden asserts only
//      spec-stated outcomes the grader sees: required effects with their match and window, decisions, human tasks, records);
//   2. the corpus: journals the host wrote on dev worlds (both reference runs, every control, and every solver under
//      specificity/, run out of process in the sandbox arm), graded case by case with the shared grader
//      (oracle/grade.mjs gradeCase) under the original and under the mutant oracle. A mutant is killed when one case's
//      signature differs: on a completed-pool case its verdict, oracle error and first divergence (layer/code/lid, as
//      E8 keys it); on every case its critical codes. A case whose journal content is identical to one already in the
//      corpus (same world, same rows up to journal numbering) is graded once (the grade is a function of that content).
// The mutant oracle is the item's whole oracle binding re-imported over the mutant modules (a copy of index.mjs):
// referenceTransition, recordsOf, canonicalArgs and critical (whose approval count is the transition's own history) are
// all the mutant's, so no hook is left on the original (E8's H1 does not arise here).
// Operators (E-BED §9.5, DESIGN §10): generic per-line operators (relational boundary, equality, logic, arithmetic swap,
// max/min, floor/ceil, first/last pick, window bounds, statement deletion, deleted guard) plus named semantic operators
// (edition by publication or run date, first-match and highest-order precedence, calendar, zone and holiday swaps, anchor
// swaps, deleted pause condition, pause on any hold, retroactive start or pause dropped, reset dropped, R4.2 order swap,
// recipient fixed at attach, SoD exclusion dropped, dedupe on CI only, join after resolution, missing record order).
// Mutants that give the same module text are one mutant (the first operator names it).
// Each mutant runs in a worker thread with a time limit (an oracle that never answers is killed: `timeout`); the worker
// is replaced every --recycle mutants (module instances are never unloaded). Results stream to <work>/results.jsonl, so
// an interrupted run resumes (--resume). Survivors are printed with their diff for triage in ledger/MUTANTS.md.
//   node beds/ebed/e7/tools/mutate.mjs [--worlds 1009:3:60,1010:5:60,1011:4:60,1012:2:60] [--only t12,e3] [--limit N]
//        [--sample N --sample-seed s] [--no-specificity] [--no-controls] [--golden-only] [--corpus-always] [--jobs 1]
//        [--work .foundry/e7-mutate] [--resume] [--json out.json] [--list]
// Seeds: dev block 1001-1199 only (DESIGN §13: mutation suites); every other seed is refused.
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const E7 = path.resolve(here, '..');
const REPO = path.resolve(E7, '..', '..', '..');
const FILES = { t: 'transition.mjs', e: 'sla.mjs' };
const sha = s => createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------------------------------------------------------------
// Mutant generation (pure; exported for the item suite).

/** The code part of a line and a mask of the characters outside string literals (template interpolations are code). */
function scan(line) {
  const mask = new Array(line.length).fill(true);
  const stack = [];
  let q = null, end = line.length;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q === "'" || q === '"') { mask[i] = false; if (ch === '\\') { mask[i + 1] = false; i++; } else if (ch === q) q = null; continue; }
    if (q === '`') {
      mask[i] = false;
      if (ch === '\\') { mask[i + 1] = false; i++; } else if (ch === '`') q = null;
      else if (ch === '$' && line[i + 1] === '{') { mask[i + 1] = false; i++; stack.push('tpl'); q = null; }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; mask[i] = false; continue; }
    if (ch === '/' && line[i + 1] === '/') { end = i; break; }
    if (ch === '{') stack.push('{');
    else if (ch === '}' && stack.pop() === 'tpl') { mask[i] = false; q = '`'; }
  }
  for (let i = end; i < line.length; i++) mask[i] = false;
  return { end, mask, code: line.slice(0, end) };
}

/** Statements of one line (code part): [{ start, end, text, inBlock }] for every `;`-terminated statement at the line's
 * top level or directly inside a block `{ ... }` opened on the line (not an object literal). */
function statements(line) {
  const { end, mask } = scan(line);
  const out = [];
  const stack = [];                       // { ch, block, start }
  let start = 0;
  const isBlockOpen = i => {
    const before = line.slice(0, i).trimEnd();
    return before === '' || before.endsWith(')') || before.endsWith('=>') || before.endsWith('else') || before.endsWith(':');
  };
  for (let i = 0; i < end; i++) {
    if (!mask[i]) continue;
    const ch = line[i];
    if (ch === '(' || ch === '[') stack.push({ ch, block: false });
    else if (ch === '{') { const block = isBlockOpen(i); stack.push({ ch, block }); if (block) start = i + 1; }
    else if (ch === ')' || ch === ']') stack.pop();
    else if (ch === '}') { const top = stack.pop(); if (top?.block) start = i + 1; }
    else if (ch === ';' && (stack.length === 0 || stack.at(-1).block)) {
      out.push({ start, end: i + 1, text: line.slice(start, i + 1), inBlock: stack.length > 0 });
      start = i + 1;
    }
  }
  return out;
}

/** The index just past the parenthesis that closes the one at `open` (code characters only), or -1. */
function closeParen(line, open, mask) {
  let d = 0;
  for (let i = open; i < line.length; i++) {
    if (!mask[i]) continue;
    if (line[i] === '(') d++;
    else if (line[i] === ')') { d--; if (d === 0) return i + 1; }
  }
  return -1;
}

const KEYWORD = /^(const|let|var|return|if|for|else|case|default|break|continue|throw|switch|while|do|function|export|import|new|void)\b/;
const DELETABLE = /^[A-Za-z_$][\w$]*(?:(?:\?\.|\.)[A-Za-z_$][\w$]*|\[[^\]]+\])*\s*(?:=(?!=)|\+=|-=|\(|\.push\(|\.add\(|\.shift\(|\.set\()/;

/** Generic per-line operators: [operator, regex, replacement]. */
const GENERIC = [
  ['relational boundary', / <= /g, ' < '], ['relational boundary', / < /g, ' <= '], ['relational boundary', / >= /g, ' > '], ['relational boundary', / > /g, ' >= '],
  ['equality', / === /g, ' !== '], ['equality', / !== /g, ' === '], ['logic', / && /g, ' || '], ['logic', / \|\| /g, ' && '],
  ['arithmetic swap', / \+ (?!SEC\b)/g, ' - '], ['arithmetic swap', / - /g, ' + '],
  ['arithmetic swap', /Math\.max\(/g, 'Math.min('], ['arithmetic swap', /Math\.min\(/g, 'Math.max('], ['arithmetic swap', /Math\.floor\(/g, 'Math.ceil('],
  ['window bound', / \+ SEC\b/g, ''], ['window bound', /\b15 \* MIN\b/g, '14 * MIN'], ['window bound', /\b15 \* MIN\b/g, '16 * MIN'],
  ['window bound', /\bdeadline: (15|60)\b/g, m => m.replace(/\d+$/, d => String(Number(d) + 1))],
  ['window bound', /winOf\(d\.at, (15|60)\)/g, m => m.replace(/(\d+)\)$/, (_, d) => `${Number(d) + 1})`)],
  ['first/last pick', /\.find\(/g, '.findLast('], ['first/last pick', /\[0\]/g, '.at(-1)'], ['first/last pick', /\.at\(-1\)/g, '[0]'],
];

/**
 * Named semantic operators (E-BED §9.5, DESIGN §10). Each edits one file: `line` (a regex that must match exactly the
 * lines edited; `nth` picks one of several) and `to(line)`, or `lines(lines) -> lines` (same length) for an edit over
 * several lines. A named operator that no longer applies is reported (the source moved under it).
 */
const NAMED = [
  // transition.mjs ---------------------------------------------------------------------------------------------------
  { file: 't', op: 'edition by publication (R0)', line: /if \(e\.effectiveFrom <= date\) ed = e;/, to: l => l.replace('e.effectiveFrom <= date', '(e.published ? e.published.slice(0, 10) : e.effectiveFrom) <= date') },
  { file: 't', op: 'edition by run date: priority (R0, R2.2)', line: /priorityAt\(world, (p|at), /, all: true, to: l => l.replace(/priorityAt\(world, (p|at), /, 'priorityAt(world, now, ') },
  { file: 't', op: 'edition by run date: alert urgency (R0, R2.1)', line: /editionAt\(world, (p|at)\)\.alertUrgency/, all: true, to: l => l.replace(/editionAt\(world, (p|at)\)\.alertUrgency/, 'editionAt(world, now).alertUrgency') },
  { file: 't', op: 'edition by run date: approval deadline (R0, R7.2)', line: /policy\(x\.at\)\.majorApprovalMinutes/, to: l => l.replace('policy(x.at)', 'policy(now)') },
  { file: 't', op: 'edition at the horizon: caller and closure days (R0, R6)', line: /const pol = editionAt\(world, fromMs\)\.policy;/, to: l => l.replace('editionAt(world, fromMs)', 'editionAt(world, ms(world.horizonEnd))') },
  { file: 't', op: 'edition by startAt: every definition at openedAt (R0, R4.3, S6)', line: /defsAt: x => editionAt\(world, x\)\.defs/, to: l => l.replace('defsAt: x => editionAt(world, x).defs', 'defsAt: () => editionAt(world, H.inc.openedAt).defs') },
  { file: 't', op: 'edition by run date: definitions (R0, R4.3, S6)', lines: ls => ls.map(l => (/defsAt: x => editionAt\(world, x\)\.defs/.test(l) ? l.replace('defsAt: x => editionAt(world, x).defs', 'defsAt: () => editionAt(world, H.now).defs')
    : /const slas = slaTimelineOf\(world, view\.case, H, flags\);/.test(l) ? l.replace('slaTimelineOf(world, view.case, H, flags)', 'slaTimelineOf(world, view.case, { ...H, now: view.at }, flags)') : l)) },
  { file: 't', op: 'first-match precedence: priority (R2.2)', line: /return rows\.reduce\(\(a, b\) => \(b\.order < a\.order \? b : a\)\)\.priority;/, to: l => l.replace(/rows\.reduce\(.*\)\)\.priority/, 'rows[0].priority') },
  { file: 't', op: 'first-match precedence: assignment (R3.1)', line: /const g = rows\.reduce\(\(a, b\) => \(b\.order < a\.order \? b : a\)\)\.group;/, to: l => l.replace(/rows\.reduce\(.*\)\)\.group/, 'rows[0].group') },
  { file: 't', op: 'highest-order precedence: priority (R2.2)', line: /\(b\.order < a\.order \? b : a\)\)\.priority/, to: l => l.replace('b.order < a.order', 'b.order > a.order') },
  { file: 't', op: 'highest-order precedence: assignment (R3.1)', line: /\(b\.order < a\.order \? b : a\)\)\.group/, to: l => l.replace('b.order < a.order', 'b.order > a.order') },
  { file: 't', op: 'region from the CI for reports (R3.1)', line: /isAlert \? ci\.region : caller\.region/, to: l => l.replace('isAlert ? ci.region : caller.region', 'ci.region') },
  { file: 't', op: 'dedupe on CI only (R1.2, R1.3)', line: /pl\.ci !== inc\.ci \|\| pl\.check !== inc\.check/, to: l => l.replace(' || pl.check !== inc.check', '') },
  { file: 't', op: 'join after resolution (R1.3, S8)', line: /\|\| ENDED\.has\(inc\.state\)\) throw/, to: l => l.replace(' || ENDED.has(inc.state)) throw', ') throw') },
  { file: 't', op: 'every hold awaits the caller (R6.1)', line: /if \(pl\.holdReason === 'awaitingCaller'\) \{/, to: l => l.replace("if (pl.holdReason === 'awaitingCaller') {", 'if (true) {') },
  { file: 't', op: 'approval anchored at the latest P1, not the first (R7.1)', line: /if \(inc\.priority === 1 && appr\.x === null\) appr\.x = at;/, to: l => l.replace(' && appr.x === null', '') },
  { file: 't', op: 'a timeout allows a re-ask (R7.2)', line: /const REASK_CAUSES = new Set\(\[/, to: l => l.replace("'humanTask.withdrawn'])", "'humanTask.withdrawn', 'humanTask.timeout'])") },
  { file: 't', op: 'a re-ask without a cause (R7.2)', line: /\|\| !appr\.causes\.length\) return;/, to: l => l.replace(' || !appr.causes.length) return;', ') return;') },
  { file: 't', op: 'an answer to any task counts (R7.2)', line: /if \(!appr\.taskKeys\.has\(/, to: l => l.replace(/!appr\.taskKeys\.has\([^)]*\) \|\| /, '') },
  { file: 't', op: 'an answer after the deadline counts (R7.2)', line: /\|\| a\.at > appr\.dl\) return;/, to: l => l.replace(' || a.at > appr.dl) return;', ') return;') },
  { file: 't', op: 'moot at the deadline also on resolution (S16)', line: /if \(inc\.state === 'closed' \|\| inc\.state === 'cancelled'\) appr\.moot = at;/, to: l => l.replace("if (inc.state === 'closed' || inc.state === 'cancelled') appr.moot = at;", 'if (ENDED.has(inc.state) || inc.priority !== 1) appr.moot = at;') },
  { file: 't', op: 'SoD exclusion dropped (R7.1)', line: /mustExclude: inc\.callerId \? \[inc\.callerId\] : \[\]/, to: l => l.replace('mustExclude: inc.callerId ? [inc.callerId] : []', 'mustExclude: []') },
  { file: 't', op: 'recipient fixed at attach (R5.2)', line: /const to = recipient\(th\.notify, anchor\);/, to: l => l.replace('recipient(th.notify, anchor)', 'recipient(th.notify, x)') },
  { file: 't', op: 'recipient at the threshold instant, not the due instant (R5.2, S12)', line: /const to = recipient\(th\.notify, anchor\);/, to: l => l.replace('recipient(th.notify, anchor)', 'recipient(th.notify, th.at)') },
  { file: 't', op: 'recipient of the current group (R5.2)', line: /const g = R\.groups\.get\(groupAtInstant\(x\)\);/, to: l => l.replace('R.groups.get(groupAtInstant(x))', 'R.groups.get(inc.group)') },
  { file: 't', op: 'escalations skipped when reached before attach (S12)', line: /if \(th\.at === null\) continue;/, to: l => l.replace('if (th.at === null) continue;', 'if (th.at === null || th.at < x) continue;') },
  { file: 't', op: 'escalation window from the threshold, not the attach (R5.1, S12)', line: /th\.at <= x \? winAt\(x\) : winOf\(th\.at, null\)/, to: l => l.replace('th.at <= x ? winAt(x) : winOf(th.at, null)', 'winOf(th.at, null)') },
  { file: 't', op: 'breach window from D, not the attach (R4.5)', line: /s\.D <= x \? winAt\(x\) : winOf\(s\.D, null\)/, to: l => l.replace('s.D <= x ? winAt(x) : winOf(s.D, null)', 'winOf(s.D, null)') },
  { file: 't', op: 'breach not ordered before the end (R4.5)', line: /, W, \[L\('breach'\)\]\);/, all: true, to: l => l.replace(", W, [L('breach')]);", ', W);') },
  { file: 't', op: 'SLA records not in lifecycle order (R4.5)', line: /push\(id, 'R4\.5', 'sla', op, match, \{\}, window, \[prev, \.\.\.extraAfter\]\);/, to: l => l.replace('[prev, ...extraAfter]', '[...extraAfter]') },
  { file: 't', op: 'records not after create (R8.2)', line: /l\.id === createLid \? \[\] : \[createLid\]\);/, to: l => l.replace('l.id === createLid ? [] : [createLid]);', '[]);') },
  { file: 't', op: 'go-live records before t0 required again (E7-B5)', line: /const pre = x => H\.backlog && x < H\.t0;/, to: l => l.replace('H.backlog && x < H.t0', 'false') },
  // sla.mjs ----------------------------------------------------------------------------------------------------------
  { file: 'e', op: 'breach boundary inclusive (R4.6, S2)', line: /s\.breached = s\.end !== null && s\.D !== null;/, to: l => l.replace('s.end !== null && s.D !== null;', 's.end !== null && s.D !== null && s.D < s.end.at;') },
  { file: 'e', op: 'holidays dropped (R4.4)', line: /cal = structuredClone\(\{ \.\.\.src, tz \}\);/, to: l => l.replace('{ ...src, tz }', '{ ...src, tz, holidays: [] }') },
  { file: 'e', op: 'calendar dropped: every schedule 24x7 (R4.3, R4.4)', line: /cal = boundCalendar\(ctx\.world, schedule, timezone\);/, to: l => l.replace('cal = boundCalendar(ctx.world, schedule, timezone);', 'cal = null;') },
  { file: 'e', op: 'calendar zone swapped to the system zone (R4.3)', line: /cal = boundCalendar\(ctx\.world, schedule, timezone\);/, to: l => l.replace('boundCalendar(ctx.world, schedule, timezone)', "boundCalendar(ctx.world, schedule, 'Europe/Amsterdam')") },
  { file: 'e', op: "a calendar's own zone ignored (R4.3)", line: /if \(raw\.tz\) timezone = raw\.tz;/, to: l => l.replace('if (raw.tz)', 'if (false)') },
  { file: 'e', op: 'schedule swap: service schedule from the group (R4.3)', line: /schedule = ctx\.scheduleOf\.service\(F\.service\);/, to: l => l.replace('ctx.scheduleOf.service(F.service)', 'ctx.scheduleOf.group(F.assignmentGroup)') },
  { file: 'e', op: "schedule swap: group schedule from the service (R4.3)", line: /schedule = ctx\.scheduleOf\.group\(F\.assignmentGroup\);/, to: l => l.replace('ctx.scheduleOf.group(F.assignmentGroup)', 'ctx.scheduleOf.service(F.service)') },
  { file: 'e', op: 'pause condition deleted at attach (R4.3, S14)', line: /^\s*if \(def\.pause\) \{$/, nth: 0, to: l => l.replace('if (def.pause) {', 'if (false) {') },
  { file: 'e', op: 'pause condition deleted (R4.2)', line: /^\s*if \(def\.pause\) \{$/, nth: 1, to: l => l.replace('if (def.pause) {', 'if (false) {') },
  { file: 'e', op: 'pause on any hold (R4.1, R4.2)', line: /holds\(def\.pause\.when, (F|sn\.fields)\)/, all: true, to: l => l.replace(/holds\(def\.pause\.when, (F|sn\.fields)\)/, (_, f) => `(${f}.state === 'onHold')`) },
  { file: 'e', op: 'retroactive start dropped (R4.3)', line: /const retro = def\.start\.from === 'openedAt';/, to: l => l.replace("def.start.from === 'openedAt'", 'false') },
  { file: 'e', op: 'retroactive pause dropped (R4.3)', line: /if \(retro && def\.start\.retroactivePause\) \{/, to: l => l.replace('retro && def.start.retroactivePause', 'false') },
  { file: 'e', op: 'attaches running when its pause condition holds (S14)', line: /if \(pausedAtX\) \{ s\.ops\.push/, to: l => l.replace('if (pausedAtX) {', 'if (false) {') },
  { file: 'e', op: 'reset dropped (R4.2)', line: /const rf = def\.reset\?\.onChangeOf;/, nth: 0, to: l => l.replace('def.reset?.onChangeOf', 'null') },
  { file: 'e', op: 'reset attach dropped (R4.2)', line: /const rf = def\.reset\?\.onChangeOf;/, nth: 1, to: l => l.replace('def.reset?.onChangeOf', 'null') },
  { file: 'e', op: 'reset re-attach unconditional (S15)', line: /if \(holds\(now\.start\.when, F\) && !holds\(now\.stop\?\.when, F\)\) attach\(now, x, F\);/, to: l => l.replace('if (holds(now.start.when, F) && !holds(now.stop?.when, F)) attach(now, x, F);', 'attach(now, x, F);') },
  { file: 'e', op: 'reset re-attach in the old edition (S15, R0)', line: /const now = ctx\.defsAt\(x\)\.find\(d => d\.id === def\.id\) \?\? def;/, to: l => l.replace('ctx.defsAt(x).find(d => d.id === def.id) ?? def', 'def') },
  { file: 'e', op: 'edition by startAt for retroactive SLAs (S6)', line: /flags\.editionAtStart && def0\.start\.from === 'openedAt'/, to: l => l.replace('flags.editionAtStart && ', '') },
  { file: 'e', op: 'R4.2 order: stop before cancel (S5)', lines: ls => {
    const i = ls.findIndex(l => /if \(holds\(def\.cancel\?\.when, F\)\) \{ close\(s, 'cancel', x, 'cancelled'\); continue; \}/.test(l));
    if (i < 0 || !/close\(s, 'stop', x\)/.test(ls[i + 2] ?? '')) return ls;
    const out = [...ls]; out[i] = ls[i + 2]; out[i + 1] = ls[i]; out[i + 2] = ls[i + 1]; return out;
  } },
  { file: 'e', op: "cancel reason swapped: 'start-failed' for a cancel condition (R4.2)", line: /close\(s, 'cancel', x, 'cancelled'\)/, to: l => l.replace("close(s, 'cancel', x, 'cancelled')", "close(s, 'cancel', x, 'start-failed')") },
  { file: 'e', op: "cancel reason swapped: 'cancelled' for a failed start (R4.2)", line: /close\(s, 'cancel', x, 'start-failed'\)/, to: l => l.replace("close(s, 'cancel', x, 'start-failed')", "close(s, 'cancel', x, 'cancelled')") },
  { file: 'e', op: 'attach ignores the stop condition (R4.2)', line: /\|\| active\(def\.id\) \|\| holds\(def\.stop\?\.when, F\)\) continue;/, to: l => l.replace(' || holds(def.stop?.when, F)) continue;', ') continue;') },
  { file: 'e', op: 'generation counts every SLA (R4.3)', line: /const generation = 1 \+ slas\.filter\(s => s\.definition === def\.id\)\.length;/, to: l => l.replace('slas.filter(s => s.definition === def.id).length', 'slas.length') },
  { file: 'e', op: 'conditions: any instead of every (R4.1)', line: /when\.every\(c =>/, to: l => l.replace('when.every(c =>', 'when.some(c =>') },
  { file: 'e', op: 'null and a missing field differ (R4.1)', line: /const sameValue = \(a, b\) => \(a \?\? null\) === \(b \?\? null\);/, to: l => l.replace('(a ?? null) === (b ?? null)', 'a === b') },
  { file: 'e', op: 'D anchored at attach (R4.3)', line: /ops: \[\{ op: 'start', at: startAt, x \}\]/, to: l => l.replace("{ op: 'start', at: startAt, x }", "{ op: 'start', at: x, x }") },
  { file: 'e', op: 'start record plans the current D (S13)', line: /s\.planned = \{ start: position\(s\.cal, s\.startAt, s\.targetMs\)/, to: l => l.replace('start: position(s.cal, s.startAt, s.targetMs)', 'start: s.D') },
  { file: 'e', op: 'start record plans from the attach (S13)', line: /s\.planned = \{ start: position\(s\.cal, s\.startAt, s\.targetMs\)/, to: l => l.replace('position(s.cal, s.startAt, s.targetMs)', 'position(s.cal, s.attachAt, s.targetMs)') },
  { file: 'e', op: 'resume plans without the earlier running time (S13)', line: /const before = segs\.filter\(\(\[a, b\]\) => b !== null && b <= o\.at\);/, to: l => l.replace(/segs\.filter\(.*\);/, '[];') },
  { file: 'e', op: 'thresholds after the end kept (R5.1, S3)', line: /if \(at !== null && s\.end && at > s\.end\.at/, to: l => l.replace('if (at !== null && s.end && at > s.end.at', 'if (false && at !== null && s.end && at > s.end.at') },
  { file: 'e', op: '100% threshold computed apart from D (R5.1)', line: /let at = need >= s\.targetMs \? s\.D : reachAt\(s\.cal, segs, need\);/, to: l => l.replace('need >= s.targetMs ? s.D : reachAt(s.cal, segs, need)', 'reachAt(s.cal, segs, need)') },
  { file: 'e', op: 'elapsed counts paused time (R4.5)', line: /s\.elapsedMinutes = ran\.reduce\(/, to: l => l.replace(/ran\.reduce\(.*\) \/ MIN;/, '(s.end.at - s.startAt) / MIN;') },
];

/** Whether a module text parses (imports and exports stripped; the modules use neither top-level await nor eval). */
function parses(text) {
  const body = text.split('\n').map(l => (/^import\s/.test(l) ? '' : l.replace(/^export\s+(?=(const|function|async|let|class)\b)/, ''))).join('\n');
  try { new vm.Script(`(function () {\n${body}\n})`); return true; } catch { return false; }
}

/**
 * mutantsOf(sources = { t, e }) -> [{ id, file, line (1-based), op, from, to, lines: [{ i, to }], aliases }]: the mutant
 * set, ordered by file (transition, then sla), then line, then operator; ids are t<n> / e<n> in that order.
 */
export function mutantsOf(sources = { t: readFileSync(path.join(E7, FILES.t), 'utf8'), e: readFileSync(path.join(E7, FILES.e), 'utf8') }) {
  const all = [];
  const notApplied = [], invalid = [];
  for (const file of ['t', 'e']) {
    const src = sources[file];
    const lines = src.split('\n');
    const raw = [];
    let inDoc = false;
    lines.forEach((ln, i) => {
      const t = ln.trim();
      if (t.startsWith('/*')) inDoc = !t.includes('*/');
      else if (inDoc) { if (t.includes('*/')) inDoc = false; return; }
      if (inDoc || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('import ') || t === '') return;
      const { end, mask } = scan(ln);
      const inCode = (a, b) => b <= end && mask.slice(a, b).every(Boolean);
      for (const [op, re, rep] of GENERIC) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(ln)) !== null) {
          if (!inCode(m.index, m.index + m[0].length)) continue;
          const sub = typeof rep === 'function' ? rep(m[0]) : m[0].replace(new RegExp(re.source), rep);
          const to = ln.slice(0, m.index) + sub + ln.slice(m.index + m[0].length);
          if (to !== ln) raw.push({ op, line: i, edits: [{ i, to }] });
        }
      }
      for (const s of statements(ln)) {
        const body = s.text.trim().replace(/;$/, '').trim();
        // statement deletion: a required record, a state change or a bookkeeping step never taken
        if (DELETABLE.test(body) && !KEYWORD.test(body)) {
          const lead = s.text.length - s.text.trimStart().length;
          raw.push({ op: 'statement deletion', line: i, edits: [{ i, to: ln.slice(0, s.start + lead) + 'void 0;' + ln.slice(s.end) }] });
        }
      }
      // deleted guard: `if (C) return|continue|break ...` or `if (C) { ...; return|continue; }` -> `if (false) ...`
      // (input-validation throws are not business guards and stay)
      const { mask: mk } = scan(ln);
      const guardRe = /\bif \(/g;
      let g;
      while ((g = guardRe.exec(ln)) !== null) {
        if (!mk[g.index] || /else\s*$/.test(ln.slice(0, g.index))) continue;
        const close = closeParen(ln, g.index + 3, mk);
        if (close < 0) continue;
        const rest = ln.slice(close).trim();
        const exits = /^(return|continue|break)\b/.test(rest) || (/^\{/.test(rest) && /\b(return|continue|break)\b[^;]*;\s*\}/.test(rest));
        if (!exits || /^\{?\s*throw\b/.test(rest)) continue;
        raw.push({ op: 'deleted guard', line: i, edits: [{ i, to: ln.slice(0, g.index) + 'if (false)' + ln.slice(close) }] });
      }
    });
    for (const n of NAMED.filter(x => x.file === file)) {
      let next;
      if (n.lines) next = n.lines(lines);
      else {
        const hits = lines.map((l, i) => (n.line.test(l) ? i : -1)).filter(i => i >= 0);
        const pick = n.all ? hits : hits.length > (n.nth ?? 0) && (n.nth !== undefined || hits.length === 1) ? [hits[n.nth ?? 0]] : [];
        next = [...lines];
        for (const i of pick) next[i] = n.to(lines[i]);
      }
      const edits = next.map((l, i) => ({ i, to: l })).filter(({ i, to }) => to !== lines[i]);
      if (!edits.length || next.length !== lines.length) { notApplied.push(`${FILES[file]}: ${n.op}`); continue; }
      raw.push({ op: n.op, line: edits[0].i, edits, named: true });
    }
    raw.sort((a, b) => a.line - b.line || (a.named ? 1 : 0) - (b.named ? 1 : 0));
    const seen = new Map();
    let n = 0;
    for (const m of raw) {
      const out = [...lines];
      for (const ed of m.edits) out[ed.i] = ed.to;
      const text = out.join('\n');
      if (text === src) continue;
      if (!parses(text)) { invalid.push(`${FILES[file]}:${m.line + 1} [${m.op}]`); continue; }
      const h = sha(text);
      if (seen.has(h)) { seen.get(h).aliases.push(m.op); continue; }
      const mu = { id: `${file}${++n}`, file, line: m.line + 1, op: m.op, from: lines[m.line], to: m.edits[0].to, lines: m.edits, aliases: [], sha: h.slice(0, 12) };
      seen.set(h, mu);
      all.push(mu);
    }
  }
  return Object.assign(all, { notApplied, invalid });
}

/** The mutant's module text. */
export function applyMutant(src, m) {
  const lines = src.split('\n');
  for (const ed of m.lines) lines[ed.i] = ed.to;
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// Mutant module sets: transition, sla and index re-imported over each other with every other import absolute.

const absolute = (src, dir, overrides) => src.replace(/(from\s+|import\s*\(\s*)'(\.\.?\/[^']+)'/g, (all, kw, spec) => {
  const target = path.resolve(dir, spec);
  return `${kw}'${overrides[target] ?? pathToFileURL(target).href}'`;
});

/** Write the module set of one mutant (or of the original, m = null) under dir; returns the URLs to import. */
export function writeModuleSet(dir, m, sources) {
  mkdirSync(dir, { recursive: true });
  const tSrc = m?.file === 't' ? applyMutant(sources.t, m) : sources.t;
  const eSrc = m?.file === 'e' ? applyMutant(sources.e, m) : sources.e;
  const slaFile = path.join(dir, 'sla.mjs'), trFile = path.join(dir, 'transition.mjs'), idxFile = path.join(dir, 'index.mjs');
  writeFileSync(slaFile, absolute(eSrc, E7, {}));
  writeFileSync(trFile, absolute(tSrc, E7, { [path.join(E7, 'sla.mjs')]: pathToFileURL(slaFile).href }));
  const HERE = 'const here = path.dirname(fileURLToPath(import.meta.url));';
  if (!sources.index.includes(HERE)) throw new Error('index.mjs: the `here` line moved; update writeModuleSet');
  writeFileSync(idxFile, absolute(sources.index.replace(HERE, `const here = ${JSON.stringify(E7)};`), E7, { [path.join(E7, 'transition.mjs')]: pathToFileURL(trFile).href }));
  return { transition: pathToFileURL(trFile).href, index: pathToFileURL(idxFile).href };
}

// ---------------------------------------------------------------------------------------------------------------------
// The corpus: journals on dev worlds, reduced to the distinct case contents the grader reads.

/**
 * A case's content reduced to what the grader, the transition, recordsOf and critical read (oracle/grade.mjs gradeCase,
 * oracle/view.mjs caseView): a call keeps its outcome, error, instance and decisions and whether it emitted effects, tasks
 * or wake-ups, closed or merged (gradeCase reads nothing else of it; the carry and the events it was given are dropped).
 */
function reduceBucket(b) {
  const out = o => (o ? { decisions: o.decisions ?? null, close: o.close ?? null, merge: o.merge ? 1 : null, effects: o.effects?.length ? [0] : [], humanTasks: o.humanTasks?.length ? [0] : [],
    obligations: { upsert: o.obligations?.upsert?.length ? [0] : [] } } : null);
  // Instance ids are journal-wide counters; within a case they are only compared for equality (task and answer keys,
  // the instance named in a divergence), so they are renamed by first appearance in the case's own order.
  const items = [...b.deliveries, ...b.calls, ...b.ledger, ...b.tasks, ...b.taskEvents].sort((x, y) => x.seq - y.seq);
  const names = new Map();
  for (const x of items) if (x.instance !== null && x.instance !== undefined && !names.has(x.instance)) names.set(x.instance, `I${names.size + 1}`);
  const I = v => (v === null || v === undefined ? v : names.get(v) ?? v);
  return {
    deliveries: b.deliveries.map(d => ({ ...d, instance: I(d.instance) })),
    ledger: b.ledger.map(r => ({ ...r, instance: I(r.instance) })),
    tasks: b.tasks.map(t => ({ ...t, instance: I(t.instance) })),
    taskEvents: b.taskEvents.map(e => ({ ...e, instance: I(e.instance) })),
    calls: b.calls.map(k => ({ seq: k.seq, at: k.at, instance: I(k.instance), round: k.round, outcome: k.outcome, error: k.error ?? null, output: out(k.output) })),
  };
}

/** A case's content as the grader reads it, with journal sequence numbers replaced by their rank. */
function bucketKey(b) {
  const seqs = new Set();
  const walk = (x, k) => {
    if (k === 'seq' && typeof x === 'number') { seqs.add(x); return; }
    if (x && typeof x === 'object') for (const [kk, v] of Object.entries(x)) walk(v, kk);
  };
  walk(b, null);
  const rank = new Map([...seqs].sort((a, c) => a - c).map((s, i) => [s, i]));
  return JSON.stringify(b, function (k, v) {
    if (k === 'emission') return undefined;
    if (k === 'seq' && typeof v === 'number') return rank.get(v);
    if (v instanceof Set) return { $set: [...v].sort() };
    return v;
  });
}
const revive = (k, v) => (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && Array.isArray(v.$set) ? new Set(v.$set) : v);
const serial = (k, v) => (v instanceof Set ? { $set: [...v] } : v);

function parseWorlds(s) {
  return s.split(',').map(x => {
    const [seed, d, size] = x.split(':').map(Number);
    if (!Number.isInteger(seed) || seed < 1001 || seed > 1199) throw new Error(`seed ${seed} refused: E7 mutation suites run on dev seeds 1001-1199 (DESIGN §13)`);
    if (![1, 2, 3, 4, 5].includes(d)) throw new Error(`difficulty ${d}`);
    return { seed, d, size: Number.isFinite(size) ? size : null };
  });
}

/**
 * Build (or load) the corpus: per world, both reference runs, every control and every specificity solver; then the
 * distinct case contents, with their world, case, pool and the journals that share them. Cached under <work>/corpus/.
 */
async function corpusOf({ worlds, work, controls = true, specificity = true, log = console.log }) {
  const { generateWorld, referenceRuns } = await import('../index.mjs');
  const { CONTROLS, runControl } = await import('../controls.mjs');
  const { sandboxArm } = await import('../../host/sandbox-arm.mjs');
  const { createHost } = await import('../../host/host.mjs');
  const { binding } = await import('../index.mjs');
  const { indexJournal, caseIds } = await import('../../oracle/view.mjs');
  const specDir = path.join(E7, 'specificity');
  const solvers = specificity && existsSync(specDir) ? readdirSync(specDir).filter(f => f.endsWith('.mjs')).sort().map(f => ({ f, src: readFileSync(path.join(specDir, f), 'utf8') })) : [];
  const oracleSrc = ['transition.mjs', 'sla.mjs', 'index.mjs', 'world.mjs', 'systems.mjs', 'actors.mjs', 'controls.mjs'].map(f => readFileSync(path.join(E7, f), 'utf8')).join('\n');
  const key = sha(JSON.stringify({ worlds, controls, solvers: solvers.map(s => [s.f, sha(s.src)]), oracle: sha(oracleSrc) })).slice(0, 16);
  const dir = path.join(work, 'corpus', key);
  const bucketsFile = path.join(dir, 'buckets.json');
  if (existsSync(bucketsFile)) { log(`corpus: cached ${path.relative(REPO, dir)}`); return { bucketsFile, meta: JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8')) }; }
  mkdirSync(dir, { recursive: true });
  const meta = { key, worlds, solvers: solvers.map(s => ({ file: s.f, sha256: sha(s.src) })), journals: [], cases: 0, gradings: 0, distinct: 0 };
  const buckets = new Map();             // key -> { w, c, pool, journals: [] }
  const order = [];
  for (const [wi, spec] of worlds.entries()) {
    const t0 = Date.now();
    const w = generateWorld({ seed: spec.seed, difficulty: spec.d, mix: 'tail', ...(spec.size ? { size: spec.size } : {}) });
    const r = await referenceRuns(w);
    const journals = [{ name: 'ref-earliest', rows: r.runs.earliest.rows }, { name: 'ref-latest', rows: r.runs.latest.rows }];
    if (controls) for (const c of CONTROLS) if ((c.minDifficulty ?? 1) <= spec.d) journals.push({ name: c.id, rows: await runControl(c.id, w) });
    for (const s of solvers) {
      const arm = sandboxArm({ id: s.f, solverSource: s.src, timeoutMs: 20_000 });
      const host = createHost({ item: binding, world: w, arm, callTimeoutMs: 25_000 });
      try { await host.run(); } catch (e) { log(`  ${s.f}: host error ${String(e?.message ?? e).slice(0, 120)}`); } finally { arm.close(); }
      journals.push({ name: s.f, rows: host.journal.contentRows() });
    }
    const ids = caseIds(w);
    for (const j of journals) {
      // Indexed with the identity normaliser: the grader's canonicalArgs (the mutant's own) is applied per mutant.
      const idx = indexJournal(w, j.rows, { canonicalArgs: (s, o, a) => a });
      let fresh = 0;
      for (const c of ids) {
        const b = reduceBucket(idx.bucket(c));
        const k = `${wi}|${c}|${bucketKey(b)}`;
        const h = sha(k);
        meta.gradings += 1;
        if (!buckets.has(h)) { buckets.set(h, { w: wi, c, pool: r.pools[c] ?? null, journals: [], bucket: JSON.stringify(b, serial) }); order.push(h); fresh += 1; }
        buckets.get(h).journals.push(`${j.name}@${spec.seed}:${spec.d}`);
      }
      meta.journals.push({ world: wi, name: j.name, rows: j.rows.length, distinctCases: fresh, rowsSha256: sha(JSON.stringify(j.rows)).slice(0, 16) });
    }
    meta.cases += ids.length;
    log(`corpus: world ${spec.seed}:${spec.d}${spec.size ? `:${spec.size}` : ''}: ${ids.length} cases, ${journals.length} journals, ${Math.round((Date.now() - t0) / 1000)} s; distinct case contents so far ${order.length}`);
  }
  // Reference runs first (the most common contents), then by world and case: kills are usually found early.
  const prio = h => (buckets.get(h).journals.some(j => j.startsWith('ref-')) ? 0 : 1);
  order.sort((a, b) => prio(a) - prio(b));
  meta.distinct = order.length;
  writeFileSync(bucketsFile, JSON.stringify(order.map(h => { const x = buckets.get(h); return { h: h.slice(0, 16), w: x.w, c: x.c, pool: x.pool, journals: x.journals, bucket: x.bucket }; })));
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
  return { bucketsFile, meta };
}

// ---------------------------------------------------------------------------------------------------------------------
// Worker: grades the corpus and runs the goldens under one mutant module set at a time.

async function workerMain() {
  const { generateWorld } = await import('../world.mjs');
  const { gradeCase } = await import('../../oracle/grade.mjs');
  const { runGoldens } = await import('../golden.mjs');
  const { bucketsFile, worlds, baseline } = workerData;
  const W = worlds.map(s => generateWorld({ seed: s.seed, difficulty: s.d, mix: 'tail', ...(s.size ? { size: s.size } : {}) }));
  const B = bucketsFile ? JSON.parse(readFileSync(bucketsFile, 'utf8')).map(x => ({ ...x, bucket: JSON.parse(x.bucket, revive) })) : [];
  const EMPTY = { deliveries: [], ledger: [], tasks: [], taskEvents: [], calls: [] };
  const fd = v => (v.firstDivergence ? `${v.firstDivergence.layer}/${v.firstDivergence.code}/${v.firstDivergence.lid ?? v.firstDivergence.field ?? ''}` : '');
  const sigOf = v => `${v.pool === 'completed' ? `${v.pass ? 1 : 0}${v.oracleError ? 'E' : ''}:${fd(v)}` : '-'}|${v.critical.map(x => x.code).sort().join(',')}`;
  /**
   * Grade bucket i under an item. The bucket's ledger args go through the item's canonicalArgs: the original's once for
   * every mutant that leaves canonicalArgs and utc alone (`shared`), the mutant's own, per mutant and never kept, for one
   * that changes them (a cache keyed by a mutant's item would live as long as its module, i.e. for the worker's life).
   */
  const canon = (fn, x) => ({ ...x.bucket, ledger: x.bucket.ledger.map(r => ({ ...r, args: fn(r.system, r.op, structuredClone(r.args)) })) });   // a mutant may write into its input
  const { canonicalArgs: originalCanon } = await import('../transition.mjs');
  const shared = B.map(x => canon(originalCanon, x));
  const grade = (item, worldsFor, i, own = false) => {
    const x = B[i];
    const b = own ? canon(item.canonicalArgs, x) : shared[i];
    const world = worldsFor[x.w];
    const idx = { world: W[x.w], horizonMs: Date.parse(W[x.w].horizonEnd), bucket: cc => (cc === x.c ? b : EMPTY) };
    return sigOf(gradeCase({ item, world, idx, c: x.c, pool: x.pool }));
  };
  const freshWorlds = () => W.map(w => Object.create(w));   // per-mutant world handles: the mutant's caches die with them
  let base = baseline;
  if (!base) {
    const { oracleItem } = await import('../index.mjs');
    const t0 = Date.now();
    const wf = freshWorlds();
    base = B.map((_, i) => grade(oracleItem, wf, i));
    parentPort.postMessage({ type: 'baseline', sigs: base, ms: Date.now() - t0 });
  }
  parentPort.postMessage({ type: 'ready', buckets: B.length });
  parentPort.on('message', async msg => {
    if (msg.type !== 'mutant') return;
    const t0 = Date.now();
    const out = { type: 'result', id: msg.id, goldenFails: [], corpus: null, error: null };
    try {
      const mod = await import(msg.urls.transition);
      const idxMod = await import(msg.urls.index);
      const gold = runGoldens(mod.referenceTransition, mod.recordsOf, mod.canonicalArgs).filter(g => !g.pass);
      out.goldenFails = gold.map(g => ({ name: g.name, detail: String(g.detail).slice(0, 300) }));
      out.goldenMs = Date.now() - t0;
      if (!msg.goldenOnly && (!gold.length || msg.corpusAlways)) {
        parentPort.postMessage({ type: 'phase', id: msg.id, phase: 'corpus' });
        const t1 = Date.now();
        const item = idxMod.oracleItem;
        const wf = freshWorlds();
        let first = null, diffs = 0, graded = 0;
        for (let i = 0; i < B.length; i++) {
          let s;
          try { s = grade(item, wf, i, !!msg.canonical); } catch (e) { s = `THROW ${String(e?.message ?? e).slice(0, 120)}`; }
          graded += 1;
          if (s !== base[i]) {
            diffs += 1;
            if (!first) first = { case: B[i].c, world: B[i].w, journals: B[i].journals.slice(0, 4), shared: B[i].journals.length, base: base[i], mutant: s };
            if (!msg.allDiffs) break;
          }
        }
        out.corpus = { first, diffs, graded, of: B.length, ms: Date.now() - t1 };
      }
    } catch (e) { out.error = String(e?.stack ?? e).slice(0, 400); }
    out.ms = Date.now() - t0;
    parentPort.postMessage(out);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Main: corpus, then mutants through a worker pool with a time limit and recycling.

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const flag = k => argv.includes(k);
  const sources = { t: readFileSync(path.join(E7, FILES.t), 'utf8'), e: readFileSync(path.join(E7, FILES.e), 'utf8'), index: readFileSync(path.join(E7, 'index.mjs'), 'utf8') };
  let set = mutantsOf(sources);
  const total = set.length;
  if (set.notApplied.length) console.log(`named operators that did not apply: ${set.notApplied.join('; ')}`);
  if (set.invalid.length) console.log(`${set.invalid.length} generated edits do not parse and are not mutants: ${set.invalid.join('; ')}`);
  if (flag('--list')) {
    for (const m of set) console.log(`${m.id.padEnd(5)} ${FILES[m.file]}:${m.line} [${m.op}${m.aliases.length ? ` = ${m.aliases.join(', ')}` : ''}]\n      - ${m.from.trim().slice(0, 160)}\n      + ${m.to.trim().slice(0, 160)}`);
    const by = {};
    for (const m of set) by[m.op] = (by[m.op] ?? 0) + 1;
    console.log(`${set.length} mutants (${set.filter(m => m.file === 't').length} of transition.mjs, ${set.filter(m => m.file === 'e').length} of sla.mjs)`, JSON.stringify(by));
    return;
  }
  const only = arg('--only', null);
  if (only) { const ids = new Set(only.split(',')); set = set.filter(m => ids.has(m.id)); }
  const sampleN = arg('--sample', null);
  if (sampleN !== null) {
    // A seeded, file-stratified systematic sample (reported as a sample).
    const n = Number(sampleN), seedS = Number(arg('--sample-seed', '1'));
    const keep = new Set();
    let h = seedS;
    const rand = () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return h / 2 ** 32; };
    const shuffled = set.map(m => [rand(), m]).sort((a, b) => a[0] - b[0]).map(([, m]) => m);
    for (const m of shuffled.slice(0, n)) keep.add(m.id);
    set = set.filter(m => keep.has(m.id));
  }
  const limit = Number(arg('--limit', String(set.length)));
  set = set.slice(0, limit);
  const work = path.resolve(REPO, arg('--work', '.foundry/e7-mutate'));
  mkdirSync(work, { recursive: true });
  const worlds = parseWorlds(arg('--worlds', '1009:3:60,1010:5:60,1011:4:60,1012:2:60'));
  const goldenOnly = flag('--golden-only');
  const corpus = goldenOnly ? null : await corpusOf({ worlds, work, controls: !flag('--no-controls'), specificity: !flag('--no-specificity') });
  if (corpus) console.log(`corpus: ${corpus.meta.journals.length} journals over ${worlds.length} worlds (${corpus.meta.solvers.length} specificity solvers): ${corpus.meta.gradings} case gradings, ${corpus.meta.distinct} distinct case contents`);

  // Self-check: the identity module set (the original re-imported through writeModuleSet) must equal the original.
  const runId = sha(JSON.stringify({ t: sha(sources.t), e: sha(sources.e), corpus: corpus?.meta.key ?? 'golden-only' })).slice(0, 12);
  const resultsFile = path.join(work, `results-${runId}.jsonl`);
  const done = new Map();
  if (flag('--resume') && existsSync(resultsFile)) for (const l of readFileSync(resultsFile, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); done.set(r.id, r); }
  else writeFileSync(resultsFile, '');
  const queue = [{ id: 'identity', file: null }, ...set.filter(m => !done.has(m.id))];
  const modDir = path.join(work, 'modules');
  rmSync(modDir, { recursive: true, force: true });
  const timeoutMs = Number(arg('--timeout', '0')) * 1000;
  const goldenLimit = Number(arg('--golden-timeout', '60')) * 1000;
  // Lines of transition.mjs whose mutants change what the grader's index reads (utc .. canonicalArgs): graded with their
  // own canonicalArgs over the raw rows.
  const tLines = sources.t.split('\n');
  const canonSpan = [tLines.findIndex(l => l.startsWith('export const utc')), tLines.findIndex((l, i) => i > tLines.findIndex(x => x.startsWith('export function canonicalArgs')) && l === '}')];
  if (canonSpan.some(i => i < 0)) throw new Error('transition.mjs: utc/canonicalArgs not found');
  const corpusLimit = () => timeoutMs || Math.max(1_200_000, 60 * (baseMs ?? 30_000));   // cache-disabling mutants are slow, not wrong
  const recycle = Number(arg('--recycle', '30'));
  const jobs = Math.max(1, Number(arg('--jobs', '1')));
  let baseline = null, baseMs = null;
  const results = new Map(done);
  const t0 = Date.now();
  let finished = 0;
  const allDiffs = flag('--all-diffs');
  const corpusAlways = flag('--corpus-always');

  const classify = (m, r) => {
    if (r.timeout) return { killed: true, by: 'timeout' };
    if (r.error) return { killed: true, by: `error:${r.error.split('\n')[0].slice(0, 80)}` };
    if (r.goldenFails.length) return { killed: true, by: `golden:${r.goldenFails[0].name ?? r.goldenFails[0]}` };
    if (r.corpus?.first) return { killed: true, by: `corpus:${r.corpus.first.journals[0]}/${r.corpus.first.case}` };
    return { killed: false, by: null };
  };

  await new Promise((resolve, reject) => {
    const slots = [];
    const next = () => queue.shift();
    const spawn = slot => {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { role: 'e7-mutate-worker', bucketsFile: corpus?.bucketsFile ?? null, worlds, baseline: corpus ? baseline : [] },
        resourceLimits: { maxOldGenerationSizeMb: Number(arg('--heap-mb', goldenOnly ? '768' : '2048')) }, execArgv: [] });
      slot.worker = w; slot.count = 0; slot.current = null; slot.ready = false;
      w.on('message', msg => {
        if (msg.type === 'baseline') { baseline = msg.sigs; baseMs = msg.ms; console.log(`baseline: ${msg.sigs.length} case contents graded in ${Math.round(msg.ms / 1000)} s`); }
        else if (msg.type === 'ready') { slot.ready = true; dispatch(slot); }
        else if (msg.type === 'phase' && slot.current?.id === msg.id) arm(slot, corpusLimit());
        else if (msg.type === 'result') finish(slot, msg);
      });
      w.on('error', e => { if (slot.current) finish(slot, { type: 'result', id: slot.current.id, goldenFails: [], corpus: null, error: `worker: ${String(e?.message ?? e)}` }, true); else reject(e); });
      w.on('exit', () => { if (slot.worker === w && slot.current && !slot.closing) finish(slot, { type: 'result', id: slot.current.id, goldenFails: [], corpus: null, error: 'worker exited' }, true); });
    };
    const dispatch = slot => {
      if (slot.current) return;
      if (slot.count >= recycle) { slot.closing = true; slot.worker.terminate(); slot.closing = false; return spawn(slot); }
      const m = next();
      if (!m) { slot.closing = true; slot.worker.terminate(); slot.done = true; if (slots.every(s => s.done)) resolve(); return; }
      if (m.id !== 'identity' && !baseline && corpus) { queue.unshift(m); setTimeout(() => dispatch(slot), 500); return; }
      slot.current = m; slot.count += 1;
      const urls = writeModuleSet(path.join(modDir, m.id), m.file ? m : null, sources);
      slot.started = Date.now();
      arm(slot, m.id === 'identity' ? corpusLimit() : goldenLimit);
      slot.worker.postMessage({ type: 'mutant', id: m.id, urls, goldenOnly, corpusAlways: corpusAlways || m.id === 'identity', allDiffs: allDiffs || m.id === 'identity',
        canonical: m.id === 'identity' || (m.file === 't' && m.lines.some(ed => ed.i >= canonSpan[0] && ed.i <= canonSpan[1])) });
    };
    /** (Re)arm the slot's time limit: the goldens take well under a second, the corpus a multiple of the baseline pass. */
    const arm = (slot, limitMs) => {
      clearTimeout(slot.timer);
      slot.timer = setTimeout(() => {
        const cur = slot.current;
        slot.closing = true; slot.worker.terminate(); slot.closing = false;
        finish(slot, { type: 'result', id: cur.id, goldenFails: [], corpus: null, error: null, timeout: true }, true);
      }, limitMs);
    };
    const finish = (slot, r, respawn = false) => {
      clearTimeout(slot.timer);
      if (r.ms === undefined) r.ms = Date.now() - slot.started;
      const m = slot.current;
      slot.current = null;
      if (!m) return;
      // A worker that died (memory, crash) after other mutants gets one retry in a fresh worker: what killed it may be
      // the earlier mutants' leftovers, not this one.
      if (respawn && !r.timeout && slot.count > 1 && !m.retried) { m.retried = true; queue.unshift(m); spawn(slot); return; }
      if (m.id === 'identity') {
        if (r.error || r.goldenFails.length || r.corpus?.diffs) { reject(new Error(`identity module set differs from the original: ${JSON.stringify(r).slice(0, 600)}`)); return; }
        console.log(`identity: goldens pass, corpus ${r.corpus ? `${r.corpus.diffs} differences in ${r.corpus.graded} (${Math.round(r.corpus.ms / 1000)} s)` : 'skipped'}`);
      } else {
        const rec = { id: m.id, file: FILES[m.file], line: m.line, op: m.op, aliases: m.aliases, from: m.from.trim(), to: m.to.trim(), ...classify(m, r),
          goldenFails: r.goldenFails.map(g => g.name), corpus: r.corpus, error: r.error, ms: r.ms };
        results.set(m.id, rec);
        appendFileSync(resultsFile, `${JSON.stringify(rec)}\n`);
        finished += 1;
        if (finished % 10 === 0 || finished === set.length) {
          const k = [...results.values()].filter(x => x.killed).length;
          console.log(`  ${results.size}/${set.length} mutants, killed ${k}, ${Math.round((Date.now() - t0) / 60000)} min`);
        }
      }
      rmSync(path.join(modDir, m.id), { recursive: true, force: true });
      if (respawn) spawn(slot); else dispatch(slot);
    };
    for (let k = 0; k < Math.min(jobs, queue.length); k++) { const slot = {}; slots.push(slot); spawn(slot); }
  });
  rmSync(modDir, { recursive: true, force: true });

  const rows = set.map(m => results.get(m.id)).filter(Boolean);
  const killed = rows.filter(r => r.killed);
  const killedBy = {};
  for (const r of killed) { const k = r.by.split(':')[0]; killedBy[k] = (killedBy[k] ?? 0) + 1; }
  const survivors = rows.filter(r => !r.killed);
  console.log(`mutants: ${rows.length}${rows.length < total ? ` of ${total}` : ''}, killed ${killed.length} (${JSON.stringify(killedBy)}), survived ${survivors.length}, raw score ${(killed.length / Math.max(1, rows.length)).toFixed(3)}`);
  for (const s of survivors) console.log(`  SURVIVOR ${s.id} ${s.file}:${s.line} [${s.op}]\n    - ${s.from.slice(0, 200)}\n    + ${s.to.slice(0, 200)}`);
  const j = arg('--json', null);
  if (j) writeFileSync(path.resolve(j), JSON.stringify({ date: new Date().toISOString(), sources: { transition: sha(sources.t).slice(0, 16), sla: sha(sources.e).slice(0, 16) }, total, n: rows.length,
    sample: sampleN !== null ? { n: Number(sampleN), seed: Number(arg('--sample-seed', '1')) } : null, worlds, corpus: corpus?.meta ? { ...corpus.meta, journals: corpus.meta.journals } : null,
    killed: killed.length, killedBy, survivors: survivors.map(s => s.id), results: rows }, null, 1));
}

if (!isMainThread && workerData?.role === 'e7-mutate-worker') await workerMain();
else if (isMainThread && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
