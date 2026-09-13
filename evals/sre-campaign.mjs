#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashBytes, inspectTuiEvidence } from './evidence.mjs';
import { runDirectory } from './opencode-harness.mjs';

const source = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(source), '..');
const json = value => JSON.stringify(value, null, 2) + '\n';
const readJSON = file => JSON.parse(readFileSync(file, 'utf8'));
const text = file => readFileSync(file, 'utf8');
function write(file, value, replace = false) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, value, { mode: 0o600, flag: replace ? 'w' : 'wx' });
  chmodSync(file, 0o600);
}
const runtimeFiles = ['src/runtime.mjs', 'src/store.mjs', 'src/capabilities.mjs', 'src/data.mjs', 'src/validate.mjs', 'schemas/workflow.schema.json'];
const auditFiles = [...runtimeFiles, 'package.json', 'package-lock.json', 'tests/evidence-contract-audit.test.mjs'];
const skillFiles = ['skills/workflow-foundry/SKILL.md', 'skills/workflow-foundry/references/design-checklist.md', 'skills/runtime-native/SKILL.md', 'skills/domain-sre/SKILL.md', 'skills/domain-sre/references/procedures.md'];
const ownedFiles = ['evals/sre-campaign.mjs', 'evals/replay-evidence-audit.mjs', 'evals/evidence-bound-fixture.mjs', 'evals/sre-robustness-cases.mjs', 'evals/incident-oracle.mjs', 'evals/evidence.mjs', 'evals/opencode-harness.mjs', 'evals/PROTOCOL.md', 'evals/SRE-CAMPAIGN.md', 'evals/CURRENT-IR-GUIDE.md', 'evals/cases/sre-current-guided.md', 'evals/cases/incident-routing.md', 'tests/evaluation-hostcontract.test.mjs', 'tests/evaluation-runtime.test.mjs', 'tests/evaluation-incident.test.mjs', 'tests/evaluation-evidence.test.mjs', 'tests/evaluation-campaign.test.mjs'];
const executionPolicy = { maxSteps: 24, maxConcurrency: 3, maxDurationMs: 5000, maxCost: 0 };
const budgets = { constructionSeconds: 240, attempts: { 'skills-only': 1, hostcontract: 3 }, executionPolicy };
const conditions = ['skills-only', 'hostcontract'];
const model = 'opencode/ling-3.0-flash-fin-free'; // Previously observed catalog AND actual TUI smoke.
const auditPath = 'research/manifests/evidence-contract-audit.json';

export function verifyIndependentAudit(records, hashes) {
  const latest = records.at(-1);
  if (!latest || latest.exitCode !== 0 || !latest.sourceStable || latest.signal || latest.error) throw Error('The latest independent audit did not pass on stable source.');
  if (!latest.command?.includes('tests/evidence-contract-audit.test.mjs')) throw Error('Wrong independent audit target.');
  const count = key => Number(latest.stdout?.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? NaN);
  if (!(count('tests') >= 48) || count('pass') !== count('tests') || count('fail') !== 0 || count('skipped') !== 0) throw Error('Independent evidence audit is incomplete.');
  for (const name of auditFiles) {
    if (!hashes[name] || latest.sourceHashesBefore?.[name] !== hashes[name] || latest.sourceHashesAfter?.[name] !== hashes[name]) throw Error(`Independent audit source drift: ${name}`);
  }
  return { run: latest.run, startedAt: latest.startedAt, finishedAt: latest.finishedAt, tests: count('tests'), checkedFiles: auditFiles, hashes: Object.fromEntries(auditFiles.map(name => [name, hashes[name]])) };
}

export function verifyAuditReplay(originalRecords, replay, hashes) {
  const original = originalRecords.at(-1);
  verifyIndependentAudit(originalRecords, original?.sourceHashesAfter ?? {});
  const testFile = 'tests/evidence-contract-audit.test.mjs';
  if (original.sourceHashesAfter[testFile] !== hashes[testFile]) throw Error('Independent audit tests changed before replay.');
  if (replay.testAuthor !== 'worker-2' || replay.executedBy !== 'worker-5' || replay.originalAuditRun !== original.run) throw Error('Missing explicit independent-test/replay attribution.');
  return { ...verifyIndependentAudit([replay], hashes), testAuthor: replay.testAuthor, executedBy: replay.executedBy, originalAuditRun: original.run, qualification: 'Unchanged independently authored tests, replayed by the evaluator on the newer source; not a new independent manual review.' };
}

