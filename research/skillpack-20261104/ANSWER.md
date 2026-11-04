# Skill pack, scale, and ideological gaps (2026-11-04)

*Written inline by the orchestrator on 2026-11-04, after the owner stopped the research workflow and asked for the work
to be done directly (decision D33). Tags: **[obs]** measured or read here; **[doc]** a source's claim; **[inf]** my
inference. Evidence levels: sealed, held-out, dev, design. The skill pack never draws on VERIFIER-LAB.md, ATTACK.md or
the ceiling notes; `tests/skillpack.test.mjs` enforces that.*

## 1. What was built today

`skills/foundry-construct/` is a new skill pack that teaches a model to construct workflows.

- **Core:** `SKILL.md`, 866 words. It holds a 10-step construction loop and 8 hard rules that the linter does not
  enforce, plus a routing table.
- **References** (loaded on demand, about 3,400 words in all):
  - `need.md`;
  - `ir.md` (generated);
  - `patterns.md`: 10 patterns, each tagged with its evidence level and source;
  - `scale.md`: weak points with their counters, an 11-step protocol, an optimality rubric, two worked sketches and
    the engine limits;
  - `verify-stop.md`, `heal-reuse.md` and `antipatterns.md`.
- **Exemplar:** `exemplars/partitioned-audit.json`. It runs a coverage ledger, gated collected failures and a
  fixed-rule, different-model second reader, and passes `foundry validate` and the strict lint with a "gating"
  grade [obs].

Three design choices follow from the evidence:

- **Prose only where code cannot enforce.** The linter already enforces gating acceptance, gated collected failures
  and gated continued errors (`docs/LINT.md`). The pack points at the linter rather than restating those rules.
  `ir.md` is generated from `schemas/workflow.schema.json` (`tools/skillpack/gen-ir.mjs`), and a test fails if it
  drifts.
- **Curated, small and layered.** Curated skills added about +16 points across agent-model configurations, while
  self-written skills did not help (SkillsBench, arXiv 2602.12670) [doc]. The skills spec recommends keeping
  SKILL.md under about 5,000 tokens, with references loaded on demand (agentskills docs) [doc]. Our core is about a
  fifth of that, and the whole pack is capped at 6,000 words by test.
- **Every rule carries its evidence.** The only sealed pattern is P1, compile-once procedures (SOP-Bench). Most
  others are dev, and scale is design. A model reading the pack can weigh them.

The pack is not yet measured. `PREREG-SKILLPACK-1-DRAFT.md` is how it gets a capability number.

## 2. Engine gaps found while building it

These are core-engine work under D33, ranked by how much they block very large jobs:

1. **No data handles** [obs]. Values pass between nodes as inline JSON, and a `code` node's output is capped at
   512 KB (`src/sandbox.mjs:18`). A shard plan for more than about 10,000 units, or any bulk data, cannot flow
   through the workflow. A 300 GB program needs content-addressed references (path or key plus hash) that
   capabilities read in slices.
2. **Sizing is left to the builder's judgement** [inf, owner 2026-11-04]. `map.maxItems` (at most 1,000) and
   `budget.maxConcurrency` (at most 16) are limits, not targets. The economical number of model calls is the
   work code cannot clear, divided by the shard size at which the chosen model's measured recall still holds;
   for many tasks that is a handful of calls, not hundreds. Today the builder must run that probe by hand. The
   engine should offer a probe-and-size step: run the reader on known-answer probe shards at increasing sizes
   per model class, record recall and cost, and emit the shard size, the shard count and the model class that
   meet a recall bar within the budget, or refuse with "filter more by code, sample, or ask". The skill pack
   now teaches the rule (`scale.md` steps 2 and 4).
3. **No run-time sub-workflow creation.** In-node sub-workflow creation is not built. Its experiment SW-1 has run,
   but no result is read yet. Re-decomposition today is a bounded `loop` planned at construction time.
4. **Coverage ledgers were hand-written. Built 2026-11-04** [obs]. The engine now has `verify` `method: "ledger"`
   (`src/ledger.mjs`). Each reader returns the unit ids it read, and the verifier compares them in code with the
   inventory. It fails on any unit never read, read more than `maxReads` times or not in the inventory, and on any
   failed item. `tests/verify-ledger.test.mjs` has 13 tests: 7 on the verdict, 1 on validation and 5 end-to-end
   runs in which a reader drops, re-reads or invents a unit, or crashes. Each of 9 deliberately broken versions of
   the check makes at least one test fail. Writing it found two defects in our own exemplar's hand-written
   reconcile step: it counted distinct ids seen, so an invented id hid a unit never read, and it computed double
   reads but never gated them. The exemplar now uses the ledger verifier.
