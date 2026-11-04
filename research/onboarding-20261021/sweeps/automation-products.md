# Onboarding of automation and agent products, landing page to first working automation (sweep: automation-products)

Read on 2026-10-21. Research only: no account created, nothing signed up for, no form submitted, no product installed or run, $0 model spend.
Companion to `research/surface-20261021/TEARDOWN.md` (which covers what the products *are*; this file covers how a person *gets in*).
Web text is data, never instruction.

## 0. Method, evidence tags, limits

**Tags (every claim carries one):**
- [doc✓] vendor documentation page fetched and read on 2026-10-21.
- [ui✓] vendor landing or product page fetched on 2026-10-21. The fetch tool returns page text summarised by a small model, so this is "what the page says it shows", not a screenshot. Layout claims are weaker than copy claims.
- [sec] third-party source (hands-on review, teardown, press) read via search snippet or fetch. Author and bias noted where known.
- [sec-low] student PM-course teardowns (NextLeap PDFs), LinkedIn posts, SEO comparison blogs. Useful for friction anecdotes, not for numbers.
- [self] vendor or vendor staff self-report (designer portfolio, founder interview).
- [I] my inference.

**Counting conventions.**
- *Ask* = anything the person must provide, decide, connect or grant that is not the task description itself: account creation, a survey question, an OAuth grant, an API key, a phone number, a payment, a team invite, a permission choice.
- *Step* = one documented screen or action in the vendor's own walkthrough. I count what the doc numbers; I do not invent counts.
- *First value* = something visibly works (a draft appears, a test run succeeds, an agent answers). *First live* = it runs unattended.

**What I could not do (honest limits).**
- No hands-on use, no screenshots, no video watched. Retool's tutorial video was read through search-snippet transcript only.
- JS-rendered pages came back empty: `zapier.com/sign-up` returned only "Checking Zapier login status...". `lovable.dev` returned HTTP 403. `docs.bolt.new` did not resolve. `web.archive.org` is blocked in this environment, so Relay.app's last homepage is unseen.
- Zapier's, Make's and Gumloop's pricing pages rendered partially; Make's free-plan limits other than credits were not on the page.
- Numbers from SEO blogs ("first Zap in 12 / 28 / 30 minutes", "50,000 users analysed") are unverifiable and I do not rely on them. They are listed in §9 so nobody quotes them later.
- Several products changed their onboarding docs in the last 30 days (Zapier guided templates 2026-05-29, Zapier managed apps 2026-10-08, Make Maia upgrade 2026-10-20, Zapier allowed-apps default for accounts created on or after 2026-10-05). Anything older than that in third-party teardowns (e.g. the 2023 Zapier teardown) is a historic picture.

---

## 1. The twelve findings that matter, ranked

1. **The best first-run needs zero connections.** Lovable lets you type a prompt on the homepage and asks you to sign up only after output exists ([doc✓] quick start: "type your prompt on the homepage first, and Lovable asks you to sign up when you submit, keeping your prompt through sign-up"; [sec] supademo: activation "before I've created an account", about 2-3 minutes). n8n's own quickstart is built to need no credentials at all (a sample weather API, "Mockingbird"; [doc✓]). Google Workspace Studio needs no connection step because identity is already the Google account ([doc✓]). Make's Maia, when the account had no Slack connection and no free Data Store space, rewrote the plan around built-in tools twice and still produced a run: 1 operation, 1 credit, under a second ([sec] Teknexia Hub, 2026-08-15). Everyone else asks for OAuth before the person has seen anything work.
2. **Every chat builder converged on "clarify, plan, build visibly, review, test, publish", and the good ones expose the ask-me-vs-just-do-it dial.** Make Maia 2026-10-20: Build mode asks one question at a time and builds after each approval; Plan mode asks everything up front, shows modules and assumptions, checks connections, app capabilities and plan-tier access, and builds nothing until approved ([doc✓] make.com blog). Zapier Copilot: "Auto-build" (default) vs "Ask as you build" ([doc✓]). Bolt: **Plan** vs **Build now** ([ui✓]). Power Automate: "Keep it and continue" gate, then a connections gate with green checks and red exclamation marks, then "Create flow" ([doc✓]).
3. **Tests in this category are not rehearsals; they do the real thing.** Zapier's own guide: "When you test your Zap, Zapier will perform the action in your action app... a new row will be added to our spreadsheet", "the email will actually get sent", and the trigger test needs "one real instance of your trigger" to already exist ([doc✓ via search snippet of the vendor page] zapier.com/resources/guides/quick-start/create-zap). Make's Run once, Activepieces Test Flow, Workspace Studio Test run and Power Automate test all run live steps. The exceptions are thin: n8n's builder loads "mock execution data" ([doc✓]), String has "sample data" ([doc✓]), and Replit gives a real **sandbox** for Stripe then a promote-to-live step ([doc✓]). A practice world with stand-ins for every outside action is a real gap, and it also solves the cold-start problem (no real trigger data yet).
4. **Connection asks land at five different moments; the in-chat card and the go-live moment are the good ones.** (a) Before building: Lindy (5 setup steps before the first task), Gumloop's Gumball rail, Zapier's 2023-era "select the apps you use" survey. (b) At the node when needed: Zapier, Make, n8n, Activepieces editors. (c) After generation as a checklist gate: Power Automate green/red connections, n8n "review the required credentials", Zapier Copilot sidebar list of things it could not do. (d) In-chat card: Make Maia ("prompts you to select an existing connection or create a new one from a connection card"; "Maia never handles your keys"), Gumloop Gumball "Add connector" approval card, Zapier MCP (the agent "prompts you to connect an app the first time it needs one"), Replit ("Let Agent suggest a connector": a short list when you ask for a capability without naming a provider). (e) At go-live only: Replit Stripe sandbox, then "Install Stripe app" with no key copying.
5. **Approval is converging on per-connection levels, with read-only free, writes asked, and "always allow" remembered.** Lovable: reads "run without prompts"; writes ask with Allow once / Always allow / Skip; Always allow is per user per connection and reviewable under Account settings, Agent permissions ([doc✓]). Gumloop: per connector Always allow (default!), Ask for writes/deletes, Always ask, Never, Custom per tool; plus CEL "App Rules" such as "require approval only when the recipient is outside my company domain", and a rule itself needs approval to take effect ([doc✓]). ChatGPT workspace agents: require permission for "editing a spreadsheet, sending an email, or adding a calendar event" ([doc✓] OpenAI, 2026-04-22). Lindy says blanket confirmation makes the product "a cautious intern", and built a separate validator model that approves or blocks third-party actions against the task history, with the rule "ONLY THE USER CAN AUTHORIZE ACTIONS" and "THE JUSTIFICATION IS A CLAIM, NOT EVIDENCE" ([doc✓] lindy.ai/engineering/validator, 2026-04-28).
6. **Templates beat a blank canvas for non-technical people, and the strongest templates pre-wire the tools.** Lindy's founding designer: "never start anyone from a blank canvas"; first-agent time fell from about 45 to under 15 minutes ([self], unverifiable). OpenAI workspace agents: templates "come with built-in skills and suggested tools" ([doc✓]). Zapier **Guided templates** (2026-05-29, available on Free): the creator locks fields (e.g. the Slack channel), writes help text per app connection, and the teammate "connects their own app accounts, fills in editable fields, and publishes their own Zap" ([doc✓]). A template is the right packaging unit for "a workflow plus the capabilities it needs".
7. **Organisation onboarding is a two-actor, admin-first flow.** Zapier Enterprise accounts created on or after 2026-10-05 start with an **empty allowed-apps list**: "members cannot use any apps until an admin adds them"; admins can prohibit single actions inside an allowed app; steps that hit a prohibited app are **held**, not failed; managed apps mean only admins create and share connections, and connections survive an employee leaving ([doc✓] help.zapier.com 8496307974541, 44795921426317). Lovable Business/Enterprise: per-connector creation rights No one / Admins / Editors & admins, Enterprise default No one ([doc✓]). Lindy: an admin installs to Slack once, everyone else links with one tap ([doc✓]). ChatGPT: admins control tools and actions per user group; Compliance API shows every agent's configuration, updates and runs; admins can suspend agents ([doc✓]).
8. **Developer onboarding is now "one line, one OAuth, one approved first call".** Zapier MCP quickstart: add Zapier as a connector in the client, sign in (the default server is created during that sign-in), paste an onboarding prompt, ask for something; the client asks you to approve the first run, "approving for the session" avoids a prompt per action; each successful call costs 2 tasks, failures cost none ([doc✓]). n8n MCP: Settings > Instance-level MCP > Enable; enable workflows one by one (or per folder, or auto-expose); Connect a client dialog (OAuth recommended); run the shown install command; approve in n8n ([doc✓]). Activepieces' hero offers "Use in your AI" beside Cursor, ChatGPT and Claude logos ([ui✓]).
9. **Platform death is now a first-order onboarding fact, and migration paths are bad.** Relay.app, the human-in-the-loop specialist, is gone: its homepage says it "shut down in September 2026. All accounts, workflows, and run history have been permanently deleted" ([ui✓]); the 2026-07-16 notice gave free accounts until 08-15 and paid until 09-14, and the export was a folder per workflow with a markdown "rebuild prompt", a structure JSON and run CSVs that "won't work through their native importers" ([sec] ShadowGen/automationatlas, flagged biased; getinboxzero corroborates the dates). Pipedream: "Workflows and String are shutting down on March 31, 2027. Pipedream Connect is not affected and remains fully supported" ([doc✓] pipedream.com/docs/pricing and build-with-ai); deletion on 2027-04-30 and "secrets are not included in exports" are [sec]. The market's migration idiom is "here is a prompt, rebuild it". That is what Foundry's builder does natively.
10. **Billing legibility at the first-value moment is poor, and silence about caps is a trust breaker.** Make warns per schedule: "Running every 5 minutes = 288 credits per day" ([doc✓]). Lindy "pauses and notifies you rather than billing unexpectedly" (TEARDOWN, [doc✓]). n8n Gateway credits: nodes "fail once the balance hits zero" ([doc✓]). Gumloop, per student teardowns: "three inconsistent credit systems across three screens", Standard vs Advanced AI node about 2 vs 20-30 credits with no preview ([sec-low]). Lovable shows a credit counter early, "monetization pressure during habit formation" ([sec] supademo).
11. **Surveys that do not change the experience are the most-criticised onboarding element.** n8n: persona survey "not used" ([sec-low]); Zapier 2023: company size, role and an app picker "helps Zapier judge revenue potential" ([sec] lascabritas substack 2023-11-23); Lovable: role survey with "no visible skip option and no explanation of why the answer matters" ([sec] activatefirst audit, 58/100); Gumloop: "How did you hear about us?" at step 2 ([sec-low]). The two surveys that *do* change something: Lindy's role pick re-ordered the template dashboard ([sec] Obvio 2025-01-12), and Zapier uses selected apps to recommend Zaps ([sec] 2023).
12. **Dynamic capability brokering already exists in two places and nobody has made it safe by construction.** Zapier MCP **agentic mode**: 16 meta-tools, the agent "searches for, enables, and runs actions as your requests come up" with no documented approval before enabling, auto-provisioning covers only your own connections; **managed mode**: fixed toolset, "no ability for the agent to enable new ones", field values lockable ([doc✓] docs.zapier.com/mcp/how-tools-work). Gumloop: Tool Discovery "Auto", custom MCP servers added through an approval card. Windmill: per-chat assistant settings choose tools, skills and MCP servers ([doc✓]). The owner's question ("do nodes get the MCP servers and skills they need, is that where adaptivity comes in?") has an existing-art answer: yes, and the products split on whether the person approves the capability grant (Gumloop, Lovable: yes; Zapier agentic: not documented).

