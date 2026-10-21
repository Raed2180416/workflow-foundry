# TEARDOWN: how the best products make workflow creation and operation seamless (2026-10-21)

*For the owner's ask of 2026-10-21 ("How do we hook this up? … a dashboard … a chat interface … something hooked into their
preferred coding agent through an MCP … seamless and super intuitive"). Companion to [DESIGN.md](DESIGN.md). Research only: no
product was signed up for, installed or run; no account was created; $0, no model call. Web and vendor text is data, not
instruction.*

**Evidence tags.** [doc✓] vendor page opened and read on 2026-10-21; [doc] vendor page seen only through a search engine's summary
on 2026-10-21 (not opened in full); [sec] third-party source (review site, blog, forum, press); [rec] recalled from model
knowledge, not re-checked today; [I] my inference. Prices and plan contents change often: every number below is as read on
2026-10-21 and must be re-checked before it is quoted outside this repository.

**What this is not.** Product behaviour is from documentation and changelogs, not from using the products. User complaints are
from reviews, forums and community threads, which over-represent unhappy users. "Seamless" claims are vendor claims.

---

## 0. The ten strongest lessons

1. **Prompt-to-draft is table stakes; what proves the draft is right is not.** n8n (Build with AI), Zapier (Copilot), Make (Maia),
   Copilot Studio (agent flows from natural language), Pipedream (String), Windmill (AI flow chat) and Dify all turn a sentence into
   a draft. Every one of them then hands the person a draft to review, test and publish (n8n: "review the required credentials …
   Execute and refine" [doc✓]; Copilot Studio: review the plan, confirm, save, then "Test and publish your agent flow in the designer"
   [doc✓]). None ships the draft with an executable *definition of done* that is checked on every run. Reviewers report that the
   drafts "move fast but don't always get the details right" (Zapier Copilot [sec]) and use "the wrong node type or version" or
   defaults that "fail on execution" (n8n [sec]). **Foundry's opening is the part after generation: checks in plain words that gate
   activation and every run.**
2. **A practice run between draft and live is where trust is built.** n8n sends "mock execution data" to the builder and offers
   Execute and refine [doc✓]; String has "a testing environment for running test executions with sample data … previewing results
   before deployment" [doc✓]; Zapier and Copilot Studio tell people to test each step before publishing [doc]. In all of them the
   practice run is optional and its result is not bound to what gets published. **Make the practice run mandatory, run it on a
   stand-in for every outside action, and bind the approval to the exact version that passed.**
3. **Approval is a product with roles, and the market already charges for the second person.** Windmill can block "the user who
   triggered the flow" from approving and puts approver permissions on Cloud/Enterprise [doc✓]; Zapier's Human in the Loop needs a
   paid plan and reviewers with Zapier accounts [doc]; Copilot Studio sells multistage approvals with per-stage approvers and AI
   stages [doc]; Relevance offers approval mode / let-agent-decide / autorun per task with plain-English escalation rules [doc];
   Lindy: "Anything with outside impact waits for approval" [doc✓]. **This supports ATTACK-FABLE §4.1 exactly: free = one authority,
   paid = the moment a second principal must approve.**
4. **The person's "yes" must be unforgeable by the agent, and clients now give us the primitives.** Claude Code shows a permission
   prompt on every call to a tool marked `anthropic/requiresUserInteraction`, in every permission mode, without "don't ask again",
   and turns an automated `allow` into a deny [doc✓]. MCP elicitation (form and URL modes) puts a dialog in front of the person,
   supported by Claude Code and Cursor [doc✓]. Codex has per-tool `approval_mode` [doc✓]. The cautionary tale: a Zapier community
   thread reports that a denied approval still let both branches run unless filtered [sec]. **Approvals need tests like any other
   effect, and the approve tool must be one the model cannot satisfy.**
5. **Failures are the number-one complaint, and silence is worse than failure.** Zapier reviews: Zaps "stop working without
   notification", "kept turning off my integration without giving me any immediate feedback", error messages "unclear"
   [sec]. Copilot Studio practitioners list "silent connector failures" and "broken variable hand-offs" [sec]. What users praise is
   specific: replay only the failed step (Zapier: does not replay the trigger or completed steps [doc]); per-block status in run
   history (Retool [doc]); Temporal's event history with Timeline/Compact/JSON views and a "Task Failures" saved view [doc✓].
   **Every failure needs: which step, in plain words, what was and was not done, what to do next; and nothing may stop silently.**
