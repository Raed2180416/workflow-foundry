# Workflow beds-tier-a-split (wf_a7df2ae2-03d)

status: completed; finished agents: 3

## Script

```js
export const meta = {
  name: 'beds-tier-a-split',
  description: 'Build Tier-A task families (generator + oracle + controls) and adversarially audit each',
  phases: [{ title: 'Build', detail: 'one agent per family' }, { title: 'Audit', detail: 'break the oracle, then fix' }],
}
const COMMON = `Repository: /home/user/workflow-foundry (Node 24 on PATH; ESM; built-in node:test; do NOT add npm dependencies; do NOT commit). Read beds/CONTRACT.md first and follow it exactly; use beds/lib/rng.mjs and beds/lib/canonical.mjs. You own ONLY the directory beds/<family>/ named below (create it). Do not edit any other file. Other agents are building other families concurrently.
Run your tests with: node --test beds/<family>/  . Python 3.13 is available at /usr/bin/python3 if your oracle needs to execute Python; if so, run untrusted code only inside: unshare --user --map-root-user --net --mount --fork, mounting tmpfs over /home, /root, /opt/models and /tmp inside the namespace, with a wall timeout and stdin/stdout JSON transport (write this helper inside your own directory).
Quality bar: this bed will be used to compare agent harnesses (plain agent vs typed workflows on cheap and frontier models). It must (a) need genuine judgment over messy natural-language content AND (b) carry procedural load (many items / long inputs / constraints), so that a single-shot cheap model usually fails at difficulty>=3 while a careful decomposition can succeed. Everything is fictional and generated (no copying benchmark data). Truth must never leak into the task. In README.md include: description, knobs per difficulty with measured input token estimates (estimateTokens of prompt+inputs) for difficulty 1..5, the exact oracle pass rule, why it needs judgment, and the adversarial content present at higher difficulty.
At the end report: files, test counts, token sizes per difficulty, and anything incomplete.`

const FAMILIES = [
 { id: 'records', spec: `FAMILY records (domain: data repair / entity resolution). Each task: a messy export of customer/supplier records from several legacy systems (30 rows at d1 up to ~150 at d5) as semi-structured text lines with heterogeneous formats: names in varied orders/cases/titles/nicknames (Bob/Robert, Liz/Elizabeth, transliterations), dates in mixed formats where some are ambiguous (03/04/2019) and the system-of-origin's locale note (given in a prose 'source notes' section) disambiguates, phone numbers in local/international forms, country names/aliases/typos, amounts with currency symbols/words/thousand separators by locale ('1.200,50 EUR', 'twelve hundred dollars'), plus duplicates of the same real entity across systems with typos. Inputs also include a prose spec of the canonical schema and rules (FX table for amount_usd rounding rule, which record wins on conflict: most recent update, etc.). Output: {records:[{entity_id (smallest source row id in the cluster), given_name, family_name, birth_date (YYYY-MM-DD), country (ISO alpha-2), phone_e164, amount_usd (number, 2dp)}]} one per real entity. Oracle: field-level accuracy over matched entities and pairwise cluster F1; pass iff field accuracy >= 0.97 AND cluster pair-F1 >= 0.95 AND no extra/missing entities beyond 2%. Score = harmonic-ish blend documented.` },
 { id: 'incident', spec: `FAMILY incident (domain: SRE incident triage). Each task: a fictional microservice system (6 services at d1 to ~18 at d5) with a dependency graph given as prose + a table, and an interleaved log bundle (300 lines at d1 to ~4000 at d5) from all services over ~30 minutes, with exactly one root-cause fault injected at time T in one service from a catalog of >=8 fault classes (connection-pool exhaustion, certificate expiry, bad config deploy (version string changes), disk full, DNS resolution failure, memory leak -> OOM kills, clock skew, upstream rate limiting, poisoned cache). The fault produces class-specific (but not keyword-trivial: vary phrasing across seeds, use paraphrases) symptoms in the root and cascading timeout/5xx symptoms in dependents (propagating along the graph with delays), plus red herrings (an unrelated noisy service, a routine deploy elsewhere, warnings before T that are benign, at d4+ a misleading line claiming a different root cause, at d5 an injected instruction-like line inside a log message). Output: {root_service, fault_class (enum), first_bad_timestamp (ISO), impacted_services:[...], evidence_line_ids:[...]} (every log line has an id). Oracle: pass iff root_service and fault_class exact AND first_bad_timestamp within +/-60 s of T AND impacted_services Jaccard >= 0.8. Make sure the root is not trivially the service with the most ERROR lines (dependents should often log more errors than the root).` },
 { id: 'codefix', spec: `FAMILY codefix (domain: software repair). Each task: a generated Python 3 module (one of >=6 fictional domains: warehouse inventory, interval scheduling, invoice proration, text tokenizer, graph routing, rate limiter; 80 lines at d1 to ~400 at d5, multiple functions/classes) produced from correct templates with parameterized variation, into which 1 (d1) to 3 (d5) bugs are injected by mutation operators (off-by-one, wrong comparator, swapped arguments, missing edge case, wrong default, stale variable), plus a bug report written as a user would (symptom-level, sometimes partially wrong at d4+), plus a few visible tests that do not cover every bug. Output: {patched_source: string} (full module). Oracle: run hidden tests (generated from the correct template; >= 15 cases) against patched_source in the Python sandbox; pass iff all hidden tests pass AND a diff guard holds (all public function/class names still defined with the same signatures, no test-detection hacks like inspecting the stack/'pytest'/env, source size within 2x). referenceSolve returns the correct template source. Bad controls: unchanged buggy source, empty, and a near-miss (fixes only one of the bugs when >1).` },
 { id: 'synth', spec: `FAMILY synth (domain: research synthesis). Each task: a corpus of 12 (d1) to ~60 (d5) short documents (preprints, journal articles, lab notes, press releases, errata, retractions) about fictional compounds/organisms/materials, each with metadata (venue type, date, sample size n, authors). Documents make claims of the form (entity, property, value+unit, conditions); some later errata correct values, some retractions void documents, some claims conflict and the task's prose resolution policy decides (e.g. prefer peer-reviewed over preprint, then larger n, then most recent; ignore press releases unless sole source; convert units). Units vary (mg/mL vs g/L, Kelvin vs Celsius). Question: produce the final accepted table for a requested set of (entity, property) pairs plus the list of documents that were retracted or superseded and used/not used. Output: {table:[{entity, property, value (number, canonical unit stated in prompt), source_doc_id}], conflicts:[{entity, property, doc_ids}], excluded_doc_ids:[...]}. Oracle: pass iff every requested cell value within 1% relative of truth with correct source_doc_id AND excluded_doc_ids exact set match; score = fraction of correct cells. Adversarial: press releases with exaggerated values; at d5 a document containing an instruction-like sentence.` },
 { id: 'kinetics', spec: `FAMILY kinetics (domain: scientific data analysis). Each task: lab notebook exports for an enzyme-kinetics study of fictional enzymes: 2 (d1) to 8 (d5) conditions (pH/temperature/inhibitor), each with substrate concentrations and initial-rate measurements over 2-4 replicates, recorded by different technicians in heterogeneous text formats (tables, prose, CSV fragments) with mixed units (uM/mM/nM, per-second/per-minute rates, '1.2e-3' vs '0.0012'), unit notes buried in prose, mislabeled samples that a prose note later corrects, and outlier replicates that the written protocol says to exclude (e.g. 'exclude any replicate where the technician noted bubbles or the plate reader flagged saturation'). Data generated from Michaelis-Menten (and competitive inhibition at d4+) with noise. Output: {conditions:[{condition_id, vmax (canonical unit), km (canonical unit)}], excluded_samples:[sample_id...]}. Oracle: pass iff every condition's Vmax and Km within 10% relative of the truth parameters used to generate AND excluded_samples exact set; the oracle must ALSO confirm that fitting the correctly cleaned data with a standard nonlinear least squares lands within tolerance (choose noise so that correct cleaning + fitting passes and failing to exclude outliers or convert units fails). referenceSolve does correct cleaning + fitting (implement a small Levenberg-Marquardt or grid+refine in JS).` },
 { id: 'gridquest', spec: `FAMILY gridquest (domain: puzzle/game exploration; kind: interactive). A procedurally generated text adventure on a grid of rooms (3x3 at d1 to 7x7 at d5): locked doors needing colored keys, switches that toggle bridges or lower gates elsewhere, one-way passages, a hidden key revealed only by 'examine' on described objects, and room descriptions written in varied natural language (exits and objects described in prose, not lists; some descriptions mention decorative objects that do nothing). Partial observability: observation = current room description + inventory + last action result. Actions: go <dir>, take <item>, use <item> on <thing>, toggle <thing>, examine <thing>, look. Goal: reach the treasure room and 'take treasure' within an action budget (2-3x optimal). createEnv must support reset/step/observe/snapshot/restore (D0 deterministic) and actions() listing syntactically legal actions. Oracle: replay output {actions:[...]} in a fresh env; pass iff treasure taken within budget; score also reports steps/optimal. referenceSolve = BFS over full state (oracle-side only). Bad controls: empty, random-walk with fixed seed, and a near miss (optimal path minus the final take). Generator must guarantee solvability and that the optimal solution requires >= 2 keys/switches at d3+.` },
 { id: 'gameqa', spec: `FAMILY gameqa (domain: game QA; kind: interactive; see research/landscape-20261006/08-worked-example-ai-game-qa.md for the reference design). A tiny deterministic turn-based game engine (top-down tile world: player, walls, doors, collectibles, enemies with simple patrol AI, a shop, save/load, levels) rendered as an ASCII frame + JSON state. Each task instantiates a build with K planted bugs (1 at d1 to 5 at d5) drawn per seed from a catalog of >= 10 parameterized bug templates (crash on a specific action sequence, softlock (player trapped with no legal progress), item duplication via save/load, clip through a wall at a specific tile under a condition, score/gold integer overflow, enemy stuck/teleport, rendered frame disagrees with state (visual bug), door opens without key under a condition, level transition losing inventory, shop price rounding error) plus a bug-free control build. Task prompt: 'test this build; report each distinct bug with a minimal reproducing action sequence from a fresh start and a bug class'. The tester can create envs, step, snapshot/restore. Output: {bugs:[{bug_class, repro_actions:[...], description}]}. Oracle: for each reported bug, replay repro on the buggy build and on the control build; a report counts as a true finding iff the planted bug's internal detector fires on the buggy build and the control build does not exhibit it; duplicates count once; score = recall of planted bugs; pass iff recall >= 0.8 AND false reports <= 1. Also report repro length vs the minimal known repro. referenceSolve uses the bug catalog's known triggers.` },
 { id: 'runbook', spec: `FAMILY runbook (domain: ops runbook execution / sagas; kind: interactive). A simulated infrastructure (hosts, services with versions, a primary/replica database, a load balancer pool, feature flags, a config store, a maintenance-window clock) with an incident ticket and a prose runbook (8 steps at d1 to ~25 at d5) containing conditionals ('if replica lag > 30s, wait and re-check, at most 3 times'), safety rules ('never restart the primary during business hours; drain a node from the LB before restarting it; if a step fails, roll back the previous config change'), and steps whose effects are verified by observation. Tools (actions): query(target), drain(node), undrain(node), restart(service, node), set_flag(name, value), apply_config(key, value), rollback_config(key), wait(seconds), page_human(reason). Some actions fail transiently or permanently per seed; the runbook says how to handle each. createEnv provides the action API with snapshot/restore. Output: episode record {actions:[...]} replayed by the oracle. Oracle: pass iff the final state satisfies the ticket's goal predicate AND no safety rule was violated at any step AND compensations were performed when required; score partial credit documented. referenceSolve follows the runbook programmatically using hidden state access (oracle side only). Bad controls: no-op, a run that reaches the goal but violates one safety rule, and one that skips a required compensation.` },
]

