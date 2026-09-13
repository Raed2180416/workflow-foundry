# Independent audit of the generic evidence contract

Worker-2, 2026-09-13. Project: `/home/raed/Projects/workflow-foundry`.

## Result and qualification

The final independent suite passes **55/55 tests** on Node `v24.20.0`.
The first run reproduced four failures representing two underlying defects:
fallback to older evidence after a newer source failure, and replacement of an
event head that concealed truncated history. Prime changed the shared runtime
and store; this worker changed no `src/` files. The original failing assertions
were retained. Later additions exercise positive controls and out-of-order
source responses, rather than weakening the rejection requirements.

These are synthetic, deterministic development tests of the host evidence gate.
They are not model generations, a held-out comparison, clinical efficacy tests,
physical-robot tests, or evidence that the frozen comparator's reported wrong-type
failures have been rerun. No frozen comparator, model artifact or historical
control-audit receipt was modified.

The broader repository checkpoint completed with **129 tests: 128 passed,
0 failed, 1 skipped**. The skipped test is the opt-in UI browser workflow; this
audit did not enable a browser. `node --check tests/evidence-contract-audit.test.mjs`
and `npm run check` both returned zero. The latter is the project's doctor command,
not a linter or task-quality certification. The current `package.json:21-25`
defines no separate formatter, linter or typechecker scripts.

## Reproducible evidence

- Test implementation: [tests/evidence-contract-audit.test.mjs](../../tests/evidence-contract-audit.test.mjs).
- Raw independent runs, exit codes, timestamps and before/after SHA-256 maps:
  [evidence-contract-audit.json](../manifests/evidence-contract-audit.json).
- Syntax, repository-suite and doctor receipts:
  [evidence-contract-repository-checks.json](../manifests/evidence-contract-repository-checks.json).
- Report links, source-span bounds and the intervening source-drift check:
  [evidence-contract-report-validation.json](../manifests/evidence-contract-report-validation.json).

All four independent runs report unchanged monitored source hashes between
start and finish. The final run additionally hashes the enumerated local source,
test, adapter and evaluation modules, excluding mutable `evals/runs/` directories.
The raw records contain stdout and stderr, including the first failures; the
summary below does not replace them.

| UTC start, September 13, 2026 | Independent test count | Outcome |
|---|---:|---|
| 11:32:47.047 | 48 | 44 pass, 4 fail; two defects reproduced |
| 11:34:44.692 | 53 | 53 pass after prime's fixes and five added controls |
| 11:36:23.630 | 55 | 55 pass, including two response-ordering controls |
| 11:40:31.639 | 55 | 55 pass after refreshing the later store/capability snapshot |

The final repository suite ran at 11:40:33.622 UTC and ended at 11:40:37.820 UTC.
Its source hashes also remained stable. Syntax and doctor receipts are from
11:36 UTC; the test file and package scripts were unchanged. A source-binding
check at 11:39:44.690 UTC detected new store evaluation methods and default
capabilities added after the earlier 55-pass checkpoint. That drift record is
retained, and both the independent audit and repository suite were rerun on the
new snapshot. A later attempt to retrieve an earlier completed
terminal session was refused as retired/unproven; the wrapper's complete durable
stdout and terminal exit records were inspected instead. The command was not
restarted to replace missing terminal output.

The repository was an untracked initial working tree at inspection, so source
hashes, rather than an invented Git revision, bind these observations:

| File | SHA-256 for the final 55-test run |
|---|---|
| `src/runtime.mjs` | `182388848e96f6b3f6531e6d279b19360e3de5b4e7052659ebcc3339d46e6538` |
| `src/store.mjs` | `e3db035f64e214369cde397061b1925787dc69524af2e37dacacfc7dc0e731e8` |
| `src/capabilities.mjs` | `494054f24a1f93aabd163194e40da0298cddaf51f450d298358f05f46bc341b3` |
| `src/validate.mjs` | `9eabd5d7c0bf9082fb40ae565d883485332d0e048af9f12dd25df5c8865499ab` |
| `tests/evidence-contract-audit.test.mjs` | `98265918840ec64487b37de4afc1241e5c3c68e8c77f337357022bc343e02512` |

The initial failing runtime hash was
`537c8aa5dc45a8c663c114079ad9fdde820a02880a87912b037ba788fe49f0f0`;
the initial store hash was
`8a87203b8bf4182580f28591203a3b3f9f9974da52264d5ccedbdb88a8ca9ce9`.
Full dependency and test hashes for each run are in the receipts. The earlier
25-test control file still hashes to
`83105ba083537b78a32efbfa6a75961d1e17423d96c8a3a7b2e812973febe967`;
its original 25-pass checkpoint remains historical evidence at its original
source revision, even though the repository suite also runs those tests now.

