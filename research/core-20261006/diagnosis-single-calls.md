# P1 diagnosis: single-call arms (timeouts and failures)

Date: 2026-10-08. Diagnostic only. No model calls were made. Read-only sources: `experiments/runs/p1/results.jsonl`, `experiments/runs/p1/journal.sqlite` (opened read-only), `run*.log`, the bed (`beds/records`, regenerated truth through `referenceSolve`), arm, port and provider code, and PREREG. No repository files were changed. The analysis scripts are `diag1.mjs` to `diag7.mjs` in this scratchpad.

**INSPECTED record (to be entered as a PREREG amendment by the owner of that file):** all 12 test tasks (`records` test split, seeds 5001–5006, d3 and d4) were inspected on 2026-10-08 during this diagnosis. That covered regenerated truth for every task, every failing single-call output compared with truth, and quoted export lines and source-note sentences from d3/s5001, d3/s5003, d3/s5004 and d4/s5005. From now on these tasks are not held-out evidence.

## 1. Outcome overview (36 trials per arm)

| arm | pass | MODEL_TIMEOUT | oracle fail | pass among finished calls | mean score |
|---|---|---|---|---|---|
| b0call-haiku-none | 25 | 4 (all d4) | 7 | 25/32 | 0.870 |
| b0call-haiku-med | 23 | 11 (all d4) | 2 | 23/25 | 0.664 |
| b0ncall-haiku-med | 17 | 15 (14 d4, 1 d3) | 4 | 17/21 | 0.542 |
| b0call-haiku45-none | 0 | 0 | 36 | 0/36 | 0.197 |
| b0call-sonnet-med | 28 | 0 | 8 | 28/36 | 0.983 |

- The journal holds exactly 30 MODEL_TIMEOUT rows, all `node_key=b0` on `claude-haiku-5-5`. No other call in P1 timed out. The slowest workflow node call took 32 s.
- At d4 the timeouts cover 29 of 54 Haiku 5.5 single-call trials (54%).
- Every d4 Haiku 5.5 call that finished passed in two arms: haiku-med 7/7 and b0ncall 4/4. haiku-none passed 11 of 14.

## 2. Timeouts

### What the limit was and where it comes from
- The limit was **300 s wall clock per model call**. The clock starts after the semaphore is acquired, so queue wait is not counted (`src/models/port.mjs` call path).
- The value is a default, not something the experiment chose:
  - `ModelPort` defaults to `timeoutMs = 300000` (`src/models/port.mjs:112`).
  - `ClaudeCliProvider` also defaults to `timeoutMs = 300000` (`src/models/providers/claude-cli.mjs:64`). The provider would accept up to 3,600,000 ms.
  - Nothing overrides it: `experiments/p1/run.mjs` (`createModelPort(...)`, `b0Call(...)`), `experiments/lib/models.mjs:33` and `experiments/lib/arms/b0-call.mjs` all leave the timeout unset.
- When the port deadline aborts the CLI, the call is journaled as `MODEL_TIMEOUT`, message "claude CLI Subprocess cancelled". Latencies were 300.28–300.85 s.

### Was it pre-registered? No.
- PREREG §2 gives the B0-call arms only "per-call CLI cap $1". By contrast, b0agent has "$1, 20 min" and fhand has "$2, 20 min". No wall-clock limit is stated for single calls.
- The 300 s value is frozen only implicitly, because `src/` is in the freeze hash.
- §6 (kill rule) covers rate-limit misses above 20%, not timeouts. Timeouts made b0ncall miss 15/36 trials (42%) and b0call-haiku-med 11/36 (31%), and no rule applied.
- §5's environment-fault rule ("usage limits, outages, sandbox unavailable") and the runner's `ENV_FAULTS` (`experiments/lib/runner.mjs:19`) both leave out MODEL_TIMEOUT. Timeouts were therefore scored as failed trials (`{"noOutput":true}`, score 0) and not retried. That is consistent with PREREG and the runner. It does not match `research/core-20261006/DESIGN.md` §5.2, which classes MODEL_TIMEOUT as `env_fault`.
- §7 estimated a Haiku 5.5 single call at under $0.01. The actual median was $0.029–0.044. The B0 configuration on Haiku 5.5 was not piloted at task scale before freezing:
  - Amendment 3's probe was one tiny structured call with 53 output tokens.
  - `records-v3/dev-log.jsonl` has no B0 entries.

