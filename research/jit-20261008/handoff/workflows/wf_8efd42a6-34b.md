# Workflow tierdown-e2e (wf_8efd42a6-34b)

status: completed; finished agents: 3

## Script

```js
export const meta = {
  name: 'tierdown-e2e',
  description: 'End-to-end tier-down screen: rewrite one flow.judge tier list in a compiled solve.mjs, rerun archived compiled-run tasks sandboxed, compare final answers (and dev-oracle scores) against the original',
  phases: [{ title: 'Build' }, { title: 'Review' }, { title: 'Live' }],
}
const CTX = `Repository /home/user/workflow-foundry (Node 24 ESM, node:test, no new deps). Read experiments/jit/{tierdown,run-compiled,flow,stream,check-traces}.mjs, experiments/lib/{beds,models}.mjs, research/jit-20261008/SPEC.md. Live dev streams are running (9 processes) and two other workflows are editing experiments/jit/{flow,stream,run-compiled,prompts,compile,report}.mjs in a separate worktree — do NOT edit any existing experiments/jit file; create only new files: experiments/jit/tierdown-e2e.mjs and experiments/jit/test/tierdown-e2e.test.mjs. Do not touch git. Do not touch experiments/runs except reading; do not modify anything under /var/tmp/foundry-work except creating a new directory /var/tmp/foundry-work/jit/tierdown-e2e/.`
const SPEC = `Build experiments/jit/tierdown-e2e.mjs:
- Input: an arm work directory (e.g. /var/tmp/foundry-work/jit/jit-dev-records-1/jit-claude-sonnet-5-5--claude-haiku-5-5), a compiled version (its solve.mjs under compile/<v>/solve.mjs, or the version dir under experiments/runs/jit/<exp>/<arm>/versions/<v>/), a judge name, and a new tier list (e.g. claude-haiku-5-5,claude-sonnet-5-5).
- Rewrite: produce a variant solve.mjs where ONLY that judge's tiers array is replaced. Do it robustly: parse the source to find the flow.judge('<name>' or template/batch names like 'vendex-' + i) call(s) and their 'tiers:' property (an array literal or an identifier bound to an array literal); refuse with a clear error if the tiers expression cannot be located unambiguously (never regex-guess silently). Record the diff.
- Tasks: the archived compiled-run task directories of that arm (i0xx-compiled-*/task.json) — dev split only; refuse test split seeds. Optionally --limit N.
- Run original (or reuse its recorded output from the archived dir if present: answer/stdout) and variant via runCompiled (sandboxed, gateway, journal in /var/tmp/foundry-work/jit/tierdown-e2e/<label>/journal.sqlite), capped by --cap-usd.
- Compare: final-answer agreement (exact canonical JSON, and partial leaf agreement), statuses (ok/deopt/crash), per-task cost of the judge and total, and for dev tasks the bed oracle score of both (via experiments/lib/beds.mjs score with the regenerated task from seed/split/difficulty in task metadata, or from the arm's results.jsonl taskKey). Output a JSON report + a markdown table.
- CLI: node experiments/jit/tierdown-e2e.mjs --arm-dir D --version v1-haiku55 --judge rules --tiers claude-haiku-5-5,claude-sonnet-5-5 [--limit 8] [--cap-usd 1] [--label name]
Tests at $0 with a stub gateway (see how experiments/jit/test/run-compiled.test.mjs or flow.test.mjs stub it) and a tiny fixture solve.mjs with two judges, covering rewrite correctness (only the target judge changes), refusal on ambiguity, comparison math, and test-split refusal.`

phase('Build')
const impl = await agent(`${CTX}\n\n${SPEC}\n\nImplement, run only the new test file, return: files, API, test counts, design decisions.`, { label: 'build', phase: 'Build', effort: 'high' })
phase('Review')
const rev = await agent(`${CTX}\n\n${SPEC}\n\nBUILDER REPORT:\n${impl}\n\nAdversarially review experiments/jit/tierdown-e2e.mjs and its test: try to make the rewrite change the wrong judge or silently do nothing, make the comparison wrong (key order, arrays), leak test-split data, or overspend the cap. Fix every confirmed P0/P1 directly in those two files (only those), rerun the test, and return findings (fixed/rejected) and final test counts.`, { label: 'review', phase: 'Review', effort: 'high' })
phase('Live')
const live = await agent(`${CTX}\n\nBUILD + REVIEW REPORTS:\n${impl}\n\n${rev}\n\nRun ONE live screen (cap $1.50): arm dir /var/tmp/foundry-work/jit/jit-dev-records-1/jit-claude-sonnet-5-5--claude-haiku-5-5, its first compiled version (find the version name under its compile/ dir or experiments/runs/jit/jit-dev-records-1/jit-claude-sonnet-5-5--claude-haiku-5-5/versions/), judge 'rules' (currently Opus-only, ~90% of the compiled cost), new tiers claude-haiku-5-5 then claude-sonnet-5-5 as two separate variants, --limit 8 archived dev tasks. Report the markdown table and the conclusion: does Haiku or Sonnet reproduce the Opus-tier solver's final answers and oracle scores, and at what cost per task? Development evidence only, K=1. Return the table and a 5-line conclusion.`, { label: 'live-screen', phase: 'Live', effort: 'medium' })
return { impl, rev, live }
```

## Agent result 1

I built the tier-down replay tool and its tests: all 13 tests pass at $0. That includes one test that runs the real `runCompiled` in the sandbox with a scripted model port; it ran here rather than skipping. I made no live model calls.

I also did one `--dry` run against the real arm (`jit-dev-records-1/jit-claude-sonnet-5-5--claude-haiku-5-5`, judge `rules`, `--limit 8`). It found the `rules` call at line 294 and rewrote only `tiers: ['claude-opus-5-5']`. All 8 regenerated dev tasks matched the archived `task.json`. Read back from the archive, every run's cost equals the stream's recorded `compiled` cost, and every `rules` call ran on Opus. That dry run wrote `/var/tmp/foundry-work/jit/tierdown-e2e/dry-check-rules/`.

**Files** (both new; nothing else touched, no git commands run):
- `/home/user/workflow-foundry/experiments/jit/tierdown-e2e.mjs`
- `/home/user/workflow-foundry/experiments/jit/test/tierdown-e2e.test.mjs`

**CLI**
```
node experiments/jit/tierdown-e2e.mjs --arm-dir D --version v1-haiku55 --judge rules --tiers claude-haiku-5-5,claude-sonnet-5-5
  [--limit 8] [--cap-usd 1] [--label name] [--rerun-original] [--all-tasks] [--dry] [--force]
  [--run-dir experiments/runs/jit/<exp>/<arm>] [--work-root /var/tmp/foundry-work/jit/tierdown-e2e] [--minutes N] [--per-task-usd N]
```
- It writes `/var/tmp/foundry-work/jit/tierdown-e2e/<label>/` containing `report.json`, `report.md`, `rewrite.json`, `rewrite.diff`, `original.solve.mjs`, `variant/solve.mjs`, `journal.sqlite` and `runs/i<idx>-{original,variant}/`.
- It prints the markdown table, then one JSON summary line.
- Exit code 2 means a refusal (an error with a code); 1 means a crash.

**API** (exports)
- `tierdownE2E(opts, deps?)` runs the whole replay. You can inject `runCompiled`, `createModelPort`, `makeTasks`, `score`, `loadFamily`, `validateOutput` and `policyIds`; any you leave out are loaded live.
- `rewriteJudgeTiers(source, judge, tiers)` returns `{source, pattern, scope, sites, oldTiers, newTiers, diff, unified, originalSha256, variantSha256, otherJudges}`.
- `findJudges(source)` returns `{sites, unrecognized}`.
- Comparison and reporting: `compareTask`, `summarize`, `markdown`, `judgeStats(trace, pattern, allowed)`.
- Reading the archive: `readArchived(dir, {validate})`, `compiledDirs`, `resolveVersion`.
- Dev-only checks: `assertDev`, `parseTaskKey`.
- Also exported: `tokenize`, `nameMatches`, `TierdownError` (with `.code`), `RUN_ROOT`, `WORK_ROOT`.

**Tests:** 13 tests, 13 pass, 0 skipped.
- **Rewrite correctness:** only the target judge's tiers literal changes; the shared `const TIERS` and the other judge stay byte-identical; templated names work by concrete instance; string-concatenation and shorthand forms work.
- **Refusals:** 22 cases, covering each refusal described under the design decisions below.
- **Comparison math and the dev-only rule:** `compareTask`, `summarize` and `assertDev` each have their own test.
- **Replay loop with fakes:** reuse of archived originals, `--rerun-original`, `--limit`, `--all-tasks`, the spending cap, `--dry`, the overwrite refusal, and that a test-split run never generates or runs a task.

**Design decisions**
- **Parsing:** no parser package is available and none was added, so the tool has its own small tokenizer (strings, nested templates, comments, regex literals, bracket matching). It finds every `<x>.judge(name, {…})` call. Any other use of `judge`, such as `.bind` or a call inside a template expression, is refused.
- **Judge names become patterns:** `` `vendex-${i}` `` and `'vendex-' + i` both become `vendex-*`. `--judge vendex-0` therefore changes every instance at that call site, and the report says so in its `scope` field. A computed name such as `judge(name, …)` could be any judge, so its presence refuses every target in that solver.
- **What tiers can be:**
  - An array literal, or a `const` bound exactly once to an array literal.
  - Refused: another declaration, reassignment, a mutating method, a parameter, a destructuring or an import of the same name.
  - The new list is always written at the call site, so a shared const stays as it is for the other judges.
  - Also refused: options that are not an object literal, a computed key, duplicate `tiers`, or a spread after `tiers` that could override it. A spread of a const object literal with no `tiers`, no spread and no computed key is allowed.
- **Checks on the variant:** it is re-parsed and must have the same judge sites with names unchanged; the target sites must carry exactly the new list and every other site's tiers text must be unchanged. It must also pass `node --check`.
- **Version and tasks:**
  - The version comes from `experiments/runs/jit/<exp>/<arm>/versions/<v>/solve.mjs` first, then `compile/<v>/`, or from an explicit path. The report notes it if the two copies' hashes differ.
  - Tasks are the `i<idx>-compiled-*` directories whose `solve.mjs` hash matches the version; `--all-tasks` includes the rest, and the original is then rerun for those.
  - Each task comes from the arm's `results.jsonl` `taskKey`, is regenerated with `makeTasks`, and is skipped if it differs from the archived `task.json` or the recorded hash.
- **Dev only:** `arm.json` must say `split: dev`. The run stops before generating anything if any row is on a test split, or has a seed of 7001 or more and no split.
- **Reusing the original:** the archived run is reused when the hashes match and it can be read back. Status comes from `deopt.json`, a crash event, or the last JSON line of `.solve.stdout` checked against the bed's output schema. Cost comes from `tools/calls.jsonl`.
- **Caveat on reuse:** reusing the original compares a fresh variant run against an older run, so model run-to-run noise sits inside the difference. Use `--rerun-original` when that matters.
- **Running and spending:**
  - Runs are sequential, through the real `runCompiled` sandbox and gateway, with the journal under the label directory.
  - Each run's budget is the lower of the arm's per-task budget and what is left of `--cap-usd`. A wrapper on the model port also refuses calls once the cap is reached, and the remaining tasks are marked `cap reached`.
  - The gateway's allowed models are the arm's models plus the new tiers, and every new tier must be in the owner policy.
- **Comparison:**
  - Exact canonical JSON agreement, plus an order-insensitive version.
  - Partial agreement uses `check-traces.mjs` `compare` (leaf-level, arrays matched by best overlap), with the original as the reference.
  - Status transitions, and the judge's cost per task from trace events whose names match the pattern.
  - The summary has two agreement rates: one over tasks where both runs were ok, one over all compared tasks.
  - Oracle `score` is computed for ok outputs only; any other status counts as a fail with score 0. The summary reports pass-to-fail and fail-to-pass flips and the mean score change.
  - An `offList` count flags any tier the variant tried that is outside the new list, which would mean the rewrite did not take effect.
- **One limitation found:** these archived solvers cannot be rewritten as they stand:
  - kinetics Haiku v1/v2: `const tiers = cond ? [...] : [...]`
  - kinetics Sonnet `compile/v1-opus55`: `ask(name, tiers)` with a computed name
  
  Every records-arm version parses cleanly, and so do the other archived kinetics versions.

## Agent result 2

Review of `tierdown-e2e.mjs` is done: I confirmed six P1 defects and fixed all of them in the two allowed files. The test file now has 16 tests, all passing, none skipped (13 original, 3 new). That includes the real-sandbox `runCompiled` test, which ran here. No live model calls, no git commands, and no other files touched.

**Fixed (P1)**
1. **Rewrite could silently miss the target judge.** A judge call reached through a string (`flow['judge'](n, …)`, ``flow[`judge`](…)``, or `const k='judge'; flow[k](…)`) was invisible to the scan. Its computed name could be the target, yet the rewrite went ahead and those calls kept the old tiers. Any such string use is now refused with `UNRECOGNIZED_JUDGE_USE`. A judge whose name argument is literally `'judge'` is still allowed.
2. **Judge cost and `offList` were attributed to the wrong judge.** With a templated target (`'v-' + i` becomes `v-*`), events from a literal sibling judge such as `v-total` were counted as the target's. That inflated judge $ and raised a false warning that the rewrite did not take effect. The rewrite now returns `otherPatterns`, and `judgeStats` and `compareTask` leave out events that another call site's name also matches, counting them as `ambiguous`.
3. **A timed-out archived run could be reused as `ok`.** `readArchived` returned `ok` for a run that printed a schema-valid JSON line but never called `done()` (a timeout or kill). It now requires a `done` event. Reuse also requires the archived status to equal the stream's recorded `compiledStatus` for that idx; otherwise the original is rerun fresh and the reason is recorded in `archivedRejected`.
4. **A run cut short by the cap counted as a regression.** When a run's budget was the cap remainder, a budget deopt showed up as an ok→deopt transition. Such runs are now excluded from the comparison (`cap reached during the run: excluded`). The model-port wrapper only checked finished runs, so it never fired during a run; it now also counts the calls of the run in progress.
5. **A non-numeric option could disable the cap.** `--per-task-usd abc` produced a NaN gateway cap, under which every check is false, so no call was ever refused. `--minutes` and `--limit` had the same NaN hole for the timeout and limit. All three are now checked as positive finite numbers.
6. **Prompt-version-2 arms would run on the wrong SDK.** `runCompiled` was called without `flowPath`, so a v2 solver using `flow.flag` would run on flow v1 and crash. It now passes `flowPath` exactly as the stream does (`flowFileOf` from `prompts.mjs`, which is imported, not edited).

**Also fixed (P2 hardening):**
- A `--label` of `..` or one containing slashes is refused, so output cannot land outside the work root.
- A `--run-dir` whose `arm.json` names a different arm than `--arm-dir` is refused (`ARM_MISMATCH`).
- `sealed-*` families are refused as `TEST_SPLIT`.
- `report.md` now warns when the target judge made no calls in any variant run, and notes ambiguous events.

**Rejected or left as is**
- **Key order:** exact agreement uses canonical JSON with sorted keys, so key order cannot cause a mismatch. Arrays are order-sensitive in `exact` and order-insensitive in `exactUnordered` and `partial` (which pairs array items by best overlap). That matches the documentation.
- **Test-split leakage:** none found. A test arm or test-split row is refused before any task is generated, archive is read or model port is opened. A dev task with a seed of 7001 or more builds a dev world, because the bed generators mix the split into the world; it is not the test task.
- **Regex after `)`:** the tokenizer misreads `if (x) /'/` as division. This ends in a `PARSE` refusal, never a silent wrong rewrite.
- **Shared tiers const changed through `Object.assign` or a function call:** not detected. This only affects the reported `oldTiers`; the variant writes its literal at the call site, and the trace's `tiersTried` shows what actually ran.
- **Overshoot within one run:** the gateway can admit one call slightly past the cap. Its reservation bounds this, and it is inherent to the existing ledger.

