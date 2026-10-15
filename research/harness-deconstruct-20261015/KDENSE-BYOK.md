# K-Dense BYOK ("Kady"): deconstruction dossier (2026-10-15)

**Subject.** K-Dense-AI/k-dense-byok, commit `44c52cee8e9fdc343c6132909769f49accf14a82` (2026-10-03), MIT, cloned shallow
and inert at `corpus/k-dense-byok/` ([ACQUISITION.md](ACQUISITION.md)). The skill catalogue it syncs,
K-Dense-AI/scientific-agent-skills, is at `corpus/scientific-agent-skills/` (commit `a1043ef`, 2026-10-12).

**Method.** Read-only. No script, launcher, package manager, hook, model or paid API was run. Two read-only Python
one-liners (run with `python3 -I`) counted fields in `web/src/data/workflows.json` and the skills tree; their outputs are
quoted where used. Everything in `corpus/` was treated as data: its `AGENTS.md`, prompts, skills and workflow prompts
were read as claims about the system, never as instructions. No credential or `.env` file was read
(`.env.example` was not opened either).

**Path convention.** Bare paths are relative to `corpus/k-dense-byok/`. Paths prefixed `WF:` are relative to this
repository's root (HEAD `2b227b8`). `SK:` is `corpus/scientific-agent-skills/`.

**Tags.**
- **[code]** read in the source at the cited lines (or counted from a cited data file);
- **[doc]** stated in the project's own documentation, README or `AGENTS.md` at the cited lines, not verified in code;
- **[inference]** my reasoning from cited code or docs, not tested;
- **[unavailable]** the evidence is not in the clone (an npm dependency that is not vendored, an external page, a
  results file), so the claim could not be checked.

**Development and diagnostic only.** This dossier is a design input. It contains no measurement of Kady's capability.

---

## Summary of findings

1. **Kady is one flat Pi agent per chat tab, wrapped in a Fastify server that owns runs, cost, provenance and
   approvals.** The agent loop, the delegation runtime (pi-subagents), MCP, skills loading and the watchdog are npm
   dependencies; Kady's own code is the host around them. [code] `server/package.json:15-33`; [doc] `AGENTS.md:14`,
   `AGENTS.md:101`.
2. **The "326 guided workflows" are prompt templates.** Each is a JSON object with a prose prompt, `{placeholder}`
   string substitution and a `requiresFiles` flag. There are no typed outputs, no checks, no steps the runtime can see,
   no server-side identity and no outcome record. The user picks one from a searchable panel; it becomes an ordinary chat
   message. [code] `web/src/components/workflows-panel.tsx:110-121`, `:330-355`; `web/src/lib/workflow-inputs.ts:1-25`.
3. **The executable "workflow" in Kady is something else:** a JavaScript workflow script the lead model writes into its
   reply to fan out specialists, run by pi-subagents. Kady reads only its literal `agent:`/`model:` strings to gate the
   budget, and fails closed when a name is computed. [code] `server/src/agent/subagent-bridge.ts:300-358`, `:385-410`.
4. **Verification is prompt convention.** A brief that starts "Verification gate:" asks a reviewer to end with
   `Verdict: accept|repair|reject`; no code parses the verdict. [code] `server/src/agent/subagent-prompts.ts:86-96`;
   search of `server/src`, `server/pi-packages`, `web/src` for `Verdict` finds no parser.
5. **The record-keeping is strong and unusually honest.** Observational provenance never trusts the model and grades
   every file edge `observed`/`inferred`/`declared`; plans are frozen in a digest-chained, exclusively published journal;
   evidence packages ship a missing-information report and a static `verify.py`; robustness batches bind approval to the
   exact preview digest, expire, and reserve all cost before any job starts. [code] `server/src/provenance/store.ts:9-45`,
   `server/src/agent/notebook-plans.ts:44-110`, `server/src/evidence/packages.ts:37-41`, `:271-275`,
   `server/src/agent/notebook-robustness.ts:116-140`.
6. **The paper title's "hash-chained lab notebook" covers only the analysis-plan journal.** Notebook entries,
   provenance steps and the cost ledger are plain appended JSONL with no chain, writable by the agent's own shell.
   [code] `server/src/agent/notebook-store.ts:100`, `server/src/provenance/store.ts:293`, `server/src/cost/ledger.ts:219`;
   [doc] `README.md:38`, `docs/lab-notebook.md:113-114`.
7. **The trust boundary is the OS user, and the agent can reach the approval API.** The auth token is deliberately left
   in the agent's environment, and the request guard passes requests with no Origin (curl). Approval endpoints have "no
   model surface" but are HTTP-reachable from the agent's shell. The guard's own policy file is not protected by default.
   [code] `server/src/auth.ts:14-18`, `server/src/request-guard.ts:20-22`, `server/src/agent/guard-policy.ts:17-21`;
   [inference] for the self-approval and guard-disable paths.
8. **Performance claims are weak evidence.** The platform figure is an internal 20-prompt comparison scored by one LLM
   judge with no results in the repo; the CompBioBench rank is externally graded but does not separate harness from
   model. `docs/performance.md` is about UI rendering, not capability. [doc] `README.md:40-63`;
   [code] `docs/07_platform_performance_summary.png` footer; [unavailable] results files.

---

## 1. Architecture

### 1.1 Components

| Part | What it is | Evidence |
|---|---|---|
| `web/` | Next.js/React UI on port 3000: chat tabs, file previews, notebook, settings, workflow library, automation panel | [doc] `docs/architecture.md:6-9` |
| `server/` | Fastify/TypeScript backend on port 8000: Pi sessions, tools, files, accounting, compute | [doc] `docs/architecture.md:6-14`; [code] `server/src/index.ts:82-214` |
| Pi SDK | `@earendil-works/pi-agent-core`, `pi-ai`, `pi-coding-agent` at exactly `1.0.0`: the agent loop, sessions, model runtime, skill loader, MCP/codemode/tool-search extensions | [code] `server/package.json:16-18`, `server/src/agent/session-registry.ts:463-491`; internals [unavailable] (not vendored) |
| `pi-subagents` 0.74.0 | Delegation runtime: `subagent`/`bg_wait` tools, workflow-script executor, schedules, missions, supervisor channel, watchdog, builtin agents | [code] `server/package.json:27`; [doc] `AGENTS.md:101-106`; internals [unavailable] |
| `pi-web-access` 0.35.0 | `web_search`, `fetch_content`, `source_check` tools | [code] `server/package.json:28`; [doc] `AGENTS.md:14` |
| `skills` 1.7.0 | vercel-labs skills CLI, used only as a fetcher into a staging cache | [code] `server/package.json:29`; [doc] `docs/skill-management.md:62-67` |
| `server/pi-packages/` | Five vendored Pi packages loaded into child agents: `kady-guard` (raw-data guard), `kady-notebook` (notebook + memory search tools), `kady-modal` (Modal tools over a loopback API), `kady-pdf-annotations`, `kady-child-runtime` (child prompt section + registers the others) | [code] `server/pi-packages/kady-child-runtime/index.ts:11-51`, `server/src/agent/subagent-control.ts:90-93` |
| `server/scripts/patch-subagents.mjs` | Applies anchor-checked source patches ("host seams") to the installed pi-subagents and refuses any version other than 0.74.0 | [code] `server/scripts/patch-subagents.mjs:1-11`, `:12-125` |
| `server/src/helpers/*.py` | uv-managed Python helpers that render scientific file previews | [doc] `AGENTS.md:55` |
| `scripts/update-models.py` | Regenerates `web/src/data/models.json` from the live OpenRouter catalogue (tool-calling models, non-negative prices, recent) | [code] `scripts/update-models.py:1-20` |
| Launchers | `start.sh`/`start.cmd` wrap `start.mjs`, which installs pinned packages and starts both services (not run here) | [doc] `docs/architecture.md:3-4`, `AGENTS.md:130` |

