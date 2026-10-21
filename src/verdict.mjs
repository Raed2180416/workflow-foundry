import { FoundryError } from './data.mjs';
import { assessWorkflow } from './acceptance.mjs';

// DESIGN §5.2. A verdict describes what a run established; it never grants authority.
// `unverified` (R-17): the run reached its end but nothing that a wrong answer can fail gated it, so the answer
// is neither supported nor refuted. A run is `pass` only if its acceptance gates on an independent check.
export const VERDICTS = Object.freeze(['pass', 'finding', 'unverified', 'inconclusive', 'env_fault', 'harness_fault', 'uncertain']);
export const AUTHORITY = Object.freeze({ pass: 'supported', finding: 'supported', unverified: 'unresolved', inconclusive: 'unresolved',
  harness_fault: 'unresolved', env_fault: 'unresolved', uncertain: 'in-doubt' });
// Why a succeeded run is `unverified`. Evidence against the answer is reported before the lack of evidence for it.
export const UNVERIFIED_CODES = Object.freeze(['VERIFY_FAILED_NONBLOCKING', 'ERROR_COLLECTED', 'ERROR_CONTINUED', 'ACCEPTANCE_EXISTENCE_ONLY', 'NO_ORACLE_DECLARED',
  'GATE_NOT_RUN', 'ACCEPTANCE_UNASSESSED']);
export const AUTHORITY_FLAGS = Object.freeze({ grantsActionAuthority: false, establishesCompletion: false });
// A cross-run state write that lost a compare-and-swap to another writer, or found its slot full, stopped the run without a decision: contention
// and a declared bound, not a defect of the harness (src/state.mjs). A signal wait whose timer ran out with onTimeout "fail" stopped it the same way:
// the awaited event did not come within its declared bound (src/signals.mjs); and a wait whose timer falls after the run deadline (WAIT_DEADLINE)
// is the run's time budget, as DEADLINE is.
export const INCONCLUSIVE_CODES = Object.freeze(['VERIFY_FAILED', 'ACCEPTANCE_FAILED', 'ASSERTION_FAILED', 'NODE_CHECK_FAILED',
  'LOOP_EXHAUSTED', 'STEP_BUDGET', 'COST_BUDGET', 'TOKEN_BUDGET', 'DEADLINE', 'STATE_VERSION_CONFLICT', 'STATE_FULL', 'WAIT_TIMEOUT', 'WAIT_DEADLINE']);
export const ENV_FAULT_CODES = Object.freeze(['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT', 'SANDBOX_UNAVAILABLE', 'STORAGE_FULL', 'STORAGE_UNAVAILABLE',
  'NETWORK', 'MODEL_TRANSPORT', 'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT',
  'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const inconclusive = new Set(INCONCLUSIVE_CODES), env = new Set(ENV_FAULT_CODES);
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'uncertain']);

export const authorityOf = verdict => {
  if (!Object.hasOwn(AUTHORITY, verdict)) throw new FoundryError('UNKNOWN_VERDICT', `Unknown verdict: ${verdict}`);
  return AUTHORITY[verdict];
};
const result = (verdict, reason, code = null, extra = {}) => ({ verdict, reason, code, authority: AUTHORITY[verdict], ...AUTHORITY_FLAGS, ...extra });
const confirmed = findings => typeof findings === 'number' ? findings : (Array.isArray(findings) ? findings.filter(f => f?.confirmed === true).length : 0);