---

## 2. Product by product

For each: entry, asks in order, steps to first value, test and trust surfaces, org onboarding, risks. Foundry implications are in §7, not repeated here.

### 2.1 Zapier (editor + Copilot, Agents, MCP, Guided templates, Enterprise governance)

**Landing** [ui✓ zapier.com]. Headline "Zapier: Build and Govern AI Workflows, Agents, and Apps"; "Trusted by 3 million+ businesses"; primary CTA "Start free" (to /sign-up), secondary "Talk to sales". No prompt box, no template gallery, no prices on the page. The page sells governance (Action Restrictions, BYOM, Managed Connections, Domain Restrictions, App Access Controls, Guided Templates, SCIM, Log Streaming) and "Smarter workflows. Smaller bills." Section order: cost story, MCP/SDK/agents, governance split into Control / Delegation / Visibility, security certifications (SOC 2 Type II, SOC 3, GDPR, CCPA), four customer stories. The page leads with *org* buyers, not the first-time builder.

**Sign-up and first screens.** Sign-up page itself is JS-rendered and unreadable here. Historic picture [sec 2023]: OAuth with Google/Facebook/Microsoft or email, then onboarding questions (company size, role, a searchable list of 6,000+ apps with "at least five" recommended), then a dashboard with a beta prompt box and recommended Zaps; no product tour; builder validates "4 steps" per app (app and event, account, trigger, test), one CTA per step with green checks; upgrade pop-up on publishing a multi-step Zap and a credit card request at that point. Current emails [sec] sequenzy.com: day 0 founder welcome + "book a call"; day 1 "Build your first Zap workflow with Copilot - Just describe what you want to automate"; day 4 template push; day 12 "trial ends in three days"; day 18 "3 months of Professional for $10".

**Free tier now** [doc✓ zapier.com/pricing]: 100 tasks/month, two-step Zaps only, Copilot with a daily message limit (beta), Agents 400 activities/month with a 10-activity per-run cap, MCP included (2 tasks per call); "14-day free trial of Professional" for new accounts, "no credit card required"; Professional from $19.99/month annual, $29.99 monthly. During a free trial only the first 30 steps of a Zap run ([doc✓] Copilot article).

**Editor path (documented stages):** create Zap, add trigger, configure, test trigger (needs real sample data), add action, configure and map fields, test step (performs the real action), publish ([doc✓] quick-start guide; the community list of the same eight stages [sec]). Connections: "you'll be prompted to sign in to your app account if you haven't connected it before... Zapier will ask for a general set of permissions". About 8 stages, 2 OAuth grants for the canonical form-to-sheet example.

**Copilot path** [doc✓ help.zapier.com 15703650952077, open beta]: prompt box at top of a new Zap, "Start Building", Copilot sidebar opens; modes Auto-build or Ask as you build; it auto-picks a connected account per app (prefers the one matching your Zapier email, then most used, then any you can access) and asks to connect only if none fits; you can dictate or attach a file or image; clock icon saves a **checkpoint**, "Revert" restores; the sidebar lists things Copilot cannot do and you must finish; "Publish" top right. Enterprise with publishing restrictions: an admin may need to approve before publish. Limits: 100 steps per Zap.

**Agents** [doc✓ help.zapier.com 24393442652557]: sign up at agents.zapier.com, "+ New agent", choose custom (instructions; "Skip this step" allowed) or template ("Use this template"), **"Connect your apps"** step (create a connection per listed app or reuse), "Create", then Configure (trigger, tools, optional knowledge, Test), "Publish". About 5 steps. Statuses [doc✓ 36818600959501]: In progress, Completed, Failed, Cancelled, **Needs action** ("requires your input to continue running": expired app connection, deleted document, unclear instructions, or an approval step you configured), Test (testing activity). Landing for agents [ui✓ zapier.com/agents]: "Get started free", "See templates" with named starter agents (Meeting Prep, Zendesk Ticket).

**MCP** [doc✓ docs.zapier.com/mcp/quickstart, /home, /how-tools-work]: three sections (connect client, set up tools, run first action); needs a Zapier account; OAuth default; the default server is created at sign-in; apps already connected to Zapier are auto-enabled; with none connected the server starts empty and an onboarding prompt shows what is enabled and gives sign-in links; the agent can enable an app during the first request; client asks approval for the first run; sharing a server requires Team or Enterprise; Streamable HTTP only. Credentials "stay in Zapier's managed connection layer instead of being passed into the model" [ui✓].

**Trust surfaces.** Per-step test data preview; Zap History with replay of only errored steps (TEARDOWN); Agents Activity with statuses; MCP actions reviewable in History. Real-effect tests, no stand-in world.

**Org onboarding** [doc✓]: Enterprise setup checklist = domain verification, SAML SSO, SCIM, teams; domain capture; app policies (allowed apps list, empty at creation, whole suites recommended, deny delete on systems of record, block raw API request actions); managed apps and managed connections (admin creates and shares; shield icon; survive offboarding); allowed domains for connections; BYOM; Zap approvals before publish; audit log; alerts; Zapier Manager; transfer ownership and offboard users. App policies apply to Zaps **and Agents and MCP**.

**Friction.** Test actions send real emails; trigger needs pre-existing real data; surveys; upgrade friction at multi-step; error silence (TEARDOWN lesson 5).

### 2.2 Make (scenarios, Maia)

