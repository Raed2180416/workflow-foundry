# OpenCode 1.18.29: isolated free-provider TUI evaluation environment

## Provenance and inspection depth

Inspected locally on 2026-09-13. This dossier concerns the installed CLI and
observed behavior plus public documentation, not a source-code audit. The local
launcher `/home/raed/.local/bin/opencode` is a 40-byte shell wrapper forwarding to
`/usr/bin/opencode`, an x86-64 ELF executable. Both ordinary `--version` and the
sandboxed binary report **1.18.29**. The binary SHA-256 is preserved in
`evals/runs/smoke-20260913/manifest.json`; no upstream source commit has been
established for this installed artifact. Do not substitute a current upstream
commit for installed-binary provenance.

Public upstream documentation inspected through the web on 2026-09-13:

| Source | Inspected material and applicability |
| --- | --- |
| https://opencode.ai/docs/cli/ | Default TUI, model catalog/verbose metadata, export and debug commands; retrieved rendered lines 109–159, 493–525, 691–709. |
| https://opencode.ai/docs/config/ | Custom config supplements other config; provider allowlist; retrieved lines 283–313 and 1279–1330. |
| https://opencode.ai/docs/permissions/ | Last-match permission rules, file modification umbrella, external-directory checks; retrieved lines 167–207 and 282–297. |
| https://opencode.ai/docs/zen/ | Public free-model price rows, temporary availability, privacy terms; retrieved lines 193–223, 306–312 and 353–360. |

Documentation is mutable and may describe newer releases. Installed CLI help is
the authority for the flags actually exercised here. The local helper and
protocol are original research artifacts; no OpenCode source is redistributed.

## End-to-end trace

`evals/opencode-harness.mjs` prepares a new private run directory, captures CLI
metadata inside bubblewrap, checks the selected model's observed prices, launches
the default OpenCode TUI in a dedicated tmux server, and preserves its terminal
stream. The TUI receives a synthetic prompt and may write only `output.json`.
Its model messages and tool evidence are exported from the same isolated state
after the session. The evaluator inspects the resulting file independently.

Installed help explicitly distinguishes default `opencode [project]` (TUI) from
`opencode run` (noninteractive). This evaluation uses the former, with `--pure`,
`--model` and `--prompt`. Metadata inspection and export are CLI operations;
they are not counted as TUI model generations.

## Observed model catalog

The actual isolated CLI command `opencode models opencode --pure` listed:

| Exact ID | Observed input/output prices |
| --- | --- |
| `opencode/big-pickle` | 0 / 0 |
| `opencode/ling-3.0-flash-fin-free` | 0 / 0 |
| `opencode/mimo-v2.5-free` | 0 / 0 |
| `opencode/muse-spark-1.2-contributor-free` | 0 / 0 |
| `opencode/muse-spark-1.3-contributor-free` | 0 / 0 |
| `opencode/nemotron-3-ultra-free` | 0 / 0 |
| `opencode/nemotron-3.5-lightning-free` | 0 / 0 |

The verbose catalog additionally reported zero cache read/write prices and tool
calling capability for these entries. Source artifacts are
`evals/runs/smoke-20260913/models.stdout.txt` and `catalog.stdout.txt`, alongside
per-command UTC timestamps and exit results. A listing is not proof of successful
inference. Big Pickle subsequently completed the actual TUI smoke described below.
At that initial smoke checkpoint, the other six entries had not been exercised.
Ling was subsequently exercised through actual TUI sessions, as recorded below.
Big Pickle's backend size/revision is unknown. No Haiku access is assumed or used,
and no account login was attempted.

## Actual TUI smoke outcomes

Both attempts used the same synthetic prompt, model and 240-second wall limit.
No user steering or operator-authored output was supplied during either attempt.
The operator corrected the environment between attempts; this is infrastructure
assistance, not a model improvement or two independent success trials.

| Run / session | Observed result | Independent oracle |
| --- | --- | --- |
| `smoke-20260913` / `ses_f659d868effe9t6Dux7u68hgPb` | Four attempted tools were denied; the model truthfully reported that it could not create the file. | Failed: no file and no completed model write. |
| `smoke-pathfix-20260913` / `ses_f659b11f9ffeBhWQJNPznj62kN` | One completed write, final `DONE`, model reported cost 0. | Passed: exact JSON and exact bytes reconstructed from the completed tool input. |

The installed binary SHA-256 is
`cbe7cd781d4987e7224709a9ff6367b0c28b38bbbed05b40a1d434c33a9278a0`.
The corrected output SHA-256 is
`7bdfdf0ff7745f3fbd25b7051ea266f0740f75ad3b69d579e1db442b48ea3052`.
The corrected session reported 1,877 input tokens, 90 output tokens and 5,120 cache
read tokens; these are the provider/application's reported accounting, not an
independent measurement. The TUI displayed 14.0 seconds for its response. The
session completed on 2026-09-13 at approximately 10:51:55 UTC; its owned tmux/TUI
process was stopped at 10:52:06.765 UTC.

