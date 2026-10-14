// Journal index and per-case views for E-bed oracles (BED-CONTRACT v1.1 §5.1-§5.3). Item-independent; analyst-side.
// The oracle never runs inside the host: it reads a journal of content rows and rebuilds, for every truth case, what
// happened to it on the arm's trajectory:
//   - truth events: every inbound event of the case (world arrivals by `truth.eventCase`, counterparty events by the
//     journal's own case label, go-live migrations by the backlog binding), with the time and instance of its first
//     delivery, whatever the arm's routing;
//   - ledger rows attributed to the case (the host's `subjectCase`), joined to the emitting effect's arguments under
//     their internal names (F5 renames mapped back) and flattened per batch item, with the emitting call's time and
//     whether that call had been given an event of the case at that instant ("knowledge", for same-instant
//     withdrawals: a call cannot react to an event it has not been given);
//   - human tasks created about the case and their delivered events; case-ticks of instances bound to the case.
// The index is incremental (rows are added in journal order) and can take tentative rows (a wake-up still staged) that
// are rolled back, so an analyst-side reference policy can read the live journal in linear total time. Pure functions
// of (world, rows, item hooks). No host import: the oracle must not depend on the code it grades.

const ms = s => Date.parse(s);
const NOT_TRUTH = new Set(['effect.result', 'timer.fired', 'sweep.wake']);

export class JournalIndex {
  constructor(world, { canonicalArgs = (s, o, a) => a } = {}) {
    this.world = world;
    this.canonicalArgs = canonicalArgs;
    this.renames = (world.faults ?? []).filter(f => f.kind === 'F5').map(f => ({ atMs: ms(f.at), system: f.system, op: f.op, from: f.params.from, to: f.params.to }));
    this.eventCase = world.truth?.eventCase ?? {};
    this.horizonMs = ms(world.horizonEnd);
    this.instances = new Map(); this.emissions = new Map(); this.cpCase = new Map(); this.taskCase = new Map();
    this.deliveries = []; this.calls = []; this.ledger = []; this.tasks = []; this.taskEvents = []; this.writes = [];
    this.merges = []; this.closes = []; this.armErrors = [];
    this.byCase = new Map();
    this.start = null; this.end = null;
    this.now = ms(world.t0);
    this.callNow = new Map();
    this.n = 0;
    this.undo = null;                    // a log of undo steps while rows are tentative
  }

  // Mutation helpers that log their undo while tentative.
  #push(arr, x) { arr.push(x); if (this.undo) this.undo.push(() => arr.pop()); }
  #set(map, k, v) { const had = map.has(k), old = map.get(k); map.set(k, v); if (this.undo) this.undo.push(() => (had ? map.set(k, old) : map.delete(k))); }
  #field(obj, k, v) { const old = obj[k]; obj[k] = v; if (this.undo) this.undo.push(() => { obj[k] = old; }); }
  #bucket(c) {
    let b = this.byCase.get(c);
    if (!b) { b = { deliveries: [], ledger: [], tasks: [], taskEvents: [], calls: [] }; this.#set(this.byCase, c, b); }
    return b;
  }

  /** Rows added after begin() are tentative until rollback() removes them (or commitTentative() keeps them). */
  begin() { if (this.undo) throw new Error('already tentative'); this.undo = []; }
  rollback() { const u = this.undo; this.undo = null; for (let i = u.length - 1; i >= 0; i--) u[i](); }