**Storage** is plain files per project under `projects/<id>/sandbox/`: uploads in `user_data/`, Pi session JSONL in
`.pi/sessions/`, skills/agents/prompts/MCP config in `.pi/`, and Kady's records in `.kady/` (cost ledger, notebook,
provenance, environments, evidence, Modal jobs) [doc] `docs/architecture.md:42-62`. All chat tabs of a project and all
their specialists share the one sandbox directory [doc] `docs/architecture.md:34-36`, `docs/sub-agents.md:28-29`.

### 1.2 One request, end to end

The trace below is a user who opens the workflow library, picks a template and clicks **Run workflow**.

1. **Template to text (browser).** `WorkflowLaunchDialog` replaces each `{key}` in the template prompt with the user's
   value, or `[label]` when an optional field is empty, and blocks launch until required fields are filled
   [code] `web/src/components/workflows-panel.tsx:330-341`. `buildWorkflowPrompt` appends a fixed "Execution guidance"
   block and a "Data access" block, then the selected files, folders and other locations as JSON-encoded lists
   [code] `web/src/lib/workflow-inputs.ts:2-24`. The user may edit the whole prompt before launch
   [code] `web/src/components/workflows-panel.tsx:405-436`.
2. **Launch into the active chat.** `handleWorkflowLaunch` switches to the chat view and calls the active tab's
   `launchWorkflow` [code] `web/src/app/page.tsx:748-756`, which checks model availability and the budget state, then
   `send`s the prompt as an ordinary user message with the chosen files as attachments
   [code] `web/src/components/chat-tab.tsx:2356-2382`. The client POSTs `/sessions/:id/run` with a `buildRunBody` JSON
   body [code] `web/src/lib/use-agent.ts:509-535`, `:1416-1430`. No workflow id travels with it; the server has no notion
   of which template ran [code] (no match for `workflows.json`/`workflowId` in `server/src` outside robustness batches).
3. **Project scope.** An `onRequest` hook resolves the project from `X-Project-Id`, then `?project`, then a cookie, and
   refuses writes to an unknown project rather than falling back [code] `server/src/index.ts:67-80`, `:127-171`. The
   request guard and token check run before handlers [code] `server/src/index.ts:103-116`.
4. **Claim the run.** `/sessions/:id/run` returns 409 if the session is streaming or claimed
   [code] `server/src/api/sessions.ts:724-740`, expands slash commands itself (`:752`), claims the run synchronously
   before any await (`:768`), resolves and authenticates the model (`:775-791`), and opens a broker handle that
   publishes `run_start` (`:798`). For a Fusion run it empties the tool registry for the turn (`:841-858`).
5. **Execute (detached).** `executeRun` is the run's owner; HTTP responses only observe it
   [code] `server/src/agent/run-pipeline.ts:1-21`, `server/src/api/sessions.ts:893-914`. It builds a
   `ProvenanceRecorder` (`run-pipeline.ts:311`), subscribes to Pi events and maps each to a client frame and a
   provenance observation (`:337-351`), refuses the run if the project cap is already reached (`:379-394`), then awaits
   `session.prompt(...)` (`:396`, with the prompt from `sessions.ts:905-909`).
6. **The agent turn.** Pi runs its tool loop with the session's tools: read/bash/edit/write/grep/find/ls, plus
   `interview`, `notebook`, `notebook_search`, `scientific_result`, PDF annotation, Modal and image tools, plus extension
   tools (`subagent`, `bg_wait`, web access, MCP/codemode) [code] `server/src/agent/session-registry.ts:463-491`,
   `server/src/agent/tools.ts:16-28`. Thirteen extension factories, plus the pi-subagents extension, hook the
   session: specialist ledger and budget, codemode budget, Fusion body rewrite, science-aware compaction, child notebook
   harvest, child provenance harvest, refusal explanation, child Modal attribution, raw-data guard, codemode, tool
   search, MCP, and specialist control [code] `server/src/agent/session-registry.ts:387-444`. The loop itself is Pi's
   [unavailable].
7. **Finalize.** After the turn: drain provenance scans before terminal frames (`run-pipeline.ts:411`), ledger the run
   cost in a `finally` so a failed turn is still charged (`:419-472`), publish `cost` and `done` (`:486-490`). The
   broker keeps the run replayable for reconnecting tabs; it survives browser disconnects, not backend restarts
   [code] `server/src/agent/run-broker.ts:1-9`; [doc] `docs/architecture.md:28-30`.
8. **Turns nobody started.** When a specialist asks a question or a schedule completes, pi-subagents starts a turn on an
   idle session; a permanent observer adopts it as a `system` run through the same pipeline
   [code] `server/src/agent/session-observer.ts:1-16`.

**Session construction** (once per tab) seeds the specialist roster, web access, notebook/Modal/PDF/guard packages,
prompt templates, watchdog guidance and subagent runtime settings into the sandbox before creating the Pi session
[code] `server/src/agent/session-registry.ts:329-385`; the system prompt is Pi's default plus the sandbox `AGENTS.md`,
which Kady seeds and versions (seven shipped versions; an edited copy is left alone) [code]
`server/src/sandbox-seed.ts:1-11`, `:217-218`.

---

## 2. The agent loop

### 2.1 Planning

- **No planner in code.** There is one flat lead agent per tab with no orchestrator/expert split [doc] `AGENTS.md:14`,
  `AGENTS.md:101`. What the lead does next is the model's choice inside Pi's loop [unavailable].
- **Planning is shaped by prompt text:** the seeded `AGENTS.md` asks for clarifying questions only when missing
  information would change scope or validity, and allows routine reversible choices [code]
  `server/src/sandbox-seed.ts:152-170` (v6 text); the `interview` tool shows a blocking form in chat [doc]
  `AGENTS.md:108`. Every one of the 326 workflow prompts is a numbered procedure (326/326 contain a "1." step), and 286
  of them name the interview tool [code: count over `web/src/data/workflows.json`].
- **Research planning is a separate one-shot call.** "What next?" makes one approved, tool-less model call that returns
  2–4 explanations and 1–6 proposed tests, stored as proposals that can never count as evidence [doc]
  `docs/next-experiments.md:6-28`, `AGENTS.md:118`.

### 2.2 Sub-agents ("specialists")

- **Roster.** 23 scientific personas, 13 of them marked `verifier` [code: 23 `name:` entries, 13 `verifier: true` in
  `server/src/agent/subagents.ts`]. Each persona appends a shared contract: evidence (`:36-42`), severity (`:44-49`),
  reviewer (`:51-58`), builder (`:60-65`) or research (`:67-72`). pi-subagents adds general-purpose and external-CLI
  builtins; the external CLIs (Claude Code, Codex, Cursor) are off by default because they bypass Kady's ledger
  [doc] `docs/sub-agents.md:18-20`, `AGENTS.md:104`.
- **How delegation runs.** The lead calls `subagent`; children are native Pi sessions, forced into background mode so
  they load Kady's packages [code] `server/src/agent/session-registry.ts:373-377`; [doc] `AGENTS.md:101`. To run several
  specialists, the lead writes a `js workflow` fenced block in its reply and calls `subagent({ workflow: true })`
  [doc] `docs/sub-agents.md:34-40`, `AGENTS.md:104`; [code] `web/src/lib/workflow-script.ts:1-10`. The executor is
  pi-subagents [unavailable].
- **Briefs and handoffs are contracts in prose.** The lead is told to give each child a self-contained brief (question,
  inputs, scope, deliverables, effort) and to read a handoff's completion status separately from its scientific verdict
  [code] `server/src/agent/subagent-prompts.ts:21-62`. Every child gets a runtime section requiring a handoff with
  Status (completed/partial/blocked), Conclusion, Evidence, Checks, Artifacts and Open questions
  [code] `server/src/agent/subagent-prompts.ts:72-124`, injected by `kady-child-runtime`
  [code] `server/pi-packages/kady-child-runtime/index.ts:14-16`.
- **Questions from children** go through `contact_supervisor`; the lead answers from existing instructions or asks the
  user; the child waits up to ten minutes and silence is not approval [doc] `docs/sub-agents.md:42-44`,
  [code] `server/src/agent/subagent-prompts.ts:76-84`.
