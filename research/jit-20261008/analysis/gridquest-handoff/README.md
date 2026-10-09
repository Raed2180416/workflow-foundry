# gridquest handoff headroom (BLOCKER-SYNTHESIS §2.1 row 32, experiment B13-E1 / dossier 8 E13-1)

$0, no model call of any kind, deterministic. **No LLM has ever run on gridquest. Every "agent" below is a code
stand-in written by the bed's authors or by me; none of these numbers is a measurement of an LLM agent.**
`beds/sealed/` was never read; `beds/` and `experiments/` were not edited (this directory only imports bed modules).

## Question and verdict

Does hold-and-resume in the same environment beat a restart? Kill rule (row 32 / dossier 8): kill if the best
hold-and-resume protocol is within 3 points of P2.

**Verdict: the kill rule does not fire on the pre-declared set (30 dev seeds 100-129, d3/d4/d5).** With the
strongest resumer (ii), best(P3, P4) minus P2 is +26.7 pts at d3, +6.7 at d4, +16.7 at d5 (pooled +16.7, 95% CI
[8.9, 24.4]). Every per-level gap exceeds 3 pts, and so does the pooled gap.

Read it with three qualifiers, all measured below:

1. **The size of the gap is unstable across seed sets.** On a replicate set (dev seeds 130-159, run after the primary
   and not part of the pre-declared analysis) the pooled gap shrinks to +5.6 [0.0, 11.1]; on the bed's own tuning
   seeds (0-29) it is +4.4 [0.0, 10.0]. All three sets have a positive point estimate above 3 pts, but in two of
   them the CI reaches 0, so the kill verdict is "not killed on the declared set, borderline on the others".
   Pooling the two fresh sets (180 tasks): P4 - P2 = +11.1 [6.7, 16.1]; P3 - P2 = +8.3 [2.8, 13.9].
2. **Where the headroom comes from.** It is almost entirely the ledger, i.e. the controller prefix that P2 has to pay
   for again (P2 loses 18/90 levels only because `prefix + explorer run > B`). P1 (fresh env, no sunk cost, illegal under
   the ledger) is 100% by construction with resumer (ii), above P3/P4. So hold-and-resume beats the *legal* restart (P2)
   and loses to the *illegal* free restart (P1), which is the dossier's falsifier question: the ledger, not state
   preservation, is what binds. State preservation adds little beyond it (see P3-lossy / P3-amn rows below and the P4
   effect, which is a stranding effect on 2/90 tasks).
3. **With the realistic resumer the sign flips.** Resumer (i), `templateAwareAgent` (white-box regex, amnesiac), is
   *worse* when resumed in the held state than when restarted in the same env: P3 - P2 = -6.7 pts [-14.4, +1.1]
   pooled. The amnesiac regex agent cannot reconstruct inventory and door state from the held room, so the held
   state is a liability unless the resumer receives the memory. The positive headroom exists only for a resumer that
   gets its memory handed over (ii, full mem). That is the finding that would transfer to an LLM, if anything does
   (and it may not; see caveats).

## What was run

- Task set (declared before running): gridquest `dev` split, **seeds 100..129** (30 seeds, all < 200), difficulties
  **3, 4, 5** = 90 tasks. 100-129 was chosen because the bed's tests and README tables use seeds 0-29, the seeds
  `regexAgentV2`/`templateAwareAgent` were tuned on. Supplementary replicates: dev seeds 130-159 and dev seeds 0-29
  (same code, run after the primary; reported separately, not mixed into the headline).
- One "level" = one task at one difficulty. "Levels completed" = tasks passed (oracle `pass`, `bed.oracle` on the
  record of the final env), out of 30 per difficulty (90 pooled).
- Controller stand-in (all protocols): `regexAgentV2` from `beds/gridquest/diagnostics.mjs`, honest code-only
  perception (README: dev 1/30 at d3, 0/30 at d4, 0/30 at d5 on seeds 0-29; `verify.mjs` reproduces this exactly and
  also reproduces `templateAwareAgent` 13/4/9).
