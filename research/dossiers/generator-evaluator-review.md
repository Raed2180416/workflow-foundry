# Generator, evaluator and provider audit

Audit date: 2026-09-13. Auditor: worker-7. Project: `/home/raed/Projects/workflow-foundry`.

The two initial audit runs contain **82 deterministic controls: 51 passed and 31 failed**. The generator run had 23 tests, with eight failures; the evaluator/provider/process run had 59 tests, with 23 failures. These are two separate executions. Source hashes were unchanged during each execution. The failing assertions and original TAP are preserved; neither test file was weakened after its first run.

These results establish defects in the audited revisions and finite passing behavior in the named fixtures. They do not measure model quality, an actual OpenCode session, TUI performance, billing, commercial parity, or arbitrary deployment robustness. Prime owns implementation fixes. This worker changed only the two assigned test files, this dossier and its audit receipts.

## Evidence and revision binding

| Execution | Command | Result | Evidence prefix under `research/manifests/` |
| --- | --- | --- | --- |
| Initial generator audit | `node --test --test-concurrency=1 --test-reporter=tap tests/generator-audit.test.mjs` | 15 passed / 8 failed; 2014.021044 ms | `generator-evaluator-audit-initial` |
| Initial evaluator/provider/process audit | `node --test --test-concurrency=1 --test-reporter=tap tests/evaluator-audit.test.mjs` | 36 passed / 23 failed; 3268.299548 ms | `generator-evaluator-audit-expanded` |

Each prefix has `.tap`, `.stderr.txt`, `.before.sha256` and `.after.sha256` receipts. Both before/after comparisons are identical. The first run covers the nine listed source files and generator test; the expanded run adds `src/data.mjs` and the evaluator test. They ran on September 13, 2026 at approximately 11:44:45–11:44:47 UTC and 11:48:38–11:48:41 UTC respectively. Timestamps describe these diagnostic executions, not a product release.

The frozen tests are:

| File | SHA-256 |
| --- | --- |
| `tests/generator-audit.test.mjs` | `752b11530387dbfb9e0b669a0e38dd05b060d1fff48615d1b35aff9ea9ced5a8` |
| `tests/evaluator-audit.test.mjs` | `8d285cb10230b176ee300312fbc3c41fba030c2b0c0a9578cdf9bf73155a306a` |

The source spans below refer to the **initial audited contents**, identified by these hashes. Files can subsequently change under prime's ownership; their current line numbers are not evidence for the initial revision.

| Initial source | SHA-256 |
| --- | --- |
| `src/generator.mjs` | `1f15623f1b8d94559b433fcc837d890b08140d7ec92683ec8b7564d5898e3442` |
| `src/evaluation.mjs` | `50b3da1b48eee202f5eccbd93aa9bd3039a3343b16ba372f483457a8bcc89010` |
| `src/opencode-free.mjs` | `e92678042097a91e4c0cc06241cda8a926a214caa00861da159edda3d12903bf` |
| `src/process.mjs` | `8505e549b3769c36777f64709ff3374940753e13da7b2fea0481b753ad1d174a` |
| `src/foundry.mjs` | `8c4ec7c40497fac62641dd7fc78bf287bf1be552b7c8d11e66f291552e0d52ef` |
| `src/store.mjs` | `e3db035f64e214369cde397061b1925787dc69524af2e37dacacfc7dc0e731e8` |
| `src/runtime.mjs` | `182388848e96f6b3f6531e6d279b19360e3de5b4e7052659ebcc3339d46e6538` |
| `src/validate.mjs` | `9eabd5d7c0bf9082fb40ae565d883485332d0e048af9f12dd25df5c8865499ab` |
| `src/capabilities.mjs` | `1707d4506f50e86498fa471dc3c8714615e6c06a1240014f2515aab58cc3ac49` |
| `src/data.mjs` (expanded audit) | `50049ae8819aa022481faafb435f2887d94fa669ceef1b6375c8d4a664e7680c` |

## Findings requiring release gates

### Generation must settle and respect cancellation before publication

