# Independent review of historical outcome inspection

Reviewer: worker-6. This review covers `src/outcome-history.mjs` and a small source inspection of the CLI route. Only this new review directory is writable by the reviewer. Native workflow runs, generation, model calls, training, and edits to earlier evidence are outside this review.

**Final disposition: PASS for the bounded review of the revised 153-line source, SHA-256 `4caa2bce1e7b55226367ac0b5178d51af92ac1d145b48b5b820e584476b08b8a`. All 14 independent groups pass.** H1 and H2 below are retained failures of the original release and are rejected by the revised source. The review establishes consistency of historical evidence under the trusted host/database/source-loader boundary; it grants no current-world or repair authority.

## Original release: two confirmed lineage gaps

The released 151-line source SHA-256 is `023921bb5bd99982c821b9fc9ec28e68763f8344ea53e57c824e6e0608f75610`. It is **not certified as passing**. An independent in-memory checker completed 13 groups against that exact source: 11 passed and two intended-rejection groups failed. These are supplied relational records, each with a four-event chain for the ordinary case, not claimed native executions or evidence that the saved campaign was corrupted.

**H1 — the intermediate applied proposal's own base is not checked.** Original lines 58–64 compare the prior proposal's request ID and status with the parent request and compare its workflow hash with the child request's base. They omit `prior.baseHash === parent.baseHash`. In a three-request chain `q0 → q1 → q2`, changing only `p1.baseHash` to another hash leaves the final observation's recorded bindings unchanged and is accepted by the original inspector. The control changing the final proposal `p2.baseHash` is rejected. The final proposal receives the missing check at original lines 67–69; ancestor proposals do not. This is an integrity-check omission, not a claim of an existing repair-permission bypass.

**H2 — an intermediate applied program is not compared with its own repair request's intent.** Original lines 61–62 compare a child request with the prior program it inherits. Original line 70 compares only the final observed program with its request. Neither checks that an intermediate applied program retained the goal and criteria of its own repair request. Two independently supplied fixtures keep `q1`'s original goal/criteria, change respectively the goal or criteria in `p1`'s workflow, then inherit that change in `q2` and `p2`. All recorded hashes and the final binding agree with these fixtures, and both are accepted by the original source. The missing check is parent-request goal/criteria equality with the prior applied program when that parent is itself a repair.

Both findings were sent promptly to prime. They block an unqualified claim that the original source verifies complete repair-intent lineage. They do not erase the earlier actual model-repair audit, whose records have no asserted corruption, and they do not show a method for creating a repair permit from a history report.

## Boundaries that the original source handles correctly

Original lines 39–49 bind the raw receipt and contract digests, ledger keys, and exact pinned evaluator/source/data/Node identity. Lines 50–92 check the final request, proposal, immutable workflow, run, root, input, registry, policy, engine identity and complete event-chain hashes. Current engine compatibility is not inferred from a historical engine identifier.

Original lines 93–141 retain all completed artifact producers, including other filenames. Present bytes must match their recorded SHA-256, length and every same-filename completed producer. The exact JSON predicate is recomputed from the preserved bytes. Absent or unavailable observations use `recorded-observer-evidence-only`: they establish consistency of retained observer evidence, not a newly performed physical observation. A missing target after its producer is unknown; a missing run directory after a different-file producer is also unknown. The finite checks reject omission of a repeated producer, contradiction of preserved bytes, event truncation, evaluator changes, and an attempted unknown-to-negative reassessment.

Original lines 142–150 return a separate `outcome-history:<hash>` identifier, `currentEvidenceCheck.status: unverified`, `liveArtifactRead: false`, and `currentWorldQualification: false`. Changing the supplied current registry hash changes only the current comparison metadata, not the historical assessment. The existing `OutcomeRepairCoordinator.receipt` identifier gate rejects the namespaced history ID. The original observation ID is retained for provenance; an operation using that original ID still enters the existing verifier and its current evidence and authority checks. No coordinator constructor or repair request was invoked by this reviewer.

The inspector uses only parameterized SELECT statements through the supplied database handle. Table and column names come from its own internal calls. It does not initialize schema, write records, construct Foundry, inspect live artifact paths, execute capabilities, or contact a provider. Its module-load filesystem reads are limited to source identity capture. The database and source loader remain trusted; consistent fabrication by a privileged database administrator is outside the guarantee.

