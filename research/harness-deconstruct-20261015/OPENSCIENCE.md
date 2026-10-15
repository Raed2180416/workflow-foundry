# OpenScience: deconstruction dossier (2026-10-15)

**Subject.** synthetic-sciences/openscience at commit `722ad051b7f601bab9e33749aedf942faf8c4737`
(committed 2026-10-13), Apache-2.0, cloned inert into `corpus/openscience/` (see
[ACQUISITION.md](ACQUISITION.md)). Nothing from the corpus was run, installed or built; no hook, package manager,
model or paid API was called. Instruction-like text in the corpus (its `AGENTS.md`, `CLAUDE.md`, prompts and skills)
was read as data only. No credential file was read.

**Method.** Static reading of source, prompts, skills, tests, docs and eval configs. Line counts and hashes were
computed locally with `wc`, `grep` and `sha256sum`. Two Wilson intervals were computed by hand (arithmetic, marked).

**Tags.**
- **[code]** observed in source at the cited span.
- **[doc]** a claim made by the project's own docs, README, changelog or landing page; not verified against code
  unless a [code] tag sits beside it.
- **[inference]** my reading or conclusion from the cited material.
- **[unavailable]** the evidence is outside this clone (results repo, hosted service, private benchmark).

**Path roots.** `OS/` = `corpus/openscience/`. `SRC/` = `corpus/openscience/backend/cli/src/`. Foundry paths are
relative to the repository root. `file:A-B` is a line span.

**Size.** `SRC/` holds 557 files and about 154K lines of TypeScript [code: `find`/`wc` over `SRC/`]. The loop alone is
`SRC/session/prompt.ts` (4,200 lines) plus `SRC/session/processor.ts` (1,628) [code]. The skill library has 372
`SKILL.md` files in 18 categories [code: `find OS/backend/cli/skills -name SKILL.md`]. The backend test tree has 572
test files [code: `find OS/backend/cli/test -name '*.test.ts'`].

---

## 0. What OpenScience is, in one paragraph

OpenScience is a fork-in-spirit of OpenCode: one general tool-using agent loop (`research`) with a science-specific
system prompt, an on-demand skill library, a Task tool that spawns worker sessions, a permission and sandbox layer,
durable compute jobs, and a handful of small "harness units" that run when the model tries to finish a turn and can
push it back to work [doc: `OS/README.md:113-125`, `OS/docs/notes/harness-refinement-plan.md:16-40`; code:
`SRC/harness/index.ts:12-41`]. The research method lives almost entirely in prose (system prompt, skills, reminders);
code owns state, durability, permissions, compute and a few mechanical checks [inference from §2–§6]. It does not
build typed plans or workflows, and its strongest "contract" machinery (a research contract with preregistration) is
present in source but has no caller in the current build (§6.2) [code].

---

## 1. Architecture

### 1.1 Processes and components

| Component | What it is | Evidence |
|---|---|---|
| CLI binary | Bun/TypeScript compiled to one native binary per platform; `openscience` with no subcommand opens the workspace; `run`, `serve`, `web` commands | [doc] `OS/ARCHITECTURE.md:67-71`; [code] `SRC/index.ts:192-200` |
| Local server | Hono server; binds `127.0.0.1`; Host/Origin allowlist; optional bearer token; serves the embedded UI and session/runtime APIs, streams events over SSE | [doc] `OS/ARCHITECTURE.md:9-26`; [code] `SRC/server/server.ts:943`, `SRC/server/host-guard.ts` |
| Public runtime protocol | `POST /prompt` returns 202 with a run id; request receipts written before model execution; identical request id replays, changed content conflicts | [doc] `OS/ARCHITECTURE.md:28-42`; [code] `SRC/server/routes/runtime.ts:100-135`, `SRC/runtime/runs.ts:16-60,373-380` |
| Agent runtime | session store, message loop, compaction, tool dispatch, recovery | [code] `SRC/session/prompt.ts:935-2088`, `SRC/session/processor.ts:934` |
| Agent registry | `research` (primary), `plan` (hidden read-only mode), `explore`, five specialists (`ml`, `biology`, `physics`, `chemistry`, `data`), `general`, internal `compaction`, `title`, `summary`, `reader` | [code] `SRC/agent/agent.ts:192-386` |
| Tool layer | built-ins (bash, read, edit, write, task, skill, python/R kernels, literature, compute_job, study, experiments, artifact, scientific_capability, 7 biology DB tools, 3 science DB tools), plugin tools, MCP tools | [code] `SRC/tool/registry.ts:183-224`, `SRC/tool/biology/ids.ts`, `SRC/tool/science.ts:107,154,229` |
| Science connectors | ~49 HTTP connectors in 6 domains (proteins, genomics, chemistry, pathways, literature, omics) behind one registry | [code] `SRC/science/connectors/index.ts:15-33` and the per-domain files |
| Compute | durable local/SSH/scheduler/Modal jobs; approval bound to a plan digest | [doc] `OS/docs/adr/0001-modal-compute-control-plane.md:13-31`; [code] `SRC/tool/compute-job.ts:946-993` |
| Sandbox | macOS Seatbelt or Linux bubblewrap around shell, kernels and local jobs; deny-by-default reads/writes; network deny by default in contained modes | [code] `SRC/sandbox/sandbox.ts:11-28,758`, `SRC/project/access.ts:105-111`; [doc] `OS/SECURITY.md:7-11` |
| Frontend | SolidJS workspace (555 TS/TSX files) embedded in the binary; Electron shell; docs and landing sites | [doc] `OS/ARCHITECTURE.md:102-107`; [code] `OS/frontend/workspace/src/`, `OS/frontend/desktop/src/main.mjs` |
| SDKs and adapters | generated TS SDK, stdlib Python client, Harbor installed-agent adapter pinned to Harbor 0.22.0 | [doc] `OS/ARCHITECTURE.md:109-115`; [code] `OS/tooling/harbor/openscience_harbor/agent.py:317` |
| Trace sharing | signed-in installs upload full traces by default (prompts, responses, tool I/O), redacting known credentials; user can opt out | [doc] `OS/ARCHITECTURE.md:80-82`, `OS/SECURITY.md:21`; [code] `SRC/session/usage-logging.ts`, `SRC/session/trace-payload.ts` |

### 1.2 One research request, end to end

Traced through the code for a prompt sent from the workspace or the runtime API.

1. **Admission.** The workspace calls `POST /session/:id/prompt` (`SRC/server/routes/session.ts:837-860`), which
   streams the result of `SessionPrompt.submit`; an integration calls `POST /prompt`
   (`SRC/server/routes/runtime.ts:100-135`), which goes through `RuntimeRuns.prompt` → `admit` (receipt, conflict
   check) → `execute` (`SRC/runtime/runs.ts:373-380`) [code].
2. **User message.** `SessionPrompt.prompt` (`SRC/session/prompt.ts:396-444`) writes the user message through
   `createUserMessage` (`:2632`), which fires the plugin hook `chat.message` (`:3142`). The harness units listen here:
   on the **first** real user message of a root session, `Deliverables.detect` and `Acceptance.detect` extract named
   output files and stated verifier commands by regex (`SRC/harness/deliverables.ts:639-669`,
   `SRC/harness/acceptance.ts:548-569`), and the budget unit records a deadline if one was passed
   (`SRC/harness/budget.ts:100-114`) [code].
3. **Loop admission.** `loop` takes an in-process controller and a cross-process file lease for the session
   (`SRC/session/prompt.ts:2090-2124`), then `execute` (`:935`) [code].
4. **Recovery.** `execute` repairs incomplete messages, reconciles interrupted Task attempts and tools, restores loop
   counters, and prunes old tool outputs before the first step (`SRC/session/prompt.ts:936-992`) [code].
5. **Step loop.** `while (true)` (`:1006`) re-reads the transcript each step and decides, in order: terminal error →
   stop (`:1148`); output-limit continuation or stall stop (`:1173-1209`); **finished answer → `loop.before_finish`
   hooks, which may inject a continuation, at most 4 per turn** (`:99`, `:1211-1236`); text doom-loop stop
   (`:1239-1249`); pending subtask (a `/command` routed to a worker) (`:1298-1499`); pending compaction
   (`:1500-1522`); proactive prune/compaction (`:1523-1631`); otherwise a normal model step (`:1633`) [code].
6. **Normal step.** Render the agent prompt (science block and, for specialists, the domain skill index)
   (`:1639`, `SRC/session/system.ts:73-79`); insert the posture reminder (effort, delegation level, autonomy)
   (`:1642`, `:3270-3350`); preload any `/skill` the user named (`:1683-1704`); compute whether delegation is allowed
   (`:1707`); resolve the tool set (`:1710`, `:2240-2505`); append status reminders (time, spend, study state) as a
   durable harness message and loop again (`:1754-1775`); announce tool-set changes (`:1777-1798`); assemble the
   system prompt (`:1800-1823`): environment block, AGENTS.md/CLAUDE.md instructions, the core-skill index (or the
   full skill listing on a slash invocation), reminders [code].
