// SPEC-0 precedent records (FIRST-CLASS-PROGRAMS §4.4 "Records: past orders whose outcomes reveal a rule; inference
// only"). One export per records-eligible unit, written only when the unit is assigned to the records carrier. $0, pure.
//
// Each template has a seeded row generator, the rule as a function (`rule`) and named alternative readings (`alts`).
// `discriminates(rows)` is the coverage proof: every row fits the true rule, and every alternative contradicts at least
// one row. Times are February 2026 (+01:00); fees are edition ed-2026-1 (WH-AMS 495, WH-RTM 395, WH-EIN 450).
const FEES = { 'WH-AMS': 495, 'WH-RTM': 395, 'WH-EIN': 450 };
const PICKUP = { 'WH-AMS': '15:00', 'WH-RTM': '17:00', 'WH-EIN': '13:30' };
const CUTOFF = 30;                    // policy.json collectionCutoffMinutes of ed-2026-1
const HOURS = 4;                      // policy.json customerActionHours of ed-2026-1
const pad = (n, w = 2) => String(n).padStart(w, '0');
const hm = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const dt = (day, m) => `2026-02-${pad(day + Math.floor(m / 1440))} ${hm(m % 1440)}`;
const toMin = s => { const [h, mi] = s.split(':').map(Number); return h * 60 + mi; };

function oid(r, used) { let x; do { x = `ORD-0226-${pad(r.int(100, 999), 4)}`; } while (used.has(x)); used.add(x); return x; }

