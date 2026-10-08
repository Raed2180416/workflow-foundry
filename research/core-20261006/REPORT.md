# P1 report: `p1-records-v3` (Phase 1 exit experiment)

*2026-10-08. Development evidence. Pre-registration: [PREREG.md](PREREG.md). It was frozen at commit `880c6b9`, and the freeze record is in commit `a98d827`. Design: [DESIGN.md](DESIGN.md). This report applies the pre-registered rules to the frozen run. Every analysis that was not pre-registered is labelled **post-hoc**. No trial was re-scored. All post-hoc tables use the same `results.jsonl` and the frozen `experiments/lib/stats.mjs`; only cost fields are adjusted in memory.*

**Evidence tags**
- **[M] measured.** Recomputed for this report from `experiments/runs/p1/results.jsonl`, from `journal.sqlite` (opened read-only), from `run.1.log` and `run.log`, or from the code at HEAD `a02cd8b`. The frozen paths are byte-identical to the freeze: the combined sha256 was recomputed as `b261b68f5f59f6c76865869546d6fd2ade7ba9f2f80c392ab050b84964ff0402`.
- **[D] documented.** Stated in PREREG, DESIGN or ROADMAP, or found by the two read-only P1 diagnoses of 2026-10-08 and not re-measured here. The two diagnoses are the single-call diagnosis (timeouts and single-call failures) and the workflow diagnosis (fhand arms, b0agent and cost accounting). They are saved as [diagnosis-single-calls.md](diagnosis-single-calls.md) and [diagnosis-workflow-agent.md](diagnosis-workflow-agent.md).
- **[I] inferred.**

> **INSPECTED seeds.** On 2026-10-08 the P1 diagnoses read the content of all 12 test tasks: `records` v3.0.0, test split, seeds **5001–5006 at difficulty 3 and 4**. They read the regenerated truth, every failing output compared with truth, export lines and source-note sentences. These tasks are no longer held out. **They must never be reused as held-out evaluation tasks** (§8). The P1 numbers below stand, because the run finished before the inspection.

## Key numbers

| arm | executor | success | d3 | d4 | pass^3 | $/trial | CPS recorded | CPS, timed-out calls at the $1 bound (part of the PREREG §3 treatment) |
|---|---|---|---|---|---|---|---|---|
| `fhand-haiku` | hand workflow, Haiku 5.5 nodes (Sonnet 5.5 on escalation) | **35/36** | 17/18 | 18/18 | 0.917 | 0.0158 | **0.0162** | 0.0162 |
| `fhand-sonnet` | the same workflow, Sonnet 5.5 nodes | **36/36** | 18/18 | 18/18 | 1.000 | 0.2132 | 0.2132 | 0.2132 (0.2149 with the orphan run) |
| `b0call-sonnet-med` | one Sonnet 5.5 call, effort medium | 28/36 | 13/18 | 15/18 | 0.417 | 0.2469 | 0.3175 | 0.3175 |
| `b0call-haiku-none` | one Haiku 5.5 call, "thinking off" | 25/36 | 14/18 | 11/18 (4 TO) | 0.417 | 0.0303 | 0.0437 | 0.2037 |
| `b0call-haiku-med` | one Haiku 5.5 call, effort medium | 23/36 | 16/18 | 7/18 (11 TO) | 0.417 | 0.0257 | 0.0402 | 0.5185 |
| `b0ncall-haiku-med` | the same plus append-only notes | 17/36 | 13/18 (1 TO) | 4/18 (14 TO) | 0.167 | 0.0252 | 0.0534 | 0.9357 |
| `b0agent-haiku` | Claude Code agent, Haiku 5.5, 20 min | 29/36 | 12/18 | 17/18 | 0.667 | 0.1108 | 0.1376 | 0.1376 |
| `b0call-haiku45-none` | one Haiku 4.5 call, thinking off | 0/36 | 0/18 | 0/18 | 0.000 | 0.0551 | ∞ | ∞ |

TO is `MODEL_TIMEOUT` at a 300 s per-call limit that the pre-registration never stated (§4). The workflow's model nodes ran under the same 300 s per-call limit, set explicitly in the frozen workflow (records-v3.mjs:1178), but never came near it (longest 32 s). The last column charges only the 30 timed-out calls. The full §3 treatment also charges the work killed at the 23:17 stop (§4.4): b0call-haiku-none 0.2437, b0call-haiku-med 0.5620, b0ncall-haiku-med 1.0534 (two of its in-flight calls inferred), b0agent-haiku 0.1721, fhand-sonnet ≥ 0.2149. All values are [M]. The d3 and d4 columns come from the post-hoc script, because the frozen analyzer omits d4 (§1.3).

**Summary**
1. **The pre-registered rule is supported (directionally).** "Cheap workflow reaches strong-single-call success at lower cost":
   - success: fhand-haiku 0.972 [0.86, 1.00] against b0call-sonnet-med 0.778 [0.62, 0.88]; the intervals overlap;
   - CPS ratio: 0.051 [0.044, 0.063], so the upper bound is below 1.
   - Neither arm is touched by the timeout or by the accounting gaps. [M]
2. **Against the same cheap model in a single call, the success advantage is largely a harness artefact. The cost advantage is not.** The d3 figures below are **post-hoc** (§4.3). Against the Haiku 5.5 agent, which no limit cut off, the workflow is +0.167 [0.000, 0.389] (directional) at a CPS ratio of 0.118 [0.093, 0.229].
   - At d3, Haiku 5.5 single calls had one timeout in 54. There fhand-haiku scored 17/18, against 16/18 (effort medium), 14/18 ("thinking off") and 13/18 (with notes). The 6-point gap to effort medium is one trial; the 17- and 22-point gaps are directional only (bootstrap CIs exclude 0, but McNemar p = 1.000 on 6 tasks in one cluster).
   - At d4, 29 of 54 Haiku 5.5 single calls hit the unregistered 300 s limit.
   - At d3 the workflow's CPS is 0.29–0.40× that of the same-model single calls. [M]
3. **Same strong model, workflow against single call:** fhand-sonnet 36/36 against 28/36, CPS ratio 0.671 [0.575, 0.789]. This comparison is not affected by the timeout. The success side is directional only, and so is most of the cost side: per trial the workflow costs 0.86× a Sonnet call ($0.2132 against $0.2469); the rest of the 0.671 ratio comes from the success gap. [M]
4. **The workflow's own verdict is not a success signal.** It said "pass" on its only failure, so it detected 0 of 1 real failures. With one failure in 72 workflow runs its failure-detection rate is not measured; the gap itself (the status check accepts any meaning when relation is none) is confirmed in the journal and in records-v3.mjs:1027-1038. [M]
5. **The largest success difference measured is between model generations under the same nominal "thinking off" setting.** Haiku 5.5 against Haiku 4.5 single calls: +0.694 [0.472, 0.889], McNemar p = 0.004. It is the only success difference P1 resolves cleanly. [M] It is confounded with how much each model reasons under that setting (Haiku 5.5 emits about 12× the output tokens; §6.2 caveat 2), on one synthetic family. [I]
6. **Spend:**
   - recorded $26.03, plus $0.064 for an orphan run;
   - about $27.4 with an estimate (~$0.045 each) for the 30 timed-out calls; the calls killed at the overnight stop add a further small, unobserved amount;
   - $56.09 with the 30 timed-out calls charged at their bound, as PREREG §3 requires;
   - at least $61.09 if the calls killed at the overnight stop are also charged at their bound (§7). [M/I]
7. **What this is:** a hand-written ceiling workflow on one synthetic development family. It does not test construction, transfer or C1. [D/I]

## 1. What ran

### 1.1 As pre-registered
- **Tasks and trials.** Experiment `p1-records-v3`, family `records` v3.0.0, test split, d3 and d4, seeds 5001–5006: 12 tasks, K = 3, 8 arms, 288 trials. [D PREREG §1–2]
- **Integrity of the results file.** It holds 288 records with 288 unique (arm, task, trial) keys. [M]
  - Every arm hash and every task hash equals the freeze record. Arm hashes: b0call-haiku-none `6e4e5e7531d728c7`, b0call-haiku-med `0dc33013447a127b`, b0call-haiku45-none `96f491b40796fb6d`, b0call-sonnet-med `a4412f8467c9f792`, b0ncall-haiku-med `300d1084a005c802`, b0agent-haiku `81b94a94074a3c7b`, fhand-haiku `99d5c16663a15c39`, fhand-sonnet `73c72bcb3f2bb771`. [M]
  - The 87 frozen files are byte-identical to `880c6b9`. [M]
- **Run settings.** Stateless arms ran interleaved, rotated per task, in a pool of 4. The stateful B0+N arm ran its three stream orders in a separate pool of 2 (runner.mjs, Math.floor(concurrency / 2)), so up to 6 trials were in flight; its t2 stream ran entirely on day 2. envFaultRule: true and strictResume: true (experiments/p1/run.mjs). [M]
- **Models.** `claude-haiku-5-5`, `claude-haiku-4-5-20251001` and `claude-sonnet-5-5`, all through `claude -p`. Policy-subset hash `8726861174679e459e79d0452fb2a3f06730d7e9a8c2539284455edbbe256551`. [D]
  - 1,863 model calls are journaled. Every arm except b0agent is journaled. [M]
- **Class S was not run.** It was parked before freezing (owner decision 2026-10-07). [D] The ROADMAP §5.1 exit criterion asks for "S/M/L", so it is met for M and L only.
- **Context receipts.** All 1,647 workflow node calls in the journal carry a receipt hash. There are 268 distinct receipt hashes for 268 distinct prompt hashes. [M] Reproducibility was not re-checked by recompiling the prompts.

### 1.2 Timeline, restarts and reruns
| Time (UTC) | Event |
|---|---|
| 2026-10-07 22:52:44 | first result [M] |
| 23:17:47 | last journaled call before the owner stop; 62 results recorded (`run.1.log`) [M] |
| 2026-10-08 07:08:39 | container boot, inside the stop window [D] |
| 07:09:34 | resume [D]; first new result at 07:10:10 [M] |
| 09:18:05 | last result; 226 results after the resume (`run.log`) [M] |

