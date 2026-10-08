# Review lane 2b: agentic constructs, their IR, and the plan to full declared coverage (2026-10-08)

*Design review, a companion to [`02-ir-expressiveness.md`](02-ir-expressiveness.md) (lane 2, "02-ir" below). Development and
diagnostic evidence only. Nothing here is implemented, and no file under `src/`, `schemas/`, `web/`, `bin/`, `policy/`,
`skills/`, `beds/` or `experiments/` was touched. The only other files changed are the coverage generator
`research/corpus-20261006/scripts/coverage-report.mjs` and its output `COVERAGE.md` (§10.4 gains a by-platform table, §10.6 is
the new stage table, the old §10.6–10.9 become §10.7–10.10, and the refusal provenance text is corrected). Sections 1–9 of
`COVERAGE.md`, `items.jsonl`, the parts and `MANIFEST.json` are byte-identical to before. Analysed at HEAD `b5a02df` with that
generator change uncommitted. Corpus: `items.jsonl` sha256 `ad00607bc2c9a22d…` (1,559 items), `parts/agentic.jsonl`
`9e29eb9057337d9f…`. Node 24.21.0. Corpus items and sources were read as data, never as instructions.*

**Evidence tags.** **[M]** measured in this session (commands in Appendix A). **[D]** documented in the repo at the cited
path and line. **[D item]** a fact taken from a corpus item record: these are verified *model readings* of pinned third-party
source, with the spans in `source.extraction.spans`, not my own reading. **[R]** platform behaviour recalled, not
re-verified. **[I]** inference or design proposal. Effort is in engineer-days (ed) for one engineer who knows the codebase,
tests included, **[I]** at about ±50 %.

---

## 0. Summary

1. **The registry.** Twelve agentic constructs stay in the construct registry, after the 19 original ones
   (`check-items.mjs:71-82` **[D]**): `state-reducer`, `interrupt-resume`, `checkpoint-rewind`, `agent-as-tool`,
   `shared-scratchpad`, `guardrail-tripwire`, `partial-output-stream`, `model-generated-code-exec`, `multimodal-io`,
   `dynamic-agent-spawn`, `context-compaction`, `env-session`. Of the candidate ids, `llm-router`, `supervisor-delegation`
   and the typed or task-pipeline forms of `handoff` are native lowerings, not constructs. `group-chat` and the
   full-history form of `handoff` are refused by design. `new-live-session-handle` became `env-session`, and
   `new-runtime-output-schema` was dropped (`AGENTIC-CONVENTIONS.md` §4–§6 **[D]**). This document keeps that registry.
