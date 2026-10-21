# Decomposition template: the SPEC-E order process as a composed program

Sources: SPEC-E.md (the requirements) and COMPOSE.md (the composition interface). Every requirement below cites
SPEC-E; where SPEC-E is silent this file says so (§8) instead of filling the gap. `composition.json` is the manifest
of this decomposition; `parent.mjs` and `modules/*.mjs` are the skeletons; you write the logic and one
`tests/<id>.test.mjs` per module.

## 1. Modules and why these boundaries

| module | key (sub-workflow instance) | owns | effects |
|---|---|---|---|
| parent | one per platform instance | routing, phase order, tick discipline (§1, §3.2, §3.5, S5, S8-S13, S15, R7.1) | none |
| `order-id` | constant `n` (stateless) | §3.1 normalisation | none |
| `intake` | order id | R1.1-R1.4 | `inventory.allocate`, `orders.create` |
| `fraud` | order id | R2.1, R2.2, S3, §3.4 | `fraud.check`; task `fraudReview`; timer |
| `customer-action` | order id | R3.1, R3.2, S1 | none (calls statuses, notices); timer |
| `order-progress` | order id | R4.1, R4.5 | none (calls statuses) |
| `fulfilment` | fulfilment id | R4.2-R4.4, R5.1, R5.2, S2, S14, §3.3 | reserve, release, charge, refund, carrier create, cancel |
| `cancellation` | order id | R6.1-R6.4, S4, S6, S7 | none (calls fraud, order-progress, fulfilment, statuses, notices) |
| `statuses` | order id | R7.2 | `orders.setStatus` (the only writer) |
| `notices` | order id | §4.8 | `notify.send:<template>` (the only sender) |

Why these boundaries:

