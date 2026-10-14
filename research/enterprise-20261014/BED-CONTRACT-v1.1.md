# Bed contract v1.1: the `world-stream` kind (E-bed amendment)

*Proposed amendment, 2026-10-14, branch `claude/intelligent-hamilton-vg1f9a`. E-BED §8.1 step 0. Gate: owner review
(E-BED §11 decision 6: adopt or amend). It amends [`beds/CONTRACT.md`](../../beds/CONTRACT.md) v1, which stays in force
unchanged for `oneshot` and `interactive` families. It turns E-BED §2.1–§2.4, §2.7–§2.8, §2.12, §6 and §9 into an
interface precise enough to implement the host (E-BED §8.1 step 2), the oracles (steps 3 and 5) and the stream wiring
(step 7) without re-deciding anything. Where E-BED was silent or inconsistent, the decision taken here is marked
**[D-n]** and listed in §14; nothing else departs from E-BED.*

*$0: no model calls, nothing installed. Nothing under `src/`, `policy/`, `schemas/`, `bin/` or `skills/` changes (the
engine freeze holds). `beds/sealed/` was not read. Delivered with this document: the seed-ledger entries
(`research/jit-20261008/SEED-LEDGER.json`, §10) and the statistics module `experiments/lib/stats-ebed.mjs` with its
tests (§13).*

*Revised 2026-10-14 after an adversarial review of step 0 (§16): pools from two reference timings (§6, D-4), decision
grading of close/merge-only ticks (§5.3, D-18), round snapshots (§3.6), a fail-closed family test and a Holm set that
does not depend on the data (§13.2), the power of the whole decision with a K recommendation conditional on the
per-world n (§13.5), seed confinement (§10.1). §16 lists what was fixed, deferred and rejected.*

**Tags** as in E-BED: [M] a repo file read (cited); [M-c] computed at $0 (script or test cited); [I] design choice.

---

## 0. What changes, in one screen

1. `family.kind` gains `'world-stream'` with `family.contract: '1.1'`. A world-stream bed generates a **world** (one
   fictional organisation over a business horizon), not a task; arms are run over it as a stream of **case-ticks** and
   **sweep ticks**; the oracle grades the journal of the run afterwards, case by case.
2. The unit of construction is **`tick/1` per instance** (§3). Cross-case reads go through read-only `sor.query`;
   cross-case work through host-scheduled **sweep ticks**. A world-level call is a diagnostic only (§9).
3. The **host** owns time, delivery, mocks, actors and faults under a declared **platform profile** (`bare`,
   `temporal-like`, `product`), identical for every arm of an item (§4). It never correlates by business meaning,
   deduplicates, computes deadlines, enforces separation of duties or compensates.
4. Grading is **on-policy and behavioural** (§5): at every case-tick the reference transition is applied to the arm's
   own history; observable output must lie in the allowed set (exact decisions, effects exactly once inside
   rulebook windows, human tasks with the right role, exclusions and window, business records at close). First
   divergence fails the case. Obligations, timers and carry are internal and never graded.