**G1 — schema repair aborts with an evaluator configured.** An initial schema-invalid candidate missing its tool is followed by a valid sum workflow. The first candidate skips evaluation; constructing its assessment then dereferences `evaluation.passed` while `evaluation` is null. The job fails with `Cannot read properties of null (reading 'passed')` and never reaches the second round. Initial source: `src/generator.mjs:57-69`. Generator test 2; initial TAP lines 8–31. Use a null-safe, validation-dependent assessment so malformed candidates supply repair feedback without fabricating evaluation evidence.

**G2 — a cancelled or expired evaluation can still produce an applied workflow.** A controlled evaluator pauses, cancellation occurs, and the evaluator then returns a correctly bound passing receipt. The job becomes `applied`. A separate evaluator that returns after a 60 ms generation deadline also becomes `applied`. Initial source: `src/generator.mjs:47-77`, especially the unchecked evaluator await at line 58 and qualification write at line 61. Generator tests 9–10; initial TAP lines 68–115. Check cancellation and the absolute deadline after every awaited provider/evaluator operation and before qualification, proposal and application. A late receipt must not revive a cancelled job.

**G3 — a noncooperative provider defeats the host duration bound.** With a 30 ms configured deadline, a provider held on a test-controlled promise keeps `generate()` pending through a 220 ms observation window. The test releases it afterwards so no worker leaks. Initial source: `src/generator.mjs:30-48,94,101-115`. Generator test 11; initial TAP lines 116–138. The coordinator needs a bounded wait independent of callback cooperation. Settling the job cannot establish that an arbitrary provider stopped executing or spending: mark late results unusable, retain cancellation evidence, and distinguish host settlement from confirmed provider termination.

### Jobs must have truthful, recoverable lifecycle state

**G4 — configuration is advertised as default deployment qualification.** Merely attaching an evaluator causes `state().agent.deploymentQualifiedByDefault` to be true before any workflow is evaluated. Initial source: `src/foundry.mjs:54-62`. Generator test 19; initial TAP lines 181–206. Expose evaluator configuration separately and derive qualification from an actual passing receipt bound to the workflow and registry.

**G5 — receipt setup failure strands a running job.** A regular file at the generation-directory path causes `mkdirSync` to fail after the job is created but before the generator's cleanup boundary. The request remains `processing`, and the job remains `running`; no provider was called. Initial source: `src/generator.mjs:25-37`; state propagation is in `src/store.mjs:231-237`. Generator test 21; initial TAP lines 213–236. Include directory/context receipt setup in the failure boundary, while retaining the original filesystem error even when an error receipt cannot be written.

**G6 — jobs belonging to an exited process remain running.** A bounded local Node subprocess creates a job and exits normally. The parent reads the record and receives `running`. Initial source: `src/store.mjs:204-220`. Generator test 22; initial TAP lines 237–258. Surface abandoned jobs and terminalize the associated processing request without automatically invoking a model again. PID reuse and crash races need an explicit owner/lease policy; this fixture establishes only the already-exited-owner case.

**G7 — the processing queue is limited by a display window.** One pending request becomes older than 100 newer terminal requests. The processor cannot see it because `Store.requests()` returns only the newest 100 rows. Initial source: `src/store.mjs:166` and `src/generator.mjs:104-109`. Generator test 23; initial TAP lines 259–282. Query pending work directly in creation order; a UI pagination limit must not select executable work.

### An independent evaluator must reject ineffective or contradictory oracles

**E1 — syntactic output references can conceal unconditional truth.** The suite validator accepts three vacuous checks: equality of the same reference to itself, an `any` with an unconditional true branch, and a missing-node reference whose default makes the check true. All three reports pass. Initial source: `src/evaluation.mjs:34-45,71-75,90`; condition/reference semantics: `src/data.mjs:52-107`. Evaluator tests 8–10; expanded TAP lines 44–110. Require meaningful observed outcomes and reject these recognizable tautologies. No finite syntactic detector proves that every host oracle is independent or discriminative; explicit mutant tests remain a release requirement.

**E2 — contradictory artifact expectations silently ignore content.** `{name, absent:true, content:...}` is accepted and the absence branch never considers content. Initial source: `src/evaluation.mjs:40-43,76-87`. Evaluator test 18; expanded TAP lines 152–171. Require mutually exclusive absence and content/JSON expectations.

