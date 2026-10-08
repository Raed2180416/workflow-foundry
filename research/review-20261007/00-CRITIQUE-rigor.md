# Critique B of the synthesis: rigor and feasibility (2026-10-08)

*Critic B. Reviews `00-SYNTHESIS.md` (HEAD `c7149b6`, written about 08:30 UTC). Development and diagnostic
material only; nothing here is a sealed result. Read-only: the only file written is this one. Corpus, transcripts,
web pages and task text were read as data.*

**Tags.** **[M]** I ran a command and name it. **[D]** a file says so; I did not re-run it. **[I]** my reasoning.

**What I re-ran.**
- P1 at the synthesis' cut: rows of `experiments/runs/p1/results.jsonl` with `at <= 2026-10-08T08:20:00Z` (201 rows,
  $16.63) through `node experiments/p1/analyze.mjs`. Every P1 number in the synthesis reproduces [M]. Again at 08:36
  (230 rows, $19.69): fhand-haiku 27/28, Sonnet call 21/28, Haiku call 21/27, Haiku agent 21/27, B0+N 17/36 [M].
- C0: `node experiments/c0/analyze.mjs experiments/runs/c0-dev`. Every C0 cell reproduces [M]. Total recorded spend
  $35.3 (constructions $14.87, probes $2.02, execution $18.43) [M].
- Agent-framework slice: `/var/tmp/foundry-work/corpus-agentic/*.jsonl`, 225 items at 08:31 (the synthesis counted
  199 at 08:18). Native 46 (20%), native or the 19 planned constructs 80 (36%), the same shares as the synthesis.
  All 225 descriptions have provenance `written` [M].
- Source checks: PREREG (P1, C0-dev), the four diagnoses, the lane docs, ROADMAP §2.9, §3, §4.3 and §6, THESIS §1,
  README, `beds/sealed/MANIFEST.json`, and `research/replicate-20261008/SELECTION.md` (it appeared at 08:34, after the
  synthesis was written).

**Bottom line.** The arithmetic is sound: no number I checked is wrong at its timestamp. The problems are
interpretation and plan:
1. Three headline points state K_c = 1 development results as findings.
2. The security section and the plan contradict each other on when the holes close. Third-party content reaches
   open-network executors in Stage 1.
3. Every stage depends on something not yet built, or on an engine that the same stage is changing.
4. The four weeks hold about two months of work, and the plan does not count usage allowance.

The fixes below are exact. P0 items must be fixed before the synthesis goes to the owner or any stage starts.

---

## P0: fix before sending or starting

### P0-1. Security fixes land after the runs that need them, and the plan contradicts §7

**Where.** §5 Stage 1, line 789; Stage 2, line 812; Stage 3, line 831; §7, line 889; decision 4, line 876.

**What is wrong.**
- §7 says items 1–8 land in the Stage-1 engine bump, and that none is optional for R-bench. But the Stage-1
  deliverables (lines 779–786) contain only items 1, 7, 8 and 12.
  - Item 5, executor isolation, is in Stage 3 (line 831).
  - Items 2 (sink-field policy), 3 (declassification budget), 4 (construction-time provenance taint) and 6
    (model-written code) are in no stage.
- Stage 1 runs the R-bench pilot with an "Opus free builder". That builder is a Claude Code executor with open egress
  and the CLI login readable in the sandbox (PREREG-dev amendment 3; L7 §3.4) [D].
- R-bench T1 prompts carry third-party definitions [D SELECTION.md §1, §6]. `n8n:18122` embeds live-looking Slack and
  Discord webhook URLs [D SELECTION.md §7]. An injected builder with open egress can call real third-party services
  or exfiltrate the login.
- Decision 4's default ("no executors on untrusted third-party content until provisioned") forbids exactly this Stage-1
  run. It also forbids every executor-based arm (builders, B0) on R-bench and in the Stage-2 injection slice.
- The injection slice (Stage 2) needs item 4 (provenance taint) and item 5. Without them it only re-measures holes
  already known to be open.
- ROADMAP §2.9: "The builder's own context must not contain untrusted content." R-bench T1/T2 and the injection slice
  put third-party text in the builder's context. No amendment is stated.

