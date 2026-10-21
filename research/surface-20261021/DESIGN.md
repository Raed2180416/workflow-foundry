# DESIGN: the product surface for Foundry (2026-10-21)

*Answers the owner's ask of 2026-10-21: "How do we hook this up? … a dashboard where they can view different flows, a chat interface
to create their own flows (BYOK / a subscription will cover the costs of Mercury 3), or something hooked into their preferred coding
agent through an MCP … seamless and super intuitive to even the dumbest human being on the planet." Grounded in
[TEARDOWN.md](TEARDOWN.md) (what the best products do, with sources) and a $0 spike under `app/` (§8). Development and design
evidence only: nothing here is a sealed or claim-bearing result. No model was called; no file under `src/`, `policy/`, `beds/` or
`experiments/` was changed (one proposed engine change is a patch file, §9).*

---

## 0. The answer in one paragraph

**All three, as three faces of one service, in this order: the MCP server first, the dashboard second, the chat third.** One
service (`FoundryApp` in the spike) owns the lifecycle *describe → proposal with checks → practice run → a person turns it on →
runs → each outside action asks → status in plain words → repair as a new version*. The MCP server lets any coding agent or chat
client drive that lifecycle, but never decide it. The dashboard is where a person sees flows, runs, failures and checks, and where
they say yes or no. The chat is a thin client of the same service for people without a coding agent, with Mercury 3 as the default
builder under token caps. Existing automations come in through importers that say exactly what they could and could not bring
over, or stay where they are and are called as typed tools ("wrap, don't replace"). The free/paid line sits where ATTACK-FABLE §4.1
put it: free while one person is the only authority, paid the moment a second person or a rule owner must approve.

---

## 1. Principles for "the least technical person" and the developer at once

The teardown's lessons (TEARDOWN §0) become eight rules. Each is enforced in code in the spike, or marked as not built.

| # | Rule | Why (teardown) | Spike |
|---|---|---|---|
| U1 | **Plain words first, details one click away.** Every status, check and failure has one sentence a person reads, and a code a developer can search. | Lesson 5 | built (`app/core/explain.mjs`) |
| U2 | **Ask only the questions whose wrong guess would do harm**: where data goes, who is contacted, what is irreversible or costs money. Everything else gets a visible default. At most three questions. | Lessons 1, 2; INTENT layer 4 "not wanted" (wrong-target first) | built (recipient only) |
| U3 | **Say what it will and will NOT do** before anything runs. | Lesson 1; Lindy's "outside impact waits" | built (`willDo`, `willNotDo`) |
| U4 | **Checks are the definition of done**: shown in plain words, run every time, and a "pass" means they held. | Lesson 1; repo history of false passes (README "Honest run verdicts") | built (acceptance + independent verify) |
| U5 | **Practice before live, on the exact version**: outside actions replaced by stand-ins, result bound to the version's hash. | Lesson 2 | built |
| U6 | **Only a person turns a version on, and each outside action asks again** (until standing approvals exist, §10). The model can propose and practise, never decide. | Lessons 3, 4 | built (activation + per-action approval) |
| U7 | **Nothing stops silently; nothing runs on an old approval; nothing is retried blindly.** | Lesson 5; engine's `uncertain` | built (engine) + version check (app) |
| U8 | **Bring what you have**: honest import reports; call the rest as it is. | Lessons 8, 9 | n8n prototype built |

---

## 2. One architecture

```
 FACES (thin, replaceable)            SERVICE (one place for the lifecycle)              ENGINE (src/, unchanged)
 ┌──────────────────────────┐         ┌───────────────────────────────────────┐          ┌──────────────────────────────┐
 │ MCP server (stdio; later │ tools   │ FoundryApp                            │          │ Foundry facade, Store        │
 │ HTTP) for Claude Code,   ├────────►│  propose  explain  dryRun             │ proposals│  (SQLite, CAS, hash chain)   │
 │ Codex, Cursor, chat apps │         │  requestApproval  decide* (person)    ├─────────►│ Runtime (approvals bound to  │
 ├──────────────────────────┤         │  run  status  list  inbox             │ runs     │  tool+args+hash, uncertain,  │
 │ Dashboard (loopback page)│ HTTP    │  import  wrap                         │          │  signals, timers, state)     │
 │  inbox, flows, runs,     ├────────►│                                       │          │ Validator + strict lint      │
 │  checks, versions        │ + token │ Builders: stub (now) | Mercury 3 /    │          │ Capability registry (host-   │
 ├──────────────────────────┤         │  Haiku 5.5 via ModelPort (next)       │          │  trusted contracts)          │
 │ Chat (web; later)        ├────────►│ Importers: n8n (prototype), GHA, ...  │          │ verify-run, anchors          │
 └──────────────────────────┘         │ Activation ledger (CAS, human channel)│          └──────────────────────────────┘
                                      └───────────────────────────────────────┘
 AUTHORITY: a decision enters only through a human channel: the dashboard (token in the page), a real terminal (`approve`), or the
 MCP client's own dialog (elicitation) behind a person-only tool. Paid Control Plane adds a second principal with its own identity.
```

**The lifecycle every face drives** (states of one flow version, identified by its hash):

