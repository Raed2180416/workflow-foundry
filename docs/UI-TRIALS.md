# Draft trial and diagnostic repair UI

The existing Canvas, inspector, Requests & changes, and Run evidence views now
include the draft trial lifecycle. This is a bounded extension of the current UI.

Use **Draft trials** in the sidebar, or paste the opaque trial ID returned by the
host into **Inspect by trial ID**. Inspection loads `GET /api/trials/:id` directly.
The returned source hash stays attached to the root graph and every nested view;
polling never replaces it with a reusable workflow head. Trial source is kept
outside the saved-workflow cache. A missing exact source is shown as unavailable.

The trial view shows local acceptance and **Independent task unqualified**.
Run evidence includes the trial receipt, returned artifact receipts, events and
recorded node outputs. Rejected input shows `run: null` without invented node
execution. Paused trials remain inspectable without start, answer, approval,
resume, cancellation or repair controls. A failed reinspection marks the prior
snapshot explicitly and preserves its displayed source identity.

For a terminal failed saved run, **Open diagnostic repair** appears only when
loaded records connect an applied request and applied proposal to that run's
exact hash and current head. The action sends those actual IDs and hash to
`POST /api/repair-requests`, then loads the returned request's actual host context.
The server remains responsible for provenance, verified failure, depth and stale
head checks. A concurrent head change is displayed as an error without rebinding.
Existing diagnostic requests remain inspectable through the failed run.

Requests from `agent-request` and `agent-diagnostic` retain their source labels,
lineage, preserved intent and automatic-generation-off message even when the
workspace is configured for automatic handling of user requests. Creating a
diagnostic record does not start generation or grant execution authority.

**Inspect delivery linkage** calls `POST /api/delivery` with the actual request,
proposal and run IDs. Its receipt and separately scoped task-suite evidence are
displayed without promoting suite passes to independent verification of this run.
If the recent state page lacks a matching applied request/proposal, the UI shows
that linkage is unavailable instead of guessing identifiers.

Run the browser audit with:

```sh
FOUNDRY_UI_TRIALS_E2E=1 node --test tests/ui-trials-browser.test.mjs
```

The audit reuses one installed Chromium at `/usr/bin/chromium` and blocks external
browser requests. Fixtures use real local HTTP, Store and Runtime with handwritten
neutral workflows; there are zero model calls. Each invocation preserves a new
`ui-trials-*` directory under `FOUNDRY_UI_ARTIFACTS`, or the system temporary
directory, containing screenshots, receipts, failure evidence, a synthetic
workspace and source identities. `inputRejectedSourceAvailable` records whether
the host returned the exact source for a rejected-input receipt. Missing source
is tested as a visible limitation, never substituted with the current saved head.

The normal test suite includes the pure linkage regression and skips the browser
unless explicitly enabled. No repository formatter, linter or typechecker is
configured in `package.json`; JavaScript syntax and repository test commands
provide the available native checks.

## Recorded integration check — 2026-09-13

The first browser invocation passed all 10 scenarios with Chromium 152.0.7977.82
(12 passing Node test entries including the parent and pure linkage regression).
Source identities remained unchanged throughout the run. The audit recorded
three authenticated HTTP actions, zero external requests, zero browser errors
and zero model calls. Desktop graph, diagnostic context and mobile light-theme
screenshots were inspected. The default suite passed 376 tests with no failures
and four opt-in skips; `npm run check` and both JavaScript syntax checks passed.

Repository evidence is preserved at
`evals/runs/ui-trials-validation-szSRWX/`, with the browser receipt, source hashes,
screenshots, synthetic workspace and original failure events under
`ui-trials-SgCb0S/`. Expected stale-head and artifact-integrity failures are part
of the passing controls and remain recorded. The receipt reports
`inputRejectedSourceAvailable: false`: the current host omits exact source for
input-rejected trials, so that case demonstrates the explicit unavailable-source
view rather than a draft graph. This API gap was reported to the source owner.

The scoped web secrets scan reported no leaks. A broader repository scan includes
untriaged corpus and historical-data findings and is not a clean security claim.
Serena activation was unavailable (`PLUGIN_DISABLED`); the independent plugin
quality inventory, native tests and actual browser provided the available checks.
These results establish local interface behavior only.