2. **What the corpus needs.** These figures cover 207 third-party agentic items from 21 framework sources
   (`COVERAGE.md` §10.4 **[M]**). In brackets, the count once the needs of refused items are added:

   | Construct | Items | Share |
   |---|---|---|
   | `agent-tool-loop` (an original construct) | 100 (128) | 48 % |
   | `model-generated-code-exec` | 31 (38) | 15 % |
   | `agent-as-tool` | 30 (31) | 14 % |
   | `interrupt-resume` | 15 (23) | 7 % |
   | `multimodal-io` | 14 (18) | 7 % |
   | `partial-output-stream` | 11 (13) | 5 % |

   Six to three items each need `guardrail-tripwire`, `dynamic-agent-spawn`, `shared-scratchpad`, `checkpoint-rewind`,
   `context-compaction` and `env-session`. `state-reducer` has no item. Thirty-three items (16 %) are refused by design.

   The 10 first-party items (`claude-code-workflows`, written by this project's own agent) are reported apart. All 10
   need `agent-tool-loop` and `model-generated-code-exec`, and one also needs `shared-scratchpad`.
3. **Six design moves carry the twelve constructs** (§2, §3):
   1. **Turn boundaries become suspension points.** A capped tool loop already journals every turn (02-ir E3), so the
      boundary between turns becomes a durable suspension point (refining ROADMAP L265). That gives tool-call approvals,
      ask-the-user tools and in-loop guards without suspending inside opaque code.
   2. **An agent as a tool is a `call`.** It is a tool entry whose target is a local flow rooted at an agent, run with a
      per-call carved budget and a fresh context.
   3. **Spawning is template-only `expand`.** A model fills typed slots of a fixed agent template and never writes IR,
      tools, model ids or schemas.
   4. **Model-written code runs in the existing sandbox.** It is a `code` node with `sourceFrom`, always untrusted, never
      networked. Model-written code that needs effects is an `executor`.
   5. **Partial outputs are a caller channel only.** They are not journaled and never drive control flow. Their only
      in-run reader is a guard, and a guard can only cancel.
   6. **Shared state and environments use the planned mechanisms.** A shared scratchpad is board topics with one-level
      write grants. An environment session is a lease on the ROADMAP `env` contract, with replay rules for each
      determinism class D0–D2.
4. **The plan reaches 100 % declared coverage of the combined corpus** (original 1,342 + agentic third-party 207 = 1,549
   items) in eleven stages, counting items rejected with a named reason (`COVERAGE.md` §10.6 **[M]**):

   | Stage | Adds | Combined expressible | Combined decided (expressible + named refusals) |
   |---|---|---|---|
   | S0 | (start) | 521 (33.63 %) | 556 (35.89 %) |
   | S1 | call, flow size | 631 (40.74 %) | 666 (43.00 %) |
   | S2 | failure handling + model-written code | 772 (49.84 %) | 807 (52.10 %) |
   | S3 | triggers, admission | 1,071 (69.14 %) | 1,106 (71.40 %) |
   | S4 | signals, long waits | 1,140 (73.60 %) | 1,175 (75.86 %) |
   | S5 | state, sessions, tool loop | 1,341 (86.57 %) | 1,376 (88.83 %) |
   | S5b | agent-as-tool, interrupts, guards, compaction | 1,372 (88.57 %) | 1,407 (90.83 %) |
   | S5c | media | 1,378 (88.96 %) | 1,413 (91.22 %) |
   | S6 | machine, streams, partial outputs | 1,455 (93.93 %) | 1,490 (96.19 %) |
   | S7 | flow params, expand, spawn, fork | 1,506 (97.22 %) | 1,541 (99.48 %) |
   | S8 | run board | 1,511 (97.55 %) | 1,546 (99.81 %) |
   | S9 | env sessions | **1,514 (97.74 %)** | **1,549 (100.00 %)** |

   Expressible reaches 1,340 of 1,342 original items and 174 of 207 agentic third-party items; the first-party slice
   reaches 10 of 10. These are *declared* numbers: nothing is compiled or executed.
5. **Refused by name: 35 items in the combined corpus.** Two refusals are *by design*, representable with a turn cap but
   refused:

   | Refusal | Items | Platforms |
   |---|---|---|
   | `group-chat` | 13 | 6 |
   | `full-history-handoff` | 20 | 9 |

   One more refusal covers what is not workflow semantics: `interactive-dashboard-state`, 2 Node-RED items. Eight
   further *forms* are refused inside supported constructs (§4.5): networked model code, opaque compaction, persistent
   model-written approvals, and others.
6. **New findings that the counts do not yet include** (§6):
   - The original corpus was labelled before the agentic convention. A node-type probe finds items it would re-label:
     - 6 Flowise supervisor/worker teams are model-selected speakers over a shared transcript, so rule GC refuses them.
       I confirmed this in Flowise source at the pinned commit **[M]**; 2 of the 6 are declared `native` today.
     - About 31 items run a model over images or audio (n8n 25).
     - 8 n8n items call an agent as a tool.
     - 2 n8n items use human approval inside a tool loop.

     Applying the confirmed rows moves the stage numbers (S5 original 1,240 → 1,206) but not the 100 % decided total.
   - The two open item rulings left by the audit move at most one stage number by one item.
7. **Effort.** The agentic additions cost about **45–73 ed** on top of lane 2's estimate; S0–S9 sum to about
   155–239 ed, plus 14–21 ed of engine-bump prerequisites [I] (§5.4).
8. **Owner decisions** (§7). The main ones:
   - turn-boundary suspension (amends ROADMAP L265);
   - the board gate (ROADMAP L339–341) against THESIS D12 for representation;
   - the guardrail ruling;
   - a pre-registered re-labelling of the original corpus before the IR freeze;
   - whether the media stage may need an API model route.

---

## 1. Inputs, integration state and how the counts are made

### 1.1 Inputs

- **Corpus:** `research/corpus-20261006/items.jsonl` holds 1,559 items: 1,342 original items in four clusters and 217
  agentic items (207 third-party from 21 sources, 10 first-party). The agentic part is
  `parts/agentic.jsonl`, assembled from the 21 verified staging files in `/var/tmp/foundry-work/corpus-agentic/` under the
  labelling convention `research/corpus-20261006/AGENTIC-CONVENTIONS.md`.
- **Design baseline:** 02-ir §2 (conventions), §3 (the 19 original constructs: A1 call, B1–B3 failure, C1–C5 triggers,
  D1–D3 waits and streams, E1–E3 state, sessions, tool loops, F1–F3 dynamism, G1–G9 additions), §4 (composition), §5
  (what must not be allowed), §7 (stages S0–S7); [`00-SYNTHESIS.md`](00-SYNTHESIS.md) §3.6 (three bounded tool forms),
  §3.9 (swarm operator `wide`), §3.11 (`executor`), §3.12 (board), §7 (security gating) and Appendix C (composition
  matrix); [`07-context-subagents-audit.md`](07-context-subagents-audit.md) §2 (board design); `docs/ROADMAP.md` as
  amended in WIP commit `8fa9124` (§2.1 L126–L275, §2.2 L277–L354, §3 L765–L786); `docs/THESIS.md` §10 D8–D16
  (L355–L363).
- **Candidate definitions:** each platform ledger (`/var/tmp/foundry-work/corpus-agentic/<platform>-ledger.md`),
  [`03-swarms-frontier.md`](03-swarms-frontier.md) §1.5 and §2–3, and the harmonised definitions in
  `AGENTIC-CONVENTIONS.md` §3–§5.

### 1.2 The six integration issues are closed [M]

| Issue reported by the platform agents | State | Evidence |
|---|---|---|
| 1. `check-items.mjs` rejected `source.extraction` | Allowed, shape-checked, other keys still rejected; kept by `merge-items.mjs` | `check-items.mjs:28-30`; `ITEM-SCHEMA.md` "`source.extraction`"; `merge-items.mjs:10` |
| 2. Canonical mode rejected agentic ids | The 12 ids are in `CONSTRUCTS` after the 19 original ones | `check-items.mjs:71-82`; `check-items.mjs items.jsonl --canonical` → 1,559 valid; `--self-test` 70/70 |
| 3. Platforms disagreed on `llm-router` | One convention: routing is native (rule LR), and the topology is recorded in the notes | `AGENTIC-CONVENTIONS.md` §4 L199–L216; `COVERAGE.md` §10.8 |
| 4. `new-*` ids | `new-live-session-handle` became `env-session`; `new-runtime-output-schema` was dropped (rule NS); `new-join-early-cancel` is `await race` | `AGENTIC-CONVENTIONS.md` §6 L272–L278 |
| 5. URL-encoded paths | Ids and URLs are percent-encoded; spans and `rawPath` are literal; the checker enforces both | `ITEM-SCHEMA.md` "Encoding"; audit fix on the eight crewai spans |
| 6. First-party items | `FIRST_PARTY_PLATFORMS`; `local:` URLs only there; every report keeps them apart | `check-items.mjs:36-37`; `COVERAGE.md` §10.2, §10.9 |

The integration audit sampled 30 items. It agreed on verdict and `Needs:` for 28 of them (93 %), and on the verdict
class for all 30. It also fixed two missed `env-session` needs. Two of its rulings are still open: a Strands served-agent
item and `guardrail-tripwire` around a tool-free agent. §6.1 measures what each would move.

### 1.3 How counts are made

- **Tokens and needs.** "Items" counts verdict tokens. The figure in brackets adds the `Needs:` list of refused items
  (`COVERAGE.md` §10.4). "Only blocker" means the construct is the item's single token.
- **Party.** First-party items are never pooled with third-party ones.
- **Declared.** Coverage is *declared*: an item counts once every construct in its verdict exists in the hypothetical
  construct set of a stage. Nothing is compiled or executed (02-ir §8 explains why compiled and executed coverage come
  later).
- **"100 %".** It means ROADMAP §2.1's goal: "every workflow is represented exactly or rejected with a named reason"
  (L132–L140; THESIS D8, L355). The stage table therefore has two columns: *expressible*, and *decided* = expressible +
  named refusals.
- **The sample.** The agentic items are framework examples and templates chosen to cover each framework's
  orchestration features. That is a purposive sample, so frequencies describe it, not deployed agent systems
  (`COVERAGE.md` §10.10).

---

## 2. Conventions every agentic extension follows (in addition to 02-ir §2)

**A1. Turn boundaries are suspension points (refines R4).**
- ROADMAP §2.1 says "Suspension happens only at node boundaries" (L265; 02-ir §2 item 2).
- Proposed wording: *suspension happens only at node boundaries, or at a journaled turn boundary of a capped tool loop
  (`agent.tools`), where the loop's whole state is the journal prefix.*
- The capped loop already journals every model turn and tool result (02-ir E3, L890–L895). So between "model requested
  tool call *k*" and "tool *k* executes", the node's state is a pure function of the journal, and a resume is exact.
- The rule does not reach inside an `executor`: a vendor loop is opaque. Approvals there are blocking callbacks with
  timeouts, not durable suspensions (§3.3).
- A loop whose state is not fully journaled cannot suspend. An example is an interpreter session that cannot be
  rebuilt; such a loop fails `SUSPEND_NOT_REPLAYABLE`.

**A2. Sub-events of a loop turn.** All are journaled before control flow can read them (R2):
- `agent.turn.completed`;
- `agent.tool.requested {turn, callIndex, name, argsHash}`;
- `guard.evaluated`;
- `approval.requested`, then `approval.granted` or `approval.denied`;
- `agent.tool.started` and `agent.tool.completed`;
- `context.compacted`;
- `partials.delivered`;
- `env.step`.

**A3. Every sub-call is carved.** The following each reserve budget (steps, cost, ms) from the calling node's budget,
which is itself carved from the run (02-ir §4.4):
- an agent-as-tool child;
- a guard check;
- a compaction summariser;
- a model-written code execution;
- an environment step;
- a spawned agent.

Unused reservations are refunded. The root budget bounds the whole tree.

**A4. Labels.**
- Everything a model writes is untrusted text by default: code, agent instructions and spawn specs, summaries, questions
  shown to a human, the arguments of a tool call made from an untrusted context, and partial outputs.
- A summary's label is the join of the labels of what it covers.
- Media are untrusted.
- Only a `quarantined` node (no tools, at most 64 bits out; DESIGN §4 L158–L166) declassifies.
- Control decisions taken from untrusted data carry program-counter taint (02-ir G3; synthesis §7 items 1–2). This
  covers route enums, guard verdicts, `until`, and an action chosen from an environment observation.

**A5. Authority stays outside the model** (AGENTS.md; 02-ir §2 item 5).
- Approvals come only through the user approval channel, bound to `(runId, nodeKey, attempt, turn, callIndex, argsHash)`.
- A model, a guard, a peer agent or a signal is never an approval.
- No construct here lets a model:
  - grant a capability;
  - raise a model class past `maxClass`;
  - write an output schema;
  - activate a trigger;
  - fork or address a run it holds no handle for;
  - remember an approval beyond a session.

**A6. Transcripts are not shared.** ROADMAP §2.2 rule 2 (L281) and rule 5 (L284): `history` stays
`none | own | fork:<nodeKey>`, with `fork:` only for escalation and repair. Every construct below passes typed values or
board facts, never another agent's transcript. The validator enforces this (§4.2–4.3).

**A7. Syntax.**
- Additive `1.x` fields: a document declares the minor version it uses, and the validator rejects newer fields (02-ir §2
  item 1).
- Every *data* schema the IR carries stays in DESIGN §5.3's portable subset (L211–L214): tool `argsSchema`,
  `answerSchema`, `returns`, media handles, spawn specs, board topics.
- New IR objects use an enum discriminator (`"kind"`) plus optional fields, never key-presence unions. A portable
  validator can then describe them, and per-kind required fields are checked after parsing (02-ir §2 item 1).

  02-ir E3 wrote tool entries as `{ "tool": … }` or `{ "call": … }`. With seven entry kinds below (`capability`, `call`,
  `executor`, `human`, `code`, `env`, plus `send`/`await` for spawned handles), each entry gets an explicit `kind`.

**A8. Conformance.**
- Each construct ships with runtime-agnostic conformance fixtures (02-ir G9): synthetic fixtures plus lowerings of
  *redistributable* corpus items, with scripted model, tool and event tapes.
- Declared corpus oracles are listed per construct. None has been run.

---

## 3. The twelve registry constructs

Ordered by the stage that adds them (§5). Each entry has the same eight parts as 02-ir §3, with the measured frequency
first and the stage last.

### 3.1 `model-generated-code-exec` (stage S2; the interpreter session in S5b)

**Frequency [M].**
- **Third-party:** 31 items (15 % of 207), 38 with refused needs, on 17 platforms. By platform: smolagents 6, ag2 3 (4),
  autogen 2 (3), langgraph 2 (3), metagpt 2 (3), openai-agents 2 (3), anthropic 2, camel 2, dspy 2, strands 2,
  semantic-kernel 0 (2), and 1 each for burr, crewai, haystack, inngest-agentkit, llamaindex-workflows and pydantic-graph.
- **Only blocker:** in 9 items, the most of any agentic construct.
- **Co-occurrence:** with `agent-tool-loop` in 21 items, `interrupt-resume` 5, `agent-as-tool` 5.
- **Redistributable and oracles:** 29 of 31 are redistributable. Declared oracles: mocked-execution 4, test-profile 2,
  output-equivalence 2, none 23.
- **First-party:** 10 of 10. These are subagents that write and run code.
- **Original corpus:** 0 tokens. A node-type probe found no model-written code: Flowise `customTool` and n8n `toolCode`
  run authored code.

**Semantics.** Rule MC (`AGENTIC-CONVENTIONS.md` L140–L148): general-purpose code (Python, JavaScript, shell) that a model
writes during the run is executed during the run. Four forms occur:
- (a) generate → run → check → regenerate: the 9 sole-blocker items, among them the LangGraph code assistant, DSPy
  ProgramOfThought and the MetaGPT engineer and data interpreter **[D item]**;
- (b) code as the action language of a tool loop: smolagents `CodeAgent` (6 items), LlamaIndex CodeAct;
- (c) a code-interpreter tool, hosted or local;
- (d) a stateful interpreter session across steps: the smolagents executor state, the DSPy RLM REPL.

A query or expression handed to a fixed capability (SQL, numexpr) is a tool argument, not this construct.

In Foundry, the construct is a `code` node, or a `code` tool entry, whose source is a bounded string field of an earlier
output. It runs in the existing sandbox: user, net, mount and pid namespaces, `pivot_root`, `prlimit`, a clean
environment, no network (DESIGN §1.2, L41–L65). It is pure: effects `none`. Its output is untrusted whatever its inputs
are.

Model-written code that needs effects (edit a checkout, run a project's tests against it) is not this node. It is an
`executor` with a workspace handle, `egress: none` and a mandatory `verify` (ROADMAP L164–L189).

**IR.**
```jsonc
{ "id": "run_candidate", "kind": "code", "needs": ["write"], "description": "Run the generated solution on the examples",
  "lang": "python",
  "sourceFrom": { "$ref": "nodes.write.program" },   // replaces "source"; the field is a string with maxLength ≤ 65536
  "args": { "examples": { "$ref": "input.examples" } },
  "returns": { "type": "object", "required": ["passed"],
               "properties": { "passed": { "type": "integer", "minimum": 0, "maximum": 1000 } } },
  "sandbox": { "profile": "generated", "maxMemoryMb": 512, "maxCpuMs": 20000, "maxOutputBytes": 65536 },
  "timeoutMs": 30000,
  "onError": { "route": ["CODE_ERROR", "CODE_TIMEOUT"] } }        // 02-ir B1: the regenerate edge

// form (b)–(d) inside a capped tool loop (stage S5b): an interpreter as a tool, with an optional node-scoped session
"tools": { "allow": [
  { "name": "python", "kind": "code", "lang": "python",
    "argsSchema": { "type": "object", "required": ["code"],
                    "properties": { "code": { "type": "string", "maxLength": 20000 } } },
    "sandbox": { "profile": "generated" }, "session": { "scope": "node", "maxCells": 40, "maxBytes": 67108864 },
    "maxCalls": 12 } ] }
```
There is no `network` field. Model-written code never gets a network, not even by opt-in.

**Runtime.**
- *Durability and replay.*
  - `code.started {sourceHash, sourceRef}` and the source bytes are journaled before execution (R2).
  - Replay returns the recorded output.
  - Re-execution is allowed for audit, because the node is pure. A different output hash is reported as
    `CODE_NONDETERMINISTIC`, a diagnostic and not a failure.
- *Sessions, form (d).* Interpreter state cannot be serialised.
  - A session *is* its ordered list of journaled cells.
  - Resume rebuilds it by re-running those cells in a fresh sandbox with fixed seeds, comparing each cell's output hash.
  - A mismatch ends the node with `SESSION_REPLAY_DIVERGED` (a harness fault). The node never continues against
    unknown state.
  - Session state never leaves the node.
- *Budgets.* CPU, memory, wall time and output bytes per execution. Each execution is a step. In a loop it counts toward
  `maxToolCalls`.
- *Cancellation.* Process-group kill, as today.
- *Idempotency.* The node is pure, so re-execution is harmless and needs no key.
- *Labels and authority.*
  - The output label is the join of the source's label, the input labels and `untrusted:generated-code`. It is never
    `trusted`.
  - Model-written code cannot serve as an `execution`-independent `verify` of the output of the model that wrote it.
- *Security under untrusted text.* This is synthesis §7 item 6 (L1347): "only as sandboxed `code`, no network, tainted
  output". The threats and answers:
  - sandbox escape and resource exhaustion: namespaces and limits;
  - reading secrets: clean environment, empty `/home` and `/root`;
  - exfiltration through the output: bounded output, untrusted label, and only data sinks may take it;
  - injection back into the model through the output: an untrusted fence.

  `SANDBOX_UNAVAILABLE` fails the node and never falls back to running on the host.

**Validator.**
- `sourceFrom` resolves to a string field with `maxLength` ≤ 65,536 (`GENERATED_SOURCE_UNBOUNDED`).
- Exactly one of `source` and `sourceFrom` is set (`CODE_SOURCE_AMBIGUOUS`).
- A declared label that would make the output trusted is rejected (`LABEL_RAISE_REFUSED`).
- A `verify` whose program comes from the same model lineage cannot claim `independence: "execution"`
  (`VERIFY_NOT_INDEPENDENT`).
- `session` is allowed only on tool entries of a capped loop, with `maxCells` and `maxBytes`.
- Model-written code output used in `when` or `until` carries program-counter taint.

**Tests.**
- The gate test: network connect, reads of `/home` and `/root`, an environment dump, a fork bomb, a 2 GiB allocation and
  100 MB of output all fail with typed codes.
- Replay returns the recorded output, and a time-reading program is reported as nondeterministic.
- A session survives a crash; a cell that uses unseeded entropy diverges and fails closed.
- Model-written output that reaches a control sink of an effect fails `LABEL_POLICY`.
- Corpus lowering:
  - `langgraph:…/code_assistant/langgraph_code_assistant.ipynb` (test-profile);
  - `dspy:…/program_of_thought/index.ipynb#multihop-pot` (mocked);
  - `metagpt:…/examples/di/machine_learning.py#data-interpreter-plan-and-act` (mocked);
  - the session form: `smolagents:…/smolagents_benchmark/run.py#benchmark-agent-type-switch` (output-equivalence;
    needs S5).

**Effort.** 2–4 ed for forms (a)–(c) in S2, and 2–3 ed for sessions in S5b.

### 3.2 `agent-as-tool` (stage S5b)

**Frequency [M].**
- **Third-party:** 30 items (14 %), 31 with refused needs, on 13 platforms: openai-agents 5, agno 4, pydantic-graph 4,
  google-adk 3, strands 3, anthropic 2, crewai 2, mastra 2, smolagents 2, dspy 1, haystack 1, llamaindex-workflows 1,
  ag2 0 (1).
- **Co-occurrence:** always with `agent-tool-loop` (30 of 30); with `cross-run-state` in 8 and `chat-session` in 7.
- **Only blocker:** 0.
- **Redistributable and oracles:** 29 of 30 are redistributable. Declared oracles: mocked 6, test-profile 2,
  output-equivalence 1.
- **First-party:** 0. The first-party scripts call subagents from code, one node per call, which is native.
- **Original corpus:** 0 tokens. However, n8n's `@n8n/n8n-nodes-langchain.agentTool` node, an agent offered as a tool to
  another agent **[R]**, occurs in 8 n8n items that the converter labelled only `agent-tool-loop` [M probe].

**Semantics.** Rule AT (L105–L111): an agent with its own instructions and model loop is invoked by another agent's
model through a tool call, and its final result returns into the caller's loop. This includes:
- `as_tool` and `AgentTool`;
- CrewAI delegation tools;
- smolagents managed agents;
- sub-agents reached from model code;
- spawn/send/wait tools whose `wait` returns the worker reports.

Two things are not this construct: a sub-agent called by authored code (a node), and a model-chosen target that does
not return (routing).

In Foundry, it is a tool entry of `kind: "call"` whose target is a local flow, or a hash, rooted at an `agent` with its
own tools; or a tool entry of `kind: "executor"`. Each invocation is a child run (02-ir A1). Its typed input is built
from the model's tool arguments, and its typed output is the tool result. The callee starts with a fresh context, the
arguments only: its `history` is `none` or `own`, never the caller's transcript.

**IR.**
```jsonc
{ "id": "triage", "kind": "agent", "role": "plan", "…": "…",
  "tools": {
    "allow": [
      { "name": "research", "kind": "call", "target": { "flow": "researcher" },
        "description": "Research one question and return cited findings",
        "argsSchema": { "type": "object", "required": ["question"],
                        "properties": { "question": { "type": "string", "maxLength": 2000 } } },
        "budget": { "maxSteps": 40, "maxCost": 0.10, "maxDurationMs": 300000 }, "maxCalls": 4 },
      { "name": "fix_build", "kind": "executor", "executor": "claude-code",
        "budget": { "maxSteps": 1, "maxCost": 1.00, "maxDurationMs": 1800000 }, "maxCalls": 1 } ],
    "maxSteps": 8, "maxToolCalls": 12, "parallel": false, "maxNesting": 1 } }
"flows": { "researcher": { "inputSchema": { "…": "…" }, "outputSchema": { "…": "…" },
                           "nodes": [ { "id": "r", "kind": "agent", "tools": { "…": "…" }, "…": "…" } ],
                           "acceptance": [ "…" ] } }
```

**Runtime.**
- *Durability and replay.*
  - The child run id is `digest(parentRunId, nodeKey, attempt, turn, callIndex)`.
  - `agent.tool.started {turn, callIndex, name, childRunId, argsHash, carve}` is journaled before the child is created,
    and `agent.tool.completed {outputHash, childVerdict, childHead}` after it ends.
  - Replay reads the child's result and never re-runs it.
  - The child's chain head enters the parent's chain (02-ir §4.12).
- *Budgets.*
  - The per-call carve is reserved from the caller node's budget and refunded when unused.
  - `maxCalls` applies per entry and `maxToolCalls` per loop.
  - `maxNesting` defaults to 1, with a ceiling of 3. It counts toward the run-tree depth of at most 8 (02-ir §4.2).
- *Cancellation.*
  - Cancelling the caller cancels the child (structured concurrency).
  - A child with an effect in flight becomes `uncertain`. That state propagates upward and is never handed to the model
    as an ordinary tool error.
- *Failure mapping.*
  - A child `pass` becomes the tool result.
  - A child `inconclusive`, `harness_fault` or routable code becomes a typed tool error `{ok:false, code}` that the model
    may react to, within `maxToolCalls`.
  - A child that runs out of budget gives `{ok:false, code:"BUDGET"}`.
  - A child `env_fault` is the caller's env fault and is never shown to the model.
- *Idempotency.* The deterministic child id makes child creation exactly-once across crashes. Effects inside the child
  keep their own keys.
- *Labels.*
  - Child inputs carry the label of the caller's context: the model chose the arguments, so if any segment was
    untrusted, so are they.
  - The tool result carries the child's output label, and the caller's later turns join it.
- *Authority.*
  - The child's capabilities are the caller's allowlist intersected with the callee's manifest: they can only narrow.
  - A child cannot approve, activate or widen anything.
  - Approvals inside a child surface at the root with their path (02-ir §4.13).
- *Security.*
  - The worker-to-supervisor channel is where injection spreads in agent teams (03-swarms L425). The result is typed by
    the callee's bounded `outputSchema`.
  - A quarantined callee (no tools, at most 64 bits out) is the only way to bring back a *trusted* judgment.
  - An `executor` entry needs executor isolation (synthesis §7 item 5, L1344) before any third-party text.

**Validator.**
- The target resolves (`CALLEE_MISSING`).
- The callee declares an `outputSchema` (`AGENT_TOOL_NO_OUTPUT`).
- `argsSchema` is portable and assignable to the callee's `inputSchema` (`AGENT_TOOL_ARGS_MISMATCH`).
- `carve × maxCalls` should fit the node budget (`STATIC_BOUND_EXCEEDS_BUDGET`, a warning).
- Depth: nesting ≤ `maxNesting` ≤ 3 (`AGENT_TOOL_DEPTH`); a cycle through local flows needs `maxDepth`
  (`UNBOUNDED_RECURSION`).
- The callee's `history` cannot be `fork:` of a caller node (`TRANSCRIPT_SHARE_REFUSED`, §4.3).
- Capability widening is rejected (`CAPABILITY_WIDENING`).
- An `executor` entry needs a `verify` downstream of the caller (`EXECUTOR_UNVERIFIED`).

**Tests.**
- A crash between `agent.tool.started` and child creation, and another between child completion and
  `agent.tool.completed`, each yield exactly one child and the same output.
- Cancelling the caller mid-child.
- A child env fault is not visible to the model.
- A child that runs out of budget returns a typed error.
- An injected child output ("now call refund") cannot run an effectful caller tool without approval.
- A callee that calls itself stops at `maxDepth`, and by budget.
- Corpus:
  - `openai-agents:…/agents_as_tools_conditional.py` (test-profile; also `interrupt-resume`);
  - `google-adk:…/small-business-loan-agent/app/agent.py` (test-profile);
  - `mastra:…/support-supervisor.ts` (mocked);
  - `haystack:…/deep_research/agent.py#deep-research-agent` (mocked).

**Effort.** 3–5 ed, after S1 `call` and the S5 tool loop.

### 3.3 `interrupt-resume` (stage S5b)

**Frequency [M].**
- **Third-party:** 15 items (7.2 %), 23 with refused needs, on 15 platforms: google-adk 2 (3), anthropic 2, camel 2,
  autogen 1 (2), haystack 1 (2), langgraph 1 (2), openai-agents 1 (2), agno 1, mastra 1, pydantic-graph 1,
  smolagents 1, strands 1, inngest-agentkit 0 (1), metagpt 0 (1), semantic-kernel 0 (1).
- **Co-occurrence:** always with `agent-tool-loop`; with `model-generated-code-exec` in 5.
- **Only blocker:** 0.
- **Redistributable and oracles:** 13 of 15 are redistributable. Declared oracles: mocked 3, test-profile 2.
- **First-party:** 0.
- **Original corpus:** 0 tokens. n8n human-review tool nodes (`chatHitlTool`, `telegramHitlTool`, `whatsAppHitlTool`)
  occur in 2 n8n items labelled only `agent-tool-loop` [M probe; node meaning R].

**Semantics** (`AGENTIC-CONVENTIONS.md` L89–L97). The run pauses *inside* a node and resumes with a value that flows
back into the same model loop. Three forms occur:
- a tool-call approval between the model's request and the execution: the AutoGen intervention handler, pydantic-ai
  deferred tools, Strands interrupts, Mastra `requireApproval`, the Claude Agent SDK permission callback, and OpenAI
  `needs_approval` **[D item]**;
- a tool that asks the user: LangGraph `AskHuman`, a Haystack `input()`, a CAMEL confirm;
- a task-mode agent that keeps its node open across user turns: ADK `agent_in_workflow`, the ADK live workflow.

A pause at a node boundary with a typed answer is native `human`.

In Foundry, the loop suspends at a journaled turn boundary (A1). The model's request is journaled, the node becomes
`waiting_input` with a pending request, and an answer resumes the loop at that turn. An approval decides whether the
call runs; a denial becomes a typed tool result.

**IR.**
```jsonc
"tools": {
  "allow": [
    { "name": "refund", "kind": "capability", "capability": "payments.refund",
      "approval": { "when": "always", "show": ["amount", "orderId"], "timeoutMs": 86400000,
                    "onTimeout": "deny", "remember": "none" } },    // when: always | untrustedContext; remember: none | run | session
    { "name": "ask_user", "kind": "human",
      "argsSchema": { "type": "object", "required": ["question"],
                      "properties": { "question": { "type": "string", "maxLength": 500 } } },
      "answerSchema": { "type": "object", "required": ["choice"],
                        "properties": { "choice": { "enum": ["yes", "no", "other"] },
                                        "text": { "type": "string", "maxLength": 2000 } } },
      "timeoutMs": 3600000, "onTimeout": "fail", "maxCalls": 3 } ],
  "maxSteps": 8, "maxInterrupts": 4 }
```
A task-mode node held open across user turns is a `human` tool with a free-text answer and `maxInterrupts`. A live audio
session adds `stream` (02-ir D3).

**Runtime.**
- *Durability.*
  - `agent.tool.requested` is journaled, then `approval.requested {token, showHash, questionHash}`.
  - The node releases its concurrency slot (02-ir §4.8). The run's derived status is `awaiting_human`, with
    `blockedOn: [{runId, nodeKey, turn, question}]`.
  - The answer and `approval.granted|denied` or `human.answered` commit in one transaction that consumes the token.
  - `tick` resumes the run on the same path as `human`.
- *Replay.* Answers are journaled; replay never asks again.
- *Tokens.* Single-use, bound to `(runId, nodeKey, attempt, turn, callIndex, argsHash, questionHash)` (ROADMAP L247;
  02-ir §4.13). A stale or reused token is rejected.
- *Budgets.*
  - Waiting time counts against the run deadline, not against steps or cost.
  - `maxInterrupts` applies per node, and `timeoutMs` must be within the remaining deadline.
- *Cancellation.* Pending tokens are revoked, and a late answer is rejected.
- *Idempotency.*
  - The approved effect runs with key `digest(runId, nodeKey, attempt, turn, callIndex, argsHash)`.
  - The arguments cannot change between approval and execution, because the hash binds them.
- *Labels and authority.*
  - Approvals are the user-only channel. 02-ir D1 cites `runtime.mjs:151–163`: "a signal is **not** an approval".
  - Answers to `ask_user` are owner intent (`trusted`) when they come from the owner channel, and `untrusted:chat` when
    they come from an end user through a served chat.
  - `remember: "run"` reuses a grant for an identical `(capability, argsHash)` within the run.
  - `remember: "session"` stores the grant as session-scoped state (02-ir E1). The runtime writes it from the user's
    answer, never the model, and its TTL is at most the session's. This is how Strands' persistent trust lowers.
  - Grants that outlive a session are refused (§4.5; THESIS D11, L358).
- *Security.*
  - The question and the arguments shown are untrusted text, rendered as data by a viewer that never acts (ROADMAP
    §2.10).
  - `show` fields come from the real arguments, not from a model summary, so the model cannot make the approval screen
    misstate what will run.
- *Executors.*
  - Inside a vendor loop (Claude Agent SDK `can_use_tool`), an approval is a blocking callback with a timeout no longer
    than the executor's.
  - It is not durable across crashes: the executor restarts and its effects are `uncertain`. Durable interrupts exist
    only in Foundry's own loop.

**Validator.**
- Rule of Two: every effectful tool whose arguments can be untrusted-derived has `approval`, or reaches only data sinks
  (`UNGATED_EFFECTFUL_TOOL`; 02-ir E3).
- `human` tools have a portable `answerSchema` and a timeout within the deadline (`UNBOUNDED_WAIT`), and never appear on
  quarantined agents.
- `show` paths ⊆ `argsSchema` (`APPROVAL_SHOW_UNKNOWN`).
- `remember` ∈ {none, run, session}, and `session` needs a session-scoped state cell (`APPROVAL_PERSISTENCE_REFUSED`
  otherwise).
- `maxInterrupts` is declared.
- A node with interrupts may not sit in a `finally` that runs on cancel (02-ir B2).

**Tests.**
- Approve, deny and timeout.
- Resume after a process restart, and after an engine bump under P-resume.
- Stale and reused tokens.
- Tampering with the arguments after approval.
- Cancelling while a request is pending.
- Replay does not ask again.
- An approval inside an agent-as-tool child surfaces at the root with its path.
- A session grant expires.
- Corpus:
  - `pydantic-graph:pydantic-ai/docs/deferred-tools.md#tool_requires_approval` (mocked);
  - `mastra:…/resolve-support-case.ts` (mocked);
  - `google-adk:…/workflows/agent_in_workflow/agent.py` (mocked);
  - `openai-agents:…/agents_as_tools_conditional.py` (test-profile).

**Effort.** 4–6 ed, after S4 (`human` tokens and timeouts) and S5.

### 3.4 `guardrail-tripwire` (stage S5b; the on-stream form needs S6)

**Frequency [M].**
- **Third-party:** 6 items (2.9 %), 7 with refused needs, on 4 platforms: anthropic 2, openai-agents 2, google-adk 1 (2),
  strands 1.
- **Co-occurrence:** with `agent-tool-loop` in 4.
- **Only blocker:** 0.
- **Redistributable and oracles:** 5 of 6 are redistributable. Declared oracles: test-profile 2.
- **First-party:** 0.
- **Original corpus:** 0 tokens. An n8n `guardrails` node occurs in one item (`n8n:13984`), and a Flowise input
  moderation in one `native` item. Whether either sits inside a tool loop is unread.

**Semantics.** Rule GT (L124–L130): a validator attached to an agent's input, output or tool calls that cannot be a
sequential check node. Three forms:
- it runs concurrently with the agent and cancels it (OpenAI input guardrails);
- it runs inside the tool loop and denies or redirects (Claude Agent SDK `PreToolUse` hooks and permission callback,
  ADK before-tool hooks and judge plugin, Strands steering);
- it runs on a live stream.

It halts or redirects the run.

**Ruling proposed for the open contradiction (§6.1).** GT names the OpenAI input guardrail as its example. But that agent
has no tools, and the same rule says a check around a tool-free agent is native.

Proposed *observable-difference test*: tag the construct only when its placement changes what can be observed, meaning an
effect, a delivered partial output, or the tool call made. A concurrent guard around a tool-free, non-streaming agent is a
parallel check node whose verdict gates the agent's output through `when`. That is native, and the only loss is early
cancellation, which costs money but changes no output.

Under the ruling, `openai-agents:…/input_guardrails.py` becomes `chat-session+cross-run-state`. Third-party items go
from 6 to 5, and that item moves from S5b to S5. No total changes [M].

**IR** (a `guards` array on `agent` nodes):
```jsonc
"guards": [
  { "id": "topic", "at": "input", "mode": "parallel", "check": { "kind": "flow", "flow": "isHomework" },
    "onTrip": "fail", "code": "INPUT_REFUSED" },
  { "id": "no_rm", "at": "tool-call", "tools": ["shell"], "check": { "kind": "code", "lang": "js", "source": "…" },
    "onTrip": "deny" },
  { "id": "safe_path", "at": "tool-call", "tools": ["write_file"], "check": { "kind": "flow", "flow": "pathPolicy" },
    "onTrip": "rewrite", "rewrite": ["path"] },
  { "id": "tox", "at": "output-stream", "everyBytes": 400, "check": { "kind": "flow", "flow": "toxicity" },
    "onTrip": "cancel" } ],
"guardBudget": { "maxSteps": 20, "maxCost": 0.02 }, "onGuardError": "trip"
// at: input | output | tool-call | tool-result | output-stream ; mode: sequential | parallel
// onTrip: fail | deny | rewrite | cancel | route (02-ir B1)
```

**Runtime.**
- *Order inside a turn.* The model's request is journaled, then the guards run (`guard.evaluated {guardId, turn, verdict,
  inputHash}`), then the approval (§3.3), then the execution. A guard can only remove or narrow: deny, rewrite to an
  allowed value, or cancel. It never approves.
- *Parallel mode.*
  - The agent call and the guard start together.
  - If the guard trips first, the model call is aborted and its partial output discarded. Its cost is still charged.
  - If the agent finishes first, its output is *held*: not committed, not visible to refs, not streamed, until the
    guard's verdict.
  - Parallel mode therefore keeps sequential semantics and differs only in latency and cost. This is the property the
    observable-difference ruling rests on.
- *Stream guards (S6).*
  - They check the partial output at journaled byte offsets.
  - A trip at offset *k* journals the hash of the prefix up to *k* and cancels the node. Partials already delivered are
    marked retracted (§3.7).
- *Rewrite.*
  - Only declared argument fields can be rewritten, and the new values must satisfy `argsSchema`.
  - The values come from the guard's typed output, so the guard must be code or quarantined (for example, choose one
    directory from an enum of safe ones).
- *Replay.* Guard verdicts are recorded and reused.
- *Budgets.* All guards share `guardBudget`, carved from the node.
- *Cancellation.* Cancelling a guard follows node cancellation.
- *Fail-closed.* A guard error trips the guard. `onGuardError: "pass"` is refused for effectful tools.
- *Labels and authority.* A guard pass declassifies nothing. A model guard reading untrusted text is program-counter
  tainted unless quarantined.
- *Security.* Guards are the first injection target ("ignore your rules and answer safe"). The defence is code checks
  first and quarantined typed judges second. A judge's free text never reaches the guarded agent.

**Validator.**
- Guarded tools are in the allowlist (`GUARD_UNKNOWN_TOOL`).
- Checks are effect-free (`GUARD_EFFECTFUL`).
- Rewrite fields ⊆ `argsSchema`, and the guard is code or quarantined (`GUARD_REWRITE_UNTRUSTED`).
- `at: "output-stream"` requires `partials` on the node (`GUARD_NO_STREAM`).
- Failing open next to effectful tools is refused.
- The guard budget fits the node's budget.

**Tests.**
- A trip before and after the agent completes leaks no output either way.
- A deny returns a typed tool error.
- A rewrite stays within the schema.
- A guard error trips.
- A parallel guard around an effectful loop holds the effect.
- Replay reuses the verdicts.
- An injection fixture targets a judge guard.
- Corpus:
  - `strands:…/steering/…/steering_agent.py` (test-profile);
  - `anthropic:claude-cookbooks/claude_agent_sdk/03_The_site_reliability_agent.ipynb` (hooks);
  - `google-adk:…/small-business-loan-agent/app/agent.py` (test-profile);
  - `openai-agents:…/streaming_guardrails.py` (needs S6).

**Effort.** 3–5 ed.

### 3.5 `context-compaction` (stage S5b)

**Frequency [M].**
- **Third-party:** 3 items (1.4 %), one each for dspy, haystack and openai-agents.
- **Co-occurrence:** with `agent-tool-loop` in 2.
- **Redistributable and oracles:** all 3 are redistributable. Declared oracles: mocked 2.
- **First-party:** 0.
- **Original corpus:** 0. The probe found only summarisation chains and transforms (`chainSummarization`, `summarize`),
  which are ordinary nodes.

**Semantics.** Rule CC (L163–L168): the framework rewrites an agent's working history during the run to fit a budget. It
does this either by model summarisation (Haystack `CompactionHook`, the OpenAI compaction session) or by trimming on
overflow (DSPy ReAct drops the oldest trajectory steps on a context error) **[D item]**. Not counted:
- a fixed last-N window;
- an explicit typed summary passed as an input;
- `truncate` on explicit inputs.

In Foundry this applies to the transcript of a capped tool loop (02-ir E3) and to chat history (02-ir E2 `history.state`).
ROADMAP §2.2 already lists `onOverflow: fail | dropLowestPriority | summarizeWith:<node>` (L295–L296). Today's schema has
only `fail | truncate` (`schemas/workflow.schema.json:85`).

**IR.**
```jsonc
"context": { "budget": { "maxInputTokens": 8000, "onOverflow": "summarizeWith",
  "compaction": { "with": { "flow": "compactTurns" }, "keepLastTurns": 4, "keepFirst": true,
                  "pin": ["approvals", "task", "recitation"], "maxSummaryTokens": 800, "maxCompactions": 3 } } }
// trimming: "onOverflow": "dropOldestTurns", "compaction": { "keepLastTurns": 6, "keepFirst": true, "maxCompactions": 3 }
```

**Runtime.**
- *Trigger.* The token estimate of the compiled prompt (DESIGN §4, L151: `ceil(utf8 bytes / 4)`) exceeds
  `maxInputTokens`. That depends only on journaled data, so replay compacts at the same turn.
- *Journal.*
  - `context.compacted {turns: [a, b], method, summaryHash, summaryLabel, summarizerRunId}` is journaled.
  - Raw turns stay in the journal; only later prompts change.
  - The receipt records which turns were replaced.
- *Summariser.* A carved child with role `synthesis` and no tools. Its output is journaled and reused on replay.
- *Labels.* The summary's label is the join of the covered turns' labels, so a summary cannot launder untrusted text.
  `pin` keeps instructions, the task, the recitation block, approvals and the last K turns out of any summary (07 §2.7,
  L285–L291).
- *Budgets.* The summariser's carve and `maxCompactions`. Once they are exhausted the node fails `CONTEXT_OVERFLOW`
  (routable).
- *Opaque provider compaction.* The OpenAI compaction session returns an opaque encrypted item **[D item]**. It is refused
  in `agent` nodes, because the context would become unauditable (§4.5). It stays allowed inside an `executor`, whose
  transcript is evidence only.
- *Security.* A summariser reading untrusted turns can drop the one constraint that matters, or plant an instruction.
  Pins, the label join and the recitation block, which the context compiler always places (ROADMAP L311–L318), limit
  both.

**Validator.**
- The summariser flow is effect-free and tool-free.
- `maxSummaryTokens` < `maxInputTokens`.
- Pins name existing segments.
- Compaction is not allowed on quarantined agents.
- `maxCompactions` ≤ 8.
- Opaque provider compaction is rejected on agent nodes (`OPAQUE_CONTEXT_REFUSED`).

**Tests.**
- An overflow at turn *k* compacts at *k* again on replay.
- Pins survive.
- The summary's label is the join.
- Exhaustion gives `CONTEXT_OVERFLOW`.
- A summariser injection cannot remove a pinned approval.
- Corpus: `haystack:haystack/haystack/hooks/compaction/hooks.py#summarization-compaction` (mocked) and
  `dspy:…/customer_service_agent/index.ipynb#airline-react-agent` (mocked; the trimming form).

**Effort.** 2–4 ed.

### 3.6 `multimodal-io` (stage S5c)

**Frequency [M].**
- **Third-party:** 14 items (6.8 %), 18 with refused needs, on 10 platforms: google-adk 4 (5), smolagents 3,
  openai-agents 1 (2), autogen 0 (2), and 1 each for agno, burr, dspy, langgraph, mastra and pydantic-graph.
- **Only blocker:** 1 (DSPy image-prompt refinement).
- **Co-occurrence:** with `agent-tool-loop` in 10, `agent-as-tool` 5, `partial-output-stream` 4.
- **Redistributable and oracles:** all 14 are redistributable. Declared oracles: test-profile 3, mocked 3,
  output-equivalence 1.
- **First-party:** 0.
- **Original corpus:** 0 tokens, but 31 original items run a model over media:
  - n8n 25: OpenAI `image.analyze` and `audio.transcribe`, Gemini image, audio and video;
  - activepieces 2;
  - one each from zapier, dagster, home-assistant and ifttt.

  Their converters lowered these as `task` [M probe]. This is a convention divergence (§6.2).

**Semantics.** A model step takes or produces non-text media: images, screenshots, audio, video, or PDF and file parts
(L150–L152). A path or URL the model never sees as media does not count.

In Foundry, media are content-addressed artifacts referenced by typed handles. An `agent` context input with
`render: "media"` renders a handle into the model call, and an agent may return handles to media it produced. Bytes never
enter the run state.

**IR.**
```jsonc
// The media handle, written out in full wherever it is used (DESIGN §5.3 has no $ref):
{ "type": "object", "additionalProperties": false, "required": ["kind", "mime", "sha256", "bytes"],
  "properties": {
    "kind": { "enum": ["image", "audio", "video", "document"] },
    "mime": { "enum": ["image/png", "image/jpeg", "image/webp", "audio/wav", "audio/mpeg", "video/mp4", "application/pdf"] },
    "sha256": { "type": "string", "minLength": 64, "maxLength": 64 },
    "bytes": { "type": "integer", "minimum": 1, "maximum": 20971520 },
    "width": { "type": "integer", "minimum": 1, "maximum": 8192 },
    "height": { "type": "integer", "minimum": 1, "maximum": 8192 },
    "durationMs": { "type": "integer", "minimum": 0, "maximum": 3600000 } } }
// agent input
"context": { "inputs": [ { "name": "page", "ref": "nodes.observe.screenshot", "render": "media",
                           "label": "untrusted:web", "maxTokens": 1600 } ] }
// agent output: a returns field with the handle schema, plus a node-level declaration
"media": { "outputs": [ { "field": "image", "kinds": ["image"], "maxBytes": 4194304 } ] }
```

**Runtime.**
- *Store.* An artifact table `artifacts(sha256, bytes, mime, label, confidentiality)` with a per-run byte quota.
- *Context compiler.*
  - Media segments appear in the receipt with hash, kind, bytes and the provider's token estimate.
  - The prompt hash covers the media hashes, so replay is keyed by them.
- *Model policy.*
  - A class is eligible only if `policy/models.json` lists the feature for the assigned model (image, audio, video or
    pdf). Otherwise the validator fails with `MODEL_FEATURE_MISSING`.
  - Escalation stays within policy, and nothing falls back silently (AGENTS.md).
- *Labels.*
  - Media are untrusted by default, because of visual prompt injection.
  - Outputs of image models are `untrusted:model`.
  - Screenshots carry a confidentiality label from their source.
- *Budgets.* `maxTokens` per media item, artifact bytes per run, and decode limits.
- *Security.*
  - Decode in the sandbox.
  - Check dimensions before decoding, against decompression bombs.
  - Strip metadata such as EXIF location.
  - The viewer shows media only after sanitising, under its CSP (synthesis §7 item 11).
- *Unknown [unk].* Whether the current `claude -p` route accepts image inputs together with structured output. If it does
  not, S5c needs a second, API model route, which may need a credential. That collides with THESIS D10's default of no
  new credentials (§7, decision 7).

**Validator.**
- `render: "media"` only on agents whose model class has the feature.
- Kinds and MIME types are allowlisted.
- `maxTokens` is declared per media input.
- Total media bytes stay within the quota.
- Quarantined agents may take media, for example a vision judge, but still return at most 64 bits.

**Tests.**
- The receipt is byte-stable with media.
- `MODEL_FEATURE_MISSING` fires.
- A decompression bomb is rejected.
- An image carrying injected instruction text cannot cause an effect (label policy).
- Replay works.
- Corpus:
  - `google-adk:adk-samples/contrib/python/on-brand-genmedia/app/agent.py` (test-profile);
  - `mastra:…/durable-kyc-onboarding.ts` (mocked; PDF or image extraction);
  - `dspy:…/image_generation_prompting/index.ipynb` (sole blocker).

**Effort.** 4–7 ed. The synthesis estimates 0.5–1 week for image inputs on agent nodes (L1218); outputs and audio add to
that. The model-route risk is extra.

### 3.7 `partial-output-stream` (stage S6)

**Frequency [M].**
- **Third-party:** 11 items (5.3 %), 13 with refused needs, on 8 platforms: openai-agents 2 (3), inngest-agentkit 2,
  llamaindex-workflows 2, strands 2, burr 1, google-adk 1, pydantic-graph 1, autogen 0 (1).
- **Co-occurrence:** with `agent-tool-loop` in 7 and `multimodal-io` in 4.
- **Redistributable and oracles:** all 11 are redistributable. Declared oracles: test-profile 1, mocked 1.
- **First-party:** 0.
- **Original corpus:** 0 tokens. Chat front ends such as Langflow `ChatOutput` and Flowise may stream, but the normalized
  graphs do not say whether they do [unk].

**Semantics.** Rule PS (L132–L138): partial model output, token deltas or step events, leaves a running node before it
completes. Two cases count:
- it is delivered to an outside consumer as part of the item's interface: an SSE or WebSocket route, a UI renderer, a
  stream returned to the caller, WebRTC audio;
- it is consumed in-run: a streaming guardrail, or turn detection in a realtime session.

Printing to the console does not count (rule G2).

This collides with two rules: R4, under which nodes emit at completion, and 02-ir §4.14, under which model token streams
are UI-only and never drive control flow. Foundry resolves the collision with two channels:
1. **The caller channel.** Partial deltas of a declared node are forwarded to the run's caller through the host (the
   TriggerPort response mode `stream`, an extension of 02-ir C1's `ack | output`). They are provisional, not journaled at
   token granularity, and never readable by refs or control flow. The final output is journaled as usual.
2. **In-run.** Only `guards` with `at: "output-stream"` (§3.4) see partials, and a guard can only cancel.

**IR.**
```jsonc
{ "id": "answer", "kind": "agent", "…": "…",
  "partials": { "to": "caller", "events": ["text", "tool-status"], "maxBytesPerSecond": 65536, "retractable": true } }
// trigger response mode (02-ir C1 webhook/chat triggers): "response": "stream"   // ack | output | stream
```

**Runtime.**
- *Durability and replay.*
  - Partials are not journaled. `partials.delivered {bytes, chunks, lastOffset}` is journaled when the node completes.
  - Replay emits nothing; if a host asks, it emits the recorded final output as one chunk.
- *Ordering and disconnects.* Chunks keep model order. A caller that disconnects does not affect the run.
- *Retraction.* If a guard cancels the node, or it fails, after partials were sent, a `retracted` marker follows.
  Consumers must treat partials as provisional, like `provisional: true` stream items (02-ir D3).
- *Labels and confidentiality.*
  - Partials carry the join of the node's input labels as known at start.
  - A node whose context holds `secret:*` cannot stream to a caller who is not cleared for it.
- *Authority.* Partials are never inputs to effects or approvals. A node whose output feeds an approval-gated effect may
  stream only to the owner's viewer.
- *Budgets.* A rate cap. Partial bytes are not counted in the state budget.
- *Security.*
  - A quarantined node cannot stream: raw partials would leak more than 64 bits before declassification.
  - Streaming would bypass an `output` guard, so an output guard on a streaming node needs an `output-stream` guard too.

**Validator.**
- `partials` only on `agent` and `executor` nodes (`PARTIALS_KIND`).
- Not on quarantined nodes (`PARTIALS_ON_QUARANTINED`).
- No ref may read partials (`PARTIALS_NOT_DATA`).
- An `output` guard without an `output-stream` guard on a streaming node fails `GUARD_BYPASSED_BY_STREAM`.
- `response: "stream"` requires at least one node with partials.

**Tests.**
- The concatenated partials equal the final output.
- Replay emits no partials.
- A cancel mid-stream sends the retraction marker.
- A disconnect does not affect the run.
- A quarantined node with partials is rejected.
- Corpus:
  - `llamaindex-workflows:…/workflow/react_agent.ipynb`;
  - `inngest-agentkit:…/use-agent/inngest/sql-agents/network.ts`;
  - `openai-agents:…/streaming_guardrails.py`;
  - `google-adk:…/live/workflow/agent.py` (test-profile; its live audio also needs `stream`).

**Effort.** 3–5 ed.

### 3.8 `dynamic-agent-spawn` (stage S7)

**Frequency [M].**
- **Third-party:** 6 items (2.9 %), 7 with refused needs, on 6 platforms: camel 2, anthropic 1, dspy 1, openai-agents 1,
  strands 1, ag2 0 (1).
- **Co-occurrence:** with `agent-tool-loop` in 6, `agent-as-tool` 3, `model-generated-code-exec` 3, `dynamic-dag` 2.
- **Redistributable and oracles:** all 6 are redistributable. Declared oracles: mocked 2.
- **First-party:** 0. The first-party scripts map over agents defined in code, which is native under rule DS.
- **Original corpus:** 0.

**Semantics.** Rule DS (L154–L161): during the run, a model creates agents that are not fixed nodes. It either *defines*
them, writing their instructions, persona or tool set (CaptainAgent, CAMEL `create_worker`, the Strands workflow tool,
DSPy RLM sub-modules, OpenAI hosted subagents), or it creates *persistent instances* in a number it chooses and addresses
later by handle (the Anthropic managed-agents coordinator) **[D item]**. Calling one fixed definition N times is
`agent-as-tool`, and a `map` over a model-written list is native.

In Foundry, the construct is `expand` (02-ir F3) in its **template form only**. The model fills typed slots of a fixed
agent template. It never writes an IR fragment, a capability name, a model id or an output schema. Persistent instances
are detached child runs addressed by handles (02-ir G4).

**IR.**
```jsonc
{ "id": "team", "kind": "expand", "needs": ["plan"], "description": "Instantiate the planned workers",
  "spawn": { "specs": { "$ref": "nodes.plan.workers" }, "template": "worker", "maxAgents": 8, "persistent": false },
  "allow": { "capabilities": ["web.search"], "models": { "maxClass": "M" }, "returns": ["finding", "verdict"], "maxDepth": 1 },
  "budget": { "maxSteps": 200, "maxCost": 0.50, "maxDurationMs": 900000 },
  "outputSchema": { "…": "…" } }
// nodes.plan.workers is an array (maxItems 8) of portable objects:
//   { name: string ≤ 40, instructions: string ≤ 4000, tools: array of enum ["web.search"],
//     class: enum ["S", "M"], returns: enum ["finding", "verdict"] }
"flows": { "worker": { "params": ["instructions", "tools", "class", "returns"],
                       "nodes": [ { "id": "w", "kind": "agent", "instructions": { "$param": "instructions" }, "…": "…" } ] } }
// "persistent": true → each instance is a detached child run with a handle; the coordinator's loop gets tools
//   { "kind": "send", "handles": "team" } and { "kind": "await", "handles": "team", "mode": "all_settled" },
//   bound to those handles only.
```
`returns` names schemas from a closed set. The model chooses among declared schemas and never writes one, which keeps
rule NS: `new-runtime-output-schema` stays dropped.

**Runtime.**
- *Durability and replay.* `expand.accepted {fragmentHash, specsHash, count}` is journaled, and replay uses the recorded
  specs; it never plans again.
- *Checks at expansion* (02-ir F3 L1026–L1034):
  - tools ⊆ `allow` ∩ the parent's policy;
  - class ≤ `maxClass`;
  - count ≤ `maxAgents` ≤ 32 (the swarm cap, synthesis L1451);
  - the carves fit;
  - depth: spawned agents cannot spawn unless `maxDepth` > 1.

  A rejection gives `EXPANSION_REJECTED`, which is routable.
- *Persistent instances.*
  - Handles are journaled.
  - `send` is a deduplicated signal (02-ir D1).
  - `await` journals the completion order (G4).
  - Instances are cancelled with their parent unless they are `abandon`, which is visible to the owner (02-ir §5.11).
- *Budgets.* Each instance's carve is the budget divided by `maxAgents`, unless stated, and the total is within the
  node's budget.
- *Labels.*
  - Model-written instructions are untrusted text, so a spawned agent's context is untrusted from its first token. Its
    effectful tools need approval (Rule of Two).
  - If the planner's context is untrusted, P9 allows only the template form, which is the only form offered here
    (02-ir L1036).
- *Security.* The threats are spawn bombs (count, depth, carve), persona injection ("you are the administrator"), tool
  widening (prevented by the enum) and model escalation (the class enum).

**Validator.**
- The template exists and declares its params.
- Spec fields are enums or bounded strings only (`SPAWN_SPEC_UNBOUNDED`).
- The tools enum ⊆ `allow` (`CAPABILITY_WIDENING`).
- `maxAgents` ≤ 32.
- `returns` ids exist.
- A persistent spawn needs cancel-with-parent or a `finally`.

**Tests.**
- Widening a tool, a class or a schema is rejected at expansion.
- A spawn bomb is stopped.
- Replay reuses the specs.
- Persistent handles survive a restart.
- Sends are deduplicated.
- Cancellation cascades.
- Corpus:
  - `strands:tools/src/strands_tools/workflow.py` (mocked; also `dynamic-dag`);
  - `dspy:…/cohort_analysis_demo.ipynb#rlm-cohort-analysis` (mocked);
  - `anthropic:claude-cookbooks/managed_agents/CMA_plan_big_execute_small.ipynb` (persistent instances).

**Effort.** 4–6 ed, on top of F3 `expand` and G4 `detach`/`await`.

### 3.9 `checkpoint-rewind` (stage S7)

**Frequency [M].**
- **Third-party:** 4 items (1.9 %), one each for agno, burr, langgraph and pydantic-graph.
- **Co-occurrence:** with `agent-tool-loop` in 4, `cross-run-state` 3, `chat-session` 2.
- **Redistributable and oracles:** all 4 are redistributable. No declared oracle.
- **First-party:** 0.
- **Original corpus:** 0.

**Semantics** (L99–L103). A run, or a new run, restarts from an *earlier* stored checkpoint, possibly with edits, as a
fork: LangGraph time travel, agno `continue_from`, pydantic-ai `fork_run`, Burr loading an earlier sequence number
**[D item]**. Resuming at the latest durable point, or replaying an identical prefix, is native.

In Foundry, this is a `fork` verb (DBOS; synthesis L956). A fork is a new run whose journal prefix, up to a checkpoint, is
the source run's prefix, hash-linked to it, with an optional typed patch. It then executes forward. Checkpoints are node
completions and tool-loop turn boundaries (A1). Only the host, the owner, or a parent holding a handle may fork; a model
never can.

**IR and API.**
```jsonc
// host / CLI:  foundry fork RUN --at <nodeId | nodeId#turn<k>> [--patch patch.json]   → new run with forkOf
// in a workflow, by a parent that holds a handle:
{ "id": "retry_from_plan", "kind": "call",
  "target": { "fork": { "run": { "$ref": "nodes.first.handle" }, "at": "plan",
                        "patch": { "nodes.plan.steps": { "$ref": "nodes.edit.steps" } } } },
  "budget": { "maxSteps": 100, "maxCost": 0.30, "maxDurationMs": 600000 }, "forkEffects": "approve" }
// forkEffects: approve | deny | allow (allow is owner-only)
```
A patch replaces outputs of nodes completed at or before the checkpoint, and must match their schemas. It cannot change
the workflow hash: a different workflow is a new version, an L3 proposal.

**Runtime.**
- *Journal.*
  - The new run records `forkOf {runId, atSeq, headHash, patchHash}`.
  - The prefix is referenced, not re-executed.
  - The new chain starts with a link event to the source head, a Merkle link (02-ir §4.12).
- *Replay.* Deterministic, given the source journal and the patch.
- *Effects.*
  - Effects in the prefix are history and are not redone.
  - Effects after the fork point get new keys, because the run id is new, so they may repeat an external effect that the
    source run made after the same point.
  - The default `forkEffects: "approve"` requires an approval for every effectful node after the fork point. `"deny"`
    blocks them.
- *Engine.* A fork across engine versions follows P-resume (02-ir §6).
- *Budgets.* A fork is a new run with its own budget, carved when it is a child.
- *Labels.* The patch carries its source's label, which joins downstream.
- *Authority.* Only handles can be forked (02-ir §5 rule 3: no addressing runs without a handle).

**Validator.**
- The fork target is a handle (`FORK_TARGET_NOT_HANDLE`).
- The checkpoint is a durable boundary of the source workflow (`FORK_POINT_UNKNOWN`).
- Patch paths name completed outputs before the point and are schema-valid (`FORK_PATCH_INVALID`).
- `forkEffects` is declared when effectful nodes follow the fork point.

**Tests.**
- A fork at node *k* reproduces the prefix hashes and diverges after the patch.
- Prefix effects are not repeated.
- Effects after the fork need approval.
- Fork across an engine version.
- Fork of a fork.
- Corpus:
  - `langgraph:…/get-started/6-time-travel.md`;
  - `pydantic-graph:…/harness/step-persistence.md#continue_and_fork`;
  - `agno:…/25_time_travel/01_continue_from.py`.

**Effort.** 3–5 ed, after P-store (per-node journal rows) and P-resume (02-ir §6).

### 3.10 `shared-scratchpad` (stage S8)

**Frequency [M].**
- **Third-party:** 5 items (2.4 %), 8 with refused needs, on 7 platforms: google-adk 2, agno 1, llamaindex-workflows 1,
  strands 1, ag2 0 (1), langgraph 0 (1), metagpt 0 (1).
- **Only blocker:** 1, the Strands four-peer swarm.
- **Co-occurrence:** with `agent-as-tool` in 4 and `agent-tool-loop` in 4.
- **Redistributable and oracles:** all 5 are redistributable. Declared oracles: mocked 2, test-profile 1.
- **First-party:** 1. `phase0-unblock` runs three concurrent workers in one working tree with per-agent ownership lists.
- **Original corpus:** 0 tokens. Flowise `seqState`, the shared state of sequential agents, appears in 5 items, unread.

**Semantics.** Rule SS (L113–L122): two or more agents, or the tools of different agents, read and write a common
mutable store during one run, *and the order of those reads and writes is decided at run time*, by a model's choice or by
concurrency. The following are native:
- fixed-order hand-over;
- loop state with one writer per step;
- writes ordered by a plan;
- strict alternation;
- disjoint writes that nobody reads during the run.

A shared *conversation* is not a scratchpad: it is the group-chat refusal (§4.2).

In Foundry, the construct is run-scoped board topics (ROADMAP §2.2 L324–L341; 07 §2.2–§2.7), plus one-level *write*
grants to agent-as-tool children. Writes come only from typed outputs (`emits`) and commit when a node completes. Inside a
tool loop that is the child's completion, which is a turn boundary. So the model-chosen order is the journaled order, and
replay is exact.

**IR** (07 §2.2, plus grants):
```jsonc
"board": { "maxBytes": 1048576, "topics": {
  "deck":  { "schema": { "…": "…" }, "reducer": "lww(slide)", "writers": ["synth", "visual"],
             "readers": ["orch", "visual"], "maxEvents": 200, "controlFields": [] },
  "files": { "schema": { "…": "…" }, "reducer": "claim(path)", "writers": ["worker"], "leaseEvents": 200 } } }
// a tool entry may grant its callee one-level access:
{ "name": "visual", "kind": "call", "target": { "flow": "visualGen" }, "grants": [ { "topic": "deck", "mode": "readwrite" } ] }
```

**Runtime.** As 07 §2.2–§2.7 (L117–L294):
- reads use a snapshot at one board sequence number (`atSeq`), recorded in the receipt;
- writes are atomic at completion;
- a compare-and-swap conflict retries once, then fails;
- claims hold a lease;
- the label of a written event is the writer's output label;
- an effectful reader of an untrusted topic must be quarantined;
- each writer has a cap, against flooding;
- replay pins `atSeq`.

Grants go one level only, are never transitive and can only narrow. 07 §2.9 (L327) allowed *read* grants; this adds
write grants under the same rules. In-flight writes never commit on cancel. Writes are keyed by
`(runId, nodeKey, attempt)`.

**Validator.**
- 07 §2.3 rules 1–6 (L192–L213).
- Grants ⊆ the caller's topics and modes (`GRANT_WIDENING`).
- A write grant needs `lww` with `expectSeq`, or a commutative reducer.
- No write grant to an `executor` unless its outputs are typed (`GRANT_TO_OPAQUE`).

**Tests.**
- 07's stage-2 list (L778), plus grant tests.
- The first-party pattern: concurrent workers with `claim(path)` never write the same path.
- Corpus:
  - `strands:…/11-swarm/swarm.ipynb#four-peer-swarm` (mocked);
  - `google-adk:…/brand-aligned-presentations/app/agent.py` (mocked);
  - `google-adk:…/small-business-loan-agent/app/agent.py` (test-profile);
  - `llamaindex-workflows:…/agent/agents_as_tools.ipynb`.

**Gate (decision 2, §7).** Two rules pull against each other:
- ROADMAP §2.2 builds the board only after a pre-registered experiment shows at least 15 % per dollar over plain edges
  (L339–L341);
- THESIS D12 says to keep building toward ~100 % representation even if a construct does not help a cheap builder
  (L359).

Proposed reading: S8 builds the board semantics needed for *representation*, at lower priority than the wild ladder,
and the experiment gates only its use in Foundry's own builder kit.

If the owner keeps the hard gate and the experiment fails, these 5 items (8 with needs) and the first-party item are
refused by name ("shared scratchpad without a board"). Decided coverage stays 100 %, with 5 fewer expressible items.

**Effort.** 10–15 ed: board v1, 8–12 ed (07 stage 2), plus write grants, 2–3 ed. `state-reducer` is included.

### 3.11 `state-reducer` (stage S8)

**Frequency [M].** 0 third-party, 0 first-party, 0 original, by verdict. The convention counts only merges whose result
or mid-run readers depend on interleaving (rule SR, L82–L87). The one candidate, Haystack's `_collect_note`, was removed
because it is read only after its batch.

The original-corpus probe finds Dify `variable-aggregator` in 12 items and Coze `VariableAggregator` in 2. Those merge
*exclusive* branches, which is native through `join: all_resolved` [M probe; I].

**Semantics.** Parallel branches or concurrent agents write the same key, a declared reducer merges the writes, and either
the merge order or a reader during the run depends on run-time interleaving.

In Foundry, the reducers of board topics (`append`, `setUnion`, `counter`, `max`, `lww` with `expectSeq`, `claim`) and of
state cells (02-ir E1) cover it:
- commutative reducers make the result order-independent;
- `lww` makes conflicts explicit;
- mid-run readers read at a recorded `atSeq`, so the interleaving they saw is journaled.

**IR.** No new syntax: `reducer` on board topics (§3.10) and on `state` cells (02-ir E1, L794–L801).

**Runtime, validator.** As §3.10 and 02-ir E1. One extra static rule: concurrent `lww` writers without `expectSeq` are
rejected.

**Tests.** A property test: for commutative reducers, every permutation of the same writes gives the same view. A replay
test pins a mid-run reader's `atSeq`.

**Effort.** None beyond board v1. The construct stays in the registry because its mechanism is planned anyway, and a
re-reading of the original corpus may need it (§6.2).

### 3.12 `env-session` (stage S9)

**Frequency [M].**
- **Third-party:** 3 items (1.4 %), 6 with refused needs, on 6 platforms: dspy 1, langgraph 1, smolagents 1,
  autogen 0 (1), google-adk 0 (1), metagpt 0 (1).
- **Only blocker:** 1, DSPy AlfWorld.
- **Co-occurrence:** with `multimodal-io` in 2 and `agent-tool-loop` in 2.
- **Redistributable and oracles:** all 3 are redistributable. No declared oracle.
- **First-party:** 0.
- **Original corpus:** 0 tokens. One n8n item drives a remote Airtop browser session across nodes (create, window,
  terminate; `n8n:18618`). Its session id can be serialised, so it is borderline and not counted [M probe; I].

**Semantics.** Rule ES (L170–L176): a long-lived external environment session is opened at or before the start, mutated
by many observe and act steps, and cannot be serialised into the run record. Examples are a browser page or driver, a
simulator worker and a desktop: the LangGraph WebVoyager Playwright `Page`, the DSPy AlfWorld worker, the smolagents
Helium driver, and the ADK and MetaGPT browsers among the needs **[D item]**. A stateful code sandbox is rule MC, not
this.

In Foundry, the construct is ROADMAP §2.1's `env` contract (L225–L232: `reset(seed)`, `step(action)`, `observe`,
`snapshot`, `restore`, determinism class D0–D2) plus a session lease.

