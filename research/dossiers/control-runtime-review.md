# Independent control and recovery audit

Worker-2 reviewed the Workflow Foundry runtime independently of the prime's implementation work. This is a local development audit using synthetic capabilities and records. It does not evaluate a model, a commercial workflow product, a robot, a laboratory or a clinical deployment.

## Result at the recorded source revisions

**All 25 control-audit tests pass after the prime's cancellation fix.** Earlier runs exposed two cancellation-classification failures: a caller-requested cancellation was reported as ordinary failure when either a cooperative pure handler or a retry-backoff timer rejected with `AbortError`. Both original assertions now pass unchanged. Their raw failures remain in the evidence history; no assertion was skipped or weakened.

The first test run contained 19 cases and passed 18. Three additional cases checked the prime's new join semantics and capability drift, producing 21/22. A focused cancellation probe demonstrated the same issue for a cooperative handler, producing 21/23. After the prime patched cancellation handling, two additional regression cases checked originating-failure preservation and uncertain-effect precedence; the resulting suite passed 25/25. The expanded suites preserve all earlier cases. The source snapshots were unchanged within each recorded execution.

Raw TAP, exit codes, start/end UTC times, Node version, command arguments and before/after file hashes are retained in [control-runtime-audit.json](../manifests/control-runtime-audit.json). This receipt is the authoritative history; subsequent results must be appended rather than replacing these failures. The tests are [control-audit.test.mjs](../../tests/control-audit.test.mjs).

The failing runtime file had SHA-256 `04a17918d899bc5d518263f4cdabb7a98fa273ee1e7ad3a8e5f24fc7cae75b1e`. The passing focused execution began at `2026-09-13T11:18:55.670Z`, using runtime SHA-256 `fbcc48e6c213775d780d956b5b923aa61ab25afe90c4e7db705d150d95e0ab16` and test SHA-256 `83105ba083537b78a32efbfa6a75961d1e17423d96c8a3a7b2e812973febe967`. It exited 0 with 25 passes, zero failures, zero skipped tests and zero todos. All recorded executions used Node `v24.20.0`; complete before/after file hashes are in the receipt.

The subsequent full repository run at `2026-09-13T11:19:47.292Z` passed **51/52** tests, including all 25 control tests, on a newer stable source snapshot. Its one failure is outside this worker's test ownership: `tests/security-audit.test.mjs:187`, concerning creation of an outside directory through an artifact-parent symlink before the path is rejected. This was reported to prime and remains a separate release blocker at that checkpoint. `npm run check` passed. Exact source hashes and raw output for both commands are retained in [control-repository-checks.json](../manifests/control-repository-checks.json). A passing control suite is therefore not described as a passing repository-wide release gate.

## Scope and method

The source inspection covered the complete `src/runtime.mjs`, `src/store.mjs`, `src/validate.mjs`, `src/capabilities.mjs` and `src/data.mjs` files, the workflow schema and the architecture contract. Relevant updates to join semantics, validation and cancellation were reread before execution. The `Foundry` facade was also read to understand the actual save/proposal/run/cancellation callers and the skill-reference interface. This audit did not modify `src/` or the shared schema.

Tests use newly created, uniquely named workspaces inside `evals/runs/control-audit-*`; each test closes its store and deletes only its own workspace. Capabilities are pure computations or explicit synthetic effects. Concurrency tests measure simultaneously active handlers. Human-pause tests close and reopen the database. One test starts an owned child Node process and exercises the runtime's trusted test-only crash injection immediately after a synthetic effect; it verifies the child terminated with `SIGKILL` and that recovery does not duplicate the effect. No unrelated process is signalled.

The tests use independent observable state, dispatch counters, journal entries and exact outcome predicates. They do not merely assert that functions return success. Every generated workflow is validated before execution so that a malformed fixture cannot masquerade as a runtime boundary test. The test construction initially corrected a map-input binding to pass the map item explicitly into its nested loop; that correction preceded the first recorded execution and is not represented as a product defect.

Commands used:

```sh
node --check tests/control-audit.test.mjs
node --test --test-reporter=tap --test-concurrency=1 tests/control-audit.test.mjs
```