Exact local evidence: corrected run `session-export-local.stdout.txt` lines
102–127 records tool `write`, status `completed`, exact input content and tool
timestamps; lines 149–177 identify the final assistant and finish reason. The
same export lines 154–156 records working directory `/task` and root `/`.
`verdict.json` lines 1–37 records the independent result, costs and provenance
limits. `workspace/output.json` line 1 is the actual model-created 61-byte output.
Raw `transcript.ansi`, timestamped terminal screens and start manifest remain in
the ignored run directory. The first failure remains alongside the success.

The permission failure was caused by non-Git project paths being matched relative
to root `/`: narrow `task/output.json` and `task/*` rules were needed in addition
to absolute path rules. Merely seeing a tool name in a compact TUI screen did not
establish that the operation succeeded; the exported tool state exposed the error.

## Contracts and isolation

Observed tools: bubblewrap 0.12.0 and tmux 3.7c. The helper creates run directories
with mode 0700 and evidence files with mode 0600. The host home directory is not
mounted in the model process. Its original HOME pathname exists as an empty
sandbox directory; HOME is not repointed. Fresh XDG config, data, state and cache
live under that run's `state/` bind mount. Observed `debug paths` resolves these
to `/state/...`; no host auth file is read, printed or copied.

Only `/usr`, certificate/DNS files, the synthetic task directory and fresh state
are mounted. The configured provider allowlist is `opencode`; both main and
small-model selection are explicitly set to the observed zero-cost ID. Sharing,
updates, external plugins, LSP, formatters, shell, subagents, MCP and web tools
are disabled by minimal configuration and permission defaults. The configuration
file is mounted read-only. The TUI runs under a 240-second wall timeout; it has a
dedicated tmux socket and transcript, never the user's existing tmux session.

OpenCode created its own SDK/plugin package files in fresh isolated XDG state
during startup, despite external plugins being disabled. These are application
startup artifacts, not executed research-corpus installs or global/user config
changes. The captured dependency lock identifies those packages for later review.

The network namespace is shared so the free provider can be reached. This is not
a network egress allowlist or a proof against a malicious OpenCode binary. The
agent's file permissions are an additional layer inside the filesystem boundary,
not a replacement for it. No private repository is mounted or attached.

## Failures and falsifiers

Initial Core code-mode and worker-message calls failed because companion identity
was unavailable. Individual file/terminal calls succeeded; a later worker-message
retry succeeded. Serena's instructions tool returned `PLUGIN_DISABLED`, so no
Serena evidence can be claimed. No source index or unrelated repo was modified.

Potential failures under test include: missing credentials/free model outage,
TUI terminal initialization, free catalog/backend mismatch, permission-pattern
mismatch, incomplete tool response, output JSON mismatch, transcript gaps,
unknown budgets, and failure to stop owned processes. Preserve such failures as
failures. An operator-created output does not satisfy the TUI smoke oracle.

The companion comparison protocol is `evals/PROTOCOL.md`. It requires invalid
oracle probes, frozen outputs and common execution conditions. The smoke oracle
has eight passing evaluator-unit tests, including rejected denied-tool success,
operator-substituted bytes, stale hashes, extra prompts, mismatched models and
unsealed heldout labels. These unit fixtures are not model generations. No
comparative generation, execution parity or heldout success had been measured at
that initial smoke checkpoint. Later diagnostic comparisons are recorded below;
none are heldout qualification.

The CoS quality map found the project test directory and package manifest, with no
GitHub workflows or local Semgrep configuration. A full CoS security scan scoped
to `evals/` reported no Betterleaks findings; OSV returned `No package sources
found` (exit 128), so it did not establish a dependency pass. Trivy completed but
its returned package report was truncated; no comprehensive vulnerability-free
claim is made. No local Semgrep rules were available. Report:
`/home/raed/.local/state/cos-quality-gate/reports/20260913/162419-security-f3037913.json`.

## Comparison suitability

The free model completed a synthetic file-write task through the TUI. Its unknown
backend identity precludes claims about
parameter count or equivalence to Haiku. The Foundry IR and skills must be copied
as explicit approved synthetic evaluation inputs before comparative trials; the
whole repository is never exposed. Differences between baseline and treatment
must be limited to skill/domain context, with matching runtime/tools/limits.

## Extracted requirements

| ID | Requirement and evidence | Falsifier / cost |
| --- | --- | --- |
| opencode-01 | Discover actual zero-cost IDs from isolated CLI catalog. | Reject an absent/nonzero-price model; mutable provider metadata remains a limitation. |
| opencode-02 | Prove actual TUI use with raw stream, screen and session export. | Headless-only or self-authored output must not count; terminal recording adds local storage. |
| opencode-03 | Keep user credentials/config and private repositories outside the mount boundary. | A task-side read of host private content would invalidate isolation; fresh state costs startup latency. |
| opencode-04 | Distinguish JSON construction from independently verified task effects. | No-op and self-attested success must fail the task oracle; real effect oracles require domain work. |
| opencode-05 | Account for all correction, reviewer and operator assistance. | Edited model outputs cannot retain an unassisted label; preserving revisions increases artifact count. |

