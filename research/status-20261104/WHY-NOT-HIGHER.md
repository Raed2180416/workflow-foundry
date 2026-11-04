# Why each test did not score higher: the root causes and the ideological gaps (2026-11-04)

**Scope.** Every measured bed in this session, with its score, what limited it, and the evidence for that limit. One
section draws out the gaps that recur across beds. Each number is cited from a committed result (or an unmerged branch,
marked ⏳). Root causes are stated only where data supports them; anything else is labelled a hypothesis.

## 0. The arithmetic first: why "90% on AutomationBench" was never within reach on look 2

On the 60 held-out look-2 tasks, **only 43 were solved by any arm at all**. The arms are:
- A1-C v2 and v1, each with Haiku alone and with Mercury in the ledger and checker roles;
- Sonnet 5.5 with the A1 harness;
- Opus 5.5 xhigh alone;
- plain Haiku.

A perfect selector over every system we have would therefore score at most 43/60 (72%). The frontier model alone scored
26/60 (43%), and Opus 5.5 xhigh's own figure on the private leaderboard is 35.77%. On dev60, 11 of the 19 tasks no arm
passed were benchmark defects (7 hard, 4 soft), so dev60's reachable ceiling was about 53/60.

So reaching 90% needs two things:
- solving tasks that no system, including Opus, solves;
- benchmark repairs we may not make.

The honest target is the reachable subset (D28 makes that column mandatory). On it, A1-C v2 is at 29 of at most 43.

## 1. AutomationBench (A1-C v2, look 2, held-out): 29/60

Source: `P1-RESULT-HEADLINE.md`, including its failure anatomy, reproducible with
`experiments/autobench/replay/p1-anatomy.mjs`.

| Root cause | Share of v2's 31 failures | Evidence |
|---|---|---|
| **Hard for everyone** (task difficulty or benchmark defects; not yet split) | 17 | Failed by every arm, Opus 5.5 xhigh included |
| **The checker knew, but there is no second pass** | 19 (hard-fail 7, hard-undecided 6, advisory-fail 6) | v2 is single-pass by design. Other arms solved 7 of these 19. VL-1's ungated repair fixed 0 and broke 2 |
| **Silent misses: a requirement was never stated**, so no check tested it | 12 | All of v2's checks passed and the grader failed the run. By kind: content 4, forbidden effects 4, mixed 4. v2-M (Mercury as reader) solved 6 of the 12, which suggests variance between readers rather than a fixed blind spot |
| **Exact details in messages** | assertion families | `gmail…body_contains` in 9 failures; Slack must-exist or must-be-in-channel in 9; "must not send, post or create" in 11 |
| Near misses | 10 failures miss exactly one assertion; 13 have partial credit ≥ 0.8 | — |

The ideological gaps behind these, with what fits each:

1. **No closed-world model of the expected end state (Δ\*).** The ledger lists what to do; nothing in code states what
   the world must and must not look like afterwards. That is the root of the silent misses: forbidden effects and exact
   content are claims about the final world, not steps. ATTACK traced 4 of its 8 blockers to this one missing object.
   - *Fit:* Δ\* in A1-C's live path, not only in the lab.
2. **Verification is the binding constraint, not generation.** On dev60, the pipeline's own checks separate right from
   wrong attempts at AUROC 0.47–0.58, which is near chance. Haiku and Sonnet judges reach 0.69–0.76, and they share their
   mistakes (κ 0.61–0.70). Only an independent information path helped: the RL2 ledger, with checks grounded in code,
   reached 0.837. Every gain so far came from a different path (code against model, another model family, a probe of
   the world), never from more samples of the same family.
   - *Fit:* check across model families (Haiku plus Mercury readers, union of ledgers), and probe the world.
