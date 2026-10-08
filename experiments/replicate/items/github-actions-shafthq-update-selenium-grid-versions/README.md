# R-bench item `github-actions:shafthq/shaft_engine/.github/workflows/update-selenium-grid-versions.yml`: the weekly Selenium Grid image bump

Status: development/diagnostic harness, built 2026-10-08. No solver arm has run on it and nothing here is a sealed set.
Selection rationale: `research/replicate-20261008/SELECTION.md` (pilot slot P5, "the only pilot whose original runs offline as a true control").
Corpus item: `research/corpus-20261006/items.jsonl`; raw workflow `/opt/corpus/github-actions/raw/shafthq__shaft_engine@3b2eae51…/.github/workflows/update-selenium-grid-versions.yml`,
sha256 `dff6b15a…facef`, MIT, redistributable. It is vendored **byte-identical** in `fixtures/original/` with its `LICENSE` and a `PROVENANCE.md`.

## 1. The job, in the author's terms

SHAFT is a test-automation framework. It ships a docker-compose file that starts a Selenium Grid (`src/main/resources/docker-compose/selenium4.yml`: a hub and Chrome, Edge and
Firefox nodes), with every image pinned to a dated tag such as `selenium/node-chrome:4.35.0-20250909`. A maintainer wrote a 177-line GitHub Actions workflow, "Update Selenium Grid
Docker Versions", so nobody has to bump those tags by hand. Every Monday 08:00 UTC (or on demand) it:

1. fetches the Selenium project's reference compose file (`https://raw.githubusercontent.com/SeleniumHQ/docker-selenium/trunk/docker-compose-v3.yml`) with `curl -s`;
2. takes the first `image: selenium/node-chrome:` / `node-edge:` / `node-firefox:` / `hub:` line of it with `grep | head -1 | sed`, "filters out nightly, beta, dev" by reducing a
   tag that contains one of those words to its first `N.N.N-N` part;
3. reads the same four tags from the repository file;
4. where a tag differs, rewrites it in the repository file with `sed -i "s|selenium/IMG:OLD|selenium/IMG:NEW|g"`;
5. only then validates the result with `docker compose config`, and
6. opens a pull request (`peter-evans/create-pull-request`, branch `auto-update-selenium-grid-versions`, labels `dependencies`/`automated`, a body with a version table).

The job's promise is in the PR body: "All versions are from the latest stable release (no nightly/beta/dev builds)". The author's own steps are the only specification there is.
**Low judgement:** a ~50-line function solves the job (`solveImproved` in `controls/reference.mjs`; the one-node Foundry workflow has about the same), so this item measures replication fidelity and the control machinery, not judgement
(SELECTION.md said so in advance). `beds/CONTRACT.md` asks for natural-language judgment on one-shot families; this item does not have it, and it is reported rather than forced.

## 2. What T1 / T2 / T3 give the solver

`generate({seed, split, difficulty, variant})`, `variant` = `T1 | T2 | T3`, `difficulty` 1-5 (which scenario kinds are drawn, section 3). Sizes are tokens (utf8 bytes / 4), difficulty 3.

