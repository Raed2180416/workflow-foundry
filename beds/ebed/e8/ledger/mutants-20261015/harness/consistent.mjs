// Host consistency of a witness journal's carrier side (actors.mjs, H-29; systems.mjs carrier.cancel). A carrier reports
// only on a shipment the arm booked (or a go-live shipment); every report states a time at or after the collection run
// R; a shipment cancelled (committed) before R is never reported on; a shipment cancel committed at or after R does not
// exist (the carrier collects, or fails to collect, at R in the host's phase 0, before any call of that instant, and then
// refuses the cancel with 409); reports arrive in order (collected or collectionFailed at R first, then inTransit, then
// delivered) or held up (W2: delivered first, then the late collected and inTransit reports), and never held up for an
// order that gets a customer cancel (SPEC-E §3.3, E8-8; 2026-10-15 re-review).
export function carrierConsistent(w, v, rows, horizon, collectionAt) {
  const cut = JSON.parse(w.rulebook.editions[0].files['policy.json']).collectionCutoffMinutes;
  const codes = JSON.parse(w.rulebook.editions[0].files['carrier-codes.json']);
  const meaning = e => codes.find(x => x.carrier === e.payload.carrier && x.code === e.payload.code)?.meaning ?? null;
  const reports = v.events.filter(e => e.type === 'carrier.status').sort((a, b) => a.at - b.at || a.seq - b.seq);
  const books = rows.filter(r => r.committed && r.system === 'carrier' && r.op === 'create');
  const cancels = rows.filter(r => r.committed && r.system === 'carrier' && r.op === 'cancel');
  const customerCancel = v.events.some(e => e.type === 'customer.action' && e.payload?.action === 'cancel');
  if (v.truth.class?.startsWith('gl-dispatched')) return null;
  for (const F of new Set([...reports.map(e => e.payload.fulfilmentRef), ...books.map(b => b.args.fulfilmentId)])) {
    const mine = reports.filter(e => e.payload.fulfilmentRef === F && meaning(e) !== 'info');
    const b = books.filter(x => x.args.fulfilmentId === F).sort((x, y) => x.at - y.at)[0];
    if (!b) { if (mine.length) return `report for unbooked ${F}`; continue; }
    const R = collectionAt(w, b.args.location, b.at, cut);
    if (cancels.some(x => x.args.fulfilmentId === F && x.at < R) && mine.length) return `report after a shipment cancel for ${F}`;
    if (R !== null && cancels.some(x => x.args.fulfilmentId === F && x.at >= R && !cancels.some(y => y.args.fulfilmentId === F && y.at < R))) return `shipment cancel for ${F} committed at or after its collection run`;
    if (mine.some(e => Date.parse(e.payload.reportedAt) < R || e.at < R)) return `report for ${F} before its collection run`;
    const first = mine[0];
    if (first && !(['collected', 'collectionFailed'].includes(meaning(first)) && first.at === R) && (meaning(first) !== 'delivered' || customerCancel)) return `first report for ${F} is ${meaning(first)} at ${first.at - R} ms from R${customerCancel ? ' (no held-up report on an order with a customer cancel)' : ''}`;
  }
  return null;
}

// The systems' own refusals (systems.mjs), so that every committed row of a witness is one the host could commit: a
// re-issued committed key is deduplicated (no second commit); `inventory.reserve` of an item with an active reservation
// is refused (409 already-reserved), `inventory.release` without one (409 no-active-reservation); `billing.refund` needs
// a charge and never exceeds it (404 no-charge, 409 over-refund); `carrier.create` is refused while the fulfilment has a
// live shipment (409 shipment-exists; a shipment is live until cancelled or reported collectionFailed); `carrier.cancel`
// needs a shipment (404); `orders.setStatus` needs the order recorded. Go-live cases start from exported records: skipped.
export function systemsConsistent(w, v, rows) {
  if (v.truth.class?.startsWith('gl-')) return null;
  const codes = JSON.parse(w.rulebook.editions[0].files['carrier-codes.json']);
  const failedAt = new Map();
  for (const e of v.events) if (e.type === 'carrier.status' && codes.find(x => x.carrier === e.payload.carrier && x.code === e.payload.code)?.meaning === 'collectionFailed') failedAt.set(e.payload.fulfilmentRef, Math.min(failedAt.get(e.payload.fulfilmentRef) ?? Infinity, e.at));
  const keys = new Set(), res = new Map(), chg = new Map(), shp = new Map();
  let created = false;
  for (const r of rows.filter(x => x.committed).sort((a, b) => a.at - b.at || a.seq - b.seq)) {
    const k = `${r.system}.${r.op}`, a = r.args ?? {};
    if (r.key !== null && r.key !== undefined) { const kk = `${r.system}\u0000${r.key}`; if (keys.has(kk)) continue; keys.add(kk); }
    if (k === 'orders.create') created = true;
    else if (k === 'orders.setStatus' && !created) return 'setStatus before the order is recorded';
    else if (k === 'inventory.reserve') { const id = `${a.fulfilmentId}/${a.sku}`; if (res.get(id)) return `second active reservation ${id}`; res.set(id, true); }
    else if (k === 'inventory.release') { const id = `${a.fulfilmentId}/${a.sku}`; if (!res.get(id)) return `release without an active reservation ${id}`; res.set(id, false); }
    else if (k === 'billing.charge') chg.set(a.fulfilmentId, { amount: a.amountMinor ?? a.amount, refunded: 0 });
    else if (k === 'billing.refund') { const c = chg.get(a.fulfilmentId); if (!c) return `refund without a charge ${a.fulfilmentId}`; if (c.refunded + a.amountMinor > c.amount) return `over-refund ${a.fulfilmentId}`; c.refunded += a.amountMinor; }
    else if (k === 'carrier.create') { const s = shp.get(a.fulfilmentId); if (s && s.live && !(failedAt.get(a.fulfilmentId) <= r.at)) return `second live shipment ${a.fulfilmentId}`; shp.set(a.fulfilmentId, { live: true }); }
    else if (k === 'carrier.cancel') { const s = shp.get(a.fulfilmentId); if (!s) return `shipment cancel without a shipment ${a.fulfilmentId}`; s.live = false; }
  }
  return null;
}
