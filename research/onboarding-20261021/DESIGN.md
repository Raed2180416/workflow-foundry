# Workflow Foundry onboarding site: design rationale, what was built, and what it shows (2026-10-21)

The build follows `SPEC.md` (saved verbatim from the task). The research behind it is in `TEARDOWN.md` and `sweeps/`. The measured
journeys are in `JOURNEYS.md`, `JOURNEYS.json` and `shots/`. Everything here is **development evidence: scripted, no users, $0, no
model call, nothing published, nothing sent off this computer.**

## 1. The design in one page

The owner asked for onboarding "seamless and super intuitive to even the dumbest human being on the planet", where "the system owns
all plumbing" and the result "ties into all these complex workflows that people already have". The design answers with one path
and four doors.

**The path (every persona ends on it):**
1. Show what Foundry can make before asking for words. The home page has seven plain-word cards, made from frontier-written templates.
2. Ask only what a wrong guess would make harmful, and say why ("Why Foundry asks", "If you skip").
3. Test on pretend data. Nothing real is sent.
4. Show what Foundry checked, next to "What a test can't prove", with the way to turn it on in the first screen.
5. One yes for this exact version. It can be turned off on its page; turning it on again is a new yes.
6. The person's own list, as the CSV export they already have.
7. One yes for the exact list of what the run would make, every item in full.
8. Drafts the person sends from their own mail app.

There are no accounts, no keys and no connections on this path.

**The four doors:**

| Door | For | Entry | Joins the path at |
|---|---|---|---|
| Cards and the box | the operator (P2) and the team lead (P3) | `#/`; the box only *suggests* a card (keywords, $0) | step 1 |
| A coding agent | the developer (P1) | one pasted line (`claude mcp add ...`, `codex mcp add ...`, a Cursor install link); the agent calls `list_templates` then `propose_flow` with the card and the person's words | step 3; the yes is in the agent's dialog or in the page; the list is decided in the page |
| An n8n export | anyone with existing automations | `#/import`: a verdict per step and a risk card; runs nothing (Preview) | a matching card |
| IT and audit | IT (P4) and auditors (P5) | the managed-policy notice on `#/`, the IT brief, practice-only mode, the Trust page, `#/runs` and the evidence file | after the path |

**Organisations** come in through one question asked at the one field it applies to ("Who decides the bigger ones?"), plus a free
document tool, "Who decides what". The Team plan (a second authority with its own sign-in) is a disclosure at that field. It is
never a wall or a modal, and it is never about size.

## 2. Why each choice (evidence in TEARDOWN.md; labels as there)

| Choice | Why | Evidence |
|---|---|---|
| Cards before the box; the box never builds from a guess | People cannot tell what an automation cannot do (Ur 2014: 26% skipped the impossible task). A free-text box over-promises | TEARDOWN §1.5 [R] |
| A test on pretend data before anything is turned on | Elsewhere a test usually does the real thing ("the email will actually get sent"); a stand-in world is a real gap and removes the cold start | §1.2 [doc] |
| First live effect = drafts (mailto and `.eml` with `X-Unsent: 1`) | Connections are the hard part, and Gmail has no honest zero-config path for a local product (an unverified client means re-authorising every 7 days) | §1.3, §2.3 [doc] |
| One yes per version, then one yes per exact displayed list | Per-action approvals decay into rubber-stamping (Anthropic: 97% of prompts approved; plans rejected 39% vs 3%) | §1.4 [V] |
| Asks only where a guess harms, each tagged with a harm class | Horvitz 1999; surveys that change nothing are the most criticised onboarding element | §1.6 [R][3p] |
| Dates, decimals and unknown statuses asked, never guessed | Read wrong, an accounting export's dates move invoices by months (the fixture is built so that month-first reading sends a final notice to an invoice that is not due) | `app/site/test/fixtures/README.md` |
| An agent's address must come from the person's words | Ungrounded targets are the most harmful guess (R3); the P1-ungrounded journey shows the refusal | SPEC R3; `JOURNEYS.md` p1-ungrounded |
| One pasted line per agent; Foundry writes no agent config | Developer onboarding is "one line, one approval"; the person's agent shows its own trust prompt | §1.8, §2.4 [re-read] |
| `approve` is marked `anthropic/requiresUserInteraction` | Claude Code shows that tool's prompt "on every call", even in auto and bypass modes | §2.4 [re-read] |
| Keys: keychain or nowhere; the page never sees a key again | MCP forbids collecting keys in form mode; Anthropic forbids routing users' subscriptions | §1.9 [doc] |
| "Who decides what" with Set-by chips, six examples per rule and flip detection | Buyers know layered rules (Inherited / Locally applied), force levels and Evaluate-before-Active; rules confirmed by example | §2.5 [doc] |
| IT brief, practice-only mode, managed-policy notice | IT needs artefacts before saying yes; 70% want to test in their own environment | §2.5 [3p] |
| Status chips (Works now / Preview / Planned), each Planned item with "What you can do today" | Honesty is the trust strategy; R7 | SPEC R7 |
| Claims registry with sources, and a copy lint that bans numbers outside claims | "Never claim commercial parity from local fixtures" (AGENTS.md) | `app/site/claims.json`, `copy-lint.test.mjs` |

