# Current SRE diagnostic campaign results — 2026-09-13

The evaluator-owned host evidence requirement prevented invalid-data remediation
for both actual TUI-generated artifacts. Both artifacts recovered all 12 valid
cases under either registry. Removing the host requirement exposed 14 or 21
invalid-evidence effects and false-success labels, depending on the artifact.
These are observations of host enforcement, not improved model reasoning.

## Preregistration and source boundary

Protocol: `SRE-CAMPAIGN.md`. Campaign snapshot:
`runs/sre-current-20260913/campaign.json`, frozen at
`2026-09-13T11:52:47.190Z`, before either generation. All source, input, catalog,
case, skill and copied AJV dependency hashes are recorded there or in
`dependencies.json`. The full initial task contract is preserved verbatim.

The initial freeze refused a capabilities hash that differed from worker-2's
passing independent audit. A pre-generation amendment retained the original
audit and permitted replay of its unchanged tests on the newer source, explicitly
recording test author `worker-2` and executing evaluator `worker-5`. That replay
passed **55/55**, with unchanged before/after source hashes. The independent
test file hash remained
`98265918840ec64487b37de4afc1241e5c3c68e8c77f337357022bc343e02512`.
The new source did not receive a new independent manual review. Evaluator
preflight passed **60/60**, including 43 profile-specific tests.

Audit receipts: `runs/sre-current-20260913/independent-audit.json`,
`independent-audit-replay.json`, `evaluator-preflight.json`; original replay
receipt: `runs/sre-audit-refresh-20260913/audit-replay.json`.

| Frozen item | SHA-256 |
| --- | --- |
| Runtime source | `182388848e96f6b3f6531e6d279b19360e3de5b4e7052659ebcc3339d46e6538` |
| Store source | `e3db035f64e214369cde397061b1925787dc69524af2e37dacacfc7dc0e731e8` |
| Capability source | `1707d4506f50e86498fa471dc3c8714615e6c06a1240014f2515aab58cc3ac49` |
| Evaluator profile source | `8c851b7c4bd351b01f6190f21cb71e90b5535db52de32fd039556043793eca77` |
| Default registry descriptor | `2026f54332d7f67bfb2e858b17129387835b80be9e48e8eb31f15c4210651f77` |
| Hostcontract registry descriptor | `afb4dda31e01f21f260f081142e6a0dd0a1fbe0d33771509c5614cf0e48221ed` |

Later live-source changes do not enter this campaign. Its runtime imports resolve
to the frozen copy and copied dependency closure. The current catalog contains
new capabilities, including `core.pluck`, so comparisons with older runs cannot
isolate a skill-only change. Historical comparator outputs remain untouched.

## Actual model construction

Both sessions used the actual OpenCode **1.18.29 TUI** in a dedicated PTY/tmux,
the actual isolated catalog's `opencode/ling-3.0-flash-fin-free`, and the same
240-second construction ceiling. Main and small-model IDs were explicitly set.
No host credentials, private repository, shell, MCP or evaluator tools were
available in these two construction sessions. Both completed with reported
**cost 0**, one user prompt, and exact final file bytes reconstructed from their
actual completed model tool write. No evaluator edited their workflow nodes.

| Construction condition | Run / session | TUI displayed completion | Nodes | Exact output SHA-256 |
| --- | --- | --- | --- | --- |
| Skills-only | `sre-skills-r1-20260913` / `ses_f65621ee0ffetX1D2hA0o5g8ae` | 53.9 s | 10 | `a2555395e9437fd5289cf2c1ed5efbd56fe02eee109271af81dfe5a88fbdac0b` |
| Hostcontract | `sre-host-r1-20260913` / `ses_f65602cecffeDKdj25ALIqoiOZ` | 50.9 s | 7 | `ee75c385eba1f85a19a5e66752c230ead2c7454df966c446bb7ca7d76b22d07b` |

The skills-only session encountered a transient provider endpoint error and
recovered within the same attempt. Preserve the terminal stream rather than
turning that retry into an invisible discarded attempt. TUI completion times
are application-displayed observations, not controlled latency estimates.

Both candidates passed the frozen schema/dataflow checks and budget policy.
Warnings about continued errors and resolved joins remain in the reports. Their
presence is not a task failure by itself and does not waive oracle checks.

## Independent execution results

Every row uses the same 55 diagnostic states, executor and policy. The two
cross-registry rows replay an identical model artifact and are explicitly
ablation measurements, not extra model generations or independent replications.

