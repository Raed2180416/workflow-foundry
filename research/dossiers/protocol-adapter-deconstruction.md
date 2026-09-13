# Protocol and adapter source deconstruction

Inspection date: **2026-09-13**. Auditor: **worker-7**. Scope: four existing inert
checkouts in `/home/raed/Projects/workflow-foundry/corpus/`. This is representative
source inspection, with **44 cited spans across 25 files**. It closes the four
zero-citation gaps in the earlier source inventory. It does not turn the four
repositories into completely audited systems.

All four HEADs matched the requested revisions and had clean tracked files before
inspection. The evidence manifest records full-file and inclusive line-span
SHA-256 values, matching Git blob bytes, acquisition identities and pinned URLs.
No upstream module, installer, build, test, server or `get-env` tool was executed.
The twelve counterexamples below are proposed development checks, not observed
upstream failures or reproduced exploits. Only original evidence bookkeeping code
runs in this slice.

| Repository | Exact inspected revision | Recorded acquisition classification |
|---|---|---|
| `anomalyco/opencode` | `95daf90670b7c039c436c85537da5fbfe2205b41` | implementation |
| `langchain-ai/langchain-mcp-adapters` | `52a4535f3eb4b98f386836e4d9b8c4cadf99afca` | adapter |
| `modelcontextprotocol/typescript-sdk` | `b65426158ed9f29aea8ef3dc09ca22d7d9d6f970` | sdk |
| `modelcontextprotocol/servers` | `d73f99efbfd40c3aa1b61e88728b3d49fb52608f` | reference-servers |

Acquisition provenance remains in `research/manifests/opencode.json` and
`research/manifests/protocols.json`. Existing license-file hashes were checked;
their texts were not copied. The recorded SDK/reference-server root licensing
transition remains a separate redistribution question. Neither a package's
license field nor this source inspection selects a project license.

## 1. OpenCode: catalog, schema, permission, dispatch and returned evidence

This trace follows ordinary MCP tools through the AI SDK path. The early
experimental-code-mode return and the separate native LLM execution route mean
this trace must not be described as every OpenCode execution path.

**Observed catalog behavior.** Connection setup checks the remote tools
capability, loads definitions, and closes the client when discovery fails.
Listing is paginated with a 1,000-page bound and repeated-cursor rejection. A
selected output-schema validation failure triggers a second tools/list request
whose tolerant result schema omits `outputSchema`. This keeps a usable catalog in
that compatibility case; it does not establish semantic validity of later tool
outputs. `defs` can return no result after an error, and the connection caller
converts that absence into failure.

The connected catalog caches definitions. A successful tool-list change replaces
them; a failed refresh returns while retaining the old definitions. Closing the
connection removes the cached client, definitions and instructions. Exposed names
combine sanitized server and tool names. The map assignment has no collision check
in the inspected loop. **Inference:** two different identifiers that normalize to
the same key can overwrite an earlier mapping there. This is a local consequence
of the mapping, not an executed upstream collision reproduction. It motivates
explicit collision rejection and catalog revision binding in Foundry.

**Observed schema and dispatch behavior.** `convertTool` overlays an object type,
an explicit properties map and `additionalProperties: false` on the advertised
MCP input schema. Session tool construction then passes that schema through
`ProviderTransform.schema`. The permission context merges agent and session rules
and carries session/message/call identity. The ordinary MCP wrapper runs the
trusted plugin-before hook, asks permission for the exposed tool name with `*`
patterns, and only then calls the underlying MCP execution function. The decision
uses the last matching wildcard rule, defaults to ask, rejects deny, or awaits a
deferred permission response. Visibility and a permission answer therefore have
concrete code paths, but this name/pattern request is not Foundry's exact
workflow/arguments/effect receipt. Plugin-before also precedes the permission ask;
it is trusted executable configuration, not an untrusted permission-free parser.