## 3. What was measured (development, scripted, no users)

Steps are every person action: clicks, fills, choices, uploads and keys, plus actions outside the browser such as pasting a line,
typing to an agent or answering its dialog. Asks are actions on a control carrying `data-ask`, meaning a question whose wrong
answer harms or an irreversible yes. Times are the harness's wall-clock on a shared container, not human time.

| Persona journey | Variant | First verified (steps / asks / time) | First live (steps / asks / time) | Budget (spec) | Result |
|---|---|---|---|---|---|
| P2 operator: chase unpaid invoices | 1280 light | 3 / 1 / 3.0 s | 8 / 4 / 7.1 s | ≤ 3 / 1; ≤ 8 / 4 | pass |
| P2 operator | 390 dark | 3 / 1 / 2.5 s | 8 / 4 / 6.3 s | same | pass |
| P2 operator | keyboard only, 1280 | 3 / 1 / 2.5 s | 8 / 4 / 6.0 s | same | pass |
| P2 own data (test on my list) | 1280 | own-list test: 7 / 3 / 4.1 s | — | ≤ 7 / 3 | pass |
| P2 edges (no match, suggestion, nothing to chase, unknown statuses) | 390 light | — | — | no dead end; nothing made on (a) | pass |
| P3 team lead: approve small expenses | 1280 light | 4 / 2 / 4.2 s | turned on: 9 / 4 / 6.3 s | ≤ 4 / 2 | pass |
| P3 team lead | 390 dark | 4 / 2 / 2.2 s | turned on: 9 / 4 / 3.6 s | same | pass |
| P1 Claude Code (stdio MCP, form elicitation) | 1280 | setup 2 / 0; then **1 / 0** (3.4 s from start) | then **3 / 1** (7.6 s) | ≤ 2 / 0; ≤ 4 / 2 after setup | pass |
| P1 agent guessed an address | 1280 | setup 2 / 0; then **2 / 1** (4.4 s) | — | +1 ask; nothing made before the answer | pass |
| P1 Cursor or Codex path (a scripted client that offers no dialog; Cursor and Codex both document one) | 1280 | setup 2 / 0; then 1 / 0 (4.2 s) | then **5 / 1** (12.7 s) | ≤ 5 after setup | pass |
| P4 IT | 1280 | brief: 2 actions; practice-only: 1 | a test on the real list, nothing made (was: a refused run) | ≤ 2; 1 | pass |
| P4 policy file (added after the walkthroughs) | 1280 | Settings locked by the organisation; the API refuses | — | locked | pass |
| P5 auditor | 1280 | evidence file: 3 actions | — | ≤ 3 | pass |
| ORG: who decides what | 1280 light, 390 dark | version 1: 12 actions, 1 ask (+1: currency) | flip blocks the save; version 2 at 21 actions | ≤ 12 to v1 | pass |
| P2 next day; P3 refunds (added after the walkthroughs) | 1280 | — | bookmark opens; no repeated reminder; refunds export without receipts; approver's answer recorded | no dead end | pass |
| KEYS (none; keychain with a canary key) | 1280 | — | — | key absent from page, responses, files, log | pass |
| IMPORT (n8n export) | 1280 | — | — | nothing made or run | pass |
| CRAWL: 10 states × 1280 and 390 (and 320 for sideways scroll) | — | 33 to 39 pages per state, every internal link followed | — | §17.2 | pass, 0 problems |

Totals after the persona walkthrough fixes:

- 30 journey tests in 9 files, all passing;
- 171 screenshots, 22.6 MB (budget 25 MB);
- 0 console or page errors, 0 external requests and 0 fallback accessibility issues;
- 104 unit tests under `app/`, all passing.

