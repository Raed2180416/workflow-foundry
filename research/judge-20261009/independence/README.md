# Jev independence check (BLOCKER-SYNTHESIS row 18)

*2026-10-09 · Haiku `claude-haiku-5-5` and Sonnet `claude-sonnet-5-5` through `experiments/lib/models.mjs` `createModelPort` (the
owner's logged-in account, `claude -p`) · list-price cost **$0.0367 + $0.6490 = $0.686** of the $3.00 cap · 0 faults, 0 retries.*

**Question.** Are stock Jev's errors independent of Claude's? §2.4 of the synthesis requires an answer before Jev is used as a
non-Claude voter. Data: J1 dev-select, generator labels, Jev rows from `research/judge-20261009/data/jev/J1/` (jev-1.13.0, K = 1).

## Answer

**No. On this subset Jev's errors are strongly associated with Claude's, and the check does not support using Jev as an independent
(non-Claude) voter.** Jev–Claude error association is a little weaker than Haiku–Sonnet, so Jev is not a copy of a Claude, but
most of the shared errors are the same wrong option chosen by all three readers, which points to items the label or option text
decides in a way the state does not carry. This data cannot tell lineage from that item-level cause (see Limits).

| | Jev × Haiku | Jev × Sonnet | Haiku × Sonnet (reference) |
|---|---|---|---|
| n | 120 | 120 | 120 |
| 2×2: both wrong / Jev only / model only / both right | 40 / 25 / 2 / 53 | 35 / 30 / 3 / 52 | 33 / 9 / 5 / 73 |
| odds ratio [95% CI] | 42.4 [9.5, 189.6] | 20.2 [5.7, 71.4] | 53.5 |
| Yule's Q | 0.954 | 0.906 | 0.963 |
| phi, sample (inflated by the error oversampling) | 0.605 | 0.518 | 0.740 |
| **phi, design-weighted to the 1,181-item population** [stratified bootstrap 95%] | **0.612** [0.505, 0.713] | **0.585** [0.478, 0.677] | 0.821 [0.711, 0.913] |
| Fisher exact p (two-sided) | < 0.001 | < 0.001 | 3.6e-16 |
| Mantel–Haenszel OR over 16 ports [95% CI] (difficulty-by-port adjusted) | 32.1 [8.1, 127.0] | 24.4 [6.3, 94.7] | 29.4 [8.0, 107.8] |
| **P(model wrong \| Jev wrong)**, sample / weighted | 0.615 / 0.525 | 0.538 / 0.466 | – |
| **P(model wrong \| Jev right)**, sample / weighted | 0.036 / 0.023 | 0.055 / 0.016 | – |
| P(model wrong), population-weighted (= the independence benchmark) | 0.136 | 0.118 | – |
| P(both wrong), weighted, against the product of the marginals | 0.119 vs 0.031 | 0.105 vs 0.027 | – |
| when both wrong: same wrong option (chance level, uniform over the other options) | 36 of 40 (12.7) | 32 of 35 (11.4) | – |

Under independence, P(Haiku wrong | Jev wrong) would equal P(Haiku wrong) = 0.136 on the population; it is 0.525 (weighted), 3.9 times
that. The same for Sonnet: 0.466 against 0.118. Where Jev is right the Claudes are almost always right (2 and 3 errors of 55).

Accuracy on the subset (by construction Jev is 45.8% here: 65 of the 120 items are Jev errors): Haiku 0.650, Sonnet 0.683. Re-weighted
to the 1,181 items: Jev 0.774, Haiku 0.864, Sonnet 0.882 (Jev's weighted value reproduces the J1 figure 914/1181 = 0.774).

### Where the dependence sits

- **Negative-result ports** (interactive X6, runbook X4, kinetics X3; 72 items): P(Haiku wrong | Jev wrong) = 0.791 against 0.069 when Jev is right
  (OR 51); Sonnet 0.674 against 0.103 (OR 18.0). Per port, Haiku wrong on Jev-wrong items: X6 13/14, runbook X4 11/12, kinetics X3 10/17.
- **Other 13 ports** (48 items, 4 per port): P(Haiku wrong | Jev wrong) = 0.273 (6 of 22), against 0 of 26 when Jev is right (OR 20.9, Fisher p 0.006); Sonnet the same counts.
  Small n; 15 of the 22 Jev-only errors (neither Claude wrong) sit here.
- **Three-way consensus on one wrong option**: 28 of 120 items (10 X6, 9 kinetics X3, 5 runbook X4, 4 on other ports) where Jev, Haiku and
  Sonnet all choose the same non-label option.
- **Idiosyncratic Jev errors exist**: of Jev's 65 errors, 22 (34%) have both Claudes right (7 on the three negative-result ports, 15 elsewhere).
  Sensitivity, dropping the 28 consensus items (a post hoc bound that removes the clearest shared errors): Jev × Haiku OR 12.7 [2.6, 61.2],
  Fisher p 0.0002 (P(H wrong | J wrong) 0.32 against 0.04); Jev × Sonnet OR 4.0 [0.97, 16.8], p 0.083 (0.19 against 0.06).
  So the association with Haiku survives; with Sonnet it is no longer clearly different from none.
- **As a tiebreak voter**: of the 33 items both Claudes got wrong, Jev was right on 1.

### What the data says about the cause (impressions from reading nine both-wrong items, not a measured result)

The shared errors are mostly items where the generator label depends on something the displayed state does not decide:
runbook X4 `out_of_scope` for "pager test at 18:00 UTC went through fine" (an on-call note with no mention of another study or system);
interactive X6 `designed` / `duplicate` read as `lead` when the report itself names a concrete symptom; kinetics X3 labels read one step along the scale
(`confirms` to `changes`, `proposes` to `mentions`, `mentions` to `changes`) where the label rests on thread context. All three readers pick the same wrong option in 90% of both-wrong cases
(against 11–13 expected by chance), which is what option-boundary or label defects would produce, whatever each model was trained on. This is
the reading that J1's own negative results §8 already proposed (option-semantics mismatch).

## Verdict for §2.4

- **Required before Jev is a non-Claude voter: not met.** The test as framed ("are Jev's errors independent of Claude's?") is answered no for
  Haiku and Sonnet on this dev subset. Treat Jev as correlated with the Claude tier on ports of the X6/X4/X3 kind, and as unverified elsewhere.
- Do not count a Jev–Claude agreement as two votes. On the three negative-result ports a Jev vote added to a Claude vote carries almost no extra information
  (Jev errs where Claude errs, and they pick the same wrong option).
- "Jev is not a Claude" is not refuted: about a third of its errors are its own, and its association with a Claude (phi 0.59–0.61 weighted) is lower
  than Haiku with Sonnet (0.82; bootstrap intervals touch at 0.71). That is evidence of partial independence, not of independence.
- To settle lineage against item difficulty, this needs a reader of different lineage on the same items (an open-weights model, or Kev 0.8B on the GPU
  at $0) and items whose label is verified from the state rather than the generator; both are outside this check.

## Limits

1. **Dev data, in-family.** Synthetic bed text, generator labels. A label that the state does not decide makes every reader wrong together, so the
   association is partly or wholly item-level, not lineage-level. The Haiku–Sonnet reference (phi 0.82) has the same confound, so it is no null.
2. **Oversampled errors.** 65 of the 120 items are Jev errors (population rate 22.6%). The odds ratio, Yule's Q and the conditional rates are unaffected by
   sampling on Jev's correctness within a port; the sample phi and sample accuracies are, so the weighted figures are given and the weighted phi is the headline.
   The three negative-result ports are 60% of the sample (population 28%); weights are stratum size / quota.
3. **K = 1** per model and item. Haiku and Sonnet answers are verbalised choices at temperature default (no sampling control); Jev's rows are one read at a
   2-decimal grid (the re-read moves by up to 0.07 and flips no argmax). Single reads add noise to both cells, which biases the association towards zero.
4. **n = 120.** 4 items per non-negative port, 2 for K2 and K3 (no Jev errors exist there). Per-port numbers other than the three large ports are anecdotal.
   Items are 120 distinct records, but the form/world clustering of the kinetics sidecar and the unverified interactive/runbook sidecars were not used; intervals for the
   X-ports are probably too narrow (J1 §4).
5. Two Claude models. Opus was not read. $2.31 of the $3.00 cap is unspent; an Opus read of the 120 items would fit inside it (Sonnet cost $0.65; an Opus price of $1–3 is an estimate, not measured).
6. The Claude prompt is the project's standard judgment prompt (options + state + question, as in `haiku-j1.mjs`); Jev receives the typed question natively through its API.
   Neither sees the label, and Jev's answer is not shown to the Claudes.

## Design and method

- **Sampling (`sample.mjs`, seed `kev-independence-v1-20261009`, fixed before any Claude read).** Population: the 1,181 Jev rows (interactive 562, kinetics 461, runbook 158).
  Port = group + question id (`Q1~east/north/south/west` merged into Q1). Stratum = port × Jev correct/wrong. Quotas: interactive X6 14 Jev-wrong + 10 Jev-right,
  runbook X4 12 + 8, kinetics X3 17 + 11; every other port 2 + 2 (kinetics K2 and K3 have no Jev error: 2 Jev-right each). Within a stratum: sha256 order of
  `seed|group|record|question`, first quota. Result: 120 items (65 Jev-wrong, 55 Jev-right), `data/sample.jsonl`, plan in `data/sample-plan.json`. Weight = stratum size / quota.
- **Reads (`experiments/kev-data/out/j1/independence-j1.mjs`).** As `haiku-j1.mjs`: `JudgmentPort` engine `model`, decoding `{maxTokens 128, reasoning 'none'}`, request = typed choice question
  (instructions, options, `option: criterion` lines) + the state; answer = one option; the label is never sent (journal requests checked). Concurrency 2. Hard cap on summed `costUsd` over all
  models. A failed call would be logged as a fault and retried after backoff (2…32 s, 5 attempts); none occurred. Haiku read all 120 items, then Sonnet read all 120 as well (the brief's ≈40
  Jev-or-Haiku-wrong items were a subset; reading all 120 keeps the Sonnet 2×2 free of selection on the outcome and cost $0.65).
- **Analysis (`analyze.mjs`).** 2×2, phi, Yule's Q, odds ratio with Wald CI (0.5 added if a cell is 0), Fisher exact; conditional rates; Mantel–Haenszel OR (Robins–Breslow–Greenland CI, CMH test)
  across ports; design-weighted phi with a stratified bootstrap (B = 4000, fixed LCG seed); Haiku×Sonnet reference; three-way consensus and a sensitivity run without it.

## Files

| file | what |
|---|---|
| `sample.mjs`, `data/sample.jsonl`, `data/sample-plan.json` | the sampling rule, the 120 items, the quotas taken |
| `../../../experiments/kev-data/out/j1/independence-j1.mjs` | the reader (one Claude model per run) |
| `data/rows-haiku.jsonl`, `data/rows-sonnet.jsonl` | **raw rows (irreproducible model outputs)**: choice, probabilities, confidence, cost, model id |
| `data/journal-model-calls-{haiku,sonnet}.jsonl` | journal export: every request and response |
| `analyze.mjs`, `out/independence-analysis.json`, `out/independence-tables.md` | statistics, all tables (incl. per-port 2×2 for both models) |

Reproduce the statistics with `node --max-old-space-size=1024 research/judge-20261009/independence/analyze.mjs` ($0). Re-running the reads needs the logged-in `claude` CLI, the
three dev-select inputs under `/var/tmp/foundry-work/kev/j1/inputs`, and spends usage again; the rows above are the record.