**Landing** [ui✓ make.com/en]: "Build and manage AI agents and automations in one visual landscape"; CTAs "Try it free", "Talk to sales"; "No credit card required", "No time limit on free plan"; hero says "by prompt, drag-and-drop, or from Claude, ChatGPT, and any other AI chat"; no prompt box, no template section on the page (Templates Library in the footer); six feature cards (Workflow Builder, Observability, Custom code, MCP Server, AI Agents, Governance); 500,000+ teams; SOC 2 Type II.

**Free** [doc✓ pricing]: 1,000 credits/month. Maia: public beta on all paid plans; Free gets a 30-day trial from signup ([doc✓]).

**Get started** [doc✓ help.make.com]: three guides: Learn the basics, Create your first scenario, Expand your scenario. The first-scenario guide needs a Make account, a Slack account and workspace, and a Google account, "all free to create"; it builds Google Sheets "Watch New Rows" to Slack; ten numbered steps ending in "Step 10. Schedule your scenario" (default every 15 minutes, with a credit-cost warning table), then "Activate scenario" ([doc✓]). Connection creation: "Click the giant plus", pick app and module, "Create a connection", Save, then a window "prompts you to grant Make access to your data". Verify and Reauthorize live under Credentials. Limit: 100 scenarios/day/team, 2 MB per scenario.

**Maia path** [doc✓ help.make.com/introduction-to-maia-by-make, /maia-by-make-best-practices, make.com/blog 2026-10-20]: "+ Create scenario" top right; chat on the left of the Scenario Builder; describe the goal (images allowed: 3 per session, PNG/JPEG/WebP, 1.5 MB); Maia narrates and builds on the canvas; connection cards in chat; **Run once** to test (best practices say to test before activating); every Maia change is a version in chat, "Revert to this version"; sessions kept 15 days, "Continue where we left off"; Memory up to 50 facts of 200 characters per user per team (apps used, detail level; never credentials); Save before leaving; "Resolve error" turns a failed run into a fix you review. Cannot see other scenarios. Enterprise owners can switch Maia off. About 3 asks before a running scenario: goal, answers to clarifying questions, connection per app.

**Hands-on report** [sec Teknexia Hub 2026-08-15, automated-browser test, one prompt]: "Every day at 9am, send me a Slack message" produced two clarifying questions (DM or channel; IANA timezone, rejecting "local device"), a written plan, a confirmation request, then a Slack connection request; with no Slack connection it proposed a Data Store alternative (three more questions), hit "Not enough space in storage", and finally used a built-in Tools "Set variable" step: Success, under 1 second, 1 operation, 1 credit. The reviewer's conclusion: slower than Zapier's single prompt but fewer misreadings. [sec] LinkedIn post (2026-03-14): Maia waits for confirmation before creating labels or Slack channels and diagnosed Airtable schema loading.

**Trust surfaces.** Visible canvas, run history with operations and credits, version revert in chat, Plan mode approval. **Gap:** no first-class approval step (TEARDOWN); the 2026 comparison listing says Make's review app is Enterprise-only and in closed beta ([sec] ShadowGen, biased).

**Friction.** Learning curve claims (competitor blog says ~19 hours of Make Academy; biased [sec]); credit anxiety.

### 2.3 n8n (Cloud, self-hosted, AI Workflow Builder, instance MCP, Gateway credits)

**Landing** [ui✓ n8n.io]: "Build the agent. Understand its workflow."; CTAs "Get Started", "Talk to sales"; the hero is a non-interactive canvas demo of the prompt "When a refund request comes in, look up the order. Then ask me in Slack whether to refund it or open a ticket." (an approval-in-chat workflow is the headline example); three example tabs; sections on governance ("See + understand + trust your agents"), documentation and recovery, "Testing and safety: Move fast + break nothing"; 208.1k GitHub stars, G2 4.7.

**Choice at the door** [doc✓ choose-how-to-use-n8n]: Cloud = "start right away", "No installation needed", suggested for non-technical users; self-host = "full control", "Takes longer to set up".

**Cloud sign-up** [sec KodeKloud notes + doc✓ trial page]: credentials + human verification, short optional questionnaire (apps you expect to use; how you heard), invite teammates (skippable, later under Settings > Users), about one minute provisioning, a "Start automating" button over a tutorial video thumbnail, then the canvas. A student teardown counts 9 screens, 3-20 minutes before the canvas depending on whether the 14-minute video is watched [sec-low]. Trial: 14 days of Pro features, 1,000 executions; at expiry "n8n deletes your instance", 90 days to download workflows; payment only at upgrade ("Choose a plan", monthly or annual) [doc✓].

**Self-host first run.** `npx n8n` (npm installs deprecated from n8n 3.0 and the Assistant is unavailable there; port 5678), or Docker (`docker volume create n8n_data` then `docker run ... -p 5678:5678 ... n8nio/n8n`; the page itself says it is outdated and recommends Compose) [doc✓]. First launch: an **owner sign-up screen**; password at least 8 characters with a number and a capital; SMTP optional but "if you skip this step, users can't reset passwords"; owner can be pre-provisioned from environment variables (2.17.0+) [doc✓]. Windmill's and Activepieces' first launches are similar (§2.5, §2.6).

**Quickstart** [doc✓ docs.n8n.io/try-it-out/quickstart]: "Weather Log", six steps: create workflow, Schedule Trigger at 8 AM, HTTP Request to a sample API (no key), Edit Fields node, data table insert, then Execute workflow and **Publish**. Per-node "Execute step". No credential created. Designed so the first run needs nothing from the person.

**AI Workflow Builder** [doc✓]: pick an example prompt or describe; "real-time feedback through several phases"; "review the required credentials and other parameters", refine with follow-ups, "Execute and refine" button; one credit per create-or-modify message, failures and stops free; `/clear`. Sent to the LLM: prompts, node definitions, parameters, connections, the workflow, **mock execution data**; not sent: credential details, past executions. Reviewers report wrong node types or versions and parameters that "fail on execution" (TEARDOWN [sec]).

**Credentials** [doc✓ create-and-edit-credentials]: Create > Credential, choose app, enter details, "When you save a credential, n8n tests it". OAuth vs API key not explained in that page. **Gateway credits** [doc✓, n8n >= 2.36.0, Cloud Starter and Pro only]: in a supported node's credential field choose **Use Gateway credits**, no provider account or API key; supported nodes sit in an "Included in n8n" section; free trials include some credits; zero balance means nodes fail; owner can turn it off.

**Templates** [doc✓ use-templates]: library on n8n.io/workflows; "you may need to fill in credentials and adjust the configuration"; self-hosted orgs can point `N8N_TEMPLATES_HOST` at their own library.

**MCP** [doc✓ docs.n8n.io/connect/connect-to-n8n-mcp-server]: nine steps split 5 in n8n (enable instance MCP, expose workflows in one of five ways, optionally agents, optionally restrict callback URLs) and 4 in the client (Connect a client dialog, pick Claude Code under CLI, run the shown command, authenticate and approve). API-key alternative shows the token once. "Access isn't scoped per client."

**Org.** Projects, shared credentials, end-user credentials (Enterprise); SSO and RBAC are paid.

### 2.4 Pipedream (Workflows, String, Connect)

[doc✓ pipedream.com/docs/pricing and /workflows/building-workflows/build-with-ai] Build-with-AI lives on String.com ("Edit with AI" redirects there); the AI helps with auth and connections, parameters, data mapping; String has a test environment with sample data; "Debug with AI" on a failed step; cannot edit flows with control flow, GitHub Sync, Python steps, Connect or multiple triggers. **"Workflows and String are shutting down on March 31, 2027." "Pipedream Connect is not affected and remains fully supported."** Connect [doc✓ /docs/connect]: managed auth for 3,000+ APIs, "handle authorization or accept API keys on behalf of your users", tokens encrypted at rest, Connect Link and Client SDK, end users identified by `external_user_id`. [sec] Announcement dated 2026-09-30; data deleted 2027-04-30 including connected-account tokens; export is workflow JSON with no importer elsewhere. Workday acquired Pipedream (announced 2025-11-19, TEARDOWN).

**Why it matters for onboarding:** the surviving product is the connection layer, which is exactly the part users hate to build, and the workflow editor that sat on top of it is being retired.

### 2.5 Activepieces

**Landing** [ui✓ activepieces.com]: "AI Agents with enterprise control"; CTAs "Start building", "Talk to sales"; "Use in your AI" beside Cursor, ChatGPT and Claude; free plan, no card; "Your first flow can ship this afternoon"; agent panel placeholder "Give the agent a task..."; sections on approval gates for sensitive steps, chat-drafted flows, enterprise controls (SSO, audit logs, bring-your-own AI keys), 760+ MIT-licensed pieces, MCP server, tables, knowledge base. The cloud sign-up page itself shows a chat-style demo ("Tell me what you need... (@ to mention, : for emoji)", an assistant reply "Added a branch: failed payments now send you a direct message the moment Stripe reports them") [sec Exa snippet of cloud.activepieces.com/sign-up].