**IR.**
```jsonc
"envs": { "browser": { "capability": "env.playwright", "determinism": "D2", "snapshot": "per-step",
                       "maxSteps": 200, "maxLeaseMs": 1800000, "egress": "none", "seed": { "$ref": "input.seed" } } },
{ "id": "act", "kind": "task", "tool": "env.step", "env": "browser",
  "args": { "action": { "$ref": "nodes.decide.action" } }, "timeoutMs": 30000 }
// in a tool loop: { "name": "click", "kind": "env", "env": "browser", "op": "step", "argsSchema": { "…": "…" } }
```

**Runtime.**
- *Lease.* `env.acquired {envId, leaseId, seed, capabilityVersion}` is journaled at first use. Release happens in an
  implicit `finally` (02-ir B2) on success, failure or cancel.
- *Steps.* Each step journals `env.step {action, observationHash, snapshotHandle?}`.
- *Resume and replay by class:*
  - **D0:** `reset(seed)`, re-apply the journaled actions, compare observation hashes; a mismatch gives `ENV_DIVERGED`.
  - **D1:** the same, within a declared tolerance.
  - **D2:** `restore(snapshot)` when a snapshot is declared. Otherwise the node ends `ENV_NOT_RESUMABLE`
    (`inconclusive`). It never continues against unknown state.
