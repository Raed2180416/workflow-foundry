# RESULT GQA-1: deep QA of a browser game build (requirement E2)

| Field | Value |
|---|---|
| Owner ask | E2, the brief's flagship generalisation example: "deep QA of a game build (visual passes, explorer personas, playback / repro / minimize; R08 has a reference design)" |
| Evidence class | **development (diagnostic)**. One bed, one level, one author for the build, the faults, the spec and the template; the public spec states a rule for every injected fault (§9). No held-out or sealed claim. |
| Pre-registration | [PREREG-GQA-1.md](PREREG-GQA-1.md): frozen 2026-10-28 before the first model call (`FREEZE.json` `arms`); amendments **A1** (rate-limit fault, budget-line arms), **A2** (after the independent review: deviations, leakage disclosure, single-version replication `gqa1v`, matched agent `gqa2`), **A3** and **A4** (two faults of the never-exercised Mercury path), each dated and frozen before any run it governs (`FREEZE.json` `amendments[0..3]`) |
| Bed | [`beds/gameqa-web`](../../beds/gameqa-web/) 1.0.0, *Lantern Vault*: plain HTML/JS, lockstep, seeded (determinism class D0), driven by Playwright on the preinstalled Chromium; unchanged since the freeze (bed tests 11/11 re-run 2026-11-04) |
| Injected-bug set | 12 faults, 6 classes × 2 (collision, state desync, softlock, UI overlap, score overflow, input race), hidden truth `beds/gameqa-web/truth/bugs.json`, truth-set hash `106bead4…ddbb270`, bed manifest `ba728598…a4701e95`, both frozen before any model call |
| Model | `claude-haiku-5-5` (class M, `policy/models.json`), through the repo's ModelPort and the Claude CLI provider, effort `low`, text only. `mercury-3` (policy `executorModels`) as the preregistered exploratory secondary E1 |
| Runs | 2026-10-28 (frozen arms, CLI 2.1.312) and 2026-11-04 (A1 re-runs and secondary arms; A2 `gqa1v` and `gqa2`; E1 Mercury; CLI 2.1.318). 60 scored runs (12 arms × 5; 45 of them Haiku runs), 9 Mercury runs (6 scored, 3 excluded); 7 + 6 harness-faulted runs kept as raw data |
| Spend | Haiku **$1.313** in all (cap $3.00, spend stop $2.50): $0.605 before the review, $0.708 for the A2 runs. Mercury $0 (listed), 1.70M tokens |
| Review | independent review 2026-11-04: 0 blockers, 6 major, 10 minor findings; every one is handled in §11 |

## Bottom line

- **Capability number, preregistered (development evidence, K = 5 per arm):** the cheap-built QA workflow finds **6.4**
  (frozen series) and **5.0** (single-CLI-version replication `gqa1v`) of 12 injected bugs per run with a valid,
  1-minimal, replayable repro, against **1.0 / 0.8** for Haiku exploring alone and **1.0** for a random monkey. H1 (p = 0.004)
  and its replication R1 (p = 0.048) are supported; pooled over ten runs each the workflow finds 5.7 vs 0.9 (P1, p < 0.001).
  Zero false reports from any workflow run.
- **Against the strongest solo agent we defined the gap mostly closes.** The review showed the frozen agent was handicapped:
  its prompt asked for "short, focused runs" and never named `goto`, its report list replaced itself every turn, the model
  owned the stop decision, and it spent 1/18 of the workflow's dollars. The A2 **matched agent** (persona prompt wording,
  append-only reports, fresh sessions until it has spent the workflow's $0.067) finds **4.4** (4, 4, 5, 4, 5). Against it the
  same-day workflow's 5.0 is **not** a significant win (**C1 not supported**: difference 0.6, p = 0.107); post hoc, against
  the frozen series or pooled over all ten workflow runs, the workflow leads by 2.0 or 1.3 bugs (p = 0.024 / 0.016). By the
  reading fixed in A2: **most of H1's 5.4-bug gap came from the agent's handicaps, not from the workflow's structure**; what
  remains is about 1-2 bugs a run.
- **The two find different bugs.** The matched agent finds the transition and conservation bugs no check catches (dash
  through a wall 4/5, key lost in the death tick 4/5) and never the HUD, UI-overlap or deep score bugs; the workflow finds
  those (GQ03, GQ07, GQ08, GQ09 in 8-9 of 10 runs) and almost never the first kind. In reps 1-4 the per-rep union of the
  two is 8-9 of 12. Both explore enough (their own play, re-scanned with perfect checks, holds 8-12 bugs); both lose at **detection**:
  the agent by attention, the workflow by the checks Haiku writes.
- **Cost is where the workflow wins clearly.** Random exploration with the same Haiku-written checks (`workflow-random`)
  finds 6.4 / 4.2 for **$0.013-0.015 a run including its construction**, as much as the matched agent finds with $0.068
  (C2: no difference):
  about $0.003 per found bug against $0.015. Persona exploration is 79% of the workflow's spend and adds no mean
  capability (H4, R4).
- **New failures, root-caused:** one of ten constructions wrote every check as `state.x` instead of `cur.state.x`; the
  template verifies only that checks parse, so the run went on with zero checks and found nothing (`gqa1v` r5 = 0, which
  also sinks its paired random run to 1). The preregistered Mercury path had two configuration faults (A3, A4); once
  fixed, Mercury alone with the frozen agent prompt found 4.7 a run (it does not stop early, unlike Haiku), but it could
  not produce a workflow construction within 32k output tokens, so its workflow has no number (§6.6).
- **Corrections from the review (§11):** the agent's report rewriting lost bugs it had found (GQ06, GQ01, GQ11 in
  `agent-persist`); "GQ06 was never found by a Haiku arm" was false. The spec states a rule for every injected fault, and 7
  of the 10 distinct bugs the workflow found were caught by checks that restate their fault's own sentence. E2 stays **partial**:
  development evidence on a single-author bed, no pixel vision, no held-out bed.

## 1. What was built

- **The build.** A 14×10 grid level with coins, gems, a relic, a key and a locked door, a lever-operated gate, spikes, a heart,
  an exit, two seeded patrolling enemies, a timer, a dash with a recharge, a pause menu, completion / game-over / victory
  dialogs, a HUD and toasts. The page advances only when the driver ticks it, so a (build, seed, tokens) triple replays
  bit-identically. Build B1 switches on 12 fault flags; each fault computes the correct result beside the faulty one and
  records a probe only when they differ.
- **The oracle** ([`oracle.mjs`](../../beds/gameqa-web/oracle.mjs)). A report `{bug_class, title, observed, expected, seed,
  steps}` is replayed from a fresh game on B1. It counts for an injected bug only if that bug's probe fires, and it is
  **found** (the primary metric `foundMin`) only if the repro is **1-minimal**: removing any one token stops the probe (keeping
  the symptom). Malformed and non-firing reports are false reports.
- **Oracle controls** ($0, before the freeze): every reference repro credited and 1-minimal; padded, wrong-class, junk and
  malformed reports scored as such; the clean build audited against its spec (21 + 22 oracle-informed checks, 60k random
  ticks, 0 violations); a clean-vs-faulty differential replay (B1 200 episodes and each fault alone, 0 un-probed
  divergences, 0 silent probes). Bed tests 11/11 (re-run 2026-11-04 on the frozen bed).
- **Vision.** The policy's CLI route is text only, so no arm sees pixels. Testers read the page's DOM test API: state, HUD
  text, UI rectangles, and whether each button is topmost at its centre (`elementFromPoint`). The two UI-overlap faults are
  layout faults observable that way, not rendering glitches. This is a stated limit, not a visual-model result.