The times in the rows above are from the first build. The current per-journey numbers are in
[WALKTHROUGH.md](WALKTHROUGH.md) §5 and [JOURNEYS.md](JOURNEYS.md). What changed after the walkthroughs, and what was declined, is
in [WALKTHROUGH.md](WALKTHROUGH.md).

**Baselines beside these numbers:**
- **P1:** the surface spike's 3 person actions from request to first live (DESIGN §8.3, claim C12). The P1 Claude Code journey is 3 actions after setup, with the list in place.
- **P2:** "no path without a terminal and MCP". Before this site, an operator had no way in at all.
- **Other products:** their counts in TEARDOWN §2.1 are documentation readings, not timed runs, so they are not a like-for-like baseline.

**What the counts leave out (UX review of 2026-10-21, M9).** Every budget passes, but most milestones pass exactly at their limit:
P2 first verified (3 / 1) and first live (8 / 4), the P2 own-list test (7 / 3), P3 first verified (4 / 2), the P4 brief (2) and
practice-only (1), the P5 evidence file (3), ORG to version 1 (12) and the P1 Cursor or Codex path after setup (5). Steps and asks
also leave out costs a person still pays. Since the review the journeys measure them beside the counts ([JOURNEYS.md](JOURNEYS.md)):

| Cost | P2 first verified | P2 first live | How it is measured |
|---|---|---|---|
| Tab presses (keyboard run, 1280) | 16 | 32 | pressed by the keyboard-only journey; pointer runs report an estimate |
| Scrolling, in window heights | 0.74 at 1280; 1.66 at 390 | 3.71 at 1280 (3.77 in the keyboard run); 7.87 at 390 | how far below what the person had already scrolled to each control was; a scroll the script makes is not credited |
| Decisions | 0 | 2 (turn on; the exact list) | presses on a decision card; turning on is not an ask (§4.1, O-K); counted as one, first live is 8 / 5, over its ≤ 4 asks |

- **Install and start.** For P2 these are a precondition, done today by someone technical (Quickstart, "I don't code"). They are
  listed in the journey, not counted.
- **P1 is counted after the one-time setup** (§4.2). The spec's P1 rows (SPEC §16) do not say "after setup". Counted from the start,
  P1 Claude Code is 3 / 0 to first verified and 5 / 1 to first live (budgets ≤ 2 / 0 and ≤ 4 / 2), and the Cursor or Codex path is
  7 / 1 to first live (budget ≤ 5). Counted that way, all three are over budget.
- **A released Claude Code's own prompts** (its trust prompt for a new server, its permission prompt before `ask_person_to_turn_on`)
  were not run and are not counted (§6).
- **Weekly use.** The next week's run (journey `p2-next-day`) is 7 actions, one of them running the open command in a terminal, and
  1 ask. It was 8 and 2: the date order is no longer asked again for the same export (m4).

## 4. Departures from the spec, and why

1. **Turning on is a step, not an ask.**
   - The spec's matrix calls turn-on A5 an ask. Its P2 budget (≤ 4 asks to first live) only adds up without A5 or without the conditional date question A6b. The reference fixture is ambiguous on purpose, so A6b is asked.
   - Turning on makes and sends nothing, so it is neither a harmful guess nor irreversible. The site marks it as a decision, not a `data-ask` control, in the page and in the agent's dialog alike.
   - Counting it anyway: P2 first live would be 8 actions and 5 asks; P1 Claude Code, 3 and 2; P3 is unchanged up to first verified.
   - Owner decision O-K below.
2. **P1 counts the invoice list in place as a precondition.** The spec's P1 table has no data step. The agent path cannot drop a file for the person. The journeys report the precondition ("dropped once before, as in P2") and count from the end of the one-time setup paste.
3. **`mcp --dashboard` on a live lock points to the open window rather than refusing.**
   - The spec (§11) refuses a second start.
   - The coding agent starts the MCP server, not the person, so a refusal would break the agent's session.
   - The MCP server serves no second page; its tool results say "the Foundry window you already have open". `site` still refuses on a live lock.
4. **Screenshots are JPEG, quality 70, committed under `research/onboarding-20261021/shots/<journey>/NN-<step>[-variant].jpg`.**
   - The task asked for this location and the 25 MB cap. The spec suggested PNG in `/var/tmp`.
   - Keyboard runs capture the viewport, where the focus is.
   - Crawl pages are viewport-only, quality 50, and only for the "on" state and state-specific pages.
