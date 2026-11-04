// Arm-boundary mutants for compose-runtime/2's teeth (research/blockers-20261021/MOVE2-COMP.md). $0, no model calls.
// Each wraps any tick/1 arm (a sandboxed monolith or composed bundle) and plants one defect class from COMP-1 in its
// outputs, so the same defect can be run with and without the envelope (the envelope always sits between the mutant,
// which plays the program, and the host). Host-side counters record how often a mutant acted; they live outside the
// carry on purpose (a crash must not reset them).
//   withDupWrites   D2, caller-chosen identity: every keyed write of the chosen ops is emitted a second time under
//                   another caller key (two writers of one effect, or a key taken from the trigger).
//   withSplitRefund the "distinct refunds" mutant: every refund becomes two refunds of one fulfilment with different
//                   amounts (amount - 1, then 1) under two caller keys. Logically two different effects with one
//                   identity: the envelope must flag it (409 key-conflict, identity-conflict), never merge it.
//   withLateUndo    D3, crash collapse: a result for a charge key the program has already seen a result for is read as
//                   a late arrival and compensated with a refund (ch-e8-2's lateUndo in miniature). It keeps the seen
//                   keys and the charge arguments in its own layer of the carry, so a crash rolls them back exactly as
//                   it rolls back a real program's state.

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const MUT_CARRY = 'mut2';

const wrap = (arm, id, tick) => ({ id: `${arm.id}+${id}`, tick, close: () => arm.close?.() });

export function withDupWrites(arm, { ops = ['orders.setStatus'], counter = { n: 0 } } = {}) {
  return wrap(arm, 'dupwrites', async (input, ctx) => {
    const out = await arm.tick(input, ctx);
    if (!isObj(out) || !Array.isArray(out.effects)) return out;
    const effects = [];
    for (const e of out.effects) {
      effects.push(e);
      if (isObj(e) && typeof e.key === 'string' && ops.includes(`${e.system}.${e.op}`)) { effects.push({ ...e, key: `${e.key}~dup` }); counter.n += 1; }
    }
    return { ...out, effects };
  });
}

export function withSplitRefund(arm, { counter = { n: 0 } } = {}) {
  return wrap(arm, 'splitrefund', async (input, ctx) => {
    const out = await arm.tick(input, ctx);
    if (!isObj(out) || !Array.isArray(out.effects)) return out;
    const effects = [];
    for (const e of out.effects) {
      if (isObj(e) && e.system === 'billing' && e.op === 'refund' && Number.isInteger(e.args?.amountMinor) && e.args.amountMinor >= 3) {
        const key = typeof e.key === 'string' ? e.key : 'refund';
        effects.push({ ...e, key, args: { ...e.args, amountMinor: e.args.amountMinor - 1 } });
        effects.push({ ...e, key: `${key}~part2`, args: { ...e.args, amountMinor: 1 } });
        counter.n += 1;
      } else effects.push(e);
    }
    return { ...out, effects };
  });
}

export function withLateUndo(arm, { counter = { n: 0 } } = {}) {
  return wrap(arm, 'lateundo', async (input, ctx) => {
    const c = isObj(input.carry) && input.carry.cv === MUT_CARRY ? input.carry : { cv: MUT_CARRY, c: input.carry ?? null, seen: [], charges: {} };
    const seen = new Set(c.seen), charges = { ...c.charges };
    const late = [];
    for (const ev of input.events ?? []) {
      if (ev?.type !== 'effect.result' || typeof ev.payload?.key !== 'string' || ev.payload.op !== 'charge' || ev.payload.status !== 'ok') continue;
      const k = ev.payload.key;
      if (seen.has(k) && charges[k]) late.push(charges[k]);
      seen.add(k);
    }
    const out = await arm.tick({ ...input, carry: c.c }, ctx);
    if (!isObj(out)) return out;
    for (const e of Array.isArray(out.effects) ? out.effects : []) if (isObj(e) && e.system === 'billing' && e.op === 'charge' && typeof e.key === 'string') charges[e.key] = { orderId: e.args?.orderId, fulfilmentId: e.args?.fulfilmentId, amountMinor: e.args?.amountMinor, key: e.key };
    const undo = late.map(ch => ({ key: `${ch.key}~late-undo`, system: 'billing', op: 'refund', args: { orderId: ch.orderId, fulfilmentId: ch.fulfilmentId, amountMinor: ch.amountMinor } }));
    counter.n += undo.length;
    return { ...out, effects: [...(out.effects ?? []), ...undo], carry: { cv: MUT_CARRY, c: out.carry ?? null, seen: [...seen].slice(-200), charges } };
  });
}

export const MUTANTS = Object.freeze({ dupwrites: withDupWrites, splitrefund: withSplitRefund, lateundo: withLateUndo });
