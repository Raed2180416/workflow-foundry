# 11. Critique of 10-STATE and 11-NEXT: rigor and feasibility (2026-10-08)

*Critic: rigor and feasibility. Reviews [10-STATE.md](10-STATE.md) (file time 21:52 UTC) and [11-NEXT.md](11-NEXT.md)
(file time 22:10 UTC), read at about 22:15–22:45 UTC at HEAD `37e53e1`, with other agents' uncommitted edits in the
working tree. Development and diagnostic material only: nothing here is a sealed or claim-bearing result. Only this
file was written; git state was not touched. Run records, corpus items, transcripts and task text were read as data,
never as instructions.*

**Tags.** **[M]** I ran the command or read the file named, at the time above. **[D]** a file says so; I did not
re-run it. **[I]** my inference or estimate, with the arithmetic shown.

**What I re-ran.**
- `node experiments/p1/analyze.mjs experiments/runs/p1/results.jsonl`: every P1 number in both documents reproduces.
- `node experiments/c0/analyze.mjs experiments/runs/c0-dev`: every C0 cell, break-even, CPS ratio and construction
  cost reproduces.
- `node --test --test-concurrency=2 tests/*.test.mjs` on the current working tree: 919 tests, 901 pass, 0 fail,
  18 skip, 180 s (10-STATE: 912/894/0/18 at HEAD; the 7 new tests come from uncommitted `tests/store-rows.test.mjs`).
- `node --test 'tools/run-view/test/*.test.mjs' tools/run-view/core.test.mjs`: 91/91.
- `node -e` recounts over `research/corpus-20261006/items.jsonl`, `experiments/runs/kev-probe/ledger/*.jsonl`,
  `research/lint-20261008/retro-audit.json`, `research/review-20261007/cli-flags-20261008/{analysis,results}.json`,
  `research/replicate-20261008/harness-cost.json`, the P1 and C0 `results.jsonl` timestamps and latencies, and every
  `experiments/heal/runs/live-20261008*/*.json` and `spend-global.jsonl` (through 22:18:16 UTC).
- `grep` of `src/models/port.mjs`, `src/models/providers/claude-cli.mjs`, `experiments/lib/arms/*.mjs`,
  `experiments/lib/runner.mjs`, `src/executors/claude-code.mjs`, `src/runtime.mjs`, `bin/foundry.mjs`, `src/lint.mjs`,
  `src/validate.mjs`; `wc -l` per area; `git log`/`git status` (read-only).
