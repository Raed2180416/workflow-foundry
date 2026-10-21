# Composition harness for E8 (2026-10-21)

*Brief: `PLAN.md` "The test to build". Built at $0 (no model call). Development evidence on dev seeds only (§6); nothing
here is a claim about any arm. Code: `experiments/compose/`. E8's host, oracle, grading, worlds and spec are
unchanged and imported, never edited.*

**Status.** Built and validated at $0. Validated: the module interface and runtime, 13 capability contracts, the fault
and drift harness, the scripted composed reference with four mis-composed variants, and the builder side of arms C-H
and C-H-T with dry runs of both. The paid C-H and C-H-T builds have **not** been run (§7.4 has the commands).

```sh
# tests ($0; one file at a time, as the machine is shared)
for f in runtime capabilities reference faults build; do nice node --test --test-concurrency=1 experiments/compose/test/$f.test.mjs; done
node experiments/compose/validate.mjs --mutants 24 --out research/composition-20261021/runs/validate-capabilities.json    # §3.3, ~1 h
node experiments/compose/fault-run.mjs --subject ref --worlds 1161:2:40,1162:3:40,1164:5:60                             # §4, §5
node experiments/compose/fault-run.mjs --subject solver:research/enterprise-20261014/runs/b1lh-e8-1/solver.mjs --worlds 1232:2:12,1161:2:40
node experiments/compose/drift-run.mjs --worlds 1165:2:30,1166:3:30                                                    # §4.4
node experiments/compose/build.mjs --arm C-H --dry-run --label dry-ch-stub --seeds 1232 --difficulties 2 --size 12     # §7.3
```

## 1. What is measured

Every arm, composed or monolithic, runs as an ordinary tick/1 solver through the unchanged E8 host and is judged on
four signals, each from the journal:

| signal | what | from |
|---|---|---|
| end to end | the E8 oracle on completed cases (reference pools), critical violations | `beds/ebed/e8` `oracle`, unchanged |
| business capabilities | 13 hidden contracts written from SPEC-E rules, judged on the effect history of each order, whatever the decomposition | `capabilities.mjs` (§3) |
| interface honesty | composed arms only: every effect, task and timer inside its emitter's declaration, calls inside the declared graph, typed inputs and outputs; re-verified against the trusted manifest | `runtime.mjs` (enforcement), `trace.mjs` (verification) |
| faults and drift | exactly-once effects, compensation completeness and the three signals above under crash and restart, duplicate delivery, a downstream failure after a side effect, and one changed rule | `faults.mjs`, `fault-run.mjs`, `drift.mjs`, `drift-run.mjs` (§4) |

Cost is the build session's reported cost plus $0 per case (the program runs as code), as for B1L-H.

The harness does **not** measure how good a decomposition is in the abstract. It measures whether the program
decomposes the work so that every capability holds end to end, whether each module stays within its interface, and
whether the program survives faults and drift. Patch locality under drift (§4.4) is ready but needs a paid rebuild or
patch to have a value.

## 2. Design decision and the module interface

### 2.1 Decision: (i), the tick-solver interface extended with declared sub-modules, run by a harness-owned runtime

| option | keeps host, oracle and grading | boundaries enforced by | verdict |
|---|---|---|---|
| (i) tick/1 solver = parent + declared modules, bundled by the harness with its own runtime | yes: the bundle *is* an ordinary tick/1 solver; the trace rides in `decisions.composition`, which E8 does not grade (`oracle/grade.mjs` compares only `E.decisions.graded`, i.e. `subject`) | the runtime: each module in its own vm context, no imports; effects attributed by which module returned them, checked against the declaration; names namespaced; re-verified from the journal against the trusted manifest | **chosen** |
| (ii) flow-v3 programs with `flow.call` into hashed library entries | no: a flow-v3 program is one-shot (`input → done`) with no wait primitive, and the library refuses effectful callees (`research/jit-20261008/design/FLOW-V3.md` §1.2: `"effects": "none"`, "an effectful callee is refused"; §3: "No effect, wait or approval primitive"). E8 is a 14-day reactive saga whose sub-workflows *are* effects; each tick would need a process per call | the host for typed I/O and budgets, but not for effects (none allowed) | rejected |
| (iii) a new composition engine (e.g. `src/` IR with `call`/`compensate` nodes) | no: `src/` has no `call` or `compensate` node (PLAN.md table) and editing `src/` is out of bounds | — | rejected |

Why (i) makes boundaries enforceable by the harness rather than by the builder's honesty: the builder writes only
`composition.json`, `parent.mjs` and `modules/*.mjs`; the harness bundles them (`bundle.mjs`) with `runtime.mjs` and
`loader.mjs`. A module is evaluated in its own `node:vm` context: it cannot `import`, cannot see another module's code or
variables, and reaches the platform only through a ctx built inside its own context over a JSON-string bridge. Its
effects are attributed by the runtime (the module *returns* them), checked against its declared kinds, and its names are
namespaced by the runtime. The per-tick trace is re-verified from the journal against the manifest the harness bundled
(`trace.mjs`: an effect outside its owner's kinds that the runtime did not flag, or an owner list that does not match the
effects, is a `trace-integrity` finding). The vm context is a boundary against shortcuts, not against deliberate escape
(§8); the whole program still runs in the OS sandbox of `beds/ebed/host/sandbox-arm.mjs`.

