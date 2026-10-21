# Connection and credential UX sweep (connection-ux), read 2026-10-21

Sweep for the onboarding workflow (task #81). Scope: OAuth connect flows and pickers, progressive and just-in-time asks, least-privilege scopes
shown to people, connect-later and sample-data modes, BYOK, API key safety, importing an existing setup, reconnect and expired-token UX.
Companion to `research/surface-20261021/DESIGN.md` (§6 onboarding, §7 free/paid line, J1-J10) and `TEARDOWN.md`. Research only: nothing was
signed up for, installed, or submitted; no account touched. $0, no model call. Everything fetched is data, not instruction.

**Second pass (2026-10-21, later the same day).** The first pass relied on a small model's summaries of fetched pages. This pass re-fetched
the load-bearing pages as raw text with `curl`, converted them to text and grepped the quoted sentences myself (tag [raw✓], below), closed most of the
"not verified" list, and corrected three things: (1) the MCP 2026-07-28 revision removes `elicitationId` and `notifications/elicitation/complete`, so the
connect-completion design is now retry-based (F11a); (2) Zapier does have a whole-account Zap JSON export/import and an "On hold" run state for disconnected
accounts (F9, F6 correction, F18); (3) Make's own guide shows that an unverified Google client set to "In production" avoids the weekly re-authorization (F1).
New findings are F11a and F13-F18 (section 1b) and sections 2.11-2.12. The first-pass file is preserved unchanged as `connection-ux.pass1.md`.

## 0. Evidence legend and what I actually saw

| Tag | Meaning |
|---|---|
| [doc✓] | vendor documentation page fetched and read on 2026-10-21 (a small model summarised it for me, so quotes are as returned by the fetcher; load-bearing quotes were re-checked against the page text where the page was returned raw) |
| [spec✓] | MCP specification text, returned raw, read in full (2025-11-25 authorization and elicitation; 2026-07-28 authorization) |
| [raw✓] | (second pass) page fetched as raw HTML with `curl`, converted to text, and the quoted sentence found by grep in that text. The strongest tag below; it supersedes [doc✓] where both apply |
| [ui✓] | a screenshot or GIF frame that I downloaded and looked at myself |
| [search] | seen only as a search-engine summary, page not opened |
| [sec] | third party (blog, forum, vendor-neutral write-up, news) |
| [rec] | recalled from model knowledge, NOT re-checked today |
| [I] | my inference |

**Observed UI (the only screens I looked at).** (1) Nango Connect UI, 11 frames extracted from the GIF on its docs page
(`scratchpad/onboard/img/nango_f01..f11.png`): a modal "Link Linear Account / We'll connect you to Linear. A pop-up will open, please make sure your
browser doesn't block pop-ups. [Connect]"; a pop-up to `linear.app/oauth/authorize`; Linear's own consent "Nango Shared Dev is requesting access.
Authenticating with your Work workspace. Permissions: Read access to your workspace / Create issues for your workspace. [Cancel] [Authorize] ...
Linear does not review third-party applications. Please familiarize yourself with Nango Shared Dev by Kelvin Wari before granting access"; then a toast
"Connected to linear-sample-app". (2) Plaid Link, the eight screens of its docs tour, montaged in `scratchpad/onboard/img/plaid_montage.png`.
Nothing else below is observed UI; it is documentation text. Raycast's BYOK screenshot URL turned out to be a generic chat image, so I do not claim to have
seen Raycast's key screen.

**Observed UI added in the second pass** (three docs screenshots I downloaded and viewed; they show vendor demo accounts, not live products):
(3) Zapier "Apps > Connections" (`img/zapier_connect.png`): a table with columns Name, App, Zaps (count), Last modified, People with access, a kebab menu per row,
an "Add connection" button and a "View apps report" button; the demo account has two rows both called "Slack" and several "Legacy" entries; the list shows no
connected-account identity and no health or expiry column. (4) Metabase setup wizard step 3 "Add your data" (`img/metabase_adddb.png`): the card's own intro says
"You'll need some info about your database, like the username and password. If you don't have that right now, Metabase also comes with a sample dataset you can get
started with.", above the credential form (Database type, Name, Host, Port, Database name, Username, Password masked as dots); the "I'll add my data later" control
is below the crop. (5) Power Platform "New Connection Reference" panel (`img/ms_connref.png`): Display name, Name, Description, Connector, and a Connection dropdown
that shows the signed-in account identity (an email) next to a Refresh control, then Create / Close.

**Second-pass status of the first pass's "not verified" list.** Now read: Linear MCP docs [raw✓] and Atlassian Rovo MCP authentication docs [raw✓] (the first pass got a 503
and a login wall); the Google "Unverified apps" help page [raw✓] (it describes the unverified-app screen; I did not see the screen itself); Zapier run statuses and the
auto-off rule [raw✓]; 1Password secret references [raw✓]; Continue and Cline key handling [raw✓]; Cursor install links [raw✓ docs, link format partly from search].
**Still not verified** (do not quote as fact): Merge Link's actual screens (no screenshots on its docs); Composio's connected-account status list (page 404); ChatGPT help
centre pages (403, search summaries only); Zapier's actual reconnect screens (docs text and one connections-list screenshot only); Zed's "reset key" UI (the docs page was
restructured; first-pass summary only); Infisical and Doppler flows; Raycast's actual key screen.

---

## 1. The findings that change Foundry's design (ranked by leverage)

**F1. Connections are the part of onboarding that no amount of copy fixes, because of who owns the OAuth app.** A local-first product has no verified
OAuth client with Google. Make, a mature SaaS, still sends users through "your own project in Google Cloud Platform and a custom OAuth client"
(five stages, about 26 actions, 19 screenshots by my count) for Drive and Sheets, and warns that a project left in Testing "will be required to reauthorize
your connection in Make every week" [doc✓ help.make.com]. Google's own Workspace MCP guide is an 11-step list (join a Developer Preview Program, create
a Cloud project, enable APIs, enable MCP services, configure consent screen, add scopes, create an OAuth client with "Use this client for an AI-powered
agent", configure the client, authenticate, add `access_type=offline`) [doc✓ developers.google.com/workspace/guides/configure-mcp-servers]. Google
restricted scopes need an annual third-party security assessment when an app "store[s] or transmit[s] restricted scope data on servers" [doc✓]; the page has
no explicit exemption for device-only apps, so that needs Google's confirmation [doc✓ gap]. Testing-status refresh tokens expire in 7 days; 100 refresh tokens
per account per client; six months idle; password change with Gmail scopes [doc✓ developers.google.com oauth2]. Desktop apps are public clients, PKCE is
mandatory, "Incremental authorization is not supported for installed apps" [doc✓ native-app]. **So for Gmail the honest zero-config answer does not exist
locally. The design must make Gmail optional and make the other ways to do the same effect first-class (F2).**

Two second-pass checks change how to present the Google fallback. (a) Make's guide: a project left at publishing status "Testing" forces weekly re-authorization, and the
fix is to click "Publish app" so the status becomes "In production" [raw✓ help.make.com]. Google's own page: a Testing project with an external user type "is issued a
refresh token expiring in 7 days" unless the scopes are only name, email and profile; "100 refresh tokens per Google Account per OAuth 2.0 client ID", the oldest invalidated
"without warning"; six months unused; password change with Gmail scopes [raw✓ developers.google.com/identity/protocols/oauth2]. (b) Google's "Unverified apps" help page: an
app with sensitive or restricted scopes that has not completed verification shows an "unverified app" screen before the consent screen, and under a policy-enforcement
notice "will be limited to 100 new users until it is verified" [raw✓ support.google.com/cloud/answer/7454865]. [I] A person connecting their own account to their own client
is far below that cap, so the realistic L4 wizard is: create the project, add yourself, request only the one scope needed, **publish to In production and accept the
unverified screen**. The wizard's checker must read the publishing status (or detect the 7-day expiry), because that is the step people miss. Whether Google keeps
tolerating this is unknown, and it must be re-checked before the site promises it.

**F2. A ladder of connection forms from "no connection at all" to "OAuth", ordered by friction and privilege, beats one OAuth button.** Observed in the
market piecemeal: Slack Incoming Webhooks are a send-only credential bound to one channel and one user, "Your webhook URL contains a secret"
[doc✓ docs.slack.dev]; Stripe restricted keys None/Read/Write per resource, "recommended for API keys you give to AI agents" [doc✓]; GitHub fine-grained PATs
with repo selection and URL prefill (`name`, `target_name`, `expires_in`, `contents=read`) [doc✓]; Slack app-manifest link `api.slack.com/apps?new_app=1&manifest_json=...`
[doc✓] and the GitHub App manifest flow (a page POSTs a manifest, user clicks "Create GitHub App", GitHub redirects with a code, exchange within one hour)
[doc✓]: both are "create your own app in one click" and need no publishing by us. Vendor-hosted remote MCP servers where the client can self-register
(DCR now, CIMD later) give OAuth without us owning an app: Notion's hosted MCP runs "an OAuth flow" from the client [doc✓]; Slack's does NOT (no DCR,
"Only directory-published apps or internal apps may use MCP") [doc✓]. **Foundry should present the ladder per slot, cheapest-and-narrowest first (§3.2).**

**F3. "Connect later" is native to Foundry and nobody else can claim it honestly.** Other products make you connect to test (n8n: credentials are needed
to execute; Zapier tests per step with the connected account) or give sample data with no verification. Foundry already has a practice world with stand-ins
and executable checks, bound to the version hash. Power Platform's **connection references** are the closest design precedent: flows bind to a
reference, not a connection; the connection is supplied at import and "any referencing flows can be turned on automatically after the import completes"
[doc✓ learn.microsoft.com create-connection-reference]. Metabase's setup wizard skips data with "I'll add my data later" and ships a Sample Database [doc✓].
**Rule: build and practise with zero connections; bind real connections at activation, the one moment a person is already deciding.** Risk to test:
a practice pass that fails live for auth reasons (scope missing, wrong account); the fix is a read-only **bind preflight** before the activation card (§3.5).

