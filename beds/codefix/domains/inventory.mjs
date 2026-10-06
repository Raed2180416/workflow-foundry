// Domain: warehouse inventory (fictional stock ledger). Correct template + mutation sites.
import { New, Call, Fn, Get, Ref, Case, codes } from './dsl.mjs';

const SITES_NAMES = ['Harrowgate', 'Pell Street', 'Northmere', 'Calder Yard', 'Osterby', 'Wendlebury', 'Quarry Lane'];

export default {
  id: 'inventory',
  domain: 'warehouse inventory',
  params(r) {
    return {
      mod: r.pick(['stockroom', 'inventory_ledger', 'depot_stock', 'binkeeper']),
      Cls: r.pick(['Warehouse', 'StockLedger', 'Depot', 'Storeroom']),
      prefix: r.pick(['SKU', 'PART', 'ITM', 'BIN']),
      site: r.pick(SITES_NAMES),
      thr: r.int(3, 7),
      receive: r.pick(['receive', 'restock', 'add_stock']),
      reserve: r.pick(['reserve', 'allocate', 'hold']),
      ship: r.pick(['ship', 'dispatch', 'fulfil']),
      safety: r.int(2, 4),
      tol: r.int(1, 3),
      perpage: r.pick([3, 4, 5]),
    };
  },
  context: p => `We run ${p.mod} (the ${p.Cls} ledger) behind the pick-and-pack service at the ${p.site} warehouse.`,
  sections: [
    { id: 'core', label: 'receiving, reservations, shipping and low-stock reporting' },
    { id: 'moves', label: 'releases, transfers between ledgers and totals' },
    { id: 'lots', label: 'expiry-ordered lot queues' },
    { id: 'reorder', label: 'reorder planning' },
    { id: 'counts', label: 'cycle-count reconciliation' },
  ],

  sites: {
    receive_zero: {
      section: 'core', op: 'wrong-comparator', fnKey: 'receive', fn: p => `${p.Cls}.${p.receive}()`,
      title: p => `${p.receive}() accepts a zero quantity`,
      symptom: [
        p => `Our CSV import had a row with quantity 0. ${p.receive}() did not complain at all: it quietly created an empty stock line, and that item now shows up in every low-stock report.`,
        p => `Receiving 0 units is accepted without error and leaves a phantom item in the ledger. I thought zero quantities were supposed to be rejected?`,
      ],
      herring: [
        p => `Minor annoyance: ${p.receive}() raises ValueError when the quantity is 0. A zero delivery is a no-op in the real world, so it should just return the current count instead of blowing up our import.`,
      ],
      killers: (p, r) => {
        const [a, b] = codes(r, p.prefix, 2);
        return [Case('test_receive_rejects_zero_quantity', [New('w', p.Cls), Call('w', p.receive, [a, 0]),
          Call('w', p.receive, [b, r.int(p.thr + 2, 40)]), Call('w', 'low_stock'), Call('w', 'available', [a])])];
      },
    },
    reserve_all: {
      section: 'core', op: 'wrong-comparator', fnKey: 'reserve', fn: p => `${p.Cls}.${p.reserve}()`,
      title: p => `Cannot ${p.reserve} the last available units`,
      symptom: [
        p => `When an order asks for exactly what is left, ${p.reserve}() raises InsufficientStock even though available() reports that exact number.`,
        p => `Orders that would use up the remaining stock of an item are refused. If available() says 6 and I ${p.reserve} 6, I get InsufficientStock; 5 works.`,
      ],
      herring: [
        p => `I think ${p.reserve}() is too permissive: it lets an order take every last unit so available() drops to 0. Shouldn't it always keep one unit back and refuse a request for the full amount?`,
      ],
      decoy: () => 'FIXME(audit): should this be >= so we never hand out the very last unit?',
      killers: (p, r) => {
        const [a] = codes(r, p.prefix, 1); const n = r.int(3, 40);
        return [Case('test_reserve_everything_available', [New('w', p.Cls), Call('w', p.receive, [a, n]),
          Call('w', p.reserve, [a, n]), Call('w', 'available', [a]), Call('w', p.reserve, [a, 1])])];
      },
    },
    low_zero: {
      section: 'core', op: 'missing-edge-case', fnKey: 'low_stock', fn: p => `${p.Cls}.low_stock()`,
      title: () => 'low_stock(0) ignores the explicit threshold',
      symptom: [
        () => `low_stock(0) should list only items with nothing available, but it returns items that still have several units, as if the 0 were not passed at all.`,
        () => `Passing threshold=0 to low_stock gives the same list as calling it with no argument. Other thresholds work.`,
      ],
      killers: (p, r) => {
        const t = r.int(2, 6); const [a, b, c] = codes(r, p.prefix, 3);
        return [Case('test_low_stock_explicit_zero_threshold', [New('w', p.Cls, [t]), Call('w', p.receive, [a, r.int(1, t)]),
          Call('w', p.receive, [b, t + r.int(2, 9)]), Call('w', p.receive, [c, 2]), Call('w', p.reserve, [c, 2]),
          Call('w', 'low_stock', [0]), Call('w', 'low_stock')])];
      },
    },
    low_cmp: {
      section: 'core', op: 'off-by-one', fnKey: 'low_stock', fn: p => `${p.Cls}.low_stock()`,
      title: () => 'Items exactly at the low-stock threshold are not reported',
      symptom: [
        p => `An item with exactly ${p.thr} units available (our threshold) never appears in low_stock(); it only shows up once it drops to ${p.thr - 1}.`,
        () => `low_stock() seems to skip items sitting exactly on the threshold. We only get alerted one unit too late.`,
      ],
      herring: [
        p => `low_stock() includes items that are exactly at the threshold (${p.thr} units). "Low" should mean strictly below the threshold, so those should be left out.`,
      ],
      killers: (p, r) => {
        const [a, b, c] = codes(r, p.prefix, 3);
        return [Case('test_low_stock_includes_items_at_threshold', [New('w', p.Cls), Call('w', p.receive, [a, p.thr]),
          Call('w', p.receive, [b, p.thr + 1]), Call('w', p.receive, [c, p.thr + 3]), Call('w', p.reserve, [c, 3]),
          Call('w', 'low_stock')])];
      },
    },
    init_default: {
      section: 'core', op: 'wrong-default', fnKey: '__init__', fn: p => `${p.Cls}()`,
      title: p => `Default ${p.Cls} uses the wrong low-stock threshold`,
      symptom: [
        p => `With a default-constructed ${p.Cls}, low_stock() flags items that have ${p.thr + 1} or ${p.thr + 2} units. The documented default threshold is ${p.thr}.`,
        p => `low_stock_threshold on a fresh ${p.Cls}() is not the value the docstring promises, so default reports are too noisy.`,
      ],
      killers: (p, r) => {
        const [a, b, c] = codes(r, p.prefix, 3);
        return [Case('test_default_threshold', [New('w', p.Cls), Get('w', 'low_stock_threshold'), Call('w', p.receive, [a, p.thr + 1]),
          Call('w', p.receive, [b, p.thr + 2]), Call('w', p.receive, [c, p.thr]), Call('w', 'low_stock')])];
      },
    },
    release_check: {
      section: 'moves', op: 'missing-edge-case', fnKey: 'release', fn: p => `${p.Cls}.release()`,
      title: () => 'release() lets reservations go negative',
      symptom: [
        () => `If a cancelled order releases more units than were actually reserved, release() just accepts it and available() ends up higher than what is physically on the shelf.`,
        () => `Double-cancelling an order (release called twice) inflates available stock beyond on-hand.`,
      ],
      killers: (p, r) => {
        const [a] = codes(r, p.prefix, 1); const n = r.int(8, 30); const k = r.int(2, 5);
        return [Case('test_release_more_than_reserved_is_rejected', [New('w', p.Cls), Call('w', p.receive, [a, n]),
          Call('w', p.reserve, [a, k]), Call('w', 'release', [a, k + r.int(1, 4)]), Call('w', 'available', [a]),
          Call('w', 'release', [a, k])])];
      },
    },
    transfer_dir: {
      section: 'moves', op: 'swapped-arguments', fnKey: 'transfer', fn: p => `${p.Cls}.transfer()`,
      title: () => 'transfer() moves stock in the wrong direction',
      symptom: [
        () => `transfer() goes the wrong way: after moving units from ledger A to ledger B, A has more than before and B has less. When B has never seen the item it crashes instead.`,
        () => `Inter-site transfers are backwards. The destination loses units and the source gains them.`,
      ],
      killers: (p, r) => {
        const [a] = codes(r, p.prefix, 1); const n = r.int(15, 40); const m = r.int(3, 9); const q = r.int(2, 9);
        return [Case('test_transfer_moves_units_to_destination', [New('w', p.Cls), New('v', p.Cls), Call('w', p.receive, [a, n]),
          Call('v', p.receive, [a, m]), Call('w', 'transfer', [a, q, Ref('v')]), Call('w', 'available', [a]), Call('v', 'available', [a])])];
      },
    },
    total_unknown: {
      section: 'moves', op: 'missing-edge-case', fnKey: 'total_available', fn: p => `${p.Cls}.total_available()`,
      title: () => 'total_available() crashes on unknown item codes',
      symptom: [
        () => `total_available() with a list of codes raises KeyError as soon as one of the codes has never been received. The docstring says unknown codes count as zero.`,
      ],
      killers: (p, r) => {
        const [a, b, c] = codes(r, p.prefix, 3); const x = r.int(2, 20); const y = r.int(2, 20);
        return [Case('test_total_available_ignores_unknown_codes', [New('w', p.Cls), Call('w', p.receive, [a, x]), Call('w', p.receive, [b, y]),
          Call('w', 'total_available', [[a, c]]), Call('w', 'total_available')])];
      },
    },
    lot_order: {
      section: 'lots', op: 'swapped-arguments', fnKey: 'LotQueue.add', fn: () => 'LotQueue.pick()',
      title: () => 'LotQueue picks from a later-expiring lot first',
      symptom: [
        () => `LotQueue.pick() does not take the earliest-expiring lot first. It seems to go by lot id instead, so short-dated stock is left behind and expires.`,
        () => `We are losing short-dated goods: pick() drew from lot L-01 (expires day 40) while L-07 (expires day 12) was still in the queue.`,
      ],
      killers: (p, r) => {
        const e1 = r.int(20, 40); const e2 = r.int(5, 15);
        return [Case('test_pick_takes_earliest_expiry_first', [New('q', 'LotQueue'), Call('q', 'add', ['L-01', r.int(5, 9), e1]),
          Call('q', 'add', ['L-02', r.int(5, 9), e2]), Call('q', 'add', ['L-03', 4, e2]), Call('q', 'pick', [r.int(2, 4)]), Call('q', 'total')])];
      },
    },
    lot_need: {
      section: 'lots', op: 'stale-variable', fnKey: 'LotQueue.pick', fn: () => 'LotQueue.pick()',
      title: () => 'pick() over-picks when a request spans several lots',
      symptom: [
        () => `When a pick needs more than the first lot holds, the second lot is drained by too much: picking 6 from lots of 3 and 5 takes 3 + 5 instead of 3 + 3.`,
        () => `LotQueue.pick() returns more units in total than I asked for whenever it has to open a second lot.`,
      ],
      killers: (p, r) => {
        const a = r.int(2, 5); const b = r.int(6, 10); const need = a + r.int(1, b - 2);
        return [Case('test_pick_across_two_lots', [New('q', 'LotQueue'), Call('q', 'add', ['L-11', a, 3]), Call('q', 'add', ['L-12', b, 9]),
          Call('q', 'pick', [need]), Call('q', 'total')])];
      },
    },
    lot_expire: {
      section: 'lots', op: 'wrong-comparator', fnKey: 'LotQueue.expire', fn: () => 'LotQueue.expire()',
      title: () => 'expire() discards lots on their expiry day',
      symptom: [
        () => `expire(today) throws away lots whose expiry day is today. Our policy (and the docstring) says a lot is still usable on its expiry day.`,
      ],
      herring: [
        () => `expire(day) keeps lots that expire on that very day. I would expect anything expiring today to be dropped as well, otherwise we pick stock on its last legal day.`,
      ],
      decoy: () => 'TODO: confirm with QA whether lots expiring today should go too (<=)?',
      killers: (p, r) => {
        const d = r.int(8, 20); const x = r.int(2, 7); const y = r.int(3, 9);
        return [Case('test_expire_keeps_lots_on_their_expiry_day', [New('q', 'LotQueue'), Call('q', 'add', ['L-21', x, d]), Call('q', 'add', ['L-22', y, d + 3]),
          Call('q', 'expire', [d]), Call('q', 'total'), Call('q', 'expire', [d + 1]), Call('q', 'total')])];
      },
    },
    lot_horizon: {
      section: 'lots', op: 'off-by-one', fnKey: 'LotQueue.expiring_within', fn: () => 'LotQueue.expiring_within()',
      title: () => 'expiring_within() misses lots expiring on the last day',
      symptom: [
        () => `expiring_within(today, 7) does not list a lot that expires exactly 7 days from today, so our markdown list misses it.`,
      ],
      killers: (p, r) => { const t = r.int(5, 20); const k = r.int(3, 9);
        return [Case('test_expiring_within_includes_horizon', [New('q', 'LotQueue'), Call('q', 'add', ['L-41', 3, t + k]), Call('q', 'add', ['L-42', 2, t + k + 1]),
          Call('q', 'add', ['L-43', 5, t - 1]), Call('q', 'expiring_within', [t, k]), Call('q', 'next_expiry')])]; },
    },
    cover_zero: {
      section: 'reorder', op: 'missing-edge-case', fnKey: 'days_of_cover', fn: () => 'days_of_cover()',
      title: () => 'days_of_cover() crashes for items with no demand',
      symptom: [
        () => `days_of_cover() raises ZeroDivisionError for slow movers with zero daily demand. Our dashboard dies on the first such item.`,
      ],
      killers: (p, r) => [Case('test_days_of_cover_zero_demand', [Fn('days_of_cover', [r.int(1, 50), 0]), Fn('days_of_cover', [r.int(10, 50), r.int(2, 6)])])],
    },
    pack_round: {
      section: 'reorder', op: 'off-by-one', fnKey: 'reorder_quantity', fn: () => 'reorder_quantity()',
      title: () => 'reorder_quantity() orders an extra pack on exact multiples',
      symptom: [
        () => `If the shortfall is an exact multiple of the pack size we get one pack too many. Shortfall 24 with packs of 12 gives 36.`,
        () => `reorder_quantity() overshoots by a whole pack in some cases; other cases look right. It seems to happen when the numbers divide evenly.`,
      ],
      decoy: () => 'NOTE(perf): plain floor division plus one would avoid the double negation here',
      killers: (p, r) => {
        const d = r.int(2, 6); const L = r.int(2, 6); const s = r.int(1, 3); const target = d * (L + s);
        const pack = r.pick([2, 3, 4, 5, 6].filter(x => x <= target)); const k = Math.max(1, Math.floor(target / pack) - r.int(0, 1));
        return [Case('test_reorder_exact_pack_multiple', [Fn('reorder_quantity', [target - k * pack, d, L, pack], { safety_days: s }),
          Fn('reorder_quantity', [target + 1, d, L, pack], { safety_days: s })])];
      },
    },
    safety_default: {
      section: 'reorder', op: 'wrong-default', fnKey: 'reorder_quantity', fn: () => 'reorder_quantity()',
      title: () => 'reorder_quantity() default safety stock is wrong',
      symptom: [
        p => `When we do not pass safety_days, reorder_quantity() behaves as if the buffer were longer than the documented ${p.safety} days, so every default order is too big.`,
      ],
      killers: (p, r) => {
        const d = r.int(2, 6); const L = r.int(2, 7);
        return [Case('test_reorder_default_safety_days', [Fn('reorder_quantity', [r.int(0, d), d, L, 1])])];
      },
    },
    plan_args: {
      section: 'reorder', op: 'swapped-arguments', fnKey: 'reorder_plan', fn: () => 'reorder_plan()',
      title: () => 'reorder_plan() quantities disagree with reorder_quantity()',
      symptom: [
        () => `reorder_plan() gives different quantities than calling reorder_quantity() item by item with the same numbers. It looks right only when daily demand equals the lead time.`,
      ],
      killers: (p, r) => {
        const [a, b] = codes(r, p.prefix, 2); const L = r.int(2, 4);
        return [Case('test_reorder_plan_matches_reorder_quantity', [New('w', p.Cls), Call('w', p.receive, [a, r.int(1, 4)]), Call('w', p.receive, [b, r.int(1, 3)]),
          Fn('reorder_plan', [Ref('w'), { [a]: L + r.int(2, 5), [b]: r.int(1, 2) }, L, { [a]: r.int(2, 5) }])])];
      },
    },
    delta_sign: {
      section: 'counts', op: 'swapped-arguments', fnKey: 'reconcile', fn: () => 'reconcile()',
      title: () => 'reconcile() reports deltas with the wrong sign',
      symptom: [
        () => `reconcile() shows shrinkage as positive numbers: we expected 10, counted 7, and the delta column says +3.`,
        () => `The delta column from reconcile() is inverted compared to the docstring (counted minus expected).`,
      ],
      killers: (p, r) => {
        const [a, b, c] = codes(r, p.prefix, 3); const ea = r.int(8, 20); const ga = ea - r.int(4, 7);
        return [Case('test_reconcile_delta_is_counted_minus_expected', [Fn('reconcile', [{ [a]: ea, [b]: 5 }, { [a]: ga, [b]: 5, [c]: r.int(4, 9) }], { tolerance: 0 })])];
      },
    },
    tol_cmp: {
      section: 'counts', op: 'wrong-comparator', fnKey: 'reconcile', fn: () => 'reconcile()',
      title: () => 'reconcile() flags differences equal to the tolerance',
      symptom: [
        p => `reconcile() flags items whose count is off by exactly the tolerance (${p.tol}). Those are supposed to be accepted; only bigger differences should be listed.`,
      ],
      herring: [
        p => `reconcile() silently accepts items that are off by exactly the tolerance (${p.tol} units). An auditor would want those listed too.`,
      ],
      killers: (p, r) => {
        const [a, b, c] = codes(r, p.prefix, 3); const ea = r.int(10, 30); const eb = r.int(10, 30);
        return [Case('test_reconcile_tolerance_boundary', [Fn('reconcile', [{ [a]: ea, [b]: eb, [c]: 4 }, { [a]: ea + p.tol, [b]: eb - p.tol - 1, [c]: 4 }])])];
      },
    },
    sheet_empty: {
      section: 'counts', op: 'wrong-comparator', fnKey: 'count_sheet', fn: () => 'count_sheet()',
      title: () => 'count_sheet() lists empty items',
      symptom: [
        () => `count_sheet() includes items with nothing on hand, so the counters walk to empty bins. The docstring says those are left out.`,
      ],
      killers: (p, r) => { const [a, b, c] = codes(r, p.prefix, 3);
        return [Case('test_count_sheet_skips_empty_items', [New('w', p.Cls), Call('w', p.receive, [a, 3]), Call('w', p.receive, [b, 2]), Call('w', p.reserve, [b, 2]),
          Call('w', p.ship, [b, 2]), Call('w', p.receive, [c, 4]), Fn('count_sheet', [Ref('w')], { per_page: 2 })])]; },
    },
    count_reserved: {
      section: 'counts', op: 'missing-edge-case', fnKey: 'apply_count', fn: () => 'apply_count()',
      title: () => 'apply_count() leaves reservations above the counted stock',
      symptom: [
        () => `After apply_count() writes a physical count that is lower than what is reserved, available() goes negative.`,
      ],
      killers: (p, r) => {
        const [a, z] = codes(r, p.prefix, 2); const n = r.int(10, 20); const k = r.int(6, 9); const c = r.int(1, 5);
        return [Case('test_apply_count_caps_reservations', [New('w', p.Cls), Call('w', p.receive, [a, n]), Call('w', p.reserve, [a, k]),
          Fn('apply_count', [Ref('w'), { [a]: c, [z]: 3 }]), Call('w', 'available', [a]), Call('w', p.ship, [a, c])])];
      },
    },
  },

  randoms: {
    core(p, r, i) {
      const items = codes(r, p.prefix, 3); const steps = [New('w', p.Cls, r.chance(0.5) ? [] : [r.int(2, 9)])];
      for (const it of items.slice(0, 2)) steps.push(Call('w', p.receive, [it, r.int(3, 25)]));
      for (let k = 0; k < 9; k++) {
        const it = r.pick(items); const op = r.int(0, 5);
        if (op <= 1) steps.push(Call('w', p.receive, [it, r.int(1, 25)]));
        else if (op === 2) steps.push(Call('w', p.reserve, [it, r.int(1, 12)]));
        else if (op === 3) steps.push(Call('w', p.ship, [it, r.int(1, 6)]));
        else if (op === 4) steps.push(Call('w', 'available', [it]));
        else steps.push(Call('w', 'low_stock', r.chance(0.5) ? [] : [r.int(1, 12)]));
      }
      steps.push(Call('w', 'low_stock'));
      return Case(`test_ledger_sequence_${i}`, steps);
    },
    moves(p, r, i) {
      const items = codes(r, p.prefix, 2); const steps = [New('w', p.Cls), New('v', p.Cls)];
      for (const it of items) steps.push(Call('w', p.receive, [it, r.int(10, 30)]));
      steps.push(Call('w', p.reserve, [items[0], r.int(1, 6)]));
      steps.push(Call('w', 'transfer', [items[1], r.int(1, 9), Ref('v')]));
      steps.push(Call('w', 'release', [items[0], r.int(1, 3)]));
      steps.push(Call('w', 'bulk_receive', [[[items[0], r.int(1, 5)], [items[1], 0], [items[0], -r.int(1, 3)]]]));
      steps.push(Call('w', 'snapshot'), Call('v', 'snapshot'), Call('w', 'total_available'));
      return Case(`test_transfer_sequence_${i}`, steps);
    },
    lots(p, r, i) {
      const steps = [New('q', 'LotQueue')];
      for (let k = 0; k < 4; k++) steps.push(Call('q', 'add', [`L-${30 + k}`, r.int(1, 8), r.int(3, 30)]));
      steps.push(Call('q', 'expire', [r.int(1, 10)]), Call('q', 'next_expiry'), Call('q', 'expiring_within', [r.int(1, 10), r.int(1, 15)]),
        Call('q', 'pick', [r.int(1, 6)]), Call('q', 'total'), Call('q', 'pick', [r.int(1, 30)]));
      return Case(`test_lot_sequence_${i}`, steps);
    },
    reorder(p, r, i) {
      const items = codes(r, p.prefix, 3);
      return Case(`test_reorder_values_${i}`, [New('w', p.Cls), ...items.map(it => Call('w', p.receive, [it, r.int(1, 30)])),
        Fn('cover_report', [Ref('w'), { [items[0]]: r.int(1, 5), [items[1]]: r.int(0, 3) }]),Fn('reorder_quantity', [r.int(0, 30), r.int(1, 6), r.int(1, 6), r.int(1, 6)]),
        Fn('days_of_cover', [r.int(0, 40), r.int(1, 7)]), Fn('reorder_quantity', [r.int(30, 60), r.int(1, 3), r.int(1, 3), 5], { safety_days: 1 })]);
    },
    counts(p, r, i) {
      const items = codes(r, p.prefix, 4); const exp = {}; const got = {};
      for (const it of items) { if (r.chance(0.8)) exp[it] = r.int(0, 20); if (r.chance(0.8)) got[it] = r.int(0, 20); }
      const steps = [New('w', p.Cls), ...items.slice(0, 3).map(it => Call('w', p.receive, [it, r.int(1, 9)]))];
      return Case(`test_reconcile_values_${i}`, [Fn('reconcile', [exp, got], { tolerance: r.int(0, 3) }), ...steps, Fn('count_sheet', [Ref('w')]),
        Fn('apply_count', [Ref('w'), got]), Call('w', 'available', [items[0]])]);
    },
  },

  render(p, { m, d, inc }) {
    const out = [];
    out.push(`"""${p.mod}: in-memory stock ledger for the ${p.site} warehouse.

All quantities are whole units (non-negative integers).  Each stock line keeps
the units physically on hand and the units reserved for open orders; the
*available* quantity is on hand minus reserved.  Item codes look like
${p.prefix}-1042.
"""
from dataclasses import dataclass


class InventoryError(Exception):
    """Base class for inventory errors."""


class UnknownItem(InventoryError):
    """Raised when an operation names an item that was never received."""


class InsufficientStock(InventoryError):
    """Raised when a request needs more units than the stock line allows."""


@dataclass
class StockLine:
    """Counters for one item."""

    item: str
    on_hand: int = 0
    reserved: int = 0

    @property
    def available(self):
        """Units that can still be reserved: on hand minus reserved."""
        return self.on_hand - self.reserved


class ${p.Cls}:
    """Stock lines keyed by item code."""

    def __init__(self, low_stock_threshold=${m('init_default', String(p.thr), String(p.thr + 2))}):
        """Create an empty ledger.

        low_stock_threshold defaults to ${p.thr}; see low_stock().
        """
        self.low_stock_threshold = low_stock_threshold
        self._lines = {}

    def _line(self, item):
        try:
            return self._lines[item]
        except KeyError:
            raise UnknownItem(item) from None

    def ${p.receive}(self, item, qty):
        """Add qty units of item and return the new on-hand count.

        qty must be a positive whole number; zero or negative quantities raise
        ValueError and leave the ledger unchanged.
        """
${d('receive_zero', 8)}        if qty ${m('receive_zero', '<=', '<')} 0:
            raise ValueError("quantity must be positive")
        line = self._lines.setdefault(item, StockLine(item))
        line.on_hand += qty
        return line.on_hand

    def available(self, item):
        """Units of item that can still be reserved."""
        return self._line(item).available

    def ${p.reserve}(self, item, qty):
        """Reserve qty units for an order and return what is still available.

        A reservation may use every available unit; asking for more than is
        available raises InsufficientStock and reserves nothing.
        """
        line = self._line(item)
${d('reserve_all', 8)}        if qty ${m('reserve_all', '>', '>=')} line.available:
            raise InsufficientStock(item)
        line.reserved += qty
        return line.available

    def ${p.ship}(self, item, qty):
        """Ship qty previously reserved units and return the new on-hand count.

        Shipping consumes both the reservation and the physical units.  Shipping
        more than is reserved raises InsufficientStock.
        """
        line = self._line(item)
        if qty > line.reserved:
            raise InsufficientStock(item)
        line.reserved -= qty
        line.on_hand -= qty
        return line.on_hand

    def low_stock(self, threshold=None):
        """Return the sorted item codes whose available quantity is at or below
        threshold.

        When threshold is omitted (None) the ledger's low_stock_threshold is
        used.  An explicit 0 means "only items with nothing available".
        """
${d('low_zero', 8)}        limit = ${m('low_zero', 'self.low_stock_threshold if threshold is None else threshold', 'threshold or self.low_stock_threshold')}
        return sorted(
${d('low_cmp', 12)}            item for item, line in self._lines.items() if line.available ${m('low_cmp', '<=', '<')} limit
        )
`);
    if (inc('moves')) out.push(`
    def release(self, item, qty):
        """Give back qty reserved units (for a cancelled order).

        Returns the new available count.  Releasing more than is currently
        reserved raises InsufficientStock and changes nothing.
        """
        line = self._line(item)
${m('release_check', `        if qty > line.reserved:
            raise InsufficientStock(item)
`, '')}        line.reserved -= qty
        return line.available

    def transfer(self, item, qty, other):
        """Move qty available units of item from this ledger to the ledger other.

        Reserved units never move.  Returns [left_here, now_there]: the
        available counts in both ledgers after the move.
        """
        source = self._line(item)
        if qty > source.available:
            raise InsufficientStock(item)
${d('transfer_dir', 8)}        _shift(${m('transfer_dir', 'self, other', 'other, self')}, item, qty)
        return [self.available(item), other.available(item)]

    def total_available(self, items=None):
        """Sum of available units over the codes in items (default: all items).

        Codes that were never received count as zero.
        """
        codes = self._lines if items is None else items
        total = 0
        for code in codes:
${m('total_unknown', `            line = self._lines.get(code)
            if line is not None:
                total += line.available
`, `            total += self._lines[code].available
`)}        return total

    def bulk_receive(self, rows):
        """Receive several [item, qty] rows in order.

        Rows with a quantity of zero or less are skipped instead of raising.
        Returns [accepted_count, skipped_items], where skipped_items lists the
        item codes of the skipped rows in input order.
        """
        accepted = 0
        skipped = []
        for item, qty in rows:
            if qty <= 0:
                skipped.append(item)
                continue
            self.${p.receive}(item, qty)
            accepted += 1
        return [accepted, skipped]

    def snapshot(self):
        """Rows [item, on_hand, reserved, available] sorted by item code."""
        rows = []
        for item in sorted(self._lines):
            line = self._lines[item]
            rows.append([item, line.on_hand, line.reserved, line.available])
        return rows


def _shift(src, dst, item, qty):
    """Low-level move used by transfer(); performs no validation."""
    src._lines[item].on_hand -= qty
    dst._lines.setdefault(item, StockLine(item)).on_hand += qty
`);
    if (inc('lots')) out.push(`

@dataclass
class Lot:
    """A received batch of one item with an expiry day number."""

    lot_id: str
    qty: int
    expires_day: int


class LotQueue:
    """Lots of a single item, picked first-expiring-first-out.

    Ties on expiry day are broken by lot id.  A lot is still usable on its
    expiry day; expire(today) only discards lots whose expiry day is before
    today.
    """

    def __init__(self):
        self._lots = []

    def add(self, lot_id, qty, expires_day):
        """Register a lot.  qty must be positive."""
        if qty <= 0:
            raise ValueError("lot quantity must be positive")
        self._lots.append(Lot(lot_id, qty, expires_day))
${d('lot_order', 8)}        self._lots.sort(key=lambda lot: (${m('lot_order', 'lot.expires_day, lot.lot_id', 'lot.lot_id, lot.expires_day')}))

    def total(self):
        """Units across all lots."""
        return sum(lot.qty for lot in self._lots)

    def pick(self, qty):
        """Take qty units, earliest expiry first.

        Returns a list of [lot_id, taken] pairs in pick order.  Lots that reach
        zero are removed.  If fewer than qty units exist, nothing is taken and
        InsufficientStock is raised.
        """
        if qty > self.total():
            raise InsufficientStock("lots")
        picks = []
        need = qty
        while need > 0:
            lot = self._lots[0]
            take = min(${m('lot_need', 'need', 'qty')}, lot.qty)
            lot.qty -= take
            need -= take
            picks.append([lot.lot_id, take])
            if lot.qty == 0:
                self._lots.pop(0)
        return picks

    def next_expiry(self):
        """[lot_id, expires_day] of the lot that would be picked next, or None
        when the queue is empty."""
        if not self._lots:
            return None
        lot = self._lots[0]
        return [lot.lot_id, lot.expires_day]

    def expiring_within(self, today, days):
        """Sorted [lot_id, qty] pairs for lots that are still usable today and
        expire on or before day today + days."""
        horizon = today + days
        return sorted([lot.lot_id, lot.qty] for lot in self._lots if today <= lot.expires_day ${m('lot_horizon', '<=', '<')} horizon)

    def expire(self, today):
        """Drop lots whose expiry day is before today; return the units dropped."""
${d('lot_expire', 8)}${m('lot_expire', `        dropped = sum(lot.qty for lot in self._lots if lot.expires_day < today)
        self._lots = [lot for lot in self._lots if lot.expires_day >= today]
`, `        dropped = sum(lot.qty for lot in self._lots if lot.expires_day <= today)
        self._lots = [lot for lot in self._lots if lot.expires_day > today]
`)}        return dropped
`);
    if (inc('reorder')) out.push(`

def days_of_cover(available, daily_demand):
    """Whole days the available units last at daily_demand units per day.

    Partial days are dropped (5 units at 2 per day is 2 days).  With zero
    demand the stock never runs out and None is returned.
    """
${m('cover_zero', `    if daily_demand == 0:
        return None
`, '')}    return available // daily_demand


def reorder_quantity(available, daily_demand, lead_time_days, pack_size, safety_days=${m('safety_default', String(p.safety), String(p.safety + 2))}):
    """Units to order now so that stock covers the lead time plus safety days.

    target = daily_demand * (lead_time_days + safety_days); safety_days
    defaults to ${p.safety}.  If available already meets the target, order nothing
    (0).  Otherwise order the shortfall rounded up to whole packs.
    """
    target = daily_demand * (lead_time_days + safety_days)
    shortfall = target - available
    if shortfall <= 0:
        return 0
${d('pack_round', 4)}    packs = ${m('pack_round', '-(-shortfall // pack_size)', 'shortfall // pack_size + 1')}
    return packs * pack_size


def reorder_plan(ledger, demand, lead_time_days, pack_sizes):
    """Return [[item, qty], ...] for every item in ledger that needs an order.

    demand maps item -> daily demand (missing items have zero demand and are
    never ordered).  pack_sizes maps item -> pack size (default 1).  Rows are
    sorted by item code and items needing 0 units are omitted.
    """
    plan = []
    for item, line in sorted(ledger._lines.items()):
        rate = demand.get(item, 0)
        if rate == 0:
            continue
        qty = reorder_quantity(line.available, ${m('plan_args', 'rate, lead_time_days', 'lead_time_days, rate')}, pack_sizes.get(item, 1))
        if qty > 0:
            plan.append([item, qty])
    return plan


def cover_report(ledger, demand):
    """[[item, days_of_cover], ...] for every item in ledger, shortest cover
    first (ties by item code).  Items without demand have unlimited cover
    (None) and come last, in item-code order."""
    rows = [[item, days_of_cover(line.available, demand.get(item, 0))] for item, line in ledger._lines.items()]
    finite = sorted((row for row in rows if row[1] is not None), key=lambda row: (row[1], row[0]))
    unlimited = sorted(row for row in rows if row[1] is None)
    return finite + unlimited
`);
    if (inc('counts')) out.push(`

def reconcile(expected, counted, tolerance=${p.tol}):
    """Compare system quantities with a physical count.

    expected and counted map item -> units.  An item missing from counted was
    counted as 0; an item only present in counted was expected as 0.  Returns
    [[item, expected, counted, delta], ...] where delta = counted - expected,
    for the items whose absolute delta is greater than tolerance (default ${p.tol}).
    Largest absolute delta first, ties by item code.
    """
    rows = []
    for item in set(expected) | set(counted):
        exp = expected.get(item, 0)
        got = counted.get(item, 0)
        delta = ${m('delta_sign', 'got - exp', 'exp - got')}
${d('tol_cmp', 8)}        if abs(delta) ${m('tol_cmp', '>', '>=')} tolerance:
            rows.append([item, exp, got, delta])
    rows.sort(key=lambda row: (-abs(row[3]), row[0]))
    return rows


def apply_count(ledger, counted):
    """Overwrite on-hand quantities in ledger with physical counts.

    Reservations are kept, but a reservation larger than the new on-hand
    quantity is cut down to it.  Items unknown to the ledger are ignored.
    Returns the number of items whose on-hand quantity changed.
    """
    changed = 0
    for item, units in sorted(counted.items()):
        line = ledger._lines.get(item)
        if line is None:
            continue
        if line.on_hand != units:
            changed += 1
        line.on_hand = units
${m('count_reserved', `        line.reserved = min(line.reserved, units)
`, '')}    return changed


def count_sheet(ledger, per_page=${p.perpage}):
    """Item codes to count, in item-code order, split into pages of per_page
    codes (default ${p.perpage}).  Items with nothing on hand are left out; the
    last page may be shorter."""
    codes = [item for item, line in sorted(ledger._lines.items()) if line.on_hand ${m('sheet_empty', '>', '>=')} 0]
    return [codes[i:i + per_page] for i in range(0, len(codes), per_page)]
`);
    return out.join('');
  },

  notes(p, inc) {
    const out = [`# ${p.mod} design notes

${p.mod} is the stock ledger used by the ${p.site} pick-and-pack service. It is a plain in-memory
library; persistence is handled elsewhere.

## Ledger rules
- A stock line tracks *on hand* and *reserved* units. *Available* is always on hand minus reserved.
- Receiving requires a strictly positive quantity. A zero or negative receipt is an error, not a no-op,
  because it usually means a broken import row.
- A reservation may consume every available unit. Refusing the last unit was a bug in an old version of
  the order service, not a ledger rule.
- Shipping consumes reserved units only.
- low_stock() is inclusive: an item sitting exactly on the threshold is low. The default threshold of a
  new ledger is ${p.thr}. An explicit threshold of 0 is honoured.`];
    if (inc('moves')) out.push(`
## Releases and transfers
- release() returns reserved units to available. Releasing more than is reserved is an error.
- transfer() moves *available* units from the ledger it is called on to the other ledger.
- total_available() treats unknown codes as zero; it never raises for them.`);
    if (inc('lots')) out.push(`
## Lots
- Picking is first-expiring-first-out; ties go to the lower lot id.
- A lot may still be picked on its expiry day. expire(today) drops only lots that expired before today.
- A pick either takes exactly the requested quantity or nothing.
- expiring_within(today, days) includes lots expiring exactly on day today + days.`);
    if (inc('reorder')) out.push(`
## Reorder planning
- Target stock = daily demand x (lead time + safety days). Safety days default to ${p.safety}.
- Orders are rounded *up* to whole packs; an exact multiple needs no extra pack.
- Items with zero demand are never reordered and have unlimited cover (None); cover reports list them last.`);
    if (inc('counts')) out.push(`
## Cycle counts
- delta = counted - expected (negative means shrinkage).
- Differences up to and including the tolerance (default ${p.tol}) are accepted silently.
- Applying a count never leaves reserved above on hand.
- Count sheets skip items with nothing on hand (default ${p.perpage} codes per page).`);
    return out.join('\n') + '\n';
  },
};
