#!/usr/bin/env node
// GQA-1 leakage trace ($0, POST HOC; review finding M4). For every bug a check-based workflow run found (oracle-credited,
// 1-minimal report), which Haiku-written check caught it, and how much of that check's `rule` text is the spec sentence that
// describes the injected fault (analysis/leakage-map.json). A high overlap means the detection came through a sentence the
// fault author wrote into the spec after writing the fault: the path by which the spec leaks the fault set to the workflow.
// It reads only run outputs and the map; it never feeds an arm.
//   node experiments/gameqa-web/leak-trace.mjs RUN_DIR [RUN_DIR ...] > analysis/leak-trace.json
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEAK = JSON.parse(readFileSync(path.join(ROOT, 'research/gameqa-20261021/analysis/leakage-map.json'), 'utf8'));
const read = (d, f) => (existsSync(path.join(d, f)) ? JSON.parse(readFileSync(path.join(d, f), 'utf8')) : null);
const STOP = new Set('a an the of to in on is it its and or be by as at if any one that this with for from not no are each every must may can'.split(' '));
export const words = s => String(s).toLowerCase().replace(/\*/g, '').match(/[a-z0-9']+/g)?.filter(w => !STOP.has(w)) ?? [];
/** Share of the quote's content words that appear in the text (0..1). */
export function overlap(quote, text) {
  const q = [...new Set(words(quote))], t = new Set(words(text));
  return q.length ? q.filter(w => t.has(w)).length / q.length : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = [];
  for (const d of process.argv.slice(2)) {
    const meta = read(d, 'meta.json'), score = read(d, 'score.json'), stats = read(d, 'stats.json'), cons = read(d, 'constructed.json');
    const pair = meta?.arm === 'workflow-random' ? read(path.join(path.dirname(d), `${meta.runId.split('-workflow-random-')[0]}-workflow-${meta.runId.split('-').at(-1)}`), 'constructed.json') : null;
    const specs = (cons ?? pair)?.specs ?? [];
    if (!score || !stats?.reportChecks) continue;
    for (const r of score.perReport.filter(x => x.verdict === 'credited' && x.minimal && !x.duplicate)) {
      const f = LEAK.faults.find(x => x.bug === r.bug);
      const checks = (stats.reportChecks[r.index] ?? []).map(id => specs.find(c => c.id === id) ?? { id, rule: '(generic detector)' });
      const best = Math.max(0, ...checks.map(c => overlap(f.quote, `${c.rule} ${c.when ?? ''} ${c.expect ?? ''}`)));
      rows.push({ run: meta.runId, arm: meta.arm, bug: r.bug, ruleShape: f.ruleShape, specLine: f.specLine, checks: checks.map(c => ({ id: c.id, rule: c.rule })), quoteOverlap: Math.round(best * 100) / 100 });
    }
  }
  const byBug = {};
  for (const r of rows) (byBug[r.bug] ??= []).push(r.quoteOverlap);
  const summary = Object.fromEntries(Object.entries(byBug).sort().map(([b, v]) => [b, { finds: v.length, meanOverlap: Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 100) / 100, min: Math.min(...v), max: Math.max(...v) }]));
  console.log(JSON.stringify({ note: 'POST HOC (M4). Per found bug: the Haiku-written check(s) that caught it and the share of the fault-describing spec sentence (leakage-map.json) found in the check text (content words). Analysis only.', summary, rows }, null, 1));
}