  #toInternal(system, op, args, atMs) {
    const active = this.renames.filter(r => r.system === system && r.op === op && r.atMs <= atMs);
    if (!active.length || !args || typeof args !== 'object') return args;
    const back = x => { if (!x || typeof x !== 'object' || Array.isArray(x)) return x; const y = { ...x }; for (const r of active) if (r.to in y && !(r.from in y)) { y[r.from] = y[r.to]; delete y[r.to]; } return y; };
    const out = back(args);
    if (Array.isArray(out.items)) out.items = out.items.map(back);
    return out;
  }

  add(row) {
    const seq = this.n;
    this.#field(this, 'n', seq + 1);
    switch (row.type) {
      case 'run.start': this.#field(this, 'start', row); break;
      case 'wakeup': {
        this.#field(this, 'now', ms(row.at));
        const old = this.callNow;
        this.#field(this, 'callNow', new Map());
        void old;
        break;
      }
      case 'instance.open': this.#set(this.instances, row.instance, { id: row.instance, binding: row.binding ?? null, startedBy: row.startedBy, openedAt: ms(row.at), subjects: [] }); break;
      case 'counterparty.event': if (row.case !== null && row.case !== undefined) this.#set(this.cpCase, row.event.id, row.case); break;
      case 'counterparty.step': if (row.event && row.case !== null && row.case !== undefined) this.#set(this.cpCase, row.event.id, row.case); break;
      case 'deliver': {
        if (!row.instance) break;
        const ev = row.event;
        const inst = this.instances.get(row.instance);
        let c = this.eventCase[ev.id] ?? this.cpCase.get(ev.id) ?? null;
        if (c === null && ev.type === 'migration') c = inst?.binding ?? null;
        const task = ev.type.startsWith('humanTask.');
        const d = { seq, at: this.now, event: ev, instance: row.instance, round: row.round ?? 1, route: row.route ?? null, case: c, truth: c !== null && !NOT_TRUTH.has(ev.type) && !task };
        this.#push(this.deliveries, d);
        if (d.truth) this.#push(this.#bucket(c).deliveries, d);
        if (task) {
          const tc = this.taskCase.get(`${row.instance}\u0000${ev.payload?.taskId}`) ?? null;
          const e = { seq, at: this.now, type: ev.type, payload: ev.payload, instance: row.instance, case: tc };
          this.#push(this.taskEvents, e);
          if (tc !== null) this.#push(this.#bucket(tc).taskEvents, e);
        }
        break;
      }
      case 'call': {
        if (row.kind !== 'case') break;
        const rec = { seq, at: this.now, callId: row.callId, instance: row.target, round: row.round, outcome: row.outcome, output: row.output ?? null, error: row.error ?? null };
        const round = row.round === 3 ? 3 : 1;
        rec.events = [];
        for (let i = this.deliveries.length - 1; i >= 0 && this.deliveries[i].at === this.now; i--) {
          const d = this.deliveries[i];
          if (d.instance === row.target && d.round === round) rec.events.unshift(d);
        }
        rec.knows = new Set(rec.events.filter(d => d.truth).map(d => d.case));
        this.#push(this.calls, rec);
        this.#set(this.callNow, row.target, rec);
        const inst = this.instances.get(row.target);
        if (inst?.binding !== null && inst?.binding !== undefined) this.#push(this.#bucket(inst.binding).calls, rec);
        if (inst && row.outcome === 'ok' && row.output?.decisions) this.#push(inst.subjects, { at: this.now, subject: row.output.decisions.subject ?? null });
        break;
      }
      case 'effect.emit': {
        const call = row.origin?.kind === 'case' ? this.callNow.get(row.origin.instance) ?? null : null;
        this.#set(this.emissions, row.emission, { effect: row.effect, origin: row.origin, call, at: this.now });
        break;
      }
      case 'ledger': {
        const em = this.emissions.get(row.emission);
        const eff = em?.effect ?? {};
        let args = this.#toInternal(row.system, row.op, eff.args, ms(row.at));
        let key = row.key ?? null;
        if (row.batchIndex !== undefined && row.batchIndex !== null && Array.isArray(args?.items)) {
          const item = args.items[row.batchIndex] ?? {};
          const { items, ...rest } = args;
          const { key: itemKey, ...itemArgs } = item;
          args = { ...rest, ...itemArgs };
          key = itemKey ?? key;
        }
        args = this.canonicalArgs(row.system, row.op, args);
        const r = { seq, at: ms(row.at), system: row.system, op: row.op, key, args, committed: !!row.committed, status: row.status, error: row.error ?? null,
          case: row.subjectCase ?? null, emission: row.emission, via: row.via, injected: !!row.injected, money: !!row.money,
          callAt: em?.call?.at ?? em?.at ?? ms(row.at), knows: em?.call?.knows ?? new Set(), instance: row.instance ?? null };
        this.#push(this.ledger, r);
        if (r.case !== null) this.#push(this.#bucket(r.case).ledger, r);
        break;
      }
      case 'humanTask.created': {
        const t = { seq, at: this.now, instance: row.instance, task: row.task, case: row.case ?? null, ordinal: row.ordinal, user: row.user, steps: row.steps ?? [] };
        this.#push(this.tasks, t);
        this.#set(this.taskCase, `${row.instance}\u0000${row.task.id}`, t.case);
        if (t.case !== null) this.#push(this.#bucket(t.case).tasks, t);
        break;
      }
      case 'world.write': this.#push(this.writes, { seq, at: this.now, system: row.system, table: row.table, pk: row.pk, row: row.row, source: row.source }); break;
      case 'instance.merge': this.#push(this.merges, { seq, at: this.now, instance: row.instance, into: row.into, events: row.events }); break;
      case 'instance.close': this.#push(this.closes, { seq, at: this.now, instance: row.instance, reason: row.reason }); break;
      case 'arm.error': if (row.instance) this.#push(this.armErrors, { seq, at: this.now, instance: row.instance, code: row.code, binding: row.binding ?? null }); break;
      case 'run.end': this.#field(this, 'end', row); break;
      default: break;
    }
    return this;
  }

  addAll(rows) { for (const r of rows) this.add(r); return this; }
  bucket(c) { return this.byCase.get(c) ?? { deliveries: [], ledger: [], tasks: [], taskEvents: [], calls: [] }; }
}

/** indexJournal(world, rows, { canonicalArgs }) → a JournalIndex over `rows` (control rows are ignored). */
export function indexJournal(world, rows, opts = {}) { return new JournalIndex(world, opts).addAll(rows); }

/** Every truth case id (from world truth). */
export const caseIds = world => Object.keys(world.truth?.cases ?? {}).sort();

/**
 * The view of one truth case at a processing point (contract §5.2): everything journaled before the point, in journal
 * order (`seq`), so effects of one instant are seen in the order the host applied them (a charge emitted after its
 * reservation committed in the same instant sees the reservation). `seq = Infinity` takes everything up to `atMs`.
 * The arm's output at the point itself is what is being graded, so it is never in the view.
 */
export function caseView(idx, c, atMs, seq = Infinity) {
  const before = x => x.at < atMs || (x.at === atMs && x.seq < seq);
  const b = idx.bucket(c);
  const firstDelivery = new Map();
  for (const d of b.deliveries) if (before(d) && !firstDelivery.has(d.event.id)) firstDelivery.set(d.event.id, d);
  const events = [...firstDelivery.values()].map(d => ({ id: d.event.id, type: d.event.type, at: d.at, seq: d.seq, source: d.event.source, payload: d.event.payload, instance: d.instance, round: d.round }));
  const rows = b.ledger.filter(before);
  const tasks = b.tasks.filter(before);
  const taskEvents = b.taskEvents.filter(before);
  return { case: c, at: atMs, seq, world: idx.world, truth: idx.world.truth.cases[c], events, rows, tasks, taskEvents };
}
