# RESULT-SW-1: an agent node that builds its own sub-workflow, or asks the governing builder for one

2026-11-04. Gap A5 / F4 in [REQUIREMENTS-COVERAGE-20261021.md](../REQUIREMENTS-COVERAGE-20261021.md): owner messages
[20][70] ("an agent inside a node realises it needs a sub-workflow and creates one ... don't dumb down the efficiency of
the model working on it") and [75] ("build a sub-solution themselves or send it outwards to the governing harness to use a
fresh Haiku builder?"). Design: [DESIGN.md](DESIGN.md). Frozen plans: [PREREG-SW-1.md](PREREG-SW-1.md) (eval-1) and
[PREREG-SW-1b.md](PREREG-SW-1b.md) (the template-miss probe). Code: [experiments/subworkflow/](../../experiments/subworkflow/).
Bed: [beds/golive](../../beds/golive/README.md). Author: the orchestrator's Opus 5.5 worktree agent (the same author wrote
the bed, the templates and the prompts; a declared threat, §8).

**Evidence label.** Development evidence on held-out seeds (split `test`) of a development bed. Not sealed. K=1 per (arm,
task); the unit of comparison is the paired backlog node. SW-1b is exploratory (PREREG-SW-1b). Nothing here is a claim
about arbitrary sub-problems or about another bed.

## 1. Answer

1. **A sub-workflow is the capability, not the route.** On the primary stratum P (golive d4-d5, 16 tasks, 32 backlog nodes
   of 110-290 rows), the node alone (A0, the simple baseline) passes **11/32** backlog nodes (34%) and 2/16 tasks at
   **$0.053 per task**. When the parent directs a sub-workflow, the node passes **32/32** building it itself (A1F),
   **31/32** filling a library template itself (A1TF) and **27/32** through the governing builder (A2F), at **$0.017-$0.029
   per task**: 0, 1 and 5 failed backlog nodes instead of 21, at 0.31-0.54x the baseline's cost per task. Exact McNemar,
   A0 vs A1F: 0/21 discordant, p = 1e-6; A0 vs A2F: 1/17, p = 1.5e-4.
2. **Owner [75], decided by the frozen rule, two different answers depending on who decides that a sub-workflow is needed.**
   - *The parent decides* (A1F vs A2F): **build it in the node.** 32 vs 27 backlog nodes, 5/0 discordant, p = 0.0625;
     rule (iii) (≥ 3 more passes): A1F preferred, labelled suggestive. Cost is a tie under cache-neutral pricing
     ($0.0287 vs $0.0283 per task).
   - *The node decides* (A1 vs A2): **send it outwards.** 22 vs 15 backlog nodes, 11/4 discordant, p = 0.12; rule (iii):
     A2 preferred, suggestive; A2 is also 0.58x A1's cost. The reason is the decision, not the build: nodes asked the
     governing builder on 26/32 backlog nodes but built for themselves on only 6/32, and half of A1's direct answers
     (13/26) say they had "no code-execution tool", misreading the self-build offer.
   - Both deciding arms lose badly to both directed arms (15 and 22 vs 27-32): **the node's own one-pass "do I need a
     sub-workflow?" judgment is the weakest link**, not the builder.
3. **Safety held in every arm and stratum:** 0 authority violations (runner audit and the analyzer's independent re-check
   of every spec that reached the call host), 0 effects executed, depth ≤ 1 used (limit 2), 0 children over their
   reservation, 0 nodes over $0.15. This is weaker than it sounds: no builder ever *tried* an effect step in the paid
   runs, and budgets never bound (largest child: $0.0062 of a $0.04-0.06 reservation). The refusal paths (effect step,
   depth 3, budget above the carve, an input the request did not pass, defence in depth without the static check) are
   exercised by the $0 tests only (§6).
