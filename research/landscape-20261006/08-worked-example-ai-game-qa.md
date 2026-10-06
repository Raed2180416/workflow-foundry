# AI game-QA micro harness: reference design (state of the art, 2026-10-06)

**Citations.** `[n]` points to the reference list at the end. Each entry is tagged **[V]** = [verified: fetched 2026-10-06] or **[R]** = [recalled, unverified]; no [R] claims are used. Statements with no citation, and anything marked "proposal", are my design inferences. "Derived" means my own arithmetic on cited figures. No local files were written.

## 0. Bottom line

1. **Products come in two shapes.**
   - **Black-box agents:** plain-language tasks, the screen plus simulated input, vision-model and OCR perception, LLM reasoning, and bug reports written automatically. Examples: modl.ai, nunu.ai, Razer [1,2,4,7].
   - **Hybrids:** a fast action layer hooked into the engine, a slow LLM planner, and cached perception. Examples: Tencent Acorn, and AstraGame, which has run on 24,000 WeChat mini-games [8,9].
2. **Vision models (VLMs) catch most bugs but raise many false alarms.** They work as filters, not as final judges:
   - On real industrial QA video, zero-shot precision was 0.50 [19].
   - Glitches that only show over time are detected at near-chance rates [22].
   - Geometry clipping detection produces many false positives on surfaces that are merely close together [24].
3. **Structure beats model size.**
   - Giving the model a reference frame lifts Qwen3-VL-8B to F1 0.74, the same as GPT-5 with a reference [21].
   - Prompts that list physics rules a correct game must obey (metamorphic relations) let Gemini 2.5 Flash beat an unguided 2.5 Pro [25].
   - Injecting game state directly agrees with human judgment 92.2% of the time, against 58.8% for verifying by playing [42].
4. **Open-ended bug hunting by LLMs is weak even for the best models.** On 124 seeded bugs, the best model found 48.39%. Qwen3-8B (instruct) found 7.26% and Qwen3.5-397B-A17B (thinking) found 41.13% [28].
5. **What this means for cheap models:**
   - Run deterministic checks first.
   - Instrument game state; you own the source.
   - Build around snapshots and replay.
   - Use models to plan, triage and write reports.
   - Turn every confirmed bug into a minimized, replayable regression test.

## 1. Products: what they actually automate

- **modl.ai**
  - **Current product:** "no SDKs, no code hooks". It uses "visual models and OCR", LLM reasoning and a "skills" library [4].
    - Tests are plain-language tasks ("Reach level 5") or exploratory runs, started from a dashboard or CI.
    - A per-game visual model trains in "less than a few days".
    - It reports crashes, broken menus, missing assets, softlocks and performance drops, each with an AI severity score.
    - Platforms: Android and desktop; iOS is in development.
  - **Earlier Unity plugin:** bots drove the player character and logged errors, exceptions, crashes, custom events, position heatmaps and CPU/memory timelines. It was "not currently recommended for GUI-driven gameplay" [5].
  - **Trade-off, per its CTO:** deep engine integration is "like having an extra project" to maintain [3].
- **nunu.ai**
  - Plain-English tasks; the agent watches the screen and acts through touch, keyboard and mouse.
  - Optional lightweight SDK; runs on PC and mobile, with console "coming soon" [1].
  - Powered by Gemini; claims "up to 50%" lower manual QA cost [2] and coverage of "50% of the QA stack" [3].
- **Razer QA Companion-AI (2026-03-09)** [7]
  - No integration needed.
  - Detects rendering, physics, animation and collision issues from gameplay footage, with repro steps and video.
  - Generates functional, negative and boundary test cases from prompts or a game design document.
  - Gameplay agents in early preview return pass/fail.
  - No metrics published.
  - The 2025 version was a UE/Unity/C++ plugin running on Amazon Bedrock [6].
- **Tencent WeTest Acorn (GDC 2026)** [8]
  - Four layers: plan, perceive, execute, judge.
  - "Dual-frequency scheduling": engine-plugin behavior trees act at millisecond rate, and an LLM decides at second rate, for "deterministic behavior".