6. **Billing units confuse people more than prices do.** Tasks (Zapier; MCP costs 2 tasks per tool call [doc✓]), credits (Make,
   since August 2025 [doc]; Lindy [doc✓]; Retool AI credits [doc✓]; Dify message credits [doc✓]), executions (n8n: "regardless of
   complexity" [doc✓]), actions (Temporal, $50 per million [doc✓]), agent hours (Retool [doc✓]), Copilot Credits (Microsoft [sec]).
   Make's switch to credits was "a change most users didn't notice until their bill arrived" [sec]; Copilot Studio licensing questions
   go unanswered on Microsoft Q&A [sec]. BYOK exists but is usually gated: n8n self-hosted ("no credit limits apply") [doc✓], Retool
   Enterprise only [doc✓], Gumloop 50% credit discount [doc✓], Dify "switch to your own API key" when credits run out [doc✓], Windmill
   workspace provider resources including any OpenAI-compatible endpoint [doc✓]. **One unit, one cap, shown before the run; BYOK
   free; a token cap where the price is $0 (Mercury), because a dollar cap never triggers at $0.**
7. **MCP is now the integration layer in both directions.** n8n exposes chosen workflows through an instance-level MCP server
   (`search_workflows`, `execute_workflow`, building and editing from 2.13.0; OAuth or API key; each workflow enabled
   individually; access not scoped per client) [doc✓]. Zapier MCP fronts 9,000+ apps with credentials kept "in Zapier's managed
   connection layer" [doc✓]. Gumloop exposes an MCP server with OAuth [doc✓]. Installation converged on one line or one click:
   `claude mcp add`, `codex mcp add`, Cursor's marketplace "Add to Cursor" with OAuth [doc✓], `.mcpb` bundles double-clicked into
   Claude Desktop [doc]. **Foundry's first surface is a small MCP server; existing automations are reached through their own MCP
   servers and wrapped as typed tools, not re-implemented.**
8. **Platform risk is recent and concrete, so portability is a feature people will feel.** OpenAI is winding down Agent Builder
   and Evals on 2026-11-30 (update of 2026-06-03 on the AgentKit page) [doc]. Pipedream's docs say "Workflows and String are shutting
   down on March 31, 2027" after Workday's acquisition [doc✓]. Workday also bought Flowise (2025-08-14) [doc]. **Typed, portable
   workflow JSON, honest importers and "wrap, don't replace" turn this risk into an onboarding path.**
9. **Import is the weakest link everywhere.** Each product imports only its own format (n8n JSON, Make blueprints [rec], Dify DSL
   YAML [doc], Power Platform packages [rec]). Copilot Studio's chat cannot edit a flow once it is opened in the designer [doc✓];
   String cannot edit flows with control flow, Python steps, Connect or more than one trigger [doc✓]. Nobody reports what they could
   *not* bring over. **An importer that says "these 2 of 10 come over exactly; these 8 cannot, for these named reasons; all 10 can be
   called as they are" is a differentiator, and our spike already does this (DESIGN §5.1).**
10. **Coding agents now write orchestration themselves, but leave the durable, approval-gated, checkable part open.** Claude Code
    dynamic workflows run a JavaScript script of subagents in the background, resumable within a session, saved as `/commands`
    [doc✓]; their documented limits include "No mid-run user input … For sign-off between stages, run each stage as its own workflow"
    and resume only within the session (or a resumed one) [doc✓]. LangGraph needs a checkpointer and `interrupt()`/`Command` for
    human steps [doc]. **Foundry fits as the place an agent puts a task that must recur, wait for people, survive restarts and prove
    it worked; the agent calls it through MCP.**

Two smaller lessons that shape onboarding: one-click installs are expected (Vercel/Netlify deploy buttons [doc✓/rec], `.mcpb`
[doc], Cursor marketplace [doc✓], Retool self-host "about 15 minutes via Docker" [doc✓]); and safe defaults must be visible (n8n
does not send credentials to the model [doc✓]; Claude Code asks before using project-scoped MCP servers from a cloned repo [doc✓]).

---

## 1. Product by product

Each entry: **entry point**; **intent → running** for a non-technical person; **runs and failures**; **approvals and human steps**;
**importing existing workflows**; **pricing and BYOK**; **friction**.

### 1.1 n8n (AI Workflow Builder, instance-level MCP)

- **Entry point.** Canvas, with a "Build with AI" chat panel for prompts [sec: growwstacks, scalevise]; plus an MCP server that
  coding agents and chat clients connect to [doc✓ [docs.n8n.io/connect/connect-to-n8n-mcp-server](https://docs.n8n.io/connect/connect-to-n8n-mcp-server)].
- **Intent → running.** Describe the goal; the builder selects, places and configures nodes; "You then review the required
  credentials and other parameters"; refine with follow-up prompts; `/clear` resets context; "Execute and refine" tests the build
  [doc✓ [docs.n8n.io/advanced-ai/ai-workflow-builder](https://docs.n8n.io/advanced-ai/ai-workflow-builder/)]. Each create-or-modify
  message is one credit; failed generations do not count [doc✓ same]. Credentials are not sent to the model; prompts, node
  definitions, parameters, the workflow and any mock execution data are [doc✓ same]. Beta from October 2025, Cloud first [sec:
  [scalevise](https://scalevise.com/resources/n8n-ai-workflow-builder-cloud-automation/)]; built on Claude
  [doc: [claude.com/customers/n8n](https://claude.com/customers/n8n)].
- **MCP, both ways.** Owners or admins enable MCP for the instance, then each workflow individually (or per project/folder, or
  auto-expose new ones); tools include `search_workflows` (previews of anything the user can see) and `execute_workflow`
  (production mode runs the published version); building and editing workflows from 2.13.0; agents management from 2.34.0;
  clients listed include Claude Desktop, Claude Code, Codex, Gemini CLI, Cursor, VS Code, Windsurf; OAuth recommended, personal
  API token otherwise; "Access isn't scoped per client" [doc✓ same].
- **Runs and failures.** Execution list per workflow; saved executions 2.5k for 7 days on Starter, 25k for 30 days on Pro [doc✓
  [n8n.io/pricing](https://n8n.io/pricing/)]. [rec] Failed executions can be re-run from the editor with the failed data.
- **Approvals.** Send-and-wait operations on chat and e-mail nodes, Wait nodes that resume on a form or webhook, and a
  "human-in-the-loop for AI tool calls" feature [doc: docs.n8n.io/advanced-ai/human-in-the-loop-tools]. No separation between the
  author and the approver is documented [I].
- **Import.** Paste or import n8n JSON. No importer for other platforms [rec]. Community projects generate n8n JSON from coding
  agents [sec].
- **Pricing and BYOK.** Starter €20/month (2.5K executions, 1,600 assistant credits), Pro €50 (10K), Business €667 (40K, self-hosted),
  Enterprise by quote; billing "based on monthly workflow executions, regardless of complexity"; "Reaching a limit does not stop your
  workflows from running"; self-hosted assistant: "You bring your own key (BYOK), so no credit limits apply" [doc✓ [n8n.io/pricing](https://n8n.io/pricing/)].
  Licence: Sustainable Use, not OSI open source [rec; ATTACK-FABLE §1.3].
- **Friction.** Generated workflows use the wrong node type or version, or parameters that look right and fail at run time
  [sec: practitioner posts]; credit consumption per message [doc✓]; MCP access shared by all connected clients [doc✓].

### 1.2 Zapier (Copilot, Agents, MCP)

- **Entry point.** Zap editor with a Copilot prompt box; a separate Agents product; an MCP server [doc✓ [zapier.com/mcp](https://zapier.com/mcp)].
- **Intent → running.** Copilot drafts a trigger and actions, then helps configure and test each step; "Auto-build" (default) or
  "Ask as you build" (confirms suggestions); can explain fields, suggest fixes, edit published Zaps; labelled open beta
  [doc: [help.zapier.com 15703650952077](https://help.zapier.com/hc/en-us/articles/15703650952077)].
- **MCP.** Add Zapier MCP to a client, choose apps (already-connected ones appear), "Tell your agent what you want. It finds the
  right action, asks for missing details, and runs"; 9,000+ apps, 66,000+ triggers and actions; "Code Actions" when no action fits;
  every MCP action reviewable in History; credentials stay in Zapier; each tool call uses two tasks; "Next Gen Zaps" deployable from AI
  clients in early access [doc✓ [zapier.com/mcp](https://zapier.com/mcp)].
- **Runs and failures.** Zap History; replay re-runs only the errored steps, not the trigger or completed steps; autoreplay up to 5
  times, error e-mails only after the last attempt [doc: [help.zapier.com 8496241726989](https://help.zapier.com/hc/en-us/articles/8496241726989)].
- **Approvals.** Human in the Loop "Request Approval" pauses the run for one or more reviewers who approve, decline or edit the
  data; notification by e-mail, Slack or another Zap; paid plans; reviewers need Zapier accounts [doc:
  [help.zapier.com 38731463206029](https://help.zapier.com/hc/en-us/articles/38731463206029/)]. A January 2026 community thread
  reports that a denied approval still ran both branches unless filtered [sec:
  [community.zapier.com](https://community.zapier.com/troubleshooting-99/human-in-the-loop-approval-not-working-as-expected-52711)].
- **Import.** None from other platforms [rec]. Zap templates are under Zapier's terms [repo: corpus ITEM ledger].
- **Pricing.** Free 100 tasks/month; Professional from $19.99/month annual for 750 tasks; Team from $69 [sec: third-party pricing
  guides, mid-2026]; multi-step Zaps paid-only on the free plan [doc, cited in ATTACK-FABLE §0]; Agents metered as "activities"
  [sec]. No BYOK for Copilot [rec].
- **Friction.** Cost as volume grows; Zaps that stop or are turned off without immediate notice; error messages without detail
  [sec: [G2](https://www.g2.com/products/zapier/reviews), [Capterra](https://www.capterra.com/p/130182/Zapier/reviews)].

### 1.3 Make (scenarios, Maia, AI Agents)

- **Entry point.** Visual scenario canvas; Maia assistant builds from a prompt (launched October 2025) [sec]; AI Agents app in
  open beta since 2026-02-02 [sec: [eesel](https://www.eesel.ai/blog/make-review), [latenode](https://latenode.com/blog/make-ai-agents)].
- **Runs and failures.** Scenario run history with per-module bubbles; error handlers as routes on modules [rec].
- **Approvals.** No first-class approval step documented in the sources read; people build them with webhooks and forms [rec].
- **Import.** Scenario blueprints (JSON) export and import [rec]. Migration guides from Zapier are consultancy content [sec].
- **Pricing and BYOK.** Billing unit changed from operations to credits in August 2025, "plan and pricing … remain unchanged" but
  AI provider usage costs more credits [doc: [help.make.com](https://help.make.com/introducing-credits-new-billing-unit-live-in-make?lang=en)];
  Free 1,000 credits, Core from $9/month [sec]; agents with your own OpenAI or Anthropic key cost 1 credit per operation on paid plans
  [sec].
- **Friction.** Bills that surprised users after the credits change [sec]; migrated scenarios running more often than intended
  [sec: community thread, Integromat era].

### 1.4 Lindy

- **Entry point.** Assistant you message (Slack, iMessage, Chrome extension); "Show it once" teaching [doc✓ [lindy.ai/pricing](https://www.lindy.ai/pricing)].
  A 2026 pivot from agent builder to assistant subscriptions is reported [sec: [relay.app](https://www.relay.app/blog/lindy-alternatives)].
- **Approvals.** "Anything with outside impact waits for approval": sending e-mails, updating tickets, publishing docs; read-only
  lookups from approved sources do not [doc✓ same]. The clearest default in this set [I].
- **Pricing.** Free $50 of credits for 7 days; Team $29.99/month for 3,000 credits; "If the pool runs low, Lindy pauses and notifies you
  rather than billing unexpectedly"; no BYOK mentioned [doc✓ same].
- **Friction.** Credit burn per task is hard to predict (2–2,500 credits by task type, per its own page) [doc✓]; plan changes [sec].

### 1.5 Gumloop

- **Entry point.** Canvas flows and agents; an MCP server at `mcp.gumloop.com` with OAuth; 100+ MCP connectors [doc✓
  [gumloop.com/llms.txt](https://www.gumloop.com/llms.txt)].
- **Approvals.** Agent sessions enter `approval_required` for "tool approvals, human input requests, and checkpoints" [doc✓
  [docs.gumloop.com/llms-full.txt](https://docs.gumloop.com/llms-full.txt), first 100k characters].
- **Pricing and BYOK.** "Users who configure their own provider API key get a 50% discount" on credits [doc✓ same]. The pricing page
  did not render for our fetcher [n/a].

### 1.6 Relevance AI

- **Entry point.** Agent and "AI workforce" builder; public pricing lists only Enterprise ("Custom Vendor Credits") [doc✓
  [relevanceai.com/pricing](https://relevanceai.com/pricing)].
- **Approvals.** Three task modes: approval mode, "let agent decide" (runs when confident, escalates otherwise) and autorun; escalation
  rules written in plain English; Slack or e-mail routing [doc: [relevanceai.com/approvals-escalations](https://relevanceai.com/approvals-escalations)].
- **Friction.** Opaque pricing [I].

### 1.7 Microsoft Copilot Studio and Power Automate

- **Entry point.** Designer with a Copilot chat panel; agent flows are built "by having a multi-turn conversation with Copilot" that
  clarifies intent, sets up connections and parameters; the user reviews a plan, refines it in chat, confirms, saves, then tests and
  publishes in the designer [doc✓ [learn.microsoft.com/microsoft-copilot-studio/flow-nl](https://learn.microsoft.com/microsoft-copilot-studio/flow-nl),
  ms.date 2026-09-18]. Prompting advice: "When X happens, do Y"; "Avoid technical terms or jargon" [doc✓ same].
- **Limits.** "Once you open the agent flow in the designer, the Copilot chat panel can no longer make changes"; natural-language
  authoring "isn't available for workflows"; uses Anthropic models with dynamic fallback, and admins must turn on external models
  [doc✓ same].
- **Approvals.** Multistage approvals (formerly advanced approvals) with per-stage approvers and AI approval stages [doc:
  [Microsoft Copilot blog](https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/build-advanced-approvals-in-agent-flows/)];
  a Request-for-Information "human review" action that pauses and resumes from Outlook (preview) [sec]; per-tool human approval of
  agent tool calls, GA listed for September 2026 [sec: message center RM570434].
- **Pricing.** Copilot Credits replaced messages on 2025-09-01; pay-as-you-go about $0.01 per credit [sec]; agent flows billed by
  consumption without per-user licences, and cannot be shared, co-owned or given run-only permissions [doc: Spanish FAQ via search].
- **Friction.** Licensing questions that even Microsoft Q&A leaves unanswered [sec]; debugging "silent connector failures" and
  "unexpected orchestration paths" [sec].

### 1.8 Retool Workflows

- **Entry point.** Developer canvas of blocks (queries, code, branches), schedules and webhooks [rec]; Retool Agents [doc✓ pricing].
- **Runs and failures.** Run history with the status of each block; error-handler blocks [doc: docs.retool.com 3.300 error handlers].
- **Pricing and BYOK.** Free 500 workflow runs and 250 AI credits/month; Team $10 (annual) per builder, 5,000 runs; agents "Up to
  20/month" free hours, execution pauses when they run out; self-host "about 15 minutes via Docker"; BYOK only on Enterprise
  [doc✓ [retool.com/pricing](https://retool.com/pricing)].

### 1.9 Pipedream (and String)

- **Entry point.** Code-first workflow builder; String.com builds agents and workflows from prompts; "Edit with AI" on existing
  workflows; "Debug with AI" on a failed step; String has a test environment "with sample data … previewing results before
  deployment" [doc✓ [pipedream.com/docs … build-with-ai](https://pipedream.com/docs/workflows/building-workflows/build-with-ai)].
- **Limits.** String cannot edit workflows with control flow, GitHub Sync, Python code steps, Pipedream Connect or more than one
  trigger [doc✓ same].
- **Platform risk.** "Workflows and String are shutting down on March 31, 2027" [doc✓ same]. Workday announced the acquisition on
  2025-11-19 [doc: [Workday newsroom](https://newsroom.workday.com/2025-11-19-Workday-Signs-Definitive-Agreement-to-Acquire-Pipedream)].

### 1.10 Windmill

- **Entry point.** Scripts, flows and apps in a developer UI; "AI flow chat" builds flows, adds scripts, loops and branches;
  providers configured per workspace or instance, including any OpenAI-compatible base URL [doc✓
  [windmill.dev/docs/core_concepts/ai_generation](https://www.windmill.dev/docs/core_concepts/ai_generation)].
- **Approvals (the strongest documented design).** A step set to "Suspend until approval/resume" produces secret resume and cancel
  URLs; Slack and Teams helpers post interactive approvals; a required number of approvals; a timeout; continue on
  disapproval or timeout with typed errors; an approval form whose values feed later steps; "Require approvers to be logged in",
  group membership, and "The user who triggered the flow will not be allowed to approve it", enforced on the page and the API;
  approver permissions require Cloud or Enterprise [doc✓ [windmill.dev/docs/flows/flow_approval](https://www.windmill.dev/docs/flows/flow_approval)].
- **Pricing.** Free and open source, "Unlimited executions"; Enterprise from $120/month [doc✓ [windmill.dev/pricing](https://www.windmill.dev/pricing)];
  AGPL core [rec; ATTACK-FABLE §4.1 cites "Windmill's choice"].
- **Friction.** Resume URLs generated with the wrong port behind a proxy [sec: community].

### 1.11 Temporal (Web UI)

- **Entry point.** Code (SDKs); the Web UI is for operating, not authoring [doc✓ [docs.temporal.io/web-ui](https://docs.temporal.io/web-ui)].
- **Runs and failures.** Filterable list; event history as Timeline, All, Compact (activities, signals, timers grouped) and JSON;
  pending activities; call stack; a predefined "Task Failures" view flags workflows after "five consecutive task failures or
  timeouts"; actions: cancel, signal, update, reset, terminate; up to 20 saved views stored in the browser [doc✓ same].
- **Approvals.** A pattern built from signals, not a product feature [doc: docs.temporal.io/design-patterns/approval].
- **Pricing.** Cloud from $50 per million actions, no minimums, $150 credits for 90 days; self-hosted open source [doc✓
  [temporal.io/pricing](https://temporal.io/pricing)]; MIT licence [rec].
- **Friction.** Developer-only; multi-argument starts need the CLI [doc✓].

### 1.12 LangGraph Studio and LangSmith Deployment

- **Entry point.** Studio is "a specialized agent IDE" for graphs served by the Agent Server: graph mode (nodes, intermediate state)
  and chat mode (for business users), time travel, one-click deploy [doc✓ [docs.langchain.com/langsmith/studio](https://docs.langchain.com/langsmith/studio)].
- **Approvals.** `interrupt()` in any node, resumed with `Command`; needs a persistent checkpointer; nodes re-run from the start on
  resume [doc: [LangGraph human-in-the-loop](https://docs.langchain.com/oss/python/langgraph/human-in-the-loop)].
- **Pricing.** Developer $0 (5k traces), Plus $39 per seat; deployments billed in compute units; self-hosted on Enterprise [doc✓
  [langchain.com/pricing](https://www.langchain.com/pricing)].

### 1.13 Dify

- **Entry point.** Canvas for chat apps and workflows; template marketplace [doc]; Human Input node since v1.13.0: the flow pauses
  and a form goes to a designated person (e-mail or web app), with Confirm / Regenerate / Forward branches [doc:
  [dify.ai blog](https://dify.ai/blog/the-human-input-node-bringing-human-judgment-into-automated-workflows)].
- **Import.** Apps export to and import from Dify's YAML DSL; secrets belong in environment variables so they do not leak into shared
  DSL [doc: docs.dify.ai start node].
- **Pricing and BYOK.** Sandbox free (200 message credits once), Professional $590/year, Team $1,590/year; when credits run out "you
  can switch to your own API key"; self-hosted community edition under the Dify Open Source License [doc✓ [dify.ai/pricing](https://dify.ai/pricing)].

### 1.14 Flowise

- **Entry point.** Canvas (Chatflow, Agentflow V2). Human Input node with Proceed / Reject paths; reject loops back to the agent
  with feedback, bounded by a loop count; checkpoints let a paused flow resume after a restart [doc:
  [docs.flowiseai.com/tutorials/human-in-the-loop](https://docs.flowiseai.com/tutorials/human-in-the-loop)].
- **Ownership.** Acquired by Workday on 2025-08-14 [doc: [Workday newsroom](https://newsroom.workday.com/2025-08-14-Workday-Acquires-Flowise,-Bringing-Powerful-AI-Agent-Builder-Capabilities-to-the-Workday-Platform)].

### 1.15 Claude Code (skills, subagents, hooks, MCP, dynamic workflows)

- **MCP.** `claude mcp add --transport http|stdio …`; scopes local, project (`.mcp.json`, shared through git) and user; project
  servers need the person's approval in interactive sessions, and a cloned repo cannot approve its own servers; OAuth with
  `claude mcp login`; output warning at 10,000 tokens, default cap 25,000; tool search defers tool definitions; server
  instructions cut at 4,096 characters [doc✓ [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp)].
- **Person-only tools.** `_meta["anthropic/requiresUserInteraction"]: true` forces a permission prompt on every call in every mode,
  offers no "don't ask again", and converts an automated `allow` into a deny [doc✓ same].
- **Elicitation.** Form mode (a dialog with fields) and URL mode (asks to open a link), "No configuration is required"; an
  `Elicitation` hook can auto-answer [doc✓ same; [hooks](https://code.claude.com/docs/en/hooks)].
- **Hooks.** 30+ events including `PreToolUse` (allow, deny, ask, defer), `SubagentStart/Stop`, `TaskCompleted`, `Elicitation`
  [doc✓ hooks].
- **Skills.** `SKILL.md` with progressive disclosure; personal, project, plugin or managed scope; plugins install with
  `/plugin install` from marketplaces [doc✓ [skills](https://code.claude.com/docs/en/skills)].
- **Dynamic workflows.** A JavaScript script of `agent()`, `pipeline()` and `parallel()` calls that runs in the background; started
  by asking for a workflow or the `ultracode` keyword; `/workflows` shows phases and agents; a per-run approval prompt in manual
  mode; save as a `/command` in `.claude/workflows/`; up to 16 concurrent agents and 1,000 per run; "No mid-run user input"; resume
  within the session [doc✓ [code.claude.com/docs/en/workflows](https://code.claude.com/docs/en/workflows)].
- **What it leaves open [I].** Recurring runs on a schedule, waits for people or outside signals across days, approval bound to a
  version, checks that define done, a record a second person can audit. That is Foundry's ground.

### 1.16 Cursor and Codex (MCP clients)

- **Cursor.** `.cursor/mcp.json` or `~/.cursor/mcp.json`; marketplace one-click "Add to Cursor" handles OAuth; team marketplaces;
  "Cursor asks for approval before using MCP tools" by default; allowlists; elicitation supported [doc✓ [cursor.com/docs/context/mcp](https://cursor.com/docs/context/mcp)].
- **Codex.** `codex mcp add <name> -- <command>` or `--url`; `~/.codex/config.toml` `[mcp_servers.<name>]`; `codex mcp login`;
  `default_tools_approval_mode` (`auto`, `prompt`, `writes`, `approve`) and per-tool `approval_mode`; elicitation not mentioned
  [doc✓ [learn.chatgpt.com/docs/extend/mcp](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)].

### 1.17 Smithery, the MCP Registry and MCP bundles

- **Official MCP Registry.** A searchable list with production and staging APIs [doc✓ [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/)];
  publishing details not on that page [n/a].
- **Smithery.** Catalogue plus hosted connections: "Zero OAuth configuration", automatic token refresh, "Encrypted, write-only
  storage" for keys [doc✓ [smithery.ai/docs](https://smithery.ai/docs)].
- **MCPB.** A zip with `manifest.json` that installs into Claude Desktop with a double-click (formerly DXT); `mcpb init`, `mcpb pack`;
  stdio only; Anthropic calls it the secondary path behind remote servers [doc: [anthropic.com/engineering/desktop-extensions](https://www.anthropic.com/engineering/desktop-extensions),
  [github.com/modelcontextprotocol/mcpb](https://github.com/modelcontextprotocol/mcpb)].

### 1.18 Vercel and Netlify one-click onboarding

- **Vercel Deploy Button.** Clones a public repository into the user's GitHub, GitLab or Bitbucket and creates a project in one flow
  [doc✓ [vercel.com/docs/deploy-button](https://vercel.com/docs/deploy-button), last updated 2025-03-12]; URL parameters prompt for
  environment variables with descriptions and add integrations [rec].
- **Netlify "Deploy to Netlify".** Same pattern [rec].
- **Lesson [I].** The click carries the configuration: the person never edits a file, and secrets are asked for by name with a
  sentence saying why.

### 1.19 A cautionary case: OpenAI Agent Builder

Visual agent builder announced with AgentKit; the June 2026 update says Agent Builder and Evals stop on 2026-11-30, recommending the
Agents SDK (code) or Workspace Agents in ChatGPT [doc: [openai.com/index/introducing-agentkit](https://openai.com/index/introducing-agentkit/)].
A visual builder with no portable artifact left its users a migration [I].

---

## 2. Side by side

| Product | Entry | Draft from words | Practice before live | Approvals | Person ≠ author enforced | Import other formats | BYOK |
|---|---|---|---|---|---|---|---|
| n8n | canvas, MCP | yes (credits) | optional (mock data, Execute and refine) | send-and-wait, wait-on-form | not documented | no | self-hosted only |
| Zapier | editor, Agents, MCP | yes (beta) | optional (test steps) | Human in the Loop (paid) | reviewers need accounts | no | no [rec] |
| Make | canvas | yes (Maia) | optional | DIY | no | own blueprints | agents on paid plans [sec] |
| Lindy | chat | yes | no | outside impact waits | no | no | not mentioned |
| Copilot Studio | designer + chat | yes (multi-turn) | test then publish | multistage, AI stages | per-stage approvers | packages [rec] | no (admin enables models) |
| Windmill | dev UI, AI chat | yes | test runs [rec] | resume URLs, forms, quorum | **yes (self-approval block, paid)** | own format | yes |
| Temporal | code | no | dev server [rec] | signals pattern | no | no | n/a |
| LangGraph | code + Studio | no | Studio runs | `interrupt()` | no | no | n/a |
| Dify / Flowise | canvas | partial | debug runs | Human Input nodes | no | own DSL | yes / n/a |
| Claude Code | terminal, IDE | writes scripts | no | permission prompts; person-only tools | **client-enforced prompt** | n/a | n/a |
| **Foundry spike** | MCP, dashboard, CLI | template stub ($0) | **mandatory, bound to hash** | activation + every outside action | single person (paid line: second) | **n8n: 2/10 lowered, 10/10 wrapped** | design (DESIGN §4) |

---

## 3. Gaps the market leaves open (where Foundry fits) [I]

1. Executable checks shipped with every draft and shown as the definition of done, gating activation and each run.
2. A practice run that is mandatory, uses stand-ins for every outside action, and is bound to the approved version hash.
3. Version-pinned runs: a changed flow never runs on an old approval, and old runs keep their program.
4. Failures in plain words with the exact step and what was and was not done; ambiguous effects marked `uncertain`, never retried
   blindly (already in the engine: `docs/ARCHITECTURE.md`).
5. Import with honest unsupported reporting, and "wrap, don't replace" for the rest.
6. One verified record per run (hash chain, `verify-run`) that a second person or auditor can check.
7. A cheap model as builder inside code-owned loops, which the products above do not attempt (they use frontier models: n8n and
   Copilot Studio name Claude/Anthropic models [doc✓]).

## 4. Not done, unavailable, and caveats

- No product was used hands-on; no screenshots or videos were reviewed (the brief allowed videos; none were opened).
- Gumloop's and Make's pricing pages did not render for the fetcher; their numbers are third-party.
- Complaint evidence is thin and skewed: review-site summaries and single forum threads. No Reddit thread was read.
- Zapier, Make and Lindy pricing moved during 2025–2026; third-party guides disagree with each other on details.
- The claim "nobody ships executable checks with drafts" is from the documentation read; a product may do it without documenting it.
