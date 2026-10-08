// Runs the heal driver offline ($0, replay only) on the three development incidents and writes one heal-run record per incident
// (ids, scores, counts and codes; no task text) plus the lesson proposals. Development/diagnostic evidence only: the seeds are
// already INSPECTED, so this proves the plumbing, not a fix rate.
//
//   node experiments/heal/incidents.mjs [--only rec|cfx|p1] [--out research/heal-20261008/runs]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { REPO, WORK_ROOT } from './kit.mjs';
import { healIncident } from './heal.mjs';

export const INCIDENTS = Object.freeze({
  rec: { id: 'H-rec', run: 'F-haiku/records:test:d3:s6001/0', workflow: 'research/construction-20261006/artifacts/F-haiku-records-k1/workflow.json' },
  cfx: { id: 'H-cfx', run: 'F-haiku/codefix:test:d3:s6004/0', workflow: 'research/construction-20261006/artifacts/F-haiku-codefix-k1/workflow.json' },
  p1: { id: 'H-p1', run: 'fhand-haiku/records:test:d3:s5002/1', workflow: 'preset:p1-fhand-haiku' },
});

const arg = (name, dflt) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : dflt);
const only = arg('only', null), outDir = path.resolve(arg('out', path.join(REPO, 'research/heal-20261008/runs')));
mkdirSync(outDir, { recursive: true });
for (const [key, inc] of Object.entries(INCIDENTS)) {
  if (only && only !== key) continue;
  const started = Date.now();
  const out = await healIncident({ run: inc.run, workflow: inc.workflow.startsWith('preset:') ? inc.workflow : path.join(REPO, inc.workflow), budgetUsd: 0, live: false, promote: false, proposer: 'none', writeLessons: true,
    stateDir: path.join(WORK_ROOT, 'state', `incidents-${key}`), lineageFile: path.join(WORK_ROOT, 'state', `incidents-${key}.lineage.jsonl`), runsDir: path.join(WORK_ROOT, 'runs', `incidents-${key}`) });
  const file = path.join(outDir, `${inc.id}.json`);
  writeFileSync(file, JSON.stringify({ incident: inc.id, ...out, runsDir: undefined }, null, 1) + '\n');
  console.log(`${inc.id}: ${out.classification?.class} root=${out.localisation?.root?.node ?? '-'} (${out.localisation?.root?.confidence ?? '-'}) classes=${(out.localisation?.classes ?? []).map(c => c.code).join('+')} lessons=${out.lesson?.lesson ?? '-'} ${((Date.now() - started) / 1000).toFixed(0)}s -> ${path.relative(REPO, file)}`);
}
process.exit(0);
