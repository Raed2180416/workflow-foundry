# Installed skills and actual MCP TUI integration — 2026-09-13

**The complete OpenCode TUI integration failed in both bounded attempts.** Native
installed skills and real MCP discovery, design context, validation, proposal
submission and application worked. Neither session completed a workflow run,
produced the requested locator file or reached a final assistant response before
its 240-second limit. Both reported cost 0. The failures remain preserved.

A separate, deterministic local MCP control subsequently passed five checks on
the unchanged first model-generated candidate. Actual object inputs produced
correct artifacts with verified completion receipts; JSON-string inputs were
rejected. This control isolates successful server behavior and does not change
either TUI outcome or qualify the complete model/client path.

## Conditions and provenance

Preregistration: `MCP-TUI-PROTOCOL.md`. This is a separate diagnostic transport
condition, not part of the SRE skills-only/hostcontract campaign. The real project
installer ran with `--client opencode --no-hooks` inside a fresh restricted
workspace. Its installed MCP command was preserved:

```
/usr/bin/node /server/bin/foundry.mjs mcp --workspace /task
```

The real unmodified Foundry server and four selected skill packages were copied
into a read-only server snapshot. Installed public Node dependencies were mounted
read-only with the package lock recorded; dependency file bytes were not separately
frozen for this transport condition. No host credentials, private repositories,
user/global config, research-corpus installs, external MCP services or model shell
tools were involved. Native skill/MCP permissions applied only to the isolated
synthetic workspace. No project hooks were installed or evaluated.

The actual OpenCode CLI discovered `workflow-foundry`, `runtime-native`,
`human-steering` and `domain-software` under `/task/.agents/skills/`. Its MCP list
reported the local `workflow-foundry` server connected. Exported TUI tool states
then established successful native skill loading and actual calls, beyond those
initial metadata checks.

The first setup directory, `runs/mcp-installed-20260913/`, records an installer
launch failure: the read-only server mount lacked the nested `node_modules`
mountpoint. It launched no model TUI. The evaluator added the missing empty
mountpoint while preparing a new directory; that infrastructure assistance and
the failed original setup were preserved.

## Actual TUI attempts

Both actual sessions used OpenCode **1.18.29** and catalog-verified
`opencode/ling-3.0-flash-fin-free` for the main and small model, with fresh XDG
state, a dedicated PTY/tmux and a 240-second wall limit. Binary SHA-256:
`cbe7cd781d4987e7224709a9ff6367b0c28b38bbbed05b40a1d434c33a9278a0`.

| Attempt | Run / actual session | Request | Result |
| --- | --- | --- | --- |
| First | `mcp-installed-v2-20260913` / `ses_f65593607ffevICeyRPfVTRDTP` | `a18768e6-13ee-4e7b-bbef-2953abad5e3e` | Timed out at 12:07:34.938 UTC; 9 run calls, all string input arguments; cost 0 |
| One allowed follow-up | `mcp-retry-20260913` / `ses_f65537b8dffe6yRvCCbOrNFsJY` | `c2a71b3b-fdaf-4a51-8167-0ba86a228868` | Timed out at 12:13:50.243 UTC; 14 run calls, 13 string arguments and one missing input; cost 0 |

The second attempt reused the same server source snapshot and original
natural-language task. It additionally received the first attempt's exact failed
argument values/types, error messages, and an explicit example of supplying an
object as the `foundry_run.input` argument. This is recorded evaluator assistance.
No workflow solution or manually edited candidate was supplied. The allowed
two-session model budget was exhausted; no third model session was launched.

Both sessions successfully loaded the native `workflow-foundry` skill and used
actual MCP calls to obtain design context, validate a workflow, propose it and
apply the proposal. The first also loaded `runtime-native` via the native skill
tool. The saved requests reached `applied`. Attempts to read outside the narrowly
allowed paths or use unapproved resource tools were denied and retained in the
exports. Transient free-provider endpoint errors also occurred.

Every string-valued run attempt returned `SCHEMA_MISMATCH`, with the workflow
input schema reporting `must be object`. Omitting input produced the expected
missing-`values` error. The compact TUI rendered JSON-looking strings similarly
to objects; the exported tool arguments revealed the actual types. Model prose
about trying the proper format did not establish a corrected wire argument.

Exact receipts in each actual run directory:
`session-export-local.stdout.txt`, `manifest.json`, `transcript.ansi`,
`screen-final.txt`, `tui.process.json`, `foundry-state.stdout.txt` and
`mcp-integration-score.json`. The follow-up also contains exact diagnostic inputs
at `workspace/inputs/feedback.json`. Owned tmux servers were stopped after both
timeouts.

The strict integration scorer also emits missing-locator-dependent errors, such
as no locator-bound applied proposal or matching candidate. Those do not mean
that no proposal was applied: the raw MCP receipts and saved request state prove
application. They mean the complete final linkage required by the integration
oracle could not be established because the session never completed its output.
No execution task cases were counted as passed from those incomplete locators.

## Separate deterministic MCP argument control

Implementation: `mcp-argument-control.mjs`. Receipt:
`runs/mcp-wire-control-20260913/argument-control.json`.

The evaluator selected the first TUI's actual applied proposal and required deep
equality with the exact completed model MCP `foundry_propose` input. It copied
that candidate without changes into a new control workspace, used the same
verified server snapshot, and called the real MCP stdio protocol through the
installed SDK. The server ran in a separate network namespace without external
network access. This was **zero additional model calls**.

The candidate hash was
`785d2d4c5ea1a49a363e9203132adbd1cb115b6abfc57b3a51faae395f8a7653`.
The actual MCP `foundry_run` catalog declares its `input` property as `{}`; the
candidate's own input schema requires an object containing numeric `values`.

| Control argument | Observed server result | Independent check |
| --- | --- | --- |
| String `"{\"values\":[3,7,11]}"` | `SCHEMA_MISMATCH`, must be object | Passed rejection control |
| Object with `[3,7,11]` | Succeeded; artifact total 21, count 3 | Passed actual bytes/hash/event checks |
| Object with `[2,5]` | Succeeded; artifact total 7, count 2 | Passed actual bytes/hash/event checks |
| Object with `[]` | Succeeded; artifact total 0, count 0 | Passed actual bytes/hash/event checks |
| Object with `[1,"2"]` | `SCHEMA_MISMATCH`, second value must be number | Passed rejection control |

The three valid runs were independently inspected through actual MCP. The oracle
verified their saved workflow hash, complete event hash chain and checkpoint head,
one actual artifact completion, exact artifact name, byte count and SHA-256,
and parsed JSON values. Unit controls in `tests/evaluation-mcp.test.mjs` reject
self-attestation, wrong hashes/bytes, missing effects and truncated events.

These **5/5 local controls** show that the unchanged model candidate and MCP
server process correctly typed inputs. They do not identify whether the TUI's
strings arose from model choices or a client/provider schema-conversion layer;
raw provider-facing schema/argument evidence would be needed for that attribution.
The unconstrained MCP property is an interface detail to investigate, not proof
of a particular adapter bug. Automatic parsing or weakening the workflow schema
was not introduced into the host to make this test pass.

## Qualification boundary

Installed native skills and a substantial part of the real MCP workflow were
exercised successfully. Complete model-driven execution through this OpenCode
TUI/tool interface remains unqualified. The deterministic argument control,
the separate noninteractive provider bridge and the SRE host-enforcement results
remain separately labeled evidence. No failed TUI attempt is replaced by a
headless generation, a manually authored workflow or an evaluator-written result.
