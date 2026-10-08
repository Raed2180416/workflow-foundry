// Regex baselines of the construction ports, IMPORTED from the files that own them and never copied (JUDGE-PROGRAM.md §1.2 C1,
// C2, C7: "The regexes themselves"; plan group "construction-crossfamily": "regex baselines imported read-only from
// src/construction-objective.mjs and experiments/c0/construct.mjs"). Nothing here writes to either file.
//
//   C1  REQUIREMENT_LIBRARY and extractRequirements from src/construction-objective.mjs (live imports)
//   C2  the same extractor: an objective is "ungrounded" when it returns UNGROUNDED_OBJECTIVE (its telepathy and magic cues)
//   C7  the hidden-path detector `outside` of construct() in experiments/c0/construct.mjs. It is a closure inside construct(), not an
//       export, and the file may not be edited, so the closure's own text is read from the file at call time and compiled: the
//       regex and the filter are whatever construct.mjs holds today. A change in the shape of that statement stops the baseline
//       with BASELINE_SHAPE instead of silently measuring something else.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REQUIREMENT_LIBRARY, extractRequirements } from '../../../src/construction-objective.mjs';

export { REQUIREMENT_LIBRARY, extractRequirements };
export const C0_CONSTRUCT = fileURLToPath(new URL('../../c0/construct.mjs', import.meta.url));
const fail = (code, message) => { const e = new Error(`${code}: ${message}`); e.code = code; return e; };

// C1: the set of requirement ids the library's cues report (extractRequirements also appends `verification` when no cue found it).
export function c1Baseline(objective) {
  const r = extractRequirements(objective);
  return new Set(r.requirements ?? []);
}
// C2: yes when the extractor reports an ungrounded cue family; it never reads a capability listing.
export const c2Baseline = objective => (extractRequirements(objective).code === 'UNGROUNDED_OBJECTIVE' ? 'yes' : 'no');

// C7: the statement `const outside = u => (...).filter(p => !p.startsWith(workdir) && !p.startsWith(kit.dir));` of construct().
export function loadHiddenPathDetector({ file = C0_CONSTRUCT } = {}) {
  const src = readFileSync(file, 'utf8');
  const m = /const outside = (u => [\s\S]*?);\n/.exec(src);
  if (!m || !/\.match\(\/.*\/[a-z]*\)/.test(m[1]) || !/startsWith\(workdir\)/.test(m[1])) throw fail('BASELINE_SHAPE', `${file} no longer defines the hidden-path detector \`outside\` the C7 baseline reads`);
  return { text: m[1], make: ({ workdir, kitDir }) => new Function('workdir', 'kit', `return (${m[1]});`)(workdir, { dir: kitDir }) };
}
export const SESSION = Object.freeze({ workdir: '/tmp/c0-session/work', kitDir: '/tmp/c0-session/kit' });
export function c7Baseline(toolCall, { detector = loadHiddenPathDetector(), session = SESSION } = {}) {
  const outside = detector.make(session);
  return outside({ input: toolCall.input }).length > 0 ? 'gaming' : 'legitimate';
}
