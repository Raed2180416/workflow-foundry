# ATTACK: what the eight blockers say together (cross-blocker synthesis, 2026-10-22)

**Role.** Cross-blocker synthesist (Fable 5.1). This file does not summarise the eight sweeps; it says what they imply
jointly, where they contradict each other once the skeptics are applied, which single mechanisms remove several
blockers at once, and what to stop doing.

**Inputs read in full.** `research/OPERATING-PRINCIPLES.md`, `research/REQUIREMENTS-COVERAGE-20261021.md`,
`research/compromises-20261021/FIXES.md`, `research/decisions-20261021.md` (D18–D27), `research/PLAN-3DAY-20261021.md`,
`research/automationbench-20261014/VERIFIER-LAB.md` (2026-10-22), `A1C-V2-DESIGN.md` §2 and §7 (worktree
`wf_3674d3bc-0a7-12`), `experiments/autobench/verifier/requirement-ledger-v2/{extract,compile}.mjs`, the eight sweep
notes under the scratchpad `blockers/` directory and the eight skeptic verdicts as delivered. Evidence tags:
`[paper] [docs] [observed-code] [benchmark] [inference]`, plus `[obs]` for a $0 measurement I ran today on stored dev60
grades (`scratchpad/blockers/synth/attrib{,2}.py`, read-only). Dates: sweep sources were read 2026-10-21 by their
authors; everything in §11 marked "read 2026-10-22" I opened myself today. Exa needs authorisation and Scite a paid plan
in this session, so new literature came through WebSearch/WebFetch and one shallow, read-only clone (agent-diff, MIT,
deleted after reading, no install hook run).

**Hygiene.** All own numbers are devTrain dev60, k = 1, in-sample for A1-C. No devCheck, look-2 or test task or grade
was read. Task names appear only where README or VERIFIER-LAB already names them; no grader strings are quoted. Keep this
file out of harness, verifier and model contexts, like VERIFIER-LAB.md.

---

## 1. The verdict in twelve lines

1. **Four of the eight blockers are one blocker.** Verification precision, latent requirements, extraction recall and
   the frontier-gap "dead zone" are four faces of a single missing object: the system never derives, in code, a
   closed-world model of what the world must look like after a correct run. I call it **Δ\*** (the expected-diff
   contract). The actor, the checker, the repair brief, the selector, the need router and the token budget all improvise
   their own partial version of it, from the same text, with the same blind spots.
2. The skeptics *strengthen* this reading rather than weaken it: the verification-precision skeptic refuted "specified but
   not enforced" and found "wrong or unstated spec"; the latent-requirements sweep found closure, derivation and
   verifier-grammar gaps, not hidden documents; the extraction skeptic found the residual misses are items no cue and no
   view detects. Spec *derivation* (entailment), not spec *extraction* or spec *enforcement*, is the gap.
3. **The one verifier that worked is a partial Δ\*.** RL2, an independently derived, code-grounded obligation ledger,
   reaches held-out AUROC 0.837 against 0.47–0.58 for the pipeline's own checks, and it is the only signal whose errors are
   partly independent of a judge (κ 0.35) [benchmark, VERIFIER-LAB §1.2]. It lacks code-enumerated closure, derived
   values and effect identity. Those three are exactly what the other sweeps found missing.
4. **Every sweep paid for correlated samples and got almost nothing:** six arms worth 2.1 effective arms; nine judges
   worth two; K = 3 readers worth about two points of gold coverage; N-version patches realising 0.43 of the independence
   gain; six of six composed builds sharing one miss; the medoid selector with no skill. Every gain anywhere came from a
   *different information path* (code vs model, a different family, a probe of the world, a drift notice, the official
   grader as a mutation oracle). The program should stop buying samples and start budgeting information paths.
5. **Open-world verdicts plus a loop equals Goodhart.** Unknown maps to pass; recall-only checks raised content-level
   guardrail breaks from 16 to 28; verifier-driven repair nets −1 to +2 and writes duplicates on 13 of 60 tasks; agents
   report success in 90% of the episodes where they duplicated. The fix is closed-world, three-valued, with the actor's
   self-report never consumed.
6. **Effects have no identity.** Duplicates, crash collapse, unsafe repair, re-execution on escalation and the caller-keyed
   notices are one platform gap (exactly-once belongs to the runtime, not to a cheap model). An effect registry plus a
   pre-commit gate against Δ\* is the deployable form of verification and the thing that makes retry, repair,
   escalation, selection and composition safe at once.
7. **The model owns procedure where code should:** candidate enumeration and arithmetic are 56% of ledger JSON; the
   extractor decides what to enumerate and when to stop; Haiku hand-writes idempotency; the router counts primitives by
   keyword. One design change (the model writes predicates and pointers; code enumerates, computes, disposes, keys)
   serves token efficiency, extraction recall, latent requirements and the need router simultaneously.
8. **The evaluators are themselves blockers:** 7 of the 19 never-passed tasks are hard grader defects; the E8 scorer counts
   a sibling sentence; effort was unset in every date-note arm (medium, not high); K = 3 case-pooled comparisons; no
   never-trigger metric; one-run heal certification. No claim survives without one shared certification library and
   ceiling-adjusted reporting.
9. **The wrong unit.** Tasks are conjunctions of 7–10 assertions; the measurable, repairable, routable unit is the
   obligation, and the natural representation is a world-state delta under a closed-world assumption. Optimising
   "expected obligations satisfied per dollar, with UNKNOWN priced" replaces "pass rate at n = 60".
10. **Failure-driven maintenance is the slow path.** Every repair that stuck arrived as a diff (a drift notice, two builds
    disagreeing, a failing assertion with its expected value). Treat spec, tool-schema, data and model diffs as first-class
    events and re-derive Δ\*; bisection generates the notice when nobody wrote one.
11. **The bar is softer and nearer than assumed, but only cost-normalised claims are honest.** Opus 5.5 xhigh is 35.77% at
    $0.89 on the private set; the dev60 ceiling is 53/60; a cheap mixed system is already at 34/60 by selection; the next
    +4 to +10 come from Δ\* closure, derivation, conventions and effort, at $0.03–0.15 per task. Pass-rate parity with
    Opus will be inconclusive at n = 60; a 6–30× cost advantage at parity will not.
12. **Eight moves**, each with a $0 first step, are in §6; the prerequisite certification library is Move 0; the stop
    list is §8.

---

## 2. The matrix: what each blocker says alone, and what they say together

Rows are the root causes; cells say which sweep sees that cause from which angle. A cause that appears in four or
more rows of the eight sweeps is the synthesis; no single sweep names it as the cause.

| Root cause | verification | latent req. | ceiling / frontier | extraction | need router | self-repair | tokens | composition |
|---|---|---|---|---|---|---|---|---|
| **RC1 No derived closed-world model of "done" (Δ\*)** | checks share the actor's ledger; FA are wrong/unstated spec (skeptic) | closure, derivation, grammar gaps; "all-and-only" | dead zone is information; 16 of 19 have a never-satisfied assertion | open-world listing drops what fits no skeleton; go-live is a missing matrix cell | "verifiable" is a regex; D3 self-checks passed 6 of 6 oracle failures | heal is verifier construction; H-rec retry verdict `pass` 4/4 while oracle 0/4 | ledger enumerates candidates by hand (34.8% of JSON) | contracts stayed prose; module tests cannot see seams |
| **RC2 Samples bought instead of information paths** | n_eff 2.1 of 6; judges ≈ 2 votes | reader union adds 6 assertions; A1-C K = 3 same-view | medoid has no skill; same-pipeline fork loses | K same-prompt cannot reach S3/S4; Chao2 blind | Jev at chance; text-only ρ 0.09–0.40 | N-version patches share mistakes; Verma anchoring | K = 3 readers buy ~2 gold points for 3× tokens | 0.43 of the independence gain; 6/6 miss go-live |
| **RC3 Open-world verdict + loop = Goodhart** | unknown→pass; vacuous all-pass | recall-only checks: breaks 16→28 | checker FA 16, FR 10; repair breaks passing worlds | self-reported coverage certifies nothing | ex-post escalation double-fires | V3 "failing case passes" is plausibility | — | single clean run certifies 86–100%, replay finds 7–79% wrong |
| **RC4 Model owns procedure code should own** | computed literals demoted without agreement | SQL reproduces 5,600/12,600 at zero tokens | policy-in-world tasks want a predicate | extractor decides granularity and stop | keyword cues 54% false triggers; ESI κ 0.34 | closed IR cannot write a per-row guard | 56% of ledger JSON is enumeration + arithmetic | Haiku hand-writes exactly-once |
| **RC5 Effects without identity** | repair hazard (duplicates) | a sent message cannot be repaired | duplicates in 13/60 per arm | — | escalation re-executes non-idempotent effects | retry ladder needs idempotence | — | D2/D3/D4: identity, atomicity, keyed start |
| **RC6 Evaluators are part of the blocker** | 4 of 11 FA on defect tasks; tri-state 12% coverage | over-inclusion counts were assertion-level | effort unset (medium); 7 hard defects; 53/60 ceiling | span scorer counts sibling sentence; gold holes | no never-trigger metric; n_eff 6 | V3 one-run; H-p1 control non-evidential | equivalence guard self-referential; allowance unknown | case-pooled K = 3; X1 threshold circular |
| **RC7 Failure-driven where change-driven** | — | — | tool-effect cards exist only in rubric code | — | need is a project state | M5 drift notice: 6/6 at $0.02–0.05 | — | drift patches 0 collateral; no monolith baseline |

