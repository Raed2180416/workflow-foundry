# Reproducing the evaluation

Read `PROTOCOL.md` before interpreting any run. `RESULTS.md` records observed
outcomes. All `runs/` content is private local evidence ignored by Git. No paid
provider, host credential file or private source repository is required.

## Actual TUI smoke

The harness requires the already-installed `/usr/bin/opencode`, bubblewrap, tmux
and Node 24+. It deliberately has no install command. Commands must be run from
the Workflow Foundry project. Use a fresh lowercase run ID every time.

```sh
node evals/opencode-harness.mjs prepare my-smoke
node evals/opencode-harness.mjs inspect my-smoke catalog
node evals/opencode-harness.mjs select my-smoke opencode/big-pickle
```

Selection must come from that actual captured catalog with explicitly zero
prices. The observed model can change or become unavailable. `big-pickle` is an
observed identifier from this experiment, not a guarantee of future availability.
Create `evals/runs/my-smoke/prompt.txt` with a synthetic task requesting only
`/task/output.json`, then run:

```sh
node evals/opencode-harness.mjs start my-smoke
node evals/opencode-harness.mjs screen my-smoke
node evals/opencode-harness.mjs inspect my-smoke sessions
```

The default OpenCode TUI is running in its own actual PTY through tmux. The
harness captures a raw terminal stream, not merely headless CLI output. It has a
240-second wall budget. Metadata inspection does not create a model generation.

When the assistant finishes or the budget expires, substitute the observed
session ID from `sessions`:

```sh
node evals/opencode-harness.mjs export-local my-smoke ses_OBSERVED_ID
node evals/opencode-harness.mjs stop my-smoke
```

Do not run a final `export-local` before completion when using the paired scorer:
the first export filename is its frozen input. A subsequent export is preserved
with a timestamp rather than overwriting evidence. The sanitized `export` command
redacts prompts and tool contents and therefore cannot alone establish exact
generation provenance. Raw local exports contain only the isolated synthetic
session; do not publish them indiscriminately.

## Matched incident comparison

The current diagnostic task uses a synthetic incident simulator and eight fixed
states. The task is written in `cases/incident-routing.md`; `incident-oracle.mjs`
checks real simulator state, effect count and event order. No expected simulator
states or completed reference program are given to the model.

```sh
node evals/compare-incident.mjs freeze my-pair
node evals/freeze-execution-dependencies.mjs my-pair
node evals/compare-incident.mjs stage my-pair my-baseline my-foundry
```

Freeze copies the exact native runtime, schema, task and skill documents into an
ignored snapshot. Dependency freezing copies the existing AJV dependency closure,
checking each version against that snapshot's lockfile. No downloads, lifecycle
hooks or research-corpus installs run. Stage currently reuses the catalog receipt
from `smoke-20260913`; for a new environment, adapt staging explicitly to a new
run's captured catalog and record the change. Never treat a guessed ID as a
verified free model.

Run baseline and Foundry serially with the smoke TUI commands above. Both receive
the same prompt, task, native format reference and capability catalog. The sole
context delta is the frozen generic/native/software construction skill text. It
is a software skill applied to a simulator, not a proven dedicated SRE product.
The task inputs are mounted read-only; only output.json may be modified by tools.

After each final export and stop:

```sh
node evals/compare-incident.mjs score my-pair my-baseline
node evals/compare-incident.mjs score my-pair my-foundry
node evals/compare-incident.mjs compare my-pair
```

Scoring rejects missing final responses and files, nonzero/unreported costs,
model/prompt changes and operator-substituted output. Valid generated JSON is
schema-checked then executed in separate fresh stores using the same frozen
runtime, dependency versions, tools, budgets and independent task oracle. No-op,
duplicate-effect and missing-verification mutants are tested against actual
Runtime/Store in `tests/evaluation-runtime.test.mjs`; those hand-written fixtures
are never model-generation evidence.

The first version of the pair blocked on an unrelated root lockfile change before
any workflow execution. The dependency snapshot was introduced before either arm
executed. Preserve its receipt and the original failure; do not silently disable
dependency checks. A changed oracle or frozen dependency must block scoring.

`stage-correction.mjs ORIGINAL_PAIR NEW_PAIR NEW_BASELINE NEW_FOUNDRY` stages the
single declared feedback round without changing the old skill/runtime snapshot.
After the new TUI turns, `score-revision` instead of `score` imports exact prior
workflow history for a version-2 correction. Its receipts have a `-v2` suffix;
earlier version-history errors remain visible. `typing-challenge.mjs PAIR RUN...`
executes an explicitly diagnostic wrong-type input challenge against unmodified,
provenanced correction candidates. It is not a heldout evaluator.

## Limits

The harness is Linux-specific and currently requires the observed executable
locations. Shared network access permits provider requests and is not an egress
allowlist. Bubblewrap hides the host home; minimal XDG state prevents global
configuration and credentials from being inherited. OpenCode may create its own
SDK files inside that isolated state. The tool policy adds read/write restrictions
inside the filesystem boundary; it is not proof against a malicious application.

Provider response time, exact backend identity, sampling seed and hard token caps
are not independently controlled. Record timeouts and outages without relabeling
them as quality measurements. A successful construction is still a candidate; a
successful synthetic execution supports only the explicit diagnostic envelope.
