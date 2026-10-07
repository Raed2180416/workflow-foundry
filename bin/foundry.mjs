#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, statSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { Foundry, packageRoot, parseCandidate, skillCatalog } from '../src/foundry.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { modelNodes, validateWorkflow, workflowSchema } from '../src/validate.mjs';
import { loadComponents } from '../src/components.mjs';
import { install, uninstall } from '../src/install.mjs';
import { claudeHookResult } from '../src/hooks.mjs';
import { errorData, FoundryError, checkData } from '../src/data.mjs';

const definitions = {
  workspace: { type: 'string' }, project: { type: 'string' }, client: { type: 'string' },
  'no-hooks': { type: 'boolean' }, 'dry-run': { type: 'boolean' },
  input: { type: 'string' }, file: { type: 'string' }, fixture: { type: 'string' },
  'expected-hash': { type: 'string' }, request: { type: 'string' }, workflow: { type: 'string' },
  domain: { type: 'string' }, task: { type: 'string' }, text: { type: 'string' },
  rationale: { type: 'string' }, out: { type: 'string' }, port: { type: 'string' },
  components: { type: 'string' }, node: { type: 'string' }, answer: { type: 'string' },
  approved: { type: 'boolean' }, rejected: { type: 'boolean' },
  'no-skills': { type: 'boolean' }, help: { type: 'boolean', short: 'h' }
  , agent: { type: 'string' }, model: { type: 'string' }, rounds: { type: 'string' }, 'generation-timeout': { type: 'string' }, 'auto-apply': { type: 'boolean' }
  , suite: { type: 'string' }
  , 'failed-run': { type: 'string' }, diagnostic: { type: 'string' }, proposal: { type: 'string' }
  , 'artifact-name': { type: 'string' }, expected: { type: 'string' }, 'evaluator-id': { type: 'string' }
  , contract: { type: 'string' }, receipt: { type: 'string' }, run: { type: 'string' }, 'max-depth': { type: 'string' }
  , 'outcome-repair': { type: 'boolean' }
  , policy: { type: 'string' }, 'model-mode': { type: 'string' }, salt: { type: 'string' }, 'max-cost': { type: 'string' }, assignment: { type: 'string' }
  , 'tick-interval': { type: 'string' }
};
// Model-run options (DESIGN §5.1): which commands accept them.
const runOnly = ['model-mode', 'salt', 'max-cost', 'assignment'];
const modelCommands = new Set(['run', 'resume', 'tick']);
function checkModelArguments(command, args) {
  const misplaced = [...runOnly.filter(name => args[name] !== undefined && command !== 'run'),
    ...(args.policy !== undefined && !modelCommands.has(command) && command !== 'validate' ? ['policy'] : []), ...(args['tick-interval'] !== undefined && command !== 'serve' ? ['tick-interval'] : [])];
  if (misplaced.length) throw new FoundryError('CLI_ARGUMENT', `--${misplaced[0]} is not supported by ${command}. Use --help.`);
  if (args['max-cost'] !== undefined && !/^(0|[1-9][0-9]{0,6})(\.[0-9]{1,6})?$/.test(args['max-cost'])) throw new FoundryError('CLI_ARGUMENT', '--max-cost must be a non-negative decimal number of USD');
  if (args['tick-interval'] !== undefined && !/^(0|[1-9][0-9]{0,4})$/.test(args['tick-interval'])) throw new FoundryError('CLI_ARGUMENT', '--tick-interval must be a whole number of seconds (0 turns the timer scan off)');
}
// The host (this CLI), never Foundry itself, wires a ModelPort: the owner policy, a journal in the workspace
// store and the policy's providers. A run in replay mode registers no provider, so it cannot reach a live model.
async function modelHost(args, command) {
  const [{ loadPolicy }, { ModelPort, MODES }, { Journal }] = await Promise.all([import('../src/models/policy.mjs'), import('../src/models/port.mjs'), import('../src/journal.mjs')]);
  const modelPolicy = loadPolicy(args.policy === undefined ? undefined : path.resolve(args.policy));
  const mode = args['model-mode'] ?? 'live';
  if (!MODES.includes(mode)) throw new FoundryError('RUN_OPTIONS', `--model-mode must be one of ${MODES.join('|')}`);
  const providers = {};
  if (!(command === 'run' && mode === 'replay') && process.env.FOUNDRY_MODEL_GATEWAY_URL) {
    // Inside a sandbox (executor or construction session) every model call goes to the host gateway,
    // which enforces the owner policy, the spend cap and its own journal; no provider runs locally.
    const { GatewayProvider } = await import('../src/models/providers/gateway.mjs');
    const gateway = new GatewayProvider();
    for (const name of Object.keys(modelPolicy.policy.providers)) providers[name] = gateway;
  } else if (!(command === 'run' && mode === 'replay')) {
    const [{ ClaudeCliProvider }, { LlamaServerProvider }] = await Promise.all([import('../src/models/providers/claude-cli.mjs'), import('../src/models/providers/llama-server.mjs')]);
    for (const [name, config] of Object.entries(modelPolicy.policy.providers)) {
      if (config.kind === 'claude-cli') providers[name] = new ClaudeCliProvider({ policy: modelPolicy.policy, providerName: name });
      else if (config.kind === 'openai-compatible-http') providers[name] = new LlamaServerProvider({ policy: modelPolicy.policy, providerName: name });
    }
  }
  return { modelPolicy, mode, models: store => new ModelPort({ policy: modelPolicy.policy, providers, journal: new Journal(store) }) };
}
// ROADMAP §2.6 keeps maxCost at 0 by default. A live run that could reach a priced model is refused before
// any call unless an explicit --max-cost covers it (the runtime still stops at the budget after each call).
async function requireSpendBudget(workflow, { policy }, { mode, maxCost, assignment }) {
  if (mode === 'replay') return;
  const { classIndex, modelById } = await import('../src/models/policy.mjs');
  const limit = Math.min(maxCost, workflow.budget.maxCost ?? maxCost);
  if (limit > 0) return;
  for (const node of modelNodes(workflow)) {
    const top = node.model.maxClass ?? node.model.class ?? modelById(policy, node.model.id).class;
    const reachable = policy.models.filter(m => classIndex(policy, m.class) <= classIndex(policy, top) || Object.values(assignment ?? {}).includes(m.id));
    const priced = reachable.filter(m => m.price.inputPerMTok > 0 || m.price.outputPerMTok > 0).map(m => m.id);
    if (priced.length) throw new FoundryError('COST_BUDGET_REQUIRED', `${node.id} can reach priced model(s) ${priced.join(', ')} but the cost budget is 0; pass --max-cost USD (or --model-mode replay)`);
  }
}
const callSummary = row => ({ id: row.id, nodeKey: row.nodeKey, attempt: row.attempt, sampleIndex: row.sampleIndex, modelId: row.modelId, provider: row.provider,
  engineVersion: row.engineVersion, ok: row.ok, errorCode: row.errorCode, inputTokens: row.inputTokens, outputTokens: row.outputTokens, costUsd: row.costUsd,
  imputedUsd: row.imputedUsd, latencyMs: row.latencyMs, replayOf: row.request?.replayOf ?? null, replayKey: row.replayKey, receiptHash: row.receiptHash, createdAt: row.createdAt });
