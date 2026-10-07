# BUILD-NOTES

## What the solver does
`node solve.mjs task.json` fixes a Python module so it matches its docstrings and DESIGN.md.

1. **Setup (code):** loads the module, tests, bug thread, docs, changelog, CI log and a filtered service log. Builds a scratch sandbox with a minimal `pytest` shim (pytest isn't installed) and an AST checker for public names, signatures and imports.
2. **Find (Opus, medium reasoning):** one typed call returns defects, each with a verbatim `old`/`new` snippet edit and a `witness` (Python asserts based on the docs).
3. **Verify (code):** applies the edits, compiles, checks the API and imports, runs the visible tests and every witness. Failures go back to the model for up to 2 repair rounds, then one retry at high reasoning.
4. **Audit (Opus, medium):** searches the patched module for remaining defects. An edit is kept only if its witness fails before and passes after, with no test or witness regressions.
5. Prints `{"patched_source": ...}`, falling back to the best candidate or the original. At most 6 model calls per task.

## Verified
- Probes 0–2: all pass (score 1.0); decoy FIXME comments were left alone.
- The local harness reproduces each probe's CI results.
- Synthetic task (probe-1 plus 2 injected, unreported bugs): all 4 fixed.
- Service logs match the *buggy* code, so they are used only as evidence.
- Cost: about $0.25 per task.

## Known weaknesses
- Everything rests on Opus reading the docs correctly; witnesses can't catch a shared misreading.
- The audit found nothing on any probe, so it may be wasted cost on easy tasks.
- Tests that need pytest fixtures are skipped.
- Without `python3`, nothing is verified and audit edits are rejected.
