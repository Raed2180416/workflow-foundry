// Human-task router and actor noise model (E-BED §2.7; BED-CONTRACT-v1.1 §4.4). A task is routed to the item's actor
// policy by (world, truth case of the task's subject, role, kind, ordinal) — never by the question text or the arm's
// task id, so two arms that ask the same thing in different words get the same answer (Errata 2). The answering user is
// the first holder of the role in the world's pool who is not in `excludeUsers` (the host routes as the arm declared;
// it never enforces separation of duties beyond that). An unknown kind, a subject that names no existing object, or no
// eligible user gets no answer.
//
// The noise model draws one class per routing key from rng('ebed-noise', world, case, role, kind, ordinal), with the
// shares declared in `world.noise` (calibrated per item on BPI 2017's work-item lifecycle, E-BED §2.7):
//   none      no answer; the arm's task times out at its dueAt
//   late      the answer arrives after dueAt (timeout first, then `answered` with late: true)
//   delegate  `humanTask.delegated` to the next eligible role holder, who answers
//   withdraw  `humanTask.withdrawn`; no answer, no timeout (the work item is gone)
//   freeText  the actor answers `{ text }` when its policy offers free text for this kind
//   wrong     the actor gives its policy's declared wrong answer (only where the rulebook requires verification)
// and, independently, whether the answer goes through the form route (`form`) and whether its first form submission
// carries a planted invalid entry (`formInvalid`). Every timeline is computed when the task is created, from data that
// is identical across arms, and journaled with the task.
import { rng } from '../../lib/rng.mjs';
import { validate } from './schema.mjs';
import { toFormState, fromFormState, plantInvalid, clientNumericAccepts } from './form.mjs';
import { MINUTE } from './time.mjs';

export const NOISE_CLASSES = Object.freeze(['none', 'late', 'delegate', 'withdraw', 'freeText', 'wrong']);
const SHARE_KEYS = Object.freeze([...NOISE_CLASSES, 'form', 'formInvalid']);

export function checkNoise(noise = {}) {
  for (const [k, v] of Object.entries(noise)) {
    if (!SHARE_KEYS.includes(k)) throw new Error(`world.noise: unknown share ${k}`);
    if (!(typeof v === 'number' && v >= 0 && v <= 1)) throw new Error(`world.noise.${k}: share must be in [0, 1]`);
  }
  const sum = NOISE_CLASSES.reduce((s, k) => s + (noise[k] ?? 0), 0);
  if (sum > 1 + 1e-12) throw new Error(`world.noise: class shares sum to ${sum} > 1`);
  return noise;
}

/** The noise draw for one routing key (pure, identical for every arm). */
export function noiseDraw(world, c, role, kind, ordinal) {
  const r = rng('ebed-noise', world.id, c, role, kind, ordinal);
  const u = r.next(), uForm = r.next(), uInvalid = r.next(), uLate = r.next();
  const noise = world.noise ?? {};
  let acc = 0, cls = 'normal';
  for (const k of NOISE_CLASSES) { acc += noise[k] ?? 0; if (u < acc) { cls = k; break; } }
  return { cls, form: uForm < (noise.form ?? 0), formInvalid: uInvalid < (noise.formInvalid ?? 0), lateByMinutes: 1 + Math.floor(uLate * 24 * 60) };
}

export function eligibleUsers(world, role, excludeUsers = []) {
  return (world.actorsPool?.[role] ?? []).filter(u => !excludeUsers.includes(u));
}

/**
 * Plan a human task's whole timeline. Returns { noAnswer?, user, ordinal, noise, steps: [{ atMs, type, payload, phase }] }.
 * `type` is an event type (`humanTask.answered` | `humanTask.answerRejected` | `humanTask.timeout` | `humanTask.delegated`
 * | `humanTask.withdrawn`) or the host-internal `form.rejected` (journaled, never delivered).
 */
export function planTask({ world, actors, task, kinds, c, ordinal, createdMs, dueMs, iso = ms => ms }) {
  const steps = [];
  const timeout = () => steps.push({ atMs: dueMs, type: 'humanTask.timeout', payload: { taskId: task.id, onTimeout: task.onTimeout } });
  const noAnswer = reason => { timeout(); return { noAnswer: reason, user: null, ordinal, noise: null, steps }; };
  if (!Object.prototype.hasOwnProperty.call(kinds, task.kind)) return noAnswer('unknown-kind');
  if (c === null) return noAnswer('unknown-subject');
  const pool = eligibleUsers(world, task.role, task.excludeUsers ?? []);
  if (!pool.length) return noAnswer('no-eligible-user');
  let user = pool[0];
  const base = actors?.answer?.(world, { case: c, subject: task.subject, role: task.role, kind: task.kind, ordinal, user,
    createdAt: iso(createdMs), dueAt: iso(dueMs) }) ?? null;
  const noise = noiseDraw(world, c, task.role, task.kind, ordinal);
  if (base === null || noise.cls === 'none') return { ...noAnswer(base === null ? 'actor-silent' : 'noise-none'), user, noise: { ...noise, applied: 'none' } };
  const delay = Math.max(1, Math.floor(base.delayMinutes ?? 60));
  let answerMs = createdMs + delay * MINUTE;
  let value = base.value;
  let cls = noise.cls;
  if (cls === 'withdraw') {
    steps.push({ atMs: answerMs, type: 'humanTask.withdrawn', payload: { taskId: task.id, user } });
    return { user, ordinal, noise: { ...noise, applied: 'withdraw' }, steps };
  }
  if (cls === 'delegate') {
    const next = pool[1];
    if (next === undefined) cls = 'normal';
    else {
      steps.push({ atMs: createdMs + Math.max(1, Math.floor(delay / 2)) * MINUTE, type: 'humanTask.delegated', payload: { taskId: task.id, from: user, to: next } });
      user = next;
    }
  }
  if (cls === 'late') answerMs = Math.max(answerMs, dueMs) + noise.lateByMinutes * MINUTE;
  if (cls === 'freeText' && typeof base.text === 'string') value = { text: base.text };
  if (cls === 'wrong' && Object.prototype.hasOwnProperty.call(base, 'wrong')) value = base.wrong;
  let form = null;
  if (noise.form) {
    const state = toFormState(task.answerSchema, value);
    const planted = noise.formInvalid ? plantInvalid(state) : null;
    if (planted) {
      const bad = fromFormState(task.answerSchema, planted.formState);
      const errors = validate(task.answerSchema, bad);
      steps.push({ atMs: answerMs, type: 'form.rejected', phase: 0, payload: { taskId: task.id, user, path: planted.path,
        entered: planted.formState[planted.path].value, clientNumericAccepts: clientNumericAccepts(planted.formState[planted.path].value), errors: errors.slice(0, 8) } });
      answerMs += MINUTE;                                       // the actor re-enters the correct value once
    }
    value = fromFormState(task.answerSchema, state);
    form = { planted: planted ? planted.path : null };
  }
  if (answerMs > dueMs) timeout();
  const errors = validate(task.answerSchema, value);
  const late = answerMs > dueMs;
  steps.push(errors.length
    ? { atMs: answerMs, type: 'humanTask.answerRejected', payload: { taskId: task.id, user, errors: errors.slice(0, 8), ...(late ? { late: true } : {}) } }
    : { atMs: answerMs, type: 'humanTask.answered', payload: { taskId: task.id, user, answer: value, ...(late ? { late: true } : {}) } });
  return { user, ordinal, noise: { ...noise, applied: cls }, form, steps };
}
