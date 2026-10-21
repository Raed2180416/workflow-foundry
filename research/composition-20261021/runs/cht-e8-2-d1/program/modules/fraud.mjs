// Module fraud, key: the order id. Owns R2.1 (the verdict of fraud.check), R2.2 (the review task, its single deadline,
// the answers that count, the clearing when no usable answer comes by the deadline) and S3 (one review deadline per
// order, from the first review task).
// Effects: fraud.check (key 'check'). Human tasks: fraudReview ('review-<n>'). Wake-up: 'deadline', after the
// deadline and never at it (an answer exactly at the deadline still counts). Always returns `output`.

const MIN = 60000;

function lastSunday(y, m) {
  const last = new Date(Date.UTC(y, m + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

// Europe/Amsterdam offset in minutes at an instant (EU rule, switching at 01:00 UTC on the last Sundays of March and
// October).
function amsOffsetMin(ms) {
  const y = new Date(ms).getUTCFullYear();
  const start = Date.UTC(y, 2, lastSunday(y, 2), 1);
  const end = Date.UTC(y, 9, lastSunday(y, 9), 1);
  return ms >= start && ms < end ? 120 : 60;
}

function amsIso(ms) {
  const off = amsOffsetMin(ms);
  const d = new Date(ms + off * MIN);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+${p(Math.floor(off / 60))}:${p(off % 60)}`;
}

function readJson(files, path) {
  let v = files?.[path];
  if (v === undefined) { v = files; for (const seg of path.split('/')) v = v?.[seg]; }
  if (typeof v === 'string') return JSON.parse(v);
  return v ?? null;
}

function policyParam(files, edition, name) {
  const p = readJson(files, `rulebook/${edition}/policy.json`) ?? {};
  const v = p[name] ?? p.policy?.[name];
  if (typeof v !== 'number') throw new Error(`policy ${edition} has no ${name}`);
  return v;
}

function outOf(st) {
  return {
    output: {
      state: st?.state ?? 'idle',
      at: st?.at ?? null,
      reason: st?.reason ?? null,
      busy: !!st && !!st.checkInFlight,
    },
  };
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
  const st = ctx.state;
  if (!st) return outOf(null);
  const p = event.payload ?? {};
  const now = ctx.now;

  if (event.type === 'effect.result' && p.key === 'check') {
    if (st.state !== 'checking') return { ...outOf({ ...st, checkInFlight: false }), state: { ...st, checkInFlight: false } };
    const body = p.result ?? p;
    const verdict = p.status === 'ok' ? (body.verdict ?? p.verdict) : undefined;
    const next = { ...st, checkInFlight: false };
    if (verdict !== 'pass' && verdict !== 'reject' && verdict !== 'review') {
      // an error, or no verdict in the answer: read again (a read has no effect), at most three times
      if ((st.checks ?? 1) >= 3) return { ...outOf(next), state: next };
      const again = { ...next, checks: (st.checks ?? 1) + 1, checkInFlight: true };
      return { ...outOf(again), state: again, effects: [checkEffect(st.orderId)] };
    }
    if (verdict === 'pass') return decide({ ...next, state: 'cleared', at: st.placedAt }, null);
    if (verdict === 'reject') return decide({ ...next, state: 'cancel', at: now, reason: 'fraud' }, null);
    // review (R2.2): one task, the deadline fixed from its creation
    const deadline = amsIso(Date.parse(now) + policyParam(ctx.files, st.edition, 'fraudReviewHours') * 60 * MIN);
    const n2 = { ...next, state: 'review', deadline, tasks: 1 };
    return { ...outOf(n2), state: n2, humanTasks: [reviewTask(st.orderId, 1, deadline)], obligations: deadlineWakeUp(deadline) };
  }

  if (st.state !== 'review') return outOf(st);
  const deadlineMs = Date.parse(st.deadline);

  if (event.type === 'humanTask.answered') {
    const a = Date.parse(event.at ?? now);
    if (a > deadlineMs) return outOf(st);                               // late answers change nothing
    const decision = (p.answer ?? p).decision;
    if (decision === 'approve') return decide({ ...st, state: 'cleared', at: event.at }, { cancel: ['deadline'] });
    if (decision === 'reject') return decide({ ...st, state: 'cancel', at: event.at, reason: 'fraud' }, { cancel: ['deadline'] });
    return askAgain(st, now);                                           // unusable: ask again, same deadline (R2.2)
  }
  if (event.type === 'humanTask.answerRejected' || event.type === 'humanTask.withdrawn') return askAgain(st, now);
  if (event.type === 'timer.fired' && p.obligationId === 'deadline') {
    // No usable answer by the deadline: the shop accepts the risk and the order is cleared just after it (R2.2). The
    // clearing is dated at the deadline, so R3.1 and R4.1 run their windows from it, exclusive of it.
    return decide({ ...st, state: 'cleared', at: st.deadline }, null);
  }
  return outOf(st);
}

function decide(st, obligations) {
  const next = { ...st, checkInFlight: false };
  return { ...outOf(next), state: next, ...(obligations ? { obligations: { ...obligations } } : {}) };
}

function askAgain(st, now) {
  if (Date.parse(now) > Date.parse(st.deadline)) return outOf(st);      // the deadline does not move (R2.2, S3)
  const tasks = st.tasks + 1;
  const next = { ...st, tasks };
  return { ...outOf(next), state: next, humanTasks: [reviewTask(st.orderId, tasks, st.deadline)] };
}

function reviewTask(orderId, n, deadline) {
  return {
    id: `review-${n}`,
    kind: 'fraudReview',
    role: 'fraudAnalyst',
    subject: orderId,
    question: `Review order ${orderId} for fraud and answer approve or reject.`,
    answerSchema: {
      type: 'object',
      required: ['decision'],
      additionalProperties: false,
      properties: { decision: { enum: ['approve', 'reject'] } },
    },
    dueAt: deadline,
    onTimeout: 'none',
  };
}

function deadlineWakeUp(deadline) {
  // one minute after the deadline is too early for a late-delivered answer; an hour is the latest the clearing can wake,
  // as the processing it starts in the same tick must still fall inside R4.1's (deadline, +60 min]
  return { upsert: [{ id: 'deadline', kind: 'deadline', anchor: 'review', dueAt: amsIso(Date.parse(deadline) + 60 * MIN), onDue: 'deadline' }] };
}

function checkEffect(orderId) {
  return { key: 'check', system: 'fraud', op: 'check', args: { orderId } };
}

function start(input, ctx) {
  // R2.1: read the verdict once.
  if (ctx.state) return outOf(ctx.state);
  const st = { orderId: input.orderId, placedAt: input.placedAt, edition: input.edition, state: 'checking', at: null, reason: null, deadline: null, tasks: 0, checks: 1, checkInFlight: true };
  return { ...outOf(st), state: st, effects: [checkEffect(input.orderId)] };
}

function stop(input, ctx) {
  // R6.4: a cancel before clearing counts; the review is closed and a later answer changes nothing.
  const st = ctx.state;
  if (!st || st.state === 'cleared' || st.state === 'cancel') return outOf(st);
  const next = { ...st, state: 'stopped', at: input.at ?? null, reason: null };
  return { ...outOf(next), state: next, obligations: { cancel: ['deadline'] } };
}

function resume(input, ctx) {
  // §3.5: a migrated order: its verdict and open review task come from the records.
  const r = input.records?.fraud;
  if (!r) return outOf(null);
  const st = { orderId: ctx.key, placedAt: r.placedAt, edition: r.edition, state: r.state, at: r.at ?? null, reason: r.reason ?? null,
    deadline: r.deadline ?? null, tasks: r.tasks ?? 0, checkInFlight: false };
  return { ...outOf(st), state: st };
}
