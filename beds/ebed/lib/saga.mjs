// Saga planner (BAR-SET §3 "P59, compensation planner"; E-BED §3 E8, MR11, §5 "compensation correctness"). A pure
// function from a saga definition and the observed outcome of its steps to the next action: query the status of
// unknown outcomes, continue forward, retry forward past a committed pivot, or compensate the committed steps in
// reverse commit order. Oracle-side; written without reference to the library cards
// (experiments/library/cards/P58-P60), sharing no code with them.
//
// Definition: { id, steps: [{ id, do: { system, op }, undo: { system, op } | null, kind?, subject?, itemArg? }] }
//   kind     'compensable' (default; undo may be null: "nothing to undo", reported in `skipped`),
//            'pivot' (at most one; its commit is the point of no return), 'retriable' (only after a pivot; never
//            compensated, retried forward). This is the compensable / pivot / retriable split of the saga literature;
//            a definition breaking it (a retriable step before the pivot, a compensable one after it) is refused.
//   subject  the business arguments that identify the step's effect (e.g. { orderId, fulfilmentId }); itemArg names
//            the argument that carries an item id for steps observed per item (partial batches, F4).
// Observation: { steps: { [stepId]: Unit | { items: { [itemId]: Unit } } } }, Unit = { outcome, status?, seq? }
//   outcome  'ok' (committed) | 'error' (not applied; the failure that stops the saga) | 'unknown' (timeout after
//            commit is possible, F3) | 'not-started'
//   status   for 'unknown': the result of status(key): 'committed' | 'not-found' | 'pending'
//   seq      commit sequence number; when given for every committed unit, compensation follows reverse seq
//            (parallel branches); when given for none, reverse step order; a mix is refused.
// Order (review fix, 2026-10-14): compensations form groups. Units of one step that are adjacent in reverse commit
//   order are one group, and a group has no internal order (a batch's items, F4, committed in no known order: without
//   seq, JavaScript's key order is not commit order). Every compensation is `after` all compensations of the previous
//   group. Different steps are never grouped, so steps (parallel branches with seq included) stay in strict reverse
//   commit order, the E8 rulebook's "reverse order of committed steps".
// Abort: planSaga(saga, observed, { abort: { reason } }) plans an abort decided outside the steps (a customer cancel
//   inside its window, a lost timer race, a timeout policy that gives up on a step).
// Readings (MR11, E-BED Errata 17): the compensation set is the committed units as observed by status query, so a unit
// whose outcome was unknown and whose query shows 'committed' is compensated; an unknown with no answer (or 'pending')
// blocks the plan (action 'query-status'), never guessed. 'not-found' after 'unknown' means not applied: the step may
// be re-issued with the same key (action 'continue'). A failure after a committed pivot is retried forward; an abort
// after a committed pivot is refused (action 'abort-refused'). Every committed unit is compensated, wherever it sits
// (parallel branches included), except units of steps with no undo, which are listed in `skipped`.
import { fail } from './errors.mjs';

const KINDS = new Set(['compensable', 'pivot', 'retriable']);
const OUTCOMES = new Set(['ok', 'error', 'unknown', 'not-started']);
const enc = s => {
  try { return encodeURIComponent(String(s)); } catch { return fail('SAGA_INVALID', `key part is not well-formed Unicode: ${JSON.stringify(s)}`); }
};

/**
 * Deterministic idempotency key of one logical effect: distinct (saga, step, item, phase) give distinct keys (every
 * part is percent-encoded, so ':' only separates; phase is 'do' or 'undo').
 */
export function sagaKey(sagaId, stepId, itemId, phase) {
  if (phase !== 'do' && phase !== 'undo') fail('SAGA_INVALID', `key phase must be do or undo, not ${JSON.stringify(phase)}`);
  return `${enc(sagaId)}:${enc(stepId)}${itemId === null || itemId === undefined ? '' : `:${enc(itemId)}`}:${phase}`;
}

/** Validate a saga definition. */
export function defineSaga(saga) {
  if (!saga || typeof saga.id !== 'string' || !saga.id || !Array.isArray(saga.steps) || !saga.steps.length) fail('SAGA_INVALID', 'saga needs an id and a non-empty steps array');
  const ids = new Set();
  let pivotAt = -1;
  saga.steps.forEach((s, i) => {
    if (!s || typeof s.id !== 'string' || !s.id || ids.has(s.id)) fail('SAGA_INVALID', `step ${i} needs a unique string id`);
    ids.add(s.id);
    const kind = s.kind ?? 'compensable';
    if (!KINDS.has(kind)) fail('SAGA_INVALID', `step ${s.id}: unknown kind ${kind}`);
    if (!s.do || typeof s.do.system !== 'string' || typeof s.do.op !== 'string') fail('SAGA_INVALID', `step ${s.id}: do must be { system, op }`);
    if (s.undo !== null && (!s.undo || typeof s.undo.system !== 'string' || typeof s.undo.op !== 'string')) fail('SAGA_INVALID', `step ${s.id}: undo must be { system, op } or null`);
    if (kind === 'pivot') { if (pivotAt >= 0) fail('SAGA_INVALID', 'at most one pivot step'); pivotAt = i; }
  });
  saga.steps.forEach((s, i) => {
    const kind = s.kind ?? 'compensable';
    if (kind === 'retriable' && (pivotAt < 0 || i < pivotAt)) fail('SAGA_INVALID', `step ${s.id}: retriable steps must follow the pivot`);
    if (kind === 'compensable' && pivotAt >= 0 && i > pivotAt) fail('SAGA_INVALID', `step ${s.id}: steps after the pivot must be retriable`);
  });
  return saga;
}

