// The OT-0 world overlay on E8 (research/org-20261021/PREDICTION.md §1). It wraps E8 through its exported API and never
// edits it: the world, the host binding and the oracle item are copied and extended.
//   world   principals for E8's scripted actors: who entered each customer action (`enteredBy` in the payload: the
//           customer through the portal, or a customer-service agent), the finance-approver and controller pools, and one
//           planted SoD trap per world; world.id is unchanged, so every E8 draw (noise, carriers, analysts) is identical.
//   binding the host binding plus the `refundApproval` task kind and its scripted approver (actors.answer).
//   oracle  "E8 + C2 overlay": E8's referenceTransition, with the approval task permitted and, for a fulfilment whose refund
//           waited for an approval, the refund's and its releases' windows extended to the approval answer + 120 min.
// The constitution timeline (v1, v2 at day 7, planted v3 at day 9) is the registry's (registry.mjs), the same in every world.
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { gradeStream } from '../../beds/ebed/oracle/grade.mjs';
import { rng } from '../../beds/lib/rng.mjs';
import { buildRegistry } from './registry.mjs';
import { thresholdOf } from './constitution.mjs';

const MIN = 60_000;
export const ANSWER_SCHEMA = Object.freeze({ type: 'object', required: ['decision'], additionalProperties: false, properties: { decision: { enum: ['approve', 'reject'] } } });
export const APPROVAL_KIND = 'refundApproval';
export const POOLS = Object.freeze({ 'finance-approver': ['u-cs1', 'u-fin1', 'u-fin2'], controller: ['u-ctl1'] });
// cancel-at-collection is not a trap class: its cancel meets the collection, which wins (SPEC-E S4), so nothing is refunded.
export const CANCEL_CLASSES = Object.freeze(['cancel-processing', 'amend-then-cancel']);
export const ENTERED_BY_SHARES = Object.freeze({ portal: 0.5, 'u-cs1': 0.25, 'u-cs2': 0.25 });

/** The OT-0 worlds (seed ledger block ebed-e8-rehearsal, dev rehearsals 1232-1234). */
export const OT0_WORLDS = Object.freeze([
  ...[2, 3, 5].flatMap(d => [1232, 1233, 1234].map(seed => ({ seed, d, size: null }))),
  { seed: 1232, d: 2, size: 12 },
]);
export const ALLOWED_SEED = s => s >= 1232 && s <= 1234;
export const worldLabel = w => `${w.seed}-d${w.d}${w.size ? `-s${w.size}` : ''}`;
export const baseWorld = ({ seed, d, size = null }) => {
  if (!ALLOWED_SEED(seed)) throw new Error(`seed ${seed}: OT-0 uses the E8 dev rehearsal worlds 1232-1234 only`);
  return e8.generateWorld({ seed, difficulty: d, mix: 'tail', ...(size ? { size } : {}) });
};

