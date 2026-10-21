// OT-0 paid agent arms on the sized overlay world (research/org-20261021/PREREG-OT0.md, draft; NOT RUN at $0 except --dry):
//   A-F   a frontier agent alone, one fresh session per case-tick (experiments/ebed/agent-arm.mjs agentArm), with the
//         constitution in its prompt and contract (arms.mjs) and the registry in ctx.files: Sonnet 5.5, and Opus 5.5
//   A-HV  agent-H + validator (experiments/agentv/arm.mjs agentVArm, Haiku 5.5) with the same constitution inputs
// The world is E8 1232 d2 size 12 under the overlay (14 completed cases; one refund needs approval: o0012's EUR 437.93).
// METERED: every tick is a model session; a total cap stops the stream with a host QuotaStop (cases still open are
// censored). Grading ($0, analyst side): the E8 oracle, E8 + C2 overlay, the observer's C1-C3 and the auditor.
//   node experiments/constitution/run-agents.mjs --arm A-F --model claude-sonnet-5-5 --label af-sonnet-s12 --cap 20
//   node experiments/constitution/run-agents.mjs --arm A-F --model claude-opus-5-5 --label af-opus-s12 --cap 45
//   node experiments/constitution/run-agents.mjs --arm A-HV --model claude-haiku-5-5 --label ahv-s12 --cap 5
//   node experiments/constitution/run-agents.mjs --arm A-F --model claude-sonnet-5-5 --label dry-af --dry    ($0 wiring check)
import { writeFileSync, mkdirSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost, bindItem } from '../../beds/ebed/host/host.mjs';
import { resumeRun } from '../../beds/ebed/host/replay.mjs';
import { agentArm } from '../ebed/agent-arm.mjs';
import { agentVArm } from '../agentv/arm.mjs';
import { contractText } from '../ebed/build.mjs';
import { capped } from '../ebed/run-agent.mjs';
import { runClaudeCode } from '../../src/executors/claude-code.mjs';
import { executorForModel } from '../../src/executors/openai-chat.mjs';
import { loadPolicy } from '../../src/models/policy.mjs';
import { baseWorld, overlayWorld, overlayBinding } from './overlay.mjs';
import { buildRegistry } from './registry.mjs';
import { withConstitutionFiles, constitutionRunner, contractWithConstitution } from './arms.mjs';
import { assessRun, ROOT } from './run.mjs';

export const SIZED = Object.freeze({ seed: 1232, d: 2, size: 12 });
export const PAID_MODELS = Object.freeze({ 'A-F': ['claude-sonnet-5-5', 'claude-opus-5-5'], 'A-HV': ['claude-haiku-5-5'] });
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

/** The $0 scripted session for --dry: it writes a minimal valid output (closes the instance), proving the wiring only. */
export const dryRunner = async ({ workdir, prompt }) => {
  if (!/Hollin Retail B\.V\. runs this order process under a constitution/.test(prompt)) throw new Error('dry: the constitution is not in the prompt');
  const files = ['CONTRACT.md', 'files/constitution/log.json'].filter(f => existsSync(path.join(workdir, f)));
  writeFileSync(path.join(workdir, 'output.json'), JSON.stringify({ decisions: { subject: null, constitution: { pins: {} } }, carry: null, close: true }));
  return { costUsd: 0, turns: 0, error: null, seen: files };
};

/** Build the arm (no host). */
export function makeAgentArm({ arm, model, label, workRoot, journal, dry = false, tickBudget, tickMinutes, registry }) {
  const contract = contractWithConstitution(contractText());
  const real = dry ? null : executorForModel(loadPolicy().policy, model).run;
  const runner = dry ? dryRunner : constitutionRunner(arm === 'A-HV' ? runClaudeCode : real);
  const inner = arm === 'A-HV'
    ? agentVArm({ id: label, model, workRoot, contract, budgetUsdPerTick: tickBudget, minutesPerTick: tickMinutes, journal, schemas: bindItem(overlayBinding).schemas, retries: 1, runner })
    : agentArm({ id: label, model, workRoot, contract, budgetUsdPerTick: tickBudget, minutesPerTick: tickMinutes, journal, runner });
  return withConstitutionFiles(inner, registry);
}

