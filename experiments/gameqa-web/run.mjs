#!/usr/bin/env node
// Run one arm of GQA-1 once, then score its reports with the oracle.
//   node experiments/gameqa-web/run.mjs --arm monkey|monkey-ref|agent|workflow|workflow-random --rep N [--live] [--dev] [--out DIR] [--transport nb]
// Amendment A1 (PREREG-GQA-1, 2026-11-04): every paid call goes through withRateLimitRetry (an HTTP 429 is retried after
// 60 s and 180 s; nothing the model sees changes), and --transport nb (tag gqa1nb, the secondary sensitivity arm) also drops
// the CLI's --max-budget-usd flag, so the model's context carries no "USD budget" line (transport.mjs).
// Amendment A2 (2026-11-04, review fixes): arm agent-matched (tag gqa2, --transport nb only; arms.mjs runAgentMatched); every
// paid run records the claude CLI version at its start and end (meta.cli; finding m1) and, per call, whether the CLI got the
// budget flag (calls.jsonl rows transport: 'cli-args'; finding m2); a preflight refuses to start when the transport does not
// do what its label says; Playwright's temp folders go to a per-run TMPDIR that is deleted at the end (finding m8).
// Haiku arms need --live (paid). Unless --dev, the bed must match the frozen manifest in research/gameqa-20261021/FREEZE.json.
// Writes <out>/<runId>/{meta,reports,score,stats}.json and calls.jsonl (model outputs and spend, no prompts); the model
// journal goes to experiments/runs/gameqa-web/<runId>/journal.sqlite (ignored: it can carry host account identity).
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, rmSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { launchBrowser, openSession } from '../../beds/gameqa-web/driver.mjs';
import { loadTruth, scoreReports, freezeManifest } from '../../beds/gameqa-web/oracle.mjs';
import { createModelPort } from '../lib/models.mjs';
import { runMonkey, runAgent, runAgentMatched, runWorkflow, makeCaller, mulberry32 } from './arms.mjs';
import { compileChecks } from './qa-lib.mjs';
import { promptDigests } from './prompts.mjs';
import { omitCliBudgetFlag, withRateLimitRetry, auditCliArgs } from './transport.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const MODEL = 'claude-haiku-5-5';
export const BUDGETS = Object.freeze({
  monkey: { exploreTicks: 8000, minimizeTestsPerCandidate: 400 },
  'monkey-ref': { exploreTicks: 8000, minimizeTestsPerCandidate: 400 },
  agent: { exploreTicks: 8000, maxTurns: 40, usdPerRun: 0.5 },
  // amendment A1 secondary: the agent whose early "finish" is refused until its last turn (run with --transport nb only)
  'agent-persist': { exploreTicks: 8000, maxTurns: 40, usdPerRun: 0.5, persist: true },
  // amendment A2: the prompt-matched, append-only, restarting agent with the dollars of a workflow run (the measured mean of
  // the five frozen gqa1/workflow runs, $0.335 / 5 = $0.067) and its ticks (run with --transport nb only, tag gqa2)
  'agent-matched': { exploreTicks: 8000, maxTurns: 40, maxTotalTurns: 100, usdPerRun: 0.067 },
  workflow: { exploreTicks: 8000, usdPerRun: 0.5 },
  'workflow-random': { exploreTicks: 8000, usdPerRun: 0.5 },
});

// The cheap model of the paid arms. Haiku is the preregistered model; mercury-3 (the owner's second cheap executor, listed
// at $0 with a token allowance) is an exploratory secondary: hard token caps instead of a dollar cap, its own run tag.
export const MODELS = Object.freeze({
  'claude-haiku-5-5': { tag: 'gqa1', decoding: { reasoning: 'low' } },
  'mercury-3': { tag: 'gqa1m3', exploratory: true, tokenCap: 3_000_000, callTokens: 120_000, decoding: { reasoning: 'low', maxTokens: 12000 } },
});
const { values: a } = parseArgs({ options: { arm: { type: 'string' }, rep: { type: 'string' }, live: { type: 'boolean', default: false }, dev: { type: 'boolean', default: false },
  out: { type: 'string', default: path.join(ROOT, 'research/gameqa-20261021/runs') }, tag: { type: 'string' }, model: { type: 'string', default: MODEL },
  transport: { type: 'string', default: 'cli' } } });