const norm = s => (typeof s === 'string' ? s.trim().replace(/^#/, '').toUpperCase() : null);

/** The edition in force at a placement (SPEC-E R1.3): the published edition with the latest effectiveFrom on or before the placement date. */
export function editionAtPlacement(world, placedAt) {
  const day = placedAt.slice(0, 10);
  const eds = world.rulebook.editions.filter(e => e.effectiveFrom <= day).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  const ed = eds.at(-1);
  return { id: ed.id, fees: JSON.parse(ed.files['shipping-fees.json']) };
}

/** Fulfilment amounts per order from world master data (the same data every arm sees): items at catalog prices plus the
 *  location's fee at the edition in force at placement. */
export function fulfilmentAmounts(world, orderId, placedAt) {
  const alloc = world.sor['inventory.allocations'].find(a => a.orderId === orderId);
  if (!alloc) return {};
  const price = sku => world.master.catalog.find(c => c.sku === sku)?.unitPriceMinor ?? 0;
  const { fees } = editionAtPlacement(world, placedAt);
  const out = {};
  for (const f of alloc.fulfilments) {
    if (!f.available) continue;
    out[f.fulfilmentId] = f.items.reduce((s, i) => s + i.qty * price(i.sku), 0) + (fees.find(x => x.location === f.location)?.feeMinor ?? 0);
  }
  return out;
}

/** The overlay world (a copy; world.id unchanged). */
export function overlayWorld(base, { registry = buildRegistry() } = {}) {
  const w = structuredClone(base);
  const byEmail = new Map(w.master.customers.map(c => [c.email, c.customerId]));
  const enteredBy = {};
  // The planted SoD trap: the earliest-placed cancel-race order whose largest fulfilment exceeds the pinned T.
  const cand = Object.entries(w.truth.cases).filter(([, t]) => t.subject && CANCEL_CLASSES.includes(t.class) && (t.actions ?? []).some(a => a.action === 'cancel'))
    .map(([c, t]) => {
      const amounts = Object.values(fulfilmentAmounts(w, t.subject, t.placedAt));
      const T = thresholdOf(registry.inForceAt(t.placedAt).doc);
      return { c, t, max: amounts.length ? Math.max(...amounts) : 0, T };
    })
    .filter(x => x.max > x.T)
    .sort((a, b) => Date.parse(a.t.placedAt) - Date.parse(b.t.placedAt) || (a.c < b.c ? -1 : 1));
  const plant = cand[0] ? { case: cand[0].c, orderId: cand[0].t.subject, class: cand[0].t.class, maxAmountMinor: cand[0].max, thresholdMinor: cand[0].T,
    events: cand[0].t.actions.filter(a => ['cancel', 'amend'].includes(a.action)).map(a => a.id) } : null;
  const planted = new Set(plant?.events ?? []);
  for (const ev of w.arrivals) {
    if (ev.type !== 'customer.action') continue;
    const c = w.truth.eventCase[ev.id];
    const t = c ? w.truth.cases[c] : null;
    const customerId = t?.customerId ?? byEmail.get(ev.payload.from) ?? 'unknown';
    let who;
    if (planted.has(ev.id)) who = 'u-cs1';
    else {
      const u = rng('ot0/entered-by', w.id, ev.id).next();
      who = u < ENTERED_BY_SHARES.portal ? `cust:${customerId}` : u < ENTERED_BY_SHARES.portal + ENTERED_BY_SHARES['u-cs1'] ? 'u-cs1' : 'u-cs2';
    }
    ev.payload = { ...ev.payload, enteredBy: who };
    enteredBy[ev.id] = who;
  }
  w.actorsPool = { ...w.actorsPool, ...structuredClone(POOLS) };
  w.truth.ot0 = { enteredBy, plant, overlay: 'ot0/1' };
  return w;
}

/** The scripted approver: approves a refund (or a break-glass request) after 5-30 minutes; E8's analysts otherwise. */
function answer(world, ctx) {
  if (ctx.kind !== APPROVAL_KIND) return e8.actors.answer(world, ctx);
  const t = world.truth.cases[ctx.case];
  if (!t || t.subject === null) return null;
  const r = rng('ot0/approver', world.id, ctx.case, ctx.ordinal);
  return { value: { decision: 'approve' }, delayMinutes: r.int(5, 30), text: 'approve - the refund matches the original charge' };
}

/** The host binding with the refund-approval task kind (frozen E8 binding copied, never mutated). */
export const overlayBinding = Object.freeze({
  ...e8.binding,
  schemas: { ...e8.binding.schemas, humanTasks: { ...e8.binding.schemas.humanTasks,
    [APPROVAL_KIND]: { description: 'a finance approver approves or rejects one refund above the constitution\'s threshold (clause C2); subject = the fulfilment id; answer { decision: approve | reject }', answerSchema: ANSWER_SCHEMA } } },
  actors: { answer, counterparty: e8.actors.counterparty },
});

/** E8 + C2 overlay: the item's transition with the approval wait permitted (see the header). */
export function overlayTransition(world, view) {
  const E = e8.referenceTransition(world, view);
  const t0 = Date.parse(world.t0), H = Date.parse(world.horizonEnd);
  const perm = [{ kind: APPROVAL_KIND, role: 'finance-approver', window: { earliest: t0, latest: H } }, { kind: APPROVAL_KIND, role: 'controller', window: { earliest: t0, latest: H } }];
  const ext = new Map();                 // fulfilment -> the instant its approval wait ended (horizon while still open)
  for (const tk of view.tasks ?? []) {
    if (tk.task?.kind !== APPROVAL_KIND) continue;
    const F = tk.task.subject;
    const ans = (view.taskEvents ?? []).filter(e => e.payload?.taskId === tk.task.id);
    const done = ans.find(e => e.type === 'humanTask.answered');
    const end = done ? done.at : ans.some(e => ['humanTask.timeout', 'humanTask.withdrawn', 'humanTask.answerRejected'].includes(e.type)) ? ans.at(-1).at : H;
    ext.set(F, Math.max(ext.get(F) ?? 0, end));
  }
  if (!ext.size) return { ...E, humanTasks: { ...E.humanTasks, permitted: [...E.humanTasks.permitted, ...perm] } };
  const required = E.effects.required.map(e => {
    const F = e.match?.fulfilmentId;
    const comp = (e.system === 'billing' && e.op === 'refund') || (e.system === 'inventory' && e.op === 'release');
    if (!comp || !ext.has(F)) return e;
    const latest = Math.max(e.window.latest, Math.min(H, ext.get(F) + 120 * MIN));
    return latest === e.window.latest ? e : { ...e, window: { ...e.window, latest } };
  });
  return { ...E, effects: { ...E.effects, required }, humanTasks: { ...E.humanTasks, permitted: [...E.humanTasks.permitted, ...perm] } };
}

/** The oracle item for "E8 + C2 overlay" (E8's hooks with the wrapped transition). */
export const overlayItem = Object.freeze({ ...e8.oracleItem, referenceTransition: overlayTransition });
export const overlayOracle = (world, rows, { pools = null, arm = null } = {}) => gradeStream({ item: overlayItem, world, rows, pools, arm });

/** The orders of a world with placement, customer and amounts (analyst-side ground truth for the observer's tests). */
export function ordersOf(world) {
  const out = {};
  for (const [c, t] of Object.entries(world.truth.cases)) if (t.subject) out[t.subject] = { case: c, placedAt: t.placedAt, class: t.class, customerId: t.customerId, amounts: fulfilmentAmounts(world, t.subject, t.placedAt) };
  return out;
}
export { norm as normOrderRef };