7. **Context preflight.** Estimate tokens of system + tools + history; prune or compact before sending; refuse a
   request that cannot fit (`:1851-1930`) [code].
8. **Model call.** `processor.process` (`:1971`) → `LLM.stream` (`SRC/session/llm.ts:104`) → AI SDK `streamText`
   (`:316`). Tool calls run through `processor.executeTool` (`SRC/session/processor.ts:917`) wrapped by the Plan-mode
   gate, plugin `tool.execute.before/after`, a repeat guard and `PermissionNext.ask` (`SRC/session/prompt.ts:2337-2390`)
   [code].
9. **Tools act.** e.g. `bash` runs inside the sandbox plan (`SRC/sandbox/sandbox.ts:825-880`); `task` creates a child
   session and runs the same `SessionPrompt` loop inside it (§2.6); `compute_job` asks for a digest-bound approval
   (`SRC/tool/compute-job.ts:946-993`) [code].
10. **Finish.** When the model returns text with no further tool call, `loop.before_finish` runs the units in
    registration order: deliverables, acceptance, unattended, review, budget (`SRC/harness/index.ts:23-41`). Any unit
    may set a message; the loop enqueues it as a synthetic "harness" user message and continues (`:1226-1229`). With
    no message, the loop exits and resolves waiting callers (`:2068-2087`) [code].
11. **Side jobs.** On step 1 a title and a session summary are generated with a small model, fire-and-forget
    (`:1933-1946`, `SRC/provider/provider.ts:3379-3409`) [code].

---

## 2. The agent loop and the "research harness"

### 2.1 Planning and plan mode

- **No planner in the loop.** Nothing produces a structured plan or task graph. The default prompt tells the model to
  write a `todowrite` list for work with three or more steps (`SRC/agent/prompt/anthropic.txt:24-25`) and, for
  specified outputs, to write a deliverables checklist before computing (`SRC/agent/prompt/science.txt:12`) [code].
  The design note states this is deliberate: "No mandatory planner/checker/critic sequence, contract file, artifact
  ceremony, or verifier gate for every answer" (`OS/docs/notes/scientific-harness-design.md:61-68`) [doc].
- **Plan mode** is a hidden primary agent whose ruleset denies edits except plan files
  (`SRC/agent/agent.ts:209-232`), entered with `/plan` (`SRC/command/index.ts:107-118`). Its prompt asks for one plan
  covering objective, deliverables, inputs, method, validation, permissions, cost bounds and stopping conditions
  (`SRC/session/prompt/plan.txt:1-14`) [code].
- **Plan mode is enforced in code, fail-closed:** every tool call made under agent `plan` passes `PlanMode.enforce`,
  which allows only `invalid, read, list, glob, grep, question, recall, todowrite`
  (`SRC/tool/plan-mode.ts:1-20`, applied in `SRC/tool/tool.ts:103` and `SRC/session/prompt.ts:2342`) [code]. Tests
  show bash, write, apply_patch, python, r, task, artifact and even `plan_exit` are refused in plan mode
  (`OS/backend/cli/test/tool/plan-mode.test.ts:64-117`) [code].
- **Consequence.** The plan is the chat answer, not a persisted, approved artifact; the experimental plan-file
  instructions (`SRC/session/prompt.ts:3326-3347`) are flag-gated and conflict with the allowlist, which refuses
  `edit`/`write` [inference from the two spans].
- **`/goal`** injects "Treat it as binding: write the deliverables checklist first … continue until every item is
  complete or genuinely blocked" (`SRC/command/index.ts:119-135`) [code]. A `goal` system skill file exists
  (`SRC/skill/system/goal.txt`) but no TypeScript references it [code: grep finds no import].

### 2.2 Decomposition

- Decomposition is the model's choice, steered by a posture reminder: Off / Low / Auto / High delegation, with Auto
  saying "Delegate, in parallel when branches are independent, whenever it shortens the path to the result … an
  independent re-implementation of a computation is new evidence … a re-reading of your own evidence by your own model
  is not a check" (`SRC/session/prompt.ts:2544-2565`) [code].
- The `delegation` core skill gives rules for when to delegate and never to delegate the literature retrieval loop or
  a step of a running experiment loop (`OS/backend/cli/skills/core/delegation/SKILL.md:19-58`) [code].
- The only code-owned decomposition is the **study** loop (§6.3): ideas are typed records, one run per idea [code].

### 2.3 Stopping criteria

| Stop | Mechanism | Evidence |
|---|---|---|
| Model ends its turn | a finish with no tool call, after the before-finish units are silent | [code] `SRC/session/prompt.ts:1211-1236` |
| Before-finish injections exhausted | at most 4 per turn (`HARNESS_INJECTION_LIMIT`); deliverables ≤2 rounds, acceptance ≤3, review ≤2, unattended 1, budget 1 | [code] `SRC/session/prompt.ts:99`, `SRC/harness/deliverables.ts:690`, `SRC/harness/acceptance.ts:590`, `SRC/harness/review.ts:46`, `SRC/harness/unattended.ts:59`, `SRC/harness/budget.ts:126-128` |
| Max steps | only if an agent sets `steps`; no built-in agent does, so the default is unbounded | [code] `SRC/session/prompt.ts:1640`, `SRC/agent/agent.ts:192-386` (no `steps`) |
| Repetition guards | text doom loop (3 near-identical turns), output-limit stall, repeated identical call, repeated tool errors (guidance at 2, stop at 3); the redirect unit converts the first trip into a strategy-change message | [code] `SRC/session/prompt.ts:1179-1249`, `SRC/session/processor.ts:41,169-170`, `SRC/harness/redirect.ts:4-27` |
| Context exhaustion | compaction once, then a terminal error | [code] `SRC/session/prompt.ts:2038-2058` |
| Deadline | **advisory to the model** (reminders at 50% and 85%, a nudge if deliverables fail with >15% left); the headless CLI stops waiting after the deadline; native task limits are enforced by Harbor | [code] `SRC/harness/budget.ts:58-91,120-132`, `SRC/cli/cmd/run.ts:510,643` |
| Cost | soft ceiling `harness.cost.max_usd` produces one wrap-up reminder, "never a hard stop" | [code] `SRC/harness/cost.ts:7-13,96-107` |
| Unattended question | in `autonomous` mode a final answer that asks the user something is answered once with "proceed on the inputs as supplied" | [code] `SRC/harness/unattended.ts:1-79` |

### 2.4 Retries

- Provider retries: exponential backoff from 2 s, factor 2, cap 60 s, ±25% jitter, honours `retry-after`, at most 5
  transient attempts (`SRC/session/retry.ts:5-60`, `SRC/session/processor.ts:48,359`) [code].
- Tool retry guard: records terminal webfetch failures and kernel timeouts and blocks identical retries
  (`SRC/session/tool-retry-guard.ts:1-60`) [code].
- Provider/auth/payment/cancel errors are terminal for the attempt; a restart does not resend the same request
  (`SRC/session/prompt.ts:1144-1148`) [code]. A paid Modal command is never rerun during delivery recovery
  (`OS/docs/adr/0001-modal-compute-control-plane.md:35`) [doc].

### 2.5 Verification and critique

What verifies a result, ranked by strength:

1. **Acceptance unit (executable, mechanical).** Commands that the *first* request states as requirements (e.g.
   "`pytest -q` must pass") are extracted by regex, filtered to a verifier allowlist (lake/lean, pytest, make test,
   cargo test, npm test, go test, coq, ctest, scripts named `*check*`/`*verif*`/`*test*`, …)
   (`SRC/harness/acceptance.ts:31-35,60-110`), and run before the turn may end through the session's own bash tool,
   "under the same permission rule and card, inside the same sandbox" (`:384-428`), with a 15-minute timeout (`:545`).
   Banned tokens ("avoid `sorry` under `src/`") are grepped (`:467`). Failures go back to the model verbatim, up to 3
   rounds (`:572-592`) [code]. This is the closest thing to an executable contract in OpenScience.
2. **Deliverables unit (mechanical, format-level).** Output paths named in the first request are checked for
   existence, non-empty, parseable (JSON/CSV/TSV/YAML/npy…), stated CSV header, ragged rows, NaN/Inf, placeholder words
   (TODO, TBD, dummy…), up to 2 rounds (`SRC/harness/deliverables.ts:10-16,455-615,673-692`). The model is told the
   contract up front in `<env>` (`:618-628`) [code].
3. **Review unit (one model read, fresh context).** If a named deliverable is a prose report (≥400 words, ≥15
   sentences), a `reader` agent reads only the request, the report and the other outputs and lists what a grader would
   deduct for, or answers `COMPLETE` (`SRC/harness/review.ts:14-31,52-97,187-261`;
   `SRC/agent/prompt/reader.txt:1-26`). A second read happens only if the first listed ≥3 gaps and ≥25% of the time
   budget remains (`:41-46,195-200`) [code]. It uses **the lead's own model** (`:217`) and **fails open**: an error
   returns `COMPLETE` (`:247-250`) [code].