const SELECTED = FAMILIES.filter(f => (args ?? []).includes(f.id))
log(`families: ${SELECTED.map(f => f.id).join(', ')}`)
phase('Build')
const results = await pipeline(SELECTED,
  f => agent(`${COMMON}\nYour family directory: beds/${f.id}/ (it may already contain partial files from an interrupted earlier agent: inspect them, reuse what is sound, replace what is not)\n\n${f.spec}`, { label: `build:${f.id}`, phase: 'Build' }),
  (built, f) => agent(`${COMMON}\nYour family directory: beds/${f.id}/ — it was just built by another agent; you now own it. You are an ADVERSARIAL AUDITOR then fixer.\nFamily spec for reference:\n${f.spec}\n\nAudit steps (do all, write findings into beds/${f.id}/AUDIT.md):\n1. Determinism and contract conformance (every export present; outputSchema is the portable subset).\n2. Truth leakage: search prompt/inputs/files for answer strings; check ids/orderings don't leak the answer (e.g. root service listed first, entity_id order, sorted fields).\n3. Oracle bypass: try degenerate outputs (empty arrays, all-candidates, huge outputs, wrong types, extra fields, NaN, duplicated items) and confirm they fail. Try to pass WITHOUT solving.\n4. Triviality attack: spend real effort writing a <=40-line deterministic heuristic solver that reads only prompt+inputs (keyword grep / most-errors / regex) and measure its pass rate at difficulty 3 over 30 seeds. If it passes > 20%, strengthen the generator (more paraphrase variety, red herrings, ambiguity resolved only by prose rules) until it drops below 20% while referenceSolve still passes 100%.\n5. Controls: referenceSolve passes 30/30 seeds at d1,d3,d5; every bad control fails 30/30.\n6. Performance limits from the contract.\nFix every problem you find (you may rewrite generator/oracle), re-run tests, and add regression tests for each fix. Report: findings, fixes, trivial-solver pass rates before/after, final test counts, token sizes per difficulty.`, { label: `audit:${f.id}`, phase: 'Audit' })
)
return results