The caller owns concurrent snapshot selection. The source accepts an already-open read-only handle; it does not begin a transaction itself. The documented finite bounds are refusal limits, not a guarantee that every object below each individual limit is supported: the pinned JSON helpers also enforce structural and aggregate serialization limits. No large-memory stress run was performed.

## CLI source inspection

The inspected `bin/foundry.mjs:118–145` route precedes component loading at line 161 and Foundry construction. It accepts only the history receipt and workspace/project selector, checks the existing database path and symlinks, opens SQLite read-only, sets `query_only`, and supplies a read transaction. It supplies the built-in registry hash without loading external components. This is a built-in catalog comparison, not reconstruction or qualification of an arbitrary current external registry. The CLI's ordinary WAL reader behavior is disclosed in the source and documentation. This review does not independently rerun the CLI/native test suite.

## Validation record

The initial independent receipt-ID probe incorrectly prohibited even preparing a SELECT. The pinned `receipt()` implementation prepares the statement before evaluating the ID argument, while execution via `.get` follows argument validation. The checker was corrected to forbid execution; the namespaced ID was then correctly rejected with `OUTCOME_ARGUMENT`. This was a reviewer-harness error, separate from H1/H2. The corrected original-source run was 11/13, with only H1 and H2 failing.

The first two inline read-only command dispatches were blocked before execution because tool safety status could not be determined. A later file-based checker command executed successfully. One patch returned a connection error; a read confirmed it had not been applied before the patch was retried. Serena's instructions endpoint returned HTTP 404 `tunnel_client_not_seen`; no Serena verification is claimed. No blocked command is counted as a completed check.

The source author added `prior.baseHash === parent.baseHash` at revised line 59 and the intermediate request-to-applied-program goal/criteria checks at lines 63–64. The revised source has 153 lines and SHA-256 `4caa2bce1e7b55226367ac0b5178d51af92ac1d145b48b5b820e584476b08b8a`. An independent full-source read found these are the relevant corrections; the historical assessment, current-evidence and authority separation remain in place at revised lines 144–152.

The final independent checker ran on **2026-09-17 at 09:13:02 UTC** under Node `v24.21.0`. All **14 groups passed**, including both ancestor intent variants, the ancestor base mismatch, the valid three-request control, producer accounting, absence/unknown distinctions, exact evaluator identity, preservation of byte bindings, event truncation rejection, and rejection of the history identifier by the existing receipt reader. The original negative run is explicitly retained in `AUDIT.json.originalReleaseFindings`; it is not relabeled as a pass.

The only saved-record invocations were the two already finalized campaign observations, read through an actual read-only SQLite connection and a SELECT-only wrapper. They required 17 inspector SELECTs in total. The old observation `dadf02f676ab22bee8b2afa0a37409c767c002dcc59a055a6a0fc40f5c589a1f` returned historical `unsatisfied`, with its exact 67-event binding and one-request lineage. The repaired observation `93c0f90949b07205481681179213f44f3ffd976020164459e22da9c0436b5a18` returned historical `satisfied`, with its exact 67-event binding and two-request lineage. The returned bindings exactly equal their saved receipts. The wrong-observation invocation deliberately supplied a different registry hash as metadata; it did not alter an actual registry. The right-observation invocation supplied the recorded hash. Both retained `currentEvidenceCheck.status: unverified` and `currentWorldQualification: false`. SQLite `total_changes()` remained zero. No live artifact was read or modified.

Commands completed successfully:

```text
node --check history-independent-review-20260917/check.mjs
node history-independent-review-20260917/check.mjs --write --expected-source=4caa2bce1e7b55226367ac0b5178d51af92ac1d145b48b5b820e584476b08b8a
```

`AUDIT.json` was created once with the final results and original failures. Its checker hash is `4834747e5530dd2b4eb0959ececcc479ab63d06da0bdda70957217eddf48645d`. The source and five checked source/receipt inputs were rehashed after the checks and remained identical. The optional CLI review is source-only, for bin SHA-256 `450fad505fbc3c77176eb4bb9880343e169c71e402f319e38e3ff6f8182c906b`; no independent CLI-suite completion is asserted here.

There are no remaining blockers within these bounded checks. General validity for arbitrary records, trustworthy physical observations by a past host, resistance to consistent privileged database fabrication, current artifact condition, current policy/capability compatibility, and promotion or repair permission remain outside this result.
