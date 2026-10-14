// Journal index and per-case views for E-bed oracles (BED-CONTRACT v1.1 §5.1-§5.3). Item-independent; analyst-side.
// The oracle never runs inside the host: it reads a finished (or in-progress) journal of content rows and rebuilds,
// for every truth case, what happened to it on the arm's trajectory:
//   - truth events: every inbound event of the case (world arrivals by `truth.eventCase`, counterparty events by the
//     journal's own case label, go-live migrations by the backlog binding), with the time and instance of its first
//     delivery, whatever the arm's routing;
//   - ledger rows attributed to the case (the host's `subjectCase`), joined to the emitting effect's arguments under
//     their internal names (F5 renames mapped back) and flattened per batch item, with the emitting call's time,
//     round and whether that call had received an event of the case at that instant ("knowledge", used for
//     same-instant withdrawals: a call cannot react to an event it has not been given);
//   - human tasks created about the case and their delivered events; case-ticks of instances bound to the case.
// Pure functions of (world, rows, item hooks). No host import: the oracle must not depend on the code it grades.

const ms = s => Date.parse(s);

/**
 * indexJournal(world, rows, { canonicalArgs }) → index. `rows` are journal content rows in order (control rows are
 * ignored). `canonicalArgs(system, op, args)` is the item's argument normaliser (sorting unordered lists etc.).
 */
export function indexJournal(world, rows, { canonicalArgs = (s, o, a) => a } = {}) {
  const renames = (world.faults ?? []).filter(f => f.kind === 'F5').map(f => ({ atMs: ms(f.at), system: f.system, op: f.op, from: f.params.from, to: f.params.to }));
  const backToInternal = (system, op, args, atMs) => {
    const active = renames.filter(r => r.system === system && r.op === op && r.atMs <= atMs);
    if (!active.length || !args || typeof args !== 'object') return args;
    const back = x => { if (!x || typeof x !== 'object' || Array.isArray(x)) return x; const y = { ...x }; for (const r of active) if (r.to in y && !(r.from in y)) { y[r.from] = y[r.to]; delete y[r.to]; } return y; };
    const out = back(args);
    if (Array.isArray(out.items)) out.items = out.items.map(back);
    return out;
  };
  const idx = {
    world, instances: new Map(), deliveries: [], calls: [], emissions: new Map(), ledger: [], tasks: [], taskEvents: [],
    writes: [], merges: [], closes: [], armErrors: [], cpCase: new Map(), end: null, start: null, horizonMs: ms(world.horizonEnd),
  };
  const eventCase = world.truth?.eventCase ?? {};
  let now = ms(world.t0);
  const callNow = new Map();             // instance -> the latest call record at the current wake-up
  let seq = -1;
  for (const row of rows) {
    seq += 1;
    switch (row.type) {
      case 'run.start': idx.start = row; break;
      case 'wakeup': now = ms(row.at); callNow.clear(); break;
      case 'instance.open': idx.instances.set(row.instance, { id: row.instance, binding: row.binding ?? null, startedBy: row.startedBy, openedAt: ms(row.at), subjects: [] }); break;
      case 'counterparty.event': if (row.case !== null && row.case !== undefined) idx.cpCase.set(row.event.id, row.case); break;
      case 'counterparty.step': if (row.event && row.case !== null && row.case !== undefined) idx.cpCase.set(row.event.id, row.case); break;
      case 'deliver': {
        if (!row.instance) break;                                         // sweep deliveries (no E8 sweeps)
        const ev = row.event;
        const inst = idx.instances.get(row.instance);
        let c = eventCase[ev.id] ?? idx.cpCase.get(ev.id) ?? null;
        if (c === null && ev.type === 'migration') c = inst?.binding ?? null;
        idx.deliveries.push({ seq, at: now, event: ev, instance: row.instance, round: row.round ?? 1, route: row.route ?? null, case: c,
          truth: c !== null && !['effect.result', 'timer.fired', 'sweep.wake'].includes(ev.type) && !ev.type.startsWith('humanTask.') });
        if (ev.type.startsWith('humanTask.')) idx.taskEvents.push({ seq, at: now, type: ev.type, payload: ev.payload, instance: row.instance });
        break;
      }
      case 'call': {
        if (row.kind !== 'case') break;
        const rec = { seq, at: now, callId: row.callId, instance: row.target, round: row.round, outcome: row.outcome, output: row.output ?? null, error: row.error ?? null };
        rec.events = idx.deliveries.filter(d => d.at === now && d.instance === row.target && d.round === (row.round === 3 ? 3 : 1));
        rec.knows = new Set(rec.events.filter(d => d.truth).map(d => d.case));
        idx.calls.push(rec);
        callNow.set(row.target, rec);
        const inst = idx.instances.get(row.target);
        if (inst && row.outcome === 'ok' && row.output?.decisions) inst.subjects.push({ at: now, subject: row.output.decisions.subject ?? null });
        break;
      }
      case 'effect.emit': {
        const call = row.origin?.kind === 'case' ? callNow.get(row.origin.instance) ?? null : null;
        idx.emissions.set(row.emission, { effect: row.effect, origin: row.origin, call, at: now });
        break;
      }
      case 'ledger': {
        const em = idx.emissions.get(row.emission);
        const eff = em?.effect ?? {};
        let args = backToInternal(row.system, row.op, eff.args, ms(row.at));
        let key = row.key ?? null;
        if (row.batchIndex !== undefined && row.batchIndex !== null && Array.isArray(args?.items)) {
          const item = args.items[row.batchIndex] ?? {};
          const { items, ...rest } = args;
          const { key: itemKey, ...itemArgs } = item;
          args = { ...rest, ...itemArgs };
          key = itemKey ?? key;
        }
        args = canonicalArgs(row.system, row.op, args);
        idx.ledger.push({ seq, at: ms(row.at), system: row.system, op: row.op, key, args, committed: !!row.committed, status: row.status, error: row.error ?? null,
          case: row.subjectCase ?? null, emission: row.emission, via: row.via, injected: !!row.injected, money: !!row.money,
          callAt: em?.call?.at ?? em?.at ?? ms(row.at), knows: em?.call?.knows ?? new Set(), instance: row.instance ?? null });
        break;
      }
      case 'humanTask.created': idx.tasks.push({ seq, at: now, instance: row.instance, task: row.task, case: row.case ?? null, ordinal: row.ordinal, user: row.user, steps: row.steps ?? [] }); break;
      case 'world.write': idx.writes.push({ seq, at: now, system: row.system, table: row.table, pk: row.pk, row: row.row, source: row.source }); break;
      case 'instance.merge': idx.merges.push({ seq, at: now, instance: row.instance, into: row.into, events: row.events }); break;
      case 'instance.close': idx.closes.push({ seq, at: now, instance: row.instance, reason: row.reason }); break;
      case 'arm.error': if (row.instance) idx.armErrors.push({ seq, at: now, instance: row.instance, code: row.code, binding: row.binding ?? null }); break;
      case 'run.end': idx.end = row; break;
      default: break;
    }
  }
  // Task events carry their task id; bind them to the task's case.
  const taskCase = new Map(idx.tasks.map(t => [`${t.instance}\u0000${t.task.id}`, t.case]));
  for (const e of idx.taskEvents) e.case = taskCase.get(`${e.instance}\u0000${e.payload?.taskId}`) ?? null;
  return idx;
}

