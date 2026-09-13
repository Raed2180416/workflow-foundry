# SRE development case index

These cases challenge workflow design. They are visible development material,
not sealed test answers or proof of model performance. The adjacent
`fixtures.json` contains researcher-facing simulator specifications, including
evaluator-only fields. A model trial must receive only a case's permitted
observations and task projection. It must never receive the hidden world,
expected answer, or oracle logic for a supposedly held-out task.

The Markdown index is available through a Markdown-only skill reader. A research
runner can separately consume `fixtures.json`; this skill does not require a
reader to expose evaluator internals through its model-facing resource API.

| Case | Challenge | Required falsifying check |
| --- | --- | --- |
| `SRE-F01` | A recent deployment is an attractive explanation, but incident timing and another unchanged consumer support a different shared-dependency mechanism. | Require evidence that distinguishes competing explanations; reject a confident attribution based only on change proximity. |
| `SRE-F02` | Metrics return no samples and logs are inaccessible. | Reject any transformation of missing or denied observations into measured health; report the specific evidence gap. |
| `SRE-F03` | Global averages look healthy while one required region has high errors and then no request volume. | Check every required slice and denominator across the declared verification windows. |
| `SRE-F04` | An API first returns a transient rate limit, then requires cursor pagination. | Enforce retry timing and total budgets; do not repeat a permanent invalid query or report the first page as complete. |
| `SRE-F05` | The resource and proposal revision change after approval but before dispatch. | Require the trusted runtime to reject stale admission and record no committed effect. |
| `SRE-F06` | A non-idempotent capacity change commits, but its acknowledgement is lost before restart. | Reconcile the authoritative receipt and verify exactly one committed effect plus fresh recovery measurements. |

Each specification includes a paired variant in which relevant causal or
authority facts change. A workflow that always blames deployments, always retries,
or always abstains must fail appropriate variants. The evaluator owns actual tool
dispatches and effect counts; the model cannot establish them by writing a report.

Before using a case, implement its oracle in a separate trusted runner and test
that oracle against a valid reference trace, the included bad trace, missing
fields, stale timestamps, duplicate receipts, and invalid evidence digests. Freeze
the runner and a new scenario split before a comparison. Report development
improvement separately from held-out generalization.