- **Context.** Children start fresh or forked [code] `server/src/agent/subagent-control.ts:60`; roster personas inherit
  project context and skills by default [code] `server/src/agent/agent-files.ts:478-487`; all share the project sandbox
  [doc] `docs/sub-agents.md:28-29`.

### 2.3 Verification

| Mechanism | What enforces it | Evidence |
|---|---|---|
| Verification gate | A brief starting "Verification gate:" asks the reviewer to treat every step as unestablished and end with `Verdict: accept/repair/reject` | [code] `server/src/agent/subagent-prompts.ts:86-96`, `:35-41`; no parser found [code] |
| Comparative reviewer | Persona that reads independent attempts side by side for shared blind spots | [code] `server/src/agent/subagents.ts:295-313` |
| `/prove-verify` | A prompt template: rounds of parallel `investigator`s, a fitting verifier per draft and one comparative review per round, a `ledger.md` with Verified/Excluded/Attempts; defaults 3 rounds × 3 investigators; the dollar limit is checked by the model running a `node -e` sum over `costs.jsonl` | [code] `server/src/agent/prompts.ts:274-313`, `:286`; [doc] `AGENTS.md:106` ("prompt-only orchestration (no server loop)") |
| Verifier model | Optional app-wide model for the 15 verifier roles, written into each project's `agentOverrides`; unset by default, so verifiers inherit the producer's model | [code] `server/src/agent/verifier-models.ts:1-27`, `server/src/app-settings.ts:46`; [doc] `docs/sub-agents.md:95-117` |
| Watchdog | Optional second model reviewing bounded turn deltas against `WATCHDOG.md`; off by default; warnings trigger a continuation; repeated warnings stop the turn (default 3); failures can be silent | [code] `server/src/agent/watchdog-settings.ts:29-54`, `:162-205`; [doc] `docs/watchdog.md:3-38`; reviewer internals [unavailable] |
| Execution status | A notebook entry marked `completed` with no evidence string is stored as `unverified` (a non-empty string is enough) | [code] `web/src/lib/notebook-execution.ts:8-16`, `server/src/agent/notebook.ts:121-122` |
| Typed result cards | `scientific_result` validates the card shape and that cited files exist in the sandbox; values are model-supplied | [code] `server/src/agent/scientific-result.ts:487-517`, `:640-660` |

**Reading.** Kady verifies by model review and by records, never by an executable check on the task outcome. Its own
docs say so: "completion is not a scientific verdict" [doc] `docs/sub-agents.md:31-32`; "No warning is not proof of
correctness" [doc] `docs/watchdog.md:19-21`. Reviewers carry the full inherited toolset, including write and bash: the
roster files declare no `tools:` allowlist [code] `server/src/agent/agent-files.ts:478-487`, and the child ceiling is
the parent's tools minus `interview` and the loaders [code] `server/src/agent/subagent-control.ts:47-50`. "Do not edit
files" is prose [code] `server/src/agent/subagents.ts:58-59`. Only pi-subagents' builtin `reviewer` lost
`bash`/`edit`/`write` upstream [code] `server/src/agent/builtin-tool-overrides.ts:13-17`.

### 2.4 Automation

- **Schedules** (interval or one-shot) are pi-subagents objects; Kady keeps one resident session per project so timers
  fire without an open tab, pauses schedules while the project is over its cap, and re-applies the cap for panel
  actions that bypass the tool hook [code] `server/src/agent/scheduler.ts:1-24`; [doc] `docs/automation.md:6-29`.
- **Capability ceiling persists.** A schedule keeps its creation-time tool ceiling, intersected with the current policy
  [doc] `docs/automation.md:31-35`; [code] `server/scripts/patch-subagents.mjs:86-114` (`KADY_HOST_SCHEDULE_CAPTURE_V1`,
  `_RECORD_V1`, `_LAUNCH_V1`).
- **Missions** persist a delegation's purpose, runs, decisions and receipts in the Pi agent directory [doc]
  `docs/automation.md:42-47`; [code] `server/src/api/automation.ts:85-87`; semantics [unavailable].

---

## 3. The "326 guided workflows"

### 3.1 What a workflow is

| Property | Kady template | Evidence |
|---|---|---|
| Container | One JSON array, `web/src/data/workflows.json`, 326 objects, 574 KB | [code] count; [doc] `docs/contributing-workflows.md:3` |
| Fields | `id, name, description, category, icon, prompt, placeholders[{key,label,required}], requiresFiles` and nothing else | [code] `web/src/components/workflows-panel.tsx:110-119`; field census over all 326 objects |
| Body | Prose prompt, 785–3,349 characters (mean 1,287), always numbered steps | [code] count; [doc] `docs/contributing-workflows.md:42` |
| Parameters | 0–5 string placeholders per template (mean 1.5), substituted by `replaceAll` | [code] `web/src/components/workflows-panel.tsx:330-337` |
| Types | None. Placeholder values are free text; no input or output schema | [code] same |
| Checks | None executable. Prompts ask the model to "validate", "check", "record seeds and versions" (e.g. 99 mention a random seed, 124 package versions, 271 limitations) | [code] keyword counts; examples `web/src/data/workflows.json:1613-1628` (homology modeling), `:3453-3468` (Neuropixels) |
| Skills | Deliberately not named; the agent discovers them | [doc] `docs/contributing-workflows.md:43`; [code] 0 of 326 prompts contain "skill" |
| Notebook, specialists | Not referenced (0 prompts mention the notebook; 3 mention "specialist", as a review need) | [code] count |
| Categories | 22, from finance (41) to scicomm (10) | [code] count; [doc] `docs/contributing-workflows.md:34` |
| Identity at run time | None. The server receives a chat message | [code] §1.2 step 2 |

Representative excerpt, `review-paper` (`web/src/data/workflows.json:3-10`): eight numbered steps from "Establish the
review context" to "Draft the review as: …", ending "Label the result as a working draft requiring human verification.
Save it as a clearly named Markdown file". The ending "Save every deliverable under a clear name in the sandbox.
Summarize key results, limitations, unresolved inputs, and every saved path in chat." recurs in 186 of 326 prompts
[code] count.

### 3.2 How one is chosen and executed

- **Chosen by the user**, never by the agent. The panel groups templates by category and filters by a substring over
  name, description and category [code] `web/src/components/workflows-panel.tsx:496-520`. There is no ranking, no
  applicability check and no record of past outcomes [code] (no other consumer of `workflows.json` in `web/src` or
  `server/src`).
- **Executed as one chat turn** of the general agent, with the template text as the user message plus the fixed
  guidance blocks [code] `web/src/lib/workflow-inputs.ts:15-24`. From there it is indistinguishable from typed chat.
  Whatever structure the steps describe is followed, or not, by the model.

### 3.3 How they are authored and validated

- **Authoring** is a pull request editing the JSON, with prose tips: numbered steps, no skill names, "supplied" not
  "uploaded", descriptions under ~120 characters [doc] `docs/contributing-workflows.md:28-46`.
- **Validation** is one Vitest test over the catalogue: at least one entry, unique ids, no "uploaded" wording, every
  placeholder key appears in its prompt [code] `web/src/lib/workflow-inputs.test.ts:32-40`. My census found 0
  placeholder mismatches [code]. Beyond that, the guide asks the contributor to "launch the workflow with representative
  inputs before submitting" [doc] `docs/contributing-workflows.md:48`. There is no oracle, fixture, expected output or
  outcome tracking for any template [code] (no test references a template id).

### 3.4 The other "workflow": model-written delegation scripts

- **What.** A JavaScript block in the lead's reply that declares children as `runs.run(key, { agent, task })`, executed
  by pi-subagents in a detached runner [doc] `AGENTS.md:104`; [code] `web/src/lib/workflow-script.ts:1-10`,
  `:76-80`.
- **What Kady checks.** It parses the script with Acorn and collects only literal `agent`/`model` values; a spread, a
  computed key or an unreadable script marks it `dynamic`, which bills as "unknown" (fail closed at the cap) and disables
  model pinning [code] `server/src/agent/subagent-bridge.ts:300-358`, `:385-410`, `:472-501`. Before launch, each named
  agent is preflighted against the capability ceiling [code] `server/src/agent/subagent-control.ts:117-129`.