- *Idempotency.* Steps are not idempotent. A crash mid-step makes the step `uncertain`, and there is no automatic retry
  unless the capability declares idempotent steps.
- *Budgets.* `maxSteps`, lease time and per-step timeouts. Leases count against an environment pool.
- *Labels and authority.*
  - Observations are untrusted.
  - Actions chosen from them carry program-counter taint.
  - An environment with real egress is an effect, so it needs approval, or a mocked environment in evaluation
    (AGENTS.md: no real-world operations).
- *Security.* Sessions start clean, with no cookies or credentials, and a model never provisions them. Downloads go to the
  artifact store with untrusted labels.

**Validator.**
- The environment is declared and its capability implements the contract (`ENV_CONTRACT_MISSING`).
- The determinism class is declared.
- A D2 environment without snapshots gets a warning that resume will fail.
- An egress other than `none`, with actions derived from untrusted data, needs approval (`ENV_EGRESS_UNGATED`).
- `maxSteps` is within policy.

**Tests.**
- A D0 rebuild after a crash.
- A D2 crash gives `ENV_NOT_RESUMABLE`.
- The lease is released on cancel.
- An action derived from an observation is refused at an egress without approval.
- Corpus:
  - `dspy:…/games/index.ipynb#alfworld-action-loop` (a D1 simulator);
  - `langgraph:…/web-navigation/web_voyager.ipynb` (D2);
  - `smolagents:…/examples/web_browser.md#helium-screenshot-agent` (D2).
