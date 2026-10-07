# ownerci adversarial audit, 2026-10-07

Auditor: separate agent (no model or API calls; pure code), scope `beds/ownerci/` only. Bed version
before **1.0.0**, after **1.1.0**; mutant catalog `version` 1 → 2 (masked d3 pairs, F5; hidden-suite
extensions, F7). The bed was built the same day by another agent and handed over for audit. This
is a full audit against the task's seven steps; every finding has a regression test in
`ownerci.audit.test.mjs` (the audit run below is reproducible with `node --test beds/ownerci/`).

## Findings

| id | sev | finding | evidence | fix | regression test |
|---|---|---|---|---|---|
| F1 | **critical** | **Oracle bypass by assert monkeypatch.** The static guard banned `node:test`, `process`, `fs`, `globalThis` etc. but not new imports. A patched module could `import __a from 'node:assert/strict'` and overwrite its methods with no-ops before the frozen tests imported the same (cached) object; every visible and hidden assertion then passed with the mutants still in place. Confirmed passing at d1/d3/d5 (`score 1`). | `attacks/bypass.mjs` `assert-neuter` on v1.0.0 `oracle` | Two layers. (a) The guard now allows only the module specifiers the original imports; a new `node:assert`/`node:test`/`node:fs` import is rejected before anything runs. (b) `harden.mjs`, loaded with `--import` into the `node --test` parent and every test child before any test file, `Object.freeze`s the `node:assert` and `node:assert/strict` objects, so even a source that reached them could not reassign a method. | F1: the `assert-monkeypatch` control fails with `diff guard violated` (import allowlist), and with the guard skipped the frozen-assert run scores 0 |
| F2 | **high** | **Guard escapes and runtime tricks.** Beyond F1: an identifier written with a unicode escape (`process`) was not seen by the regex guard (which read raw text); `import.meta.url` leaked the fixture path; code generation (`[].map.constructor('…')()`) was reachable; a top-level `await` that never settles hung for the full 60 s; intrinsic pollution (`Object.is = …`). | `attacks/bypass.mjs` (10 probes) | The guard now reads code through the bed's tokenizer (a source it cannot tokenize, including unicode-escaped identifiers, is rejected), bans `import.meta` and the free identifiers `process/globalThis/global/eval/Function/require/module/exports/__dirname/__filename` in code, and the banned-capability check runs on code tokens. The run adds `--disallow-code-generation-from-strings` and the `--net --mount --pid --mount-proc` namespace with tmpfs over `/home`,`/root`,`/opt/models` and a read-only root. Unsettled await and hangs still hit the 60 s wall and fail closed. | F2: all 10 probes fail at their stage (guard probes never reach the runner; run probes fail without a guard violation) and the oracle never throws; `code-generation` fails to load. A trusted fs probe confirms the repo and bed dir are invisible inside the run |
| F3 | **high** | **Oracle trusted the run's shape.** Results were keyed by test name with no check that each expected test reported exactly once, that nothing else reported, or that `node --test` exited 0. A candidate that forged node:test's child→parent protocol, or exited the process after the reporter flushed a doctored result, or made a test name collide, could have reported all-pass. | code review of `classify`/`evaluateSource` | `classify` records duplicates and never lets a later pass overwrite a failing report; `scoreRun` fails the run on any duplicate, any unexpected top-level result (a crashed test file surfaces as one) or a non-zero exit, even when every expected name says pass. The run exit status is captured and surfaced. | F3: synthetic runs with a duplicate, an overwrite-after-fail, a crashed file, an unexpected name or exit 1 all fail; a clean all-pass run still passes; and the oracle does not throw on 10 degenerate sources |
| F4 | info | Truth isolation holds. No original module, mutated-line original, hidden-test body or name, or runner artifact (`/tmp`, `{ROOT}`, `hidden.test`) appears in `prompt+inputs+files`; the broken module is never among `related_sources`. | 2000-task scan (`leak.mjs`); 1000-task regression | none | F4 (1000 tasks over all difficulties and both splits) |
| F5 | **high** | **d3 triviality.** v1.0.0 d3 pairs only needed different failing-test sets, so one mutant's symptom was usually a distinct red test. A 40-line test-driven search that greedily keeps the single-token edit turning the most visible tests green passed **7/30** d3 test seeds (and left the visible suite green on 12/30, a partial "CI-green" win). | `attacks/search.mjs` on v1.0.0 | d3 is now a **masked pair**: both mutants are visible-killed, fail the same visible tests alone and together, and have different hidden failing sets, so no single edit turns any red test green. The builder enumerates masked pairs (both silent-eligible, disjoint, same visible set) and validates that the masking survives in the combination. Catalog `version` 2. | F5: every d3 combo is `masked`, each member's visible set equals the task's, hidden sets differ; the static heuristic passes **0/30** at d3 and `referenceSolve` still 30/30 |
| F6 | med | **Oracle false negatives risk.** No test checked that a correct but differently written fix passes; the guard's banned-word check originally ran on raw text, so a string literal or comment mentioning `process`/`eval` would have been a false violation. | code review; `attacks/equivalents.mjs` | Banned-word check scoped to code vs string tokens (comments never count); a 12-case equivalence suite plus hand-written alternative correct fixes must all pass. | F6: CRLF, 4-space/tab reindent, trailing space, a comment and a string literal containing `process`/`eval`/`globalThis`, double-quoted imports, an `export { … }` list, renamed private helpers, and three alternative-fix rewrites all pass for every module |
| F7 | med | **Hidden suite left gaps.** 77 enumerated mutants passed every visible and hidden test. Inspection: most are equivalent, but some reachable boundaries were unpinned — the overflow/truncation byte arithmetic in `context`, the capacity bit counts in `schema-subset`, `pairedBootstrap` quantile indexing in `stats`, `searchNode` default rounds/error-rate in `distill`, a required `modelId` in `journal`. | `survivors.mjs` (enumerate, run vs visible+hidden) | Added 9 hidden tests across 5 modules (3 golden-digest sweeps computed from the ORIGINAL, 6 targeted cases). Survivors dropped 77 → 48; the 48 remaining are verified equivalent (commutative `Math.min`/`Math.max` args, clamps that cannot bind, an unreachable `spec.value` guard the caller always satisfies, a private `p='$'` default always passed) or need inputs no caller produces. Catalog rebuilt; MANIFEST and `freeze.mjs` record the extension. | F7: eight named previously-surviving, non-equivalent mutants are now in the catalog with a non-empty hidden failing set; hidden-test counts pinned |
| F8 | info | Determinism and split salting hold, including across a fresh process with a different TZ/locale/cwd. `generate` byte-identical on repeat; test split changes the prompt. | existing determinism test; `F8` cross-process | none | F8 (cross-process sha256 of 4 tasks) |
| F9 | info | Freezing holds. `generate` runs under the Node permission model with read access only to `beds/ownerci/` and `beds/lib/`; MANIFEST sha256 match the fixtures and, when git is present, the frozen commit's blobs. | `F9` tests | none | F9 (two tests) |
| F10 | med | **Cross-task reconstruction.** Tasks of one module differ only in 1-3 mutated lines, so a line-by-line majority vote over 3-4 tasks of the same module recovers the original exactly. Not an oracle flaw, but an arm with memory/retrieval across tasks could copy the answer. | `recon.mjs`: majority vote recovers the original after 3 tasks (stats, verdict, distill, context) or 4 (schema-subset, journal) | documented in README "Known limitations"; arms must be isolated per task | none (documented) |

