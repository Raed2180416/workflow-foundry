// Durable signal waits (L0 row 19 with `correlate` and `race`, row 18 `at`; BAR-SET G1, G2, G5): the pure rules that decide a wait.
//
// A run keeps an inbox of delivered signals (run header `signals`, one entry per signal id; the payload itself stays in the
// `signal.delivered` chain event). A signal wait subscribes to one signal name (`signal`) or races several (`race`), each with an optional
// correlation key computed from the instance when the wait starts (`correlate`), and always has a timer (`timeoutMs` or the absolute `at`).
// One rule decides every wait, whoever applies it (the delivery, the execution that starts or resumes the wait, or the replay check below):
//
//   a wait takes the first-delivered (lowest chain seq) unconsumed signal that matches one of its subscriptions and was received strictly
//   before the wait's timer (receivedAt < wakeAt); with none, the wait times out once the clock reaches wakeAt (a tie goes to the timer).
//   A newly delivered signal goes to the parked, unresolved wait it matches that started first (lowest startedSequence, then node key).
//   Each signal is consumed by at most one wait; the losers of a race (the other subscriptions and the timer) are cancelled with it.
//
// Every input of that rule is journaled before it decides anything: the subscriptions and wakeAt in the wait's `node.started` event, each
// signal with its receivedAt in its `signal.delivered` event, and each decision in a `wait.resolved` event. So the outcome of every wait is a
// pure function of the chain, and replayWaits() re-derives it from the chain alone (verify-run reports any difference).
import { digest, FoundryError } from './data.mjs';

export const SIGNAL_NAME = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,127}$/;
// Printable ASCII without spaces: message ids, UUIDs, webhook delivery ids. The id is the idempotency key, unique per workspace.
export const SIGNAL_ID = /^[\x21-\x7e]{1,200}$/;
export const SIGNAL_LIMITS = Object.freeze({ perRun: 256, payloadBytes: 64 * 1024, keyBytes: 4096 });
const RESERVED_IDS = new Set(['__proto__', 'prototype', 'constructor']);
const TIMEOUT_MODES = new Set(['fail', 'continue']);

export const isSignalWait = node => node?.kind === 'wait' && (node.signal !== undefined || node.race !== undefined);
/** The subscriptions a signal wait declares: one per raced signal, or its single `signal`. */
export const subscriptionsOf = node => node.race ?? [{ signal: node.signal, ...(node.correlate === undefined ? {} : { correlate: node.correlate }), ...(node.schema === undefined ? {} : { schema: node.schema }) }];
/** The node a timed-out wait routes to (onTimeout naming a node of the same flow), or null. */
export const routeOf = node => node?.kind === 'wait' && typeof node.onTimeout === 'string' && !TIMEOUT_MODES.has(node.onTimeout) ? node.onTimeout : null;
/** What a timeout does: 'fail' (the default: WAIT_TIMEOUT), 'continue' (the wait completes with outcome "timeout") or 'route'. */
export const timeoutMode = node => node.onTimeout === undefined ? 'fail' : routeOf(node) ? 'route' : node.onTimeout;
/** The correlate templates of a wait (what its subscriptions' keys are computed from). */
export const correlateTemplates = node => isSignalWait(node) ? subscriptionsOf(node).filter(s => s.correlate !== undefined).map(s => s.correlate) : [];

/** name -> payload schema (null: no payload) for every signal a workflow's waits declare, at any depth. */
export function declaredSignals(workflow) {
  const declared = new Map();
  const walk = flow => {
    for (const node of flow?.nodes ?? []) {
      if (isSignalWait(node)) for (const s of subscriptionsOf(node)) if (!declared.has(s.signal)) declared.set(s.signal, s.schema ?? null);
      if (node.body) walk(node.body);
    }
  };
  walk(workflow);
  return declared;
}

// Fractions of a second: up to nanoseconds (Python isoformat writes microseconds), truncated to milliseconds.
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;
const MAX_TIME = 8.64e15;
// An integer below 1e11 (1973-03-03 as epoch milliseconds) is refused: epoch SECONDS of any time from 1973 to the year 5138 fall there,
// and read as milliseconds they would be a date in January 1970, so the wait would fire or time out at once.
export const MIN_EPOCH_MS = 1e11;
/**
 * An absolute wake time (`at`) as epoch milliseconds: an integer of epoch milliseconds (at least MIN_EPOCH_MS), or an ISO 8601 date-time
 * with an explicit offset (`Z` or ±hh:mm). A local time without an offset is ambiguous and refused, and every field is range-checked
 * (Date.parse accepts 30 February).
 */