MCP invocation passes the original server-side name and `(args || {})`, using a
TypeScript cast rather than a general JSON-string decoding operation. It supplies
an abort signal, a progress callback and timeout reset on progress. The inspected
call does not set an independent maximum total timeout. An MCP `isError` result
becomes a JavaScript error assembled from text blocks. For a successful result
with no content blocks but present structured content, the wrapper supplies a text
serialization. Later projection extracts text, selected attachments and
truncation metadata. A returned text block or successful wrapper call still needs
the external task's own correctness check.

**Schema lowering does not identify the Ling failure's cause.** The inspected
OpenAI sanitizer keeps a subset of JSON Schema keywords. Boolean schemas become
string schemas; numeric bound keywords can influence inferred type without being
retained as constraints. An empty schema `{}` remains `{}` at line 1554. This
sanitizer is selected specifically for `model.api.npm` equal to `@ai-sdk/openai` or
`@ai-sdk/azure`; a generic “OpenAI-compatible” label alone does not prove this
branch runs. Moonshot/Kimi handling is another explicit branch. The AI SDK tool
repair callback lowercases a matching tool name or redirects an invalid call to
an `invalid` tool with diagnostic JSON. That diagnostic serialization is not proof
that the original Foundry input was converted into a string by this callback.

`research/dossiers/opencode-environment.md` separately records installed OpenCode
1.18.29 behavior and the unresolved object-versus-string TUI result. The installed
binary has not been mapped to this checkout. Missing causal evidence includes its
exact provider package route, original and provider-sent schema bytes, raw
arguments, and any intervening transformation. No new model call was made here.