```
draft ──dry_run passes──► practised ──approve (person)──► ON ──run_flow──► running ──outside action──► waiting for person
  ▲            │ fails          │ rejected                 │                  │                          │ yes / no
  │            ▼                ▼                          │ new version      ▼                          ▼
  └── propose (vN+1) ◄── repair / change request ◄── failed run          succeeded (checks held)    resumes / stopped
```

- **Version-bound proposals.** A proposal names the version it replaces (`baseHash`) and increments the version by exactly one;
  applying it is a compare-and-swap on the flow's head (engine: `Store.applyProposal`). Existing runs keep their program.
- **Execution authority outside the model.** The activation ledger (`app/core/ledger.mjs`) accepts decisions only with a human
  channel (`dashboard`, `cli`, `mcp-elicitation`); a decision is a compare-and-swap on the row's revision. Outside actions use the
  engine's own approval, bound to the exact tool, arguments and workflow hash, granted only as `actor: 'user'` and recorded in the
  hash chain (`src/runtime.mjs` approve). The MCP tool surface has no code path that decides either.
- **One record.** Runs are the engine's hash-chained journal; the dashboard reads it read-only through
  `tools/run-view/store-adapter.mjs`, re-verifying every link, and says "Record verified: N events".

---

## 3. (a) The MCP server

### 3.1 Tools (spike: seven, built)

Every result carries `say` (one or two sentences the agent relays as they are) plus typed fields; errors carry `problem: {code,
what, next}`. Input schemas are closed objects (`additionalProperties: false`) and validated before anything runs; a stringified
object where an object is expected is refused, not coerced (the lesson of `src/mcp.mjs` and its actual-TUI failures).

| Tool | Input (JSON Schema, abridged) | Returns | Model may | Notes |
|---|---|---|---|---|
| `propose_flow` | `{request: string ≤30000, answers?: {[id]: string}, flowId?: id}` | `status: needs_answers \| unsupported \| no_change \| proposed`; `questions[]` (id, question, why, answerSchema); or `proposalId, flowId, version, workflowHash, basedOn, changes, understood, willDo[], willNotDo[], summary{steps, checks, actions, limits}` | yes | Creates an agent-provenance request and a version-bound proposal. Nothing runs. Unknown intents: an honest refusal, nothing created. |
| `explain_flow` | `{proposalId? \| flowId?}` | `summary` (steps with effect class and "asks first", checks in plain and exact form, limits, assumptions, not-supported), dry-run and approval state | yes | Read-only. |
| `dry_run` | `{proposalId, practiceInput?: {weekOf, items[]}}` | `passed, headline, checks[{plain, exact, passed}], wouldDo[{action, to, subject, preview}], practiceRunId, workflowHash, practiceRegistryHash, liveRegistryHash, caveat` | yes | Exact proposed version staged by hash in its own store; practice registry (stand-in outbox). Recorded in the ledger. |
| `approve` | `{proposalId}` | `approved \| rejected \| awaiting_human` (+ `approvalId`, where the person approves) | **ask only** | Requires a passing dry run of the same hash. If the client supports elicitation, the person decides in the client's dialog; otherwise the person approves in the dashboard or terminal. Tool carries `_meta["anthropic/requiresUserInteraction"]: true`. |
| `run_flow` | `{flowId, input: {weekOf, items[]}}` | run status in words, pending approvals, checks, cost | yes | Refuses `NOT_APPROVED` and `STALE_APPROVAL` (head hash ≠ approved hash). Outside actions pause for the person. |
| `flow_status` | `{runId}` | `headline, progress, failedStep, problem{what, next}, pendingApprovals[], checks[], costUsd, timeline[]` | yes | Read-only. |
| `list_flows` | `{}` | `flows[{flowId, title, version, active, runs, lastRun}], proposals[], waitingForYou` | yes | Read-only. |

### 3.2 Tools the product adds after the spike (designed, not built)

| Tool | Purpose | Authority |
|---|---|---|
| `answer` | Give a paused human step its answer (engine `answer`) on behalf of the person who typed it in chat | relays the person's own words; forms compile from `answerSchema` (`tools/ui`) |
| `request_change` | "Make it also do X": a revision request bound to the current hash → `propose_flow` | model may |
| `repair_flow` | From a failed run: classify the failure, propose vN+1 with the same goal and checks (engine `requestRepair`) | model may propose; person approves |
| `rollback_flow` | Turn an earlier approved version back on | person only (same channel rules) |
| `import_flow` | n8n / GitHub Actions / Make / Airflow file → report + proposal when it lowers (§5) | model may |
| `wrap_flow` | Register an existing n8n/Zapier/HTTP automation as a typed, approval-gated capability | person approves the connection |
| `cancel_run` | Stop a run (engine `foundry cancel`) | model may (stopping is safe) |
| Kept flows as tools | Each approved flow appears as its own tool (`weekly_report_platform`) with its input schema | runs still need the approved hash |

Resources: `foundry://flows/<id>` (summary and checks), `foundry://runs/<id>` (status in words). Prompts: `/foundry:new-flow`,
`/foundry:why-did-it-fail` (Claude Code lists MCP prompts as slash commands [TEARDOWN 1.15]).

### 3.3 What the model can and cannot do (the contract the agent is told)

- **Can:** describe, ask the person the builder's questions, propose, explain, practise, ask for approval, run an approved version,
  read status, propose repairs, stop runs.