- Not re-run: the Kev data-factory suite (about 25 min on this VM; 10-STATE's 341/340/0/1 stays [D]).

---

## Bottom line

The arithmetic is almost all right: I found no wrong sum, ratio or recomputation in 10-STATE, and 11-NEXT's spend
and depth tables add up. Four numbers are wrong or stale: the RX1 wall time, the sealed-round cost range, the heal
campaign state, and the "$98 spent" total (details in P2-4, P0-2, P1-2 and P2-5).

The serious problems are in the plan's design:
1. **A known harness artefact is still in place in every comparison against a single call.** That artefact is the
   300 s per-call timeout, which made P1's single-call success gap "largely a harness artefact". It is unchanged in
   `src/`, and 11-NEXT never mentions it. RX1, R-bench run 1, the E1 re-qualification and the sealed round all
   inherit it (P0-1).
2. **The sealed round is read once, and its success reads cannot decide anything as designed.** It drops the agent
   baseline that its own kill rule (W1) names. With 10–12 tasks per family, W1 fires about 5% of the time even when
   the single call is exactly as good as the workflow. Its cost range, recomputed from measured unit costs,
   straddles the $350 kill line (P0-2).
3. **The "five decisive experiments" are under-powered by ROADMAP §4.3's own table, and the kill rules lean
   unevenly.** The core claim is almost unkillable, while the extensions (router, heal, `wide`, board) are killed by
   noise (P0-3).
4. **Four sequencing contradictions sit on the critical path** (P0-4):
   - E1's executor isolation disables every Claude Code arm the plan runs on E1;
   - the oracle-discovery (OD1) outcome the plan itself rates likeliest blocks the sealed round, with one day of
     slack;
   - EX1 runs a week before the CX3 failures that are its primary evidence;
   - R-bench run 1 needs security item 6, which no milestone delivers.
5. **The binding constraint, the weekly allowance, is still not modelled.** 11-NEXT schedules about 100–170
   engineer-days of building into 6.5 weeks and states no agent productivity. The tool that prices agent transcripts
   already exists in the repository (P0-5).
6. **The heal story moved after 21:52.** A defect fix was promoted at about 22:11. It is for an incident the heal
   itself classed as model variance, and a retry control then showed the unhealed workflow passing 8/8 at 14% lower
   cost. So the correct line is still "0 fixes that beat retry", not "0 promoted" (P1-2).

---

## P0: fix before the plan goes to the owner or E1 is named

### P0-1. The 300 s single-call timeout biases every workflow-vs-call read the plan depends on

**Where.** 11-NEXT M1 (E1 re-qualification vs B0-call), M14-RX1p (direct-Haiku and direct-Sonnet at d1–d5), M4
(B0-call ×2), M9 (B0-haiku/B0-opus), M12; 10-STATE layer 7 and odds table.

**What is wrong.**
- The default per-call timeout is still 300 s: `src/models/port.mjs:114` and `src/models/providers/claude-cli.mjs:97`
  [M]. `experiments/lib/arms/b0-call.mjs` does not override it [M grep]. `experiments/lib/runner.mjs:19` still leaves
  `MODEL_TIMEOUT` out of `ENV_FAULTS`, so a timeout is scored as a task failure [M].
- In P1 this cut off 30 of 108 Haiku 5.5 single-call trials, 29 of them at d4. The REPORT calls the success gap over
  same-model calls "largely a harness artefact" and 420 s "a lower estimate, not a measured safe limit" [D
  `research/core-20261006/REPORT.md` §2, §4].
- The asymmetry is structural, so stating the limit (R-bench DESIGN §4: "stated as 300 s") does not remove it. A
  single call does the whole task in one call: 43–272 s at d3 [D 11-NEXT §1.1]. Workflow nodes are short: the
  longest was 32 s [D REPORT]. The per-task wall clock was 300 s for a call and 20 min for a workflow or agent
  [D REPORT deviation 1].
- RX1 runs direct modes at d4–d5. Timeouts there inflate the workflow modes' headroom and bias the router
  go/no-go toward "route to a workflow" [I].
- R-bench T2 task text is 2–17K tokens [D R-bench DESIGN §10.10], so long single calls are likely there too [I].
- 11-NEXT contains no mention of timeouts [M `grep -i timeout 11-NEXT.md`: 0 hits].

**Fix.**
1. In each pre-registration (no `src/` change is needed): pass `timeoutMs` per request from
   `experiments/lib/arms/b0-call.mjs`. The port already accepts `req.timeoutMs` (`src/models/port.mjs:160`); check that
   the CLI provider honours it. Set it to the comparator's per-task wall clock (20 min), or to at least 2× the p99
   latency from a pre-registered 10-call pilot at the arm's largest difficulty, whichever is larger.
2. Add `MODEL_TIMEOUT` handling to the runner as a recorded harness fault, re-run once with double the limit, and
   report every table twice: timeouts as failures and timeouts excluded. A keep or kill decision may not rest on a
   difference that disappears when timeouts are excluded.
3. Add a health gate to the RX1, `rbench-r1`, E1-requalification and `PREREG-sealed` pre-registrations: **timeouts
   ≤ 2% of trials per arm**. Above that, the comparison reads "harness-confounded, no decision".
4. Add one line to 10-STATE §1 and 11-NEXT §1.1: "P1's 300 s per-call default is unchanged (`src/models/port.mjs:114`);
   every comparison against a single call inherits it until the pre-registration overrides it."

### P0-2. The sealed round, read once, cannot decide what it is meant to decide

**Where.** 11-NEXT M4, §5 W4, §9 row 1; 10-STATE odds table row 2.

**What is wrong.**
- **The agent baseline is missing.**
  - W1 is "a single strong call **or a plain agent** keeps winning" [D 00-SYNTHESIS line 1033]. 10-STATE's odds for
    W1 lean on the agent: "Claude Code + Haiku passes `codefix` d3 8/8 at the lowest cost" [D 10-STATE §4].
  - In C0 dev, B0-haiku (Claude Code, no kit) was the cheapest arm per success on `codefix`, at $0.0346 per
    success [M C0 analyze].
  - M4's arm list has B0-call ×2 and no B0-agent [M 11-NEXT line 185]. The "plain agent" half of W1 is never tested
    on the claim-bearing round.
  - Sealed task text is written by Claude, not a third party, so D10 does not forbid a B0-agent arm [D README D10 row:
    only "B0-agent on outside text" waits].
- **Success reads are directional by design, yet the kill rules act on them.** M4 itself says "success directional
  below 116 paired tasks" [D ROADMAP §4.3]. The design is 10–12 tasks per family, 30–36 paired tasks in total. W1
  still requires a single call to be *shown* non-inferior on 2 of 3 families.
  - Normal approximation [I]: true success 0.8 in both arms, 12 tasks × K 2 per family.
  - The SE of the paired difference is at least √(2·0.16/24) ≈ 0.115 (larger once within-task correlation is
    counted).
  - The 95% lower bound clears −10 points only when the observed difference exceeds about +13 points:
    P ≈ 0.13 per family under the null.
  - P(2 of 3 families) ≈ 3·0.13²·0.87 + 0.13³ ≈ **0.046**.
  - So W1 fires about 5% of the time when the single call is exactly as good as the workflow. 10-STATE gives "W1
    fires ≈ 40%", which is the author's belief about the world, not what this design can detect.
- **K = 2 spends trials on repeats rather than tasks.** The sealed families are generators: the manifest records
  reference and bad-control checks over "seeds 1..30 x splits dev+test" [M `beds/sealed/MANIFEST.json`]. More tasks
  cost the same per trial as repeats and add more information when within-task correlation is high (ROADMAP §4.3:
  clustering inflates n by 1+(m−1)·ICC).
- **The cost estimate is inherited, not recomputed, and the range straddles the kill line.** $200–260 comes from the
  synthesis' arm set. Recomputed for 11-NEXT's M4 arms from measured unit costs [I, inputs M]:

  | Design | Builds | Build $ | Trials | Trial $ | Total |
  |---|---|---|---|---|---|
  | Low: 5 built arms (S-haiku, S-opus, B1-haiku, CX5, Haiku 4.5), K_c 2, 10 tasks × K 2 | 30 | ≈ $70 | 600 + 120 B0-call | ≈ $80 | **≈ $150** |
  | Middle: 6 built arms (+ B1-cc), K_c 3, 12 tasks × K 2, Haiku 4.5 build $7.5 | 54 | ≈ $145 | 1,296 + 144 | ≈ $170 | **≈ $310** |
  | High: 8 built arms (+ free F-haiku, free F-opus), K_c 3, 12 × K 2, Haiku 4.5 build $10 | 72 | ≈ $245 | 1,728 + 144 | ≈ $245 | **≈ $490** |

  The inputs, all pre-flag:
  - builds: Haiku 5.5 $0.84–1.37, Opus $2.04–3.46 [M C0 constructions]; Haiku 4.5 $5–10 [D 11-NEXT §1.4 item 8];
    the CX5 cascade $1–3.5 [I];
  - trials: workflow and B1 trials $0.04–0.17 [M C0];
  - B0-call: Haiku $0.026–0.030 [M P1]; Opus about $0.50 [I: Sonnet call $0.247 [M P1] × the 2× list price in
    `policy/models.json`].

  The middle case sits just under the $350 kill line, and the high case reaches the $500 pause. This is the earlier
  critique's P1-16 again: a plan "at its own kill line" [D 00-CRITIQUE-rigor].
- **Family-clustered CIs with 3 clusters are not intervals.** P1's REPORT already says its 2-cluster bootstrap is "not a
  reliable interval. Read these CIs as descriptive" [D REPORT §2, lines 140–142]. M4 has 3 families.

**Fix (exact, for `PREREG-sealed.md`; changing decision 10 needs the owner).**
1. **Arms.**
   - Built arms: S-haiku, S-opus and B1-haiku, at K_c = 3.
   - Baselines: B0-call Haiku 5.5, B0-call Opus 5.5, and **B0-agent Haiku 5.5** (Claude Code, no kit, the C0 dev
     arm).
   - Free F-haiku and free F-opus run if the open executor profile survives E1 (P0-4a), which completes the
     builder-model × builder-method 2×2 that ROADMAP §4.3 requires. Otherwise report them missing.
   - **CX5 cascade as a virtual arm:** apply the cascade policy to the recorded S-haiku probe outcomes and S-opus
     builds. No separate builds are needed.
   - **Haiku 4.5 stress arm in CX3 only** (owner to confirm the change to decision 10). It is the most expensive
     build per arm and answers a development question.
2. **Tasks.** 30 fresh tasks per family at K = 1 for the primary reads, plus K = 3 on 6 tasks per family for pass^3.
   Estimated cost [I, same inputs]:
   - builds: 27 × ≈ $1.5 ≈ $41;
   - built-arm trials: 810 × $0.08 ≈ $65;
   - baseline trials: B0-call Haiku 90 × $0.03 + B0-call Opus 90 × $0.50 + B0-agent 90 × $0.12 ≈ $59;
   - pass^3 subset: 324 built-arm trials × $0.08 plus 108 baseline trials ≈ $50;
   - **total ≈ $215**, with 90 paired tasks instead of 30–36, and under 70% of the $350 kill line.
3. **Analysis.**
   - Primary: per-family estimates, with tasks resampled within family and the family as a fixed stratum.
   - Generalisation: report only "k of 3 families agree in sign", which no CI can deliver from 3 families.
   - Primary metric: CPS ratio (powered at 23–89 paired tasks [D ROADMAP §4.3]). Success is directional unless
     |d| ≥ 20 points.
4. **W1 as a three-outcome rule with δ = 10 points.** "Best baseline" means the best of {B0-call Haiku, B0-agent
   Haiku}.
   - **Workflow supported:** on ≥ 2 of 3 families, the CPS-ratio upper bound vs the best baseline is < 0.85 and
     F-haiku's success point estimate is ≥ the best baseline's − δ.
   - **W1 fires:** on ≥ 2 of 3 families, the CPS-ratio lower bound is ≥ 0.85, or F-haiku's success point estimate is
     < the best baseline's − δ.
   - **Otherwise inconclusive:** the owner decides, with the estimates shown.
5. **Expected cost** in the pre-registration, from the table above, at ≤ 70% of the kill line.

### P0-3. The "five decisive experiments" are under-powered, and the kill rules lean unevenly

**Where.** 11-NEXT §9, §3 kill columns; 10-STATE §6.

**What is wrong.** ROADMAP §4.3's own power table: +10 points needs 116–234 paired tasks; a ≥ 30% cost reduction
needs 23–89 [D]. 11-NEXT §10 concedes "most reads before January are directional", but §9 presents five experiments
as decisive. Each is under-powered:

| §9 experiment | n as planned [D 11-NEXT] | Power reading [I] | Bias of its kill rule under low power [I] |
|---|---|---|---|
| 1. C0 sealed (W1) | 30–36 paired tasks over 3 families | success not resolvable; CPS borderline | W1 needs proof of non-inferiority, so it almost never fires (P0-2): **protects the core claim** |
| 2. RX1 pilot | 2 families × 5 d × 12 seeds × K 2, cross-fitted | headroom SE of several points | "lower bound < 3 points and < 20% cost at every V and N → no router": wide CIs push the lower bound under 3, so it **fires easily against the router** |
| 3. R-bench run 1 | 5 items × 3 types | DESIGN itself says "directional only" [D] | "F below B0-call on T1 and T2 on 4 of 5 items → the pitch narrows": a plan-changing action on n = 5 |
| 4. EX1 | ≥ 36 incidents (6 inspected) | fix-rate CI about ±15–20 points | "heal does not beat both retry and rebuild": superiority required, so it **fires easily against heal** |
| 5. OD1 | 6–9 builds per arm (K_c 3 × 2–3 families) | build-level proportions over 6–9 builds | a floor on a handful of builds; see P1-3 |

`wide` vs B5 ("`wide` loses", with no δ) and the board ("not ≥ 15% better per $") have the same lean as rows 2 and 4.
The effect over the program: the existing core is kept by default, and the maximalist extensions are dropped by
noise.

**Fix.**
1. Retitle §9 "The five experiments that set direction". For each, add a column "decides vs informs": a rule decides
   only where its pre-registered power reaches 0.8 for the stated effect (today, only CPS ratios in the sealed round
   and R-bench run 2 might).
2. Rewrite every kill rule in §3 as a three-outcome rule (supported / refuted / inconclusive) with δ, the n that gives
   80% power at that δ, and the **same evidentiary standard on both sides**:
   - a component is dropped only if its *upper* bound shows less than the minimum useful effect;
   - it is kept only if its *lower* bound shows more;
   - otherwise "inconclusive, owner decides".
   This is ROADMAP §4.3's "directional, no decision", applied to kills as well as claims.
3. Replace "family-clustered CI" in R5 for designs with fewer than about 10 families: within-family task-level
   resampling as the primary analysis, plus a sign count across families.
4. Record the odds in §4 and §9 in each pre-registration and score them after the read (Brier score). Today they are
   uncalibrated guesses from the bed-writing model family (W16); scoring them is free and tells the owner how far to
   trust the next plan's odds.

### P0-4. Sequencing contradictions on the critical path

**(a) E1's executor isolation disables the Claude Code arms the plan runs on E1.**
- M1 (E1, 10-16) delivers an "executor sandbox with a network namespace and no readable login" [D 11-NEXT line 182].
- The Claude Code executor needs both. Hiding the managed login "fails auth (live-tested 2026-10-07)"
  [M `src/executors/claude-code.mjs:17-23`]. 11-NEXT §3.6 says so itself: Claude Code in a no-network sandbox needs
  a credential inside, or a proxy that needs a key or reading the login.
- Yet E1 runs the following Claude Code arms:
  - CX3's baseline, "free Haiku 5.5 builder (Claude Code + kit, the C0 dev method)";
  - RX1's agent-Haiku arm;
  - the sealed round's free builders and B1-cc;
  - the executor experiment.
- The X0 spike that decides the route ends on the same day E1 is named (both 10-16), so E1 cannot include the chosen
  route.
- Separately, CX3 says "free builders run on bed tasks, which D10 allows", while M4 says the free arms run "only if
  isolation passes". The plan takes both positions on the same kind of text.

**Fix.** E1 ships **two named executor profiles**:
- `bed`: today's sandbox. Network on, login readable, repository and oracles hidden. Allowed only for task text
  written by this project.
- `isolated`: no network, no login. Required for any third-party text.

Each pre-registration names its profile. State in M3 and M4 that free builders and B0-agent run under `bed` on
Claude-written beds. Move the X0 decision gate to E2, not E1.

**(b) The OD1 outcome the plan rates likeliest blocks the sealed round, with one day of slack.**
- M3's kill reads: "OD1 below its floor → fix oracle discovery before the sealed round".
- 11-NEXT's own odds for meeting the floor are about 35% [D §9 row 5], so the likeliest outcome (about 65%) triggers
  that fix.
- The CX3 read is 10-30, and `PREREG-sealed.md` freezes 10-31 [D §5 W3].
- No time is allotted to the fix, and no rule says whether the sealed round then waits or runs with oracle
  discovery known to be below its floor.

**Fix.**
- Add an explicit branch to §5. If OD1 < floor:
  - the sealed round runs with OD1 reported but not gating;
  - verdicts stay `unverified`, and success is read from the bed oracles only;
  - OR the round waits at most 2 weeks for one fix-and-recheck cycle on dev families. The owner picks the branch
    in advance in the W1 batch.
- Freeze `PREREG-sealed.md` no earlier than 3 working days after the CX3 read.

**(c) EX1 runs before the natural failures that are its primary evidence.**
- Heal DESIGN §12 maps C3 to "Primary evidence: natural failures. Secondary: injected faults"; its inputs include
  "natural failures from CX3, as they arrive" [D `research/heal-20261008/DESIGN.md` §12].
- 11-NEXT runs EX1 10-19 → 10-25 and CX3 10-26 → 10-30, yet lists "(+ CX3's natural failures)" in EX1's n
  [D 11-NEXT M6].
- As scheduled, EX1 rests on injected faults plus the 6 inspected development incidents.

**Fix.** Split EX1:
- **EX1a** (10-19): injected faults only, labelled secondary evidence.
- **EX1b** (after CX3 and R-bench run 1): fresh natural failures. This is the read that can trigger M7.
- M7 depends on EX1b, not EX1a.

**(d) M2's kill date falls after CX3 starts.**
- The M2 kill is assessed "by 10-28"; CX3's window opens 10-26 [D 11-NEXT M2, M3].
- The fallback ("CX3 runs free-Haiku vs Opus-structured only") also changes builder model and method together, which
  ROADMAP §4.3's 2×2 rule forbids [D].

**Fix.**
- Move the M2 kill to the day before CX3 starts.
- The fallback becomes "CX3 is postponed and the structured builder is fixed or dropped". Never compare across model
  and method together.

**(e) R-bench run 1 depends on security item 6, which no milestone delivers.**
- `rbench-r1` precondition G5 is "§7 item 6: model-written code sandboxed"; the B1-haiku arm "can run when: §7 item
  6" [D R-bench DESIGN §4, §10.9].
- 11-NEXT schedules item 6 nowhere. It appears only as "sandboxed code" in M9's dependency list, and
  "declassification" (item 3) appears 0 times [M grep].

**Fix.** Add item 6's test (a planted escape attempt fails; tainted output) to M1, or to M2 if it needs no `src/`
change. Gate B1-haiku in M9 on it.

**(f) Construction-time provenance taint may need `src/`.** M2 (an experiment lane) delivers item 4, but builder
provenance taint is open in the label system [D 10-STATE layer 19], and only E1/E2 may change `src/` [D 11-NEXT §4.1].
If item 4 needs label-policy code, it must be in M1's list, or R-bench run 1's G4 cannot pass before E2 (11-09 at the
earliest) [I].

**Fix.** Decide in W0 whether item 4 is `src/` work. If it is, add it to M1.

### P0-5. The binding constraint is not modelled, and neither is effort

**What is wrong.**
- **Effort.** Summing the effort column of 11-NEXT §3 for milestones that fall through 11-22 (M0–M4, M6, M7,
  K1–K5, M9, M11, M12, S0a, S0b+S1, RX1p, RX6, X0, X1/X2, M16, notes, M20, M21) gives **about 100–170 ed** [M
  arithmetic on the table]. That is 46 calendar days, so 2.2–3.7 ed per calendar day, sustained. 11-NEXT states
  "how much agents shorten it is unknown" [D line 18] and then schedules as if it were known.
- **Calibration points that exist** [M]:
  - The R-bench pilots were estimated at 58 h [D SELECTION.md line 39]. They took 5.5 agent-hours of build plus
    verify (330.8 agent-minutes [M `harness-cost.json`]), about 10× faster, with "usable-with-limits" output and 5
    known holes.
  - The stage-1 bump was estimated at 20–30 ed [D 00-SYNTHESIS §5]. About 58% of it landed within roughly 13 hours on
    10-08, in commits titled "WIP snapshot … (unreviewed)" [M `git log`].
  - So raw speed is not the constraint. Review and the allowance are.
- **Money for agent work is unpriced.** The only measurement is $66.87 for 363.5 agent-minutes, **$11.04 per
  agent-hour** at list-price lower bounds, with 97.7% of tokens being cache reads [M `harness-cost.json`].
  - At the R-bench compression of about 10×, 100–170 ed is about 80–140 agent-hours, or **$0.9–1.5K** before
    adversarial review [I].
  - Review is real cost: Opus verification was $23.03, which is 34% of the workflow's $66.87 and 42% of the
    per-item $54.24 [M].
  - 11-NEXT §6 prices agent time only for R-bench harnesses.
  - The synthesis' "25.8M subagent tokens" cannot be compared with this: one 13-agent workflow alone used 218M tokens
    including cache reads [M].
- **The allowance is uncalibrated.** The 10-06 stop came at about $85 of experiment calls plus 7 review lanes and 14
  agents [D README]. 11-NEXT plans 4–5 continuous agents and two run slots, notes that "the allowance calibration
  planned for week 0 has no record", and then plans the weeks anyway [D §1.2]. This was P0-5 of the previous rigor
  critique, and it is still open [D 00-CRITIQUE-rigor].

**Fix.**
1. **Price orchestration now, for free.**
   - Run `node research/replicate-20261008/harness-cost.mjs <dir> --json …` over every subagent workflow directory of
     this session. It already turns transcripts into list-price lower bounds.
   - Add the result as a row in README's cost ledger and in 11-NEXT §6 ("agent build and review time").
2. **Allowance calibration becomes the M0 exit gate.** Record the meter % twice, 24 h apart, against the list $ priced
   in step 1 for that window. Express each week's budget in allowance % (proposal: experiment slots ≤ 40%, building
   ≤ 40%, reserve 20%), and pre-commit what is dropped first when a week runs over (proposal: C1, X8, RX1 full, the
   notes test).