| | T1 translate | T2 rebuild from intent | T3 improve |
|---|---|---|---|
| The original workflow (`original/update-selenium-grid-versions.yml`, + `original/LICENSE`) | yes | **no** | yes |
| The author's description (section 1 as prose) | no | yes | yes |
| The maintainers' rules R1-R8 (`prompts.mjs`; the hidden scenarios check exactly these) | no | yes | yes |
| Three worked examples (an input and the correct plan, different data than any scored task) | no | yes | no |
| Output contract (`inputs`, `plan`, how the host applies it), solver skeleton `solve.mjs` | yes | yes | yes |
| Cost/latency target `budget.target` (no model call per run; solver wall time <= the original's median) | no | no | yes |
| Prompt + inputs + files | ~4.3 K | ~5.3 K | ~5.2 K |
| Judged on | the **original's** behaviour on every scenario, defects included | the **maintainers' intent** on every scenario | intent, plus the target (judged apart: `meetsTarget`) |

`inputs` (all variants): `trigger`, `repo_files` (`selenium4.yml`, `README.md`), `reference_fetch` (`{url, status, body}` or `{url, error}`: the answer to the one GET), `open_pull_requests`.
A solution is `solve(inputs) -> plan` and the plan is `{status: updated|unchanged|failed, versions: {current, latest}, files, pull_request: {open, branch, title, commit_message, body, labels}, message}`.
**The host does the effects**, like the workflow's runner does: it performed the fetch, it lays `files` over a copy of the repository, and it asks the pull-request service for a pull request from
the difference (which opens nothing when there is no difference, and updates the open pull request of the same branch instead of opening a second). A failed plan has no effects.
This is "execution authority outside the model" (AGENTS.md) and it is also the only shape today's Foundry IR can run (section 6).

## 3. How a solution is run and judged

* **Task = one Monday.** `seed` picks the scenario kind round-robin from the kinds available at that difficulty (d1: 3 kinds, d2: 6, d3: 9, d4: 12, d5: all 14) and draws its content from
  the seed (tags, dates, which images are stale, service order, CRLF, trailing spaces, open pull requests). Pure function of `(seed, split, difficulty)`. The hidden instance and its
  truth are rebuilt by the oracle (`instanceOf`), never put in a task (a test scans 210 tasks, every variant and difficulty, for the expected files and the kind names).
* **Oracle** (`oracle.mjs`): judges *effects* only. It applies the plan through the same pull-request stub the executed original uses, then checks: the run's status (and that the plan's own claim
  agrees), no pull request on failure or no change, **exactly one** pull-request operation when something changed with the right action (created, or updated for the existing number), exactly one open bot
  pull request, base, exact title, label set, changed files = only `selenium4.yml`, **its content byte-equal to the expected edit**, a commit message and a body that name every changed image with old
  and new tag (any wording and either order, on one line or in a short block under the image's name; "new -> old" does not count: verifier change, section 11), other pull requests untouched, the reported `versions`; and, for an executed workflow, that the fetch went to the recorded URL and nothing was blocked. On a failure in
  intent mode the message must name the cause. A failed plan's files and pull-request request are discarded by the host, as the contract says, and are not judged (`details.discardedEffects` reports them; the builder's `FAILED_WITH_EFFECTS` check was removed by the verifier, section 11).
  Violation codes: `SCHEMA STATUS STATUS_CLAIM OTHER_PR_TOUCHED PR_ON_FAILURE MESSAGE VERSIONS PR_UNEXPECTED PR_OPERATIONS PR_ACTION PR_SINGLE_BOT PR_BASE PR_TITLE PR_LABELS PR_FILES FILE_CONTENT PR_COMMIT_MESSAGE PR_BODY FETCH NO_BLOCKED_CALLS`. `score` = share of checks passed; `pass` = all.
* **Two truths per instance, built by construction** (the generator planted the tags): `original` (what the vendored workflow does; judges T1) and `intent` (what the maintainers evidently want; judges T2/T3).
  They are equal except on the five defect kinds below.
* **Why `versions` is in the plan:** the original prints "Latest versions found:" and "Current versions:". Reporting them is part of the job's visible output and it makes a do-nothing plan fail every task, including the ones where nothing is to be done.

Scenario kinds (14; the canonical authored suite is seed 0-13 at d5, materialised in `fixtures/scenarios/`; **D** = the original misbehaves):

| # | kind | from d | the Monday | the original does | intent |
|---|---|---|---|---|---|
| 0 | bump-all | 1 | all four tags newer; a comment in the file repeats the chrome tag | PR; every occurrence (comment too) rewritten | same |
| 1 | bump-some | 1 | 1-3 tags newer | PR | same |
| 2 | no-change | 1 | already current (reference has trailing spaces / CRLF) | nothing | same |
| 3 | prerelease-reducible | 2 | reference tags `X-nightly`, `-beta`, `-dev`, `-Nightly`, `-BETA`, `dev-X` | reduced to `X` | same |
| 4 | open-pr-update | 2 | a bot PR is open (and a dependabot PR) | the existing PR is updated | same |
| 5 | open-pr-no-change | 2 | bot PR open, repository current | nothing | same |
| 6 | repo-missing-image | 3 | the repository has no service for one image | others bumped; the image is not added; if only it is newer, `changes=true` but no diff, so no PR | same |
| 7 | duplicate-lines | 3 | image listed twice in the reference, used by two services in the repository | first reference line; all repository occurrences | same |
| 8 | prerelease-unreducible | 3 | a tag like `nightly`, `4.36.0-beta1` | fails in step 2 (errexit on the `grep -o` that finds nothing), no PR | same (its warning line says pre-release) |
| 9 | **D** reference-malformed | 4 | 404 text / 503 HTML / empty / 500 JSON / another project's compose | blanks all four tags, then validation rejects it: fails, no PR | same outcome **and a message that names the reference** |
| 10 | **D** reference-missing-image | 4 | the reference lacks one of the four images | blanks that tag, validation rejects: fails | message names reference and image |
| 11 | **D** reference-unreachable | 4 | connection cut | `curl -s` fails silently (exit 52), no text at all | message says the reference could not be fetched |
| 12 | **D** commented-image-line | 5 | a commented-out older image line precedes the real one in the reference | takes the comment: a **downgrade** PR | comments ignored |
| 13 | **D** quoted-image-refs | 5 | the repository quotes some image references | `grep` cannot see them: a PR with the new tag **glued in front of the old one** | correct PR / nothing if current |