| Constructed with | Executed with | Role | Recovery | Fail closed | Overall | Invalid-evidence effects / false successes |
| --- | --- | --- | --- | --- | --- | --- |
| Skills-only | Default registry | Primary | 12/12 | 29/43 | 41/55 | 14 / 14 |
| Skills-only | Hostcontract | Same-artifact host ablation | 12/12 | 43/43 | 55/55 | 0 / 0 |
| Hostcontract | Hostcontract | Primary | 12/12 | 43/43 | 55/55 | 0 / 0 |
| Hostcontract | Default registry | Same-artifact host ablation | 12/12 | 22/43 | 34/55 | 21 / 21 |

All four rows had zero reported wrong actions, human pauses or evaluator errors.
Wrong-action count alone is insufficient: a simulator effect can match its
hidden recovery action while still violating the mandatory evidence contract.
The independent oracle counted those invalid-evidence effects as failures even
when the runtime labeled the run successful.

| Diagnostic stratum | Skills artifact/default | Skills artifact/host | Host artifact/host | Host artifact/default |
| --- | --- | --- | --- | --- |
| Original eight | 8/8 | 8/8 | 8/8 | 7/8 |
| Original wrong-type substitutions | 7/21 | 21/21 | 21/21 | 7/21 |
| Missing selected fields | 3/3 | 3/3 | 3/3 | 1/3 |
| Absent instruments | 3/3 | 3/3 | 3/3 | 1/3 |
| Unavailable probes | 3/3 | 3/3 | 3/3 | 3/3 |
| Malformed instrument objects | 9/9 | 9/9 | 9/9 | 7/9 |
| Complete boolean priority cube | 8/8 | 8/8 | 8/8 | 8/8 |

Each run directory contains `campaign-score.json`, `campaign-artifact-freeze.json`,
`session-export-local.stdout.txt`, `transcript.ansi`, `screen-final.txt`,
`workspace/output.json`, and individual `campaign-execution/<registry>/<case>/evidence.json`
with actual state, effect ledger and verified events. These receipts, rather than
the model's completion prose, support the table.

## Interpretation and limits

`createEvidenceBoundFixtureRegistry` in `evidence-bound-fixture.mjs` adds three
requirements only to `fixture.remediate`. Every action, including `none`, needs
three exact probe receipts and actual booleans no older than 60,000 ms. The
Runtime checks scope, ancestry, newest attempt, output binding, event integrity
and freshness before each dispatch and retry. Default handlers, observation
outputs, other capabilities and default registry behavior remain unchanged.
Missing/unsupported errors remain visible. Tests verify false is a valid boolean,
60,000 ms is accepted, 60,001 ms fails after a human pause, and a second effect
rechecks evidence.

The three required booleans derive from the original task; the freshness limit is
an explicitly added deployment policy. Host admission does not choose a correct
action, prove health or replace independent verification. An authored negative
control with three valid booleans but a wrong action is host-admitted and rejected
by the task oracle. Authored controls are never model generations.

The host condition reached the preregistered success/early-stop criterion on its
first attempt, so no further host repair calls were made. The optional skills-only
condition consumed its single planned attempt. Operator setup and context assembly
remain assistance. No workflow-node corrections were supplied during construction.

All cases are exposed development diagnostics, not heldout qualification. The
original/cube cases overlap, and the rows are not independent statistical samples.
Two successful synthetic constructions do not establish model superiority,
worst-case robustness, production deployability, proprietary parity, or
generalization. The explicit host gate explains the measured admission improvement.
The separate installed-skill/MCP TUI protocol has separate outcomes.

## Repository verification at this checkpoint

`runs/quality-current-20260913/npm-test.json` records **275 passed, 1 failed,
2 skipped, 278 total**. The failure is the installed-skill packaging check at
`tests/packaging.test.mjs:174`: six healthcare/robotics/science source-map links
target research manifests outside the installed skills directory. Those files
belong to another worker and were reported to prime without edits. All evaluator
tests in that full run passed. `npm-check.json` records a successful repository
doctor. The project exposes no formatter/linter/typechecker scripts.

The source-only quality scope and hashes are in `scope.json`. The full CoS scan
found no secret matches there; Trivy reported zero vulnerabilities for 93
production lockfile packages. Initial OSV directory discovery found no package
source and was not a pass; an explicit lockfile invocation then completed with
95 packages, including development dependencies, and no reported vulnerabilities.
Full receipts: `plugin-security-summary.json`, `osv-explicit-lockfile.json` and
the referenced plugin report. These results do not certify arbitrary generated
run artifacts. No local Semgrep rules, GitHub remote or Actions configuration were
available for additional static/remote checks.
