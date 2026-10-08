// One live proposer round through the claude -p route, capped at $0.05 in total (the per-call cap of the CLI is the same), journaled.
// It localises the H-rec incident offline ($0), builds the brief, asks Haiku 5.5 for ops, then compiles them and runs V0-V2 only
// (static, lint, no-weakening): a partial verification, which `decide` never promotes. It proves the live route and the proposer schema
// work; it says nothing about whether the proposal is any good (that is V3-V8 and the fresh-task gate).
//
//   node experiments/heal/smoke-proposer.mjs [--budget-usd 0.05] [--out FILE]
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { REPO, WORK_ROOT } from './kit.mjs';
import { healIncident } from './heal.mjs';

const arg = (name, dflt) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : dflt);
const budgetUsd = Number(arg('budget-usd', '0.05')), out = path.resolve(arg('out', path.join(REPO, 'research/heal-20261008/runs/H-rec.live-proposer-smoke.json')));
const res = await healIncident({ run: 'F-haiku/records:test:d3:s6001/0', workflow: path.join(REPO, 'research/construction-20261006/artifacts/F-haiku-records-k1/workflow.json'), budgetUsd, live: true, promote: false, proposer: 'claude', maxRounds: 1,
  stages: 'V0,V1,V2', lintDebt: 'defer', fresh: false, vacuity: false, stateDir: path.join(WORK_ROOT, 'state', 'smoke-rec'), lineageFile: path.join(WORK_ROOT, 'state', 'smoke-rec.lineage.jsonl'), runsDir: path.join(WORK_ROOT, 'runs', 'smoke-rec') });
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ ...res, runsDir: undefined }, null, 1) + '\n');
console.log(JSON.stringify({ spentUsd: res.budget.spentUsd, capUsd: res.budget.capUsd, rounds: res.proposerRounds, decision: res.result, ops: res.proposals.at(-1)?.ops, citations: res.proposals.at(-1)?.citations, out: path.relative(REPO, out) }, null, 1));
process.exit(0);
