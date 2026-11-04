# Pre-registration: GQA-1 (game QA, visual + interactive; requirement E2)

| Field | Value |
|---|---|
| Experiment id | GQA-1 |
| Claim tested | C0/C1 on a new kind of task (ROADMAP §4.1): on a browser game build with injected faults, a QA workflow that a cheap model (Haiku 5.5) instantiates from a frontier-written template finds more injected bugs **with a valid, 1-minimal, replayable repro** than the same cheap model exploring alone, and than a random monkey. Falsified if the workflow's per-run count of such bugs is not higher than the agent's (exact one-sided test below) or the difference is under 1 bug. |
| Evidence class | `development` (diagnostic). One bed, one level, one author for the build, the faults, the spec and the template. No sealed claim. |
| Pre-registration commit | recorded in `FREEZE.json` (`arms.gitHead`) and in the commit that adds this file |
| Date | 2026-10-28 |

## 1. Bed

- **Bed:** `beds/gameqa-web` 1.0.0 (*Lantern Vault*, plain HTML/JS, lockstep, seeded, determinism class D0), driven by
  Playwright on the preinstalled Chromium (`/opt/pw-browsers/chromium`).
- **Build under test:** B1 = the game with 12 injected faults, 6 classes × 2 (collision, state_desync, softlock,
  ui_overlap, score_overflow, input_race). Hidden truth: `beds/gameqa-web/truth/bugs.json`.
- **Frozen before any model call:** the bed section of `research/gameqa-20261021/FREEZE.json` (sha256 of the build, the
  public spec, the truth, the driver and the oracle; bed manifest `ba728598bf6df7d7111b5f94d23eb5921fde2d3674728adda1352c01a4701e95`,
  injected-bug set `106bead47185244b2e2b56aeee186067361c57f762f5bbed38f6ed881ddbb270`). `run.mjs` refuses to run when the
  bed differs from the freeze, and refuses a paid run unless the arms section is frozen and unchanged.
- **Oracle** (`beds/gameqa-web/oracle.mjs`): a report `{bug_class, title, observed, expected, seed, steps}` is replayed
  from a fresh game on B1. It counts for an injected bug only if that bug's fault probe fires on the replay (each fault
  computes the correct result next to the faulty one and records a probe only when they differ). **Minimal** = 1-minimal:
  removing any single token stops the credited probe from firing. Malformed or non-firing reports are false reports.
- **Oracle controls, run before this pre-registration ($0):**
  - known-good: every bug's reference repro is credited to that bug and is 1-minimal (bed tests 11/11 pass, including the symptom-keeping minimality and the credit rule);
  - known-bad: padded, wrong-class, junk and malformed reports are scored as not minimal / class mismatch / no fault /
    malformed (bed test);
  - clean build vs its spec: 21 oracle-informed reference checks over 40,181 random ticks, 0 violations
    (`audit/audit-clean-40k-s1.json`), and 22 checks over 20,161 ticks, 0 violations (`audit/audit-clean-20k-s7-22checks.json`);
  - oracle validity by differential replay, clean build vs faulty build, same seed and tokens: at the first tick where
    anything a tester can observe differs (state, HUD text, UI visibility/text/rectangles/topmost), a probe must already
    have fired (no un-probed deviation that a correct report could not be credited for), and every probe must coincide
    with an observable difference (no credit for an unobservable "bug"). B1: 200 episodes, 26,852 ticks, 200 diverged,
    0 un-probed divergences, 0 silent probes. Per flag (each fault alone, 60 episodes with setup prefixes that reach the
    key, lever, gate, far rooms and the exit, about 9,000 ticks each): 0 un-probed, 0 silent for all 12
    (`audit/differential-*.json`). The deep faults diverge rarely under random input (score overflow in 2 of 60 episodes, and 1 of 150 in a targeted 23,514-tick run), so their audit is thin.

## 2. Arms