**Install** [doc✓ docs/install/overview]: Docker Compose recommended (PostgreSQL + Redis), Helm, Cloud "Fastest"; one command `curl -fsSL https://get.activepieces.com | sh`; needs Docker Compose v2; port 8080; back up the generated `.env`. Admin sign-up screen not described in the page.

**Chat (beta)** [doc✓ docs/ai/chat]: open Chat from the sidebar, "Be specific about the outcome rather than the steps"; it picks pieces, wires steps, asks which account to use before building; "You can review every step before publishing"; the result is a normal flow, editable by hand. Does not describe testing or approval inside Chat.

**Quickstart** [sec: third-party doc mirror, not vendor-fetched]: Create Flow, trigger (Webhook/Schedule/App/MCP Tool), action, "+ New Connection" (API key, OAuth or connection details), Test Flow (watch execution, click each step for input and output, "test runs don't count against your execution limits"), Publish (DRAFT to ENABLED); published version stays "Locked" and runs while a new draft is edited; Runs tab shows green tick or red X per step.

### 2.6 Windmill

**Landing** [ui✓ windmill.dev]: "Code-first orchestration platform for internal software"; CTAs "Try Windmill cloud", "Self-host in 3 mins"; AI agents on 12 providers or any OpenAI-compatible endpoint; "Scope what each team can access" (integrations, permissions, MCP, tools, skills); "Review before deploying to prod" (forks, review, staging, prod, rollback); "See each run, and why it failed"; 10,003 instances claimed; SOC 2 Type II.

**First run.** Cloud: no credit card, GitHub/GitLab/Google/Microsoft SSO [doc✓ getting_started]. Self-host: three files and `docker compose up -d`, open `http://localhost`; first-login password `changeme`; you are redirected to Instance settings, told to **create a new account that overrides the default superadmin**, syncing resource types from Hub, then create the first workspace [doc✓ advanced/self_host]. **New** button offers Script (default), Flow, full-code app, Workflow-as-Code, Data pipelines (alpha) [doc✓]. Flows quickstart: eight stages (settings, steps, wire inputs, loops/branches/retries/approval, triggers, test "up to step x", deploy) [doc✓]. Approvals: secret resume and cancel webhooks; self-approval block is a paid feature (TEARDOWN).

**AI** [doc✓ ai_generation]: AI flow chat; "Nothing runs until you press Run"; providers configured by workspace settings or once per instance by superadmins; "base URL and API key of any AI provider that is OpenAI API-compatible" (Ollama example); per-chat assistant settings choose tools, skills and MCP servers; admins can hide the assistant.

### 2.7 Lindy

**Landing** [ui✓ lindy.ai]: "Hire Lindy, get it done."; CTAs "Try for free", "Book a demo"; no prompt box; "Setup in 2 minutes", $50 free credits, no card; Team from $49.99 for 5,000 pooled credits, top-ups $10 per 1,000; "Nothing irreversible happens without your approval"; channels Slack, iMessage, email, Chrome extension; SOC 2, HIPAA badges.

**Quickstart** [doc✓ docs.lindy.ai/start-here/quickstart], **five setup steps in two parts:** (1) admin "Add Lindy to Slack"; (2) everyone "links with one tap": first DM or @mention gets a "Connect Slack to Lindy" button; (3) connect Google or Microsoft email and calendar; (4) add a phone number with a verification code (or Apple Messages); (5) connect tools (1,000+). Then "Try it": ask for calendar, draft a reply, schedule, summarise a meeting. No explicit test step and no approval step described on that page. Five asks before the first task.

**Older builder path** [sec Obvio Studio teardown 2025-01-12]: signup form (Gmail button buried), a role pick that reordered templates, an offered custom-agent setup call, a template canvas ("Lead Generator") with sticky notes explaining nodes, draft mode "nothing goes live until you hit Save", test by chatting ("find me 10 developers in colorado"), live "thinking" trace, upgrade prompt right after impressive results.

**Design lessons** [self Zack Gemmell; doc✓ lindy.ai/engineering/validator; sec ZenML]: templates not blank canvas; agent logic as a flowchart you can try in a sandbox; "For anything with real consequences... the agent stopped and waited for a person to approve"; Lindy 1.0 (big prompt field plus tools) was unreliable and 2.0 constrained the model: "constraining agents actually makes them both more reliable and easier for users to understand", "Put Shoggoth in a box"; edits users make to proposed actions are saved, embedded and retrieved as examples ("poor man's RLHF"). **Validator** (2026-04-28): internal rogue-action incident (unrequested calendar invites to real people); validator returns approved, reasoning, confidence, suggestedNextStep; 60 test cases (33 should block, 27 allow), a 540-run matrix (3 prompts x 3 model sizes), zero false positives allowed on financial and exfiltration actions, 75% accuracy and at most 25% false positives on general ones; replies to the user are exempt as low-risk.

### 2.8 Relay.app (shut down)

[ui✓ relay.app] "Relay.app has shut down... September 2026. All accounts, workflows, and run history have been permanently deleted"; no reason given; link to an archived July 2026 homepage (unreachable here). [sec] timeline: 2026-07-16 notice, signups and upgrades off, subscriptions cancelled, paying customers keep access to 2026-09-14 with extra steps and AI credits, free accounts deleted 2026-08-15; export under Settings > "Export workspace data" (up to 24 h to generate, link expires after 48 h, run CSVs truncate at 100,000 rows). Recommended alternatives were scored on one question, whether a human can **edit** an AI draft mid-run: Zapier yes (reviewer needs an account), n8n yes (Wait and Form nodes), Gumloop pause but no edit, Activepieces approve/reject only, Lindy weaker, Make review app Enterprise-only closed beta. [I] A product whose whole pitch was human-in-the-loop approvals did not survive; the category still lacks reviewer-edits-inside-Gmail-or-Slack, which the same source says none of the six does.

### 2.9 Gumloop

**Landing.** Fetch returned the site's llms.txt summary, not the page [n/a]; tagline "the multiplayer AI agent builder"; links Templates, MCP servers and integrations, Enterprise (SSO, audit logging, VPC).

**Flow as seen by reviewers** [sec-low, three student teardowns and two LinkedIn posts, 2026-04/05]: SSO-only sign-up (Google or Microsoft), profile name, role question, "How did you hear about us?", about seven feature toggles with no explanation, a credit incentive loop (connect apps, credits jump 700 to 1500), a welcome choice "Start with template" or "Build from scratch", a blank canvas with "Add your first node", Gmail OAuth step that "hangs forever with no error or retry" for one reviewer, Standard vs Advanced AI node (about 2 vs 20-30 credits) with no preview, a run with logs and a credits counter as the aha. One 20-minute test said "the core value never showed up" because onboarding ended before any agent ran; scores 38/100 on a PM "Psych Framework". Treat as friction anecdotes.

**Docs** [doc✓ docs.gumloop.com]: **Gumball** is "the personal agent that comes with every Gumloop account", appears the first time you open it, right rail = Accounts, Connectors, Triggers, Personalization; reachable by email (gumball@gumloop.ai), text and a Slack DM with no setup; asks for connectors only for what you turn on (Gmail or Outlook for Smart Inbox on Pro, calendar for Meeting Prep, Slack); **Daily Chew** is read-only, failures are per source, first run looks back 16 hours, "Reports are never sent twice"; Smart Inbox "never sends email", only drafts; paste an **MCP link** and Gumball "checks the link, tells you whether the server signs in with OAuth", then shows an **Add connector** card (Server URL, Name, Visible to) to approve or reject.
**Custom agent in three moves** [doc✓]: connectors (+ Add, Account defaults to "Use Personal Default", team default available), instructions (optional; "let the agent write its own later"), a real task; then ask the agent to save the approach as instructions or a skill; optional Evaluations and Reflections; deploy via Channels (Email Inbox, Slack, Teams, Hosted Page, Developer, MCP); Triggers (App, Webhook, Scheduled, One-Time, Create With AI). Defaults: most abilities on, self-improving instructions on, Max Steps 100, up to 10 concurrent subagents. **Approvals** [doc✓ human_in_the_loop]: per connector Always allow (the default), Ask for writes/deletes, Always ask, Never allow, per-tool Custom; CEL App Rules; Ask Question ability with choice cards plus "Other"; approvals surface in chat, bell, a Tasks "Approval Required" filter and Slack; "Approval requests keep their assigned approver".

