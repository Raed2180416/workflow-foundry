# RESULT: the run data behind a live node graph (node-graph-ui, F1), 2026-11-04

*Item "node-graph-ui" of workflow wf_6d3b90c9-c30 (task #88). Branch `worktree-wf_6d3b90c9-c30-8`. $0: no model call, no
network beyond 127.0.0.1. Development and held-out evidence are labelled. The plan this followed: [DOSSIER.md](DOSSIER.md);
the frozen held-out look: [PREREG.md](PREREG.md); raw numbers: [results/](results/).*

## 0. Bottom line

1. **Scope changed by the owner's decision D33** (recorded 13:15Z today, after the plan): the visualisation engine and
   its UI/UX are the owner's; our part is the engine plus the read-only data a visualisation needs. So this item built
   **the data and the routes**, not the dashboard graph, dots or drawer. No UI file was changed. §1 says what that
   dropped from the plan and what replaced the browser evaluation.
2. **Built** (all new files except a narrow hook in `app/dashboard/server.mjs`):
   - `app/core/run-graph.mjs`: one typed document per run (`foundry-run-graph/1`) with five user states and motion
     hints, the folded and ranked graph, per-step cost, the failing step and why, what to do, one-line summaries, and a
     per-node detail record (`foundry-run-node/1`);
   - `app/core/human-tasks.mjs`: one list of everything waiting for a person, questions included (before this, a
     question from a `human` node could not be answered anywhere in the app), and the answer and decide paths;
   - `app/dashboard/live.mjs`: the routes, including a live stream over `fetch` with the token in a header.
3. **Capability against the simple baselines, at every committed moment of every run, against an oracle read from
   the runtime's own records** (checkpoint snapshots and the model-call journal):

   | question (held-out, 300 runs, 8,582 moments) | **T (this work)** | B1 run-view prototype | B0 dashboard today |
   |---|---|---|---|
   | each step's state, where it matters (working, needs you, problem) | **100%** (14,253) | 98.2% | not in its data |
   | what the run is doing | **100%** (8,582) | 97.2% | 100% |
   | what waits for me, every item listed | **100%** (3,641) | 100% | **2.6%** |
   | nothing listed when nothing waits | **100%** (5,708) | 97.1% | 100% |
   | the failing step, the exact item and code | **100%** (128) | 57.8% | 48.4% |
   | what each step that spent money cost (journal, 1e-9) | **100%** (505) | 100% | not in its data |
   | the one-line summary names the failing step and a cost | **100%** (300) | no summary | 0% |

   Controls: C+ (the oracle) 100% on every question; C- (T blanked) 0% on step state, waiting, cause and cost. The look
   is valid and all three preregistered claims hold (H1 T >= 99% on every question; H2 T - B1 = +42.2 points on the
   failing item; H3 T - B0 = +97.4 on waiting items and +51.6 on the failing item). Development (13 named + 200 random
   runs, 5,135 moments) gave the same picture: T 100% everywhere.
4. **What it means, honestly.** T reaches 100% partly by construction: its semantics and the oracle's were written by
   the same author, and the development loop fixed T until it matched. What is independent is the **source**: T reads
   the event chain, the oracle reads checkpoint rows and the journal. The held-out seeds were never run before the
   freeze, but they come from the same generator (held-out by seed, not by author). The gains over B1 are a handful of
   specific semantic fixes (§5), not a new reducer; B1's reducer is reused.
5. **Persona tasks over HTTP** (scripted client, $0): T completes **9/9** tasks, B0 **5/9** (it cannot answer a question,
   cannot see questions in a map, cannot give a step's cost, names the map not the failing item), with the same number
   of requests (11 vs 10). **Watching one live 50-item run:** T sends about 6.7 times fewer bytes than the prototype's
   event stream (18 KB vs 123 KB, §4.4), and the token never appears in a URL.
6. **Root-caused defects** (the prototype's reading and the app's inbox, §5) and **runtime findings** (§6): the
   `approval.decided` event carries no node key (call it record gap **G5**); `answer()`/`approve()` mark a run `ready`
   under a live owner; a crash can leave a paid, journaled call that the chain never shows.
7. **Not done** (§7): no UI, no Playwright persona/accessibility/screenshots (D33, and the disk was below the 1.2 GB line
   all session), no paid persona agents ($0 budget), no sealed fixtures by a separate author, no CLI/MCP answer route.

## 1. Why the scope changed, and what replaced the planned evaluation

D33 (`research/decisions-20261021.md`, owner, 2026-11-04): *"We expose visualisations of the workflows the system
creates; we do not build a visual editor ... The visualisation engine and its UI/UX are the owner's own work. Our job
is a flawless core engine ... plus the read-only data a visualisation needs."* The plan's S1 (graph rendering, dots,
pause control) and the rendering half of S3 (the drawer) are exactly that UI/UX, so they were not built. Building them
anyway would have produced a second visualisation beside the owner's, with its own words and states, to be thrown away
or merged against his.

What the owner's visualisation needs from us, and what was measured instead of a persona study in a browser:

- **Correctness of every field a visualisation shows**, at every moment of a live run, against the runtime's own
  records. This is the property no UI can add later: a dot that breathes for a dead process, or a "needs you" that
  cannot be answered, is wrong whatever the UI looks like.
- **Whether each persona task can be done from the data alone** (the plan's T1-T6), counted in requests and bytes.
- **The cost of watching a live run** (efficiency is core).

The Playwright persona agent, the keyboard and contrast checks and the screenshots belong to the owner's UI. The
Haiku/Mercury persona agents were also out of a $0 budget. Disk was 873 MB free at the start and 643 MB late in the
session (the line is 1.2 GB), so no browser run was attempted.

## 2. What was built

| file | what it holds |
|---|---|
| `app/core/run-graph.mjs` | `runGraph()` → `foundry-run-graph/1`; `nodeDetail()` → `foundry-run-node/1`; `userState`, `runUserState`, `failingOf`, `remedyOf`, `oneLine`, `fence`, `nodeCheckText`, `checkpointStatuses` |
| `app/core/human-tasks.mjs` | `listHumanTasks`, `tasksOfRun`, `answerQuestion`, `decideApproval`, `settleResumes` |
| `app/dashboard/live.mjs` | `liveRoutes(app)`: `GET /api/runs/:id/graph`, `/graph/stream`, `/node?key=`, `/calls/:journalId`, `/output/:seq`, `GET /api/history`, `GET /api/tasks`, `POST /api/tasks/answer`, `POST /api/tasks/decide` |
| `app/dashboard/server.mjs` | three lines: build `liveRoutes(app)`, try it after the token check, close its streams on close |
| `app/eval/run-graph/` | scenarios (S1-S15, seeded random generator), harness (recorder, oracle, arms, scorer), 12 code mutants, `measure.mjs`, `persona-api.mjs`, `stream-cost.mjs`, `explain-misses.mjs`, `crash-child.mjs` |
| `app/test/` | `run-graph.test.mjs` (13), `human-tasks.test.mjs` (6), `live-routes.test.mjs` (5), `run-graph-helpers.mjs` |

**Five user states** (`USER_STATES`): Not running (ring), Working (dot, breathes about 3.5 s), Needs you (ask, pulses
about 1.2 s), Problem (cross, still), Done (check, still and quiet). Each carries the detailed state behind it (the
reducer's 16 plus `stalled`, `checkdisagreed`, `refused`), its words, a glyph, a tone and a motion hint. Nothing moves
unless a live process is running the run; a timer wait is still. "Done" never says verified (`independentlyVerified:
false` on every run). These are hints for the owner's UI, which may honour or ignore them.

**The graph**: the IR folded by `tools/run-view` `buildSemantic` (level 0 by default: at most 24 cards) and ranked by
`layoutRanks`; each card has `rank`/`order` for layout, its members, its state, a one-line note built from typed fields,
progress for maps and loops, cost (calls, tokens, USD, models, journal ids) and what in it waits for a person.

**The failing step**: the deepest failed or uncertain instance, earliest first, not the map or loop that contains it;
CANCELLED siblings and refused actions are never "the cause". The check is named in words when the record names it
(`NODE_CHECK_FAILED: check 0 failed`, `model.resampled.reason`); after an escalation it is not in the record, and the
document says so (gap G2) instead of guessing. Acceptance failures name the failed definition-of-done check, evaluated
on the stored outputs. "What to do" comes from the code's class (environment fault, budget, check, exhausted, policy,
integrity, uncertain) and from the engine's own remedy when its verdict carries one (engine v2 patch 0005).

**Cost**: from the model-call journal when the caller has it and it holds every call the chain names, else from the
chain. A journal row without a chain event (the process died right after the call) is counted and flagged
(`unrecordedCalls`).

**Untrusted text** (`fence`): invisible and bidi characters made visible, runs of blank lines collapsed into a visible
`⟦N more blank lines⟧`, long space runs likewise, capped with `chars`, `clippedChars` and counts, `trust: 'untrusted'`.

**Human tasks**: questions from every open run (`store.openRunIds`, not the 100 most recent) and every frame (map
items and loop iterations), with a `tools/ui` form spec compiled from the `answerSchema`; approvals with engine facts
first (tool, effect class, risk, argument names, the chain's `argsHash` and whether the record still matches it,
whether untrusted data shaped the arguments) and every argument fenced. Answers and decisions come only from a human
channel (`dashboard`, `cli`, `mcp-elicitation`); an answer is bound to the hash of the `human.requested` event the person
was shown (`STALE_TASK` otherwise), validated by the host (`validateAnswer`) and again by the engine, and passes
`{ actor, channel }` to `runtime.answer` (ignored today, recorded once engine v2 patch 0010 merges). A decision on a
run that a live process still executes is taken; the run continues by itself, and if that process parks the run
without it, it is resumed as soon as no live process holds it (never two executions).

**The stream**: `text/event-stream` read with `fetch` (so the token stays in the `x-foundry-token` header; EventSource
cannot send one). A `snapshot` (the whole document) on every connect, then `patch` messages (changed cards, run,
summary, waiting) with `fromSeq`/`toSeq` so a client sees a gap, coalesced to at most one per 250 ms; `integrity` when a
row stops verifying (checked per row: sequence, previous hash, digest); `end` after the terminal event. A heartbeat
re-checks the owner process, so a run whose process died turns "stalled" without any new event.

## 3. Evaluation design

**Recording.** Each scenario runs the real runtime (`src/runtime.mjs`, `src/store.mjs`, ModelPort with a scripted
provider, the journal) in a temp workspace. `store.updateRun` is wrapped so a checkpoint snapshot is kept after every
committed update; the event prefix at that moment is the chain up to the snapshot's head. S13 kills its process with
the runtime's own fault injection (`extra.crashAfterModel`, SIGKILL after the journal row commits).

**Oracle** (`harness.mjs` `truthAt`, from checkpoint rows and the journal only): step state from row status
(completed verify with `pass: false` is a problem; CANCELLED and refused rows are not running; rows of a stopped run
are not running; `running` under a dead owner is a problem; a container that is working shows its most urgent part);
run state from status and owner liveness; the waiting set from `awaiting_*` rows of a run that has not stopped; the
failing leaves and codes; per-step cost from journal rows under the step's key.

**Arms.** T; B1 = the prototype's reducer with its 16 states read as 5 (`checkfailed` read as working, as the
prototype animates it), no owner check, the first red card as "the cause"; B0 = what `app/dashboard` serves today
(status words, `explainRun.failedStep` from top-level rows, inbox approvals of runs whose status is
`awaiting_approval`); C+ and C- as controls.

**Scenarios.** Named S1-S15 (failure after escalation, a named check, approval with hostile text, a typed question,
costs with an escalation, a 50-item live map, nothing waiting, a failure three levels down, acceptance failure,
questions inside map items, a refusal, an uncertain effect, a provider fault, a dead process, a decision while another
branch runs) and seeded random workflows of 3-8 nodes mixing agent, task, human, approval-gated send, wait, map (with
an agent or a human inside), loop and verify, with seeded model outcomes (ok, failed check, bad format, rate limit,
outage, slow) and a seeded person who answers, approves or refuses.

## 4. Results

### 4.1 Development (named S1-S15 + seeds 0-199; `results/dev.json`)

216 runs (59 succeeded, 95 failed, 14 cancelled, 26 waiting on a timer, 19 on a question, 1 on an approval, 1
uncertain, 1 stalled), 5,493 events, 5,135 moments. T 100% on every question (state 28,353; stateLive 8,145; run
5,135; wait 5,135; waitMissed 1,675; failDeep 96; cost 318; line 216). B1: stateLive 96.9%, run 97.7%, wait 97.7%,
failDeep 60.4%, cost 99.7% (the S13 journaled call). B0: waitMissed 3.6%, failDeep 51.0%, line 0%.

### 4.2 Held-out (seeds 100000-100299, run once after the PREREG commit `afae2987`; `results/heldout.json`)

300 runs (100 succeeded, 128 failed, 22 cancelled, 33 waiting on a timer, 17 on a question), 9,109 events, 8,582
moments, 207 s wall at load 11-13.

| question | T | B1 | B0 | C+ | C- |
|---|---|---|---|---|---|
| state (all steps) | 100% (49,448) | 99.3% | n/a | 100% | 24.0% |
| stateLive | 100% (14,253) | 98.2% | n/a | 100% | 0% |
| run | 100% (8,582) | 97.2% | 100% | 100% | 1.2% |
| wait (exact set) | 100% (8,582) | 97.9% | 67.2% | 100% | 66.5% |
| waitFalseAlarm | 100% (5,708) | 97.1% | 100% | 100% | 100% |
| waitMissed | 100% (3,641) | 100% | 2.6% | 100% | 0% |
| fail (top-level step) | 100% (128) | 100% | 83.6% | 100% | 0% |
| failDeep (item and code) | 100% (128) | 57.8% | 48.4% | 100% | 0% |
| cost (steps that spent) | 100% (505) | 100% | n/a | 100% | 0% |
| costAll | 100% (1,671) | 100% | n/a | 100% | 69.8% |
| line | 100% (300) | n/a | 0% | 100% | 0% |

Decision rule: valid (C+ 100%, C- 0% on stateLive, waitMissed, fail, cost); H1 met; H2 met (+42.2 points failDeep, T >=
B1 elsewhere); H3 met (+97.4 waitMissed, +51.6 failDeep). Deviation: the frozen command line lacked `--mutants`, which
rule 5 needs; it was added. Mutant arms are scored independently and change no other arm's numbers.

### 4.3 Mutation (12 planted defects in `run-graph.mjs`, `mutants.mjs`)

Development (named + 200 seeds): **11 of 12 killed**; the survivor, m8 (cancelled siblings counted as a cause), is
equivalent under today's runtime: a CANCELLED step always ends after the step that stopped the run, and the cause is
the earliest-ended leaf (listed in `EQUIVALENT` with that reason; the test fails if any other mutant survives).
Held-out (random seeds only): 9 of 12 killed; m2 (stall detection) and m6 (`ready` under a live owner) need a dead
process or a decision while another branch runs, which only the named S13, S14 and S15 produce. The random generator
covers neither: a gap in it, reported rather than patched after the look.

### 4.4 Persona tasks over HTTP and the cost of watching (`results/persona-api.json`, `results/stream-cost.json`)

The plan's persona tasks, done by a scripted HTTP client against one workspace, each answer checked against the store
and journal (`persona-api.mjs`; development evidence, one run of each task):

| task | B0 (routes before this work) | T (routes added here) |
|---|---|---|
| T1 why did S1b fail (a named check) | ok, 1 request | ok, 1 request ("Grade" / NODE_CHECK_FAILED) |
| T1 why did S7 fail (an item in a map) | **fails**: names the map "Check each invoice" | ok: "Read", the item step |
| T1 why did S12 fail (provider fault) | ok, 1 request | ok, 1 request |
| T3 what did step A cost (escalated) | **fails**: run total only ($0.0141) | ok: $0.0115, equal to the journal |
| T5 which recent run failed and why, from the list | ok ("Stopped with code MODEL_RATE_LIMIT.") | ok, with the step and the cause in words |
| T6a nothing waits: say no | ok | ok |
| T6b two questions wait inside a map: say 2 | **fails**: says 0 | ok |
| T4 answer the question | **fails**: no route exists | ok, 2 requests, run finishes |
| T2 approve the waiting send | ok, 2 requests | ok, 2 requests |
| **total** | **5 of 9**, 10 requests, 31.2 KB | **9 of 9**, 11 requests, 34.6 KB |

Watching one live run of a 50-item map (311 events, `stream-cost.mjs`, two runs at load 13 and 21):

| | messages | bytes | terminal event to arrival | per-step states | token |
|---|---|---|---|---|---|
| T: folded snapshot + coalesced patches | 9 | 17.9 KB / 18.4 KB | 12 ms / 38 ms | yes | header |
| B1: every event, slim (`tools/run-view/serve.mjs`) | 12 / 13 | 122.7 KB | 32 ms / 36 ms | yes, folded in the page | URL query |
| B0: overview poll every 5 s + one run detail | 2 requests | 27.2 KB | up to 5 s | no | header |

T carries about 6.7 times fewer bytes than the prototype's stream for the same run; the delays are within the
machine's noise (two runs, shared load), so no latency claim is made.

## 5. Every miss, root-caused (held-out, `results/heldout-misses.json`)

T has none. The baselines' misses, by cause (counts are step-moments, items or runs as labelled):

**B1, the prototype's reading of the chain**
1. *An approved action still shows "needs you"* (172 step-moments, and 172 false "waiting" items). Cause: the runtime's
   `approval.decided` event has no `nodeKey` (`src/runtime.mjs:336`, `approve()`: `{ type: 'approval.decided', approvalId,
   approved, actor }`), and the reducer ignores events without one. Fix in T: the folder maps `approvalId → nodeKey`
   from `approval.requested` and attributes the decision (`derivedNodeKey: true`). Engine fix proposed: add `nodeKey`
   (record gap **G5**).
2. *A refused action still shows "needs you"* (22 step-moments, after the run was cancelled). Same cause; T shows it as
   "You said no; it did not run" (Not running).
3. *An independent check that disagreed shows as still working* (86 step-moments). Cause: the reducer gives a completed
   verify with `pass: false` the active `checkfailed` state (amber, fast animation), the same one it uses while a step
   is resampling. T: `checkdisagreed`, a still Problem, with "It did not stop the run".
4. *A stopped run keeps steps waiting or working* (71 step-moments, 24 waiting items after the stop). Cause: the
   reducer closes only `running` steps when the run ends; a question, approval or timer wait stays open. T: every
   such step of a stopped run (including `uncertain`) is Not running, and nothing is listed as waiting.
5. *The cause is the map, not the failing item* (54 of 128 failed runs). Cause: the prototype has no cause, only red
   cards; the first red top-level card is the container. T names the deepest failed instance.

**B0, the dashboard today**
1. *Questions are not listed* (2,304 item-moments): `FoundryApp.inbox()` lists approvals only; no route answers a
   question.
2. *Approvals are not listed while the run is still running or ready* (1,241 item-moments): the inbox reads runs whose
   status is `awaiting_approval`, which a run reaches only when every other branch has stopped.
3. *Older runs are not listed*: the inbox reads `store.runs()`, the 100 most recent (`human-tasks.test.mjs` shows a
   waiting run behind 101 newer ones; not in the scored scenarios).
4. *The failing step*: the map instead of the item (45 runs), or a step that another failure stopped (CANCELLED, 21
   runs; `explainRun` takes the first failed top-level row with the run's code).
5. *Hostile approval text*: the inbox preview passes the first 600 characters raw; in S2 the payload sits 400 lines
   below the first and the bidi override and zero-width space pass through (`human-tasks.test.mjs`).

**Development-loop defects in T, found by the differential oracle and fixed before the freeze** (all in this branch's
history): the approval attribution (S10), a stopped run keeping a question pulsing (seeds 8, 13, 20, 22, 25, 30, 38),
the combine order dropping `refused` (S10 card), the uncertain-effect remedy (S11), the check words for `output.*` refs
(S1b), the stalled run (S13), the S13 journaled call missing from cost, and `ready` under a live owner (S14).
Two oracle rules were corrected in development (refused and CANCELLED rows are not running; a stopped run has nothing
waiting) and frozen with the rest.

## 6. Runtime findings (for the engine, not fixed here)

1. **G5: `approval.decided` has no `nodeKey`.** Any reader of the chain must keep its own `approvalId` map. One field.
2. **`answer()` and `approve()` set `run.status = 'ready'` under a live owner.** Probe (`human-tasks.test.mjs` "an answer
   given while another branch still runs", S14, S15): the running process picks the decision up itself and the run
   succeeds, so nothing is lost; but a reader sees "created, not started" for a running run (B0 and B1 both show it).
   By reading `src/runtime.mjs:695-709`: the final parked status is computed from the rows before the final
   compare-and-swap, so a decision that lands between the two would leave the run parked with nothing pending. Not
   reproduced (the window is a few statements); `human-tasks.mjs` covers it by resuming a run that has no live owner.
3. **A journaled call can be missing from the chain after a crash** (S13: `crashAfterModel`). By design ("the journal
   row is committed, the run is not"); the chain alone under-reports spend until the run is resumed. The graph reads the
   journal and says so.
4. **G2 stands**: after an escalation for a failed check, neither `model.escalated` nor `MODEL_ESCALATION_EXHAUSTED`'s
   message names the check (`errorData` drops `details.lastError`). One field would close it.

## 7. Not done, and limits

- **No UI** (D33). The dossier's S1 and the drawer rendering, the "Pause motion" control, the keyboard, contrast and
  screen-reader checks and the screenshots belong to the owner's visualisation. The data carries what those need
  (states with glyphs and labels, motion hints that are off unless something is running, words for every state).
- **No persona agent** (Haiku 5.5 or Mercury 3): $0 budget, and no UI to drive. The persona tasks were done by a
  scripted HTTP client; that measures whether the data suffices, not whether a person understands it.
- **Not independent of the author.** Generator, oracle and T share an author; held-out is by seed. The oracle reads
  other records than T, which is the independence that exists.
- **Scenarios are scripted.** Model outcomes are seeded; real-model runs (and the 18 event types that occur in
  recorded runs) were not replayed through T here. `tools/run-view`'s own fold-equals-checkpoint test still passes
  (its reducer is unchanged).
- **Disk** stayed below the 1.2 GB line (873 MB → 643 MB, shared by about 10 workflows). Every step here was light
  (a sparse checkout of 19 MB, temp workspaces deleted per run, results 0.4 MB), and no browser was started.
- **Merge**: new files, plus three lines in `app/dashboard/server.mjs` (the onboarding branch also edits it; the hook
  sits after the token check and before the first route). `service.mjs` is untouched. Engine v2's `answer(..., {actor,
  channel})` is already passed.
- **Not built**: an answer route in `app/cli.mjs` and the MCP server (the channels exist; the routes do not).

## 8. Reproduce

```text
nice -n 15 node --test --test-concurrency=1 app/test/run-graph.test.mjs      # 13 tests, ~60 s
nice -n 15 node --test --test-concurrency=1 app/test/human-tasks.test.mjs    # 6 tests
nice -n 15 node --test --test-concurrency=1 app/test/live-routes.test.mjs    # 5 tests
node app/eval/run-graph/measure.mjs --split dev --seeds 0-199 --mutants --out results/dev.json
node app/eval/run-graph/measure.mjs --split heldout --seeds 100000-100299 --no-named --mutants --out results/heldout.json
node app/eval/run-graph/explain-misses.mjs --seeds 100000-100299 --out results/heldout-misses.json
node app/eval/run-graph/persona-api.mjs --out results/persona-api.json
node app/eval/run-graph/stream-cost.mjs --items 50 --out results/stream-cost.json
```

## 9. For the owner's visualisation

Read `GET /api/runs/:id/graph` once, then `GET /api/runs/:id/graph/stream` with `fetch` and the header; replace cards
by id from each `patch`; reconnect on a gap. Show `run.words` and `summary.oneLine` first, `waiting` as the one place to
act (`GET /api/tasks`, `POST /api/tasks/answer|decide`), and the graph below them. Lead an approval with `facts`; show
`arguments[].value.text` only inside an untrusted frame, with its counts.