4. **Task evidence (records, not prose).** A worker's result carries artifact versions with sha256, shell receipts
   with exit codes and files changed, all derived from persisted tool records, with the explicit note that "an outer
   exit 0 alone does not verify nested tests or scientific conclusions" (`SRC/tool/task-evidence.ts:5-6,130-175`)
   [code].
5. **Prompt rules.** The science block demands mechanical checks of each deliverable "on the files as they are at the
   end and under the conditions the grader will use", held-out checks, refusal of surrogate agreement as evidence,
   and no placeholder values (`SRC/agent/prompt/science.txt:12-22`) [code]. These are instructions; nothing checks
   compliance beyond units 1–3 [inference].
6. **Critique on request.** `/review` loads the peer-review skill and reviews the session's deliverables "as an
   independent referee" in the same session and model (`SRC/command/index.ts:148-158`,
   `SRC/command/template/review.txt:1-7`) [code]. The former `critique`, `physics-critique`, `literature-review`,
   `reviewer` and `artifact-reviewer` agents are **retired**: listed in a `removed` set and mapped to the default
   agent on resume (`SRC/agent/agent.ts:388-401`, `SRC/session/prompt.ts:2177-2192`) [code]; the changelog confirms
   "review is the `/review` command" (`OS/CHANGELOG.md:1945-1950`) [doc].

So the task's premise of "critique" and "literature review" sub-agents is out of date at this commit: literature
review is a core skill run by the lead, and critique is a skill plus a slash command [code].

### 2.6 Sub-agents: how they are spawned, what they get, how results return

| Aspect | Behaviour | Evidence |
|---|---|---|
| Spawn | the `task` tool, `subagent_type` = agent name; optional `task_id` resumes a child; optional `background` | [code] `SRC/tool/task.ts:99-122,352-378`; `SRC/tool/task.txt:1-12` |
| Depth | `subagent_depth` default 1: workers cannot spawn workers | [code] `SRC/tool/task.ts:385-393`, `SRC/session/prompt.ts:2323` |
| Concurrency | no cap on workers; no isolated worker workspace | [doc] `OS/CHANGELOG.md:1951-1957` |
| Publishing | briefs that mention push/upload/release are refused; publishing stays with the lead | [code] `SRC/tool/task.ts:297-301,379-384` |
| Profiles | `explore` (read-only scout), `general`, and specialists `ml`, `biology`, `physics`, `chemistry`, `data`, all from one template with a domain skill index and some domain tools | [code] `SRC/agent/agent.ts:162-190,233-324`; `SRC/agent/prompt/specialist.txt:1-15` |
| Context | a fresh session: the specialist prompt (science block + domain skill index), the brief as the user message, optional attachments; **no parent transcript** | [code] `SRC/tool/task.ts:478-484,552-567`, `SRC/session/system.ts:103-124` |
| Files | the child works **in the parent's working directory**; the parent can read the child's scratch | [code] `SRC/tool/task.ts:486-491` |
| Permissions | child inherits the parent session's denies and directory rules, plus deny `todowrite`, `task`, `question` unless its own ruleset allows them | [code] `SRC/tool/task.ts:142-160` |
| Model | the agent's configured model, else the user's "worker model" setting, else the lead's model | [code] `SRC/tool/task.ts:446-459` |
| Result | only the text after the child's last tool call is the handoff; it is wrapped in a `<task>` envelope with a typed outcome (`completed`, `partial` with `max_steps`/`tool_failures`/`tool_partial`/`provider_error`/`cancelled`/`empty_handoff`, `error`) and the evidence block from §2.5.4 | [code] `SRC/tool/task.ts:223-239,267-293,307-318,616-683` |
| Durability | a Task attempt is reserved with a canonical fingerprint before dispatch; restart recovery returns a completed result without rerunning; heartbeats every 5 s | [code] `SRC/tool/task-attempt.ts:10-80`, `SRC/tool/task.ts:458-471,503-571` |
| Background | detached child; on completion the parent is woken with a synthetic message carrying the same envelope | [code] `SRC/tool/task.ts:686-750`, `SRC/session/wake.ts` |
| Handoff format | the specialist prompt asks for Outcome / Findings / Evidence / Changes / Verification (exact command, exit code, what it proves) / Limitations / Next action; free text, not a schema | [code] `SRC/agent/prompt/specialist.txt:12-13` |

---

## 3. Skills

### 3.1 Inventory and provenance

- 372 `SKILL.md` files: biology 66, ml-training 52, databases 39, chemistry 30, llm-tools 30, physics 28, coding 22,
  core 22, other 17, data-engineering 12, cloud-compute 11, research 10, ml-inference 9, writing 8, visualization 6,
  document-parsing 5, quantum 4, scholar-evaluation 1 [code: per-directory count]. The landing page says 371 in 18
  categories (`OS/frontend/landing/src/data/benchmark.ts:18-19`) [doc]; the docs say "roughly 340" library skills plus
  core (`OS/frontend/docs/src/content/openscience/skills.mdx:8`) [doc].
- 274 are derived from other collections: K-Dense scientific-agent-skills 166, K-Dense scientific-writer 14,
  Orchestra AI-Research-Skills 79, Hugging Face 8, Anthropic document skills 4, NVIDIA BioNeMo 2, MarkItDown 1
  (`OS/backend/cli/skills/ATTRIBUTION.md:18,199,223,313,332,349,364`) [doc]. 97 files name Synthetic Sciences as
  author [code: grep of frontmatter]. Each derived skill records upstream path, licence and relationship in its
  frontmatter (`OS/backend/cli/skills/ATTRIBUTION.md:1-15`) [doc].
- A metadata catalog pins upstream SHAs for three sources and gives a handful of entries a status
  (`verified`/`experimental`/`review_required`/`blocked`) (`SRC/skill/catalog.ts:18-99`) [code]. Only about ten skills
  have catalog entries; "verified" for `literature-review`, `paper-writing` and `ml-paper-writing` is a hard-coded
  label with no linked evidence [code: `SRC/skill/catalog.ts:67-91`; inference].

### 3.2 Format

Agent Skills format: a directory with `SKILL.md` (YAML frontmatter + Markdown) and optional `references/` and
`scripts/`. Frontmatter fields: `name`, `description`, `summary` (≤120 chars for indexes), `category`, `tags`, `role`,
`capability`, `allowed-tools`, `requirements`, `entry`, `disabled`, plus `license`, `version`, `author`, `metadata`
(`SRC/skill/skill.ts:29-73,111-124`; example `OS/backend/cli/skills/core/autoresearch/SKILL.md:1-13`) [code].

### 3.3 Selection and loading: the model picks, from a small index plus lexical search

- **Always in context for the lead:** a `<core-skills>` index of the 22 core skills, one line each, in a curated
  workflow order, plus by-name pointers to up to 12 cloud-compute and 12 database skills, plus an instruction to search
  the rest (`SRC/session/system.ts:205-282`; used at `SRC/session/prompt.ts:1807-1808`) [code]. Bodies are never
  preloaded (`SRC/session/system.ts:240-244`) [code].
- **For a specialist:** its prompt carries a `<domain-skills>` index of every skill in its categories (e.g. biology
  gets biology + databases, 105 one-liners) (`SRC/session/system.ts:103-124`, `SRC/agent/agent.ts:278-286`) [code].
- **On a `/skill` slash invocation:** the full `<available-skills>` block with category counts and up to 8 lexical
  matches for the message; the named skill is loaded before the step (`SRC/session/system.ts:126-203`,
  `SRC/session/prompt.ts:647-757,1806`) [code].
- **Search:** the `skill` tool with `query` ranks by IDF-weighted term overlap across name (×8), tags (×5),
  capability (×5), description (×3), category (×2); exact names and aliases win; top 8 returned; no embeddings, no
  model call (`SRC/skill/search.ts:43-87`; `SRC/tool/skill.ts:144-170`) [code]. The design note says so explicitly
  (`OS/docs/notes/skill-runtime-design.md:9-22`) [doc].
- **Load:** by exact name, after a `skill` permission check and a re-check that the file did not change while
  waiting (`SRC/tool/skill.ts:218-233`); the body is re-read from disk (`SRC/skill/skill.ts:237-246`); the session
  gets read access to that skill's directory (`SRC/tool/skill.ts:242-250`); sibling `skills/...` paths are rewritten
  to real directories (`:33-59,255-258`); a sha256 of the delivered body is recorded and a second identical load
  returns a receipt instead of the text (`:261-292`) [code].
- **Tool unlock:** a loaded skill's `allowed-tools` makes extra tools visible for the rest of the visible history
  (`SRC/tool/visibility.ts:66-99`, `SRC/session/prompt.ts:2306-2321`) [code]. "There is no keyword selection" of tools
  (`SRC/tool/visibility.ts:5-11`) [code].
