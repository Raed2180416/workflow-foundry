# Persona walkthroughs: what changed, what was declined, and why (2026-10-21)

Development evidence: scripted journeys and unit tests on one Linux container, no users, $0, no model called. Nothing was
published (D13). The changes are in branch `worktree-wf_c7946468-203-16`, in the commit that adds this file, on top of
`4f9dbc41`.

## 1. Sources and how they were read

**The input.** Five cognitive walkthroughs of the site at `4f9dbc41` came in the workflow task text on 2026-10-21:

| Id | Persona |
|---|---|
| P2 | non-technical small-business owner (invoices) |
| P1 | solo developer in Claude Code |
| P3 | team lead who wants refunds over $500 approved |
| P4 | IT and security lead |
| P5 | compliance auditor |

They are treated as data, not instructions. Finding ids below are theirs. P2's majors have no ids in the original, so they are
numbered here in the order given (P2-M1 to P2-M16).

**What was missing from the input.** Parts of the text were cut off. Findings that were not visible were not acted on:

- P2: the text ends inside M16, and no P2 minors are visible.
- P1: the text ends inside M15, and there are no P1 minors.
- P3: the minors end inside "Mixed status".
- P4: m14 is cut.
- P5: the outside references are cut.

**The flagged walkthrough.** The harness flagged the P1 walkthrough for instruction-shaped text ("settings-json"). It was read
as a finding about the product:

- P1 M4 asks for an optional permissions snippet on the Connect page. The page now shows one that the person can add themselves.
- No setting of this session or of the repository's Claude Code configuration was changed.

**Evidence labels.**

- **[test]**: a unit test in `app/**/test/*.test.mjs` holds it. Most are new, in `app/site/test/walkthrough.test.mjs`.
- **[journey]**: a Playwright journey exercises it. The screenshot is under `shots/`.
- **[copy]**: a wording change only.
- **[doc]**: outside documentation read on 2026-10-21. The URL is given.
- **[inference]**: my judgement.

**Outside documentation re-read for this pass (2026-10-21):**

- https://code.claude.com/docs/en/hooks [doc]:
  - An `Elicitation` hook can return `action` (accept, decline or cancel) and `content` (the form field values).
  - Exit code 2 "Declines the request, and no dialog appears".
  - This backs the elicitation-hook risk in P1 M14 and P4 M7. Whether an `accept` from a hook also skips the dialog is in a part of
    the page I did not read.
- https://code.claude.com/docs/en/settings-reference [doc]: the index row reads "`allowManagedHooksOnly` | Run only the hooks
  your organization deploys | … | Managed". The full entry was in an unread part of the page.
- https://code.claude.com/docs/en/settings [doc]: confirms `.claude/settings.local.json` as the per-project personal file. That
  is why the hook check now reads it.

Other outside claims in the walkthroughs were not re-read here. These are:

- Claude Code's default `mcp add` scope;
- the trust prompt for project `.mcp.json`;
- OpenTelemetry tool details;
- Cursor's org-wide privacy mode;
- the mailto handler behaviour.

Where the site relies on one of them, the copy states it as an instruction ("run it inside the project", "type /mcp"), not as a
quoted fact.

## 2. What changed, by mechanism

Several findings share one cause. These are the mechanisms added or changed.

1. **Card wording, applied after a card is filled.**
   - Files: `app/onboarding/card-text.json` (revision "card-text r2") and `card-text.mjs`. The form builder applies them
     (`FORM_BUILDER_ID` now says "card text r2").
   - The templates are frozen by the BUILDER-1 manifest (`research/surface-20261021/eval/MANIFEST-fix.json` hashes
     `app/core/templates/*.json`). So their words are revised on top, and only words change: no stage, value or state key.
   - Every card now has:
     - a plain sentence for each check, with as many sentences as acceptance checks;
     - "drafted" where the template said "sent", "delivered" or "went out";
     - invoice subjects that never claim an earlier reminder.
   - A unit test checks that every revision matches the template text on all seven cards [test].
   - Workflow hashes change, because the words are part of the workflow.
   - Folding the words back into the templates needs a frontier-written template revision and a new manifest. That is an owner
     decision.
2. **The exact list reads the live run state.**
   - `app/onboarding/preview-run.mjs` copies the flow's `state_slots` and `state_entries` into the practice store before the
     preview.
   - A list therefore leaves out what earlier runs already made. Its summary matches what the run will write.
   - A new list replaces any older open list of the same automation, and a yes closes the others.
   - This removes DESIGN §6's "batch approval across runs" limit [test, journey `p2-next-day`].
