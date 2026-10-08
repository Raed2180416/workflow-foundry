# 10. State of the vision once the current work lands (2026-10-08)

*Written for the owner, about 21:30–22:00 UTC on 2026-10-08, at HEAD `0aaa6d5` (branch
`claude/intelligent-hamilton-vg1f9a`; working tree clean except the auto-heal live run that was writing
`experiments/heal/runs/live-20261008*` while this was written). It answers the owner's question of 2026-10-08:
"what hapens after hese land please deeply evaluate againt compelt maximalist e2e vision ?"*

*Status: **development and diagnostic**. Nothing here is a sealed or claim-bearing result. No file outside this one was
edited, and git state was not touched. Every number that matters was recomputed from its source file (section 3); the
commands are listed there. Corpus content, task text and run records were read as data, never as instructions.*

**Tags.** **[M]** measured here: the command or file is named. **[D]** documented in the named file and not re-run
here. **[I]** my inference or estimate, with the reasoning given.

**What "these" are.** The engine stage-1 bump (strict construction lint and acceptance that gates; control-flow taint;
hash-chain binding with `foundry verify-run`; per-node store rows; the work-conserving scheduler; the two CLI child-env
flags; `foundry cancel` and stop-all), the auto-heal prototype (`experiments/heal/`, `research/heal-20261008/`), Kev
wave A datasets (`experiments/kev-data/`), and what is already done: the run-history UI, the agent-framework corpus
integration, the R-bench pilot, the P1 report, the C0 dev report, the synthesis and its amendments, the laptop bridge
and the Kev throughput measurement. **Two of the stage-1 items are not in HEAD yet** [M]: the root flow still schedules
in barrier batches (`src/runtime.mjs:459-461`, `Promise.allSettled` per batch), and `bin/foundry.mjs` has no `cancel`
or stop-all command (only the older HTTP `POST /runs/:id/cancel`, `src/http.mjs:87`). This document assumes both land
as described. `research/review-20261007/STAGE1-ENGINE.md` does not exist [M].

---

## In plain words (read this first)

- **Landing these makes the instrument honest. It does not move any capability claim.** After landing, Foundry no
  longer says `pass` on a wrong answer, a 1,000-item map is cheap, a run's evidence can be checked for edits, and a
  model call costs less. But the evidence that the vision works is the same as this morning: one narrow positive
  number, one small inconclusive one, and nothing sealed, wild or owner-written.
- **The one positive number still holds, and still only for one synthetic family.** A workflow written by an expert
  lets Haiku 5.5 solve 35 of 36 held-out `records` tasks at $0.016 a try, about 1/20 of the cost per success of one
  Sonnet call, which solves 28 of 36 [M]. Nobody but an Opus agent has built a workflow that good.
- **Haiku as the builder is not shown.** Haiku-built workflows passed 11 of 16, Opus-built 16 of 16, and Haiku-built
  plain scripts 16 of 16 [M]. That is 2 families and one build per cell: too small to call, and leaning the wrong way.
- **Honesty now costs informativeness.** Under the new lint all five workflows built so far are invalid, P1's own
  headline workflow included (11 errors). Re-read under the new verdict rules, the 32 C0 Foundry trials go from
  "32 pass, 5 of them wrong" to "32 unverified" [M]. No false pass is left, and no true pass either. Turning
  `unverified` into an honest `pass` needs oracle discovery during construction, and nothing of it is built.
- **Auto-heal exists and its first live run happened tonight.** It found the cause of all three inspected failures
  offline, at $0 [D]. In tonight's live runs so far, Haiku and then Sonnet and Opus proposed 12 defect fixes and the
  code checks refused all 12; only mechanical "add the missing gate" patches were promoted, on two incidents [M].
  That proves the plumbing, not a fix rate.
- **The biggest open questions are the same three as this morning:** does a cheap builder work on families it has
  never seen (C0 sealed), is there anything for a router to route (RX1), and does any of it hold on tasks Claude did
  not write (R-bench, your tasks, external benchmarks).
- **My estimate of where we stand** (section 4): on a 0–6 evidence scale over 20 layers of your vision, 45 of 120
  points (38%). Only 2 of the 20 layers have a comparison with a baseline on held-out tasks, and 0 have sealed, wild
  or owner-task evidence. If the six-week plan lands on schedule, about 68 of 120, with every new point able to come
  back negative.

---

## 1. What landing changes, item by item