5. **Censoring** (§6): the completed/censored split comes from the arm-independent reference runs (one acting at each
   window's earliest, one at its latest), so every arm is paired on the same cases and a correct arm acting anywhere
   inside its windows is not failed for leaving a case open at horizon end **[D-4]**.
6. **Two tracks** (§7): Track P "engine port" and Track C "configure", same oracle, different inputs and claims.
7. **Teacher-forced (TF)** grading is a diagnostic on informative case-ticks only (§8).
8. **Seeds** (§10): per-item dev, rehearsal, held-out and sealed blocks in the seed ledger, with E-bed purposes that the
   default JIT purposes cannot use.
9. **Admission** (§11) replaces CONTRACT v1's per-task oracle-health rules with per-item K1 checks: goldens, specificity,
   controls, mutation, leak, twins, censoring, calibration, determinism, budgets.
10. **Statistics** (§13): `experiments/lib/stats-ebed.mjs`. The power of **test (i) alone** is **0.61 at K = 2 and
    0.86 at K = 4**, not E-BED's 0.60 / 0.85 (a biased generator; §13.4). The power of the **whole decision**
    (i)∧(ii)∧(iii) is governed by (ii) and by the completed tail-mix cases per world: below 46 per world any failure
    fails a world, and at 40 per world K = 4 makes (ii) nearly impossible (§13.5). K = 4 is recommended only with
    ≥ 100 such cases per world per item and a measured between-world correlation.

---

## 1. Scope, layout, vocabulary

**Layout** (E-BED §2.4, unchanged): `beds/ebed/<item>/` per item; shims `beds/ebed-<item>/index.mjs` that re-export it
(as `beds/wbed-r4/index.mjs` [M]); host `beds/ebed/host/`; oracle-side libraries `beds/ebed/lib/` (calendar,
decision-table evaluator, obligation clock, saga planner, ledger checks), written independently of the library cards
`experiments/library/cards/P58|P59|P60` and sharing no code with them. Bed ids are `ebed-e1` … `ebed-e13`; `<item>` is
`e1` … `e13`.

**Vocabulary** (every later section uses these words in exactly this sense):

| term | meaning |
|---|---|
| world | the output of `generateWorld`: one organisation, its calendars, parties, rulebook editions, go-live backlog, arrival process, actor pools, fault schedule and analyst-only truth. Pure JSON; its digest is the sha256 of its canonical JSON (`beds/lib/canonical.mjs`) |
| case | one business object with its sub-objects (an invoice, order, dispute, claim, incident, application), as the item's spec-E defines it. **Truth cases** are the world's; they are what grading and pairing use |
| subject | the business key that identifies a truth case's root object (E1: invoice id; E5: dispute's transaction ARN + claim date; …), declared in spec-E with the op arguments that name it (§5.1) |
| instance | one arm-side run of the per-instance solver, identified by an opaque host id `i-<6 digits>`. Instances and truth cases need not be one-to-one; grading never relies on them being so |
| wake-up | the set of deliveries the host makes at one simulated instant |
| case-tick | one call of the arm's solver for one instance at one wake-up |
| sweep tick | one call of the arm's sweep solver at a sweep time declared in spec-E |
| event | an inbound fact delivered to the arm (§3.2) |
| effect | an outbound operation on a system of record or counterparty (§3.3) |
| logical effect | what the rulebook requires or permits, identified by a deterministic id (`lid`) (§5.2) |
| obligation | an arm-declared wake-up (`dueAt`); internal, never graded |
| carry | the arm's per-instance JSON state, ≤ 64 KB (DESIGN-STREAMS §2.3 [M]) |
| business record / product-computed field | the two parts of the system of record (SoR) (E-BED §2.2) |
| trajectory | the arm's journal over one world: deliveries, outputs, applied effects, ledger |
| reference run | the trajectory the oracle's own policy produces on the world (§5.6); arm-independent |
| epoch | a fraction of the horizon in business time, `ep0` … `ep4` (E-BED's E0 … E4, renamed to avoid clashing with item ids), plus `gl` for go-live backlog cases |

---

## 2. Module interface (`beds/ebed/<item>/index.mjs`)

```js
export const family = {
  id: 'ebed-e1', item: 'E1', kind: 'world-stream', contract: '1.1', version: '1.0.0', domain, description,
  tracks: ['P'] | ['P', 'C'],          // 'C' only when track-c/ exists (E1, E7 first)
  profile: 'bare' | 'temporal-like',   // §4; the Track C runs use 'product'
  clock: { resolution: 'second', horizon: { length: 130, unit: 'business-day' | 'calendar-day' | 'hour' } },
  epochs: [{ id: 'ep0', share: 0.25 }, { id: 'ep1', share: 0.15 }, { id: 'ep2', share: 0.20 }, { id: 'ep3', share: 0.25 }, { id: 'ep4', share: 0.15 }],
  sweeps: [{ id: 'unblock', cadence: 'daily 06:00 business days' }],   // prose cadence; times are generated (§3.6)
  difficulty: { min: 1, max: 5, default: 2 },
  subject: { object: 'invoice', key: 'invoiceId' },
};
export const specE;          // { file: 'spec/SPEC-E.md', sha256 } — the only spec every arm gets (E-BED §2.5)
export const schemas;        // portable-subset JSON schemas (CONTRACT v1): { decisions, events: {type: schema},
                             //   effects: {'system.op': { args, keyed, subjectArgs, reverses?, readOnly? }},
                             //   sor: {table: schema}, humanTasks: {kind: answerSchema}, config? (Track C) }
export function generateWorld({ seed, split, difficulty, schedule = 'default', mix = 'tail', scale = 'base', track = 'P' }) -> World;
export function twins(world) -> [{ id, world }];          // label-preserving variants (W5; DESIGN-STREAMS §4.3)
export const actors;         // { answer(world, ctx) -> Answer | null, counterparty(world, ctx) -> Event[] } (§4.4)
export function referenceTransition(world, view) -> Expectation;   // §5.2; the oracle core
export function referencePolicy(world, view) -> TickOutput;        // §5.6; derived from referenceTransition
export function oracle(world, journal, { mode: 'cl' | 'tf' }) -> StreamVerdict;   // §5, §8
export const goldens, controls, necessityControls, gamingControls, mutants;      // §11
export const semantics;      // { file: 'ledger/SEMANTICS.md', in: n, out: n } (E-BED §2.11)
```

- **Purity.** `generateWorld`, `twins`, `actors.*`, `referenceTransition`, `referencePolicy` and `oracle` are pure
  functions of their arguments; randomness only from `beds/lib/rng.mjs` with the salts of §10.2; no wall clock.
- **Who imports what.** The host imports `generateWorld`, `actors`, `schemas` and `specE` (the fault schedule is part of
  the world). Only the analyst-side scorer imports `referenceTransition`, `referencePolicy` and `oracle`. Arms import
  nothing (they get files, §3.1). The oracle runs **offline over the journal** after (or during, for monitoring) the
  run; the host never calls it, so world dynamics cannot depend on the oracle.
- **Difficulty and schedule.** `difficulty` sets the highest feature level present (E-BED §2.6 d1–d5); `schedule`
  places the drift events in the epochs (default: E-BED §2.1 — ep1 parties, ep2 rules and formats, ep3 schema, volume
  and faults, ep4 revert). `mix` is `natural` or `tail` (tail classes ≥ 50%). `scale` is `base` or `scale` (§11).

**World** (host-side, never shown to an arm; the fields an implementer must produce):

```text
World = { id, item, seed, split, difficulty, schedule, mix, scale, track,
  t0, horizonEnd,                                   // ISO 8601 with offset; horizonEnd = t0 + horizon in business time
  epochBounds: [iso, ...],                          // absolute times; a case's epoch is the one containing its start
  calendars: { [id]: { tz, businessHours, holidays: [{ date, from?, to? }] } },
  rulebook: { editions: [{ id, effectiveFrom, effectiveTo, files: { path: text } , published: iso | null }] },
  master: { [table]: rows }, parties, actorsPool: { [role]: [userId] },
  backlog: [{ case, subject, export: { records, events } }],    // neutral export at t0 (§3.5)
  arrivals: [Event],                                // exogenous inbound events in (at, source, id) order
  sweepTimes: { [sweepId]: [iso, ...] },            // generated from spec-E cadences and the world calendar
  faults: [{ at, system, op, ordinal, case, kind: 'F1'..'F6', params }],
  truth: { cases: { [case]: { subject, start, epoch, class, tail: bool } }, eventCase: { [eventId]: case } } }   // every inbound event has a case (§5.1)
```

`truth` and the fault schedule never leave the host; the leak test (§11) asserts no truth-only string reaches inputs,
files or mock responses.

---

## 3. The `tick/1` contract and the host loop

### 3.1 Inputs and outputs

Every call gets its input as `task.json` plus read-only files in a fresh per-call workdir, and returns one JSON output
(the stream.mjs convention [M]).

```text
CaseTickInput = { kind: 'case', item, world: <world public id>, instance: 'i-000123', now,
                  events: [Event], carry: <the instance's last committed carry, or null> }
SweepTickInput = { kind: 'sweep', item, world, sweep: <sweep id>, now,
                   index: [{ instance, subject: <arm-declared or null>, openedAt, lastTickAt }],
                   events: [Event],                       // world-level events (list updates, statements, …)
                   carry: <the sweep's last committed carry, or null> }
files: sor/<instance>.json (the business records the instance has declared or touched; §3.4),
       master/<table>.json, rulebook/<edition>/<table>.csv|json (only editions whose file exists in the world at now),
       calendar/<id>.json, docs/<eventId>.txt, api/<system>.schema.json, spec/SPEC-E.md
query: sor.query(table, { where: { field: value | { gte, lte, in } }, limit <= 1000 })
       read-only, deterministic order by primary key, business records only (Track C adds product-computed fields)

TickOutput = {
  decisions:   { subject: <business key or null>, ...item-typed record },     // required on every case-tick
  effects:     [{ key?, system, op, args, compensates?: key, after?: key }],  // applied in order (§3.3)
  obligations: { upsert: [{ id, kind, anchor, dueAt, calendar?, onDue }], cancel: [id] },
  humanTasks:  [{ id, kind, role, excludeUsers?: [userId], subject, question, answerSchema, dueAt, onTimeout }],
  merge?:      { into: <instance> },                  // only on an instance started by an inbound event (§3.2)
  close?:      true,                                  // the instance is done; later deliveries start nothing
  carry }
SweepOutput = { effects: [... each with a subject argument ...], wake: [instance], carry }
```

- **Validation.** The host validates every output against the item's schemas with the W-bed contract validator
  (`beds/wbed/lib/contracts.mjs`, which uses `beds/records/score.mjs` `validate` [M]). An invalid output, a carry above
  64 KB or not JSON, a crash or a timeout is an **arm error** (§3.7).
- **Size.** A case-tick renders to 2–20K tokens inline; master data, tables and documents are files; every prompt stays
  under the 100K-token price step of `policy/models.json` or is priced at the higher rate and logged (E-BED §2.1).
- **Workspace.** An arm that declares one (agent-H-ws) gets a persistent per-arm directory ≤ 50 MB, journaled as
  content-addressed snapshots after every call; not graded.

### 3.2 Events and routing **[D-1]**

```text
Event = { id, type, at, source, channel: { kind: 'instance', instance } | { kind: 'inbound' } | { kind: 'world' },
          payload, injected?: true }
types: migration | doc.received | message.received | effect.result | timer.fired |
       humanTask.answered | humanTask.answerRejected | humanTask.timeout | humanTask.withdrawn | humanTask.delegated |
       edition.published (default variants only) | world.* (sweep-level: list update, statement run, …)
```

The host routes by **channel identity only**, never by business meaning (E-BED §2.2):
- `instance` channel: results of that instance's effects, its timers, answers to its human tasks, and replies that
  quote verbatim a reference the arm itself placed in an outbound message (`args.ref`). Delivered to that instance.
- `inbound` channel: every other inbound document or message (a new invoice, an acquirer response carrying only an
  ARN, a monitoring alert). Each one **starts a new instance** (a message start event) whose first case-tick sees it.
  If the arm decides it belongs to an existing case, it returns `merge: { into }`; the host closes the new instance
  and re-delivers the event to the target in the same wake-up (§3.6 round 3). Correlation (G1) is therefore the arm's
  work at tier S and is graded through consequences (§5): a mis-routed event leaves its true case's required effects
  missing and puts unexpected effects on the wrong one.
- `world` channel: world-level events go to the next sweep tick of the sweep that spec-E names for them.
- Duplicates (W1), out-of-order (W2) and late events (W3) are delivered as the world generates them; the host never
  filters them.

Events carry raw business keys as the counterparty wrote them (possibly mistyped). Edition files: default variants
deliver `edition.published` with the file; sealed no-notice variants make the file appear in `rulebook/` at its
publication time with no event, or not at all (E-BED §2.5).

### 3.3 Effects, keys and the ledger

- The host applies a tick's effects **in output order** through typed mocks, appending one ledger row per application:
  `{ world, arm, instance, at, system, op, key, argsDigest, subjectCase, committed, faultTags }`.
- `schemas.effects[op].keyed` marks ops that take an idempotency key. A keyed op whose key is already committed on that
  system returns the original result and is **not applied again**; the same key with different arguments is rejected
  (`409 key-conflict`, not applied). An un-keyed op is applied every time it is emitted.
- `status(key)` exists on every keyed system, is read-only and always allowed: `committed | not-found | pending`.
- `after: key` defers an effect until the named effect of the same output has committed; if that one fails, the
  deferred effect is not applied and its result is `error` (`predecessor-failed`). `compensates: key` records intent
  (journaled; the oracle grades compensation by the effects that happen, not by this field).
- Results come back as `effect.result` events `{ key, system, op, status: ok | error | unknown | rate-limited |
  partial, retryAfter?, items?, error? }` on the instance channel at `at + latency`, latency ≥ 1 minute as declared per
  system in spec-E, so no result lands in the instant that produced it.
- Read-only ops (`status`, `*.get`, `sor.query`) never enter the effect ledger and are never graded.

### 3.4 State: SoR, carry, obligations

- **Business records** are written only by effects on systems of record. `sor/<instance>.json` holds the records the
  instance's effects created or touched plus those named by its subject; everything else is reachable by `sor.query`.
- **Product-computed fields** (declared `computedBy: 'product'` in `schemas.sor`): in Track P the arm computes and
  writes them through effects, and they are never copied from the reference into any input; in Track C the host's
  product engine computes them (§7).
- **Carry** is opaque to the host, committed with a compare-and-swap on the instance's tick index (one writer per
  instance). If a case-tick delivers no valid output, the previous carry is kept and a `carry-lost` row is journaled
  (DESIGN-STREAMS §2.3 [M]).
