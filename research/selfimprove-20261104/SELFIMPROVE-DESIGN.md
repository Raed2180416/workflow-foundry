# Safe self-improvement: Harness² and Prime Agent ideas inside Foundry (design track, 2026-11-04)

*Saved from the self-improvement track of the production/healing/org/edge design workflow (run wf_ecd944d0-03e). It is the only
track that finished before the usage limit stopped the run; its adversarial check and the synthesis did not run, so this is an
unchecked design, not a result. Code read: research/selfimprove-20261104/HARNESS2-PRIMEAGENT.md (pinned clones under corpus/harness-study/).*

## Headline

Take Harness² and Prime Agent as proposers and record formats only. Foundry's code gate stays the only promoter, and model judges may veto but never promote. Promoter, not proposer, is the line between safe and unsafe self-improvement in every system read (GEPA, AFlow, MaAS, ADAS and DGM gate on ground truth; Harness², Continual Harness, AWM-online and Voyager gate on a model and show wrong admissions). Our gate exists in pieces: heal V0–V8, the pure promote decision with CAS lineage and circuit breaker, certifyHeal tri-state, DUR-1's gate, canary and rollback, the C2-2 conformance gate and the κ budget. Lifting them into one engine module takes about 6–9 days and $0. Two blockers stand before task #105. First, FH-1 never exercised the regression filter on a harmful patch, so #105 must inject known-harmful candidates. Second, DUR-1 is stopped at Stage Z, so #105 starts with a pilot of at most $6 on FH-1's 35 recorded heal runs, then runs its decisive form (at most $8) on DUR-1 after DUR-1's amendment.

## Current state (each fact with its evidence)

