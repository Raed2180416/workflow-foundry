# τ²/τ³-bench acquisition (2026-10-21)

| Field | Value |
|---|---|
| URL | https://github.com/sierra-research/tau2-bench |
| Revision | `57e54143025bec219b5726884651c98eede202e2` (commit date 2026-10-20 17:00:02 −0700) |
| Fetched | 2026-10-21, `git clone --depth 1 --no-recurse-submodules` into `corpus/tau2-bench` (ignored, never committed) |
| License | MIT, © 2025 Sierra Research (`LICENSE`) |
| Install hooks | None run. No venv or package install yet |
| Outcome | **ok (inert)**. Trimmed for disk, see below |

**Trimmed after cloning**, to fit the session's disk allowance:
- `data/tau2/results` (577 MB of published trajectories)
- `data/tau2/multilingual*` (146 MB)
- `data/voice` (19 MB)
- `web` (40 MB)

What remains: `src/`, `tests/`, `data/tau2/domains/` (airline, retail, telecom, banking_knowledge, intake, mock),
`data/tau2/judge_catalog`, `data/tau2/task_subsets`, `.git`. The trimmed parts can be re-fetched at the same revision.

**Official splits** (`data/tau2/domains/<d>/split_tasks.json`):

| Domain | Train | Test | Base | Other |
|---|---|---|---|---|
| airline | 30 | 20 | 50 | — |
| retail | 74 | 40 | 114 | — |
| telecom | 74 | 40 | 114 | `small` 20; generated `full` pool 2,285 |

**Model layer.**
- Every agent and user-simulator call goes through `generate()` in `src/tau2/utils/llm_utils.py:516`. It uses `litellm`
  `completion` with `tools` and `tool_choice`.
- `pyproject.toml` pins `litellm>=1.80.15,<1.82.7` and Python `>=3.12,<3.14`.
- This session has no Anthropic or OpenAI API key; the only model route is the Claude Code CLI under the owner policy.
  Running τ² here therefore needs a `litellm` custom provider that maps `completion(messages, tools)` onto a CLI call
  with a JSON schema for `{content, tool_calls[]}`. This applies to both the agent and the user simulator.

**Consequences for any result:**
- A Claude user simulator is **not** the official protocol, which uses its own configured user model. Results are valid
  for internal comparisons on the same simulator: agent against workflow-guided agent, pass^k. They are **not**
  comparable with taubench.com.
- Simulator variance must be reported, by rerunning with a second user model (Haiku and Sonnet).
- The test splits are sealed for us. Workflows are built from the train splits only.

**Planned use** (`research/composition-20261021/PLAN.md`, after SOP-Bench phase 1):
1. One typed workflow per request intent, clustered from the train split by a frontier architect.
2. Haiku executes the workflows; report pass^1..pass^4 on the test split.
3. Baseline: τ²'s own tool-calling agent on Haiku through the same shim.