**Rules R1-R8** (given to T2 and T3, `prompts.mjs`): tag reading (first real line, quotes/comment/CRLF not part of it), stable builds only (reduce, else fail), the edit (every occurrence, nothing else, quoting kept,
no image added), nothing to do, the pull request (branch, base, title, labels, texts name the changes), one pull request, failure (nothing changed, message names the reference / the image / the tag), report.
T1 gets none of them: the original is its specification.

## 4. Controls

Raw numbers: `controls/report.json` (regenerate: `node controls/run-controls.mjs --per-kind 10 --mutant-seeds 2 --foundry --write`, plus `--baseline` to re-measure the frozen T3 baseline). The verifier regenerated the report on 2026-10-08 after the oracle change (section 11) without `--baseline`: every pass/fail count below is unchanged; mean scores moved slightly (one check fewer), and that run measured the original's median at 236 ms and `foundry run` at 0.72 s median (1.46 s max).

| Control | Result |
|---|---|
| **The ORIGINAL, executed** (`runner.mjs`: its `run:` steps under `bash -e`, curl shim to the recorded mock, docker stub, recording create-pull-request stub, private /tmp), 14 canonical + 126 more (10 seeds of every kind) | **140/140 pass in original mode** (each of the 14 canonical runs makes exactly one call to the reference host and nothing is blocked); in intent mode the 5 defect kinds fail 50/50 and 90/140 pass: the T3 headroom |
| JavaScript port of the original's bash (`solveFaithful` = `referenceSolve` for T1) vs the executed original | identical effects (status, PR fields, texts, file bytes, versions) on **140/140** instances |
| `solveImproved` (= `referenceSolve` for T2/T3) | passes 28/28 seeds at each difficulty 1-5 for T2 and T3; `solveFaithful` 28/28 for T1 (420 plan checks) |
| Both references disagree exactly on the 5 defect kinds | tested: the faithful port fails 5/14 in intent mode, the improved reference fails 2/14 in original mode (the two non-message defects) |
| **Do-nothing** (schema-valid: unchanged, nothing, no versions) | fails 420/420 tasks (mean score 0.35; 0.41 before the verifier's oracle change); on the unchanged-kinds the only violation is `VERSIONS` |
| `empty`, `corrupted` (one digit of one tag), `shuffled-file`, `only-chrome-updated`, `wrong-branch`, `pr-without-change`, `prerelease-filter-dropped`, `error-swallowed`, `blanked-tags`, `versions-misreported` (right effects, wrong report: mean score 0.89), `transcription-of-the-original` (T2/T3), `improved-instead-of-original` (T1) | 13 controls, **rejected on every task they apply to** (applicable counts 4-420 over seeds 0-27 x 3 variants x 5 difficulties; the test sweeps 168 seeds at d5 x 3 variants and requires >= 20 applications each) |
| 9 **broken variants of the ORIGINAL** (`controls/mutants.mjs`): pre-release filter dropped; PR guard inverted; only Chrome updated; last match instead of first; validation step removed; `branch:` input removed; `labels:` removed; PR opened every week (file touched); curl URL changed | each fails on exactly the instances it breaks and **passes the others** (28 instances each; `wrong-reference-url` fails everywhere by design: the shim blocks it, the mock sees nothing, `FETCH` and `NO_BLOCKED_CALLS` fire) |
| 1 EQUIVALENT variant (`sed` without `g`: no instance has two occurrences on a line) | passes 28/28: the oracle does not prescribe the text of the workflow |
| An independently written solution of a different shape (line-based, own tag reader) | passes 56/56 (T2/T3, 28 seeds each) |
| The same behaviour as a **Foundry workflow**, one pure `code` node, through the real `foundry run` (`controls/foundry-workflow.mjs`) | **14/14 pass** (Foundry's own verdict is `unverified`: acceptance only checks that an answer exists). Wall time 1.1-2.5 s per run against the original's median 0.19-0.37 s: 0/14 runs within the T3 latency target |
| Docker stub vs the real `docker compose config` (Docker Compose 5.6.0, offline) on 34 recorded probes (`fixtures/docker-probes.json`) | agrees on all 30 it models; refuses the 2 flow-collection files; 2 more it does not check are marked out of scope (port types, `depends_on`). Also agrees on the 14 files this item's faithful port produces |

The T3 target in `fixtures/baseline.json` is machine-dependent: the original's median wall time on this shared machine was **189, 241, 358 and 370 ms** in four measurements within an hour (load from sibling agents). Re-measure
(`node controls/run-controls.mjs --baseline`) on the machine that runs the arms, before comparing arms on latency.

## 5. What looks improvable in the original (T3 targets)

Evidence class: **[E]** executed on the mocks and reproduced by `item.test.mjs`; **[I]** inferred from the code, not exercised. Line spans refer to the vendored original (`fixtures/original/update-selenium-grid-versions.yml`, 177 lines). Summary: the original meets the maintainers' intent on 9 of the 14 kinds and fails the other 5 (90/140 instances).

1. **Quoted image references are silently corrupted** [E, kind 13; original lines 67-70 and 99-121]. `grep 'image: selenium/IMG:'` cannot see `image: 'selenium/IMG:TAG'`, so the current tag is "". The `sed` pattern becomes `selenium/IMG:` and the new tag is inserted in front of the old one:
   `image: 'selenium/node-edge:4.21.0-20250607'` becomes `image: 'selenium/node-edge:4.21.0-202506074.21.0-20250607'` (this is the instance where the versions were already equal). The result is valid YAML, so `docker compose config` accepts
   it and a reviewer receives a pull request with a bogus tag; each later run would repeat it on the quoted lines [I]. (Compose also accepts a tag containing a quote or a space, `fixtures/docker-probes.json`, so validation is no help.)
   My first prediction, from reading the code, was that this case would die with a bash syntax error or fail validation: wrong. Executing the original corrected it (README section 8, lesson).
2. **A commented-out image line in the reference is taken as the latest version** [E, kind 12; lines 27-30]: `grep` matches the comment, so the job opens a **downgrade** PR (e.g. `selenium/node-chrome:4.38.0-20251010` to `4.2.0-20210201`).
3. **A bad reference is rejected by accident** [E, kinds 9-11; lines 24, 99-121, 131-135]. An error page, an empty body or a missing image make every affected tag empty; the job then blanks the tags in the file (`sed s|selenium/IMG:OLD|selenium/IMG:|g`) and the *validation step* happens to fail
   because `image: selenium/hub:` followed by a line end is a YAML error. It never says what is wrong with the reference (the log shows a YAML message; `curl -s` hides a dead connection entirely: exit 52, no text). The safeguard exists only because the file ends the line there.
   The safeguard is the YAML parser rejecting an empty tag after the damage is done; it is not a check on the reference.
4. **Pre-release handling works by luck of `set -e`** [E, kind 8; lines 33-51]: a tag with no `N.N.N-N` part (`nightly`) makes `VAR=$(... | grep -oE ...)` exit 1 and the step dies after printing the warning. The "filter" is therefore "fail the whole job", not "skip the pre-release", and the warning is the only text.
   A tag with two `N.N.N-N` parts produces a two-line `GITHUB_OUTPUT` value, which the runner rejects (modelled, tested in the port).
5. **Not a defect, contrary to the selection's guess:** SELECTION.md T3 expected "open another PR instead of updating the open one". With `peter-evans/create-pull-request` reusing the branch, the original updates the open PR (kind 4 passes). This rests on A1 below
   (the action's documented behaviour, not its source); if the action does not behave so, kind 4 becomes a defect and `truth.original` for it changes.
6. [I] The current tag is spliced into `sed` as a regular expression (dots match anything) and as shell text (`"${{ ... }}"`): a tag with `$`, a backtick or a backslash would be expanded by bash, and a `|` would break the `s|||`. The port throws `UNMODELLED` on those instead of guessing; no scenario produces them.
7. Cost/latency: the job is a pure text transformation. Its steady-state cost is zero model calls, and a plain function does it in ~1 ms against ~0.2-0.4 s for the original (six bash invocations, four `grep|head|sed` pipelines each). The Foundry runtime adds 1.1-2.5 s per run (section 6).

## 6. What this says about Foundry (execution semantics supported, unknowns remaining)

* **Plans, not effects.** A Foundry `code` node is pure ("no network, no files, no environment"); the IR has no effect nodes, triggers or cross-run state (`research/review-20261007/02-ir-expressiveness.md`). The job can be run only in the
  host-does-the-effects shape of section 2. Verified, not assumed: `controls/foundry-workflow.mjs` is a valid one-node workflow (`foundry validate`) that `foundry run` executes in the C0 protocol (`{prompt, inputs, files}` in, node `answer` out) and the oracle accepts 14/14.
* **The fetch, the schedule and the pull request are outside the workflow**, so what this item measures for T1 is the translation of the *transformation* (steps 2-5), not of the orchestration. The orchestration is what `runner.mjs` and the stubs reproduce for the control.
* **Latency:** `foundry run` costs 1.1-2.5 s of process and runtime start-up per run for a ~1 ms computation; the original is 0.19-0.37 s. A T3 latency target relative to the original cannot be met through the CLI; it can through an in-process call of the compiled code.
* **Unknowns:** how an arm's model-written `code` node behaves on this task has not been measured (no arm has run); a Foundry run of the whole job with real effects (fetch, PR) is not expressible.

## 7. Modelling assumptions

Evidence: **observed** (in the workflow or run here), **doc** (recalled documentation, not read this session), **inference**, **unavailable**.

| # | Assumption | Evidence |
|---|---|---|
| A1 | `peter-evans/create-pull-request@v8`: no difference to the base means nothing happens; otherwise it pushes the branch and opens a PR; an open PR from the same branch is updated, never duplicated; inputs left out take their defaults; labels are a comma/newline list. On an update the stub replaces every field with what the run supplied (the real action only adds labels) | doc; the action's source was not available offline |
| A2 | A `run:` step with no `shell:` runs as `bash -e {0}` (errexit, **no** pipefail) | doc |
| A3 | `$GITHUB_OUTPUT` accepts `name=value` and `name<<DELIM` blocks; a line that is neither fails the step; blank lines are skipped | doc, blank-line rule inference |
| A4 | GitHub compares strings in `if:` case-insensitively; a missing context value is "" | doc |
| A5 | `secrets.GITHUB_TOKEN` is a fixed dummy string, `actions/checkout` is a no-op (the workspace already holds the repository) | design |
| A6 | `docker compose -f FILE config` accepts or rejects as Docker Compose 5.6.0 did on the 34 recorded probes, and does not validate image reference syntax | observed (`fixtures/docker-probes.json`) |
| A7 | The runner's tools are this container's: GNU bash 5.2.21, grep 3.11, sed 4.9, curl 8.5.0 (the original's target is `ubuntu-22.04`: bash 5.1, grep 3.7, sed 4.8). `LANG=C.UTF-8` | observed; differences unavailable |
| A8 | The reference file's real content, and the real `selenium4.yml`, are unknown here; the synthetic shapes follow what the greps read. A real reference may list an image on several lines or services in ways not generated | unavailable |
| A9 | The GitHub API, the real raw.githubusercontent.com, the Actions runner and the action itself were never contacted or run | observed |

Intent assumptions behind `truth.intent`: I1 commented-out lines are not image lines; I2 YAML quoting is not part of a tag and is preserved; I3 an image absent from the repository file is not added; I4 a reference that is unusable, or a pre-release with no stable part, fails the run
(the PR is not opened for the rest); I5 a failed run must say what is wrong with the reference (words `reference`, `docker-compose-v3`, `fetch`, ...; plus the image for a missing one) or the pre-release; I6 only `selenium4.yml` changes.
They are the owner's call to adjust: they are the lines R1-R8 and `scenarios.mjs` hold.

## 8. Deviations, limits, obstacles

Reported as they happened. Exact messages in quotes.

* **O1** `experiments/lib/beds.mjs#loadFamily` resolves `beds/<id>/index.mjs` or `sealed-N` only: `Error: Unknown bed family rbench-github-actions-shafthq-update-selenium-grid-versions at loadFamily (file:///home/user/workflow-foundry/experiments/lib/beds.mjs:19:34)`.
  `runExperiment` therefore cannot take these tasks until it has a branch for `experiments/replicate/items/*`; `experiments/lib` and `beds/` were frozen for this task. The test `loadFamily can load this item` is marked `todo` and flips when that is fixed.
  `solverView`/`inlineRender` already work on these tasks (tested), and `run-solution.mjs` judges a solver module directly.
* **O2** The corpus holds the workflow and its LICENSE only: `find /opt/corpus/github-actions/raw/shafthq__shaft_engine@3b2eae51… -type f` lists exactly `…/.github/workflows/update-selenium-grid-versions.yml` and `…/__LICENSE__LICENSE`. `selenium4.yml` (SELECTION.md: "acquire one file") was not acquired
  (this task allows no network call to a third party), so every compose fixture is synthetic. Consequence: A8.
* **O3** No YAML library: `ls node_modules | grep -i -E "yaml|toml"` printed nothing and installing one is out of bounds. `miniyaml.mjs` (~150 lines) is a subset parser that **throws `UNSUPPORTED`** on flow collections, anchors, folded scalars, merge keys, multi-line scalars and extra documents. It reads the original and
  every variant; `docker`'s stub refuses what it cannot read (exit 125) instead of guessing.
* **O4** The original writes an absolute path, `curl -s … > /tmp/reference-compose.yml`. Run as is, every execution would use (and share) the host's /tmp. `runner.mjs` gives each step a private tmpfs /tmp with `unshare --mount --propagation private` where that works (this container, as root: `isolation: "mount-ns"`),
  and the test asserts the host /tmp stays clean. Where `unshare --mount` fails, `isolation()` reports `none`, the run uses the host /tmp and the tests run the original one at a time. The `none` path is NOT exercised: it would write `/tmp/reference-compose.yml` on the host, outside the area this task may write to.
* **O5** Foundry cannot run this job end to end (section 6). `docker` is installed but has no daemon: `failed to connect to the docker API at unix:///var/run/docker.sock; check if the path is correct and if the daemon is running: dial unix /var/run/docker.sock: connect: no such file or directory`; `docker compose config` needs none, which is why the validation could be recorded for real.
* **O6** Executing corrected reading, twice. (a) I first modelled the quoted-reference kind as "bash syntax error, run fails" (reasoning from the `"${{ }}"` splice); the executed original instead produced the glued-tag PR, because `grep 'image: selenium/IMG:'` does not match a quoted line at all. The scenario, its truth and the README were rewritten after that run.
  (b) My first `controls/foundry-workflow.mjs` run failed with `requireStack: [] | } | Node.js v24.21.0`: my own off-by-one in the repository-root path (the CLI needs `cwd` = repository root). Neither is a harness limitation; both are why the truth is checked by execution.
* **O7** Latency numbers vary 2x with machine load (section 4). Cost/latency targets are therefore comparative: measure the original and the arms together.
* **O8** Another process committed this directory in the middle of the build (`git log` shows `016983d WIP snapshot: stage-1 engine work, Kev wave A, replication pilot, corpus integration in progress (unreviewed)` covering earlier states of these files). I did not touch git state; the working tree is the source of truth.
* **Limits.** The oracle is checked by 13 plan-level bad controls, 10 broken variants of the original, an equivalent variant, three valid designs (two references, one independent, one Foundry workflow); other valid designs may exist that it rejects (the strict choices: byte-equal file, `versions` exactly as the original prints them, the message tokens in
  intent mode). Nothing here supports a claim about arbitrary worst-case correctness or commercial parity with GitHub Actions: the runner supports exactly the semantics listed in the header of `runner.mjs` and throws on the rest.
  The corpus workflow and its steps were executed, as the task instructed, in a minimal environment with the network shimmed to a local mock (a test proves a second host is blocked and logged, and that no credential-looking variable reaches a step); the file is untrusted data and was reviewed (it calls only curl, grep, sed, head, echo, docker) before it was run.

## 9. Files

`index.mjs` bed interface (+ `instanceOf`, `meetsTarget`, `materialize`) · `spec.mjs` constants · `scenarios.mjs` templates, 14 kinds, truth (HIDDEN) · `oracle.mjs` schema and judge · `prompts.mjs`, `examples.mjs` task text ·
`runner.mjs` workflow executor · `miniyaml.mjs` · `mocks/` `reference-server.mjs`, `pull-requests.mjs`, `compose-validate.mjs`, `docker.mjs`, `bin/curl`, `bin/docker` ·
`controls/` `original.mjs`, `mutants.mjs`, `reference.mjs`, `broken.mjs`, `foundry-workflow.mjs`, `run-controls.mjs`, `record-docker-probes.mjs`, `report.json` ·
`fixtures/` `original/` (workflow, LICENSE, PROVENANCE.md), `scenarios/` (14 canonical instances as files), `docker-probes.json`, `baseline.json`, `FREEZE.json` · `build-fixtures.mjs`, `freeze.mjs`, `run-solution.mjs`, `item.test.mjs`, `item.json`.

Run: `node --test experiments/replicate/items/github-actions-shafthq-update-selenium-grid-versions/item.test.mjs` (about 70 s; the docker live check and the Foundry check skip with their reason when unavailable) ·
`node run-solution.mjs <solver.mjs | workflow.json> --variant T2 --difficulty 5 --seeds 0-13` (a `.json` is a Foundry workflow, run through the real CLI) · `node controls/run-controls.mjs --write` · `node freeze.mjs` (compare with `fixtures/FREEZE.json`) · `node build-fixtures.mjs` (compare the scenario files with the generator).

Freezing: `fixtures/FREEZE.json` pins every file under `fixtures/`, the generator, oracle, task text, runner and stubs, and the hashes of one canonical task per variant. It was taken at the end of the build, **after** the controls had been run against the harness repeatedly (the quoted-reference truth was
rewritten after the first execution, O6) and before any solver arm: it does not claim to precede the first control run.

## 10. Effort

Built 2026-10-08 in one agent session: about **52 minutes of wall time** (09:51 to 10:43 UTC), the full test file and the controls run about ten times each along the way. **102 files, about 6.7 K lines**:
2.0 K lines of code in 21 modules (+ 24 lines of shell shims), 0.65 K lines of tests (43 tests: 42 pass, 1 `todo` for O1; about 85 s, of which 25 s is the Foundry check and 24 s the broken-variant sweep), 0.19 K lines of this README,
and 3.8 K lines of generated or recorded material (68 scenario files, 1.7 K lines of YAML, 2.1 K lines of JSON: the 14 scenario descriptions, the docker probes, the controls report, the freeze). The largest parts: `scenarios.mjs` (kinds and truth, 270 lines),
`runner.mjs` (workflow executor, 228), `miniyaml.mjs` (168), `controls/reference.mjs` (132), `oracle.mjs` (130). Roughly a third of the time went into the runner and its shims, a third into scenarios, truth and controls, a third into tests, the Foundry check and this file (estimate, not logged).


## 11. Known limits (adversarial verification, 2026-10-08)

A second agent tried to break this harness after it was built. That agent also wrote this section; everything above it is the builder's, with edits marked "verifier". Development/diagnostic evidence only: no solver arm has run on the item.
Scratch probes are in `/var/tmp/foundry-work/replicate/verify-shaft/`, which is not committed. The probes worth keeping are in `controls/adversarial.mjs`, and the `ADVERSARIAL` test in `item.test.mjs` pins what they do.

**Verdict: usable with limits.** The core judgement is sound. The edited file is compared byte for byte, and the pull-request effects go through the same stub the executed original uses. Each wrong solution of the kinds the task names failed:
* partial work: only Chrome, or image lines only;
* the wrong reference line: the last one;
* a dropped pre-release rule;
* a skipped PR, a wrong branch, or a PR with no change;
* a swallowed failure;
* wrong ordering in an executed workflow: the validation step moved after the PR step fails with `PR_ON_FAILURE` on the bad-reference kinds;
* the original's defects, judged against the intent.

What the verifier re-ran:
* the full test suite;
* the controls, in a fresh `controls/report.json`: the original passes 140/140 in original mode and 90/140 in intent mode, the port has identical effects on 140/140, the 9 broken variants fail exactly where they are broken and the equivalent one passes everywhere, all 13 bad controls are rejected, and the Foundry node passes 14/14;
* a determinism check across processes, time zones and locales (same sha256 over 900 tasks with their truths and reference solves);
* a check of the licence and of the vendored file's hash against `/opt/corpus` (MIT; the LICENSE is kept; byte-identical, sha256 `dff6b15a…`).

**Fixed by the verifier.** Instances, task text and canonical task hashes are unchanged; `fixtures/FREEZE.json` was re-frozen with a note and a `previousFreeze` record, and `index.mjs` VERSION is now 0.1.1.
1. *Over-specification: the PR-text order.* `oracle.mjs` `mentionsChange` required the old tag before the new tag on one line, but R5 only asks that each change is listed "with its old and its new tag". Three correct texts failed on all 246 'updated' tasks of 420 (T2):
   * "Chrome now NEW (was OLD)";
   * a `| Image | New | Old |` table;
   * a heading per image with `old:`/`new:` lines.
   The check now takes either order, in a section of up to 4 lines that starts at the image's name and ends at the next image's name. "NEW -> OLD" (an arrow or "to" pointing backwards) still fails. Tests: `oracle (verifier …): the pull-request text …` and `ADVERSARIAL`.
2. *Over-specification: a failed plan's leftovers.* The contract tells the solver that "a plan with status failed has no effects: its files and pull request are discarded". The oracle nevertheless failed such a plan with `FAILED_WITH_EFFECTS`. That check judged the plan's content, not effects, and is removed. Leftovers are reported in `details.discardedEffects`.
3. *Over-specification: duplicate labels.* A label listed twice failed `PR_LABELS`. A pull request's labels are a set on GitHub (an A1-class modelling assumption), so the stub `mocks/pull-requests.mjs` now dedupes.
4. *Network sandbox hole in `mocks/bin/curl`.* The shim rewrote or blocked only arguments starting with lower-case `http://` or `https://`. A probe with a local listener showed what went to the real curl, unlogged:
   * `127.0.0.1:PORT/x`, with no scheme;
   * `HTTP://…`;
   * `file:///etc/hostname`, which was read.
   With a real host name, the first two could have reached the network wherever egress is open. The original and the builder's mutants never use these forms, so no earlier run was affected. The shim now:
   * blocks and logs every `://` argument except the recorded URL, and the options that re-route or reset a transfer (`-K`, `--next`, `-x`, `--connect-to`, `--resolve`, `--proto`, …);
   * appends `--proto =http --connect-to ::127.0.0.1:PORT`, so whatever is left can only reach the mock, which logs it, and the `FETCH` check rejects it.
   Test: `curl shim (verifier …)`. It names only `.invalid` hosts and `127.0.0.1`, and contacts nothing but the local mock.

**Limits that remain** (not fixed: each needs a change to the rules or the generator, so a scenarios VERSION bump that regenerates every instance, or a decision by the owner):
* **MESSAGE is a keyword check that follows R7's wording.** One fixed message for every failure passes all 560 T2/T3 tasks (`LIMIT-catch-all-misleading-message`), even where it is false, such as for a dead connection:
  "The reference tag is a nightly pre-release for node-chrome, node-edge, node-firefox and hub". A message that only says "reference" fails on the pre-release and missing-image kinds. The intent score for failure messages therefore measures "used the right words", not "said what is wrong". A stricter check needs a stricter R7 or a judged rubric.
* **PR texts can be stuffed.** One line with every label and every tag passes the text checks (`LIMIT-stuffed-pr-text`). Images the run did not change are not checked, so a bogus extra claim also passes.
* **The generator never separates "first real line" from "highest tag".** Commented reference lines are always older (2021) than the real line, and the duplicate reference line always comes second and is older. A solver can break R1 by reading commented lines and still pass 560/560 by taking the highest tag (`LIMIT-reads-commented-lines-takes-max`). Only "first line, comments included" (the original's own defect) and "last line" are caught.
* **Rules that are never exercised in intent mode:**
  * R7's "the edited file would not load". A solution with no validation at all passes everything, because no valid reference tag breaks the file.
  * Downgrades. A refuse-to-downgrade policy and a blind rewrite both pass.
  * An HTTP status that disagrees with the body. Every non-2xx answer comes with an unusable body, so ignoring the status passes.
  * R1's trailing comment on an image line.
* **Harness integrity depends on the arm's sandbox.** A solver with read access to this directory can rebuild the hidden truth. A lookup solver that imports `scenarios.mjs` and matches the inputs passes 420/420 with no job logic. Two things make this worse:
  * `fixtures/scenarios/` holds the expected files for split `dev`, difficulty 5, seeds 0-13;
  * those are exactly `run-solution.mjs`'s default seeds, and `run-solution.mjs` runs a `.mjs` solver in its own process.
  Scored runs must execute model-written code without read access to `experiments/replicate/` and should use split `test`.
* **T3 cost is not measured for in-process solvers.** `run-solution.mjs` passes `costUsd: 0` for every `.mjs` solver, so an arm must measure model spend itself.
* **`runner.mjs` is a sandbox for the reviewed original and its in-memory mutants, not for untrusted workflows.** Only `curl` and `docker` are shimmed. `/usr/bin/wget`, `python3` and `nc` are on the step's PATH, and bash `/dev/tcp` works, so network isolation for anything else rests on the host's egress policy. Do not run an arm's GitHub Actions translation through it without network namespacing.
* The builder's remaining limits:
  * O1, `loadFamily`: `runExperiment` cannot take these tasks yet;
  * A1, the PR stub is modelled on documentation recalled from memory;
  * A8, every compose fixture is synthetic;
  * the item has little judgement, so it measures replication fidelity, not judgement.

Tests after verification: 47 (46 pass, 0 fail, 1 `todo` for O1), 39 s on this machine.
