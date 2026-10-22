// review: R2.2 the fraud review task, with one deadline from the first task (S3). Keys: 'deadline' (timer), tasks 'task-<n>'.
// Outputs say what the parent must do: approved, rejected, timed-out, reask or waiting.

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const addMin = (iso, m) => new Date(Date.parse(iso) + m * 60000).toISOString();
const DECISIONS = ['approve', 'reject'];

const ANSWER_SCHEMA = {
  type: 'object', required: ['decision'], additionalProperties: false,
  properties: { decision: { enum: DECISIONS } },
};

// One review task (a new task id each time: a re-ask after an unusable answer keeps the same deadline).
const ask = (st, orderId) => ({
  id: `task-${st.n}`, kind: 'fraudReview', role: 'fraudAnalyst', subject: orderId,
  question: `Review order ${orderId}: approve or reject.`, answerSchema: ANSWER_SCHEMA,
  dueAt: addMin(st.deadline, 1), onTimeout: 'cancel',   // a minute after the deadline: an answer exactly at it still counts (R2.2)
});

export function step(input, ctx) {
  if (input.op !== 'open') return { output: { phase: 'none' } };
  if (ctx.state) return { output: { phase: 'open', deadline: ctx.state.deadline } };
  // R2.2: the analyst has fraudReviewHours from the first task (the creation instant, ctx.now)
  const deadline = addMin(ctx.now, input.reviewHours * 60);
  const st = { orderId: input.orderId, deadline, n: 1, decided: null };
  return {
    state: st,
    // fires a minute after the deadline, so an answer exactly at the deadline still counts
    obligations: { upsert: [{ id: 'deadline', kind: 'fraudReviewDeadline', anchor: ctx.now, dueAt: addMin(deadline, 1), onDue: 'deadline' }] },
    humanTasks: [ask(st, input.orderId)],
    output: { phase: 'waiting', deadline },
  };
}

export function onEvent(event, ctx) {
  const st = ctx.state;
  if (!st) return { output: { phase: 'none' } };
  if (st.decided) return { output: { phase: 'settled', decision: st.decided } };
  const late = event.at !== undefined && Date.parse(event.at) > Date.parse(st.deadline);
  const cancelOpen = () => ({ obligations: { cancel: ['deadline'] } });
  if (event.type === 'humanTask.answered') {
    const a = event.payload?.answer ?? event.payload?.value ?? event.payload?.result ?? event.payload ?? {};
    const decision = isObj(a) ? a.decision : undefined;
    if (!DECISIONS.includes(decision)) {
      // R2.2: an unusable answer is asked again, the deadline does not move
      if (late) return { output: { phase: 'timed-out' }, ...cancelOpen() };
      const next = { ...st, n: st.n + 1 };
      return { state: next, humanTasks: [ask(next, st.orderId)], output: { phase: 'reask', why: 'unusable' } };
    }
    if (late) return { state: { ...st, decided: 'timed-out' }, output: { phase: 'timed-out' }, ...cancelOpen() };
    const decided = decision === 'approve' ? 'approved' : 'rejected';
    return { state: { ...st, decided }, ...cancelOpen(), output: { phase: decided, at: event.at } };
  }
  if (event.type === 'humanTask.answerRejected' || event.type === 'humanTask.withdrawn') {
    if (late) return { state: { ...st, decided: 'timed-out' }, output: { phase: 'timed-out' }, ...cancelOpen() };
    const next = { ...st, n: st.n + 1 };
    return { state: next, humanTasks: [ask(next, st.orderId)], output: { phase: 'reask', why: event.type } };
  }
  if (event.type === 'humanTask.timeout' || (event.type === 'timer.fired' && event.payload?.obligationId === 'deadline')) {
    return { state: { ...st, decided: 'timed-out' }, output: { phase: 'timed-out', at: event.at }, ...cancelOpen() };
  }
  return { output: { phase: 'waiting' } };
}