- **What it is not.** No types, no contract, no verify semantics, no depth or count limit in Kady's code (nesting limits,
  if any, are pi-subagents' [unavailable]); nested children (depth > 1) are not harvested into the notebook or
  provenance [doc] `docs/provenance.md:64`, `docs/sub-agents.md:150-151`.

### 3.5 Kady's workflow vs Foundry's

| Dimension | Kady template | Kady delegation script | Foundry workflow |
|---|---|---|---|
| Representation | Prose prompt in JSON | Model-written JS | Typed IR, 10 node kinds [code] `WF:schemas/workflow.schema.json:136-141` |
| Who constructs | A human contributor, ahead of time | The lead model, per task | A cheap or frontier builder, per task, from typed library cards [doc] `WF:docs/ROADMAP.md:463-506`; [code] `WF:experiments/library/cards/P01/card.json:25`, `:99-149` |
| Typed inputs/outputs | No | No | Per-node `returns` schema, `answerSchema`, state slots [code] `WF:schemas/workflow.schema.json:157-200` |
| Steps visible to the runtime | No | Children only | Every node, journaled [code] `WF:src/journal.mjs:1-2` |
| Checks | Prose | Reviewer personas by prose | `assert`/`verify` nodes with `independence` labels; acceptance graded `gating` only if a wrong answer can fail it, and same-model verifies do not count [code] `WF:src/acceptance.mjs:180-218` |
| Static validation | Placeholder spelling | Literal agent/model names | Schema, label/taint policy, strict lint (`ACCEPTANCE_EXISTENCE_ONLY`, `VERIFY_NOT_GATING`, `ERROR_COLLECTION`) [code] `WF:src/lint.mjs:16-18`, `WF:src/validate.mjs:239-245` |
| Selection | User browses | Model decides | Need router (design only) [doc] `WF:docs/ROADMAP.md:617-659`, `WF:README.md:110` |
| Outcome record | None | Handoff text | Run verdicts against independent oracles; experiment reports [doc] `WF:docs/ROADMAP.md:516-528`, `WF:README.md:137-200` |
| Reuse economics | Static catalogue, never measured | None | Disposable by default; ladder candidate → shadow → kept [code] `WF:experiments/library/store.mjs:22-30`; [doc] `WF:docs/THESIS.md:136-145` |
| Model assignment | Whatever the chat uses | Per-child override | Per-node model class from the policy file [code] `WF:policy/models.json:20-24`; [doc] `WF:docs/ROADMAP.md:358-425` |

**Reading [inference].** Kady's 326 templates are the equivalent of Foundry's `skills/` prose packs plus a launcher
form, not of Foundry workflows. They encode domain procedure well (reporting standards, seeds, versions, confidentiality
gates) but give the runtime nothing to check. Their value to Foundry is as a **task corpus** with stated deliverables per
discipline (§9 "Adopt").

---

## 4. Skills

- **Format.** Agent Skills standard: a directory with `SKILL.md` (YAML frontmatter + Markdown) and optional files; Pi
  loads them natively [code] `server/src/agent/skills.ts:1-11`; [doc] `docs/skill-management.md:3`. In the K-Dense
  catalogue, all 177 skills have `name`, `description` and `metadata`; 173 a `license` and `compatibility`; 99 an
  `allowed-tools` line; 121 ship a `scripts/` directory; `SKILL.md` runs 112–499 lines (mean 281) [code: census of
  `SK:skills/*/SKILL.md`], e.g. `SK:skills/biopython/SKILL.md:1-20`.
- **Count.** README badge 181 = 177 K-Dense + 4 Anthropic document skills [doc] `README.md:6`, `:80`. 73 of the 177 are
  disabled by default, all of them package wrappers (`scanpy`, `rdkit`, `pymc`, …) [code]
  `server/src/agent/skills.ts:101-178`, intersected with `SK:skills/` (73/73 present). So about 104 + 4 are enabled at
  first sync [inference: arithmetic at `SK:` commit `a1043ef`; the live set follows `main`]. The "149 skills" figure in
  the task brief does not appear in this commit; a code comment says "140+" [code]
  `web/src/lib/skill-suggestions.ts:4-5`. [unavailable] for 149.
- **Selection and loading.** Model-driven. Skills are advertised in the system prompt by description and activated when
  the model reads a `SKILL.md`; Pi emits no "skill invoked" event, so Kady labels reads after the fact [code]
  `server/src/agent/skill-label.ts:1-14`; [doc] "The description is what the model uses to decide relevance"
  `docs/skill-management.md:41`. A UI helper suggests skills from uploaded file extensions by keyword [code]
  `web/src/lib/skill-suggestions.ts:1-20`, `web/src/components/chat-tab.tsx:857`. `disable-model-invocation: true`
  hides a skill and exposes `/skill:<name>` [doc] `docs/skill-management.md:43-45`.
- **Scoping.** Project (`sandbox/.pi/skills/`) wins over global (`~/.kady/pi-agent/skills/`); global skills reach child
  processes; live sessions keep the set they started with [doc] `docs/skill-management.md:8-15`. Personas can opt out of
  inheriting skills (`inheritSkills`) [code] `server/src/agent/agent-files.ts:62-63`. `allowed-tools` in a skill is not
  read anywhere in Kady's code [code] (only match for `allowedTools` is the capability ceiling in
  `subagent-control.ts:47`); whether Pi enforces it is [unavailable].
- **Updates.** The catalogue syncs at launch and daily from `K-Dense-AI/scientific-agent-skills@main` plus
  `anthropics/skills@main` (branches, not commits); a per-project manifest of upstream tree hashes lets unchanged skills
  update while local edits are kept and flagged, and upstream removals are archived [code] `server/src/config.ts:41-65`,
  `server/src/agent/skills-sync.ts:1-70`; [doc] `docs/skill-management.md:17-30`. Third-party installs stage exact bytes
  behind a trust acknowledgement that is "not a content audit" [doc] `docs/skill-management.md:34-37`, `:47-50`.
- **Refusals.** Some providers refuse whole requests because of specific skill descriptions in the system prompt; Kady
  explains the refusal but never filters skills [doc] `AGENTS.md:127`; [code] `server/src/agent/run-pipeline.ts:319-335`.

---

## 5. Tools, MCP, compute and models

### 5.1 Per-agent scoping and least privilege

| Layer | Rule | Evidence |
|---|---|---|
| Lead | Denylist, not allowlist: everything registered is active except two lazy loaders; an allowlist would hide MCP tools whose names are unknown at build time | [code] `server/src/agent/tools.ts:10-28`, `server/src/agent/session-registry.ts:474-480` |
| Child ceiling | Parent's tools minus `interview`, the loaders and `subagent_supervisor`, plus `contact_supervisor`, `codemode`, `tool_search` | [code] `server/src/agent/subagent-control.ts:47-50` |
| Child allowlist | Optional per persona; empty = inherited toolset; `mcp:<server>` or `mcp:<server>/<tool>` grants connector tools | [doc] `docs/sub-agents.md:125-132`, `docs/mcp-servers.md:81-88` |
| Seeded personas | No allowlist, so full inherited tools | [code] `server/src/agent/agent-files.ts:478-487` |
| Schedules | Creation-time ceiling intersected with current policy | [doc] `docs/automation.md:31-35` |
| Fusion | All local tools disabled for the turn | [code] `server/src/api/sessions.ts:841-858`; [doc] `docs/openrouter-fusion.md:9-12` |
| OS | None: tools run as the backend's OS user; the sandbox is a workspace, not isolation | [doc] `docs/limitations.md:19-25`, `docs/security.md:3-5` |

**Reading [inference].** Scoping narrows *which tool names* a child can call, not what a shell call can reach. With
`bash` in the default set, least privilege holds only for read-only personas that a user hand-configures.

### 5.2 MCP

