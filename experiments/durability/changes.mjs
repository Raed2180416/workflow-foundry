// DUR-1 change operators and world bundles (research/durability-20261021/PREREG-DUR-1.md §2, §4; BUILD-PLAN row 2). $0,
// analyst side: this module builds the worlds, the oracle item and the host binding a stream world runs under. No arm
// imports it (the heal evidence builder's import closure is checked for it, V-7).
//
// A world bundle is { W (the generated world with every change in force applied), item (the oracle item: a COPY of
// beds/ebed/e8/transition.mjs with every rule-change edit, each gated by its own placement date read from
// W.truth.dur1Eff), binding (the host binding: spec text at t0, actors), wrapArm (platform faults of F), announcements,
// specAt(ms), configAt(ms) }. The original transition, actors and world generator are never edited.
//
// Operators (prereg §4.1):
//   P1   new rulebook edition ed-2026-3 (published, then effective; policy, fee table, two PARCELLA codes renamed) and
//        the carriers' matching behaviour for orders placed under it (cut-off 45 min, renamed codes): an actor wrapper.
//   E1   F5 rename carrier.create location -> site (host fault schedule; the API schema file shows it from its onset).
//   E1r  the rename is gone (E1 not in force); its twin is the world with E1 still in force.
//   R1   drift D1 review-timeout-clears (experiments/compose/drift.mjs) gated by placement >= effectiveFrom, plus its
//        world change (10 straight orders placed in [d5, d10) become late-answered reviews).
//   L1   MR11 failures (beds/ebed/e8/metamorphic.mjs injectFailures) on a seeded 15% of straight orders.
//   F    transient (W5 only): crash-after-apply with probability 0.15 (d-1)/13 per effectful tick, a restart before
//        every 7th tick, delayed duplicates (7 min) of 10% of placements and of carrier reports.
//   ADV  instruction lines in every order document (generateWorld({ injection: true })); the adversarial complaint is
//        complaints.mjs's.
//   R2s, E2s, U1s  sealed: from the sealed bundle (loadSealed; count-only outside this module).
// Twins (exposure.mjs): an excluded data change is simply not applied; an excluded RULE change keeps its world operator
// and only its gate is off (effective date +Infinity), so twin(W, R) isolates the rule from the load it brings.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { generateWorld, collectionRuns, minutesOf, CARRIER_CODES } from '../../beds/ebed/e8/world.mjs';
import { actors as baseActors } from '../../beds/ebed/e8/actors.mjs';
import { rng } from '../../beds/lib/rng.mjs';
import { DRIFTS } from '../compose/drift.mjs';
import { CHANGES, CHANGE_IDS, T0_MS, MIN, DAY_MS, dayStart, dayOf, isoLocal, dateLocal, effOf } from './schedule.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const TRANSITION_FILE = path.join(ROOT, 'beds/ebed/e8/transition.mjs');
export const WORK = process.env.DUR1_WORK ?? '/var/tmp/foundry-work/dur1';
const sha = s => createHash('sha256').update(s).digest('hex');
const clone = x => structuredClone(x);
const sortArrivals = list => list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));

let scratch = null;
/** A per-process scratch directory for transition copies (removed at exit). */
export function scratchDir() {
  if (scratch && existsSync(scratch)) return scratch;
  mkdirSync(WORK, { recursive: true });
  scratch = mkdtempSync(path.join(WORK, 'tx-'));
  process.once('exit', () => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* gone */ } });
  return scratch;
}

/** Replace `from` by `to`; the anchor must occur exactly once (drift.mjs `once`). */
export function once(text, from, to, where) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${where}: the anchor occurs ${n} times (expected once): ${from.slice(0, 80)}`);
  return text.replace(from, () => to);
}

// ---------------------------------------------------------------------------------------------------------------------
// Rule changes: one transition copy with every edit, each gated by its own placement date (W.truth.dur1Eff[id]).

const D1 = DRIFTS['review-timeout-clears'];
/** R1 = drift D1, gated: an order placed at or after R1's effective time follows the new rule (p >= eff, never p > eff). */
export const R1_EDIT = Object.freeze({ id: 'R1', from: D1.transition[0].from,
  to: `    if (!ans && !(p >= __durEff(world, 'R1'))) return cancelOrder('R2.2', deadline + SEC, deadline + 120 * MIN, deadline);         // after the deadline (S1)
    if (!ans) cleared = deadline + SEC;                                                            // DUR-1 R1 = drift D1, gated by placement (p >= effectiveFrom)
    else if (ans.payload.answer.decision === 'reject') return cancelOrder('R2.2', ans.at, ans.at + 120 * MIN);
    else cleared = ans.at;` });
const GATE_HEADER = `// DUR-1 copy of beds/ebed/e8/transition.mjs with gated rule-change edits (experiments/durability/changes.mjs). Do not edit.
const __durEff = (world, id) => { const v = world?.truth?.dur1Eff?.[id]; return typeof v === 'number' ? v : Infinity; };
`;

/** The transition source with the given edits ([{ id, from, to }]) applied in order, each anchor exactly once. */
export function transitionSource(edits) {
  let src = readFileSync(TRANSITION_FILE, 'utf8');
  for (const e of edits) src = once(src, e.from, e.to, `transition.mjs (${e.id})`);
  return GATE_HEADER + src;
}

const itemCache = new Map();
/** The oracle item for a set of rule edits (cached by source digest; the copy is imported from the scratch dir). */
export async function itemFor(edits) {
  const src = transitionSource(edits);
  const digest = sha(src);
  if (itemCache.has(digest)) return itemCache.get(digest);
  const file = path.join(scratchDir(), `transition-dur1-${digest.slice(0, 16)}.mjs`);
  writeFileSync(file, src);
  const mod = await import(pathToFileURL(file).href);
  const item = Object.freeze({ ...e8.oracleItem, referenceTransition: mod.referenceTransition, canonicalArgs: mod.canonicalArgs, recordsOf: mod.recordsOf, dur1Digest: digest, dur1File: file });
  itemCache.set(digest, item);
  return item;
}

/** Every rule edit DUR-1 knows: R1 always, then the sealed bundle's (R2s, U1s) when one is loaded. */
export function ruleEdits(sealed = null) {
  const out = [R1_EDIT];
  for (const id of ['R2s', 'U1s']) for (const [i, e] of (sealed?.change(id)?.transition ?? []).entries()) out.push({ id: `${id}#${i}`, from: e.from, to: e.to });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// P1: the new edition, and carriers that follow it.

