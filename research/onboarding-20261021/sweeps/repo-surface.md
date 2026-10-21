# Repo-surface sweep for the onboarding site (2026-10-21)

Scope: the repo only, no web. Everything below was read in `/home/user/workflow-foundry` at HEAD `594cc34`, and the
runnable parts were run today. Evidence tags used here:

- [code] read in a source file today (path and line given).
- [ran] executed today: `node --test --test-concurrency=1 app/test/*.test.mjs` -> 34 tests, 34 pass, 0 fail, 0 skip
  (about 8 s; DESIGN.md still says 19 because the template library and the model builder were added after it);
  `node app/cli.mjs doctor` and `node app/cli.mjs connect` printed what section 4 quotes.
- [doc] a design or research document in the repo says so (it may be ahead of or behind the code).
- [meas] a measured result in the repo. Every number is development evidence (AGENTS.md: nothing here is sealed).
- [inf] my inference.

I did not open the dashboard in a browser, did not run a real model, and did not run `claude mcp add` against a real
Claude Code. Nobody has used any of this (DESIGN §8.4: "no user has seen it").

---

## 0. Bottom line

1. **There is a real, tested, local engine of the whole lifecycle** (describe -> proposal with checks -> mandatory
   practice run -> a person turns it on -> runs -> every outside action asks again -> status in plain words). It is
   `FoundryApp` (`app/core/service.mjs`, 227 lines) behind three faces: an MCP server (7 tools), a loopback dashboard
   and a CLI. 34/34 app tests pass.
2. **Nothing in it touches a real outside system.** E-mail is a file in `<workspace>/outbox`, chat is a file, "sheets" are
   JSON files in `<workspace>/world/sheets/`. There is no Gmail, Slack, Sheets, CRM, Jira or n8n call anywhere
   (`app/core/capabilities.mjs:1-9`, `app/core/stand-ins.mjs:1-6`). So every "connect your tools" step in an onboarding flow
   is **designed-only today**; the honest real step is "put a JSON list of rows where the flow reads it, or paste input".
3. **There is no org layer in the product.** The org vocabulary (roles, principals, layered invariants, SoD, DoA,
   exceptions, change control, evidence) exists as a schema, a registry, an observer, a shield and a scripted auditor in
   `experiments/constitution/` and works on the E8 bed only. `app/` and `src/` have no principal (`grep principal src/*.mjs`
   is empty; the app ledger stores a free-string `principal` defaulting to `'local-user'`, `app/core/ledger.mjs:47`, `app/core/service.mjs:153`).
   Org onboarding can really produce and validate a constitution document; it cannot yet make the product enforce it.
4. **The site must be a same-origin local page** (the dashboard server has a Host check, a CSP with `connect-src 'self'`
   and a per-start token), served by an extended `createDashboard` or a sibling loopback server over the same
   `FoundryApp`. The dashboard has only 3 GET routes and 1 POST route; propose, practice, request-approval and run exist
   only as MCP tools and as `FoundryApp` methods. A thin HTTP adapter over those methods is the main build item.
5. **Honest selling points exist, but each has a limit** (section 6). The strongest are the trust gates (tested bypass
   refusals), the measured cost/quality rows (Haiku + harness = Sonnet alone at 1/6 to 37% of cost, dev), the
   practice-loop result (Haiku-built saga 14/14 vs Opus one-shot 5/14, dev), and the OT-0 org result (a green process check
   hid 57/57 unapproved over-threshold refunds; the shield fixed it; the auditor could answer 5/5 queries only with it).
   Nothing supports "works with your existing tools", "runs on a schedule", "notifies you", "intuitive to anyone",
   "beats a frontier agent on org rules" or "auditors accept it".

---

## 1. What exists to build on

### 1.1 The service: `app/core/service.mjs` [code][ran]

| Method (line) | What it does | Returns (the fields a UI needs) |
|---|---|---|
| `propose({request, answers, flowId})` (51) | builder -> `status: needs_answers \| unsupported \| no_change \| proposed \| build_failed`. Never runs anything. A same-template-same-team request becomes version N+1 of the existing flow, never a second copy (60). A revision that changes nothing is refused with "Nothing in the flow would change" (62-65). | `questions[{id,slot,question,why,answerSchema}]`, or `proposalId, flowId, version, workflowHash, basedOn, changes, understood{template,slots,defaults,assumptions,notCovered,ungrounded}, willDo[], willNotDo[], summary, build{calls,inputTokens,outputTokens,costUsd,repairs,escalations}` |
| `explain({proposalId \| flowId})` (78) | steps, checks, actions, limits, assumptions, not-supported | `summary`, `dryRun`, `approval` |
| `dryRun({proposalId, input})` (90) | runs the **exact** proposed hash in an isolated practice store with the practice registry (outside actions replaced by stand-ins); records result in the ledger | `passed, headline, checks[{plain,exact,passed}], wouldDo[{action,to,subject,preview}], practiceRunId, workflowHash, practiceRegistryHash, liveRegistryHash, caveat, next` |
| `requestApproval({proposalId})` (138) | needs a passing dry run of the same hash (`NEEDS_DRY_RUN`); opens one pending activation (idempotent) | `status: awaiting_human, approvalId, summary, practice` |
| `decideActivation(id, approved, {channel})` (153) | human channels only (`dashboard`, `cli`, `mcp-elicitation`; `ledger.mjs:13`); CAS on `rev`; on yes, `foundry.apply(proposal)` (head CAS) | `status: approved \| rejected`; `STALE_APPROVAL`, `ACTIVATION_CONFLICT` |
| `run({flowId, input})` (168) | refuses `NOT_APPROVED` / `STALE_APPROVAL` (head hash != approved hash); outside actions pause | run status in words |
| `status({runId})` (185) | `explainRun`: headline, verdict, progress, failedStep, `problem{code,what,next}`, `pendingApprovals`, `costUsd`, `checks`, `timeline`, `honesty` line | |
| `list()` (191), `inbox()` (205) | flows with `active`, run counts, last run; proposals with dry-run state; everything waiting for a person (activations and paused actions with To / Subject / preview) | |
| `decideAction(runId, approvalId, approved, {channel})` (221) | the person's yes/no on one paused action; on yes the run resumes | |