- **Guidance to the model:** "Load a skill only when its instructions change how you will do the work; keyword overlap
  or mere availability is no reason to load" (`SRC/agent/prompt/anthropic.txt:10`) [code].

**How many in context:** at most the core index (22 lines + ~24 names) for the lead, or one domain index for a
specialist; bodies one at a time on demand [code, as above]. No measurement of discovery misses or load precision is
in the repo [unavailable].

### 3.4 Editing, sources and precedence

- Sources: bundled (compressed, hashed archive in releases), `~/.claude/skills`, project `.claude/skills` and
  `.openscience/skills` (only if the project is trusted), user skills under the data root, Git-installed skills,
  configured paths. Precedence for a name clash: project > user > installed > bundled; clashes are logged and recorded
  as `shadows` (`SRC/skill/skill.ts:155,278-480`; `OS/docs/notes/skill-runtime-design.md:54-69`) [code, doc].
- Editing: the workspace and CLI write user skills through `Skill.writeUser`, which validates frontmatter and name
  and runs the moderation regexes (`SRC/skill/skill.ts:737-790`; `SRC/server/server.ts:704`;
  `SRC/cli/cmd/skill.ts:122`) [code].
- Git install: `openscience skill add gh:owner/repo` pins the fetched SHA and runs a regex review: layer 1 rejects
  description injection ("always run this skill", "ignore previous instructions") and catastrophic shell patterns;
  layer 2 rejects classifier-targeted injection; layer 4 warns on `curl | sh`, `~/.ssh`, `~/.aws` reads and similar;
  the user confirms (`SRC/skill/install/review.ts:20-147`; `SRC/skill/install/install.ts:46-142`) [code]. The docs say
  installation "may need a configured model for review" (`OS/frontend/docs/src/content/openscience/skills.mdx:48`)
  [doc]; the install path makes no model call: layers 1, 2 and 4 are regex passes, there is no layer 3, and the
  map that would hold a reviewer's reasoning is created empty and never filled (`SRC/skill/install/install.ts:63-74`)
  [code]. Layer 2 still says it runs "before the classifier ever sees its content" (`SRC/skill/install/review.ts:81-82`),
  a classifier that no longer exists [inference].
- At load time the body is scrubbed of lines containing "always run this skill" / "must always run"
  (`SRC/tool/skill.ts:253-254`) [code].

### 3.5 Quality control

- Every bundled skill's frontmatter must parse and validate (`OS/backend/cli/test/skill/bundled-skills.test.ts:10`);
  a few helper scripts have tests (`OS/backend/cli/test/skill/scientific-integrity.test.ts:1-35`) [code].
- No with/without evaluation of any skill, no per-skill success record, no retirement on evidence [code: none found in
  `OS/backend/cli/test/skill/`, `OS/evals/`]. The landing claims "A unit stays only if it improves measured outcomes"
  (`OS/frontend/landing/src/pages/Benchmark.tsx:423-428`) about harness units, not skills [doc]; the supporting
  measurements are not in this repo [unavailable].
- The design note is candid: the content hash "is not a signature or a claim that the procedure is scientifically
  validated" (`OS/docs/notes/skill-runtime-design.md:30-34`) [doc].

---

## 4. Tools, MCP servers and scientific connectors; permissions and scoping

### 4.1 Inventory

- Default tool set offered to every agent: `invalid, bash, read, glob, grep, edit, write, apply_patch, webfetch,
  research_search, literature, recall, todowrite, task, skill, question, python, compute_job, artifact`
  (`SRC/tool/visibility.ts:16-36`) [code]. `edit`/`write` vs `apply_patch` is chosen by model family
  (`SRC/tool/registry.ts:261-265,294-295`) [code].
- Opt-in by skill or agent: `r`, `study`, `experiments`, `generate_image`, `scientific_capability`,
  `provider_compute`, `query_uniprot|ensembl|kegg|pubmed|ncbi_gene|string|pdb`, `science_list_dbs|search|fetch`
  (`SRC/tool/registry.ts:207-221`, `SRC/tool/biology/ids.ts:1-11`) [code].
- Literature: one tool that fans a query out to OpenAlex and arXiv, merges by DOI/arXiv id/title with reciprocal rank
  fusion, and reads full text with page addresses (`SRC/tool/literature.txt:1-7`, `SRC/research/literature.ts:12-22`)
  [code].
- Science connectors: ~49 sources incl. UniProt, PDB/PDBe, AlphaFold, InterPro, Ensembl, ClinVar, gnomAD, dbSNP,
  ChEMBL, PubChem, BindingDB, KEGG, Reactome, STRING, OpenTargets, GEO, GTEx, HPA, DepMap, PubMed, Europe PMC,
  Crossref, Semantic Scholar, bioRxiv (`SRC/science/connectors/*/`) [code]. The landing page says 42 connectors in 6
  domains (`OS/frontend/landing/src/data/benchmark.ts:20-21`) [doc].
- Scientific capability registry: exact-pinned Python packs and ten BioNeMo NIM adapters with strict request schemas,
  smokes with script digests, and maturity `verified|experimental|blocked`; the docs say 54 entries, two blocked and
  "none is called verified without matching release evidence" (`SRC/science/capability/schema.ts:4-80`;
  `OS/ARCHITECTURE.md:76`) [code, doc].
- MCP: local (command) and remote (URL, OAuth) servers; a reviewed catalog of six remote connectors (GitHub,
  Benchling, Box, Dropbox, S3, givemeanode) with `writes_enabled_by_catalog: false` (`SRC/mcp/index.ts:789-830`,
  `SRC/mcp/catalog.ts:17-36`) [code]. "Every tool a server exposes is offered unless a permission rule denies it", each
  call asks the `mcp` permission per tool name (`SRC/session/prompt.ts:2390-2421`) [code].
- Plugins: trusted code in the host process, can add tools/providers/hooks (`OS/ARCHITECTURE.md:114`;
  `OS/tooling/plugin/src/index.ts:240-275`) [doc, code].

### 4.2 Permissions and sandbox (the task's premise, corrected)

The README does **not** say "not sandboxed". `OS/SECURITY.md:9-11` says a permission prompt "is not an isolation
boundary by itself", that new installs default to "Approve for me" with the sandbox on, that contained modes wrap
shell, kernels and local jobs in Seatbelt or bubblewrap, confine reads/writes and deny network egress, that Windows has
no backend, and "Use a container or VM for hostile code" [doc]. The code matches: three access modes, `ask`,
`approve`, `full` (`SRC/agent/agent.ts:95-156`); bubblewrap with an empty tmpfs root and `--unshare-net` unless network
is escalated for one approved command (`SRC/sandbox/sandbox.ts:11-28,645-777`); project default `network: "deny"`,
`onUnavailable: "error"` (`SRC/project/access.ts:105-111`) [code]. **Full access disables containment and skips shell
approval** (`SRC/permission/next.ts:107-116`; `OS/SECURITY.md:11`) [code, doc].

- `modeAction`: deny always wins; unknown permission kinds ask; Ask mode asks for everything not passive; Approve mode
  asks for risky shell commands (an allowlist classifier) and risky boundaries (network, MCP, compute, external
  directories) (`SRC/permission/next.ts:85-131`; `SRC/permission/shell-risk.ts:1-8`) [code].
- Network commands ask once per destination host (`OS/README.md:123`; `SRC/tool/network-commands.ts:36-113`) [doc,
  code].
- Remote compute approval is bound to the digest of command, inputs, image, packages, resources, timeout, network
  policy and output contract; credentials resolve only after approval and never enter agent, shell, kernel or job
  environments (`OS/docs/adr/0001-modal-compute-control-plane.md:17-31`; `SRC/tool/compute-job.ts:946-993`) [doc, code].

### 4.3 Per-agent tool scoping: does each sub-agent get only what it needs? No.

- Specialists start from the shared defaults (`"*": "allow"` with mode overlays) and only *add* denies for
  `question`, `todowrite`, `task` plus allows for their domain tools (`SRC/agent/agent.ts:74-94,162-190`) [code]. So a
  `biology` worker can run bash, edit and write anywhere the session can [inference from the ruleset merge].
- Scoping is by **visibility**: the default set plus tools the agent's own ruleset names (`unlocks`) plus tools a
  loaded skill's `allowed-tools` names (`SRC/tool/visibility.ts:52-99`) [code]. Visibility is not authority:
  "`allowed-tools` requests tool visibility only" (`OS/docs/notes/skill-runtime-design.md:88-92`) [doc].
- `explore` is the one narrowed profile: `"*": "deny"` then read tools, literature, webfetch, and `bash: safeAction`
  (`SRC/agent/agent.ts:233-268`). Under Full access `safeAction` is `allow` and shell approval is skipped, so the
  "read-only" scout can mutate files [inference from `SRC/agent/agent.ts:159-160` and `SRC/permission/next.ts:116`].
- Children share the parent's working directory (§2.6) [code]; there is no per-worker file scope [doc:
  `OS/CHANGELOG.md:1956-1957`].

