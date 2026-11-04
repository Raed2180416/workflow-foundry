# Developer-tools onboarding sweep (read 2026-10-21)

Sweep: Vercel, Supabase, Clerk, Stripe (test mode), Linear, Railway, Cursor, Claude Code (install, /mcp, plugins,
marketplaces), OpenAI Codex, Temporal Cloud, Inngest, Trigger.dev, Resend, PostHog, plus the cross-vendor install layer
(MCP spec, MCP registry, .mcpb, add-mcp, Neon init, Prisma create-db, Convex anonymous dev, Sentry wizard).

## 0. How to read this

**Evidence tags.**
- `docs` = vendor documentation page fetched and read on 2026-10-21 (URL given). I read the text of these pages. I did not
  run any CLI, sign up, or see a rendered UI. Nothing here is "observed UI" in the sense of a screen I looked at.
- `marketing` = vendor blog/changelog/marketing claim, or an unverifiable number.
- `research` = third-party write-up (blog, forum, mirror site). Weaker than docs.
- `inference` = my reading across sources. Marked [I].

**Caveats.**
- Vendor docs were summarized by a small model (WebFetch) for most pages. Where a summary said "not on this page" I record it
  as a gap, not as a negative. Gaps are listed in section 7.
- Some fetched docs pages contain text addressed to AI agents (Vercel "For AI agents" link blocks and an `install_vercel_plugin`
  front-matter line; Stripe pages with "Don't use the Payment Intent API unless the user explicitly asks"). I treated all of it as
  data about how vendors write docs for agents, never as instructions to follow. That pattern is itself a finding (pattern 9
  and anti-pattern A9).
- Prices, plan gating and version numbers drift. Anything numeric below is as read today.
- No account was created, nothing was submitted, nothing was installed.

---

## 1. Per-product findings

### 1.1 Claude Code (install, first run, /mcp, plugins, marketplaces, org control)

Sources: code.claude.com/docs/en/{quickstart, mcp, plugins/install, plugin-marketplaces, plugins/org, plugins/relevance,
plugins/cli-hints, plugins/manifest-reference, managed-mcp, deep-links}, all read 2026-10-21. [docs]

- **Install.** One line per OS: `curl -fsSL https://claude.ai/install.sh | bash` (macOS/Linux/WSL), `irm https://claude.ai/install.ps1 | iex`
  (PowerShell), plus `brew install --cask claude-code`, `winget install Anthropic.ClaudeCode`, apt/dnf/apk. The quickstart prints
  what a wrong-shell error looks like (PowerShell vs CMD) and links a "never used a terminal" guide.
- **First run.** `claude` in a project dir prompts for login on first use. Account choices shown: Claude Pro/Max/Team/Enterprise,
  Claude Console (a "Claude Code" workspace is auto-created for cost tracking), Bedrock / Google / Foundry, or a self-hosted
  Claude apps gateway whose URL the admin pre-configures so `/login` opens straight on the corporate-SSO screen. If
  `ANTHROPIC_API_KEY` is set and the user approves it, login is skipped.
- **MCP add.** `claude mcp add --transport http NAME URL` (remote, recommended), `--transport stdio` with `--env K=V -- cmd args`,
  `claude mcp add-json`, `claude mcp add-from-claude-desktop`. Scopes: `local` (default, `~/.claude.json`), `project`
  (`.mcp.json`, committed, shared), `user`. Precedence local > project > user > plugin > claude.ai connectors.
- **Secrets in shared config.** `.mcp.json` supports `${VAR}` and `${VAR:-default}` in command/args/env/url/headers. In remote
  `url`/`headers`, credential variables such as `ANTHROPIC_API_KEY` expand to empty so a project cannot exfiltrate them.
- **Project-server approval.** Interactive sessions prompt before using a project-scoped server from `.mcp.json`. `claude -p` and
  Agent SDK runs load them with no prompt. `claude mcp reset-project-choices` resets. [I] This is a trust boundary a Foundry
  `.mcp.json` entry will cross.
- **OAuth.** Remote servers returning 401/403 are flagged; `/mcp` then browser flow; tokens refresh; "Clear authentication"
  revokes. Shell forms: `claude mcp login NAME`, `--no-browser` prints the URL and takes the redirect pasted back.
  Pre-registered clients: `--client-id`, `--client-secret` (masked prompt; `MCP_CLIENT_SECRET` in CI), `--callback-port`.
- **claude.ai connectors** added at claude.ai/customize/connectors show up automatically in `/mcp` when logged in with a
  claude.ai account.
- **Plugins.** Bundle skills, agents, hooks, MCP servers. `/plugin` panel tabs: Discover, Installed, Marketplaces, Errors.
  `/plugin install name@marketplace` opens a details pane first: "Will install" (commands, agents, skills, hooks, MCP servers),
  last updated, context cost (tokens per turn / when invoked) for official plugins, and a trust warning ("A plugin can run hooks
  and MCP servers, so read the pane before you install"). Then a scope choice: user, project (committed to
  `.claude/settings.json`), local. Install summary says whether the plugin is active now, needs `/reload-plugins`, or "Its bundled
  MCP server needs configuration before it can start" (then **Configure**).
- **Add marketplace + install in one command.** `/plugin install deploy-helper --marketplace your-org/plugins` (v2.1.275+;
  shows the resolved source and asks to confirm), and `claude plugin install deploy-helper --marketplace your-org/plugins`
  from the shell (v2.1.292+; no confirmation). Marketplace sources: GitHub `owner/repo` (with `#ref`), any git URL, local path,
  hosted `marketplace.json` URL. Private repos use the user's existing git credentials with prompts suppressed.
- **Plugin user config.** `plugin.json` `userConfig` fields (`string|number|boolean|directory|file`, `title`, `description`,
  `required`, `default`, `options`, `sensitive`). Claude Code prompts "when the plugin is enabled". `sensitive: true` masks input
  and stores the value in the platform secure credential store, not `settings.json`; referenced as `${user_config.KEY}` in MCP
  config. Bundled MCP servers may be `.mcpb`/`.dxt` bundles.
- **Org rollout.** Managed settings (server-managed from the claude.ai admin console, MDM plist/registry, or
  `managed-settings.json`) set `extraKnownMarketplaces` (registers a marketplace) and `enabledPlugins` (force-installs), applied "at
  the start of the user's next session". Repo-level `.claude/settings.json` does the same per repository but only after the
  contributor accepts the workspace-trust dialog. `strictKnownMarketplaces` / `blockedMarketplaces` (allow/deny lists by source),
  `disableSideloadFlags`, `strictPluginOnlyCustomization`, `pluginTrustMessage` (admin text appended to the trust warning),
  `CLAUDE_CODE_PLUGIN_SEED_DIR` for containers and CI, OpenTelemetry events for installs, an Analytics API for per-plugin counts.