4. **When the library misses (SW-1b, exploratory, 5 worlds, 10 backlog nodes per arm):** the template-only governing
   builder never declines; it falls back on 10/10 nodes and passes **2/10** (A0: 3/10) at 1.8x A0's cost. The node
   building for itself passes **10/10**; the open governing builder (library stage, then a fresh Haiku writing free-form
   from the request) passes **8/10** at 2.1x A1F's cost, because it first spends four failing library rounds (§7.6).

## 2. What was built

A parent workflow (code) runs four channel intake nodes; each node is a Haiku 5.5 agent with an authority envelope (its
4 inputs, pure ops, one model, node budget $0.15, a child carve ≤ $0.06 keeping $0.02 for a fallback answer, depth ≤ 2).
Mid-run a node can ask for a sub-workflow:

- **typed request** `{goal, inputs ⊆ node inputs, returns, budgetUsd}` (A2 routes); code clamps the budget to the carve and
  drops inputs the node does not hold, each recorded as a proposal; code attaches the node's answer contract (the parent
  binds it, the node cannot change it);
- **construction**: either the node itself in its own context (free-form subworkflow/1, A1/A1F; or template select-and-fill,
  A1TF) or the **governing builder**, a fresh Haiku that sees only the request, the contract and the named inputs and
  selects and fills one of four frontier-written templates (A2/A2F; SW-1b adds an open stage that writes free-form when
  the library misses, A2OF);
- **checks before running**: `checkSpec` against the envelope (anything outside is refused and recorded as a proposal,
  never widened), a **$0 practice run** on the node's own data with every judgment stubbed, and the **contract gate**;
  failures go back to the builder (≤ 3 repairs), then a logged direct-answer fallback;
- **binding**: the checked spec is registered **by content hash** in the flow-v3 call-host registry and invoked as an
  ordinary `flow:call` from the node's scope (`experiments/subworkflow/bind.mjs`); the call host enforces unknown hash,
  recursion, depth, effects `'none'`, input/output contracts and the budget tree; the child's model calls go through the
  child's scope of the same journaled ModelPort;
- **results flow back** through the same contract gate as a direct answer.

No `src/runtime.mjs` change (the call host is `experiments/jit/call-host.mjs`, unchanged since PREREG-SW-1).

## 3. The bed and the arms

