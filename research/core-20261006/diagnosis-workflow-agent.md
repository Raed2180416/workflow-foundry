# P1 (p1-records-v3) diagnosis: fhand arms, b0agent failures, cost accounting

Date: 2026-10-08. Read-only diagnosis. No git state, project files or frozen code were changed.
Sources:
- `experiments/runs/p1/results.jsonl` (288 records)
- `run.1.log` (62 lines) and `run.log` (226 lines)
- `journal.sqlite` (1,863 model calls)
- the kept work dirs under `/var/tmp/foundry-work/p1/p1-records-v3/`
- frozen code at 880c6b9

Evidence labels used below: **observed** (read directly from the files), **re-evaluated** (a check definition re-run by hand against journaled outputs), **inference**, and **unavailable**.

## 0. Inspection record
The 12 test tasks (records `test` split, d3 and d4, seeds 5001–5006) are now **INSPECTED**. Task hashes are listed in PREREG §Amendments. This diagnosis read their content:
- every status-value sentence of all 12 tasks;
- the ATLAS, BRIGHTDESK, KOBO and VENDEX notes sentences of d3/s5002, d3/s5005, d4/s5001 and d3/s5006;
- export lines of d3/s5001;
- oracle mismatches and b0agent answers for 7 trials.

These seeds can no longer serve as held-out instances for any later workflow version or skill change. This needs a dated entry in the P1 record (`research/core-20261006/PREREG.md` Amendments or the P1 report). I did not write that entry, because this task allowed scratch files only.

## Headline
1. **fhand-haiku's only failure is a false pass.** Run verdict = pass, check score 1, 0 reasons; oracle = fail.
   - Cause: in `statuses`, Haiku read a void status as live and returned `relation:"none"`. `STATUS_CHECKS` accept any meaning when the relation is "none".
2. **All 3 escalations in fhand-haiku are `perspective` nodes M→L.** None of them changed the field the merge uses.
3. **B0-Haiku failures at d4 are mostly timeouts.** An unregistered 300 s timeout caused 29 of the 30 MODEL_TIMEOUTs, all at d4. B0-Haiku calls that did not time out at d4 passed 7/7 (med), 4/4 (B0+N) and 11/14 (none).
4. **Cost accounting violates PREREG §3.**
   - 30 timed-out calls are recorded at $0. The journal flags them costUnknown with a $1 bound; the b0-call adapter drops the flag.
   - 1 killed Foundry run ($0.064 journaled) is missing from the results.
   - Calls in flight at the 23:17 stop are unobservable.
5. **The frozen analyzer never prints d4.** `analyze.mjs:11` loops over `['all','d2','d3']`.

---

## (a) fhand-haiku: the failure, the escalations, verdict honesty

### The one failure: d3/s5002 t1 (run `18480c39`, $0.0117, 18 calls, no escalation)
- **Oracle (observed):**
  - score 0.9459; 39 predicted vs 37 entities; extra = 2, slack = 0;
  - pairF1 = 1, fieldAccuracy = 1.
  - So two void rows were emitted as live single-row records. Everything else was exact.
- **Cause (observed, journal id 220, `root/statuses:1/judge`, ATLAS token `:: DORMANT`):**
  - Haiku returned `{meaning:"live", relation:"none", compared_with:"none"}`.
  - Its own quote was: *Do not confuse ":: DORMANT" with lines without a trailing tag: these rows are not real accounts and stay out of the master list.*
  - Trials t0 and t2 of the same task returned `void / different_from / ordinary_live_rows`. All 3 fhand-sonnet trials did the same.
  - Haiku was right on 2 of 3 trials for this token. Across all 12 tasks × 6 fhand trials, this is the only wrong status judgment.
  - The wrong call used 1,030 output tokens, against 460–466 for the correct ones (n = 1, anecdotal).
- **Why the check passed (re-evaluated):** `STATUS_CHECKS` (`experiments/workflows/records-v3.mjs:1027-1038`) require:
  1. the quote is in the paragraph — true;
  2. the token appears in the quote — true;
  3. `relation == "none"` OR (relation consistent with the meaning of the named marker) — true via "none".

  With relation "none", the meaning is unchecked. The final `check` node has no invariant that would notice 2 void rows kept live.