**Checked on real archived data (read-only):** I ran a new `--dry` (label `review-dry-rules`) on `jit-dev-records-1/jit-claude-sonnet-5-5--claude-haiku-5-5`. It found the same rewrite at line 294 (only `tiers: ['claude-opus-5-5']` changes), and 8 tasks were selected. Across every archived arm and version, archived statuses matched the recorded `compiledStatus` wherever a results row exists. Directories with no row yet (live streams are still running) are skipped, not reused.

Files are in /home/user/workflow-foundry/experiments/jit:
- tierdown-e2e.mjs
- test/tierdown-e2e.test.mjs

The new dry-run directory is /var/tmp/foundry-work/jit/tierdown-e2e/review-dry-rules/

## Agent result 3

**Live tier-down screen: judge `rules` (records dev arm `jit-claude-sonnet-5-5--claude-haiku-5-5`, version `v1-haiku55`, tasks i003–i010).** Development evidence only: dev split, K=1, and the Opus originals are reused from the archive rather than rerun. Total live spend was $0.2422 against the $1.50 cap ($0.0491 for Haiku, $0.1931 for Sonnet). Each variant had its own $0.75 cap.

**Variant A: `rules` changed from Opus to Haiku**
| idx | task | original | variant | exact | partial | judge $ orig | judge $ var | total $ orig | total $ var | oracle orig | oracle var |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 | records:dev:d3:s204 | ok* | **deopt (invariant one-dob-per-person)** [tool printed "cap reached during the run: excluded", see note] | | | $0.0342 | | $0.0380 | $0.0059 | PASS 1.000 | fail 0 |
| 4 | records:dev:d3:s205 | ok* | ok | yes | 1.000 | $0.0341 | $0.0014 | $0.0389 | $0.0061 | fail 0.924 | fail 0.924 |
| 5 | records:dev:d3:s206 | ok* | ok | yes | 1.000 | $0.0346 | $0.0014 | $0.0395 | $0.0066 | PASS 1.000 | PASS 1.000 |
| 6 | records:dev:d3:s207 | ok* | ok | yes | 1.000 | $0.0337 | $0.0014 | $0.0379 | $0.0054 | PASS 1.000 | PASS 1.000 |
| 7 | records:dev:d3:s208 | ok* | ok | no | 0.848 | $0.0341 | $0.0014 | $0.0377 | $0.0054 | PASS 1.000 | fail 0.776 |
| 8 | records:dev:d3:s209 | ok* | ok | yes | 1.000 | $0.0339 | $0.0014 | $0.0391 | $0.0063 | PASS 1.000 | PASS 1.000 |
| 9 | records:dev:d3:s210 | ok* | ok | no | 0.997 | $0.0335 | $0.0016 | $0.0385 | $0.0067 | PASS 0.998 | PASS 1.000 |
| 10 | records:dev:d3:s211 | ok* | ok | yes | 1.000 | $0.0339 | $0.0014 | $0.0393 | $0.0067 | PASS 1.000 | PASS 1.000 |

