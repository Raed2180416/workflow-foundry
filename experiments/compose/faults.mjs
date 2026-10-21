// Fault harness on the unchanged E8 host (research/composition-20261021/HARNESS.md §4). $0, no model calls.
// Four faults, each applied to ANY tick/1 arm (a monolith solver.mjs or a composed bundle), so the composed and the
// monolithic arms meet the same faults:
//   (a) crash and restart, two kinds (arm wrappers; the host, the world and the oracle are unchanged):
//       restart       the solver process is killed and restarted before every Nth tick: module memory is lost, the
//                     committed carry is intact. A solver that keeps state only where the interface allows (carry,
//                     records, status) produces the same journal content.
//       crash         after an effectful tick the platform has applied the tick's side effects (effects, human tasks)
//                     but the state was not persisted: the carry rolls back to the last committed one, the tick's
//                     timers are lost, the process restarts, and the tick's events are delivered again (prepended)
//                     with the instance's next tick (at-least-once delivery after a crash, as a durable-execution
//                     platform redelivers the history of a failed task). Measured: exactly-once effects.
//   (b) duplicate delivery: the world's inbound messages delivered twice (beds/ebed/e8/metamorphic.mjs MR5 transforms:
//       placed orders and carrier reports repeated 7 minutes later, carriers repeating every report; or every arrival
//       twice in its own instant). SPEC-E §3.1 and §3.3 say repeats change nothing.
//   (c) downstream failure after a side effect: permanent failures injected at every saga step of straight orders
//       (metamorphic.mjs MR11 injectFailures: F6 on charge after the reservation, on reserve, on booking after the
//       charge; a collection failure after the booking; customer cancels 1, 2, 3 and 45 minutes in). Measured:
//       compensation completeness against the independent planner (beds/ebed/lib/saga.mjs).
//   (d) drift: drift.mjs.
// Seeds: dev only (HARNESS.md §6).
import { duplicateInbound, MR5_VARIANTS, injectFailures } from '../../beds/ebed/e8/metamorphic.mjs';
import { indexJournal } from '../../beds/ebed/oracle/view.mjs';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { identityOf, compensationLedger } from './capabilities.mjs';

export const FAULTS = Object.freeze(['none', 'restart', 'crash', 'dup-delayed', 'dup-same', 'downstream']);
const WRITES = new Set(['orders.create', 'orders.setStatus', 'inventory.reserve', 'inventory.release', 'billing.charge', 'billing.refund', 'carrier.create', 'carrier.cancel', 'notify.send']);

// ---------------------------------------------------------------------------------------------------------------------
// (a) crash and restart

/**
 * withRestart(arm, factory, { every }) → arm: before every `every`-th tick the arm is closed and a fresh one made
 * (factory()), as a process restart. Returns the wrapped arm; `.faults` lists the restarts.
 */
export function withRestart(arm, factory, { every = 7 } = {}) {
  let cur = arm, n = 0;
  const log = [];
  return {
    id: `${arm.id}+restart${every}`,
    faults: log,
    async tick(input, ctx) {
      n += 1;
      if (n % every === 0) { try { cur.close?.(); } catch { /* gone */ } cur = factory(); log.push({ kind: 'restart', at: input.now, instance: input.instance }); }
      return cur.tick(input, ctx);
    },
    close() { cur.close?.(); },
  };
}

/**
 * withCrash(arm, factory, { every, maxPerInstance }) → arm: every `every`-th tick that emits a side effect (a keyed write)
 * and neither merges nor closes is "crashed after apply": its effects and human tasks go out, its carry is replaced by
 * the input's (state lost), its timers are dropped, the process restarts, and its events are prepended to the
 * instance's next tick. A tick that carries redelivered events is never crashed itself.
 */
export function withCrash(arm, factory, { every = 3, maxPerInstance = 3 } = {}) {
  let cur = arm, n = 0;
  const stash = new Map(), per = new Map(), log = [];
  return {
    id: `${arm.id}+crash${every}`,
    faults: log,
    async tick(input0, ctx) {
      const redelivered = stash.get(input0.instance) ?? null;
      if (redelivered) stash.delete(input0.instance);
      const input = redelivered ? { ...input0, events: [...redelivered, ...input0.events] } : input0;
      const out = await cur.tick(input, ctx);
      const writes = Array.isArray(out?.effects) ? out.effects.filter(e => WRITES.has(`${e?.system}.${e?.op}`)) : [];
      if (redelivered || !writes.length || out.merge || out.close) return out;
      n += 1;
      if (n % every !== 0 || (per.get(input.instance) ?? 0) >= maxPerInstance) return out;
      per.set(input.instance, (per.get(input.instance) ?? 0) + 1);
      stash.set(input.instance, input.events);
      try { cur.close?.(); } catch { /* gone */ }
      cur = factory();
      log.push({ kind: 'crash', at: input.now, instance: input.instance, effects: writes.length, events: input.events.length });
      return { ...out, carry: input0.carry, obligations: { upsert: [], cancel: [] } };
    },
    close() { cur.close?.(); },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// (b), (c) faulted worlds

/** (b) A duplicate-delivery world: { world, binding, copies }. variant: 'delayed' (default) | 'same' | 'delayed-actions'. */
export function duplicateWorld(W, variant = 'delayed') {
  const v = MR5_VARIANTS[variant];
  if (!v) throw new Error(`unknown duplicate variant ${variant}`);
  const { Wt, B, copies } = duplicateInbound(W, v);
  return { world: Wt, binding: B, copies };
}

/** (c) A downstream-failure world: { world, binding, injected }. */
export function failureWorld(W) {
  const { Wt, injected } = injectFailures(W);
  return { world: Wt, binding: e8.binding, injected };
}

/** The world and host binding of a fault ('none', 'restart' and 'crash' keep the world). */
export function faultedWorld(W, fault) {
  if (fault === 'dup-delayed') return duplicateWorld(W, 'delayed');
  if (fault === 'dup-same') return duplicateWorld(W, 'same');
  if (fault === 'downstream') return failureWorld(W);
  return { world: W, binding: e8.binding };
}

// ---------------------------------------------------------------------------------------------------------------------
// Metrics

/**
 * exactlyOnce(world, rows) → { committed, duplicates: [{ case, id, n }], money, keyConflicts }: every logical effect
 * (SPEC-E §1: one per charge, refund, reservation item, status change, notification ...) committed at most once.
 */
export function exactlyOnce(world, rows, { item = e8.oracleItem } = {}) {
  const idx = indexJournal(world, rows, { canonicalArgs: item.canonicalArgs });
  const count = new Map();
  let committed = 0, keyConflicts = 0;
  for (const r of idx.ledger) {
    if (r.error?.reason === 'key-conflict') keyConflicts += 1;
    if (!r.committed) continue;
    const id = identityOf(r);
    if (!id) continue;
    committed += 1;
    const key = `${r.case}|${id}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  const duplicates = [...count].filter(([, n]) => n > 1).map(([key, n]) => ({ case: key.split('|')[0], id: key.split('|')[1], n }));
  return { committed, duplicates, money: duplicates.filter(d => /^(charge|refund):/.test(d.id)).length, keyConflicts };
}

/** compensationCompleteness(world, rows, { pools }) → { due, complete, incomplete } (fulfilment level). */
export function compensationCompleteness(world, rows, { pools = null, item = e8.oracleItem } = {}) {
  return compensationLedger(world, rows, { pools, canonicalArgs: item.canonicalArgs });
}
