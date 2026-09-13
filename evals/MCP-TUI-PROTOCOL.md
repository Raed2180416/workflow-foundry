# Actual installed-skill and MCP TUI integration

Preregistered diagnostic transport test, separate from SRE construction trials.
One initial actual OpenCode TUI session has a 240-second wall ceiling, using the
actual isolated catalog's zero-price `opencode/ling-3.0-flash-fin-free`. At most
one further session may address a recorded integration failure; retain both.
No headless model generation substitutes for either session. No cost, model,
task-quality or safety results are pooled with historical or SRE conditions.

Copy the reviewed Foundry CLI, relevant implementation files, workflow schema
and four selected Markdown skill packages into a read-only server snapshot.
Bind already-installed public Node dependencies read-only; record package/lock
hashes and dependency mount. No corpus code, host home, host credentials, shell
tool or external MCP service is available. Use fresh XDG state and 0700/0600
workspace files. The local server executes the real unmodified Foundry MCP
implementation. This integration uses its default registry; the evaluator's SRE
host profile is a separately reported treatment.

Run the real `foundry install --client opencode --no-hooks` against the isolated
workspace, preserving its journal. Grant the native skill tool access to the
selected installed skills and grant the local Foundry MCP tools access to this
synthetic workspace only. Preserve the install-produced MCP command. Native
skill loading and actual MCP calls must be present in the exported TUI session;
filesystem presence or a CLI discovery listing alone does not qualify.

Seed exactly one natural-language request through the real Foundry CLI, without
a workflow or candidate template. It requests reusable numeric rollup behavior:
an input array of numbers produces an actual JSON artifact with total and count;
empty input works, malformed input fails. The architect obtains the request and
native design context through MCP, constructs its own workflow, validates,
proposes, applies, runs a sample, and inspects its real receipt. The final summary
file is only a locator, not the execution oracle.

Evidence gates: exact prompt/model/session/cost and model file-write provenance;
a successful native skill load; successful actual MCP design-context, validate,
propose, apply, run and inspect calls; exact equality between the model's
submitted proposal and the persisted candidate; a consumed request, immutable
saved version and corresponding proposal/run records. Independent evaluation
then invokes the same saved program on `[2,5]`, `[]`, and `[1,"2"]`, inspecting
artifact bytes and verified event records. Require totals 7/count2 and 0/count0,
and no successful completion on malformed input. Constant self-attestation,
summary-only output, wrong or missing artifact content, corrupted history, a
different saved program, or absent MCP/native skill evidence fails the test.

Record task staging, installer/config changes, every extra message, model edits,
all errors, elapsed times and retries. No manual workflow correction is allowed.
The result establishes only this bounded installed-client/MCP workflow path.
It does not qualify the separate automatic provider bridge, project hooks,
production incident remediation, arbitrary tools or independent generalization.

Official references checked on 2026-09-13: OpenCode MCP server documentation
(`https://opencode.ai/docs/mcp-servers/`, local command/config and tool prefix);
Agent Skills documentation (`https://opencode.ai/docs/skills/`, `.agents/skills`
and native skill permissions); CLI documentation
(`https://opencode.ai/docs/cli/`, `--pure` disables external plugins). Actual CLI
discovery and session receipts remain the evidence for this installed version.