**F4. Ask just in time and in verbs, but know people do not read scope lists.** Felt et al. (SOUPS 2012): 17% of participants paid attention to
permissions at install, 3% of survey respondents answered all three comprehension questions correctly [research, search summary of the paper's abstract].
Wijesekera et al. (USENIX Security 2015): in a 36-person field study at least 80% would have blocked at least one request and over a third of all requests
[research, search summary]. A later paper reported ask-on-first-use fails expectations over half the time [sec, via a citing paper; do not quote as a
2015 result]. Auth0 practitioner guidance: ask when the feature is about to be used, not at signup; scope names like `email` hide what is wanted [sec]. Linear's
consent screen [ui✓] is the good example of a vendor writing verbs ("Read access to your workspace", "Create issues for your workspace"). **Foundry
should derive the ask from the proposal (what the flow does), show it as verbs plus a diff against what the vendor will actually grant, and time it at
activation.**

**F5. Least privilege can be computed from the practice run, not guessed.** Stripe's own method for tightening a key is "audit request logs to
determine permissions" (GET = read, POST/DELETE = write), then remove unused permissions [doc✓ restricted-api-keys]. Foundry's practice run records every
capability call. **Auto-derive the minimal scope set from the verified practice run, request exactly that, and show the over-grant when a vendor cannot go
narrower, then narrow it ourselves in the capability contract (for example Gmail "send" cannot say "only to boss@x.com", Foundry can).** I found no product
that does this [I; absence is from what I read, not proven].

**F6. Reconnect must be a run state, not an error, and it must not need re-approval unless the identity changed.** Evidence of pain: Zapier community
threads say re-authentication is manual, a Zap "usually throws an error once its connection drops", an "email from contact@zapier.com with Reconnect in the
subject", one report of silent stop, one April 2026 report of a 429 on reconnect [sec]; Zapier help: Reconnect only for connections you own, "will be
reconnected for all Zap workflows", and if the owner loses access the Zap "pauses" [doc✓/search]. Best practice: Plaid update mode (abbreviated flow,
same `access_token`, 7-day pre-warning webhooks, `LOGIN_REPAIRED` dismisses your banner) [doc✓]; Merge `RELINK_NEEDED` with `status_detail`,
keeps serving stale data, `Issue.new`/`Issue.resolved` webhooks, magic-link for admins, "reuse the stored `end_user_origin_id` exactly" or you get a second
Linked Account [doc✓]; Nango `auth` webhook `operation=refresh success=false`, then `override` on reconnect, "re-authorization preserves data and config",
recovery webhook [doc✓/search]; Claude Code warns "Your login expires in 3 days · run /login to renew", `/mcp` Re-authenticate, background sessions stall
on expiry and `claude -p` cannot run OAuth [doc✓]. **Foundry: preflight before every scheduled run, N-day warning in the inbox, a run that hits an expired
credential waits in "needs you: reconnect" and resumes from the failed step (engine wait/human-task; replay-only-failed-step is a Zapier-documented
pattern [doc]); same identity and no wider scopes means no re-approval.**

**F6 correction (second pass).** Zapier is not error-only. Its run statuses (help page updated 2026) include **On hold** ("waiting for an issue to be fixed before it can
continue. Zapier stores the trigger data for held runs, so no data is lost"; common causes include "disconnected app accounts"; held runs or steps can be replayed),
**Needs review** (human in the loop), **Safely halted** and **Errored**. A Zap is turned off automatically when it "Errors 95% of the time it runs" and "Has run more than
20 times in the past 7 days", with an email to the owner and a 24 h (Team) or 72 h (Enterprise) grace period; held and halted runs do not count toward the shutoff
[raw✓ help.zapier.com articles 20505304170637 and 8496216132621]. So "a run waits in needs-you: reconnect and can be replayed" has a precedent, and Foundry's difference
has to be stated as what I did not find there: a warning before expiry, a binding hash that decides whether a reconnect needs a new approval, and checks that run again on
resume. One more fact for unattended work: `claude -p` and Agent SDK runs cannot run OAuth, so sign-in must happen first in an interactive session or with
`claude mcp login <name>` (`--no-browser` for headless) [raw✓ code.claude.com/docs/en/mcp]. A scheduled Foundry run therefore needs preflight-then-wait, never an
interactive prompt.

**F7. The model must never hold a secret, and "never" should be a test.** 2026 pattern: the agent gets a placeholder and an egress proxy swaps in the real
value only for approved hosts (Google Managed Agents, NVIDIA OpenShell, Varlock, Alibaba Agent Sandbox) [sec; vendor blogs, self-reported]. Its stated
limit: "prevents exfiltration but not misuse" and needs least-privilege scope plus an OS sandbox [sec: workos.com/blog/agent-credential-architectures,
varlock guide]. MCP spec: third-party credentials via URL-mode elicitation "MUST NOT transit through the MCP client" and servers "MUST NOT" do token
passthrough [spec✓]; form-mode elicitation "MUST NOT" collect API keys [spec✓]. Foundry already keeps `INCEPTION_API_KEY` out of the executor sandbox
(policy note 2026-10-21.1). **Extend to a vault of opaque handles, injection at the capability host bound to host+path, and a canary-secret test that
fails the build if a planted secret ever appears in a prompt, journal, log or tool result.**

**F8. BYOK done right is paste-free, verified, free and honest about what it does not cover.** OpenRouter "Sign in with OpenRouter" is OAuth PKCE that
returns a user-owned key; localhost callbacks work on any port; headless mode shows a code to paste back [doc✓]. Raycast: Settings → AI → add key →
**Verify** → Save, per-key enable toggle, and "requests are processed through our servers" for Anthropic/Google/OpenAI keys but direct for OpenRouter
[doc✓/search]; Raycast v2 moved BYOK behind Pro [search] (a counter-example to D11). Cursor: paste in Settings → Models, Save; own keys "only work with
chat models", "Tab completion continues using Cursor's built-in models", ZDR "does not apply", Teams plans still pay a $0.25/M-token rate [doc✓]. Zed: keys
"stored in the system keychain, not in settings.json", env var takes precedence over keychain [doc✓]. Claude Code: asks once whether to use an
`ANTHROPIC_API_KEY` found in the environment and remembers the answer; `apiKeyHelper` for rotating keys; a warning when a stale env key overrides a
subscription [doc✓]. **Hard constraint: Foundry's own model calls cannot ride a user's Claude subscription.** Anthropic: developers building products
"should use API key authentication", "Anthropic does not permit third-party developers to ... route requests through Free, Pro, or Max plan credentials
on behalf of their users", and may not "collect, store, or intermediate Claude.ai credentials" [doc✓ code.claude.com legal-and-compliance]. So the
no-key path for Claude Code users is the agent doing the thinking through MCP, with Foundry doing practice, checks and approval (§3.3).

**F9. Import is a consent-and-denylist problem, not a parsing problem.** Claude Code has `claude mcp add-from-claude-desktop` (macOS/WSL, interactive
picker, renames conflicts) [doc✓]; VS Code has "Add from another application ... discover existing server configurations" [doc✓]; `add-mcp` (Apache-2.0)
detects ~22 agents and writes their config files, project scope by default [doc✓]. Safety patterns worth copying: Claude Code asks before using
project-scoped `.mcp.json` servers and "A cloned repository can't approve its own servers"; it will not expand `ANTHROPIC_API_KEY` and similar into a remote
server's `url`/`headers`, "to prevent a project's .mcp.json or a plugin from sending your Claude Code or cloud provider credentials to a server it names"; it
strips `*TOKEN*`/`*SECRET*`/`*KEY*`/`*AUTH*` from the environment of helpers declared in project files [doc✓]. n8n exports carry credential names and IDs, not
secrets ("the names could be [sensitive]") [doc✓]; Zapier has a whole-account Zap JSON export and import (Settings > Security and data > Data management; help page updated 2026-05-29; imports land in a new "Imported Zap workflows - date" folder and the page says "Test your app connections. If an app connection is no longer active, reconnect" [raw✓]; the TEARDOWN statement that Zapier has no export is out of date, and I could not tell whether that JSON carries connection ids); Make blueprints "include scenario modules, settings, and mapped values" but "users still need to create connections", with a 2 MB limit [raw✓ help.make.com/blueprints.md]. **Foundry's importer should list what it found per user-approved
location, import references (env var names, helper commands, keychain items) not secrets, apply the same credential denylist, and treat any config found in
a repository as untrusted data (AGENTS.md).**

**F10. Org rollout is "admin enables, member authenticates", and the connection owner is a principal.** claude.ai connectors: owners add a connector,
"Enabling a connector makes it available to your team, but it doesn't automatically grant anyone access", members authenticate individually unless
enterprise-managed auth (beta) lets an admin authorize once, members "can request connectors" [doc✓]. MCP 2026-07-28 Enterprise-Managed Authorization
extension: the IdP decides which clients reach which servers for which users, no per-user consent screens [search; sec]; Notion already documents it
("without a consent screen") and recommends "a Notion service account rather than a personal account" for an org-wide agent [doc✓]. Zapier: share a
connection with users/teams without giving the login; if the Zap owner loses access the Zap pauses [doc✓]. Power Platform: the person turning a flow on must
own or be shared every connection (`ConnectionAuthorizationFailed`), co-owners can then toggle [doc✓]. Stripe: **agent-tagged restricted keys are
automatically subject to approval rules** with a designated reviewer for payouts, refunds and account changes [doc✓]. **That is Foundry's paid line
(second authority) showing up in a vendor's own product: connection owner, approver and developer are different principals.**

**F11. The agent-side protocol for "a connection is missing" exists and is standard. (This paragraph describes the 2025-11-25 revision; 2026-07-28 changed the completion mechanism, see F11a.)** MCP 2025-11-25: a server returns `URLElicitationRequiredError`
(code -32042) with a `url` and `elicitationId`; the client shows the full URL, highlights the domain, never auto-opens or prefetches, and may retry when
`notifications/elicitation/complete` arrives; "MUST NOT provide a URL which is pre-authenticated"; the server "MUST ensure that the user who started the
elicitation request ... is the same user who completes the authorization flow" (phishing section) [spec✓]. Same pattern in the market: Composio
`COMPOSIO_MANAGE_CONNECTIONS` returns a Connect Link, "Credentials never pass through your app or the model" [doc✓]; Arcade `authorize()` returns a URL,
`wait_for_completion()` [doc✓]; Merge Agent Handler: first tool call by a Registered User triggers Link [search]; claude.ai custom connectors offer "sign in
now / sign in when needed / no sign-in" [doc✓] which is exactly connect-now / later / never. **Foundry's MCP server returns `connection_needed` with a
dashboard URL via URL-mode elicitation (fallback: a link in `say`), gated by the dashboard key so the URL is not a bearer, and the run resumes on the
completion notification.**

**F12. The honest unknowns are bigger than the polish.** No user has used any of this; step counts below are my reading of docs; CIMD requires hosting a
client metadata document at an HTTPS URL, which is publishing and so blocked by D13 (use DCR and pre-registered localhost clients until the owner says
"publish"); the keyring library for Node (see §2.7) must be acquired, pinned and tested per AGENTS.md before anything depends on it.

---

## 1b. Second-pass findings (F11a, F13-F18)

**F11a. Protocol amendment: 2026-07-28 completes an out-of-band step by retrying, not by notification.** From the 2026-07-28 changelog against 2025-11-25 [raw✓
modelcontextprotocol.io/specification/2026-07-28/changelog]: "Remove the `notifications/elicitation/complete` notification and the `elicitationId` field of URL mode
elicitation requests ... Under the Multi Round-Trip Requests pattern, the client learns the outcome of an out-of-band interaction by retrying the original request";
servers needing correlation "encode their own identifier in `requestState`". MRTR replaces server-initiated `elicitation/create`, `sampling/createMessage` and `roots/list`
with an `InputRequiredResult` (`resultType: "input_required"`, `inputRequests`) that the client answers with `inputResponses` on a retry. Protocol sessions and
`Mcp-Session-Id` are removed; cross-call state uses "explicit, server-minted handles passed as ordinary tool arguments". Dynamic Client Registration is deprecated in favour
of Client ID Metadata Documents but still allowed; clients "MUST key persisted credentials by the issuer identifier" and DCR clients must send an appropriate
`application_type`; `iss` is validated before the code is redeemed. The 2025-11-25 page itself labels URL-mode elicitation "New feature ... design and implementation may
change" [raw✓]. Claude Code supports both revisions: URL mode "asks whether to open a link in your browser", caps the URL length (about 8,000 characters, about 4,000 if
percent-heavy), has an Elicitation hook that can auto-answer, and on 2026-07-28 connections declares `elicitation: {form: {}, url: {}}` [raw✓
code.claude.com/docs/en/mcp]. **Design consequence: do not depend on a completion signal.** The `connect` tool returns `connection_needed {slot, handle, url}`; the agent
retries the same call after the person finishes in the dashboard; Foundry finds the binding by the server-minted `handle`. The URL stays short, the behaviour is the same on
2025-11-25 clients (they may also get the notification; ignore it) and on clients with no elicitation (the link is in the `say` field). This is how Foundry's tools already
pass `proposalId` and `flowId`. The Enterprise-Managed Authorization extension (`io.modelcontextprotocol/enterprise-managed-authorization`) is now read at source, upgrading
F10 from [search]: the org's IdP is "the authoritative decision-maker", the client obtains an Identity Assertion JWT Authorization Grant (ID-JAG) from the IdP and exchanges
it at the MCP server's authorization server, and clients are told "Do not redirect the user to the MCP Authorization Server's authorization endpoint"; revocation happens
at the IdP [raw✓ modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization].