3. **A key and port that last.** *Superseded on 2026-10-21 by the security review (H1, H2, M6): a key that lasted, kept in
   `localStorage` for a fixed port and printed by `open`, could be taken by whatever bound that port while Foundry was down and
   reached coding agents through captured output. What holds now:*
   - `app/site/session.mjs` keeps only the home port in `<workspace>/site/session.json` (0600); no key is on disk.
   - Every start makes its own keys in memory. A tab gets one by trading a one-time code (`app/site/gate.mjs`: works once, within a
     minute, only for that start) and keeps it in `sessionStorage`. A code used twice withdraws the key its first use got.
   - `node app/cli.mjs open --workspace DIR` opens the page that is already running (a code minted through `<workspace>/site/codes/`),
     or starts it. It prints a one-time link only to a person's terminal (stdin and stdout a TTY), never to piped output.
   - A bookmark opens the page that says that one command (`GET /open-info` needs no key, returns only the command, with the home
     folder written `~`). The "next day" journey now counts running it as one step outside the browser.
   - On Linux the page answers only connections from this OS account or root (`app/site/peer.mjs`, `/proc/net/tcp`).
   - Help and Glossary still render without a key [tests `app/site/test/review-security.test.mjs`, journey `p2-next-day`].
4. **Who decided, kept and checkable.**
   - `app/onboarding/decisions.mjs` names the person as "name (account@host)".
   - Every turn-on, list and single action decision goes to `<workspace>/site/decisions.jsonl`. Each line holds the sha256 of
     the canonical line before it.
   - Evidence `foundry-evidence/2` carries:
     - who started each run and how;
     - the list with each item's digest;
     - per-item yeses tagged `fromList`;
     - declined lists, and the drafts marked as sent;
     - the decision log and its check;
     - the "Who decides what" version and hash;
     - the Foundry build and the host.
   - `node app/cli.mjs check-evidence FILE` re-checks a file on its own [test, journey `p5-auditor`].
5. **An organisation policy file.**
   - `app/core/machine-policy.mjs` reads `/etc/foundry/policy.json` (on Linux and macOS it must be owned by root and not writable
     by group or others) and `FOUNDRY_POLICY_FILE`.
   - The file can only add restrictions: practice-only, and Allowed AI.
   - Settings shows such a setting as set by the organisation, the API refuses to change it (409), and the service enforces it
     [test, journey `p4-policy`].
6. **Approver answers.**
   - `app/onboarding/cards.mjs` and the "answers to record" card on Waiting let the person record the approver's reply for each
     claim, in `<workspace>/site/approver-answers.json`.
   - The next list notes the claims already sent to the approver and those already answered [test, journey `p3-refunds`].

**Frozen files.** The BUILDER-1 manifest hashes were re-checked after these changes:

- Unchanged: the templates, `library.mjs`, `stand-ins.mjs`, `practice.mjs`, `capabilities.mjs` and `builder-model.mjs`.
- Changed: `app/core/explain.mjs`, which already differed from the manifest at `4f9dbc41` (the first site build). This pass
  changes two more failure texts in it (`SHEET_NOT_FOUND`, `PRACTICE_ONLY`).
- Not touched: `app/core/builder*.mjs` and `src/`.

## 3. Every finding

Status:

- **Fixed**: the finding no longer reproduces in the journey or test named.
- **Partly**: part of the fix is in; the rest is declined, with the reason given.
- **Declined**: not done; the reason is given.
- **Not done**: a minor left for later.

### P2, non-technical owner