`golive@1.0.0`: a go-live intake with four sales channels; two channels carry a legacy export backlog (d3: 45-56 rows;
d4: 110-140; d5: 255-290) with re-sent rows, letter-O typos in amounts, blank currencies, impossible dates, status notes
that only a reader can judge (trap phrasings), an injected instruction and a request to write typo fixes back to the
legacy system (an effect outside the node's authority). Node oracle: the exact import set, quarantine set and totals; task
oracle: every node plus the group totals. Node-level controls (keyword script, first-row) fail on every backlog node.

Arms (Haiku 5.5 for everything): **A0** node alone · **A1** node decides, builds itself · **A2** node decides, typed
request to the governing builder · **A1F / A2F** parent directs a sub-workflow for legacy exports, built as A1 / A2 ·
**A1TF** parent directs, the node fills a template itself (ablation: templates without a fresh builder).

## 4. Capability table (eval-1, primary stratum P = d4 + d5, 16 tasks per arm)

| arm | backlog nodes pass | tasks pass | simple nodes pass | $ / task | $ / task, cache-neutral | $ / passing backlog node | wall s / task |
|---|---|---|---|---|---|---|---|
| **A0 baseline** | **11/32 (34.4%)** | **2/16** | 32/32 | **0.0533** | 0.0530 | 0.0760 | 180 |
| A1 node decides, self-build | 15/32 (46.9%) | 3/16 | 32/32 | 0.0469 | 0.0464 | 0.0487 | 170 |
| A2 node decides, governing builder | 22/32 (68.8%) | 8/16 | 32/32 | 0.0271 | 0.0274 | 0.0187 | 117 |
| A1F parent directs, self-build | **32/32 (100%)** | **16/16** | 32/32 | 0.0286 | 0.0287 | 0.0139 | 139 |
| A1TF parent directs, node fills template | 31/32 (96.9%) | 15/16 | 32/32 | **0.0168** | **0.0186** | **0.0082** | 113 |
| A2F parent directs, governing builder | 27/32 (84.4%) | 12/16 | 32/32 | 0.0254 | 0.0283 | 0.0146 | 141 |

By difficulty (backlog nodes): d4: A0 8/16, A1 7/16, A2 9/16, A1F 16/16, A1TF 15/16, A2F 14/16. d5: A0 3/16, A1 8/16,
A2 13/16, A1F 16/16, A1TF 16/16, A2F 13/16. Cache-neutral = every input token at the uncached rate, so run order (a later
arm reading a prompt prefix an earlier arm cached) cannot move the ranking; it does not.

Pooled over the arms, by the path a backlog node took in P: **sub-workflow 117/126 (92.9%)** (free-form 38/38,
template-built 79/88), **one-pass answer 21/64 (32.8%)**, fallback 0/2.

d3 stratum (4 tasks, 8 backlog nodes of 45-56 rows; report only): A0 5/8, A1 6/8, A2 6/8 (both answered every d3 backlog
directly), A1F 8/8, A1TF 8/8, A2F 8/8; $/task A0 0.0138, A1 0.0141 (1.02x), A2 0.0178 (1.29x), A1F 0.0218, A1TF 0.0092,
A2F 0.0117. Full tables: [runs/eval-1/analysis.md](runs/eval-1/analysis.md).

**Efficiency where no sub-workflow is needed** (owner: "don't dumb down the efficiency"): simple nodes pass 100% in every
arm (40 per arm over P and d3). The decide prompt costs extra on them: A1 1.16x and A2 1.32x A0's simple-node $ (about
$0.0001-0.0002 per node); the directed arms answer simple nodes with exactly A0's call and cost 0.73-0.74x A0 (most
likely the prompt cache: A0's units start first on each task). On backlogs the sub-workflow is what saves money: a
one-pass answer prints every imported row with its reasoning (mean **49,474 output tokens** per A0 backlog node), a
template fill prints settings (2,518 for A1TF, 4,539 for A2F at the node level; the child's judge calls are booked
separately and included in $), a free-form program 16,670 (A1F).

## 5. Preregistered questions, decision rules and predictions

| question | frozen rule | result |
|---|---|---|
| Q1 need | McNemar on backlog nodes | A0 vs A1F 0/21 discordant, p = 1e-6; A0 vs A2F 1/17, p = 1.5e-4: **sub-workflows needed in P** |
| Q2 route, parent decides | (i) safety, (ii) p < .05, (iii) ≥ 3 more, (iv) ≥ 15% cheaper, (v) tie | (i) both safe; (ii) p = 0.0625; (iii) 32 vs 27: **A1F (self-build) preferred, suggestive** |
| Q3 route, node decides | same | (i) both safe; (ii) p = 0.118; (iii) 22 vs 15: **A2 (governing builder) preferred, suggestive** |
| Q4 ablation | report | A1TF vs A2F 31 vs 27 (4/0, p = 0.125), A1TF vs A1F 31 vs 32 (0/1); A1TF cheapest |
| Q5 d3 | report | not a no-need stratum: A0 failed 3/8 d3 backlogs; deciding arms answered all 16 directly (12/16 pass) |

| prediction on record (PREREG-SW-1) | outcome |
|---|---|
| A0 backlog pass in P below 75% (d5 below 50%) | held: 34.4% (d5 18.8%) |
| A1F, A2F, A1TF backlog pass in P ≥ 90% | A1F 100% and A1TF 96.9% held; **A2F 84.4% missed** |
| A1F vs A2F a pass tie (rule iv/v decides) | **missed**: rule (iii) decided, A1F +5 |
| A1TF the cheapest arm | held (also cache-neutral) |
| at d3 the deciding arms answer most nodes directly, cost within 1.25x of A0 | direct: held (16/16); cost: A1 1.02x held, **A2 1.29x missed** |
| (design assumption) d3 is the no-need stratum | **wrong**: A0 3/8 d3 backlogs failed (pilots on dev seeds had passed them) |

