# Workflow beds-tier-a-split (wf_0d4ee9d7-1f7)

status: completed; finished agents: 2

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

The `runbook` bed is complete. It lives entirely in `beds/runbook/` (nothing outside it was edited, nothing committed), and all 20 tests pass with `node --test beds/runbook/` in about 5 s. No model has been run on it yet, so the aim that cheap single-shot models usually fail at d≥3 is untested.

**Checks:**
- **Reference and controls:** on a wider sweep of 3,000 tasks (300 seeds × 2 splits × 5 levels), the reference solver passed every time and no bad control ever passed.
- **Judgment probe:** `stale-ticket` follows the original ticket text and ignores later authorised comments. It failed on all 2,244 tasks where those comments matter.
- **Rule detection:** each of the 16 safety rules has its own test that edits the reference to break just that rule, and the oracle flags it by name.
- **Runtime:** at d5, `generate` takes about 16 ms and `oracle` about 7 ms.

**Input size per level** (prompt + inputs via `estimateTokens`, 100 dev seeds each):

| level | input tokens, mean [min–max] | runbook steps | reference actions, mean | tokens of tool output during an episode, mean |
|---|---|---|---|---|
| d1 | 2,855 [2,822–2,882] | 8 | 36 | 1,326 |
| d2 | 3,815 [3,738–3,868] | 13 | 65 | 2,531 |
| d3 | 6,512 [6,389–6,597] | 19 | 96 | 3,734 |
| d4 | 8,777 [8,645–8,924] | 23 | 137 | 5,630 |
| d5 | 10,983 [10,743–11,120] | 25 | 187 | 9,208 |

**How it works:** each seed has a hidden failure plan: retryable or permanent restart failures, a node that never becomes healthy, replication lag that recovers or stalls, the slow-start config change refused by policy, or an error spike after the feature flag. Every task has at least one situation that needs a compensation or a page. The oracle replays the action record and passes it only if all of these hold:
- The final state matches the expected state for that scenario, with no collateral changes.
- No safety rule was broken at any step.
- Every required page and compensation happened.
- The required check readings were taken: two error-rate readings a set interval apart, workers re-read after restart, and the database re-read after its last restart.

The README has the exact pass rule, partial-credit formula, knobs table, why it needs judgment, and the adversarial content by level.

**Incomplete or worth knowing:**
- **Token size:** d3 is about 6.5K input tokens, at the low end of the 6–15K aim. Tool output adds about 3.7K on average (up to 5.5K) during an episode.
- **Stall frequency:** the scenario where lag never recovers and the change must be aborted is designed at 8% from d3, but came out at 14% on d3 seeds 0–99.
- **Snapshot/restore:** it lets a harness peek ahead (for example, see a restart fail, then rewind). Any arm that gives this to a model should be labelled as look-ahead.
- **Test command:** `node --test beds/runbook/` does not search directories on Node 24. Like the sibling families, I added an `index.js` that loads the test file.
- **Repo dependency:** the schema-portability test imports `src/schema-subset.mjs`.
- **Fairness change:** a malformed config value (e.g. `"45s"`) returns a correctable `INVALID VALUE` error rather than a policy rejection, so a typo does not force an abort.

Files are in `/home/user/workflow-foundry/beds/runbook/`:
- README.md
- index.mjs
- index.js
- world.mjs
- render.mjs
- sim.mjs
- judge.mjs
- solve.mjs
- runbook.test.mjs

## Agent result 2

The gameqa bed is finished in `/home/user/workflow-foundry/beds/gameqa/`. `node --test beds/gameqa/` runs 16 tests and all pass, in about 6–13 s.

A wider check over 300 seeds per difficulty for both splits (3,000 tasks) found no generation errors. The reference solution passed every task and no bad control passed any.