---

## 5. Memory and state

| Memory | What persists | Shared with | Evidence |
|---|---|---|---|
| Session transcript | every message and tool part, on disk under the data root; the full record survives compaction | the session; a resumed worker via `task_id` | [code] `SRC/session/index.ts`, `SRC/storage/storage.ts`; [doc] `OS/ARCHITECTURE.md:121-123` |
| Working context | old tool outputs pruned to one-line summaries at turn boundaries; when over budget, an LLM compaction writes a fixed handoff (Objective, Deliverables verbatim, Constraints & Decisions, Findings, Work State, Delegated evidence, Next Move, Key Files) and pins the first user message | the session | [code] `SRC/session/prompt.ts:986-992,1523-1631`, `SRC/session/compaction.ts:455-485`; `SRC/agent/prompt/compaction.txt:1-5`; [doc] `OS/CHANGELOG.md:1958-1960` |
| `recall` tool | regex search over the session's own history, including compacted turns and saved full tool outputs | the session | [code] `SRC/tool/recall.ts:1-121`, `SRC/tool/recall.txt:1-3` |
| Project instructions | `AGENTS.md`, `CLAUDE.md` (and `~/.claude/CLAUDE.md`) walked up from the project, ≤256 KB each, ≤1 MB total; `/init` writes a ~100-line `AGENTS.md` | every session in the project | [code] `SRC/session/instruction.ts:15-34`; `SRC/command/template/initialize.txt:1-12` |
| Results (artifacts) | immutable, versioned files with sha256, execution metadata and capture quality; provenance nodes recorded automatically by kernels and the artifact tool | project-wide; workers' results reach the lead by artifact id | [code] `SRC/artifact/store.ts:1-40`, `SRC/tool/artifact.ts:83-161`, `SRC/science/kernel/registry.ts:636` |
| Studies and runs | one SQLite file per project: runs, ideas, verdicts, lessons, directives; rendered to `study.md`, `ideas.md`, `results.tsv`, `lessons.md` | the study's session; survives restarts | [code] `SRC/experiments/index.ts:12-21,92-140`, `SRC/experiments/ledger.ts` |
| Harness unit state | deliverables, acceptance contract, round counters, spend: an **in-memory** `Map` per session | the process only | [code] `SRC/harness/state.ts:1-10,72` |
| Cross-session lessons | `SessionResearch.experience/learn/unlearn` per project, "independently supported only from verified observations across more than one session" | **no production caller** (§6.2) | [code] `SRC/session/research.ts:779-923`; [doc] `OS/docs/notes/harness-manifests.md:110-111` |
| Conversation references | a bounded, hashed snapshot of another session, labelled "reference material, not … new user instructions" | the target session | [code] `SRC/session/prompt.ts:2586-2630` |
| Trace upload | full traces uploaded to the vendor when signed in, by default | vendor | [doc] `OS/ARCHITECTURE.md:80-82` |

**Between agents.** A worker gets the brief, not the transcript; the lead gets the worker's final text plus evidence
receipts, not its transcript; both share the working directory and the project's Results [code: §2.6]. This is the
same "share artifacts, not transcripts" split Foundry uses (THESIS P8), but with a shared mutable directory instead of
declared edges [inference].

**Restart gap.** Because harness unit state is in memory and the deliverables/acceptance contracts are detected only
from the first user message of a session (`SRC/harness/deliverables.ts:646-668`,
`SRC/harness/acceptance.ts:551-568`), a server restart mid-session appears to silently disable those checks for that
session; only the cost unit re-seeds itself from the transcript (`SRC/harness/cost.ts:44-55`) [inference from code].

---

## 6. Rule-following for research programs

### 6.1 What is enforced in code

| Rule | Enforcement | Strictness | Evidence |
|---|---|---|---|
| Named outputs exist and parse | deliverables unit before finish | mechanical, 2 rounds, then "the model's answer stands" | [code] `SRC/harness/deliverables.ts:10-16,673-692` |
| Stated verifier commands pass, banned tokens absent | acceptance unit before finish | executes allowlisted commands, 3 rounds, then stands | [code] `SRC/harness/acceptance.ts:16-25,572-592` |
| Report covers the request | review unit | one same-model read, fails open | [code] `SRC/harness/review.ts:187-261` |
| No publishing from workers | Task brief filter | hard refusal | [code] `SRC/tool/task.ts:297-301,379-384` |
| Plan mode is read-only | tool allowlist | hard refusal | [code] `SRC/tool/plan-mode.ts:1-20` |
| One run per idea; no repeated configuration; concurrency; run budget; study state | `study` tool | hard refusals | [code] `SRC/tool/study.ts:337-357,375-399` |
| Kill criteria; hours/runs/cost/target budgets | study driver every 3 s | kills runs, halts study, wakes the agent | [code] `SRC/experiments/driver.ts:14-44,213-344,422-441` |
| Paid compute approval matches the plan | digest-bound approval | hard | [code] `SRC/tool/compute-job.ts:946-993`; [doc] `OS/docs/adr/0001-modal-compute-control-plane.md:25` |
| Pipelines fail on any stage | `pipefail` in bash/zsh | hard | [doc] `OS/docs/notes/harness-manifests.md:79-80` |

### 6.2 Preregistration and research contracts: present, documented, unreachable

- `SRC/session/research.ts` defines a `Contract` with templates (`minimal`, `empirical`, `evidence`), stages, checks,
  trials, failures, metrics, budgets and a `Preregistration` (`:21-60,231-246`) [code].
- The rules are real and strict in that module: an empirical plan can be preregistered only before the first material
  trial, and once frozen it is immutable (`:573-600`); a check cannot be marked passed or failed without a verified
  artifact or tool reference, and never passes on an errored tool (`:633-676`); a decision stage cannot complete
  without a recorded trial (`:602-631`) [code].
- **No production code calls `define`, `preregister`, `stage`, `check`, `trial` or `learn`.** Outside the module,
  `SessionResearch` is referenced only to delete state and to read/assess a contract in the trace export
  (`SRC/session/index.ts:595`, `SRC/session/trace.ts:246-247,407,788`); the `research_contract` tool name survives only
  in the permission list and in prompt text (`SRC/permission/next.ts:51`, `SRC/session/research.ts:453,1583`); the
  tool registry has no such tool (`SRC/tool/registry.ts:183-224`) [code]. Tests still exercise the module
  (`OS/backend/cli/test/session/research.test.ts`) [code].
- The docs still describe "Research completion contracts" with fail-closed gates and session-tree ceilings as current
  behaviour (`OS/docs/notes/harness-manifests.md:82-115`) [doc]. The user docs reduce preregistration to advice: "ask
  OpenScience to save the empirical plan as a Result … A local preregistered plan … is not automatically a
  registration in an external scientific registry" (`OS/frontend/docs/src/content/openscience/experiment-tracking.mdx:19-23`)
  [doc].
- **Reading:** the strict contract layer was removed from the model's reach in the harness refinement ("No …
  contract file … or verifier gate for every answer", `OS/docs/notes/scientific-harness-design.md:61-63`), and the
  docs lag [inference].

### 6.3 What is prose only

- Reproduction protocol: freeze the target before running, canonical path first, capture everything, one verdict
  from a fixed set of five (`OS/backend/cli/skills/core/reproduce/SKILL.md:22-94`). Nothing hashes the admission
  record or checks it was written before the run [code: the skill names files; no tool reads them].
- Study review gate: "before the baseline runs, delegate a read-only critique of the training and evaluation code"
  appears in the study reminder (`SRC/session/prompt.ts:3238-3242`), but `study start` does not check it
  (`SRC/tool/study.ts:375-419`) [code]. "The evaluation does not change once the baseline has run" is skill text
  (`OS/backend/cli/skills/core/autoresearch/SKILL.md:31-33`); no code hashes the evaluation script [code: no hash in
  `SRC/experiments/`].
- Study verdicts: `kept` is the model's own label on a self-reported metric logged by the run script through
  `openscience_track` (`SRC/tool/study.ts:495-530`; skill `:50-57`) [code]. Code computes the delta to baseline but
  does not refuse a `kept` that lost (`SRC/experiments/index.ts:673-702`) [code]. (The dormant contract module did
  refuse direction contradictions, `OS/docs/notes/harness-manifests.md:108-110` [doc].)
- Citations: read before citing, verify every reference against Crossref/OpenAlex/arXiv/PubMed, a `.bib` validator
  script (`SRC/agent/prompt/science.txt:5`; `OS/backend/cli/skills/core/citations/scripts/validate_bib.py`); the
  `sources` skill audits each claim against its passage (`OS/backend/cli/skills/core/sources/SKILL.md:1-30`). Run on
  the model's initiative [code: no hook calls them].
- Statistics and reporting: raw and adjusted statistics, uncertainty, numbers from a saved script run end to end
  (`SRC/agent/prompt/science.txt:21-22`) [code, prose].

