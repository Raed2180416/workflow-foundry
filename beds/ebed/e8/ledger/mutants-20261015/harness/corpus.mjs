// Build reachable journals for the grader differential. Model-written solvers run only out of process (sandbox
// arm), as tools/specificity-run.mjs does. Writes <out>/<seed>-<d>-<size>.json = { spec, pools, journals: [{ name, rows }] }.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const R = new URL('../../../../../../', import.meta.url).pathname.replace(/\/$/, '');   // the repository root
const { generateWorld, referenceRuns, binding } = await import(pathToFileURL(`${R}/beds/ebed/e8/index.mjs`).href);
const { CONTROLS, runControl } = await import(pathToFileURL(`${R}/beds/ebed/e8/controls.mjs`).href);
const { createHost } = await import(pathToFileURL(`${R}/beds/ebed/host/host.mjs`).href);
const { sandboxArm } = await import(pathToFileURL(`${R}/beds/ebed/host/sandbox-arm.mjs`).href);
const [specs, out] = process.argv.slice(2);
const specDir = `${R}/beds/ebed/e8/specificity`;
const solvers = [...readdirSync(specDir).filter(f => f.endsWith('.mjs')).map(f => ({ name: f, file: `${specDir}/${f}` })),
  ...[1, 2, 3].map(i => ({ name: `b1lh-e8-${i}`, file: `${R}/research/enterprise-20261014/runs/b1lh-e8-${i}/solver.mjs` })).filter(s => existsSync(s.file))];
for (const s of specs.split(',')) {
  const [seed, d, size] = s.split(':').map(Number);
  const file = `${out}/${seed}-${d}-${size}.json`;
  if (existsSync(file)) { console.log('skip', file); continue; }
  const t0 = Date.now();
  const w = generateWorld({ seed, difficulty: d, mix: 'tail', size });
  const r = await referenceRuns(w);
  const journals = [{ name: 'ref-earliest', rows: r.runs.earliest.rows }, { name: 'ref-latest', rows: r.runs.latest.rows }];
  for (const c of CONTROLS) if (d >= (c.minDifficulty ?? 2)) journals.push({ name: c.id, rows: await runControl(c.id, w) });
  for (const sv of solvers) {
    const arm = sandboxArm({ id: sv.name, solverSource: readFileSync(sv.file, 'utf8'), timeoutMs: 20_000 });
    const host = createHost({ item: binding, world: w, arm, callTimeoutMs: 25_000 });
    try { await host.run(); journals.push({ name: sv.name, rows: host.journal.contentRows() }); }
    catch (e) { console.log(`  ${sv.name} failed: ${String(e?.message ?? e).slice(0, 120)}`); }
    finally { arm.close(); }
  }
  writeFileSync(file, JSON.stringify({ spec: { seed, d, size }, pools: r.pools, journals }));
  console.log(`${file}: ${journals.length} journals, ${Math.round((Date.now() - t0) / 1000)} s`);
}