- **Cannot:** turn a version on, allow an outside action, change what a capability is allowed to do, change the checks of an
  applied version without a new proposal, read credentials, or see the dashboard key (the key goes to the browser, not to tool
  results; `app/cli.mjs mcp --dashboard`).
- **Honest boundary (§6.4):** an agent with a shell running as the same OS user can do anything the person can, including running
  the CLI. The MCP surface does not give it that power; the machine might.

### 3.4 MCP protocol choices

- **Small and task-level**: seven tools now, about twelve at most; Claude Code defers tool definitions behind tool search and cuts
  server instructions at 4,096 characters [TEARDOWN 1.15], so descriptions say when to use each tool in the first sentence.
- **Elicitation** for decisions the person must make (form mode now; URL mode for decisions that need the dashboard), with the
  person-only tool flag as a second gate in Claude Code. Codex documents per-tool `approval_mode` but not elicitation: there the
  fallback is the dashboard.
- **Transport**: stdio for local (spike); Streamable HTTP with OAuth for the hosted Control Plane later (n8n, Zapier and Gumloop all
  use OAuth for remote MCP [TEARDOWN 1.1, 1.2, 1.5]).
- **Migration of `src/mcp.mjs`** to the 2026-07-28 spec stays as ROADMAP §2.11 says; the product server should reuse it rather than
  fork it once the engine freeze allows (§9).

---

## 4. (b) The dashboard

### 4.1 Screens

| Screen | What the person sees | Built in spike |
|---|---|---|
| **Waiting for you** (inbox) | Cards: "Turn on ‘Weekly report for Platform’? (version 2)" with the goal, what changes from the version that is on now, the steps, "Done means" with practice-run ticks, and **Turn it on / No**; "Send the report to boss@… (asks you first)" with To, Subject and the exact text, **Send it / Don't send** | yes |
| **Your flows** | Title, On / Not turned on, version, number of runs, last result; drafts with "practice run passed; waiting for your OK" | yes |
| **Recent runs** | Flow, result in words ("Stopped: you said no to an action, so the run stopped before doing it"), when, "verified (22 events)" | yes |
| **Run** | Headline ("Finished. Every check in its definition of done passed."), failed step and what to do, progress, cost, model calls and tokens, "Done means" with ticks, "Record verified", timeline (seq, time, event, step), the honesty line | yes |
| **Versions and changes** | Each version and draft with its fingerprint, added / removed / changed steps (and which fields), whether the definition of done or the limits changed, which version is on | yes |
| **Cost** | Per run and per flow: dollars and tokens, the cap, who paid (BYOK or subscription) | per-run only |
| **Imports** | Per imported file: what came over, what could not (named reasons), what is wrapped | no |
| **Settings** | Model keys (BYOK), notification channel for approvals, the free/paid line | no |

Screenshots of the spike page (built by `app/dashboard/browser-check.mjs`, 0 console errors): `/var/tmp/foundry-work/surface-20261021/shots/`
(not committed: binaries).

### 4.2 Design rules

- Everything from the workspace is rendered as text (`textContent`), under a CSP with no inline script or style and `connect-src
  'self'`; a test greps the page for `innerHTML` and friends.
- The key travels in the URL fragment (never sent in a request line, never logged), is moved to session storage and removed from the
  address bar; every API call carries it as a header; a Host check stops DNS-rebinding pages.
- Polls every 5 seconds while visible. Live events (SSE) exist in `tools/run-view/serve.mjs` and can replace polling.
- Notification of "waiting for you" (desktop notification, e-mail, Slack, phone) is the most important missing piece for
  journeys 3–4; it is a host adapter, not a dashboard feature.

---

## 5. (c) Chat creation and (d) importers

### 5.0 (c) The chat creation flow

**Who pays.** Two options, both with one visible unit (tokens) and one cap:
- **BYOK**: the person's own Inception, Anthropic or OpenAI-compatible key, kept in the OS keychain (local) or in encrypted
  write-only storage (hosted, as Smithery does [TEARDOWN 1.17]); never in the workspace, never shown to a model. Free.
- **Subscription**: Foundry's own Mercury 3 access. Mercury 3 lists $0/$0 today with a 100M-token allowance on the owner's key and
  no usage endpoint (research/mercury-20261021/PROVISIONING.md), so the cost is the allowance, and the subscription price is a bet
  that this stays cheap. A dollar cap never triggers at $0: **caps are in tokens** (per message, per conversation, per day), and the
  person sees "builder: Mercury 3, 1,240 tokens of your 200,000 today".

**Mercury 3 as the default builder, inside a code-owned loop.** Mercury 3 alone scored 2/60 on AutomationBench dev60 and ran 52 of
60 tasks to the 50-step cap without deciding it was done (research/mercury-20261021/OFFICIAL-DEV60.md). So it never drives the
conversation: code owns the turn loop and termination; each Mercury call is one typed decision (which template; fill these slots;
which question to ask; does this answer satisfy the slot), with a JSON schema, at most 2 schema retries, then an escalation to the
policy's class-M model (Haiku 5.5) that is logged and shown ("I asked a stronger model to check this"). Model ids come only from
`policy/models.json`; Mercury is not in the policy yet (owner decision, §11). Construction quality of a cheap builder is the
research question of C0/E8 (README Results), not something this surface may claim.