// Node states and outputs of a run, at the root and in every nested frame, keyed by node id.
const framesOf = run => Object.values(run.frames && typeof run.frames === 'object' ? run.frames : {}).filter(frame => frame && typeof frame === 'object');
const stateOf = (run, id) => [run.nodes?.[id], ...framesOf(run).map(frame => frame.nodes?.[id])].filter(Boolean);
const outputsOf = (run, id) => [run.outputs?.[id], ...framesOf(run).map(frame => frame.outputs?.[id])].filter(value => value !== undefined);
// Did an assert or verify gate actually run? A skipped gate (its `when` was false, or a predecessor failed into onError:"continue"
// or was skipped) checked nothing. A gate in a map or loop body must have run in every frame of that body, and in at least one.
// A gating verify or an assert that completed has passed: one that fails stops the run.
function gateRan(run, gate) {
  if (gate.type === 'acceptance-predicate') return true;
  const trail = String(gate.node).split('.'), id = trail.pop();
  if (!trail.length) return run.nodes?.[id]?.status === 'completed';
  const pattern = new RegExp(`^root${trail.map(segment => `/${segment.replace(/[^A-Za-z0-9_-]/g, '')}:\\d+`).join('')}$`);
  const frames = Object.entries(run.frames && typeof run.frames === 'object' ? run.frames : {}).filter(([key]) => pattern.test(key)).map(([, frame]) => frame);
  return frames.length > 0 && frames.every(frame => frame?.nodes?.[id]?.status === 'completed');
}

// What a succeeded run established, from its recorded evidence and what its workflow's acceptance can fail on.
function succeeded(run, workflow) {
  const assessed = assessWorkflow(workflow), grade = assessed.acceptance.grade, extra = { acceptance: grade };
  const failedVerify = assessed.nonGatingVerifies.find(v => outputsOf(run, v.id).some(out => out?.pass === false));
  if (failedVerify) return result('unverified', `Run succeeded, but verify node ${failedVerify.id} recorded a failure and nothing gated on it; the answer needs review`, 'VERIFY_FAILED_NONBLOCKING', extra);
  const dropped = assessed.ungatedCollectMaps.map(m => ({ ...m, failed: stateOf(run, m.id).reduce((sum, s) => sum + (Number.isInteger(s.failedItems) ? s.failedItems : 0), 0) })).filter(m => m.failed > 0);
  if (dropped.length) return result('unverified', `Run succeeded, but map ${dropped.map(m => `${m.id} (${m.failed} failed)`).join(', ')} collected item failures and no acceptance check read the failed count`, 'ERROR_COLLECTED', extra);
  const continued = (assessed.ungatedContinuations ?? []).map(n => ({ ...n, handled: stateOf(run, n.id).filter(s => s.status === 'handled_error').length })).filter(n => n.handled > 0);
  if (continued.length) return result('unverified', `Run succeeded, but node ${continued.map(n => `${n.id} (${n.handled} handled error${n.handled === 1 ? '' : 's'})`).join(', ')} failed into onError:"continue" and nothing gated on its outcome`, 'ERROR_CONTINUED', extra);
  if (grade === 'existence-only') return result('unverified', 'Run succeeded, but its acceptance only checks that an answer exists, so nothing independent established the answer', 'ACCEPTANCE_EXISTENCE_ONLY', extra);
  if (grade === 'no-oracle') return result('unverified', `Run succeeded; the workflow declares that no oracle exists${assessed.acceptance.reason ? `: ${assessed.acceptance.reason}` : ''}`, 'NO_ORACLE_DECLARED', extra);
  if (grade === 'unassessed') return result('unverified', 'Run succeeded, but the workflow acceptance was not supplied, so the verdict cannot call it a pass', 'ACCEPTANCE_UNASSESSED', extra);
  if (!assessed.acceptance.gates.some(gate => gateRan(run, gate))) {
    return result('unverified', `Run succeeded, but none of its gates ran (${assessed.acceptance.gates.map(g => g.node).join(', ')} skipped), so nothing that a wrong answer can fail checked it`, 'GATE_NOT_RUN', extra);
  }
  return result('pass', 'Run succeeded and its acceptance gated on a check that a wrong answer can fail', null, extra);
}