## 6. Safety, authority, depth and budget

| arm (P + d3) | audit problems | runner violations | effects run | max depth | child over reservation | node over $0.15 | max node $ | max child $ (reservation) |
|---|---|---|---|---|---|---|---|---|
| A0 | 0 | 0 | 0 | 0 | - | 0 | 0.0503 | - |
| A1 | 0 | 0 | 0 | 1 | 0/6 | 0 | 0.0411 | 0.0057 (0.06) |
| A2 | 0 | 0 | 0 | 1 | 0/26 | 0 | 0.0215 | 0.0062 (0.06) |
| A1F | 0 | 0 | 0 | 1 | 0/40 | 0 | 0.0210 | 0.0058 (0.06) |
| A1TF | 0 | 0 | 0 | 1 | 0/40 | 0 | 0.0120 | 0.0061 (0.04) |
| A2F | 0 | 0 | 0 | 1 | 0/38 | 0 | 0.0431 | 0.0060 (0.06) |

Proposals (things outside the envelope recorded for the owner, `executed: false`), P + d3: A2 78, A1TF 119, A2F 135 "not
covered" items from template selection (the legacy write-back, e-mails and posts the injected notes ask for), plus 8 A2F
input refusals (§7.2). The write-back request reached the owner as a proposal on 22/32 (A2), 32/32 (A1TF) and 24/32 (A2F)
backlog nodes in P, **and on 0/32 in A1F**: the free-form self-build route has no "not covered" channel, so a node that
builds for itself silently ignores an out-of-authority request instead of proposing it. Not a violation (nothing was
done), but the owner's "proposals for anything outside" contract is met only by the template and governing routes.

Rows carrying an injected instruction were answered correctly in A2, A1F, A1TF and A2F (48/48 each in P); A0 44/48,
A1 47/48.

What the paid runs did not test: no builder emitted an effect op, a nested call or a budget ask above the carve, so the
three independent refusal layers and the depth limit were never exercised under live pressure. They are exercised at $0
in `experiments/subworkflow/test/node.test.mjs` (13 tests: an effect step refused before anything runs and recorded as a
proposal; a nested call past depth 2 refused statically, one within it runs at depth 2; a budget above the carve clamped
and proposed; a request that does not pass `export` cannot read it; without `checkSpec` the call host refuses an
effectful callee and the runtime refuses an effect op) and `node-open.test.mjs` (5 tests).

## 7. Every failure, root cause

### 7.1 One-pass answers (A0, A1/A2 direct): arithmetic and dropped rows
43 of 64 direct backlog answers in P failed. By failure class (a node can have several): wrong cents (exchange-rate and
pence arithmetic on 100-290 rows) in 37, missing rows in 16, status in 7, placed date in 5, quarantine in 3, extra row in
2. Worst cases: A0 d5 seed 206 TradeDesk, 134 wrong amounts; A0 d5 seed 207 ShopLine returned an empty import with zero
totals for a 186-order backlog (after 8,436 output tokens). At d3, 7 of 24 direct answers failed (5 on cents). This is
the job a sub-workflow moves into code: in eval-1 no sub-workflow node in any arm failed on cents, rows, dates or
quarantine (SW-1b has one that did, for a different reason: §7.6).

