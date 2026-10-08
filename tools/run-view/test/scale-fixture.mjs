// Writes a workspace holding a real 1000-item map run (scripted provider, no spend) plus its result line, for the history page's scale check.
//   node tools/run-view/test/scale-fixture.mjs --out DIR [--items 1000]
import path from 'node:path';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { writeRun, jsonl, resultLine } from './fixtures.mjs';
import { scaleWorkflow, scaleScript } from '../make-fixtures.mjs';
const { values: a } = parseArgs({ options: { out: { type: 'string' }, items: { type: 'string', default: '1000' } } });
if (!a.out) { console.error('Need --out DIR'); process.exit(2); }
const n = Number(a.items), t0 = performance.now();
const { runId, result } = await writeRun(path.join(a.out, 'ws'), scaleWorkflow(n), { script: scaleScript(), input: { items: Array.from({ length: n }, (_, id) => ({ id, scene: `scene ${id}` })) } });
jsonl(path.join(a.out, 'results.jsonl'), [resultLine({ arm: 'scale', taskKey: `records:dev:scale:s${n}`, pass: true, meta: { runId, status: result.status, verdict: 'pass' } })]);
console.log(JSON.stringify({ runId, status: result.status, items: n, wallMs: Math.round(performance.now() - t0) }));
