<!--
Provenance: this is the build spec handed to the site-build step of the onboarding workflow on 2026-10-21, copied as received
(only the workflow harness's own one-line wrapper note was dropped). It synthesised three onboarding concepts and five persona
judgments; those two source texts were not handed to the build step, so CONCEPTS.md and JUDGMENTS.md are not in this folder.
Where the build departed from this spec, research/onboarding-20261021/DESIGN.md §9 says what changed and why.
-->

# Workflow Foundry onboarding: final design and site build spec (2026-10-21)

This is the synthesis of three onboarding concepts and five persona judgments. It specifies a site that is built and run locally only (D13), in `app/site/` and `app/onboarding/`, on top of the existing `FoundryApp`.

Everything here is design and development evidence. No user has seen any of it.

**Evidence tags**
- [repo]: code or a measurement at HEAD `594cc34`.
- [ran]: I ran it today.
- [docs]: vendor documentation read today (2026-10-21).
- [sweep]: the onboarding sweep notes. Their own tags carry over.
- [judge]: one of the five persona judgments.
- [inf]: my inference.

I signed up for nothing, submitted no form, published nothing, and changed no repo file. Probe scripts live only in the scratchpad.

**Verified today**
- `node --test --test-concurrency=1 app/test/*.test.mjs` passes 34/34 [ran].
- `app/dashboard/browser-check.mjs` is **broken**. Line 13 calls `app.propose(...)` without `await`, but `propose` is async. So `p.proposalId` is undefined and `dryRun` throws `TypeError: Provided value cannot be bound to SQLite parameter 1` [ran].
- Playwright 1.63.0 drives `/opt/pw-browsers/chromium` (141.0.7390.37) here, and `locator.ariaSnapshot()` is available [ran].
- **Live library sends pause one at a time.** In a probe, an `invoice-chase` run with 3 reminders and 1 summary paused 4 times, each with 1 pending approval (scratchpad `probe/batch.mjs`) [ran]. So batch approval cannot simply list "all pending". See §7.5.
- All proposed colour tokens pass contrast. Text and status colours are at least 4.5:1 and strong lines at least 3:1 on every surface, in both themes (scratchpad `probe/contrast.mjs`) [ran].
- Claude Code managed MCP docs [docs, https://code.claude.com/docs/en/managed-mcp, read 2026-10-21]:
  - `serverCommand` "Commands match exactly. Every argument, in order."
  - "A `serverName` entry, in either list, is not a security control."
  - `managed-mcp.json` lives at `/Library/Application Support/ClaudeCode/`, `/etc/claude-code/` and `C:\Program Files\ClaudeCode\`.
- Claude Code hooks docs [docs, https://code.claude.com/docs/en/hooks, read 2026-10-21, first 100k characters only]:
  - `Elicitation` and `ElicitationResult` hooks exist.
  - Their decision control sets "`action` (accept/decline/cancel), `content` (form field values)".
  - So a local hook can shape the person's answer to Foundry's dialog.

**Harness note (relayed as a finding, not acted on).** The harness flagged the concept texts and the judgments as containing "settings-json" instruction-shaped text. I read them all. The matches are design discussion of `.mcp.json`, `managed-settings.json`, `managed-mcp.json` and allowlist snippets. None is a directive aimed at an agent. I treated all of it as data.

---

## 1. The decision on one page

**Spine: describe and practise (concept 2).** It is the only concept with a measured path (DESIGN §8.3: 3 person actions). It ranked first or tied first with the solo developer, the non-technical owner, the buyer and the UX critic. It has five parts:
- one front door;
- at most three questions, each tagged with the harm a wrong guess would cause;
- a mandatory test on pretend data;
- a "What I checked" page with a "what a test can't prove" box;
- one version-bound yes, and a default first live effect that needs no connection: a draft the person sends themselves.

**Fixes the judges made non-negotiable, all built in this spec:**

1. **The front door shows what Foundry can make before it asks for words.**
   - Problem: a free-text box over-promises. In Ur 2014, 26% of people correctly skipped an impossible task [sweep research-literature §2.1].
   - Fix: the home page leads with the 7 frontier-written templates as plain-word cards, with the box beside them.
   - Without an AI key, the box only *suggests* a matching card by keyword, at $0 and locally. It never builds from a guess.
   - A new **template form builder** fills any of the 7 templates from a form, with no model. That makes all 7 real at $0; today only 1 is real through the stub.
2. **The person's own data, not only template data.** A CSV drop with plain-word column mapping writes the JSON rows the stand-ins already read. Ambiguous values (date order, decimal comma, which statuses mean "still open") are asked, never guessed.
3. **No approval fatigue on batches.** The first live run makes drafts, and the person approves the **exact list** in one card (§7.5). Every item is bound to its full content. Anything not on the list still stops and asks.
4. **Approvals without a browser for developers.**
   - `approve` in the terminal now covers paused actions too.
   - The MCP server gains `list_templates`, and `propose_flow` gains `template` and `settings`, so the developer's own agent fills the template. Foundry still checks that every address came from the person's words.
   - An MCP dialog for actions and batches comes in wave 2.
5. **Honest about scheduling.** There is no scheduler. The yes card says so. An optional calendar reminder (`.ics`) says plainly that it is a reminder, not automation.
6. **The second-authority question has an honest free middle answer.** "Who else has to say yes?" offers three choices:
   - **Just me**;
   - **Someone should know**: they get an e-mail and you record the decision (free);
   - **Someone else decides**: their yes counts as theirs (Team plan, not available yet).

   Small owners are never pushed into governance language or a dishonest "just me". Copy never accuses ("segregation of duties is not possible"). It states: "You're the only person here, so you approve your own automations. The record says so."

**Door 2, bring what you have (concept 1), reduced to what users accept.**
- A **file drop** for an n8n export, next to the box. No folder or computer scan in the front door: the non-technical judge read a scan as malware, and the IT judge read it as an endpoint scanner.
- The result is the static risk card plus an honest import verdict ("2 of 10 came over exactly; 10 of 10 can be called as they are; 0 were run").
- The read-only detector of agent config and automations becomes a developer CLI/MCP `inventory` tool and an IT-facing report. Both are designed for wave 3, not built here.

**Org layer, guardrails first (concept 3), behind the routing question and as a free document tool.**
- **"Who decides what"** is the plain name for the Authority Map. It is built on the constitution-v0 vocabulary:
  - four panels;
  - layer chips (Set by / Inherited / Narrowed here);
  - rules confirmed by six generated examples, which become the rule's tests;
  - force levels and Preview mode;
  - change control with a one-signer bootstrap banner.
- It is real as a validated, versioned, hash-chained document. It is checked at proposal time for template settings it bounds: a widening is refused, and a map-answered question is not asked.
- It is **not** enforced on live runs. That needs named approvers (D15, 11-04 engine bump) and an identity the agent cannot hold (hosted Control Plane, D10). Every org page says so.

**IT and security get real artefacts now, without anything being published:**
- a one-page **IT brief** generated from a practised flow's typed IR;
- a **practice-only pilot mode** that the service enforces;
- detection of Claude Code managed policy (stat only);
- an exact-match `serverCommand` allowlist snippet;
- an honest Trust page.

This matches the IT judge's terms for "a 30-day pilot today: practice only, no live connections, our provider only, Mercury off".

**The paid line, shown as one rule at one kind of field.** You pay when someone other than the author decides. A **Team plan** badge appears inline at the approver, rule-owner and auditor fields and on the pricing page. It is never a wall, never mid-build, and never on size.
- The pricing page separates **Decided** (D2: free = one authority, any complexity, SSO; paid = second authority plus verified packs) from **Not decided** (whether SCIM, stop-all and SIEM export are free; owner decision O-C).
- No prices are shown.

**What the site can claim.** Each claim has a status chip (Works now / Preview / Planned) and a source file in `research/`. A test enforces this (§17.3).

---

## 2. Corrections carried into the build

| # | Earlier claim | Correct fact | Where it matters |
|---|---|---|---|
| K1 | n8n importer at `app/core/n8n.mjs` (concept 1) | `app/importers/n8n.mjs` (`importN8n` at line 364, `wrap` at line 342) [repo] | import endpoint |
| K2 | Terminal `approve` and the MCP dialog decide sends (all concepts) | Both decide **turn-on only**. `decideAction` is called only from the dashboard (`app/dashboard/server.mjs:110`) [repo, judge] | §12 CLI and MCP changes |
| K3 | "The model has no code path that can decide" | True only for an MCP-only agent. An agent with a shell running as the same OS user can do what the person can (DESIGN §6.4) | Trust copy, claim C01 |
| K4 | Local Claude Code plugin "blocked by D13" | Installing from a local marketplace publishes nothing (code.claude.com/docs/en/plugins/install, read by the developer judge). The shell command `claude plugin install X --marketplace <src>` adds the marketplace without a details pane, so Foundry must print its own install plan | Wave 3, Planned chip |
| K5 | "A key … (we did not read it)" | The parser does read the file. Say: "Found a value that looks like a key. Foundry didn't keep it or show it." | Wave 3 inventory copy |
| K6 | Zapier "Export my data" = references only | `Zapfile.json` includes "input and output values for each step", plus run-history URLs (help.zapier.com/hc/en-us/articles/8496289406349, read by the UX critic) | Zapier import stays Planned, needing a value-dropping parser |
| K7 | Relay.app migration urgency | Paid accounts ended 2026-09-14 [judge buyer, 3p]. That window has closed | Do not use it in copy |
| K8 | `wrong-target` asks "in 6 of 7 templates" | All 7 templates have one: 9 `wrong-target` slots in total, plus 1 `not-wanted` (`expense-approval.autoApproveUpTo`) [ran] | Ask matrix |
| K9 | Launcher "blocked by D13" | A launcher built and run locally is not publishing. *Distributing* it would be (owner decision O-D) | Install copy |
| K10 | L5 managed broker = paid | Conflicts with D2, under which connections are never paid. Owner decision O-B | Connections page shows "pricing not decided" |
| K11 | constitution-v0 is a general org schema | It is E8-specific. `docProblems` requires clauses C1–C3, and `parameters` requires `refundApprovalThresholdMinor` with currency `EUR` only (`experiments/constitution/constitution.mjs:51-71`, schema) [repo] | §8: new `authority-map-v1` proposal that reuses the v0 vocabulary, plus a v0 export for the refund starter |
| K12 | MCP elicitation always reaches the person | A local `Elicitation`/`ElicitationResult` hook can set `action` and `content` [docs, hooks] | §12: doctor detects such a hook, and MCP then uses the browser |
| K13 | Allowlisting Foundry by name | `serverName` "is not a security control"; `serverCommand` must match every argument in order [docs, managed-mcp] | IT brief snippet = the exact argv from `connectInstructions` |
| K14 | `browser-check.mjs` works | Broken (missing `await`) [ran] | Wave 0 fix |

---

## 3. Rules the build enforces (each one has a test)

| # | Rule | Enforced by |
|---|---|---|
| R1 | **Show what's possible before asking for words.** Cards first; the box suggests, never builds from a keyword guess | `suggest.mjs` returns candidates only; journey J-P2b |
| R2 | **Ask only what a wrong guess would make harmful.** At most 3 per screen; each ask has *why I'm asking* and *if you skip*. A slot without a harm class gets a visible default instead | `data-ask` attribute required on every ask control (lint); journey counters |
| R3 | **Never guess a target.** An address must appear in what the person wrote. For the MCP path, the person's words are `request` + `answers` only, never agent-filled `settings` | `resolveSlots` grounding (existing) + form builder `groundIn` (§12) |
| R4 | **Test before turn-on, on the exact version.** The yes card appears only after a passing test of the same hash | existing `requestApproval` + journey |
| R5 | **Only a human click decides.** Site JS sends `/api/decide` only from a trusted click handler on a visible card | lint + test |
| R6 | **Batch approval is exact.** Each item is bound to the sha256 of its canonical full content and to the workflow hash. Unmatched items stop and ask | `batch.mjs` tests |
| R7 | **Status on every claim and feature:** Works now / Preview / Planned / Not decided. Each Planned item has a "What you can do today" link | crawler + claims test |
| R8 | **Plain register by default, precise one click away.** Operator surfaces never show MCP, webhook, token cap, IR, hash or "Control Plane" unless "Show details" is open | copy lint per route |
| R9 | **No dead ends.** Every view has a forward action or is a declared terminal with Home | crawler |
| R10 | **References, never values.** Keys go to the OS keychain or nowhere. The API never returns a key; logs and journals never contain one | canary test |
| R11 | **Local only.** 127.0.0.1, no external requests from the page, no CDN, no fonts, no telemetry | Playwright route guard |
| R12 | **The paid line never gates size.** No screen or endpoint checks node, step or flow counts | test with 50 flows |
| R13 | **Found text is data.** Imported names and notes are shown with `textContent` and never passed to a model as instructions | existing CSP + grep test |

---

## 4. Personas and routing

There is no role survey, company-size question, referral question or theme picker. Routing comes from the entry point, plus one late question.

| Persona | Arrives via | Lands on | Home after first success |
|---|---|---|---|
| **P1 Solo developer** (Claude Code first, then Cursor, then Codex; D9) | `node app/cli.mjs connect` (prints only), or the site's "Use Claude Code? Connect it in one line" | Their agent's chat; the browser opens only for decisions they choose to make there | Agent chat + `#/waiting` |
| **P2 Non-technical owner** | The site, opened by `node app/cli.mjs site`. Today this needs Node 24 and a terminal, which is an honest blocker; a local launcher is wave 2 and distribution is O-D | `#/` cards + box + file drop | `#/waiting` → `#/automations` |
| **P3 SMB team lead** | Same as P2 | `#/` | Same, plus "Who decides what" if they open it |
| **P4 IT / security** | A champion's downloaded IT brief; or "For IT and security" in the footer; or the doctor line "Your organisation manages Claude Code on this computer" | `#/trust` or `#/it-brief/:flowId` | `#/trust` + `#/settings` (practice-only) |
| **P5 Auditor** | A run record or evidence file handed over by the owner; locally, `#/runs/:id` | `#/runs/:id` | Evidence download |

**Routing rules, in order:**
1. A deep link decides first: `#/it-brief/…` → P4; `#/runs/…` → P5.
2. An MCP call → P1. The browser opens only on a decision and lands on `#/waiting`.
3. The site home → P2/P3 by default.
4. P3 begins when a template slot or the person's words name another decider (`expense-approval.approver`), or when the person changes "Who decides: you" on a yes card. This shows the three-option control (§7.3).
5. Doctor finds managed Claude Code policy (stat of `managed-mcp.json` or `managed-settings.json`). Show an inline card: "Your organisation manages Claude Code on this computer. [Get a one-page brief for IT] [Turn on practice-only mode]". It is an offer, not a gate. Making it a gate is owner decision O-G.

---

## 5. Minimal-ask matrix (final)

**Status after this build:**
- **R**: real, tested code.
- **P**: Preview (real code, but pretend effects or never measured live).
- **D**: designed, shown as Planned.

"Who sees it" lists every party that can read the answer. **No model ever sees a key, a connection value or a decision.**

| ID | Ask (final words) | Persona | When | Harm if guessed | Default if skipped | Who sees it | Undo | St |
|---|---|---|---|---|---|---|---|---|
| A0 | Pick a card, or "Describe it in your own words" | all | first screen | — | nothing is created | you; with an AI key, the AI provider | edit → new version | R |
| A1 | The template's own question, e.g. "Which e-mail address should get the summary?" (9 such slots across 7 templates) | P1–P3 | on the make page / via the agent, only if not already stated | data to the wrong person | not built; a non-answer ("my boss") is asked again | you; agent (MCP path); recipients only through the effect | change → new version, new test, new yes | R |
| A2 | "Up to what amount should it approve on its own?" (`expense-approval.autoApproveUpTo`) | P3 | make page | money you'd refuse | asked; in an org with a map bound, answered as "€250 · Set by Finance" and not asked | you; rule owner if bound | new version | R (map-answered: R wave 2) |
| A3 | "Who decides?" with Just me / Someone should know / Someone else decides [Team plan] | P3 | only when a slot or the words name another decider; otherwise a visible default on the yes card ("Who decides: you · change") | self-approval presented as someone else's | Just me | you; the named person only through an e-mail | change → new version | R (choices 1–2), D (choice 3) |
| A4 | "Test with pretend data, or with your own list?" | P2/P3 | checked page, optional | none (both are tests) | pretend data | local only | yes | R |
| A5 | **"Turn on '<title>' (version N)?"** | all | after a passing test of that hash | — | stays off | you; ledger | turn off; rollback D | R |
| A6 | "Where's your <sheet>?" Drop the export (CSV or JSON) | P2/P3 | go-live, first run | wrong file → wrong output | keep testing on pretend data | local only | replace file | R |
| A6b | Only if ambiguous: "Is 03/04/2026 the 3rd of April or March 4th?"; "Your file says 'Overdue' and 'Part paid'. Which mean still open?"; "Is 1.234 one thousand two hundred thirty-four, or one point two three four?" | P2/P3 | column mapping | reminding someone who paid; wrong amounts | not imported until answered | local only | remap | R |
| A7 | "How should it send?" **Make drafts you send yourself** (Works now) · E-mail from Gmail / SMTP / Slack webhook (Planned) | P2/P3 | go-live | wrong account; wider access | drafts | you | — | R (drafts), D (others) |
| A8 | "Connected as dana@acme.com. Is this the account you meant?" | — | after a connection | wrong identity | not bound | you | yes | D |
| A9 | **"Make these N drafts?"** (exact list) or single "Make this draft?" / "Send this?" | all | each live effect (batch: one card per run) | irreversible effect | nothing made; the run stops before the effect | you; ledger | — | R (single), R (batch; new) |
| A10 | "Want a pop-up when something is waiting? (only while Foundry is open in a browser tab)" | all | the first time something waits | stuck runs | badge + tab title count | you | yes | P (wave 2) |
| A11 | "Remind me every Monday at 8 (adds a calendar event; it doesn't run by itself)" | P2/P3 | yes card, optional | — | no reminder | you | delete event | P (wave 2) |
| A12 | "Add Foundry to Claude Code: here is the exact line" | P1 | connect page | writing another app's config | print only | you | remove the line | R |
| A13 | "Who builds from your words? No AI (match to a card, $0, nothing leaves this computer) · Mercury 3 with your Inception key · Anthropic key (Planned)" | P2/P3 | only after a box request matches no card | words leave the machine; cost | no AI | AI provider sees your words and answers; key in keychain only | remove key | P (Mercury), D (others) |
| A14 | "Daily limit for Mercury" | with A13 | with A13 | runaway use at a $0 list price | 200,000 tokens/day | you | yes | P |
| A15 | "Already use n8n? Drop an exported workflow" | all | home, optional | — | — | local only | forget import | P (wave 2) |
| O1–O9 | Org asks | P3/P4 | see §8 | — | restrictive defaults | — | — | — |
| I1 | "Practice-only mode: nothing can run for real on this computer" | P4 | settings / IT brief | live effects during a pilot | off | you | yes | R (wave 2) |
| I2 | "Allowed AI: none (default) / Mercury" | P4 | settings | new data processor | none | you | yes | R (wave 2) |
| AU1 | "Which run?" | P5 | runs list | — | latest | you | — | R |

**Never asked:**
- role, company size, referral, theme;
- an account, e-mail or payment details on the free local path;
- scope strings, ports or where to keep keys;
- a key in chat or over MCP;
- the same thing twice (WCAG 3.3.7);
- telemetry consent. There is no telemetry. Activation timing is a local file only.

**Before value, P2 is asked nothing.** A card click is the input, and the first question (A1) is the template's own wrong-target slot.

---

## 6. Connect-options catalog (the `#/connections` page)

Each entry shows:
- status chip;
- what it can do and cannot do, in verbs;
- what Foundry stores and who holds it;
- free or paid;
- **"Until it's connected"** (the pretend-data fallback);
- **"What you can do today instead"** for anything Planned.

Live statuses come from `GET /api/doctor`.

| Group | Option | Can / cannot | Foundry stores | Free/paid | Until connected | Status |
|---|---|---|---|---|---|---|
| **Coding agents** | Claude Code | your agent drafts and tests automations; it cannot turn them on or approve sends | nothing; the line points at your workspace | Free | — | Works now (line printed). Not tested against a real Claude Code release |
| | Cursor | same | nothing | Free | — | Works now (`.cursor/mcp.json` snippet); one-click link Preview (`cursor://anysphere.cursor-deeplink/mcp/install?name=foundry&config=<base64>`, built from Cursor's documented format, not tested in Cursor) |
| | Codex | same; Codex has no documented dialog for your decisions, so Foundry opens your browser | nothing | Free | — | Works now (`codex mcp add` line printed) |
| | Claude Code plugin from your own copy | adds Foundry + a "when to use Foundry" skill in one step | nothing | Free | — | Planned (local marketplace; no publishing) |
| **Your data** | Spreadsheet export (CSV) | reads the rows you drop; cannot see your accounting app | the mapped columns only, in `world/sheets/` | Free | pretend rows per template [see them] | Works now (after this build) |
| | JSON rows | same | same | Free | same | Works now |
| | Google Sheets, QuickBooks, Xero, CRM | — | — | Free | drop an export | Planned |
| **Sending** | **Drafts you send yourself** | makes e-mail drafts you open in your mail app and send yourself; Foundry sends nothing | the draft text on this computer | Free | — | Works now (after this build) |
| | Slack/Teams webhook (one channel, send only) | — | the webhook URL in the keychain | Free | drafts | Planned |
| | Gmail send-only / SMTP | — | — | Free (own app) / not decided (managed sign-in, O-B) | drafts | Planned |
| **AI for building** | None needed | matches your words to a card; nothing leaves this computer | — | Free | — | Works now |
| | Mercury 3 (your Inception key) | fills a card's settings from your words; your words go to Inception | key in your OS keychain; never in files, logs or the AI's context | Free (bring your own key) | no AI | Preview |
| | Anthropic key (Haiku 5.5) / Sign in with OpenRouter | — | — | Free | no AI | Planned (owner decision O-A) |
| **What you already have** | n8n export | reports what it does and what could come over; runs nothing | the report | Free | — | Preview (2 of 10 sample files came over exactly; 0 run) |
| | Zapier export, Make blueprint, GitHub Actions | — | — | Free | pick the matching card | Planned |
| **People** | You approve | you turn things on and approve sends | ledger records "you" | Free | — | Works now |
| | Someone else approves (their own sign-in) | — | — | **Team plan** | they get an e-mail; you record the decision | Planned |
| | Single sign-on | — | — | Free (D2) | — | Planned (needs accounts) |
| **Getting your attention** | Badge + tab title | — | — | Free | — | Works now |
| | Browser pop-up while Foundry is open | — | — | Free | badge | Preview (wave 2) |
| | E-mail or phone | — | — | — | badge | Planned |

**The plumbing Foundry owns** (listed on the page under "What you'll never have to do"):
- picking where things are stored (`~/.foundry`, private);
- ports;
- key storage;
- agent config, which is printed, never silently written;
- converting your spreadsheet;
- version binding;
- pretend stand-ins;
- checking what was written;
- evidence assembly;
- the IT brief.

---

## 7. Journeys and the onboarding wizard per persona (with the real calls)

`app` is the `FoundryApp` built with the site builder (§12.2). Endpoints are in §11.

### 7.1 P2: "Chase unpaid invoices" (the reference journey)

| # | Person does | Site calls | Shows | Ask |
|---|---|---|---|---|
| 1 | Clicks card **Chase unpaid invoices** | `GET /api/templates` (once, at load) | Make page: the restatement ("I'll remind customers 7, 14 and 30 days after the due date, signed 'Accounts team', and send you a summary"); defaults as editable chips; one question | — |
| 2 | Types own e-mail under "Which e-mail address should get the summary?" (or ticks "No summary") | — | Why: "The summary lists your customers and what they owe; I will not guess where it goes." If you skip: "No summary is sent." | A1 |
| 3 | Clicks **Test it with pretend customers** | `POST /api/propose {template:'invoice-chase', settings}` → `app.propose`; then `POST /api/practice {proposalId}` → `app.dryRun` | Live region: "Testing with pretend customers. Nothing real is sent." → **What I checked** | — |
| — | **First verified** at 3 actions and 1 ask | | "Test passed. 3 reminders and 1 summary would have gone out. Nothing real was sent." Checks ticked. "What a test can't prove" box. The turn-on card follows inline | |
| 4 | Clicks **Turn it on** | `POST /api/request-approval` → `app.requestApproval`; `POST /api/decide {kind:'activation'}` → `app.decideActivation(…, {channel:'dashboard'})` | "On. It runs when you press Run. It won't run by itself." | A5 |
| 5 | Drops their invoice export | `POST /api/data/preview` | Column mapping with sample values | A6 |
| 6 | Answers the date-order question (only if ambiguous) | — | — | A6b |
| 7 | Clicks **Use these columns and test** | `POST /api/data/commit {target:'live'}`; `POST /api/batch/preview {flowId}` (a test of the current version on the live rows) | **Make these 4 drafts?** with To, Subject and full text of each | — |
| 8 | Clicks **Make 4 drafts** | `POST /api/batch/approve` → `app.run` + exact-match `app.decideAction(channel 'dashboard')` per item | Drafts page: **Open in mail app** / **Download** per draft. "Foundry sent nothing. You send them." | A9 |
| — | **First live** at 8 actions and 4 asks; 0 accounts, 0 keys, 0 connections | | | |

Optional branch at step 3: **Test with my own list first** is A4. It uses `app.dryRun({proposalId, sheets})` (service change, §12.1). The result is labelled "Tested on: your list (12 invoices)".

### 7.2 P1: Claude Code (agent builds, Foundry checks)

| # | Person | Agent and Foundry | Ask |
|---|---|---|---|
| 0 | Runs `node app/cli.mjs connect`, or copies the line from `#/connect-agent` | prints `claude mcp add --transport stdio foundry -- "<node>" "<cli>" mcp --dashboard --workspace "<ws>"` | A12 |
| 1 | Pastes it. Claude Code shows its own trust prompt for the server (a client gate, not counted) | — | — |
| 2 | Types "use Foundry to chase my unpaid invoices, summary to me@example.com" | `list_templates` → `propose_flow {request, template:'invoice-chase', settings}`. Grounding checks `me@example.com` against `request`. Then `dry_run` | — |
| — | **First verified** at 2 person actions and 0 asks; the agent relays `say` | | |
| 3 | Approves in the dialog (Claude Code first shows its person-only tool prompt for `approve`; a real client adds +1 click, not yet verified) | `approve` → elicitation → `decideActivation(channel 'mcp-elicitation')` | A5 |
| 4 | Decides the batch. Wave 1: in the browser page that opens (`#/waiting`). Wave 2: in one dialog listing every draft | `run_flow` → batch | A9 |

- **Variant:** the agent fills an address the person never wrote. `propose_flow` returns `needs_answers` with the template's question, and the agent relays it: +1 ask. This is tested.
- **Variant:** with no elicitation support (Codex), `approve` returns `awaiting_human` and the browser opens on the yes card.
- **Baseline for comparison:** the DESIGN §8.3 spike, weekly report, 3 person actions from request to first live.

### 7.3 P3: "Approve small expenses" (team lead; the paid line as a feature)

1. Card **Approve small expenses automatically**.
2. Two asks on the make page:
   - "Up to what amount should it approve on its own?" (A2, not-wanted);
   - "Who decides the bigger ones? (their e-mail)" (A1, wrong-target).

   The three-option **Who decides?** control (A3) sits directly below:

```
Who decides the bigger claims?
(•) Maria gets an e-mail and you record the decision here        Free
( ) Maria decides, and her yes is recorded as hers   [Team plan]
    For Maria's yes to count as hers, she needs her own sign-in,
    which this computer can't give her. The Team plan will do that;
    it isn't available yet. You can test everything now, with you
    standing in for her.  [What the Team plan does]
( ) Just me, nobody else needs to know                            Free
```

3. **Test it with pretend claims.** The checked page reads: "2 claims approved on their own (under €100). 1 e-mail to maria@example.com listing 2 claims to decide. Nothing real was sent." **First verified: 3 actions, 2 asks.**
4. The turn-on card shows "Who decides: you (Maria gets an e-mail)". If they chose the Team plan option, the card says "Practice only: Maria's own sign-in isn't available yet" and offers **Turn it on with you recording decisions** or **Keep it in practice**. There is no dead end and no modal wall.

Guard: the shipped template e-mails the approver. The UI never says "Maria approved" (repo-surface §3.3 row 5).

### 7.4 P4 IT and P5 auditor

**P4 (from any practised flow):**
- **Get a one-page brief for IT** → `#/it-brief/:flowId` → **Download** (`GET /api/brief/:flowId.md` and `.html`). That is 2 actions.
- `#/settings` → **Practice-only mode: on** (1 action) → `POST /api/settings`. After that `app.run` refuses with `PRACTICE_ONLY`: "Practice-only mode is on, so nothing runs for real on this computer. Turn it off in Settings."
- The Trust page shows the exact allowlist entry (§9.12).

**P5:** `#/runs` → a run → "Record checked: N events, unbroken" → **Download evidence** (`GET /api/evidence/:runId.json`). That is 3 actions. The page lists the known gaps (§9.11).

### 7.5 Batch approval of an exact list (new mechanism; no engine change)

**Why it is needed.** Live sends pause one at a time [ran]. A batch card therefore cannot list "all pending".

**How it works:**
- **Preview.** `batch.preview(flowId)` reads the head workflow and the live `world/sheets`. It runs `runInWorld(head, {sheets, input:{now}, mode:'practice'})`, which is the existing practice path with stand-ins. Each planned effect gets `{action, to, subject, body}` in full plus `digest = sha256(canonical({tool, args}))`. It records `{batchId, flowId, workflowHash, items[digest], createdAt, expiresAt: +60 min, usedBy: {}}` in `<ws>/batches.json`, written atomically.
- **Approve** (human click). `app.run({flowId, input:{now}})`. Then, while the run is `awaiting_approval`:
  - take `app.status({runId}).pendingApprovals[i]`;
  - compute the digest from its full `args`;
  - if it matches an unused item and the run's `workflowHash` equals the batch's, call `app.decideAction(runId, approvalId, true, {channel:'dashboard'})` and mark the item used with `{runId, approvalId}`;
  - otherwise stop and show a normal single card ("This wasn't on the list you approved").
- **Never:**
  - match by a truncated preview;
  - reuse an item;
  - honour an expired batch or a different hash;
  - approve anything not displayed in full.
- **Copy under the button:** "If the real run wants to make anything that isn't on this list, it stops and asks you."
- **Tests:**
  - an exact match is decided;
  - a one-character body change is not;
  - a reused item is not;
  - an expired batch is not;
  - a changed head (new version) is refused;
  - a decline makes nothing;
  - the ledger and batch file show the person's click as the source.

This is development evidence of the mechanism only. It needs the owner's review, because it widens "one click, one action" to "one click, an exact displayed list" (O-J).

---

## 8. Org setup: "Who decides what" (the Authority Map)

**Vocabulary** is taken verbatim from `experiments/constitution/schema/constitution-v0.schema.json`:
- layers `regulation > org-policy > entity-rule > process > workflow`;
- `roles`;
- `principals` (`human | service | customer-class`);
- `bounds` (`layer, owner, parameter, min, max, statement`);
- `clauses` (`layer, owner{role, principal}, assurance[provable|monitorable|judged], statement, check, narrows, exceptions[break-glass|emergency-change; who; when; requires[justification|after-the-fact-review|journal]; reviewBy; reviewWithinHours], evidence`);
- `change{proposerRoles, approverRole, proposerMayApprove, approvalBeforeEffective}`.

**New contract (proposal, O-H):** `app/onboarding/schema/authority-map-v1.schema.json`, `kind: "foundry.authority-map/v1"`. It is the v0 structure with three differences:
- `parameters` is a map `{name: {value, unit}}` instead of the E8 refund threshold;
- clause ids are free;
- `check.kind` is limited to four code-evaluable kinds:
  - `approval-above-threshold` (parameter, approverRole, excludeRequester);
  - `separation-of-duties` (the roles that cannot both act on a case);
  - `never-outside-domain` (domain);
  - `max-per-run` (effect, n).

Per clause it adds `force: tell | stop-unless-override | stop`, `mode: preview | on`, `examples[6+]` and `doesNotCover`.

`authority-map.mjs` validates:
- the schema;
- layer order;
- containment, reusing the `boundProblems` logic generalised (a lower layer may only narrow);
- that each owner holds its role;
- that the change rule's roles exist;
- dual-role warnings (a principal holding two roles that a separation-of-duties clause separates).

`toConstitutionV0(map)` exports the **Refund authority** starter to v0, and a test validates it with `experiments/constitution/constitution.mjs` `docProblems`. That proves the vocabulary is compatible.

**Four panels plus a change strip.** Status: R = real as a local document after wave 2.

| Panel | Asks (O-IDs) | Defaults | Team plan badge |
|---|---|---|---|
| Start | O1 "Start from: Just me (personal guardrails) / Small team / Refund authority example / Blank" | Just me | — |
| People and roles | O2 Names and roles, typed locally; roles Admin, Builder, Approver, Rule owner, Auditor | you hold every role | at Approver, Rule owner and Auditor when the person ≠ you |
| Who approves what | O3 Rows per action class (money out, message outside the company, change customer records, delete). Columns: above what amount, approver role, backup, remind after (24 h), don't run after (72 h), excluded (the requester; whoever entered the case) | two levels; requester excluded | approver role ≠ you |
| Rules that never break | O4 One sentence built from the four check kinds; owner; layer. O5 "Is this your rule?" with 6 generated cases marked allowed / held / blocked. O6 force level. O7 exceptions. O8 "What this rule does not cover", prefilled: "Only automations run by Foundry. Refunds made directly in Stripe are outside this rule." | Preview; money rules default to "Stop unless <owner> overrides" | rule owner ≠ you |
| Where it runs and what it may touch | AI allowed (none / Mercury); practice-only mode; records stay on this computer | none; off; this computer | — |
| Change strip | O9 who proposes, who approves, "the proposer can't approve their own change" | — | approver ≠ proposer |

**Generated examples.** For `approval-above-threshold` with T = €250, the cases are: €0; €249.99; €250.00; €250.01; €5,000; and €300 where the requester is the approver (blocked). The person confirms or edits each.

**Examples become tests.** Saving a new version re-evaluates every confirmed example. If one flips, the save is refused with "This change would turn case 3 (€250.00, allowed) into held. Confirm the new answer for case 3 or undo the change."

**Versions:**
- saved as `<ws>/org/authority-map.v<N>.json`;
- `supersedes` = sha256 of the previous version;
- history in `<ws>/org/history.jsonl` as a hash chain.

v1 by one person carries the banner "**Started by one person.** Rules need a second person to approve changes; until then, you approved your own setup. Review within 14 days."

**What it does today, labelled on every org page.** "Checked when an automation is made and tested. Not yet enforced while it runs: that needs named approvers, which are planned." For example:
- the map's `expenseAutoApproveMax` bound prefills and caps `expense-approval.autoApproveUpTo`;
- a widening proposal is refused with: "Not allowed here. Finance set the limit at €1,000 (Org policy). This automation can only make it stricter. [Ask for a change]".

**Not built (shown as Planned):**
- Preview replay ("would have held 12 of 340 runs"). Copy: "Replay needs past runs. You have 0."
- Policy-document drafting (needs a model);
- SSO, SCIM, SIEM;
- second-person sign-in.

---

## 9. Pages and final copy

Copy rules:
- All strings live in `app/site/public/copy/en.json` with `plain` and, where needed, `precise` variants.
- Every number sits inside `{claim:Cxx}`, or is rendered from API data, or is UI chrome on an allowlist.
- Plain-register glossary:

| Precise term | Plain term |
|---|---|
| flow | automation |
| practice run | test with pretend data |
| stand-in | pretend inbox / pretend sheet |
| version N | version N (your latest changes) |
| Control Plane | Team plan |
| model / key | "Uses AI: yes/no" |
| activation | turn on |
| proposal | draft |

Swap the right column into operator copy; developer surfaces keep both under "Show details".

**9.1 Home `#/`**

- H1: **Hand off the jobs you do every week.**
- Lead: "Pick one below or describe it. Foundry builds it, tests it with pretend data, and shows you exactly what it will do. Nothing real happens until you say yes."
- Section: **Foundry can make these today.** Each card has a title, a one-line summary, chips ("Uses AI: no", "Needs: your <sheet> as a spreadsheet") and **Start**:

| Card | Summary |
|---|---|
| Chase unpaid invoices | Polite reminders to customers who are late, firmer later. You see every e-mail first. |
| Approve small expenses | Approves claims under your limit. Sends the rest to the person who decides. |
| Weekly progress report | Counts what's done, open and blocked, and e-mails one person. |
| Route new leads | Sends each new lead to the right salesperson. |
| Answer common support questions | Replies with your own answers. Sends the rest to a person. |
| On-call alert digest | One summary of unresolved alerts to a chat channel. |
| Keep the newsletter list in step | Finds contacts missing from your list and tells you. |

- Box: label "**Or describe it in your own words**", placeholder "e.g. remind customers who haven't paid after a week", button **Find a match**. Help text: "Without an AI key, Foundry matches your words to the list above. Nothing leaves this computer."
- File door: "**Already use n8n?** Drop an exported workflow to see what it does and what could come over. Zapier and Make: later." [Choose file]
- Developer strip: "**Use Claude Code, Cursor or Codex?** Connect it with one line →"
- Trust strip: "Runs on this computer. No account. Nothing is sent anywhere until you say yes {claim:C01}. [How this is kept safe]"
- Proof strip: "**Why Foundry tests before it acts.** In our own tests, a low-cost AI that practised first built a 14-case order process with 14 of 14 right, for $0.39. A top AI that built it in one go got 5 of 14, for $7.63 {claim:C04}. These are development tests on one task family we wrote, not a promise about yours. [Source]"
- Footer: "Free for one person, at any size. [Pricing] · [For IT and security] · [Help] · Runs on 127.0.0.1 only."

**9.2 Box result `#/describe`**

- Match: "**This sounds like: Chase unpaid invoices.** (matched by keywords, not AI) [Use this] [Not this, show all]"
- No match: "**I can't make that yet. Nothing was created.** Here's what I can make today. If one is close, pick it and change the settings." Then the cards, plus "Want Foundry to try with AI? [Set up an AI key] (your words go to the AI provider)".

**9.3 Make page `#/make/:template`**

- H1 = card title.
- **"I'll do this:"** an editable restatement rendered from `understood.slots` + `willDo`.
- **Settings already chosen for you**: each default as an editable chip.
- Questions (at most 3), each with "Why I'm asking" and "If you skip".
- Facts: **Uses AI:** "No, it follows fixed steps." **Where your data goes:** "Nowhere. It reads the list you give it and writes on this computer."
- Primary button: **Test it with pretend <customers/claims/leads/tickets/items>**. Secondary: **Back to all automations**.

**9.4 Test progress and "What I checked" `#/checked/:proposalId`**

- Live region (polite): "Testing with pretend data… nothing real is sent." then "Test finished."
- H1, pass: "**Test passed. <wouldDo summary>. Nothing real was sent.**"
- H1, fail: "**The test didn't pass, so it can't be turned on.**" + `problem.what` + `problem.next` + [Change a setting].
- **What I checked**: per check, the `plain` sentence, "How: Foundry re-read the pretend outbox afterwards" (from the verify node) or "How: a rule on the result", and a tick or cross. Never "pass" on a cross.
- **What would have happened**: `wouldDo` items with To, Subject and the first lines.
- Box **What a test can't prove**: "That your e-mails will arrive, or that your real list looks like the pretend one. [Test with my own list]"
- Inline turn-on card (9.5).

**9.5 Turn-on card**

- Title: "**Turn on '<title>' (version N)?**"
- Lists: **It will** / **It won't** (template `willNotDo`, including "Run by itself on a schedule: you start each run") / **Done means** (checks).
- Facts: **Uses AI:** no · **Tested on:** pretend data, passed N of N checks · **Who decides:** you [change] · **What it needs to go live:** your <sheet>.
- Buttons (each at least 44 px, 16 px apart): **Turn it on** · **Change something** · **Not now**.
- Fine print: "Turning it on doesn't send anything. It lets you run it, and it shows you what it will make before anything happens."

**9.6 Go live `#/go-live/:flowId`**

- "**Where's your <sheet>?** Most accounting, CRM and tracker apps can export a list as a CSV file. Drop it here." [Choose file]
- Mapping: "**Which column is the <plain column>?**" with a select per needed column, showing 3 sample values. Unneeded columns: "Foundry keeps only these columns."
- Ambiguity questions (A6b).
- Then **Make these N drafts?** card: the list in full. Buttons **Make N drafts** / **Don't make any**. Line: "If the real run wants to make anything that isn't on this list, it stops and asks you."
- Section **How should it send?**: (•) Make drafts you send yourself (Works now) · ( ) Send from Gmail, an e-mail account, or a Slack channel (Planned) [What you can do today: use drafts].

**9.7 Drafts `#/drafts`**

- H1: "**N drafts ready. Foundry didn't send anything.**"
- Per item: To, Subject, text, [Open in your mail app] (a `mailto:` link, or "Too long for a link: [Download]"), [Download .eml], and a tick box "I sent it" (your note only; Foundry can't see your mail).

**9.8 Waiting, automations, runs** (ported from `app/dashboard`, same APIs)

- **Waiting for you**: turn-on cards (9.5) and action cards ("**Make this draft?** / **Send this?** To · Subject · exact text") with **Yes, do it** / **No, don't**; batch cards.
- **Your automations**: title, On / Off, version, runs, last result; "Test passed; waiting for your OK" for drafts.
- **Run**: headline, failed step + what to do, "Done means" ticks, "Record checked: N events, unbroken", timeline, cost, and the honesty line "A run that passed its checks shows the automation did what it said on this computer. It doesn't show that an e-mail arrived."
- **Versions**: "What changes from the version that's on now" (existing `diffVersions`).

**9.9 Pricing `#/pricing`**

- H1: "**Free for one person. Paid only when someone else's yes has to count as theirs.**" {claim:C08}
- **Free, always:**
  - any number of automations, any size;
  - tests and checks;
  - your own AI key, or none;
  - bringing in what you already have;
  - a checked record of every run;
  - your own rules;
  - a one-page brief for IT;
  - single sign-on when accounts exist (Planned, free).
- **Team plan (not available yet; no price set):**
  - someone else approves, and the record shows it was them;
  - rule owners whose rules others can't change;
  - auditor access and evidence for a whole period;
  - approvals from another device, hosted.
- **Verified packs (not available yet):** ready-made automations for one outcome, with pass rates from sealed tests.
- **Not decided yet:** "Whether removing people automatically when they leave (SCIM), a stop-everything switch, and sending records to your security tools are free. We think the first two should be." (O-C)
- **Why the line is here:** "We never charge by size. Splitting an automation in two doesn't change anything. The line is a second person, because that's what a single computer can't prove."
- Footer: "Nothing on this page takes payment. Foundry runs only on this computer."

**9.10 Trust and security `#/trust`**

1. **What runs where.** "Everything runs on this computer. The page listens on 127.0.0.1 only. Your automations and records are in <workspace> (private to your user)."
2. **What leaves this computer.** "Nothing, unless you turn on an AI builder. With Mercury, your words and answers go to Inception to fill in a card's settings. Nothing else does."
3. **Keys.** "AI keys go into your computer's keychain. Foundry never writes them to a file, a log or the AI's context. If your computer has no keychain Foundry can use, it doesn't save the key."
4. **Who can approve.** "Only you, with a click on this page, a typed yes in your own terminal, or the dialog your coding agent shows you. Your agent can draft and test, not approve."
5. **The honest limit** {claim:C01}. "A coding agent that can run commands as you on this computer could do what you can do, including approve. Foundry's link key and checks keep out other web pages and other users, not that agent. What closes this gap: Foundry running as a separate user, approvals on a second device, or the hosted Team plan (all planned)."
6. **Records.** "Each run keeps a chained record that Foundry re-checks when you open it. Known gaps: your decisions and the AI's transcripts are not yet part of the chain, and the chain's latest link isn't stored outside this computer unless you ask for it." {claim:C14}
7. **What's tested.** "Linux. macOS and Windows are untested; steps that run code are refused there." {claim:C13}. "No user has tried this yet."
8. **For IT: the pilot we suggest.** Practice-only mode; no AI or your approved provider only; Mercury off; Linux or macOS developer machines; 30 days.
9. **Before live use in an organisation, these must exist:**
   - approvals by an identity the agent can't hold;
   - a record anchored outside the user's control;
   - automatic removal of leavers and a stop-everything switch;
   - a signed, pinned build you can allowlist.

   None exists yet.
10. **Allowlist entry** (exact): the `serverCommand` array generated from `connectInstructions` plus a `managed-mcp.json` example. Note: "Claude Code matches every argument in order; a name is not a control." [docs]

**9.11 IT brief `#/it-brief/:flowId`** (generated; downloadable `.md` and `.html`)

Sections:
- What Foundry is;
- this automation (title, version, workflow hash, template, builder, "Uses AI");
- every action (step, effect class, target, "asks a person first");
- what it never does (`willNotDo`);
- data read / written / leaving the machine;
- who decides;
- test evidence (checks, data source);
- records and how to check them;
- the honest limit (copied from 9.10.5);
- suggested pilot terms;
- the allowlist entry;
- questions to ask Foundry's owner.

Header: "Generated on this computer on <date>. Not sent anywhere."

**9.12 Docs `#/docs`** (Quickstart, three tracks)

- **I use Claude Code**:
  - `git clone …` (owner's copy);
  - `node app/cli.mjs doctor`;
  - `node app/cli.mjs connect` → paste the line;
  - say "use Foundry to …".

  Cursor and Codex use the same steps with their snippet.
- **I don't code**: "Today someone needs to start Foundry for you with `node app/cli.mjs site` (Node 24). A one-click starter is planned." Then the home page.
- **I'm setting this up for a team or IT**: practice-only mode, the IT brief, Who decides what.
- Glossary page (plain ↔ precise terms). Help: the same link in the header on every page (WCAG 3.2.6).

**9.13 AI keys `#/keys`**

Copy:
- "**You don't need an AI key.** Foundry matches your words to its list for free. A key lets an AI fill in the settings from your own words."
- Mercury 3: [Paste your Inception key] (password field, paste allowed) → **Check and save**. Result: "Saved in your keychain: Inception key ending a1b2. Your words will go to Inception when you ask Foundry to build." Plus "Daily limit: 200,000 tokens" and **Remove**.
- No keychain: "**This computer has no keychain Foundry can use, so your key was not saved.** You can set INCEPTION_API_KEY in your own terminal before starting Foundry."
- Anthropic and OpenRouter: Planned, with "What you can do today: use the list, or Mercury."

**9.14 Import `#/import`** (n8n, wave 2)

- Verdict lines: "**Comes over exactly**" / "**Can be called as it is** (it stays in n8n)" / "**Can't come over yet**", with reasons in plain words.
- **Risk card** per workflow: "What it does to the outside world · safe to repeat? (unknown / no) · does anything check it worked? · does anyone approve it?". Each line says whether Foundry read it from the file or inferred it.
- Footer: "Foundry ran nothing. n8n keeps running your workflow as before." {claim:C06}

**9.15 Errors.** Always four parts: **What happened** / **What was not done** ("Nothing was sent") / **What to do** (button) / **Details** (code, collapsed).

---

## 10. Directory layout

```
app/site/
  server.mjs              createSite(app, opts): loopback server; static + dashboard API + site API
  api.mjs                 site routes (§11), each a thin adapter over FoundryApp / app/onboarding
  claims.json             C01..Cnn → {text, status, evidence, source:{path, anchor}}
  public/
    index.html            shell: header/nav, <main id="view">, footer; no inline script or style
    site.css              tokens + components (§13)
    site.js               hash router, fetch wrapper (token header), focus management, live region
    views/                home, describe, make, checked, go-live, drafts, waiting, automations,
                          automation, runs, run, connections, keys, org, org-rule, it-brief,
                          import, settings, connect-agent, pricing, trust, docs, glossary, help, not-found
    components/           card, ask-field, defaults, restatement, will-card, check-list, approval-card,
                          batch-card, diff-card, status-chip, paid-badge, drop-zone, column-mapper,
                          key-entry, snippet (copy button), error-panel, stepper, toast, dialog
    copy/en.json
    icons.svg             inline SVG sprite (served same-origin)
  launch/                 (wave 2) Foundry.command (macOS), foundry.desktop (Linux), Foundry.cmd (Windows);
                          local only, each runs `node app/cli.mjs site`
  test/
    api.test.mjs  security.test.mjs  claims.test.mjs  copy-lint.test.mjs  tokens-contrast.test.mjs
    journeys/harness.mjs  p1-claude-code.mjs  p1-cursor-codex.mjs  p2-operator.mjs  p2-edges.mjs
             p3-team-lead.mjs  p4-it.mjs  p5-auditor.mjs  org-map.mjs  keys.mjs  import.mjs  crawl.mjs
    fixtures/  invoices-accounting-export.csv (synthetic, written by us; day-first dates, "Overdue"/"Part paid")
               expenses.csv  leads.csv  n8n-synthetic.json  managed/etc-claude-code/managed-mcp.json
app/onboarding/
  form-builder.mjs        TemplateFormBuilder (no model)
  site-builder.mjs        composite: template+settings → form builder; else text builder (stub | WorkerBuilder)
  suggest.mjs             $0 keyword match of words → catalog candidates
  columns.json            per template sheet: [{name, plain, type: text|email|number|date|enum, values?}]
  csv.mjs                 RFC 4180 parse, delimiter sniff, BOM, caps; mapping + ambiguity detection; transforms
  data.mjs                practice sheets from mapped rows; write live world/sheets (+ .history backup)
  batch.mjs               exact-content batch preview / approve (§7.5)
  drafts.mjs              live outbox → drafts, mailto, .eml (X-Unsent: 1)
  detect.mjs              doctor extras (§12.3)
  keychain.mjs            backends: macos-security | linux-secret-tool | windows-passwordvault | ephemeral | none
  keys.mjs                verify against policy base URL (GET /models), last4, store, remove
  builder-worker.mjs      child process running ModelBuilder with the key in its env only (Mercury, preview)
  settings.mjs            <ws>/settings.json: theme pref, mode, builder, tokenCap, notifications
  brief.mjs               IT brief (md + html) from the IR + describeWorkflow + dry-run record
  evidence.mjs            per-run evidence bundle
  authority-map.mjs       v1 model, starters, validation, versions, history chain, toConstitutionV0
  rule-examples.mjs       generate / evaluate / re-run examples for the 4 check kinds
  proposal-check.mjs      map bounds ↔ template slots (prefill, refuse widening)
  importers.mjs           (wave 2) n8n drop → importN8n + risk card
  schema/authority-map-v1.schema.json
  test/*.test.mjs
research/onboarding-20261021/
  SPEC.md (this document)  CONCEPTS.md  JUDGMENTS.md  JOURNEYS.json (measured; written by the journeys)
  sweeps/ automation-products.md connection-ux.md developer-tools.md org-enterprise.md
          repo-surface.md research-literature.md   (copied from the scratchpad; raw fetched pages NOT copied)
```

---

## 11. Local server and API

**Server.** `createSite(app, {token, workspace, keychain, settings})`:
- listens on 127.0.0.1, port 4178, falling back to a random port;
- reuses the dashboard's Host check (DNS rebinding), CSP, security headers, the token in the URL fragment moved to sessionStorage, and the `x-foundry-token` header on every `/api/*` call;
- JSON only;
- 16 KB body cap, except the `/api/data/*` and `/api/import/*` routes (5 MB, 10,000 rows);
- refactors `app/dashboard/server.mjs` to export `handleDashboardApi(app, req, res, url, send)` and mounts it. `createDashboard` keeps its API and tests.

**One Foundry process per workspace.** `<ws>/.lock` holds the pid. A second `site` or `mcp` start on a live lock says: "Foundry is already open for this workspace (pid N). Use that window, or start with --workspace <other>."

**CLI:**
- `node app/cli.mjs site [--workspace] [--port] [--no-open] [--builder templates|mercury] [--token-cap N]` prints the doctor lines, the URL and the connect lines.
- After the wave-1 acceptance tests pass, `start` = `site` and `mcp --dashboard` serves the site's `#/waiting`. `FOUNDRY_UI=dashboard` keeps the old page.

| Method and path | Calls | Returns (summary) |
|---|---|---|
| GET `/api/overview`, `/api/runs/:id`, `/api/flows/:id`; POST `/api/decide` | existing dashboard handlers | unchanged |
| GET `/api/doctor` | `doctor({workspace})` from `app/cli.mjs` + `detect()` | `{ok, items[{check, ok, optional, say}], agents, managed, keychain, envKeyNames, hook}` |
| GET `/api/connect` | `connectInstructions(workspace)` | `{claudeCode, codex, cursorJson, cursorLink, allowlist:{serverCommand[]}, note}` |
| GET `/api/templates` | `loadLibrary`, `catalog`, slot specs, `columns.json`, `practiceOf` | per template: title, summary, asks `{slot, question, why, harm, skip}`, defaults, data columns, usesAI, pretend rows |
| POST `/api/suggest` `{text}` | `suggest.mjs` | `{candidates[{id, title, score, matched[]}]}`; never builds |
| POST `/api/propose` `{template?, settings?, request?, answers?, flowId?}` | `app.propose` (site builder; `origin:'site-form'`) | as `propose` (+ `usesAI`) |
| POST `/api/practice` `{proposalId, ownData?:{template, sheet, rows}}` | `app.dryRun({proposalId, sheets?})` | as `dryRun` (+ `digest` per `wouldDo`, `dataSource`) |
| POST `/api/request-approval` `{proposalId}` | `app.requestApproval` | as is |
| POST `/api/run` `{flowId, input?}` | `app.run` (default `{now: new Date().toISOString()}` for library flows) | as `status` |
| POST `/api/data/preview` `{template, sheet, csv}` | `csv.mjs` | `{columns, rows: 3 sample, mapping proposal, questions[]}`; writes nothing |
| POST `/api/data/commit` `{template, sheet, csv, mapping, answers, target:'practice'|'live'}` | `data.mjs` | `{rows: n, kept: columns}` (practice: returns rows for `/api/practice`) |
| POST `/api/batch/preview` `{flowId}` | `batch.preview` | `{batchId, items[{to, subject, body, digest}], expiresAt}` |
| POST `/api/batch/approve` `{batchId}` | `batch.approve` | `{runId, made[], stoppedAt?}` |
| GET `/api/drafts`; GET `/api/drafts/:id.eml` | `drafts.mjs` | list / `message/rfc822` attachment |
| GET `/api/keys`; POST `/api/keys` `{provider, key}`; DELETE `/api/keys/:provider` | `keys.mjs`, `keychain.mjs` | `{provider, saved, last4, backend, checkedAt}`; **never the key** |
| GET/POST `/api/settings` | `settings.mjs` | settings |
| GET `/api/brief/:flowId(.md|.html)` | `brief.mjs` | attachment |
| GET `/api/evidence/:runId.json` | `evidence.mjs` | attachment |
| GET/POST `/api/org/map`; POST `/api/org/examples`; POST `/api/org/validate` | `authority-map.mjs`, `rule-examples.mjs` | map, problems[], flipped examples[] |
| POST `/api/import/n8n` `{json}` | `importN8n` | report + risk cards |
| GET `/api/claims` | `claims.json` | registry |

---

## 12. Changes to existing files (additive; `src/` untouched)

**12.1 `app/core/service.mjs`**
- `propose({…, template, settings, origin})` forwards `template`, `settings` and `origin` to `builder.build`.
- `dryRun({proposalId, input, sheets})`: for library flows, `sheets` overrides the template's practice sheets. Record `dataSource: 'template'|'your-data'` in the ledger body. Each `wouldDo` item gains `digest` (sha256 of the canonical full `{tool, args}`). Never return full bodies beyond the existing 400-char preview from this method; the batch module reads full content itself.
- `run()` refuses with `PRACTICE_ONLY` when `<ws>/settings.json` has `mode: 'practice-only'`.

**12.2 Builders**
- `TemplateFormBuilder.build({template, settings, answers, base, origin})`:
  - `resolveSlots(t, {slots: settings, notStated: unspecified}, {text, base})`. Here `text` = the settings' string values + answers when `origin === 'site-form'` (the person typed them), and `request` + answers only when `origin === 'agent'`.
  - On success: `instantiate`, then `validateStrict`, then `promises`.
  - Returns the same shape as `ModelBuilder` (`ready | needs_answers | build_failed`); `rebase` re-instantiates.
  - id: `template-form/1 (no model; the person or their agent filled the settings)`.
- `SiteBuilder` routes on `template`, and otherwise falls through to the text builder: the stub, or `WorkerBuilder` (Mercury, preview, token cap required, key read from the keychain into the child's env only).

**12.3 `app/cli.mjs`**
- New `site` command.
- `approve ID` also accepts paused-action ids: it shows To, Subject and the full text, the person must type `yes`, and it calls `decideAction(…, {channel:'cli'})`. Real terminal only, as today.
- `browserOpener` honours `FOUNDRY_URL_FILE` (tests write the URL there instead of opening a browser).
- `doctor` gains `detect()` lines. All of them are stat or PATH lookups only:
  - agents present: `claude`, `cursor`/`cursor-agent`, `codex`, `code`; `~/.claude/`, `~/.cursor/`, `~/.codex/` exist;
  - managed Claude Code policy present (the three OS paths; `FOUNDRY_MANAGED_DIR` overrides for tests). With consent, it parses only `allowedMcpServers`, `deniedMcpServers` and `allowManagedMcpServersOnly`, and reports "would Foundry's command be admitted: yes / no / unknown" by exact argv match;
  - keychain backend;
  - env **names** present (`INCEPTION_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`);
  - port 4178 free;
  - wave 2, with consent: `hooks.Elicitation` / `hooks.ElicitationResult` in `~/.claude/settings.json` or `./.claude/settings.json` (keys only).
- Never read: `~/.claude.json`, credential stores, `.env` values. Never run `claude mcp list`, which connects to servers [docs].

**12.4 `app/mcp/server.mjs`**
- Wave 1: `list_templates` (read-only: catalog, slot asks with why, defaults, data columns). `propose_flow` accepts optional `template` and `settings` (strings, numbers and booleans by the slot schema). The unsupported reply says: "Call list_templates, pick the closest, and fill its settings from the person's words."
- Wave 2:
  - `run_flow` with elicitation shows one batch dialog listing every planned item in full (same `batch.mjs`);
  - action decisions by dialog use `channel:'mcp-elicitation'`;
  - if doctor saw an Elicitation hook, `approve` and batch skip the dialog and open the browser, with `say` = "Your Claude Code has a hook that could answer for you, so Foundry asks in your browser instead."

**12.5 `app/dashboard/browser-check.mjs`**
- Add `await` to both `app.propose` calls (K14).

---

## 13. Visual design system

**13.1 Tokens** (`:root`). All ratios were computed today. Light values are on `--bg`, `--surface` and `--surface-2`.

| Token | Light | Dark | Use / contrast |
|---|---|---|---|
| `--bg` | `#fbfbfa` | `#161615` | page |
| `--surface` | `#ffffff` | `#20201e` | cards |
| `--surface-2` | `#f2f1ec` | `#2a2a27` | inset, code, pretend data |
| `--fg` | `#1d1d1b` | `#ecebe6` | text, 14.9 to 16.9 : 1 |
| `--muted` | `#5c5a54` | `#a9a7a0` | secondary text, ≥ 5.98 : 1 |
| `--line` | `#dcd9d2` | `#3a3936` | decorative dividers only |
| `--line-strong` | `#858279` | `#85827a` | input and control borders, ≥ 3.71 : 1 (WCAG 1.4.11) |
| `--accent` | `#2a56c6` | `#8fb0ff` | links, primary; text on accent `#fff` / `#10131a` ≥ 6.47 : 1 |
| `--ok` | `#1f7a3d` | `#5cc37f` | ticks, "Works now", ≥ 4.75 : 1 |
| `--bad` | `#b42318` | `#ff8a7e` | crosses, errors, ≥ 5.81 : 1 |
| `--wait` | `#855600` | `#e2b04a` | waiting, "Preview", ≥ 5.58 : 1 |
| `--paid` | `#5b3fb5` | `#b9a6ff` | Team plan badge, ≥ 6.58 : 1 |
| `--practice` | `#0b6870` | `#5fd0d6` | pretend data / test results, ≥ 5.75 : 1 |
| `--focus` | = accent | = accent | 3 px outline + 2 px offset |

**Theme switching.** Dark values apply under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` and under `:root[data-theme="dark"]`. A Light / Dark / Auto toggle in Settings is stored in `localStorage` inside try/catch, and the page works without it. Status is never shown by colour alone: there is always a word plus an icon (✓ ✗ ⏸).

**13.2 Type and space**
- Fonts: system-ui stack only, no web fonts.
- Body 17 px/1.55 on operator pages and 16 px on app tables. Scale 14 / 16 / 17 / 20 / 24 / 32.
- Line length ≤ 68ch.
- Spacing scale 4 / 8 / 12 / 16 / 24 / 32 / 48.
- Radius 10 px on cards, 8 px on controls.

**13.3 Layout and responsiveness**
- Wizard column max 720 px; app pages max 1040 px; 16 px side gutter.
- Breakpoints 390 / 768 / 1100. No horizontal scroll at 320 px (WCAG 1.4.10).
- Below 768 px the nav becomes a **Menu** text button (a disclosure).
- Approval and turn-on buttons stack full width on phones.
- No sticky element covers focus (2.4.11).

**13.4 Components** (each with keyboard behaviour and an `aria` contract)

| Component | Contract |
|---|---|
| Card | heading + summary + chips + one primary action |
| AskField | label = question; `aria-describedby` → why + skip; `data-ask` = harm class |
| Defaults | editable chips |
| Restatement | editable; "I understood" |
| WillCard | It will / It won't / Done means / Uses AI / Where data goes / Who decides |
| CheckList | `<ul>`; ✓/✗ + word + "How" |
| ApprovalCard | `<article aria-labelledby>`; full text in `<pre>`; two buttons ≥ 44 × 44 px, 16 px apart |
| BatchCard | ordered list, every item in full; count in the button label |
| StatusChip | Works now / Preview / Planned / Not decided; Planned always has a "What you can do today" link |
| PaidBadge | "Team plan" `<button aria-expanded>` disclosure with the one-paragraph explanation; never a modal |
| DropZone | a real `<input type=file>` button; drag is optional (2.5.7) |
| ColumnMapper | `<select>` per needed column, with sample values |
| KeyEntry | `type=password`, `autocomplete=off`, paste allowed (3.3.8); value cleared from the DOM after the response |
| Snippet | `<pre>` + Copy button with a "Copied" `role=status` toast |
| Stepper | "Step 2 of 4: Test", text and `aria-current` |
| ErrorPanel | the four parts |
| Dialog | native `<dialog>`, focus trap, Escape closes, focus returns |
| LiveRegion | one polite region for progress; one assertive region for errors only |

---

## 14. Accessibility (WCAG 2.2 AA) requirements

**Every view:**
- one `<h1>`; landmarks `header`, `nav` and `main`;
- a "Skip to content" link;
- `lang="en"`;
- visible labels;
- no positive tabindex.

**Route changes:** focus moves to the new `<h1>` (`tabindex=-1`) and the document title updates ("Test passed · Foundry").

**Long-running states:**
- the test, batch and import states announce start and end in the polite live region;
- buttons show `aria-busy` while running;
- no time limits.

**Criteria with specific requirements:**
- **2.5.8 target size:** all targets ≥ 24 × 24 px; approve and decline ≥ 44 × 44 px with a gap.
- **3.3.7 redundant entry:** an address given once is never asked again in the same process, and it is prefilled on new versions.
- **3.3.8 accessible authentication:** no login on the free path; key fields allow paste.
- **3.2.6 consistent help:** Help sits in the same header position on every page.
- **Motion:** `prefers-reduced-motion` turns off all transitions (≤ 150 ms opacity otherwise).

**Automated checks:**
- axe-core on every journey step in both themes, with 0 serious or critical. This needs a pinned devDependency (O-F). Until the owner approves it, the fallback is a Playwright check of the six most common WebAIM errors: contrast via token tests, missing labels, empty links, empty buttons, missing `lang`, and missing alt text on SVG `role=img`.
- `ariaSnapshot` of `main` saved per step.
- A keyboard-only P2 run.

---

## 15. Security requirements (each is a test)

1. The CSP equals the dashboard's (`default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; …`). No inline style attributes and no inline scripts.
2. A grep test forbids `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` and `new Function` in `app/site/public/**`. Workspace and model text is rendered with `textContent` only.
3. Host check and token on all `/api/*`; POST requires `application/json`; size caps.
4. **Canary key.** With the `ephemeral` keychain, store `CANARY-…`, then run a build (scripted worker), a test, a run, the brief, evidence and every GET. Assert the canary appears in no response body, log line, journal row, DOM text or MCP output.
5. **Keychain secrets never in argv or env of non-builder processes:**
   - macOS: `security -i` with the command on stdin;
   - Linux: `secret-tool store … ` with the secret on stdin;
   - Windows: PowerShell with the secret on stdin (untested, Preview).
   - Keys are validated to `[A-Za-z0-9_\-.]{16,256}` before any backend call.
   - With no backend: refuse, and **never** fall back to a file.
6. The key-check base URL comes from `policy/models.json` (the Inception provider entry). A test override is accepted only for `http://127.0.0.1:*`.
7. Batch rules (§7.5).
8. Journeys abort and fail on any request to a host other than 127.0.0.1.
9. No endpoint writes any coding agent's config (connect prints only).
10. Practice-only mode refuses `app.run` from the site, CLI and MCP alike (it is in the service).
11. The trust copy for the same-user boundary must stay on the page: test for its presence.

---

## 16. Playwright journeys

**Harness** (`app/site/test/journeys/harness.mjs`):
- temp workspace; site in-process with the `ephemeral` keychain; a scripted model port for any AI path ($0, no real model call);
- Chromium at `PW_CHROMIUM` (default `/opt/pw-browsers/chromium`);
- a `person` wrapper whose `click`, `fill`, `choose`, `upload` and `key` calls increment `steps` and increment `asks` when the target or its form carries `data-ask`.

**After every person action and every settled state, it captures:**
- a screenshot to `$FOUNDRY_SHOTS/<journey>/<NN>-<slug>-<theme>-<width>.png` (default `/var/tmp/foundry-work/onboarding-20261021/shots/`; binaries are not committed);
- `ariaSnapshot` text;
- axe results;
- console errors, page errors, failed requests and external requests;
- focus target;
- time.

**Output:** a summary appended to `research/onboarding-20261021/JOURNEYS.json`, recording journey, steps, asks, milestones, timings, errors and axe counts. It is labelled "development, scripted, no users".

| Journey | Viewport / theme / input | Steps (screenshot at each) | Milestone budgets |
|---|---|---|---|
| **P1-CC** | 1280 light; MCP SDK `Client` over stdio spawning the exact argv parsed from `GET /api/connect` `claudeCode` (asserts the printed line parses to the spawned argv); client declares form elicitation; the harness plays the human | 01 connect page · 02 "paste" (spawn) · 03 request → `list_templates` → `propose_flow` → `dry_run`, transcript rendered to `transcript.html` and screenshotted · 04 elicitation accept · 05 `run_flow` → browser via `FOUNDRY_URL_FILE` → `#/waiting` batch card · 06 drafts | first verified ≤ 2 person actions, 0 asks; first live ≤ 4 actions, ≤ 2 asks |
| P1-CC-ungrounded | same | agent fills `summaryTo` the person never wrote → `needs_answers` → relayed → answered | +1 ask; refusal asserted |
| **P1-Cursor/Codex** | 1280 | connect page; Cursor link base64 decodes to `cursorJson`; Codex line parses; client **without** elicitation → `approve` returns `awaiting_human` → browser yes card | first live ≤ 5 actions |
| **P2-invoice** | 1280 light; 390 dark; keyboard-only at 1280 | as §7.1, steps 1–8, then drafts: `mailto:` and `.eml` (`X-Unsent: 1`, To and Subject match) | first verified ≤ 3 / ≤ 1 ask; first live ≤ 8 / ≤ 4 asks; 0 accounts, keys, connections |
| P2-own-data | 1280 | checked → **Test with my own list** → upload → date-order ask → test on your data ("Tested on: your list") | ≤ 7 actions, ≤ 3 asks |
| **P2-edges** | 390 light | (a) box "book me a flight to Lisbon" → no match, nothing created, cards shown → pick a card · (b) box "remind customers who haven't paid" → suggestion → Use this · (c) failing test (fixture: a CSV with all invoices paid → 0 reminders, checks still pass, copy "Nothing to chase") · (d) unknown status values → ask | no dead end; nothing created on (a) |
| **P3-expense** | 1280 light; 390 dark | as §7.3; then the Team plan option → disclosure open (screenshot) → **Keep going free** | first verified ≤ 4 / ≤ 2 asks; badge present only at the decider field; no modal |
| **P4-IT** | 1280 | fixture managed dir → doctor card → flow → **Get a brief for IT** → brief (asserts workflow hash, `serverCommand` argv equal to `connectInstructions`, "Pilot terms") → download → Settings practice-only → **Run** refused in plain words → Trust page | brief ≤ 2 actions; practice-only 1 |
| **P5-auditor** | 1280 | runs → run → "Record checked" → evidence download (asserts chain head, ledger rows with channel, gaps section) | ≤ 3 actions |
| **ORG** | 1280 light; 390 dark | #/org → Small team → add 2 people → money-out row €250 / Finance (badge) → rule → 6 examples → confirm → Preview → save v1 (bootstrap banner) → expense card with 2000 → refused "Set by" → change T to 300 → one example flips → save blocked → re-confirm → v2 saved | ≤ 12 actions to v1; flip blocks save |
| **KEYS** | 1280 | `FOUNDRY_KEYCHAIN=none` → refusal copy; then `ephemeral` → paste canary → check against a loopback fake provider → "ending …" → assert the canary is absent from DOM, network bodies and logs | — |
| **IMPORT** (wave 2) | 1280 | drop `n8n-synthetic.json` → verdicts + risk card | nothing executed |
| **CRAWL** | 1280 + 390 | every route × state fixtures (empty; draft; tested; on; waiting action; waiting batch; failed run; no keychain; practice-only; org v1) | §17.2 |

---

## 17. Acceptance criteria

**17.1 Steps and asks** (measured by the journeys; budgets as in §16; any overrun fails)
- **P2:** first verified ≤ 3 actions / ≤ 1 ask / 0 accounts, keys and connections; first live ≤ 8 / ≤ 4.
- **P1:** first verified ≤ 2 / 0 after the setup paste; first live ≤ 4 / ≤ 2. Report separately that a real Claude Code adds its own permission prompt (unverified).
- **P3:** ≤ 4 / ≤ 2.
- **P4:** brief ≤ 2.
- **P5:** evidence ≤ 3.
- Baselines reported beside each: the spike's 3 person actions (DESIGN §8.3) for P1; "no path without a terminal and MCP" for P2.

**17.2 Zero dead ends** (crawl)
- Every view has an `<h1>`, the header nav and Help.
- Every view has at least one enabled forward action, or is a declared terminal with **Back to home**.
- Every internal link resolves to a registered route.
- Every `[data-status=planned]` has a `[data-instead]` link to a working path.
- Every error panel has a "What to do" action.
- The not-found view is never reached from an internal link.

**17.3 Every claim traceable**
- Every `{claim:Cxx}` exists in `claims.json`.
- Every source path exists under `research/`.
- Every number in a claim appears verbatim (after removing thousands separators) in the source file.
- Every claim carries an evidence label (development / design / decided / documentation, dated).
- Copy lint fails on any digit outside claim spans, API-rendered data or the UI-chrome allowlist.
- Copy lint fails on these phrases: "works with Gmail", "set it and forget it", "runs automatically", "SOC 2", "enterprise-grade", "for anyone", "beats", "guarantee", "fully secure", "Maria approved".

**Initial claims registry:**

| Id | Claim (short) | Status | Source |
|---|---|---|---|
| C01 | Nothing runs, sends or changes until you say yes; the limit: an agent with a shell running as you | Works now + limit | `research/surface-20261021/DESIGN.md` §6.4, §8.3 |
| C02 | 10 of 10 ways around the yes refused in tests | Works now (dev) | DESIGN §8.3 |
| C03 | Tests use pretend data; nothing real is sent | Works now | DESIGN §2, §8.4 |
| C04 | 14 of 14 for $0.39 vs 5 of 14 for $7.63 | dev, one family | `research/enterprise-20261014/B1-E8-DEV.md` lines 174–176 |
| C05 | Low-cost AI + Foundry's procedure 18 of 60 for $0.94 vs a stronger AI alone 20 of 60 for $6.03 | dev, public dev tasks, one run each | `research/automationbench-20261014/runs/DEV60-A0-A1.md` lines 109–110, 124 |
| C06 | n8n: 2 of 10 came over exactly; 10 of 10 can be called; 0 run | Preview | `research/surface-20261021/n8n-import-results.json` |
| C07 | In a simulated company, a build that passed its process check applied 57 of 57 large refunds without approval; with the rule layer, 0; the auditor answered 0 of 10 vs 10 of 10 | test bed only, not in the product | `research/org-20261021/README.md` |
| C08 | Free/paid line | Decided | `research/decisions-20261021.md` D2 |
| C09 | Local only, nothing published | Decided | D10, D13 |
| C10 | Keys in your keychain | Decided; Preview | D11 |
| C11 | People approve almost every single prompt but reject plans more often (97%; 39% vs 3%) | literature/vendor | `research/onboarding-20261021/sweeps/research-literature.md` §1 |
| C12 | Spike: 3 person actions request → first live | dev | DESIGN §8.3 |
| C13 | Linux tested; macOS and Windows untested; code steps refused there | — | DESIGN §6.3 |
| C14 | Decisions and transcripts not yet in the chain; anchor optional | gap | `research/onboarding-20261021/sweeps/repo-surface.md` §6 item 9 |

**17.4 Quality gates**
- 0 console or page errors on every journey.
- 0 external requests.
- axe 0 serious or critical (or the fallback checks) in both themes.
- No horizontal scroll at 320 and 390 px.
- Keyboard-only P2 completes.
- Focus lands on `<h1>` after each route change.
- The canary test passes.
- The existing 34 app tests pass.
- The new unit tests pass (`node --test app/site/test/*.test.mjs app/onboarding/test/*.test.mjs`).
- `browser-check.mjs` runs clean.

**17.5 Honesty**
- Every feature that is not "Works now" shows its chip.
- No page says or implies that an e-mail recipient approved anything.
- The same-user limit is on `#/trust` and in every IT brief.

---

## 18. Build order

| Wave | Contents | Done when |
|---|---|---|
| 0 | Copy the sweeps, concepts and judgments plus this spec into `research/onboarding-20261021/`; fix `browser-check.mjs`; `claims.json` skeleton | files present; browser-check passes |
| 1 (the spine, real) | site server + shell + design system; doctor/connect/templates/suggest/propose/practice/request-approval/run endpoints; form and site builders; make, checked, turn-on, go-live (CSV + mapping), batch, drafts, waiting, automations, runs (ported); connections (static + live statuses); pricing, trust, docs, glossary, help; CLI `site` + `approve` for actions; MCP `list_templates` + template/settings; service additions (§12.1) | journeys P1-CC, P1-Cursor/Codex, P2-*, P3, P5, CRAWL pass; §17 gates |
| 2 (org, IT, keys, import) | keychain + keys + Mercury worker (Preview); practice-only mode; detect (managed, hook); IT brief; evidence bundle; Who decides what (map v1, examples, proposal check, v0 export); n8n drop + risk card; browser pop-up; `.ics` reminder; MCP batch dialog + hook fallback; local launchers | P4, ORG, KEYS, IMPORT pass; v0 export validates with `docProblems` |
| 3 (shown as Planned only) | webhook/Gmail/SMTP connectors, scheduler, second-person approvals, hosted Team plan, SSO/SCIM, plugin from a local marketplace, Zapier/Make/GitHub Actions importers, developer `inventory` tool, Anthropic/OpenRouter BYOK, money-summary template | Planned chips + "What you can do today" links |

---

## 19. Owner decisions (each reversible)

| Id | Decision | Recommended | Why |
|---|---|---|---|
| O-A | An Anthropic API-key provider kind in `policy/models.json` for BYOK Haiku 5.5 | add | Model ids must come from policy; `claude-cli` rides a CLI login, which the product must not use |
| O-B | L5 managed broker (zero-config Gmail): free or paid | free connection; the hosting cost is a separate question | D2 says connections are never paid |
| O-C | SCIM, stop-all, SIEM export free | SCIM and stop-all free; SIEM free export of local records | IT judge and buyer; a security floor |
| O-D | Distribute a launcher or plugin | not now (D13); build and run locally | publishing boundary |
| O-E | Pricing unit | per deciding seat + verified packs; no prices yet | concept 3, buyer |
| O-F | `axe-core` as an exact-pinned devDependency | add | WCAG checks in CI |
| O-G | Managed-policy detection forces practice-only | offer, don't force | avoids blocking personal use on work laptops; revisit with IT feedback |
| O-H | Adopt `authority-map-v1` | adopt as a proposal | v0 is E8-specific (K11) |
| O-I | Frontier-author a "money summary" template (paid, owed, overdue, top debtors) | yes | the non-technical owner's second job has no template |
| O-J | Batch approval of an exact displayed list (§7.5) | approve for drafts (L0) first | it widens one click → one action to one click → one exact list |

---

## 20. Risks, unknowns and the cheap tests that should follow

**Risks and unknowns:**
- No user has seen any of this.
- Every step count is scripted development evidence.
- The real Claude Code, Cursor and Codex behaviour (trust prompts, elicitation rendering) is unverified.
- macOS and Windows keychains and launchers are untested.
- Headless Linux usually has no Secret Service, so keys are refused (by design).
- The same-user boundary remains.
- Running two Foundry processes on one workspace is guarded only by the lock file.

**Most dangerous assumptions, with the cheapest tests (from the UX critic, kept as follow-ups):**
1. **Do real requests fall inside the 7 templates?** Freeze 50 or more public "I want to automate X" posts and classify them offline at $0. Then run 5 moderated sessions on recovery after "I can't make that yet".
2. **Can non-technical people install it?** Give 3 people today's instructions. Expected result: the launcher is the real blocker.
3. **Do rule owners check the six examples?** Plant one wrong example and give it to 5 finance or ops people.
4. **Does the batch card get rubber-stamped?** Seed one bad draft among 30 and measure the catch rate.
5. **Do people catch the "Can't come over" reasons in import reports?** Rerun `importN8n` on 30–50 more non-AI-agent open-licence exports.

---

## 21. Sources

**Repo files read today:**
- `/home/user/workflow-foundry/app/core/service.mjs`
- `/home/user/workflow-foundry/app/cli.mjs`
- `/home/user/workflow-foundry/app/mcp/server.mjs`
- `/home/user/workflow-foundry/app/dashboard/server.mjs`
- `/home/user/workflow-foundry/app/dashboard/dashboard.css`
- `/home/user/workflow-foundry/app/dashboard/browser-check.mjs`
- `/home/user/workflow-foundry/app/core/library.mjs`
- `/home/user/workflow-foundry/app/core/builder-model.mjs`
- `/home/user/workflow-foundry/app/core/explain.mjs`
- `/home/user/workflow-foundry/app/core/templates/*.json`
- `/home/user/workflow-foundry/app/importers/n8n.mjs` (exports)
- `/home/user/workflow-foundry/experiments/constitution/schema/constitution-v0.schema.json`
- `/home/user/workflow-foundry/experiments/constitution/constitution.mjs`
- `/home/user/workflow-foundry/experiments/constitution/instances/v1.json`
- `/home/user/workflow-foundry/research/decisions-20261021.md`
- `/home/user/workflow-foundry/research/surface-20261021/DESIGN.md`
- `/home/user/workflow-foundry/research/surface-20261021/TEARDOWN.md` (§0)
- `/home/user/workflow-foundry/research/surface-20261021/n8n-import-results.json`
- `/home/user/workflow-foundry/docs/RESEARCH.md` (lines 122–125)
- `/home/user/workflow-foundry/research/automationbench-20261014/runs/DEV60-A0-A1.md`
- `/home/user/workflow-foundry/research/enterprise-20261014/B1-E8-DEV.md`
- `/home/user/workflow-foundry/research/org-20261021/README.md`
- `/home/user/workflow-foundry/policy/models.json`

**Sweep notes**, to be copied into `research/onboarding-20261021/sweeps/` in wave 0. They live in `/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/onboard/`:
- `repo-surface.md`
- `connection-ux.md`
- `research-literature.md`
- `automation-products.md`
- `developer-tools.md`
- `org-enterprise.md`

**Docs read today (2026-10-21):**
- https://code.claude.com/docs/en/managed-mcp
- https://code.claude.com/docs/en/hooks (first 100k characters)

All other external facts are carried, with their own URLs and dates, from the three concepts and the five judgments supplied in the task.

**Probe scripts (scratchpad, not repo):**
- `/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/probe/batch.mjs`
- `/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/probe/contrast.mjs`