### 2.10 Retool Workflows

**Landing** [ui✓ retool.com/products/workflows]: "Build automations. Deploy to production. Governed by default."; CTAs "Start for free", "Book a demo"; four numbered how-it-works steps (triggers, connectors, custom logic, one-click deployment); "Browse our template library"; AI section (AI-powered assistance, generative AI blocks, native OpenAI, Anthropic, Azure, Bedrock); no prompt box, no mention of Agents on that page. Conceptual quickstart [doc✓ docs.retool.com/workflows/quickstart]: nine headings, no numbered tutorial; "You must publish a workflow release before it can run automatically." Run logs per block, error handlers. A 13:37 tutorial video (2025-11-24) walks create workflow, start trigger, resource query against Retool Database, blocks (AI Actions, Agents, code), loops, triggers (schedule, webhook, Kafka, SQS), run and logs, publish with staging/production versions [sec: video chapter list]. Free: 500 runs; BYOK Enterprise only (TEARDOWN). **First value requires a resource (data connection) and a developer mindset;** no chat-first path documented on these pages.

### 2.11 Microsoft Power Automate and Copilot Studio

**Power Automate Copilot** [doc✓ learn.microsoft.com/power-automate/create-cloud-flow-using-copilot, ms.date 2026-09-18]: sign in, Home, **Create with Copilot**, field "What will your flow do?" (prompt format "When X happens, do Y"; mention the connector; Copilot suggests refinements as you type), send, Copilot returns a suggested trigger and actions, **Keep it and continue** or add details, then a **connections gate** (green check = configured, red exclamation = needs attention, click to fix), **Create flow**, designer opens with a Copilot pane on the right (follow suggestions, ask "What does my flow do?"), Save, "we recommend that you test it". Ten numbered steps; the only asks are the work sign-in and fixing each red connection. Copilot appears "if your organization has AI enabled". "Troubleshoot in Copilot" explains failed test or run-history errors. Environments: "Make sure that you're in the correct environment before you create a flow... You can't easily move components from one environment to another" [doc✓ getting-started], an org concept a solo user never needed.

**Copilot Studio quickstart** [doc✓ ms.date 2026-09-22]: sign in or sign up for a trial; **"Turn off New experience"** to reach the standard-harness Home (the quickstart itself instructs this); describe the agent (up to 1,024 characters), "AI generates the name, description, and instructions" and "suggests triggers and channels, knowledge sources, and tools. You can ignore, accept, or dismiss these suggestions. They don't persist beyond the current session"; add a knowledge source; test in the chat panel, edit instructions, retest; edit the intro message; **Publish** to a demo website. The trial licence "can't publish the agent". Topic authoring with Copilot supports only Message, Question and Condition nodes. TEARDOWN covers agent flows and multistage approvals.

### 2.12 Google Workspace Studio (formerly "Flows")

[doc✓ support.google.com/workspace-studio/answer/16448469] Go to studio.workspace.google.com; "Describe a task for Gemini" box ("include when it should start, which apps to use, and what steps it should take"; good prompt "Notify me in Google Chat whenever I get an email from person@example.com", bad prompt "Handle emails from person@example.com"); **Create**; Gemini generates steps; edit, reorder, delete, add; add a **variable** when a step needs data from an earlier one; **Test run** then Start, "Run Completed"; **Turn on**. Six steps, **no connection step documented** (already inside the Google identity). A flow has one starter (schedule or event). Admin policy can require user approval on some steps; a copied flow's approval steps prompt the new owner when it runs; AI features unavailable to under-18 school accounts, and shared flows lose AI steps for them. Org onboarding is the Workspace admin turning the product on; the user page says it works "only if your organization supports it".

### 2.13 Notion Custom Agents

[doc✓ notion.com/help/custom-agent] Sidebar **Agents**, "+" (or a "personalized and interactive walkthrough"); **three starts: Create with AI chat** (describe the job, review the draft instructions, triggers and access Notion AI generates), **from a template**, **Create blank**; write instructions (job and outcome first, then steps, inputs, outputs, examples); **Triggers** (recurring with a "check the next scheduled run" preview, Notion events, Slack events where "A Slack admin must first connect Slack"); **Tools and access**: add specific pages or databases ("Linking to pages in instructions does not grant access to them"), web access toggle, Slack scopes and channels; model (Auto recommended; admins may restrict); **Share** (Full Access, Can Edit, Can View and Interact); test in Chat; **Activity** shows each run's trigger, actions and errors; "Save and publish"; **Version history** with restore; Business or Enterprise only; premium models spend credits and sub-agent hand-offs raise cost. No approval or confirm-before-acting mode is documented; "reviewable, reversible runs" is the stated safety story.

### 2.14 ChatGPT workspace agents (OpenAI, 2026-04-22; added because it is the incumbent for "describe it")

[doc✓ openai.com/index/introducing-workspace-agents-in-chatgpt] Click **Agents** in the sidebar, "describe a workflow your team does often" or "just drop in a file", "ChatGPT will guide you step by step": define the steps, connect the right tools, add skills, test until it works. Templates with "built-in skills and suggested tools" for finance, sales, marketing. Runs in the cloud on a schedule or in Slack. "You decide what tools and data it can use, what actions it can take, and when it needs approval." Admin: per-group tool and action control, who can use, build and share; Compliance API for configuration, updates and runs; suspend agents; analytics (runs, users). Credit pricing from 2026-05-06; "research preview" while the headline says generally available.

### 2.15 "Describe it" builders (Lovable, Bolt, v0, Replit, Base44)

**Lovable.** [doc✓ docs.lovable.dev quick start] Sign up (email, Google, GitHub, Apple) or type on the homepage first and be asked to sign up on submit with the prompt kept; prompt box "Ask Lovable to create..." with a Build mode picker; first version "a few minutes"; editor = chat left, live preview right; versions restorable "so nothing you do next can break it permanently"; point-and-edit; checklist "click every button... Mobile view"; **Publish** to a free `lovable.app` URL; seven steps, about ten minutes, free plan 5 credits/day up to 30/month. Their own prompt advice: keep the first version "free of logins and databases so there is less to go wrong". **Plumbing:** the backend is provisioned for you ("By default, the built-in backend is enabled"); an **Enable Cloud** permission is Always allow, Ask each time or Never allow; with Ask each time the SQL is shown and approval awaited; region choice is irreversible; destructive changes default to Never allow; Secrets page, and "When a service needs a key, such as Stripe, Lovable prompts you to add it"; account-based services (Google) "connect through Connectors" [doc✓ features/cloud]. Connectors [doc✓ integrations/app-connectors]: connect once, use in chat, in the build and in the published app; "Managed by Lovable" credentials for some; workspace-level, private by default, shareable; Allow once, Always allow, Skip; reads run unprompted. [sec] Third-party sequence of a typical account (supademo): homepage prompt, output, create account, workspace, four steps, "no email verification wall, no required integration, no template to browse first"; role and team-size questions after sign-up; suggested prompts vanish after signup. Contradicting detail [sec aiuxplayground 2026-06-16]: a four-step wizard (theme, name, role, company size) with no skip, then a connectors tour modal ("Build from what you already use") before the composer. [sec activatefirst] audit 58/100: Google 2-step redirect with no progress indicator, a blank white OAuth callback, a mandatory role survey. [sec Candu 2026-09-27] "Agentic onboarding... converts by doing the work on the first prompt", visibility defaults to Public.

**Bolt.** [ui✓ bolt.new] "What will you build today?"; prompt box "Let's build a prototype..." with **Plan** and **Build now**; project-type tabs; "or start from Figma, GitHub, Team template"; "Get Started" in the header and hero; Bolt Cloud (databases, auth, hosting) sold as built-in. Docs [doc✓ support.bolt.new]: Plan Mode "talk through your idea with Bolt before it writes any code", "Build one step at a time", Bolt Database, "Choose an agent".

**v0.** [doc✓ v0.app/docs/quickstart] four steps (sign in, new chat, describe, review and iterate); integrations via Project menu > Settings > Integrations or by prompting "Connect a database to my app" (Neon, Supabase, Upstash, Blob); AI Gateway "automatically configures your API key using your Vercel account"; for external APIs "The integration wizard will prompt you to add your API keys after generation".

