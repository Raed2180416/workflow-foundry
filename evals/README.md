# Evaluation helpers

Read `PROTOCOL.md` (the preregistered comparison design) before interpreting any
run. Results of past campaigns are summarized in [`docs/RESEARCH.md`](../docs/RESEARCH.md).
Everything under `runs/` is local evidence that git ignores. No paid provider,
host credential file or private repository is required.

| File | Role |
|---|---|
| `opencode-harness.mjs` | Isolated actual-TUI harness (below). Hashes `PROTOCOL.md` into every run manifest. |
| `evidence.mjs` | Gate for TUI evidence: denied tool calls reported as completion, missing or replaced output, prompt/model/hash drift, nonzero prices, contamination. |
| `incident-oracle.mjs` + `cases/incident-routing.md` | The synthetic incident-routing task and its independent oracle, which checks real simulator state, effect count and event order. |
| `evidence-bound-fixture.mjs`, `sre-robustness-cases.mjs` | Host evidence-contract registry and wrong-type SRE cases used by `tests/evaluation-hostcontract.test.mjs`. |

## Actual TUI smoke

Requires the already-installed `/usr/bin/opencode`, bubblewrap, tmux and Node 24+.
The harness has no install command. Run from the repository root with a fresh
lowercase run ID each time.

```sh
node evals/opencode-harness.mjs prepare my-smoke
node evals/opencode-harness.mjs inspect my-smoke catalog
node evals/opencode-harness.mjs select my-smoke opencode/big-pickle
```

Selection must come from the captured catalog with explicitly zero prices. Model
identifiers change and can disappear. Write a synthetic task requesting only
`/task/output.json` to `evals/runs/my-smoke/prompt.txt`, then run:

```sh
node evals/opencode-harness.mjs start my-smoke
node evals/opencode-harness.mjs screen my-smoke
node evals/opencode-harness.mjs inspect my-smoke sessions
```

The default OpenCode TUI runs in its own PTY through tmux, so the harness captures
a raw terminal stream with a 240-second wall budget. When the assistant finishes or
the budget runs out, export with the observed session ID and stop:

```sh
node evals/opencode-harness.mjs export-local my-smoke ses_OBSERVED_ID
node evals/opencode-harness.mjs stop my-smoke
```

`export` redacts prompts and tool contents, so it cannot establish generation
provenance on its own. `export-local` keeps the raw isolated session. Never
publish it indiscriminately.

## Limits

The harness is Linux-only and expects the observed executable locations. Network
access is shared, so there is no egress allowlist. Bubblewrap hides the host home,
and minimal XDG state keeps global configuration and credentials from being
inherited. Provider latency, backend identity, sampling seed and token caps are not
controlled. Record timeouts and outages as such, never as quality measurements. A
successful construction is still only a candidate.