3. **State the productivity assumption** in §5 ("this schedule assumes about 1 ed per agent-day, reviewed"). Re-plan
   at the end of W1 from the measured ed burn on M1 and M2.
4. Reprice the M10 agent-hours with the measured $11/agent-hour and keep them inside the D1-cap discussion.

---

## P1: fix in the documents or the pre-registrations before the runs

### P1-1. The headline leaves out the expert workflow's own build cost

10-STATE's plain-words bullet 2 calls the workflow "1/20 of the cost per success of one Sonnet call". Developing
records-v3 cost **$24.91** in development calls (6,752 calls) [D README cost ledger], plus Opus agent time that was
never priced. Break-even against each comparator [I, from the M CPS values]:

| Comparator | CPS gap | Break-even |
|---|---|---|
| Sonnet call | 0.3175 − 0.0162 | $24.91 / 0.3013 ≈ **83 successes** |
| Haiku agent | 0.1376 − 0.0162 | ≈ **205 successes** |
| Haiku 5.5 call, thinking off | 0.0437 − 0.0162 | ≈ **906 successes** |

The CPS ratio's CI also comes from a 2-cluster bootstrap that the REPORT calls descriptive [D].

**Fix.** Append to that bullet: "Not counting the $24.91 of development calls (and unpriced Opus time) it took to
write; at that cost it repays itself after about 83 successes against the Sonnet call and about 900 against a Haiku
5.5 call. Its intervals rest on 2 difficulty clusters and are descriptive." Add the same caveat to 10-STATE layer 7.

