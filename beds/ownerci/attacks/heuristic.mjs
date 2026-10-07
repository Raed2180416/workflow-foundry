// Triviality attack H1 (AUDIT.md step 5): a static, deterministic repairer that never runs code.
// It reverts the operator at the column of every module frame in the CI stack traces, and undoes
// a message-first FoundryError(...) call (the codebase convention is (code, message)).
const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const FLIPS = [[/^<=/, '<'], [/^>=/, '>'], [/^===/, '!=='], [/^!==/, '==='], [/^&&/, '||'], [/^\|\|/, '&&'],
  [/^true\b/, 'false'], [/^false\b/, 'true'], [/^<(?![<=])/, '<='], [/^>(?![>=])/, '>='], [/^!(?!=)/, '']];

function flipFrom(line, col) {
  for (let i = Math.max(0, col - 1); i < line.length; i++) {
    for (const [re, rep] of FLIPS) if (re.test(line.slice(i))) return line.slice(0, i) + line.slice(i).replace(re, rep);
  }
  return line;
}

export function heuristicRepair(task) {
  const src = task.inputs.module_source, lines = src.split('\n');
  const report = task.files['ci/job-summary.txt'];
  const frame = new RegExp(`${esc(task.inputs.module_path)}:(\\d+):(\\d+)`, 'g');
  const sites = new Map();
  for (const m of report.matchAll(frame)) if (!sites.has(+m[1])) sites.set(+m[1], +m[2]);
  for (const [ln, col] of sites) if (lines[ln - 1] !== undefined) lines[ln - 1] = flipFrom(lines[ln - 1], col);
  const out = lines.join('\n').replace(/new FoundryError\((`[^`]*`|'[^']*\s[^']*'), ('[A-Z][A-Z0-9_]+')\)/g, 'new FoundryError($2, $1)');
  return { patched_source: out };
}