- Resumer stand-ins (dossier E13-1):
  - **(ii) explorer-from-current-state** (primary, oracle-side upper bound): `solver.mjs` `explore`/`navigate`
    re-implemented in `lib.mjs` as `exploreFrom(model, state, mem, maxSteps)` so it can start from any abstract state
    with an explicit memory. From `m.init` with empty memory it reproduces `solver.explore` action-for-action on all 180
    task instances checked (`verify.mjs`). It has perfect perception of the current room and is certified to win
    from scratch within budget, so with a full budget it is 100% on every task by construction.
  - **(i) `templateAwareAgent`** (white-box regex agent, amnesiac, env-driven): run through an env wrapper whose
    `reset()` is a no-op when resuming a held state (so it cannot wipe the hold) and a real reset under P1/P2.

## Protocol definitions (my reading of dossier 8)

Dossier 8 E13-1 defines P0-P4 for *mid-episode* fallback. The task prompt's "typical shape" (P0 restart, P1 full-state
resume, P2 summary, ...) is different. I implemented the **dossier's** definitions, since the prompt says "exactly as
dossier 8 defines them". Ledger = the bed's lifetime action ledger (default B, never refunded by `reset()`/`restore()`).

| protocol | dossier text | implementation here |
|---|---|---|
| P0 | no fallback | the controller alone in one env with the default ledger. |
| P1 | whole-task restart in a fresh env (SPEC semantics, illegal under the ledger; counterfactual) | after the handoff point, a **new** `createEnv` with its own full ledger B; resumer starts from scratch. Reported steps include the controller prefix. |
| P2 | restart in the same env with the residual ledger | `env.reset()` of the same env: game rewinds, ledger keeps the `prefix` actions already spent; resumer gets the residual B - prefix. Answer = record of the post-reset branch. |
| P3 | hold-and-resume at the first refuted expectation (snapshot + `mem` handed over) | the env is held at the state after the refuting step; resumer continues in the same env (same ledger, no reset) with `mem` handed over. For (ii), `mem` = {rooms visited, switches toggled with counts, decoys taken / fakes examined}, taken from ground truth of what the controller did (a perfect-memory upper bound). For (i), nothing can be handed over (it is a closed function), so it is snapshot-only. |
| P4 | P3 + nonblocking permissive before one-way or coupled actions | the earlier of (first refuted expectation, a permissive veto). Veto = hold *before* executing a `go` through an outgoing one-way edge or a `toggle` of a coupled switch. **P4 (oracle permissive):** veto iff, on the true abstract model, the treasure would no longer be reachable after the action. **P4c (conservative):** veto every first one-way/coupled action, no reachability proof. |

Underspecified points and my readings:

- **"First refuted expectation"** needs a controller with expectations; `regexAgentV2` has none exposed. I used the
  code-observable one: each action the controller issues is expected to succeed, so the first step whose outcome
  is `blocked`, `failed` or `invalid` is a refutation. The refuting action is charged, then the hold happens. If the
  controller halts with no refutation, it hands off when it halts; if it wins before any refutation, nothing is handed
  off (all protocols = P0). Note this is fairly early (median 8 steps in, 5-17% of the budget): the controller
  probes walls, so it trips almost at once. The handoff-time sweep below is the sensitivity analysis for that choice.
- **"Belief map" in the permissive**: the controller's real belief map is internal and not extractable, so the oracle
  permissive uses the true model's reachability (upper bound on the permissive's power); P4c is the no-knowledge
  lower bound.
- **Coupled action** = toggling a switch with a `coupled` mechanism target (`world.mjs`); **one-way** = leaving
  through an outgoing `K_OUT` edge. Both are classified from the true model.
- **"Deopt lead time"** (dossier metric): `last recoverable prefix - handoff prefix`, with "recoverable" = treasure
  reachable in the true abstract graph. In 88/90 tasks the controller never strands itself, so the lead time is just
  the number of controller steps remaining and carries no information (table below). Reported for completeness only.
- Variants beyond the dossier, to separate ledger effects from state effects: **P3-lossy** (resumer (ii) gets only
  the visited-room set) and **P3-amn** (resumer (ii) gets the snapshot only).
- The dossier's kill rule says "at every level" and the prompt says "best hold-and-resume protocol". I report both:
  per-level and pooled, max(P3, P4) vs P2, resumer (ii) as the dossier specifies. With 30 tasks per level one task
  is 3.3 pts, so "within 3 pts" per level means a difference of zero tasks.

