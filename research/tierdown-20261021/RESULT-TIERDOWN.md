# RESULT-TIERDOWN (A10 / tasks #33, #42): leverage-ranked tier-down of compiled-workflow judges

Written 2026-11-04 by Claude Opus 5.5 (workflow subagent `wf_6d3b90c9-c30-9`), branch `worktree-wf_6d3b90c9-c30-9`.
Plan: [DOSSIER.md](DOSSIER.md). Preregistration: [PREREG-TIERDOWN.json](PREREG-TIERDOWN.json) (sha256 `2790ad22…dfaffd4`,
frozen before any paid call) and [AMENDMENT-1.md](AMENDMENT-1.md) (C-slice selection, rule-tier sha256s and the order,
frozen before any H call; all seven input hashes re-verified unchanged at 17:20 UTC before the H injection).

*Reviewed and corrected 2026-11-04 (§0); the preregistered primary result is unchanged, the exploratory headline is
replaced.*

**Evidence class: development.** Every unit is an archived dev-split compiled answer (records and kinetics, seeds
201–248) from `research/jit-20261008/runs`. H is a hash-split half of that archive, held out from every choice this
item made (tiers, rules, order, thresholds). It is **not sealed** and **not a fresh draw**. No sealed row, `beds/sealed/`
path or devCheck directory was read (the archive reader refuses them, `archive.mjs` `assertDevPath`).

## 0. Review 2026-11-04: corrections (read first; this section supersedes §1, §4, §6, §7 and §9 where they differ)

An adversarial review of commits 78857489..569109ff found one blocker and six major defects. All were applied on
2026-11-04 in this branch, at $0: no new paid call was made (no new model call of any kind). The preregistered primary
result stands. **The 23.4% exploratory headline does not:** it was mostly a measurement artefact, and the root cause is
more specific than the review stated (R1).

### 0.1 Restated answer

