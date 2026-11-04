# A1-C v2.1: the build plan after the ATTACK moves (2026-11-04)

**Role.** Synthesis of the four ATTACK branches (ATTACK.md §6 Moves 0–4, 6 and 8 at $0, decision D28) into one build
plan for A1-C v2.1, the AutomationBench harness version after the frozen A1-C v2.

**Evidence class.** Every number below is development/diagnostic evidence at $0: stored dev60 runs (devTrain, `--subset
60 --seed 21`, k = 1, A1-C in-sample), stored E8/COMP worlds, replays through the official grader, and scripted models.
Two numbers are new here, both $0 and computed by me: the merge simulation of §4 (`git merge-tree`, no ref moved, main
untouched) and the look-3 power figures of §5 (exact enumeration, cross-checked against `experiments/lib/stats.mjs`
`mcnemarExactCounts`). Nothing here is a claim (D28 (4)).

**Keep this file out of every harness, verifier and model context.** It cites the ceiling column and convention ids
from VERIFIER-LAB.md. Only the generic mechanisms of §2, in their generic wording, may reach code.

**What the author read and saw.** In full: `research/OPERATING-PRINCIPLES.md`, `ATTACK.md`,
`research/decisions-20261021.md` (D1–D34), `research/automationbench-20261014/VERIFIER-LAB.md`, and the four branch
write-ups `MOVE0-CERTIFY.md` (`d3bd7acf`), `MOVE1-2-AB.md` (`3ab9a813`), `MOVE2-COMP.md` (`2343a561`),
`MOVE3-4-6-LAB.md` (`b5099081`). In part: PREREG-AB-v1-AMEND-1 §1–§2, PREREG-A1CV2-P1 §1, §4–§6 and §10–§12,
PREREG-VL1's header and decision rules, PREREG-DUR-1's certification and freeze sections, and SEQUENTIAL-PLAN-v1's rules,
counts and schedules. I printed no task lists. No look-2 or look-3 task content, no grade of any look, devCheck or test
task, and nothing under `beds/sealed` was read.

Disclosed exposures, none of them used in this plan:
- The look-2 task names that D25 and AMEND-1 §2.2 already list. These are names only.
- While listing branch commits, I saw three commit subjects that carry aggregates:
  - `b5c2e9b4`: the Opus reference arm on look 2, the same line PREREG-VL1 discloses;
  - `e801255f`: the SOP-Bench sealed primary;
  - `689b8aaa`: the OT-0 result.

v2.1 starts at look 3 under the plan's exposure rule in any case (§5).

---

## 0. The plan in twelve lines

1. **Only the hygiene and composition moves passed** (§1). Move 0 passed and has no kill line. COMP's $0 lines hold
   except one: default runtime2 is outside the frozen runtime's band in 3 of 36 cells. Move 8's fuzz line holds.
2. **The verification moves did not pass, measured honestly.**
   - Δ\* built from the readers' existing outputs is killed on every source: closure recall is 0–4 of 14.
   - The gate misses the mention clause and the duplicate bar for every source. Its RL2-sourced refusals are killed:
     13 false refusals.
   - The three-valued look bar is refuted: 0 of 360 runs are fully SUPPORTED.
   - The lab's validity kill fires, but that test is underpowered.
3. **One cause sits under the verification results.** No stored reader wrote an executable, correctly scoped rule. The
   decisive experiment is still the paid reader step **B1**: readers write predicates and SELECTs, at most $1.5 (§6).
   v2.1's verification layer is conditional on it.
4. **v2.1 = the look-2 winner as base + Δ\* (hidden from the actor) + commit gate + three-valued release, plus two
   actor-side changes.** These are an explicit effort and the VERIFIER-LAB §3.3 conventions, and each enters only if
   its look-2 exploratory arm (**C1**, **C2**) shows a gain. Everything that touches acting is measured before
   inclusion. Everything else only reports or refuses.
5. **The gate ships in admit mode for unexplained writes.** Hold mode would stop a write in 35–46 of 95 correct runs.
   Identity (K) refusals are always on. Prohibition (P) refusals are on only if B1 and the live gate step **B3** pass.
6. **Release = no FAILED and at least one obligation; no θ threshold.** Nothing certifies at this n, and the
   lab-calibrated threshold is 3.9× optimistic. Release is a reporting and product layer. With repairs off it cannot move
   strict pass.
7. **Information paths, not samples.** A signal enters a decision only with verdict κ ≤ 0.4 against what is already
   admitted. The actor's self-report never enters one. There is no judge in A1 mode, no Mercury, no same-prompt third
   reader, and no need router: the need router would cost v2.1 its only clean look.
8. **Merge order: b58-1 → b58-2 → b58-4 → b58-3, all four now** (§4). Together they touch no file any live experiment
   pins:
   - `lib/stats.mjs` is byte-identical to the P1 pin;
   - `jit/stats.mjs` resolves to main's own version;
   - `certify.mjs` is byte-identical to what DUR-1 will pin.

   The merges simulate clean in both orders tried.