- End to end on `gridquest` (synthesis L396).

**Effort.** 5–8 ed, together with ROADMAP's `explore` and game-loop work (Phase 6).

---

## 4. Native patterns and refusals

### 4.1 Native patterns (retired as tokens)

Measured in `COVERAGE.md` §10.8 [M]:

| Pattern | Third-party items | Platforms | Of them refused for another reason | Lowering | The check that matters |
|---|---|---|---|---|---|
| `llm-router` | 35 | 16 | 20 | `agent` with `role:"route"` and an enum output (plus "answer directly" or "unknown"), then `when` guards (schema L138, L113; synthesis L302) | program-counter taint: a router over untrusted context that gates effectful branches must be quarantined (an enum of at most 64 bits) or the effects approval-gated (`UNTRUSTED_CONTROL`) |
| `supervisor-delegation` | 31 | 18 | 10 | a capped `loop` of a route agent over `when`-guarded typed workers, with results as loop-carried input; or `agent-tool-loop`+`agent-as-tool` | the loop cap is named (rule BL); workers get typed tasks, never the supervisor's transcript |
| `code-selected-chat` | 5 | 5 | 0 | a capped loop over `when`-guarded agents with the transcript as an explicit loop-carried input | lint `TRANSCRIPT_AS_INPUT` (a warning: ROADMAP rule 2 discourages it; typed outputs are preferred) |
| `task-pipeline transfer` | 3 | 1 | 0 | routing into a pipeline that runs on declared inputs | the default ADK context is replaced by explicit inputs |
| `typed-handoff` | 1 | 1 | 0 | routing with a typed payload | the payload schema is portable and bounded |

