# RESULT GQA-1: deep QA of a browser game build (requirement E2)

| Field | Value |
|---|---|
| Owner ask | E2, the brief's flagship generalisation example: "deep QA of a game build (visual passes, explorer personas, playback / repro / minimize; R08 has a reference design)" |
| Evidence class | **development (diagnostic)**. One bed, one level, one author for the build, the faults, the spec and the template. No sealed claim. |
| Pre-registration | [PREREG-GQA-1.md](PREREG-GQA-1.md) (frozen 2026-10-28 before the first model call, `FREEZE.json` `arms`), amendment **A1** (2026-11-04, frozen as `FREEZE.json` `amendments[0]` before any run it governs) |
| Bed | [`beds/gameqa-web`](../../beds/gameqa-web/) 1.0.0, *Lantern Vault*: plain HTML/JS, lockstep, seeded (determinism class D0), driven by Playwright on the preinstalled Chromium |
| Injected-bug set | 12 faults, 6 classes × 2 (collision, state desync, softlock, UI overlap, score overflow, input race), hidden truth `beds/gameqa-web/truth/bugs.json`, truth-set hash `106bead4…ddbb270`, bed manifest `ba728598…a4701e95`, both frozen before any model call |
| Model | `claude-haiku-5-5` (class M, `policy/models.json`), through the repo's ModelPort and the Claude CLI provider, effort `low`, text only |
| Runs | 2026-10-28 (frozen arms) and 2026-11-04 (A1 re-runs and secondary arms); 35 scored runs (7 arms × 5), 7 harness-faulted runs kept as raw data |
| Spend | Haiku **$0.605** in all (cap $3.00, spend stop $2.50) |

## Bottom line

- **Capability number vs simple baselines (development evidence, K = 5):** the cheap-built QA workflow finds **6.4 of 12**
  injected bugs per run with a valid, 1-minimal, replayable repro (8, 8, 6, 5, 5), against **1.0** for Haiku exploring alone
  (1, 1, 1, 1, 1) and **1.0** for the random monkey (1, 1, 1, 1, 1). H1 (workflow > agent) and H2 (workflow > monkey) are
  supported: complete separation, exact one-sided p = 0.004, difference 5.4 bugs. **Zero false reports in every arm.** All
  54 workflow reports replay as regression tests that fail on the faulty build and pass on the clean one.
- **Cost:** workflow $0.067 a run ($0.010 per found bug, 21 Haiku calls, about 4 minutes); agent $0.004 a run; monkey $0.
  Total GQA-1 Haiku spend **$0.605** of the $3 cap.
- **H3 not supported:** Haiku alone is no better than random input (1.0 vs 1.0). It stops after its first confirmed bug in
  10 of 10 runs (12-46 of 8,000 ticks). The CLI's hidden "USD budget" line is **not** the cause (S2: identical without
  it; Haiku then invents the scarcity itself: "the tick budget is nearly used up" with 7,900 ticks left). Refusing its
  early finish lifts it only to 1.6 (S4, not significant): it asks to finish again on 20-29 of its 40 turns and stays
  near the start (it never triggers the key-toast, late-room or exit faults in 5 runs).
