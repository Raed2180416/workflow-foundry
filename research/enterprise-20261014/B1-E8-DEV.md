# B1 on E8: build once from the spec (dev rehearsal, declared before it runs)

*2026-10-14. Development evidence on dev seeds, not a claim (PROOF-LEDGER status P-dev at most). Declared before any
build session runs; anything decided after the first result is labelled as such.*

## Question

Can a model, given only E8's spec (`beds/ebed/e8/spec/SPEC-E.md`), the system API schemas and the tick contract, write a
`tick/1` solver that the independent oracle passes on completed tail-mix cases? Haiku 5.5 (B1-H) is the owner's
question ("can Haiku 5.5 build these nodes, or do we need a fine-tuned model?"); Opus 5.5 (B1-O) is the frontier
comparison under the same conditions.

## Arms and conditions

| arm | builder | effort | session cap | wall cap |
|---|---|---|---|---|
| B1-H | `claude-haiku-5-5` | high | $3 | 40 min |
| B1-O | `claude-opus-5-5` | high | $15 | 60 min |

- One `claude -p` session per arm in the executor sandbox (`src/executors/claude-code.mjs`), tools Bash, Read, Write,
  Edit, Glob, Grep; the workdir holds SPEC-E.md, CONTRACT.md (contract §3.1–§3.4 and the host's arm interface),
  `api/*.schema.json` and TASK.md, nothing else (`experiments/ebed/build.mjs` `buildFiles`). No world, generator, oracle,
  fixture, trace, score service or smoke runner. One build per arm, no revision.
- The solver runs out of process in the arm sandbox (`beds/ebed/host/sandbox-arm.mjs`), call timeout 20 s, on the
  `temporal-like` profile, through the real host.
- Seeds: E-bed dev rehearsal block 1232–1234 (E-BED §6: dev rehearsals), difficulties 2, 3 and 5, tail mix: 9 worlds
  per arm. Pools from the two reference runs of each world (contract §6).

## Measures (all $0 after the build)

- Completed tail-mix case pass rate per world and pooled (Clopper-Pearson 95% interval), by class; first-divergence
  layer and code; critical violations; arm errors (invalid output, crash, timeout).
- Build cost (the session's reported cost), turns, wall time.
- Reported beside: the three blind specificity solvers (`beds/ebed/e8/specificity/`, Opus agents that had a smoke runner
  and several revision rounds), which are not B1 (different conditions) and only bound what the spec allows.

## Reading (declared now)

- This is dev evidence with one build per arm (K = 1): it says what one build did, not what the builder does.
- If B1-H passes ≥ 90% of completed tail cases at d2 with no critical violation, the next step is the preregistered
  pilot (E-BED §8.2 P4) with K ≥ 2 builds. If it passes < 50%, the failure classes say which part of the spec Haiku
  could not turn into code; that, not a fine-tune, is the next lever (scaffolding: hierarchical spec retrieval, the
  library cards P58–P60, a build loop with the smoke runner).
- A gap between B1-H and B1-O on the same build conditions is reported per class; it does not decide anything at K = 1.
- No result here changes the spec, the oracle or the worlds; an oracle defect found while reading results is fixed
  and the affected grading re-run with the change recorded.

## Addendum (2026-10-14, declared after the B1-H result and before any loop build runs)

**B1-H result (one build, K = 1):** 0/155 completed d2 cases pass on 1232–1234 (no critical violation, no arm error).
The solver never emits an effect: it reads the read-only operations (`inventory.allocate`, `fraud.check`) from a file it
assumed exists (`sor/<instance>.json`, a name `TASK.md` itself mentions as "the instance's records") instead of emitting
them as un-keyed effects whose results arrive as `effect.result`, then re-polls every 2 minutes forever (242k ticks on
one world). At d3 that runaway journal overflowed the host's digest string; the host now streams digests (1.2.1) and a
host error fails the world instead of the run. One interface misreading, not the business rules, zeroed the build.
Per the reading declared above (< 50%), the next lever is scaffolding, not a fine-tune. Full grading of the 9 worlds is
in `runs/b1h-e8-1/result.json`.

**Loop arms (new arms, not B1; their own labels; same spec, contract, API, caps and grading worlds as B1):**

| arm | builder | feedback while building | cap |
|---|---|---|---|
| B1L-H | `claude-haiku-5-5`, effort high | `node smoke.mjs`: the solver runs through the real host on practice worlds 1235–1237 (d2, d3, d5; SEED-LEDGER `ebed-e8-rehearsal`), out of process; the report gives run status, counts, arm errors and the effect results received. No grading. | $3, 40 min |
| B1G-H | same | the same plus, on the practice worlds only, the completed-case pass count and the first divergence (rule, effect id, expected) of up to 6 failing cases | $3, 40 min |

- The smoke service runs host-side (`experiments/ebed/smoke-service.mjs`); the builder's sandbox still holds no bed
  code, world, generator or oracle. Every request is journaled (`runs/<label>/smoke.jsonl`).
- Graded feedback is a practice oracle: it is the condition "the family ships a test suite", reported as such, never
  pooled with B1.
- `TASK.md` keeps its wording for comparability (the `sor/<instance>.json` sentence included); a clarified TASK is a
  separate, later arm if the loop arms do not get past the read-only misreading.
- Reading: the loop arms say whether feedback alone (B1L) or feedback plus a practice oracle (B1G) turns a Haiku build
  into a working solver; K = 1 each, dev evidence only.

## Result: B1L-H (2026-10-14, one build, K = 1, dev evidence only)

| arm | build | completed cases pass (9 worlds: 1232–1234 × d2, d3, d5) | tail | critical | arm errors |
|---|---|---|---|---|---|
| B1-H (one shot) | $0.49, 39 turns, 18.6 min | **0/155** at d2 (d3/d5 still grading; no effect is ever emitted) | 0/105 | 0 | 0 |
| **B1L-H (smoke loop)** | **$0.39**, 71 turns, 18.8 min, 10 smoke runs | **1,022/1,022** | **651/651** | 0 | 0 |

How far to trust the 1,022/1,022 (checked before writing it down):
- **No leak.** The builder's 14 shell commands and all its file reads stay inside its workdir (`ls`, `cat api/*.json`, `node smoke.mjs` ×10,
  its own `test/rules.test.mjs`); no path outside it appears in the transcript. The smoke reports carry effect results only, no grading.
- **Not grader leniency.** On every passing completed case of world 1232 d5 (202 cases) and 1233 d3 (81 cases), the solver's committed
  effect multiset per case (system.op counts, from the ledger) is identical to the earliest reference run's: a stricter check than the
  oracle's windows. Every bad, gaming and necessity control still fails (bed health), and three blind specificity solvers also pass 100%.
- **What it does not show.** One lineage (K = 1): build variance is unknown, and the one-shot build of the same model failed completely
  on one interface misreading, so lineage-to-lineage spread may be large. Dev worlds only; no sealed or held-out world. The smoke loop
  ran practice worlds generated by the same generator, so it is the "family ships a sandbox" condition, not a cold build.
- Reading (declared above for B1-H, applied here as development guidance only): ≥ 90% at d2 with no critical violation → the next step is
  K ≥ 2 lineages of B1L-H on the same worlds, then the preregistered pilot. Two more lineages (`b1lh-e8-2`, `b1lh-e8-3`) run next, same
  conditions.

**For the need router:** on the hardest family we have (E8, a long-running saga with compensation, races and editions), construct-before
by Haiku is either worthless (one shot) or perfect (with a smoke loop) at a build cost under $0.50, so "construct-before" is not one mode
but two, and the build loop is the lever. The agent-without-workflow mode (agent-H, `experiments/ebed/agent-arm.mjs`) passed 4/5 completed
cases on a 2-order practice smoke at $0.008 per tick (35 ticks, one arm error); its paired run on the grading worlds comes next.

## Result: B1-O (2026-10-14, one build, K = 1, dev evidence only)

| arm | build | completed cases pass (same 9 worlds) | tail | critical | arm errors |
|---|---|---|---|---|---|
| B1-O (Opus 5.5, one shot) | $7.63, 38 turns, 32.9 min | **281/1,022 (27.5%)** | 281/651 | 0 | 820 |

Every `straight` case fails (L3 missed). Cause, from the arm errors (world 1232 d2: all 32 are `invalid-output`): the solver puts one
idempotency `key` on the batch `inventory.reserve` effect, which SPEC-E §2 keys per item ("per item ... each item carries its own
`key`"); the host rejects the whole tick output, so no reservation is ever made and every order that needs one stalls. What passes is
what needs no reservation (amend, review, some go-live and cancel cases). Like B1-H, one interface misreading decides the result; the
first smoke report of a build loop shows it (`arm errors: invalid-output effects[2].key ...`).

**Construct-before on E8 so far (K = 1 each):**

| build | cost | pass | the deciding failure |
|---|---|---|---|
| Haiku, one shot (B1-H) | $0.49 | 0% | read-only ops read from an imagined file |
| Opus, one shot (B1-O) | $7.63 | 27.5% | batch op keyed at the batch, not the items |
| Haiku + smoke loop (B1L-H) | $0.39 | 100% | none |

The feedback loop, not the builder's tier, decides construct-before on this family: a 20× cheaper builder with a loop beats the frontier
builder without one. Lineages 2 and 3 of B1L-H measure whether that holds beyond one build.

## Result: B1L-H lineages 2 and 3 (K = 3 in all, same conditions, dev evidence)

| lineage | build | smoke runs | completed cases pass | the gap |
|---|---|---|---|---|
| 1 | $0.39, 71 turns, 18.8 min | 10 | **1,022/1,022 (100%)** | none |
| 2 | $0.62, 37 turns, 24.3 min | 4 | **974/1,022 (95.3%)**, tail 603/651 | go-live backlog (`gl-intake` 18, `gl-awaiting` 18, `gl-dispatched` 12; all L3 missed): the `migration` event's orders are never picked up |
| 3 | $0.53, 59 turns, 20.2 min | 8 | **1,015/1,022 (99.3%)**, tail 644/651 | F4 partial reserve: releases instead of resubmitting the failed items (SPEC-E line 162) |

Mean 98.2% (range 95.3–100%) at $0.39–0.62 per build, no critical violation and no arm error in any lineage. Each imperfect lineage
misses one whole requirement (one rule family, every case of it), not scattered cases: smoke feedback shows *what happened* but not
*which stated requirement went unhandled*. That is the gap a per-requirement tracker (experiments/tracker/, in progress) is built to
close: lineage 2 would show "go-live backlog: untested/fail", lineage 3 "partial batch: fail".

## Result: B1N-H, the N-version repair loop (2026-10-14, dev evidence)

Method (`experiments/tracker/nversion.mjs`, `experiments/ebed/repair.mjs`; research/need-router-20261014/N-VERSION-TRACKER.md):
the three B1L-H builds run on the practice worlds 1235–1237; per order, a strict majority of their observable behaviour (committed
effects, statuses, notifications) is the consensus; each minority build gets one repair session with only its disagreeing orders
(the order's inbound messages, its own behaviour, the majority's) and decides from SPEC-E whether to change. No oracle, no grading,
no truth labels anywhere in the loop; the grading worlds 1232–1234 are disjoint from the practice worlds.

| lineage | before (grading worlds) | disagreeing orders (practice) | repair session | after |
|---|---|---|---|---|
| 1 | 1,022/1,022 | 0 | none | 1,022/1,022 |
| 2 | 974/1,022 (95.3%) | 16 | $0.11, 19 turns, 4.9 min | **1,022/1,022** |
| 3 | 1,015/1,022 (99.3%) | 4 | $0.05, 23 turns, 3.6 min | **1,022/1,022** |

All three lineages end at 100% (651/651 tail each), no critical violation, no arm error. Total spend for the whole method: **$1.70**
(three builds $1.54, two repairs $0.16), about 20 minutes of build time per lineage plus 4–5 minutes of repair. The repair notes cite
the rules and find the real causes: lineage 3 treated a retryable item error in a partial batch as permanent (Platform §1, R4.2,
R5.1, R5.2); lineage 2 closed migrated go-live orders without acting (§3.5 "continue each from where it stands", R1.1). Neither
simply copied the majority: each verified its fix on the practice worlds.

What it does not show: K = 3 lineages on one item; the defects happened to be independent across lineages (a misreading shared by
two builds would out-vote the right behaviour; the K = 4 run with B1-O shows 12 orders splitting 2–2 where B1-O repeats a
lineage's mistake); dev worlds only.

## Result: agent-H versus the built workflows on the same world (2026-10-15, dev evidence)

agent-H is the no-workflow arm. Every case-tick is one fresh sandboxed Haiku 5.5 session (`experiments/ebed/run-agent.mjs`). It gets the same SPEC-E and contract text as the builders, and no memory beyond the carry.

**The full world does not fit the job time limit.**
- The full d2 world 1232 has 71 arrivals and 3 backlog orders over 14 days.
- The agent handled about 85 ticks an hour. Each of two runs stopped at the 2-hour limit: one at 197 ticks ($1.88, with an in-memory journal that was lost), one at 171 ticks ($1.63). The second reached 41% of the horizon.
- Finishing one world would take about 7 hours. The built workflows run the same world in seconds.
- The partial tick logs are kept in `runs/agenth-e8-1/`.

**So the comparison uses a sized world: 1232, d2, size 12 (21 orders, 14 completed cases).** The built solvers were graded on the identical world at $0 (`build.mjs --grade-only --size 12`):

| arm | completed cases passed | cost | wall time |
|---|---|---|---|
| B1L-H lineage 1 (Haiku, smoke loop) | **14/14** | $0.39 to build once, then $0 per world | seconds per world |
| B1N-H lineages 2 and 3 (after N-version repair) | **14/14** each | $0.62 + $0.11 and $0.53 + $0.05 to build | seconds per world |
| B1-O (Opus, one shot) | 5/14 (11 arm errors) | $7.63 to build | seconds per world |
| **agent-H** (Haiku, one session per tick) | **10/14** (27 invalid outputs) | **$1.45 for this world** (143 ticks; prompt-cache read share 0.84) | about 1.5 h |

The agent arm's failures are one misreading, repeated:
- 25 of its 27 invalid outputs violate "a batch op keys its items, not the batch". The other two put `close: false`, where the contract allows only `true` when present. B1-O's one-shot build made the same batch-key misreading.
- A fresh session per tick cannot learn from the host's refusal, so it makes the mistake again on later ticks.
- The build loop fixes it once: a smoke run shows the refusal, and the fix is kept in code.

**Run integrity.** Run 1 of this sized world was hit by the subscription session limit from tick 85. From there, every session was refused with `MODEL_RATE_LIMIT`, and the arm could not act for the rest of the world. That run reported 4/14.
- That figure is an environment fault, not an outcome. It is kept under `runs/agenth-e8-s12/contaminated-ratelimit-20261015/`.
- The host journal was cut back to its last clean commit (seq 961, after tick 84), and the run resumed from there. The clean prefix replayed at $0; the 143 ticks above include it.

**What it shows.** On identical cases, the built workflows pass everything the agent passes plus 4 more cases. The agent passes nothing the workflows miss. They also run in seconds instead of hours, and the build cost is paid once.

**What it does not show:**
- One small world with 14 cases. The 4 discordant cases all favour the workflows (two-sided exact McNemar p = 0.125), so this is not significant on its own.
- One seed and one difficulty.
- Dev evidence only.
- The agent's errors are dominated by a single contract misreading, which a better contract text or a validating tool might remove. That is an agent-H-with-validator arm we have not run.