**F13. "Connected" must mean "a real call went through and its result was used", not "a config was saved".** VS Code's MCP guide (2026): "Adding a configuration isn't proof
that the agent can use the server", and the connection works only when three checks pass: a tool from the intended server was called in the session, it returned without a
connection error, and "The agent's answer reflects that tool output. A plausible answer alone isn't sufficient." [raw✓ code.visualstudio.com/docs/copilot/customization/mcp-servers].
n8n tests a credential on save, Raycast has Verify (first pass). This is the repo's own rule (README: a valid schema, a successful model response and a verified outcome
are three different results) applied to connections. **Foundry's bind preflight is a named read-only capability probe whose output is checked by code, not by model prose,
and the card says "Connected as X; read test passed 14:02".**

**F14. Least privilege can be chosen by endpoint, by pinned scope, or by who may hold a key, and permission growth has an explicit "old permissions stay until approved" state.**
- Linear: `https://mcp.linear.app/mcp/readonly` "only ever exposes read tools"; the standard endpoint with only the `read` scope gives a token that "can't reach write APIs";
  setup is OAuth 2.1 with dynamic client registration, with bearer token or API key as an alternative [raw✓ linear.app/docs/mcp].
- Claude Code `oauth.scopes` pins what is requested ("the supported way to restrict an MCP server to a security-team-approved subset"); when unset it does not request the full
  `scopes_supported` catalogue; on `403 insufficient_scope` the call fails with a "needs additional permissions" message naming the scope and the server shows as needing
  authentication in `/mcp` [raw✓].
- Atlassian Rovo MCP: OAuth 2.1 for interactive use; personal API token (Basic) or service-account API key (Bearer) only "if enabled by your organization admin" and
  recommended "only for non-interactive or machine-to-machine use cases"; usage consumes Rovo credits [raw✓ support.atlassian.com].
- GitHub Apps: when an installed app asks for more permissions the owner is notified; "If you do not approve the additional permissions, the GitHub App will still retain
  its current permissions. The GitHub App may not function as expected" [raw✓ docs.github.com].
- Shopify: scopes declared as `optional_scopes` can be requested later; the merchant sees "a permission grant modal on top of your running app" (embedded) or is redirected
  to the Shopify admin; scopes in the required `scopes` field "can't be requested dynamically" [raw✓ shopify.dev]; granted per store.
Design takeaway for Foundry's step-up: a new card with the diff, the flow keeps running on the old grant, and the blocked step is named in plain words; the model never asks
for more at consent time than the practice-derived set (F5).

**F15. Credentials by reference is already the convention; copy the reference forms and offer one default per persona.** Continue `config.yaml`: `apiKey: ${{ secrets.NAME }}`
[raw✓ docs.continue.dev]; Cursor `${env:NAME}`; Codex `bearer_token_env_var`, `env_http_headers`, `http_headers_helper` (a command that prints headers) [raw✓
developers.openai.com/codex/mcp]; Claude Code `headersHelper`, run without credential-looking environment variables when it comes from a project file [raw✓]; VS Code
`inputs` with `password: true`; 1Password `op://<vault>/<item>/<field>` resolved by `op run` / `op read`, with the caution "You should assume that processes on your computer
can access the environment of other processes run by the same user" [raw✓ developer.1password.com]. **Foundry slot config stores `{kind: keychain | env | op | helper, ref}`
and never a value; org default is `op://` or a vault helper; env is the weakest rung and the doctor says so.**

**F16. Importing from another client is also a format-normalization problem.** VS Code's own file uses a top-level `servers` object while portable files use `mcpServers`
("Don't copy a configuration between them without checking the format"); Claude Code treats an entry with a `url` but no `type` as a stdio server, which is a configuration
error; Codex uses TOML; locations differ (table in 2.11) [raw✓]. An importer needs a normalizer with a per-client round-trip test, not a JSON copy.