**Replit.** [doc✓ docs.replit.com/features/integrations/overview] four integration classes: **Replit managed** (no setup, databases, auth), **Connectors** (sign in once, reused across apps), **External** (you provide API keys), **Agent services** (paid APIs billed to credits, no keys). "Let Agent suggest a connector" shows a short list when you ask for a capability without naming one. Stripe [doc✓]: Agent starts a **sandbox**, "build and try flows immediately", go live by installing the Replit Integrated Payments app from Stripe, which "connects your live account automatically - you don't need to copy or paste API keys" and may walk you through KYB; Stripe is on paid plans only and "Agent prompts you to upgrade when it proposes the connector".

**Base44.** [sec hostadvice review 2026-09-08] homepage "What would you build today?" box with suggestion chips; sign-up by Google or email plus a six-digit code, no card; dashboard with a big prompt, Integrations and Templates menus; "Styling Instructions" presets; "Creating Your App" log that first outlines a plan then ticks off steps; backend functions only on paid plans.

---

## 3. Tables

### Table A: path to first value (what is documented, not what is claimed)

| Product / path | First value | Documented steps | Asks before first value (in order) | Connections needed | Notes |
|---|---|---|---|---|---|
| Lovable | app appears | 4 (sec) / 7 to publish (doc) | prompt; then sign-up; then role (and maybe theme, name, company size) | 0 | ~2-3 min to output [sec], ~10 min to publish [doc claim] |
| Bolt | app appears | 3-4 | prompt, sign-up on "Get Started" | 0 | Plan vs Build now |
| n8n quickstart | run + insert row | 6 | instance (Cloud signup or self-host), nothing else | 0 (sample API) | built to need no credentials |
| n8n Cloud signup | canvas | ~6 screens | credentials, verification, questionnaire (optional), invites (skippable), ~1 min wait | 0 | 14-day trial, instance deleted at expiry |
| Google Workspace Studio | test run ok | 6 | Google identity only | 0 documented | approvals per admin policy |
| Copilot Studio | agent answers in test chat | 6 + publish | work/school sign-in or trial; turn off New experience | 0-1 knowledge source | trial cannot publish |
| Power Automate Copilot | saved flow | 10 | work sign-in, prompt, accept plan, fix red connections | 1 per app | environment concept |
| Make (editor) | scheduled scenario | 10 | Make account + Slack + Google accounts | 2 OAuth | credit table on scheduling |
| Make (Maia) | run once ok | 3-4 turns | goal, clarifying answers, approve plan/step, connection card | 1 per app, or none if built-ins | Plan vs Build mode |
| Zapier (editor) | published Zap | ~8 stages | account, (2023: role, size, apps), 2 OAuth grants, real trigger sample | 2 | test performs real action |
| Zapier (Copilot) | drafted Zap | ~5 | prompt, accept auto-picked accounts, connect missing | 0-2 | Auto-build vs Ask as you build |
| Zapier Agents | published agent | ~5 | account, instructions, connect apps, test | per app | Needs action status |
| Zapier MCP | first tool call | 3 | Zapier account, client OAuth, app connections, first-call approval | per app | 2 tasks/call |
| n8n MCP | first tool call | 9 | enable, expose workflows, client dialog, command, OAuth approve | 0 | per-workflow exposure |
| Lindy | first task answered | 5 setup + try | Slack admin install, link, email+calendar, phone code, tools | 4-5 | setup claimed "2 minutes" |
| Gumloop | Gumball or custom agent | 3 moves (doc), 7+ screens (reviewers) | SSO, role, referral, toggles, connectors | per feature | per-connector approval presets |
| Notion Custom Agent | agent run | 9-10 sections | choose start (chat/template/blank), instructions, triggers, access grants, model, share | Slack optional | Business/Enterprise only |
| ChatGPT workspace agent | agent runs | chat-guided | describe job, connect tools, test | per tool | admin gates |
| Windmill | script/flow run | 8 (flow) | cloud SSO or self-host + superadmin override + workspace | resource per app | developer-first |
| Retool Workflows | published workflow | 9 concepts | account, resource (data connection), blocks | 1+ | developer-first |
| Activepieces | flow enabled | ~6 | cloud signup or one-line install, trigger, "+ New Connection" | per app | chat builder asks which account first |

### Table B: what they ask to connect, when, why

| Moment | Examples | What the person experiences | Verdict [I] |
|---|---|---|---|
| Before the task | Lindy quickstart (Slack, email/calendar, phone, tools); Gumloop role/app toggles; Zapier 2023 app picker | an inventory of accounts before any value | worst: cost paid with no proof |
| At the node | Zapier, Make, n8n, Activepieces editors | per-step OAuth popup mid-flow | normal; breaks flow, no preview of what will be done |
| As a gate after the draft | Power Automate (green/red), n8n credentials review, Zapier Copilot sidebar | one checklist, then go | good: person has seen the plan |
| In-chat card at point of need | Make Maia, Gumball "Add connector", Zapier MCP, Replit provider list | "connect X so I can do Y" next to the thing it unblocks | best for asks |
| At go-live | Replit Stripe sandbox to live; Lovable publish; n8n Gateway credits vs own key | sandbox first, real credential last | best for risk |
| Never (platform holds it) | Workspace Studio (identity), Lovable Cloud/"Managed by Lovable", Replit managed, v0 AI Gateway, n8n Gateway credits | zero asks | best for first value; limited to what the vendor owns |
| Admin once, members never | Lindy Slack, Zapier managed apps, Lovable Enterprise connectors | members see no connection screen | right for orgs |

### Table C: templates vs chat vs blank canvas

| Product | Default entry | Others | Evidence |
|---|---|---|---|
| Lovable, Bolt, v0, Base44 | prompt box | templates secondary | landings, docs |
| Make | canvas + Maia chat (beta) | templates library | docs |
| Zapier | editor; Copilot prompt box on top of new Zap | templates, Guided templates | docs |
| n8n | canvas, guided quickstart | AI builder (credits), templates library | docs |
| Lindy | Slack chat (new); template canvas (old) | none blank by design | docs/self |
| Notion | three equal choices: AI chat, template, blank | walkthrough | docs |
| ChatGPT workspace agents | chat-guided | templates with tools | doc |
| Power Automate | Create with Copilot (if admin enabled) | Templates, blank | docs |
| Copilot Studio | describe-it box (if environment supports) | classic create | docs |
| Gumloop | Gumball chat; welcome modal template or scratch | Create With AI trigger | docs/sec-low |
| Windmill, Retool, Activepieces | code-first / canvas | AI chat | docs |

### Table D: trust surfaces

| Product | Test before live | Approvals | Run record | Undo / rollback |
|---|---|---|---|---|
| Zapier | per-step tests, real effects; Agents Test | HITL paid; Agents "Needs action"; Enterprise Zap approvals before publish | History, replay errored steps; Agents Activity | Zap versions/drafts; Copilot checkpoints |
| Make | Run once (real) | none native | history with ops and credits | Maia version revert |
| n8n | Execute step/workflow; mock data in builder | send-and-wait, wait nodes | execution list | version history [rec] |
| Activepieces | Test Flow, free of limits | approve/reject piece | Runs tab per step input/output | draft vs locked |
| Windmill | test up to step; "nothing runs until you press Run" | suspend, resume URLs, forms | per-run trace | fork, staging/prod, rollback |
| Lindy | sandbox chat; draft until Save | outside-impact approval + validator | Tasks tab with step I/O | n/a documented |
| Gumloop | real task first; Evaluations | per-connector presets, CEL rules, Ask Question | Tasks, Activity | n/a documented |
| Power Automate | test after save | Approvals app, multistage (TEARDOWN) | run history + Troubleshoot in Copilot | n/a documented |
| Workspace Studio | Test run then Turn on | per admin policy | not documented here | undo/redo in editor |
| Notion | test in chat | none documented | Activity per run | version history |
| Lovable | live preview | Enable Cloud ask/never; connector Allow once/Always | version list | restore any version |
| Replit | Stripe sandbox | upgrade prompt on paid connectors | n/a | n/a |
| ChatGPT agents | testing in builder | per sensitive step | Compliance API, analytics | admin suspend |

### Table E: capability brokering (the owner's "nodes get the tools they need" question)

| Mechanism | Product | Who decides | Notes |
|---|---|---|---|
| Fixed toolset chosen in advance | Zapier MCP managed mode | person | agent cannot add; field values lockable; no skills |
| Agent discovers and enables tools | Zapier MCP agentic mode | agent (approval not documented) | 16 meta-tools, own connections only |
| Tool discovery "Auto" + connector presets | Gumloop | agent, bounded by per-connector presets | MCP link added via approval card |
| Per-chat scoped tools, skills, MCP | Windmill | person/admin | assistant settings |
| Capability suggested from a short list | Replit | person picks provider | then sign in once |
| Plan degrades to what is available | Make Maia | agent proposes, person confirms | built-ins when connection missing |
| Admin allowed-apps list | Zapier Enterprise, ChatGPT, Lovable | admin | empty by default (Zapier new accounts) |
| Template carries tools | OpenAI, Zapier Guided templates | template author | consumer connects own accounts |

