# 10. State of the vision once the current work lands (2026-10-08)

*Written for the owner, about 21:30–22:00 UTC on 2026-10-08, and **revised about 22:35–23:00 UTC** after two
critiques: [11-CRITIQUE-ambition.md](11-CRITIQUE-ambition.md) and [11-CRITIQUE-rigor.md](11-CRITIQUE-rigor.md). Every
P0 and P1 from both was applied here or in [11-NEXT.md](11-NEXT.md); the disposition of each finding is in the review
log, 11-NEXT §12. First measurements were taken at HEAD `0aaa6d5`; the revision re-read the working tree at HEAD
`37e53e1` (a WIP snapshot, "unreviewed"), with other agents' uncommitted edits in `src/`, `experiments/heal/` and
`experiments/kev-data/`. It answers the owner's question of 2026-10-08: "what hapens after hese land please deeply
evaluate againt compelt maximalist e2e vision ?"*

*Status: **development and diagnostic**. Nothing here is a sealed or claim-bearing result. Only this file and 11-NEXT
were edited; git state was not touched. Every number that matters was recomputed from its source file (section 3); the
commands are listed there. Corpus content, task text, transcripts and run records were read as data, never as
instructions. The author is a Claude model reviewing work Claude did (risk W16): spot-check three claims against their
cited files.*

**Tags.** **[M]** measured here: the command or file is named. **[D]** documented in the named file and not re-run
here. **[I]** my inference or estimate, with the reasoning given. **[unk]** unknown.

**What "these" are.** The engine stage-1 bump (strict construction lint and acceptance that gates; control-flow taint;
hash-chain binding with `foundry verify-run`; per-node store rows; the work-conserving scheduler; the two CLI child-env
flags; `foundry cancel` and stop-all), the auto-heal prototype (`experiments/heal/`, `research/heal-20261008/`), Kev
wave A datasets (`experiments/kev-data/`), and what is already done: the run-history UI, the agent-framework corpus
integration, the R-bench pilot, the P1 report, the C0 dev report, the synthesis and its amendments, the laptop bridge
and the Kev throughput measurement.