if (!BUDGETS[a.arm] || !/^\d+$/.test(a.rep ?? '') || !MODELS[a.model]) { console.error('usage: run.mjs --arm monkey|monkey-ref|agent|agent-persist|agent-matched|workflow|workflow-random --rep N [--live] [--dev] [--model claude-haiku-5-5|mercury-3] [--transport cli|nb] [--tag T]'); process.exit(2); }
if (!['cli', 'nb'].includes(a.transport) || (a.transport === 'nb' && a.model !== MODEL)) { console.error('--transport is cli (default) or nb (Haiku only: the CLI budget line removed)'); process.exit(2); }
if (a.arm === 'agent-persist' && a.transport !== 'nb') { console.error('agent-persist is an amendment-A1 arm: it runs with --transport nb only'); process.exit(2); }
if (a.arm === 'agent-matched' && a.transport !== 'nb') { console.error('agent-matched is an amendment-A2 arm: it runs with --transport nb only'); process.exit(2); }
const paid = !['monkey', 'monkey-ref'].includes(a.arm);
if (paid && !a.live) { console.error('this arm makes paid model calls: pass --live'); process.exit(2); }
const M = MODELS[a.model];
a.tag ??= paid ? (a.arm === 'agent-matched' ? 'gqa2' : a.transport === 'nb' ? `${M.tag}nb` : M.tag) : 'gqa1';
if (!/^[a-z0-9]+$/.test(a.tag)) { console.error('--tag is lower-case letters and digits'); process.exit(2); }
const manifest = freezeManifest();
const frozenFile = path.join(ROOT, 'research/gameqa-20261021/FREEZE.json');
if (!a.dev) {
  if (!existsSync(frozenFile)) { console.error('no FREEZE.json: freeze the bed first (or pass --dev for a development run)'); process.exit(2); }
  const frozen = JSON.parse(readFileSync(frozenFile, 'utf8'));
  if (frozen.bed.sha256 !== manifest.sha256) { console.error(`bed changed since the freeze (${frozen.bed.sha256} vs ${manifest.sha256})`); process.exit(2); }
  // A comparative paid run needs the arms section frozen (PREREG-GQA-1) and every arm file unchanged since.
  if (paid) {
    const { checkFreeze } = await import('./freeze.mjs');
    const c = checkFreeze();
    if (!c.armsFrozen || !c.armsMatch) { console.error(`paid runs need the arms frozen and unchanged (frozen: ${c.armsFrozen}; changed: ${c.changedArmFiles.join(', ') || 'none'})`); process.exit(2); }
  }
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

let port = null, policyHash = null, caller = null, db = null, tokens = null, policy = null;
const cli = { start: null, end: null };
// cli.start: the version the provider probed (cached per process, the one its journal records for every call); cli.end: a
// fresh probe after the run, so a CLI update during a run shows as start != end.
const cliFresh = () => { try { return `claude-code ${execFileSync(port.providers['claude-cli'].binary, ['--version'], { encoding: 'utf8', timeout: 30000 }).trim().split(/\s+/)[0]}`; } catch (e) { return `unknown (${e.code ?? e.message})`; } };
if (paid) {
  const journalFile = path.join(ROOT, 'experiments/runs/gameqa-web', runId, 'journal.sqlite');
  ({ port, policyHash, db, tokens, policy } = createModelPort({ journalFile, allowedModels: [a.model], maxBudgetUsdPerCall: 0.25,
    ...(M.tokenCap ? { tokenCap: M.tokenCap, callTokens: M.callTokens } : {}) }));
  if (a.transport === 'nb') omitCliBudgetFlag(port);
  if (port.providers['claude-cli']) {
    // preflight: the transport must do what its label says before any paid call (A2, m2)
    const entry = policy.models.find(m => m.id === a.model);
    const flag = port.providers['claude-cli'].args({ modelEntry: entry, system: 'preflight', schema: { type: 'object' }, decoding: M.decoding }).includes('--max-budget-usd');
    if (flag !== (a.transport === 'cli')) { console.error(`transport ${a.transport}: the CLI arguments ${flag ? 'still hold' : 'lack'} --max-budget-usd`); process.exit(2); }
    auditCliArgs(port, log);
    cli.start = await port.providers['claude-cli'].engineVersion().catch(e => `unknown (${e.code ?? e.message})`);
  }
  caller = makeCaller({ port: withRateLimitRetry(port, { log }), runId, modelId: a.model, usdCap: B.usdPerRun, decoding: M.decoding, log });
}
// Playwright leaves playwright-tracing-* folders in the temp dir; give this run its own and delete it at the end (m8).
const prevTmp = process.env.TMPDIR, runTmp = mkdtempSync(path.join(os.tmpdir(), `gqa-${runId}-`));
process.env.TMPDIR = runTmp;
const truth = loadTruth();
const browser = await launchBrowser();
const session = await openSession(browser, { flags: truth.build.flags });
const t0 = Date.now();
let result, error = null;
try {
  if (a.arm === 'monkey') result = await runMonkey({ session, rng, budgets: B });
  // calibration only (oracle-informed checks written by the bed author): never a comparative arm
  else if (a.arm === 'monkey-ref') result = await runMonkey({ session, rng, budgets: B, checks: compileChecks(JSON.parse(readFileSync(path.join(ROOT, 'experiments/gameqa-web/reference-checks.json'), 'utf8')).checks).checks });
  else if (a.arm === 'agent' || a.arm === 'agent-persist') result = await runAgent({ session, caller, budgets: B });
  else if (a.arm === 'agent-matched') result = await runAgentMatched({ session, caller, budgets: B });
  else if (a.arm === 'workflow') result = await runWorkflow({ session, caller, rng, budgets: B, explore: 'personas', log });
  else {
    const pairFile = path.join(a.out, `${a.tag}-workflow-r${a.rep}`, 'constructed.json');
    if (!existsSync(pairFile)) throw new Error(`workflow-random reuses the construction of ${pairFile}: run that first`);
    result = await runWorkflow({ session, caller, rng, budgets: B, explore: 'random', constructed: JSON.parse(readFileSync(pairFile, 'utf8')), log });
  }
} catch (e) { error = e.stack ?? String(e); result = { reports: [], stats: { failed: 'exception' } }; }
const wallMs = Date.now() - t0;
if (cli.start) cli.end = cliFresh();
await session.close();
const s0 = Date.now();
const score = await scoreReports(browser, result.reports, { truth });
await browser.close();
db?.close();
if (prevTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = prevTmp;
rmSync(runTmp, { recursive: true, force: true });

writeFileSync(path.join(outDir, 'reports.json'), `${JSON.stringify(result.reports, null, 1)}\n`);
writeFileSync(path.join(outDir, 'score.json'), `${JSON.stringify(score, null, 1)}\n`);
const { constructed, ...rest } = result;
if (constructed) writeFileSync(path.join(outDir, 'constructed.json'), `${JSON.stringify(constructed, null, 1)}\n`);
writeFileSync(path.join(outDir, 'stats.json'), `${JSON.stringify(rest.stats ? { ...rest, reports: undefined } : {}, null, 1)}\n`);
const meta = { runId, arm: a.arm, rep: Number(a.rep), dev: a.dev, model: paid ? a.model : null, transport: paid ? a.transport : null, exploratory: paid ? Boolean(M.exploratory) : false, policyHash, bed: manifest.sha256,
  ...(cli.start ? { cli } : {}),
  prompts: promptDigests(), budgets: B, rngSeed: seed32, started: new Date(t0).toISOString(), wallMs, scoreMs: Date.now() - s0,
  cost: caller ? { ...caller.stats } : { spent: 0, calls: 0 }, tokenMeter: tokens ? tokens() : null, error, summary: score.summary };
writeFileSync(path.join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 1)}\n`);
console.log(JSON.stringify({ runId, wallS: Math.round(wallMs / 1000), usd: meta.cost.spent, calls: meta.cost.calls, ...score.summary, error: error ? error.split('\n')[0] : null }));