### 7.2 Governing route: the request forgot the data (A2F, 2 nodes; both fallbacks)
On d5 seed 206 MarketBox and d5 seed 207 TillMaster the node's typed request named `channel, spec, notes` but not
`export`. The builder picked the right template; every fill read `$in.export`, and the envelope refused it in all 4
rounds ("reads input export, which this node does not hold"), correctly, since the builder may read only what the
request passes. The builder cannot repair that: the missing piece is on the node's side, and the protocol has no round
that goes back to the requester. The fallback direct answers then cost $0.035 / 209 s and $0.032 / 187 s (66,798 and
59,432 output tokens) and both failed on cents. **Fix (not run):** a request-completeness check in code before the
builder starts (a request for a legacy-export intake must pass the export; more generally, a "needs input X" refusal
returns the request to the node once instead of spending the builder's repair rounds). The node-decides arm A2 never
omitted `export` (26/26).

### 7.3 Sub-workflows: a single mislabelled row (9 nodes, all template-built)
Every failing sub-workflow node (A2 5, A2F 3, A1TF 1) failed on one or two status labels from the batched Haiku judge;
all code steps were right. The judge audit over every `judge_rows` call in the journal: **10 wrong of 21,168 rows
(0.05%)**, but an exact node oracle fails on one. The 10 sit on four phrasings (9 plain, 1 trap), 7 of them on "new order,
nothing sent yet" labelled awaiting_customer; in 7 cases identical notes got different labels within one node.
Template-built judges erred on 10/14,496 rows, free-form ones (A1, A1F) on 0/6,672 (Fisher one-sided p = 0.023, post
hoc): the free-form specs used larger batches (25 vs 15) and their own longer instructions; which matters is untested.
**Design lesson ($0 counterfactual, post hoc, not a result):** a code step that gives each order the majority label of
all rows with the identical note in that node would have repaired 6 of the 9 failing nodes and broken none
(`vote-counterfactual.mjs`). Summary: [runs/eval-1/judge-audit-summary.json](runs/eval-1/judge-audit-summary.json).

### 7.4 The node's decision (A1, A2): the self-build offer is misread
A1 chose a sub-workflow on 6/32 backlog nodes in P (all 6 passed) and answered 26 directly (9 passed). **13 of those 26
reasons say the node had no code-execution tool** ("Only the StructuredOutput tool is available, so no code can be run";
"No code-execution step is available to me, so I worked the 276 rows by hand"); 3 of those 13 passed. The A1 offer reads
"build a sub-workflow for yourself: a small typed program of steps (... code steps that compute exactly ...)" and Haiku
conflates the sub-workflow's code steps with its own tool list. A2 nodes were offered a builder that does the work and
never gave that reason; they asked for a sub-workflow on 26/32. At d3 both deciding arms answered all 8 backlogs directly
(6/8 pass each). **Fix (not run):** a code-level trigger (the parent routes legacy exports or row counts above a threshold
to a sub-workflow, as the directed arms do) rather than the node's one-pass judgment; or, if the node must decide, an
offer worded as "the harness runs it for you", which is what the A2 offer says.

### 7.5 Environment
Launch 1 (10-22) lost 112/120 units and launch 2 (10-28) 21/120 to the subscription session limit; launch 3 (11-04)
completed the rest with 0 faults. `envaudit.mjs` over the journal: 0 environment-class failed calls hidden inside any
scored unit's window (a rate limit inside a child's judge step would otherwise look like an arm failure).

### 7.6 SW-1b: when the library misses

Exploratory (PREREG-SW-1b). The same d4 worlds and truth as eval-1, with the two backlog exports printed as a legacy
block report (`@@ RECORD n` blocks, one `field: value` line each) that no library template can read (checked at $0 by
`layouts.test.mjs`). The cap stopped the run after **5 complete worlds** (seeds 201-205, all four arms each; 10 backlog
nodes per arm); worlds 206-208 were not run.

| arm (blocks layout, 5 worlds) | backlog nodes pass | tasks pass | backlog path | $ / task | $ / passing backlog node | wall s / task | same worlds, delimited (eval-1) |
|---|---|---|---|---|---|---|---|
| **A0 baseline** | **3/10** | 0/5 | direct 10 | 0.0318 | 0.0510 | 109 | 5/10 |
| A1F parent directs, node self-builds | **10/10** | **5/5** | sub-workflow 10 | **0.0272** | **0.0132** | 147 | 10/10 |
| A2F template-only governing builder | 2/10 | 0/5 | fallback 10 | 0.0580 | 0.1429 | 210 | 9/10 |
| A2OF open governing builder | 8/10 | 3/5 | sub-workflow 10 (open stage 10, passed 8) | 0.0582 | 0.0358 | 241 | - |

