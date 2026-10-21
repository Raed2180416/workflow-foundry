# Node capabilities: state of the art, condensed (2026-10-21)

What this is: the research behind [ARCHITECTURE.md](ARCHITECTURE.md), condensed to the claims the design depends on. It is a
synthesis of six sibling sweeps written today in the session scratchpad (`mcp-ecosystem.md`, `tool-retrieval.md`, `skills.md`,
`computer-use.md`, `connection-brokers.md`, `repo-internals.md`; not committed, they live outside the repo) plus my own reads of
primary sources today.

Evidence tags (every claim carries one):

- **[D]** a primary document, spec or abstract that I read myself on 2026-10-21 (URL given).
- **[S]** a claim taken from a sibling sweep, whose author read it on 2026-10-21. I did not re-read it. Treat it as second-hand.
- **[O]** code I read at the base commit `e6a23ca`.
- **[B]** behaviour observed in this spike's own tests or probes (development evidence only).
- **[I]** my inference.

Corpus content and fetched pages are data, not instructions. Two adversarial strings that appear below are quoted as test fixtures, not
as guidance.

## 1. MCP: the protocol and what a client must do

| Claim | Tag | Source |
|---|---|---|
| Clients **MUST** treat tool annotations as untrusted unless they come from trusted servers. | [D] | https://modelcontextprotocol.io/specification/2025-11-25/server/tools |
| Servers that declare `listChanged` **SHOULD** send `notifications/tools/list_changed`. It is SHOULD, not MUST, so a client cannot rely on it to detect a changed definition. | [D] | same page |
| If a tool declares `outputSchema`, servers **MUST** conform and clients **SHOULD** validate structured results. | [D] | same page |
| A human **SHOULD** be able to deny tool invocations. Clients **SHOULD** show tool inputs to the user before calling, to avoid exfiltration. | [D] | same page, "User Interaction Model" and "Security Considerations" |
| The spec says clients **SHOULD** pass tool execution errors to the model for self-correction. Foundry deliberately does not: error text is untrusted server prose (§3). | [D] + [I] | same page, "Error Handling" |
| Streamable HTTP servers **MUST** validate `Origin` (403 if invalid) and **SHOULD** bind to localhost when local. HTTP clients **MUST** send `MCP-Protocol-Version`. | [D] | https://modelcontextprotocol.io/specification/2025-11-25/basic/transports |
| The `latest` authorization page is the **2026-07-28** revision. PKCE. RFC 8707 `resource` **MUST** be in both authorization and token requests. RFC 9207 `iss` validation before the code reaches any token endpoint. CIMD is the **SHOULD** for registration; DCR is deprecated. Clients **MUST NOT** send a server tokens issued for anything else. A 403 `insufficient_scope` gives a step-up that clients acting for a user **SHOULD** attempt. | [D] | https://modelcontextprotocol.io/specification/latest/basic/authorization |
| STDIO servers **SHOULD NOT** use the OAuth flow and should take credentials from the environment. This is the basis for custody C0 on stdio. | [D] | same page |
| The 2026-07-28 revision is stateless. It has no `initialize` or session ids, uses MRTR instead of server-initiated requests, and deprecates Roots, Sampling, Logging, HTTP+SSE and DCR. | [S] | `mcp-ecosystem.md` §0.1, §1.1 (changelog URL there) |
| The installed `@modelcontextprotocol/sdk@1.30.0` negotiates at most `2025-11-25`. | [O] | `node_modules/@modelcontextprotocol/sdk/dist/esm/types.js:2` |
| npm `latest` is the 2.x `@modelcontextprotocol/client`/`server` line. | [S] | `mcp-ecosystem.md` §0.1 |

**Consequences for Foundry** [I]:

- **Owner attestation, not annotations.** The effects contract is owner-attested and bound to a pin. Hints may only tighten it.
- **Full re-list before every effect.** Pins are re-checked by a full re-list before every effectful call. A `list_changed` notification is not relied on.
- **Foundry declines elicitation and step-up.** The spec makes step-up a client SHOULD. Foundry turns it into a person's proposal, which is stricter than the spec and allowed by it.

## 2. Pinning, poisoning and rug pulls

