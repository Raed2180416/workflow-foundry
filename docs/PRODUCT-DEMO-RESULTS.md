# Product browser demonstration — 2026-09-13

The bounded real-model demonstration **failed during initial workflow construction**. The browser submitted a fresh natural-language request and displayed all three recorded attempts. No candidate passed schema validation, so the independent suite never executed, no workflow was promoted, and the natural-language revision stage was not attempted. The separate synthetic browser controls passed. Those controls do not establish successful model generation.

The campaign is a diagnostic using the isolated noninteractive OpenCode provider. It is separate from the actual-TUI comparison campaign, and establishes neither held-out task quality nor commercial-product parity.

## Evidence and source identity

All paths below are relative to the repository unless otherwise stated. The new campaign directory is:

```text
research/product-demo/runs/2026-09-13T13-23-00-987Z-Ld5AC8/
```

`closure.json` records 3,916 copied files: executable source, CLI, schemas, skills and references, static UI assets, exact installed Node dependency bytes, package metadata and lockfile, task and suite inputs, and the original campaign runner/tests. The experiment imports the copied source under `snapshot/`. Before copying completed, before each provider dispatch, and after completion, the declared files were checked by SHA-256. Five installed executable identities were also checked. No declared bytes changed.

| Identity | Value |
| --- | --- |
| Source/dependency closure | `c665090f374702ba903696af5d34dde87ccd05e07c511e21b1c3c13e0c0a3463` |
| Frozen inputs file | `8b77c3c9a6d361b415c2fd15f663cfbe2b7045242725a0424fddba5e163a9a9c` |
| Capability registry | `2026f54332d7f67bfb2e858b17129387835b80be9e48e8eb31f15c4210651f77` |
| Initial suite | `76fc51ae0374c0ef119bd69ae8b08b735ce8774a508cc659d2226f4657b423aa` |
| Node | `v24.20.0` |
| Observed Chromium | `152.0.7977.82` |
| Observed OpenCode | `1.18.29` |

The closure covers copied application/dependency bytes and observed executable binaries. Operating-system shared libraries and remote model weights were not copied or frozen. Changes to unrelated live research files cannot invalidate this copied source, and were not treated as source drift.

`inputs.json`, `initial-suite.json`, and `revision-suite.json` were written before the first provider call. They contain the initial task, both diagnostic oracles, the revision request, and independent UI-run samples. The initial request received no historical candidate or hand-authored workflow. The revision oracle preserves the original seven cases and adds ordered `batchTotals` expectations only for valid inputs.

## Actual construction outcome

The UI request is `2ed444fe-995e-4195-a0f9-690d80eb90f3`, recorded with `source: user-ui`. Its generator job is `c2444146-5f33-416a-8043-1a246b0aa34b`. The job took **107.907 seconds**, within its five-minute deadline. The budget was at most three calls for initial generation and three for revision; actual use was **three initial calls and zero revision calls**.

| Attempt | Observed outcome |
| --- | --- |
| 1 | Invalid JSON. The native parser reports a missing comma or closing bracket at offset 1837. |
| 2 | Invalid JSON again, at offset 1884. |
| 3 | Valid JSON, rejected by the workflow schema because `/nodes/2/body/acceptance` has fewer than one item. |

The final candidate hash is `cd971df69cf87e3eb30a7297ba08d3f167de5acc9e4cbfe86c70d67c34afb06a`. It was retained as rejected provider output and was never repaired by hand or promoted.

The final model workspace contains **zero saved workflows, zero runs, zero proposals, and zero qualification receipts**. A schema rejection is not a failed seven-case execution score; this campaign has no task execution score. The intended generated-workflow graph inspection, successful initial run, successful revision, and model-produced version-history demonstration remain unqualified.

Each call used the catalog-observed `opencode/ling-3.0-flash-fin-free` model. Before dispatch, the existing provider required input, output and cache prices to be zero. After execution, this runner independently checked the exported session model, every assistant model identity/cost, exported session cost, exported text against streamed text, raw-output hash, prompt hash, response hash, and OpenCode binary identity. All three sessions reported zero cost:

| Round | Actual exported session |
| --- | --- |
| 1 | `ses_f650e8114ffeOvV5KCF4xLnR7Z` |
| 2 | `ses_f650db667ffeS35t9JYSCjNM3E` |
| 3 | `ses_f650d49d5ffe26LkvLi0d73esB` |

`initial-model-provenance.json` contains the cross-checks. Original prompts, catalogs, streams, exports, responses and assessments remain under `workspace/.foundry/generation/<job-id>/`. `diagnostic-summary.json` records parse diagnostics and final store counts. `network.json` records real UI requests and responses with only a boolean for token presence; it does not retain the local mutation token.