## Commands

```
cd /home/raed/projects/workflow-foundry/research/jit-20261008/analysis/gridquest-handoff
node --max-old-space-size=1024 verify.mjs                                   # stand-in checks (~5 s)
node --max-old-space-size=1024 run.mjs                                      # primary: seeds 100..129 -> out/rows.json (~10 s)
node --max-old-space-size=1024 analyze.mjs                                  # -> out/tables.md, out/summary.json
node --max-old-space-size=1024 run.mjs --seeds 130..159 --out $PWD/out/rows-b130-159.json
node --max-old-space-size=1024 analyze.mjs out/rows-b130-159.json -b130-159
node --max-old-space-size=1024 run.mjs --seeds 0..29 --out $PWD/out/rows-c0-29.json
node --max-old-space-size=1024 analyze.mjs out/rows-c0-29.json -c0-29
node --max-old-space-size=1024 combine.mjs                                  # -> out/combined.md
```

Files: `lib.mjs` (abstract state, reachability, `exploreFrom`, bootstrap), `protocols.mjs` (controller trace,
triggers, P1-P4 runners), `run.mjs`, `analyze.mjs`, `combine.mjs`, `verify.mjs`, `out/` (raw per-task rows, tables).
Deterministic: reruns give identical `rows.json` apart from the `ms` wall-time fields and `meta.wallSeconds`.
Whole run is ~10 s and well under 200 MB; no GPU, no network, no model calls.

## Results (primary set: dev seeds 100-129, 30 per difficulty)

Levels completed / 30 (pooled /90) with pass rate and 95% percentile bootstrap CI over tasks (10 000 resamples,
fixed seed). Percentile bootstrap collapses to a point at 0% and 100%: read 30/30 as "lower bound about 90.5%" and
90/90 as "about 96.7%" (one-sided 95%, rule of three), not as certainty.

### Resumer (ii), explorer-from-current-state (the dossier's kill-rule resumer)

| protocol | d3 | d4 | d5 | d3-d5 pooled |
|---|---|---|---|---|
| P0 no fallback (controller only) | 2/30 = 6.7% [0.0, 16.7] | 0/30 = 0.0% [0.0, 0.0] | 0/30 = 0.0% [0.0, 0.0] | 2/90 = 2.2% [0.0, 5.6] |
| P1 fresh-env restart (illegal counterfactual) | 30/30 = 100% | 30/30 = 100% | 30/30 = 100% | 90/90 = 100% |
| **P2 restart, same env, residual ledger** | 22/30 = 73.3% [56.7, 86.7] | 26/30 = 86.7% [73.3, 96.7] | 24/30 = 80.0% [66.7, 93.3] | 72/90 = 80.0% [71.1, 87.8] |
| **P3 hold-and-resume** | 30/30 = 100% | 28/30 = 93.3% [83.3, 100.0] | 27/30 = 90.0% [76.7, 100.0] | 85/90 = 94.4% [88.9, 98.9] |
| **P4 = P3 + oracle permissive** | 30/30 = 100% | 28/30 = 93.3% [83.3, 100.0] | 29/30 = 96.7% [90.0, 100.0] | 87/90 = 96.7% [92.2, 100.0] |
| P4c = P3 + conservative permissive | 30/30 = 100% | 29/30 = 96.7% [90.0, 100.0] | 29/30 = 96.7% [90.0, 100.0] | 88/90 = 97.8% [94.4, 100.0] |
| P3-lossy (mem = visited rooms) | 28/30 = 93.3% [83.3, 100.0] | 25/30 = 83.3% [70.0, 96.7] | 26/30 = 86.7% [73.3, 96.7] | 79/90 = 87.8% [81.1, 94.4] |
| P3-amn (snapshot only) | 25/30 = 83.3% [70.0, 96.7] | 25/30 = 83.3% [70.0, 96.7] | 24/30 = 80.0% [63.3, 93.3] | 74/90 = 82.2% [74.4, 90.0] |

Paired differences against P2 (same tasks; +wins/-losses in tasks):