- **One gap in the data.** The container restart fell inside the owner stop, so the data show a single gap. There is no other period of more than 60 s with no call or agent session in flight; the gap runs from 23:17:47.7 to 07:09:34.9. [M]
- **The CLI version changed across the stop:** claude-code 2.1.293 for 378 calls on day 1, then 2.1.294 for 1,485 calls on day 2. [M]
  - PREREG §8 anticipated this, and the version is recorded per call.
  - Timeouts occurred on both versions: 3 before the stop and 27 after. [M] At d4, difficulty and CLI version are nearly confounded: 52 of the 54 d4 Haiku 5.5 single calls ran on 2.1.294, and the 2 that ran on 2.1.293 both timed out. d3 latencies are alike on both versions (medians about 221 s), so the version is an unlikely cause. [M]
  - Haiku 5.5 throughput was about 275 output tokens/s on both versions (274 and 276). [M]
- **Work killed at 23:17:47 and re-run after the resume:**
  - fhand-sonnet d3/s5003 t1: an orphan Foundry run with 9 journaled Sonnet calls costing **$0.0640**, absent from the results. Its node calls still in flight were never journaled. [D]
  - b0call-haiku-med d3/s5003 t0 and b0call-haiku-none d3/s5003 t1: single calls in flight. Their spend cannot be observed, because the journal writes only when a call completes. [I from the deterministic interleave; M that they were recorded only after the resume]
  - b0agent-haiku d3/s5003 t1: a Claude Code session killed in flight. [I from the job order; its transcript was wiped when the re-run started (runner.mjs:56) and deleted when the re-run passed (runner.mjs:86)]
  - b0ncall streams t0 and t1: probably mid-call. [I]

  Each of these keys was recorded exactly once after the resume. There are no duplicates or orphan log lines. [M]
- **No trial was excluded or rerun under `envFaultRule`.** [M/D]
  - No `results.faults.jsonl` exists.
  - The journal has no `MODEL_RATE_LIMIT` or `MODEL_UNAVAILABLE` errors.
  - The 7 surviving agent transcripts (failing trials only; passing ones were deleted) show only allowed_warning rate-limit events.
  - `MODEL_TIMEOUT` is not in the runner's `ENV_FAULTS` (`experiments/lib/runner.mjs:19`).
  - The re-runs after the resume are ordinary resume semantics for trials that had no recorded result.

### 1.3 Deviations and protocol issues
| # | Issue | Pre-registered? | Effect |
|---|---|---|---|
| 1 | **A 300 s per-call wall-clock limit on single calls.** It is the default `timeoutMs = 300000` in `src/models/port.mjs:112` and `src/models/providers/claude-cli.mjs:64`, and nothing in `run.mjs`, `experiments/lib/models.mjs` or `b0-call.mjs` overrides it. PREREG §2 gives single calls only "per-call CLI cap $1"; b0agent and fhand got 20 min per task. The workflow's model nodes carry the same 300 s per-call limit, set explicitly at experiments/workflows/records-v3.mjs:1178, so the per-call limit was equal; what differed is the per-task wall clock (300 s for one call against 20 min for a workflow run or an agent session). The default sits in frozen code (src/ is a frozen path), so this is an unstated design parameter, not a departure from the frozen code. [M code; D] | No | It cut off 30 of 108 Haiku 5.5 single-call trials, 29 of them at d4 (§4). [M] |
| 2 | **Timeouts were scored as failures, not as environment faults.** This matches PREREG §5 and `runner.mjs:19`, but contradicts DESIGN §5.2, which classes `MODEL_TIMEOUT` as `env_fault`. The kill rule's trial-loss clause (§6) covers rate limits only; its spend clauses could not see the timeouts either, because they were recorded at $0. [M code; D] | Partly | b0ncall lost 42% of its trials and b0call-haiku-med 31%, and no rule fired. [M] |
| 3 | **Cost accounting.** `experiments/lib/arms/b0-call.mjs:17` returns only `costUsd` and `imputedUsd`, which drops the journal's `costUnknown: true, costUpperUsd: 1`. The 30 timed-out calls were therefore recorded at $0; for b0ncall only the notes call was recorded. PREREG §3 requires killed calls to be "charged at their bound and reported separately", and `b0-agent.mjs:56-57` does this. [M: 30 journal rows; D] | Violates §3 | The recorded CPS of three Haiku 5.5 single-call arms is too low. Corrected post-hoc in §4.4 and §7. |
| 4 | **Killed in-flight work was not charged:** the orphan $0.064 plus the unobservable calls listed in §1.2. [D/I] | Violates §3 | fhand-sonnet's cost is understated by at least $0.064. Single-call, B0+N and agent costs are understated by up to $1 per killed call (§7). |
| 5 | **The frozen analyzer omits d4.** `experiments/p1/analyze.mjs:11` loops over `['all','d2','d3']`. [M] | Analyzer bug | There are no d4 rows in the pre-registered output. Supplied post-hoc in §4.5. |
| 6 | **The thinking-control amendment (Amendment 3) probably does not carry over to task scale.** Amendment 3 verified "none → `--effort low`, `MAX_THINKING_TOKENS=0`" on a 53-token probe. [D] At task size, b0call-haiku-none emits median 52K (d3) and 69K (d4) output tokens [M] for an answer of about 7–10K characters, so about 90% of its output is not in the answer. [D] The med arms emit median 62–76K, so their "8K thinking budget" is not a cap either. [M] Thinking tokens are not journaled (`claude-cli.mjs` `usageOf` keeps 4 usage fields). [D] | The arms ran as defined | The "thinking off" label is doubtful for Haiku 5.5. It should read "effort low; hidden reasoning probable, not recorded". [I] The CLI does report output_tokens_details.thinking_tokens (the 7 surviving b0agent transcripts show 54–73K per session), but usageOf drops the field. A dev-seed probe can settle the question. [M] |
| 7 | **The B0 `maxTokens: 16000` is not applied** on the CLI route, which uses the provider default (documented at `src/models/port.mjs:53-59`). [D] | Not noted in §8 | Construct-validity caveat only. |
| 8 | **The PREREG §7 cost estimate missed the single calls.** Haiku 5.5 single calls were estimated at under $0.01; recorded cost was $0.025–0.030 per trial, and $0.029–0.045 per finished call (median). Sonnet single calls were estimated at $0.05–0.15; they cost $0.247 per trial. [M] The Haiku 5.5 single-call setup was never piloted at task size before freezing. [D] | n/a | Explains deviation 1. |
| 9 | **Trial costs are not independent.** The CLI writes every prompt to a 1-hour cache. The first fhand-sonnet trial after the stop cost $0.2985, against $0.197–0.198 for the same work in its sibling trials: 55.3K cache-write and 6.3K cache-read tokens, against 28.3K and 33.3K. fhand-haiku d3/s5003 t2, also the first after the stop, cost $0.0166 against $0.0142–0.0143. [M] | Not anticipated | Cost noise that depends on scheduling. |
| 10 | **Work directories of passing trials are deleted** (`runner.mjs:86`), so escalation records and agent transcripts for passing trials cannot be checked. [M code] | Per design | Some diagnoses below are limited to failures. |

## 2. Pre-registered analysis output (verbatim)

Command: `node experiments/p1/analyze.mjs experiments/runs/p1/results.jsonl`. The re-run is byte-identical to the output saved before this report; the bootstrap is seeded. [M]

```
| arm | d | tasks | trials | success | rate | 95% CI | pass^3 | mean score | $ total | CPS | $/trial | imputed $ | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| b0call-haiku45-none | all | 12 | 36 | 0/36 | 0.000 | [0.00,0.10] | 0.000 | 0.197 | 1.98 | Infinity | 0.0551 | 0.0000 | 0 |
| b0call-haiku45-none | d3 | 6 | 18 | 0/18 | 0.000 | [0.00,0.18] | 0.000 | 0.218 | 0.87 | Infinity | 0.0485 | 0.0000 | 0 |
| b0call-sonnet-med | all | 12 | 36 | 28/36 | 0.778 | [0.62,0.88] | 0.417 | 0.983 | 8.89 | 0.3175 | 0.2469 | 0.0000 | 0 |
| b0call-sonnet-med | d3 | 6 | 18 | 13/18 | 0.722 | [0.49,0.88] | 0.333 | 0.980 | 3.67 | 0.2819 | 0.2036 | 0.0000 | 0 |
| fhand-haiku | all | 12 | 36 | 35/36 | 0.972 | [0.86,1.00] | 0.917 | 0.998 | 0.57 | 0.0162 | 0.0158 | 0.0000 | 0 |
| fhand-haiku | d3 | 6 | 18 | 17/18 | 0.944 | [0.74,0.99] | 0.833 | 0.997 | 0.26 | 0.0155 | 0.0146 | 0.0000 | 0 |
| fhand-sonnet | all | 12 | 36 | 36/36 | 1.000 | [0.90,1.00] | 1.000 | 1.000 | 7.67 | 0.2132 | 0.2132 | 0.0000 | 0 |
| fhand-sonnet | d3 | 6 | 18 | 18/18 | 1.000 | [0.82,1.00] | 1.000 | 1.000 | 3.67 | 0.2037 | 0.2037 | 0.0000 | 0 |
| b0call-haiku-none | all | 12 | 36 | 25/36 | 0.694 | [0.53,0.82] | 0.417 | 0.870 | 1.09 | 0.0437 | 0.0303 | 0.0000 | 4 |
| b0call-haiku-none | d3 | 6 | 18 | 14/18 | 0.778 | [0.55,0.91] | 0.500 | 0.972 | 0.54 | 0.0384 | 0.0299 | 0.0000 | 0 |
| b0call-haiku-med | all | 12 | 36 | 23/36 | 0.639 | [0.48,0.78] | 0.417 | 0.664 | 0.93 | 0.0402 | 0.0257 | 0.0000 | 11 |
| b0call-haiku-med | d3 | 6 | 18 | 16/18 | 0.889 | [0.67,0.97] | 0.667 | 0.942 | 0.64 | 0.0397 | 0.0353 | 0.0000 | 0 |
| b0ncall-haiku-med | all | 12 | 36 | 17/36 | 0.472 | [0.32,0.63] | 0.167 | 0.542 | 0.91 | 0.0534 | 0.0252 | 0.0000 | 15 |
| b0ncall-haiku-med | d3 | 6 | 18 | 13/18 | 0.722 | [0.49,0.88] | 0.333 | 0.862 | 0.70 | 0.0536 | 0.0387 | 0.0000 | 1 |
| b0agent-haiku | all | 12 | 36 | 29/36 | 0.806 | [0.65,0.90] | 0.667 | 0.886 | 3.99 | 0.1376 | 0.1108 | 0.0000 | 0 |
| b0agent-haiku | d3 | 6 | 18 | 12/18 | 0.667 | [0.44,0.84] | 0.500 | 0.827 | 0.98 | 0.0818 | 0.0545 | 0.0000 | 0 |

| A | B | tasks | success diff A−B [95% CI] | CPS ratio A/B [95% CI] | McNemar p |
|---|---|---|---|---|---|
| b0call-haiku-none | b0call-haiku45-none | 12 | 0.694 [0.472, 0.889] | NaN [NaN, NaN] | 0.004 |
| fhand-haiku | b0call-haiku-med | 12 | 0.333 [-0.028, 0.750] | 0.404 [0.350, 0.450] | 0.125 |
| fhand-haiku | b0call-haiku-none | 12 | 0.278 [0.111, 0.528] | 0.372 [0.286, 0.450] | 0.250 |
| fhand-haiku | b0ncall-haiku-med | 12 | 0.500 [0.139, 0.861] | 0.304 [0.253, 0.344] | 0.031 |
| fhand-haiku | b0agent-haiku | 12 | 0.167 [0.000, 0.389] | 0.118 [0.093, 0.229] | 0.500 |
| fhand-haiku | b0call-sonnet-med | 12 | 0.194 [0.056, 0.361] | 0.051 [0.044, 0.063] | 1.000 |
| fhand-sonnet | b0call-sonnet-med | 12 | 0.222 [0.111, 0.361] | 0.671 [0.575, 0.789] | 1.000 |
```