export const PRECEDENTS = Object.freeze({
  'R1.2': {
    file: 'records/order-amounts-2026-02.csv', title: 'order amounts export',
    columns: ['order_id', 'fulfilment_id', 'warehouse', 'items', 'amount_cents', 'order_total_cents'],
    rows(r) {
      const used = new Set(), out = [];
      const sku = () => `SKU-${1001 + r.int(0, 29)}`;
      const line = () => { const q = r.int(1, 3), p = 299 + r.int(0, 40) * 100; return { text: `${sku()} x${q} @ ${p}`, sub: q * p }; };
      const order = (whs) => {
        const id = oid(r, used);
        const fs = whs.map((wh, i) => { const ls = Array.from({ length: r.int(1, 2) }, line); return { id: `${id}-F${i + 1}`, wh, items: ls.map(l => l.text).join('; '), sub: ls.reduce((s, l) => s + l.sub, 0) }; });
        for (const f of fs) f.amount = f.sub + (f.wh ? FEES[f.wh] : 0);
        const total = fs.reduce((s, f) => s + f.amount, 0);
        for (const f of fs) out.push({ order_id: id, fulfilment_id: f.id, warehouse: f.wh ?? '-', items: f.items, amount_cents: f.amount, order_total_cents: total });
      };
      const whs = r.shuffle(Object.keys(FEES));
      order([whs[0], whs[1]]);                       // two parcels: the fee is per fulfilment
      order([whs[2], null]);                         // one out of stock: no fee there, still in the total
      order([whs[1]]);
      order([whs[0], null]);
      return out;
    },
    rule: rows => rows.every(x => x.amount_cents === subOf(x) + (x.warehouse === '-' ? 0 : FEES[x.warehouse]))
      && groups(rows).every(g => g[0].order_total_cents === g.reduce((s, x) => s + x.amount_cents, 0)),
    alts: {
      'fee once per order': rows => groups(rows).every(g => g[0].order_total_cents === g.reduce((s, x) => s + subOf(x), 0) + FEES[g.find(x => x.warehouse !== '-').warehouse]),
      'no shipping fee in the amount': rows => rows.every(x => x.amount_cents === subOf(x)),
      'total leaves out-of-stock fulfilments out': rows => groups(rows).every(g => g[0].order_total_cents === g.filter(x => x.warehouse !== '-').reduce((s, x) => s + x.amount_cents, 0)),
      'out-of-stock fulfilments also pay a fee': rows => rows.filter(x => x.warehouse === '-').every(x => x.amount_cents > subOf(x)),
    },
  },
  'R1.4': {
    file: 'records/intake-log-2026-02.csv', title: 'intake log',
    columns: ['event_id', 'received_at', 'order_ref_as_received', 'action_taken'],
    rows(r) {
      const used = new Set(), out = [];
      const ids = [oid(r, used), oid(r, used), oid(r, used), oid(r, used)];
      let m = 9 * 60 + r.int(0, 30), ev = r.int(4100, 4800);
      const push = (ref, action) => { out.push({ event_id: `ev-${ev++}`, received_at: dt(10, m), order_ref_as_received: ref, action_taken: action }); m += r.int(3, 25); };
      push(ids[0], 'booked');
      push(ids[1], 'booked');
      push(ids[1], 'nothing (already booked)');                      // the same order again, minutes later
      push(ids[2], 'booked');
      push(` #${ids[0].toLowerCase()}`, 'nothing (already booked)'); // typed differently, same order
      push(ids[3], 'booked');
      return out;
    },
    rule: rows => { const seen = new Set(); return rows.every(x => { const k = norm(x.order_ref_as_received); const want = seen.has(k) ? 'nothing (already booked)' : 'booked'; seen.add(k); return x.action_taken === want; }); },
    alts: {
      'book every arrival': rows => rows.every(x => x.action_taken === 'booked'),
      'add the items to the existing order': rows => { const seen = new Set(); return rows.every(x => { const k = norm(x.order_ref_as_received); const want = seen.has(k) ? 'items added' : 'booked'; seen.add(k); return x.action_taken === want; }); },
    },
  },
  'R4.3': {
    file: 'records/pickup-log-2026-02.csv', title: 'carrier pickup log',
    columns: ['shipment_id', 'warehouse', 'pickup_time', 'booked_at', 'picked_up_at'],
    rows(r) {
      const out = [];
      const whs = r.shuffle(Object.keys(PICKUP));
      const shp = () => `SHP-${r.int(20000, 99999)}`;
      const one = (wh, day, before) => {
        const run = toMin(PICKUP[wh]), booked = run - before;
        const at = firstRun(wh, day, booked, CUTOFF);
        out.push({ shipment_id: shp(), warehouse: wh, pickup_time: PICKUP[wh], booked_at: dt(day, booked), picked_up_at: dt(day, at) });
      };
      one(whs[0], 11, 40 + r.int(0, 15));    // 40-55 min before: same pickup (rules out a 60-minute cutoff)
      one(whs[1], 12, 10 + r.int(0, 15));    // 10-25 min before: next day (rules out "no cutoff")
      one(whs[2], 16, 30);                   // exactly the cutoff: same pickup ("at least")
      one(whs[0], 18, 120 + r.int(0, 200));
      return out;
    },
    rule: rows => rows.every(x => x.picked_up_at === predictPickup(x, CUTOFF)),
    alts: {
      'no cutoff: any booking before the pickup makes it': rows => rows.every(x => x.picked_up_at === predictPickup(x, 0)),
      'a 60-minute cutoff': rows => rows.every(x => x.picked_up_at === predictPickup(x, 60)),
      'strictly more than the cutoff': rows => rows.every(x => x.picked_up_at === predictPickup(x, CUTOFF + 1)),
    },
  },
  'R4.5': {
    file: 'records/order-outcomes-2026-02.csv', title: 'order outcomes report',
    columns: ['order_id', 'fulfilment_statuses', 'order_status'],
    rows(r) {
      const used = new Set();
      const mixes = r.shuffle([['completed', 'failed'], ['completed', 'cancelled'], ['failed', 'cancelled'], ['cancelled', 'cancelled'], ['completed'], ['failed']]);
      return mixes.map(fs => ({ order_id: oid(r, used), fulfilment_statuses: fs.map((s, i) => `F${i + 1} ${s}`).join('; '), order_status: outcome(fs) }));
    },
    rule: rows => rows.every(x => x.order_status === outcome(statusesOf(x))),
    alts: {
      'failed if any fulfilment failed': rows => rows.every(x => { const s = statusesOf(x); return x.order_status === (s.includes('failed') ? 'failed' : s.includes('completed') ? 'completed' : 'cancelled'); }),
      'completed only if all fulfilments completed': rows => rows.every(x => { const s = statusesOf(x); return x.order_status === (s.every(v => v === 'completed') ? 'completed' : s.includes('failed') ? 'failed' : 'cancelled'); }),
      'cancelled if any fulfilment was cancelled': rows => rows.every(x => { const s = statusesOf(x); return x.order_status === (s.includes('cancelled') ? 'cancelled' : s.includes('completed') ? 'completed' : 'failed'); }),
    },
  },
  'S1': {
    file: 'records/customer-wait-log-2026-02.csv', title: 'out-of-stock wait log',
    columns: ['order_id', 'placed_at', 'flagged_at', 'customer_action', 'result', 'hours_allowed'],
    rows(r) {
      const used = new Set(), out = [];
      const add = (day, placed, flagAfter, action, result) => out.push({ order_id: oid(r, used), placed_at: dt(day, placed), flagged_at: dt(day, placed + flagAfter), customer_action: action, result, hours_allowed: HOURS });
      const p1 = 9 * 60 + r.int(0, 50), f1 = 70 + r.int(0, 40), k1 = r.int(1, 59);
      add(13, p1, f1, 'none', `timed out at ${dt(13, p1 + HOURS * 60 + k1)}`);                 // timeout counted from the placed time
      const p2 = 11 * 60 + r.int(0, 50), f2 = 15 + r.int(0, 20);
      add(17, p2, f2, `cancel at ${dt(17, p2 + HOURS * 60)}`, 'cancelled by customer');          // exactly at D: counts
      const p3 = 13 * 60 + r.int(0, 50), f3 = 10 + r.int(0, 15), k3 = r.int(2, 59);
      add(20, p3, f3, `amend at ${dt(20, p3 + HOURS * 60 + 1)}`, `timed out at ${dt(20, p3 + HOURS * 60 + k3)}`);   // one minute late: does not count
      return out;
    },
    rule: rows => rows.every(x => waitFits(x, 'placed', true)),
    alts: {
      'deadline counted from when the order was flagged': rows => rows.every(x => waitFits(x, 'flagged', true)),
      'an action exactly at the deadline is too late': rows => rows.every(x => waitFits(x, 'placed', false)),
    },
  },
  'S6': {
    file: 'records/cancel-requests-2026-02.csv', title: 'cancel requests log',
    columns: ['order_id', 'fulfilments', 'cancel_at', 'outcome'],
    rows(r) {
      const used = new Set(), out = [];
      const d1 = 9 + r.int(0, 3);
      out.push({ order_id: oid(r, used), fulfilments: `F1 WH-AMS picked up ${dt(d1, 15 * 60)}; F2 WH-RTM not picked up`, cancel_at: dt(d1, 16 * 60 + r.int(1, 50)), outcome: 'refused (cancel-refused sent)' });
      out.push({ order_id: oid(r, used), fulfilments: 'F1 WH-EIN not picked up', cancel_at: dt(d1 + 3, 10 * 60 + r.int(0, 50)), outcome: 'accepted (all fulfilments cancelled)' });
      out.push({ order_id: oid(r, used), fulfilments: `F1 WH-EIN picked up ${dt(d1 + 6, 13 * 60 + 30)}`, cancel_at: dt(d1 + 6, 14 * 60 + r.int(1, 50)), outcome: 'refused (cancel-refused sent)' });
      return out;
    },
    rule: rows => rows.every(x => x.outcome === (anyPicked(x) ? 'refused (cancel-refused sent)' : 'accepted (all fulfilments cancelled)')),
    alts: {
      'cancel the fulfilments not yet picked up': rows => rows.every(x => x.outcome === (allPicked(x) ? 'refused (cancel-refused sent)' : anyPicked(x) ? 'partly accepted (unpicked fulfilments cancelled)' : 'accepted (all fulfilments cancelled)')),
      'cancel allowed until delivery': rows => rows.every(x => x.outcome === 'accepted (all fulfilments cancelled)'),
    },
  },
});