The earlier `.foundry/verification/batch-generation-run.json` and `.foundry/verification/product-demo/` failures were read for orientation and left unchanged. This campaign did not replace their receipts or claim their historical partial case results as current success.

## Browser controls and recovery

The main campaign's explicitly synthetic control workspace is `synthetic-controls/workspace/`. It proves actual HTTP/browser behavior for a rejected short string answer, a valid string answer, preservation of an in-memory draft during refresh, a numeric answer retained as an integer, a stale version-bound draft that requires explicit rebinding, preservation of the old run hash after that synthetic revision, and a cancellation request that reaches a recorded terminal `cancelled` state without a proposal.

The supplemental `recovery-6LoOCs/` experiment made no model calls. It loads the same frozen application/dependencies, records its own runner hash before interactions, and launches the real `bin/foundry.mjs serve` command. Both CLI launches have exit-code-zero receipts in `cli.json`. One browser was reused through network loss and actual server termination/restart.

All five supplemental checks passed: manual refresh preserves the draft, a full page reload restores the durable pending question and original workflow hash, network reconnection works, server restart preserves the question while rejecting the previous page's token, and reloading then answering completes the original run. The final synthetic run is `84115d90-d3e4-4838-af96-ed0e644e50b3`, pinned to `5d8c7dcc9735262ab2fbfbdd5987fb7b0f4299e242c67275d95b03488038f317`.

Two user-visible limitations were observed. **Unsent drafts do not survive a full page reload. After a server restart, reload the page before submitting an answer or change:** the previous token returns `HTTP_TOKEN`/403, even though read-only state polling has reconnected. The pending question and saved run survive; the unsent draft does not.

The primary and recovery receipts report no script errors or unexpected external browser requests. Their recorded POSTs carried the local token. Deliberate invalid-input and stale-token requests returned 400 and 403 respectively. Browser instances, generation processors and owned HTTP servers were closed. Browser sessions were sequential, with no background browser fleet.

The screenshots and accessibility snapshots are in `browser/` and `recovery-6LoOCs/`. The failed-job screenshot `browser/03-initial-failed.png` and successful synthetic recovery screenshot `recovery-6LoOCs/04-recovered-original-run.png` were visually inspected. Successful synthetic screenshots are labeled synthetic and cannot be used as evidence of a successful generated workflow.

## Verification and open baseline failure

`node --test tests/ui-live-contract.test.mjs tests/ui-contract.test.mjs` passed **12 tests**. The new contract tests reject absent execution evidence, mismatched suite/workflow/registry identity, over-budget calls, nonzero cost, modified historical runs, and source drift. They also check that the frozen revision oracle preserves rejection cases and ordered totals.

`node --check` passed for the campaign and recovery runners. `npm run check` passed; in this repository it invokes `doctor`, not a formatter, linter or typechecker. No separate formatter/linter/typechecker script is configured. `git diff --check` returned zero; the repository's files are currently untracked, so that command does not by itself validate all newly authored files.

The existing opt-in browser test was executed from the copied snapshot, preserving original `web/artifacts` evidence:

```sh
FOUNDRY_UI_E2E=1 node --test tests/ui-browser.test.mjs
```

Its receipt is `baseline-browser.tap`: **15 child checks passed and one child check failed**; Node reports 17 tests, 15 pass and two failures because the parent also fails. The cancellation check at `tests/ui-browser.test.mjs:431` waits for the transient text `Cancellation requested`. The current generator can record terminal cancellation immediately through its abort race, so the fixture's gated provider does not keep that transient state observable. The separate real-token terminal cancellation control passed. This baseline failure was reported to prime before any changes; neither the frozen test nor production UI was changed to conceal it.

The connected deterministic quality gate's fast scan completed. OSV reported no findings. The broad Betterleaks scan reported 5,970 matches across the downloaded corpus and prior research; those matches were not adjudicated by this UI slice, and the scan is **not a clean security gate**. Its report is `/home/raed/.local/state/cos-quality-gate/reports/20260913/185413-security-6d592661.json`. Serena activation was attempted for the exact repository and returned `PLUGIN_DISABLED`. The quality map found no GitHub remote/workflow evidence available for this slice.

## Open the recorded workspace

From a terminal on the user's machine, this opens the real recorded model campaign with its failed attempts. It enables no model provider and makes no model calls. Port zero selects an available local port; open the `ui` address printed by the CLI.

```sh
foundry_demo_root=/home/raed/Projects/workflow-foundry/research/product-demo/runs/2026-09-13T13-23-00-987Z-Ld5AC8
node "$foundry_demo_root/snapshot/bin/foundry.mjs" serve \
  --workspace "$foundry_demo_root/workspace" --port 0
```

