# E-bed host (G20)

*E-BED §8.1 step 2, 2026-10-14. Implements the host half of [BED-CONTRACT-v1.1](../../../research/enterprise-20261014/BED-CONTRACT-v1.1.md)
(§3 tick contract and host loop, §4 host semantics and profiles, §12 journal) for the E-bed of
[E-BED.md](../../../research/enterprise-20261014/E-BED.md) §2.1–§2.2, §2.7, §9.2, §9.7. $0: no model calls. Node 24 ESM, no new
dependency, nothing under `src/`, `policy/`, `schemas/`, `bin/` or `skills/` changed (`beds/` is outside the kit hash).*

**Status.** Host and its property, mechanics and replay suites: **44 tests, 44 pass** (§8). No E-bed item exists yet, so
the suites run on d1 toy worlds (`test/toy.mjs`) over the provisional E1 and E8 systems. The oracle (steps 3 and 5), the
`stream.mjs` wiring (step 7), the rendered tier-0 form (step 8) and Track C scaffolding (step 9) are not here.

```sh
node --test --test-concurrency=2 'beds/ebed/host/test/*.test.mjs'
```

---

## 1. What the host does

One host runs **one arm over one world** and journals everything.

| piece | file | what it does |
|---|---|---|
| clock and agenda | `time.mjs` | next-event simulated clock: jumps to the earliest arrival, world write, timer, task event, effect result, platform retry or sweep time; idle time is skipped; second resolution; ISO times with offset at the interface |
| host loop | `host.mjs` | go-live backlog at t0 (one instance per backlog case, first tick gets a `migration` with the neutral export); per-instance case-ticks (`tick/1`); host-scheduled sweep ticks; three rounds per instant (§2) |
| mock systems | `mocks.mjs`, `systems/*.mjs` | typed systems of record: argument schemas, keyed idempotency, `status(key)`, referential integrity, hidden tables, product-computed fields, batch ops, F5 renames |
| effect ledgers | `host.mjs` | one ledger row per application attempt; provisional (open wake-up) and committed (durable) ledgers; pending keys (§3) |
| obligation scheduler | `host.mjs` | arm-declared wake-ups, upsert/cancel, fired as `timer.fired` at `dueAt` (a past `dueAt` fires one minute later) |
| human-task router | `actors.mjs`, `form.mjs` | routes by (world, truth case of the subject, role, kind, ordinal) to scripted actors; noise model; form route with host re-validation (§4) |
| fault injector | `faults.mjs` | F1–F6 keyed by (world, case, system, op, ordinal); every injected row and result tagged `injected: true` with `faultTags` (§5) |
| platform profiles | `profiles.mjs` | `bare`, `temporal-like` (Temporal's default activity retry), `product` (§6) |
| journal, replay, resume | `journal.mjs`, `replay.mjs` | hash-chained, wake-up-atomic journal; byte-identical replay at $0; clock freeze across quota stops; crash repair (§7) |
| workspaces | `workspace.mjs` | persistent per-arm directory (≤ 50 MB), content-addressed snapshot after every call, restored on resume |
| output validation | `output.mjs`, `schema.mjs` | the contract's TickOutput / SweepOutput shapes; portable-subset validator for answer schemas and decisions |

### What the host never does (E-BED §0 item 4, §2.2; contract §4.2)

It never correlates an event to a case by business meaning, deduplicates inbound events, computes a deadline or business
time, enforces separation of duties beyond routing a task as the arm declared it, compensates, or fills a default for a
renamed field. The property suite tests each of these (§8). **World truth** is used only to key the fault schedule and
the actor policies (identical for every arm) and to label the journal for the analyst (`binding`, `subjectCase`); none
of it reaches an arm (the leak test checks inputs, files, query results and status reads).

---

## 2. Interfaces

**Item binding** (`createHost({ item })`): `{ id, family: { profile, subject: { object, key }, sweeps: [{ id }] }, systems:
[defineSystem(...)], schemas: { decisions?, humanTasks: { <kind>: description } }, actors: { answer(world, ctx),
counterparty(world, ctx) }, specE, product? }`. `schemas.effects` and `schemas.sor` are derived from the systems
(`effectSchemas`, `sorSchemas`).

**World** (contract §2) plus host extensions (decision H-13): `publicId` (what the arm sees as `world`), `sor` (initial
records per `system.table`), `writes` (timed world writes, e.g. goods receipts), `noise` (actor noise shares),
`truth.objectCase` (object key → case, for objects other than the root subject). Arrivals must be on the `inbound` or
`world` channel and not before `t0`. Malformed worlds are refused before any run.

**Arm** (`{ id, tick(input, ctx), sweep?(input, ctx), workspace?: { dir } }`). `input` is the contract's CaseTickInput or
SweepTickInput. `ctx` gives `files` (`spec/SPEC-E.md`, `master/`, `calendar/`, `rulebook/<edition>/…` for published
editions only, `api/<system>.schema.json` with any active F5 rename, `sor/<instance>.json`, `docs/<eventId>.txt`),
`query('system.table', { where, limit })`, `status(system, key)`, `instances({ subject })` (H-1), `workspace` and
`recordCost(row)` (rows from the model journal; never solver reports). Every read is as of the round start.

**Rounds at one instant** (contract §3.6): phase 0 host work (world writes, platform retries, form rejections); deliveries
in (at, source, id) order; round 1 case-ticks in order of first delivery (an inbound event starts a new instance unless it
quotes, verbatim, a `ref` an open instance placed in an outbound message); round 2 sweep ticks in sweep-id order; round 3
merge targets and sweep wakes (`sweep.wake`, H-2), each at most once, which can neither merge nor wake. Calls in a round
may run concurrently; outputs are applied in round order, so the journal does not depend on concurrency.

**Run, replay, resume** (`replay.mjs`): `runWorld(opts)`, `replayRun({ item, world, journal })`, `resumeRun({ …,
journalFile, blobDir })`. Options: `profile`, `journalFile`/`blobDir` (JSONL journal and workspace blobs on disk),
`concurrency`, `callTimeoutMs`, `envRetries` (2), `envRetryDelayMs`, `maxWakeups`, `productConfig`, `workspaceDir`,
`workspaceMaxBytes`.

---

## 3. Effects and the ledgers

- Effects of an output are applied in output order through the typed mocks. A keyed op whose key is committed returns
  the original result and is not applied again (no ledger row; `effect.deduped` in the journal, H-6); the same key with
  other arguments is `409 key-conflict`, not applied; an un-keyed op is applied every time.
- `after: key` defers an effect until the named effect of the same output has committed; a failed predecessor gives
  `predecessor-failed` without an application. Under `temporal-like` a dependant waits while the platform retries its
  predecessor and is applied at the instant the predecessor commits.
- Results arrive as `effect.result` on the instance channel at `at + latency` (≥ 1 minute per system); a sweep's results
  go to that sweep's next tick.
- **Batch ops** (`bank.payRun`, `inventory.reserve`): each item carries its own key and gets its own ledger row; faults
  are keyed per item; the result is `partial` with per-item statuses; `itemContext` declares which batch-level arguments
  belong to an item's identity, so an item resubmitted in a new run dedupes (H-8).
- **Ledger row**: `{ world, arm, instance | sweep, at, system, op, emission, attempt, key, argsDigest, subjectCase,
  ordinal, committed, status, error?, faultTags, injected?, via: arm | arm-deferred | platform-retry, money?, batchIndex? }`.
- **Provisional and committed ledgers** (H-15): rows of the open wake-up are provisional and become committed when the
  wake-up commits; a quota stop discards them with the wake-up. `status(key)` is `committed`, `pending` (deferred by
  `after` or being retried by the platform) or `not-found`.

### Mock systems (provisional v1 bindings; spec-E, step 4, pins names and enums)

| item | systems | notes |
|---|---|---|
| E1 | `erp` (vendors, POs, invoices, match records, holds, approvals, postings, payment blocks), `wms` (goods receipts, service entry sheets; world-written), `bank` (`pay`, `payRun`) | match record fields are product-computed |
| E7 | `itsm` (incidents, problems, changes with integer states −5…4, approvals, SLA records), `cmdb` | SLA elapsed, business-elapsed and breach are product-computed; the host never computes them |
| E8 | `orders`, `inventory` (stock, batch `reserve`, `release`), `billing` (`charge`, `refund`; money), `carrier` (`create`, `cancel`; status arrives as counterparty signals), `fraud` (hidden verdict table; `check` returns the verdict only) | status vocabularies provisional [I] until spec-E reads `app/order/api.go:75–197` |
| shared | `mail`, `notify` | keyed sends; `ref` echoed by replies |

Mocks enforce referential integrity only: posting a held invoice or paying without a key is the arm's mistake to make
and the oracle's to grade. CRM, registry, screening, filing, core banking, cards, network-X and claims systems come with
E4, E5, E6 and E9.

---

## 4. Human tasks, actors and the noise model

- A task is routed by (world, truth case of its `subject`, role, kind, ordinal); the question text and the arm's task id
  never matter (two arms asking in different words get identical answers; tested). The answering user is the first role
  holder not in `excludeUsers`. An unknown kind, a subject that names no object, or no eligible user: no answer, the
  task times out at the arm's `dueAt`.
- Answers are typed world data from the item's `actors.answer`; the host validates each against the arm's
  `answerSchema`: accepted → `humanTask.answered`; rejected → `humanTask.answerRejected` with the value withheld.
- **Noise** (shares in `world.noise`, one seeded draw per routing key, identical across arms): `none`, `late` (timeout,
  then `answered` with `late: true`), `delegate` (`humanTask.delegated`, the next eligible holder answers), `withdraw`
  (`humanTask.withdrawn`, no timeout, H-12), `freeText` (`{ text }` where the actor offers it), `wrong` (the actor's
  declared wrong answer, only where the item offers one); independently `form` and `formInvalid`.
- **Form route** (OPENUI.md §5.4): the answer is entered as OpenUI-shaped `formState` (`{ value, componentType }` per
  field path), mapped back by a strict adapter and re-validated. A planted `"12abc"` passes OpenUI's `parseFloat`
  numeric rule and is rejected by the host (`form.rejected`, journaled); the actor re-enters the value one minute later
  (H-11). `toFormState` is a stand-in for the tier-0 form of step 8; the adapter `fromFormState` stays.

## 5. Faults

| id | host behaviour | result |
|---|---|---|
| F1 | not applied | `rate-limited`, `retryAfter` (default 60 s) |
| F2 | not applied | `error` 503, retryable |
| F3 | applied if it can commit | `unknown`; `status(key)` shows the truth (H-7) |
| F4 | batch item not applied | batch `partial` |
| F5 | from its time the mock accepts only the new field name; the API file shows it | `error` 400 `field-renamed`, naming the field |
| F6 | not applied | `error` permanent, not retryable |

`params.repeat` extends a fault over consecutive ordinals (an outage). Tags (`injected`, `faultTags`) are journal-only:
an arm never sees them (H-3). Real environment faults raised by an arm adapter (`EnvFault`) are retried (2 times), then
the case-tick is *impaired* (an arm error counted for K5); they are recorded in the call row, never tagged.

## 6. Platform profiles

`bare`: no retries. `temporal-like`: retryable outcomes (F1, F2, F3) are re-issued with the same arguments and key after
1 s × 2^(n−1), capped at 100 s, unlimited attempts; intermediate attempts are journaled (`platform.retry`, ledger rows
`via: platform-retry`), only the final outcome is delivered, with `attempts` (H-5). An F3 under this profile charges a
key-less arm twice and a keyed one once; F6 is never retried (tested). `product`: the item's product engine computes
product-computed fields after every round and `sor.query` returns them; under Track P profiles every arm-visible read
strips them.

## 7. Journal, replay, clock freeze, resume

- Rows `{ seq, prev, hash, type, … }`, `hash = sha256(prev + canonical(content))`. Main types: `run.start`, `world.write`,
  `instance.open`, `run.ready`, `wakeup`, `deliver`, `delivery.dropped`, `call` (input digest, output or error, costs,
  env faults, workspace snapshot), `arm.error`, `carry.lost`, `carry.commit`, `effect.emit`, `effect.deferred`,
  `effect.skipped`, `effect.deduped`, `ledger`, `read`, `effect.result`, `platform.retry`, `ref.placed`,
  `counterparty.event`, `counterparty.write`, `obligation.upsert`, `obligation.cancel`, `humanTask.created`,
  `humanTask.duplicate`, `form.rejected`, `instance.merge`, `instance.close`, `sweep.skipped`, `product.write`,
  `wakeup.commit`, `run.end` (the censoring record: open instances with their binding, open obligations and tasks,
  undelivered world events, pending keys, SoR and ledger digests). Control rows: `clock.freeze`, `run.resume`.
- **Wake-ups are atomic**: rows are staged and become durable at `wakeup.commit`. An arm adapter that throws `QuotaStop`
  freezes the clock: the open wake-up is discarded (its calls' costs go into `clock.freeze`) and the journal ends at the
  last commit. `resumeRun` replays the committed prefix (every row verified), restores the workspace to its last
  committed snapshot, writes `run.resume` and continues live from the interrupted wake-up; the resumed journal's content
  equals an uninterrupted run's (tested in this process and in a child process, with three stops in one run and with
  concurrency 3). A crash can tear the file: `repairJournal` cuts back to the last commit boundary (H-14).
- **Replay** (`replayRun`): every call is answered from the journal (input digests must match), every content row must
  come out byte-identical, and the SoR and ledger digests must equal the recorded `run.end`; otherwise the run is void.
  Tested to void: an edited output (re-chained), an edited row (chain broken), another world, a journal cut inside a
  wake-up, an impure item (hidden mutable state in a counterparty), a forged end digest. A prefix cut at a commit
  verifies (`prefix-verified`).

---

## 8. Tests and measurements ($0, `--test-concurrency=2`, about 40 s)

| suite | tests | covers |
|---|---|---|
| `test/props.test.mjs` (E-BED §9.2) | 23 | idempotency (mock and host level); determinism across runs, processes (child process), concurrency 1 vs 4 with scrambled completion order, and input array order (tie-breaks by (at, source, id)); clock laws (monotone, deliveries at their time, results ≥ 1 min, timers at their announced time, no idle wake-up, idle time skipped); no correlation, dedupe, deadline, rule enforcement or default; fault tags match the schedule and never reach the arm; faults and answers identical across arms with different keys and wording; profiles (backoff 1, 2, 4 … 64, 100, 100; double charge without keys; F6 not retried); arm errors apply nothing and keep carry and obligations (fuzz arm, 15 worlds); crash, oversize carry, invalid output, env faults; noise shares realised within ±0.015 over 20,000 draws; routing, exclusions, unknown kind/subject, withheld rejected answers; every noise class exercised; validator agrees with the engine's ajv `validateData` on 2,000 seeded schema/value pairs and with `portableSchemaViolations` on 1,000 schemas; G21 round trip on 1,000 seeded schemas, `"12abc"` rejected; leak; censoring record; bounds |
| `test/mechanics.test.mjs` (contract §3–§4) | 14 | merge into an existing instance in round 3; refused merges; one round-3 tick per woken instance; `ref` reply routing; obligations (replace, cancel, close drops, clamp); `after` under bare and temporal-like; batch F4 and resubmission; product profile; editions and F5 API files; documents as files; workspace limits; world and output validation; `status(key)` pending → committed; E7 systems through the host |
| `test/replay.test.mjs` (E-BED §9.7) | 7 | replay of 27 runs (solver, fuzz, key-less, saga keyed and bare); cross-process replay; voided tampering; quota stops and resume (child process); crash repair; workspace restore; costs from the journal |

**Bounds (toy, reported):** 1,000 cases (50 backlog), 40 days: 5,551 case-ticks, 45 sweep ticks, 5,896 wake-ups in about
4.7 s, about 47 journal rows per case; test-process heap about 190 MB, peak RSS about 450 MB for the whole suite file.
Item-level bounds (render ≤ 20K tokens at d5; generate + oracle < 2 s per 10³ cases) wait for the items.

**Bugs the suites found in the host while it was written:** batch items' identity included the run id (a resubmission
looked like a key conflict; fixed with `itemContext`); stale timers and superseded tasks caused empty wake-ups (now
skipped); the withdraw and none noise classes did not record the applied class; a missing sweep solver was an arm error
(now `sweep.skipped`).

