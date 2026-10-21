// The scripted composed reference (research/composition-20261021/HARNESS.md §5). $0, no model, analyst side.
// The E8 reference policy (beds/ebed/oracle/policy.mjs referenceArm: at every case-tick, emit every required logical
// effect of the current expectation at its window's earliest or latest, deterministic keys = lids) re-expressed as a
// PARENT plus SUB-WORKFLOWS under the composition runtime (runtime.mjs), each sub-workflow owning one family of logical
// effects and the timing of its own emissions:
//   parent             case binding, merge / close, the expectation, the wake-up (it emits nothing itself)
//   intake       (O)   create:O                                  orders.create                       R1
//   fraud        (O)   the review task                           humanTask fraudReview               R2
//   order        (O)   ost:O:*                                   orders.setStatus (order)            R3.1, R3.2, R4.1, R4.5, R6
//   saga         (F)   rsv:F:*, chg:F, shp:F, fst:F:processing|dispatched|completed                 R4.1, R4.2, R4.4
//   compensation (F)   csh:F, rf:F, rel:F:*, fst:F:failed|cancelled                                 R5, R6.2, R3.2
//   notify       (O)   ntf:*                                     notify.send                         §4.8
// O = one instance per order, F = one instance per fulfilment. Like the reference policy it reads the host's journal
// and world truth (it is a harness-validation arm, never an arm under test), so it runs in process (trusted realm);
// the runtime and its enforcement are exactly those of a bundled builder program. Variants (mis-composed on purpose)
// show which signal catches which mistake (HARNESS.md §5.2).
import { JournalIndex, caseView } from '../../beds/ebed/oracle/view.mjs';
import { oracleItem as E8_ITEM } from '../../beds/ebed/e8/index.mjs';
import { canonical } from '../../beds/lib/canonical.mjs';
import { createComposedSolver, kindsOfE8 } from './runtime.mjs';

const MIN = 60_000;
const LATE_SLACK = 10 * MIN;
const argsMatch = (match, args) => Object.keys(match ?? {}).every(k => args && Object.hasOwn(args, k) && canonical(args[k]) === canonical(match[k]));
const iso = (m, off) => { const d = new Date(m + off * MIN); return `${d.toISOString().slice(0, 19)}${off >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`; };
const offsetOf = s => { const m = /([+-])(\d\d):(\d\d)$/.exec(s); return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0; };
function currentNames(world, system, op, args, atMs) {
  const renames = (world.faults ?? []).filter(f => f.kind === 'F5' && f.system === system && f.op === op && Date.parse(f.at) <= atMs);
  if (!renames.length) return args;
  const out = { ...args };
  for (const r of renames) if (r.params.from in out) { out[r.params.to] = out[r.params.from]; delete out[r.params.from]; }
  return out;
}

const LIDS = { input: { type: 'object', required: ['lids', 'done', 'emitted'], properties: { lids: { type: 'array' }, done: { type: 'array', items: { type: 'string' } }, emitted: { type: 'array', items: { type: 'string' } }, subject: { type: ['string', 'null'] } } },
  output: { type: 'object', required: ['emitted', 'future'], additionalProperties: false, properties: { emitted: { type: 'array', items: { type: 'string' } }, future: { type: 'array', items: { type: 'number' } } } } };
const TASKS = { input: { type: 'object', required: ['tasks', 'made'], properties: { tasks: { type: 'array' }, made: { type: 'array' }, subject: { type: 'string' } } },
  output: { type: 'object', required: ['created', 'future'], properties: { created: { type: 'integer' }, future: { type: 'array', items: { type: 'number' } } } } };