**Fix.**
1. Add a gating table to §7: item × the first run that needs it × the test that must pass first. Minimum rows:
   - item 5 (egress none, no login in the sandbox, canary test) **before** any builder or B0 run on R-bench, corpus or
     external text;
   - items 1 + 2 together before any R-bench validation (see P1-15);
   - item 4 before the injection slice;
   - item 6 before any agentic item that executes model-written code.
2. Move every R-bench *construction run* to after item 5 passes its canary test. Stage 1 keeps R-bench harness and
   fixture building only, with no builder runs.
3. If decision 4 (API key) is not provisioned, R-bench runs are limited to T2 tasks built by the in-runtime structured
   builder (no executor), from redacted and secret-scanned descriptions. Say so in §3.7.
4. Add an explicit ROADMAP §2.9 amendment request (new decision 12): "Builders may read third-party task text only with
   provenance taint, no effects, no egress and mock capabilities." Otherwise R-bench T1/T2 cannot run.
5. Item 13: originals run as controls (SELECTION P5 "original bash steps run as the real control"; 17 items "heavy
   (containers/venv)") run only in the no-network sandbox, inside the D5 image cap, and never on the host.

### P0-2. Headline points state K_c = 1 development results as findings

**Where.** Point 2 (line 32), §3.6 (line 410), §3.7 (line 449), W2 and W4.

**What is wrong.**
- C0-dev is one construction per arm and family, two families. Its PREREG says "**directional only; no claim is made
  from this round**" (PREREG-dev §4). ROADMAP §4.3 says "No K=1 comparative claims".
- The gaps sit at their CI edge [M C0]:
  - F-haiku − F-opus = −0.313 [−0.625, 0.000];
  - F-haiku − B1-haiku = −0.313 [−0.625, 0.000].
- The codefix failure is not Haiku-specific. The same check defect (a default-value change rejected as a signature
  change, with a fallback that returns the unpatched module) sank the **Opus-built** script: B1-opus codefix 4/8
  [D `diagnosis/B1-opus-codefix.md`]. It is a family trap that both builders hit.
- The synthesis omits a key cell. On codefix, plain Claude Code on Haiku (B0-haiku) passed **8/8 at $0.035 per
  trial**. That is the cheapest CPS of any arm (F-opus $0.104, F-haiku $0.278) [M C0].
- "Here the tools did not help; letting code own the procedure did" (line 410) fails on two counts:
  - the P1 success gap is not established: fhand-haiku − b0agent-haiku = 0.219 [0.000, 0.417], McNemar p = 0.5 at
    08:20 [M]. At 08:36 the agent ties the plain Haiku call (21/27 each) [M];
  - on codefix, the tool-using Haiku arm won.

**Fix.** Replace point 2 with:
> **2. When Haiku builds the workflow itself, the first sample is worse, but too small to call.** In C0 dev (2
> families, one construction per arm, 8 trials per cell, no claim by pre-registration): Haiku-built workflows 11/16,
> Opus-built 16/16, Haiku-built scripts 16/16; F-haiku − F-opus = −0.31 [−0.63, 0.00]. The codefix failure also sank
> the Opus-built script (4/8), so it is a family trap, not yet evidence about Haiku. On codefix, Claude Code with Haiku
> and no workflow passed 8/8 and was the cheapest per success.

Replace the last two sentences of the §3.6 "Why not give the executing Haiku tools?" paragraph with:
> It passed 17/23 at $0.086 per trial, against 23/24 at $0.016 for the workflow (08:20). The cost gap is clear (CPS
> ratio 0.14 [0.09, 0.23]); the success gap is not (0.22 [0.00, 0.42], McNemar p = 0.5). In C0 codefix, the same kind
> of arm passed 8/8 and was the cheapest per success. Tools help on some families and not on others, which is what the
> router has to learn.

In §3.7, replace "C0 already shows the drop" with "C0 dev hints at a drop (K_c = 1, CI touches zero)". In W2 and W4,
add "(K_c = 1; directional)" and the B1-opus codefix cause.

### P0-3. Stages depend on things that are not built and not in the plan

| Plan item | Depends on | Status [M/D] |
|---|---|---|
| CX3, R-bench pilot (Stage 1) | the structured builder: 12-step construction workflow, oracle discovery, skeleton library with typed slots and self-tests, worked examples | not built; no deliverable, owner or effort anywhere in §5 |
| R-bench pilot (Stage 1) | shared mock kit, fixtures, reference solutions, broken controls, oracle health tests; owner rulings on the contract deviations (oracle runtime > 2 s, loader shim while `beds/` and `experiments/lib` are frozen) | SELECTION.md §2, §6, §9: 58 h for the 5 pilots, 312 h for all 30; no oracle exists yet |
| C0 sealed round (Stage 2) | `PREREG-sealed.md` | absent (`ls research/construction-20261006/`) |
| C0 sealed, all 4 families | an env port: `sealed-3` is `kind: interactive` (`beds/sealed/MANIFEST.json`), and F workflows cannot run interactive beds because `src/ports.mjs` has no env port (L1 #38, line 334) | not built. The W1 kill rule "3 of 4 sealed families" cannot be evaluated as written |
| B1-cc arm (Stage 2) | a harness that runs a real Claude Code workflow script headless in the sandbox | not built; headless feasibility unverified |
| Injection slice (Stage 2) | §7 items 4–5 and a written injection task set | see P0-1 |
| `wide` vs B5 (Stage 2) | "one bed whose generator scales the item count. If none exists, a bed owner adds one" (L3 idea #1) | none exists, and the §5 stop list forbids "New beds beyond the pending audits" |
| R-bench kill rule "lowering fails on > 50%" (Stage 1) | a lowering pipeline | built in S0 (Stage 2). R-bench tasks are T1 translate / T2 rebuild / T3 improve (SELECTION §1), not lowering |
| T2b external bed (decision 10's default) | TextWorld or AppWorld need the env port; acquisition | in no stage |
| `boardRoot` at seal (§7 item 7) | a board | not built (§2) |

**Fix.**
- Add "structured builder v0 (oracle discovery + strict lint + skeleton slots; owner: L5 design; estimate needed)" as
  a Stage-1 deliverable that must finish before CX3.
- Replace the R-bench kill rule with SELECTION's own health gate: "the original or reference passes and the broken
  controls fail on ≥ 20 seeds; any item failing it is excluded; if > 2 of the 5 pilots fail it, stop and fix the mock
  kit".
- Run C0 sealed on the 3 one-shot sealed families. State that sealed-3 waits for the env port. Restate W1 as
  "2 of 3".
- Write `PREREG-sealed.md` as an explicit deliverable before the round.
- Run a $1 headless smoke of a Claude Code workflow script before B1-cc enters any prereg. Drop the arm if the smoke
  fails.
- Either amend the stop list to allow one item-scaling bed for `wide`, or run `wide` on `records` only and say so.
- Drop `boardRoot` from item 7 until a board exists.
- Schedule T2b acquisition, or change decision 10's default to "R-bench only".

### P0-4. Engine changes collide with frozen comparative runs

**What is wrong.**
- Stage 1 changes `src/` (store rows, scheduler, launcher, taint, lint, chain binding, CLI env) while CX3, CX8, RX1
  and R-bench run in the same week. Stage 2 runs IR S0–S1 (P-store, P-sched, G1–G3, `call`; L2 §7) in the same week
  as the C0 sealed round.
- Both P1 and C0-dev froze `src` in their freeze records (PREREG §Amendments; PREREG-dev, frozen 22:2x). A sealed round
  whose engine changes mid-run is invalid, and resume refuses with `ENGINE_DRIFT`.
- `FORCE_PROMPT_CACHING_5M=1` changes reported cost by −17% to −31% per call (n = 4–7, L4 §2.4). CPS before and after
  the flag (P1 and C0-dev vs every later run) is therefore not comparable. The synthesis compares across that line
  (W1, W3, the break-even curves).
- S0 includes P-store, P-sched and G3, which the synthesis also schedules in the Stage-1 bump. The effort is counted
  twice and the two descriptions are not reconciled.

**Fix.**
- Name an engine freeze point (E1) at the end of the bump, with conformance green and the hash recorded. No
  comparative run starts before E1.
- S0–S1 work happens on a branch and merges only after the sealed round's last trial. The sealed prereg freezes E1.
- Each prereg records the CLI env flags. CPS is compared only within one engine and flag setting. For cross-stage
  comparisons, also report cost recomputed from journaled token counts at one fixed price table.
- Delete P-store, P-sched and G3 from S0 (they are in the bump) and re-state S0's effort.

### P0-5. The four weeks hold about two months of work, and the binding constraint is not budgeted

**What is wrong (effort).**
- IR S0–S1 is 39–58 engineer-days (L2 §7: 30–45 + 9–13, ±50%, "one engineer who knows this codebase") [D]. Stage 2
  gives it one calendar week, alongside the sealed round, `wide` and owner-task collection.
- Stage 1 holds:
  - L4's "largest change in the list" (store rows, about 30 `current()` call sites plus resume and audit paths);
  - six other engine items;
  - the unbuilt structured builder;
  - CX3 (30 constructions, 240 trials), CX8, the RX1 pilot and R-bench.
- Throughput: P1 ran 230 trials in 9.7 h at concurrency 4, about 24 trials per hour [M]. The RX1 pilot (2 of 5
  families of a 2,500-trial sweep, so about 1,000 trials) alone is about 40 h of wall time [I].
- R-bench: SELECTION.md estimates 312 h of harness work for 30 items (58 h for 5 pilots). §5 plans 10 items in
  Stage 1 and 30 in Stage 3 at "$30–60" and "$60", counting model $ only.

**What is wrong (usage).**
- README: list price "is a yardstick, not a charge"; subagents and `claude -p` share the plan allowance.
- The week that reached `allowed_warning` carried about $85 of experiment calls plus seven review lanes [D L1 #20;
  D README].
- The plan schedules $175–205, $380–400 and $220–265 in the next three weeks, plus heavy agent building. It has no
  estimate of how much allowance a list-price dollar uses, and none for orchestration.
- Stage 0 breaks the synthesis' own usage rule ("only pre-registered runs already in flight continue"). It schedules
  new runs (idea #4, $2), an independent agent's 30-item audit, agentic-slice freezing by Sonnet agents, and possibly
  C0-dev `incident` (decision 8).

**Fix.**
1. Allowance calibration (Stage 0, free): record the meter percentage against the list $ of P1 and C0 for this week,
   and the orchestration share. Give every stage a budget in allowance percent (for example ≤ 60% of a week for
   experiment calls), not only list $.
2. Stage 0 under warning: a single writing agent; no new model runs except finishing P1. Idea #4, the 30-item audit
   and agentic curation move to Stage 1. Decision 8's `incident` option is deleted (see P1-17).
3. Re-plan over five to six weeks, in this order:
   - (a) engine bump, then freeze E1;
   - (b) structured builder v0 plus CX3 and the cross-fitted RX1 pilot (P1-1);
   - (c) item 5 with its canary test, then 5 R-bench pilots under the 2×2 design (P1-3, P1-10);
   - (d) C0 sealed on E1;
   - (e) S0–S1 after the sealed run, then `wide`, S2 and the executor experiment.
4. State the honest date for "compiled coverage": after (e), not Stage 2.

---

## P1: fix in the synthesis or the pre-registrations before the runs

**P1-1. RX1's headroom estimate is biased upward, so its kill rule cannot fire** (line 334; L5 §2.10 and table row
RX1).
- The oracle mode is `argmax_m u_im`, computed from K = 2 pass estimates per instance. A maximum over noisy estimates
  beats the best fixed mode even when every mode is identical (winner's curse).
- RX1's F modes are the C0-dev artifacts: K_c = 1, every one fails the new `ACCEPTANCE_EXISTENCE_ONLY` lint, and RX1
  runs in the same stage that changes the engine.
- **Fix:**
  - Cross-fit: pick m* on trial 1 and score it on trial 2, and the reverse.
  - Report the permutation-null headroom (mode labels shuffled within instance) next to it.
  - Apply the kill rule to the lower 95% bound of the cross-fitted headroom.
  - Run RX1 on E1 only. Label the C0-dev artifacts "legacy, lint-exempt", or rebuild them with K_c ≥ 2.

**P1-2. "3 points" and "5 points" are used as thresholds that these sample sizes cannot resolve.**
- Examples:
  - §3.8 "within 3 points of Opus, don't train";
  - CX5 "beyond 3 pts";
  - RX1 "< 3 points";
  - `wide` "> 5 points worse" (n = 30 tasks, K = 3);
  - spawn depth "< 5 points".
- ROADMAP §4.3's rule is "gaps under 3 points are noise". That does not make gaps over 3 points real. P1's own
  pre-registration puts the detectable gap at about 35 points for 12 × 3, and ROADMAP puts a 10-point gap at 116–234
  paired tasks.
- **Fix:** every kill rule names a non-inferiority margin δ and a family-clustered CI, with a power table in the
  prereg. When the run is below powered size, the rule's outcome is "directional, no decision". Train and no-train,
  router and no-router decisions then wait for a powered read or are made explicitly by the owner.

**P1-3. The C0-sealed kill rule cannot fire, and two comparisons confound model with method** (line 823; §3.5).
- "Construction success" in C0 is a probe pass (PREREG-dev §2), and dev probes were 8/8. "Below half of Opus" on
  probes will not trigger.
- The rule pits "F-haiku with the winning builder" against "F-opus" (the free builder). The R-bench pilot pits a
  "Haiku structured builder vs Opus free builder" (line 789). Either way, builder model and builder method change
  together. AGENTS.md: "Separate architect model, executor model, tools, runtime".
- **Fix:**
  - Define the rule on verified *test* success and amortised CPS, with CIs.
  - Run both builder models with the same method, or a 2×2 (Haiku/Opus × structured/free) on R-bench and in the
    sealed round.
  - Say whether "half of Opus" is really the intended bar: 8/16 vs 16/16 would pass it.

**P1-4. The pooled break-even numbers mislead** (line 328; W3).
- The pooled C0 values mix two families whose B0 cost differs about 6× ($0.20 vs $0.035 per trial for B0-haiku).
- Per family [M C0]:

  | Arm | records | codefix | pooled |
  |---|---|---|---|
  | F-opus | 3.8 | 9.6 | 10.5 |
  | F-haiku | 2.9 | never | 486 |
  | B1-haiku | 3.9 | never | 27.5 |

  On records, F-haiku repays its construction in about 3 successes. "486, in practice never" is a pooling artefact.
- **Fix:** report per family only. Add "K_c = 1; B0 here is Claude Code with tools, not a single call".

**P1-5. The B0+N result is a timeout artefact** (§3.12, line 596).
- 16/33 includes 13 `MODEL_TIMEOUT` trials (the per-call timeout that also cost the thinking-on Haiku call 5 trials).
  Without timeouts it is 16/20 [M, error tally on the 08:20 cut].
- **Fix:** delete it as evidence against a cross-run store, or write "confounded by timeouts (13/33)".

**P1-6. Coverage claims run ahead of the evidence.**
- (a) Line 100 says Foundry "**expresses their control semantics (measured)**". Today: 476/1,342 declared, 0
  compiled, 0 executed. Replace with "targets their control semantics; today 35% declared, 0 compiled".
- (b) Line 96 lists "a written semantics and a conformance suite" as what Foundry *is*. Neither exists (S0 builds
  them). Mark it "target".
- (c) "Executed" can only be measured on items with an oracle (96 T1 items plus frozen T3 fixtures). Decision 2
  should define executed coverage as executed / oracle-eligible, never as a share of 1,342.
- (d) The "fresh held-out sample of about 300 items" has no acquisition plan, owner, cost or date. Add one, or drop it
  from decision 2.
- (e) "95% after 12" (line 219) includes `group-chat`, which §3.1 says to refuse. Recomputed at 225 items with
  group-chat excluded [M]:
  - 75% needs 8 agentic constructs;
  - 95% needs 15;
  - the ceiling is 96%, lower still once full-history handoffs (part of 26 items) are refused.
- (f) 60% of agentic items (134/225) need the agent tool loop, which is S5, deferred past the S2 check. So the agentic
  slice's compiled coverage stays at about 20–25% for the whole plan. Say so.

**P1-7. The agentic-slice falsifier cannot fail** (line 235; §3.15 idea #3).
- "Outside the plan *and* outside the refusal list": the plan is the synthesis' own mapping of every agentic
  construct onto "mechanisms already planned" [I], and the refusal list is open. Every verdict is a Sonnet extractor's
  unaudited label.
- **Fix:**
  - Freeze the construct→mechanism map and the refusal list (by hash) before the 30-item audit.
  - The falsifier counts items whose mechanism is not *implemented and compiled* by a named date, judged by an agent
    that did not write the map.
  - Treat all 225 agentic descriptions as leaky (all `written`, L5 §2.6). Keep them out of R-bench T2 and router
    labels.

**P1-8. Plan items conflict with ROADMAP §3 non-goals, and the THESIS claim changes, without stated amendments.**

| Non-goal or claim | Plan item | Fix |
|---|---|---|
| "A model gateway or provider router" | decision 4 and §7 item 5: a host gateway with per-node, budget-scoped, revocable model tokens inside the runtime | Amendment text: "a minimal egress proxy for executor model calls, no routing, no provider choice", or reuse the experiment gateway (`experiments/lib/services.mjs`) outside `src/` |
| "A memory store (AMP)" | the S5 state capability holding chat sessions and cross-run state (decision 5 amends only §2.2) | Amend §3 explicitly, or route the state capability through ContextPort/AMP |
| "Runtime self-modification by small models" | decision 3, "Haiku 5.5 constructs, **edits** and runs"; the construction loop's patch step; the "edit half" | Add to decision 3: "edits are version-bound proposals, applied by code only after replay, never inside a running run" |
| "A general agent loop" | "a Foundry-native loop is built only if a measured family needs it" (§3.6) | Add: "requires a §3 amendment at that time" |
| "Tracing UIs" | the run view and flight recorder | State that it is the §2.10 inspection face, read-only, with OTel export kept; record it as an amendment. Also `tools/` is a new top-level directory not in the AGENTS layout |
| THESIS §1 / AGENTS objective: "cheap **open-weight** models" | the narrowed claim (§3.18) and decision 3 make Haiku 5.5 the cheap executor; local generative models are parked | Say plainly that C1's open-weight half is untested and needs a GPU route, and ask the owner to amend the THESIS sentence or keep it as an open claim |

**P1-9. Usage-limit facts are inconsistent.**
- §3.9 says the weekly limit was exhausted "once" (line 511). W8 says "twice" (line 739). README documents one
  incident; L1 says twice, citing T:3571.
- **Fix:** pick one and cite it. Also see the allowance budget in P0-5.

**P1-10. Baselines are missing.**
- The R-bench pilot has only two Foundry builders. Add B0 (Claude Code solving each scenario directly) and B1 (a
  plain script), which SELECTION.md §9 already lists ("plain script").
- S1 ends with no capability number, though L2 §7 requires S(n) vs S(n−1) at every stage. Add it.
- Owner tasks (T3) have no oracle protocol. If Claude writes oracles after seeing them, they are no longer sealed
  from Claude; an unbound LLM judge is a §3 non-goal. **Fix:** the owner writes each task with acceptance examples,
  or grades blind and paired against a rubric frozen before the run, recorded as human assistance.

**P1-11. The executor experiment's baseline is at ceiling** (lines 425 and 831).
- On codefix d3, Claude Code alone passed 8/8 with Haiku and 8/8 with Opus [M C0]. "Workflow + executor vs Claude
  Code alone" cannot show a gain there.
- **Fix:** first measure B0-agent on codefix dev seeds at d4–d5 (d5 adds code-comment injection; `beds/codefix`
  README). Run the experiment where B0 < 70%, or on `ownerci`.

**P1-12. CX2 has no variance to test** (line 766).
- 7 of 7 artifacts violate `ACCEPTANCE_EXISTENCE_ONLY`, so "do violations predict failures?" cannot be answered for
  the top rule.
- With dev closed at 2 families, n is 7, not 13.
- **Fix:** replace CX2 with a free mutation check:
  - feed each artifact's acceptance and verify nodes the bed's bad controls and known-good answers from dev seeds;
  - count how many bad answers each one accepts;
  - keep CX2 only for the rules that vary.

**P1-13. The C0-dev test seeds are burned, but the record still says otherwise.**
- All four diagnoses mark seeds 6001–6004 of records and codefix as INSPECTED. `PREREG-dev.md:17` still says "never
  inspected" [D `diagnosis/B1-opus-codefix.md`].
- **Fix:**
  - Add a dated amendment to PREREG-dev.
  - CX3, CX8 and RX1 use fresh test seeds, recorded in their preregs.
  - §7 item 8's test ("re-run the 5 failed F-haiku trials") is a regression test, not evidence. Label it so.

**P1-14. The worked example in §3.4 uses stale numbers that P1 contradicts** (line 327).
- L5 §2.2 assumes the Sonnet single call has p_D ≈ 1, from records v2, n = 6, K = 1. P1 measured 0.72–0.75 at
  $0.20–0.23 per trial.
- The Haiku 5.5 single call matched Sonnet's success at about 13% of the cost [M P1]. So "a one-off task is best done
  by one Sonnet call" is wrong on the synthesis' own data.
- **Fix:** redo the example from P1 and C0 numbers. Haiku call: p 0.75, c $0.03. Sonnet call: p 0.75, c $0.23.
  F-haiku records: C $1.01, c $0.039, p 0.75 (K_c = 1). Break-even for F-haiku vs a Sonnet call is about 5 runs [I];
  against a Haiku call, it never pays at equal p.

**P1-15. The security fixes have no false-positive test.**
- Program-counter taint alone rejects honest "webhook → if field → write row" workflows. L2 G3 says these already fail
  `LABEL_POLICY` without a sink-field policy. That would cut compiled coverage and make R-bench validation fail for
  policy reasons.
- **Fix:**
  - Items 1 and 2 ship together.
  - The Stage-1 numbers include the rejection rate of both policies on every bed workflow and on the compiled corpus
    sample.
  - Kill or redesign if more than 10% of honest workflows need an approval they did not need before [I threshold].

**P1-16. Cost estimates are low or set at the kill line.**

| Item | Problem | Fix |
|---|---|---|
| C0 sealed | planned at $350, its own kill threshold (line 821). The rule is then expected to fire mid-round | give an expected cost below the kill rule, from C0-dev unit costs (about $1.9 per construction and $0.19 per trial [M]) |
| `wide` | "$30–50" for 30 tasks × K = 3 × 5 arms ≈ 450 trials, including a Sonnet single call at about $0.23 per trial (90 trials ≈ $21) and a Sonnet agent | estimate about $80–150 [I], or shrink n |
| R-bench | $30–60 excludes 58–312 h of harness work (SELECTION) | carry hours and allowance next to $ |
| CX3 | "$55" assumes 5 dev families (L5), but only 2 are frozen and audited | re-estimate for the families actually available |

**P1-17. Decision 8's `incident` option cannot happen.**
- It would have to run C0-dev before 10-14, which the usage rule forbids. After the bump it needs a src amendment,
  because `src` is in the C0 freeze record.
- **Fix:** close C0 dev at records and codefix, with no `incident` option.

---

## P2: wording, tags and consistency

1. **Tags.**
   - Line 639: "1,000-item map from 89 s to a 1.65 s floor; 10–54×" is an in-memory, store-less prototype (L4 §0.3),
     not per-node rows. Tag it [I] and use the target "< 5 s".
   - Point 5's effort and "most map onto mechanisms already planned" are [I], not [M].
   - Point 8 and §3.14: give n for the flags (n = 4–7 per shape), for the runtime share (2 runs) and for the UI
     (1 run, scored by its author).
   - Lines 126 and 618: the "6 of 7" count was scored by the UI's author on one run. Tag it [I, self-scored].
2. **Kev.** Line 861: wave 1 is 13 ports of 42 (JUDGE-PROGRAM point 10). Write "Kev wave 1 (13 ports; 42 in total)".
3. **UI exit test.** §3.17 uses 3 failed runs (line 716); §3.13 and ROADMAP §2.10 use 10. Use 10, with and without the
   view.
4. **W11.** "Costs as much as the task" holds only against the $0.0005 trivial call (L5 §5). On a P1-sized task
   ($0.03 per Haiku call), a typed routing call is about 2% of the task. Qualify it.
5. **Point 4.** "Each model release shrinks the set" generalises from one release on one family. Write "the Haiku 4.5
   → 5.5 switch shrank it on records; expect more".
6. **Swarm evidence.** Line 508: "−2 to −15" is SWE-bench Verified; sequential planning is −70% (L3, Kim et al.). Mark
   "Anthropic +90% internally" and the Kimi numbers as vendor-reported.
7. **Idea #4** compares a measured Foundry replay with *documented* Claude Code behaviour (AGENTS.md: keep observed
   and documented apart). Run the Claude Code side too, or label it "vs documented behaviour".
8. **Parallel status document.** §2 is a status table, but ROADMAP §6.1 says README is the single entry point. Move
   the status table into README in the Stage-0 docs commit, and keep the synthesis as a review artifact that links
   to it.
9. **Defer decisions 6, 7 and 9.** They govern work deferred past these four weeks (durable constructs, triggers,
   router exploration). Fewer open decisions for the owner.
10. **R-bench descriptions.** "Writing descriptions for 63 more T1 items would roughly triple the pool" (§3.7)
    conflicts with "use only the 449 original descriptions". Pick one: written descriptions go to T1 translate only.
11. **"Not toy."** That argument rests on the Haiku 4.5 call (0/25). Add the more relevant same-model P1 comparison:
    fhand-haiku vs the Haiku 5.5 call, success +0.21 [0.04, 0.50] (McNemar p = 0.5) and CPS ratio 0.41
    [0.31, 0.50] at 08:20 [M]. The workflow is cheaper per success than a single Haiku call, which the synthesis
    never says.
12. **P1 numbers have moved** since 08:20 (230 rows at 08:36; see the method notes above). The timestamps are right.
    The REPORT must use the final rows only and quote the pre-registered decision rule's result, not the counts.
13. **"About a fifth of the way."** It has no rubric. Give the rubric (layers weighted by what?) or drop the number
    and keep the table.
14. **§7 item 10** (usage-limit pause instead of failure) protects every heavy run. L3 notes that `-p` runs fail at
    the limit. Land it with the Stage-1 bump, not "before the stage that needs it".
15. **`codefix` "usually fails from difficulty 3"** is a design target, not a measurement (`beds/codefix/README.md:5`).
    C0 shows B0 agents at 8/8 on d3. Fix any place that treats d3 as hard (P1-11).

---

## Numbers checked

| Claim (synthesis) | Source | Status |
|---|---|---|
| fhand-haiku 23/24 at $0.016; Sonnet call 18/24 at $0.23; Haiku call 18/24 and 17/24; agent 17/23 at $0.086; fhand-sonnet 24/24; Haiku 4.5 0/25; CPS ratio 0.053 [0.043, 0.065]; B0+N 16/33; $16.63 over 201 trials | P1 analyze on the 08:20 cut [M] | correct. Interpretation issues: P0-2, P1-5 |
| 5 of 7 thinking-on failures are timeouts | error tally [M] | correct |
| C0: F-opus 16/16, F-haiku 11/16, B1-haiku 16/16, B1-opus 12/16, B0-opus 16/16, B0-haiku 12/16; execution CPS F-opus/B0-opus 0.15 [0.06, 0.37]; construction $1.01/$2.47 and $0.90/$2.04; break-even 10.5, 486, 27.5; about $35 | C0 analyze [M] | correct. Break-even values are pooled (P1-4) |
| Verdict "pass" on all 5 failed F-haiku trials | `results.jsonl` `meta.verdict` [M] | correct |
| Acceptance "exists" in 7/7 artifacts | L5 §1.2 (4 C0 + 3 gate smokes) [D] | correct |
| 199 agentic items, 41 native, 70 with planned; 75% after 7, 95% after 12 | corpus-agentic, recomputed at 225 [M] | shares hold; the 95% figure needs the refused group-chat (P1-6e) |
| 476 declared, 1,340/1,342 ceiling, stage percentages, 125–190 ed, 27 of 46 cycles, ≤ 11 ms | L2 §0, §7, A.6 [D] | correct. The effort is [I] ±50% |
| 1–3% runtime, 76–81% model, flags −17% to −31%, 1.89 → 3.01 calls/s, 73–135 s, 212 → 41 ms, 19 person-weeks | L4 §0, §2.4, §6, §7 [D] | correct at small n (P2-1). The 1.65 s figure is a prototype floor |
| Stock Kev ≤ rules on 4 of 5 ports | L1 gap 9 table [D] | correct (the 5th is +1 point, which is noise) |
| 19 unit tests, 74 browser checks, p50 12 ms, 45 ms fold | L6 [D] | correct. The 6/7 count is self-scored |
| Spend so far about $85 | L4 journal table and results files [I] | arithmetic holds (≈ $83) |
| Weekly limit hit "once" (§3.9) vs "twice" (W8) | README, L1 | inconsistent (P1-9) |
| "Full Kev wave-1 build (42 ports)" | JUDGE-PROGRAM point 10 | wrong: wave 1 is 13 ports |
| Sealed families: 4, never used | `beds/sealed/MANIFEST.json` [M] | correct, but sealed-3 is interactive (P0-3) |
| R-bench "no research/replicate-20261008/ yet" (08:14) | directory listing at 08:34 [M] | now superseded by SELECTION.md (30 items, 312 h, no oracle yet) |
