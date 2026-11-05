#!/usr/bin/env node
// Run the run-graph evaluation. $0: real runtime, scripted provider, local tools, temp workspaces deleted afterwards.
//   node app/eval/run-graph/measure.mjs --split dev [--seeds 0-199] [--named] [--mutants] [--out FILE]
//   node app/eval/run-graph/measure.mjs --split heldout --seeds A-B --out FILE      (seeds and hashes frozen in PREREG.md first)
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NAMED, randomScenario } from './scenarios.mjs';
import { record, evaluateRecording, pct } from './harness.mjs';
import { loadMutants } from './mutants.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
export const FROZEN = ['scenarios.mjs', 'harness.mjs', 'mutants.mjs', 'measure.mjs', 'crash-child.mjs'].map(f => path.join(here, f));

export async function measure({ split = 'dev', seeds = [0, 199], named = true, mutants = false, scratch = tmpdir(), log = () => {} } = {}) {
  const root = mkdtempSync(path.join(scratch, `run-graph-${split}-`));
  const scores = {}, perScenario = [], invalid = [], t0 = performance.now();
  let muts = {};
  try {
    if (mutants) muts = await loadMutants(path.join(root, 'mutants'));
    const jobs = [...(named ? Object.keys(NAMED).map(name => ({ name, sc: { ...NAMED[name](), name } })) : []),
      ...Array.from({ length: seeds[1] - seeds[0] + 1 }, (_, i) => ({ name: `R${seeds[0] + i}`, seed: seeds[0] + i }))];
    for (const job of jobs) {
      const sc = job.sc ?? randomScenario(job.seed), dir = path.join(root, job.name);
      const rec = await record(dir, sc);
      if (rec.invalid) { invalid.push({ name: job.name, errors: rec.invalid.map(e => e.code ?? e.message ?? String(e)) }); rmSync(dir, { recursive: true, force: true }); continue; }
      const local = { liveMisses: [] };
      // T's misses at any moment (first 6 per scenario), with the moment's run status: what the dev loop root-causes.
      const onMoment = ({ seq, status, executing, truth, arms }) => {
        if (local.liveMisses.length >= 6) return;
        const a = arms.T, nodes = Object.entries(truth.nodes).filter(([id, t]) => a.nodes[id] !== t).map(([id, t]) => `${id}: said ${a.nodes[id]}, truth ${t}`);
        const wait = JSON.stringify(a.waiting) === JSON.stringify(truth.waiting) ? null : `said ${JSON.stringify(a.waiting)}, truth ${JSON.stringify(truth.waiting)}`;
        const run = a.run === truth.run ? null : `said ${a.run}, truth ${truth.run}`;
        if (nodes.length || wait || run) local.liveMisses.push({ seq, status, executing, nodes, wait, run });
      };
      evaluateRecording(rec, { scores, mutants: muts, onMoment, perRun: ({ truth, arms }) => {
        const misses = Object.fromEntries(Object.entries(arms).filter(([arm]) => ['T', 'B1', 'B0'].includes(arm)).map(([arm, a]) => [arm, {
          nodes: a.nodes ? Object.entries(truth.nodes).filter(([id, t]) => a.nodes[id] !== t).map(([id, t]) => `${id}: ${a.nodes[id]} != ${t}`) : null,
          run: a.run === truth.run ? null : `${a.run} != ${truth.run}`, waiting: JSON.stringify(a.waiting) === JSON.stringify(truth.waiting) ? null : { said: a.waiting, truth: truth.waiting },
          failing: a.failing || truth.failing ? { said: a.failing, truth: truth.failing ? { leaves: [...truth.failing.leaves], runCode: truth.failing.runCode } : null } : null }]));
        Object.assign(local, { status: rec.final.status, events: rec.events.length, commits: rec.commits.length, journal: rec.journal.length, final: misses, line: arms.T.line });
      } });
      // Per-scenario misses of T at any moment (not only the final one) are re-derived by the dev loop; here only the final ones are kept.
      perScenario.push({ name: job.name, ...local });
      rec.store.close();
      rmSync(dir, { recursive: true, force: true });
      log(`${job.name}: ${rec.final.status}, ${rec.events.length} events, ${rec.commits.length} moments`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
  const table = Object.fromEntries(Object.entries(scores).map(([arm, s]) => [arm, Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'na').map(([k, t]) => [k, { pct: s.na[k] ? null : pct(t), ok: t.ok, n: t.n }]))]));
  return { split, seeds, named, generatedAt: new Date().toISOString(), node: process.version, wallMs: Math.round(performance.now() - t0), frozen: Object.fromEntries(FROZEN.map(f => [path.basename(f), sha(f)])),
    systemUnderTest: { 'app/core/run-graph.mjs': sha(path.resolve(here, '../../core/run-graph.mjs')) }, invalid, table, perScenario };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: a } = parseArgs({ options: { split: { type: 'string', default: 'dev' }, seeds: { type: 'string', default: '0-199' }, named: { type: 'boolean', default: false }, 'no-named': { type: 'boolean', default: false },
    mutants: { type: 'boolean', default: false }, out: { type: 'string' }, scratch: { type: 'string', default: tmpdir() }, quiet: { type: 'boolean', default: false } } });
  const [lo, hi] = a.seeds.split('-').map(Number);
  const result = await measure({ split: a.split, seeds: [lo, hi], named: !a['no-named'], mutants: a.mutants, scratch: a.scratch, log: a.quiet ? () => {} : m => process.stderr.write(`${m}\n`) });
  if (a.out) writeFileSync(a.out, `${JSON.stringify(result)}\n`);
  const qs = ['state', 'stateLive', 'run', 'wait', 'waitFalseAlarm', 'waitMissed', 'fail', 'failDeep', 'cost', 'costAll', 'line', 'lineStep', 'lineCost'];
  console.log(['arm', ...qs].join('\t'));
  for (const [arm, t] of Object.entries(result.table)) console.log([arm, ...qs.map(q => t[q]?.pct === null ? 'n/a' : `${t[q]?.pct}% (${t[q]?.ok}/${t[q]?.n})`)].join('\t'));
  console.log(`invalid scenarios: ${result.invalid.length}; wall ${result.wallMs} ms`);
}
