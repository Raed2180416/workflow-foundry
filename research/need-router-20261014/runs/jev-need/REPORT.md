# Can Jev decide "does this task need a workflow?" (2026-10-14, dev, K = 1)

Owner question: "for the need a workflow judgement, is this not something which can easily be decided by jev?"
Experiment: `experiments/need-router/jev-need.mjs` (prediction recorded in its header before any request). Stock hosted Jev
(`jev-latest`, served `jev-1.13.0`) read each of the 96 M1 tasks the way a router sees it before execution (the prompt, truncated
to 6,000 characters, plus size facts; never the answer, oracle or outcome) and answered two typed questions: can ONE call produce
the correct answer (yes/no), and which approach is cheapest-and-reliable (direct/agent/workflow). Labels: whether one Haiku call
actually solved the task in M1 (either effort; `runs/m1/`). 96 requests, 0 errors, cost a fraction of a cent.

| measure | Jev | size rule (smaller input → one call) |
|---|---|---|
| task-level AUROC of "one call suffices" vs outcome | **0.53** | **0.71** |
| family-level Spearman (mean p vs one-call pass rate, 8 families) | −0.05 | – |
| accuracy at p ≥ 0.5 (base rate 0.49) | 0.51 | – |

| family (d3) | one call actually passes | Jev p(single call) | Jev p(direct is cheapest) |
|---|---|---|---|
| wbed-r0 (control) | 12/12 | 0.22 | 0.74 |
| wbed-r1 | 0/12 | 0.09 | 0.12 |
| wbed-r2 | 4/12 | 0.33 | 0.34 |
| wbed-r3 | 12/12 | 0.19 | 0.24 |
| wbed-r3p | 12/12 | 0.03 | 0.09 |
| wbed-r4 | 0/12 | 0.16 | 0.20 |
| wbed-r5 | 0/12 | 0.07 | 0.13 |
| wbed-r6 | 7/12 | 0.02 | 0.02 |

**Reading.** Stock Jev cannot read "needs a workflow" from the task text: chance-level, below a one-line size rule, and inconsistent
across its own two questions (the control is "direct is cheapest" at 0.74 but "one call suffices" at 0.22). It judges by surface:
tasks with long, procedural prompts (R3, R3′, R6) look like they need structure, yet one call solves them. This confirms the
design's decision 12 (Jev as a feature and baseline, never the mode-picker in v1) and the mechanism design's point that need is a
counterfactual, settled only by running modes (or a cheap probe), not by reading the spec. What could change it: Jev calibrated
on labelled outcomes (the label factory produces exactly those), questions about concrete properties instead of the verdict
("does the answer depend on combining more than N items?", "is there a deterministic check?"), and the probe outcome as an input.