The initial focused executions returned exit code 1; the post-fix focused execution returned 0. The broader commands were `npm test` and `npm run check`, with the separately qualified outcomes above. The inspected package defines `test` and `check` but no dedicated formatter, linter or typechecker script. No security-scan result or CI result is claimed by this audit. Serena was attempted earlier for the research task and returned `PLUGIN_DISABLED`; it supplied no symbol or diagnostic evidence.

## Verified properties and concrete oracles

| Case | Contract exercised | Independent observation | Result |
|---|---|---|---|
| 1 | Nested map and loop dataflow, shared state namespaces, completed-run resume | Two item limits produce 2 and 3 increments; exactly five tool calls, eight charged steps and seven frames; reopening and resuming adds no calls. | Pass |
| 2 | Step budget applies to nested parent and child nodes | A five-step allowance stops at five charges before an additional child dispatch; explicit `STEP_BUDGET`. | Pass |
| 3 | A bounded loop must satisfy its exit predicate | One allowed iteration cannot reach the requested value; explicit `LOOP_EXHAUSTED`, no outer result. | Pass |
| 4 | Map cardinality is checked before child execution | Two items against a maximum of one cause `MAP_BOUND`; zero child calls. | Pass |
| 5 | Data dependencies and local-variable scope are explicit | Undeclared sibling output and a map variable referenced directly inside a loop body are rejected by validation. | Pass |
| 6 | An explicit resolved join cannot invent skipped output | A skipped producer has no output; an unguarded consumer fails with `MISSING_REFERENCE`. | Pass |
| 7 | Deliberately optional data needs an explicit policy | `all_resolved` plus an explicit default produces the declared fallback; the skipped producer is not charged as a dispatch. | Pass |
| 8 | A skipped guard cannot admit an effect under the default join | The downstream effect is skipped; independent effect count and journal show zero dispatches. | Pass |
| 9 | A handled error is distinct from a successful prerequisite | `onError: continue` produces `handled_error`; a downstream default-join effect is skipped and independently observed effect count stays zero. | Pass |
| 10 | Human answers survive reopening and do not replay completed work | Two nested questions pause at different frames; wrong-type and duplicate answers fail; two pre-question calls remain exactly two through reopen/resume; final seven charges. | Pass |
| 11 | Nested parallel flows share the capability concurrency ceiling | Twelve handler calls across two maps reach a peak of two active handlers and never exceed two. | Pass |
| 12 | Cost is reserved before concurrent dispatch | Three quarter-unit calls with a half-unit allowance dispatch exactly twice and stop with `COST_BUDGET`. | Pass |
| 13 | A successful handler return still needs output validation | A string in a required boolean field causes `SCHEMA_MISMATCH`; no accepted output is stored. | Pass |
| 14 | Non-idempotent ambiguity preserves intent and prevents replay | Handler sees its durable intent before throwing; run becomes `uncertain`; reopening/resuming does not call it again. | Pass |
| 15 | Unconfirmed timeout is not assumed to stop a handler | A handler ignores cancellation past its timeout and grace interval; outcome is uncertain even after its later return; no automatic replay. | Pass |
| 16 | Actual process loss preserves simulator effect identity | A killed child has already recorded one effect; parent recovery retries the node but the transactional effect count remains one. | Pass |
| 17 | One live runner owns a run | A second invocation receives `RUN_BUSY` while the first is held; only one handler executes. | Pass |
| 18 | Revision changes preserve active-run pins and isolate approvals | A version-two proposal changes future work; the approved old run retains its original hash and payload; a new run cannot consume the old approval. | Pass |
| 19 | Competing proposals use compare-and-swap | The first replacement wins; the second stale replacement is rejected and cannot overwrite the newer head. | Pass |
| 20 | Capability drift blocks a human-paused run before dispatch | The same capability name with a changed implementation/version fails `CAPABILITY_DRIFT`; zero calls to the new implementation. | Pass |
| 21 | Requested cancellation precedes a late pure result | A barrier ensures abort is requested before the handler returns; the run is cancelled, not successful. | Pass |
| 22 | Cancellation while waiting to retry retains its meaning | Abort is requested before a retryable failure enters backoff; the run is now correctly cancelled without another attempt. | Pass after fix; original failure retained |
| 23 | A cooperative pure handler's confirmed abort is cancellation | An entered pure handler uses an abort-aware delay; caller aborts; the run is correctly cancelled and no output or second dispatch appears. | Pass after fix; original failure retained |
| 24 | A real failure retains precedence over induced sibling cancellation | A later sibling fails after an earlier handler starts; the run remains failed with `SYNTHETIC_ROOT_CAUSE`, not a cancellation label. | Pass |
| 25 | Caller cancellation cannot falsely confirm an ambiguous effect | An entered non-idempotent synthetic handler is aborted; the run remains uncertain and resuming does not repeat the effect. | Pass |

