// Fraud gate (SPEC-E R2): the verdict of the fraud check, and the review task with its deadline (R2.2, S3).
// Outputs one `outcome` for the parent: cleared | rejected (with the time it is decided and the reason).

const ms = iso => Date.parse(iso);
const offOf = iso => { const m = /(Z|[+-]\d\d:\d\d)$/.exec(iso); return !m ? '+01:00' : m[1] === 'Z' ? '+00:00' : m[1]; };
const addMin = (iso, m) => {
  const off = offOf(iso), [h, mm] = off.slice(1).split(':').map(Number);
  const shift = (off[0] === '-' ? -1 : 1) * (h * 60 + mm);
  return new Date(Date.parse(iso) + m * 60000 + shift * 60000).toISOString().slice(0, 19) + off;
};
const deepFind = (v, key, d = 0) => {
  if (!v || typeof v !== 'object' || d > 8) return undefined;
  if (!Array.isArray(v) && key in v) return v[key];
  for (const x of Object.values(v)) { const r = deepFind(x, key, d + 1); if (r !== undefined) return r; }
  return undefined;
};
const fileJson = (files, p) => {
  let v = files?.[p];
  if (v === undefined) v = p.split('/').reduce((o, k) => (o ? o[k] : undefined), files);
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  return v ?? null;
};

const hours = (ctx, ed) => {
  const h = deepFind(fileJson(ctx.files, `rulebook/${ed}/policy.json`), 'fraudReviewHours');
  if (typeof h !== 'number') throw new Error(`rulebook/${ed}/policy.json has no fraudReviewHours`);
  return h;
};

// A review task: the first one is created at the verdict; a new one (new id) replaces an unusable answer.
const askTask = (S, ctx) => {
  S.rn += 1;
  return {
    id: `review-${S.rn}`, kind: 'fraudReview', role: 'fraudAnalyst', subject: ctx.key,
    question: `Fraud review of order ${ctx.key}: approve or reject?`,
    answerSchema: { type: 'object', required: ['decision'], properties: { decision: { enum: ['approve', 'reject'] } }, additionalProperties: false },
    dueAt: S.dr, onTimeout: 'fraudReviewTimeout',
  };
};

export function step(input, ctx) {
  const S = ctx.state ?? { ph: 'new', dr: null, rn: 0 };
  if (input.op === 'start') {
    if (S.ph !== 'new') return { output: null, state: S };
    return {
      output: null,
      state: { ...S, ph: 'check' },
      effects: [{ system: 'fraud', op: 'check', args: { orderId: ctx.key } }],
    };
  }
  if (input.op === 'verdict') {
    if (S.ph !== 'check') return { output: null, state: S };
    if (input.verdict === 'pass') return { output: { outcome: { kind: 'cleared', at: input.at } }, state: { ...S, ph: 'done' } };
    if (input.verdict === 'reject') return { output: { outcome: { kind: 'rejected', at: input.at, reason: 'fraud' } }, state: { ...S, ph: 'done' } };
    // review: the analyst has fraudReviewHours from the creation of this (first) task
    const dr = addMin(ctx.now, hours(ctx, input.edition) * 60);
    const S2 = { ...S, ph: 'review', dr, rn: 0 };
    const task = askTask(S2, ctx);
    return {
      output: { outcome: null, review: { dueAt: dr } },
      state: S2,
      humanTasks: [task],
      // the timer is due just after the deadline: the order is cleared then, and nothing follows from it at the deadline (R2.2)
      obligations: { upsert: [{ id: 'review-deadline', kind: 'fraudReviewDeadline', anchor: dr, dueAt: addMin(dr, 1), onDue: 'review-deadline' }] },
    };
  }
  throw new Error(`fraud: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  const S = ctx.state;
  if (!S || S.ph !== 'review') return { output: { outcome: null }, state: S };
  const before = ms(S.dr);
  if (event.type === 'humanTask.answered') {
    const dec = deepFind(event.payload, 'decision');
    const usable = dec === 'approve' || dec === 'reject';
    if (usable && ms(event.at) <= before) {
      const at = event.at;
      const outcome = dec === 'approve' ? { kind: 'cleared', at } : { kind: 'rejected', at, reason: 'fraud' };
      return { output: { outcome }, state: { ...S, ph: 'done' }, obligations: { cancel: ['review-deadline'] } };
    }
    // an unusable answer (no decision) before the deadline: ask again, the deadline does not move
    if (!usable && ms(ctx.now) < before) return { output: { outcome: null }, state: S, humanTasks: [askTask(S, ctx)] };
    return { output: { outcome: null }, state: S };
  }
  if (event.type === 'humanTask.answerRejected' || event.type === 'humanTask.withdrawn') {
    if (ms(ctx.now) < before) return { output: { outcome: null }, state: S, humanTasks: [askTask(S, ctx)] };
    return { output: { outcome: null }, state: S };
  }
  if (event.type === 'timer.fired' && event.payload?.obligationId === 'review-deadline') {
    // no usable answer by the deadline: the shop accepts the risk and the order is cleared just after it (R2.2)
    return {
      output: { outcome: { kind: 'cleared', at: ctx.now } },
      state: { ...S, ph: 'done' },
    };
  }
  // humanTask.timeout (the task's own due time) and delegation change nothing: the review-deadline timer decides
  return { output: { outcome: null }, state: S };
}