**What none says alone.** RC1 and RC5 are the two mechanisms; RC2, RC3 and RC4 are why every local fix so far
plateaued; RC6 and RC7 are why the program cannot yet tell. The eight sweeps propose about 45 experiments; Moves 1–8
below are the eight that each collapse several of them.

---

## 3. The root causes, with the joint evidence

### RC1. The missing object: Δ\*, the expected-diff contract

**Definition.** For a request R, the rule-bearing records of the world (policy sheets, guideline mail, precedents) and the
initial world W0, Δ\* is a typed, closed-world description of the admissible diff D = diff(W0, W1):

- **O**: obligations, as diff assertions `(diff_type ∈ {added, changed, removed}, entity, where-predicate, expected count,
  content literals)`;
- **P**: prohibitions, mostly the *complement* of each selection inside its enumerated universe ("each active project"
  means all-and-only), plus "nothing else changes" over the enumerated scope;
- **U**: unknowns, as labelled nulls: a value or disposition the rules do not determine (an unestablished "today", a
  member no predicate disposes of, a payload the spec never gives);
- **K**: identity keys for every effect in O, so a duplicate is a no-op by algebra.

**This is literally the shape of the graders.** AutomationBench scores deterministic final state with positive and
negative assertions and excludes negatives that already held [observed-code, LR §1.1]. Agent-Diff (arXiv 2602.11224,
Feb 2026; 224 tasks, 9 LLMs; MIT repo, HEAD `3bb9c40`, 2026-07-01) grades by a "state-diff contract" whose assertions are
`diff_type / entity / where / expected_count / expected_changes` with `strict = true` and a **closed-world invariant**:
"Any other insertion, deletion, or mutation is treated as a side effect and causes the task to fail" [paper,
observed-code; read 2026-10-22]. So the proposal is not a new verifier: it is to make the *internal* verifier the same
kind of object as the *external* graders, derived independently of the actor. RL2 already has the obligation half
(`positive | negative | scope | value | side_effect`, an `items` list with `in_scope` per candidate, code grounding of
every literal) and compiles to `msg_to / msg_has / created_in / created_has / rec_unchanged / msg_lacks`
[observed-code, `requirement-ledger-v2/{extract,compile}.mjs`]. What it lacks is exactly what the other sweeps found:

| Missing piece of Δ\* | Who found it | Evidence |
|---|---|---|
| Code-enumerated universe with a disposition per member (closure) | latent-requirements | 27 of 27 guarded entities sit in a collection the positives cite, median 19 rows; 0 of 28 broken guardrails had an executable negative; readers list only 8 of 28; the decoy is decided by a rule over attributes in 24 of 25 [observed-code] |
| Derived values computed by code (sums, buckets, dates) | latent-requirements, tokens | one SELECT reproduces the two failed figures and the exclusion set of one task; 100 of 246 advisory checks are "computed value without agreement"; derived computations are 21.5% of ledger JSON [observed-code] |
| Labelled nulls instead of silent demotion | verification (tri-state), latent (clock), extraction (unspecified payload) | the clock is hidden in `meta.current_time` for 117 of 240 worlds; "today" unverified in all three readers of the worked example; the go-live payload shape is unstated [observed-code] |
| Effect identity | composition, verifier-lab | all 61 duplicates are two identity kinds; 13 of 60 tasks per arm carry duplicate writes [observed-code, benchmark] |

**My $0 attribution of the best arm's failures (m3-a1c, dev60, 31 failing tasks, 110 failed scored assertions)
[obs].** By assertion class: content 39, prohibition 25, existence 23, action-key 12, flag 7, other 4; 10 tasks miss
exactly one assertion. Excluding the 7 hard-defect tasks (VERIFIER-LAB §2 strata): 24 failing tasks, 86 assertions:
content 36, existence 22, prohibition 17, action-key 6, other 4, flag 1. Prohibitions appear in 9 of the 24 and are the
*sole* cause in 5; content literals appear in 11 and are the sole cause in 5; existence in 9. Among the 12 failing tasks
that some other arm passed, prohibitions are the largest class (13 of 37 failed assertions); among the 6 "reachable by a
generic convention" tasks, content literals dominate (23 of 35). So on the non-defect failures, 53 of 86 assertion
failures (62%) are prohibitions or content literals, the two classes a derived Δ\* decides by code (closure and
derivation); the existence class is representation and discovery (tool-effect cards, conventions G7/G10). The Haiku-only
A1-C arm has the same shape (40 failures; content 36, existence 36, prohibition 29).

**Why extraction cannot be the fix.** The extraction skeptic showed the $0 "every uncovered sentence" baseline already
ties the model at 28 of 30 ids and that the residual (S2, S4) carries no cue; the verification skeptic showed 10 of the
29 failed assertions in false-accept tasks match only an *opposite-polarity* ledger item and 2 are absent; the
latent-requirements sweep showed norm literals are captured ~90% of the time. The text is read. What is not done is the
entailment: request ⊗ rules ⊗ world ⊢ O ∪ P, with the complement and the arithmetic.

### RC2. Samples instead of information paths

Every blocker bought a second opinion from the same distribution: three readers at temperature 1.0 with a different
inventory order; three same-pipeline forks; nine judges; N versions of one model; K extraction passes of one prompt.
The measurements agree with the literature and with each other: Kish n_eff 2.1 of 6 arms (2.3 after excluding the
defect tasks); judge-judge κ 0.61–0.70 versus 12% expected joint error under independence; RL2-versus-judge κ 0.35 is the
only pair that combined; the medoid selector sits below the best single arm; reader 3 adds gold coverage in 1 of 47
tasks; same-prompt K cannot find an item with detection probability zero; six of six composed builds and a monolith
lineage shared the go-live miss [benchmark, observed-code; VP §1.6, VL §1.2–1.3, TE skeptic 13, ER M2–M3, COMP §1.1].
The wins all came from a different *mechanism*: code grounding versus a judge (RL2), a different family as planner
(Mercury + Haiku solves 13 tasks the Haiku pipeline does not), a probe of the finished world (Probe-and-Resume +9.0 at
2.2× cost, arXiv 2610.21088), a structural prior that sees S3/S4, the official grader as a mutation oracle, a drift
notice (M5), the disagreement of independent builds (B1N). The program-level rule that follows is in Move 6: a new
signal, fork or reader is admitted only with its measured κ against the existing set, and anything above about 0.4 is
refused as a purchase of variance.

### RC3. Open-world verdicts plus a loop produce Goodhart, and self-reports are cheap talk

`terminationDecision` counts only hard failures, so null and soft become pass [observed-code]; the check compiler forces
record-level negatives soft (`postconditions.mjs:79`); the actor sees the checks (a primed check). Put a loop on top and
the loop optimises for the verifier's blind side: content-level guardrail breaks rose from 16 (raw Haiku) to 28 (A1-C)
while recipient-level breaks fell from 10 to 1 [observed-code, LR §1.4; assertion-level, skeptic caveat on task level];
verifier-driven repair nets −1 to +2 on the best arm because the "high-precision" checks also fire on 6 of 34 passing
picks [benchmark, VL §1.5]. The actor's own report is cheap talk: LIMBO's agents reported success in 90% of the episodes
in which they duplicated a write (arXiv 2609.29095); AutomationBench's authors report false confidence in 72–91% of
failures (arXiv 2604.18934) [paper]. Consequences: three-valued verdicts under a closed-world assumption (Move 3), a
precision twin for every recall check, and a rule that no release, selection or repair decision consumes the actor's
self-report.

### RC4. The model owns procedure that code should own