export const P1_EDITION = Object.freeze({
  id: 'ed-2026-3',
  policy: Object.freeze({ customerActionHours: 3, fraudReviewHours: 12, collectionCutoffMinutes: 45 }),
  feeDelta: 100,                                                   // a new fee table: every location's fee +EUR 1.00
  codeRenames: Object.freeze({ PARCELLA: Object.freeze({ IN_TRANSIT: 'TRANSIT', NOT_COLLECTED: 'COLLECTION_FAILED' }) }),
});

/** Add an edition effective from `fromMs` (a day boundary), published at `publishMs`; earlier editions end there. */
export function addEdition(W, { id, policy, feeDelta = 0, feeTable = null, codeRenames = {}, fromMs, publishMs }) {
  const Wt = clone(W);
  const from = dateLocal(fromMs);
  const last = Wt.rulebook.editions.at(-1);
  const prevPolicy = JSON.parse(last.files['policy.json']);
  const prevFees = JSON.parse(last.files['shipping-fees.json']);
  const prevCodes = JSON.parse(last.files['carrier-codes.json']);
  for (const e of Wt.rulebook.editions) if (e.effectiveTo === null || e.effectiveTo > from) e.effectiveTo = from;
  Wt.rulebook.editions = Wt.rulebook.editions.filter(e => e.effectiveFrom < from);
  const fees = feeTable ?? prevFees.map(f => ({ ...f, feeMinor: f.feeMinor + feeDelta }));
  const codes = prevCodes.map(c => ({ ...c, code: codeRenames[c.carrier]?.[c.code] ?? c.code }));
  Wt.rulebook.editions.push({ id, effectiveFrom: from, effectiveTo: null, published: isoLocal(publishMs),
    files: { 'edition.json': JSON.stringify({ id, effectiveFrom: from }, null, 1), 'policy.json': JSON.stringify({ ...prevPolicy, ...(policy ?? {}) }, null, 1),
      'shipping-fees.json': JSON.stringify(fees, null, 1), 'carrier-codes.json': JSON.stringify(codes, null, 1) } });
  return Wt;
}

/** The edition in force for an order placed at pMs (R1.3, the transition's editionAt reading). */
export function editionOf(W, pMs) {
  const date = dateLocal(pMs);
  return W.rulebook.editions.find(e => e.effectiveFrom <= date && (e.effectiveTo === null || date < e.effectiveTo)) ?? null;
}

/** Does any edition of W differ from the generator's base edition in cut-off or carrier codes? */
export function needsEditionCarriers(W) {
  return W.rulebook.editions.some(e => JSON.parse(e.files['policy.json']).collectionCutoffMinutes !== 30
    || JSON.parse(e.files['carrier-codes.json']).some(c => !CARRIER_CODES.some(b => b.carrier === c.carrier && b.code === c.code && b.meaning === c.meaning)));
}

/**
 * Carriers that follow the edition of the order's placement (cut-off and codes), as a wrapper of the item's actors: the
 * base carrier collects at the first run >= booking + 30 min; under an edition with another cut-off every step from the
 * collection on moves to the first run >= booking + cut-off (the base steps are all relative to the collection or the
 * delivery), and each report's code is the edition's code for the same carrier and meaning (the base code's meaning).
 */