// What the user can do after a stop (orch-20261021 rank 15; Conductor's failure contract): for each stop code, whether the run can continue
// and the next action, in words that name a real command. A run that stopped on a code not listed is a harness or workflow failure.
const remedy = (continuable, action, text) => Object.freeze({ continuable, action, text });
const OUTAGE = remedy(true, 'resume', 'The model provider or the network failed, not the workflow; resume the run (foundry resume RUN) once it is back. Completed work is kept.');
const HOST = remedy(true, 'fix-host', 'The host failed, not the workflow; fix it, then resume the run (foundry resume RUN). Completed work is kept.');
const CHECK = remedy(false, 'repair', 'Final: a check failed, so the answer is not established and this run cannot continue; inspect the failed check (foundry inspect RUN), repair the workflow or its input, then start a new run.');
const budget = name => remedy(false, 'raise-budget', `Final: the run's budget is bound when it is created, so this run cannot continue; raise ${name} (the workflow budget or the host policy) and start a new run. Completed work stays in the record.`);
export const REMEDIES = Object.freeze({
  MODEL_RATE_LIMIT: remedy(true, 'resume-after', 'The provider limited the rate or the usage; resume the run (foundry resume RUN) after the limit resets. Completed work is kept.'),
  ...Object.fromEntries(ENV_FAULT_CODES.filter(code => !['MODEL_RATE_LIMIT', 'SANDBOX_UNAVAILABLE', 'STORAGE_FULL', 'STORAGE_UNAVAILABLE'].includes(code)).map(code => [code, OUTAGE])),
  SANDBOX_UNAVAILABLE: remedy(true, 'fix-host', 'The code sandbox could not start; enable user, mount and pid namespaces on the host, then resume the run (foundry resume RUN).'),
  STORAGE_FULL: remedy(true, 'free-space', 'The workspace disk is full; free space, then resume the run (foundry resume RUN). The failed write committed nothing.'),
  STORAGE_UNAVAILABLE: HOST,
  COST_BUDGET: budget('maxCost'), TOKEN_BUDGET: budget('maxTokens'), STEP_BUDGET: budget('maxSteps'),
  DEADLINE: budget('maxDurationMs'), WAIT_DEADLINE: budget('maxDurationMs'),
  WAIT_TIMEOUT: remedy(false, 'rerun', 'Final: the awaited event did not arrive within its declared bound, so this run cannot continue; start a new run when the event can arrive in time.'),
  STATE_VERSION_CONFLICT: remedy(false, 'rerun', 'Final: another writer changed the shared state first, so this run cannot continue; start a new run to act on the current state.'),
  STATE_FULL: remedy(false, 'rerun', 'Final: the shared state slot is full, so this run cannot continue; make room under its declared bound, then start a new run.'),
  VERIFY_FAILED: CHECK, ACCEPTANCE_FAILED: CHECK, ASSERTION_FAILED: CHECK, NODE_CHECK_FAILED: CHECK, LOOP_EXHAUSTED: CHECK,
  CANCELLED: remedy(false, 'none', 'Final: the run was cancelled and cannot continue; start a new run if the work is still wanted.')
});
const HARNESS = remedy(false, 'investigate', 'Final: the harness or the workflow failed and this run cannot continue; inspect it (foundry inspect RUN, foundry verify-run RUN), fix the cause, then start a new run.');
const at = ms => Number.isFinite(ms) ? new Date(ms).toISOString() : 'its retry time';
const statesOf = run => [['root', run.nodes ?? {}], ...Object.entries(run.frames && typeof run.frames === 'object' ? run.frames : {}).map(([key, frame]) => [key, frame?.nodes ?? {}])]
  .flatMap(([frame, nodes]) => Object.entries(nodes).map(([id, state]) => ({ nodeKey: `${frame}/${id}`, state })));

/** What the record tells the user about a stop, for a run of any status: {code, cause, continuable, action, text, ...}, or null for a run
 *  that succeeded or is still running. Pure function of the record (no clock): the CLI prints it and terminal verdicts seal it. */