**The few questions that matter** (rule U2). The builder asks a question only when a wrong default would do something the person
would refuse: the target (who receives, which account, which channel), irreversible or paid actions, and data leaving the machine.
Everything else is a default shown in the proposal and changeable later. Latent needs that the corpus prior says owners often want
(research/intent-20261021/corpus-prior.md: schedules 26% of business automations, error handling 11%, dedup or idempotency 8%,
failure notification 5%) are offered as toggles on the proposal card, not asked. At most three questions per turn; a non-answer
("my boss") is asked again, never guessed (spike test).

**The card the chat shows before anything runs** (what the spike returns from `propose_flow`):

> **Weekly report for Platform** (draft, version 1)
> **It will:** count the items in the export you give it and list the finished ones; save the report on this machine; send it to
> boss@example.com only, after you approve each send; check that what was sent is exactly what was saved.
> **It will not:** send to anyone else or more than once per run; read your tracker, e-mail or files by itself; run by itself every
> week (there is no scheduler yet); use a paid model.
> **Done means:** every item you gave is counted · the report is saved · it is delivered to the one recipient you named · what was
> delivered is exactly the saved report.
> [Try it on practice data]

### 5.1 (d) Importers: n8n prototype (built) and the others (designed)

**Principle.** Two verdicts, never mixed: the corpus *declared* verdict (`native | via-extension:<constructs> | unsupported:<reason>`,
research/corpus-20261006/ITEM-SCHEMA.md) and a *compile* verdict (it lowers to IR that the real validator accepts, or it is refused
with named reasons). Neither is an execution claim. Every import also gets a **wrap** contract: the existing flow called as one
typed, approval-gated tool.

**n8n prototype** (`app/importers/n8n.mjs`): the corpus normaliser's n8n classification ported line for line (and checked against
the Python original, below); a compile pass that maps triggers to host bindings and the run input (labelled untrusted for webhook,
chat and event triggers), plain `{{ $json.field }}` reads to IR references (including callback payloads after a wait-for-webhook,
which lowers to an IR signal wait), model chains to class-M `agent` nodes (the n8n model id is reported, not carried over), human
steps to `human` nodes, merges to `all_resolved` joins, and connector steps to `n8n.<connector>.<operation>` capability contracts the
host must provide; everything else is a named blocking reason with a plain explanation. Lowered flows declare `oracle: none`, so a
succeeded run is `unverified`, never `pass`, until a person writes the definition of done.

**Sample.** The 135 n8n corpus items are all `redistributable: false` (n8n template terms), so they were not used. Ten open-licence
files were acquired instead (MIT and Apache-2.0, two repositories by one author, mostly AI-agent flows; deterministic selection by
path hash; sha256-pinned; raw outside git): [n8n-sample-manifest.json](n8n-sample-manifest.json). Results:
[n8n-import-results.json](n8n-import-results.json).

| | count |
|---|---|
| files | 10 (all sha256-verified) |
| declared `native` (corpus heuristic) | 0 (all `via-extension`) |
| **compile: lowered, valid IR** | **2** (Create Google Doc; Summarize Slack Conversation) |
| **compile: unsupported, with named reasons** | **8** |
| wrappable as a typed tool | 10 |
| executed on real connectors | 0 |
| port fidelity: JS port vs the Python normaliser, declared verdict and every node's category, effect and connector | 10/10 files identical |

Blocking reasons across the 8 (a file can have several): agent tool loop 7, chat memory 7, n8n expression beyond a field read 7,
sub-workflow call 4, untranslated condition 4, chat session 3, batch loop 3, n8n Code node 3, error branch 2, host shell 1, cycle 1,
community node 1. Read: on agent-heavy n8n flows, the IR's missing constructs (tool loop, call, error branches) and n8n's
JavaScript expressions are what block import; wrapping is what keeps them usable. This sample is small and skewed; it is not an
estimate of n8n coverage (THESIS D8 asks for compiled and executed coverage on a fresh held-out sample after the IR freeze).

**Other formats (designed; reuse the corpus normalisers in `research/corpus-20261006/scripts/`, which already classify them):**

| Source | Brought over exactly | Refused with reasons | Wrap |
|---|---|---|---|
| **GitHub Actions** (YAML) | jobs → nodes; `needs` → `needs`; matrix → `map` (bounded); simple `if:` on `needs.*.result`/inputs → conditions; `workflow_dispatch` inputs → input schema | arbitrary `${{ }}` expressions, `run:` shell steps (→ sandboxed `code` only on Linux with bubblewrap), marketplace actions without a contract, runners, secrets (host bindings) | trigger `workflow_dispatch` via the GitHub API as a capability |
| **Airflow** (Python DAG) | parsed statically (never imported or executed): operators → capabilities, `>>` → `needs`, sensors → waits, XCom pulls → references | dynamic DAG generation, custom operators, Jinja templates | trigger a DAG run through the Airflow REST API |
| **Temporal** (code) | not imported: code-first workflows have no declarative form | — | start a workflow as a capability; Temporal signals map to IR signal waits |
| **Make** (blueprint JSON) | modules → nodes, routes and filters → conditions, iterators → `map`, aggregators → collect | functions in mappings, data stores, error-handler routes (until IR error branches) | call the scenario's webhook |
| **Zapier** | no public export format; templates are under Zapier's terms | — | **Zapier MCP** (each call costs 2 tasks [TEARDOWN 1.2]) or the Zap's webhook |
| **n8n** | built (above) | built (named reasons) | webhook, or n8n's instance-level MCP `execute_workflow` (n8n keeps the credentials) |

