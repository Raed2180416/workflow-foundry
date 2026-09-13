#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashBytes, inspectPair, inspectTuiEvidence } from './evidence.mjs';
import { incidentCases, inspectIncident } from './incident-oracle.mjs';
import { runDirectory } from './opencode-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = filename => readFileSync(filename, 'utf8');
const json = value => JSON.stringify(value, null, 2) + '\n';
const readJSON = filename => JSON.parse(read(filename));
const write = (filename, data) => { mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 }); writeFileSync(filename, data, { mode: 0o600 }); chmodSync(filename, 0o600); };
const copy = (from, to) => { mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 }); copyFileSync(from, to); chmodSync(to, 0o600); };
const runtimeFiles = ['src/data.mjs', 'src/validate.mjs', 'src/capabilities.mjs', 'src/store.mjs', 'src/runtime.mjs', 'schemas/workflow.schema.json'];
const skillFiles = ['skills/workflow-foundry/SKILL.md', 'skills/workflow-foundry/references/design-checklist.md', 'skills/runtime-native/SKILL.md', 'skills/domain-software/SKILL.md'];
const executePolicy = { maxSteps: 24, maxConcurrency: 3, maxDurationMs: 5000, maxCost: 0 };
const prompt = 'Read /task/inputs/task.md, /task/inputs/IR-GUIDE.md, /task/inputs/workflow.schema.json, /task/inputs/capabilities.json and /task/inputs/skill-context.md. Complete the construction task and write the complete candidate JSON to /task/output.json. You have read and file-modification tools only; no shell or runtime evaluator is available during this turn. Do not claim execution or validation occurred.\n';

