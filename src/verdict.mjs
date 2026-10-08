import { FoundryError } from './data.mjs';
import { assessWorkflow } from './acceptance.mjs';

// DESIGN §5.2. A verdict describes what a run established; it never grants authority.
// `unverified` (R-17): the run reached its end but nothing that a wrong answer can fail gated it, so the answer
// is neither supported nor refuted. A run is `pass` only if its acceptance gates on an independent check.
export const VERDICTS = Object.freeze(['pass', 'finding', 'unverified', 'inconclusive', 'env_fault', 'harness_fault', 'uncertain']);
export const AUTHORITY = Object.freeze({ pass: 'supported', finding: 'supported', unverified: 'unresolved', inconclusive: 'unresolved',
  harness_fault: 'unresolved', env_fault: 'unresolved', uncertain: 'in-doubt' });
// Why a succeeded run is `unverified`. Evidence against the answer is reported before the lack of evidence for it.
export const UNVERIFIED_CODES = Object.freeze(['VERIFY_FAILED_NONBLOCKING', 'ERROR_COLLECTED', 'ACCEPTANCE_EXISTENCE_ONLY', 'NO_ORACLE_DECLARED', 'ACCEPTANCE_UNASSESSED']);
export const AUTHORITY_FLAGS = Object.freeze({ grantsActionAuthority: false, establishesCompletion: false });
export const INCONCLUSIVE_CODES = Object.freeze(['VERIFY_FAILED', 'ACCEPTANCE_FAILED', 'ASSERTION_FAILED', 'NODE_CHECK_FAILED',
  'LOOP_EXHAUSTED', 'STEP_BUDGET', 'COST_BUDGET', 'DEADLINE']);
export const ENV_FAULT_CODES = Object.freeze(['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT', 'SANDBOX_UNAVAILABLE',
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
const stateOf = (run, id) => [run.nodes?.[id], ...Object.values(run.frames ?? {}).map(frame => frame?.nodes?.[id])].filter(Boolean);
const outputsOf = (run, id) => [run.outputs?.[id], ...Object.values(run.frames ?? {}).map(frame => frame?.outputs?.[id])].filter(value => value !== undefined);

// What a succeeded run established, from its recorded evidence and what its workflow's acceptance can fail on.
function succeeded(run, workflow) {
  const assessed = assessWorkflow(workflow), grade = assessed.acceptance.grade, extra = { acceptance: grade };
  const failedVerify = assessed.nonGatingVerifies.find(v => outputsOf(run, v.id).some(out => out?.pass === false));
  if (failedVerify) return result('unverified', `Run succeeded, but verify node ${failedVerify.id} recorded a failure and nothing gated on it; the answer needs review`, 'VERIFY_FAILED_NONBLOCKING', extra);
  const dropped = assessed.ungatedCollectMaps.map(m => ({ ...m, failed: stateOf(run, m.id).reduce((sum, s) => sum + (Number.isInteger(s.failedItems) ? s.failedItems : 0), 0) })).filter(m => m.failed > 0);
  if (dropped.length) return result('unverified', `Run succeeded, but map ${dropped.map(m => `${m.id} (${m.failed} failed)`).join(', ')} collected item failures and no acceptance check read the failed count`, 'ERROR_COLLECTED', extra);
  if (grade === 'existence-only') return result('unverified', 'Run succeeded, but its acceptance only checks that an answer exists, so nothing independent established the answer', 'ACCEPTANCE_EXISTENCE_ONLY', extra);
  if (grade === 'no-oracle') return result('unverified', `Run succeeded; the workflow declares that no oracle exists${assessed.acceptance.reason ? `: ${assessed.acceptance.reason}` : ''}`, 'NO_ORACLE_DECLARED', extra);
  if (grade === 'unassessed') return result('unverified', 'Run succeeded, but the workflow acceptance was not supplied, so the verdict cannot call it a pass', 'ACCEPTANCE_UNASSESSED', extra);
  return result('pass', 'Run succeeded and its acceptance gated on a check that a wrong answer can fail', null, extra);
}

// `discovery` comes from the workflow (§1.5); confirmed findings are entries with confirmed:true,
// or a count supplied by the caller that confirmed them. `workflow` also carries the acceptance contract:
// without it a succeeded run cannot be a `pass`.
export function verdictOf(run, { workflow, discovery = workflow?.discovery ?? run?.discovery, findings = run?.findings } = {}) {
  if (!run || typeof run !== 'object') throw new FoundryError('VERDICT_INPUT', 'A run record is required');
  if (!terminal.has(run.status)) throw new FoundryError('RUN_NOT_TERMINAL', `Run status ${run.status} has no verdict yet`);
  if (run.status === 'uncertain') return result('uncertain', 'An effect may or may not have happened; reconciliation is required', run.error?.code ?? null);
  if (run.status === 'succeeded') {
    const count = confirmed(findings);
    if (discovery === true && count > 0) return result('finding', `Discovery workflow succeeded with ${count} confirmed finding${count === 1 ? '' : 's'}`);
    return succeeded(run, workflow);
  }
  const code = run.error?.code ?? null;
  if (run.status === 'cancelled') return result('inconclusive', `Run was stopped before reaching a decision${code ? ` (${code})` : ''}`, code);
  if (inconclusive.has(code)) return result('inconclusive', `A check or budget stopped the run without a decision (${code})`, code);
  if (env.has(code)) return result('env_fault', `The environment failed, not the workflow (${code})`, code);
  return result('harness_fault', `The harness or workflow failed (${code ?? 'no error code'})`, code);
}
