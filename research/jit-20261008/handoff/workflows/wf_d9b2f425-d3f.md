# Workflow ownerci-bed (wf_d9b2f425-d3f)

status: completed; finished agents: 2

## Script

```js
export const meta = {
  name: 'ownerci-bed',
  description: 'Build the ownerci owner-family bed (CI-failure repair on frozen workflow-foundry modules), then adversarially audit it',
  phases: [{ title: 'Build', detail: 'one agent' }, { title: 'Audit', detail: 'independent auditor, then fixer' }],
}
const COMMON = `Repository: /home/user/workflow-foundry (Node 24 on PATH; ESM; built-in node:test; do NOT add npm dependencies; do NOT commit, push or touch git state). Read beds/CONTRACT.md first and follow it exactly; use beds/lib/rng.mjs and beds/lib/canonical.mjs, and look at beds/codefix/ as an example of a code-repair bed with a sandboxed oracle. You own ONLY the directory beds/ownerci/ (create it). Do not edit any other file: other agents are concurrently editing other beds/ directories and research/corpus-20261006/. Do not call any LLM or model API. Run tests with: node --test beds/ownerci/ .`
const SPEC = args.spec
phase('Build')
const built = await agent(`${COMMON}\n\n${SPEC}\n\nIn README.md include: description, knobs per difficulty with measured input token estimates (estimateTokens of prompt+inputs) for d1..d5, the exact oracle pass rule, the diff guard, the frozen commit and why the bed needs judgment. At the end report: files, catalog size per module and operator, test counts, token sizes per difficulty, oracle time per task, anything incomplete.`, { label: 'build:ownerci', phase: 'Build' })
phase('Audit')
const audit = await agent(`${COMMON}\nThe bed beds/ownerci/ was just built by another agent; you now own it. You are an ADVERSARIAL AUDITOR, then fixer.\nBed spec for reference:\n${SPEC}\n\nAudit steps (do all; write beds/ownerci/AUDIT.md with a dated header, a findings table (id, severity, finding, evidence, fix, regression test) and before/after numbers):\n1. Determinism, contract conformance, freezing (no file outside beds/ownerci/ read at generate or oracle time; MANIFEST hashes match).\n2. Truth leakage: the original source or the mutation diff must not be recoverable from prompt/inputs (e.g. comments, stack traces quoting the original line, related_sources containing the original module).\n3. Oracle bypass: try to pass without fixing (edit/skip tests via the patched module, monkeypatch node:test or assert, process.exit(0) at import, top-level await tricks, globalThis pollution, reading the hidden test file, detecting the test runner). Confirm every attempt fails and the oracle never crashes.\n4. Oracle false negatives: semantically equivalent fixes (different formatting, renamed locals, an alternative correct fix) must pass.\n5. Triviality attack: write a <=40-line deterministic heuristic repairer (e.g. revert the comparison operator on the line named in the stack trace) and measure its pass rate at d3 over 30 test-split seeds; if > 20%, strengthen the generator until it drops below 20% while referenceSolve still passes 100%. Keep it as a test fixture.\n6. Controls: referenceSolve passes 30/30 seeds at d1, d3, d5; every bad control fails 30/30.\n7. Sizes and oracle time per task (must stay under the contract's limits).\nFix every problem (you may rewrite generator/oracle), add a regression test per fix, update README.md. Final answer: findings (one line each with severity), fixes, heuristic pass rates before/after, final test counts, token sizes per difficulty, anything left open.`, { label: 'audit:ownerci', phase: 'Audit' })
return { built, audit }
```

## Agent result 1

I built the `ownerci` bed in `beds/ownerci/` and nothing outside it. `node --test beds/ownerci/` passes 16/16 in about 53 s. No model was run, so the difficulty levels are design targets, not measurements.

**Source modules.** Six modules and their focused test suites are frozen at commit `3fe9b8d604f97ee34adec023a3369bbe0c18efae`. They are copied with `git show`, so they are the committed files, not the working tree. The repository layout is kept inside each fixture, so the frozen tests' imports resolve to the frozen copies and later edits to `src/` can't change the bed. The one edit: the journal test file loses its fifth test, which needed the 399-line `src/store.mjs`; this is recorded in `MANIFEST.json`.

| module | lines | visible tests | hidden tests |
|---|---|---|---|
| verdict (`src/verdict.mjs`) | 40 | 8 | 10 |
| context (`src/context.mjs`) | 138 | 12 | 15 |
| schema-subset (`src/schema-subset.mjs`) | 100 | 12 (from `tests/context.test.mjs`) | 11 |
| journal (`src/journal.mjs`) | 89 | 4 | 10 |
| stats (`experiments/lib/stats.mjs`) | 124 | 5 | 8 |
| distill (`experiments/lib/distill.mjs`) | 93 | 3 | 8 |

I wrote the 62 hidden tests from the original behaviour; each suite runs in about 0.3 s.

**Mutant catalog.** 723 mutants were enumerated and 614 kept; 231 of those are caught only by the hidden tests.

| module | arg-swap | bool-swap | cmp-flip | default-arg | guard-delete | logic-swap | negation | off-by-one | kept |
|---|---|---|---|---|---|---|---|---|---|
| verdict | 10 | 2 | 9 | 0 | 0 | 2 | 3 | 6 | 32 |
| context | 31 | 6 | 38 | 0 | 1 | 23 | 11 | 23 | 133 |
| schema-subset | 32 | 1 | 33 | 0 | 0 | 22 | 14 | 49 | 151 |
| journal | 24 | 5 | 15 | 2 | 2 | 13 | 7 | 7 | 75 |
| stats | 19 | 0 | 12 | 6 | 0 | 4 | 10 | 91 | 142 |
| distill | 4 | 2 | 11 | 2 | 0 | 9 | 13 | 40 | 81 |

I added rules beyond the spec, all documented in the README:
- **Deleted guards:** one is kept only if its error message can be recovered from what the solver sees, because the hidden tests check exact messages. This removed 25 of the 30 enumerated. Only 3 deleted guards are left in the catalog: guard deletion is the weakest-covered operator.
- **Hidden-only mutants (d4–d5):** limited to changes that look wrong on careful reading. Changed limits or defaults, deleted guards, and swaps of two variables are never hidden-only.
- **Combinations:** each mutant that the visible tests catch must show up in the CI report with a failing test of its own, and can't turn more than 75% of the suite red.

The resulting pools are 261 single-mutant tasks at d1, 122 at d2, 240 pairs at d3, and 150 triples each at d4 and d5. Every combination and its near-miss variant was run at build time. `verdict` has no d4/d5 tasks because its visible tests catch every mutant.

**Input sizes** (prompt + inputs, 60 seeds, in tokens):

| d | mutants (hidden-only) | min / median / max |
|---|---|---|
| 1 | 1 (0) | 3101 / 4432 / 11594 |
| 2 | 1 (0) | 3031 / 5201 / 12075 |
| 3 | 2 (0) | 3423 / 11527 / 12657 |
| 4 | 3 (1) | 3533 / 11877 / 12484 |
| 5 | 3 (2) | 3430 / 6266 / 12967 |

Size depends mostly on which module is drawn: stats, distill, verdict and journal are about 3–6K, while context and schema-subset are about 11–12K. From d3 the two large modules are drawn twice as often. The low d5 median is sampling, not design.

**Oracle time:** median 260–398 ms per task, max 468 ms, run inside an `unshare` user and network namespace. A candidate that never finishes takes the full 60 s timeout and scores 0.

**Controls:** the reference passes with score 1 on 20 seeds per difficulty. Each bad control fails on 20 seeds: empty, truncated, unchanged mutated source, fix-only-one near miss, export removed, try/catch defaults (always fails hidden tests), and a test-detection hack. At d4–d5, fixing only the visibly failing mutants leaves the visible suite green but still fails the hidden suite.

**What's incomplete or limited:**
- **Contamination:** the original sources, hidden tests and catalog all live in this repository. Solvers must run in an isolated directory with no access to the checkout, or they can copy the answer.
- **Hidden-only mutants:** they are meant to be findable by careful reading, but that isn't proven. Some `>` vs `>=` flips may be ambiguous without the tests, so a frontier-model run should calibrate d4–d5 before they're used for claims.
- **Repeats:** 100 seeds give 65–83 distinct tasks per difficulty, and dev and test draw from the same pools. Distill has only 3 tasks at d2.
- **Isolation:** there is no mount namespace or read-only filesystem. The banned-string check could be beaten by deliberate obfuscation, and a test process could in principle forge Node's internal test-result messages.
- **Frozen messages:** failure messages in the CI reports were recorded with Node v24.21.0; another Node version could word them differently if the catalog is rebuilt.

Rebuild with `node beds/ownerci/build-catalog.mjs --concurrency=4` (about 7 minutes); `measure.mjs` reprints the tables above.

Files are in `/home/user/workflow-foundry/beds/ownerci/`:
- `index.mjs`
- `index.js`
- `README.md`
- `modules.mjs`
- `freeze.mjs`
- `build-catalog.mjs`
- `mutate.mjs`
- `runner.mjs`
- `reporter.mjs`
- `render.mjs`
- `measure.mjs`
- `ownerci.test.mjs`
- `ownerci.controls.test.mjs`
- `fixtures/MANIFEST.json`
- `fixtures/catalog.json` (2.8 MB)
- `fixtures/<module>/…` (frozen sources and tests, plus `hidden.test.mjs`)

## Agent result 2

The beds/ownerci working tree is clean (a concurrent snapshot committed my files; I never ran git). The only non-ownerci changes are other agents' concurrent work in `beds/incident/` and `bridge/`, which I did not touch. Audit complete.

---

ownerci adversarial audit + fixes complete. Bed v1.0.0 → **v1.1.0**, catalog v1 → **v2**. All 31 tests pass (`node --test beds/ownerci/`, ~3 min). Report: `/home/user/workflow-foundry/beds/ownerci/AUDIT.md`; README updated: `/home/user/workflow-foundry/beds/ownerci/README.md`.

**Findings (severity — one line each)**
- F1 **critical** — oracle bypass: a patched module could `import 'node:assert/strict'` and null its methods before the frozen tests used the same cached object; passed with score 1 at d1/d3/d5.
- F2 **high** — guard escapes: unicode-escaped identifiers (`\u0070rocess`) unseen by the regex guard, `import.meta` path leak, string-based code generation, never-settling top-level await.
- F3 **high** — oracle trusted the run shape: no check for duplicate/unexpected test reports or a non-zero `node --test` exit, so a forged or name-colliding report could read all-pass.
- F5 **high** — d3 triviality: a 40-line test-driven greedy search passed **7/30** d3 seeds (visible suite green in 12/30).
- F10 **med** — cross-task reconstruction: line-majority over 3-4 same-module tasks recovers the original exactly.
- F6 **med** — no false-negative coverage, and the banned-word guard ran on raw text (a comment/string saying `process` would false-trip).
- F7 **med** — 77 enumerated mutants killed by no test; several reachable boundaries unpinned.
- F4 info (truth isolation holds), F8 info (determinism/split, incl. cross-process), F9 info (freezing + MANIFEST↔commit).

**Fixes**
- F1: guard now allows only the module specifiers the original imports (new imports rejected before anything runs); `harden.mjs` `--import` preload freezes the `assert` objects in the parent and every test child.
- F2: guard reads code through the bed tokenizer (un-tokenizable source rejected), bans `import.meta` and free host identifiers in code; run adds `--disallow-code-generation-from-strings` and `--net --mount --pid --mount-proc` with tmpfs over `/home`,`/root`,`/opt/models` + read-only root (repo and fixtures invisible in-run, confirmed).
- F3: `classify`+`scoreRun` fail the run on any duplicate, overwrite-after-fail, unexpected top-level result (a crashed test file surfaces as one) or non-zero exit, even when every expected name passes.
- F5: d3 is now a **masked pair** — both mutants visible-killed, same visible failing set alone and together, different hidden sets; the builder enumerates and validates the masking. New `oracleAsync`/`scoreRun`/`evaluateSourceAsync` for parallel scoring.
- F6: banned-word check scoped to code vs string/comment tokens; 12-case equivalence suite + alternative-fix rewrites must all pass.
- F7: +9 hidden tests across 5 modules (3 golden-digest sweeps computed from the original, 6 targeted); survivors 77 → 48 (the 48 verified equivalent); catalog rebuilt, MANIFEST + `freeze.mjs` record it.
- F10: documented as a per-task-isolation requirement (not an oracle flaw).

**Heuristic pass rates (test seeds 1-30), before → after**
- Test-driven greedy single-edit search (`attacks/search.mjs`, 40 lines), **d3: 7/30 (23%) → 0/30**; visible-suite-green 12/30 → 0/30. `referenceSolve` stays 30/30 at d3.
- Static operator-revert (`attacks/heuristic.mjs`, 24 lines): d3 0/30 → 0/30. Across difficulties v1.1.0: d1 0, d2 6, d3 0, d4 0, d5 0 (d2 = single simple mutants; neither baseline reaches hidden-only mutants).

**Final test counts** — bed suite 31 tests (12 structure + 5 controls + 14 audit regressions), all green. Catalog: 723 enumerated → **644 kept** (261 hidden-only); d3 **208** masked pairs, d4 150, d5 150. Hidden tests per module: verdict 10, context 18, schema-subset 12, journal 11, stats 10, distill 10. Controls: `referenceSolve` 30/30 at d1/d3/d5 (130 reference tasks in all); all 8 bad controls fail 102/102 for the documented reason.

**Token sizes per difficulty** (`estimateTokens(prompt)+estimateTokens(inputs)`, min/median/max over 60 dev seeds): d1 3102/4662/11772, d2 3029/5176/12068, d3 3289/11470/12635, d4 3547/11837/13125, d5 3441/11744/12986. Oracle wall time median 0.5-0.7 s, max ~1.0 s (sandboxed) — within the contract's 2 s/200 MB limits; d3 median in the 6-15K band.

**Left open** (AUDIT.md O1-O4): the plain-child fallback (no namespace) relies only on the static guard + disabled codegen + frozen asserts — arms should run where unprivileged namespaces exist (they do here: `sandbox: unshare`); cross-task memory must be prevented by harness isolation; hidden-only inferability at d3-d5 is argued, not proven, and needs a frontier ceiling calibration before any capability claim; 48 equivalent mutants are unkillable by design (correctly discarded, not shipped). No model has been run on the bed, so all difficulty statements remain design targets.