```

## Agent result 1

The `gridquest` bed is finished in `/home/user/workflow-foundry/beds/gridquest/`. All 16 tests pass with `node --test beds/gridquest/` in about 3.4 s. The directory did not exist before, so nothing was reused, no other file was touched, and nothing was committed.

**Files** (all under `/home/user/workflow-foundry/beds/gridquest/`):
- `index.mjs`: the contract interface (`family`, `outputSchema`, `generate`, `oracle`, `referenceSolve`, `badControls`, `createEnv`).
- `world.mjs`: builds the layout (rooms, locks, keys, switches, one-way passages) and checks every world before accepting it.
- `solver.mjs`: the reference BFS solver and a checker that counts the keys/switches every winning play must use. It also holds the explorer: a bot that sees the current room perfectly but has no map, used to prove each budget is winnable.
- `render.mjs`: room names, room prose, the expedition journal, observations.
- `engine.mjs`: command parser, game state, the env (reset/step/observe/snapshot/restore/actions, deterministic D0).
- `text.mjs`: vocabulary and prose templates.
- `diagnostics.mjs`: a keyword-matching bot, used only to calibrate difficulty.
- `README.md`: everything the brief asked for.
- `gridquest.test.mjs`: the tests.
- `index.js`: a 3-line shim I added because Node treats `node --test beds/gridquest/` as a module path and fails without it. The other beds will hit the same problem.

**Tests:**
- Same seed gives byte-identical tasks.
- The reference solution passes for 24 seeds × 5 difficulties × 2 splits.
- All 5 bad controls fail for 24 seeds × 5 difficulties: empty, shuffled-or-corrupted, random-walk, plausible-but-wrong (optimal path minus the final take), over-budget.
- Schema-invalid output is rejected, and a tampered task doesn't change the oracle's result.
- No leaks: the treasure room name, treasure description, solution plan and hidden-key reveal text never appear in prompt or inputs.
- Engine and solver agree, checked by replaying the reference and explorer runs and by random play.
- Every world is solvable, explorer-winnable, and needs at least 2 keys/switches at d3+ (3 at d4–5) in every winning play.
- Plus tests for the env API, parser variants, difficulty growth, and runtime.

**Token sizes** (dev split, 50 seeds per level; "episode" means prompt + inputs + every observation along the explorer's run):

| Difficulty | Grid | Prompt + inputs | Explorer episode avg (max) | All moves used | Optimal moves | Budget |
|---|---|---|---|---|---|---|
| 1 | 3x3 | 641 | 1.8K (2.3K) | 3.1K | 9.2 | 27.7 |
| 2 | 4x4 | 655 | 3.2K (4.8K) | 5.0K | 15.3 | 42.5 |
| 3 | 5x5 | 893 | 6.5K (9.9K) | 10.3K | 23.4 | 64.7 |
| 4 | 6x6 | 1,053 | 11.3K (17.3K) | 14.9K | 32.8 | 90.6 |
| 5 | 7x7 | 1,169 | 17.6K (26.6K) | 24.1K | 49.2 | 135.6 |

The prompt plus inputs stays small because the player only sees one room at a time; the real input load is the episode. Budget is 3.0× optimal at d1 and 2.75× at d2–d5. Generation takes about 10 ms on average at d5 and the oracle under 15 ms.

**How hard it is for simple bots:** the keyword bot passes 21/50 at d1, 5/50 at d2 and 0/50 at d3–d5. An unrestricted random walk won 4 of 3,000 d1 tasks, so the random-walk control never chooses `take treasure`. The explorer passes 100%, because passing it is a condition for accepting a world.

**Incomplete or caveats:**
- No language-model runs have been measured on this bed yet.
- Rejecting worlds the explorer can't win skews the d4–5 distribution: up to 12.4% of attempts are redrawn at d5. That removes some of the hardest layouts, where a trap chute or a switch that also closes a gate strands a greedy player.
- The prose comes from fixed template lists. A script written with knowledge of those templates could read observations perfectly, so the templates, the oracle-side modules and the README should stay out of any solver's context. Models that have read the README could also recognise the small set of lies and injection lines.
- Token counts use `estimateTokens` (bytes / 4), not a real tokenizer.

## Agent result 2

The kinetics bed is built in `beds/kinetics/` and all 15 tests pass under `node --test beds/kinetics/`. No model has been run against it yet, so the claim that cheap single-shot models fail at difficulty 3 and above is untested. The directory did not exist when I started, so nothing was reused.

Beyond the test suite, I swept 2,000 tasks (seeds 1–200, all five difficulties, both splits). The reference solution passed every one, no bad control passed any, and every trap was confirmed to break the fit if ignored. Generating or grading a difficulty-5 task takes about 12 ms, and one task uses about 65 MB of memory.

**Files** (all absolute):
- `/home/user/workflow-foundry/beds/kinetics/index.mjs` — the contract interface: generate, oracle, referenceSolve, output schema and 8 bad controls.
- `/home/user/workflow-foundry/beds/kinetics/world.mjs` — hidden truth, difficulty settings, noise selection and trap placement.
- `/home/user/workflow-foundry/beds/kinetics/render.mjs` — the six notebook formats, the SOP, chat, meeting notes, pilot plate, raw export, bench codes, prompt and condition register.
- `/home/user/workflow-foundry/beds/kinetics/fit.mjs` — Michaelis-Menten least-squares fit (grid search plus refinement), with an optional fixed Vmax.
- `/home/user/workflow-foundry/beds/kinetics/pools.mjs` — fictional names, note wording and the injection lines.
- `/home/user/workflow-foundry/beds/kinetics/kinetics.test.mjs` — the 15 tests, including a separate text parser that re-reads every well from the documents and checks each number times its stated unit equals the value the reference fits.
- `/home/user/workflow-foundry/beds/kinetics/index.js` — a small shim. Without it, `node --test beds/kinetics/` fails because Node treats the directory as a module; `beds/gridquest` uses the same fix.
- `/home/user/workflow-foundry/beds/kinetics/README.md` — description, settings per difficulty, oracle rule, why it needs judgment, adversarial content, controls and limits.

**Token sizes** (`estimateTokens(prompt) + estimateTokens(inputs)`, dev seeds 1–50):

| Difficulty | Conditions | Wells | Min | Median | Max |
|---|---|---|---|---|---|
| 1 | 2 | 24 | 1,609 | 1,698 | 1,813 |
| 2 | 3 | 63 | 2,412 | 2,500 | 2,614 |
| 3 | 5 | 150–200 | 5,587 | 6,123 | 6,585 |
| 4 | 7 (2 inhibitor) | 207–243 | 7,828 | 8,156 | 8,884 |
| 5 | 8 (3 inhibitor) | 240–310 | 9,996 | 10,684 | 11,161 |

Difficulty 3 sits at the low end of the contract's 6–15K target, and its minimum (5,587) falls just under it.

**Oracle rule:** a task passes only if every condition's Vmax (µM/s) and Km (µM) are within 10% of the generating values and `excluded_samples` exactly matches the true exclusion set. For an inhibitor condition, the true Vmax is the matching no-inhibitor condition's Vmax and the true Km is the apparent Km. The oracle also refits the correctly cleaned data itself and refuses to pass anything if that fit is outside 10%. Generation is set up so it always lands within 5%.

**Weak spots:**
- **Shared-Vmax rule:** the SOP rule that inhibitor conditions take Vmax from their no-inhibitor partner rarely changes the outcome. Fitting an inhibitor condition on its own still lands within 10% about 87–89% of the time.
- **Text checks:** the reference solution and oracle read the numbers as displayed in the documents but know the exclusions and corrections from the hidden truth. The separate parser checks numbers and units against the text, but the prose notes and corrections are only correct by construction, not checked by an independent reader.
- **Python sandbox:** not built, because the oracle is pure JavaScript.

Nothing was committed, and I edited nothing outside `beds/kinetics/`.

## Agent result 3

I audited and fixed gridquest (now version 2.0.0). The worst problem was in the env API: with unlimited rewinds, a short search script that reads no prose passed 30/30 at d3, and that is now blocked. Every heuristic that reads only what a solver sees is below 20% at d3. One gap remains: a script that imports the bed's own synonym table still passes 13/30 dev and 17/30 test at d3.

`node --test beds/gridquest/` runs 24 tests, all passing, in about 6–9 s. I only edited `beds/gridquest/` and committed nothing. A WIP commit made at 20:04 already contains some of my in-progress edits, so `render.mjs` and `world.mjs` don't show as modified in `git status`.

**Findings and fixes** (each has a regression test; details in `AUDIT.md`):
- **F1, critical: snapshots.** `restore()` accepted forged state, so you could teleport into the treasure room and win. `reset()` and `restore()` also gave back spent moves, which made the blind search possible.
  - Fix: snapshots are now sealed AES-GCM strings. They are deterministic and tied to the task, and cannot be read or forged.
  - Fix: each env keeps a lifetime count of moves, capped at the budget by default; `reset()` and `restore()` never lower it.
  - New `env.record()` returns the current episode record for submission.
  - Result: the blind search now fails 0/30 at d1, d3 and d5. With the cap removed (`lifetimeActions: Infinity`) it still wins 30/30, 30/30 and 27/30, which shows the cap is what stops it.
- **F2, high: `actions()` leaked the answer.**
  - The hiding container was always listed first (50/50 rooms).
  - Door directions were resolved for the solver, including the sky phrasings.
  - `take treasure` appeared only in the treasure room.
  - Fix: the list is now sorted, gives every object the same verbs, offers doors in all four directions and always offers `take treasure`. The hiding container is now first in 18/50 rooms, about chance.
- **F3, medium: oracle input.** It accepted an `actions` property that wasn't the object's own, and arrays with holes, and it read getters twice. It now converts the output to JSON once, with size limits, before checking and replaying it.
- **F4, low:** after 80 failed attempts the generator could return a world the certifying explorer hadn't won. It now throws after 200 attempts; this never actually happened.
- **F5, medium:** journal reliability could be read off the wording. Every true-note wording now also appears in false notes.
- **F6, medium:** "no way through" lines sat on walls that have a real exit, and there were article errors ("a oak door", "a amber lock plate"). Both fixed.
- **F7, high: triviality.**
  - Prose changes: exits placed relative to an object instead of a compass word, with synonyms for the object; chains of those references; reworded object placements; fake exits; reopened exits where only clause order decides.
  - New rules in the prompt explain how to resolve these.

**Pass rates of the heuristic agents at d3 (out of 30 seeds):**

| agent | before (dev) | after (dev / test) |
|---|---|---|
| regex agent tuned to the original templates (40-line function) | 18 (60%) | 0 / 0 |
| regex agent tuned to the new templates, no synonym table (40-line function) | — | 1 / 2 |
| blind agent, no exit parsing | 0 | 0 / 0 |
| original keyword agent | 0 | 0 / 0 |
| template-aware agent that imports the synonym table (46-line function) | — | 13 / 17 |

`referenceSolve` passes 30/30 at every level on both splits. Every bad control (empty, shuffled, random walk, near miss, over budget) fails 30/30 at every level.

**Token sizes** (dev, 50 seeds). The fixed prompt plus inputs is small because the keep is revealed one room at a time; most of what a solver reads arrives during play.

| difficulty | prompt + inputs | episode with explorer | full budget used |
|---|---|---|---|
| 1 | 878 | 1,996 | 3,308 |
| 2 | 903 | 3,612 | 5,550 |
| 3 | 1,162 | 8,556 | 12,915 |
| 4 | 1,323 | 13,492 | 19,020 |
| 5 | 1,453 | 19,767 | 26,586 |

At d5, generate averages 14 ms (130 ms max) and the oracle on a 2000-action record about 2 ms; a fresh process stays under 200 MB.

**Still open:**
- **The white-box gap.** The prose comes from a finite set of templates, so a script with the bed's own vocabulary eventually wins. Its failures are mostly weak search, so a better script would score higher. The bed only measures judgment if `text.mjs` stays out of every solver's and workflow author's context.
- **The env service in `experiments/lib/services.mjs`** (outside my directory, not changed). It stores the sealed snapshots correctly, but every `create` call gives a fresh env and a fresh move count. An agent that calls `create` repeatedly can still search blindly. The service should refuse a second `create` per episode, or share one count, and log moves spent.
- **Static input is below the contract's 6–15K aim at d3** (about 1.2K tokens). The full episode, 8.5–13K, is within it.
- **No language-model runs yet.**
- **Greedy certification:** every world is winnable by the greedy no-map explorer, so the bed rewards perception and bookkeeping more than look-ahead planning.

Files are in `/home/user/workflow-foundry/beds/gridquest/`:
- AUDIT.md (new)
- README.md
- index.mjs
- engine.mjs
- render.mjs
- text.mjs
- world.mjs
- diagnostics.mjs
- gridquest.test.mjs

`solver.mjs` and the `index.js` shim are unchanged.