export function parseAt(value) {
  const bad = () => new FoundryError('WAIT_AT', `at must be epoch milliseconds (not seconds) or an ISO 8601 date-time with an explicit offset (Z or +hh:mm), not ${JSON.stringify(value)?.slice(0, 80)}`);
  if (Number.isSafeInteger(value)) { if (value >= MIN_EPOCH_MS && value <= MAX_TIME) return value; throw bad(); }
  if (typeof value !== 'string' || value.length > 64) throw bad();
  const m = ISO.exec(value);
  if (!m) throw bad();
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(v => v === undefined ? 0 : Number(v)), ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offset = m[8] === 'Z' ? 0 : (m[9] === '-' ? -1 : 1) * (Number(m[10]) * 60 + Number(m[11]));
  // Years before 1970 are refused (epoch milliseconds are not negative), which also keeps Date.UTC off its two-digit-year mapping.
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59 || second > 59 || (m[8] !== 'Z' && (Number(m[10]) > 23 || Number(m[11]) > 59))) throw bad();
  const time = Date.UTC(year, month - 1, day, hour, minute, second, ms) - offset * 60000;
  if (!Number.isSafeInteger(time) || time < 0 || time > MAX_TIME) throw bad();
  return time;
}

/** The hash a delivered key is matched by (a missing key is null). */
export const keyHashOf = key => digest(key ?? null);
/** Does an inbox entry match a subscription? A subscription without a correlation key (keyHash null) accepts any key of its signal. */
export const matches = (subscription, entry) => subscription.signal === entry.name && (subscription.keyHash === null || subscription.keyHash === entry.keyHash);

/** The signal a wait takes from the inbox (see the rule above), as {id, ...entry}; null when there is none. */
export function pickSignal(subscriptions, wakeAt, inbox) {
  let best = null;
  for (const [id, entry] of Object.entries(inbox ?? {})) {
    if (entry.consumedBy || !(entry.receivedAt < wakeAt) || !subscriptions.some(s => matches(s, entry))) continue;
    if (!best || entry.seq < best.seq) best = { id, ...entry };
  }
  return best;
}
/** Which parked, unresolved wait a newly delivered entry goes to: [{nodeKey, state}] -> the claimant, or null. */
export function claimant(waits, entry) {
  return waits.filter(w => Array.isArray(w.state?.subscriptions) && !w.state.resolution && entry.receivedAt < w.state.wakeAt && w.state.subscriptions.some(s => matches(s, entry)))
    .sort((a, b) => (a.state.startedSequence ?? 0) - (b.state.startedSequence ?? 0) || (a.nodeKey < b.nodeKey ? -1 : a.nodeKey > b.nodeKey ? 1 : 0))[0] ?? null;
}
/** The losers a decision cancels: every other subscribed signal, and the timer when a signal won. */
export const cancelledBy = (subscriptions, winner) => [...new Set(subscriptions.map(s => s.signal).filter(name => name !== winner)), ...(winner === null ? [] : ['timer'])];

/** A delivered signal, checked for shape: {id, name, key, payload}. Unknown fields are refused, not ignored. */
export function normalizeSignal(signal) {
  if (!signal || typeof signal !== 'object' || Array.isArray(signal)) throw new FoundryError('SIGNAL_SHAPE', 'A signal is an object {id, name, key?, payload?}');
  const extra = Object.keys(signal).filter(k => !['id', 'name', 'key', 'payload'].includes(k));
  if (extra.length) throw new FoundryError('SIGNAL_SHAPE', `Unsupported signal field ${extra[0].slice(0, 40)}; a signal has id, name, key and payload`);
  const { id, name, key = null, payload = null } = signal;
  if (typeof id !== 'string' || !SIGNAL_ID.test(id) || RESERVED_IDS.has(id)) throw new FoundryError('SIGNAL_ID', 'A signal id (the idempotency key) is 1-200 printable ASCII characters without spaces');
  if (typeof name !== 'string' || !SIGNAL_NAME.test(name)) throw new FoundryError('SIGNAL_NAME', 'A signal name starts with a letter and has at most 128 letters, digits and _ . : -');
  return { id, name, key, payload };
}

/**
 * Where a run record's signal state differs from its verified chain: the inbox (run header `signals`) against the signal.delivered and
 * wait.resolved events, the decision each signal wait holds (node state `resolution`) against its wait.resolved event, and the inputs
 * the rule decides from (each signal wait's subscriptions, timer and start sequence) against its node.started event. The record is a
 * checkpoint any writer to the workspace can edit; an edit there (a consumed signal marked unconsumed, a planted entry or decision, a
 * subscription re-keyed to another order) would let a wait take a signal twice, one nobody delivered, or one meant for another wait. A
 * signal id the chain delivers twice is drift too: the inbox refuses a second delivery of an id, so only an edit of the record (or of the
 * workspace's id index) lets one through. Returns a list of what differs (empty: none). `run` is the whole record.
 */