The passing crash test proves deduplication for the bundled transactional simulator and its stable effect key. It does not prove exactly-once behavior for an external service. The concurrency result is a per-run capability ceiling; it is not a global fleet-resource lease or a hardware safety guarantee.

## Observed defect and independently verified correction

**Finding CONTROL-001, corrected in the passing snapshot: cancellation was not consistently normalized at asynchronous boundaries.** At the failing source, `src/runtime.mjs:338` awaited an abort-aware retry delay. Node rejected it with `AbortError`/`ABORT_ERR`. The execution catch at `src/runtime.mjs:161–166` distinguished cancellation only when `error.code === 'CANCELLED'`, so the run became failed. A cooperative pure handler produced the same kind of error in the task catch path and reached the same incorrect terminal label when its attempt limit was exhausted. These line ranges refer to the explicitly hashed failing snapshot, not a permanently stable working-tree location.

The test barriers remove timing ambiguity: each test waits until the synthetic handler has entered, requests cancellation and only then lets the relevant failure or abort acknowledgement reach the runtime. In both failures the requested operation is synthetic and there is no claim that a real device stopped. The incorrect status can mislead callers that distinguish user interruption from an operational fault, even though these tests do not show duplicated effects or unauthorized execution.

The correction request sent to prime was to normalize an abort-related rejection after a confirmed caller cancellation into the runtime's `CANCELLED` error at the task/backoff boundary. It also required preserving `uncertain` for ambiguous effects and retaining the causal failure when that failure cancels siblings. The prime implemented a separate caller-cancellation flag, normalization at the task/backoff boundaries, uncertain-effect precedence and selection of an originating non-cancellation failure before induced sibling cancellations. This worker reread the changed ranges and independently executed the regression cases; it did not patch `src/`.

Revalidation succeeded for the unchanged original tests 22 and 23 and the complete expanded control suite. The broader repository run also passed all control cases but exposed the separate artifact-parent issue described above. Previous raw results remain available and each pass claim is bound to its recorded source hashes.

## Integration observation

The three domain skills include machine-readable `references/requirements.json` files. At the inspected `src/foundry.mjs:24–31`, `readSkill` admits only Markdown reference names. A direct check confirmed `SKILL_PATH` for each JSON reference. This worker resolved the progressive-reading gap within its owned files: each domain now includes a deterministic `references/requirements.md` rendering of every JSON case, with the source JSON's byte hash, and the front-door skill points to the Markdown reference. The original JSON remains available for machine consumers. No core extension or permission change is required; direct JSON access through that reader remains unsupported.

## Research requirements beyond these tests

The related [science/robotics/healthcare dossier](science-robotics-healthcare.md) extracts 36 proposed domain cases. Those are design requirements, not 36 additional runtime passes. In particular, current tests do not establish authenticated physical adapter admission, telemetry freshness and device epochs, cross-run resource arbitration, a protected journal against a privileged writer, policy applicability in healthcare, scientific validity, clinician escalation quality, or physical stop acknowledgements.

The capability registry treats adapter implementations and metadata as trusted configuration. Its schema and hash checks do not independently prove that a handler truthfully declares idempotency, correctly enforces a hardware envelope, or captures every dependency in closed-over state. A valid JSON output can also be factually wrong. The separate incident-oracle tests in this project explicitly demonstrate that a model-like self-attestation can satisfy local workflow acceptance while failing an independent task oracle; this audit does not relabel that documented distinction as a new defect.

Human changes are versioned proposals for future execution. Existing runs remain on their pinned program. This is verified behavior, not live migration of arbitrary in-flight effects. Likewise, a cancelled software run may still contain evidence of completed effects, and an uncertain run requires a real reconciliation mechanism before deployment can claim safe recovery.

This finite audit establishes the listed local properties only. The cancellation defect is corrected and independently rerun; the progressive-reading gap is resolved through owned Markdown companions. The broader artifact-parent test remains separately qualified at its recorded checkpoint. No paid calls, upstream package execution, production changes, real hardware or clinical operations were involved.