## 2. Arms

All arms get the same tester session (reset(seed) / run(tokens) / observe on B1, no probes), the same public design
document and an 8,000-tick budget; the model arms also get the same seven QA heuristics.

| Arm | What it is | Role |
|---|---|---|
| `monkey` | random harness tokens + two generic detectors (page error; state frozen 30 ticks with no dialog) + code repro and ddmin | **simple baseline**, $0 |
| `agent` | Haiku alone, ≤ 40 turns: each turn it sees its notes, its run history, the last trace and the map, plays one run, keeps its report list; it must replay and minimize by itself | **primary comparison** (H1) |
| `workflow` | template `foundry/game-qa-explore-repro-minimize` 1.1.0 (frontier-written): Haiku **constructs** 3-6 personas (R08 archetypes) and 8-30 executable checks in a closed expression language → personas **explore** (3 rounds) → code **plays back** every plan and evaluates every check per tick → **triage** by (check, screen) → code **repro** (2 replays) → code **minimize** (ddmin + single-token pass) → Haiku **judges** the minimized candidates → report | the system under test |
| `workflow-random` | the paired `workflow` rep's checks, random exploration instead of personas | ablation (H4) |
| `monkey-ref` | random exploration with the bed author's 22 **oracle-informed** checks, repro + ddmin, no judge | calibration ceiling, not comparative |
| `agent` (`gqa1nb`) | the agent without the CLI's "USD budget" line (A1) | secondary (S1, S2) |
| `agent-persist` (`gqa1nb`) | the same, and a `finish` before turn 40 is refused ("keep testing parts of the game you have not tested yet") | secondary (S3, S4) |
| `gqa1v/*` (A2) | `workflow`, `workflow-random` and `agent` exactly as frozen, re-run as reps 1-5 on one day and one CLI version (2.1.318) | replication (R1, R2, R4) |
| `agent-matched` (`gqa2`, A2) | the agent with the persona prompt's exploration wording ("reach new areas and states ... goto:x,y is a convenient way to walk") instead of "prefer short, focused runs"; append-only reports (every report it files is kept, deduplicated by seed + tokens); when it finishes or a session reaches 40 turns, a fresh session starts (no notes, the filed list shown) until the run has spent $0.067 (the frozen workflow's mean), 8,000 ticks or 100 calls; no budget line | the strongest solo-agent baseline (C1-C3) |
| `gqa1m3/*` (E1) | `agent`, `workflow`, `workflow-random` with `mercury-3` | exploratory, descriptive only |

**R08 mapping.** Implemented: personas (node 5), recorder and deterministic replay (3), executable invariants (7),
stall/softlock detection (9), repro and ddmin minimization (11), triage by signature (12), reporter with a model judge
(13), regression-test generator with a clean-build control (14, `regress.mjs`). Not implemented: visual tiers (8, no image
route), performance (10), a coverage-driven curriculum (4: the personas only see shared coverage counts), the
supervisor/healer (15).

## 3. Capability table (K = 5 runs per arm, 12 injected bugs per run)

| Arm | foundMin per run | mean (sd) | every report ever listed (agent arms, §6.1) | false reports (all runs) | reports (dupl.) mean | model calls / run | USD / run | USD / found bug | wall s mean |
|---|---|---|---|---|---|---|---|---|---|
| `monkey` (baseline) | 1, 1, 1, 1, 1 | **1.0** (0) | | 0 | 1.0 (0) | 0 | $0 | $0 | 101 |
| `agent` (frozen, primary) | 1, 1, 1, 1, 1 | **1.0** (0) | 1, 1, 1, 1, 1 | 0 | 1.0 (0) | 4.8 | $0.0036 | $0.004 | 54 |
| `gqa1v/agent` (replication) | 1, 0, 1, 1, 1 | **0.8** (0.45) | 1, 0, 1, 1, 1 | 0 | 1.0 (0) | 4.8 | $0.0041 | $0.005 | 50 |
| `gqa1nb/agent` (no budget line) | 1, 1, 1, 1, 1 | 1.0 (0) | 1, 1, 1, 1, 1 | 0 | 1.0 (0) | 4.6 | $0.0040 | $0.004 | 53 |
| `gqa1nb/agent-persist` | 2, 1, 1, 2, 2 | 1.6 (0.55) | **2, 2, 1, 2, 4** | 0 | 2.2 (0.2) | 40 | $0.035 | $0.022 | 442 |
| `gqa2/agent-matched` (A2) | 4, 4, 5, 4, 5 | **4.4** (0.55) | (append-only) | 1 | 6.6 (1.2) | 70 | $0.068 | $0.015 | 553 |
| `workflow` (frozen) | 8, 8, 6, 5, 5 | **6.4** (1.52) | | 0 | 10.8 (4.2) | 21.4 | $0.067 | $0.010 | 251 |
| `gqa1v/workflow` (replication) | 7, 6, 7, 5, 0 | **5.0** (2.92) | | 0 | 7.2 (1.6) | 20.8 | $0.065 | $0.013 | 186 |
| `workflow-random` (frozen) | 7, 7, 6, 5, 7 | 6.4 (0.89) | | 0 | 12.4 (5.2) | 2.8 | $0.0076 + $0.0078 construction = **$0.0154** | $0.0024 | 299 |
| `gqa1v/workflow-random` | 5, 5, 6, 4, 1 | 4.2 (1.92) | | 0 | 8.0 (2.4) | 1.8 | $0.0052 + $0.0082 = **$0.0134** | $0.0032 | 135 |
| `monkey-ref` (calibration: oracle-informed checks) | 8, 9, 11, 10, 11 | 9.8 (1.30) | | 0 | 21.6 (10.8) | 0 | $0 | $0 | 371 |
| `gqa1m3/agent` (E1, Mercury, frozen agent prompt) | 3, 4, 7 | 4.7 (2.08) | 3, 4, 7 | 0 | 4.7 (0) | 45 | $0 listed (0.46-0.57M tokens a run) | | 602 |
| `gqa1m3/workflow` (E1, Mercury) | 0, 0, 0 (no usable construction, §6.6) | | | | | | | | |
| `gqa1m3/workflow-random` (E1, Mercury) | not run (no construction to reuse; excluded) | | | | | | | | |