Corrected over all 8 tasks:
- Statuses: original 8 ok; variant 7 ok and 1 deopt.
- Oracle pass: 7/8 original, 5/8 variant (2 pass-to-fail, 0 fail-to-pass).
- Exact agreement: 5/8.
- Mean cost per task: $0.0386 original, $0.0061 variant.

**Variant B: `rules` changed from Opus to Sonnet**
| idx | task | original | variant | exact | partial | judge $ orig | judge $ var | total $ orig | total $ var | oracle orig | oracle var |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 | records:dev:d3:s204 | ok* | ok | yes | 1.000 | $0.0342 | $0.0219 | $0.0380 | $0.0243 | PASS 1.000 | PASS 1.000 |
| 4 | records:dev:d3:s205 | ok* | ok | yes | 1.000 | $0.0341 | $0.0153 | $0.0389 | $0.0187 | fail 0.924 | fail 0.924 |
| 5 | records:dev:d3:s206 | ok* | ok | no | 0.974 | $0.0346 | $0.0148 | $0.0395 | $0.0553 | PASS 1.000 | fail 0.948 |
| 6 | records:dev:d3:s207 | ok* | ok | no | 0.908 | $0.0337 | $0.0151 | $0.0379 | $0.0179 | PASS 1.000 | fail 0.902 |
| 7 | records:dev:d3:s208 | ok* | ok | no | 0.848 | $0.0341 | $0.0180 | $0.0377 | $0.0205 | PASS 1.000 | fail 0.776 |
| 8 | records:dev:d3:s209 | ok* | ok | no | 0.974 | $0.0339 | $0.0151 | $0.0391 | $0.0187 | PASS 1.000 | fail 0.964 |
| 9 | records:dev:d3:s210 | ok* | ok | no | 0.997 | $0.0335 | $0.0152 | $0.0385 | $0.0185 | PASS 0.998 | PASS 1.000 |
| 10 | records:dev:d3:s211 | ok* | ok | yes | 1.000 | $0.0339 | $0.0154 | $0.0393 | $0.0192 | PASS 1.000 | PASS 1.000 |