- **Obligations** are wake-ups only. The host fires each at `dueAt` as `timer.fired { obligationId, onDue }` on the
  instance channel. `dueAt <= now` is fired at `now + 1 minute` and logged. The host never computes `dueAt`.

### 3.5 Go-live backlog and migration

At `t0` every backlog case gets an instance whose first case-tick receives one `migration` event carrying the case's
**neutral export**: business records and raw events in the item's lookback window, never a field that exists only
because one design persisted it (DESIGN-STREAMS §2.4 [M]). The export is the same for every arm. Backlog cases are
epoch `gl`; their pre-t0 history is not graded, their post-t0 behaviour is.

### 3.6 The host loop (event-driven time)

```text
t := t0
loop
  t := earliest of { next arrival, next due obligation, next sweep time, next scheduled delivery
                     (effect results, actor answers, counterparty events, fault releases) }   // idle time is skipped
  if t > horizonEnd: stop
  wake-up at t, deliveries ordered by (at, source, id):
    round 1  case-ticks for every instance with deliveries at t, in order of their first delivery
             (instances started by inbound events at t included)
    round 2  sweep ticks due at t, in sweep-id order
    round 3  case-ticks for merge targets (round 1) and sweep wakes (round 2), each at most once
  within a round: every input, file and read (sor.query, status, the sweep index) is the state at the round's start;
  after every call of the round has returned, outputs are validated and applied in round order; journal everything
end
at stop: journal the open instances and open obligations (the censoring record, §6)
```

- At most three rounds per instant: only round-1 instances can merge; only sweeps can wake; round-3 ticks can do
  neither, and effect results are never same-instant.
- Calls inside a round may run concurrently (a worker pool). Because no output is applied during a round (reads see
  the round-start snapshot) and outputs apply after it in round order, inputs, commits and the journal are identical
  whatever the concurrency or completion order. Round 2 sees round 1's applied outputs and round 3 sees both. (This is
  what `beds/ebed/host/host.mjs` does: `#ctxFor` "no output is applied during a round", `#caseRound` applies after
  `#pool` returns [M]; the earlier wording "apply each output's effects as it returns" contradicted it.)