function unitState(u, where) {
  if (!u || !OUTCOMES.has(u.outcome)) fail('SAGA_INPUT', `${where}: outcome must be one of ${[...OUTCOMES].join(', ')}`);
  if (u.outcome === 'ok') return 'committed';
  if (u.outcome === 'error') return 'failed';
  if (u.outcome === 'not-started') return 'not-started';
  if (u.status === 'committed') return 'committed';
  if (u.status === 'not-found') return 'not-applied';
  if (u.status === undefined || u.status === null || u.status === 'pending') return 'undetermined';
  return fail('SAGA_INPUT', `${where}: unknown status ${u.status}`);
}

/** Flatten an observation into units in (step, item) order: [{ step, stepIndex, item, state, seq }]. */
function unitsOf(saga, observed) {
  const units = [];
  saga.steps.forEach((s, stepIndex) => {
    const o = observed?.steps?.[s.id] ?? { outcome: 'not-started' };
    if (o.items) {
      const items = Object.keys(o.items);
      if (!items.length) fail('SAGA_INPUT', `step ${s.id}: empty items`);
      for (const item of items) units.push({ step: s, stepIndex, item, state: unitState(o.items[item], `${s.id}/${item}`), seq: o.items[item].seq });
    } else units.push({ step: s, stepIndex, item: null, state: unitState(o, s.id), seq: o.seq });
  });
  return units;
}

const stepState = us => (us.some(u => u.state === 'failed') ? 'failed' : us.every(u => u.state === 'committed') ? 'committed' : us.some(u => u.state === 'committed') ? 'partial' : 'open');
const subjectOf = (step, item) => ({ ...(step.subject ?? {}), ...(item !== null && step.itemArg ? { [step.itemArg]: item } : {}) });

/**
 * Plan the next action. Returns one of
 *   { action: 'query-status', units: [{ step, item, key }] }
 *   { action: 'complete' }
 *   { action: 'continue', step, units: [{ step, item, key }] }          next forward step (re-issue with the same key)
 *   { action: 'retry-forward', failure, units: [...] }                   failure after a committed pivot
 *   { action: 'abort-refused', reason: 'pivot-committed' }
 *   { action: 'compensate', failure, abort, compensations: [{ step, item, system, op, key, group, after, subject }], skipped }
 * `failure` is the first failed unit { step, item } (null for an abort with no failure). Keys are
 * sagaKey(saga, step, item, 'do' | 'undo'). `group` numbers the compensation groups from 0; `after` lists the keys of
 * every compensation in the previous group ([] in group 0). List order inside a group is not an order.
 */
