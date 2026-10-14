// P59 saga planner: reverse-order compensation over idempotent activities — authored blind for E-BED §8.1 step 1 from
// outside sources only (FROZEN-P58-P60.json lists them). Fragment (flow, task, x, S) -> {plans: [{id, status, next,
// undoOrder, waitingFor, stuck}]}.
// A solver has no effects (L0), so this card never runs a step: it replays each saga's log and returns the commands the
// envelope must issue next (L0 15 effect, 20 retry, 23 compensate), each with an idempotency key that is the same on
// every retry of the same (saga, step, action), so a re-issued command is absorbed by the participant.
// Slots: SAGAS (path; [{id, definition, log}]), VERSION (the saga definition this solver is pinned to), STEPS ([{name,
// kind, undo?}] in order: compensable* pivot? retryable*), ENTRY (fn log entry -> {step, phase, noEffect?}; phase one of
// started, completed, failed, undo-started, undone, undo-failed), KEY (fn (sagaId, step, action) -> key), COMPENSATE_FAILED,
// PARALLEL_UNDO, MAX_ATTEMPTS, MAX_SAGAS.
// Semantics: a compensable step that fails, or a pivot that fails with no effect, dooms the saga: every completed
// compensable step is undone, last completed first (Temporal Saga, Camunda 7: reverse order of completion), plus the
// failed step itself when its outcome is uncertain (COMPENSATE_FAILED 'if-uncertain': a timeout may hide a success, so
// the undo is registered before the action and the participant skips it if nothing happened). A pivot or retryable step
// that failed with an uncertain outcome is retried with the same key; past the pivot nothing is undone. Undo runs one at
// a time unless PARALLEL_UNDO. MAX_ATTEMPTS exhausted -> status 'stuck' (a person decides). An instance on another
// definition version deopts (guard definition-pinned): a saga finishes on the definition it started with. Keys are
// distinct across every saga, step and action of the run and name their saga (invariant keys-distinct; v2, see
// FROZEN-P58-P60.json amendments).
export default async function P59(flow, task, x, S) {
  const sagas = S.SAGAS(task, x);
  flow.guard('bounded', Array.isArray(sagas) && sagas.length <= S.MAX_SAGAS, { n: Array.isArray(sagas) ? sagas.length : null, max: S.MAX_SAGAS });
  flow.guard('unique-ids', sagas.every(s => s != null && s.id != null) && new Set(sagas.map(s => String(s.id))).size === sagas.length, { n: sagas.length });
  const names = S.STEPS.map(s => s.name), kindOf = Object.fromEntries(S.STEPS.map(s => [s.name, s.kind]));
  const undoOf = Object.fromEntries(S.STEPS.map(s => [s.name, s.undo ?? null]));
  const RANK = { compensable: 0, pivot: 1, retryable: 2 };
  flow.invariant('steps-well-formed', new Set(names).size === names.length && S.STEPS.every((s, i) => (i === 0 || RANK[S.STEPS[i - 1].kind] <= RANK[s.kind]) && (s.kind === 'compensable') === (typeof s.undo === 'string' && !!s.undo))
    && S.STEPS.filter(s => s.kind === 'pivot').length <= 1, { steps: S.STEPS.map(s => [s.name, s.kind, s.undo ?? null]) });
  const PHASES = ['started', 'completed', 'failed', 'undo-started', 'undone', 'undo-failed'];

  const plan = sg => {
    flow.guard('definition-pinned', sg.definition === S.VERSION, { id: sg.id, definition: sg.definition ?? null, pinned: S.VERSION });
    flow.guard('log-list', Array.isArray(sg.log), { id: sg.id });
    // Per step: forward state s (pending | running | completed | failed), tries, the log index of its outcome (at), whether
    // the failure is certain to have had no effect; undo state u (none | running | undone | failed) and its tries.
    const st = Object.fromEntries(names.map(n => [n, { s: 'pending', tries: 0, at: -1, noEffect: false, u: 'none', utries: 0 }]));
    let doomed = null;   // the step whose failure started compensation
    const dooms = n => kindOf[n] === 'compensable' || (kindOf[n] === 'pivot' && st[n].noEffect);
    const eligible = n => (kindOf[n] === 'compensable' && st[n].s === 'completed')
      || (n === doomed && kindOf[n] === 'compensable' && (S.COMPENSATE_FAILED === 'always' || (S.COMPENSATE_FAILED === 'if-uncertain' && !st[n].noEffect)));
    const undoOrder = () => names.filter(eligible).sort((a, b) => st[b].at - st[a].at);
    sg.log.forEach((raw, i) => {
      const e = S.ENTRY(raw);
      flow.guard('known-entry', e != null && names.includes(e.step) && PHASES.includes(e.phase), { id: sg.id, entry: i, step: e?.step ?? null, phase: e?.phase ?? null });
      const k = st[e.step], at = names.indexOf(e.step);
      const bad = why => flow.guard('log-consistent', false, { id: sg.id, entry: i, step: e.step, phase: e.phase, why });
      if (e.phase === 'started') {
        if (doomed) bad('a step started after compensation began');
        if (k.s === 'running' || k.s === 'completed') bad('started twice');
        if (k.s === 'failed' && dooms(e.step)) bad('a failed compensable step is undone, not retried');
        if (names.slice(0, at).some(n => st[n].s !== 'completed')) bad('started before the previous step completed');
        k.s = 'running'; k.tries++;
      } else if (e.phase === 'completed' || e.phase === 'failed') {
        if (k.s !== 'running') bad(`${e.phase} without a running attempt`);
        k.s = e.phase; k.at = i; k.noEffect = e.phase === 'failed' && e.noEffect === true;
        if (e.phase === 'failed' && dooms(e.step)) doomed = e.step;
      } else if (e.phase === 'undo-started') {
        if (!doomed || !eligible(e.step)) bad('undo of a step that is not to be compensated');
        if (k.u === 'running' || k.u === 'undone') bad('undo started twice');
        const order = undoOrder(), before = order.slice(0, order.indexOf(e.step));
        if (!S.PARALLEL_UNDO && before.some(n => st[n].u !== 'undone')) bad('undo out of reverse order');
        k.u = 'running'; k.utries++;
      } else {
        if (k.u !== 'running') bad(`${e.phase} without a running undo`);
        k.u = e.phase === 'undone' ? 'undone' : 'failed';
      }
    });
    const cmd = (action, step, attempt) => ({ action, step, call: action === 'do' ? step : undoOf[step], key: S.KEY(sg.id, step, action), attempt });
    const out = { id: sg.id, status: 'running', next: [], undoOrder: [], waitingFor: [], stuck: null };
    if (doomed) {
      const order = undoOrder(), open = order.filter(n => st[n].u !== 'undone');
      out.undoOrder = order;
      out.waitingFor = open.filter(n => st[n].u === 'running');
      const spent = open.find(n => st[n].u === 'failed' && st[n].utries >= S.MAX_ATTEMPTS);
      if (!open.length) out.status = 'compensated';
      else if (spent) { out.status = 'stuck'; out.stuck = { step: spent, action: 'undo', attempts: st[spent].utries }; }
      else {
        out.status = 'compensating';
        const ready = open.filter(n => st[n].u !== 'running');
        out.next = (S.PARALLEL_UNDO ? ready : out.waitingFor.length ? [] : ready.slice(0, 1)).map(n => cmd('undo', n, st[n].utries + 1));
      }
      // Every completed compensable step is undone exactly once, newest first.
      flow.invariant('undo-covers-completed', names.filter(n => kindOf[n] === 'compensable' && st[n].s === 'completed').every(n => order.filter(m => m === n).length === 1), { id: sg.id, order });
      flow.invariant('undo-reverse-order', order.every((n, i) => i === 0 || st[order[i - 1]].at > st[n].at), { id: sg.id, order });
    } else {
      out.waitingFor = names.filter(n => st[n].s === 'running');
      const n = names.find(m => st[m].s !== 'completed');
      if (n === undefined) out.status = 'completed';
      else if (!out.waitingFor.length) {
        if (st[n].s === 'failed' && st[n].tries >= S.MAX_ATTEMPTS) { out.status = 'stuck'; out.stuck = { step: n, action: 'do', attempts: st[n].tries }; }
        else out.next = [cmd('do', n, st[n].tries + 1)];
      }
    }
    const keysOf = id => names.flatMap(n => [S.KEY(id, n, 'do'), ...(undoOf[n] ? [S.KEY(id, n, 'undo')] : [])]);
    const keys = keysOf(sg.id);
    flow.invariant('keys-distinct', keys.every(k => typeof k === 'string' && k.length > 0) && new Set(keys).size === keys.length, { id: sg.id, keys: keys.slice(0, 4) });
    // v2: a key must name its saga. A probe saga (this id plus a suffix) gets keys of its own, so a KEY that drops or
    // truncates the saga id is refused even in a run of one saga; across the run, no two sagas share a key.
    const probe = new Set(keysOf(`${sg.id}~probe`));
    flow.invariant('keys-distinct', !keys.some(k => probe.has(k)), { id: sg.id, why: 'the key does not name the saga', keys: keys.slice(0, 2) });
    const clash = keys.find(k => owner.has(k));
    flow.invariant('keys-distinct', clash === undefined, { id: sg.id, other: owner.get(clash) ?? null, key: clash ?? null, why: 'two sagas share a key' });
    for (const k of keys) owner.set(k, sg.id);
    return out;
  };
  const owner = new Map();   // key -> the saga that owns it (v1 checked distinctness within one saga only)
  const plans = sagas.map(plan);
  flow.invariant('one-plan-per-saga', plans.length === sagas.length && plans.every((p, i) => p.id === sagas[i].id), { plans: plans.length, sagas: sagas.length });
  flow.note('statuses', countBy(plans, p => p.status));
  return { plans };
}