- **Clock freeze.** The simulated clock does not advance during a real quota stop or crash; the stream resumes from
  the journal at the last committed wake-up (E-BED §2.7).

### 3.7 Arm errors and environment faults

- An **arm error** on a case-tick (invalid output, oversize carry, crash, timeout) applies nothing from that output,
  keeps the carry and the obligations, and records divergence `arm-error` for the truth case the instance is bound to
  (§5.1): the case fails, as E-BED §2.8 states. On a sweep tick it applies nothing and fails no case directly; missed
  effects fail cases through consequences. On an instance started by an inbound event, the event is lost (consequences).
- A real (untagged) **environment fault** is retried as `stream.mjs` does [M]; if it persists the case-tick is
  *impaired*: graded as an arm error and counted for K5 (> 25% impaired case-ticks in a world makes the arm invalid
  there, E-BED §6). Injected faults (§4.3) are never environment faults.

---

## 4. Host semantics and platform profiles

### 4.1 Profiles (declared in spec-E; identical for every arm of an item, including c-oss)

| profile | host guarantees | items |
|---|---|---|
| `bare` | none: no retry, no dedupe, no correlation, no ordering beyond §3.6 | E1–E7, E9, E11–E13 (Track P) |
| `temporal-like` | on retryable results (F1, F2, F3's timeout) the host re-issues the same activity call with the same arguments and key: initial 1 s, coefficient 2.0, maximum 100 s, unlimited attempts (Temporal's documented default [web✓, E-BED §2.2]); durable timers and signals as §3.4 | E8, every arm |
| `product` | Track C: the configured product engine computes product-computed fields and runs the automated part of the documented semantics; the arm's exception solver handles the rest | Track C items |

Under `temporal-like`, F1/F2 are absorbed for every arm; F3 is retried by the host, so an arm without keys applies twice
(double charge), and F6 is not retried. E10 (if admitted) runs tau2's own environment and is outside this table.

### 4.2 What the host never does (every profile)

Correlate events to cases by business meaning; deduplicate inbound events; compute deadlines or business time for an
arm; enforce separation of duties beyond routing a task as the arm declared it; compensate; fill a default for a
renamed field. A host that does any of these for one arm does it for none.

### 4.3 Faults (E-BED §2.7)

| id | host behaviour | result event |
|---|---|---|
| F1 | not applied | `rate-limited`, `retryAfter` |
| F2 | not applied | `error` (5xx, retryable) |
| F3 | **applied (committed)** | `unknown`; `status(key)` shows `committed` |
| F4 | k of n items applied | `partial` with per-item statuses |
| F5 | from the scheduled time the mock accepts only the renamed field and rejects the old one | `error` (400, field named) |
| F6 | not applied | `error` (permanent, non-retryable) |

The fault schedule is keyed by `(world, case, system, op, ordinal)`, identical across arms, and every injected row and
event carries `injected: true`. W1–W5 are world events, generated, not host behaviour.

### 4.4 Actors, counterparties, forms

- **Human tasks** are routed to the actor policy by `(world, truth case of the subject, role, kind, ordinal)`, never by
  the question text (E-BED Errata 2). `kind` must come from spec-E's human-task vocabulary; an unknown kind gets no
  answer, and so does a task whose `subject` names no existing object (an approver cannot find the document). The
  answering user is the first holder of the role in the world's pool not in `excludeUsers`.
- **Answers** are typed world data. The host validates each against the arm's `answerSchema`: accepted →
  `humanTask.answered { taskId, user, answer }`; rejected → `humanTask.answerRejected { taskId, user, errors }` (the
  value is withheld; the arm may ask again). No answer by `dueAt` → `humanTask.timeout { taskId, onTimeout }`; a later
  answer is delivered as `humanTask.answered` with `late: true` (W3).
- **Noise model** (E-BED §2.7): late, none, delegation (`humanTask.delegated` to another role holder), withdrawal,
  free-text answers in a declared share (typed as `{ text }` where the kind allows it), and **wrong answers** in a
  declared share where the rulebook requires a verification step.
- **Form route** (OPENUI §5.4): a declared share of answers is entered through the tier-0 form compiled from
  `answerSchema` and arrives as OpenUI-shaped `formState` (`{ value, componentType }` per field); the host adapter maps
  it to the typed answer and re-validates it against `answerSchema`. Planted invalid entries (`"12abc"` in an amount)
  must be rejected by the host even where a client rule would accept them; the actor then re-enters the correct value
  once.
- **Counterparties** (vendors, acquirers, carriers, applicants) answer the arm's outbound messages by deterministic
  policies keyed the same way; they react to what the arm did (on-policy), never to the oracle.

---

## 5. The oracle: on-policy, behavioural grading

### 5.1 Binding instances and effects to truth cases

- Every inbound event belongs to exactly one truth case (`truth.eventCase`): an invalid claim, a stray document or a
  false revealing event is a truth case of its own (class `invalid`, whose expectation is what the rulebook says to do
  with it: reject, reply or ignore), and a duplicate delivery belongs to the original's case. So nothing an arm does
  escapes grading.
- An instance is **bound** to the truth case of the event that started it, or to its backlog case. A merge changes no
  binding: the target keeps its own, and a wrong merge shows up as the merged event's true case missing its required
  effects (§3.2).
- Effects and human tasks are **attributed by subject**: `schemas.effects[op].subjectArgs` names the arguments that
  identify a business object; the oracle maps the object to its owning truth case. An effect whose subject arguments
  name no existing object (an invented or mistyped id) is attributed to the instance's binding. Grading is per truth
  case and never depends on how the arm split its instances **[D-2]**.
- Decisions are graded per instance against its binding; when several instances are bound to one truth case, the
  latest decision record per case-tick time is the graded one.

### 5.2 `referenceTransition(world, view) → Expectation`