function harness(...args) {
  const result = spawnSync(process.execPath, [path.join(root, 'evals/opencode-harness.mjs'), ...args], { cwd: root, encoding: 'utf8', timeout: 45000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status) throw Error(result.error?.message ?? result.stderr);
  return result.stdout;
}

async function modules(pair) {
  const load = file => import(pathToFileURL(path.join(pair, 'frozen', file)).href);
  const [capabilities, validation, store, runtime] = await Promise.all(['src/capabilities.mjs', 'src/validate.mjs', 'src/store.mjs', 'src/runtime.mjs'].map(load));
  return { registry: capabilities.createDefaultRegistry(), validateWorkflow: validation.validateWorkflow, Store: store.Store, Runtime: runtime.Runtime };
}

async function freeze(id) {
  const pair = runDirectory(id);
  if (existsSync(pair)) throw Error('Pair directory exists; preserve it.');
  process.umask(0o077);
  mkdirSync(pair, { recursive: true, mode: 0o700 });
  const hashes = {};
  for (const filename of [...runtimeFiles, ...skillFiles, 'package.json', 'package-lock.json', 'evals/PROTOCOL.md', 'evals/cases/incident-routing.md', 'evals/IR-GUIDE.md', 'evals/incident-oracle.mjs', 'evals/evidence.mjs', 'evals/compare-incident.mjs']) {
    const data = readFileSync(path.join(root, filename));
    write(path.join(pair, 'frozen', filename), data);
    hashes[filename] = hashBytes(data);
  }
  const { registry } = await modules(pair);
  const capabilities = json(registry.list());
  const skills = skillFiles.map(filename => `# Frozen source: ${filename}\n\n${read(path.join(pair, 'frozen', filename))}`).join('\n\n');
  write(path.join(pair, 'capabilities.json'), capabilities);
  write(path.join(pair, 'skill-context.md'), skills);
  write(path.join(pair, 'cases.json'), json(incidentCases));
  const manifest = {
    id, createdAt: new Date().toISOString(), split: 'diagnostic',
    caseCount: incidentCases.length, sourceHashes: hashes,
    executorSHA256: hashBytes(json(Object.fromEntries(runtimeFiles.map(file => [file, hashes[file]])))),
    toolsSHA256: hashBytes(capabilities), schemaSHA256: hashes['schemas/workflow.schema.json'],
    taskSHA256: hashes['evals/cases/incident-routing.md'],
    skillSHA256: hashBytes(skills), casesSHA256: hashBytes(json(incidentCases)),
    budgetSHA256: hashBytes(json({ constructionSeconds: 240, execution: executePolicy, correctionAttempts: 1 })),
    executePolicy, constructionSeconds: 240, status: 'frozen-before-generation',
    dependencies: 'Frozen package-lock identity; imports resolve the installed root node_modules. Dependency tree is not vendored.',
  };
  write(path.join(pair, 'pair.json'), json(manifest));
  return manifest;
}

function stage(id, baselineID, foundryID) {
  const pair = runDirectory(id), frozen = readJSON(path.join(pair, 'pair.json'));
  if (frozen.status !== 'frozen-before-generation') throw Error('Pair already staged.');
  const catalogSource = path.join(runDirectory('smoke-20260913'), 'catalog.stdout.txt');
  for (const [arm, runID] of [['baseline', baselineID], ['foundry', foundryID]]) {
    harness('prepare', runID);
    const run = runDirectory(runID);
    copy(catalogSource, path.join(run, 'catalog.stdout.txt'));
    harness('select', runID, 'opencode/big-pickle');
    const inputs = path.join(run, 'workspace/inputs');
    copy(path.join(pair, 'frozen/evals/cases/incident-routing.md'), path.join(inputs, 'task.md'));
    copy(path.join(pair, 'frozen/evals/IR-GUIDE.md'), path.join(inputs, 'IR-GUIDE.md'));
    copy(path.join(pair, 'frozen/schemas/workflow.schema.json'), path.join(inputs, 'workflow.schema.json'));
    copy(path.join(pair, 'capabilities.json'), path.join(inputs, 'capabilities.json'));
    write(path.join(inputs, 'skill-context.md'), arm === 'foundry' ? read(path.join(pair, 'skill-context.md')) : 'No additional construction skills are supplied in this baseline arm.\n');
    write(path.join(run, 'prompt.txt'), prompt);
    const manifest = readJSON(path.join(run, 'manifest.json'));
    Object.assign(manifest, {
      arm, pair: id, appVersion: '1.18.29', taskSHA256: frozen.taskSHA256,
      schemaSHA256: frozen.schemaSHA256, toolsSHA256: frozen.toolsSHA256,
      executorSHA256: frozen.executorSHA256, budgetSHA256: frozen.budgetSHA256,
      skillSHA256: arm === 'foundry' ? frozen.skillSHA256 : null,
      inputFiles: Object.fromEntries(['task.md', 'IR-GUIDE.md', 'workflow.schema.json', 'capabilities.json', 'skill-context.md'].map(file => [file, hashBytes(readFileSync(path.join(inputs, file)))])),
      catalogProvenance: { source: 'evals/runs/smoke-20260913/catalog.stdout.txt', sha256: hashBytes(readFileSync(catalogSource)) },
      operatorInterventions: [{ actor: 'worker-5', type: 'task-staging', at: new Date().toISOString(), description: 'Prepared synthetic task/IR/capability context; no candidate workflow or expected fixture states supplied.' }],
    });
    write(path.join(run, 'manifest.json'), json(manifest));
  }
  Object.assign(frozen, { status: 'staged', baselineID, foundryID, stagedAt: new Date().toISOString() });
  write(path.join(pair, 'pair.json'), json(frozen));
  return { id, baselineID, foundryID, samePromptSHA256: hashBytes(prompt), taskSHA256: frozen.taskSHA256 };
}

async function score(id, runID, revision = 1) {
  const pair = runDirectory(id), run = runDirectory(runID);
  const pairData = readJSON(path.join(pair, 'pair.json'));
  for (const filename of ['evals/incident-oracle.mjs', 'evals/evidence.mjs']) {
    if (hashBytes(readFileSync(path.join(root, filename))) !== pairData.sourceHashes[filename]) throw Error(`Comparison dependency changed after freeze: ${filename}`);
  }
  const dependencyFreeze = readJSON(path.join(pair, 'execution-dependencies.json'));
  for (const [filename, expectedHash] of Object.entries(dependencyFreeze.files)) {
    if (hashBytes(readFileSync(path.join(pair, 'frozen/node_modules', filename))) !== expectedHash) throw Error(`Frozen execution dependency changed: ${filename}`);
  }
  if (hashBytes(readFileSync(path.join(pair, 'cases.json'))) !== pairData.casesSHA256) throw Error('Frozen case oracle was changed.');
  if (![pairData.baselineID, pairData.foundryID].includes(runID)) throw Error('Run is not part of this frozen pair.');
  const suffix = revision === 1 ? '' : `-v${revision}`;
  const resultPath = path.join(run, `construction-execution${suffix}.json`);
  if (existsSync(resultPath)) throw Error('Run already scored; preserve the result.');
  const manifest = readJSON(path.join(run, 'manifest.json'));
  const outputPath = path.join(run, 'workspace/output.json');
  const output = existsSync(outputPath) ? read(outputPath) : undefined;
  const evidence = inspectTuiEvidence({ manifest, session: readJSON(path.join(run, 'session-export-local.stdout.txt')), prompt: read(path.join(run, 'prompt.txt')), transcript: read(path.join(run, 'transcript.ansi')), output });
  const result = {
    id: runID, arm: manifest.arm, evaluatedAt: new Date().toISOString(), split: 'diagnostic',
    scorerRevision: revision, priorScore: revision === 1 ? null : 'construction-execution.json',
    evaluatorSHA256: hashBytes(readFileSync(fileURLToPath(import.meta.url))),
    executionDependenciesSHA256: hashBytes(readFileSync(path.join(pair, 'execution-dependencies.json'))),
    evidence, schema: null, outcomes: [],
  };
  const basisFiles = ['manifest.json', 'prompt.txt', 'transcript.ansi', 'session-export-local.stdout.txt'];
  if (output !== undefined) basisFiles.push('workspace/output.json');
  write(path.join(run, `artifact-freeze${suffix}.json`), json({ at: new Date().toISOString(), files: Object.fromEntries(basisFiles.map(file => [file, hashBytes(readFileSync(path.join(run, file)))])) }));
  if (evidence.valid) {
    let workflow;
    try { workflow = JSON.parse(output); } catch (error) { result.schema = { valid: false, errors: [{ message: error.message }] }; }
    if (workflow) {
      const { registry, validateWorkflow, Store, Runtime } = await modules(pair);
      result.schema = validateWorkflow(workflow, { registry });
      result.constructionRequirements = [];
      for (const [key, limit] of Object.entries(executePolicy)) {
        if (typeof workflow.budget?.[key] !== 'number' || workflow.budget[key] > limit) result.constructionRequirements.push(`Budget ${key} must be explicitly declared at or below ${limit}.`);
      }
      const checkNodes = nodes => { for (const node of nodes ?? []) {
        if (node.kind === 'task' && (node.timeoutMs > 1000 || node.retry?.maxAttempts > 2)) result.constructionRequirements.push(`Task ${node.id} exceeds the construction timeout/retry contract.`);
        if (node.body) checkNodes(node.body.nodes);
      } };
      checkNodes(workflow.nodes);
      if (result.schema.valid) {
        for (const taskCase of readJSON(path.join(pair, 'cases.json'))) {
          const store = new Store(path.join(run, `execution${suffix}`, taskCase.id));
          try {
            let expectedHash = null;
            if (revision >= 2 && manifest.correctionRound && workflow.version > 1) {
              const priorFile = path.join(run, 'workspace/inputs/prior-candidate.json');
              const priorBytes = readFileSync(priorFile);
              if (hashBytes(priorBytes) !== manifest.priorCandidateSHA256) throw Error('Prior workflow history hash changed.');
              const prior = JSON.parse(priorBytes);
              if (!prior || prior.id !== workflow.id || prior.version !== 1 || workflow.version !== prior.version + 1) throw Error('Correction does not match the preserved one-revision history.');
              const validPrior = validateWorkflow(prior, { registry });
              if (!validPrior.valid) throw Error('Preserved prior workflow is not valid executable history.');
              expectedHash = store.saveWorkflow(prior).hash;
            }
            store.saveWorkflow(workflow, { expectedHash });
            const runtime = new Runtime(store, registry, pairData.executePolicy);
            const instance = runtime.create(workflow, {}, { fixture: taskCase.fixture });
            const state = await runtime.execute(instance.id);
            const events = store.events(instance.id), world = store.fixture(instance.id);
            const oracle = inspectIncident({ taskCase, run: state, world, events });
            write(path.join(run, `execution${suffix}`, taskCase.id, 'evidence.json'), json({ run: state, world, events, oracle }));
            result.outcomes.push(oracle);
          } catch (error) {
            result.outcomes.push({ caseId: taskCase.id, passed: false, evaluatorError: error.message, errorCode: error.code ?? null });
          } finally { store.close(); }
        }
      }
    }
  }
  result.passedCases = result.outcomes.filter(item => item.passed).length;
  result.totalCases = pairData.caseCount;
  result.constructionPassed = evidence.valid && result.schema?.valid === true && result.constructionRequirements?.length === 0;
  result.allDiagnosticCasesPassed = result.constructionPassed && result.outcomes.length === pairData.caseCount && result.passedCases === pairData.caseCount;
  write(resultPath, json(result));
  return result;
}

function compare(id) {
  const pair = runDirectory(id), pairData = readJSON(path.join(pair, 'pair.json'));
  const items = [pairData.baselineID, pairData.foundryID].map(runID => {
    const directory = runDirectory(runID);
    const filename = existsSync(path.join(directory, 'construction-execution-v2.json')) ? 'construction-execution-v2.json' : 'construction-execution.json';
    const result = readJSON(path.join(directory, filename));
    return { manifest: { ...readJSON(path.join(directory, 'manifest.json')), sessionID: result.evidence.sessionID }, result };
  });
  const comparison = { pair: id, at: new Date().toISOString(), ...inspectPair(items[0].manifest, items[1].manifest), results: items.map(item => item.result), limitation: 'One diagnostic task, eight explicitly designed synthetic states. No heldout or statistical superiority claim.' };
  for (const key of ['evaluatorSHA256', 'executionDependenciesSHA256']) {
    if (items[0].result[key] !== items[1].result[key]) { comparison.comparable = false; comparison.errors.push(`Unequal scorer control: ${key}`); }
  }
  write(path.join(pair, 'comparison.json'), json(comparison));
  return comparison;
}

try {
  const [command, id, ...args] = process.argv.slice(2);
  const result = command === 'freeze' ? await freeze(id) : command === 'stage' ? stage(id, ...args) : command === 'score' ? await score(id, args[0]) : command === 'score-revision' ? await score(id, args[0], 2) : command === 'compare' ? compare(id) : (() => { throw Error('Usage: compare-incident.mjs freeze|stage|score|score-revision|compare PAIR [RUN...]'); })();
  console.log(json(result));
} catch (error) { console.error(error.stack); process.exitCode = 1; }