**What the person sees** after an import: "We can bring over 2 of your 10 flows exactly. 8 use things Foundry does not have yet
(an AI agent that picks its own tools; memory across chats; …). All 10 keep working in n8n, and your agent can call them from
Foundry as they are." No import ever claims the flows behave the same; a lowered flow must pass its own practice run and a
definition of done the person writes.

---

## 6. (e) Zero-config onboarding

### 6.1 One command, one click

- **Now (spike):** `node app/cli.mjs start` runs the doctor, opens the dashboard on 127.0.0.1 with a one-time key in the URL, and
  prints the exact line for each coding agent (it writes no agent config): `claude mcp add --transport stdio foundry -- node …/cli.mjs mcp --dashboard --workspace …`,
  the `codex mcp add` equivalent, and a `.cursor/mcp.json` snippet.
- **Next:** a published package (`npx -y @foundry/cli start`) once the owner decides to publish (AGENTS.md forbids publishing
  without the owner); a **Claude Code plugin** bundling the MCP server, a skill ("when to use Foundry"), and hooks; a **Cursor
  marketplace** entry ("Add to Cursor"); an **`.mcpb` bundle** for Claude Desktop (double-click); a **deploy button** for the hosted
  Control Plane later. The click carries the configuration; keys are asked for by name with one sentence of why (Vercel's pattern
  [TEARDOWN 1.18]).

### 6.2 Environment detection and safe defaults (`app/cli.mjs doctor`)

| Check | Default | What the person reads |
|---|---|---|
| Node ≥ 24 | required | "Node 24.21.0: fine." or how to install |
| `node:sqlite` | required | "Runs are recorded in a local database file." |
| Workspace | `~/.foundry` (Windows `%LOCALAPPDATA%\Foundry`), mode 0700; `FOUNDRY_HOME` overrides | where flows and records live |
| Sandbox for code steps | bubblewrap on Linux | "No sandbox: flows with code steps are refused; everything else works." |
| Models | none needed for templates | "No model key needed: this preview builds from templates and calls no model." |
| Network | loopback only; works offline | "Works offline. The dashboard listens on 127.0.0.1 only." |

### 6.3 Per platform

- **Linux:** everything, including sandboxed `code` nodes (user+mount+pid+net namespaces, `src/sandbox.mjs`).
- **macOS and Windows:** everything except `code` nodes, which are refused with a plain reason (the engine has no sandbox there).
  Later options: a container runtime if present, or macOS `sandbox-exec` / Windows AppContainer, each measured before it is trusted.
- **No sandbox anywhere:** the same refusal; capability tasks, model steps, human steps and waits all work.
- **Offline:** templates, practice runs, runs, the dashboard and imports work; the chat builder needs a model (Mercury and Haiku are
  remote; local models are parked, README "Local models").
- **Corporate proxy:** model calls honour `HTTPS_PROXY` (Node fetch); the dashboard stays on loopback.

### 6.4 The honest security boundary

The dashboard key and the Host check keep other pages and other OS users out. They do not keep out an agent that runs as the same OS
user with a shell: it can read files, start the CLI, or drive a browser. Claude Code's person-only tool flag and elicitation route
the decision through the client, which helps against an agent that only uses MCP, not against one with full shell access
(README "Boundaries": installing the MCP does not sandbox the agent). Ways to close it, in order of cost: run the Foundry service
as a separate OS user and talk to it over a local socket (free, local); approvals on a second device (phone push or passkey,
WebAuthn); the hosted Control Plane, where approval is an identity the agent does not hold (paid, and the natural home of the
second authority).

---

## 7. (f) The free/paid line in the UI

Free/paid follows ATTACK-FABLE §4.1: **paid = more than one authority, never complexity.**

