# Recorded changes to the AutomationBench harness manifests (2026-11-04)

The manifests of the A1-C v1 and A1 harnesses (`harness/codeowned.mjs` and `harness/foundry.mjs`, `manifestFiles()`)
froze at commit `e6a23ca` under PREREG-AB-v1 §5 and §6.1. A frozen candidate's manifest hash is recomputed at launch, so
a changed manifest file would make a frozen candidate fail to recompute.

Every frozen look-2 candidate runs from the pinned checkout: tag `a1c-v1-look2` (`b1e16e03`) on tag `a1c-v1` (`aada200`),
at `.claude/worktrees/a1c-v1-pin`. That pin takes no allowance. The manifest test
(`experiments/autobench/test/sequential.test.mjs`) checks that every manifest file there, at the tag and on disk, is
`e6a23ca`'s.

Main's tree is where engine work continues. Its manifest files may differ from `e6a23ca`, but only by the changes
recorded here and in `experiments/autobench/test/manifest-allowances.mjs`. For each one the test checks:
- the bytes before (at `e6a23ca`) and after (on disk);
- that each listed commit is in the history and changed the file;
- that the first commit's parent holds the "before" bytes;
- that the last commit holds the "after" bytes, or, for a merge, that "after" is the clean three-way merge of the
  recorded sides;
- that this document names the "after" hash.

Any other change, or any further change to one of these files, fails the test until it is recorded in both places.

## Why these changes are allowed

These are engine changes that landed on main after the look-2 freeze (2026-10-21), during the D29–D33 integration:
- compromise C2: the CLI is pinned by its bytes and the version is recorded;
- orchestration patches 01–09 and their follow-ups;
- one runner per workdir;
- CANCELLED on abort;
- Mercury-only session subsets.

None of them changes a frozen candidate, because the frozen candidates run from the pin. Until 2026-11-04 the test
failed on main: these changes had been merged without a record. This document and the shared table are that record.

The earlier recorded change to `experiments/autobench/bridge.py` (`2f02281`, pin_timezone) keeps its existing record in
PREREG-VL1 and A1C-MERCURY-PARTIAL.

| File | sha256 before (`e6a23ca`) | sha256 after | Commits | Change |
|---|---|---|---|---|
| `experiments/autobench/harness/foundry.mjs` | `5b5a7bb653d6` | `a31d66719778` | `2f40700d` | Compromise C2: the launch records the Claude CLI {version, sha256, pinned}, and a resume on other CLI bytes is refused. |
| `experiments/autobench/run.mjs` | `ea1dca70628a` | `6705073d2fc7` (the clean merge of `2f40700d` and `6e7bba75` over `e6a23ca`) | `2f40700d`, `5a59cbb9`, `6e7bba75` | Compromise C2: the launch records the Claude CLI {version, sha256, pinned}; a resume on other CLI bytes is refused. Then the A1-C v2 merge (2026-11-04) added the `codeowned-v2` registration and `EXECUTOR_PIPELINES` (test 20 in `codeowned-v2.test.mjs`); `--harness codeowned` behaves as before. |
| `experiments/lib/results.mjs` | `e9cb94d14c3b` | `645c7800b0f8` | `8b00b4a4` | Orchestration patches 01-09 (research/orch-20261021). |
| `experiments/lib/runner.mjs` | `cbc4b19741f8` | `ea84709699cb` | `8b00b4a4`, `ebc81908` | Orchestration patches 01-09, then one runner per workdir (an exclusive lock; gap rank 12, chaos F1). |
| `src/children.mjs` | `68a763b3e9f9` | `f81dc9035711` | `8b00b4a4`, `6203fb69` | Orchestration patches 01-09 and their follow-ups (patches 05 and 09). The A1-C v1 manifest lists it since the executor imports it; at a1c-v1 it was not imported. |
| `src/cli-pin.mjs` | new file | `18967fd06089` | `83d9e713` | New file. Compromise C2: the Claude CLI is pinned by its bytes and its version is recorded per call (gap rank 16, chaos D4). |
| `src/executors/claude-code.mjs` | `f363c80418bf` | `d50b93d9c203` | `8b00b4a4`, `03c19e2b`, `83d9e713` | Orchestration patches 01-09; a session the caller aborts ends CANCELLED, not EXECUTOR_PROTOCOL (gap rank 21); the CLI pin (C2). |
| `src/models/policy.mjs` | `95390dec17ad` | `d8ecfb841107` | `83d9e713`, `a81447eb` | The CLI pin (C2), then Mercury-only session subsets: an empty models[] beside executorModels (PORT-PROBE finding 1). |