Summary over 8 tasks:
- Statuses: 8 ok on both sides.
- Oracle pass: 7/8 original, 3/8 variant (4 pass-to-fail, 0 fail-to-pass).
- Exact agreement: 3/8; mean partial agreement 0.963.
- Mean cost per task: $0.0386 original, $0.0241 variant (judge $0.0340 down to $0.0163).

`*` marks an archived Opus original that was reused. Every judge call ran only on the requested tier: Opus 8/8 in the originals, Haiku 7/7 and Sonnet 8/8 in the variants, so the rewrite took effect.

**Conclusion**
1. Neither cheaper tier reproduced the Opus-tier solver. Opus passed the oracle on 7/8 tasks; Haiku passed 5/8 and Sonnet 3/8, and no task went from fail to pass.
2. Haiku matched Opus's final answer exactly on 5/8 tasks. Its failures were one wrong answer (i007, score 0.776) and one invariant deopt (i003). Run cost fell from $0.0386 to $0.0061 per task, about 6x cheaper.
3. Sonnet matched Opus's final answer exactly on only 3/8 tasks, with near-miss scores of 0.78–0.96 on four tasks. Run cost was $0.0241 per task, so it is both worse and dearer than Haiku here.
4. At K=1 against archived originals, run-to-run noise could plausibly account for some of the Haiku-vs-Sonnet ordering, but not for the same direction across 6 regressions. The result is that the `rules` judge is not safe to move off Opus as compiled. A tolerant comparison or a Kev check on `rules` outputs would be needed before any tier-down.
5. Next screen: rerun with `--rerun-original` at K≥3, plus a cascade variant `[haiku, opus]`, to separate tier effect from noise. All of this is dev evidence only, not a held-out claim.

**Defect in the tool:** `tierdown-e2e.mjs` mislabels a genuine Haiku failure on i003 as "cap reached during the run: excluded". In reality the variant failed the `one-dob-per-person` invariant check (deopt) after spending $0.0059 of $0.75. The cause is the cut-short check at line 686, `budget < fullBudget && rc.status !== 'ok'`. When the arm has no per-task budget, every run's budget is the cap remainder, so any non-ok variant is treated as cut short by the cap. The report then shows a wrong "stopped" note and drops a real regression from its summary. I corrected the Haiku numbers above by hand. The file was not edited.

Outputs are in `/var/tmp/foundry-work/jit/tierdown-e2e/`:
- `live-rules-haiku/` (report.json, report.md, rewrite.diff, runs/)
- `live-rules-sonnet/` (same files)
- `live-rules-haiku.log`
- `live-rules-sonnet.log`
