# Typed-input actual OpenCode TUI results — 2026-09-13

**No complete end-to-end qualification was obtained.** Two actual TUI sessions
generated workflows and failed the strict integration chain for different reasons.
The third actual TUI session was blocked before generation by the free provider's
HTTP 429 `FreeUsageLimitError`. All three allowed sessions were used and stopped;
there was no paid fallback, fourth session or manually repaired model candidate.

The explicit object input contract did produce successful actual model-owned
`foundry_run` calls. The original model candidate also passed seven independent
real-MCP execution checks. Those component results do not erase either integration
failure or qualify the complete request-to-locator workflow.

## Preserved conditions and identity

Prime's explicit READY preceded source acquisition. Every attempt used the same
3,860-file snapshot, including complete installed Node dependency bytes, src/bin,
schemas, the four selected skills, evaluator/helper sources and manifests. Node
and OpenCode executable bytes were separately copied and hashed. Before/after
acquisition and final verification were stable. The installed server never mounted
the live repository's node_modules. Host OS/shared libraries were observed and
hashed where reported by ldd; this is not a frozen OS image.

- Source identity: `103280ce27749d1bef3e31895a21f4c54b29d0a42199e8df089c85847276f2c1`.
- Dependency identity: `51ed133337e3102c56774f10b30d3202c970a30fc0948af7bd7c3f03d4f9d416`.
- Actual client: OpenCode `1.18.29`, model `opencode/ling-3.0-flash-fin-free`.
- Each isolated catalog explicitly reported input/output/cache prices zero; each
  actual session export reported the same selected model and cost `0`.

The original NumericRollup natural-language task was checked against the preserved
earlier task bytes. It was not replaced by a workflow template or answer. The real
project installer generated this MCP command in each synthetic project:

```text
/runtime/node /server/bin/foundry.mjs mcp --workspace /task
```

Native skills were installed and discoverable; actual TUI tool events establish
their use in the first two sessions. Hooks, plugins, language servers, formatters,
model shell execution, subagents and global configurations were disabled. The
workspace, isolated XDG directories, PTY transcript, raw session export, candidate
submissions, failed runs and artifact bytes remain available in each run directory.

`foundry_run.input` was explicitly required and typed as an object. The separately
named `foundry_run_json.inputJson` alternative was advertised as a required string.
No actual model call used that alternative in this campaign; repository real-stdio
controls cover its exact parse-once behavior. There was no implicit coercion.

## Actual session outcomes

| Session | Actual evidence | Strict integration result |
| --- | --- | --- |
| `mcp-typed-r1-20260913` / `ses_f65122913ffeQYb7NWhbwX4tu4` | Native skills, request-bound design, exact candidate validation, proposal, apply and a successful object-input run. Actual `totals.json` contained count 3 and total 21. | **Failed.** No successful locator write and no model `foundry_inspect` call. |
| `mcp-typed-r2-20260913` / `ses_f650b6de5ffe2ZqfWMLz6B3svZ` | Native skills, design, validation, proposal/apply, two object-input runs, actual inspect, successful locator write and final response. | **Failed.** The final proposal identified version one; the successful run/inspect identified a separately saved version two. |
| `mcp-typed-r3-20260913` / `ses_f6505bac9ffesGHizVZmQo9mcc` | Actual TUI connected to MCP, but the provider returned HTTP 429 with `FreeUsageLimitError`. Exported input/output/reasoning tokens were all zero and no tool calls occurred. | **Provider unavailable.** Construction and execution were not observed; not scored as a generated-workflow failure. |

R1 reached a final assistant response before the process ceiling; the idle TUI
process was subsequently terminated by its 240-second ceiling. R2 and R3 were
stopped explicitly after their terminal outcomes were observed. No owned TUI remains
active. Exact timestamps and process/stop receipts are in the run manifests.

The historical results in `MCP-TUI-RESULTS-20260913.md` remain unchanged. R1 is a
new typed-interface condition, not a relabeling of those earlier failed sessions.

## R1: transport improvement and evaluator permission failure

The actual completed run arguments were an object:

```json
{"workflowId":"NumericRollup","input":{"values":[3,7,11]}}
```

The successful actual TUI run was
`0e01756d-a1ef-4cdd-9294-ec297fb40a99`, against unchanged model candidate hash
`d8641d0a5e7bd0333941d0efcd5f1a7e408e1396c6c6c55ff9680b550a1d4c9e`.
Its actual artifact bytes remain at
`runs/mcp-typed-r1-20260913/workspace/.foundry/artifacts/0e01756d-a1ef-4cdd-9294-ec297fb40a99/totals.json`.

Five actual model write attempts used the intended `/task/output.json` path and
were denied. The evaluator had allowed `/task/output.json` and `output.json`, but
the actual isolated OpenCode project database recorded `id=global, worktree=/`.
OpenCode's built-in file tools authorize paths relative to that worktree, producing
`task/output.json`. The permission mismatch was an evaluator configuration defect.
The observed project metadata is preserved as `isolated-project-metadata.json`.

For R2, only equivalent task-prefixed spellings for the already-authorized locator,
input and installed-skill paths were added; wildcard read/write denials stayed in
place. No shell or additional output path was granted. The model successfully read
the diagnostic feedback and wrote the locator in R2, directly exercising the fix.
The updated preparation source is retained separately as `preparation.mjs`; all
frozen product and original scoring bytes stayed unchanged.

The missing inspect call was a separate observed omission. No claim is made that
correcting permissions alone necessarily fixes that omission.

After R1's failed result and full workspace were preserved, its exact completed
model proposal was copied without edits for independent SDK/stdio replay in a
network-disabled namespace. The candidate was matched to the raw model submission,
and real inspect/event/artifact receipts were checked. These controls passed:

