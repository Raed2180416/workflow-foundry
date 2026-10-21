# Mercury 3 alone on AutomationBench dev60, official protocol (2026-10-21)

**Setup.**
- **Harness:** AutomationBench's own `auto-bench` CLI, version 1.0.6, `api` toolset, `max_steps` 50, chat completions
  against `https://api.inceptionlabs.ai/v1`, model `mercury-3`, no reasoning effort.
- **Tasks:** the same 60 devTrain tasks as the Haiku and Sonnet dev60 arms. None are test-split; checked against
  `SPLIT-v1.json`.
- **Records:** aggregates and per-task scores are in `m3-official-dev60-summary.json`. The full transcripts (13 MB)
  stay at `/var/tmp/foundry-work/autobench/m3-official-dev60/results.json`.

**Result** (development evidence, k = 1):

| | |
|---|---|
| Strict pass | **2/60 (3.3%)**: `operations.zoom_training_setup`, `support.hiver_mailbox_audit` |
| Mean partial credit | 0.076 |
| Steps | mean 47.0; **52 of 60 tasks ran to the 50-step cap**; every stop reason is `tool_calls` |
| Tokens | 95.96M input, of which 94.35M cached; 1.21M output; about 1.6M input per task (max 2.9M) |
| Listed cost | $0. The tokens count against the owner's free allowance of about 100M |
| Wall time | 47 min at concurrency 4 |

**Context.**

| Arm, same 60 tasks | Strict pass |
|---|---|
| Mercury 3 alone (official loop) | 2/60 |
| Haiku 5.5 alone (our CLI harness, date note) | 9/60 |
| Haiku + A1 | 18/60 |
| Sonnet 5.5 alone | 20/60 |
| Sonnet + A1 | 28/60 |

The harnesses differ: official API loop against Claude Code sessions. So this places Mercury; it is not a paired test.

**Reading.**
- Mercury 3 as a bare agent almost never decides it is done. It keeps calling tools until the step cap.
- That is the termination failure class in `research/automationbench-20261014/runs/DEV60-FAILURE-ANATOMY.md`, in its
  extreme form. It is the clearest case yet for code-owned termination, inventory and checks (A1-C).

**Next.**
- Mercury runs through our harnesses once the OpenAI-compatible executor lands (A0, A1, A1-C), with **token caps**,
  because a dollar cap never triggers at a $0 price.
- Ask the owner how much of the allowance remains. There is no usage endpoint (`/v1/usage` and `/v1/credits` return
  404).
