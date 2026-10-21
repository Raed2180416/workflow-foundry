# Mercury (Inception Labs) as a second cheap model: provisioning (2026-10-21)

**Owner decision (chat, 2026-10-21).**
- Add Inception's Mercury 3 as a cheap target model beside Haiku 5.5.
- The owner provisioned an API key. They describe it as not linked to a card, with a 100M-token free allowance.
- The bar the owner set: "if haiku + harness is not good enough to match frontier model such as sonnet or opus alone then
  this is really poor. We need … something capable of elevating a shitty model to custom build these complex ass
  workflows with ease."

**Credential handling (AGENTS.md: credentials only from owner-provisioned environment variables).**
- The key lives outside the repository, in `/root/.config/foundry/inception.env`, mode 0600.
- It is loaded as the environment variable `INCEPTION_API_KEY` only by the commands that call the API.
- It is never printed, logged or committed.
- The orchestrator's pre-commit secret scan matches the key's shape.

**API facts** (`GET https://api.inceptionlabs.ai/v1/models`, read 2026-10-21):

| Model | Context | Max output | List price in / out ($/MTok) | Features |
|---|---|---|---|---|
| `mercury-3` | 1,000,000 | 131,072 | **0 / 0** (as listed today) | tools, json_mode, structured_outputs |
| `mercury-2.5` | 260,000 | 65,536 | 0.20 / 0.75 | tools, json_mode, structured_outputs |
| `mercury-2` | 128,000 | 50,000 | 0.25 / 0.75 | tools, json_mode, structured_outputs |
| `mercury-decide` | 65,536 | 50,000 | 0.02 / 0 | none listed |

- **Endpoint.** `chat.completions` only (OpenAI-compatible). The listed sampling parameters are `temperature` and
  `stop`.

**Smoke tests** (`scratchpad/mercury/`, not committed):
- **Tool call.** One correct `get_order` call in 1.9 s.
- **Reasoning.** Usage reports `reasoning_tokens`, so the model reasons. `reasoning_effort` and `reasoning.effort` are
  accepted without error, but they do not change the reasoning length in a consistent order:

  | Setting | Reasoning tokens |
  |---|---|
  | none | 343 |
  | low | 324 |
  | medium | 166 |
  | high | 210 |

  All four runs answered a multi-step refund calculation correctly (184). **We treat the effort setting as having no
  effect until shown otherwise.**

  *Note added 2026-10-21 (compromise register A6):* one problem per setting shows no effect; it cannot show the
  absence of one. Inception documents four values, `instant`, `low`, `medium` and `high`, and mercury-3 defaults to
  `low` when the field is omitted (docs.inceptionlabs.ai/capabilities/reasoning-efforts, read 2026-10-21). Our executor
  accepts only low, medium and high and refuses `instant` (`src/executors/openai-chat.mjs:48`, `:306`). The official
  dev60 run's reasoning count of 0 (OFFICIAL-DEV60) is a metering gap: the official harness reads reasoning tokens only
  from Responses-style `output_tokens_details` (`corpus/AutomationBench/automationbench/clients.py:245-251`). In our
  own executor's stored Mercury responses, completion_tokens ≥ reasoning_tokens in 140 of 140 (median reasoning share
  0.72; `research/compromises-20261021/action0/a6.py`), so reasoning is most likely counted inside output.
- **Web search.** The owner mentioned it. It is not in the models listing and was not tested. It is not used in any
  benchmark run, because AutomationBench and E8 are closed worlds.

**Integration plan:**
1. **AutomationBench, official protocol, Mercury 3 alone.**
   - The official `auto-bench` CLI supports `--base-url` and `--api-key-var`.
   - It runs on the same 60 devTrain tasks as the Haiku and Sonnet arms. None are test-split; checked against
     `SPLIT-v1.json`.
   - Run dir: `/var/tmp/foundry-work/autobench/m3-official-dev60/`.
   - Not the same harness as our A0, which is Claude Code sessions with a Bash mailbox. It is the leaderboard's own loop,
     on the public split.
2. **An executor for Mercury.** A sandboxed tool-using session on any OpenAI-compatible endpoint, so Mercury can run
   every arm our Claude Code sessions run:
   - A0/A1 on AutomationBench;
   - the E8 builders (B1L-M);
   - SOP-Bench (agent and builder).
3. **A `policy/models.json` entry.** Under a provider kind for remote OpenAI-compatible HTTPS endpoints, with the key
   named by environment variable. Model ids come only from the policy file (AGENTS.md).
4. **The bar, stated as a test.** On each target workload, the cheap model plus our system must reach at least the
   frontier model alone, at a fraction of the cost:
   - AutomationBench dev60: Sonnet alone 20/60; Opus alone not yet run.
   - E8 construction: Opus one-shot builder 5/14; Haiku with the practice loop 14/14.
   - SOP-Bench and τ³ once built.