### P1-2. The heal state is stale, and the first promoted fix only ties retry

After 10-STATE's 21:52 read [M]:
- **r2, H-p1** (started 21:53:35, `live-20261008-r2/p1.json`): one more invalid operation, then **one defect patch
  promoted**. The op was `k_sample_agreement`, V0–V8 passed, cost ratio **1.1527**, $0.157.
  - The incident is a near miss (score 0.946 against a 0.97 bar).
  - The heal's own variance step classed it **model-variance**: 8 of 8 re-runs passed, Wilson lower bound 0.676, so
    only allocator ops were allowed.
- **r4, retry control** (`live-20261008-r4/p1-retry.json`, 22:12–22:14): on the failing trial's task, the unhealed
  base passed **8/8 for $0.0893** and the healed version 8/8 for $0.1033.
- **r4, H-rec**: 4 more defect proposals, all rejected (failing case still fails ×3, lint not cleared ×1). The variance
  class is workflow-defect (0 of 8 re-runs passed).
- **Totals through 22:18.** 26 defect proposals, 24 refused, 1 stopped by budget, 1 promoted, and **0 that beat
  retry**. Campaign spend is **$5.39** (385 ledger lines). The H-cfx r4 run was still going.

What follows [I]:
- V0–V8 can promote a cost-raising patch on an incident that does not reproduce. "Failing case now passes" on a
  model-variance incident is luck, and nothing in the gates compares against a retry.