**Notes on this output**
- **No d4 rows** (deviation 5).
- **The `errors` column counts `MODEL_TIMEOUT`**, and **`imputed $` is 0** because every model is hosted. [M]
- **The CPS ratio for the Haiku 4.5 pair is `NaN`** because Haiku 4.5 has no successes.
- **The cluster is the difficulty level** (PREREG §3), so the bootstrap has **2 clusters**.
  - Each resample draws 2 clusters with replacement, so the interval mostly spans the d3-only and d4-only estimates. [M from `stats.mjs`; I]
  - With 2 clusters, a cluster bootstrap is not a reliable interval. Read these CIs as descriptive. [I]

## 3. Pre-registered decision rules, applied mechanically

### 3.1 The primary rule
PREREG §5: "'Cheap workflow reaches strong-single-call success at lower cost' is supported (directionally) only if (a) fhand-haiku's success CI overlaps or exceeds b0call-sonnet-med's AND (b) the CPS ratio (fhand-haiku / b0call-sonnet-med) upper CI bound is < 1."

| Condition | Numbers [M] | Met |
|---|---|---|
| (a) | fhand-haiku 35/36 = 0.972, Wilson [0.86, 1.00]. b0call-sonnet-med 28/36 = 0.778, [0.62, 0.88]. The intervals overlap on [0.86, 0.88], and fhand-haiku's point estimate is higher. | yes |
| (b) | CPS $0.0162 against $0.3175. Ratio **0.051 [0.044, 0.063]**; the upper bound 0.063 is below 1. | yes |

**Verdict: supported (directionally).** [M]
- **Not a superiority claim.** The paired success difference is +0.194 [0.056, 0.361]. McNemar on the per-task majority gives p = 1.000: one task favours fhand-haiku (d3/s5006, where Sonnet passed 1 of 3) and none favours Sonnet. A 19-point gap is below the ~35-point power floor (§3.3). So P1 does not claim the workflow is *more* successful than a Sonnet call, only that it is not shown to be less successful, at about 1/20 of the cost per success.
- **Robustness.** Neither arm had a timeout or killed in-flight work. Sonnet single calls took at most 204 s; fhand trials took at most 59 s. [M] The ratio is identical under every cost treatment in §4.4.
- **Post-hoc, by difficulty:**
  - d3: (a) [0.74, 0.99] against [0.49, 0.88]; (b) 0.055 [0.040, 0.072];
  - d4: (a) [0.82, 1.00] against [0.61, 0.94]; (b) 0.049 [0.043, 0.054]. [M]
`- **Reliability:** pass^3 is 0.917 for fhand-haiku against 0.417 for the Sonnet call. [M]` followed by a new bullet:

### 3.2 The other pre-registered comparisons
| A vs B | success diff [CI] | McNemar p (tasks A-only / B-only) | CPS ratio [CI] | Reading under PREREG §4–5 |
|---|---|---|---|---|
| b0call-haiku-none vs b0call-haiku45-none | +0.694 [0.472, 0.889] | 0.004 (9/0) | n/a | The gap is above the ~35-point floor. **This is the one success difference P1 resolves.** The timeouts work against A, so this reading is conservative. |
| fhand-haiku vs b0call-haiku-med | +0.333 [−0.028, 0.750] | 0.125 (4/0) | 0.404 [0.350, 0.450] | Success: confounded by the timeouts (§4) and under-powered. Cost: the CI excludes 1, so it counts as development evidence. |
| fhand-haiku vs b0call-haiku-none | +0.278 [0.111, 0.528] | 0.250 (3/0) | 0.372 [0.286, 0.450] | Same reading. |
| fhand-haiku vs b0ncall-haiku-med | +0.500 [0.139, 0.861] | 0.031 (6/0) | 0.304 [0.253, 0.344] | p < 0.05, but it is driven by 14 timeouts at d4. **This is not evidence about the workflow** (§4.2). |
| fhand-haiku vs b0agent-haiku | +0.167 [0.000, 0.389] | 0.500 (2/0) | 0.118 [0.093, 0.229] | Success: directional. Cost: about 8× cheaper per success, CI excludes 1. Not affected by the timeout. |
| fhand-haiku vs b0call-sonnet-med | +0.194 [0.056, 0.361] | 1.000 (1/0) | 0.051 [0.044, 0.063] | The primary rule, §3.1. |
| fhand-sonnet vs b0call-sonnet-med | +0.222 [0.111, 0.361] | 1.000 (1/0) | 0.671 [0.575, 0.789] | Success: directional. Cost: the CI excludes 1, but per trial it is 0.86×; most of the ratio is the success gap. Not affected by the timeout. |

**How the rules apply** [M/I]:
- No gap is under 3 points.
- Every comparison uses K = 3 per task, so no K=1 claim is made. The single-trial findings in §5 (the false pass, the escalations) are descriptive, not comparative.
- Where a bootstrap success interval excludes 0 but the gap is below ~35 points, the result is reported as **directional**, not as a difference. The bootstrap has 2 clusters, and McNemar rejects only for the Haiku 4.5 pair and the confounded B0+N pair.

### 3.3 Power
- **Design.** 12 tasks × K = 3. The task is the unit of independent evidence; trials within a task are correlated. [I]
- **What PREREG §4 says.** A +10-point success difference needs about 116–234 paired tasks, and a 30% cost reduction needs about 23–89. **P1 is under-powered for success differences below about 35 points** and is directional only.
- **Observed success gaps** [M]:

  | Comparison | Gap (points) |
  |---|---|
  | fhand-haiku vs b0agent-haiku | 17 |
  | fhand-haiku vs Sonnet call | 19 |
  | fhand-sonnet vs Sonnet call | 22 |
  | fhand-haiku vs Haiku 5.5 call, "thinking off" | 28 |
  | fhand-haiku vs Haiku 5.5 call, effort medium | 33 |
  | fhand-haiku vs B0+N | 50 |
  | Haiku 5.5 call vs Haiku 4.5 call | 69 |

  Only the last two exceed the floor, and the B0+N gap is mostly a timeout artefact.
- **McNemar on 12 per-task majorities.** It reaches p < 0.05 only with at least 6 discordant tasks, essentially all in one direction (6/0 gives p = 0.031). [M]
- **Cost ratios.** Every fhand-haiku cost ratio has an upper bound of at most 0.45, so far below 1. Under §4 they qualify as development evidence.
- **The d3-only sensitivity analysis (§4.3) uses 6 tasks** and is weaker still.

## 4. The timeout issue

### 4.1 What happened
- **The timed-out calls.** The journal has exactly 30 `MODEL_TIMEOUT` calls. All are Haiku 5.5 single calls (`node_key` `b0`), with the message "claude CLI Subprocess cancelled". [M] Their latencies were 300.28–300.85 s. [D]
  - By arm: b0call-haiku-none 4 (all d4), b0call-haiku-med 11 (all d4), b0ncall-haiku-med 15 (14 at d4, 1 at d3). [M]
  - At d4 the timeouts hit **29 of the 54** Haiku 5.5 single-call trials. [M]
- **No other call came close to the limit** [M]:

  | Call type | Longest |
  |---|---|
  | workflow node call | 32 s |
  | Sonnet single call | 204 s |
  | Haiku 4.5 single call | 93 s |
  | b0agent session (limit 20 min) | 489 s |

- **Finished Haiku 5.5 single calls (medians)** [M]. The d4 figures are censored, because only the shorter generations finished.

  | arm | d3 latency | d3 output tokens | d4 latency | d4 output tokens |
  |---|---|---|---|---|
  | b0call-haiku-none | 192 s | 52K | 251 s | 69K |
  | b0call-haiku-med | 223 s | 62K | 279 s (max 300 s) | 76K |
  | b0ncall-haiku-med | 249 s | 70K | 291 s | 81K |

- **The expected answer is not large.** d3 tasks have 85 export rows and 37–45 true records; d4 tasks have 115 rows and 47–61 records. [D]
  - Haiku 4.5 emits a median 4.4K (d3) or 5.9K (d4) output tokens, which is the answer and nothing more. [M]
  - Haiku 5.5 emits about 12× as much (median 52K against 4.4K at d3, 69K against 5.9K at d4). [M]
  - Timed-out calls left no partial data: usage is zero, because the CLI reports only at exit. [D]