### 2.2 The interface (builder-facing text: `experiments/compose/builder/COMPOSE.md`)

- **Manifest** (`composition.json`): `parent { file, calls, effects, humanTasks }` and per module `{ file, purpose,
  rules (SPEC-E ids owned), input, output (portable-subset schemas), effects, humanTasks, timers, calls, reads }`.
  Effect kinds are `system.op` or narrower E8 kinds: `orders.setStatus:order|fulfilment[:status]`,
  `notify.send:<template>` (`kindsOfE8`). The call graph must be acyclic. `manifestProblems` checks it against the
  item's ops and task kinds.
- **Parent**: `tick(input, ctx)` with `input.state` (its own state) in place of the carry; `ctx.call(module, key,
  input)` → the module's typed output; `ctx.ownerOf(event)` / `ctx.deliver(event)` route an effect result, timer or task
  event back to the module instance that caused it; `ctx.emit` for the parent's own declared effects.
- **Module**: `step(input, ctx)` (typed call) and `onEvent(event, ctx)` (its own results, timers, tasks), both
  synchronous, returning `{ output, state, effects, obligations, humanTasks }`. `key` names a sub-workflow instance (an
  order, a fulfilment): every (module, key) pair has its own durable state slot in the carry; the parent never sees it.

### 2.3 Runtime semantics (`runtime.mjs`, import-free so it can be inlined)

- **Names.** Every key (batch item keys included), wake-up id and task id of a module instance is emitted as
  `<module>/<key>/<local>` and localised again on the way back, so routing is parsed from the name, never remembered.
  A first version kept a provenance index in the carry; designing the crash fault (§4) showed why that is wrong: a
  crash that rolls the carry back would leave the crashed tick's results unroutable (found by reasoning, before any run). `ctx.status(system, key)` takes the local key.
  `after` resolves to the module's own key or, across modules, to a local key emitted earlier in the tick.
- **Enforcement.** Mode `strict` (default; the paid arms and every grading): an undeclared effect, task or timer is
  dropped and recorded; an undeclared call, a schema breach, a recursion, a read outside the declared systems is refused
  (an `InterfaceError` thrown to the caller). Mode `audit` records and lets everything through. Calls are atomic: a
  module call that throws or fails its output schema leaves no effect, task, timer or state behind.
- **Output.** An ordinary TickOutput: effects in call order, carry `{ cv: 1, p: parentState, m: { module: { key: state } } }`
  (≤ 64 KB as before), and `decisions.composition = { owners, calls, violations, dropped }`. An uncaught error fails
  the tick (an arm error) with a composition summary in the message.

## 3. Capability contracts (`capabilities.mjs`)

### 3.1 The contracts

Written from SPEC-E's rules (each check cites its rule) as predicates over one order's effect history: committed
ledger rows and attempts attributed to the case, the messages delivered for it, its human tasks, plus world facts
SPEC-E gives every arm (catalog, fees per edition, allocation, verdict, customer e-mail). They do not import the
transition; they judge whether what happened is consistent with the rules, not the oracle's step-by-step expectation.
The journal is parsed with the item-independent `oracle/view.mjs` index (case attribution by the host's
`subjectCase`); compensation sets come from the independent planner `beds/ebed/lib/saga.mjs`.

