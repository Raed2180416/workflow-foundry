// Run history core: pure functions shared by the Node index builder and the history page. No DOM, no Node APIs, no network.
//   Importable by node tests as globalThis.HistoryCore (after `await import('./history-core.js')`) and loaded by history.html as a classic script.
// What lives here (design: research/review-20261007/06b-run-history.md):
//   text safety   sanitizeDisplay, safeId        run text is data: control, bidi and zero-width characters are made visible, ids are pattern-bound
//   honesty       honestyOf                      the runtime's verdict compared with an independent oracle outcome
//   folding       foldFacts                      recorded events -> typed facts (codes, ids, counts, costs, times; never free text)
//   summary       factList, summarise            deterministic, free, always on; every statement cites numbered facts; "unknown" instead of a guess
//   timeline      buildLanes                     node lanes, call segments, markers, a density band for map/loop containers, the critical path
//   compare       compareDocs                    header diff, aligned node table, first divergence (by output hash), workflow-version diff
//   list          filterRows, sortRows, aggregate, taskMatrix   the runs list, with an honest totals line
(function (root) {
'use strict';

// ======================================================================================================== helpers
const shortModel = id => String(id ?? '').replace(/^claude-/, '');
const clip = (text, max) => { const s = String(text ?? ''); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };
const fmtCost = n => n == null || !Number.isFinite(n) ? '–' : n === 0 ? '$0' : n < 0.001 ? `$${n.toFixed(5)}` : n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
function fmtDur(ms) {
  if (!Number.isFinite(ms)) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
  const s = Math.round(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.floor(s % 3600 / 60)).padStart(2, '0')} m` : `${Math.floor(s / 60)} m ${String(s % 60).padStart(2, '0')} s`;
}
const fmtUtc = (ms, withSeconds = false) => Number.isFinite(ms) ? new Date(ms).toISOString().slice(5, withSeconds ? 19 : 16).replace('T', ' ') : '–';
const fmtScore = n => Number.isFinite(n) ? n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : '–';
const round = (n, d = 6) => Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : n;
const sum = (list, f = x => x) => list.reduce((a, x) => a + (f(x) ?? 0), 0);
const median = list => { const s = list.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
// A dictionary keyed by run data has no prototype: a model id or node id such as "__proto__" or "constructor" is an ordinary key, never Object.prototype.
const dict = () => Object.create(null);
const own = (obj, key) => obj != null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
const bump = (obj, key, n = 1) => { obj[key] = (own(obj, key) ? obj[key] : 0) + n; };

// Text that came from a run is data. Control, bidi and zero-width characters are made visible so they cannot spoof the page.
// (Code points are listed as numbers so this source file holds no invisible characters.) Same rules as run-view.js sanitizeDisplay.
const INVISIBLE_RANGES = [[0, 8], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x61c, 0x61c], [0x180e, 0x180e], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb]];
const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([a, b]) => `\\u${hex4(a)}${a === b ? '' : `-\\u${hex4(b)}`}`).join('')}]`, 'g');
const LONE_SURROGATE = new RegExp('[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]', 'g');
function sanitizeDisplay(text) {
  let replaced = 0;
  const out = String(text ?? '').replace(INVISIBLE, ch => { replaced++; return `⟦U+${hex4(ch.charCodeAt(0))}⟧`; })
    .replace(LONE_SURROGATE, () => { replaced++; return String.fromCharCode(0xfffd); });
  return { text: out, replaced };
}
// A value that goes into a FACT (and so into a summary or a model request) must be an identifier, never free text: anything outside the pattern is replaced.
const SAFE_ID = /[^A-Za-z0-9._:/@+=#\u2026-]/g;                 // (\u2026 is the ellipsis a clipped id ends with, so a second pass keeps it)
const safeId = (value, max = 80) => { const s = String(value ?? '').replace(SAFE_ID, '?'); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };
// A workflow version is an integer in the schema, but a store is a file: anything else is pattern-bound before it can reach a fact (and so a model request).
const versionOf = v => Number.isSafeInteger(v) ? v : safeId(v ?? '?', 16);

// ======================================================================================================== codes and classes
// Mirrors run-view.js / the runtime's own sets (src/runtime.mjs environmentFaults, providerFaults, unhandled).
const ENV_CODES = new Set(['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT', 'SANDBOX_UNAVAILABLE', 'MODEL_PROTOCOL', 'MODEL_BUDGET']);
const BUDGET_CODES = new Set(['COST_BUDGET', 'STEP_BUDGET', 'DEADLINE', 'STATE_BUDGET']);
const INTEGRITY_CODES = new Set(['STALE_RUNNER', 'REPLAY_MISS', 'FRAME_DRIFT', 'CORRUPT_EVENTS', 'MODEL_POLICY_DRIFT', 'ENGINE_DRIFT', 'CAPABILITY_DRIFT']);
function classifyCode(code) {
  if (ENV_CODES.has(code)) return 'environment';
  if (code === 'CANCELLED' || code === 'ABORT_ERR') return 'cancelled';
  if (BUDGET_CODES.has(code)) return 'budget';
  if (INTEGRITY_CODES.has(code)) return 'integrity';
  if (['LABEL_POLICY', 'CAPABILITY_DENIED', 'ASSIGNMENT_INVALID', 'VERIFY_INDEPENDENCE', 'MODEL_PORT_REQUIRED'].includes(code)) return 'policy';
  if (['NODE_CHECK_FAILED', 'VERIFY_FAILED', 'ASSERTION_FAILED', 'ACCEPTANCE_FAILED'].includes(code)) return 'check';
  if (code === 'MODEL_ESCALATION_EXHAUSTED') return 'exhausted';
  return 'other';
}
// Fixed definitions of codes (what the code MEANS, not why it happened here). Free text from the run is never used.
const CODE_NOTES = {
  MODEL_ESCALATION_EXHAUSTED: 'a node check still failed after the permitted escalations',
  NODE_CHECK_FAILED: 'a node check failed on the model output',
  VERIFY_FAILED: 'a verify node judged the work not acceptable',
  ACCEPTANCE_FAILED: 'the workflow acceptance predicates did not hold',
  MODEL_RATE_LIMIT: 'the provider rate-limited or was overloaded (an environment fault)',
  MODEL_UNAVAILABLE: 'the model provider was unreachable (an environment fault)',
  MODEL_TIMEOUT: 'a model call timed out (an environment fault)',
  MODEL_PROTOCOL: 'the provider returned something the runtime could not interpret (an environment fault)',
  MODEL_BUDGET: 'the per-call budget cap was hit (an environment fault)',
  MODEL_SCHEMA: 'the model output did not satisfy its schema',
  MODEL_TRUNCATED: 'generation stopped at the token limit',
  MODEL_REFUSAL: 'the model refused',
  SANDBOX_UNAVAILABLE: 'the code sandbox could not run (an environment fault)',
  COST_BUDGET: 'the run budget for cost was exhausted', STEP_BUDGET: 'the run budget for steps was exhausted', DEADLINE: 'the run deadline passed', STATE_BUDGET: 'the run state grew beyond its limit',
  ENGINE_DRIFT: 'the engine changed since the run was created', REPLAY_MISS: 'a replay found no journaled response', CORRUPT_EVENTS: 'the event record is damaged',
  CANCELLED: 'the run was cancelled', STALE_RUNNER: 'a second runner took over',
  ACCEPTANCE_EXISTENCE_ONLY: 'its acceptance only checks that an answer exists', NO_ORACLE_DECLARED: 'the workflow declares that no oracle exists', ACCEPTANCE_UNASSESSED: 'the acceptance contract was not supplied',
  ERROR_COLLECTED: 'a map collected item failures and no acceptance check read the failed count', ERROR_CONTINUED: 'a node failed into onError continue and nothing gated on its outcome',
  GATE_NOT_RUN: 'none of the gating checks ran', VERIFY_FAILED_NONBLOCKING: 'a verify node recorded a failure and nothing gated on it'
};

const splitOf = (taskKey, overrides = []) => {
  const key = String(taskKey ?? '');
  const hit = overrides.find(o => o && typeof o.taskKey === 'string' && (o.taskKey === key || (o.taskKey.endsWith('*') && key.startsWith(o.taskKey.slice(0, -1)))));
  const split = /:dev:/.test(key) ? 'dev' : /:sealed:/.test(key) ? 'sealed' : /:test:/.test(key) ? 'test' : 'unknown';
  return hit ? { split: hit.split ?? split, inspected: hit.inspected === true, reason: hit.reason ?? null } : { split, inspected: false, reason: null };
};
// Content (prompts, replies, excerpts) of a run may be shown only for development tasks or seeds recorded as already inspected.
const contentPolicy = row => row.split === 'dev' || (row.split === 'test' && row.inspected === true) ? 'open' : row.split === 'sealed' ? 'never' : 'optin';

// ======================================================================================================== honesty
const POSITIVE_VERDICTS = new Set(['pass', 'finding']);
// The runtime's claim (run verdict) against independent evidence (the experiment's oracle). Rates must be read per engine hash: stage-1 changes what `pass` means.
function honestyOf(verdict, oracle) {
  const v = verdict?.verdict ?? null, o = oracle && typeof oracle.pass === 'boolean' ? oracle.pass : null;
  if (!v) return 'no-verdict';
  if (o === null) return 'no-oracle';
  const positive = POSITIVE_VERDICTS.has(v);
  if (positive && !o) return 'mismatch-pass-fail';
  if (!positive && o) return 'mismatch-fail-pass';
  return 'agree';
}
const HONESTY_LABEL = {
  'mismatch-pass-fail': 'MISMATCH: Foundry pass, oracle fail', 'mismatch-fail-pass': 'Mismatch: Foundry not pass, oracle pass', agree: 'Agree',
  'no-oracle': 'No independent verification attached', 'no-verdict': 'No Foundry verdict'
};

// ======================================================================================================== folding
// Events are the hash-chained run events (raw from the store, or the slim form of foundry-run-view/1). Free text (error messages, reasons) is never copied out.
function foldFacts(events, workflow = null) {
  const f = { events: events.length, createdAt: null, startedAt: null, endedAt: null, durationMs: null, status: 'ready', resumes: 0, steps: 0, error: null, workflowHash: null, inputHash: null,
    engineHash: null, modelMode: null, verdict: null, cost: 0, calls: { n: 0, errors: 0, byModel: dict() }, retries: 0, retriesByCode: dict(), resamples: 0, checkFails: 0, escalations: [],
    failed: [], costByTop: dict(), nodes: {} };
  const inst = new Map(), seenCalls = new Map();
  const get = key => { let i = inst.get(key); if (!i) { i = { key, kind: null, attempts: 0, models: new Set(), failed: null, handled: false }; inst.set(key, i); } return i; };
  const topOf = key => { const parts = String(key).split('/'); return parts[0] === 'root' && parts.length > 1 ? parts[1].replace(/:\d+$/, '') : String(key); };
  const collected = new Set();                                   // frame keys ("root/dates:2") whose map item failure was collected
  const bumpCost = (key, usd) => { if (key && usd) bump(f.costByTop, topOf(key), usd); };
  for (const ev of events) {
    f.startedAt ??= ev.at; f.endedAt = ev.at;
    const t = ev.type;
    const opt = v => v == null ? null : safeId(v, 80);
    if (t === 'run.created') { f.createdAt = ev.at; f.workflowHash = opt(ev.workflowHash); f.inputHash = opt(ev.inputHash); f.engineHash = opt(ev.engineHash); f.modelMode = opt(ev.modelMode); continue; }
    if (t === 'run.verdict') { f.verdict = { verdict: opt(ev.verdict), code: opt(ev.code), authority: opt(ev.authority), establishesCompletion: ev.establishesCompletion === true }; continue; }
    if (t.startsWith('run.')) { f.status = t === 'run.stopped' ? (ev.error?.code === 'CANCELLED' ? 'cancelled' : 'failed') : safeId(t.slice(4), 24); if (ev.error) f.error = { code: safeId(ev.error.code ?? 'ERROR') }; continue; }
    if (t === 'runner.acquired') { f.status = 'running'; f.resumes++; continue; }
    if (!ev.nodeKey) continue;
    const i = get(ev.nodeKey);
    switch (t) {
      case 'node.started': case 'tool.intent':
        i.kind = ev.kind ?? i.kind; i.attempts++; f.steps++; f.cost += ev.reservedCost ?? 0; bumpCost(ev.nodeKey, ev.reservedCost ?? 0); break;
      case 'context.compiled': if (ev.modelId) i.models.add(ev.modelId); break;
      case 'model.called': case 'node.recovered_from_journal': {
        const again = ev.journalId != null && seenCalls.get(ev.nodeKey)?.has(ev.journalId);
        if (ev.journalId != null && !again) { if (!seenCalls.has(ev.nodeKey)) seenCalls.set(ev.nodeKey, new Set()); seenCalls.get(ev.nodeKey).add(ev.journalId); }
        const usd = again ? 0 : (ev.costUsd ?? 0);
        f.cost += usd; bumpCost(ev.nodeKey, usd);
        if (!again) {
          f.calls.n++; if (!ev.ok) f.calls.errors++;
          const id = safeId(ev.modelId), m = own(f.calls.byModel, id) ? f.calls.byModel[id] : (f.calls.byModel[id] = { n: 0, usd: 0 }); m.n++; m.usd += usd;
        }
        if (ev.modelId) i.models.add(ev.modelId);
        break;
      }
      case 'model.cancelled': f.cost += ev.costUsd ?? 0; bumpCost(ev.nodeKey, ev.costUsd ?? 0); break;
      case 'oracle.dispatched': f.cost += ev.reservedCost ?? 0; bumpCost(ev.nodeKey, ev.reservedCost ?? 0); break;
      case 'model.retry': f.retries++; bump(f.retriesByCode, safeId(ev.errorCode ?? 'UNKNOWN')); break;
      case 'model.resampled': f.resamples++; f.checkFails++; break;
      case 'model.escalated':
        f.escalations.push({ nodeKey: safeId(ev.nodeKey, 120), from: safeId(ev.fromModel), to: safeId(ev.toModel), rule: safeId(ev.rule ?? ''), code: safeId(ev.errorCode ?? ''), costSoFar: round(ev.costSoFar ?? 0) });
        if (ev.rule === 'E2') f.checkFails++;
        if (ev.toModel) i.models.add(ev.toModel);
        break;
      case 'node.failed': i.failed = { code: safeId(ev.error?.code ?? 'ERROR') }; break;
      case 'node.handled_error': i.handled = true; break;
      case 'map.item.failed': collected.add(`${ev.nodeKey}:${ev.index}`); break;
      default: break;
    }
  }
  f.durationMs = f.startedAt != null ? f.endedAt - f.startedAt : null;
  const wfNode = id => workflow?.nodes?.find(n => n.id === id) ?? null;
  for (const i of inst.values()) {
    if (!i.failed) continue;
    const parts = i.key.split('/');
    let handledBy = 'none';
    for (let n = parts.length - 1; n >= 1; n--) if (/:\d+$/.test(parts[n]) && collected.has(parts.slice(0, n + 1).join('/'))) { handledBy = 'collected'; break; }
    f.failed.push({ nodeKey: safeId(i.key, 120), kind: safeId(i.kind ?? wfNode(topOf(i.key))?.kind ?? 'unknown', 24), code: i.failed.code, class: classifyCode(i.failed.code), attempts: i.attempts, models: [...i.models].map(m => safeId(m)), handledBy });
  }
  f.costTop = Object.entries(f.costByTop).map(([node, usd]) => ({ node: safeId(node, 64), usd: round(usd) })).sort((a, b) => b.usd - a.usd).slice(0, 3);
  delete f.costByTop;
  f.cost = round(f.cost, 9);
  for (const m of Object.values(f.calls.byModel)) m.usd = round(m.usd, 9);
  // Acceptance: only the operators are kept (never values). existenceOnly = every predicate merely checks that a value exists.
  const acc = Array.isArray(workflow?.acceptance) ? workflow.acceptance : null;
  f.acceptance = acc ? { n: acc.length, ops: [...new Set(acc.map(p => safeId(p?.op ?? '?', 24)))], existenceOnly: acc.length > 0 && acc.every(p => p?.op === 'exists') } : null;
  f.nodeCount = Array.isArray(workflow?.nodes) ? workflow.nodes.length : null;
  return f;
}

// ======================================================================================================== numbered facts and the deterministic summary
function factList(row) {
  const F = [];
  const add = (id, text, data = {}) => F.push({ id, text, ...data });
  const wf = row.workflow, cost = row.cost?.usd;
  add('R1', `Run ${safeId(row.key, 40)}: ${safeId(row.fidelity, 16)} record${row.status ? `, status ${safeId(row.status, 24)}` : ''}${Number.isFinite(row.durationMs) ? `, ${fmtDur(row.durationMs)}` : ''}${wf ? `, workflow ${safeId(wf.id)} v${versionOf(wf.version)}` : ''}${row.arm ? `, arm ${safeId(row.arm)}` : ''}${row.taskKey ? `, task ${safeId(row.taskKey)} (${safeId(row.split, 12)}${row.inspected ? ', inspected' : ''})` : ''}.`);
  if (row.verdict) add('V1', `Foundry verdict ${safeId(row.verdict.verdict)}${row.verdict.code ? ` (code ${safeId(row.verdict.code)})` : ''}${row.verdict.authority ? `, authority ${safeId(row.verdict.authority)}` : ''}. A verdict does not establish completion.`, { verdict: row.verdict.verdict, code: row.verdict.code ?? null });
  if (row.oracle) {
    const d = row.oracle.details ?? {}, bits = ['entities', 'predicted', 'extra', 'missing', 'pairF1', 'fieldAccuracy'].filter(k => Number.isFinite(d[k])).map(k => `${k} ${fmtScore(d[k])}`);
    add('O1', `Independent oracle ${row.oracle.pass ? 'PASS' : 'FAIL'}${Number.isFinite(row.oracle.score) ? `, score ${fmtScore(row.oracle.score)}` : ''}${bits.length ? ` (${bits.join(', ')})` : ''}.`);
  }
  if (row.acceptance) add('A1', row.acceptance.n === 0 ? 'The workflow declares no acceptance predicate.' : `Acceptance has ${row.acceptance.n} predicate${row.acceptance.n === 1 ? '' : 's'} (${row.acceptance.ops.join(', ')})${row.acceptance.existenceOnly ? ': every one only checks that a value exists' : ''}.`, { existenceOnly: row.acceptance.existenceOnly, n: row.acceptance.n });
  const calls = callUnit(row), shown = (row.failed ?? []).slice(0, 5);
  shown.forEach((n, k) => add(`N${k + 1}`, calls
    ? `Failed model call${(n.count ?? 1) === 1 ? '' : 's'} at ${safeId(n.nodeKey, 120)}, code ${safeId(n.code)}${(n.count ?? 1) > 1 ? `, ${n.count} times` : ''} (from the model journal: whether the node then failed is not recorded).`
    : `Failed node ${safeId(n.nodeKey, 120)} (${safeId(n.kind, 24)}), code ${safeId(n.code)}${n.handledBy === 'collected' ? ', collected by its map' : ''}${n.models?.length ? `, models tried ${n.models.map(m => shortModel(safeId(m))).join(', ')}` : ''}.`, { code: n.code }));
  const rest = (row.failedCount ?? 0) - listedCount(shown);
  if (rest > 0) add('N+', `${rest} more failed ${calls ? 'model calls' : 'node instances'}.`);
  (row.escalationList ?? []).slice(0, 5).forEach((e, k) => add(`E${k + 1}`, `Escalation at ${e.nodeKey}: ${shortModel(e.from)} to ${shortModel(e.to)}${e.rule ? `, rule ${e.rule}` : ''}${e.code ? `, ${e.code}` : ''}.`));
  if (row.escalations > (row.escalationList ?? []).length && (row.escalationList ?? []).length) add('E+', `${row.escalations - row.escalationList.length} more escalations.`);
  if (row.retries || row.checkFails) add('T1', `${row.retries ?? 0} model retr${row.retries === 1 ? 'y' : 'ies'}, ${row.checkFails ?? 0} check failure${row.checkFails === 1 ? '' : 's'}.`);
  if (Number.isFinite(cost)) add('C1', `Cost ${fmtCost(cost)} (${row.cost.source})${row.cost.unknownCalls ? `, ${row.cost.unknownCalls} call(s) of unknown cost` : ''}${row.costTop?.length ? `; top nodes ${row.costTop.map(c => `${c.node} ${fmtCost(c.usd)}`).join(', ')}` : ''}.`);
  if (row.integrity?.chain === 'broken') add('I1', 'The event chain does not verify: this record may be damaged or edited.');
  return F;
}
// A journal-only row knows failed model CALLS, not failed nodes: a call that failed and was retried leaves an error row in the journal of a run that passed.
const callUnit = row => row?.failedUnit === 'call';
const listedCount = list => sum(list ?? [], n => n.count ?? 1);
// Call errors do not show that the run failed when the run finished positively (a positive verdict, status succeeded or an oracle pass).
const callErrorsTolerated = row => callUnit(row) && (POSITIVE_VERDICTS.has(row.verdict?.verdict) || row.status === 'succeeded' || row.oracle?.pass === true);
const cites = (F, ...ids) => ids.flatMap(id => id.endsWith('*') ? F.filter(f => f.id.startsWith(id.slice(0, -1)) && f.id !== 'N+' && f.id !== 'E+').map(f => f.id) : F.some(f => f.id === id) ? [id] : []);

function classify(row, F) {
  const tolerated = callErrorsTolerated(row), failed = tolerated ? [] : (row.failed ?? []), codes = failed.map(n => n.code);
  const positive = POSITIVE_VERDICTS.has(row.verdict?.verdict);
  if (row.verdict?.verdict === 'env_fault' || failed.some(n => n.class === 'environment') || (row.error?.code && classifyCode(row.error.code) === 'environment'))
    return { class: 'env_fault', text: 'The record shows an environment or provider fault, not a model or workflow defect. It was not escalated to a larger model.', c: cites(F, 'V1', 'N*') };
  if (row.verdict?.verdict === 'harness_fault') return { class: 'harness_fault', text: 'The runtime marked this a harness fault: the result cannot be interpreted as a workflow outcome.', c: cites(F, 'V1') };
  if (row.integrity?.chain === 'broken' || failed.some(n => n.class === 'integrity')) return { class: 'integrity', text: 'An integrity or drift code is recorded, or the event chain is broken. Do not rely on this record until it is checked.', c: cites(F, 'I1', 'N*') };
  if (failed.some(n => n.class === 'budget') || (row.error?.code && classifyCode(row.error.code) === 'budget')) return { class: 'budget', text: 'A budget limit ended the run (cost, steps, deadline or state size).', c: cites(F, 'N*') };
  if (positive && row.oracle?.pass === false) {
    const weak = row.acceptance?.existenceOnly || row.acceptance?.n === 0 || row.verdict?.code === 'ACCEPTANCE_EXISTENCE_ONLY';
    if (weak) return { class: 'weak_acceptance', text: `${row.acceptance?.n === 0 ? 'The workflow declares no acceptance predicate' : 'The only acceptance predicate checks that a value exists'}, so neither a collected failure nor a wrong answer could stop a pass.${failed.length ? ' Whether the failed item caused the oracle failure is not recorded.' : ''}`, c: cites(F, 'A1', 'V1', 'O1', 'N*') };
    return { class: 'unknown', text: `Foundry passed but the oracle failed. ${row.acceptance ? 'Its acceptance has predicates beyond existence' : 'The workflow version (and so its acceptance) is not recorded for this run'}; the records do not show why the answer was wrong.${failed.length ? ' Whether the failed item caused it is not recorded.' : ''}`, c: cites(F, 'V1', 'O1', 'A1', 'N*') };
  }
  // The current engine already refuses to call such a run `pass`: it says `unverified` with a code that names what could not fail.
  if (row.verdict?.verdict === 'unverified' && UNVERIFIED_WEAK.has(row.verdict.code)) {
    const failedOracle = row.oracle?.pass === false;
    return { class: 'weak_acceptance', text: `Foundry marked this run unverified (${row.verdict.code}): ${own(CODE_NOTES, row.verdict.code) ? CODE_NOTES[row.verdict.code] : 'nothing that a wrong answer can fail gated it'}. It did not claim success${failedOracle ? ', and the independent oracle failed it' : ''}.${failed.length ? ' Whether a failed item caused the oracle result is not recorded.' : ''}`, c: cites(F, 'V1', 'A1', 'O1', 'N*') };
  }
  if (positive && failed.length === 0 && row.oracle?.pass !== false) {
    const nCalls = Math.max(row.failedCount ?? 0, listedCount(row.failed));
    const retried = tolerated && row.failed?.length ? ` ${nCalls} model call${nCalls === 1 ? '' : 's'} failed on the way and the run still finished (retried or tolerated); the journal does not record node outcomes.` : '';
    return { class: 'none', text: `${row.oracle?.pass === true ? 'No failure is recorded; the oracle agrees.' : 'No failure is recorded. No independent oracle result is attached, so completion is not established.'}${retried}`, c: cites(F, 'V1', 'O1', ...(retried ? ['N*'] : [])) };
  }
  if (!row.verdict && row.fidelity === 'result-only') return { class: 'unknown', text: row.oracle?.pass === false ? 'Only an oracle result is recorded for this trial (a baseline arm, or its workspace was deleted); the cause is not in the records.' : 'Only an oracle result is recorded for this trial.', c: cites(F, 'O1') };
  return { class: 'unknown', text: failed.length ? `Failure codes are recorded (${[...new Set(codes)].join(', ')}), but the records do not show the cause: a reader has to open the messages.` : 'The records do not show a cause.', c: cites(F, 'V1', 'O1', 'N*') };
}
const UNVERIFIED_WEAK = new Set(['ACCEPTANCE_EXISTENCE_ONLY', 'NO_ORACLE_DECLARED', 'ACCEPTANCE_UNASSESSED', 'ERROR_COLLECTED', 'ERROR_CONTINUED', 'GATE_NOT_RUN', 'VERIFY_FAILED_NONBLOCKING']);
const FIXES = {
  env_fault: 'Rerun it; this was the provider or environment, not a defect to fix in the workflow.',
  harness_fault: 'Check the harness that produced this run (verdict harness_fault); do not read the result as a workflow outcome.',
  integrity: 'Do not trust this record; rerun from a fresh workspace and investigate the drift or chain code.',
  budget: 'Raise the budget or cut the fan-out of the node that exhausted it.',
  weak_acceptance: 'Add an acceptance predicate that a well-formed but wrong answer can fail, for example one that fails when a map collected failures or when the answer is larger than the input allows.'
};

function summarise(row) {
  const F = factList(row), by = Object.fromEntries(F.map(f => [f.id, f]));
  const cause = classify(row, F);
  const verdictText = row.verdict ? `Foundry ${safeId(row.verdict.verdict, 24).toUpperCase()}` : row.fidelity === 'result-only' ? 'no Foundry run recorded' : 'no Foundry verdict recorded';
  const oracleText = row.oracle ? `oracle ${row.oracle.pass ? 'PASS' : 'FAIL'}${Number.isFinite(row.oracle.score) ? ` ${fmtScore(row.oracle.score)}` : ''}` : 'oracle not attached';
  const models = Object.entries(row.calls?.byModel ?? {}).sort((a, b) => b[1].n - a[1].n).map(([m, v]) => `${v.n} ${shortModel(m)}`).join(', ');
  const who = row.workflow ? `${safeId(row.workflow.id)} v${versionOf(row.workflow.version)}` : safeId(row.arm ?? row.key, 60);
  const task = row.taskKey ? ` on ${safeId(row.taskKey)} (${row.split})` : '';
  const firstFail = row.failed?.[0];
  const parts = [`${who}${task}: ${verdictText}; ${oracleText}${row.honesty === 'mismatch-pass-fail' ? '; MISMATCH' : row.honesty === 'mismatch-fail-pass' ? '; mismatch (oracle passed)' : ''}.`];
  const nums = [Number.isFinite(row.durationMs) ? fmtDur(row.durationMs) : null, Number.isFinite(row.cost?.usd) ? fmtCost(row.cost.usd) : null, row.calls?.n ? `${row.calls.n} call${row.calls.n === 1 ? '' : 's'}${models ? ` (${models})` : ''}` : null,
    row.escalations ? `${row.escalations} escalation${row.escalations === 1 ? '' : 's'}${row.escalationsInferred ? ' (inferred from a model change)' : ''}` : null,
    row.failedCount ? `${row.failedCount} failed${callUnit(row) ? ` model call${row.failedCount === 1 ? '' : 's'}` : ''}${firstFail ? `: ${String(firstFail.nodeKey).replace(/^root\//, '')}` : ''}` : null].filter(Boolean);
  if (nums.length) parts.push(`${nums.join(', ')}.`);
  const one_line = parts.join(' ');
  const cited = cites(F, 'R1', 'V1', 'O1', 'C1', 'E1', 'N1');

  const what_failed = [];
  const groups = new Map();
  const calls = callUnit(row), tolerated = callErrorsTolerated(row);
  (row.failed ?? []).forEach((n, k) => { const g = groups.get(n.code) ?? { code: n.code, nodes: [], ids: [] }; g.nodes.push(n); g.ids.push(`N${k + 1}`); groups.set(n.code, g); });
  for (const g of groups.values()) {
    const note = own(CODE_NOTES, g.code) ? CODE_NOTES[g.code] : null, handled = g.nodes.filter(n => n.handledBy === 'collected').length, count = listedCount(g.nodes), where = g.nodes.slice(0, 3).map(n => String(n.nodeKey).replace(/^root\//, '')).join(', ');
    const more = g.nodes.length > 3 ? ` and ${g.nodes.length - 3} more` : '';
    what_failed.push({ text: calls
      ? `${count} failed model call${count === 1 ? '' : 's'} with ${g.code}${note ? ` (${note})` : ''} at ${where}${more}${tolerated ? '; the run still finished, so they were retried or tolerated' : ''}.`
      : `${g.nodes.length} failed instance${g.nodes.length === 1 ? '' : 's'} with ${g.code}${note ? ` (${note})` : ''}: ${where}${more}${handled ? `; ${handled === g.nodes.length ? 'all' : handled} collected by a map` : ''}.`, cites: g.ids.filter(id => by[id]) });
  }
  const unlisted = (row.failedCount ?? 0) - listedCount(row.failed);
  if (unlisted > 0) what_failed.push({ text: `${unlisted} more failed ${calls ? 'model calls are' : 'instances are'} not listed.`, cites: [] });
  if (row.honesty === 'mismatch-pass-fail') what_failed.unshift({ text: `Foundry reported ${row.verdict.verdict.toUpperCase()} but the independent oracle FAILED this run${Number.isFinite(row.oracle?.score) ? ` (score ${fmtScore(row.oracle.score)})` : ''}. Foundry's verdict does not establish completion.`, cites: cites(F, 'V1', 'O1') });
  else if (row.oracle && row.oracle.pass === false) what_failed.push({ text: `The independent oracle FAILED this ${row.verdict ? 'run' : 'trial'}${Number.isFinite(row.oracle.score) ? ` (score ${fmtScore(row.oracle.score)})` : ''}.`, cites: cites(F, 'O1') });
  if (row.escalations && !row.failedCount) what_failed.push({ text: `${row.escalations} escalation${row.escalations === 1 ? '' : 's'} to a larger model; none ended in a failure.`, cites: cites(F, 'E*') });
  if (!what_failed.length) what_failed.push({ text: row.integrity?.chain === 'broken' ? 'The event chain does not verify.' : 'Nothing failed in the recorded fields.', cites: cites(F, 'I1') });

  const suggested_fix = FIXES[cause.class] ? { kind: cause.class === 'weak_acceptance' ? 'acceptance' : cause.class === 'env_fault' ? 'rerun' : cause.class === 'budget' ? 'budget' : cause.class, text: FIXES[cause.class], cites: cause.c } : null;
  return { one_line, what_failed: what_failed.slice(0, 6), likely_cause: { class: cause.class, text: cause.text, cites: cause.c }, suggested_fix, facts: F, cites: cited };
}

// ======================================================================================================== lanes (timeline)
// doc is a foundry-run-view/1 export (events in time order, with derived model.dispatched), a journal-reconstructed doc (synthetic model.called events),
// or a live feed. Everything here comes from typed event fields; no free text is read.
function buildLanes(doc, { maxItems = 50 } = {}) {
  const events = (doc.events ?? []).filter(e => e && typeof e.at === 'number');
  const wf = doc.workflow ?? null, order = wf?.nodes?.map(n => n.id) ?? [];
  const out = { t0: null, t1: null, durationMs: 0, lanes: [], critical: [], criticalMs: 0, notes: [], concurrency: doc.run?.budget?.maxConcurrency ?? null, inferred: doc.fidelity === 'journal-only' };
  if (!events.length) return out;
  out.t0 = events[0].at; out.t1 = events.at(-1).at; out.durationMs = out.t1 - out.t0;
  const topOf = key => { const parts = String(key).split('/'); return parts[0] === 'root' && parts.length > 1 ? parts[1].replace(/:\d+$/, '') : String(key); };
  const lanesById = new Map();
  const lane = id => {
    let l = lanesById.get(id);
    if (!l) { const def = wf?.nodes?.find(n => n.id === id) ?? null; l = { id, kind: def?.kind ?? null, needs: def?.needs ?? [], start: null, end: null, state: 'running', calls: [], marks: [], items: new Map(), instCount: 0, cost: 0, retries: 0, escalations: 0, checkFails: 0, failedItems: 0, failed: null, completed: false, skipped: false, order: order.indexOf(id) }; lanesById.set(id, l); }
    return l;
  };
  const dispatched = new Map();                            // journalId -> dispatch time (derived events)
  const itemOf = key => { const m = /^root\/([^/:]+):(\d+)(?:\/|$)/.exec(key); return m ? { top: m[1], idx: Number(m[2]) } : null; };
  const item = (l, idx) => { let it = l.items.get(idx); if (!it) { it = { idx, start: null, end: null, state: 'running', calls: 0, escalations: 0, retries: 0, failed: false, leaves: new Set(), callList: [] }; l.items.set(idx, it); } return it; };
  const touch = (o, at) => { o.start = o.start == null ? at : Math.min(o.start, at); o.end = o.end == null ? at : Math.max(o.end, at); };
  for (const ev of events) {
    const t = ev.type;
    if (t.startsWith('run.') || t === 'runner.acquired') continue;
    if (t === 'frame.created' && ev.frameKey) {
      const it = itemOf(ev.frameKey); if (it) { const l = lane(it.top); touch(l, ev.at); touch(item(l, it.idx), ev.at); }
      continue;
    }
    if (!ev.nodeKey) continue;
    const l = lane(topOf(ev.nodeKey)), it = itemOf(ev.nodeKey);
    touch(l, ev.at);
    const item_ = it && it.top === l.id ? item(l, it.idx) : null;
    if (item_) { touch(item_, ev.at); item_.leaves.add(ev.nodeKey.split('/').slice(2).join('/')); }
    const own = ev.nodeKey === `root/${l.id}`;
    switch (t) {
      case 'node.started': if (own) { l.kind ??= ev.kind ?? null; l.startedAt ??= ev.at; } l.instCount++; break;
      case 'model.dispatched': if (ev.journalId != null) dispatched.set(ev.journalId, ev.at); break;
      case 'model.called': case 'node.recovered_from_journal': {
        const start = Math.max(out.t0, dispatched.get(ev.journalId) ?? (ev.at - (ev.latencyMs ?? 0)));
        const call = { start, end: ev.at, model: ev.modelId, ok: ev.ok !== false, code: ev.errorCode ?? null, journalId: ev.journalId ?? null, nodeKey: ev.nodeKey, attempt: ev.attempt ?? 0, cost: ev.costUsd ?? 0, latencyMs: ev.latencyMs ?? null };
        l.calls.push(call); l.cost += call.cost; if (item_) { item_.calls++; item_.callList.push(call); }
        break;
      }
      case 'model.retry': l.retries++; l.marks.push({ kind: 'retry', at: ev.at, nodeKey: ev.nodeKey, label: `retry ${ev.retry ?? ''} ${ev.errorCode ?? ''}`.trim() }); if (item_) item_.retries++; break;
      case 'model.resampled': l.checkFails++; l.marks.push({ kind: 'resample', at: ev.at, nodeKey: ev.nodeKey, label: 'check failed, resampled' }); break;
      case 'model.escalated':
        l.escalations++; l.checkFails += ev.rule === 'E2' ? 1 : 0; if (item_) item_.escalations++;
        l.marks.push({ kind: 'escalation', at: ev.at, nodeKey: ev.nodeKey, label: `${shortModel(ev.fromModel)} → ${shortModel(ev.toModel)}${ev.inferred ? ' (inferred)' : ''}`, rule: ev.rule ?? null });
        break;
      case 'node.failed':
        if (own) { l.failed = ev.error?.code ?? 'ERROR'; l.end = Math.max(l.end ?? ev.at, ev.at); }
        l.marks.push({ kind: classifyCode(ev.error?.code) === 'environment' ? 'envfault' : 'failure', at: ev.at, nodeKey: ev.nodeKey, label: ev.error?.code ?? 'ERROR' }); if (item_) item_.failed = true;
        break;
      case 'map.item.failed': { const target = lane(topOf(ev.nodeKey)); const i2 = item(target, ev.index); i2.failed = true; i2.state = 'failed'; touch(i2, ev.at); target.failedItems++; break; }
      case 'map.item.completed': { const target = lane(topOf(ev.nodeKey)); const i2 = item(target, ev.index); if (i2.state !== 'failed') i2.state = 'done'; touch(i2, ev.at); break; }
      case 'node.completed': if (own) { l.completed = true; l.failedItemsReported = ev.failedItems ?? 0; l.endedAt = ev.at; } break;
      case 'node.skipped': if (own) l.skipped = true; break;
      case 'node.handled_error': if (own) l.handled = true; break;
      default: break;
    }
  }
  const runDone = ['succeeded', 'failed', 'cancelled', 'stopped'].includes(doc.run?.status);
  for (const l of lanesById.values()) {
    l.state = l.failed ? (classifyCode(l.failed) === 'environment' ? 'envfault' : 'failed') : l.skipped ? 'skipped' : l.handled ? 'handled' : l.completed ? ((l.failedItems || l.failedItemsReported) > 0 ? 'handled' : 'done') : runDone ? 'cancelled' : (l.calls.length || l.start != null ? 'running' : 'idle');
    if (l.kind === 'map' || l.kind === 'loop' || l.items.size) {
      l.container = true; l.kind ??= 'map';
      const its = [...l.items.values()].sort((a, b) => a.idx - b.idx);
      for (const x of its) { if (x.state === 'running' && l.completed) x.state = 'done'; x.leaves = x.leaves.size; }
      l.itemCount = its.length; l.items = its;
      // Density: number of items active over time (a step function), from item spans.
      const steps = [];
      for (const x of its) if (x.start != null) { steps.push([x.start, 1]); steps.push([Math.max(x.end ?? x.start, x.start), -1]); }
      steps.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let n = 0; l.density = []; l.maxActive = 0;
      for (const [t, d] of steps) { n += d; l.maxActive = Math.max(l.maxActive, n); const last = l.density.at(-1); if (last && last[0] === t) last[1] = n; else l.density.push([t, n]); }
      l.pageItems = its.length > maxItems ? its.slice(0, maxItems) : its;
    } else { l.container = false; l.items = []; l.itemCount = 0; }
    l.callCount = l.calls.length;
    l.cost = round(l.cost, 9);
  }
  const lanes = [...lanesById.values()].sort((a, b) => (a.order < 0 ? 1e9 : a.order) - (b.order < 0 ? 1e9 : b.order) || (a.start ?? 0) - (b.start ?? 0));
  out.lanes = lanes;
  // Critical path: from the lane that ends last, walk back through `needs` to the predecessor that ended last.
  if (wf) {
    const byId = new Map(lanes.map(l => [l.id, l]));
    // The whole path is walked (a Set guards against a cycle in a damaged record); the page abbreviates a long one, it is never cut short silently.
    let cur = lanes.filter(l => l.end != null).sort((a, b) => b.end - a.end)[0]; const path = [], onPath = new Set();
    while (cur && !onPath.has(cur.id)) { onPath.add(cur.id); path.push(cur.id); cur = (cur.needs ?? []).map(id => byId.get(id)).filter(x => x?.end != null).sort((a, b) => b.end - a.end)[0]; }
    out.critical = path.reverse();
    out.criticalMs = sum(out.critical.map(id => byId.get(id)), l => (l.end ?? 0) - (l.start ?? 0));
  }
  if (doc.fidelity === 'journal-only') out.notes.push('Reconstructed from the model journal: code nodes, waits and node states are not recorded for this run.');
  if (lanes.some(l => l.container && l.itemCount > maxItems)) out.notes.push(`A map lane with more than ${maxItems} items shows its first ${maxItems} items when opened.`);
  return out;
}

// ======================================================================================================== compare
const hash32 = text => { let h = 0x811c9dc5; const s = String(text); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
function workflowDiff(a, b) {
  if (!a || !b) return null;
  const ma = new Map((a.nodes ?? []).map(n => [n.id, n])), mb = new Map((b.nodes ?? []).map(n => [n.id, n]));
  const added = [...mb.keys()].filter(k => !ma.has(k)), removed = [...ma.keys()].filter(k => !mb.has(k)), changed = [];
  for (const [id, na] of ma) {
    const nb = mb.get(id); if (!nb) continue;
    const diffs = [];
    if (na.kind !== nb.kind) diffs.push('kind');
    if (JSON.stringify(na.needs ?? []) !== JSON.stringify(nb.needs ?? [])) diffs.push('needs');
    if ((na.model?.class ?? null) !== (nb.model?.class ?? null)) diffs.push('model class');
    if ((na.checks?.length ?? 0) !== (nb.checks?.length ?? 0)) diffs.push('check count');
    if (hash32(JSON.stringify([na.instruction, na.prompt, na.system, na.template, na.code, na.body])) !== hash32(JSON.stringify([nb.instruction, nb.prompt, nb.system, nb.template, nb.code, nb.body]))) diffs.push('instruction or body');
    if (diffs.length) changed.push({ id, diffs });
  }
  return { added, removed, changed, acceptanceChanged: JSON.stringify(a.acceptance ?? null) !== JSON.stringify(b.acceptance ?? null) };
}
function compareDocs(A, B) {
  const out = { header: [], nodes: [], divergence: null, versions: null, notes: [] };
  const ra = A.row, rb = B.row;
  const line = (field, a, b, delta = null, fmt = d => `${d > 0 ? '+' : ''}${round(d, 4)}`) => out.header.push({ field, a: a ?? '–', b: b ?? '–', changed: String(a ?? '–') !== String(b ?? '–'), delta, deltaText: delta != null && delta !== 0 ? fmt(delta) : null });
  const num = (x, y) => Number.isFinite(x) && Number.isFinite(y) ? y - x : null;
  const signed = (d, text) => `${d > 0 ? '+' : '-'}${text(Math.abs(d))}`;
  line('Workflow', ra.workflow ? `${ra.workflow.id} v${ra.workflow.version}` : ra.arm, rb.workflow ? `${rb.workflow.id} v${rb.workflow.version}` : rb.arm);
  line('Workflow hash', ra.workflow?.hash?.slice(0, 12), rb.workflow?.hash?.slice(0, 12));
  line('Task', ra.taskKey, rb.taskKey);
  line('Engine hash', ra.engineHash?.slice(0, 12), rb.engineHash?.slice(0, 12));
  line('Status', ra.status, rb.status);
  line('Foundry verdict', ra.verdict?.verdict, rb.verdict?.verdict);
  line('Oracle', ra.oracle ? `${ra.oracle.pass ? 'PASS' : 'FAIL'} ${fmtScore(ra.oracle.score)}` : null, rb.oracle ? `${rb.oracle.pass ? 'PASS' : 'FAIL'} ${fmtScore(rb.oracle.score)}` : null, num(ra.oracle?.score, rb.oracle?.score), d => `${d > 0 ? '+' : ''}${fmtScore(d)}`);
  line('Verdict vs oracle', HONESTY_LABEL[ra.honesty], HONESTY_LABEL[rb.honesty]);
  line('Duration', Number.isFinite(ra.durationMs) ? fmtDur(ra.durationMs) : null, Number.isFinite(rb.durationMs) ? fmtDur(rb.durationMs) : null, num(ra.durationMs, rb.durationMs), d => signed(d, fmtDur));
  line('Cost', Number.isFinite(ra.cost?.usd) ? fmtCost(ra.cost.usd) : null, Number.isFinite(rb.cost?.usd) ? fmtCost(rb.cost.usd) : null, num(ra.cost?.usd, rb.cost?.usd), d => signed(d, fmtCost));
  line('Model calls', ra.calls?.n, rb.calls?.n, num(ra.calls?.n, rb.calls?.n));
  line('Escalations', ra.escalations, rb.escalations, num(ra.escalations, rb.escalations));
  line(callUnit(ra) || callUnit(rb) ? 'Failures (node instances; failed model calls for a journal-only run)' : 'Failed node instances', ra.failedCount, rb.failedCount, num(ra.failedCount, rb.failedCount));
  line('Fidelity', ra.fidelity, rb.fidelity);
  const sameWf = ra.workflow?.hash && ra.workflow.hash === rb.workflow?.hash;
  const sameInput = A.inputHash && A.inputHash === B.inputHash;
  out.sameWorkflow = !!sameWf; out.sameInput = !!sameInput;
  const na = A.doc?.workflow ?? null, nb = B.doc?.workflow ?? null;
  if (!A.doc || !B.doc) out.notes.push(`${!A.doc && !B.doc ? 'Neither run has' : !A.doc ? 'Run A has' : 'Run B has'} no embedded event record (${!A.doc ? ra.fidelity : rb.fidelity}); only the header fields are compared.`);
  else {
    if (!sameWf && ra.workflow?.hash && rb.workflow?.hash) { out.versions = workflowDiff(na, nb); out.notes.push('Different workflow versions: the node table is aligned by node id and the structural difference is listed below.'); }
    const la = buildLanes(A.doc), lb = buildLanes(B.doc);
    const ia = new Map(la.lanes.map(l => [l.id, l])), ib = new Map(lb.lanes.map(l => [l.id, l]));
    const ids = [...new Set([...la.lanes.map(l => l.id), ...lb.lanes.map(l => l.id)])];
    const side = l => l ? { state: l.state, durationMs: l.end != null && l.start != null ? l.end - l.start : null, cost: l.cost, calls: l.callCount, models: [...new Set(l.calls.map(c => shortModel(c.model)))].join(', '), escalations: l.escalations, retries: l.retries, items: l.container ? l.itemCount : null, failedItems: l.failedItems } : null;
    out.nodes = ids.map(id => ({ id, a: side(ia.get(id)), b: side(ib.get(id)) }));
    out.timelines = { a: la, b: lb };
    if (sameWf && sameInput) {
      // First divergence: the first node instance in recorded order whose chain-bound output hash differs.
      const hashes = doc => { const m = new Map(); for (const e of doc.events) if (e.type === 'node.completed' && e.outputHash) m.set(e.nodeKey, e.outputHash); return m; };
      const ha = hashes(A.doc), hb = hashes(B.doc);
      const order = new Map((na?.nodes ?? []).map((n, k) => [n.id, k]));
      const keys = [...new Set([...ha.keys(), ...hb.keys()])].sort((x, y) => (order.get(x.split('/')[1]?.replace(/:\d+$/, '')) ?? 0) - (order.get(y.split('/')[1]?.replace(/:\d+$/, '')) ?? 0) || x.length - y.length || (x < y ? -1 : 1));
      const first = keys.find(k => ha.has(k) && hb.has(k) && ha.get(k) !== hb.get(k)) ?? keys.find(k => ha.has(k) !== hb.has(k)) ?? null;
      out.divergence = first ? { nodeKey: first, text: `Outputs first differ at ${first.replace(/^root\//, '')}.` } : { nodeKey: null, text: 'Every node output that both runs recorded has the same hash.' };
    } else out.divergence = { nodeKey: null, text: sameWf ? 'Different inputs: aligned by node only, no divergence claim.' : 'Different workflow versions or unknown input: aligned by node only, no divergence claim.' };
  }
  return out;
}

// ======================================================================================================== list: filter, sort, aggregate
function filterRows(rows, f = {}) {
  const q = f.q ? String(f.q).toLowerCase() : null;
  return rows.filter(r => {
    if (f.kind && f.kind !== 'all' && r.kind !== f.kind) return false;
    if (f.fidelity && f.fidelity !== 'all' && r.fidelity !== f.fidelity) return false;
    if (f.experiment && f.experiment !== 'all' && r.experiment !== f.experiment) return false;
    if (f.arm && f.arm !== 'all' && r.arm !== f.arm) return false;
    if (f.workflow && f.workflow !== 'all' && r.workflow?.id !== f.workflow) return false;
    if (f.split && f.split !== 'all' && r.split !== f.split) return false;
    if (f.verdict && f.verdict !== 'all' && (r.verdict?.verdict ?? 'none') !== f.verdict) return false;
    if (f.oracle && f.oracle !== 'all' && (r.oracle ? (r.oracle.pass ? 'pass' : 'fail') : 'none') !== f.oracle) return false;
    if (f.honesty && f.honesty !== 'all' && (f.honesty === 'mismatch' ? !r.honesty.startsWith('mismatch') : r.honesty !== f.honesty)) return false;
    if (f.model && f.model !== 'all' && !own(r.calls?.byModel, f.model)) return false;
    if (f.label && f.label !== 'all' && !(r.labels ?? []).includes(f.label)) return false;
    if (f.status && f.status !== 'all' && r.status !== f.status) return false;
    if (f.from != null && !(r.startedAt >= f.from)) return false;
    if (f.to != null && !(r.startedAt <= f.to)) return false;
    if (q && !`${r.key} ${r.taskKey ?? ''} ${r.arm ?? ''} ${r.experiment ?? ''} ${r.workflow?.id ?? ''} ${r.workflow?.title ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
const SORTERS = {
  started: r => r.startedAt, cost: r => r.cost?.usd, duration: r => r.durationMs, calls: r => r.calls?.n, escalations: r => r.escalations, failed: r => r.failedCount, score: r => r.oracle?.score,
  mismatch: r => r.honesty === 'mismatch-pass-fail' ? 2 : r.honesty === 'mismatch-fail-pass' ? 1 : 0
};
function sortRows(rows, key = 'started', dir = -1) {
  const get = own(SORTERS, key) ? SORTERS[key] : SORTERS.started;               // a sort key from the URL is data: "__proto__" sorts by start time
  return rows.map((r, i) => [r, i]).sort((x, y) => {
    const a = get(x[0]), b = get(y[0]), an = a == null || Number.isNaN(a), bn = b == null || Number.isNaN(b);
    if (an !== bn) return an ? 1 : -1;                                // rows without the value always sort last
    return (an ? 0 : (a - b) * dir) || x[1] - y[1];
  }).map(x => x[0]);
}
// The totals line is honest by construction: it always says how many rows have no oracle, how many are full records, and that kept workspaces skew to failures.
function aggregate(rows) {
  const n = rows.length, withOracle = rows.filter(r => r.oracle), oraclePass = withOracle.filter(r => r.oracle.pass).length;
  const withVerdict = rows.filter(r => r.verdict), foundryPass = withVerdict.filter(r => POSITIVE_VERDICTS.has(r.verdict.verdict)).length;
  const mismatches = rows.filter(r => r.honesty === 'mismatch-pass-fail').length, reverse = rows.filter(r => r.honesty === 'mismatch-fail-pass').length;
  const costKnown = rows.filter(r => Number.isFinite(r.cost?.usd)), totalCost = sum(costKnown, r => r.cost.usd);
  const costOnOracle = sum(withOracle.filter(r => Number.isFinite(r.cost?.usd)), r => r.cost.usd);
  const full = rows.filter(r => r.fidelity === 'full').length;
  return { n, withOracle: withOracle.length, noOracle: n - withOracle.length, oraclePass, withVerdict: withVerdict.length, foundryPass, mismatches, reverse, totalCost, costRows: costKnown.length,
    costPerVerifiedSuccess: oraclePass ? costOnOracle / oraclePass : null, medianDurationMs: median(rows.map(r => r.durationMs)), full, journalOnly: rows.filter(r => r.fidelity === 'journal-only').length,
    resultOnly: rows.filter(r => r.fidelity === 'result-only').length, survivorBias: n > 0 && full / n < 0.5 };
}
// Tasks x arms (from result lines, so baseline arms with no Foundry run are covered). Cell = the trials of that arm on that task.
function taskMatrix(rows) {
  const arms = new Set(), tasks = new Map();
  for (const r of rows) {
    if (!r.taskKey || !r.arm || !r.oracle) continue;
    const task = tasks.get(r.taskKey) ?? { taskKey: r.taskKey, split: r.split, inspected: r.inspected, cells: new Map() };
    const c = task.cells.get(r.arm) ?? { trials: 0, pass: 0, mismatch: 0, cost: 0, keys: [], experiments: new Set(), files: new Set() };
    c.trials++; if (r.oracle.pass) c.pass++; if (r.honesty === 'mismatch-pass-fail') c.mismatch++; c.cost += r.cost?.usd ?? 0; c.keys.push(r.key);
    // a cell can pool trials from several experiments or several result files (two workspaces that reused one experiment name): the page says so
    c.experiments.add(r.experiment ?? '(none)'); const file = (r.sources ?? []).find(x => x.kind === 'results')?.label; if (file) c.files.add(file);
    task.cells.set(r.arm, c); tasks.set(r.taskKey, task); arms.add(r.arm);
  }
  return { arms: [...arms].sort(), tasks: [...tasks.values()].sort((a, b) => (a.taskKey < b.taskKey ? -1 : 1)) };
}
const labelsFor = row => {
  const L = [];
  if (row.honesty === 'mismatch-pass-fail') L.push('mismatch');
  if (row.verdict?.verdict === 'env_fault') L.push('env-fault');
  if (row.escalations > 0) L.push('escalated');
  if (row.failedCount > 0 && row.status === 'succeeded' && !callUnit(row)) L.push('collected-failures');
  if (row.integrity?.chain === 'broken') L.push('chain-broken');
  return L;
};

root.HistoryCore = { SCHEMA_INDEX: 'foundry-run-index/1', dict, own, versionOf, callUnit, callErrorsTolerated, listedCount, shortModel, clip, fmtCost, fmtDur, fmtUtc, fmtScore, round, median, sanitizeDisplay, safeId, classifyCode, CODE_NOTES, ENV_CODES, BUDGET_CODES, INTEGRITY_CODES,
  splitOf, contentPolicy, honestyOf, HONESTY_LABEL, POSITIVE_VERDICTS, foldFacts, factList, summarise, buildLanes, compareDocs, workflowDiff, filterRows, sortRows, aggregate, taskMatrix, labelsFor, hash32 };

})(globalThis);