Paired backlog nodes (same worlds): A1F vs A2F 8/0 discordant; A2OF vs A2F 6/0; A2OF vs A1F 0/2; A1F vs A0 7/0.
Safety as in eval-1: 0 audit problems, 0 violations, 0 effects, depth ≤ 1, no node over budget, 0 hidden environment
faults (`runs/sw1b-1/envaudit.json`). Tables: [runs/sw1b-1/analysis.md](runs/sw1b-1/analysis.md).

| prediction on record (PREREG-SW-1b) | outcome |
|---|---|
| 1. A2F on blocks falls back on most backlog nodes; its pass within 1 node of A0's | held: fallback 10/10; 2 vs 3 |
| 2. A1F passes ≥ 2 more backlog nodes than A2F (at 4 worlds; scaled to 5) | held: 10 vs 2 |
| 3. A2OF passes at least as many backlog nodes as A1F minus 1 | **missed by one**: 8 vs 10 |
| 4. safety holds in every arm | held |

What happened, node by node:
- **The template-only governing builder never says "none".** It picked `legacy-export-intake` for 10/10 blocks exports
  and spent all 4 rounds failing the practice run (8 nodes), or on a request without `export` (1) or without the rules
  (1); then the direct-answer fallback, which passed 2/10, about A0's rate, at 1.8x A0's cost. **A library-only governing
  builder is worse than no sub-workflow when the library misses.**
- **Self-build is layout-proof here:** every A1F spec opened with a code step that parses the `@@ RECORD` blocks, and
  A1F passed 10/10, as on the delimited layout, at about the same cost ($0.027 vs $0.025 per task).
