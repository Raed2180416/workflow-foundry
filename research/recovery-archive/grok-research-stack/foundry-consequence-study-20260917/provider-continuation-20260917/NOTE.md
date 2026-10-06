# Provider continuation — ready for prime review, no dispatch

All new work is under this directory. The actual campaign has not been run. No Jev, OpenCode or Ollama inference occurred in this continuation. Prior tiny OpenCode success remains prior transport evidence; no long-task success follows from it.

## Jev access

`ACCESS.json` records current-command-process presence booleans and a bounded scan of 25 nonsecret source files under `/home/raed/Projects/grok-research-stack/{bin,config,docs}`. `AI_GATEWAY_API_KEY` and `VERCEL_OIDC_TOKEN` are both absent; the administrative/context variables checked are also absent. The scan emitted only marker names, source paths, line numbers and hashes. It found no Jev, System One, Vercel or AI Gateway injection references.

The observed launchers are Azure Grok launchers. `bin/grok-azure:14-38` and `bin/grok-azure-stock:13-30` acquire/export `AZURE_GROK_API_KEY` and invoke the Azure Grok CLI. They are not a supported Jev injection interface. None was executed. No credential file, profile content, arbitrary secret location or other process environment was read; no credential value was printed or copied.

Prime's bounded login clarification is also recorded. The normal Core `login=true` invocation reports the same two missing credentials and a configured `SHELL=/bin/fish`; see `LOGIN_ACCESS.json`. This environment variable alone does not independently establish which shell binary Core executed. An explicit `/bin/fish` login invocation was refused with `SHELL_NOT_FOUND` before any command ran; see `LOGIN_SHELL_ATTEMPT.json`. There is no successful explicit Fish-shell result. No further credential discovery was attempted.

Result: **BLOCKED_MISSING_SUPPORTED_CREDENTIAL_INJECTION in the inspected execution context**. This does not establish that the machine or account has no credential elsewhere. Official Vercel documentation names AI Gateway API keys and Vercel OIDC as the supported routes (source URL and inspection date in `WEB-SOURCES.json`). Their existence in documentation does not establish local authentication. No Jev inference or authenticated endpoint probe was made.

## Driver and frozen configuration

`driver.mjs` uses the existing `OpenCodeV2FreeProvider`, `WorkflowGenerator`, `Foundry`, registry and stable v2 evaluator. It introduces no provider transport, product change or dependency. Import, `prepare`, and `check` do not instantiate the provider or load benchmark suites. Only explicit `run <reviewed-protocol-sha256>` enters the campaign.

The write-once `PROTOCOL.json` SHA-256 is:

```text
0ddea4e6e18e524e0f843bb55b002e702b4b9e79838d37789d47f7c1fb762ae3
```

Prime specified `opencode/big-pickle`, two rounds, 360000 ms generation budget, 150000 ms per call, and 8192 output tokens. Automatic apply during generation is false. Runtime policy remains 160 steps, concurrency 2, 30000 ms per run and zero monetary capability cost. Provider failures end the trajectory without another call or fallback. Each successful adapter response must bind its exact prompt/output hashes and model and carry a zero reported cost and one completed forwarded request. Raw token/cost evidence is retained per call; missing usage after failure stays unknown.

The complete serialized protocol is compared against prime's reviewed byte hash, and its complete object is compared against the current fixed configuration and source snapshot. No operational fields are omitted. The snapshot binds the driver/tests, relevant native implementation closure, provider/process helper, binary, schema, dependency manifests, installed skill files, public contract, registry, v1/v2 sources, both evaluator freezes and v2 calibration receipt. Checks occur before dispatch, each generation call, withheld evaluation, acceptance and finalization. The protocol hash is a byte commitment, not proof of the operator's identity or an approval substitute.

The future output location is exclusively new:

```text
../benchmark/campaign-opencode-v2-continuation-001/
```

The v2 evaluator requires output under `benchmark/`. That directory has not been created by this worker. A run uses exclusive creation and fails on reuse. All verification artifacts in this continuation remain under this study directory.

## Evaluation and applied delivery

The source follows the native generator using the original public task, current descriptors/schema and generic skills. Five development cases are eligible to supply repair feedback. Once a candidate is proposed, the provider wrapper is closed, exact workflow bytes and canonical digest are frozen with request/proposal/job identities, and the eight withheld cases are evaluated. The provider cannot be reopened for withheld feedback. The unchanged v2 preflight itself validates both suites on the host before generation; “before withheld evaluation” means before executing/scoring the candidate, not that the host never validates hidden fixtures. No suite loader was invoked in this continuation's tests or preparation.

