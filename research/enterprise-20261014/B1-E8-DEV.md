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