- **H4: the personas add nothing on the mean.** Random exploration with the same Haiku-written checks also finds 6.4
  (7, 7, 6, 5, 7) at about a quarter of the cost (about $0.016 a run including the construction, against $0.067: persona
  exploration is 79% of the workflow's spend). Personas reach the deep UI-overlap bug (GQ08, 4/5 vs 1/5); random input
  reaches the multi-key race (GQ12, 4/5 vs 1/5).
- **Where the workflow loses:** not exploration (its own played runs, scanned post hoc with the author's oracle-informed
  checks, would yield 10-12 bugs) but **the checks Haiku writes**. Random exploration with the author's checks reaches 9.8
  (calibration ceiling). Three bugs were never found in the 5 workflow runs, each for one repeatable construction failure: state
  invariants instead of transition invariants (dash through a wall), a dropped clause of a rule (swapping tiles with an
  enemy), and a proxy property (key counter instead of key conservation).

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

**R08 mapping.** Implemented: personas (node 5), recorder and deterministic replay (3), executable invariants (7),
stall/softlock detection (9), repro and ddmin minimization (11), triage by signature (12), reporter with a model judge
(13), regression-test generator with a clean-build control (14, `regress.mjs`). Not implemented: visual tiers (8, no image
route), performance (10), a coverage-driven curriculum (4: the personas only see shared coverage counts), the
supervisor/healer (15).

## 3. Capability table (K = 5 runs per arm, 12 injected bugs per run)

| Arm | foundMin per run | mean (sd) | foundAny mean | false reports | reports (dupl.) mean | Haiku calls / run | USD / run | USD / found bug | wall s mean |
|---|---|---|---|---|---|---|---|---|---|
| `monkey` (baseline) | 1, 1, 1, 1, 1 | **1.0** (0) | 1.0 | 0 | 1.0 (0) | 0 | $0 | $0 | 101 |
| `agent` (Haiku alone, primary) | 1, 1, 1, 1, 1 | **1.0** (0) | 1.0 | 0 | 1.0 (0) | 4.8 | $0.0036 | $0.004 | 54 |
| `workflow` (cheap-built) | 8, 8, 6, 5, 5 | **6.4** (1.5) | 6.6 | 0 | 10.8 (4.2) | 21.4 | $0.067 | $0.010 | 251 |
| `workflow-random` (ablation) | 7, 7, 6, 5, 7 | 6.4 (0.9) | 7.2 | 0 | 12.4 (5.2) | 2.8 | $0.0076 + $0.0078 construction | $0.0024 | 299 |
| `agent`, no budget line (A1) | 1, 1, 1, 1, 1 | 1.0 (0) | 1.0 | 0 | 1.0 (0) | 4.6 | $0.0040 | $0.004 | 53 |
| `agent-persist`, no budget line (A1) | 2, 1, 1, 2, 2 | 1.6 (0.5) | 2.0 | 0 | 2.2 (0.2) | 40 | $0.035 | $0.022 | 442 |
| `monkey-ref` (calibration: oracle-informed checks) | 8, 9, 11, 10, 11 | 9.8 (1.3) | 10.8 | 0 | 21.6 (10.8) | 0 | $0 | $0 | 371 |

Across its 5 runs the workflow found 9 distinct bugs (union); the agent 4, the monkey 1. Raw tables:
`analysis/analyze.md` and `analysis/analyze.json` (frozen `analyze.mjs` with the A1 harness-fault rule).

`foundMin`: injected bugs with an oracle-credited, 1-minimal, replayable repro. `foundAny`: credited, minimal or not.
False reports: malformed or no injected fault fires. USD: the CLI's reported cost. Wall: exploration + minimization +
judging (scoring excluded); the host ran other experiments, so wall time is noisy (the game is lockstep, so load cannot
change an outcome).

## 4. Pre-registered tests (exact one-sided Mann-Whitney on per-run foundMin; supported iff p ≤ 0.05 and mean difference ≥ 1)

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

Falsifiers (§6): H1 is supported and the workflow's false reports (0) do not exceed the agent's (0), so neither falsifier
fires. The power statement of §4 holds: only a large, consistent effect could pass, and H1/H2 are at complete separation.

**Version confound (found after the runs).** The CLI moved from 2.1.312 (2026-10-28: `workflow` r1-r2, `agent`,
`workflow-random` r1) to 2.1.318 (2026-11-04: `workflow` r3-r5, the other `workflow-random` reps, both A1 agent arms). The
workflow's 8, 8 (old CLI) vs 6, 5, 5 (new CLI) may be chance or the version; K is too small to tell. H1 holds within the
new version alone: `workflow` r3-r5 (6, 5, 5) vs the same-day `gqa1nb/agent` (1 × 5), exact p = 1/56 = 0.018 (a
post-hoc check, not a preregistered test).

## 5. Per-bug detection (runs with a 1-minimal repro / 5)

| Bug | Class, depth | monkey | agent | agent no line | agent-persist | workflow | workflow-random | monkey-ref |
|---|---|---|---|---|---|---|---|---|
| GQ01 dash through a wall | collision, shallow | 0 | 1 | 0 | 0 | **0** | 0 | 3 |
| GQ02 enemy swap costs no life | collision, timing | 0 | 0 | 0 | 0 | **0** | 0 | 4 |
| GQ03 HUD misses dash coins | state desync, shallow | 0 | 1 | 0 | 0 | 5 | 4 | 5 |
| GQ04 HUD timer freezes after Resume button | state desync, shallow | 0 | 0 | 0 | 0 | 3 | 3 | 5 |
| GQ05 Restart from pause softlocks | softlock, shallow | 5 | 0 | 0 | 3 | 5 | 5 | 5 |
| GQ06 key lost in the death tick | softlock, timing | 0 | 0 | 0 | 0 | **0** | 0 | 2 |
| GQ07 key toast covers Resume | UI overlap, timing | 0 | 0 | 0 | 0 | 4 | 5 | 4 |
| GQ08 bonus banner covers Finish | UI overlap, deep | 0 | 0 | 0 | 0 | **4** | 1 | 1 |
| GQ09 score int16 overflow | score overflow, deep | 0 | 0 | 0 | 0 | 5 | 5 | 5 |
| GQ10 spike penalty wraps score | score overflow, shallow | 0 | 2 | 3 | 4 | 3 | 3 | 5 |
| GQ11 move after pause in the same tick | input race, shallow | 0 | 1 | 1 | 1 | 2 | 2 | 5 |
| GQ12 several arrows, several moves | input race, shallow | 0 | 0 | 1 | 0 | 1 | **4** | 5 |

The agent arms only ever find what lies within a few tiles of the start (spikes at (3,3), the first coin, the first
wall), a one-token input race, or the pause-menu Restart softlock. The workflow reaches the end of the level (GQ08 needs a
completed level with a 1,000+ time bonus).

## 6. Root causes: where each arm loses each bug

The $0 funnel ([`funnel.mjs`](../../experiments/gameqa-web/funnel.mjs), frozen; output in `analysis/funnel-*.json`)
replays every arm's own exploration and candidates on B1 with the probes on, and places every (run, bug) pair at the
furthest stage it reached. 60 (run, bug) pairs per arm:

| Arm | never triggered | triggered, not detected | candidate, not confirmed | confirmed, not reported | reported, not minimal | **foundMin** |
|---|---|---|---|---|---|---|
| `monkey` | 3 | **52** | 0 | 0 | 0 | 5 |
| `agent` | **51** | 4 | n/a | n/a | 0 | 5 |
| `agent`, no budget line | **45** | 10 | n/a | n/a | 0 | 5 |
| `agent-persist` | **35** | 15 | n/a | n/a | 2 | 8 |
| `workflow` | 2 | **16** | 0 | 9 | 1 | 32 |
| `workflow-random` | 4 | 7 | 0 | **13** | 4 | 32 |

Post hoc (`posthoc.mjs`, $0, written after the rep-1 data, labelled post hoc): (a) every confirmed candidate of a
check-based arm scored as a report by the oracle's own rule, and (b) each arm's own played runs scanned with the author's
22 oracle-informed checks, reproduced and minimized: an upper bound for "this exploration with perfect checks".

| Arm | foundMin | (a) candidates could have credited | (b) its own exploration + perfect checks |
|---|---|---|---|
| `agent` (r1-r5) | 1, 1, 1, 1, 1 | n/a | 3, 2, 2, 1, 1 |
| `monkey` (r1-r5) | 1, 1, 1, 1, 1 | 1, 1, 1, 1, 1 | 10, 11, 10, 10, 11 |
| `workflow` (r1-r5) | 8, 8, 6, 5, 5 | 8, 8, 6, 5, 5 | 11, 12, 11, 10, 10 |
| `workflow-random` (r1-r5) | 7, 7, 6, 5, 7 | 8, 7, 6, 6, 7 | 11, 10, 11, 11, 11 |
| `agent-persist` (r1-r5) | 2, 1, 1, 2, 2 | n/a | 4, 5, 2, 4, 5 |

Reading: exploration is the bottleneck of the agent (even made to persist, its play could yield at most 2-5 with perfect
checks), detection of the monkey, and **check construction** of the workflow.
The judge never discarded a candidate that the oracle would have credited to a bug the workflow then missed (column (a)
equals foundMin in all 5 workflow runs; `workflow-random` r1 and r4 lost one bug each to triage or the judge).

### 6.1 The agent: it stops, and it does not explore when made to continue

- **Premature termination, 10 of 10 runs.** With or without the CLI budget line the agent answers `finish` right after its
  first confirmed bug: 3-6 turns of 40, 12-46 ticks of 8,000, one seed. 9 of the 10 final notes list what it did not test
  ("Not explored: enemy collisions, keys and doors, levers and gates, timer expiry, dialogs"). Without the line it gives
  other reasons, all false: "the tick budget is nearly used up", "the turn budget is nearly used up", "Budget is nearly
  spent" (`analysis/agent-behaviour.json`). The scarcity is the model's own confabulation: the prompt shows "Tick budget
  left: 7974" and says "when the budget runs out your last list is final", and the CLI adds `<total_tokens>15000000 tokens
  left</total_tokens>`; nothing says the budget is low.
- **Refusing the finish does not buy exploration.** `agent-persist` answers `finish` on 21-30 of its 40 turns (20-29 of
  them refused), plays 10-19 runs and 66-252 ticks (≤ 3% of the budget), on 1-2 seeds, and spends the rest re-confirming
  what it has. 35 of its 60 (run, bug) pairs were never triggered; the key-toast, late-room and exit faults (GQ07, GQ08,
  GQ09) in none of its 5 runs. It also
  rewrites its report list each turn and loses or degrades entries (r1 turn 28 dropped all three reports, then restored
  them); and a repro that shows a real fault but is not 1-minimal for it is credited elsewhere (its "dash through a wall"
  repro `right, right, dash-down` also lands on spikes and is 1-minimal only for the spike wrap).
- **What the workflow supplies instead:** code owns the stop condition and the volume (about 50 persona plans, 1.4-2.9k
  ticks, every room), code evaluates every check on every tick (detection does not need attention), and code reproduces and
  ddmin-minimizes, so every reported repro is 1-minimal for the check that fired.

### 6.2 The monkey: it triggers almost everything and detects one thing

Random input made 52 of 60 (run, bug) pairs manifest, but its two generic detectors (page error, state frozen 30 ticks
with no dialog) can only see the Restart softlock (GQ05, 5/5). With the author's checks the same exploration finds
10-11 (column (b)); with them `monkey-ref` finds 9.8. On this small level, random exploration is cheap and sufficient;
the value is in the oracle.

### 6.3 The workflow: its checks miss three bugs every time, for three different reasons

Across 5 constructions (30, 30, 30, 29, 30 checks, 0 unparseable), GQ01, GQ02 and GQ06 were never found although the
workflow's exploration triggered each of them in all 5 runs (`analysis/funnel-summary.json`, `perArmPerBug`):

| Bug | What Haiku wrote (examples, verbatim ids) | Why it cannot fire | Failure mode of the constructor |
|---|---|---|---|
| GQ01 dash through a one-tile wall | `player-not-in-wall`, `no-walk-into-wall-or-door`, `player-not-in-solid`, `player-on-passable-tile`: "the player never stands on a wall" (one such check in each of the 5 runs, nothing about the path) | the dash lands on a free tile; only the path crosses the wall | **state invariant where a transition invariant is needed** (the language has `prev` and `tile(prev, x, y)`, so "no solid tile between the old and the new position" is expressible) |
| GQ02 swapping tiles with an enemy costs no life | r2 `enemy-contact-costs-life`: "Ending a tick on an enemy's tile ... costs one life"; r3-r5 check what follows a `hit` event (`hit-costs-one-life`, `lives-drop-one`, `no-life-loss-without-cause`); r1 has no contact check | a swap never ends on the same tile, and a missed swap produces no `hit` event | **a dropped clause**: the spec's rule is "ending a tick on the same tile **or** swapping tiles"; no construction encodes the second disjunct (0/5) |
| GQ06 key picked up in the tick you lose a life is lost | `respawn-keeps-keys` (r3): `when respawn, expect cur.keys >= prev.keys`; `keys-drop-only-door` (r5) | the key never reaches the counter, so the counter never drops | **a proxy property**: counter monotonicity instead of conservation (the key tile vanished, so keys must have gone up) |

The other losses are **triage**, not checks: "confirmed, not reported" (9) means a confirmed candidate's repro made the
fault manifest on the way to another check's violation and was credited to that other bug (a spike wrap seen on the way
to an int16 overflow under the same `score-range` signature; an input race seen on the way to the Restart softlock). One
(check, screen) signature hides a second fault when one check guards both on the same screen. Variance between
constructions is large (19-21 candidates in r1-r2, 9-13 in r3-r5); the run-to-run spread of the workflow (5-8) most likely
comes from which checks Haiku happens to write (with random exploration the five constructions give 7, 7, 6, 5, 7), with
the CLI version change (§4) as an unresolved alternative.

### 6.4 Persona exploration vs random exploration (H4)

Same mean (6.4 vs 6.4), different bugs. Persona plans walk the whole level and finish it (every construction kept the
template's six R08 archetypes, among them the completionist mapper and the sequence-breaker), so the deep bonus-banner
overlap GQ08 is found 4/5 and never triggered by random input in 4 of 5 runs; random input presses more multi-key
combinations (GQ12 4/5 vs 1/5).
Random exploration plays all 8,000 ticks; the personas play 1.4-2.9k (3 rounds × ≤ 6 personas × ≤ 3 plans). At $0.053 a
run, persona planning is 79% of the workflow's spend and buys no mean capability on this level.

## 7. Harness faults and the CLI budget line (found and fixed under A1)

1. **Rate limits counted as results.** On 2026-10-28 the construct call of `workflow` r3-r5 failed with HTTP 429
   (`MODEL_RATE_LIMIT`), so those runs ended with no model output, and 2 of 3 judge calls of `workflow-random` r2 failed the
   same way. The frozen `analyze.mjs` excluded only runner exceptions, so it would have scored the three empty workflow runs
   as foundMin 0 and reported H1 "not supported" (8, 8, 0, 0, 0 vs 1 × 5, p = 0.80). PREREG §6 already defines such runs as
   harness faults; A1 made the script apply that rule (a test covers it), kept the runs in `runs/_harness-fault/` and re-ran
   them under the same run ids; every paid call now goes through a logged rate-limit retry. No retry was needed on
   2026-11-04.
2. **The CLI writes a budget line into every model context.** Claude Code 2.1.318 adds a meta message
   `USD budget: $<used>/$<cap>; $<remaining> remaining` whenever `--max-budget-usd` is passed (observed code: the
   `budget_usd` attachment), and the repo's provider always passes it (`src/models/providers/claude-cli.mjs`, `args()`); it
   also adds `<total_tokens>15000000 tokens left</total_tokens>` with or without the flag. No prompt in the repo accounts
   for either. All 5 frozen agent reps stopped after 4-6 of 40 turns, 12-26 of 8,000 ticks, saying the budget was nearly
   spent. A diagnostic replay ($0.015, `diag/budget-line.json`) of each finishing turn, 2× with and 2× without the flag:
   `finish` 7/10 vs 7/10; explicit budget-stop phrases 6/10 vs 0/10. Full runs without the line (`gqa1nb/agent`, below):
   the same 1 bug per run and the same early stop, without the USD reason (and in `agent-persist`, with invented ones:
   "the tick budget is nearly used up"). **So the line changes what the agent says,
   not what it does; the early stop is the model's own.** The line is still a repo-wide transport effect worth fixing for
   any arm whose model decides when to stop (see Next steps).
3. **Lost run.** `monkey-ref` r3 died with the 2026-10-28 session's container; re-run.
4. Known cosmetic defect, not fixed (frozen file): `chain.sh` logs `exit 0` for every run, because `$(date …)` runs before
   `$?` is expanded in the same `echo`. The JSON summary line of each run carries the real error.

## 8. Cost and time

| Item | Haiku USD |
|---|---|
| 2026-10-28, frozen arms (agent ×5, workflow r1-r2, workflow-random r1) | 0.1634 |
| 2026-10-28, harness-faulted runs (kept, excluded) | 0.0033 |
| 2026-11-04, budget-line diagnostic (22 calls) | 0.0150 |
| 2026-11-04, A1 re-runs (workflow r3-r5 $0.1974, workflow-random r2-r5 $0.0302) | 0.2276 |
| 2026-11-04, A1 secondary arms (agent no line ×5 $0.0199, agent-persist ×5 $0.1758) | 0.1957 |
| **Total** | **0.6049** (cap $3.00; spend stop $2.50 never reached) |

Per workflow run: construct $0.008 (1 call, about 12.6k output tokens), persona exploration $0.053 (18 calls, about 51k
output tokens), judge $0.006 (2-3 calls). Output tokens dominate (Haiku 5.5 at $0.50 per MTok out); the system prompt with
the 11.5k-character design document is cached. Wall time per workflow run 220-289 s; the summed model latency (454-549 s) is about
twice that, because the personas of a round plan concurrently; code-side playback, repro and ddmin replay 30-85 candidate
runs in Chromium. Mercury 3 (E1 exploratory) was not run
(stated in A1).

## 9. Honest reading

- **What is shown (development evidence):** on one browser game with 12 injected faults, a QA workflow that Haiku
  instantiates from a frontier-written template finds about 6 of 12 bugs per run with valid, 1-minimal, replayable
  repros and no false report, for $0.07 and 4 minutes, where Haiku alone and a random monkey find 1. The comparison is
  preregistered, the bug set and the oracle were frozen before any model call, and the oracle is validated by controls and
  a differential audit.
- **What it does not show.** Not held-out: the same session wrote the build, the faults, the spec, the template and the
  heuristics, after the faults; the heuristics name kinds of situations (several inputs in one tick, acting while
  pausing, checking every button) that overlap the injected classes. Both model arms get them, so H1 varies structure, not
  knowledge, but the absolute counts are inflated against a blind template. One level, one build, K = 5, and a CLI version
  change between the two run days (§4). No vision: "visual" here means DOM layout through `elementFromPoint`, not pixels;
  the brief's "visual passes" with a vision model are untested (the policy's CLI route is text only).
- **What carries the gain.** Not the personas (H4: random exploration with the same checks does as well, 4× cheaper) and
  not the judge (it lost no creditable bug). The gain is structural: code owns the stop decision, the play volume,
  per-tick evaluation of executable checks, and repro + ddmin. A cheap agent given the same tools, the same document and
  40 turns finds one bug and stops; forcing it on adds 0.6. This is the R08 conclusion ("structure beats model size";
  "run deterministic checks first; use models to plan, triage and write reports") measured on our own bed.
- **The ceiling and the bottleneck.** With the author's oracle-informed checks, random exploration reaches 9.8 and the
  workflow's own exploration 10-12 (post hoc). The workflow reaches 6.4 because Haiku's checks miss the rules whose
  violation is only visible in a transition, a second clause or a conservation law. That is the next lever, and it is a
  construction lever, not an execution one.
- **Negative results kept:** H3 (a cheap agent is no better than random input here); H4 (personas add no mean
  capability, at 79% of the spend); S4 (refusing the early finish barely helps); two faults (GQ02, GQ06) never found by any Haiku
  arm in 25 runs and GQ01 only once (by the solo agent); the frozen analysis would have misread three rate-limited runs as zeros; the agent's "budget" reasons
  are confabulated.
- **Repo-wide finding (not GQA-specific):** every `claude -p` call made through `src/models/providers/claude-cli.mjs`
  carries `USD budget: $<used>/$<cap>; $<remaining> remaining` (and a `<total_tokens>` line) in the model's context. Here it
  changed the agent's stated reasons, not its behaviour; any arm whose model decides when to stop, or reasons about cost,
  is exposed to it.

## 10. Next steps

1. **Construction fixes, measured as a new preregistered arm (cheapest first):** a check-coverage pass in the template
   that asks for one transition check per movement rule ("nothing solid between `prev` and `cur`"), one check per clause of
   every disjunctive rule, and conservation checks for every collectible (tile vanished ⇒ counter rose); then
   `workflow-random` with those checks (expected about $0.02 a run). Target: GQ01, GQ02, GQ06 without oracle knowledge.
2. **Triage signature:** split a (check, screen) signature when its candidates' minimized repros differ, so one check that
   guards two faults on one screen yields two candidates (the GQ10-under-GQ09 loss).
3. **Held-out bed:** a second level with faults written by a second author who never saw the template or the heuristics
   (sealed), to turn this into a held-out number.
4. **Vision:** a pixel pass needs an image-capable route in the policy (none today on the CLI route); the R08 check ladder
   puts it after deterministic checks, which this bed already shows carry most of the value.
5. **Transport:** make the provider's `--max-budget-usd` optional (a narrow option, not a default change, so other
   experiments' replay keys and caps are untouched) and record in each call's journal that the CLI injects the budget and
   token lines; re-check agent-style arms elsewhere (OT-0, AutomationBench agents) for stop decisions that cite a budget.
6. Mercury 3 E1 (exploratory, $0 listed): the same arms with `--model mercury-3`, K = 3.

## Files

| Path | What |
|---|---|
| `beds/gameqa-web/` | the bed: build, spec, truth, driver, oracle, tests (11) |
| `experiments/gameqa-web/arms.mjs`, `qa-lib.mjs`, `expr.mjs`, `prompts.mjs`, `template.json` | the arms and the workflow template |
| `experiments/gameqa-web/run.mjs`, `chain.sh`, `freeze.mjs`, `transport.mjs` | runner, run chains, freeze and amendment manifests, A1 transport |
| `experiments/gameqa-web/analyze.mjs`, `funnel.mjs`, `regress.mjs` | frozen analysis, root-cause funnel, regression pack |
| `experiments/gameqa-web/posthoc.mjs`, `agent-behaviour.mjs`, `probe-budget-line.mjs` | post-hoc analyses (labelled so) and the budget-line diagnostic |
| `experiments/gameqa-web/gameqa-web-arms.test.mjs`, `gameqa-web-transport.test.mjs` | arm tests (9, scripted model, $0) and A1 tests (4) |
| `research/gameqa-20261021/runs/` | every scored run (`meta`, `reports`, `score`, `stats`, `calls.jsonl` without prompts), chain logs, `_harness-fault/` |
| `research/gameqa-20261021/analysis/` | `analyze.md`/`.json`, funnel (3 batches + summary), post-hoc (2 batches), agent behaviour, `regress-workflow.json` and `regression-pack-workflow.json` (9 regression tests, one per bug the workflow found, each failing on B1 and passing on the clean build) |
| `research/gameqa-20261021/diag/budget-line.json` | the budget-line diagnostic |