Plain-language layer: `app/core/explain.mjs` (126 lines): 9 run states with fixed sentences (`STATUS`), 24 failure codes
with a what/next pair (`FAILURES`), one sentence per check from the condition language (`checkText`), `describeWorkflow`
(steps with effect class "reads or computes only / writes (safe to repeat) / acts on the outside world (not safe to repeat)"
and `asksFirst`), and the honesty line "Local checks passing is not proof the real-world task succeeded; it is proof these
checks held on this run" (`explain.mjs:125`). Unknown codes fall back to "Stopped with code X", never a guess.

### 1.2 MCP server: `app/mcp/server.mjs` (116 lines) [code][ran]

Seven tools, closed input schemas, results carry `say` (1-2 sentences to relay): `propose_flow`, `explain_flow`, `dry_run`,
`approve` (asks the person; `_meta["anthropic/requiresUserInteraction"]: true`; uses MCP elicitation form mode if the
client advertises it, else returns `awaiting_human` plus where to approve), `run_flow`, `flow_status`, `list_flows`.
Server `instructions` (line 97) are one sentence. Tests cover: tool list, an agent without a person can propose and
practise but never turn on or run, elicitation path, real stdio entry with a clean stdout.
Not built (DESIGN §3.2): `answer`, `request_change`, `repair_flow`, `rollback_flow`, `import_flow`, `wrap_flow`, `cancel_run`,
kept-flows-as-tools, resources, prompts.

### 1.3 Dashboard: `app/dashboard/` (server 127 lines, page 114 lines js) [code]

- Routes: `GET /` `/dashboard.js` `/dashboard.css`; `GET /api/overview`, `GET /api/runs/:id`, `GET /api/flows/:id`,
  `POST /api/decide` (`kind: activation | action`, `decision: approve | reject`, `channel: 'dashboard'` fixed server-side).
- Auth: per-start random token in the URL fragment (`#t=...`), moved to `sessionStorage`, sent as header `x-foundry-token`;
  Host must be exactly `127.0.0.1:<port>` or `localhost:<port>` (421 otherwise) (`server.mjs:84,91`).
- CSP `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'` (`server.mjs:21`): a page on any
  other origin cannot call it, and the page cannot load fonts, images or CDN scripts. Everything is rendered with `textContent`.
