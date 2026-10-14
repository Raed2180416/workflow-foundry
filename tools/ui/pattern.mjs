// `pattern` in an answer schema: an admission check, and a matcher with a time budget.
//
// The engine refuses `pattern` in untrusted schemas (src/validate.mjs compileDataSchema: "Untrusted regular
// expressions require a separately isolated validator capability"), and so does this sidecar by default
// (compile.mjs `allowPattern: false`). A host that opts in (`allowPattern: true`) gets two layers:
//
// 1. Admission (patternProblems), syntactic and conservative:
//   - at most 256 characters, and it compiles with the `u` flag (JSON Schema / ajv semantics, unanchored test);
//   - no backreferences (\1, \k<name>), no lookaround ((?=, (?!, (?<=, (?<!) and no group syntax other than (...),
//     (?:...) and (?<name>...);
//   - a group may be quantified only by ? or {0,1} (no (a+)+, (ab)*, (x|y){2,});
//   - the path bound: the product of the choices the pattern can make is at most 257^2. A quantifier with bounds
//     {min,max} counts min(max,256) - min(min,256) + 1 choices (so * counts 257, + 256, ? 2, {0,16} 17, {6} 1), an
//     alternation counts its branches, and a pattern not anchored by a leading ^ (or with a top-level |) counts 257
//     more for the start positions the matcher retries. With no repeated group, every choice point is passed at most
//     once on a path, so a backtracking search for one input explores at most that many paths;
//   - the field must declare maxLength <= 256 (checked by the compiler), and the validator checks maxLength first, so
//     a pattern never sees more than 256 code points.
//   The bound is an argument about a backtracking matcher, not a proof about V8's.
//
// 2. Execution (patternTest): every test runs in a worker thread, and the validator gives all pattern tests of one
//    answer a budget of PATTERN_BUDGET_MS. A test that does not finish in time is reported as 'timeout', and the
//    validator rejects the answer (`pattern-timeout`, fail closed); the worker is terminated and replaced. So a pattern
//    the admission check misjudges costs the host at most the budget per answer, not the event loop.
import { MessageChannel, Worker } from 'node:worker_threads';

export const PATTERN_MAX_SOURCE = 256;
export const PATTERN_MAX_INPUT = 256;
export const PATTERN_MAX_PATHS = (PATTERN_MAX_INPUT + 1) ** 2;
export const PATTERN_BUDGET_MS = 500;
const MATCHER_START_MS = 10000;