- **One saga module per fulfilment, forward steps and compensation together.** `ctx.status(system, key)` takes
  only the caller's local keys, and results come back only to the instance that emitted the effect (COMPOSE.md
  Names). So the "committed" check of R5.1 and S2 can only be made by the module that reserved, charged and booked.
  Each fulfilment is its own saga (§4.4 heading, R4.2 "for each available fulfilment"; R5.2 "other fulfilments of
  the order are not affected"), so the key is the fulfilment id.
- **One writer of statuses.** Statuses are set by R3.1, R3.2, R4.1, R4.4, R4.5, R5.2, R6.1 and R6.2, but R7.2
  (forward only, each at most once, never moved back by a late message) is one rule, and `orders.setStatus` does not
  check transitions (§2). Owning R7.2 in `statuses` keeps it in one place.
- **One sender of notifications.** Six rules send notices, but "send each required notification exactly once" and
  how `to` and `about` are formed are one rule (§4.8).
- **One normaliser.** Order ids are read in payloads, records and query results (§3.1 "every order id you read
  anywhere"). A wrong normalisation splits one order into two (R1.4), so it lives in `order-id`.
- **The edition is chosen once.** R1.3 fixes the edition at `p` for the whole life of the order. `intake` picks it
  and the parent hands the edition id to every module that reads `rulebook/` (policy.json for R2.2 and R3.2,
  carrier-codes.json for §3.3).
- **Each phase is its own module** (intake, fraud, customer action, processing, cancellation), so a change to one
  phase's rule touches one file. Modules do not call the next phase: they report an outcome and the parent routes
  it (§3).
- **Judging a cancel is separate from executing it.** Whether a cancel counts depends on the phase (R6.4, R3.2,
  R6.2, R6.3, S15) and on the collection reports (S4, S6, S7). `cancellation` owns that judgement and the R6
  executions. The parent only says which phase the order is in.

Call graph (acyclic): parent → all modules; `intake` → `order-id`; `customer-action` → `statuses`, `notices`;
`order-progress` → `statuses`; `fulfilment` → `statuses`, `notices`; `cancellation` → `fraud`, `order-progress`,
`fulfilment`, `statuses`, `notices`. `statuses`, `notices`, `order-id`, `fraud` call nothing.

## 2. Conventions for every module

- Synchronous `step` / `onEvent`; everything you need between ticks lives in `state`, never in top-level variables
  (COMPOSE.md A module). Always return an `output` that matches the schema in `composition.json`. A mismatch is
  refused and throws in the caller (COMPOSE.md What the runtime enforces).
- Outputs report the module's **current state**, not a one-off event. The parent acts only on transitions it has
  not acted on before.
- Local keys are stable: the same logical effect gets the same key on every emission, a different effect never
  reuses one (§1 Keys; COMPOSE.md Names). Key table: §5.
- Build args from `api/<system>.schema.json`, which always shows the current field names (R4.2). A `400`
  (`invalid-args`, `field-renamed`) means your request was wrong: correct it and re-issue it with the same key
  (R4.2). It is not a failure of the fulfilment (R4.2, R5.2).
- Only final outcomes arrive. Retryable outcomes are retried by the platform with the same key (§1 Profile). A
  permanent error is never retried by the platform (§1 Profile), and you do not retry a permanently failed step
  either (R5.2).
- Times: ISO 8601 with offset, `Europe/Amsterdam`; durations are calendar time (§1 Time). Compare instants, not
  strings.
- Windows are inclusive. Acting early, acting late, acting without being asked, or committing twice is an error
  (§4 preamble). Act at the first tick where the rule asks.

## 3. The parent: routing and the order of the phases

Phases of an order instance (parent state `phase`):

1. `intake`: `intake` reads the allocation and records the order (R1.1). When it reports `recorded`, the parent
   calls `statuses` `init`, `notices` `init` and `fraud` `start`. Nothing about the order is done before the record
   (R4.1), so the fraud phase starts here (R2.1 "within 120 min of p" still holds).
2. `fraud`: recorded, not yet cleared (R2.1, R2.2).
   - `cleared` at c with an unavailable fulfilment → `customer-action` `start` (R3.1), phase `waiting`.
   - `cleared` with none → ready at c (R4.1), phase `processing`.
   - `cancel` → `cancellation` `cancel-order` with the reason (R2.1, R2.2), phase `ended` (S15).
3. `waiting` (R3.1, R3.2): `ready` at a → phase `processing`. `cancel` (reason `customer` or
   `nothing-available`) → `cancel-order` (R3.2), phase `ended` (S15). `timedOut` → phase `ended` (R3.2 "the end of
   the order").
4. `processing`, from the ready instant, inclusive (R6.2, S11). `order-progress` `ready` (R4.1), then one
   `fulfilment` per available fulfilment. A fulfilment end `completed`/`failed` → `order-progress` `ended` (R4.5);
   once all have ended, phase `ended`.
5. `ended`: no forward step any more. Results are still delivered: late commits must be compensated (R6.2, S14).
   Close when no module is busy (§1 Routing allows `close`).

**First tick of an instance started by a message** (§1 Routing; every other inbound message starts a new
instance). Normalise ids through `order-id` (§3.1):

| message | open instance for the order (`ctx.instances({ subject })`) | none |
|---|---|---|
| `order.placed` | `merge: { into }` (only on this first tick, §1) | run the order here; `intake` applies R1.4 from the records |
| `customer.action` | `merge` | recorded order: ended, changes nothing (R6.3, S15), close. No order: nothing at all, close (§3.2, S11) |
| `carrier.status` without our ref | `merge`, found by `fulfilmentRef` (§3.5) | changes nothing (§3.3), close |
| `migration` | none | resume (§3.5) |

Declare `decisions.subject` = the normalised order id, or `null` when the message belongs to no order (§1 Declare
your subject).

**Each tick** (`tick`):

1. Handle `input.events` **in the order given** (§1 Delivery order: `actor` < `billing` < `carrier` <
   `customer-portal` < `fraud` < `inventory` < `notify` < `orders` < `shop`). Never re-sort. What was delivered
   earlier came before (S13, S4).
2. For an event `ctx.ownerOf(event)` knows, use `ctx.deliver(event)`, then react to the owner's output. For an
   inbound message, route it:

   | inbound | intake | fraud | waiting | processing | ended |
   |---|---|---|---|---|---|
   | `order.placed` (merged duplicate) | `intake` `placed` → duplicate, nothing (R1.4) | same | same | same | same |
   | `customer.action` cancel | open point §8 | `cancellation`, phase `not-cleared` (R6.4) | `customer-action` `action` (R3.2) | `cancellation`, phase `processing` (R6.2, R6.3, S8, S11, S12) | `cancellation`, phase `ended` (R6.3, S15) |
   | `customer.action` amend | open point §8 | open point §8 | `customer-action` `action` (R3.2) | nothing (S5) | nothing (S5) |
   | `carrier.status` | – | – | – | `fulfilment` `carrier` for `fulfilmentRef` (§3.3) | same (the saga ignores what changes nothing, §3.3) |

3. **End of tick:** this is the only place where forward steps (R3.1, R4.1, R4.2) are emitted, and it does nothing
   once the phase is `ended`. A step taken in a call that had been given a message counts as taken after that
   message (S10), so a forward step emitted in a call that carried a counted cancel would be new after the cancel,
   which R6.2 forbids. Steps made moot by an action or cancel in the same call are not required (S9). In `waiting`
   it calls `customer-action` `advance`. In `processing` it calls `order-progress` `ready` once, `fulfilment`
   `start` once per available fulfilment, and `fulfilment` `advance` for each, every tick.
4. Return `{ decisions: { subject }, state, close? }`.

The races SPEC-E settles, and how this order of handling settles them:

- **A review answer and a cancel in one instant** (S12): the answer comes first. After `approve` with nothing
  unavailable, the order is processing and the cancel is judged by R6.2 (S11). After `approve` with an unavailable
  fulfilment, the cancel is a customer action (R3.2). After `reject`, the phase is `ended`: the cancel changes
  nothing (S15).
- **A carrier report in the cancel's instant** reached you first (S4, S13). A `delivered` report that ends the last
  open fulfilment makes the phase `ended` before the cancel arrives (S13). A `collectionFailed` report has already
  failed its fulfilment, so the cancel applies to the others (S13).
- **A decline or permanent error from an attempt in the cancel's instant** arrives one minute later, after the
  cancel. The fulfilment has been stopped by then, so it is compensated and set `cancelled`, not `failed` (S13).
  `fulfilment` ignores forward failures after `stop`.
- **After a counted `amend`** the order is processing, and a later cancel is judged by R6.2 (S8).

## 4. The modules

For each module: the rules it owns, its key, its input and output (schemas: `composition.json`), what it may emit,
and the events it gets back.

### 4.1 `order-id` — §3.1

- Key `n`, no state. In: `{ raw }`. Out: `{ orderId }`. It trims spaces, removes a leading `#` and upper-cases
  (`" ord-1001-0007"` → `ORD-1001-0007`, §3.1); `null` in gives `null` out.
- No effects, tasks, timers or events.

### 4.2 `intake` — R1.1, R1.2, R1.3, R1.4 (and §3.1 placedAt, duplicates)

- Key: the order id.
- In:
  - `placed {order}`: the payload with the normalised id; `placedAt` is the event's time (§3.1).
  - `resume {records}`.
- Out: `status` (`new|allocating|recording|recorded`), `duplicate`, the plan `fulfilments`
  (`fulfilmentId, location, available, items, amountMinor`), `totalMinor`, `edition`, `customerId`, `currency`,
  `placedAt`, `busy`.
- Behaviour:
  - A placed order whose id is already recorded (state, or `orders.orders`) is a duplicate: no effect (R1.4; the
    same order delivered more than once is one order, §3.1).
  - Otherwise, within 60 min of `p`, read `inventory.allocate` and then emit `orders.create` (R1.1) with
    `orderId, customerId, placedAt, currency`, `items` as placed, the fulfilments as allocated (each
    `{ fulfilmentId, location, items, amountMinor }`) and `totalMinor` (R1.1).
  - Amounts (R1.2): `amountMinor` = Σ qty × `unitPriceMinor` (`master/catalog.json`), plus the location's `feeMinor`
    (`rulebook/<edition>/shipping-fees.json`) when the location is not `null`. `totalMinor` = Σ `amountMinor`.
  - Edition (R1.3): among the published `rulebook/<edition>/edition.json`, the one with the latest `effectiveFrom`
    on or before the date of `p` in `Europe/Amsterdam`. It is fixed for the life of the order; newer editions may
    already be on disk (R1.3).
- Effects: `inventory.allocate` (`allocate`), `orders.create` (`create`).
- Events: `effect.result` for `allocate` (the plan, §2) and `create`.
- Calls: `order-id`.

### 4.3 `fraud` — R2.1, R2.2, S3, §3.4

- Key: the order id.
- In: `start {orderId, placedAt, edition}`, `stop`, `resume`.
- Out: `state` (`checking|review|cleared|cancel|stopped`), `at`, `reason` (`fraud|fraud-review-timeout`).
- Verdict (R2.1, read `fraud.check` for every new order):
  - `pass`: cleared at `p`.
  - `reject`: `cancel`, reason `fraud`, due within 120 min of `p`.
  - `review`: one `fraudReview` task within 120 min of `p`.
- The review task (R2.2): `kind: fraudReview`, `role: fraudAnalyst`, `subject` = order id, and an `answerSchema`
  that accepts `{ decision: "approve" | "reject" }`. The deadline is `fraudReviewHours` (`policy.json`, order's
  edition) from the creation of the **first** task; it never moves (R2.2, S3).
  - An answer at or before the deadline that carries `decision` counts (R2.2). Judge by the answer's time, not by
    `late` (§3.4).
  - `approve` → cleared at the answer's time. `reject` → `cancel`, reason `fraud`, within 120 min of the answer.
  - Unusable, rejected-by-schema or withdrawn: you may ask again with a new task id; the deadline stays (R2.2).
  - No usable answer by the deadline → `cancel`, reason `fraud-review-timeout`, inside (deadline, deadline + 120
    min] (R2.2). Use a wake-up after the deadline, not at it: an answer exactly at the deadline counts.
  - After an outcome, a later answer changes nothing (R2.2).
- `stop` (from `cancellation`, R6.4): cancel the wake-up and ignore everything after.
- Effects: `fraud.check` (`check`). Human tasks: `fraudReview` (`review-<n>`). Timers: `deadline`.
- Events: the `check` result; `humanTask.answered|answerRejected|timeout|withdrawn|delegated` (§3.4); the wake-up.

### 4.4 `customer-action` — R3.1, R3.2, S1

- Key: the order id.
- In:
  - `start {orderId, placedAt, clearedAt, edition, fulfilments:[{fulfilmentId, available}]}`.
  - `advance`.
  - `action {action, at}`.
  - `resume`.
- Out: `state` (`waiting|ready|cancel|timedOut`), `at`, `reason` (`customer|nothing-available`).
- Behaviour:
  - `advance` (R3.1): within 120 min of the clearing time, set the order `customerActionRequired` and send
    `action-required`.
  - Deadline D = `p` + `customerActionHours` (the edition at `p`), anchored at `p` (R3.2, S1).
  - The first `amend`/`cancel` with time ≤ D counts; D itself counts (S1). Later actions and repeats change nothing
    (R3.2).
  - `amend` at a: within 60 min, set every unavailable fulfilment `cancelled` → `ready` at a. If none is available
    → `cancel`, reason `nothing-available` (R3.2).
  - `cancel` at a → `cancel`, reason `customer` (R3.2). `cancellation` executes R6.1.
  - Nothing counted by D: inside (D, D + 60 min], set every fulfilment `cancelled`, the order `timedOut`, and send
    `order-timed-out` (R3.2). The wake-up must be after D: a timeout taken at D is too early, and a timer at D does
    not win against an action at D (R3.2).
- Effects: through `statuses` (`set`) and `notices` (`send`). Timers: `deadline`.
- Events: the wake-up.

### 4.5 `order-progress` — R4.1, R4.5

- Key: the order id.
- In:
  - `ready {orderId, at, fulfilments}`.
  - `ended {fulfilmentId, end, at}`.
  - `stop`.
  - `resume`.
- Out: `state` (`processing|ended|stopped`), `outcome`, `at`.
- Behaviour:
  - `ready`, once (R4.1): set the order and every available fulfilment `processing` within 60 min of the ready time
    t. The parent calls it only after the order is recorded (R4.1).
  - `ended` (R4.5): when every fulfilment (as `statuses` `get` shows) is `completed`, `failed` or `cancelled`, set
    the order `completed` if one completed, else `failed` if one failed, else `cancelled`, within 120 min of the
    event that ended the last one.
  - `stop` (from `cancellation`): an order stopped by R6.2 ends `cancelled` by R6.2, not by R4.5.
- Effects: through `statuses`. No events of its own.

### 4.6 `fulfilment` — R4.2, R4.3, R4.4, R5.1, R5.2, S2, S14, §1 Profile, §3.3

- Key: the fulfilment id (1-80 characters, no `/`; COMPOSE.md).
- In:
  - `start {orderId, customerId, currency, edition, readyAt, fulfilment}`.
  - `advance`.
  - `carrier {message, at}`.
  - `stop {at}`.
  - `get`.
  - `resume`.
- Out: `state`, `end` (`completed|failed|stopped|null`), `endedAt`, `reports` (`{meaning, reportedAt}`, deduplicated),
  `busy`.
- Forward steps (R4.2), emitted only by `advance`, each only after the previous one committed:
  1. Reserve every item at the location within 120 min of t. After a `partial` batch, resubmit only the failed
     items with their original item keys, inside the same window.
  2. Charge `amountMinor` with the order's `customerId` and `currency` within 120 min of the last reservation's
     commit.
  3. Book `carrier.create` with the location within 120 min of the charge's commit. Put a `ref` on it (here, the
     fulfilment id) so the carrier's messages come to this instance (§1 Routing, §2).
- Collection (R4.3): once a day at the location's `collectionTime`; collection is the point of no return. After
  it, `carrier.cancel` answers `409 already-collected` (§2). SPEC-E asks for no action at collection time: a cancel
  is judged on the reports (S7), and a shipment is cancelled at once (R6.2).
- Carrier messages (§3.3, R4.4): translate `code` with `rulebook/<edition>/carrier-codes.json`; an unlisted code
  is `info`.
  - `collected` → `dispatched`.
  - `delivered` → `dispatched` first if it was never set, then `completed` (`afterStatus: dispatched`); end
    `completed`.
  - `inTransit`, `info` → nothing.
  - `collectionFailed` → the fulfilment fails (R5.2).
  - Each status change within 120 min of the message (R4.4).
  - Repeats and out-of-order reports are normal (§3.3); a status never moves back (R7.2, via `statuses`).
  - Messages about a shipment you cancelled, or about a completed or failed fulfilment, change nothing (§3.3).
  - Every report is recorded in `reports` for `cancellation` (S7).
- Failure (R5.2): a `402 card-declined`, a `collectionFailed`, or a permanent error other than your own invalid
  request. Within 120 min of the failed attempt (or of the carrier's message): compensate, set `failed`, send
  `fulfilment-failed` about the fulfilment id. Do not retry the failed step. Other fulfilments are unaffected.
- Compensation (R5.1): undo the committed steps in reverse order:
  1. Cancel the shipment, only if one was booked and not reported `collectionFailed`.
  2. Refund the full `amountMinor`, only if the charge committed.
  3. Release each item whose reservation committed (in any order).
  - A step counts as committed if its result was `ok`, or if its outcome was unknown and `ctx.status(system, key)`
    says `committed`. That status is the truth, not what you last saw (S2).
  - Never undo a step that did not commit, or undo one twice (R5.1).
- `stop` (from `cancellation`, R6.2): from now on reserve, charge and book nothing new (R6.2), and compensate
  (R5.1). A step that commits after the stop is compensated at once (within 60 min of its commit, R6.2). Its
  `cancelled` status is set by `cancellation`.
- A step of a failing fulfilment that commits after the failure is compensated within 120 min of its commit. The
  compensation, `failed` status and notice are then due within 120 min of the later of the two (S14).
- Effects: `inventory.reserve`, `billing.charge`, `carrier.create`, `carrier.cancel`, `billing.refund`,
  `inventory.release`. Status and notices through `statuses`, `notices`.
- Events: the results of all six. `reserve` returns per-item outcomes (§2).

### 4.7 `cancellation` — R6.1, R6.2, R6.3, R6.4, S4, S6, S7

- Key: the order id.
- In:
  - `customer-cancel {orderId, at, eventId, phase}`.
  - `cancel-order {orderId, at, reason}`.
- Out: `verdict` (`counts|refused|nothing|done`).
- `cancel-order` (R6.1), once: set every fulfilment that is not `completed`, `failed` or `cancelled` to
  `cancelled`, set the order `cancelled`, send `order-cancelled`, all inside the window of the rule that asked
  (R2.1, R2.2, R3.2, R6.4).
- `customer-cancel` by phase:
  - `not-cleared`: counts (R6.4). `fraud` `stop`, so a later review answer changes nothing (R6.4). Then R6.1, reason
    `customer`, within 60 min.
  - `processing`: the cancel does not count if a report delivered before it (`fulfilment` `get` → `reports`) means
    `collected`, `inTransit` or `delivered` and has `reportedAt` ≤ the cancel's time (S7). Reports delivered
    earlier in the same instant count; reports delivered later do not, whatever their `reportedAt` (S4, S7). One
    collection ends the right for the whole order (S6).
    - Counted (R6.2): `order-progress` `stop`; for each fulfilment not `completed`/`failed`/`cancelled`, call
      `fulfilment` `stop` and set it `cancelled`; set the order `cancelled`; send `order-cancelled`; all within
      60 min of the cancel.
    - Not counted (R6.3): send `cancel-refused` within 60 min (occurrence = the cancel's event id); change nothing
      else.
  - `ended`: changes nothing (R6.3, S15). `cancel-refused` is allowed but not required; the template sends none.
- The reason (R2, R3.2, R6.4) has no arg in `orders.setStatus` or `notify.send`. Keep it in state; `text` is
  free (§4.8).
- Effects: none of its own. Events: none.

### 4.8 `statuses` — R7.2 (§2 setStatus)

- Key: the order id.
- In:
  - `init {fulfilments:[{fulfilmentId, location}]}`: the order `pending`; each fulfilment `pending`, or
    `unavailable` when its location is `null` (§2 orders.create).
  - `set {fulfilmentId|null, status, afterStatus?}`.
  - `get`.
  - `resume`.
- Out: `applied`, `order`, `fulfilments`, `busy`.
- Allowed moves (R7.2):
  - Fulfilment: `pending` → `processing` → `dispatched` → `completed`, with `cancelled` and `failed` as the other
    ends. `unavailable` → `cancelled` as R3.2 and R6.1 ask (see pitfall 8).
  - Order: `pending` → (`customerActionRequired`) → `processing` → `completed|failed|cancelled`, with `timedOut` and
    `cancelled` as the other ends.
  - Each status at most once; a late or repeated request never moves a status back. Anything else: no effect.
- `set` before `init` is refused (R4.1). `afterStatus`: emit with `after` on that earlier change when it was
  emitted in the same tick (§1 Results), so `dispatched` applies before `completed` (R4.4).
- Effects: `orders.setStatus`. Events: its results.

### 4.9 `notices` — §4.8

- Key: the order id.
- In:
  - `init {customerId}`.
  - `send {template, about, occurrence?, text?}`.
  - `resume`.
- Out: `sent`, `busy`.
- Behaviour (§4.8):
  - `to` is the customer's `email` (`master/customers.json`).
  - `about` is the order id; for `fulfilment-failed`, it is the fulfilment id.
  - `text` is free; `ref` is optional.
  - Each required notification exactly once (one key per notification). `cancel-refused` is sent once per refused
    cancel (R6.3).
- `unknown-order` is optional (§3.2) and not declared. If you add it, `to` is the action's `from` (§4.8), and it
  must never be sent in the S11 case.
- Effects: `notify.send:action-required|order-cancelled|order-timed-out|fulfilment-failed|cancel-refused`.
  Events: its results.

## 5. Local key and name table

| module | local names | logical effect (§1 Keys) |
|---|---|---|
| intake | `allocate`, `create` | the allocation read, the record of the order |
| fraud | `check`; tasks `review-1`, `review-2`, ...; wake-up `deadline` | the verdict read, each review task, the deadline |
| customer-action | wake-up `deadline` | the timeout after D |
| fulfilment | batch `reserve-<n>`, items `item.<sku>`, `charge`, `ship`, `unship`, `refund`, `release.<sku>` | one per reservation item, charge, shipment, cancellation, refund, release |
| statuses | `order.<status>`, `f.<fulfilmentId>.<status>` | one status change |
| notices | `<template>.<about>`; `cancel-refused.<eventId>` (the order id is already the instance key) | one notification |

The runtime prefixes `<module>/<key>/`; the full name must stay within 200 characters (COMPOSE.md Names).
Resubmitting failed reservation items is a batch with other args, so it takes a new batch key (the same key with
other args is a `409 key-conflict`, §1 Keys). The item keys stay the original ones (R4.2).

## 6. Checklist: every rule and reading to exactly one owner

| item | owner | what it requires |
|---|---|---|
| §1 Profile | `fulfilment` | retries are the platform's, with the same key; only the final outcome arrives; a partial batch is delivered, not retried (handled by R4.2) |
| §1 Keys | parent | one stable key per logical effect, reused for every attempt; the key table in §5 is binding on every module |
| §1 Results | parent | results come ≥ 1 min later; `after` waits for an `ok` effect of the same output (used by `statuses`) |
| §1 Routing | parent | merge only on the first tick; ref-quoting carrier messages reach the creating instance while it is open |
| §1 Declare your subject | parent | `decisions.subject` = normalised order id or `null` |
| §1 Time | parent | ISO 8601 with offset, Europe/Amsterdam, calendar durations; passed as `at` to modules |
| §1 Delivery order | parent | handle events in the order given; earlier delivered = came before |
| §2 orders.create | `intake` | record the order (R1.1) |
| §2 orders.setStatus | `statuses` | transitions not checked by the system (R7.2) |
| §2 inventory.allocate | `intake` | the plan (R1.1) |
| §2 inventory.reserve | `fulfilment` | batch with per-item keys, may be `partial` (R4.2) |
| §2 inventory.release | `fulfilment` | reverses one item's reservation (R5.1) |
| §2 billing.charge | `fulfilment` | `402 card-declined` is permanent (R5.2) |
| §2 billing.refund | `fulfilment` | reverses the charge (R5.1) |
| §2 carrier.create | `fulfilment` | with the location and a `ref` (R4.2) |
| §2 carrier.cancel | `fulfilment` | refused after collection, `409 already-collected` (R4.3) |
| §2 fraud.check | `fraud` | the verdict (R2.1) |
| §2 notify.send | `notices` | `about`, `template` (§4.8) |
| §2 business records | parent | `ctx.query` on the listed tables; the parent reads everything (COMPOSE.md) |
| §3.1 normalisation | `order-id` | trim, drop a leading `#`, upper-case every order id |
| §3.1 placed orders | `intake` | `placedAt` is the event's time; repeated delivery is one order |
| §3.2 | parent | normalise `orderRef`; no order → nothing; the action's time is its event's time |
| §3.3 carrier messages | `fulfilment` | translate codes, unknown = `info`, repeats and out-of-order, cancelled or ended → nothing |
| §3.3 cancel-time reports | `cancellation` | for a cancel during processing, all earlier collections were already reported (S7) |
| §3.4 | `fraud` | human-task events; `late` is not the criterion |
| §3.5 | parent | migration resume; ref-less carrier messages matched by `fulfilmentRef` |
| §4 preamble | parent | windows inclusive, in calendar minutes; act inside them, never early, twice or unasked |
| §4.8 | `notices` | templates, `to`, `about`, each required notice exactly once |
| R1.1 | `intake` | allocate and `orders.create` within 60 min of p |
| R1.2 | `intake` | amounts and fees, `totalMinor` |
| R1.3 | `intake` | edition in force at p, for the whole life of the order |
| R1.4 | `intake` | duplicate placed order: no effect |
| R2.1 | `fraud` | pass / reject / review |
| R2.2 | `fraud` | review task, deadline, answers, timeout |
| R3.1 | `customer-action` | `customerActionRequired` + `action-required` within 120 min of clearing |
| R3.2 | `customer-action` | deadline D, amend / cancel / timeout |
| R4.1 | `order-progress` | ready → processing statuses within 60 min; nothing before the record |
| R4.2 | `fulfilment` | reserve → charge → ship, windows, partial batches, 400s |
| R4.3 | `fulfilment` | collection is the point of no return |
| R4.4 | `fulfilment` | carrier meanings → dispatched / completed / failure |
| R4.5 | `order-progress` | order outcome when every fulfilment ended |
| R5.1 | `fulfilment` | compensation in reverse order of committed steps |
| R5.2 | `fulfilment` | failure: compensate, `failed`, `fulfilment-failed` |
| R6.1 | `cancellation` | cancel an order before any step committed |
| R6.2 | `cancellation` | customer cancel during processing; stop, compensate, nothing new |
| R6.3 | `cancellation` | refused cancel → `cancel-refused`; ended order → nothing |
| R6.4 | `cancellation` | cancel before clearing counts; later answer changes nothing |
| R7.1 | parent | records end up describing what happened: no instance closes while a module is busy |
| R7.2 | `statuses` | forward only, each status at most once |
| S1 | `customer-action` | D anchored at p; inclusive for the actor, exclusive for the timeout |
| S2 | `fulfilment` | committed = `status(key)` truth |
| S3 | `fraud` | one review deadline per order, from the first task |
| S4 | `cancellation` | a collection report and a cancel in one instant: the collection wins |
| S5 | parent | amend without unavailable fulfilments, or an action for an order no longer waiting: nothing |
| S6 | `cancellation` | one collection ends the right to cancel the whole order |
| S7 | `cancellation` | which reports prove collection before a cancel |
| S8 | parent | after a counted amend a later cancel is judged by R6.2 |
| S9 | parent | moot steps (R3.1, R4.1) need not be taken |
| S10 | parent | same-instant knowledge: forward steps only at end of tick |
| S11 | parent | the ready instant is inclusive; an action before its order was placed names no order |
| S12 | parent | a review answer and a cancel in one instant |
| S13 | parent | endings and failures in a cancel's instant |
| S14 | `fulfilment` | a step committing after its fulfilment failed |
| S15 | parent | an order counts as cancelled from the deciding event |

§4.1-§4.7 are covered by their R rows, and §5 by its S rows. §6 is orientation only and states no requirement.

## 7. Pitfalls the split guards against

1. **Compensating from the wrong module.** Only the emitter can read `status(key)` and receives the result
   (COMPOSE.md Names). Compensation therefore stays in `fulfilment` (R5.1, S2).
2. **A forward step in the cancel's call.** Emitting the charge or shipment from `onEvent` when a counted cancel
   comes later in the same call makes it "new after the cancel" (S10, R6.2). Forward steps only in `advance` at end
   of tick.
3. **A status set twice or moved back** by a repeated or out-of-order carrier report (R7.2, §3.3). Only `statuses`
   writes statuses.
4. **A notice sent twice or never** (§4.8). Only `notices` sends, with one key per notice.
5. **R4.5 after a counted cancel.** An order with a fulfilment that failed before the cancel would come out `failed`
   by R4.5, but R6.2 says `cancelled`. `cancellation` stops `order-progress`.
6. **A newer edition mid-order** (R1.3). The edition is chosen once and passed by id.
7. **Deadlines.** D from p, not from `customerActionRequired` (S1). A timeout at D or at the review deadline is too
   early (R3.2, R2.2). The review deadline never moves when you ask again (R2.2, S3). The `late` flag does not
   decide (§3.4).
8. **`unavailable` treated as unchangeable.** R7.2 lists it as an end, yet R3.2 and R6.1 set unavailable
   fulfilments `cancelled`. `statuses` allows exactly that move.
9. **Judging a cancel by `reportedAt` alone,** or counting a report delivered after the cancel (S7, S4).
10. **Treating a 400 as a failure, or retrying a permanent error** (R4.2, R5.2).
11. **Key conflicts.** Reusing a batch key with fewer items gives `409 key-conflict` (§1 Keys); reusing a key for a
    different effect is never allowed (§1 Keys).
12. **Two orders from one.** Comparing unnormalised ids lets a duplicate through (§3.1, R1.4). Use `order-id`
    everywhere.
13. **Silently dropped effects.** An effect outside a module's declaration never reaches the platform, and a call
    outside `calls` throws (COMPOSE.md). Keep the code and `composition.json` in step.
14. **State in top-level variables, or a carry over 64 KB** (COMPOSE.md). Keep `reports` deduplicated.
15. **Failure time.** R5.2's window runs from the failed attempt, one minute before its result arrives; act on
    the result at once (R5.2, S13).
16. **Closing too early.** A closed instance no longer receives ref-quoting carrier messages (§1 Routing), and
    late commits still need compensation (R6.2, S14).

## 8. Open points: SPEC-E is silent, so do not invent

Each of these is routed in the parent, so a decision touches one place. Raise them with the owner of SPEC-E.

- **A customer action between placement and the record's commit.** R6.4 covers a recorded order and S11 an
  unplaced one. The template default is to hold the action and route it when the phase changes.
- **An `amend` before the order is cleared.** R3.2 does not say. The template default is to hold it in the same
  way.
- **An order cleared after D + 60 min,** if `fraudReviewHours` > `customerActionHours`. No window is given.
- **`carrier.cancel` answered `409 already-collected` during compensation.** R5.1 and R6.2 do not say what follows.
- **Two copies of `order.placed` in one instant** start two instances (§1 Routing). Check how `ctx.instances` sees
  them.
- **Migration payload shape** (§3.5). SPEC-E only says "continue each from where it stands"; take the shape from
  the practice worlds.
- **Cross-references in SPEC-E.** §2 cites "§4.9" for transitions (none exists; read R7.2, §4.7). §3.4 cites "§4.3"
  for tasks (read R2.2, §4.2).

## 9. Contract tests to write (`tests/<id>.test.mjs`, COMPOSE.md)

- **order-id:** `" ord-1001-0007"`, `"#ORD-1"`.
- **intake:** amounts with and without a fee (R1.2); the edition at p when a newer one is on disk (R1.3); a
  duplicate emits nothing (R1.4).
- **fraud:**
  - pass, reject and review (R2.1).
  - An answer exactly at the deadline counts; a late answer changes nothing.
  - Asking again keeps the deadline (R2.2, S3).
  - The wake-up is after the deadline.
- **customer-action:** an action at D counts; a timeout only after D; amend with none available (R3.2).
- **order-progress:** outcome mixes (R4.5).
- **fulfilment:**
  - A partial batch resubmits only the failed items, with their keys (R4.2).
  - A decline compensates and fails (R5.2).
  - `stop` with an in-flight step: compensated when it commits (R6.2).
  - `status(key)` committed after an unknown outcome (S2).
  - A delivered report before the collected one (R4.4).
  - `onEvent` never emits a forward step.
- **cancellation:**
  - A report at the same instant as the cancel refuses it (S4, S7).
  - A report delivered after the cancel does not (S7).
  - R6.4 stops fraud.
- **statuses:** a backward move or a repeat emits nothing (R7.2); unavailable → cancelled is allowed.
- **notices:** the same notice twice → one effect (§4.8).