### How long the calls ran and how many tokens they produced
- **Timed-out calls:** usage is all zero and `text` is null, so there is **no partial data**. The CLI's `--output-format json` writes one result object at exit, and the process was killed before that.
- **Finished Haiku 5.5 single calls:**

| arm | d3 latency (min/med/max) | d3 output tokens (min/med/max) | d4 latency (min/med/max) | d4 output tokens (min/med/max) |
|---|---|---|---|---|
| haiku-none | 159/192/230 s | 42K/52K/64K | 204/251/296 s | 55K/69K/82K |
| haiku-med | 198/223/263 s | 54K/62K/73K | 244/279/300 s | 68K/76K/84K |
| b0ncall | 195/249/271 s | 54K/70K/74K | 282/291/293 s | 79K/81K/82K |

- The d4 distributions are censored at 300 s: only the shorter generations finished.
- Throughput was flat at about 275 output tokens/s across d3, d4 and both CLI versions (2.1.293 and 2.1.294). Day-1 d3 medians were 61.6K tokens at 274 tok/s; day-2 d3 medians were 59.8K at 276 tok/s. The CLI version change is not a confound: timeouts happened on both versions (3 on day 1, before the 23:17 stop; 27 after the 07:09 resume).
- **By the kill point, a timed-out call had produced about 300 s × 275 tok/s ≈ 82K output tokens** (estimate). The largest finished call was 83,666 tokens at 299 s.

### How large the expected answer is
| | export rows | true records | bed output budget (`400 + 60·rows`) | median answer text |
|---|---|---|---|---|
| d3 | 85 | 37–45 (mean 40.5) | 5,500 tokens | 7.2K chars |
| d4 | 115 | 47–61 (mean 54.2) | 7,300 tokens | 9.8K chars |

- The d4 answer is about 1.35× the d3 answer.
- Haiku 4.5 (thinking off) emits about the answer and nothing more: tokens ≈ −543 + 60.1·rows, about 4.4K tokens at d3 and 5.9K at d4.
- Haiku 5.5 emits about 615 tokens per export row (fit: −525 + 615·rows for haiku-none). That is roughly 10× the answer, so **about 90% of Haiku 5.5's output tokens are not in the returned answer**. Measured as answer characters per output token: Haiku 5.5 B0 0.11–0.15, Haiku 4.5 1.68, Sonnet 0.50.
- This is true for the "none" arm as well (effort low, `MAX_THINKING_TOKENS=0`). Haiku 5.5 workflow nodes at reasoning none also show 0.5–0.9 characters per output token.
- What these extra tokens are is not known; the journal stores only the result object. Candidates:
  - adaptive thinking that is not actually off on this route at task scale;
  - visible text before the tool call that the CLI drops from `result`;
  - structured-output retries. These explain little: 3-turn calls are a minority (3/32, 2/25 and 6/21) and their token counts are similar.

  This also puts the "thinking off" label of `b0call-haiku-none` in doubt at task scale.

### Would the calls have finished? Very likely yes.
- Time scales with size: about 2.2 s per export row for haiku-none, and the fitted output tokens predict about 257 s at d4. The haiku-med and b0ncall fits are biased low by censoring.
- Scaling each arm's d3 latencies by 115/85 predicts the observed d4 timeout rates:

| arm | predicted d4 timeouts | observed |
|---|---|---|
| haiku-none | 2/18 | 4/18 |
| haiku-med | 9/18 | 11/18 |
| b0ncall | 14/17 | 14/18 |

- The largest scaled latency is 312 s (none), 355 s (med) and 367 s (b0ncall). With a 420 s or 600 s cap, the same model predicts **0** timeouts.
- Scaled token needs are at most about 86K (none), 98K (med) and 100K (b0ncall), below Haiku 5.5's 128K output limit (claude-api skill model notes, cached 2026-10-06). No finished call stopped on `max_tokens`; all ended with `stop_reason=tool_use`.
- Unknown: whether the CLI imposes its own per-response ceiling between 84K and 100K tokens.