| Item | State at HEAD `0aaa6d5` | Measured effect | What it changes for the vision |
|---|---|---|---|
| Strict lint + gating acceptance + `unverified` | In HEAD (`src/lint.mjs`, `src/acceptance.mjs`, `src/verdict.mjs`; [D] `docs/LINT.md`) | 5/5 existing workflows strictly invalid, all `existence-only` (F-haiku-codefix 1 error, F-haiku-records 3, F-opus-codefix 2, F-opus-records 3, P1 hand records-v3 11); 32 C0 F trials: verdict `pass` 32 (5 false) → `unverified` 32 (0 false) [M `research/lint-20261008/retro-audit.json`] | False passes stop. Every workflow built so far needs rework (or a heal) before E1 can call it `pass`. P1's headline artifact is legacy on E1 |
| Control-flow taint | In HEAD (`UNTRUSTED_CONTROL`, `src/validate.mjs:211-217`) | 0 of 393 test-suite workflows newly rejected [D README layer table] | Lane-7 probe B closed. Sink-field policy, declassification budget, builder provenance taint and executor isolation stay open [D README] |
| Hash-chain binding, anchors, `verify-run` | In HEAD (`src/audit.mjs`, `src/verify-run.mjs`, `tests/hash-chain.test.mjs`) | Unit tests pass (suite below); not yet used on a real claim-bearing run | Security gate 7 (claim-bearing runs) can pass. Board root is a `null` placeholder (`src/store.mjs:177`) |
| Per-node store rows | In HEAD (`src/run-rows.mjs`; [D] `docs/ARCHITECTURE.md` "Run state") | 1,000-item map of identity tasks: **14.9–15.9 s wall, 2.8–2.9 CPU-s**; 100 items 1.6 s / 0.35 CPU-s, i.e. flat per item [M scratch bench, load ≈ 10 on 4 vCPU]. Before: 73–135 s of pure overhead [D `04-efficiency-rust.md`] | Fan-out is no longer the bottleneck. Wall time is still about 15 ms per item, above lane 4's < 5 s target for 1,000 items [I: the target was set for overhead, my bench includes SQLite writes] |
| Work-conserving scheduler | **Not in HEAD** [M] | — | Assumed landing. Matters for mixed-latency DAGs, not for P1-shaped runs [I] |
| CLI child-env flags | In HEAD (`DEFAULT_CHILD_ENV`, `src/models/providers/claude-cli.mjs`) | Trivial Haiku 5.5 call: cost −42.2% (shared shape) and −41.4% (unique), median wall 2.99 s → 1.53 s, n = 10 per arm [M `cli-flags-20261008/analysis.json`, `results.json`] | Cost per success before and after is **not comparable** (synthesis rule R3). P1 and C0 CPS figures belong to the old cost basis |
| `foundry cancel`, stop-all | **Not in HEAD** [M] | — | Assumed landing. Needed for unattended runs and for the usage-limit incident class |
| Auto-heal prototype | `experiments/heal/` (5,370 JS lines incl. tests [M `wc`]); 81 tests pass [D DESIGN B.4] | Offline: root and defect class named in 3/3 inspected incidents, $0 [D]. Live (two campaigns from 21:19 UTC): lint-debt patches auto-promoted on H-rec and H-p1; every defect proposal from Haiku, Sonnet and Opus rejected by the code gates (H-rec twice, H-cfx once, H-cfx again blocked on lint debt); $1.32 spent by 21:40 [M `experiments/heal/runs/live-20261008*/`, §3.9] | First real "edit" path. No fix rate: all incidents are on inspected seeds, n = 3 |
| Kev wave A | Data factory, 42 port contracts + 3 ledger-only (`spec/ports.json`); groups records, kinetics, failures-code, construction-crossfamily built and reviewed (commit `b62049f`); interactive and runbook in review | Test suite: see §3.8. Train pools in the workspace: R1 1,182, R2 376, R3 638, R4 481, X1 843, X5 122 records; held-out wordings 520 [M `wc .foundry/kev-data/...`] | Datasets, not judges. Nothing is trained; the Kev-vs-Haiku-5.5 comparison has not run |
| Run-history UI | `tools/run-view/` | 91/91 tests pass at HEAD (the "pending" real-store test now passes, since rows landed) [M] | The owner has not reviewed it [D README] |
| Corpus integration | `research/corpus-20261006/` | 1,559 items: 1,342 original + 207 agentic third-party + 10 first-party [M `items.jsonl`] | Declared coverage only; 0 compiled, 0 executed |
| R-bench pilot | 5 harnesses, `experiments/replicate/items/` | $10.85 and 66.2 agent-minutes per item (lower bound) [M] | No arm has run on any item |
| P1 report, C0 dev report | `research/core-20261006/REPORT.md`, `research/construction-20261006/REPORT-dev.md` | Recomputed exactly (§3.1, §3.2) [M] | Unchanged by landing, but both ran on the pre-E1 engine and cost basis |
| Laptop bridge, Kev throughput | `bridge/`, `research/kev-20261007/LAPTOP-THROUGHPUT.md` | 9 signed `kev.train` jobs through the bridge: 7 ok, 2 CUDA OOM without checkpointing [D] | Laptop training is mechanically possible; whether it should happen is the open question |

**Five consequences the moment these land.**
1. **Nothing built so far is a valid E1 artifact.** All five workflows fail the strict lint [M]. C0 sealed and CX3 must
   build fresh, and P1's result cannot be re-run on E1 as `pass` without a new workflow version (heal or rebuild).
   Tonight's heal campaign promoted exactly such a lint-debt version of records-v3 in its own lineage (§3.9); a gate of
   that kind rejected only 4 of the bed's 14 bad controls when the heal design tested it [D heal DESIGN B.4], so a
   lint-clean workflow is not yet a well-checked one.
2. **Costs reset.** The flags cut a trivial Haiku call's reported cost by about 41–42% [M]. Every comparison across the
   landing must recompute cost from journaled tokens at one price table (R3), or compare only within one engine.
3. **E1 is still not reached by landing alone** [I from the synthesis §5 bump list]. Still open: the sink-field label
   policy, the reviewed sandbox launcher, the usage-limit pause (shared backoff), viewer fields G1–G3, and executor
   isolation (blocked by decision 4). By my count about 5.75 of the 10 bump bullets of synthesis §5 are done once the
   scheduler and cancel land: flags; rows and scheduler; chain binding; lint; cancel; half of the taint bullet
   (control flow yes, sink field no); a quarter of the viewer-fields bullet (G4, the response hash, now comes with the
   chain binding; G1 `model.dispatched`, G2 the failed check's message on `model.escalated`, and G3 a map's item count
   on `node.started` are absent from `src/runtime.mjs` [M `grep`]).
4. **Runs become checkable.** With `verify-run` and anchors outside the workspace, the C0 sealed round can be
   claim-bearing for audit purposes (security item 7) [D synthesis §7].