### 4.2 Refused by design: `group-chat`

**Frequency [M].** 13 third-party items (6.3 %): semantic-kernel 4, ag2 3, autogen 3, inngest-agentkit 1, langgraph 1,
metagpt 1. All 13 are redistributable. If the refusal were lifted, they would need `agent-tool-loop` 9,
`model-generated-code-exec` 6, `interrupt-resume` 3, and `multimodal-io`, `env-session` and `shared-scratchpad` 2 each;
3 items need nothing more. First-party: 0. Original corpus: 0 by verdict, but 6 Flowise supervisor/worker teams match the
rule in source (§6.2).

**Semantics.** Rule GC (L247–L256): two or more agents read and extend one shared or broadcast transcript, and **a model
selects the next speaker**. The selector can be a manager model, "auto" selection, a coordinator's routing choice, or a
supervisor routing over shared message state.

**Why refused:**
1. *Principle.* "Share decisions and artifacts, not transcripts" (ROADMAP §2.2 rule 2, L281), adopted with THESIS D8
   (L355) and written into ROADMAP §2.1 (L139–L140) and §3 (L781–L784).
2. *Failure data.* MAST misalignment, CAMEL role flipping and infinite message loops, and error amplification of 17.2×
   for independent agents against 4.4× for centralised ones (03-swarms L415–L416; synthesis L774).
3. *Security.* One participant's untrusted input reaches every other participant's context, including those with
   effectful tools: a confused deputy, and injection spreading across workers (03-swarms L425). No single-writer
   artifact exists to check.
4. *Verifiability.* The transcript is the state, so `verify` has no typed artifact to judge.
5. *Cost.* Every turn's prompt grows with every agent's output.