// helpers
function norm(s) { return s.trim().replace(/^#/, '').toUpperCase(); }
function subOf(x) { return x.items.split('; ').reduce((s, l) => { const m = /x(\d+) @ (\d+)/.exec(l); return s + Number(m[1]) * Number(m[2]); }, 0); }
function groups(rows) { const g = new Map(); for (const x of rows) { if (!g.has(x.order_id)) g.set(x.order_id, []); g.get(x.order_id).push(x); } return [...g.values()]; }
function outcome(fs) { return fs.includes('completed') ? 'completed' : fs.includes('failed') ? 'failed' : 'cancelled'; }
function statusesOf(x) { return x.fulfilment_statuses.split('; ').map(s => s.split(' ')[1]); }
function firstRun(wh, day, bookedMin, cutoff) { const run = toMin(PICKUP[wh]); for (let d = 0; d < 3; d++) { const at = d * 1440 + run; if (at >= bookedMin + cutoff) return at; } return null; }
function parseDt(s) { const m = /2026-02-(\d\d) (\d\d):(\d\d)/.exec(s); return Number(m[1]) * 1440 + Number(m[2]) * 60 + Number(m[3]); }
function predictPickup(x, cutoff) {
  const booked = parseDt(x.booked_at), day = Math.floor(booked / 1440), run = toMin(x.pickup_time);
  for (let d = day; d < day + 3; d++) { const at = d * 1440 + run; if (at >= booked + cutoff) return dt(0, at); }
  return null;
}
function waitFits(x, anchor, inclusive) {
  const D = parseDt(anchor === 'placed' ? x.placed_at : x.flagged_at) + x.hours_allowed * 60;
  const act = /^(amend|cancel) at (.+)$/.exec(x.customer_action);
  const counts = act && (inclusive ? parseDt(act[2]) <= D : parseDt(act[2]) < D);
  if (counts) return x.result === (act[1] === 'cancel' ? 'cancelled by customer' : 'amended');
  const to = /^timed out at (.+)$/.exec(x.result);
  return !!to && parseDt(to[1]) > D && parseDt(to[1]) <= D + 60;
}
function picks(x) { return x.fulfilments.split('; ').map(f => /picked up \d/.test(f)); }
function anyPicked(x) { return picks(x).some(Boolean); }
function allPicked(x) { return picks(x).every(Boolean); }

/** Render a precedent as CSV text with an export header (the file the records carrier holds). */
export function precedentCsv(id, rows) {
  const p = PRECEDENTS[id];
  const esc = v => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [`# ${p.title}, exported 2026-02-28 by joost from the order admin (period 2026-02-01 .. 2026-02-27)`,
    p.columns.join(','), ...rows.map(x => p.columns.map(c => esc(x[c])).join(',')), ''].join('\n');
}

/** Coverage proof for one precedent: the rows fit the rule and contradict every alternative. */
export function discriminates(id, rows) {
  const p = PRECEDENTS[id];
  const refuted = Object.fromEntries(Object.entries(p.alts).map(([k, f]) => [k, !f(rows)]));
  return { id, fitsRule: p.rule(rows), refuted, ok: p.rule(rows) && Object.values(refuted).every(Boolean) };
}