export function patternProblems(source) {
  if (typeof source !== 'string') return [{ code: 'pattern-invalid', message: 'pattern must be a string' }];
  if (source.length > PATTERN_MAX_SOURCE) return [{ code: 'pattern-unsafe', message: `pattern is longer than ${PATTERN_MAX_SOURCE} characters` }];
  try { new RegExp(source, 'u'); } catch (error) { return [{ code: 'pattern-invalid', message: `pattern does not compile with the u flag: ${error.message}` }]; }
  const problems = [], unsafe = message => { if (!problems.some(p => p.message === message)) problems.push({ code: 'pattern-unsafe', message }); };
  const N = PATTERN_MAX_INPUT;
  let paths = 1, i = 0, topLevelBar = false;
  // One frame per open group (the bottom frame is the whole pattern); `branches` counts its alternatives.
  const frames = [{ branches: 1 }];
  // Reads a quantifier at position j; returns { length, min, max } or null.
  const quantifier = j => {
    const c = source[j];
    const lazy = k => (source[j + k] === '?' ? 1 : 0);
    if (c === '*') return { length: 1 + lazy(1), min: 0, max: Infinity };
    if (c === '+') return { length: 1 + lazy(1), min: 1, max: Infinity };
    if (c === '?') return { length: 1 + lazy(1), min: 0, max: 1 };
    if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}\??/.exec(source.slice(j));
      if (!m) return null;
      const min = Number(m[1]), max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
      return { length: m[0].length, min, max };
    }
    return null;
  };
  const afterAtom = (j, isGroup) => {
    const q = quantifier(j);
    if (!q) return j;
    if (isGroup && q.max > 1) unsafe('a group may only be optional (? or {0,1}); repeat a character class instead');
    paths *= Math.min(q.max, N) - Math.min(q.min, N) + 1;
    return j + q.length;
  };
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      const next = source[i + 1];
      if (/[1-9]/.test(next)) { unsafe('backreferences are not allowed'); i += 2; continue; }
      if (next === 'k' && source[i + 2] === '<') { unsafe('named backreferences are not allowed'); i += 3; continue; }
      let j = i + 2;
      if ((next === 'u' || next === 'p' || next === 'P') && source[i + 2] === '{') j = Math.max(i + 3, source.indexOf('}', i) + 1);
      else if (next === 'u') j = i + 6;
      else if (next === 'x') j = i + 4;
      else if (next === 'c') j = i + 3;
      i = afterAtom(j, false);
      continue;
    }
    if (c === '[') {
      // In JavaScript a ] right after [ or [^ closes the class: [] matches nothing and [^] matches any character.
      let j = i + 1;
      if (source[j] === '^') j++;
      while (j < source.length && source[j] !== ']') j += source[j] === '\\' ? 2 : 1;
      i = afterAtom(j + 1, false);
      continue;
    }
    if (c === '(') {
      if (source.startsWith('(?=', i) || source.startsWith('(?!', i) || source.startsWith('(?<=', i) || source.startsWith('(?<!', i)) {
        unsafe('lookaround is not allowed');
        i += source[i + 2] === '<' ? 4 : 3;
      } else if (source.startsWith('(?:', i)) i += 3;
      else if (source.startsWith('(?<', i)) i = Math.max(i + 3, source.indexOf('>', i) + 1); // a named group; the name has no syntax
      else if (source[i + 1] === '?') { unsafe('only (...), (?:...) and (?<name>...) groups are allowed'); i += 2; }
      else i += 1;
      frames.push({ branches: 1 });
      continue;
    }
    if (c === ')') {
      if (frames.length > 1) paths *= frames.pop().branches;
      i = afterAtom(i + 1, true);
      continue;
    }
    if (c === '|') { frames.at(-1).branches++; if (frames.length === 1) topLevelBar = true; i++; continue; }
    if (c === '^' || c === '$') { i++; continue; }
    // A literal or '.': its quantifier, if any, follows.
    i = afterAtom(i + 1, false);
  }
  paths *= frames[0].branches;
  // Anchored only when every top-level alternative starts at ^: a top-level | makes the next branch unanchored.
  const anchored = source.startsWith('^') && !topLevelBar;
  if (!anchored) paths *= N + 1;
  if (paths > PATTERN_MAX_PATHS) {
    unsafe(`pattern can make about ${paths > 1e15 ? paths.toExponential(1) : paths} choices on one input (quantifiers, alternatives${anchored ? '' : ', start positions'}); at most ${PATTERN_MAX_PATHS} are allowed. Anchor with ^ and use fixed or small counts, e.g. ^INV-[0-9]{6}$`);
  }
  return problems;
}

// ---- the matcher: a worker thread, a synchronous call with a deadline ---------------------------------------------

const MATCHER_SOURCE = `
const { workerData } = require('node:worker_threads');
const { port, shared } = workerData;
const flag = new Int32Array(shared);
const cache = new Map();
const done = result => { Atomics.store(flag, 1, result); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); };
port.on('message', ({ pattern, input }) => {
  let result = 3;
  try {
    let re = cache.get(pattern);
    if (!re) { if (cache.size >= 64) cache.clear(); re = new RegExp(pattern, 'u'); cache.set(pattern, re); }
    result = re.test(input) ? 1 : 2;
  } catch { result = 3; }
  done(result);
});
done(0);
`;
let matcher = null;

function startMatcher() {
  const shared = new SharedArrayBuffer(8), flag = new Int32Array(shared);
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(MATCHER_SOURCE, { eval: true, workerData: { port: port2, shared }, transferList: [port2] });
  const m = { worker, port: port1, flag };
  const drop = () => { if (matcher === m) matcher = null; };
  worker.on('error', drop);
  worker.on('exit', drop);
  worker.unref();
  port1.unref();
  // Wait for the worker to start (not counted against a test's budget).
  if (Atomics.wait(flag, 0, 0, MATCHER_START_MS) === 'timed-out') { worker.terminate().catch(() => {}); return null; }
  return m;
}

/**
 * Tests `input` against `pattern` (the `u` flag, unanchored, as ajv does) in a worker thread, waiting at most
 * `budgetMs`. Returns true, false, or 'timeout' (also when the pattern does not compile or no worker can run).
 */
export function patternTest(pattern, input, budgetMs = PATTERN_BUDGET_MS) {
  if (!(budgetMs > 0)) return 'timeout';
  let m = matcher;
  if (!m) {
    try { m = startMatcher(); } catch { m = null; }
    if (!m) return 'timeout';
    matcher = m;
  }
  Atomics.store(m.flag, 0, 0);
  m.port.postMessage({ pattern, input });
  if (Atomics.wait(m.flag, 0, 0, Math.ceil(budgetMs)) === 'timed-out') {
    if (matcher === m) matcher = null;
    m.worker.terminate().catch(() => {});
    return 'timeout';
  }
  const result = Atomics.load(m.flag, 1);
  return result === 1 ? true : result === 2 ? false : 'timeout';
}