- **The killed calls would probably have finished under a somewhat longer limit.** [D/I]
  - Scaling each arm's d3 latencies by 115/85 predicts 2/18, 9/18 and 14/17 timeouts at d4. The observed counts are 4/18, 11/18 and 14/18.
  - The largest scaled latencies are 312–367 s, so the scaling predicts no timeouts at 420 s. It under-predicts the observed d4 timeouts at 300 s (25 predicted against 29 observed), so 420 s is a lower estimate, not a measured safe limit.
  - Projected output stays at or below about 100K tokens, under Haiku 5.5's 128K output limit, and no finished call stopped on `max_tokens`.
  - Unknown:
    - whether the CLI has its own per-response ceiling;
    - whether killed calls are billed;
    - whether the killed generations would have passed, since the finished calls are a shorter, selected subset.
- **Conclusion.** The limit handicaps the three Haiku 5.5 single-call arms through a harness default. One-call answering is not inherently slow: Haiku 4.5 calls take a median 34–44 s and Sonnet calls 89–127 s. [M] The limit binds on Haiku 5.5 only because it generates about 10× the answer.
- **POST-HOC. Success among calls that finished** [M]. This is a selected subset and an upper-bound indication, not an imputation.

  | arm | d3 | d4 | all | reported |
  |---|---|---|---|---|
  | b0call-haiku-none | 14/18 | 11/14 | 25/32 (0.78) | 0.69 |
  | b0call-haiku-med | 16/18 | 7/7 | 23/25 (0.92) | 0.64 |
  | b0ncall-haiku-med | 13/17 | 4/4 | 17/21 (0.81) | 0.47 |

### 4.2 Effect on each pre-registered comparison (POST-HOC: the d3/d4 splits and cost treatments are not pre-registered)
| Comparison | Timeouts A / B | Effect on the success difference | Effect on the CPS ratio | Net reading |
|---|---|---|---|---|
| b0call-haiku-none vs haiku45-none | 4 / 0 | It shrinks the gap, because A loses 4 d4 trials. At d3: +0.778 [0.556, 0.944]. | n/a | Unaffected in direction. |
| fhand-haiku vs b0call-haiku-med | 0 / 11 (all d4) | Inflated: +0.056 at d3, +0.611 at d4. | The recorded 0.404 charges B's timeouts at $0. At the bound it is 0.031; at the estimate, 0.263; at d3, 0.390. | **The success gap is mostly a timeout artefact. The cost direction is robust.** |
| fhand-haiku vs b0call-haiku-none | 0 / 4 | Inflated at d4 (+0.389) against +0.167 at d3. | 0.372; 0.080 at the bound; 0.319 at the estimate; 0.403 at d3. | Partly an artefact. The d3 gap is directional. |
| fhand-haiku vs b0ncall-haiku-med | 0 / 15 (14 d4) | Strongly inflated: +0.222 at d3, +0.778 at d4. | 0.304; 0.017 at the bound; 0.174 at the estimate; 0.289 at d3. | The McNemar p = 0.031 reflects the timeouts, not the workflow. |
| fhand-haiku vs b0agent-haiku | 0 / 0 (20-min limit) | None. | Only the agent session killed at the stop: 0.094 at the bound. | Unaffected. |
| fhand-haiku vs b0call-sonnet-med | 0 / 0 | None. | None. | **The primary rule is unaffected.** |
| fhand-sonnet vs b0call-sonnet-med | 0 / 0 | None. | The orphan $0.064 moves it to 0.677. | Unaffected. |

### 4.3 Post-hoc sensitivity: d3 only
**POST-HOC, not pre-registered.** This restriction was chosen after seeing the timeout pattern. d3 has one single-call timeout (b0ncall d3/s5003). The subset is 6 tasks, a single cluster, so tasks are resampled within d3. [M]

| A vs B (d3, 6 tasks) | success diff [CI] | McNemar p (A-only/B-only) | CPS ratio [CI] |
|---|---|---|---|
| b0call-haiku-none vs b0call-haiku45-none | +0.778 [0.556, 0.944] | 0.063 (5/0) | n/a |
| fhand-haiku vs b0call-haiku-med | +0.056 [−0.111, 0.222] | 1.000 (0/0) | 0.390 [0.321, 0.458] |
| fhand-haiku vs b0call-haiku-none | +0.167 [0.056, 0.278] | 1.000 (1/0) | 0.403 [0.304, 0.489] |
| fhand-haiku vs b0ncall-haiku-med | +0.222 [0.056, 0.444] | 1.000 (1/0) | 0.289 [0.232, 0.339] (0.119 [0.042, 0.339] with its 1 timeout at the bound) |
| fhand-haiku vs b0agent-haiku | +0.278 [0.056, 0.500] | 0.500 (2/0) | 0.189 [0.104, 0.272] |
| fhand-haiku vs b0call-sonnet-med | +0.222 [−0.056, 0.444] | 1.000 (1/0) | 0.055 [0.040, 0.072] |
| fhand-sonnet vs b0call-sonnet-med | +0.278 [0.111, 0.444] | 1.000 (1/0) | 0.722 [0.559, 0.859] |

**Reading**
- **Success.** Against Haiku 5.5 single calls, at d3 the workflow is 6, 17 and 22 points ahead. Every McNemar p is 1.000. None of these gaps is resolvable at this size, and the effort-medium gap is within noise.
- **Cost.** The workflow is 2.5–3.5× cheaper per success than the same model answering in one call, and every upper bound is at most 0.49.
- **The primary rule holds at d3.**

### 4.4 Post-hoc: cost treatments
**POST-HOC.** The four treatments are:
- **Recorded:** as in `results.jsonl`.
- **§3 bound:** each timed-out call is charged $1, as PREREG §3 prescribes.
- **Bound plus in-flight:** additionally, the calls killed at 23:17 are charged at the bound, and the orphan $0.064 is added to fhand-sonnet. The two b0ncall in-flight calls are inference.
- **Estimate:** about $0.045 per timed-out call, roughly 82K output tokens at $0.50/MTok plus a cache write. [I]

| A vs B (all 12 tasks) | recorded | §3 bound | bound + in-flight | estimate [I] |
|---|---|---|---|---|
| fhand-haiku vs b0call-haiku-med | 0.404 [0.350, 0.450] | 0.031 [0.006, 0.422] | 0.029 [0.006, 0.333] | 0.263 [0.102, 0.422] |
| fhand-haiku vs b0call-haiku-none | 0.372 [0.286, 0.450] | 0.080 [0.024, 0.447] | 0.067 [0.024, 0.357] | 0.319 [0.196, 0.447] |
| fhand-haiku vs b0ncall-haiku-med | 0.304 [0.253, 0.344] | 0.017 [0.003, 0.292] | 0.015 [0.002, 0.123] | 0.174 [0.050, 0.306] |
| fhand-haiku vs b0agent-haiku | 0.118 [0.093, 0.229] | 0.118 [0.093, 0.229] | 0.094 [0.065, 0.143] | 0.118 [0.093, 0.229] |
| fhand-haiku vs b0call-sonnet-med | 0.051 [0.044, 0.063] | unchanged | unchanged | unchanged |
| fhand-sonnet vs b0call-sonnet-med | 0.671 [0.575, 0.789] | unchanged | 0.677 [0.577, 0.805] | unchanged |

The success differences do not change, because only costs change. [M]
- **Every treatment gives the same ranking:** fhand-haiku is cheaper per success than every baseline.
- **The bound treatment is the rule,** but it overstates real spend. A killed Haiku 5.5 call probably cost a few cents, not $1. [I]

Per-arm CPS by treatment (recorded, §3 bound, estimate) [M]:

| arm | recorded | §3 bound | estimate |
|---|---|---|---|
| b0call-haiku-none | 0.0437 | 0.2037 | 0.0509 |
| b0call-haiku-med | 0.0402 | 0.5185 | 0.0617 |
| b0ncall-haiku-med | 0.0534 | 0.9357 | 0.0931 |

Under bound plus in-flight: b0call-haiku-none 0.2437, b0call-haiku-med 0.5620, b0ncall-haiku-med 1.0534 (two in-flight calls inferred), b0agent 0.1721 and fhand-sonnet 0.2149; the other arms are unchanged.

### 4.5 Post-hoc: the d4 rows the frozen analyzer omits
Computed with the same `summarizeArm` (K = 3). [M]

| arm | d4 success | rate | 95% CI | pass^3 | mean score | $ total | CPS | $/trial | timeouts |
|---|---|---|---|---|---|---|---|---|---|
| fhand-haiku | 18/18 | 1.000 | [0.82,1.00] | 1.000 | 1.000 | 0.30 | 0.0169 | 0.0169 | 0 |
| fhand-sonnet | 18/18 | 1.000 | [0.82,1.00] | 1.000 | 1.000 | 4.01 | 0.2227 | 0.2227 | 0 |
| b0call-sonnet-med | 15/18 | 0.833 | [0.61,0.94] | 0.500 | 0.986 | 5.22 | 0.3482 | 0.2902 | 0 |
| b0call-haiku-none | 11/18 | 0.611 | [0.39,0.80] | 0.333 | 0.768 | 0.55 | 0.0503 | 0.0308 | 4 |
| b0call-haiku-med | 7/18 | 0.389 | [0.20,0.61] | 0.167 | 0.386 | 0.29 | 0.0414 | 0.0161 | 11 |
| b0ncall-haiku-med | 4/18 | 0.222 | [0.09,0.45] | 0.000 | 0.222 | 0.21 | 0.0525 | 0.0117 | 14 |
| b0agent-haiku | 17/18 | 0.944 | [0.74,0.99] | 0.833 | 0.944 | 3.01 | 0.1770 | 0.1671 | 0 |
| b0call-haiku45-none | 0/18 | 0.000 | [0.00,0.18] | 0.000 | 0.175 | 1.11 | Infinity | 0.0618 | 0 |

Paired comparisons at d4 (6 tasks), for completeness. The Haiku 5.5 single-call arms are censored here. [M]

