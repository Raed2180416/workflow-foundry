# FRONTIER-GAPS: why the Foundry JIT is blocked, which of its ideas are wrong, and what to test next

*research/jit-20261008/FRONTIER-GAPS.md · 2026-10-09*

**Sources.** This document synthesises:
- the gap inventory (2026-10-09);
- eight read-only frontier sweeps:
  - synthesis from traces;
  - verification without oracles;
  - cascades and routing;
  - small-judge distillation;
  - durable-execution OSS;
  - JIT/runtime analogies;
  - noisy demonstrators and weak supervision;
  - interactive tasks and composition;
- a rigor review and an ambition review of the first draft;
- two $0 read-only re-measurements of the dev streams, at 03:55 and 04:22 UTC. Several arms were still running at both reads.

**Evidence class.**
- Everything here is development or diagnostic: dev seeds, K=1 streams, K_c=1 compiles.
- Nothing is claim-bearing, and every comparison is directional.
- "Supported" and "contradicted" are dev statuses, not findings.

**Integrity caveat.** Read §0.4 before using any comparison between arms. The S/H interpreter ran shell globs over the shared stream workdir root, which also holds the workdirs of concurrently running sibling arms. Nobody knows whether it read anything there. Until P2 is done, treat these as provisional:
- every S/H row;
- S4;
- the reading "Opus is a perfect reference".

**Tags.**
- **[M]** I recomputed it read-only from `experiments/runs/jit/**/{results,events}.jsonl` and `traces/`, at $0. It is as of 03:55 UTC unless marked **04:22**.
- **[D]** It is documented in the cited repo file and was not re-measured.
- **[I]** My inference.
- **[P]** A paper result as reported, at abstract level unless stated.
- **[S]** System documentation or practice.
- "Unverified" marks a source that was not opened, or a figure that did not match its source.

**Relation to THESIS-JIT §6.** This document treats §6's ten reframings as hypotheses. §3.17 stress-tests them.

---

## 0. Evidence snapshot

### 0.1 Arms

**Records, dev seeds 201–224.** Seeds 201–216 are d3; 217–224 are d4 drift. [M]

| arm | pass | d3 | d4 | total $ | $/success | wrong compiled / compiled outputs | corrected | hidden-path attempts |
|---|---|---|---|---|---|---|---|---|
| Opus agent | 24/24 | 16/16 | 8/8 | 13.54 | 0.564 | — | — | 9 (d4 seeds) |
| JIT Sonnet → Haiku (S/H) | 22/24 | 14/16 | 8/8 | 8.99 | 0.409 | 2/19 | 0 | **14 on 4 tasks** (§0.4) |
| JIT Opus → Haiku (O/H) | 18/24 | 12/16 | 6/8 | 7.53 | 0.418 | 7/19 (6 delivered, 1 caught) | 1 | 3 |
| JIT Haiku → Haiku (H/H), **04:22**, 19 of 24 tasks done | 10/19 | 8/16 | 2/3 | 3.24 | 0.324 | 7 known wrong of 12 (s219 undetermined) | 0 known | 0 |
| Sonnet agent | 13/24 | 5/16 | 8/8 | 7.05 | 0.543 | — | — | 3 |
| Haiku agent | 15/24 | 9/16 | 6/8 | 2.46 ($0.103/task) | 0.164 | — | — | 0 |
| static C0 solver | 16/24 | 14/16 | 2/8 | 1.21 | 0.076 | 8/24 | none (no detector) | 0 |

**Kinetics, d4 then d5 drift, as of 04:22.** The JIT arms are still running. [M]

| arm | tasks | pass | $ | compile $ | $/success | compiled delivered (wrong) | deopts by kind |
|---|---|---|---|---|---|---|---|
| Haiku agent | 24 | 17/24 | 2.10 ($0.088/task) | — | 0.124 | — | — |
| Sonnet agent | 24 | 17/24 | 7.40 | — | 0.435 | — | — |
| JIT H/H | 12 | 8/12 | 12.09 | 9.63 | 1.51 | 5 (2) | judge 3, guard 1 |
| JIT O/H | 17 | 15/17 | 17.82 | 11.56 | 1.19 | 10 (1) | guard 3, judge 1 |
| JIT S/H | 8 | 4/8 | 15.59 | 13.94 | 3.90 | 2 (2) | guard 4 |

### 0.2 What the evidence says

**S1. Silent error is the dominant failure.**

| | 03:55 | 04:22 |
|---|---|---|
| Wrong compiled outputs | 17 of 56 (records 15/48, kinetics 2/8) | at least 21 of 67 (records 16/50, kinetics 5/17), plus H/H s219, undetermined |
| Corrected | 1: O/H s217, by an Opus shadow plus an Opus adjudication | still 1 known |
| Flagged by a Haiku shadow but unresolved, wrong answer delivered | 2: H/H s208, s214 | 3: adds kinetics H/H s209 |

- No guard, invariant or judge check deopted on any wrong output. Every one ran with status `ok`.
- Whether `flow.flag` fired on them is not recorded (N1).

**S2. Shadows catch errors when they run, but rarely run, and they raise false alarms.**
- At 03:55 there were 11 shadows over 56 outputs (20%):
  - 3 landed on wrong outputs, and all 3 disagreed;
  - 8 landed on correct outputs, and 3 of those disagreed (S/H s215 and s221; kinetics O/H s207), so specificity was 5/8.
- At 04:22 there were 14 shadows over 67 outputs (21%):
  - all 4 shadows on known-wrong outputs disagreed, as did the one on s219;
  - 9 landed on correct outputs, and 4 of those disagreed (adding kinetics O/H s214), so specificity was 5/9.
- Only 4 of the 21 known-wrong outputs were shadowed at all.
- The schedule is periodic, every 4th compiled `ok` run (`stream.mjs:23`), not random.
- Each false alarm buys an adjudication: about $0.07 on Haiku, $0.31 on Sonnet, and $0.46–0.64 on Opus.
- The claim "a shadow that looks, sees" rests on 4–5 cases.

**S3. Adjudication: 9 disagreements by 04:22.**
- **Resolved, 4:**
  - S/H s215 and s221, in favour of the compiled answer, which was correct (Sonnet adjudicator);
  - O/H s217, in favour of the interpreter, which was correct (Opus);
  - H/H s219, in favour of the interpreter (Haiku); the delivered answer passed.
- **Unresolved, 5:**
  - H/H s208 and s214 and kinetics H/H s209: the wrong compiled answer was delivered;
  - kinetics O/H s207 and s214: the correct compiled answer was delivered. These look like the D7 exact-compare artefact.
- The predicted harm, a same-model majority outvoting a correct compiled answer, has **not been observed**.
- The harm that did occur is non-resolution followed by delivering the compiled answer: 3 wrong deliveries, all in Haiku-interpreted arms.

**S4. How good a reference is the interpreter? (proxy)**
- Method: the agent arms stand in as counterfactual shadows (same model, same seed, fresh session).
- Limits: it uses pass status only, the discordant counts are tiny (n = 9/7/6), and it may be contaminated (§0.4).

| compiled outputs of | n | compiled right | same-model agent right | P(compiled right given exactly one right) | Opus agent right, same seeds |
|---|---|---|---|---|---|
| S/H | 19 | 17 | 10 | 8/9 | 19/19 |
| O/H | 19 | 12 | 19 | 0/7 | 19/19 |
| H/H (03:55) | 10 | 4 | 6 | 2/6 | 10/10 |

- **O/H.** "0/7" and "Opus is a perfect reference" follow mechanically from the Opus agent going 24/24 on these 24 dev seeds. The d4 seeds also carry Opus hidden-path flags.
- **S/H.** The Sonnet *agent arm* failed more often than the S/H distillate on these seeds, mostly through near-threshold field errors (A7).
  - The agent arm may not be exchangeable with the shadow role. On warmup seeds 201–203 the agent arm passed 1/3 while the S/H interpreter passed 3/3, and two of those three are the globbed seeds (§0.4).
  - The Sonnet adjudications actually observed were right 2/2.
- **H/H.** Haiku solves more tasks than its distillate. The observed Haiku adjudications resolved 1 of 4.
- **Opus shadow on everything.** An Opus shadow on every compiled output would have *detected* all 15 records misses at 03:55. Caveats:
  - detection is not correct delivery, because an adjudication is still needed;
  - it holds only on these 24 dev seeds;
  - the §0.4 caveats apply;
  - it costs about $0.56 per task, the price of the Opus agent.

**S5. Full re-solve shadows cost more than execution.**

| arm | shadows + adjudication | compiled runs |
|---|---|---|
| records S/H | $1.81 | $0.89 |
| records O/H | $2.85 | $0.31 |
| kinetics O/H (04:22) | $1.80 | $1.11 |

- Per event: a Sonnet shadow costs about $0.30 plus about $0.31 to adjudicate; an Opus shadow about $0.55 plus about $0.64.
- The cost of decision-level checks (§6.2) is unmeasured.

**S6. Compiled cost depends on the build, not the method.**
- **Kinetics H/H:** $0.13–0.43 per run at 04:22. That is more than the Haiku agent's $0.088 for an entire task.
- **Kinetics O/H:** $0.011–0.016 per run, or $0.16–0.33 for runs that escalated.
- **Records S/H:** $0.0425 per run, because of its Opus-only `rules` judge (D10).
- **Records O/H:** median $0.009 for `ok` runs (range 0.0038–0.0119, n=19), or $0.017 all-in including escalations (D12).
- The spread within one compiler is about 20–40×.

**S7. On a document-heavy family, compiling is a dev-level cost negative.**
- Kinetics compile spend at 04:22 was H/H $9.63, O/H $11.56 and S/H $13.94. Each is 4.6–6.6× the Haiku agent's whole 24-task stream ($2.10, 17/24).
- Kinetics S/H made 6 compiled attempts: 4 ended in guard deopts and 2 were wrong.
- O/H is the only kinetics arm ahead of the agents on pass rate (15/17 against 17/24).

**S8. A detection did not generalise, and the compiler's own model shows through.**
- O/H's caught miss (s217) became a regression case and drove recompile v3.
- v3 then silently missed s218 (score 0.828444) and s223 (0.664426).
- Both scores equal the Haiku agent's scores on the same seeds to six decimals.
- So the code Haiku compiled from Opus traces fails the same way the Haiku agent does (n=2; §3.16).

**S9. Evidence that arrived after the inventory.**
- **D11:** the tier-down end-to-end result is preserved in `tierdown/`, which resolves inventory F14.
- **D12:** lineage variance.
- **D9:** a heal widened a guard.
- **Heal B.6** [D `DESIGN.md:1013-1019`]:
  - Test: the incident error class was injected into one of three reader samples, on each of 88 recorded reads.
  - Result: the parent v2 silently returned a wrong `succeeded` run on all 88; the healed v3 (k=3 agreement) passed all 88, at +15% cost.
  - Limits: the effect on the natural pass rate is unmeasured. This tests single-sample slips only, not correlated misreads, which is the D11 failure.
- **Deopt kinds** [M]:
  - The S/H drift deopts on s217 and s218 were of kind `invariant`, not `guard`.
  - O/H deopted on s205 and s206 by `judge`.
  - Kinetics S/H's deopts were all `guard`.

### 0.3 Corrections to the inputs and to the first draft

| claim | correction |
|---|---|
| Inventory F1 "6 of 17"; cascades sweep "6 of 24" | 17/56 at 03:55; at least 21/67 at 04:22; 1 known corrected |
| Inventory F5: Haiku agent "$0.062/task" on records | $0.103/task |
| S/H steady state | About $0.0425 + $0.452/4 ≈ **$0.156/task**. That is 1.5× the Haiku agent and 0.28× the Opus agent. Over the whole stream it is 0.66× the Opus agent |
| Kinetics Haiku agent "~10/15" | 17/24 |
| Small-judge K5: "tiering the hot judge is a pure cost play" | Contradicted by D11: Haiku `rules` scored 5/8 end to end against Opus 7/8. Opus `rules` was right on stream tasks (151/151 checkable decisions, [D sweep]), so the misses are not in the hot judge, but tiering it is a reliability risk |
| Draft: heal parent "let 0/88 through" | The parent let **88/88** through; healed v3 caught 88/88 |
| Draft: hidden-path counts "Opus 9, Sonnet 3, S/H 9" | S/H **14 on 4 tasks**; O/H 3 |
| Draft B4: deopt "130×" a run | About 55× the median `ok` run ($0.51 against $0.009); about 30× the $0.017 all-in mean |
| Draft §3.1: O/H price "$2.1" | **$1.93** (v = $0.711, e = 0.368) |
| Draft: "11 Sonnet-agent failures at 0.947–0.981" | **8 of 11**. s212 (0.633), s214 (0.809) and s216 (0.908) are not near misses |
| Draft: gridquest "0/30 at d4–d5; control can be coded 30/30" | regexAgentV2 scores d4 0/1 and d5 0/0 (dev/test). The explorer's 30/30 holds *by construction*: it has perfect perception and is the acceptance certificate. No LM runs exist [D `beds/gridquest/README.md`] |
| Brief: "guard deopt fired on the first d4 task (S/H)" | The S/H deopts on s217 and s218 were of kind `invariant` |
| Draft: kinetics O/H "$11.80 after 9 tasks" | $17.82 after 17 (04:22) |

### 0.4 Integrity and isolation (records stream)

> **Correction (main session, 2026-10-09, measured).** The cross-arm read risk raised in this section is refuted.
> The agent sandbox (`src/executors/claude-code.mjs` `maskSteps`) mounts a private empty tmpfs over
> `/var/tmp/foundry-work` and `/root`, then mounts back only the agent's own workdir. A $0 probe used the real
> `maskSteps` + `sandboxScript` + `UNSHARE_ARGS` with a workdir under `jit-dev-records-1/`:
> - On the host, `ls jit-dev-records-1` showed 8 entries. Inside the sandbox it showed only the probe's own directory.
> - `ls /var/tmp/foundry-work/jit` showed only the path to the probe.
> - `/root/.claude` did not exist.
> - The interpreter's glob `jit-dev-records-1/*/i000*` matched nothing.
>
> The S/H interpreter's globs could therefore resolve only to its own workdir and its own session files. Treat the
> S/H rows, S4 and the Opus-reference reading as uncontaminated by sibling arms. The hidden-path scan is a deliberately
> conservative over-approximation (RESEARCH.md, failure-to-fix chains).


**Hidden-path attempts** [M]:
- Opus agent: 9 (seeds 217–223).
- Sonnet agent: 3 (s215, s218, s223).
- S/H: 14 on 4 tasks (interpreter s201: 4, s202: 3, s217: 5; shadow s211: 2).
- O/H: 3 (shadow s217, adjudicator s217, shadow s221).
- Haiku agent, H/H and static: 0.