After both stages pass, a separate host-authored research promotion receipt precedes apply. The final applied run must explicitly report `succeeded` both from `startRun` and the durable Store/delivery record. The driver reads the actual bounded manifest file and passes v2 `auditInstruments(sample,calls,events,{run,artifact})` its parsed JSON, exact text, byte count, SHA-256 and argument digest. It verifies exact expected JSON, selected input, canonical workflow, request/proposal/run lineage, registry, engine, event-head and delivery bindings. An existing file, a v1 audit or a locally green delivery cannot replace those checks. `independentTaskVerified` remains false in native delivery; scoped suite evidence is recorded separately.

The earlier gaps are preserved in `../cos-campaign.mjs:10,35,67-77` and worker-2's `../benchmark/calibration-v2-campaign-review-001/NOTE.md:21-23`: the original applied audit used v1, final status was implicit, and only three protocol hash fields were compared. Neither old driver, old protocol, old result nor evaluator was edited here.

The original v1 public task remains unchanged, with task SHA-256 `f5eb99642468d90583162ac60539f808f074083ace570da0178509bad4b1f650`. The v2 public addendum is intentionally not inserted into the model prompt. This disclosure preserves what is actually supplied. A fresh request creates new request/context identities, so equal prompt length does not establish equality with the prior CoS packet. Budgets, provider, context provenance and evaluator chronology also differ; this is not a matched model comparison. The all-processing-before-publication statistic stays non-gating. Temporal order does not establish causal use or generalization.

## Verification

Final receipt: `checks-ac2400b7-40c7-4609-bf72-50e1f3f0bde5/RESULT.json`. All **23 tests** passed: ten new driver tests plus thirteen existing OpenCode/provider-quota tests. Four JavaScript syntax checks and repository `npm run check` also passed. The package defines no separate formatter, linter or typechecker scripts. The repository doctor is a configuration sanity check.

`offline-fixtures-mC1rsO/NATIVE_SETUP.json` is the zero-inference real setup test. A native agent design request begins `diagnostic`, has `automaticGeneration=false`, and is excluded from the pending automatic queue. Real context matches the public registry and workflow schema and selects `workflow-foundry` and `runtime-native`. The actual generator's first prompt is **48508 UTF-8 bytes**, below 400000. A supplied capture callback deliberately stops before provider dispatch; native Store then marks the request `failed`. No case or workflow was run by this setup test.

Another supplied callback tests native generate/propose/apply on an explicitly constructed empty-batch fixture, with a real run and real v2 audit of actual artifact bytes. It is infrastructure validation with zero model inference and no frozen cases. Fourteen corrupted success/binding variants are rejected; changing artifact bytes while retaining the same JSON also fails the real v2 publication binding. The protocol test mutates every leaf and rejects byte drift and unknown fields. Provider checks cover the two-call ceiling, closed trajectory, rate/auth/unavailability/timeouts, binding errors and pre-dispatch source failure.

The first verification receipt `checks-f94dc524-cd40-4c16-b60c-8f5cdad1e7e1/` remains. It passed 22/23 tests; the test incorrectly expected `diagnostic` after the deliberately failed capture. The final test checks the native `diagnostic` to `failed` transition. No product behavior was changed to pass it.

Relevant old files and product providers were byte-stable across both test runs. Serena manual, project quality inventory and the scoped fast security gate each returned HTTP 404 `tunnel_client_not_seen`; those plugin checks remain unverified. There is no independent security or release-health claim. Prime reviewed the driver source and directed the final setup check; the worker-authored tests are not an independent audit of their own source.

## Provider disclosure and next invocation

Official OpenCode Zen documentation, inspected on 17 September 2026 and marked updated 16 September 2026, lists Big Pickle as free and describes it as a stealth model. It explicitly excepts Big Pickle from the general zero-retention statement: during the free period collected data may improve the model. Model parameter scale is not established here. Do not represent this route as zero-retention or as an identified small model.

Only the synthetic public task, capabilities, schema, generic skills and development feedback are intended model input. User project contents, historical private notes, credentials and withheld cases are excluded. The installed adapter's explicit-zero catalog checks must run on each actual attempt; the earlier tiny response's zero cost is not a guarantee of access, completion or billing for a larger request.

The check-only command is:

```sh
node driver.mjs check 0ddea4e6e18e524e0f843bb55b002e702b4b9e79838d37789d47f7c1fb762ae3
```

After prime reviews these exact bytes and separately authorizes dispatch, the corresponding command replaces `check` with `run`. No `run` command was executed in this continuation. Full generation, development/withheld campaign execution, long-output compatibility, outcome repair and task quality remain untested by this driver.