- Screens: "Waiting for you" (activation cards with goal, what changed from the version that is on, steps, "Done means"
  ticks from the practice run; action cards with To / Subject / exact text and **Send it / Don't send**), "Your flows"
  (On / Not turned on, version, runs, last result, "Versions and changes" with diff), "Recent runs" (result in words,
  "verified (N events)" from the hash chain), run detail (headline, failed step, `problem.next`, cost, model calls and tokens,
  checks, "Record verified: N events", timeline, honesty line). Polls every 5 s.
- Empty state exists: "No flows yet. Ask your coding agent, e.g. 'use Foundry to send my team's weekly report to me'."
- The only paid-line UI today is the footer: `Approver: you (single-person mode). Flows that need a second approver or a rule
  owner are the paid Control Plane; not in this preview.` (`server.mjs:97`, `dashboard.js` `load()`).
- Not built: Cost screen, Imports screen, Settings (keys, notification channel), chat page, notifications, SSE.

### 1.4 CLI: `app/cli.mjs` (136 lines) [code][ran]

`start` (doctor, dashboard on 127.0.0.1 port 4178 or a free port, prints connect lines, opens the browser unless `--no-open`),
`mcp [--dashboard] [--builder stub|haiku|mercury] [--token-cap N]` (stdio), `doctor`, `connect` (prints only; **writes no agent
config**), `approve APPROVAL_ID` (needs a TTY, asks the person to type `yes`). Default workspace `~/.foundry` (0700),
`FOUNDRY_HOME` overrides, `%LOCALAPPDATA%\Foundry` on Windows.

What `doctor` printed today on this Linux box [ran], verbatim:
```
ok   Node 24.21.0: fine.
ok   Runs are recorded in a local database file.
ok   Your flows and run records live in <workspace>.
note  No sandbox (bubblewrap) found: flows with code steps are refused; everything else works.
ok   No model key needed: the default builder fills templates by code and calls no model. --builder haiku or --builder mercury lets a cheap model build from the template library (Mercury needs INCEPTION_API_KEY and a token cap).
ok   Works offline. The dashboard listens on 127.0.0.1 only.
```
`connect` printed a `claude mcp add --transport stdio foundry -- "<node>" "<cli.mjs>" mcp --dashboard --workspace "<ws>"` line,
the `codex mcp add foundry -- ...` equivalent and a `.cursor/mcp.json` object, with "Nothing was written to any config file."
Install today is `node app/cli.mjs` from a clone: there is no package, no `npx`, no plugin, no `.mcpb` (D13 forbids publishing).

### 1.5 Template library and builders [code][ran]

Seven frontier-written templates in `app/core/templates/*.json` (author `claude-opus-5-5`, hand-written 2026-10-21), each with typed
slots, will/will-not-do sentences, practice data, acceptance checks and an independent `verify` node. All local stand-ins.

| id | What it is | Slots the person is ASKED about (kind) |
|---|---|---|
| weekly-report | weekly progress report from a tracker export, e-mailed to one person | `recipient` (wrong-target) |
| invoice-chase | dunning reminders at 7/14/30 days, once per stage per invoice; paid and disputed never chased | `summaryTo` when a summary is wanted (wrong-target) |
| lead-triage | route new leads to a person by region/country/source/size/budget, with a log | `rules` (if incomplete), `defaultAssignee` (wrong-target) |
| support-deflection | answer common tickets with the owner's own canned replies by keyword; urgent and the rest to a person | `escalateTo` (wrong-target) |
| expense-approval | auto-approve up to a limit with a receipt, rest to one approver by e-mail | `autoApproveUpTo` (**not-wanted**: "Up to what amount should I approve an expense without asking anyone?"), `approver` (wrong-target) |
| contact-sync | add CRM contacts missing from the newsletter list, never the unsubscribed; report | `reportTo` (wrong-target) |
| oncall-digest | unresolved alerts to a chat channel, optional e-mail page for unacknowledged criticals | `channel`, `pageTo` (wrong-target) |

So the product's **question policy is literally two classes: `wrong-target` (where data goes) and `not-wanted` (a limit whose
wrong guess does something the person would refuse)**, with `askWhy` text ("A wrong limit would approve spending you would refuse.
I will not guess it.") and visible defaults for everything else; at most 3 questions per turn (`library.mjs:220`); an address or
channel the person never wrote is treated as not given (`grounded` check, `library.mjs:118,181`). The answers are checked in code.

Builders (pluggable, same return shape):
- `stub` (default): matches `weekly-report` only, by regex, no model, $0 (`builder.mjs`).
- `haiku` (`claude-haiku-5-5`) and `mercury` (`mercury-3`): `ModelBuilder` (`builder-model.mjs`): one `select` call
  (template id or `none`, refusal is a valid answer), then `fill` calls (slots, notStated, questions, assumptions) with
  schema retries <= 2, repair rounds <= 3 driven by the practice run's failed checks, optional logged escalation
  (`escalateTo`, off by default). Code owns termination. **Tested only with a scripted ModelPort** (`app/test/builder-model.test.mjs`);
  the 24 frozen cases in `research/surface-20261021/eval/cases.json` (3 per template, 5 over-reach traps, 3 "none" requests)
  have **no recorded run** and the referenced `PREREG-BUILDER-1.md` is not in the repo [meas gap]. So "a cheap model builds
  your flow" is wired but has no capability number.
- Model routes: `haiku` goes through the `claude-cli` provider, whose policy `auth` text is "the cloud session's own managed
  Claude Code login; no API key is read or stored" (`policy/models.json`), i.e. a research route, not a user-facing BYOK
  path. `mercury` needs env var `INCEPTION_API_KEY` (`credentialEnv`, never a value in the repo) and a token cap
  (`BUILDER_TOKEN_CAP`). There is **no provider kind for a user's own Anthropic or OpenAI API key** in the policy
  (kinds: `claude-cli`, `openai-compatible-http` for local llama-server, `systemone-http`, `openai-chat-https`), and
  **no OS-keychain code anywhere** (`grep keychain|keyring` over `app src policy bin`: none). D11 (keychain) is design only.

### 1.6 Importers [code][ran][meas]

`app/importers/n8n.mjs` (371 lines): `importN8n(json)` -> report with classification, lowered workflow if it validates, named
blocking reasons (a dozen, each with a plain explanation, in `BLOCKING` at line 195), and `wrap()` (a capability contract that would call the existing
n8n flow by webhook or n8n's MCP). Not reachable from the CLI, MCP or dashboard: only `run-n8n-sample.mjs` and tests use it.
Result on 10 open-licence files: 2 lowered to valid IR, 8 refused with named reasons, 10 wrappable, **0 executed on real
n8n**; port fidelity 10/10 vs the Python normaliser. Sample is small and skewed (DESIGN §5.1). No GitHub Actions, Make,
Airflow or Zapier importer exists.

### 1.7 Org vocabulary: `experiments/constitution/` [code][meas], not in `app/` or `src/`

Schema `schema/constitution-v0.schema.json` (117 lines), instances `v1.json` (T1 = EUR 500), `v2.json` (T2 = EUR 250 from day 7),
`v3-planted.json` (an unauthorised change that must be refused). One document is one version of an organisation's constitution:

| Field | Meaning (the org-setup question it answers) |
|---|---|
| `entity` | which legal entity |
| `layers` | exactly `regulation > org-policy > entity-rule > process > workflow` (a lower layer may only narrow a higher one) |
| `roles[{id,description}]` | "who can do what" (controller, finance, finance-approver, cs-agent, fraudAnalyst, workflow-service, customer) |
| `principals[{id,kind: human\|service\|customer-class, roles}]` | the actual people / service accounts, incl. dual-role people (`u-cs1` is cs-agent and finance-approver, the SoD trap) |
| `bounds[{id,layer,owner,parameter,min,max,statement}]` | limits a higher layer puts on a parameter a lower layer sets (group policy: no refund above EUR 1,000 without approval) |
| `parameters` | the lower layer's actual value (refund approval threshold T) |
| `clauses[{id,title,layer,owner{role,principal},assurance[provable\|monitorable\|judged],statement,check,narrows,exceptions,evidence}]` | C1 conservation + exactly-once, C2 refund authority with SoD, C3 change control and pinning. Each has an accountable owner, an assurance class, authorised exceptions (`break-glass`, `emergency-change`: who, when, requires justification / after-the-fact review / journal, reviewBy, reviewWithinHours) and the evidence it must leave |
| `change{proposerRoles, approverRole, proposerMayApprove, approvalBeforeEffective}` | who may change the constitution itself (change control) |

`constitution.mjs` validates a document and containment ("a lower layer may only narrow": `boundProblems`);
`registry.mjs` is a hash-chained journal with a change-control gate (approver holds `controller` **under the version in force**,
approver != proposer, approval before `effectiveFrom`, supersedes latest accepted, within every higher-layer bound);
`observer.mjs` evaluates C1-C3 over an OCEL-2.0-shaped log; `port.mjs`/`shield.mjs` is a post-posed edit automaton that holds
an over-threshold refund for an approval by the right role excluding the principals who entered the amend/cancel, pins each
order to the constitution version in force at placement, and journals every intervention; `auditor.mjs` answers five population
queries and a 10-case walkthrough from the evidence pack alone. 48 tests, $0.

### 1.8 Other pieces the site can reuse [code]

- `bin/foundry.mjs verify-run RUN_ID [--check-anchors FILE] [--append-anchor FILE] [--require-bound]`: offline hash-chain
  verification and anchors (`src/verify-run.mjs`, `src/audit.mjs`). The dashboard already shows "Record verified: N events".
- `tools/ui/` (G21): compiles a human task's `question` + `answerSchema` into an accessible static HTML form by code, re-validated
  on the host. The right base for the "answer a paused step" form (MCP `answer` tool is not built).
- `tools/run-view/` (read-only node-style run view with SSE live feed, run history page) and `web/` + `src/http.mjs`
  (the engine inspector: graph canvas, proposals, trials, evidence, "New workflow", "Import JSON"). These speak engine words
  ("trial", "proposal", "hash") and are the right "advanced" view, not the onboarding surface.

---

## 2. What the site must call

### 2.1 Existing calls (all in-process; the site's server calls them directly)

| Site action | Call | Notes |
|---|---|---|
| Overview, inbox, flow list, run list | `app.list()`, `app.inbox()`, dashboard `GET /api/overview` | already composed by `createDashboard` (adds `runs` with chain verification, `mode`) |
| Describe what I want (chat box) | `await app.propose({request, answers, flowId})` | async because a model may build; render `questions` as <= 3 plain questions with `why` under each; `understood.defaults` as visible toggles; `understood.ungrounded` as "I did not use X because you did not write it" |
| Show the card before anything runs | from `propose`: `willDo[]`, `willNotDo[]`, `summary.checks[].plain` ("Done means"), `summary.limits`, `summary.notSupported` | text is already written by code |
| Try on practice data | `await app.dryRun({proposalId})` | show `checks` ticks, `wouldDo` previews, and always the `caveat` ("does not show delivery works") |
| Ask to turn on | `app.requestApproval({proposalId})` then show the activation card; the click posts `POST /api/decide {kind:'activation'}` | the **page's human click** is the `dashboard` channel; the chat builder must never be given a path to `decideActivation` |
| Run | `await app.run({flowId, input})` | input is `{now: ISO}` for library flows (data comes from `world/sheets`), `{weekOf, items[]}` for the stub weekly report |
| Allow / refuse a send | `POST /api/decide {kind:'action', runId, approvalId}` | inbox cards carry To / Subject / exact text |
| What happened, in words | `app.status({runId})`, `GET /api/runs/:id` | `headline`, `problem.what/next`, `failedStep`, `checks`, `honesty` |
| Version diff | `GET /api/flows/:id` (`diffVersions`) | "what changes from the version that is on now" |
| Environment check | `doctor({workspace})` exported from `app/cli.mjs` (pure function: `{ok, items[{check,ok,optional,say}]}`) | not exposed over HTTP yet |
| Connect lines | `connectInstructions(workspace)` exported from `app/cli.mjs` | prints strings only |
| Verify a record | `verify-run` CLI / `StoreReader` in `tools/run-view/store-adapter.mjs` | |

### 2.2 Calls that do not exist yet (the site cannot honestly show these as working)

`POST /api/propose`, `/api/dry-run`, `/api/request-approval`, `/api/run` (thin adapters; all methods exist); `GET /api/doctor`,
`GET /api/connect`; builder/model settings and key entry; connection (connector) registry; schedule binding (the IR has no triggers,
`foundry tick` only resumes timers); notifications for "waiting for you"; import endpoints (library exists); constitution
load/validate/propose endpoints (library exists in `experiments/constitution`); principal and identity; repair/rollback/cancel;
cost caps UI; period evidence pack export.

### 2.3 Constraints the site inherits

- Same origin, same process or a loopback sibling that builds the same CSP; no CDN fonts or scripts, no images (`img-src 'none'`
  today; relax deliberately if the site needs them, not by default). `textContent` only for anything from the workspace or a model.
- The site's chat must treat the request text and every model output as data. The builder already refuses an address the person
  did not write.
- D13: the site is built and run locally only. No deploy, no domain, no package, no marketplace entry.
- Windows and macOS: untested; code steps refused without bubblewrap (Linux only). Templates use no code steps, so the seven
  templates would run, but nothing has been run there [inf].

---

## 3. Which onboarding steps can be real, and which are designed-only

Status key: **REAL** = backed by code that is tested; **PREVIEW** = real code, but acting on stand-ins or never run live;
**DESIGNED** = no code; the site may show it only as "planned" or as a clearly labelled mock.

### 3.1 Solo developer (Claude Code first, then Cursor, then Codex; D9)

| # | Step | Status | Backed by / gap |
|---|---|---|---|
| 1 | Get it running: one command | REAL from a clone: `node app/cli.mjs start`. `npx`/package/plugin/`.mcpb`: DESIGNED (D13) | `cli.mjs:84` |
| 2 | "Does my machine work?" six plain lines | REAL | `doctor()`, ran today |
| 3 | Dashboard opens with a one-time key | REAL | `createDashboard`, port fallback `dash.listen(0)` |
| 4 | Connect Claude Code / Codex / Cursor: paste one line | REAL as printed text; tested over a real stdio client; **not verified against a real Claude Code, Codex or Cursor** [inf: elicitation dialog and the person-only prompt behave as DESIGN says only if the client does] | `connectInstructions` |
| 4b | One-click connect (plugin with skill + hooks, Cursor marketplace, `.mcpb`) | DESIGNED | DESIGN §6.1 |
| 5 | Pick the builder: `stub` (default, $0, only the weekly-report template), `haiku`, `mercury` | PREVIEW: flags exist (`--builder`, `--token-cap`); `haiku` rides the researcher's `claude` CLI login; Mercury needs `INCEPTION_API_KEY` in the environment; no live builder number exists | `makeBuilder` |
| 5b | Bring your own Anthropic / OpenAI / Inception key, stored in the OS keychain, shown as a token meter | DESIGNED: no provider kind for a user's own Anthropic key, no keychain code, no settings screen, no usage meter (token caps exist for Mercury only) | D11/D12 |
| 6 | Say what I want, answer <= 3 questions | REAL with the stub for weekly-report; PREVIEW for the 7-template library through a model | `propose` |
| 7 | See "It will / It will not / Done means" | REAL (code-written from the template) | `willDo`, `willNotDo`, `summary.checks` |
| 8 | Practice run, mandatory, bound to the version hash | REAL | `dryRun`, ledger |
| 9 | Person turns it on (dashboard / terminal / MCP dialog); agent cannot | REAL; 10 bypass attempts refused in tests (DESIGN §8.3) | `decideActivation` |
| 10 | First real run; every outside action asks again with the exact text | REAL, but "outside" = a local file | `run`, `decideAction` |
| 11 | Plain failure / "uncertain: do not retry" / record verified | REAL | `explain.mjs`, engine journal |
| 12 | Change it ("send it to the CTO instead") -> version 2 with a diff; old runs keep their program | REAL (weekly-report); `no_change` handled | `propose({flowId})`, `diffVersions` |
| 13 | Roll back | DESIGNED (`rollback_flow` not built) | |
| 14 | Repair a failed run as a new version | DESIGNED (`repair_flow`; engine `requestRepair` exists) | |
| 15 | Run it every week by itself | DESIGNED: no scheduler. Every template says so in its will-not-do | |
| 16 | "Something is waiting for you" notification | DESIGNED | DESIGN §4.2 |

### 3.2 Non-technical solo owner (no coding agent)

| # | Step | Status |
|---|---|---|
| 1 | Install and open | DESIGNED for non-developers: needs Node >= 24 and a terminal today. A double-click installer is not built (D13). |
| 2 | Chat page to describe what they want | DESIGNED (no chat page; MCP is the only conversational face) but every call it needs exists on `FoundryApp` |
| 3 | Pick from the seven templates by name | REAL data (`catalog()` gives id, title, whenToUse, notFor), no picker UI |
| 4 | "Connect your Gmail / Sheets / Slack / CRM" | DESIGNED. Real today: put `<workspace>/world/sheets/<name>.json` (a JSON list of rows with the column names in each template's `data`) or paste input. The templates' `data` field already names each sheet's columns in plain words (e.g. invoices: `invoice, customer, email, amount, due (YYYY-MM-DD), status`) |
| 5 | Import what I already have (n8n) | library REAL, no UI/CLI entry; other platforms DESIGNED |
| 6 | Pay for the builder | DESIGNED (D12: BYOK first; subscription only after a measured price) |

### 3.3 Organisation (second authority, rule owner)

| # | Step | Status |
|---|---|---|
| 1 | Name the entity, layers and who owns each (controller / finance / process owner) | The document and its validator are REAL (`constitution.mjs`); a form that writes it is DESIGNED; product enforcement is DESIGNED |
| 2 | List roles and people (principals), mark dual roles | schema REAL; no identity system, no SSO, no directory import (D2 says SSO is free: DESIGNED) |
| 3 | Set bounds and parameters (refund threshold, DoA limits) | schema + containment check REAL; wiring to template slots like `autoApproveUpTo` DESIGNED |
| 4 | Name exceptions (break-glass, emergency change) with who, expiry, review | schema REAL; shield handles break-glass escalation in the E8 bed only |
| 5 | Approver is someone else | **Not in the product.** `expense-approval`'s `approver` is an e-mail recipient: a notification, not an approval, and the decision does not come back as a verified approval (approvals are only the local person's). The UI must not call this "approval by your manager". Paid-line copy exists as one footer sentence. |
| 6 | Change control on the rules themselves | REAL on the bed (`registry.mjs` gate refuses the planted v3 with six reasons); DESIGNED in the product |
| 7 | Static check that a workflow satisfies SoD/DoA before it is turned on | DESIGNED (compromise D1: ~300 lines; engine bump 11-04 per D15; worktree `#78` in flight) |
| 8 | Auditor asks for a period of evidence | auditor + `verify-run` + anchors REAL on E8 and per run; **period pack with population queries** DESIGNED (five queries pass only when a workflow hash and constitution hash are journaled, which the product does not do yet) |
| 9 | Notifications to the approver's phone | DESIGNED |

---

## 4. The questions the site may ask, and the rule that bounds them

Source of the rule: INTENT DESIGN §1 layer 4 ("not wanted") and its metric "fewest questions"; DESIGN U2; `library.mjs:220`.
**Ask only what a wrong guess would make the person refuse:** (a) wrong-target: who receives it, which channel, which account;
(b) not-wanted: a limit, a cap, something irreversible or paid or data leaving the machine; (c) a second authority:
who else must say yes. Everything else is a visible default the person can change later (corpus prior: schedules 26%, error
handling 11%, dedup 8%, failure notification 5% of business automations are offered as toggles, not asked). At most three
questions per turn, a non-answer ("my boss") is asked again, never guessed. A request the library cannot build gets "I cannot
build that with the flows I know ... Nothing was created", with the list of what it can build.

What the system asks of a person today, in order [code]: workspace location (default, silent), a recipient e-mail or a channel
(`wrong-target`), a limit (`not-wanted`), yes/no to turn a version on, yes/no on each outside action. What it never asks today:
any account login, any API key (Mercury only via environment), any permission scope.

---

## 5. What the product can actually claim per surface (so the site can show a ladder)

| Capability | Working now | Preview (stand-in / unmeasured) | Designed only |
|---|---|---|---|
| Describe -> reviewed proposal -> practice -> person turns on -> run -> verified record | yes (local) | | |
| Real e-mail / chat / sheet / CRM delivery | | local files only | all connectors |
| Cheap-model builder | | wired, scripted tests only | measured capability number |
| Existing automations | | n8n importer library (2/10 lower, 10/10 wrap-able, 0 executed) | CLI/UI import, GHA/Make/Airflow/Zapier |
| Schedules, notifications | | | both |
| Approvals by a second person | | | principal model, identities, roles in IR |
| Org rules enforced on runs | | E8 bed only (OT-0) | product runtime |
| Evidence pack for an auditor | per-run verified record, anchors | five queries on E8 | per-period, signed, population-complete |
| BYOK keys | | Mercury via env var + token cap | keychain, Anthropic/OpenAI provider, meter |
| Hosted control plane, SSO | | | all |

---

## 6. Selling points the evidence supports, with the limit on each

All numbers: development evidence (devTrain or beds we wrote), K = 1 unless stated, nothing sealed (AGENTS.md).

1. **"Nothing runs, sends or changes until you say yes, and your agent cannot say it for you."**
   Evidence [ran]: 10/10 bypass attempts refused by tests (approval before a passing practice run; run before approval; activation by a
   non-human channel (3 variants); a second decision on a decided request; action approval by a non-human channel; a changed head run
   without approval; a v1 practice run reused for v2; stringified input over MCP; missing dashboard key; foreign Host header); the
   approval is bound to tool + arguments + workflow hash; a denied send stops before the effect (test). Teardown: Zapier's community
   reports a denied approval still ran both branches [sec, TEARDOWN 1.2]; Claude Code's person-only flag is client-enforced [doc].
   Limit: an agent with a shell running as the same OS user can run the CLI (DESIGN §6.4); the claim is about the MCP surface.
2. **"It is checked, in plain words, before and after: the definition of done is part of the proposal."**
   Evidence [code][ran]: every template ships acceptance checks and an independent `verify` node (outbox/chat/sheet audits that
   re-read what was left on disk); `Done means` ticks come from the practice run; the run page says "Record verified: N events".
   Limit: README "Honest run verdicts" is marked **Broken** for the constructed C0 artifacts (the verdict said "pass" on all 5 failed F
   trials) and lists a fix as in progress. The app's check results are shown separately from the run verdict, and the honesty line
   must stay on the page. Verify-by-re-reading-a-local-file proves the flow, not the delivery.
3. **"A cheap model plus the harness does the work of a more expensive one."**
   Evidence [meas] (`research/automationbench-20261014/runs/DEV60-A0-A1.md`, 60 devTrain tasks, k = 1, host date noted): Haiku alone
   9/60, **Haiku + prose harness 18/60 at $0.94, Sonnet alone 20/60 at $6.03** (about one sixth the cost; 8 vs 6 discordant, p = 0.79),
   Sonnet + harness 28/60 at $6.92; **Haiku + code-owned harness (A1-C) 20/60 at $2.23 = Sonnet alone at 37% of its cost**, highest
   partial credit (0.789). P1 [meas, README]: hand-written workflow on Haiku 35/36 vs one Sonnet call 28/36 at about 1/19 of the cost
   per verified success ("at least as good", "beats" not shown; 30 of 108 single-call timeouts inflate the gap).
   Limits: devTrain tasks, not the leaderboard (frozen test run not done); A1-C is in-sample and its checks are wrong both ways
   (16 false accepts, 10 false rejects); Mercury 3 alone is 2/60 and 52 of 60 tasks hit the 50-step cap, so Mercury is a cheap
   *component inside a code-owned loop*, never a standalone builder claim; the onboarding builder itself (template select + fill)
   has no recorded run.
4. **"It practises first, and that is what makes a cheap builder reliable."**
   Evidence [meas] (`research/enterprise-20261014/B1-E8-DEV.md:174-176`, `research/org-20261021/README.md` §2.2): on the long-horizon
   order saga E8 (sized world, 14 cases) Haiku builds with a practice loop passed **14/14 in three lineages ($0.39 / $0.62+0.11 /
   $0.53+0.05 to build, $0 per later run)**, while **Opus one-shot passed 5/14 (11 arm errors, $7.63)**, Haiku one-shot 0%, and the
   no-workflow arm (one fresh Haiku session per tick) 10/14 at $1.45 and about 1.5 h for the sized world (the full world would take
   about 7 h and did not fit the 2 h limit). On the same 9 full worlds (1,022 cases): Haiku + smoke loop 100%, Opus one-shot
   281/1,022 = 27.5%, Haiku one-shot 0% (B1-E8-DEV.md:96-117). Reading in the repo's own words: "the feedback loop, not the
   builder's tier, decides construct-before on this family." Limits: one generator we wrote, K = 1 per build, 14 cases on the sized
   world; the practice world was mock-authored by us; Opus failed on one interface misreading (batch key) a loop would have shown.
   The product's practice step is the same idea (mandatory, hash-bound), but the product has not measured it on any
   customer-like task.
5. **"Your rules hold at run time, and an auditor can get answers."**
   Evidence [meas] (`research/org-20261021/README.md`, $0, E8, scripted approvers, three Haiku-built lineages plus two pre-repair
   builds): a build that passes the process oracle 1022/1022 applied **57 of 57 above-threshold refunds with no approval** and handled
   28 orders under the old threshold after it changed (W-blind). With the shield: **0 conservation, 0 authority and 0 change-control
   violations; 58 holds, 58 released (one via break-glass)**; the scripted auditor answered **5 of 5 population queries and 10/10
   walkthroughs on the sized world, Q1-Q4 in 45/45 and Q5 in 41/45 runs on the full worlds**, versus **0/10 on today's journal**
   (which records no workflow hash, constitution hash or principal). A 21-line guard (G) without case history failed SoD (16 per
   lineage) and pinning (3 per lineage) and abandoned one refund. Limits: simulated org, one process; the frontier-agent-alone
   comparator A-F and the Haiku W-C builds were **not run** (paid, PREREG-OT0 is a draft), so "better than a frontier agent at org
   rules" is unsupported; "auditors accept this" is unsupported (sources secondary, ATTACK-FABLE §2.2); the shield is not in the
   product runtime.
6. **"Bring what you have: honest about what comes over."**
   Evidence [meas]: n8n importer on 10 open-licence files: 2 lowered with valid IR, 8 refused each with named reasons, all 10
   wrappable as typed approval-gated tools; JS port identical to the Python normaliser on 10/10. Teardown: nobody else reports what
   they could not bring over [doc, TEARDOWN lesson 9, with its own caveat that documentation silence is not proof]. Limits: 0 executed on a
   real n8n, sample small and skewed, no other formats, no UI.
7. **"No account, local-first, works offline, nothing leaves the machine."** [ran: `doctor`] True today largely *because nothing is
   connected*. Once connectors exist the claim needs re-earning. The model builder, when used, sends the request text to the
   model provider.
8. **"Free for one authority at any complexity; paid when a second person or rule owner must approve. SSO is free."**
   Evidence: D1/D2 [doc]; ATTACK-FABLE §1.5/§4.1 (precedents: GitLab buyer-based tiering [fact✓], Windmill blocks self-approval on paid
   plans [doc✓], Zapier gates multi-step on paid and sells to the market the thesis avoids [fact]); it cannot be gamed by splitting
   a workflow. Limits: a pricing hypothesis, no buyer interview done (K-A due 11-20); nothing in the product enforces the line.
9. **"One verified record per run."** [ran] hash-chained events re-verified on read, `verify-run`, optional anchors; shown on the
   run page. Limit: decisions and transcripts are not yet bound into the chain (README "Audit" row); the app ledger lives beside the
   store, not in it (DESIGN §9 proposes folding it in).

**Say nothing about** (unsupported by anything in the repo): working with Gmail/Slack/Sheets/Jira/Salesforce; "set it and forget it"
scheduling; phone/e-mail notifications; Windows or macOS support; "intuitive to anyone" (no user has seen it); a Mercury
subscription; a hosted service or SSO; SOC 2 / SOX acceptance; parity with n8n/Zapier/Make; or frontier-agent-beating results on
org rules.

---

## 7. Design implications for the site (from the repo, not from the web)

1. **Label every step with its real state.** A ladder of "Working now / Preview (stand-ins) / Planned" on each onboarding step is
   itself on-brand (the product's own rule: say what it will and will not do; "Local checks passing is not proof ..."). It also
   protects against the most likely failure of the site: a connect screen that implies Gmail works.
2. **The first real success a new person can have today is the practice run**, not a live send: describe -> three plain questions
   -> "Done means" -> practice with `wouldDo` previews -> turn on -> run -> the exact text in the inbox. That is 3 person actions
   (answer the recipient, turn on, allow the send; DESIGN §8.3) with the stub.
3. **Connections are sheets and an outbox for now.** Show each template's `data` columns in plain words and let the person drop in a
   CSV/JSON (the site would convert CSV to the JSON rows the stand-ins read) so the onboarding has a real data step without
   pretending to be a connector. Keep the word "connection" for later.
4. **Org onboarding can be real as document authoring**: a guided form over `constitution-v0` (entity, five layers, roles, people,
   bounds, one clause per rule with owner and exceptions), validated by `docProblems`/`boundProblems`, hashed, and shown with the
   change-control rule ("who can change this, and who cannot approve their own change"). Be explicit that enforcement on runs is
   not in the product yet and that the bed result is the evidence it can be.
5. **Do not present an e-mail address as an approver.** `expense-approval` and `lead-triage` send to people by e-mail; only the
   local person can approve in Foundry. The paid line begins exactly at "the approval must be that other person's".
6. **Reuse the inbox cards and the three decision channels as the visual centre**: the approval card (To, Subject, exact text,
   Send it / Don't send) is the most differentiated, already-built screen, and the diff card ("what changes from the version that
   is on now") is the second.
7. **Free/paid in the UI**: today a footer sentence. The design (DESIGN §7) puts it on the approval card ("Approver: you" vs
   "Approver: Finance lead (Control Plane)"), on a flow badge when a flow references a role, and never as a wall mid-build.
8. **Keys**: asked by name with one sentence of why, at the moment the builder is needed, optional; the Mercury path today is an
   environment variable named `INCEPTION_API_KEY` plus a token cap, and a $0 list price makes dollar caps meaningless
   (D8: <= 5M Mercury tokens total until the allowance is known; owner decision S5 to add Mercury to the policy for the real builder).

---

## 8. Blocking owner decisions and risks relevant to the build

- D13: no publishing of anything (site local only). S6 (publish a package/plugin) is not taken.
- S5/D8: Mercury is in `policy/models.json` (executorModels, 2026-10-21.1/.2), key owner-provisioned, <= 5M tokens total.
- D15: approver identity and the principal model are scheduled for the 11-04 engine bump; nothing here may claim second-authority
  enforcement before then (ATTACK-FABLE K-E).
- OT-0 paid arms are refused until the owner freezes `PREREG-OT0.md`; the A-F frontier comparator is unrun.
- The builder eval (24 cases) has no run and no prereg file in the repo; a capability number for "chat creation" does not exist.
- `README.md:129` and `research/org-20261021/README.md` §2.3: workflow hash, constitution hash and principal are not journaled by
  the product, which is why the evidence pack cannot yet be produced for a product run.
- Security boundary (DESIGN §6.4): same-OS-user agent with a shell can do what the person can; closing it needs a separate OS
  user, a second device, or the hosted control plane. The site must not imply otherwise.
- Working tree: `git status` shows only a run log modified (`research/composition-20261021/runs/cht-e8-1/load.log`); I changed no
  repo file.

---

## 9. Files read (all in /home/user/workflow-foundry)

AGENTS.md; README.md (1-200 plus greps); docs/THESIS.md (1-300 plus decisions grep); research/surface-20261021/DESIGN.md (all),
TEARDOWN.md (all), eval/cases.json (structure and case list); research/business-20261021/OPEN-CORE-AND-INVARIANTS.md (all),
ATTACK-FABLE.md (all); research/decisions-20261021.md (all); research/intent-20261021/DESIGN.md (1-230, greps);
research/org-20261021/README.md (1-260); research/automationbench-20261014/runs/DEV60-A0-A1.md (head and A1-C sections);
research/enterprise-20261014/B1-E8-DEV.md (grep); research/mercury-20261021/OFFICIAL-DEV60.md and PROVISIONING.md (grep);
research/compromises-20261021/FIXES.md (1-80); app/cli.mjs, app/core/{service,library,builder,builder-model,capabilities,explain,
ledger,practice}.mjs, stand-ins.mjs (head), app/core/templates/*.json (headers), app/mcp/server.mjs,
app/dashboard/{server.mjs,index.html,dashboard.js}, app/importers/n8n.mjs (exports), app/test/*.test.mjs (names);
web/index.html (ids), web/app.js (head); src/http.mjs (tail), src/mcp.mjs (tool names); bin/foundry.mjs (commands);
policy/models.json (providers and notes); experiments/constitution/{schema/constitution-v0.schema.json, instances/v1.json,
constitution,registry,port,shield,guard,observer,auditor,validity,report}.mjs (headers); tools/ui/README.md,
tools/run-view/README.md. No credential file was read; no network was used; no model was called.