## Test method and actual path exercised

`tests/evidence-contract-audit.test.mjs:14-108` defines independent fixtures.
Each test registers a fresh `CapabilityRegistry` containing only authored
`audit.observe`, `audit.identity` and `audit.effect` handlers. Observations come
from test-owned functions, not workflow-authored success claims. The observer's
output schema is deliberately permissive, so malformed observations reach the
new evidence gate; negative tests require that the observer actually completed.
The effect handler records dispatches in an array outside the run checkpoint and
uses an in-memory idempotency map. Assertions check handler dispatches and effects,
not just the runtime's `succeeded` or `failed` label.

Each executable fixture passes `validateWorkflow`, is saved as an immutable
workflow, and executes through `Runtime.create` and `Runtime.execute` with a real
disposable SQLite `Store`. Selected tests close and reopen the store. Freshness
tests control `Date.now` locally and restore it after each test; no long sleep or
real-world clock dependency is required. Corruption tests delete or modify only
their own temporary SQLite records. Test directories use a unique
`evals/runs/evidence-contract-audit-*` prefix and are removed at teardown.

The inspected production path in the final snapshot is:

1. `src/capabilities.mjs:10-30` checks the host descriptor, including bounded
   evidence requirements and schema compilation; `:34-35` includes descriptors
   in the registry digest.
2. `src/validate.mjs:108-115` requires a matching source-tool node in the effect's
   transitive dependency chain. This is a structural check; it does not assume
   that the source will execute successfully or produce correctly scoped data.
3. `src/runtime.mjs:290-312` resolves effect arguments, checks evidence before
   approval, and rechecks evidence after semaphore acquisition and attempt charge.
   Each retry passes through the latter check.
4. `src/runtime.mjs:356-377` considers same-frame transitive ancestors, matches
   tool identity and the canonical hash of `sourceArgs` resolved with
   `{ input: effectArgs }`, selects the newest attempt, requires successful
   completion, checks age and output hash, selects the configured output path,
   and validates its schema.
5. `src/runtime.mjs:119-132` binds attempt/completion ordering to event sequences.
   `src/store.mjs:104-118` checks the prior head before mutation/append;
   `:128-136` validates event bodies, chain continuity and head consistency.
   `src/runtime.mjs:134-142` checks the full event chain before resuming a run.

The component manifest exposes the same descriptor fields in
`src/components.mjs:34-45` and forwards them at `:87-95`. This was source-inspected
only for this audit. These tests do not call `loadComponents`, launch an external
service, or establish transport-level evidence semantics.

## Coverage and discriminating controls

| Requirement | Executable evidence and positive control |
|---|---|
| Required source exists and actually ran | `tests/evidence-contract-audit.test.mjs:111-139`: valid receipt succeeds; missing dependency fails validation; a skipped source remains absent at an explicit `all_resolved` join. |
| Malformed evidence cannot authorize an effect | `:141-168`: 14 null, string, array, missing-field, wrong-field-type, false-approval and extra-field cases reach the evidence gate and dispatch nothing; whole-output validation without a path also succeeds on valid data. |
| Scope is derived from resolved effect arguments | `:170-196`: correct effect scope succeeds despite conflicting workflow input; a workflow-scoped receipt cannot authorize another effect scope; nested bindings and canonical key order work; extra source args and absent bindings fail. |
| Provenance includes ancestry, run and frame | `:198-241` and `:433-457`: transitive ancestors work, nonancestors do not; human answers and copied objects cannot substitute for source receipts; other runs and earlier map frames do not qualify; each correctly scoped map frame succeeds. |
| Newest observation cannot be cherry-picked | `:243-334`: newer malformed or handled-error attempts block older valid evidence; a later successful refresh works; another scope's malformed receipt does not invalidate this scope; both possible out-of-order completion cases are tested. |
| Evidence expires across pauses | `:336-383`: exactly `maxAgeMs` is accepted; one millisecond beyond it and future-dated receipts are rejected after human pause/reopen; an explicit refresh restores validity; approval does not freeze freshness; a changed requirement invalidates the registry pin. |
| Every requirement and every retry must qualify | `:385-431`: a second unmet requirement blocks dispatch; a fresh retry keeps its idempotency key; expiry prevents a second handler call; an explicit bounded loop reobserves before retrying in a fresh frame. |
| Missing or changed checkpoint output fails closed | `:459-481`: output mutation with an unchanged receipt hash, deleted output and `onError: continue` cannot produce an authorized effect. |
| History truncation cannot be concealed by writes | `:483-549`: missing tail, complete deletion and event-body corruption are detected; direct store updates, human answers and approvals cannot replace a mismatched head and permit an effect. |