export function planSaga(sagaDef, observed, { abort = null } = {}) {
  const saga = defineSaga(sagaDef);
  const units = unitsOf(saga, observed);
  const ref = u => ({ step: u.step.id, item: u.item, key: sagaKey(saga.id, u.step.id, u.item, 'do') });
  const undetermined = units.filter(u => u.state === 'undetermined');
  if (undetermined.length) return { action: 'query-status', units: undetermined.map(ref) };
  const failed = units.find(u => u.state === 'failed');
  const pivotIndex = saga.steps.findIndex(s => s.kind === 'pivot');
  const pivotUnits = units.filter(u => u.stepIndex === pivotIndex);
  const pivotCommitted = pivotIndex >= 0 && pivotUnits.every(u => u.state === 'committed');
  if ((failed || abort) && pivotUnits.some(u => u.state === 'committed') && !pivotCommitted) {
    fail('SAGA_INPUT', `pivot step ${saga.steps[pivotIndex].id} is partially committed (${pivotUnits.map(u => `${u.item}: ${u.state}`).join(', ')}): a pivot commits as one unit, so this failure or abort has no plan`);
  }
  if (abort && pivotCommitted) return { action: 'abort-refused', reason: 'pivot-committed' };
  if (!failed && !abort) {
    if (units.every(u => u.state === 'committed')) return { action: 'complete' };
    const next = units.find(u => u.state !== 'committed');
    return { action: 'continue', step: next.step.id, units: units.filter(u => u.stepIndex === next.stepIndex && u.state !== 'committed').map(ref) };
  }
  const failure = failed ? { step: failed.step.id, item: failed.item } : null;
  if (failed && pivotCommitted && failed.stepIndex > pivotIndex) {
    return { action: 'retry-forward', failure, units: units.filter(u => u.stepIndex >= failed.stepIndex && u.state !== 'committed').map(ref) };
  }
  const committed = units.filter(u => u.state === 'committed');
  const withSeq = committed.filter(u => u.seq !== undefined && u.seq !== null);
  if (withSeq.length && withSeq.length !== committed.length) fail('SAGA_INPUT', 'seq must be given for every committed unit or for none');
  if (withSeq.length && new Set(withSeq.map(u => u.seq)).size !== withSeq.length) fail('SAGA_INPUT', 'duplicate seq');
  const order = withSeq.length ? [...committed].sort((a, b) => b.seq - a.seq) : [...committed].reverse();
  const compensations = [], skipped = [];
  let prevGroup = [], curGroup = [], curStep = null, group = -1;
  for (const u of order) {
    if (u.step.kind === 'pivot' || u.step.kind === 'retriable') fail('SAGA_INPUT', `step ${u.step.id} committed before an earlier failure: inconsistent observation`);
    if (!u.step.undo) { skipped.push({ step: u.step.id, item: u.item, reason: 'no-undo' }); continue; }
    if (u.step !== curStep) { if (curGroup.length) prevGroup = curGroup; curGroup = []; curStep = u.step; group += 1; }
    const key = sagaKey(saga.id, u.step.id, u.item, 'undo');
    compensations.push({ step: u.step.id, item: u.item, system: u.step.undo.system, op: u.step.undo.op, key, group, after: [...prevGroup], subject: subjectOf(u.step, u.item) });
    curGroup.push(key);
  }
  return { action: 'compensate', failure, abort, compensations, skipped };
}

/** Per-step summary of an observation: { [stepId]: 'committed' | 'partial' | 'failed' | 'open' } (diagnostic). */
export function stepStates(sagaDef, observed) {
  const saga = defineSaga(sagaDef);
  const units = unitsOf(saga, observed);
  return Object.fromEntries(saga.steps.map((s, i) => [s.id, stepState(units.filter(u => u.stepIndex === i))]));
}

/**
 * Enumerate the single failure points of a saga (no items): for each step k, steps before k committed in order and
 * steps after k not started, with step k ending in one of five ways — 'error'; 'unknown/committed+abort' and
 * 'unknown/not-found+abort' (the step timed out, the saga is aborted, the status query decides whether k itself is
 * compensated: MR11); 'unknown/pending' (the plan must wait for the query); 'ok+abort' (aborted right after k).
 * Returns [{ name, observed, abort, plan }]: the partial-failure-point table the tests check by hand.
 */
export function failurePoints(sagaDef) {
  const saga = defineSaga(sagaDef);
  const out = [];
  const variants = [
    ['error', { outcome: 'error' }, null], ['unknown/committed+abort', { outcome: 'unknown', status: 'committed' }, { reason: 'timeout' }],
    ['unknown/not-found+abort', { outcome: 'unknown', status: 'not-found' }, { reason: 'timeout' }],
    ['unknown/pending', { outcome: 'unknown', status: 'pending' }, null], ['ok+abort', { outcome: 'ok' }, { reason: 'cancel' }],
  ];
  saga.steps.forEach((s, k) => {
    for (const [variant, unit, abort] of variants) {
      const steps = {};
      saga.steps.forEach((t, i) => { steps[t.id] = i < k ? { outcome: 'ok' } : i === k ? { ...unit } : { outcome: 'not-started' }; });
      const observed = { steps };
      out.push({ name: `${s.id}:${variant}`, observed, abort, plan: planSaga(saga, observed, { abort }) });
    }
  });
  return out;
}

/**
 * The compensation plan as logical effects for ledger.matchEffects (E-BED §2.8 layer 2): one lid per compensation,
 * `match` = the step's subject (plus the item argument), `after` = every compensation of the previous group (the
 * rulebook declares compensation order between steps; a batch's items are unordered), window = the caller's
 * rule-cited window. Keys are arm-chosen, so the plan's keys are not part of the match.
 */
export function compensationEffects(sagaDef, plan, { window, rule = 'saga.compensate', money = {} }) {
  const saga = defineSaga(sagaDef);
  if (plan.action !== 'compensate') return [];
  const lidOfKey = key => `undo:${key}`;
  return plan.compensations.map(c => {
    const e = { lid: lidOfKey(sagaKey(saga.id, c.step, c.item, 'undo')), rule, system: c.system, op: c.op, match: c.subject, window, after: c.after.map(lidOfKey) };
    if (money[c.step]) e.money = true;
    return e;
  });
}
