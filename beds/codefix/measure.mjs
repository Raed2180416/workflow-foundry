// Prints the per-difficulty size table used in README.md:
//   node beds/codefix/measure.mjs [seeds=30] [split=dev]
// Tokens are estimateTokens(prompt) + estimateTokens(inputs) (utf8 bytes / 4, see beds/lib).
import { generate } from './index.mjs';
import { build, KNOBS } from './build.mjs';
import { estimateTokens } from '../lib/canonical.mjs';

const seeds = Number(process.argv[2] || 30);
const split = process.argv[3] || 'dev';
const q = (xs, f) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(f * xs.length))];

console.log('| d | bugs | sections | module lines (min/med/max) | input tokens (min/med/max) | hidden cases (med) | visible tests (med) |');
console.log('|---|---|---|---|---|---|---|');
for (const d of [1, 2, 3, 4, 5]) {
  const tok = []; const lines = []; const hidden = []; const visible = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const task = generate({ seed, split, difficulty: d });
    const b = build({ seed, split, difficulty: d });
    tok.push(estimateTokens(task.prompt) + estimateTokens(task.inputs));
    lines.push(b.buggySource.split('\n').length);
    hidden.push(b.hidden.length);
    visible.push(b.visibleCases.length);
  }
  console.log(`| ${d} | ${KNOBS[d].bugs} | ${KNOBS[d].sections} | ${q(lines, 0)} / ${q(lines, 0.5)} / ${q(lines, 1)} | ${q(tok, 0)} / ${q(tok, 0.5)} / ${q(tok, 1)} | ${q(hidden, 0.5)} | ${q(visible, 0.5)} |`);
}
