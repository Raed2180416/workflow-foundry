import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Foundry } from '../../src/foundry.mjs';
import { WorkflowGenerator } from '../../src/generator.mjs';
import { OpenCodeFreeProvider } from '../../src/opencode-free.mjs';
import { digest } from '../../src/data.mjs';
import { runProcess } from '../../src/process.mjs';
import { HERE, ROOT, MODEL, TASKS, SYSTEM, Trial, makeRegistry, runOriginal, assess, initialMessages, writeNew, sha, seal } from './harness.mjs';
import { constructionGate, challengeGate } from './construction-v2.mjs';
import { freezeRevision, verifyInventory, verifySystem } from './freeze-v2.mjs';

const jsonFile = file => JSON.parse(readFileSync(file, 'utf8'));
const GENERIC = 'Construct one reusable serial native query/action loop for unseen tiny Python repair tasks supplied only later in input.messages. Use only the provided reference.query and reference.act catalog. Exactly one native loop with separate query/action task nodes, at most five iterations, no task retries (maxAttempts=1), no mock repair, human pauses, extra capabilities, hardcoded task code or hidden agent loop. Budget maxSteps<=20, maxConcurrency=1, maxDurationMs=300000, maxCost=0. Domain general. Follow the approved study-only generic handoff rule below. Return a complete workflow and rationale. This is an unqualified candidate until externally executed and assessed.';

export function verifyExports(directory) {
  const completed = [], unavailable = [], invalid = [];
  const walk = dir => { for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !['snapshot'].includes(e.name) && !e.name.startsWith('isolated-')) walk(path.join(dir, e.name));
    else if (e.isFile() && e.name === 'generation.json') {
      const folder = dir, relative = path.relative(directory, folder), generation = jsonFile(path.join(folder, e.name));
      // This name is exclusive to actual OpenCode calls; neutral gates have none.
      const responseFile = path.join(folder, 'response.json');
      if (!existsSync(responseFile)) {
        let errors = [];
        try { errors = generation.stdout.split(/\r?\n/).filter(Boolean).map(x => JSON.parse(x)).filter(x => x.type === 'error'); } catch {}
        const statuses = errors.map(x => x.error?.data?.statusCode).filter(Boolean);
        (statuses.some(n => n === 429 || n >= 500) ? unavailable : invalid).push({ directory: relative, code: generation.code, statuses, errors });
        continue;
      }
      try {
        const response = jsonFile(responseFile), exported = jsonFile(path.join(folder, 'session-export.json'));
        const session = JSON.parse(exported.stdout), evidence = response.evidence;
        assert.equal(evidence.model, MODEL); assert.equal(evidence.reportedCost, 0);
        assert.equal(evidence.promptSHA256, sha(readFileSync(path.join(folder, 'prompt.txt'))));
        assert.equal(evidence.rawOutputSHA256, sha(generation.stdout));
        assert.equal(evidence.outputSHA256, sha(response.text));
        assert.equal(session.info.id, evidence.sessionId); assert.equal(session.info.cost, 0);
        assert.equal(`${session.info.model.providerID}/${session.info.model.id}`, MODEL);
        const messages = session.messages.filter(m => m.info.role === 'assistant');
        assert.ok(messages.length);
        for (const message of messages) { assert.equal(`${message.info.providerID}/${message.info.modelID}`, MODEL); assert.equal(message.info.cost, 0); }
        assert.equal(messages.flatMap(m => m.parts.filter(p => p.type === 'text').map(p => p.text)).join('\n'), response.text);
        completed.push({ directory: relative, sessionId: evidence.sessionId, model: MODEL, reportedCost: 0, tokens: evidence.tokens, elapsedMs: evidence.elapsedMs });
      } catch (error) { invalid.push({ directory: relative, error: error.message }); }
    }
  } };
  walk(directory); return { completed, unavailable, invalid };
}