| Source portion | Pinned inspection evidence |
|---|---|
| `mcp/catalog.ts`: tolerant schema, pagination, conversion, naming and listing fallback | [OC-CATALOG](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/mcp/catalog.ts#L14-L40), [OC-CONVERT](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/mcp/catalog.ts#L42-L82), [OC-NAMES-LIST](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/mcp/catalog.ts#L117-L168) |
| `mcp/index.ts`: discovery, refresh and exposed mappings | [OC-DISCOVER](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/mcp/index.ts#L372-L405), [OC-REFRESH](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/mcp/index.ts#L442-L471), [OC-NAMES](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/mcp/index.ts#L661-L688) |
| `session/tools.ts`: context and ordinary MCP execution | [OC-CONTEXT](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/session/tools.ts#L59-L90), [OC-DISPATCH](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/session/tools.ts#L388-L489) |
| `permission/index.ts`: matching and permission admission | [OC-PERMISSION](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/permission/index.ts#L28-L107) |
| `provider/transform.ts`: selected schema transformations | [OC-SCHEMA](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/provider/transform.ts#L1472-L1602) |
| `session/llm.ts`: AI SDK invocation and repair callback | [OC-REPAIR](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/session/llm.ts#L271-L324) |

## 2. LangChain MCP adapter: discovery is not a retained session

**Observed lifetime.** `get_tools` passes `session=None` with connection
configuration. `load_mcp_tools` opens a temporary session for initialization and
catalog discovery, exits that context, then builds tools retaining the original
`None` session and connection. Each subsequent invocation opens and initializes a
new session around its actual `call_tool`. An explicit `client.session(...)`
instead yields a live session; tools constructed from it reuse that session and
must be invoked before its context exits. With stdio, creating a session delegates
to a new Python MCP `stdio_client` context, making subprocess lifetime an explicit
dependency boundary. The Python SDK's implementation was not inspected in this
four-repository slice.

**Inference:** a reserve/commit sequence relying solely on one server process's
memory cannot assume that default tools share that memory. A durable remote
backend can preserve state across sessions, so new sessions do not prove every
server loses state. Stateful workflows should declare the needed lifetime and
test it with a synthetic server. Discovery and dispatch also occur in different
sessions by default; the adapter's cached tool schema is not a freshness proof for
the next process or endpoint.

**Observed schema and interception.** The generated `StructuredTool` uses the
advertised `tool.inputSchema` as `args_schema`, preserves annotations and `_meta`
as metadata, and declares a content-and-artifact result format. The adapter itself
does not add a consent decision around dispatch in the inspected path. Configured
interceptors wrap the call, first interceptor outermost, and may modify requests
or return supported direct results. A server-name prefix is optional. Those
mechanisms are useful integration seams; metadata and tool naming do not replace
host-owned authority and schema enforcement.

**Observed error separation.** Temporary-session calls catch an ordinary call
exception and re-raise it after the context exits, explicitly preserving it across
the teardown workaround. Content conversion happens before checking `isError`.
Unsupported audio raises `NotImplementedError`; unknown content raises
`ValueError`. An MCP execution error becomes the dedicated
`_MCPToolExecutionError`, carrying converted blocks. The default error handler
handles that narrow subclass, supplies a placeholder only for empty error content,
and rethrows unrelated `ToolException` values. Successful `structuredContent`
becomes a separate artifact. Returning error content to an agent is not task
success, and transport/conversion exceptions must not be relabeled as model
reasoning failures. The documented `ToolMessage(status="error")` behavior also
depends on LangChain core, which is outside these selected adapter spans.

**Observed environment boundary.** Configured stdio environment values expand
`${VAR}` from the current process; absent variables remain literal and bare-dollar
syntax is left untouched. The result is passed into `StdioServerParameters` with
command, args, working directory and encoding. The session router validates
transport and required connection fields. Neither environment interpolation nor a
typed connection object is a filesystem sandbox or permission grant. Exact Python
SDK default inheritance must be checked against its own resolved implementation,
not inferred from the JavaScript SDK below.

| Source portion | Pinned inspection evidence |
|---|---|
| Tool enumeration, temporary discovery and execution closure | [LC-LIST](https://github.com/langchain-ai/langchain-mcp-adapters/blob/52a4535f3eb4b98f386836e4d9b8c4cadf99afca/langchain_mcp_adapters/tools.py#L320-L354), [LC-DISCOVERY](https://github.com/langchain-ai/langchain-mcp-adapters/blob/52a4535f3eb4b98f386836e4d9b8c4cadf99afca/langchain_mcp_adapters/tools.py#L539-L610), [LC-CALL](https://github.com/langchain-ai/langchain-mcp-adapters/blob/52a4535f3eb4b98f386836e4d9b8c4cadf99afca/langchain_mcp_adapters/tools.py#L395-L536) |
| Error typing, content conversion and interception | [LC-ERROR](https://github.com/langchain-ai/langchain-mcp-adapters/blob/52a4535f3eb4b98f386836e4d9b8c4cadf99afca/langchain_mcp_adapters/tools.py#L70-L158), [LC-CONTENT](https://github.com/langchain-ai/langchain-mcp-adapters/blob/52a4535f3eb4b98f386836e4d9b8c4cadf99afca/langchain_mcp_adapters/tools.py#L175-L283), [LC-INTERCEPT](https://github.com/langchain-ai/langchain-mcp-adapters/blob/52a4535f3eb4b98f386836e4d9b8c4cadf99afca/langchain_mcp_adapters/tools.py#L286-L317) |
| Explicit versus default client sessions | [LC-LIFETIME](https://github.com/langchain-ai/langchain-mcp-adapters/blob/52a4535f3eb4b98f386836e4d9b8c4cadf99afca/langchain_mcp_adapters/client.py#L128-L216) |
| Environment expansion, stdio construction and transport routing | [LC-ENV](https://github.com/langchain-ai/langchain-mcp-adapters/blob/52a4535f3eb4b98f386836e4d9b8c4cadf99afca/langchain_mcp_adapters/sessions.py#L35-L45), [LC-STDIO](https://github.com/langchain-ai/langchain-mcp-adapters/blob/52a4535f3eb4b98f386836e4d9b8c4cadf99afca/langchain_mcp_adapters/sessions.py#L212-L271), [LC-TRANSPORT](https://github.com/langchain-ai/langchain-mcp-adapters/blob/52a4535f3eb4b98f386836e4d9b8c4cadf99afca/langchain_mcp_adapters/sessions.py#L405-L477) |

## 3. TypeScript SDK: transport completion and effect completion differ

**Observed spawn and environment.** The acquired modular client identifies its
package as `@modelcontextprotocol/client` version `2.0.0`. Its stdio transport
spawns a command/argv without a shell, uses pipe stdin/stdout and configurable
stderr, and merges filtered default environment values with the supplied
environment object. Supplying `{}` therefore does not suppress the defaults.
On non-Windows hosts the listed defaults are HOME, LOGNAME, PATH, SHELL, TERM and
USER, omitting unset values and function-shaped values beginning with `()`.
The transport's process-start event resolves startup, not a completed MCP
handshake or authorized tool operation.

**Observed framing and errors.** `ReadBuffer` caps buffered bytes at ten MiB by
default before appending/parsing. It waits for a newline before UTF-8 decoding,
preserving characters split across transport chunks. It deliberately skips lines
whose parsing throws `SyntaxError`, such as non-JSON debug output, while valid
JSON that violates the message schema surfaces an error. Thus “strictly reject
every stdout line that is not JSON” is not this upstream implementation's
contract. Oversize append errors close the client/server transport path; ordinary
per-message errors are reported through `onerror` while processing continues.
Server sends handle closed streams, errors and drain; transport closure removes
its own listeners and pauses stdin only when no other data listeners remain.

**Observed cancellation.** For stdio, outgoing cancellation sends a best-effort
`notifications/cancelled` and rejects the local promise; initialization has a
special no-wire-cancel exception. The modern per-request HTTP branch uses stream
abort instead. Incoming cancellation aborts the controller attached to the
matching request. Handlers receive that signal and the protocol suppresses later
success/error replies after abort. Transport-close handling also settles pending
requests, clears timers and aborts handler controllers. These mechanisms communicate
and contain protocol state. **Inference:** an implementation that ignores its
signal can still have external effects, so rejection and suppressed replies
cannot qualify physical stop, rollback or absence of a committed write.

**Observed teardown distinction.** Public client `close()` ends stdin, waits in a
two-second race, sends SIGTERM when the child has no exit code, waits in another
two-second race and can send SIGKILL. The inspected method does not await a final
post-SIGKILL exit and does not establish process-group termination. A distinct
private `_dispose()` used for disposable negotiation probes waits for `exit` and
destroys parent pipe handles. Its stronger cleanup sequence must not be silently
attributed to public `close()`. A fake child with a pipe-holding helper is a useful
future teardown counterexample; no such upstream experiment was run here.

| Source portion | Pinned inspection evidence |
|---|---|
| Client default environment and spawn/event wiring | [SDK-ENV](https://github.com/modelcontextprotocol/typescript-sdk/blob/b65426158ed9f29aea8ef3dc09ca22d7d9d6f970/packages/client/src/client/stdio.ts#L54-L177) |
| Client parse errors, private disposal, public close and send | [SDK-CLOSE](https://github.com/modelcontextprotocol/typescript-sdk/blob/b65426158ed9f29aea8ef3dc09ca22d7d9d6f970/packages/client/src/client/stdio.ts#L204-L329) |
| Server transport events, close and send | [SDK-SERVER](https://github.com/modelcontextprotocol/typescript-sdk/blob/b65426158ed9f29aea8ef3dc09ca22d7d9d6f970/packages/server/src/server/stdio.ts#L44-L154) |
| Shared stdio framing and bounded buffer | [SDK-FRAMING](https://github.com/modelcontextprotocol/typescript-sdk/blob/b65426158ed9f29aea8ef3dc09ca22d7d9d6f970/packages/core-internal/src/shared/stdio.ts#L4-L62) |
| Cancellation/timeout reset and transport-close protocol state | [SDK-CANCEL](https://github.com/modelcontextprotocol/typescript-sdk/blob/b65426158ed9f29aea8ef3dc09ca22d7d9d6f970/packages/core-internal/src/shared/protocol.ts#L726-L769), [SDK-TRANSPORT](https://github.com/modelcontextprotocol/typescript-sdk/blob/b65426158ed9f29aea8ef3dc09ca22d7d9d6f970/packages/core-internal/src/shared/protocol.ts#L780-L855) |
| Handler cancellation, error/reply path and outgoing requests | [SDK-HANDLER](https://github.com/modelcontextprotocol/typescript-sdk/blob/b65426158ed9f29aea8ef3dc09ca22d7d9d6f970/packages/core-internal/src/shared/protocol.ts#L1044-L1161), [SDK-REQUEST](https://github.com/modelcontextprotocol/typescript-sdk/blob/b65426158ed9f29aea8ef3dc09ca22d7d9d6f970/packages/core-internal/src/shared/protocol.ts#L1373-L1588) |
| Modular package identity and exports | [SDK-VERSION](https://github.com/modelcontextprotocol/typescript-sdk/blob/b65426158ed9f29aea8ef3dc09ca22d7d9d6f970/packages/client/package.json#L1-L41) |

### Separate installed-package and Foundry evidence

The locally installed package is **`@modelcontextprotocol/sdk` 1.30.0**, not the
modular package above. Direct read/hash verification confirms that
`node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js` has SHA-256:

```text
298514feae7875117a119a2598b40f2346ef07c30152fa7ad2ffb6cfb51782bc
```

Its lines 65–75 independently show the default-environment merge. The manifest
captures this as `INSTALLED-SDK-ENV`, outside the four-clone coverage counts.
Prime-owned `src/components.mjs`, observed lines 55–110, blanks default inherited
keys before restoring PATH and explicitly allowed values, drains stderr, and
rejects ambiguous catalogs. Empty values are not the same as absent keys, and
environment restriction does not remove the child's ordinary OS access.

Prime reported four passing `tests/components-environment.test.mjs` controls.
This slice read that test source and observed its synthetic key-presence output,
allowlist, noisy-stderr and duplicate/cursor assertions. It did not rerun them or
execute an upstream environment-dump tool. The report attribution is retained as
prime-reported runtime evidence; this worker's added evidence is static byte/span
inspection. A later change to the local component file is recorded as context
drift rather than rewriting this observation or the pinned upstream record.

## 4. Reference servers: root authority, write claims and debug disclosure

**Observed filesystem validation.** CLI roots are normalized, resolved and
filtered for accessible directories. Relative paths resolve against allowed
directories. Path admission rejects empty/NUL inputs and requires equality or a
directory-separator containment boundary, avoiding a simple sibling-prefix match.
The main validator checks lexical containment and the resolved real path,
rejects Windows drive syntax on POSIX, and handles missing/Unicode-equivalent
components with ambiguity and containment checks. Tilde expansion uses the server
process home. These are concrete checks, not a proof of every platform/path race.

**Observed root updates.** Validated nonempty client roots replace the allowed
directory set. The root helper verifies path decoding, realpath and directory
existence; it does not intersect the requested roots with the original CLI set.
An empty or invalid replacement leaves the old set in place. **Inference:** a
deployment treating CLI roots as an immutable authority ceiling or an empty list
as revocation needs an additional contract. The observed behavior may be
intentional for a trusted client; it is not presented as an exploited
vulnerability. Client ownership of root updates must be stated explicitly.

**Observed writes and partial reads.** `write_file` accepts string path/content,
validates the path, awaits the write helper, then returns success text in both
content forms. New targets use exclusive creation. Existing targets use a random
sibling temporary file and rename, cleaning up on failure and attempting to
restore original permission bits. The helper lacks content-hash CAS and fsync;
permission restoration failure is intentionally ignored after the write. Leaf
replacement protection must not be described as a full ancestor-race or crash-
durability guarantee. A concurrent directory replacement between validation and
write remains a proposed isolated test, not a reproduced failure here.

`read_multiple_files` catches each failed read and embeds its error in a combined
string, returning normal content and structured content without top-level
`isError`. **Inference:** a consumer checking only the protocol envelope can mark
a partially fulfilled multi-file task successful. Required-file completeness and
per-item outcomes need their own acceptance rule. The filesystem package manifest
declares `@modelcontextprotocol/sdk ^1.30.0`; that range does not identify a resolved
runtime and does not connect these handlers to modular upstream SDK 2.0.0.

**Observed everything/get-env trace.** The launcher defaults to stdio; its stdio
entrypoint constructs the server and connects it. The factory registers default
tools before initialization, including `get-env` unconditionally. Capability-
conditional tools are registered separately. `get-env` takes an empty schema and
serializes the entire server `process.env` into a text block. It is annotated
read-only, non-destructive, idempotent and closed-world; the callback has no
filtering of values. Those annotations describe different properties from
confidentiality. A host should select capabilities and restrict the effective
child environment independently of whether a tool mutates state. The tool was
never called, and no actual host environment values were collected.

| Source portion | Pinned inspection evidence |
|---|---|
| Relative/canonical/Unicode path admission and write helper | [FS-PATH](https://github.com/modelcontextprotocol/servers/blob/d73f99efbfd40c3aa1b61e88728b3d49fb52608f/src/filesystem/lib.ts#L76-L184), [FS-WRITE](https://github.com/modelcontextprotocol/servers/blob/d73f99efbfd40c3aa1b61e88728b3d49fb52608f/src/filesystem/lib.ts#L205-L237) |
| CLI roots and multi-read/write handlers | [FS-START](https://github.com/modelcontextprotocol/servers/blob/d73f99efbfd40c3aa1b61e88728b3d49fb52608f/src/filesystem/index.ts#L32-L94), [FS-MULTI-WRITE](https://github.com/modelcontextprotocol/servers/blob/d73f99efbfd40c3aa1b61e88728b3d49fb52608f/src/filesystem/index.ts#L319-L382) |
| Root replacement and root path validation | [FS-ROOTS](https://github.com/modelcontextprotocol/servers/blob/d73f99efbfd40c3aa1b61e88728b3d49fb52608f/src/filesystem/index.ts#L724-L786), [FS-ROOTVALID](https://github.com/modelcontextprotocol/servers/blob/d73f99efbfd40c3aa1b61e88728b3d49fb52608f/src/filesystem/roots-utils.ts#L13-L77) |
| Containment and path normalization/home expansion | [FS-CONTAIN](https://github.com/modelcontextprotocol/servers/blob/d73f99efbfd40c3aa1b61e88728b3d49fb52608f/src/filesystem/path-validation.ts#L11-L85), [FS-NORMALIZE](https://github.com/modelcontextprotocol/servers/blob/d73f99efbfd40c3aa1b61e88728b3d49fb52608f/src/filesystem/path-utils.ts#L39-L124) |
| Filesystem package/dependency declaration | [FS-VERSION](https://github.com/modelcontextprotocol/servers/blob/d73f99efbfd40c3aa1b61e88728b3d49fb52608f/src/filesystem/package.json#L1-L32) |
| Everything launcher and stdio entrypoint | [ALL-LAUNCH](https://github.com/modelcontextprotocol/servers/blob/d73f99efbfd40c3aa1b61e88728b3d49fb52608f/src/everything/index.ts#L1-L42), [ALL-STDIO](https://github.com/modelcontextprotocol/servers/blob/d73f99efbfd40c3aa1b61e88728b3d49fb52608f/src/everything/transports/stdio.ts#L1-L33) |
| Everything factory and default/conditional tool registration | [ALL-REGISTER](https://github.com/modelcontextprotocol/servers/blob/d73f99efbfd40c3aa1b61e88728b3d49fb52608f/src/everything/server/index.ts#L35-L104), [ALL-TOOLS](https://github.com/modelcontextprotocol/servers/blob/d73f99efbfd40c3aa1b61e88728b3d49fb52608f/src/everything/tools/index.ts#L22-L55) |
| Environment-dump callback and annotations | [ALL-ENV](https://github.com/modelcontextprotocol/servers/blob/d73f99efbfd40c3aa1b61e88728b3d49fb52608f/src/everything/tools/get-env.ts#L1-L39) |

## Requirements and unexecuted counterexamples

The evidence manifest contains twelve numbered requirements, each linked to the
source IDs above and an explicit `proposed-not-run` status. They call for schema
transformation identities (`PA-01`), unambiguous/fresh catalogs (`PA-02`), host-owned
effect admission (`PA-03`), declared session lifetime (`PA-04`), typed failure and
partial-output accounting (`PA-05`), effective environment enforcement (`PA-06`),
total deadlines and effect reconciliation (`PA-07`), bounded transport behavior
(`PA-08`), explicit root replacement/revocation authority (`PA-09`), separate path,
race, conflict and durability guarantees (`PA-10`), confidentiality review beyond
effect annotations (`PA-11`), and exact installed-version binding (`PA-12`).

Useful development fixtures include two tool names that sanitize identically; a
stateful two-call server; a combined read response with one missing required
file; an operation that ignores cancellation; an empty roots update; and a
read-only tool returning a synthetic secret marker. These are causal questions
with observable outcomes. No pass rate, model gain or runtime qualification is
assigned to them before execution. Existing prime-owned fixes and tests are
referenced separately rather than credited to this inspection.

## Coverage and reproducibility

The new spans comprise OpenCode **11 spans / 6 files**, LangChain adapters
**10 / 3**, modular SDK **9 / 5**, and reference servers **14 / 11**. The exact
union with the preserved earlier receipt is **196 spans / 135 files / 48
repositories**. These are distinct revision/path/range and revision/path counts,
not summed non-overlapping lines, implementation-only files or a percentage of
fully audited code. Package metadata spans are included and labeled as such.

The original `docs/SOURCE-COVERAGE.md` snapshot is preserved as its first 10,866
bytes, SHA-256 `aee1927b31d6d6bcea9bbc3b727709086d606df048e92820916780f275fb1659`.
Its 152/110/44 counts and four zero rows remain historical. The frozen baseline is
`evals/runs/packaging-evidence-KLljV4/source-coverage.json`, whose digest is recorded
in the manifest. The current packaging coverage script still enumerates its old
dossier list; a new package test will not automatically add these citations.
No packaging code was edited in this research slice.

After the one-time reviewed byte capture, repeat the read-only check with:

```sh
node research/verify-protocol-adapter-evidence.mjs
```

The verifier checks each cited file against its pinned Git blob, whole-file and
line-span hashes, exact dossier reference, acquisition identity, historical-prefix
preservation, installed SDK identity and coverage union. Five finite bookkeeping
negative controls reject duplicate IDs, unsafe paths, out-of-range spans, unequal
byte identities and missing requirement references. These are tests of evidence
bookkeeping only. The verifier never imports a corpus file and reports
`runtimeQualified: false`.

Serena activation for the exact active project returned `PLUGIN_DISABLED`.
No Serena/CodeGraph semantic validation, upstream behavioral replication,
process-tree termination proof, complete license audit, model-performance claim
or commercial-equivalence claim follows from this record. The later archive gate
against current main-source changes remains a separate integration task.