3. **Single pass by design.** The checker's verdict on 19 failures went unused. A naive repair harms instead.
   - *Fit:* a gated repair round (ATTACK Move 1's commit gate): repair only what a hard check names, and keep the change
     only if no check regresses.
4. **Mismatch between the benchmark and the thesis.** AutomationBench tasks are one-off. Foundry's advantage
   (amortised, verified, reusable procedure) has nothing to amortise there, so look 2 measures harness quality on one-off
   tasks. Where procedure recurs, the advantage shows: SOP-Bench sealed, +20.5 points over the agent.
   - *Fit:* keep AutomationBench as a test of harness quality, and run the recurring-task beds (AutomationBench-R,
     WorkBench, AppWorld from breadth) as the thesis test.

## 2. VL-1, selection among forks (look 2): +3 over v1-M (+8/−5, p 0.58)

Source: `vl1/RESULT.md`.
- **Selection accuracy is capped by verifier precision.** On the 18 tasks where exactly one fork passed, the rule picked
  the passing fork 13 times (0.72). Good enough to help, too noisy to clear the "≤ 2 losses" rule.
- **The default fork was stronger than its prior** (48% against 43%), so every switch risked a loss. The rule switched
  away from it on 34 of 60 tasks.
- **Repair breaks things without a gate.** 0 fixed, 2 broken; precision of the high-precision checks 9/17.
- **Cost:** carrying a Sonnet fork costs 37.8% of Opus per task, which fails the 20% parity limit.

*Ideological gap:* best-of-K needs a verifier at least as reliable as the forks are diverse. Ours is not yet.

## 3. SOP-Bench phase 2 (sealed, k = 3): pass^3 87.6%, against 67.1% for the agent

Source: `sopbench-20261021/RESULT-p2.md`. The workflows beat the agent, but missed the reliability bar (pass^3 ≥ 90% with
a lower bound ≥ 85%).
- **Build-once code without a model fallback.** 11 of the 12 workflows make no model call at run time. They are code a
  cheap model fitted on about 20 dev rows, so the long tail breaks them: they trail the agent on order_fulfillment (78.3%
  against 87.0%) and traffic_spoofing_detection (72.8% against 81.1%). Both arms sit near 50% on
  warehouse_package_inspection (the task or its oracle; unexamined).
- **A benchmark defect:** content_flagging's oracle is invalid; its truth reproduces on about 36% of rows.

*Ideological gap:* the JIT idea, compiled code that **de-optimises to a model** when a guard misses, was never applied to
SOP-Bench. The compiled path has no escape hatch.
- *Fit:* default to compiled + guard + deopt.

## 4. ROUTER-1, the need router (held-out 193): the code router 9/132 false triggers, recall 0.67

- **Overfit lexicon.** Hand-written cues fit on 126 dev requests failed on other people's wording. A $0 n-gram classifier
  ranks just as well (AUROC 0.918 against 0.915).
- **The protocol could not show "never trigger".** "Never" needs a bounded false-trigger rate with an interval, not a
  zero on dev.
- **The labels, rubric and prompt share one author.** Even Haiku's 5/132 agrees with a rubric that the label author
  wrote.

*Ideological gap:* "does this need a workflow" is a judgment about latent structure (recurrence, irreversibility, scale,
exactness) that surface cues do not carry.
- *Fit:* ask a model directly, under a bounded-rate claim, on a separate-author sealed set (ROUTER-2).

## 5. FH-1, failure handling (dev): 75.2% removed, 0 regressions

- **The verifier is doing most of the work.** The gain depends on 13 frontier-written contracts, whose cost ($6.69–19.58)
  is not in the $1.14.
- **One dominant cause.** 58% of the gain is a single requirement that seven programs misread the same way.
- **Untested routing.** Routing between retry and patch was never exercised, because retry is zero on deterministic
  programs.

*Ideological gap:* healing is only as good as the oracle. With no oracle, heal claims are unearned (D28: no heal claim
before the gauntlet).

## 6. C2 reuse (dev, preregistered)

- C2-1: reuse through the profile gate scored 85%, against 98% for rebuilding.
  - *Why:* the profile gate admits suppliers whose items fall outside the producer's proof.
- C2-2: a conformance gate (replay the consumer's labelled history) gave 0 wrong reuse in 98.
- C2-3: an agent given the same labels reaches 91.5%.

*Gap:* reuse is safe only behind evidence about the consumer, and that evidence (labels) is also what makes the plain agent
strong.

## 7. SW-1, sub-workflows (dev, held-out seeds)

- Left to decide for itself, a node chose a sub-workflow on 6 of 32 backlogs and gained nothing.
- When the parent decides, sub-workflows score 27–32 of 32, against 11.

*Gap:* models do not diagnose their own need for structure. That supports "code owns procedure": structure is imposed
from outside the node.

## 8. Swarm ladder, rung 1 (held-out, $7.60; branch c30-10 ⏳)

- The Haiku swarm lead started 0 workers in 8 of 8 sessions ("serial collapse"). It tied a single agent at 4/7.

*Gap:* an untrained orchestrator does not fan out. Fan-out must be a code decision (a map node), as Foundry already does,
not a model choice.

## 9. CI-1, building corpus workflows from a description (held-out n8n items, K = 3; branch c30-7 ⏳)

- One-shot is already strong: 64.9% on oracle v1 (80.7% on v2).
- The frozen BUILDER-1 templates score 0%: no template covers these items.
- Retrieval of corpus patterns gave the best arm, 80.7% (93.0% on v2).

*Gap:* a closed template library does not generalise; structural retrieval from a large corpus does.

## 10. Tracker (held-out 14 requests, 97 builds; branch c30-6 ⏳)

- It caught 37–40 defective builds per sample, against 2 with no tracker, at precision 0.90–0.97.
- It missed H1 (precision ≥ 0.95 in every sample) and H2 (zero false alarms).
- In 3 to 7 catches per sample, every reason it gave was wrong.

*Gap:* a condition check without a world probe sometimes catches for the wrong reason.

## 11. Tier-down of compiled judges (dev archive; branch c30-9 ⏳)

- Cheap tiers hold on leaf judges.
- They fail on the expensive global readers (`records/rules`, `kinetics/well-events`, extraction).

*Gap:* some reads are genuinely hard. The economic answer is to route by leverage (a frontier model only on the few
high-leverage reads), not to tier everything down.

## 12. Other beds

| Bed | Score | What limited it |
|---|---|---|
| GQA-1 game QA (dev) | Workflow 6.4 of 12 bugs per run against 4.4 for a matched agent (post hoc) | Both explore enough; both lose at **detection**. Most of the original gap was the agent's handicaps |
| NODECAP-1 (dev, K = 2) | Arms U 9.5, A 9.5, C 1, B 9 of 12 | The first run lost 2 tasks to Foundry design defects (fixed) and 4 to model behaviour |
| OT-0 (dev) | Haiku plus validator 14/14, Sonnet 5/14, Opus 6/14 | The frontier failures were mechanical: a host refusal that a validator returns before commit. Haiku builds given the org constitution became compliant (0 → 57/58), but their E8 score fell: governance and function conflict |
| COMP-1, composition (dev) | 0.918 against the 0.95 bar | Composition keeps interfaces clean, but costs correctness at equal budget |
| JIT records (dev) | 22/24 against Opus 24/24 | The one-time compile cost dominates at small N. A weak interpreter makes weak traces |
| C0 construction (dev) | Haiku IR 11/16 | All 9 construction defects were in cases no probe contained; the F verdict passed all 5 oracle failures (self-certification) |
| AutomationBench devCheck | A1-C 20/60 = A1 20/60 | Code ownership raised partial credit, not passes |
| Kev | Stock ≤ the rule baseline on 4 of 5 | A general small judge does not beat cheap rules without fine-tuning |

## 13. The recurring gaps, ranked by how many beds they explain

1. **Verification precision is the binding constraint.** AutomationBench, VL-1, C0, the tracker and FH-1. Own checks
   are near chance, and judges correlate. Only independent paths help: code against model, another model family, a
   probe of the world, Δ\*. Fixing this raises every other number, because selection, repair, healing and reuse all
   read the verdict.
2. **The model does not impose structure on itself.** Swarm (0/8 delegation), SW-1 (6/32), and the need-router judge.
   The thesis's answer (code owns procedure) is right. The engine must decide fan-out, sub-workflows and repair rounds,
   not leave them to the model.
3. **No escape hatch from compiled code to a model.** SOP-Bench and JIT. A guard-and-deopt hybrid should be the default.
4. **Requirement recall: latent and forbidden effects.** AutomationBench silent misses, intent κ 0.57, tracker. A union
   of readers across families, and corpus priors of what usually must also hold.
5. **Benchmarks that do not reward the thesis.** One-off tasks give a workflow nothing to amortise. The thesis wins
   where procedure recurs (SOP-Bench sealed +20.5). Report the reachable subset, and prioritise recurring-task beds.
6. **Same-author evaluation.** ROUTER-1, SW-1, GQA-1, the tracker and CI-1. Sealed, separate-author sets are needed
   before any product claim.
7. **Costs left out of the claims.** FH-1's contracts and Mercury priced at $0. Every cheapness claim must carry the
   full cost.
8. **Benchmark defects.** AutomationBench dev60 (11/19 of the universally failed tasks) and SOP-Bench content_flagging.
   Audit the 17 look-2 tasks every arm failed before reading anything into them.

## 14. What would move AutomationBench most, for little money (hypotheses for a fresh, preregistered look)

1. **A union of two readers' ledgers (Haiku and Mercury).** v2-M solved 6 of the 12 silent misses. Mercury is listed at
   $0 under the allowance.
2. **A gated single repair round on hard-fail and hard-undecided runs (19 of 31).** Promote the repair only if no check
   regresses (ATTACK Move 1); VL-1R showed what happens without the gate.
3. **Δ\* forbidden-effect and exact-content checks** for the communication assertions (11 "must not" failures; 9 body
   contains).
4. **A defect audit of the 17 universally failed tasks** ($0), and report the reachable subset.

Look 3 (23 tasks, cumulative 83) is the remaining sequential look under the frozen plan, so any of these must be frozen
before it.