### Property of single calls, or a harness choice? Mainly a harness choice that handicaps this baseline.
- One call per task is not slow in itself. Haiku 4.5 finishes in 34 s (d3 median) and 44 s (d4); Sonnet in 89 s and 127 s. The answer itself is modest at 5–7K tokens.
- The 300 s limit binds only on Haiku 5.5, because on this route it generates about 10× the answer. At d4, wall time straddles 300 s.
- The limit is an unconfigured port default. The comparison arms got 20 minutes: B0 executor (b0agent) and the F workflow (fhand).
- **The pre-registered success comparisons of fhand-haiku against b0call-haiku-med, b0ncall-haiku-med and b0call-haiku-none are inflated by the cap at d4.** These are bounds, not imputations, and the finished calls are a shorter, selected subset:

| arm | reported success | success among finished calls |
|---|---|---|
| haiku-med | 0.64 | 0.92 |
| haiku-none | 0.69 | 0.78 |
| b0ncall | 0.47 | 0.81 |

- b0ncall's notes may add to the problem. Notes with the prefix produce about 12% more tokens at d3 (median 70K vs 62K), and the notes are long procedural checklists ("row ledger", "provenance log"). This is a hypothesis only.

### Cost accounting deviation (PREREG §3)
- In `results.jsonl`, timed-out trials carry `costUsd` 0 (b0call) or $0.0007–0.0018 (b0ncall, which is only the notes call), with `costUnknown: false`.
- The journal rows do carry `costUnknown: true` and `costUpperUsd: 1`, but `experiments/lib/arms/b0-call.mjs:17` does not pass them through.
- By contrast, `b0-agent.mjs:56-57` charges killed sessions at their bound, as PREREG §3 requires ("charged at their bound and reported separately").
- So the CPS that `analyze.mjs` reports for the three Haiku 5.5 B0 arms is below the pre-registered rule:

| arm | reported CPS | CPS at the $1 bound | CPS at estimated spend (~$0.045 per killed call) |
|---|---|---|---|
| haiku-none | $0.0437 | $0.204 | $0.051 |
| haiku-med | $0.0402 | $0.518 | $0.062 |
| b0ncall | $0.0534 | $0.936 | $0.093 |

- The estimated spend assumes about 82K output tokens plus a cache write per killed call. Whether a killed call is billed was not observed.

## 3. Failures other than timeouts (oracle classes)

The oracle passes a trial only if field accuracy ≥ 0.97, pair-F1 ≥ 0.95, and extra and missing entities are each ≤ slack, where slack = ⌊0.02·E⌋. Slack is 0 for every d3 task and for d4/s5003 and d4/s5006, which have 47 entities, so **a single missing or extra entity fails the trial**.

### b0call-haiku-none: 7 fails
| class | trials | detail |
|---|---|---|
| amount sign / perspective | 2 | d3/s5001 t2: amount accuracy 0.619, 16 sign-inverted amounts. d4/s5006 t0: 0.745. |
| identity clustering | 4 | d3/s5002 t0: one ATLAS+VERITAS person split in two, plus one day/month swap. d3/s5002 t2: pair-F1 0.746, 9 extra, about 10 splits. d3/s5005 t1: two people merged. d4/s5005 t2: merge, pair-F1 0.910, field accuracy 0.950. |
| wrong amount values (winner or FX) | 1 | d4/s5002 t1: field accuracy 0.962. |

### b0call-haiku-med: 2 fails
- d3/s5001 t0: amount sign flips (field accuracy 0.946). The same 16 entities are flipped in haiku-none t2 and b0ncall t2.
- d3/s5004 t2: score 0, extra = missing = 40. **The output uses export line ordinals (1..85) as `source_rows` and `entity_id`, not row ids.** Mapped back to row ids (diagnostic only), the output would pass with score 0.998.

### b0ncall-haiku-med: 4 fails
- d3/s5002 t0: clustering collapse, pair-F1 0.735 with 10 extra. Same pattern as haiku-none.
- d3/s5005 t0: ordinal row numbers. Mapped back, it would pass with score 1.000.
- d3/s5003 t1: the single-row KOBO entity 1283 is missing (its note reads "free SAMPLE order shipped; regular member").
- d3/s5001 t2: amount sign flips.

### b0call-haiku45-none: 0/36
| class | trials | detail |
|---|---|---|
| **`row-in-multiple-records`** (format rule: the oracle gives score 0 when any row id appears in two records) | 22 (d3 9, d4 13) | 79 offending rows (1–13 per output). 56 are a row placed both inside a merged record and again as its own singleton record. 23 are a row placed in two multi-row records. Only 1 is an identical duplicate record. |
| threshold failures | 14 | fieldAcc+pairF1+missing, usually also extra |