| Id | Finding | Status | What changed, or why not |
|---|---|---|---|
| B1 | A non-coder cannot start Foundry; "once" is false | Partly | Honest notices on Home (`home.notReady`), in Quickstart (`docs.opBody`) and on the no-key page ("Today someone technical has to start it again after the computer restarts"). The key and port now last across restarts (mechanism 3). **Declined:** the login launcher or double-click starter. It is owner decision O-D: per-OS packaging that cannot be tested here (Linux only), next to D13. |
| B2 | Coming back is a dead end | Fixed | Mechanism 3. The lock refusal now opens the running page. The no-key page shows the exact `open` command for this folder and never the key [journey `p2-next-day` 01 and 05]. |
| B3 | The second weekly run breaks | Fixed | Mechanism 2. A list older than today puts "Replace it" first, with "Use the <date> list anyway" as the secondary choice. The remembered note says nothing on the list was made before. Plural titles ("Make this draft?"). A yes closes the card [journey `p2-next-day` 02 and 03; test]. |
| B4 | The first e-mail can be a false "second reminder" or "final notice" | Fixed | Subjects are "Payment reminder", "Payment overdue" and "Payment overdue, action needed", and no body claims an earlier reminder (mechanism 1). When invoices are late enough for a firmer first contact, the list says so before the yes. The buttons then read "I've reminded them before: make N drafts" and "I haven't: don't make any yet" [journey `p2-invoice` 09]. **Declined:** always starting with a friendly reminder. That changes the template's stage logic, which is frozen. |
| M1 | Currency and decimals lost | Partly | Invoice amounts are written as money: the currency comes from the header or the cells, with two decimals ("€1,240.00") [test]. **Declined** for the expense card: its amount must stay a number for the limit comparison, and the template prints it. |
| M2 | Total chosen over Balance | Fixed | "Balance", "Amount due" and the like are preferred. When a file has both, Foundry asks which one the customer still owes [test]. |
| M3 | Excel not accepted | Partly | A spreadsheet file (by extension or by its PK or OLE signature) gets "Save it as CSV" in the drop zone and from the server (`CSV_BINARY`) [test]. **Declined:** reading .xlsx. It needs a parsing dependency, and new dependencies are an owner decision (minimal and pinned). |
| M4 | "null" printed | Fixed | A `replace()` helper skips null children (`components/dom.js`). |
| M5 | "Send" wording | Fixed | Mechanism 1 and the MCP texts ("drafted"). |
| M6 | Machine text in checks | Fixed | A plain sentence for every check on every card. "How Foundry checks" moved behind a disclosure. |
| M7 | "It won't" collapsed | Fixed | Shown open as a list on Make. Other `summary` elements get a visible ▸ marker. |
| M8 | Webmail hand-off | Fixed | Copy address, Copy subject and Copy text buttons; a webmail line; "Download a copy for Outlook or Apple Mail" [journey `p2-invoice` 10]. |
| M9 | Reminder basics | Partly | The signature is asked ("How should the e-mails be signed?"). Bodies say "Please pay using the details on your invoice." **Declined:** a payment-details field, because the frozen template has no slot for it. |
| M10 | AI claim on Home | Fixed | C04 is off Home. Home says the cards follow fixed steps. |
| M11 | Alarming first-screen warning | Fixed | [copy] "One limit: if you also use an AI coding tool on this computer, it could press yes for you…" |
| M12 | Headline over-promises | Fixed | [copy] "Let Foundry prepare the jobs you do every week." |
| M13 | "You record the decision here" had no screen | Fixed | Mechanism 6. |
| M14 | Raw JSON rows | Fixed | A table of the rows, and "3 rows added to …" [journey `p3-expense`]. |
| M15 | IT brief contradicts the page | Fixed | See P4 B1 and B2. |
| M16 | Developer error copy (text cut off) | Fixed | The missing-list failure reads "Foundry couldn't find the list this automation reads … Give it the list again on the automation's page" (`core/explain.mjs`). |

### P1, solo developer in Claude Code