const outcomeCommands = {
  'outcome-contract': { required: ['request', 'input', 'artifact-name', 'expected', 'evaluator-id'], optional: [], items: 0 },
  'outcome-observe': { required: ['request', 'proposal', 'contract'], optional: [], items: 1 },
  'outcome-repair-request': { required: ['receipt', 'request', 'run', 'expected-hash'], optional: ['diagnostic', 'max-depth'], items: 0 },
  'outcome-context': { required: ['request'], optional: ['domain', 'no-skills'], items: 0 },
  'outcome-propose': { required: ['request'], optional: ['rationale'], items: 1 },
  'outcome-apply': { required: [], optional: [], items: 1 }
};
function checkOutcomeArguments(command, args, positionals) {
  const spec = outcomeCommands[command];
  const allowed = new Set(['workspace', 'project', 'components', ...spec.required, ...spec.optional]);
  for (const name of Object.keys(args)) {
    if (!allowed.has(name)) throw new FoundryError('OUTCOME_CLI_ARGUMENT', `--${name} is not supported by ${command}; use its explicit command arguments.`);
  }
  for (const name of spec.required) {
    if (typeof args[name] !== 'string' || !args[name].trim()) throw new FoundryError('OUTCOME_CLI_ARGUMENT', `${command} requires --${name}.`);
  }
  if (positionals.length !== spec.items + 1 || positionals.slice(1).some(value => !value.trim())) {
    throw new FoundryError('OUTCOME_CLI_ARGUMENT', `${command} requires exactly ${spec.items} positional argument(s). Use --help.`);
  }
}
function readJson(file) {
  if (!file) throw new FoundryError('ARGUMENT', 'A JSON file is required');
  if (statSync(file).size > 2 * 1024 * 1024) throw new FoundryError('FILE_LIMIT', 'JSON input exceeds two MiB');
  return checkData(JSON.parse(readFileSync(file, 'utf8')));
}
function jsonValue(value, fallback = {}) {
  if (value === undefined) return fallback;
  return existsSync(value) ? readJson(value) : checkData(JSON.parse(value));
}
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
const usage = `Workflow Foundry 0.1.0 — experimental, source/evidence qualified\n\n` +
`  foundry doctor | schema | capabilities | skills\n` +
`  foundry install --project PATH --client opencode|claude|cursor|codex|generic [--dry-run] [--no-hooks]\n` +
`  foundry uninstall INSTALL_ID --project PATH [--dry-run]\n` +
`  foundry validate WORKFLOW.json [--components TRUSTED_MANIFEST.json]\n` +
`  foundry import WORKFLOW.json [--expected-hash HASH] --workspace PATH\n` +
`  foundry prompt --task TEXT [--domain sre] [--out prompt.txt]\n` +
`  foundry request --text TEXT [--workflow ID] --workspace PATH\n` +
`  foundry prompt --request REQUEST_ID --workspace PATH\n` +
`  foundry trial CANDIDATE.json --request REQUEST_ID --input JSON_OR_FILE --workspace PATH\n` +
`  foundry inspect-trial TRIAL_ID --workspace PATH\n` +
`  foundry repair-request --request REQUEST_ID --failed-run RUN_ID --expected-hash HASH [--diagnostic TEXT]\n` +
`  foundry outcome-contract --request ID --input JSON_OR_FILE --artifact-name NAME --expected JSON_OR_FILE --evaluator-id ID\n` +
`  foundry outcome-observe RUN_ID --request ID --proposal ID --contract HASH\n` +
`  foundry outcome-history --receipt HASH --workspace PATH  (read-only historical inspection)\n` +
`  foundry outcome-repair-request --receipt HASH --request ID --run ID --expected-hash HASH [--diagnostic TEXT] [--max-depth 3]\n` +
`  foundry outcome-context --request ID [--domain software] [--no-skills]\n` +
`  foundry outcome-propose CANDIDATE.json --request ID [--rationale TEXT]\n` +
`  foundry outcome-apply PROPOSAL_ID\n` +
`  foundry delivery RUN_ID --request REQUEST_ID --proposal PROPOSAL_ID --workspace PATH\n` +
`  foundry generate --task TEXT|--request ID --agent opencode-free --model OBSERVED_FREE_ID [--auto-apply]\n` +
`  foundry generate --task TEXT|--request ID --agent opencode-v2-free --model opencode/big-pickle\n` +
`  foundry generate --outcome-repair --request ID --agent opencode-free|opencode-v2-free --model OBSERVED_FREE_ID\n` +
`  foundry construct-compare [PROGRAM.json]\n` +
`  foundry construct-intent [PROGRAM.json]\n` +
`  foundry construct-objective [PROGRAM.json|--text OBJECTIVE]\n` +
`  foundry evaluate WORKFLOW_ID_OR_FILE --suite TRUSTED_SUITE.json --workspace PATH\n` +
`  foundry propose CANDIDATE.json --request REQUEST_ID [--rationale TEXT] --workspace PATH\n` +
`  foundry apply PROPOSAL_ID --workspace PATH\n` +
`  foundry run WORKFLOW_ID_OR_FILE --input JSON_OR_FILE [--fixture LOCAL_SIMULATOR.json] --workspace PATH\n` +
`      [--policy MODEL_POLICY.json] [--model-mode live|replay|replay-or-live] [--salt TEXT]\n` +
`      [--max-cost USD] [--assignment ASSIGNMENT.json]\n` +
`  foundry inspect RUN_ID --workspace PATH\n` +
`  foundry resume RUN_ID [--policy MODEL_POLICY.json] --workspace PATH\n` +
`  foundry tick [--policy MODEL_POLICY.json] --workspace PATH  (resume runs whose wait timers are due)\n` +
`  foundry calls --run RUN_ID --workspace PATH  (journaled model calls with cost)\n` +
`  foundry answer RUN_ID --node root/NODE --answer JSON --workspace PATH\n` +
`  foundry approve RUN_ID APPROVAL_ID --approved|--rejected --workspace PATH\n` +
`  foundry serve --workspace PATH [--port 4177] [--tick-interval SECONDS] [--agent opencode-free|opencode-v2-free --model OBSERVED_FREE_ID --auto-apply]\n` +
`  foundry mcp --workspace PATH\n\n` +
`Models construct candidates using skills/MCP. This CLI does not pretend a template\n` +
`is model generation. A host-selected component manifest launches trusted MCP\n` +
`servers; never supply an unreviewed model-authored manifest. Local success is\n` +
`not proof of commercial parity or arbitrary deployment safety.\n` +
`Outcome commands use --workspace PATH. Observation prints satisfied/unsatisfied/unknown;\n` +
`a recorded receipt does not itself dispatch generation, apply a proposal, or execute a run.\n\n` +
`Agent and model-verifier nodes use only model ids from the owner policy (default policy/models.json);\n` +
`resume and tick must use the policy the run was created with. --max-cost defaults to 0, and a live run\n` +
`that can reach a priced model is refused until it is set. --model-mode replay serves recorded calls\n` +
`only (same --salt) and registers no provider. --assignment maps node ids or keys to policy model ids.\n` +
`serve scans due wait timers every --tick-interval seconds (default 5; 0 turns it off).\n`;