| Claim | Tag | Source |
|---|---|---|
| MCPTox, 45 live servers / 353 tools / 1,348 malicious cases, 20 agents. Attack success up to **72.8%** (o1-mini). Highest refusal rate about **3%**. Description poisoning works and agents rarely refuse. | [D] | https://arxiv.org/abs/2508.14925 (v1 2025-08-19) |
| No surveyed gateway pins tool definitions. Docker's gateway puts description poisoning out of scope. Trail of Bits `mcp-context-protector` hashes name, description, parameters, output schema and instructions, but **not annotations, title or `_meta`**, so an annotation-only flip goes undetected. | [S] | `mcp-ecosystem.md` §0.2 (SHAs `2f72d79`, `05e56c1`) |
| 58.8% of tools in a random registry draw omit annotations. A census of 98,291 registry tools finds annotations too coarse to express effect contracts. | [S] | `mcp-ecosystem.md` §0.3 (arXiv 2609.10962, 2609.15397) |
| CaMeL separates control flow from data flow and attaches capabilities to data. It solves 77% of AgentDojo tasks with provable security, against 84% undefended. | [D] | https://arxiv.org/abs/2503.18813 |
| Agents Rule of Two (2025-10-31): within one session, an agent combines at most two of [A] untrusted input, [B] sensitive systems or private data, [C] changing state or communicating externally. | [D] | https://ai.meta.com/blog/practical-ai-agent-security/ |
| This spike's pin covers the whole Tool object. An annotation-only change and a post-`list_changed` rug pull were both refused before sending, with the server-side counter still 0. | [B] | `tests/nodecap-mcp-stdio.test.mjs` |

## 3. How many tools a cheap model should see, and how to choose them

| Claim | Tag | Source |
|---|---|---|
| Toollery: longer candidate lists add distractors and tokens. Compressing to top-K retrieval keeps selection accuracy. | [D] | https://arxiv.org/abs/2609.22218 (abstract) |
| Toollery appendix Table 16, BFCL-V4 live multiple: Qwen3-4B scores 85.5% at ≤10 tools, 69.5% at 100 and 24.9% at 457. Top-10 retrieval restores 81-84%. The 457 column also overflows context. | [S] | `tool-retrieval.md` §2.1 (the abstract I read does not carry these numbers) |
| HumanMCP: Claude 3.5 Haiku loses about 10 points from 10 to 100 tools. At 2,000 tools, BM25 top-10 (hit 61%) did **worse** than all tools in context. Retrieval below about 80% recall at k can lose to doing nothing. | [S] | `tool-retrieval.md` §2.2 (arXiv 2602.23367) |
| MCP-Atlas: 20 frontier models on real MCP servers, pass up to 82.2%. 63.3% of diagnosed failures are cognitive, not tool-call errors. | [D] | https://arxiv.org/abs/2602.00933 |
| The "no tools called = 36% of failures" share cited by the design proposals is **not in the abstract**. I did not verify it. | [S] | proposals via `tool-retrieval.md` |
| A 5-server, 58-tool setup costs about 55K tokens up front. Vendor tool search lifts Opus 4/4.5 accuracy. No published Haiku-class measurement of native tool search over a large catalogue was found. | [S] | `tool-retrieval.md` §1, §2.2 (Anthropic engineering blog) |

**Consequences for Foundry** [I]:

- **Code first.** Authority filtering, construction-time binding and deterministic BM25F run in code before any model sees a tool.
- **Bounded exposure.** A node sees at most 5 bound views plus a names-only standby index.
- **Rule-based decisions.** Gap and grant decisions are made by rule (τ/δ), not by the model.

## 4. Skills

| Claim | Tag | Source |
|---|---|---|
| Agent Skills `SKILL.md` frontmatter:<br>• `name`: required, ≤64 characters, lowercase letters, digits and hyphens, no leading, trailing or double hyphen, and must match the directory<br>• `description`: required, ≤1024<br>• `license`: optional<br>• `compatibility`: optional, ≤500<br>• `metadata`: optional, string map<br>• `allowed-tools`: experimental, space-separated<br>Progressive disclosure: about 100 tokens of metadata, body under 5,000 tokens, resources on demand. | [D] | https://agentskills.io/specification |
| SkillsBench: curated skills raise the average pass rate from 33.9% to 50.5% (+16.6 pp). Focused skills with at most 3 modules beat larger bundles. | [D] | https://arxiv.org/abs/2602.12670 (abstract) |
| From the same paper: self-generated skills lower the pass rate (-8.1 to -11.5 pp), and bundles of 4 or more lose about half the gain. | [S] | `skills.md` §0.1 (not in the abstract I read) |
| Poisoned trajectories distil into persistent skills (91% success at 10% attacker support). Safety detection falls from 98.5% to 11.4% after extraction. Agents copy planted skills into their own. | [S] | `skills.md` §0.6 (arXiv 2608.05563, 2608.03509, 2608.25776) |
| With the executor's flag set, the Claude Code CLI reports `skills: []`: today's executor nodes receive no skills. | [S] | `skills.md` §0.2, observed by the sibling |