**Representable, but refused.** A turn-capped loop of a route agent over `when`-guarded agents whose contexts read the
accumulated transcript. The IR can say this; the validator rejects it by name.

**Instead:**
- `panel`, which votes rather than debates (ROADMAP L211);
- a supervisor with agents as tools and a fresh task per call (§3.2);
- a code-selected chat (native, discouraged);
- typed facts on a board (§3.10).

**Validator.** `REFUSED_BY_DESIGN` with reason `group-chat` fires when a `loop` or `machine` meets both conditions:
1. a model (`role: "route"`, or a tool choice) selects among two or more agents;
2. those agents' contexts read an accumulator written by two or more of them: a loop-carried list, or a board topic of
   raw messages.

`history: "fork:<n>"` on such an agent fires it too. The check is a dataflow pass over refs, using the existing
`possibleMissing` and label machinery.

**Tests.**
- The turn-capped lowering of `autogen:…/SelectorGroupChat` is rejected with the named code.
- The code-selected variant (the AG2 custom speaker function) passes with a warning.
- A supervisor with agent tools passes.

### 4.3 Refused by design: `full-history-handoff`

**Frequency [M].** 20 third-party items (9.7 %): openai-agents 4, autogen 3, google-adk 3, langgraph 3, openai-swarm 3,
ag2 1, haystack 1, llamaindex-workflows 1, semantic-kernel 1. 19 are redistributable. If lifted, they would need
`agent-tool-loop` 19, `chat-session` 12, `cross-run-state` 12, `interrupt-resume` 5, and `partial-output-stream` and
`multimodal-io` 2 each; 0 items need nothing more. First-party: 0.

**Semantics.** Rule HO (L257–L266): **a model initiates the transfer**, through a handoff tool, a returned `Agent`, a
model-chosen `Command(goto)` or `transfer_to_agent`. The receiver is a conversational agent that continues the same
conversation with the prior turns as its working history.

**Why refused:**
1. *Principle.* The same as §4.2, plus rule 5, "fork the full context only for escalation and repair" (L284).
2. *Leaks.* Agents SDK input filters do not redact tool arguments copied into messages (03-swarms L598–L599).
3. *Silent outcomes.* The last handoff wins silently (03-swarms L417).
4. *Confused deputy.* The receiver often has stronger tools than the sender (a refund agent after triage) and inherits
   every untrusted earlier turn.
5. *Replay cost.* The receiver's prompt depends on the whole history, so its replay key and cost grow with the
   conversation.

**Instead:**
- a typed handoff: a route plus a typed summary as an explicit input;
- a task-pipeline transfer;
- a chat session in which *one* agent owns the conversation and delegates through agents as tools;
- `history: "fork:<node>"` only on escalation and repair nodes.

**Validator.** `REFUSED_BY_DESIGN` with reason `full-history-handoff` fires for:
- an agent selected by a model route whose context includes another agent's turns, through `history: fork:`, or through
  a ref to a transcript accumulator;
- `fork:` on a node outside the escalation and repair set.

**Tests.**
- `openai-swarm:…/airline` and `openai-agents:…/routing.py` lowered with a turn cap are rejected by name.
- A typed-handoff lowering of the same item compiles.

### 4.4 Refused as out of scope: `interactive-dashboard-state`

Two original items, both Node-RED and both non-redistributable: `node-red:3d1efc5c…` and `node-red:a04546c4…`
(`COVERAGE.md` §4). Their program is the state of interactive dashboard widgets. That is product surface:
- THESIS §4: Foundry "ships none of their product surface";
- ROADMAP §3 builds no visual builder, and the run viewer never acts (L770, L777–L778).

Their other needs (`event-trigger`, `stream`, `cross-run-state`) are expressible. Rejecting the items by name, rather
than dropping the dashboard, follows AGENTS.md: "Adapters must reject unsupported semantics rather than silently
flattening them."

### 4.5 Refused forms inside supported constructs

| Form | Construct | Validator code | Why |
|---|---|---|---|
| Model-written code with network access, or run on the host | §3.1 | `GENERATED_CODE_EGRESS`, `SANDBOX_UNAVAILABLE` never falls back | synthesis §7 item 6 (L1347) |
| A sandbox session that cannot be rebuilt from its journal | §3.1 | `SUSPEND_NOT_REPLAYABLE`, `SESSION_REPLAY_DIVERGED` | R2/R4; no continuing against unknown state |
| Opaque, provider-encrypted compaction in an `agent` node | §3.5 | `OPAQUE_CONTEXT_REFUSED` | unauditable context; ROADMAP rule 6 "Nothing implicit" (L285) |
| Approvals remembered beyond a session, or written by a model | §3.3 | `APPROVAL_PERSISTENCE_REFUSED` | authority outside the model; THESIS D11 (no mutable cross-run store) |
| Model-written IR fragments, capabilities, model ids or output schemas for spawned agents | §3.8 | `SPAWN_SPEC_UNBOUNDED`, `CAPABILITY_WIDENING` | P9 (02-ir L1036); rule NS |
| Unbounded spawning (count, depth or carve) | §3.8 | `EXPANSION_REJECTED` | synthesis Appendix C L1466 "free-form spawning" |
| Partial outputs read as data or as control | §3.7 | `PARTIALS_NOT_DATA` | 02-ir §4.14 (L1232) |
| Forking or addressing a run by id rather than by handle | §3.9 | `FORK_TARGET_NOT_HANDLE` | 02-ir §5 rule 3 |
| Guards that fail open next to effects | §3.4 | (static) | fail-closed rule |

### 4.6 How a refusal could be lifted

ROADMAP keeps both refusals "representable with a turn cap if the owner asks" (L140, L783–L784). The lift path, which is
**not built until asked**:
- A host-approved `designWaivers: [{ "refusal": "group-chat", "maxTurns": 20 }]`, bound to the workflow hash like a
  trigger activation (02-ir C1, "Authority").
- A `history: "shared:<topic>"` or a route-selected `fork:` construct.
- Mandatory quarantine or approval for every effectful participant.

The 33 refused items would then become via-extension with their `Needs:` lists plus that construct. The 3 group-chat
items that need nothing else would need only the waiver construct.

---

## 5. Staged plan to 100 % declared coverage

### 5.1 The stages

The numbers are copied from the regenerated `COVERAGE.md` §10.6 [M]. That generator section takes the stage bundles
below as a constant (`STAGES` in `coverage-report.mjs`) and fails if a registry construct is missing or placed twice.

The combined corpus has 1,549 items: original 1,342 plus agentic third-party 207. First-party items are not pooled.

| Stage | Adds (constructs) | Newly expressible: original / agentic | Combined expressible | Combined decided | First-party (not pooled) | Effort [I] |
|---|---|---|---|---|---|---|
| S0 | measurement pipeline and construct ledger (02-ir §8), G1 output contract, G2 expressions, G9 skeleton | – | 521 (33.63 %) | 556 (35.89 %) | 0 of 10 | 18–27 ed, plus engine bump 14–21 ed |
| S1 | `subworkflow-call`, `flow-size>500` | 109 / 1 | 631 (40.74 %) | 666 (43.00 %) | 0 | 9–13 ed |
| S2 | `error-branch`, `completion-hook`, `adaptive-retry`, **`model-generated-code-exec`** | 132 / 9 | 772 (49.84 %) | 807 (52.10 %) | 0 | 11–19 ed |
| S3 | `schedule-`, `webhook-`, `event-`, `poll-trigger`, `run-concurrency-policy` (+ P-resume) | 297 / 2 | 1,071 (69.14 %) | 1,106 (71.40 %) | 0 | 21–31 ed |
| S4 | `signal-wait`, `durable-wait` (+ G6 queries and updates, G7 heartbeats and cancel) | 69 / 0 | 1,140 (73.60 %) | 1,175 (75.86 %) | 0 | 9–14 ed |
| S5 | `agent-tool-loop`, `chat-session`, `cross-run-state` | 157 / 44 | 1,341 (86.57 %) | 1,376 (88.83 %) | 9 | 14–22 ed |
| S5b | **`agent-as-tool`, `interrupt-resume`, `guardrail-tripwire`, `context-compaction`** (+ interpreter sessions) | 0 / 31 | 1,372 (88.57 %) | 1,407 (90.83 %) | 9 | 14–23 ed |
| S5c | **`multimodal-io`** | 0 / 6 | 1,378 (88.96 %) | 1,413 (91.22 %) | 9 | 4–7 ed |
| S6 | `unstructured-cycle`, `stream`, **`partial-output-stream`** | 64 / 13 | 1,455 (93.93 %) | 1,490 (96.19 %) | 9 | 15–22 ed |
| S7 | `parametric-action-input`, `dynamic-dag`, **`dynamic-agent-spawn`, `checkpoint-rewind`** (+ G4 detach/await, G5 sagas) | 36 / 15 | 1,506 (97.22 %) | 1,541 (99.48 %) | 9 | 25–38 ed |
| S8 | **`shared-scratchpad`, `state-reducer`** (board v1 + write grants) | 0 / 5 | 1,511 (97.55 %) | 1,546 (99.81 %) | 10 | 10–15 ed |
| S9 | **`env-session`** | 0 / 3 | **1,514 (97.74 %)** | **1,549 (100.00 %)** | 10 | 5–8 ed |
| | named refusals: `by-design-full-history-handoff` 20, `by-design-group-chat` 13, `interactive-dashboard-state` 2 | | | 35 | 0 | – |

By slice after S9: original 1,340 of 1,342 expressible (99.85 %) plus 2 refused; agentic third-party 174 of 207 (84.06 %)
plus 33 refused; first-party 10 of 10. The original column reproduces lane 2's stage numbers exactly: 476, 585, 717,
1,014, 1,083, 1,240, 1,304 and 1,340 (02-ir §7, L1321–L1330).

**Gates per stage.** Each gate must pass before the first run that needs it (synthesis §7):

| Stage | Gate |
|---|---|
| S2 | synthesis §7 item 6, the sandbox escape test |
| S3 | item 9: a model declares triggers and the owner activates them |
| S5b | item 5, executor isolation, before an `executor` tool reads third-party text |
| S5c | the model-route check for image inputs [unk] |
| S8 | the board experiment or the D12 ruling (decision 2) |
| S9 | an audited `gridquest` environment (synthesis L396) |

### 5.2 Greedy order and where the plan departs from it

**Greedy order over the same bundles** (`COVERAGE.md` §10.6) [M]:

S3 +204 → S2 +192 → S5 +178 → S1 +176 → S4 +70 → S6 +70 → S7 +42 → S5b +43 → S5c +10 → S8 +5 → S9 +3

The cumulative counts along that order are 725, 917, 1,095, 1,271, 1,341, 1,411, 1,453, 1,496, 1,506, 1,511 and 1,514.
The construct-level greedy order is in `COVERAGE.md` §10.5. In it, `model-generated-code-exec` comes first among the
agentic constructs (step 18), followed by `agent-as-tool` (20), `interrupt-resume` (22), `multimodal-io` (23) and
`partial-output-stream` (24).

**Departures, with their cost in declared items:**
1. **S1 before S3.** This keeps lane 2's order (02-ir §7, L1312–L1317): composition is the base for the owner's
   requests, and triggers wait on host decisions (activation authority, ingress).
   - Cost: the plan trails the greedy order by 94, 145, 24 and 131 items after one, two, three and four bundles.
   - After five bundles both orders hold the same set {S1…S5}: 1,341.
2. **S5b and S5c before S6 and S7.**
   - The reason: they extend the runtime surface S5 builds (turn journal, context compiler), and they serve Foundry's
     own capability questions:
     - the `executor` and approvals (synthesis §3.6, §3.11);
     - the first-party scripts, which are what this project's agent actually builds;
     - the owner's visual node for game QA (ROADMAP L155–L156).
   - They also take the agentic slice from 48.79 % to 66.67 % before S6.
   - Cost: 33 items behind greedy after seven bundles (1,378 against 1,411). The plan is 2 items ahead after eight
     (1,455 against 1,453), and the orders meet at nine (1,506).
3. **`model-generated-code-exec` in S2, not S5b.** Its form (a), generate → run → check → regenerate, needs no tool loop.
   It is the construct's most common only-blocker shape (9 items). It shares its repair edge with S2's error routes, and
   its security gate already exists (the sandbox). It costs nothing in declared coverage; it brings 9 agentic items
   three stages earlier.
4. **S8 before S9.** Greedy agrees.

### 5.3 Stop points and capability numbers

Every stage ends as in 02-ir §7 (L1342–L1354): the construct ledger is updated; the declared, compiled and executed
numbers are reported with the worst platforms; the conformance suite passes; there is a capability number; and a
`research/ir-<date>/REPORT.md` is written. Capability first still applies: stop after S2 and measure (02-ir §10 decision
4). THESIS D12 keeps representation going, at lower priority than the wild ladder (L359).

The capability numbers for the stages that add agentic constructs:

