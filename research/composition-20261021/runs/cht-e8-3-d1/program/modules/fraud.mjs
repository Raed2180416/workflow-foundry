// Module fraud, key: the order id. Owns R2.1, R2.2, S3 and 3.4 (DECOMPOSITION 4.3).
// The review deadline is fraudReviewHours from the creation of the first review task and never moves (R2.2, S3).
// An answer counts at its own time when it is at or before the deadline and carries a decision (R2.2); the `late`
// flag does not decide. The no-answer clearing is at deadline + 1 min, so an answer at the deadline still counts.

const MIN = 60000;

const ANSWER_SCHEMA = {
  type: 'object',
  required: ['decision'],
  properties: { decision: { enum: ['approve', 'reject'] } },
};

export function step(input, ctx) {
  const s = ctx.state ?? fresh();
  if (input.op === 'start') {
    s.placedAt = input.placedAt;
    s.edition = input.edition;
    s.st = 'checking';
    return { output: outOf(s), state: s, effects: [checkEffect(ctx)] };
  }
  let obligations;
  if (input.op === 'stop' && (s.st === 'checking' || s.st === 'review')) {
    s.st = 'stopped';
    obligations = { cancel: ['deadline'] };
  }
  return { output: outOf(s), state: s, obligations };
}

export function onEvent(event, ctx) {
  const s = ctx.state ?? fresh();
  const p = event.payload ?? {};
  const effects = [];
  const humanTasks = [];
  let obligations;
  if (event.type === 'effect.result' && p.key === 'check' && s.st === 'checking') {
    if (p.status !== 'ok') {
      effects.push(checkEffect(ctx));
    } else {
      const verdict = (p.result ?? p.data ?? p).verdict ?? p.verdict;
      if (verdict === 'pass') {
        s.st = 'cleared';
        s.at = s.placedAt;
      } else if (verdict === 'reject') {
        s.st = 'cancel';
        s.reason = 'fraud';
        s.at = s.placedAt;
      } else if (verdict === 'review') {
        const hours = Number(deep(J(ctx.files, `rulebook/${s.edition}/policy.json`), 'fraudReviewHours'));
        s.deadline = plusMin(ctx.now, hours * 60);
        s.st = 'review';
        humanTasks.push(makeTask(s, ctx));
        obligations = { upsert: [{ id: 'deadline', kind: 'review-deadline', anchor: ctx.now, dueAt: plusMin(s.deadline, 1), onDue: 'deadline' }] };
      } else {
        effects.push(checkEffect(ctx));
      }
    }
  } else if (event.type === 'humanTask.answered' && s.st === 'review' && isReviewTask(p.taskId)) {
    if (Date.parse(event.at) <= Date.parse(s.deadline)) {
      const a = p.answer ?? p.value ?? p.response ?? p;
      const decision = a && typeof a === 'object' ? a.decision : undefined;
      if (decision === 'approve' || decision === 'reject') {
        s.st = decision === 'approve' ? 'cleared' : 'cancel';
        if (decision === 'reject') s.reason = 'fraud';
        s.at = event.at;
        obligations = { cancel: ['deadline'] };
      } else {
        humanTasks.push(makeTask(s, ctx));
      }
    }
  } else if ((event.type === 'humanTask.answerRejected' || event.type === 'humanTask.withdrawn') && s.st === 'review') {
    if (Date.parse(event.at) <= Date.parse(s.deadline)) humanTasks.push(makeTask(s, ctx));
  } else if (event.type === 'timer.fired' && s.st === 'review') {
    // R2.2: no usable answer by the deadline: the shop accepts the risk and the order is cleared at the wake-up (after the deadline).
    s.st = 'cleared';
    s.at = event.at;
  }
  return { output: outOf(s), state: s, effects, humanTasks, obligations };
}

function checkEffect(ctx) {
  return { key: 'check', system: 'fraud', op: 'check', args: { orderId: ctx.key } };
}
function makeTask(s, ctx) {
  s.n = (s.n ?? 0) + 1;
  return {
    id: `review-${s.n}`,
    kind: 'fraudReview',
    role: 'fraudAnalyst',
    subject: ctx.key,
    question: `Approve or reject order ${ctx.key} (fraud review).`,
    answerSchema: ANSWER_SCHEMA,
    dueAt: s.deadline,
    onTimeout: 'review-timeout',
  };
}

function isReviewTask(id) {
  return typeof id === 'string' && id.startsWith('review-');
}

function fresh() {
  return { st: 'idle', placedAt: null, edition: null, deadline: null, n: 0, at: null, reason: null };
}

function outOf(s) {
  return { state: s.st, at: s.at ?? null, reason: s.reason ?? null, busy: s.st === 'checking' };
}

function plusMin(iso, m) {
  const o = offOf(iso);
  const local = new Date(Date.parse(iso) + (m + o) * MIN).toISOString().slice(0, 19);
  const a = Math.abs(o);
  return `${local}${o < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

function offOf(iso) {
  const m = /([+-])(\d\d):(\d\d)$/.exec(iso);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

function J(files, p) {
  let v = files ? files[p] : undefined;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = null; } }
  return v === undefined ? null : v;
}

function deep(x, name, d = 0) {
  if (x === null || typeof x !== 'object' || d > 4) return undefined;
  if (Object.prototype.hasOwnProperty.call(x, name)) return x[name];
  for (const k of Object.keys(x)) { const r = deep(x[k], name, d + 1); if (r !== undefined) return r; }
  return undefined;
}
