# Independent runtime security and recovery review

Worker-3 reviewed the newly created Workflow Foundry runtime on 2026-09-13.
The reviewer changed only domain research material and
`tests/security-audit*.test.mjs`; the prime implemented all fixes in shared
runtime, schema, store, capability, and installer files. No research-corpus code, security
target, live infrastructure, credential, or paid model was executed.

## Scope and evidence

The source review covered `src/runtime.mjs`, `src/store.mjs`,
`src/validate.mjs`, `src/capabilities.mjs`, and `src/data.mjs`, together with the
workflow schema and existing test conventions. Prime subsequently added read-only
review of HTTP, MCP, installer, and component boundaries. The tests use temporary
directories, locally registered mock tools, and short-lived child processes to
contain schema validation, an authored MCP fixture, and deterministic filesystem
fault injection. They do not write to unrelated projects. Every temporary
directory is removed through a test cleanup hook.

The first test batch had **10 cases: 7 passed and 3 failed**. After the prime's
fixes, the same ten cases passed. Adding three artifact boundary cases produced
**13 cases: 12 passed and 1 failed**. The remaining failure in that batch was
directory creation through an artifact-parent symlink before rejection. Three
additional authority cases initially passed 2/3 and exposed a concurrent-edit
loss during uninstall. **The final combined run passed all 16 cases**, with
unchanged source hashes before and after execution. These original failures
remain recorded below; a passing regression does not erase their history.

The code was being developed concurrently. Fingerprints captured after the first
test batch were:

| File | SHA-256 recorded with the first audit result |
| --- | --- |
| `src/runtime.mjs` | `e005edccdb459f6fb7e85bf3ddf578ecd16765879f70a47cde858f70e0d6b089` |
| `src/store.mjs` | `5a0c62e9d36dd2c4eb15063d19a76d29a46c1479d844e77432d98e554d0d189b` |
| `src/validate.mjs` | `5782743c6f29f87d7768e8708569bf1f163df8eb4cfe638ec728945dd4e3cb96` |
| `src/capabilities.mjs` | `dd6237b8c13fae2b6e902140f65f56a74d005e3c07a9ba7f8ae87b149f83ba91` |
| `src/data.mjs` | `50049ae8819aa022481faafb435f2887d94fa669ceef1b6375c8d4a664e7680c` |

These are observed development-file fingerprints, not a published release or a
claim that the working tree was frozen for the first run. The final validation
record must capture source hashes before and after execution and state whether
they remained unchanged.

## Reproduced failures and fixes

### WF-SEC-01: dangling SQLite symlink escapes the state directory

The original constructor checked `existsSync(target)` before `lstatSync(target)`
for the database, WAL, and shared-memory paths. A dangling symlink makes the
existence check false. Opening the database then followed that link and created
a database outside `.foundry`.

The regression prepares only an owned temporary workspace and an absent outside
test destination. It constructs the Store, then independently checks whether the
outside file exists. The original code created it. The prime replaced the
existence-gated check with an `lstatSync` check that ignores only `ENOENT`;
the repeated regression passed. This closes the reproduced pre-existing-link
case. It does not establish protection against a malicious same-user process
replacing filesystem entries between later system calls.

### WF-SEC-02: skipped prerequisites admit dependent effects

Originally, both `completed` and `skipped` were considered sufficient for
dependency admission. A conditional assert guard could be skipped and its
dependent mock effect would execute. The reproduced run dispatched one effect
and terminated `succeeded` with `input.allowed=false`.

The prime introduced an explicit join contract: the default `all_success`
requires successful predecessors, while `all_resolved` is an intentional join
for resolved conditional alternatives. The original skipped-guard regression
then passed with no effect. A workflow choosing `all_resolved` still needs an
explicit evidence or approval guard for any conditional effect; it must not
present resolution of branches as successful authorization.

### WF-SEC-03: cancellation can be overwritten by final success

The initial runtime could accept the last tool's returned result and evaluate
the graph's acceptance conditions without checking an already requested abort.
The regression starts a bounded mock read, requests cancellation while it is
in flight, and then releases its result. The original run became `succeeded`.

The prime added cancellation checking before graph completion and acceptance.
The repeated regression passed. Completed effects and evidence remain in the
ledger; cancellation does not erase them. Non-settled external effects still
need an explicit uncertain outcome rather than a fabricated rollback.

### WF-SEC-04: artifact directory creation precedes path rejection

The initial artifact capability recursively created the intended run directory
before checking whether its parents resolved through a symlink. With
`.foundry/artifacts` pointing to an owned temporary outside directory, the run
failed, but `outside/<run-id>` had already been created. The domain contract
requires that a rejected path does not first produce outside filesystem effects.