| The person does | Free (one authority) | Paid Control Plane (second principal) |
|---|---|---|
| Builds a 400-node flow with sub-flows and waits | yes | — |
| Approves their own flows and actions | yes ("Approver: you") | — |
| Imports, wraps, practises, verifies records (`verify-run`, anchors) | yes | — |
| Uses BYOK models | yes | — |
| Clicks "Ask someone else to approve" / names an approver role | shown, explains the line | approver roles, delegation of authority, developer ≠ approver enforced (Windmill's self-approval block is the precedent [TEARDOWN 1.10]) |
| A rule owned by someone else (refund limit, segregation of duties) | — | constitution, runtime shield, change control bound to identity |
| Auditor asks for a period's evidence | single-run records | signed period evidence packs, population queries |
| SSO | free (ATTACK-FABLE: "SSO free") | — |

**Where it shows:** the approval card ("Approver: you" vs "Approver: Finance lead (Control Plane)"), the flow card badge when a flow
references a role, a single line in the dashboard footer (built), and the Mercury subscription in Settings. Never a wall in the
middle of building: the free tier has no complexity ceiling.

---

## 8. The spike (built, $0, stub models only)

### 8.1 What is in `app/`

| Path | What it is |
|---|---|
| `app/core/service.mjs` | `FoundryApp`: propose, explain, dryRun, requestApproval, decideActivation, run, status, list, inbox, decideAction; wraps the unchanged engine |
| `app/core/builder.mjs` | **stub builder** (no model): one frontier-written template ("weekly progress report from a tracker export"), slot filling by code, the question policy, will/won't-do |
| `app/core/capabilities.mjs` | host capabilities: `report.tally`, `outbox.send` (live: non-idempotent, approval-gated; practice: stand-in), `outbox.check` (independent verifier re-reading what was delivered) |
| `app/core/explain.mjs` | plain-language steps, checks, run status and failure text, from records only |
| `app/core/ledger.mjs` | activation ledger: dry runs and approvals, compare-and-swap, human channels only |
| `app/mcp/server.mjs` | stdio MCP server, seven tools, elicitation, person-only flag on `approve` |
| `app/dashboard/` | loopback server (token, Host check, CSP) and page (inbox, flows, runs, run detail, versions and diffs); `browser-check.mjs` (opt-in, Chromium) |
| `app/cli.mjs` | `start`, `mcp [--dashboard]`, `doctor`, `connect`, `approve` (real terminal only) |
| `app/importers/` | n8n importer, sample runner, acquisition script, Python parity harness |
| `app/test/` | 19 tests: service 5, MCP and dashboard 7, importer 7 |

### 8.2 Run it

```sh
node --test --test-concurrency=1 app/test/*.test.mjs        # 19 tests, about 6 s, $0
node app/cli.mjs doctor
node app/cli.mjs start --workspace /tmp/fws                  # dashboard + connect lines
claude mcp add --transport stdio foundry -- node "$PWD/app/cli.mjs" mcp --dashboard --workspace /tmp/fws
node app/importers/acquire-n8n-sample.mjs                    # re-fetch the 10 pinned n8n files (network)
node app/importers/run-n8n-sample.mjs                        # importer verdicts
node app/dashboard/browser-check.mjs /tmp/shots              # optional, needs Playwright's Chromium
```

### 8.3 Capability numbers (development, $0, K = 1, this machine)

| Measure | Result | Baseline / note |
|---|---|---|
| App tests | **19/19 pass** (`node --test --test-concurrency=1 app/test/*.test.mjs`, about 6 s) | — |
| Weekly-report journey, request to first verified run | **3 person actions** (answer the recipient question, turn it on, allow the send); 2 if the request names the recipient. Agent tool calls: 4–5 | no measured baseline (products in TEARDOWN not run) |
| Same journey, checks | 5/5 checks pass on the live run (4 acceptance + 1 independent verifier re-reading the outbox); run verdict `pass`; record verified (22 events) | — |
| Bypass attempts refused | **10/10**: approval before a passing practice run; run before approval; activation by a non-human channel (3 variants); a second decision on a decided request; action approval by a non-human channel; run of a head that changed without approval; a v1 practice run reused for v2; stringified input over MCP; missing dashboard key; a foreign Host header | each a test |
| Refusal of unknown intents | 3/3 refused ("book me a flight…", "translate my novel…", "what is the weather" over stdio), nothing created | — |
| Dashboard in Chromium | 0 console or page errors; screenshots in `/var/tmp/foundry-work/surface-20261021/shots/` | — |
| n8n importer, 10 open-licence files | 2 lowered (valid IR), 8 refused with named reasons, 10 wrappable, 0 executed on real connectors | corpus declared verdict: 0 native, 10 via-extension |
| Importer port fidelity | 10/10 files identical to the Python normaliser (verdict and per-node class) | — |
| Lowered flow on the runtime | a synthetic lowered flow runs to `succeeded` with a stub connector and a durable timer; verdict `unverified` (no oracle) | — |

### 8.4 What the spike proves, and what it does not

**Proves (development evidence):** the existing engine can carry the whole product lifecycle without changes to `src/`; version-bound
proposals, a mandatory practice run bound to the hash, a person-only activation and per-action approvals compose into one flow
that an MCP client can drive end to end; a client with elicitation lets the person decide inside the agent's window; the dashboard
can read the real hash-chained record read-only and explain it in plain words; an n8n importer can give honest compile verdicts and a
wrap path on real third-party files.

**Does not prove:** that anyone finds it intuitive (no user has seen it); that a cheap model can build flows (the builder is a stub
with one template; that is the C0/E8 research question); that imported flows behave like the originals (0 executed); that approvals
are safe against an agent with a shell (§6.4); anything on Windows or macOS (Linux only); notification of waiting approvals; real
delivery (the outbox is a file). Not covered by a test: `mcp --dashboard` opening the person's browser (the opener is a
platform command; tests run without it), `start`, and the terminal `approve` command (it refuses without a real terminal).

---

## 9. What is still missing, and proposed engine changes

**Missing, in the order the journeys need them:**
1. A real builder behind `buildFromIntent`: Mercury 3 / Haiku 5.5 through `ModelPort` with token caps and logged escalation, over a
   template library (frontier-written), measured against the stub and a single-call baseline.
