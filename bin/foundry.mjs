#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Foundry, packageRoot, parseCandidate, skillCatalog } from '../src/foundry.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { validateWorkflow, workflowSchema } from '../src/validate.mjs';
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
  target: { type: 'string' }, 'no-skills': { type: 'boolean' }, help: { type: 'boolean', short: 'h' }
  , agent: { type: 'string' }, model: { type: 'string' }, rounds: { type: 'string' }, 'generation-timeout': { type: 'string' }, 'auto-apply': { type: 'boolean' }
  , suite: { type: 'string' }
  , 'failed-run': { type: 'string' }, diagnostic: { type: 'string' }, proposal: { type: 'string' }
};
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
`  foundry delivery RUN_ID --request REQUEST_ID --proposal PROPOSAL_ID --workspace PATH\n` +
`  foundry generate --task TEXT|--request ID --agent opencode-free --model OBSERVED_FREE_ID [--auto-apply]\n` +
`  foundry evaluate WORKFLOW_ID_OR_FILE --suite TRUSTED_SUITE.json --workspace PATH\n` +
`  foundry propose CANDIDATE.json --request REQUEST_ID [--rationale TEXT] --workspace PATH\n` +
`  foundry apply PROPOSAL_ID --workspace PATH\n` +
`  foundry run WORKFLOW_ID_OR_FILE --input JSON_OR_FILE [--fixture LOCAL_SIMULATOR.json] --workspace PATH\n` +
`  foundry inspect RUN_ID | resume RUN_ID --workspace PATH\n` +
`  foundry answer RUN_ID --node root/NODE --answer JSON --workspace PATH\n` +
`  foundry approve RUN_ID APPROVAL_ID --approved|--rejected --workspace PATH\n` +
`  foundry export WORKFLOW_ID_OR_FILE --target langgraph|n8n [--out DIRECTORY]\n` +
`  foundry serve --workspace PATH [--port 4177] [--agent opencode-free --model OBSERVED_FREE_ID --auto-apply]\n` +
`  foundry mcp --workspace PATH\n\n` +
`Models construct candidates using skills/MCP. This CLI does not pretend a template\n` +
`is model generation. A host-selected component manifest launches trusted MCP\n` +
`servers; never supply an unreviewed model-authored manifest. Local success is\n` +
`not proof of commercial parity or arbitrary deployment safety.\n`;

async function main() {
  const { values: args, positionals } = parseArgs({ options: definitions, allowPositionals: true, strict: true });
  const [command = 'help', item, second] = positionals;
  if (args.help || command === 'help') { process.stdout.write(usage); return; }
  const workspace = path.resolve(args.workspace ?? args.project ?? process.cwd());
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
      const result = validateWorkflow(readJson(args.file ?? item), { registry }); print(result); if (!result.valid) process.exitCode = 1; return;
    }
    foundry = new Foundry(workspace, { registry });
    if (args.agent || command === 'generate') {
      if (args.agent !== 'opencode-free') throw new FoundryError('GENERATOR_PROVIDER', 'This CLI supports --agent opencode-free with an explicitly selected observed free model. Other host agents use MCP or the generator library interface.');
      const { WorkflowGenerator } = await import('../src/generator.mjs');
      const { OpenCodeFreeProvider } = await import('../src/opencode-free.mjs');
      const provider = new OpenCodeFreeProvider({ model: args.model });
      const evaluator = args.suite ? (await import('../src/evaluation.mjs')).suiteEvaluator(readJson(args.suite), { registryFactory: () => registry }) : null;
      foundry.generator = new WorkflowGenerator(foundry, provider, { maxRounds: args.rounds ? Number(args.rounds) : 3, maxDurationMs: args['generation-timeout'] ? Number(args['generation-timeout']) : 900000, autoApply: !!args['auto-apply'], evaluator });
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
      const service = await serveHttp(foundry, { port: args.port === undefined ? 4177 : Number(args.port) }); persistent = true;
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
        if (existsSync(item ?? '')) { workflow = readJson(item); foundry.save(workflow, args['expected-hash']); }
        else workflow = foundry.store.workflow(item).workflow;
        run = foundry.runtime.create(workflow, jsonValue(args.input), args.fixture ? { fixture: readJson(args.fixture) } : {});
      }
      const result = await foundry.startRun(run.id); print({ ...foundry.publicRun(result), events: foundry.store.events(run.id) });
      if (result.status === 'failed') process.exitCode = 1;
      else if (result.status === 'uncertain') process.exitCode = 2;
      return;
    }
    if (command === 'export') {
      const { exportWorkflow } = await import('../adapters/index.mjs');
      const workflow = existsSync(item ?? '') ? readJson(item) : foundry.store.workflow(item).workflow;
      const result = exportWorkflow(workflow, args.target);
      if (args.out) {
        const { mkdirSync } = await import('node:fs');
        mkdirSync(args.out, { recursive: true });
        for (const file of result.files) {
          if (path.isAbsolute(file.path) || file.path.split(/[\\/]/).includes('..')) throw new FoundryError('EXPORT_PATH', 'Adapter returned an unsafe path');
          const destination = path.join(args.out, file.path); mkdirSync(path.dirname(destination), { recursive: true });
          writeFileSync(destination, file.content, { flag: 'wx', mode: 0o600 });
        }
        print({ ...result, files: result.files.map(f => ({ path: path.join(args.out, f.path), bytes: Buffer.byteLength(f.content) })) });
      } else print(result);
      return;
    }
    throw new FoundryError('COMMAND', `Unknown command: ${command}. Use --help.`);
  } finally { if (!persistent) { if (foundry) await foundry.close(); await components?.close(); } }
}

main().catch(error => {
  process.stderr.write(JSON.stringify({ error: errorData(error), ...(error.details ? { details: error.details } : {}) }) + '\n');
  process.exitCode = 1;
});
