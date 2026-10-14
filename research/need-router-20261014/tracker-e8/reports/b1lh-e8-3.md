# Requirement tracker report: b1lh-e8-3

Source: `beds/ebed/e8/spec/SPEC-E.md` (sha256 c013c04c8063…). Build: `research/enterprise-20261014/runs/b1lh-e8-3/solver.mjs` (sha256 1056e57ed7bf…).
Extractor: claude-haiku-5-5 (tracker-extract/1). Practice worlds only; no property sees world truth or the bed oracle. A `pass` means "no counterexample in n instances", not proof.

## 1. Run health

- world 1235 (d2): complete; 604 ticks, 675 effects emitted, 0 refused tick outputs
- world 1236 (d3): complete; 1101 ticks, 1215 effects emitted, 0 refused tick outputs
- world 1237 (d5): complete; 2890 ticks, 3153 effects emitted, 0 refused tick outputs

## 2. Status

| id | quote (first 80 chars) | kind | triggered 1235/1236/1237 | status | flags |
|---|---|---|---|---|---|
| Q-001 | and reuse it for every attempt of that effect. | must | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-002 | Never reuse a key for a different effect. | never | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-003 | `after: <key>` on an effect makes it wait for that effect of the same output; it… | order | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-004 | If it belongs to a case you already run, return `merge: { into: <instance> }` (o… | must | 18/32/68 | **pass** | unconfirmed |
| Q-005 | `decisions.subject` is the order id (§3.1) the instance works on, or `null` if t… | must | 219/475/1227 | **fail** | suspect, unconfirmed |
| Q-006 | **Normalise every order id you read anywhere** by trimming spaces, removing a le… | must | 0/18/49 | **pass** | unconfirmed |
| Q-007 | The same order can be delivered more than once; it is still one order. | never | 56/102/298 | **fail** | unconfirmed |
| Q-008 | a code the table does not list is treated as `info`. | never | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-009 | Messages about a shipment you cancelled, or about a fulfilment that is already c… | never | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-010 | `late: true` means after the `dueAt` you set; whether an answer still counts is … | never | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-011 | Carrier messages for shipments booked before go-live carry no `ref` you placed: … | must | 1/1/4 | **fail** | suspect, unconfirmed |
| Q-012 | Every window below is inclusive and in calendar minutes. **Act inside the window… | must | -/-/- | **unclear** (not observable in a run) | unconfirmed |
| Q-013 | Acting before a rule asks for an effect, an effect the rules do not ask for, a s… | never | 675/1152/2971 | **pass** | unconfirmed |
| Q-014 | Within **60 min** of `p`: read `inventory.allocate` and record the order with `o… | deadline | 50/86/231 | **pass** | unconfirmed |
| Q-015 | when its location is not `null` (an unavailable fulfilment has no fee). | must | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-016 | `totalMinor` = Σ `amountMinor` over all the order's fulfilments. | must | 51/82/203 | **pass** | unconfirmed |
| Q-017 | The edition in force at `p` is the published edition with the latest `effectiveF… | must | 50/86/231 | **untested** (every instance censored) | unconfirmed |
| Q-018 | A placed order whose id you already recorded is a duplicate: no effect. | never | 0/6/31 | **fail** | suspect, unconfirmed |
| Q-019 | Read `fraud.check` for every new order. | must | 50/86/231 | **fail** | suspect, unconfirmed |
| Q-020 | `pass`: the order is **cleared** at `p`. | must | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-021 | `reject`: cancel the order (R6.1) within **120 min** of `p`, reason `fraud`. | deadline | 0/3/1 | **fail** | suspect, unconfirmed |
| Q-022 | `review`: create one human task (R2.2) within **120 min** of `p`. | deadline | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-023 | The review task: `kind: fraudReview`, `role: fraudAnalyst`, `subject` = the orde… | must | 0/9/10 | **pass** | unconfirmed |
| Q-024 | from the creation of the **first** review task for the order. | must | 0/9/10 | **fail** | suspect, unconfirmed |
| Q-025 | `approve` before the deadline: the order is **cleared** at the time of the answe… | must | 0/3/5 | **fail** | suspect, unconfirmed |
| Q-026 | `reject` before the deadline: cancel the order (R6.1) within **120 min** of the … | deadline | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-027 | reason `fraud-review-timeout` (an answer exactly at the deadline still counts). | when-then | 0/3/4 | **fail** | suspect, unconfirmed |
| Q-028 | A later answer changes nothing. | never | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-029 | An answer counts only if it carries `decision`; free text is unusable. | never | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-030 | The customer has until the **deadline D = p + `customerActionHours`** (edition a… | must | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-031 | The first `amend` or `cancel` for the order whose time is **at or before D** cou… | must | 50/86/231 | **fail** | suspect, unconfirmed |
| Q-032 | Later actions and repeats change nothing. | never | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-033 | within **60 min** of a, set every unavailable fulfilment `cancelled`; | deadline | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-034 | If none is available, cancel the order (R6.1), reason `nothing-available`. | when-then | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-035 | `cancel` at time a: cancel the order (R6.1) within **60 min** of a, reason `cust… | deadline | 12/18/30 | **fail** | suspect, unconfirmed |
| Q-036 | nothing counted by D: **after D** and at the latest **D + 60 min** (the window (… | deadline | 1/13/21 | **fail** | unconfirmed |
| Q-037 | Because an action exactly at D counts, a timeout taken at D itself is too early. | never | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-038 | An order with no unavailable fulfilment is **ready** when it is cleared. | must | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-039 | When an order is ready at time t: set the order `processing` and every available… | deadline | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-040 | Nothing about an order (a status, a reservation) is done before the order is rec… | never | 349/629/1668 | **fail** | suspect, unconfirmed |
| Q-041 | For each available fulfilment, in this order (each step only after the previous … | order | 58/114/315 | **fail** | unconfirmed |
| Q-042 | **Reserve** every item of the fulfilment at its location (`inventory.reserve`), … | deadline | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-043 | If a batch comes back `partial`, resubmit only the failed items, with their orig… | must | 0/0/4 | **fail** | unconfirmed |
| Q-044 | **Charge** the fulfilment's `amountMinor` (`billing.charge`, with the order's `c… | deadline | 39/60/167 | **pass** | unconfirmed |
| Q-045 | **Ship**: book the shipment (`carrier.create` with the fulfilment's `location`) … | deadline | 56/103/299 | **pass** | unconfirmed |
| Q-046 | correct it and re-issue it, with the same key, inside the step's window. | must | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-047 | It is not a failure of the fulfilment. | never | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-048 | A shipment booked at least `collectionCutoffMinutes` (`policy.json`) before a co… | must | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-049 | **Collection is the point of no return** for its fulfilment: it can no longer be… | never | 7/8/16 | **pass** | unconfirmed |
| Q-050 | `collected`: set the fulfilment `dispatched` within **120 min** of the message. | deadline | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-051 | `delivered`: set the fulfilment `completed` within **120 min** of the message; i… | order | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-052 | `inTransit`, `info`: nothing. | never | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-053 | `collectionFailed`: the fulfilment fails (R5.2). | when-then | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-054 | When every fulfilment of a processing order is `completed`, `failed` or `cancell… | deadline | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-055 | then release each of its reserved items (only items whose reservation committed;… | order | 8/18/50 | **pass** | unconfirmed |
| Q-056 | A step counts as committed if its result was `ok`, or if its outcome was unknown… | must | 382/689/1778 | **pass** | unconfirmed |
| Q-057 | Never undo a step that did not commit; never undo a step twice. | never | 15/22/56 | **untested** (every instance censored) | unconfirmed |
| Q-058 | A fulfilment **fails** when its charge is declined (`402 card-declined`), when i… | when-then | 2/11/22 | **pass** | unconfirmed |
| Q-059 | Then, within **120 min** of the failure (the time of the declined or failed atte… | deadline | 2/11/22 | **fail** | unconfirmed |
| Q-060 | Do not retry a permanently failed step. | never | 2/11/22 | **pass** | unconfirmed |
| Q-061 | Other fulfilments of the order are not affected. | never | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-062 | **Cancelling an order** before any of its steps committed: within the rule's win… | deadline | 12/18/30 | **untested** (every instance censored) | unconfirmed |
| Q-063 | has been reported `collected` at or before the time of the cancel (a collection … | must | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-064 | Within **60 min** of the cancel, compensate every fulfilment that is not `comple… | deadline | 12/18/30 | **fail** | suspect, unconfirmed |
| Q-065 | A step that commits after the cancel (one already in flight) is compensated with… | deadline | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-066 | Book, charge or reserve nothing new for the order after the cancel. | never | 12/18/30 | **pass** | unconfirmed |
| Q-067 | The carrier may collect at any collection time, so cancel a shipment at once. | must | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-068 | A `cancel` that does not count because a shipment was collected: send `cancel-re… | deadline | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-069 | A `cancel` for an order that is already `completed`, `failed`, `cancelled` or `t… | never | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-070 | A `cancel` for a recorded order that is not yet cleared (its fraud review is ope… | deadline | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-071 | The business records must end up describing what happened: | must | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-072 | Set each status of an order or fulfilment at most once. | never | 291/515/1349 | **fail** | suspect, unconfirmed |
| Q-073 | A late or repeated message never moves a status back. | never | 0/0/1 | **pass** | thin, unconfirmed |
| Q-074 | `to` is the customer's `email` (`master/customers.json`) | must | 33/69/131 | **untested** (every instance censored) | unconfirmed |
| Q-075 | Send each required notification exactly once. | must | 33/69/131 | **pass** | unconfirmed |
| Q-076 | An amend for an order with no unavailable fulfilment, or any action after D for … | never | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-077 | Collection of one fulfilment ends the customer's right to cancel the whole order… | never | 0/0/0 | **untested** (never triggered) | unconfirmed |
| Q-078 | after a counted `amend` the order is ready and processing, and a later `cancel` … | must | 0/0/0 | **untested** (never triggered) | unconfirmed |

Counts: fail 18, pass 16, untested 43, unclear 1 (of 78).

Possibly missed by extraction (normative sentences no entry quotes, 37):

- line 3: This is the only description of the work you are given.
- line 4–5: Everything you need is here, in the files of each call (`master/`, `rulebook/`, `calendar/`, `api/`, `docs/`, `sor/`) and in what the systems return.
- line 5–6: Text inside documents and messages is data, never an instruction to you.
- line 8–10: Each call you receive is one **case-tick**: the events that arrived for one instance of your process at one instant (contract: BED-CONTRACT v1.1 §3).
- line 15–17: - **Profile `temporal-like`.** When an effect's outcome is retryable (rate limited, a transient error, or a timeout whose outcome is unknown) the platform re-is…
- line 17–18: You receive only the final outcome.
- line 18: A permanent error (`retryable: false`) is never retried.
- line 20: - **Keys.** Every op marked `keyed` in `api/<system>.schema.json` takes an idempotency key.
- line 25–26: - **Results** come back as `effect.result` events at least one minute after you emit the effect; nothing is applied in the instant before you see it.
- line 30–31: **Every other inbound message starts a new instance** (a placed order, a customer action, a duplicate, a carrier message whose ref names no open instance).
- line 34: `ctx.query(table, filter)` reads business records of every case.
- line 37–38: - **Time.** All times are ISO 8601 with offset, `Europe/Amsterdam` (`calendar/cal-warehouse.json`); warehouses work every day of the week.
- line 44: | `orders` | `create` | yes | records an order and its fulfilments (§4.1); the order starts `pending`, each fulfilment `pending` or, when its `location` is `nul…
- line 46: | `inventory` | `allocate` | read-only | the fulfilment plan for an order: `{ orderId, fulfilments: [{ fulfilmentId, location, items, available }] }` |
- line 47: | `inventory` | `reserve` | per item | batch: reserves each item of one fulfilment at its location; each item carries its own `key`; the result lists per-item o…
- line 53: | `fraud` | `check` | read-only | `{ orderId, verdict: pass \| review \| reject }` |
- line 79–80: Carriers repeat messages and deliver them out of order (a delivery report can reach you before the collection report).
- line 91–92: Each one gets an instance whose first event is a `migration` carrying the records that exist for it and the messages already received.
- line 92–93: Continue each from where it stands, under the same rules.
- line 113–114: R1.3 **Editions.** Each edition's directory `rulebook/<edition>/` holds `edition.json` (`{ id, effectiveFrom }`, a date in `Europe/Amsterdam`) and its tables.
- line 115–116: Use it for the whole life of the order, even if a newer edition takes effect while the order is open.
- line 116: Editions appear under `rulebook/` when they are published, before they take effect.
- line 129–130: You may ask again (a new task id) if an answer was unusable, was withdrawn or was rejected by your schema; the deadline does not move.
- line 139–140: R3.1 If the allocation has a fulfilment with `available: false` (location `null`), then within **120 min** of the time the order was cleared: set the order to `…
- line 172–173: R4.3 **Collection.** Each location's carrier collects once a day at the location's `collectionTime` (`master/locations.json`, local time).
- line 207–208: R6.2 **Customer cancel during processing.** An order is *processing* from the time it is ready (R4.1) until it ends (R4.5, R6).
- line 210: If it counts: stop the order.
- line 229–231: R7.2 Statuses only move forward: `pending` → `processing` → `dispatched` → `completed` for a fulfilment, with `unavailable`, `cancelled` and `failed` as the oth…
- line 239: | template | when |
- line 252: - S1 The customer's deadline is anchored at `p`, not at the time you set `customerActionRequired`.
- line 252–253: Deadlines are inclusive for the party who must act by them and exclusive for the timeout that follows them (R2.2, R3.2).
- line 255: - S3 One review deadline per order, from the first review task.
- line 263–265: - S9 A step that a counted customer cancel or action makes moot before you took it is no longer required: the R3.1 status and notice when the customer acts firs…
- line 265: Taking such a step anyway (before stopping the order) is allowed.
- line 266–267: - S7 Whether a shipment "has been reported collected" before a cancel is judged by the report's `reportedAt` (a `collected`, `inTransit` or `delivered` report a…
- line 273–274: That application **never compensates**: if shipping fails after a successful charge, the fulfilment is marked failed and the charge stays.
- line 274–275: This spec adds the saga: compensation in reverse order of committed steps, the customer's right to cancel until collection, and an explicit rule for every race.

Dropped at extraction (quote not verbatim or kind unknown): 1.

## 3. Failing instances

### Q-005 (must): Declare the order id as the subject of every instance, or null if the message belongs to no order.

> `decisions.subject` is the order id (§3.1) the instance works on, or `null` if the message belongs to no order.

World 1235, ORD-1235-0001 at 2026-03-02T00:00:00+01:00: no decision effect carries the order id as subject

```
* 03-02 00:00 mig-00001 migration
  03-02 00:00 em-0000001 inventory.allocate -> ok @00:01
  03-02 00:00 em-0000002 fraud.check -> ok @00:01
  03-02 00:01 em-0000003 orders.create k=ORD-1235-0001:create:-:- [SKU-1030, SKU-1018] customerId=C-0002 placedAt=2026-03-01T23:29:00+01:… currency=EUR totalMinor=59241 -> ok @00:02
  03-02 00:02 em-0000004 orders.setStatus k=ORD-1235-0001:os:-:processing fulfilmentId=null status=processing -> ok @00:03
  03-02 00:02 em-0000005 orders.setStatus k=ORD-1235…D-1235-0001-F1:processing fulfilmentId=ORD-1235-0001-F1 status=processing -> ok @00:03
  03-02 00:02 em-0000006 orders.setStatus k=ORD-1235…D-1235-0001-F2:processing fulfilmentId=ORD-1235-0001-F2 status=processing -> ok @00:03
  03-02 00:02 em-0000007 inventory.reserve [SKU-1018 k=ORD-1235…1235-0001-F1:SKU-1018] fulfilmentId=ORD-1235-0001-F1 location=WH-RTM -> ok @00:03
  03-02 00:02 em-0000008 inventory.reserve [SKU-1030 k=ORD-1235…1235-0001-F2:SKU-1030] fulfilmentId=ORD-1235-0001-F2 location=WH-EIN -> ok @00:03
  03-02 00:03 em-0000009 billing.charge k=ORD-1235…01:chg:ORD-1235-0001-F1:- fulfilmentId=ORD-1235-0001-F1 customerId=C-0002 amountMinor=1494 currency=EUR -> ok @00:04
  03-02 00:03 em-0000010 billing.charge k=ORD-1235…01:chg:ORD-1235-0001-F2:- fulfilmentId=ORD-1235-0001-F2 customerId=C-0002 amountMinor=57747 currency=EUR -> ok @00:04
  03-02 00:04 em-0000011 carrier.create k=ORD-1235…01:shp:ORD-1235-0001-F1:- fulfilmentId=ORD-1235-0001-F1 location=WH-RTM ref=ORD-1235-0001-F1 -> ok @00:05
  03-02 00:04 em-0000012 carrier.create k=ORD-1235…01:shp:ORD-1235-0001-F2:- fulfilmentId=ORD-1235-0001-F2 location=WH-EIN ref=ORD-1235-0001-F2 -> ok @00:05
```

World 1235, ORD-1235-0002 at 2026-03-02T00:00:00+01:00: no decision effect carries the order id as subject

```
* 03-02 00:00 mig-00002 migration
  03-02 02:19 ev-ORD-1235-0002-act-1 customer.action orderRef=ORD-1235-0002 action=cancel from=c0026@hollin-shop.examp…
  03-02 02:19 em-0000021 orders.setStatus k=ORD-1235-0002:os:-:cancelled fulfilmentId=null status=cancelled -> ok @02:20
  03-02 02:19 em-0000022 notify.send k=ORD-1235-0002:n:-:order-cancelled to=c0026@hollin-shop.examp… about=ORD-1235-0002 template=order-cancelled text=Your order was cancelle… -> ok @02:20
  03-02 02:19 em-0000023 orders.setStatus k=ORD-1235…RD-1235-0002-F1:cancelled fulfilmentId=ORD-1235-0002-F1 status=cancelled -> ok @02:20
  03-02 02:19 em-0000024 orders.setStatus k=ORD-1235…RD-1235-0002-F2:cancelled fulfilmentId=ORD-1235-0002-F2 status=cancelled -> ok @02:20
```

World 1235, ORD-1235-0003 at 2026-03-02T00:00:00+01:00: no decision effect carries the order id as subject

```
* 03-02 00:00 mig-00003 migration
```

### Q-007 (never): Never treat a repeated delivery of the same order as a second order.

> The same order can be delivered more than once; it is still one order.

World 1235, ORD-1235-0001 at 2026-03-02T00:04:00+01:00: second order-creating effect for the same order with a different key

```
  03-02 00:00 mig-00001 migration
  03-02 00:00 em-0000001 inventory.allocate -> ok @00:01
  03-02 00:00 em-0000002 fraud.check -> ok @00:01
* 03-02 00:01 em-0000003 orders.create k=ORD-1235-0001:create:-:- [SKU-1030, SKU-1018] customerId=C-0002 placedAt=2026-03-01T23:29:00+01:… currency=EUR totalMinor=59241 -> ok @00:02
  03-02 00:02 em-0000004 orders.setStatus k=ORD-1235-0001:os:-:processing fulfilmentId=null status=processing -> ok @00:03
  03-02 00:02 em-0000005 orders.setStatus k=ORD-1235…D-1235-0001-F1:processing fulfilmentId=ORD-1235-0001-F1 status=processing -> ok @00:03
  03-02 00:02 em-0000006 orders.setStatus k=ORD-1235…D-1235-0001-F2:processing fulfilmentId=ORD-1235-0001-F2 status=processing -> ok @00:03
  03-02 00:02 em-0000007 inventory.reserve [SKU-1018 k=ORD-1235…1235-0001-F1:SKU-1018] fulfilmentId=ORD-1235-0001-F1 location=WH-RTM -> ok @00:03
  03-02 00:02 em-0000008 inventory.reserve [SKU-1030 k=ORD-1235…1235-0001-F2:SKU-1030] fulfilmentId=ORD-1235-0001-F2 location=WH-EIN -> ok @00:03
  03-02 00:03 em-0000009 billing.charge k=ORD-1235…01:chg:ORD-1235-0001-F1:- fulfilmentId=ORD-1235-0001-F1 customerId=C-0002 amountMinor=1494 currency=EUR -> ok @00:04
  03-02 00:03 em-0000010 billing.charge k=ORD-1235…01:chg:ORD-1235-0001-F2:- fulfilmentId=ORD-1235-0001-F2 customerId=C-0002 amountMinor=57747 currency=EUR -> ok @00:04
* 03-02 00:04 em-0000011 carrier.create k=ORD-1235…01:shp:ORD-1235-0001-F1:- fulfilmentId=ORD-1235-0001-F1 location=WH-RTM ref=ORD-1235-0001-F1 -> ok @00:05
  03-02 00:04 em-0000012 carrier.create k=ORD-1235…01:shp:ORD-1235-0001-F2:- fulfilmentId=ORD-1235-0001-F2 location=WH-EIN ref=ORD-1235-0001-F2 -> ok @00:05
```

World 1235, ORD-1235-0001 at 2026-03-02T00:04:00+01:00: second order-creating effect for the same order with a different key

```
  03-02 00:00 mig-00001 migration
  03-02 00:00 em-0000001 inventory.allocate -> ok @00:01
  03-02 00:00 em-0000002 fraud.check -> ok @00:01
* 03-02 00:01 em-0000003 orders.create k=ORD-1235-0001:create:-:- [SKU-1030, SKU-1018] customerId=C-0002 placedAt=2026-03-01T23:29:00+01:… currency=EUR totalMinor=59241 -> ok @00:02
  03-02 00:02 em-0000004 orders.setStatus k=ORD-1235-0001:os:-:processing fulfilmentId=null status=processing -> ok @00:03
  03-02 00:02 em-0000005 orders.setStatus k=ORD-1235…D-1235-0001-F1:processing fulfilmentId=ORD-1235-0001-F1 status=processing -> ok @00:03
  03-02 00:02 em-0000006 orders.setStatus k=ORD-1235…D-1235-0001-F2:processing fulfilmentId=ORD-1235-0001-F2 status=processing -> ok @00:03
  03-02 00:02 em-0000007 inventory.reserve [SKU-1018 k=ORD-1235…1235-0001-F1:SKU-1018] fulfilmentId=ORD-1235-0001-F1 location=WH-RTM -> ok @00:03
  03-02 00:02 em-0000008 inventory.reserve [SKU-1030 k=ORD-1235…1235-0001-F2:SKU-1030] fulfilmentId=ORD-1235-0001-F2 location=WH-EIN -> ok @00:03
  03-02 00:03 em-0000009 billing.charge k=ORD-1235…01:chg:ORD-1235-0001-F1:- fulfilmentId=ORD-1235-0001-F1 customerId=C-0002 amountMinor=1494 currency=EUR -> ok @00:04
  03-02 00:03 em-0000010 billing.charge k=ORD-1235…01:chg:ORD-1235-0001-F2:- fulfilmentId=ORD-1235-0001-F2 customerId=C-0002 amountMinor=57747 currency=EUR -> ok @00:04
  03-02 00:04 em-0000011 carrier.create k=ORD-1235…01:shp:ORD-1235-0001-F1:- fulfilmentId=ORD-1235-0001-F1 location=WH-RTM ref=ORD-1235-0001-F1 -> ok @00:05
* 03-02 00:04 em-0000012 carrier.create k=ORD-1235…01:shp:ORD-1235-0001-F2:- fulfilmentId=ORD-1235-0001-F2 location=WH-EIN ref=ORD-1235-0001-F2 -> ok @00:05
```

World 1235, ORD-1235-0004 at 2026-03-02T01:29:00+01:00: second order-creating effect for the same order with a different key

```
  03-02 01:25 ev-ORD-1235-0004 order.placed orderId=ORD-1235-0004 customerId=C-0001 placedAt=2026-03-02T01:25:00+01:… currency=EUR
  03-02 01:25 em-0000013 inventory.allocate -> ok @01:26
  03-02 01:25 em-0000014 fraud.check -> ok @01:26
* 03-02 01:26 em-0000015 orders.create k=ORD-1235-0004:create:-:- [SKU-1006] customerId=C-0001 placedAt=2026-03-02T01:25:00+01:… currency=EUR totalMinor=8194 -> ok @01:27
  03-02 01:27 em-0000016 orders.setStatus k=ORD-1235-0004:os:-:processing fulfilmentId=null status=processing -> ok @01:28
  03-02 01:27 em-0000017 orders.setStatus k=ORD-1235…D-1235-0004-F1:processing fulfilmentId=ORD-1235-0004-F1 status=processing -> ok @01:28
  03-02 01:27 em-0000018 inventory.reserve [SKU-1006 k=ORD-1235…1235-0004-F1:SKU-1006] fulfilmentId=ORD-1235-0004-F1 location=WH-RTM -> ok @01:28
  03-02 01:28 em-0000019 billing.charge k=ORD-1235…04:chg:ORD-1235-0004-F1:- fulfilmentId=ORD-1235-0004-F1 customerId=C-0001 amountMinor=8194 currency=EUR -> ok @01:29
* 03-02 01:29 em-0000020 carrier.create k=ORD-1235…04:shp:ORD-1235-0004-F1:- fulfilmentId=ORD-1235-0004-F1 location=WH-RTM ref=ORD-1235-0004-F1 -> ok @01:30
```

### Q-011 (must): Match pre-go-live carrier messages to their order by fulfilmentRef.

> Carrier messages for shipments booked before go-live carry no `ref` you placed: they start new instances and must be matched to their order by `fulfilmentRef`.

World 1237, ORD-1237-0006 at 2026-03-02T16:36:00+01:00: carrier message with fulfilmentRef has no matching effect

```
* 03-02 16:36 ev-ORD-1237-0006-gl-del-dup carrier.status carrier=PARCELLA code=DELIVERED shipmentId=SHP-GL-006 fulfilmentRef=ORD-1237-0006-F1
```

World 1237, ORD-1237-0003 at 2026-03-03T03:46:00+01:00: carrier message with fulfilmentRef has no matching effect

```
* 03-03 03:46 ev-ORD-1237-0003-gl-del-dup carrier.status carrier=VELOX code=DL shipmentId=SHP-GL-003 fulfilmentRef=ORD-1237-0003-F1
```

### Q-018 (never): Do nothing for a placed order whose id is already recorded.

> A placed order whose id you already recorded is a duplicate: no effect.

World 1236, ORD-1236-0014 at 2026-03-03T18:16:00+01:00: duplicate order.placed produced 3 effect(s)/refused candidate(s)

```
  03-03 18:10 ev-ORD-1236-0014 order.placed orderId=ORD-1236-0014 customerId=C-0011 placedAt=2026-03-03T18:10:00+01:… currency=EUR
  03-03 18:10 em-0000136 inventory.allocate -> ok @18:11
  03-03 18:10 em-0000137 fraud.check -> ok @18:11
  03-03 18:11 em-0000138 orders.create k=ORD-1236-0014:create:-:- [SKU-1022] customerId=C-0011 placedAt=2026-03-03T18:10:00+01:… currency=EUR totalMinor=10649 -> ok @18:12
  03-03 18:12 em-0000139 orders.setStatus k=ORD-1236-0014:os:-:processing fulfilmentId=null status=processing -> ok @18:13
  03-03 18:12 em-0000140 orders.setStatus k=ORD-1236…D-1236-0014-F1:processing fulfilmentId=ORD-1236-0014-F1 status=processing -> ok @18:13
  03-03 18:12 em-0000141 inventory.reserve [SKU-1022 k=ORD-1236…1236-0014-F1:SKU-1022] fulfilmentId=ORD-1236-0014-F1 location=WH-EIN -> ok @18:13
  03-03 18:13 em-0000142 billing.charge k=ORD-1236…14:chg:ORD-1236-0014-F1:- fulfilmentId=ORD-1236-0014-F1 customerId=C-0011 amountMinor=10649 currency=EUR -> ok @18:14
  03-03 18:14 em-0000143 carrier.create k=ORD-1236…14:shp:ORD-1236-0014-F1:- fulfilmentId=ORD-1236-0014-F1 location=WH-EIN ref=ORD-1236-0014-F1 -> ok @18:15
* 03-03 18:16 ev-ORD-1236-0014-dup order.placed orderId=ORD-1236-0014 customerId=C-0011 placedAt=2026-03-03T18:10:00+01:… currency=EUR
  03-03 18:19 h-0000263 carrier.status carrier=PARCELLA code=LABEL_CREATED shipmentId=SHP000017 fulfilmentRef=ORD-1236-0014-F1
  03-04 13:30 h-0000265 carrier.status carrier=PARCELLA code=COLLECTED shipmentId=SHP000017 fulfilmentRef=ORD-1236-0014-F1
* 03-04 13:30 em-0000211 orders.setStatus k=ORD-1236…D-1236-0014-F1:dispatched fulfilmentId=ORD-1236-0014-F1 status=dispatched -> ok @13:31
  03-04 21:01 h-0000267 carrier.status carrier=PARCELLA code=IN_TRANSIT shipmentId=SHP000017 fulfilmentRef=ORD-1236-0014-F1
  (+3 more rows)
```

World 1236, ORD-1236-0020 at 2026-03-04T14:49:00+01:00: duplicate order.placed produced 4 effect(s)/refused candidate(s)

```
* 03-04 14:49 ev-ORD-1236-0020-dup order.placed orderId=ORD-1236-0020 customerId=C-0036 placedAt=2026-03-04T14:03:00+01:… currency=EUR
  03-04 18:04 h-0000395 timer.fired obligationId=ORD-1236-0020:cust kind=deadline anchor=2026-03-04T14:03:00+01:… onDue=customerDeadline
* 03-04 18:04 em-0000224 orders.setStatus k=ORD-1236…RD-1236-0020-F1:cancelled fulfilmentId=ORD-1236-0020-F1 status=cancelled -> ok @18:05
* 03-04 18:04 em-0000225 orders.setStatus k=ORD-1236…RD-1236-0020-F2:cancelled fulfilmentId=ORD-1236-0020-F2 status=cancelled -> ok @18:05
* 03-04 18:04 em-0000226 orders.setStatus k=ORD-1236-0020:os:-:timedOut fulfilmentId=null status=timedOut -> ok @18:05
* 03-04 18:04 em-0000227 notify.send k=ORD-1236-0020:n:-:order-timed-out to=c0036@hollin-shop.examp… about=ORD-1236-0020 template=order-timed-out text=Your order timed out an… -> ok @18:05
  03-04 18:13 ev-ORD-1236-0020-act-1 customer.action orderRef= ord-1236-0020 action=cancel from=c0036@hollin-shop.examp…
```

World 1236, ORD-1236-0021 at 2026-03-04T21:15:00+01:00: duplicate order.placed produced 3 effect(s)/refused candidate(s)

```
* 03-04 21:15 ev-ORD-1236-0021-dup order.placed orderId=ORD-1236-0021 customerId=C-0031 placedAt=2026-03-04T20:42:00+01:… currency=EUR
  03-05 13:30 h-0000436 carrier.status carrier=PARCELLA code=COLLECTED shipmentId=SHP000025 fulfilmentRef=ORD-1236-0021-F1
* 03-05 13:30 em-0000288 orders.setStatus k=ORD-1236…D-1236-0021-F1:dispatched fulfilmentId=ORD-1236-0021-F1 status=dispatched -> ok @13:31
  03-05 20:27 h-0000438 carrier.status carrier=PARCELLA code=IN_TRANSIT shipmentId=SHP000025 fulfilmentRef=ORD-1236-0021-F1
  03-06 08:57 h-0000440 carrier.status carrier=PARCELLA code=DELIVERED shipmentId=SHP000025 fulfilmentRef=ORD-1236-0021-F1
* 03-06 08:57 em-0000381 orders.setStatus k=ORD-1236…RD-1236-0021-F1:completed fulfilmentId=ORD-1236-0021-F1 status=completed -> ok @08:58
* 03-06 08:57 em-0000382 orders.setStatus k=ORD-1236-0021:os:-:completed fulfilmentId=null status=completed -> ok @08:58
```

### Q-019 (must): Read fraud.check for every new order.

> Read `fraud.check` for every new order.

World 1236, ORD-1236-0014 at 2026-03-03T18:16:00+01:00: no fraud.check effect followed the new order

```
  03-03 18:10 ev-ORD-1236-0014 order.placed orderId=ORD-1236-0014 customerId=C-0011 placedAt=2026-03-03T18:10:00+01:… currency=EUR
  03-03 18:10 em-0000136 inventory.allocate -> ok @18:11
  03-03 18:10 em-0000137 fraud.check -> ok @18:11
  03-03 18:11 em-0000138 orders.create k=ORD-1236-0014:create:-:- [SKU-1022] customerId=C-0011 placedAt=2026-03-03T18:10:00+01:… currency=EUR totalMinor=10649 -> ok @18:12
  03-03 18:12 em-0000139 orders.setStatus k=ORD-1236-0014:os:-:processing fulfilmentId=null status=processing -> ok @18:13
  03-03 18:12 em-0000140 orders.setStatus k=ORD-1236…D-1236-0014-F1:processing fulfilmentId=ORD-1236-0014-F1 status=processing -> ok @18:13
  03-03 18:12 em-0000141 inventory.reserve [SKU-1022 k=ORD-1236…1236-0014-F1:SKU-1022] fulfilmentId=ORD-1236-0014-F1 location=WH-EIN -> ok @18:13
  03-03 18:13 em-0000142 billing.charge k=ORD-1236…14:chg:ORD-1236-0014-F1:- fulfilmentId=ORD-1236-0014-F1 customerId=C-0011 amountMinor=10649 currency=EUR -> ok @18:14
  03-03 18:14 em-0000143 carrier.create k=ORD-1236…14:shp:ORD-1236-0014-F1:- fulfilmentId=ORD-1236-0014-F1 location=WH-EIN ref=ORD-1236-0014-F1 -> ok @18:15
* 03-03 18:16 ev-ORD-1236-0014-dup order.placed orderId=ORD-1236-0014 customerId=C-0011 placedAt=2026-03-03T18:10:00+01:… currency=EUR
  03-03 18:19 h-0000263 carrier.status carrier=PARCELLA code=LABEL_CREATED shipmentId=SHP000017 fulfilmentRef=ORD-1236-0014-F1
```

World 1236, ORD-1236-0020 at 2026-03-04T14:49:00+01:00: no fraud.check effect followed the new order

```
* 03-04 14:49 ev-ORD-1236-0020-dup order.placed orderId=ORD-1236-0020 customerId=C-0036 placedAt=2026-03-04T14:03:00+01:… currency=EUR
```

World 1236, ORD-1236-0021 at 2026-03-04T21:15:00+01:00: no fraud.check effect followed the new order

```
* 03-04 21:15 ev-ORD-1236-0021-dup order.placed orderId=ORD-1236-0021 customerId=C-0031 placedAt=2026-03-04T20:42:00+01:… currency=EUR
```

### Q-021 (deadline): On a reject verdict, cancel the order with reason fraud within 120 min of p (window [p, p+120]).

> `reject`: cancel the order (R6.1) within **120 min** of `p`, reason `fraud`.

World 1236, ORD-1236-0040 at 2026-03-08T08:23:00+01:00: no fraud cancel within 120 min of placedAt

```
* 03-08 08:23 h-0000945 humanTask.answered taskId=ORD-1236-0040:fr1 user=u-fa1
  03-08 08:23 em-0000665 orders.setStatus k=ORD-1236-0040:os:-:cancelled fulfilmentId=null status=cancelled -> ok @08:24
  03-08 08:23 em-0000666 notify.send k=ORD-1236-0040:n:-:order-cancelled to=c0030@hollin-shop.examp… about=ORD-1236-0040 template=order-cancelled text=Your order was cancelle… -> ok @08:24
  03-08 08:23 em-0000667 orders.setStatus k=ORD-1236…RD-1236-0040-F1:cancelled fulfilmentId=ORD-1236-0040-F1 status=cancelled -> ok @08:24
```

World 1236, ORD-1236-0056 at 2026-03-09T07:04:00+01:00: no fraud cancel within 120 min of placedAt

```
* 03-09 07:04 h-0001370 humanTask.answered taskId=ORD-1236-0056:fr1 user=u-fa1
  03-09 07:04 em-0000838 orders.setStatus k=ORD-1236-0056:os:-:cancelled fulfilmentId=null status=cancelled -> ok @07:05
  03-09 07:04 em-0000839 notify.send k=ORD-1236-0056:n:-:order-cancelled to=c0004@hollin-shop.examp… about=ORD-1236-0056 template=order-cancelled text=Your order was cancelle… -> ok @07:05
  03-09 07:04 em-0000840 orders.setStatus k=ORD-1236…RD-1236-0056-F1:cancelled fulfilmentId=ORD-1236-0056-F1 status=cancelled -> ok @07:05
  03-09 07:04 em-0000841 orders.setStatus k=ORD-1236…RD-1236-0056-F2:cancelled fulfilmentId=ORD-1236-0056-F2 status=cancelled -> ok @07:05
```

World 1236, ORD-1236-0075 at 2026-03-13T10:01:00+01:00: no fraud cancel within 120 min of placedAt

```
* 03-13 10:01 h-0001724 humanTask.answered taskId=ORD-1236-0075:fr1 user=u-fa1
  03-13 10:01 em-0001092 orders.setStatus k=ORD-1236-0075:os:-:cancelled fulfilmentId=null status=cancelled -> ok @10:02
  03-13 10:01 em-0001093 notify.send k=ORD-1236-0075:n:-:order-cancelled to=c0002@hollin-shop.examp… about=ORD-1236-0075 template=order-cancelled text=Your order was cancelle… -> ok @10:02
  03-13 10:01 em-0001094 orders.setStatus k=ORD-1236…RD-1236-0075-F1:cancelled fulfilmentId=ORD-1236-0075-F1 status=cancelled -> ok @10:02
```

### Q-024 (must): The analyst's review window runs from creation of the first review task for the order; retries do not move it.

> from the creation of the **first** review task for the order.

World 1236, ORD-1236-0015 at 2026-03-03T18:52:00+01:00: no review deadline declared for first review task

```
  03-03 18:50 ev-ORD-1236-0015 order.placed orderId= ord-1236-0015 customerId=C-0004 placedAt=2026-03-03T18:50:00+01:… currency=EUR
  03-03 18:50 em-0000144 inventory.allocate -> ok @18:51
  03-03 18:50 em-0000145 fraud.check -> ok @18:51
  03-03 18:51 em-0000146 orders.create k=ORD-1236-0015:create:-:- [SKU-1019, SKU-1028] customerId=C-0004 placedAt=2026-03-03T18:50:00+01:… currency=EUR totalMinor=56385 -> ok @18:52
```

World 1236, ORD-1236-0019 at 2026-03-04T10:46:00+01:00: no review deadline declared for first review task

```
  03-04 10:44 ev-ORD-1236-0019 order.placed orderId=ORD-1236-0019 customerId=C-0040 placedAt=2026-03-04T10:44:00+01:… currency=EUR
  03-04 10:44 em-0000199 inventory.allocate -> ok @10:45
  03-04 10:44 em-0000200 fraud.check -> ok @10:45
  03-04 10:45 em-0000201 orders.create k=ORD-1236-0019:create:-:- [SKU-1030, SKU-1020, SKU-1007] customerId=C-0040 placedAt=2026-03-04T10:44:00+01:… currency=EUR totalMinor=94339 -> ok @10:46
```

World 1236, ORD-1236-0040 at 2026-03-07T15:51:00+01:00: no review deadline declared for first review task

```
  03-07 15:49 ev-ORD-1236-0040 order.placed orderId=ORD-1236-0040 customerId=C-0030 placedAt=2026-03-07T15:49:00+01:… currency=EUR
  03-07 15:49 em-0000558 inventory.allocate -> ok @15:50
  03-07 15:49 em-0000559 fraud.check -> ok @15:50
  03-07 15:50 em-0000560 orders.create k=ORD-1236-0040:create:-:- [SKU-1012] customerId=C-0030 placedAt=2026-03-07T15:49:00+01:… currency=EUR totalMinor=20424 -> ok @15:51
```

### Q-025 (must): An approve answer before the review deadline clears the order at the answer time.

> `approve` before the deadline: the order is **cleared** at the time of the answer.

World 1236, ORD-1236-0015 at 2026-03-04T11:44:00+01:00: approve before deadline but no clear effect at answer time

```
* 03-04 11:44 h-0000275 humanTask.answered taskId=ORD-1236-0015:fr1 user=u-fa1
  03-04 11:44 em-0000202 orders.setStatus k=ORD-1236-0015:os:-:processing fulfilmentId=null status=processing -> ok @11:45
  03-04 11:44 em-0000203 orders.setStatus k=ORD-1236…D-1236-0015-F1:processing fulfilmentId=ORD-1236-0015-F1 status=processing -> ok @11:45
  03-04 11:44 em-0000204 orders.setStatus k=ORD-1236…D-1236-0015-F2:processing fulfilmentId=ORD-1236-0015-F2 status=processing -> ok @11:45
  03-04 11:44 em-0000205 inventory.reserve [SKU-1019 k=ORD-1236…1236-0015-F1:SKU-1019] fulfilmentId=ORD-1236-0015-F1 location=WH-AMS -> ok @11:45
  03-04 11:44 em-0000206 inventory.reserve [SKU-1028 k=ORD-1236…1236-0015-F2:SKU-1028] fulfilmentId=ORD-1236-0015-F2 location=WH-RTM -> ok @11:45
  03-04 11:45 em-0000207 billing.charge k=ORD-1236…15:chg:ORD-1236-0015-F1:- fulfilmentId=ORD-1236-0015-F1 customerId=C-0004 amountMinor=17592 currency=EUR -> ok @11:46
  03-04 11:45 em-0000208 billing.charge k=ORD-1236…15:chg:ORD-1236-0015-F2:- fulfilmentId=ORD-1236-0015-F2 customerId=C-0004 amountMinor=38793 currency=EUR -> ok @11:46
  03-04 11:46 em-0000209 carrier.create k=ORD-1236…15:shp:ORD-1236-0015-F1:- fulfilmentId=ORD-1236-0015-F1 location=WH-AMS ref=ORD-1236-0015-F1 -> ok @11:47
  03-04 11:46 em-0000210 carrier.create k=ORD-1236…15:shp:ORD-1236-0015-F2:- fulfilmentId=ORD-1236-0015-F2 location=WH-RTM ref=ORD-1236-0015-F2 -> ok @11:47
  03-04 11:51 h-0000362 carrier.status carrier=PARCELLA code=LABEL_CREATED shipmentId=SHP000021 fulfilmentRef=ORD-1236-0015-F1
```

World 1236, ORD-1236-0019 at 2026-03-04T18:15:00+01:00: approve before deadline but no clear effect at answer time

```
* 03-04 18:15 h-0000354 humanTask.answered taskId=ORD-1236-0019:fr1 user=u-fa1
  03-04 18:15 em-0000228 orders.setStatus k=ORD-1236-0019:os:-:processing fulfilmentId=null status=processing -> ok @18:16
  03-04 18:15 em-0000229 orders.setStatus k=ORD-1236…D-1236-0019-F1:processing fulfilmentId=ORD-1236-0019-F1 status=processing -> ok @18:16
  03-04 18:15 em-0000230 orders.setStatus k=ORD-1236…D-1236-0019-F2:processing fulfilmentId=ORD-1236-0019-F2 status=processing -> ok @18:16
  03-04 18:15 em-0000231 inventory.reserve [SKU-1007 k=ORD-1236…1236-0019-F1:SKU-1007] fulfilmentId=ORD-1236-0019-F1 location=WH-AMS -> ok @18:16
  03-04 18:15 em-0000232 inventory.reserve [SKU-1030 k=ORD-1236…1236-0019-F2:SKU-1030, SKU-1020 k=ORD-1236…1236-0019-F2:SKU-1020] fulfilmentId=ORD-1236-0019-F2 location=WH-EIN -> ok @18:16
  03-04 18:16 em-0000233 billing.charge k=ORD-1236…19:chg:ORD-1236-0019-F1:- fulfilmentId=ORD-1236-0019-F1 customerId=C-0040 amountMinor=12894 currency=EUR -> ok @18:17
  03-04 18:16 em-0000234 billing.charge k=ORD-1236…19:chg:ORD-1236-0019-F2:- fulfilmentId=ORD-1236-0019-F2 customerId=C-0040 amountMinor=81445 currency=EUR -> ok @18:17
  03-04 18:17 em-0000235 carrier.create k=ORD-1236…19:shp:ORD-1236-0019-F1:- fulfilmentId=ORD-1236-0019-F1 location=WH-AMS ref=ORD-1236-0019-F1 -> ok @18:18
  03-04 18:17 em-0000236 carrier.create k=ORD-1236…19:shp:ORD-1236-0019-F2:- fulfilmentId=ORD-1236-0019-F2 location=WH-EIN ref=ORD-1236-0019-F2 -> ok @18:18
  03-04 18:22 h-0000414 carrier.status carrier=PARCELLA code=LABEL_CREATED shipmentId=SHP000024 fulfilmentRef=ORD-1236-0019-F2
```

World 1236, ORD-1236-0079 at 2026-03-13T21:23:00+01:00: approve before deadline but no clear effect at answer time

```
* 03-13 21:23 h-0001793 humanTask.answered taskId=ORD-1236-0079:fr1 user=u-fa1
  03-13 21:23 em-0001109 orders.setStatus k=ORD-1236-0079:os:-:processing fulfilmentId=null status=processing -> ok @21:24
  03-13 21:23 em-0001110 orders.setStatus k=ORD-1236…D-1236-0079-F1:processing fulfilmentId=ORD-1236-0079-F1 status=processing -> ok @21:24
  03-13 21:23 em-0001111 orders.setStatus k=ORD-1236…D-1236-0079-F2:processing fulfilmentId=ORD-1236-0079-F2 status=processing -> ok @21:24
  03-13 21:23 em-0001112 inventory.reserve [SKU-1001 k=ORD-1236…1236-0079-F1:SKU-1001] fulfilmentId=ORD-1236-0079-F1 location=WH-AMS -> ok @21:24
  03-13 21:23 em-0001113 inventory.reserve [SKU-1012 k=ORD-1236…1236-0079-F2:SKU-1012] fulfilmentId=ORD-1236-0079-F2 location=WH-EIN -> ok @21:24
  03-13 21:24 em-0001114 billing.charge k=ORD-1236…79:chg:ORD-1236-0079-F1:- fulfilmentId=ORD-1236-0079-F1 customerId=C-0033 amountMinor=10692 currency=EUR -> ok @21:25
  03-13 21:24 em-0001115 billing.charge k=ORD-1236…79:chg:ORD-1236-0079-F2:- fulfilmentId=ORD-1236-0079-F2 customerId=C-0033 amountMinor=40248 currency=EUR -> ok @21:25
  03-13 21:25 em-0001116 carrier.create k=ORD-1236…79:shp:ORD-1236-0079-F1:- fulfilmentId=ORD-1236-0079-F1 location=WH-AMS ref=ORD-1236-0079-F1 -> ok @21:26
  03-13 21:25 em-0001117 carrier.create k=ORD-1236…79:shp:ORD-1236-0079-F2:- fulfilmentId=ORD-1236-0079-F2 location=WH-EIN ref=ORD-1236-0079-F2 -> ok @21:26
  03-13 21:30 h-0001812 carrier.status carrier=PARCELLA code=LABEL_CREATED shipmentId=SHP000095 fulfilmentRef=ORD-1236-0079-F1
```

### Q-027 (when-then): With no usable answer by the review deadline: cancel after the deadline and no later than deadline + 120 min, reason fraud-review-timeout.

> reason `fraud-review-timeout` (an answer exactly at the deadline still counts).

World 1236, ORD-1236-0060 at 2026-03-11T03:46:00+01:00: no fraud-review-timeout cancel by deadline+120min

```
  03-11 03:46 h-0001463 humanTask.timeout taskId=ORD-1236-0060:fr1 onTimeout=fraudReviewTimeout
  03-11 03:47 h-0001514 timer.fired obligationId=ORD-1236-0060:fr kind=deadline anchor=2026-03-10T03:44:00+01:… onDue=fraudReviewDeadline
  03-11 03:47 em-0000923 orders.setStatus k=ORD-1236-0060:os:-:cancelled fulfilmentId=null status=cancelled -> ok @03:48
  03-11 03:47 em-0000924 notify.send k=ORD-1236-0060:n:-:order-cancelled to=c0005@hollin-shop.examp… about=ORD-1236-0060 template=order-cancelled text=Your order was cancelle… -> ok @03:48
  03-11 03:47 em-0000925 orders.setStatus k=ORD-1236…RD-1236-0060-F1:cancelled fulfilmentId=ORD-1236-0060-F1 status=cancelled -> ok @03:48
```

World 1236, ORD-1236-0061 at 2026-03-11T04:00:00+01:00: no fraud-review-timeout cancel by deadline+120min

```
  03-11 04:00 h-0001468 humanTask.timeout taskId=ORD-1236-0061:fr1 onTimeout=fraudReviewTimeout
  03-11 04:01 h-0001518 timer.fired obligationId=ORD-1236-0061:fr kind=deadline anchor=2026-03-10T03:58:00+01:… onDue=fraudReviewDeadline
  03-11 04:01 em-0000926 orders.setStatus k=ORD-1236-0061:os:-:cancelled fulfilmentId=null status=cancelled -> ok @04:02
  03-11 04:01 em-0000927 notify.send k=ORD-1236-0061:n:-:order-cancelled to=c0030@hollin-shop.examp… about=ORD-1236-0061 template=order-cancelled text=Your order was cancelle… -> ok @04:02
  03-11 04:01 em-0000928 orders.setStatus k=ORD-1236…RD-1236-0061-F1:cancelled fulfilmentId=ORD-1236-0061-F1 status=cancelled -> ok @04:02
  03-11 04:01 em-0000929 orders.setStatus k=ORD-1236…RD-1236-0061-F2:cancelled fulfilmentId=ORD-1236-0061-F2 status=cancelled -> ok @04:02
  03-11 04:01 em-0000930 orders.setStatus k=ORD-1236…RD-1236-0061-F3:cancelled fulfilmentId=ORD-1236-0061-F3 status=cancelled -> ok @04:02
```

World 1236, ORD-1236-0065 at 2026-03-12T10:29:00+01:00: no fraud-review-timeout cancel by deadline+120min

```
  03-12 10:29 h-0001533 humanTask.timeout taskId=ORD-1236-0065:fr1 onTimeout=fraudReviewTimeout
  03-12 10:30 h-0001665 timer.fired obligationId=ORD-1236-0065:fr kind=deadline anchor=2026-03-11T10:27:00+01:… onDue=fraudReviewDeadline
  03-12 10:30 em-0001016 orders.setStatus k=ORD-1236-0065:os:-:cancelled fulfilmentId=null status=cancelled -> ok @10:31
  03-12 10:30 em-0001017 notify.send k=ORD-1236-0065:n:-:order-cancelled to=c0017@hollin-shop.examp… about=ORD-1236-0065 template=order-cancelled text=Your order was cancelle… -> ok @10:31
  03-12 10:30 em-0001018 orders.setStatus k=ORD-1236…RD-1236-0065-F1:cancelled fulfilmentId=ORD-1236-0065-F1 status=cancelled -> ok @10:31
```

### Q-031 (must): The first amend or cancel at or before D counts as the customer action.

> The first `amend` or `cancel` for the order whose time is **at or before D** counts

World 1235, ORD-1235-0004 at 2026-03-02T04:25:00.000Z: no amend/cancel at or before deadline

```
```

World 1235, ORD-1235-0005 at 2026-03-02T06:38:00.000Z: no amend/cancel at or before deadline

```
```

World 1235, ORD-1235-0006 at 2026-03-02T21:17:00.000Z: no amend/cancel at or before deadline

```
```

### Q-035 (deadline): On a counted cancel at time a, cancel the order with reason customer within 60 min of a (window [a, a+60]).

> `cancel` at time a: cancel the order (R6.1) within **60 min** of a, reason `customer`.

World 1235, ORD-1235-0002 at 2026-03-02T02:19:00+01:00: no customer cancel of the order within 60 min

```
* 03-02 02:19 ev-ORD-1235-0002-act-1 customer.action orderRef=ORD-1235-0002 action=cancel from=c0026@hollin-shop.examp…
  03-02 02:19 em-0000021 orders.setStatus k=ORD-1235-0002:os:-:cancelled fulfilmentId=null status=cancelled -> ok @02:20
  03-02 02:19 em-0000022 notify.send k=ORD-1235-0002:n:-:order-cancelled to=c0026@hollin-shop.examp… about=ORD-1235-0002 template=order-cancelled text=Your order was cancelle… -> ok @02:20
  03-02 02:19 em-0000023 orders.setStatus k=ORD-1235…RD-1235-0002-F1:cancelled fulfilmentId=ORD-1235-0002-F1 status=cancelled -> ok @02:20
  03-02 02:19 em-0000024 orders.setStatus k=ORD-1235…RD-1235-0002-F2:cancelled fulfilmentId=ORD-1235-0002-F2 status=cancelled -> ok @02:20
```

World 1235, ORD-1235-0012 at 2026-03-04T23:35:00+01:00: no customer cancel of the order within 60 min

```
* 03-04 23:35 ev-ORD-1235-0012-act-1 customer.action orderRef=ORD-1235-0012 action=cancel from=c0012@hollin-shop.examp…
  03-04 23:35 em-0000148 orders.setStatus k=ORD-1235-0012:os:-:cancelled fulfilmentId=null status=cancelled -> ok @23:36
  03-04 23:35 em-0000149 notify.send k=ORD-1235-0012:n:-:order-cancelled to=c0012@hollin-shop.examp… about=ORD-1235-0012 template=order-cancelled text=Your order was cancelle… -> ok @23:36
  03-04 23:35 em-0000150 orders.setStatus k=ORD-1235…RD-1235-0012-F1:cancelled fulfilmentId=ORD-1235-0012-F1 status=cancelled -> ok @23:36
  03-04 23:35 em-0000151 orders.setStatus k=ORD-1235…RD-1235-0012-F2:cancelled fulfilmentId=ORD-1235-0012-F2 status=cancelled -> ok @23:36
  03-04 23:35 em-0000152 orders.setStatus k=ORD-1235…RD-1235-0012-F3:cancelled fulfilmentId=ORD-1235-0012-F3 status=cancelled -> ok @23:36
```

World 1235, ORD-1235-0010 at 2026-03-05T14:39:00+01:00: no customer cancel of the order within 60 min

```
* 03-05 14:39 ev-ORD-1235-0010-act-1 customer.action orderRef=ORD-1235-0010 action=cancel from=c0038@hollin-shop.examp…
  03-05 14:39 em-0000168 notify.send k=ORD-1235-0010:n:-:cancel-refused to=c0038@hollin-shop.examp… about=ORD-1235-0010 template=cancel-refused text=Your order can no longe… -> ok @14:40
```

### Q-036 (deadline): If no action counted by D, after D and no later than D+60 min (window (D, D+60]): cancel all fulfilments, set order timedOut, send order-timed-out.

> nothing counted by D: **after D** and at the latest **D + 60 min** (the window (D, D + 60 min]) set every fulfilment `cancelled`, set the order `timedOut` and send `order-timed-out`.

World 1235, ORD-1235-0041 at 2026-03-10T06:54:00+01:00: missing within (D, D+60]: fulfilment cancel, order timedOut, order-timed-out send

```
  03-10 06:54 h-0000787 timer.fired obligationId=ORD-1235-0041:cust kind=deadline anchor=2026-03-10T02:53:00+01:… onDue=customerDeadline
  03-10 06:54 em-0000520 orders.setStatus k=ORD-1235…RD-1235-0041-F1:cancelled fulfilmentId=ORD-1235-0041-F1 status=cancelled -> ok @06:55
  03-10 06:54 em-0000521 orders.setStatus k=ORD-1235…RD-1235-0041-F2:cancelled fulfilmentId=ORD-1235-0041-F2 status=cancelled -> ok @06:55
  03-10 06:54 em-0000522 orders.setStatus k=ORD-1235-0041:os:-:timedOut fulfilmentId=null status=timedOut -> ok @06:55
  03-10 06:54 em-0000523 notify.send k=ORD-1235-0041:n:-:order-timed-out to=c0038@hollin-shop.examp… about=ORD-1235-0041 template=order-timed-out text=Your order timed out an… -> ok @06:55
```

World 1236, ORD-1236-0009 at 2026-03-02T13:11:00+01:00: missing within (D, D+60]: fulfilment cancel, order timedOut, order-timed-out send

```
  03-02 13:11 h-0000135 timer.fired obligationId=ORD-1236-0009:cust kind=deadline anchor=2026-03-02T09:10:00+01:… onDue=customerDeadline
  03-02 13:11 em-0000071 orders.setStatus k=ORD-1236…RD-1236-0009-F1:cancelled fulfilmentId=ORD-1236-0009-F1 status=cancelled -> ok @13:12
  03-02 13:11 em-0000072 orders.setStatus k=ORD-1236…RD-1236-0009-F2:cancelled fulfilmentId=ORD-1236-0009-F2 status=cancelled -> ok @13:12
  03-02 13:11 em-0000073 orders.setStatus k=ORD-1236-0009:os:-:timedOut fulfilmentId=null status=timedOut -> ok @13:12
  03-02 13:11 em-0000074 notify.send k=ORD-1236-0009:n:-:order-timed-out to=c0007@hollin-shop.examp… about=ORD-1236-0009 template=order-timed-out text=Your order timed out an… -> ok @13:12
```

World 1236, ORD-1236-0015 at 2026-03-04T18:53:00+01:00: missing within (D, D+60]: fulfilment cancel, order timedOut, order-timed-out send

```
  03-04 18:53 h-0000423 timer.fired obligationId=ORD-1236-0015:fr kind=deadline anchor=2026-03-03T18:50:00+01:… onDue=fraudReviewDeadline
```

### Q-040 (never): Do nothing about an order (status or reservation) before it is recorded.

> Nothing about an order (a status, a reservation) is done before the order is recorded (R1.1).

World 1235, ORD-1235-0002 at 2026-03-02T02:19:00+01:00: order status/reservation done with no order record

```
  03-02 02:19 ev-ORD-1235-0002-act-1 customer.action orderRef=ORD-1235-0002 action=cancel from=c0026@hollin-shop.examp…
* 03-02 02:19 em-0000021 orders.setStatus k=ORD-1235-0002:os:-:cancelled fulfilmentId=null status=cancelled -> ok @02:20
  03-02 02:19 em-0000022 notify.send k=ORD-1235-0002:n:-:order-cancelled to=c0026@hollin-shop.examp… about=ORD-1235-0002 template=order-cancelled text=Your order was cancelle… -> ok @02:20
  03-02 02:19 em-0000023 orders.setStatus k=ORD-1235…RD-1235-0002-F1:cancelled fulfilmentId=ORD-1235-0002-F1 status=cancelled -> ok @02:20
  03-02 02:19 em-0000024 orders.setStatus k=ORD-1235…RD-1235-0002-F2:cancelled fulfilmentId=ORD-1235-0002-F2 status=cancelled -> ok @02:20
```

World 1235, ORD-1235-0002 at 2026-03-02T02:19:00+01:00: order status/reservation done with no order record

```
  03-02 02:19 ev-ORD-1235-0002-act-1 customer.action orderRef=ORD-1235-0002 action=cancel from=c0026@hollin-shop.examp…
  03-02 02:19 em-0000021 orders.setStatus k=ORD-1235-0002:os:-:cancelled fulfilmentId=null status=cancelled -> ok @02:20
  03-02 02:19 em-0000022 notify.send k=ORD-1235-0002:n:-:order-cancelled to=c0026@hollin-shop.examp… about=ORD-1235-0002 template=order-cancelled text=Your order was cancelle… -> ok @02:20
* 03-02 02:19 em-0000023 orders.setStatus k=ORD-1235…RD-1235-0002-F1:cancelled fulfilmentId=ORD-1235-0002-F1 status=cancelled -> ok @02:20
  03-02 02:19 em-0000024 orders.setStatus k=ORD-1235…RD-1235-0002-F2:cancelled fulfilmentId=ORD-1235-0002-F2 status=cancelled -> ok @02:20
```

World 1235, ORD-1235-0002 at 2026-03-02T02:19:00+01:00: order status/reservation done with no order record

```
  03-02 02:19 ev-ORD-1235-0002-act-1 customer.action orderRef=ORD-1235-0002 action=cancel from=c0026@hollin-shop.examp…
  03-02 02:19 em-0000021 orders.setStatus k=ORD-1235-0002:os:-:cancelled fulfilmentId=null status=cancelled -> ok @02:20
  03-02 02:19 em-0000022 notify.send k=ORD-1235-0002:n:-:order-cancelled to=c0026@hollin-shop.examp… about=ORD-1235-0002 template=order-cancelled text=Your order was cancelle… -> ok @02:20
  03-02 02:19 em-0000023 orders.setStatus k=ORD-1235…RD-1235-0002-F1:cancelled fulfilmentId=ORD-1235-0002-F1 status=cancelled -> ok @02:20
* 03-02 02:19 em-0000024 orders.setStatus k=ORD-1235…RD-1235-0002-F2:cancelled fulfilmentId=ORD-1235-0002-F2 status=cancelled -> ok @02:20
```

### Q-041 (order): For each available fulfilment, run reserve, then charge, then ship; each step only after the previous one has committed.

> For each available fulfilment, in this order (each step only after the previous step of the same fulfilment has committed):

World 1237, ORD-1237-0047 at 2026-03-04T07:29:00+01:00: charge emitted before reserve committed

```
  03-04 07:26 ev-ORD-1237-0047 order.placed orderId= ord-1237-0047 customerId=C-0013 placedAt=2026-03-04T07:26:00+01:… currency=EUR
  03-04 07:26 em-0000526 inventory.allocate -> ok @07:27
  03-04 07:26 em-0000527 fraud.check -> ok @07:27
  03-04 07:27 em-0000528 orders.create k=ORD-1237-0047:create:-:- [SKU-1002, SKU-1014] customerId=C-0013 placedAt=2026-03-04T07:26:00+01:… currency=EUR totalMinor=10188 -> ok @07:28
  03-04 07:28 em-0000529 orders.setStatus k=ORD-1237-0047:os:-:processing fulfilmentId=null status=processing -> ok @07:29
  03-04 07:28 em-0000530 orders.setStatus k=ORD-1237…D-1237-0047-F1:processing fulfilmentId=ORD-1237-0047-F1 status=processing -> ok @07:29
  03-04 07:28 em-0000531 orders.setStatus k=ORD-1237…D-1237-0047-F2:processing fulfilmentId=ORD-1237-0047-F2 status=processing -> ok @07:29
* 03-04 07:28 em-0000532 inventory.reserve [SKU-1002 k=ORD-1237…1237-0047-F1:SKU-1002] fulfilmentId=ORD-1237-0047-F1 location=WH-AMS -> ok @07:29
  03-04 07:28 em-0000533 inventory.reserve [SKU-1014 k=ORD-1237…1237-0047-F2:SKU-1014] fulfilmentId=ORD-1237-0047-F2 location=WH-RTM -> ok @07:29
* 03-04 07:29 em-0000534 billing.charge k=ORD-1237…47:chg:ORD-1237-0047-F2:- fulfilmentId=ORD-1237-0047-F2 customerId=C-0013 amountMinor=1694 currency=EUR -> ok @07:30
  03-04 07:29 em-0000535 billing.charge k=ORD-1237…47:chg:ORD-1237-0047-F1:- fulfilmentId=ORD-1237-0047-F1 customerId=C-0013 amountMinor=8494 currency=EUR -> ok @07:30
  03-04 07:30 em-0000536 carrier.create k=ORD-1237…47:shp:ORD-1237-0047-F2:- fulfilmentId=ORD-1237-0047-F2 location=WH-RTM ref=ORD-1237-0047-F2 -> ok @07:31
  03-04 07:30 em-0000537 carrier.create k=ORD-1237…47:shp:ORD-1237-0047-F1:- fulfilmentId=ORD-1237-0047-F1 location=WH-AMS ref=ORD-1237-0047-F1 -> ok @07:31
  03-04 07:35 h-0000898 carrier.status carrier=VELOX code=LB shipmentId=SHP000056 fulfilmentRef=ORD-1237-0047-F2
```

World 1237, ORD-1237-0062 at 2026-03-05T15:24:00+01:00: charge emitted before reserve committed

```
  03-05 15:21 ev-ORD-1237-0062 order.placed orderId= ord-1237-0062 customerId=C-0025 placedAt=2026-03-05T15:21:00+01:… currency=EUR
  03-05 15:21 em-0000749 inventory.allocate -> ok @15:22
  03-05 15:21 em-0000750 fraud.check -> ok @15:22
  03-05 15:22 em-0000751 orders.create k=ORD-1237-0062:create:-:- [SKU-1024, SKU-1023, SKU-1022] customerId=C-0025 placedAt=2026-03-05T15:21:00+01:… currency=EUR totalMinor=60086 -> ok @15:23
  03-05 15:23 em-0000752 orders.setStatus k=ORD-1237-0062:os:-:processing fulfilmentId=null status=processing -> ok @15:24
  03-05 15:23 em-0000753 orders.setStatus k=ORD-1237…D-1237-0062-F1:processing fulfilmentId=ORD-1237-0062-F1 status=processing -> ok @15:24
  03-05 15:23 em-0000754 orders.setStatus k=ORD-1237…D-1237-0062-F2:processing fulfilmentId=ORD-1237-0062-F2 status=processing -> ok @15:24
* 03-05 15:23 em-0000755 inventory.reserve [SKU-1024 k=ORD-1237…1237-0062-F1:SKU-1024, SKU-1022 k=ORD-1237…1237-0062-F1:SKU-1022] fulfilmentId=ORD-1237-0062-F1 location=WH-AMS -> partial (#0 error 503 batch-item-not-processed) @15:24
  03-05 15:23 em-0000756 inventory.reserve [SKU-1023 k=ORD-1237…1237-0062-F2:SKU-1023] fulfilmentId=ORD-1237-0062-F2 location=WH-RTM -> ok @15:24
  03-05 15:24 em-0000757 inventory.release k=ORD-1237…ORD-1237-0062-F1:SKU-1022 fulfilmentId=ORD-1237-0062-F1 sku=SKU-1022 -> ok @15:25
* 03-05 15:24 em-0000758 billing.charge k=ORD-1237…62:chg:ORD-1237-0062-F2:- fulfilmentId=ORD-1237-0062-F2 customerId=C-0025 amountMinor=29993 currency=EUR -> ok @15:25
  03-05 15:25 em-0000759 orders.setStatus k=ORD-1237…s:ORD-1237-0062-F1:failed fulfilmentId=ORD-1237-0062-F1 status=failed -> ok @15:26
  03-05 15:25 em-0000760 notify.send k=ORD-1237…0062-F1:fulfilment-failed to=c0025@hollin-shop.examp… about=ORD-1237-0062-F1 template=fulfilment-failed text=Fulfilment ORD-1237-006… -> ok @15:26
  03-05 15:25 em-0000761 carrier.create k=ORD-1237…62:shp:ORD-1237-0062-F2:- fulfilmentId=ORD-1237-0062-F2 location=WH-RTM ref=ORD-1237-0062-F2 -> ok @15:26
```

World 1237, ORD-1237-0100 at 2026-03-07T20:21:00+01:00: charge emitted before reserve committed

```
  03-07 20:18 ev-ORD-1237-0100 order.placed orderId=ORD-1237-0100 customerId=C-0003 placedAt=2026-03-07T20:18:00+01:… currency=EUR
  03-07 20:18 em-0001352 inventory.allocate -> ok @20:19
  03-07 20:18 em-0001353 fraud.check -> ok @20:19
  03-07 20:19 em-0001354 orders.create k=ORD-1237-0100:create:-:- [SKU-1011, SKU-1004, SKU-1008, SKU-1016] customerId=C-0003 placedAt=2026-03-07T20:18:00+01:… currency=EUR totalMinor=74733 -> ok @20:20
  03-07 20:20 em-0001355 orders.setStatus k=ORD-1237-0100:os:-:processing fulfilmentId=null status=processing -> ok @20:21
  03-07 20:20 em-0001356 orders.setStatus k=ORD-1237…D-1237-0100-F1:processing fulfilmentId=ORD-1237-0100-F1 status=processing -> ok @20:21
  03-07 20:20 em-0001357 orders.setStatus k=ORD-1237…D-1237-0100-F2:processing fulfilmentId=ORD-1237-0100-F2 status=processing -> ok @20:21
  03-07 20:20 em-0001358 orders.setStatus k=ORD-1237…D-1237-0100-F3:processing fulfilmentId=ORD-1237-0100-F3 status=processing -> ok @20:21
* 03-07 20:20 em-0001359 inventory.reserve [SKU-1008 k=ORD-1237…1237-0100-F1:SKU-1008, SKU-1016 k=ORD-1237…1237-0100-F1:SKU-1016] fulfilmentId=ORD-1237-0100-F1 location=WH-AMS -> partial (#0 error 503 batch-item-not-processed) @20:21
  03-07 20:20 em-0001360 inventory.reserve [SKU-1004 k=ORD-1237…1237-0100-F2:SKU-1004] fulfilmentId=ORD-1237-0100-F2 location=WH-RTM -> ok @20:21
  03-07 20:20 em-0001361 inventory.reserve [SKU-1011 k=ORD-1237…1237-0100-F3:SKU-1011] fulfilmentId=ORD-1237-0100-F3 location=WH-EIN -> ok @20:21
  03-07 20:21 em-0001362 inventory.release k=ORD-1237…ORD-1237-0100-F1:SKU-1016 fulfilmentId=ORD-1237-0100-F1 sku=SKU-1016 -> ok @20:22
* 03-07 20:21 em-0001363 billing.charge k=ORD-1237…00:chg:ORD-1237-0100-F2:- fulfilmentId=ORD-1237-0100-F2 customerId=C-0003 amountMinor=22393 currency=EUR -> ok @20:22
  03-07 20:21 em-0001364 billing.charge k=ORD-1237…00:chg:ORD-1237-0100-F3:- fulfilmentId=ORD-1237-0100-F3 customerId=C-0003 amountMinor=21949 currency=EUR -> ok @20:22
  (+5 more rows)
```

### Q-043 (must): On a partial reserve batch, resubmit only the failed items with original keys inside the same reserve window.

> If a batch comes back `partial`, resubmit only the failed items, with their original keys, inside the same window.

World 1237, ORD-1237-0062 at 2026-03-05T15:24:00+01:00: failed items not resubmitted (with original keys) in window

```
  03-05 15:21 ev-ORD-1237-0062 order.placed orderId= ord-1237-0062 customerId=C-0025 placedAt=2026-03-05T15:21:00+01:… currency=EUR
  03-05 15:21 em-0000749 inventory.allocate -> ok @15:22
  03-05 15:21 em-0000750 fraud.check -> ok @15:22
  03-05 15:22 em-0000751 orders.create k=ORD-1237-0062:create:-:- [SKU-1024, SKU-1023, SKU-1022] customerId=C-0025 placedAt=2026-03-05T15:21:00+01:… currency=EUR totalMinor=60086 -> ok @15:23
  03-05 15:23 em-0000752 orders.setStatus k=ORD-1237-0062:os:-:processing fulfilmentId=null status=processing -> ok @15:24
  03-05 15:23 em-0000753 orders.setStatus k=ORD-1237…D-1237-0062-F1:processing fulfilmentId=ORD-1237-0062-F1 status=processing -> ok @15:24
  03-05 15:23 em-0000754 orders.setStatus k=ORD-1237…D-1237-0062-F2:processing fulfilmentId=ORD-1237-0062-F2 status=processing -> ok @15:24
* 03-05 15:23 em-0000755 inventory.reserve [SKU-1024 k=ORD-1237…1237-0062-F1:SKU-1024, SKU-1022 k=ORD-1237…1237-0062-F1:SKU-1022] fulfilmentId=ORD-1237-0062-F1 location=WH-AMS -> partial (#0 error 503 batch-item-not-processed) @15:24
  03-05 15:23 em-0000756 inventory.reserve [SKU-1023 k=ORD-1237…1237-0062-F2:SKU-1023] fulfilmentId=ORD-1237-0062-F2 location=WH-RTM -> ok @15:24
  03-05 15:24 em-0000757 inventory.release k=ORD-1237…ORD-1237-0062-F1:SKU-1022 fulfilmentId=ORD-1237-0062-F1 sku=SKU-1022 -> ok @15:25
  03-05 15:24 em-0000758 billing.charge k=ORD-1237…62:chg:ORD-1237-0062-F2:- fulfilmentId=ORD-1237-0062-F2 customerId=C-0025 amountMinor=29993 currency=EUR -> ok @15:25
  03-05 15:25 em-0000759 orders.setStatus k=ORD-1237…s:ORD-1237-0062-F1:failed fulfilmentId=ORD-1237-0062-F1 status=failed -> ok @15:26
  03-05 15:25 em-0000760 notify.send k=ORD-1237…0062-F1:fulfilment-failed to=c0025@hollin-shop.examp… about=ORD-1237-0062-F1 template=fulfilment-failed text=Fulfilment ORD-1237-006… -> ok @15:26
  03-05 15:25 em-0000761 carrier.create k=ORD-1237…62:shp:ORD-1237-0062-F2:- fulfilmentId=ORD-1237-0062-F2 location=WH-RTM ref=ORD-1237-0062-F2 -> ok @15:26
  (+2 more rows)
```

World 1237, ORD-1237-0100 at 2026-03-07T20:21:00+01:00: failed items not resubmitted (with original keys) in window

```
  03-07 20:18 ev-ORD-1237-0100 order.placed orderId=ORD-1237-0100 customerId=C-0003 placedAt=2026-03-07T20:18:00+01:… currency=EUR
  03-07 20:18 em-0001352 inventory.allocate -> ok @20:19
  03-07 20:18 em-0001353 fraud.check -> ok @20:19
  03-07 20:19 em-0001354 orders.create k=ORD-1237-0100:create:-:- [SKU-1011, SKU-1004, SKU-1008, SKU-1016] customerId=C-0003 placedAt=2026-03-07T20:18:00+01:… currency=EUR totalMinor=74733 -> ok @20:20
  03-07 20:20 em-0001355 orders.setStatus k=ORD-1237-0100:os:-:processing fulfilmentId=null status=processing -> ok @20:21
  03-07 20:20 em-0001356 orders.setStatus k=ORD-1237…D-1237-0100-F1:processing fulfilmentId=ORD-1237-0100-F1 status=processing -> ok @20:21
  03-07 20:20 em-0001357 orders.setStatus k=ORD-1237…D-1237-0100-F2:processing fulfilmentId=ORD-1237-0100-F2 status=processing -> ok @20:21
  03-07 20:20 em-0001358 orders.setStatus k=ORD-1237…D-1237-0100-F3:processing fulfilmentId=ORD-1237-0100-F3 status=processing -> ok @20:21
* 03-07 20:20 em-0001359 inventory.reserve [SKU-1008 k=ORD-1237…1237-0100-F1:SKU-1008, SKU-1016 k=ORD-1237…1237-0100-F1:SKU-1016] fulfilmentId=ORD-1237-0100-F1 location=WH-AMS -> partial (#0 error 503 batch-item-not-processed) @20:21
  03-07 20:20 em-0001360 inventory.reserve [SKU-1004 k=ORD-1237…1237-0100-F2:SKU-1004] fulfilmentId=ORD-1237-0100-F2 location=WH-RTM -> ok @20:21
  03-07 20:20 em-0001361 inventory.reserve [SKU-1011 k=ORD-1237…1237-0100-F3:SKU-1011] fulfilmentId=ORD-1237-0100-F3 location=WH-EIN -> ok @20:21
  03-07 20:21 em-0001362 inventory.release k=ORD-1237…ORD-1237-0100-F1:SKU-1016 fulfilmentId=ORD-1237-0100-F1 sku=SKU-1016 -> ok @20:22
  03-07 20:21 em-0001363 billing.charge k=ORD-1237…00:chg:ORD-1237-0100-F2:- fulfilmentId=ORD-1237-0100-F2 customerId=C-0003 amountMinor=22393 currency=EUR -> ok @20:22
  03-07 20:21 em-0001364 billing.charge k=ORD-1237…00:chg:ORD-1237-0100-F3:- fulfilmentId=ORD-1237-0100-F3 customerId=C-0003 amountMinor=21949 currency=EUR -> ok @20:22
  (+5 more rows)
```

World 1237, ORD-1237-0158 at 2026-03-10T22:07:00+01:00: failed items not resubmitted (with original keys) in window

```
  03-10 22:04 ev-ORD-1237-0158 order.placed orderId= ord-1237-0158 customerId=C-0035 placedAt=2026-03-10T22:04:00+01:… currency=EUR
  03-10 22:04 em-0002271 inventory.allocate -> ok @22:05
  03-10 22:04 em-0002272 fraud.check -> ok @22:05
  03-10 22:05 em-0002273 orders.create k=ORD-1237-0158:create:-:- [SKU-1003, SKU-1018, SKU-1006, SKU-1021] customerId=C-0035 placedAt=2026-03-10T22:04:00+01:… currency=EUR totalMinor=51440 -> ok @22:06
  03-10 22:06 em-0002274 orders.setStatus k=ORD-1237-0158:os:-:processing fulfilmentId=null status=processing -> ok @22:07
  03-10 22:06 em-0002275 orders.setStatus k=ORD-1237…D-1237-0158-F1:processing fulfilmentId=ORD-1237-0158-F1 status=processing -> ok @22:07
  03-10 22:06 em-0002276 orders.setStatus k=ORD-1237…D-1237-0158-F2:processing fulfilmentId=ORD-1237-0158-F2 status=processing -> ok @22:07
  03-10 22:06 em-0002277 orders.setStatus k=ORD-1237…D-1237-0158-F3:processing fulfilmentId=ORD-1237-0158-F3 status=processing -> ok @22:07
* 03-10 22:06 em-0002278 inventory.reserve [SKU-1003 k=ORD-1237…1237-0158-F1:SKU-1003, SKU-1006 k=ORD-1237…1237-0158-F1:SKU-1006] fulfilmentId=ORD-1237-0158-F1 location=WH-AMS -> partial (#0 error 503 batch-item-not-processed) @22:07
  03-10 22:06 em-0002279 inventory.reserve [SKU-1018 k=ORD-1237…1237-0158-F2:SKU-1018] fulfilmentId=ORD-1237-0158-F2 location=WH-RTM -> ok @22:07
  03-10 22:06 em-0002280 inventory.reserve [SKU-1021 k=ORD-1237…1237-0158-F3:SKU-1021] fulfilmentId=ORD-1237-0158-F3 location=WH-UTR -> ok @22:07
  03-10 22:07 em-0002281 inventory.release k=ORD-1237…ORD-1237-0158-F1:SKU-1006 fulfilmentId=ORD-1237-0158-F1 sku=SKU-1006 -> ok @22:08
  03-10 22:07 em-0002282 billing.charge k=ORD-1237…58:chg:ORD-1237-0158-F2:- fulfilmentId=ORD-1237-0158-F2 customerId=C-0035 amount=15023 currency=EUR -> ok @22:08
  03-10 22:07 em-0002283 billing.charge k=ORD-1237…58:chg:ORD-1237-0158-F3:- fulfilmentId=ORD-1237-0158-F3 customerId=C-0035 amount=12374 currency=EUR -> ok @22:08
  (+4 more rows)
```

### Q-059 (deadline): After a fulfilment fails, compensate it, set it failed and send fulfilment-failed within 120 min of the failure time.

> Then, within **120 min** of the failure (the time of the declined or failed attempt, or of the carrier's message): compensate it (R5.1), set it `failed` and send `fulfilment-failed` about the fulfilment.

World 1235, ORD-1235-0014 at 2026-03-04T21:33:00+01:00: missing compensation, failed status or fulfilment-failed notice within 120 min

```
  03-04 21:29 ev-ORD-1235-0014 order.placed orderId=ORD-1235-0014 customerId=C-0006 placedAt=2026-03-04T21:29:00+01:… currency=EUR
  03-04 21:29 em-0000119 inventory.allocate -> ok @21:30
  03-04 21:29 em-0000120 fraud.check -> ok @21:30
  03-04 21:30 em-0000121 orders.create k=ORD-1235-0014:create:-:- [SKU-1025, SKU-1023] customerId=C-0006 placedAt=2026-03-04T21:29:00+01:… currency=EUR totalMinor=32292 -> ok @21:31
  03-04 21:31 em-0000122 orders.setStatus k=ORD-1235-0014:os:-:processing fulfilmentId=null status=processing -> ok @21:32
  03-04 21:31 em-0000123 orders.setStatus k=ORD-1235…D-1235-0014-F1:processing fulfilmentId=ORD-1235-0014-F1 status=processing -> ok @21:32
  03-04 21:31 em-0000124 inventory.reserve [SKU-1025 k=ORD-1235…1235-0014-F1:SKU-1025, SKU-1023 k=ORD-1235…1235-0014-F1:SKU-1023] fulfilmentId=ORD-1235-0014-F1 location=WH-AMS -> ok @21:32
* 03-04 21:32 em-0000125 billing.charge k=ORD-1235…14:chg:ORD-1235-0014-F1:- fulfilmentId=ORD-1235-0014-F1 customerId=C-0006 amountMinor=32292 currency=EUR -> error 402 card-declined @21:33
  03-04 21:33 em-0000126 inventory.release k=ORD-1235…ORD-1235-0014-F1:SKU-1025 fulfilmentId=ORD-1235-0014-F1 sku=SKU-1025 -> ok @21:34
  03-04 21:34 em-0000127 inventory.release k=ORD-1235…ORD-1235-0014-F1:SKU-1023 fulfilmentId=ORD-1235-0014-F1 sku=SKU-1023 -> ok @21:35
* 03-04 21:35 em-0000128 orders.setStatus k=ORD-1235…s:ORD-1235-0014-F1:failed fulfilmentId=ORD-1235-0014-F1 status=failed -> ok @21:36
* 03-04 21:35 em-0000129 notify.send k=ORD-1235…0014-F1:fulfilment-failed to=c0006@hollin-shop.examp… about=ORD-1235-0014-F1 template=fulfilment-failed text=Fulfilment ORD-1235-001… -> ok @21:36
  03-04 21:35 em-0000130 orders.setStatus k=ORD-1235-0014:os:-:failed fulfilmentId=null status=failed -> ok @21:36
```

World 1235, ORD-1235-0031 at 2026-03-08T16:49:00+01:00: missing compensation, failed status or fulfilment-failed notice within 120 min

```
  03-08 16:45 ev-ORD-1235-0031 order.placed orderId=ORD-1235-0031 customerId=C-0032 placedAt=2026-03-08T16:45:00+01:… currency=EUR
  03-08 16:45 em-0000377 inventory.allocate -> ok @16:46
  03-08 16:45 em-0000378 fraud.check -> ok @16:46
  03-08 16:46 em-0000379 orders.create k=ORD-1235-0031:create:-:- [SKU-1018] customerId=C-0032 placedAt=2026-03-08T16:45:00+01:… currency=EUR totalMinor=3692 -> ok @16:47
  03-08 16:47 em-0000380 orders.setStatus k=ORD-1235-0031:os:-:processing fulfilmentId=null status=processing -> ok @16:48
  03-08 16:47 em-0000381 orders.setStatus k=ORD-1235…D-1235-0031-F1:processing fulfilmentId=ORD-1235-0031-F1 status=processing -> ok @16:48
  03-08 16:47 em-0000382 inventory.reserve [SKU-1018 k=ORD-1235…1235-0031-F1:SKU-1018] fulfilmentId=ORD-1235-0031-F1 location=WH-RTM -> ok @16:48
* 03-08 16:48 em-0000383 billing.charge k=ORD-1235…31:chg:ORD-1235-0031-F1:- fulfilmentId=ORD-1235-0031-F1 customerId=C-0032 amountMinor=3692 currency=EUR -> error 402 card-declined @16:49
  03-08 16:49 em-0000384 inventory.release k=ORD-1235…ORD-1235-0031-F1:SKU-1018 fulfilmentId=ORD-1235-0031-F1 sku=SKU-1018 -> ok @16:50
* 03-08 16:50 em-0000385 orders.setStatus k=ORD-1235…s:ORD-1235-0031-F1:failed fulfilmentId=ORD-1235-0031-F1 status=failed -> ok @16:51
* 03-08 16:50 em-0000386 notify.send k=ORD-1235…0031-F1:fulfilment-failed to=c0032@hollin-shop.examp… about=ORD-1235-0031-F1 template=fulfilment-failed text=Fulfilment ORD-1235-003… -> ok @16:51
  03-08 16:50 em-0000387 orders.setStatus k=ORD-1235-0031:os:-:failed fulfilmentId=null status=failed -> ok @16:51
```

World 1236, ORD-1236-0034 at 2026-03-06T15:10:00+01:00: missing compensation, failed status or fulfilment-failed notice within 120 min

```
  03-06 15:06 ev-ORD-1236-0034 order.placed orderId=ORD-1236-0034 customerId=C-0006 placedAt=2026-03-06T15:06:00+01:… currency=EUR
  03-06 15:06 em-0000441 inventory.allocate -> ok @15:07
  03-06 15:06 em-0000442 fraud.check -> ok @15:07
  03-06 15:07 em-0000443 orders.create k=ORD-1236-0034:create:-:- [SKU-1010, SKU-1026, SKU-1020, SKU-1029] customerId=C-0006 placedAt=2026-03-06T15:06:00+01:… currency=EUR totalMinor=137357 -> ok @15:08
  03-06 15:08 em-0000444 orders.setStatus k=ORD-1236-0034:os:-:processing fulfilmentId=null status=processing -> ok @15:09
  03-06 15:08 em-0000445 orders.setStatus k=ORD-1236…D-1236-0034-F1:processing fulfilmentId=ORD-1236-0034-F1 status=processing -> ok @15:09
  03-06 15:08 em-0000446 orders.setStatus k=ORD-1236…D-1236-0034-F2:processing fulfilmentId=ORD-1236-0034-F2 status=processing -> ok @15:09
  03-06 15:08 em-0000447 orders.setStatus k=ORD-1236…D-1236-0034-F3:processing fulfilmentId=ORD-1236-0034-F3 status=processing -> ok @15:09
  03-06 15:08 em-0000448 orders.setStatus k=ORD-1236…D-1236-0034-F4:processing fulfilmentId=ORD-1236-0034-F4 status=processing -> ok @15:09
  03-06 15:08 em-0000449 inventory.reserve [SKU-1026 k=ORD-1236…1236-0034-F1:SKU-1026] fulfilmentId=ORD-1236-0034-F1 location=WH-AMS -> ok @15:09
  03-06 15:08 em-0000450 inventory.reserve [SKU-1010 k=ORD-1236…1236-0034-F2:SKU-1010] fulfilmentId=ORD-1236-0034-F2 location=WH-RTM -> ok @15:09
  03-06 15:08 em-0000451 inventory.reserve [SKU-1020 k=ORD-1236…1236-0034-F3:SKU-1020] fulfilmentId=ORD-1236-0034-F3 location=WH-EIN -> ok @15:09
  03-06 15:08 em-0000452 inventory.reserve [SKU-1029 k=ORD-1236…1236-0034-F4:SKU-1029] fulfilmentId=ORD-1236-0034-F4 location=WH-UTR -> ok @15:09
* 03-06 15:09 em-0000453 billing.charge k=ORD-1236…34:chg:ORD-1236-0034-F1:- fulfilmentId=ORD-1236-0034-F1 customerId=C-0006 amountMinor=32893 currency=EUR -> error 402 card-declined @15:10
  (+16 more rows)
```

### Q-064 (deadline): On a counted processing cancel, compensate open fulfilments, set them and the order cancelled, and send order-cancelled within 60 min of the cancel.

> Within **60 min** of the cancel, compensate every fulfilment that is not `completed`, `failed` or `cancelled` (R5.1) and set it `cancelled`; set the order `cancelled`; send `order-cancelled`.

World 1235, ORD-1235-0010 at 2026-03-05T14:39:00+01:00: not done by deadline: order cancelled, order-cancelled sent

```
  03-05 14:39 ev-ORD-1235-0010-act-1 customer.action orderRef=ORD-1235-0010 action=cancel from=c0038@hollin-shop.examp…
  03-05 14:39 em-0000168 notify.send k=ORD-1235-0010:n:-:cancel-refused to=c0038@hollin-shop.examp… about=ORD-1235-0010 template=cancel-refused text=Your order can no longe… -> ok @14:40
```

World 1236, ORD-1236-0020 at 2026-03-04T18:13:00+01:00: not done by deadline: order cancelled, order-cancelled sent

```
  03-04 18:04 h-0000395 timer.fired obligationId=ORD-1236-0020:cust kind=deadline anchor=2026-03-04T14:03:00+01:… onDue=customerDeadline
  03-04 18:04 em-0000224 orders.setStatus k=ORD-1236…RD-1236-0020-F1:cancelled fulfilmentId=ORD-1236-0020-F1 status=cancelled -> ok @18:05
  03-04 18:04 em-0000225 orders.setStatus k=ORD-1236…RD-1236-0020-F2:cancelled fulfilmentId=ORD-1236-0020-F2 status=cancelled -> ok @18:05
  03-04 18:04 em-0000226 orders.setStatus k=ORD-1236-0020:os:-:timedOut fulfilmentId=null status=timedOut -> ok @18:05
  03-04 18:04 em-0000227 notify.send k=ORD-1236-0020:n:-:order-timed-out to=c0036@hollin-shop.examp… about=ORD-1236-0020 template=order-timed-out text=Your order timed out an… -> ok @18:05
  03-04 18:13 ev-ORD-1236-0020-act-1 customer.action orderRef= ord-1236-0020 action=cancel from=c0036@hollin-shop.examp…
```

World 1236, ORD-1236-0017 at 2026-03-04T23:32:00+01:00: not done by deadline: order cancelled, order-cancelled sent

```
  03-04 23:29 h-0000328 carrier.status carrier=VELOX code=IT shipmentId=SHP000020 fulfilmentRef=ORD-1236-0017-F1
  03-04 23:32 ev-ORD-1236-0017-act-1 customer.action orderRef=ORD-1236-0017 action=cancel from=c0010@hollin-shop.examp…
  03-04 23:32 em-0000264 notify.send k=ORD-1236-0017:n:-:cancel-refused to=c0010@hollin-shop.examp… about=ORD-1236-0017 template=cancel-refused text=Your order can no longe… -> ok @23:33
```

### Q-072 (never): Never set the same status of an order or fulfilment more than once.

> Set each status of an order or fulfilment at most once.

World 1235, ORD-1235-0001 at 2026-03-02T00:02:00+01:00: status processing set again on ORD-1235-0001 (first by em-0000004)

```
  03-02 00:00 mig-00001 migration
  03-02 00:00 em-0000001 inventory.allocate -> ok @00:01
  03-02 00:00 em-0000002 fraud.check -> ok @00:01
  03-02 00:01 em-0000003 orders.create k=ORD-1235-0001:create:-:- [SKU-1030, SKU-1018] customerId=C-0002 placedAt=2026-03-01T23:29:00+01:… currency=EUR totalMinor=59241 -> ok @00:02
  03-02 00:02 em-0000004 orders.setStatus k=ORD-1235-0001:os:-:processing fulfilmentId=null status=processing -> ok @00:03
* 03-02 00:02 em-0000005 orders.setStatus k=ORD-1235…D-1235-0001-F1:processing fulfilmentId=ORD-1235-0001-F1 status=processing -> ok @00:03
  03-02 00:02 em-0000006 orders.setStatus k=ORD-1235…D-1235-0001-F2:processing fulfilmentId=ORD-1235-0001-F2 status=processing -> ok @00:03
  03-02 00:02 em-0000007 inventory.reserve [SKU-1018 k=ORD-1235…1235-0001-F1:SKU-1018] fulfilmentId=ORD-1235-0001-F1 location=WH-RTM -> ok @00:03
  03-02 00:02 em-0000008 inventory.reserve [SKU-1030 k=ORD-1235…1235-0001-F2:SKU-1030] fulfilmentId=ORD-1235-0001-F2 location=WH-EIN -> ok @00:03
  03-02 00:03 em-0000009 billing.charge k=ORD-1235…01:chg:ORD-1235-0001-F1:- fulfilmentId=ORD-1235-0001-F1 customerId=C-0002 amountMinor=1494 currency=EUR -> ok @00:04
  03-02 00:03 em-0000010 billing.charge k=ORD-1235…01:chg:ORD-1235-0001-F2:- fulfilmentId=ORD-1235-0001-F2 customerId=C-0002 amountMinor=57747 currency=EUR -> ok @00:04
  03-02 00:04 em-0000011 carrier.create k=ORD-1235…01:shp:ORD-1235-0001-F1:- fulfilmentId=ORD-1235-0001-F1 location=WH-RTM ref=ORD-1235-0001-F1 -> ok @00:05
  03-02 00:04 em-0000012 carrier.create k=ORD-1235…01:shp:ORD-1235-0001-F2:- fulfilmentId=ORD-1235-0001-F2 location=WH-EIN ref=ORD-1235-0001-F2 -> ok @00:05
```

World 1235, ORD-1235-0001 at 2026-03-02T00:02:00+01:00: status processing set again on ORD-1235-0001 (first by em-0000004)

```
  03-02 00:00 mig-00001 migration
  03-02 00:00 em-0000001 inventory.allocate -> ok @00:01
  03-02 00:00 em-0000002 fraud.check -> ok @00:01
  03-02 00:01 em-0000003 orders.create k=ORD-1235-0001:create:-:- [SKU-1030, SKU-1018] customerId=C-0002 placedAt=2026-03-01T23:29:00+01:… currency=EUR totalMinor=59241 -> ok @00:02
  03-02 00:02 em-0000004 orders.setStatus k=ORD-1235-0001:os:-:processing fulfilmentId=null status=processing -> ok @00:03
  03-02 00:02 em-0000005 orders.setStatus k=ORD-1235…D-1235-0001-F1:processing fulfilmentId=ORD-1235-0001-F1 status=processing -> ok @00:03
* 03-02 00:02 em-0000006 orders.setStatus k=ORD-1235…D-1235-0001-F2:processing fulfilmentId=ORD-1235-0001-F2 status=processing -> ok @00:03
  03-02 00:02 em-0000007 inventory.reserve [SKU-1018 k=ORD-1235…1235-0001-F1:SKU-1018] fulfilmentId=ORD-1235-0001-F1 location=WH-RTM -> ok @00:03
  03-02 00:02 em-0000008 inventory.reserve [SKU-1030 k=ORD-1235…1235-0001-F2:SKU-1030] fulfilmentId=ORD-1235-0001-F2 location=WH-EIN -> ok @00:03
  03-02 00:03 em-0000009 billing.charge k=ORD-1235…01:chg:ORD-1235-0001-F1:- fulfilmentId=ORD-1235-0001-F1 customerId=C-0002 amountMinor=1494 currency=EUR -> ok @00:04
  03-02 00:03 em-0000010 billing.charge k=ORD-1235…01:chg:ORD-1235-0001-F2:- fulfilmentId=ORD-1235-0001-F2 customerId=C-0002 amountMinor=57747 currency=EUR -> ok @00:04
  03-02 00:04 em-0000011 carrier.create k=ORD-1235…01:shp:ORD-1235-0001-F1:- fulfilmentId=ORD-1235-0001-F1 location=WH-RTM ref=ORD-1235-0001-F1 -> ok @00:05
  03-02 00:04 em-0000012 carrier.create k=ORD-1235…01:shp:ORD-1235-0001-F2:- fulfilmentId=ORD-1235-0001-F2 location=WH-EIN ref=ORD-1235-0001-F2 -> ok @00:05
```

World 1235, ORD-1235-0004 at 2026-03-02T01:27:00+01:00: status processing set again on ORD-1235-0004 (first by em-0000016)

```
  03-02 01:25 ev-ORD-1235-0004 order.placed orderId=ORD-1235-0004 customerId=C-0001 placedAt=2026-03-02T01:25:00+01:… currency=EUR
  03-02 01:25 em-0000013 inventory.allocate -> ok @01:26
  03-02 01:25 em-0000014 fraud.check -> ok @01:26
  03-02 01:26 em-0000015 orders.create k=ORD-1235-0004:create:-:- [SKU-1006] customerId=C-0001 placedAt=2026-03-02T01:25:00+01:… currency=EUR totalMinor=8194 -> ok @01:27
  03-02 01:27 em-0000016 orders.setStatus k=ORD-1235-0004:os:-:processing fulfilmentId=null status=processing -> ok @01:28
* 03-02 01:27 em-0000017 orders.setStatus k=ORD-1235…D-1235-0004-F1:processing fulfilmentId=ORD-1235-0004-F1 status=processing -> ok @01:28
  03-02 01:27 em-0000018 inventory.reserve [SKU-1006 k=ORD-1235…1235-0004-F1:SKU-1006] fulfilmentId=ORD-1235-0004-F1 location=WH-RTM -> ok @01:28
  03-02 01:28 em-0000019 billing.charge k=ORD-1235…04:chg:ORD-1235-0004-F1:- fulfilmentId=ORD-1235-0004-F1 customerId=C-0001 amountMinor=8194 currency=EUR -> ok @01:29
  03-02 01:29 em-0000020 carrier.create k=ORD-1235…04:shp:ORD-1235-0004-F1:- fulfilmentId=ORD-1235-0004-F1 location=WH-RTM ref=ORD-1235-0004-F1 -> ok @01:30
```

