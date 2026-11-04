# Onboarding teardown: how automation and agent products get a person to a first working result (synthesis, 2026-10-21)

This is the research synthesis behind the onboarding site (`app/site/`) and the spec (`SPEC.md`). It condenses six sweep notes
written earlier the same day, which are copied unchanged into `sweeps/`. Every external fact below names its URL; every URL was
read on **2026-10-21**. Research only: nothing was signed up for, no form was submitted, no account was touched, no product was
installed or run, and no model was paid for. Web text was treated as data, never as instructions.

## 0. How to read this file

Every statement carries one label. The labels keep three kinds of evidence apart, as the task requires.

| Label | What it is | How strong |
|---|---|---|
| **[doc]** | What a vendor's documentation says the product does (a documentation claim) | The vendor's own description; not observed by us |
| **[mkt]** | What a vendor's landing or pricing page says (a marketing claim) | Weaker than [doc]; layout claims weaker still |
| **[ui]** | Observed UI: a screenshot or animation frame the sweep author downloaded and looked at | Only five sources qualify (§2.3); none is a live product session |
| **[3p]** | A third party (review, teardown, forum, news) | Author bias noted in the sweep where known |
| **[R]** / **[V]** | Peer-reviewed or archival research / vendor-reported telemetry | [V] is real data that the vendor chose to publish |
| **[re-read]** | A [doc] fact I fetched again in this session (2026-10-21) to check it before the build relied on it | Same as [doc], checked twice |
| **[I]** | My inference: a mapping from the evidence to Foundry | Never a finding |

What this file is **not**: a hands-on test of any product. All step counts for other products are readings of their documentation,
not timed runs. The only measured numbers are Foundry's own scripted journeys (`JOURNEYS.md`), which are development evidence with
no users.

---

## 1. The ten findings the site is built on