**Strictness, overall:** mechanical for file existence/format, for commands the user typed into the first message,
and for the study's run bookkeeping; advisory for method, preregistration, evidence and citation [inference from
§6.1–§6.3].

---

## 7. Evals

### 7.1 `evals/science-harness`: native external benchmarks

- **What:** a campaign layer over the Harbor installed-agent adapter for Terminal-Bench Science (70 tasks),
  Terminal-Bench 4.0 science subset (14 of 66), BiomniBench-DA public 50, DrugDiscoveryBench (82), BixBench3 (20),
  ResearchClawBench (40). Native tasks, images, limits and graders stay in the benchmark; judge credentials go to the
  verifier only (`OS/evals/science-harness/README.md:1-80`; `OS/docs/notes/scientific-harness-design.md:141-175`)
  [doc]. The adapter runs `openscience run --format json --auto-approve --workspace project --model …`
  (`OS/tooling/harbor/openscience_harbor/agent.py:317`) [code].
- **Protocol it states:** 3 trials per task to match leaderboards; freeze identities; development panel, then
  "Freeze before held-out evaluation. Development tasks are disclosed as such"; no silent retries or favourable seeds
  (`OS/evals/science-harness/README.md:56-79`; `OS/docs/notes/scientific-harness-design.md:186-227`) [doc]. This is a
  good protocol on paper.
- **Numbers reported** (README, landing): Terminal-Bench Science 53/70 (75.7%); BiomniBench-DA public 50 mean 82.2;
  Terminal-Bench 4.0 science 10/14 (0.714); models "GPT-6 Astra and GPT-6 Sol" (`OS/README.md:129-137`;
  `OS/frontend/landing/src/data/benchmark.ts:17-59`) [doc]. An internal "OpenScience Bench" pass@3: OpenScience 47.3,
  Claude Science 40.6, K-Dense 40.3, Codex 38.1 (`OS/frontend/landing/src/data/benchmark.ts:99-111`) [doc]; its tasks
  and grader are not public [unavailable]. Per-trial traces are said to be in `synthetic-sciences/benchmarks-openscience`
  [unavailable: not acquired].
- **No results are in this repo**; campaign outputs are gitignored (`OS/evals/science-harness/.gitignore`) [code].

**Credibility.**
1. **Unequal trial counts.** "OpenScience rows report one counted trial per task. Leaderboard entries average 3
   trials per task on Terminal-Bench Science and 5 on Terminal-Bench 4.0"
   (`OS/frontend/landing/src/pages/Benchmark.tsx:536-541`) [doc]. This contradicts the stated protocol of 3 trials
   (`OS/evals/science-harness/README.md:58-61`) [doc]. "Counted" is undefined, and `n_attempts: 51` beside 70 tasks
   (`OS/frontend/landing/src/data/benchmark.ts:42`) is unexplained [unavailable]. A single counted trial against a
   3-trial mean is not the same estimator; if any trials were discarded, selection inflates the score [inference].
2. **Margins inside noise.** 53/70 has a Wilson 95% interval of [0.645, 0.842]; Codex's 68.1% (≈47.7/70) gives
   [0.565, 0.778]; they overlap [arith]. 10/14 on TB4 science is [0.454, 0.883] [arith]. BiomniBench's 82.2 vs 81.04 is
   a 1.2-point margin under an LLM judge (`OS/frontend/landing/src/data/benchmark.ts:35,50`) [doc; inference: not
   resolvable without per-task variance].
3. **Development on the reported sets.** The review unit's own comment: "Fifty rubric-graded analyses lost most of
   their points to omissions of exactly this kind" (`SRC/harness/review.ts:22-25`); BiomniBench-DA public 50 is the
   reported 50-task rubric-graded set [doc + code; inference that the unit was designed from those graded failures].
   The reader's "standard readings" card (DESeq2/GSEA on MSigDB Hallmark, KM + Cox, single-cell pipeline …) and its
   "would a grader … deduct" framing are grader-shaped (`SRC/agent/prompt/reader.txt:3-26`) [code]. The acceptance
   unit's example `lake build GSLean` names a specific task (`SRC/harness/acceptance.ts:17-19`) [code]. The refinement
   plan forbids harness code that knows "a benchmark's name, paths, rubric vocabulary or task identity"
   (`OS/docs/notes/harness-refinement-plan.md:38-40`) [doc], and the design note says "No task instructions, hidden
   answers, or rubric contents were used to tune this refinement" (`OS/docs/notes/scientific-harness-design.md:144-146`)
   [doc]; the latter predates the review unit [inference]. No held-out split of these benchmarks is declared anywhere
   in the repo [code: none in `OS/evals/`].
4. **Stale config claims.** The README and design note say `--auto-approve` disables delegation
   (`OS/evals/science-harness/README.md:21`; `OS/docs/notes/scientific-harness-design.md:103-106`), but the run command
   now says "Headless runs keep delegation" (`SRC/cli/cmd/run.ts:586-605`) and the landing reports GPT-6 Sol / GPT-5.6
   Sol **workers** on the benchmark runs (`OS/frontend/landing/src/pages/Benchmark.tsx:537-540`) [code, doc]. The
   README also says "fifteen core skills" (`OS/evals/science-harness/README.md:15-16`); there are 22 [code].
5. **What is credible.** The adapter keeps native graders and limits, separates judge credentials, records binary
   SHA and identity, and refuses TB4 runs until IDs are frozen (`OS/evals/science-harness/README.md:58-115`) [doc]. The
   numbers are external-benchmark numbers, which Foundry does not yet have [inference].

### 7.2 `evals/cadence-harness`: process telemetry, not quality

- Runs five long dev prompts (P11, P15, P21, P23, P24: plant genomics, Tara Oceans MAGs, BioNeMo binders, coral
  bleaching, a NeurIPS workshop paper) against a source-built server in an isolated profile
  (`OS/evals/cadence-harness/dev-prompts.ts:1-24`; `OS/evals/cadence-harness/DEV_LAB.md:1-38`) [code, doc].
- Measures duration, time to first output, tokens, cost, tool calls, parallelism, contract bytes, searches, child
  agents, retries, failures across the session tree (`OS/evals/cadence-harness/report-types.ts:43-110`) [code].
- **Outcome rule:** `completed` means final text or an artifact exists and no error; there is no correctness oracle
  (`OS/evals/cadence-harness/run.ts:137-172`) [code].
- A 57-scenario stress matrix (chat, skills, delegation, malformed tools, retries, compaction, budgets, permissions,
  provider failures) runs on a fake provider and is reused by unit tests
  (`OS/evals/cadence-harness/stress-matrix.ts:1-75`; `OS/backend/cli/test/fixture/stress-provider.ts:1`) [code]. This is
  a good deterministic conformance suite for the loop [inference].

### 7.3 `evals/launch`: a frozen release suite with a held-out split

- Nine flows (5 development, 4 held-out), a 14-dimension 0–2 rubric "written before runs", hard gates (no P0/P1, every
  artifact opens, no unapproved paid action, no boundary escape, no runaway fan-out, held-out non-regression, founder
  approval), and a lock file with sha256 of suite and rubric (`OS/evals/launch/suite.json:5-17` and its `flows`;
  `OS/evals/launch/rubric.json:3,95`; `OS/evals/launch/lock.json:1-13`) [code]. The lock hashes match the files today [code:
  `sha256sum`].
- The validator checks split counts, the `heldOutVisibleDuringTuning: false` flag and the hashes
  (`OS/evals/launch/validate.ts:60-67,129-130`) [code]. The held-out prompts are in the same public file, so
  "not visible during tuning" is a declaration, not a control [inference]. Scoring is by a human against the rubric;
  no scored runs are committed (`OS/evals/launch/runs/.gitignore`) [code].

---

## 8. Model routing

- **Per request, chosen by the person.** Each user message carries `model`, `variant` (provider reasoning effort),
  `tier`, `effort` (`normal|ultra`), delegation settings (`level`, optional `workerModel`, `autonomy`)
  (`SRC/session/message-v2.ts:26-60`; `SRC/server/routes/runtime.ts` input `SRC/runtime/runs.ts:21-43`) [code].
- **No automatic routing by task.** No built-in agent has a model (`OS/CHANGELOG.md:1945-1948`) [doc]; workers use the
  agent's model, else the worker-model setting, else the lead's (`SRC/tool/task.ts:446-459`) [code]. The only automatic
  choices are: a small model for titles, summaries and compaction by a fixed priority list (`SRC/provider/provider.ts:3379-3409`),
  a default model when none is configured (`:3414-3474`), and the managed (Ace) route through OpenRouter
  (`SRC/provider/managed-routing.ts:1-7`, `SRC/session/llm.ts:104-116`) [code].
- **Silent fallback.** If the configured model's provider is unavailable, `defaultModel` logs a warning and picks
  another by priority (`SRC/provider/provider.ts:3449-3458`) [code]; the loop itself refuses an unavailable model with
  an error (`SRC/session/prompt.ts:1254-1293`) [code].