- The 3 incidents were also tuned on tonight: `live.mjs` was edited between runs [D 10-STATE §3.9], and `heal.mjs`,
  `propose.mjs`, `verify.mjs` and `scan.mjs` are modified, with a new `retry-control.mjs` [M `git status`]. They are
  training data for heal now.
- EX1's injected-fault catalog has 7 classes: non-gating check, over-strict check, escape hatch, dropped batch, wrong
  class, misread convention, contradictory prompt [D heal DESIGN §12]. These mirror heal's own patch-op and lint
  vocabulary, so injected faults test heal on its own ontology.
- The planned injection hosts, the C0 F-opus artifacts, already fail the strict lint with existence-only acceptance
  [M `retro-audit.json`]. An injected "non-gating check" lands on an acceptance that already gates nothing.

**Fix.**
1. In 10-STATE §1, §3.9 and §7 gap 7, and in 11-NEXT §1.1, replace "0 promoted" with: "1 defect patch promoted
   (`k_sample_agreement`, +15% cost) on an incident the heal classed as model variance; a retry control passed 8/8
   unhealed at lower cost; 0 fixes that beat retry."
2. **Add the retry control as gate V3b.** On a model-variance incident, promote only if the patch lowers the failure
   rate against base on ≥ 20 fresh seeds where base fails at least once. Otherwise decline as "variance, no fix
   needed".
3. **EX1 headline.**
   - Stratify by variance class, and exclude H-rec, H-cfx and H-p1 from the headline (they are development).
   - Have the fault catalog written by an agent with no access to `experiments/heal/` or the op list, or sample it
     from the C0 and P1 diagnoses' natural failure causes.
   - Inject into lint-clean hosts only.

### P1-3. OD1 can be gamed; it needs a specificity half and an independent mutant source

The problem:
- OD1 is defined as the share of bad controls and mutants rejected [D 11-NEXT §3.6]. An acceptance that rejects
  everything, or hard-codes one expected output, scores 100%.
- Verdict-vs-oracle agreement only partly catches this, because it is measured on whatever the workflow happened to
  output.
- The mutant generator and oracle discovery would share an author.
- The sealed families ship 3–4 bad controls each [M `beds/sealed/MANIFEST.json`: `badControlNames`].

