# Product CLI outcome repair — worker-4 handoff

The explicit product CLI path is implemented and passes local subprocess tests.
Edited product source: `/home/raed/Projects/workflow-foundry/bin/foundry.mjs`.
New product files: `tests/outcome-cli.test.mjs` and `docs/OUTCOME-REPAIR.md`.
All other writes for this task are in this new study directory. No core module,
old test, provider, package manifest, or frozen outcome-adapter file was changed.

## Interface and behavior

- `outcome-contract --request ID --input JSON_OR_FILE --artifact-name NAME --expected JSON_OR_FILE --evaluator-id ID`
- `outcome-observe RUN_ID --request ID --proposal ID --contract HASH`
- `outcome-repair-request --receipt HASH --request ID --run ID --expected-hash HASH [--diagnostic TEXT] [--max-depth N]`
- `outcome-context --request ID [--domain DOMAIN] [--no-skills]`
- `outcome-propose CANDIDATE.json --request ID [--rationale TEXT]`
- `outcome-apply PROPOSAL_ID`
- `generate --outcome-repair --request ID --agent opencode-free|opencode-v2-free --model ID`

Use the same `--workspace PATH` across the lifecycle. Outcome commands call the
existing coordinator. Generation selects its `generationHost()` facade and
requires an existing repair request. It rejects replacement task/workflow inputs
and `--auto-apply`; application requires a separate `outcome-apply` invocation.
No new provider, automatic generation loop, outcome interpretation, or authority
override was introduced. Existing provider selection, validation and limits remain.

Ordinary `propose`, `apply`, `prompt` and `generate` reject an outcome repair with
`OUTCOME_CLI_ROUTE` before provider setup. Detection checks the existing immutable
repair ledger as well as request markers, so deleting markers does not enable an
ordinary CLI bypass. Non-outcome requests retain their ordinary behavior, including
explicit user changes of goal and success criteria. No outcome ledger is created
by an ordinary request/proposal/application lifecycle.

Observation exit zero means a receipt was recorded or verified; inspect its
`outcome` field. `unknown` and `unsatisfied` are never silently converted to task
success. Invalid/refused operations exit one with a JSON error on stderr. The
coordinator's original immutable contract, byte/event binding, version CAS, and
unknown/absence semantics remain unchanged.

## Measured validation

Final report: `verification-Eubfvm/REPORT.json`.

| Check | Observed result |
| --- | --- |
| New CLI subprocess tests | 21 passed, 0 failures, 0 skips |
| New CLI + original outcome + original provider CLI tests | 66 passed, 0 failures, 0 skips |
| Full `npm test` | 562 total: 558 passed, 0 failures, 4 optional skips |
| CLI/test syntax, `npm run check`, `git diff --check` | Exit 0 |
| Source changes during verification | None |
| Pre-existing files changed since preservation | `bin/foundry.mjs` only |

The actual subprocess happy path creates a request and host expectation, proposes
and applies a supplied wrong candidate, executes a successful run with incorrect
bytes, observes `unsatisfied`, opens a repair, exposes expected/observed differences,
proposes/applies v2, executes, and observes `satisfied` under the same contract.
The original successful run and original bytes remain retained. The documentation's
offline shell example was executed and both artifact hashes were checked.

Refusals cover stale repair creation/context/proposal/application, altered live
artifact evidence, ordinary-apply bypass after tampering, wrong run bindings,
frozen expectation changes, goal/criteria changes, unknown producer-byte loss,
inappropriate provider flags, and malformed/mixed route arguments. A separate
wrong-filename run establishes required-file absence and completes explicit repair.
Repeated observations/repairs preserve IDs. Ordinary user revision behavior passes.

Both CLI provider names were exercised through the real generator/facade with
supplied offline provider-module doubles. Their preloads block network and provider
child dispatch. Tests also reject stale context before a callback and changed
artifact evidence during a callback before proposal acceptance. These are routing
and integrity controls, not live model or provider-quality evidence. Live model/API
calls for this task: zero.

The first test run is preserved as `tests-01.stdout`, `tests-01.stderr`,
`tests-01.source.mjs`, and `evidence-01/`. It reported 13 passes and 6 failures
(four leaf failures plus two parent failures) caused by invalid source generated
for the offline provider double. That fixture was corrected before final testing.
The first run's direct CLI lifecycle/refusal checks passed; its failed generation
controls are not counted as successes.

## Source and evidence identities

Pre-edit CLI bytes: `pre-edit/foundry.mjs`; pre-edit source hashes:
`pre-edit/source.sha256`. Final product-source snapshots and before/after hashes
are in `verification-Eubfvm/source/` and its report. `FREEZE.json` binds these
identities, reports, preserved transcripts and successful trajectory receipts.

| File | SHA-256 |
| --- | --- |
| CLI before edits | `27cf24865c9e6f30437cda0980e2f6e03928ca40521ddb61f2837433b64495dd` |
| CLI after edits | `d23b59d8d181f9d954463094a9e36bde2d4e7af859b629bf2b34ea4ae21816fb` |
| New CLI tests | `4f3cc76c49e6665b5f88f7dc17daa1835abd02d79747b1cf54f936b6f6e469ac` |
| New documentation | `ebbda86e7c6d86641fe330574aac3e4e509515187aca03b58701e15ed155f56a` |
| Unchanged outcome module | `8de15af4b6ce842c3e54039531c651472a9079a231bf31390f4a8f95b924f1fd` |

## Limits and unavailable checks

Serena `initial_instructions`, the deterministic `project_quality_map`, and
`security_scan(profile=full, include_semgrep_registry=false)` each returned HTTP
404 `tunnel_client_not_seen`. No plugin analysis/security pass is claimed. The
package declares no formatter, linter, or typechecker script. The four optional
repository skips are the extended MCP lifecycle, package installation, browser UI,
and browser trial/repair integrations. No remote GitHub/API query, live provider
request, hidden benchmark read, package release, or independent worker review was
performed for this CLI task. Prime owns separate live-model integration/review.

The CLI enforces coordinator routing for outcome requests. Direct library callers
and a database administrator remain within the trusted-host boundary; the frozen
Store/Foundry methods were intentionally not changed. The new documentation is in
the checkout; this task did not alter the package's explicit documentation list.
