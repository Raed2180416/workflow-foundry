# gameqa-web: deep QA of a browser game build (visual + interactive)

**Kind:** interactive, browser (Playwright on the preinstalled Chromium). **Domain:** game QA. **Version:** 1.0.0.
Reference design: [R08](../../research/landscape-20261006/08-worked-example-ai-game-qa.md) (check ladder, personas,
repro → minimize). Everything is fictional and written for this bed; no benchmark data is copied. Experiment and
results: [research/gameqa-20261021/](../../research/gameqa-20261021/).

This complements [`beds/gameqa`](../gameqa/) (a headless, text-frame tile game). Here the build is a real web page: a DOM
board, a HUD, dialogs, buttons and toasts, so UI faults (an element covering a button, a HUD out of step with the state)
are observable only through the rendered page.

## The build under test

*Lantern Vault* (`game/index.html`, `game/game.js`): a 14×10 grid level with coins, gems, a relic, a key and locked door,
a lever-operated gate, spikes, a heart, an exit, two seeded patrolling enemies, a timer, a dash with a recharge, a pause
menu and completion / game-over / victory dialogs. Plain HTML and JavaScript, no dependencies.

- **Determinism class D0.** The page runs in lockstep (`window.__LOCKSTEP`): it advances only when the driver ticks it,
  all randomness is a seeded mulberry32, nothing reads the wall clock. A (build, seed, tokens) triple replays
  bit-identically (tested).
- **Public spec:** `spec/DESIGN.md`, the only document a tester (or a model) gets. It says how the game is meant to work,
  marks four deliberate oddities *(by design)* as decoys, and defines the harness token grammar and the report format.
- **Builds:** the clean build has no flags. Build **B1** sets 12 fault flags through `window.__BUILD_FLAGS` before the page
  loads. Each fault computes the correct result next to the faulty one and records a probe only when they differ, so a
  probe means "the fault manifested". Probes are reachable only through the oracle's session.

## Hidden truth: 12 injected faults, 6 classes × 2

`truth/bugs.json` (never in a prompt; tests assert no flag name, bug id or truth title reaches one). Depth: *shallow* =
reachable in 1-2 tokens once you think of it; *timing* = depends on enemy timing (seed); *deep* = needs most of the level.

| Id | Class | Depth | Fault |
|---|---|---|---|
| GQ01 | collision | shallow | a dash passes through a one-tile wall, closed gate or locked door |
| GQ02 | collision | timing | swapping tiles with an enemy costs no life |
| GQ03 | state_desync | shallow | HUD coin counter misses coins collected by a dash |
| GQ04 | state_desync | shallow | HUD timer freezes after resuming with the Resume button (not with a key) |
| GQ05 | softlock | shallow | Restart level from the pause menu leaves the game paused with no menu |
| GQ06 | softlock (or state_desync) | timing | a key picked up in the tick you lose a life is lost (the door can never open) |
| GQ07 | ui_overlap | timing | the key toast covers the Resume button when you pause right after taking the key |
| GQ08 | ui_overlap | deep | a time-bonus banner of 1000+ covers the Finish button |
| GQ09 | score_overflow | deep | score stored as int16: negative above 32,767 |
| GQ10 | score_overflow | shallow | spike penalty below 500 points wraps the score to ~65,000 |
| GQ11 | input_race | shallow | an arrow pressed after pause in the same tick still moves the player |
| GQ12 | input_race (or collision) | shallow | several arrows in one tick make several moves |

Each bug has a reference repro on B1 that the tests prove fires and is **1-minimal**. The GQ08/GQ09 references use the
GQ01 tunnel as a shortcut; the legitimate route (key, lever, gate, door) also reaches them.

## Oracle (`oracle.mjs`)

A report `{bug_class, title, observed, expected, seed, steps}` is replayed from a fresh game with its seed on B1:

- **malformed** (bad class, seed or token) and **no_fault** (no probe fires) are **false reports**;
- otherwise it is **credited** to the earliest fired bug whose accepted classes include the report's class (else to the
  earliest fired bug, `classMatch: false`);
- **minimal** when removing any single token stops the credited probe from firing with the same symptom (ddmin's
  1-minimality, keeping the failure signature as test-case reducers do). Only the two input-race faults have two
  symptoms: the player ends on another tile, or only another effect differs (an extra bump event, a pickup). So
  `dash-down, up+up` (ends a tile off) is minimal although `up+up` alone also shows the fault, as a double bump;
- a second report credited to an already-earned bug is a **duplicate**.

Per run: `foundMin` (bugs with a credited, 1-minimal repro: the primary metric), `foundMinClass`, `foundAny`,
`falseReports`, `duplicates`, `precision`.

## Files

| File | Role |
|---|---|
| `game/index.html`, `game/game.js` | the build (clean + 12 flags) |
| `spec/DESIGN.md` | the public design document and harness reference |
| `driver.mjs` | Playwright driver: lockstep sessions, token grammar, `goto` macro (BFS), tester vs oracle sessions |
| `truth/bugs.json` | hidden ground truth with reference repros |
| `oracle.mjs` | report scoring, 1-minimality, freeze manifest |
| `gameqa-web.test.mjs` | 10 tests: leakage, determinism, clean build vs spec, every fault's reference, input-race probes on any observable effect, symptom-keeping minimality, scoring rules |

Run: `nice -n 15 node --test --test-concurrency=1 beds/gameqa-web/gameqa-web.test.mjs` (Chromium at
`/opt/pw-browsers/chromium` or `FOUNDRY_CHROMIUM`; the tests skip with a reason if it cannot launch).

## Known limits

- One level, one build, one author (the same session wrote the build, the faults, the spec and the QA template):
  development evidence only. A sealed variant needs faults written by a second author.
- Vision is not used: the policy's Claude CLI route sends text only, so testers read the DOM test API (state, HUD text,
  UI rectangles and whether a button is topmost), not pixels. "Visual" faults here are layout faults observable through
  the DOM (`elementFromPoint`), not rendering glitches.
- The clean build was audited against its spec at $0 (21 oracle-informed reference checks, 40,000 random ticks, zero
  violations: `experiments/gameqa-web/audit-clean.mjs`); that is evidence, not proof, that it has no un-injected bugs.
- **Oracle validity (differential audit, $0, `experiments/gameqa-web/differential.mjs`):** each episode is replayed on
  the clean build and on the faulty build with the same seed and tokens. At the first tick where anything a tester can
  observe differs (state, HUD text, UI visibility, text, rectangles, topmost), a probe must already have fired, and every
  probe must coincide with an observable difference. The first audit found three defects, all fixed before the freeze:
  the two input-race probes compared only the player position (a double bump or a pickup on the way out and back was an
  observable deviation no report could be credited for), and the key toast was drawn centred during play too (an
  observable UI change with no probe). After the fixes: B1 200 episodes (26,852 ticks) and each fault alone (60 episodes
  each, with setup prefixes that reach the deep rooms; about 9,000 ticks per fault) show 0 un-probed divergences and 0
  silent probes (`research/gameqa-20261021/audit/`). Sampling evidence, not proof; the deep faults (score overflow, toast,
  banner) diverge in few episodes.