| question | answer (corrected) |
|---|---|
| Preregistered capability number (primary) | **0% cost saved at equal accuracy; nothing promoted.** Unchanged and valid: frozen in time, the fixed sequence stopped at site 1 (5 zero-flip H units, needs 149). |
| Exploratory number held out from every choice | **`selected-tier`: 2.8% delivery judge cost saved** (task-clustered 90% bootstrap interval 1.3–6.0%), 29/42 runs = reference, 0 lost / 0 gained. These are the five C-selected pairs that change a tier: Mercury on void-values, date-order and vendex-entries, the rule tier on countries and country-names. Equal accuracy is **not shown** (Tango one-sided 95% lower bound −0.061 per run, −0.110 per task, against −0.03). At the only priced Mercury listing (mercury-2.5) the same policy costs **2.5% more** than the reference. Against the full judge cost of a task (delivery plus amortised compile and check, $0.473) it saves **0.4%**. K = 1 throughout. |
| What was the 23.4%? | Two pairs that are **not tier changes**. `kinetics/prose-events-a`: two Haiku readers (`prose-events-a`, `prose-events-b`) and an Opus arbiter send one identical request; the override keyed on the request served one Haiku answer to all three, so the readers agreed by construction and the arbiter and the per-reader escalations never ran. `records/source-rules`: Haiku is the first tier of its own reference cascade. For both, the deployed cascade [tier, …reference] is the reference cascade itself (`policy.mjs` `cascadeOf`), so the expected tier-down saving is 0. Measured with K = 3 single-read draws at $0, replacing the two-reader vote by one Haiku read **loses 2 of 30 draws** (both where the arbiter decided), for 66% of that site's cost (R1). |
| Which tier choices hold? | Cheap tiers hold on the cheap leaf judges (0 lost in 87 single-pair H runs, K = 1). The decisive date-order leaf, scored against the bed's ground truth at $0: the Opus `rules` reader is right on all 57 leaves (C+H) and Haiku is wrong on 5 tasks, so Bound 2 was not penalising Haiku there; the Haiku ×5 date-order vote is wrong on 2 of 18 tasks and Mercury on 1 (R13). |
| Against all-frontier (the owner's baseline) | **Cost only:** the archived delivery judge calls re-priced at Opus 5.5 list price cost $0.594 per run, 9.0× the compiled solvers' $0.0661. Accuracy of an all-frontier arm is **not measured** (no Opus answers exist for the Haiku judges), so the owner's comparison remains open (R4). |
| Latency | Wall time per decision (concurrent vote samples counted once), not the sum of calls: Mercury is **2.6× faster** on void-values (5.9 s → 2.3 s) and **2.5×** on date-order (3.2 s → 1.3 s), not "about 10×". Judge time per run, p50: reference 40.4 s, `selected-tier` 38.9 s (R6). |
| Owner ask A10 | **Stays at D, not closed.** Gap: no all-frontier accuracy arm; per-site bounds need a fresh draw sized to the class; the decisive leaf needs its own reader scored against ground truth (§0.4). |

### 0.2 Corrected capability table (H, development, held out; supersedes §6)

42 runs of 22 tasks (records 28 runs / 14 tasks, kinetics 14 / 8). Runs of one task are not independent, so every
interval below is also given with one unit per task. Losses count deopts of passing runs (R10). Tier charge per reference
judge event × its k samples (R1). "Judge time" sums per-decision wall times over a run's decisions (R6). Full-system cost
adds $0.407 per task of amortised build-time judge spend (compile $37.80 + check $19.98 over the archive's 142 streamed
tasks, [data/full-system.json](data/full-system.json)). All tier arms ask K = 1 answer per decision; at the Haiku ×5 vote
sites the one answer was copied to all five samples (a unanimous vote by construction) and is charged five times.

| arm | runs (tasks) | passes | Δ acc (pt) | lost / gained | prereg NI (bound; holds) | Tango lower bound, runs / tasks | judge $ / run | **delivery saved** | 90% CI (tasks) | saved, Mercury at mercury-2.5 price | judge $ / verified success | full-system saved | full $ / verified success | judge time p50 / p95 (s) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B-ref (solvers as compiled) | 42 (22) | 29 | 0 | — | — | — | $0.0661 | 0 | — | — | $0.0958 | 0 | $0.685 | 40.4 / 251.1 |
| primary policy (preregistered) | 42 (22) | 29 | 0 | 0 / 0 | n/a (nothing changed) | — | $0.0661 | **0%** | — | — | $0.0958 | 0% | $0.685 | 40.4 / 251.1 |
| **selected-tier** (5 tier changes, frozen before H) | 42 (22) | 29 | 0 | 0 / 0 | 0.069; no | −0.061 / −0.110 | $0.0643 | **2.8%** | 1.3–6.0% | −2.5% | $0.0931 | 0.4% | $0.682 | 38.9 / 251.1 |
| selected (all 7 C picks, frozen before H) | 42 (22) | 29 | 0 | 1 / 1 | 0.084; no | −0.080 / −0.144 | $0.0484 | 26.9%* | 10.6–41.8% | 21.6% | $0.0700 | 3.8% | $0.659 | 38.4 / 251.1 |
| provisional (6 pairs, chosen ON H: in-sample) | 42 (22) | 29 | 0 | 0 / 0 | 0.069; no | −0.061 / −0.110 | $0.0519 | 21.6%* | 4.4–36.5% | 16.3% | $0.0751 | 3.0% | $0.664 | 38.4 / 251.1 |
| B-screen (0.98 agreement, no leverage) | 42 (22) | 29 | 0 | 0 / 0 | 0.069; no | −0.061 / −0.110 | $0.0646 | 2.4% | 1.1–5.0% | −1.9% | $0.0935 | 0.3% | $0.683 | 38.9 / 251.1 |
| B-all-haiku | 42 (22) | 25 | −9.5 | 5 / 1 | 0.210; no | −0.206 / −0.317 | $0.0344 | 48.1%* | 36.1–62.9% | 48.1% | $0.0577 | 6.7% | $0.741 | 43.6 / 393.3 |
| B-all-mercury | 28 (20); 14 incomplete | 18 | 0 | 0 / 0 | 0.101; no | −0.088 / −0.119 | $0.0672 | 3.3% | 1.4–11.1% | −5.4% | $0.1045 | 0.5% | $0.737 | 43.4 / 330.0 |
| B-sink (reference on the global readers) | 42 (22) | 27 | −4.8 | 2 / 0 | 0.142; no | −0.134 / −0.241 | $0.0620 | 6.3% | −1.0–14.6% | 2.1% | $0.0964 | 0.9% | $0.729 | 38.9 / 393.3 |
| B-memo (cache only) | 42 (22) | 29 | 0 | 0 / 0 | 0.069; no | −0.061 / −0.110 | $0.0661 | 0% | — | 0% | $0.0958 | 0% | $0.685 | 40.4 / 251.1 |
| all-frontier (cost estimate only) | 42 (22) | not measured | — | — | — | — | $0.594 | −799% | — | — | — | — | — | — |

\* Includes `prose-events-a@haiku` and/or `source-rules@haiku` (and, in B-all-haiku, `extract:*@haiku`, whose reference
cascade starts at Haiku in 27 of 30 H decisions): their "saving" is the K = 1 suppression of an arbiter, a split vote or an
escalation, not a tier change (R1). Source: [data/eval-H-v2.json](data/eval-H-v2.json) from
[data/inject-H-v2.json](data/inject-H-v2.json); the original [data/eval-H.json](data/eval-H.json) and `inject-H*.json`
are kept for the audit trail.

### 0.3 Finding by finding

| # | review finding | disposition | evidence |
|---|---|---|---|
| R1 | BLOCKER: 23.4% is an artefact; mechanism misstated | **Agreed, root cause refined.** The 2–3 "events" per run at `prose-events-a` are three different judges sending one request: readers `prose-events-a` and `prose-events-b` (Haiku, concurrent) and, on disagreement, `prose-events-arbiter` (Opus); in some solver versions each reader escalates to Opus on a failed check instead (s212). The override keys on the request without the model, so one value answered all three. Fixed: the tier is charged per reference event × k (`inject.mjs` `tierChargeOf`; prose-events-a: 11 asks for 5 decisions, not 5); a decision whose reference cascade starts at the candidate tier is flagged `sameFirstTier` (prose-events-a 5/5, source-rules 7/7, extract:* 27/30 on H); `selected-tier` drops those pairs by a rule read from the frozen PREREG `reference` field alone. Measured K = 3 at $0 (`readers.mjs`: both archived Haiku reader answers plus the paid fresh one, each injected end to end): one Haiku read instead of the vote loses **2 of 30 draws** (s214 C, s207 H; both arbiter units; 95% upper bound 0.195; Tango interval on the paired difference −0.183 to +0.022), and its expected cost is 34% of the reference at that site, so it is a speed-for-accuracy trade, not an equal-accuracy saving. The fresh K = 1 draw passed the check in s207 and s212 by chance; the archived Haiku answers of s212 fail it. | [readers-prose-events.json](data/readers-prose-events.json), `experiments/tierdown/readers.mjs`, `inject.mjs`, test `review.test.mjs` |
| R2 | provisional chosen and scored on H | **Agreed.** `provisional` is labelled in-sample everywhere. The held-out exploratory number is `selected-tier` (defined before this run from the frozen preregistration, no H outcome read); `selected` (frozen before H, 1 lost / 1 gained) is reported beside it. | §0.2 |
| R3 | units are runs, not tasks | **Agreed.** 42 runs = 22 tasks. Every arm now reports tasks, a Tango interval with one unit per task (the sign of the task's mean paired difference) and a task-clustered bootstrap of cost saved. The preregistered Bound 1 and NI stay unit = run as preregistered (PREREG `units`), and are anti-conservative; the next preregistration should use tasks. The build report's "42 held-out tasks" was wrong. | `policy.mjs` `nonInferiorTango`, `clusterBootstrapSaved` |
| R4 | owner ask not closed | **Agreed.** A10 stays D (gap note in [REQUIREMENTS-COVERAGE-20261021.md](../REQUIREMENTS-COVERAGE-20261021.md)). Added at $0: cost per verified success, full-system booking (dossier §5: delivery is 14% of a task's judge cost here), and an all-frontier **cost** estimate. All-frontier **accuracy** needs Opus answers for every Haiku judge: about $25 for the delivery calls of 42 runs at archived token counts, above this item's $5, and a comparative paid call needing its own preregistration. Not run. | [full-system.json](data/full-system.json), `inject.mjs` `frontierRatios` |
| R5 | K never labelled; vote sites tested as single answers | **Agreed; relabelled, not re-asked.** K = 1 is stated in every table. At date-order and void-values the "Mercury tier" is one answer copied to a unanimous 5-vote. Asking k = 5 would need 4 more answers for each of 16 H decisions, about 180K Mercury tokens at the observed 2.5–3.1K a call; the item has 31K left under its 0.5M limit, so the vote sites are relabelled instead. | §0.2, `report.mjs` |
| R6 | latency inflated | **Agreed.** Reference latency is now the union of the calls' wall intervals (`createdAt − latencyMs`, `createdAt`), so concurrent samples count once and a sequential arbiter adds. void-values 24.3 s summed → 5.9 s wall against Mercury 2.3 s (2.6×); date-order 13.8 → 3.2 s against 1.3 s (2.5×); prose-events-a 84.9 → 44.0 s. | `inject.mjs` `refWallMs`, inject-H-v2 `decisions[].refWallMs` |
| R7 | interrupted paid pass missing from the ledger | **Agreed, confirmed and documented.** `ledgerGap` over the committed files reproduces it exactly: answers-C.jsonl lines 1–79 hold 31 Haiku answers ($0.171923) and 12 Mercury answers (111,092 tokens) that no ledger line accounts for; the first ledger line (ended 14:43:30Z) starts from cap $2.828077 and 113,908 tokens, so the pass ended before it. A reconstructed line is in [answers-C.runs.reconstructed.jsonl](data/answers-C.runs.reconstructed.jsonl) (the original ledger file is left byte-identical). Its journal was deleted, so whether its first call preceded the PREREG commit (14:31:42; file final 14:27, content sha-checked by `--expect-sha`) **cannot be shown**. A sixth source-rules Mercury call cited by `run-c.sh` may have been billed and never written; unverifiable. Fixed forward: `tier-replay.mjs` writes its summary on SIGTERM/SIGINT and on errors, and stamps `askedAt` on every answer. | `tier-replay.mjs` `ledgerGap`, test #7 |
| R8 | frozen Mercury order not implemented; F12 cause wrong | **Agreed.** `--sites` was a filter; jobs ran in archive-row order, and the Haiku-arm records rows (which carry `source-rules` but no `rules` judge) sort first, so the last H pass spent the remaining 44,222-token share on `records/source-rules` (3 calls, 63,187 tokens, 2 truncated) before any `records/rules` (Opus-arm rows) or `kinetics/well-events` (jit-r0-kinetics rows) decision. F12 is corrected below. Fixed: `--sites` is a priority order (`orderBySite`). The `max_tokens` fix was foreseeable from C and landed after H: agreed. | `tier-replay.mjs`, test #8 |
| R9 | Mercury's $0 price drives the savings | **Agreed.** Every arm is re-priced at mercury-2.5's listed $0.20 / $0.75 per MTok: `selected-tier` turns from +2.8% to −2.5%, B-screen to −1.9%, B-all-mercury to −5.4%. Mercury is cheaper only at its promotional price, and capped by D18 tokens. | §0.2, `policy.mjs` `pricedUsd` |
| R10 | a deopt is never a pass→fail flip | **Agreed, fixed.** `directionOf` and `lossOf` count a deopt or crash of a passing unit as a loss, in old and new files. No effect on H (no deopts). Rechecked on C: the frozen selection and order are unchanged (rules@haiku goes from 1 to 3 losses but was already excluded by Bound 2). | `analyze.mjs`, tests |
| R11 | NI takes gains at their point estimate | **Agreed.** Tango's score interval is reported beside the preregistered test (which stays as preregistered). Newcombe's hybrid interval was rejected after checking it: with no discordant pairs its width is the Wilson asymmetry, about ±0.02 at n = 42, so it would "show" a 3-point NI from zero events; Tango gives the closed form ±z²/(n+z²) = ±0.061. | `policy.mjs` `tangoInterval`, tests |
| R12 | H outcomes leaked into the paid-site choice | **Agreed, and measured as inconsequential.** The pooled screen did use H perturbation outcomes; AMENDMENT-1's "nothing in the H slice had been read" is overstated for that synthetic screen. Re-ranked on C rows only, the top eight sites come out in the same order (well-events, prose-events-a, rules, extract:*, source-rules, date-order, rulebook, void-values), so the site list would not have changed. Leverage classes (δ) were C-only all along. | this section |
| R13 | date-order rule provenance unverifiable | **Agreed; cannot be repaired after the fact.** The skip-list (`rules/date-order.mjs` L44) contains all six of the generator's `UPDATE_FIELD` words. The rule's H results are not evidence of generalisation. It was never in a promoted or headline arm; it is wrong on one H task (s217) against ground truth. Next time: log the C request hashes read while writing a rule and test it on forms held out from C. | [truth-date-order.json](data/truth-date-order.json) |
| R14 | kill-rule check is weak | **Agreed.** ρ = 0.53 over 10 sites, 95% interval −0.20 to 0.88: "kept" carries almost no information. | [leverage-check.json](data/leverage-check.json) `rhoInterval` |
| R15 | test gaps | **Fixed.** `replay.test.mjs` now finds the archive through the main worktree when run from a linked one, says so on stderr when it skips, fails under `TIERDOWN_REQUIRE_ARCHIVE=1`, and tests a **real** replay miss (row #8, a swapped void marker). New `review.test.mjs` (11 tests) pins per-event charging, wall latency, deopt as loss, site order, the interrupted-run ledger against the committed files, Tango, task-level NI, the bootstrap, ρ's interval, Mercury pricing, frontier ratios, `readers.mjs` and `truth.mjs`. | tests |
| R16 | provenance details | **Agreed.** `run-c.sh` cited a non-existent "§Deviations D3" and "first 6 answers" (5 recorded): corrected in its header. The `tier-replay.mjs` that asked the H passes (14:53–15:12) was committed at 17:19 (ae0ecc72), after them; f20e6ca7 does not hold the exact code that asked H. The diff between them (`git diff f20e6ca7 ae0ecc72 -- experiments/tierdown/tier-replay.mjs`, 4 lines) only adds Haiku to the allowed-model list given to `createModelPort`, so the policy subset validates in a Mercury-only pass; requests and decoding are unchanged. | git history |

**Cheaper approaches the review named.** (1) *Score decisive leaves against the bed's truth*: done at $0
(`truth.mjs`, R13 row and §0.1). (2) *Evaluate the rule + Mercury agreement cascade from committed data*: done. At
records/date-order, serving the rule's answer when the rule and Mercury agree and the reference otherwise agrees on 15 of
18 decisions, loses no task, gains one (C, in-sample for the rule), has the right leaves on 17 of 18 (the reference 16 of
18) and costs 14% of the reference at that site. On H alone: 6 of 8 agree, 0 lost, 0 gained, 8 of 8 leaves right. Small
and partly in-sample; it is the next preregistration's candidate, not a result. (3) *De-duplicate identical requests within
a run*: the repeats at prose-events-a are an intentional two-reader vote with an arbiter, so de-duplication is exactly the
single read measured in R1 (2 of 30 lost). **Disagree** that it is zero risk here. (4) *Retry the cheap tier before
escalating*: not measured; the archive holds one first-tier draw per escalation, so it needs paid draws. (5) *Spend the
budget where it can earn a promotion*: agreed. Re-running the existing compiled records solvers on about 30 fresh dev seeds
costs roughly $0.07 a run in delivery judges (more where a run deopts), so a 29-unit draw for the low-leverage records sites
fits in the $4.49 left. It is a new paid comparative run that needs its own seed-ledger block and preregistration, so it
was not started in this fix pass; it is the first next step (§9.4).

### 0.4 Files changed by this review, and manifest hashes

No e-mail address of any kind is in this branch's files or commit metadata except `noreply@anthropic.com` (checked
over all 61 changed or new files and every commit author and message), so no address was replaced.

- Code: `experiments/tierdown/{inject,analyze,policy,tier-replay,replay,report}.mjs`, `run-c.sh`, `test/{analyze,replay}.test.mjs`;
  new `readers.mjs`, `truth.mjs`, `run-inject-h-v2.sh`, `test/review.test.mjs`.
- Data, new: `inject-H-v2.json`, `eval-H-v2.json`, `full-system.json`, `readers-prose-events.json`, `truth-date-order.json`,
  `answers-C.runs.reconstructed.jsonl`. Data, regenerated: `leverage-check.json` (same rows and ρ, plus `rhoInterval`; its
  hash changed; no manifest lists it).
- Frozen inputs re-verified unchanged (sha256 prefix): PREREG-TIERDOWN.json `2790ad22d001`, rules `countries.mjs`
  `cca9abe4e66e`, `date-order.mjs` `15374a388230`, `index.mjs` `12e3d48e8efd`, `select-C.json` `9613f165f7aa`,
  `answers-C.jsonl` `e27d70a6184b`, `answers-C-rule.jsonl` `67cc5f6617cb`, `inject-C.json` `daadb673a585`. No earlier
  manifest hash is invalidated by this review. The H answers files and `inject-H*.json`, `eval-H.json` are byte-identical.

## 1. Answer

*(Original text of 2026-11-04 17:34. Superseded by §0.1 where they differ: the "exploratory provisional policy" and
"where is the money" rows are wrong as written, see R1, R2, R6.)*

| question | answer |
|---|---|
| Which judge nodes matter? | A $0 counterfactual screen of all 88 archived compiled answers (88/88 replay faithfully) ranks 21 judge sites by leverage × cost share. Top: `kinetics/well-events` (Opus, leverage 0.30, 23% of judge spend), `kinetics/prose-events-a`, `records/rules`, `kinetics/extract:*`, `records/source-rules`. |
| Do cheaper tiers hold? | Not on the expensive global readers. Haiku in place of Opus/Sonnet flips pass→fail on `records/rules`, `kinetics/well-events` and `kinetics/extract:*` on both slices, and on `records/source-rules` on H. Mercury and the abstaining rule tier hold on the cheap Haiku leaf judges (0 pass→fail in 90 H site-units). |
| Preregistered policy (primary) | **Promotes nothing.** The fixed sequence stops at site 1 (`prose-events-a@haiku`: 5 zero-flip H units, needs 149). Cost saved at equal accuracy: **0%**, exactly as preregistered. |
| Exploratory provisional policy | 6 sites tiered down. On the 42 H units: **29/42 passes, the same as the reference, 0 flips either way; delivery judge USD −23.4%** ($0.0661 → $0.0507 a unit); judge latency p50 74 s → 45 s. Non-inferiority at 3 points is **not shown**: 42 units cannot show it even with zero losses (upper bound 0.069; it needs about 99). |
| Where is the money? | 88% of that saving is one site, `prose-events-a` (Opus reference → Haiku). The Mercury and rule tiers replace Haiku judges that cost fractions of a cent; they save latency (void-values 24.3 s → 2.3 s), not dollars. The dollars sit in the high-leverage readers that cheaper tiers fail. |
| Build time | Measured, not applied: 45.5% of archived build-time judge spend ($26.26 of $57.78) repeats a request an earlier run of the same arm already answered. That is 4× the archive's whole delivery judge bill ($6.46). Applying it changes what `jit-check` measures and needs an owner decision. |
| Paid spend | Haiku **$0.51** (101 calls, 0 failures), Mercury **468,965 tokens** ($0 listed; 113 calls), Jev 0 (refused: no key), total **$0.51 of $5**. |

## 2. What was built (`experiments/tierdown/`, new files; no `src/` edit)

| file | role |
|---|---|
| `archive.mjs` | archived JIT streams as material; dev-only guard (sealed, devCheck, non-dev split, seed ≥ 7001 refused) |
| `override.mjs`, `replay.mjs` | flow-v3 override hook + strict memo replay of an archived compiled answer at $0 |
| `perturb.mjs`, `leverage.mjs` | fidelity gate and one-leaf-at-a-time perturbation screen; leverage × cost share ranking |
| `classes.mjs` | leverage classes from the C slice only |
| `tier-replay.mjs` | paid node replays (Haiku, Mercury by explicit id with a run token cap, rule, memo) under `--expect-sha`; item-wide ledger caps; environment faults never scored |
| `rules/` | rule tier: country lexicon, date-order cue reader; abstains on anything unrecognised (frozen by sha256) |
| `inject.mjs` | end-to-end injection: real tier answers served through the override, every other judge at its archived answer, oracle on the output; cascade fallback on missing, abstained or check-rejected answers (charged both) |
| `policy.mjs` | Bound 1 (Clopper-Pearson), Bound 2, fixed-sequence testing, exact McNemar, non-inferiority, cascade, shadow count, CUSUM demotion |
| `analyze.mjs` | node tables, C selection, H evaluation, capability rows, `mergeInject`, `leverageCheck` (Spearman kill rule) |
| `buildmemo.mjs` | prices a build-time k-th-answer memo across runs (not applied) |
| `leafdiff.mjs` | root-cause helper: decision-leaf differences of every moved unit against the value the solver was served |
| `report.mjs` | tables below from the data files |
| `readers.mjs` (review) | $0 K = 3 single-read draws at `prose-events-a` (two archived Haiku reader answers plus the paid fresh one) |
| `truth.mjs` (review) | $0 date-order leaf accuracy against the records world's ground truth; the rule + Mercury agreement cascade |
| `run-paid.sh`, `run-c.sh`, `run-h.sh`, `run-inject-h.sh`, `run-inject-h-provisional.sh`, `run-inject-h-v2.sh` (review) | detached drivers |

Tests (`nice -n 15 node --test --test-concurrency=1 <file>`, one at a time), after the review: `test/analyze.test.mjs`
11/11, `test/lib.test.mjs` 12/12, `test/rules.test.mjs` 6/6, `test/review.test.mjs` 11/11, `test/replay.test.mjs` 2/2
(real sandboxed replays of archived rows; it now finds the archive through the main worktree, and its second test is a
real replay miss). All pass. Before the review: analyze 10/10, lib 12/12, rules 6/6, replay 1/1. Tests with teeth include these: a decisive perturbation
must flip the oracle, and a check-rejected served answer must fall back. An incomplete unit must never be scored as
the reference. A reordered list must not count as a difference. A Mercury request must carry `max_tokens` equal to the
provider's reservation (F2).

## 3. Phase 0 ($0): fidelity and leverage

- **Fidelity gate.** 88 of 88 archived compiled answers replay faithfully under flow-v3 with the strict memo (dossier
  target was 70 of 74 plus R0). Unmeasured perturbations (a changed value alters a later prompt, so the memo misses): 7
  of 76 on `records/rules` and 19 of 120 on `kinetics/doc-units`; every other site 0.
- **Ranking** ([data/leverage.md](data/leverage.md)): leverage × cost share puts `kinetics/well-events` (0.070),
  `kinetics/prose-events-a` (0.018), `records/rules` (0.015), `kinetics/extract:*` (0.009) and `records/source-rules`
  (0.006) first. Ten sites went to the paid phases (the PREREG table).
- **Kill rule** (dossier §5: drop the synthetic screen if its ranking disagrees with injected outcomes). Spearman between
  the C-slice screen flip rate and the rate at which real cheaper-tier answers moved the outcome (C and H, all model and
  rule tiers): **ρ = 0.53** over 10 sites ([data/leverage-check.json](data/leverage-check.json)). The screen is kept,
  but only just. The outlier is `kinetics/extract:*`: screen 0.06, injected 3 of 5 moved. The screen changes one leaf at
  a time, while a cheap extractor's errors span many leaves at once (D9 on H: 30 events against 5). **One-leaf
  perturbation understates the risk of extractors.**

## 4. Node replays (agreement on decision leaves; tolerant numbers; evidence stripped)

H slice (C in [data/select-C.json](data/select-C.json) and `report.mjs`). Cost is per decision, a k-sample reference
charged k times. Latency is the call's own. **K = 1 for every tier** (one answer per decision). *Review: the "ref p50"
column sums concurrent calls; per-decision wall time is void-values 5.9 s, date-order 3.2 s, prose-events-a 44.0 s
(§0.3 R6). prose-events-a's reference is two Haiku readers plus an Opus arbiter or escalation, not Opus (R1).*

| site | tier | answered | usable | mean leaf agreement | tier $/decision | ref $/decision | tier p50 | ref p50 |
|---|---|---|---|---|---|---|---|---|
| kinetics/extract:* | haiku | 30 | 30 | 0.847 | $0.0067 | $0.0270 | 38.0 s | 28.4 s |
| kinetics/prose-events-a | haiku | 5 | 5 | 0.964 | $0.0081 | $0.1224 | 52.6 s | 84.9 s |
| kinetics/well-events | haiku | 2 | 2 | 0.683 | $0.0073 | $0.1481 | 48.5 s | 26.5 s |
| records/rules | haiku | 8 | 8 | 0.956 | $0.0016 | $0.0374 | 11.6 s | 8.7 s |
| records/source-rules | haiku | 7 | 7 | 0.953 | $0.0036 | $0.0246 | 13.5 s | 14.7 s |
| records/source-rules | mercury | 3 | 1 | 0.864 | $0 | $0.0025 | 17.9 s | 9.9 s |
| records/date-order | mercury | 8 | 8 | 1.000 | $0 | $0.0017 | 1.3 s | 13.8 s |
| records/date-order | rule | 8 | 7 (1 abstain) | 0.952 | $0 | $0.0017 | 0.0 s | 13.8 s |
| records/void-values | mercury | 8 | 8 | 1.000 | $0 | $0.0029 | 2.3 s | 24.3 s |
| records/vendex-entries | mercury | 15 | 15 | 0.996 | $0 | $0.0024 | 9.5 s | 13.1 s |
| records/countries | mercury / rule | 8 / 8 | 8 / 8 | 1.000 / 1.000 | $0 | $0.0004 | 2.1 s / 0.0 s | 3.1 s |
| records/country-names | mercury / rule | 16 / 16 | 16 / 16 | 0.984 / 1.000 | $0 | $0.0002 | 1.2 s / 0.0 s | 1.7 s |

The memo tier answered 0 of 211 delivery decisions (C and H); see F9. Haiku had 101 calls with 0 failures. Mercury had
107 usable answers in 113 calls.

## 5. Selection on C, then promotion on H

**C selection** (AMENDMENT-1, mechanical): the order was prose-events-a@haiku, source-rules@haiku, void-values@mercury,
date-order@mercury, vendex-entries@mercury, countries@rule, country-names@rule. The following were not selected and keep
their reference tier:

- `records/rules`: Haiku fails Bound 2 (disagreement 0.062, 1 pass→fail plus 2 deopts in 11 units); Mercury usable 3/5.
- `kinetics/well-events`: Haiku disagreement 0.231 and 2 pass→fail in 3 units.
- `kinetics/extract:*`: Haiku disagreement 0.115 and 1 pass→fail in 2 units.

**H, primary (preregistered).** Fixed sequence at α = 0.05. Site 1, `prose-events-a@haiku`, has 0 pass→fail in 5 units.
Its Clopper-Pearson upper bound is 0.45, above δ = 0.02. So the verdict is keep-reference, and the sequence stops; the
other six are not tested. This was the stated prediction: the largest per-site H count is 16, and the zero-flip unit
counts needed are 29, 59 and 149.

**H, provisional (exploratory, labelled as such).** A pair is kept if it has zero H pass→fail flips and holds Bound 2 on
H. Six of seven are kept. `records/source-rules@haiku` is dropped: 1 pass→fail (s223) and 1 fail→pass (s222) on 7 units.
Units per kept pair: prose-events-a 5, void-values 8, date-order 8, vendex-entries 15, countries 8, country-names 16. A
second $0 pass injected the six together ([data/inject-H-provisional.json](data/inject-H-provisional.json)).

## 6. Capability vs the simple baselines (H, 42 units: 28 records + 14 kinetics; dev, held out)

*Superseded by §0.2 (review 2026-11-04). Kept as first written: the provisional and selected savings below include the
arbiter/escalation suppression of R1, charge per request instead of per judge event, sum concurrent latencies, count
units as if they were independent tasks, and price Mercury at its $0 promotional listing only.*

Delivery judge USD per unit: archived list-price cost for reference answers, measured cost for tier answers, fallback
answers charged twice. Latency is the sum of a unit's judge latencies, not wall clock. NI means non-inferior at a
3-point margin: the one-sided 95% upper bound on the loss rate, minus the observed gain rate, must be < 0.03.

| arm | units | passes | accuracy | vs ref | p→f / f→p | McNemar p | NI | judge $/unit | **cost saved** | judge latency p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| **B-ref** (solvers as compiled) | 42 | 29 | 0.690 | — | — | — | — | $0.0661 | 0 | 74 / 251 s |
| **primary policy** (preregistered) | 42 | 29 | 0.690 | 0 | 0 / 0 | 1 | n/a | $0.0661 | **0%** | 74 / 251 s |
| **provisional** (exploratory) | 42 | 29 | 0.690 | 0 | 0 / 0 | 1 | not shown (0.069) | $0.0507 | **23.4%** | 45 / 251 s |
| selected (all 7 C picks, exploratory) | 42 | 29 | 0.690 | 0 | 1 / 1 | 1 | not shown (0.084) | $0.0472 | 28.7% | 38 / 251 s |
| B-screen (0.98 leaf agreement, no leverage) | 42 | 29 | 0.690 | 0 | 0 / 0 | 1 | not shown (0.069) | $0.0646 | 2.4% | 62 / 251 s |
| B-all-haiku | 42 | 25 | 0.595 | **−9.5 pt** | 5 / 1 | 0.22 | no (0.210) | $0.0332 | 49.9% | 56 / 393 s |
| B-all-mercury | 28 (14 incomplete) | 18 | 0.643 | 0 | 0 / 0 | 1 | not shown (0.101) | $0.0672 | 3.3% | 79 / 330 s |
| B-sink (reference on global readers) | 42 | 27 | 0.643 | **−4.8 pt** | 2 / 0 | 0.50 | no (0.142) | $0.0620 | 6.3% | 61 / 393 s |
| B-memo | 42 | 29 | 0.690 | 0 | 0 / 0 | 1 | not shown (0.069) | $0.0661 | 0% | 74 / 251 s |

**Reading.**

- The preregistered capability number is **0% cost saved at equal accuracy**. It is a correct result of a test that
  could not pass on this archive.
- The exploratory provisional policy matches the reference on all 42 paired units at −23.4% delivery judge cost, 10× the
  B-screen saving. It is not a demonstrated non-inferiority.
- The simple "Haiku everywhere" baseline halves the bill but loses 9.5 points. "Frontier only on the global readers"
  (B-sink) loses 4.8 points too, because the per-document kinetics extractors are not global readers but are just as
  fragile (2 pass→fail).
- B-all-mercury is incomplete: Mercury `records/rules` and `kinetics/well-events` were never asked on H, because the
  token share was spent (F12).
- Absolute size: $0.65 saved over 42 units. In this archive the delivery judges are 10% of judge spend; the build-time
  judges are 90%.

## 7. Failures, root-caused

**F1. The primary policy promotes nothing (design limit, predicted).**
- Per-site H counts are 2–16. Bound 1 needs 29 / 59 / 149 zero-flip units for δ = 0.10 / 0.05 / 0.02.
- Root cause: the archive holds 42 H units across two families. A held-out slice cut from it cannot carry preregistered
  per-site bounds.
- Pooling C and H would give `records/country-names@rule` 35 zero-flip units (≥ 29). It is still inadmissible: the rule
  was written from C.
- Fix: a fresh held-out draw sized to the class (the dossier's seeds 701–760 plus a live reference run, ≤ $30). The
  alternative is a cascade whose verified check takes the burden off δ (§8).

**F2. The preregistered Mercury cap of 450,000 tokens overshot by 18,965 (4.2%), reaching 468,965.**
- It stayed under the 0.5M-per-item and D18 envelopes.
- Root cause: `src/models/providers/openai-chat.mjs` reserves `input + 8,000` output tokens per call (L69) against the
  run cap. But when the caller sets no `maxTokens`, it sends no `max_tokens` (L56), and the endpoint then lets a call
  bill up to about 24K completion tokens.
- Pass 4 on H shows it: a 44,222-token cap was charged 63,187 tokens by 3 calls, 2 of them truncated at about 23.7K.
- Fix (forward; no answer in the data was asked with it): `tier-replay.mjs` `decodingFor` sends `maxTokens` 8,000 for
  Mercury, so projection equals enforcement, and a test pins it. Handed to the Mercury track (#73): the provider itself
  should send `max_tokens` equal to its allowance whenever it reserves one.

**F3. Mercury `MODEL_TRUNCATED` on `records/source-rules` (4 of 8 asked, C and H).**
- Observed ([data/model-failures.json](data/model-failures.json)):
  - The visible text is 460–587 characters, a nearly closed JSON object whose quotes are cut mid-phrase (`"A"`,
    `"Do not read "`, `""`).
  - Billed completion tokens are 23,507–23,871, of which 1,442–4,483 are reported as reasoning.
  - So about 19–22K billed tokens are neither visible nor reported. The usable answers at this site billed 1.6–4.7K.
- Root cause on our side: none. The request is the same as for the usable answers. The cause inside the endpoint cannot
  be determined from here [I: hidden generation that is not reported].
- **Correction:** AMENDMENT-1 §4 says "Mercury writes long answers". That is wrong: the visible answers are short, and
  only the billed count is long.
- Effect: Mercury is unusable at this site (usable 0.60 on C), which excluded it before H.

**F4. Mercury `MODEL_SCHEMA` on `records/rules` (2 of 5 on C).**
- The request asked for strict `json_schema`. Mercury returned `void_markers` items without the required `system` key.
- Observed: Mercury's strict structured output does not enforce a nested `required`. The provider validated the output
  locally and refused it, so nothing was silently accepted.

**F5–F6. The decisive leaf on records is one system's date order, and three judge sites re-read it.**
Every Haiku-caused outcome change on records comes down to the date order of one system (ATLAS or BRIGHTDESK). Leaf
diffs are against the value the solver was served ([data/leafdiff-C.txt](data/leafdiff-C.txt),
[data/leafdiff-H.txt](data/leafdiff-H.txt)).
- `rules@haiku` C: 2 deopts of kind `invariant`. On s212, `date_order/ATLAS` is the only differing leaf, so the
  solver's invariant guard caught the misread [I: as an inconsistency with the switch list].
- `rules@haiku` C: 1 pass→fail (s208), `date_order/BRIGHTDESK`.
- `rules@haiku` H: 1 pass→fail (s223). Haiku flipped `date_order/ATLAS` **and** `date_order_switches/0/order_from`
  consistently, so the invariant passed and the wrong reading went through. **A consistency guard cannot catch a
  consistent misreading.**
- `source-rules@haiku` C: 1 deopt on `atlas_numeric_dates`.
- `source-rules@haiku` H: the same two leaf changes on s222 and s223 (`atlas_numeric_dates` DMY_then_MDY → MDY_then_DMY,
  and void markers without the `:: ` prefix). They flipped s222 fail→pass and s223 pass→fail. The reference itself is
  wrong on s222.
- The date-order site shows the same pattern (C): Mercury and the rule each turned fail→pass where the Haiku ×5 vote
  read BRIGHTDESK or ATLAS as DMY (AMENDMENT-1 notes).
- This is the N3 near-tie, now located: one leaf carries the records family's leverage, the reference tier is not
  ground truth on it, and agreement with the reference (Bound 2) penalises a tier for being right (F11).

**F7. `kinetics/well-events@haiku`: 3 pass→fail in 5 units (C + H).**
- Root cause: omission in a long global list. On s233 Haiku drops one of two temperature-excluded wells (`OB-0186`)
  and the whole 9-sample relabel group. On s235 it splits the one relabel group into four.
- It is a recall failure on the tail of a document-wide reader, so this is a frontier-tier node.

**F8. `kinetics/extract:*@haiku`: 3 pass→fail in 5 units.**
- Root cause: over-extraction and kind misclassification. One document yields 30 events against 5, with reader flags
  read as events.
- The solver's own check rejected 1–3 answers per unit, which fell back to the reference. It accepted the rest, which
  were wrong in ways the check does not test. The check covers schema and quotes, not event recall.

**F9. The memo tier never answered at delivery (0 of 211 decisions).**
- Root cause: each compiled solver writes its own judge prompts, so two arms almost never send an identical delivery
  request. The archive holds 21 such cross-run repeats in 852 delivery calls ($0.002).
- The repeats live at build time (45.5% of build spend, §1). The dossier expected this.

**F10. Jev not measured.** `FOUNDRY_SYSTEMONE_API_KEY` is not provisioned in this session, so the tier was refused before
any call (PREREG). This is a blocker, not a result. Jev's errors correlate with Claude's (phi 0.61), which already made
it a weak cascade partner.

**F11. Bound 2 measures agreement with a reference that is wrong on the decisive leaf.** *Review: refined by ground
truth ([data/truth-date-order.json](data/truth-date-order.json)). True at date-order (the Haiku ×5 vote is wrong on 2 of 18
tasks) and source-rules (the reference is wrong on 4 of 17); false at `records/rules`, where the Opus reference is right on
all 57 date-order leaves and every Haiku disagreement there is a Haiku error.*
- The date-order rule (C: 2 fail→pass, disagreement 0.083) was excluded by the preregistered yardstick.
- On H it has 8 units, 0 flips and 1 abstention: VENDEX has no date-order cue, so that unit fell back to the reference.
- Kept out of the policy as preregistered. The next preregistration should score the decisive leaf against the
  **oracle** (pass/fail), not against the reference answer.

**F12. Incomplete baselines.** B-all-mercury leaves out 14 of 42 units. Mercury was never asked `records/rules` or
`kinetics/well-events` on H. *Corrected cause (review R8):* not the selected sites. `--sites` was a filter, not the frozen
priority order (AMENDMENT-1 §4): the last pass walked rows in archive order, the Haiku-arm records rows (which carry
`source-rules` and no `rules` judge) came first, and `records/source-rules`, already excluded on C for truncation, spent the
whole remaining 44,222-token share in 3 calls (63,187 tokens, 2 truncated) before any `rules` or `well-events` decision was
reached; the cap then refused (`MODEL_BUDGET`). Fixed (`orderBySite`). Incomplete units are counted, never scored as the
reference (clarification 3).

**F13. Own tool defect, found and fixed.**
- The first `leafdiff.mjs` took "the first archived delivery answer to the identical request" as the reference.
  `source-rules` escalates, so that is a Haiku draft, not the served Sonnet/Opus answer. The tool showed 0 differences
  for a unit with agreement 0.903.
- It now replays the row and diffs against the served value, the same reference `tier-replay.mjs` scores against.
- A known caveat is documented in the tool: the multiset sort can misalign list items after the first change.

## 8. Deviations from the dossier (with reasons)

| dossier | done | reason |
|---|---|---|
| H = fresh dev seeds 701–760 plus a live reference run (≤ $30) | H = hash-split half of the archive | The item budget was ≤ $5. The cost is F1: H is too small for the preregistered bounds. |
| Jev tier for enum leaves | refused | no key (F10) |
| Rule synthesis by Opus (≤ $5) | rules written by the session's frontier author from C requests only, $0 marginal | Same model role, no API call. Frozen by sha256 before H. |
| Mercury ≤ 0.4M tokens | cap 450K preregistered, 468,965 used | F2 |
| Build-time memo config | priced (`buildmemo.mjs`), not applied | It changes what `jit-check` measures, so it needs an owner decision (dossier §4.5). |
| A1-C node-level verdict accuracy from the dev60 transcripts | not done | Out of this item's time. It stays with the A1-C v2 track. The dossier's finding (Mercury checker 17/28 against Haiku 9/25) is unchanged and unreplicated here. |

## 9. Honest reading and next steps

*§9 items 1 and 3 are corrected by §0: the delivery-time saving that holds out of sample is 2.8% at Mercury's $0 price
(−2.5% at a priced Mercury listing), `prose-events-a` was not "a frontier-priced node asking an easy question" but a
two-reader vote with an arbiter (R1), and the latency gain is about 2.5×, not 10× (R6).*

1. **The plan works, and the capability claim is not earned yet.**
   - The $0 counterfactual substrate works: 88/88 faithful, injection without D11's re-sampling confound, and
     leverage-ranked sites.
   - The data say cheaper tiers are safe on the cheap leaf judges and unsafe on the expensive global readers.
   - Tier-down at delivery time is therefore worth little in dollars on these families (≤ 23% of a bill that is 10% of
     judge spend), unless a frontier-priced node asks an easy question, as `prose-events-a` did.
   - It is worth more in latency: Mercury and the rules are about 10× faster on the sites whose reference is a Haiku ×5
     vote (void-values, date-order), and 1.4–1.5× on the single-answer sites.
2. **Leverage concentrates in leaves, not nodes.** On records, one leaf decides most outcomes: a system's date order. A
   node-level tier choice is too coarse. Next: route the decisive leaf to its own reader, a cascade of the rule (which
   abstains) and Mercury cross-checked against Haiku, with escalation only on disagreement. Everything else in the
   global reader can then go to the cheap tier. Score it against the oracle, not the reference (F11).
3. **The real money is at build time.**
   - A k-th-answer memo across runs prices at 45.5% of build-time judge spend in this archive.
   - Check-time judge calls are 31% of all judge spend, and 54.5% of that spend is cross-run repeats.
   - An owner decision on memoised checks (it changes what `jit-check` measures) is worth more than any delivery-time
     tier-down measured here.
4. **To earn a preregistered promotion** (first next step after the review), draw a fresh held-out set sized to the class, with one unit per task,: ≥ 29 units per low-leverage site
   (country, vendex) is cheap, while 149 per high-leverage site is not. Either cascade the high-leverage sites behind an
   oracle-grade check, or keep them at the reference.
5. **Mercury:** usable and fast on short enum and map questions (void, date, countries, vendex), with 0 pass→fail. On
   long structured outputs it truncates (F3) and is non-strict (F4). Hand-offs to #73: F2, F3 and F4.

## 10. Reproduce ($0 from the committed data)

```
nice -n 15 node experiments/tierdown/analyze.mjs evaluate --prereg research/tierdown-20261021/PREREG-TIERDOWN.json \
  --selection research/tierdown-20261021/data/select-C.json \
  --answers research/tierdown-20261021/data/answers-H.jsonl,research/tierdown-20261021/data/answers-H-rule.jsonl \
  --inject research/tierdown-20261021/data/inject-H.json,research/tierdown-20261021/data/inject-H-provisional.json --out /tmp/eval-H.json
nice -n 15 node experiments/tierdown/report.mjs research/tierdown-20261021/data
# injection and leaf diffs replay the archive (read-only): TIERDOWN_RUNS=<main tree>/research/jit-20261008/runs
TIERDOWN_RUNS=... bash experiments/tierdown/run-inject-h.sh
# review 2026-11-04 (all $0): corrected injection, evaluation, full-system booking, single-read draws, ground truth
D=research/tierdown-20261021/data R=<main tree>/research/jit-20261008/runs
TIERDOWN_RUNS=$R bash experiments/tierdown/run-inject-h-v2.sh
node experiments/tierdown/analyze.mjs evaluate --prereg research/tierdown-20261021/PREREG-TIERDOWN.json --selection $D/select-C.json \
  --answers $D/answers-H.jsonl,$D/answers-H-rule.jsonl --inject $D/inject-H-v2.json --out $D/eval-H-v2.json
node experiments/tierdown/analyze.mjs fullsystem --prereg research/tierdown-20261021/PREREG-TIERDOWN.json --leverage $D/leverage.json \
  --eval $D/eval-H-v2.json --runs $R --out $D/full-system.json
node experiments/tierdown/analyze.mjs check --prereg research/tierdown-20261021/PREREG-TIERDOWN.json --inject $D/inject-C.json,$D/inject-H.json \
  --classes $D/classes-C.json > $D/leverage-check.json
node experiments/tierdown/readers.mjs --answers $D/answers-C.jsonl,$D/answers-H.jsonl --leverage $D/leverage.json --runs $R --out $D/readers-prose-events.json
node experiments/tierdown/truth.mjs --answers $D/answers-C.jsonl,$D/answers-H.jsonl,$D/answers-C-rule.jsonl,$D/answers-H-rule.jsonl \
  --inject $D/inject-C.json,$D/inject-H.json --leverage $D/leverage.json --runs $R --out $D/truth-date-order.json
```

Data ([data/](data/)): `leverage.json`/`.md` (screen), `classes-C.json`, `answers-{C,H}{,-rule}.jsonl` (+ `.runs.jsonl`
ledgers), `inject-C.json`, `select-C.json` (frozen), `inject-H.json`, `inject-H-provisional.json`, `eval-H.json`,
`leverage-check.json`, `buildmemo.json`, `model-failures.json`, `leafdiff-{C,H}.txt`. Added by the review:
`answers-C.runs.reconstructed.jsonl`, `inject-H-v2.json`, `eval-H-v2.json`, `full-system.json`, `readers-prose-events.json`,
`truth-date-order.json`.