## Numbers

**Triviality (AUDIT.md F5), test-split seeds 1-30.**

| heuristic | v1.0.0 d3 | v1.1.0 d3 | note |
|---|---|---|---|
| static operator-revert (`attacks/heuristic.mjs`, 24 lines) | 0/30 | 0/30 | needs the exact token and all mutants; changes source in ~19/30 |
| test-driven greedy single-edit search (`attacks/search.mjs`, 40 lines) | **7/30 (23%)** | **0/30** | d3 masking removes every single-edit gradient; `referenceSolve` still 30/30 |

Static heuristic across difficulties (v1.1.0, test seeds 1-30): d1 0/30, d2 6/30, d3 0/30,
d4 0/30, d5 0/30. The d2 passes are single `off-by-one`/`cmp-flip` mutants it reverts from the
stack frame; it never reaches hidden-only mutants. The greedy search solves many d1-d2 single-mutant
tasks (expected — d1-d2 are "solvable by a careful single call"); it cannot solve d3 (masking) or
the hidden-only mutants of d4-d5. Both baselines are kept as fixtures.

**Controls (v1.1.0), 102 tasks (30 test seeds at d1/d3/d5, 6 at d2/d4).** `referenceSolve`
passes with score 1 on all 102 of its tasks (130 reference tasks in all including d2/d4 at 20
seeds). Every bad control (`empty`, `shuffled-or-corrupted`, `unchanged-mutated`,
`near-miss-fix-one`, `export-removed`, `try-catch-defaults`, `assert-monkeypatch`,
`test-detection-hack`) fails all 102 for its documented reason; the try/catch control always
fails at least one hidden test; the near-miss and unchanged controls keep mean score > 0.5. At
d4-d5, fixing only the visibly failing mutants leaves the visible suite green and still fails the
hidden suite (10 seeds).