async function main() {
  const { values: args, positionals } = parseArgs({ options: definitions, allowPositionals: true, strict: true });
  const [command = 'help', item, second] = positionals;
  if (args.help || command === 'help') { process.stdout.write(usage); return; }
  const outcomeCommand = Object.hasOwn(outcomeCommands, command);
  if (outcomeCommand) checkOutcomeArguments(command, args, positionals);
  checkModelArguments(command, args);
  if (args['outcome-repair'] && (command !== 'generate' || !args.request?.trim() || positionals.length !== 1 ||
      ['task', 'text', 'workflow', 'expected-hash'].some(name => args[name] !== undefined))) {
    throw new FoundryError('OUTCOME_CLI_ARGUMENT', 'Use generate --outcome-repair with one existing --request and no replacement task or workflow.');
  }
  if (args['outcome-repair'] && args['auto-apply']) {
    throw new FoundryError('OUTCOME_CLI_ARGUMENT', 'Outcome generation produces a proposal; use a separate outcome-apply command to reverify its evidence.');
  }
  const workspace = path.resolve(args.workspace ?? args.project ?? process.cwd());
  if (command === 'outcome-history') {
    if (positionals.length !== 1 || !/^[a-f0-9]{64}$/.test(args.receipt ?? '') ||
        Object.keys(args).some(name => !['receipt', 'workspace', 'project'].includes(name))) {
      throw new FoundryError('OUTCOME_CLI_ARGUMENT', 'Use outcome-history --receipt HASH --workspace PATH. No component, provider, execution or promotion options are accepted.');
    }
    // Handle history before component loading and Foundry/Store construction.
    // Read-only SQLite may use its ordinary WAL reader machinery; no workflow,
    // ledger, schema or artifact is created, initialized or changed here.
    const directory = path.join(realpathSync(workspace), '.foundry');
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) {
      throw new FoundryError('STATE_PATH', '.foundry must be an existing real directory');
    }
    for (const name of ['foundry.sqlite', 'foundry.sqlite-wal', 'foundry.sqlite-shm']) {
      try {
        if (lstatSync(path.join(directory, name)).isSymbolicLink()) throw new FoundryError('STATE_PATH', 'SQLite files must not be symlinks');
      } catch (error) { if (error.code !== 'ENOENT' || name === 'foundry.sqlite') throw error; }
    }
    if (!lstatSync(path.join(directory, 'foundry.sqlite')).isFile()) throw new FoundryError('STATE_PATH', 'An existing regular SQLite database is required');
    const { DatabaseSync } = await import('node:sqlite');
    const { inspectOutcomeHistory } = await import('../src/outcome-history.mjs');
    const db = new DatabaseSync(path.join(directory, 'foundry.sqlite'), { readOnly: true });
    try {
      db.exec('PRAGMA query_only=ON; BEGIN');
      const history = inspectOutcomeHistory({ db }, { receiptId: args.receipt, currentRegistryHash: createDefaultRegistry().hash() });
      db.exec('COMMIT'); print(history);
    } finally { db.close(); }
    return;
  }
  if (command === 'doctor') {
    const pkg = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    print({ version: pkg.version, source: packageRoot, node: process.version, supportedNode: Number(process.versions.node.split('.')[0]) >= 24,
      dependencyPins: pkg.dependencies, skillCount: skillCatalog().length,
      interfaces: ['CLI', 'MCP stdio', 'loopback visual UI', 'project-scoped client installer'],
      published: false, qualification: 'Run npm test and read evaluation receipts; doctor does not certify task quality.' }); return;
  }
  if (command === 'schema') { print(workflowSchema); return; }
  if (command === 'skills') { print(skillCatalog()); return; }
  if (command === 'install') { print(install(workspace, { client: args.client ?? 'generic', hooks: !args['no-hooks'], dryRun: args['dry-run'] })); return; }
  if (command === 'uninstall') { print(uninstall(workspace, item, { dryRun: args['dry-run'] })); return; }
  if (command === 'hook') {
    let text = ''; for await (const chunk of process.stdin) { text += chunk; if (text.length > 2 * 1024 * 1024) throw new FoundryError('HOOK_INPUT_LIMIT', 'Hook input is too large'); }
    print(claudeHookResult(workspace, JSON.parse(text))); return;
  }
  const components = args.components ? await loadComponents(args.components) : null;
  const registry = components?.registry ?? createDefaultRegistry();
  let foundry, persistent = false;
  try {
    if (command === 'capabilities') { print({ capabilities: registry.list(), registryHash: registry.hash() }); return; }
    if (command === 'validate') {
      const workflow = readJson(args.file ?? item);
      let modelPolicy;
      if (modelNodes(workflow).length || args.policy !== undefined) {
        const { loadPolicy } = await import('../src/models/policy.mjs');
        modelPolicy = loadPolicy(args.policy === undefined ? undefined : path.resolve(args.policy));
      }
      const result = validateWorkflow(workflow, { registry, ...(modelPolicy ? { modelPolicy } : {}) }); print(result); if (!result.valid) process.exitCode = 1; return;
    }
    if (command === 'construct-compare') {
      const { runConstructionProgram, bundledConstructionProgram } = await import('../src/construction.mjs');
      const program = (args.file ?? item) ? readJson(args.file ?? item) : bundledConstructionProgram();
      const report = runConstructionProgram(program);
      print(report); if (report.ok === false) process.exitCode = 1; return;
    }
    if (command === 'construct-intent') {
      const { runIntentProgram, bundledIntentProgram } = await import('../src/construction.mjs');
      const program = (args.file ?? item) ? readJson(args.file ?? item) : bundledIntentProgram();
      const report = runIntentProgram(program);
      print(report); if (report.ok === false) process.exitCode = 1; return;
    }
    if (command === 'construct-objective') {
      const construction = await import('../src/construction.mjs');
      if (args.text || args.task) {
        const built = construction.constructFromObjective({
          objective: args.text ?? args.task,
          provider: construction.createScriptedProvider('respecting')
        });
        print(built); return;
      }
      const program = (args.file ?? item) ? readJson(args.file ?? item) : construction.bundledObjectiveProgram();
      const report = construction.runObjectiveProgram(program);
      print(report); if (report.ok === false) process.exitCode = 1; return;
    }
    const host = modelCommands.has(command) ? await modelHost(args, command) : null;
    const maxCost = args['max-cost'] === undefined ? undefined : Number(args['max-cost']);
    foundry = new Foundry(workspace, { registry, ...(host ? { modelPolicy: host.modelPolicy, models: host.models } : {}), ...(maxCost === undefined ? {} : { policy: { maxCost } }) });
    // Ordinary routes retain their existing behavior for ordinary requests.
    // Outcome descendants require the coordinator's live evidence checks.
    if (['propose', 'apply', 'prompt', 'generate'].includes(command) && !args['outcome-repair']) {
      const requestId = command === 'apply' ? foundry.store.proposal(item).requestId : args.request;
      if (requestId) {
        const request = foundry.store.request(requestId);
        const ledgerExists = foundry.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='outcome_repairs'").get();
        const recorded = ledgerExists && foundry.store.db.prepare('SELECT 1 FROM outcome_repairs WHERE request_id=?').get(requestId);
        if (recorded || request.repairCause === 'observed-outcome' || Object.hasOwn(request, 'outcomeReceiptId')) {
          throw new FoundryError('OUTCOME_CLI_ROUTE', 'This is an outcome repair request. Use outcome-context, outcome-propose, outcome-apply, or generate --outcome-repair to preserve evidence verification.');
        }
      }
    }
    let outcomes;
    if (outcomeCommand || args['outcome-repair']) {
      const { OutcomeRepairCoordinator } = await import('../src/outcome-repair.mjs');
      outcomes = new OutcomeRepairCoordinator(foundry);
    }
    if (command === 'outcome-contract') {
      print(outcomes.registerContract({ requestId: args.request, input: jsonValue(args.input), artifactName: args['artifact-name'],
        expected: jsonValue(args.expected), evaluatorId: args['evaluator-id'] })); return;
    }
    if (command === 'outcome-observe') {
      print(outcomes.observe({ requestId: args.request, proposalId: args.proposal, runId: item, contractId: args.contract })); return;
    }
    if (command === 'outcome-repair-request') {
      print(outcomes.requestRepair({ receiptId: args.receipt, requestId: args.request, runId: args.run, expectedHash: args['expected-hash'],
        diagnostic: args.diagnostic ?? '', ...(args['max-depth'] === undefined ? {} : { maxDepth: Number(args['max-depth']) }) })); return;
    }
    if (command === 'outcome-context') {
      print(outcomes.designContext({ requestId: args.request, domain: args.domain, includeSkills: !args['no-skills'] })); return;
    }
    if (command === 'outcome-propose') {
      const candidate = readJson(item);
      print(outcomes.propose({ requestId: args.request, workflow: candidate.workflow ?? candidate,
        rationale: args.rationale ?? candidate.rationale })); return;
    }
    if (command === 'outcome-apply') { print(outcomes.apply(item)); return; }
    if (args.agent || command === 'generate') {
      if (!['opencode-free', 'opencode-v2-free'].includes(args.agent)) throw new FoundryError('GENERATOR_PROVIDER', 'Choose --agent opencode-free for the legacy interface or opencode-v2-free for the pinned v2 interface, with an explicitly selected observed free model. Other host agents use MCP or the generator library interface.');
      if (!args.model) throw new FoundryError('MODEL_ID', 'An explicit --model is required; this CLI never silently chooses a model or price tier.');
      const { WorkflowGenerator } = await import('../src/generator.mjs');
      const Provider = args.agent === 'opencode-v2-free'
        ? (await import('../src/opencode-v2-free.mjs')).OpenCodeV2FreeProvider
        : (await import('../src/opencode-free.mjs')).OpenCodeFreeProvider;
      const provider = new Provider({ model: args.model });
      const evaluator = args.suite ? (await import('../src/evaluation.mjs')).suiteEvaluator(readJson(args.suite), { registryFactory: () => registry }) : null;
      foundry.generator = new WorkflowGenerator(args['outcome-repair'] ? outcomes.generationHost() : foundry, provider, { maxRounds: args.rounds ? Number(args.rounds) : 3, maxDurationMs: args['generation-timeout'] ? Number(args['generation-timeout']) : 900000, autoApply: !!args['auto-apply'], evaluator });
    }
    if (command === 'generate') {
      const request = args.request ? foundry.store.request(args.request) : foundry.store.createRequest({ text: args.task ?? args.text ?? item, workflowId: args.workflow, baseHash: args['expected-hash'], source: 'user-cli' });
      const job = await foundry.generator.generate(request.id, { domain: args.domain });
      print(job); if (!['proposed', 'applied'].includes(job.status)) process.exitCode = 1; return;
    }
    if (command === 'mcp') {
      const { serveMcp } = await import('../src/mcp.mjs');
      const server = await serveMcp(foundry); persistent = true;
      const close = async () => { await server.close(); await foundry.close(); await components?.close(); process.exit(0); };
      process.once('SIGINT', close); process.once('SIGTERM', close); process.stdin.once('end', close); return;
    }
    if (command === 'serve') {
      const { serveHttp } = await import('../src/http.mjs');
      const service = await serveHttp(foundry, { port: args.port === undefined ? 4177 : Number(args.port), tickIntervalMs: 1000 * Number(args['tick-interval'] ?? 5) }); persistent = true;
      const processor = foundry.generator ? (await import('../src/generator.mjs')).startRequestProcessor(foundry.generator) : null;
      print({ ui: service.origin, workspace, agent: foundry.generator ? foundry.generator.provider.identity : 'Use the installed host agent MCP to consume requests and submit proposals.', autoApply: !!args['auto-apply'] });
      const close = async () => { await processor?.close(); for (const [id] of foundry.active) foundry.cancelRun(id); await service.close(); await foundry.close(); await components?.close(); process.exit(0); };
      process.once('SIGINT', close); process.once('SIGTERM', close); return;
    }
    if (command === 'import') { print(foundry.save(readJson(args.file ?? item), args['expected-hash'])); return; }
    if (command === 'evaluate') {
      const { evaluateWorkflow } = await import('../src/evaluation.mjs');
      const workflow = existsSync(item ?? '') ? readJson(item) : foundry.store.workflow(item).workflow;
      const report = await evaluateWorkflow(workflow, readJson(args.suite), { directory: path.join(foundry.store.directory, 'evaluations', `${Date.now()}`), registryFactory: () => registry });
      const saved = foundry.store.recordQualification(report); print(saved); if (!report.passed) process.exitCode = 1; return;
    }
    if (command === 'state') { print(foundry.state()); return; }
    if (command === 'trial') {
      if (args.input === undefined) throw new FoundryError('TRIAL_INPUT', 'Specify the exact diagnostic input with --input, including {} when empty');
      const candidate = readJson(args.file ?? item), workflow = candidate.workflow ?? candidate;
      print(await foundry.trial({ requestId: args.request, workflow, input: jsonValue(args.input) })); return;
    }
    if (command === 'inspect-trial') { print(foundry.inspectTrial(item)); return; }
    if (command === 'repair-request') { print(foundry.requestRepair({ requestId: args.request, failedRunId: args['failed-run'], expectedHash: args['expected-hash'], diagnostic: args.diagnostic ?? '' })); return; }
    if (command === 'delivery') { print(foundry.delivery({ requestId: args.request, proposalId: args.proposal, runId: item })); return; }
    if (command === 'request') { print(foundry.store.createRequest({ text: args.text ?? item, workflowId: args.workflow, baseHash: args['expected-hash'], source: 'user-cli' })); return; }
    if (command === 'prompt') {
      const result = foundry.generationPrompt({ requestId: args.request, task: args.task ?? args.text ?? item, domain: args.domain, includeSkills: !args['no-skills'] });
      if (args.out) { writeFileSync(args.out, result.prompt, { flag: 'wx', mode: 0o600 }); print({ path: path.resolve(args.out), contextHash: result.contextHash }); }
      else process.stdout.write(result.prompt + '\n');
      return;
    }
    if (command === 'propose') {
      const input = readJson(args.file ?? item);
      const candidate = input.workflow ? input : { workflow: input, rationale: args.rationale };
      print(foundry.propose({ requestId: args.request, workflow: candidate.workflow, rationale: args.rationale ?? candidate.rationale })); return;
    }
    if (command === 'apply') { print(foundry.apply(item)); return; }
    if (command === 'inspect') { print(foundry.inspectRun(item)); return; }
    if (command === 'tick') { print(await foundry.tick()); return; }
    if (command === 'calls') {
      if (!args.run?.trim()) throw new FoundryError('CLI_ARGUMENT', 'calls requires --run RUN_ID');
      foundry.store.run(args.run);
      const { Journal } = await import('../src/journal.mjs');
      const journal = new Journal(foundry.store);
      print({ runId: args.run, calls: journal.forRun(args.run).map(callSummary), totals: journal.costForRun(args.run) }); return;
    }
    if (command === 'answer') { print(foundry.publicRun(foundry.runtime.answer(item, args.node, jsonValue(args.answer, null)))); return; }
    if (command === 'approve') {
      if (!!args.approved === !!args.rejected) throw new FoundryError('APPROVAL_CHOICE', 'Choose exactly one of --approved or --rejected');
      print(foundry.publicRun(foundry.runtime.approve(item, second, !!args.approved, 'user'))); return;
    }
    if (command === 'run' || command === 'resume') {
      let run;
      if (command === 'resume') run = foundry.store.run(item);
      else {
        let workflow;
        if (existsSync(item ?? '')) {
          workflow = readJson(item);
          try { foundry.save(workflow, args['expected-hash']); }
          catch (error) {
            if (error.code !== 'STALE_WORKFLOW') throw error;
            throw new FoundryError('STALE_WORKFLOW', `${error.message}: the workspace holds another version of ${workflow.id}. Use a fresh --workspace, or bump "version" and pass --expected-hash ${error.details?.currentHash ?? '<current head hash>'}`, error.details);
          }
        }
        else workflow = foundry.store.workflow(item).workflow;
        const assignment = args.assignment === undefined ? undefined : readJson(args.assignment);
        await requireSpendBudget(workflow, host.modelPolicy, { mode: host.mode, maxCost: foundry.runtime.policy.maxCost, assignment });
        const options = { modelMode: host.mode, ...(args.salt === undefined ? {} : { sampleSalt: args.salt }), ...(assignment === undefined ? {} : { assignment }) };
        run = foundry.runtime.create(workflow, jsonValue(args.input), { ...(args.fixture ? { fixture: readJson(args.fixture) } : {}), ...options });
      }
      const result = await foundry.startRun(run.id); print({ ...foundry.publicRun(result), events: foundry.store.events(run.id) });
      if (result.status === 'failed') process.exitCode = 1;
      else if (result.status === 'uncertain') process.exitCode = 2;
      return;
    }
    throw new FoundryError('COMMAND', `Unknown command: ${command}. Use --help.`);
  } finally { if (!persistent) { if (foundry) await foundry.close(); await components?.close(); } }
}

main().catch(error => {
  process.stderr.write(JSON.stringify({ error: errorData(error), ...(error.details ? { details: error.details } : {}) }) + '\n');
  process.exitCode = 1;
});