/** The manifest of the composed reference (the declarations its modules are held to). */
export const REFERENCE_MANIFEST = Object.freeze({
  version: 1,
  parent: { file: 'parent.mjs', calls: ['intake', 'fraud', 'order', 'saga', 'compensation', 'notify'], effects: [] },
  modules: {
    intake: { file: 'modules/intake.mjs', purpose: 'record the order', rules: ['R1'], ...LIDS, effects: ['orders.create'] },
    fraud: { file: 'modules/fraud.mjs', purpose: 'fraud review task', rules: ['R2'], ...TASKS, effects: [], humanTasks: ['fraudReview'] },
    order: { file: 'modules/order.mjs', purpose: 'order lifecycle statuses', rules: ['R3', 'R4.1', 'R4.5', 'R6'], ...LIDS, effects: ['orders.setStatus:order'] },
    saga: { file: 'modules/saga.mjs', purpose: 'per-fulfilment forward saga and tracking', rules: ['R4.1', 'R4.2', 'R4.4'], ...LIDS,
      effects: ['inventory.reserve', 'billing.charge', 'carrier.create', 'orders.setStatus:fulfilment:processing', 'orders.setStatus:fulfilment:dispatched', 'orders.setStatus:fulfilment:completed'] },
    compensation: { file: 'modules/compensation.mjs', purpose: 'per-fulfilment compensation and its end status', rules: ['R5', 'R6.2', 'R3.2'], ...LIDS,
      effects: ['carrier.cancel', 'billing.refund', 'inventory.release', 'orders.setStatus:fulfilment:failed', 'orders.setStatus:fulfilment:cancelled'] },
    notify: { file: 'modules/notify.mjs', purpose: 'customer notifications', rules: ['§4.8'], ...LIDS, effects: ['notify.send'] },
  },
});

/** Which module owns a lid (by its family). */
export function ownerOfLid(lid) {
  const [kind, , status] = lid.split(':');
  if (kind === 'create') return 'intake';
  if (kind === 'ost') return 'order';
  if (kind === 'ntf') return 'notify';
  if (['rsv', 'chg', 'shp'].includes(kind)) return 'saga';
  if (['csh', 'rf', 'rel'].includes(kind)) return 'compensation';
  if (kind === 'fst') return ['failed', 'cancelled'].includes(lid.split(':').at(-1)) ? 'compensation' : 'saga';
  void status;
  return null;
}
const fulfilmentOfLid = lid => { const p = lid.split(':'); return ['rsv', 'chg', 'shp', 'csh', 'rf', 'rel', 'fst'].includes(p[0]) ? p[1] : null; };

/**
 * composedReference({ world, timing, journal, item, variant, mode }) → arm { id, tick } for the host. `journal()` returns
 * { committed, staged } (the host's journal, as runReference passes it). Variants (mis-composed on purpose):
 *   'payment-compensates'  the saga (payment) module refunds a failed or cancelled fulfilment itself; the compensation
 *                          module is never called, so shipment cancels, releases and end statuses are lost (declared:
 *                          interface-honest, a business-capability mistake)
 *   'undeclared-write'     the notify module sets the order `cancelled` itself when it sends order-cancelled (undeclared:
 *                          an interface mistake; the order module leaves that status to it)
 *   'parent-direct'        the parent books shipments itself, bypassing the saga module (an undeclared parent effect)
 *   'call-outside-graph'   the notify module calls the compensation module (not in its declared calls)
 */
