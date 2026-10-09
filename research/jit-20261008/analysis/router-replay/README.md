# V-aware router replay (BLOCKER-SYNTHESIS row 29; dossier 6 B16-E1 / X16-1; HANDOFF §5.9; FG P3(d))

*Dev diagnostic. $0: no model calls. `experiments/jit/router.mjs` is imported read-only, and its `decide()` is v0. The
per-task rows of the dev streams are lost, so this replays arm **totals** only, K = 1, at 24 tasks.*

## 1. Question and rule

**Question (FG P3(d)).** Does any routing policy beat both "agent every time" and a fixed JIT arm? If none does, park the
router wiring (HANDOFF §5.9).

**Dossier 6's rule (X16-1).**
- **Kill:** v1's regret is at least v0's at V = 1 on both families.
- **Falsifier:** the best fixed arm beats v1 on every family at every V. Then routing adds nothing at a 24-task horizon.

## 2. Method (`router-replay.mjs`)

**The world model, built from committed totals.**
- A mode is an agent arm or a JIT arm. It succeeds on a task with its committed per-segment rate (records: d3 for tasks
  1–16, d4 for 17–24; kinetics: one rate).
- Outcomes are independent across modes and tasks. No cross-arm correlation survives.
- An agent mode costs its arm's mean $/task.
- A JIT mode costs a one-time compile `b` (the arm's compile spend) plus `r` per task, where r = (total − b)/tasks.
- So a fixed arm reproduces its committed totals exactly, in expectation.

**Data.**
- Records: DEV-NOTES D10/D12 and FG §0.1.
  - H/H's rates come from its 19 finished tasks, with cost scaled to 24 ($4.09, as synthesis row 8). Its compile
    spend is not committed, so b = $2.00 is assumed. H/H is dominated at every V either way.
  - Static C0's $1.21 **excludes the cost of building it**. It is a fixed arm only.
- Kinetics: FG §0.1 at 04:22, with JIT arms unfinished (H/H 12 tasks, O/H 17, S/H 8).
  - Their rates come from the tasks done. b is the compile spend so far, a lower bound.
  - There is no Opus agent arm, so no policy can build O/H here. It stays a fixed arm.

**Policies.**
- **Fixed arms:** every arm, at its committed totals.
- **v0:** `router.decide()` per task, for each interpreter m ∈ {H, S, O} and slider s ∈ {0, 0.5, 1}.
  - It sees the arm's mean agent cost and uses its own defaults: compile $3, compiled run $0.05.
  - A "compile" switches to the JIT m/H mode for the remaining tasks and pays that arm's real b.
  - Payback is 1 + 2s, so the threshold is $6 at s = 0.5 (the synthesis erratum; dossier 6 said $4.5).
- **v1:**
  - Beta posteriors per mode.
  - Mode choice by V·θ − cost: Thompson sampling with feedback, posterior means without.
  - A JIT mode becomes buyable after 3 traces from its interpreter. The compile decision is deterministic
    learning-augmented ski rental (Purohit et al. 2018):
    - per-task advantage Δ = (V·mean_J − r) − (best current V·mean − c);
    - break-even B = b/Δ;
    - prediction y = tasks remaining;
    - buy at rental day ⌈λB⌉ if y ≥ B, else at day ⌈B/λ⌉.
  - Grid: λ ∈ {0.25, 0.5, 1} × prior of an unbought JIT mode ∈ {inherit, uniform} × feedback ∈ {oracle, none}.
    - inherit: Beta(2μ, 2(1−μ)), with μ the interpreter's posterior mean. uniform: Beta(1,1).
    - oracle: free, unbiased per-task labels on the chosen mode. This is the most favourable case for v1; the system view
      has no such labels.
    - none: no labels at all.
  - V ∈ {0.1, 1, 10}: the dollar value of one verified success (the slider, per THESIS).
- **Clairvoyant one-switch bound:** knows every rate and uses one mode until task w, then another. No router can beat it
  in this world model, so it measures how much routing could ever gain.

**Runs.** 4,000 resamples per v1 cell, with a deterministic seed per cell.

```
node research/jit-20261008/analysis/router-replay/router-replay.mjs    # router-replay.{json,md}, ~15 s
```

## 3. Results

Net value = V × passes − $. Regret = (comparator's net value) − (v1's expected net value), so positive means v1 is
worse. Ranges span the 6 v1 cells (λ × prior) for each feedback setting.

### Records

| V | best agent-every-time | best fixed JIT | best fixed overall | best v0 config (hindsight) | clairvoyant bound | v1, oracle labels | v1, no labels |
|---|---|---|---|---|---|---|---|
| 0.1 | Haiku agent −0.96 | H/H −2.76 | static C0 +0.39 (build excluded) | v0 H (any s) −0.96 | −0.96 (Haiku agent) | −0.96 … −0.95 | −0.96 … −0.95 |
| 1 | Haiku agent 12.54 | **S/H 13.01** | static C0 14.79 (build excluded) | v0 H (any s) 12.54 | 13.01 (Haiku to task 16, then Sonnet agent; ties S/H) | 10.55 … 10.96 | 12.53 … 12.60 |
| 10 | **Opus agent 226.46** | S/H 211.01 | Opus agent | v0 S s=0 199.52 | 228.62 (Opus to task 16, then Sonnet agent) | 183.80 … 196.82 | 147.22 … 148.15 |

| V | v1 regret vs best agent (oracle / none) | vs best fixed JIT | vs v0 (best config) | P(buys a compile) |
|---|---|---|---|---|
| 0.1 | ≈ 0 / ≈ 0 | −1.8 / −1.8 (v1 better: the best JIT is poor at V = 0.1) | ≈ 0 / ≈ 0 | 0 / 0 |
| 1 | +1.6 … +2.0 / ≈ 0 (−0.06 … +0.01) | +2.1 … +2.5 / +0.4 … +0.5 | +1.6 … +2.0 / ≈ 0 | 0.05–0.22 / 0 |
| 10 | +29.6 … +42.7 / +78 … +79 | +14.2 … +27.2 / +63 … +64 | +2.7 … +15.7 / +51 … +52 | 0.00–0.98 / 0 |

**v0's decisions on records**, per slider s = 0 / 0.5 / 1:

| interpreter | decision | net value at V = 1 | net value at V = 10 |
|---|---|---|---|
| Haiku | interprets every task at every s: 21–22 × $0.053 never reaches 1–3 × $3 | 12.54 | 147.54 |
| Sonnet | compiles at task 2 at s = 0; **interprets every task at s = 0.5 and 1** | 11.64 / 5.95 / 5.95 | 199.52 / 122.95 / 122.95 |
| Opus | compiles at tasks 2 / 4 / 5 | 10.30 / 10.12 / 10.04 | 176.80 / 181.12 / 183.29 |

At the default slider (0.5), v0 with a Sonnet interpreter picks the Sonnet agent: 13/24, the worst records arm at V ≥ 1.
That is dossier 6's finding, now with the corrected $6 threshold.

### Kinetics (JIT arms extrapolated from 8–17 tasks)

| V | best agent | best fixed JIT | v0 best | clairvoyant (O/H unreachable) | v1 oracle | v1 none |
|---|---|---|---|---|---|---|
| 0.1 | Haiku agent −0.40 | H/H −12.95 | v0 H −0.40 | −0.40 | −0.41 … −0.40 | −0.40 |
| 1 | Haiku agent 14.90 | H/H 1.45 | v0 H 14.90 | 14.90 | 13.71 … 13.77 | 14.88 … 14.96 |
| 10 | Haiku agent 167.90 | **O/H 191.37** (17 tasks, scaled) | v0 H 167.90 | 167.90 | 165.04 … 165.98 | 167.31 … 168.24 |

v1 never buys a kinetics compile: b is $9.6–13.9. v0 compiles only with Sonnet at s = 0, giving −6.68 at V = 1.

"P(v1 beats the best agent and the best JIT)" in `router-replay.md` compares v1's simulated streams with the committed
single realisations. Values near 0.4 at V = 0.1 and 1 are noise around a tie. They are not wins.

## 4. Verdicts

1. **No policy beats both "agent every time" and the best fixed JIT arm in expectation, at any V, on either family.**
   This covers v0 at every slider and v1 at every λ, prior and label setting. Per FG P3(d): **park router wiring**
   (HANDOFF §5.9).
   - **Dossier 6's kill rule is met.** At V = 1, v1's regret is not below v0's on either family. Without labels they tie
     within Monte Carlo noise, because both are the Haiku agent. With labels v1 is worse by 1.1–2.0.
   - **Its falsifier holds wherever the comparison is not a tie:** records at V = 1 and 10 (with or without C0) and
     kinetics at V = 10. Elsewhere v1 ties the best fixed arm, the Haiku agent.
2. **There is almost nothing to route for at 24 tasks.**
   - The clairvoyant one-switch bound beats the best fixed arm only on records at V = 10, by $2.16 (about 0.2 of a
     success). It does so by knowing that drift arrives at task 17 and moving to the cheaper Sonnet agent there.
   - At V = 1 the bound equals S/H (13.01). At V = 0.1 it is the Haiku agent.
   - Static C0 tops V = 0.1 and V = 1 only because its build cost is not counted.
3. **With labels, v1 is hurt by exploration.**
   - With free oracle labels, Thompson exploration across 3 agent modes costs 1.6–2.0 net at V = 1, about 2 successes'
     worth.
   - At V = 10 it costs 30–43 against the Opus agent.
   - With the inherit prior, v1 at V = 10 buys an O/H compile in 94–98% of streams (the uniform-prior cells buy in
     0.3–2%). Checked on one cell, λ = 0.5: every purchase was O/H. Opus's posterior looks excellent, so a compiled
     Opus distillate inherits that prior. O/H then delivers its real 18/24 quality, and the inherit cells end 11–13 below
     the uniform ones.
   - 24 tasks is too short a horizon to pay for learning which mode is best. This is the poor-estimator regime of
     dossier 6.
4. **Without labels, v1 is V-blind.**
   - All posteriors stay at 0.5, so v1 always picks the cheapest mode (the Haiku agent). It ties at V ≤ 1 and loses
     ~78 at V = 10.
   - A V-aware router needs quality evidence. In the system view that means random holdouts or reverse shadows (dossier
     6 X16-2; PREREG's ε = 0.25 floor). Those are not free, and this replay prices them at $0.
5. **What does decide the outcome is V itself.** V = 0.1 → the cheapest arm; V = 1 → S/H; V = 10 → the Opus agent.
   - A static lookup of V to arm, chosen once per family, matches the best fixed arm by construction.
   - That lookup uses dev hindsight. It is a statement about where the decision lives, not a proposal.
   - Routing could matter on long streams (hundreds of tasks), where exploration amortises. That is not testable here.

## 5. Limits

- **Arm totals only.** Per-task rows are lost, so outcomes are modelled as independent Bernoulli draws at segment rates.
  Real arms are correlated: the same hard tasks fail across arms (D8's common mode). That would shrink v1's exploration
  cost and the clairvoyant headroom alike. The per-task replay waits for R0's persisted rows.
- **K = 1, dev seeds, one lineage per JIT arm.** Compile variance dominates JIT results (D12), so S/H's 22/24 is one
  lineage's draw.
- Kinetics JIT arms are extrapolated from 8–17 tasks. b is a lower bound (later recompiles would add).
- H/H's b is assumed ($2.00). C0's build cost is excluded.
- v0 is credited with the JIT arm's committed rates from its switch point. In reality its compile would come from
  different traces, after a different warmup.
- v1's "oracle" labels are free and unbiased: an upper bound on what any verification channel could buy.
- No quota model. A router that also priced quota (dossier 9 λ(t)) would only add cost to exploration.