- **Verdict (observed, workspace `foundry.sqlite` kept because the trial failed):**
  - `status: succeeded`; `check {pass:true, score:1, reasons:[]}`.
  - `run.verdict {verdict:"pass", authority:"supported", establishesCompletion:false}`.
  - The verdict does not claim task completion (`establishesCompletion:false`). But the workflow's own acceptance evidence said pass on an oracle-failed trial.
- **Verdict vs oracle over 72 fhand trials (observed):**

  | Arm | Verdict pass, oracle pass | Verdict pass, oracle fail | Verdict fail |
  |---|---|---|---|
  | fhand-haiku | 35 | **1** | 0 |
  | fhand-sonnet | 36 | 0 | 0 |

  Failure detection on real failures: 0/1. This is a verifier gap: the check relies on the model's own relation label to decide whether its meaning gets checked.
- **Possible fixes (for a NEW workflow version, dev seeds only; P1's workflow is frozen):**
  - a lexical guard on the quote (void phrases such as "not real accounts", "stay out", "excluded", "never belonged" must agree with `meaning`);
  - force `relation` when the quote starts "Do not confuse" or "Treat … exactly like";
  - or a second independent read for status tokens, as done for VENDEX.

### Escalations (3, all `perspective`, M Haiku 5.5 → L Sonnet 5.5; observed in the journal)
The runtime's recorded escalation decisions are **unavailable**: passing work dirs are deleted (`experiments/lib/runner.mjs:86`). The failing check was re-evaluated from the journaled output and paragraph.

| Trial | Run | Node (system) | Haiku output | Failed check | Sonnet output | Changed merge input? |
|---|---|---|---|---|---|---|
| d3/s5005 t0 | 3a3397f3 | perspective:0 (BRIGHTDESK) | positive / they_owe_us / we_owe_them; `master_span` "printed the same way as the master" | span not verbatim (paragraph says "prints balances the same way…") | same values; span = whole sentence | No |
| d4/s5001 t0 | c8d4be97 | perspective:3 (KOBO) | positive / they_owe_us / **they_owe_us** | `positive_… ≠ negative_…` | negative → we_owe_them | No |
| d4/s5001 t2 | 41374539 | perspective:3 (KOBO) | same as t0 | same | same as t0 | No |

- The merge consumes only `positive_in_master` (`records-v3.mjs:628`). Haiku and Sonnet agreed on that field in all 3 cases (inference from the code).
- The escalations fixed evidence and auxiliary fields, not the answer. They are precautionary, not outcome-changing.
- Cost: 3 Sonnet calls, $0.0226 total, 4.0% of the arm's spend. Each one costs about 13× a Haiku node call. On d3/s5005 it raised that trial to $0.0215, against $0.014 for its siblings.
- Verdicts on all 3 escalated trials were pass, and the oracle passed them: honest.
- The journal's `attempt` stays 1 across escalations and resamples. Read `model_id` and `sample_index` to see them.

Related, fhand-sonnet (observed): 3 resamples at maxClass, all on `dates:2` (VENDEX) in d3/s5006 t0, t1 and t2.
- Sonnet answered `order:"mdy"` with `basis:"same_as_system", same_as_system:"LEDGR"`, but LEDGR is fixed as dmy.
- The consistency check failed, and the resample returned dmy. Cost $0.024.
- Adjudication (`adjudicate`) was never called in either arm (0 VENDEX country disputes in 72 runs).

---

## (b) Cost profile: fhand-sonnet vs fhand-haiku (journal; prices from `policy/models.json`)
- The price model reproduces all 1,863 journaled costs exactly:
  `cost = input·p_in + cache_read·0.1·p_in + cache_write·2·p_in + output·p_out`.
  Every CLI call writes a 1-hour ephemeral cache at 2× the input price. The journal's `input_tokens` is about 2 per call; the prompt is in `cache_write_tokens`.
- Both arms make 819 calls (22.75 per trial).
  - fhand-haiku: **$0.5682**, $0.0158 per trial, CPS $0.0162.
  - fhand-sonnet: **$7.6739**, $0.2132 per trial, CPS $0.2132.
  - Ratio **13.5×**, against a 20× list-price ratio.
  - Latency p50 is 31 s (Haiku) vs 35 s (Sonnet).

| Node | Calls | Haiku $/trial (share) | Sonnet $/trial (share) | Sonnet/Haiku | Out tok/call H / S |
|---|---|---|---|---|---|
| vendex | 138 | 0.00387 (24.5%) | 0.0505 (23.7%) | 13.0× | 1412 / 679 |
| vendex_b | 138 | 0.00400 (25.3%) | 0.0496 (23.3%) | 12.4× | 1489 / 691 |
| perspective | 144 | 0.00224 (14.2%) + L escalations 0.00063 (4.0%) | 0.0310 (14.5%) | 13.8× (M only) | 576 / 224 |
| dates | 108 / 111 | 0.00158 (10.0%) | 0.0263 (12.4%, incl. 3 resamples) | 16.7× | 495 / 292 |
| statuses | 90 | 0.00111 (7.0%) | 0.0180 (8.5%) | 16.3× | 328 / 158 |
| mirror | 108 | 0.00109 (6.9%) | 0.0189 (8.9%) | 17.3× | 214 / 107 |
| countries | 54 | 0.00086 (5.4%) | 0.0118 (5.5%) | 13.7× | 652 / 290 |
| atlas_switch | 36 | 0.00041 (2.6%) | 0.0071 (3.3%) | 17.2× | 311 / 184 |

- **The two VENDEX reads are about half of each arm's spend** (49.9% Haiku, 47.0% Sonnet).
- **Cost mix by token type:**

  | Arm | Output tokens | Cache writes | Cache reads | Uncached input |
  |---|---|---|---|---|
  | fhand-haiku | **57.0%** | 40.7% | 2.3% | ≈0% |
  | fhand-sonnet | **39.3%** | 57.5% | 3.1% | ≈0% |

  For Sonnet, the 2× cache-write premium on each call's unique prompt is the largest cost item. If that prompt were billed as plain input, Sonnet would cost about 29% less and Haiku about 20% less (inference; this is a property of the route).
- **Haiku 5.5 emits about 2.1× Sonnet's output tokens for the same visible JSON:** 777 vs 369 per call.
  - Output tokens per visible answer character: Haiku 1.1–2.1, Sonnet 0.5–1.1, Haiku 4.5 0.67.
  - Inference: Haiku 5.5 produces hidden reasoning even at `effort low` with `MAX_THINKING_TOKENS=0`.
  - Thinking tokens are not journaled: `src/models/providers/claude-cli.mjs:28`, `usageOf`, keeps 4 usage fields and drops `output_tokens_details`.
  - That compresses the price advantage from 20× to 13.5×.
- **Trial cost depends on cache warmth (observed).** The first fhand-sonnet trial after the 8 h pause (d3/s5003 t1) cost **$0.2985**, against $0.1967 and $0.1979 for t0 and t2: +52% for identical work.
  - Cache reads were 6.3K vs 33.3K tokens; cache writes 55.3K vs 28.3K.
  - In the first 10 minutes after the resume, 12 Haiku and 18 Sonnet node calls had cache_read = 0.
  - Trial costs are therefore not independent of scheduling: the 1-hour prompt cache is shared across trials (and possibly across arms on the same model).
- For comparison, the B0 single-call cost mix is dominated by output tokens: b0call-haiku 88–89%, sonnet 72%, haiku45 50%.

---

## (c) b0agent-haiku: the 7 failures (transcripts kept in the 7 failing work dirs)
- Setup (observed in the transcript init events): Claude Code 2.1.293, Haiku 5.5, tools Bash/Edit/Glob/Grep/Read/Write.
- None of the 36 trials hit the 20-minute limit (max 489 s) or the $1 budget (max $0.349). costUnknown is false for all.
- **Common strategy in all 7 failures (observed):**
  1. Print the inputs.
  2. Resolve everything in thinking: 54–73K thinking tokens of 59–79K output tokens, about 90% of output.
  3. Hand-write a Python script holding a **literal table of resolved persons** (rows, names, date of birth, country, phone, amount, currency).
  4. Code only does FX, rounding and the JSON output. No part of the main script parses the export.
- **Failure modes (oracle details and answers, observed):**

| Trial | Score | Oracle | Cause |
|---|---|---|---|
| d3/s5001 t2 | 0 | extra 42, missing 42 | row ids replaced by the line numbers the agent printed (`enumerate(lines,1)` → 1, 3, 5…) |
| d3/s5002 t2 | 0 | extra 37, missing 37 | same, 0-based line indices |
| d4/s5005 t2 | 0 | extra 60, missing 61 | same, 0-based line indices |
| d3/s5001 t0 | 0.966 | extra 1 (slack 0 at E=42) | one namesake mis-resolution (Krueger vs "Kreger", wrong phone, null amount) |
| d3/s5002 t0 | 0.597 | extra 10, birth_date acc 0.757 | BRIGHTDESK date order (notes: UK locale, dmy; agent used mdy), under-merging (wrong entity_ids), wrong amounts |
| d3/s5002 t1 | 0.625 | extra 9, birth_date acc 0.784 | same pattern as t0 |
| d3/s5005 t1 | 0.705 | extra 8, birth_date acc 0.846 | dd/mm swaps, a DE/CH namesake mis-merge, accents stripped (Léa→Lea, Kühn→Kuhn), amounts |

- 3 of 7 are an id-mapping slip that the oracle scores 0. These are schema-valid, so not caught as schema-invalid.
- The other 4 are in-head judgment and transcription errors: date convention, identity, accents.
- Failures by difficulty: d3 6/18, d4 1/18. The d4 trials spent 3× more ($0.167 vs $0.055 per trial) and used more turns.
  - Whether the d4 passes used a different strategy (for example a real parser) is **unavailable**: passing work dirs are deleted (`runner.mjs:86`).
- In 5 of 7 failing transcripts (d3/s5001 t2, d3/s5002 t0/t1/t2, d4/s5005 t2) the agent noticed memo text in the export asking for `amount_usd` 0, and explicitly declined to act on it. This is unrelated to the failures.
- **d3/s5002 is the hardest task:**
  - fhand-haiku 2/3, b0agent 0/3, b0call-haiku-none 1/3, b0ncall 2/3;
  - sonnet single call 3/3, fhand-sonnet 3/3.
- Rate-limit events in the transcripts were `allowed_warning` only (five-hour utilization up to 0.91, seven-day up to 0.90). There were no rejections.

---

## (d) Cost accounting integrity

### Recorded vs journal (observed)
| Arm | Results $ | Journal $ |
|---|---|---|
| b0call-haiku45-none | 1.9849 | 1.9849 |
| b0call-sonnet-med | 8.8890 | 8.8890 |
| fhand-haiku | 0.5682 | 0.5682 |
| fhand-sonnet | 7.6739 | 7.6739 |
| b0call-haiku-none | 1.0914 | 1.0914 |
| b0call-haiku-med | 0.9251 | 0.9251 |
| b0ncall-haiku-med | 0.9071 | 0.9071 |
| b0agent-haiku | 3.9901 | (not journaled) |
| **orphan run 9d8a2644** | **0** | **0.0640** |
| Total | 26.0297 | 22.1037 |

- For all 72 fhand trials, the journal call count and cost equal `meta.calls` and `costUsd`.
- b0agent spend rests only on the CLI's own `total_cost_usd`. There is no independent journal.

### costUnknown
- Results: 0 trials flagged.
- Journal (observed): **30 calls** with `costUnknown:true, costUpperUsd:1` in the response, all `MODEL_TIMEOUT` on Haiku 5.5:

  | Arm | Timed-out calls | At d4 | At d3 |
  |---|---|---|---|
  | b0call-haiku-med | 11 | 11 | 0 |
  | b0call-haiku-none | 4 | 4 | 0 |
  | b0ncall-haiku-med | 15 | 14 | 1 |

  - Each has `cost_usd` 0 and an input-only `costEstimateUsd` of $0.00084–0.00091.
- **Defect:** `experiments/lib/arms/b0-call.mjs:17` returns only `costUsd` and `imputedUsd`. It drops `costUnknown`, `costUpperUsd` and `costEstimateUsd`, so `runner.mjs:81` records `costUnknown:false` and $0.
  - This violates PREREG §3: "Calls whose spend could not be observed (killed calls) are charged at their bound and reported separately".
  - The frozen analyzer also has no costUnknown column.
- **CPS with timed-out calls charged at their $1 bound:**

  | Arm | Recorded CPS | CPS at bound |
  |---|---|---|
  | b0call-haiku-med | 0.040 | **0.519** |
  | b0call-haiku-none | 0.044 | **0.204** |
  | b0ncall-haiku-med | 0.053 | **0.936** |

  - Realistic spend per timed-out call, inferred: about 300 s × ~275 output tok/s ≈ 82K tokens, so about $0.045. That gives about $1.35 over 30 calls, if cancelled streams are billed for generated tokens (inference).
  - Either way, fhand-haiku's CPS ($0.0162) stays lowest. The pre-registered rule nevertheless requires the bound.

### Imputed spend
0 everywhere. Correct: hosted models only, and no `imputedComputeUsdPerHour` for claude-cli.

### Restarts: one interruption is visible in P1's data (observed)
- Last journaled call: 2026-10-07 23:17:47Z.
- Container boot: 2026-10-08 07:08:39Z (`/proc/1` start time, `uptime` 2:20 at 09:29).
- Resume: 07:09:34.
- The container restart falls inside the owner-stop window.
- There is no other period of more than 60 s with no model call in flight, between 22:52:02 and 09:18:05.

**Log vs results:** 288 log lines = 288 results, each key once. There are no duplicates, no orphan lines, and no `ENV FAULT` or `STALL` lines.

**Killed in flight at 23:17:47**, reconstructed from the deterministic interleave (concurrency 4, stateless jobs 0–54 picked, 51 done) and the stream states:
- **fhand-sonnet d3/s5003 t1:** orphan Foundry run `9d8a2644` (salt `fhand-sonnet:t1`, prompts identical to d3/s5003).
  - 9 journaled Sonnet calls, **$0.0640, absent from results**: it is not in fhand-sonnet's total or CPS.
  - Node calls still in flight at the kill were never journaled.
- **b0call-haiku-med d3/s5003 t0** and **b0call-haiku-none d3/s5003 t1:** single CLI calls in flight. The journal writes only after a call completes, so these are **unobservable**.
- **b0agent-haiku d3/s5003 t1:** Claude Code session killed. Its spend is **unobservable** (no result event).
- **b0ncall-haiku-med streams:** t0 (next task d3/s5006) and t1 (next task d4/s5005) were probably mid-call (inference). Stream t2 had not started; it is ordered last in the stream pool.
- All of these were re-run after the resume and recorded once.
- PREREG §3 would charge the unobservable calls at their bound and report them separately:
  - ≤ 4 CLI calls + 1 agent session at $1 each;
  - plus fhand-sonnet's in-flight node calls.
  - This was not done.
- **Unavailable:** whether `claude` child processes outlived the parent before the container restart (if they did, unjournaled spend).

### Retries under `envFaultRule`
None.
- No `results.faults.jsonl` exists.
- `MODEL_TIMEOUT` is not in `ENV_FAULTS` (`runner.mjs:19`), so the 30 timeouts were recorded as failed outcomes, not retried.
- The journal has no `MODEL_RATE_LIMIT` or `MODEL_UNAVAILABLE` errors.

### Kill rule (§6)
Not triggered:
- recorded total $26.09 including the orphan;
- with timed-out calls at their bound, $56.09, under the $60 limit;
- worst arm at bound: b0ncall-haiku-med $15.91, under the $20 limit.

---

## Protocol issues that affect the P1 report (beyond a–d)
1. **Unregistered 300 s timeout on B0 calls.**
   - Where: `src/models/providers/claude-cli.mjs:64` and `src/models/port.mjs:112`, both `timeoutMs = 300000`. `run.mjs:20` does not override it. PREREG §2 lists only the "$1 per-call CLI cap".
   - Why it binds: Haiku 5.5 single calls emit 50–84K output tokens at about 275 tok/s.
   - Latency of successful calls (p50 / p90 / max):

     | Arm | d3 | d4 |
     |---|---|---|
     | b0call-haiku-med | 223 / 258 / 263 s | 279 / 300 / 300 s |
     | b0call-haiku-none | 192 / 230 / 230 s | 251 / 292 / 296 s |

     The fastest successful call took 299.7 s, so the distribution is censored at the cap.
   - Consequence: at d4, B0-Haiku "failures" are mostly censoring by the harness. "fhand-haiku vs b0call-haiku-*" at d4 is confounded.
   - At d3 (1 timeout in 54 calls) the comparison is within noise: fhand-haiku 17/18 vs 16/18 (med), 14/18 (none), 13/18 (B0+N).
2. **The frozen analyzer omits d4 rows** (`experiments/p1/analyze.mjs:11`: `['all','d2','d3']`). The per-difficulty table needs a declared deviation, or an amendment computed outside the frozen file.
3. **"Thinking off" is not supported by the token evidence.**
   - b0call-haiku-none (effort low, `MAX_THINKING_TOKENS=0`) averages 59.8K output tokens per successful call, against 8.3K visible answer characters: 7.2 tokens per character. Haiku 4.5 under the same mapping: 0.67.
   - Amendment 3's 53-token probe does not carry over to this task.
   - The arm label `b0call-haiku-none` = "thinking off" should be reported as "effort low; hidden reasoning probable, not observable" (inference).
   - The "8K thinking budget" of the med arms is not a cap either: 66–70K output tokens.
4. **The B0 arm's `maxTokens: 16000` was never applied.** The definition is part of the arm hash. The CLI route maps it to `provider-default` (documented at `src/models/port.mjs:53-59` and recorded per call). PREREG §8 names the missing temperature control but not max tokens.
5. **The Haiku 4.5 reference arm (0/36)** mostly fails the oracle's structural rule: 22 of 36 trials have `row-in-multiple-records` and score 0. It should not be read as a pure capability gap without that note.

## Unavailable or unknown evidence
- Runtime escalation and check records for passing fhand trials: their work dirs are deleted.
- Thinking-token counts for CLI node and B0 calls: not journaled.
- Spend of calls and sessions killed at 23:17:47, and of the 30 timed-out calls (bound and estimate only).
- Strategies of the 29 passing b0agent trials: transcripts deleted with their work dirs.

## Suggested record actions (for the owner or orchestrator; not done here)
1. Add a dated P1 deviation and amendment entry covering:
   - the test seeds are INSPECTED (section 0);
   - the B0 cost-unknown defect and CPS at bound;
   - the orphan $0.064 and the unobservable killed calls;
   - the unregistered 300 s timeout and the d4 censoring;
   - the analyzer d4 omission;
   - the "thinking off" and maxTokens caveats.
2. Report fhand-haiku's verdict false pass under the evidence for C4 (failure handling), as a negative result.
3. Fixing the b0-call adapter and the analyzer touches `experiments/`, which this task may not edit. Do it as a post-hoc, labelled analysis; do not re-score the frozen run.

Scripts used (all read-only, in the scratchpad `p1diag/`): `schema.mjs`, `ws.mjs`, `ws2.mjs`, `jq.mjs`, `one.mjs`, `statuses.mjs`, `cost.mjs`, `errs.mjs`, `recon.mjs`, `inflight.mjs`, `gaps.mjs`, `tx.mjs`, `txsum.mjs`, `b0lat.mjs`, `vis.mjs`, `misc.mjs`, `cold.mjs`, `tot.mjs`, `vercheck.mjs`.