**Which paths.**
- Opus and O/H: the sessions' own spill files under the Claude projects directory (rigor review). They look harmless.
- Sonnet agent: its own workdir under guessed sibling names.

**The S/H interpreter globbed sibling arms.**
- In `jit-claude-sonnet-5-5--claude-haiku-5-5/traces/i000-interpreter-b39702.json` it ran `cd /var/tmp/foundry-work/jit/jit-dev-records-1/*/` and `…/*/i000*`. The rigor review found the same in i001 and i010-shadow.
- That root holds every arm's workdir, including the Opus agent's `answer.json` for the same seed, written concurrently.
- Traces store commands but not their outputs, and no command names another arm. Whether any sibling file was read is **unknown**.
- One suggestive fact: both globbed warmups are among the 3 the S/H interpreter passed, while the Sonnet agent arm passed 1 of those 3 seeds.

**Consequences.**
- Arms are not isolated from each other, but AGENTS.md requires an isolated task directory.
- S/H, S4 and "Opus perfect reference" stay provisional until P2.
- P10 must give each arm a workdir root that other arms cannot read.

---

## 1. The deepest ideological gaps

Each item gives the belief, why it blocks, the evidence and the move.

**1. The interpreter is not the truth; its quality as a reference has to be measured per model and per family.**
- **Belief.** THESIS-JIT §2.3 borrows the language-JIT premise of a semantically exact interpreter. SPEC §6.2 settles disputes with a same-model vote.
- **Evidence.**
  - The proxy (S4) and the observed adjudications (S3) disagree.
  - Sonnet resolved 2/2 and Opus 1/1, both correctly. Haiku resolved 1/4.
  - All 3 wrong deliveries came from Haiku non-resolution.
  - The harm the rule was designed to stop, outvoting, is unobserved. The harm that happened is non-resolution.
- **Why.**
  - An agent re-solve is an estimator with its own error profile.
  - Correlated errors make a second same-model vote weak (Knight & Leveson; Kim et al.).
  - Weak-to-strong generalisation (Burns et al.) does **not** apply. It fine-tunes a *stronger* student on weak labels; here a weaker model compiles from a stronger one's traces.
  - A better explanation for a distillate beating its teacher's agent arm is program synthesis over noisy data: a small program class averages out per-trace slips (Raychev et al.; Handa & Rinard) [I].
- **Move.** Use three roles (§6.3), with stated reasons. The strongest tier casts the deciding vote, on narrow, field-local, authorship-blind questions, because:
  - (a) non-resolution is the observed harm (N3);
  - (b) narrow questions should be cheaper than re-solves (unmeasured; P8).
  
  Dawid–Skene-style weighting by accuracy on a frozen dev slice is legal only if O1 allows it.

**2. The checks examine one output; the errors live in relations between inputs.**
- **The gap.** Mined invariants, quote checks and BUILD-NOTES prose all ask whether *this* output looks like the outputs already seen.
  - Under-merges and wrong conflict winners keep every such property true. That is why 0 of at least 21 wrong outputs tripped a check (S1).
  - Checks written by the model under test encode its actual behaviour (Konstantinou et al.), so the compiler cannot be its own verifier.
- **What works without an oracle.** Methods that relate several executions:
  - metamorphic relations;
  - differential and N-version testing;
  - CodeT's dual agreement;
  - Fellegi–Sunter's possible-link band.
- **Move.** A *family verifier* (§3.6):
  - Contents: metamorphic relations, planted canaries, consequence checks and margin bands.
  - Authorship: written from the spec, in a sandbox without the oracle, by a session that has never seen a solver.
  - Validation: candidate checks are selected on the archived misses and tested on fresh outputs (P4a/P4b).

**3. A uniform shadow slider cannot lower the price of an avoided error.**
- **The model.** E[error] = e(1 − sρ) and E[cost] = c + s·v, so the price of one avoided error is v/(eρ), whatever s is.
  - S/H: at least $4.3, at ρ=1. ρ on a real S/H miss is unobserved.
  - O/H: $1.93.
- **What a uniform rate does buy.** The only unbiased estimate of e (N5), and regression inputs. It does not buy cheaper reliability.
- **Where value can come from.** Two places, and today neither exists (S2 coverage, S8):
  - a selector whose recall at budget q is well above q;
  - learning that removes a whole error class.
- The routing literature agrees: the quality estimator decides whether a cascade pays (Dekoninck et al.; Ramírez et al.).
- **Move.**
  - Select detector candidates in sample (P4a) and test them on fresh outputs (P4b).
  - Then switch to risk-scored shadows with a random floor and an IPW estimate of e.
  - The schedule must be randomised first.

**4. Traces are proposals, not labels, and the compiler is a prior, not a transcriber.**
- **Belief.** THESIS §2.1: "the trace holds the answer and the procedure". Addenda 4: noisy pseudo-labels are fine.
- **Why it blocks.**
  - The decisions that matter (date order, merges, winners) are not in the traces.
  - The compiler re-derives them, which is foresight again, now by the cheapest model.
  - S8 suggests (n=2) that the compiler's own misreadings enter the code wherever the traces do not pin a decision.
  - Interpreter strength bounds the traces. The compiler's model bounds the hypothesis class.
- **Acceptance evidence.**
  - Exact agreement is unnecessary: S/H v1 was accepted at exact 0/3 (partial 0.997) and went 17/19.
  - Acceptance is not sufficient: kinetics H/H v1 was accepted at exact 0/3, partial 0.546 (D4).
  - O/H v1 reproduced 3/3 exactly, then deopted on its next two tasks (D3).
- **Frontier.**
  - Every trace-induction method that works filters between proposal and induction: DSPy's metric filter, ASI's programmatic verification during induction, STaR's outcome filter, AlphaCode's behavioural clustering.
  - Self-generated skills give no average benefit (SkillsBench).
- **Move.**
  - A typed decision log from the interpreter.
  - `RULES.json` before `solve.mjs` (§6.5).
  - Executable acceptance (P7).
  - Design diversity that includes a second *compiler model* (§3.16).

**5. Recompile is an unconstrained rewrite toward a target that can be gamed.**
- **The gap.** Heal's constraints did not carry over:
  - no check removal;
  - the literal-leak scan;
  - mutant proofs;
  - "add guards, never relax".
- **The result.** A recompile aimed at zero deopts widened a guard. O/H v2 answered 24/24 in the N-version probe and failed 5 of 7 drift tasks (D9).
- **Lineage versus interpreter strength.** At K=1 the two cannot be separated. D12 hypothesises that lineage dominates.
- **Literature.** It names the failure modes:
  - specification gaming;
  - context collapse under full rewrites (ACE);
  - local optima when only the top candidate survives (GEPA, REx).