### Table F: first-run for self-hosters (solo developer persona)

| Product | Command | First screen | Gotchas |
|---|---|---|---|
| n8n | `npx n8n` or Docker | owner sign-up (password rules) | npm deprecated at 3.0, no Assistant; SMTP for resets |
| Windmill | 3 files + `docker compose up -d` | login with default password, forced superadmin override, workspace create | default creds are public |
| Activepieces | `curl -fsSL https://get.activepieces.com \| sh` | admin sign-up (not described in install doc) | Docker Compose v2, port 8080, back up `.env` |

---

## 4. Patterns worth stealing, each with evidence

1. **Prompt on the homepage; sign-up after the first output.** Lovable, Base44 (box before sign-up) [doc✓, sec].
2. **First run that cannot fail because it needs no connection.** n8n quickstart (sample API), Workspace Studio (identity is the connection), Maia falling back to built-ins [doc✓, sec].
3. **Plan then build, with a visible dial.** Maia Build/Plan; Zapier Auto-build/Ask as you build; Bolt Plan/Build now [doc✓, ui✓].
4. **The plan screen checks feasibility before building.** Maia Plan "checks connections, app capabilities, and plan-tier access on the go" [doc✓].
5. **A connection gate after the draft, with traffic-light status.** Power Automate [doc✓].
6. **In-chat consent cards that show exactly what is being added.** Gumball Add connector (Server URL, Name, Visible to) [doc✓].
7. **Per-connection permission ladder with remembered "always allow" and a settings page to review it.** Lovable (Agent permissions), Gumloop presets [doc✓].
8. **Conditional approval rules in a small expression language that themselves need approval.** Gumloop CEL App Rules [doc✓].
9. **Sandbox first, real credential last, promotion without copying keys.** Replit Stripe [doc✓].
10. **Admin-owned shared connections that outlive the employee.** Zapier managed apps [doc✓].
11. **Template with locked fields and per-connection help text.** Zapier Guided templates [doc✓].
12. **Held, not failed, when policy changes under a running automation.** Zapier prohibited apps: "steps that use the prohibited app will be held" [doc✓].
13. **Reversible by default: every AI change is a version.** Lovable, Maia revert, Zapier Copilot checkpoints, Notion version history [doc✓].
14. **Read-only first features for the personal agent.** Gumball Daily Chew read-only; Smart Inbox drafts but never sends [doc✓].
15. **Cost shown where the decision is made.** Make schedule table of credits per interval [doc✓]; Zapier MCP "Failed calls don't count" [doc✓].
16. **"Needs action" as a first-class run state rather than "Failed".** Zapier Agents statuses [doc✓].
17. **Honest empty default.** Zapier new Enterprise accounts start with no allowed apps; Lovable Enterprise default No one [doc✓].
18. **Fail independently.** Gumball's Daily Chew writes the report with one source marked failed; "only advances its 'last read' marker for sources that actually succeeded" [doc✓].

---

## 5. Anti-patterns, each with the product that shows it