- **Prompt routing by model family.** Header file chosen by wire model id: `anthropic`, `gpt-astra`, `gpt`, `codex`,
  `gemini`, `default`, each with the same `{{SCIENCE}}` block (`SRC/session/system.ts:23-69`; `OS/ARCHITECTURE.md:84-96`)
  [code, doc]. Tool form also switches by family (`apply_patch` for GPT) (`SRC/tool/registry.ts:261-265`) [code].
- **Knowledge-cutoff line** in `<env>` tells the model how stale its training is and to look up current versions
  (`SRC/session/system.ts:284-302`) [code].

---

## 9. Novel or strong vs commodity

**Commodity (inherited or widely available).**
- The loop, Task tool contract (`subagent_type`, `task_id`, depth, `<task_result>`, background), family headers,
  compaction template, permission-driven tool visibility: modelled on OpenCode at a pinned commit
  (`OS/docs/notes/harness-refinement-plan.md:16-61`) [doc].
- Agent Skills format and most skill content (74% third-party) (§3.1) [code, doc].
- MCP client, models.dev catalog, 22 provider SDKs (`OS/frontend/landing/src/pages/Benchmark.tsx:509-511`) [doc].

**Strong engineering worth copying.**
1. **Before-finish hooks with a bounded injection budget** (`loop.before_finish`, `loop.guard`): a tiny, general
   mechanism where code decides whether a turn may end (`OS/tooling/plugin/src/index.ts:245-273`,
   `SRC/session/prompt.ts:99,1211-1236`) [code].
2. **Request-stated acceptance commands run through the agent's own sandboxed shell** before finishing
   (`SRC/harness/acceptance.ts:384-428`) [code].
3. **Study driver: "the agent owns the science, this loop owns the clock"**: typed ideas, one run per idea, kill
   rules, budgets, wake-ups, a rendered ledger (`SRC/experiments/driver.ts:14-44`, `SRC/tool/study.ts:375-419`) [code].
   This is Foundry's P1 (code owns procedure) applied to experiment loops.
4. **Compute control plane** (ADR 0001): approval bound to a digest, credentials never in agent environments,
   ownership tags, never rerun a paid command, delivery recovery as its own lifecycle
   (`OS/docs/adr/0001-modal-compute-control-plane.md:13-35`) [doc; code `SRC/tool/compute-job.ts:946-993`].
5. **Evidence from records, not prose** in worker handoffs (`SRC/tool/task-evidence.ts:5-6`) and **durable Task
   attempts** that recover without rerunning (`SRC/tool/task-attempt.ts:10-80`) [code].
6. **Harness manifests**: a per-request fingerprint of profile, model route, prompt hashes and tool-schema hashes, and
   replayed invariants that every tool call was in the offered set (`OS/docs/notes/harness-manifests.md:1-60`) [doc].
7. **Scientific capability registry** with exact pins, smoke digests, invariants and an honest maturity field
   (`SRC/science/capability/schema.ts:4-80`) [code].
8. **Fail-closed plan mode** by tool allowlist (`SRC/tool/plan-mode.ts:1-20`) [code].

**Genuinely novel?** None of these is a new idea in isolation; the combination for science (studies + capability
registry + BioNeMo adapters + 49 connectors + external-benchmark campaigns) is the differentiator [inference]. The
reported benchmark lead is not established by the evidence in the repo (§7.1) [inference].

---

## 10. Mapping to Foundry

### 10.1 Capability by capability