export function signalCheckpointDrift(run, events) {
  const inbox = new Map(), decisions = new Map(), started = new Map(), drift = [];
  for (const e of events) {
    if (e.type === 'signal.delivered') {
      if (inbox.has(e.signalId)) { drift.push(`signal ${e.signalId} (delivered twice, events ${inbox.get(e.signalId).seq} and ${e.seq})`); continue; }
      inbox.set(e.signalId, { name: e.name, keyHash: e.keyHash, payloadHash: e.payloadHash, receivedAt: e.receivedAt, seq: e.seq, consumedBy: e.consumedBy ?? null });
    } else if (e.type === 'wait.resolved') {
      decisions.set(e.nodeKey, e);
      if (e.outcome === 'signal' && inbox.has(e.signalId)) inbox.get(e.signalId).consumedBy = e.nodeKey;
    } else if (e.type === 'node.started' && e.kind === 'wait') started.set(e.nodeKey, e);
  }
  const held = run.signals && typeof run.signals === 'object' ? run.signals : {};
  for (const [id, entry] of Object.entries(held)) {
    const want = inbox.get(id);
    if (!want) drift.push(`signal ${id} (no signal.delivered event)`);
    else if (['name', 'keyHash', 'payloadHash', 'receivedAt', 'seq', 'consumedBy'].some(k => (entry?.[k] ?? null) !== want[k])) drift.push(`signal ${id}`);
  }
  for (const id of inbox.keys()) if (!Object.hasOwn(held, id)) drift.push(`signal ${id} (missing from the record)`);
  const frames = [['root', run], ...Object.entries(run.frames && typeof run.frames === 'object' ? run.frames : {})];
  const seen = new Set();
  for (const [frameKey, frame] of frames) for (const [id, state] of Object.entries(frame?.nodes ?? {})) {
    const nodeKey = `${frameKey}/${id}`, decision = decisions.get(nodeKey);
    if (decision) seen.add(nodeKey);
    if (!state?.resolution && !decision) continue;
    if (!decision || !state?.resolution || decision.outcome !== state.resolution.outcome || (decision.signalId ?? null) !== (state.resolution.signalId ?? null)) drift.push(`decision of wait ${nodeKey}`);
  }
  for (const nodeKey of decisions.keys()) if (!seen.has(nodeKey)) drift.push(`decision of wait ${nodeKey} (node missing from the record)`);
  return drift;
}

/**
 * Re-derive every signal-wait decision of a run from its verified chain (store.events) and compare it with what the chain recorded.
 * Returns {waits, deliveries, decisions, mismatches: [{code, seq, nodeKey, message}]}. Codes: WAIT_CLAIM (a delivery went to another
 * wait than the rule gives, or to none when one was due), WAIT_PICK (a buffered signal other than the rule's), WAIT_TIMEOUT_EARLY (a
 * timeout before the timer, or while an eligible signal waited), WAIT_MISSED (a wait parked with an eligible signal in the inbox),
 * WAIT_CANCELLED (the cancelled losers differ), WAIT_OUTPUT (the completed output is not the decision's), SIGNAL_DOUBLE (one signal
 * consumed twice), WAIT_UNKNOWN (a decision for a wait that never started).
 */