- Among the 14 threshold failures:
  - d3/s5001 t2 returned **an empty `records` array** (81 output tokens).
  - d3/s5004 t1 used ordinal row numbers (42 `source_rows` that are not row ids).
- **The format rule is not the deciding cause.** With duplicate rows removed (first occurrence kept; diagnostic only), the 22 format failures still pass 0/22: 19 fail fieldAcc+pairF1+extra+missing and 3 fail fieldAcc+pairF1+missing.
- Median per-field accuracy on matched entities across all 36 trials:

| field | accuracy |
|---|---|
| amount_usd | **0.14** |
| phone_e164 | 0.66 |
| birth_date | 0.85 |
| country | 0.85 |
| entity_id | 0.90 |
| given_name | 0.94 |
| family_name | 0.97 |

- amount_usd alone caps field accuracy at about (6 + 0.14)/7 ≈ 0.88, below the 0.97 threshold. Amount signs are flipped in 23 of 36 trials (54 flips, mostly entities with only BRIGHTDESK rows). The remaining amount errors are wrong winner or FX values.
- Clustering is also poor: many splits and merges, with pair-F1 roughly 0.33–0.87 where it was computed.
- The thinking-off setting does work on Haiku 4.5 (`MAX_THINKING_TOKENS=0`; see the comment in `src/models/port.mjs`). Output is about 60 tokens per row, the answer only, and latency is 3–93 s. It is a one-pass transcription that misses the per-task conventions (sign perspective, date order, statuses) and the FX and merge rules.

### b0call-sonnet-med: 8 fails, no timeouts (latency at most 204 s)
- **Field accuracy was never the failing criterion.** All 8 failures pass field accuracy. Five of them score at least 0.93; the other three score 0.927 (d4/s5005 t1), 0.913 (d3/s5003 t1) and 0.872 (d3/s5006 t1).
- **Missing entities: 3 trials, plus one d4 trial below:**
  - d3/s5001 t0: the single-row ATLAS entity 7867 is omitted.
  - d3/s5003 t1, two entities missing:
    - ATLAS 3735, tagged `:: DORMANT`, was dropped although the source notes say these rows "must be migrated, not dropped";
    - a three-row entity (ATLAS 2546, VENDEX 2684 and 6261) was omitted entirely.
  - d3/s5004 t0: LEDGR 7629 is omitted.
  - Why 7867 and 7629 were omitted could not be determined, because a single call returns no rationale.
- **Two distinct people merged: 5 trials:**
  - d3/s5006 t0 (missing 1);
  - d3/s5006 t1 (2 merges, pair-F1 0.879);
  - d4/s5001 t2 (pair-F1 0.937);
  - d4/s5003 t1 (missing 1, slack 0);
  - d4/s5005 t1 (merge plus split, LEDGR 5918 missing, pair-F1 0.919).
- Sign flips occur in 5 Sonnet trials, 5 in total, and never decide the outcome.
- 5 of the 8 failures are at d3, where slack is 0.

## 4. Implications and open items (no changes made)
1. **Missing PREREG amendment.** P1 needs an amendment that records three things:
   - the undeclared 300 s per-call limit, and that it bound only the Haiku 5.5 B0 arms (30/108 trials, 29 of them at d4);
   - the §3 accounting deviation in `b0-call.mjs:17`;
   - the INSPECTED status of seeds 5001–5006.
2. **Effect on conclusions.** The fhand-haiku vs Haiku 5.5 B0 success differences are partly a harness artifact and should be reported with that caveat; the finished-call figures in §2 are the bounds. The cost direction does not change:
   - fhand-haiku CPS is $0.0162;
   - the ratio against haiku-med goes from the reported 0.404 to about 0.26 at estimated spend, and about 0.03 at the bound.
3. **Unknowns:**
   - what Haiku 5.5's ~90% non-answer output tokens are. A future dev-seed probe could check this with stream output or verbose block types;
   - whether killed CLI calls are billed;
   - whether a longer cap would hit a CLI output ceiling;
   - whether the killed generations would have passed. Finished calls are a selected, shorter subset.
4. **Any re-run must be a separate, newly pre-registered experiment.** It needs fresh seeds, because 5001–5006 are now inspected. It should set an explicit B0 call timeout (for example 20 min, as the other arms have) and pass `costUnknown`/`costUpperUsd` through.