All arms get the same tester session (reset(seed) / run(tokens) / observe on B1; no probes), the same public design
document (`beds/gameqa-web/spec/DESIGN.md`) and, for the model arms, the same seven QA heuristics (template.json
`heuristics`). Model: `claude-haiku-5-5` (class M, policy/models.json), through the repo's ModelPort and the Claude CLI
provider (no tools, text only), effort `low`. **Vision:** the policy's CLI route sends text only, so no arm sees pixels;
testers read the DOM test API (state, HUD text, UI rectangles, whether each button is topmost at its centre). The two
ui_overlap faults are layout faults observable through the DOM, not rendering glitches.

| Arm | Definition | Model calls | Budget per run |
|---|---|---|---|
| `monkey` (baseline) | random harness tokens (fixed distribution: moves 40%, dashes 10%, wait 10%, use 4%, pause/esc/enter 12%, clicks 10%, 2-key combos 8%, goto 6%), 200-token episodes, random seeds; the template's two generic detectors (page error; observable state frozen 30 ticks with no visible dialog or button); code repro (2 replays) + ddmin to a 1-minimal repro; one report per confirmed (detector, screen) signature | none ($0) | 8,000 ticks; ddmin ≤ 400 tests per candidate |
| `agent` | Haiku alone. Each turn it sees its notes, its run history (last 12), the full trace of its last run (≤ 120 ticks shown) and the map; it answers notes, one run (seed + ≤ 120 tokens) or finish, and its complete current report list (the last list is final). It must replay and minimize by itself. | ≤ 40 | 8,000 ticks, 40 turns, $0.50 |
| `workflow` | the cheap-built QA workflow, template `foundry/game-qa-explore-repro-minimize` 1.1.0 (`experiments/gameqa-web/template.json`): **construct** (Haiku writes 3-6 personas from the R08 archetypes and 8-30 executable checks in a closed expression language; unparseable checks get one repair call) → **explore** (3 rounds; each persona plans ≤ 3 runs per round from the shared coverage, the list of already-violated checks and its own last traces) → **playback** (code runs every plan, evaluates every check and the generic detectors on every tick) → **triage** (one candidate per signature = check + screen (open dialog, else mode), shortest prefix, ≤ 30 breadth first across checks) → **repro** (2 replays) → **minimize** (ddmin + single-token pass: 1-minimal for the check on that screen) → **judge** (Haiku, batches of 6, sees the check, the minimized tokens and the trace of the minimized replay; filters wrong checks) → **report** | ≈ 15-30 | 8,000 ticks, $0.50 |
| `workflow-random` (ablation) | the paired `workflow` rep's construction (same personas and checks, no new construct call), monkey exploration instead of personas, then the same triage, repro, minimize, judge, report | judge only | 8,000 ticks, $0.50 |
| `monkey-ref` (calibration, not comparative) | the monkey's exploration with the bed author's 21 **oracle-informed** reference checks (`reference-checks.json`), repro + ddmin, no judge: the ceiling of "random exploration + perfect checks" | none ($0) | 8,000 ticks |

Frozen arm definitions: the arms section of `FREEZE.json` (sha256 of arms.mjs, qa-lib.mjs, expr.mjs, prompts.mjs,
template.json, run.mjs, reference-checks.json, funnel.mjs, analyze.mjs, experiments/lib/models.mjs, policy/models.json
and this file), written before the first paid call. Held constant: model, decoding, tester API, spec, heuristics, tick
budget, oracle. Not held constant (by design, it is what is compared): structure (who decides what to run, who checks,
who minimizes), the number of model calls.

**Exploratory secondary (E1, descriptive only, no claim):** the same `agent`, `workflow` and `workflow-random` arms with
`mercury-3` (the owner's second cheap executor, policy executorModels, listed at $0 with a token allowance; hard caps
3M tokens per run, 120k per call), run tag `gqa1m3`, K = 3, after the Haiku reps.

## 3. Measurements