export function summarizeOutcomes(outcomes, cases) {
  const group = selected => ({
    passed: selected.filter(item => outcomes.find(result => result.caseId === item.id)?.passed).length,
    total: selected.length,
  });
  return {
    observedCases: outcomes.length, totalCases: cases.length,
    passed: outcomes.filter(item => item.passed).length,
    recovery: group(cases.filter(item => item.requiredOutcome === 'recovered')),
    failClosed: group(cases.filter(item => item.requiredOutcome === 'fail-closed')),
    strata: Object.fromEntries([...new Set(cases.map(item => item.stratum))].map(stratum => [stratum, group(cases.filter(item => item.stratum === stratum))])),
    falseSuccesses: outcomes.filter(item => !item.passed && item.runStatus === 'succeeded').length,
    invalidEvidenceEffects: outcomes.filter(item => cases.find(candidate => candidate.id === item.caseId)?.requiredOutcome === 'fail-closed' && item.actions?.length > 0).length,
    wrongActions: outcomes.reduce((sum, item) => sum + (item.wrongActions ?? 0), 0),
    humanPauses: outcomes.reduce((sum, item) => sum + (item.humanPauses ?? 0), 0),
    evaluatorErrors: outcomes.filter(item => item.evaluatorError).length,
  };
}

function command(script, args, timeout = 45000) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...args], { cwd: root, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw Error(result.error?.message ?? result.stderr ?? 'Subprocess failed');
  return result.stdout;
}
const harness = (...args) => command('evals/opencode-harness.mjs', args);
const importFrozen = (directory, name) => import(pathToFileURL(path.join(directory, 'frozen', name)).href);
async function modules(directory) {
  const [caps, profile, runtime, store, validator, cases, oracle] = await Promise.all([
    'src/capabilities.mjs', 'evals/evidence-bound-fixture.mjs', 'src/runtime.mjs', 'src/store.mjs',
    'src/validate.mjs', 'evals/sre-robustness-cases.mjs', 'evals/incident-oracle.mjs',
  ].map(name => importFrozen(directory, name)));
  return { ...caps, ...profile, ...runtime, ...store, ...validator, ...cases, ...oracle };
}
function freezeDependencies(directory) {
  const lock = readJSON(path.join(directory, 'frozen/package-lock.json'));
  const packages = {}, files = {}, pending = ['ajv'];
  while (pending.length) {
    const name = pending.shift();
    if (packages[name]) continue;
    if (!/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(name)) throw Error('Unsupported dependency name.');
    const packageRoot = path.join(root, 'node_modules', name);
    const metadata = readJSON(path.join(packageRoot, 'package.json'));
    if (metadata.version !== lock.packages[`node_modules/${name}`]?.version) throw Error(`Dependency version drift: ${name}`);
    packages[name] = metadata.version;
    pending.push(...Object.keys(metadata.dependencies ?? {}));
    const visit = relative => {
      const original = path.join(packageRoot, relative), stat = lstatSync(original);
      if (stat.isSymbolicLink()) throw Error(`Dependency symlink requires review: ${original}`);
      if (stat.isDirectory()) { for (const child of readdirSync(original)) visit(path.join(relative, child)); return; }
      if (!stat.isFile()) throw Error('Unsupported dependency file.');
      const bytes = readFileSync(original), key = `${name}/${relative}`;
      write(path.join(directory, 'frozen/node_modules', key), bytes);
      files[key] = hashBytes(bytes);
    };
    visit('');
  }
  write(path.join(directory, 'dependencies.json'), json({ frozenAt: new Date().toISOString(), packages, files, installedCodeOnly: true, hooksRun: false }));
}

