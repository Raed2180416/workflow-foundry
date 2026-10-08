// State-only solvers and partial-input predictors for F1 (JUDGE-PROGRAM.md §2.7 steps 1-2 and 7, §6.3 PART, §1.2 F1
// "Shortcut control"). They read exported states only, never meta.
//   solveF1(state)      a rule over error_code, node_kind and the last events, the way the probe's rule read the old templates
//                       (0.971 [M probe] on templates); it answers null for a state its rules do not decide. F1 is NOT expected to
//                       be code-solvable at 99.5%: one pre-replay state can have several causes, and those masked-state collision
//                       groups train on their empirical cause distribution (soft targets), so the audit reports decided-row
//                       accuracy and the undecided share instead of a pass/fail at 99.5%.
//   partial predictors  prior_runs only (must sit within 10 pp of the majority class on the build), error_code only, message only,
//                       node_kind only, the key set only: fitted on one half of the rows, read on the other (split by hash of the
//                       row's form, so a shape or template is on one side only)
import { trainProbe, evaluate } from '../lib/probe.mjs';
import { sha } from '../exec/util.mjs';

const FLAKE = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'HTTP_503', 'HTTP_502', 'SQLITE_BUSY', 'EBUSY', 'EAGAIN', 'ERR_SOCKET_CONNECTION_TIMEOUT', 'MODEL_RATE_LIMIT', 'MODEL_TIMEOUT']);
const ENV = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOENT', 'ENOTDIR', 'ENOSPC', 'EACCES', 'EAUTH', 'HTTP_401', 'AUTH_REQUIRED', 'SANDBOX_UNAVAILABLE', 'MODEL_UNAVAILABLE']);
const DEFECT = new Set(['MISSING_REFERENCE', 'TEMPLATE_VARIABLE', 'AGGREGATE_TYPE', 'AGGREGATE_EMPTY', 'CONDITION_TYPE', 'SCHEMA_MISMATCH']);

export function solveF1(state) {
  const { error_code: code, node_kind: kind, message = '' } = state, events = (state.last_events ?? []).join('\n');
  if (FLAKE.has(code)) return { label: 'flake', rule: 'transient code' };
  if (ENV.has(code)) return { label: 'env', rule: 'environment code' };
  if (DEFECT.has(code)) return { label: 'defect', rule: 'workflow evaluation error' };
  if (code === 'CODE_ERROR') return { label: /ModuleNotFoundError|not found|Operation not permitted|memory limit/.test(message) ? 'env' : /ECONNRESET|Connection reset|URLError/.test(message) ? 'flake' : 'defect', rule: 'code error text' };
  if (code === 'ACCEPTANCE_FAILED' || code === 'CODE_OUTPUT') return { label: code === 'CODE_OUTPUT' ? 'impossible' : 'impossible', rule: 'acceptance or schema failure' };
  if (code === 'NODE_CHECK_FAILED' && kind === 'agent') return { label: 'variance', rule: 'a model output check failed' };
  if (code === 'ERROR' || code === 'SUT_ERROR' || code === 'SUT_CRASH' || code === 'SESSION_ABORTED') return { label: 'finding', rule: 'the system under test raised' };
  if ((code === 'ASSERTION_FAILED' || code === 'VERIFY_FAILED') && state.last_events) {
    if (/\(agent\)/.test(events)) return { label: 'variance', rule: 'a gate after a model node' };
    if (/call_service|run_checkout|exercise_|probe_endpoint|drive_cart|invoke_formatter|run_pricing/.test(events)) return { label: 'finding', rule: 'a gate after the system under test' };
  }
  return { label: null, rule: 'undecided' };
}

export function majority(rows, label) {
  const c = {};
  for (const r of rows) c[label(r)] = (c[label(r)] ?? 0) + 1;
  const [top, n] = Object.entries(c).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return { label: top, share: rows.length ? n / rows.length : 0, counts: c };
}

// features of a state, by name
export const FEATURES = Object.freeze({
  prior_runs: s => `p${s.prior_runs?.passes}|f${s.prior_runs?.failures}|d${s.prior_runs?.distinct_error_codes}`,
  error_code: s => s.error_code,
  node_kind: s => s.node_kind,
  keys: s => Object.keys(s).sort().join(','),
  metadata: s => `${s.node_kind}|${s.attempt}`,
});

// fitted on the rows whose side is 0, read on side 1. A categorical feature predicts the majority label of its value;
// 'message' is a bag-of-words probe over the message text. Returns accuracy and the majority baseline of the read side.
export function partialPredictor(rows, name, { label = r => r.label, side = r => parseInt(sha(r.form).slice(0, 4), 16) % 2, l2 = 1e-3 } = {}) {
  const fit = rows.filter(r => side(r) === 0), read = rows.filter(r => side(r) === 1);
  if (!fit.length || !read.length) return { name, n: read.length, accuracy: null, majority: null };
  const base = majority(fit, label).label;
  let hits = 0;
  if (name === 'message') {
    const model = trainProbe(fit.map(r => ({ text: `${r.state.message}`, label: label(r) })), { l2 });
    const ev = evaluate(model, read.map(r => ({ text: `${r.state.message}`, label: label(r) })));
    hits = Math.round(ev.accuracy * read.length);
  } else {
    const f = FEATURES[name], by = new Map();
    for (const r of fit) { const k = f(r.state), m = by.get(k) ?? {}; m[label(r)] = (m[label(r)] ?? 0) + 1; by.set(k, m); }
    const pred = new Map([...by].map(([k, m]) => [k, Object.entries(m).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]]));
    for (const r of read) if ((pred.get(f(r.state)) ?? base) === label(r)) hits++;
  }
  const maj = majority(read, label);
  return { name, n: read.length, accuracy: hits / read.length, majority: maj.share, gap: hits / read.length - maj.share, majorityLabel: maj.label };
}
export const partialBattery = (rows, opts) => Object.fromEntries(['prior_runs', 'error_code', 'message', 'node_kind', 'keys', 'metadata'].map(n => [n, partialPredictor(rows, n, opts)]));