9. **v2.1 waits for the A1-C v2 look-2 result** (and VL-1's). Its base, repair and selection choices depend on it.
   Under the plan's exposure rule that makes **look 3 (23 tasks, single look, α 0.05) v2.1's first and only plan
   look**, which has to be spent once, on a frozen v2.1.
10. **Look 3 decides the candidate, not a claim.**
    - Power of v2.1 vs A0 is 0.41–0.63.
    - Power of v2.1 vs its base is 0.02–0.04.
    - Claims need the sealed rerun or the test split after it.
11. **Paid path, all under D22.**
    - Expected about $10–13 against $21.5 of caps, Haiku only, 0 Mercury tokens.
    - The strict D22 pot after P1 is roughly $9–10, so the owner either tops it up or the steps run in the priority
      order of §6.
12. **Owner inputs** (§7):
    - the PREREG-AB-v1 amendment;
    - the budget;
    - the look-3 launch decision;
    - effort;
    - the κ metric;
    - the devCheck look;
    - a protocol ruling before tool-effect cards enter any harness.

---

## 1. Which moves passed their kill criteria

| Move | ATTACK line (§6) | Result (branch, evidence) | Verdict |
|---|---|---|---|
| 0 certify | hygiene; "Kill: none" | 89 tests (82 library + 7 re-score), all with teeth (8/8 and 6/6 mutants). CP(0/59) = 0.0495 ≤ 0.05 < CP(0/58); NP umbrella broke α in 3.4% of runs, the naive cutoff in 56.7%. Re-scores as ATTACK predicted: H-p1 non-evidential, H-cfx accepted in deterministic mode for the Opus patch only, H-rec rejected (invalid evaluator: 8/8 said pass, oracle 0/8). FH-1 H-C certifies 7/8 [0.47, 0.997]; H-0's own gate 8/8, certified 0/8 (b58-1) | **passed** (amendment drafts written, not filed) |
| 1 Δ\*, replay A (closure) | success ≥ 6/14 tasks, ≤ 5% false exclusion, ≤ 1 passing world flagged; kill < 4/14, > 10%, > 3 | a1c 0/14, m3 0/14, rl2 3/14 (4 of 54 matched passing worlds flagged), union 4/14 (4 flagged). On the primary source 91% of member votes are UNKNOWN. The scaffold, given the grader's own targets and values, reaches 13/14 (a ceiling, not capability) (b58-2) | **killed** on every source, on both counts |
| 1 Δ\*, replay B (derivation) | ≥ 5/7 tasks from reader-written predicates | Analyst-written SELECTs reach 5/7 certain and correct, but at most 2/7 avoid analyst-chosen dates, and no reader wrote them; 0/10 confident-wrong (b58-2) | **not evaluable at $0** |
| 2 gate, AutomationBench (replay C) | ≥ 6/12 mention breaks from ≥ 3 tasks; ≤ 1 false refusal; duplicates ≤ 2/60; kill > 1 false refusal | Mention breaks: rl2/union 5/12 from 3 tasks; a1c/m3 0/12. False refusals: rl2/union 13, in 6 of 95 passing worlds; a1c/m3 1 (exactly the bar) on five arms, 3 on six. Duplicates: worst arm 10 → 7 tasks. Hold mode: holds in 35–46/95 passing worlds. Certificates: about 90% witnessed by the world (b58-2) | **killed** for rl2 and union; **neither** for a1c and m3 on five arms (killed on six); success **not met** by any source |
| 2 runtime2, composition | M4b/M4d within the monolith band; fault-free unchanged; distinct-refunds mutant flagged; no C-H-T false positive | Band like for like: 36/36. **Frozen band: 33/36** for default runtime2 (holds with read-back, 18/18). Fault-free: 18/18 + 9/9 + 54/54 grading + 6/6 fresh. Distinct refunds: 12/12. C-H-T flagged 0/3 (C-H 3/3). Crash losses: frozen runtime 80, runtime2 19, read-back 0. 0 duplicates, but circular by construction (b58-3, runtime2 `cde405e3…`) | **passed except one line**. ATTACK's kill lines not evaluated (they need Δ\*) |
| 3 three-valued release | look bar: SUPPORTED precision ≥ 0.80 at coverage ≥ 25%, UNKNOWN ≤ 0.55; refuted below 15% coverage; kill if UNKNOWN is mostly unobservable | SUPPORTED 0/360 → **refuted**. UNKNOWN precision 0.534 (inside its bar). Release 176/360 at 0.534. Kill not triggered (bound: judged-only items are 20.4% of UNKNOWN). Leave-one-task-out certifies nothing at α 0.2/0.35; at α 0.5 its 11 releases all fail. Selection key ties R3 at 34/60 without a judge, by one task (b58-4) | **refuted, not killed** |
| 4 mutation lab | Spearman ≥ 0.5; Δ\* ≥ 0.85 kill at ≤ 0.10 false alarms where current checks < 0.5 | RL2 −0.03, T1 0.14, code-checks −0.26, pooled 0.36 (k = 6 classes; one 6-item class decides the sign). The Δ\* bar cannot discriminate: RL2 already kills 0.92 at 0/196. Closure twins flagged 0 times by every verifier. The grader passes 45% of intended-wrong edits (b58-4) | **kill fires, underpowered**. Lab kept as a regression, sensitivity and closure bench |
| 6 information paths | paid lines (VL-1, conventions, effort) | κ tables: RL2–Haiku judge 0.35, RL2–code-checks 0.33, judges 0.46–0.65, same-family readers 0.49–0.70; n_eff forks 2.12/6, readers 1.48/3. One effort dose measured: reader low → medium costs ×1.22 (b58-4) | **$0 part done; paid lines open** (VL-1 running; C1/C2 below) |
| 8 heal / COMP $0 | the fuzz gate finds the known crash | Sonnet patch rejected: 427 crashes, found and shrunk automatically. Haiku and Opus patches: 0 spurious over 4,328 inputs. Cards: 247/329 routes, 8/10 informative after two probe fixes. Patch collateral 0/354, against 3.6–10.9% for a rebuild (b58-3) | **passed ($0 line)**; paid cards arm not run |
| 5, 7 | — | only Move 5's pointer normalisation (resolved pointers: Haiku 91.8 → 99.2%, Mercury 62.4 → 100%) and Move 0's M1 negatives re-score (n_eff 6.3–7.1) | not run here |

**Reading.** Read together, the verification results say one thing. The verifier machinery is now built, tested and
honest: a fail-closed sandbox, a clock that cannot see the host, no list or code-induced rule counted as a rule, soft
checks never counted as passes, and certificates checked against the world. What it lacks is input: the stored readers
list candidates, so they produce no rule code can execute over a universe.

The remaining hard exclusions rest on verbatim quotes, and the precision failures are **scope** errors: a disposition
valid for one obligation is applied to another effect. ATTACK's RC1 thesis (derivation, not extraction or enforcement,
is the gap) is neither confirmed nor refuted by these replays, because none of them tests a reader asked for
predicates. B1 is that test. Its result, not this plan's preferences, decides whether Δ\* gates anything in v2.1.

Two thresholds disagree and are resolved here. VL-1's frozen rule says that if selection works, "RL2 becomes the
commit-gate signal for A1-C v2.1" (PREREG-VL1 §9). Replay C killed RL2-sourced prohibition refusals on dev60: 13
false refusals, all scope errors. The later, measured kill governs the deployable gate, so RL2 reaches the gate only
through Δ\*'s scope-corrected compile, if B1 passes. VL-1's result governs A1F selection.

