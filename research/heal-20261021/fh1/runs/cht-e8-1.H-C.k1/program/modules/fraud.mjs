// Module fraud, key: the order id. Owns R2.1, R2.2 and S3 (one review deadline, from the first review task), and the
// human-task events of §3.4. Effects: fraud.check (key `check`). Human tasks: fraudReview (ids `review-<n>`).
// Wake-up: `deadline`, set after the review deadline (an answer exactly at the deadline still counts, R2.2; a
// wake-up 30 min after it lets an answer delivered late still count). Always return `output`.
//
// state: { state: 'checking'|'review'|'cleared'|'cancel'|'stopped', placedAt, edition, deadline, tasks: n, at, reason }

const WAKE_AFTER_MIN = 30;

// Files arrive as raw text: parse a JSON file (or pass a parsed value through).
function fileJson(files, path) {
  const v = files?.[path];
  return typeof v === 'string' ? JSON.parse(v) : v ?? null;
}

export function step(input, ctx) {
  switch (input.op) {
    case 'start': return start(input, ctx);
    case 'stop': return stop(input, ctx);
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`fraud: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  const state = ctx.state;
  if (!state) return { output: view(null) };
  const p = event.payload ?? {};
  if (event.type === 'effect.result' && p.key === 'check' && state.state === 'checking') return checked(state, p, event, ctx);
  if (event.type === 'humanTask.answered') return answered(state, p, event, ctx);
  if (event.type === 'humanTask.answerRejected' || event.type === 'humanTask.withdrawn') return unusable(state, ctx);
  if (event.type === 'timer.fired' && state.state === 'review') return timedOut(state, ctx);
  return { output: view(state) };
}

function view(state) {
  if (!state) return { state: 'idle', at: null, reason: null, busy: false };
  return { state: state.state, at: state.at ?? null, reason: state.reason ?? null, busy: state.state === 'checking' || state.state === 'review' };
}

function start(input, ctx) {
  // R2.1: read fraud.check for every new order.
  const state = { state: 'checking', placedAt: input.placedAt, edition: input.edition, deadline: null, tasks: 0, at: null, reason: null };
  return { output: view(state), state, effects: [{ key: 'check', system: 'fraud', op: 'check', args: { orderId: input.orderId } }] };
}

function checked(state, p, event, ctx) {
  const verdict = verdictOf(p);
  const orderId = ctx.key;
  if (verdict === 'pass') {
    const next = { ...state, state: 'cleared', at: state.placedAt };                    // R2.1: cleared at p
    return { output: view(next), state: next };
  }
  if (verdict === 'reject') {
    const next = { ...state, state: 'cancel', at: ctx.now, reason: 'fraud' };
    return { output: view(next), state: next };
  }
  if (verdict === 'review') {
    // R2.2: one review task; the deadline is fraudReviewHours from its creation, and it never moves (S3).
    const hours = fileJson(ctx.files, `rulebook/${state.edition}/policy.json`).fraudReviewHours;
    const deadline = addMinutes(ctx.now, hours * 60);
    const next = { ...state, state: 'review', deadline, tasks: 1 };
    return { output: view(next), state: next, humanTasks: [reviewTask(orderId, 1, deadline)], obligations: { upsert: [wakeUp(deadline)] } };
  }
  throw new Error(`fraud: unknown verdict ${JSON.stringify(verdict)}`);
}

function answered(state, p, event, ctx) {
  if (state.state !== 'review') return { output: view(state) };                           // a later answer changes nothing
  const decision = p.answer?.decision ?? p.decision ?? p.value?.decision;
  const at = p.answeredAt ?? event.at;
  // An answer counts only if it carries `decision` and its time is at or before the deadline (R2.2). The `late`
  // flag is not the criterion (§3.4).
  if (decision !== 'approve' && decision !== 'reject') return unusable(state, ctx);
  if (Date.parse(at) > Date.parse(state.deadline)) return { output: view(state) };
  const next = decision === 'approve'
    ? { ...state, state: 'cleared', at }
    : { ...state, state: 'cancel', at, reason: 'fraud' };
  return { output: view(next), state: next, obligations: { cancel: ['deadline'] } };
}

function unusable(state, ctx) {
  // Unusable, rejected or withdrawn: ask again (new task id); the deadline stays (R2.2, S3).
  if (state.state !== 'review' || Date.parse(ctx.now) > Date.parse(state.deadline)) return { output: view(state) };
  const n = state.tasks + 1;
  const next = { ...state, tasks: n };
  return { output: view(next), state: next, humanTasks: [reviewTask(ctx.key, n, state.deadline)] };
}

function timedOut(state, ctx) {
  // No usable answer by the deadline: cancel after it, within 120 min (R2.2).
  const next = { ...state, state: 'cancel', at: ctx.now, reason: 'fraud-review-timeout' };
  return { output: view(next), state: next };
}

function stop(input, ctx) {
  // R6.4: a customer cancel before clearing stops the review: a later answer changes nothing.
  if (!ctx.state) return { output: view({ state: 'stopped' }) };
  const next = { ...ctx.state, state: 'stopped' };
  return { output: view(next), state: next, obligations: { cancel: ['deadline'] } };
}

function resume(input, ctx) {
  // §3.5: from the records: an order already past its fraud phase is cleared; otherwise the review stays open.
  const r = input.records ?? {};
  const state = r.state ? { state: r.state, placedAt: r.placedAt, edition: r.edition, deadline: r.deadline ?? null, tasks: r.tasks ?? 0, at: r.at ?? null, reason: r.reason ?? null } : null;
  if (!state) return { output: view(null) };
  return { output: view(state), state };
}

function verdictOf(p) {
  for (const c of [p, p.result, p.value, p.output, p.data]) if (c && typeof c.verdict === 'string') return c.verdict;
  throw new Error(`fraud: check result has no verdict: ${JSON.stringify(p).slice(0, 120)}`);
}

function reviewTask(orderId, n, deadline) {
  return {
    id: `review-${n}`,
    kind: 'fraudReview',
    role: 'fraudAnalyst',
    subject: orderId,
    question: `Review order ${orderId} for fraud and decide: approve or reject.`,
    answerSchema: {
      type: 'object',
      required: ['decision'],
      additionalProperties: false,
      properties: { decision: { enum: ['approve', 'reject'] } },
    },
    dueAt: deadline,
    onTimeout: 'expire',
  };
}

function wakeUp(deadline) {
  return { id: 'deadline', kind: 'fraud-deadline', anchor: 'review-task', dueAt: addMinutes(deadline, WAKE_AFTER_MIN), onDue: 'deadline' };
}

function addMinutes(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60000).toISOString();
}
