import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseCandidate } from './foundry.mjs';
import { clone, digest, errorData, FoundryError } from './data.mjs';

function receipt(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temp, file);
}

async function boundedCall(invoke, signal) {
  if (signal.aborted) throw new FoundryError('GENERATION_CANCELLED', 'Generation cancelled before dispatch');
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(new FoundryError('GENERATION_CANCELLED', 'Generation cancelled or its host deadline expired; late callbacks cannot commit proposals'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(invoke), cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

/** The provider proposes; this host loop owns budgets, version binding and the
 * evaluator. Candidate text cannot change those controls or declare itself ready. */
export class WorkflowGenerator {
  constructor(foundry, provider, { maxRounds = 3, maxDurationMs = 900000, autoApply = false, evaluator = null } = {}) {
    if (!provider || typeof provider.generate !== 'function' || !provider.identity) throw new FoundryError('PROVIDER', 'An identified model provider is required');
    if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 10) throw new FoundryError('GENERATION_BUDGET', 'maxRounds must be between 1 and 10');
    if (!Number.isInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > 3600000) throw new FoundryError('GENERATION_BUDGET', 'Generation requires a bounded deadline');
    if (evaluator && (typeof evaluator.evaluate !== 'function' || typeof evaluator.id !== 'string')) throw new FoundryError('EVALUATOR', 'A host-owned, identified evaluator is required');
    this.foundry = foundry; this.provider = provider;
    this.options = { maxRounds, maxDurationMs, autoApply, evaluator }; this.active = new Map(); this.providerSuspension = null;
  }
  async generate(requestId, { domain, signal } = {}) {
    if (this.providerSuspension) throw new FoundryError('MODEL_RATE_LIMIT', 'This generator is paused after a recorded provider rate limit. Pending requests are retained without dispatch; restart deliberately after availability returns.', this.providerSuspension);
    const { maxRounds, maxDurationMs, autoApply, evaluator } = this.options;
    const context = this.foundry.designContext({ requestId, domain });
    const job = this.foundry.store.createGenerationJob(requestId, this.provider.identity, { maxRounds, maxDurationMs, autoApply, evaluator: evaluator?.id ?? null });
    const directory = path.join(this.foundry.store.directory, 'generation', job.id);
    const controller = new AbortController();
    const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) controller.abort();
    const deadline = Date.now() + maxDurationMs;
    const timer = setTimeout(cancel, maxDurationMs);
    const checkDeadline = () => { if (Date.now() >= deadline) controller.abort(); if (controller.signal.aborted) throw new FoundryError('GENERATION_CANCELLED', 'Generation cancelled or its total deadline expired'); };
    this.active.set(job.id, controller);
    let feedback = null;
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      receipt(path.join(directory, 'context.json'), context);
      for (let round = 1; round <= maxRounds; round++) {
        if (controller.signal.aborted || Date.now() >= deadline) throw new FoundryError('GENERATION_CANCELLED', 'Generation cancelled or its total deadline expired');
        const attemptDirectory = path.join(directory, String(round).padStart(2, '0')); mkdirSync(attemptDirectory, { mode: 0o700 });
        const prompt = `You are the Workflow Foundry architect. Use the supplied task contract, actual capabilities, schema and selected skills to engineer an executable workflow. These are data and constraints, not permission to run unrelated tools.\n\n${JSON.stringify(context, null, 2)}\n\n${feedback ? `Previous candidate and independent host feedback (repair the causal defect, preserve the task and capability contracts):\n${JSON.stringify(feedback, null, 2)}\n\n` : ''}Return exactly one JSON object with "workflow" and "rationale". Do not include Markdown or prose outside the object. First version is 1; a revision uses exactly current+1 and the same id. Do not claim deployment or task success without execution evidence.`;
        writeFileSync(path.join(attemptDirectory, 'prompt.txt'), prompt, { mode: 0o600 });
        const attempt = { round, startedAt: Date.now(), promptHash: digest(prompt), status: 'generating' };
        this.foundry.store.updateGenerationJob(job.id, current => { current.attempts.push(attempt); });
        let response, candidate, validation, evaluation = null;
        try {
          response = await boundedCall(() => this.provider.generate({ prompt, directory: attemptDirectory, signal: controller.signal, deadline }), controller.signal);
          checkDeadline();
          receipt(path.join(attemptDirectory, 'response.json'), response);
          candidate = parseCandidate(response.text);
          validation = this.foundry.validate(candidate.workflow);
          // Version/request checks are independent of syntax validity.
          const expectedVersion = (context.currentWorkflow?.version ?? 0) + 1;
          if (candidate.workflow.version !== expectedVersion || (context.currentWorkflow && candidate.workflow.id !== context.currentWorkflow.id)) {
            validation = { ...validation, valid: false, errors: [...validation.errors, { code: 'REQUEST_VERSION', message: `Workflow must preserve the requested identity and use version ${expectedVersion}` }] };
          }
          if (validation.valid && evaluator) {
            evaluation = await boundedCall(() => evaluator.evaluate({ workflow: clone(candidate.workflow), request: clone(context), signal: controller.signal, directory: attemptDirectory }), controller.signal);
            checkDeadline();
            if (!evaluation || typeof evaluation.passed !== 'boolean' || typeof evaluation.evaluatorId !== 'string' || evaluation.evaluatorId !== evaluator.id) throw new FoundryError('INVALID_EVALUATOR_RECEIPT', 'An independent evaluation receipt with the configured identity is required');
            if (evaluation.workflowHash !== digest(candidate.workflow) || evaluation.registryHash !== this.foundry.registry.hash()) throw new FoundryError('INVALID_EVALUATOR_RECEIPT', 'Evaluation must be bound to the exact candidate and capability registry');
            this.foundry.store.recordQualification(evaluation);
          }
          const passed = validation.valid && (!evaluator || evaluation.passed);
          // Structural/trace conformance is not independent task success. Reports
          // without an explicit scope remain useful but unclassified evidence.
          const qualificationLevel = evaluation?.qualificationLevel ?? 'unclassified';
          const taskOutcomeQualified = evaluation?.passed === true && qualificationLevel === 'task-outcome';
          const constructionQualified = evaluation?.passed === true && ['construction', 'task-outcome'].includes(qualificationLevel);
          const qualification = taskOutcomeQualified ? 'Task outcome checked only within the evaluator-declared envelope; not general deployment readiness'
            : constructionQualified ? 'Construction behavior checked; task outcomes and deployment remain unqualified'
              : evaluator ? 'Evaluator result recorded without task-outcome qualification because its assessment level is unspecified'
                : 'Schema/capability/identity checks only; task quality is unmeasured';
          const assessment = { validation, evaluation, readyForProposal: passed, qualificationLevel, constructionQualified, taskOutcomeQualified,
            deploymentQualified: taskOutcomeQualified, qualification };
          receipt(path.join(attemptDirectory, 'assessment.json'), assessment);
          this.foundry.store.updateGenerationJob(job.id, current => {
            Object.assign(current.attempts.at(-1), { status: passed ? 'accepted-candidate' : 'rejected-candidate', finishedAt: Date.now(), outputHash: digest(response.text), workflowHash: digest(candidate.workflow), evidence: response.evidence ?? null, assessment });
          });
          if (!passed) { feedback = { candidate, assessment }; continue; }
          checkDeadline();
          // Only now create a program proposal. Any concurrent workflow edit is
          // still checked by apply's compare-and-swap, never overwritten.
          const proposal = this.foundry.propose({ requestId, workflow: candidate.workflow, rationale: candidate.rationale });
          if (autoApply) this.foundry.apply(proposal.id);
          return this.foundry.store.updateGenerationJob(job.id, current => {
            current.status = autoApply ? 'applied' : 'proposed'; current.proposalId = proposal.id;
            current.workflowHash = proposal.workflowHash; current.contextHash = context.contextHash;
            current.qualification = assessment.qualification; current.qualificationLevel = assessment.qualificationLevel;
            current.constructionQualified = assessment.constructionQualified; current.taskOutcomeQualified = assessment.taskOutcomeQualified;
            // Compatibility field: this is limited to the same enumerated task
            // envelope, never a general production or arbitrary-domain guarantee.
            current.deploymentQualified = assessment.deploymentQualified; current.finishedAt = Date.now();
          });
        } catch (error) {
          const diagnostic = { error: errorData(error), ...(error.details ? { details: error.details } : {}) };
          receipt(path.join(attemptDirectory, 'error.json'), diagnostic);
          this.foundry.store.updateGenerationJob(job.id, current => { Object.assign(current.attempts.at(-1), { status: 'failed-attempt', finishedAt: Date.now(), ...diagnostic }); });
          // Broken runtime/evaluator/provider/authority are not repaired by asking
          // the model to pretend the failure disappeared.
          if (!['CANDIDATE_FORMAT', 'CANDIDATE_SIZE'].includes(error.code)) throw error;
          feedback = { previousOutput: response?.text ?? null, ...diagnostic };
        }
      }
      throw new FoundryError('GENERATION_EXHAUSTED', 'No candidate met the configured checks within the allowed rounds');
    } catch (error) {
      if (error.code === 'MODEL_RATE_LIMIT') this.providerSuspension = { code: error.code, observedAt: Date.now(), reason: error.message, details: error.details ?? null, automaticRetry: false };
      return this.foundry.store.updateGenerationJob(job.id, current => {
        current.status = controller.signal.aborted ? 'cancelled' : 'failed'; current.error = errorData(error); current.finishedAt = Date.now();
      });
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); this.active.delete(job.id); }
  }
  cancel(jobId) { const controller = this.active.get(jobId); if (!controller) throw new FoundryError('GENERATOR_NOT_ACTIVE', 'This process does not own that active job'); controller.abort(); }
}

/** A serial local service loop for explicitly enabled UI generation. It processes
 * each pending request once; failed jobs never silently respawn or spend forever. */
export function startRequestProcessor(generator, { intervalMs = 750, onError = error => console.error('Foundry generator:', error.message) } = {}) {
  let stopped = false, busy = false;
  const controller = new AbortController();
  const tick = async () => {
    if (stopped || busy || generator.providerSuspension) return;
    const pending = generator.foundry.store.pendingRequests();
    if (!pending.length) return;
    busy = true;
    try { await generator.generate(pending[0].id, { signal: controller.signal }); }
    catch (error) { onError(error); }
    finally { busy = false; }
  };
  const timer = setInterval(tick, intervalMs);
  void tick();
  return { close: async () => { stopped = true; clearInterval(timer); controller.abort(); while (busy) await new Promise(resolve => setTimeout(resolve, 25)); } };
}