5. **Fallback accessibility checks instead of axe-core.** axe-core is owner decision O-F and is not added. The harness checks:
   - language, labels and empty links or buttons;
   - one `h1` in `main`;
   - landmarks, the skip link and positive tabindex;
   - Help present;
   - sideways scroll;
   - target size of at least 24 px.
   The colour tokens are checked against WCAG ratios by a unit test.
6. **The P3 "What Foundry checked" sentence is generic.** It reads "1 e-mail to maria@example.com and 3 row(s) added to expense-decisions", built from the test's counts. The spec's wording is "2 claims approved on their own (under €100) ... listing 2 claims to decide". It needs a per-card summary sentence: a small follow-up, not a mechanism.
7. **Additions not in the spec, found by the journeys:**
   - **An address turns on the part it belongs to.** "Summary to me@..." turns the summary on (`form-builder.mjs`). Without this, an agent's guessed address was dropped silently with the summary, and the person's own "summary to me" lost the summary.
   - **A test on the person's own list runs as of today.** It used to run as of the card's pretend date and showed 2 reminders where the live list makes 3.
   - **A Settings link in the footer.**
   - **With `--consent`, the MCP server skips the client's dialog** when a local hook could answer it (spec K12 said the doctor detects the hook, but nothing acted on it). Since the security review (H3, 2026-10-21): without `--consent` the dialog is not used at all, and with it the check covers every hook location and runs on every ask (WALKTHROUGH M7).