export function replayWaits(events) {
  const waits = new Map(), inbox = {}, payloads = new Map(), mismatches = [];
  let deliveries = 0, decisions = 0, pendingClaim = null;
  const miss = (code, event, message) => mismatches.push({ code, seq: event.seq, nodeKey: event.nodeKey ?? null, message });
  for (const event of events) {
    // A delivery that resolved a wait is followed, in the same commit, by that wait's decision.
    if (pendingClaim && !(event.type === 'wait.resolved' && event.by === 'delivery')) {
      miss('WAIT_CLAIM', event, `signal ${pendingClaim.signalId} was given to ${pendingClaim.nodeKey}, but no decision of that wait follows the delivery`);
      pendingClaim = null;
    }
    if (event.type === 'node.started' && Array.isArray(event.subscriptions)) {
      waits.set(event.nodeKey, { subscriptions: event.subscriptions, wakeAt: event.wakeAt, startedSequence: event.seq, parked: false, resolution: null });
      continue;
    }
    const wait = waits.get(event.nodeKey);
    if (event.type === 'node.waiting' && wait) {
      const eligible = wait.resolution ? null : pickSignal(wait.subscriptions, wait.wakeAt, inbox);
      if (eligible) miss('WAIT_MISSED', event, `${event.nodeKey} parked while signal ${eligible.id} (event ${eligible.seq}) was eligible`);
      wait.parked = true;
    } else if (event.type === 'signal.delivered') {
      deliveries++;
      const entry = { name: event.name, keyHash: event.keyHash, receivedAt: event.receivedAt, seq: event.seq, consumedBy: null };
      const open = [...waits].filter(([, w]) => w.parked && !w.resolution).map(([nodeKey, w]) => ({ nodeKey, state: { ...w, startedSequence: w.startedSequence } }));
      const expected = claimant(open, entry)?.nodeKey ?? null;
      if (expected !== (event.consumedBy ?? null)) miss('WAIT_CLAIM', event, `signal ${event.signalId} went to ${event.consumedBy ?? 'no wait'}; the rule gives ${expected ?? 'no wait'}`);
      inbox[event.signalId] = entry; payloads.set(event.signalId, event.payloadHash);
      pendingClaim = event.consumedBy ? { signalId: event.signalId, nodeKey: event.consumedBy } : null;
      continue;
    } else if (event.type === 'wait.resolved') {
      decisions++;
      if (!wait) { miss('WAIT_UNKNOWN', event, `${event.nodeKey} was resolved but no node.started event of a signal wait precedes it`); pendingClaim = null; continue; }
      if (wait.resolution) miss('WAIT_PICK', event, `${event.nodeKey} was resolved twice`);
      if (event.outcome === 'signal') {
        const entry = inbox[event.signalId];
        if (event.by === 'delivery') {
          if (pendingClaim?.signalId !== event.signalId || pendingClaim?.nodeKey !== event.nodeKey) miss('WAIT_CLAIM', event, `${event.nodeKey} claims delivery ${event.signalId}, which the delivery did not give it`);
        } else {
          const expected = pickSignal(wait.subscriptions, wait.wakeAt, inbox);
          if (expected?.id !== event.signalId) miss('WAIT_PICK', event, `${event.nodeKey} took ${event.signalId}; the rule gives ${expected?.id ?? 'no signal'}`);
        }
        if (!entry) miss('WAIT_PICK', event, `${event.nodeKey} took ${event.signalId}, which was never delivered`);
        else if (entry.consumedBy) miss('SIGNAL_DOUBLE', event, `signal ${event.signalId} was consumed by ${entry.consumedBy} and again by ${event.nodeKey}`);
        else entry.consumedBy = event.nodeKey;
        if (digest(event.cancelled ?? null) !== digest(cancelledBy(wait.subscriptions, event.signal ?? entry?.name ?? null))) miss('WAIT_CANCELLED', event, `${event.nodeKey} cancelled ${JSON.stringify(event.cancelled)}`);
        wait.resolution = { outcome: 'signal', signalId: event.signalId };
      } else {
        const eligible = pickSignal(wait.subscriptions, wait.wakeAt, inbox);
        if (eligible) miss('WAIT_TIMEOUT_EARLY', event, `${event.nodeKey} timed out while signal ${eligible.id} was eligible`);
        if (!(event.at >= wait.wakeAt)) miss('WAIT_TIMEOUT_EARLY', event, `${event.nodeKey} timed out at ${event.at}, before its timer at ${wait.wakeAt}`);
        if (digest(event.cancelled ?? null) !== digest(cancelledBy(wait.subscriptions, null))) miss('WAIT_CANCELLED', event, `${event.nodeKey} cancelled ${JSON.stringify(event.cancelled)}`);
        wait.resolution = { outcome: 'timeout' };
      }
    } else if (event.type === 'node.completed' && wait?.resolution) {
      const out = event.output ?? {}, r = wait.resolution;
      const right = out.outcome === r.outcome && (r.outcome === 'timeout' ? out.at === wait.wakeAt
        : out.id === r.signalId && digest(out.payload ?? null) === payloads.get(r.signalId) && out.signal === inbox[r.signalId]?.name && out.at === inbox[r.signalId]?.receivedAt);
      if (!right) miss('WAIT_OUTPUT', event, `${event.nodeKey} completed with an output that is not its ${r.outcome} decision`);
    }
    pendingClaim = null;
  }
  if (pendingClaim) miss('WAIT_CLAIM', events.at(-1), `signal ${pendingClaim.signalId} was given to ${pendingClaim.nodeKey}, but no decision of that wait follows the delivery`);
  return { waits: waits.size, deliveries, decisions, mismatches };
}