async function freeze(id, auditReplayID) {
  const directory = runDirectory(id);
  if (existsSync(directory)) throw Error('Campaign already exists; preserve it.');
  const files = [...new Set([...auditFiles, ...skillFiles, ...ownedFiles])];
  const bytes = Object.fromEntries(files.map(name => [name, readFileSync(path.join(root, name))]));
  const hashes = Object.fromEntries(files.map(name => [name, hashBytes(bytes[name])]));
  const auditBytes = readFileSync(path.join(root, auditPath));
  const replayBytes = auditReplayID ? readFileSync(path.join(runDirectory(auditReplayID), 'audit-replay.json')) : null;
  const replay = replayBytes ? JSON.parse(replayBytes) : null;
  if (replay && replay.originalAuditSHA256 !== hashBytes(auditBytes)) throw Error('Independent audit source receipt changed after replay.');
  const audit = replay ? verifyAuditReplay(JSON.parse(auditBytes), replay, hashes) : verifyIndependentAudit(JSON.parse(auditBytes), hashes);
  process.umask(0o077);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString();
  const args = ['--test', '--test-reporter=tap', '--test-concurrency=1', ...ownedFiles.filter(name => name.startsWith('tests/'))];
  const test = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  write(path.join(directory, 'evaluator-preflight.json'), json({ startedAt, finishedAt: new Date().toISOString(), command: [process.execPath, ...args], exitCode: test.status, signal: test.signal, error: test.error?.message ?? null, stdout: test.stdout, stderr: test.stderr, sourceHashes: hashes }));
  if (test.error || test.status !== 0) throw Error('Evaluator preflight failed; receipt preserved.');
  for (const name of files) {
    if (hashBytes(readFileSync(path.join(root, name))) !== hashes[name]) throw Error(`Source changed during freeze: ${name}`);
    write(path.join(directory, 'frozen', name), bytes[name]);
  }
  write(path.join(directory, 'independent-audit.json'), auditBytes);
  if (replayBytes) write(path.join(directory, 'independent-audit-replay.json'), replayBytes);
  freezeDependencies(directory);
  const kit = await modules(directory);
  const cases = kit.sreRobustnessCases();
  const skills = skillFiles.map(name => `# Frozen source: ${name}\n\n${bytes[name]}`).join('\n\n');
  write(path.join(directory, 'cases.json'), json(cases));
  write(path.join(directory, 'skill-context.md'), skills);
  const registryHashes = {};
  for (const condition of conditions) {
    const registry = condition === 'hostcontract' ? kit.createEvidenceBoundFixtureRegistry() : kit.createDefaultRegistry();
    registryHashes[condition] = registry.hash();
    write(path.join(directory, `${condition}-capabilities.json`), json(registry.list()));
  }
  const payloadFiles = ['cases.json', 'skill-context.md', 'dependencies.json', 'independent-audit.json', ...(replayBytes ? ['independent-audit-replay.json'] : []), 'evaluator-preflight.json', ...conditions.map(condition => `${condition}-capabilities.json`)];
  const manifest = {
    id, frozenAt: new Date().toISOString(), status: 'frozen-before-generation', split: 'diagnostic-guided-current',
    sourceHashes: hashes, payloadHashes: Object.fromEntries(payloadFiles.map(name => [name, hashBytes(readFileSync(path.join(directory, name)))])),
    independentAudit: { ...audit, receiptSHA256: hashBytes(auditBytes), replaySHA256: replayBytes ? hashBytes(replayBytes) : null },
    model, binarySHA256: hashBytes(readFileSync('/usr/bin/opencode')), budgets, registryHashes,
    caseCount: cases.length, treatment: kit.evidenceBoundFixtureTreatment,
    attribution: 'Hostcontract is host enforcement. Same-artifact replays are not additional generations. No heldout or model-reasoning superiority claim.',
  };
  write(path.join(directory, 'campaign.json'), json(manifest));
  write(path.join(directory, 'attempts.json'), '[]\n');
  return { id, frozenAt: manifest.frozenAt, independentAuditTests: audit.tests, caseCount: cases.length, registryHashes, directory };
}