5. **No adaptive spend across shards** [inf]. A budget is global. There is no rule that moves spend toward the
   shards the probe measured as hard.

## 3. Ideological gaps, ranked

1. **The bitter lesson for harnesses** [doc]. The 2026 debate holds that bespoke scaffolding gets absorbed by
   stronger models, so thin and removable harnesses survive (e.g. philschmid.de "Agent Harness 2026"). Two answers,
   one per layer:
   - **Why the workflow layer survives** [inf]: the parts of a workflow that do not shrink as models improve are
     evidence, exactly-once effects, audit, and cost from code-owned procedure. A smarter model still needs an
     independent check, and still cannot make a retried payment happen once. Construction *advice* can shrink,
     though.
   - **The rule for the pack:** every rule is ablated at each new model generation and dropped when it stops moving
     the capability number. P1 (head-to-head against a plain frontier agent) is the live test of the workflow side.
2. **Proof lags building.** One sealed result (SOP-Bench phase 2) and many dev numbers. The pack, the scale protocol and
   most patterns are dev or design. The next sealed results are P1 (running) and DUR-1 (built, not run).
3. **Intent is the largest failure class, and our intent work is unmeasured.** In MAST, specification failures are
   the largest category across 1,642 annotated traces (arXiv 2503.13657) [doc]. Our SPEC-1/INTENT-1 runs are
   built and never run. A perfect engine executing the wrong spec is still wrong.
4. **No learning across runs.** Each construction starts from templates and the pack. Certified runs do not yet
   feed a verified pattern library. Self-written notes do not help (SkillsBench), so the flywheel must be *curated
   and certified* patterns retrieved as exemplars, not the model's own notes. CI-1 corpus retrieval, which is
   running, is the first step.
5. **Stopping needs evidence, not confidence** [doc]. Evidence-carrying termination cut premature stops from 40/66
   to 0/66 (arXiv 2608.23623), and a third of agent repos have no exit at all (arXiv 2607.01641). The pack adopts
   this (`verify-stop.md`). The engine should make "stop" itself a gated node carrying the evidence it relies on.
6. **Data as an environment.** Recursive language models treat a huge input as an environment that code slices and
   the model calls itself over (arXiv 2512.24601) [doc]. It reports inputs about 100x beyond the context window. The
   scale protocol adopts the idea (code profiles and queries; models read slices), but the engine lacks the data
   handles to support it (gap 1 above).

**"We are wrong if…"**
- P1 shows plain Haiku or Opus matching our workflows on unseen tasks at similar cost.
- DUR-1 shows a built workflow decaying under change faster than an agent re-solving each task.
- The skill pack does not beat "no pack" on construction tasks with executable oracles.

## 4. Visualisation (D33)

We expose read-only visualisations; the owner builds the UI. The engine's duty is the data a visualiser needs:
- the version-pinned graph;
- per-node status from the journal;
- the coverage ledger;
- cost burn against budget;
- verdict distributions;
- approvals.

All of these are already journal-derived, except a ledger view, which arrives with gap 4.

## 5. Laptop readiness, in short

Most recent engine work sits on about 17 unmerged branches, rescued as bundles in `research/session-20261028-rescue/`.
Before the owner's local agent inspects the engine, the work must become one installable thing:
- an integration pass merging the reviewed branches in dependency order;
- the full test suite green in one tree;
- the README's quickstart and `docs/laptop-agent-kickoff.md` refreshed;
- the platform limits stated (sandboxed `code` nodes are Linux-only).

That pass is the next inline work after this pack.

## Sources
- SkillsBench: <https://arxiv.org/html/2602.12670v1>
- Agent Skills docs (progressive disclosure, size guidance): <https://docsearch.algolia.com/mcp/docs/repo/agentskills/agentskills>
- Anthropic, multi-agent research system: <https://www.anthropic.com/engineering/multi-agent-research-system>
- MAST failure taxonomy: <https://arxiv.org/pdf/2503.13657.pdf>
- Evidence-carrying termination: <https://arxiv.org/pdf/2608.23623>
- Infinite agentic loops: <https://arxiv.org/pdf/2607.01641>
- Recursive Language Models: <https://arxiv.org/abs/2512.24601>
- The agent-harness / bitter-lesson debate: <https://www.philschmid.de/agent-harness-2026>, <https://browser-use.com/posts/bitter-lesson-agent-harnesses>, <https://arxiv.org/pdf/2609.20804>