- **Move.**
  - Versions become append-only, and every accepted version stays alive.
  - Recompiles are delta edits from a localised cause.
  - A child is rejected if it loses a case its parent won, or if it answers an input the parent refused without strong-tier confirmation (#41 plus heal's gates).

**6. Tier-down and Kev were aimed by cost share; aim them by leverage and volume.**
- **Leverage matters.** Haiku agreed with Opus on almost every leaf of `rules`, yet end-to-end pass fell from 7/8 to 5/8 (D11), because one global read conditions every row.
- **The misses are elsewhere.** They sit in deterministic identity code that has no judge (K6).
- **Kev's data is wrong for this.** Harvesting yields 51 questions from one judge and none from `rules`. Its labels would be LLM labels, which the Kev factory forbids (K2, K3).
- **k-sampling helps only in part.** Heal B.6 shows it kills single-sample slips, not correlated misreads.
- **Move.**
  - High-leverage global reads stay strong, or use k-sampling plus a consequence check.
  - Kev targets the high-volume, generator-labelled same-entity decision on borderline pairs, for reliability and quota rather than cents.

**7. Cost is measured in the wrong currency, and "compiled is cheap" describes a build.**
- **Quota, not dollars.** The usage quota stalled every arm for about 3 hours.
- **Compiled cost varies 20–40×** within one compiler (S6).
- **Kinetics compiles alone cost 4.6–6.6×** the Haiku agent's whole stream (S7).
- **Duplicate spend.** About 22% of compile-time gateway spend repeats identical calls [D durable sweep].
- **Move.**
  - Price every arm in strong-model quota as well as dollars.
  - Add a cost guard at acceptance.
  - Use a salt-free memo for replay and forensics only (P1).

**8. One loop for every task class, with the compiled program always in control.**
- **The positive results put the agent in control.** Skill-library results (Voyager, ASI, SkillWeaver, AWM) keep the agent as the controller, calling verified code.
- **Anthropic's own engineering guidance points the same way** [S]:
  - agents write code to call tools, and save working code as skills;
  - skills bundle scripts that the agent runs.
- **Foundry tested the agent-in-control shape only as a gridquest stretch.** Gridquest has **no LM runs**, and its explorer's 30/30 holds by construction. So "interactive work is the easier place to verify" is an **untested hypothesis** [I].
- **Move.**
  - Bet C (§3.14) runs the agent-in-control shape on batch work now.
  - Interactive work stays a stretch pilot.
  - `flow` becomes a front end to the engine journal.
  - Owner requests are interpreted contract-first.

**9. The evidence base is one Claude-written family per claim, one compile per arm, and arms that share a filesystem.**
- **Belief.** "Held-out seeds of one family test the thesis", and "an arm is a condition".
- **Why it blocks.**
  - These all need many families: the router, verifier transfer, reuse and compiler self-improvement (§6.10).
  - K_c=1.
  - Claude fills every role (J5).
  - The arms are not isolated (§0.4).
- **Move.**
  - Bet B (§3.13): a population of families with a held-out family split.
  - Bet A (§3.10): compile as search, K_c ≫ 1.
  - Per-arm isolated roots.
  - Corpus-seeded families (§3.15).
  - The owner as the only labeller outside the Claude family.

---

## 2. Gap-by-gap tables

Columns: ID and gap · why it blocks · ideological root · frontier evidence · OSS / practice · best options (ranked) · status. "§6.n" means THESIS-JIT §6 item n; "#n" is a task id.

### A. Verification without oracles

| ID · gap | Why it blocks | Ideological root | Frontier evidence | OSS / practice | Best options | Status |
|---|---|---|---|---|---|---|
| **A1** Silent compiled errors | The detectors are guards, invariants, judge checks and a periodic 21% shadow. Under-merges and wrong winners keep every mined property true. At least 21/67 wrong, 1 known corrected [M 04:22] | "Silent errors leave a trace in some cheap self-check" | Metamorphic testing review (Chen et al. 2018) [P]; differential testing (McKeeman) [P]; Fellegi–Sunter's three regions [P]; semantic entropy cannot catch consistent errors [P]; Konstantinou et al.: model-written oracles copy actual behaviour [P] | Splink (Fellegi–Sunter + EM) [S]; Deequ [P]; Temporal replay CI checks determinism, not correctness [S] | (1) P4a candidates (margin band, unmerged near-twins, MR1–MR4, committee disagreement), tested on fresh outputs (P4b). (2) Family verifier with canaries (§3.3, §3.6). (3) Decision-level strong questions (§6.2) plus a blocking-recall audit | Open |
| **A2** Interpreter as reference | SPEC §6.2 votes with two runs of one model. Proxy quality varies by model (S4); observed: Haiku resolved 1/4, and 3 wrong deliveries followed non-resolution | THESIS §2.3; language-JIT interpreters are exact, agents are estimators | Knight & Leveson [P]; Kim et al.: on one leaderboard models agree about 60% of the time when both err [P]; Panickssery: self-preference [P]; Dawid–Skene [P]; PoLL: disjoint families [P]. Weak-to-strong (Burns) does not apply (stronger student) | Crowd-Kit `DawidSkene` [S] | (1) Strongest-tier adjudicator, field-local and authorship-blind (§6.3). (2) Accuracy-weighted vote, if O1 allows. (3) Interpreter as one labeller among several | Open; outvoting harm unobserved |
| **A3** Shadow tax | A full re-solve costs $0.30–0.64 per event, so verifying costs more than executing (S5). A uniform rate cannot lower the price per avoided error (§3.1). Specificity is 5/9 | "The shadow rate is the slider" (THESIS §2.6) | Sheng et al.: selective relabelling [P]; active statistical inference [P]; PPI [P]; Dekoninck et al. [P]; vCache [P]; Trust or Escalate [P] | RouteLLM calibrates to a strong-model percentage [S]; GPTCache's static threshold (counter-example) [S] | (1) Risk-scored π(x) ≥ π_min with IPW, randomised. (2) Verify-shadow or decision-shadow instead of a re-solve. (3) Committee-triggered shadows | Partly: #36 flag shadows behind `shadowOnFlags`, default off, never run |
| **A4** Invariants from 3 traces | At n=3 a mined property is either a truism or an accident; no false-alarm or miss rate is ever estimated | "Mined invariants catch silent errors at $0" | Daikon: at the default conf_limit .99, an all-true `a<b` clears it at **about 7 samples** (1−1/2⁷ ≈ .992) [S]; Schuler & Zeller [P]; Konstantinou et al. [P] | Daikon [S] | (1) Mutation-score every invariant (P5). (2) Runtime-learned input profiles (§6.4). (3) Reclassify mined invariants as drift detectors | Open |
| **A5** Judge checks verify provenance, not meaning | A quote check passes when the right sentence yields the wrong conclusion (the ATLAS MDY read shipped) | "Narrow, typed, checked ⇒ safe" (P2) | Hypothesis Search [P]; CodeT [P]; Gururangan: cues are not inference [P]; Mohri & Hashimoto [P] | — | (1) `flow.consequence`: flip the enum and re-run on the spec's worked examples. (2) k-sample agreement on global reads. Heal B.6 killed the injected *single-sample* class 88/88 at +15%; correlated misreads are untested. (3) Note-ablated shortcut rate | Open; the strict lint flags single global reads [D D11] |
| **A6** Survivorship | Only adjudicated cases become regressions: 2 so far (O/H s217, H/H s219) from at least 21 wrong outputs [M 04:22] | Impasse → deliberation → chunk assumes impasses can be detected | DAgger: the guarantee needs a better expert [P]; STaR [P]; model collapse [P] | — | (1) Risk-triggered shadows feed regressions through a label-confidence gate. (2) Dev error classes become metamorphic regression inputs. (3) Track the miss re-entry rate (§6.8) | Open |
| **A7** Binary pass near the thresholds | **8 of 11** Sonnet-agent failures score 0.947–0.981; Sonnet agent d3 5/16 against d4 8/8 | "A verified success is a crisp unit" | Risk–coverage reporting (Geifman & El-Yaniv) [P] | — | Report mean score, field errors and pass rate at 0.95/0.97/0.99; check that rankings are stable | Open; $0 |

### B. Traces and the interpreter

| ID · gap | Why it blocks | Ideological root | Frontier evidence | OSS / practice | Best options | Status |
|---|---|---|---|---|---|---|
| **B1** Weak interpreter: weak traces *and* weak shadows | One model supplies both signals. H/H: 7 known wrong of 12 compiled, 1/4 adjudications resolved [M 04:22] | Addenda 4: noisy pseudo-labels are fine | Wu et al.: imitation with confidence weights [P]; Chen et al. 2024: voting hurts on hard items [P]; Gudibande: imitation copies style [P]; confident learning [P]; noisy program synthesis (Raychev; Handa & Rinard) [P] | cleanlab [S]; Snorkel [P] | (1) Cascade demonstrator: two Haiku traces, Opus only where their decisions differ. (2) Code as a labeller (another arm's solver). (3) Keep H/H as the negative control (D2) | D2 consequence adopted |
| **B2** Traces carry outputs, not reasons | Date order, merges and winners are decided in the agent's head, so the compiler re-derives them | THESIS §2.1 | Hypothesis Search [P]; AutoManual [P]; ExpeL [P]; Self-Debugging [P] | — | (1) Typed `decisions.json`. (2) `RULES.json` phase (§6.5). (3) Trace ablation | Open; §6.5 unbuilt |
| **B3** Induction from 3 examples | 3 traces are 3 probes; O/H v1 reproduced 3/3, then deopted twice (D3). Other systems promote after at least 10 runs [D R01] | "Distillation of evidence replaces foresight" | Li & Ellis: PBE generalises in distribution [P]; PyPy hot threshold 1039 and LuaJIT `hotloop` 56 [S, checked]; AutoFDO [P]; Raychev's sampler [P] | — | (1) Two tiers: a baseline compile at 3 traces, an optimising compile after at least 10 clean runs. (2) Choose traces by committee disagreement. (3) Trace-count curve | Open |
| **B4** Interpreter amnesia, whole-task deopt | A deopt discards compiled progress: O/H deopt rows $0.508/$0.521 (incl. $0.058/$0.070 escalation) against a $0.009 median `ok` run, **about 55×** (about 30× against D12's $0.017 all-in) [M] | "The interpreter is a stateless fallback" | Deoptless [P]; SELF dynamic deoptimisation [P]; OSR distilled [P]; options [P]; speculative cascades [P] | DBOS `fork_workflow`; LangGraph `interrupt`/`Command`; Claude SDK `fork_session` [S] | (1) Judge-local continuation. (2) Frame-state hints for deopts only. (3) Hoist input-only guards ahead of the first judge | Open |

### C. Compile acceptance and recompile

| ID · gap | Why it blocks | Ideological root | Frontier evidence | OSS / practice | Best options | Status |
|---|---|---|---|---|---|---|
| **C1** Acceptance is not sufficient | `checkFromSummary` (`stream.mjs:172`) accepts when diff ids are named in BUILD-NOTES. Kinetics H/H v1 was accepted at exact 0/3, partial 0.546 (D4). S/H v1 (exact 0/3, partial 0.997, then 17/19) shows exact match is *unnecessary*, not that acceptance failed | "If agreement cannot be required, trust the compiler's argument" | Huang et al.: no intrinsic self-correction [P]. ASI: +23.5% over the static agent and +11.3% over its text-skill counterpart on WebArena, credited to programmatic verification during induction; representation and verification change together [P]. Voyager without self-verification: **−73% discovered items** [P]. AlphaCodium [P] | Temporal replay-history CI [S] | (1) Leave-one-trace-out score + independent MR violations + per-case Pareto. (2) Replay-CI over archived inputs. (3) D4 minimum agreement as a stopgap | Partly: v2.1 strict acceptance (#36) |
| **C2** Reject-if-worse is vacuous | Exact counts on old cases (`stream.mjs:162`); a 0/3 baseline lets anything pass. Exact float comparison; a widened domain is invisible (D9) | "A generic deep-diff is family-independent" | GEPA per-instance Pareto [P]; REx [P] | Temporal replayer; Prefect cache keys [S] | (1) Tolerant comparator (D7). (2) Per-case Pareto + refusal replay (#41). (3) Replay-CI | Partly: D7 v2.1, #41 pending |
| **C3** Compile budget does not fit document-heavy families | Kinetics compile spend $9.6–13.9 per arm [M 04:22]; Haiku compiles hit the $1.5 cap | "Compile cost is roughly constant and amortises" | Early cutoff (build systems) [P]; Adapton [P]; Acar [P; venue unverified] | Prefect; DBOS [S] | (1) Compile-session memo (about 22% duplicates [D]). (2) Judge memo across versions. (3) Spec-first compile (§6.5) | Open; kinetics is a dev cost negative (S7) |
| **C4** Recompile has no anti-gaming gates | Full rewrite toward zero deopts; no check-removal diff, no literal scan. D9 refusals became silent misses | "Heal is recompile + regressions"; heal's constraints dropped | Krakovna: specification gaming [S]; ADAS tampering 84.6% vs AFlow 18.3% [D R03]; ACE context collapse [P]; model collapse [P] | — | (1) Port `HEAL_CHECK_REMOVED` and `experiments/heal/scan.mjs`. (2) Refusal replay (#41) or strong-tier-confirmed widening. (3) Append-only variants | Pending #41 |
| **C5** Construction variance (K_c=1) | One lineage decides an arm: O/H 18/24 against S/H 22/24. Lineage and interpreter effects are confounded at K=1 | "An arm is a condition"; it is a condition × a build | Knight & Leveson [P]; AlphaCode clustering [P] | — | (1) K_c ≥ 3 (measurement). (2) Lineage as a random effect. (3) Prereg K ≥ 2, K_c ≥ 2 | D12 consequence adopted in principle |
| **C6** *(new)* Compile is a single sample, not a search | The compile is paid once and amortised, so it can afford dozens of Haiku candidates, yet one sample is taken | "Compiling is translation" | AlphaEvolve: LLM program edits scored by evaluators [P, checked]; Darwin Gödel Machine archive, SWE-bench 20.0→50.0% [P]; AlphaCode [P]; GEPA [P] | GEPA [S] | Bet A (§3.10): N candidates → behavioural clusters → verifier/committee selection → archive | Open |

### D. Checks and deopt economics

| ID · gap | Why it blocks | Ideological root | Frontier evidence | OSS / practice | Best options | Status |
|---|---|---|---|---|---|---|
| **D1** Over-strict checks turn correctness bugs into cost bugs | O/H `vendex-entries` deopted twice at about $0.51 each. Kinetics S/H: 4 guard deopts in 6 compiled attempts [M 04:22]. No check has a measured false-alarm rate | "A deopt is always better than a wrong answer": true per task, ruinous per stream | Self-Debugging [P]; Olausson: feedback quality is the bottleneck [P]; AutoMix [P] | HotSpot trap limits; Truffle generic fallback [S] | (1) Normalise → same-tier retry with the reason → escalate → deopt. (2) Typed `checkFail` events. (3) A check that fails on every tier becomes a hoisted guard (D3) | Open |
| **D2** All deopt kinds handled alike | Guard, invariant, judge and budget deopts all lead to interpret plus a recompile count | "Every failure is fixed by more traces" | V8 eager vs lazy deopt [S]; GraalVM deopt-cycle detection after 15 compilations [S, checked] | LuaJIT `hotexit` 10 / `tryside` 4 / `maxside` 100 [S, checked] | (1) Reason-specific policy table in `router.mjs`. (2) Version cap + backoff. (3) Heal's CLASSIFY | Open |

### E. Hot judge and tier-down

| ID · gap | Why it blocks | Ideological root | Frontier evidence | OSS / practice | Best options | Status |
|---|---|---|---|---|---|---|
| **E1** One global read dominates cost and leverage | S/H `rules` is Opus-only and about 90% of compiled cost; Haiku drops end-to-end pass to 5/8, Sonnet to 3/8, against 7/8 (D11) | "Cost and risk are spread across narrow judges" | Chain of Code [P]; Trust or Escalate [P]; Yue et al.: mixture of representations [P] | — | (1) Leverage-weighted tiering: keep strong, or k=3 + consequence check. Heal B.6 supports k-sampling only against single-sample slips. (2) Curated helper with an explicit convention parameter. (3) Tier down only low-leverage judges | #42 pending |
| **E2** The screen measures agreement with a possibly wrong teacher | Leaf agreement 0.966 against end-to-end 5/8; representation mismatches count as disagreement | "The expensive tier is the reference" | Stanton: fidelity ≠ accuracy [P]; PPI [P]; Trust or Escalate [P] | — | (1) Gate on end-to-end dev-oracle pass + generator-label audit. (2) PPI intervals. (3) Canonicalise enum leaves | Partly resolved (#38, D11) |
| **E3** Frontier tiers enter compiled code ungated | No static manifest; `tiers:['claude-opus-5-5']` appears in a "Haiku executes" arm | "The IR is the observed trace, so policy needs no authored manifest" | — | Claude Agent SDK evaluates deny rules before allow rules [S]; LangGraph Functional API [S] | (1) AST manifest; refuse a first tier above the arm's class without a calibration record. (2) Per-arm gateway `allowedModels`. (3) Label arms by what actually ran | Open; $0 |

### F. Kev

| ID · gap | Why it blocks | Ideological root | Frontier evidence | OSS / practice | Best options | Status |
|---|---|---|---|---|---|---|
| **F1** No serving path | Not in `policy/models.json` or `LADDER`; the gateway cannot route to the bridge | "Kev is just another rung" | UniRoute: probe-set admission [P; venue unverified]; MixLLM [P] | Restate/Temporal durable fallback [S] | (1) Kev as an *offline, analyst-side* auditor. Its output may not drive runtime shadows or deliveries until O2. (2) Draft a policy entry with a journalled Haiku fallback. (3) Probe-set admission | Blocked: owner (O2) |
| **F2** Harvested data is short, self-labelled and forbidden | 695 calls across 71 names → `kevRecords` yields 51 questions from 1 judge and 0 from `rules`; `LABEL_SOURCES` forbids LLM labels [D] | "Kev is trained on the judgments the stream needed" | Wang 2021 [P]; LLMaAA [P]; Ditto [P]; Weaver: weak verifiers distilled to 400M keep 98.7% [P] | Ditto; cleanlab [S] | (1) Port-shaped rows with generator labels; the LLM value kept as `teacher`. (2) Borderline same-entity pairs as the port. (3) Retain flow traces in the repo | Open; $0 fixes |
| **F3** ROI measured against the wrong baseline | Haiku costs under $0.002/call; stock Kev took 2.5–13.7 s on CPU and was ≤ baseline on 4 of 5 ports [D] | "Small fine-tuned judges beat general models on narrow ports" | Bucher & Martini [P]; Li 2023 [P]; Li, Yue et al. 2025 [P]; Steiner et al. [P] | QLoRA [P] | (1) Price Kev in quota (zero account quota). (2) Target volume × error share. (3) Run K1 before training | Open |

### G. Router, shapes and reuse

| ID · gap | Why it blocks | Ideological root | Frontier evidence | OSS / practice | Best options | Status |
|---|---|---|---|---|---|---|
| **G1** Router not wired; no estimator | `router.mjs` is not imported; `DEFAULT_JIT` is fixed (`stream.mjs:23`). Post-hoc estimators have 0 recall on silent misses | "The router is the compile decision; it can wait" | Dekoninck et al.: ≤ 1.2% gain under poor or noisy estimates (§5.2) [P; venue unverified]; Hybrid LLM [P]; RouterBench [P] | RouteLLM; RouterBench [S] | (1) Offline replay through `decide()` with paired-arm counterfactuals. (2) Slider = (W, quota budget). (3) Wire it only after an estimator exists | Open |
| **G2** Shape identity comes from the bed | `shapeKey` hashes the schema, skeleton and masked prompt, so real requests all look novel | "Recurrence is observable from task form" | APC [P]; low APC hit rates and Muscle-Mem misses [D R01] | — | (1) `shapeKey` census ($0). (2) Value-profile signatures. (3) Owner demand census (O7) | Open |
| **G3** No reuse across shapes; the compiler never learns | Every family pays full compile and warmup | "Amortisation happens within a stream" | Voyager, ASI, SkillWeaver (up to +54.3%) [P]; SkillsBench v1: curated +16.2 pp (current version +16.6 pp, 33.9→50.5%); self-generated −1.3 pp in text, −1.8 pp in Table 3 [P]; AWM [P] | Voyager; GEPA [S] | (1) Curated frontier-written helper library (union-find, E.164, date parser with a convention parameter, units, tolerance). (2) Module-level compilation (§6.7). (3) Compiler self-improvement on a held-out compile-history ledger | Open |
| **G4** No Pareto framing; the north star is too low | S/H steady state ≈ $0.156/task against Haiku agent $0.103 and Opus agent $0.564: the JIT sits in the middle of the frontier | "Compiled is cheap, so the JIT dominates" | RouterBench [P]; Dekoninck et al. [P] | — | (1) A (success, $/task, quota/task) frontier with Wilson CIs. (2) Declare W, the cost of a wrong delivery. (3) Candidate primary outcome: share of families reaching Opus-agent success at ≤ 0.3× Opus quota (O9). S/H is 0.28× Opus dollars at steady state, 0.66× over the stream; quota ratio unknown | Open |
| **G5** *(new)* The compiled program is assumed to be the controller for batch work | Only the inverted shape (agent calls compiled skills) has positive library results, and Anthropic ships it [S]; Foundry tests it only as a stretch | "The program replaces the agent" | Voyager, ASI, SkillWeaver [P]; Code execution with MCP: about 150k → 2k tokens on one example [S]; Agent Skills [S] | Claude Agent Skills [S] | Bet C (§3.14) | Open |
| **G6** *(new)* Recurrence inside a task is ignored | The JIT pays shape matching and warmup only because it compiles *across* tasks. Maps over hundreds of rows have a known shape and a present interpreter | "Recurrence is across tasks" | ARC-AGI-3: agents calling `write_tool`/`write_skill` during play went 43.3→77.5 (Rethinking Harness Evolution) [D R03, not re-verified] | — | Intra-task JIT as a first-class mode (§3.14, proposed THESIS-JIT §6.11) | Open |

### H. Task classes beyond batch input → answer

| ID · gap | Why it blocks | Ideological root | Frontier evidence | OSS / practice | Best options | Status |
|---|---|---|---|---|---|---|
| **H1** Interactive tasks | `solve.mjs` is one-shot with no env port; a mid-episode deopt needs snapshot and restore; errors compound as T²ε | "Everything distils into one program" | DAgger [P]; Code as Policies [P]; Voyager [P]; WorldCoder [P]; PIRL [P]; Simplex / Neural Simplex [P; Simplex bibliography unverified]; BALROG [P] | Voyager [S] | (1) Env port + `flow.expect` + resume in the same env; gridquest pilot with both shapes. (2) Recoverability guard. (3) Env-grounded acceptance | Open. Gridquest: **no LM runs**; explorer 30/30 by construction; regexAgentV2 d4 0/1, d5 0/0 (dev/test) [D] |
| **H2** Effects, waits, approvals | `flow` has no effect, wait or approval primitive; taint (P9) is enforced only by the engine | "Code-first supersedes the IR" | Shielding [P]; Durable Functions [P]; Beldi [P] | Temporal, Restate, DBOS, LangGraph `interrupt`, OpenAI `needs_approval` [S] | (1) `solve.mjs` as a pure activity in an engine `compiled` node, with exit 75 on a fallback edge. (2) Do not build `flow.await`. (3) Express one R-bench item and count invented primitives | Open; engine freeze (ROADMAP rule 13) |
| **H3** Swarms and subagents undefined | What gets compiled when the interpreter is a swarm is undefined | "One tiering loop at every granularity" | Towards a Science of Scaling Agent Systems: sequential tasks −39–70%, independent agents amplify errors 17.2× [P]; Anthropic: multi-agent +90.2% over single-agent Opus 4 on an internal eval, at about 15× *chat* tokens (about 4× a single agent's) [S, checked]; MAST [P] | Cognition: single writer [S] | (1) Separability score before any `wide` work. (2) Compiled leaf workers + a code reducer. (3) Swarms as the adjudication layer (§6.9) | Open; no scope change |
| **H4** NL → proposal → approval bypassed | Versions auto-promote on self-acceptance with no proposal record | "Recompile is mechanical" | — | Temporal Worker Versioning [S]; Airflow bundles [S]; OpenAI: resumable state unauthenticated [S]; CrewAI LLM-read approvals (reject) [S] | (1) `PROPOSAL.json` + a CAS promotion record (`decidedBy`). (2) Contract-first (§3.11). (3) A contract change is a lazy deopt | Open |
| **H5** Third-party text blocked by D10 | The interpreter reads third-party text, and the sandbox has no network namespace | "The interpreter is a harmless instrument" | — | — | (1) M15-X0 isolation spike. (2) Guards, deopt and shadow *around* human workflows. (3) Claude-written or builder-translated beds (§3.15) | Blocked: owner (D10) |

### I. Architecture and security

| ID · gap | Why it blocks | Ideological root | Frontier evidence | OSS / practice | Best options | Status |
|---|---|---|---|---|---|---|
| **I1** Two runtimes | `trace.jsonl` is a solver-written side file; calls are journalled as `gateway/call/<seq>`, so judge identity is lost. Replay salt = `runId` (`port.mjs:158`), minted fresh per attempt (`run-compiled.mjs:45-46`, deliberately so retries are never served journalled answers) | THESIS §2.2 | Durable Functions [P]; AgentRR [P; no quantitative results in the abstract] | Temporal; DBOS; Inngest `step.run` [S] | (1) Named judge activities. (2) Salt-free memo **for offline replay and forensics only**. (3) `flow` as the engine front end | Open |
| **I2** Heal and recompile not integrated | Heal localises at $0 but cannot iterate over rows; recompile writes per-row logic but cannot localise | "Heal is subsumed by recompile" | Tyen et al. [P]; Olausson [P]; ACE [P]; REx [P] | — | (1) LOCALISE → targeted delta brief. (2) $0 counterfactual fork per judge (#42). (3) Keep the parent alive | Open |
| **I3** Untrusted text steers control flow | `rules` outputs drop rows; planted notes could suppress flags or force deopts | "A quote check grounds the judgment" | Shafran et al.: confounder gadgets [P]; shielding [P] | — | (1) Data-dropping operations only through contract-declared rule ids. (2) Planted-note slice. (3) A random shadow floor that flags cannot turn off | Open |

### J. Evaluation and operations

| ID · gap | Why it blocks | Ideological root | Frontier evidence | OSS / practice | Best options | Status |
|---|---|---|---|---|---|---|
| **J1** No held-out evidence; design defects | PREREG is a draft; seeds 7001–7024 sit inside Kev's `real-reserve` 7000–7039 (`kev-data/build.mjs:61`) [M]; workdirs in `/var/tmp` | "Held-out is a seed range" | Kapoor & Narayanan [P] | — | (1) Global seed ledger; held-out ≥ 8000. (2) Hand review of flags (§0.4). (3) Retain workdirs | Open; $0 (P2) |
| **J2** K=1 streams, power | Lineage × trace selection variance is likely larger than between-arm variance (D12) | "One stream per arm is a measurement" | — | — | K ≥ 2 streams, K_c ≥ 2; unit = compile + fixed evaluation set; 3 seed orders | Open |
| **J3** Cost depends on caching, stalls and policy | 1-h cache writes priced 2×; the 3-h stall outlives the TTL; policy 2026-10-08 `childEnv` changed per-call cost [D] | "List $ is stable" | — | — | Split cache tokens; warm vs cold; freeze `policyVersion` | Open |
| **J4** Quota unmetered | `MODEL_RATE_LIMIT` stalled every arm for about 3 h; orchestration is about 20× experiment spend [D] | "$ is the cost" | RouteLLM's strong-model-percentage knob [P] | — | Opus-equivalent quota proxy per arm; D14; Opus-heavy work off-peak | Open; §6.6 |
| **J5** Authorship and independence correlated | Claude wrote the beds, prompts and thresholds and fills every role; local models are parked | — | Kim et al. [P]; PoLL [P]; Panickssery [P] | — | (1) Unpark one local model as a cross-family labeller (O3). (2) The owner as labeller (O10). (3) Corpus-seeded families (§3.15) | Partly blocked: owner |
| **J6** Baseline asymmetries | The static solver had oracle-scored probes and no deopt; there is no repeated-sampling baseline | — | Large Language Monkeys [P]; R03: parallel sampling + verifier beat harness evolution [D] | — | Add "static C0 + guards" and "Haiku agent × 3 selected by the family verifier (no oracle)" | Open |
| **J7** Model churn | Judge prompts and tiers are tuned to today's models | "Compiled solvers are durable" | AutoFDO [P]; V8 lazy deopt [S] | Temporal; Airflow pinning [S] | A `depends` record per version → not-entrant on change; requalify with `--retier` | Open |
| **J8** *(new)* Arms share a filesystem | The stream workdir root is visible to every arm; the S/H interpreter globbed it (§0.4) | "An arm is an isolated condition" | Kapoor & Narayanan [P] | — | Per-arm unreadable roots; a cross-arm read check in the hidden-path scan (P2) | Open; $0 |

### K. Positioning and process

| ID · gap | Why it blocks | Ideological root | Frontier evidence | OSS / practice | Best options | Status |
|---|---|---|---|---|---|---|
| **K1** Positioning | Batch trace → procedure is a crowded space; the JIT names are taken | "Rediscovering a known loop is progress" | AWM, ASI, SkillWeaver, APC, DSPy, AFlow, AgentRR [P]; etchplan [D R01] | etchplan (Apache-2.0) [D R01] | Reposition as the oracle-free verification layer + discipline + controller-with-deopt; etchplan baseline once the verifier exists | Open |
| **K2** Process runs ahead of evidence | WIP commits unreviewed; JIT built before its prereg; §6 written the same day as its evidence; the first draft of this document had 6 repo-measured errors and 9 citation errors | "Agent speed makes evidence cheap" | — | — | $0 audits before builds; review gates on instruments; a rigor pass before circulation | Open |
| **K3** *(new)* The evidence unit is one hand-built family | Router, verifier transfer, reuse and §6.10 need a *population* of families | "Held-out seeds test the thesis" | SWE-smith: 50k instances from 128 repos [P]; Self-Challenging: tasks as instruction + verifier + cases, over 2× for Llama-3.1-8B [P] | — | Bet B (§3.13); held-out *family* split (O9) | Open |
| **K4** *(new)* Demand is unmeasured | Break-even, slider and W all rest on which tasks recur, how often, and what a success is worth | "Recurring work exists in the owner's life" | — | — | Read-only census of the owner's agent-session history or R-bench run counts → recurrence histogram + batch/interactive share (O7) | Owner-gated |

### N. Gaps surfaced by the sweeps, reviews and this pass

| ID · gap | Why it blocks | Ideological root | Frontier evidence | OSS / practice | Best options | Status |
|---|---|---|---|---|---|---|
| **N1** Compiled outputs and features are not persisted | `results.jsonl` holds no output, judge values, flags or check reasons; flow traces live only in `/var/tmp/foundry-work/jit`. s219's compiled correctness cannot be determined | "The run record is the evidence" | Every cascade estimator needs per-run features [P] | — | Write `compiled/<idx>.json` in `finish()`; copy `trace.jsonl` into `flowtraces/` | Open; $0 (P1) |
| **N2** No $0 replay for compiled code; compiles re-pay calls | Salted replay + unnamed calls; $2.55 of $11.42 compile gateway spend repeats identical requests [D] | "The journal is ground truth" | Record–replay [P] | Temporal, DBOS, Prefect [S] | Salt-free memo keyed on (prompt hash, model, sample index), replay and forensics only; distinct salts wherever diversity matters | Open; replay-key survival **unverified** |
| **N3** Unresolved adjudication delivers the compiled answer | 3 known wrong deliveries (H/H s208, s214; kinetics H/H s209) [M 04:22] | "Compiled is the default when unsure" | Mozannar & Sontag: defer where the expert is better [P; label requirement unverified] | — | Escalate unresolved cases to the strongest tier; deliver the side with higher estimated accuracy; log flagged deliveries | Open |
| **N4** The error locus has no judge | Identity merging is a hard threshold in code (`solve.mjs:477-478`) and no judge sees a borderline pair [D K6] | "Prose decisions are judges, procedure is code" | Fellegi–Sunter clerical band [P]; Peeters et al. [P] | Splink [S] | Band → judge + flag; verify *blocking recall* | v2 guidance [D D1]; unmeasured |
| **N5** Flag-only shadowing cannot estimate e | Unflagged runs are never sampled, so the estimate is biased and flags can be suppressed | "Targeted is strictly better" | PPI [P]; Zrnic & Candès [P] | — | Randomised IPW with π_min > 0 | Open |
| **N6** Drift breaks calibrated thresholds | Conformal and LTT guarantees assume exchangeability, and d3 → d4 violates it | "Thresholds tuned once stay valid" | Jitkrittum et al. 2023 [P]; conformal risk control [P] | — | Guards as the shift detector; calibrated risk control only inside guard-accepted inputs | Open |
| **N7** Is a dev-oracle calibration slice legal? | Every certified method needs gold labels. Several steps here (P3a, P4, P7, §3.6) would set system rules from oracle-scored dev results | Unstated | [P, cascades sweep] | — | Owner ruling. Until then, oracle-tuned thresholds are analyst-only and enter P10 only if O1 = yes; otherwise thresholds come from the spec or README (the D7 rule) | **Owner decision O1** |
| **N8** "Compiled is cheap" is not guaranteed | Kinetics H/H compiled runs cost $0.13–0.43, above the Haiku agent's whole task (S6) | "Code is cheaper than agents" | — | — | Cost guard at acceptance: reject solvers whose per-run cost on traces exceeds a fraction of the cheapest agent's | Open; $0 |
| **N9** *(new)* The compiler's model leaks into the code (common mode) | O/H v3 (compiled by Haiku from Opus traces) matches the Haiku agent's score to six decimals on s218 and s223; D8 common mode on s214 | "The compiler transcribes the interpreter" | Knight & Leveson [P]; Kim et al. [P] | — | Field-level comparison of compiled outputs against same-seed cheap-agent outputs (needs N1); a second compiler model as a committee member (§3.16) | Open; n=2 |

---

## 3. Creative reframings: changing the problem rather than patching it

Each item gives the idea, why it changes the problem, evidence, a falsifier and the first test. These are new relative to THESIS §6: 3.1, 3.2, 3.3, 3.6, 3.8, 3.11, 3.13, 3.14, 3.15 and 3.16.

### 3.1 The slider buys measurement, not cheaper reliability

**Idea.** Let:
- e = the silent-error rate;
- c = the compiled cost;
- v = (shadow $ + adjudication $) per shadow event, which includes false alarms;
- ρ = P(a shadow on a wrong answer ends in the right delivery).

With a periodic or uniform rate s, E[error] = e(1 − sρ) and E[cost] = c + s·v. The price of each avoided error is v/(eρ), constant in s.

| arm | v | e | ρ | price per avoided error |
|---|---|---|---|---|
| S/H | $1.807/4 = $0.452 | 2/19 = 0.105 | unobserved: no S/H miss was shadowed | at least **$4.3** |
| O/H | $2.845/4 = $0.711 | 7/19 = 0.368 | 1/1 | **$1.93** |

Compare the price with W, the owner's cost of a wrong delivery, not with the value of a success.

**What a uniform rate still buys:**
- the only unbiased estimate of e (N5);
- regression inputs.

**What it does not buy:** a lower price. A selector with recall R at budget q divides the price by R/q. Learning that removes a class bends e over time.

**Note.** `shadowEvery: 4` is periodic. IPW and PPI need randomisation.

**Evidence.**
- Strong shadows detect when they run (S2, n=4–5).
- Sheng et al. [P]; Zrnic & Candès [P]; Dekoninck et al. [P].

**Falsifier.**
- No pre-frozen signal reaches recall@25% with a Wilson lower bound above 0.25 on fresh outputs (P4b).
- Or one detected miss plus its delta fix does not lower that class's rate on archived inputs. S8 is a first n=1 negative.

**First test.** $0 (P4a), then about $5 (P4b).

### 3.2 Systematic error is an asset: find one, then sweep the archive

**Idea.** Compiling removes random slips and concentrates what remains into a few rules (D1: four under-merges). Those errors are invisible to voting but cheap to generalise from. The loop:
1. Localise the miss with heal's $0 counterfactual fork.
2. Patch the rule.
3. Replay the patched solver over **every archived input**.
4. Adjudicate only the deliveries that changed.

This is a retroactive recall audit and a regression suite in one.

**Evidence.**
- Heal H-p1 killed its injected single-sample class 88/88 [D].
- Locating the error is the bottleneck (Tyen et al.) [P].
- Raychev's sampler [P]; Temporal replay CI [S].

**Falsifier.** A fix localised from s205 (S/H) does not change s214 or the O/H d3 under-merges on replay.

**First test.** $0 with P1 replay; otherwise about $1 of live re-runs.

### 3.3 Plant known answers inside real tasks: canaries the system owns

**Idea.** Before compiled code runs, inject synthetic rows whose correct handling follows from the spec:
- a one-typo twin with the same date of birth must merge;
- a newer row from an `UNRELIABLE` system must not win;
- a duplicate row under a fresh id must not add an entity;
- in kinetics, a synthetic curve with known Km and Vmax.

Code checks the canaries and strips them before delivery; a failed canary triggers a shadow or a deopt.

**Constraints.**
- The canary generator is written from the spec in a sandbox without bed oracle or reference files, audited by the hidden-path scan.
- Validation against `referenceSolve` is analyst-side measurement. Tuning the generator on oracle outcomes is O1-conditional.

**Evidence.**
- Gold questions (Snow et al.) [P; "4 non-experts = 1 expert" unverified].
- Xie et al.: metamorphic testing of classifiers [P].
- The near-twin misses are distance 1–2 typos [D D1].

**Falsifier.** On dev, canary pass does not predict real-row correctness, for example because planted twins merge but natural ones do not.

**Risks.** Injection must not change the semantics of other rows. A guard that fires on canaries is itself evidence of over-strictness.

**First test.** $0 with replay, otherwise about $1.

### 3.4 Weak detectors decide *when*; the strongest model decides *what*

**Idea.** Cheap committees, flags and canaries choose which tasks to check. Opus answers narrow, field-local, authorship-blind questions about the disputed decisions, with quotes. The sweeps estimate about $0.05 per question, against $0.56 for a re-solve; this is unmeasured.

**Why.** It is grounded in the observed harm (non-resolution, N3) and in cost, not in the unobserved outvoting harm.

**Evidence.**
- Olausson et al.: stronger feedback helps [P].
- Tyen et al. [P]; PoLL [P]; Trust or Escalate [P].

**Falsifier.**
- Field-local verdicts are less accurate than full re-solves, *per class* (misses and passes reported separately).
- Or the detectors recall under half of the misses.

**First test.** About $1–3, medium quota (P8).

### 3.5 N-version with designed diversity; the committee chooses traces

**Idea.** D8: unanimity was right on 6 of 7 tasks against a 64% base rate, but s214 failed in common mode. Design diversity in three ways:
- data: disjoint trace subsets;
- design: a different algorithm-family brief;
- representation: CoT against PoT for judges (Yue et al.).

Committee disagreement then picks which tasks to interpret next. One mechanism closes A6 and B3.

**Warning from S8.** Haiku-compiled members and Haiku agents may fail together. A committee of one compiler model is not diverse in its prior (§3.16).

**Falsifier.** Members agree on at least 2/3 of the known misses.

**First test.** Inside Bet A (§3.10).

### 3.6 Compile the verifier, not only the solver

**Idea.** The durable artifact is a *family verifier*:
- metamorphic relations;
- canary generators;
- consequence checks;
- a tolerance comparator;
- the schema.

**Authorship.** A frontier model writes it once from the spec, never seeing a solver, in an oracle-free sandbox.

**Validation.** Analyst-side, on dev, against `referenceSolve`. That is measurement only; any tuning is O1-conditional.

**Use.** It grades any solver: compiled versions, agents, human workflows (H5), new tiers (J7). It is also the contract the owner approves (H4). Across Bet B's families, its recall and false-alarm *distribution* tests whether verifying without an oracle generalises, which is the thesis's binding constraint.

**Evidence.**
- CodeT [P]; Konstantinou et al. [P]; Weaver [P]; Temporal replay CI [S].

**Falsifier.** On fresh dev outputs, recall below 0.5 or a false-alarm rate on passes above 0.2.

**First test.** 2–3 h of authoring plus $0 replays (P4, P5).

### 3.7 Speculation must be declared: every threshold is a band

**Idea.** `flow.assume(site, {margin})`:
- Bands per kind are fixed in the SDK, never chosen by the compiler.
- A case inside the band goes to a judge and a flag.
- A lint counts comparisons that are not declared.

Fellegi–Sunter's possible-link band becomes a compiler obligation. Sourir's `assume` gives the semantics.

**Evidence.** Fellegi–Sunter [P]; Sourir [P]; Maglev [S]. All four D1 misses were near the threshold.

**Falsifier.**
- Margin AUROC ≤ 0.6 on the under-merges.
- Or the misses were blocking failures, pairs never compared.

**First test.** $0 audit (P4a), then about $3–4 (P9).

### 3.8 Interactive work may be the easier verification regime: an untested hypothesis

**Idea.** Environments can refute wrong beliefs on the next step; batch transforms never do. A compiled controller would keep a perception judge at every step, deopt on refutation and resume in the same env. Test it beside the inverted shape (agent calling compiled skills).

**What the evidence is not.** Gridquest's explorer solves 30/30 by construction, with perfect perception, so it is not evidence that "control can be coded". regexAgentV2 scores d4 0/1 and d5 0/0. No LM runs exist [D].

**Evidence.** Voyager, Code as Policies, WorldCoder [P]; Simplex [P]. All of it is external.

**Falsifier.** At d3–d4, neither shape beats the Haiku agent in levels per dollar.

**First test.** About 1 engineer-day and $10–25, medium quota. A stretch for 48 h (P12).

### 3.9 Leverage, not cost share, decides tiering; Kev's port is the volume decision

**Idea.**
- High-leverage global reads stay strong, or use k=3 plus a consequence check.
- Borderline same-entity pairs go to Haiku, then to Kev.
- Kev then attacks reliability (A1, N4) and quota (J4).

**Evidence.** D11; K5, K6 [D]; Ditto, Bucher & Martini, Weaver [P].

**Falsifier.**
- Haiku is already at least 98% on borderline pairs.
- Or there are fewer than 300 pairs per family-month.

**First test.** $0 pair census (P4a), then about $0.05.

### 3.10 Compile and recompile as search over an archive (Bet A)

**Idea.**
- Generate N candidates per compile.
- Cluster them by behaviour on archived and fresh inputs.
- Select without an oracle: verifier score, canary failures and committee agreement. Never use interpreter agreement alone (S4).
- Keep every accepted version in an archive.
- Pick parents by Thompson sampling (REx). Keep any candidate that is best on any case (GEPA per-instance Pareto). Children are delta edits (ACE).

**Constraints.**
- Members get distinct salts and no shared memo; shared memoised judge answers would make them common-mode by construction.
- Scores exclude each member's trace-pool seeds.

**Evidence.**
- D12 lineage spread.
- AlphaEvolve [P]; Darwin Gödel Machine [P]; AlphaCode [P].
- GEPA: +6% on average over GRPO with up to 35× fewer rollouts (abstract) [P].

**Falsifier.** The selected candidate is no better than the median lineage out of pool, which means the bottleneck is the verifier, not search.

**First test.** At most $40 (P6).

### 3.11 Contract-first: the owner approves contracts; a contract change is a lazy deopt

**Idea.**
- The first interpretation of a new request also emits an acceptance contract: schema, 2–3 input/output examples and metamorphic relations. This is the §3.6 verifier.
- The owner approves the contract. Code versions promote automatically under it.
- A contract change marks dependent versions not-entrant and needs approval.

**Evidence.** Temporal pinned and ramped versions [S]; Airflow bundles [S]; OpenAI approvals bound to stored pending items [S].

**Falsifier.** The owner cannot judge contracts faster or better than code.

**First test.** One owner task; blocked on O5.

### 3.12 The owner is the only labeller outside the Claude family

**Idea.** run-view gets a queue of flagged deliveries and contract approvals. Log owner-minutes per verdict and agreement with Opus. That prices human adjudication as a point on the slider (§6.9) and breaks J5's correlation.

**Falsifier.** Owner verdicts agree with Opus on more than 95% of cases, so there is no independence gain, or they cost more than W.

**First test.** Owner-gated (O10).

### 3.13 The unit of evidence is a population of families (Bet B)

**Idea.**
- Opus writes a family generator from primitives the beds already use: identity resolution, date conventions, units, conflict policy, exclusions, tolerance.
- Each family gets a spec, an input generator, a drift knob, and an oracle in a directory the system sandbox cannot read.
- Each is validated with `referenceSolve` and the beds' triviality attack.

**Why it changes the problem.**
- The claim becomes "on which kinds of family does the JIT win", with a held-out *family* split, not more seeds of one family.
- Family features that predict a win become the router's training labels.
- Verifier recall per family (§3.6) becomes a distribution.

**Evidence.** SWE-smith [P]; Self-Challenging [P].

**Falsifier.** The JIT wins on fewer than 1/3 of families and no family feature predicts the wins.

**Cost reality.** At records compile costs, about $5 per JIT mini-stream; at kinetics-like costs, $10–14 (S7). So 12 families need about $120–180. The 48-h slice is the generator plus about 4 validated families.

**Disclosure.** The families are Claude-written (J5).

### 3.14 The agent as its own JIT: inverted control and intra-task recurrence (Bet C)

**Idea.** Two shapes that keep the agent in control:
- **Arm 1:** Opus reads the spec and the first 3 traces, then writes `SKILL.md` plus tested helpers, without oracle access. A Haiku agent uses them on tasks 4–24.
- **Arm 2:** a Haiku agent with a persistent workdir is told to write, run, check and maintain its own `lib/` helpers across tasks. One extra run gives it a single task with 8 sub-batches, which is recurrence *inside* a task (proposed THESIS-JIT §6.11).

**Why it changes the problem.** Agent misses are silent too (the Haiku agent's 9 records failures). So this shape earns reliability through curated helpers plus agent judgment on borderline cases, which is how the agent handled the D1 cases, not through detection.

**Priors.**
- SkillsBench predicts arm 1 beats arm 2 (curated +16 pp; self-generated no benefit) [P].
- ARC-AGI-3 `write_tool` during play points the other way for arm 2 [D R03].
- Anthropic's shipped direction [S].

**Falsifier.** Arm 1 is at or below the Haiku agent (15/24) on records.

**First test.** $5–8, low–medium quota (P14).

### 3.15 Real workflows as stream generators

**Idea.** Use the 96 offline T1 corpus items that have oracles (kubeflow 25, dagster 24, temporal 14, …) [D 10-STATE row 2] as *reference implementations*:
- The original workflow becomes the oracle, used analyst-side only.
- A structured builder, not an executor, turns its third-party text into a Claude-written spec. That respects D10 and lowers the J5 authorship correlation.

**Falsifier.** Builder translation loses the semantics that make the item hard; its `referenceSolve` disagrees with the original workflow.

**First test.** After Bet B; partly blocked by D10.

### 3.16 The compiler is a prior: diversify the compiler model, not only the traces

**Idea.** S8 suggests that a Haiku compiler writes Haiku's own misreading wherever the traces leave a decision open, even when the traces come from Opus. A strong interpreter cannot fix that unless a trace pins the case.

**Moves.**
- (a) Decision logs that make every decision explicit (B2).
- (b) At least one committee member compiled by a different policy model (Sonnet) from the same traces.
- (c) A field-level overlap metric between compiled outputs and same-seed cheap-agent outputs, once N1 persists outputs.

**Falsifier.** Across all archived seeds, field-level error overlap between Haiku-compiled outputs and the Haiku agent is no higher than between Haiku-compiled outputs and the Sonnet agent.

**First test.** $0 after P1; Bet A carries the Sonnet-compiled member.

### 3.17 Stress test of THESIS-JIT §6

| §6 item | Untested assumption inside it | Cheapest test |
|---|---|---|
| §6.1 Portfolio with reliability records "built from shadows" | Records are biased if shadows are flag-triggered or periodic (N5) | Randomised IPW with a floor |
| §6.2 Verify decisions at about 1/50 of a shadow | Cost unmeasured; a missed merge is a *non-decision*, so this needs blocking recall | P4a near-twin census |
| §6.3 The adjudicator is the strongest model | Justified by an outvoting harm that was **not observed**; the observed harm is non-resolution | P8 per-class accuracy |
| §6.4 Guards widen only on interpreter confirmation | Sonnet "confirmation" may be weak (S4 proxy) | Require strong-tier confirmation |
| §6.5 Spec first | A strong-model spec may encode one misreading in every solver (common mode) | Validate spec MRs analyst-side against `referenceSolve` |
| §6.6 Quota as currency | The meter is unread | Record meter % per arm-hour |
| §6.9 Human as final adjudicator | Owner-minutes are unpriced | O10 queue |
| §6.10 Self-improving compiler | About 10 compile histories will overfit | A compile-history ledger with a frozen split; needs Bet B's volume |

---

## 4. Ranked build-and-test plan for the next 24–48 h

### 4.1 Rules for every item

- **Capability rule.** Each 24-h block ends with at least one capability number from a live arm on dev seeds that arm was not tuned on.
  - Only P2, P1 and the P4/P7 instruments may block a live run.
  - P3, P5 and P11 run in the background.
- **Seeds.** Dev seeds only. The held-out set is untouched. Seed ledger first (P2). Fresh dev seeds 225–248 (16 d3 + 8 d4) are reserved for out-of-sample checks.
- **Models.** Ids come from `policy/models.json` only (Haiku 5.5, Sonnet 5.5, Opus 5.5). Local models stay parked unless O3 changes that.
- **No oracle access for system components.** The oracle is analyst-side only.
  - Any threshold, rule or detector chosen by looking at oracle outcomes is labelled *dev-calibrated*. It enters P10 only if O1 = yes; otherwise thresholds come from the spec or bed README (the D7 rule).
  - Verifier and canary authoring sessions run without bed oracle or reference files, audited by the hidden-path scan.
- **Decision rules** are frozen in a file before any result is read.
- **Out-of-pool scoring.** A candidate's score excludes every seed in its trace pool and every deopt-trace seed. In-pool results are reported separately.
- **The salt-free memo** (P1) is for offline replay and forensics only. Diversity experiments (Bet A, committees) use distinct salts and pay live.
- **Bookkeeping.** Negatives go into DEV-NOTES. No credentials are touched. Comparative claims wait for P10.
- **Quota classes:**
  - **none**: $0;
  - **low**: Haiku;
  - **medium**: Sonnet or a few Opus calls;
  - **high**: Opus agents or shadows.
  
  Opus-heavy items run off-peak.

### 4.2 Experiments (in execution order)

| # | Block | What | Files | Metric | Class | $ / quota | Stop or decision rule (frozen beforehand) |
|---|---|---|---|---|---|---|---|
| **P2** | 0–24 h, first | **Ledger, integrity, isolation** (J1, J8, §0.4). (1) Global seed ledger. (2) Move the stream held-out set to ≥ 8000. (3) Reserve 225–248 (and 249–272) as fresh dev seeds. (4) Classify by hand all hidden-path attempts (Opus agent 9, Sonnet agent 3, S/H 14, O/H 3) with an explicit **cross-arm read** check. (5) Design per-arm unreadable workdir roots for P10 | new `experiments/lib/seedledger.mjs` (imported by `kev-data/lib/registry.mjs`, `jit/stream.mjs`); `PREREG-stream.md` amendment; hidden-path scan | 0 seed overlaps; every attempt classified | none (integrity) | $0 / none | An attempt that read an oracle, a bed reference or a sibling arm's file invalidates those rows (or the arm) for any claim, and is recorded. Until this is done, S/H, S4 and "Opus perfect reference" are not used to decide anything |
| **P1** | 0–24 h | **Persistence and replay** (N1, N2). (1) Per-run output, flow events, flags and check reasons. (2) Flow traces copied into the repo. (3) A salt-free memo port for offline replay. (4) Coverage check by replaying one S/H task | `experiments/jit/stream.mjs` (`finish()`), `run-compiled.mjs`, new `experiments/jit/replay-compiled.mjs`; memo as a wrapper over `src/models/port.mjs` | Share of calls served from the journal; 100% of compiled rows have an output | none (plumbing) | $0 / none | If coverage < 90%, every "$0 replay" item below becomes a capped live re-run (≈ $1.2, low–medium quota) |
| **P4a** | 0–24 h | **Detector candidates, in sample** (A1, A3, N4, §3.1, §3.3, §3.7) on the archived compiled outputs frozen at P1 (about 21 wrong / 46 right at 04:22). Signals: (1) Fellegi–Sunter margin band. (2) Unmerged near-twin pairs (edit distance ≤ 2 + shared DOB or phone; also the blocking-recall census and borderline-pair volume for P11). (3) MR1–MR4 and canaries. (4) Committee disagreement (`nversion-records-dev.json`). (5) k-sample agreement where leaves are journalled | new `experiments/jit/audit/{margin,mr-records,canary,detectors}.mjs` | Recall at 10%/25% budget, precision, AUROC, per signal and combined | dev diagnostic, **contaminated** (D1 names the misses); selection only | $0–1.5 / none–low | Output: at most 3 pre-registered candidate combinations and their thresholds, frozen in a file. No direction decision is taken here |
| **P4b** | 0–24 h | **Fresh-seed replay of archived versions.** Run every accepted compiled version (records S/H v1/v2, O/H v1–v3, H/H versions) on fresh dev seeds 225–248, with persisted outputs, distinct salts and no interpreter. Two uses: (1) a **capability number**, each version's durability off its own stream; (2) the **out-of-sample test** of the P4a detectors | `replay-compiled.mjs` (live mode), `audit/detectors.mjs` | Per version: pass, $/task. Per frozen detector: recall@25% with a Wilson 95% CI | dev diagnostic | ≈ $3–6 / low–medium (S/H's Opus `rules`) | If fewer than 15 wrong outputs, add 249–272 first. **Direction bar:** if the best frozen combination's recall@25% has a Wilson *upper* bound < 0.5, reposition the JIT as a cost reducer below the Opus agent with a declared W and record the negative. If the *lower* bound is ≥ 0.5, freeze the detector set for P10 (O1-conditional if thresholds were oracle-tuned). Otherwise inconclusive: do not reposition |
| **P14** | 0–24 h | **Bet C: the agent as its own JIT** (G5, G6, §3.14). Two new arms on records 201–224, paired with the archived arms. (1) Opus writes `SKILL.md` + tested helpers from the spec and the 3 warmup traces (oracle-free sandbox); a Haiku agent uses them on tasks 4–24. (2) A Haiku agent maintains its own `lib/` across tasks, plus one 8-sub-batch single-task run | new `experiments/jit/skill-arm.mjs` (or an `interpret.mjs` mode), `configs/` | Success; $/task; quota proxy; silent misses (wrong delivered answer with no flag, deopt or escalation); d4 drift behaviour against JIT S/H (22/24, 2 silent) and the Haiku agent (15/24, 9 silent) | dev; 201–224 were used to diagnose the JIT, so dev-only | ≈ $5–8 / low–medium | If arm 1 reaches ≥ 21/24 at ≤ 1.5× JIT S/H cost with ≤ 2 silent misses, "agent + compiled skills with deoptable helpers" becomes the primary shape in P10, with the standalone program as the high-volume tier. If arm 1 ≤ 15/24, record a negative for curated skills on this family. Repeat arm 1 on 225–248 if the budget allows |
| **P3** | background | **$0 audit pack** (A2, C1, G1, G4, E3, C4). (a) Adjudication table per interpreter and family: observed, plus the agent-arm proxy labelled as such. (b) Acceptance features against next-8 pass for every compile event. (c) AST tier manifest; check-removal diff from vₙ to vₙ₊₁; `experiments/heal/scan.mjs` literal scan. (d) Router replay at slider 0 / 0.5 / 1; (success, $/task, quota proxy) frontier with Wilson CIs | new `experiments/jit/audit/{adjudication,acceptance,manifest,router-replay}.mjs` | As named | dev diagnostic; **analyst reports** | $0 / none | (a) If P(compiled right given disagreement) > 0.5 for a model, *propose* disabling that model's majority rule; adopt it only if O1 = yes. (b) If no feature has rank correlation > 0.3, acceptance is ceremony and P7 replaces it. (d) If no policy beats both "agent every time" and fixed JIT, park router wiring |
| **P5** | background | **Mutation scoring** (A4, A5). Inject into archived passing outputs and judge values: U (split an entity), C (swap the conflict winner), V (flip a convention), Q (quoted but wrong enum). Add a *correlated* V class across all k samples, because B.6 only tested single-sample slips | `experiments/jit/audit/mutate.mjs` | Kill rate per check and per class | dev diagnostic | $0 / none | A check with kill rate < 0.5 on its own class is reclassified as a drift detector in prompt v4 |
| **P6** | 24–48 h | **Bet A: compile as search** (C5, C6, §3.5, §3.10, §3.16). N=16 compiles from the S/H and O/H trace pools. Variation: leave-one-out subsets, an "alternative algorithm family" brief, **one or two Sonnet-compiled members**, and sampling. Distinct salts, no memo. Run all of them on archived 201–224 and fresh 225–248. Select without an oracle: behavioural clusters + the §3.6 verifier (never saw a solver) + committee | `nversion.mjs` (stream mode), `compile.mjs`, `prompts.mjs` | **Out-of-pool** oracle pass of the selected candidate against the median and best lineage; committee recall on known misses; common-mode rate; build spread; $/task | dev diagnostic; the selected candidate's fresh-seed pass is block 2's capability number | ≤ $40 cap / low–medium (cut N to 10 if compiles hit the $1.5 cap) | If selected ≥ 22/24 on 225–248 and beats the median lineage by ≥ 2, compile-as-search becomes the SPEC default (dev). If selected ≈ median, the bottleneck is the verifier. If members agree on ≥ 2/3 of known misses, the committee is common-mode and is dropped as the primary detector |
| **P7** | 24–48 h | **Executable acceptance v2.2** (C1, C2, C4, N8): leave-one-trace-out score; per-case Pareto against the parent; tolerant comparator (D7); refusal and domain replay (#41); heal gates; manifest refusal; cost guard. Replay every past compile event through it, plus 3 synthetic regressions | `stream.mjs` (`rejectReason`, `checkFromSummary`), `compile.mjs`, `check-traces.mjs` | Versions it would have rejected against their next-8 outcome; synthetic regressions rejected 3/3 | dev diagnostic → P10 instrument | $0 / none | Report whether it rejects S/H v1 (17/19) as an analyst finding. Any rule change prompted by that report is O1-conditional |
| **P8** | 24–48 h, off-peak | **Field-local cross-tier adjudication** (A2, N3, §3.4). Opus sees the spec plus the field diff (compiled against same-seed agent answers), blind to authorship, in randomised order, and must quote. Inputs: the 9 archived disagreements, the known misses, and matched passes | new `experiments/jit/adjudicate-diff.mjs` | Accuracy **separately on misses and on passes**; $ per verdict; against full re-solve outcomes | dev diagnostic | ≈ $1–3 / medium | If field-local is less accurate than full re-solve on either class, keep re-solve for Opus arms |
| **P9** | 24–48 h | **flow-v3 primitives**: `assume` bands (fixed per kind); `consequence`; k=3 for global reads; judge-local continuation (B4, D1); prompt v4. Recompile S/H and O/H once each from existing traces. Score on 204–224 **excluding** trace and deopt-trace seeds (S/H 217, 218; O/H 205, 206, 217), and on 225–248. Replay the O/H `vendex-entries` deopts | `experiments/jit/flow-v3.mjs` (v1/v2 frozen), `prompts.mjs`, test file | Misses caught among wrong outputs; flag rate on correct ones; $/task; $ per judge deopt against $0.51 | dev diagnostic | ≈ $3–6 / low–medium | Reject the version if out-of-pool d3 pass drops by ≥ 2 against v1, or if the flag rate exceeds 40% |
| **P13** | 24–48 h start, off-peak | **Bet B: population of families** (K3, §3.13). Opus family generator; validation (`referenceSolve`, triviality attack); oracle directory unreadable by system sandboxes (needs the P2 roots); Haiku agent and JIT S/H on 8-task mini-streams; the §3.6 verifier per family | new `experiments/families/` generator; `beds/` conventions | Per family: JIT−agent success, $/success, silent-miss rate, verifier recall/false-alarm; distributions across families | dev; Claude-written (J5) | ≈ $40–50 / medium for the generator + about 4 families; the remaining 8 families (≈ $80–130) after 48 h | If the JIT wins on < 1/3 of families, scope the claim to the family features that predict a win; those become router labels |
| **P10** | end of 48 h | **PREREG-stream amendment** (gate). (1) Freeze detectors, adjudicator, acceptance, tolerance, cost guard and the compile-selection procedure. (2) K ≥ 2 streams, K_c ≥ 2 (or Bet A selection). (3) Seeds ≥ 8000; per-arm isolated roots; `policyVersion`; analysis sha. (4) Comparators: Opus agent; Haiku agent; Haiku agent × 3 selected by the family verifier (no oracle); static C0 + guards; agent + Opus-written skill. (5) Report pass at 0.95/0.97/0.99 plus mean score. (6) Quota proxy. (7) Primary outcome and evaluation unit per O9 | `research/jit-20261008/PREREG-stream.md` | — | it *is* the prereg | $0 | If P4b failed its bar, the tested claim becomes the cost-reducer framing before any held-out run. Oracle-tuned elements are included only if O1 = yes |
| **P11** | background | **Kev retarget plumbing** (F2, N4, §3.9). `kevRecords` emits port-shaped rows with generator labels, keeping the LLM value as `teacher`; borderline-pair volume per task from P4a. Kev output stays analyst-side until O2 | `experiments/jit/tierdown.mjs`, new `experiments/jit/labelaudit.mjs` | Rows per task; teacher label error per judge × tier | none | $0 / none | If < 20 borderline pairs per task and Haiku is ≥ 98% on them, Kev has no JIT port; keep Kev on factory ports |
| **P12** | stretch, off-peak | **Gridquest env port**, both shapes plus the Bet C self-helper variant (H1, §3.8) | `experiments/jit/{env-port,flow-v3}.mjs`, `tools/env.mjs`, `interpret.mjs` resume mode, `configs/` | Levels passed, $/success, deopts by kind, perception accuracy scored by env refutations | dev; `PREREG-env.md` before held-out | ≈ $10–25 / medium | If neither shape beats the Haiku agent at d3–d4, record the negative and keep interactive work agent-led |

**Budget.**
- Block 1: about $10–15, mostly low quota.
- Block 2: about $90–105, low–medium quota plus off-peak Opus.
- Stretch: $10–25.

Quota, not dollars, is the binding cap.

### 4.3 Live streams in flight (04:22)

| arm | spend | tasks done | 2× the PREREG §6 estimate ($5–10 per stream) |
|---|---|---|---|
| kinetics S/H | $15.59 | 8 | above 2× low ($10), below 2× high ($20) |
| kinetics O/H | $17.82 | 17 | above 2× low, below 2× high |
| kinetics H/H | $12.09 | 12 | above 2× low, below 2× high |

- PREREG §6 is a held-out rule, and the dev estimate is TBD, so applying it to dev is the owner's call (O8).
- Whatever is decided, record kinetics JIT as a dev cost negative (S7).
- If quota is scarce, the evidence value favours finishing O/H (the only kinetics arm ahead of the agents) over S/H (4/8; 4 guard deopts and 2 wrong out of 6 compiled attempts).
- Records H/H is cheap ($3.24) and is the negative control: let it finish.

### 4.4 Owner decisions these depend on

| id | decision |
|---|---|
| **O1** | Is a frozen dev-split calibration slice legal for system thresholds and rules (N7)? Gates P3a, P4b's freeze, P7, §3.3, §3.6 tuning and §1.1 weighting |
| **O2** | Kev policy entry and bridge route (F1) |
| **O3** | Unpark one local S-class model as a cross-family labeller (J5) |
| **O3b** | Is an open-weight executor rung trained on verified compiled-run traces in scope? (Self-Challenging-style.) Only after Bet B |
| **O4** | Executor route under D10 (H5, §3.15) |
| **O5** | 20–30 owner tasks (G2, H4, §3.11) |
| **O6** | A quota-denominated budget, D14 (J4) |
| **O7** | A read-only demand census of the owner's agent-session history, or R-bench run counts (K4) |
| **O8** | Whether to apply the PREREG §6 kill rule to dev arms (§4.3) |
| **O9** | Evaluation unit and primary outcome: a population of families with a held-out family split, and "share of families at Opus-agent success within the Wilson CI at ≤ 0.3× Opus quota" |
| **O10** | An owner review queue in run-view (§3.12) |

---

## 5. Assumptions register

Statuses are dev statuses: K=1 and directional, not claims.

| # | Assumption (source) | Dev status | Evidence | Cheapest test |
|---|---|---|---|---|
| 1 | The interpreter is a reference implementation (THESIS §2.3) | **Mixed** | Proxy: Opus sound, Sonnet agent arm worse than its distillate, Haiku mixed [M S4, possibly contaminated]. Observed resolutions: Sonnet 2/2, Opus 1/1, Haiku 1/4 | P3a, P8 |
| 2 | A same-model majority resolves disagreements (SPEC §6.2) | **Mixed** | 4 of 9 resolved; outvoting harm unobserved; 5 unresolved [M 04:22] | P8 |
| 3 | Delivering the compiled answer on "unresolved" is safe | **Contradicted for weak interpreters** | H/H 3/3 wrong delivered; kinetics O/H 2/2 right delivered (D7 artefact) | P3a |
| 4 | Mined invariants catch silent errors at $0 | **Contradicted** | 0 of at least 21 wrong outputs tripped a check [M] | P5 |
| 5 | Guards and invariants detect drift | **Supported, fragile** | S/H drift deopts on s217 and s218 (kind `invariant`); static 6/8 silent on d4; D9 widening; kinetics S/H 4 guard deopts in 6 attempts (over-strict) | #41 replay |
| 6 | Quote checks ground judgments (P2) | **Contradicted for meaning** | ATLAS MDY shipped with a valid quote [D] | P5 Q-mutants |
| 7 | A shadow detects an error when applied | **Supported, n=4–5** | 4/4 known-wrong disagreed; specificity 5/9 [M 04:22] | Randomised shadows |
| 8 | The shadow rate is the right slider (§2.6) | **Contradicted as a reliability lever**; still the e estimator | §3.1 | P3d, P4b |
| 9 | Verification is cheaper than solving | **Contradicted for full re-solve shadows** | S/H $1.81 vs $0.89; O/H $2.85 vs $0.31; decision-level checks unmeasured | P8 |
| 10 | Learning from one detection removes its class | **Untested** (n=1 negative) | O/H s217 → v3 still missed s218 and s223 | §3.2 sweep |
| 11 | Traces hold the procedure (§2.1) | **Untested** | Decisive judgments are unrecorded [D SPEC §3.2] | Trace ablation |
| 12 | Noisy pseudo-labels are fine (Addenda 4) | **Contradicted** for Haiku traces | H/H 7 known wrong of 12; systematic conflict rule [M; D D2] | Cascade demonstrator |
| 13 | Warmup 3 suffices | **Doubtful** (literature) / untested (internal) | O/H 3/3 exact then 2 deopts; promotion after ≥ 10 runs elsewhere | Trace curve (P6) |
| 14 | Clean run + explained diffs = acceptance (Addenda 4) | **Contradicted as sufficient** | Kinetics H/H v1 accepted at partial 0.546 (D4). S/H v1 at 0.997 → 17/19 shows exact match is unnecessary | P3b, P7 |
| 15 | Reject-if-worse protects old behaviour | **Contradicted** | 0/3 baselines; D9 | P7 |
| 16 | Heal = recompile + regression suite (§2.5) | **Contradicted** | Gates dropped; D9 | P3c |
| 17 | Authoring in code beats authoring IR | **Supported** | 16/16 vs 11/16 [D]; CodeAct up to +20% [P] | — |
| 18 | Compiled code is cheap | **Mixed** | Records $0.009–0.043/run; kinetics H/H $0.13–0.43/run [M 04:22] | Cost guard (P7) |
| 19 | Compile cost amortises within a stream | **Mixed** | Records: against Opus after about 10 tasks [D D10], not against Haiku at 24. Kinetics: compile alone is 4.6–6.6× the Haiku agent's stream | P3d |
| 20 | Frontier demonstrates, Haiku compiles and executes (Addenda 1) | **Mixed** | S/H 22/24; O/H 18/24; kinetics Haiku compiles fell back to Opus | P6 |
| 21 | An arm difference reflects the condition (K_c=1) | **Contradicted** | D12; lineage and interpreter confounded | P6 |
| 22 | Compiling makes errors systematic | **Suggestive** | D1: 4 under-merges; s214 common mode; s218/s223 match the Haiku agent | §3.16 |
| 23 | Uniform sampling catches systematic errors | **Contradicted** | §3.1; 0/2 S/H misses shadowed | P4b |
| 24 | Leaf agreement measures tier equivalence | **Contradicted** | D6, D11 | — |
| 25 | The hot judge is the reliability locus | **Mixed** | Opus `rules` 151/151 (K5); Haiku `rules` −2/8 (D11); misses in identity code (K6) | #42 |
| 26 | Kev is trained on stream judgments (§2.6) | **Contradicted** | 51 questions from 1 judge; LLM labels forbidden [D] | P11 |
| 27 | Kev is another rung | **Blocked** | Not in policy | O2 |
| 28 | `shapeKey` identifies recurrence | **Untested** | — | Census |
| 29 | The router is the compile decision | **Untested** | Not wired [M] | P3d |
| 30 | $ is the cost | **Contradicted** | 3-h quota stall | Quota meter |
| 31 | List $ is comparable across days | **Contradicted** | Policy 2026-10-08 `childEnv` [D] | Freeze `policyVersion` |
| 32 | Engine guarantees survive via the gateway (§2.2) | **Contradicted** | Unnamed calls, salted replay, no taint or approvals [D] | P1 |
| 33 | One loop for all task classes | **Untested internally**; the literature leans against | Swarms −39–70% on sequential work; skill libraries keep the agent in control [P] | P14, P12 |
| 34 | The interpreter is a harmless instrument | **Contradicted under D10** | It reads third-party text | M15-X0 |
| 35 | Recompile needs no authority | **Contradicted by AGENTS.md** | NL → proposal → approval | `PROPOSAL.json` |
| 36 | The JIT loop is the novel contribution | **Contradicted** | AWM, ASI, APC, AgentRR, etchplan | Etchplan baseline after P10 |
| 37 | A dev oracle may set system thresholds | **Owner question** | — | O1 |
| 38 | Binary pass at 0.97/0.95 is stable | **Doubtful** | 8 of 11 Sonnet-agent failures at 0.947–0.981; d3 5/16 vs d4 8/8 | Threshold sweep |
| 39 | Exact comparison is family-independent | **Contradicted** | D7 | v2.1 |
| 40 | §6.2 decision checks cost about 1/50 of a shadow | **Untested**; blind to blocking | — | P4a census |
| 41 | §6.4 runtime-learned guards preserve the domain | **Untested** | `profile.mjs` offline | P7 refusal replay |
| 42 | §6.10 compiler self-improvement is measurable | **Untested**; overfit risk at about 10 histories | — | Compile-history ledger; Bet B volume |
| 43 | Arms are isolated conditions | **Contradicted** | Shared workdir root; S/H globbed it (§0.4) | P2 |
| 44 | The compiler transcribes the interpreter | **Doubtful (n=2)** | O/H v3 = Haiku agent scores on s218, s223 | §3.16 |
| 45 | One family's held-out seeds test the thesis | **Untested; doubtful** | Router, transfer and reuse need many families | P13 |
| 46 | One compile sample per arm is enough | **Contradicted** | D12 | P6 |
| 47 | In batch work, the compiled program should be the controller | **Untested** | Positive skill-library results invert it [P, S] | P14 |
| 48 | Recurrence is across tasks | **Untested** | Intra-task maps never tested | P14 arm 2 |
| 49 | Recurring demand exists at useful volume | **Unmeasured** | — | O7 |

---

## 6. References

**Verification status.**
- "(checked)" means the source was opened by the rigor review, the ambition review or this pass, and the figure cited here matches it.
- "(venue unverified)" means arXiv shows no venue line.
- All other entries are carried from the sweeps and were not re-opened.
- Removed from the first draft: the two "program-policy synthesis without an LLM fallback" entries (arXiv 2603.19453, 2512.21024). They are about LLM-written code policies in multi-agent games and do not test fallback.

### Verification, testing and oracles
- Ernst et al., "The Daikon system for dynamic detection of likely invariants", *Sci. Comput. Program.* 2007 — https://homes.cs.washington.edu/~mernst/pubs/daikon-tool-scp2007-abstract.html [P]; Daikon manual — https://plse.cs.washington.edu/daikon/download/doc/daikon.html [S] (checked: conf_limit .99; all-true a<b clears it at about 7 samples)
- Chen et al., "Metamorphic Testing: A Review of Challenges and Opportunities", *ACM CSUR* 2018 — https://i.cs.hku.hk/~tse/Papers/2010s/hlmtCSUR.html [P]
- Xie et al., "Testing and validating machine learning classifiers by metamorphic testing", *JSS* 2011 — https://academiccommons.columbia.edu/doi/10.7916/D8Z326KM [P]
- McKeeman, "Differential Testing for Software", *DTJ* 1998 — https://dblp.org/pid/40/4856 [P]
- Knight & Leveson, "An Experimental Evaluation of the Assumption of Independence in Multiversion Programming", *IEEE TSE* 1986 — https://www.kth.se/social/files/564df871f2765419e306178d/KnightLeveson.pdf [P]
- Kim, Garg, Peng, Garg, "Correlated Errors in Large Language Models", ICML 2025 — https://arxiv.org/abs/2506.07962 [P] (checked: on one leaderboard, models agree about 60% of the time when both err)
- Schuler & Zeller, "Checked coverage: an indicator for oracle quality", *STVR* 2013 — https://www.st.cs.uni-saarland.de/publications/details/schuler-stvr-2013/ [P]
- Chen et al., "CodeT: Code Generation with Generated Tests", ICLR 2023 — https://arxiv.org/abs/2207.10397 [P]
- Ridnik, Kredo, Friedman, "Code Generation with AlphaCodium", 2024 — https://arxiv.org/abs/2401.08500 [P]
- Konstantinou, Degiovanni, Papadakis, "Can we find bugs using LLM-generated oracles?", 2024 — https://arxiv.org/abs/2410.21136 [P] (checked)
- Shi et al., "MBR-EXEC", EMNLP 2022 — https://arxiv.org/abs/2204.11454 [P]
- Li et al., "AlphaCode", *Science* 2022 — https://arxiv.org/abs/2203.07814 [P]
- Lightman et al., "Let's Verify Step by Step", 2023 — https://arxiv.org/abs/2305.20050 [P]
- Farquhar et al., semantic entropy, *Nature* 2024 — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11186750/ [P]
- Manakul et al., "SelfCheckGPT", EMNLP 2023 — https://arxiv.org/abs/2303.08896 [P]
- Schelter et al., Deequ, PVLDB 2018 — https://www.vldb.org/pvldb/vol11/p1781-schelter.pdf [P]
- Fellegi & Sunter, "A Theory for Record Linkage", *JASA* 1969 — https://cs.cornell.edu/~shmat/courses/cs6434/fellegi-sunter.pdf [P]
- Splink — https://github.com/moj-analytical-services/splink [S] (checked: Fellegi–Sunter model, EM parameter estimation)
- Peeters, Steiner, Bizer, "Entity Matching using Large Language Models", EDBT 2025 — https://arxiv.org/abs/2310.11244 [P]

### Weak supervision, aggregation and correlated judges
- Dawid & Skene, *JRSS-C* 1979 — https://ideas.repec.org/a/bla/jorssc/v28y1979i1p20-28.html [P]; Crowd-Kit `DawidSkene` — https://toloka.ai/docs/crowd-kit/reference/crowdkit.aggregation.classification.dawid_skene.DawidSkene [S]
- Raykar et al., "Learning From Crowds", JMLR 2010 — https://jmlr.org/papers/v11/raykar10a.html [P]
- Sheng, Provost, Ipeirotis, "Get Another Label?", KDD 2008 — https://archive.nyu.edu/handle/2451/27818 [P]
- Snow et al., "Cheap and Fast – But is it Good?", EMNLP 2008 — https://aclanthology.org/D08-1027/ [P; "about 4 non-experts = 1 expert" unverified]
- Ratner et al., "Snorkel", VLDB 2017 — https://arxiv.org/abs/1711.10160 [P]
- Saad-Falcon et al., "Weaver", 2025 — https://arxiv.org/abs/2506.18203 [P] (checked: 400M, 98.7%)
- Chen et al., "Are More LLM Calls All You Need?", 2024 — https://arxiv.org/abs/2403.02419 [P]
- Verga et al., "PoLL", 2024 — https://arxiv.org/abs/2404.18796 [P]
- Panickssery, Bowman, Feng, "LLM Evaluators Recognize and Favor Their Own Generations", NeurIPS 2024 — https://arxiv.org/abs/2404.13076 [P]
- Northcutt, Jiang, Chuang, "Confident Learning", *JAIR* 2021 — https://arxiv.org/abs/1911.00068 [P]
- Burns et al., "Weak-to-Strong Generalization", ICML 2024 — https://arxiv.org/abs/2312.09390 [P] (checked). Cited only to show it does **not** apply: it fine-tunes a stronger student.

### Trace induction, skills and program synthesis
- Wang, Mao, Fried, Neubig, "Agent Workflow Memory", ICML 2025 — https://arxiv.org/abs/2409.07429 [P]
- Wang, Gandhi, Neubig, Fried, "Inducing Programmatic Skills for Agentic Tasks" (ASI), 2025 — https://arxiv.org/abs/2504.06821 [P] (checked: +23.5% over the static agent, +11.3% over text skills on WebArena; not an isolated ablation)
- Zheng et al., "SkillWeaver", 2025 — https://arxiv.org/abs/2504.07079 [P] (checked: up to 54.3%)
- Wang et al., "Voyager", 2023 — https://arxiv.org/abs/2305.16291 [P] (checked: −73% discovered items without self-verification)
- SkillsBench, 2026 — https://arxiv.org/abs/2602.12670; v1 https://arxiv.org/html/2602.12670v1 [P] (checked: v1 +16.2 pp, current +16.6 pp; self-generated −1.3 pp text / −1.8 pp Table 3 in v1)
- Zhang et al., "AFlow", ICLR 2025 — https://arxiv.org/abs/2410.10762 [P]
- Hu, Lu, Clune, "ADAS", ICLR 2025 — https://arxiv.org/abs/2408.08435 [P]
- Khattab et al., "DSPy", 2023 — https://arxiv.org/abs/2310.03714 [P]
- Agrawal et al., "GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning", ICLR 2026 (Oral) — https://arxiv.org/abs/2507.19457 [P] (checked: +6% on average over GRPO, up to 35× fewer rollouts)
- Zhang et al., "ACE: Agentic Context Engineering", ICLR 2026 — https://arxiv.org/abs/2510.04618 [P] (checked)
- Novikov et al. (Google DeepMind), "AlphaEvolve: A coding agent for scientific and algorithmic discovery", 2025 — https://arxiv.org/abs/2506.13131 [P] (checked)
- Zhang, Hu, Lu, Lange, Clune, "Darwin Gödel Machine", 2025 — https://arxiv.org/abs/2505.22954 [P] (checked: SWE-bench 20.0→50.0%)
- Zhang, Wornow, Wan, Olukotun, "Agentic Plan Caching", NeurIPS 2025 — https://arxiv.org/abs/2506.14852 [P]
- Wang et al., "CodeAct", ICML 2024 — https://arxiv.org/abs/2402.01030 [P]
- Li et al., "Chain of Code", ICML 2024 — https://arxiv.org/abs/2312.04474 [P]
- Wang et al., "Hypothesis Search", ICLR 2024 — https://arxiv.org/abs/2309.05660 [P]
- Li & Ellis, "Is Programming by Example Solved by LLMs?", NeurIPS 2024 — https://arxiv.org/abs/2406.08316 [P]
- Raychev, Bielik, Vechev, Krause, "Learning Programs from Noisy Data", POPL 2016 — https://popl16.sigplan.org/details/POPL-2016-papers/24/Learning-Programs-from-Noisy-Data [P] (checked)
- Handa & Rinard, "Inductive Program Synthesis over Noisy Datasets using Abstraction Refinement Based Optimization", arXiv 2021 — https://arxiv.org/abs/2104.13315 [P] (checked; no venue listed)
- Zhao et al., "ExpeL", AAAI 2024 — https://arxiv.org/abs/2308.10144 [P]
- Chen et al., "AutoManual", NeurIPS 2024 — https://arxiv.org/abs/2405.16247 [P]
- Feng et al., "AgentRR", 2025 — https://arxiv.org/abs/2505.17716 [P; body results unverified]
- Yang, Lieret, Jimenez et al., "SWE-smith", 2025 — https://arxiv.org/abs/2504.21798 [P] (checked by the ambition review)
- Zhou, Levine, Weston, Li, Sukhbaatar, "Self-Challenging Language Model Agents", 2025 — https://arxiv.org/abs/2506.01716 [P] (checked by the ambition review)
- "Rethinking Harness Evolution", arXiv 2607.12227 — via `research/landscape-20261006/03-harness-search-and-self-improvement.md:253` [D R03; not re-verified]

### Self-correction, repair and imitation
- Huang et al., "Large Language Models Cannot Self-Correct Reasoning Yet", ICLR 2024 — https://arxiv.org/abs/2310.01798 [P]
- Olausson et al., "Is Self-Repair a Silver Bullet for Code Generation?", ICLR 2024 — https://arxiv.org/abs/2306.09896 [P]
- Chen, Lin, Schärli, Zhou, "Self-Debugging", ICLR 2024 — https://arxiv.org/abs/2304.05128 [P]
- Tang et al., "REx", NeurIPS 2024 — https://arxiv.org/abs/2405.17503 [P]
- Tyen et al., "LLMs cannot find reasoning errors, but can correct them given the error location", 2024 — https://arxiv.org/abs/2311.08516 [P] (checked)
- Brown et al., "Large Language Monkeys", 2024 — https://arxiv.org/abs/2407.21787 [P]
- Wu et al., "Imitation Learning from Imperfect Demonstration", ICML 2019 — https://proceedings.mlr.press/v97/wu19a.html [P]
- Ross, Gordon, Bagnell, "DAgger", AISTATS 2011 — https://arxiv.org/abs/1011.0686 [P]
- Zelikman et al., "STaR", NeurIPS 2022 — https://arxiv.org/abs/2203.14465 [P]
- Gudibande et al., "The False Promise of Imitating Proprietary LLMs", ICLR 2024 — https://arxiv.org/abs/2305.15717 [P]
- Shumailov et al., model collapse, *Nature* 2024 — https://oatml.cs.ox.ac.uk/publications/202407_Shumailov_ModelCollapse.html [P]
- Krakovna et al., "Specification gaming", DeepMind 2020 — https://deepmind.google/discover/blog/specification-gaming-the-flip-side-of-ai-ingenuity/ [S]

### Cascades, routing, deferral and selective prediction
- Chen, Zaharia, Zou, "FrugalGPT", TMLR 2024 — https://arxiv.org/abs/2305.05176 [P]
- Ong et al., "RouteLLM", ICLR 2025 — https://arxiv.org/abs/2406.18665 [P]; https://github.com/lm-sys/RouteLLM [S]
- Aggarwal, Madaan et al., "AutoMix" — https://arxiv.org/abs/2310.12963 [P]
- Ding et al., "Hybrid LLM", ICLR 2024 — https://arxiv.org/abs/2404.14618 [P]
- Dekoninck, Baader, Vechev, "A Unified Approach to Routing and Cascading for LLMs" — https://arxiv.org/abs/2410.10347 [P] (checked: ≤ 1.2% under poor estimates, §5.2; venue unverified)
- Jitkrittum et al., "When Does Confidence-Based Cascade Deferral Suffice?", NeurIPS 2023 — https://neurips.cc/virtual/2023/poster/72864 [P]
- Yue et al., "LLM Cascades with Mixture of Thought Representations", ICLR 2024 — https://arxiv.org/abs/2310.03094 [P]
- Kolawole et al., "Agreement-Based Cascading", TMLR 2025 — https://arxiv.org/abs/2407.02348 [P]
- Ramírez, Birch, Titov, "Optimising Calls to LLMs with Uncertainty-Based Two-Tier Selection", 2024 — https://arxiv.org/abs/2405.02134 [P]
- Mozannar & Sontag, "Consistent Estimators for Learning to Defer to an Expert", ICML 2020 — https://proceedings.mlr.press/v119/mozannar20b.html [P; label requirement unverified]
- Jung, Brahman, Choi, "Trust or Escalate", ICLR 2025 — https://arxiv.org/abs/2407.18370 [P]
- Geifman & El-Yaniv, "Selective Classification for Deep Neural Networks", NeurIPS 2017 — https://arxiv.org/abs/1705.08500 [P]
- Angelopoulos et al., "Conformal Risk Control", ICLR 2024 — https://arxiv.org/abs/2208.02814 [P]; "Learn then Test" — https://arxiv.org/abs/2110.01052 [P]; "Prediction-Powered Inference", *Science* 2023 — https://arxiv.org/abs/2301.09633 [P]
- Zrnic & Candès, "Active Statistical Inference", ICML 2024 — https://proceedings.mlr.press/v235/zrnic24a.html [P]
- Mohri & Hashimoto, "Language Models with Conformal Factuality Guarantees", ICML 2024 — https://proceedings.mlr.press/v235/mohri24a.html [P]
- Wang et al., "MixLLM", NAACL 2025 — https://aclanthology.org/2025.naacl-long.545 [P]
- Jitkrittum et al., "Universal Model Routing for Efficient LLM Inference" — https://arxiv.org/abs/2502.08773 [P] (checked; venue unverified)
- Hu et al., "RouterBench", 2024 — https://arxiv.org/abs/2403.12031 [P]
- Shafran et al., "Rerouting LLM Routers", 2025 — https://arxiv.org/abs/2501.01818 [P]
- Narasimhan et al., "Faster Cascades via Speculative Decoding", ICLR 2025 — https://arxiv.org/abs/2405.19261 [P]
- Ye et al., "Speculative Actions: A Lossless Framework for Faster Agentic Systems" — https://arxiv.org/abs/2510.04371 [P] (checked; venue unverified)
- Schroeder et al., "vCache", ICLR 2026 — https://arxiv.org/abs/2502.03771 [P] (checked)
- Zilliz, GPTCache, NLP-OSS 2023 — https://aclanthology.org/2023.nlposs-1.24.pdf [S]

### Small-model labels, distillation and evaluation pitfalls
- Wang et al., "Want To Reduce Labeling Cost? GPT-3 Can Help", Findings EMNLP 2021 — https://arxiv.org/abs/2108.13487 [P]
- Zhang et al., "LLMaAA", Findings EMNLP 2023 — https://arxiv.org/abs/2310.19596 [P]
- Bucher & Martini, "Fine-Tuned 'Small' LLMs (Still) Significantly Outperform Zero-Shot …", 2024 — https://arxiv.org/abs/2406.08660 [P]
- Li et al., "Ditto", PVLDB 2021 — https://arxiv.org/abs/2004.00584 [P]
- Steiner, Peeters, Bizer, "Fine-tuning LLMs for Entity Matching", ICDEW 2025 — https://arxiv.org/abs/2409.08185 [P]
- Stanton et al., "Does Knowledge Distillation Really Work?", NeurIPS 2021 — https://arxiv.org/abs/2106.05945 [P]
- Li, Zhu, Lu, Yin, "Synthetic Data Generation with LLMs for Text Classification", EMNLP 2023 — https://arxiv.org/abs/2310.07849 [P]
- Li, Yue et al., "Small Models Struggle to Learn from Strong Reasoners", 2025 — https://arxiv.org/abs/2502.12143 [P]
- Gururangan et al., "Annotation Artifacts in NLI Data", NAACL 2018 — https://aclanthology.org/N18-2017/ [P]
- Kapoor & Narayanan, "Leakage and the reproducibility crisis in ML-based science", *Patterns* 2023 — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10499856/ [P]
- Dettmers et al., "QLoRA", NeurIPS 2023 — https://arxiv.org/abs/2305.14314 [P]

### JIT and runtime systems
- Bolz et al., "Tracing the Meta-Level: PyPy's Tracing JIT Compiler", ICOOOLPS 2009 [P]; PyPy `--jit help` — https://doc.pypy.org/jit_help.html [S] (checked: threshold 1039)
- LuaJIT "Running" — https://luajit.org/running.html [S] (checked: hotloop 56, hotexit 10, tryside 4, maxside 100)
- V8 "Maglev" — https://v8.dev/blog/maglev [S]; V8 "Deoptimization" — https://chromium.googlesource.com/v8/v8.git/+/main/docs/runtime/deoptimization.md [S]
- Hölzle, Chambers, Ungar: "Polymorphic Inline Caches", ECOOP 1991; "Debugging Optimized Code with Dynamic Deoptimization", PLDI 1992 — https://bibliography.selflanguage.org/ [P]
- Flückiger et al., "Correctness of Speculative Optimizations with Dynamic Deoptimization" (Sourir), POPL 2018 — https://arxiv.org/abs/1711.03050 [P]; "Deoptless", PLDI 2022 — https://arxiv.org/abs/2203.02340 [P]
- D'Elia & Demetrescu, "On-Stack Replacement, Distilled", PLDI 2018 [P]
- GraalVM "Deopt Cycle Patterns" — https://www.graalvm.org/dev/graalvm-as-a-platform/language-implementation-framework/DeoptCyclePatterns/ [S] (checked: detection after 15 compilations)
- Chen, Li, Moseley, "AutoFDO", CGO 2016 [P]
- Hammer et al., "Adapton", PLDI 2014 [P]; Acar et al., self-adjusting computation [P; venue unverified]; Mokhov, Mitchell, Peyton Jones, "Build Systems à la Carte", ICFP 2018 [P]

### Durable execution, agent SDKs and engineering practice
- Temporal: https://docs.temporal.io/workflow-definition ; https://docs.temporal.io/worker-versioning [S]
- Restate: https://docs.restate.dev/concepts/durable_execution [S]
- DBOS: https://docs.dbos.dev/architecture [S]
- Inngest: https://www.inngest.com/docs/learn/how-functions-are-executed [S]
- LangGraph: https://docs.langchain.com/oss/python/langgraph/interrupts ; https://docs.langchain.com/oss/python/langgraph/functional-api [S]
- OpenAI Agents SDK: https://openai.github.io/openai-agents-python/human_in_the_loop/ [S]
- Claude Agent SDK: https://code.claude.com/docs/en/agent-sdk/sessions ; https://code.claude.com/docs/en/agent-sdk/permissions [S]
- Prefect: https://docs.prefect.io/v3/concepts/caching ; Airflow: https://airflow.apache.org/docs/apache-airflow/stable/administration-and-deployment/dag-bundles.html ; CrewAI: https://docs.crewai.com/en/concepts/flows [S]
- Burckhardt et al., "Durable Functions: Semantics for Stateful Serverless", OOPSLA 2021 [P]; Zhang et al., "Beldi", OSDI 2020 [P]
- Jones & Kelly (Anthropic), "Code execution with MCP: Building more efficient agents", 2025 — https://www.anthropic.com/engineering/code-execution-with-mcp [S] (checked by the ambition review)
- Anthropic, "Equipping agents for the real world with Agent Skills", 2025 — https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills [S] (checked by the ambition review)

### Interactive control, safety and multi-agent
- Liang et al., "Code as Policies", ICRA 2023 — https://arxiv.org/abs/2209.07753 [P]
- Sutton, Precup, Singh, "Between MDPs and semi-MDPs", *AIJ* 1999 [P]
- Verma et al., "Programmatically Interpretable RL", ICML 2018 — https://arxiv.org/abs/1804.02477 [P]
- Alshiekh et al., "Safe RL via Shielding", AAAI 2018 — https://arxiv.org/abs/1708.08611 [P]
- Sha, Simplex [P; bibliographic details unverified]; Neural Simplex — https://arxiv.org/abs/1908.00528 [P]
- Tang, Key, Ellis, "WorldCoder", NeurIPS 2024 — https://arxiv.org/abs/2402.12275 [P]
- Paglieri et al., "BALROG", ICLR 2025 — https://arxiv.org/abs/2411.13543 [P]
- Xu et al., "TheAgentCompany", 2024 — https://arxiv.org/abs/2412.14161 [P] (checked by the ambition review: best agent 30%)
- Anthropic, "How we built our multi-agent research system", 2025 — https://www.anthropic.com/engineering/multi-agent-research-system [S] (checked: +90.2% over single-agent Opus 4; agents about 4× chat tokens, multi-agent about 15× chat)
- "Towards a Science of Scaling Agent Systems", 2025 — https://arxiv.org/abs/2512.08296 [P] (checked: 39–70%, 17.2×)
- Cemri et al., "Why Do Multi-Agent LLM Systems Fail?" (MAST), NeurIPS 2025 — https://arxiv.org/abs/2503.13657 [P]
- Cognition, "Don't Build Multi-Agents" — https://cognition.com/blog/dont-build-multi-agents [S]

### Repository evidence (internal)
- `research/jit-20261008/{THESIS-JIT.md §2, §6; SPEC.md (Addenda); DEV-NOTES.md D1–D12; CALIBRATION.md; PREREG-stream.md (§1, §6, budget lines 57–63); nversion-records-dev.json; tierdown/}`
- `research/heal-20261008/DESIGN.md:1013-1019` (B.6)
- `research/review-20261007/10-STATE.md` (rows 1–2, R-bench row, S3)
- `research/landscape-20261006/03-harness-search-and-self-improvement.md:253`
- `beds/gridquest/README.md` (diagnostic baselines table)
- `experiments/jit/{stream.mjs:23,162,172,517-518; router.mjs; run-compiled.mjs:45-46; flow-v2.mjs; tierdown.mjs}`
- `src/models/port.mjs:47,158`
- `experiments/kev-data/build.mjs:61`
- `policy/models.json` (`policyVersion` 2026-10-08.2)
- Run data:
  - `experiments/runs/jit/jit-dev-{records,kinetics}-1/*/results.jsonl`
  - `jit-dev-records-1/jit-claude-sonnet-5-5--claude-haiku-5-5/traces/i000-interpreter-b39702.json`

**Provenance.**
- The harness flagged one input sweep (durable-execution OSS) for an instruction-shaped pattern. The match is that sweep's citation of the Claude Agent SDK permission docs: deny rules are evaluated before allow rules in every permission mode. It is not a directive, and nothing in it was acted on.
- This pass made no repository edits, no git operations and no model calls.
- [M] figures come from read-only scripts in the session scratchpad (`sum.py`, `s4.py`, `snap.py`), which are not committed.
- The 04:22 figures will drift while the kinetics and records H/H arms run. Regenerate them before circulating.