Pi's built-in MCP extension reads global and project `mcp.json` (project wins), registers `mcp__<server>__<tool>`, and
by default exposes connector tools only to short "codemode" scripts that search and call them [doc]
`docs/mcp-servers.md:8-11`, `:67-79`; [code] `server/src/agent/mcp.ts:1-25`. Nested codemode calls pass through the
guard and provenance hooks, which "do not inspect every external tool's internal effects" [doc]
`docs/mcp-servers.md:77-79`. Provider logins can be sent as bearer tokens only from the global file, so a project cannot
redirect credentials [doc] `docs/mcp-servers.md:46-47`. Connector secrets are shown unmasked in Settings [doc]
`docs/mcp-servers.md:91-93`, `docs/security.md:48`.

### 5.3 Modal compute

The engineering here is careful [doc] `docs/modal-compute.md:19-92`; [code] `server/src/modal/manager.ts:337-365`,
`:435-463`:
- jobs move `queued → preparing → running → collecting → succeeded|failed|cancelled|lost` and persist under
  `.kady/modal/jobs/`; restart recovery reconnects by saved sandbox id and cleans tagged orphans;
- a lost creation response is an uncertain launch: never auto-rerun, counted at full reservation;
- inputs are hashed and re-checked remotely; outputs are checked before and after download and installed atomically,
  re-checking the raw-data guard;
- admission reserves the most expensive fallback's rate over the timeout plus headroom, and checks spent + reserved +
  new against the cap; credentials stay on the host.

Model calls, by contrast, get no worst-case reservation, so concurrent calls can overshoot the cap [doc]
`docs/model-selection.md:107-110`.

### 5.4 Models

- **References** are `<provider>/<model-id>` across OpenRouter, ~30 direct providers, subscription logins, Ollama,
  OpenAI-compatible and custom servers [doc] `docs/model-selection.md:37-50`; [doc] `AGENTS.md:49`.
- **Defaults and fallback.** Saved app default → `.env` → built-in `openrouter`/`openai/gpt-6-astra`
  [code] `server/src/config.ts:85-88`; [doc] `docs/model-selection.md:71-74`. An unresolvable saved default "falls back
  silently so sessions stay openable" [doc] `AGENTS.md:78`.
- **Per-agent model.** Specialists inherit the chat model unless a workflow-level model, persona frontmatter, a project
  specialist default or the verifier override applies [doc] `docs/model-selection.md:3-5`, `docs/sub-agents.md:109-117`.
- **Billing classes.** Pay-as-you-go and Anthropic OAuth count toward the cap; subscription logins, NIM and local models
  record tokens at $0 [doc] `docs/model-selection.md:81-96`.
- **Custom servers** declare their own per-million-token prices, which Kady cannot verify [doc]
  `docs/custom-model-servers.md:32-36`.
- **Fusion** sends one prompt to a panel plus a judge on OpenRouter, priced as panel + 2× judge, with no tools; the
  docs warn that "Multiple responses are not independent scientific evidence" [doc]
  `docs/openrouter-fusion.md:9-29`.

---

## 6. Memory and provenance

### 6.1 What is recorded

| Record | Writer | Content | Integrity | Evidence |
|---|---|---|---|---|
| Pi session JSONL | Pi | Full transcript per tab | none | [doc] `docs/architecture.md:51` |
| Lab notebook | The `notebook` tool (lead live; children harvested on completion, parent is the single writer) | Typed entries: hypothesis/method/observation/decision/note, evidence links, outcome, execution status, supersedes | append-only JSONL; citation-time file hashes for lead entries | [code] `server/src/agent/notebook-store.ts:19-56`, `:100`; `server/pi-packages/kady-notebook/index.ts:1-14`; `server/src/agent/notebook-artifacts.ts:1-4` |
| Analysis plans | User via HTTP (no agent tool) | Frozen plan + deviations per hypothesis | **digest chain**: each event carries `previousDigest`, `sequence`, `actor:"user"`; published by exclusive hard link after fsync; any break → 503 | [code] `server/src/agent/notebook-plans.ts:44-69`, `:85-110`, `:170-210` |
| Provenance | The run loop from Pi events; no agent tool writes it | One step per tool call: inputs/outputs with `observed`/`inferred`/`declared` confidence, model, environment id | append-only JSONL | [code] `server/src/provenance/store.ts:9-45`, `:126-158`, `:293`; `server/src/provenance/recorder.ts:1-35` |
| Environments | Recorder | Python/R packages, lockfile hashes, git HEAD, OS | content-addressed files | [doc] `docs/provenance.md:44-55` |
| Cost ledger | Run pipeline, child meter | Per-run usage and USD by role | append-only JSONL; durable receipts for child usage | [code] `server/src/cost/ledger.ts:168-219`; [doc] `AGENTS.md:101` |
| Evidence packages | User-triggered build | Selected records, provenance, plans, version-matched artifact bytes, `checksums.sha256`, `verify.py`, RO-Crate 1.1, `missing-information.md` | ZIP SHA-256 checked on every download; content-addressed blob vault | [code] `server/src/evidence/packages.ts:24-41`, `:250-280`, `:312`; [doc] `docs/evidence-packages.md:18-66` |
| Per-agent `MEMORY.md` | The child model itself | Free text; first 200 lines injected into later runs | none; off by default | [doc] `docs/sub-agents.md:132`, `:138-143`; [code] `server/src/agent/agent-files.ts:65-69` |
| Compaction state block | Compaction hook | Deterministic preamble rebuilt from notebook, plans, results, provenance and pending jobs, plus a model summary | rebuilt fresh each time; the previous summary's records are not reused | [doc] `docs/lab-notebook.md:93-104`, `AGENTS.md:126` |

**Provenance quality [code].** File edges carry a confidence that is never upgraded: `write`/`edit` name their file and
are hashed (`observed`); `bash` and `subagent` get a before/after stat scan, downgraded to `inferred` when scans lag;
command-line file mentions give `inferred` inputs; child work inspected at harvest is marked `identityAt: "harvest"`
and can never read as `current` [code] `server/src/provenance/recorder.ts:9-35`, `server/src/provenance/store.ts:38-60`;
[doc] `AGENTS.md:52`. Budget overflows are surfaced (`sandbox-too-large`, `unhashed`, `truncatedEdges`) rather than read
as absence [doc] `docs/provenance.md:66-80`.

### 6.2 What is shared across agents

- **Shared:** the sandbox files (every tab and child) [doc] `docs/architecture.md:34-36`; the project `AGENTS.md`,
  skills and connectors [code] `server/src/agent/agent-files.ts:482-484`; the notebook, read through the read-only
  `notebook_search` tool available to lead and children (lexical, bounded, returns digests for exact re-reads) [doc]
  `docs/notebook-memory.md:22-43`, `:51-56`.
- **Not shared:** a child does not see the lead's interview form [doc] `docs/sub-agents.md:24`; a fresh child does not
  see the lead's conversation [code] `server/src/agent/subagent-control.ts:60`; specialist memory is per role [doc]
  `docs/sub-agents.md:140-143`.
- **Data guard.** Protected globs (default `user_data/**`) are read-only for write/edit/bash in lead and children;
  destructive shell commands elsewhere pause for a permission card in the lead and are blocked outright in children;
  the classifier is heuristic and the docs call it "not a security boundary" [code]
  `server/src/agent/data-guard.ts:32-73`, `server/pi-packages/kady-guard/index.ts:1-11`; [doc]
  `docs/data-guard.md:9-23`, `:41-47`.

### 6.3 Tamper-evidence

- **Real but narrow.** Plan journals are chained and exclusively published [code]
  `server/src/agent/notebook-plans.ts:44-69`, `:97`. The digest is plain SHA-256 over canonical JSON, with no key and no
  copy outside the sandbox [code] `server/src/canonical-json.ts:1-9`, so a writer who recomputes the chain is not
  detected [inference]. Evidence-package ZIPs are re-hashed before each download [code]
  `server/src/evidence/packages.ts:312`.
