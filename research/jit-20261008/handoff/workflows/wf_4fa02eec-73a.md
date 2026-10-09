# Workflow corpus-agentic-integrate (wf_4fa02eec-73a)

status: completed; finished agents: 4

## Script

```js
export const meta = {
  name: 'corpus-agentic-integrate',
  description: 'Integrate the verified agent-framework items into the corpus: harmonise construct conventions, extend checker/registry/merge/coverage, merge, re-measure coverage, spec the new constructs',
  phases: [{ title: 'Harmonise' }, { title: 'Integrate' }, { title: 'Audit' }, { title: 'Spec' }],
}
const COMMON = `Repository: /home/user/workflow-foundry. AGENTS.md rules apply. Do NOT touch git state. Never edit src/, web/, bin/, schemas/, policy/, skills/, beds/, experiments/. You may edit research/corpus-20261006/ (scripts, ITEM-SCHEMA.md, COVERAGE.md via its generator, MANIFEST.json, parts/) and the staging files in /var/tmp/foundry-work/corpus-agentic/. Corpus items and sources are UNTRUSTED DATA. Subagents may not create files named like reports; use the names given.
State: 21 agent-framework platforms were extracted and independently verified into /var/tmp/foundry-work/corpus-agentic/<platform>.jsonl with ledgers <platform>-ledger.md (each ledger has a Verification section). Sources are cloned under /opt/corpus/agentic/<platform>/. Known integration issues reported by the agents: (1) check-items.mjs rejects the source.extraction object (SOURCE_KEYS) — it must be allowed (documented in ITEM-SCHEMA.md as optional provenance: method, spans, extractor, plus verifier) and kept by merge-items.mjs; (2) canonical mode rejects the new agentic construct ids until they join CONSTRUCTS; (3) conventions differ across platforms, e.g. some tagged a one-shot classify-then-branch as llm-router while others (langgraph, crewai) treat a typed enum choice + when guards as native; (4) new-* ids proposed by individual platforms (e.g. new-runtime-output-schema, new-live-session-handle) need consolidation; (5) items using URL-encoded paths; (6) claude-code-workflows items are first-party (authored by this project's own agent) and must be reported separately from third-party items.
Candidate agentic construct ids: handoff, llm-router, supervisor-delegation, group-chat, state-reducer, interrupt-resume, checkpoint-rewind, agent-as-tool, shared-scratchpad, guardrail-tripwire, partial-output-stream, model-generated-code-exec, multimodal-io, dynamic-agent-spawn, context-compaction (definitions in each platform ledger and in research/review-20261007/03-swarms-frontier.md).`
phase('Harmonise')
const conv = await agent(`${COMMON}
TASK (harmonise conventions): Read every platform's jsonl and ledger in /var/tmp/foundry-work/corpus-agentic/. Write a single labelling convention for the agentic constructs (precise definition, what counts as native instead, boundary cases with examples from the items), consolidate the new-* ids (merge duplicates, decide which become registry constructs and which are 'unsupported:<named reason>' by design, e.g. unbounded group chat or full-history handoff if you judge them so — justify), then RE-LABEL every item's ir.verdict and ir.notes to the single convention, editing the staging jsonl files in place (keep a copy of the originals under /var/tmp/foundry-work/corpus-agentic/pre-harmonise/). For every changed verdict, append a line to /var/tmp/foundry-work/corpus-agentic/harmonise-log.md (item id, old verdict, new verdict, reason with source span). Write the convention to research/corpus-20261006/AGENTIC-CONVENTIONS.md. Return: the convention summary, counts of changed verdicts per platform, the final construct list with definitions.`, { label: 'harmonise', phase: 'Harmonise', model: 'opus', effort: 'xhigh' })
phase('Integrate')
const integ = await agent(`${COMMON}
TASK (integrate): Using the harmonised staging files and the convention (research/corpus-20261006/AGENTIC-CONVENTIONS.md; summary below):
1. Extend research/corpus-20261006/scripts/check-items.mjs: allow optional source.extraction (validated shape), add the agentic constructs to CONSTRUCTS (group 'agentic', with roadmap/today fields), keep everything else strict; add unit-style self-checks if the script has them.
2. Write research/corpus-20261006/scripts/agentic-assemble.mjs that assembles parts/agentic.jsonl (sorted, deterministic) and parts/agentic-ledger.md (all platform ledgers concatenated with a header table: platform, repos, sha, licence, items kept/dropped, verification summary) from the staging dir, marking first-party claude-code-workflows items.
3. Update merge-items.mjs and coverage-report.mjs so 'agentic' is a cluster (CLUSTERS, TOKEN_MAP, any per-cluster logic), first-party items are reported separately, and COVERAGE.md gains: agentic cluster tables, coverage of the agentic slice under the existing 19 constructs vs with the new constructs (declared), a combined greedy order over all constructs, and the 1,342-item numbers unchanged for the original clusters (verify they are byte-identical in the regenerated tables for those clusters).
4. Run the reproduce chain (cd research/corpus-20261006 && node scripts/agentic-assemble.mjs && node scripts/merge-items.mjs && node scripts/check-items.mjs items.jsonl --canonical && node scripts/coverage-report.mjs), fix until clean, regenerate the .gz parts and MANIFEST, and make sure scripts/unpack.mjs restores everything with hash checks.
Return: final item counts per cluster/platform, valid/invalid counts, the new coverage numbers (original corpus, agentic slice, combined; declared native / with 19 constructs / with all constructs), and any item dropped by the checker with reason.
CONVENTION SUMMARY:
${conv}`, { label: 'integrate', phase: 'Integrate', model: 'opus', effort: 'xhigh' })
phase('Audit')
const audit = await agent(`${COMMON}
TASK (independent audit): Audit the integration (summary below). (a) Sample 30 agentic items stratified across all 21 platforms; for each, open the cited source spans and check the harmonised verdict against AGENTIC-CONVENTIONS.md (agreement rate, and every disagreement with evidence). (b) Check that the original 1,342 items' verdicts and COVERAGE.md tables for the original clusters are unchanged (diff against git HEAD's COVERAGE.md and items via unpack). (c) Check licences/redistribution flags against policy, no secrets (run the checker's secret scan; also grep for webhook URLs such as hooks.slack.com/services and discord webhooks), and that only redistributable items carry more than graph+features in committed files. (d) Re-run the reproduce chain from a clean unpack and confirm determinism (byte-identical outputs twice). Fix clear errors in place (staging files, parts, scripts) and re-run the chain; list anything you could not resolve. Return the agreement rate, fixes made, and open issues.
INTEGRATION SUMMARY:
${integ}`, { label: 'audit', phase: 'Audit', model: 'opus', effort: 'xhigh' })
phase('Spec')
const spec = await agent(`${COMMON}
TASK (spec): Write research/review-20261007/02b-agentic-constructs.md: for each agentic construct in the final registry (and each 'unsupported by design' decision): measured frequency in the corpus (by platform, third-party vs first-party), precise semantics, proposed Foundry IR syntax (additive, portable JSON-Schema subset, consistent with research/review-20261007/02-ir-expressiveness.md and the executor/swarm/board decisions in 00-SYNTHESIS.md), runtime semantics (durability/replay, budgets, cancellation, idempotency, labels/authority, security under untrusted text), validator checks, test plan, effort; then an updated staged plan that reaches 100% declared coverage of the combined corpus (original + agentic) with the greedy order and the per-stage declared coverage numbers from the regenerated COVERAGE.md, and which constructs to refuse by name and why. Return the stage table and the refusals.
AUDIT SUMMARY:
${audit}`, { label: 'spec', phase: 'Spec', model: 'opus', effort: 'xhigh' })
return { conv, integ, audit, spec }
```

## Agent result 1

I re-labelled all 217 staged items to one convention. 83 verdicts changed, all in the 207 third-party items, and 33 of them now read `unsupported:by-design-*`. The 10 first-party `claude-code-workflows` items did not change, and I report them separately. Checking every file with `check-items.mjs` (with `source.extraction` stripped) passes everything except the 10 first-party items, which still fail on `source.url` because their URLs are local paths. That issue predates this pass. I did not edit `check-items.mjs` or any other script. The 12 registry entries to add to `CONSTRUCTS` are written out, ready to paste, in section 3.3 of the convention file.

## The convention

**What a token means.** A `via-extension` token now names an IR mechanism the item actually needs, never just a topology. Topologies that need no new mechanism are recorded in the notes as "Native patterns, no token" so they stay countable. Verdict tokens follow the existing registry order, then the agentic additions.

**General rules:**
- Tag what the shipped code and configuration can reach, including model-chosen and failure paths. Don't tag capabilities the item never uses.
- Printing tokens or progress to the console adds no construct.
- The framework's own vocabulary doesn't decide the tag. What decides is who picks the next agent (code, a manager model, or the active agent) and what context the receiver gets (a typed payload, or the shared conversation).
- A loop meant to end (tool loop, reflection, retry, game) is native once a cap is named. An open-ended process (endless poller, chat with no end) becomes triggered bounded runs plus `cross-run-state`.

**Retired as tokens, now native patterns:**
- `llm-router`: written as an `agent` with `role:"route"` and an enum output, then `when` guards. This is the repo's own mapping, and it settles the main split: langgraph, crewai, burr and others treated typed choices as native, while google-adk, autogen, ag2, inngest and openai-agents tagged `llm-router`.
- `supervisor-delegation`: either a capped route loop, or already covered by `agent-tool-loop+agent-as-tool`.
- Three more pattern labels: code-selected chat, typed handoff, and transfer into a task pipeline.

**Refused by design**, following 00-SYNTHESIS §3.1, ROADMAP-AMENDMENTS and the principle "share decisions and artifacts, not transcripts":
- **`unsupported:by-design-group-chat` (13 items):** agents share one transcript and a model picks the next speaker. A chat whose speaker order is fixed by code stays native.
- **`unsupported:by-design-full-history-handoff` (20 items):** a model starts the transfer, and the receiving agent carries on the same conversation. Transfers chosen by code, typed handoffs without the transcript, and transfers into task pipelines count as routing.
- Each refused item's notes list the other constructs it would need as `Needs: a, b.`, the form `merge-items.mjs` already reads.

**Sharper boundaries for constructs that drifted across platforms:**
- **`chat-session`:** an open-ended conversational entry point. Scripted multi-turn sessions count; finite tasks that pause for input do not.
- **`cross-run-state`:** any chat that carries history between turns also gets this token, matching the main corpus.
- **Live voice sessions:** `stream` plus `partial-output-stream`, not `chat-session`.
- **`partial-output-stream`:** only when the item's own code delivers partial output to a consumer, or acts on it mid-run.
- **`shared-scratchpad`:** only when the order of readers and writers is decided at run time.
- **`guardrail-tripwire`:** only validators that run concurrently, inside the tool loop, or on a live stream.
- **`context-compaction`:** only summarisation or trimming on overflow; fixed windows don't count.
- **`model-generated-code-exec`:** general-purpose code only; SQL and arithmetic expressions passed to a fixed tool don't count.

**The `new-*` ids:**
- `new-live-session-handle` becomes the registry construct `env-session`, mapped to the roadmap's `env` contract.
- `new-runtime-output-schema` is dropped: it can be written natively as a generic output plus a code check against the run's schema and a bounded resample.
- `new-join-early-cancel` appeared only in a ledger, never in an item; it corresponds to the planned `await race` / `first_k` primitive.

## Changed verdicts per platform

| platform | changed | of which refused |
|---|---|---|
| ag2 | 5 | 4 |
| agno | 5 | 0 |
| anthropic | 2 | 0 |
| autogen | 7 | 6 |
| burr | 3 | 0 |
| crewai | 2 | 0 |
| dspy | 1 | 0 |
| google-adk | 10 | 3 |
| haystack | 2 | 1 |
| inngest-agentkit | 2 | 1 |
| langgraph | 7 | 4 |
| llamaindex-workflows | 5 | 1 |
| mastra | 1 | 0 |
| metagpt-camel | 2 | 1 |
| openai-agents | 10 | 4 |
| openai-swarm | 4 | 3 |
| pydantic-graph | 1 | 0 |
| semantic-kernel | 5 | 5 |
| smolagents | 4 | 0 |
| strands | 5 | 0 |
| **third-party total** | **83** | **33** |
| claude-code-workflows (first-party) | 0 | 0 |

Third-party distribution went from 44 native / 163 via-extension to 45 native / 129 via-extension / 33 refused. The crewai Gmail poller became `poll-trigger+agent-tool-loop+cross-run-state`, and its `features.async` gained `poll`; no other feature field was touched.

## Final construct list for agentic items

Counts are for the 184 non-refused items; brackets add the `Needs:` lists of the refused ones.

**Existing registry ids, as applied here:**
- **`agent-tool-loop`** (110, [138]): a model chooses whether, which and how often to call tools (including hosted ones), and results return to a model. A forced single call, or a terminal routing tool, is native.
- **`chat-session`** (24, [36]): open-ended conversational entry point; each user message is a turn in one ongoing conversation.
- **`cross-run-state`** (31, [43]): state written by one invocation and read by a later one, including carried chat history.
- **`stream`** (2, [3]): continuous inbound media into a running live session.
- **`unstructured-cycle`** (2): a cycle with several entry points in authored control flow. Not added for handoff or group-chat meshes.
- Triggers, `subworkflow-call`, `dynamic-dag` and the failure ids keep their existing meanings.

**New registry constructs:**
- **`state-reducer`** (0): parallel writers to one key, where the merge order or a mid-run reader depends on timing. Kept for the planned board mechanism.
- **`interrupt-resume`** (15, [23]): a pause inside a node (tool approval, a tool that asks the user, a task-mode agent waiting across turns) that resumes into the same model loop.
- **`checkpoint-rewind`** (4): restart or fork from an earlier checkpoint, not just resume from the latest one.
- **`agent-as-tool`** (30, [31]): another agent's model calls a sub-agent as a tool and gets its result back, including spawn/send/wait tools.
- **`shared-scratchpad`** (6, [9]): agents read and write a common store in an order decided at run time, by a model or by concurrency.
- **`guardrail-tripwire`** (6, [7]): a validator running concurrently, inside the tool loop, or on a live stream, that can halt or redirect the run.
- **`partial-output-stream`** (11, [13]): partial output leaves a running node, either to an outside consumer (server route, UI, returned stream) or to an in-run consumer.
- **`model-generated-code-exec`** (41, [48]): general-purpose code written by a model is executed during the run.
- **`multimodal-io`** (14, [18]): images, audio, video or file parts go into or come out of a model step.
- **`dynamic-agent-spawn`** (6, [7]): a model defines new agents, or creates persistent agent instances it addresses later by handle.
- **`context-compaction`** (3): the framework summarises or trims an agent's history on overflow.
- **`env-session`** (3, [4]): a long-lived external environment (browser, simulator) that many steps mutate and the run record can't capture.

## Decisions you may want to revisit

- **The refusals rest on proposed text.** ROADMAP-AMENDMENTS is not yet merged into `docs/ROADMAP.md`. If you lift a refusal, those 33 items move back to `via-extension` using their `Needs:` lists.
- **Task-pipeline exception.** Three google-adk transfers into fixed pipelines (deep-search, release analyzer, workflow triage) are treated as routing. A purely mechanical reading would refuse them too, because ADK passes the conversation along by default.
- **Code-selected chats stay native.** That covers the AG2 speaker function, the Burr/LangGraph collaboration examples and MetaGPT werewolf. A stricter rule would refuse every shared-transcript conversation, including CAMEL role-play and the reflection loops.
- **Chat history counts as `cross-run-state`, and scripted sessions count as chat.** This follows the main corpus but contradicts the google-adk, openai-agents and strands verifiers.

Everything is in `/var/tmp/foundry-work/corpus-agentic/` (originals in `pre-harmonise/`, change log in `harmonise-log.md`), except the convention itself:
- `/home/user/workflow-foundry/research/corpus-20261006/AGENTIC-CONVENTIONS.md`
- `/var/tmp/foundry-work/corpus-agentic/harmonise-log.md`
- `/var/tmp/foundry-work/corpus-agentic/pre-harmonise/`

## Agent result 2

The agentic slice is integrated and the reproduce chain runs clean. All 1,559 items pass `--canonical`, nothing was dropped, and the tables for the 1,342 original items are byte-identical to the old report.

**What I checked**
- **Original sections unchanged:** `COVERAGE.md` lines 6–550 (sections 1–9) are byte-identical to the old file. Only line 3 (header) and line 5 (reproduce command) changed. The first 1,342 lines of `items.jsonl`, `items-sample.jsonl` and the four original `.gz` parts are also byte-identical.
- **Restore from scratch:** in a scratch copy holding only what git would hold, `unpack.mjs` restored every file with matching hashes. Re-running the chain there reproduced `COVERAGE.md`, `MANIFEST.json`, `merge-log.json`, `items.jsonl` and both agentic files exactly. A corrupted `.gz` is refused and the script exits 1.
- **Checker self-test:** `check-items.mjs --self-test` passes 58 of 58.

**Item counts**
- By cluster: automation 395, orchestration 396, science 278, consumer-creative 273, agentic 217 (207 third-party, 10 first-party). Total 1,559.
- Agentic by platform, as items (native / via-extension / refused by design):

| platform | items | native / via-ext / refused |
|---|---|---|
| ag2 | 8 | 0/4/4 |
| agno | 10 | 2/8/0 |
| anthropic | 12 | 5/7/0 |
| autogen | 14 | 4/4/6 |
| burr | 8 | 3/5/0 |
| camel | 3 | 1/2/0 |
| metagpt | 4 | 0/3/1 |
| crewai | 13 | 4/9/0 |
| dspy | 10 | 4/6/0 |
| google-adk | 15 | 3/9/3 |
| haystack | 8 | 3/4/1 |
| inngest-agentkit | 7 | 0/6/1 |
| langgraph | 18 | 3/11/4 |
| llamaindex-workflows | 10 | 4/5/1 |
| mastra | 8 | 2/6/0 |
| openai-agents | 18 | 3/11/4 |
| openai-swarm | 6 | 1/2/3 |
| pydantic-graph | 9 | 1/8/0 |
| semantic-kernel | 9 | 1/3/5 |
| smolagents | 6 | 0/6/0 |
| strands | 11 | 1/10/0 |
| claude-code-workflows (first-party) | 10 | 0/10/0 |

- Third-party total: 45 native, 129 via-extension, 33 refused (group chat 13, full-history handoff 20).

**Validation and drops**
- Valid: 1,559; invalid: 0.
- Assembler: 217 kept, 0 dropped. Merge: 0 dropped as invalid. The 5 duplicates dropped are the same original-cluster ones as before.
- The 10 items lost at verification were dropped before staging, by the platform verifiers: first-party 4, and one each from crewai, mastra, openai-swarm, pydantic-graph, semantic-kernel and smolagents. They are recorded in the ledgers, not dropped by the checker.

**Coverage** (declared native / with the 19 original constructs / with all 31 constructs; refused and not-expressible items are counted separately)

| slice | items | declared native | with 19 | with all 31 | refused | not expressible |
|---|---|---|---|---|---|---|
| original corpus | 1,342 | 476 (35%) | 1,340 | 1,340 | 0 | 2 |
| agentic third-party | 207 | 45 (22%) | 87 (42%) | 174 (84%) | 33 | 0 |
| combined (original + third-party) | 1,549 | 521 (34%) | 1,427 (92%) | 1,514 (98%) | 33 | 2 |
| first-party (not pooled) | 10 | 0 | 0 | 10 | 0 | 0 |

In the combined greedy order, the first 17 steps are all original constructs (`subworkflow-call` first, then `webhook-trigger`, `error-branch`, …). The first agentic construct is `model-generated-code-exec` at step 18; `env-session` is last at step 30.

**Decisions you may want to revisit**
- **Construct groups:** all 12 new constructs are in group `agentic`, as the task said. The convention file's §3.3 had put six of them in the state, async and dynamism groups.
- **First-party URLs:** the first-party items now pass because the checker accepts a `local:<relative path>` URL, but only for `claude-code-workflows`. They are also marked by a sentence at the start of their notes, and every report keeps them apart.
- **Graph evidence not applied:** for the agentic cluster, the merge no longer turns error edges into `error-branch` or sub-workflow nodes into `subworkflow-call`. The model readers had already judged these. Applying the old rule would change verdicts on 43 items; the evidence is recorded in the notes and `merge-log.json` instead.
- **Notes cut:** the existing 2,000-character limit on notes truncates 170 of the 217 agentic items. The harmonisation header, including the `Needs:` lists and native patterns, survives in every item. Full notes stay in `parts/agentic.jsonl`, and the source spans in `source.extraction`.
- **Verifier field:** where it was missing, the assembler fills `source.extraction.verifier` with a pointer to that platform's Verification section.
- **Encoding:** I documented one rule in `ITEM-SCHEMA.md`. URLs and any path inside an id are percent-encoded; `rawPath` is the literal path. The crewai `Coding%20Assistant` item already follows it.
- **Git:** I did not touch git, but a WIP snapshot commit (`016983d`, made by another process) captured early versions of `check-items.mjs`, `agentic-assemble.mjs` and `AGENTIC-CONVENTIONS.md`. The working tree has the final versions; the rest of my changes are uncommitted.

**Files** (in `/home/user/workflow-foundry/research/corpus-20261006/`)
- `scripts/check-items.mjs`
- `scripts/agentic-assemble.mjs` (new)
- `scripts/merge-items.mjs`
- `scripts/coverage-report.mjs`
- `scripts/unpack.mjs` (new `--check` and `--pack` modes)
- `ITEM-SCHEMA.md`
- `COVERAGE.md`
- `MANIFEST.json`
- `merge-log.json`
- `items.jsonl.gz`
- `parts/agentic.jsonl.gz` (new)
- `parts/agentic-ledger.md` (new)

## Agent result 3

**Audit of the agentic corpus integration (corpus-20261006)**

The integration mostly holds up. 28 of the 30 sampled items match the convention exactly. The original corpus is unchanged, and the reproduce chain gives byte-identical output on two runs from a clean unpack. I fixed two missed `env-session` needs, one span-encoding error and three script gaps. One sampled item disagrees and I left it for you to decide.

**(a) Agreement rate**
- **Sample:** 30 items drawn with a fixed seed across all 21 staging files: one per file, plus a second from the 9 largest. That is 29 third-party and 1 first-party; 7 native, 16 via-extension, 7 refused.
- **Exact match (verdict and `Needs:` list): 28/30 (93%).** Third-party only: 27/29 (93%).
- **Verdict string only:** 29/30 (97%). Verdict class (native / via-extension / refused): 30/30.

Disagreements, with evidence:
1. **`metagpt:MetaGPT/metagpt/software_company.py#mgx-team-leader-software-team`** (refused, group chat). Its `Needs:` list was missing `env-session` (rule ES). Every RoleZero role holds one `Browser` (`roles/di/role_zero.py:L88`, tool map `L130-L145`). The page view is re-read into memory every step (`L242`). The product manager, engineer and data analyst all get Browser tools (`product_manager.py:L37`, `engineer2.py:L44`, `data_analyst.py:L37`). The browser holds a Playwright page that is excluded from serialisation (`tools/libs/browser.py:L72-L79`). That file is outside the sparse checkout, so I read it from the git object at the pinned commit. **Fixed.**
2. **`strands:samples/python/02-deploy/04-agentcore-multi-agent/01-a2a-orchestration/orchestrator/agent.py`**. Under rules G1, CS (served chat agents) and CM, it should also carry `chat-session` and `cross-run-state`. `orchestrator/app.py:L75-L83` creates one agent when the container starts, and every request at `L119` calls `orchestrator.stream_async` on that same agent. So conversation history piles up across requests. The verifier declined to tag it until AgentCore's session-to-container mapping is known. There is also a precedent the other way: Haystack `query_decomposition` treats an accidental accumulation as not cross-run-state. **Not fixed; you decide.**

**Outside the sample:** a consistency scan found the same gap in `autogen:…/_magentic_one_orchestrator.py#magentic-one-orchestrator`. Its WebSurfer keeps a live Playwright page across turns (`_multimodal_web_surfer.py:L255`, `L319-L336`; `magentic_one.py:L211-L215`). **Fixed** by adding `env-session` to its `Needs:`.

**Agreed, but close calls you may want to settle:**
- **OpenAI `input_guardrails`:** gets `guardrail-tripwire` because the convention names it as an example. But the guarded agent has no tools, and the same rule says a check around a tool-free agent is native. The convention contradicts itself for this case.
- **inngest deep-research:** parallel branches claim URLs from a shared set on a first-come basis. Neither the shared-scratchpad nor the state-reducer definition fits as written; I accepted the native rewrite.
- **DSPy RLM:** `agent-as-tool` and `dynamic-agent-spawn` are tagged although the recorded run did not use them. That is consistent with G1, because the model's prompt advertises sub-agents (`rlm.py:L82-L94`).

**(b) Original corpus unchanged**
Compared against commit `1048783` (the 1,342-item corpus):
- `COVERAGE.md` lines 6–550 are identical; only line 3 (header) and line 5 (reproduce command) changed.
- The first 1,342 lines of `items.jsonl`, the four original `.gz` parts and their ledgers are byte-identical.
- In `merge-log.json`, the original-cluster entries are the same: drops, dedupe, cycle artefacts, fix counts and examples, feature changes, verdict changes, kind transitions and token map. `MANIFEST.json` source entries for the original clusters (219) are identical.

**(c) Licences and secrets**
- **Licences:** every third-party repository's licence file matches the recorded licence; agno is Apache-2.0 at the pinned commit, and no mastra item is under `ee/`. There are no copyleft agentic items.
- **Non-redistributable items (25):** crewAI-examples 8, haystack-cookbook 6, the Anthropic SDK example 1 (MIT licence vs Commercial Terms in its README), and the 10 first-party scripts. All carry only written descriptions. Their longest verbatim overlap with source is 73 characters (a tool-name list), and 56 in the ledgers (a URL).
- **Secrets:** 0 hits for the checker's patterns plus Slack, Discord, Teams and Telegram webhook patterns. I scanned every string field of `items.jsonl` and all parts, `agentic-ledger.md`, every staging file, `COVERAGE.md`, `MANIFEST.json` and `merge-log.json`. There are no email addresses.
- **Gap found:** the checker's own secret scan skipped `ir.notes`, `oracle.notes` and the licence evidence, and had no webhook patterns. Fixed.

**(d) Reproduce chain**
- I made two clean copies holding only git-tracked and new files and ran unpack, then `agentic-assemble`, `merge-items`, `check-items --canonical`, `coverage-report` and `unpack --check`.
- Both runs were byte-identical to each other and to the working tree for `COVERAGE.md`, `MANIFEST.json`, `merge-log.json`, `items.jsonl`, `items-sample.jsonl`, `parts/agentic.jsonl` and `parts/agentic-ledger.md`. The `.gz` files pass `unpack --check`.
- With the staging directory absent, the assembler keeps the committed part and the chain gives the same output.

**Fixes made**
1. `scripts/unpack.mjs`: a corrupt `.gz` crashed the script with an uncaught zlib error, so the remaining files went unchecked. It is now reported as a failure (exit 1) and the run carries on.
2. `scripts/check-items.mjs`: the secret scan covers every string of an item and adds webhook and token patterns. Span paths must not be percent-encoded. Self-test is now 70/70; no original item is affected.
3. `scripts/agentic-assemble.mjs`: it now applies the copyleft redistribution rule. Before, only the merge did, so a copyleft item could have reached the committed part marked redistributable.
4. `ITEM-SCHEMA.md`: documents the secret-scan rule, and that span paths are literal like `rawPath`.
5. Staging files, with originals backed up in the scratchpad:
   - `autogen.jsonl`: Magentic-One gains `env-session`.
   - `metagpt-camel.jsonl`: MGX gains `env-session`.
   - `crewai.jsonl`: the eight `Coding%20Assistant` spans decoded to `Coding Assistant`; the id and URL stay encoded.
   - `harmonise-log.md`: new "Audit corrections" section.
6. Re-ran the chain and repacked. Still 1,559 items, all valid, 217 kept, 0 dropped. Verdict strings and coverage tables are unchanged. Only COVERAGE §10.4 `env-session` (third-party 3 (6), was 3 (4); 6 platforms, was 4) and the §10.6 group-chat needs (`env-session` 2) moved.

**Open issues**
1. The Strands A2A chat-session question above.
2. `AGENTIC-CONVENTIONS.md` §3.2 and §8 still say `env-session` 3 (4); it is now 3 (6). That file was outside my edit scope.
3. The guardrail-tripwire contradiction for tool-free agents needs a ruling.
4. `merge-items.mjs:L402` stamps `generatedAt` with today's date, so re-running on another day changes `merge-log.json` and `MANIFEST.json`.
5. Already in `1048783`, out of scope: 30 copyleft items (29 GPL-3.0 consumer-creative, 1 MPL-2.0 orchestration) are marked redistributable with full text in the committed original parts, while `items.jsonl` applies the conservative policy. Also, `MANIFEST.json` says `items-sample.jsonl` is in git, but it is gitignored and has no `.gz`.
6. Minor:
   - 11 langgraph items have empty `oracle.notes`.
   - The MetaGPT span `metagpt/tools/libs/browser.py:L47-L79` resolves only through git, not on disk.
   - The first-party ledger contains a local scratchpad path (not a secret).
7. Another process made WIP commit `8fa9124` at 10:39:33. It captured my edits part-way, before the span fix; the working tree has the final versions. Still uncommitted: `ITEM-SCHEMA.md`, `check-items.mjs`, `COVERAGE.md`, `MANIFEST.json`, `merge-log.json`, `items.jsonl.gz`, `parts/agentic.jsonl.gz` and `parts/agentic-ledger.md`. I did not touch git.
8. Still yours to decide, as the integration summary listed: graph evidence not applied to 43 items, all twelve constructs in group `agentic`, and refusals that rest on ROADMAP-AMENDMENTS text not yet merged.

Files are in `/home/user/workflow-foundry/research/corpus-20261006/`:
- `scripts/check-items.mjs`
- `scripts/agentic-assemble.mjs`
- `scripts/unpack.mjs`
- `ITEM-SCHEMA.md`
- `COVERAGE.md`
- `MANIFEST.json`
- `merge-log.json`
- `items.jsonl.gz`
- `parts/agentic.jsonl.gz`
- `parts/agentic-ledger.md`

Staging files are in `/var/tmp/foundry-work/corpus-agentic/`:
- `autogen.jsonl`
- `metagpt-camel.jsonl`
- `crewai.jsonl`
- `harmonise-log.md`

## Agent result 4

Plan to 100% declared coverage of the combined corpus (1,549 items = 1,342 original + 207 agentic third-party), and the constructs refused by name. Stage numbers are copied from the regenerated `COVERAGE.md` §10.6. They are declared coverage only: nothing was compiled or executed. "Decided" counts expressible items plus items rejected with a named reason; first-party items are shown apart and not pooled. Effort is engineer-days, ±50%, an estimate.

| Stage | Adds | Newly expressible: original / agentic | Combined expressible | Combined decided | First-party | Effort |
|---|---|---|---|---|---|---|
| S0 | measurement pipeline, construct ledger, output contract, expressions, conformance skeleton | – | 521 (33.63%) | 556 (35.89%) | 0/10 | 18–27 (+14–21 engine bump) |
| S1 | subworkflow-call, flow-size>500 | 109 / 1 | 631 (40.74%) | 666 (43.00%) | 0 | 9–13 |
| S2 | error-branch, completion-hook, adaptive-retry, **model-generated-code-exec** | 132 / 9 | 772 (49.84%) | 807 (52.10%) | 0 | 11–19 |
| S3 | schedule/webhook/event/poll triggers, run-concurrency-policy | 297 / 2 | 1,071 (69.14%) | 1,106 (71.40%) | 0 | 21–31 |
| S4 | signal-wait, durable-wait | 69 / 0 | 1,140 (73.60%) | 1,175 (75.86%) | 0 | 9–14 |
| S5 | agent-tool-loop, chat-session, cross-run-state | 157 / 44 | 1,341 (86.57%) | 1,376 (88.83%) | 9 | 14–22 |
| S5b | **agent-as-tool, interrupt-resume, guardrail-tripwire, context-compaction** | 0 / 31 | 1,372 (88.57%) | 1,407 (90.83%) | 9 | 14–23 |
| S5c | **multimodal-io** | 0 / 6 | 1,378 (88.96%) | 1,413 (91.22%) | 9 | 4–7 |
| S6 | unstructured-cycle, stream, **partial-output-stream** | 64 / 13 | 1,455 (93.93%) | 1,490 (96.19%) | 9 | 15–22 |
| S7 | parametric-action-input, dynamic-dag, **dynamic-agent-spawn, checkpoint-rewind** | 36 / 15 | 1,506 (97.22%) | 1,541 (99.48%) | 9 | 25–38 |
| S8 | **shared-scratchpad, state-reducer** | 0 / 5 | 1,511 (97.55%) | 1,546 (99.81%) | 10 | 10–15 |
| S9 | **env-session** | 0 / 3 | **1,514 (97.74%)** | **1,549 (100.00%)** | 10/10 | 5–8 |

- **Final state by slice:** original 1,340/1,342 expressible plus 2 refused; agentic third-party 174/207 plus 33 refused; first-party 10/10.
- **Effort:** the agentic additions are 45–73 ed. S0–S9 total about 155–239 ed, plus the 14–21 ed engine bump.
- **Greedy order over the same bundles:** S3 +204 → S2 +192 → S5 +178 → S1 +176 → S4 +70 → S6 +70 → S7 +42 → S5b +43 → S5c +10 → S8 +5 → S9 +3.
- **Where the plan departs from greedy:**
  - S1 goes before S3, keeping lane 2's order. This costs 24–145 items over the first four bundles; the two orders are level after five.
  - S5b and S5c go before S6 and S7, because they extend the S5 tool loop and serve Foundry's own executor and approval needs. This costs 39–75 items after six to eight bundles; the orders are level after nine.

**Refused by name (35 items):**
- **`unsupported:by-design-full-history-handoff`: 20 items** (openai-agents 4, autogen 3, google-adk 3, langgraph 3, openai-swarm 3, ag2, haystack, llamaindex-workflows and semantic-kernel 1 each). A model starts the transfer and the receiving agent continues the same conversation. Refused because:
  - it breaks ROADMAP §2.2 rules 2 and 5: share decisions and artifacts, not transcripts; fork the full context only for escalation and repair;
  - Agents SDK filters do not redact tool arguments copied into messages, and the last handoff silently wins;
  - the receiver often holds stronger tools and inherits every untrusted earlier turn;
  - replay cost grows with the history.
- **`unsupported:by-design-group-chat`: 13 items** (semantic-kernel 4, ag2 3, autogen 3, inngest-agentkit, langgraph and metagpt 1 each). A model picks the next speaker over a shared transcript. Refused because:
  - it breaks the same principle, as recorded in THESIS D8 and ROADMAP §2.1 and §3;
  - failure data: MAST, CAMEL loops, and 17.2× error amplification for independent agents against 4.4× centralised;
  - untrusted input spreads to every participant;
  - there is no typed artifact for `verify` to check.
- **`unsupported:interactive-dashboard-state`: 2 Node-RED items.** Dashboard widget state is product surface, not workflow semantics, and dropping it silently would be flattening.

Both by-design refusals stay representable with a turn cap, but are not built until the owner asks. Nine forms are also refused inside supported constructs:
- model-written code that has network access or runs on the host;
- an interpreter session that cannot be rebuilt from its journal;
- opaque, provider-encrypted context compaction in an agent node;
- approvals remembered beyond a session, or written by a model;
- spawned agents whose IR, tools, model ids or schemas a model writes;
- unbounded spawning;
- partial outputs used as data or control;
- forking a run by id rather than by handle;
- guards that fail open next to effects.

**Findings outside the counts:**
- **Latent refusals in the original corpus.** A node-type probe finds 6 Flowise supervisor/worker teams (2 currently `native`) that the convention would refuse as group chat; I confirmed this in Flowise source at the pinned commit. The probe also finds 31 model steps over images or audio, 8 n8n agents used as tools and 2 n8n human-approval tools inside a tool loop. Applying these lowers the original slice at S5 from 1,240 to 1,206 expressible, but decided coverage stays 100%. Re-labelling the frozen original corpus needs a pre-registered amendment.
- **The audit's two open rulings move almost nothing.** Tagging the Strands A2A orchestrator as chat-session + cross-run-state moves no stage. My proposed guardrail ruling (count the construct only when concurrency changes what can be observed) moves one item from S5b to S5.

**Decisions for the owner** (each has a recommendation in the document):
- allow suspension at journaled tool-loop turn boundaries (amends ROADMAP L265);
- resolve the board experiment gate (ROADMAP L339–341) against THESIS D12 for S8;
- adopt the guardrail ruling;
- tag the Strands item;
- re-label both corpora under one convention before the IR freeze;
- confirm the S5b/S5c stage order;
- check whether the `claude -p` model route accepts images before S5c, which may otherwise need a credential.

In `coverage-report.mjs` I added a `STAGES` constant, a by-platform table in §10.4, the new §10.6 stage table (old §10.6–10.9 renumbered to 10.7–10.10), a `stages` array in its JSON output, and corrected the refusal provenance text. `COVERAGE.md` sections 1–9, `items.jsonl`, the parts and `MANIFEST.json` are byte-identical to before, and the canonical check still passes 1,559 of 1,559. I did not touch git. Another process's WIP snapshot `c709bf3` committed the generator change and `COVERAGE.md`, and `a21efc7` committed an early version of the document mid-edit, so the final document has uncommitted edits.

Files are in `/home/user/workflow-foundry/research/`:
- `review-20261007/02b-agentic-constructs.md`
- `corpus-20261006/scripts/coverage-report.mjs`
- `corpus-20261006/COVERAGE.md`
