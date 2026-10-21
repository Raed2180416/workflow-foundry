# Decomposition template: Hollin Retail order process (SPEC-E)

*Frontier-written template for the composed build (arm C-H-T). Written from SPEC-E.md and COMPOSE.md only. It fixes
the module boundaries, what each module owns, its interface and the call graph; it does not contain the business
logic. `composition.json` here is a complete manifest you may use as it is or adjust; the `.mjs` files are skeletons.*

## 1. Boundaries and why

One order is one case and one instance (SPEC-E §1, §3.1). Inside it, two kinds of sub-workflow instances:

- **per order** (key: the normalised order id): `intake`, `screening`, `waiting`, `order`;
- **per fulfilment** (key: the fulfilment id): `fulfilment`, one saga per available fulfilment (R4.2: "one saga per
  fulfilment"; R5.2: "Other fulfilments of the order are not affected").

Each module owns the rules whose effects it emits, so a rule change touches one module. The parent owns only routing
and the order of the phases; it emits nothing itself.

| module | key | owns | effects (declared) | events it receives back |
|---|---|---|---|---|
| `intake` | order | R1.1–R1.4, §3.5 records | `inventory.allocate`, `orders.create` | its allocate and create results |
| `screening` | order | R2.1, R2.2, S1, S3 | `fraud.check`, task `fraudReview`, timers | its check result, task events, its deadline timer |
| `waiting` | order | R3.1, R3.2, S1, S5, S9 | `orders.setStatus:order:customerActionRequired`, `orders.setStatus:order:timedOut`, `orders.setStatus:fulfilment:cancelled`, `notify.send:action-required`, `notify.send:order-timed-out`, timers | its status and notice results, its deadline timer |
| `fulfilment` | fulfilment | R4.1 (its own status), R4.2, R4.3, R4.4, R5.1, R5.2, S2, S13, S14, R6.2 (its own compensation) | `inventory.reserve`, `inventory.release`, `billing.charge`, `billing.refund`, `carrier.create`, `carrier.cancel`, `orders.setStatus:fulfilment`, `notify.send:fulfilment-failed` | its step results |
| `order` | order | R4.1 (order status), R4.5, R6.1, R6.2/R6.3/R6.4 decision, S4, S6, S7, S12, S15 | `orders.setStatus:order`, `orders.setStatus:fulfilment:cancelled`, `notify.send:order-cancelled`, `notify.send:cancel-refused` | its status and notice results |
| parent | instance | §1 routing, merge, subject, §3.2–§3.5 dispatch, phase order | none | inbound messages |

Call graph: the parent calls every module; modules call nobody. All cross-module facts travel as typed outputs to the
parent and typed inputs from it.

## 2. The parent (routing and phases)

Per tick, in the order the events were delivered (SPEC-E §1 delivery order; same-instant knowledge S10):

1. **Subject and merge** (§1, §3.1–§3.3). Normalise ids (trim, drop a leading `#`, upper-case). An instance started by
   a message: on its first tick, if `ctx.instances({ subject })` lists another open instance for the same order, return
   `merge: { into }` (nothing else). Customer actions name the order by `orderRef`. A carrier message without a live ref
   names its fulfilment (`fulfilmentRef`): find the order with `ctx.query('orders.fulfilments', { where: { fulfilmentId } })`
   (or the go-live records). A customer action whose ref names no order: answer nothing (optionally `unknown-order`,
   §3.2) and close; S11: one delivered before the order's placement in the same instant names no order yet.
2. **Owned events**: `if (ctx.ownerOf(ev)) out = ctx.deliver(ev)`; act on the module's output (below).
3. **Inbound messages** by type: `order.placed` (new: `intake.start`; duplicate: nothing, R1.4), `migration` (§3.5:
   resume every module from the records), `customer.action` (R3.2 while waiting → `waiting.action`; otherwise
   `order.cancelRequest`), `carrier.status` (translate with the order's edition table, §3.3; → `fulfilment.report`, and
   tell `order` about collections for S7).
4. **Phases** (keep them in the parent's `state`):
   `intake` recorded → `screening.start` → cleared (R2.1 pass at p, R2.2 approve at the answer) → if any fulfilment is
   unavailable `waiting.start`, else ready → `order.ready` (processing) and `fulfilment.start` for each available
   fulfilment (R4.1). `screening` rejected or timed out → `order.cancel` (R6.1, reason fraud / fraud-review-timeout).
   `waiting` amended → ready with the available ones (or `order.cancel` reason nothing-available); cancelled →
   `order.cancel` (reason customer); timed out → ended. `order.cancelRequest` counted during processing (R6.2) →
   `fulfilment.stop` for each open fulfilment. Each `fulfilment` output with an end → `order.fulfilmentEnded`; when all
   ended, `order` sets the outcome (R4.5).
5. **Wake-ups and close**: modules set their own deadline timers; the parent closes the instance only when the order has
   ended and no module has anything in flight.

## 3. Module interfaces (see `composition.json` for the schemas)

**intake** `step({ op: 'start', placed })` → emits the allocation read and records the order when the plan is known
(R1.1: within 60 min of p; R1.2 amounts from `master/catalog.json` and the fees of the edition in force at p; R1.3:
latest `effectiveFrom` on or before the local date of p, kept for the whole order). `step({ op: 'resume', records })`
for go-live. Output: `{ recorded, edition, customerId, email, placedAt, fulfilments: [{ fulfilmentId, location, items,
amountMinor, available }] }` once recorded, else `{ recorded: false }`.

**screening** `step({ op: 'start', placedAt, edition })` → `fraud.check`; on `review` a `fraudReview` task (role
`fraudAnalyst`, subject the order id, answerSchema accepting `{ decision: approve | reject }`) within 120 min of p, the
deadline = first task's creation + `fraudReviewHours` (S3), a wake-up just after it. Re-ask (new local task id) only
when an answer was unusable, withdrawn or rejected by the schema, before the deadline. An answer exactly at the
deadline counts (S1). Output: `{ state: 'pending' | 'cleared' | 'rejected' | 'timedOut', at }`.

**waiting** `step({ op: 'start', clearedAt, p, hours, unavailable, all })` → R3.1 status and notice within 120 min of
clearing, deadline D = p + `customerActionHours` (S1: anchored at p), a wake-up just after D. `step({ op: 'action',
action, at })` → the first amend or cancel at or before D counts (an action exactly at D counts); later ones and
repeats change nothing (S5). Amend: cancel every unavailable fulfilment within 60 min (R3.2). The timeout, only
strictly after D, within D + 60 min: every fulfilment cancelled, order `timedOut`, `order-timed-out`. S9: an action
first makes the R3.1 status and notice moot. Output: `{ state: 'waiting' | 'amended' | 'cancelled' | 'timedOut', at,
available }`.

**fulfilment** `step({ op: 'start', orderId, customerId, location, items, amountMinor, at })` → its `processing`
status and the saga: reserve every item (per-item keys; a `partial` batch resubmits only the failed items with the same
keys, R4.2), charge (after the last reservation committed), book the shipment (after the charge committed; put a `ref`
on it). `step({ op: 'report', meaning, reportedAt, at })` → R4.4 (`dispatched`, `completed`, `collectionFailed` → R5.2).
`step({ op: 'stop', at })` → R6.2: compensate and set `cancelled`; a step already in flight that commits later is
compensated after its commit; a collected shipment cannot be cancelled. `onEvent(result)` drives the saga: a `402` or
a permanent error fails it (R5.2: compensate within 120 min, `failed`, `fulfilment-failed`, never retry the failed
step); a `400` is the request's fault: correct it and re-issue with the same key (R4.2); an `unknown` outcome is settled
with `ctx.status` (S2). Compensation (R5.1): undo committed steps in reverse order: cancel the shipment (unless
collectionFailed), then refund the full charge, then release each committed reservation; never undo twice. Output:
`{ status, collected, endedAt }`.

**order** `step({ op: 'ready', at })` → order `processing` within 60 min (R4.1; S9: moot if a counted cancel came
first). `step({ op: 'cancel', reason, at, fulfilments })` → R6.1 (fulfilments not completed, failed or cancelled →
`cancelled`; order `cancelled`; `order-cancelled`), within the deciding rule's window. `step({ op: 'cancelRequest', at,
collectedReports, ended })` → R6.2 counts if no collection reported at or before the cancel's time among the reports
delivered before it (S4, S6, S7, S13); a counted cancel: order `cancelled` and `order-cancelled` within 60 min; a
refused one: `cancel-refused` within 60 min (R6.3); after the order's cancellation is decided, later cancels change
nothing (S15). `step({ op: 'fulfilmentEnded', ... })` → R4.5 outcome within 120 min of the event that ended the last
fulfilment. Output: `{ state, counted?, refused? }`.

## 4. Rule ownership checklist

R1.1–R1.4 intake · R2.1–R2.2 screening · R3.1–R3.2 waiting · R4.1 order (order status) and fulfilment (its status) ·
R4.2–R4.4 fulfilment · R4.5 order · R5.1–R5.2 fulfilment · R6.1 order · R6.2 order (decision, order status, notice) and
fulfilment (compensation, its status) · R6.3–R6.4 order · R7.1–R7.2 every module for its own records (statuses only
forward, each at most once) · §4.8 each module sends the notices of its own rules, exactly once · S1 screening and
waiting · S2 fulfilment · S3 screening · S4, S6, S7 order · S9 waiting and order · S10 parent (pass each module the
time and the knowledge it may use) · S11, S12 parent · S13, S14 fulfilment · S15 order.

## 5. Pitfalls this split guards against

- Compensation lives with the steps it undoes (`fulfilment`): it knows which steps committed and their order.
- One key per logical effect, stable across re-emissions: `reserve-<sku>`, `charge`, `ship`, `refund`, `release-<sku>`,
  `cancel-shipment`, `status-<status>`, `notice-<template>`; the runtime makes them unique per instance.
- Deadlines are inclusive for the party who must act and exclusive for the timeout (S1): wake up just after them.
- A module's state is its memory: anything a later tick needs must be in `state` (the process can restart).
