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

*Note added 2026-10-21 (compromise register A1 and A2; `research/compromises-20261021/action0/a1a2.py`, $0):*
- "Every stop reason is `tool_calls`" is true of the `finish_reasons` field of `results.json` (2,761 entries, all
  `tool_calls`), but that field misses each task's final call (upstream `automationbench/clients.py:219-223`). The
  `stop_reasons` field records every call: 2,821 entries, 9 of them `stop`. So 9 of the 60 tasks ended with a `stop`
  response: 8 under the cap, and 1 at step 50, which also counts among the 52 cap tasks.
- The cap tasks are repetition loops rather than a missing done signal alone: all 52 repeat an identical (tool,
  arguments) call 3 or more times, and 64% of their steps come after the first third repeat (median step 17). The
  register splits the fix: a loop guard for Mercury (FIXES A2a) and a stop gate for CLI sessions (A2b).
- Mean input is about 34K tokens per response (95.96M over 2,821 responses), 98.3% of it cache reads; the 1.6M per
  task stands.

**Next.**
- Mercury runs through our harnesses once the OpenAI-compatible executor lands (A0, A1, A1-C), with **token caps**,
  because a dollar cap never triggers at a $0 price.
- Ask the owner how much of the allowance remains. There is no usage endpoint (`/v1/usage` and `/v1/credits` return
  404).