| Independent case | Result |
| --- | --- |
| `[3,7,11]` | Actual artifact `{ "count": 3, "total": 21 }`, matching hash/event chain |
| Changed `[2,5]` | Actual artifact `{ "count": 2, "total": 7 }`, matching hash/event chain |
| Empty `[]` | Actual artifact `{ "count": 0, "total": 0 }`, matching hash/event chain |
| Nonnumeric `[1,"2"]` | `SCHEMA_MISMATCH`, artifact inventory unchanged |
| Missing `values` | `SCHEMA_MISMATCH`, artifact inventory unchanged |
| Non-array `values` | `SCHEMA_MISMATCH`, artifact inventory unchanged |
| Serialized object on object transport | `SCHEMA_MISMATCH`, artifact inventory unchanged |

Receipt: `runs/mcp-typed-r1-20260913/partial-independent-mcp.json`.
It explicitly records `originalTuiPassed: false` and `modelCalls: 0`.
The seven checks establish only those exposed cases; they are not a complete
boundary/adversarial task suite or a replacement for the failed model-owned chain.

## R2: successful file access, incorrect version binding

The model's first candidate added an erroneous acceptance condition requiring
the computed total and count to be equal. Its actual sample execution correctly
failed acceptance. That candidate had already been applied under proposal
`81d0c8c7-d23c-4dbf-b0df-c477c8e66e1e`, workflow hash
`b0e63425b014df8eef3910471cef42d93521cff5af8d6a52d6613bd2948de984`.

The model then saved a version-two repair. Re-proposing to the original applied
request returned `REQUEST_CLOSED`. The model nevertheless ran and inspected the
standalone repair successfully and wrote a final locator combining the old
proposal with new run `45506584-4ebb-4eef-b208-5c80486c8ff0`.
The artifact for that run contains the expected sample numbers, but the run is
not the applied proposal's program. Exact workflow-hash linkage rejected the result.
The original failed candidate, both runs, rejected proposal attempt, final locator
and raw tool outputs were retained. No locator or candidate was hand-repaired.

R3 received only generic feedback explaining this immutable version/request
lifecycle and requiring proposal/apply/run/inspect receipts to share one exact
hash. It received no workflow or acceptance expression. The model never processed
that feedback because the provider rejected generation. That intervention is
therefore **not qualified**. The optional second natural-language output-field
edit was not attempted within the three-session budget.

There is a concrete recovery limitation in this frozen interface: `foundry_requests`
lists queued requests but does not enqueue a new one. After applying a proposal,
the model cannot create the new request bound to the current workflow hash that
would legitimately authorize a revised proposal. `foundry_save` alone cannot fix
that missing request/proposal relationship. Likewise, host-only evaluation staging
is not exposed as a disposable MCP candidate-execution operation. A generic skill
must explain that boundary and preserve failure instead of manufacturing a joined
success receipt. A future interface campaign can test an explicit host-created
repair request or isolated pre-application candidate evaluation; neither mechanism
was added or silently assumed in this campaign.

## OpenCode source investigation

The relevant public corpus files and original MIT license were copied inertly to
`runs/mcp-typed-quality-20260913/opencode-source/` with file hashes and commit
`95daf90670b7c039c436c85537da5fbfe2205b41` in `opencode-source.json`.
No assertion is made that this public commit built the installed binary.

At that commit, `session/tools.ts:390-409` adapts the advertised MCP schema with
`ProviderTransform.schema` and forwards execution arguments to the converted tool.
`mcp/catalog.ts:42-66` forwards the argument object directly to `client.callTool`.
The inspected OpenAI-specific schema sanitizer applies to `@ai-sdk/openai` and
`@ai-sdk/azure`, whereas the actual Lingfree catalog metadata selects
`@ai-sdk/openai-compatible`. These inspected paths do not establish the origin of
the earlier nested JSON-string arguments. Raw provider-facing request capture or
matching-build instrumentation would be required for that attribution.

The path-permission finding is supported more directly: actual client project
metadata records `/`, and `tool/write.ts:54-56` and `tool/read.ts:255-257` request
permissions with the path relative to the worktree. The successful R2 locator
write provides an actual client check of the narrow spelling correction.

## Verification and limits

Current targeted tests passed **22/22**, including the owned evaluator negatives,
existing artifact/event oracle adversarial tests, model-write provenance checks
and real MCP object/null/array transport controls. The frozen CLI doctor passed.
Watched source bytes were stable during these checks. No formatter, lint or type
checker script is configured in this repository; none is claimed as run.

The deterministic quality gate's Betterleaks pass reported no leaks. Its recursive
OSV invocation failed to discover package sources inside the ignored evidence
directory; that failure was preserved. An explicit lockfile scan then examined
95 packages with zero reported vulnerabilities. The separately preserved complete
Trivy result examined 93 production packages with zero reported vulnerabilities
or misconfigurations. These are scanner results, not a proof of security. No local
Semgrep rules or GitHub remote/Actions configuration were available. Serena project
activation was attempted with the exact repository and returned `PLUGIN_DISABLED`.

Quality receipts, commands and before/after hashes are in
`runs/mcp-typed-quality-20260913/summary.json` and its adjacent JSON files.
The final inventory is `runs/mcp-typed-delivery-20260913/receipt.json`.

The frozen strict scoring implementation was not weakened or edited to convert a
failure into a pass. Independent controls, successful partial tools, rejected full
chains and provider unavailability are reported separately. This campaign supports
no heldout, commercial parity, production qualification or general worst-case claim.