The additional regression independently checks the outside directory after the
failed run. It failed in the 13-case follow-up batch and was reported to prime.
The prime added ancestor-by-ancestor validation before creating descendants.
The final regression passed with no outside directory creation. This verifies
the pre-existing-link case, not arbitrary concurrent directory replacement.

### WF-SEC-05: uninstall overwrites a concurrent user edit

The original uninstall first checked all planned files for conflicts, then
restored or deleted them without rechecking each file at its mutation boundary.
The regression deterministically injects an edit into a later file when the first
deletion starts. The original code deleted that edit and returned
`uninstalled:true`.

The injection runs only in a child process and owned temporary generic
installation. It replaces the child's `unlinkSync` binding at one boundary and
restores that binding in `finally`. This models an intervening editor without
touching another user's files or relying on probabilistic race timing.

The prime added per-file content validation immediately before restore/delete.
The final regression passed, preserving the intervening edit and stopping the
remaining operations. This protects the reproduced window; it is not a claim
that a content check and a later path operation form an operating-system-level
atomic compare-and-swap against a malicious concurrent writer.

## Passing controls and schema observations

The schema review identified the danger of testing an asynchronous Ajv validator
as a synchronous boolean. Ajv explicitly documents that asynchronous validation
returns a Promise:
https://ajv.js.org/guide/async-validation.html.
By the time the first executable audit ran, the prime had already changed the
compiler. Therefore this review does **not** claim to have reproduced a failing
async-schema run against the original implementation.

The current regression verifies that invalid input under an asynchronous schema
is rejected without leaving an unhandled rejection. Additional tests check that
an equivalent schema remains usable after JSON persistence despite a repeated
`$id`, and that an unbundled schema identifier from another task cannot influence
the current task. The inspected repair uses independent schema compilers with a
bounded content-addressed cache and explicit unsupported-schema rejection.

| Executable case | What the independent assertion establishes |
| --- | --- |
| Async-schema rejection | Invalid data is not accepted through a truthy validation promise; a child process also observes unhandled rejections. |
| Repeated schema `$id` | JSON round-tripping a valid schema does not create a cross-request duplicate-ID failure. |
| Cross-task schema reference | A schema cannot use an identifier registered by another task as an undeclared dependency. |
| Dangling database link | A rejected database path creates no outside database file. |
| Skipped guard | No mock effect is dispatched when its required guard did not succeed. |
| Final-operation cancellation | An abort requested before the final result cannot produce a successful run. |
| Unsafe non-idempotent retry | A workflow requesting automatic repeated dispatch is rejected before any mock effect. |
| Lost acknowledgement | A mock non-idempotent effect happens once, remains uncertain, and does not repeat on resume. |
| Approval scope and replay | A high-risk effect pauses, rejects a model actor and another run's grant, then executes once after the matching approval. |
| Non-settled timeout | A timed-out operation that cannot confirm cancellation prevents further admission and does not retry blindly. |
| Artifact parent link | Rejection precedes creation of any outside run directory. |
| Artifact destination link | A dangling artifact destination is rejected without creating its outside target. |
| Artifact content conflict | Reusing an artifact name with different content fails instead of reporting an idempotent replay. |
| Connector annotation boundary | A remote tool's read-only annotation cannot lower the host's configured high-risk approval requirement; model-facing MCP resume cannot grant the approval. |
| Connector idempotency binding | Two retry dispatches receive the same runtime-owned key, overriding the model-supplied argument. The test does not claim that an arbitrary external server honors deduplication. |
| Concurrent uninstall edit | A file changed after the initial conflict scan remains intact when uninstall reaches its mutation boundary. |

Passing these controls is evidence for the tested semantics only. It is not a
complete security proof, an evaluation of generated workflows, or evidence of
parity with any researched product.

## Remaining design boundaries and unsupported domain guarantees

**Trusted capability code.** Registered JavaScript handlers receive trusted
runtime context, including the Store. They are not sandboxed by the registry.
The handler's source-string hash does not capture mutable closure state, external
configuration, account scopes, or remote service changes. An embedding must
qualify and bind those facts in its capability descriptor and isolate untrusted
workers. This review did not attempt to defeat an intentionally malicious trusted
handler or claim that the registry can make arbitrary host code safe.

**Filesystem concurrency.** The tests cover pre-existing symlinks and artifact
content conflicts. Path validation followed by later path-based operations is
not a proof against concurrent same-user replacement of parent directories.
Strong adversarial filesystem guarantees require an anchored directory-descriptor
strategy or an isolated writer with a protected artifact root, plus tests for
that exact operating-system contract. No concurrent race resistance is claimed
from the static-link tests.