## Later diagnostic comparisons and host-enforcement campaign

Updated on 2026-09-13 after the initial smoke. The old Big Pickle and Ling paired
generations, their correction trajectories and wrong-type failures remain in
their original `evals/runs/` directories. Passing the original eight-case set was
insufficient: the corrected Big Pickle skills artifact and old Ling skills
artifact each produced 21 false successes on the original wrong-type challenge.
The old Ling baseline's apparent malformed-input safety came with no successful
recovery and must not count as a useful system. The new campaign does not relabel
any old output or substitute newer runtime bytes into frozen old receipts.

`evals/SRE-CAMPAIGN.md` and `evals/SRE-RESULTS-20260913.md` describe the new
preregistered development campaign, frozen at 11:52:47.190 UTC. The unchanged
worker-2 evidence tests were replayed by worker-5 on the newer capability source:
55/55 passing with explicit author/runner attribution and stable hashes. The
campaign retained the original independent audit, replay and 60/60 evaluator
preflight, plus its complete runtime/schema/skill/catalog/AJV dependency snapshot.
This is execution of independent tests, not a new independent manual review.

Two actual isolated OpenCode 1.18.29 TUI generations used the observed free Ling
ID, with cost 0 and exact exported tool-write provenance:

| Construction | Primary execution | Same-artifact replay |
| --- | --- | --- |
| `sre-skills-r1-20260913`, 10 nodes, 53.9 s displayed | Default registry: 41/55, all 12 recoveries, 14 invalid-evidence effects/false successes | Host evidence wrapper: 55/55, zero such effects |
| `sre-host-r1-20260913`, 7 nodes, 50.9 s displayed | Host evidence wrapper: 55/55, all 12 recoveries and 43 fail-closed cases | Default registry: 34/55, 21 invalid-evidence effects/false successes |

The evaluator-owned `createEvidenceBoundFixtureRegistry` adds mandatory receipt
requirements to every remediation: exact metrics/deployment/logs probe args,
three actual typed booleans and maximum age 60 seconds. It leaves the default
registry intact. Each artifact is byte-identical across its two execution rows;
the change in admission behavior belongs to host enforcement, not better model
reasoning. The host condition passed its first-round early-stop criterion; no
additional host repair calls were consumed. Cases are exposed diagnostics with
overlap, not independent samples or heldout evidence.

The current-source campaign also exposes capabilities absent from historical
pairs, including `core.pluck`; comparisons across those campaigns have an
action-space/source confound. Backend revision and sampling seed remain unknown.
The optional noninteractive provider bridge is separate from every TUI result.

An additional real installed-skill/MCP protocol is defined in
`evals/MCP-TUI-PROTOCOL.md`. Its first actual TUI attempt loaded native installed
skills, generated a proposal and applied it through real MCP, but repeated
string-valued `foundry_run.input` arguments failed the candidate's object schema.
That session reached its 240-second timeout with cost 0 and no completed run or
output file. Its failure is preserved in
`evals/runs/mcp-installed-v2-20260913/mcp-integration-score.json`; discovery,
proposal application and model prose alone do not complete the integration.
The one allowed diagnostic follow-up received the observed argument-type errors
and an explicit object-argument example. It also timed out after 240 seconds:
13 run calls supplied strings and one omitted input; none completed. Both actual
TUI attempts reported cost 0, and both owned tmux servers were stopped. Their
complete integration remains unqualified.

A separate no-model, network-isolated MCP control reused the exact first
model-proposed workflow and unchanged server source. It passed five checks:
serialized JSON rejected, actual objects produced correct sample/changed/empty
artifacts with verified hash-chain receipts, and a nonnumeric input was rejected.
The real MCP server advertised `foundry_run.input` as `{}`. Correct SDK object
arguments succeeded, while exported TUI arguments were strings. Attribution to
the model or a client/provider schema conversion remains unresolved. The control
does not replace either failed TUI result. Details and all receipt paths appear
in `evals/MCP-TUI-RESULTS-20260913.md`.

The later source-only quality receipt at
`evals/runs/quality-current-20260913/` reports no secret matches, no Trivy
vulnerabilities among 93 production packages, and no OSV vulnerabilities among
95 explicitly scanned lockfile packages. Initial OSV directory discovery failed
and is preserved. The full repository suite at that checkpoint was 275 passed,
one unrelated installed-skill packaging failure and two skipped; doctor passed.
These results do not remove the recorded old failures or qualify unscanned
generated artifacts. Serena remained unavailable.