/** Every truth case id (from world truth). */
export const caseIds = world => Object.keys(world.truth?.cases ?? {}).sort();

/** Instances bound to a case. */
export const boundInstances = (idx, c) => [...idx.instances.values()].filter(i => i.binding === c).map(i => i.id);

/**
 * The view of one truth case at a processing point (contract §5.2): everything journaled before the point, in journal
 * order (`seq`), so effects of one instant are seen in the order the host applied them (a charge emitted after its
 * reservation committed in the same instant sees the reservation). `seq = Infinity` takes everything up to `atMs`.
 * The arm's output at the point itself is what is being graded, so it is never in the view.
 */
export function caseView(idx, c, atMs, seq = Infinity) {
  const before = x => x.at < atMs || (x.at === atMs && x.seq < seq);
  const firstDelivery = new Map();
  for (const d of idx.deliveries) if (d.case === c && d.truth && before(d) && !firstDelivery.has(d.event.id)) firstDelivery.set(d.event.id, d);
  const events = [...firstDelivery.values()].map(d => ({ id: d.event.id, type: d.event.type, at: d.at, seq: d.seq, source: d.event.source, payload: d.event.payload, instance: d.instance, round: d.round }));
  const rows = idx.ledger.filter(r => r.case === c && before(r));
  const tasks = idx.tasks.filter(t => t.case === c && before(t));
  const taskEvents = idx.taskEvents.filter(e => e.case === c && before(e));
  return { case: c, at: atMs, seq, world: idx.world, truth: idx.world.truth.cases[c], events, rows, tasks, taskEvents };
}
