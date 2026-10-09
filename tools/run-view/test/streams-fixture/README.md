# Synthetic JIT stream fixture

A small, hand-shaped copy of the layout `experiments/jit/stream.mjs` writes (SPEC §6.3), for `test/streams.test.mjs`. Not a real run, no model was called.

- `runs/jit-fix-1/`: four arms over a 10-task plan (`configs/jit-fix-1.json`; the plan also names an Opus agent arm that never started). The JIT arm has warmup, a compile whose Haiku attempt fell back to Opus, a guard deopt, a crash, a rejected recompile, a shadow disagreement settled by adjudication (a regression case), a recompile on that regression, an environment fault and a task in progress. The Sonnet agent arm stops mid-file (a partial last line, as a live stream leaves it).
- `runs/jit-fix-test/`: a held-out (test split) stream whose builder notes and error messages must be withheld.
- `runs/logs/`, `runs/smoke/`: folders that are not experiments.

Markers (`HIDDEN-TRUTH-MARKER`, `TEST-NOTES-MARKER`, `TEST-MESSAGE-MARKER`) must never reach an export; the hostile text in `v1-opus55/BUILD-NOTES.md` must render as text.
