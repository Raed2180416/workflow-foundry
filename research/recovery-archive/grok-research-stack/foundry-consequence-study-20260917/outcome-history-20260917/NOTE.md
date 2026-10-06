# Historical outcome inspection — worker-4

Latest checkpoint: **FINALIZED_V2.json**, after the independent ancestor-binding
review. The original `FINALIZED.json` and its 151-line source remain preserved as
the pre-review checkpoint; they are superseded, not rewritten. The repaired source
has 153 lines and passes 58 focused tests. See `lineage-fix/NOTE.md` for the three
actual counterexamples and the minimal fix.

The additive source is `src/outcome-history.mjs`, exporting
`inspectOutcomeHistory(store, { receiptId, currentRegistryHash })`.
It has no constructor, schema initialization, writable query, provider, workflow
execution, live artifact read, contract rebinding, or repair surface. An existing
Store or `{ db }` with a read-only SQLite connection supplies the records.

The inspector reads the raw immutable observation and contract, rechecks their
content identities and ledger keys, walks the applied parent/root lineage, verifies
immutable workflows and full request/proposal/run bindings, independently checks
the complete event chain, and retains every completed `core.artifact` producer.
It repeats the supported observer's JSON comparison directly on preserved bytes.

Supported historical observer identity is exactly `exact-json-artifact/2`, source
`8de15af4b6ce842c3e54039531c651472a9079a231bf31390f4a8f95b924f1fd`, data
`50049ae8819aa022481faafb435f2887d94fa669ceef1b6375c8d4a664e7680c`, and the
current process's exact Node version matching the frozen contract. Source identities
are captured at module load; the host and source loader remain trusted.

## Interpretation

The historical assessment is separate from `currentEvidenceCheck`, whose status
is always `unverified`, and `currentWorldQualification`, which is always false.
Registry equality compares only the caller-supplied hash; it asserts neither
semantic compatibility nor current authority. Present bytes are re-evaluated;
absence and unavailability are checked as recorded observer evidence. The latter
is not a repeated physical observation. A lost artifact directory after another
filename's completed producer remains unknown. Live filesystem changes never
upgrade an old observation or erase its original negative assessment.

Result IDs have the domain `outcome-history:<hash>`. Neither this ID nor the report
object is an outcome receipt accepted by `requestRepair`; stripping the prefix
does not create an outcome ledger record. The original observation ID is retained
only as source provenance. No `outcomeReceiptId` field is emitted.

This implements historical inspection only. Current repair and promotion checks,
including whole-registry mismatch refusal, remain unchanged. New-world repair
would need a separately reviewed lineage and fresh qualification. No old contract
or observer is migrated. Hashes do not defend against a privileged administrator
who forges every linked record consistently.

## Completed validation

The first focused invocation completed with 54 tests passed, zero failures,
cancellations, or skips. Raw TAP and stderr are `tests-01.stdout` and
`tests-01.stderr`; native fixture databases/artifacts and a report for the unused
capability witness are retained under `evidence-01/`.

Pre-review focused invocation: **55 passed, zero failures/cancellations/skips**, in
`tests-02.stdout` and `tests-02.stderr`. This adds the explicit `query_only` control
and strengthens the rehashed preserved-byte attack to make the new bytes/hash and
assessment internally consistent while retaining contradicting producer receipts.
The inspector rejects that contradiction. Final fixture evidence is in
`evidence-02/`, including `foundry-history-EMUrzQ/HISTORY.json`: original run
`5fa4aa90-9973-47af-9767-4a05f5dab6d9` remains succeeded, its historical assessment
is unsatisfied, the supplied current registry differs, and current-world
qualification remains false. Existing live verification and repair still refuse.

Full repository invocation for the original 151-line implementation, before the added query-only test and prime's later
history CLI: **616 total, 612 passed, zero failures/cancellations, four existing
optional skips**, exit zero. Raw output is `repository-tests-01.stdout` and stderr
is `repository-tests-01.stderr`. This is earlier full-suite evidence; it is not
relabeled as a full run of prime's subsequent CLI integration. `npm run check`
and `git diff --check` also exited zero. The package declares no formatter,
linter, or typechecker script. Prime owns the final combined full-suite run.

The tests exercise an actual read-only SQLite connection behind a SELECT-only
wrapper and prove no logical database change. Controls cover unused capability
addition with existing repair still refused, present/absent/unavailable outcomes,
live-byte changes/deletion, exact JSON semantics, full repeated producer evidence,
root/parent continuity, corruption of all bound record types, rehashed internal
contradictions, exact observer/data/Node identity, and history-ID misuse.

The 151-line source was sent to prime for attack before completion at SHA-256
`023921bb5bd99982c821b9fc9ec28e68763f8344ea53e57c824e6e0608f75610`.
The initial syntax check passed. Fourteen pre-existing source identities are
preserved in `SOURCE-BEFORE.sha256` and initially all rechecked successfully.
Prime read all 151 lines and reported the initial structure/scope appropriate.
Prime commissioned a separate worker-6 review; no completed independent-review
result was available at that first checkpoint. The subsequent independent review
found missing ancestor checks. Three fresh depth-two fixture corruptions were
accepted by the original inspector (the three refusal tests failed). The patched
inspector rejects all three and passes the expanded 58-test focused suite. These
are deliberate disposable corruption controls, not corruption of real saved work.

Prime subsequently added the explicit history CLI in `bin/foundry.mjs`, preserving
its prior bytes in `continuation-checkpoint-20260917/CLI_BEFORE_HISTORY.mjs` and
an intent receipt. The observed bin hash changed from `d23b59d8…21816fb` to
`450fad50…2c906b`. This is expected prime-owned drift, not a worker-4 edit.
The other thirteen baseline identities still match. Worker-4 inspected the actual
new route and updated its owned documentation to describe the read-only command,
built-in-catalog-only current hash, no component loading, read transaction,
query-only mode, and ordinary SQLite WAL reader caveat. Prime owns its new CLI
tests and integration evidence.

Pre-review snapshots of the three worker-owned product files are in
`source-final/`; corrected snapshots are in `lineage-fix/final-source/`.
`FINALIZED_V2.json` records the corrected hashes and explicitly links the unchanged
original `FINALIZED.json` and the pre-fix failures. The earlier full regression is
not a full-suite pass for the corrected source; prime owns the combined regression.
Worker-4 changed no pre-existing
product file for this task. All model calls and hidden benchmark reads remain zero.

Serena `activate_project` with the exact repository, the quality inventory, and
the full security scan each returned HTTP 404 `tunnel_client_not_seen`. None is
reported as successful verification. No live model calls or hidden benchmark
reads were performed. The unit fixtures are supplied development controls.