- **AstraGame (FSE'26 industry track, Tencent/Peking University)** [9]
  - Small specialist models work alongside large VLMs, with perception and reasoning in parallel and caching at the level of individual UI widgets.
  - Reported +37.78% coverage, −58% latency and 180,000+ issues found.
- **Instrumentation and services**
  - AltTester CLI (2026-06-11) gives agents the Unity/Unreal object tree (XPath queries), property read/write, input, time scale and screenshots over WebSocket [11].
  - GameDriver sells a managed service where "AI keeps them alive" and triage "separates real regressions from stale-path noise". The mechanism is not disclosed [10].
  - Regression Games advertises a Unity bot SDK with replay and CI. Its current status is unclear [12].
  - Keywords bought Mighty Games' 24/7 AI "Build and Test" in 2022 [13].
- **Engine vendors**
  - **Roblox** [14]
    - Studio has a built-in MCP server with virtual mouse and keyboard and playtest start/stop.
    - A beta *playtest subagent* runs on a Roblox-hosted model in its own context and returns Pass, Fail, Inconclusive or Error.
    - It aborts after 50 turns or after repeated identical tool calls.
    - Roblox warns it "may return 'Pass' even if" other evidence shows a failure.
  - **Unity:** the AI-beta MCP server exposes scenes, scripts, the console and component values. It needs Unity 6, a Unity Cloud project and an AI-beta subscription [15].
  - **Unreal:** UE 5.8 (2026-06-17) ships an *Experimental* MCP plugin for "testing and optimization tasks". A third-party reference says calls run one at a time on the game thread [16].
- **Configuration:** vendors configure by *task* — plain-language goals, cases derived from the design document, expected outcomes [1,4,7,14] — not by persona. Personas appear in research [29–31] but in no product documentation I found. I found no verifiable AI-agent game-QA offering from Applause or for Godot.
- **Current ceiling:** AI QA "can[not] yet tell you whether a game is good", and 3D open worlds lag behind 2D mobile [3].

## 2. Research evidence

**Visual and video bug detection**
- **GlitchBench (CVPR'24):** 593 glitched and 330 clean images from 205 games. GPT-4V scored 43.4% [17].
- **VideoGameQA-Bench (NeurIPS'25 Datasets & Benchmarks):** 9 tasks, 16 VLMs [18].
  - Glitch detection reaches 82.8% on images and 78.1% on video.
  - Visual regression (comparing against a previous build) peaks at 45.2%.
  - 2025-era open-weight models scored 12.8–25.6% on visual regression and at most 31.7 overall (one video task unscored), against about 50 for the best proprietary models.
- **Industrial study (FSE'26)** [19]
  - 41 hours of video (4,336,132 frames) was cut to 19,738 keyframes.
  - gpt-4.1-mini reached precision 0.50 and accuracy 0.72, shrinking human review to 2,002 frames.
  - 46.8% of its detections were on-screen error text, which OCR would catch.
  - Adding a judge model or retrieval doubled the cost for marginal gains.
  - Bugs that stay on the HUD produced duplicate detections.
- **Keyframe sampling** at 1.9% of frames still captured the bug in 98.79% of cases [20].
- **RefGlitch-Bench (2026)** [21]
  - A reference frame lifts Qwen3-VL-8B from F1 0.42 to 0.74; GPT-5 with a reference also scores 0.74.
  - On real footage, automatically picking the "last clean frame" chose a glitchy reference 33.4% of the time.
- **Temporal and physics glitches**
  - TempGlitch: 750 glitched and 750 clean videos. All 12 VLMs tested were near chance, and denser frame sampling or bigger models did not help [22].
  - VideoGlitchBench (5,238 videos, 120 games): adding memory, debate between model instances and temporal grounding beat plain VLMs [23].
  - PhysGame: open video-LLMs lag behind on physics violations [26].
- **Clipping detection in a Godot demo** [24]
  - An exploration agent collected frames, and shaders labeled clipping automatically.
  - Accuracy ranged from 60.7% to 71.6% across six VLMs.
  - Recall: Gemma-4-31B 86.0%, Ministral-3-14B 84.4%, Gemini-3.1-Flash-Lite-Preview 82.0%.
  - The authors recommend using VLMs as "high-recall candidate filters".
- **MetaGlitch (ASE'26):** physics-rule prompts added 5.2–14.8 points of recall across six VLMs (four open-weight), with precision of 76.8–100% [25].

**Agents and exploration**
- **TITAN (2025)** [27]
  - **How it works:**
    - Reads the game's state API plus screenshots, simplified through per-game templates that take "less than five minutes per game" to adapt.
    - Suggests about 5 actions per step and reflects after "20 consecutive actions without progress".
    - Keeps a map of state transitions it has covered.
    - Monitors crashes, stuck tasks and timing, plus LLM-based bug checks.
  - **Results with GPT-4o:**
    - 95% task completion, against 82% for Wuji and 83% for ReAct.
    - 73.26% state coverage and 4 new bugs.
    - A 30% false-alarm rate, mostly from errors in its state simplification.
    - Deployed in 8 production pipelines.
- **GBQA:** its agent acts only through backend endpoints, with budgets of 50–500 steps [28].
- **Personas and play styles**
  - Procedural personas use tree search with evolved heuristics [30].
  - MIMIC's personality-driven LLM agents raise coverage and the diversity of solutions [29].
  - In BiFuzz, two play styles found 21 and 13 unique failures, plus 43 shared [31].
- **Search and exploration**
  - Wuji (evolutionary algorithm plus deep RL plus multi-objective search) found 3 new bugs [32].
  - Go-Explore with navigation-mesh hints covered a 1.5 km × 1.5 km world in 10 hours on one machine, beating curiosity-driven RL [33].
  - EA's curiosity-driven agents needed about 24 hours to cover 90% of a map [34].
  - Antithesis can "deterministically rematerialize any moment" [35].
    - It balances exploration across observed combinations of game values (`SOMETIMES_EACH`).
    - It adds side objectives to optimize, which is how it cracked Metroid.
  - Fuzzers that track game state can play Super Mario levels: IJON-style annotations, automated by SandPuppy. Tango solved DOOM E1M1 in 30 minutes [36].
  - CA2 feeds the call stack to the agent so it can target specific functions [37].
  - NitroGen (CVPR'26) is an open ~500M-parameter policy that maps video frames to gamepad input [38].
    - Trained on 40,000 hours of video; weaker on mouse-and-keyboard genres.
    - Its harness intercepts the system clock to step the game frame by frame.

**Reproduction, minimization, regression, triage**
- **Reproduction**
  - BugCraft reproduced Minecraft crashes from user reports end to end 34.9% of the time (GPT-4.1) [39].
  - Delta debugging cut 95 recorded user actions down to the 3 that mattered, in 82 runs [40].
  - Overwatch's replays "prove invaluable in reproducing bugs" [48].
- **Regression testing**
  - SAGE generates tests with LLM-guided RL [41].
    - It trims the suite by cost, coverage and rarity.
    - It prioritizes tests from update logs.
  - GameGen-Verifier injects game state to test key behaviors in short bounded runs, up to 16.6× faster than playing [42].
- **Softlocks**
  - Planning models learned from game logs can search for dead ends [43].
  - LucasArtsifier finds softlocks by static analysis [44].
- **Deduplication** (non-game data)
  - Clustering crashes with LLM embeddings beats stack-trace heuristics [45].
  - Janus matches duplicate bug videos with mRR 89.8% [46].
  - OCR plus a local 3B LLM raised screenshot-duplicate HitRate@1 from 0.82 to 0.95 [47].
- **Adoption:** developers remain skeptical of agents, and the open problems are test goals and oracles [49].

## 3. Engine hooks and determinism

- **Unity**
  - Test Framework command line (`-runTests -batchmode -testPlatform PlayMode`, NUnit XML results) [53].
  - `InputEventTrace` records, saves and replays input [54].
  - `Time.captureDeltaTime` advances game time "regardless of real time" [55].
  - Graphics Test Framework `ImageAssert` compares against reference images per color space, platform and graphics API [56].
  - `Measure.Frames` for performance tests [58].
  - Unity's own record/playback package, "Automated QA", has been on hold since 2021-12-06 [57].
- **Unreal**
  - Automation framework: unit, feature and content-stress tests, Functional Tests, Automation Spec [50].
  - Gauntlet runs multi-process sessions such as "four clients and a server" [51].
  - Screenshot tests [52]:
    - Reference images are kept per platform, rendering API and shader model.
    - The default tolerance is "Low" because of temporal anti-aliasing noise.
    - A "Disable Noisy Rendering Features" switch reduces variation.
- **Godot**
  - `--headless`, `--fixed-fps` ("disables real-time synchronization"), `--write-movie`, `--quit-after` [59].
  - GdUnit4 SceneRunner simulates input and steps frames [60].
- **Web:** Playwright's clock controls `Date`, timers, `requestAnimationFrame` and `performance`. Its screenshot diffs (pixelmatch) vary by OS and hardware [61].
- **Determinism classes (proposal)**
  - **D0, bit-exact:** fixed timestep, seeded randomness, same binary and platform. Input replay and delta-debugging minimization are valid.
  - **D1, statistically reproducible:** report a repro rate over N replays.
  - **D2, not reproducible** (network or live services): reproduce by injecting state [42] or by capturing full state.
- **State vs pixels:** Acorn, AltTester and TITAN all give the agent direct access to engine state [8,11,27]. Pixels should remain the authority for anything the player can see.

## 4. Cheap models and the check ladder

**Open-weight VLMs as of October 2026**
- Gemma 4 (2026-04-02) [62]:
  - Sizes: E2B, E4B, 26B-A4B (3.8B active) and 31B.
  - Apache-2.0 license; bf16 weights fit on one 80 GB H100.
- Qwen [63]:
  - Qwen3.5 (Feb–Mar 2026): 0.8B to 397B, described as a "unified vision-language foundation".
  - Qwen3.6: 27B and 35B-A3B, each with a vision encoder.
  - Qwen3.8-27B (2026-08-14): native image and video input.
  - Qwen3-VL-8B is also available [64].
- Ministral-3 and Llama-4-Scout appear in the 2026 game studies above [21,24].

**Price snapshot** (OpenRouter, per million tokens in/out) [65]

| Model | Input | Output | Notes |
|---|---|---|---|
| Gemma-4-26B-A4B | $0.042 | $0.22 | median latency 0.23–1.5 s |
| Qwen3.6-35B-A3B | $0.05 | $0.70 | |
| Qwen3-VL-8B | $0.117 | $0.455 | |

Qwen3-VL uses one token per 32×32 pixels [64], so a 720p frame is about 900 tokens and costs about $0.00015. Screening the 19,738 keyframes of the FSE'26 study would cost about $3 (derived).

**Check ladder (proposal).** Models enter only after step 5:
1. Scan for crashes, exceptions and log errors.
2. Check state invariants and metamorphic rules:
   - bounds and NaN values;
   - conservation of resources;
   - save→load equality;
   - replay equality.
3. Golden-image or perceptual diff at scripted camera positions.
4. OCR for error overlays.
5. Extract keyframes and drop near-duplicates by perceptual hash.
6. A 4–9B VLM with a reference frame and the game's physics-rule list, tuned for recall.
7. A 26–35B VLM rules only on flagged frames and disagreements.
8. A human.

Measure each check's precision and recall on every build against engine ground truth, such as shader masks or collision queries [24].

## 5. Reference architecture

```
 build N ─►[1 Launch/health]─► env pool (k instances; control = build N-1)
                                   ▲ serial per instance, parallel across
 [4 Curriculum]──assign(cell,persona,seed,budget)──┐
   ▲ R/W coverage archive                          ▼
   │                 [5 Personas ×n]     [6 Scenario/regression runner]
   │                        └── act/observe via [2 Driver/env adapter] ──┘
   │                                       │
   │                               [3 Recorder] ─► artifact store
   │                                       │ stream
   │        ┌─────────────┬────────────────┼──────────────┐
   │ [7 Invariants] [8 Visual tiers] [9 Stall/softlock] [10 Perf]
   │        └─────────────┴───────┬────────┴──────────────┘
   │                     candidate findings
   │                              ▼
   │                  [11 Repro & minimize] (rate, ddmin, bisect)
   │                              ▼
   └──────────────────── [12 Triage/dedup] ◄──► bug ledger
                           │              │
                    [13 Reporter]   [14 Test generator] ─► regression pack ─► build N+1
 HARNESS/ENV_FAULT (any node) ─► [15 Supervisor/healer] ─► proposal ─► replay ─► approve
```

| # | Node | Deterministic / model | Model size | Private context | Shared reads / writes | Async behavior | Failure → heal |
|---|---|---|---|---|---|---|---|
| 1 | Launch & health | Deterministic | — | build manifest, flags, environment spec | W build record | per instance; heartbeat | crashes on N but not N−1 → finding; both crash → ENV_FAULT, infrastructure retry |
| 2 | Driver/env adapter | Deterministic | — | bridge endpoint, action schema, determinism class | I/O only | serial per instance | disconnect or missing selector → HARNESS_FAULT → reconnect, re-ground |
| 3 | Recorder | Deterministic | — | sampling policy | W artifacts (inputs, state hashes, keyframes, logs, perf) | streaming with backpressure | queue full → pause sessions, never drop silently |
| 4 | Curriculum/coverage | Deterministic (+LLM for phrasing goals) | ≤9B | archive weights, budget | R/W archive; R ledger, changelog | reassigns on a timer; stops after K rounds with no new cells | stale cell → rebuild by replaying its input prefix; divergence = drift |
| 5 | Explorer persona ×n | LLM/VLM plans (slow) + scripted or NitroGen policy acts (fast) | 4–35B; ~0.5B policy | persona card, own memory, skill subset | R coverage slice, known-bug digest; W trajectories, candidates | long-running, checkpointed, cancelable | K steps without progress → escape kit → branch with another persona; loop or schema error → model swap |
| 6 | Scenario/regression runner | Deterministic replay; model for plain-language steps | ≤9B | spec, seed, expected result | R regression pack; W results | parallel, hard timeouts | divergence before the check point → drift, not a verdict |
| 7 | Invariant/metamorphic checks | Deterministic | — | invariants, thresholds | R state stream; W candidates | per event | false-positive rate tracked on controls; threshold edits are proposals |
| 8 | Visual pass | Deterministic → small VLM → mid VLM | 4–9B; 26–35B | golden images, rule list, reference policy | R keyframes, baselines; W candidates + confidence | batched queue; verdict cache | re-baseline only with approval |
| 9 | Stall/softlock | Deterministic (+planner when escalated) | ≤27B | progress metrics, escape kit | R world model, snapshots; W candidates | watchdogs | agent stuck vs real softlock decided by a branch test |
| 10 | Perf regression | Deterministic | — | budgets, baseline distributions | R counters; W findings | after each session; repeat runs set the noise floor | noisy host → INCONCLUSIVE, rerun on pinned hardware |
| 11 | Repro & minimize | Deterministic (+LLM writes repro steps) | ≤9B | N, k, minimization config | R artifacts; W repro rate, minimal trace, introducing build | priority queue | D0 not reproducible → recorder defect; D1/D2 → report the rate |
| 12 | Triage/dedup | Deterministic signature + embeddings + LLM | ≤9B + embedder | signature recipe | R/W ledger | online | wrong merge → split proposal (ledger is append-only) |
| 13 | Reporter | Template-bound LLM | ≤9B | template, tracker mapping | R ledger; W tracker draft (needs approval) | per build | schema-checked; links evidence, never invents it |
| 14 | Regression-test generator | LLM + deterministic validation | 26–35B coder | engine test API, minimal trace | R ledger; W regression pack | after confirmation | must fail on the buggy build, otherwise discarded |
| 15 | Supervisor/healer | Deterministic classifier + LLM proposals | 26–35B | failure taxonomy, policy, kill switch | R all events; W proposals, audit log | event-driven | patch → replay the failing case + a regression slice → approve |

**Shared state**
- Coverage archive: cells, input prefixes, per-build snapshots.
- Bug ledger: append-only signatures, evidence, repro rate, status.
- World model: an abstract state graph, like TITAN's coverage map [27] or a learned planning model [43].
- Artifact store, addressed by content hash.
- Baselines: golden images, performance distributions, rule lists.
- Regression pack.

**Personas** are cards with a goal, style parameters, allowed skills, the checks they subscribe to, a model tier and a budget. Examples:
- completionist mapper;
- sequence-breaker;
- chaos tester (saves, quits or pauses during transitions; spams input);
- literal newcomer;
- economy auditor;
- "photographer" (visits the golden camera positions).

**Game bug vs harness failure**
- A finding is an *output*. A node succeeds if it acted, observed and recorded, even when the game crashed.
- Verdicts:
  - `PASS`
  - `FINDING{confirmed, repro_rate}`
  - `FINDING{unconfirmed}`
  - `INCONCLUSIVE` (precondition not reached, or budget spent)
  - `HARNESS_FAULT`
  - `ENV_FAULT`
- Five discriminators separate them:
  1. A control run of build N−1 with the same environment and harness version.
  2. Deterministic replay.
  3. Re-sampling the model, to separate model variance.
  4. A different persona from the same snapshot, to separate "agent stuck" from "softlock".
  5. A label on each check saying whether it is an execution check or a model judgment.
- Findings trigger reproduction, never a retry. Only harness faults go to healing.
- These five discriminators map directly onto the classify step in the Foundry roadmap: flake, model variance, harness defect, environment, impossible task [L].

**What actually needs self-healing**
- **Harness drift:** selectors, object-tree paths and state-simplification templates go stale as the game changes. TITAN's false alarms came mostly from its state simplification [27]. Fix by re-grounding against recorded traces, then replaying build N−1 to confirm nothing else changed.
- **Check drift after intended art changes:** re-baseline only with approval, as in Unreal's "Add New" / "Add As Alternative" flow [52].
- **Model failures** (schema errors, loops, refusals): use turn caps and loop detection as Roblox does, then swap the model per policy. Roblox also tells agents to verify state before entering Play mode and to hard-reset if the state is unexpected [14].
- **Stalls:** run an escape kit (pause/resume, respawn, reload checkpoint, debug teleport), then branch.
- **Environment:** retry the infrastructure. Experimental engine bridges drop connections [16].

**Async behavior**
- Environment instances are leased to sessions.
- Findings stream into the ledger and are deduplicated as they arrive.
- Watchdogs cover the frame heartbeat (hangs), simulated time and wall-clock budgets.
- Cancellation passes down to child repro jobs and keeps partial artifacts.
- The repro queue is ordered by severity; the VLM queue batches requests and applies backpressure.
- Wake-up triggers: a new build, the nightly soak run, a repro job finishing.

**Reuse across builds**
- Each bug keeps its minimized trace, seed, check and the build that introduced it (found by bisection). It is marked fixed after K consecutive passing builds.
- Archive cells survive across builds. Their snapshots are rebuilt by replaying the stored input prefix, and divergence signals drift.
- Model verdicts are cached by frame hash, prompt and model id.
- Tests are prioritized from the changelog [41].

## 6. What is new vs existing

| Element | Status |
|---|---|
| Black-box VLM agents with plain-language tests | Shipping [1,4,7] |
| Fast engine layer + slow LLM; perception caching | Shipping [8,9] |
| Snapshot/archive exploration, personas, state-aware fuzzing | Research and adjacent products [29–36] |
| Minimizing input traces; replay for reproduction | Old technique [40,48]. No product I found documents a full repro → minimize → regression-pack loop |
| Verdict scheme that separates finding / inconclusive / harness / environment using control-build comparisons | Not found published. Roblox has four labels but no control comparison [14] |
| Harness healing confirmed by replaying against the previous build | Not found. GameDriver's AI maintenance is undisclosed [10] |
| Measured precision/recall per check driving which model tier runs, with independence labels | Partly new. AstraGame tiers models for speed, not by measured error [9] |
| Agent-built, content-addressed, revisable QA harness | New to game QA, as far as I found |

**Fit with Foundry.** This harness exercises these planned pieces [L]:
- the `env` contract (reset(seed), step, observe, snapshot, restore, determinism class);
- the `agent` node with record/replay;
- parallel `map`;
- the `wait` wake-up scheduler;
- `call`-by-hash, for the repro sub-harness;
- `verify` with independence labels.

Its outcome contract is: budget or coverage target met, every finding backed by evidence, regression pack updated. It is never "zero bugs".

**Gaps in this pass**
- Unreal's replay and CSV-profiler docs (HTTP 403), Unity's 2D-physics determinism note (redirect) and docs.modl.ai (DNS failure) could not be fetched.
- Razer's 2025 "more bugs, less time" percentages appeared only in search snippets and were left out.

## References

Tags: [V] = [verified: fetched 2026-10-06]; [R] = [recalled, unverified].

1. nunu.ai — https://nunu.ai [V]
2. Google Cloud blog, 2025-03-18 — https://cloud.google.com/blog/products/gaming/co-op-mode-the-ai-partners-driving-the-the-future-of-gaming/ [V]
3. Naavik, 2026-07-21 — https://naavik.co/ai-gaming/the-state-of-ai-for-game-qa/ [V]
4. modl.ai — https://modl.ai/ [V]
5. modl:test on the Unity Asset Store — https://assetstore.unity.com/packages/tools/behavior-ai/automated-qa-with-modl-test-257938 [V]
6. Razer/AWS, 2025-05-28 — https://www.razer.com/newsroom/company-news/razer-is-bringing-revolutionary-ai-game-developer-tools-on-amazon-web-services [V]
7. Razer at GDC 2026 — https://www.razer.com/newsroom/company-news/razer-at-gdc-2026 ; https://www.razer.com/blog/ai-that-plays-to-test-razer-qa-companion-ai-at-gdc-2026/ [V]
8. Tencent WeTest Acorn — https://www.wetest.net/blog/wetest-at-gdc-2026-1186.html [V]
9. AstraGame — https://conf.researchr.org/details/fse-2026/fse-2026-industry-papers/50/AstraGame-Effective-and-Efficient-VLM-Agent-Serving-for-Large-Scale-Game-Testing-in- [V]
10. GameDriver — https://www.gamedriver.io [V]
11. AltTester CLI — https://alttester.com/alttester-cli-built-for-the-way-ai-assisted-testing-actually-works/ [V]
12. Regression Games — https://regression.gg [V]
13. Keywords Studios / Mighty Games — https://www.keywordsstudios.com/en/about-us/news-events/news/keywords-studios-furthers-its-technical-capability-in-automated-ai-based-games-testing-with-mighty-games-acquisition/ [V]
14. Roblox Developer Forum:
    - https://devforum.roblox.com/t/studio-beta-studio-assistant-mcp-playtest-agent/4566767
    - https://devforum.roblox.com/t/assistant-updates-studio-built-in-mcp-server-and-playtest-automation/4474643
    - https://devforum.roblox.com/t/studio-mcp-server-updates-and-external-llm-support-for-assistant/4415631 [V]
15. Unity MCP — https://unity.com/blog/unity-ai-mcp-how-to-get-started [V]
16. Unreal Engine 5.8:
    - https://www.unrealengine.com/news/unreal-engine-5-8-is-now-available
    - https://forums.unrealengine.com/t/unreal-engine-5-8-released/2729274
    - https://forums.unrealengine.com/t/5-8-experimental-modelcontextprotocol-mcp-server-instantly-drops-connections/2729488
    - https://tc-imba.github.io/ue-official-mcp/SKILL/ (third-party) [V]
17. https://arxiv.org/html/2312.05291v2 [V]
18. https://asgaardlab.github.io/videogameqa-bench/ ; https://arxiv.org/abs/2505.15952 [V]
19. https://arxiv.org/html/2603.22706v1 [V]
20. https://ualberta.scholaris.ca/server/api/core/bitstreams/1e05a152-67e3-4b35-9411-acc1738e2b8f/content [V]
21. https://arxiv.org/html/2604.11082 [V]
22. https://arxiv.org/abs/2605.21443 [V]
23. https://arxiv.org/abs/2604.07818 [V]
24. https://arxiv.org/html/2607.25921 [V]
25. https://github.com/asesubmission/mt4videogames [V]
26. https://arxiv.org/abs/2412.01800 [V]
27. https://arxiv.org/html/2509.22170 [V]
28. https://arxiv.org/html/2604.02648 [V]
29. https://arxiv.org/abs/2510.01635 [V]
30. https://arxiv.org/abs/1802.06881 [V]
31. https://ar5iv.labs.arxiv.org/html/2508.02144 [V]
32. https://www.se.cs.uni-saarland.de/conferences/ASE/ase2019/details/ase-2019-papers/39/Wuji-Automatic-Online-Combat-Game-Testing-Using-Evolutionary-Deep-Reinforcement-Lear.html [V]
33. https://arxiv.org/abs/2209.00570 [V]
34. https://ar5iv.labs.arxiv.org/html/2103.13798 [V]
35. https://antithesis.com/blog/2025/metroid/ [V]
36. https://adamdoupe.com/publications/sandpuppy-dimva2024.pdf ; https://raid2024.github.io/papers/raid2024-18.pdf [V]
37. https://arxiv.org/html/2605.13918 [V]
38. https://nitrogen.minedojo.org/ ; https://huggingface.co/nvidia/NitroGen [V]
39. https://arxiv.org/abs/2503.20036 [V]
40. https://www.st.cs.uni-saarland.de/publications/files/zeller-tse-2002.pdf [V]
41. https://arxiv.org/abs/2512.00560 [V]
42. https://arxiv.org/abs/2605.07442 [V]
43. https://arxiv.org/pdf/2402.12393 [V]
44. https://news.ycombinator.com/item?id=49355607 [V]
45. https://arxiv.org/abs/2512.01609 [V]
46. https://arxiv.org/html/2407.08610 [V]
47. https://gupea.ub.gu.se/server/api/core/bitstreams/a953a28d-8c19-48c0-aef6-fb42acfba3c1/content [V]
48. https://gdcvault.com/play/1024053/Replay-Technology-in-Overwatch-Kill [V]
49. https://arxiv.org/abs/2202.12777 [V]
50. https://dev.epicgames.com/documentation/unreal-engine/automation-test-framework-in-unreal-engine [V]
51. https://dev.epicgames.com/documentation/unreal-engine/gauntlet-automation-framework-in-unreal-engine [V]
52. https://dev.epicgames.com/documentation/unreal-engine/screenshot-comparison-tool-in-unreal-engine [V]
53. https://docs.unity3d.com/Packages/com.unity.test-framework@1.4/manual/reference-command-line.html [V]
54. https://docs.unity3d.com/Packages/com.unity.inputsystem@1.8/api/UnityEngine.InputSystem.LowLevel.InputEventTrace.html [V]
55. https://docs.unity3d.com/ScriptReference/Time-captureDeltaTime.html [V]
56. https://docs.unity3d.com/Packages/com.unity.testframework.graphics@8.9/manual/index.html [V]
57. https://docs.unity3d.com/Packages/com.unity.automated-testing@0.8/manual/index.html [V]
58. https://docs.unity3d.com/Packages/com.unity.test-framework.performance@2.0/manual/index.html [V]
59. https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html [V]
60. https://godot-gdunit-labs.github.io/gdUnit4/latest/advanced_testing/sceneRunner/ [V]
61. https://playwright.dev/docs/clock ; https://playwright.dev/docs/test-snapshots [V]
62. https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/ [V]
63. https://github.com/QwenLM/Qwen3.6 ; https://huggingface.co/Qwen/Qwen3.6-35B-A3B ; https://huggingface.co/Qwen/Qwen3.8-27B [V]
64. https://github.com/QwenLM/Qwen3-VL/ [V]
65. OpenRouter:
    - https://openrouter.ai/google/gemma-4-26b-a4b-it
    - https://openrouter.ai/qwen/qwen3.6-35b-a3b
    - https://openrouter.ai/qwen/qwen3-vl-8b-instruct [V]

L. /home/raed/Projects/workflow-foundry/docs/ROADMAP.md §1 and §5 — [verified: read locally 2026-10-06]