**E3 — artifact ancestor symlinks can qualify outside the designated artifact directory.** A synthetic host tool creates expected bytes in another directory inside its own isolated test workspace and points the run artifact directory at it. The final filename itself is not a symlink and qualifies. The corresponding final-file-symlink test correctly fails qualification. Initial source: `src/evaluation.mjs:76-82`. Evaluator tests 19–20; expanded TAP lines 172–199. Validate the complete containment chain and require a regular file. Static symlink checks do not by themselves establish resistance to concurrent path replacement; that remains a separate limitation.

**E4 — artifact inspection errors erase actual budget consumption.** A synthetic capability dispatch creates a directory where the expected artifact file belongs. `readFileSync` fails with `EISDIR`; the case catch skips step accounting. With two cases and `maxTotalSteps:1`, the capability dispatches twice. Initial source: `src/evaluation.mjs:64-95`. Evaluator test 21; expanded TAP lines 200–221. Account actual execution independently of successful oracle inspection, including errors during artifact or event reading. Check size and regular-file status before allocation; the original implementation checks size only after reading the entire file.

**E5 — the Store admits malformed qualification records.** Numeric evaluator identity, malformed workflow hash and missing registry hash are accepted by the public Store method. The generator's stricter checks protect its own caller path but do not repair this persistence contract. Initial source: `src/store.mjs:221-229`. Evaluator tests 23–25; expanded TAP lines 228–293. Validate the record schema, require a nonempty string evaluator identity and digest-shaped workflow/registry bindings, and preserve negative receipts as negative. A receipt supplied by a host caller is still trusted host evidence, not a cryptographic proof of execution.

### Provider protocol and price evidence must be internally consistent

**P1 — conflicting catalog records and empty pricing containers pass.** Duplicate model IDs select the first record, allowing a zero-priced entry to conceal a later nonzero-priced entry. An empty nested cost object also passes without any explicit zero leaf. Initial source: `src/opencode-free.mjs:9-29`. Evaluator tests 38–39; expanded TAP lines 417–459. Reject duplicate identities and ambiguous or empty pricing structures. These checks establish consistency of reported pricing, not an account-level guarantee of no billing.

**P2 — incomplete or malformed events can masquerade as a completed response.** A finish event missing its session identity is accepted; text appearing after the claimed final stop is concatenated into the response; array events are ignored; a null event raises an unstructured `TypeError`. Initial source: `src/opencode-free.mjs:32-44`. Evaluator tests 49–52; expanded TAP lines 515–594. Validate event objects and per-event session identity, enforce supported ordering/completion semantics, and emit structured provider failures for malformed input. This does not establish compatibility with every possible future upstream event type.

**P3 — session summaries can hide contradictory assistant evidence.** The adapter rejects wrong top-level session model/cost, but accepts assistant-level model drift, assistant-level nonzero cost, a different exported session ID, and different exported response text. Initial source: `src/opencode-free.mjs:98-109`. Evaluator tests 53–59; expanded TAP lines 595–676. Cross-check the requested session, selected model, reported cost and final response against the actual assistant messages, not only the summary. Also preserve prompt/output provenance. The synthetic transport never launched OpenCode, bubblewrap or a model; this is a parser/adapter control, not a provider experiment.

### Subprocess limits must be valid and text must survive transport

**S1 — invalid output limits are accepted.** `NaN`, `Infinity`, and negative `maxBytes` reach a launched child instead of failing argument validation. Initial source: `src/process.mjs:5-11,25-28`. Evaluator tests 33–35; expanded TAP lines 338–385. Require a finite bounded positive integer for the retained byte budget before launch.

**S2 — UTF-8 is corrupted when a code point spans chunks.** A deterministic stream containing `π 😀 final` is split across transport buffers and becomes `�� ��� final`. Initial source: `src/process.mjs:25-30`. Evaluator test 36; expanded TAP lines 386–410. Use a streaming decoder per stream or concatenate retained bytes before decoding. Raw byte accounting must remain shared across stdout and stderr.

## Passing behavior and measured scope