- **Managed MCP.** `managed-mcp.json` (exclusive control; system paths per OS), `managedMcpServers` (admin-provided remote servers
  alongside the user's own; https only; no `command`/`env`/`headersHelper` so a settings document never names a program to run;
  no `${VAR}`), `allowedMcpServers`/`deniedMcpServers` by `serverUrl` / `serverCommand` / `serverName` (name is "not a security
  control"). Admin note: "Any user on the machine can read this file, so don't store API keys" there.
- **Relevance suggestions (discovery inside the agent).** A marketplace entry can carry
  `relevance: { topic, signals: { cwd, cli, hosts, filesRead, manifestDeps } }`. When a signal matches (working dir, a command
  Claude ran, a hostname seen in a Bash command, files read, dependencies in a manifest read), Claude Code shows a spinner tip
  "Working with Terraform? Install the terraform-helpers plugin: /plugin install terraform-helpers@your-marketplace", a
  session-start line, and pins the plugin on the Discover tab. At most once every three sessions; "never installs the plugin
  automatically. The user always confirms." Matching is local; nothing reported. Org admins must allowlist the marketplace in
  `pluginSuggestionMarketplaces` first.
- **Vendor CLI hint.** A vendor CLI that detects `CLAUDECODE` writes
  `<claude-code-hint v="1" type="plugin" value="example-cli@claude-plugins-official" />` to stderr; Claude Code strips it from
  model-visible output and shows a one-time "Plugin recommendation" dialog (Yes / No / No and don't show again; 30 s timeout
  counts as No; one prompt ever per plugin; interactive local sessions only; official marketplaces only).
- **Deep links.** `claude-cli://open?repo=owner/name&q=<urlencoded prompt, max 5,000 chars>&cwd=...` opens a terminal with the
  prompt filled in and not sent; a warning line "Prompt from an external link" stays until sent or cleared; for prompts over
  1,000 characters the warning shows the count. Handler is registered on the first prompt of an interactive session. GitHub-rendered
  Markdown strips the scheme, so docs must also show the URL in a code block. A web variant `claude.ai/code?prompt=...&repositories=...`
  is described in a third-party mirror of the web quickstart [research, not in an official page I opened]. VS Code has its own
  `vscode://anthropic.claude-code/open`.
- **Custom connectors in claude.ai (support.claude.com/en/articles/11175166).** Customize > Connectors > + Add > Add custom
  connector: name, remote MCP URL, detected auth settings, Authentication (Sign in now / Sign in when needed / No sign in), OAuth
  client (Use Claude's published identity (Recommended) / Register automatically / Use your own OAuth client), request headers
  for fixed credentials. Team: only Owners add; members then click Connect and "Each user connects individually, so Claude only
  reaches data that user can access" (a shared header credential gives everyone that credential's access). Free is limited to one
  custom connector. Server must be publicly reachable because Claude connects from Anthropic's cloud. [docs]
- **Desktop Extensions (.mcpb).** ZIP with `manifest.json`; double-click opens Claude Desktop, then Install; `user_config`
  declares API keys/directories, `sensitive: true` goes to the OS keychain, and "Claude will not enable the extension until the
  user has supplied that value". `npx @anthropic-ai/mcpb init` / `pack`. Enterprise: Group Policy/MDM, pre-install approved
  extensions, blocklist, disable the directory. (anthropic.com/engineering/desktop-extensions) [docs, vendor claims]

### 1.2 Cursor

Sources: cursor.com/docs/context/mcp, /mcp/install-links, /plugins, /get-started/quickstart; forum threads; read 2026-10-21.

- **MCP config.** `.cursor/mcp.json` (project) and `~/.cursor/mcp.json` (global); stdio uses `command/args/env/envFile`, remote uses
  `url/headers`; interpolation `${env:NAME}`, `${userHome}`, `${workspaceFolder}`. OAuth supported; static client via an `auth`
  object (`CLIENT_ID`, optional `CLIENT_SECRET`, `scopes`); fixed redirect URLs
  `https://www.cursor.com/agents/mcp/oauth/callback` and `http://localhost:8787/callback`. [docs]
- **One-click install link.** `cursor://anysphere.cursor-deeplink/mcp/install?name=$NAME&config=$BASE64_ENCODED_CONFIG`; "JSON.stringify
  the configuration then base64 encode it". I decoded Stripe's published link:
  `eyJ1cmwiOiJodHRwczovL21jcC5zdHJpcGUuY29tIn0=` is `{"url":"https://mcp.stripe.com"}`. The docs page shows dark/light button
  rows and a "helper for generating links" with no link in the text I got. [docs; decoded locally]
- **Prompt and rule links.** `https://cursor.com/link/prompt?text=<urlencoded>` and `https://cursor.com/link/rule?name=...` exist
  (seen in search results and a forum bug thread). Forum: prompt links over 8,000 characters are rejected, spaces become `+`, long
  rules fail to install, and a Cursor staff reply says "Fix in Cursor" deeplinks are "currently limited to cases generated by
  Cursor itself ... mainly for security, as someone could easily poison a link". No official deeplink starts a cloud agent with a
  repo and prompt (Feb 2026 thread). [research]
- **Plugins and team marketplaces.** Two manifest formats: open "Agent Plugins" `plugin.json` (skills + MCP) and Cursor Plugins
  `.cursor-plugin/plugin.json` (adds rules, agents, commands, hooks). Install: Customize in sidebar > plugin > Install > project or
  user scope. Teams: one team marketplace; Enterprise: unlimited; import from GitHub/GitLab/Bitbucket/Azure DevOps; per-plugin mode
  **Default Off / Default On / Required**; restrict by Organization Groups; auto-refresh on push (10-min floor). Every public
  marketplace plugin is manually reviewed and must be open source. [docs]
- **First run.** Install, sign in, "pick a folder and start with a small task", Cmd+I opens Agent, Shift+Tab toggles Plan Mode,
  diff view to review. Nothing about a setup wizard on that page. [docs]

### 1.3 OpenAI Codex

Sources: developers.openai.com/codex/mcp (308 to learn.chatgpt.com/docs/extend/mcp), learn.chatgpt.com/docs/codex/cli; read 2026-10-21.

- Install `curl -fsSL https://chatgpt.com/codex/install.sh | sh`; run `codex`; "Sign in with ChatGPT or another available
  sign-in method"; `/permissions` to choose when it edits/runs without asking; `/init` creates AGENTS.md. The page does not show
  API-key or headless device-auth setup. [docs]
- MCP in `~/.codex/config.toml` or `.codex/config.toml` (trusted projects only): `[mcp_servers.NAME]` with `command/args/env/env_vars`
  or `url/bearer_token_env_var/http_headers`; commands `codex mcp add NAME --url URL`, `codex mcp add NAME --env K=V -- cmd`,
  `codex mcp login NAME`, `codex mcp list`; `--oauth-client-registration cimd|dcr`; "Otherwise Codex prefers CIMD when the server
  supports it, then falls back to DCR." Per-tool `approval_mode` (`auto|prompt|writes|approve`) and `default_tools_approval_mode`.
  OAuth `client_secret` is written into `config.toml` (the page tells you to keep it private). Plugins can bundle MCP servers;
  per-plugin on/off and policy under `plugins."name@marketplace".mcp_servers.NAME`. Shared between desktop app, CLI and IDE
  extension. [docs]
- Drift risk: docs moved domain (developers.openai.com to learn.chatgpt.com); Linear's page says Codex "may first need"
  `experimental_use_rmcp_client = true`. [docs; I]

### 1.4 Stripe (CLI, test mode, MCP, approvals)

Sources: docs.stripe.com/{cli/install, cli/login, cli/agent/setup, mcp, keys, account/approvals, payments/quickstart}; read 2026-10-21.

- **Agent-first quickstart line on every docs page.** "Quickstart: Install the Stripe CLI with `npm install -g @stripe/cli` and run
  `stripe agent setup`." And "Read this page in your terminal: install the Stripe CLI (v1.43.3+) and run `stripe docs`." [docs]
- **`stripe agent setup`.** "detects common agent harnesses and installs the relevant Stripe plugin, skills, and MCP server."
  Supports Claude Code, Codex, Cursor. Flags: `--client`, `--force`, `--json` ("Print machine-readable status and planned actions
  without making changes"), `--skills`, `--skills-scope local|global`, `--status`, `-y/--yes` ("set up all detected clients"). [docs]
- **`stripe login`.** CLI "displays a pairing code and opens the Stripe Dashboard, where you confirm the code and configure the
  CLI's access to accounts, sandboxes, and live mode." Credentials go to the OS secure store, refresh automatically. Newer versions
  require an Administrator or IAM Admin to enable CLI access first (Settings > Team and security > MCP and CLI access).
  `--non-interactive` (automatic when stdin is not a TTY) prints JSON `{browser_url, verification_code, next_step}` and exits;
  `--complete=<poll-url>` finishes after approval. `--interactive` is the fallback for pasting an API key. [docs]
- **Test mode.** Sandboxes with `pk_test_/rk_test_/sk_test_` keys; "card networks and payment providers don't process payments";
  separate live keys; in sandbox you can always see all keys, in live a created secret key is shown once. Go-live checklist is a
  separate page. [docs] (The widely quoted "Stripe injects your test key into the code samples when signed in" appears in
  third-party posts [research]; the docs text I fetched did not show it.)
- **MCP.** `https://mcp.stripe.com`; "Set up Stripe MCP with a plugin (Recommended)" = `stripe agent setup`; manual per client:
  Cursor deeplink button, `claude mcp add --transport http stripe https://mcp.stripe.com/` then `/mcp` for OAuth, Codex
  `codex mcp add stripe --url https://mcp.stripe.com`, VS Code redirect link
  `https://vscode.dev/redirect/mcp/install?name=stripe&config=<urlencoded JSON>`, Claude connector directory entry, ChatGPT plugin.
  OAuth consent page lets you "grant access to one or more live mode accounts or sandboxes and set different permissions for each
  environment". Admins can enable/disable MCP access per team per mode; users revoke clients under OAuth sessions; admins can
  list/revoke others' sessions. Key auth for headless: agent-tagged restricted keys, with a **hard cutover: from December 2026
  Stripe MCP stops accepting full-access and untagged restricted keys** (migrate by 2026-11-30). [docs]
- **Human confirmation for risky writes.** "Stripe requires human confirmation before it takes certain stripe_api_write actions,
  such as refunds and outbound payments. To confirm an action, click the URL provided by your agent and review the details ... When
  you click Approve, Stripe provides the agent with an approval token, but you need to tell the agent to retry the operation, which
  doesn't require human confirmation. If you don't approve the action within 24 hours, it expires." [docs]
- **Two-party approvals (the productized "second authority").** Rules per action (refund created, subscription created/canceled,
  payment intent created, bank account changes, admin invited, credit note, customer balance transaction); conditions on amount,
  actor (team members vs agent-tagged API keys) and rate; control = Require approval or Block; designated reviewers by individual
  (email notified) or role; custom justification instructions; "A user can't approve their own request"; requests expire in 14
  days; webhooks for created/approved/rejected/canceled/expired/succeeded/failed; Security history logs. Agent-tagged keys get
  default rules (refund created, subscription canceled). "On single-user accounts, you can only save two-party approval rules where
  the actor condition is set to agent-tagged API keys, because an agent API key is an independent actor from the administrator."
  The agent receives an `approval_required` error and the request is auto-submitted. Plan gating not stated on the page. [docs]

### 1.5 Vercel

Sources: vercel.com/docs/cli (+ /setup, /mcp, /login, /integration, /deploy-button), changelog; read 2026-10-21.

- Install `npm i -g vercel`; `vercel login` / `vercel signup` / `vercel login --github`; CI uses `VERCEL_TOKEN`. `vercel` with no
  args is the deploy command; `vercel link`, `vercel env pull`, `vercel dev`. [docs]
- **Agent layer in the CLI.** `vercel setup` ("Installs the Vercel plugin for Claude Code and Codex" and "Connects your local coding
  agents to AI Gateway"; "prompts you before each step and skips agents it doesn't find"; `--dry-run`, `--yes`, `--agent`).
  `vercel mcp` (interactive client picker; configures Claude Code, Cursor, VS Code directly, prints manual steps for Claude.ai and
  Desktop; `--project` scopes to `https://mcp.vercel.com/<org>/<project>`; "does not deploy any MCP server of your own. It only adjusts
  the client-side configuration"). `vercel agent init` writes an AGENTS.md. `vercel skills [query]` discovers skills for the
  project. `vercel feedback "..."` works without login or a linked project. `vercel guidance enable|disable` toggles post-command hints.
  [docs]
- **Marketplace provisioning.** `vercel integration add <slug>` provisions a resource, connects it to the linked project and runs
  `vercel env pull`. `--claim` / `--no-claim` for **sandbox** resources: unclaimed sandbox resources are tagged `[SANDBOX]`; claim
  opens the provider's claim URL and polls up to five minutes for ownership to transfer. In non-interactive mode a claim returns a
  structured `outputActionRequired` payload with `reason: "integration_sandbox_claim_required"` and `verification_uri`; a missing
  `--yes` returns `outputAgentError` with `reason: "confirmation_required"` and a `next` array of suggested commands, exit code 1.
  `accept-terms` "requires an interactive terminal and human confirmation." (changelog 2026-03-02: `discover` and `guide`
  commands, `--format=json`, "pause this process for human decisions, like terms of service acceptance"). [docs]
- **Docs for agents.** Each page has front matter (`last_updated`, `summary`, `install_vercel_plugin`) and a "For AI agents"
  related-pages block with a `.graph.md` link. [docs]
- **Deploy Button.** `vercel.com/new/clone?repository-url=...` with query params controlling env prompts; the page I got showed
  only the intro, so parameter detail is unverified. [docs, partial]

### 1.6 Supabase

Sources: supabase.com/docs/guides/getting-started/mcp, /quickstarts/nextjs, /local-development/cli/getting-started; read 2026-10-21.

- **MCP.** Hosted `https://mcp.supabase.com/mcp`. Scoping by query parameter: `?project_ref=` (disables account tools), `?read_only=true`
  (read-only Postgres user), `?features=database,docs`, `?skip_elicitations=` (named tools). Default auth is dynamic client
  registration with a browser sign-in where you "choose the organization containing your project"; no PAT needed. CI uses a scoped
  PAT header. Per-client lines for Claude Code (`claude mcp add --scope project --transport http supabase ...` then `claude /mcp`
  Authenticate), Codex (`codex mcp add supabase --url ...` then `codex mcp login supabase`), Gemini CLI, Cursor, VS Code and a dozen
  more. [docs]
- **Honest warnings printed in the onboarding page.** Prompt injection from data (a support ticket can instruct the LLM), keep manual
  tool-call approval on, unattended routines pre-approve only project-scoped read-only tools, and "Internal use only: ... runs with your
  developer permissions, so don't give it to customers". Elicitations "are a guardrail, not a guarantee of human review". [docs]
- **Quickstart shape.** Next.js guide has eight steps: create project, set up database, create app (`with-supabase` template),
  "Set up AI tooling (optional)" (Agent Skills via `npx skills add` and the MCP server), declare env variables (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) from a "Connect" helper, allow public access, query, start. The text shows placeholders
  like `<SUBSTITUTE_SUPABASE_URL>`; I could not confirm auto-fill for a signed-in user. [docs]
- **Local stack.** `supabase init` makes a committed `supabase/` dir and needs no sign-in; `supabase start` needs a container runtime
  (Docker, OrbStack, Rancher Desktop, Podman, colima), pulls images on first run and prints Studio, API URL, DB URL, publishable and
  secret keys. [docs]

### 1.7 Clerk

Sources: clerk.com/docs/quickstarts/{nextjs, overview}; read 2026-10-21.

- The Next.js quickstart is written as an agent setup guide. **Keyless:** "Setup needs no Clerk account. When signed out, `npx -y clerk@latest init`
  provisions a claimable application and writes development keys to `.env.local`. Signing in later claims that application." Before
  claiming, `clerk enable orgs` and `clerk config patch` work; "Billing and some auth settings require claiming." Existing app:
  `clerk auth login`, `clerk apps list --json`, `clerk init --app <id>`. `clerk doctor` verifies. Framework and package manager are
  detected; flags only to override. [docs]
- **Quickstart index.** Three options above the framework list: Agent prompt `Add Clerk auth to my app: clerk.com/SKILL.md`, CLI
  `npx clerk@latest init`, Skills `npx skills add clerk/skills`; then guides grouped Full Stack / Frontend / Backend with no selector.
  [docs]
- (The "claim your application" UI toast is described in training memory; I did not find it in a fetched page, so I do not rely on it.)

### 1.8 Railway

Sources: docs.railway.com/guides/cli, railway.com/agents, docs.railway.com/guides/templates; read 2026-10-21.

- `curl -fsSL agents.railway.com | sh` installs the CLI if absent then runs `railway setup agent` (installs skills, configures a local
  MCP server `railway mcp`; `-y` skips prompts). `railway setup agent --remote -y` configures hosted MCP at `https://mcp.railway.com`
  with browser OAuth. `railway login` opens a browser or "prints a device code over SSH or in headless environments"; "New accounts are
  created on the fly", so one command is sign-up and sign-in. `railway up -y` signs in/up and deploys in one step. The agents page tells
  agents "to ask for approval before running setup that modifies local configuration, and ... not to install silently." Tokens for CI:
  `RAILWAY_TOKEN` (project), `RAILWAY_API_TOKEN` (account). `railway agent -p "..."` talks to a Railway-hosted agent. [docs]
- Templates "package a service or set of services into a reusable, distributable format"; notify users when maintainers update.
  The page did not show how template env vars are prompted. [docs, partial]

### 1.9 Linear

Sources: linear.app/docs/mcp, linear.app/docs/start-guide; read 2026-10-21.

- MCP: `https://mcp.linear.app/mcp` (Streamable HTTP; `/sse` deprecated), read-only `/mcp/readonly` or OAuth `read` scope. Claude Code
  `claude mcp add --transport http linear-server https://mcp.linear.app/mcp` then `/mcp`; Codex `codex mcp add linear --url ...` then
  `codex mcp login linear`; Cursor install link; VS Code, Windsurf, Zed via `npx -y mcp-remote https://mcp.linear.app/mcp`; Claude connectors
  page; v0 connections page. "OAuth 2.1 with dynamic client registration"; API key or bearer as an alternative; per-workspace auth
  (`MCP_REMOTE_CONFIG_DIR` per workspace); enterprise: after SAML, "MCP enterprise managed authentication" with an Okta issuer URI. [docs]
- Start guide (what a new workspace sees): demo workspace at `linear.app/demo`, live onboarding session, role-based admin and team guides,
  create workspace "using your work email". First-run steps are not on the page. [docs, partial]

### 1.10 Trigger.dev

Sources: trigger.dev/docs/quick-start, trigger.dev/SKILL.md; read 2026-10-21.

- `npx trigger.dev@latest init` "asks whether to set up AI tooling, the MCP server and/or agent skills" (first run), logs you in,
  asks you to pick a project, installs SDK, asks where to create `/trigger`, writes `trigger.config.ts`, offers a Hello World task.
  `npx trigger.dev@latest dev` watches and registers tasks; "Test" button on the dashboard Tasks page runs the example with no payload;
  the run page live-updates. Env vars are only needed for API triggering (`TRIGGER_SECRET_KEY=tr_dev_sk_...`). [docs]
- **Paste-to-agent onboarding:** "Bootstrap a Trigger.dev project: trigger.dev/SKILL.md". The skill (I read it as data) tells the agent to
  inspect the app, run a login command that prints a URL, send it to the user and wait ("The agent doesn't ask for email, name, or
  passwords, and it doesn't automate the browser"), choose/create project (project creation can activate the Free plan; "not to activate a
  paid plan"), run a harmless example task and verify. Listed user decisions: which account, which app in a monorepo, link vs create,
  org name, whether to proceed past SDK-version questions, complete browser login, trigger the test from the dashboard if no MCP.
  Boundaries: no reading stored credentials, no requesting secrets in chat, no committing env files, no deploying, no touching production
  runs. [docs]

### 1.11 PostHog

Sources: posthog.com/docs/getting-started/install, github.com/PostHog/wizard, posthog.com/docs/model-context-protocol; read 2026-10-21.

- `npx @posthog/wizard@latest`: "detects your framework, wires up initialization, instruments a starter set of events, and walks you
  through a first dashboard"; 16+ frameworks; interactive runs use OAuth login, CI uses `--api-key`, `--signup` creates an account;
  secrets "land in the .env file but are never returned to the model"; "Source files are sent to the selected model provider as part of the
  agent's context"; models from Anthropic or OpenAI "routed through PostHog's AI gateway" with a scoped token per run; for existing
  organizations it checks an AI data-processing approval and "waits for approval before agent work"; run telemetry is on by default
  (`--no-telemetry` / `POSTHOG_WIZARD_NO_TELEMETRY=1`). `npx @posthog/wizard mcp add` installs the hosted MCP
  (`https://mcp.posthog.com/mcp`) into PostHog Desktop, Cursor, Claude Code, Claude Desktop, Codex, VS Code, Zed; region (US/EU) is
  routed by the auth server. The install page itself only lists the wizard and frameworks; the manual snippet is
  `posthog.init('<ph_project_token>', {...})` with `api_host` per region. [docs]

### 1.12 Resend

Sources: resend.com/docs/send-with-nextjs, resend.com/docs/mcp-server; read 2026-10-21.

- Next.js quickstart is three steps (install SDK, create a React email template, send from a route handler) with prerequisites "API key"
  and "verified domain". The sample sends from `"Acme <onboarding@resend.dev>"` to `delivered@resend.dev`; "`onboarding@resend.dev` is for
  testing only". Guardrail section suggests `npx skills add resend/react-email`, `resend/resend-skills`, `resend/email-best-practices`. [docs]
- MCP: remote `https://mcp.resend.com/mcp` (browser OAuth; Bearer API key for headless) or local `npx -y resend-mcp` with
  `RESEND_API_KEY`. Claude Code: `claude plugin install resend@claude-plugins-official` then `/mcp`; Cursor `/add-plugin resend`; Codex one-click
  plugin link plus `codex mcp add resend --url ...`; Claude connector directory entry "installs the MCP server and all Resend skills". [docs]

### 1.13 Inngest

Sources: inngest.com/docs/getting-started/nextjs-quick-start, /platform/environments; read 2026-10-21.

- `npm install inngest`; `npx inngest-cli@latest dev` serves a local Dev Server UI at `http://localhost:8288`; the app exposes `/api/inngest` so
  the server discovers functions; trigger from the Dev Server Functions page with a test payload, inspect the Runs tab; v4 SDK needs
  `INNGEST_DEV=1`. "Usage in local development doesn't count toward your bill." Cloud environments each have an event key and a signing key;
  branch environments created on demand; all branch deploys share the keys. [docs]

### 1.14 Temporal (Cloud and local)

Sources: docs.temporal.io/cloud/get-started, docs.temporal.io/cli/server, docs.temporal.io/cloud/tcld/login; read 2026-10-21.

- Cloud: sign up (direct or AWS/GCP Marketplace), create Namespace, choose auth ("we recommend using API keys because they're easier to
  manage and rotate"; mTLS if you already run PKI), connect Clients and Workers via per-language guides, run first Workflow, invite team
  (Service Accounts for machine identities); the signup email becomes the first Account Owner. [docs]
- Local: `temporal server start-dev` serves Web UI at `http://localhost:8233` and gRPC on 7233, no account, state lost on stop unless
  `--db-filename`; "not intended for production use". `tcld login` has a `--disable-pop-up` flag. A free-credit offer ($1,000) appears only in a
  Nov 2024 blog result and is unconfirmed for 2026. [docs; marketing]

### 1.15 Cross-vendor install layer

- **Neon `neon init`** (neon.com/docs/cli/init; the page I opened documents `neon init`, not `neonctl init`): agent setup chooser "Plugin
  (recommended)" vs "Skills and MCP separately" vs "Skip agent setup"; links project (`.neon`), pulls `DATABASE_URL` to `.env`/`.env.local`;
  optional `neon.ts`; `--agent`, `-y` ("never opens a browser"), `--mcp-auth oauth|api-key`, `--mcp-config-location global|project`,
  `--claimable`. Search result: "If you only want the server registered ... `npx add-mcp https://mcp.neon.tech/mcp`." [docs]
- **`add-mcp`** (github.com/neondatabase/add-mcp): "Add MCP servers to your favorite coding agents with a single command"; project mode detects
  `.cursor/`, `.vscode/`, `.mcp.json` and preselects; global mode detects installed agents; table of per-agent config paths (Claude Code
  `.mcp.json` / `~/.claude.json`, Cursor `.cursor/mcp.json`, Codex `.codex/config.toml`, VS Code `.vscode/mcp.json`...); flags `-g`, `-a`,
  `-y`, `-n`, `-h`; programmatic `upsertServer` for embedding in other CLIs. [docs]
- **Prisma `npx create-db`**: no account; database deleted after 24 hours unless claimed; prints connection string, claim URL and deletion
  date; `--json`, `--env`, `--ttl`. **Convex** `npx convex dev`: anonymous local deployment, link later with `npx convex login`; no public URL
  so no inbound webhooks. **Sentry wizard** `npx @sentry/wizard@latest -i nextjs`: interactive login, org/project, auth token, source maps;
  I found no source confirming a fully non-interactive mode. [docs; research]
- **MCP spec 2026-07-28** (modelcontextprotocol.io): authorization is OAuth 2.1; servers MUST implement Protected Resource Metadata (RFC 9728);
  clients and auth servers SHOULD support Client ID Metadata Documents; "Dynamic Client Registration is deprecated and retained for backwards
  compatibility"; resource indicators (RFC 8707) required; scope step-up on 403 `insufficient_scope`; stdio servers "SHOULD NOT follow this
  specification, and instead retrieve credentials from the environment". **Elicitation**: form mode vs URL mode; "Servers MUST NOT use form mode
  elicitation to request sensitive information such as passwords, API keys, access tokens, or payment credentials"; URL mode data "is not
  exposed to the client"; clients MUST show the full URL and domain, MUST NOT pre-fetch it, MUST open it where "the client or LLM" cannot inspect
  the content; servers MUST verify the user who opens the URL is the one who started the elicitation (phishing section). Responses are accept /
  decline / cancel. [docs]
- **MCP Registry `server.json`**: `remotes[]` (`streamable-http|sse`, `url` with `{variables}`, `headers[]` with `isRequired/isSecret/default/choices`),
  `packages[]` (`npm|pypi|oci|nuget|mcpb|cargo`, `environmentVariables[]` with `isSecret`, `fileSha256` for mcpb), `name` namespaced like
  `io.github.user/server`. The page does not specify a UI mapping; the mapping to a setup form is [I]. [docs]
- **Docs-as-onboarding (vendor-neutral).** Per-page `.md` (append `.md` to a URL), `llms.txt`, `llms-full.txt`, a "Copy page" menu with
  View as Markdown / Open in ChatGPT / Open in Claude / Connect to Cursor / Connect to VS Code / Copy MCP install command, a hosted docs MCP
  server, `.cursorrules`/`CLAUDE.md`/`AGENTS.md` snippets. Seen on Optimism, Landing AI, Raydium, Nium, Koala UI, docs.page and others via search
  results. [research]
- **Third-party measurement writing** (chabot.dev DevRel Almanac; Skene 2026; Prodinja 2026; Segment8 2024): define the aha moment, time every step
  from signup, classify steps load-bearing/deferrable/removable/automatable, defer email verification, pre-generate keys, ship snippets with the real
  key embedded; benchmark claims such as "under 5 minutes for an API, under 30 for infrastructure"; Stripe "test mode by default", "personalized docs".
  Specific before/after numbers (for example "4 hours to 12 minutes") are uncited. [research/marketing; do not quote the numbers]

---

## 2. Patterns (with the Foundry reading of each)

Each has: what the best products do, evidence, and what it means for Foundry. Foundry facts come from AGENTS.md, decisions-20261021.md
and surface-20261021/DESIGN.md.

**P1. One command that detects the coding agents on the machine, plans, and installs plugin + MCP + skills.**
`stripe agent setup`, `vercel setup`/`vercel mcp`, `railway setup agent`, `neon init`, `npx @posthog/wizard mcp add`, `npx add-mcp`, Trigger.dev
`init` prompt. Common contract: detect, prompt per step, `--yes`, `--client/--agent`, `--dry-run` or `--json` plan, `--status`, `--force`.
[docs]. *Foundry:* `foundry setup` (today `node app/cli.mjs connect` prints lines for you to paste, DESIGN §6.1). Make it write the config for
Claude Code, then Cursor, then Codex (D9), with a plan-first mode. Keep "no publish" (D13): the package name stays local until the owner says so.

**P2. A paste-into-your-agent prompt that points at a SKILL.md.** Clerk "Add Clerk auth to my app: clerk.com/SKILL.md"; Trigger.dev
"Bootstrap a Trigger.dev project: trigger.dev/SKILL.md"; Resend/Supabase/Clerk `npx skills add ...`. The skill tells the agent which steps are
the human's. [docs] *Foundry:* the local site serves `/SKILL.md` and `/llms.txt` on loopback and `foundry setup` also writes the skill into
`.claude/skills/foundry/` so no fetch is needed (the WebFetch tool in my own session refuses localhost; a shell `curl` works, and other clients may differ). Keep the prompt under 1,000 characters
so Claude Code does not show the long-prompt warning.

**P3. Keyless, anonymous, claimable first run.** Clerk keyless (claimable app, dev keys in `.env.local`, claim by signing in), Neon `--claimable`,
Prisma `create-db` (24 h then claim URL), Convex anonymous local deployment, Vercel `--claim` for sandbox resources, Supabase local stack, Inngest and
Temporal dev servers. The account appears only when something needs one ("Billing and some auth settings require claiming"). [docs]
*Foundry:* the free product is already account-free. Make the paid event a **claim**: the workspace is anonymous until the person adds a second
authority (invite an approver or name a rule owner), and that click is "Claim this workspace for your organization". That matches D2 exactly and
removes any signup wall from the first ten minutes.

**P4. Sandbox/test mode is the default and the first thing the person sees working.** Stripe sandboxes and test keys; Resend `onboarding@resend.dev` ->
`delivered@resend.dev`; Trigger.dev Hello World + dashboard Test button; Inngest Dev Server "invoke" + Runs; Temporal `start-dev` UI;
Supabase `supabase start` printing every URL and key; Railway `up -y`. [docs] *Foundry:* the practice world is the sandbox. The activation moment is
"first practice run passes its checks and I can read the evidence", reached with templates and no model key (spike already does this). Offer a stand-in
recipient for every outbound effect the way Resend does.

**P5. Detect, then ask only what cannot be detected.** Clerk detects framework and package manager; PostHog wizard detects framework; Neon links the
project and pulls env; Vercel zero-config; add-mcp preselects agents it finds. Questions left over are decisions: which account, which monorepo app, link or
create, org name (Trigger.dev skill's list). [docs] *Foundry:* detect clients (Claude Code/Cursor/Codex), detect existing automations in the workspace
(n8n exports, GitHub Actions, cron, scripts) [I], then ask only: which agent(s), which automations to bring over, who approves what.

**P6. Human-only steps are named, bounded and machine-readable.** Stripe pairing code + `--non-interactive` JSON `{browser_url, verification_code, next_step}`;
Vercel `outputActionRequired` with `verification_uri`, `accept-terms` needs a human, `confirmation_required` + `next`; Railway skill "don't install silently";
Trigger.dev skill "doesn't automate the browser"; Claude deep link "populated but not sent until you press Enter"; Cursor limits prompt deeplinks to those it
generated; MCP elicitation URL mode shows the full domain and hides the content from the client; Stripe approval URL -> approval token -> agent retries. [docs]
*Foundry:* this is the vocabulary for the approval channel the model cannot act on. The approval page shows origin and port, the version hash being approved,
and the exact effect list; approving yields a token bound to that hash; the agent retries; expiry visible (Stripe uses 24 h for MCP confirmations, 14 days for
approval requests; pick one and show it).

**P7. Secrets: asked for by name, one sentence of why, stored in the OS keychain, never in chat or shared config.** `.mcpb` `user_config.sensitive` (keychain),
Claude plugin `userConfig.sensitive` (secure store, masked prompt, referenced as `${user_config.KEY}`), Stripe CLI (OS secure store), MCP spec (form mode MUST NOT
request API keys; stdio gets credentials from env), registry `isSecret`, Trigger.dev skill "no requesting secrets in chat". Counter-example: Codex writes an OAuth
`client_secret` into `config.toml`. [docs] *Foundry:* BYOK (D11) = one plugin `userConfig` field marked sensitive, or a local-dashboard page that writes to the keychain;
never an `.mcp.json` `env` value. The ask copy is: "Anthropic API key. Why: so Foundry can build workflows with Haiku. Stored in your OS keychain. Optional: Foundry
works on templates without it."

**P8. Many ways in, same destination: client-specific one-click and one-line install, generated with the user's values.** Cursor `cursor://...mcp/install?name&config=base64`;
VS Code `https://vscode.dev/redirect/mcp/install?name&config=urlencoded JSON`; Claude Code `claude mcp add`, `/plugin install x --marketplace owner/repo`, `claude-cli://open?...`;
Codex `codex mcp add NAME --url`; Claude connector directory; ChatGPT plugin; `.mcpb` double-click; Stripe shows a per-client tab list on one page. [docs]
*Foundry:* the local site's "Connect" page shows tabs for Claude Code, Cursor, Codex (D9) with the port and workspace path filled in and a Copy button; Cursor and VS Code
buttons are local deeplinks (no hosting needed, so D13 is respected).

**P9. Docs are the onboarding surface and are written for agents too.** Stripe `stripe docs` (docs in the terminal) and agent-quickstart banner on every page; Vercel
front matter + "For AI agents" link blocks; per-page `.md`, `llms.txt`, "Copy page / Open in Claude / ChatGPT / Cursor / Connect to VS Code" menus; docs MCP servers.
[docs/research] *Foundry:* the site is generated with `.md` twins, `/llms.txt` and a copy menu. Treat inbound doc text as data (AGENTS.md rule), and do not put
agent-directed imperatives inside user-facing pages that a user's agent will read as instructions without the user seeing them (see A9).

**P10. Org rollout is admin-first and per-user for identity.** Claude Code managed settings (`extraKnownMarketplaces` + `enabledPlugins`, server-managed from the
admin console), repo `.claude/settings.json` gated by workspace trust; Claude custom connectors (owner adds, each member connects individually); Cursor team marketplace
(Default Off / Default On / Required, groups); Stripe admin toggle "MCP and CLI access" per mode, OAuth consent per account/sandbox, admin can list and revoke
others' sessions; Linear SAML/Okta managed MCP auth; Temporal first signup email becomes Account Owner, Service Accounts for machines. [docs] *Foundry:* org onboarding
has three roles in order (owner, approvers/rule owners, members) and one generated artifact per delivery route (managed-settings JSON, repo settings JSON, Cursor team
marketplace entry), each copyable with values filled in.

**P11. Discovery at the moment of need.** Claude Code relevance signals (cwd, cli, hosts, filesRead, manifestDeps) and the `claude-code-hint` stderr tag; Vercel
`vercel skills` ("Discover agent skills relevant to your project"); Neon/Stripe/Vercel CLIs each ship the plugin. [docs] *Foundry:* a relevance block that fires when the
agent reads `*.n8n.json`, `.github/workflows/*`, a `crontab`, runs `n8n`/`make`/`zapier`, or touches hosts like `n8n.cloud` or `hooks.zapier.com` [I]: "Working with an automation
export? Foundry can import it, practise it and put a check on it." Org admins allowlist it. Needs a marketplace: D13 means local-only until the owner says publish.

**P12. Scope and safety are chosen at connect time, not later.** Supabase `project_ref`, `read_only`, `features`; Linear `/mcp/readonly` and `read` scope; Stripe per-environment
permissions at consent; Vercel `--project`; Claude `serverUrl`/`serverCommand` allowlists; Codex `default_tools_approval_mode`. [docs] *Foundry:* "What may your agent do with
Foundry?" = three presets at connect (read and practise only; build and run in the practice world; run for real with approval) mapped to tool annotations, with the last one
off by default.

**P13. Honest security copy on the onboarding page itself.** Supabase ("Internal use only", prompt injection, manual approval), Neon (local-dev only), Stripe ("exercise
caution when using the Stripe MCP with other servers"), Claude connector warnings (unverified servers, prompt injection, shared credentials), Codex "keep the file private". [docs]
*Foundry:* put DESIGN §6.4 (what the dashboard key does and does not stop) on the Connect page in plain words, once, next to the "auto-approve" setting rather than in a footer.

**P14. The CLI is agent-grade, not only human-grade.** `--json`/`--format=json`, `--non-interactive`, `--yes`, `--dry-run`, `--status`, structured error with `reason` and `next`,
distinct exit codes (Vercel exit 1 on `confirmation_required`; claim cancel exit 130), `vercel feedback` without login, `vercel guidance`. [docs] *Foundry:* every command that changes
anything has a plan mode and a machine-readable action-required payload; `foundry doctor --json` is what the agent runs first.

**P15. Plugin enablement asks for config at enable time and shows cost.** Claude `/plugin` pane shows what will install and "Context cost: Every turn / When invoked"; Configure options
dialog for `userConfig`; `claude plugin details` shows `Always-on` tokens per component; Not-used-recently list. [docs] *Foundry:* ship the skill with an honest token cost line; the
cheap-model thesis makes context cost a selling point, so show it.

**P16. Instrument the one number that matters and define it first.** Third-party DevRel writing: time to first hello world (TTFHW) with an explicit start and end; typical thresholds
quoted as "under 5 minutes" for APIs and "under 30" for platforms; funnel steps from docs visit to first call. [research] *Foundry:* define activation as "first practice run that passes
its checks, with the evidence page opened", measure locally with a timestamp file (no phone-home; PostHog's wizard is telemetry-on by default, which is the wrong default for a local-first product).

---

## 3. What these products ask users to provide or connect, and when

| Product | Ask | When | Why they say / why [I] | Optional |
|---|---|---|---|---|
| Vercel | Login (browser/device), `--github` | first CLI command | account identity | no |
| Vercel | Link project; git provider | first deploy | deploy target | no |
| Vercel | Accept marketplace terms; pick billing plan; claim sandbox | when provisioning a resource | legal and billing are human-only | claim yes |
| Supabase | Organization and project | MCP OAuth consent; quickstart step 1 | scoping | `project_ref`, `read_only` optional |
| Supabase | Container runtime | `supabase start` | local stack in Docker | local only |
| Clerk | Nothing at first | `init` | keyless | claim later |
| Clerk | Sign in to claim | when billing or some auth settings are needed | ownership | optional until then |
| Stripe | Pairing-code confirmation in Dashboard; accounts/sandboxes/live scope | `stripe login` | CLI identity and scope | no |
| Stripe | Admin enables CLI/MCP access (per mode) | before login on newer versions | org control | admin-only |
| Stripe | OAuth consent with per-environment permissions | first MCP use | scoped access | no |
| Stripe | Agent-tagged restricted key | headless agents | independent actor + approval rules | alternative to OAuth |
| Stripe | Click approval URL for refunds etc. | each risky write | human confirmation | rule-driven |
| Linear | OAuth login or API key; workspace | first MCP use | per-workspace auth | read-only scope optional |
| Railway | `railway login` (browser or device code) | first command; `up -y` combines | account created on the fly | no |
| Cursor | Sign in; pick folder; MCP OAuth via Add to Cursor | first run | account | plugins optional |
| Claude Code | Account type (Pro/Max/Team/Enterprise, Console, cloud provider, gateway) | first `claude` | billing path | API key shortcut |
| Claude Code | Trust workspace; approve project MCP servers; choose plugin scope; trust warning; `userConfig` (sensitive masked) | first session in a repo; plugin enable | code execution consent | no |
| Codex | Sign in with ChatGPT; `/permissions`; `/init` | first `codex` | account and sandbox | `/init` optional |
| Temporal Cloud | Sign up; namespace; API key vs mTLS; connect client/worker; invite team | cloud path only | hosted service | local `start-dev` needs none |
| Inngest | Event key + signing key per environment | cloud path | send events / sync apps | none locally |
| Trigger.dev | Login; org; project; optional MCP/skills; `TRIGGER_SECRET_KEY` for API triggers | `init` | cloud runner | AI tooling optional |
| Resend | API key; verified domain | before sending real mail | deliverability | sandbox sender first |
| PostHog | OAuth login (CI: personal API key); AI data-processing approval for existing orgs | wizard start | send source to model provider | `--signup` |
| Neon | OAuth or API key; project; org/project IDs under `-y` | `neon init` | link + MCP key | `--claimable` |

[I] Reading across the table: the asks cluster into six types: identity, scope, secrets, legal/billing, human confirmation of a risky effect, and org policy. Best-in-class products
defer the last four until the action that needs them, and never ask for a secret before the person has seen the product work.

---

## 4. Anti-patterns and landmines seen in the sources

- **A1. Auth model churn without a bridge.** Stripe MCP stops accepting full-access and untagged restricted keys in December 2026 (`401` with an OAuth discovery challenge). Docs
  banner gives a date. Lesson: ship the best auth first (keychain + per-user), not a long-lived key, so there is no cutover later.
- **A2. Long or special-character deeplinks break.** Cursor prompt links are capped at 8,000 characters and mangle spaces; Claude Code warns above 1,000 characters and caps at
  5,000; GitHub strips `claude-cli://`. Keep links short, make them point at a skill file, show a copyable code-block fallback.
- **A3. Deeplinks that start agent work are an injection vector.** Cursor limits "Fix in Cursor" to Cursor-generated cases for exactly this reason; Claude never sends the prefilled
  prompt. Foundry must never ship a link that runs anything on click.
- **A4. Secrets in shared files.** Codex writes OAuth client secrets into `config.toml`; admin docs for Claude warn managed files are readable by every user. No Foundry key in `.mcp.json`.
- **A5. Silent dependency on a shim.** Linear's VS Code/Windsurf/Zed setup relies on `npx mcp-remote`, which adds a Node dependency and a per-workspace config dir.
- **A6. Per-version flags in docs.** Codex "may first need `experimental_use_rmcp_client = true`" (Linear page); Claude plugin features carry "requires v2.1.2xx". Ship a `doctor` that checks
  each client's real behaviour (`claude mcp list`, `codex mcp list`) instead of trusting a table.
- **A7. Project-scoped servers load unprompted in headless runs** (`claude -p`): a repo-committed Foundry entry can run without the person seeing a prompt. Say so in the org guide.
- **A8. Telemetry on by default** in an install wizard that sends source files to a model provider (PostHog documents both). Foundry is local-first; default off, opt in, say what leaves the machine.
- **A9. Docs that speak to the reader's agent.** Vendor pages embed imperative text for agents ("Don't use the Payment Intent API unless the user explicitly asks"; `install_vercel_plugin`
  front matter). This helps vendors steer agents and is a prompt-injection surface for everyone else. AGENTS.md already says corpus and task documents are data; the same holds for the
  onboarding site Foundry will serve: render agent-facing instructions in a clearly separated file (`SKILL.md`) the user can open, not inside page prose.
- **A10. Unverifiable benchmark numbers** in third-party onboarding posts (before/after times, "60%+ conversion"). Do not quote them in product copy.
- **A11. MCP servers framed as for customers.** Supabase: "don't give it to customers or end users". Foundry's MCP server is a developer-time surface; end-user approvals go through the dashboard.

---

## 5. Concrete designs this sweep supports for Foundry (all local, nothing published)

Each is tagged with the pattern it comes from. The first five matter most.

1. **`foundry setup` (P1, P5, P14).** Detect Claude Code, Cursor, Codex. Print a plan (`--dry-run`, `--json`). Per client: write `.mcp.json` (project scope) or run `claude mcp add`; write the
   skill; show the exact diff. Flags: `--client`, `--yes`, `--status`, `--force`, `--non-interactive` (prints `{reason:"action_required", verification_uri, next}`), exit code 1 when a human step is pending.
   Today's equivalent: `node app/cli.mjs start | mcp | doctor | connect | approve` (read from the repo); `connect` prints, does not write.
2. **First ten minutes with no account, no key (P3, P4).** `start` opens the dashboard with a template workflow already built and practised, a stand-in for every outside effect, and the evidence
   page. The only decision asked: "Which agent do you use?" (default: detected). Success moment is defined and timed locally (P16).
3. **Claim = upgrade (P3).** "Add a second approver" and "Name a rule owner" are the only entries to the paid path. They open a claim flow that turns the anonymous workspace into an org
   (owner identity, SSO later). Matches D2 and the Stripe rule that two-party approval needs a different principal; Stripe's single-user case ("agent is an independent actor") is precisely the
   free tier: **a human approving their own agent**.
4. **Approval as a URL-mode flow (P6).** Approval cards open on the local dashboard origin with the version hash and effects; approve returns a one-use token; the agent retries. Mark the MCP
   approve tool person-only (existing finding in TEARDOWN lesson 4), and show the expiry. Free tier shows "Approver: you"; paid shows named roles and forbids self-approval (Stripe: "A user can't approve their own request").
5. **BYOK entry out of band (P7).** Key entry is a dashboard page or a plugin `userConfig` sensitive field that writes to the OS keychain; the MCP never asks for a key in form mode (spec MUST NOT).
6. **Connect page with per-client tabs (P8).** Claude Code first, then Cursor, then Codex; each shows the real command or link with the user's port and path filled in and a Copy button; Cursor and
   VS Code get local deeplinks (`cursor://anysphere.cursor-deeplink/mcp/install?name=foundry&config=<base64 stdio config>`; `https://vscode.dev/redirect/mcp/install?...` is a redirect on vscode.dev, so use `vscode:mcp/install?...` locally [I; not confirmed in a page I opened]).
7. **Generated org artifacts (P10).** For an org: (a) managed-settings JSON with `extraKnownMarketplaces` + `enabledPlugins` + `pluginSuggestionMarketplaces`, (b) repo `.claude/settings.json` variant, (c) Cursor
   team-marketplace "Required"/"Default On" instruction, (d) `managedMcpServers` entry (https only; no command, so the stdio local server is not delivered this way; the hosted control plane later is).
8. **Relevance block (P11).** `{topic:"Workflow automation", signals:{filesRead:["**/*.n8n.json","**/.github/workflows/*"], cli:["n8n","make","zapier"], hosts:["n8n.cloud","hooks.zapier.com"]}}` [I].
9. **Docs as onboarding (P9).** Site pages with `.md` twins, `/llms.txt`, copy menu, and `foundry docs <topic>` in the terminal (Stripe's `stripe docs`).
10. **Honest boundary on the Connect page (P13).** Plain-language version of DESIGN §6.4 beside the auto-approve toggle.
11. **Three scope presets at connect (P12).** Read and practise / build and run in practice world / run for real with approval (off by default).
12. **Capability grants for nodes** (owner's side-request about MCP servers and skills for nodes): the Claude Code managed MCP model (`allowedMcpServers` by `serverUrl`/`serverCommand`,
    "serverName is not a security control", `managedMcpServers` without `command`/`env`) and Codex per-tool `approval_mode` are the closest shipped precedents for per-node grants [I].

---

## 6. Gaps in what I could verify (so nobody quotes them)

- Stripe docs "signed-in keys injected into code samples" (docs text I fetched did not show it). Supabase quickstart auto-fill not confirmed.
- Clerk "claim" UI affordance, Vercel Deploy Button query parameters, Railway template env prompting, Linear first-run steps, Temporal 2026 free credits: pages did not show them.
- Codex headless device login and API-key setup: not on the pages I got.
- `vscode:mcp/install` scheme: not confirmed in a page I opened (only the vscode.dev redirect form on Stripe's page).
- Claude Code `claude.ai/code?prompt=...` parameters come from a third-party mirror of the docs, not an official page I opened.
- Cursor "Add to Cursor" button markup and link generator: not in the text returned.
- Anything about pricing/plan gating of Stripe approvals, Cursor team marketplaces, Claude custom connectors beyond the Free one-connector limit.
- I did not use any product; all behaviour is documentation text.

---

## 7. Source list (all read 2026-10-21 unless noted)

Claude Code: https://code.claude.com/docs/en/quickstart, /mcp, /plugin-marketplaces, /plugins/install, /plugins/org, /plugins/relevance, /plugins/cli-hints, /plugins/manifest-reference, /managed-mcp, /deep-links.
Claude: https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp ; https://www.anthropic.com/engineering/desktop-extensions .
Cursor: https://cursor.com/docs/context/mcp , /mcp/install-links , /plugins , /get-started/quickstart ; forum.cursor.com threads 133027, 146273, 150650 (search results).
Codex: https://learn.chatgpt.com/docs/extend/mcp?surface=cli (redirect target of developers.openai.com/codex/mcp), https://learn.chatgpt.com/docs/codex/cli .
Stripe: https://docs.stripe.com/cli/install , /cli/login , /cli/agent/setup , /mcp , /keys , /account/approvals , /payments/quickstart (partial).
Vercel: https://vercel.com/docs/cli , /cli/setup , /cli/mcp , /cli/login , /cli/integration , /deploy-button ; https://vercel.com/changelog/vercel-cli-for-marketplace-integrations-optimized-for-agents .
Supabase: https://supabase.com/docs/guides/getting-started/mcp , /getting-started/quickstarts/nextjs , /local-development/cli/getting-started .
Clerk: https://clerk.com/docs/quickstarts/nextjs , /quickstarts/overview , /guides/development/clerk-environment-variables .
Railway: https://docs.railway.com/guides/cli , https://railway.com/agents , https://docs.railway.com/guides/templates .
Linear: https://linear.app/docs/mcp , /docs/start-guide . Trigger.dev: https://trigger.dev/docs/quick-start , https://trigger.dev/SKILL.md .
PostHog: https://posthog.com/docs/getting-started/install , https://github.com/PostHog/wizard , https://posthog.com/docs/model-context-protocol .
Resend: https://resend.com/docs/send-with-nextjs , /docs/mcp-server . Inngest: https://www.inngest.com/docs/getting-started/nextjs-quick-start , /platform/environments .
Temporal: https://docs.temporal.io/cloud/get-started , /cli/server , /cloud/tcld/login ; https://temporal.io/blog/get-usd1-000-in-free-credits-and-build-better-workflows-with-temporal-cloud (search result only).
Cross-vendor: https://neon.com/docs/cli/init ; https://github.com/neondatabase/add-mcp ; https://www.prisma.io/docs/postgres/introduction/npx-create-db ; https://docs.convex.dev/cli/local-deployments ;
https://github.com/getsentry/sentry-wizard (search result) ; https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation , /basic/authorization ;
https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/generic-server-json.md ; https://chabot.dev/almanac/04-metrics/activation-metrics/ ;
https://www.skene.ai/resources/blog/developer-onboarding-guide ; https://www.pmsynapse.in/blog/time-to-value-devtools-onboarding-aha ; https://blog.segment8.com/posts/developer-experience-optimization/ ;
docs-for-agents examples: https://docs.optimism.io/ai-docs , https://docs.landing.ai/ade/build-with-ai-agents , https://docs.raydium.io/sdk-api/ai-integration , https://use.docs.page/ai-agents/overview .
