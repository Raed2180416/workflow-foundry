// Prints the tables used in README.md ($0, no model calls):
//   node beds/need-codefix-noverifier/measure.mjs [seeds=40] [split=dev] [firstSeed=601]   input size, this bed vs codefix
//   node beds/need-codefix-noverifier/measure.mjs collisions                               duplicate-module probe (codefix AUDIT F2)
//   node beds/need-codefix-noverifier/measure.mjs fidelity [seeds=40] [split=dev] [firstSeed=601]   REPL transcripts and expectation
//                                                           sentences replayed in real Python (inherited codefix defects, README)
// Tokens are estimateTokens(prompt) + estimateTokens(inputs) (utf8 bytes / 4, see beds/lib). `files` repeat the same text.
import { generate, instanceFingerprint } from './index.mjs';
import { entryOf, fidelity } from './fidelity.mjs';
import { generate as generateCodefix } from '../codefix/index.mjs';
import { estimateTokens } from '../lib/canonical.mjs';

const q = (xs, f) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(f * xs.length))];
const tokens = t => estimateTokens(t.prompt) + estimateTokens(t.inputs);
const range = (a, n) => Array.from({ length: n }, (_, i) => a + i);

function sizes(n, split, first) {
  console.log(`seeds ${first}..${first + n - 1}, split ${split}`);
  console.log('| d | this bed tokens (min / med / max) | codefix tokens (med) | removed (med) | removed share (med) | files | module lines (med) |');
  console.log('|---|---|---|---|---|---|---|');
  for (const d of [1, 2, 3, 4, 5]) {
    const mine = []; const base = []; const cut = []; const share = []; const files = []; const lines = [];
    for (const seed of range(first, n)) {
      const t = generate({ seed, split, difficulty: d });
      const c = generateCodefix({ seed, split, difficulty: d });
      mine.push(tokens(t)); base.push(tokens(c)); cut.push(tokens(c) - tokens(t)); share.push((tokens(c) - tokens(t)) / tokens(c));
      files.push(Object.keys(t.files).length); lines.push(t.inputs.source.split('\n').length);
    }
    console.log(`| ${d} | ${q(mine, 0)} / ${q(mine, 0.5)} / ${q(mine, 1)} | ${q(base, 0.5)} | ${q(cut, 0.5)} | ${(100 * q(share, 0.5)).toFixed(1)} % | ${q(files, 0.5)} | ${q(lines, 0.5)} |`);
  }
}

function collisions() {
  const sources = (split, seeds, d) => seeds.map(seed => ({ seed, ...instanceFingerprint({ seed, split, difficulty: d }) }));
  const within = (list, key) => { const seen = new Set(); let dup = 0; for (const h of list) { if (seen.has(h[key])) dup++; else seen.add(h[key]); } return dup; };
  const cross = (a, b, key) => { const s = new Set(a.map(h => h[key])); return b.filter(h => s.has(h[key])).length; };
  console.log('| d | dev 1-200 vs test 5000-5099: same buggy module | same reference | duplicates inside dev 1-200 (buggy) | inside dev 601-640 (buggy / reference) | dev 601-640 vs test 601-640 (buggy) |');
  console.log('|---|---|---|---|---|---|');
  for (const d of [1, 2, 3, 4, 5]) {
    const dev = sources('dev', range(1, 200), d);
    const test = sources('test', range(5000, 100), d);
    const used = sources('dev', range(601, 40), d);
    const usedTest = sources('test', range(601, 40), d);
    console.log(`| ${d} | ${cross(dev, test, 'source')} / 100 | ${cross(dev, test, 'reference')} / 100 | ${within(dev, 'source')} | ${within(used, 'source')} / ${within(used, 'reference')} | ${cross(used, usedTest, 'source')} |`);
  }
}

function fidelityTable(n, split, first) {
  const entries = [1, 2, 3, 4, 5].flatMap(d => range(first, n).map(seed => entryOf(generate({ seed, split, difficulty: d }))));
  const f = fidelity(entries);
  console.log(`seeds ${first}..${first + n - 1}, split ${split}, d1-d5: ${f.blocks} REPL blocks`);
  console.log('transcript statements vs real Python:', JSON.stringify(f.statements));
  console.log('| d | real-bug sentences (consistent / contradict) | red-herring sentences (consistent / contradict) |');
  console.log('|---|---|---|');
  for (const d of [1, 2, 3, 4, 5]) {
    const cell = x => (x ? `${x.consistent} / ${x.contradict}` : 'none');
    console.log(`| ${d} | ${cell(f.sentences.bug[d])} | ${cell(f.sentences.herring[d])} |`);
  }
  console.log('sentence values vs real Python:', JSON.stringify(f.values));
  for (const [cls, list] of Object.entries(f.examples)) if (list.length) console.log(`${cls}:\n  ${list.join('\n  ')}`);
}

if (process.argv[2] === 'collisions') collisions();
else if (process.argv[2] === 'fidelity') fidelityTable(Number(process.argv[3] || 40), process.argv[4] || 'dev', Number(process.argv[5] || 601));
else sizes(Number(process.argv[2] || 40), process.argv[3] || 'dev', Number(process.argv[4] || 601));