| id | capability | rules | main checks |
|---|---|---|---|
| intake | order intake and record | R1.1–R1.4, §3.1, §3.5 | recorded once within 60 min of p, items as placed, fulfilments as allocated, amounts with the edition in force at p, total; go-live orders never re-recorded |
| fraud | fraud screening and review | R2.1, R2.2, R6.4, S1, S3, S12, S15 | no task unless verdict review (over-escalation, go-live orders too); task within 120 min, role, subject, answer schema; reject / reject answer / timeout → cancelled in its window; nothing forward before clearance; a cleared order not cancelled without a customer action |
| capture | payment capture | R4.2.2, §1, R5.2, R6.2 | ≤ 1 charge per fulfilment, the right amount, after every reservation committed, only once ready, within 120 min of the last reservation (liveness), none after a counted cancel, no retry of a declined charge |
| refund | refund iff captured money must return | R5.1, R5.2, R6.2, R7.1 | a failed or cancelled fulfilment's charge refunded in full exactly once; a delivered one never; never before or without a charge |
| reservation | stock reservation and release | R4.2.1, R5.1, R6.2, R7.1 | each item reserved once at its location within 120 min of ready (liveness), released iff the fulfilment fails or is cancelled, never released uncommitted or twice |
| shipment | shipment booking and cancellation | R4.2.3, R5.1, R6.2 | ≤ 1 booking after the charge committed, within 120 min of it (liveness); a cancelled fulfilment's booked shipment cancelled (unless collectionFailed); never cancel a delivered one |
| compensation | LIFO compensation, on time | R5.1, R5.2, R6.2, S2, S14 | committed compensations = the planner's set for the committed steps, in reverse commit order (shipment, refund, releases); within 120 min of the failure / 60 min of the cancel (or of a later commit) |
| failure | fulfilment failure handling | R5.2, S13, S14 | a decline, permanent error or collectionFailed → `failed` and its notice in time; the failed step never retried in a later emission; other fulfilments unaffected |
| tracking | carrier tracking, statuses, outcome | R4.1, R4.4, R4.5, R7.2 | statuses only forward and each once; processing within 60 min of ready; dispatched / completed within 120 min of the reports; order outcome R4.5 in time; nothing before the order is recorded |
| customer-action | amend / cancel / timeout | R3.1, R3.2, S1, S5, S9, S11 | customerActionRequired and notice within 120 min of clearing unless the customer acted first (S9); amend → unavailable cancelled within 60 min; timeout strictly after D, within D + 60 min |
| cancellation | customer cancel during processing | R6.1–R6.3, S4, S6, S7, S10, S13, S15 | a cancel counts iff no collection reported (delivered before it, reportedAt ≤ its time); counted → order and open fulfilments cancelled within 60 min, no forward step emitted after it (S10); refused → `cancel-refused` within 60 min, nothing cancelled |
| notifications | every required notice exactly once | §4.8 | each required notice (from the order's own outcome) sent once to the customer, none without cause, no `unknown-order` for an order that exists |
| exactly-once | exactly-once effects and keys | §1, R1.4, R7.2 | no logical effect committed twice, one key per logical effect, no key for two effects, no key conflict |

E8 has no payment authorisation or void step (only charge and refund), so "capture/void" in the brief is covered by
capture and refund.

### 3.2 Validation (`validate.mjs`; `runs/validate-capabilities.json`)

Dev worlds 1161 d2, 1162 d3, 1163 d4 (size 40) and 1164 d5 (size 60). Case level, completed pool:

| subject | completed cases | both reject | oracle only | contracts only | both pass | arm-censored |
|---|---|---|---|---|---|---|
| reference policy, earliest and latest (8 runs) | 394 | 0 | 0 | 0 | 394 | 0 |
| 15 controls (bad, gaming, necessity, c-oss) | 2,653 | 1,376 | 0 | 0 | 1,276 | 1 |
| 24 oracle-killed reference mutants (sampled evenly from `ledger/latent-defects/index.json`) | 4,728 | 1,916 | 0 | 0 | 2,756 | 56 |

Every control and every sampled mutant is rejected by at least one contract wherever the oracle rejects it, and no
contract rejects a case the oracle passes, on these worlds. Per control the violated contract is the expected one
(`noop` → intake, `charge-twice` → capture, exactly-once; `no-compensation` → compensation, refund, reservation;
`forward-order-compensation` → compensation; `timer-first` → customer-action; `edition-by-publication` → intake,
capture; `no-dedupe` → exactly-once; `last-signal-wins` → tracking; `escalate-everything` → fraud; ...). Arm-censored
cases (a runaway the host stopped before the case finished) are counted apart: the oracle fails them as unfinished,
the contracts judge only deadlines inside the observed run.

### 3.3 Disagreements with the oracle (findings, not tuned away)

1. **Arm errors are not a capability.** `ref-k25` (outside the 24-mutant sample; seen in a first, partial run): the
   mutated policy finishes each go-live dispatched order correctly, then crashes on a later tick; the oracle fails those
   6 cases at layer 0, the contracts pass them. By design: arm errors are reported beside the contracts.
2. **Same-batch permanent failures (MR11-injected worlds only).** An F6 that is permanent from ordinal 2
   (`host/faults.mjs` H-23) fails items 2 *and* 3 of one reservation batch emission. The oracle rejects item 3's attempt
   (`outside-allowed`) although the arm could not yet know; the contracts do not count another item of the same
   emission as a retry. Seen on the reference policy itself (1162 d3 downstream world, o0008).
3. **Re-submitting a permanently failed item (MR11-injected worlds only).** B1L-H lineage 1 re-submits a reservation item
   that came back permanently failed, in a later emission (1232 d2 s12 downstream world, o0005). The oracle passes it;
   the `failure` contract rejects it (R5.2: "Do not retry a permanently failed step"). An oracle leniency.

Both 2 and 3 need an F6 on `inventory.reserve`, which the generator never schedules (d5's F6 is on `carrier.create`), so
they matter only for the downstream fault (§4). An earlier reading of mine, that the `action-required` notice is
required whenever the status was set, was wrong (S9 makes the notice moot when the customer acts first) and was fixed
after `c-oss` showed it.

## 4. Fault and drift harness

### 4.1 Faults (`faults.mjs`; any tick/1 arm; host, world and oracle unchanged)

| fault | how | measured |
|---|---|---|
| `restart` | the solver process is killed and a fresh one made before every 7th tick; the committed carry is intact | the journal's behaviour must equal the fault-free run (`defects.mjs behaviourDigest`) |
| `crash` | every 3rd tick with a side effect (no merge or close; ≤ 3 per instance) is "crashed after apply": its effects and human tasks go out, its carry rolls back to the input's, its timers are dropped, the process restarts, and its events are prepended to the instance's next tick (at-least-once redelivery) | exactly-once effects (every logical effect committed at most once), and the three signals |
| `dup-delayed` | MR5 world transform: placed orders and carrier reports repeated 7 min later, carriers repeating reports | the three signals (SPEC-E §3.1, §3.3: repeats change nothing) |
| `dup-same` | MR5: every world arrival also delivered in its own instant (later id), carriers repeating in-instant | the three signals; note the known contract gap (E8 README, MR5: two same-instant placements start two instances in one round). Diagnostic row, never pooled (2026-10-21, §4.2) |
| `downstream` | MR11 transform of straight orders: F6 on the charge after the reservations, on a reservation item, on the booking after the charge; a collection failure after the booking; customer cancels 1, 2, 3, 45 min in | compensation completeness against the independent planner, critical violations, the three signals |

### 4.2 Results: the scripted composed reference, the probe program and the monolith baselines

Dev worlds; `runs/faults-composed-reference.json`, `runs/probe-straight-saga-*.json`, `runs/faults-b1lh-e8-{1,2,3}.json`.
Cells: oracle passed / completed; `=` journal identical to the fault-free run; dup = logical effects committed twice
(money in brackets); comp = compensated fulfilments complete / due.

| subject | world | none | restart | crash | dup-delayed | dup-same | downstream |
|---|---|---|---|---|---|---|---|
| composed reference (in process) | 1161 d2 s40 | 43/43 | 43/43 = | 43/43 | 43/43 | 43/43 | 42/42, comp 31/31 |
| composed reference (in process) | 1162 d3 s40 | 44/44 | 44/44 = | 44/44 | 44/44 | 44/44 | 45/46, comp 37/37 |
| composed reference (in process) | 1164 d5 s60 | 69/69 | 69/69 = | 69/69 | 69/69 | 69/69 | 70/70, comp 47/47 |
| probe, stable keys (sandbox) | 1161 d2 s40 | 16/43; contracts 16/43 | 16/43 =; contracts 16/43 | 16/43; contracts 16/43 | — | — | — |
| probe, emission-time keys (sandbox) | 1161 d2 s40 | 16/43; contracts 16/43 | — | 14/43, dup 6 (6), crit 6; contracts 14/43 | — | — | — |
| B1L-H lineage 1 (monolith, sandbox) | 1232 d2 s12 | 14/14 | 14/14 = | 14/14 | 14/14 | 13/14; contracts 13/14 | 14/14, comp 9/9; contracts 13/14 |
| B1L-H lineage 1 (monolith, sandbox) | 1161 d2 s40 | 43/43 | 43/43 = | 43/43 | 43/43 | 35/43; contracts 33/43 | 40/42, comp 24/27; contracts 40/42 |
| B1L-H lineage 2 | 1232 d2 s12 | 11/14; contracts 11/14 | 11/14 =; contracts 11/14 | 11/14; contracts 11/14 | 11/14; contracts 11/14 | 10/14; contracts 10/14 | 11/14, comp 9/9; contracts 11/14 |
| B1L-H lineage 2 | 1161 d2 s40 | 40/43; contracts 40/43 | 40/43 =; contracts 40/43 | 39/43; contracts 39/43 | 40/43; contracts 40/43 | 32/43; contracts 30/43 | 39/42, comp 24/24; contracts 39/42 |
| B1L-H lineage 3 | 1232 d2 s12 | 14/14 | 14/14 = | 14/14 | 14/14 | 13/14; contracts 13/14 | 14/14, comp 9/9 |
| B1L-H lineage 3 | 1161 d2 s40 | 43/43 | 43/43 = | 43/43 | 43/43 | 35/43; contracts 33/43 | 42/42, comp 27/27 |

Injected: restart 49–99 and crash 52–93 per world for the composed reference; 52 restarts and 47 crashes for the probe
on 1161; 23–24 restarts and 22–27 crashes on 1232 s12 and 62–65 / 61–72 on 1161 for the B1L-H lineages. B1L-H
lineage 2 is the pre-repair build (its go-live gap costs 3 cases on 1232 s12, as in B1-E8-DEV.md); the probe program
handles straight orders only, so its pass counts are not a measure of anything.

**What it shows.** The composed reference (journal-driven, it keeps no state of its own) passes the oracle, every
contract and the interface under every fault, except the reference policy's own same-batch case (§3.3 item 2). The probe
program (a deliberately partial, carry-dependent composed program in the sandbox, `fixtures/straight-saga/`) shows the
crash fault catches what it should: with stable keys, 0 duplicates under 47 injected crashes; with a
key carrying the emission time (correct without faults), 6 logical effects committed twice, all money,
caught by exactly-once and by the oracle as critical. The monolith baselines are the comparison rows the composed arms
will meet (§7), and they already differ: every B1L-H lineage keeps exactly-once under every crash (deterministic keys)
and replays identically under restarts; lineage 2 loses one more case under crashes on 1161 (39/43 against 40/43); all
three lose cases when deliveries are duplicated in the same instant (1161: 35, 32 and 35 of 43; the twin instance of a
same-instant duplicate placement is never merged, E8's known MR5 gap); under downstream failures lineage 1 leaves 3 of
27 compensations incomplete on 1161 (40/42) while lineage 3 completes all (42/42); delayed duplicates cost nothing.

**dup-same is a diagnostic row** (note added 2026-10-21, compromise register B6). Read the dup-same cells as passes: on
1161 the monoliths pass 35, 32 and 35 of 43, so they lose 8–11 cases (8 each against their own fault-free runs), not
32–35 as the register first said. The loss comes from E8's known same-instant gap (MR5), which every arm meets, so the
row measures that gap rather than the arm. dup-same is reported beside dup-delayed and kept out of every pooled fault
or headline number. `fault-run.mjs` writes one row per world and fault and pools nothing; any pooled fault figure
built from its output excludes dup-same. The fix (keyed start: same-round starts grouped by key) changes SPEC-E, so it
needs an owner-approved version bump and reruns (compromises FIXES.md B6).

### 4.3 Mis-composed variants of the reference (`runs/variant-*.json`)

| variant | what is wrong | world, fault | oracle | contracts (failing) | compensation | interface violations | caught by |
|---|---|---|---|---|---|---|---|
| payment-compensates (strict) | compensation in the payment (saga) module; it refunds, nobody cancels shipments or releases stock; declared honestly | 1162 d3, none | 18/44 | 22/43 {"refund": "42/43", "reservation": "39/43", "compensation": "39/43", "failure": "37/43", "tracking": "40/43", "customer-action": "30/43", "cancellation": "40/43", "notifications": "37/43"} | 0/4 | 0  (dropped 0) | oracle, contracts, compensation |
| payment-compensates (strict) | compensation in the payment (saga) module; it refunds, nobody cancels shipments or releases stock; declared honestly | 1162 d3, downstream | 6/46 | 10/45 {"refund": "44/45", "reservation": "31/45", "compensation": "31/45", "failure": "31/45", "tracking": "40/45", "customer-action": "32/45", "cancellation": "36/45", "notifications": "31/45"} | 0/25 | 0  (dropped 0) | oracle, contracts, compensation |
| payment-compensates (strict) | compensation in the payment (saga) module; it refunds, nobody cancels shipments or releases stock; declared honestly | 1164 d5, none | 37/69 | 42/67 {"reservation": "59/67", "compensation": "59/67", "failure": "57/67", "tracking": "66/67", "customer-action": "53/67", "cancellation": "66/67", "notifications": "57/67"} | 0/14 | 0  (dropped 0) | oracle, contracts, compensation |
| payment-compensates (strict) | compensation in the payment (saga) module; it refunds, nobody cancels shipments or releases stock; declared honestly | 1164 d5, downstream | 17/70 | 22/68 {"reservation": "48/68", "compensation": "48/68", "failure": "46/68", "tracking": "63/68", "customer-action": "54/68", "cancellation": "58/68", "notifications": "46/68"} | 0/33 | 0  (dropped 0) | oracle, contracts, compensation |
| undeclared-write (strict) | the notify module sets the order `cancelled` itself (undeclared); the order module leaves it to it | 1162 d3, none | 36/44 | 35/43 {"fraud": "38/43", "cancellation": "40/43", "notifications": "35/43"} | 10/10 | 8 {"effect-undeclared": 8} (dropped 8) | oracle, contracts, interface |
| undeclared-write (strict) | the notify module sets the order `cancelled` itself (undeclared); the order module leaves it to it | 1164 d5, none | 55/69 | 53/67 {"fraud": "63/67", "customer-action": "58/67", "cancellation": "66/67", "notifications": "53/67"} | 19/19 | 14 {"effect-undeclared": 14} (dropped 14) | oracle, contracts, interface |
| undeclared-write (audit) | same, recorded but let through | 1162 d3, none | 44/44 | 43/43  | 10/10 | 8 {"effect-undeclared": 8} (dropped 0) | interface |
| undeclared-write (audit) | same, recorded but let through | 1164 d5, none | 69/69 | 67/67  | 19/19 | 14 {"effect-undeclared": 14} (dropped 0) | interface |
| parent-direct (strict) | the parent books shipments itself (undeclared parent effect) | 1162 d3, none | 17/44 | 16/43 {"shipment": "16/43"} | 7/7 | 75 {"parent-effect-undeclared": 75} (dropped 75) | oracle, contracts, interface |
| parent-direct (audit) | same, recorded but let through | 1162 d3, none | 44/44 | 43/43  | 10/10 | 59 {"parent-effect-undeclared": 59} (dropped 0) | interface |
| call-outside-graph | the notify module calls the compensation module (not in its calls) | 1162 d3, none | 44/44 | 43/43  | 10/10 | 8 {"call-undeclared": 8} (dropped 0) | interface |

Each mistake is caught by its own signal. The business-capability mistake (`payment-compensates`, with an honest
interface) is caught by the compensation contract and compensation completeness (0 complete), and by the oracle. The
interface mistakes are caught by the interface signal alone in audit mode (oracle and contracts pass: the behaviour is
equivalent). In strict mode the enforcement also turns them into business failures the oracle and contracts see.

### 4.4 Drift (`drift.mjs`, `drift-run.mjs`; `runs/drift-review-timeout-clears.json`)

**D1 `review-timeout-clears`** (rule R2.2, capability `fraud`): a fraud review with no usable answer by the deadline no
longer cancels the order; the shop accepts the risk and the order is cleared just after the deadline (S1: nothing that
follows may be done at the deadline itself), so R3.1 and R4.1 run from then. The drift is applied as one edit to a copy of
`transition.mjs` (loaded as `defects.mjs` loads mutants; the original is untouched), two edits to the arm-facing SPEC-E
text (R2.2's third bullet and S15's list of deciding rules), served by the host as `spec/SPEC-E.md` through
`driftedBinding`, a world change (up to four straight orders become reviews the analyst answers 25–30 h after the task,
past the 24 h deadline) and the contracts' reading (`rules.reviewTimeout = 'clear'`).

| world | changed cases | drifted reference: oracle / contracts (earliest, latest) | stale reference fails (oracle) | stale reference fails (contracts) | exactly the changed cases |
|---|---|---|---|---|---|
| 1165 d2 s30 | o0009, o0010, o0017, o0019 | 33/33 / 33/33, 33/33 / 33/33 | o0009, o0010, o0017, o0019 | o0009 fraud+reservation+tracking; o0010 fraud+reservation+tracking; o0017 fraud+reservation+tracking; o0019 fraud+reservation+tracking | True |
| 1166 d3 s30 | o0006, o0007, o0008, o0011 | 34/34 / 33/33, 34/34 / 33/33 | o0006, o0007, o0008, o0011 | o0006 fraud+reservation+tracking; o0007 fraud+reservation+tracking; o0008 fraud+reservation+tracking; o0011 fraud+reservation+tracking | True |


`patchLocality(before, after, { rule })` compares two program versions: the files and modules a rebuild or patch
changed, the modules that declare the rule (`rules` in the manifest), and whether the change stayed inside them (the
parent's wiring counted apart). It has no value until a paid patch or rebuild runs (§7.4).

## 5. The scripted composed reference (`reference.mjs`)

The E8 reference policy (`oracle/policy.mjs`) re-expressed as a parent plus sub-workflows under the runtime, every
module owning one family of logical effects and the timing of its own emissions: `intake` (order), `fraud` (order;
task), `order` (order statuses), `saga` (per fulfilment: reserve, charge, ship, processing / dispatched / completed),
`compensation` (per fulfilment: shipment cancel, refund, releases, failed / cancelled), `notify`. The parent binds the
case, merges, computes the expectation, calls the modules and sets the wake-up; it emits nothing. Like the reference
policy it reads the host journal and world truth, so it runs in process (trusted realm); the runtime and enforcement are
those of a bundled program. On 1161 d2, 1162 d3 and 1164 d5, both timings: the oracle and every contract pass on every
completed case, 0 interface violations, 0 trace-integrity findings. Two bugs the harness found in my first version, both
fixed: re-asked review tasks (the runtime namespaces task ids; the reference's "task already made" check used the raw
id), and duplicated work on same-instant duplicate placements (a stateful parent never merged the twin instance on a
later tick; the reference policy is stateless and does).

## 6. Seeds (research/jit-20261008/SEED-LEDGER.json)

| use | seeds | block |
|---|---|---|
| capability validation, fault harness, composed reference | E8 1161 (d2), 1162 (d3), 1163 (d4), 1164 (d5), sizes 24–60 | E-bed dev 1001–1199 (`ebed-dev`, allow jit-dev: "$0 controls … mutation suites") |
| drift validation | E8 1165 (d2), 1166 (d3), size 24–30 | E-bed dev |
| monolith fault baselines, dry runs, paired comparison world | E8 1232 d2 size 12 | `ebed-e8-rehearsal`, dev rehearsals 1232–1234 (the B1L-H grading worlds) |
| C-H / C-H-T build loop (practice) | E8 1235–1237 (d2, d3, d5) | `ebed-e8-rehearsal`, the B1 build-loop practice worlds |
| C-H / C-H-T grading | E8 1232–1234 × d2, d3, d5, and 1232 d2 size 12 | `ebed-e8-rehearsal` dev rehearsals |

No held-out (9101–9104) or sealed (9201–9204) seed is used or read; `fault-run.mjs`, `drift-run.mjs` and `build.mjs`
refuse anything outside the blocks above. The tests use 1161, 1162, 1164 and 1165 at sizes 12–30.

## 7. Builder side: arms C-H and C-H-T (`build.mjs`, `smoke.mjs`, `kit/`, `builder/`)

### 7.1 Conditions (identical to B1L-H, `research/enterprise-20261014/B1-E8-DEV.md`)

Model `claude-haiku-5-5` (policy file), effort high, one sandboxed `claude -p` session, cap $3 and 40 min, the smoke loop
on practice worlds 1235–1237 (no grading), the same SPEC-E, CONTRACT.md (`experiments/ebed/build.mjs contractText`,
imported) and API schemas; graded on 1232–1234 × d2, d3, d5 and on the paired world 1232 d2 size 12. Added for both
composed arms: `COMPOSE.md`, the kit (`compose-kit/`: `compose.mjs check|test`, `kit.mjs moduleHarness` for contract
tests, and the runtime and loader themselves, which contain no world, oracle or grading), and a TASK.md that asks for
the composed program and one contract-test file per module. The smoke report adds program problems and the interface
violations the runtime recorded. C-H-T adds `templates/` (§7.2).

### 7.2 Templates for C-H-T

`builder/templates/`: `DECOMPOSITION.md` (five sub-workflows — intake, screening and waiting per order, fulfilment per
fulfilment, order lifecycle per order — the rules each owns, interfaces, call graph, a rule-to-module checklist,
pitfalls), a complete `composition.json` with schemas, and skeleton files (signatures and comments, no logic). Written
by the harness author (Opus 5.5) citing SPEC-E sections only. **Caveat:** the author had read the oracle's
`transition.mjs` earlier in the same session, so independence from the oracle is not guaranteed. For a clean C-H-T,
`author-templates.mjs` runs a fresh frontier session that sees only SPEC-E, COMPOSE.md and the API schemas, and
`build.mjs --templates <dir>` uses its output (§7.4).

### 7.3 Dry runs ($0)

`build.mjs --dry-run` replaces the session with a scripted stub builder that writes the probe program with one contract
test per module, runs `compose.mjs check`, and asks for one smoke run through the mailbox; then the pipeline continues as
for a paid build. C-H (`runs/dry-ch-stub/`) and C-H-T (`runs/dry-cht-stub/`): check OK, one smoke run (practice worlds
1235–1237: complete, 0 arm errors, 0 interface violations, calls per module listed), module contract tests 3/3 pass in
the sandbox, paired world 6/14 (the probe handles straight orders only, as designed), result.json written.

### 7.4 The paid commands (not run)

```sh
# C-H, three lineages (B1L-H had K = 3)
for k in 1 2 3; do node experiments/compose/build.mjs --arm C-H --model claude-haiku-5-5 --effort high --budget 3 --minutes 40 --label ch-e8-$k; done
# optional, before C-H-T: clean-room templates from a fresh frontier session (cap $5)
node experiments/compose/author-templates.mjs --model claude-opus-5-5 --effort high --budget 5 --minutes 45 --label tpl-opus-1
# C-H-T, three lineages (add --templates research/composition-20261021/runs/tpl-opus-1/templates for the clean-room set)
for k in 1 2 3; do node experiments/compose/build.mjs --arm C-H-T --model claude-haiku-5-5 --effort high --budget 3 --minutes 40 --label cht-e8-$k; done
# then, $0 for each built program (runs/<label>/program):
node experiments/compose/fault-run.mjs --subject program:research/composition-20261021/runs/ch-e8-1/program --worlds 1232:2:12,1161:2:40 --out research/composition-20261021/runs/faults-ch-e8-1.json
node experiments/compose/drift-run.mjs --subject program:research/composition-20261021/runs/ch-e8-1/program --worlds 1165:2:30,1166:3:30
```

**Cost estimate.** B1L-H's three builds cost $0.39, $0.62 and $0.53 (mean $0.51; 37–71 turns, 19–24 min, 4–10 smoke
runs). A composed build reads more (COMPOSE.md about 2.5K tokens; C-H-T's templates about 6K more) and writes more files
(a manifest, five or so modules, their tests), so I expect 1.5–3× a B1L-H build: about $0.75–1.50 per build, $4.50–9 for
K = 3 per arm, at most $18 at the $3 caps. The clean-room templates: one frontier session, expected $1–3, cap $5.
Grading, faults and drift: $0. Drift patch sessions are a later row (B1N-H's repairs cost $0.05–0.11 each).

## 8. Known limits, and what blocks a fair comparison

- **The vm boundary is not a security boundary.** A builder that deliberately escapes its context (prototype tricks)
  could forge attribution inside the bundle; the OS sandbox still contains the process, the static scan rejects imports,
  `require`, `process`, `globalThis`, `eval` and `Function`, and the journal re-verification catches any effect outside
  its claimed owner's kinds. An adversarial builder would need a separate process per module.
- **Templates' independence** (§7.2): use the clean-room set for the comparison that counts.
- **Paired world power.** 1232 d2 size 12 has 14 completed cases; as AGENTV-E8-PREREG computed, only ≥ 6 discordant
  pairs all one way reach p < 0.05. The full-world grading (1,022 completed cases over 9 worlds) is the main measure;
  K ≥ 3 lineages per arm, as for B1L-H.
- **Extra work in the same budget.** The composed arms must also write a manifest and contract tests within B1L-H's $3
  and 40 min; that is the condition asked for (same budgets), and it favours the monolith on cost and time.
- **Machine load.** The 40-minute cap is wall time, and the smoke service shares the machine: on a loaded machine a
  composed builder gets fewer smoke runs than B1L-H did. Run the paid builds on a quiet machine, or record smoke latency
  (it is journaled per request in `smoke.jsonl`).
- **Strict mode costs cases.** A dropped undeclared effect is a business failure for the oracle. That is the enforcement
  asked for; `--mode audit` re-grading at $0 separates interface honesty from its business consequence.
- **The scripted composed reference is analyst-side** (journal-driven, trusted realm), so it validates the harness, not
  the claim that a cheap builder can write a sandboxed composed E8 solver. The sandboxed probe program covers only straight
  orders. No complete arm-side composed E8 solver exists yet; the first paid C-H build is the first. *2026-10-21:*
  superseded. ch-e8-1 passes 974/1,022 and ch-e8-2 955/1,022, both with 0 interface violations (`runs/ch-e8-*/result.json`;
  compromise register E4).
- **Downstream worlds use MR11's F6 on reservations**, which the generator never produces; the oracle has two findings
  there (§3.3); compensation completeness is judged by the planner either way.
- **Duplicate delivery in the same instant** meets E8's known contract gap (two instances in one round). Report
  `dup-same` beside `dup-delayed`, not pooled. *2026-10-21:* `dup-same` is labelled a diagnostic row and excluded
  from pooled numbers (§4.2); the monoliths lose 8–11 of 43 there, not 32–35 (compromise register B6).
- **Drift D1 touches one rule.** Whether a builder's patch is local depends on its own boundaries; the measure needs a
  paid patch or rebuild session under the drifted spec (practice worlds served the drifted spec), which is not wired
  into `build.mjs` yet: `drift-run.mjs` grades any program under the drift at $0, and `patchLocality` compares versions.
- **Dev evidence only.** Sealed worlds are not touched; nothing here is held-out evidence.

## 9. Files

| file | what |
|---|---|
| `experiments/compose/runtime.mjs` | the composition runtime: manifest checks, portable-subset validation, enforcement, namespaced routing, trace; `kindsOfE8` |
| `experiments/compose/loader.mjs` | vm-context loading of builder modules, static scan, JSON-string bridge |
| `experiments/compose/bundle.mjs` | program reading, problems (manifest, scan, syntax: parsed, never run host-side), the bundled solver.mjs |
| `experiments/compose/trace.mjs` | interface report from the journal, re-verified against the trusted manifest |
| `experiments/compose/capabilities.mjs` | the 13 capability contracts, compensation ledger |
| `experiments/compose/validate.mjs` | contracts vs the oracle: references, controls, killed mutants |
| `experiments/compose/faults.mjs`, `fault-run.mjs` | crash / restart wrappers, faulted worlds, exactly-once, the fault runner |
| `experiments/compose/drift.mjs`, `drift-run.mjs` | drift D1 (spec, transition copy, world, rules), patch locality, the drift runner |
| `experiments/compose/reference.mjs`, `run.mjs` | the scripted composed reference and variants; running and assessing arms |
| `experiments/compose/fixtures/straight-saga/` | the sandboxed carry-dependent probe program (and the dry run's stub output) |
| `experiments/compose/build.mjs`, `smoke.mjs`, `author-templates.mjs` | arms C-H and C-H-T: workspace, session or stub, smoke loop, grading, module tests; clean-room templates |
| `experiments/compose/builder/COMPOSE.md`, `builder/templates/`, `kit/` | builder-facing interface text, C-H-T templates, the builder's kit |
| `experiments/compose/test/*.test.mjs` | runtime, capabilities, reference, faults and drift, builder side |
| `research/composition-20261021/runs/` | validation, fault, variant, probe, drift and dry-run results |
