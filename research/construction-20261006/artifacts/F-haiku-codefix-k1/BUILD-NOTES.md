# BUILD-NOTES

## What the solver does
`workflow.json` (6 nodes) repairs a Python module against its docs, bug reports and visible tests, and returns `{patched_source}`.

1. `bundle` (code): joins the module, tests, bug report, design notes, changelog and logs into one text block.
2. `fix` (agent, Sonnet 5.5, medium reasoning): audits each function against its docs and returns the defects and the full corrected module. The prompt treats docs as authoritative and bug reports and FIXME comments as unverified, and asks for minimal edits.
3. `check1` (code): the module must parse, keep public names and signatures, add no imports, and pass the visible tests.
4. `repair` (agent, Opus 5.5), only if `check1` fails: gets the failures and the previous attempt, and re-audits.
5. `check2` and `answer` (code): return the first passing candidate, otherwise the one with fewest failures.

## Verified
- `foundry validate`: valid.
- Probes 0–2: each patch is a minimal diff fixing the defects I found by reading the code (sort keys, negative ids, missing bounds, unadvanced loop state, unknown keys). FIXME decoys left unchanged. All score 1.0 (3 of 12 score checks used).
- Synthetic variant with a guard removed (not covered by visible tests): restored exactly.
- Forced-failure variant: repair path runs and selection works.
- Cost: about $0.09 per task on the Sonnet pass, $0.31 with Opus repair. Construction spend $0.68 of $2.

## Known weaknesses
- Recall rests on one audit call with no second independent audit.
- Repair runs only on visible test failures or signature/import violations.
- Full-file output can over-edit; minimal diff is prompted, not enforced.
- The pytest shim supports only `raises` and `approx`.
- Haiku was not tested as a cheaper first pass.
- Reads `inputs` only, not `files`.
- Tested on 3 real probes and 2 synthetic variants.