| OpenScience capability | Foundry today | Foundry evidence | Verdict |
|---|---|---|---|
| General tool-using agent loop | Not built, by design ("not a general agent loop"); external executors are measured as nodes | `docs/THESIS.md:124-134`; `README.md:113` | **No (intentional)** |
| Typed plan / workflow artifact | Typed workflow IR, 10 node kinds incl. `agent`, `code`, `verify`, `state` | `schemas/workflow.schema.json:138-141,200-209` | **Yes; OpenScience has none** |
| Delegation to workers | `flow.agent` (typed `returns`, mandatory parent `verify`, depth ≤1, no Task/Agent tools), `flow.call` by hash, and the `subflow` tool with hard refusals | `experiments/jit/agent-node.mjs:25-34`; `experiments/rec/subflow.mjs:1-12`; `research/architecture-20261014/MEMORY-ROUTING-RECURSION.md:415-484` | **Yes, stricter** (typed returns; experiments, not the product runtime) |
| Worker evidence receipts | journal rows, hash chain, `verify-run` | `src/journal.mjs:1-10`; `src/verify-run.mjs:1-3` | **Yes, stronger** |
| Before-finish deliverables/format checks | acceptance grading (`gating`, `existence-only`, `no-oracle`, `unassessed`) and a strict construction lint; requirement tracker that extracts user conditions with verbatim quotes and runs model-written checks in a sandbox | `src/acceptance.mjs:21,175-223`; `src/lint.mjs:1-8`; `experiments/tracker/README.md:1-10`; `experiments/tracker/checks.mjs:1-14` | **Partial**: Foundry grades acceptance strength; it lacks OpenScience's cheap file-format checks |
| Request-stated verifier commands run before finish | `verify` nodes with `independence` labels; `code` nodes in namespaces | `schemas/workflow.schema.json:189,209`; `src/sandbox.mjs:6-8` | **Yes** (declared in the workflow, not regex-extracted) |
| Fresh-context report reviewer | `verify` with `different-model`/`same-model` labels; measured that Jev and Haiku are correlated; planted-mutant rule for child verification | `schemas/workflow.schema.json:189`; `research/architecture-20261014/MEMORY-ROUTING-RECURSION.md:266,449-452,536-538` | **Yes, with independence semantics OpenScience lacks** |
| Skill library (372, prose) | 14 portable skills; 17 L1 library cards with typed slots, fragments, `when` judgments and support counts | `skills/*/SKILL.md` (14 files, 1,068 lines); `experiments/library/cards/catalog.json`; `experiments/library/card-types.mjs:1-40` | **Partial**: far fewer, but typed; no science domain breadth |
| Skill retrieval | code-first BM25 candidate generation over cards, no model, no embedding | `experiments/library/retrieve.mjs:1-5` | **Yes (same class of method)** |
| Hill-climbing study loop | no equivalent loop pattern; C1 assignment search and heal replay are adjacent | `research/distill-20261007/DESIGN.md:1-60`; `experiments/heal/` | **No** |
| Digest-bound paid-compute approval | hash-bound workflows and proposals; ambiguous effects become `uncertain`, never retried; EffectPort | `README.md:488-490`; `src/verdict.mjs:7-26` | **Partial** (no remote compute effect yet) |
| OS sandbox | bubblewrap user+net+mount+pid namespaces, PATH-only env, never falls back | `src/sandbox.mjs:6-8` | **Yes, stricter** (no "full access" mode) |
| Permission modes / shell-risk classifier | label policy and control-flow taint (`UNTRUSTED_CONTROL`) | `src/validate.mjs:239-245` | **Different**: Foundry gates by data labels, OpenScience by command risk |
| Session memory, compaction, `recall` | 7-memory model; free inside a node; typed outputs across edges; no transcripts across runs | `research/architecture-20261014/MEMORY-ROUTING-RECURSION.md:290-357` | **Partial**: Foundry has no in-node compaction or recall (delegated to executors) |
| Project instructions (AGENTS.md) | not Foundry's job (AMP) | `docs/THESIS.md:128-130` | **No (intentional)** |
| Preregistration | committed template; prereg checks in the need-router experiments; sealed families | `research/PREREGISTRATION-TEMPLATE.md:1-40`; `experiments/need-router/prereg-check.mjs:1-4`; `README.md:95` | **Yes, stronger** (OpenScience's is dormant) |
| External benchmarks via Harbor | none run; Tier B/C need Modal/Harbor credentials | `README.md:118,340` | **No** |
| Release suite with held-out split and hash lock | sealed families, frozen manifests, burned-seed accounting | `README.md:95,184-186`; `research/freeze.mjs:1-3` | **Yes, stronger** |
| Model routing | policy file as the only source of ids; need router (mode choice) as a $0 research artefact; precedence design with pins | `policy/models.json:12`; `experiments/need-router/router.mjs:1-40`; `research/architecture-20261014/MEMORY-ROUTING-RECURSION.md:486-540` | **Partial, ahead in design**; OpenScience has manual choice only |
| Science connectors, BioNeMo, kernels | not in scope ("not a connector catalog") | `docs/THESIS.md:127` | **No (intentional)**; reachable through MCP or executors |
| Harness manifests | context compiler receipts; hash chain binds journal rows and decisions | `src/context.mjs:5-8`; `src/verify-run.mjs:1-3` | **Yes** |

### 10.2 What to adopt (with source spans)

1. **File-format deliverable checks as a free `verify` component.** Existence, non-empty, parses, CSV header and
   ragged rows, NaN/Inf, placeholder tokens: `SRC/harness/deliverables.ts:455-615`. Label it `existence-only`/format
   in `src/acceptance.mjs` terms so it never counts as a gating oracle. Cost $0.
2. **A verifier-command allowlist** for any check text that comes from a task: `SRC/harness/acceptance.ts:31-35`.
   Useful for R-bench/AutomationBench tasks whose specs name their own checks; run them only in Foundry's sandbox.
3. **The bounded before-finish pattern for agent nodes.** When a Foundry `agent` node returns, run its declared checks
   and give it at most N continuations with the failure text, as `SRC/session/prompt.ts:99,1211-1236` does. Foundry's
   `flow.agent` already requires a parent `verify`; this adds a cheap in-node retry before the parent sees the answer.
4. **The study loop as a typed library card.** Schema `SRC/experiments/index.ts:63-140`, refusals
   `SRC/tool/study.ts:337-357,375-399`, driver budgets and kill rules `SRC/experiments/driver.ts:213-344,422-441`. A
   Foundry version should add what OpenScience lacks: hash the evaluation script at baseline, gate `kept` on the
   measured delta, and treat the run script's self-reported metric as `same-model` evidence until an independent
   recomputation confirms it.
5. **Compute-effect rules from ADR 0001** for Foundry's EffectPort when remote compute arrives:
   `OS/docs/adr/0001-modal-compute-control-plane.md:17-35` (digest-bound approval, credentials resolved only after
   approval, never rerun a paid command, delivery recovery separate from execution).
6. **Field-weighted lexical search as one more $0 retrieval arm.** Foundry already ranks cards by BM25 in code
   (`experiments/library/retrieve.mjs:1-5`); OpenScience adds per-field weights (name ×8, tags and capability ×5,
   description ×3, category ×2) and exact-name/alias precedence (`SRC/skill/search.ts:43-87`). Worth one arm in the
   library retrieval tests, nothing more.
7. **Skill-load receipts**: sha256 of the delivered body plus "already loaded" receipts
   (`SRC/tool/skill.ts:261-292`), for Foundry's skills when installed into executors.
8. **`recall` inside agent nodes** (regex over the node's own history and saved outputs, `SRC/tool/recall.ts:1-121`):
   fits Foundry's rule R7 (no limits inside a node) without moving transcripts across edges.
9. **Harbor adapter pattern** for the wild ladder: native tasks and graders, judge credentials to the verifier only,
   frozen identity, ATIF trajectories (`OS/evals/science-harness/README.md:56-79`;
   `OS/tooling/harbor/openscience_harbor/agent.py:317`). Terminal-Bench Science would be an external rung Claude did not
   write, once Modal credentials exist.
10. **Deterministic stress matrix on a fake provider** (`OS/evals/cadence-harness/stress-matrix.ts:1-75`) as a model
    for $0 conformance tests of Foundry's executor adapters.
11. **Knowledge-cutoff line** in prompts that pin versions (`SRC/session/system.ts:284-302`). Trivial.

Do **not** adopt: the reader's grader-shaped card (`SRC/agent/prompt/reader.txt:14-24`), which is tuning toward one
benchmark's rubric; the fail-open reviewer; regex extraction of the contract from the first message as the only
contract source.

### 10.3 What OpenScience lacks that Foundry has

| Foundry asset | OpenScience gap | Evidence |
|---|---|---|
| Typed contracts per step | outputs are files and free text; the worker handoff is a prose report | `schemas/workflow.schema.json:138-209`; vs `SRC/agent/prompt/specialist.txt:12-13` |
| Executable verification with independence labels | the only model check uses the lead's own model and fails open; `/review` is same session, same model | `src/verdict.mjs:7-26`, `schemas/workflow.schema.json:189`; vs `SRC/harness/review.ts:217,247-250` |
| Honest verdict vocabulary | no run verdict; a session "completes" when the model stops | `src/verdict.mjs:7-26`; vs `OS/evals/cadence-harness/run.ts:137-172` |
| Need router (whether to build structure at all) | none; the model decides how much to plan or delegate | `experiments/need-router/router.mjs:1-40`; vs `SRC/session/prompt.ts:2544-2565` |
| Cheap-model construction and execution | frontier models run everything; no node-level model assignment | `README.md:130-162` (P1), `docs/THESIS.md:356`; vs `SRC/tool/task.ts:450` |
| Journaled record/replay | durable transcripts and Task attempts, but no replay of model calls | `src/journal.mjs:1-10`; vs `SRC/tool/task-attempt.ts:10-80` |
| Untrusted-data labels and control taint | web, paper and MCP text enter the context unlabeled; one regex scrubs skills | `src/validate.mjs:239-245`, `src/context.mjs:8`; vs `SRC/tool/skill.ts:253-254` |
| Compare-and-swap state, one writer per item | shared mutable working directory for lead and workers | `src/state.mjs:38-52`; vs `SRC/tool/task.ts:486-491` |
| Held-out evaluation discipline | public benchmarks used for development; one counted trial vs 3–5; held-out launch prompts public | `research/PREREGISTRATION-TEMPLATE.md:1-40`; `README.md:95`; vs §7.1–§7.3 |
| Reuse that must be earned | 372 skills admitted by provenance, not by measured lift | `docs/ROADMAP.md:578-616`; vs §3.5 |

### 10.4 Biggest risks of their design

1. **Verification is mostly prose.** Method, preregistration, citation and evidence rules are instructions; the code
   checks file shape, user-typed commands and study bookkeeping (§6). A run can end with a wrong analysis that passes
   every unit [inference].
2. **The one semantic check is correlated and fails open.** Same model as the lead, `COMPLETE` on error
   (`SRC/harness/review.ts:217,247-250`) [code].
3. **Benchmark-shaped tuning and thin evidence.** Review unit and reader card built from the reported 50-task set; one
   counted trial against multi-trial leaderboards; margins inside noise; internal bench unpublished (§7.1) [inference
   from code and docs].
4. **Prompt injection to action.** Untrusted paper, web and MCP text shares the context with bash and edit; in Full
   access there is no sandbox and no shell approval (`SRC/permission/next.ts:116`; `OS/SECURITY.md:11`) [code, doc].
   Project skills (trusted projects only) override bundled skills of the same name, so a repository can replace a core
   procedure (`SRC/skill/skill.ts:155`) [code; inference on the risk].
5. **Unscoped workers.** Specialists inherit allow-all defaults; workers share one directory with no concurrency cap
   (§4.3, `OS/CHANGELOG.md:1956-1957`) [code, doc].
6. **Docs that overstate the build.** Research contracts and preregistration documented as fail-closed but unreachable
   (§6.2); delegation said to be off in benchmark runs but on in code (§7.1.4) [code, doc].
7. **Fragile contract capture.** Deliverables and acceptance come only from regexes over the first user message and
   live in memory, so later instructions and restarts are not covered (§5) [inference from code].
8. **Privacy default.** Full traces upload by default when signed in, including BYOK and local-model sessions
   (`OS/ARCHITECTURE.md:80-82`; `OS/SECURITY.md:21`) [doc].
9. **Silent model fallback** when the configured provider is missing (`SRC/provider/provider.ts:3449-3458`) [code];
   Foundry's policy forbids this.

---

## Appendix A. Doc–code inconsistencies found

| Claim | Where | What the code shows |
|---|---|---|
| "`--auto-approve` still disables delegation" | `OS/evals/science-harness/README.md:21`; `OS/docs/notes/scientific-harness-design.md:103-106` | "Headless runs keep delegation" `SRC/cli/cmd/run.ts:586-605`; landing reports worker models `OS/frontend/landing/src/pages/Benchmark.tsx:537-540` |
| "Research already indexes the fifteen core skills" | `OS/evals/science-harness/README.md:15-16` | 22 core skills `OS/backend/cli/skills/core/` |
| Research completion contracts with fail-closed gates | `OS/docs/notes/harness-manifests.md:82-115` | no `research_contract` tool; `SessionResearch` writers uncalled (§6.2) |
| 3 trials per task to match leaderboards | `OS/evals/science-harness/README.md:58-61` | "one counted trial per task" `OS/frontend/landing/src/pages/Benchmark.tsx:540` |
| Skill install "may need a configured model for review" | `OS/frontend/docs/src/content/openscience/skills.mdx:48` | regex layers only `SRC/skill/install/install.ts:46-142` |
| 371 / ~340 / 372 skills; 42 / ~49 connectors | landing, docs | counts in §3.1 and §4.1 |
| `goal` system skill | `SRC/skill/system/goal.txt` | no TypeScript reference |

## Appendix B. Unknowns

- Per-trial results, selection of the "counted" trial, task-level variance and costs for every reported benchmark
  [unavailable: `benchmarks-openscience` not acquired].
- OpenScience Bench tasks, grader and runs [unavailable].
- Any ablation showing a harness unit or skill improves outcomes [unavailable].
- Hosted Ace service behaviour, managed pricing and trace-ingest handling [unavailable].