- **Absent elsewhere.** Notebook, provenance and ledger rows are appended with `appendFileSync` and no chain [code]
  `server/src/agent/notebook-store.ts:100`, `server/src/provenance/store.ts:293`, `server/src/cost/ledger.ts:219`. The
  docs are explicit: "These same-user local files are not tamper-proof" [doc] `docs/lab-notebook.md:113-114`. The
  "unauthorable" claim for child provenance rests on reconstructing it from the child's session file [code]
  `server/src/agent/session-registry.ts:418-420`; a child with `bash` in a shared sandbox could plausibly edit files
  the host later reads [inference, not tested; the session-file location under `.pi/` is [doc]
  `docs/architecture.md:51`].
- **Overclaim.** The README and paper title say "hash-chained lab notebook" [doc] `README.md:38`; the README's own body
  limits the chain to plan revisions [doc] `README.md:94`. The paper itself is [unavailable].

---

## 7. Rule-following for research programs

| Rule | Enforced by | Strictness | Evidence |
|---|---|---|---|
| Raw data is read-only | Tool-call hook on write/edit/bash/generate_image | Hard for named tools; heuristic for shell; bypassable from Python or aliases | [code] `server/src/agent/data-guard.ts:37-53`; [doc] `docs/data-guard.md:41-47` |
| Spend cap | Pre-run refusal; delegation and schedule gates; Modal reservations | Hard at admission; model calls can overshoot | [code] `server/src/agent/run-pipeline.ts:379-394`, `server/src/agent/subagent-bridge.ts:700-813`; [doc] `docs/model-selection.md:107-110` |
| Frozen analysis plan | Digest-chained journal; preview TTL 15 min; dataset identities rechecked | Hard for the record; **does not execute or enforce the plan** | [code] `server/src/agent/notebook-plans.ts:19`, `:120-156`; [doc] `docs/lab-notebook.md:59-62` |
| Deviations recorded | Deviation events against a field of a frozen revision | Hard for format; whether deviations are logged depends on the model or watchdog | [code] `server/src/agent/notebook-plans.ts:202`; [code] `server/src/agent/watchdog-settings.ts:182-183` (watchdog guidance text) |
| Sensitivity analyses | Reviewed robustness batch: exact script and specs, 2–16 specs, digest-bound approval, expiry, price-change re-review, all reservations before any job, every attempt retained | Hard | [code] `server/src/agent/notebook-robustness.ts:29-35`, `:116-140`; [doc] `docs/notebook-robustness.md:9-18`, `:77-89` |
| Completion claims need evidence | `completed` without evidence → `unverified` | Syntactic only | [code] `web/src/lib/notebook-execution.ts:14` |
| Proposals are not evidence | Proposal entries carry `proposalOnly`; excluded from Methods drafts | Hard in records | [code] `server/src/agent/notebook-store.ts:74-75`; [doc] `docs/next-experiments.md:25-28` |
| Verification before acceptance | "Verification gate" prompt; prove-verify ledger | Soft (prompt) | [code] `server/src/agent/subagent-prompts.ts:35-41`, `server/src/agent/prompts.ts:301-303` |
| Reproducibility | `/replicate` template; evidence packages state `not-reproduced` | Soft; packages never rerun | [code] `server/src/agent/prompts.ts:256-272`, `server/src/evidence/packages.ts:37-41` |
| Ask before assuming | `interview` tool + `AGENTS.md` | Soft | [doc] `AGENTS.md:108` |

**Reading [inference].** Kady is strict about **records, identity, money and approvals** and deliberately agnostic
about **scientific correctness**, which it leaves to the model and the human. Its docs repeat that hashes prove byte
identity, not validity [doc] `docs/provenance.md:41-42`, `docs/evidence-packages.md:49-53`. There is no protocol engine:
nothing executes a frozen plan as steps, and nothing gates a result on an executable check.

**Approval reachability [inference, not tested].** Plan freezes, robustness approvals and permission answers are HTTP
routes with no agent tool [code] `server/src/api/notebook-robustness.ts:29-31`, `server/src/api/sessions.ts:437-452`;
[doc] `AGENTS.md:114`. But the access token "is left in `process.env` on purpose" and "readable by the agent's own
shell" [code] `server/src/auth.ts:14-18`, and requests without Origin or fetch metadata (curl) pass the guard [code]
`server/src/request-guard.ts:20-22`. An agent that wanted to could approve its own robustness batch or freeze its own
plan. Likewise the guard's policy lives at `sandbox/.kady/policy.json` [code] `server/src/agent/guard-policy.ts:17-27`,
which the default protected glob does not cover, so an agent could rewrite its own guard [inference]. The docs frame all
of this as the same-user trust boundary [doc] `docs/limitations.md:19-25`, `docs/security.md:20-24`.

---

## 8. Limitations, security and performance claims

### 8.1 Stated limitations (credible, specific)

The limitations page is candid: models can ignore instructions; refusals can be caused by skill descriptions; the
sandbox is not isolation; caps use estimates; external CLIs bypass the ledger; hosted models and connectors receive
data; nested children are not harvested; compaction can lose detail [doc] `docs/limitations.md:3-69`. Every feature page
ends with a "does not prove" paragraph (e.g. `docs/notebook-memory.md:18-20`, `docs/evidence-packages.md:49-53`). This
honesty is a strength and matches Foundry's own reporting rules [inference].

### 8.2 Security

- **Network boundary is solid for a local app:** loopback by default, Host/Origin/fetch-metadata checks before CORS,
  token required when exposed, sandbox CSP on served files, `latexmk -norc` [code] `server/src/request-guard.ts:1-37`,
  `server/src/index.ts:103-116`; [doc] `docs/security.md:7-18`, `:42-48`, `AGENTS.md:128`.
- **Agent boundary is the OS user** [doc] `docs/security.md:3-5`. Consequences: the agent can read anything the user can
  (the seeded prompt asks it not to read `.env` or `~/.kady`) [code] `server/src/sandbox-seed.ts:67-70`; it can reach
  the API (§7); skills and specialist memory are instructions with full permissions [doc] `docs/security.md:52-56`.
- **Supply chain.** Pi and its extensions are pinned exactly and patched only at anchor-checked seams that refuse
  version drift [code] `server/package.json:16-29`, `server/scripts/patch-subagents.mjs:8-11`. But Fastify and others
  are caret ranges [code] `server/package.json:19-26`, the skill catalogue follows `main` daily [code]
  `server/src/config.ts:41-65`, and the postinstall hook patches a dependency [code] `server/package.json:13`.

### 8.3 Performance claims

| Claim | What it is | Credibility | Evidence |
|---|---|---|---|
| `docs/performance.md` | UI rendering contracts (frame coalescing, ETags, preview queue, PDF canvas eviction, CSV paging) with regression tests | Credible as engineering; says nothing about research capability | [doc] `docs/performance.md:1-56` |
| Platform figure | K-Dense BYOK 86.0 / 64.5 (scientific quality / research execution) vs Claude Science 74.8 / 26.0 vs Biomni Lab 64.9 / 38.3; 20/20 execution "firsts"; footer "Source: results/1–20 aggregate.json and judge_run1.json · Cursor Grok 4.5 judge · evaluated 2026-07-16" | **Low.** n = 20 prompts, designed, run and scored by K-Dense, one LLM judge run, rubric and per-prompt scores not in the repo, competitor configurations not given, and the evaluated build predates this commit by 2.5 months | [code] `docs/07_platform_performance_summary.png` (read as an image); [doc] `README.md:57-63` (states it is internal and Opus 4.8 xHigh); [unavailable] results files, rubric |
| CompBioBench #2 | 98% with GPT-6 Astra; 94%, 92%, 81% with three other models; exact-match answers held by the leaderboard | **Medium as a harness + model result.** External grading is real. But no bare-model baseline is reported, and the 17-point spread across models suggests the model drives most of the score; rank is time-stamped | [doc] `README.md:40-55`; [unavailable] leaderboard, blog |
| "Every step is on the record" | Marketing sentence | Overstated against the docs' own limits (nested children, opaque shell internals) | [doc] `README.md:30` vs `docs/provenance.md:57-80` |

---

## 9. Novel or strong vs commodity