| A vs B (d4) | success diff [CI] | McNemar p | CPS ratio [CI] |
|---|---|---|---|
| fhand-haiku vs b0call-haiku-med | +0.611 [0.333, 0.889] | 0.125 | 0.409 [0.369, 0.441] |
| fhand-haiku vs b0call-haiku-none | +0.389 [0.111, 0.667] | 0.500 | 0.336 [0.229, 0.430] |
| fhand-haiku vs b0ncall-haiku-med | +0.778 [0.556, 0.944] | 0.063 | 0.322 [0.235, 0.344] |
| fhand-haiku vs b0agent-haiku | +0.056 [0.000, 0.167] | 1.000 | 0.096 [0.090, 0.101] |
| fhand-haiku vs b0call-sonnet-med | +0.167 [0.056, 0.278] | 1.000 | 0.049 [0.043, 0.054] |
| fhand-sonnet vs b0call-sonnet-med | +0.167 [0.056, 0.278] | 1.000 | 0.639 [0.534, 0.746] |
| b0call-haiku-none vs b0call-haiku45-none | +0.611 [0.333, 0.889] | 0.125 | n/a |

## 5. Failure diagnoses per arm

**How a trial passes.** The oracle passes a trial only if field accuracy ≥ 0.97, cluster pair-F1 ≥ 0.95, and extra and missing entities are each within slack, where slack = ⌊0.02·E⌋.
- Slack is **0 for every d3 task** and for d4/s5003 and d4/s5006, so one missing or extra person fails the trial. [D; slack values M]
- Scores and oracle fields below are [M] from `oracleDetails`. Causes are [D] unless marked.

### `fhand-haiku`: 1 failure in 36, which the workflow reported as a pass
- **The failure.** d3/s5002 t1 scored 0.946: it predicted 39 entities against 37 true, so extra = 2 with slack 0, while pair-F1 = 1 and field accuracy = 1. [M] Two void rows were emitted as live records.
- **Cause.** The status node read the ATLAS tag `:: DORMANT` as `live` with `relation: "none"`. Its own quote said: "these rows are not real accounts and stay out of the master list".
  - The other two Haiku trials and all three Sonnet trials judged it correctly.
  - It is the only wrong status judgment in 72 workflow runs.
- **False pass.**
  - The run verdict was `pass`, with check score 1 and no reasons.
  - `STATUS_CHECKS` (`experiments/workflows/records-v3.mjs:1027-1038`) accept any meaning when the relation is `none` [M code], and the final check has no invariant that would notice two void rows kept live.
  - Verdict against oracle over the 36 fhand-haiku trials: 35 pass/pass and **1 pass/fail**. Failure detection is **0 of 1**.
  - The verdict carries `establishesCompletion: false`, but the workflow's own acceptance evidence said pass. This is a **negative result for failure handling (Phase 4, C3/C4)**.
- **Escalations: 3, all `perspective` nodes, Haiku 5.5 → Sonnet 5.5.**
  - d3/s5005 t0 (BRIGHTDESK): the evidence quote was not verbatim.
  - d4/s5001 t0 and t2 (KOBO): positive and negative balances were given the same meaning.
  - None of them changed `positive_in_master`, the only field the merge uses (`records-v3.mjs:628`). [M code; D]
  - They cost $0.0226, 4% of the arm's spend. All three trials passed, and their verdicts were honest.
- **Adjudication was never called:** there were 0 VENDEX country disputes in 72 runs.

### `fhand-sonnet`: 0 failures
- Three resamples at the top class, all on `dates:2` (VENDEX) in d3/s5006 t0–t2, costing $0.024.
  - Sonnet answered `mdy` "same as LEDGR", but LEDGR is fixed as `dmy`.
  - The consistency check caught it, and the resample returned `dmy`.
- Verdicts were pass on all 36 trials, matching the oracle's 36/36. [D/M]

### `b0call-sonnet-med`: 8 failures, no timeouts
- **Every failure has at least one missing entity.** Field accuracy was never the deciding criterion (0.983–1.000). [M]
- **Missing people:**
  - d3/s5001 t0 dropped ATLAS 7867;
  - d3/s5003 t1 dropped ATLAS 3735, which is tagged DORMANT although the notes say those rows "must be migrated, not dropped", and also omitted a three-row person;
  - d3/s5004 t0 dropped LEDGR 7629.
- **Two distinct people merged:** d3/s5006 t0 and t1; d4/s5001 t2; d4/s5003 t1; d4/s5005 t1 (which is also missing LEDGR 5918).
- **5 of the 8 failures are at d3**, where slack is 0. [M]
- **Unavailable:** why single rows were dropped, because a single call returns no rationale.

### `b0call-haiku-none`: 7 failures plus 4 timeouts
- **Amount sign flips (2):**
  - d3/s5001 t2: field accuracy 0.942, with 16 amounts inverted;
  - d4/s5006 t0: field accuracy 0.960.
- **Identity errors (4):**
  - d3/s5002 t0: one person split, plus a day/month swap;
  - d3/s5002 t2: pair-F1 0.746, 9 extra entities;
  - d3/s5005 t1: two people merged;
  - d4/s5005 t2: pair-F1 0.910.
- **Wrong amount values (1):** d4/s5002 t1, field accuracy 0.962.

### `b0call-haiku-med`: 2 failures plus 11 timeouts
- d3/s5001 t0: the same 16 sign flips (field accuracy 0.946).
- d3/s5004 t2: score 0 with 40 extra and 40 missing. It used export line numbers (1–85) instead of row ids. Mapped back, for diagnosis only, it would score 0.998.
- Every d4 call that finished passed (7/7). [M]

### `b0ncall-haiku-med`: 4 failures plus 15 timeouts
- d3/s5002 t0: identity collapse (pair-F1 0.735, 10 extra).
- d3/s5005 t0: line numbers instead of row ids; mapped back it would score 1.000.
- d3/s5003 t1: one single-row KOBO person missing.
- d3/s5001 t2: sign flips.
- **Hypothesis, not tested:** the notes add about 12% more output tokens at d3 (70K against 62K), which makes timeouts more likely.

### `b0agent-haiku`: 7 failures, none hitting a limit
- **Limits.** The longest session took 489 s of the 20 minutes allowed [M], and the most expensive cost $0.349 of $1.
- **Shared pattern in all 7 failures.** Each agent did the work in its thinking (54–73K thinking tokens), then typed the resolved people into a Python script as a literal table, without parsing the export.
- **Score 0 (3 trials):** it used the line numbers it had printed instead of row ids (d3/s5001 t2, d3/s5002 t2, d4/s5005 t2).
- **Partial scores (4 trials):** d3/s5001 t0 (0.966), d3/s5002 t0 (0.597), d3/s5002 t1 (0.625) and d3/s5005 t1 (0.705). The causes were:
  - the wrong BRIGHTDESK date order (the notes say day/month/year);
  - namesake merges and splits;
  - stripped accents;
  - wrong amounts.
- **By difficulty, d3 was harder:** 6 of 18 failed at d3 against 1 of 18 at d4. The d4 trials cost about 3× more ($0.167 against $0.055 per trial). [M]
- **Unavailable:** whether passing trials used a real parser, because their transcripts were deleted.
- **Memo in the export.** In 6 of the 7 failing transcripts (all but d3/s5001 t0), the agent noticed memo text asking for `amount_usd` 0 and declined to act on it. This is unrelated to the failures.

### `b0call-haiku45-none`: 36 failures in 36
- **Format rule.** 22 trials (9 at d3, 13 at d4) fail the oracle's `row-in-multiple-records` rule and score 0. [M]
  - There are 79 offending rows: 56 placed in a merged record and again as a single-row record, and 23 placed in two merged records.
  - **The rule does not decide the outcome.** With the duplicates removed (diagnosis only), those 22 trials still pass 0/22.