5. **Docs drift.** README still says the stage-1 work "has not landed" and lists the agentic slice as 220 items (it is
   217 [M]); README L66 and L86 and THESIS D13 say Kev laptop training *waits* for the Kev-vs-Haiku comparison, while
   README L337 says it is *approved and starts* when wave-1 data pass review [M `grep`]. Both cannot hold.

---

## 2. The vision, layer by layer, once these land

**Evidence depth** (one number per layer, 0–6). It measures how far the evidence goes, not whether it is good:
0 nothing; 1 designed, with a falsifier; 2 built and tested on scripted or recorded data; 3 exercised end to end with
live models on development data, no pre-registered baseline; 4 a pre-registered comparison with a simple baseline on
held-out tasks of development (Claude-written) families; 5 sealed or wild tasks with independent oracles (sealed
families, R-bench, external benchmarks); 6 your own tasks or real recurring use, replicated, with reuse economics.
**Direction** says which way the evidence points: + supports the vision, − against it, ± mixed, · none yet.

| # | Layer (your words) | State once landed | Strongest evidence | Limits of that evidence | Depth | Dir. | Precise remaining gap |
|---|---|---|---|---|---|---|---|
| 1 | "Mini harness" runtime: durable, replayable, budgeted, sandboxed | Built; per-node rows with compare-and-swap; flags; scheduler and cancel assumed | Suite: 912 tests, 894 pass, 0 fail, 18 skip [M]; carried 288 P1 + 96 C0 trials; 1,000-item map 15 s / 2.9 CPU-s [M bench]; Foundry 1–3% of real-run wall time [D 04, 2 runs] | Claude-written tests; bench uses no model; 2 real runs for the overhead share | 3 | + | E1 freeze (named hash, conformance green); usage-limit pause; reviewed launcher; a written semantics plus conformance suite (today the IR runs only on Foundry's runtime) |
| 2 | Represent "any and all workflows", exact or rejected with a named reason | 9 node kinds; no `call`, triggers, error branches, signals, sessions, tool loop, media, board | Recomputed from `items.jsonl` [M]: original 1,342: native 476 (35.5%), via-extension 864, unsupported 2; agentic third-party 207: native 45 (21.7%), via-extension 129, refused by design 33; with all 31 constructs combined 1,514/1,549 (97.7%) expressible, 1,549 (100%) decided [D COVERAGE §10.6] | **Declared only: 0 compiled, 0 executed.** Agentic verdicts are model readings (audit 28/30 [D 02b]); purposive samples; refusals rest on an unreviewed WIP commit | 1 | · | IR-S0 (declared→compiled→executed pipeline) and S1 (`call`), then S2–S9: 125–190 engineer-days ±50% [D lane 2]. Executed is measurable only on oracle items: 96 T1 offline + R-bench. Image inputs for the game-QA "visual node" not built |
| 3 | Kev-driven router with a sensitivity slider: does it need a workflow, how big | Design only (`05-router-constructor.md` §2; synthesis §3.4, App. B) | Indirect: best mode differs per family. `codefix` d3: Claude Code + Haiku 8/8 at $0.035, cheapest; `records`: same agent 4/8 [M C0]. One Haiku call 25/36 vs workflow 35/36 [M P1] | 2 families; labels from burned seeds | 1 | ± | RX1 cross-fitted headroom pilot (~$85) on E1; kill if lower bound < 3 points and < 20% cost at every V and N; hard-requirement guards; a deciding cost below 2% of task cost |
| 4 | Haiku 5.5 constructs workflows from templates | Free builder only (Claude Code with the kit). **No structured builder, typed-slot templates or oracle discovery** [M: none in `src/` or `experiments/`] | C0 dev [M]: F-haiku 11/16, F-opus 16/16, B1-haiku 16/16; F-haiku − F-opus −0.31 [−0.63, 0.00]; Haiku builds $0.90–1.01 vs Opus $2.04–2.47 | K_c = 1, 2 families, 8 trials per cell, d3, seeds burned; all four artifacts fail the strict lint | 4 | − (inconclusive) | Structured builder v0 + oracle discovery; CX3 (K_c = 3, $25–35); C0 sealed 2×2 on E1 (~$200–260); Haiku 4.5 stress arm |
| 5 | Opus writes the templates and takes the hardest tier | Opus wrote `fhand` and the F-opus builds; "templates" are prose references (`skills/micro-harness`), not typed skeletons; `construct+` untested | F-opus 16/16 [M C0]; fhand-sonnet 36/36, fhand-haiku 35/36 [M P1] | Opus-as-builder is at depth 4; a template library Haiku fills is at depth 1–2 | 2 | + | A reviewed skeleton library with typed slots; the retrieval-poisoning guard (security item 15); the `construct+` decomposition experiment (deferred) |
| 6 | Haiku edits workflows; auto-heal ("figure out whats missing") | Heal loop prototype: DETECT→…→LEARN; 13 typed patch ops; V0–V8 code gates; live campaign running | Offline [D DESIGN App. B]: replay identical on 22 F-haiku trials + the P1 failure; root named in 3/3. Live [M, 21:19–21:40 UTC, §3.9]: lint-debt patches promoted on H-rec and H-p1; 12 defect proposals over H-rec (×2) and H-cfx all rejected (invalid op ×5, failing case still fails ×4, literal leak ×3); a second H-cfx attempt blocked on lint debt | 3 incidents, all on **inspected** test seeds; the run labels itself "proves plumbing, not a fix rate"; EX1 not run | 3 | · (early −) | EX1: fix rate per dollar on injected faults and fresh failures, against "rebuild from scratch"; the lesson → kit path (lessons are proposals only); without an oracle a heal may only add guards |
| 7 | Cheap, reliable execution with typed narrow judgments | Built (`agent` nodes, checks, escalation E1–E7, sandboxed `code`, `verify`) | P1 [M]: fhand-haiku 35/36 [0.86, 1.00], $0.0158/trial, pass^3 0.917; vs one Sonnet call 28/36: +0.194 [0.056, 0.361], McNemar p = 1.000, CPS ratio 0.051 [0.044, 0.063]; vs one Haiku call (thinking off) CPS ratio 0.372 [0.286, 0.450]; vs Haiku agent 0.118 [0.093, 0.229] | One synthetic family, 12 tasks, K = 3; expert-written ceiling; 29 of 30 single-call timeouts at d4 make the success gap over same-model calls largely a harness artefact; false `pass` on its one failure; seeds burned; pre-E1 cost basis | 4 | + (narrow) | Transfer (sealed families, R-bench); a workflow built by anything other than an expert; re-qualification on E1 |
| 8 | Kev micro-judgments | Engine, bridge, data factory; nothing trained | Stock Kev-0.8B vs rule on the same (calibration) split [M ledgers]: records-pair 0.800 vs 0.800; incident-class 0.903 vs 0.889; synth-claim 0.563 vs 0.575; injection 0.640 vs 0.990; failure-class 0.692 vs 1.000; CPU median 2.5–13.7 s. Hosted Sonnet 0.76–1.00 on 8 ports (eval split, n = 47–50, ≈ 4 s). Laptop fine-tuning 0.28 s per 300-token record [D] | Dev seeds, generator labels; no Kev rows on the evaluation split; `03-probe-results.md` is still `RESULTS_PLACEHOLDER` [M] | 3 | − (stock) | The Kev-vs-Haiku-5.5 probe per port ($5–10); a trained Kev on test-OOD slices; GPU latency inside the loop. Haiku 5.5 typed calls take about 1–1.5 s for under $0.001 [D] |
| 9 | Honest verdicts | Lint + gating acceptance + `unverified` landed | Retro-audit [M]: 5 false passes → 0, and 27 true passes → 0 (32/32 `unverified`). Machine-wide 19 Foundry-pass/oracle-fail trials (13 dev, 6 test) [D 06b]. A structural gating verify on records-v3 rejects 4 of 14 bad controls [D heal DESIGN B.4] | Structural lint; rules written from the artifacts they fire on; not shown to predict failures on new builds | 3 | ± | **Oracle discovery** during construction; a bad-control rejection rate per artifact; verdict-vs-oracle agreement per arm on E1; tasks with no oracle stay `unverified` by design |
| 10 | Selective reuse and learning | Not started (Phase 5). THESIS D11: no mutable cross-run store in Foundry | None. Recurrence of your tasks is unknown (decision 11 default: no list) | — | 1 | · | Recurrence census; reuse by hash (needs `call`); admission rule; wrong-reuse, deopt and reuse rates; amortisation curves |
| 11 | Composition: nested, recursive, iterative | Static nesting depth ≤ 6, bounded `loop`, `map` [D `src/validate.mjs`]; no `call`, no recursion | Unit tests only. `subworkflow-call` alone blocks 109 original items (S1) [D COVERAGE §10.6] | — | 2 | · | IR-S1 `call` (week 6 at the earliest); the composition conformance suite (synthesis App. C): deadlocks, double-counted budgets, spawn bombs |
| 12 | Swarm-style fan-out | `map` (≤ 16 concurrent, ≤ 1,000 items) now scales; no `wide` operator; no B5 (best-of-K) baseline | 1,000-item map in 15 s [M bench] | Throughput only; no capability measurement | 2 | · | `wide` vs B5 on `records` ($80–150, week 6). Kill rule: if `wide` loses, no swarm default |
| 13 | Subagents inside nodes | `executor` adapter (`src/executors/claude-code.mjs`), not an IR node; user, mount and pid namespaces, **no network namespace** [M `UNSHARE_ARGS`]; CLI login readable inside [D] | Used as B0-agent and builder in P1/C0 | D10 default: no executor reads third-party text | 2 | · | Executor isolation without a new credential (unknown if possible); an `executor` node with replay and audit rules; the executor experiment vs Claude Code alone ($60–100) |
| 14 | Parallel workflows working together in AMP, "all possible combinations" | Not built; ARC/AMP integration is Phase 7 (D4 deferred) | Interface maps only (`research/landscape-20261006/10-`, `11-`) | — | 1 | · | Composition semantics first (W14); an AMP connector profile; bounded batch approval (W15) |
| 15 | Shared board and private notes | Not built; `boardRoot: null` placeholder in the seal [M] | Lane 7 §2 design | — | 1 | · | A bed that needs it; board v1 with S1/S5/S6 threat fixtures; experiment vs plain edges |
| 16 | Node UI: live state, history, summaries | Single-run view (breathing dots, live SSE feed, click a node for its chat) and run history (list, timeline, compare, task matrix, deterministic summary, optional Haiku summary) | 91/91 tests [M]; headless 60/60, adversarial 14/14 [D 06b]; real index of 930–941 rows; Haiku summary ≈ $0.0013 per run, 1 of 3 invented a detail [D 06b] | You have not reviewed it; game-QA screens are scripted fixtures; live history mode and `foundry serve` integration not built | 3 | + | Your review (ROADMAP §2.10 exit test); live mode; viewer in `web/` after E1; the 13-run frozen evaluation of the model summary |
| 17 | Auditability everywhere | Chain binds journal rows (request and response hashes), decisions, identity, executor transcripts, a Merkle seal, external anchors | `tests/hash-chain.test.mjs` passes in the suite [M] | Threat model excludes a privileged attacker; never used on a real claim-bearing run | 2 | + | Use on C0 sealed with anchors outside the workspace; board root when a board exists |
| 18 | Efficiency everywhere | Store fixed, flags in, scheduler assumed | Flags −41 to −42% cost and −1.5 s per trivial call [M]; map flat per item [M]; model calls 76–81% of wall time [D 04] | Trivial calls, n = 10 per arm; shared, loaded VM | 3 | + | Load tests (300 nodes, 10 concurrent runs); the CLI ceiling of 2.3–3.4 calls/s [D 04]; the weekly allowance, which binds before dollars (orchestration unpriced: 25.8 M subagent tokens by 08:50 [D README]) |
| 19 | Security of the whole loop | Labels, quarantine, sandbox, control-flow taint | Probe B now fails as intended [D README] | Sink-field policy, declassification budget, builder provenance taint, executor isolation, model-written code: open [D synthesis §7] | 2 | ± | Each open item gates the first run that needs it: R-bench validation (sink field), any builder reading third-party text (provenance taint), the injection slice, the 31 third-party agentic items that execute model-written code (38 counting refused items' needs [D COVERAGE §10.4]) |
| 20 | Honest evaluation on real-world tasks | R-bench: 30 shortlisted, 5 harnessed and attacked; sealed families: 4, never used; owner tasks: 0 received; external benchmarks: 0 run | R-bench pilots all "usable-with-limits"; 18 wrong-solution classes fixed, 5 still pass; $10.85 and 66 agent-min per item [M] | Harnesses on mocks, written and attacked by Claude; a solver that reads `experiments/replicate/` can rebuild the answers [D DESIGN §2.1]; T2 descriptions model-restated on 4/5 | 2 | · | R-bench run 1 (5 items × 3 types, ~$170, report-only) with the recall guards; your 20–30 tasks (decision 9, default "missing" after 10-28); the external-benchmark acquisition check (no record of it under `research/` [M grep]); C0 sealed |

**Counts.** Depth ≥ 2 (built and tested): 15 of 20. Depth ≥ 3 (live models, dev): 8. Depth ≥ 4 (baseline on
held-out dev tasks): 2 (cheap execution, which supports; Haiku construction, which leans against). Depth ≥ 5 (sealed,
wild or owner tasks): **0**.

---

## 3. Numbers recomputed for this document

### 3.1 P1 (`records` v3, 288 trials)
`node experiments/p1/analyze.mjs experiments/runs/p1/results.jsonl` [M] reproduces README and REPORT exactly: the arm
table, fhand-haiku vs Sonnet call +0.194 [0.056, 0.361] with McNemar p = 1.000, CPS ratio 0.051 [0.044, 0.063], and
Haiku 5.5 vs Haiku 4.5 single call +0.694 [0.472, 0.889], p = 0.004. The 288 rows sum to $26.03; the report's $26.09
adds the $0.064 orphan run [M; D]. At d3 only, fhand-haiku's CPS is 0.40× (0.0155 vs 0.0384) and 0.39× (vs 0.0397) of
the two Haiku 5.5 single calls [M].

### 3.2 C0 dev (`records`, `codefix`)
`node experiments/c0/analyze.mjs experiments/runs/c0-dev` [M] reproduces REPORT-dev. Per family, successes to repay a
build against the same model solving directly with Claude Code: F-opus 3.8 (`records`) and 9.6 (`codefix`); F-haiku
2.9 and never; B1-haiku 3.9 and never; B1-opus 6.6 and never. Execution-only CPS ratio F-opus/B0-opus 0.148 [0.064,
0.370]; with the build included, 0.706 [0.498, 1.279]: the Opus-built workflow is not yet shown cheaper than Claude
Code with Opus once construction is counted, at 8 trials per family [M].

### 3.3 Corpus coverage
Recomputed from `research/corpus-20261006/items.jsonl` (1,559 lines) by verdict prefix and platform [M]:

| slice | items | native | via-extension | refused by design | unsupported | declared oracle (any kind) |
|---|---|---|---|---|---|---|
| original | 1,342 | 476 (35.5%) | 864 | 0 | 2 | 390 (test-profile 260, output-equivalence 106, mocked 24) |
| agentic third-party | 207 | 45 (21.7%) | 129 | 33 (15.9%) | 0 | 48 |
| agentic first-party | 10 | 0 | 10 | 0 | 0 | 0 |

`agent-tool-loop` is a verdict token on 100 of 207 third-party agentic items (48%) [M]. These match COVERAGE.md §4 and
§10.2. Nothing was compiled or executed; the oracles were declared by converters or readers, and none was run.

### 3.4 R-bench harness cost
From `research/replicate-20261008/harness-cost.json` [M]: per item (Sonnet build + Opus verify) galaxy $7.18 / 51.5 min,
n8n:12679 $12.04 / 73.2, n8n:20281 $13.52 / 77.5, Home Assistant $9.45 / 61.2, GitHub Actions $12.05 / 67.4; mean
**$10.85 and 66.2 agent-minutes**; total $54.24 for five. With the design and selection agents the 13 agents total
$66.87 and 363.5 agent-minutes. All dollars are list-price lower bounds (hidden reasoning is not counted) [D harness-cost.mjs].

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
hosted Sonnet engine scored 0.76–1.00 on the evaluation split (n = 47–50 per port).

### 3.7 Engine suites
- `node --test --test-concurrency=2 tests/*.test.mjs` (the `npm test` command) at HEAD: **912 tests, 894 pass, 0 fail,
  18 skipped**, 3 min 31 s [M]. At the Phase 1 review it was 765 tests (747 pass, 18 skip) [D README].
- `node --test 'tools/run-view/test/*.test.mjs' tools/run-view/core.test.mjs`: **91 tests, 91 pass** [M].
- 1,000-item map benchmark (scratchpad script `map1000.mjs`, `core.identity` body, concurrency 16, new store):
  14.9 s and 15.9 s wall, 2.84 and 2.93 CPU-s; 100 items 1.62 s, 0.35 CPU-s [M].

### 3.8 Kev data factory tests
`node --test --test-reporter=tap experiments/kev-data/test/*.test.mjs` with `KEV_DATA_SCRATCH` in the scratchpad:
KEVDATA_RESULT

### 3.9 Auto-heal live campaign (in flight)
Two live campaigns ran while this was written: `experiments/heal/runs/live-20261008/` (from 21:19 UTC) and
`live-20261008-r2/` (from about 21:33 UTC, after a 3-line edit of `experiments/heal/live.mjs` that was uncommitted at the
time). Read at 21:40 UTC from their `*.json`, `*.lineage.jsonl` and `spend*.jsonl` files [M]:

| run | incident | outcome | proposals and reject codes, by proposer round (M = Haiku 5.5, L = Sonnet 5.5, F = Opus 5.5) |
|---|---|---|---|
| 1 | H-rec | lint-debt patch **promoted** (`gate_verify`, `gate_failed_count`, `strengthen_acceptance`; V0–V8 pass; cost ratio 1); defect **exhausted** | M invalid op; M invalid op; L literal leak; F invalid op |
| 1 | H-cfx | **exhausted** | M invalid op; M invalid op; L failing case still fails; F failing case still fails |
| 1 | H-p1 | lint-debt patch **promoted** (`gate_verify`, 8 × `gate_failed_count`, `gate_continuation`, `strengthen_acceptance`); defect still running | round 3 (L) under verification at 21:40 |
| 2 | H-rec | **exhausted** | M failing case still fails; M literal leak; L failing case still fails; F literal leak |
| 2 | H-cfx | **blocked**: "lint errors remain on the candidate: heal the lint debt first" | one `relax_check` proposal |

Matching reject codes to rounds uses the order of `result.reasons` against the spend ledger's round labels; that
matching is the only inference. Spend: $1.32 over both campaigns at 21:40 (run 1: H-cfx $0.75, H-rec $0.21, H-p1 rising;
the cap is $8). A Haiku round costs about $0.002, a Sonnet round $0.024–0.067, an Opus round $0.05–0.08.

What this shows [I]: the loop runs live end to end, the code gates refused every defect patch they were shown, and the
mechanical lint-debt repairs promote. No *defect* fix survived on any incident, from any model class. In run 1 every
Haiku round produced an invalid operation; after the edit to `live.mjs` Haiku's operations were valid and were then
rejected on substance, like the stronger models'. All incidents are on inspected test seeds (the runs say so
themselves: "proves plumbing, not a fix rate"), n = 3, so none of this is a fix rate. The campaign may end with other
numbers after this document is written.

---

## 4. Overall position

**The estimate.** Summing the depth column of section 2: **45 of 120 (38%)** once these land [I, from the rubric
above]. Most of what landing adds is instrument depth (heal 0 → 3, honest verdicts, audit, efficiency), not capability.
A stricter reading of the same table: **2 of 20 layers** have a comparison with a baseline on held-out tasks, one of
them pointing the wrong way, and **0 of 20** have sealed, wild or owner-task evidence.

**Two readings of "how far along".**
- *The instrument* (engine, verdicts, audit, viewer, evaluation harnesses) is a little over half way to the first
  claim-bearing round: about 5.75 of the 10 engine-bump bullets once the scheduler and cancel land, and about 4.5 of
  the 17 security gates of synthesis §7 passed (items 7 and 8, item 14, the viewer's test of item 11, and the control
  half of items 1+2) [I, counted from §1 and synthesis §7]. What is missing is mostly security (sink field, launcher,
  executor isolation) and oracle discovery, which no bullet covers.
- *The capability evidence* for the maximalist vision is at its first step: one narrow positive (an expert workflow
  makes Haiku cheap and reliable on one synthetic family), one small negative-leaning result (Haiku as builder), and
  no evidence yet on routing, healing, reuse, composition, swarms, subagents, the board or real-world tasks [M/D, §2].

**If the six-week plan lands on schedule** (synthesis §5, through 11-24): about **68 of 120 (57%)** [I: runtime 3,
IR 3, router 3, construction 5, templates 4, heal 4, execution 5, Kev 4, verdicts 5, reuse 1, composition 3, swarm 4,
executor 3, AMP 1, board 1, UI 3, audit 5, efficiency 3, security 3, evaluation 5]. Depth is not success: each of those
points can come back negative, and the plan's kill rules say what happens then (section 6).

**My odds on the questions that decide the plan** [I; reasoning in brackets; these are guesses, not measurements]:

| Question | My odds | Basis |
|---|---|---|
| Structured construction makes Haiku-built workflows non-inferior to Opus-built ones on the sealed one-shot families | about 45% | C0 dev defects were kit, template and validator gaps, which the lint now names; but the hardest defect (a date order stated only by example) is an oracle-discovery problem, and none of that is built |
| The W1 kill fires: one Haiku call or agent is non-inferior to F-haiku on 2 of 3 sealed families | about 40% | Haiku 5.5 single calls already pass 25/36 on `records`; Claude Code + Haiku passes `codefix` d3 8/8 at the lowest cost |
| RX1 finds routing headroom above the kill line | about 55% | The best mode already differs between the two dev families; cross-fitting and two families make the lower bound wide |
| A trained Kev beats Haiku 5.5 and the rules on at least one port, on accuracy and cost | about 30% | Stock Kev ties or loses to rules; Haiku 5.5 is fast and cheap; narrow fine-tunes can win on one or two well-posed ports |
| R-bench run 1: F-opus→haiku replicates at least 3 of 5 items on T1 (translate) | about 50% | The harnesses are strict and attacked; mock worlds are small; translation is the easiest type |

---

## 5. Strategic risks

| # | Risk | Evidence now | What would show it early | Mitigation in the plan |
|---|---|---|---|---|
| S1 | **One-shot models catch up.** Each model release narrows the gap a workflow closes | Haiku 4.5 → 5.5 single call on `records`: 0/36 → 25/36 [M P1]; Claude Code + Haiku is cheapest on `codefix` d3 [M C0] | Single-call success on sealed families within the non-inferiority margin of F-haiku | Claim cost per verified success, reliability (pass^k) and auditability, not rescue; harder difficulties; the Haiku 4.5 stress arm; re-qualify after each model change (W10) |
| S2 | **Construction never amortises** | Break-even 2.9–9.6 successes per family, never for Haiku builds on `codefix` [M C0]; with the build counted F-opus is not shown cheaper than Claude Code with Opus (0.706 [0.498, 1.279]) [M]; recurrence of your tasks unknown | Amortisation curves on sealed families; your recurring-task list | Reuse layer only after recurrence is measured; templates make builds cheap; the router says "none" when a task is one-off |
| S3 | **Evaluation validity** | Claude wrote every bed, harness, builder prompt and this review; seeds 5001–5006, 6001–6004 and R-bench 0–27 are burned; R-bench answers are rebuildable from the repository; 5 known wrong-solution classes still pass R-bench oracles [D] | Large drops from development to sealed or wild tasks; verdict-vs-oracle disagreements | The wild ladder: sealed families read once, R-bench with recall guards, external benchmarks, your tasks; you spot-check claims (W16) |
| S4 | **Executors cannot be made safe without a credential** | No network namespace in the executor sandbox [M]; CLI login readable [D]; D10 default keeps executors off third-party text | The no-credential proxy design fails | Without it, subagents in nodes stay a fallback; the agent tool loop (48% of agentic items) needs a Foundry-native capped loop, which needs a ROADMAP §3 amendment |
| S5 | **Honest but blind.** Without oracle discovery, every field run is `unverified`, so heal, router labels, reuse admission and the UI's verdict have no success signal and drift back to model judges | 32/32 C0 trials `unverified` under the new rules [M]; stock Kev ≤ rules [M]; a Haiku run summary invented a detail [D 06b] | Share of constructed workflows that reach a gating acceptance which rejects most bad controls | Oracle discovery as a construction step; bad-control rejection rate as a construction metric (heal lesson L-3 [D]) |
| S6 | **Scope outruns evidence** under "Full speed" | About 127K lines of JS in `src`, `tests`, beds, Kev data, R-bench, heal, viewer and bridge [M `wc`], against 2 small development studies; the weekly allowance is the binding limit and orchestration is unpriced [D README] | Week 3 starts without CX3, RX1 and EX1 pre-registered | Rule R6 (no new subsystem without a pre-registered experiment that needs it); the usage rule D14 (not adopted) |
| S7 | **Kev is a sunk cost** | 34.6K lines of data-factory JS [M]; stock Kev ≤ rules; Haiku 5.5 typed calls about 1–1.5 s for under $0.001 [D] | The Kev-vs-Haiku probe | Decide per port; train only where Kev already wins on accuracy, cost and latency |
| S8 | **The labs absorb the workflow layer** | Claude Code dynamic workflows exist; 10 first-party corpus items are this project's own Claude Code workflow scripts [D] | A vendor ships typed verdicts, replay per node or audit binding | Measure the differentiators (replay per item, independence labels, dollars per node); harness independence needs the conformance suite |
| S9 | **The owner becomes the bottleneck** | Decisions 1, 4, 9 and 11 are on defaults; no owner tasks received [D README] | Rung 3 reported "missing" on 10-28 | Bounded batch approval; R-bench as rung 2a (DESIGN §11) |

---

## 6. What evidence would change the plan

| Experiment (cost) | Result that changes the plan | Change |
|---|---|---|
| CX3: structured vs free Haiku builder, K_c = 3 ($25–35) | No better and no cheaper | Drop the structured builder; Haiku runs and edits, Opus builds; "Haiku constructs" is narrowed in THESIS |
| C0 sealed 2×2 on E1 (~$200–260) | W1: a single call non-inferior to F-haiku with CPS-ratio upper bound ≥ 0.85 on 2 of 3 families | The claim shrinks to "rescuing a weak model"; the router defaults to direct |
| C0 sealed | B1 ≥ F for both builders | The typed IR is kept only where verdicts, replay or audit are needed |
| RX1 pilot (~$85) | Lower bound under 3 points and under 20% cost at every V and N | No router; a fixed policy plus hard-requirement guards |
| EX1 / heal on injected faults ($15–30) | Fix rate per dollar no better than rebuilding from scratch | Heal becomes "rebuild with the failure as a probe"; the patch-op machinery is parked |
| Kev vs Haiku 5.5 probe ($5–10) | Kev loses on a port | That port uses Haiku or rules; laptop training stops for it |
| R-bench run 1 (~$170) | F arms below B0-call on T1 and T2 on 4 of 5 items | The workflow pitch narrows to recurring tasks with cheap checks |
| `wide` vs B5 ($80–150) | `wide` loses | No swarm default; swarms stay representation-only |
| Your 20–30 tasks | F loses to B0 on your tasks | The product is the router plus direct calls plus audit, not construction |
| Recurrence census (free) | Median recurrence below the measured break-even | Reuse stays deferred and construction is reserved for structure-requiring tasks |
| No-credential executor isolation | Not possible | Subagents stay a fallback; a capped Foundry-native tool loop needs an owner decision (ROADMAP §3) |

---

## 7. The top 10 gaps, ranked by importance to the vision

1. **No sealed, wild or owner-task number.** Every result is development evidence on Claude-written synthetic
   families with burned seeds. R-bench has 5 attacked harnesses and 0 runs; the sealed families are unused; 0 owner
   tasks; 0 external benchmarks, and no record of the acquisition check exists under `research/` [M grep; D synthesis §5]. Closes with: R-bench run 1, C0 sealed,
   your tasks, the acquisition check.
2. **No oracle discovery, so "honest" means "unverified".** After landing, 0 false passes and 0 informative passes
   (32/32 `unverified`) [M]; a structural gate rejects only 4/14 bad controls [D]. Every downstream layer (heal,
   router labels, reuse admission, the UI's verdict) needs a success signal that is not a model's opinion. Closes
   with: oracle discovery in the builder, the bad-control rejection rate as a reported metric, verdict-vs-oracle
   agreement per arm.
3. **Haiku as constructor is unshown and leans negative.** 11/16 vs 16/16, K_c = 1 [M]; no structured builder, typed
   templates or skeleton library exist [M]. Closes with: builder v0, CX3, C0 sealed with the Haiku 4.5 stress arm.
4. **The router and slider do not exist, and nothing has measured whether there is anything to route.** The evidence
   so far says "none" is often the right size (`codefix`) [M]. Closes with: RX1 cross-fitted headroom on E1, then a
   fixed-policy router with hard guards.
5. **"Represent any workflow" is declared, never compiled.** 34% native over 1,549 items, 0 compiled, 0 executed
   [M]; no `call`, triggers, error branches, tool loop or media; 125–190 engineer-days to S7 [D]. Closes with: IR-S0
   pipeline and S1 `call`, then the first compiled and executed numbers.
6. **Subagents and agentic workflows are blocked by executor security.** No network isolation, readable login [M/D];
   D10 keeps executors off outside text; 48% of agentic items need a tool loop [M]. Closes with: a no-credential
   isolation design, or an owner decision on a proxy key or a capped native loop; the sink-field and provenance-taint
   policies.
7. **Auto-heal and editing have no fix rate.** Offline localisation works on 3 inspected incidents [D]; the first live
   proposals produced no surviving defect fix (2 incidents exhausted) [M]. Closes with: EX1 on injected faults and fresh
   failures against a rebuild baseline.
8. **Reuse and learning are unbuilt, and their premise (recurrence) is unmeasured.** Break-even needs 3–10 successes
   per family or never [M]. Closes with: a recurrence census, `call`, admission and wrong-reuse metrics.
9. **Composition at scale is untested.** No `call`, `wide`, B5, board, private notes or AMP combinations; no
   composition semantics [D]. The store fix removes the throughput blocker [M]. Closes with: `wide` vs B5, the
   composition conformance suite, then a bed that needs a board.
10. **Kev's role is unproven against Haiku 5.5.** Stock Kev ties or loses to rules; nothing trained; the probe
    write-up is a placeholder; the docs disagree on whether training waits [M]. Closes with: the Kev-vs-Haiku probe per
    port before any training run.

Outside the top 10, smaller but real: your review of the run viewer (not done); E1 itself (sink-field policy,
launcher, usage-limit pause, G1–G3, scheduler and cancel in HEAD); README drift (stage-1 status, 220 vs 217 items, the
Kev training contradiction).

---

## Sources and reproduction

- P1: `node experiments/p1/analyze.mjs experiments/runs/p1/results.jsonl`; `research/core-20261006/REPORT.md`.
- C0: `node experiments/c0/analyze.mjs experiments/runs/c0-dev`; `research/construction-20261006/REPORT-dev.md`.
- Corpus: a `node -e` count over `research/corpus-20261006/items.jsonl` by `ir.verdict` prefix and `source.platform`;
  `research/corpus-20261006/COVERAGE.md` §4, §7, §10.
- R-bench: `research/replicate-20261008/harness-cost.json`, `DESIGN.md` §2, §7.
- Kev: `experiments/runs/kev-probe/ledger/*.jsonl` (accuracy by split and wording), `research/kev-20261007/LAPTOP-THROUGHPUT.md`,
  `research/kev-20261007/03-probe-results.md`, `experiments/kev-data/README.md`.
- Engine: `node --test --test-concurrency=2 tests/*.test.mjs`; `research/lint-20261008/retro-audit.json`;
  `research/review-20261007/cli-flags-20261008/{analysis,results}.json`; `grep` of `src/runtime.mjs`, `bin/foundry.mjs`,
  `src/executors/claude-code.mjs`, `src/store.mjs`.
- Viewer: `node --test 'tools/run-view/test/*.test.mjs' tools/run-view/core.test.mjs`; `research/review-20261007/06b-run-history.md`.
- Heal: `research/heal-20261008/DESIGN.md` (App. B), `experiments/heal/runs/live-20261008/`.
- Plan, gates and risks: `research/review-20261007/00-SYNTHESIS.md` §2, §4, §5, §7; `01-requirements.md` (e); THESIS §10.