**Strong (worth studying):**
1. **Observational provenance with graded confidence** and no model-writable path [code]
   `server/src/provenance/store.ts:9-45`, `server/src/provenance/recorder.ts:1-35`. Few agent harnesses separate
   observed, inferred and declared edges, or refuse to call a harvest-time hash "current".
2. **Digest-bound human approvals with expiry, re-quote on price change and all-or-nothing reservation** [code]
   `server/src/agent/notebook-robustness.ts:116-140`, `server/src/modal/manager.ts:435-463`.
3. **Uncertain-launch discipline for remote compute**: never rerun, count the full reservation, recover by tag [doc]
   `docs/modal-compute.md:44-49`.
4. **Evidence packages that list their own gaps** (`not-reproduced`, `rights-unverified`,
   `external-citations-unverified`) with version-matched bytes and a static verifier [code]
   `server/src/evidence/packages.ts:37-41`, `:271-275`; `server/src/evidence/report.ts:34-46`.
5. **Fail-closed static reading of model-written orchestration code** for budget and model routing [code]
   `server/src/agent/subagent-bridge.ts:300-358`.
6. **Version-pinned patch seams on a fast-moving dependency** that refuse to start on drift [code]
   `server/scripts/patch-subagents.mjs:8-11`.
7. **Status-vs-verdict handoff contract and comparative review** of independent attempts [code]
   `server/src/agent/subagent-prompts.ts:107-124`, `server/src/agent/subagents.ts:295-313`.
8. **Domain breadth:** 326 discipline procedures, 23 personas, 177 skills, 229 data-resource entries
   (`{id,name,url,description,category,domain}`) [code] `web/src/data/databases.json` (229 objects).

**Commodity:** the agent loop and delegation (Pi, pi-subagents), MCP and codemode, Agent Skills, prompt templates,
BYOK provider catalogue, Fusion panels, schedules, the watchdog, the chat UI and file previews [code]
`server/package.json:15-33`; [doc] `AGENTS.md:14`. The 326 workflows are a prompt library: their value is content, not
mechanism [inference].

---

## Mapping to Foundry

Status key: **does** (Foundry has it; cite), **partial**, **no**.

### M1. Capability by capability

| Capability | Kady | Foundry status | Foundry evidence |
|---|---|---|---|
| Typed, executable, per-task workflow | No (prose templates; untyped JS delegation scripts) | **does** | [code] `WF:schemas/workflow.schema.json:136-209`; [doc] `WF:docs/THESIS.md:37-41` |
| Construction by a cheap model from templates | No | **partial** (C0 dev: Haiku-built 11/16, directional) | [doc] `WF:README.md:187-216`; [code] `WF:experiments/library/cards/P01/card.json:25-149` |
| Library of reusable procedures | 326 static templates, unmeasured | **partial** (15 typed cards with applicability judgments, checklists, rules, fixtures; evidence ladder) | [code] `WF:experiments/library/cards/` (15 card dirs), `WF:experiments/library/store.mjs:22-30` |
| Need router (workflow or not) | No; user picks, model decides | **partial** (design; Jev-as-need-judge measured below a size rule) | [doc] `WF:docs/ROADMAP.md:624-635`; `WF:research/architecture-20261014/MEMORY-ROUTING-RECURSION.md:88-99` |
| Sub-workflow written by the agent | Yes, as untyped JS (pi-subagents) | **partial** (`subflow` designed with hard refusals and mutant-checked credit; `flow.call`/`flow.agent` in JIT experiments) | [doc] `WF:research/architecture-20261014/MEMORY-ROUTING-RECURSION.md:415-485` |
| Acceptance that a wrong answer can fail | No | **does** (grading + strict lint) | [code] `WF:src/acceptance.mjs:180-218`, `WF:src/lint.mjs:16-18` |
| Verifier independence | Optional different verifier model (unset by default) | **does** (`independence` label; same-model verifies do not gate) | [code] `WF:schemas/workflow.schema.json:189`, `WF:src/acceptance.mjs:192` |
| Independent oracles and sealed evaluation | No (internal LLM-judged benchmark) | **does** (beds with oracles, pre-registration, sealed families) | [doc] `WF:README.md:95`, `WF:docs/ROADMAP.md:553-563`, `WF:AGENTS.md` "Evidence and evaluation" |
| Tamper-evident run record | Plan journal only (unkeyed, no anchor) | **does** (event chain binding journal rows, decisions, transcripts; anchors outside the workspace) | [code] `WF:src/audit.mjs:1-12`, `:86-149` |
| Record/replay of model calls | No | **does** | [code] `WF:src/journal.mjs:1-10` |
| File-level provenance of what ran | **Yes, strong** | **no** for code/executor file effects (the journal covers model calls; executor transcripts are hashed) | [code] `WF:src/audit.mjs:3-9` |
| Injection resistance | Prompt text only | **does** (labels, control-flow taint, quarantined judgments) | [code] `WF:src/validate.mjs:239-245`, `WF:src/runtime.mjs:1078` |
| Code isolation | None (same user) | **does** for `code` nodes (user/net/mount/pid namespaces) | [code] `WF:src/sandbox.mjs:6-17` |
| Human approval bound to an exact preview | Yes (robustness, plans) | **partial** (`human` nodes, `foundry approve`; no digest+TTL+cost-quote binding found) | [code] `WF:schemas/workflow.schema.json:141`; [doc] `WF:docs/ROADMAP.md:715-716` |
| Cost reservation before admission | Yes for Modal; no for model calls | **partial** (spend rule and pause; `maxCost` budgets) | [code] `WF:policy/models.json:20-24`; [doc] `WF:docs/ROADMAP.md:576` |
| Uncertain effects never blindly retried | Yes (Modal) | **does** | [doc] `WF:README.md:488-490` |
| Frozen plans and deviations | Yes (per hypothesis) | **partial** (pre-registration documents, frozen cases and oracles by rule, not a runtime journal) | [doc] `WF:research/PREREGISTRATION-TEMPLATE.md`, `WF:docs/ROADMAP.md:1151-1152` |
| Evidence package for reviewers | Yes | **partial** (`verify-run`, anchors; in-toto/DSSE planned) | [doc] `WF:README.md:387-391`, `WF:docs/ROADMAP.md:700-711` |
| Memory: private by default | No: one shared sandbox per project; optional model-written `MEMORY.md` across runs | **does** (seven memories, rules R1–R10) | [doc] `WF:research/architecture-20261014/MEMORY-ROUTING-RECURSION.md:297-335` |
| Skills | 177+4, Agent Skills format, model-selected | **does** (in-repo `SKILL.md` packs, including `domain-science`) | [code] `WF:skills/micro-harness/SKILL.md:1-5`, `WF:skills/domain-science/SKILL.md:1-8` |
| Domain breadth (science) | Large | **partial** (one science skill and dossier; no scientific previews or compute) | [code] `WF:skills/domain-science/SKILL.md`; [doc] `WF:research/dossiers/science-robotics-healthcare.md` |
| Remote GPU compute | Modal, durable | **no** (no credentials) | [doc] `WF:README.md:340` |
| Capability measurement vs baseline | No public baseline | **does** (P1, C0 with CPS) | [doc] `WF:README.md:137-200` |

### M2. What to adopt (with source)

1. **Edge confidence for file effects of `code` and `executor` nodes.** Record per-node input/output files as
   `observed` (named and hashed), `inferred` (scan-attributed) or `declared` (model-asserted), never upgraded, with
   visible degradation on budget overflow. Source: `server/src/provenance/store.ts:38-60`,
   `server/src/provenance/recorder.ts:9-35`, `docs/provenance.md:66-80`. Fits Foundry's audit chain
   (`WF:src/audit.mjs:3-9`) as a new bound event. Cost: $0 build, no model calls [inference].
2. **Approval bound to a preview digest, with expiry and a cost quote.** For `human` approval nodes that authorize
   effects or spend: approve `{previewDigest, maxUsd}`, refuse after TTL or on a price change, and reserve the worst
   case before admission. Source: `server/src/agent/notebook-robustness.ts:29-35`, `:116-140`;
   `docs/modal-compute.md:63-74`. Pairs with Foundry's version-bound proposals (`WF:README.md:488-490`).