| contrast | d3 | d4 | d5 | pooled |
|---|---|---|---|---|
| P3 - P2 | +26.7 [13.3, 43.3] (+8/-0) | +6.7 [0.0, 16.7] (+2/-0) | +10.0 [-6.7, 26.7] (+5/-2) | +14.4 [6.7, 23.3] (+15/-2) |
| P4 - P2 | +26.7 [13.3, 43.3] (+8/-0) | +6.7 [0.0, 16.7] (+2/-0) | +16.7 [3.3, 30.0] (+5/-0) | +16.7 [8.9, 24.4] (+15/-0) |
| P4c - P2 | +26.7 [13.3, 43.3] (+8/-0) | +10.0 [0.0, 23.3] (+3/-0) | +16.7 [3.3, 30.0] (+5/-0) | +17.8 [10.0, 25.6] (+16/-0) |
| P3-lossy - P2 | +20.0 [3.3, 36.7] | -3.3 [-16.7, 10.0] | +6.7 [-10.0, 23.3] | +7.8 [-2.2, 16.7] |
| P3-amn - P2 | +10.0 [-6.7, 26.7] | -3.3 [-16.7, 6.7] | +0.0 [-13.3, 13.3] | +2.2 [-5.6, 10.0] |
| P1 - P2 | +26.7 [13.3, 43.3] | +13.3 [3.3, 26.7] | +20.0 [6.7, 33.3] | +20.0 [12.2, 28.9] |

Cost per task, resumer (ii), pooled d3-d5 (steps = every action executed in any env, controller prefix included;
failures = blocked/failed/invalid actions; wall = mean ms per task for that protocol's run, noisy, millisecond-scale; the
stand-ins are not a speed test):

| protocol | mean steps | mean steps (passes only) | mean failures | mean wall ms |
|---|---|---|---|---|
| P0 | 27.7 | 39.0 | 10.5 | 2.82 |
| P1 | 77.8 | 77.8 | 1.0 | 1.25 |
| P2 | 75.5 | 74.4 | 1.0 | 1.13 |
| P3 | 65.7 | 66.1 | 1.0 | 1.01 |
| P4 | 67.7 | 67.2 | 1.0 | 1.06 |
| P4c | 67.3 | 67.2 | 0.8 | 1.05 |