To inspect the successful **synthetic recovery** run instead, use `--workspace "$foundry_demo_root/recovery-6LoOCs/workspace"`. That exact CLI/source/workspace combination was launched, restarted and exercised through the browser during the recovery test. Stop the server with Ctrl-C.

Automatic generation uses `--agent opencode-free --model opencode/ling-3.0-flash-fin-free --rounds 3 --generation-timeout 300000 --suite <host-selected-suite.json>`. Omitting `--auto-apply` keeps the proposal review step visible. A CLI server binds one evaluator suite per invocation; changing the task's independent oracle for a revision requires selecting the revised suite and restarting that server, followed by a page reload. The library campaign runner can switch the host evaluator explicitly between completed stages. This campaign exhausted its initial budget, so further model generation would be a separately authorized experiment with fresh evidence.

The construction follow-up sent to prime is generic: preserve the native JSON parser's offset/context in repair feedback instead of reducing it to “invalid JSON”, and explicitly check nonempty acceptance criteria at every nested graph scope. Those changes were not applied in this slice, and their effectiveness has not been measured.

## Offline follow-up — exact responses preserved

The subsequent offline diagnosis is in [`research/product-demo/OFFLINE-ANALYSIS.md`](../research/product-demo/OFFLINE-ANALYSIS.md). It made **zero additional model calls**. The original outcome remains failed creation with **three initial calls and zero revision calls**. The later reference-02 HTTP 429 / `FreeUsageLimitError` was recorded after these three responses; it is separate from their construction failures.

Both malformed responses prematurely close the validation node before `timeoutMs`; the native parser detects the following colon at offsets 1837 and 1884. Actual historical repair prompts retained the full preceding output but omitted the native syntax location. The third response corrects that brace and still contains the empty map-body acceptance array. Its map-output path `sumBatch.value`, `core.pluck` count/items, serializer output and transitive dependencies are consistent with the frozen contracts. No reference-path defect was established for this candidate.

Prime subsequently implemented strict bounded syntax diagnostics and generic nested-acceptance wording in shared source/skills. Worker-10 replayed the **unchanged** responses through the original frozen host and a separately frozen updated host. Both still reject all three responses, invoke the evaluator zero times, and create zero workflow/proposal/run/qualification records. The updated host's next offline callbacks receive precise error locations. The replay does not show improved model behavior or turn the failed trial into a pass.

The new stable offline receipt is:

```text
research/product-demo/runs/2026-09-13T13-52-41-212Z-offline-1dnBKn/result.json
```

Its updated source/dependency closure is `2d2ef5dff4ef2e717f83ff30b01d5202b6d3dd06157bf09e037202bddd139dbe` (3,889 files and the Node binary). That closure, the original 3,916-file/five-executable closure, and all protected original artifacts verified unchanged. Other prime integration changes are enumerated in the receipt, so this is an identified current-host replay rather than a single-change model experiment.

| Task case | Expected artifact or rejection | Actual initial execution | Revision |
| --- | --- | --- | --- |
| positive | batchCount 2, grandTotal 10 | Not run | Not attempted |
| negative-and-empty | batchCount 2, grandTotal -1 | Not run | Not attempted |
| empty | batchCount 0, grandTotal 0 | Not run | Not attempted |
| fractional | batchCount 1, grandTotal 4 | Not run | Not attempted |
| string-number | Rejection/failure; artifact absent | Not run | Not attempted |
| missing | Rejection/failure; artifact absent | Not run | Not attempted |
| extra-field | Rejection/failure; artifact absent | Not run | Not attempted |

`individual-case-metrics.json` records seven registered cases, zero executed, zero passes, zero execution failures and seven not run, with execution success fraction `null`. The same case statuses apply to both unchanged-text host replays. This is not an evaluated 0/7 score.

The follow-up's **16 targeted tests passed**. They cover strict parser locations and unchanged output, Unicode/fenced input, invalid nested map/loop acceptance, actual host feedback delivery, output-path behavior with empty/nonempty neutral maps, and existing static UI contracts. A separate synthetic oracle probe failed every input without examining it: the original suite credited its three negative cases and rejected all four positive cases, leaving the suite failed. That synthetic 3/7 result is not a model score. Fifteen isolated input-schema probes also passed; they do not constitute runs of the invalid candidate. Direct numeric capability probes exposed overflow and grouping-dependent rounding beyond the seven-case envelope.

The first offline attempt at `research/product-demo/runs/2026-09-13T13-48-56-303Z-offline-aKIUxY/` remains preserved as a harness failure: copied UI assets were missing, so one existing test module could not load. A fresh corrected snapshot produced the passing offline receipt. Successful historical browser/provenance/restart controls remain separately scoped; no browser was launched by this offline follow-up and no new UI behavior is qualified by its static tests.