**Oracle wall time per task** (`referenceSolve`, 8 seeds/difficulty, sandboxed, otherwise-idle
machine; `measure.mjs`): median 544-729 ms, max 1038 ms; well under the 60 s wall. Under the
4-way-parallel control test the per-call median stays ~1-2 s. Generate < 5 ms/task at d5.

**Sizes** (`measure.mjs 60 8`, `estimateTokens(prompt)+estimateTokens(inputs)`, min/median/max):
d1 3102/4662/11772, d2 3029/5176/12068, d3 3289/11470/12635, d4 3547/11837/13125,
d5 3441/11744/12986. Within the contract's run limits (`generate`/`oracle` < 2 s, < 200 MB; d3
median in the 6-15K target band). Module-dominated: stats ~3.1-3.6K … schema-subset ~11-12K.

**Catalog (v2).** 723 enumerated → 644 kept (261 hidden-only); d3 208 masked pairs, d4 150
triples, d5 150 triples. Rebuild 438 s at concurrency 4.

**Tests.** `node --test beds/ownerci/` runs **31 tests** (12 structure + 5 controls +
14 audit regressions), all passing, in about 3 minutes on 4 cores (dominated by the two
control/reference suites that run every task through the sandbox).

## Open items

- **O1 (med): the plain-child fallback is weak.** Where unprivileged namespaces are unavailable,
  only the static guard, `--disallow-code-generation-from-strings` and the frozen assert objects
  protect the host; a determined obfuscator that evades the token guard could read the filesystem
  (not the network — there is no net isolation without the namespace). On this machine the
  namespace is available and used (`sandbox: unshare`). Arms should run where it is.
- **O2 (med, F10): cross-task memory.** The bed cannot stop an arm that remembers earlier tasks
  from reconstructing a module by majority vote. Enforced only by per-task isolation at the
  harness level; noted in the README. A future version could vary identifiers/whitespace per task
  to raise the cost, at the price of per-task catalog rebuilds.
- **O3 (low): hidden-only inferability is argued, not proven.** The silent-eligible operator set
  and the masking are heuristics for "a careful reader can see it"; some `>`/`>=` flips remain
  genuinely ambiguous without the tests. A frontier ceiling run should calibrate d3-d5 before any
  capability claim rests on them.
- **O4 (low): 48 equivalent mutants remain unkillable** by design (commutative args, dead clamps,
  an unreachable guard). They are correctly discarded, not shipped as tasks; listed so a future
  hidden-suite pass does not chase them.