---

## 2. What goes into harness v3 (A1-C v2.1)

### 2.0 Shape and the attribution rule

**Base.** v2.1 is built on v2, unless P1's H2 finds v1 ahead (p < 0.05). In that case the look-2 rows are root-caused
before the base is chosen; v2.1 starts at look 3 either way, so reading them costs no look. A v1 base keeps its repair
loop only with K on (VERIFIER-LAB §6 M3). New files under `experiments/autobench/harness/v3/` wrap the base pipeline,
which is imported unchanged.

Each change belongs to one of two kinds:
- **Acting changes**, which can move strict pass: an explicit effort, the §2.5 conventions in the brief and ledger, and
  gate refusals. Each is measured before inclusion: C1, C2 on look 2, and B3 on dev60.
- **Verification changes**, which only report or refuse: Δ\*, the verdict and certificates. The actor never sees them.

This keeps a 23-task look interpretable: if v2.1 differs from its base, the cause is one of at most three measured
acting changes.

### 2.1 Δ\* acceptance (requirement-ledger-v3; conditional on B1)

- **Code (exists, b58-2):** in `experiments/autobench/verifier/requirement-ledger-v3/`:
  - `universe.mjs`: enumeration from the harness's own **inventory**, never prep's full world, which H2 forbids inside
    A1;
  - `pointers.mjs`;
  - `sqlsafe.mjs` (`rl3-sql-v2`): a child process, deny-by-default `setAuthorizer`, the host clock refused, 8 MiB
    file cap;
  - `clock.mjs` (`rl3-clock-v2`): today from the request date, else the latest past-event date of the work items, else
    a weak business date, else a labelled null;
  - `dstar.mjs` (`dstar-v1.1`), `evaluate.mjs`, `check.mjs`.