- Harness² promotes by a model selector over anonymised finals with no oracle. The published pool excludes the base ('no abstention by construction'), and a selector failure falls back to the first final, not to a base. So Harness² always adopts an edited harness. The 11-04 note describes a more generous base-vs-edit variant. (corpus/harness-study/harness2/harness2/core/selection.py:93-111 and :237-252 (pinned 6868817518876de8fd170c6a8354daca273b6191); schedule.py:561-575 passes pool_kind='finals'; research/selfimprove-20261104/HARNESS2-PRIMEAGENT.md:28-29 and :93-95)
- Harness²'s budget is 4·k rollouts plus 3·k editing sessions per task at recursion budget k (20 + 15 at k = 5), not thousands. HARNESS2-PRIMEAGENT.md:25 and :76 ('about 7k runs per task') are ambiguous or wrong. (harness2/core/recursion.py:15-19 (module docstring), :379-457 (parallel: 2k proposals, k compositions), :489-575 (sequential: 3 stages per round))
- Harness²'s experience library has no admission gate. Every adopted harness whose reflector returns cue, lesson and evidence is stored. Only grader-verdict leak checks apply, and nothing is retired except by stream order. (harness2/core/schedule.py:608-616; library.py:90-152)
- Prime Agent promotes model-proposed edits after a structure check only. A model 'automatic /refine review gate' decides whether to refine. A stale-baseline check rejects edits to entries that changed since planning. A corrupt state file silently degrades to empty. (corpus/harness-study/prime-agent/crates/pa-core/src/refinement/planner.rs:10-12, :193-283, :295-297, :505-545 (rollback from before/after snapshots); executor.rs:358-405; mod.rs:169-176 (pinned bba5bcf3f53dff4fe42bed2356c8569dafb00966))
- The Factorio/RCON exploit is not in Prime Agent's README at the pinned commit. Only secondary coverage reports it, citing Prime Intellect's own writeup. (grep -rli factorio over the clone returns nothing; https://andrew.ooo/posts/prime-agent-primeintellect-self-improving-rlm-harness-review/ (opened 2026-11-04))
- DUR-1 is not running. Its chain stopped at Stage Z at 20:32Z on fail-closed gates: E1 exposure 8/10 on s1-W2; L1 2/8, 2/8 and 4/8 on W4 across all streams; a V-1 reference/grader disagreement on s1-W5. Spend is $1.49. A dated amendment is required before any paid step. #105 cannot use the stream yet. (git show a6e6d385 (branch worktree-wf_bd674a6e-71f-11); research/durability-20261021/runs/stagez/STOP.json and DIAGNOSIS-20261104.json on that branch)
- FH-1's gate was never tested on a harmful patch in paid runs. No attempt regressed anything, and the regression filter was exercised only in a $0 dry run (raw +7/−48, rejected). The '0 regressions' figure belongs to the gate, not to healing: regeneration behind the same gate also regresses 0 (E[net] 64; best-of-2 128). The gate rejected 12 of 16 regenerated peers. (research/heal-20261021/RESULT-FH1.md:25, :235-238, :465-466, :507-529)
- FH-1's contract-gated heal removed 357 of 475 failing cases (75.2%) with 0 regressions for $1.142 of Haiku. That excludes $6.69–19.58 of frontier-written contracts. The heals do not carry over to drift (0 of 8 changed cases). (research/heal-20261021/RESULT-FH1.md:29-34, :480, :737)
- A promoter already exists in experiments. It has the V0–V8 verify stages (static, lint, weakening proofs, failing-case replay, regression slice, acceptance discrimination with reference and bad controls, cost bound, fresh paired tasks, locked-grader hash). It has a pure promote decision, CAS lineage promotion and rollback, a shadow circuit breaker, and certifyHeal (accept | reject | inconclusive). (experiments/heal/verify.mjs:1-9, :37-44 (gradersHash); experiments/heal/promote.mjs:17-45, :70-115; experiments/lib/certify.mjs:337-364)
- DUR-1's frozen heal protocol already specifies the target gate. It has a regression set (practice worlds with announced overlays, the last 3 world-days, W1), zero new contract or m1/m3 findings, a one-world-day shadow canary, CAS promotion with proposer ≠ approver, rollback within 2 world-days, and information hygiene. (research/durability-20261021/PREREG-DUR-1.md:262-302 on branch worktree-wf_bd674a6e-71f-11)
- Reuse is safe only behind consumer evidence. The conformance gate made 0 wrong reuses in 98 (5 admitted suppliers, no M3 certificate after review). It accepted 17 of 17 wrong items when a supplier's service changed meaning after admission: past evidence cannot see drift. (research/reuse-20261021/RESULT-C2-2.md:17-24, :51-60)
- Model verification is correlated and near chance in-pipeline. Own checks reach AUROC 0.47–0.58. Judges reach 0.69–0.76 and share mistakes (κ 0.61–0.70). VL-1 selection picked the passing fork 0.72 of the time. C0's self-check passed all 5 oracle failures. A loop on an open-world verifier optimised its blind side: content guardrail breaks rose 16 → 28 while recipient breaks fell 10 → 1. (research/status-20261104/WHY-NOT-HIGHER.md:93-97, :111-113, :216; research/blockers-20261021/ATTACK.md:162-172)
- THESIS forbids evolving one global workflow and locks graders. Every promotion replays the failures plus a regression slice. (docs/THESIS.md:26, :158-159)
- The org layer already has a proposal registry and gate that judges under the version in force. It checks the approver's role, refuses self-approval and self-grant, and allows lower layers only to narrow. The product's MCP surface separates proposing from approving. (research/org-20261021/README.md:31-32; app/mcp/server.mjs:3-10 (propose_flow, ask_person_to_turn_on, run_flow))
- An information-path budget exists. A new judge or check is admitted only if its agreement with existing signals stays under κ 0.4. n_eff is reported. (experiments/lib/infopath.mjs:1-30)
- FH-1's recorded heal attempts are committed and reusable at $0 for a retrospective promotion audit: 35 run directories, each with patch.diff, smoke.jsonl and grading-after.json. (research/heal-20261021/fh1/runs/ (e.g. ch-e8-1.H-0.k1/{patch.diff,grading-after.json,record.json}); research/heal-20261021/fh1/posthoc.json)

## Design

# Foundry's self-improvement loop: proposers from anywhere, one promoter

Evidence labels used below: **[code]** means read in this repo or a pinned clone, with path:line. **[result]** means a committed result. **[paper]/[web]** means a page opened on 2026-11-04. **(inference)** means my reasoning, not a measurement.

## 0. The answer to the owner's question

1. **Copying Harness² and Prime Agent wholesale would add failure points. Taking their proposers and record formats does not.** The risk sits in their promoters:
   - Harness² promotes by a model choosing among anonymised outputs, with no oracle and no option to keep the base [code `harness2/core/selection.py:93-111, 268-357`].
   - Prime Agent promotes a model's own edit after a structure check [code `planner.rs:193-283`], plus a model "auto-refine review" [code `planner.rs:12`, `executor.rs:358-405`].
   - We have measured both kinds:
     - Selection among forks picked the passing fork 0.72 of the time, and judges share their mistakes at κ 0.61–0.70 [result `WHY-NOT-HIGHER.md:93-97, 111-113`].
     - A self-check passed all 5 oracle failures [result `WHY-NOT-HIGHER.md:216`].
2. **The literature splits the same way (§2).**
   - Every method reporting held-out gains (GEPA, AFlow, MaAS, ScoreFlow, ADAS, DGM) promotes on a ground-truth metric over a development split.
   - The verifier-free methods (Harness², Continual Harness/Prime Agent, AWM online, Voyager) promote on a model's judgment. They are the ones with documented wrong admissions:
     - AWM: "incorrect workflows that degrade model performance".
     - Continual Harness: newly authored sub-agents overtook inherited ones and regressed.
     - Prime Agent: the Factorio RCON exploit, per secondary coverage.
3. **The design has these parts:**
   - Many proposers.
   - One promoter: a code gate on frozen oracles and contracts.
   - A shadow canary.
   - Compare-and-swap (CAS) promotion.
   - A circuit breaker that rolls back.
   - Model judges **may veto a gate-passed change, never promote one**. This is the rule already adopted for world data, "data may restrict, never authorise" [result `WHY-NOT-HIGHER.md:65-71`], applied to judges.
   - The loop cannot write the authority layer.
   - Blast radius decides who approves. These are the owner's "sections for control".
4. **Most of the promoter already exists, spread across experiments:**
   - verify V0–V8 [code `experiments/heal/verify.mjs:1-9`];
   - the pure `decide`, `Lineage.promote` (CAS), `rollback` and `circuitBreaker` [code `experiments/heal/promote.mjs:17-115`];
   - `certifyHeal` (accept, reject or inconclusive) [code `experiments/lib/certify.mjs:337-364`];
   - DUR-1's gate, canary, rollback and hygiene [code `PREREG-DUR-1.md:262-302`, branch `worktree-wf_bd674a6e-71f-11`];
   - the consumer-conformance reuse gate [result `RESULT-C2-2.md:51-60`];
   - the κ budget [code `experiments/lib/infopath.mjs`];
   - the org registry gate [code `research/org-20261021/README.md:31-32`].
   The build is mostly consolidation.
5. **The gate's own weak point is untested.** In FH-1 no paid attempt regressed anything, so "the regression filter was exercised in the $0 dry run alone" [result `RESULT-FH1.md:235-238`]. #105 must inject known-harmful candidates. Otherwise it cannot tell a gate from a rubber stamp.

## 1. Corrections to the 2026-11-04 reading (re-read in code today)

- **Harness² cannot keep the base.**
  - Its pool is "exactly the k finals … there is no abstention by construction" [code `selection.py:93-111`], called with `pool_kind="finals"` [code `schedule.py:561-575`].
  - On selector failure it falls back to the first final, not the base [code `selection.py:237-252`].
  - Our note's "falls back to a delivered base" and "chooses between the base and the edited run" describe a more generous variant. #105 runs both.
- **"4k rollouts and 3k improvement stages" means 4·k and 3·k** [code `recursion.py:15-19, 379-457, 489-575`]. At k = 5 that is 20 rollouts and 15 editing sessions per task. The note's "about 7k runs per task" should read 7·k sessions. That is still about 35 sessions against our one replay plus a regression slice.
- **Harness²'s library admits every adoption that has a lesson** [code `schedule.py:608-616`, `library.py:106-152`]. Its only checks are for grader-verdict leaks. It retires nothing except through stream order [code `library.py:90-104`].
- **Prime Agent:**
  - The Factorio case is not in the README at `bba5bcf3` (grep finds nothing). A review attributes it to Prime Intellect's own writeup [web andrew.ooo]. Mark it secondary.
  - The code has a CAS-like stale-baseline rejection [code `planner.rs:295-297`]. **Take it.**
  - A corrupt state file "degrades to empty rather than throwing" [code `mod.rs:169-176`]. **Never take this:** Foundry fails closed.
- **Continual Harness** (the paper behind /refine) describes no in-loop gating, validation or rollback of refiner edits. Quality is judged after the fact [paper 2605.09998].
- **DUR-1 is stopped at Stage Z**, not running [code commit `a6e6d385`, `runs/stagez/STOP.json`].
  - The failures: an L1 operator/grader disagreement on 3-item orders, a non-incremental ADV twin, and an unreachable L1 floor.
  - $1.49 spent. An amendment is required before any paid step.

## 2. What each method actually gates promotion on

| Method | Proposer | What promotes | Ground truth | Take / avoid |
|---|---|---|---|---|
| GEPA [paper 2507.19457] | LLM reflection rewrites one module's prompt from traces plus text feedback μ_f | A child is kept only if its score on a D_feedback minibatch improves. It is then scored on D_pareto. Parents are sampled by how many instances they are best on. The final pick is the best mean on D_pareto (Alg. 1, lines 11–20; Alg. 2) | yes (μ = EM, F1, pass rate) | **Take:** reflective proposer, per-instance Pareto pool, μ_f = contract-findings text. **Note:** D_pareto is training data; test is separate |
| AFlow [paper 2410.10762] | LLM edits code-represented workflows, under MCTS | 5 runs on a 20% validation split; soft mixed top-k selection; the best validation mean is kept; stops when the top-k mean stalls | yes | **Take:** a typed search space. A tampering audit flags AFlow 18% vs ADAS 85% [code `research/landscape-20261006/03-…md:277-279`] |
| MaAS [paper 2502.04180] | query-dependent architectures sampled from a supernet | −performance + λ·cost on the training split (1:4 train:test) | yes (oracle answers, inferred) | **Take:** cost inside the promotion objective (G8) |
| ScoreFlow [paper 2502.04306] | generator trained with Score-DPO | executor scores on a validation split | yes | — |
| EvoAgentX [paper 2507.03616] | TextGrad, AFlow and MIPRO | not stated on the page opened | — | — |
| ADAS [paper 2408.08435] | a meta agent writes agent code | accuracy/F1 on 20 validation questions; every evaluated agent is archived; 60 held-out test questions | yes | **Avoid:** an archive with no admission threshold |
| DGM [paper 2505.22954; R03 :185-199] | agents edit their own code | Archive entry if the agent compiles and can still edit code. Evaluation is staged 10 → 60 → 200 tasks, and the 200 include the 60 used for selection | yes (tests) | **Avoid:** detectors inside editable code. Node 114 deleted the logging its detector read, "after only 2 modifications" |
| AWM online [paper 2409.07429] | workflows induced from its own trajectories | an LM evaluator's binary success label | no | **Avoid:** "can lead to incorrect workflows that degrade model performance". Offline plus online is not additive |
| Voyager [paper 2305.16291] | GPT-4 writes a skill, ≤4 rounds | a GPT-4 critic declares the task done | no | **Take:** environment feedback and execution errors as proposer evidence only |
| Harness² [paper 2610.14224; code] | INV and DOM edit sessions, then a composer | model selector, finals only; library admits every adoption | no | **Take:** propose→probe→compose; the cue/lesson/evidence record |
| Continual Harness / Prime Agent | refiner CRUD on supplemental state | structure check plus model review | no | **Take:** immutable vs supplemental state, before/after snapshots, stale-baseline rejection |
| Self-Healing Harness [paper 2609.24130] | agent-authored behaviour rules | External gate: improves the triggering failure; no regression beyond a fixed margin on protected cases; replay first; corpus-level re-test of the active rule set | protected cases | **Take:** the corpus-level guard. **Do not take:** the margin. Note: 211 of 383 rejected proposals (55%) fixed their target and broke a case that used to work |

**Judges are one extra vote at best.**
- 9 judges from 7 families carry about 2 independent votes. The best single judge matches or beats the panel, and aggregation closes at most 11% of the gap [paper 2605.29800].
- Two judges agreed at κ 0.879 with each other and κ ≈ 0.19 with humans, with 50–58% high-confidence errors [paper NeurIPS 2026, 172889].
- Our κ of 0.61–0.70 is the same phenomenon.

**Niche prior art that removes blockers:**
- **Seldonian algorithms** [web seldonian.cs.umass.edu]: candidate selection on one split, then a high-confidence safety test on another. The test returns "No Solution Found" when unsure. That is propose on a feedback slice, gate on a guard slice, and UNKNOWN never passes, with a known theory.
- **Thresholdout** [paper 1506.02629] and **the Ladder** [paper 1502.04585]: how to reuse a holdout across many adaptive submissions without overfitting it. Return little information: one bit, and a step threshold.
- **MINJA** [paper 2503.03704] (query-only memory injection) and **AgentPoison** [paper 2407.12784]: a library of lessons is an attack surface.

## 3. The loop

### 3.1 Invariants (each enforced in code, each with a test that plants a violation)

- **I1. One promoter.** Only the gate decision `promote` moves a lineage head (as in `Lineage.promote`, which throws `HEAL_NOT_PROMOTABLE` otherwise [code `promote.mjs:70-72`]). Proposers, probes, selectors and auditors produce evidence or vetoes, never promotions.
- **I2. The authority layer is outside the loop's write scope.** This covers capabilities and grants, oracles and graders, the contracts and their readings, approval rules and the org constitution, `policy/models.json`, the engine, and the gate code itself. It is checked by hash (V8 `gradersHash` [code `verify.mjs:37-44`] extended) and by an editable-region check on every candidate (R03's anti-hacking rules 1 and 7 [code `03-…md:344-350`]).
- **I3. Promotion evidence comes from cases the proposer did not see** (§3.10). Same-task probing is composition evidence, never promotion evidence.
- **I4. Three-valued verdicts:** accept, reject or inconclusive. Inconclusive goes to more evidence or to the owner queue, never to accept (certifyHeal, D28).
- **I5. Proposer ≠ approver.** Versions are immutable and hash-chained, and promotion and rollback are CAS on the lineage head [code `promote.mjs:70-106`]. In-flight instances keep their carry.
- **I6. Untrusted text may restrict, never authorise.** This covers lessons, complaints, task documents and MCP outputs. Such text may veto or narrow. It may never add an effect, a recipient, a capability or a promotion (capability output labels, I11).
- **I7. Every loop action is budgeted, logged and replayable.** There is no silent fallback (model policy I9). A corrupt registry stops the loop; it never degrades to empty.