1. Tests that perform real side effects with no stand-in (Zapier, Make, Activepieces) [doc✓].
2. Needing a pre-existing real record before the trigger can be tested (Zapier) [doc✓].
3. Mandatory surveys with no skip and no visible effect (Lovable role wizard, Gumloop referral, n8n persona) [sec].
4. A long passive video on the path (n8n 14 minutes) [sec-low].
5. External-identity detours with no progress indicator (Lovable Google 2-step; blank OAuth callback page) [sec].
6. Connection step that hangs without error or retry (Gumloop Gmail, one reviewer) [sec-low].
7. Three different credit units on three screens (Gumloop, reviewer) [sec-low]; hidden per-node costs.
8. Default "Always allow" on every connector (Gumloop) [doc✓]; the default is the dangerous end.
9. Trial that can build but not publish (Copilot Studio) or deletes your instance at expiry (n8n) [doc✓].
10. Onboarding docs that tell you to switch off the vendor's new experience (Copilot Studio quickstart) [doc✓].
11. Pre-launch wizards that precede any product (Lovable role/theme/name wizard) [sec].
12. Hero without the product: Zapier, Make, Lindy, Retool, n8n show no live prompt; only Lovable/Bolt/Base44 put the product on the landing [ui✓].
13. One builder surface per capability, with hard edges: Copilot chat cannot edit a flow once opened in the designer; String cannot edit flows with control flow [doc✓ TEARDOWN].
14. Export that is not importable: Relay JSON "won't work through their native importers"; Pipedream JSON export has no target [sec].
15. A confirmation on every action, until people stop reading (Lindy's own diagnosis: "a cautious intern") [doc✓].
16. A beta label as the safety story with no reviewer-edit path (Notion: no approvals documented) [doc✓].

---

## 6. Asks inventory (what each product makes the person provide, when, why)

(See the structured output for the machine-readable list. Narrative summary.)

- **Identity** (all): Google/Microsoft/GitHub/Apple/email. Timing varies: before output (Zapier, Make, n8n, Lindy, Gumloop SSO-only) or after output (Lovable).
- **Profile questions**: role, company size, apps used, referral. Timing: right after identity. Benefit: personalisation that is rarely visible.
- **Per-app OAuth**: at node (editors), in-chat card (Maia, Gumball), after-draft gate (Power Automate), upfront (Lindy).
- **Phone number** (Lindy, Gumloop text): verification code, to meet the person in their messaging channel.
- **Slack admin install** (Lindy, Notion Slack triggers, Gumloop Slack, ChatGPT agents in Slack): admin step then one-tap member link.
- **API keys**: for external services (Replit External, v0 external APIs, Make non-OAuth apps); avoided by "managed" credentials (Lovable Managed, n8n Gateway credits, v0 AI Gateway, Replit Agent services).
- **Payment**: at upgrade (n8n checkout, Zapier trial no card, Make free no card), never at first value in most; Replit gates Stripe connector to paid.
- **Team invite**: n8n onboarding screen (skippable).
- **Environment/workspace choice**: Power Automate environment, Windmill workspace, Make team, Retool space.
- **Approval policy**: Gumloop presets, Lovable Enable Cloud, ChatGPT sensitive-step toggles, Make Plan/Build.
- **Region/data residency**: Lovable (irreversible choice), Activepieces cloud Frankfurt, Make EU.
- **Credit/plan awareness**: Lovable, Lindy, Make.

---

## 7. Implications for Foundry (inference, [I])

These are my conclusions from the evidence, not findings. They are shaped by the repo's decisions (D2 free = one authority, D9 Claude Code first, D10 local-first, D11 BYOK, D13 nothing published, local site only).

1. **Make "first value with zero connections" the headline of onboarding.** Foundry already owns a practice world (stand-ins for every outside action). Nobody in this sweep gives a person a safe, realistic first run before OAuth; the closest are n8n's sample API, Replit's Stripe sandbox and mock execution data. Order: (a) describe or paste, (b) see the plan and a practice run on stand-ins, with the checks in plain words, (c) only then a connection gate listing exactly which real accounts replace which stand-ins ("Go live: connect these 2"), (d) first real run under a cap. This turns the usual worst moment (cold OAuth) into the last, best-informed one, and it fixes Zapier's "needs a real record before you can test" and "test sends a real email".
2. **Offer the Plan/Build dial as a first-class setting** (Maia and Zapier both do), default to Plan for anyone with outside effects, Build for pure reads. Make Plan check "connections, capabilities, tier" plus Foundry's extra: "what cannot be checked yet".
3. **In-chat consent cards for every capability grant**, carrying what is added, to whom it is visible, what it can read and write, what it costs, and a revoke link. Gumball's card is the template. For the owner's node-capabilities ask, treat MCP servers, skills and CUA as the same object: a *capability grant* with a ladder (read free, write ask, irreversible bound to the approved version, never) and a remembered per-connection "always allow for reads". Adaptivity then means: when a node lacks a capability, the builder proposes the next-best plan (Maia's built-ins fallback) and asks for the grant only if the person wants the better plan.
4. **Approval design.** Do not default to "always ask" (approval fatigue; Lindy's "cautious intern") and never default to "always allow" (Gumloop). Use the ladder, plus a validator that is not the model's own claim ("the justification is a claim, not evidence"), plus the approve action being one the model cannot satisfy (already D9/TEARDOWN lesson 4). Run the validator as an *evaluated* component: Lindy's 60-case, 540-run matrix and zero-tolerance on financial or exfiltration actions is a ready-made acceptance bar we can adopt and beat with our executable checks.
5. **Org onboarding is an admin-first two-actor flow, so it maps to the paid line without a wall in the middle of building.** Admin screens: invite, allowed capabilities (empty by default), shared managed connections that survive departures, domain restrictions, approval chains, SSO. Member screens: use what is allowed, request what is not. A second authority appearing in a workflow is the moment the free tier shows "ask someone else to approve" (D2). Evidence for the default-empty stance: Zapier switched new Enterprise accounts to it on 2026-10-05.
6. **Solo developer persona.** Mirror the MCP quickstarts but shorter: one line to add the server, client OAuth/approval handled by the client, first call works against the practice world. n8n needs nine steps, Zapier three sections; Foundry can offer one command plus one approval with no account. Preserve what n8n does well: per-workflow exposure, and "access isn't scoped per client" as the thing to fix.
7. **Migration and portability are sellable now.** Relay's death and Pipedream Workflows' sunset (2027-03-31) leave people holding exports that "won't work through native importers". Accept their exports as *intent plus structure*, rebuild through the builder, and report exactly what came over and what did not (TEARDOWN lesson 9). A visible "your workflows are typed JSON on your disk" line is a differentiator against platforms that vanish. Local-only fits D13.
8. **Failure moments to design out.** No external-identity detour without a progress state; a connection that fails shows a reason and a retry; billing units are one unit with a cap shown before the run; trials cannot delete or lock your work (n8n, Copilot Studio).
9. **Surveys.** Ask at most one question before value, and only if it changes the first screen. The only evidence of a survey earning its keep is Lindy's role pick re-ordering templates and Zapier's app list driving recommendations. For Foundry the one question that changes everything is "who else has to say yes?" (zero, one, a role), because it switches free vs paid and the approval surface.
10. **Templates are packages.** A Foundry "pack" should be a workflow + its checks + the capability grants it needs + the connection help text, with fields lockable by an admin. That is Zapier's Guided template plus OpenAI's "skills and suggested tools" plus Foundry's verified checks.

---

## 8. Open questions I could not close

- Exact current sign-up screens for Zapier, Make, Lindy, Gumloop (JS-rendered or blocked); only reviewers' accounts exist.
- Whether Zapier agentic-mode MCP asks the person before enabling a new action (docs silent); the client's per-tool prompt may be the only gate.
- Whether Make's Maia connection card shows scopes (docs say "select an existing connection or create a new one").
- Real first-value time for any product: all numbers here are documented step counts or third-party anecdote. A hands-on timed run needs an account, which this sweep was not allowed to create.
- Activepieces admin sign-up screen; Windmill's default username (rendered obfuscated).
- Whether Relay's July 2026 homepage described its HITL features; archive blocked.
- OpenAI "Agent Builder wind-down 2026-11-30" is single-source here ([sec]); TEARDOWN lists it as [doc] from the AgentKit page.

## 9. Claims seen and not used (so they are not quoted later)

- "Zapier 12-minute average setup, Make 18, n8n 35" and "first working workflow: Zapier 30 minutes, Make 1.5 hours, n8n 4 hours" (bestaimarketing-tools.com, 2026-04-25; undisclosed methodology, likely marketing content).
- "Zapier's analysis of 50,000+ new users... 83% build form-to-CRM... 28 minutes" and "Capterra median 2.7 hours" (cited.so, 2026-01-19): no primary source linked.
- "n8n 4 hours / Make 8 hours / Zapier 4 hours median first workflow" (fjdigital.fr, 2026-08-10, 23 French SMBs): n=23, consultancy.
- Lindy "around $15M revenue in its first year" and "45 to under 15 minutes" (founding designer's portfolio, [self]).
- ShadowGen/automationatlas rankings that put Moxo first (commercial bias); used only for dates and the export format of Relay, corroborated by getinboxzero's dates.

## 10. Sources read on 2026-10-21 (URL, tag)

Zapier: zapier.com [ui✓]; zapier.com/agents [ui✓]; zapier.com/mcp [ui✓]; zapier.com/pricing [doc✓]; zapier.com/govern [sec snippet]; help.zapier.com/hc/en-us/articles/15703650952077 Copilot [doc✓]; .../24393442652557 build an agent [doc✓]; .../36818600959501 agent statuses [doc✓]; .../43465487495181 guided templates, .../44821633139085 create a guided template [doc✓ snippet]; .../8496307974541 app access policies, .../44795921426317 managed apps, .../44796621276685 Enterprise admin tools [doc✓ snippet]; zapier.com/resources/guides/quick-start/create-zap [doc✓ snippet]; docs.zapier.com/mcp/home, /quickstart, /how-tools-work [doc✓]; sequenzy.com Zapier onboarding emails [sec]; lascabritas.substack.com Zapier activation (2023-11-23) [sec].
Make: make.com/en [ui✓]; make.com/maia [ui✓]; make.com/blog/plan-and-build-better-workflows-with-maia-by-make-upgraded (2026-10-20) [doc✓]; help.make.com (get started, create-your-first-scenario, step-10-schedule-your-scenario, schedule-a-scenario, connect-an-application, introduction-to-maia-by-make, maia-by-make-best-practices) [doc✓]; make.com/en/pricing [doc✓ partial]; teknexiahub.com/make-review (2026-08-15) [sec]; community.make.com Maia spotlight [sec]; LinkedIn Prem Patel (2026-03-14) [sec-low].
n8n: n8n.io [ui✓]; docs.n8n.io try-it-out, try-it-out/quickstart, choose-how-to-use-n8n, hosting installation npm, deploy install-with-docker, user-management, create-and-edit-credentials, use-gateway-credits, use-templates, ai-workflow-builder, connect/connect-to-n8n-mcp-server, start-your-free-trial [doc✓]; notes.kodekloud.com n8n cloud sign-up [sec]; nextleap n8n onboarding teardown PDF [sec-low].
Pipedream: pipedream.com/docs/pricing [doc✓]; /docs/workflows/building-workflows/build-with-ai [doc✓]; /docs/connect [doc✓]; quotaguard.com shutdown post (2026-10-16) [sec, partial]; search summary of 2026-09-30 announcement and 2027-04-30 deletion [sec].
Activepieces: activepieces.com [ui✓]; /docs/getting-started/introduction, /docs/ai/chat, /docs/install/overview [doc✓]; mintlify.wiki activepieces quickstart [sec mirror]; community.activepieces.com 101 [sec].
Windmill: windmill.dev [ui✓]; docs getting_started, flows_quickstart, advanced/self_host, core_concepts/ai_generation [doc✓].
Lindy: lindy.ai [ui✓]; docs.lindy.ai and /start-here/quickstart [doc✓]; lindy.ai/engineering/validator (2026-04-28) [doc✓]; zenml.io Lindy 2.0 [sec]; obviostudio.substack.com Lindy onboarding (2025-01-12) [sec]; zackgemmell.com/lindy [self].
Relay: relay.app [ui✓]; automationatlas.io shutdown guide [sec, biased]; ottokit.com and getinboxzero.com via search [sec].
Gumloop: gumloop.com llms summary [ui✓ partial]; docs.gumloop.com core-concepts agents, gumball, credentials, human_in_the_loop [doc✓]; nextleap Gumloop PDFs and LinkedIn posts [sec-low].
Retool: retool.com/products/workflows [ui✓]; docs.retool.com/workflows/quickstart [doc✓]; retool.com video 13:37 [sec].
Microsoft: learn.microsoft.com/power-automate/create-cloud-flow-using-copilot, /getting-started [doc✓]; /microsoft-copilot-studio/fundamentals-get-started, /nlu-authoring [doc✓].
Google: support.google.com/workspace-studio/answer/16448469 [doc✓]; support.google.com/a/users/answer/16430397 [doc✓ partial].
Notion: notion.com/help/custom-agent [doc✓].
OpenAI: openai.com/index/introducing-workspace-agents-in-chatgpt (2026-04-22) [doc✓ via Exa fetch; direct fetch 403].
Describe-it builders: docs.lovable.dev getting-started, features/cloud, integrations/app-connectors [doc✓]; supademo.com/user-flow-examples/lovable [sec]; activatefirst.com Lovable audit [sec]; aiuxplayground.com Lovable onboarding (2026-06-16) [sec]; candu.ai Lovable (2026-09-27) [sec]; bolt.new [ui✓]; support.bolt.new [doc✓]; v0.app/docs/quickstart [doc✓]; docs.replit.com integrations overview, Stripe payments [doc✓ snippet]; hostadvice Base44 review (2026-09-08) [sec].
