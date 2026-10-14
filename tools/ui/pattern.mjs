// A conservative admission check for `pattern` in an answer schema.
//
// The engine refuses `pattern` in untrusted schemas (src/validate.mjs compileDataSchema: "Untrusted regular
// expressions require a separately isolated validator capability"). This sidecar admits a bounded subset so a bed
// host can check formats such as ^INV-[0-9]{6}$ itself. The bound is syntactic, not a proof of linear time:
//   - at most 256 characters, and it compiles with the `u` flag (JSON Schema / ajv semantics, unanchored test);
//   - no backreferences (\1, \k<name>) and no lookaround ((?=, (?!, (?<=, (?<!);
//   - a group may be quantified only by ? or {0,1} (no (a+)+, (ab)*, (x|y){2,});
//   - degree <= 2, where degree = the number of large quantifiers (*, +, {n,}, {n,m} with m > 16) plus 1 when the
//     pattern is not anchored with ^ at the start or has a top-level | (the matcher then retries from every start
//     position);
//   - the field must declare maxLength <= 256 (checked by the compiler), and the validator checks maxLength before
//     running the pattern, so a pattern never sees more than 256 code points.
// With degree <= 2 the backtracking work is O(n^2) in the worst case for n <= 256.
export const PATTERN_MAX_SOURCE = 256;
export const PATTERN_MAX_INPUT = 256;
export const PATTERN_MAX_DEGREE = 2;
export const SMALL_BOUND = 16;

export function patternProblems(source) {
  if (typeof source !== 'string') return [{ code: 'pattern-invalid', message: 'pattern must be a string' }];
  if (source.length > PATTERN_MAX_SOURCE) return [{ code: 'pattern-unsafe', message: `pattern is longer than ${PATTERN_MAX_SOURCE} characters` }];
  try { new RegExp(source, 'u'); } catch (error) { return [{ code: 'pattern-invalid', message: `pattern does not compile with the u flag: ${error.message}` }]; }
  const problems = [], unsafe = message => problems.push({ code: 'pattern-unsafe', message });
  let large = 0, i = 0, topLevelBar = false;
  const groupStack = [];
  // Reads a quantifier at position j; returns { length, max } or null.
  const quantifier = j => {
    const c = source[j];
    if (c === '*' || c === '+') return { length: 1 + (source[j + 1] === '?' ? 1 : 0), max: Infinity };
    if (c === '?') return { length: 1 + (source[j + 1] === '?' ? 1 : 0), max: 1 };
    if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}\??/.exec(source.slice(j));
      if (!m) return null;
      const max = m[2] === undefined ? Number(m[1]) : m[3] === '' ? Infinity : Number(m[3]);
      return { length: m[0].length, max };
    }
    return null;
  };
  const afterAtom = (j, isGroup) => {
    const q = quantifier(j);
    if (!q) return j;
    if (isGroup && q.max > 1) unsafe('a group may only be optional (? or {0,1}); repeat a character class instead');
    if (q.max > SMALL_BOUND) large++;
    return j + q.length;
  };
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      const next = source[i + 1];
      if (/[1-9]/.test(next)) { unsafe('backreferences are not allowed'); i += 2; continue; }
      if (next === 'k' && source[i + 2] === '<') { unsafe('named backreferences are not allowed'); i += 3; continue; }
      let j = i + 2;
      if ((next === 'u' && source[i + 2] === '{') || ((next === 'p' || next === 'P') && source[i + 2] === '{')) j = source.indexOf('}', i) + 1;
      else if (next === 'u') j = i + 6;
      else if (next === 'x') j = i + 4;
      else if (next === 'c') j = i + 3;
      i = afterAtom(j, false);
      continue;
    }
    if (c === '[') {
      let j = i + 1;
      if (source[j] === '^') j++;
      if (source[j] === ']') j++;
      while (j < source.length && source[j] !== ']') j += source[j] === '\\' ? 2 : 1;
      i = afterAtom(j + 1, false);
      continue;
    }
    if (c === '(') {
      if (source.startsWith('(?=', i) || source.startsWith('(?!', i) || source.startsWith('(?<=', i) || source.startsWith('(?<!', i)) {
        unsafe('lookaround is not allowed');
      }
      groupStack.push(i);
      i += source.startsWith('(?:', i) ? 3 : 1;
      continue;
    }
    if (c === ')') { groupStack.pop(); i = afterAtom(i + 1, true); continue; }
    if (c === '|' && groupStack.length === 0) topLevelBar = true;
    if (c === '^' || c === '$' || c === '|') { i++; continue; }
    // A literal or '.': its quantifier, if any, follows.
    i = afterAtom(i + 1, false);
  }
  // Anchored only when every top-level alternative starts at ^: a top-level | makes the next branch unanchored.
  const anchored = source.startsWith('^') && !topLevelBar;
  const degree = large + (anchored ? 0 : 1);
  if (degree > PATTERN_MAX_DEGREE) unsafe(`pattern degree is ${degree} (large quantifiers ${large}${anchored ? '' : ' + 1 for no leading ^'}); at most ${PATTERN_MAX_DEGREE} is allowed. Anchor with ^ and bound repeats, e.g. [A-Z]{1,16}`);
  return problems;
}