function checkedCampaign(id) {
  const directory = runDirectory(id), manifest = readJSON(path.join(directory, 'campaign.json'));
  if (hashBytes(readFileSync(source)) !== manifest.sourceHashes['evals/sre-campaign.mjs']) throw Error('Campaign scorer changed after freeze; use a separately declared amendment.');
  for (const name of ['evals/evidence.mjs', 'evals/opencode-harness.mjs']) {
    if (hashBytes(readFileSync(path.join(root, name))) !== manifest.sourceHashes[name]) throw Error(`Live evaluator helper changed after freeze: ${name}`);
  }
  for (const [name, hash] of Object.entries(manifest.sourceHashes)) {
    if (hashBytes(readFileSync(path.join(directory, 'frozen', name))) !== hash) throw Error(`Frozen source changed: ${name}`);
  }
  for (const [name, hash] of Object.entries(manifest.payloadHashes)) {
    if (hashBytes(readFileSync(path.join(directory, name))) !== hash) throw Error(`Frozen payload changed: ${name}`);
  }
  for (const [name, hash] of Object.entries(readJSON(path.join(directory, 'dependencies.json')).files)) {
    if (hashBytes(readFileSync(path.join(directory, 'frozen/node_modules', name))) !== hash) throw Error(`Frozen dependency changed: ${name}`);
  }
  return { directory, manifest };
}

function stage(id, condition, runID) {
  if (!conditions.includes(condition)) throw Error('Use skills-only or hostcontract.');
  const { directory, manifest } = checkedCampaign(id);
  const attemptsFile = path.join(directory, 'attempts.json'), attempts = readJSON(attemptsFile);
  const own = attempts.filter(item => item.condition === condition);
  if (own.length >= manifest.budgets.attempts[condition]) throw Error('Preregistered attempt budget exhausted.');
  const previous = own.at(-1);
  if (previous) {
    const scored = readJSON(path.join(runDirectory(previous.runID), 'campaign-score.json'));
    if (scored.primary.constructionPassed && scored.primary.summary.passed === manifest.caseCount) throw Error('Preregistered early stop reached.');
  }
  if (existsSync(runDirectory(runID))) throw Error('Run directory already exists.');
  const attempt = { runID, condition, round: own.length + 1, createdAt: new Date().toISOString(), infrastructureFailureConsumesAttempt: true };
  attempts.push(attempt);
  write(attemptsFile, json(attempts), true);
  harness('prepare', runID);
  const run = runDirectory(runID), inputs = path.join(run, 'workspace/inputs');
  harness('inspect', runID, 'catalog');
  harness('select', runID, manifest.model);
  for (const [original, destination] of [
    ['frozen/evals/cases/sre-current-guided.md', 'task.md'], ['frozen/evals/cases/incident-routing.md', 'original-task.md'],
    ['frozen/evals/CURRENT-IR-GUIDE.md', 'IR-GUIDE.md'], ['frozen/schemas/workflow.schema.json', 'workflow.schema.json'],
    [`${condition}-capabilities.json`, 'capabilities.json'], ['skill-context.md', 'skill-context.md'],
  ]) write(path.join(inputs, destination), readFileSync(path.join(directory, original)));
  let prompt = 'Read /task/inputs/task.md, /task/inputs/original-task.md, /task/inputs/IR-GUIDE.md, /task/inputs/workflow.schema.json, /task/inputs/capabilities.json and /task/inputs/skill-context.md. Write one complete fresh version-1 workflow JSON candidate to /task/output.json using the permitted file tool. Do not claim execution or validation occurred.';
  if (previous) {
    const cases = readJSON(path.join(directory, 'cases.json'));
    const reports = attempts.slice(0, -1).map(item => ({ ...item, file: path.join(runDirectory(item.runID), 'campaign-score.json') })).filter(item => existsSync(item.file));
    const feedback = reports.map(item => {
      const report = readJSON(item.file);
      return { runID: item.runID, condition: item.condition, round: item.round, reportSHA256: hashBytes(readFileSync(item.file)), constructionErrors: report.evidence.errors, schema: report.primary.schema, budgetErrors: report.primary.budgetErrors,
        failedCases: report.primary.outcomes.filter(result => !result.passed).map(result => ({ result, fixture: cases.find(candidate => candidate.id === result.caseId)?.fixture })) };
    });
    write(path.join(inputs, 'feedback.json'), json(feedback));
    const prior = path.join(runDirectory(previous.runID), 'workspace/output.json');
    write(path.join(inputs, 'prior-candidate.json'), existsSync(prior) ? readFileSync(prior) : 'null\n');
    prompt += ' This is a diagnostic repair. Also read /task/inputs/feedback.json and /task/inputs/prior-candidate.json. Retain the task contract and produce a fresh version-1 candidate; do not report the supplied diagnostics as tests you ran.';
  }
  write(path.join(run, 'prompt.txt'), prompt + '\n');
  const runManifest = readJSON(path.join(run, 'manifest.json'));
  if (runManifest.binarySHA256 !== manifest.binarySHA256) throw Error('OpenCode binary changed after campaign freeze.');
  const inputFiles = Object.fromEntries(readdirSync(inputs).map(name => [name, hashBytes(readFileSync(path.join(inputs, name)))]));
  Object.assign(runManifest, {
    campaign: id, condition, round: attempt.round, appVersion: '1.18.29', split: manifest.split,
    registryHash: manifest.registryHashes[condition], campaignSHA256: hashBytes(readFileSync(path.join(directory, 'campaign.json'))),
    inputFiles, operatorInterventions: [{ actor: 'worker-5 evaluator agent', at: new Date().toISOString(), type: previous ? 'deterministic-counterexample-feedback' : 'task-staging', inputFiles, previousRun: previous?.runID ?? null, outputEdits: 0, operatorElapsedMs: null }],
  });
  write(path.join(run, 'manifest.json'), json(runManifest), true);
  return { ...attempt, model: manifest.model, run, inputFiles };
}

