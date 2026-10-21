# OT-0: the minimal org-twin slice on E8 ($0 part, 2026-10-21)

*Brief: `research/business-20261021/ATTACK-FABLE.md` §3.3 (with §2.2 on evidence and §3.2 on prior art). Predictions:
`PREDICTION.md` (written before any OT-0 code; two design amendments made before any run are marked in it). Code:
`experiments/constitution/`. E8's host, oracle, worlds and spec, the composition harness, `src/` and `policy/` are
imported read-only and unchanged (COMP-1 is running on the same host): everything here wraps them through their exported
APIs. No model was called. Development and design-validation evidence on dev rehearsal worlds; nothing here is a claim.*

**Status.** Built and run at $0: constitution v0 (schema + three instances), the registry and its change-control gate,
the world overlay, the observer (OCEL-2.0-shaped log, C1–C3), the shield and the necessity guard G at the effect port,
the scripted auditor, the observer's validity test, and the re-grading of the stored blind builds (W-blind, W-S, G).
The paid arms (W-C ×3, A-HV, A-F Sonnet and Opus) are wired, dry-run at $0 and **not run**; `PREREG-OT0.md` is a draft
and the paid entry points refuse to start until the owner freezes it.

```sh
# tests ($0; one file at a time on the shared machine; ~25 s in all)
for f in constitution overlay port observer auditor paid; do nice node --test --test-concurrency=1 experiments/constitution/test/$f.test.mjs; done
nice node experiments/constitution/validity.mjs                         # observer vs oracle on every graded run and the controls (~25 min; B1-H alone ~40 min)
nice node experiments/constitution/run.mjs                              # W-blind / W-S / G (+ base) for 5 programs x 10 worlds (~35 min)
node experiments/constitution/report.mjs                                # the tables below, from runs/*.json
node experiments/constitution/build-wc.mjs --dry-run --label dry-wc-stub # W-C pipeline with a scripted stub builder ($0)
node experiments/constitution/run-agents.mjs --arm A-F --model claude-sonnet-5-5 --label dry-af --dry   # A-F wiring ($0)
node experiments/constitution/freeze.mjs                                # sha256 table for PREREG-OT0.md §6
```

RESULTS_PLACEHOLDER