**F17. Install lines: how Foundry's own MCP server reaches the first three agents without publishing anything.** Claude Code: `claude mcp add --transport http|stdio <name> ...`,
written to local scope unless `--scope project|user`, and a project `.mcp.json` server waits at "Pending approval" until the person trusts the folder ("A cloned repository
can't approve its own servers") [raw✓]. Codex: `codex mcp add <name> -- <command>`, `codex mcp login <name>` for OAuth servers, config in `~/.codex/config.toml` or a trusted
project's `.codex/config.toml`; the desktop app, CLI and IDE extension share it [raw✓]. Cursor: an install link `cursor://anysphere.cursor-deeplink/mcp/install?name=<name>&config=<base64 of the
JSON config>` where "Cursor prompts to install the server" [raw✓ cursor.com/docs/mcp/install-links for the prompt; the exact parameter format from search and a forum report],
with the web form `https://cursor.com/link/...`; Cursor's own deeplink page says prompts, commands and rules need the user to "review and confirm" and "Deeplinks never trigger
automatic execution" [raw✓]. VS Code: "MCP: Add Server" in the Command Palette [raw✓]. Linear already ships a vendor "install by clicking here" Cursor link [raw✓]. A local
dashboard page can print these lines with copy buttons and a Cursor link; that publishes no package and deploys nothing (D13 untouched). A `.mcpb`, plugin or marketplace entry
would be publishing and stays blocked.

**F18. A "held" state for a disconnected account exists in the market; what is missing there is the proactive part.** See the F6 correction: Zapier "On hold" keeps the trigger
data and allows replay [raw✓]; Plaid update mode and Merge `RELINK_NEEDED` (first pass) add pre-warnings and stale-data serving. No single product I read combines (a) a
warning before expiry, (b) a held run that resumes at the failed step, and (c) an approval whose validity depends on whether the identity and scopes changed. That
combination is Foundry's reconnect design (3.5). [I; absence is from what I read.]

---

## 2. Evidence by theme

### 2.1 Connect flows and pickers (product by product)

| Product | What the person does | Notable design | Source / tag |
|---|---|---|---|
| **Nango Connect UI** | App backend mints a short-lived session token with `tags` (`end_user_id`) and `allowed_integrations`; frontend opens embedded Connect UI. One allowed integration skips the picker and goes "straight to its auth flow". "API-specific guidance, input validation, and your branding". `onEvent` gets `close`/`connect`; success confirmed by backend webhook (`type: auth`, `operation: creation`, `tags`). For email or cross-device, share a connect link instead. Reconnect session keeps data and config. | Picker is skipped when the need is known (Foundry always knows the need). Backend webhook, not the browser callback, is the truth. Observed frames: modal says what will happen and warns about pop-ups; vendor's own consent follows; toast confirms [ui✓]. Nango is under the Elastic License, self-host "free with a limited feature set" (not OSI; check before embedding) | [doc✓] nango.dev/docs/guides/primitives/auth, implement-api-auth, github.com/NangoHQ/nango; [ui✓] |
| **Composio** | `session.authorize()` returns a Connect Link; user signs in on the hosted page; `callbackUrl` gets `status` and `connected_account_id`. Status stays `INITIATED` if the user closes the page. Managed auth: no auth config needed. In-chat: `COMPOSIO_MANAGE_CONNECTIONS` meta tool returns the link into the conversation. | "Callback query parameters alone aren't proof of ownership": check the id against the stored attempt and signed-in user. An alias "doesn't prove which account connected": fetch the provider's current-user. `ensureConnected()` reuses an active connection, `authorize()` always starts a new flow. Own OAuth app / white label only if you "bring your own OAuth app, request specific scopes" | [doc✓] docs.composio.dev authenticating-users |
| **Pipedream Connect** | Server mints a Connect token (`token`, `expiresAt`, `connectLinkUrl`); SDK opens an iframe/popup and refreshes tokens; hosted Connect Link for mobile/no-JS; link "specific to the user and expires after 4 hours"; `external_user_id` identifies the end user. "Approved OAuth clients, or use your own". Does not store request payloads or response bodies. | Popup-blocker advice (`Cross-Origin-Opener-Policy: same-origin-allow-popups`) is a real failure mode. Pipedream Workflows and String shut down 2027-03-31; docs read do not say what happens to Connect (Workday acquisition 2025-11-19) | [doc✓] pipedream.com/docs/connect; [search] Workday newsroom |
| **Merge Link** | Embedded: backend `link_token` → user "picks an integration and authorizes access without leaving your app" → `public_token` → exchanged for `account_token`. Magic Link: send a URL to someone else. Single Integration skips the picker. Relink: `RELINK_NEEDED` goes "straight to authorization". Agent Handler: first tool call by a Registered User triggers Link. | Magic Link is the pattern for "the person who must connect is not the person using the product" (IT admin). Screens not seen | [doc✓] docs.merge.dev merge-link overview, relinking; [search] agent-handler |
| **Plaid Link** | 7 screens in the docs tour [ui✓]: (1) "WonderWallet uses Plaid to connect your accounts", phone number or "Continue as guest"; (2) institution search with a default grid ("Search 11,000+ institutions"); (3) "Log into Gingham Bank. You'll be sent to Gingham Bank to securely log in", footer "You'll share account and routing numbers, account and balance info, and contact details to help you send and receive money. Learn more", button "Continue to log in" with external-link icon; (4) the bank's own page; (5) "Select accounts: Plaid will only share data from the Gingham Bank accounts you select with WonderWallet" with checkboxes and balances; (6) "Success! Your account was successfully connected to Wonderwallet."; (7) optional "Save Gingham Bank with Plaid ... Finish without saving". A three-segment progress bar runs under the header. | One sentence of purpose first; what-will-be-shared in plain words next to the button; resource-level choice (accounts); the optional returning-user step is skippable. Data Transparency Messaging: data scopes plus 1-3 declared use cases, "Learn more" opens "Why is this needed"; `additional_consented_products` declares future needs without fetching or billing them | [ui✓] + [doc✓] plaid.com/docs/link, data-transparency-messaging-migration-guide, best-practices ("Link conversion is highest when users have the right expectations set going into Link") |
| **Zapier** | App Connections page "+ Add connection" or "Sign in" inside a step; "A new browser tab or window will open"; pop-up blocker advice; warns that "Zapier may automatically connect to an existing account" because of browser cookies (use private window). Share a connection with users/teams. Reconnect only for connections you own. | The cookie warning is an identity-confirmation failure the product documents but does not fix. Foundry fix: show provider-reported identity after connect and ask "Is this the account you meant?" | [doc✓] help.zapier.com articles 8496258785421, 8496290788109, 8496326497037 |
| **Make** | Credentials → Connections; Reauthorize; "unpublished apps can only have a 7-day authorization period"; Google Drive/Sheets need your own GCP project and OAuth client. | Even an incumbent pushes the OAuth-app burden to users for Google restricted scopes | [doc✓] help.make.com connect-to-google-services-using-a-custom-oauth-client; [search] |
| **n8n** | Create a credential from a node's dropdown or Credentials page; "When you save a credential, n8n tests it to confirm it works"; OAuth credentials can be "fixed" or per-user at runtime (Enterprise); default name "node name account". | Test-on-save is the cheapest trust builder; per-user credentials are the org case | [doc✓] docs.n8n.io/credentials/add-edit-credentials |
| **Activepieces** | Default OAuth apps "work out of the box with no setup"; replacing with your own client id/secret "is a paid feature". | Precedent that "bring your own OAuth app / branding" is a paid line | [doc✓] activepieces.com/docs admin-guide manage-oauth2 |
| **Power Platform** | Flows bind to *connection references*; solution import asks for a connection per reference; "Invalid Connection" shows a red exclamation on the flow; sharing connections to a service principal enables flows. | Decouple flow from credential identity (Foundry slots) | [doc✓] learn.microsoft.com create-connection-reference |
| **Docker MCP Toolkit** | Catalog tab → add server; OAuth method on a server's Configuration tab opens the browser, an OAuth tab lists authorized services and revokes; Clients tab → Connect writes the client config; Profiles are named server sets. | A local-first app with one-click connect and a revoke list. Secret storage details not on the page | [doc✓] docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit |
| **Arcade / Auth0 Token Vault / WorkOS Pipes** | Arcade: tool call → authorization URL → user approves → agent continues, "Arcade remembers the user's authorization tokens". Auth0 Token Vault assumes a logged-in human; "Privileged Worker" (early access) for no-session agents. WorkOS Pipes: scheduled worker fetches per-connection credentials with no user session. | Brokered, hosted; the same shape as a future Foundry hosted control plane | [doc✓] Arcade; [search] Auth0, WorkOS (vendor marketing) |

### 2.2 Who owns the OAuth app: local-first feasibility matrix

| Service | Zero-config from a local app? | What the user must do today | Tag |
|---|---|---|---|
| Notion | Yes: hosted MCP `mcp.notion.com/mcp`, client runs the OAuth flow; page-level sharing is in Notion's own consent (picker lists only pages where the user has full access; parent grants children). Business/Enterprise: workspace owner can mint an MCP token; Enterprise SSO: managed auth without a consent screen. DCR vs CIMD not stated. | One consent screen | [doc✓] |
| Slack | No via MCP: confidential OAuth, no DCR, "Only directory-published apps or internal apps". Workaround that needs no publishing: **one-click own internal app** from a manifest link, or an **Incoming Webhook** (channel-bound, post-only). | Create app from manifest (3 clicks) or pick a channel for a webhook | [doc✓] |
| Google (Gmail, Drive, Calendar) | No. Restricted scopes, verification, annual assessment for server-side storage, Testing = 7-day tokens. Google MCP servers are Developer Preview and need your own OAuth client. | 11 steps (Google) or about 26 actions (Make's guide) | [doc✓] |
| GitHub | Yes via fine-grained PAT URL prefill (user clicks "Generate"), or GitHub App manifest (user clicks "Create GitHub App"). Org approval may leave a token `pending` ("only be able to read public resources until it is approved"). | 1 page + paste | [doc✓] |
| Stripe | Restricted key with prefilled permissions is the safest path; agent-tagged keys get approval rules; sandbox keys `rk_test_` first. A prefill URL for restricted keys was **not found** in what I read. | Create key, copy once (live keys cannot be revealed later), paste | [doc✓] |
| Linear, Atlassian | Not read (503, login wall). Treat as unknown. | — | — |
| Anything with only API keys | Yes: key paste plus Verify. | One paste | [I] |

### 2.3 Progressive and just-in-time permission asks (protocol facts)

- MCP 2025-11-25 and 2026-07-28 authorization [spec✓]: servers "SHOULD include a `scope` parameter in the `WWW-Authenticate` header" so clients ask for least privilege; on `403 insufficient_scope` clients step up; **2026-07-28 changes: clients must request the union of previously granted and challenged scopes** ("to avoid losing permissions"), servers "SHOULD include all scopes required for the current operation in a single challenge" (no one-scope-at-a-time round trips), retries limited ("no more than a few times"), `iss` validation per RFC 9207 before the code leaves the client, refresh tokens via `offline_access` when advertised, DCR "deprecated and retained for backwards compatibility", CIMD preferred.
- Client registration order the spec gives: pre-registered, then CIMD, then DCR, then "Prompt the user to enter the client information" [spec✓]. CIMD security note: "Client ID Metadata Documents cannot prevent localhost URL impersonation by themselves", authorization servers "MUST clearly display the redirect URI hostname" [spec✓]. For Foundry's loopback receiver, expect vendors to show a localhost warning; our pre-screen should say so.
- Google desktop apps: loopback `127.0.0.1:port`, PKCE S256, "Custom URI schemes are no longer supported", no incremental authorization, granular consent means "Your app must verify which scopes were actually granted" by reading `scope` in the token response [doc✓].
- ChatGPT (search summary): per-user confirmation settings Always ask / Any changes / Important actions (default) / Never ask; admins allow all actions, read-only, or a custom set; per-tool control is an admin layer on top of OAuth, not part of the consent screen [search]. claude.ai: per-connector tool permissions grouped read-only vs write/delete with Always allow / Needs approval / Blocked; "These settings only narrow access" [doc✓].

### 2.4 Least privilege shown to people

| Pattern | Example | Tag |
|---|---|---|
| Vendor writes verbs | Linear "Read access to your workspace / Create issues for your workspace" | [ui✓] |
| Resource-level grant inside consent | Notion page picker; Plaid "select accounts" | [doc✓] / [ui✓] |
| Per-resource None/Read/Write | Stripe RAK; "Write permissions imply read" | [doc✓] |
| Short default expiry and URL prefill | GitHub fine-grained PAT: default 30 days, `expires_in` 1-366 or `none`; repo-limited; 50-token cap; tokens unused for a year are removed | [doc✓] |
| Tag the key as an agent | Stripe "Authorizing agent access to your account" turns on approval rules with a designated reviewer by default for payouts, refunds, configuration | [doc✓] |
| Declare use cases with the ask | Plaid DTM: data scopes plus 1-3 use cases, "Learn more" panel | [doc✓] |
| Tool-level read/write grouping | claude.ai tool permissions; ChatGPT read-only / custom action sets | [doc✓] / [search] |
| Show the redirect host | MCP CIMD guidance | [spec✓] |

### 2.5 Connect later, sample data, practice

- Metabase wizard step 4 "Database info and connection (skippable with I'll add my data later)"; Sample Database (Orders, People, Products, Reviews) stays available afterwards [doc✓].
- Plaid: Sandbox lets you bypass Link with `/sandbox/public_token/create`; `/sandbox/item/reset_login` to test update mode [doc✓]. Stripe: sandbox keys `rk_test_`, "API calls return simulated objects", create the restricted key in a sandbox first, then live [doc✓].
- Claude connectors "sign in when needed" auth mode [doc✓]. Zed/Cursor/Raycast: model features simply do not light up until a key is present [I].
- Power Platform connection references: flows can be imported without being bound, then turned on after connections are supplied [doc✓].
- n8n: its builder sends "mock execution data" to the model and offers Execute and refine [TEARDOWN 1.1; doc✓ there].
- **What none of them do (as far as I read): run the product's own checks against the stand-ins, bind the pass to a version, and then verify the binding before activation.** That is Foundry's practice loop plus bind preflight.

### 2.6 BYOK flows (what to copy and what to avoid)

| Product | Flow | Copy | Avoid |
|---|---|---|---|
| OpenRouter OAuth | "Sign in with OpenRouter": `/auth` → code → exchange at `/api/v1/auth/keys` → user-owned key, billed to their credits; `callback_url` any localhost port; headless prints a code; code valid 10 minutes; `key_label` prefill | paste-free; `key_label` prefill ("Foundry on <host>") | localhost apps appear with a fixed title (attribution is for public URLs) |
| OpenRouter BYOK | keys in workspace settings; Prioritized/Fallback sections; "Never use shared capacity" levels; 5% fee on BYOK; Activity shows provider attempts | explicit fallback policy per key; show which key paid | fee on own keys |
| Raycast | Settings → AI → Models & Providers → "+" → provider → paste → **Verify** → Save; per-key toggle; remove; open provider console to rotate | Verify before Save; toggle without deleting; link to provider's console | requests go through Raycast servers for Anthropic/Google/OpenAI; BYOK needs Pro in v2 |
| Cursor | Settings → Models → paste → Save; models appear in picker | immediate visible effect | no Verify; ZDR does not apply; partial feature coverage; fee on Teams |
| Zed | Settings → AI → LLM Providers; keychain; env var wins; remote projects read the local keychain | env var detection with precedence stated; "Do not put API keys in settings.json" | — |
| Codex CLI | `codex login --with-api-key` from stdin; `cli_auth_credentials_store` = file / keyring / auto / ephemeral; "plaintext file at ~/.codex/auth.json" by default; device-code login for headless | store modes with a loud "fails if unavailable" option; stdin not argv | plaintext default |
| Claude Code | ask once to approve an env `ANTHROPIC_API_KEY`; Keychain on macOS, 0600 file on Linux, fallback to file if Keychain write is rejected; `apiKeyHelper`; `/status` shows which credential is active | which-credential-is-active line | stale env key silently overriding a subscription |
| Continue | `config.yaml` model entries take `apiKey: ${{ secrets.NAME }}`; the reference page's example config also shows a literal key under `anchors` and an `Authorization: Bearer YOUR_OPENAI_API_KEY` header | secret references in config, not values | literal keys in a shareable YAML (the docs show both) [raw✓ docs.continue.dev] |
| Cline | Anthropic path: Console > API keys > Create Key > "Copy the API key immediately. You will not be able to see it again"; a second provider "Claude Code (subscription)" that shells out to the user's local `claude` CLI path ("Uses your Claude subscription limits instead of API token billing"; no streaming, limited caching) | two clearly separated paths (key vs subscription) with the limits of each stated | the subscription provider is a local extension spawning the user's own CLI; whether a hosted Foundry may do the same is the open question in C4, and Anthropic's page says developers "may not collect, store, or intermediate Claude.ai credentials" [raw✓ docs.cline.bot, code.claude.com legal] |
| Open WebUI / LibreChat | not researched | — | — |

### 2.7 API key safety

- **Storage.** OS keychain: Zed [doc✓], Claude Code on macOS [doc✓], Codex `keyring` mode [doc✓], VS Code "securely stored" for `inputs` without saying where [doc✓]. Plaintext: Codex default, Claude Code on Linux/Windows (0600 / profile ACL) [doc✓].
- **Node on Linux/macOS/Windows.** `keytar` is archived [sec: Zowe issue 1622]. `@napi-rs/keyring` 2.1.2, MIT, npm modified 2026-10-19 (checked with `npm view`), a "100% compatible node-keytar alternative" over keyring-rs; on Linux it tries Secret Service then silently falls back to the kernel keyutils keyring which "is completely in-memory and will not persist across reboots"; pinning a store makes the constructor throw instead [doc✓ github.com/Brooooooklyn/keyring-node]. `@zowe/secrets-for-zowe-sdk` 8.39.1 is EPL-2.0 (npm view). **Design rule: pin the store, fail loudly, offer a 0600 file only after explicit consent (Claude Code's own fallback is a precedent), `ephemeral` mode for CI (Codex).** Per AGENTS.md any dependency needs URL, SHA, date, license and an acquisition outcome before use; none is acquired.
- **Env vars are the weakest channel.** Blaxel cites a June 2026 npm malware campaign that scanned environment variables [sec; vendor blog, unverified]; MCP spec says STDIO servers "retrieve credentials from the environment" [spec✓] so we cannot avoid env for local MCP, but Foundry's own secrets should not live there.
- **Display and verification.** Stripe: live keys revealed once; "You can't retrieve it later"; add a note where you saved it; rotate with up to 7 days of overlap; expire; keys unused 180 days for payouts lose access [doc✓]. Raycast Verify, n8n test-on-save, Zapier "Test" [doc✓]. Show the provider-reported identity, never the key (§3.6).
- **Leak safety net.** Slack "actively searches out and revokes leaked secrets" for webhook URLs [doc✓]; GitHub secret scanning partner revocation for model-provider keys [rec, not re-checked].
- **Where to ask.** MCP form-mode elicitation "MUST NOT" request API keys; use URL mode to a page served by the app [spec✓]. VS Code docs: "Do not paste credentials into chat" [doc✓].
- **Never pre-expanded from repo config.** Claude Code's credential-variable denylist for remote `url`/`headers` [doc✓].

### 2.8 Importing an existing setup (what exists)

| Source | Mechanism | Secrets? | Tag |
|---|---|---|---|
| Claude Desktop → Claude Code | `claude mcp add-from-claude-desktop` (interactive picker; macOS/WSL; `--scope user`) | config copied by the client | [doc✓] |
| Any agent config → VS Code | "Add from another application..." discovery | — | [doc✓] |
| Many agents at once | `npx add-mcp <url>` detects agents ("automatically detects agents based on your environment") and writes `.cursor/mcp.json`, `.mcp.json`, `~/.cursor/mcp.json`... | writes files; some agents need a restart | [doc✓] |
| Cursor config | `${env:NAME}`, `${workspaceFolder}`, `${userHome}` interpolation; static OAuth `auth: {CLIENT_ID, CLIENT_SECRET}` with fixed redirects `http://localhost:8787/callback` (desktop) | env references, not values | [doc✓] |
| VS Code | `inputs: [{type: promptString, id, description, password: true}]` → `${input:id}`; "The value is then securely stored for subsequent use" (where is not stated); "A personal configuration file is not a secret store" | prompted once | [doc✓] |
| n8n | export JSON has credential names and IDs; `.n8np` packages (Preview) carry folders/projects/references and "check an import before writing anything" | names only | [doc✓] |
| Zapier / Make | Zap JSON (whole account, imports into a new folder) and Make blueprint JSON (per scenario, under 2 MB): flows and mappings come across, connections do not; both vendors tell the user to test or create connections afterwards. Wrapping through MCP/webhooks stays the fallback | no secrets; Zap JSON connection ids not determined | [raw✓] |
| First-run settings import | Cursor-style "import from VS Code" at onboarding | — | [rec] |

### 2.9 Reconnect and expired-token UX (what exists)

See F6. Additional facts: Google refresh token expiry causes [doc✓]; Plaid `PENDING_EXPIRATION` (UK/EU) and `PENDING_DISCONNECT` (US/CA) arrive 7 days before consent expires, and "If several Items need repair, Link prompts for the most recently broken one", one Link per broken Item [doc✓]; Plaid link tokens in update mode expire in 30 minutes, others 4 hours [doc✓]; Merge "keeps serving the data it synced before the connection broke" [doc✓]; Nango retries refresh on a cycle, treats persistent failure as permanent and asks the user to re-authenticate; recovery webhook [search]; Claude Code: "When the server rejects the stored refresh token, Claude Code immediately shows a notice pointing at /mcp" and "A claude -p or Agent SDK run has no /mcp panel, so Claude Code can't run the OAuth flow there" [doc✓]; Make: no setting that warns before expiry (search found none) [search].

### 2.10 Org vs solo (what exists)

See F10. Plus: Claude Code admins can lock login method/org (`forceLoginMethod`, `forceLoginOrgUUID`, `allowedProviders`) and ship `managed-mcp.json` with `allowedMcpServers`/`deniedMcpServers` [doc✓]; Codex admins can enforce login method and credential store [doc✓]; Cursor team marketplaces and allowlists [TEARDOWN]; Copilot Studio admins must enable external models [TEARDOWN].

---

### 2.11 Where an importer looks, and the format traps (second pass, all [raw✓] from the clients' own docs)

| Client | Locations | Format notes |
|---|---|---|
| Claude Code | project `.mcp.json`; user and local scope in `~/.claude.json`; `claude mcp add-from-claude-desktop` (macOS/WSL, interactive picker) | `mcpServers`; `type` accepts `streamable-http` as an alias for `http`; a `url` without `type` is a configuration error; `${VAR}` expansion; credential-looking variables are not expanded into a remote `url` or `headers` from project files (first pass) |
| Cursor | project `.cursor/mcp.json`; global `~/.cursor/mcp.json` | `mcpServers`; interpolation `${env:NAME}`, `${userHome}`, `${workspaceFolder}`; static OAuth `auth: {CLIENT_ID, CLIENT_SECRET, scopes}` with fixed redirects `http://localhost:8787/callback` (desktop) |
| Codex (CLI, IDE, desktop share it) | `~/.codex/config.toml`; project `.codex/config.toml` (trusted projects only) | TOML; `bearer_token_env_var`, `http_headers`, `env_http_headers`, `http_headers_helper`; `auth` mode `oauth` (default) or `chatgpt` |
| VS Code | workspace `.vscode/mcp.json` or user-profile `mcp.json` (labelled deprecated in the guided flow), workspace-root `.mcp.json` (experimental setting) | top-level `servers`, not `mcpServers`; `inputs` with `password: true` |
| n8n / Zapier / Make | n8n export JSON (credential names and IDs only); Zap JSON (Settings > Security and data); Make blueprint JSON (<2 MB) | connections are re-made by the user after import |

Rule for the importer: one parser per client, a normalizer to Foundry's slot model, a round-trip test per client, consent per location, references (env names, helper
commands, `op://` refs, keychain labels) imported and values never copied, and anything found inside a repository treated as untrusted data (AGENTS.md).

### 2.12 What the observed screenshots imply (second pass; [ui✓] unless noted)

- **Zapier's connection list has no identity and no health column**, and a demo account can hold two "Slack" rows. Foundry's Connections cards carry the reported identity, the
  verbs granted, health, owner, "used by", and dedupe by (provider, identity, scope set) with "use the one you have" offered first.
- **Metabase puts the sample-data exit inside the credential card**, in the same paragraph that asks for the credentials. Foundry's slot card puts the no-connection rung (L0,
  practice with stand-ins) first and the credential form last.
- **Power Platform's connection picker shows the signed-in identity** and a Refresh control, and flows bind to a named connection reference (first pass). Foundry's slot is the
  reference; the binding row shows the identity.
- **Nango and Plaid (first pass)**: say what happens, say what is shared next to the button, resource-level choice, confirm toast.

---

## 3. Foundry connection model v1 (proposal)

### 3.1 Objects

- **Slot.** A named need inside a flow version, produced by the compiler from capability contracts already in `app/core/capabilities.mjs` (`outbox.send`, `outbox.check`, `report.tally`): `mail.send`, `chat.post`, `tracker.read`, `model.build`. Carries: effect class (read / reversible write / irreversible write), the operations used, the data direction ("data leaves this machine to ..."), and the *minimal scope set* from a curated scope map per provider.
- **Binding.** Slot → connection, created at activation: `{slot, provider, connectionId, reportedIdentity, grantedScopes (verified from the token response), expiresAt, ownerPrincipal, channel, checkedAt}`. **The approval is bound to the binding hash as well as the workflow hash and arguments** (extends today's tool + args + hash binding). Changed identity or wider scopes ⇒ `STALE_APPROVAL`-style refusal and a new card. Same identity, same scopes, new token ⇒ no new approval.
- **Vault.** Opaque handles in an OS keychain with a pinned store; capability host injects at call time for allowlisted host+path; models, builders, executors and journals see handle and label only.
- **Health.** `unbound → connecting → active(checkedAt) → expiring(days) → needs-you(reason) → revoked`. Preflight before scheduled runs; surfaced in the inbox and the doctor.

### 3.2 The ladder (per slot, shown cheapest and narrowest first)

| Rung | What the person does | Example slots | Evidence |
|---|---|---|---|
| L0 No connection | Take the output: draft opens for them to send, file saved, clipboard. The *human* is the effect. | mail.send ("Make a draft I send myself"), report.save | [I]; mailto/compose links need no auth |
| L1 Webhook URL | Pick a channel/destination at the vendor, paste one URL; send-only, one destination; URL is the secret | chat.post (Slack, Discord, Teams) | [doc✓] Slack incoming webhooks |
| L2 Scoped key from a prefilled vendor link | We open the vendor's key page with name, repo, permissions and expiry prefilled; person clicks create and pastes once; we Verify | GitHub fine-grained PAT; Stripe restricted key (no prefill URL found); Notion internal integration | [doc✓] GitHub URL prefill |
| L3 OAuth via vendor-hosted MCP (DCR now, CIMD later) | Loopback + PKCE in the browser; vendor's own consent screen; token to vault | Notion, others that allow self-registering clients | [spec✓] [doc✓] |
| L4 Own app in one click | Slack manifest link; GitHub App manifest flow; (last resort, wizard) Google custom OAuth client with a step checker | Slack, GitHub, Google | [doc✓] |
| L5 Managed broker (hosted, later, paid) | Broker holds a verified OAuth app; Foundry asks it for per-user credentials | Gmail, Calendar, Drive for non-technical users | [doc✓/search] Composio, Nango, Pipedream, Merge, Arcade, WorkOS, Auth0 |
| L6 Org-delegated | Admin enables or authorizes once; members inherit or click once; service account owns unattended flows | all | [doc✓] claude.ai, Zapier sharing, MCP EMA |
| L7 Wrap what exists | Keep n8n/Zapier/HTTP automation as is; their MCP holds the credentials | any | TEARDOWN "wrap, don't replace" |

L0 and L1 deserve emphasis: they are "effects without connections", they are the least privilege possible, and for the first live run of a non-technical person they are
the shortest path to a real result. Foundry's approval card already says exactly what will be sent; for L0 the person's own click on Send is the second approval.

### 3.3 Order of asks (the progressive sequence)

0. **Install: nothing.** `foundry start` (doctor, dashboard, connect lines) as in DESIGN J1. No keys, no accounts, offline.
1. **First request: nothing for the agent-builds path.** If the person is in Claude Code (D9), the agent writes the proposal; Foundry validates, practises, checks, asks. A key is asked only if they choose "Foundry builds with a cheap model": then the BYOK chooser (below).
2. **BYOK chooser, only then:** [Sign in with OpenRouter] (paste-free), [Paste an Anthropic key] (Haiku 5.5), [Paste an Inception key] (Mercury 3, token cap required), [Use a key already in my environment] (detected names only, approval per name, as Claude Code does). Each: Verify with a read-only call (list models) → show "Connected: Anthropic, key …a1b2, 3 models" → Save to vault. Link to the provider's console to rotate.
3. **Practice: nothing.** Stand-ins; checks run; "Nothing real was sent."
4. **Activation card lists needed bindings in plain words,** each with the ladder. Connections are asked one at a time, here, not before.
5. **Notification channel,** asked the first time something waits ("Where should we tap you?": desktop, e-mail, Slack webhook to yourself). This is the missing piece in DESIGN §4.2 and reuses L1.
6. **On demand only:** step-up scope, reconnect, standing approvals, second approver (paid line).

Persona walk (target ask counts, to be measured, §4): *Solo dev in Claude Code:* 0 asks to first verified practice run; first live effect 1 connection (L1/L2: one paste) + 1 approval. *Non-technical user via dashboard chat:* 0 to first practice; first live effect 1 vendor screen or one paste + 1 approval; Gmail is never required (L0). *Org rollout:* admin 1 time per provider (service account or enable), members 0-1 clicks, approver identity per paid line.

### 3.4 Screens (dashboard) and what each shows

- **Connections** (new). Inventory cards: provider icon, label, **reported identity** ("Connected as dana@acme.com"), what it can do in verbs ("send mail · cannot read"), granted vs used ("Foundry used 1 of 3 scopes you granted: [Narrow it]"), owner, expiry ("Google will ask you to sign in again by Nov 14"), used by flows (list), last checked, [Test], [Reconnect], [Disconnect]. Empty state = the ladder, not a catalogue of 1,000 logos (Nango skips the picker when the need is known; same here).
- **Models** (new). The BYOK chooser; per-key enable toggle; "Where requests go" line ("Directly to Anthropic from this machine"; contrast Raycast/Cursor which route via their servers); token caps; today's meter.
- **Import** (new, DESIGN §4.1 Imports row). "Look for existing setups?" per location with consent: Claude Code/Claude Desktop MCP configs, Cursor, VS Code, Codex, n8n exports. Result is a checklist with per-item *Reuse as is / Re-connect / Skip*; secrets never copied; "found in a repository: untrusted until you approve".
- **Approval card (existing).** Add a "Using:" line per binding: "Send as dana@acme.com via Gmail (send only)" and "Runs as: you" (paid: "Runs as: Finance service account, owner Dana").
- **Waiting for you (existing).** Gains `reconnect` and `grant more` card types.
- **Doctor (existing).** Adds a Connections section: keychain available (pinned store), loopback port free, proxy, clock, each binding's last preflight.

### 3.5 Flows

**Connect (L3).** Pre-screen (ours): purpose sentence, "You'll see {Vendor}'s own screen. It will say {verbs}. We ask for nothing else.", the redirect host if loopback, and "If a pop-up is blocked, [open it here]". Vendor screen. Callback received on 127.0.0.1 with `state`, PKCE, issuer check, `resource`; **granted scopes read from the token response** (granular consent, Google doc). Provider identity fetched. **Confirm card:** "Connected as X. Is this the account you meant? [Yes] [Use another]" (Zapier's cookie warning and Composio's identity warning, turned into a step). Test call. Store. Toast.

**Bind preflight (before the activation card).** For each binding run a read-only or provider-sandbox probe: identity, scope sufficiency (does the granted set cover the *practice-derived* set), reachability, rate-limit headroom, token lifetime, and for irreversible slots a dry capability if the provider has one. Failure shows the one thing to fix. This is the only new step between "practice passed" and "turn on" and exists to catch the practice-passes-live-fails class.

**Scope derivation.** Practice-run capability audit → operations used → scope map → minimal set. If the vendor's minimum ⊃ need, say so in the card ("Google offers send + compose; Foundry will only send to boss@x.com, enforced by Foundry") and enforce in the capability contract.

**Step-up.** Capability returns `needs_scope(+x)`; the run waits as `needs you: allow more`; one challenge containing all scopes the operation needs (2026-07-28 guidance); union with existing; limit retries; on denial the run stops *before* the effect with a plain sentence.

**Expiry and reconnect.** Preflight at T-minus (daily while a flow is scheduled): `expiring(≤7d)` → inbox card "Gmail needs you by Fri". A run that finds the credential bad → `needs you: reconnect`, effect not attempted, **resume at the failed step** after reconnect; engine's `uncertain` rules still apply to any effect that might have happened. Reconnect with same identity and scopes: no re-approval; different identity or wider scopes: new activation card. Weekly **connection fire drill** forces a refresh to catch Testing-mode 7-day tokens and revoked grants before the Monday run.

**Disconnect and revoke.** Revoke at the vendor where an API exists, delete handle, mark dependent flows `blocked: needs a connection`, never delete flows.

### 3.6 Copy that fits the "dumbest human" bar (draft; to be tested with people)

- Activation: "To send the weekly report I need a way to send email. Pick one: **Make a draft I'll send myself** (nothing to connect) · **Send from Gmail** (send only; I can't read your inbox) · **Send from any email account (SMTP)**."
- Pre-vendor: "Next, Google will ask: 'Foundry wants to send email on your behalf.' That is the only thing I'm asking for. Google may also say it hasn't verified this app. That is expected, because you made the connection yourself. [Show me the steps]"
- After: "Connected as **dana@acme.com** · can send · cannot read · Google will ask you to sign in again by **Nov 14**."
- Over-grant: "This key can also delete customers. The report only reads them. [Make a read-only key (opens Stripe with it filled in)]"
- Expiry: "Gmail needs you in 3 days. It takes 20 seconds. Your Friday report is waiting on this."
- Failure: "The 9:00 run paused before sending: Google says your sign-in expired. Nothing was sent. [Reconnect] and it carries on from the send step."
- Never: scope strings, "OAuth", "token", "401" as the only message. Code and details one click away (DESIGN U1).

### 3.7 MCP surface additions (agent side)

- `connections` (read) → slots, bindings, health in words. `connect` (ask) → returns `connection_needed` as a URL-mode elicitation to `http://127.0.0.1:<port>/connect?h=<handle>` (`handle` is a server-minted, single-use, short-lived value, not an `elicitationId`; see F11a) (dashboard-key gated, same-user check, **not pre-authenticated**, shows full URL and domain), fallback text link when the client lacks URL mode; completion by **retrying the original call** (the only mechanism in 2026-07-28; `notifications/elicitation/complete` and `elicitationId` exist only in 2025-11-25, see F11a); manual retry control kept. `bind` is **person-only** (like `approve`: `_meta["anthropic/requiresUserInteraction"]: true`). The model can ask for a connection, never create, widen or read one.
- `flow_status` gains `blockedOn: {slot, reason, next}`.
- Tool results and errors never contain URLs with secrets, tokens, or key material (canary test, §3.8).

### 3.8 Security rules (each should be an executable test)

1. **Canary:** plant a canary secret in the vault, run a build + practice + live run with a hostile model stub that echoes everything; assert the canary appears in no prompt, journal row, log, tool result, dashboard payload or error. Fails the build.
2. **Denylist:** importer and config expansion never place credential variables (`ANTHROPIC_*`, `OPENAI_*`, `INCEPTION_*`, `*TOKEN*`, `*SECRET*`, `*KEY*`) into a remote `url` or `headers`.
3. **Binding in the approval hash:** changing identity or scopes invalidates an approval (test per field).
4. **Same-user rule** for URL-mode connects: opener identity = initiator identity.
5. **Pinned keychain:** on a headless Linux with no Secret Service the store call throws, the doctor says so in plain words, nothing silently falls to memory or a plaintext file.
6. **State and PKCE and `iss`:** mismatch ⇒ refuse and do not display the provider's `error_description` (spec: on `iss` mismatch "MUST NOT act on or display error ...").
7. **No subscription credentials:** the product's own model calls use API keys only; the `claude-cli` provider stays a research-harness provider (policy file says it uses "the cloud session's own managed Claude Code login").
8. **No write to other apps' config without a diff and a yes** (`connect` prints only today; keep it, add `--write` behind a confirmation if ever needed).

### 3.9 Free and paid line applied to connections

Free (one authority): every rung L0-L4, L7; BYOK; SSO; you are connection owner, approver and developer. Paid (second authority): L5 managed broker (hosted), L6 delegated connections (service accounts, member requests, owner ≠ approver, run-as identity, connection-owner-left detection), shared-connection audit, evidence of which identity performed which effect. Precedents for the line: Stripe agent-tagged keys + reviewer approval, Activepieces custom OAuth apps paid, n8n per-user credentials Enterprise, Windmill approver permissions Enterprise [doc✓]. Never a wall during build; the card says "Connection owner: you" and shows what changes with a second owner.

### 3.10 Implementation notes for the local spike (Node >=24, ESM, `node:test`)

- Loopback receiver on `127.0.0.1` random port; PKCE S256; `state`; RFC 8707 `resource`; RFC 9207 `iss`; record issuer with the PKCE verifier per request; refresh via `offline_access`; token store keyed by issuer (2026-07-28: clients "MUST key persisted credentials by the issuer identifier" and re-register when the authorization server changes [raw✓ changelog, SEP-2352]).
- Registration order from the spec; DCR first (no publishing), CIMD only after an owner "publish" (D13), pre-registered ids for L4 results.
- Keychain adapter with three modes (`keyring` pinned, `file` after consent, `ephemeral`), mirroring Codex's names so users who know them are not surprised.
- Tests first: canary, denylist, binding hash, `iss`/`state` mismatch, expiry resume, practice→preflight mismatch (a stand-in that permits what the real scope forbids must be caught by preflight).
- Stand-ins for providers' consent and token endpoints for $0 tests (a local fake OAuth server), no real vendor traffic.
- (second pass) Client registration: DCR clients send `application_type: native`; persisted client credentials are keyed by issuer and re-registered if the issuer changes; `iss` is checked before code redemption (2026-07-28 changelog [raw✓]). Support both MCP revisions: 2025-11-25 clients may send form/URL elicitation, 2026-07-28 clients use `input_required` retries; the tool contract (`connection_needed` plus retry by `handle`) is the same for both.
- (second pass) Test double for the "On hold" behaviour: a fake provider that expires a token mid-run; assert the run waits, nothing is sent, the card names the slot, and after reconnect the run resumes at the failed step with all checks re-run.
- (second pass) Install-lines panel test: for each of Claude Code, Codex and Cursor, generate the command or link and assert it round-trips through that client's parser (`.mcp.json` shape, TOML shape, base64 config) without any secret in it.

---

### 3.11 Gap map against `app/` as of 2026-10-21 (read from `app/cli.mjs` and `app/core/capabilities.mjs`; nothing was run or changed)

| Exists in the spike | Net new for connections |
|---|---|
| `doctor`: Node 24, `node:sqlite`, writable workspace, sandbox (bwrap), "no model key needed", offline | doctor lines for: pinned keychain store reachable, loopback port free, system clock, per-binding last preflight |
| `connect` prints `claude mcp add --transport stdio foundry -- node cli.mjs mcp --dashboard ...`, `codex mcp add foundry -- ...` and a Cursor `mcpServers` JSON; writes no file | a dashboard install-lines panel with copy buttons, a Cursor install link (base64 of the same JSON), and a "verify the first tool call" check that passes only when a Foundry tool was really called and its output was used (F13, F17) |
| `--builder haiku` or `--builder mercury` with `--token-cap`; the stub builder calls no model | Models screen and BYOK chooser; keys are not stored by `app/` at all today (a grep for keychain, keyring, apiKey and credential in `app/` found only the importer and the CLI text, no vault) |
| live `outbox.send` is a local outbox file with a per-send approval; the capability header says real e-mail or chat "needs a connector the spike does not have" | slot and binding objects, the L0-L4 ladder per slot, bind preflight, binding hash inside the approval (C7), reconnect as a run state |
| `app/importers/n8n.mjs` | importers for Claude Code `.mcp.json`, Cursor, Codex TOML, VS Code `servers`, Zap JSON and Make blueprint reports (2.11); Node has no built-in TOML parser, so Codex import needs a pinned parser or a small reviewed one (AGENTS.md dependency rule) |

What can be built and tested at $0 right now, with no vendor traffic: the vault adapter in `ephemeral` and consented `file` modes, the canary-secret test, the install-lines generator with
round-trip tests, a fake OAuth provider (loopback receiver, PKCE, `state`, `iss`, mid-run expiry), the importer normalizers, and the "On hold" resume test. A real keychain needs the dependency
decision (C5); a real vendor connection needs the owner's decision on which accounts may be touched, and nothing here signs up for anything.

---

## 4. Measures (design-level; "capability number against a baseline" per AGENTS.md)

None of these has been measured. They are what I recommend instrumenting so the site can claim a number.

| Measure | Definition | Baseline from docs (my counting, [I]) | Target |
|---|---|---|---|
| Asks before first verified practice run | keys + accounts + permissions + forms | Zapier/n8n: connect needed to test; Metabase skips | 0 |
| Asks before first live effect | consent screens + pastes + approvals | Google Workspace MCP: 11 steps; Make Google: ~26 actions; Plaid guest: 7 screens; Notion MCP in Claude Code: add + `/mcp` login | ≤ 1 vendor screen or 1 paste, + 1 approval |
| Connection success rate within 5 min, by persona and rung | usability test, 5+ people each | none | ≥ 90% L0-L3 |
| Over-grant ratio | granted scopes / practice-used scopes | Stripe docs advise manual trim | ≤ 1.0 where vendor allows; shown where not |
| Practice-pass → live-fail for auth reasons | with vs without bind preflight | unknown | 0 in a seeded fault suite |
| Mean time to repair an expired connection | from warning to resumed run | Zapier: email + manual | < 60 s, run resumes at failed step |
| Secret exposure | canary appearances in any artefact | n/a | 0 |
| Wrong-account connects caught | seeded wrong-identity attempts | Zapier docs warn of cookie reuse | 100% caught at confirm card |
| Bindings verified by a real read probe whose output code checked (VS Code's three checks) | share of live bindings whose last preflight is a probe result, not a saved config | docs say a saved config is not proof | 100% before any activation card |

---

## 5. Anti-patterns found (with the evidence)

1. All permissions at install time; vague scopes; consent that takes "three seconds" [sec; research on Android permissions].
2. Making users create their own cloud project and OAuth client with 11-26 steps and no checker (Google Workspace MCP guide; Make) [doc✓].
3. Leaving a Google project in Testing: weekly reauthorization [doc✓].
4. Silent expiry: Zaps stop with no or late notice; reconnect rate-limit stampede (429) [sec].
5. Treating a callback's query parameters or an alias as proof of who connected [doc✓ Composio].
6. Letting the browser's logged-in cookie choose the account without confirmation [doc✓ Zapier].
7. Second Linked Account on relink because the origin id changed [doc✓ Merge].
8. BYOK that is gated or taxed: Raycast v2 Pro, Retool Enterprise, Cursor Teams $0.25/M, n8n self-hosted only, OpenRouter 5% [doc✓/search]; for Foundry D11 says free.
9. Plaintext key defaults without saying so (Codex `auth.json`) and silent in-memory fallback on Linux (keyring crate behaviour) [doc✓].
10. Asking for secrets in chat or form elicitation [spec✓; VS Code docs].
11. Project config that can name a server and expand your credentials into it [doc✓ Claude Code denylist exists because of this].
12. Routing a user's subscription login through your product [doc✓ Anthropic].
13. `--decrypted` style credential export and credential names that reveal customers [doc✓ n8n warns about names].
14. A pre-authenticated connect URL that anyone could open (phishing) [spec✓].
15. Forcing a catalogue picker when the need is known (Nango/Merge skip it) [doc✓].
16. A wizard that blocks value until every connection exists (Metabase's skip is the counter-example) [doc✓].
17. Unclear limits of BYOK: which features ignore your key, where requests go [doc✓ Cursor, Raycast].
18. Calling a connection "working" because its configuration was saved; VS Code's own guide says it is not proof [raw✓].
19. A connections list with no account identity and no health, where two rows can both read "Slack" [ui✓ Zapier docs screenshot, demo account].
20. A whole-account import that silently leaves every connection unbound; both Zapier and Make push the reconnect to a footnote after import [raw✓].
21. Permission growth that fails quietly: GitHub's own page says an app that is denied the new permissions "may not function as expected" [raw✓]; the step that needs the new scope should be named.
22. Leaving an unverified Google client in Testing, then blaming the user for the weekly sign-in (item 3), when "In production" removes it [raw✓ Make].
23. Writing a literal key into a shareable config file because the reference syntax was optional (Continue's docs show both forms) [raw✓].
24. Treating a completion notification as the only way to learn that a browser step finished; 2026-07-28 removed it [raw✓].

---

## 6. Decisions and questions for the owner (each reversible)

| # | Question | Recommendation | Blocked by |
|---|---|---|---|
| C1 | Ship the ladder L0-L4 + L7 in the free local product; L5/L6 only in the hosted paid plane | yes | — |
| C2 | CIMD needs a public HTTPS client metadata URL: that is publishing (D13). Use DCR + pre-registered localhost clients now | yes | owner says "publish" for CIMD, a broker, or any hosted callback |
| C3 | Google: do not promise zero-config Gmail. Default email slot to L0 draft or SMTP; Gmail as "advanced: your own Google client" wizard; hosted broker later | yes | Google verification (publishing) |
| C4 | Product model calls use API keys only; keep `claude-cli` as research-only; the "agent builds, Foundry checks" path is the no-key route inside Claude Code | yes; confirm with counsel that Foundry spawning a user's own local `claude -p` is out of scope for the product | owner / counsel |
| C5 | Dependency: a keychain library (candidate `@napi-rs/keyring` 2.1.2 MIT) acquired, pinned, SHA recorded, tested on headless Linux | yes, as a spike | acquisition outcome per AGENTS.md |
| C6 | Broker choice for the hosted plane (Composio, Nango [Elastic License], Pipedream Connect [future unclear], Arcade, Merge Agent Handler, Auth0 Token Vault, WorkOS Pipes): evaluate later on license, self-host, price, data path | defer | hosted decision (D10) |
| C7 | Add `bind` as a person-only MCP tool and put the binding hash in approvals | yes; it is an engine change in the same family as D15 (principal model) | 11-04 engine bump |
| C8 | Connect completion is retry-based: `connection_needed {slot, handle, url}`, agent retries the same call, binding found by server-minted `handle`; URL-mode elicitation is used only as a courtesy where the client has it | yes; works on both MCP revisions and on clients with no elicitation | none |
| C9 | Ship an install-lines panel in the local dashboard (Claude Code command first, then Codex command, then a Cursor install link), each with a copy button and a note of what it writes | yes; nothing is published | none |
| C10 | Importer = one parser per client + normalizer + round-trip tests; references imported, values never | yes | none |
| C11 | Google fallback wizard says "publish to In production and accept the unverified screen" and its checker reads the publishing status | yes for a person's own account; do not promise it for other people's accounts; re-check Google's policy before the site says it | Google policy, owner approval of the wording |

---

## 7. Limits of this sweep

No product was used; every behavioural claim is from documentation, search summaries, or the two sets of screenshots listed in §0. Review-site
complaints over-represent unhappy users. Step counts in §4 are my reading. The fetch tool summarises pages with a small model, so exact wording should be
re-read on the page before quoting outside this repository. Prices and plan gates move often. I did not research: Smithery's install CLI, the MCP registry's
publish flow, 1Password / Infisical / Doppler flows, Windows credential store behaviour in practice, passkey/WebAuthn approval (DESIGN §6.4), computer-use
credentials (CUA), or the Cline/Continue/LibreChat key screens. The node-capabilities workflow (#80) owns how nodes get MCP servers and skills; this note
only covers how a *person* connects and how a secret stays out of a model.


**Second-pass limits.** The raw checks confirm that the quoted sentences exist on the vendor's page on 2026-10-21; they do not confirm that the behaviour holds for every plan or
region, and vendor pages carry plan gates that change often (Zapier's pages list import/export on "Free, Professional, Team, Enterprise" while a 2024 community answer said the opposite).
The Cursor install-link parameter format is from a search summary and a forum report; the docs page I fetched shows the prompt but truncates the link. The Google
"In production, unverified" path is taken from Make's guide and Google's help page, not tried. Nothing in this file was tested with a person; every ask count and step count
remains a reading of documentation.

---

## 8. Sources (all read 2026-10-21)

**Connection brokers and Link flows.**
Nango: https://nango.dev/docs/guides/primitives/auth ; https://nango.dev/docs/implementation-guides/platform/auth/implement-api-auth ; https://github.com/NangoHQ/nango ; Connect UI GIF https://mintcdn.com/nango/AX1oSxxgTaIv9K8E/images/screenshots/connect-ui.gif ; refresh webhooks via search https://nango.dev/docs/guides/platform/common-issues
Composio: https://docs.composio.dev/docs/authenticating-users/manually-authenticating ; https://docs.composio.dev/docs/authenticating-users/in-chat-authentication
Pipedream: https://pipedream.com/docs/connect ; https://pipedream.com/docs/connect/managed-auth/quickstart ; https://pipedream.com/docs/workflows/building-workflows/build-with-ai ; Workday release https://newsroom.workday.com/2025-11-19-Workday-Signs-Definitive-Agreement-to-Acquire-Pipedream
Merge: https://docs.merge.dev/merge-unified/merge-link/overview.md ; https://docs.merge.dev/merge-unified/merge-link/relinking.md ; https://docs.merge.dev/merge-agent-handler/how-it-works (search)
Plaid: https://plaid.com/docs/link/ (screens https://plaid.com/assets/img/docs/link-tour/link-1-rm.png and siblings) ; https://plaid.com/docs/link/update-mode/ ; https://plaid.com/docs/link/best-practices/ ; https://plaid.com/docs/link/data-transparency-messaging-migration-guide/
Arcade: https://docs.arcade.dev/home/auth/auth-tool-calling ; Auth0 Token Vault https://auth0.com/ai/docs/intro/token-vault (search) ; WorkOS https://workos.com/blog/workos-pipes-where-your-users-tokens-actually-live (search) ; https://workos.com/blog/agent-credential-architectures
Zapier: https://help.zapier.com/hc/en-us/articles/8496258785421-Connect-your-app-accounts-to-Zapier ; https://help.zapier.com/hc/en-us/articles/8496290788109-Manage-your-app-connections ; https://help.zapier.com/hc/en-us/articles/8496326497037 ; https://help.zapier.com/hc/en-us/articles/14709128297613 ; community threads (sec) https://community.zapier.com/how-do-i-3/reconnect-an-expired-account-with-zapier-manager-24165 and others from the search
Make: https://help.make.com/connect-to-google-services-using-a-custom-oauth-client ; https://help.make.com/connect-an-application (search)
n8n: https://docs.n8n.io/credentials/add-edit-credentials/ ; https://docs.n8n.io/workflows/export-import/
Activepieces: https://www.activepieces.com/docs/admin-guide/guides/manage-oauth2
Power Platform: https://learn.microsoft.com/en-us/power-apps/maker/data-platform/create-connection-reference
Docker: https://docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit/
Metabase: https://www.metabase.com/docs/latest/configuring-metabase/setting-up-metabase

**Protocol and client docs.**
MCP authorization 2025-11-25 https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization ; 2026-07-28 https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization ; elicitation https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation ; EMA/CIMD/DCR commentary (sec, search) descope.com, workos.com/blog/mcp-2026-spec-agent-authentication, permit.io
Claude Code MCP https://code.claude.com/docs/en/mcp ; auth https://code.claude.com/docs/en/authentication ; legal https://code.claude.com/docs/en/legal-and-compliance
claude.ai connectors https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities
ChatGPT apps/plugins (search only; help pages 403) https://help.openai.com/en/articles/11509118-admin-controls-for-apps-in-chatgpt
Cursor https://cursor.com/docs/context/mcp ; https://cursor.com/docs/settings/api-keys
Codex https://learn.chatgpt.com/docs/auth (redirect from developers.openai.com/codex/auth) 
VS Code https://code.visualstudio.com/docs/copilot/reference/mcp-configuration ; https://code.visualstudio.com/docs/copilot/customization/mcp-servers
add-mcp https://github.com/neondatabase/add-mcp
Zed https://zed.dev/docs/ai/use-api-access ; Raycast https://manual.raycast.com/ai/bring-your-own-key.md ; OpenRouter https://openrouter.ai/docs/guides/overview/auth/byok and https://openrouter.ai/docs/guides/overview/auth/oauth

**Vendor OAuth, keys and scopes.**
Google: https://developers.google.com/identity/protocols/oauth2#expiration ; https://developers.google.com/identity/protocols/oauth2/native-app ; https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification ; https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance ; https://developers.google.com/workspace/guides/configure-mcp-servers
Notion https://developers.notion.com/docs/authorization ; https://developers.notion.com/guides/mcp/get-started-with-mcp
Slack https://docs.slack.dev/ai/mcp-server ; https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests ; https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks
GitHub https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens ; https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
Stripe https://docs.stripe.com/keys ; https://docs.stripe.com/keys/restricted-api-keys
Keychain: https://github.com/Brooooooklyn/keyring-node ; npm view @napi-rs/keyring (2.1.2, MIT, modified 2026-10-19), @zowe/secrets-for-zowe-sdk 8.39.1 (EPL-2.0) ; keytar archived https://github.com/zowe/zowe-cli/issues/1622 (search)
Credential-injection pattern (sec, vendor blogs): https://workos.com/blog/agent-credential-architectures ; https://varlock.dev/guides/sandboxing/ ; https://www.philschmid.de/managed-agents-credentials ; https://agentpatterns.ai/security/sandbox-credential-masking/
Permission research (summaries via search): Felt et al., SOUPS 2012, https://www2.eecs.berkeley.edu/Pubs/TechRpts/2012/EECS-2012-26.html ; Wijesekera et al., USENIX Security 2015, https://www.usenix.org/conference/usenixsecurity15/technical-sessions/presentation/wijesekera ; consent-fatigue commentary https://auth0.com/blog/the-art-of-user-consent-management-oauth/ (sec)
Anthropic subscription-OAuth enforcement coverage (sec): https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use

Local images (not committed): `/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/onboard/img/` (`nango_f01-f11.png`, `plaid_montage.png`).


**Second-pass sources (raw text fetched 2026-10-21 and grepped, unless marked).**
MCP 2026-07-28 changelog https://modelcontextprotocol.io/specification/2026-07-28/changelog ; authorization https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization ; elicitation (2025-11-25) https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation ; Enterprise-Managed Authorization https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization
Claude Code https://code.claude.com/docs/en/mcp ; https://code.claude.com/docs/en/legal-and-compliance
Codex https://developers.openai.com/codex/mcp ; Cursor https://cursor.com/docs/context/mcp ; https://cursor.com/docs/mcp/install-links ; https://cursor.com/docs/reference/deeplinks ; VS Code https://code.visualstudio.com/docs/copilot/customization/mcp-servers
Linear https://linear.app/docs/mcp ; Atlassian https://support.atlassian.com/atlassian-rovo-mcp-server/docs/authentication-and-authorization/ and https://support.atlassian.com/rovo/docs/getting-started-with-the-atlassian-remote-mcp-server/
Google https://developers.google.com/identity/protocols/oauth2 ; https://developers.google.com/identity/protocols/oauth2/native-app ; https://support.google.com/cloud/answer/7454865 ; Make https://help.make.com/connect-to-google-services-using-a-custom-oauth-client ; https://help.make.com/blueprints.md
Zapier https://help.zapier.com/hc/en-us/articles/8496308481933 (import/export) ; https://help.zapier.com/hc/en-us/articles/20505304170637 (run statuses) ; https://help.zapier.com/hc/en-us/articles/8496216132621 (Zap is not running) ; https://help.zapier.com/hc/en-us/articles/45697369623693 (Agents connection errors) ; connections screenshot https://cdn.zappy.app/4651b62a18b59c9a4f28b05843308554.png
n8n pin and mock data https://docs.n8n.io/build/work-with-data/pin-and-mock-data.md ; Metabase https://www.metabase.com/docs/latest/configuring-metabase/setting-up-metabase (screens `AddDatabaseInfo.png`, `WelcomeScreen.png`) ; Power Platform https://learn.microsoft.com/en-us/power-apps/maker/data-platform/create-connection-reference (`connection-reference-example.png`)
GitHub https://docs.github.com/en/apps/using-github-apps/approving-updated-permissions-for-a-github-app ; https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens ; Shopify https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes ; https://shopify.dev/changelog/configure-optional-scopes-for-shopify-apps ; Stripe https://docs.stripe.com/keys/restricted-api-keys ; Slack https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks ; OpenRouter https://openrouter.ai/docs/guides/overview/auth/oauth
Continue https://docs.continue.dev/customize/model-providers/overview and https://docs.continue.dev/reference ; Cline https://docs.cline.bot/provider-config/anthropic ; 1Password https://developer.1password.com/docs/cli/secret-references/ and https://developer.1password.com/docs/cli/secrets-environment-variables/ ; keyring package `npm view @napi-rs/keyring` (2.1.2, MIT, modified 2026-10-19; the GitHub README returned 403 this pass, so the first pass's README reading stands)
Raw pages and helper scripts (not committed): `scratchpad/onboard/raw2`, `raw3`, `raw4`, `scratchpad/tools/ft.py`, `grep.py`, `apply_pass2.py`; new screenshots in `scratchpad/onboard/img/` (`zapier_connect.png`, `metabase_adddb.png`, `metabase_welcome.png`, `ms_connref.png`).