async function score(id, runID) {
  const { directory, manifest } = checkedCampaign(id), run = runDirectory(runID);
  const attempts = readJSON(path.join(directory, 'attempts.json'));
  const attempt = attempts.find(item => item.runID === runID);
  if (!attempt) throw Error('Run is not registered in this campaign.');
  if (existsSync(path.join(run, 'campaign-score.json'))) throw Error('Run already scored; preserve the result.');
  const runManifest = readJSON(path.join(run, 'manifest.json'));
  if (runManifest.status !== 'stopped') throw Error('Stop the owned TUI before freezing/scoring artifacts.');
  const outputPath = path.join(run, 'workspace/output.json');
  const output = existsSync(outputPath) ? text(outputPath) : undefined;
  const sessionPath = path.join(run, 'session-export-local.stdout.txt');
  const evidence = inspectTuiEvidence({ manifest: runManifest, session: existsSync(sessionPath) ? readJSON(sessionPath) : null, prompt: text(path.join(run, 'prompt.txt')), transcript: text(path.join(run, 'transcript.ansi')), output });
  const appendError = message => { evidence.valid = false; evidence.errors.push(message); };
  for (const [name, expected] of Object.entries(runManifest.inputFiles)) {
    if (hashBytes(readFileSync(path.join(run, 'workspace/inputs', name))) !== expected) appendError(`Input bytes changed: ${name}`);
  }
  if (evidence.appVersion !== runManifest.appVersion || evidence.model !== manifest.model) appendError('Model/app version differs from campaign.');
  if (runManifest.configSHA256 !== hashBytes(readFileSync(path.join(run, 'workspace/opencode.json')))) appendError('TUI config changed.');
  if (runManifest.harnessSHA256 !== manifest.sourceHashes['evals/opencode-harness.mjs']) appendError('TUI harness differs from frozen campaign.');
  if (runManifest.campaignSHA256 !== hashBytes(readFileSync(path.join(directory, 'campaign.json')))) appendError('Campaign manifest changed.');
  const basis = ['manifest.json', 'prompt.txt', 'transcript.ansi', 'screen-final.txt', ...(existsSync(sessionPath) ? ['session-export-local.stdout.txt'] : []), ...(output === undefined ? [] : ['workspace/output.json'])];
  write(path.join(run, 'campaign-artifact-freeze.json'), json({ frozenAt: new Date().toISOString(), files: Object.fromEntries(basis.map(name => [name, hashBytes(readFileSync(path.join(run, name)))])) }));
  const kit = await modules(directory), cases = readJSON(path.join(directory, 'cases.json'));
  let workflow, parseError;
  try { workflow = JSON.parse(output); } catch (error) { parseError = error.message; }
  const executions = [];
  for (const executionCondition of conditions) {
    const registry = executionCondition === 'hostcontract' ? kit.createEvidenceBoundFixtureRegistry() : kit.createDefaultRegistry();
    if (registry.hash() !== manifest.registryHashes[executionCondition]) throw Error('Frozen registry descriptor drift.');
    const schema = workflow ? kit.validateWorkflow(workflow, { registry }) : { valid: false, errors: [{ code: 'PARSE', message: parseError }] };
    const result = { executionCondition, constructionCondition: attempt.condition, role: executionCondition === attempt.condition ? 'primary' : 'same-artifact-host-ablation', registryHash: registry.hash(), schema, budgetErrors: [], outcomes: [] };
    if (schema.valid) {
      if (workflow.version !== 1) result.budgetErrors.push('Each new campaign candidate must be version 1; no version rewriting or invented history.');
      for (const [name, ceiling] of Object.entries(manifest.budgets.executionPolicy)) {
        if (typeof workflow.budget[name] !== 'number' || workflow.budget[name] > ceiling) result.budgetErrors.push(`Missing/excessive ${name}.`);
      }
      const inspect = nodes => { for (const node of nodes) {
        if (node.kind === 'task' && (node.timeoutMs > 1000 || node.retry.maxAttempts > 2)) result.budgetErrors.push(`Excessive task budget: ${node.id}`);
        if (node.body) inspect(node.body.nodes);
      } };
      inspect(workflow.nodes);
    }
    result.constructionPassed = evidence.valid && schema.valid && result.budgetErrors.length === 0;
    if (result.constructionPassed) {
      for (const taskCase of cases) {
        const workspace = path.join(run, 'campaign-execution', executionCondition, taskCase.id);
        mkdirSync(workspace, { recursive: true, mode: 0o700 });
        const store = new kit.Store(workspace);
        try {
          store.saveWorkflow(workflow);
          const runtime = new kit.Runtime(store, registry, manifest.budgets.executionPolicy);
          const created = runtime.create(workflow, {}, { fixture: taskCase.fixture });
          const state = await runtime.execute(created.id), world = store.fixture(created.id), events = store.events(created.id);
          const verdict = { ...kit.inspectIncident({ taskCase, run: state, world, events }), error: state.error ?? null, nodeErrors: Object.entries(state.nodes).filter(([, node]) => node.error).map(([id, node]) => ({ id, error: node.error })) };
          result.outcomes.push(verdict);
          write(path.join(workspace, 'evidence.json'), json({ run: state, world, events, verdict }));
        } catch (error) { result.outcomes.push({ caseId: taskCase.id, passed: false, evaluatorError: error.message, code: error.code ?? null }); }
        finally { store.close(); }
      }
    }
    result.summary = summarizeOutcomes(result.outcomes, cases);
    executions.push(result);
  }
  const report = {
    ...attempt, evaluatedAt: new Date().toISOString(), split: manifest.split, evidence,
    campaignSHA256: hashBytes(readFileSync(path.join(directory, 'campaign.json'))), evaluatorSHA256: hashBytes(readFileSync(source)),
    primary: executions.find(item => item.role === 'primary'), ablation: executions.find(item => item.role !== 'primary'),
    attribution: manifest.attribution,
  };
  write(path.join(run, 'campaign-score.json'), json(report));
  return { runID, condition: attempt.condition, round: attempt.round, evidence: { valid: evidence.valid, errors: evidence.errors, model: evidence.model, cost: evidence.cost, outputSHA256: evidence.outputSHA256 }, primary: { constructionPassed: report.primary.constructionPassed, schema: report.primary.schema, budgetErrors: report.primary.budgetErrors, summary: report.primary.summary }, ablation: { executionCondition: report.ablation.executionCondition, constructionPassed: report.ablation.constructionPassed, summary: report.ablation.summary } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === source) {
  process.umask(0o077);
  try {
    const [action, id, ...args] = process.argv.slice(2);
    const result = action === 'freeze' ? await freeze(id, args[0]) : action === 'stage' ? stage(id, ...args) : action === 'score' ? await score(id, args[0]) : (() => { throw Error('Usage: sre-campaign.mjs freeze CAMPAIGN [AUDIT-REPLAY] | stage CAMPAIGN skills-only|hostcontract RUN | score CAMPAIGN RUN'); })();
    console.log(json(result));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