export async function runRevision(directory) {
  const frozen = jsonFile(path.join(directory, 'freeze-v2.json'));
  assert.equal(ROOT, path.join(directory, 'snapshot'), 'Only the frozen entrypoint may run this campaign');
  const closure = jsonFile(path.join(directory, 'closure.json')), system = jsonFile(path.join(directory, 'system-dependencies.json'));
  assert.deepEqual(verifyInventory(ROOT, closure), []); assert.deepEqual(verifySystem(system), []);
  const deadline = frozen.deadline;
  assert.ok(deadline > Date.now(), 'CAMPAIGN_DEADLINE');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), deadline - Date.now());
  const provider = new OpenCodeFreeProvider({ model: MODEL, timeoutMs: 150000 });
  let activeTrial;
  const registry = makeRegistry(() => { if (!activeTrial) throw Error('NO_TASK_DURING_CONSTRUCTION'); return activeTrial; });
  const foundry = new Foundry(path.join(directory, 'foundry'), { registry, policy: { maxSteps: 20, maxConcurrency: 1, maxDurationMs: 300000, maxCost: 0 } });
  const result = { protocol: frozen.id, closureHash: frozen.closureHash, freezeHash: sha(readFileSync(path.join(directory, 'freeze-v2.json'))),
    construction: { status: 'partial', constructionPassed: false, deploymentQualified: false, taskQualified: false, attempts: [] },
    arms: [], startedAt: new Date().toISOString(), limitations: ['Two diagnostic task families; no product-parity inference', 'Noninteractive product bridge; no TUI evidence', 'Approved generic construction assistance, never hidden coding answers', 'Original DefaultAgent with documented custom Model/Environment and nondefault configuration'] };
  writeNew(path.join(directory, 'sealed-settings.json'), { tasks: TASKS, system: SYSTEM, model: MODEL, limits: frozen.limits });
  let workflow, feedback = null;
  try {
    const preflight = await runProcess('/usr/bin/node', ['--test', path.join(ROOT, 'tests/reference-swe-contract.test.mjs')], {
      cwd: ROOT, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONDONTWRITEBYTECODE: '1' },
      timeoutMs: 30000, signal: controller.signal
    });
    writeNew(path.join(directory, 'frozen-preflight.json'), preflight);
    assert.deepEqual(verifyInventory(ROOT, closure), []);
    const rule = readFileSync(path.join(HERE, 'CONSTRUCTION-RULE-v2.md'), 'utf8');
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (controller.signal.aborted) throw Error('CAMPAIGN_DEADLINE');
      assert.deepEqual(verifySystem(system), []);
      const text = `${GENERIC}\n\n${rule}${feedback ? `\n\nPrior candidate and generic construction diagnostics only:\n${JSON.stringify(feedback)}` : ''}`;
      for (const task of TASKS) { assert.ok(!text.includes(task.fn)); assert.ok(!text.includes(task.description)); }
      const request = foundry.store.createRequest({ text });
      const generator = new WorkflowGenerator(foundry, provider, { maxRounds: 1, autoApply: false, evaluator: null, maxDurationMs: Math.max(1, Math.min(300000, deadline - Date.now())) });
      console.log(JSON.stringify({ stage: 'architecture-start', attempt }));
      const job = await generator.generate(request.id, { domain: 'general', signal: controller.signal });
      const attemptDir = path.join(directory, `architecture-${attempt}`);
      writeNew(path.join(attemptDir, 'job.json'), job);
      assert.notEqual(job.deploymentQualified, true, 'Construction must not acquire deployment qualification');
      if (job.status !== 'proposed') {
        const rawDirectory = path.join(foundry.store.directory, 'generation', job.id, '01');
        const response = existsSync(path.join(rawDirectory, 'response.json')) ? jsonFile(path.join(rawDirectory, 'response.json')) : null;
        const report = { attempt, jobStatus: job.status, constructionPassed: false, deploymentQualified: false, error: job.error ?? null };
        result.construction.attempts.push(report);
        if (!response) break; // unavailable/invalid provider is not fixed by another construction call.
        feedback = { output: response.text, schemaDiagnostics: job.attempts, error: job.error }; continue;
      }
      const proposal = foundry.store.proposal(job.proposalId);
      const candidate = proposal.workflow;
      writeNew(path.join(attemptDir, 'candidate.json'), candidate);
      const gate = await constructionGate(candidate, path.join(attemptDir, 'neutral'), { signal: controller.signal });
      let mutations = null;
      if (gate.constructionPassed) mutations = await challengeGate(candidate, path.join(attemptDir, 'mutations'), { signal: controller.signal });
      result.construction.attempts.push({ attempt, jobId: job.id, jobStatus: job.status,
        workflowHash: digest(candidate), constructionPassed: gate.constructionPassed,
        mutationControlsPassed: mutations?.evaluatorSoundOnMutations ?? false, deploymentQualified: false });
      if (gate.constructionPassed && mutations.evaluatorSoundOnMutations) {
        workflow = candidate;
        foundry.apply(proposal.id);
        result.construction.constructionPassed = true;
        result.workflowHash = digest(candidate);
        writeNew(path.join(directory, 'candidate-workflow.json'), candidate);
        chmodSync(path.join(directory, 'candidate-workflow.json'), 0o400);
        result.candidateFileHash = sha(readFileSync(path.join(directory, 'candidate-workflow.json')));
        console.log(JSON.stringify({ stage: 'construction-complete', attempt, workflowHash: result.workflowHash }));
        break;
      }
      feedback = { candidate, construction: gate, mutationControlFailures: mutations?.mutations.filter(m => !m.rejected) ?? [] };
    }
    if (!workflow) throw Error('NO_EXECUTABLE_GENERATED_CANDIDATE');
    writeNew(path.join(directory, 'construction-result.json'), result.construction);
    for (const [index, task] of TASKS.entries()) for (const arm of index ? ['foundry', 'reference'] : ['reference', 'foundry']) {
      if (controller.signal.aborted) throw Error('CAMPAIGN_DEADLINE');
      assert.deepEqual(verifyInventory(ROOT, closure), []);
      assert.deepEqual(verifySystem(system), []);
      assert.equal(sha(readFileSync(path.join(directory, 'candidate-workflow.json'))), result.candidateFileHash);
      const dir = path.join(directory, `${task.id}-${arm}`);
      activeTrial = new Trial(task, dir, provider, { deadline: Math.min(deadline, Date.now() + 300000) });
      console.log(JSON.stringify({ stage: 'arm-start', task: task.id, arm }));
      let execution = null, executionError = null;
      try {
        if (arm === 'reference') execution = await runOriginal(activeTrial, { signal: controller.signal });
        else {
          const run = foundry.createRun(workflow.id, { messages: initialMessages(task) });
          execution = await foundry.startRun(run.id, { signal: controller.signal });
          writeNew(path.join(dir, 'native-run.json'), foundry.inspectRun(run.id));
        }
      } catch (error) { executionError = { code: error.code ?? null, message: error.message }; }
      const oracle = await assess(activeTrial.candidate, task, task.hidden, dir, 'hidden', controller.signal);
      const exports = verifyExports(dir);
      const identityComplete = exports.completed.length === activeTrial.calls && !exports.unavailable.length && !exports.invalid.length;
      const runtimeSuccess = arm === 'reference' ? execution?.code === 0 && execution.result?.result?.exit_status === 'Submitted' && !execution.error : execution?.status === 'succeeded';
      const success = !!(activeTrial.done && runtimeSuccess && oracle.passed && identityComplete && !executionError);
      const outcome = { task: task.id, arm, calls: activeTrial.calls, operations: activeTrial.operations,
        submitted: activeTrial.done, runtimeStatus: arm === 'reference' ? execution?.result?.result?.exit_status ?? execution?.error ?? 'error' : execution?.status ?? 'error',
        executionError, hiddenPassed: oracle.passed, passedCases: oracle.passedCases, totalCases: oracle.total,
        oracleError: oracle.transportError, identityComplete, providerUnavailable: exports.unavailable,
        providerInvalid: exports.invalid, success, classification: exports.unavailable.length ? 'provider-unavailable' : !identityComplete ? 'provider-or-export-incomplete' : oracle.transportError ? 'oracle-or-sandbox-error' : success ? 'task-success' : 'execution-or-task-failure',
        candidateHash: sha(readFileSync(activeTrial.candidate)), closureHash: frozen.closureHash };
      writeNew(path.join(dir, 'outcome.json'), outcome); result.arms.push(outcome);
      console.log(JSON.stringify({ stage: 'arm-result', ...outcome }));
    }
  } catch (error) { result.blocker = { code: error.code ?? null, message: error.message }; }
  finally {
    clearTimeout(timer); controller.abort(); await foundry.close();
    result.finishedAt = new Date().toISOString();
    result.closureChanged = verifyInventory(ROOT, closure); result.systemChanged = verifySystem(system);
    result.providerEvidence = verifyExports(directory);
    result.sourceStable = !result.closureChanged.length && !result.systemChanged.length;
    result.scope = 'Per-task external hidden-oracle outcomes only; no global deployment qualification';
    writeNew(path.join(directory, 'result-v2.json'), result);
    seal(directory);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, argument, explicitDeadline] = process.argv.slice(2);
  if (!argument) throw Error('Usage: revision-v2.mjs prepare|run NEW_RUN_DIRECTORY [ISO_DEADLINE]');
  const directory = path.resolve(argument);
  if (command === 'prepare') {
    const deadline = Date.parse(explicitDeadline);
    const freeze = freezeRevision(directory, { deadline, approval: 'prime worker inbox: generic historycontractruleapproved, add as frozenstudy-onlyoverlay initially; received 2026-09-13T13:22Z' });
    console.log(JSON.stringify({ stage: 'frozen', closureHash: freeze.closureHash, files: freeze.closureFileCount }));
    const child = spawn('/usr/bin/node', [path.join(directory, 'snapshot/research/reference-swe/revision-v2.mjs'), 'run', directory], {
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: process.env.HOME, PYTHONDONTWRITEBYTECODE: '1' }, stdio: 'inherit', cwd: path.join(directory, 'snapshot')
    });
    const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    process.exitCode = status ?? 1;
  } else if (command === 'run') {
    const result = await runRevision(directory);
    console.log(JSON.stringify({ stage: 'finished', construction: result.construction, arms: result.arms, sourceStable: result.sourceStable, blocker: result.blocker ?? null }));
  } else throw Error('Unknown command');
}