export function editionCarriers(inner = baseActors) {
  const baseMeaning = (carrier, code) => CARRIER_CODES.find(c => c.carrier === carrier && c.code === code)?.meaning ?? null;
  return Object.freeze({
    answer: (w, ctx) => inner.answer(w, ctx),
    counterparty: (w, ctx) => {
      const r = inner.counterparty(w, ctx);
      if (!r || ctx.effect.system !== 'carrier' || ctx.effect.op !== 'create') return r;
      const a = ctx.effect.args;
      const c = w.truth.objectCase?.[a.fulfilmentId];
      const t = c ? w.truth.cases[c] : null;
      if (!t?.placedAt) return r;
      const ed = editionOf(w, Date.parse(t.placedAt));
      if (!ed) return r;
      const cut = JSON.parse(ed.files['policy.json']).collectionCutoffMinutes ?? 30;
      const codes = JSON.parse(ed.files['carrier-codes.json']);
      const loc = w.truth.locations.find(l => l.location === a.location);
      const exact = (Date.parse(ctx.at) - Date.parse(w.t0)) / 60_000;
      const R30 = collectionRuns(loc).find(m => m >= exact + 30) ?? null;
      const Rk = collectionRuns(loc).find(m => m >= exact + cut) ?? null;
      if (R30 === null || Rk === null) return Rk === null ? null : r;
      const delta = (Rk - R30) * MIN;
      const t0 = Date.parse(w.t0), R30ms = t0 + R30 * MIN;
      const shift = s => (delta && Date.parse(s) >= R30ms ? isoLocal(Date.parse(s) + delta) : s);
      return { ...r, steps: r.steps.map(s => {
        const ev = s.event ? { ...s.event, payload: { ...s.event.payload } } : null;
        if (ev) {
          if (ev.payload.reportedAt) ev.payload.reportedAt = shift(ev.payload.reportedAt);
          const meaning = baseMeaning(ev.payload.carrier, ev.payload.code);
          const now = meaning ? codes.find(x => x.carrier === ev.payload.carrier && x.meaning === meaning)?.code : null;
          if (now) ev.payload.code = now;
        }
        return { ...s, at: shift(s.at), ...(ev ? { event: ev } : {}) };
      }) };
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Data operators

/** F5 rename from `atMs` (host fault schedule: from then the mock accepts only `to`; the API file shows it). */
export function addRename(W, { system, op, from, to, atMs }) {
  const Wt = clone(W);
  Wt.faults.push({ at: isoLocal(Math.max(atMs, T0_MS)), system, op, kind: 'F5', params: { from, to } });
  return Wt;
}

/** R1's world change: up to n straight orders placed in [from, to) with every item available become reviews answered after 25-30 h. */
export function reviewLoad(W, { n = 10, fromMs, toMs, salt }) {
  const Wt = clone(W);
  const r = rng('dur1/R1/world', salt, W.id);
  const cands = Object.entries(Wt.truth.cases).filter(([, t]) => t.subject && t.class === 'straight' && Date.parse(t.placedAt) >= fromMs && Date.parse(t.placedAt) < toMs)
    .filter(([, t]) => Wt.sor['inventory.allocations'].find(a => a.orderId === t.subject).fulfilments.every(f => f.available));
  const converted = [];
  for (const [c, t] of cands) {
    if (converted.length >= n) break;
    t.verdict = 'review'; t.class = 'review-timeout'; t.tail = true;
    t.review = { decision: 'approve', delay: r.int(25 * 60, 30 * 60) };
    Wt.sor['fraud.verdicts'].push({ orderId: t.subject, verdict: 'review' });
    converted.push(c);
  }
  return { W: Wt, converted };
}

const L1_KINDS = Object.freeze(['f6-charge', 'f6-reserve', 'f6-carrier', 'collection-failed', 'cancel+1', 'cancel+2', 'cancel+3', 'cancel+45']);
/** L1: MR11 failures (metamorphic.mjs injectFailures, the same per-kind edits) on a seeded `share` of the straight orders. */
export function failureLoad(W, { share = 0.15, salt }) {
  const Wt = clone(W);
  const r = rng('dur1/L1', salt, W.id);
  const locs = W.master.locations;
  const blocked = m => locs.some(l => collectionRuns(l).some(x => m >= x - 70 && m < x));
  const straight = Object.entries(W.truth.cases).filter(([, t]) => t.class === 'straight' && t.subject)
    .filter(([, t]) => W.sor['inventory.allocations'].find(a => a.orderId === t.subject).fulfilments.some(f => f.available));
  const chosen = straight.filter(() => r.next() < share);
  const injected = [];
  let k = 0;
  for (const [c, t] of chosen) {
    const kind = L1_KINDS[k % L1_KINDS.length];
    const T = Wt.truth.cases[c];
    const alloc = W.sor['inventory.allocations'].find(a => a.orderId === t.subject).fulfilments.filter(f => f.available);
    const p = minutesOf(t.placedAt);
    if (kind.startsWith('cancel+')) {
      const m = p + Number(kind.slice(7));
      if (blocked(m) || blocked(m + 1)) { k += 1; continue; }
      const id = `ev-${t.subject}-act-dur1l1`;
      const at = isoLocal(Date.parse(W.t0) + m * MIN);
      Wt.arrivals.push({ id, type: 'customer.action', at, source: 'customer-portal', channel: { kind: 'inbound' }, payload: { orderRef: t.subject, action: 'cancel', from: t.email } });
      Wt.truth.eventCase[id] = c;
      T.actions.push({ id, action: 'cancel', at });
      for (const f of alloc) T.fulfilments[f.fulfilmentId].ooo = false;
    } else if (kind === 'collection-failed') T.fulfilments[alloc[0].fulfilmentId].scenario = 'collectionFailed';
    else {
      const [system, op] = { 'f6-charge': ['billing', 'charge'], 'f6-reserve': ['inventory', 'reserve'], 'f6-carrier': ['carrier', 'create'] }[kind];
      const nItems = alloc.reduce((s, f) => s + f.items.length, 0);
      if (Wt.faults.some(f => f.case === c && f.system === system && f.op === op)) { k += 1; continue; }
      Wt.faults.push({ case: c, system, op, ordinal: kind === 'f6-reserve' && nItems > 1 ? 2 : 1, kind: 'F6' });
    }
    T.class = `l1-${kind}`;
    injected.push({ case: c, kind });
    k += 1;
  }
  sortArrivals(Wt.arrivals);
  return { W: Wt, injected };
}

/** F (world part): placements (10%) repeated 7 minutes later; the carrier-report part is the actor wrapper below. */
export function duplicatePlacements(W, { share = 0.1, salt }) {
  const Wt = clone(W);
  const touched = new Set();
  const extra = [];
  for (const a of W.arrivals) {
    if (a.type !== 'order.placed') continue;
    if (!(rng('dur1/F/dup', salt, W.id, a.id).next() < share)) continue;
    const id = `${a.id}~dur1d`;
    const c = W.truth.eventCase[a.id];
    extra.push({ ...clone(a), id, at: isoLocal(Date.parse(a.at) + 7 * MIN) });
    Wt.truth.eventCase[id] = c;
    touched.add(c);
  }
  Wt.arrivals = sortArrivals([...Wt.arrivals, ...extra]);
  return { W: Wt, touched };
}
const AFTER = { created: ['created', 'collected', 'inTransit', 'delivered'], collected: ['collected', 'inTransit', 'delivered'], inTransit: ['inTransit', 'delivered'], delivered: ['delivered'], failed: ['failed'] };
/** F (actor part): 10% of carrier reports repeated 7 minutes later (MR5 'delayed' guards), keyed by fulfilment and step. */
export function duplicateReports(inner, { share = 0.1, salt }) {
  return Object.freeze({
    answer: (w, ctx) => inner.answer(w, ctx),
    counterparty: (w, ctx) => {
      const r = inner.counterparty(w, ctx);
      if (!r?.steps) return r;
      const steps = [...r.steps];
      r.steps.forEach((s, i) => {
        if (!s.event || !(rng('dur1/F/report', salt, w.id, ctx.effect.args?.fulfilmentId, ctx.ordinal, i).next() < share)) return;
        const status = s.write?.row?.status ?? null;
        steps.push({ at: isoLocal(Date.parse(s.at) + 7 * MIN), guard: s.guard ? { ...s.guard, in: status ? AFTER[status] : AFTER.created } : null, event: s.event });
      });
      return { ...r, steps };
    },
  });
}

/**
 * F (platform part): one wrapper for crash-after-apply and restarts (one shared state, so a restart never drops a crash's
 * redelivery). A crash: the tick's effects and tasks go out, the carry rolls back to the input's, timers are dropped, the
 * process restarts, the tick's events are prepended to the instance's next tick (experiments/compose/faults.mjs withCrash).
 * The crash draw is rng('dur1/F/crash', salt, instance, n-th effectful tick of the instance) < prob(now).
 */
const WRITES = new Set(['orders.create', 'orders.setStatus', 'inventory.reserve', 'inventory.release', 'billing.charge', 'billing.refund', 'carrier.create', 'carrier.cancel', 'notify.send']);
export const crashProb = nowMs => (0.15 * (dayOf(nowMs) - 1)) / 13;
export function withFaultRamp(arm, factory, { salt, restartEvery = 7, prob = crashProb, fromMs = -Infinity } = {}) {
  let cur = arm, n = 0;
  const stash = new Map(), per = new Map(), log = [];
  return {
    id: `${arm.id}+dur1F`,
    faults: log,
    async tick(input0, ctx) {
      const now = Date.parse(input0.now);
      if (now >= fromMs) {
        n += 1;
        if (n % restartEvery === 0) { try { cur.close?.(); } catch { /* gone */ } cur = factory(); log.push({ kind: 'restart', at: input0.now, instance: input0.instance }); }
      }
      const redelivered = stash.get(input0.instance) ?? null;
      if (redelivered) stash.delete(input0.instance);
      const input = redelivered ? { ...input0, events: [...redelivered, ...input0.events] } : input0;
      const out = await cur.tick(input, ctx);
      const writes = Array.isArray(out?.effects) ? out.effects.filter(e => WRITES.has(`${e?.system}.${e?.op}`)) : [];
      if (now < fromMs || redelivered || !writes.length || out.merge || out.close) return out;
      const k = (per.get(input.instance) ?? 0) + 1;
      per.set(input.instance, k);
      if (!(rng('dur1/F/crash', salt, input.instance, k).next() < prob(now))) return out;
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
// The sealed bundle (R2s, E2s, U1s): stored outside the repo, hash-checked, count-only outside this module.

/**
 * loadSealed(file, { sha256 }) → { sha256, change(id), counts() }. Refuses a bundle whose file digest is not the frozen
 * one. Bundle schema dur1-sealed/1: { changes: { R2s: { label, prediction, onset: { day }, publish: { day, time },
 * transition: [{ from, to }], spec: [{ from, to }], worldOp: '<function source>' }, E2s: { onset: { day }, edition?:
 * { policy?, feeDelta?, codeRenames? }, renames?: [{ system, op, from, to }] }, U1s: { onset: { day }, transition, worldOp,
 * complaintTemplates: [..] } } }.
 */
export function loadSealed(file, { sha256: expect = null } = {}) {
  const text = readFileSync(file, 'utf8');
  const digest = sha(text);
  if (expect !== null && digest !== expect) { const e = new Error(`DUR1_SEALED_HASH: ${file} has sha256 ${digest.slice(0, 16)}…, frozen ${String(expect).slice(0, 16)}…`); e.code = 'DUR1_SEALED_HASH'; throw e; }
  const b = JSON.parse(text);
  if (b.schema !== 'dur1-sealed/1') throw new Error(`sealed bundle: schema must be dur1-sealed/1 (got ${b.schema})`);
  for (const id of ['R2s', 'E2s', 'U1s']) if (!b.changes?.[id]) throw new Error(`sealed bundle: change ${id} missing`);
  return Object.freeze({ sha256: digest, stub: !!b.stub, change: id => b.changes[id] ?? null,
    onsets: () => Object.fromEntries(['R2s', 'E2s', 'U1s'].map(id => [id, { day: b.changes[id].onset.day, ...(b.changes[id].publish ? { publishDay: b.changes[id].publish.day, publishTime: b.changes[id].publish.time ?? '09:00' } : {}) }])),
    counts: () => Object.fromEntries(['R2s', 'E2s', 'U1s'].map(id => [id, { transitionEdits: b.changes[id].transition?.length ?? 0, specEdits: b.changes[id].spec?.length ?? 0,
      renames: b.changes[id].renames?.length ?? 0, edition: !!b.changes[id].edition, worldOp: !!b.changes[id].worldOp, complaintTemplates: b.changes[id].complaintTemplates?.length ?? 0 }])) });
}

/**
 * Run a sealed world operator (function source, written by the sealed-author model session) OUT OF PROCESS (review R2-M12:
 * the in-process VM exposed host objects, so `clone.constructor('return process')()` reached the harness, and the call
 * itself had no time limit). worldop-worker.mjs runs it in a child under Node's permission model (reads limited to the
 * code it imports; no writes, child processes, workers or addons; an empty environment), inside a VM context whose
 * helpers are the child's own, with a time limit on the definition AND the call; the world goes in and out as JSON.
 * Results are cached per (source, world, id, salt, eff) digest, so a world built many times pays one child.
 */
export const WORLDOP_TIMEOUT_MS = 20_000;
const WORLDOP_WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'worldop-worker.mjs');
const worldOpCache = new Map();
export function runWorldOp(source, W, { id, salt, eff }) {
  const input = JSON.stringify({ source, W, id, salt, eff, timeoutMs: WORLDOP_TIMEOUT_MS });
  const key = sha(input);
  if (!worldOpCache.has(key)) {
    const allow = ['experiments', 'beds/ebed', 'beds/lib', 'src'].map(d => `--allow-fs-read=${path.join(ROOT, d)}`);
    const r = spawnSync(process.execPath, ['--permission', ...allow, WORLDOP_WORKER], { input, env: {}, encoding: 'utf8', timeout: WORLDOP_TIMEOUT_MS + 15_000, maxBuffer: 1 << 30, killSignal: 'SIGKILL' });
    if (r.error || r.status !== 0) throw new Error(`sealed ${id}: worldOp failed in its sandbox (${r.error?.code ?? `exit ${r.status}`}): ${String(r.stderr ?? '').slice(0, 400)}`);
    let out;
    try { out = JSON.parse(r.stdout); } catch { throw new Error(`sealed ${id}: worldOp sandbox returned no JSON`); }
    if (!out.ok) throw new Error(`sealed ${id}: ${out.error}`);
    if (worldOpCache.size > 64) worldOpCache.delete(worldOpCache.keys().next().value);
    worldOpCache.set(key, JSON.stringify(out.W));
  }
  const out = JSON.parse(worldOpCache.get(key));
  if (!out || typeof out !== 'object' || !out.truth) throw new Error(`sealed ${id}: worldOp must return a world`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Spec text

const BASE_SPEC = e8.specE.text;
/**
 * The in-world names of announced changes (review mi8: the spec notice, CHANGE.md and the heal session's notice list
 * showed the harness ids, e.g. "R2s", whose suffix marks a sealed change). Arms and sessions only ever see these.
 */
export const PUBLIC_ID = Object.freeze({ R1: 'CN-1', R2s: 'CN-2', P1: 'ed-2026-3' });
const notice = (id, publishMs, effMs, body) => `> **Change notice ${PUBLIC_ID[id] ?? id}** (published ${isoLocal(publishMs)}): ${body} Orders placed on or after ${isoLocal(effMs)}
> follow the rule as written below; orders placed earlier keep the previous reading${id === 'R1' ? ' (a fraud review with no usable answer by its deadline cancels the order, R2.2 before this notice)' : ''}.\n\n`;

/** The in-world change notice of an announced spec change as it reads in a spec text (null if not there). */
export function noticeOf(text, id) {
  const head = `> **Change notice ${PUBLIC_ID[id] ?? id}**`;
  const i = text.indexOf(head);
  if (i < 0) return null;
  const j = text.indexOf('\n\n', i);
  return text.slice(i, j < 0 ? undefined : j).trim();
}

/** The spec text in force at `ms` for a bundle's announced spec changes (published at or before ms). */
export function specText(specChanges, ms) {
  let text = BASE_SPEC, head = '';
  for (const c of specChanges) {
    if (c.publishMs === null || c.publishMs > ms) continue;
    for (const e of c.edits) text = once(text, e.from, e.to, `SPEC-E.md (${c.id})`);
    head += notice(c.id, c.publishMs, c.effMs, c.summary);
  }
  return head ? `${head}${text}` : text;
}

// ---------------------------------------------------------------------------------------------------------------------
// The bundle

const configDigest = parts => sha(JSON.stringify(parts)).slice(0, 16);

/**
 * buildBundle(spec, { sealed, exclude, base }) → the world bundle. spec = { stream, k, seed, size, difficulty, mix, changes:
 * [{ id, onsetMs, publishMs, startsHere }] }. exclude: change ids switched off (incremental twin); base: every DUR change
 * off (base twin). E1r excluded means E1 still in force (its twin).
 */
export async function buildBundle(spec, { sealed = null, exclude = [], base = false } = {}) {
  const want = id => !base && !exclude.includes(id) && spec.changes.some(c => c.id === id);
  const ch = id => spec.changes.find(c => c.id === id) ?? null;
  for (const c of spec.changes) if (CHANGES[c.id].sealed && !sealed) throw new Error(`world ${spec.stream}/W${spec.k} needs the sealed bundle for ${c.id}`);
  for (const c of spec.changes) if (c.onsetMs === null) throw new Error(`world ${spec.stream}/W${spec.k}: ${c.id} has no onset`);
  const salt = `${spec.stream}/${spec.seed}`;
  let W = generateWorld({ seed: spec.seed, difficulty: spec.difficulty ?? 3, mix: spec.mix ?? 'tail', size: spec.size, injection: want('ADV') });
  W.truth.dur1Eff = {};
  W.truth.dur1 = { stream: spec.stream, k: spec.k, active: [], exclude: base ? ['*'] : [...exclude] };
  const touched = {}, specChanges = [], announcements = [];
  let actors = baseActors;
  // Rule changes: the gate (effective placement time) and the world operator. The world operator is kept in twins.
  const ruleOn = id => !!ch(id) && !base;
  if (ruleOn('R1') && ch('R1').startsHere) {
    const c = ch('R1');
    const r = reviewLoad(W, { n: 10, fromMs: c.onsetMs, toMs: c.onsetMs + 5 * DAY_MS, salt });
    W = r.W; touched.R1 = new Set(r.converted);
  }
  for (const id of ['R2s', 'U1s']) {
    if (!ruleOn(id) || !ch(id).startsHere) continue;
    const S = sealed.change(id);
    if (S.worldOp) { const before = W; W = runWorldOp(S.worldOp, W, { id, salt, eff: ch(id).onsetMs }); touched[id] = changedCases(before, W); }
  }
  for (const id of ['R1', 'R2s', 'U1s']) if (want(id)) W.truth.dur1Eff[id] = effOf(ch(id));   // a carried rule keeps its published effective date (B7)
  for (const id of ['R1', 'R2s']) {
    const c = ch(id);
    if (!c || base || exclude.includes(id)) continue;
    const publishMs = c.startsHere ? c.publishMs : T0_MS - 30 * DAY_MS;      // a carried change was published in an earlier world
    if (publishMs === null || publishMs === undefined) continue;
    const edits = id === 'R1' ? D1.spec : (sealed.change(id).spec ?? []);
    const summary = id === 'R1' ? 'R2.2 changes: a fraud review with no usable answer by its deadline no longer cancels the order; the order is cleared just after the deadline.'
      : (sealed.change(id).label ?? 'a rule changes, as written below.');
    specChanges.push({ id, publishMs, effMs: Math.max(effOf(c), T0_MS), edits, summary });
    if (c.startsHere) announcements.push({ id, publicId: PUBLIC_ID[id], kind: 'spec', at: publishMs, effectiveAt: c.onsetMs });
  }
  // Data changes.
  if (want('P1')) {
    const c = ch('P1');
    W = addEdition(W, { ...P1_EDITION, fromMs: effOf(c), publishMs: c.startsHere ? c.publishMs : T0_MS - 30 * DAY_MS });
    if (c.startsHere) announcements.push({ id: 'P1', publicId: PUBLIC_ID.P1, kind: 'rulebook', at: c.publishMs, effectiveAt: c.onsetMs });
  }
  if (want('E2s')) {
    const c = ch('E2s'), S = sealed.change('E2s');
    if (S.edition) {
      // Unannounced: the edition is published at its onset (no notice); carried, it was published before the world.
      W = addEdition(W, { id: S.edition.id ?? 'ed-2026-4', policy: S.edition.policy ?? null, feeDelta: S.edition.feeDelta ?? 0, codeRenames: S.edition.codeRenames ?? {},
        fromMs: dayStart(dayOf(effOf(c))), publishMs: c.startsHere ? dayStart(dayOf(c.onsetMs)) : T0_MS - 30 * DAY_MS });
    }
    for (const r of S.renames ?? []) W = addRename(W, { ...r, atMs: c.onsetMs });
  }
  if (want('E1') || (spec.changes.some(c => c.id === 'E1r') && !base && exclude.includes('E1r'))) {
    const atMs = ch('E1')?.onsetMs ?? T0_MS;
    W = addRename(W, { system: 'carrier', op: 'create', from: 'location', to: 'site', atMs });
  }
  if (needsEditionCarriers(W)) actors = editionCarriers(actors);
  if (want('L1')) { const r = failureLoad(W, { share: 0.15, salt }); W = r.W; touched.L1 = new Set(r.injected.map(x => x.case)); }
  let wrapArm = null;
  if (want('F')) {
    const r = duplicatePlacements(W, { share: 0.1, salt });
    W = r.W; touched.F = r.touched;
    actors = duplicateReports(actors, { share: 0.1, salt });
    const fromMs = ch('F').onsetMs;
    wrapArm = (arm, factory) => withFaultRamp(arm, factory, { salt, fromMs });
  }
  if (want('ADV')) touched.ADV = new Set(W.arrivals.filter(a => typeof a.doc === 'string').map(a => W.truth.eventCase[a.id]));
  W.truth.dur1.active = spec.changes.map(c => c.id).filter(want);
  const item = await itemFor(ruleEdits(sealed));
  const specAt = ms => specText(specChanges, ms);
  const binding = Object.freeze({ ...e8.binding, specE: specAt(T0_MS), actors });
  const configAt = ms => ({
    spec: configDigest(specAt(ms)),
    rulebook: configDigest(W.rulebook.editions.filter(e => e.published && Date.parse(e.published) <= ms).map(e => [e.id, e.files])),
    api: configDigest((W.faults ?? []).filter(f => f.kind === 'F5' && Date.parse(f.at) <= ms).map(f => [f.system, f.op, f.params])),
  });
  const key = `${spec.stream}-W${spec.k}${base ? '-base' : exclude.length ? `-x${[...exclude].sort().join('+')}` : ''}`;
  return { key, spec, sealedSha: sealed?.sha256 ?? null, W, item, binding, wrapArm, announcements, specAt, configAt, touched,
    worldDigest: sha(JSON.stringify(W)).slice(0, 16), itemDigest: item.dur1Digest.slice(0, 16) };
}

/** Cases whose truth, arrivals or faults differ between two worlds (a sealed operator's footprint). */
function changedCases(A, B) {
  const out = new Set();
  for (const c of Object.keys(B.truth.cases)) if (JSON.stringify(A.truth.cases[c] ?? null) !== JSON.stringify(B.truth.cases[c])) out.add(c);
  const arr = W => new Map(W.arrivals.map(a => [a.id, JSON.stringify(a)]));
  const a = arr(A), b = arr(B);
  for (const [id, s] of b) if (a.get(id) !== s) { const c = B.truth.eventCase[id]; if (c) out.add(c); }
  return out;
}

/**
 * What a deployment can see of the changes by time `atMs` (information hygiene, prereg §6.3): announced rule changes
 * (spec published by then) with their effective times, rulebook editions published by then, and API renames the API
 * schema files show by then. Never a change's world operator unless the change is announced; never an unannounced rule.
 */
export function visibleConfig(bundle, atMs) {
  const rules = (bundle.announcements ?? []).filter(a => a.kind === 'spec' && a.at <= atMs).map(a => ({ id: a.id, effMs: a.effectiveAt }));
  for (const id of ['R1', 'R2s']) {      // carried announced rule changes were published before the world
    const c = bundle.spec.changes.find(x => x.id === id);
    if (c && !c.startsHere && bundle.W.truth.dur1Eff[id] !== undefined && !rules.some(r => r.id === id)) rules.push({ id, effMs: bundle.W.truth.dur1Eff[id] });   // its published effective date (B7)
  }
  const editions = bundle.W.rulebook.editions.filter(e => e.published && Date.parse(e.published) <= atMs && !['ed-2026-1', 'ed-2026-2'].includes(e.id)).map(e => clone(e));
  const renames = (bundle.W.faults ?? []).filter(f => f.kind === 'F5' && Date.parse(f.at) <= atMs).map(f => ({ system: f.system, op: f.op, from: f.params.from, to: f.params.to }));
  return { rules, editions, renames };
}

/**
 * A practice world (1235-1237) under a visible configuration (visibleConfig): the canary's and the heal smoke loop's
 * evidence. Rule changes are applied with their world operators (practice cases that exercise an announced rule) and
 * gated from their effective time; editions and renames from t0 (so every practice order meets them).
 */
export async function evidenceBundle({ seed, d }, config, { sealed = null } = {}) {
  let W = generateWorld({ seed, difficulty: d, mix: 'tail' });
  W.truth.dur1Eff = {};
  W.truth.dur1 = { stream: 'practice', k: 0, active: [], exclude: [] };
  const salt = `practice/${seed}`;
  for (const r of config.rules ?? []) {
    const eff = Math.max(T0_MS, r.effMs ?? T0_MS);
    if (r.id === 'R1') W = reviewLoad(W, { n: 10, fromMs: eff, toMs: eff + 5 * DAY_MS, salt }).W;
    else if (sealed?.change(r.id)?.worldOp) W = runWorldOp(sealed.change(r.id).worldOp, W, { id: r.id, salt, eff });
    W.truth.dur1Eff[r.id] = eff;
    W.truth.dur1.active.push(r.id);
  }
  for (const e of config.editions ?? []) {
    const files = e.files;
    const policy = JSON.parse(files['policy.json']);
    W = addEdition(W, { id: e.id, policy, feeTable: JSON.parse(files['shipping-fees.json']), fromMs: T0_MS, publishMs: T0_MS - DAY_MS });
    W.rulebook.editions.at(-1).files['carrier-codes.json'] = files['carrier-codes.json'];
  }
  for (const r of config.renames ?? []) W = addRename(W, { ...r, atMs: T0_MS });
  const actors = needsEditionCarriers(W) ? editionCarriers(baseActors) : baseActors;
  const item = await itemFor(ruleEdits(sealed));
  const specChanges = (config.rules ?? []).filter(r => ['R1', 'R2s'].includes(r.id)).map(r => ({ id: r.id, publishMs: T0_MS - DAY_MS, effMs: Math.max(T0_MS, r.effMs ?? T0_MS),
    edits: r.id === 'R1' ? D1.spec : (sealed?.change(r.id)?.spec ?? []), summary: r.id === 'R1' ? 'R2.2 changes (review timeout clears the order).' : (sealed?.change(r.id)?.label ?? '') }));
  const specAt = ms => specText(specChanges, ms);
  const key = `practice-${seed}-d${d}-${configDigest(config)}`;
  return { key, spec: { stream: 'practice', k: 0, seed, changes: [] }, W, item, binding: Object.freeze({ ...e8.binding, specE: specAt(T0_MS), actors }), wrapArm: null,
    announcements: [], specAt, configAt: () => ({ spec: '', rulebook: '', api: '' }), touched: {}, practice: true,
    worldDigest: sha(JSON.stringify(W)).slice(0, 16), itemDigest: item.dur1Digest.slice(0, 16) };
}

/**
 * The HISTORY world of a bundle at time T: only what arrived before T, run to T (a replay of what the deployment has
 * seen; cases that could not finish by T are censored by its own reference pools). Used for heal evidence and gates.
 */
export function historyBundle(bundle, T) {
  const W = clone(bundle.W);
  W.arrivals = W.arrivals.filter(a => Date.parse(a.at) < T);
  W.writes = (W.writes ?? []).filter(w => Date.parse(w.at) < T);
  W.horizonEnd = isoLocal(Math.max(T, T0_MS + DAY_MS));
  // W.id is kept: the counterparties and the analyst draw from rng(world.id, ...), so the replay is faithful.
  return { ...bundle, key: `${bundle.key}@hist${Math.round((T - T0_MS) / 3_600_000)}h`, W, history: T, worldDigest: sha(JSON.stringify(W)).slice(0, 16) };
}

/** The practice world of a canary or a heal smoke loop, with the given changes' overlays (designer tests only). */
export async function practiceBundle({ seed, d }, overlay = [], { sealed = null } = {}) {
  const changes = overlay.map(o => ({ id: o.id, cls: CHANGES[o.id].cls, kind: CHANGES[o.id].kind, startsHere: true, onsetMs: o.onsetMs ?? T0_MS, publishMs: o.publishMs ?? T0_MS - DAY_MS }));
  return buildBundle({ stream: 'practice', k: 0, seed, size: null, difficulty: d, mix: 'tail', changes }, { sealed });
}