Across its 10 runs the workflow found 10 distinct bugs (union: all but GQ02 and GQ06); the matched agent 6 (GQ01, GQ05,
GQ06, GQ10, GQ11, GQ12); the 15 frozen-prompt Haiku agent runs 5. Raw tables: `analysis/analyze.md` and
`analysis/analyze.json` (frozen `analyze.mjs` with the A2 rule). `foundMin`: injected bugs with an oracle-credited,
1-minimal, replayable repro. False reports: malformed or no injected fault fires (the matched agent's one: a "key lost on
hit" report whose repro, replayed with its seed, fires no injected fault). USD: the CLI's reported cost; `workflow-random` borrows
its construction from the paired `workflow` run, so its stand-alone cost includes that call. Wall: exploration +
minimization + judging (scoring excluded); the host ran other experiments at load 30+ on 4 cores, so wall time is noisy
(the game is lockstep, so load cannot change an outcome). **Duplicates (review m3):** the frozen workflow's 54 reports are
33 distinct bug finds and 21 duplicates; as regression tests they reduce to 9 (one per distinct bug, each failing on B1 and
passing on the clean build, `analysis/regression-pack-workflow.json`).

## 4. Tests (exact Mann-Whitney on per-run foundMin; one-sided tests supported iff p ≤ 0.05 and mean difference ≥ 1)

| Test | n | means | diff | U | p | Decision |
|---|---|---|---|---|---|---|
| **H1** workflow > agent (primary) | 5 vs 5 | 6.4 vs 1.0 | 5.4 | 25 | 0.004 | **supported (dev evidence)** |
| **H2** workflow > monkey | 5 vs 5 | 6.4 vs 1.0 | 5.4 | 25 | 0.004 | **supported (dev evidence)** |
| **H3** agent > monkey | 5 vs 5 | 1.0 vs 1.0 | 0 | 12.5 | 1.0 | not supported |
| **H4** workflow vs workflow-random (two-sided) | 5 vs 5 | 6.4 vs 6.4 | 0 | 12.5 | 1.0 | no difference shown |
| S1 workflow > agent without the budget line | 5 vs 5 | 6.4 vs 1.0 | 5.4 | 25 | 0.004 | supported (dev evidence) |
| S2 agent without vs with the line (two-sided) | 5 vs 5 | 1.0 vs 1.0 | 0 | 12.5 | 1.0 | no difference shown |
| S3 workflow > agent-persist | 5 vs 5 | 6.4 vs 1.6 | 4.8 | 25 | 0.004 | supported (dev evidence) |
| S4 agent-persist vs agent (two-sided) | 5 vs 5 | 1.6 vs 1.0 | 0.6 | 20 | 0.17 | no difference shown |
| **R1** (A2) workflow > agent, one CLI version | 5 vs 5 | 5.0 vs 0.8 | 4.2 | 20.5 | 0.048 | **supported (dev evidence)** |
| R2 (A2) workflow > monkey, one CLI version | 5 vs 5 | 5.0 vs 1.0 | 4.0 | 20 | 0.063 | not supported (r5 = 0 < 1) |
| R4 (A2) workflow vs workflow-random (two-sided) | 5 vs 5 | 5.0 vs 4.2 | 0.8 | 17.5 | 0.34 | no difference shown |
| **C1** (A2) workflow > matched agent | 5 vs 5 | 5.0 vs 4.4 | 0.6 | 19 | 0.107 | **not supported** |
| C2 (A2) workflow-random > matched agent | 5 vs 5 | 4.2 vs 4.4 | -0.2 | 14.5 | 0.44 | not supported |
| C3 (A2) matched agent vs frozen agent (two-sided) | 5 vs 5 | 4.4 vs 0.8 | 3.6 | 25 | 0.008 | matched > frozen |
| C3e (A2) the same on every report ever listed (two-sided) | 5 vs 5 | 4.4 vs 0.8 | 3.6 | 25 | 0.008 | matched > frozen |
| S2v (A2) budget line on one CLI version (two-sided) | 5 vs 5 | 0.8 vs 1.0 | -0.2 | 10 | 1.0 | no difference shown |
| P1 (A2, secondary) workflow > agent, pooled | 10 vs 10 | 5.7 vs 0.9 | 4.8 | 90.5 | 0.00006 | supported (dev evidence) |

Falsifiers (§6): H1 is supported and the workflow's false reports (0) do not exceed the agent's (0), so neither falsifier
fires; on the A2 side the matched agent's one false report does not change C1. **The reading fixed in A2 applies:** C1 is not
supported, so H1's gap is attributed, at least in part, to the frozen agent's prompt, report protocol, stop rule and dollars.

**Post hoc (not preregistered; labelled so):** the frozen workflow series vs the matched agent, 6.4 vs 4.4, p = 0.024; all
ten workflow runs vs the matched agent, 5.7 vs 4.4, p = 0.016; `gqa1v/workflow` without its zero-check r5, 6.25 vs 4.4,
p = 0.024; the frozen `workflow-random` (6.4) vs the matched agent, p = 0.012; all ten `workflow-random` runs (5.3) vs it,
p = 0.049. So the workflow's lead over the matched agent is about 1-2 bugs a run and depends on whether a construction
fails; the same-day preregistered test does not show it.

**Versions.** The frozen series mixed CLI 2.1.312 (`workflow` r1-r2, `agent` r1-r5, `workflow-random` r1) and 2.1.318
(the rest; `analysis/cli-versions.json`, from the local journals). Every A2 run recorded 2.1.318 at its start and its end
(`meta.cli`), and its `cli-args` rows show the budget flag on all 137 `gqa1v` calls and on none of the 350 `gqa2` calls.
Most of the replication's lower mean (5.0 vs 6.4) comes from one construction that produced no usable check (§6.3), not the
version: its other four runs give 7, 6, 7, 5 (6.25).

## 5. Per-bug detection (runs with a 1-minimal repro)

| Bug | Class, depth | monkey | agent (15 frozen-prompt runs) | agent-persist | **agent-matched** | **workflow (10)** | workflow-random (10) | monkey-ref |
|---|---|---|---|---|---|---|---|---|
| GQ01 dash through a wall | collision, shallow | 0/5 | 1/15 | 0/5 (1 dropped) | **4/5** | 1/10 (incidental) | 0/10 | 3/5 |
| GQ02 enemy swap costs no life | collision, timing | 0/5 | 0/15 | 0/5 | 0/5 | 0/10 | 0/10 | 4/5 |
| GQ03 HUD misses dash coins | state desync, shallow | 0/5 | 1/15 | 0/5 | 0/5 | **9/10** | 8/10 | 5/5 |
| GQ04 HUD timer freezes after Resume button | state desync, shallow | 0/5 | 0/15 | 0/5 | 0/5 | 3/10 | 3/10 | 5/5 |
| GQ05 Restart from pause softlocks | softlock, shallow | 5/5 | 0/15 | 3/5 | 3/5 | 9/10 | 10/10 | 5/5 |
| GQ06 key lost in the death tick | softlock, timing | 0/5 | 0/15 | 0/5 (1 dropped) | **4/5** | 0/10 | 0/10 | 2/5 |
| GQ07 key toast covers Resume | UI overlap, timing | 0/5 | 0/15 | 0/5 | 0/5 | **8/10** | 9/10 | 4/5 |
| GQ08 bonus banner covers Finish | UI overlap, deep | 0/5 | 0/15 | 0/5 | 0/5 | **8/10** | 1/10 | 1/5 |
| GQ09 score int16 overflow | score overflow, deep | 0/5 | 0/15 | 0/5 | 0/5 | **9/10** | 9/10 | 5/5 |
| GQ10 spike penalty wraps score | score overflow, shallow | 0/5 | 7/15 | 4/5 | 4/5 | 3/10 | 3/10 | 5/5 |
| GQ11 move after pause in the same tick | input race, shallow | 0/5 | 4/15 | 1/5 (1 dropped) | **5/5** | 5/10 | 5/10 | 5/5 |
| GQ12 several arrows, several moves | input race, shallow | 0/5 | 1/15 | 0/5 | 2/5 | 2/10 | 5/10 | 5/5 |

"Dropped": counting every report an agent ever listed (review M1), `agent-persist` also had GQ01 (r5), GQ06 (r2) and GQ11
(r5) and then removed them from its list, so **GQ06 was found by a Haiku arm in the frozen series once and lost to the report
protocol**. GQ01 in `gqa1v/workflow` r1 is credited to a report about a different symptom (`goto:7,3, dash-right+up`, "a dash
and a step in one tick"): its 2-token repro is 1-minimal for the dash through the closed gate, so the oracle credits GQ01
with `classMatch` false. The two kinds of arm are **complementary**: the matched agent finds what shows in a trace as a
wrong position or a missing item (GQ01, GQ06, GQ10, GQ11) and never a HUD, layout or deep-score fault; the workflow finds
those (GQ03, GQ07, GQ08, GQ09) and almost never the first kind. In reps 1-4 the union of `agent-matched` rN and
`gqa1v/workflow` rN is 8, 9, 9, 9 bugs (rep 5: 5, the zero-check construction). The workflow reaches the end of the level
(GQ08 needs a completed level with a 1,000+ time bonus); random exploration and the agents almost never do.

## 6. Root causes: where each arm loses each bug

The $0 funnel ([`funnel.mjs`](../../experiments/gameqa-web/funnel.mjs), frozen, now tested; output in
`analysis/funnel-*.json`) replays every arm's own exploration and candidates on B1 with the probes on, and places every
(run, bug) pair at the furthest stage it reached. 60 (run, bug) pairs per arm:

| Arm | never triggered | triggered, not detected | candidate, not confirmed | confirmed, not reported | reported, not minimal | **foundMin** |
|---|---|---|---|---|---|---|
| `monkey` | 3 | **52** | 0 | 0 | 0 | 5 |
| `agent` | **51** | 4 | n/a | n/a | 0 | 5 |
| `agent`, no budget line | **45** | 10 | n/a | n/a | 0 | 5 |
| `gqa1v/agent` | **46** | 9 | n/a | n/a | 1 | 4 |
| `agent-persist` | **35** | 15 | n/a | n/a | 2 | 8 |
| `gqa2/agent-matched` | 13 | **21** | n/a | n/a | 4 | 22 |
| `workflow` | 2 | **16** | 0 | 9 | 1 | 32 |
| `gqa1v/workflow` | 1 | **20** | 0 | 11 | 3 | 25 |
| `workflow-random` | 4 | 7 | 0 | **13** | 4 | 32 |
| `gqa1v/workflow-random` | 6 | **16** | 0 | 10 | 7 | 21 |

Post hoc (`posthoc.mjs`, $0, labelled post hoc): (a) every confirmed candidate of a check-based arm scored as a report by
the oracle's own rule, and (b) each arm's own played runs scanned with the author's 22 oracle-informed checks, reproduced
and minimized: an upper bound for "this exploration with perfect checks".

| Arm | foundMin | (a) candidates could have credited | (b) its own exploration + perfect checks |
|---|---|---|---|
| `agent` (r1-r5) | 1, 1, 1, 1, 1 | n/a | 3, 2, 2, 1, 1 |
| `agent-persist` (r1-r5) | 2, 1, 1, 2, 2 | n/a | 4, 5, 2, 4, 5 |
| `gqa2/agent-matched` (r1-r5) | 4, 4, 5, 4, 5 | n/a | **8, 8, 10, 9, 9** |
| `monkey` (r1-r5) | 1, 1, 1, 1, 1 | 1, 1, 1, 1, 1 | 10, 11, 10, 10, 11 |
| `workflow` (r1-r5) | 8, 8, 6, 5, 5 | 8, 8, 6, 5, 5 | 11, 12, 11, 10, 10 |
| `gqa1v/workflow` (r1-r5) | 7, 6, 7, 5, 0 | 7, 6, 7, 5, - | 11, 11, 12, 11, 10 |
| `workflow-random` (r1-r5) | 7, 7, 6, 5, 7 | 8, 7, 6, 6, 7 | 11, 10, 11, 11, 11 |
| `gqa1v/workflow-random` (r1-r5) | 5, 5, 6, 4, 1 | 5, 6, 6, 4, 1 | 10, 11, 10, 11, 9 |

Reading: with the frozen prompt and stop rule, exploration is the agent's bottleneck (its play could yield at most 1-5 with
perfect checks); matched, its exploration reaches 8-10 and **detection** becomes its bottleneck (21 of its 60 pairs are
"triggered, not detected": the HUD desyncs 9 of 10, the key toast over Resume 4 of 5; it never compares the HUD with the state
or checks what covers a button). The monkey's bottleneck is detection (52 of 60). The workflow's is **check construction**
(16-20 "triggered, not detected"). The judge never discarded a candidate that the oracle would have credited to a bug the
workflow then missed (column (a) equals foundMin in every workflow run).

### 6.1 The frozen agent: it stops, and it does not explore when made to continue

- **Premature termination, 15 of 15 runs** (gqa1, gqa1nb and the A2 replication gqa1v). With or without the CLI budget line
  the agent answers `finish` right after its first confirmed bug: 3-6 turns of 40, 8-46 ticks of 8,000, one seed (Mercury
  with the same prompt uses all 40 turns, §6.6). 9 of the 10 final notes list what it did not test
  ("Not explored: enemy collisions, keys and doors, levers and gates, timer expiry, dialogs"). Without the line it gives
  other reasons, all false: "the tick budget is nearly used up", "the turn budget is nearly used up", "Budget is nearly
  spent" (`analysis/agent-behaviour.json`). The scarcity is the model's own confabulation: the prompt shows "Tick budget
  left: 7974" and says "when the budget runs out your last list is final", and the CLI adds `<total_tokens>15000000 tokens
  left</total_tokens>`; nothing says the budget is low.
- **Refusing the finish buys little exploration, and the report protocol threw some of it away.** `agent-persist`
  answers `finish` on 21-30 of its 40 turns (20-29 of them refused), plays 10-19 runs and 66-252 ticks (≤ 3% of the
  budget), on 1-2 seeds. 35 of its 60 (run, bug) pairs were never triggered; the key-toast, late-room and exit faults
  (GQ07, GQ08, GQ09) in none of its 5 runs. **Correction (review M1):** the frozen protocol made the agent's report list
  replace itself every turn, and only the last list was scored. Scoring every report the agent ever listed
  (`rescore-union.mjs`, post hoc) gives 2, 2, 1, 2, 4 instead of 2, 1, 1, 2, 2 (mean 2.2, 0 false reports): r2 listed a
  1-minimal repro of **GQ06** (key lost in the death tick, `down ×4, right ×3`) from turn 3 to turn 9 and then dropped it,
  and r5 listed **GQ01** (`right, dash-down`, the reference repro) and **GQ11** (`pause+right`) from turns 4-7 to 18 and
  dropped both. On that count S4 reads p = 0.048 two-sided, difference 1.2 (post hoc, not a preregistered test). The plain
  agent arms lose nothing this way (they stop after one bug). Two design limits of the arm (review m4): a refused finish
  clears the last trace from the next prompt (a trace the agent had just read), and the turns spent on refused finishes are
  the agent's own repeated `finish` answers. The A2 matched agent replaces refusals with fresh sessions and files reports
  append-only (§4, §6.5).
- **Its prompt also pushed it towards short runs (review M2).** The frozen agent prompt says "prefer short, focused runs"
  and never names `goto`; the persona prompt says "goto:x,y is a convenient way to walk". In the 15 frozen-prompt agent runs
  (gqa1, gqa1nb, gqa1v), 1 of 56 runs used `goto` and no run was longer than 16 tokens; the persona plans used `goto`
  165-316 times a workflow run (about 50 plans). This is a confound of H1, not only a model trait; A2's matched agent removes it (test C1).
- **What the workflow supplies instead:** code owns the stop condition and the volume (about 50 persona plans, 1.4-2.9k
  ticks, every room), code evaluates every check on every tick (detection does not need attention), and code reproduces and
  ddmin-minimizes, so every reported repro is 1-minimal for the check that fired.


### 6.2 The monkey: it triggers almost everything and detects one thing

Random input made 52 of 60 (run, bug) pairs manifest, but its two generic detectors (page error, state frozen 30 ticks
with no dialog) can only see the Restart softlock (GQ05, 5/5). With the author's checks the same exploration finds
10-11 (column (b)); with them `monkey-ref` finds 9.8. On this small level, random exploration is cheap and sufficient;
the value is in the oracle.


### 6.3 The workflow: its checks miss three bugs, and once there were no checks at all

**Across 10 constructions**, GQ02 and GQ06 were never found and GQ01 once, incidentally (§5), although the workflow's
exploration triggered each of them in nearly every run (`analysis/funnel-*.json`, `perBug`). Each has one repeatable cause:

| Bug | What Haiku wrote (examples, verbatim ids) | Why it cannot fire | Failure mode of the constructor |
|---|---|---|---|
| GQ01 dash through a one-tile wall | `player-not-in-wall`, `no-walk-into-wall-or-door`, `player-not-in-solid`, `player-on-passable-tile`: "the player never stands on a wall" (one such check in each of the 5 frozen runs, nothing about the path) | the dash lands on a free tile; only the path crosses the wall | **state invariant where a transition invariant is needed** (the language has `prev` and `tile(prev, x, y)`, so "no solid tile between the old and the new position" is expressible) |
| GQ02 swapping tiles with an enemy costs no life | r2 `enemy-contact-costs-life`: "Ending a tick on an enemy's tile ... costs one life"; r3-r5 check what follows a `hit` event (`hit-costs-one-life`, `lives-drop-one`, `no-life-loss-without-cause`); r1 has no contact check | a swap never ends on the same tile, and a missed swap produces no `hit` event | **a dropped clause**: the spec's rule is "ending a tick on the same tile **or** swapping tiles"; no construction encodes the second disjunct |
| GQ06 key picked up in the tick you lose a life is lost | `respawn-keeps-keys` (r3): `when respawn, expect cur.keys >= prev.keys`; `keys-drop-only-door` (r5) | the key never reaches the counter, so the counter never drops | **a proxy property**: counter monotonicity instead of conservation (the key tile vanished, so keys must have gone up) |

These are exactly the three check shapes for which the template gives no example (its examples are a cap, a
nothing-changes-in-this-mode rule and a display-equals-state rule; `analysis/leakage-map.json`). The matched agent, which
reads traces instead of writing checks, finds GQ01 and GQ06 in 4 of 5 runs each (§6.5).

**A new failure in the replication: a construction with zero usable checks (`gqa1v` r5).** Haiku wrote all 30 checks
against a bare `state` (`"expect": "state.lives >= 0 && state.lives <= 5"`) instead of `cur.state`; the checks parse, so
the construct node's only verification (that every check parses) passed and no repair call was made; the smoke run then
raised "unknown name 'state'" for all 30, the workflow dropped them silently and played its three persona rounds with only
the two generic detectors, and reported nothing (foundMin 0; its paired `workflow-random` r5, with the same empty
construction, found only the Restart softlock, like the monkey). The other nine constructions had 0 smoke errors. Root
cause, two parts: the template's check-language text says "state is the game's test API state", which invites the bare
name; and the template sends parse errors back for repair but drops evaluation errors without repair and without an alarm.
Both are template fixes (next steps); this one run moves the replication's mean from 6.25 to 5.0 and is the reason C1 and
R2 fail.

The other losses are **triage**, not checks: "confirmed, not reported" (9 and 11) means a confirmed candidate's repro made
the fault manifest on the way to another check's violation and was credited to that other bug (a spike wrap seen on the way
to an int16 overflow under the same `score-range` signature; an input race seen on the way to the Restart softlock). One
(check, screen) signature hides a second fault when one check guards both on the same screen. With random exploration the
ten constructions give 7, 7, 6, 5, 7, 5, 5, 6, 4, 1: the run-to-run spread comes from which checks Haiku happens to write.

**How the found bugs are caught (leakage trace, post hoc, review M4).** For every bug a workflow run found,
`leak-trace.mjs` takes the Haiku check that caught it and measures how much of the fault's own spec sentence it restates
(`analysis/leak-trace.json`). Seven of the ten distinct bugs the workflow found were caught by checks that restate that
sentence (mean content-word overlap per bug: GQ05 0.68, GQ07 0.98, GQ08 1.0, GQ09 0.87, GQ10 0.73, GQ11 0.65, GQ12 0.44);
the clickability faults, for example, by "Every visible button must be clickable: nothing may cover it." copied word for
word, a sentence that exists in the spec because the author injected UI overlaps. The two HUD desyncs (GQ03, GQ04) were
caught through the generic HUD rule ("The HUD bar always shows the current values", overlap with the fault sentence 0-0.04),
and GQ01 incidentally. So most of the workflow's detections ride on spec sentences written after the faults.

### 6.4 Persona exploration vs random exploration (H4, R4)

No difference on the mean in either series (6.4 vs 6.4; 5.0 vs 4.2, p = 0.34), different bugs. Persona plans walk the
whole level and finish it (every construction kept the template's six R08 archetypes, among them the completionist mapper
and the sequence-breaker), so the deep bonus-banner overlap GQ08 is found in 8 of 10 persona runs and 1 of 10 random runs;
random input presses more multi-key combinations (GQ12 5/10 vs 2/10). Random exploration plays all 8,000 ticks; the
personas play 1.4-2.9k (3 rounds × ≤ 6 personas × ≤ 3 plans). At about $0.053 a run, persona planning is 79% of the
workflow's spend and buys no mean capability on this level.

### 6.5 The matched agent and the cost-matched comparison (review M2, M3)

**What changed when the agent was matched.** The A2 agent differs from the frozen one in four ways at once (prompt
wording, append-only reports, code-owned restarts, 18× the dollars), so C3 (4.4 vs 0.8, p = 0.008) measures the bundle, not
each part. What it did: 9-15 sessions a run of 1-15 turns each (it still answers `finish` after a few turns in every
session, and 8 of its 54 `finish` notes give a limited budget as the reason, "Session budget is limited, so I'm finishing",
although nothing it is shown says the budget is low), 55-63 runs and 781-864 ticks a run (about 10% of the
tick budget), `goto` in 26-36 runs, runs of at most 18 tokens. Code-owned restarts are what keep it going: without them each
run would have ended after its first session, as the frozen agent's did. Its exploration then reaches 8-10 bugs with
perfect checks (§6, post hoc (b)), and it detects the ones a trace shows as a wrong position, a missing item or a wrong
score (GQ01, GQ06, GQ10, GQ11), never a HUD, layout or deep-score fault. In 7 of its 350 turns it claimed it had no game
harness ("the only tool I can call is StructuredOutput"), an artifact of the CLI's structured-output tool, not of the arm.

**Cost-matched restart curve (post hoc, `cost-matched-report.mjs` on `cost-matched.mjs`, review M3).** Restarting the
cheap frozen agent and pooling its bugs is the cheapest counter-baseline: for the 15 frozen-prompt Haiku agent runs
(pooled; S2/S2v show the budget line changes nothing), the expected number of distinct bugs found by k restarts, exact
over all k-subsets, is 0.93 bugs at 1 run ($0.004), 2.5 at 4 ($0.015), 3.6 at 8 ($0.031), 4.4 at 12 ($0.046) and 5.0 at
all 15 ($0.058; their union is GQ01, GQ03, GQ10, GQ11, GQ12). Counting every report ever listed changes nothing for these
arms. Against the workflow's targets (`analysis/cost-matched.json`): at the dollars of a stand-alone random-exploration
workflow run ($0.0154 with its construction) the restarting agent expects 2.5 bugs against 6.4 (frozen) or 4.2 (`gqa1v`);
the persona workflow's $0.065-0.067 is beyond all 15 runs together, which reach 5.0 for $0.058, against 6.4 or 5.0 a run.
The live matched agent answers the same question with the prompt and report fixes included: at the persona workflow's
dollars it finds 4.4 a run, against 6.4 / 5.0 for the workflow and 6.4 / 4.2 for `workflow-random` at a fifth of the cost.

**Reading.** The frozen agent's "1 bug, then stop" was mostly its handicaps; matched, a solo Haiku agent is a real QA
baseline here. The workflow's remaining advantages are (1) cost: the random-exploration variant gets as much for about
$0.014 a run (C2: no difference at 0.2× the dollars); (2) coverage of a different bug kind, the HUD, layout and deep-score
faults that need a per-tick check rather than a reader's attention; and (3) 1-minimal repros by construction (every
workflow report is 1-minimal for its check; 4 of the matched agent's 60 (run, bug) pairs ended "reported, not
minimal").

### 6.6 Mercury 3 (E1, exploratory, descriptive only)

Mercury 3 ran the preregistered E1 lane after two configuration fixes (A3, A4); $0 listed, 1.70M tokens in all.
- **Agent (frozen agent prompt and protocol):** 3, 4, 7 bugs (mean 4.7, 0 false reports in its final lists), against 1.0 for Haiku with the
  same prompt. Mercury does not stop early: all three runs used their 40 turns (28-34 runs, 262-324 ticks, `goto` in 4-10
  runs), and it found the key-lost-on-hit fault in 3 of 3 runs and, in r3, both HUD desyncs (union GQ03, GQ04, GQ05, GQ06,
  GQ10, GQ11, GQ12). 5-11 of its 44-47 calls per run were truncated at the 12k-token output cap that applied under A3 (A4
  kept these runs as results). So the frozen agent's early stop is a Haiku trait, not a property of the protocol.
- **Workflow:** no number. In all three reps Mercury did not produce a usable construction: one answer missed a required
  field (`expect`) and the other three attempts ran to the A4 cap (30.8k-31.3k output tokens, against 9-20k for Haiku's
  constructions), so no personas or checks existed and the paired `workflow-random` runs had nothing to reuse (excluded as
  runner exceptions). This is model behaviour under the frozen template (one schema retry, no retry on truncation), so the
  three workflow runs count as 0. Descriptive only, K = 3, no comparison is claimed.

## 7. Harness faults, deviations and the CLI budget line

1. **Rate limits counted as results (A1).** On 2026-10-28 the construct call of `workflow` r3-r5 failed with HTTP 429
   (`MODEL_RATE_LIMIT`), so those runs ended with no model output, and 2 of 3 judge calls of `workflow-random` r2 failed the
   same way. The frozen `analyze.mjs` excluded only runner exceptions, so it would have scored the three empty workflow runs
   as foundMin 0 and reported H1 "not supported" (8, 8, 0, 0, 0 vs 1 × 5, p = 0.80). PREREG §6 already defines such runs as
   harness faults; A1 made the script apply that rule (a test covers it), kept the runs in `runs/_harness-fault/` and re-ran
   them under the same run ids; every paid call now goes through a logged rate-limit retry. No retry was needed on
   2026-11-04.
2. **Deviation D1 (recorded in A2, review M5).** §6 says that after a harness fault "the paid reps restart at 1"; A1 re-ran
   only the faulted reps, after the first two workflow reps (8, 8) and the agent's 1 × 5 were known. That put two CLI
   versions into H1 (`analysis/cli-versions.json`). Answered by the full single-version replication `gqa1v` (R1 supported).
   **D2:** A1's harness-fault codes also counted `MODEL_PROTOCOL`, `MODEL_TIMEOUT`, `MODEL_BUDGET` and `ERROR`; from A2 only
   `MODEL_RATE_LIMIT` and `MODEL_UNAVAILABLE` count (a timeout can be the model's doing). Only `MODEL_RATE_LIMIT` ever
   occurred, so no exclusion changed (test). **D3/D4:** S2 confounded the budget line with the CLI version (S2v answers it:
   no difference on one version), and `meta.json` lacked the CLI version (recovered from the journals; A2 runs record it).
3. **The CLI writes a budget line into every model context.** Claude Code 2.1.318 adds a meta message
   `USD budget: $<used>/$<cap>; $<remaining> remaining` whenever `--max-budget-usd` is passed (observed code: the
   `budget_usd` attachment), and the repo's provider always passes it (`src/models/providers/claude-cli.mjs`, `args()`); it
   also adds `<total_tokens>15000000 tokens left</total_tokens>` with or without the flag. All 5 frozen agent reps stopped
   after 4-6 of 40 turns, 12-26 of 8,000 ticks, saying the budget was nearly spent. A diagnostic replay ($0.015,
   `diag/budget-line.json`) of each finishing turn, 2× with and 2× without the flag: `finish` 7/10 vs 7/10; explicit
   budget-stop phrases 6/10 vs 0/10. Full runs without the line (`gqa1nb/agent`) and, on one CLI version, S2v: the same 1 bug
   per run and the same early stop. **The line changes what the agent says, not what it does.** The `nb` transport now
   fails loudly when it cannot drop the flag, and every A2 call logs whether it carried it (review m2).
4. **The preregistered Mercury path could never run (A3).** All 9 E1 attempts under A2 failed at port creation
   (`MODEL_POLICY_INVALID: models must be a non-empty list`): `run.mjs` built its policy subset from `[mercury-3]` alone,
   and `subsetPolicy` keeps executor models out of `models`. It had been preregistered on 2026-10-28 and never smoke-tested.
   Fixed by listing Haiku next to it (the repo's own pattern); every call still names `mercury-3`.
5. **Mercury's output cap was below what the construct node needs (A4).** Under A3 the three Mercury constructions stopped
   at the 12,000-token output cap set on 2026-10-28 (`MODEL_TRUNCATED`); Haiku's ten constructions used 8.9k-20.1k output
   tokens. The cap was raised to 32,000; the six faulted runs are kept in `runs/_harness-fault/` and were re-run.
6. **Lost run.** `monkey-ref` r3 died with the 2026-10-28 session's container; re-run.
7. **`chain.sh` logged `exit 0` for every run** (the status of `$(date …)`); fixed in A2 (the A3/A4 logs show real `exit 1`).
8. **`/tmp` residue (review m8).** Runs and the browser test files now give Playwright their own short-lived `TMPDIR`
   (a short path: Chromium does not start when `TMPDIR` is long). The 21 empty `playwright-tracing-*` folders whose times
   fall inside GQA-1 run windows were removed with `rmdir` (other experiments ran in the same windows, so some may have been
   theirs; all were empty and hours old).

## 8. Cost and time

| Item | Haiku USD |
|---|---|
| 2026-10-28, frozen arms (agent ×5, workflow r1-r2, workflow-random r1) | 0.1634 |
| 2026-10-28, harness-faulted runs (kept, excluded) | 0.0033 |
| 2026-11-04, budget-line diagnostic (22 calls) | 0.0150 |
| 2026-11-04, A1 re-runs (workflow r3-r5 $0.1974, workflow-random r2-r5 $0.0302) | 0.2276 |
| 2026-11-04, A1 secondary arms (agent no line ×5 $0.0199, agent-persist ×5 $0.1758) | 0.1957 |
| 2026-11-04, A2 replication `gqa1v` (workflow ×5 $0.3237, workflow-random ×5 $0.0261, agent ×5 $0.0205) | 0.3703 |
| 2026-11-04, A2 matched agent `gqa2` ×5 | 0.3376 |
| E1 Mercury (A3, A4) | $0 listed (1.70M tokens) |
| **Total** | **1.3128** (cap $3.00; spend stop $2.50 never reached) |

Per workflow run: construct about $0.008 (1 call, 9-20k output tokens), persona exploration about $0.053 (18 calls), judge
about $0.006 (2-3 calls). Output tokens dominate (Haiku 5.5 at $0.50 per MTok out); the system prompt with the 11.5k-character
design document is cached. Wall time per workflow run 130-290 s; per matched-agent run 506-644 s (66-72 sequential calls).
The A2 review fixes cost $0.708, within the original $3 cap.

## 9. Honest reading

- **What is shown (development evidence, preregistered):** on one browser game with 12 injected faults, a QA workflow that
  Haiku instantiates from a frontier-written template finds 5-6 of 12 bugs per run with valid, 1-minimal, replayable repros
  and no false report, for about $0.065 (personas) or $0.014 (random exploration), where Haiku alone with the frozen agent
  protocol and a random monkey find 1. This replicates on one CLI version (R1) and pooled over ten runs (P1).
- **What the review changed.** The 5.4-bug gap of H1 was mostly the frozen agent's handicaps. With the persona prompt's
  wording, an append-only report log, code-owned restarts and the workflow's dollars, Haiku alone finds 4.4 a run, and the
  preregistered same-day comparison with the workflow (C1) does not show a win (5.0 vs 4.4, p = 0.107; post hoc 1.3-2.0
  bugs pooled or against the frozen series). "Structure beats model size" holds here only in a narrower form: what the
  agent needed from structure was a code-owned stop rule and a report log that cannot lose findings; given those, its own
  exploration reaches 8-10 bugs, and its limit is attention.
- **Where the workflow still wins:** cost (the random-exploration variant matches the matched agent at a fifth of its
  dollars, about $0.003 per found bug against $0.015), a different and complementary bug class (HUD, layout and deep-score
  faults, which the matched agent never reports), and repros that are 1-minimal by construction. A combination is the
  obvious next arm: per rep, the union of the matched agent and the workflow is 8-9 of 12.
- **What it does not show.** Not held-out, and the spec leaks the fault set: the same session wrote the build, the faults,
  the spec, the template and the heuristics, after the faults; every fault has a normative spec sentence written for it, 7 of
  the 10 bugs the workflow found were caught by checks restating that sentence, the report class enum is exactly the
  injected classes, and the three bugs the workflow never finds are the three check shapes the template gives no example of.
  The leak reaches every arm equally (the comparisons vary structure), but the absolute counts say little about an unseen
  build. One level, one build, K = 5 per arm. No vision: "visual" here means DOM layout through `elementFromPoint`, not
  pixels (the policy's CLI route is text only). E2 is therefore **partial**: development evidence on a single-author,
  DOM-only bed.
- **Fragility found:** one of ten Haiku constructions produced no usable check and the workflow ran on, silently, with
  none (§6.3). A workflow whose verification only parses its own checks can fail completely without saying so; that is a
  template defect, now root-caused.
- **The ceiling and the bottleneck.** With the author's oracle-informed checks, random exploration reaches 9.8 and both the
  workflow's and the matched agent's own play 8-12 (post hoc). Both arms lose at detection; the workflow because Haiku's
  checks miss transition, second-clause and conservation rules, the agent because it does not compare the HUD or the layout
  with the state.
- **Negative results kept:** H3 (the frozen agent is no better than random input); H4 and R4 (personas add no mean
  capability, at 79% of the spend); C1 and C2 (no significant workflow win over the matched agent); R2 (the replication
  does not beat the monkey because one run found nothing); GQ02 found by no Haiku run (45 runs, every report ever listed included); the agent's report
  rewriting threw away GQ06, GQ01 and GQ11 in `agent-persist` (§6.1); the frozen analysis would have misread three
  rate-limited runs as zeros; the agents' "budget" reasons are confabulated (frozen and matched); the preregistered Mercury
  path could not run until two configuration faults were fixed (A3, A4).
- **Repo-wide finding (not GQA-specific):** every `claude -p` call made through `src/models/providers/claude-cli.mjs`
  carries `USD budget: $<used>/$<cap>; $<remaining> remaining` (and a `<total_tokens>` line) in the model's context. Here it
  changed the agent's stated reasons, not its behaviour; any arm whose model decides when to stop, or reasons about cost,
  is exposed to it.

## 10. Next steps

1. **Template robustness (cheapest, measured as a new preregistered arm):** send evaluation errors from the smoke run back
   through `construct-repair` (one call; it would have fixed `gqa1v` r5's `state.x` checks), refuse to explore with zero
   checks, and state in the check-language text that `state` is reached as `cur.state`.
2. **Hybrid arm:** the workflow's per-tick checks plus a trace-reading agent node with the matched agent's protocol (fresh
   sessions, append-only reports) that turns anomalies into reports or new checks; the per-rep union of the two arms
   suggests 8-9 of 12. Cost to beat: the matched agent's $0.068.
3. **Construction fixes for the three never-found shapes:** one transition check per movement rule ("nothing solid
   between `prev` and `cur`"), one check per clause of every disjunctive rule, conservation checks for every collectible;
   measured with `workflow-random` (about $0.02 a run). Cheaper first step (review): pool the checks of the ten existing
   constructions and run random exploration with the judge only (about $0.01 a run).
4. **Held-out, author-blind bed (review M4, owner ask):** a second level whose faults are written by a separate author who
   never saw the template, the heuristics or this spec, with a spec written before the faults; or, as a partial
   substitute, automated mutants of the clean `game.js` filtered by the differential audit. Both need a driver change (the
   frozen driver loads `game.js` from a fixed path) and a new freeze; they are a new experiment, not a fix to this one.
5. **Vision:** a pixel pass needs an image-capable route in the policy (none today on the CLI route).
6. **Transport:** make the provider's `--max-budget-usd` optional (a narrow option, so other experiments' replay keys and
   caps are untouched); re-check agent-style arms elsewhere (OT-0, AutomationBench agents) for stop decisions that cite a
   budget.
7. **Mercury:** the agent result (4.7 with the frozen prompt, no early stop) makes Mercury worth a matched-agent arm; the workflow needs a construct node that fits Mercury's verbosity (checks constructed in batches of 10, or a truncation retry with a shorter answer) before it has a number.

## 11. Independent review (2026-11-04) and what was done about each finding

The review re-derived every number from the frozen data (spend $0.6044, every `FREEZE.json` hash, byte-identical
`analyze.mjs` output) and confirmed H1/H2; it found no blocker, six major and ten minor defects. Each is handled below; where
the fix needed new data, it was preregistered as amendment A2 and frozen (`amendments[1]`, commit `256daf5f`) before any
governed call. Where the review is not followed in full, the row says why.

| # | Finding | Agreed? | What was done | Evidence |
|---|---|---|---|---|
| M1 | The agent's report list replaced itself every turn, so found bugs were lost; "GQ06 never found by any Haiku arm" and "GQ01 only once" are false | **Yes** | `rescore-union.mjs` scores every report an agent ever listed (post hoc for A1 runs; secondary metric for gqa1v). `agent-persist` goes from 2, 1, 1, 2, 2 to 2, 2, 1, 2, 4 (r2 listed a 1-minimal GQ06 repro at turns 3-9, r5 GQ01 and GQ11 at turns 4-18, then dropped them), 0 false reports; the plain agent arms do not change. The new matched agent files reports append-only. §5, §6.1 and §9 corrected | `analysis/report-log-rescore.json` |
| M2 | The agent prompt says "prefer short, focused runs" and never names `goto`; the persona prompt does | **Yes**, and it mattered | Measured: in the 15 frozen-prompt agent runs, 1 of 56 runs used `goto` and none exceeded 16 tokens; persona plans used `goto` 165-316 times a workflow run. The A2 matched agent (persona wording, append-only reports, restarts, the workflow's dollars) finds 4.4 vs 0.8 (C3, p = 0.008); against it the workflow's same-day lead is 0.6, not significant (C1) | §4, §6.5 |
| M3 | H1 is not cost-matched (18.6×) | **Yes** | Post-hoc restart curve over the 15 frozen-prompt agent runs (`cost-matched-report.mjs`: 2.5 bugs at the random workflow's $0.0154, 5.0 for all 15 runs at $0.058) and a live cost-matched arm (agent-matched, $0.068 a run: 4.4). At matched dollars the workflow's lead is 0.6 (same day, n.s.) to 2.0 (frozen series, post hoc); the random-exploration workflow matches the matched agent at a fifth of its cost | §4, §6.5 |
| M4 | The spec, the class enum and the check examples leak the fault set beyond the stated threat | **Yes** for the disclosure; the author-blind fault set is **not built** here | Disclosure in §9 and A2: every fault has a spec sentence (`analysis/leakage-map.json`, tested), 7 of the 10 distinct bugs the workflow found are caught by checks that restate their fault's sentence (`analysis/leak-trace.json`), the class enum is the injected classes, and the never-found bugs are the three check shapes with no example. An author-blind set needs a new bed and a second author (the driver loads `game.js` from a fixed path, so mutants need a driver change and a new freeze); it is next step 4. Disagreement in part: GQA-1 is labelled single-author development evidence throughout; an author-blind set is a new experiment, not a fix that can be applied to this one | §6.3, §9, §10 |
| M5 | A1 re-ran only faulted reps instead of restarting at 1 (version confound); exclusion codes wider than needed | **Yes** | Recorded as deviations D1/D2; full single-version replication `gqa1v` (all primary arms, reps 1-5, CLI 2.1.318 at the start and end of every run): R1 supported (5.0 vs 0.8, p = 0.048), R2 not (one run with zero checks); codes narrowed to rate limit / unavailable (no exclusion changes) | §4, §7, A2 |
| M6 | E2 marked closed beyond what was shown | **Yes** | Coverage row: "D (game QA: dev, single-author, DOM-only); ⚠ visual; ⚠ held-out" (D = development evidence in that file's legend; it was "D (game QA)" alone), with H4, the $0.015 variant, the replication and the matched agent | `REQUIREMENTS-COVERAGE-20261021.md` E2 |
| m1 | `meta.json` lacks the CLI version | Yes | A1 runs: versions copied from the local journals; A2 runs: `meta.cli` {start, end} | `analysis/cli-versions.json` |
| m2 | `nb` silently does nothing without the provider or the flag | Yes | It now throws; a preflight refuses to start a run whose arguments do not match its transport label; every call logs whether it carried the flag (`cli-args` rows) | transport tests |
| m3 | 21 of 54 workflow reports are duplicates; "54 regression tests" is 9 unique | Yes | Stated in §3: 54 reports = 33 distinct bug finds + 21 duplicates; the regression pack holds 9 tests, one per distinct bug. Replication: 36 reports, 8 duplicates, all 36 valid regression tests, a pack of 8 | `analysis/regression-pack-workflow*.json` |
| m4 | A refused finish wipes the last trace; refusals use 20-29 of 40 turns | Partly | True, and stated; but the trace wiped is one the agent had just read, and the refusals are its own repeated `finish` answers (the matched agent, with no refusals, still answers `finish` after 1-15 turns in every session). The matched agent replaces refusals with fresh sessions; `agent-persist` itself was not re-run | §6.1, §6.5 |
| m5 | The leakage tests check only literal names | Yes | Stated in A2 and §9; a new test keeps the leakage map (the paraphrase disclosure) in step with the spec | analysis test |
| m6 | `funnel.mjs`, `posthoc.mjs`, `regress.mjs` untested | Yes | 7 new tests on synthetic runs (also `rescore-union.mjs`, `cost-matched.mjs` and the leakage map) | `gameqa-web-analysis.test.mjs` |
| m7 | Stale triage comment | Yes | Fixed in `arms.mjs` (A2) | |
| m8 | `/tmp` residue | Yes | Runs and the browser test files use their own short-lived `TMPDIR`; 21 empty `playwright-tracing-*` folders whose times fall in GQA-1 run windows were removed with `rmdir` (other experiments ran in those windows, so some may have been theirs; all were empty) | |
| m9 | Mercury dropped "for time" although it costs $0 | Yes | Run under A2-A4. The preregistered E1 path had two configuration faults nobody had seen (a policy subset holding only an executor model is invalid; a 12k output cap below what the construct node needs), both fixed before the runs they govern. Results in §6.6 | §6.6, §7 |
| m10 | S2 mixes the budget line with the CLI version | Yes | S2v compares the line on one version (`gqa1v/agent` vs `gqa1nb/agent`) | §4 |

## Files

| Path | What |
|---|---|
| `beds/gameqa-web/` | the bed: build, spec, truth, driver, oracle, tests (11; unchanged since the freeze except that the test file now scopes Playwright's temp folder) |
| `experiments/gameqa-web/arms.mjs`, `qa-lib.mjs`, `expr.mjs`, `prompts.mjs`, `template.json` | the arms (A2 adds `runAgentMatched` and its prompt) and the workflow template |
| `experiments/gameqa-web/run.mjs`, `chain.sh`, `freeze.mjs`, `transport.mjs` | runner (A2: `meta.cli`, transport preflight, per-run `TMPDIR`; A3/A4: Mercury port and cap), run chains, freeze and amendment manifests, transport (rate-limit retry, `nb`, per-call audit) |
| `experiments/gameqa-web/analyze.mjs`, `funnel.mjs`, `regress.mjs`, `rescore-union.mjs`, `cost-matched.mjs` | frozen analysis (A2 rule and comparisons), root-cause funnel, regression pack, report-log re-score, restart curve |
| `experiments/gameqa-web/posthoc.mjs`, `agent-behaviour.mjs`, `probe-budget-line.mjs`, `cost-matched-report.mjs`, `leak-trace.mjs`, `cli-versions.mjs` | post-hoc analyses (labelled so), the budget-line diagnostic, the CLI-version extract |
| `experiments/gameqa-web/gameqa-web-arms.test.mjs`, `gameqa-web-transport.test.mjs`, `gameqa-web-analysis.test.mjs` | arm tests (10, scripted model, $0), transport and analysis-rule tests (7), analysis-script tests (7) |
| `research/gameqa-20261021/PREREG-GQA-1.md`, `FREEZE.json` | pre-registration with amendments A1-A4; bed, arms and four amendment manifests |
| `research/gameqa-20261021/runs/` | every scored run (`meta`, `reports`, `score`, `stats`, `calls.jsonl` without prompts), chain logs, `_harness-fault/` (A1 and A4 faulted runs) |
| `research/gameqa-20261021/analysis/` | `analyze.md`/`.json`; funnel (batches 1-5 + summary); post-hoc (batches 1-3); `report-log-rescore.json`; `cost-matched.json`; `leakage-map.json`; `leak-trace.json`; `cli-versions.json`; agent behaviour; regression packs (`regression-pack-workflow.json`: 9 tests, frozen series; `regression-pack-workflow-gqa1v.json`: 8 tests) |
| `research/gameqa-20261021/diag/budget-line.json` | the budget-line diagnostic |