**Authority freshness.** The observed approval identifier binds a run, workflow,
capability registry, node, arguments, and idempotency identity. The broader SRE
skill requires authoritative external target-version freshness, principal/tenant
scope, expiry, and one-use admission semantics. Those properties are not supplied
automatically just because a tool is marked `requiresApproval`. The literal
`actor='user'` API argument also requires an authenticated embedding boundary;
it is not itself proof of a human principal. Static inspection of `src/http.mjs`
found loopback binding, exact Host/Origin checks, cross-site rejection, and a
per-server mutation token. The token is exposed to the local browser in its
bootstrap page, so it is a local UI/CSRF boundary, not isolation from arbitrary
same-user host processes able to read that page or the state store. The prime
owns separate HTTP protocol and browser tests; this worker does not claim their
results. The component/MCP audit independently verified that read-only annotations
cannot replace host approval and that model-facing tools expose no human-grant
operation.

**Unknown external outcomes.** The tested runtime stops non-idempotent operations
in `uncertain` after an ambiguous result and does not blindly retry. It does not
thereby establish an independent external receipt or a generic automatic
reconciliation procedure for every connector. Domain adapters must provide that
evidence or remain blocked. A compensation is a separately authorized effect.

**Checkpoint integrity.** Event-chain verification detects the inspected chain
consistency errors. It is not an external signature or a durable anchor held by
an independent principal. The run checkpoint is trusted local state. This review
does not claim protection from arbitrary direct modification of the SQLite store
by a process with the same authority as its owner.

**Outcome validity.** A graph's acceptance expressions are supplied with that
graph. An identity or template capability can echo self-attested input into an
output referenced by acceptance. Preventing entirely constant acceptance helps,
but cannot establish a domain outcome. The independent evaluator must own the
world, events, receipts, and coverage checks. The twelve SRE/security fixture
specifications are development designs; they are not yet an implemented simulator
or a measured model success rate.

## Validation and tool limitations

The initial command was `node --test tests/security-audit.test.mjs`, with 7/10
passing. The first repair run passed 10/10. The artifact extension run passed
12/13 and reproduced WF-SEC-04. The new authority file initially passed 2/3 and
reproduced WF-SEC-05. The final command was:

```text
node --test --test-reporter=tap tests/security-audit.test.mjs tests/security-audit-authority.test.mjs
```

It passed **16/16**, with no failures, skipped tests, or cancelled tests. Its
raw TAP, exact command, UTC timestamps, and before/after hashes are in
[the runtime validation manifest](../manifests/sre-security-runtime-validation.json).
The compared source and test files remained unchanged across that run.

`npm run check` completed successfully under Node v24.20.0 and reported the
configured dependency pins and fourteen discovered skills. It is a doctor check,
not a task-quality certificate. The broader `npm test` run completed with
**74 tests: 73 passed, zero failed, and one skipped**. The skipped case was the
real browser workflow test, so this run does not establish browser verification.
No standalone formatter, linter, or typechecker script was configured for this
JavaScript project at the reviewed point.

`git diff --check` passed on the final broad-check batch. Source-provenance
validation independently checked 49 explicit path/range references, seven acquired
Git revisions, fifteen document hashes, and twelve fixture specifications with
no structural or hash errors. A final link check inspected ten Markdown files
and sixteen local links, with no missing links or links escaping an installed
domain skill. Portable Markdown source notes and case indexes keep the installed
skills independent of checkout-only research paths and a Markdown-only MCP reader.

The initial CoS quality inventory detected package manifests and test locations,
with no GitHub workflow or local Semgrep rule configuration. Serena's instructions tool
returned `PLUGIN_DISABLED`; no semantic-tool validation is claimed. CodeGraph was
not initialized for this bounded read-only review, and shared source edits were
made by prime.

A full-profile quality scan was deliberately scoped to `tests/` to avoid scanning
the untrusted research corpus and repeated after adding the authority test file.
Betterleaks reported no leaks in both runs. Trivy exited
successfully but found no language-specific package or configuration files in
that scope. OSV returned “No package sources found” with exit 128. This is **not**
a successful dependency audit. No Semgrep result was returned. The latest report
is `/home/raed/.local/state/cos-quality-gate/reports/20260913/165505-security-0574054b.json`;
the earlier report was
`/home/raed/.local/state/cos-quality-gate/reports/20260913/164427-security-0cb1c218.json`.
Repository-wide dependency, CI, release, and actual browser validation remain
the prime's integration responsibility; this worker changed no dependencies or UI files.