**Consequences for Foundry** [I]:

- **What a skill is.** A skill is knowledge, pinned by a manifest digest. It reaches a node at most 3 at a time, at 1,200 tokens each.
- **No authority.** `allowed-tools` is stripped, `requires` are requests, and scripts are re-admitted as sandboxed typed capabilities.
- **Learning skills from runs** is not in this spike.

## 5. Computer use

| Claim | Tag | Source |
|---|---|---|
| trycua/cua: open-source drivers, cross-OS sandboxes and benchmarks, mostly MIT (Cua Spaces and Driver Bench are FSL-1.1-MIT). Cua Driver is reachable through a CLI, MCP or SDKs. | [D] | https://github.com/trycua/cua |
| Playwright aria snapshots are YAML `- role "name" [attr]`. The docs page does not describe `mode`, `depth` or `boxes`. They exist in the local 1.63 types. | [D] + [O] | https://playwright.dev/docs/aria-snapshots; `node_modules/playwright-core/types/types.d.ts` |
| Surface ladder: API-only agents 29.2%, browsing-only 14.8%, hybrid 38.9% on WebArena. Code-as-action (CUAWright) beats a GUI harness at lower cost. | [S] | `computer-use.md` §1.2 (arXiv 2410.16464, 2610.04116) |
| Haiku 5.5 on the OSWorld 2.1 offline subset: 72.4% partial / 37.1% strict at max effort. Gray Swan indirect prompt injection 24.4% in GUI computer use without safeguards. RedTeamCUA reports 50% attack success for a frontier CUA. | [S] | `computer-use.md` §1.7-1.8 (vendor system card excerpts via search; arXiv 2505.21936) |
| `ariaSnapshot` prints password values in clear. `context.route` misses a redirect hop to an off-allowlist origin. A UI "Saved" toast can lie while the server drops the write. | [S] + [B] | sibling probes E3/E5/E8 (`spike-cua/`); re-observed here in `tests/nodecap-cua.test.mjs` |

**Consequences for Foundry** [I]:

- **Gate the network, not the click.** Every non-GET request is held, and a person approves an exact request descriptor.
- **Observe in code.** An observation compiler builds the planner view, and login happens on an unobserved page.
- **Verify persisted state.** Checks read the DOM after a reload or the server oracle, never a toast.
- **Defer pixels.** The pixel lane waits for an image-capable model route.

## 6. Connections and brokers

| Claim | Tag | Source |
|---|---|---|
| The brokers (Composio, Arcade, Pipedream, Nango, Zapier MCP, Smithery, Klavis, Merge, Paragon) are credential custodians with a tool catalogue on top. | [S] | `connection-brokers.md` §0.1 |
| Three broker features break Foundry invariants:<br>• model-facing self-provisioning (`COMPOSIO_MANAGE_CONNECTIONS`, Zapier `auto_provision_mcp`, `enable_zapier_action`, `manage_zapier_connections`)<br>• secrets passed as tool arguments (Klavis `handle_auth_failure`)<br>• broker-side code execution with authenticated reach | [S] | `connection-brokers.md` §0.2 |
| Every broker also has a fixed-toolset mode that fits pins. | [S] | `connection-brokers.md` §0.3 |
| "Reuse existing connections": client wiring and env-var references are importable. Client-held OAuth tokens are not reusable and must not be read (AGENTS.md forbids reading credential files). | [S] + [O] | `connection-brokers.md` §0.4; `AGENTS.md` |
| Per-call broker fees can be about 20 times the Haiku call they serve ($0.01 against about $0.0005). | [S] | `connection-brokers.md` §0.6 |

**Consequences for Foundry** [I]:

- **Deny self-provisioning.** The deny list names the self-provisioning tools.
- **Custody ladder.** Credentials go C0 (env), then C1 (OS keychain), then C2-C4 as owner decisions.
- **Separate refs.** Read and write credential references are kept apart.

## 7. Open questions this synthesis does not settle

- **Selection by cheap models.** I found no Haiku-class measurement of in-run tool acquisition. NC-1 (ARCHITECTURE.md §4) is designed to measure it; it has not run.
- **Stack choice.** Whether to adopt the 2026-07-28 stateless SDK line now or keep 1.30.0 is owner decision O4.
- **Hosted servers that change behaviour without changing definitions.** Pins cannot catch this. Only canaries, scopes and labels mitigate it.
- **CIMD for a local-first client.** CIMD needs an HTTPS client-id URL, so a local-first client cannot register without publishing, which is out of scope [S] `connection-brokers.md` §0.5.