async function main() {
  const arm = arg('--arm', null), model = arg('--model', null), label = arg('--label', null);
  const dry = process.argv.includes('--dry');
  if (!PAID_MODELS[arm]) throw new Error(`--arm must be ${Object.keys(PAID_MODELS).join(' or ')}`);
  if (!PAID_MODELS[arm].includes(model)) throw new Error(`--model for ${arm} must be one of ${PAID_MODELS[arm].join(', ')} (policy/models.json ids)`);
  if (!label) throw new Error('--label is required');
  if (dry && !label.startsWith('dry-')) throw new Error('a --dry label must start with dry-');
  const cap = Number(arg('--cap', dry ? '0' : 'NaN'));
  if (!dry && !(cap > 0 && cap <= 50)) throw new Error('--cap (USD, at most 50 per arm) is required for a paid run');
  const tickBudget = Number(arg('--tick-budget', arm === 'A-HV' ? '0.4' : '1')), tickMinutes = Number(arg('--tick-minutes', '8'));
  const liveDir = path.join(dry ? '/var/tmp/foundry-work/ot0-dry' : '/var/tmp/foundry-work/ot0-arms', label);
  const outDir = dry ? liveDir : path.join(ROOT, 'research/org-20261021/runs', label);
  if (existsSync(path.join(outDir, 'result.json'))) throw new Error(`${outDir}/result.json exists`);
  mkdirSync(liveDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
  const registry = buildRegistry();
  const W = overlayWorld(baseWorld(SIZED), { registry });
  const liveTicks = path.join(liveDir, 'ticks.jsonl');
  const spent = { usd: existsSync(liveTicks) ? readFileSync(liveTicks, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).reduce((a, x) => a + (x.costUnknown ? (x.costUpperUsd ?? 0) : (x.costUsd ?? 0)), 0) : 0 };
  const inner = makeAgentArm({ arm, model, label, workRoot: path.join(liveDir, 'work'), journal: liveTicks, dry, tickBudget, tickMinutes, registry });
  const a = dry ? inner : capped(inner, cap, spent);
  const journalFile = path.join(liveDir, 'journal.jsonl'), blobDir = path.join(liveDir, 'blobs');
  const hostOpts = { item: overlayBinding, world: W, arm: a, concurrency: 4, callTimeoutMs: (tickMinutes + 1) * 60_000, journalFile, blobDir };
  const t = Date.now();
  let status, host;
  try {
    if (existsSync(journalFile)) { const r = await resumeRun(hostOpts); status = r.status; host = r.host; }
    else { host = createHost(hostOpts); status = (await host.run()).status; }
  } catch (e) { status = `host-error: ${String(e?.message ?? e).slice(0, 200)}`; }
  if (!host) throw new Error(status);
  const run = { world: W, rows: host.journal.contentRows(), full: host.journal.rows.map(r => ({ ...r })), status, port: null };
  const assessed = await assessRun({ spec: SIZED, arm, run, registry, workflowHash: null });
  const costs = run.rows.filter(r => r.type === 'call').flatMap(r => r.costs ?? []);
  const result = { label, arm, model, dry, capUsd: cap, spentUsd: spent.usd, costUsd: costs.reduce((s, c) => s + (c.costUsd ?? 0), 0), costUnknown: costs.filter(c => c.costUnknown).length,
    tickBudgetUsd: tickBudget, tickMinutes, wallMs: Date.now() - t, world: SIZED, ...assessed };
  writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 1));
  if (!dry && existsSync(liveTicks)) copyFileSync(liveTicks, path.join(outDir, 'ticks.jsonl'));
  console.log(`${label}: ${status}; E8 ${assessed.e8.passed}/${assessed.e8.completed}, +C2 ${assessed.overlay.passed}/${assessed.overlay.completed}; C1 ${JSON.stringify(assessed.observer.C1)} C2 ${JSON.stringify(assessed.observer.C2)} C3 ${JSON.stringify(assessed.observer.C3)}; $${result.costUsd.toFixed(2)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