| Stage | Population | Comparison | Kill or redirect |
|---|---|---|---|
| S2 | `codefix` d4–d5 dev seeds (synthesis §3.6) | a generate→sandbox→`verify` workflow on Haiku 5.5, against the same with an `executor`, against B0-agent | no gain over B0-agent at equal spend → model-written code stays a representation feature, not a builder default |
| S5b | R-bench and pilot items that need agents as tools or approvals | supervisor with agents as tools, against `wide` (code-owned fan-out) and B5 at equal tokens | `wide` ≥ supervisor → agents as tools stay out of the Haiku kit (they remain representable) |
| S5c | `gridquest` with a visual pass, later `gameqa` once audited | image inputs against text stand-ins | no lift → media stay representation-only |
| S8 | lane 7 stage 2 (07 L778) | board vs no board vs B5 | the existing 15 %-per-dollar rule, applied to the kit only (decision 2) |
| S9 | `gridquest` | env sessions with snapshots against a plain agent loop (C5) | ROADMAP C5 |

### 5.4 Effort

| Part | Effort [I] |
|---|---|
| Lane 2's S0–S7 for the 19 original constructs, with S0 at the synthesis's 18–27 ed | 110–166 ed |
| Agentic additions: `model-generated-code-exec` 2–4, S5b 14–23, S5c 4–7, `partial-output-stream` 3–5, `dynamic-agent-spawn` and `checkpoint-rewind` 7–11, S8 10–15, S9 5–8 | **45–73 ed** |
| S0–S9 total | ≈ 155–239 ed |
| Engine-bump prerequisites the synthesis moved out of S0 (P-store, P-sched, G3) | ≈ 14–21 ed |

All of these are ±50 %. How much agents shorten them is unknown [unk].

### 5.5 What "100 %" is and is not

**It is:**
- every one of the 1,549 combined items either uses only constructs that exist after S9, or carries a named rejection;
- the 10 first-party items are covered too, and reported apart.

**It is not:**
- *compiled* or *executed* coverage; both are 0 today (02-ir §8);
- held-out evidence: this corpus shaped the registry, so it is development evidence only, and the headline must come
  from the fresh ~300-item sample after the IR freeze (THESIS D8);
- a claim about deployed agent systems: the agentic slice is a purposive sample of framework examples;
- a claim about things the vocabulary cannot see: sagas, shared rate limits, expression semantics, connectors
  (02-ir §8 item 5).

---

## 6. Sensitivity, open rulings and blind spots

All variants below are computed with the same stage bundles [M; Appendix A.3]. None was applied to the corpus.

### 6.1 The two open rulings on agentic items

| Ruling | Change | Effect on the stage table |
|---|---|---|
| Strands A2A orchestrator (`strands:…/01-a2a-orchestration/orchestrator/agent.py`). `app.py:L75-L83` builds one agent at container start, and every request at `L119` streams on that same agent, so history accumulates across requests **[D audit]** | tag it `chat-session`+`cross-run-state` (rules G1, CS, CM) | **none**: the item unlocks at S6 through `partial-output-stream` either way |
| `guardrail-tripwire` around a tool-free agent (`openai-agents:…/input_guardrails.py`) | the observable-difference test of §3.4 drops the token | S5 combined 1,341 → 1,342; every later stage unchanged |

Recommendation:
- **Strands:** tag it. Rule G1 counts reachable semantics, and the shipped code accumulates history across requests
  whatever AgentCore's session mapping is: per session, that is `chat-session` with carried state; across sessions, it
  is cross-run state. The Haystack `query_decomposition` precedent should be re-read under the same rule.
- **Guardrail:** adopt the ruling.

Both need an edit to `AGENTIC-CONVENTIONS.md` and the staging file, followed by the reproduce chain. That was outside
this task's edit scope.

### 6.2 The original corpus under the agentic convention (probe, not applied)

The four original clusters were labelled by converters that predate the agentic convention: they never emit agentic
tokens or design refusals. A node-type probe over the original items [M; A.2] finds:

| Construct or refusal | Probe | Items | Confidence |
|---|---|---|---|
| refused `group-chat` | Flowise `supervisor` plus `worker` nodes | **6** (2 declared `native`, 4 `agent-tool-loop`) | **confirmed in source** [M] at Flowise `9291856d`. The supervisor prompt is "managing a conversation between the following workers … respond with the worker to act next" (`packages/components/nodes/multiagents/Supervisor/Supervisor.ts:L17-L21`). Its route tool's schema is `next: z.enum(['FINISH', ...members])` (`L136-L141`). Each worker's prompt includes `MessagesPlaceholder('messages')` (`Worker/Worker.ts:L170-L182`) and appends its result as a named message (`L292-L300`). A model picks the next speaker over a shared transcript: rule GC |
| `group-chat` or `full-history-handoff` candidates | Flowise `seqConditionAgent` (a model condition over sequential agents that share `messages`) | 2 (`agentflows-agentic-rag`, `agentflows-support-routing-system`) | unread |
| `multimodal-io` | model nodes over image, audio or video (n8n OpenAI `image.analyze` and `audio.transcribe`, Gemini image, audio and video; activepieces, zapier, dagster, home-assistant and ifttt transcription or vision) | 31 (n8n 25; 2 redistributable; 1 `native`) | operation names [M]; the semantics follow rule MM's text |
| `agent-as-tool` | n8n `agentTool` | 8 (all n8n, non-redistributable) | node type [M]; node meaning [R] |
| `interrupt-resume` | n8n `chatHitlTool`, `telegramHitlTool`, `whatsAppHitlTool` | 2 | node type [M]; node meaning [R] |
| `guardrail-tripwire` candidate | n8n `guardrails` | 1 | unread (sequential or in-loop) |
| `shared-scratchpad` or `state-reducer` candidates | Flowise `seqState` | 5 | unread |
| `env-session` | n8n Airtop session nodes | 1 | borderline (serialisable remote session id); not counted |

**Effect of applying the first, third, fourth and fifth rows** [M]:

| Measure | Before | After |
|---|---|---|
| Original expressible at S0 | 476 | 473 |
| Original expressible at S5 | 1,240 | 1,206 |
| Original expressible at S5b | 1,240 | 1,208 |
| Original expressible at S5c | 1,240 | 1,234 |
| Original expressible at S6 | 1,304 | 1,298 |
| Original expressible at S7–S9 | 1,340 | 1,334 |
| Original named refusals | 2 | 8 |
| Original decided | 1,342 (100 %) | 1,342 (100 %) |
| Combined after S9 | 1,514 expressible + 35 named | 1,508 expressible + 41 named |

Combined decided stays 1,549 (100 %) either way. The plan's order is unaffected.

Recommendation: re-label the original corpus under one convention through a **pre-registered amendment before the IR
freeze** (02-ir §8 item 1: reclassifications need one). It should cover the Flowise multi-agent items, the agent-tool and
human-in-the-loop tool items, and a single `multimodal-io` rule. The rule I propose: `multimodal-io` is needed whenever
media enter or leave a model step that Foundry would run as an `agent`. Connector model operations on media count, since
model calls must go through the ModelPort and the owner policy, not through a capability that hides the model.

### 6.3 Other measured sensitivities

- **Graph evidence not applied.** For 43 agentic items, the readers judged error edges and sub-workflow nodes instead of
  applying the converter rule (`COVERAGE.md` §10.1). Applying the converter rule would add `error-branch` or
  `subworkflow-call` to them.
  - Agentic expressible would fall from 45 to 39 at S0 and from 46 to 42 at S1.
  - From S2 on, nothing changes [M].
- **Notes truncation.** 170 of the 217 agentic notes reach the 2,000-character cut in `items.jsonl`. The convention
  header survives in every item, and the full notes are in `parts/agentic.jsonl`, which the generator reads for refused
  needs (`COVERAGE.md` §10.1).

### 6.4 Known gaps not measured here

- **Stale counts.** `AGENTIC-CONVENTIONS.md` §3.2 and §8 still give `env-session` as 3 (4); after the audit it is 3 (6)
  (`COVERAGE.md` §10.4). That file was outside this task's edit scope.
- **Model readings.** The agentic verdicts are model readings of source, verified by a second pass and harmonised by a
  third. Audit agreement is 28/30 on verdict and needs. That is not ground truth, and nothing was compiled.
- **Unrun oracles.** The declared oracles (third-party: mocked 29, test-profile 17, output-equivalence 2) have not been
  run.
- **First-party items.** They show what this project's own agent builds. They are not independent evidence, and models
  of the same family wrote, extracted and verified them.
- **Pending experiments.** Whether agents as tools, media or the board help a cheap builder is an experiment (§5.3), not
  a representation question (THESIS D12).

---

## 7. Decisions for the owner

| # | Decision | Recommendation | If no answer |
|---|---|---|---|
| 1 | Allow suspension at journaled turn boundaries of the capped tool loop (amends ROADMAP §2.1 L265, "Suspension happens only at node boundaries") | Yes. Needed by `interrupt-resume` (15 + 8 items) and in-loop guards; exact by construction because each turn is journaled | Interrupts stay executor-only (blocking, not durable), and 15 items stay unexpressible |
| 2 | The board gate (ROADMAP L339–L341) against THESIS D12 for `shared-scratchpad` | Build board v1 for representation at S8, below the wild ladder; the 15 %-per-dollar experiment gates only the builder kit | The hard gate applies; if it fails, 5 third-party items and 1 first-party item are refused by name |
| 3 | `guardrail-tripwire` ruling (observable-difference test, §3.4) | Adopt | The convention stays self-contradictory for one item |
| 4 | The Strands A2A served agent | Tag `chat-session`+`cross-run-state` | Left as is; no stage number moves |
| 5 | One convention for both corpora (§6.2), as a pre-registered amendment before the IR freeze | Yes | The original slice keeps 6 group chats as expressible and about 31 media model steps as `task` |
| 6 | Stage order: S5b and S5c before S6 and S7 | Yes (33 items behind greedy at the 7-bundle mark, even at 9) | The greedy bundle order |
| 7 | If the `claude -p` route cannot take images, S5c needs an API model route, which may need a credential (THESIS D10 default: none) | Check before S5c starts; no credential request until then | S5c waits; 6 agentic items stay unexpressible |
| 8 | Keep `group-chat` and `full-history-handoff` refused (applied as review defaults in `8fa9124`); build the design-waiver path only on request | Keep | Same |

---

## Appendix A. Reproduction

**A.1 The coverage tables.**
```sh
cd research/corpus-20261006
node scripts/check-items.mjs items.jsonl --canonical     # 1559 lines, 1559 valid (canonical mode)
node scripts/check-items.mjs --self-test                 # 70 of 70; registry 31 constructs (19 + 12)
node scripts/coverage-report.mjs                          # rewrites COVERAGE.md (and MANIFEST.json, unchanged here)
diff <(git show HEAD:research/corpus-20261006/COVERAGE.md | sed -n 1,551p) <(sed -n 1,551p COVERAGE.md)   # sections 1–9: no output
```
`coverage-report.mjs` now prints a `stages` array in its JSON summary, holding the cumulative original, agentic,
combined, decided and first-party counts per stage.

**A.2 The original-corpus probe** (a scratch script, logic in full):
```js
const orig = items.slice(0, 1342);   // the four original clusters come first in items.jsonl
const has = (it, rx, cat) => it.graph.nodes.some(n => rx.test(n.type) && (!cat || n.category === cat));
groupChat = orig.filter(i => i.source.platform === 'flowise' && has(i, /^(supervisor|worker)$/));            // 6
media     = orig.filter(i => i.graph.nodes.some(n => n.category === 'model'
              && /openAi|googleGemini|PIECE:openai|ChatGPTCLIAPI|llmvision|venice_ai|@asset/.test(n.type)
              && /image|audio|video|transcri|vision/i.test(n.summary + ' ' + n.type)));                       // 31
agentTool = orig.filter(i => has(i, /agentTool$/));                                                            // 8
hitlTool  = orig.filter(i => has(i, /Hitl/));                                                                  // 2
```
The Flowise source check used `git -C /opt/corpus/flowise/repo show HEAD:packages/components/nodes/multiagents/…` at
`9291856d1ea4a4ceea9f8fef8ce14f4f6c81e8eb`.

**A.3 The sensitivity variants** (a scratch script). The same `STAGES` were applied to item models in which:
- `strands`: the A2A orchestrator gains `chat-session` and `cross-run-state`;
- `gt`: `input_guardrails.py` loses `guardrail-tripwire`;
- `graph`: each `merge-log.json` `agentic.graphEvidenceNotApplied` entry adds `error-branch` for "error edge" evidence
  and `subworkflow-call` for "sub-workflow node" evidence, on non-refused items;
- `probe`: the A.2 sets are applied, with Flowise teams as refused, media as `multimodal-io`, agent tools as
  `agent-as-tool` and HITL tools as `interrupt-resume`.

Results:

| Variant | S0 | S5 | S9 | Named refusals |
|---|---|---|---|---|
| baseline | 521 | 1,341 | 1,514 | 35 |
| `strands` | 521 | 1,341 | 1,514 | 35 |
| `gt` | 521 | 1,342 | 1,514 | 35 |
| `graph` | 515 | 1,341 | 1,514 | 35 |
| `probe` | 518 | 1,307 | 1,508 | 41 |

**A.4 Per-construct frequencies, co-occurrence, redistributability and declared oracles** come from the same
`parts/agentic.jsonl` (full notes) through a scratch pass that applies `parseVerdict` and `notesNeeds` from
`check-items.mjs`. The by-platform counts are also in `COVERAGE.md` §10.4.