3. **Worst-case reservation for model calls**, which Kady itself lacks (`docs/model-selection.md:107-110`): reserve
   `maxTokens × price` per in-flight call, settle on completion. Source of the pattern: Modal reservations
   `server/src/cost/ledger.ts:311-408`. This closes Foundry's own gap where timed-out calls were recorded at $0
   (`WF:README.md:178-179`) [inference].
4. **Status vs verdict in executor handoffs.** Give the `executor` node a typed handoff:
   `status: completed|partial|blocked`, `checks[]` actually run, `artifacts[]` checked to exist, `open[]`, kept separate
   from the run verdict. Source: `server/src/agent/subagent-prompts.ts:107-124`. Foundry already separates construction
   from outcome qualification (`WF:docs/ROADMAP.md:502-503`).
5. **A prove-verify loop as a library card**, typed: a `loop` whose body fans out investigator `agent` nodes over
   distinct directions, gates each draft with an independent `verify`, runs one comparative judgment over the round, and
   keeps a `state` slot ledger of Verified/Excluded/Attempts. Source of the procedure:
   `server/src/agent/prompts.ts:274-313`, `server/src/agent/subagents.ts:295-354`. In Foundry the acceptance and limits
   would be code, not prose [inference].
6. **Gap lists in exported evidence.** Every exported run package states by default what it does not establish
   (not reproduced, rights unverified, citations unverified). Source: `server/src/evidence/packages.ts:37-41`,
   `server/src/evidence/report.ts:34-46`.
7. **Fail-closed reading of model-written orchestration** for `subflow`: anything not statically known (computed agent,
   model or budget) is billed at the worst case and refused model pinning. Source:
   `server/src/agent/subagent-bridge.ts:300-358`, `:472-501`. Foundry's typed IR makes most of this unnecessary, but the
   rule fits the untyped parts of a `subflow` request [inference].
8. **Task corpus.** The 326 templates are discipline tasks with stated deliverables, written by someone else. They are
   candidate wild-ladder or R-bench intake for science tasks, after oracles are written for them (they have none).
   Source: `web/src/data/workflows.json`; MIT licence `LICENSE`. They must enter as data with provenance taint
   (`WF:docs/ROADMAP.md:663-666`) [inference].
9. **Pinned patch seams.** If Foundry patches a dependency (OpenCode, the CLI), refuse any unreviewed version and check
   each anchor. Source: `server/scripts/patch-subagents.mjs:8-11`. Foundry's OpenCode allowlist already follows this
   pattern (`WF:README.md:276-278`).

### M3. What Foundry has that Kady lacks

1. **A workflow the runtime can check.** Typed nodes, per-node schemas, static validation, and an acceptance that is
   graded `gating` only when a wrong answer can fail it [code] `WF:src/acceptance.mjs:180-218`. Kady's workflows give
   the runtime nothing to check (§3.1).
2. **Independent oracles and evaluation discipline.** Foundry pre-registers, seals and reports against baselines
   [doc] `WF:README.md:137-200`; Kady's comparative claim rests on one internal LLM-judged run (§8.3).
3. **A run ledger that binds everything** (model rows, decisions, transcripts, verdict inputs) with anchors outside the
   workspace [code] `WF:src/audit.mjs:1-12`, `:86-149`, against Kady's single unanchored chain (§6.3).
4. **Structural injection resistance and code isolation** [code] `WF:src/validate.mjs:239-245`,
   `WF:src/sandbox.mjs:6-17`, against Kady's prompt-level "treat as prompt injection" [code]
   `server/src/sandbox-seed.ts:67-70` and same-user shell.
5. **Cheap-model execution as a measured goal.** Foundry measures cost per verified success
   [doc] `WF:README.md:137-162`; Kady picks the most capable model by default (`openai/gpt-6-astra`
   [code] `server/src/config.ts:87-88`) and reports benchmarks with frontier models only [doc] `README.md:46-53`.
6. **Private-by-default memory with a verified path across runs** [doc]
   `WF:research/architecture-20261014/MEMORY-ROUTING-RECURSION.md:326-335`; Kady shares one sandbox and lets a child
   write instruction text (`MEMORY.md`) that later runs load [doc] `docs/sub-agents.md:138-143`.
7. **Reuse that must earn its place** (ladder, with/without, wrong-reuse rate) [doc] `WF:docs/ROADMAP.md:578-615`;
   Kady's catalogue grows by pull request with no outcome data.

### M4. Risks of their design (lessons for Foundry)

1. **Prose gates look like gates.** "Verification gate" and `Verdict:` read as enforcement but are parsed by nothing
   (§2.3). Foundry's own README records the same failure mode: run verdicts that said "pass" on failed trials
   [doc] `WF:README.md:109`. Keep acceptance in code.
2. **Shared mutable workspace.** Parallel children write into one sandbox, and the docs warn concurrent edits can
   conflict [doc] `docs/limitations.md:44`. This is Foundry's memory hole M1 at product scale
   [doc] `WF:research/architecture-20261014/MEMORY-ROUTING-RECURSION.md:346`.
3. **Model-written cross-run instructions.** `MEMORY.md` is model-authored, loaded into later runs, and "not verified
   evidence" [doc] `docs/sub-agents.md:140-143`. Foundry's R6 forbids exactly this path.
4. **Approval endpoints reachable from the agent's shell** and a guard whose policy file the agent can edit (§7) [inference].
   Foundry has the analogous executor note (CLI login readable in the sandbox) [doc] `WF:README.md:113`.
5. **Unpinned skill supply.** Daily sync from `main` of executable instructions with shell access [code]
   `server/src/config.ts:41-65`; [doc] `docs/skill-management.md:47-50`. Foundry's pinning rule
   (`WF:AGENTS.md:39`) should stay.
6. **Silent fallback.** An unresolvable saved default model falls back silently [doc] `AGENTS.md:78`; Foundry forbids
   silent fallbacks (`WF:docs/ROADMAP.md:1149`).
7. **Correlated verifiers by default.** The verifier model is unset by default, so reviewers run on the producer's model
   [code] `server/src/app-settings.ts:46`. Foundry measures verifier miss rates instead of assuming independence
   [doc] `WF:research/architecture-20261014/MEMORY-ROUTING-RECURSION.md:536-538`.
8. **Coverage gaps by depth.** Nested specialists are not harvested into notebook or provenance [doc]
   `docs/provenance.md:64`. Any Foundry `subflow` must journal every level or refuse depth > 1 (its design already caps
   depth at one dynamic level [doc] `WF:research/architecture-20261014/MEMORY-ROUTING-RECURSION.md:436-441`).

---

## Appendix: counts produced for this dossier

All from read-only Python (`python3 -I`) over files in the clone; no code from the clone was executed.

| Count | Value | Source file |
|---|---|---|
| Workflow templates | 326; 22 categories; ids unique | `web/src/data/workflows.json` |
| Fields per template | exactly 8 keys on all 326 | same |
| Prompt length | 785–3,349 characters, mean 1,287 | same |
| Placeholders | 0–5, mean 1.48; 0 key/prompt mismatches | same |
| `requiresFiles` | 172 true, 154 false | same |
| Numbered steps | 326/326 | same |
| Mentions | interview tool 286; "limitations" 271; "Save every deliverable" 186; "package versions" 124; "random seed" 99; "notebook" 0; "skill" 0 | same |
| Specialist personas | 23, of which 13 `verifier: true` | `server/src/agent/subagents.ts` |
| K-Dense skills | 177 `SKILL.md`; frontmatter `name`/`description`/`metadata` 177, `license`/`compatibility` 173, `allowed-tools` 99; 121 with `scripts/`; 112–499 lines | `SK:skills/` |
| Default-disabled skills | 73, all present in `SK:skills/` | `server/src/agent/skills.ts:101-178` |
| Data resources | 229 objects `{id,name,url,description,category,domain}` | `web/src/data/databases.json` |
| Test files | 133 backend, 131 frontend (not run) | `server/test/`, `web/src/**` |