export function composedReference({ world, timing = 'earliest', journal, item = E8_ITEM, variant = null, mode = 'strict', id = null }) {
  const off = offsetOf(world.t0);
  const idx = new JournalIndex(world, { canonicalArgs: item.canonicalArgs });
  let fed = 0;
  const due0 = w => (timing === 'earliest' ? w.earliest : Math.max(w.earliest, w.latest - LATE_SLACK));

  /** The emission logic of one lid family (the reference policy's, per module). */
  const emitter = (who, { refundOnly = false } = {}) => ({
    step(input, ctx) {
      const now = Date.parse(ctx.now);
      const done = new Set(input.done), emitted = new Set(input.emitted);
      const out = { emitted: [], future: [] };
      const effects = [];
      const groups = new Map();
      for (const e of input.lids) {
        if (done.has(e.lid)) continue;
        const due = due0(e.window);
        if (due > now) { out.future.push(due); continue; }
        if (ctx.status(e.system, e.lid) === 'pending') continue;
        const deps = (e.after ?? []).filter(p => !done.has(p));
        if (deps.length > 1 || (deps.length === 1 && !emitted.has(deps[0]))) continue;
        if (refundOnly && !(e.system === 'billing' && e.op === 'refund')) continue;
        const b = item.batch?.[`${e.system}.${e.op}`];
        if (b) {
          const g = b.group(e);
          let grp = groups.get(g);
          if (!grp) { grp = { system: e.system, op: e.op, args: { ...b.envelope(e), items: [] }, ...(deps.length ? { after: deps[0] } : {}) }; groups.set(g, grp); effects.push(grp); }
          else if ((grp.after ?? null) !== (deps[0] ?? null)) continue;
          grp.args.items.push({ key: e.lid, ...b.item(e) });
        } else {
          const args = item.fullArgs ? item.fullArgs(e, { lidRef: e.lid }) : e.args;
          effects.push({ key: e.lid, system: e.system, op: e.op, args, ...(deps.length ? { after: deps[0] } : {}) });
          emitted.add(e.lid); out.emitted.push(e.lid);
        }
      }
      for (const x of effects) x.args = currentNames(world, x.system, x.op, x.args, now);
      // Variant 'undeclared-write': the notify module also writes the order's cancelled status (not declared).
      if (variant === 'undeclared-write' && who === 'notify') {
        for (const x of [...effects]) if (x.args.template === 'order-cancelled') effects.push({ key: `ost:${input.subject}:cancelled`, system: 'orders', op: 'setStatus', args: { orderId: input.subject, fulfilmentId: null, status: 'cancelled' } });
      }
      if (variant === 'call-outside-graph' && who === 'notify' && effects.some(x => x.args.template === 'order-cancelled')) {
        try { ctx.call('compensation', `${input.subject}-F1`, { lids: [], done: [], emitted: [] }); } catch { /* refused in strict mode: recorded */ }
      }
      return { output: out, effects };
    },
  });

  const modules = {
    intake: emitter('intake'), order: emitter('order'), saga: emitter('saga'), compensation: emitter('compensation'), notify: emitter('notify'),
    fraud: {
      step(input, ctx) {
        const now = Date.parse(ctx.now);
        const tasks = [], future = [];
        for (const tk of input.tasks) {
          const due = due0(tk.window);
          if (due > now) { future.push(due); continue; }
          if (input.made.some(id => id.startsWith(`${tk.lid}#`))) continue;
          tasks.push(item.taskSpec(tk, { now, subject: input.subject, iso: m => iso(m, off) }));
        }
        return { output: { created: tasks.length, future }, humanTasks: tasks };
      },
    },
  };
  if (variant === 'payment-compensates') {
    // The payment step's module undoes its own charge (refund) and nothing else of the fulfilment.
    const fwd = modules.saga;
    const refunder = emitter('saga', { refundOnly: true });
    modules.saga = { step(input, ctx) {
      const a = fwd.step({ ...input, lids: input.lids.filter(e => !e.lid.startsWith('rf:')) }, ctx);
      const b = refunder.step({ ...input, lids: input.lids.filter(e => e.lid.startsWith('rf:')) }, ctx);
      return { output: { emitted: [...a.output.emitted, ...b.output.emitted], future: [...a.output.future, ...b.output.future] }, effects: [...a.effects, ...b.effects] };
    } };
  }

  const parent = {
    tick(input, ctx) {
      const now = Date.parse(input.now);
      const inst = idx.instances.get(input.instance);
      const c = inst?.binding ?? null;
      if (c === null) return { decisions: { subject: null }, close: true, state: null };
      const view = caseView(idx, c, now, Infinity);
      const E = item.referenceTransition(world, view);
      const subject = E.decisions.graded.subject ?? null;
      if (inst.startedBy?.kind === 'event' && input.state === null && subject !== null) {
        const other = ctx.instances({ subject }).find(r => r.instance !== input.instance);
        if (other) return { decisions: { ...E.decisions.graded }, merge: { into: other.instance }, state: null };
      }
      const bucket = idx.bucket(c);
      const committedRows = bucket.ledger.filter(r => r.committed);
      const done = E.effects.required.filter(e => committedRows.some(r => r.system === e.system && r.op === e.op && argsMatch(e.match, r.args))).map(e => e.lid);
      const emitted = [];
      const future = [];
      const lean = e => ({ lid: e.lid, system: e.system, op: e.op, args: e.args, match: e.match, window: e.window, ...(e.after ? { after: e.after } : {}) });
      const call = (mod, key, lids) => {
        if (!lids.length) return;
        if (variant === 'payment-compensates' && mod === 'compensation') {
          // The payment module took over the refund; nobody does the rest of the compensation.
          return;
        }
        const out = ctx.call(mod, key, { lids: lids.map(lean), done, emitted: [...emitted], subject });
        emitted.push(...out.emitted); future.push(...out.future);
      };
      const required = E.effects.required;
      const fam = m => required.filter(e => ownerOfLid(e.lid) === m);
      call('intake', subject, fam('intake'));
      if (E.humanTasks.required.length) {
        const r = ctx.call('fraud', subject, { tasks: E.humanTasks.required.map(t => ({ ...t })), made: bucket.tasks.map(t => t.task.id.replace(/^[^/]+\/[^/]+\//, '')), subject });   // the runtime namespaces task ids
        future.push(...r.future);
        if (r.created) future.push(now + MIN);
      }
      // 'undeclared-write': the order module leaves the cancelled status to the notify module.
      call('order', subject, variant === 'undeclared-write' ? fam('order').filter(e => !e.lid.endsWith(':cancelled')) : fam('order'));
      const fs = [...new Set(required.map(e => fulfilmentOfLid(e.lid)).filter(Boolean))].sort();
      for (const F of fs) call('saga', F, fam('saga').filter(e => fulfilmentOfLid(e.lid) === F));
      for (const F of fs) {
        const lids = fam('compensation').filter(e => fulfilmentOfLid(e.lid) === F);
        if (variant === 'payment-compensates') call('saga', F, lids.filter(e => e.lid.startsWith('rf:')));
        else call('compensation', F, lids);
      }
      call('notify', subject, fam('notify'));
      const effects = [];
      if (variant === 'parent-direct') {
        // The parent books ready shipments itself (the saga module would have); an undeclared parent effect.
        for (const e of fam('saga')) if (e.lid.startsWith('shp:') && !done.includes(e.lid) && due0(e.window) <= now && e.after?.every(p => done.includes(p)) && ctx.status('carrier', e.lid) !== 'pending') {
          effects.push({ key: e.lid, system: 'carrier', op: 'create', args: item.fullArgs(e, { lidRef: e.lid }) });
        }
      }
      const fut = future.filter(m => m > now);
      const obligations = fut.length ? { upsert: [{ id: 'wake', kind: 'window', anchor: null, dueAt: iso(Math.min(...fut), off), onDue: null }] } : undefined;
      const todo = required.filter(e => !done.includes(e.lid));
      const out = { decisions: { ...E.decisions.graded }, state: { c }, effects, ...(obligations ? { obligations } : {}) };
      if ((E.terminal && !todo.length && !emitted.length) || subject === null) out.close = true;
      return out;
    },
  };
  // In 'parent-direct', the saga module must not book the shipments the parent books.
  if (variant === 'parent-direct') {
    const inner = modules.saga;
    modules.saga = { step(input, ctx) { return inner.step({ ...input, lids: input.lids.filter(e => !e.lid.startsWith('shp:')) }, ctx); } };
  }
  const manifest = manifestFor(variant);
  const solver = createComposedSolver({ manifest, parent, modules, kindsOf: kindsOfE8, mode, id: id ?? `composed-reference-${timing}${variant ? `-${variant}` : ''}` });
  return {
    id: solver.id,
    tick(input, ctx) {
      const { committed, staged } = journal();
      for (; fed < committed.length; fed++) if (!['clock.freeze', 'run.resume'].includes(committed[fed].type)) idx.add(committed[fed]);
      idx.begin();
      try { idx.addAll(staged); return solver.tick(input, ctx); } finally { idx.rollback(); }
    },
  };
}

export const VARIANTS = Object.freeze(['payment-compensates', 'undeclared-write', 'parent-direct', 'call-outside-graph']);

/** The manifest a variant is held to: 'payment-compensates' honestly declares the refund in the payment (saga) module. */
export function manifestFor(variant) {
  if (variant !== 'payment-compensates') return REFERENCE_MANIFEST;
  const m = structuredClone(REFERENCE_MANIFEST);
  m.modules.saga.effects.push('billing.refund');
  return m;
}
