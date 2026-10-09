# Quota meter capture (BLOCKER-SYNTHESIS §2.1 row 6, B10-E2; blockers B10 and B10b)

Run 2026-10-09 on the owner's laptop, `claude` 2.1.295, the CLI's own logged-in account. Row 6 gates nothing (V13).

## Findings

1. **The meter is exposed, with a flag.** `claude -p --output-format stream-json --verbose` emits one `rate_limit_event`
   per call, carrying the 5-hour and 7-day utilisation of the account. The repo's own `--output-format json` does **not**:
   its single result object has no rate-limit field (one call checked, `raw/haiku-4-json-format.jsonl`, 0 events).
   `src/models/providers/claude-cli.mjs` therefore cannot see the meter today (see "What the repo records").
2. **What the event holds** (identical shape on Haiku, Sonnet and Opus, with or without the repo's `childEnv` flags):
   ```json
   {"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1791556200,"rateLimitType":"five_hour",
     "overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,
     "unifiedWindows":{"five_hour":{"utilization":0.22,"resetsAt":1791556200},
                       "seven_day":{"utilization":0.29,"resetsAt":1791939600}}}}
   ```
   - `utilization` reads as a fraction (0.23 is 23%); the stream does not document the unit.
   - Resolution is **0.01**. Values seen over about 3 minutes: 5h 0.22, 0.23, 0.24; 7d 0.29 throughout.
   - `resetsAt` is epoch seconds: 5h resets 2026-10-09 14:30 UTC (so the window began 09:30), 7d resets 2026-10-14 01:00 UTC.
   - **One shared meter for all models.** An Opus call returned the same two windows as a Haiku call. There is no
     per-model window in the event, though the binary names `seven_day_opus` and `seven_day_sonnet` fields
     (see "Binary strings"); this account's event did not carry them.
   - `rateLimitType: five_hour` is the representative (binding) claim. `status: allowed`. Overage is off at org level.
3. **A weight per model and token class is not fitted, and with what ran here it cannot be.** Reasons:
   - 0.01 resolution: one tick is about **$0.2 of Haiku list cost, about 1.7M cache-write tokens**, in the one interval that
     brackets two ticks (below). Resolving a Sonnet or Opus weight to a useful precision costs real dollars.
   - The account is shared with other live sessions (this project's orchestrator and its other agents ran during the
     probe). Any tick can come from them. The ticks below are **unattributed**.
   - The first tick (0.22 to 0.23) came at running total $0.038 of my calls; the second (0.23 to 0.24) at $0.250. Between
     them I spent $0.212 of Haiku list cost. That is an upper bound on Haiku's price per tick only if no other session
     contributed, which is not known. It is an order of magnitude, not a weight.
4. **Observable per call without the meter:** `total_cost_usd` (list price; `modelUsage.*.costBasis: "list"`), and the four
   token classes, per model. The cost is exactly list price from the tokens:
   - Haiku 5.5, 5-minute cache write 2484 tokens: $0.0003127. Residual after 2 input and 4 output tokens is $0.125/MTok = 1.25 x input.
   - Cache read 2484 tokens: $0.00002704, residual $0.01/MTok = 0.1 x input.
   - 1-hour cache write (the call without `FORCE_PROMPT_CACHING_5M`): $0.2/MTok = 2 x input.
   - Sonnet 5.5 and Opus 5.5 match 1.25 x their `policy/models.json` input prices ($2.5 and $5.0/MTok).
5. **What the meter does with cache reads and output is open.** Both observed ticks fell during runs dominated by 92K-token
   Haiku cache writes. The read and output rungs (one 60K read, three 3.5K-token outputs) were too small to move a 0.01 meter, so
   they show nothing either way. The synthesis question "does the subscription meter discount cache reads" stays open.

## Raw-field inventory

Scanned 36 raw files (`inventory.json`, `node inventory.mjs`). No field in any stream looks like a token or key (key-name and
value-pattern scan, 0 hits); nothing was dropped or redacted. `apiKeySource` is `"none"`; `messaging_socket_path` and the
session ids are local identifiers and are kept.

| Event | Meter-like or accounting fields | Meter? |
|---|---|---|
| `system/init` | `model`, `apiKeySource`, `fast_mode_state`, `capabilities`; no usage or limit field | no |
| `system/ui_invalidate`, `system/post_turn_summary` | none | no |
| `assistant` | `message.usage.{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, cache_creation.{ephemeral_5m,ephemeral_1h}_input_tokens, service_tier, inference_geo}` | tokens only |
| **`rate_limit_event`** | **`rate_limit_info.{status, resetsAt, rateLimitType, overageStatus, overageDisabledReason, isUsingOverage, unifiedWindows.{five_hour,seven_day}.{utilization, resetsAt}}`** | **yes** |
| `result/success` | `total_cost_usd`, `usage.*` (as above plus `output_tokens_details.thinking_tokens`, `server_tool_use`, `iterations[]`, `speed`, `fallback_credit`), `modelUsage.<model>.{inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, costUSD, costBasis, canonicalModel, contextWindow, maxOutputTokens, thinkingTokens, provider}`, `duration_ms`, `duration_api_ms`, `ttft_ms`, `time_to_request_ms`, `first_content_frame_ms`, `num_turns`, `terminal_reason`, `permission_denials`, `subagent_stats.*` | cost and tokens only |
| `--output-format json` result | the `result/success` object alone | no meter |

`--help` surface at $0: no `usage`, `status`, `quota` or `rate-limit` subcommand or flag (`claude --help` lists agents, auth,
doctor, mcp, plugin, setup-token, update and others; the only budget flag is `--max-budget-usd`, a per-call dollar cap).

### Binary strings (read, not run)

`strings` on the 2.1.295 binary names the same fields and some this account did not return: `rate_limit_event`,
`unifiedWindows`, `seven_day_opus`, `seven_day_sonnet`, `seven_day_oauth_apps`, `surpassedThreshold`, `overageStatus`,
`anthropic-ratelimit-unified-{status,reset,5h-reset,7d-reset,representative-claim,overage-*}` response headers. That makes the
event a relay of the API's unified rate-limit headers. A plan with per-model weekly windows may return more keys than this
account does; the poller logs every key it sees, so a change would show.

## What the repo records today

`interpretResult` in `src/models/providers/claude-cli.mjs` reads `usage`, `total_cost_usd`, `modelUsage` (served models, `costBasis`)
and `stop_reason`, and uses a regex on the result text for rate limits. It never sees `rate_limit_event`, because the policy
invocation is `--output-format json` (no events). To log the meter per call the provider would need `stream-json --verbose`
and a parser for the last `rate_limit_event`; that is a `src/` change and out of scope for this directory.
Switching format also changes what the CLI prints, so it should be tried on a copy first.

## Live probe, cap and spend

Cap set for this task: **$1.00 list price**. Spent: **$0.2502 over 36 calls** (Haiku 5.5: 34 calls, $0.2373; Sonnet 5.5: 1, $0.0043;
Opus 5.5: 1, $0.0086), counted as the sum of `total_cost_usd` in every file under `raw/`. Flags are the repo's
(`policy/models.json` `providers.claude-cli`: `-p --no-session-persistence --safe-mode --strict-mcp-config --mcp-config '{"mcpServers":{}}'
--disable-slash-commands --tools ""`, `childEnv` `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `FORCE_PROMPT_CACHING_5M=1`) with
`--output-format stream-json --verbose` and a per-call `--max-budget-usd`. Empty throwaway cwd `/var/tmp/qm-cwd`; the prompt on stdin.

| Stage | Calls | Spend | Meter read |
|---|---|---|---|
| `capture.mjs`: 6 Haiku (tiny, repeat, longer output, json format, no childEnv flags, closing) + 1 Sonnet + 1 Opus; plus one manual first Haiku call | 9 | $0.0141 | 5h 0.22, 7d 0.29, flat |
| `ladder.mjs` rungs 60K write, 60K read, 3.5K-token output | 3 | $0.0126 | flat |
| `ladder.mjs` 6 x 92K cache-write + 2 x 3.5K output (`raw/ladder2`) | 8 | $0.0730 | **5h 0.22 to 0.23 on the first call** |
| `ladder.mjs` 13 x 92K cache-write (`raw/ladder3`) | 13 | $0.1505 | **5h 0.23 to 0.24 on call 13** |
| `probe-meter.mjs` smoke, 3 iterations at 5 s | 3 | $0.0001 | 0.23 / 0.29 flat |

The full timeline, one row per call, is `timeline.tsv`. Cost shape from the calls:
a tiny Haiku call is $0.00003 once the default prompt is cached (2484 tokens read) and $0.0003 when it is written;
Sonnet $0.0043 and Opus $0.0086 for a cold tiny call. The CLI's default system prompt is the dominant token cost for small calls.
Wall time per tiny call: about 1 to 2 s.

## Polling script

`probe-meter.mjs`: one tiny Haiku call per interval, each reading the meter from the `rate_limit_event`; appends a row to a JSONL log
with the 5h and 7d readings, the deltas and a `changed` flag. Haiku only (it refuses any other model). Hard caps: `--max-calls`
(default 20), `--max-usd` (default $0.50, checked against each call's `--max-budget-usd` before the call), stop on a usage-limit
error. A pure reading call costs about $0.00003 to $0.0003.

```sh
# plan and worst case, calls nothing
node research/jit-20261008/analysis/quota-meter/probe-meter.mjs --dry-run --iterations 18
# the B10-E2 form: every 10 minutes for 3 hours, 18 reads, about $0.001 of Haiku
node research/jit-20261008/analysis/quota-meter/probe-meter.mjs --interval-s 600 --iterations 18 --max-calls 20 --max-usd 0.50 --log meter-log.jsonl
# the smoke that was run
node research/jit-20261008/analysis/quota-meter/probe-meter.mjs --iterations 3 --interval-s 5 --log meter-log-smoke.jsonl --save-raw
# with a known load per poll (about N fresh cache-write tokens; N <= 90000), to set meter drift against a known dose
node research/jit-20261008/analysis/quota-meter/probe-meter.mjs --interval-s 300 --iterations 12 --load-tokens 60000 --max-usd 0.30
```
Run it in the shell that has the CLI login (the sandboxed-builder environment variable is not needed for a plain `claude -p`).
Other scripts: `capture.mjs` (the planned calls, $1 cap), `ladder.mjs` (token-class dose ladder, Haiku by default),
`inventory.mjs` (field inventory), `timeline.mjs` (merged table), `lib.mjs` (shared; also holds the credential-looking-field scan).

## How a quota weight per model and token class could be estimated (a proposal, not a result)

The meter is a single scalar per window at 0.01 resolution, shared across models. Everything below is a design for later.

1. **Test the two simple hypotheses first.** H-dollars: the meter moves in proportion to list-price cost, so one tick costs about the
   same dollars on any model. H-tokens: it moves with tokens (perhaps by model class), so one tick costs about the same tokens.
   Haiku shows about $0.2 and 1.7M cache-write tokens per tick at best. A Sonnet dose of $0.2 (about 80K cache-write tokens)
   and an Opus dose of $0.2 (about 40K) separate the two: a tick or more at that dose favours H-dollars; no tick favours
   H-tokens or a cheaper-than-list weight. Each dose is a few cents to $0.2 and needs several repeats.
2. **Dose design for a regression.** Run order randomised across (model, token class) cells, one cell per block, a long enough
   dose per block to give 3 or more ticks (so unattributed ticks of +-1 matter less), and `probe-meter.mjs` between blocks as the
   readings. Fit meter delta on the four token counts per model by non-negative least squares. Needs a quiet account: no
   other session during a block. This laptop session is not quiet; schedule it while the owner is idle, or record the other
   sessions' own journals (their `total_cost_usd`) and put their dose in the regression.
3. **Passive version, $0.** Leave `probe-meter.mjs` polling over days and regress the 5h-window delta on the per-call cost and
   tokens that the repo's own journals already record (`providers.claude-cli` results carry `usage`, `costUsd`, `servedModels`).
   Only valid for periods in which this repo is the only consumer; interactive Claude sessions are the confound. It also
   needs the provider to stop discarding events (above), or a poller alongside it.
4. **Public usage-limit documentation** was not fetched in this task. If it states the weighting (for example that limits
   are shared across models, or that longer messages and larger contexts use more), use that as the prior for step 2 and treat
   the measured ticks as the check. The synthesis rule stands: do not build the governor on the documentation claims alone.
5. **Cache reads.** Use a read-heavy block (one 90K write, then many reads of it, 5-minute TTL) against a write-heavy block of
   the same dollar cost. If reads are discounted on the meter, the read block ticks less. At the cache-read price (0.1 x input) a read
   block of the same cost needs about 12 times the tokens, so this is the cheapest-in-dollars cell to test and the most
   valuable for the shadow and interpreter paths, which are cache-read heavy.

## Limits of this capture

- One account, one afternoon, one CLI version (2.1.295). The event shape may change with the CLI or the plan.
- The utilisation precision (0.01) and unattributed concurrent use mean no weight, only an order of magnitude, is claimed.
- The CLI default system prompt (about 2.5K tokens) is in every call; a policy that changes `--system-prompt` or `--tools` changes it.
- Haiku 5.5 prompts over 100K tokens use the higher price tier (policy notes); the ladder stayed at 92K tokens per call.