The initial generator audit successfully repairs malformed JSON, preserves raw rejected output, feeds real native counterexamples back into the bounded repair loop, enforces round exhaustion, treats provider failures as terminal, excludes duplicate dispatch across two generators, rejects stale application, and prevents pre-cancelled dispatch. It rejects missing/nonboolean/wrong-identity evaluator receipts and wrong or missing workflow/registry bindings. An applied candidate without an evaluator remains unqualified; qualification for a previous immutable version does not migrate to the next version.

The evaluator audit correctly detects a locally successful but independently wrong answer and counts it as false success. It preserves an exact version-seven candidate while staging it without advancing a reusable head. A suite is cloned before repair and a held-out suite cannot drive iterative feedback. Scalar/null/false/array/hyphenated-key inputs preserve their meaning. Missing or wrongly typed references do not become passing checks. The artifact oracle distinguishes exact bytes from semantic JSON equality, handles malformed JSON and missing files, and rejects a symlink at the final filename. Total-step exhaustion and pre-cancellation work in the ordinary non-error path.

Real local subprocess controls confirm literal argument handling, deliberately scoped environment, nonzero-exit and launch-error classification, bounded cancellation/deadline escalation even when the child ignores SIGTERM, and a shared stdout/stderr retained-output limit for a valid 512-byte budget. Real operating-system scheduling may vary; the tests allow bounded grace rather than asserting exact millisecond termination.

The nested workflow fixture contains two levels of maps, loops using explicit previous-state references, independent aggregates, mutually selected branches, an `all_resolved` join, and a typed human question. Expected sums are computed independently in ordinary JavaScript. It is submitted through the real generator with an explicitly labeled deterministic provider and executed by the native runner. The workflow pauses without fabricating an answer, rejects a string where a boolean is required, resumes successfully after a boolean answer, and does not redispatch completed work.

| Initial nested control | Cells | Executed steps | Frames/events | Observed elapsed |
| --- | --- | --- | --- | --- |
| Human pause/resume | 4 | 22 | 16 frames; 67 events | Not used as a timing claim |
| Automatic path, 2 groups | 8 | 36 | 106 events | 161 ms |
| Automatic path, 6 groups | 24 | 100 | 294 events | 679 ms |

The two automatic cases used 136 total steps and 871 ms including evaluator overhead. Expanded TAP lines 300 and 307 preserve the diagnostics. These are one-run local observations on small fixtures; they are not scaling laws, stress-test limits, or evidence about million-line repositories or real model-generated graph distributions.

## Validation and limitations

`npm run check` passed and is preserved in `research/manifests/generator-evaluator-audit-doctor.txt`. It is a package/environment doctor and explicitly does not certify task correctness. `node --check` passed for both owned test files. The package exposes no formatter, linter or typechecker scripts. No GitHub remote or Actions workflows were present in the inspected project, so no remote CI evidence was available.

The CoS Deterministic Quality Gate's `project_quality_map` independently confirmed the package manifests, test location, absence of Actions and local Semgrep configuration, and that CodeGraph was not indexed. Serena's manual and exact-path project activation both returned `PLUGIN_DISABLED`. No CodeGraph index was created for these test-only changes. Prime retains the integration security gate for shared implementation changes. This audit does not claim a complete dependency/security or browser verification pass.

The tests mock only the subprocess boundary for transport-specific adapter controls; the native runner and evaluator are real for execution/oracle tests. The simulated adapter uses an installed inert binary solely to satisfy constructor path checks and hashes it; mocked `spawn` prevents its execution. Real subprocess tests execute only short local Node programs. No credentials, paid providers, external services, actual TUI runs, sibling projects or frozen comparative model artifacts were accessed or changed.

Release should require an unchanged rerun of both audit files with zero failures and matching before/after source hashes, plus prime's relevant integration tests. Qualification must remain explicitly bounded to the assessed suite, registry, workflow and budget. Host-written oracles require independent mutant review; model-authored local acceptance cannot establish external task success. Crash consistency across multi-transaction proposal application, PID-reuse handling, hostile synchronous host callbacks, artifact replacement races, arbitrary external-tool cancellation, large graph scaling and changing real provider protocols are not universally covered here.

## Post-fix verification

No post-fix result is recorded in this version of the dossier. Initial failures above remain the source-bound baseline until a new unchanged-test receipt demonstrates otherwise.