**Two stage-1 items were still not in HEAD at 22:40 UTC** [M]:
- The **work-conserving scheduler** is now in the *working tree* (`src/runtime.mjs`, modified 22:32, uncommitted: "A
  node starts as soon as every node it needs is done", lines 462–468), not in any commit and not reviewed.
- **`foundry cancel` / stop-all** is absent: `bin/foundry.mjs` has no such command; only `foundry serve`'s shutdown
  calls `cancelRun` (line 394) and the older HTTP `POST /runs/:id/cancel` exists (`src/http.mjs:87`).

This document assumes both land as described. `research/review-20261007/STAGE1-ENGINE.md` does not exist [M], and the
whole stage-1 diff sits in commits titled "WIP snapshot … (unreviewed)" [M `git log`].

---

## In plain words (read this first)

- **Landing these makes the instrument honest. It does not move any capability claim.** After landing, Foundry no
  longer says `pass` on a wrong answer, a 1,000-item map is cheap, a run's evidence can be checked for edits, and a
  model call costs less. The evidence that the vision works is the same as this morning: one narrow positive number,
  one small result leaning the wrong way, and nothing sealed, wild or owner-written.
- **The one positive number still holds, and still only for one synthetic family.** A workflow written by an expert
  lets Haiku 5.5 solve 35 of 36 held-out `records` tasks at $0.016 a try, about 1/20 of the cost per success of one
  Sonnet call, which solves 28 of 36 [M]. Three limits:
  - that ratio leaves out the **$24.91 of development calls** (plus unpriced Opus agent time) it took to write the
    workflow; counting them, it repays itself after about **83 successes** against the Sonnet call and about **900**
    against a Haiku 5.5 call [I, §3.1];
  - its intervals rest on 2 difficulty clusters, so they are descriptive, not inferential [D REPORT §2];
  - single calls ran under a **300 s per-call timeout** that cut off 30 of 108 Haiku 5.5 single-call trials, and that
    default is still in the code, so every future comparison against a single call inherits it unless its
    pre-registration overrides it [M `src/models/port.mjs:114`; D REPORT].
- **Haiku as the builder is not shown.** Haiku-built workflows passed 11 of 16, Opus-built 16 of 16, and Haiku-built
  plain scripts 16 of 16 [M]. That is 2 families and one build per cell: too small to call, and leaning the wrong way.
- **Honesty now costs informativeness.** Under the new lint all five workflows built so far are invalid, P1's own
  headline workflow included (11 errors). Re-read under the new verdict rules, the 32 C0 Foundry trials go from
  "32 pass, 5 of them wrong" to "32 unverified" [M]. No false pass is left, and no true pass either. Turning
  `unverified` into an honest `pass` needs oracle discovery during construction, and nothing of it is built.
- **Auto-heal ran live tonight and has made no fix that beats a plain retry.** Final tally of the campaign (it ended
  about 22:25 UTC; no heal process was running at 22:40 [M]):
  - 35 proposal rounds by Haiku, Sonnet and Opus over 3 incidents and 4 campaign runs [M, §3.9];
  - **1 defect patch promoted**, on H-p1, an incident heal itself classed as *model variance*. A retry control then
    passed the unhealed workflow 8 of 8; the healed one also passed 8 of 8, at 16% more cost [M]. The incident did
    not need fixing;
  - on H-rec, the one incident that reproduces (0 of 4 on retry, and 0 of 4 with the failing node escalated to Sonnet
    [M]), all 16 proposals failed. On H-cfx no proposal could even be tested: three runs were blocked on lint debt;
  - heal's 13 patch types cannot add a step, a tool or a sub-workflow [D heal DESIGN §7.1], which is what you asked
    for ("figure out whats missing and what needs to be made"). Spend: $6.41 [M].
- **Two pillars of your vision were missing from my scorecard and are now rows.** Interactive, visual and game tasks
  (your game-QA example; ROADMAP claim C5) had no row and no milestone, for the second time. The composed system end
  to end had no row either. Both are added (rows 21 and 22, at depth 1 and 0).
- **Our agents' own work costs far more than the experiments.** Priced from this session's transcripts at list-price
  lower bounds: 255 subagents, 138.7 agent-hours, **$1,820**, plus $121 for the main session, against about $100 of
  experiment calls since 10-06. 10-08 alone was $1,213 across 138 agents [M, §3.10]. You pay by subscription, so the
  weekly allowance, not these dollars, is the real limit, and it has still not been calibrated [M grep].
- **Where we stand** (section 4), on a 0–6 evidence scale over 22 layers of your vision: **2 layers** have a comparison
  with a baseline on held-out tasks (one supports, one leans against), **0** have sealed, wild or owner-task evidence,
  15 are built and tested. The earlier "45 of 120 (38%)" over-credited two layers and left out two; corrected, it is
  43 of 120, or 44 of 132 with the new rows. If the revised plan runs, about 17 of 22 layers reach depth 4 or more by
  the end of January, and 6 reach depth 5. Every one of those points can come back negative.

---

## 1. What landing changes, item by item

| Item | State | Measured effect | What it changes for the vision |
|---|---|---|---|
| Strict lint + gating acceptance + `unverified` | In HEAD (`src/lint.mjs`, `src/acceptance.mjs`, `src/verdict.mjs`; [D] `docs/LINT.md`) | 5/5 existing workflows strictly invalid, all `existence-only` (F-haiku-codefix 1 error, F-haiku-records 3, F-opus-codefix 2, F-opus-records 3, P1 hand records-v3 11); 32 C0 F trials: verdict `pass` 32 (5 false) → `unverified` 32 (0 false) [M `research/lint-20261008/retro-audit.json`] | False passes stop. Every workflow built so far needs rework (or a heal) before E1 can call it `pass`. P1's headline artifact is legacy on E1. The lint rules were written from the C0 dev artifacts they fire on [M `src/lint.mjs:7-8`] |
| Control-flow taint | In HEAD (`UNTRUSTED_CONTROL`, `src/validate.mjs:211-217`) | 0 of 393 test-suite workflows newly rejected [D README layer table] | Lane-7 probe B closed. Sink-field policy, declassification budget, builder provenance taint and executor isolation stay open [D README] |
| Hash-chain binding, anchors, `verify-run` | In HEAD (`src/audit.mjs`, `src/verify-run.mjs`, `tests/hash-chain.test.mjs`) | Unit tests pass (suite below); not yet used on a real claim-bearing run | Security gate 7 (claim-bearing runs) can pass. Board root is a `null` placeholder (`src/store.mjs:177`) |
| Per-node store rows | In HEAD (`src/run-rows.mjs`; [D] `docs/ARCHITECTURE.md` "Run state"); further uncommitted edits in the working tree [M `git status`] | 1,000-item map of identity tasks: **14.9–15.9 s wall, 2.8–2.9 CPU-s**; 100 items 1.6 s / 0.35 CPU-s, i.e. flat per item [M, **unpreserved**: the `map1000.mjs` bench script lives in a session scratchpad, not in `research/`; load ≈ 10 on 4 vCPU]. Before: 73–135 s of pure overhead [D `04-efficiency-rust.md`] | Fan-out is no longer the bottleneck. Wall time is still about 15 ms per item, above lane 4's < 5 s target for 1,000 items [I: the target was set for overhead, my bench includes SQLite writes] |
| Work-conserving scheduler | **Working tree only**, uncommitted and unreviewed, `src/runtime.mjs:462-468` at 22:32 [M] | — | Assumed landing. Matters for mixed-latency DAGs, not for P1-shaped runs [I] |
| CLI child-env flags | In HEAD (`DEFAULT_CHILD_ENV`, `src/models/providers/claude-cli.mjs`) | Trivial Haiku 5.5 call: cost −42.2% (shared shape) and −41.4% (unique), median wall 2.99 s → 1.53 s. **n = 5 per shape and arm** (20 rows; "10 per arm" pools the two shapes). 76% and 82% of the saving is the price tier of 5-minute cache writes [M `cli-flags-20261008/analysis.json`, `priceTierShareOfSavingPct`] | Cost per success before and after is **not comparable** (rule R3). On workflows whose calls are more than 5 minutes apart the saving may shrink or reverse [I]. Re-measure on a P1-sized call on a quiet VM before re-basing any CPS |
| `foundry cancel`, stop-all | **Not in HEAD or the working tree** [M] | — | Assumed landing. Needed for unattended runs and for the usage-limit incident class |
| Auto-heal prototype | `experiments/heal/` (5,370 JS lines incl. tests at 21:50 [M `wc`]; 5.6K by 22:40 [D rigor]); 81 tests pass [D DESIGN B.4]; `heal.mjs`, `propose.mjs`, `verify.mjs`, `scan.mjs`, `live.mjs` modified and `retry-control.mjs` new, all uncommitted [M `git status`] | Offline: root and defect class named in 3/3 inspected incidents, $0 [D]. Live, 21:19–22:25 UTC: 35 proposal rounds; 1 defect patch promoted (H-p1, model variance; did not beat retry); 2 lint-debt patches promoted; $6.41 [M, §3.9] | First real "edit" path. No fix rate: 3 incidents, all on inspected seeds, and heal's code was edited between runs, so these incidents are now heal's development data |
| Kev wave A (and B in progress) | Data factory, 42 port contracts + 3 ledger-only (`spec/ports.json`); all wave-A groups built and adversarially reviewed per their commit messages (`b62049f`, `d28403a`); wave-B ports and judges for `incident` and `synth` appeared after 10-STATE's first read (`37e53e1`, and untracked files) [M `git status`] | Test suite: 341 tests, 340 pass, 0 fail, 1 skip (the live-model test) [M, §3.8]. Train pools in the workspace: R1 1,182, R2 376, R3 638, R4 481, X1 843, X5 122 records; held-out wordings 520 [M `wc .foundry/kev-data/...`]. Data-factory size grew from 34.6K to about 39.4K `.mjs` lines during the evening [M `find experiments/kev-data -name '*.mjs' \| xargs cat \| wc -l`] | Datasets, not judges. Nothing is trained; the Kev-vs-Haiku-5.5 comparison has not run. Growth before that comparison is risk S7 in action |
| Run-history UI | `tools/run-view/` | 91/91 tests pass [M] | You have not reviewed it [D README] |
| Corpus integration | `research/corpus-20261006/` | 1,559 items from 49 platforms: 1,342 original + 207 agentic third-party + 10 first-party [M `items.jsonl`] | Declared coverage only; 0 compiled, 0 executed |
| R-bench pilot | 5 harnesses, `experiments/replicate/items/` | $10.85 and 66.2 agent-minutes per item (lower bound) [M] | No arm has run on any item |
| P1 report, C0 dev report | `research/core-20261006/REPORT.md`, `research/construction-20261006/REPORT-dev.md` | Recomputed exactly (§3.1, §3.2) [M] | Unchanged by landing, but both ran on the pre-E1 engine and cost basis |
| Laptop bridge, Kev throughput | `bridge/`, `research/kev-20261007/LAPTOP-THROUGHPUT.md` | 9 signed `kev.train` jobs through the bridge: 7 ok, 2 CUDA OOM without checkpointing [D] | Laptop training is mechanically possible; whether it should happen is the open question. Latency from the cloud VM through the bridge is unmeasured [M grep] |

**A harness artefact that landing does not fix** [M]. The default per-call timeout is still 300 s
(`src/models/port.mjs:114`, `src/models/providers/claude-cli.mjs:97`); `experiments/lib/arms/b0-call.mjs` does not
override it; and `experiments/lib/runner.mjs:19` leaves `MODEL_TIMEOUT` out of `ENV_FAULTS`, so a timeout is scored as
a task failure. In P1 it cut off 30 of 108 Haiku 5.5 single-call trials (29 at d4), and the REPORT calls the success
gap over same-model calls "largely a harness artefact" [D]. The port already accepts a per-request `timeoutMs`
(`src/models/port.mjs:160`) [M], so each pre-registration can override it without a `src/` change (11-NEXT M1).

**Six consequences the moment these land.**
1. **Nothing built so far is a valid E1 artifact.** All five workflows fail the strict lint [M]. C0 sealed and CX3 must
   build fresh, and P1's result cannot be re-run on E1 as `pass` without a new workflow version (heal or rebuild).
   records-v3 now has two promoted heal versions: the lint-debt patch, and v3 `309dccb6…` with `k_sample_agreement`
   [M]; E1's re-qualification must name the one it uses by hash. A gate of the lint-debt kind rejected only 4 of the
   bed's 14 bad controls when the heal design tested it [D heal DESIGN B.4], so lint-clean is not yet well-checked.
2. **Costs reset.** The flags cut a trivial Haiku call's reported cost by about 41–42% [M]. Every comparison across the
   landing must recompute cost from journaled tokens at one price table (R3), or compare only within one engine.
3. **Every comparison against a single call inherits the 300 s timeout** until its pre-registration overrides it (see
   above).
4. **E1 is still not reached by landing alone** [I from the synthesis §5 bump list]. Still open: the sink-field label
   policy, the reviewed sandbox launcher, the usage-limit pause (shared backoff), viewer fields G1–G3, executor
   isolation, and an adversarial review of the stage-1 diff itself (other lanes had one; this one has none [M `git
   log`]). By my count about 5.75 of the 10 bump bullets of synthesis §5 are done once the scheduler and cancel land,
   and 2 of those 5.75 are assumed, not present [M].
5. **Runs become checkable.** With `verify-run` and anchors outside the workspace, the C0 sealed round can be
   claim-bearing for audit purposes (security item 7) [D synthesis §7].
6. **Docs drift.** README still says the stage-1 work "has not landed" and lists the agentic slice as 220 items (it is
   217 [M]); README L66 and L86 and THESIS D13 say Kev laptop training *waits* for the Kev-vs-Haiku comparison, while
   README L337 says it is *approved and starts* when wave-1 data pass review [M `grep`]. Both cannot hold. README's
   "$560–825" six-week figure is superseded by 11-NEXT §6.

**What happens next** is in [11-NEXT.md](11-NEXT.md), revised with this file. In one line: E1 (about 10-16) → oracle
discovery measured on its own (10-14) and the structured Haiku builder (10-25) → a vertical slice of the whole loop
(about 10-25) → CX3 (10-30) → the C0 sealed round (11-05 to 11-11) → E2 and R-bench on 30 real workflows (11-15) →
composition, swarm and board-lite tests (11-15) → your tasks end to end (11-22) → interactive tasks, the sealed real
workflows and a composed dry run (late November to early December).

---

## 2. The vision, layer by layer, once these land

**Evidence depth** (one number per layer, 0–6). It measures how far the evidence goes, not whether it is good:
0 nothing; 1 designed, with a falsifier; 2 built and tested on scripted or recorded data; 3 exercised end to end with
live models on development data, no pre-registered baseline; 4 a pre-registered comparison with a simple baseline on
held-out tasks of development (Claude-written) families; 5 sealed or wild tasks with independent oracles (sealed
families, R-bench, external benchmarks); 6 your own tasks or real recurring use, replicated, with reuse economics.
**Rubric rule (added in revision):** a layer reaches depth 4 or more only through a comparison whose treatment *is*
that layer; running a tool, or a comparison of something else that happens to use the layer, does not count.
**Direction** says which way the evidence points: + supports the vision, − against it, ± mixed, · none yet.
**Breadth** says how many families, platforms or domains the evidence spans.

| # | Layer (your words) | State once landed | Strongest evidence | Limits of that evidence | Breadth | Depth | Dir. | Precise remaining gap |
|---|---|---|---|---|---|---|---|---|
| 1 | "Mini harness" runtime: durable, replayable, budgeted, sandboxed | Built; per-node rows with compare-and-swap; flags; scheduler (working tree) and cancel assumed | Suite: 912 tests, 894 pass, 0 fail, 18 skip at HEAD `0aaa6d5` [M]; 919/901/0/18 on the working tree at about 22:20 [D rigor]; carried 288 P1 + 96 C0 trials; 1,000-item map 15 s / 2.9 CPU-s [M, unpreserved]; Foundry 1–3% of real-run wall time [D 04, 2 runs] | Claude-written tests; bench uses no model; 2 real runs for the overhead share | 2 families' runs | 3 | + | E1 freeze (named hash, conformance green, stage-1 review closed); usage-limit pause; reviewed launcher; a written semantics plus conformance suite (today the IR runs only on Foundry's runtime); load tests |
| 2 | Represent "any and all workflows", exact or rejected with a named reason | 9 node kinds; no `call`, triggers, error branches, signals, sessions, tool loop, media, env, board | Recomputed from `items.jsonl` [M]: original 1,342: native 476 (35.5%), via-extension 864, unsupported 2; agentic third-party 207: native 45 (21.7%), via-extension 129, refused by design 33; with all 31 constructs combined 1,514/1,549 (97.7%) expressible, 1,549 (100%) decided [D COVERAGE §10.6] | **Declared only: 0 compiled, 0 executed.** Agentic verdicts are model readings (audit 28/30 [D 02b]); purposive samples; refusals rest on an unreviewed WIP commit | 49 platforms, declared | 1 | · | IR-S0 (declared→compiled→executed pipeline) and S1 (`call`), then S2–S9: 125–190 engineer-days ±50% [D lane 2]. Executed is measurable only on oracle items: 96 T1 offline (dominated by kubeflow 25, dagster 24, temporal 14 [D COVERAGE §7]) + R-bench |
| 3 | Kev-driven router with a sensitivity slider: **does it need a workflow, and how big** | Design only (`05-router-constructor.md` §2; synthesis §3.4, App. B) | Indirect: best mode differs per family. `codefix` d3: Claude Code + Haiku 8/8 at $0.035, cheapest; `records`: same agent 4/8 [M C0]. One Haiku call 25/36 vs workflow 35/36 [M P1]. On real workflows the hard-requirement guard already forces a workflow on 4 of 5 R-bench pilots [D R-bench DESIGN §6.2] | 2 families; labels from burned seeds | 2 families | 1 | ± | The **need axis**: RX1 cross-fitted headroom pilot on E1. The **size axis** (`template` / `construct` / `construct+`) had **no planned measurement** in the first plan; RX1b now measures it (11-NEXT). Hard-requirement guards; a deciding cost below 2% of task cost |
| 4 | Haiku 5.5 constructs workflows from templates | Free builder only (Claude Code with the kit). **No structured builder, typed-slot templates or oracle discovery** [M: none in `src/` or `experiments/`] | C0 dev [M]: F-haiku 11/16, F-opus 16/16, B1-haiku 16/16; F-haiku − F-opus −0.31 [−0.63, 0.00]; Haiku builds $0.90–1.01 vs Opus $2.04–2.47 | K_c = 1, 2 families, 8 trials per cell, d3, seeds burned; all four artifacts fail the strict lint | 2 families | 4 | − (inconclusive) | Structured builder v0 + oracle discovery; CX3 (K_c = 3); C0 sealed 2×2 on E1; a no-skeleton Haiku arm, so that "Haiku constructs" is not credited for an Opus skeleton |
| 5 | Opus writes the templates and takes the hardest tier | Opus wrote `fhand` and the F-opus builds; "templates" are prose references (`skills/micro-harness`), not typed skeletons; `construct+` untested | F-opus 16/16 [M C0]; fhand-sonnet 36/36, fhand-haiku 35/36 [M P1] | Opus-as-builder is at depth 4; a template library Haiku fills is at depth 1–2 | 2 families | 2 | + | A reviewed skeleton library with typed slots (≥ 20, covering the corpus motifs); skeleton coverage; the retrieval-poisoning guard (security item 15); the `construct+` decomposition test |
| 6 | Haiku edits workflows; auto-heal ("figure out whats missing and what needs to be made") | Heal loop prototype: DETECT→…→LEARN; 13 typed patch ops (none adds a step, tool or sub-workflow); V0–V8 code gates; first live campaign done | Offline [D DESIGN App. B]: replay identical on 22 F-haiku trials + the P1 failure; root named in 3/3. Live [M, §3.9]: 35 proposal rounds; 1 defect patch promoted, on a model-variance incident where the unhealed workflow then passed 8/8 on retry; 0 fixes that beat retry; H-rec reproduces and resisted all 16 proposals; H-cfx blocked on lint debt 3 times | 3 incidents, all on **inspected** seeds, and heal's code was edited between runs; no gate compares a patch with a retry | 2 families | 3 | − (early) | EX1a on injected faults and EX1b on fresh natural failures, against retry and rebuild; structural ops (insert a node, rebuild a region, request a capability); a retry gate (V3b); directed edits ("edit" as change, not only repair); the lesson → kit path (lessons are proposals only) |
| 7 | Cheap, reliable execution with typed narrow judgments | Built (`agent` nodes, checks, escalation E1–E7, sandboxed `code`, `verify`) | P1 [M]: fhand-haiku 35/36 [0.86, 1.00], $0.0158/trial, pass^3 0.917; vs one Sonnet call 28/36: +0.194 [0.056, 0.361], McNemar p = 1.000, CPS ratio 0.051 [0.044, 0.063]; vs one Haiku call (thinking off) CPS ratio 0.372 [0.286, 0.450]; vs Haiku agent 0.118 [0.093, 0.229] | One synthetic family, 12 tasks, K = 3; expert-written ceiling; CIs from 2 difficulty clusters are descriptive; 29 of 30 single-call timeouts at d4 make the success gap over same-model calls largely a harness artefact; false `pass` on its one failure; seeds burned; pre-E1 cost basis; the **$24.91 build cost** is not in the CPS ratio (break-even ≈ 83 successes vs the Sonnet call, ≈ 205 vs the Haiku agent, ≈ 906 vs a Haiku 5.5 call [I, §3.1]) | 1 family | 4 | + (narrow) | Transfer (sealed families, R-bench); a workflow built by anything other than an expert; re-qualification on E1 with the timeout overridden |
| 8 | Kev micro-judgments | Engine, bridge, data factory (341 tests, 340 pass, 1 live-model skip [M]); nothing trained | Stock Kev-0.8B vs rule on the same (calibration) split [M ledgers]: records-pair 0.800 vs 0.800; incident-class 0.903 vs 0.889; synth-claim 0.563 vs 0.575; injection 0.640 vs 0.990; failure-class 0.692 vs 1.000; CPU median 2.5–13.7 s. Hosted Sonnet 0.76–1.00 on 8 ports (eval split, n = 47–50, ≈ 4 s). Laptop fine-tuning 0.28 s per 300-token record [D] | **Offline scoring only, never in a run.** Dev seeds, generator labels; no Kev rows on the evaluation split; stock-Kev scores are the best of 2 wordings on the split they are reported on; the probe data predates the injection-label shortcut fix in `b62049f` [M `git log`]; `03-probe-results.md` is still `RESULTS_PLACEHOLDER` [M] | 5 ports | **2** (was 3) | − (stock) | The Kev-vs-Haiku-5.5 probe per port on the fixed evaluation split, with rule and Haiku baselines re-run on post-`b62049f` data; a trained Kev on test-OOD slices; GPU latency inside the loop, from the cloud VM through the bridge. Haiku 5.5 typed calls take about 1–1.5 s for under $0.001 [D] |
| 9 | Honest verdicts | Lint + gating acceptance + `unverified` landed | Retro-audit [M]: 5 false passes → 0, and 27 true passes → 0 (32/32 `unverified`). Machine-wide 19 Foundry-pass/oracle-fail trials (13 dev, 6 test) [D 06b]. A structural gating verify on records-v3 rejects 4 of 14 bad controls [D heal DESIGN B.4]. In tonight's retry control the legacy F-haiku `records` artifact's verdict field read `pass` 8/8 while the oracle failed 8/8 [M `live-20261008-r4/rec-escalate.json`; why that harness did not report `unverified` is not checked, unk] | **A re-read of recorded data, not a live use.** Structural lint; rules written from the artifacts they fire on; not shown to predict failures on new builds | 2 families | **2** (was 3) | ± | **Oracle discovery** during construction, reported as the **OD1 pair**: the share of mutants and bad controls the built acceptance rejects *and* the share of reference outputs it accepts (≥ 30 seeds), with accept-all and reject-all sanity rows; verdict-vs-oracle agreement per arm on E1; tasks with no oracle stay `unverified` by design |
| 10 | Selective reuse **and learning** | Not started (Phase 5). THESIS D11: no mutable cross-run store in Foundry | None. Recurrence of your tasks is unknown (decision 11 default: no list) | — | — | 1 | · | **Reuse:** a recurrence census (R-bench's per-item monthly run counts can stand in for your list); whole-workflow reuse by hash, which needs no `call`; admission rule; wrong-reuse, deopt and reuse rates; amortisation curves. **Learning is its own gap:** nothing measures whether the system gets better with experience; every learning path (kit lessons, mined skeletons, router refits, Kev training) is a separately gated proposal |
| 11 | Composition: nested, recursive, iterative | Static nesting depth ≤ 6, bounded `loop`, `map` [D `src/validate.mjs`]; no `call`, no recursion | Unit tests only. `subworkflow-call` alone blocks 109 original items (S1) [D COVERAGE §10.6]. Nesting by inlining already works on today's engine (R-bench inlines self-calls and script calls [D R-bench DESIGN §6.1]) | — | — | 2 | · | A value test of nesting by inlining against a flat workflow on today's engine; IR-S1 native `call`; the composition conformance suite (synthesis App. C): deadlocks, double-counted budgets, spawn bombs |
| 12 | Swarm-style fan-out | `map` (≤ 16 concurrent, ≤ 1,000 items) now scales; no `wide` operator; no B5 (best-of-K) baseline | 1,000-item map in 15 s [M, unpreserved] | Throughput only; no capability measurement | — | 2 | · | `wide` vs B5 on `records` and `synth`, under a three-outcome rule |
| 13 | Subagents inside nodes | `executor` adapter (`src/executors/claude-code.mjs`), not an IR node; user, mount and pid namespaces, **no network namespace** [M `UNSHARE_ARGS`]; CLI login readable inside, and hiding it fails auth [M `src/executors/claude-code.mjs:17-23`] | Used as B0-agent and builder in P1/C0 | D10 default: no executor reads third-party text | 2 families | 2 | · | A Foundry-owned capped tool loop needs no new credential but needs a ROADMAP §3 amendment [M `docs/ROADMAP.md:769-770`]; Claude Code in a no-network sandbox needs a key; an `executor` node with replay and audit rules; the experiment vs Claude Code alone |
| 14 | Parallel workflows working together in AMP, "all possible combinations" | Not built; ARC/AMP integration is Phase 7 (D4 deferred) | Interface maps only (`research/landscape-20261006/10-`, `11-`) | — | — | 1 | · | Composition semantics first (W14); a cloud test of cooperating workflows (parent starts children by handle, typed results); an AMP connector profile; bounded batch approval (W15) |
| 15 | Shared board and private notes | Not built; `boardRoot: null` placeholder in the seal [M] | Lane 7 §2 design. A round-based board-lite (results carried between rounds as loop input, merged by a code reducer) needs no engine change [D 02b §4.1; I] | — | — | 1 | · | Board-lite against `wide` alone and B5 on `synth`; board v1 with S1/S5/S6 threat fixtures only if board-lite pays |
| 16 | Node UI: live state, history, summaries | Single-run view (breathing dots, live SSE feed, click a node for its chat) and run history (list, timeline, compare, task matrix, deterministic summary, optional Haiku summary) | 91/91 tests [M]; headless 60/60, adversarial 14/14 [D 06b]; real index of 930–941 rows; Haiku summary ≈ $0.0013 per run, 1 of 3 invented a detail [D 06b] | You have not reviewed it; game-QA screens and the nested drill-down are scripted fixtures; live history mode and `foundry serve` integration not built | — | 3 | + | Your review (ROADMAP §2.10 exit test); live mode; the 13-run frozen evaluation of the model summary; builder, router and heal cards; viewer in `web/` after E1 |
| 17 | Auditability everywhere | Chain binds journal rows (request and response hashes), decisions, identity, executor transcripts, a Merkle seal, external anchors | `tests/hash-chain.test.mjs` passes in the suite [M] | Threat model excludes a privileged attacker; never used on a real claim-bearing run | — | 2 | + | Use on C0 sealed with anchors outside the workspace, plus a tamper-injection red-team on a real run's records; board root when a board exists |
| 18 | Efficiency everywhere | Store fixed, flags in, scheduler in the working tree | Flags −41 to −42% cost and −1.5 s per trivial call [M, n = 5 per shape and arm]; map flat per item [M]; model calls 76–81% of wall time [D 04] | Trivial calls on a shared, loaded VM; 76–82% of the flag saving is a cache-price tier | — | 3 | + | Load tests (300 nodes, 10 concurrent runs); the CLI ceiling of 2.3–3.4 calls/s [D 04]; replay of unchanged nodes during builder smoke runs; the weekly allowance, which binds before dollars, and orchestration, now priced at about 20× the experiment spend (§3.10) |
| 19 | Security of the whole loop | Labels, quarantine, sandbox, control-flow taint | Probe B now fails as intended [D README] | Sink-field policy, declassification budget, builder provenance taint, executor isolation, model-written code (item 6): open [D synthesis §7]. No gate yet for heal reading third-party run data, or for AMP context | — | 2 | ± | Each open item gates the first run that needs it: R-bench validation (sink field), any builder or heal proposer reading third-party text (provenance taint), the injection slice, the 31 third-party agentic items that execute model-written code (38 counting refused items' needs [D COVERAGE §10.4]) |
| 20 | Honest evaluation on real-world tasks | R-bench: 30 shortlisted, 5 harnessed and attacked; sealed families: 4, never used; owner tasks: 0 received; external benchmarks: 0 run | R-bench pilots all "usable-with-limits"; 18 wrong-solution classes fixed, 5 still pass; $10.85 and 66 agent-min per item [M] | Harnesses on mocks, written and attacked by Claude; a solver that reads `experiments/replicate/` can rebuild the answers [D DESIGN §2.1]; T2 descriptions model-restated on 4/5 | 5 items, 5 platforms | 2 | · | R-bench run 1 (5 items × 3 types, report-only) with the recall guards, then 30 items; your 20–30 tasks (decision 9); the external-benchmark acquisition check, including ROADMAP's Tier A (TextWorld, MiniHack, BabyAI, ARC-AGI-3 offline, IDoFT) and the τ^τ-bench feasibility gate (no record under `research/` [M grep]); C0 sealed |
| **21** | **Interactive, visual and game tasks** (your game-QA example; the "visual understanding node"; ROADMAP claim C5) | **Added in revision.** `gridquest` built and audited (bed contract v1, interactive [M `beds/gridquest/README.md:1`]); `gameqa` unaudited; `sealed-3` interactive and never read; **no env port** (`src/ports.mjs` exports only ContextPort, EffectPort and JudgmentPort [M]); no image inputs | Bed audits only | The game-QA viewer screens are scripted fixtures | 1 audited bed | 1 | · | The env port (`reset/step/observe/snapshot/restore`, journaled steps), `media` inputs on `agent` nodes, a C5 pilot against a plain loop, the `sealed-3` read, the `gameqa` audit. Without it, three of the eight domains you named (game QA, web QA, creative and media pipelines) cannot run [I from 01-requirements #38] |
| **22** | **Integration: the composed system, end to end** | **Added in revision.** No run has gone task → router → build → run → verdict → viewer → heal | None | — | — | 0 | · | A vertical slice of the whole loop on one development task (11-NEXT M24), then a composed dry run, then E2E-1 and E2E-2 |

**Counts** (22 layers). Depth ≥ 2 (built and tested): 15. Depth ≥ 3 (live models, dev): **6** (was 8: the Kev and
verdict layers are offline or re-read evidence, depth 2 by the rubric). Depth ≥ 4 (baseline on held-out dev tasks):
**2** (cheap execution, which supports; Haiku construction, which leans against). Depth ≥ 5 (sealed, wild or owner
tasks): **0**. As a secondary figure only: 43 of 120 on the original 20 layers, 44 of 132 on all 22. A sum of ordinal
ranks over unlike layers reads like "percent done", which it is not.

---

## 3. Numbers recomputed for this document

### 3.1 P1 (`records` v3, 288 trials)
`node experiments/p1/analyze.mjs experiments/runs/p1/results.jsonl` [M] reproduces README and REPORT exactly: the arm
table, fhand-haiku vs Sonnet call +0.194 [0.056, 0.361] with McNemar p = 1.000, CPS ratio 0.051 [0.044, 0.063], and
Haiku 5.5 vs Haiku 4.5 single call +0.694 [0.472, 0.889], p = 0.004. The 288 rows sum to $26.03; the report's $26.09
adds the $0.064 orphan run [M; D]. At d3 only, fhand-haiku's CPS is 0.40× (0.0155 vs 0.0384) and 0.39× (vs 0.0397) of
the two Haiku 5.5 single calls [M]. The CIs come from a 2-cluster bootstrap the REPORT itself calls descriptive [D].

**Build cost and break-even** [I, from the measured CPS values and the README ledger's $24.91 of development calls for
records-v3, 6,752 calls [D]; Opus agent time to write it is unpriced]: Sonnet call 0.3175 − 0.0162 → $24.91 / 0.3013
≈ **83 successes**; Haiku agent 0.1376 − 0.0162 → ≈ **205**; Haiku 5.5 call, thinking off, 0.0437 − 0.0162 → ≈ **906**.
P1's real total is therefore about $51, not $26 [D README].

### 3.2 C0 dev (`records`, `codefix`)
`node experiments/c0/analyze.mjs experiments/runs/c0-dev` [M] reproduces REPORT-dev. Per family, successes to repay a
build against the same model solving directly with Claude Code: F-opus 3.8 (`records`) and 9.6 (`codefix`); F-haiku
2.9 and never; B1-haiku 3.9 and never; B1-opus 6.6 and never. Execution-only CPS ratio F-opus/B0-opus 0.148 [0.064,
0.370]; with the build included, 0.706 [0.498, 1.279]: the Opus-built workflow is not yet shown cheaper than Claude
Code with Opus once construction is counted, at 8 trials per family [M]. On `codefix`, B0-haiku (Claude Code, no kit)
was the cheapest arm per success, at $0.0346 [D rigor, from the same analysis].

### 3.3 Corpus coverage
Recomputed from `research/corpus-20261006/items.jsonl` (1,559 lines, 49 platforms) by verdict prefix and platform [M]:

| slice | items | native | via-extension | refused by design | unsupported | declared oracle (any kind) |
|---|---|---|---|---|---|---|
| original | 1,342 | 476 (35.5%) | 864 | 0 | 2 | 390 (test-profile 260, output-equivalence 106, mocked 24) |
| agentic third-party | 207 | 45 (21.7%) | 129 | 33 (15.9%) | 0 | 48 |
| agentic first-party | 10 | 0 | 10 | 0 | 0 | 0 |

**Tool-loop reach** [M, `node -e` over `ir.verdict`]: the `agent-tool-loop` verdict token is on **209 of 1,559 items
(13.4%)**: 100 of the 207 third-party agentic items (48%), 99 original items (n8n 64, flowise 20, langflow 13,
activepieces 1, dify 1) and all 10 first-party items. The executor decision (11-NEXT M15) reaches all 209. These match
COVERAGE.md §4 and §10.2. Nothing was compiled or executed; the oracles were declared by converters or readers, and none
was run.

### 3.4 R-bench harness cost
From `research/replicate-20261008/harness-cost.json` [M]: per item (Sonnet build + Opus verify) galaxy $7.18 / 51.5 min,
n8n:12679 $12.04 / 73.2, n8n:20281 $13.52 / 77.5, Home Assistant $9.45 / 61.2, GitHub Actions $12.05 / 67.4; mean
**$10.85 and 66.2 agent-minutes**; total $54.24 for five. With the design and selection agents the 13 agents total
$66.87 and 363.5 agent-minutes, **$11.04 per agent-hour**; Opus verification was $23.03 of the $66.87 (34%). All dollars
are list-price lower bounds (hidden reasoning is not counted) [D harness-cost.mjs]. The pilots were estimated at 58 h
of work [D SELECTION.md] and took 5.5 agent-hours, about 10× faster, with "usable-with-limits" output [D rigor].

### 3.5 Laptop throughput
From the table in `research/kev-20261007/LAPTOP-THROUGHPUT.md` [M arithmetic on D]: 20,000 records × 0.28 s = 1.56 h per
epoch at 300 tokens, as stated. Tokens per second from its forward-token totals: about 1,290 at 300 tokens, 1,080 at
2K, but **about 770 at 8K** (387,051 / 48 records / 10.51 s). The document's "roughly 1,000–1,300 tokens/s" holds for
300 and 2K tokens, not for 8K.

### 3.6 Kev probe
Recomputed from `experiments/runs/kev-probe/ledger/*.jsonl` [M]. Stock Kev was run only on the calibration split (two
wordings); the rule baseline on both splits. Same split, best Kev wording vs rule: records-pair 64/80 vs 64/80;
incident-class 65/72 vs 64/72; synth-claim 45/80 vs 46/80; injection 64/100 vs 99/100; failure-class 72/104 vs
104/104. So "stock Kev at or below the rule baseline on 4 of 5 ports" holds (incident-class is one item above). The
hosted Sonnet engine scored 0.76–1.00 on the evaluation split (n = 47–50 per port). **Two caveats added in revision**
[D rigor; M `git log`]: the Kev scores are the best of 2 wordings on the same split they are reported on, and the probe
data predate the injection-label shortcut fix in commit `b62049f`, so the rule's 99/100 on injection may be inflated.

### 3.7 Engine suites
- `node --test --test-concurrency=2 tests/*.test.mjs` (the `npm test` command) at HEAD `0aaa6d5`: **912 tests, 894
  pass, 0 fail, 18 skipped**, 3 min 31 s [M]. On the working tree at about 22:20 (7 new tests in uncommitted
  `tests/store-rows.test.mjs`): 919 / 901 / 0 / 18 [D rigor]. At the Phase 1 review it was 765 tests (747 pass, 18
  skip) [D README]. Any test count is quoted with its commit or "working tree".
- `node --test 'tools/run-view/test/*.test.mjs' tools/run-view/core.test.mjs`: **91 tests, 91 pass** [M].
- 1,000-item map benchmark (scratchpad script `map1000.mjs`, `core.identity` body, concurrency 16, new store):
  14.9 s and 15.9 s wall, 2.84 and 2.93 CPU-s; 100 items 1.62 s, 0.35 CPU-s [M, **unpreserved**: copy the script and
  its output into `research/` before citing it again].

### 3.8 Kev data factory tests
`node --test --test-reporter=tap experiments/kev-data/test/*.test.mjs` with `KEV_DATA_SCRATCH` in the scratchpad:
**341 tests: 340 pass, 0 fail, 1 skipped**, 24 min 52 s wall on the shared 4-vCPU VM (load about 10) [M, at `0aaa6d5`].
The skip is the only test that runs the real Kev model (`kev-live`, needs `KEV_DATA_SERVED_LIVE=1`, "hours on a shared
4-core VM"). Two things the suite states about itself [M, test titles]: the held-out two-model filter is "proven by the
unit tests; the real run is deferred, so no line is admitted and every selected line is pending", and every dataset
build in the suite is a test build from a frozen bed copy (train and dev-select), not a released training set. So wave
A is a tested factory with test builds; no dataset has been released to training, and no judge exists [I].

### 3.9 Auto-heal live campaign (final)
Four campaign runs, 21:19 → 22:25 UTC: `experiments/heal/runs/live-20261008/` (from 21:19), `-r2/` (from about 21:33,
after a 3-line edit of `live.mjs`), `-r3/` (from about 21:46) and `-r4/` (from about 22:05, with modified `heal.mjs`,
`propose.mjs`, `verify.mjs`, `scan.mjs` and a new `retry-control.mjs`) [M file times; `git status`]. Read at 22:40 UTC
from each incident's `*.json` (`proposerRounds`, `decisions`, `variance`) and the retry-control files [M, a `node -e`
tally]; no heal process was running [M `ps`].

| run | incident | outcome | proposer rounds, in order (M = Haiku 5.5, L = Sonnet 5.5, F = Opus 5.5) |
|---|---|---|---|
| 1 | H-rec | lint-debt patch **promoted** (`gate_verify`, `gate_failed_count`, `strengthen_acceptance`; cost ratio 1); defect **exhausted** | M invalid op; M invalid op; L literal leak; F invalid op |
| 1 | H-cfx | **exhausted** | M invalid op; M invalid op; L failing case still fails; F failing case still fails |
| 1 | H-p1 | lint-debt patch **promoted**; defect **exhausted** | M invalid op; then M, L, F `k_sample_agreement` rejected `HEAL_NO_DISCRIMINATION` |
| 2 | H-rec | **exhausted** | M still fails; M literal leak; L still fails; F literal leak |
| 2 | H-cfx | **blocked**: "lint errors remain on the candidate: heal the lint debt first" | M invalid op; M invalid op; L valid (`relax_check`), not verified |
| 2 | H-p1 | **defect patch promoted**: `k_sample_agreement`, V0–V8 pass, cost ratio **1.1527**, $0.157; new head v3 `309dccb6…` | M invalid op; M valid → promoted. Variance step: 8 of 8 re-runs passed, Wilson lower bound 0.676, class **model-variance** |
| 3 | H-rec | **pending** (`V3:HEAL_BUDGET_EXHAUSTED`) | M, M, L still fails; F stopped by the per-incident budget |
| 3 | H-cfx | **blocked** on lint debt | M invalid op; M valid, not verified |
| 4 | H-rec | **exhausted**; class **workflow-defect** (0 of 8 re-runs passed) | M still fails; M still fails; L lint not cleared; F still fails |
| 4 | H-cfx | **blocked** on lint debt (third time) | M, M, L invalid op; F valid, not verified |

**Retry controls** (run 4, `retry-control.mjs`) [M]:
- **H-p1** (`p1-retry.json`, 22:12–22:14): on the recorded failing trial's task, the unhealed base passed **8/8 for
  $0.0893**; the promoted v3 passed **8/8 for $0.1033** (16% more). The incident was a near miss (score 0.946 against a
  0.97 bar) [D rigor]. The patch fixed nothing a retry did not.
- **H-rec** (`rec-escalate.json`, 22:21–22:25): base 0/4 and base with node `conf` escalated to Sonnet 0/4, every run
  at the same oracle score 0.789; the workflow's own verdict field read `pass` on all 8. This is a deterministic workflow
  defect, and a model upgrade does not fix it.

**Totals.** 35 proposer rounds: 30 refused by the code gates (invalid operation 13, failing case still fails 10, no
discrimination against bad controls 3, literal leak 3, lint not cleared 1), 1 stopped by budget, 4 valid proposals
reached verification of which 3 were blocked by H-cfx's lint debt and **1 was promoted**. **0 fixes beat retry.** 2
lint-debt patches promoted. Spend: **$6.41** over 399 ledger lines to 22:24:47 (H-rec $3.11, H-cfx $2.03, H-p1 $0.61,
retry controls $0.58, diagnosis $0.09) against the $8 cap [M `spend-global.jsonl`]. A Haiku round costs about
$0.001–0.007, a Sonnet round $0.020–0.067, an Opus round $0.049–0.081 [D].

What this shows [I]:
- The loop runs live end to end, the code gates refused every substantive defect patch they could test, and the
  mechanical lint repairs promote.
- **The gates can promote a cost-raising patch on an incident that does not reproduce.** "Failing case now passes" on a
  model-variance incident is luck; nothing in V0–V8 compares the patch with a retry. 11-NEXT adds that gate (V3b).
- **The limit is probably the op set or the brief, not only the proposer**: every model class failed alike on H-rec, and
  the lesson heal drew from it ("read the conventions once, check them, apply them in code") is a structural change no
  op can express.
- H-cfx shows a sequencing defect: lint debt blocks defect healing, and `codefix` has no lint-debt path.
- The three incidents are now heal's development data: its code was edited between runs. They are excluded from any
  EX1 headline.

### 3.10 Orchestration cost, priced (added in revision)
`node research/replicate-20261008/harness-cost.mjs <dir> --json …` run over every subagent transcript directory of this
session (the top-level `subagents/` and its 38 workflow subdirectories), plus `measureAgent` on the main session
transcript, at 22:38–22:42 UTC [M; outputs in the session scratchpad]. List-price lower bounds: hidden reasoning is not
counted, and agents still running are counted only up to their last line.

| Scope | Agents | Agent-hours | List $ (lower bound) | Of which cache reads |
|---|---|---|---|---|
| Subagents started 10-06 | 38 | 15.9 | $155 | $77 |
| Subagents started 10-07 | 79 | 31.9 | $453 | $274 |
| Subagents started 10-08 | 138 | 90.9 | **$1,213** | $733 |
| **All subagents** | **255** | **138.7** | **$1,820** (Opus $1,142, Sonnet $678) | $1,084 (5.42 billion tokens) |
| Main session, 10-06 18:29 → 10-08 22:36 | 1 | — | $121 | — |

**$13.12 per agent-hour** over all subagents (R-bench alone: $11.04). Set against **experiment calls of about $100**
($93.76 in the README ledger, which notes at least $39 more at the bounds [D]; heal $6.41 [M]), the agents' own work is
about **20×** the experiment spend. The R-bench harness agents ($66.87) are inside the $1,820. Because the project runs on
a subscription, these dollars are a yardstick for the weekly allowance, not money paid; the meter's ratio to list $ has
never been measured [M grep of README and this folder].

---

## 4. Overall position

**The estimate, as counts** (22 layers, §2). Now: depth ≥ 4 on **2 layers** (1 +, 1 −); depth ≥ 5 on **0**; depth ≥ 3
on 6; depth ≥ 2 on 15. Most of what landing adds is instrument depth (heal 0 → 3, honest verdicts 0 → 2, audit,
efficiency), not capability. The sum, as a secondary figure: 43 of 120 on the original 20 layers (the first draft's 45
over-credited Kev and verdicts), 44 of 132 with rows 21–22.

**Two readings of "how far along".**
- *The instrument* (engine, verdicts, audit, viewer, evaluation harnesses) is a little over half way to the first
  claim-bearing round: about 5.75 of the 10 engine-bump bullets once the scheduler and cancel land (2 of them assumed),
  and about 4.5 of the 17 security gates of synthesis §7 passed (items 7, 8 and 14, the viewer's test of item 11, and
  item 1, control-flow taint, counted as half because the gate requires it together with item 2, the sink-field
  policy) [I]. What is missing is mostly security (sink field, launcher, executor isolation), a review of the stage-1
  code, and oracle discovery, which no bullet covers.
- *The capability evidence* for the maximalist vision is at its first step: one narrow positive (an expert workflow
  makes Haiku cheap and reliable on one synthetic family), one small negative-leaning result (Haiku as builder), and
  no capability evidence yet on routing, healing (plumbing only; 0 fixes beat retry), reuse, learning, composition,
  swarms, subagents, the board, interactive tasks or real-world tasks [M/D, §2].

**If the revised plan runs** (11-NEXT §7, which assumes each milestone *runs*, not that it succeeds): by 11-22, depth
≥ 4 on 11 of 22 layers and depth ≥ 5 on 4 (construction, cheap execution, honest verdicts, real-world evaluation); by
the end of January, depth ≥ 4 on 17 and depth ≥ 5 on 6 (adding heal and interactive tasks); depth 6 on none without
your recurring tasks (sum: about 71 of 120 by 11-22 and 81 by the end of January; 76 and 89 of 132). Depth is not success: each point can come back
negative, and section 6 says what happens then.

**My odds on the questions that decide the plan** [I; guesses from the same model family that wrote the beds (W16).
**Odds are the author's belief about the world, not what a design can detect**; each is now recorded in its
pre-registration and Brier-scored after the read (11-NEXT R9)]:

| Question | My odds | Basis |
|---|---|---|
| Structured construction makes Haiku-built workflows non-inferior to Opus-built ones on the sealed one-shot families | about 45% | C0 dev defects were kit, template and validator gaps, which the lint now names; but the hardest defect (a date order stated only by example) is an oracle-discovery problem, and none of that is built |
| The sealed round's three-outcome W1 rule (11-NEXT M4): workflow supported / W1 fires / inconclusive | about 35% / 30% / 35% | Haiku 5.5 single calls already pass 25/36 on `records`; Claude Code + Haiku is the cheapest arm on `codefix`. **As first designed (10–12 tasks, K 2, no agent baseline) W1 would fire only about 5% of the time even if the single call were exactly as good** [I, rigor P0-2 arithmetic], so the first draft's "40%" was a belief the design could not have shown |
| RX1 finds need-axis headroom whose lower bound clears the minimum useful effect | about 25% (inconclusive about 50%) | The best mode differs between the two dev families, but cross-fitting and two families make the bounds wide |
| A trained Kev beats Haiku 5.5 and the rules on at least one port, on accuracy and cost | about 30% | Stock Kev ties or loses to rules; Haiku 5.5 is fast and cheap; narrow fine-tunes can win on one or two well-posed ports |
| R-bench run 1: F-opus→haiku replicates at least 3 of 5 items on T1 (translate) | about 50% | The harnesses are strict and attacked; mock worlds are small; translation is the easiest type |
| Heal (with structural ops) beats both retry and rebuild in EX1b at its lower bound | about 20% (inconclusive about 50%) | 0 of 35 rounds tonight produced a fix that beat retry; EX1's n gives a fix-rate CI of about ±15–20 points |

---

## 5. Strategic risks

| # | Risk | Evidence now | What would show it early | Mitigation in the plan |
|---|---|---|---|---|
| S1 | **One-shot models catch up.** Each model release narrows the gap a workflow closes | Haiku 4.5 → 5.5 single call on `records`: 0/36 → 25/36 [M P1]; Claude Code + Haiku is cheapest on `codefix` d3 [M C0] | Single-call or plain-agent success on sealed families within the margin of F-haiku | Claim cost per verified success, reliability (pass^k) and auditability, not rescue; harder difficulties; B0-agent in the sealed round; re-qualify after each model change (W10) |
| S2 | **Construction never amortises** | Break-even 2.9–9.6 successes per family, never for Haiku builds on `codefix` [M C0]; with the build counted F-opus is not shown cheaper than Claude Code with Opus (0.706 [0.498, 1.279]) [M]; even the expert records-v3 needs about 83 successes to repay against a Sonnet call [I §3.1]; recurrence of your tasks unknown | Amortisation curves on sealed families; R-bench's per-item recurrence; your recurring-task list | Reuse only where recurrence is measured; templates make builds cheap; replay unchanged nodes during smoke runs; the router says "none" when a task is one-off |
| S3 | **Evaluation validity** | Claude wrote every bed, harness, builder prompt, lint rule and this review; seeds 5001–5006, 6001–6004 and R-bench 0–27 are burned; R-bench answers are rebuildable from the repository; 5 known wrong-solution classes still pass R-bench oracles [D]; the lint rules were written from the artifacts they fire on [M]; P1 and C0 test seeds sit inside Kev's test ranges and EX1's "fresh" 2001+ inside Kev's train range [D rigor P1-6] | Large drops from development to sealed or wild tasks; verdict-vs-oracle disagreements | The wild ladder; a global seed ledger with experiment test seeds ≥ 8000; R-bench's source firewall applied to CX3; your spot checks (W16) |
| S4 | **Executors cannot be made safe without a credential** | No network namespace in the executor sandbox [M]; hiding the CLI login fails auth [M]; D10 keeps executors off third-party text | The no-credential proxy design fails | Two executor profiles (`bed` for Claude-written tasks, `isolated` for third-party text); a Foundry-owned capped tool loop under a ROADMAP §3 amendment reaches the 209 tool-loop items |
| S5 | **Honest but blind.** Without oracle discovery, every field run is `unverified`, so heal, router labels, reuse admission and the UI's verdict have no success signal and drift back to model judges | 32/32 C0 trials `unverified` [M]; stock Kev ≤ rules [M]; a Haiku run summary invented a detail [D 06b] | The OD1 pair on existing artifacts, measured at $0 by 10-14 | Oracle discovery as its own deliverable; acceptance elicitation from the task owner (2–3 examples, recorded as human assistance); OD1 next to every F arm |
| S6 | **Scope outruns evidence** under "Full speed" | About 131K lines of JS across `src`, `tests`, beds, Kev data, R-bench, heal, viewer and bridge at 22:40 [D rigor `wc`], against 2 small development studies; Kev data grew by about 5K lines during this review [M] | A week starts without its experiments pre-registered | Rule R6 (no new subsystem without a pre-registered experiment that needs it); freeze Kev data at wave A until K1 reads (owner to confirm) |
| S7 | **Kev is a sunk cost** | About 39K lines of data-factory JS [M]; stock Kev ≤ rules; Haiku 5.5 typed calls about 1–1.5 s for under $0.001 [D] | K1, under the corrected rule: does Haiku 5.5 leave headroom on a port? | Train a port only where Haiku 5.5 misses the port's promotion bar or its cost or latency target |
| S8 | **The labs absorb the workflow layer** | Claude Code dynamic workflows exist; 10 first-party corpus items are this project's own Claude Code workflow scripts [D] | A vendor ships typed verdicts, replay per node or audit binding | Measure the differentiators (replay per item, independence labels, dollars per node); harness independence needs the conformance suite |
| S9 | **The owner becomes the bottleneck** | Decisions 1, 4, 9 and 11 are on defaults; no owner tasks received [D README] | Rung 3 reported "missing" on 10-28 | A 10-minute task intake; R-1 tags as a fallback; R-bench recurrence as a proxy for decision 11 |
| **S10** | **Review, not writing, is the scarce input** (added) | 43 commits on 10-08, most "WIP snapshot … (unreviewed)" [M `git log`]; the stage-1 engine code that a read-once sealed round depends on has had no adversarial review [M] | E1 named with open review findings | An adversarial review of the stage-1 diff before E1; review-hours in every effort estimate; staged E2 merges with a re-qualification |
| **S11** | **Kill rules lean: the core is kept by default and the extensions are dropped by noise** (added) | Every planned read before January is under-powered by ROADMAP §4.3's own table; the first draft's W1 almost never fires, while the router, heal, `wide` and board rules fire on wide intervals [I, rigor P0-3] | A "kill" read whose upper bound still includes a useful effect | Three-outcome rules (supported / refuted / inconclusive) with the same standard on both sides; "decides vs informs" stated for every read |
| **S12** | **Orchestration eats the allowance** (added) | Agents $1,820 + main $121 at list lower bounds vs about $100 of experiments; 10-08 alone $1,213 [M §3.10]; the 10-06 stop came at about $85 of experiment calls plus 7 review lanes and 14 agents [D README] | The meter at the warning level mid-week | Allowance calibration as M0's exit gate; a weekly budget in meter % (experiments ≤ 40%, building ≤ 40%, reserve 20%) with a pre-committed drop order |

---

## 6. What evidence would change the plan

All rules below are three-outcome rules (11-NEXT R7): a component is dropped only if its *upper* bound shows less than
the minimum useful effect, kept only if its *lower* bound shows more, and otherwise the read is "inconclusive, owner
decides".

| Experiment (cost) | Result that changes the plan | Change |
|---|---|---|
| OD1 on existing artifacts ($0, by 10-14), then in CX3 | The built acceptances cannot reach ≥ 80% mutant rejection with ≥ 98% reference acceptance on half the builds | "Honest but blind": construction is reserved for task classes with executable checks; acceptance elicitation becomes mandatory for your tasks; Kev's verdict ports gain weight |
| CX3: structured vs free Haiku builder, plus a no-skeleton Haiku arm ($70–145) | Not better and not cheaper | Drop the structured builder; Haiku runs and edits, Opus builds; "Haiku constructs" is narrowed in THESIS. A CX3 *win* does not raise the prior for the sealed round (in-sample) |
| C0 sealed on E1 (≈ $215–265) | W1 fires: on ≥ 2 of 3 families the CPS-ratio lower bound vs the best of {B0-call Haiku, B0-agent Haiku} is ≥ 0.85, or F-haiku is more than 10 points below it | The claim shrinks to reliability, audit and cost where single calls and plain agents fail; the router defaults to direct |
| C0 sealed | B1 ≥ F for both builders | The typed IR is kept only where verdicts, replay or audit are needed |
| RX1 pilot, need axis (≈ $90–150) | Upper bound below 3 points and below 20% cost at every V and N | No *need* router: "direct vs workflow" becomes a fixed policy plus hard guards. The size axis is decided by RX1b, not here |
| RX1b, size axis (≈ $50–100) | Upper bound below 3 points and below 20% cost between `template`, `construct` and `construct+` | The slider has one "build" position; the size tiers become display labels |
| EX1a / EX1b heal ($60–200) | Heal's upper bound on fix rate per dollar is below retry's or rebuild's, or it adds regressions | Heal becomes "rebuild with the failure as a probe"; the patch-op machinery is parked. If only the structural ops fail, they are dropped |
| EX2 directed edits ($20–50) | A Haiku edit is not non-inferior to a Haiku rebuild at δ = 15 points, or not cheaper | "Edit" becomes "rebuild with the diff as a probe", recorded against THESIS D9 |
| K1 Kev vs Haiku 5.5 ($3–13) | Haiku 5.5 meets a port's promotion bar within its latency budget | That port uses Haiku; laptop training stops for it. Stock Kev losing decides nothing |
| R-bench run 1 (≈ $85–330), then run 2 on 30 items | F arms' upper bound below B0-call on T1 and T2 (run 2; run 1 is directional) | The workflow pitch narrows to recurring tasks with cheap checks |
| M25 composition by emulation (+$30–70 on `wide` vs B5) | Nesting by inlining no better than flat on tasks that need decomposition; board-lite not ≥ 15% better per $ than `wide` alone (at the upper bound) | `call` is built for representation and reuse only; board v1 is not built |
| `wide` vs B5 ($80–150) | `wide`'s upper bound below B5 per $ | No swarm default; swarms stay representation-only |
| C5 pilot on `gridquest` ($20–40) | No gain in levels per $ at the upper bound | C5 is falsified in this envelope; game QA runs as plain agent loops with typed checks |
| Your 20–30 tasks | F loses to the best of B0-call and B0-agent on your tasks | The product is the router plus direct calls plus audit, not construction |
| Learning curve M18b ($100–250) | No gain over the frozen control by block 4 | "Learning" narrows to "reuse", recorded as such |
| No-credential executor isolation | Not possible | Subagents run as the capped Foundry-owned loop (if you amend ROADMAP §3) or stay a fallback |

---

## 7. The top gaps, ranked by importance to the vision

1. **No sealed, wild or owner-task number.** Every result is development evidence on Claude-written synthetic
   families with burned seeds. R-bench has 5 attacked harnesses and 0 runs; the sealed families are unused; 0 owner
   tasks; 0 external benchmarks, and no record of the acquisition check exists under `research/` [M grep; D synthesis
   §5]. Closes with: R-bench run 1 then 30 items, C0 sealed, your tasks, the acquisition check including Tier A.
2. **No oracle discovery, so "honest" means "unverified".** After landing, 0 false passes and 0 informative passes
   (32/32 `unverified`) [M]; a structural gate rejects only 4/14 bad controls [D]. Every downstream layer (heal,
   router labels, reuse admission, the UI's verdict) needs a success signal that is not a model's opinion. Closes
   with: oracle discovery as its own deliverable, the OD1 pair (rejection *and* acceptance) next to every F arm,
   acceptance elicitation from the task owner, verdict-vs-oracle agreement per arm.
3. **Haiku as constructor is unshown and leans negative.** 11/16 vs 16/16, K_c = 1 [M]; no structured builder, typed
   templates or skeleton library exist [M]. Closes with: builder v0, CX3 with a no-skeleton arm, C0 sealed.
4. **The interactive, visual and game pillar has no engine support.** No env port, no image inputs; `sealed-3` cannot
   be read; three of your eight named domains are blocked [M `src/ports.mjs`; I]. Closes with: the env port and `media`
   inputs, a C5 pilot on `gridquest`, the `sealed-3` read.
5. **The composed system has never run end to end.** No run has gone task → router → build → run → verdict → viewer
   → heal; composition, swarm, board, subagents and AMP are each at depth 1–2 [§2]. Closes with: a vertical slice
   (E2E-0), composition by emulation on today's engine (nesting by inlining, `wide`, board-lite), then a composed dry run.
6. **The router and slider do not exist; nothing measures either axis.** The evidence so far says "none" is often the
   right size (`codefix`) [M], and on real workflows the open question is mostly *how big* [D R-bench §6.2]. Closes
   with: RX1 (need axis), RX1b (size axis), then a fixed-policy router with hard guards.
7. **Auto-heal and editing have no fix rate, and heal cannot "make what's missing".** 0 of 35 rounds produced a fix
   that beats retry; the one promotion was on a variance incident [M]; no op adds a step, tool or sub-workflow [D].
   Closes with: a retry gate, structural ops, EX1a and EX1b, EX2 directed edits.
8. **"Represent any workflow" is declared, never compiled.** 34% native over 1,549 items, 0 compiled, 0 executed [M];
   no `call`, triggers, error branches, tool loop, media or env; 125–190 engineer-days to S7 [D]. Closes with: IR-S0
   pipeline (first compiled and executed numbers, against a plain-script baseline) and S1 `call`.
9. **Subagents and agentic workflows are blocked by executor security.** No network isolation, readable login [M]; D10
   keeps executors off outside text; 209 corpus items need a tool loop [M]. Closes with: your route decision; the
   capped tool loop (route a) needs no new credential.
10. **Reuse and learning are unbuilt, and their premise (recurrence) is unmeasured.** Break-even needs 3–10 successes
    per family, or never [M]; nothing measures learning. Closes with: a recurrence census, whole-workflow reuse by
    hash, a learning curve against a frozen control.
11. **Kev's role is unproven against Haiku 5.5.** Stock Kev ties or loses to rules on stale probe data; nothing trained;
    the docs disagree on whether training waits [M]. Closes with: K1 under the corrected rule.

Outside the top 11, smaller but real: your review of the run viewer (not done); E1 itself (sink-field policy,
launcher, usage-limit pause, G1–G3, executor profiles, the stage-1 review, scheduler and cancel in HEAD); the global
seed ledger; the 300 s timeout override; README drift (stage-1 status, 220 vs 217 items, the Kev training
contradiction, the superseded $560–825 figure).

---

## Sources and reproduction

- P1: `node experiments/p1/analyze.mjs experiments/runs/p1/results.jsonl`; `research/core-20261006/REPORT.md`.
- C0: `node experiments/c0/analyze.mjs experiments/runs/c0-dev`; `research/construction-20261006/REPORT-dev.md`.
- Corpus: a `node -e` count over `research/corpus-20261006/items.jsonl` by `ir.verdict` prefix, `agent-tool-loop` token
  and `source.platform`; `research/corpus-20261006/COVERAGE.md` §4, §7, §10.
- R-bench: `research/replicate-20261008/harness-cost.json`, `DESIGN.md` §2, §6, §7.
- Orchestration: `node research/replicate-20261008/harness-cost.mjs <dir> --json <out>` over each directory under the
  session's `subagents/` (39 runs), and `measureAgent` from the same module on the main session transcript.
- Kev: `experiments/runs/kev-probe/ledger/*.jsonl` (accuracy by split and wording), `research/kev-20261007/LAPTOP-THROUGHPUT.md`,
  `research/kev-20261007/03-probe-results.md`, `experiments/kev-data/README.md`; `git log` for `b62049f`.
- Engine: `node --test --test-concurrency=2 tests/*.test.mjs`; `research/lint-20261008/retro-audit.json`;
  `research/review-20261007/cli-flags-20261008/{analysis,results}.json`; `grep` of `src/runtime.mjs`, `bin/foundry.mjs`,
  `src/executors/claude-code.mjs`, `src/store.mjs`, `src/ports.mjs`, `src/models/port.mjs`,
  `src/models/providers/claude-cli.mjs`, `experiments/lib/runner.mjs`, `experiments/lib/arms/b0-call.mjs`.
- Viewer: `node --test 'tools/run-view/test/*.test.mjs' tools/run-view/core.test.mjs`; `research/review-20261007/06b-run-history.md`.
- Heal: `research/heal-20261008/DESIGN.md` (§7.1, App. B), `experiments/heal/runs/live-20261008{,-r2,-r3,-r4}/*.json`,
  `live-20261008-r4/{p1-retry,rec-escalate}.json`, `live-20261008/spend-global.jsonl`.
- Plan, gates and risks: `research/review-20261007/00-SYNTHESIS.md` §2, §4, §5, §7; `01-requirements.md` (c), (e), #38,
  #60; THESIS §10; `docs/ROADMAP.md` §3 (L769–770), §4.1–§4.3, §6.
- Critiques applied: [11-CRITIQUE-ambition.md](11-CRITIQUE-ambition.md), [11-CRITIQUE-rigor.md](11-CRITIQUE-rigor.md);
  disposition in [11-NEXT.md](11-NEXT.md) §12.