Per-difficulty cost rows are in `out/tables.md`. Hold-and-resume saves roughly 10 steps per task over P2 (the
controller's wasted prefix is not paid twice), which is the whole mechanism: P2's 18 failures are all tasks where
`prefix + full explorer run` exceeded B (for example d3 seed 109: prefix 42 of B = 75).

### Resumer (i), `templateAwareAgent` (amnesiac, white-box regex, realistic perception)

| protocol | d3 | d4 | d5 | d3-d5 pooled |
|---|---|---|---|---|
| P1 fresh-env restart (counterfactual) | 17/30 = 56.7% [40.0, 73.3] | 7/30 = 23.3% [10.0, 40.0] | 3/30 = 10.0% [0.0, 23.3] | 27/90 = 30.0% [21.1, 40.0] |
| P2 restart, same env, residual ledger | 13/30 = 43.3% [26.7, 60.0] | 6/30 = 20.0% [6.7, 33.3] | 2/30 = 6.7% [0.0, 16.7] | 21/90 = 23.3% [14.4, 32.2] |
| P3 hold-and-resume | 12/30 = 40.0% [23.3, 56.7] | 3/30 = 10.0% [0.0, 23.3] | 0/30 = 0.0% | 15/90 = 16.7% [8.9, 24.4] |
| P4 oracle permissive | 12/30 = 40.0% | 3/30 = 10.0% | 0/30 = 0.0% | 15/90 = 16.7% [8.9, 24.4] |
| P4c conservative permissive | 11/30 = 36.7% | 6/30 = 20.0% | 0/30 = 0.0% | 17/90 = 18.9% [11.1, 27.8] |

P3 - P2 pooled: -6.7 pts [-14.4, +1.1] (+3/-9); P4c - P2: -4.4 [-11.1, +2.2]. Against this resumer the dossier's
kill rule *would* fire in spirit (hold-and-resume is not above P2 at any level), but this resumer's absolute rate is
set by its own perception (it passes only 13/4/9 of 30 from scratch on the tuning seeds), so the 0-6 task counts are
small and the CIs wide.

### Where the handoff falls (controller = `regexAgentV2`)

| group | controller wins | mean controller actions | median first refutation (step) | mean B | median handoff / B | controller strands itself | P4 earlier than refutation (conservative) | strands at handoff under P3 |
|---|---|---|---|---|---|---|---|---|
| d3 | 2/30 | 28.3 | 13 | 61.7 | 0.17 | 0/30 | 0/30 (cons. 1) | 0/30 |
| d4 | 0/30 | 31.4 | 7 | 92.8 | 0.09 | 0/30 | 0/30 (cons. 10) | 0/30 |
| d5 | 0/30 | 23.4 | 7 | 129.3 | 0.05 | 2/30 | 2/30 (cons. 6) | 2/30 |
| pooled | 2/90 | 27.7 | 8 | 94.6 | 0.09 | 2/90 | 2/90 (cons. 17) | 2/90 |

P3 and P4 differ on exactly two tasks (d5 seeds 119 and 121): the controller took a one-way or coupled action
into an unrecoverable state before its first refutation; the oracle permissive hands off in time. P3 loses
those two; P4 wins them. That is the entire P4-over-P3 effect at (ii) and the one place a "nonblocking permissive"
earned anything. At resumer (ii) the conservative permissive vetoes 17/90 tasks early without proof and loses nothing only
because resumer (ii) re-plans from the held state for free. P3's other three failures (d4 124, d4 128, d5 111) are
not strandings: the controller left the explorer in a state from which finishing exceeded the residual ledger.

### Handoff-time sweep (sensitivity to the "first refutation" choice)

Hand off after h controller actions instead (resumer (ii); pooled over d3-d5, 90 tasks):

| h | P2 | P3 | P3 - P2 [95% CI] | already stranded at h |
|---|---|---|---|---|
| 5 | 85/90 | 89/90 | +4.4 [0.0, 10.0] | 1/90 |
| 10 | 78/90 | 88/90 | +11.1 [4.4, 18.9] | 1/90 |
| 20 | 58/90 | 80/90 | +24.4 [13.3, 35.6] | 2/90 |
| 30 | 51/90 | 66/90 | +16.7 [5.6, 27.8] | 2/90 |
| 45 | 49/90 | 64/90 | +16.7 [4.4, 27.8] | 2/90 |

Headroom is monotone in how much sunk cost is already on the ledger when the handoff happens: with a very early
handoff (h = 5, about 5% of B) hold-and-resume is within 4.4 pts of P2, and the sign of the "kill" call depends on
when the controller's expectations break. The first-refutation trigger sits near h = 8, between the h = 5 and h = 10
rows. For resumer (i) the sweep shows P3 below P2 at h = 5/10/20 (-6.7, -13.3, -10.0) and indistinguishable at 30/45
(both near zero); see `out/tables.md`.

### Replicates (supplementary; not part of the pre-declared analysis)

Resumer (ii). `out/combined.md`:

| task set | n | P2 | P3 | P4 | P3 - P2 [95% CI] | P4 - P2 [95% CI] | P1 |
|---|---|---|---|---|---|---|---|
| A dev 100-129 (primary) | 90 | 80.0% | 94.4% | 96.7% | +14.4 [6.7, 23.3] | +16.7 [8.9, 24.4] | 100% |
| B dev 130-159 | 90 | 92.2% | 94.4% | 97.8% | +2.2 [-4.4, 8.9] | +5.6 [0.0, 11.1] | 100% |
| C dev 0-29 (bed-tuned seeds) | 90 | 91.1% | 93.3% | 95.6% | +2.2 [-3.3, 8.9] | +4.4 [0.0, 10.0] | 100% |
| A+B pooled | 180 | 86.1% | 94.4% | 97.2% | +8.3 [2.8, 13.9] | +11.1 [6.7, 16.1] | 100% |
| A+B+C pooled | 270 | 87.8% | 94.1% | 96.7% | +6.3 [2.2, 10.7] | +8.9 [5.6, 12.6] | 100% |

P3 and P4 are high and stable (about 93-98% in every set); what moves is P2 (80% to 92%), i.e. how often the
controller's prefix happens to be long enough to bust the residual ledger. Per-level kill checks on sets B and C:
best(P3, P4) - P2 exceeds 3 pts at d3/d4/d5 in B (+6.7, +6.7, +3.3) but at d3 and d4 of C it is +3.3, i.e. one task,
so the per-level call is on the edge once the task set changes. The honest summary is "headroom of roughly 4-17
pts depending on seeds; more than 3 pts everywhere, but not by a margin the data can resolve at n = 30 per level".

## Caveats (what a code stand-in cannot tell us about an LLM agent)

- **No LLM has run on gridquest.** Nothing here estimates how an LLM controller, or an LLM resumer, behaves. The
  controller is a 40-line regex script that fails 88/90 tasks, mostly because it probes walls; an LLM controller
  fails differently (misreads prose, loses state over a 10-27K-token episode, gets injected by in-world text).
  Where and when a real controller's "expectation" breaks is the main driver of the headroom (sweep above), and
  that is exactly what the stand-in cannot supply.
- **Resumer (ii) is an oracle-side upper bound with perfect perception.** It is certified to win from scratch, so P1 =
  100% by construction and P3/P4 inherit its competence; the only thing the experiment varies for it is the ledger,
  the memory and the stranding. A real resumer's failure is perception, which this stand-in sets to zero. Resumer (i)
  has realistic perception but is amnesiac and white-box (it imports the bed's synonym table).
- **The handed-over `mem` in P3/P4 is ground truth of what the controller did.** A real controller's memory is a
  lossy, possibly wrong LLM summary. P3-lossy and P3-amn bound that from below at resumer (ii): with only the visited
  set P3 falls to 87.8% pooled (+7.8 over P2, CI crosses 0); with snapshot only it is 82.2% (+2.2, CI crosses 0 and
  within 3 pts of P2). So the headroom depends on the quality of the hand-over, and with no memory at all the kill rule
  would fire at (ii) too.
- **The permissive's reachability check is oracle-side** (P4) or absent (P4c). A belief-map-based check, which is what
  the system would have, sits between the two; its value here is capped by 2 tasks.
- **A refuted expectation is operationalised as a non-ok environment outcome.** An LLM controller has semantic
  expectations (and may err silently with no environment refutation at all). The silent-error case is not represented.
- **Token cost, latency and quota are not modelled.** Steps are env actions, not tokens; the cost of an LLM re-reading
  an 8-27K-token episode in P2/P1 versus a hand-over summary in P3 is the real economic question and is outside this run.
- **Ledger semantics are the bed's.** P1 (fresh env) is illegal under the bed's default ledger; the harness caveat in
  the bed README applies. Results are specific to a ledger of exactly B = ceil(2.75 x optimal).
- **The three difficulty levels share one 30-seed set per level** and tasks differ by a lot (the controller wins 2/90);
  the primary set turned out to have a hard tail for P2. The seed-set sensitivity is reported above rather than
  smoothed over. Bootstrap CIs resample tasks only (seed randomness is the only randomness; the agents are
  deterministic).
- The 3-point rule is finer than the data: per level (n = 30) 3 points is 0.9 of a task (one task = 3.3 pts), so it is
  a "zero tasks" rule; pooled (n = 90) it is 2.7 tasks.
- Lead-time (dossier metric) is censored at the controller's halt in 88/90 tasks (the controller strands itself in
  2/90) and therefore uninformative here.

## Negative / null results kept

- Resumer (i): hold-and-resume does not beat restart (P3 < P2 pooled; point estimates negative at every level).
- P3-amn at (ii): +2.2 pts over P2, inside the kill band. Memory handover is doing real work.
- The oracle permissive adds at most +2 tasks over P3 (d5 only); the conservative one adds one more at d4 and is never
  worse at resumer (ii) (at resumer (i) it is one task worse at d3). Neither is worth building on this evidence alone.
- On sets B and C the best hold-and-resume protocol is +4.4 to +5.6 pts over P2 with the lower CI at 0.0; a smaller
  true effect than the primary set suggests cannot be excluded.
- Hold-and-resume never reaches P1 (94-98% vs 100%): the held state is sometimes worse than a fresh start.