2. Notifications for "waiting for you" (desktop, e-mail, Slack, phone) and standing approvals ("send this report to this one
   address, at most once per run, after the checks pass" without asking every week), which needs an engine change: approvals today
   bind exact arguments.
3. A scheduler binding (the IR has no triggers by design; a host scheduler starts runs, `foundry tick` already resumes timers).
4. Connectors: capabilities for e-mail, Slack, sheets, trackers, or wrapping Zapier/n8n MCP as the connector layer.
5. Repair and rollback tools; the import screen; the chat page; Streamable HTTP + OAuth for remote clients.
6. The principal model (ATTACK-FABLE §0 item 4): approvals record `actor: 'user'` only; the ledger records the channel but not an
   identity. Needed before any second-authority feature.

**Engine changes proposed (not applied; `src/` frozen for this work):**
- [patches/0001-mcp-apply-proposal-requires-a-person.patch](patches/0001-mcp-apply-proposal-requires-a-person.patch): mark the
  existing `foundry_apply_proposal` MCP tool person-only in Claude Code (`git apply --check` passes on the current tree).
- Fold the activation ledger into the store's proposal/apply transaction (one commit for "approved by channel X" and the head CAS).
  Today the spike decides first, applies second, and marks the approval `superseded` if the apply fails; a crash between the two
  leaves an approved request with no head change, which the next approval attempt sees.
- Record the approval channel and principal in the `approval.decided` chain event.
- Standing approvals with a bound (recipient, count per run, checks passed) as a capability-level policy.

---

## 10. The ten journeys

For each: the steps the person takes, what they see, the failures they must never see, and how the system absorbs them.
**Built** = covered by the spike's code and tests; **designed** = not built.

### J1. "First five minutes" (built for the local path)
1. Runs one command (`node app/cli.mjs start`; later `npx …` or one click on a plugin/marketplace entry).
2. Reads six doctor lines in plain words; the dashboard opens; three paste-ready lines connect Claude Code, Codex or Cursor.
3. In their agent: "use Foundry to send my team's weekly report to me".
- **Never see:** a config file to edit by hand; a stack trace; a port conflict (falls back to a free port); a silent failure to open
  the browser (the URL is printed).
- **Absorbed by:** doctor, fallback port, printed link, no writes to agent configs.

### J2. "I paste a messy request in chat" (built with the stub builder; chat page designed)
1. Types: "ugh can u make something that tells my boss what we got done each week for the Platform team, dont spam ppl".
2. Sees: "I need one answer first: Who should get the report? (one e-mail address). This is the only choice that sends your data
   somewhere. I will not guess it." Understood: team Platform, weekly, one recipient only.
3. Answers; sees the will / will-not / done-means card (§5.0) and "Try it on practice data".
- **Never see:** a draft that silently guessed the recipient; JSON; more than three questions; a flow that runs before they agree.
- **Absorbed by:** the question policy (U2); unknown intents get "I cannot build that yet … Nothing was created".

### J3. "Claude Code calls Foundry via MCP to automate my weekly report" (built)
1. The agent calls `propose_flow` (relays the recipient question if needed), then `dry_run`: "Practice run passed all 5 checks. It
   would have: sent ‘Weekly report: Platform’ to boss@example.com. Nothing real was sent."
2. It calls `approve`. Claude Code shows the person a permission prompt (person-only tool), then a dialog "Turn on ‘Weekly report for
   Platform’ (version 1)? It will … Done means …" with approve / reject. Without elicitation, the dashboard opens in the browser with
   the card.
3. Every week the agent calls `run_flow` with the export; the person gets "Send the report to boss@… (asks you first)" with the exact
   text; on "Send it" the run finishes and `flow_status` says "Finished. Every check in its definition of done passed."
- **Never see:** the agent approving on its own; a run of a version they did not approve; a second e-mail because the agent retried
  (the send is non-idempotent: the engine never retries it blindly and records `uncertain` if a crash hides the outcome).
- **Absorbed by:** ledger + engine approvals; `STALE_APPROVAL`; idempotency keys; one outbox message per run (test).

### J4. "An approval is waiting" (built: inbox; designed: notifications)
1. A notification: "1 thing is waiting for you: send this week's report to boss@…".
2. Opens the inbox card: To, Subject, the exact text; **Send it / Don't send**.
3. "Don't send": the run stops with "You said no to an action, so the run stopped before doing it. Nothing was sent."
- **Never see:** an approval that hides what will be sent; a denied approval whose action still runs (the Zapier community failure
  [TEARDOWN 1.2]); a decision that silently overwrote someone else's.
- **Absorbed by:** the approval is bound to tool + arguments + hash; refusal closes the run before the effect (test); decisions are
  compare-and-swap (`ACTIVATION_CONFLICT`).

### J5. "A run failed (at 3 a.m.)" (built: explanation; designed: repair)
1. The run card says, e.g., "Stopped with a problem. The final check failed: what was delivered is not exactly what was saved. Do not
   resend until you know why." Failed step named; the timeline shows where.
2. "Fix it": the repair tool classifies the failure (flake, variance, workflow defect, environment, impossible: THESIS §6 item 2) and
   proposes version N+1 with the same goal and checks, which goes through practice and approval.
- **Never see:** "pass" on a failed check (the engine's verdict seal); a half-done run that claims success; a retry that sends twice;
  an error code with no sentence.
- **Absorbed by:** independent verifier, acceptance checks, `uncertain` status, plain failure text with code in details.

### J6. "My n8n flow broke" (designed; uses the n8n importer and wrap, built)
1. Points Foundry at the n8n flow (export file, or the n8n MCP server). Foundry wraps it as a typed tool and, if it lowers, proposes an
   equivalent flow with a definition of done the person confirms.
2. A failing run of the wrapped flow appears in the dashboard with the n8n step that failed (from n8n's execution data, read through
   its API) in plain words, and Foundry's own checks around it ("the answer has a document id").
- **Never see:** "migrated" claims for flows that did not lower; credentials copied out of n8n (n8n keeps them; Foundry calls the
  flow).
- **Absorbed by:** compile verdicts with reasons; wrap contracts; `oracle: none` until a check exists.

### J7. "Bring my existing flows over" (n8n built; others designed)
1. Drops 10 n8n exports. Reads: "2 of 10 come over exactly. 8 use things Foundry does not have yet: an AI agent that picks its own
   tools (7), memory across chats (7), n8n expressions (7) … All 10 keep working in n8n, and your agent can call them from Foundry."
2. For each lowered flow: a proposal, a practice run, an approval, as in J2–J3.
- **Never see:** a flattened import that drops branches, loops or error paths; a flow that runs with a different model than they
  think (model ids are reported and mapped to the policy's class).
- **Absorbed by:** refusal as a whole flow on any blocking construct (AGENTS.md: adapters reject, never flatten).

### J8. "Change one thing, then roll back" (built: new version, diff, re-approval; designed: rollback tool)
1. "Send it to the CTO instead." → version 2 proposal: "What changes from the version that is on now: changed ‘Send the report to
   cto@example.com (asks you first)’". Version 1 keeps running until version 2 is practised and approved.
2. A request that changes nothing ("same thing, every Friday") gets "Nothing in the flow would change … Schedules are not part of this
   preview yet", not a pointless version.
3. Rollback: turn version 1 back on (person only).
- **Never see:** a running flow switching programs mid-run; a version 2 approved on version 1's practice run.
- **Absorbed by:** version-bound proposals; head CAS; `NEEDS_DRY_RUN` for an unpractised hash; runs pinned to their hash.

### J9. "My manager has to approve refunds over $500" (designed; the paid line)
1. The builder sees a second person in the request and says: "Approvals by someone other than you are part of the Control Plane."
   The flow can still be built and practised for free with you as approver.
2. With the Control Plane: an approver role, an identity the agent does not hold, the rule "developer ≠ approver" enforced, the
   approval on the manager's phone, and the evidence pack for the auditor.
- **Never see:** a paywall in the middle of building; a "manager approval" that the author can click themselves.
- **Absorbed by:** the line drawn at authorities, not complexity (§7); the principal model (§9 item 6).

### J10. "Something might have happened twice / it costs too much" (built: uncertain, token and cost display; designed: caps UI)
1. A crash during a send leaves the run `uncertain`: "Stopped, and one action may or may not have happened. It will not be retried
   automatically; check it by hand." The person checks the outbox and resolves it.
2. Cost: every run shows dollars and tokens and who paid; Mercury's token cap stops the builder with "You reached today's 200,000
   builder tokens; the flows you have keep running."
- **Never see:** a blind retry of an effect; an unexplained bill; a builder that keeps spending because the price is $0.
- **Absorbed by:** the engine's `uncertain` rule; token caps for $0 models (§5.0).

### Failures the person must never see (summary)

Raw stack traces or JSON-schema errors as the only message; hashes as the main information; "pass" when a check failed; a silent
stop; a double send; a run on a version they did not approve; the model approving its own work; a bill with no explanation; an
import claiming parity; editing a config file by hand; a second person's approval that the author can give.

---

## 11. Owner decisions

| # | Decision | Recommendation | Blocking? |
|---|---|---|---|
| S1 | **Which coding agents first** | Claude Code first (person-only tool flag, elicitation, plugins with skill + MCP + hooks, workflows to complement); Cursor second (elicitation, marketplace one-click); Codex third (per-tool approval modes; elicitation not documented: dashboard fallback) | next build step |
| S2 | **Hosting** | Local-first free product now; hosted **Control Plane** later as the paid product (second authority, identity, evidence), per ATTACK-FABLE; no hosted runtime until a customer asks (ATTACK-FABLE "deferred") | no |
| S3 | **BYOK** | Free and first-class: Inception, Anthropic, any OpenAI-compatible key; keys in the OS keychain (local) or encrypted write-only storage (hosted); never in the workspace or a model context | no |
| S4 | **Billing for Mercury 3** | Do not sell a subscription on a $0 list price alone: offer BYOK first; if a subscription, price it on token caps per day with a visible meter, and re-check Inception's price monthly (there is no usage endpoint) | before any subscription |
| S5 | **Add Mercury 3 to `policy/models.json`** (provider kind for OpenAI-compatible HTTPS, key by environment variable) so the builder may use it; the policy is the only source of model ids | yes, after the executor lands (PROVISIONING plan step 3) | for the real builder |
| S6 | **Publishing** a package / plugin / `.mcpb` / marketplace entry (AGENTS.md: no publishing without the owner) | Yes when the builder is real; a private beta first | for one-click |
| S7 | **Use of the n8n template library (ToS) locally** for importer coverage numbers (aggregate counts only, nothing published) | Ask counsel; until then keep to open-licence samples | for a larger import number |
| S8 | **Engine items for the next bump**: patch 0001; ledger into the store transaction; channel and principal in `approval.decided`; standing approvals | Approve 0001 and the principal item first | for J9 and standing approvals |
| S9 | **Licence of the engine and app** (Apache-2.0/MIT vs AGPL), and "free has no complexity ceiling" stated in the UI | As ATTACK-FABLE §4.5 | before publishing |