- **Field accuracy.** Median per-field accuracy:

  | field | accuracy |
  |---|---|
  | amount | **0.14** |
  | phone | 0.66 |
  | birth date | 0.85 |
  | country | 0.85 |
  | entity id | 0.90 |

  Amounts alone cap field accuracy at about 0.88, below the 0.97 threshold. There are 54 sign flips across 23 trials when each truth entity is compared with any predicted record sharing one of its rows (49–50 across 21 trials with the oracle's one-to-one entity matching).
- **The other 14 trials** fail thresholds. They include one empty `records` array (d3/s5001 t2, 81 output tokens) and one output that partly used line numbers (d3/s5004 t1 mixes 1–85 with row ids; it would have failed on amounts anyway).
- **Thinking-off works as labelled on Haiku 4.5.** Output is the answer only, about 52 tokens per export row (median; mean 55), in 3–93 s. It misses the per-task conventions, the currency conversion and the merge rules.

**A pattern across arms** [M/I]. Using line numbers instead of row ids caused 6 schema-valid trials to score 0:
- 1 in b0call-haiku-med;
- 1 in b0ncall-haiku-med;
- 3 in b0agent-haiku;
- 1 in b0call-haiku45-none.

A cheap code check (every `source_rows` id must exist in the export) would catch it. The workflow arms cannot make this slip, because code parses the export.

## 6. What the result does and does not mean

### 6.1 In plain language
**What it means**
- **Cheap workflow against a strong single call.** On one synthetic task family, the Haiku 5.5 model ran a workflow that an Opus agent wrote by hand. It got 35 of 36 attempts right, at about 1.6 cents per correct answer. One call to the stronger Sonnet 5.5 model got 28 of 36 right, at about 32 cents per correct answer. That meets the pre-registered rule: not shown to be less successful, and much cheaper. Post-hoc, the Haiku 5.5 agent without a workflow meets the same rule (§3.1), so the rule alone does not show what the workflow adds. [M]
- **The same workflow on Sonnet** got 36 of 36, at 0.67× the cost per correct answer of a single Sonnet call. [M]
- **One Haiku 5.5 call without a workflow** does about as well on the d3 tasks at effort medium (16 of 18; 14 and 13 of 18 for the other two single-call arms; post-hoc d3 restriction) but costs about 2.5× more per correct answer, because each call writes about 60K tokens of output, almost all of which is not in the answer. [M; I that this output is hidden reasoning]
- **On the d4 tasks, most single Haiku 5.5 calls were cut off** by a 300 s default limit that the pre-registration never stated (29 of 54 calls). The large d4 gap says more about that limit than about workflows. [M/I]
- **Haiku 4.5 fails every task as a single call; Haiku 5.5 passes most.** [M]

**What it does not mean**
- **It does not show that a model can *build* such a workflow.** This one was hand-written by an agent who had studied the family on development seeds, so it is a ceiling.
  - Construction is measured by C0.
  - C0's dev round hints at a drop when Haiku builds: 11/16 against 16/16 for Opus, with K_c = 1 and no claim made. [D `research/construction-20261006/REPORT-dev.md`]
- **It does not show transfer.** It covers one family, generated by a bed Claude wrote, at d3–d4 only.
- **It does not show a workflow is *more successful* than a single call on the same model.** At d3 (post-hoc) that gap is 6–22 points with McNemar p = 1.000, and P1 cannot resolve gaps below about 35 points.
- **It does not establish C1** (§6.3).
- **The workflow's own "pass" cannot be trusted as a success signal.** It said pass on its only failure.
- **It says nothing about a workflow rescuing Haiku 4.5.** P1 had no workflow-on-Haiku-4.5 arm.

### 6.2 Haiku 4.5 (0/36) against Haiku 5.5
- **The pre-registered comparison:** b0call-haiku-none against b0call-haiku45-none gives **+0.694 [0.472, 0.889]**, McNemar p = 0.004 (9/0). [M]
  - Haiku 4.5 costs only 1.8× more per trial ($0.055 against $0.030) despite a 10× higher list price, because Haiku 5.5 emits about 12× more output tokens. [M]
- **Caveats:**
  1. 22 of Haiku 4.5's 36 zeros come from the format rule, but removing the duplicate rows still leaves 0/22. On this task the gap is real, driven by wrong amounts and identity errors. [D]
  2. The two arms do not reason equally. Haiku 4.5 with thinking off writes only the answer, while Haiku 5.5 "none" probably reasons anyway. [I]
  3. Haiku 4.5 with thinking on was not run.
- **The PREREG "rescue" question is not answered by P1.** The development log (`/var/tmp/foundry-work/records-v3/dev-log.jsonl`) records the hand workflow on Haiku 4.5. [M from the log]
  - Pre-review version `a8`, dev seeds, 2026-10-07: 20/20 dev tasks at $0.09–0.15 per task.
  - Sonnet escalation occurred in 10 of those 20 tasks.

  This is development evidence only: the seeds were reused while developing, and the workflow version differs from the frozen one.
- **Consequence: the cheap model has moved.** [I]
  - Haiku 5.5 single calls already pass 72–89% of the d3 trials (78–89% without notes), so on families this hard a workflow has little room to add success for Haiku 5.5.
  - Haiku 5.5 is not a stand-in for a weak (about 9B) model.
  - Testing "rescue" needs a weak-executor arm: Haiku 4.5, or an open-weight model once it is un-parked.

### 6.3 Implications for C1
- **What C1 says.** "Frontier-authored workflows executed by assigned open-weight models reach non-inferior verified success at much lower cost than the frontier executing alone." [D ROADMAP §4.1]
- **P1 matches only the "frontier-authored" part:** the workflow was written by an Opus agent. [D] It differs on everything else [I]:
  - the executor is Haiku 5.5, a hosted model, not an open-weight one (class S was parked);
  - the comparator is a single Sonnet call (class L), not the frontier executing alone (Opus);
  - no non-inferiority margin was pre-registered;
  - the experiment is under-powered.

  **P1 is therefore a directional pre-test, not a test of C1.**
- **Direction.** P1 is consistent with C1's cost side under every cost treatment. Of the C1 falsifiers (ROADMAP §4.3), only the CPS one can be evaluated here, and only by proxy: there, B0 is the frontier executing alone and the ratio is measured at task 10, and P1 has neither. Non-inferiority, a win over B2, break-even within 15 tasks, wrong reuse and held-out families cannot be evaluated in P1. The CPS falsifier, an F/B0 CPS upper bound of 0.85 or more, does not trigger; in P1 the largest upper bound is 0.450 for fhand-haiku against the same-model single call (0.489 at d3), and 0.063 against Sonnet. [M numbers; I relevance]
- **Inputs for the Phase 3 pre-registration** [I]:
  1. Set an **explicit, equal wall-clock limit for every arm**, and pilot every arm configuration at task size before freezing.
  2. Pass `costUnknown` and `costUpperUsd` through every arm. Make the analyzer print every pre-registered stratum, and check the printed tables against the pre-registration before the run.
  3. Run all-frontier (Opus) and all-cheapest baselines, as ROADMAP §2.3 step 5 requires.
  4. Use an executor weak enough to need the workflow.
  5. Record thinking tokens. `usageOf` in `claude-cli.mjs` drops them. Probe on dev seeds what Haiku 5.5's extra output is.
     - Part of the cost advantage comes from the route: long hidden output on large single calls.
     - Cost ratios are therefore specific to the model and the route.
  6. Use an independent oracle, not run verdicts, as the success signal. Fix the status-check gap only in a *new* workflow version, on dev seeds.
  7. Use fresh test seeds (§8).

### 6.4 Implications for the router
- **On this family, a ready workflow beats every other mode per run** on cost per success [M]:

  | Mode | Cost per success |
  |---|---|
  | ready workflow (fhand-haiku) | $0.016 |
  | Haiku 5.5 single call (recorded) | $0.040–0.053 |
  | Haiku 5.5 agent | $0.138 |
  | Sonnet single call | $0.318 |

  For recurring tasks of this kind, the routing question becomes whether a workflow already exists (reuse) or has to be built (construction cost and the C0 quality drop), not single call against workflow per run. [I]
- **Router labels must come from runs with equal, explicit wall-clock limits.** A harness default flipped the d4 ranking of the Haiku single-call modes. [I]
- **The router's model must be per executor model.** Haiku 4.5 → 5.5 moved single-call success from 0/36 to 25/36. [M] This agrees with the design review's recommendation to refit per model.
- **Difficulty level is a weak feature for these modes** [I]: b0agent passed 12/18 at d3 against 17/18 at d4, and the Sonnet call 13/18 against 15/18. [M]
- **Interim numbers to update.** The 2026-10-08 design-review synthesis (`research/review-20261007/00-SYNTHESIS.md`) quotes interim P1 figures from a partial run, with 28–31 trials per arm at 08:40–08:50 UTC (b0ncall already complete at 36; 241 results at 08:44). [M counts at those times] The quoted figures are:
  - "Haiku 5.5 call 22/29";
  - "Haiku 4.5 0/30";
  - "+0.21 [0.07, 0.43]";
  - "Haiku agent 23/29";
  - the router example "Haiku call 0.76 at $0.031; Sonnet call 0.77 at $0.24".

  **This report supersedes them.** The final figures are:
  - Haiku 5.5 single call: success 0.64–0.69 overall (timeout-affected; 0.78–0.89 at d3), at $0.026–0.030 per trial;
  - Sonnet call: 0.778 at $0.247 per trial. [M]
- **P1 data can be router labels for development only.** Its seeds are now inspected. [I]

### 6.5 Implications for the wild evaluation ladder
- **P1 is rung 0 evidence:** a development bed that Claude wrote, and a workflow an Opus agent wrote after studying dev seeds. [D rung table, `00-SYNTHESIS.md`]
  - It cannot be promoted up the ladder.
  - Its test seeds are now spent.
- **The next evidence on cheap execution must come from rung 1 or higher:** the C0 sealed families, R-bench, or external benchmarks. [I] Those runs need:
  - a *constructed* workflow rather than a hand-written one;
  - an executable oracle as the only success signal;
  - explicit, equal limits across arms.
- **The verifier's false pass** is a concrete reason why ladder results must not rely on run verdicts. [I]

## 7. Costs

### 7.1 Ledgers
| arm | trials | `results.jsonl` $ | journal $ | $/trial | PREREG §7 estimate per trial |
|---|---|---|---|---|---|
| fhand-haiku | 36 | 0.5682 | 0.5682 | 0.0158 | about 0.015 (Amendment 2) |
| fhand-sonnet | 36 | 7.6739 | 7.6739, plus the 0.0640 orphan | 0.2132 | 0.17–0.28 |
| b0call-sonnet-med | 36 | 8.8890 | 8.8890 | 0.2469 | 0.05–0.15 |
| b0call-haiku-none | 36 | 1.0914 | 1.0914 | 0.0303 | < 0.01 |
| b0call-haiku-med | 36 | 0.9251 | 0.9251 | 0.0257 | < 0.01 |
| b0ncall-haiku-med | 36 | 0.9071 | 0.9071 | 0.0252 | < 0.01 plus the notes call |
| b0agent-haiku | 36 | 3.9901 | not journaled (CLI `total_cost_usd` only) | 0.1108 | ≤ 1 |
| b0call-haiku45-none | 36 | 1.9849 | 1.9849 | 0.0551 | 0.02–0.06 |
| **total** | 288 | **26.0297** | 22.1037 (1,863 calls) | | total $25–40 |

- **The two ledgers reconcile:** 22.1037 − 0.0640 + 3.9901 = 26.0298. [M totals; D per-arm journal match]
- **Basis.** Costs are list-price equivalents computed by the CLI. [D]
  - The price model `input·p_in + cache_read·0.1·p_in + cache_write·2·p_in + output·p_out` reproduces all 1,863 journaled costs.
  - Prices come from `policy/models.json`: Haiku 5.5 $0.1/$0.5, Haiku 4.5 $1/$5, Sonnet 5.5 $2/$10 per MTok. [M]

### 7.2 Unrecorded spend and the kill rule
| item | recorded | PREREG §3 bound | estimate [I] |
|---|---|---|---|
| 30 timed-out single calls | $0 | $30 | about $1.35 |
| orphan fhand-sonnet run | not in results; $0.064 in the journal | n/a | $0.064 |
| work killed at 23:17:47 | unobservable | $5: two single calls, two probable B0+N calls and one agent session at $1 each, plus fhand-sonnet's unjournaled node calls at $1 each (number unknown) | small |
| **total** | **$26.09** | **$56.09** with timeouts only; **at least $61.09** with killed work | **about $27.4** |

**Kill rule (§6)** [M/I]:
- Recorded and estimated spend are far below $60.
- The largest arm is b0ncall-haiku-med: $15.91 at the bound, or $17.91 with its two probable in-flight calls. Both are under the $20 per-arm limit.
- No arm missed trials to rate limits.
- **Ambiguity.** The fully bounded worst case, at least $61.09, exceeds $60. Bounds are not spend, and §6 does not say whether bounds count toward the limit. Record this ambiguity, and settle it in the next pre-registration.

### 7.3 Cost structure [D unless marked]
- **The workflow arms.** Both make 819 calls, 22.75 per trial.
  - Sonnet costs **13.5×** Haiku in this workflow, against a 20× list-price ratio.
  - The reason: Haiku 5.5 emits about 2.1× Sonnet's output tokens per node call (777 against 369).
- **The two free-text VENDEX reads are about half of each arm's spend:** 49.9% for Haiku and 47.0% for Sonnet.
- **Spend by token type:**

  | Arm | Output tokens | Cache writes |
  |---|---|---|
  | fhand-haiku | 57% | 41% |
  | fhand-sonnet | 39% | 57.5% |

  - Every CLI call writes its prompt to a 1-hour cache at twice the input price; for Sonnet this is the largest cost item.
  - For comparison, output tokens are 88–89% of a Haiku 5.5 single call's cost, 72% for Sonnet and 50% for Haiku 4.5.
- **Cache warmth moves trial cost.** The first fhand-sonnet trial after the pause cost 51–52% more than its siblings, and the first fhand-haiku trial 17% more. [M]
- **A Haiku 5.5 single call (median $0.029–0.045 per finished call) costs more than the entire 23-call Haiku workflow ($0.016 per trial).** [M]

## 8. Inspected seeds (permanent record)
- **What was inspected.** On 2026-10-08, the two P1 diagnoses inspected all 12 P1 test tasks: `records` v3.0.0, test split, seeds 5001–5006, at d3 and d4. [D]

  | Difficulty | Task hashes |
  |---|---|
  | d3 | s5001 `c8b902b9b0ef`, s5002 `b5d9867837ba`, s5003 `154b3a1ab551`, s5004 `6cc15facd8a5`, s5005 `ba4ed3965434`, s5006 `5acadccfe62a` |
  | d4 | s5001 `17f545695787`, s5002 `f6083ab0b89f`, s5003 `c9786101e26e`, s5004 `dfeb71a8c354`, s5005 `e10f33d4435a`, s5006 `514768170433` |

  They read:
  - regenerated truth for every task;
  - every failing output compared with truth;
  - all status-value sentences;
  - notes sentences and export lines from several tasks;
  - the b0agent answers.
- **Status: INSPECTED.** These tasks **must never be reused as held-out evaluation tasks**: not for a later workflow version, a skill or builder change, router labels, or a model comparison. They remain usable as development seeds.
- **P1's own numbers stand.** The run ended at 09:18:05Z, before the diagnoses: their scripts and notes in session scratch date from 09:25–09:36Z. [M]
- **Recommendation [I].** Treat `records` test seeds 5001–5006 as inspected at *every* difficulty, unless it is shown that the generator draws independent content per difficulty. Any re-run uses fresh test seeds, listed in its own pre-registration.
- **Earlier inspections.** C0's dev round inspected seeds 6001–6004 at d3 of `records` and `codefix`. [D C0 REPORT-dev]

## 9. Record entries and next steps

**A. Proposed dated PREREG amendment.** It is post-run, and the frozen files are not changed:
> **2026-10-08, after the run (288/288; last result 09:18:05Z). Post-run record; the frozen files are unchanged; report in REPORT.md.**
> 1. INSPECTED: test seeds 5001–5006 at d3 and d4 (hashes above), on 2026-10-08, by the P1 diagnoses. They are never to be reused as held-out.
> 2. Single calls ran under a 300 s per-call limit the pre-registration did not state (the defaults at src/models/port.mjs:112 and src/models/providers/claude-cli.mjs:64). Workflow model nodes had the same limit, set at experiments/workflows/records-v3.mjs:1178, against 20 min per task for the workflow and agent arms. It cut off 30 Haiku 5.5 single-call trials, 29 of them at d4. Timeouts were scored as failures, as §5 and the runner specify.
> 3. Cost accounting deviated from §3. `b0-call.mjs:17` dropped `costUnknown`, so 30 timed-out calls were recorded at $0. The orphan fhand-sonnet run ($0.064) and the calls killed at 23:17:47 were not charged. CPS at the bound is reported post-hoc.
> 4. `analyze.mjs:11` omits d4. The d4 rows are reported post-hoc.
> 5. Amendment 3's "thinking off" mapping probably does not hold at task scale for Haiku 5.5 (median 52–69K output tokens for an answer of about 5K tokens; thinking tokens were not recorded). The B0 `maxTokens` setting is not applied on the CLI route.
> 6. The workflow verdict reported a false pass on its only failure (d3/s5002 t1). This is a negative result for failure handling.
(same line, then) `> 8. The PREREG's "~23:00 UTC" and "~23:05 UTC" are approximate and late. 880c6b9 was committed at 22:51:44Z and a98d827 at 22:51:59Z, and the first model call started at 22:52:03Z, so the freeze preceded the run.`

**B. Other record entries**
- **`docs/RESEARCH.md` negative results:**
  - the verdict false pass;
  - the unregistered timeout confound, as a harness-design lesson;
  - Haiku 4.5's 0/36 on single calls.
- **README status.** Phase 1's exit experiment has run, for M and L only. Its numbers are those of the Key numbers table.
- **`00-SYNTHESIS.md`.** Mark its interim P1 figures as superseded.
- **Diagnosis notes.** Save the two diagnosis notes and scripts under `research/core-20261006/diagnosis/`. They exist only in session scratch today.

**C. Not done here.** Each of these needs its own pre-registration or a labelled change:
- fix `b0-call.mjs` (pass the cost bound through) and the analyzer's strata;
- make wall-clock limits explicit and equal across arms;
- add a code check that `source_rows` ids exist;
- fix the status check in a new workflow version, on dev seeds;
- probe Haiku 5.5's hidden output on dev seeds;
- run a weak-executor arm.

---

### Appendix A. Passes per task (of 3) [M]
| task | fhand-haiku | fhand-sonnet | b0call-sonnet-med | b0call-haiku-none | b0call-haiku-med | b0ncall-haiku-med | b0agent-haiku | b0call-haiku45-none |
|---|---|---|---|---|---|---|---|---|
| d3:s5001 | 3 | 3 | 2 | 2 | 2 | 2 | 1 | 0 |
| d3:s5002 | 2 | 3 | 3 | 1 | 3 | 2 | 0 | 0 |
| d3:s5003 | 3 | 3 | 2 | 3 | 3 | 1 (1 TO) | 3 | 0 |
| d3:s5004 | 3 | 3 | 2 | 3 | 2 | 3 | 3 | 0 |
| d3:s5005 | 3 | 3 | 3 | 2 | 3 | 2 | 2 | 0 |
| d3:s5006 | 3 | 3 | 1 | 3 | 3 | 3 | 3 | 0 |
| d4:s5001 | 3 | 3 | 2 | 3 | 1 (2 TO) | 1 (2 TO) | 3 | 0 |
| d4:s5002 | 3 | 3 | 3 | 1 (1 TO) | 0 (3 TO) | 0 (3 TO) | 3 | 0 |
| d4:s5003 | 3 | 3 | 2 | 3 | 3 | 1 (2 TO) | 3 | 0 |
| d4:s5004 | 3 | 3 | 3 | 2 (1 TO) | 1 (2 TO) | 0 (3 TO) | 3 | 0 |
| d4:s5005 | 3 | 3 | 2 | 0 (2 TO) | 0 (3 TO) | 0 (3 TO) | 2 | 0 |
| d4:s5006 | 3 | 3 | 3 | 2 | 2 (1 TO) | 2 (1 TO) | 3 | 0 |

### Appendix B. Post-hoc script (not pre-registered)
Save it as `research/core-20261006/p1-posthoc.mjs` and run it from the repository root: `node research/core-20261006/p1-posthoc.mjs experiments/runs/p1/results.jsonl`. It is read-only and imports the frozen `experiments/lib/stats.mjs`. Its output from that location was checked to be identical to the tables in §4. [M]

```js
// POST-HOC analysis for the P1 report (not pre-registered). Read-only: imports the frozen stats library,
// never writes into the repo. Usage: node research/core-20261006/p1-posthoc.mjs experiments/runs/p1/results.jsonl
import { readFileSync } from 'node:fs';
import { byArmTask, summarizeArm, pairedBootstrap, mcnemar } from '../../experiments/lib/stats.mjs';

const base = readFileSync(process.argv[2], 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const ARMS = ['fhand-haiku', 'fhand-sonnet', 'b0call-sonnet-med', 'b0call-haiku-none', 'b0call-haiku-med', 'b0ncall-haiku-med', 'b0agent-haiku', 'b0call-haiku45-none'];
const PAIRS = [['b0call-haiku-none', 'b0call-haiku45-none'], ['fhand-haiku', 'b0call-haiku-med'], ['fhand-haiku', 'b0call-haiku-none'], ['fhand-haiku', 'b0ncall-haiku-med'], ['fhand-haiku', 'b0agent-haiku'], ['fhand-haiku', 'b0call-sonnet-med'], ['fhand-sonnet', 'b0call-sonnet-med']];
const isTimeout = r => r.error?.code === 'MODEL_TIMEOUT';

// Cost variants. 'bound': PREREG §3, killed calls charged at their $1 per-call bound. Killed-in-flight calls at the
// 23:17 stop (re-run later) are added to the re-run trial of the same key at their bound; b0ncall streams are inference.
const INFLIGHT = [
  ['b0call-haiku-med', 'records:test:d3:s5003', 0, 1], ['b0call-haiku-none', 'records:test:d3:s5003', 1, 1],
  ['b0agent-haiku', 'records:test:d3:s5003', 1, 1], ['fhand-sonnet', 'records:test:d3:s5003', 1, 0.064],
];
const INFLIGHT_PROBABLE = [['b0ncall-haiku-med', 'records:test:d3:s5006', 0, 1], ['b0ncall-haiku-med', 'records:test:d4:s5005', 1, 1]];
function variant(kind) {
  return base.map(r => {
    let c = r.costUsd;
    if (isTimeout(r)) c += kind === 'bound' || kind === 'bound+inflight' ? 1 : kind === 'estimate' ? 0.045 : 0;
    if (kind === 'bound+inflight') for (const [a, t, tr, usd] of [...INFLIGHT, ...INFLIGHT_PROBABLE]) if (r.arm === a && r.taskKey === t && r.trial === tr) c += usd;
    return { ...r, costUsd: c };
  });
}

function armTable(recs, label) {
  console.log(`\n### ${label}`);
  console.log('| arm | d | success | rate | 95% CI | pass^3 | mean score | $ total | CPS | $/trial | timeouts |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  const g = byArmTask(recs);
  for (const arm of ARMS) for (const d of ['all', 'd3', 'd4']) {
    const sub = new Map([...g.get(arm)].filter(([k]) => d === 'all' || k.includes(`:${d}:`)));
    const s = summarizeArm(sub, { k: 3 });
    const trials = [...sub.values()].flatMap(t => t.trials);
    const ms = trials.reduce((a, r) => a + (r.score ?? 0), 0) / trials.length;
    console.log(`| ${arm} | ${d} | ${s.successes}/${s.trials} | ${fmt(s.successRate)} | [${fmt(s.ci.lo, 2)},${fmt(s.ci.hi, 2)}] | ${fmt(s.passHat3)} | ${fmt(ms)} | ${fmt(s.costUsd, 2)} | ${fmt(s.cps, 4)} | ${fmt(s.costPerTrial, 4)} | ${trials.filter(isTimeout).length} |`);
  }
}

function pairTable(recs, label, filter = () => true, pairs = PAIRS) {
  console.log(`\n### ${label}`);
  console.log('| A | B | tasks | success diff A−B [95% CI] | CPS ratio A/B [95% CI] | McNemar p (A-only/B-only) |');
  console.log('|---|---|---|---|---|---|');
  const sub = recs.filter(filter);
  for (const [a, b] of pairs) {
    const clustered = sub.filter(r => r.arm === a || r.arm === b).map(r => ({ ...r, family: r.taskKey.split(':')[2] }));
    const bs = pairedBootstrap(clustered, a, b, { iterations: 10000 });
    const m = mcnemar(sub, a, b);
    console.log(`| ${a} | ${b} | ${bs.tasks} | ${fmt(bs.successDiff.point)} [${fmt(bs.successDiff.lo)}, ${fmt(bs.successDiff.hi)}] | ${fmt(bs.cpsRatio.point)} [${fmt(bs.cpsRatio.lo)}, ${fmt(bs.cpsRatio.hi)}] | ${fmt(m.p)} (${m.aOnly}/${m.bOnly}) |`);
  }
}

armTable(base, 'A. Per-arm, all/d3/d4, recorded costs (fills the d4 rows the frozen analyzer omits)');
pairTable(base, 'B. Paired comparisons restricted to d3 (sensitivity; one cluster, so tasks are resampled within d3)', r => r.taskKey.includes(':d3:'));
pairTable(base, 'C. Paired comparisons restricted to d4 (for completeness; Haiku 5.5 single-call arms censored by the 300 s timeout)', r => r.taskKey.includes(':d4:'));
pairTable(variant('bound'), 'D. All tasks, timed-out calls charged at their $1 bound (PREREG §3)');
pairTable(variant('bound+inflight'), 'E. All tasks, timed-out calls and calls killed at the 23:17 stop charged at their bound (b0ncall in-flight calls are inference)');
pairTable(variant('estimate'), 'F. All tasks, timed-out calls charged at the estimated ~$0.045 each (inference)');
pairTable(variant('bound'), 'G. d3 only, timed-out call charged at $1 bound', r => r.taskKey.includes(':d3:'));

console.log('\n### H. CPS by cost treatment');
console.log('| arm | recorded $ | CPS recorded | $ at bound | CPS at bound | $ bound+inflight | CPS bound+inflight | CPS estimate |');
console.log('|---|---|---|---|---|---|---|---|');
const V = { rec: base, bound: variant('bound'), bi: variant('bound+inflight'), est: variant('estimate') };
for (const arm of ARMS) {
  const s = Object.fromEntries(Object.entries(V).map(([k, recs]) => [k, summarizeArm(byArmTask(recs).get(arm), { k: 3 })]));
  console.log(`| ${arm} | ${fmt(s.rec.costUsd, 4)} | ${fmt(s.rec.cps, 4)} | ${fmt(s.bound.costUsd, 4)} | ${fmt(s.bound.cps, 4)} | ${fmt(s.bi.costUsd, 4)} | ${fmt(s.bi.cps, 4)} | ${fmt(s.est.cps, 4)} |`);
}
const tot = recs => recs.reduce((a, r) => a + r.costUsd, 0);
console.log(`\nTotals: recorded ${fmt(tot(base), 4)}; +orphan 0.064 = ${fmt(tot(base) + 0.064, 4)}; bound ${fmt(tot(V.bound) + 0.064, 4)}; bound+inflight ${fmt(tot(V.bi), 4)} (+ fhand-sonnet unjournaled in-flight node calls, ≤$1 each); estimate ${fmt(tot(V.est) + 0.064, 4)}`);

console.log('\n### I. Passes per task (of 3)');
const g = byArmTask(base);
const tasks = [...g.get('fhand-haiku').keys()].sort();
console.log('| task | ' + ARMS.join(' | ') + ' |');
console.log('|---|' + ARMS.map(() => '---').join('|') + '|');
for (const t of tasks) console.log(`| ${t.replace('records:test:', '')} | ` + ARMS.map(a => { const tr = g.get(a).get(t).trials; const to = tr.filter(isTimeout).length; return `${tr.filter(x => x.pass).length}${to ? ` (${to} TO)` : ''}`; }).join(' | ') + ' |');

console.log('\n### J. Success among calls that finished (selected subset; not an imputation)');
for (const arm of ['b0call-haiku-none', 'b0call-haiku-med', 'b0ncall-haiku-med'])
  for (const d of ['d3', 'd4', 'all']) {
    const tr = base.filter(r => r.arm === arm && (d === 'all' || r.taskKey.includes(`:${d}:`)) && !isTimeout(r));
    console.log(`${arm} ${d}: ${tr.filter(r => r.pass).length}/${tr.length}`);
  }

console.log('\n### K. Latency per arm (s): median / max');
for (const arm of ARMS) {
  const ls = base.filter(r => r.arm === arm).map(r => r.latencyMs / 1000).sort((a, b) => a - b);
  console.log(`${arm}: median ${fmt(ls[Math.floor(ls.length / 2)], 0)} max ${fmt(ls.at(-1), 0)}`);
}
```

*Source files for this report (session scratch, read-only analyses):*
- `/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/p1-analyze-rerun.txt` (the frozen analyzer re-run)
- `/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/rpt-posthoc.mjs` and `rpt-posthoc.txt` (the post-hoc tables)
- `/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/rpt-freezecheck.mjs` (the freeze hash check)
- `/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/rpt-journal.mjs` and `rpt-journal2.mjs` (the journal queries)
- the diagnoses: `p1-diag-single.md` and `p1-diag-workflow.md` in the same folder.

No repository files or git state were changed.

## Independent check (2026-10-08)

An independent checker re-ran the frozen analyzer (byte-identical output), recounted every table from `results.jsonl` and the journal (no arithmetic errors), verified each diagnosis claim on at least two trials, and required 46 wording corrections (overclaims, miscounts, unlabelled post-hoc material), all applied above. It also required these caveats:

1. **B0+N timeouts also shaped its notes.** `afterTask` runs after a timeout and tells the notes writer the answer was "INCORRECT" (`b0-call.mjs:22`; for example, d4/s5004 t1 at 22:57:09). Timeouts therefore changed the notes for every later task in that stream, not only the trials they cut off.
2. **A B0 "single call" is a 2–3-turn CLI session.** The CLI returns structured output through a tool (`numTurns` 2, `stopReason` `tool_use`). 20 of 180 finished single calls took a third turn, with Haiku 5.5 11, Haiku 4.5 6 and Sonnet 3. Workflow node calls always took 2. All turns are included in cost. [M; cause of the third turn I]
3. **Interim outcomes were read during the run.** There is a results snapshot `p1-0820.jsonl` from 08:28, and 00-SYNTHESIS quotes interim figures at 08:44. No task content was read, and nothing changed: arm hashes and frozen files are unchanged.
4. **The Wilson intervals in condition (a) treat the 36 trials as independent.** Clustering by task would widen them, so (a) would only get easier to meet.
5. **ROADMAP §5.1 exit item 1 is only partly shown.**
   - It asks for a check on every node; the PREREG and the report say every model node, and code nodes were not audited here.
   - It asks for reproducible receipts; P1 shows only that every node call carries a receipt and that receipts map 1:1 to prompts.
   - Exit item 2 (replay conformance tests) is outside P1.
6. **Medians for even n are upper medians.** Medians of even-sized groups use the upper middle value (for example, Haiku 4.5 d3 output is 4.4K, against 4.2K as a two-value mean). State this once.
7. **This check also inspected the tasks.** On 2026-10-08 it regenerated truth for all 12 test tasks (`referenceSolve`), re-scored outputs, and read the 7 failing b0agent transcripts. The INSPECTED set is unchanged, but this check should be recorded in §8.
8. **Tags that can move from [D] to [M]:**
   - timeout latencies 300.28–300.85 s;
   - the orphan run's 9 calls and $0.0640;
   - the resume at 07:09:34.9;
   - the price-model reproduction of all 1,863 costs;
   - answer size about 7.2K (d3) and 9.8K (d4) characters;
   - every finished call ended with `stop`;
   - the Haiku 4.5 dedup result 0/22 and its per-field medians;
   - the C0 figures 11/16 against 16/16;
   - the a8 run: 20/20, Sonnet in 10 of 20 tasks.

   Add to the C0 citation that B1-haiku (Haiku writing a script) scored 16/16, so the C0 drop is specific to Haiku building Foundry workflows.