**Fix.**
- Define OD1 as a pair:
  - (mutant rejection rate, **reference-output acceptance rate** over ≥ 30 seeds, from the bed's reference solver);
  - floor proposal: ≥ 80% rejection **and** ≥ 98% acceptance.
- Add "accept-all" and "reject-all" sanity acceptances to every OD1 table.
- Freeze the mutant generator by hash before any oracle-discovery code is written, and have it written by a
  different agent.
- On R-bench, use the alternative-design controls as the specificity set. Today G10 covers only 2 of 5 items
  [D DESIGN §10.9].

### P1-4. CX3 is in-sample for the treatment

The skeleton library (8–12 Opus-written skeletons), oracle discovery and the lint rules are all developed on the
families CX3 uses:
- the lint rules "were written from the C0 dev artifacts" [M `src/lint.mjs:7-8`];
- a `records` skeleton derived from records-v3 would turn "Haiku constructs" into slot-filling of the expert
  workflow [I].

A favourable CX3 is therefore uninformative about transfer. Only an unfavourable one is informative.

**Fix.**
- Add R-bench's source firewall (R-14) to CX3: no skeleton or worked example derived from a CX3 family's workflows
  (records-v3, the C0 artifacts).
- Or report `records` as "in-library" and read only the other family.
- State in M3: "a CX3 win does not raise the prior for the sealed round; a CX3 loss can drop the builder".
- Name who reviews the skeletons (ROADMAP §6: execution authority outside the model). If the owner does not, record
  "Claude-reviewed".

### P1-5. RX1's workflow modes are single builds, and low difficulties may repeat development worlds

- RX1's F-haiku and F-opus are the C0 dev artifacts, one construction per family [D 11-NEXT M14]. The router's real
  choice is between "build, a random draw from the build distribution" and "direct". With K_c = 1 the headroom
  confuses build luck with mode value.
- The Kev program notes that "dev and test worlds can coincide at low difficulty" [D JUDGE-PROGRAM §3.1]. records-v3
  was developed on dev seeds 101–160 at d3 and d4 [M heal `seed-ledger.json`]. RX1's d1–d2 cells can therefore hold
  worlds identical to development worlds.

**Fix.**
- Use ≥ 3 builds per workflow mode and family (about +$15–20 at C0 build costs [M]), or label RX1 "conditional on
  these artifacts".
- Deduplicate test worlds by `worldHash` against every development and inspected world before the run, or start RX1
  at d2.

### P1-6. No global seed ledger; "fresh" seeds collide across lanes

The current allocations [D JUDGE-PROGRAM §3.1; M heal `seed-ledger.json`; D heal DESIGN §8.1]:

| Lane | Seeds | Note |
|---|---|---|
| Kev, all beds | train 401–3999, test-in 5000–5999, test-OOD 6000–6999, reserves 7000–7199 | its test ranges are "read once" |
| P1 and C0 test | 5001–5006 and 6001–6004 | inside Kev's test ranges |
| EX1's V7 "fresh" | 2001+ | inside Kev's train range |
| heal's ledger | — | covers heal only |

11-NEXT draws "fresh" seeds in at least eight milestones that run in parallel (M1, M3, M5, M6, M14, M16, M17, M21).
Once Kev ports gate inside workflows (E2), shared worlds contaminate the X8 and E2E reads.

**Fix.**
- Create one append-only `research/SEEDS.json` (family, split, difficulty, range, owner, purpose, inspected flag,
  date). Every runner refuses a seed that is not reserved to its pre-registration hash.
- Reserve experiment test seeds ≥ 8000, outside every Kev range, for all Claude-written beds now.

### P1-7. Owner tasks (M11, M21): oracle protocol, baseline and gates are missing

- M11 accepts "an acceptance check or input/output examples". If only examples arrive, oracle discovery sees the same
  examples the oracle uses [I].
- M21's baselines omit B0-agent, the owner's actual alternative ("ask Claude Code").
- M21 lists no security preconditions, although owner tasks may touch real data or effects. ROADMAP excludes
  production interventions, and synthesis §7 says the items are "not optional for … your repositories" [D].

**Fix.**
1. In the decision-9 request: hold out at least a third of each task's examples as the oracle, never shown to a
   builder. Claude never writes or edits an oracle after seeing a task. A task with neither a check nor held-out
   examples is run and reported `unverified`, outside the success rate.
2. Add B0-agent Haiku 5.5 to M21.
3. Gate M21:
   - effects mocked unless the owner approves a task by name;
   - items 1+2, 4 and 6;
   - item 3 (declassification budget) before any task maps untrusted items into a real effect.

### P1-8. Kev: the K1 rule tests the wrong question, and data-factory growth continues before it

- **The K1 rule.** "Kev loses on a port → … training stops for it" [D 11-NEXT M8-K1] compares **stock** Kev. Stock Kev
  losing says nothing about a trained Kev. The question for training is whether Haiku 5.5 leaves headroom.
- **The probe data predates a fix.** The probe's rule baseline scored 99/100 on injection [M ledger]. That data
  predates the "injection-label shortcut" fix in `b62049f` [M `git log`]. Separately, the stock-Kev scores are the
  best of 2 wordings on the same split they are reported on [M ledger: e.g. synth-claim 42 vs 45/80].
- **Growth continued.** In the hour of these documents, wave-B ports and judges appeared (untracked
  `experiments/kev-data/judges/{incident,synth}.mjs`, `ports/synth-*.mjs` [M `git status`]; commit `37e53e1` "Kev
  wave B" [M]). kev-data grew to **37.6K** lines from 10-STATE's 34.6K [M `wc`]. That is risk S7 and rule R6 in
  action.

**Fix.**
1. K1 criterion: "train a port only if Haiku 5.5 typed calls fall below the port's JUDGE §8.1 promotion bar on the
   fixed wave-A evaluation split, or exceed its cost or latency target. Stock Kev's score is reported, not used to
   decide."
2. Re-run the rule and Haiku baselines on the post-`b62049f` data.
3. Freeze kev-data scope at wave A until K1 reads (owner to confirm, given "everything okayed").

### P1-9. E1 freezes code that was never reviewed; E2 is a large merge with no re-qualification

- The stage-1 code is in commits labelled "(unreviewed)" [M `git log`: 0aaa6d5, 37e53e1 and earlier], and
  `STAGE1-ENGINE.md` does not exist [M]. Other lanes got adversarial reviews (run-history UI "11 P1 fixed"; Kev wave A)
  [M `git log`]. M1 has none, though a read-once sealed round depends on it.
- E2 merges S0b, S1 `call`, the Kev W0/W1/W3/W4 wiring and the heal promote path at once, one week before E2E-1.
  E2E-1 then compares against baselines on a new engine without any re-qualification.

**Fix.**
- Add to M1: an adversarial review of the stage-1 diff (lint, acceptance, verdict, taint, audit, run rows) by an agent
  that did not write it, plus replay conformance. E1 cannot be named while that review has open P0s.
- Add **M1b, E2 re-qualification**: M1's design on E2, plus the sealed-round winners on 8 development tasks, before
  E2E-1.
- Stage the E2 merges: `call` first; the Kev wiring and heal's promote path only if their experiments passed.

### P1-10. Two security gates are missing: heal on third-party run data, and AMP or owner data

- M7 heals "natural failures on R-bench". The heal proposer then reads `untrusted:run-data` excerpts drawn from
  third-party workflow text [D heal DESIGN §7.5], and its guard-adding patches can be auto-promoted. Item 4's
  planted-instruction test is defined for builders, not for the heal proposer.
- M19 compiles the owner's AMP context into builder context. That is untrusted provenance with no gate listed.

**Fix.**
- Extend item 4's planted-instruction slice and canary to the heal proposer, and gate M7 on it.
- Gate M19 on items 4 and 15, with a provenance label on every AMP excerpt.

### P1-11. Missing kill rules and baselines

| Milestone | Missing | Exact addition |
|---|---|---|
| M2 OD1 | baseline | OD1 of the free-builder artifacts (existence-only, so 0% gating [M retro-audit]) and of records-v3's lint-debt heal (4/14 bad controls [D heal B.4]) |
| M13-S0a | capability baseline ("declared coverage" is not a method) | executed share of the 96 T1 items by B1 (a plain script translation) under the same mocks and oracles |
| M13-S0a | health gate | count an executed failure against the IR only if the original or reference passes the same mocked oracle (R-bench's health gate) |
| M13-H | kill or claim rule | "executed / oracle-eligible below X% on the fresh sample → THESIS D8 headline restated as the measured share" (X pre-registered) |
| M12 | capability kill | "F below B0-call Haiku on execution accuracy at equal spend → no external-benchmark claim for construction" |
| M19 | kill marked [I] | pre-register δ and n for "construction success with vs without AMP context" |
| M22 | whole-composition kill | "E2E-2 not better than B0-agent and E2E-1's flat pipeline in CPS at equal success → composition stays representation-only" |
| M9 | statement | "B0-agent and the free builders are deferred (D10), so any F > B0 result here is against single calls only" |

### P1-12. Depth projections credit milestones that do not measure the layer

These are rubric errors, not arithmetic [I]:
- Router 1 → 3 by 11-22 from RX1, but RX1 measures headroom, and no router exists until RX2 (11-23 →). Realistic: 2.
- Opus templates 2 → 4 from CX3, but CX3 compares structured and free *Haiku* builders. The template effect is
  confounded with the method. Realistic: 3.
- Auditability 2 → 5 by running `verify-run` on the sealed round, but running a tool is not a capability comparison.
  A tamper-injection red-team on a real run would be 3. Realistic: 3.
- Kev "now 3": the probe was offline scoring, not end to end in a run. Realistic: 2.
- Honest verdicts "now 3": the retro-audit re-read recorded data. That is 2 by the rubric.

Corrected: about 43 now and about 60 by 11-22, not 45 and 67.

**Fix.** Apply these corrections. Add a rubric rule: "a layer reaches depth ≥ 4 only through a comparison whose
treatment *is* that layer".

---

## P2: wording, tags and smaller numbers

1. **The 45/120 (38%).** Summing ordinal ranks across unlike layers gives a number that reads as "38% done". Replace
   it with counts per depth and direction, for example "depth ≥ 4: 2 layers (1 +, 1 −); depth ≥ 5: 0".
2. **CLI flags.** The per-shape savings (−42.2%, −41.4%) each rest on **n = 5 per shape and arm** (20 rows); "10 per
   arm" pools the two shapes [M `results.json`]. 76–82% of the
   saving is the price tier of 5-minute cache writes [M `analysis.json` `priceTierShareOfSavingPct`]. On workflows
   whose calls are more than 5 minutes apart the saving may shrink or reverse [I]. Re-measure on a P1-sized call on
   a quiet VM before re-basing CPS.
3. **The 1,000-item map [M] has no preserved source.** `map1000.mjs` lives in a session scratchpad. Copy it into
   `research/` with its output, or tag the figure "[M, unpreserved]".
4. **The RX1 wall time is about 3× too long.** "36–40 h" inherits 24 trials/h from the previous critique, whose span
   included P1's 7.87 h owner stop. Measured on 10-08 [M]:
   - P1 day 2: 226 trials in 2.13 h, with 10.43 h of summed latency (effective concurrency ≈ 4.9), so about 106
     trials per active hour.
   - RX1's ≈ 1,040 trials take about 10–13 h at concurrency 4–5.
   - Fix §1.1's throughput row, and free slot A in W2.
5. **"About $98 spent"** leaves out the R-bench harness agents ($66.87 [M `harness-cost.json`]). Heal is now $5.39,
   not $4.37 [M]. The README notes "at least 39 more at the bounds" [D]. Quote all three.
6. **Tool-loop reach.** 209 of 1,559 items carry `agent-tool-loop`, 13.4% of the corpus [M]:
   - 100 third-party agentic items;
   - 99 original items (n8n 64, flowise 20, langflow 13, activepieces 1, dify 1);
   - 10 first-party.
   The X0 decision reaches all 209, not "48% of agentic items".
7. **The first executed coverage number** comes from 96 T1 items. They are dominated by kubeflow 25, dagster 24 and
   temporal 14 [D COVERAGE §7], with oracles ported by Claude. Report it per platform and as a share of the oracle
   subset only, never as a share of the corpus.
8. **Kev reads are unquantified** ("plus reads"). At 17,800 rows per curve point × 6 reads (stock, 3 points, seed,
   grid), served-scoring time could equal training time. J0c measures the rate; put that number into the
   five-night budget [D JUDGE §7.4].
9. **Name the E1 re-qualification artifact by hash.** records-v3 now has two promoted heal versions: the lint-debt
   patch, and v3 `309dccb6…` with `k_sample_agreement` [M].
10. **README's "$560–825" six-week figure** is superseded by 11-NEXT's $622–1,735. Say so in 11-NEXT §6.
11. **D1-cap timing.** Cumulative experiment spend by the end of the sealed round is $98 + $492–1,140 = **$590–1,238**
    [I from §6], under $1,500. The cap binds in W5–W6, or earlier if agent build time counts toward it. Define
    what the cap covers.
12. **C1 (M5)** may be uninformative on `records`, where the all-Haiku workflow is at 35/36 [M P1]. Pre-check the
    all-cheapest vs all-frontier gap on candidate families (about $10) and run C1 only where the gap is > δ.
13. **M16** says "3 arms" but names `wide`, `panel`, B5 and B0-call. The ≈ 290 trials fits 3. Fix one or the other.
14. **sealed-3** waits for an env port that no milestone schedules. Say "never in this plan", or schedule it.
15. **Engine suite.** The working tree is at 919/901/0/18 [M]. Quote the commit with any test count.
16. **Lines of code** grew during the writing: 131.2K now (src 13.0K, tests 14.9K, beds 33.8K, kev-data 37.6K,
    replicate 14.3K, heal 5.6K, run-view 6.9K, bridge 5.2K) [M `wc`], against 10-STATE's 127K.

---

## Numbers checked

| Claim | Source | Status |
|---|---|---|
| P1: 35/36, 28/36, 25/36; +0.194 [0.056, 0.361], p = 1.000; CPS 0.051 [0.044, 0.063]; Haiku 5.5 vs 4.5 +0.694, p = 0.004; CPS vs Haiku call 0.372, vs agent 0.118 | P1 analyze [M] | correct; the CIs are descriptive (2 clusters) [D REPORT] |
| d3 CPS 0.40× and 0.39× | 0.0155/0.0384, 0.0155/0.0397 [M] | correct |
| C0: 11/16, 16/16, 16/16; −0.31 [−0.63, 0.00]; break-evens 3.8/9.6/2.9/never/3.9/never/6.6/never; 0.148 [0.064, 0.370]; 0.706 [0.498, 1.279] | C0 analyze [M] | correct |
| Construction $0.84–3.46, mean $1.86; trial $ per arm; mean $0.192 | C0 analyze [M] | correct ($14.87/8; $18.43/96) |
| Lint: 1, 3, 2, 3, 11 errors; 32 pass (5 false) → 32 unverified | `retro-audit.json` [M] | correct |
| Flags −42.2% and −41.4%; 2.99 → 1.53 s | `analysis.json`, `results.json` [M] | correct; n is 5 per cell (P2-2) |
| Corpus 1,559; native 521 (476+45); via-extension 1,003; unsupported 35 (2+33); declared oracles 438 (390+48) | `items.jsonl` [M] | correct |
| `agent-tool-loop` 100 of 207 | `items.jsonl` [M] | correct; 209 of 1,559 overall (P2-6) |
| R-bench $10.85, 66.2 min, $54.24; 13 agents $66.87, 363.5 min; 18 fixed, 5 still pass | `harness-cost.json`, DESIGN §2.1 [M] | correct |
| Kev probe 64/80 vs 64/80 … 72/104 vs 104/104 | ledgers [M] | correct; best of 2 wordings on the same split (P1-8) |
| Laptop 1,290 / 1,080 / 770 tokens/s | LAPTOP-THROUGHPUT table [M arithmetic] | correct (1,294 / 1,086 / 768) |
| Kev reduced plan 35M tokens ≈ 9 h | JUDGE §7.4: 3 + 5 + 17 + 5 + 5 M [M] | correct at 1,100 tok/s; ≈ 12.6 h at 770 tok/s for long states |
| Suite 912/894/0/18 | [D] at HEAD | working tree 919/901/0/18 [M] |
| run-view 91/91 | [M] | correct |
| Heal: 20 proposals, 19 refused, 1 budget, 0 defect promoted, $4.37 | live runs at 21:52 | correct then; **stale** at 22:18 (P1-2) |
| Depth sums 45 / 68 / 67 / 78 | the tables [M arithmetic] | sums correct; rubric over-credits (P1-12) |
| §6 spend: $622 / $1,735; $1,091 / $2,241; $3.0–5.8K | 11-NEXT §6 [M arithmetic] | sums correct; agent time unpriced (P0-5) |
| Sealed round $200–260 | 00-SYNTHESIS §5 [D] | not recomputed for 11-NEXT's arms: $150–490 (P0-2) |
| RX1 36–40 h | 11-NEXT M14 | wrong: about 10–13 h (P2-4) |
| "about $98 spent" | README $93.76 + heal | incomplete (P2-5) |
| 5.75 of 10 bump bullets; 4.5 of 17 security gates | synthesis §5, §7 [M arithmetic] | correct; 2 of the 5.75 are assumed (scheduler, cancel absent at `src/runtime.mjs:467`, no `cancel` in `bin/foundry.mjs` [M]) |
| Haiku 4.5 is 10× Haiku 5.5 per token | `policy/models.json` [M] | correct below 100K-token prompts (Haiku 5.5 is $0.50/$2.50 above) |
| Only 2 pre-registrations plus the template exist | `find research experiments -iname 'PREREG*'` [M] | correct |

## Plan costs against measured units

| Plan item | Plan | Measured basis | Reading |
|---|---|---|---|
| CX3 with the Haiku 4.5 arm | $60–120 | Haiku 5.5 build $0.84–1.37 (of which builder $0.06–0.57, the rest gateway probes) [M C0] | plausible; the Haiku 4.5 build is dominated by the builder share, so $5–10 is conservative |
| E1 re-qualification | $5–15 | Sonnet call $0.247, fhand-haiku $0.016 [M P1] | about $6; fine |
| RX1 pilot | $70–110 | 240 trials per arm at P1/C0 unit costs [M] | about $110–130 before flags; at or above the top |
| EX1 | $60–200 | tonight's 3 incidents × 4 runs cost $5.39 [M]; V7 gate $3.1 [D] | plausible |
| C0 sealed | $200–260 | P0-2 table [I from M] | $150–490 for the arms as listed |
| R-bench agent time | $1.3–1.8K | $11.04 per agent-hour [M] | consistent; the same rate prices all agent building at about $0.9–1.5K, unlisted (P0-5) |
| P1 and C0 history | — | C0 $35.32; P1 $26.09, plus $24.91 to develop records-v3 [D README] | P1's real total is about $51, which matters for P1-1 |