`view` is the arm's own trajectory for one truth case up to a case-tick at time `at`: the case's truth events delivered
so far (by truth, whatever the arm's routing), the arm's outputs attributed to the case, the ledger rows and results,
and the arm's SoR as of `at` (cross-case state included). It returns:

```text
Expectation = {
  case, at,
  decisions: { graded: { <field>: value }, undecidable?: true },       // exact; absent fields are not graded at this tick
  effects:   { required: [LogicalEffect], permitted: [EffectPattern] },
  humanTasks:{ required: [TaskExpectation], permitted: [TaskPattern] },
  terminal:  boolean,                       // the case reaches a terminal state if the required effects of this tick happen
  records?:  { <table>: rows }              // on terminal ticks and at horizon end: the business-record projection
}
LogicalEffect   = { lid, rule, system, op, match: { <canonical args> }, args: { <canonical args> },
                    window: { earliest, latest }, after?: [lid], money?: { amountMinor, currency } }
EffectPattern   = { rule, system, op, match?: {...} }            // allowed, not required (e.g. optional notices)
TaskExpectation = { lid, rule, kind, role, mustExclude: [userId], window: { earliest, latest } }
```

Rules an implementer must keep:
- **`lid` is a deterministic function of (rule id, business keys)**, never of tick time, so the same logical effect gets
  the same `lid` at every later tick. Example: `pay:INV-20417`, `chargeback:ARN-…:cycle-1`.
- **Every window cites a rule** (`rule` names a spec-E section). Where the rulebook states no timing, spec-E states a
  reading (E-BED §2.5) and the window comes from it. A window is never widened per item to absorb a solver's design;
  a false reject is fixed by a rule-cited window (E-BED §9.1 specificity).
- Money in integer minor units, times minute-exact ISO with offset; canonical args are normalised as spec-E states
  (trimmed strings, upper-case ids); `match` is the subset that identifies the logical effect.
- **Totality.** `referenceTransition` is defined on every view reachable by any arm, control or mutant up to that
  case's first divergence; it may throw only after it (the case is already failed). A throw before any divergence is
  an oracle failure (K1).
- **On-policy cross-case state.** Because the view includes the arm's actual SoR, an error on case A changes what is
  expected of case B only as the rulebook says it should (e.g. exposure); B is never failed for A's mistake.

### 5.3 The per-case grading machine

For each truth case the oracle keeps open logical effects `lid → { window, rule, satisfied, count, key }` and walks the
case's **processing points** in time order: every delivery of one of the case's truth events (to whichever instance
the arm routed it, or to none), every case-tick of an instance bound to the case, every ledger row attributed to it,
every window's `latest`, and the horizon end. Without the first kind, a case whose events the arm mis-routed would
never open its obligations.

1. **Expectation.** At each processing point `at`, compute `E = referenceTransition(world, view_at)` on the view as of
   `at`, before any arm output at `at`. New `lid`s open (their windows may lie in the future: "escalate if no answer by
   day 10" opens at the request, with a window starting on day 10); an open `lid` takes the window of the latest
   expectation that names it; an open unsatisfied `lid` that a later expectation no longer names is **withdrawn** (no
   failure: the rulebook no longer requires it, e.g. after a cancellation).
2. **Decisions (layer 1).** At each case-tick of an instance bound to the case, the arm's `decisions` projected on
   `E.decisions.graded` must be equal. Over-escalation (a
   human task outside the allowed set for a decidable case) and under-escalation (no required task for an
   `undecidable` case) are layer-1 divergences (W-bed R2 rule).
3. **Effects (layer 2).** Every ledger row attributed to the case (each attempt, committed or not) must match an open
   `lid` (same system, op and `match`) or a permitted pattern; a row matching nothing is `outside-allowed` (acting
   before the rule requires it included). A **committed** row inside its `lid`'s window satisfies it; a second committed
   row for a satisfied `lid` is `duplicate`; a commit before `earliest` is `early`; a commit whose `after` predecessors
   have not committed is `order` (checked only where a rule declares order: compensation order, notice before
   reversal). Keys, over attempts: every attempt of one `lid` uses one key (`key-split` otherwise, e.g. a retry after
   F1 or F3 under a new key), and two `lid`s never share a key (`key-reuse`).
4. **Deadlines (layer 3).** At each checkpoint `latest`, an open unsatisfied `lid` is `missed`. Deadlines are graded
   only through their consequences; the arm's obligations are never compared.
5. **Human tasks (layer 4).** A created task must match a required or permitted task expectation by `kind`; `role` must
   match and `excludeUsers ⊇ mustExclude`; creation inside the window. Whether the answer was usable is graded through
   consequences (the required effects that depend on it).
6. **Records (layer 5).** On the tick where `terminal` holds, and at horizon end for open cases, the arm's business
   records for the case equal `E.records` (business records only; product-computed fields are graded in layer 1 when
   spec-E lists them as graded decision fields).
7. The **first divergence** fails the case and is recorded `{ at, layer, code, rule, lid?, detail }`; the oracle stops
   evaluating that case's expectations but keeps running the ledger checks below.

**Critical violations** (each fails H-E2 on its own; counted per arm, world and item, on every case including failed
ones): a duplicate money movement (payment, refund, charge, provisional credit); an effect requiring an approval with no
approval; an effect on a held, cancelled or closed object; a separation-of-duties violation (the answering user was one
the rule excludes); an orphaned charge or reservation after a failed saga; a regulatory filing missing, late or
duplicated; an effect that follows an injected instruction (W5, checked with twins).

**Invariants** (analyst-side, per item; never shown to arms): conservation, balancing identities, one terminal state,
monotone clocks. A violated invariant on an arm trajectory is reported; on the reference run it is an oracle failure.

### 5.4 Verdicts

```text
CaseVerdict = { case, subject, epoch, class, tail, pool: 'completed' | 'censored', pass: boolean,
                armCensored: boolean, firstDivergence: {...} | null, critical: [...], humanTasks: { required, created } }
StreamVerdict = { world, arm, mix, track, profile, cases: [CaseVerdict],
                  score: { completed, passed, rate }, censored: { byEpoch: [...] }, critical: [...],
                  invariants: [...], intakeAccuracy, digests: { world, journal, ledger } }
```

- **Case pass** (completed pool): no divergence on layers 1–5 from go-live or start until the case is terminal on the
  arm's trajectory, and terminal by horizon end. A completed-pool case still open at horizon end with no divergence is
  `armCensored` and **does not pass** **[D-4]**.
- **Segment pass** (censored pool): no divergence until horizon end; windows whose `latest` is after `horizonEnd` are
  not graded.
- **Stream score**: passed / completed-pool cases, per mix, with the censored share beside it. Paired across arms by
  `(world, case)`.
- `intakeAccuracy` (diagnostic): the share of inbound events the arm routed to the instance bound to their truth case.

### 5.5 Controls the oracle must reject (and accept)

Echo (return the SoR unchanged), no-op (no effects, no tasks) and every gaming control (hold everything, escalate
everything, wait for a human on everything, declare every obligation, pay twice with one key) fail every world in CL
(E-BED §2.9, §9.6). The reference policy (§5.6) and every specificity solver pass every completed case (§11).

### 5.6 The reference run

`referencePolicy(world, view)` emits, at each case-tick, the canonical output of the current expectation (required
effects at their `earliest`, required tasks, the graded decisions) and the obligations needed to wake at every window
start. Running it through the real host loop gives the **reference run**: it defines the completed/censored pools (§6),
it is the source of the neutral export for TF (§8), and it must itself pass every case (a self-consistency check of the
oracle, not evidence about any arm). The reference run is *not* arm (c): (c) is an Opus-built solver graded like
every other arm (E-BED §2.12).

---

## 6. Horizon, epochs and censoring

- **Horizon** per item as E-BED §2.1 (E1 130 business days, E5 200 calendar days, …), converted to an absolute
  `horizonEnd` by `generateWorld`. Epoch boundaries likewise; **a case belongs to the epoch that contains its start**
  (first truth event time; backlog cases are `gl`).
- **Pools** come from the reference run: a case is *completed* if the reference run makes it terminal by `horizonEnd`,
  *censored* otherwise. The pools are therefore identical for every arm of a world **[D-4]**. Each arm additionally
  reports its `armCensored` count (completed-pool cases it left open without diverging; they count as not passed).
- **Bed health (K1).** The reference run closes ≥ 80% of the cases started in every epoch except the last
  (E-BED §9.2). E-BED §6 K1 says "any epoch"; the last epoch cannot meet it at a horizon of about p90 + the longest
  clock, so K1 is read as §9.2 states **[D-14]**.
- **Censored label.** A verdict is labelled "censored" when the censored share exceeds 20% in an epoch whose cases it
  pools, the last epoch excepted for pooled verdicts; an epoch-level claim about the last epoch (e.g. revert behaviour)
  carries the label when its own share exceeds 20%. `censoringReport` in `stats-ebed.mjs` computes both readings.

---

## 7. The two tracks

| | Track P "engine port" | Track C "configure" |
|---|---|---|
| construction inputs | `spec/SPEC-E.md`, rule tables as data, SoR and API schemas | `track-c/`: policy memos, emails, an org chart, 20–200 historical cases with outcomes, product documentation (the card APIs), the SME simulator |
| construction output | a `tick/1` solver (+ sweep solver) | `config.json` valid against `schemas.config` (rule rows, tolerance and policy hierarchy, calendars, SLA definitions, approval matrix, collection steps) + an exception-handling `tick/1` solver for what the product does not automate |
| runtime profile | `bare` or `temporal-like` | `product` |
| product-computed fields | computed by the arm, written through effects | computed by the host's product engine from the arm's configuration; readable through `sor.query` |
| graded | §5 | §5 unchanged, plus a descriptive configuration diff against the truth configuration and SME minutes |
| claim wording | "built a correct engine for the documented semantics" | "configured the documented product semantics from business inputs" |

- **SME simulator.** Questions are typed `{ topic, question }` with `topic` from `track-c/SME.json`'s vocabulary;
  answers come from world truth; each question costs 2 simulated minutes of SME time (journaled; not on the stream
  clock); a question outside the vocabulary or ambiguous gets the memo text that leaves it open ("it depends").
- **Withheld rows (variant C-w).** 10–30% of rule rows are absent from the memos; each is pinned by ≥ 3 historical
  cases; the manifest `track-c/withheld.json` is analyst-only.
- **Product admission.** The product engine (cards P58/P59/P60 + item modules, written independently of the oracle)
  must agree with the oracle on 20 dev worlds per difficulty under the truth configuration before any Track C arm runs.

---

## 8. Teacher-forced (TF) mode: diagnostic only

- Inputs at each case-tick are the **neutral export of the reference run's trajectory** up to that tick (business
  records and raw events, DESIGN-STREAMS §2.4 [M]); the arm's carry is empty, or rebuilt by the arm's own declared
  migrator from that history. Product-computed fields are never included in Track P.
- The output of each TF case-tick is graded against the expectation at that tick (layers 1–4 restricted to effects and
  tasks whose window opens at the tick).
- Only **informative case-ticks** count: those on which both the echo and the no-op control fail. The echo/no-op pass
  rate per item is reported.
- TF numbers explain where an arm breaks; they never enter a decision, a family test or a reliability verdict.

---

## 9. World-level mode: diagnostic only

One call per wake-up sees every instance with deliveries and may emit everything at once. It makes cross-case reasoning
free and correlates failures within a tick, so it never enters a decision. Its one use as a check is MR13: the
reference run in per-instance mode and in world-level mode yields an identical ledger.

---

## 10. Seeds, splits and salts

### 10.1 Ledger blocks (`research/jit-20261008/SEED-LEDGER.json`, owner `ebed`)

Seed numbers are E-BED §6's, shared by every item; each world is salted by item (§10.2), so seed 9101 is a different
world in E1 and in E7.

| block | split | seeds | ledger range(s) | purpose (allow) | status | use |
|---|---|---|---|---|---|---|
| dev | dev | 1001–1199 | `ebed-dev` (all 13 beds) | `jit-dev` | fresh | bed health, property, metamorphic and mutation suites, $0 controls, specificity and product≡oracle checks (20 worlds per difficulty), dev streams |
| dev fuzz bases | dev | 1301–1310 | `ebed-dev-fuzz` (all 13 beds) | `jit-dev` | fresh | N-version and validator fuzz; base `b` expands to worlds salted `ebed-fuzz/<item>/<i>`, i < 10⁴, inside the generator (never ledger seeds) |
| rehearsal | dev | 1201–1249 | `ebed-e<k>-rehearsal` (per item) | `ebed-rehearsal` | fresh | (c) author fixtures 1201–1206; triviality, necessity and gaming attacks 1211–1222; reference validation 1231; dev rehearsals 1232–1234; specificity-solver and Track C rehearsals 1241–1249 |
| held-out A–B | test | 9101–9102 | `ebed-e<k>-heldout-ab` | `ebed-heldout` | reserved | the K = 2 pilot pair (E-BED §8.2 P4) |
| held-out C–D | test | 9103–9104 | `ebed-e<k>-heldout-cd` | `ebed-heldout` | reserved | K = 4 (P5, P7) |
| sealed / reserve | test | 9201–9204 | `ebed-e<k>-sealed` | `ebed-sealed` | reserved | sealed drift families, heal arm (one world per mined defect) |
| scale | test | 9301–9302 | `ebed-e<k>-scale` (E1–E9 only) | `ebed-scale` | reserved | scale tier, compiled arms only |

- 63 ranges in all; numerically disjoint from every non-E-bed bounded range on either split (only the open `test-clean`
  row contains the test blocks, as it contains every held-out range), and disjoint from each other within a bed
  (`experiments/lib/ebed-seed-ledger.test.mjs` [M-c]).
- **Why these purposes** **[D-11]**: the rehearsal block is kept out of `jit-dev` so no dev stream or suite tunes on
  fixture, attack or validation worlds before they are used; it is `fresh: false` because its sub-blocks are consumed
  in stages (the status records it). The test blocks take E-bed purposes (`fresh: true`, `heldout: true`) so a stream
  config that forgets `seedPurpose` (default `jit-heldout`, `stream.mjs:71` [M]) is refused on E-bed worlds; the E-bed
  runner declares `seedPurpose: 'ebed-heldout' | 'ebed-sealed' | 'ebed-scale'`.
- **Why per-item test entries**: a run consumes worlds per item (P4 runs E8 and E1 first), and the ledger marks a
  consumed range `used` in the run's commit; per-item entries keep that record exact, and the A–B / C–D split lets
  K = 2 then K = 4 run without editing range ids. Dev blocks are never refused by status (`jit-dev` is `fresh: false`),
  so they are shared, as `wbed-dev` is.
- E10 (optional) holds the same blocks if the owner admits it (E-BED §11.5); seeds there index tau2 task samples and
  the user simulator's seed.

### 10.2 Salts

- World: `rng('ebed', item, split, seed, difficulty, schedule, mix, scale, track, <component>)` with one fork per
  component (calendars, parties, arrivals, documents, actors, faults, editions, backlog). `split` is used only as salt
  (CONTRACT v1 [M]).
- Fuzz: `rng('ebed-fuzz', item, base, i)`. Twins: `rng(<world salt>, 'twin', twinId)` touching only the intended record.
- Composition (E3 calls E1 and E2 slices): child slices use `rng('ebed', 'e3', split, seed, …, 'slice', 'e1', k)`, so no
  E3 world reproduces an E1 or E2 world, held-out or not.
- Sealed plug-ins live under `beds/sealed/`, authored by a separate session from spec-E and the generator API only; no
  implementer of the item reads them.

---

## 11. Admission (K1 per item) and oracle health for `world-stream`

Replaces CONTRACT v1's per-task oracle-health list for this kind. All at $0 on dev worlds before any metered step, and
again at freeze (E-BED §9).

1. **Determinism**: `generateWorld`, actors, fault schedule, reference run and oracle verdicts byte-identical across
   two runs and two processes; tie-breaks by `(at, source, id)`; replay of a journal reproduces ledger, SoR and outputs
   byte for byte, else the run is void.
2. **Reference self-consistency**: the reference run passes every case on ≥ 20 dev worlds per difficulty; totality holds
   on every view reached by controls and mutants.
3. **Goldens**: every public worked example as `{ source: file:line, input, expected }`, including discriminating
   goldens (E1: invoice 1 of the cumulative example); all pass on the oracle and on the cards.
4. **N-version** (E4, E5, E6 and the P60 clock): two implementations by separate sessions, differential fuzz over 10⁴
   worlds per item from the fuzz bases, every disagreement resolved by quoting the rule.
5. **Specificity**: ≥ 3 correct solvers written independently with different internal designs pass every completed
   case on 20 dev worlds per difficulty; **one false reject fails K1**.
6. **Controls**: bad controls fail ≥ 20 worlds per difficulty; necessity controls fail ≥ 50% of attack worlds' tail
   cases; echo, no-op and gaming controls fail every world.
7. **Mutation score ≥ 0.95** on oracle mutants (operators of E-BED §9.5).
8. **Leak**: no truth-only string in inputs, files or mock responses; product-computed fields never in Track P inputs.
9. **Twins** differ only on the intended record; W5 twins give identical decisions on the reference run.
10. **Censoring**: §6 bed-health rule.
11. **Calibration** (E1, E9): E-BED §2.6 and §9.9 numbers, reported per world.
12. **Budgets**: per-instance render ≤ 20K tokens at d5; generate + oracle < 2 s per 10³ cases and < 200 MB (CONTRACT v1
    limits per 10³ cases); the scale tier within its own budgets (case-ticks per second, ≤ 2 GB).

K1′ (reference not buildable), K2–K7 are as E-BED §6.

---

## 12. Journal and accounting

Per arm and world, append-only and hash-chained: every wake-up (time, deliveries in order), every input digest and
output, every effect application and ledger row, every result and fault (with `injected`), every actor answer and form
submission, carry and workspace digests, clock freezes, and model-call costs **from the model journal only** (never from
solver reports, D21 [M]). `oracle(world, journal)` reads only this journal and the world.

---

## 13. Statistics (`experiments/lib/stats-ebed.mjs`)

### 13.1 Units and functions

The decision unit is the CL case segment on completed cases, paired across arms by `(world, case)`; TF case-ticks never
decide (E-BED §6). Functions: `clopperPearson(x, n, side)`, `maxFailures`, `minCleanCases`, `reliabilityVerdict`
(H-E2, H-E2c), `censoringReport`, `wilcoxonExact`, `wilcoxonCritical`, `familyTest` (test (i)), `familyDecision`
((i)–(iii) with Holm across arms), `holm`, `nonInferiority` (H-E1, H-E7), `itemGap`, `itemGapSE`, `familyPower`.
CLI: `node experiments/lib/stats-ebed.mjs power | thresholds`.

### 13.2 Decisions taken in the module

- **[D-7] Location.** E-BED §6 asked for these in `experiments/jit/stats.mjs`; they are a new module so the JIT
  instrument and its pinned tests do not move.
- **[D-8] Non-inferiority.** One-sided lower bound at 95% (`level`), decision `lower > −δ`, δ = 0.10. The bound is
  the smaller of a two-stage world-clustered percentile bootstrap and the i.i.d. case bootstrap widened by
  `sqrt(1 + (m̄ − 1)·ρ)`, ρ = 0.1: with K = 2–4 worlds the cluster bootstrap cannot see between-world variance (the
  same reason as `pairedComparison` in `experiments/jit/stats.mjs:177` [M]), and ρ = 0.1 is what E-BED's power
  assumed. K < 2 worlds gives bounds but no decision. A bootstrap p-value, `(#{replicates ≤ −δ} + 1)/(B + 1)`
  (the larger of the two), feeds Holm across items.
- **[D-9] Wilcoxon.** Exact one-sided test conditional on the observed absolute values (sign-flip distribution; the
  classic table null when there are no ties); ties by midranks; zero differences dropped (Wilcoxon's method; Pratt's
  available). Rejection on `p < α` everywhere (E-BED writes "p < 0.05"); exact p-values are dyadic and never equal
  0.05 / j, so this only matters for bootstrap p-values. Fewer than 6 admitted items, or fewer than 6 non-zero
  differences, gives no family-level claim.
- **[D-12] Test (ii) with fewer than 9 items.** E-BED requires H-E2 on "≥ 7 of the admitted core items", which no arm
  can meet with 6 admitted items although (i) is allowed down to n = 6. `familyDecision` keeps E-BED's fixed 7 by
  default and accepts `minReliable: n => Math.ceil(7 * n / 9)` (7 of 8, 6 of 7, 5 of 6); the owner picks one (§15).
- **[D-13] Holm set.** E-BED §0 says "Holm across the two Haiku arms", §6 "across the arms tested ((a), (g), B1-H)".
  `familyDecision` applies Holm across the arms that actually enter the test (an arm with fewer than 6 testable items
  is not in the set); (g) is in it only once it runs.

### 13.3 Reference values the tests pin (all derived independently in `stats-ebed.test.mjs`)

| quantity | value | how it is checked |
|---|---|---|
| Wilcoxon, 9 items: critical W⁻ and its p | 8; 25/512 = 0.0488 (W⁻ = 9: 33/512) | hand enumeration of subsets of {1..9} |
| critical W⁻ for n = 5 … 13 | 0, 2, 3, 5, 8, 10, 13, 17, 21 | hand (n ≤ 9) and the published one-tailed 5% table |
| H-E2 pooled, n = 300 / 100, bound 0.95 | at most 8 / 1 failures | exact rational arithmetic (BigInt) |
| H-E2 per world, n = 100, bound 0.90 | at most 4 failures | BigInt; hand derivation in the test |
| H-E2c, rate ≤ 0.1% | 2,995 clean cases | closed form ln 0.05 / ln 0.999 = 2994.2 |
| item-gap SE (m = 40, ρ = 0.1, p = 0.8) | 0.1389 (K = 2), 0.0982 (K = 4) | by hand |
| sign rule power at equality | 0.336 (K = 2), 0.585 (K = 4) | closed form 9q⁸(1 − q) + q⁹, q = Φ(0.10 / SE) |
| null size at true gap −δ | Wilcoxon 25/512, sign 10/512 | exact, any SE |
| Wilcoxon power at equality | **0.609 (K = 2), 0.856 (K = 4)** | simulation ± 0.002 (§13.4) |

### 13.4 Correction to E-BED's power figures [M-c]

E-BED §6 gives Wilcoxon power 0.60 (K = 2) and 0.85 (K = 4), and the sign test 0.34 / 0.57. Re-running the same model
(9 items, gap ~ N(0, SE²), SE as above, δ = 0.10) with the repo's mulberry32 generator gives **0.609 / 0.856**
(Wilcoxon) and **0.336 / 0.585** (sign) at 200,000–400,000 draws (Monte Carlo SE ≈ 0.001). The sign figures match
their closed form to Monte Carlo precision; E-BED's 0.572 at K = 4 does not, and E-BED's generator (a 31-bit LCG
feeding Box-Muller, `scratchpad/efinal/pw.mjs`) also puts the sign test's null size at 0.017 instead of the exact
10/512 = 0.0195. So the E-BED figures are 0.005–0.013 low. Nothing in the design changes: K = 4 stays recommended,
and the Wilcoxon still beats the sign test by about 0.27 in power at both K.

---

## 14. Decisions and deviations from E-BED (for the owner's review)

| id | E-BED said | this amendment | why |
|---|---|---|---|
| D-1 | events "routed per case" (§2.1) yet the host "never correlates" (§2.2) | routing by channel identity only; every uncorrelated inbound event starts an instance; the arm merges (§3.2) | the two sentences conflict; message-start + correlate is what engines do (G1), and it keeps correlation the arm's work |
| D-2 | grading per case | per truth case, effects attributed by subject arguments; instance structure never graded (§5.1) | arms may split or merge instances; grading must stay behavioural |
| D-3 | allowed windows (§2.8) | `lid` deterministic in (rule, business keys); the latest expectation's window binds; withdrawn `lid`s are not failures; every window cites a rule (§5.2–§5.3) | windows recomputed on-policy must refer to the same obligation across ticks |
| D-4 | censored share "per epoch and arm" | pools from the arm-independent reference run; an arm's open completed-pool case does not pass (`armCensored`) (§6) | pairing by (world, case) needs one denominator; a stalling arm must not shrink its own |
| D-5 | "after an arm error the case is already failed" | kept; an impaired case-tick (persistent real env fault) is graded as an arm error and counted for K5 (§3.7) | one rule for every arm |
| D-6 | wake-up ordering unstated | rounds: case-ticks, sweeps, merge/wake ticks; effect results ≥ 1 minute later (§3.6) | determinism and no same-instant cascades |
| D-7–D-9, D-12, D-13 | §6 | §13.2 | see §13.2 |
| D-10 | power 0.60 / 0.85, sign 0.34 / 0.57 | 0.61 / 0.86, sign 0.34 / 0.58 (§13.4) | biased generator in the original script |
| D-11 | seed ranges `owner: jit`, allow `jit-dev` for 1001–1199 | owner `ebed` (as `wbed`); E-bed purposes for rehearsal and test blocks; per-item test entries; held-out split A–B / C–D (§10.1) | per-item consumption; refuse default purposes on E-bed worlds |
| D-14 | K1 "censored share > 20% in any epoch" | every epoch except the last, as §9.2 (§6) | the last epoch is mostly censored by construction |
| D-15 | epochs named E0–E4 | `ep0`–`ep4` (+ `gl` for the backlog) | item ids are E1–E13 |
| D-16 | actors keyed by "decision kind" | `kind` is a required human-task field from spec-E's vocabulary (§4.4) | the key must be typed, not read from question text |
| D-17 | answerSchema rejection: "the consequence fails" | the host withholds the rejected value and tells the arm (`answerRejected`); graded through consequences (§4.4, §5.3) | keeps layer 4 behavioural; an arm may recover by asking again |

---

## 15. Open questions for the owner

1. Adopt the routing model D-1 (inbound start + merge)? The alternative (the host routes by truth) is simpler but
   removes correlation (G1) from the tier-S measurement, contrary to E-BED §2.2.
2. Test (ii) below 9 items (D-12): fixed 7, or `ceil(7n/9)`?
3. `armCensored` counts as a failure (D-4). Alternative: report separately and drop from both arms' pairs (keeps
   pairing, but an arm could then benefit from stalling).
4. Sealed / reserve worlds (9201–9204) are one range per item; the heal arm uses one world per mined defect, so an item
   with more than 4 admitted defects needs more reserve seeds (proposal: 9205–9299, added when the miner's count is
   known).
5. The non-inferiority level (one-sided 95%) and ρ = 0.1 are inherited, not measured; the first K = 2 pilot measures
   ρ per item, and an amendment before P5 may replace it.
6. E10: keep its ledger blocks only if the owner admits E10 (E-BED §11.5).