The ledger's visible output is 34.8% candidate enumeration and 21.5% derived computation [obs, TE §1]; the extractor
decides what to enumerate, at what granularity, and when to stop (`extract.mjs:19`, a 250-entry cap) [observed-code,
ER F1]; the router's "primitives" are word cues that fire on 54% of routine issues [obs, NR §2.2]; the composed builder
hand-writes effect identity and crash semantics [observed-code, COMP §1.2]. The thesis ("code owns procedure, models make
narrow judgments") was applied to acting and not to deriving. Applying it to derivation is one design (Move 5): the model
emits predicates, pointers and dispositions; code enumerates the universe, evaluates predicates on `node:sqlite` behind
`setAuthorizer`, computes figures, keys effects and counts primitives. The same change cuts the ledger's output tokens,
removes the truncation failures (9 of 16 unparsed replies were candidate-list blow-ups at the 24,576 cap), makes
computed literals hard, and gives the need router typed counts.

### RC5. Effects without identity

The composition skeptic *established* D2 and D3 at $0: the caller-chosen occurrence key explains all 12 C-H-T
duplicates and the `lateUndo` guards explain the crash collapse (one-line patches restore 40/43, 38/44, 59/69) and the
residual loss equals the monoliths' universal D4 loss [observed-code]. The verifier lab found duplicates on 13 of 60 tasks
per arm and half of the judges' false rejections cite them [benchmark]; the need-router skeptic noted that escalation by
re-execution double-fires non-idempotent effects; the self-repair ladder needs the same guarantee. Industry and 2026
evidence agree that exactly-once lives in the runtime contract: idempotency keys cut duplicates from 28% to 4% and a
harness-attached key guard transfers unchanged (LIMBO); per-call idempotency breaks on composite workflows (UndoBench,
arXiv 2610.05622); claim-before-run fixes concurrent resume (arXiv 2608.03836) [paper]. Cognitive Admission Control
(arXiv 2609.16313, Sept 2026) is the 2026 design closest to Moves 2 and 3 together: a typed action and its modelled risk
map to assurance obligations; a deterministic evaluator marks each **satisfied / violated / unresolved**; unresolved
items trigger evidence acquisition; admission yields a certificate binding the action, a witness manifest and
dispatch-time guards; 0 harmful effects in 390 trials [paper, read 2026-10-22].

### RC6. The evaluators are part of the blocker

Seven of the 19 never-passed dev60 tasks are hard grader defects and four are soft, so the dev60 ceiling is 53/60
(49/60 conservative) [benchmark, VL §2]; every date-note arm ran with `effort = null`, which the Claude Code docs resolve
to `medium` for Opus/Sonnet/Haiku 5.5 ("Opus 5.5, Sonnet 5.5, and Haiku 5.5 default to `medium`") [docs, read
2026-10-22], against PREREG AM-11's "effort high" and the owner's "Haiku max"; the E8 scorer counts a statement covered
by a sibling sentence; the extraction gold has no platform clauses; COMP-1's K = 3 case-pooled M1 cannot resolve a
build-level defect rate; PREREG-NEED-V1 has no stand-alone specificity ceiling; heal's V3 is a one-run plausibility test;
the token sweep's equivalence guard measured agreement with itself. Each sweep proposes its own statistics; Move 0 makes
them one library with teeth and one reporting rule.

### RC7. Failure-driven where change-driven

The repairs that worked were handed the cause as an artefact: M5's before/after rule text (6 of 6 programs, 8 of 8
changed cases, 0 collateral, $0.02–0.05), B1N's disagreement pointers, H-cfx's failing assertion with its expected
value. The ones that failed waited for a symptom and then reverse-engineered the cause through a closed grammar (H-rec,
16 invalid candidates) or re-sampled (H-p1). The need router has the same shape: need is a state of a project (the
owner's MVP-to-CI/CD example), so history, drift and recurrence are its inputs, not a one-shot text classifier. Move 8
makes diffs first-class events and re-derives Δ\* on each.

---

## 4. Reframings (ideological, each falsifiable)

1. **We optimise the wrong unit.** A task is a conjunction of a median 7 (mean 9.9) assertions; strict pass at n = 60 is a
   one-bit label with a ±0.13 CI on anything derived from it. The unit that is measurable (≈590 labels per arm, clustered),
   repairable (the failing obligation with its expected value is the repair brief), routable (the share of obligations code
   can decide) and explainable to a user ("these two items I could not verify") is the **obligation**, and the natural
   carrier is the **world-state delta under a closed-world assumption**. Objective: expected obligations satisfied per
   dollar, with UNKNOWN priced and prohibitions counted at the gate. Pass rate becomes a derived headline.
2. **Verification is cheap only when it is isomorphic to the grader and independent of the actor.** The grader is a
   closed-world diff contract; the internal verifier should be the same object, derived by code from rules and world, and
   the actor must never see it (Universal Verifier's blind rubric, 2604.06240; our primed-check finding). Not "a better
   judge model": the evidence says same-family judging has about zero marginal information.
3. **Information paths, not samples.** The budget line that matters is the number of *independent* evidence sources per
   decision (κ-gated), not K. This single rule explains why selection gained +5 with one differently built challenger and
   0 with two same-family forks, why K = 3 readers are worth two points, and why nine judges are two votes.
4. **Verifiability is the routing variable.** Where Δ\* is mostly code-decidable, run cheapest-first behind a commit gate
   and escalate on a *verified* failure; where it is not, no mode can be trusted and the workflow's value is the
   verification it builds. "Does this task need a workflow" becomes "what fraction of Δ\* can code decide, and which hard
   primitives does the typed sketch declare".
5. **The ledger should log dispositions and assumptions, not requirements.** For the owner's tracker ask the useful
   record is: included / excluded with the executed predicate or verbatim rule, assumed with the labelled null, asked with
   the distinguishing member. ToolGuard's `pending_for_user`, Fact Graph's placeholder taint and the chase's labelled nulls
   are the same idea.
6. **The slider's unit is evidence, not dollars.** Owner-facing α ("how sure before you interrupt me") with certified
   false-trigger bounds and a live readout, with V, N and W internal.
7. **Composition's value is cheap local change and in-flight children, not equal-budget first-shot accuracy.** Identity,
   atomicity and serialisation are platform properties and should leave the statistic; what remains (seam logic) is
   measured like any monolith at build level.
8. **The frontier bar is a point on a cost–accuracy surface.** Opus 5.5 xhigh 35.77% at $0.89 and Sonnet 5.5 xhigh 36.83%
   at $0.48 on the private set; effort and dollars move the score more than size [benchmark]. The claim worth making is
   "parity or better at ≤ 1/5 of the dollars on unseen tasks, Opus + the same harness as the control".

---

## 5. Mechanisms from distant fields that the sweeps did not reach (new today; each testable)

- **Data exchange and the chase (database theory).** Given a source instance and source-to-target dependencies, the
  chase computes a *universal solution*; queries evaluated on it, dropping tuples with nulls, give the *certain answers*;
  for weakly acyclic dependencies this is polynomial (Fagin, Kolaitis, Miller, Popa, TCS 2005) [paper, classic;
  summary read 2026-10-22]. Transfer: rules in policy sheets are source-to-target dependencies, the inventory is the
  source, Δ\* is the universal solution, and **labelled nulls are the UNKNOWN set by construction**. The "distinguishing
  member" of oracle-guided synthesis is a null that two candidate rule sets instantiate differently. Implementation
  needs no new dependency: stratified rules as `WITH RECURSIVE` CTEs on `node:sqlite` (SQLite's recursive CTE is a
  queue-based iteration with `UNION` deduplication, so cycles terminate) [docs, read 2026-10-22]. Imieliński–Lipski
  conditional tables are the formal basis for carrying conditions on unknown values and also the warning that plain
  three-valued logic cannot promise complete answers over incomplete tables (JACM 1984) [paper, classic, S].
- **Kleene three-valued logic under a closed-world assumption (logic programming).** Today's verdict is implicitly
  open-world: not-proven-false is pass. Runtime verification's true / false / inconclusive (Bauer, Leucker, Schallhart,
  verified by the VP sweep) is the right semantics; the product output of "inconclusive" is the assumption list.
- **Kinetic proofreading (molecular biology).** Hopfield 1974: error rates fall only when a *second, energy-consuming,
  irreversible* discrimination step is added that does not reuse the first step's information; a second check that shares
  the first's state buys nothing (PNAS 71:4135) [paper, classic, S]. Transfer: the commit gate is the proofreading step,
  and it must consume the world's own state (read-back after write) and Δ\*, not the actor's plan. The same law explains
  the clinical double-check result (primed checks) and the κ budget.
- **Syndrome decoding (coding theory).** With parity checks (Δ\*) the receiver localises and corrects errors without
  re-decoding the message; the syndrome *is* the repair brief. This is why "information about the fix" (self-repair's
  binding variable) and "localise the missing obligation" (verification's near-miss mass: 10 of 31 miss one assertion) are
  the same deliverable, and why repair without Δ\* is a resample.
- **Three-way match (accounts payable control).** Intent (the purchase order), receipt (the goods received) and claim (the
  invoice) must agree within tolerance before payment; auditors test the control by exceptions (NY State Comptroller AP
  internal-controls checklist) [docs, read 2026-10-22]. Transfer: request intent, Δ\*, and the observed diff are the three
  documents; an unmatched item on *any* side is an exception, which yields over-action detection at $0.
- **Metamorphic world twins (software testing, no oracle).** Instead of mutating the trajectory, mutate the world: inject
  a decoy that matches the exclusion rule, rename an entity, permute the inventory; the correct diff must be invariant
  modulo the mutation. This gives a label-free precision test for closure and a selection signal that no judge can
  Goodhart. Caveat from the only 2026 metamorphic study of tool-calling agents I found: intrinsic flakiness affects about
  30% of tasks and language switching changed behaviour in up to 41% of tasks (SAST 2026, DOI 10.5753/sast.2026.32354,
  1,600 invocations, two open models) [paper, read 2026-10-22], so twins are a precision instrument, not a recall one.
- **Minimal sufficient statistic (information theory).** The ledger's output should be the sufficient statistic of the
  request given the world: rules and pointers, whose size scales with the number of rules, not with the world. The token
  target follows: O(|rules| + |pointers|), not O(K × |world|). Everything else is code-derivable and therefore free.
- **Deontic runtime governance (knowledge representation).** AgenticRei (arXiv 2606.19464, ICWS 2026) argues production
  engines (XACML, Rego, Cedar) cover only permit/prohibit and adds obligations, dispensations and conflict resolution
  evaluated outside the LLM [paper, read 2026-10-22]. It confirms the split the latent-requirements sweep made:
  prohibitions at the call (a gate), obligations at the end (a monitor), permissions nowhere.

---

## 6. The top eight moves

Format: mechanism; why it should work here (sweep evidence); cheapest decisive experiment ($0 first, paid cap); success
and kill; track; expected effect on the owner's bar. Budget authority: D22 ($40 non-frontier dev), D18 (≤ 20M Mercury
tokens, see Move 5's precondition), D19/D26 (Opus arms), D24 ($80 durability). All paid steps are development evidence
on devTrain tasks disjoint from dev60 under the A4/D23 sequential plan; never devCheck. New code goes in new files
(`harness/v3/`, `verifier/`, `compose/runtime2.mjs`) so frozen hashes keep.

### Move 0 (prerequisite). One certification library and ceiling-adjusted reporting

- **Mechanism.** `experiments/lib/certify.mjs` (extending `stats.mjs`): Clopper–Pearson and Wilson bounds; the
  Neyman–Pearson umbrella threshold (`n_min = ln δ / ln(1−α)`: 59 for 5%, 299 for 1%); exact binomial and hypergeometric
  elusion bounds for recall; the shrinkray-style sequential gauntlet (ported from `nondeterminism.py` with its 45 tests;
  `min_hits = min(12, min_hits + 1)` per observed false accept); build-level exact permutation; O'Brien–Fleming looks;
  learn-then-test precision thresholds (MAPIE parity). Reporting rule: every headline carries the reachable-subset score
  beside strict (dev60 ceiling 53/60, 49/60 conservative), the effective sample size, and the effort/temperature/cap of
  every node from the launch manifest; a missing effort is an error in paid runs.
- **Why.** RC6: every sweep's success bar was broken by its own evaluator. Tests with teeth already exist in the sweeps'
  calculations: the naive threshold violates α in 48–65% of replicates and the umbrella in ≤ 8%; case-pooled tests give
  ~25% false positives; CP(0 of 59) = 0.0495 ≤ 0.05 < CP(0 of 58).
- **Experiment ($0, ~1 day).** Build, port the 45 gauntlet tests, re-score: the E8 extraction samples at unit level with
  the null baselines; H-p1/H-cfx/H-rec through `certify.mjs` (expect: H-p1 control non-evidential, H-cfx accepted only in
  deterministic mode, H-rec rejected); the M1 need negatives (n_eff 5–9); dev60 headlines with the ceiling column.
- **Success / kill.** All teeth tests pass; PREREG-AB-v1, PREREG-NEED-V1 (new C7c never-trigger bound), PREREG-COMP1
  (build-level M1) carry dated amendments before the next paid comparison. Kill: none; this is hygiene.
- **Track.** All; owner (amendments).
- **Effect on the bar.** None on pass rate; it is what lets any later number be a claim rather than a story.

### Move 1. Δ\*: the expected-diff contract, derived by entailment (RL2 + closure + derivation + identity)

- **Mechanism.** Extend RL2 into Δ\* v1: (a) **universe closure**: code enumerates every member of each collection the
  positives cite (median 19 rows, 1.3K tokens) and requires a disposition per member: `include`, `exclude` with an
  executed predicate or a verbatim rule quote, or `unknown`; readers write *predicates over attributes*, not lists;
  (b) **derivation by code**: sums, buckets, days-until and dates computed on `node:sqlite` from reader-written
  SELECTs under `setAuthorizer` deny-by-default with a function allow-list and a worker timeout (the skeptic's probe:
  `PRAGMA query_only` alone is insufficient; `ATTACH` wrote a file; `randomblob(1e8)` allocated 100 MB); (c) **labelled
  nulls**: an unestablished "today", an undisposed member or an ungrounded value becomes UNKNOWN, never a silent soft
  check; (d) **compile both directions** into the existing grammar: positives to `msg_has / created_has / rec_field`,
  the complement to `msg_lacks / created_none / rec_unchanged / row_not_exists` as *hard* checks when the disposition
  is executed or quoted; (e) emit Δ\* in the Agent-Diff DSL shape (`diff_type, entity, where, expected_count, strict`)
  so one object serves the actor brief (as a read-back list), the commit gate (Move 2), the verdict (Move 3), the
  selector and the repair brief.
- **Why it should work here.** RL2 is already the best verifier measured (held-out AUROC 0.837; rejects 4 of the 11
  false "all pass") and its misses are the three missing pieces: 53% of its requirements cite a world record, three of
  its four design-fold selection losses are shared misreads of one eligibility, exclusion or status rule, and medium
  reasoning did not fix them [benchmark, VL §1.2, §6 M7]. Closure covers 27 of 27 located guarded entities; the
  predicate evaluator covers 24 of 25 that are decided by attributes; one query reproduced two failed computed literals
  and an exclusion set [observed-code, LR §1.5–1.6]. On the best arm, prohibitions and content literals are 62% of the
  non-defect failed assertions [obs, §3 RC1]. External: StarHarness's accepted patches were spreadsheet row operations,
  date and finance calculators and a triage-before-mutation step (Finance 57.1% → 83.2%, guardrail-violating tasks 20 → 4,
  arXiv 2608.24804; the skeptic reads it as support for triage-before-mutation, which is closure) [paper]. Agent-Diff shows
  the closed-world contract is gradeable at scale (224 tasks) [paper].
- **Cheapest decisive experiment.** $0 step A (closure replay): enumerate the universes for all 60 dev60 tasks from
  stored `inventory.json`; apply the oracle-implied member labels only as *scoring scaffold*; measure, for the 14
  broken-guardrail tasks and 14 matched passing controls, what share of the 28 broken guardrails a code-enumerated
  disposition with the reader's *existing* exclusion rules already reaches, and how many of the ~70 passing worlds a
  closure-derived hard negative would have flagged on their stored `final-world.json`. $0 step B (derivation): on the 7
  derived-only failures, express each oracle figure as one SELECT over the cited collections plus `today`; label it
  expressibility (oracle-informed), not capability, per the skeptic; the clock needs the L0 protocol ruling first
  (`meta.current_time` is hidden; DATE_NOTE gives no date; derive "today" from the work items' business dates, G6). Paid
  step (≤ $1.5, Haiku, ledger only, no acting): readers write predicates and SELECTs for the 60 dev60 tasks; compile;
  replay against stored final worlds. Then the A1-C v2.1 build runs Δ\* as the acceptance signal on the next look.
- **Success / kill (preregister).** Replay: closure recall ≥ 6 of 14 broken-guardrail *tasks* with no task contributing
  over 30% of the numerator; false exclusion of required entities ≤ 5%; ≤ 1 of ~70 passing worlds flagged; derived
  literals: ≥ 5 of the 7 candidate tasks reproduce the oracle values from predicates the readers wrote (not from
  analyst-chosen dates); confident-wrong ≤ 5%. Kill: closure recall < 4 of 14 or false exclusion > 10% or > 3 passing
  worlds flagged. On the look: guardrail breaks halve, strict pass not lower, content-level breaks ≤ raw Haiku's.
- **Track.** A1-C v2.1 (primary; `harness/v3/{universe,disposition,calc}.mjs`) with verifier-lab (RL2 is the seed;
  `verifier/requirement-ledger-v2` stays frozen, Δ\* is `requirement-ledger-v3`).
- **Effect on the bar.** +4 to +7 dev60-like tasks on the best arm (5 prohibition-only and 5 content-only non-defect
  failures are the direct targets; ideal +10), at ≈ $0.02 per task; and the UNKNOWN list the product needs. Overlaps
  partly with selection's +5, so count +3 to +5 net on top of VL-1.

### Move 2. Effect identity and the commit gate: exactly-once as a platform property, verification before the write

- **Mechanism.** One **effect registry** (identity templates per `system.op`, mirroring `capabilities.mjs identityOf`
  for E8 and the write routes' recorded action keys for AutomationBench) keys every outbound effect by *entity* identity,
  never by the caller's trigger id; an inbound inbox drops re-delivered results per (module, key); a static
  single-writer gate refuses manifests with two owners of one effect kind. On top of it a **commit gate**: before any
  irreversible write, the planned effect is checked against Δ\* (P at the call: recipient and mention closure,
  `created_none`; K: duplicate identity; O: a write that satisfies no obligation is an *unexplained* effect) and either
  admitted with a certificate (effect, Δ\* items it discharges, witness read-back) or held. This is the deployable form of
  the verifier lab's fork selection (a sent e-mail cannot be unsent): plan-level candidates, verify, commit one.
- **Why.** RC5 is established at $0 by the composition skeptic (two one-line fixes); the v2 pre-send lint and
  `tool-gated.mjs` exist and are off until P0 [observed-code, A1C-V2 §2 M4]; the verifier lab's M2/M3 name the same two
  mechanisms as priority 1 and warn that repair without idempotence nets −1 to +2 [benchmark]; 12 of 29 broken guardrails
  are message-mention breaks that no end-state check can repair [observed-code, LR §4.3]; the need-router skeptic's
  objection to the escalation ladder (re-execution double-fires) is answered only by keys; LIMBO's key guard transfers
  across harnesses unchanged; CAC's admission certificate is the same design with 0 harmful effects in 390 trials
  [paper]. Kinetic proofreading says the gate must consume a different signal than the actor's plan: Δ\* and the
  read-back, not the brief.
- **Cheapest decisive experiment.** $0: (a) apply the two COMP one-line fixes behind the registry and rerun M4b/M4d on
  worlds 1161/1162/1164 (expect 0 logical duplicates outside the universal D4 loss, fault-free digests unchanged, the
  distinct-refunds mutant still flagged, no false positives on the three C-H-T manifests; the skeptic's non-circular
  threshold); (b) replay the five dev60 arms' stored `calls.jsonl` (~290 task runs) through v2's `replay-gate.mjs --lint`
  with Move 1's dispositions: count true refusals on failing worlds and false refusals on passing worlds. Paid (≤ $2):
  14 broken-guardrail + 14 control tasks live with the gate on.
- **Success / kill.** Replay: ≥ 6 of the 12 message-mention breaks refused from ≥ 3 distinct tasks, ≤ 1 false refusal over
  all passing worlds (NOMOS's 95.9% refusal is the failure mode to fear); duplicates per arm 13/60 → ≤ 2/60; COMP M4b/M4d
  within the monolith band. Kill: > 1 false refusal on passing worlds, or any admitted write that Δ\* could not explain
  being right more often than wrong (then P is wrong, not the gate).
- **Track.** A1-C v2.1 (gate), COMP-2 (`runtime2.mjs` + `effects.registry.json`; owner approval outside the
  PREREG-COMP1 freeze; keyed start B6 remains owner-gated), heal/failure-handling (the ladder's safety condition).
- **Effect on the bar.** Removes the repair hazard, so verifier-driven repair and the retry ladder become net positive
  instead of −1..+2; up to +6 of 29 guardrail breaks on the best arm; in COMP, D2/D3 leave the statistic (pooled M1 ≥
  0.955 → ≥ 0.98 excluding go-live, which is then an extraction question, Move 5).

### Move 3. Three-valued release with calibrated abstention: UNKNOWN is a product output, never a pass

- **Mechanism.** Per obligation: SUPPORTED (a code-decided or diff-decided check with a content constraint passed),
  FAILED, or UNKNOWN (labelled null, unobservable, judged-only, or unexplained effect). Release only when FAILED is empty
  and the UNKNOWN set is shown as the assumption list (and, in the product, accepted or asked about by the
  distinguishing member). Selection ranks candidates by (FAILED, SUPPORTED, UNKNOWN) lexicographically; repair consumes
  only FAILED with expected values (the syndrome). The release threshold is set by learn-then-test on the mutation lab
  (Move 4), reported as a risk–coverage curve with n_eff, and certified by Move 0.
- **Why.** RC3. The skeptic's faithful tri-state replay reached only 12% coverage on the *current* checks, which is why
  Move 3 depends on Move 1: with closure and derivation most obligations become code-decidable and UNKNOWN shrinks to
  the real unknowns. Precision of "all checks pass" moves from 0.607 to only 0.654 when defect tasks are excluded, so the
  gap is real [benchmark, VL §1.2]. The owner's product asks for exactly this ("tracker", "seamless"): a run that says
  "done, except these two items I could not verify" is the honest artefact, and the benchmark gets an abstention metric
  beside pass rate.
- **Cheapest decisive experiment.** $0: implement the verdict as a pure function over stored `postconditions.json`,
  `check-*.json` and Δ\* replays; compute risk–coverage with leave-one-task-out on both pipelines; count how many of the
  11 false accepts become UNKNOWN or FAILED and how many of the 17 true accepts stay SUPPORTED. Sample-size reality from
  the sweeps: a one-sided 95% lower bound of 0.85 on precision needs 19 accepted tasks with 0 errors or 30 with 1, so the
  guarantee arrives only across looks 2–3 (≈ 150–200 tasks); look 1 is a direction check.
- **Success / kill.** Look 1: SUPPORTED precision ≥ 0.80 at coverage ≥ 25% (not 15%: closure and derivation must raise
  coverage), UNKNOWN precision ≤ 0.55; refuted below 0.65 precision or below 15% coverage. Kill if the UNKNOWN set is
  dominated by unobservable kinds (then the fix is read-back coverage, Move 2).
- **Track.** verifier-lab (verdict and risk–coverage), A1-C v2.1 (release semantics; an owner decision and a PREREG
  amendment), product (assumption list in the tracker, #60).
- **Effect on the bar.** No direct pass-rate gain; it converts the pipeline's 11 false accepts into holds, which is the
  owner's "high pass rate" read correctly: pass rate among released runs, with coverage reported.

### Move 4. The free-label verifier lab: trajectory mutants and world twins through the official grader

- **Mechanism.** From the ~77 officially passing stored worlds, generate (a) **trajectory mutants** by editing the call
  log and replaying with `bridge.py replay` (drop a write, swap a recipient, perturb a figure, add a forbidden row, skip
  the read, duplicate a send, rewording-only equivalents) and (b) **world twins** (inject a decoy matching the exclusion
  rule; rename an entity; permute the inventory). The official rubric labels every mutant at $0. Score every verifier
  (own checks, code-checks, RL2, Δ\*, judges, the closed-world diff) by kill rate and false-alarm rate per assertion class
  and per mutation class; nl2postcond-style completeness per check type; choose release thresholds by learn-then-test.
- **Why.** RC2 and RC6: n = 60 binary labels cannot rank verifiers (CI ±0.13); mutants give thousands of labelled
  obligations with minimal-edit hard negatives, exactly where the current checks are weakest (prohibition and body-content
  classes). The validity check is built in: the lab's class ordering must match the real false-accept ordering. World
  twins are the metamorphic instrument for closure precision, which no trajectory mutant tests. Precedent: fault-injected
  trajectory corpora (AgenTracer, Aegis), mutation-scored oracles (nl2postcond), SWE-ABS's "generate wrong patches, keep
  tests that kill them" (78.80% → 62.20% for the top agent under stronger tests) [paper].
- **Cheapest decisive experiment.** $0: mutation generator + replay driver; smoke on 10 worlds; table of official
  outcomes per mutation class; Spearman between lab kill rate by assertion type and the real false-accept rate by type.
  Paid (≤ $1): judge arms on the mutants.
- **Success / kill.** Spearman ≥ 0.5 with the real ordering; Δ\* kills ≥ 0.85 of official-failing prohibition and
  body-content mutants at ≤ 0.10 false alarms on equivalent mutants where current checks are < 0.5. Kill: the lab ordering
  does not match reality (then mutants are the wrong distribution and labels must come from looks).
- **Track.** verifier-lab (`experiments/autobench/verifier/{mutate,twins,lab}.mjs`; dev split only, never mixed into
  sealed evaluation).
- **Effect on the bar.** Indirect and large: it is the only way to tune Move 1 and Move 3 thresholds without spending
  looks, and it supplies the κ tables Move 6 needs.

### Move 5. The pushdown ledger: the model writes predicates and pointers; code enumerates, computes and disposes

- **Mechanism.** One ledger protocol for A1-C readers, the E8 tracker and the need router's sketch: a strict
  `json_schema` output (documented and already used by `src/models/providers/openai-chat.mjs`; the token skeptic found 4 of
  16 unparsed replies were malformed JSON), explicit `reasoning_effort` and `max_completion_tokens` on every Mercury call
  (the 24,576 default cap truncated 9 replies), pointer normalisation (1,020 bracketed and 140 differently spelled
  candidate pointers never resolved, so cross-reader votes were silently skipped), and a schema in which the model
  emits **rules, predicates, pointers and dispositions** while code enumerates candidates (today 34.8% of output),
  computes derived values (21.5%) and disposes every segmented unit (extraction's forced-disposition scan, OR across
  question-diverse views, 0 undisposed units after one re-queue). Readers 1 and 2 run; reader 3 only on disagreement (23
  of 47 tasks agree after re-merge). `instant` is an *arm*, not an assumption.
- **Why.** RC4. The same change is the first step of Moves 1 and 7 and the largest token lever: output is 57% of Mercury
  tokens and 82% of its list cost, reasoning 40%; the K = 3 third reader buys about two points of gold coverage; the $0
  structural prior already reaches unit recall 0.963 on SPEC-E so the model's job is the platform zone and the
  dispositions [obs, TE §1; ER M1; TE skeptic 13]. Mechanism-diverse views, not seeds, are what found S3/S4-class items
  in every adjacent field (SAFE phase 3, the Rashomon-set union in 2511.07055).
- **Precondition (owner).** The Mercury allowance may be nearly exhausted if cached reads count (the official loop used
  95.96M input tokens, 94.35M cached) and there is no usage endpoint. One dashboard reading before any Mercury pilot;
  until then every Mercury experiment runs under a hard cap and the Haiku path is the default.
- **Cheapest decisive experiment.** $0: fix pointer normalisation and re-merge the 180 stored replies (report changed
  votes and new hard items); build the replay prompt builder gated on cl100k × 1.048 within 5% of stored `input_tokens`
  on ≥ 97% of calls (the skeptic's calibrated gate); segment SPEC-E and score the $0 null baselines at unit level
  (Move 0). Paid pilot (≤ 0.7M Mercury tokens under D18, or Haiku at ≈ $0.5): 6 tasks × readers × {default, instant +
  cap, schema-strict}, then the 60-task arm.
- **Success / kill.** Parse failures ≤ 2% (control 8.9%); ledger tokens ≤ 0.6× control under `instant` *or* `low` + cap
  (report the dose curve either way); gold coverage of official positive literals in the ledger text ≥ 0.91 (K = 3 today
  0.912, K = 2 0.906); computed-literal coverage 39% → ≥ 70%; extraction unit recall ≥ 0.95 on gold-v2 in 3 of 3 with
  S2/S4-class items found by a non-LLM view or by a question-diverse view, never by more seeds. Kill: coverage drops below
  0.89, or `instant` leaves reasoning unchanged (then the lever is the cap and the schema only).
- **Track.** Mercury efficiency (executor flags, `ledger-replay.mjs`), A1-C v2.1 (v3 ledger prompt), extraction/tracker
  (`scan.mjs`, `units.mjs`), need router (the typed sketch reuses the schema).
- **Effect on the bar.** −40 to −60% Mercury tokens per task (24–37K instead of 61K) and +2 to +4 tasks from exact
  computed literals; removes the "lost reader" failure (13 of 60 tasks) that silently weakened the ledger.

### Move 6. The information-path budget: κ-gated diversity, one differently built challenger, and the Opus 2×2

- **Mechanism.** A standing rule: a reader, fork, judge or check enters a decision only with a measured κ (or n_eff)
  against the existing set, and anything above 0.4 is refused; report n_eff beside every aggregate. Concretely: default
  arm plus **one** differently built challenger (not k same-family forks), selected by Δ\* then the Haiku world-reading
  judge (VL rule R3); one ledger reader from another family where it is Haiku-priced; readers that differ by *question*
  (obligation / violating scenario / zone) rather than by seed. And the decisive ideological test: a **2×2 of model
  (Opus 5.5 xhigh vs Haiku-class) × learned conventions (with vs without the generic G-list and tool-effect cards)** on
  look-2 tasks. Plus the untested dose lever: Haiku at `max` (every date-note arm ran at the CLI default `medium`
  [docs; observed-data]).
- **Why.** RC2 in numbers: P2 (m3-a1c + sonnet-a1) gains +5 (34/60) where the stored k = 3 cheap forks gain 0 and the
  same-pipeline pair loses; judge-judge κ 0.61–0.70 versus RL2-judge 0.35; nine judges ≈ two votes; medium reasoning did
  not fix shared misreads [benchmark, VL]. If the playbook lifts Haiku at least as much as Opus, the gap is knowledge, not
  intelligence (the thesis in one experiment); if Opus gains little, its ceiling here is knowledge-bound. Effort moved
  GPT 6 Astra +2.4 points per level and Claude +6.7 to +7.9 from xhigh to Max on the leaderboard [benchmark], and the
  owner's role table says Haiku max.
- **Cheapest decisive experiment.** $0: κ/n_eff tables for every existing signal pair from the stored lab rows; the
  `--effort` cost model from stored tokens. Paid: the Opus arm is already running on look 2 (`a0o-look2-1`, D26) and VL-1
  is pre-registered (D27); add (i) Haiku v1-M at `max` and (ii) v1-M + conventions/cards as reported exploratory arms on
  the look-2 list (≈ $2–4 each at Haiku prices), and (iii) Opus + the same conventions only if D19's budget allows (≤
  $60). Everything paired, exact McNemar plus task bootstrap, labelled A1F where forks exist.
- **Success / kill.** Selection works on fresh tasks if VL-1 − v1-M ≥ +3 with ≤ 2 losses (VL's own rule); conventions
  are knowledge if Haiku's gain ≥ Opus's gain and ≥ +4; effort is a lever if `max` ≥ +3 at ≤ 2× cost. Kill selection if
  ≤ +1; kill conventions if Haiku gains < +2; kill effort if saturated.
- **Track.** verifier-lab (VL-1, κ tables), A1-C v2.1 (conventions G4/G7/G9/G10/G11 as code checks, G1/G3/G6/G14 as brief
  rules, disclosed under D21), breadth (the κ rule is portable to every bed).
- **Effect on the bar.** This *is* the bar: a cheap system at frontier parity on 60 unseen tasks at ≤ 20% of Opus's cost
  (VL expects 50% vs an Opus prior of 35–50% at ≈ $0.15 vs $0.9–1.5 per task). Power: n = 60 resolves only ≥ 8–10 task
  differences, so the honest look-2 claim is "parity, not distinguishable, at 6–10× lower cost".

### Move 7. The verifiability-first need router with a certified never-trigger

- **Mechanism.** Stage G, a hard guard on declared typed primitives (durable wait, human gate, compensation or an
  irreversible effect with authority, cross-session state, declared N, size) with `on_unknown: no_match`; Stage R, a
  conjunctive rule-out certified by the NP umbrella on ≥ 299 independent negatives (SWE-rebench one-issue-per-repo plus a
  second population); Stage M, the middle zone: a cheap **typed sketch** (steps with kinds, waits, gates, effects with
  reversibility, systems, loops) counted by code, a **Δ\*-derivability score** (the share of sketch obligations that
  Move 1 can compile to code-decidable checks), the Haiku typed-question head (AUROC 0.69–0.74, the comparator the
  skeptic named, not Jev at 0.46–0.53), then a budgeted ladder (cheapest mode first, escalate only on a verified failure or
  loop) *behind Move 2's commit gate*, and at most three yes/no questions whose answers become typed fields. The slider
  is α with a live readout; 2–5% of rule-out tasks get a randomised shadow check so the bound stays estimable.
- **Why.** The sweep's two-problems finding (structural need is decidable from typed fields; capability need is
  executor-specific and text-weak) plus the skeptic's corrections: the ladder is only safe with idempotent effects and a
  real verifier (D3: self-checks passed 6 of 6 oracle failures), which Moves 1–2 supply; the keyword router is unusable
  as a trigger (54.4% on routine issues; 2.3% even for hard cues once "accept" is excluded); E3's "expand on failed
  check" carries the reliability in a simulator (100% vs 85.1%) [paper]; need is a project state (history, recurrence,
  drift) and the JIT router already decides compile timing from traces, so one evidence ledger and one α should govern
  both.
- **Cheapest decisive experiment.** $0: `np.mjs` (with the corrected test: CP(0/59) ≤ 0.05 < CP(0/58)); the independent-
  negatives audit extended to a second population; the escalation-ladder replay on archived matrices (P1, C0, JIT
  streams) with the F11 false-pass rate flagged where no verifier exists; the sketch schema and code counter with a
  scripted model. Paid (≤ $0.5 at list, Mercury or Haiku): sketches on the 144 M1 prompts, the 449 corpus descriptions and
  the 351 negatives; the Δ\*-derivability score on the same.
- **Success / kill.** Deployed guard + rule-out fires on 0 of ≥ 299 independent negatives (upper bound ≤ 1%); any
  text-derived trigger ≤ 7/351 or demoted to "ask"; sketch recall of {human, wait, schedule} ≥ 0.50 with precision ≥ 0.50
  against graph truth (cue baseline 0.75/0.36, 0.15/0.21, 0/—); LOFO AUROC of size + sketch counts + derivability ≥ 0.75
  on M1 with the family-bootstrap interval reported, beating the Haiku typed head, not Jev. Ladder: in verifier cells the
  closed gap ≥ the best router's at ≤ 4× VBS\* cost (tested, not assumed). Kill: sketch recall < 0.30 (ship the
  questionnaire); ladder worse than the best single mode in half the verifier cells (then the middle zone needs the label
  factory, but only there).
- **Track.** need router (new files only; PREREG-NEED-V1 §13 deviation entries; Jev stays dropped per D26).
- **Effect on the bar.** No AutomationBench pass-rate change; it answers the owner's B1 ("detect if a task needs a
  workflow; never trigger on no-workflow tasks") with a certified number instead of a $660 label factory, and it reuses
  the sketch schema and Δ\* from Moves 1 and 5.

### Move 8. Change-driven maintenance with certified heal: diffs are events, probes write the cards

- **Mechanism.** Four diff sources become first-class events that re-derive Δ\* and open a patch window: spec text
  (unified diff of rule units), tool schema (an OpenAPI/JSON-schema differ; oasdiff for HTTP tools), data profile
  (value-domain histograms per column, Deequ-style), and model/policy hash. **Tool-effect cards** are mined once per
  connected app by fork-probing every write route with synthetic arguments and diffing the world (which collection
  changed, which action key was recorded, which parameter names are stored verbatim), never from rubric code, and
  injected into the inventory brief. Repair tiers by blast radius: T0 narrowing-only (guards, refusals, escalation,
  automatic), T1 one node's prompt or check (differential agreement of two independent proposers on fuzzed inputs), T2
  one module in code (full gate), T3 manifests and contracts (owner). Certification by the gauntlet (Move 0): a
  deterministic defect certifies by exact replays plus stratified fresh cases; a rare stochastic one only by mechanism
  injection plus post-promotion monitoring (sampling would need ~200 runs per arm). When no notice exists, bisect
  last-green to first-red over (workflow version, policy hash, model id, tool schema, data profile): the bisection result
  is the notice.
- **Why.** RC7: M5's drift patches (6/6, 0 collateral, $0.02–0.05) and B1N's disagreement-driven repairs are the only
  claimable heals, and both arrived as diffs; H-rec failed on variety (the skeptic showed the "what" was in the brief),
  so the IR heal tier is retired to narrowing; the never-passed Trello/Monday/Note failures are behavioural-contract gaps
  the cards remove [observed-code, ceiling §1.5]; TraceElephant shows full traces help attribution and ours are full;
  Kintsugi's deterministic gate with protected-regression checks is the closest published design [paper].
- **Cheapest decisive experiment.** $0: `probe.py` over the write routes on a scratch world, 10 cards hand-reviewed;
  per-case pass vectors for the six composed programs and the monolith lineages under the drift (the collateral a rebuild
  would cause); the differential-fuzz gate on the three stored H-cfx candidates (expect it to rediscover the Sonnet
  kind-change crash automatically, 0 spurious disagreements over 5,000 inputs). Paid: SR-1 narrowed to the
  notice-withheld arm (≈ $0.5–2) and the cards arm on the 12 never-passed non-defect tasks plus 20 controls (≤ $3).
- **Success / kill.** Cards flip ≥ 4 of the 12 (the 7 hard defects are excluded by construction) with ≤ 1 control
  regression; N1 − N2 ≥ 10 points on changed cases (the notice carries the gain) with 0 collateral; the fuzz gate finds
  the known crash. Kill: cards flip ≤ 1 (then conventions, not contracts, are the dead zone); N1 ≈ N2 (spec access
  suffices and the information thesis weakens for drift).
- **Track.** heal/failure-handling (code-first, no frozen-kit dependency; the kit question is decided only after the
  gauntlet exists), COMP-2 (M5 monolith baseline, `patch-drift.mjs --monolith`), durability program (D24: the drift stream
  is where change events occur by design).
- **Effect on the bar.** +3 to +5 on the never-passed set through cards; makes "adapts and heals as it does real work"
  (A4) a claim with a certificate instead of two tied incidents.

---

## 7. Expected effect on the owner's bar (arithmetic, with the honesty tax)

| Step | dev60-like strict pass (best cheap arm) | $ per task (list, Haiku/Sonnet; Mercury tokens separate) | Evidence class |
|---|---|---|---|
| Today, best single arm (Mercury planner + Haiku) | 29/60 (in-sample); A1-C Haiku 20/60 on dev60 and devCheck | 0.016 + 61K Mercury tokens | dev |
| + selection with one differently built challenger (VL-1) | 34/60 (dev); look-2 prior 50% (45–55) | ≈ 0.15 | pre-registered, running |
| + Move 1 closure and derivation, + Move 2 gate (duplicates out, repair safe) | +3 to +5 net | +0.02 | to measure on look 2/3 |
| + Move 6 conventions G-list and Move 8 cards (never-passed set) | +3 to +6 | +0.00–0.01 | to measure; overfit risk disclosed under D21 |
| + Move 6 effort `max` on the cheap actor | +0 to +4 | ≤ 2× actor cost | unmeasured |
| Dev60 ceiling (hard defects excluded) | 53/60 (49/60 conservative) | — | VL §2 |
| Opus 5.5 xhigh alone, same CLI setup | prior 22–24/60 on dev60 (80% interval 18–29, sweep and skeptic); look-2 prior 35–50% | 0.9–1.5 | running on look 2 |

Reading: a cheap mixed system at 40–46/60 on dev-like distributions against Opus xhigh at about 22–27 is plausible,
but at n = 60 the paired test resolves only ≥ 8–10 task differences, so the first honest statement is **"parity with
Opus 5.5 xhigh, not distinguishable at n = 60, at 6–30× lower cost per task and about 10× lower cost per verified
success"**, exploratory and A1F-labelled, followed by the sealed rerun. Every headline carries the ceiling column.

---

## 8. What to stop doing

1. **Stop buying same-family samples.** No third same-prompt reader by default (reader 3 on disagreement only), no k = 3
   same-pipeline forks, no more judges, no same-model N-version votes against shared-spec misses, no debate or MoA.
2. **Stop treating "all checks pass" as a release or stop signal**, mapping null or soft to pass, or running
   verifier-driven repair without idempotent effects.
3. **Stop asking the model to enumerate candidates, do arithmetic, count primitives or guess a scalar effort**; it writes
   predicates, pointers, dispositions and typed sketches.
4. **Stop building IR heal ops and closed-grammar patch spaces**; stop counting V3 one-run passes as heal evidence; keep
   heal replays blocked until the gauntlet exists.
5. **Stop ex-ante routing research by text difficulty** (Jev at chance, text-only ρ 0.09–0.40) and stop the $660 label
   factory in its current shape; label only the middle zone after Move 7's $0 steps.
6. **Stop case-pooled K = 3 composed-versus-monolith comparisons** and stop asking Haiku to hand-write exactly-once
   machinery.
7. **Stop spending Mercury before the allowance is read**, and stop any Mercury call without explicit
   `reasoning_effort`, `max_completion_tokens` and a strict `json_schema`.
8. **Stop running paid arms with effort unset**; record effort, temperature and caps in every launch manifest.
9. **Stop using frequency estimators (Chao) as completeness claims** and stop tier-ups of the extraction model (Sonnet
   is more selective, not more complete).
10. **Stop gating on the pipeline's own uncertainty flags** (no signal at this n) and stop lexical relevance filtering
    of inventories (BM25 ≈ random on citation recall).
11. **Stop reporting dev60 in-sample numbers as progress** and stop any headline without the reachable-subset column.
12. **Stop G12/G13-style grader-quirk conventions** and stop treating "duplicates do not count" as acceptable.

---

## 9. Owner decisions and preconditions (in order)

1. **Three-valued release semantics** in A1-C v2.1 and the PREREG-AB-v1 amendment for verdict and abstention metrics
   (Move 3).
2. **Protocol ruling on the clock**: `meta.current_time` stays hidden; "today" is derived from the work items' business
   dates (G6) and otherwise is a labelled null; how many dev tasks need a clock is a $0 count (Move 1 precondition L0).
3. **One Inception dashboard reading** of the remaining allowance before any Mercury pilot (Move 5 precondition); until
   then Haiku is the default path and every Mercury run keeps a hard cap under D18.
4. **A new composition harness version** (`runtime2.mjs`, effect registry) outside the PREREG-COMP1 freeze; keyed start
   (B6) stays owner-gated with its SPEC-E bump (Move 2).
5. **Policy-file edits** (owner file): `instant` effort, Mercury shadow price, recorded effort per node, `json_schema` on
   by default for ledger roles (Move 5).
6. **The heal kit**: leave replays blocked; decide the kit only after the gauntlet (Move 0) and SR-1/SR-5 results
   (Move 8).
7. **Claims policy**: numbers from dev60 stay development evidence; claims only from look 2/3 under the frozen
   sequential plan and the sealed rerun; the ceiling column on every headline.
8. **PREREG-NEED-V1 deviation**: add C7c, the never-trigger bound on a pre-declared negative population (Move 7).

---

## 10. Hand-off: move → track → first $0 step

| Move | Primary track | First $0 step (one sitting) | Owner input |
|---|---|---|---|
| 0 | all | `experiments/lib/certify.mjs` + gauntlet port + ceiling column | amendments |
| 1 | A1-C v2.1 / verifier-lab | closure replay over 60 stored inventories; 7 derived figures as SELECTs | clock ruling |
| 2 | A1-C v2.1 / COMP-2 / heal | COMP one-line fixes behind a registry; `replay-gate --lint` with dispositions | runtime2 approval |
| 3 | verifier-lab | tri-state pure function over stored checks + Δ\*; risk–coverage LOTO | release semantics |
| 4 | verifier-lab | mutation generator + replay; Spearman validity | — |
| 5 | Mercury / A1-C v2.1 / extraction | pointer normalisation + re-merge; replay prompt builder; unit-level null baselines | allowance reading; policy edits |
| 6 | verifier-lab / A1-C v2.1 / breadth | κ and n_eff tables for all stored signal pairs; effort cost model | Opus 2×2 budget |
| 7 | need router | `np.mjs`; second negative population; ladder replay; sketch schema | PREREG C7c |
| 8 | heal / COMP-2 / durability | `probe.py` cards; collateral vectors; H-cfx differential fuzz | kit decision deferred |

---

## 11. Sources

**Read 2026-10-22 (by me).**
- Agent-Diff: https://arxiv.org/abs/2602.11224 and https://arxiv.org/html/2602.11224 (state-diff contract; closed-world
  invariant; 224 tasks, 9 LLMs) [paper]; repo https://github.com/agent-diff-bench/agent-diff (MIT, HEAD `3bb9c40`,
  2026-07-01; `backend/src/platform/evaluationEngine/{assertion,differ,compiler}.py`, DSL README and `dsl_schema.json`)
  [observed-code]; shallow clone, read only, deleted.
- Cognitive Admission Control: https://arxiv.org/abs/2609.16313 (satisfied / violated / unresolved obligations; admission
  certificates; 390 trials, 0 harmful effects) [paper].
- Deontic Policies for Runtime Governance of Agentic AI Systems (AgenticRei): https://arxiv.org/abs/2606.19464 [paper].
- When the Trigger Fails: Metamorphic Testing of Tool-Calling AI Agents, SAST 2026,
  https://sol.sbc.org.br/index.php/sast/article/view/45877 (DOI 10.5753/sast.2026.32354) [paper].
- Fagin, Kolaitis, Miller, Popa, Data exchange: semantics and query answering, TCS 2005, copy at
  https://www.cs.ucdavis.edu/~green/courses/ecs289f-w10/tcs05-fagin (search summary) [paper, classic].
- Imieliński and Lipski, Incomplete information in relational databases, JACM 31(4), 1984,
  https://cs.uwaterloo.ca/~david/tud/il84.pdf (search summary) [paper, classic].
- Hopfield, Kinetic proofreading, PNAS 71(10), 1974, https://pmc.ncbi.nlm.nih.gov/articles/PMC434344 (search summary)
  [paper, classic].
- SQLite, The WITH clause (recursive CTEs): https://sqlite.org/lang_with.html [docs].
- Claude Code model configuration (effort levels; 5.5 models default to `medium`): https://code.claude.com/docs/en/model-config [docs].
- NY State Comptroller, Internal controls over accounts payable (three-way match):
  https://www.osc.ny.gov/files/state-agencies/docs/xii-4-d-accounts-pay-cert.doc (search summary) [docs].

**Carried from the sweeps and skeptics (read 2026-10-21 by their authors; only V-grade items are used as evidence).**
AutomationBench leaderboard v1.0.6 https://zapier.com/benchmarks; AutomationBench paper 2604.18934; Universal Verifier
2604.06240; Probe-and-Resume 2610.21088; Weaver 2506.18203; Nine Judges 2605.29800; Agreement Overstates Evidence
2609.22512; Limits of Resampling 2411.17501; E-valuator 2512.03109; Bauer–Leucker–Schallhart (TOSEM 2011); StarHarness
2608.24804; NOMOS 2610.11030; AgenTest 2610.28116; PROUR 2609.32255; FDE-Gym 2610.22350; Implicit Intelligence 2602.20424;
ToolGuard (AgentToolkit/toolguard, Apache-2.0); IRS Fact Graph (CC0); Claimify (ACL 2025); 2504.01294; 2604.18228;
2511.07055; coverage audits 2607.21480; QBCB 2108.12746; SAFE (Systematic Reviews 2024); STADS 1803.02130; Kim et al.
2512.08296; RouterArena 2510.00202; Adaptive-RAG 2403.14403; E3 2607.13034; 2608.05797; 2604.00594; NP umbrella (PMC5804623);
PERC (PMID 18318689); FFTrees (CC0); semantic-router (MIT), vLLM semantic-router (Apache-2.0); SWE-rebench (CC-BY-4.0);
Verma 2607.26117; Iscan 2606.31511; Self-Correction Bench 2507.02778; SWE-ABS 2603.00520; PatchDiff 2503.15223; UTBoost
2506.09289; R2E-Gym 2504.07164; Kintsugi 2605.09487; TraceElephant 2604.22708; shrinkray (MIT); GEPA (MIT); fast-check
(MIT); Inception docs (reasoning efforts, models, structured outputs, OpenAPI); Anthropic context management and
advanced tool use posts; 2609.32961; 2609.22114; 2601.06007; TOON (MIT); DocETL (MIT); LOTUS (Apache-2.0); salsa
(Apache-2.0/MIT); LIMBO 2609.29095; UndoBench 2610.05622; ArrivalBench 2610.02363; Resume Means Resume 2608.03836; Stop
Means Stop 2607.14166; 2607.02808; VP-CONTROL 2609.10969; Helland (CIDR 2007); Candea and Fox (HotOS 2003); Pacti
(BSD-3); Temporal, Restate, Camunda, DBOS docs; VERIFIER-LAB.md (2026-10-22) and its RL2, code-checks, diverse-judges and
learned-selector reports.

**Repo evidence (read-only, 2026-10-22).** `experiments/autobench/verifier/requirement-ledger-v2/{extract,compile}.mjs`;
`experiments/autobench/harness/{checker,postconditions}.mjs` as cited by the sweeps; worktree `wf_3674d3bc-0a7-12`
`A1C-V2-DESIGN.md` §2, §7; `research/decisions-20261021.md` D18–D27; stored grades under
`/var/tmp/foundry-work/autobench/{m3-a1c-dev60-dn,m3-a1c-dev60-dn-fill,a1c-dev60-dn}/host/*/fork-0/grade.json` and the
ceiling strata `scratchpad/vlab/dj/strata.json` (scoring only). My scripts: `scratchpad/blockers/synth/attrib.py`,
`attrib2.py` (`python3 -I`, read-only; counts by assertion type and stratum, no grader strings printed into this file).

**Not verified today, used only as pointers.** Knight–Leveson 1986 (n-version correlation; our own n_eff numbers carry
the point instead); the Lakkaraju selective-labels paper; plan bouquets; the Ottawa pooled figures; Hopfield's exact
error bound.