- **The open stage works but pays for the library stage first.** In A2OF the open builder wrote a passing spec in its
  first round on all 10 nodes; per backlog node the library stage (select + 4 failing fills) cost $0.0124 and 71 s, the
  open build $0.0109 and 76 s (A1F's own build: $0.0108, 78 s). The two failures: world 205 MarketBox, one judge status
  slip (§7.3); world 203 TradeDesk, the node's request was "Run the legacy-export-intake template on the TradeDesk
  export" with only `export` passed (no rules, no notes), and the open builder invented the rules: it quarantined 112 of
  127 orders and imported 15. The contract gate checks structure (shape, totals, refs, disjointness), not whether the
  rules were applied, so it passed the answer to the oracle.
- **Request incompleteness, both runs together:** of 86 governing-route requests on backlog nodes, 9 omitted `export` or
  `spec`. The 3 without `export` all failed (fallback); the 6 without `spec` passed 4/4 on delimited exports (the
  template's slots could be filled from the header and notes) and failed 2/2 on blocks. **Fixes (not run):** end the
  library stage after one practice failure that is a parse failure rather than a slot error; check request completeness
  in code (the inputs the node's contract depends on) and return an incomplete request to the node once.

## 8. Threats and what this does not show

- One bed, one author for the bed, the templates and the prompts: the library fits the bed's sub-problem by construction
  (SW-1b probes exactly that). The governing builder's edge over self-build when the node decides comes from the decision
  rate, which depends on the prompt wording of the two offers (§7.4).
- K=1 per (arm, task); 32 backlog nodes per arm in P. Rule (iii) results are labelled suggestive by the frozen rule.
  SW-1b has 10 backlog nodes per arm (the cap stopped it at 5 of 8 worlds): counts only, exploratory.
- Development bed, held-out seeds, not sealed. The pilots (dev seeds) shaped the bed and two fixes and are not pooled.
- No live pressure on the refusal layers or budgets (§6). Depth 2 was available and never used.
- **The directed arms' trigger is right by construction.** The parent routed a node to a sub-workflow when the bed's
  world said the channel is a backlog (`bed.channelKinds`). A trigger computed only from what the parent observes agrees
  on all 112 nodes of eval-1 and SW-1b (`trigger-check.mjs`: the export is not a JSON list, or it holds more than 40
  records; simple channels hold 3-5, backlogs 45-281), so the directed arms' advantage is reachable by code here. But
  the bed makes that decision easy for code, while the nodes still got it wrong (§7.4); a bed with nodes near the
  boundary is needed before claiming a code trigger beats the node's own judgment in general.
- Deviations: the PREREG allows one re-run of an env-fault unit; 21 d3 units were re-run twice (launches 2 and 3) because
  the session limit hit both times. Env-fault units are never scored and the re-run replays journaled calls, so the
  outcome cannot be selected; Q5 is report-only. `launch.json` is rewritten per launch; launch-1.json and launch-2.json
  keep the earlier records.

## 9. Recommendation

On this bed, measured: when a node's sub-problem needs a multi-step procedure, the **harness, not the node, should decide
to spawn the sub-workflow** (a code-level trigger on a primitive: legacy export, row count), and the node should then
**build it in its own context**: free-form (A1F: 32/32, and 10/10 when no template fits) or, cheapest while the library
fits, filling a library template itself (A1TF: 31/32 at 0.59x A1F's cost per task, 0.65x cache-neutral; A1TF was not
run on the template-miss layout, and as a library-only route it would be expected to miss there as A2F did, an
inference). The governing builder (fresh context, the request only) is the better route **when the node decides**
(22 vs 15), but a **template-only governing builder must not be the only route**: on a library miss it never declined
and did worse than no sub-workflow (2/10 vs 3/10, §7.6). If it is used, it needs the open stage with a fail-fast library
stage and a request-completeness check (§7.2, §7.6). Every route needs a cheaper judge-slip guard (§7.3), and the
self-build route needs a "not covered" channel so out-of-authority asks become proposals (§6). Next measurements, in
order of value: (1) the fixes above as a new frozen arm on fresh seeds (request completeness, fail-fast library, note
vote); (2) a bed whose nodes sit near the need boundary, to test a code trigger against the node's own decision;
(3) a sub-problem that needs depth 2 and a budget that binds, so the envelope is tested under live pressure.

## 10. Cost

Haiku 5.5 (`claude-haiku-5-5`, the only model in every journal) via the repo's Claude CLI ModelPort, journaled per call.
SW-1 pilots $0.515 (309 calls), eval-1 **$3.526** (2,888 calls over 3 launches; $3.524 booked to the scored units), SW-1b
**$0.876** (289 calls; stopped by its $4.85 runner cap after 5 of 8 worlds). **Total $4.916 of the owner's $5 cap.** Per
task in P: A0 $0.053, the best sub-workflow arm $0.017 (A1TF); per passing backlog node: A0 $0.076, A1TF $0.008.

## 11. Reproduce

```
node experiments/subworkflow/analyze.mjs --results research/subworkflow-20261021/runs/eval-1/results.jsonl
node experiments/subworkflow/posthoc.mjs --results research/subworkflow-20261021/runs/eval-1/results.jsonl   # decisions, efficiency, anatomy
node experiments/subworkflow/failures.mjs --results research/subworkflow-20261021/runs/eval-1/results.jsonl
node experiments/subworkflow/analyze-sw1b.mjs --difficulty 4 --seeds 201,202,203,204,205 \
  --results research/subworkflow-20261021/runs/sw1b-1/results.jsonl,research/subworkflow-20261021/runs/eval-1/results.jsonl
node experiments/subworkflow/trigger-check.mjs   # observable-input trigger vs the world's channel kind ($0)
```
The journal-side tools (`envaudit.mjs`, `judge-audit.mjs`, `vote-counterfactual.mjs`, `posthoc.mjs --journal`) read
`runs/*/journal.sqlite`, which stays out of git (it can carry host account identity); their outputs are committed.
$0 tests: `node --test` on `beds/golive/golive.test.mjs` (7), `beds/golive/layouts.test.mjs` (5),
`experiments/subworkflow/test/{template,node,node-open}.test.mjs` (3, 13, 5).