---

## 9. Decisions and deviations (for review)

| id | E-BED / contract | here | why |
|---|---|---|---|
| H-1 | the open-instance index is a sweep input only | case-ticks also get read-only `ctx.instances({ subject })`, matched on the arm's own declared subject | without it an arm cannot name a `merge` target (contract §3.2); it is the arm correlating, the host only lists what the arm declared |
| H-2 | event types listed in §3.2 | adds `sweep.wake` for round-3 ticks woken by a sweep | a woken instance otherwise gets an empty tick with no reason |
| H-3 | `Event = { …, injected?: true }` | `injected`/`faultTags` are kept in the journal only; arm-visible events never carry them | an arm that can tell synthetic faults from real ones could treat them differently; the K5 rule needs the tag, the arm does not |
| H-4 | "calls inside a round may run concurrently" | every read in a round sees the round-start state | otherwise the journal would depend on concurrency |
| H-5 | temporal-like retries F1/F2/F3 | intermediate attempts journaled, final outcome delivered; F1's Retry-After not used for the backoff (Temporal's policy ignores it); a batch is re-issued only when every item failed retryably, a partial result is delivered | Temporal semantics; contract silent on batches |
| H-6 | one ledger row per application | a deduplicated emission writes no ledger row (`effect.deduped`) unless a fault was injected on it | E-BED §9.2 "one key twice → one ledger entry" |
| H-7 | F3 = applied (committed) | F3 also hits requests that cannot commit (business error): `unknown`, nothing committed, `status(key)` → not-found | a timeout hides any outcome; the arm must query |
| H-8 | — | batch ops key and ledger per item, faults per item, `itemContext` for item identity; a top-level key on a batch op is refused | F4 "k of n" and "resubmit only failures with the same keys" need item-level keys |
| H-9 | obligation clamp for `dueAt ≤ now` | upserts before cancels in one output (a cancel wins); due times rounded up to the second; the same clamp for task `dueAt` | determinism; clock resolution is one second (contract §2) |
| H-10 | arm error on any failed sweep tick | an arm without a sweep solver gets `sweep.skipped`, not an arm error | not implementing sweeps is a design choice graded through consequences |
| H-11 | rejected answers → `answerRejected` | a form-level rejection (planted `"12abc"`) is host-internal (`form.rejected`), followed by the actor's re-entry; `answerRejected` is for answers that fail the arm's schema | the user sees the form error, not the workflow |
| H-12 | noise classes listed | withdrawn tasks get no later timeout; delegation goes to the next eligible holder (none → normal answer) | BPI 2017 `withdraw` ends the work item |
| H-13 | World fields of §2 | adds `publicId`, `sor`, `writes`, `noise`, `truth.objectCase`; arrivals not before t0; counterparty events are bound in the journal (`counterparty.event.case`) because `truth.eventCase` cannot list on-policy events | needed to run worlds; keeps truth out of events |
| H-14 | "streams resume from the journal" | wake-up-atomic journal; `clock.freeze` and `run.resume` control rows; crash repair to the last commit boundary | makes the clock freeze exact and resumable in another process |
| H-15 | "provisional and committed ledgers" (undefined) | provisional = rows of the open wake-up (plus pending keys); committed = rows durable at a commit | ties the two ledgers to the freeze; the oracle reads committed rows only |
| H-16 | contract validator `beds/wbed/lib/contracts.mjs` | a self-contained portable-subset validator (adds `minimum`, `maximum`, `minLength`, `const`, code-point lengths), differential-tested against `src/validate.mjs` and `src/schema-subset.mjs` | the W-bed validator lacks keywords answer schemas need; the host must not move with the engine |
| H-17 | read-only ops never enter the ledger | they are callable as `ctx.status` / `ctx.query` or emitted as effects (result event, `read` row) | both forms are useful; neither is graded |
| H-18 | workspace ≤ 50 MB | needs concurrency 1; symlinks and special files refused; oversize or forbidden → arm error and restore | one writer, no escape from the directory |
| H-19 | — | `run.start` carries the world digest, so a replay against any other world (even a permuted array) diverges at row 0 | a journal belongs to exactly one world |
| H-20 | env faults "retried as stream.mjs does" | 2 immediate retries (optional wall-clock delay), then impaired | stream.mjs's retry schedule is wall-clock only; the simulated clock never moves for it |
| H-21 | outputs are JSON | `undefined`-valued properties are dropped as JSON does; NaN, Infinity, functions and class instances are arm errors; top-level output keys are closed | compiled JS solvers emit `undefined` fields; nothing else is repaired |

## 10. Open questions

1. H-1, H-3 and H-7 change what an arm can see or must do; they need the owner's (or the contract author's) agreement
   before any item is frozen.
2. Fault ordinals count attempts per (case, system, op) across all instances of a case and include deduplicated
   re-emissions (a fault is transport-level). Is that the intended reading of "keyed by (world, case, system, op,
   ordinal)"?
3. Should a 429's Retry-After shorten or lengthen the `temporal-like` backoff? Temporal ignores it; the bar's text does not
   say.
4. The product engine runs after every round. Real products react to record changes; step 9 may need per-table hooks.
5. All E1/E7/E8 mock field names, enums and latencies are provisional until spec-E (step 4) is written blind to the
   oracle; the toy worlds and these suites will need small updates then.
6. Scale tier: the host keeps the whole world in memory and re-renders `sor/<instance>.json` per call; 10⁴–10⁵ cases per
   world (E-BED §2.6) need a measurement once an item exists.
7. Journal size: about 47 rows per case on the toy, with document text in `deliver` rows. A body store (as `stream.mjs`
   uses for large bodies) may be needed at d5.