**Two things that differ from what the brief implies:**
- **Test command.** On Node 24, `node --test beds/gameqa/` errors out on a bare directory. I added `beds/gameqa/package.json` pointing at the test file, the same workaround `beds/records` uses.
- **Oracle input.** It takes the bug report `{bugs:[{bug_class, repro_actions, description}]}`, as the family spec asks, rather than the generic `{actions}` episode record. It still replays each repro in fresh environments, once on the buggy build and once on the control build. This is noted in the README.

Files in `/home/user/workflow-foundry/beds/gameqa/`:
- `index.mjs` — the contract interface, including `createEnv` (create/reset, step, observe, snapshot, restore, actions; snapshots are opaque handles)
- `engine.mjs` — the game; with no bugs it is the control build
- `world.mjs` — seeded world and rules, including errata; generated before any bug is picked, so the map never hints at the bugs
- `bugs.mjs` — the bug catalog: 13 templates covering the 10 bug classes
- `planner.mjs` — path planner that dodges moving enemies; used to build the known repros
- `case.mjs` — per-task truth, cached, plus the replay check the oracle uses
- `text.mjs` — design doc, floor notes, reports, changelog, community wiki, prompt
- `sessions.mjs` — recorded QA sessions, kept only if no planted bug fires during them
- `decoys.mjs` — documented quirks used by the near-miss control
- `driver.mjs` — JSON-lines stdin/stdout driver for CLI harnesses
- `gameqa.test.mjs`, `package.json`, `README.md`

**Pass rule:** an entry counts only if its class matches a planted bug, that bug's internal detector fires during the buggy replay, and the control replay's observations differ from that step on. Score is recall; pass requires recall ≥ 0.8 and at most one false report. Duplicates count once. Repro length against the known shortest repro is reported but does not affect pass.

**What the tests cover:**
- **Reference solve:** passes 20 dev seeds per difficulty and 5 test seeds per difficulty.
- **Bad controls:** each fails 20 seeds × 5 difficulties. They are: empty, shuffled-or-corrupted, sibling-class, by-design-overreport, trigger-dropped.
- **Oracle input checks:** rejects malformed output; duplicates count once; one false report is tolerated, two are not.
- **No truth leaks:** no bug or template ids or known repros appear in the prompt or inputs, and the buggy and control builds look identical at the start.
- **Engine and environment:**
  - Every class and template appears across seeds.
  - The control build never fires a detector.
  - The environment is fully deterministic (D0).
  - Snapshot/restore works.
  - Crashes end the episode.
- **Size and runtime:** sizes grow with difficulty, and generate and oracle each stay under 2 s at d5.

**Token sizes** (prompt + inputs, 30 dev seeds):

| Difficulty | Avg | Min–max | Bugs (K) | Known repro length avg / max |
|---|---|---|---|---|
| d1 | 3,601 | 3,529–3,646 | 1 | 18 / 87 |
| d2 | 4,393 | 4,196–4,570 | 2 | 20 / 56 |
| d3 | 6,445 | 6,103–6,864 | 3 | 36 / 117 |
| d4 | 7,558 | 6,796–8,061 | 4 | 37 / 147 |
| d5 | 8,937 | 7,926–9,622 | 5 | 61 / 212 |

Runtime at d5: generate takes at most about 250 ms. The oracle takes at most about 60 ms, and about 50 ms on a worst-case output of 20 entries × 400 actions.

**Incomplete or unmeasured:**
- I haven't run any real model against it, so "single-shot cheap models fail at d ≥ 3, decomposition succeeds" is design intent, not evidence.
- d3 averages about 6.4K tokens of static input, the low end of the 6–15K target. Most of the load comes from playing: each observation is about 250–350 tokens.
- The "minimal known" repro is the planner's shortest-path repro, an upper bound rather than a proven minimum.
- Determinism is D0 only, so there are no flaky (D1/D2) bug variants; visual bugs are ASCII-level, not pixel-level.
- Some files under `beds/gameqa` show up in WIP snapshot commits I didn't make. I made no commits.
