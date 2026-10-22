#!/usr/bin/env node
// Run one arm of GQA-1 once, then score its reports with the oracle.
//   node experiments/gameqa-web/run.mjs --arm monkey|agent|workflow|workflow-random --rep N [--live] [--dev] [--out DIR]
// Haiku arms need --live (paid). Unless --dev, the bed must match the frozen manifest in research/gameqa-20261021/FREEZE.json.
// Writes <out>/<runId>/{meta,reports,score,stats}.json and calls.jsonl (model outputs and spend, no prompts); the model
// journal goes to experiments/runs/gameqa-web/<runId>/journal.sqlite (ignored: it can carry host account identity).
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { launchBrowser, openSession } from '../../beds/gameqa-web/driver.mjs';
import { loadTruth, scoreReports, freezeManifest } from '../../beds/gameqa-web/oracle.mjs';
import { createModelPort } from '../lib/models.mjs';
import { runMonkey, runAgent, runWorkflow, makeCaller, mulberry32 } from './arms.mjs';
import { promptDigests } from './prompts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const MODEL = 'claude-haiku-5-5';
export const BUDGETS = Object.freeze({
  monkey: { exploreTicks: 8000, minimizeTestsPerCandidate: 400 },
  agent: { exploreTicks: 8000, maxTurns: 40, usdPerRun: 0.5 },
  workflow: { exploreTicks: 8000, usdPerRun: 0.5 },
  'workflow-random': { exploreTicks: 8000, usdPerRun: 0.5 },
});

const { values: a } = parseArgs({ options: { arm: { type: 'string' }, rep: { type: 'string' }, live: { type: 'boolean', default: false }, dev: { type: 'boolean', default: false },
  out: { type: 'string', default: path.join(ROOT, 'research/gameqa-20261021/runs') }, tag: { type: 'string', default: 'gqa1' } } });
if (!BUDGETS[a.arm] || !/^\d+$/.test(a.rep ?? '')) { console.error('usage: run.mjs --arm monkey|agent|workflow|workflow-random --rep N [--live] [--dev]'); process.exit(2); }
const paid = a.arm !== 'monkey';
if (paid && !a.live) { console.error('this arm makes paid Haiku calls: pass --live'); process.exit(2); }
const manifest = freezeManifest();
const frozenFile = path.join(ROOT, 'research/gameqa-20261021/FREEZE.json');
if (!a.dev) {
  if (!existsSync(frozenFile)) { console.error('no FREEZE.json: freeze the bed first (or pass --dev for a development run)'); process.exit(2); }
  const frozen = JSON.parse(readFileSync(frozenFile, 'utf8'));
  if (frozen.bed.sha256 !== manifest.sha256) { console.error(`bed changed since the freeze (${frozen.bed.sha256} vs ${manifest.sha256})`); process.exit(2); }
}
const runId = `${a.tag}-${a.arm}-r${a.rep}`;
const outDir = path.join(a.out, runId);
if (existsSync(path.join(outDir, 'score.json'))) { console.error(`${outDir} already has a score: refusing to overwrite`); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const callsFile = path.join(outDir, 'calls.jsonl');
rmSync(callsFile, { force: true });
const log = e => appendFileSync(callsFile, `${JSON.stringify({ t: new Date().toISOString(), ...e })}\n`);
const seed32 = parseInt(createHash('sha256').update(runId).digest('hex').slice(0, 8), 16);
const rng = mulberry32(seed32);
const B = BUDGETS[a.arm];

const truth = loadTruth();
const browser = await launchBrowser();
const session = await openSession(browser, { flags: truth.build.flags });
let port = null, policyHash = null, caller = null, db = null;
if (paid) {
  const journalFile = path.join(ROOT, 'experiments/runs/gameqa-web', runId, 'journal.sqlite');
  ({ port, policyHash, db } = createModelPort({ journalFile, allowedModels: [MODEL], maxBudgetUsdPerCall: 0.25 }));
  caller = makeCaller({ port, runId, modelId: MODEL, usdCap: B.usdPerRun, log });
}
const t0 = Date.now();
let result, error = null;
try {
  if (a.arm === 'monkey') result = await runMonkey({ session, rng, budgets: B });
  else if (a.arm === 'agent') result = await runAgent({ session, caller, budgets: B });
  else if (a.arm === 'workflow') result = await runWorkflow({ session, caller, rng, budgets: B, explore: 'personas', log });
  else {
    const pairFile = path.join(a.out, `${a.tag}-workflow-r${a.rep}`, 'constructed.json');
    if (!existsSync(pairFile)) throw new Error(`workflow-random reuses the construction of ${pairFile}: run that first`);
    result = await runWorkflow({ session, caller, rng, budgets: B, explore: 'random', constructed: JSON.parse(readFileSync(pairFile, 'utf8')), log });
  }
} catch (e) { error = e.stack ?? String(e); result = { reports: [], stats: { failed: 'exception' } }; }
const wallMs = Date.now() - t0;
await session.close();
const s0 = Date.now();
const score = await scoreReports(browser, result.reports, { truth });
await browser.close();
db?.close();

writeFileSync(path.join(outDir, 'reports.json'), `${JSON.stringify(result.reports, null, 1)}\n`);
writeFileSync(path.join(outDir, 'score.json'), `${JSON.stringify(score, null, 1)}\n`);
const { constructed, ...rest } = result;
if (constructed) writeFileSync(path.join(outDir, 'constructed.json'), `${JSON.stringify(constructed, null, 1)}\n`);
writeFileSync(path.join(outDir, 'stats.json'), `${JSON.stringify(rest.stats ? { ...rest, reports: undefined } : {}, null, 1)}\n`);
const meta = { runId, arm: a.arm, rep: Number(a.rep), dev: a.dev, model: paid ? MODEL : null, policyHash, bed: manifest.sha256, prompts: promptDigests(), budgets: B,
  rngSeed: seed32, started: new Date(t0).toISOString(), wallMs, scoreMs: Date.now() - s0, cost: caller ? { ...caller.stats } : { spent: 0, calls: 0 }, error, summary: score.summary };
writeFileSync(path.join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 1)}\n`);
console.log(JSON.stringify({ runId, wallS: Math.round(wallMs / 1000), usd: meta.cost.spent, calls: meta.cost.calls, ...score.summary, error: error ? error.split('\n')[0] : null }));
