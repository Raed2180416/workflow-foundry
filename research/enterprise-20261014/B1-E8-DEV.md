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
by
Haiku is either worthless (one shot) or perfect (with a smoke loop) at a build cost under $0.50, so "construct-before" is not one mode
but two, and the build loop is the lever. The agent-without-workflow mode (agent-H, `experiments/ebed/agent-arm.mjs`) passed 4/5 completed
cases on a 2-order practice smoke at $0.008 per tick (35 ticks, one arm error); its paired run on the grading worlds comes next.