| Id | Finding | Status | What changed, or why not |
|---|---|---|---|
| B1 | MCP server crashes without a browser and prints the key | Fixed | `browserOpener` resolves false on `error` and writes nothing to stderr. The tool result gives the `open` command instead. The doctor has a "Browser" check [test]. |
| B2 | A closed tab cannot be reopened | Fixed | Mechanism 3. |
| B3 | `connect` prints a broken command | Fixed | Plain lines, one per agent; `--json` is optional. A test splits the line as a shell would and checks it against the allowlisted argv [test]. |
| B4 | "Get Foundry" dead end on a fresh copy | Fixed | Quickstart now says `npm ci --ignore-scripts`. The doctor has an "Agent connection library" check. The README has a section that names `app/cli.mjs`. A fresh-install run was not done (the worktree's `node_modules` is a symlink), so this rests on the doctor check. |
| M1 | "Works now" for untested clients | Fixed | Preview chips: "Tested with a scripted client, not yet with a released Claude Code." |
| M2 | Trust prompt not documented | Fixed | [copy] "Pasting it is your yes to adding Foundry." |
| M3 | Default scope; no next step | Fixed | "Inside the project where you'll use Foundry", an every-project line (`--scope user`), and "type /mcp". |
| M4 | Uncounted, confusing prompts | Partly | The tool is renamed `ask_person_to_turn_on`. The Connect page has an optional allow snippet for the read and draft tools. **Not measured:** prompts in a released Claude Code. No real client was run, and the journey still lists them as not counted. |
| M5 | Declining the dialog is not "no" | Fixed | Decline is recorded as a rejection; cancel is "not decided". The browser opens only when there is no dialog [test]. |
| M6 | Unreadable dialog and yes card | Fixed | The dialog gives the card's will-do lines, then "Turning it on makes and sends nothing. Practice run on pretend data: passed X of Y checks." The checks are plain sentences. |
| M7 | "Sent" claimed | Fixed | Mechanism 1. |
| M8 | A draft counts as sent | Partly | The list and Drafts say "Foundry counts a draft as done once it's made … even if you never send it". "I sent it" is kept in the workspace and in evidence. **Declined:** "mark not sent so it can be made again". That needs an engine operation that deletes a state entry, with a chained record of it. `src/` is out of scope for this pass. |
| M9 | "I sent it" ticks vanish | Fixed | Kept server-side in `<workspace>/site/sent.json`; the port is fixed per workspace. |
| M10 | Out-of-date refusal outside the cards | Fixed (MCP) | A request in words alone with no card gets the seven cards and the closest one. `app/core/builder*.mjs` is unchanged (frozen), so other callers of the stub builder still see its own text. |
| M11 | The agent picks the date | Fixed | Live lists use the server's clock. The result carries `asOf`, plus a note when the agent's date differs. The list shows "as of". |
| M12 | Fallback instructions are a dead end | Fixed | The absolute `open` command, with the workspace. |
| M13 | The browser doesn't follow along | Fixed | The page checks every 5 s while visible and shows "N waiting" on every page except Waiting and Home. After a turn-on on the agent path, the banner says to go back to the agent. The open tab is not moved while the person reads it, by design. |
| M14 | Approval claims too strong | Fixed | `--consent` is in every generated line. `settings.local.json` is read (home and project). The copy is qualified: "An agent allowed to run any command as you could." |
| M15 | Chat posts invisible | Fixed | Posts appear on Drafts as copyable posts. |

### P3, team lead (refunds over $500)

| Id | Finding | Status | What changed, or why not |
|---|---|---|---|
| B1 | No refund path; confident wrong match | Partly | A match on generic words alone ("approval") is never "This sounds like". Refunds and chargebacks are excluded from the expense card. The refund request now gets "I can't make that yet" with the cards [test, journey `p3-refunds` 01]. **Declined:** a refund card. The library is frozen, and a new card is a frontier-written, audited template. |
| B2 | Receipt column required | Fixed | Receipt, category and description may be missing. A file without receipts is said plainly: "every claim goes to the person who decides" [test, journey `p3-refunds` 02 and 03]. |
| B3 | "Who decides" does nothing | Fixed | The choice is stored with the automation, so it survives a reload and shows on Waiting. "Only me" is removed, because the card always e-mails the approver [test]. |
| B4 | Approver's answer not captured; runs start over | Partly | Mechanism 6 [journey `p3-refunds` 05 and 06]. The approver e-mail says the reply goes to the person who records it. **Declined:** leaving claims already sent out of the next e-mail. The template decides what it lists. The list now says which claims were already sent and answered. |
| B5 | A non-coder cannot start Foundry | Partly | As P2 B1. |
| M1 | Approver not checked against the rule | Fixed | People carry an e-mail. The card's approver is prefilled from the rule, and any other address is refused [test]. |
| M2 | "Whoever asked can't approve" unchecked | Partly | Shown as "Planned … Not checked yet". **Declined:** enforcing it, because no card has a requester field. |
| M3 | Reminders promised, no scheduler | Fixed | [copy] Shown as Planned, with "what you can do today". |
| M4 | Mode and override don't work | Fixed | Both removed. The text now reads "When an automation is made, Foundry refuses settings that break this rule". |
| M5 | Rules attributed to people who never touched them | Fixed | "€250 · set by you for Dana (Org policy). Dana hasn't confirmed it" [test, journey `org`]. |
| M6 | "Rules that never break" | Fixed | "Rules Foundry checks when you make an automation". |
| M7 | Currency hard-coded | Partly | The org page has a currency choice, with its default from the browser locale. The ORG journey picks EUR (+1 step). Card amounts: as P2 M1. |
| M8 | "Who decides what" hard to find | Partly | A Home strip ("Setting this up for a team?"), and the nav no longer highlights Connections. **Declined:** a top-nav item, to keep the nav at six items. |
| M9 | Expense words forced onto refunds | Partly | Neutral column names ("person's name", "person's e-mail address"). The subjects remain the template's. Refund card: see B1. |
| M10 | "Approve automatically" overclaims | Fixed | "Approved on their own, not paid yet", and "Nothing has been paid." |
| M11 | E-mail body breaks with missing columns | Partly | Missing parts get words ("no description given", "no category"). The line format is the template's. |
| M12 | "It won't" looks empty | Fixed | As P2 M7. |
| M13 | "Who decides" asked twice | Fixed | The field is "Who decides claims over your limit? (their e-mail)". The turn-on card asks how their decision is recorded. |
| M14 | Test-result jargon | Fixed | Mechanism 1, a rows table, and "How Foundry checks" behind a disclosure. |
| M15 | Turn on before own list | Fixed | "Try it on your real list first" comes before the turn-on card. |
| M16 | Automation page misreports itself | Fixed | Checks come from the last run of this version. "Informed" text names the approver. |
| M17 | Two "Change something" | Fixed | "Change who decides" and "Change settings". |
| M18 | Real goal has no way forward | Fixed | B4's recording is the free way on. The Team plan is still not available. |
| M19 | Org jargon | Partly | "Nobody needs to approve", "Who can change these rules: you", and "Auditor (a label only today)". The layer names stay. They are the model's terms, and each is shown with its plain example. |
| M20 | "Review within 14 days" | Fixed | "Only you have saved these rules. A second person can confirm them once the Team plan exists. Nothing else is needed today." |
| M21 | Org form one long page | Partly | Advanced parts are folded under "More". It is still one page. |
| M22 | "Data goes nowhere" next to an e-mail | Fixed | [copy] "It stays on this computer. Only the e-mails you choose to send leave it, from your own mail app." |
| minors | Grammar and plurals | Fixed | "Add your expense claims", "rows", and plural list titles and buttons. |
| minors | Internal names leak; Download wording; Irrelevant proof on Home | Fixed | Card names on Runs; "Download a copy for Outlook or Apple Mail"; C04 off Home. |
| minors | Stale "ignores" notice; status-question guess; Shopify hint; chip styling; inclusive amount; repeated refusal; "Run" button name; go-live order | Not done | Minor, and left for the next pass. The go-live legend is now visually hidden and distinct from the heading. |

### P4, IT and security lead

| Id | Finding | Status | What changed, or why not |
|---|---|---|---|
| B1 | "Uses AI: yes" for a no-model card | Fixed | Decided from the builder record (`usesModel`) [test]. |
| B2 | "Every action" hides the customer e-mails | Fixed | Steps inside "for each" are listed ("For each one: Draft the reminder … writes an e-mail draft … yes") [test]. |
| B3 | "Leaves this computer: nothing" is false | Fixed | A "What leaves this computer" section covers the agent's provider, the AI builders and Allowed AI [test, journey `p4-policy` 02]. |
| M1 | Practice-only is not an IT control | Fixed | Mechanism 5 [journey `p4-policy` 01]. |
| M2 | Allowlist entry is per user | Partly | The default workspace leaves out `--workspace`. The brief says to install Foundry in a folder only root can change, and to allowlist that path. The `node` path is still the machine's own. |
| M3 | Allowlist pins the command, not the code | Fixed | [copy] On Trust and in the brief. |
| M4 | Brief doesn't identify the software | Fixed | A Build table: package, commit, "changed since commit", sha256 of `app/` and `src/`, Node, exact dependencies, licence status, install path and contact. **Declined:** adding a LICENSE file. The licence decision (Apache-2.0, D1) is the owner's to apply. The brief says no licence file is in this copy yet. |
| M5 | Questions the brief could answer | Fixed | Answered in the brief. Only open items remain, under "Still open" (Planned, no date set). |
| M6 | Trust contradicts itself | Fixed | One wording for the limit. Claim C02 now says what it covered (the earlier prototype's tools and page) and what it did not. **Declined:** re-running the bypass set on the exact-list path. That is a separate test design; the claim says it has not been re-run. |
| M7 | Elicitation-hook risk undisclosed | Partly | A pilot term: `allowManagedHooksOnly` [doc]. Every generated line has `--consent`. With a managed policy or an answering hook, decisions go to the browser. *Since the security review (H3, 2026-10-21):* without `--consent` the dialog is not used; with it, the check runs again on every `ask_person_to_turn_on` and reads every place Claude Code takes hooks from (settings in `$CLAUDE_CONFIG_DIR`, `~/.claude` and `.claude/` of the project folder and each folder above it; plugins; skill and subagent frontmatter; `managed-settings.d`). Only a client named `claude-code` gets the dialog, and not when Claude Code was started with `--settings`, `--plugin-dir`, `--agents`, `-p` or stream-json input. Still open: a hook Foundry cannot see (for example one an Agent SDK host registers in code under an interactive-looking launch) could answer, so the dialog stays the weaker channel [test `review-security` H3]. |
| M8 | Practice-only refusal is an error page | Fixed | Go-live offers "Test on your list (nothing is made)" with a neutral note. There is no button that would be refused [journey `p4-it` 05 and 06]. |
| M9 | "Works now" on Connect | Fixed | As P1 M1. |
| M10 | No data-kept statement | Fixed | A "Data kept, and how to delete it" section, and Settings → "Delete my lists" (typed confirmation; also removes `.history`) [test]. |
| M11 | Brief says "sent" | Fixed | Mechanism 1. Effects read "writes an e-mail draft on this computer". |
| M12 | General brief thin | Fixed | Tables of the agent's tools and of what each card can do [test]. |
| M13 | No removal instructions | Fixed | A "Removing Foundry" section. |
| M14 | No pilot checks or exit criteria | Partly | `doctor --json` (mode, Allowed AI, build, workspace; no secrets) and day-30 criteria. **Declined:** the OpenTelemetry line. I did not verify it this pass, and I don't put unverified product claims in the brief. |
| M15 | Managed banner dead end | Fixed | "Check whether your organisation's policy allows Foundry" reads the server allow and deny keys and says yes, no or unknown. |
| m1–m3 | Platforms, sandbox, "one-time key" | Fixed | "Linux only (macOS and Windows untested)". The sandbox wording is in the doctor. The key is described as lasting until a new one is made. |
| m4 | Channel names | Fixed | Plain channel words, and "name (account@host)". |
| m5, m6 | Garbled check; "contact anyone except" | Fixed | Mechanism 1. "…and the summary address you gave". |
| m7, m8 | Nav highlight; toast | Fixed | No nav item is highlighted on Settings or Org. The toast is cleared on navigation. |
| m9, m11, m12, m13 | Read date; C04; Copy button; WCAG | Fixed | "read 2026-10-21"; C04 off Home; Copy on the brief's allowlist; "not an audit against WCAG". |
| m10 | SSO among decided free items | Partly | SSO moved to a Planned line ("decided to be free"). **Declined:** deciding leaver removal, a stop switch and SIEM export. Those are owner decisions. |
| m14 | P4 journey measures the wrong person (cut) | Partly | New journey `p4-policy`, in which IT sets a policy file and checks Settings, the API and the brief. The file name `p4-it` is kept so the history still lines up. No count of unanswered standard questions. |

### P5, compliance auditor

| Id | Finding | Status | What changed, or why not |
|---|---|---|---|
| B1 | No named approver | Fixed | Mechanism 4. Run pages, lists and evidence say "name (account@host)" [journey `p5-auditor`, test]. |
| B2 | Exact list not in evidence; per-item yeses look human | Fixed | The list has to, subject, body sha256 and digest. Each applied yes carries `fromList` (batch, item, digest, applied by Foundry from one approval) [test]. |
| B3 | Real decisions outside the chain | Partly | Mechanism 4: the decisions are in their own chained log, which evidence and `check-evidence` verify. The gap copy says exactly that. **Declined:** appending them inside the run's chain. The run chain belongs to `src/`, whose approve actor must be 'user'. Changing it is out of scope here. |
| 1 | "Record checked: unbroken" overstates | Fixed | "Record consistent: N entries, each linked to the one before", what that proves, and Copy latest link. No "e-mail it" button. |
| 2 | Record says mail was sent | Partly | Mechanism 1 covers checks, summaries and promises. The stand-in tool's own output field (`delivered`) is in `app/core/stand-ins.mjs`, which the manifest freezes. |
| 3, 4 | Brief "Uses AI"; hidden e-mails | Fixed | As P4 B1 and B2. |
| 5 | "Remembers what it sent" at draft time | Partly | "I sent it" is kept in the workspace and in evidence (`draftsMarkedSent`), and the wording says a draft counts once made. **Declined:** asking before the next run. See P1 M8. |
| 6 | Times unreadable | Partly | ISO 8601 in evidence. The page shows "21 Oct 2026, 09:00 UTC" with the zone named. The harness still mixes the fixed clock (lists) with the real one (turn-on) in the P5 sample. |
| 7 | "No" decisions invisible | Fixed | A Decisions list on the automation page; declined lists in evidence. |
| 8 | Who started a run | Fixed | `startedBy` and `startedThrough`, shown on the run page. |
| 9 | Timeline jargon, no "who" | Fixed | Plain event names, a Who column and a "Decisions only" toggle. |
| 10 | Org page states controls it breaks | Fixed | Heading, "recorded as self-approved", and `selfApproved: true` in history. |
| 11, 12 | "Signed"; 14-day review | Fixed | "saved by you (not signed)"; the review line removed. |
| 13 | Auditor role is a label | Fixed | An auditor box on Runs, and "Auditor (a label only today)". |
| 14, 15 | Help and Waiting contradict Trust; channel jargon | Fixed | As P1 M14 and P4 m4. |
| 16 | Claims not checkable | Partly | The commit is shown on the claims page, and C02 says what it covered. **Declined:** re-running the bypass set (see P4 M6) and a "Published elsewhere" label (not done). |
| 17, 18 | Evidence uncheckable; "Who decides what" version | Fixed | `check-evidence`, a file fingerprint under the button, and the build and host in the file. `whoDecidesWhat` has version and hash and `enforcedAtRunTime: false`. |
| m1–m5, m8, m11, m12 | Card names; machine string; "$0.0000"; toast; copy head; orange "…"; failed-run copy; currency | Fixed | As above; cost now shows 2 decimals. |
| m6 | Nav highlights Connections on Org | Fixed | As P4 m7. |
| m7 | No auditor entry point | Partly | A Quickstart track ("I'm checking what happened") and the Runs box. No footer link. |
| m9 | Org history raw times, no reason or diff | Partly | Times are written out. No reason field and no diff. |
| m10 | "Works now" reused as a state badge | Partly | The record uses a "Decided" chip, not "Works now". Not reviewed everywhere. |
| m13 | P5 only at 1280 light | Partly | It now asserts a named approver, the `fromList` tags, the decision log and the CLI check. Still one variant. |

## 4. Declined, in one list

| What | Why |
|---|---|
| A refund card (P3 B1, M9) | A new card is a frontier-written, audited template, and the library is frozen by the BUILDER-1 manifest. |
| "Never skip a stage" and "start friendly" invoice logic (P2 B4) | It changes the template's stage logic. The wording and the before-you-say-yes note were done instead. |
| A payment-details field (P2 M9) | The frozen template has no slot for it. |
| Money text for expense amounts (P2 M1, P3 M7) | The amount must stay a number for the limit comparison. |
| Reading .xlsx (P2 M3) | It needs a new dependency, which is an owner decision. |
| A login launcher or double-click starter (P2 B1, P3 B5) | Owner decision O-D. It needs per-OS packaging that cannot be tested here. |
| "Mark not sent" that lets a draft be made again (P1 M8, P5 5) | It needs an engine state-deletion operation with a chained record. |
| Person decisions inside the run's own chain (P5 B3) | It changes `src/` (the runtime approve actor must be 'user'). A separate chained log is used instead. |
| Re-running the 10-of-10 bypass set on the exact-list path (P4 M6, P5 16) | It is a separate test design. Claim C02 says it was not re-run. |
| Requester ≠ approver enforcement (P3 M2) | No card has a requester field. It is shown as Planned. |
| A LICENSE file (P4 M4) | The owner applies D1. The brief states the status. |
| The OpenTelemetry pilot line (P4 M14) | Not verified this pass. |
| A top-nav "Who decides" item (P3 M8) | The nav is kept at six items. The Home strip is added instead. |
| Leaver removal, a stop switch and SIEM export marked free (P4 m10) | Owner decisions. |
| WCAG audit, macOS and Windows testing | Not possible in this container. The site says so. |

## 5. Journeys after the fixes

`node app/site/test/journeys/run-all.mjs` rewrote `JOURNEYS.json`, `JOURNEYS.md` and `shots/` (development, scripted). The
screenshots from before the fixes stay in git at `4f9dbc41`, for example `shots/p4-it/05-run-refused.jpg`. New journeys:

| Journey | File | What it shows |
|---|---|---|
| `p2-next-day` | `p2-operator.mjs` | Opening from a bookmark without the key; a stale list replaced first; no repeated reminders; another browser told how to open |
| `p3-refunds` | `p3-team-lead.mjs` | The refund request gets no false match; a refunds export without receipts; the approver e-mail; the answer recorded; decisions on the automation page |
| `p4-policy` | `p4-it.mjs` | Settings locked by the organisation's file; the API refuses; the brief names it |

Changed journeys:

- `p4-it`: practice-only is now a test on the list, not a refusal.
- `p5-auditor`: asserts the named approver, the decision log and the CLI check.
- `p1-*`: the tool rename, and the server clock (`FOUNDRY_TEST_AS_OF`).
- `p3-expense`: the "who decides" wording.
- `org`: the attribution and refusal wording, and the currency choice.

Totals: 30 journey tests in 9 files pass. There are 171 screenshots, 22.6 MB (budget 25 MB). There are 0 console or page errors,
0 external requests and 0 fallback accessibility issues.

The crawl covers 10 states at 1280 and 390, with 32 to 39 pages per state and 0 problems.

Steps and asks are counted from the start of each journey; for P1, "after setup" subtracts the one-time paste. Each milestone
cell gives steps / asks / time.

| Journey | Variant | Milestones now | Budget | Before the fixes (`4f9dbc41`) | Result |
|---|---|---|---|---|---|
| P2 invoice | 1280 light | first verified 3 / 1 / 5.0 s; first live 8 / 4 / 11.0 s | ≤ 3 / 1; ≤ 8 / 4 | 3 / 1; 8 / 4 | pass |
| P2 invoice | 390 dark | 3 / 1 / 3.1 s; 8 / 4 / 7.1 s | same | 3 / 1; 8 / 4 | pass |
| P2 invoice | keyboard, 1280 | 3 / 1 / 2.6 s; 8 / 4 / 6.8 s | same | 3 / 1; 8 / 4 | pass |
| P2 own list | 1280 | own-list test 7 / 3 / 5.3 s | ≤ 7 / 3 | 7 / 3 | pass |
| P2 edges | 390 light | 16 steps, 5 asks; no dead end | no dead end | same | pass |
| **P2 next day** (new) | 1280 | 7 steps, 2 asks: bookmark opens; stale list replaced first; second list is the summary only; another browser gets the `open` command | no repeat reminder; no dead end | not possible (B2, B3) | pass |
| P3 expense | 1280 light | first verified 4 / 2 / 4.4 s; turned on 9 / 4 / 6.5 s | ≤ 4 / 2 | 4 / 2; 9 / 4 | pass |
| P3 expense | 390 dark | 4 / 2 / 2.5 s; 9 / 4 / 3.9 s | same | same | pass |
| **P3 refunds** (new) | 1280 | first live 12 / 4 / 5.2 s; answer recorded at 16 steps | no false match; no receipt needed; answer recorded | not possible (B1, B2, B4) | pass |
| P1 Claude Code | 1280 | setup 2 / 0; first verified 3 / 0 (1 / 0 after setup); first live 5 / 1 (3 / 1 after setup), 14.2 s | ≤ 2 / 0 and ≤ 4 / 2 after setup | same counts | pass |
| P1 agent guessed an address | 1280 | first verified 4 / 1 (2 / 1 after setup) | +1 ask; nothing made first | same | pass |
| P1 Cursor or Codex | 1280 | first verified 3 / 0; first live 7 / 1 (5 / 1 after setup), 13.5 s | ≤ 5 after setup | same | pass |
| P4 IT | 1280 | brief 2 actions; practice-only 1 action; then a test on the real list, nothing made | ≤ 2; 1 | the live run was refused with an error | pass |
| **P4 policy** (new) | 1280 | Settings locked; API refuses (1 refusal shown, expected); the brief names the organisation setting | locked | not possible (M1) | pass |
| P5 auditor | 1280 | evidence 3 / 0 / 2.8 s; named approver, `fromList`, decision log and `check-evidence` asserted | ≤ 3 | 3 actions, with no approver identity | pass |
| ORG | 1280 light, 390 dark | v1 12 / 1; v2 21 / 4 | ≤ 12 to v1 | 11 / 1; 20 / 4 (+1: the currency choice) | pass |
| KEYS, IMPORT | 1280 | unchanged | key absent everywhere; nothing made | same | pass |

Prompts that a released Claude Code shows are still not counted, because no real client was run. These are the trust prompt for
a new stdio server and the permission prompt before `ask_person_to_turn_on`.

## 6. Regression tests added

`app/site/test/walkthrough.test.mjs` has 12 tests, each naming the findings it holds:

- the session key and port, `/open-info`, and a stale key;
- the browser opener with no browser;
- `connect` output parsed as a shell would;
- card text on all seven cards;
- invoice wording and money;
- Total versus Balance, Excel, and receipt optional;
- refunds and generic-word matches;
- the brief's AI, actions, egress, build and removal sections;
- the organisation policy file;
- the doctor;
- deciders, answers, notes, sent marks, evidence (named, digests, `fromList`, decision log) with tamper detection, and forget;
- the second list of a day.

Existing tests were updated for the new wording:

- `batch.test.mjs`, `csv.test.mjs` and `authority-map.test.mjs`;
- `api.test.mjs`, `builder-model.test.mjs`, `mcp-dashboard.test.mjs` and `copy-lint.test.mjs`.

All unit suites under `app/` pass: 104 tests.