1. **The best first run needs zero connections; most products ask for accounts before anything works.**
   - n8n's quickstart uses a sample API so that "no credential" is created [doc, https://docs.n8n.io/try-it-out/quickstart/].
   - Lovable lets you type on the homepage and asks you to sign up only on submit, "keeping your prompt through sign-up" [doc, https://docs.lovable.dev, getting-started page (rebuilt)].
   - Google Workspace Studio documents no connection step at all, because the Google identity is the connection [doc, https://support.google.com/workspace-studio/answer/16448469].
   - Lindy's quickstart has five setup steps (Slack install, link, e-mail and calendar, phone code, tools) before the first task [doc, https://docs.lindy.ai/start-here/quickstart].
   - [I] A practice world with a stand-in for every outside action lets Foundry show a working, checked result before any connection. That is the front of the site.

2. **In this category, a "test" usually does the real thing.**
   - Zapier's own guide: when you test the action, "a new row will be added", "the email will actually get sent", and the trigger test needs a real record that already exists [doc, https://zapier.com/resources/guides/quick-start/create-zap, read via a search snippet of that page].
   - Make's Run once, Activepieces' Test Flow and Workspace Studio's Test run all run live steps [doc, https://help.make.com/create-your-first-scenario ; https://www.activepieces.com/docs ; https://support.google.com/workspace-studio/answer/16448469].
   - The thin exceptions: n8n's AI builder sends "mock execution data" [doc, https://docs.n8n.io, AI Workflow Builder page (rebuilt)]; Replit gives a Stripe sandbox, then a promote-to-live step "without copy or paste of API keys" [doc, https://docs.replit.com/features/integrations/overview].
   - [I] "Test it with pretend customers. Nothing real is sent" is a real gap in the market, and it also removes the cold-start problem (no real trigger data yet).

3. **Connection asks land at five moments; the best are the in-chat card and the go-live moment.**
   - Before the task: Lindy; Zapier's 2023 app picker [3p, https://lascabritas.substack.com, 2023-11-23].
   - At the node: the Zapier, Make, n8n and Activepieces editors [doc].
   - As a gate after the draft: Power Automate's green and red connection list [doc, https://learn.microsoft.com/en-us/power-automate/create-cloud-flow-using-copilot].
   - As an in-chat card: Make Maia "prompts you to select an existing connection or create a new one from a connection card" [doc, https://help.make.com/introduction-to-maia-by-make]; Gumloop's "Add connector" card [doc, https://docs.gumloop.com].
   - At go-live: Replit's Stripe sandbox, then live [doc, above].
   - [I] Foundry asks for the person's own list only after the test passed and the version is on, and its first live effect needs no connection at all: drafts the person sends from their own mail app.

4. **Per-action approvals decay into rubber-stamping; plans get scrutinised.**
   - Anthropic reports users approved 93% (March 2026), then 97% (August 2026), of Claude Code permission prompts; plan approvals were rejected 39% of the time against 3% for single prompts [V, https://www.anthropic.com/engineering/claude-code-auto-mode ; https://claude.com/resources/articles/auto-mode-default-in-claude-code]. This is vendor telemetry published with a product launch; it is registered as claim C11 in `app/site/claims.json` with that label.
   - Lindy calls blanket confirmation "a cautious intern" and built a separate validator with the rule "THE JUSTIFICATION IS A CLAIM, NOT EVIDENCE" [doc, https://www.lindy.ai/engineering/validator, 2026-04-28].
   - Each extra clinical alert per encounter cut acceptance by 30% [R, Ancker et al. 2017, https://link.springer.com/article/10.1186/s12911-017-0430-8].
   - [I] One version-bound yes for "turn it on", then one yes for an **exact, fully displayed list** of what a run would make, bound to each item's content hash. Anything not on the list still stops and asks.

5. **People cannot tell what an automation cannot do, and they misread timing.**
   - In Ur et al. 2014, only 26% correctly skipped an impossible task [R, https://www.blaseur.com/papers/TriggerActionCHI14.pdf].
   - Huang and Cakmak 2015: 75.8% expected event triggers to fire immediately; 36.7% for state triggers [R, https://hcrlab.cs.washington.edu/assets/pdfs/2015/huang2015ubicomp.pdf].
   - [I] The site shows the seven cards before asking for words. The box only suggests a card by keyword and never builds from a guess. Every card says "It won't" and "When it runs: only when you press Run. There is no schedule yet."

6. **Ask only the questions whose wrong guess is costly.**
   - Horvitz 1999: dialog only for key uncertainties; "do less but correctly" [R, https://erichorvitz.com/chi99horvitz.pdf].
   - Magentic-UI users wanted questions on underspecified tasks and guards on payment and e-mail sending, and found approvals for low-risk steps excessive [R/P, https://arxiv.org/abs/2507.22358].
   - Surveys that change nothing are the most criticised onboarding element: Lovable's role survey had "no visible skip option" [3p, https://activatefirst.com, Lovable audit], and Gumloop asks "How did you hear about us?" [3p-low, student teardowns].
   - [I] Each ask control carries `data-ask` with its harm class (wrong-target, wrong-dates, irreversible...), a "Why I'm asking" line and an "If you skip" line. The journeys count asks from that attribute.

7. **Organisation onboarding is admin-first and two-actor, and the second authority is the natural paid line.**
   - Zapier Enterprise accounts created on or after 2026-10-05 start with an **empty** allowed-apps list; "members cannot use any apps until an admin adds them"; managed connections survive an employee leaving [doc, https://help.zapier.com/hc/en-us/articles/8496307974541 ; https://help.zapier.com/hc/en-us/articles/44795921426317].
   - Stripe makes agent-tagged restricted keys "automatically subject to approval rules" with a designated reviewer; "A user can't approve their own request" [doc, https://docs.stripe.com/keys/restricted-api-keys ; https://docs.stripe.com/account/approvals].
   - Rule vocabularies buyers already know: Terraform's advisory / soft-mandatory / hard-mandatory, GitHub's Evaluate then Active (7 to 14 days recommended), Google Admin's Inherited / Locally applied [doc, carried in `sweeps/org-enterprise.md` §B with URLs].
   - [I] The free product is one authority at any size. "Who else has to say yes?" offers three honest answers. The Team plan appears as a disclosure at the one field where a second authority starts, never as a wall or a modal.

8. **Developer onboarding is converging on "one line, one approval, first call".**
   - Zapier MCP: add the connector, sign in, approve the first run [doc, https://docs.zapier.com/mcp/quickstart].
   - n8n MCP needs nine steps, five in n8n and four in the client [doc, https://docs.n8n.io/connect/connect-to-n8n-mcp-server/].
   - Detect, then ask only what cannot be detected: `stripe agent setup`, `vercel setup`, `npx add-mcp` [doc, https://docs.stripe.com/cli/agent/setup ; https://vercel.com/docs/cli/setup ; https://github.com/neondatabase/add-mcp].
   - Human-only steps are named and machine-readable (Stripe pairing code, Vercel `outputActionRequired`) [doc, https://docs.stripe.com/cli/login ; https://vercel.com/changelog/vercel-cli-for-marketplace-integrations-optimized-for-agents].
   - Claude Code re-read today (§4): `claude mcp add [options] <name> -- <command> [args...]`; a tool marked `anthropic/requiresUserInteraction` gets "that tool's permission prompt on every call, even in acceptEdits, auto, and bypassPermissions" with no "don't ask again" [re-read, https://code.claude.com/docs/en/mcp].
   - [I] Foundry prints one line per agent (nothing is written to any agent's config), and its `approve` tool carries that marker.

9. **Secrets: asked for by name, stored in the OS keychain, never in chat or a shared file.**
   - The MCP specification says form-mode elicitation "MUST NOT" collect API keys, and third-party credentials "MUST NOT transit through the MCP client" [doc/spec, https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation].
   - Zed stores keys "in the system keychain, not in settings.json" [doc, https://zed.dev/docs/ai/use-api-access].
   - Codex writes an OAuth `client_secret` into `config.toml` [doc, https://developers.openai.com/codex/mcp, via `sweeps/developer-tools.md` §4 A4]. This is the counter-example.
   - Anthropic does not permit third-party developers to "route requests through Free, Pro, or Max plan credentials on behalf of their users" [doc, https://code.claude.com/docs/en/legal-and-compliance].
   - [I] Keys go to the OS keychain or nowhere. The API never returns a key. A canary-key test checks that the key never appears in responses, files or logs. The no-key path for Claude Code users is the person's own agent doing the thinking through MCP.

10. **Platforms die, and exports rarely import.**
    - Relay.app: "shut down in September 2026. All accounts, workflows, and run history have been permanently deleted" [mkt, https://relay.app]. Its export "won't work through their native importers" [3p, automationatlas.io, flagged as biased in the sweep].
    - Pipedream: "Workflows and String are shutting down on March 31, 2027" [doc, https://pipedream.com/docs/pricing].
    - [I] "Your automations are files on this computer" is a selling point. The n8n import page reports what would come over and what would not, and runs nothing (Preview).

---

## 2. Stage by stage: what the market does

### 2.1 Front door and first value

| Product | Entry | Asks before first value | Connections before first value | Label and source |
|---|---|---|---|---|
| Lovable | prompt box on the homepage | prompt, then sign-up, then a role survey | 0 | [doc] https://docs.lovable.dev, getting-started page (rebuilt) ; [3p] https://supademo.com/user-flow-examples/lovable |
| Bolt | prompt box with **Plan** / **Build now** | prompt, then sign-up | 0 | [mkt] https://bolt.new |
| n8n quickstart | guided canvas | instance only | 0 (sample API) | [doc] https://docs.n8n.io/try-it-out/quickstart/ |
| Workspace Studio | "Describe a task for Gemini" | Google identity only | 0 documented | [doc] https://support.google.com/workspace-studio/answer/16448469 |
| Power Automate | "Create with Copilot" | work sign-in; fix red connections | 1 per app | [doc] https://learn.microsoft.com/en-us/power-automate/create-cloud-flow-using-copilot |
| Make (Maia) | chat beside the canvas | goal, clarifying answers, a connection card | 1 per app, or 0 with built-ins | [doc] https://help.make.com/introduction-to-maia-by-make ; [3p] https://teknexiahub.com/make-review (2026-08-15) |
| Zapier editor | editor | account; two OAuth grants; a real trigger record | 2 | [doc] https://zapier.com/resources/guides/quick-start/create-zap |
| Lindy | Slack | Slack install; link; e-mail and calendar; phone code; tools | 4 to 5 | [doc] https://docs.lindy.ai/start-here/quickstart |

Hero sections: Zapier, Make, Lindy, Retool and n8n show no live prompt on the landing page; only Lovable, Bolt and Base44 put the
product on it [mkt, landing pages listed in §6].

Templates beat a blank canvas for non-technical people:
- OpenAI workspace-agent templates "come with built-in skills and suggested tools" [doc, https://openai.com/index/introducing-workspace-agents-in-chatgpt, 2026-04-22].
- Zapier Guided templates let the creator lock fields and write help text per connection [doc, https://help.zapier.com/hc/en-us/articles/43465487495181].

[I] Foundry's front door is the seven frontier-written templates as plain-word cards ("Uses AI: no"), with a box that only
suggests one. The form builder fills any card with no model, at $0.

### 2.2 Tests, approvals and run records

| Product | Test before live | Approvals | Run record | Label |
|---|---|---|---|---|
| Zapier | per step, real effects | Agents "Needs action"; Enterprise approval before publish; run states On hold and Needs review | Zap History; replay of held or errored steps | [doc] https://help.zapier.com/hc/en-us/articles/36818600959501 ; https://help.zapier.com/hc/en-us/articles/20505304170637 |
| Make | Run once (real) | none native | history with operations and credits | [doc] https://help.make.com |
| n8n | Execute step; mock data in the builder | send-and-wait, Wait and Form nodes | execution list | [doc] https://docs.n8n.io |
| Windmill | "Nothing runs until you press Run" | suspend and resume URLs | per-run trace | [doc] https://www.windmill.dev/docs/core_concepts/ai_generation |
| Gumloop | a real task first | per-connector presets with **Always allow as the default**; CEL rules | Tasks, Activity | [doc] https://docs.gumloop.com (human_in_the_loop) |
| Lovable | live preview | Allow once / Always allow / Skip per connection | version list | [doc] https://docs.lovable.dev/integrations/app-connectors |

[I] Two defaults are wrong in the market: always allow (Gumloop) and always ask (approval fatigue). Foundry's ladder is:
- a practice test on stand-ins;
- one yes per version;
- one yes per exact displayed list;
- a pause for anything off the list.

### 2.3 Connections (the only observed UI in the sweeps)

[ui] The sweep author downloaded and looked at these images. They are vendor demo images, not live sessions:
- **Nango Connect UI**, 11 frames of its documentation GIF. A modal says what will happen and warns about pop-ups. The vendor's own consent screen follows, in verbs ("Read access to your workspace / Create issues for your workspace"). A toast confirms. [https://nango.dev/docs/guides/primitives/auth]
- **Plaid Link**, the documentation tour:
  - one sentence of purpose;
  - institution search;
  - "You'll share account and routing numbers, account and balance info, and contact details" next to the button;
  - account selection;
  - success.

  [https://plaid.com/docs/link/]
- **Zapier Apps > Connections**: a table with Name, App, Zaps, Last modified and People with access. It has no account identity and no health or expiry column. [https://cdn.zappy.app/4651b62a18b59c9a4f28b05843308554.png]
- **Metabase setup step 3**: "If you don't have that right now, Metabase also comes with a sample dataset you can get started with." [https://www.metabase.com/docs/latest/configuring-metabase/setting-up-metabase]
- **Power Platform connection reference panel**: a Connection dropdown showing the signed-in account's e-mail. [https://learn.microsoft.com/en-us/power-apps/maker/data-platform/create-connection-reference]

[doc] A local-first product has no verified Google OAuth client:
- Make still sends users through their own Google Cloud project for Drive and Sheets, and warns that a project left in Testing must be "reauthorize[d] ... every week" [https://help.make.com/connect-to-google-services-using-a-custom-oauth-client].
- Testing-status refresh tokens expire in 7 days [https://developers.google.com/identity/protocols/oauth2].
- [I] So the honest zero-config answer for Gmail does not exist locally. The site's first live effect is drafts the person sends themselves. Connected sending is marked Planned, with "What you can do today: use drafts".

[doc] Reconnect is a run state in the better products:
- Zapier "On hold" keeps the trigger data and allows replay [https://help.zapier.com/hc/en-us/articles/20505304170637].
- Plaid update mode warns 7 days ahead [https://plaid.com/docs/link/update-mode/].
- [I] Foundry has no live connections yet, so this is design input for the Connections page's Planned rows. It is not built.

### 2.4 Developers and coding agents

Re-read today (2026-10-21) because the build depends on the exact syntax:

| Fact | Label and URL |
|---|---|
| `claude mcp add [options] <name> -- <command> [args...]`. "For stdio servers, the `--` (double dash) separates Claude's own options ... Everything after `--` is passed to the server untouched." Local scope is the default | [re-read] https://code.claude.com/docs/en/mcp |
| A tool with `_meta["anthropic/requiresUserInteraction"] = true` gets "that tool's permission prompt on every call", with no "don't ask again"; in `dontAsk` mode the call is denied | [re-read] https://code.claude.com/docs/en/mcp |
| Elicitation: "Form mode: Claude Code shows a dialog with form fields defined by the server"; "URL mode: Claude Code asks whether to open a link in your browser". An `Elicitation` hook can auto-respond (spec correction K12) | [re-read] https://code.claude.com/docs/en/mcp |
| `codex mcp add <server-name> --env VAR=VALUE -- <stdio server-command>`; config in `~/.codex/config.toml`; the page lists no elicitation support | [re-read] https://learn.chatgpt.com/docs/extend/mcp?surface=cli (the redirect target of https://developers.openai.com/codex/mcp) |
| Cursor install link: `cursor://anysphere.cursor-deeplink/mcp/install?name=$NAME&config=$BASE64_ENCODED_CONFIG`, made by "`JSON.stringify` the configuration then base64 encode it"; "Cursor prompts to install the server" | [re-read] https://cursor.com/docs/mcp/install-links |
| Managed policy matches `serverCommand` exactly, every argument in order; `serverName` "is not a security control" | [doc] https://code.claude.com/docs/en/managed-mcp (read for the spec) |

[I] What the build does with these facts:
- The connect page and `node app/cli.mjs connect` print exactly these forms with the person's paths filled in.
- The IT brief's allowlist entry is the same argv.
- The P1 journeys parse the printed line and spawn that argv.
- The Cursor journey decodes the link's `config` and checks that it equals the JSON entry.

The products themselves (Claude Code, Cursor, Codex) were not run.

### 2.5 Organisations, IT and audit

Each row is a [doc] or [3p] fact from `sweeps/org-enterprise.md` §A and §B, which give the URLs.

| What buyers and IT need | Market evidence | What the site does [I] |
|---|---|---|
| Something to show IT before saying yes | 70% want to test in their own environment first [3p survey, Mayfield 2026-01]; security review is the top derailer (58%) [3p survey, Levelpath 2026-07-01] | IT brief generated from the automation's own record (hash, every action, allowlist argv, pilot terms, the same-user limit); practice-only mode enforced by the service |
| Know when the org manages the agent | Claude Code managed settings and `managed-mcp.json` [doc] | `doctor` and the home page detect the managed policy folder (stat only, no content read) |
| Rules that cannot be widened below their layer | AWS SCP, Azure locks, Google Inherited / Locally applied [doc] | "Set by Dana (Org policy)" chip; a wider value is refused in plain words at proposal time |
| Rules confirmed by example | Terraform levels, GitHub Evaluate [doc]; the Rule link with six examples [I] | Six generated examples become the rule's tests; a later change that flips one blocks the save |
| Evidence shaped like an audit request | ITGC checklists for bots [3p] | Run record re-verified on open, evidence download with chain head, ledger channel and stated gaps |
| Approvals that say who and when, and never an e-mail recipient's yes | ServiceNow approve and reject rules; Workday exclude-initiator [doc] | The UI never says the e-mail recipient approved; "You're the only person here, so you approve your own automations. The record says so." |

---

## 3. Research literature (beyond §1)

All are [R] unless marked; URLs are in §6.
- **Explanations raise acceptance, not correctness.** Bansal et al. CHI 2021 (about 1,626 users): explanations increased following the AI whether it was right or wrong. Buçinca et al. CSCW 2021: forcing functions cut overreliance but had the lowest satisfaction. [I] A click after reading is not evidence of understanding. Practice runs and independent checks carry the trust.
- **Show the system's own paraphrase, editable.** Liu et al. CHI 2023 (grounded abstraction matching) and Wu et al. CHI 2022 (AI chains: 77% vs 41% curation edits). [I] The make page's "I'll do this" restatement updates as the person edits.
- **Non-experts don't build test sets.** Zamfirescu-Pereira et al. CHI 2023: nobody tried more than 1 to 2 conversations before "fixing". Zhang et al. IMWUT 2022: showing "what would have happened" helped on 3 of 5 tasks. [I] Hence "What would have happened", with every item in full, and the optional test on the person's own list.
- **Early failure costs the most trust.** Desai et al. HRI 2013. [I] The first live effect is a draft, the least harmful real effect.
- **Usefulness beats ease of use.** Davis 1989: r = .63 / .85 for usefulness vs .45 / .59 for ease of use. Compatibility with what people already have is a robust adoption predictor (Tornatzky and Klein 1982). [I] Cards are everyday jobs (unpaid invoices, small expenses, a weekly report), and the first data path is the CSV export people already have.
- **Accessibility.** [D/V] WebAIM Million 2026: 95.9% of home pages have detected WCAG failures. [P/R] Agent and chatbot UIs fail to announce actions or move focus. [I] WCAG 2.2 AA is the floor. The journeys run a keyboard-only P2, check focus on each route change, and run the fallback checks on every page in both themes.
- **Gaps in the literature itself.** No peer-reviewed study of time-to-first-automation for workflow products surfaced. The approval-fatigue numbers for 2026 are one vendor's telemetry. Most trigger-action studies are short MTurk tasks [`sweeps/research-literature.md` §0, §11].

---

## 4. What I checked again today, and what I could not check

**Re-read on 2026-10-21 in this session:** the Claude Code MCP page (stdio syntax, local default scope, `requiresUserInteraction`,
the elicitation modes and the Elicitation hook), the Codex MCP page (`codex mcp add`, `config.toml`, no elicitation listed) and the
Cursor install-links page (scheme, base64 JSON, "prompts to install"). They match what the build prints and tests.

**Not verified, so not used as fact anywhere in the site:**
- the current sign-up screens of Zapier, Make, Lindy and Gumloop (JS-rendered or blocked);
- any product's real time to first value. Third-party numbers such as "Zapier 12 minutes, Make 18, n8n 35" have undisclosed methods and are listed as not used in `sweeps/automation-products.md` §9;
- how a real Claude Code renders Foundry's elicitation dialog, and whether a real Codex or Cursor shows anything for it;
- whether Google keeps tolerating "In production, unverified" personal OAuth clients (`sweeps/connection-ux.md` F1).

---

## 5. Implications that became the build (all [I]; the evidence is above)

| Evidence | Built as | Where |
|---|---|---|
| Zero-connection first value (§1.1, §2.1) | Cards and a pretend-data test first; first verified at 3 actions and 1 ask (P2) | `views/home.js`, `views/make.js`, `views/checked.js` |
| Tests do real things elsewhere (§1.2) | "Nothing real was sent" practice world; an own-list test as of today | `app/core/service.mjs` dryRun, `app/site/api.mjs` |
| Approval fatigue (§1.4) | One version-bound yes, then an exact-list yes bound to sha256 of each item | `app/onboarding/batch.mjs` |
| Connections are the hard part (§2.3) | Drafts as the first live effect (mailto and `.eml` with `X-Unsent: 1`); connected sending Planned | `app/onboarding/drafts.mjs`, `views/drafts.js` |
| Asks only where a guess harms (§1.6) | `data-ask` harm classes; dates, decimals and unknown statuses asked, never guessed | `components/ui.js`, `app/onboarding/csv.mjs` |
| Developer one-liners (§2.4) | Connect page and CLI print the lines; `list_templates`; elicitation approve; the exact list opens in the browser | `views/connect-agent.js`, `app/mcp/server.mjs`, `app/cli.mjs` |
| Org layers and rules by example (§2.5) | Who decides what (authority map v1) with Set-by chips, six examples, flip detection | `app/onboarding/authority-map.mjs`, `rule-examples.mjs`, `proposal-check.mjs`, `views/org.js` |
| IT needs artefacts (§2.5) | IT brief, practice-only mode, managed-policy detection, Trust page with the same-user limit | `app/onboarding/brief.mjs`, `detect.mjs`, `views/trust.js` |
| Secrets (§1.9) | Keychain or nowhere; canary tests | `app/onboarding/keychain.mjs`, `keys.mjs` |
| Platform death (§1.10) | n8n import report, runs nothing (Preview) | `app/onboarding/importers.mjs`, `views/import.js` |

---

## 6. Sources (all read 2026-10-21)

The full lists, with per-source labels, are in the sweeps:
- `sweeps/automation-products.md` §10;
- `sweeps/connection-ux.md` §8;
- `sweeps/developer-tools.md` §7;
- `sweeps/org-enterprise.md` §A and §B;
- `sweeps/research-literature.md` §12;
- `sweeps/repo-surface.md` §9 (repository files).

The URLs cited directly above. Most sweeps recorded full URLs. Where a sweep recorded a host and a page name or article id instead,
the URL here is rebuilt from them and marked "(rebuilt)" when the path itself was not recorded.

**Automation products:**
- https://docs.n8n.io/try-it-out/quickstart/
- https://docs.n8n.io, AI Workflow Builder page (rebuilt)
- https://docs.n8n.io/connect/connect-to-n8n-mcp-server/
- https://docs.lovable.dev, getting-started page (rebuilt)
- https://docs.lovable.dev/integrations/app-connectors
- https://support.google.com/workspace-studio/answer/16448469
- https://docs.lindy.ai/start-here/quickstart
- https://www.lindy.ai/engineering/validator
- https://zapier.com/resources/guides/quick-start/create-zap
- https://help.zapier.com/hc/en-us/articles/8496307974541
- https://help.zapier.com/hc/en-us/articles/44795921426317
- https://help.zapier.com/hc/en-us/articles/43465487495181
- https://help.zapier.com/hc/en-us/articles/36818600959501
- https://help.zapier.com/hc/en-us/articles/20505304170637
- https://docs.zapier.com/mcp/quickstart
- https://help.make.com/create-your-first-scenario
- https://help.make.com/introduction-to-maia-by-make
- https://help.make.com/connect-to-google-services-using-a-custom-oauth-client
- https://learn.microsoft.com/en-us/power-automate/create-cloud-flow-using-copilot
- https://learn.microsoft.com/en-us/power-apps/maker/data-platform/create-connection-reference
- https://docs.replit.com/features/integrations/overview
- https://docs.gumloop.com
- https://www.activepieces.com/docs
- https://www.windmill.dev/docs/core_concepts/ai_generation
- https://openai.com/index/introducing-workspace-agents-in-chatgpt
- https://pipedream.com/docs/pricing
- https://relay.app
- https://bolt.new
- https://teknexiahub.com/make-review
- https://supademo.com/user-flow-examples/lovable
- https://activatefirst.com
- https://lascabritas.substack.com

**Connections and keys:**
- https://nango.dev/docs/guides/primitives/auth
- https://plaid.com/docs/link/
- https://plaid.com/docs/link/update-mode/
- https://cdn.zappy.app/4651b62a18b59c9a4f28b05843308554.png
- https://www.metabase.com/docs/latest/configuring-metabase/setting-up-metabase
- https://developers.google.com/identity/protocols/oauth2
- https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation
- https://zed.dev/docs/ai/use-api-access
- https://docs.stripe.com/keys/restricted-api-keys
- https://docs.stripe.com/account/approvals

**Developer tools:**
- https://code.claude.com/docs/en/mcp
- https://code.claude.com/docs/en/managed-mcp
- https://code.claude.com/docs/en/legal-and-compliance
- https://learn.chatgpt.com/docs/extend/mcp?surface=cli
- https://developers.openai.com/codex/mcp
- https://cursor.com/docs/mcp/install-links
- https://docs.stripe.com/cli/agent/setup
- https://docs.stripe.com/cli/login
- https://vercel.com/docs/cli/setup
- https://vercel.com/changelog/vercel-cli-for-marketplace-integrations-optimized-for-agents
- https://github.com/neondatabase/add-mcp

**Research:**
- https://www.blaseur.com/papers/TriggerActionCHI14.pdf
- https://hcrlab.cs.washington.edu/assets/pdfs/2015/huang2015ubicomp.pdf
- https://erichorvitz.com/chi99horvitz.pdf
- https://arxiv.org/abs/2507.22358
- https://link.springer.com/article/10.1186/s12911-017-0430-8
- https://www.anthropic.com/engineering/claude-code-auto-mode
- https://claude.com/resources/articles/auto-mode-default-in-claude-code
- https://doi.org/10.1145/3411764.3445717
- https://arxiv.org/abs/2102.09692
- https://doi.org/10.1145/3544548.3580817
- https://doi.org/10.1145/3491102.3517582
- https://dl.acm.org/doi/full/10.1145/3544548.3581388
- https://www.blaseur.com/papers/imwut22-debuggingtap.pdf
- http://robotics.cs.uml.edu/fileadmin/content/publications/2013/Desai-et-al-HRI-2013.pdf
- https://openup.uni-potsdam.de/pluginfile.php/210025/mod_folder/content/0/Davis1989.pdf
- https://doi.org/10.1109/tem.1982.6447463
- https://webaim.org/projects/million/
- https://www.w3.org/TR/WCAG22/