- **New for B1 ($0 build, frozen before the paid step):**
  - `extract-v3.mjs` plus a strict JSON schema. Per obligation, the reader emits `diff_type`, a universe pointer, a
    **predicate over attributes** or a verbatim rule quote, an expected count, content literals with their grounding
    quote, a SELECT for each derived figure, and its unknowns. It emits never a candidate list.
  - Haiku 5.5 at an explicit effort (RL2's `low`: medium cost 2.7× and scored worse, VERIFIER-LAB §7), with a
    completion cap, recorded in the manifest.
  - Readers by **question**, not seed: obligations, and violating scenarios (the complement). A third reader (platform
    zone) runs only where those two disagree on an obligation's disposition.
- **Two pre-run code changes, written into the B1 preregistration before any B1 output exists.** Both were found on the
  dev60 replays, so they are in-sample (D21):
  1. *Scope:* a disposition binds only the effects of the obligation that disposed it. It never spreads to another
     obligation through an item label (the RL2 adapter's `labelHit`, all 11 flagged passing worlds).
  2. *Literal basis:* a content literal is hard only when it is grounded in the request or named by a quoted rule.
     "Grounded in some record" stays soft and goes on the UNKNOWN list. On a1c, record-grounded literals failed on 14
     passing vs 54 failing worlds, and passing worlds with any failing hard check doubled from 15 to 30.
- **Use in v2.1 if B1 passes:**
  - hard prohibitions feed the gate's P refusals (§2.2);
  - every obligation feeds the verdict (§2.3);
  - the UNKNOWN list is the assumption list.
- **Use if B1 lands between its lines:** Δ\* runs in **shadow**, logged per task and never gating.
- **Use if B1 is killed:** Δ\* is dropped from v2.1, and §8 applies.
- **Never:** Δ\* in the actor's brief. The actor's own ledger, the base's, drives acting. Δ\* is an independent
  information path, and showing it to the actor would make it a primed check (ATTACK RC3; reframing 2).

### 2.2 The commit gate (`harness/v3/gate.mjs` `v3-gate-v2` + `registry.mjs` identity v2; exists, b58-2)

The gate is a pre-write hook at the base's tool layer: v2's `tool-gated.mjs` site, with v2's own lint left off as
frozen. It is a pure function of (Δ\*, registry, call) and never reads the actor's plan or self-report.

| Clause | v2.1 setting | Why |
|---|---|---|
| **K: entity identity** | **on**. A write whose entity key is already committed is refused, and the actor is told the effect exists and to read it back if unsure. A failed write releases its key | Duplicates 10 → 7 tasks in the worst dev60 arm. Different-content refusals: 1 in 95 passing worlds on five arms (at the bar). The grader passes a repeated send 80/80, so K is harm reduction and cannot raise strict pass; B3 and look 3 must show it does not lower it |
| **P: hard prohibition** | **on only if B1 and B3 pass**, else shadow. Message-mention and recipient bans are refused at the call; sheet-row bans are listed `unverified`, never enforced | rl2/union P refusals are killed by scope errors; the scaffold reaches 12/12 mention breaks, so the call-level rule works when the dispositions are right |
| **O: unexplained write** | **admit and log as UNKNOWN** (`unexplained-effect`). **Hold mode is not used** in unattended benchmark runs | Holds in 35–46 of 95 passing worlds. Unexplained writes sit in passing worlds at the base rate (40.0% vs 39.1%), so they carry no signal. In the product, a hold becomes a question to the user |
| **Fail-closed** | Undecodable writes, unparseable arguments and a body without a method are held. For a tool outside the tool set, the gate returns the tool layer's own error | 158 such calls in replay; the 150 unknown-tool calls only echoed their own name. B3 checks that live behaviour is unchanged |
| **Certificates** | Every admitted write carries (effect, the Δ\* items it discharges, a read-back spec). `witnessHolds` is checked at end of run against the world's diff, reporting only | about 90% witnessed on dev60. The rest are exactly the claims a certificate exists to catch |
| **Read-back before re-send** | new `harness/v3/readback.mjs` ($0 build, **shadow** in B3). Before admitting a re-emission whose earlier attempt failed or is unconfirmed, read the entity through the official tools. Enabled only if B3 shows fewer duplicates with no step-limit loss | the AutomationBench analogue of runtime2's `reconcile` (crash losses 80 → 19 → 0 on E8). It costs world steps against the 49-step limit |

### 2.3 Three-valued release (D28 (1); `verifier/tristate/verdict.mjs` tristate-v2 definitions; exists, b58-4)

Each obligation gets one of three verdicts:
- **SUPPORTED:** a code- or diff-decided check of an *established* obligation passed. Established means hard, by
  consensus or executed predicate.
- **FAILED:** such a check failed, or nothing changed.
- **UNKNOWN:** any of
  - a model verdict (never consumed);
  - the actor's own checker (never consumed);
  - an undecided check;
  - a check of an unestablished obligation, *whether it passed or failed*;
  - a labelled null (clock);
  - an unexplained effect;
  - a duplicate effect.

**Release** = no FAILED and at least one obligation; an empty verdict is held as vacuous. There is **no θ threshold**.
Leave-one-task-out certifies nothing at α 0.2/0.35, and the lab's α 0.2 threshold is 3.95× optimistic on real rows
(2.26× from the base rate, 1.75× from the miss rate). Thresholds are set only from look labels, after look 3, by
Learn-then-Test on n_eff (`certify.mjs`).

Repairs stay **off**, as in v2 (`maxRounds` 0), so the verdict cannot change the world. Targeted repair returns only
if all of the following hold:
- VL-1R passes its frozen rule: gains above breaks against the regrade control, and HP-check precision on picks ≥ 0.7;
- K is on;
- the repair consumes only FAILED items with expected values (the syndrome);
- it is one round and additive.

Reported per run: strict pass (the plan's headline), coverage (the share released), release precision, SUPPORTED
coverage and precision against ATTACK's look bar, and UNKNOWN counts by kind. Each comes with n_eff and the ceiling
column (`certify.headlineRow`). The ceiling column comes from a look-3 ceiling audit made after grades are read and kept
out of every model context.

### 2.4 The information-path rule (`experiments/lib/infopath.mjs` `admissionWalk`; exists, b58-4)

- **Admission.** A reader, check, judge or fork enters a release, selection, gate or repair decision only with a
  measured κ against the signals already admitted.
  - The decision of record is verdict κ ≤ 0.4. The metric is always named and never defaulted. Moving the bar onto error
    κ is an owner decision (§7).
  - Self-reports and near-constant signals are excluded by rule.
  - n_eff is reported beside every aggregate.
- **Admitted in v2.1 (A1):**
  - Δ\* (or nothing, per B1);
  - clock-blind code-checks v1.1 as a free FAILED veto: κ 0.33 with RL2, fragile; reject precision 0.93.
- **Not admitted:**
  - the base's own checks (self-report; κ 0.04 with RL2);
  - any judge in A1 mode;
  - Sonnet and Mercury judges anywhere (κ 0.65 and 0.46 with the Haiku judge);
  - same-prompt readers as independent votes.
- **Readers.** B1 measures κ between the two question-diverse readers. The second reader is kept iff its κ with the
  first is ≤ 0.4 **or** it removes at least half of the first's false exclusions on the matched set; that is a precision
  role, not a second vote. The third reader runs only on disagreement.
- **Models.** Haiku 5.5 only. No Mercury node: D28 (7) requires the allowance to be read first, and P1's two Mercury
  arms take D18 to about 16.8M of 20M tokens in the worst case. No Sonnet/Opus node.
- **A1F (forks) is not part of v2.1.** If VL-1 shows selection works (VL-1 − v1-M ≥ +3 with ≤ 2 losses), an optional
  exploratory look-3 arm may pair v2.1 with **one** differently built challenger (sonnet-a1). The pick uses the
  judge-free key (FAILED ↑, SUPPORTED ↓, UNKNOWN ↑), which tied R3 at 34/60 on dev60 by one task. The arm is labelled
  A1F and is never a headline.

### 2.5 Generic conventions (VERIFIER-LAB §3.3, under D21)

Entered only if **C2** shows a gain (§6). Each goes in the KNOWLEDGE block in its generic wording with "dev60
provenance, D21". v2's existing KNOWLEDGE lines are checked line by line, so nothing is listed twice.

- **Brief rules** (actor):
  - G1: copy the source's own labels verbatim, in the body too;
  - G3: back each aggregate with its source values;
  - G6: anchor "now" to the work items' dates (the same rule as the clock ruling, D28 (2));
  - G14: tag every amount with its period and check each conversion;
  - G4, G7, G9, G10, G11 as instructions as well.
- **Ledger rules** (the base's ledger prompt, in a new v3 copy; v2's file is untouched; also in Δ\*'s reader prompt so
  that the actor and Δ\* do not disagree by construction):
  - G5: preference fields are soft; fall back before rejecting;
  - G8: exclude records flagged unreliable;
  - G15: prefer the structured field and the newest direct statement.
- **Code checks** (the verdict's code-checks path; FAILED veto; reporting only while repairs are off):
  - G4: a summary names every item acted on;
  - G7: list destinations unfiltered and reuse a name match;
  - G9: set the skip-marker on processed items;
  - G10: save a work product as an attached note, never by overwriting a field;
  - G11: mark processed inbox items read.
- **Excluded:**
  - G12 (invents recipients);
  - G13 (a grader quirk);
  - G2 (fits exactly one soft defect; ATTACK §8.12).
- **Hygiene test:** the v3 sources hold no task name, grader check name, lab path or ceiling note. `rl3.test.mjs`'s
  pattern is extended to `harness/v3/`.

### 2.6 Effort, manifests and freezes

- Every model node's effort is set explicitly and recorded. `certify.checkManifest` throws `EffortMissingError` before
  any paid launch.
- The actor's effort is C1's winner. If C1 cannot run, it is `max`, per the owner's role table (OPERATING-PRINCIPLES §7),
  with the dose disclosed as unmeasured: `projectCost` refuses that projection. B1's and Δ\*'s readers stay at `low`.
- Effort is passed by CLI flag and recorded in the launch manifest (`codeownedConfig.effort`).
- `policy/models.json` is **not** edited. Two reasons:
  - D28 (8) defers policy edits until the frozen runs end;
  - the v1/v2 manifests embed the policy's model entries, and DUR-1's `FREEZE.json` pins the file.
- The manifest is the import closure, as in v1/v2: `manifestFiles()`, CLI pinned at 2.1.312 from the D32 binary
  (sha256 `4f4178ce…`).
- `run.mjs` gains the v3 registration on the v2.1 branch only.
  - v1 keeps running from tag `a1c-v1-look2`.
  - v2 runs from a new tag `a1c-v2-look2` at V2COMMIT, made before any v2.1 commit. It needs its own pin worktree, as
    v1 has, for its look-3 continuation.
- `sequential.mjs` for look 3 must be the plan-frozen file (sha256 `44d7e90f…`, as in both P1 checkouts). Main's
  `a5060762…` is a later WIP extension (commit `53d65fdf`: reference role, planned-look scan). Using it for look 3 is a
  deviation to decide and disclose first.

### 2.7 Files

| Path | State |
|---|---|
| `experiments/autobench/harness/v3/{gate,registry}.mjs`, `effects.json` | exist (b58-2) |
| `experiments/autobench/harness/v3/codeowned.mjs` (`codeowned-v3`, a1c-v2.1), `readback.mjs`, `knowledge.mjs`, `ledger-prompt-v3` | **new** |
| `experiments/autobench/verifier/requirement-ledger-v3/*` | exist (b58-2); `extract-v3.mjs` + schema **new** for B1 |
| `experiments/autobench/verifier/tristate/*`, `mutlab/*`, `kappa/*`; `experiments/lib/infopath.mjs` | exist (b58-4); `adapters.mjs` gains one Δ\* verifier function |
| `experiments/lib/certify.mjs`, `gauntlet.mjs` | exist (b58-1); **frozen on main from the merge** while DUR-1 runs (changes go into new files) |
| `experiments/autobench/run.mjs` | v2.1 branch only (registration); never edited where v1/v2 run |
| Frozen, untouched | harness v1 and v2 files, requirement-ledger-v2, `experiments/autobench/verifier/live/*`, `sequential.mjs` `44d7e90f`, SEQUENTIAL-PLAN-v1, PREREG-COMP1's 16 files, `policy/models.json` |

---

## 3. What not to build

**From ATTACK §8 (applies unchanged):**
1. No third same-prompt reader by default, no k = 3 same-pipeline forks, no more judges, no same-model N-version
   votes, and no debate or mixture-of-agents.
2. No "all checks pass" as a release or stop signal, no null or soft result mapped to pass, and no verifier-driven
   repair without K.
3. The model never enumerates candidates, does arithmetic, counts primitives or guesses an effort scalar.
4. No IR heal ops, and no one-run V3 passes as heal evidence. Heal replays stay blocked (the kit decision is deferred).
5. No text-difficulty routing, and **no need router in v2.1 at all**. ROUTER-1 used 3 look-3 request texts, so any arm
   using the router, its labels or its thresholds counts as developed on look 3 (AMEND-1 §2.2) and would have no clean
   look left.
6. No case-pooled K = 3 composed-vs-monolith tests, and no model-written exactly-once machinery: identity is the
   registry's.
7. No Mercury spend before the allowance is read, and no Mercury call without effort, cap and schema. v2.1 is Haiku
   only.
8. No paid arm with effort unset.
9. No Chao-style completeness claims, and no extraction-model tier-up.
10. No gating on the pipeline's own uncertainty flags, and no lexical relevance filtering of inventories.
11. No dev60 in-sample number as progress, and no headline without the reachable-subset column.
12. No G12/G13-style conventions (nor G2), and duplicates count.

**From the measured results (new):**
13. No hold mode for unexplained writes in an unattended run (35–46/95 correct runs held).
14. No release threshold θ from the mutation lab (3.95× optimistic) or from LOTO at this n (it certifies nothing).
15. No record-grounded content literal as a hard check, no code-induced rule as hard (basis `induced` stays soft), and
    no disposition applied outside its obligation.
16. No Δ\* or verifier checks in the actor's brief, and no self-report in any decision.
17. No tool-effect cards in any brief before the owner's protocol ruling (§7). They are mined from the environment's
    implementation on a scratch world. That is a protocol question under PREREG-AB-v1 H2/H8, and the paid cards arm
    (≤ $3) is not run.
18. No Haiku judge as an accept/reject classifier (recall about 0.5), and no learned selector as a verifier (at chance
    on the best arm).
19. No reliance on SQLite's in-memory heap limit: this build ignores it (110 MB used under a 4 MB limit). The file-size
    cap is the boundary.
20. No edits to `run.mjs` or `sequential.mjs` where v1/v2 run, to requirement-ledger-v2, or to any harness v1/v2 file.
21. No pointer normalisation in the actor's ledger in v2.1. It is unmeasured on acting and is a v2.2 candidate. It stays
    inside Δ\*.

---

## 4. Merge order of the four branches into main

**Pins checked.** I collected every pin of the live experiments:
- the A1-C v1 and v2 manifests: the `manifestFiles()` import closure, computed in the two P1 checkouts, 24 and 33
  files;
- RL2-FROZEN and VL1-FROZEN `SHA256SUMS`;
- FREEZE-p2's paths;
- the paths PREREG-OT0 and AMEND-1 name;
- PREREG-DUR-1's F-B list;
- P1's shared files (`sequential.mjs`, `lib/stats.mjs`).

I intersected these with every file the four branches change, relative to their base `d13c338e`, which is on main. All
branch files are additions except `experiments/lib/stats.mjs` and `experiments/jit/stats.mjs`.

| File | Pinned by | Effect of merging |
|---|---|---|
| `experiments/lib/stats.mjs` | P1 (sha256 `94c94d3e…`, "identical in both checkouts"); DUR-1 (by reference) | **none**: byte-identical on main, all four branches, the pin and the v2 branch |
| `experiments/jit/stats.mjs` | DUR-1 (`ENV_FAULT_LIMIT`, line 45) | **none**: the branches carry the stats branch's version, which main already contains; the merge keeps main's newer version (sha256 `8f349332…`) |
| `experiments/lib/certify.mjs`, `gauntlet.mjs` | DUR-1 F-B: "main's, or the copies from `d3bd7acf`" | **none**: byte-identical to the DUR-1 branch's copy (sha256 `88bbff67…`, `a32ac23f…`); merging first lets DUR-1 pin main's |
| `experiments/lib/*` (new: certify, gauntlet, infopath, difffuzz) | PREREG-NEED-V1's engine stamp hashes the whole `experiments/lib` tree (`prereg-check.mjs:572`) | a future need-router label stage must re-stamp; not live, and the label factory is on the stop list |
| `experiments/autobench/harness/v3/*` | v1/v2 manifests are import closures; neither lists a v3 file | none |

**Simulation** (`git merge-tree --write-tree`, no ref moved):
- b58-1 → b58-2 → b58-3 → b58-4 merges clean at every step, as does b58-1 → b58-2 → b58-4 → b58-3.
- On top of either result, the DUR-1 branch (`worktree-wf_bd674a6e-71f-11`) still merges clean.
- The P1 branches (`worktree-wf_3674d3bc-0a7-12`, `a1c-v1-pin-look2`) conflict with main in `sequential.mjs` (add/add)
  **with or without** the four. That conflict exists already, from main's WIP `53d65fdf`. It must be resolved for the
  frozen `44d7e90f` when P1 merges after it ends.

**Order** (all four can merge now, because none touches a live pin):
1. **b58-1 (Move 0)** first and soon. Everything else builds on it, and DUR-1's F-B freeze prefers main's `certify.mjs`.
   From then until DUR-1 ends, `certify.mjs`, `gauntlet.mjs` and the stats files are frozen on main.
2. **b58-2 (Δ\*, gate, replays).** The v2.1 core.
3. **b58-4 (tri-state, lab, κ, effort cost).** The v2.1 verdict and the info-path rule.
4. **b58-3 (runtime2, Move 8).** The COMP-2 track. It is a harness version D28 (3) approved. It touches none of
   PREREG-COMP1's 16 files, and none of DUR-1's `experiments/compose/capabilities.mjs`.

At each merge, re-run every suite of that branch on the merged tree, one file at a time (`nice -n 15 node --test
--test-concurrency=1`):
- b58-1: 46 + 20 + 7 + 7 + 9 tests;
- b58-2: 32 + 10 + 6 + 9;
- b58-4: 18 + 17 + 3 + 7 + 5;
- b58-3: 27 + 5 + 4 + 5 + 1.

Commit the merge only if they all pass. The live branches (P1, VL-1's results, DUR-1) merge only after their
experiments end.

---

## 5. The next preregistered look

### 5.1 Wait for look 2: yes

v2.1 should not be frozen or launched until the A1-C v2 P1 analysis and VL-1's scoring are in, for three reasons:

1. **Design dependence.** The base lineage (v2 vs v1, H2), whether repair returns (VL-1R), whether selection is a mode
   (VL-1) and v2's duplicate rate with repairs off (its harm totals) are all inputs v2.1 needs. None can be measured
   on dev60 without in-sample bias.
2. **The plan's rules make look 3 v2.1's only look either way.**
   - AMEND-1 §2.2: "an arm developed, tuned or probed on any task of a look starts at the first look after it."
   - Every A1-C variant is dev60-developed, so it starts at look 2 at the earliest. v2.1 can have first look 2 only if
     it is frozen blind to every look-2 result.
   - That blindness is infeasible: v2.1's mechanisms are not validated (B1 and B3 come first), and P1's results will be
     read long before then.
   - It is also unenforceable: this program has two recorded look-2 slips (P1 §12.1–12.2).
   - So v2.1 is **first look 3**: one look of 23 tasks at nominal two-sided α 0.0500. Look 3 is the plan's last look,
     and after it the plan has no clean task left. It must be spent once, on a frozen v2.1.
3. **Operations.**
   - Any new run naming a look-2 task stops the P1 chain at exit 7 until a decision names it (P1 §12.11), so C1 and C2
     wait for P1's end anyway.
   - If v2 does not cross at look 2, the plan continues v2 to look 3 "under a separate launch decision" (P1 §10.1).
     v2.1 can then share that look's A0 control and CLI.

What can proceed now, blind to look 2: the merges, every $0 build in §6, and B1 (dev60 only, ledger only, a few
hundred Haiku calls). B1 waits only if the owner wants no contention with P1 for the session limit.

### 5.2 How the plan's rules apply to v2.1 on look 3

- **Launch.** Each run starts through `sequential.mjs look 3 --plan SEQUENTIAL-PLAN-v1.json` (plan `3cd586bd…`), using
  `sequential.mjs` `44d7e90f` with the sidecar written before `run.mjs` starts. The runs, in one chain at the pinned
  CLI 2.1.312:
  - A0: `--role control --arm A0`, run id `a0-look3`. It runs once on look 3, shared by every comparison.
  - v2.1: `--role treatment --arm 'A1-C v2.1' --first-look 3`, run id `a1c-v21-look3`.
  - v2, the plan's continuation if v2 did not stop at look 2: `--role treatment --arm 'A1-C v2' --first-look 2`, its
    cumulative look 3 at nominal 0.0443. If v2 stopped at look 2, it still runs on look 3, reported descriptively, so
    that v2.1 − v2 is paired. The frozen `sequential.mjs` has only the control and treatment roles; the `reference`
    role exists only in main's newer file, so how this run is labelled is part of the deviation decision of §2.6.
- **No contact before the look.** No task of look 3 is touched before that chain: no smoke, no probe. The $0 rehearsal
  uses dev60 with scripted sessions, and the exposure scan must find no look-3 task in any run record.
- **H1 (the plan's test for v2.1):**
  - strict pass, exact two-sided McNemar at 0.05, with an effect requiring a difference of ≥ 3 points;
  - partial credit is tested once at 0.05 **only** if strict pass is rejected;
  - partial credit alone decides nothing;
  - harm (the control ahead) is reported first.
- **Two comparisons, one control.** v2's continuation and v2.1 are separate comparisons sharing A0's look-3 rows. Each is
  at its own α by the plan. Holm-adjusted p-values are printed beside them (descriptive).
- **H2 (development, outside the plan's α):** v2.1 vs its base, exact McNemar, point estimate and Wilson intervals.
  Never read as v2.1 ≥ base when unresolved.
- **Candidate gate.** The rule for whether v2.1 replaces its base as the candidate for the one-shot test run, PREREG-AB-v1
  §6, is never a claim. It holds if all of the following hold:
  - v2.1 − base ≥ +2 tasks, paired;
  - partial credit ≥ −0.01;
  - harm totals (duplicates, guardrail breaks) ≤ base's;
  - content-level guardrail breaks ≤ A0's;
  - cost per task ≤ 2× base's;
  - hygiene scans (L1/L4/L5) clean.
  - Under no effect, "+2" passes by chance often at n = 23, which is why it is a gate, not evidence.
- **Disclosed exposure carried by the lineage:** the overfit critic's aggregates over a 91-task pool that holds all 23
  look-3 tasks (P1 §12.1). It covers all 23 tasks, so no drop-set sensitivity analysis exists; it is disclosed in
  v2.1's prereg.

### 5.3 What look 3 can and cannot show (exact enumeration, the plan's test, $0)

Power of v2.1 vs A0 at n = 23, α 0.05, with the ≥ 3-point floor:

| Discordance assumed (per task) | n = 23 at α 0.05 | n = 60 at α 0.018 (for scale: look 2) |
|---|---|---|
| v2.1-only 0.38, A0-only 0.05 (dev60: best arm vs raw Haiku, 23 vs 3) | **0.63** | 0.97 |
| v2.1-only 0.30, A0-only 0.05 | 0.41 | 0.83 |
| v2.1-only 0.25, A0-only 0.05 | 0.26 | 0.64 |

For v2.1 vs its base, a true gain the size of +3 to +5 tasks per 60 (discordance 0.15/0.10 to 0.17/0.08) has power
**0.02–0.04** at n = 23.

So look 3 can at best confirm "v2.1 beats raw Haiku", about as likely as not. It cannot show that v2.1 beats v2 or
v1, and it cannot support an Opus parity statement: VERIFIER-LAB §4.3 already calls 23 tasks too small. The
attributable evidence for each acting change comes from C1 and C2 (paired, 60 tasks, look 2). The claim route after
look 3 is the sealed rerun or test-split run, an owner decision (§7).

**Honest prior for v2.1 over its base.**
- Strict pass: 0 to +2 of 23.
  - K cannot raise strict pass, and the verdict does not touch the world.
  - P helps only if B1 passes.
  - Conventions and effort are each worth what C1 and C2 measure.
- Most of v2.1's value is harm reduction (duplicates) and honest abstention (the assumption list). That matches the
  owner's product bar, not the benchmark's headline.

---

## 6. Steps, gates and the paid budget

| Step | When | What | Gate to the next step | Cap (expected) | Pot |
|---|---|---|---|---|---|
| M | now | merge b58-1, 2, 4, 3 (§4); re-run suites | all suites pass | $0 | — |
| A0 ($0 builds) | now | `extract-v3.mjs` + schema; `harness/v3/codeowned.mjs`, `readback.mjs`, `knowledge.mjs`; spec mutants (Move 4's design: perturb the rule reading, not the trajectory); one Δ\* verifier function in `tristate/adapters.mjs` and `mutlab/verify.mjs`; scripted end-to-end rehearsal on dev60; tests with teeth (mutants of every new module) | rehearsal passes; hygiene clean | $0 | — |
| B1 | after its prereg (PREREG-DSTAR-R1) is frozen | Δ\* reader step: 60 dev60 tasks, Haiku, ledger only, inventory input, clock-blind, question-diverse readers, strict schema, explicit effort. Scored by the committed replays A–C (matched controls as frozen in b58-2) plus the lab's closure twins and spec mutants | **success:** ≥ 6/14 tasks, no task over 30% of the numerator; false exclusion ≤ 5%; ≤ 1 of 54 matched passing worlds flagged; ≥ 5/7 derived tasks from reader SELECTs; confident-wrong ≤ 5%; ≥ 6/12 mention breaks from ≥ 3 tasks with ≤ 1 false refusal over 95 passing worlds; decoy_touched flagged > 0 with 0 stability-twin flips. **Kill:** < 4/14, or false exclusion > 10%, or > 3 matched flagged, or > 1 false refusal. Between the two: shadow | $1.5 ($0.8–1.2) | D22 |
| B3 | after P1 ends; only if B1 succeeds (else K-only, B3 skipped) | live gate on 14 broken-guardrail + 14 matched control dev60 tasks: base + gate (K + P) + read-back shadow, Haiku | ≤ 1 false refusal over the passing controls; guardrail breaks on the 14 below the stored base rows; control strict pass not lower (paired); fewer duplicates | $2 (~$1.1) | D22 |
| C1 | after P1 and VL-1 end, plus a decision record naming the run (P1 §12.11) | effort arm on look 2: base at `--effort max`, Haiku, paired with the base's stored look-2 rows; exploratory, first look 2, reuses A0 | ATTACK Move 6: `max` ≥ +3 at ≤ 2× cost → v2.1's actor at `max`; saturated → `max` dropped for the cheaper level the owner names | $6 ($2–4.5) | D22 |
| C2 | as C1 | conventions arm on look 2: base + §2.5 brief and ledger rules, Haiku, paired | gain ≥ +2 tasks net (ATTACK's conventions kill below +2) → conventions in v2.1; else out, negative recorded | $4 (~$2.2) | D22 |
| F | after B1/B3/C1/C2 | assemble v2.1; $0 rehearsal; freeze PREREG-A1CV21-L3: manifest hash at CLI 2.1.312, every rule of §5.2, the ceiling-audit procedure, the verdict metrics; tag `a1c-v2-look2` | owner's look-3 launch decision | $0 | — |
| L3 | after F | look-3 chain: A0, v2.1, v2 (continuation or reference); optional A1F arm (§2.4) if VL-1 selection works | the plan's analysis; candidate gate (§5.2) | $8 ($3–4) + A1F $4 | D22 |
| Opus on look 3 (optional) | with L3 | reference arm, same flags as D26, for a paired cost comparison only; not a claim at n = 23 | — | $12 (~$9.4 at dev60's $0.407/task) | D19 |

**Totals (D22):**
- caps $21.5 without the optional A1F arm, $25.5 with it;
- expected about $10–13;
- Mercury 0 tokens.

**The pot.** Under P1's strict reading, D22_LEFT was $17.74 for the P1 chain, which expects about $8. That leaves
roughly $9–10, to be recomputed from settled records when P1 and VL-1 end, since VL-1's RL2, judge and VL-1R lines also
draw on D22. Either the owner tops D22 up by $15, or the steps run in this order within what is left:
1. B1;
2. L3 (reserved first, since it is the look);
3. C2;
4. C1;
5. B3 (only if B1 succeeds).

Not funded by this plan:
- judge arms on mutants (judges are refused by κ);
- RL2 clock-blind re-extraction (folded into B1);
- the paid cards arm (needs the protocol ruling);
- the Opus × conventions 2×2 (D19's money; it needs the conventions result first);
- any Mercury pilot.

---

## 7. Owner inputs still needed

1. **The PREREG-AB-v1 amendment** (D28 (1), (4)), filed before L3:
   - per-obligation SUPPORTED / FAILED / UNKNOWN with the tristate-v2 definitions (§2.3);
   - release = no FAILED and at least one obligation;
   - coverage and release precision beside strict pass;
   - the reachable-subset column from a post-grade ceiling audit;
   - n_eff;
   - effort required at launch (`checkManifest`).

   Draft text: MOVE0-CERTIFY §6 item 1, refined by MOVE3-4-6-LAB §2.1. The frozen look-2 runs are unchanged.
2. **Budget:** D22 + $15, or the broader reading. Under D22's own wording ($60 + $40) at least $44 remains.
   Otherwise the priority order of §6 applies.
3. **The look-3 launch decision** (P1 §10.1): one chain at the pinned CLI with A0, v2.1 and v2. Also:
   - whether v2's continuation waits for v2.1 (shared A0, same CLI; my recommendation) or runs first, with v2.1
     reusing A0's stored look-3 rows at the same pinned CLI;
   - the optional Opus reference (D19);
   - the `sequential.mjs` file for look 3 (§2.6).
4. **Effort:** accept C1's result as binding for v2.1's actor, or rule `max` now (role table) and skip C1.
5. **κ metric:** keep verdict κ ≤ 0.4 (the decision of record) or re-anchor the bar on error κ. Error κ is the better
   redundancy measure, but ATTACK set the bar on verdict κ. This governs reader 2 in B1.
6. **The last devCheck look:** P1 §10.4 reserves it for v2 if v2 passes its gate. If v2 fails, may v2.1 take it, and on
   which gate?
7. **Protocol ruling on tool-effect cards** (H2/H8). Until then they enter no harness, and the paid cards arm does not
   run.
8. **Mercury:** the allowance reading (D28 (7)). This is not needed for v2.1, which is Haiku only, but is needed before
   any v2.1-M.
9. **Policy-file edits** (D28 (8)): only after P1 **and DUR-1** end, because DUR-1's F-B pins `policy/models.json`.
   v2.1 does not need them.
10. **After look 3:** whether to spend the test split (PREREG-AB-v1 §6: A0 + the A1 candidate, once, $40 cap) or
    the testRef rerun (§12) on the surviving candidate. This is the only route to a claim, frontier parity included.

These belong to other tracks but follow from the same results:
- read-back as runtime2's default and keyed start B6 with its SPEC-E bump (COMP-2);
- the heal-kit decision;
- the PREREG-NEED-V1 C7c filing;
- the PREREG-COMP1 build-level amendment.

---

## 8. If B1 is killed

Then predicate-writing Haiku readers do not supply executable, correctly scoped rules either. RC1 survives only as a
statement about what a correct derivation would need: the scaffold reaches 13/14. The two cheapest information paths
that no sample can buy come next:

1. **Spec mutants as the probe** ($0, built in A0): perturb the rule reading (swap an inclusion threshold, drop an
   exclusion clause, flip a status) and measure which verifier notices. This is the distribution the lab's validity
   check pointed to. Real misses are shared misreads, not broken trajectories.
2. **A reader from a different information path**, not a different seed:
   - a code-only reader (the structural prior, zone ∪ cue, reached 80/83 E8 units with no model);
   - or the distinguishing-member question to the user, in the product.

   Either is admitted only by the κ rule.

v2.1 then ships as base + K gate + three-valued reporting over code-checks, plus whatever C1 and C2 support. Its
verdict will mostly abstain, which is the honest output at this n (MOVE3-4-6-LAB §0.5), and the negative result goes to
`docs/RESEARCH.md` with the same prominence as a positive one.

---

## 9. Reproduce and sources

- Branch results:
  - `MOVE0-CERTIFY.md` (b58-1 `d3bd7acf`);
  - `MOVE1-2-AB.md` §0, §2–§4, §10 (b58-2 `3ab9a813`);
  - `MOVE2-COMP.md` §0, §4, §6, §8 (b58-3 `2343a561`);
  - `MOVE3-4-6-LAB.md` §0, §2–§5, §8 (b58-4 `b5099081`).
- Rules:
  - ATTACK.md §6, §8–§10;
  - D18–D34;
  - VERIFIER-LAB §3.3, §4.3, §6;
  - PREREG-AB-v1-AMEND-1 §2.2–§2.6;
  - PREREG-A1CV2-P1 §4, §6, §10, §12;
  - PREREG-VL1 §9;
  - PREREG-DUR-1 §13.1 (certification and F-B list);
  - SEQUENTIAL-PLAN-v1 (counts 60/60/23; schedules; nominal levels 0.0180/0.0443 and 0.0500).
- Merge check ($0), from the main tree. This writes only unreferenced commit objects, which gc removes:

  ```
  c=HEAD; for b in 1 2 4 3; do out=$(git merge-tree --write-tree $c worktree-wf_bba577b8-b58-$b) || echo "CONFLICT b58-$b";
    c=$(git commit-tree ${out%%$'\n'*} -p $(git rev-parse $c) -p worktree-wf_bba577b8-b58-$b -m sim); done
  for lb in worktree-wf_bd674a6e-71f-11 worktree-wf_3674d3bc-0a7-12 a1c-v1-pin-look2; do
    git merge-tree --write-tree --name-only $c $lb | sed -n '2,4p'; done   # then each live branch
  ```
- Pins: `manifestFiles()` evaluated read-only in `.claude/worktrees/a1c-v1-pin` (`harness/codeowned.mjs`) and
  `.claude/worktrees/wf_3674d3bc-0a7-12` (`harness/v2/codeowned.mjs`).
- Power: the exact enumeration over (v2.1-only, A0-only, concordant) counts at n tasks. A pair counts as rejected when
  the exact two-sided McNemar p is below α and the difference is at least 3 points. The p-values were checked equal to
  `experiments/lib/stats.mjs` `mcnemarExactCounts` on seven tables.
