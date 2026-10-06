import { FoundryError } from './data.mjs';

// DESIGN §5.2. A verdict describes what a run established; it never grants authority.
export const VERDICTS = Object.freeze(['pass', 'finding', 'inconclusive', 'env_fault', 'harness_fault', 'uncertain']);
export const AUTHORITY = Object.freeze({ pass: 'supported', finding: 'supported', inconclusive: 'unresolved',
  harness_fault: 'unresolved', env_fault: 'unresolved', uncertain: 'in-doubt' });
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
const result = (verdict, reason, code = null) => ({ verdict, reason, code, authority: AUTHORITY[verdict], ...AUTHORITY_FLAGS });
const confirmed = findings => typeof findings === 'number' ? findings : (Array.isArray(findings) ? findings.filter(f => f?.confirmed === true).length : 0);

// `discovery` comes from the workflow (§1.5); confirmed findings are entries with confirmed:true,
// or a count supplied by the caller that confirmed them.
export function verdictOf(run, { workflow, discovery = workflow?.discovery ?? run?.discovery, findings = run?.findings } = {}) {
  if (!run || typeof run !== 'object') throw new FoundryError('VERDICT_INPUT', 'A run record is required');
  if (!terminal.has(run.status)) throw new FoundryError('RUN_NOT_TERMINAL', `Run status ${run.status} has no verdict yet`);
  if (run.status === 'uncertain') return result('uncertain', 'An effect may or may not have happened; reconciliation is required', run.error?.code ?? null);
  if (run.status === 'succeeded') {
    const count = confirmed(findings);
    if (discovery === true && count > 0) return result('finding', `Discovery workflow succeeded with ${count} confirmed finding${count === 1 ? '' : 's'}`);
    return result('pass', 'Run succeeded and its acceptance checks held');
  }
  const code = run.error?.code ?? null;
  if (run.status === 'cancelled') return result('inconclusive', `Run was stopped before reaching a decision${code ? ` (${code})` : ''}`, code);
  if (inconclusive.has(code)) return result('inconclusive', `A check or budget stopped the run without a decision (${code})`, code);
  if (env.has(code)) return result('env_fault', `The environment failed, not the workflow (${code})`, code);
  return result('harness_fault', `The harness or workflow failed (${code ?? 'no error code'})`, code);
}
