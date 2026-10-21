# FIXES: a state-of-the-art fix for each compromise, cost first (2026-10-21)

**Inputs.** The register is `research/compromises-20261021/REGISTER.md`. Five researcher outputs and five skeptic outputs were read in full from `/root/.claude/projects/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/subagents/workflows/wf_7ca63306-529/journal.jsonl`, because the task text handed to me was cut off inside B6. The scratch reproduction scripts are under `/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/` (b2, b3, b7, c1, c6, qjs-proto, ses-proto, wsp, tsa, e4vote, and the `*_sim.py` files). No repo file was edited.

**Coverage gaps:**
- The skeptic did not check A5, A6, A7, A8, B7 or B8. I opened their load-bearing sources today and tagged them V.
- The skeptic's own input was cut off for B6 (from efficiency on), C6 (from efficiency on), D3 (source list onward) and E4 (from the MAST source on). Those fields rest on the researcher alone.
- Not researched in this pass: A3 and B1 (fixed), B4 (in-flight), B9, D4 and E3 (accepted), C3, C4 and C5 (in-flight in #75).

**Source tags:**
- S: opened and confirmed by the skeptic.
- V: opened and confirmed by me on 2026-10-21.
- U: not verified. It is kept only as a pointer, never as evidence.

Sources the skeptic contradicted are dropped (see §4).

**Evidence labels:**
- [obs]: observed in stored runs.
- [sim]: replay or simulation.
- [est]: estimate.
- [inf]: inference.

---

## 1. Fix table (one row per compromise id)

### A. Model and agent efficiency

| id | Chosen fix | Kind | Sources | Efficiency effect (tokens, $, latency, engineering) | Adoption (files, effort) | Test that proves it | Status suggestion |
|---|---|---|---|---|---|---|---|
| A1 | Sticky, cache-aware observation masking in the openai-chat (Mercury) executor. **Build it after A2, and only if the token allowance is still the binding limit.** System, user and assistant messages stay verbatim. When the wire context passes H chars, every tool result older than the last W is replaced by a one-line placeholder. Masking is sticky, so the prefix stays byte-stable between triggers. Start with api_search results only (W=10, H=40K), and widen to all tools only if T2 and T3 pass. Drop the planned 30K-to-10K output clip, which is worth about nothing. A re-call of an elided result must not count as an A2 loop strike. | own-build | S: 2508.21433 (Complexity Trap; −50 to −57% cost in 4 of 5 configs, and W depends on the scaffold); 2606.17016 (TokenPilot); 2607.00692 (Self-GC); Anthropic context-editing docs; 2609.32961; 2609.22114; 2609.26121 (DTOC, runner-up); mini-swe-agent 10K clip | [sim] on the 60 Mercury transcripts:<br>• api_search only: 65% of input, 1.5% of steps at risk.<br>• all tools, W6/H40K: 28% of input, 57–63% of cache-equivalent cost, 4.6% of steps at risk.<br>• with A2: about 10% of input (dev60 run about 96M → about 10M tokens).<br>Dollars: about −$0.9 per dev60 run at list price (the run is worth about $1.5), so the real value is free-allowance tokens.<br>Latency: about −70% of re-read prefill, but fewer tokens can mean longer wall time (2609.32961).<br>Engineering: 4–5 h. | New `src/executors/context-policy.mjs` (pure, about 80 LOC). In `openai-chat.mjs`, build the wire copy before `complete()` (about line 406), emit a `context_edit` event, and make `projectNext` use the wire size. Add `--context-policy` to `experiments/autobench/run.mjs`, recorded in launch.json. Default OFF. | T1 ($0, fakeEndpoint): prefix byte-identical between triggers; the last W are never elided; the transcript keeps full outputs; the budget uses wire size.<br>T2 ($0 replay), api_search only: input ≤70%, uncached ≤6%, dependency steps ≤3%.<br>T3 (≤0.5M Mercury tokens): 10 tasks with A2 on in both arms; input ≤50% of control, steps not higher, re-search count recorded. | open → in-flight (#73) after the A2 re-measure |
| A2 | **Split into two.**<br>(a) Loop guard in openai-chat:<br>• Fingerprint every call as (tool, canonical args).<br>• A repeated identical *successful* write is served from cache with a notice. Errors are never cached; a write is re-executed after an error, at most twice.<br>• An identical call with an identical result is a strike. After 3 strikes, one final request with tool_choice 'none', then stop with `EXECUTOR_LOOP`/`error_loop`. This is an outcome, not an ENV_FAULT.<br>(b) Verifier-gated stop: a separate item, unvalidated (see §3.1). | own-build | S: OpenHands StuckDetector + issue #5355; 2608.23623 (ECT); 2609.33315; 2610.06191; 2604.21375; 2503.13657 (MAST); Claude Code hooks, with `--safe-mode` disabling them (v2.1.169).<br>Cited by the skeptic but not opened by me: bytedance/deer-flow loop_detection_middleware; arXiv 2609.29095. | [obs]:<br>• 52 of 52 step-cap tasks repeat an identical call 3 or more times.<br>• 64% of cap-task steps come after the 3rd repeat.<br>• 90.4% of writes repeat an earlier identical call.<br>[sim]:<br>• Stopping at the 3rd identical call leaves 28.1% of input.<br>• The rule as built stops at about the 4th–5th call: 32–34% (−66 to −68%). 0 of the 2 passing tasks are cut.<br>Allowance: about 96M → about 31–33M per dev60 run. Dollars: about −$1 per dev60 run at list price.<br>Latency: about −64% wall time on cap tasks (not re-derived).<br>Safety: stops duplicate side effects (740 identical Gmail sends).<br>Engineering: (a) 3 h. | `src/executors/openai-chat.mjs`: loopGuard option, fingerprint map, SessionStop `EXECUTOR_LOOP`.<br>`experiments/lib/runner.mjs`: outcome classing.<br>summary.json records strikes and suppressed duplicates. | T1 ($0): the same Bash write 5 times → side effect runs once; the 2nd result is the cached one; the session ends error_loop after 3 strikes with tool_choice 'none'. Five distinct calls, a poll whose result changes, and an error followed by a retry must not trip it.<br>T2 ($0 replay): ≥90% of the 52 cap tasks stop by step 25; input ≤**35%** (not 30%); 0 passing tasks affected. | (a) open → in-flight (#73)<br>(b) in-flight (A1-C, #64) |
| A3 | Not researched. | — | — | — | — | `experiments/autobench/test/token-meter.test.mjs` | fixed (keep) |
| A4 | Paired group-sequential testing on **new tasks at k=1**:<br>• Use O'Brien-Fleming boundaries (not Pocock).<br>• Run looks only on dev-train, never on devCheck. Look 1 is the stored dev60 rows ($0); later looks are batches of 60 from the 137 unexposed dev-train tasks [inf from PREREG-AB-v1 §5].<br>• Reuse stored A0 outcomes as the control.<br>• Pre-register the paired partial-credit permutation test as the co-primary dev metric beside strict McNemar.<br>• Use exact, Wilson or Bayes intervals at n<200.<br>• Use k≥2 only for pass^k claims. | process | S: 2026.findings-acl.43; 2606.20820 (CELEUS, a workshop paper); 2010.09686; 2411.00640; 2503.01747 | [sim]:<br>• At 120 runs per arm, power is 0.70 as 120 tasks × k=1 against 0.58 as 60 × k=2.<br>• O'Brien-Fleming, 5 looks of 60: power 0.958 at a mean of 203 tasks, against 0.963 for a fixed 300 (−32% runs).<br>• Type-I about 0.04 two-sided.<br>[obs] Partial credit gives p=0.0034 against strict p=0.077 (Sonnet+A1 vs Sonnet).<br>Dollars: about $2.5 per comparison with A0 reused, instead of about $5.<br>Engineering: 6 h. | `experiments/lib/stats.mjs` (shared with B7): boundaries, mixtureEvalue, paired permutation.<br>New `experiments/autobench/sequential.mjs` (it does not exist yet).<br>Amend PREREG-AB-v1 **before the next paid comparison**. | T1 ($0): nominal alphas; mixtureEvalue(12,2)=12.0 and (12,3)=4.5; p≈0.0034 on stored runs.<br>T2 ($0): the 4-look dev-train schedule keeps two-sided type-I ≤0.05.<br>T3 (about $1): an A/A check (the same arm run twice) is never significant. | open → in-flight (#64) |
| A5 | Verifier-gated escalation on the existing A1-C nodes, adopted only on a measured number:<br>• Escalate only the repair and adjudicate nodes, to the next model class, when the same hard check fails after round 1 or the loop guard fires.<br>• At most 2 escalations per node, each logged with rule, from/to model and cost.<br>• Adopt only if gate recall ≥0.77 and the escalated share is ≤75%.<br>• Audit 20 accepted tasks for blind spots. | own-build | V: 2609.01345 (blind spot grows from 0.12 to 0.55; a dashboard computed through the verifier reads flat); V: Anthropic advisor blog (its numbers are Sonnet 4.6 / Haiku 4.5 executors with an Opus 4.6 advisor, not 5.5 models).<br>U: 2410.10347; 2605.18859; 2510.00202; advisor docs. | [sim] Replay of dev60 records:<br>• A perfect gate passes 31/60 at $5.78, against Sonnet+A1's 28/60 at $6.92.<br>• Break-even recall is 0.77, at about $4.66 (−33%).<br>• Free behavioural gates reach recall of only 0.21–0.57.<br>Engineering: 5 h, plus about $1–2 to measure recall. | `experiments/autobench/harness/checker.mjs`: terminationDecision returns {repair, escalate, reason}.<br>`codeowned.mjs`: per-round model via nodeModels, plus `--escalate-to`.<br>New `cascade-replay.mjs`. | T1 ($0): the replay reproduces 31/60 at $5.78 and the 0.77 break-even.<br>T2 (about $1–2): gate recall and precision against the official grade on one Haiku dev60 run.<br>T3 ($3–7): paired arms all-Haiku, cascade, all-Sonnet; compared by cost per pass plus the A4 test. | open (measure recall first) |
| A6 | **The register's premise is wrong.** Inception documents reasoning_effort as instant/low/medium/high, and mercury-3 defaults to low. The executor refuses `instant`.<br>• Add `instant`.<br>• Measure a dose curve before any arm uses it.<br>• Record the docs price as a shadow price. | process | V: Inception reasoning-efforts doc. S (via A1): Mercury price $0.10 / $0.01 / $0.35.<br>U: TALE; ollama PR 17566; vLLM PR 37112 (merge status unknown). | [obs] Output was 1.2% of tokens and reasoning tokens were 0 in the official run, so there is no effect on the allowance or on dollars. The value is latency (3.9 s per response).<br>Measurement: about 0.24M Mercury tokens (about $0.03 at list).<br>Engineering: 1.5 h. | `src/executors/openai-chat.mjs:48` (EFFORTS).<br>`policy/models.json`: knownGaps note plus shadow price (an owner file).<br>New `experiments/mercury/effort-dose.mjs`. | T1 ($0): `instant` is forwarded; an unknown level still throws EXECUTOR_EFFORT.<br>T2 (0.24M tokens): reasoning tokens trend instant<low<medium<high (p<0.01) and instant cuts completion tokens ≥30% at equal correctness. Otherwise close A6 as "measured, no effect" with its CI. | open → in-flight (#73) |
| A7 | Fix the meter, then the prompt layout; build Batch only on demand.<br>(1) PREREG-NEED-V1 lists Sonnet 5.5 cache reads at $0.20; the documented rate is $0.10. Fix it with an amendment note, not a silent edit. Add cache fields to the Claude policy rows and a Mercury shadow price (owner file).<br>(2) Warm-then-fan-out for sibling nodes that share a prefix: send one call, wait for its first token, then launch the rest.<br>(3) Ask the owner whether the CLI login is a subscription or API-billed; that decides `FORCE_PROMPT_CACHING_5M`.<br>(4) Batch is deferred: no API key by policy.<br>See also E4 (Haiku's 100K-token price cliff). | process | V: Anthropic Haiku 5.5 overview and pricing (cache read 10% of base; 5% for Sonnet and Opus 5.5; Haiku's two price tiers); V: 2601.06007 (−41 to −80% cost, −13 to −31% TTFT).<br>U: Batch docs detail; v2.1.108 notes / issue 48082 (1-hour TTL on subscriptions); how Inception meters cached tokens. | Meter fix: $0; removes a 2x overstatement.<br>Warm-first, N=3: prefix cost 3.75 → 1.35 on Sonnet (−64%) or 1.45 on Haiku (−61%). About $0.19 per task on Sonnet *if* the ledger prefix is about 40K tokens (unmeasured); about $0.009 per task on Haiku.<br>Latency: adds one serial time-to-first-token.<br>Engineering: 0.5 h + 2 h. | `research/need-router-20261014/PREREG-NEED-V1.md` price table (l.552).<br>`policy/models.json` (owner).<br>`tests/model-policy.test.mjs`.<br>`codeowned.mjs`: warmFirst plus per-node cache accounting. | T1 ($0): the policy test asserts the documented ratios; re-price archived dev60 rows and print the delta.<br>T2 (about $0.02): 3 Haiku siblings sharing a 20K prefix, parallel against warm-first; accept if prefix cost ≤0.6x and cache_read is above 0 across CLI processes.<br>T3 (owner, $0): read the Inception dashboard before and after one session. | open → in-flight (#64) |
| A8 | Save and restore shell state around each one-shot `bash -c`:<br>• A prologue sources a session-private state file; an epilogue writes back cwd, exports, functions and aliases.<br>• Exit code and output are unchanged.<br>• On a timeout, keep the earlier state.<br>• Never persist the host environment. | own-build | V: mini-swe-agent FAQ (each action is an independent subprocess; no cd or export; persistent shells are flaky).<br>U: SWE-ReX; OpenHands bash.py; issue 20503; the "74% on SWE-bench Verified" figure (not on that page). | 0 tokens; +1–3 ms per command. Benefit is unmeasured (builder arms).<br>Engineering: 2 h. | `openai-chat.mjs` commandServer ops.bash (about lines 142–149); Bash description in TOOL_DEFS; `shellState` option. | T1 ($0): cd, export and functions persist; exit 3 still saves state; a timeout keeps the old state; INCEPTION_API_KEY never appears; 200 commands add <5 ms each. | open (low priority) |

### B. Evaluation validity

| id | Chosen fix | Kind | Sources | Efficiency effect (tokens, $, latency, engineering) | Adoption (files, effort) | Test that proves it | Status suggestion |
|---|---|---|---|---|---|---|---|
| B1 | Not researched. | — | — | — | — | strict scoring | fixed (keep) |
| B2 | Make the tools pure, then stop trusting labels the tools cannot reach:<br>• Seed the RNG per call in `World.call` from sha256(benchmark, row, tool, canonical args).<br>• Prove reachability per row. A row whose upstream label no draw can reach is reported as `label-tool-inconsistent` and never scored.<br>• Reachable rows get a label-conditioned draw, computed on the host only for sealed rows.<br>• Report the majority-label baseline beside every score.<br>• Enumerate threshold-equivalence cells instead of all 10,201 lattice points [inf]; it must reproduce 12/8 on dev first. | own-build | S: 2507.02825 (ABC checklist T.7–T.9 and O.f.2; venue unverified); 2610.16067 (INV-2, CTL-2); 2607.02577.<br>2609.37315 and its repo (MIT) are a design reference only: it needs new contracts and missed most injected defects. | 0 tokens, $0.<br>[obs] On 20 dev rows: 12 reachable, 8 unreachable by any draw; seeding alone matches the label on only 7 of 20.<br>CPU: sealed set about 1 h exhaustive (not 15 min), or seconds with cells.<br>Engineering: 3 h. | `experiments/sopbench/bridge.py`: seeded patch plus a `reach` command.<br>`SPLIT.json` `contentFlaggingReach` (hashes only).<br>Scorer excludes unreachable rows and prints the count.<br>INV-2 check in `parity.mjs`; NOTES §7.1.<br>Pre-register "reported, never scored" before any sealed run. | $0, on a toy fixture: identical calls return byte-identical results; the reference chain scores 100% on reachable rows; unreachable rows carry a proof.<br>Teeth: without the seed, test (a) fails; without conditioning, the score drops to chance.<br>On dev: 12/8 reproduced; the oracle scores 100% on the 12. | open → in-flight (#70) |
| B3 | Now, at $0:<br>• Record the boundary-only agreement in RATER2.md: κ 0.36 (CI 0.05–0.66), AC1 0.52. The register's 0.57 is the 3-class figure.<br>• Report every per-layer number under both raters, and allow a per-layer claim only if it holds under both.<br>Only if a per-layer claim is ever needed:<br>• Define L2/L3 by implication propensity: the share of 20 no-pack Haiku drafts that include the unit, with model and date frozen. The label is model-relative.<br>• The owner adjudicates the units where the panel splits. | process | S: 2602.10525 (LHAW); 2602.18306 (ReqElicitGym); 2404.18796 (PoLL); 2408.15204; Gwet 2008; 2508.02029 (cite its live title).<br>U: the Hughes claim that the 2016 bootstrap is far too narrow. | Step 1: $0, 0.5 h.<br>Propensity pilot: <$0.15, about 0.3M tokens, about 10 min of owner time, 4 h.<br>A third model family needs a policy edit (owner). | `research/intent-20261021/RATER2.md`; `truth-e8-seed1.json` layerByRater; DESIGN.md §4. | $0 node:test reproduces κ 0.567, α 0.571 and AC1 0.67, and the boundary κ 0.36. It fails if the 3-class figure is reported as the boundary figure. | open → in-flight (#72) |
| B4 | Not researched. A4's looks must never use devCheck. | — | — | — | — | — | in-flight (keep) |
| B5 | A knowledge-cut oracle:<br>• Judge each item of one emission against the journal prefix *before* that emission, using trace-validation semantics (S∩T≠∅).<br>• One shared R5.2 permanence monitor for both the oracle and the contracts.<br>• A legal-behaviour fuzzer, **plus a hand-audited set of illegal variants the oracle must reject**.<br>• Regrade stored journals, publish the delta, and mark old numbers superseded. | own-build | S: 2404.16075; 2610.16067 (the 1,311 figure is the authors' own harness artifact, not an upstream bug); 2607.02577; the jepsen-io/elle README (the venue claim is dropped). | 0 tokens, $0.<br>Fuzzer: 10–20 min of CPU.<br>Engineering: 8 h. | `beds/ebed/oracle/grade.mjs:154`.<br>`beds/ebed/e8/transition.mjs:55` and `experiments/compose/capabilities.mjs:24` merge into one monitor.<br>New `fuzz-legal.mjs` plus test; MUTANTS.md goldens.<br>Land inside #59 with a regrade table. | $0:<br>• Goldens flip: o0008 from reject to pass, o0005 from pass to reject.<br>• The fuzzer passes every legal variant, the illegal set is rejected, and the *current* oracle rejects at least one legal variant (teeth).<br>• 240 of 304 mutants stay killed; 0 oracle-versus-contract disagreements; INV-2/3 and CTL-1 hold. | open → in-flight (#69 with #59) |
| B6 | **Now ($0, 15 min):** correct the register. On dup-same the monoliths PASS 35, 32 and 35 of 43, so they lose 8–11 cases, not 32–35. Label dup-same as a diagnostic row and exclude it from pooled headlines.<br>**Owner-gated:** keyed start. Group same-round start events by `family.subject.key` and deliver them as one ordered bag; key human tasks by (case, kind, window). This needs a SPEC-E version bump and arm reruns. Hand keyed start to #75 as a primitive. | own-build | S: Temporal Signal-With-Start and Workflow-Id conflict policy; Restate Virtual Objects; CloudEvents spec. Parallel DEVS is a textbook reference only. | $0 (the arms are programs).<br>Removes an 8–11 of 43 loss that every arm takes.<br>Keyed start: about 4 h, plus a SPEC-E bump and reruns. | Relabel: HARNESS.md §4/§8; pooled metrics in `fault-run.mjs`.<br>Keyed start: `beds/ebed/host/host.mjs` around 389, 455, 473–489 and 674; `transition.mjs:164`; SPEC-E §3.1. | $0: the lineages reach their dup-delayed counts (43, 43 and 40 of 43); with a teeth flag they revert; a wrong-key mutant is caught by MR7; permuted twins give the same journal; there is exactly one fraud-review task. | relabel now; keyed start owner-gated |
| B7 | Make the build (lineage), not the case, the unit of inference:<br>• Headline: a build-level exact permutation test, plus a beta-binomial model with builds as a random effect.<br>• Grade every build on ≥400 cases (the 9-world pool of 1,022 cases, $0).<br>• K≥6 builds per arm for a 10-point claim; K≥8 for about 0.8 power.<br>• Sequential: add builds in blocks of 2, up to K_max 12; state the MDE from measured σ_b.<br>• Share one sequential core with A4. | own-build | V: 2602.07150 (single-run pass@1 moves 2.2–6.0 points); 2610.00651 (system rankings reliable at 0.935–0.994; more tasks add at most 0.097).<br>S (via A4): 2411.00640; 2503.01747.<br>U: 2110.00115; confseq. | Analysis: $0.<br>[sim, assuming σ_b≈0.08]:<br>• Case-pooled tests give about **25% false positives**.<br>• K=3 against 3 can never reach p<0.05.<br>• Power at K=6 is 0.59 with 43 cases per build and 0.84 with 400.<br>Builds: K 3→6 costs +$1.2–1.9 per B1L-H arm, +$2.3–4.5 per C-H arm.<br>Engineering: 5 h. | New `experiments/lib/stats-builds.mjs`; `research/PREREGISTRATION-TEMPLATE.md`; preregBanner in `experiments/agentv/run.mjs`; PREREG-COMP1 M1 amendment. | $0 sims: build-level type-I ≤5%, and case-pooled about 25% (teeth); power about 0.8 at K=8; Bayes coverage ≥93%; sequential false-stop ≤5%. A replay on B1L-H lineages vs agent-H returns an interval plus "cannot resolve at K=3". | open → in-flight (#69) |
| B8 | Measure contamination as a paired counterfactual with a post-cutoff placebo:<br>• Stratum: createdAt against the June 2026 cutoff. Only **77** n8n templates are after it, not 203.<br>• Seeded twins that rename identifiers.<br>• Effect is a difference in differences: the original-minus-twin gap before the cutoff, minus the same gap after it.<br>• Probes count as corroboration only.<br>• Exclude a stratum from headlines if DiD ≥10 points with a CI that excludes 0. | own-build | V: Haiku 5.5 overview (knowledge and training cutoff June 2026); 2608.02985 (a pre/post-cutoff comparison is uninformative; a matched control is needed).<br>U: Test of Time; LiveCodeBench; Fu et al.; C-BOD; DCQ; SWE-Bench Illusion; CapBencher; the BIG-bench canary. | About $2–3 in total, 3–6M Haiku tokens.<br>Strata and twins: $0.<br>Engineering: 6 h. | `experiments/intent/inversion.mjs` (cutoffStratum); new `twin.mjs`; `ci1.mjs`; `knowledgeCutoff` in policy (owner); DESIGN.md §6.4. | $0: twin graphs are isomorphic and no original identifier survives; a planted memoriser is flagged (p<0.01) while a stub reasoner gives DiD≈0. Paid pilot: 47 items, K=2, DiD with interval. | open → in-flight (#72) |
| B9 | Not researched. | — | — | — | — | — | accepted (keep) |

### C. Isolation, plumbing and reproducibility

| id | Chosen fix | Kind | Sources | Efficiency effect (tokens, $, latency, engineering) | Adoption (files, effort) | Test that proves it | Status suggestion |
|---|---|---|---|---|---|---|---|
| C1 | One QuickJS-WASM runtime per module:<br>• quickjs-emscripten 0.32.0, release-sync build, 3 exact-pinned packages, installed with `--ignore-scripts`.<br>• Limits: 64 MB memory, 512 KB stack, 2 s interrupt per call.<br>• Reuse the JSON bridge; map interrupts and OOM to typed module-timeout / module-oom errors.<br>• Try the quickjs-ng variant only if journals are byte-identical.<br>Fallbacks: SES if performance fails; a worker_threads step 0 (fixes the hang and heap, but not the escape). | oss | S: Node vm docs; quickjs-emscripten README, npm and QuickJSRuntime API; isolated-vm advisory GHSA-864f-rcv7-6rh4 (rejected); ses 2.3.0; workerd README; Node permissions docs; Bellard release page; Cloudflare Dynamic Workers. | 0 tokens, $0.<br>[obs] The escape reproduces on today's loader, and QuickJS blocks it.<br>Latency: 5–10x on small steps; about 2.5x on compute-heavy ones (the claimed 23x did not reproduce). Gate ≤3x on a real run.<br>Removes the 30 s hang plus lost-state restart.<br>About 3.7 MB RSS per module.<br>Engineering: 8–12 h. | `experiments/compose/loader.mjs` (+ `--sandbox` flag); `bundle.mjs`; `beds/ebed/host/sandbox-arm.mjs`; `runtime.mjs:342,374`; package pins; `research/composition-20261021/HARNESS.md:324`. | $0 `sandbox.test.mjs`:<br>• ≥10 escape vectors.<br>• A hang becomes module-timeout within deadline+200 ms.<br>• OOM is contained.<br>• Byte-identical journals from vm and QuickJS.<br>• Wall time ≤3x vm. | open → in-flight (#69) |
| C2 | Pin the CLI by bytes, not by version string:<br>• A lock file holding version, sha256 and size from Anthropic's GPG-signed release manifest (signature checked once at pin time), with npm sha512 as a second root of trust.<br>• Fetch the raw binary to `.foundry/cli/<sha>/`; resolve an absolute path, never PATH.<br>• The manifest stores `cli:{version, sha256}`, and resume compares the hash.<br>• Child env gets `DISABLE_UPDATES=1`.<br>**Stopgap today:** a launcher that keeps every version, plus DISABLE_UPDATES. | process | S: Claude Code setup docs; What's new w23; managed-settings docs (a belt, not the pin); npm registry (2.1.300 is still published); downloads.claude.ai manifests (sha256 matches). | 0 tokens, $0.<br>About 1 s to fetch; 0.31 s hash, once per process.<br>Disk: at most 2 binaries of 267–290 MB, with about 1.9 GB free.<br>Saves re-running or mixing arms (A1-S cost $6.91 and saw 1 vs 2 tools).<br>Engineering: about 2.5–3 h. | `research/manifests/claude-cli.lock.json`; `scripts/fetch-cli.mjs`; `src/cli-pin.mjs`; `claude-cli.mjs:120-138`; `claude-code.mjs:293`; `foundry.mjs:171`; `run.mjs:282-307`; `src/models/policy.mjs:67`. | $0 `tests/cli-pin.test.mjs`:<br>• Hashes match the lock; a 1-byte tamper throws CLI_DRIFT.<br>• A fake `claude` placed first on PATH is never launched.<br>• Incident replay: resume at the 2.1.300 lock while PATH has 2.1.306 runs the 2.1.300 tool list.<br>• Bumping the lock is refused on resume.<br>• GC never deletes a pinned version. | in-flight (#75) |
| C3, C4, C5 | Not researched in this pass. | — | — | — | — | — | in-flight (#75) |
| C6 | Copy the patterns into the typed IR, in order of need:<br>(1) `compensate`: LIFO, an idempotency key, bounded retry, `compensation_failed` plus a human question, and cancel also compensates. **Each node declares its registration point:** before the effect for one-shot idempotent-key APIs, after the reservation for reserve-then-act APIs (per Restate). Irreversible effects are gated and released last instead.<br>(2) `call`: resolved by hash, type-checked, acyclic, inlined as a nested body.<br>(3) continue-as-new: deferred.<br>Also fix `construction-durable.mjs:191`, which is stale. | own-build | S: Temporal child-workflows, limits and continue-as-new docs; Inngest step.invoke; Restate sagas guide (registration order corrected); Atomix 2602.14849 and Cordon 2606.17573 (references, not dependencies).<br>U (skeptic input cut off): Temporal saga page and Saga.java; DBOS; Serverless Workflow; AWS SFN; 2609.15397. | 0 tokens, $0.<br>Journal: about +1 event per compensable node.<br>[obs] 3.0 events per loop iteration, so at most about 3K events against Temporal's 51,200: continue-as-new is not needed now.<br>Engineering: compensate 12–16 h; call 8–12 h. | `schemas/workflow.schema.json:141`; `src/validate.mjs`; `src/runtime.mjs` (around 750, :729); `src/verify-run.mjs`; `src/construction-objective.mjs`; acceptance via `capabilities.mjs:711` compensationLedger.<br>Ship with #78. | $0: LIFO order; SIGKILL between effect and journal still compensates exactly once; resume after a mid-compensation kill completes each compensation once; budget exhaustion gives compensation_failed; cancel compensates. `call` matches its hand-inlined equivalent; FRAME_DRIFT fires on a child hash change. | open → in-flight (#75, lands with #78) |

### D. Governance and the principal model

| id | Chosen fix | Kind | Sources | Efficiency effect (tokens, $, latency, engineering) | Adoption (files, effort) | Test that proves it | Status suggestion |
|---|---|---|---|---|---|---|---|
| D1 | A native principal and authority layer, about 300 lines with no new dependency:<br>• A hash-pinned role matrix, promoted from the OT-0 constitution code.<br>• `authority:{role, distinctFrom, limit}` on human and approval nodes.<br>• A static workflow-satisfiability check (separation of duty, binding of duty, cardinality) that returns an unsat core.<br>• approve() and answer() take a principal; SoD is checked against the run's own journal; delegation can only narrow.<br>• **Cap at k≤20 steps** (fixed-parameter tractable only for user-independent constraints), and add structured hard instances. | own-build | S: 1504.02420; 2105.03273; AWS AgentCore temporal policies; the Dogwood repo (not for production); cedar-policy-symcc 0.8.0; Cedar 4.14.0; AuthZEN 1.0; AgentGate; SentinelAgent (self-reported). | 0 tokens, $0.<br>Static check: 21–133 ms, once per workflow version.<br>Runtime: microseconds per approval.<br>Engineering: 14–18 h. | `schemas/workflow.schema.json`; new `src/authority.mjs`; `validate.mjs`; `lint.mjs`; `runtime.mjs:296-337`; `http.mjs:97`; `bin/foundry.mjs:487-497`; `app/core/service.mjs:188`.<br>Ship with the 11-04 engine bump (decision D15). | $0:<br>• 20,000 random instances with 0 disagreements against an exhaustive oracle; 6 of 6 mutants killed.<br>• Pigeonhole-style hard instances are recorded.<br>• OT-0's W-blind lineages are refused.<br>• An edited approver fails verify-run. | in-flight (#74; #78) |
| D2 | An assurance ladder per invariant family:<br>• The achieved rung is min(family ceiling, evidence earned) and is never set by hand.<br>• Auto-demotion when a checker's gate fails.<br>• A lint blocks "proved" or "guaranteed" without a statement behind it.<br>• **Start with `decided` (not "proved"), `enforced`, `monitored` and `judged`.** Reserve "proved" for a mechanised proof.<br>• Emit it as an in-toto Statement (check the spec first). | own-build | S: 2407.01688; SymCert; SLSA v1.2 VSA (shape only); 2205.04522; Agent-C; AgentSpec; PCAS; AgentGate; 2607.18548. | 0 tokens, $0.<br>Generated once per version.<br>Engineering: about 4 h with 3 rungs.<br>Main saving: no over-claim for an auditor to invalidate. | New `src/assurance.mjs` and `schemas/conformance.schema.json`; inputs from `experiments/constitution/{auditor,validity}.mjs`; lint over README.md, docs/ and web/. | $0: the generator never exceeds min(ceiling, evidence); injected solver mutants demote authority; the OT-0 auditor answers Q1–Q5 from the statement; the lint fails on a bare "proved". | open → in-flight (#74) |
| D3 | Anchor by default and close the truncation gap:<br>• appendAnchor on by default at run seal, written outside `.foundry/`.<br>• `verify-run --require-anchor` makes ANCHOR_NONE a failure.<br>• An RFC 3161 stamp of the anchor head from two TSAs, debounced to one per 15 minutes, verified offline with `openssl ts`.<br>• A period manifest recording the **stamped head (sequence number + hash)** and a Merkle root of run anchors.<br>Network stamping on by default needs the owner (D10). | oss | S: live TSA probe reproduced; FreeTSA page; sigstore/timestamp-authority; OpenSSL ts; the NIST OSCAL catalog; RFC 9162 (Experimental status); RFC 9942.<br>U (skeptic input cut off): RFC 9943; Rekor v2; draft-sahu; eIDAS. | 0 tokens, $0 with free TSAs (terms unverified).<br>0.1–0.55 s per stamp, asynchronous; at most 96 stamps per day per TSA.<br>Engineering: 6–8 h. | `src/audit.mjs` (stamp, verify; merkleRoot :36); `bin/foundry.mjs` around 280–310; `src/verify-run.mjs:60-61`; README.md line 129 is stale. | $0:<br>• An edit, a dropped last line, a reorder and a wrong-digest token all fail. Truncation is written as a failing test first, because `readAnchors` accepts it today.<br>• Verification works offline.<br>• 1,000 seals produce ≤96 requests. | open → in-flight (#74) |
| D4 | Not researched. | — | — | — | — | — | accepted (keep) |

### E. Construction quality

| id | Chosen fix | Kind | Sources | Efficiency effect (tokens, $, latency, engineering) | Adoption (files, effort) | Test that proves it | Status suggestion |
|---|---|---|---|---|---|---|---|
| E1 | **Milestone A first:** one targeted gleaning pass over the coverage guard's existing `uncovered` list. Five of the 7 misses, including the go-live sentences, sit in that list.<br>**Then a unit ledger:**<br>• Code segments the text, reusing `specbiz/spec-units.mjs`.<br>• The model labels each unit n, c or x by enum.<br>• Code copies quotes by pointer.<br>• K=3 view-diverse passes, unioned by unit id, with disagreements adjudicated.<br>The A1-C plan of K=3 same-prompt unions caps near 28 of 30.<br>**Fix first:** score against the frozen SPEC-E at git 48535bb. | own-build | S: google/langextract; 2404.16130 (GraphRAG gleaning); 2405.02732; 2408.02442; 2607.04448; 2604.02276; 2505.12570; Petersson 2004; 2310.10996; Anthropic pricing. | Milestone A: about $0.002 per run; 2 h plus 1 h.<br>Unit ledger [est]: $0.01–0.015 per K=3 set against $0.035 today; 45–75 s per set; 6–8 h. | `experiments/tracker/run.mjs` (second pass over `ledger.uncovered`); later `extract.mjs`, `ledger.mjs` and units. | $0: segmenter is exhaustive; quotes are verbatim by pointer; chao1 = 29.14.<br>Paid ≤$0.05: minimum recall ≥0.93 across 3 repeats; go-live lines 91–93 covered 3 of 3. | in-flight (A1-C) → re-scope; Milestone A to #72 |
| E2 | Measure derivation alone before paying for builds:<br>• SPEC-1a, derive-only, using E1's extractor.<br>• A $0 scorer against the authored anchors.<br>• **Gate on the 23 text-carried ids, not 27** (a text-only extractor can reach at most 0.852 of 27).<br>• Code-owned conflict settlement.<br>• Pay $8–16 for SPEC-1 only if text recall ≥0.8.<br>• Defer the records falsifier and information-gain question ranking. | own-build | S: 2502.04485; 2604.09408; 2602.18306; 2602.10525; 2607.25398; 2609.30055; MMEnterprise-Bench; RunVS; Lindner & Lopez; PM4Py (rejected, AGPL). | [est] $0.02–0.05 per pack; about $0.45 for seeds 1–3, against $5–10 for a SPEC-1 derive arm.<br>Engineering: 10–12 h. Depends on E1. | New `experiments/specbiz/{derive,derive-score,settle}.mjs`. | $0: an oracle derivation scores 23 of 23; planted stale, unauthorised and distractor citations land in the right buckets.<br>Paid about $0.45: text recall ≥0.85; at most 1 stale-or-unauthorised rule followed per pack. | in-flight (#72) |
| E3 | Not researched. | — | — | — | — | — | accepted (keep) |
| E4 | **Reframe the compromise.**<br>• ch-e8-1 is a complete composed solver: 974/1022, 0 interface violations; its 48 failures are the E1 go-live defect.<br>• ch-e8-2 cost $0.53 and passed 955/1022 with different decision errors.<br>• So the open risk is build-to-build variance (B7), and composition is not intrinsically 3–4.5x the monolith cost.<br>Three cheap gates:<br>(1) Every ledger unit must have an owner module before smoke or grading.<br>(2) `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000` for Haiku builders.<br>(3) Vote composed programs, then repair only the owning module. | own-build | S: Anthropic long-prompt price tier; env-var docs (CLAUDE_CODE_AUTO_COMPACT_WINDOW, cited by the skeptic); 2402.13521; 2404.10100; 2504.09246; MAST.<br>U (skeptic input cut off): CodeChain; Aider; Pact; fast-check. | Gate: $0, 3 h.<br>Compaction: 81 of 87 ch-e8-1 calls were above 100K tokens, billed at 5x. Price range $0.45 (all low tier) to $2.25 (all high tier); the CLI reported $1.73. Saving is at most about 2–4x, as an upper bound. A probe build costs $0.5–1.5.<br>Vote: $0 (artifact unreproduced). | `bundle.mjs` with `--ledger`; `nversion.mjs` with `--program`; `repair.mjs` owner hint; childEnv list (owner). | $0: the gate rejects ch-e8-1 as built.<br>Paid ≤$1.5: a compacted build costs ≤$0.90, passes ≥0.95, and has ≤30% of calls above 100K. | in-flight (#69) |

---

## 2. Ranked adoption plan

**Score = D × L / C.**
- D is the damage removed, from 1 to 5. 5 means it invalidates a claim or blocks a track, which AGENTS.md treats as an invalid evaluator.
- L is the likelihood the fix works, judged from its evidence state.
- C is agent-hours plus paid dollars, counting $1 as 1 h.
- On ties within 10%, the higher-damage action goes first.
- The scores are judgment calls; the order holds within about a factor of 2.

| rank | action | ids | track | D | L | C (h + $) | score |
|---|---|---|---|---|---|---|---|
| 0 | Register and documentation corrections (bundle, below) | many | #77 | 2 | 1.0 | 1 | 2.0 |
| 1 | Mercury loop guard with an idempotent write cache | A2a | #73 | 4 | 0.9 | 3 | 1.20 |
| 2 | Pin the CLI by hash; stopgap today | C2 | #75 | 3 | 0.95 | 3 | 0.95 |
| 3 | Gleaning pass over the uncovered list + frozen SPEC-E scoring | E1 | #72 | 4 | 0.7 | 3.05 | 0.92 |
| 4 | Seeded SOP-Bench tools + reachability | B2 | #70 | 3 | 0.9 | 3 | 0.90 |
| 5 | Ledger-ownership gate for composed builds | E4 | #69 | 3 | 0.7 | 3 | 0.70 |
| 6 | Build-level stats module + prereg template | B7 | #69 | 4 | 0.85 | 5 | 0.68 |
| — | Keyed start (owner-gated; it would rank here) | B6 | #69/#75 | 3 | 0.8 | 4 | 0.60 |
| 7 | Group-sequential design + co-primary metric, before the next paid comparison | A4 | #64 | 4 | 0.85 | 6 | 0.57 |
| 8 | Haiku 100K price cliff: compaction-window probe | E4 / A7 | #69 | 4 | 0.5 | 3.5 | 0.57 |
| 9 | Mercury `instant` effort + dose measurement | A6 | #73 | 1.5 | 0.5 | 1.53 | 0.49 |
| 10 | Knowledge-cut oracle + shared R5.2 monitor + fuzzer | B5 | #69 (#59) | 5 | 0.7 | 8 | 0.44 |
| 11 | Shell-state persistence | A8 | #73 | 1 | 0.9 | 2 | 0.45 |
| 12 | Warm-then-fan-out (only if a Sonnet A1-C run is planned) | A7 | #64 | 1.5 | 0.5 | 2 | 0.37 |
| 13 | Escalation gate: measure recall | A5 | #64 | 3 | 0.4 | 3 | 0.40 |
| 14 | Assurance ladder, 3 rungs | D2 | #74 | 2 | 0.8 | 4 | 0.40 |
| 15 | Default-on anchoring + stamped head | D3 | #74 | 3 | 0.9 | 7 | 0.39 |
| 16 | Masking, api_search only, after the A2 re-measure | A1 | #73 | 3 | 0.6 | 5.5 | 0.33 |
| 17 | Vote + owner-scoped repair | E4 | #69 | 3 | 0.6 | 6.2 | 0.29 |
| 18 | QuickJS module sandbox | C1 | #69 | 3 | 0.85 | 10 | 0.26 |
| 19 | Principal layer (scheduled for the 11-04 bump) | D1 | #74 | 4 | 0.8 | 16 | 0.20 |
| 20 | SPEC-1a derive-only | E2 | #72 | 3 | 0.7 | 11 | 0.19 |
| 21 | Stop gate for CLI sessions (§3.1) | A2b | #64 | 3 | 0.3 | 5 | 0.18 |
| 22 | Contamination DiD | B8 | #72 | 2 | 0.7 | 8.5 | 0.16 |
| 23 | IR `call`, then `compensate` | C6 | #75 | 2–3 | 0.7–0.8 | 10–14 | 0.15 |
| 24 | Propensity layer labels (only if a per-layer claim is needed) | B3 | #72 | 1.5 | 0.6 | 4.2 | 0.21 → deferred |

**Top 10 total:** about 38 agent-hours, about $1.6 of Claude spend, and ≤0.25M Mercury tokens (optional T3 runs are extra). A2 and E4 give the largest cost reductions: A2 cuts Mercury tokens by about two-thirds, and the E4 probe could cut Haiku builder cost by up to about 2–4x.

### Action 0 (#77, about 1 h, $0): correct the register before handing anything out

Each correction is a text edit, made with a dated note in the owning document:
- **A1:** mean input is 34K tokens per response (95.96M / 2,821), 98.3% cached.
- **A2:** Mercury's failure is repetition loops (52 of 52 cap tasks), not missing done-signals; Haiku's early stops are a separate problem.
- **A4:** k≥2 per task is the less efficient way to buy power; use more tasks.
- **A6:** the premise is wrong: `instant` exists, the default is `low`, and the executor refuses `instant`.
- **A7:** PREREG-NEED-V1 line 552 lists Sonnet 5.5 cache reads at $0.20; the documented rate is $0.10. Fix it by amendment. The Mercury policy row says 0/0, while the docs list $0.10 / $0.01 / $0.35.
- **B2:** the 36% is confirmed, and 8 of 20 dev rows are unreachable by any draw.
- **B3:** the implied-versus-latent boundary κ is 0.36; 0.57 is the 3-class figure.
- **B6:** the monoliths lose 8–11 of 43, not 32–35. Label dup-same as diagnostic in HARNESS.md and exclude it from pooled numbers.
- **B8:** 77 n8n templates are after the cutoff, not 203.
- **C2:** 2.1.300 is still on npm, so a1s-dev60-dn was resumable.
- **C6:** `construction-durable.mjs:191`'s claim about wait timing is stale (`runtime.mjs:576-585` and `tests/timers.test.mjs:54`).
- **D3:** README.md line 129 is stale; journal rows, decisions and transcript hashes are already bound into the chain.
- **E1:** the A1-C plan of K=3 same-view unions likely caps near 28 of 30.
- **E4:** ch-e8-1 is a complete composed solver, and ch-e8-2 exists ($0.53, 955/1022).

### Top 10 actions, ready for a builder

**1. A2a: Mercury loop guard (#73). Budget 3 h, $0; T3 optional ≤0.5M Mercury tokens.**
- Add `loopGuard` to `src/executors/openai-chat.mjs`:
  - Fingerprint every call as `${tool}:${canonicalJSON(args)}`.
  - Classify a call as a write by the existing write-class rule.
  - Serve a repeated identical write from cache, appending "duplicate call suppressed; result of the first call shown", but only when the first result was not an error. After an error, re-execute up to 2 times.
  - Strike = identical call AND byte-identical result. Re-calls of A1-masked ids are exempt, for forward compatibility.
  - After 3 strikes, send one request with `tool_choice:'none'`, then end with SessionStop `EXECUTOR_LOOP` and subtype `error_loop`.
- In `experiments/lib/runner.mjs`, class EXECUTOR_LOOP as an outcome, not an ENV_FAULT.
- Write `loopStrikes` and `suppressedDuplicates` to summary.json.
- Tests:
  - New cases in `tests/openai-chat-executor.test.mjs` (the T1 list in the A2 row).
  - Port the scratch replay to `experiments/mercury/replay-loop.mjs` and run it on the 60 transcripts: ≥90% of the 52 cap tasks stop by step 25; input ≤35%; both passing tasks unchanged.
- Stop rule: if the replay cuts either passing task, raise the strike threshold before shipping.
- The stopGate is not part of this action.

**2. C2: pin the Claude CLI (#75). Budget 3 h, $0.**
- (a) Today: add `DISABLE_UPDATES` to `CHILD_ENV_ALLOWED` (`src/models/policy.mjs:67`, policy version bump) and set it in the child env.
- (b) Write `research/manifests/claude-cli.lock.json` with: version 2.1.306; the sha256 and size from `https://downloads.claude.ai/claude-code-releases/2.1.306/manifest.json` (GPG-verified once, fingerprint `31DD DE24 … CACE`); the npm sha512 as a second root; URL, date, licence and outcome, per the AGENTS.md acquisition rule.
- (c) `scripts/fetch-cli.mjs`: fetch the raw binary into `.foundry/cli/<sha256>/claude` and verify it. Never run `npm install`. Keep at most 2 versions, and never delete one referenced by an unfinished run's launch.json.
- (d) `src/cli-pin.mjs` `resolveCli()`: return the absolute path; hash once per process, cached by size, mtime and inode; throw CLI_DRIFT on mismatch.
- (e) Wire it into `claude-cli.mjs:120-138`, `claude-code.mjs:293`, `foundry.mjs:171` (`cliIdentity`) and `run.mjs:282-307` (the manifest stores `cli:{version, sha256}` and resume compares sha256).
- Test: `tests/cli-pin.test.mjs`, the 6 checks in the C2 row, using the existing stub `experiments/orch/probes/cli-stub-api.mjs`.
- Disk guard: refuse to fetch if free disk is below 1 GB.

**3. E1 Milestone A: gleaning over uncovered sentences (#72; feeds #69 builder checklists and #64 A1-C ledgers). Budget 3 h, ≤$0.05.**
- First, make `experiments/tracker/eval-e8.mjs` score against the frozen SPEC-E (`git show 48535bb:beds/ebed/e8/spec/SPEC-E.md`) with the frozen gold. Today it crashes on the working-tree file (null anchor). Add a test that fails if the SPEC-E hash differs from the gold's.
- Then add a second pass in `experiments/tracker/run.mjs`: send the sentences in `ledger.uncovered` (about 37) to Haiku with "these sentences may state conditions; return entries or 'none' per sentence", and merge them into the ledger by quote pointer.
- Accept: on the frozen primary sample (s0), recall goes from 0.77 to ≥0.90, and the go-live lines (frozen 91–93) are covered. Cost ≤$0.005 per run.
- Report the result as development evidence only (SPEC-E is in-sample for the prompt).
- Hand the result to #69, where ch-e8-1's 48 failures come from this defect.

**4. B2: seeded SOP-Bench tools and reachability (#70). Budget 3–4 h, $0.**
- In `experiments/sopbench/bridge.py` `World.call`, replace `random.random()` (`tools.py:42`, `:100`) with `random.Random(int(sha256('sop-bench/content_flagging|row|tool|'+canonical_args)[:16],16))`.
- Add a `reach` command:
  - Enumerate threshold-equivalence cells of (bpi, device_consistency) [inf].
  - Cross-check against the exhaustive 101×101 lattice on the 20 dev rows, which must give 12 reachable and 8 unreachable.
  - Write `{reachable, consistentCells, proof}` per row as hashes into `research/sopbench-20261021/SPLIT.json` `contentFlaggingReach`.
- The scorer marks unreachable rows `label-tool-inconsistent`, excludes them from the strict macro score, prints the count, and prints the majority-label baseline beside every score.
- Pre-register "unreachable rows are reported, never scored" before any sealed run.
- Tests: on a toy fixture only, never on SOP-Bench rows (B2 row). Add the INV-2 repeatability check to `parity.mjs`.

**5. E4: ledger-ownership gate (#69). Budget 3 h, $0.**
- Add `--ledger <ledger.json>` to `experiments/compose/bundle.mjs` `programProblems()` and to the `kit/compose.mjs` check. Fail when a ledger unit is not owned in `modules[*].rules` or by a `parent.rules` claim.
- Put the E1 ledger in `build.mjs`'s task text (about 2.8K tokens).
- Update COMPOSE.md.
- Accept:
  - ch-e8-1's manifest is rejected (it owns 15 of 30 gold ids; nothing owns SPEC-E §3.5).
  - It passes once owners are added.
  - Re-grading ch-e8-1 and ch-e8-2 is unchanged at $0, because the gate is pre-build.
- Record ch-e8-2 in the E4 analysis.

**6. B7: build-level inference (#69; the module is shared with action 7). Budget 5 h, $0.**
- Create `experiments/lib/stats-builds.mjs` on top of `experiments/lib/stats.mjs` and `beds/lib/rng.mjs`. It provides:
  - an exact build-level permutation test;
  - a beta-binomial posterior with a build random effect, paired across shared worlds;
  - a power simulator taking measured σ_b and cases per build;
  - a sequential rule in blocks of 2 builds, with K_max 12.
- Update `research/PREREGISTRATION-TEMPLATE.md`: unit = build, K schedule, stop rule, MDE from measured σ_b, ≥400 cases per build.
- Update the `experiments/agentv/run.mjs` preregBanner.
- Amend PREREG-COMP1 M1 before the next paid C-H build.
- Tests: `stats-builds.test.mjs`, the five checks in the B7 row. Teeth: the case-pooled method must show about 25% type-I in the same simulation.

**7. A4: group-sequential dev design (#64). Budget 6 h, $0 to build. The prereg amendment must land before any new paid comparison.**
- Add `obrienFlemingBoundary`, `pocockBoundary`, `mixtureEvalue`, `pairedPermutation` and `pairedBayesInterval` to `experiments/lib/stats.mjs`, re-exported from `experiments/jit/stats.mjs`.
- New `experiments/autobench/sequential.mjs`:
  - Look 1 = the stored dev60 rows.
  - Looks 2–3 = disjoint batches of 60 unexposed dev-train tasks, via `run.mjs --subset 60 --seed S`, with the look number and boundary written to each launch.json.
  - Stored A0 outcomes are the control.
  - Never select devCheck tasks: assert against the devCheck hash list in PREREG-AB-v1.
- Amend PREREG-AB-v1 with:
  - the co-primary paired partial-credit permutation (strict pass stays the headline);
  - the O'Brien-Fleming schedule;
  - a note that the A1 effect size is in-sample, so power is optimistic.
- Tests: T1 to T3 in the A4 row; A/A check about $1.

**8. E4/A7: Haiku 100K price-cliff probe (#69; results also go to #64). Budget 2 h + one build ≤$1.5.**
- First, at $0: count the share of calls above 100K tokens in the existing A1-C and B1L-H transcripts, to size the lever.
- Add `CLAUDE_CODE_AUTO_COMPACT_WINDOW` to the closed childEnv list. This is a policy file change with a version bump, so it needs the owner.
- Run one C-H build with value 100000.
- Accept if:
  - compaction fires in `claude -p`, visible in the transcript;
  - cost ≤$0.90 (against $1.73);
  - grading pass ≥0.95;
  - ≤30% of calls are above 100K.
- Refuted if compaction never fires or the pass rate is below 0.90. If so, fall back to per-module sessions (10–14 h, deferred).

**9. A6: Mercury `instant` (#73). Budget 1.5 h, ≤0.24M Mercury tokens (inside the D8 5M cap).**
- `EFFORTS = ['instant','low','medium','high']` at `openai-chat.mjs:48`, plus the T1 test.
- New `experiments/mercury/effort-dose.mjs`: 6 fixed multi-step problems × 4 levels × 5 repeats, with a token cap; record reasoning_tokens, completion tokens, latency and correctness.
- Accept the lever per T2 in the A6 row. Otherwise close A6 as "measured, no effect, CI …".
- Keep it out of benchmark arms until it is measured.
- Ask the owner to update the policy note and the shadow price.

**10. B5: knowledge-cut oracle (#69, inside #59). Budget 8 h, $0.**
- In `beds/ebed/oracle/grade.mjs`, judge `outside-allowed` (:154) against the journal prefix at the emission's start. Items of one emission are concurrent.
- Extract one `permanentFailure(prefix, step, item)` monitor, used by both `transition.mjs` and `experiments/compose/capabilities.mjs`.
- New `beds/ebed/e8/fuzz-legal.mjs`: the reference policy with seeded freedom inside the spec. Add a ≥10-case hand-audited illegal-variant set that the oracle must reject.
- Accept: the B5 test list.
- Publish the regrade table for the B1L-H lineage and agent-H journals before any changed number is used; old numbers are marked superseded.

---

## 3. No adequate fix exists today: build our own

**3.1 A stop gate for CLI sessions under `--safe-mode` (A2b; Haiku's 15% early stops).**
Stop hooks are disabled by `--safe-mode`, and the Push Your Agent paper (2605.23574) shows a gate alone does not raise pass rate. Design:
- The host runs the A1-C hard checks when a session ends.
- If they fail, resume the **same** session id with `claude -p --resume <id> "Not done: <failing checks + evidence>"`, instead of opening a new repair-N session. The identical prefix means cache reads, no new cache write and no cold start. That this works under `--safe-mode` is untested.
- Cap at 2 resumes, then fall back to the existing repair session.
- Test: paired runs on the 12 early-stop tasks; cache_read share of the resume ≥90%; early stops ≤3 of 12; cost ≤+10%.

**3.2 An escalation gate with an audited blind spot (A5).**
The cascade literature says the quality estimator is the open problem (2410.10347) and that cheap verifiers hide errors from their own dashboard (2609.01345). Design:
- The gate = the A1-C code checks.
- The metric is measured *outside* the gate: recall against the official grade, plus an independent audit of 20 accepted tasks per run.
- Escalation is logged per rule.
- Auto-disable the cascade if audited blind-spot recall drops below 0.77.

**3.3 Benchmark tool repair with a reachability proof (B2).**
No OSS repairs a benchmark's tools. Design:
- Pure seeded tools.
- An exact enumeration of the decision cells the downstream chain branches on.
- Per row: reachable, plus the set of label-consistent cells, plus the proof.
- The upstream label is used only where reachable; otherwise the row is reported as a benchmark defect.
- Generalise it into `experiments/sopbench/reach` for any toolset that uses `random`.

**3.4 Oracle soundness for concurrent emissions (B5).**
TLA+ trace validation is the right semantics, but writing a TLA+ spec of SPEC-E is days of work. Design:
- Knowledge-cut judging, with one monitor shared by oracle and contracts.
- A two-sided ledger: soundness from the legal fuzzer plus the hand-audited illegal set; completeness from the 304 mutants.
- Every oracle change ships with a regrade table.

**3.5 Workflow-level separation-of-duty satisfiability (D1).**
No OSS solver for the workflow satisfiability problem exists, and Cedar decides single requests. Design:
- Backtracking with minimum-remaining-values ordering over the steps, with deletion-minimal unsat cores.
- Constraints restricted to user-independent ones (distinct, same, atMost), with a step cap of k≤20; journal-derived dynamic separation of duty is checked at runtime only.
- A differential test against an exhaustive oracle, a mutation gate, and a pigeonhole hard set.

**3.6 A graded assurance ladder for agent workflows (D2).**
2607.18548 calls for one and none exists. Design:
- A closed rung enum: decided, enforced, monitored, judged.
- Per-family ceilings from ATTACK-FABLE §2.4.
- The rung is computed, never requested; demotion happens in CI.
- The statement is an in-toto Statement with a custom predicateType.

**3.7 Requirement extraction as accounting (E1).**
LangExtract repeats one view and has no per-unit accounting. Design:
- Exhaustive code segmentation; one disposition per unit (n, c or x).
- View-diverse passes; a union by unit id.
- An invariant of 0 undisposed units after one re-queue.
- Quotes copied by pointer, so there are no paraphrase losses.
- Chao1 as a reported lower bound, not as a stop rule.

**3.8 Code-owned conflict settlement for messy-business derivation (E2).**
The model emits only (unit, value, source pointer). Code settles conflicts by an owner-declared authority roster (tied to D1), newer-wins and more-specific-wins. Anything left unsettled becomes an owner question, asked only where K candidates disagree.

**3.9 Measurement constructs (B3, B8).**
- Layer labels by propensity: the share of no-knowledge default drafts that include a unit, with model and date frozen.
- Template contamination by a twin difference in differences with a post-cutoff placebo.
- Both are $0–3 and deterministic except for the drafts.

**3.10 Compensation in a typed JSON IR (C6).**
Temporal and Restate give patterns, not an IR. Design:
- `compensate:{tool, args, register:'before'/'after-reserve', retry}` on task nodes.
- A synthetic `__compensation__` frame drained LIFO.
- The validator refuses irreversible capabilities.
- A verify-run invariant: every completed compensable node is compensated, or the run succeeded.

---

## 4. Where the skeptic overturned a researcher

| id | Researcher said | Skeptic found | Change adopted above |
|---|---|---|---|
| A1 | Cut the per-call clip from 30K to 10–12K chars. | Only 14 of 4,324 outputs exceed 10K (2.7% of characters). | The clip change is dropped. |
| A1 | The placeholder says "call again if needed". | An identical re-call counts as an A2 strike, and 3 strikes kill the session. | Masked re-calls are exempt from strikes. |
| A1 | Build masking now. | A2 alone leaves 28–34% of input. | Ship A2 first, re-measure, start with api_search only. |
| A1 | OpenHands documents observation-masking condensers; Complexity Trap halves cost in all 5 configs. | The condenser page lists neither of those condensers. Cost halved in 4 of 5 configs; W=10 is scaffold-specific (OpenHands needed 58). | Dropped as evidence; caveats added. |
| A2 | Confidence high for the whole bundle; 2605.23574 supports the gate. | That paper shows gate-alone gains are inside the CI and that it completes 0 tasks on DataOps-lite. The gate's evidence comes from Haiku via the CLI, which this executor cannot test. | The stop gate is split out (§3.1). |
| A2 | Accept at T2 input ≤30%. | The simulated rule stops at the 3rd call; the rule as built stops at the 4th–5th (32–34%). | T2 bound set to ≤35%. |
| A2 | Never re-execute a duplicate write. | 318 of 1,735 duplicate writes returned different results, and 35 followed an error. | Errors are never cached. |
| A4 | 5 looks of 60 from the 300-task dev pool. | That would consume devCheck, which is reserved (≤3 looks). | Looks run on dev-train only. |
| A4 | Pocock boundaries. | O'Brien-Fleming keeps power at 0.958 against Pocock's 0.924 (−32% runs against −44%). | O'Brien-Fleming is the default. |
| A4 | Type-I about 0.018. | That counts one direction only; two-sided is about 0.036. The effect size is in-sample. The cited scripts do not exist. | Corrected. |
| A4 | Cost about $5 per comparison. | Reusing stored A0 outcomes halves it. | About $2.5. |
| B2 | About 15 min of CPU for the sealed set. | About 1 h exhaustive. | Threshold-cell enumeration [inf], to be validated on dev. |
| B2 | ABC checklist published at NeurIPS 2025 D&B; an "Ignored Argument" rule in 2609.37315; Chen found a reward bug. | The venue is unverified; the rule name does not exist; Chen's figure comes from the authors' own harness. The contract checker needs new contracts and missed most injected defects. | All dropped or reworded. |
| B3 | Run the propensity pilot. | The cheapest sufficient step is $0: report both ways and correct the boundary κ. A third model family needs a policy edit, and the label is model-relative. | $0 step first; propensity only if needed. |
| B5 | Any fuzzer rejection is an over-strictness bug "by construction". | That is circular unless the generator is checked. The Elle venue was wrong. | A hand-audited illegal-variant set is added. |
| B6 | Keyed start is a host patch. | It also changes SPEC-E, so frozen arms need a version bump and reruns. | Owner-gated; relabel now. |
| C1 | 23x slowdown on compute-heavy steps. | Measured about 2.5x. | The ≤3x performance gate decides. |
| C1 | quickjs-ng releases list "many use-after-free fixes". | Not on that release page. | Claim dropped; quickjs-ng tried only if journals are byte-identical; worker_threads step 0 kept as fallback. |
| C2 | Extract from the npm tarball; build the wire-fingerprint tool. | The signed raw-binary manifest is simpler (−1 h). A zero-code stopgap exists today. The fingerprint tool is not needed. | All adopted. |
| C6 | Always register compensation before the effect. | Restate says register after the reservation for reserve-then-act APIs. | The IR declares the registration point per node. |
| D1 | Backtracking is enough because the problem is FPT. | FPT holds only for user-independent constraints (it is W[1]-hard in general). | Step cap k≤20 and a structured hard set. |
| D2 | Top rung "proved-in-model". | That is the over-claim D2 exists to prevent. 2607.29405 is a mapping study, not a call for a ladder. | Rung renamed `decided`; 3 rungs; source dropped. |
| D3 | Adopt RFC 9162 as standards-track. | RFC 9162 is Experimental. Truncation still passes unless the stamped head is recorded. | Head recorded in each manifest; RFC 9162 adopted as hashing rules only. |
| E1 | Score against "25 KB, about 340 units, lines 97–99". | That mixes the frozen and current SPEC-E; the scorer crashes on the current file. Sentence units can fail gold-span containment. `spec-units.mjs` already exists. | Score against frozen 48535bb; segment on gold-compatible boundaries; reuse spec-units. |
| E1 | LangExtract docs warn that 3 passes triple cost. | Not in the docs. | Dropped. |
| E2 | Gate on 27 documentary ids. | 4 of those are only in CSV records, so a text extractor can reach at most 0.852. | Gate on 23 text-carried ids; records falsifier and question ranking deferred. |
| E4 | Composition costs 3–4.5x the monolith. | ch-e8-2 was omitted ($0.53, a different defect). The vote result has no saved artifact. | Reframed as a variance (K) problem, handed to B7. |
| E4 | `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` at about 8–9%. | `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000` is the documented, exact lever. | Adopted; saving treated as an upper bound until the probe runs. |

**Owner decisions these fixes need:**
1. Unfreeze the host and bump SPEC-E (B6).
2. `policy/models.json` edits: price fields, Mercury shadow price, knowledgeCutoff, the childEnv entries DISABLE_UPDATES and CLAUDE_CODE_AUTO_COMPACT_WINDOW, and a third model family (A6, A7, B3, B8, C2, E4).
3. Whether the CLI login is a subscription or API-billed (FORCE_PROMPT_CACHING_5M).
4. One Inception dashboard reading, to learn how cached tokens are metered.
5. Network TSA stamping on by default, and a TSA vendor (D3).
6. Any `grade.mjs` change requires a regrade table (B5).