- **Primary:** `foundMin` per run = number of injected bugs (0-12) credited with at least one 1-minimal repro.
- **Secondary:** `foundMinClass` (and the class is accepted), `foundAny` (any credited repro, minimal or not), false
  reports (malformed + no fault), duplicates, precision (credited / reports), USD per run (the CLI's reported cost, summed),
  USD per found bug (total USD / total foundMin), model calls and tokens, wall time per run (exploration + minimization +
  judging; scoring excluded), per-bug detection rate across reps.
- **Root-cause funnel** (`funnel.mjs`, $0, after scoring, uses the probes): for each (run, bug) the furthest stage reached:
  never triggered by the arm's exploration / triggered but not detected / a candidate (check violated) but not confirmed /
  confirmed but not reported (judge rejected or not reached) / reported but not 1-minimal / foundMin. Every false report
  is classified (which check or claim, why it does not fire).
- **K:** 5 runs per arm (reps 1-5), each with its own rng stream (sha256 of the run id) and, for the model arms, fresh
  model samples. Order: for r = 1..5: `workflow` r, then `workflow-random` r (needs the construction of `workflow` r);
  `agent` r in a parallel lane. `monkey` and `monkey-ref` reps 1-5 at any time ($0).
- **Unit of analysis:** the run.

## 4. Power

No prior variance estimate exists. With K = 5 vs 5 the exact one-sided Mann-Whitney test reaches p = 1/252 = 0.004 at
complete separation and p ≤ 0.05 only with near-separation, so only a large, consistent effect (about 2 bugs with a
spread of about 1) can be shown. A smaller true effect will read "not supported": the result is directional, and that
is stated now.

## 5. Analysis

- Script: `experiments/gameqa-web/analyze.mjs` (frozen with the arms). Only runs that match the frozen bed, are not
  `--dev` and raised no runner exception enter; complete rep indices only for paired comparisons.
- **H1 (primary):** `workflow` > `agent` on foundMin. Supported (dev evidence) iff the exact one-sided Mann-Whitney
  p ≤ 0.05 **and** the mean difference ≥ 1 bug.
- **H2:** `workflow` > `monkey`, same rule. **H3:** `agent` > `monkey`, same rule.
- **H4 (ablation):** `workflow` vs `workflow-random`, two-sided exact test at 0.05; reports whether persona-guided
  exploration adds to (or costs against) random exploration with the same checks.
- False reports, cost, time: descriptive (means and per-run values); no test.
- A K = 1 difference is never reported as a comparison. Per-bug rates are descriptive.

## 6. Kill rule and falsifiers

- Spend stop: no new paid run starts once the recorded Haiku spend of GQA-1 reaches **$2.50** (task cap $3.00); the
  analysis then uses the complete rep indices.
- **Shakedown rule:** rep 1 of `workflow` and `agent` runs first. If a **harness fault** shows (a runner exception, the
  scorer failing, ≥ 50% of a run's model calls failing for a non-model reason such as a CLI or schema-transport error), the
  fix is recorded below as an amendment with the new arms hash, the faulty runs are kept as raw data but excluded, and the
  paid reps restart at 1. A low score, bad plans, wrong checks or false reports are **results**, not harness faults: no
  prompt, template, budget or strategy change after the freeze.
- Falsifier for the workflow thesis on this bed: H1 not supported, or the workflow's mean false reports exceed the
  agent's by more than its gain in foundMin.

## 7. Cost

Haiku 5.5 at $0.10 / $0.50 per MTok. Agent: ≤ 40 calls × (≈ 12k input + ≈ 2k output) ≈ $0.09 per run. Workflow:
≈ 25 calls × (≈ 10k + ≈ 2k) ≈ $0.06 per run. Workflow-random: ≈ 4 judge calls ≈ $0.02. Per rep ≈ $0.17; 5 reps ≈ $0.85.
Hard per-run caps $0.50 (all three: ≤ $7.50 worst case, bounded by the $2.50 spend stop). Mercury: $0 listed, ≤ 3M tokens
per run. Monkey arms $0.

## 8. Threats to validity

- **Author leakage (main threat):** the same session wrote the build, the faults, the spec, the template and the
  heuristics, after the faults. The persona archetypes are copied from R08 (written 2026-10-06, before the bed), but the
  heuristics name kinds of situations (several inputs in one tick, acting while collecting / getting hurt / pausing,
  checking every button) that overlap with the injected classes. The heuristics are given to **both** model arms, so the
  agent-vs-workflow comparison varies structure, not knowledge; the absolute counts are inflated relative to a blind
  template. A sealed variant needs faults written by a second author who never saw the template.
- **Oracle:** the probes define the bugs. The differential audit bounds the risk that a correct report of a real
  deviation goes uncredited (0 un-probed divergences found) but is sampling evidence, not proof. A real deviation outside
  the 12 faults in the clean build would make a correct report a "false report": the clean audit (40k ticks, 21 checks)
  found none; the 22-check re-audit (20k ticks) found none.
- **Minimality** is judged by the oracle's probe (keeping the symptom), not by the arm's own check: a workflow repro that
  is 1-minimal for its check can still be non-minimal for the fault (counted as not found under foundMin, kept under
  foundAny).
- **Credit** goes to the fault the repro is 1-minimal for (report class first), not merely to the first fault it fires:
  without this, a repro that passes through another fault on the way (a spike wrap before an int16 overflow) was
  credited to the wrong fault and scored non-minimal.

## Pre-freeze changes from $0 development runs (before any model call)

Recorded for transparency; none is an amendment because no model call had been made. All came from $0 runs of the
monkey and of the oracle-informed `monkey-ref` calibration path (`--dev`, scratch output, not part of the results):
1. Oracle credit rule (above), with a bed test built from the two dev reports that exposed it.
2. Symptom-keeping minimality for the two input-race faults (bed test).
3. Triage by signature (check + screen) instead of one candidate per check, in the shared machinery used by `monkey`,
   `monkey-ref`, `workflow` and `workflow-random` (template 1.1.0): one check (every visible button is clickable)
   catches two different faults on two screens, and one candidate per check could report only one of them. This is the
   R08 triage rule (dedup by signature), not a bed-specific hint, but it was found on this bed: development evidence.
4. A 22nd oracle-informed reference check (`key-pickup`) for the calibration arm only (never shown to an arm).
5. Cost accounting: an unobservable CLI spend is now charged at the port's `costUpperUsd` (was read from a field the
   port does not set, so it would have been counted as $0).
- **Spec ambiguity:** reports of behaviour the spec marks "by design" are false reports by construction (four decoys).
- **Infrastructure:** the host runs other experiments; wall time is noisy and reported, not tested. The game runs in
  lockstep, so host load cannot change any outcome.
- **Engine:** the workflow runs as experiment code that mirrors `template.json` node by node, not through
  `src/runtime.mjs` (the engine v2 series is merging; this experiment does not touch it).

## Amendments

(dated entries only)

### A1 (2026-11-04, written before any run it governs; frozen as `amendments[0]` of FREEZE.json)

**State at the amendment.** The 2026-10-28 session ran, under the frozen arms: `agent` r1-r5, `workflow` r1-r5,
`workflow-random` r1-r5, `monkey` r1-r3 and `monkey-ref` r1-r2; `monkey-ref` r3 died when the session's container ended
(the chain log has no end line; the browser was closed under it). Recorded spend $0.1667. Nothing has been changed in the
bed, the prompts, the template, the budgets, the oracle or the scoring since the freeze.

**Harness fault 1: rate limits.** `workflow` r3, r4, r5: the construct call (the run's first and only call) failed with
`MODEL_RATE_LIMIT` (claude CLI, HTTP 429), so the runs ended with no model output; `workflow-random` r3-r5 then had no
construction to reuse (runner exception); `workflow-random` r2: 2 of its 3 judge calls failed with `MODEL_RATE_LIMIT`, so the
candidates of those batches were dropped. By §6 these are harness faults (≥ 50% of the run's model calls failed for a
non-model reason). The frozen `analyze.mjs` excluded only runner exceptions, so the three rate-limited `workflow` runs would
have entered H1 as foundMin 0 (H1 then reads "not supported" on 8, 8, 0, 0, 0 vs 1 × 5). Fixes:
- `analyze.mjs` implements the §6 rule: a run is excluded when at least half of its model calls failed with a non-model
  code (`MODEL_RATE_LIMIT`, `MODEL_UNAVAILABLE`, `MODEL_PROTOCOL`, `MODEL_TIMEOUT`, `MODEL_BUDGET`); a schema failure is
  the model's and stays a result (test in `gameqa-web-transport.test.mjs`).
- The faulted runs are kept as raw data in `runs/_harness-fault/` and re-run under the **same run ids** (so the same rng
  streams and, for `workflow-random`, the same pairing): `workflow` r3-r5, `workflow-random` r2-r5. `monkey-ref` r3-r5 and
  `monkey` r4-r5 ($0, never started or killed by the container's end) run as planned.
- Transport: every paid call goes through `transport.mjs` `withRateLimitRetry` (a rate-limited call is retried after 60 s,
  then 180 s, and logged; its spend, if any, is carried). The model sees nothing different.

**Harness finding 2: the CLI writes a budget line into the model's context.** Claude Code 2.1.318 adds a meta message
`USD budget: $<used>/$<cap>; $<remaining> remaining` whenever `--max-budget-usd` is passed (observed code: the `budget_usd`
attachment, built from `options.maxBudgetUsd`); the repo's provider always passes it (`src/models/providers/claude-cli.mjs`
`args()`), here with $0.25. It also adds `<total_tokens>15000000 tokens left</total_tokens>` with or without the flag. No arm
prompt contains either line. In all 5 frozen `agent` reps Haiku answered `finish` after 4-6 of its 40 turns and almost none of its
8,000 ticks (12-26 ticks), with one bug reported, and all 5 final notes give the budget as the reason ("Budget is nearly
spent", "stay within the small USD budget", "The USD budget was nearly exhausted"). Diagnostic (post-hoc, $0.015, `probe-budget-line.mjs`, `diag/budget-line.json`): a
quote probe confirms the line is in context with the flag and absent without it; replaying the exact finishing-turn prompt of
each rep 2× with and 2× without the flag gives `finish` 7/10 vs 7/10, explicit budget-stop phrases ("nearly exhausted
($0.25 cap)") 6/10 vs 0/10. So at the finishing turn the line changes the stated reason, not the decision; whether it drives
the earlier, shorter play (r3's turn-2 notes: "Budget is tight, so keep runs short") is not settled by that replay. The
frozen `agent` arm is therefore **kept as the primary baseline** (it is the arm as preregistered, and the agent's premature
stop is a result), and two **secondary** arms are added to measure the confound and the stop:
- `gqa1nb/agent`: the frozen `agent` with `--transport nb` (the provider's `--max-budget-usd` flag dropped for this port, so no
  USD line; the per-run $0.50 cap is still enforced by `makeCaller` before every call). K = 5.
- `gqa1nb/agent-persist`: the same, and a `finish` before the last turn is refused with "finish is not available before
  your last turn ... keep testing parts of the game you have not tested yet; your reports are kept" (`arms.mjs` `persist`).
  It isolates "keeps going" from everything else the workflow adds (checks, code repro, ddmin, judge). K = 5.
- Tests (secondary, same rule as §5, dev evidence): **S1** `gqa1/workflow` > `gqa1nb/agent`; **S2** `gqa1nb/agent` vs
  `gqa1/agent` (two-sided); **S3** `gqa1/workflow` > `gqa1nb/agent-persist`; **S4** `gqa1nb/agent-persist` vs `gqa1nb/agent`
  (two-sided). S1 and S3 give the agent every benefit (the workflow keeps the budget line), so a workflow win there is
  conservative. The H1-H4 decisions are unchanged and stay primary.
- Order: `workflow` lane (r3-r5 with `workflow-random`), then `workflow-random` r2; `agent-nb` r1-r5, then `agent-persist`
  r1-r5 in a second lane; monkeys in a third. Spend stop unchanged ($2.50, now counting the harness-faulted runs and the
  diagnostic). Expected new spend about $0.9 (`agent-persist` up to $0.10 a run).
- The Mercury E1 secondary is dropped from this session (time); stated in the result.