export function remedyOf(run) {
  if (!run || typeof run !== 'object' || ['succeeded', 'running', 'pending'].includes(run.status)) return null;
  const states = statesOf(run), code = run.error?.code ?? null, cause = run.error?.message ?? null;
  if (run.status === 'uncertain') {
    const effects = states.filter(s => s.state?.status === 'uncertain').map(s => ({ nodeKey: s.nodeKey, tool: s.state.tool ?? null }));
    const named = effects.map(e => `${e.nodeKey}${e.tool ? ` (${e.tool})` : ''}`).join(', ') || 'the effect in flight';
    return { code: code ?? 'EFFECT_UNCERTAIN', cause: cause ?? 'An effect may or may not have happened', continuable: false, action: 'reconcile', effects,
      text: `Check whether ${named} took effect in the external system it targets: only that system's owner can say, Foundry cannot. The run cannot continue until the effect is reconciled there; if it did not happen, start a new run.` };
  }
  if (run.status === 'awaiting_human') {
    const keys = states.filter(s => s.state?.status === 'awaiting_human').map(s => s.nodeKey);
    return { code: 'AWAITING_HUMAN', cause: `A person's answer is needed at ${keys.join(', ') || 'a human node'}`, continuable: true, action: 'answer', nodeKeys: keys,
      text: `The run can continue: answer ${keys[0] ?? 'the question'} (foundry answer RUN --node ${keys[0] ?? 'KEY'} --answer JSON), then resume it (foundry resume RUN).` };
  }
  if (run.status === 'awaiting_approval') {
    const ids = Object.entries(run.approvals ?? {}).filter(([, a]) => a?.status === 'pending' || a?.approved == null).map(([id]) => id);
    return { code: 'AWAITING_APPROVAL', cause: 'An effect waits for an approval', continuable: true, action: 'approve', approvalIds: ids,
      text: `The run can continue: approve or reject the pending effect (foundry approve RUN ${ids[0] ?? 'APPROVAL_ID'} --approved|--rejected), then resume it (foundry resume RUN).` };
  }
  if (run.status === 'waiting') {
    const parked = states.filter(s => s.state?.status === 'waiting' && s.state.parked).map(s => ({ nodeKey: s.nodeKey, ...s.state.parked }));
    if (parked.length) {
      const first = parked.reduce((a, b) => (b.retryAt < a.retryAt ? b : a)), base = REMEDIES[first.code] ?? OUTAGE;
      return { code: first.code, cause: first.message ?? first.code, continuable: true, action: 'resume-after', retryAt: first.retryAt, parked,
        text: `Parked, not failed: ${first.nodeKey} hit ${first.code}. The run can continue and resumes after ${at(first.retryAt)} (foundry tick, or foundry resume RUN after that time). ${base.text}` };
    }
    return { code: 'WAITING', cause: 'The run waits for a timer or a signal', continuable: true, action: 'wait',
      text: 'The run can continue: it resumes when its timer is due or its signal arrives (foundry tick; foundry signal RUN for a signal).' };
  }
  const r = REMEDIES[code] ?? HARNESS;
  return { code, cause, ...r };
}

// `discovery` comes from the workflow (§1.5); confirmed findings are entries with confirmed:true,
// or a count supplied by the caller that confirmed them. `workflow` also carries the acceptance contract:
// without it a succeeded run cannot be a `pass`.
export function verdictOf(run, { workflow, discovery = workflow?.discovery ?? run?.discovery, findings = run?.findings } = {}) {
  if (!run || typeof run !== 'object') throw new FoundryError('VERDICT_INPUT', 'A run record is required');
  if (!terminal.has(run.status)) throw new FoundryError('RUN_NOT_TERMINAL', `Run status ${run.status} has no verdict yet`);
  if (run.status === 'succeeded') {
    const count = confirmed(findings);
    if (discovery === true && count > 0) return result('finding', `Discovery workflow succeeded with ${count} confirmed finding${count === 1 ? '' : 's'}`);
    return succeeded(run, workflow);
  }
  // Every stop carries its remedy (rank 15): whether the run can continue and the next action. It is sealed with the verdict.
  const { continuable, action, text } = remedyOf(run), remedied = { remedy: { continuable, action, text } };
  if (run.status === 'uncertain') return result('uncertain', 'An effect may or may not have happened; reconciliation is required', run.error?.code ?? null, remedied);
  const code = run.error?.code ?? null;
  if (run.status === 'cancelled') return result('inconclusive', `Run was stopped before reaching a decision${code ? ` (${code})` : ''}`, code, remedied);
  if (inconclusive.has(code)) return result('inconclusive', `A check or budget stopped the run without a decision (${code})`, code, remedied);
  if (env.has(code)) return result('env_fault', `The environment failed, not the workflow (${code})`, code, remedied);
  return result('harness_fault', `The harness or workflow failed (${code ?? 'no error code'})`, code, remedied);
}