All source spans above refer to the final hashed snapshots. Parameterized tests
remain separate named Node tests in the raw output, so the 55-test count includes
each concrete malformed-output and ordering case.

## Reproduced defects and fixes assessed

### EVIDENCE-AUDIT-1: fallback to old evidence after a failed refresh

Before the fix, an old successful `audit.observe` result was followed by a second
same-tool, same-argument observation that threw. Its task used `onError: continue`,
and the effect deliberately used `join: all_resolved`. The new observation had a
`handled_error` status. Selection removed all non-completed observations before
sorting, so the older successful output satisfied the effect's evidence contract.
The independent counter observed one handler dispatch and the run reported
`succeeded`. This is preserved as run 1, test 29.

The final implementation selects among all matching attempted ancestors, orders
them by `startedSequence`, and only then requires `status === 'completed'`.
Tests confirm rejection of the original case and successful recovery after an
explicit later good observation. The two added concurrency tests establish that
an older request finishing late cannot replace the newer request merely because
its completion sequence is larger. This is an ordering contract for attempts,
not a claim that request-start time proves the physical age of external data.

### EVIDENCE-AUDIT-2: a write could conceal truncated history

Direct execution already detected missing tail events. The defect occurred on a
different path: after a human or approval pause, the fixture deleted events from
the original observation's completion sequence onward, retaining checkpoint
nodes and outputs. `Runtime.answer` or `Runtime.approve` then called
`Store.updateRun`. That update appended to the surviving database tail and
replaced `eventHead`, hiding the mismatch. Resume accepted the old checkpoint's
observation despite its deleted completion record. Both effect-handler counters
reached one and both runs reported `succeeded`. A third test reproduced the same
head replacement through a direct event-bearing store update. These are run 1,
tests 46-48.

The final `updateRun` compares the prior checkpoint's head to the actual tail
sequence/hash and event row count inside the transaction, before calling the
mutation callback or appending anything. The same three assertions now pass.
Normal human answers, approvals, valid event sequences and store reopen still
work in the positive controls. Full chain-body hashing remains an execution and
inspection check; it is not performed afresh for every append.

## Runtime invariants and remaining limits

The supported invariant is: a workflow can request a synthetic effect only when
the host's required source, argument scope, ancestry, attempt ordering, completion,
freshness, hash and data-shape conditions qualify at admission. A workflow's
`onError` setting, copied output, human-answer content or weak acceptance predicate
does not bypass those checks in the tested cases. Human approval remains an
additional authority decision and cannot preserve expired evidence.

An expired retry can consume an attempt charge and leave a durable `tool.intent`
before its repeated evidence check rejects actual handler dispatch
(`src/runtime.mjs:307-317`). Therefore an intent record alone is not proof that an
external operation ran. The tests distinguish this with an independent handler
counter. Evidence-gate failure is not currently an automatic upstream-refresh
mechanism: the positive retry example explicitly programs the observation loop.

Freshness uses source completion time in the local runtime. Cached remote data,
device clocks, calibration, units, causality, observation validity periods and
physical changes after observation require further host contracts. Provenance
and schema validity do not establish truth, clinical benefit, robot safety or
scientific efficacy. This suite does not measure the time-of-check/time-of-action
gap against an external system.

The schema applies only to the selected path, so a host must intentionally choose
its scope and required fields. This suite tests data compliance, not every possible
malformed host descriptor. The configured registry, source handlers and their
effect/idempotency declarations remain trusted. Arbitrary trusted host code or an
actor able to rewrite both SQLite checkpoint and the entire event chain is outside
the demonstrated corruption boundary. The unkeyed event hashes do not provide
independent external attestation.

No upstream research code, credential reads, corpus installers, medical/lab tools
or external robotics APIs were used by the new audit. No browser or
model/provider run was added.
Serena was attempted and returned `PLUGIN_DISABLED`, so no symbol/diagnostic
verification from that plugin is claimed. There was no Git remote to inspect for
GitHub quality evidence. The successful finite local suite qualifies these cases
and source hashes only; it does not establish arbitrary worst-case correctness.