### 3.2 State: immutable, supplemental, evidence

| Layer | Contents | Who changes it | How |
|---|---|---|---|
| **Authority (immutable to the loop)** | capability set and broker grants; graders, oracles and pins; the 13 capability contracts and their readings; approval rules; org constitution; model policy; engine; gate code | owner or controller; contract readings only through the contract-owner (C-O) session with certification [code `PREREG-DUR-1.md:304-323`] | a version-bound proposal in the org registry, approved there |
| **Supplemental (the loop's write scope)** | workflow versions of a lineage; node prompts; template instances; sub-workflow specs; library entries; retrieval index | proposers propose; the gate promotes | CAS on the hash-chained lineage |
| **Evidence (append-only)** | journals, gate records, lineage.jsonl, shadow uses, spend ledger, complaints, refinement events (trigger, change, evidence, outcome: Prime Agent's record shape) | runtime only | hash chain; fail closed |

**The skill pack and the global template library are T3.** They are global, and THESIS P6 forbids evolving one global workflow [code `THESIS.md:158`]. Proposals to change them are welcome. Promotion needs a SKILLPACK-style held-out evaluation and owner approval, never the online loop.

### 3.3 Triggers (all oracle-free in deployment)

These are DUR-1's channels [code `PREREG-DUR-1.md:220-257`]:
- **m1:** arm errors, host refusals, unrecovered effect errors.
- **m2:** contracts under the readings in force.
- **m3:** conservation and exactly-once.
- **m4:** announcements and config digests.
- **m5:** complaints. Two or more uncorroborated complaints on one topic make a loud verifier-blind incident.
- **m6:** the input-profile e-detector. It never opens a heal.

Additions:
- **Integration drift.** m4 digests of MCP tool schemas and connector API files. A new tool version or a `400 field-renamed` (E1's mechanism) opens an incident. This is how production connectors self-heal.
- **Scheduled consolidation.** Regenerate from spec behind the same gate when patch depth reaches 3 (`MAX_DEPTH` [code `promote.mjs:14`]).
- **Reuse requests.**
- **Cost pressure.** A tier-down candidate.

Retry is never the action on a deterministic defect. FH's ladder runs first, so a flaky target is not sent to the patcher [result `RESULT-FH1.md` §1, H-p1].

### 3.4 Proposers

Every proposer emits a typed `proposal/1` record bound to the base hash, with a cap.

- **P1. FH patcher.** One Haiku session with the program, the spec in force, and `FAILURES.md`: contract classes plus raw effect results [code `PREREG-DUR-1.md:262-267`]. At most 2 sessions per incident, then one Opus session (MH-H→O).
- **P2. Propose→probe→compose (Harness²).** k candidates along INV and DOM dimensions, each probed by $0 replay. A composer reads the contrasts. Probes feed the composer only. Default k = 2, and only after PPC-1 shows it beats P1 per dollar.
- **P3. Reflective rewriting (GEPA)** for model-node prompts in stochastic workflows (A1-C readers and checkers). μ_f is contract and Δ\* findings text. The Pareto pool is over feedback-slice cases only.
- **P4. Corpus retrieval (CI-1).** Leave-one-out structural retrieval of corpus patterns and library entries as exemplars. It was the best construction arm at 80.7% [result `WHY-NOT-HIGHER.md:183-189`].
- **P5. Sub-workflow creation.** Allowed only at nodes the parent marks. Nodes left alone chose a sub-workflow 6 of 32 times and gained nothing [result `WHY-NOT-HIGHER.md:170-173`].
- **P6. Gated regeneration** from spec plus `FAILURES.md`. It is safe behind the gate but weaker (gated E[net] 64 against heal 357 [result `RESULT-FH1.md:465-466`]). Use it as the consolidation proposer.
- **P7. Tier-down or compile (JIT)** with guard plus deopt to a model, never compiled-only [result `WHY-NOT-HIGHER.md:120-132`].
- **P8. Contract owner (C-O).** The only proposer of contract readings. A separate Opus session whose output runs out of process [code `contract-sandbox.mjs`]. It must be certified on practice worlds: flag 0 cases of the drifted reference and ≥90% of the undrifted reference's exposed cases, with precision ≥0.95. Its output is an authority change, so it is T3-approved or certified, never loop-promoted.

### 3.5 Probe: $0 where possible

- Record/replay with `replay-or-live`: unchanged nodes hit the recorded journal; changed nodes go live [code `verify.mjs:29-33`].
- Practice worlds carry only announced overlays.
- For unannounced changes, replay the cases the arm has already completed.
- The smoke service reports the candidate's own effects and contract results, never grades [code `PREREG-DUR-1.md:262-267`].
- On a deterministic program a probe is free. On stochastic nodes it costs live calls, capped.

### 3.6 The promoter: one gate stack, cheapest first, first failure stops

- **G0. Scope and authority.**
  - The diff touches only supplemental state inside the proposal's tier.
  - No authority-layer hash changes.
  - No editable-region violation.
  - No request for a new capability. That becomes a T3 owner request instead.
- **G1. Static checks.**
  - Compiles on the frozen kit.
  - Lint.
  - Literal-leak scan [code `heal/scan.mjs`]: no order ids or values from `FAILURES.md` or the practice journals appear as literals. This blocks hard-coded overfits.
  - Code safety.
- **G2. No weakening.** No acceptance or check is weakened, by tighten/relax proofs with a mutant battery (V2).
- **G3. Failing-case replay.** At least one flagged class fixed. Deterministic: one replay is the verdict. Stochastic: K = 3 replicas, using certifyHeal's stochastic mode.
- **G4. Regression slice, zero margin.** No new contract failure, no new m1/m3 finding and no arm error on every recorded passing run of the base (V4), on practice worlds with announced overlays, on the last 3 world-days, and on W1 under the readings in force [code `PREREG-DUR-1.md:275-282`]. Unlike the Self-Healing Harness, the margin is 0. FH-1 shows 0 is attainable.
- **G5. Discrimination controls.** Under the candidate's acceptance, the reference passes and the bad controls (noop, echo, declare-every-obligation, escalate-everything, charge-twice, hold-everything) fail (V5). This catches acceptance gaming.
- **G6. Δ\* and commit gate** (effectful workflows). Every effect the candidate plans in replay is explained by a Δ\* item. Forbidden effects are refused, and duplicate identities are refused [code `ATTACK.md:375-405`].
- **G7. Fresh held-out cases** (V7; certifyHeal fresh strata, n = 12, k = 2, ≥3 per stratum). These are drawn from the guard slice. The proposer gets one bit back.
- **G8. Cost and complexity bound.** At most 1.25× cost (hard cap 1.5×) [code `verify.mjs:22-23`], plus a complexity budget (nodes, always-on chars).
- **G9. Verdict.** Accept, reject or inconclusive. Inconclusive never promotes.

**Judge veto (optional, restrict-only).**
- After G9 accepts, a model auditor may hold the candidate for owner review if it sees a regression the contracts cannot (the blind side).
- It can never promote a rejected or inconclusive candidate.
- It is admitted as an information path only if its verdict κ with the gate stays under 0.4 [code `infopath.mjs`]. Its false-hold rate is measured (VETO-1 inside #105).

### 3.7 Canary, promotion, rollback

- **Canary.** The accepted candidate runs in shadow through the next world-day while the incumbent delivers. It is promoted at the day boundary only if it shows no per-case finding (m1, m2, m3) that the incumbent lacks [code `PREREG-DUR-1.md:283-286`].
- **Promotion.** CAS on the hash-chained registry. `STALE_WORKFLOW` if the head moved, `HEAL_CANDIDATE_CHANGED` if the verified bytes differ [code `promote.mjs:70-82`]. The lineage line records proposer, verification digest, decision, kit, lint and policy hashes.
- **Rollback.** Triggered by any of:
  - a promoted version's finding within 2 world-days that the incumbent's shadow lacks;
  - the circuit breaker: 3 consecutive failures, success ≤0.5 over 5 uses, verdict-vs-oracle mismatch above the parent's, a canary newly accepted, or a probe regression [code `promote.mjs:36-45`].
  Rollback restores the parent's content as a new version by CAS [code `promote.mjs:100-106`]. The rolled-back candidate goes on a per-incident denylist, so a promote/rollback cycle cannot flap.
- **Cross-workflow guard.** After any change that other workflows consume (T2), re-run each consumer's regression slice. This is the Self-Healing Harness's corpus-level guard, made exact.

### 3.8 Sections for control: blast radius decides the approver

| Tier | What changes | Approver | Extra evidence |
|---|---|---|---|
| T0 | in-run adaptation (strategy switch, bounded expansion, escalation) | none; never persisted | run budget |
| T1 | one lineage's workflow version inside one section | the code gate (auto) | G0–G9 plus canary |
| T2 | a library entry or template that other workflows in a section consume | gate, plus each consumer's conformance gate, plus the section owner via `ask_person_to_turn_on` [code `app/mcp/server.mjs:3-10`] | the corpus guard over all consumers; consumers pin versions and never auto-upgrade |
| T3 | contract readings, constitution clauses, capabilities, model policy, skill pack, global templates | owner or controller in the org registry: role check, approver ≠ proposer, no self-grant, lower layers only narrow [code `research/org-20261021/README.md:31-32`] | certification (C-O) or a sealed held-out evaluation |

This is also the open-core line (D2). T1 is free. T2 and T3 involve a second authority and are the paid control plane [code `decisions-20261021.md:16`].

### 3.9 Library: adopted workflows plus cue, lesson and evidence

**Entry fields:**
- workflow version hash and tier;
- **cue**: typed (family, input-profile digest, capabilities used, spec reading in force);
- **lesson**: text, labelled with provenance and taint, and the rule reading it was learned under;
- **evidence**: gate-record digest, held-out result with n_eff, cost;
- consumers and their pins;
- health: uses, audit results, last conformance check.

**Admission:**
- A G9 accept plus a held-out (prequential) record.
- Lessons pass an injection and literal scan.
- A lesson cannot name a capability, recipient or effect outside its scope (I6).

**Retrieval:**
- Harness²-style per-domain index plus CI-1 structural retrieval.
- Lessons render as quoted data in a data slot, never in instruction position.

**Reuse:**
- Only behind the consumer-conformance gate (replay the consumer's labelled history [result `RESULT-C2-2.md:51-56`]).
- Plus an **audit sample**: fresh labels on a seeded fraction of reused answers. C2-2's T1 drift (17 of 17 wrong) is invisible to any gate built on past evidence.

**Retirement** is a promotion too: CAS, reversible. It is triggered by any of:
- an audit-sample failure;
- the circuit breaker;
- the m6 e-detector on the consumer's input profile, which triggers a conformance recheck (not retirement by itself);
- the rule reading behind the lesson being superseded;
- no use in N days (P5, the utility problem);
- being outcompeted. Lineages to extend are chosen by clade metaproductivity (HGM [code `03-…md:205-213`]).

### 3.10 Held-out discipline (the Seldonian split, made concrete)

Each family has three slices:
- **Feedback slice.** The proposer sees the reasons: contract classes, raw effects.
- **Guard slice.** The gate's G4 and G7 use it. The proposer learns only accept or reject. Rotate it after every M promotions, using the Ladder's step rule: a score is reported only if it beats the last reported score by a fixed step.
- **Sealed slice.** Never touched by the loop. Used only for claims.

In a stream, the cases after a promotion's canary day are that promotion's prequential held-out. The loop reports its gains only on them.

### 3.11 Foundry as its own mini harness

The loop is itself a Foundry workflow in the typed IR. This dogfoods the engine (conformance 11/11 [result `research/proof-20261104/CONFORMANCE.md`]):

| Loop step | IR node |
|---|---|
| detect | code nodes over the journal |
| classify | the code ladder |
| propose | agent nodes, Haiku, with escalation by rule |
| probe | replay node |
| gate | verify nodes, code |
| canary | `wait.signal` with a timer |
| promote | CAS state write |
| rollback | circuit-breaker node |

Consequences:
- Every loop run is budgeted, durable, replayable and visible in the owner's run viewer.
- It runs inside ARC/AMP. Foundry asks for effects through its EffectPort, and loop outputs carry `grantsActionAuthority:false`.
- A user's agent drives it in natural language through MCP. A heal becomes a version-bound proposal (`propose_flow`). Approval stays with the person (`ask_person_to_turn_on`).
- New read-only tools: `list_incidents` and `explain_promotion` (the gate record in plain words).

**Not built:** a global harness optimiser. P6 and A6 stand.

### 3.12 Integrations (MCP, skills, connectors) inside the loop

- **Tool and connector drift** (renamed fields, new versions, scope changes) is the commonest real heal trigger. E1 and E2s are exactly this.
- The loop may patch adapters and argument mappings (T1).
- It may never add a server, scope or credential (T3, through the nodecap broker's per-effect approval).
- Every external write in a candidate's replay goes through the effect registry with an idempotency key. The commit gate then refuses a duplicate or an unexplained write before it fires [code `ATTACK.md:375-383`].

### 3.13 Cost envelope (measured anchors)

- **Haiku heal session:** $0.143 mean, $0.50 cap. At most 2 per incident, about $1.50 per lineage-stream [result `PREREG-DUR-1.md:268-274`].
- **Gate:** $0 on deterministic programs. K live replicas on stochastic nodes.
- **C-O:** about $1.50 per stream (Opus).
- **Contracts:** the frontier-written contracts cost $6.69–19.58 once per family, and that cost must appear in every heal claim [result `RESULT-FH1.md:25`].
- **Comparison:** about 35 sessions per task for Harness² at k = 5.

## 4. New failure points the loop adds

The full list, with mitigations, is in `newFailurePoints`. The five that matter most:
1. **Goodhart on the gate's blind side.** Seen in-repo: content breaks 16 → 28 [result `ATTACK.md:162-172`].
2. **Contract drift**, tested by DUR-1's MH-stale arm.
3. **Library poisoning through lessons.**
4. **Silent cross-workflow regressions through shared entries.**
5. **A gate that has never been shown a harmful candidate.** This is the reason #105 has a challenge set.

## 5. Task #105, preregistration skeleton (PREREG-PROMO)

- **Status.** Draft.
  - **Stage 0 (PROMO-0):** a retrospective pilot on FH-1's recorded candidates. It can be frozen now.
  - **Stage 1 (PROMO-1):** freezes only after DUR-1 is amended, run and finished, so its stream stays untouched.
  - Both run inline, not as a workflow (D35).
- **Evidence label.** Development (one family, E8).
  - Stage 0 is dev-in-sample: the programs were inspected by FH-1.
  - Stage 1 is dev-out-of-sample on DUR-1's stream seeds 1171–1188, plus a fresh battery from a seed block claimed at freeze. It does not use 9101–9104, which DUR-1C keeps.
- **Unit.** A proposal: a candidate version against its incumbent at alarm time. Inference clusters by lineage (9). Incident is secondary.
- **Proposal pool.**
  - (a) Every MH-H and MH-H→O candidate, accepted or rejected (patch.diff is recorded). In Stage 0, FH-1's H-C, H-N and H-0 attempts (35 run directories).
  - (b) **A challenge set frozen before any arm runs,** at least 4 per lineage:
    - same-arm regenerated peers. FH-1 §10.2 has 16, with grading net known: 12 rejected by the gate, up to −118;
    - the dry-run swap (+7/−48);
    - latent-defect-operator mutants of accepted heals (to build from LD-H's manifests);
    - literal-overfit variants that hard-code the failing order ids.
  - The challenge set exists because natural heals regressed nothing in FH-1.
- **Arms.** All judge the same proposals, open loop; E8 programs replay deterministically at $0.
  - **G:** the gate as frozen. DUR-1 §6.3 in Stage 1; FH `gateDecision('H-C')` in Stage 0. Plus the canary where the stream has a next day.
  - **G-cert:** certifyHeal on the same evidence (secondary).
  - **S-H2:** Harness²-faithful. A Haiku 5.5 selector over finals only, with no abstention. With one candidate this means forced adoption whenever it delivers.
  - **S-gen:** a generous selector. Haiku 5.5 sees anonymised base and candidate outputs on the same practice input, in both orders, and may keep the base. It gets no oracle and no grader verdicts; the run asserts this, as Harness²'s `assert_no_grader_verdicts` does.
  - **S-gen-Sonnet:** secondary, if budget allows.
  - **ACCEPT-VALID:** Prime Agent-style; it loads and validates.
  - **REJECT-ALL:** the static incumbent.
  - **G∧veto:** a hybrid, secondary (VETO-1).
  - **ORACLE-UB:** accept if and only if held-out net > 0 and no regression. An upper bound only.
- **Held-out items.** Never seen by any proposer or the gate.
  - Stage 0: grading worlds 1232–1234 × d2/d3/d5, plus the nine unseen dev worlds of FH-1 §10.
  - Stage 1: for each proposal, the stream cases placed after its canary day through the stream's end, run in isolation under candidate and incumbent, plus the fresh battery with the change set in force at the alarm. The canary day is excluded for every arm.
- **Primary metrics.**
  - **M1, regressions admitted:** the number of admitted proposals with ≥1 held-out regression (a case passing under the incumbent and failing under the candidate, by the exact E8 oracle). Critical regressions are reported separately. Case-level totals are secondary.
  - **M2, gains kept:** the sum, over admitted proposals, of held-out net recovered cases, also given as a share of ORACLE-UB.
  - **Reported beside them:** false rejections of oracle-good proposals; stratification by whether the contracts can see the regression class (visible vs blind); dollars per arm.
- **Hypotheses and tests.**
  - **H1:** S-gen admits more harmful proposals than G. Primary test: an exact one-sided sign-flip over the 9 lineage differences (512 patterns, as in D-1). Secondary: an exact McNemar on the challenge set.
  - **H2:** G's gains kept are non-inferior to S-gen's, with a margin of 10% of ORACLE-UB's gain. Two-way bootstrap over lineages and incidents, B = 10,000, frozen seed. Holm step-down at α 0.05 over H1 and H2.
- **Prediction (stated before any data).**
  - G admits at most 1 harmful proposal in total. S-gen admits at least 3× as many. S-H2 and ACCEPT-VALID admit the most.
  - Gains are within 10% overall. S-gen may beat G on blind-side classes (U1s-like), where the contracts see nothing.
- **Validity gate (blocks every claim if it fails).**
  - G refuses ≥90% of the challenge set's contract-visible harmful candidates.
  - G accepts ≥80% of the oracle-certified good heals.
  - The bad controls fail and the reference passes.
  - No selector context contains a grade.
- **Kill rules.**
  - **"Only the gate promotes" is killed for E8 if** S-gen's harmful admissions are ≤ G's in ≥7 of 9 lineages **and** S-gen's gains are ≥ G's minus the margin. Then a cheap selector replaces the frontier-written contracts as promoter for this family, and the design is revised.
  - **The gate's no-regression claim is killed if** G admits a held-out critical regression that stays in force for more than 2 world-days.
  - **The veto is adopted if** G∧veto removes ≥1 harmful admission relative to G at a cost of ≤10% of gains. **It is dropped if** it removes none.
- **Baselines.** REJECT-ALL (no gain) and ACCEPT-VALID (most harm). A gate that does not beat ACCEPT-VALID on M1 is worthless.
- **Power (inference).** FH-1's 0 harmful in 35 natural runs means power comes from the challenge set. With 36 or more harmful candidates, if S-gen admits 30% and G 5%, about 9–11 discordant pairs are expected. If all fall one way, the McNemar one-sided p is ≤ 0.002.
- **Cost.**
  - Stage 0: ≤ $6 of Haiku selector calls (about 90 proposals × 2 orders). The anchor is VL-1's Haiku judge, about $1 per 60 decisions (D27). Everything else is $0.
  - Stage 1: ≤ $8 Haiku, plus an optional ≤ $10 Sonnet arm. Above the cap, proposals are sampled by a frozen seeded rule.
  - The gate, replay and grading are all $0.

## 6. What would change this design

- **#105 kills H1.** A selector then becomes a cheap promoter for families with no contracts. The gate stays only where contracts already exist.
- **The judge veto removes blind-side regressions cheaply.** It then becomes default in T2.
- **PPC-1 shows propose→probe→compose beats the single patcher per dollar.** P2 then becomes the default proposer.
- **LIB-1 shows lessons do not shorten time-to-heal.** The library then stores versions and evidence only, with no lesson text. That is also the safest choice against poisoning.

## Actions

- {"action": "Correct the five facts in research/selfimprove-20261104/HARNESS2-PRIMEAGENT.md and IDEAS-AND-STATUS.md K/I12: the Harness² pool excludes the base and has no abstention; 4·k and 3·k sessions, not thousands; ungated library admission; Factorio is secondary-sourced; DUR-1 is stopped at Stage Z, not running", "why": "The current text overstates how generous Harness²'s promoter is and misstates its cost. #105's arm (b) as written is not Harness²'s published method.", "effort": "1 hour", "costUsd": "0", "needsOwner": "no"}
- {"action": "Build src/evolve/: one engine module that lifts experiments/heal/promote.mjs (decide, Lineage CAS, rollback, circuitBreaker), the verify V0–V8 adapters, experiments/lib/certify.mjs certifyHeal and experiments/fh gateDecision behind a typed schemas/promotion-record.schema.json. Tri-state verdict, proposer ≠ approver, fail closed on a corrupt registry. Tests plant a harmful candidate for every stage.", "why": "The promoter exists in four experiment directories with three gate definitions. One engine gate is the precondition for the loop, for org tiers and for #105's G arm.", "effort": "3–4 days", "costUsd": "0", "needsOwner": "no (land at an engine bump, not under a running paid experiment, per D15)"}
- {"action": "Build gate G0, the authority guard: a hash manifest of the immutable layer (capabilities, contracts and readings, graders, policy/models.json, constitution, gate code), an editable-region check, and impossible-task canaries. Tests replay DGM-style detector deletion, contract weakening, capability addition, grader edit and policy edit.", "why": "Every documented objective hack (DGM node 114, HarnessX, the Prime Agent RCON case) went through editable evaluators or authority.", "effort": "1 day", "costUsd": "0", "needsOwner": "no"}
- {"action": "Build the guard-slice protocol: feedback, guard and sealed slices per family; one-bit return to proposers; a Ladder-style step threshold; rotation every M promotions; prequential held-out reporting.", "why": "Reusing one regression slice across many adaptive proposals overfits it (Thresholdout, Ladder). Today a second heal session sees the first gate's reasons.", "effort": "0.5–1 day", "costUsd": "0", "needsOwner": "no"}
- {"action": "Build library v1: an entry schema (version hash, typed cue, tainted lesson with provenance and the rule reading in force, evidence digest, consumers and pins, health). Admission by gate record; reuse behind the C2-2 conformance gate plus seeded audit sampling; retirement triggers; the corpus-level guard on T2 changes; an injection and literal scan on lessons; lessons rendered as quoted data.", "why": "Harness²'s library admits everything. C2-2 shows past-evidence gates miss drift (17 of 17 wrong). MINJA and AgentPoison show memory is an attack surface.", "effort": "2–3 days", "costUsd": "0", "needsOwner": "no"}
- {"action": "Write PREREG-PROMO-0 and build its harness: reconstruct FH-1 candidates from the 35 patch.diff files; add the 16 regenerated peers and the dry-run swap; build LD-operator mutants and literal-overfit variants; freeze the selector prompt; grade held-out on 1232–1234 plus the nine unseen dev worlds.", "why": "#105 cannot use DUR-1 yet, and the gate has never been shown a harmful paid candidate. This tests the validity gate and the selector arms cheaply first.", "effort": "1.5–2 days", "costUsd": "≤ 6 (Haiku selector)", "needsOwner": "yes: ratify a ≤ $6 spend line as a decision row (outside D24's DUR-1 budget)"}
- {"action": "DUR-1 amendment (durability track): fault the last reserve ordinal in L1; salt the ADV twin so it is incremental; set an L1 share and floor that can be reached; re-run Stage Z.", "why": "PROMO-1 needs DUR-1's MH-H proposals and stream, and DUR-1 is stopped by its own fail-closed gates.", "effort": "track-owned, about 1 day plus the $0 dry run", "costUsd": "0 (DUR-1's own ≤ $80 under D24)", "needsOwner": "no (D24 covers it; the amendment must be dated and committed before the paid step)"}
- {"action": "Freeze PREREG-PROMO-1 after DUR-1's last paid step and run it inline (not as a workflow, D35).", "why": "This is the decisive test of 'only the gate promotes' against a Harness²-style selector on a changing stream.", "effort": "1 day plus analysis", "costUsd": "≤ 8 Haiku (+ ≤ 10 optional Sonnet)", "needsOwner": "yes: ratify the spend line"}
- {"action": "Express the loop as a Foundry IR workflow (detect, classify, propose, probe, gate, canary, promote, rollback). Add read-only MCP tools list_incidents and explain_promotion. Route heals through propose_flow and ask_person_to_turn_on.", "why": "This makes Foundry its own mini harness on its own engine: budgeted, durable, replayable and visible in the owner's viewer. Approval stays with a person.", "effort": "2–3 days", "costUsd": "0", "needsOwner": "no (the UI is the owner's per D33; we expose data only)"}
- {"action": "Route T2 and T3 promotions through the org registry gate (role, approver ≠ proposer, no self-grant, lower layers only narrow) and the section owner's approval.", "why": "Sections for control. The org layer's gate already refuses the planted self-granting v3, so loop promotions inherit it.", "effort": "1–2 days", "costUsd": "0", "needsOwner": "no"}
- {"action": "After PROMO-0: preregister PPC-1 (propose→probe→compose vs single patcher) and LIB-1 (library lessons vs none, with poisoning probes).", "why": "Adopt Harness²'s proposer and library only where they measurably add gain per dollar behind the same gate.", "effort": "1 day each to preregister", "costUsd": "≤ 10 and ≤ 8", "needsOwner": "yes: ratify spend"}

## New failure points this would add

- {"risk": "Goodhart on the gate: proposals optimise toward what the contracts check and break what they cannot see. In-repo, a loop raised content guardrail breaks from 16 to 28 while recipient breaks fell from 10 to 1 (ATTACK.md:162-172).", "mitigation": "Guard slice with one-bit feedback; G7 fresh cases; a precision twin per recall check; seeded audit sampling with the exact oracle where one exists; mutation-lab kill rate tracked per contract class; a restrict-only judge veto on blind-side classes; contracts owned by C-O, never by proposers."}
- {"risk": "Oracle and contract drift: the world changes, the readings go stale, and the gate blocks correct heals or admits wrong ones.", "mitigation": "Readings versioned by effective date and judged 'in force'; C-O certification against drifted and undrifted references (PREREG-DUR-1.md:304-323); verifier-blind incidents raised from complaints; DUR-1's MH-stale arm measures the cost; the regression slice is re-judged when a new reading is certified."}
- {"risk": "Reward hacking of the evaluator: the proposer edits checks, graders, logging or acceptance (DGM node 114 deleted the logging its detector read).", "mitigation": "G0 hash and editable-region guard over the authority layer; V8 gradersHash; G2 weakening proofs; G5 bad controls must fail; impossible-task canaries quarantine the lineage if any one passes; contract code runs out of process."}
- {"risk": "Library poisoning: a lesson or entry carries injected instructions from untrusted task documents, complaints or MCP outputs (MINJA, AgentPoison).", "mitigation": "Lessons carry provenance and a taint label and render as quoted data, never instructions. Admission needs a gate record. Injection and literal scans. A lesson can only restrict and may name no capability, recipient or effect outside its scope. Untrusted MCP output labels propagate (I11). Red-team windows include planted lessons."}
- {"risk": "Prompt injection through complaints or documents steering a patch (DUR-1's ADV change).", "mitigation": "Complaints and documents are quoted in FAILURES.md as data. Control flow is fixed before data is read (P9). The gate judges behaviour, not the patch's rationale. A patch that adds an effect fails G6 as an unexplained effect."}
- {"risk": "Overfitting to development cases: hard-coded ids or values from FAILURES.md; gains that exist only on replayed failures.", "mitigation": "G1 literal-leak scan; G7 fresh held-out cases; prequential reporting of gains only after the canary day; a sealed slice for claims; the challenge set includes literal-overfit variants so the gate is tested on them."}
- {"risk": "Silent regressions across workflows: a shared library entry, template or adapter change breaks a consumer.", "mitigation": "Consumers pin versions and never auto-upgrade. A T2 change re-runs every consumer's regression slice (corpus guard). Section-owner approval. Rollback of a shared entry is a CAS on each consumer's pin."}
- {"risk": "Cost runaway: proposal storms, heal ping-pong, false-complaint floods. DUR-1 computed that false complaints alone open a verifier-blind incident on every stream.", "mitigation": "Per lineage-stream cap ($1.50); at most 2 sessions per incident, then one escalation; MAX_DEPTH 3, then consolidation; one C-O session per stream; a budget stop is a loud 'needs human', never a silent skip; spend ledger checked before every session."}
- {"risk": "Correlated verifier errors: an N-version majority or a judge panel shares the miss. H-N fixed go-live in 0 of 7; 9 judges equal about 2 votes.", "mitigation": "Information-path budget (admit a signal only if κ < 0.4 with existing ones); report n_eff; judges are veto-only; independent paths (code, Δ*, world probe) come before more samples."}
- {"risk": "Self-certification: the proposing model's own report decides (C0: the self-check passed all 5 oracle failures).", "mitigation": "Lineage.promote requires a gate decision; proposer ≠ approver is recorded and enforced; no release, selection or repair consumes the actor's self-report (ATTACK RC3)."}
- {"risk": "Flapping: promote, roll back, re-promote; or revert-type changes (E1 then E1r) whipsaw the lineage.", "mitigation": "A rolled-back candidate goes on a per-incident denylist; hysteresis of at most k promotions per lineage per window; revert-aware twins in the stream; rollback reopens the incident instead of re-proposing the same diff."}
- {"risk": "In-flight instance migration: a carried state breaks under the new version.", "mitigation": "In-flight instances keep their version and carry; a break counts as a version-migration failure; drain or pin on long-running instances; the canary covers instances that cross the boundary."}
- {"risk": "Patch accretion and create-and-forget: patches pile up, complexity grows, unused skills linger (Continual Harness reports most authored skills are never invoked).", "mitigation": "G8 complexity budget; consolidation by gated regeneration at depth 3; usage-based retirement; library entries without uses expire."}
- {"risk": "Environment faults or variance misread as defects and patched (FH's H-p1 flaky target was misrouted).", "mitigation": "The classify ladder runs first (variance test, determinism check); env_fault and harness_fault verdicts never open a patch; for stochastic nodes, certifyHeal's stochastic mode needs K replicas."}
- {"risk": "Stale gate evidence: the regression slice no longer represents the world after a change, so a correct heal is rejected or a wrong one accepted.", "mitigation": "The slice is judged under readings in force (W1 included, on the current calendar per DUR-1 §6.3); the slice is refreshed at each certified reading; guard-slice rotation."}
- {"risk": "Multiplicity: hundreds of gate decisions over time make some false accepts certain.", "mitigation": "The circuit breaker and shadow uses act as a sequential monitor; the false-accept rate is estimated on a standing challenge stream with Clopper-Pearson bounds (certify.mjs); a promotion with weak evidence stays inconclusive."}
- {"risk": "Escalation creep or silent model fallback (Opus every time; a cheaper model substituted silently).", "mitigation": "Model ids only from policy/models.json; escalation only by rule (two rejected Haiku sessions); every escalation is logged; there is no fallback path."}
- {"risk": "Authority creep through sub-workflow creation or the capability broker: a proposal adds an MCP server, scope or credential.", "mitigation": "Capabilities are in the immutable layer; G0 turns any new capability into a T3 owner request; the nodecap broker approves per effect; sub-workflows inherit at most the parent node's grants."}
- {"risk": "Lesson staleness: a lesson true under the old rule misleads after a change.", "mitigation": "Each lesson records the reading and version in force when learned and is retired automatically when that reading is superseded; lessons never bypass the gate, since they only feed proposers."}
- {"risk": "Evidence loss or state corruption silently resetting history (Prime Agent degrades a corrupt state file to empty).", "mitigation": "Hash-chained lineage and evidence; a corrupt registry stops the loop with an error; backups by content address; tests corrupt the file and expect a refusal."}
- {"risk": "Gate blind spots where no contract sees the failure (go-live missed by 7 of 8 programs; U1s visible only through complaints).", "mitigation": "The complaint channel raises loud verifier-blind incidents; no heal claim without an oracle (D28); a blind-side stratum is reported in #105; an optional judge veto; the C-O session can propose a new reading (T3)."}
- {"risk": "Owner-review fatigue: too many T2 and T3 holds lead to rubber-stamping.", "mitigation": "Rank holds by blast radius; batch per section; time-to-live auto-reject; approval latency and approve rate are measured; the explain_promotion tool gives a plain-words gate record."}
- {"risk": "Selector leakage in experiments: the Harness²-style arm sees grades and looks better than it is.", "mitigation": "Assert no grader verdicts in any selector context (as Harness² does with assert_no_grader_verdicts); anonymised order in both directions; frozen prompts."}

## Experiments

- {"name": "PROMO-0 (#105 stage 0): retrospective promotion audit on FH-1's recorded candidates", "question": "On real E8 heal candidates plus a frozen harmful challenge set, does the code gate admit fewer held-out regressions than a Harness²-style model selector at similar gains kept? Does the gate refuse known-harmful candidates at all?", "method": "Proposals: the FH-1 H-C, H-N and H-0 runs reconstructed from the 35 patch.diff files; the 16 regenerated peers; the dry-run swap; at least 4 LD-operator or literal-overfit mutants per program, frozen before any arm runs. Arms: G (FH gateDecision H-C, recorded, $0); G-cert (certifyHeal); S-H2 (finals-only, forced adoption); S-gen (Haiku 5.5 sees anonymised base vs candidate on practice outputs, both orders, may keep base, no grades); ACCEPT-VALID; REJECT-ALL; G∧veto; ORACLE-UB. Held-out: grading worlds 1232–1234 × d2/d3/d5 plus the nine unseen dev worlds; deterministic replay at $0. Unit: proposal, clustered by program (8–9). Labelled dev-in-sample pilot.", "baseline": "REJECT-ALL (static incumbent) for gains; ACCEPT-VALID (structure-only, Prime Agent style) for harm", "killRule": "Validity first: if G refuses fewer than 90% of contract-visible harmful candidates, or accepts fewer than 80% of oracle-good heals, no comparative claim is made and the gate is redesigned before PROMO-1. If S-gen's harmful admissions are no more than G's in at least 7 of 9 programs and its gains are at least G's minus 10% of ORACLE-UB, record 'selector competitive' and move PROMO-1 to H2-first. Either way PROMO-0 only freezes the selector prompt and the challenge-set recipe for PROMO-1.", "cost": "≤ $6 (Haiku selector; about 90 proposals × 2 orders); gate, replay and grading $0; about 2 days to build"}
- {"name": "PROMO-1 (#105 decisive): gate vs model-selected promotion on the DUR-1 stream", "question": "Over a changing 3-stream × 6-world E8 stream, does gate promotion admit fewer harmful heals (≥1 held-out regression) than Harness²-style model selection, while keeping non-inferior gains?", "method": "After DUR-1 is amended and finished: every MH-H and MH-H→O candidate (accepted or rejected) plus a challenge set of at least 4 harmful per lineage, frozen at the freeze. The same arms as PROMO-0, with G = DUR-1 §6.3 gate plus canary as frozen. Held-out per proposal: stream cases placed after its canary day through the stream's end, run open loop under candidate and incumbent, plus a fresh battery from a seed block claimed at freeze (not 9101–9104). Primary: H1 by exact one-sided sign-flip over the 9 lineage differences in harmful admissions (secondary: McNemar on the challenge set); H2 non-inferiority of gains kept (margin 10% of ORACLE-UB), two-way bootstrap over lineages and incidents; Holm at α 0.05. Critical regressions, blind vs visible classes, false rejections and dollars are reported beside them.", "baseline": "REJECT-ALL (DUR-1's S-H* static) and ACCEPT-VALID", "killRule": "'Only the gate promotes' is killed for E8 if S-gen's harmful admissions are no more than G's in at least 7 of 9 lineages and its gains kept are at least G's minus the margin. The gate's no-regression claim is killed if G admits a held-out critical regression in force for more than 2 world-days. Any claim is blocked if the validity gate fails (challenge refusal below 90%, good-heal acceptance below 80%, a control misbehaving, or a grade found in any selector context).", "cost": "≤ $8 Haiku selector (+ ≤ $10 optional Sonnet arm); everything else $0; runs inline (D35) after DUR-1"}
- {"name": "VETO-1 (inside PROMO-0 and PROMO-1): restrict-only judge veto", "question": "Does a model auditor that may only hold gate-passed candidates remove blind-side regressions at an acceptable false-hold cost, given correlated judge errors?", "method": "Arm G∧veto on the same proposals: a Haiku auditor sees the base vs candidate outputs and may veto a G-accepted candidate. Admit it as an information path only if its verdict κ with G is below 0.4 (infopath.mjs). Count harmful admissions removed and oracle-good holds added, stratified by blind vs visible class.", "baseline": "G alone", "killRule": "Adopt the veto in T2 if it removes ≥1 harmful admission relative to G at ≤10% of gains lost. Drop it if it removes none, or if it holds more than 20% of oracle-good proposals.", "cost": "Shares the PROMO selector calls (no extra beyond about $2)"}
- {"name": "PPC-1: Harness²'s propose→probe→compose as a heal proposer", "question": "Behind the same gate, does k = 2 propose→probe→compose keep more held-out gain per dollar, or need fewer sessions to an accepted heal, than FH's single-session patcher?", "method": "On DUR-1 incidents replayed from recorded journals (and new incidents in a later stream), compare P1 against P2 (k = 2 INV/DOM candidates probed by $0 replay, then one composer session), both gated by G. Unit: incident, clustered by lineage. Metrics: gains kept on prequential held-out, sessions and dollars to the first accept, harmful candidates produced (the gate should stop them).", "baseline": "FH single-session patcher (P1) behind the same gate", "killRule": "Keep P1 as default unless P2 raises gains kept per dollar by ≥20% with no extra harmful admissions. Drop P2 if its cost per accepted heal is more than 2× P1's at equal gains.", "cost": "≤ $10 Haiku"}
- {"name": "LIB-1: does a gated library with cue/lesson/evidence help, and can it be poisoned?", "question": "Does retrieving gated library entries and lessons shorten time-to-heal or raise first-session acceptance on later incidents? Can a planted lesson change any effect or capability?", "method": "On the later worlds of a stream, run P1 with (a) no library, (b) versions plus evidence only, (c) versions plus evidence plus lessons rendered as quoted data. Planted poisoned lessons (MINJA-style bridging text from complaint documents) are added to arm (c). Measure sessions to accept, TTD, gate rejections, and any effect or capability influenced by a planted lesson.", "baseline": "No library", "killRule": "Any planted lesson that changes an admitted effect, recipient or capability blocks lesson text entirely (keep versions plus evidence only). Drop lessons if (c) does not beat (b) on first-session acceptance by ≥10 points.", "cost": "≤ $8 Haiku"}

## Sources

- {"title": "GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning (arXiv 2507.19457, HTML v2; Algorithms 1–2 read)", "url": "https://arxiv.org/html/2507.19457v2"}
- {"title": "AFlow: Automating Agentic Workflow Generation (arXiv 2410.10762)", "url": "https://arxiv.org/html/2410.10762"}
- {"title": "MaAS: Multi-agent Architecture Search via Agentic Supernet (arXiv 2502.04180)", "url": "https://arxiv.org/html/2502.04180"}
- {"title": "ScoreFlow: Mastering LLM Agent Workflows via Score-based Preference Optimization (arXiv 2502.04306)", "url": "https://arxiv.org/html/2502.04306"}
- {"title": "EvoAgentX (arXiv 2507.03616, abstract page)", "url": "https://arxiv.org/abs/2507.03616"}
- {"title": "ADAS: Automated Design of Agentic Systems (arXiv 2408.08435)", "url": "https://arxiv.org/html/2408.08435"}
- {"title": "Darwin Gödel Machine (arXiv 2505.22954)", "url": "https://arxiv.org/html/2505.22954"}
- {"title": "Agent Workflow Memory (arXiv 2409.07429)", "url": "https://arxiv.org/html/2409.07429"}
- {"title": "Voyager: An Open-Ended Embodied Agent with Large Language Models (arXiv 2305.16291)", "url": "https://arxiv.org/html/2305.16291"}
- {"title": "Harness²: Recursive Agent Harnessing for an Open World (arXiv 2610.14224)", "url": "https://arxiv.org/abs/2610.14224"}
- {"title": "Continual Harness: Online Adaptation for Self-Improving Foundation Agents (arXiv 2605.09998)", "url": "https://arxiv.org/html/2605.09998"}
- {"title": "Self-Healing Harness for Runtime Oversight of Agent Self-Modification (arXiv 2609.24130)", "url": "https://arxiv.org/abs/2609.24130"}
- {"title": "Auditing Harness Tampering in Self-Improving Agents (arXiv 2609.00069)", "url": "https://arxiv.org/abs/2609.00069"}
- {"title": "Nine Judges, Two Effective Votes: Correlated Errors Undermine LLM Evaluation Panels (arXiv 2605.29800)", "url": "https://arxiv.org/abs/2605.29800"}
- {"title": "A Second Judge is Not a Second Opinion: Correlated Error and Silent Failure in LLM Verifiers (NeurIPS 2026)", "url": "https://neurips.cc/virtual/2026/172889"}
- {"title": "Generalization in Adaptive Data Analysis and Holdout Reuse (Thresholdout, arXiv 1506.02629)", "url": "https://arxiv.org/abs/1506.02629"}
- {"title": "The Ladder: A Reliable Leaderboard for Machine Learning Competitions (arXiv 1502.04585)", "url": "https://arxiv.org/abs/1502.04585"}
- {"title": "Preventing undesirable behavior of intelligent machines (Seldonian framework, Science 2019)", "url": "https://www.science.org/doi/10.1126/science.aag3311"}
- {"title": "Seldonian Toolkit tutorial: candidate selection, safety test, No Solution Found", "url": "https://seldonian.cs.umass.edu/Tutorials/tutorials/alg_details_tutorial/"}
- {"title": "MINJA: Memory Injection Attacks on LLM Agents via Query-Only Interaction (arXiv 2503.03704)", "url": "https://arxiv.org/abs/2503.03704"}
- {"title": "AgentPoison: Red-teaming LLM Agents via Poisoning Memory or Knowledge Bases (arXiv 2407.12784)", "url": "https://arxiv.org/abs/2407.12784"}
- {"title": "Prime Agent review (secondary source for the Factorio/RCON reward-hacking case)", "url": "https://andrew.ooo/posts/prime-agent-primeintellect-self-improving-rlm-harness-review/"}