8. **Where the honesty review of 2026-10-21 overrode the spec's wording** (the spec, `SPEC.md`, is kept as received):
   - C06 and the import report: "2 of 10 came over exactly; 10 of 10 can be called as they are" became "2 translated into Foundry steps without errors, 8 refused with reasons, calling them in n8n designed but not built, 0 run". A lowered flow's connector steps have no host adapter, and nothing in the site can configure the n8n wrapper.
   - Codex: "has no documented dialog" was wrong (see §6). The browser path stays, for the reason given there.
   - Pricing: "Free, always" and "We never charge by size" overstated decision D2, which is reversible and sets no price; "We think the first two should be" was a research recommendation, not the owner's decision.
   - Claims: research results (C04, C05, C07) and literature (C11) have their own statuses, not "Works now"; C02 is "Not re-tested"; a claim shows its status and qualifier wherever a page uses it.
   - The evidence file (B1): `check-evidence` now checks who decided, the list and its fingerprint, and the turn-on history against the hashed decision log and run events, and names what it did not check. Each decision-log line's link commits to its automation, so a line left out of the file is found.
   - What leaves the computer (M7): the AI-key check (one `GET <provider>/models` with the key) is listed on the Trust page and in the IT brief, and refused unless Allowed AI includes that provider. The token cap is per build and fixed at start; there is no daily limit (M8).
   - The coding agent's dialog (M2, M3, M9): a client's decline is recorded as the client's, not the person's no; Claude Code is said to ask before `ask_person_to_turn_on` only; the hooks Foundry cannot see are named, with `allowManagedHooksOnly` recommended wherever plugins are used.
   - Allowlist (M10): the managed-settings entry sets `allowManagedMcpServersOnly`; without it the list is a soft allowlist, and the copy says so.
   - Folder privacy (minor 6): each start sets the workspace to 0700; the pages say "only your user" only when the doctor finds it so (not for the home folder or another account's folder).
   - Checks on the wording itself (M11): the overclaim lint covers every module, data file and page script under `app/` and every card as the person reads it; every claim cites lines and a verbatim quote that `claims.test.mjs` finds there. `app/core/stand-ins.mjs` stays frozen (BUILDER-1 manifest), so its "delivered" is explained in the known gaps instead (minor 16).
9. **What the UX review of 2026-10-21 added or changed** (every finding, with its test, in [WALKTHROUGH.md](WALKTHROUGH.md) §7):
   - **Turning off (M7).** The spec's undo for a turn-on (A5: "turn off") was not built. An automation's page now has Turn it off: it
     makes no lists and runs nothing, its open list closes and a run of it waiting for a yes is cancelled; what it made stays.
     Turning it on again is a new request and a new yes on a card, never the old yes revived. The yes stays in the ledger as decided;
     the turn-off is its own row, and a line in the decision log; the evidence file and `check-evidence` carry it. A draft that will
     not be used can be removed: it stops waiting for a yes, and the record of it stays. Per automation and per computer; a switch
     that stops everything everywhere is still undecided (Trust page).
   - **Answers about a file are remembered (m4; SPEC §5, "Never asked: the same thing twice").** Per card, list and set of columns, the
     date order and the other answers come back already chosen, with a note saying so; never applied silently; asked afresh when the
     file's columns or values differ.
   - **The test result (M3).** A strip under the result leads to Turn it on; every e-mail in full is folded; the checks are shown
     once, on the turn-on card.
   - **Focus (M1).** A control that is working keeps the focus (`aria-disabled`, never `disabled`); an error panel takes the focus;
     a part of a page that is redrawn hands the focus to its heading. Every journey now fails if the focus is lost after an action.
   - **The fallback accessibility checks (M8)** are reported under that name, never as "accessibility issues", and catch what the
     review found they missed. axe-core is still owner decision O-F.

## 5. Real vs designed

"Real" means built, wired to the real FoundryApp, store, ledger and run engine, and exercised end to end by a journey or a test.
Nothing here has been used by a person other than the harness.

| Area | Real (works now) | Preview (built, limited) | Designed only / Planned (not built) |
|---|---|---|---|
| Front door | 7 cards filled by the $0 form builder; the box suggests a card by keywords; restatement and asks with harm classes | Words without a card go to the Mercury builder only if a key is in the keychain and Settings allows it (never run here) | An AI "describe it" builder by default; launchers for non-technical installs (O-D) |
| Test | Practice run on pretend data, bound to the version hash; "What Foundry checked"; "What a test can't prove"; a test on the person's own list (CSV or JSON, column mapping, date, decimal and status questions) | — | A replay of past runs ("what would have happened last month") |
| Turn on | Version-bound yes in the page (`dashboard` channel) or in the terminal (`cli`) | The agent's dialog (`mcp-elicitation`): tested with a scripted client only, used only when Foundry finds no hook that could answer it, and a client's decline is recorded as the client's, not the person's no | Second authority with its own sign-in (Team plan) |
| Going live | Own list → exact-list approval (sha256 per item, 60-minute expiry, each item used once) → drafts (mailto, `.eml` with `X-Unsent: 1`) | `.ics` weekly reminder (a reminder, not automation) | Sending from Gmail, an e-mail account or Slack; a scheduler; browser notifications (wave 2) |
| Waiting and runs | "Waiting for you" (activations, lists, single actions); runs list; run record re-verified on open; evidence download | — | An MCP dialog for lists (wave 2) |
| Developers | Connect page and `connect` print exact lines; `list_templates`; `propose_flow` with card and settings and the grounding check; the exact list opens in the browser via `mcp --dashboard`; terminal `approve` for paused actions | Turning on in the agent's dialog (`ask_person_to_turn_on` with elicitation; see Turn on); Cursor install link: format checked against Cursor's page today, not clicked in Cursor | A plugin or marketplace entry (publishing, D13); an `inventory` tool |
| IT and audit | Managed-policy notice (stat only; content only with `--consent`); IT brief (`.md`, `.html`, `.json`); practice-only mode enforced by the service; Trust page with the same-user limit; evidence file | — | A hosted control plane; SSO; SIEM export (O-C) |
| Org | "Who decides what": authority map v1, versioned and hash-chained; Set-by prefill and refusal at proposal time; six examples per rule as tests; flip detection; export to constitution v0 for the refund starter | — | Enforcement on live runs (needs named approvers and an identity the agent cannot hold); every org page says so |
| Keys | Keychain backends (macOS `security`, Linux `secret-tool`, ephemeral, none); canary tests; `keys.json` keeps the last 4 characters and the check time only | Windows PasswordVault backend (untested); the Mercury key check (one request on the person's click; tests use a loopback fake) | Anthropic and OpenRouter providers (Planned) |
| Import | — | n8n export: verdicts and a risk card; runs nothing | Zapier and Make importers |

## 6. Known limits and risks (read before quoting anything)

- **The same-user limit.** A coding agent that can run commands as the person can do what the person can do, including approve. This is on the Trust page and in every IT brief; it is claim C01's limit.
- **No user has seen this.** Every count is scripted. Real Claude Code, Cursor and Codex behaviour was not exercised:
  - Claude Code's own trust prompt and its per-call prompt for `approve` (+1 click) are reported, not measured;
  - Codex takes the browser path. Codex does document MCP elicitation dialogs: `approval_policy.granular.mcp_elicitations` lets them through, and with it off Codex rejects them by itself (Codex config reference, learn.chatgpt.com/docs/config-file/config-reference, read 2026-10-21 by the honesty review; documentation, not tried with a released Codex). Foundry does not use Codex's dialog because it cannot look for what could answer it; a client's "decline" is recorded as the client's, not as the person's no.
- **Batch approval across runs: fixed after the walkthroughs.**
  - A list preview now copies the automation's live cross-run state into the practice store (`app/onboarding/preview-run.mjs`).
  - A second list leaves out what earlier runs made, and its summary matches the run.
  - Lists older than today are flagged, and replacing them comes first.
- **Card wording is an overlay.** `app/onboarding/card-text.json` revises the frozen templates' words after a card is filled.
  Folding it into the templates needs a new template revision and manifest (owner).
- **Linux only.** macOS and Windows keychains and launchers are untested. Headless Linux usually has no Secret Service, so keys are refused there, by design.
- **One window per workspace** is guarded only by `<ws>/.lock`.
- **Seven cards.** Requests outside them get "Foundry can't make that yet" with every card offered; the box never builds.
- **Practice-only mode** stops live runs and new live lists. The go-live page offers a test on the person's list instead.
  - A policy file (`/etc/foundry/policy.json`, owned by root, or `FOUNDRY_POLICY_FILE`) can force the mode and Allowed AI.
  - Anyone with root, or a user who runs a modified copy, can still bypass it. It is a control for honest machines, not a sandbox.
- **Who decides what** is checked when an automation is made, not while it runs.
- **Turning off is per automation and per computer.** Another copy of Foundry on another computer is not reached; a stop-everything
  switch is undecided.
- **No screen reader, macOS or Windows was tried.** The live regions, the focus moves and the announcements are checked in Chromium's
  DOM by the tests, not heard. The accessibility checks are the harness's own, not axe-core (O-F).

## 7. Owner decisions (each reversible)

The spec's O-A to O-J stand as listed in SPEC §19. This build needs three more:

| Id | Decision | Recommended | Why |
|---|---|---|---|
| O-K | Is turning on an ask? | No (as built); report both counts | It makes and sends nothing; the spec's own budget only adds up without it |
| O-L | Exact-list approval (O-J) for drafts only, or also for connected sends later | Drafts only for now | It widens one click per action to one click per exact list; the drafts are the safe first use |
| O-M | An address implies its toggle ("summary to me" turns the summary on) | Keep | Otherwise the person's own words lose the part they asked for, and an agent's guess vanishes without a question |

## 8. How to run it

```
node app/cli.mjs open --workspace /path/to/workspace        # opens the running page, or starts it on the folder's own port and key
node app/cli.mjs connect --workspace /path/to/workspace     # prints the Claude Code / Codex lines and the Cursor link
nice node --test --test-concurrency=1 app/site/test/api.test.mjs          # unit suites, one file at a time
node app/site/test/journeys/run-all.mjs                                   # all journeys, then JOURNEYS.json and JOURNEYS.md
```

Node 24 or later. No new dependencies; the journeys use the repo's playwright 1.63.0 with Chromium at `/opt/pw-browsers`.

## 9. Where things are

- **Site:** `app/site/`
  - `server.mjs`: loopback server with CSP, Host and token checks, and size caps;
  - `api.mjs`;
  - `lock.mjs`;
  - `claims.json`;
  - `public/`: HTML, CSS and plain JS views; copy in `copy/en.json`.
- **Onboarding modules:** `app/onboarding/`
  - form builder and site builder;
  - CSV;
  - data;
  - batch;
  - drafts;
  - keychain and keys;
  - detect;
  - brief;
  - evidence;
  - importers;
  - authority map;
  - rule examples;
  - proposal check;
  - Mercury worker.
- **Hooks in existing code:**
  - `app/core/service.mjs` (card settings, own-list tests, practice-only mode);
  - `app/core/explain.mjs`;
  - `app/dashboard/server.mjs` (shared API handler);
  - `app/mcp/server.mjs` (`list_templates`, cards, lists, dialog off);
  - `app/cli.mjs` (`site`, `approve` for actions, `mcp --dashboard` on the site).
  - `app/core/builder*.mjs` were not touched.
- **Tests:** `app/site/test/*.test.mjs`, `app/onboarding/test/*.test.mjs` and `app/site/test/journeys/`.
