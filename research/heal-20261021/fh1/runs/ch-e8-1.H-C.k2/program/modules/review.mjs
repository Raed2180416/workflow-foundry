// review (SPEC-E §4.2 R2.2, S3, S12): the fraud review of one order. The deadline is fraudReviewHours from the creation
// of the first review task. An answer counts if it carries a decision and arrives at or before the deadline; an
// unusable answer or a withdrawn or rejected task is re-asked while the deadline is open; without a usable answer the
// decision is a timeout, taken after the deadline.

const MIN = 60000;
const AMS = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Amsterdam', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const wall = t => Object.fromEntries(AMS.formatToParts(new Date(Math.floor(t / 1000) * 1000)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
const dayOf = t => { const p = wall(t); return `${p.year}-${p.month}-${p.day}`; };
const iso = t => {
  const p = wall(t);
  const t0 = Math.floor(t / 1000) * 1000;
  const off = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t0) / MIN);
  const a = Math.abs(off);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};
const ms = s => new Date(s).getTime();

const fileJson = (files, p) => {
  let v = files?.[p];
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return v ?? null;
};

function editionAt(files, t) {
  const day = dayOf(t);
  let best = null;
  for (const k of Object.keys(files ?? {})) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(k);
    const e = m ? fileJson(files, k) : null;
    if (!e || typeof e.effectiveFrom !== 'string') continue;
    const from = e.effectiveFrom.slice(0, 10);
    if (from <= day && (!best || from > best.from)) best = { dir: m[1], from };
  }
  if (!best) throw new Error('review: no rulebook edition in force');
  return best.dir;
}

const ANSWER = {
  type: 'object',
  required: ['decision'],
  properties: { decision: { enum: ['approve', 'reject'] } },
  additionalProperties: false,
};

// The review task for the current sequence number; each task id is new, the deadline is not moved.
const task = st => ({
  id: `rv${st.seq}`,
  kind: 'fraudReview',
  role: 'fraudAnalyst',
  subject: st.o,
  question: `Fraud review of order ${st.o}: approve or reject.`,
  answerSchema: ANSWER,
  dueAt: iso(st.dl + MIN),
  onTimeout: 'fraudReviewTimeout',
});

export function step(input, ctx) {
  if (input.op === 'stop') {
    const st = ctx.state;
    if (!st) return { output: null };
    st.done = st.done ?? 'stopped';
    return { output: null, state: st, obligations: { cancel: ['deadline'] } };
  }
  if (input.op !== 'open') return { output: null };
  const now = ms(ctx.now);
  const ed = editionAt(ctx.files, ms(input.p));
  const pol = fileJson(ctx.files, `rulebook/${ed}/policy.json`);
  if (!Number.isFinite(pol?.fraudReviewHours)) throw new Error('review: policy.json has no fraudReviewHours');
  const st = { o: input.orderId, at: now, dl: now + pol.fraudReviewHours * 3600000, seq: 1, done: null };
  return {
    output: { status: 'open', deadline: iso(st.dl) },
    state: st,
    humanTasks: [task(st)],
    obligations: {
      upsert: [{ id: 'deadline', kind: 'fraudReviewDeadline', anchor: iso(st.at), dueAt: iso(st.dl + MIN), onDue: 'deadline' }],
      cancel: [],
    },
  };
}

export function onEvent(ev, ctx) {
  const st = ctx.state;
  if (!st || st.done) return { output: null };
  const now = ms(ctx.now);
  const reask = () => { st.seq += 1; return { output: { status: 'reask' }, state: st, humanTasks: [task(st)] }; };
  switch (ev.type) {
    case 'humanTask.answered': {
      const a = ev.payload?.answer ?? ev.payload?.answers ?? ev.payload ?? {};
      const d = a.decision;
      if ((d === 'approve' || d === 'reject') && ms(ev.at) <= st.dl) {
        st.done = d;
        return { output: { decision: d, at: ev.at }, state: st, obligations: { cancel: ['deadline'] } };
      }
      return now <= st.dl ? reask() : { output: null };
    }
    case 'humanTask.answerRejected':
    case 'humanTask.withdrawn':
      return now <= st.dl ? reask() : { output: null };
    case 'humanTask.timeout':
    case 'timer.fired':
      if (now <= st.dl) return { output: null };   // an answer exactly at the deadline still counts
      st.done = 'timeout';
      return { output: { decision: 'timeout' }, state: st, obligations: { cancel: ['deadline'] } };
    default:
      return { output: null };
  }
}
