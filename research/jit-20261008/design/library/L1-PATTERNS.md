# L1: the pattern catalog, derived from the 1,559-item corpus census

*Library design, 2026-10-09. Evidence tags: [M] measured elsewhere in the repo; [M-c] computed here at $0 from
`research/corpus-20261006/items.jsonl` by `tools/pattern-census.mjs`; [I] inference; [W] public documentation. Raw
outputs: `out/pattern-census.json`, the per-item `out/pattern-census-items.jsonl`, and the tables `out/pattern-census.md`
(rendered by `tools/render-tables.mjs`). Reproduce with
`THETA=0.35 CLUSTER=1 node --max-old-space-size=2048 research/jit-20261008/design/library/tools/pattern-census.mjs`.
No model was called.*

## 0. Result in one paragraph

The census assigns every control node in the corpus to either an L0 construct or one of 54 catalogued L1 patterns. There are 24,603
control nodes; a control node is a trigger, condition, loop, human, model, wait, sub-workflow, merge or error-handler
node, or any node with an error edge. Verdict tokens that have no node, such as `adaptive-retry` or `cross-run-state`,
are assigned too. Results [M-c]:

| | items | share of 1,559 |
|---|---|---|
| explained by L0 + L1 | 1,524 | 97.8% |
| fits the constructor's expansion budget (5 or fewer distinct L1 patterns), flat | 1,281 | 82.2% |
| needs more than 5 patterns (a parent solver plus `call`ed children) | 243 | 15.6% |
| refused by design (named in §2.5) | 35 | 2.2% |
| uncovered | 0 | 0% |

- **90% of items are explained by the first 37 patterns** of the greedy order (refused items count as unexplained).
  Counting refusals as decided, 90% is reached at 36. Either way this is well under the 60-pattern target.
- **L0 alone explains 233 items (14.9%).** These are mostly linear science and orchestration DAGs.
- **Whole-workflow templates do not transfer across platforms.** At θ = 0.35, 776 structures form 19 families of 3 or
  more items, and only 3 of those families span 3 or more platforms (§2.6). The reusable unit is the idiom, not the workflow.
- **What is buildable today is much less than what is explained.** Only 419 items (26.9%) need nothing beyond solver
  constructs that exist (flow-v2/v3); 755 (48.4%) with today's engine envelope; 1,022 (65.6%) if the host harness owns
  triggers. The rest wait on unbuilt engine nodes, led by cross-run `state` (157 items blocked) (§7).

## 1. Method, definitions, caveats (read before quoting any number)

1. **Unit.** Each item is a derived graph (`graph.nodes[].category`, `graph.edges[].kind`), its IR verdict tokens,
   its features and its written summary (ITEM-SCHEMA.md). The census reads only these fields. It never reads source
   text that a licence forbids redistributing, and it never reads `beds/sealed/`.
2. **Assignment rules.** `ruleFor` in `tools/pattern-census.mjs` assigns each control node by its category and its
   neighbourhood: predecessors, successors, whether it sits in a cycle or loop body, and whether an effect follows.
   §2.7 gives the full rule table with node counts. Each verdict token adds its pattern through `TOKEN`.
3. **Support-only detectors.** P01, P02, P16, P17, P18, P30, P49, P50 and P51 are *plumbing* idioms. They are
   detected by shape and keyword (linear chain, read→transform→write, "dedupe", "reconcile", "vote" and so on). They
   are counted as support but **do not** count toward explaining an item, because each control node already has an
   owner. Their keyword precision is **unmeasured** [I]. Known false positives:
   - P30 saga: all 7 hits are spurious (for example WDL `RevertSam`). The corpus has no Temporal saga sample, so P30 has **zero genuine support**.
   - P16 dedupe: the science cluster is excluded because of de-duplication tools.
4. **What "explained" means, and what it does not.** The rule list is total by construction: every non-refused item
   gets an assignment. **So "decided 100%" is a tautology and is not quoted as coverage.** The informative numbers are
   the following four.
   - **(a) The greedy curve:** how many patterns are needed before the rest are rare.
   - **(b) The expansion-budget fit:** whether an item needs 5 or fewer distinct patterns, the constructor's
     context limit (LIBRARY.md §5).
   - **(c) The L0-only share.**
   - **(d) The default-rule share:** control nodes that fell to a rule's catch-all branch. It is 391 of 24,603
     (1.6%), so the rules are mostly specific, not catch-alls.
5. **Structural, not executable.** "Explained" means *each control node maps onto a pattern skeleton*. It does not
   mean a constructor built the workflow, nor that the result would pass the item's oracle. Only 438 items carry an
   executable oracle (COVERAGE §7). LIBRARY-TESTS L1 is the executable check, on the oracle-bearing subset.
6. **Single labeller.** The rules were written by one agent reading the corpus. Nobody has audited them [I].
   LIBRARY-TESTS L1 includes a 60-item hand audit before any coverage claim leaves this directory.

## 2. Coverage results [M-c]

### 2.1 Expansion budget: items explained flat with at most b distinct L1 patterns

| b | 1 | 2 | 3 | **5** | 8 | 12 |
|---|---|---|---|---|---|---|
| items | 546 | 796 | 994 | **1,281** | 1,468 | 1,511 |
| share | 35.0% | 51.1% | 63.8% | **82.2%** | 94.2% | 96.9% |

Patterns per item (0 means L0 only): 233 · 313 · 250 · 198 · 161 · 126 · 98 · 52 · 37 · 16 · 18 · 7 · 2 · 7 · 4 · 2, for 0 through 15 patterns.

An item that needs more than 5 patterns is built as a parent with called children. Each child stays within the
budget (`flow.call`, LIBRARY.md §6). Most of these items are n8n (94 of 135) and Apple Shortcuts (43 of 79), which
are mega-flows; the most complex, `n8n:7962`, `n8n:11772` and `n8n:12533`, need 13–15 patterns each.

### 2.2 Greedy curve (each step adds the pattern that explains the most further items)

| k | 1 | 5 | 10 | 15 | 20 | 25 | 30 | 34 | **37** | 40 | 44 | 47 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| added | P37 | P27 | P14 | P07 | P03 | P13 | P19 | P10 | **P51** | P41 | P31 | P23 |
| explained | 17.8% | 27.2% | 38.9% | 47.3% | 56.0% | 67.7% | 75.3% | 82.2% | **90.4%** | 94.4% | 97.2% | 97.8% |

The full 47-step curve is in `out/pattern-census.md`. The curve is shallow early: no single idiom explains more than 18% of
items, because real workflows mix 2–5 idioms. One step is large: P55 at k = 35 adds 81 items. P55 is
ask → validate → use, and it completes many Apple Shortcuts and Home Assistant items.

### 2.3 By cluster (flat / hierarchical / refused)

| automation | orchestration | science | consumer-creative | agentic | first-party |
|---|---|---|---|---|---|
| 262 / 131 / 2 | 392 / 4 / 0 | 276 / 2 / 0 | 197 / 76 / 0 | 144 / 30 / 33 | 10 / 0 / 0 |

### 2.4 Per platform (all 49 platforms; L0-only = no L1 pattern needed)

| cluster | platform | items | flat | hier | refused | L0-only | median / max patterns |
|---|---|---|---|---|---|---|---|
| agentic | ag2 | 8 | 3 | 1 | 4 | 0 | 5 / 6 |
| agentic | agno | 10 | 8 | 2 | 0 | 0 | 4 / 8 |
| agentic | anthropic | 12 | 8 | 4 | 0 | 0 | 3 / 6 |
| agentic | autogen | 14 | 7 | 1 | 6 | 0 | 3 / 6 |
| agentic | burr | 8 | 8 | 0 | 0 | 0 | 3 / 5 |
| agentic | camel | 3 | 1 | 2 | 0 | 0 | 8 / 8 |
| agentic | crewai | 13 | 13 | 0 | 0 | 0 | 4 / 5 |
| agentic | dspy | 10 | 7 | 3 | 0 | 0 | 4 / 10 |
| agentic | google-adk | 15 | 10 | 2 | 3 | 0 | 3 / 7 |
| agentic | haystack | 8 | 6 | 1 | 1 | 0 | 3 / 8 |
| agentic | inngest-agentkit | 7 | 4 | 2 | 1 | 0 | 4 / 8 |
| agentic | langgraph | 18 | 14 | 0 | 4 | 0 | 3 / 5 |
| agentic | llamaindex-workflows | 10 | 9 | 0 | 1 | 0 | 4 / 5 |
| agentic | mastra | 8 | 5 | 3 | 0 | 0 | 5 / 6 |
| agentic | metagpt | 4 | 3 | 0 | 1 | 0 | 5 / 5 |
| agentic | openai-agents | 18 | 12 | 2 | 4 | 0 | 3 / 7 |
| agentic | openai-swarm | 6 | 3 | 0 | 3 | 0 | 3 / 3 |
| agentic | pydantic-graph | 9 | 6 | 3 | 0 | 0 | 5 / 6 |
| agentic | semantic-kernel | 9 | 4 | 0 | 5 | 0 | 4 / 5 |
| agentic | smolagents | 6 | 4 | 2 | 0 | 0 | 4 / 8 |
| agentic | strands | 11 | 9 | 2 | 0 | 0 | 5 / 7 |
| automation | activepieces | 40 | 34 | 6 | 0 | 0 | 4 / 7 |
| automation | coze | 22 | 22 | 0 | 0 | 3 | 1 / 2 |
| automation | dify | 50 | 45 | 5 | 0 | 2 | 3 / 7 |
| automation | flowise | 51 | 44 | 7 | 0 | 0 | 3 / 7 |
| automation | langflow | 27 | 27 | 0 | 0 | 0 | 4 / 5 |
| automation | n8n | 135 | 41 | 94 | 0 | 4 | 7 / 15 |
| automation | node-red | 45 | 27 | 16 | 2 | 2 | 5 / 11 |
| automation | zapier | 25 | 22 | 3 | 0 | 0 | 4 / 6 |
| consumer-creative | apple-shortcuts | 79 | 36 | 43 | 0 | 2 | 6 / 11 |
| consumer-creative | comfyui | 73 | 72 | 1 | 0 | 6 | 1 / 6 |
| consumer-creative | home-assistant | 96 | 64 | 32 | 0 | 1 | 4 / 9 |
| consumer-creative | ifttt | 25 | 25 | 0 | 0 | 0 | 1 / 2 |
| first-party | claude-code-workflows | 10 | 10 | 0 | 0 | 0 | 3 / 4 |
| orchestration | airflow | 88 | 88 | 0 | 0 | 30 | 1 / 5 |
| orchestration | argo | 55 | 55 | 0 | 0 | 29 | 0 / 2 |
| orchestration | dagster | 25 | 25 | 0 | 0 | 6 | 1 / 5 |
| orchestration | github-actions | 85 | 85 | 0 | 0 | 2 | 2 / 5 |
| orchestration | gitlab-ci | 41 | 37 | 4 | 0 | 0 | 3 / 7 |
| orchestration | kubeflow | 30 | 30 | 0 | 0 | 28 | 0 / 2 |
| orchestration | prefect | 18 | 18 | 0 | 0 | 11 | 0 / 2 |
| orchestration | tekton | 20 | 20 | 0 | 0 | 10 | 0 / 2 |
| orchestration | temporal | 34 | 34 | 0 | 0 | 5 | 1 / 3 |
| science | cwl | 45 | 45 | 0 | 0 | 27 | 0 / 1 |
| science | galaxy | 60 | 60 | 0 | 0 | 16 | 1 / 3 |
| science | nextflow | 25 | 25 | 0 | 0 | 6 | 2 / 5 |
| science | nf-core | 72 | 70 | 2 | 0 | 0 | 3 / 7 |
| science | snakemake | 40 | 40 | 0 | 0 | 14 | 1 / 4 |
| science | wdl | 36 | 36 | 0 | 0 | 29 | 0 / 2 |

Reading this table [I]:
- **Orchestration and science DAG platforms need little from L1.** Airflow, Argo, CWL, Kubeflow, WDL and Prefect have
  a median of 0–1 patterns. Their difficulty is in the tasks' tools and data (L2 and L3), not in control flow.
- **Automation and consumer platforms are where L1 matters.** On n8n, Apple Shortcuts, Home Assistant and Node-RED
  most items are hierarchical: they need a parent solver with called children.
- **Every refusal is in agent frameworks.** The refusals are the multi-agent conversation shapes listed in §2.5,
  plus two Node-RED dashboard items.

### 2.5 Refusals (the long tail that is declined, with reasons)

| refusal | items | platforms | reason, and what the library offers instead |
|---|---|---|---|
| by-design group chat | 13 | semantic-kernel 4, ag2 3, autogen 3, inngest-agentkit 1, langgraph 1, metagpt 1 | Model-chosen speaker order over a shared transcript breaks P9: untrusted text chooses control flow, and no contract fixes the hand-off types. **Offer:** P46 supervisor → agents as typed tools, or P49 verify panel, if the goal was critique. |
| by-design full-history handoff | 20 | openai-agents 4, autogen 3, google-adk 3, langgraph 3, openai-swarm 3, ag2 1, haystack 1, llamaindex-workflows 1, semantic-kernel 1 | Passing the whole transcript to the next agent makes the payload untyped and the context unbounded. **Offer:** P07 router plus P46 with typed hand-off contracts. The rewrite loses the "conversation continuity" feature by design. |
| interactive dashboard state | 2 | node-red 2 | Long-lived UI widget state is not a workflow. **Offer:** none; L3 binding to the host UI. |

Rewritten rather than refused: the `shared-scratchpad` and `state-reducer` tokens become P19 `wide`, with a typed
reduce and one writer. This affects 6 items: agno `nested_shared_state`, claude-code `phase0-unblock`, two
google-adk items, llamaindex `agents_as_tools` and strands `swarm`.

### 2.6 Structure does not recur across platforms

Single-linkage clustering uses the census distance from `research/replication-*/lib`, applied to category-level labels.
It covers 776 items with 5–40 nodes and computes 54,115 of 300,700 pairs; the rest are pruned by the lower bound.

| θ | families of 3 or more | spanning 3 or more platforms |
|---|---|---|
| 0.20 | 11 | 1 |
| 0.30 | 20 | 2 |
| 0.35 | 19 | 3 |

The three families that span platforms are:
- cwl/galaxy/snakemake/wdl linear pipelines, 17 items;
- airflow/argo/tekton, 7 items;
- cwl/galaxy/wdl, 5 items.

The other families are within one platform: langflow chat agents, flowise RAG, home-assistant debounce rules and
github-actions CI. The census row 33 result agrees: 4 oracle-bearing families. **So the library stores idioms (L1)
and components (L2), not whole-workflow templates. Whole workflows are stored only as kept instances (L4), and
retrieval reuses one only when the input profile matches.**

### 2.7 Rule table (rules with 4 or more nodes; full table in `out/pattern-census.md`)

The largest owners of control nodes:

| rule | assigned to | nodes |
|---|---|---|
| code branch | L0:if | 3,053 |
| human menu | P10 | 1,652 |
| sub-workflow call | P54 | 1,608 |
| human then branch | P10 | 1,234 |
| output display | L0:notify | 1,179 |
| media model | P56 | 1,154 |
| guard before effect | P08 | 991 |
| trigger as input | L0:input | 919 |
| trigger event | P38 | 909 |
| code guard | L0:guard | 873 |

The smallest rules:

| rule | assigned to | nodes |
|---|---|---|
| judge gate then human | P09 | 33 |
| loop until | P22 | 29 |
| summariser | P51 | 25 |
| code-writing model | P47 | 23 |
| continue-as-new | P31 | 6 |

## 3. Pattern card format

Every L1 item has the same eight fields; LIBRARY.md §3.2 has the JSON schema. The **index line**, the only part
always in context, is at most 30 tokens:

```
P07 router-by-kind | branch | judged classify each item -> per-kind handler; unknown -> review | slots 6 | ev 193/32p | v1
```

**Slots** are typed. Allowed slot types:
- `enum[]`: a closed list of strings;
- `schema`: a portable JSON schema;
- `path`: a field path into the input;
- `fn:pure`: a body written by per-slot constrained generation, checked by lint;
- `judge`: a `flow.judge` spec;
- `hash`: an L2 or L4 reference;
- `int[a,b]`: a bounded literal;
- `tiers`: model ids from `policy/models.json`.

The constructor never writes a whole workflow in one call. It chooses patterns, then fills slots one slot type at a
time (review-20261007/05 §3.2 [M]).

**When-to-use questions** are written for Jev's `/v1/systemone`: one narrow judgment per question, over a state that
carries the task brief, an input sample and code-computed shape features, but no conclusion (JEV-PORTS §1). Each card
lists 2–3 questions. Every choice question has a no-match option.

**Checklist** items cite the corpus items they were mined from. Counts tagged `kw n` are items whose summaries or
`ir.notes` contain the edge keyword (17 keyword classes, `EDGE_KW` in the census tool) [M-c]. Untagged checklist items
are [I].

**Tests.** Each pattern ships stub-gateway fixtures: deterministic judge answers through `tools/flow-override.mjs`,
covering one positive case, one no-match case and one drift case. Tests run at $0 (BUILD-ORDER step 3).

## 4. First slice: 12 patterns, full cards

These 12 are chosen because W-bed R1–R3 need them (W-BED §3.1–3.3: ledger close, inbox router, statement audit).
Together they own 4,490 control nodes (18.2%), against 6,867 (27.9%) owned by L0. Alone they fully explain 316 items
(20.3%) [M-c]. That is a construction-arm slice, not a coverage slice: the greedy-curve leaders (P37 webhook, P36
schedule, P27 error route) are envelope patterns, which W-bed R7 parks.

### P01 linear pipeline with typed hand-offs (spine) — 758 items, 32 platforms, 239 oracle-bearing [M-c]

When to use:
- J1 (noul): "Does the task consist of stages where each stage's output is the next stage's only input?"
- J2 (choice): "What does the work look like?" Options:
  - `one-pass`: one transformation;
  - `stages`: an ordered sequence of distinct transformations;
  - `per-item`: the same work repeated per item;
  - `none`: none of these.

```js
// P01 slots: STAGES[] = [{name, fn:pure | judge | hash, out: schema}], CONSERVE (fn:pure, optional)
const task = flow.input();
let x = task.inputs;
for (const s of $STAGES) {                       // unrolled by the constructor; one literal stage per line
  x = s.kind === 'call' ? await flow.call(s.hash, x, { name: s.name, budgetUsd: s.budget, timeoutMs: 120000 })
    : s.kind === 'judge' ? await flow.judge(s.name, s.spec(x)) : flow.step(s.name, () => s.fn(x));
  flow.invariant(`${s.name}-typed`, validates(s.out, x), {});
}
if ($CONSERVE) flow.invariant('conserved', $CONSERVE(task.inputs, x), {});
flow.done(x);
```

| slot | type | required |
|---|---|---|
| `STAGES` | list of {name, kind, fn / spec / hash, out: schema}, 2 to 8 entries | yes |
| `CONSERVE` | fn:pure (input, output) → bool | no; strongly recommended |

Checklist:
- Every hand-off has a schema; no stage reads an earlier stage's raw input unless the schema says so.
- At least one conservation invariant from input to output. This was the C0 lesson: "VERIFY_NOT_GATING" in the lint
  rules of review-20261007/05.
- Stages over 8 split into a P54 call.

Mined from: `airflow:…example_dag_akeyless`, `tekton:…pipelinerun-using-different-subpaths-of-workspace`,
`galaxy:iwc/clinicalmp-database-generation`, `dagster:quickstart_etl`.

### P03 extract → normalise → validate (model reads, code parses) (spine) — 106 items, 18 platforms [M-c]

When to use:
- J1 (noul): "Must values be read out of free text or of documents with differing layouts before any calculation?"
- J2 (choice): "How do the inputs state their conventions (dates, units, currency)?" Options:
  - `fixed`: one convention, known in advance;
  - `stated-per-source`: each source states its own convention in prose;
  - `implicit`: it has to be inferred from the values;
  - `none`: no conventions matter.

```js
// P03 slots: SOURCES (path), PARSE (fn:pure per format), CONV_JUDGE (judge: {order, unit, quote}), NORMALISE (fn:pure),
//            VALIDATE (schema + fn:pure), REJECT ('deopt' | 'review')
const perSource = await flow.map($SOURCES(task), async src => {
  const rows = flow.step(`parse:${src.id}`, () => $PARSE(src));
  const conv = await flow.judge('convention', { ...$CONV_JUDGE(src.note),
    check: v => src.note.includes(v.quote) ? null : 'quote not in note' });
  return rows.map(r => $NORMALISE(r, conv));
}, { concurrency: 4 });
const rows = perSource.flat(), bad = rows.filter(r => !$VALIDATE(r));
flow.guard('validated', $REJECT === 'review' || bad.length === 0, { n: bad.length, first: bad[0]?.id });
flow.invariant('rows-conserved', rows.length === $SOURCES(task).reduce((n, s) => n + s.rowCount, 0), {});
```

| slot | type |
|---|---|
| `SOURCES` | path |
| `PARSE` | fn:pure, one per format (lint: no model call) |
| `CONV_JUDGE` | judge with enum fields and a `quote` |
| `NORMALISE` | fn:pure |
| `VALIDATE` | schema + fn:pure |
| `REJECT` | enum {deopt, review} |

Checklist:
- **Quote check on every reading judge.** Seen in `kw validate` across 28 P07 and 13 P06 items, for example
  `flowise:agentflowsv2-agentic-rag`.
- **Minor units** for money; never floats.
- **Default or fallback values must be explicit and flagged.** `kw default 9`, for example
  `dify:mkt-0fc0bb5c…`, `dify:mkt-431dd20f…`.
- **A batch or chunk size bounds each read.** `kw batch 4`, for example `n8n:11382`, `n8n:2658`.
- **REASONING_ON_EXTRACTION lint:** no chain-of-thought field in an extraction schema (review-20261007/05).

Mined from: `google-adk:…workflows/nested_workflow`, `dspy:…rlm-cohort-analysis`, `airflow:…example_sagemaker_endpoint`.

### P07 router by kind (judged classify, then dispatch) (branch) — 193 items, 32 platforms, 35 oracle-bearing [M-c]

When to use:
- J1 (noul): "Does each input item need different handling depending on a category that is not given as a field?"
- J2 (choice): "What decides the category?" Options:
  - `field`: a field value;
  - `prose`: cues in free text;
  - `caller`: the caller states it;
  - `none`: no category.

  `field` routes to L0:if, not P07.
- J3 (noul): "Could some items fit none of the categories, or be genuinely ambiguous?" If yes, P09 is added.

```js
// P07 slots: ITEMS (path), KINDS (enum[]), CUE (fn:pure item -> text), KIND_SPEC (judge), HANDLERS ({kind: fn | hash}),
//            ON_NONE ('review' | 'ignore'), CONCURRENCY (int[1,8])
const routed = await flow.map($ITEMS(task), async it => {
  const v = await flow.judge('kind', { ...$KIND_SPEC, prompt: $CUE(it),
    schema: { type: 'object', properties: { kind: { enum: [...$KINDS, 'none-of-these'] }, quote: { type: 'string' } } },
    check: v => $CUE(it).includes(v.quote) ? null : 'quote not in item' });
  if (v.kind === 'none-of-these') return { id: it.id, route: $ON_NONE };
  const h = $HANDLERS[v.kind];
  return { id: it.id, route: v.kind, out: typeof h === 'string'
    ? await flow.call(h, it, { name: `handle-${v.kind}`, budgetUsd: 0.05, timeoutMs: 60000 }) : flow.step(`handle-${v.kind}`, () => h(it)) };
}, { concurrency: $CONCURRENCY });
flow.invariant('routed-once', new Set(routed.map(r => r.id)).size === $ITEMS(task).length, {});
```

Checklist:
- **A `none-of-these` option always.** `kw default 32`, for example `dify:mkt-1b5493cc…`.
- **Every route is a closed enum.** Free-text labels are refused (P9).
- **An injection document routes to `ignore`, never to an effect handler.** W-bed R2 plants one.
- **Each item is routed exactly once (invariant).** Handlers that write shared state go through a single writer
  (`kw state 45`, for example `activepieces:OZH5az2RIrvLKCr0bL47g`).
- **Notify handlers are effects and belong in the envelope.** `kw notify 25`, for example `activepieces:3AzxIABbHE7PBCsBZfP3m`.

Mined from: `pydantic-graph:…genai_email_feedback`, `coze:query-types-llm-intent-http-nodes`,
`strands:…graph_loops_example`, `google-adk:…request_input`.

### P08 guard → act (filter before an effect) (branch) — 229 items, 14 platforms, 53 oracle-bearing [M-c]

When to use:
- J1 (noul): "Should some inputs be dropped or stopped before any action is taken, by a rule that code can check?"
- J2 (choice): "Is the filter condition…?" Options:
  - `code`: computable from fields;
  - `judged`: it needs reading text, which makes it P07 or P09;
  - `none`: there is no filter.

```js
// P08 slots: ITEMS (path), KEEP (fn:pure item -> bool | reason-code), ON_DROP ('note' | 'flag' | 'deopt'), MIN_KEEP (int, optional)
const keep = [], drop = [];
for (const it of $ITEMS(task)) { const r = $KEEP(it); (r === true ? keep : drop).push({ it, r }); }
flow.note('filtered', { kept: keep.length, dropped: drop.length, reasons: countBy(drop, d => d.r) });
if ($MIN_KEEP != null) flow.guard('enough-kept', keep.length >= $MIN_KEEP, { kept: keep.length });
flow.invariant('partition', keep.length + drop.length === $ITEMS(task).length, {});
// effect (if any) happens in the envelope on `keep`; the solver returns {keep, drop}
```

Checklist:
- **Dropped items are reported with a reason code**, never silently (must-not-allow list, "silent fallbacks",
  review-20261007/02 §5).
- **The filter reads only code values.** A judged filter is P07 or P09.
- **Dedupe state across runs is P42, not a local set.** `kw state 40`, for example `n8n:18427`,
  `node-red:2e10a76f…`.
- **Batch size** `kw batch 24` (for example `n8n:11382`) and **delay between effects** `kw backoff 14` belong in the
  L3 binding (rate limit), not in the filter.

Mined from: `airflow:…example_bedrock`, `galaxy:iwc/multiplex-tma`, `nf-core:scrnaseq@4.2.0`, `nextflow:workflowhub/462`.

### P09 judge → confidence gate → review queue (escalate, never guess) (branch) — 20 items, 10 platforms [M-c]

When to use:
- J1 (noul): "Can some inputs be genuinely undecidable from their content, so that a wrong automatic decision costs
  more than a human look?"
- J2 (choice): "Who resolves an undecided item?" Options:
  - `human-queue`: a review list is returned;
  - `stronger-model`: escalate tiers;
  - `none`: every item must be decided automatically.

```js
// P09 slots: DECIDE (judge, samples >= 3 or tiers >= 2), AGREE (fn: votes -> bool), QUEUE_REASON (enum[])
const flow = createFlow({ budgetUsd: $BUDGET, autoFlag: true });     // escalation and split votes become flags
const out = await flow.map(items, async it => {
  const v = await flow.judge('decide', { ...$DECIDE(it), samples: 3 });
  const unsure = v.choice === 'undecidable' || flow.flagged?.('judge-escalated:decide', it.id);
  return unsure ? { id: it.id, queue: { reason: v.reason ?? 'split-vote', quote: v.quote } } : { id: it.id, decided: v };
}, { concurrency: 4 });
flow.done({ decided: out.filter(o => o.decided), review_queue: out.filter(o => o.queue) });
```

`flow.flagged` is not in flow-v2. Until it exists, read `autoFlag` events from the run's own `trace.jsonl`, or vote
in code over `samples` [M: flow-v2 `autoFlag` exists; the accessor is a proposed addition].

Checklist:
- **Both errors count.** Escalating a decidable item is an error, and so is deciding an undecidable one. This is how
  W-bed R2 scores it.
- **An `undecidable` option exists in the judge schema.**
- **Persistent trust is a P42 state entry with expiry.** For example `strands:…13-human-in-the-loop…hook-approval-with-persistent-trust`.
- **The queue carries a quote.** A human never sees a bare id.

Mined from: `langgraph:…wait-user-input#ask-human-agent`, `semantic-kernel:…Step02b_AccountOpening`,
`autogen:…agentchat_chess_game`.

### P12 map → code reduce (for-each with typed coverage) (fan) — 112 items, 12 platforms [M-c]

When to use:
- J1 (noul): "Is the same per-item work applied to a list whose length is only known at run time?"
- J2 (choice): "Does each item's work need…?" Options:
  - `code`: code only;
  - `reading`: reading text (P13);
  - `sub-workflow`: a whole sub-workflow (P53);
  - `none`: no per-item work.

```js
// P12 slots: ITEMS (path), BODY (fn:pure | hash), REDUCE (fn:pure), MAX_ITEMS (int[1,1000]), CONCURRENCY (int[1,16])
flow.guard('bounded', $ITEMS(task).length <= $MAX_ITEMS, { n: $ITEMS(task).length });
const res = await flow.map($ITEMS(task), (it, i) => ({ id: it.id ?? i, ...$BODY(it) }), { concurrency: $CONCURRENCY });
flow.invariant('one-per-item', res.length === $ITEMS(task).length, {});
flow.done($REDUCE(res));
```

Checklist:
- **A maximum item count**, through the IR `maxItems` ≤ 1000. Above it, chunk via P53.
- **Echo the item id** (MAP_NO_ECHO_CHECK lint, review-20261007/05).
- **Batch or chunk** `kw batch 23`, for example `coze:httprequester-http-implicit-dependencies`, `n8n:10156`.
- **Pagination of the source list** `kw pagination` (for example `activepieces:UslzViNdWBKKKprQuIA64`): fetch the
  pages in the envelope or in P23 before the map.
- **`map` stays fail-fast.** Partial results with typed coverage are `wide` (P19).

Mined from: `coze:app-variables-for-sub-process`, `n8n:13500`, `argo:coinflip-recursive`.

### P13 batched extract (map with a judge body, id echo) (fan) — 66 items, 18 platforms [M-c]

When to use:
- J1 (noul): "Must many separate text items each be read by a model, with one small typed result per item?"
- J2 (choice): "Can several items share one model call?" Options:
  - `one-per-call`: each item needs its own call;
  - `batched`: small items can be packed;
  - `none`: no model reading.

```js
// P13 slots: ITEMS (path), READ (judge with schema {id, ...fields, quote}), PACK (int[1,20]), CONCURRENCY (int[1,8])
const batches = chunk($ITEMS(task), $PACK);
const out = (await flow.map(batches, b => flow.judge('read-batch', { ...$READ(b),
  check: v => sameIds(v.items, b) && v.items.every(r => textOf(b, r.id).includes(r.quote)) ? null : 'id echo or quote failed' }),
  { concurrency: $CONCURRENCY })).flatMap(v => v.items);
flow.invariant('all-read', out.length === $ITEMS(task).length, {});
```

Checklist:
- **Id echo plus quote check.** Mined `kw default 7`, `kw state 17` (for example `activepieces:P4MZLep45DFk4lilR7QOW`).
- **Bound the batch** `kw batch 14`, for example `n8n:10156`.
- **The loop exit is code**, never "the model says done". Rule `condition:loop-exit`, 282 nodes.
- **Escalate a failed batch per item, not per batch**, to avoid one bad item sinking 20 [I].

Mined from: `dspy:…refine-factuality-judge`, `google-adk:…on-brand-genmedia`, `smolagents:…benchmark-agent-type-switch`, `n8n:10156`.

### P15 fan-in aggregate / report (fan) — 32 items, 5 platforms [M-c]

When to use:
- J1 (noul): "Must results from many branches or items be combined into one total or report with checkable identities?"
- J2 (choice): "What must the combined result satisfy?" Options:
  - `sum-identity`: totals equal the sum of parts;
  - `set-identity`: every input appears once;
  - `none`: no checkable identity.

```js
// P15 slots: PARTS (path | value), KEY (fn:pure), AGG (fn:pure), IDENTITY (fn:pure parts,total -> bool), QUORUM (0..1)
const groups = groupBy($PARTS, $KEY);
const report = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, $AGG(v)]));
flow.invariant('identity', $IDENTITY($PARTS, report), {});
flow.guard('quorum', $PARTS.filter(p => p.ok !== false).length >= $QUORUM * $PARTS.length, {});
flow.done(report);
```

Checklist:
- **A conservation identity in minor units.** W-bed R3: Σ adjusted = ledger difference.
- **Behaviour on a failed branch** is a quorum, not a silent skip. Mined `kw default 2` and `kw retry 5`, for example
  `gitlab-ci:…Auto-DevOps`, `gitlab-ci:…Jobs/Deploy`.
- **The reduce is code.** A model-written summary of totals is refused.

Mined from: `n8n:12472`, `gitlab-ci:…Jobs/Deploy.gitlab-ci.yml`, `galaxy:workflowhub/251`.

### P16 dedupe by identity (blocking + pairwise judge + union-find) (fan) — 18 items, 7 platforms (support-only) [M-c]

When to use:
- J1 (noul): "Can the same real-world entity appear more than once with different spellings or ids?"
- J2 (choice): "How can duplicates be recognised?" Options:
  - `exact-key`: an exact key exists, which makes it L0:step;
  - `fuzzy`: similar names or addresses;
  - `needs-reading`: the text has to be read;
  - `none`: no duplicates possible.

```js
// P16 slots: ROWS, BLOCK (fn:pure row -> key[]), SIM (fn:pure a,b -> 0..1), BAND ([lo,hi]), SAME (judge on a pair)
const pairs = candidatePairs($ROWS, $BLOCK);                       // code: blocking keeps it O(n * block)
const sure = pairs.filter(p => $SIM(p.a, p.b) >= $BAND[1]);
const band = pairs.filter(p => $SIM(p.a, p.b) >= $BAND[0] && $SIM(p.a, p.b) < $BAND[1]);
const judged = await flow.map(band, p => flow.judge('same-entity', $SAME(p)), { concurrency: 4 });
const clusters = unionFind($ROWS, [...sure, ...band.filter((p, i) => judged[i].same === 'same')]);
band.forEach((p, i) => judged[i].same === 'unsure' && flow.flag('weak-merge', { a: p.a.id, b: p.b.id }));
flow.invariant('rows-conserved', clusters.flat().length === $ROWS.length, {});
```

Checklist:
- **A borderline band goes to a judge.** FRONTIER-GAPS N4: the R1 error locus had no judge [M].
- **Transitivity:** union-find, not pairwise output.
- **Rows are conserved.**
- **Large inputs need a blocking key.**

Corpus support is small and keyword-detected. Science de-duplication tools are excluded. The pattern is
justified mostly by the W-bed records domain [M]. Examples: `google-adk:…on-brand-genmedia`,
`dspy:…multihop-pot`, `dagster:snowflake_cortex`.

### P17 reconcile two sources (join, diff, classify discrepancies) (fan) — 147 items, 23 platforms (support-only) [M-c]

When to use:
- J1 (noul): "Must two record sets that describe the same things be matched and their differences explained?"
- J2 (choice): "How do records match?" Options:
  - `shared-id`: by a shared id;
  - `fuzzy-fields`: by fuzzy fields (with P16);
  - `amounts-and-dates`: by amounts and dates;
  - `none`: nothing to match.

```js
// P17 slots: LEFT, RIGHT (paths), MATCH (fn:pure), REASONS (enum[] incl. 'unexplained'), EXPLAIN (judge), ADJUST (fn:pure)
const { matched, onlyLeft, onlyRight } = flow.step('match', () => $MATCH($LEFT(task), $RIGHT(task)));
const diffs = [...onlyLeft, ...onlyRight, ...matched.filter(m => m.delta !== 0)];
const why = await flow.map(diffs, d => flow.judge('reason', { ...$EXPLAIN(d),
  schema: { reason: { enum: $REASONS }, quote: 'string' } }), { concurrency: 8 });
const adjusted = flow.step('adjust', () => $ADJUST(matched, diffs, why));
flow.invariant('explains-difference', sumMinor(adjusted) === sumMinor($LEFT(task)) - sumMinor($RIGHT(task)), {});
```

Checklist:
- **`unexplained` is always a reason.**
- **The difference identity holds exactly.**
- **Timing and FX reasons need the dates and quotes in the judge state.**
- **A duplicate on one side** goes to P16 first.

The detector is keyword-based ("reconcile", "match", "diff"). Precision is unmeasured, and examples such as
`mastra:…support-supervisor` are weak matches [I]. W-bed R1 and R3 are the real anchors.

### P20 generate → verify → retry (bounded) (loop) — 144 items, 28 platforms, 30 oracle-bearing [M-c]

When to use:
- J1 (noul): "Is there a check that code (or a separate verifier) can run on a generated result, so that a failed
  result can be regenerated?"
- J2 (choice): "What verifies the result?" Options:
  - `code`: a code check;
  - `tool-run`: running it (tests or a compiler);
  - `judge`: a separate judge;
  - `none`: nothing can verify it.

```js
// P20 slots: GEN (judge), VERIFY (fn:pure -> null | problem), MAX_TRIES (int[1,4]), FEEDBACK (bool), ON_FAIL ('deopt' | 'review')
let out, problem = 'not-run';
for (let i = 0; i < $MAX_TRIES && problem; i++) {
  out = await flow.judge(`gen#${i}`, $GEN($FEEDBACK && i ? problem : null));
  problem = $VERIFY(out);
  if (problem) flow.note('verify-failed', { i, problem });
}
flow.guard('verified', !problem || $ON_FAIL === 'review', { problem });
```

Checklist:
- **The verifier gates.** VERIFY_NOT_GATING lint.
- **The retry cap is a literal.**
- **The problem is fed back as data**, never as instructions.
- **Defaults on exhaustion are explicit** `kw default 35`, for example `dify:mkt-22fd4d00…`.
- **State across tries is local** `kw state 58`, for example `activepieces:WSuSdjnA1rdJmIkfisphJ`.
- **Schema validation is the cheapest verifier** `kw validate 42`, for example `flowise:agentflowsv2-agentic-rag`.
- **A judge verifying its own family is not independent** (independence README: φ 0.61–0.82) [M]. Prefer a code
  verifier; use P49 when only judges exist.

Mined from: `langgraph:memory-agent`, `pydantic-graph:…genai_email_feedback`, `strands:…graph_loops_example`.

### P54 decompose into called sub-workflows (call by hash) (compose) — 221 items, 21 platforms [M-c]

When to use:
- J1 (noul): "Is part of this task a self-contained job with its own inputs and outputs that has been solved before,
  or could be solved once and reused?"
- J2 (choice, over the L2/L4 candidate list): "Which stored component does the sub-job match?" Options:
  - `<hash₁…hashₖ>`: one of the stored components;
  - `none-matches`: no stored component fits.

```js
// P54 slots: PARTS (fn:pure task -> [{key, input}]), REF (hash, from the candidate list only), CHILD_BUDGET (usd),
//            ON_REFUSE ('deopt' | 'value'), COMBINE (fn:pure)
const kids = await flow.map($PARTS(task), p => flow.call($REF, p.input,
  { name: `child:${p.key}`, budgetUsd: $CHILD_BUDGET, timeoutMs: 300000, onDeopt: 'value', onRefuse: $ON_REFUSE }), { concurrency: 3 });
kids.forEach((k, i) => k?.refused && flow.flag('child-refused', { key: $PARTS(task)[i].key, why: k.refused }));
flow.done($COMBINE(kids));
```

Checklist:
- **Refusals are typed.** `outside-profile` (wrong-reuse prevention), `depth`, `effects` and `BUDGET_TOO_SMALL` all
  come from `call-host.mjs`.
- **Cancellation propagates to children** `kw cancel 39`, for example `airflow:…openlineage_trigger_dag_deferrable`.
- **A child's effects stay in the envelope.** `effects:'none'` is enforced.
- **Delay between children** is a binding concern `kw backoff 14`, for example `node-red:5203cdf1…`.
- **No hash on its own ancestor chain.**

Mined from: `airflow:…openlineage_trigger_dag_deferrable`, `temporal:samples-go/pso`, `coze:copy-to-app-main`.

## 5. The rest of the catalog (compact cards)

Each row lists:
- the skeleton in L0 terms;
- its slots;
- the J1 question, in noul form; every pattern also has a J2 choice question with a `none` option, generated
  from its slot enum;
- the checklist with mined sources.

Envelope patterns (E) need engine nodes that are not built (L0 status **N**). Until those exist, the constructor
emits the solver part and a *proposed* envelope.

| id | pattern | support [M-c] | skeleton (L0) | key slots | J1 (noul) | checklist (mined) |
|---|---|---|---|---|---|---|
| P02 | fetch → transform → write | 348 / 25p (support-only) | E: effect(read) → solver(step…) → effect(write) | READ, TRANSFORM, WRITE, IDEMPOTENCY_KEY | "Does the task move data from one system to another with a transformation?" | idempotency key on the write; partial-failure resume via P42 cursor [I] |
| P04 | draft → check → deliver | 75 / 19p | judge(draft) → judge/step(check) → E: approve? → effect | DRAFT, CHECK, GATE (none / approve) | "Is generated text sent or published to someone?" | notify `kw 16` (`activepieces:S0tI31TsQZvtNg5BDH1Tq`); batch (`n8n:12120`) |
| P05 | prompt chain | 212 / 25p | judge → judge → … with typed hand-offs | STEPS[] (judge, out schema) | "Does the task need several model steps, each refining the previous step's typed output?" | state `kw 13`; default `kw 7` (`dify:mkt-1b5493cc…`); one decision per judge |
| P06 | retrieve → generate (untrusted context) | 172 / 26p | effect/step(retrieve, top-k) → judge(answer + cite) | INDEX (L3), K (int), ANSWER (judge with a quote check) | "Must the answer be grounded in documents fetched at run time?" | retrieved text is labelled untrusted; citation check; state `kw 63` (`activepieces:OZH5az2…`) |
| P10 | human menu dispatch | 108 / 13p | E: ask(enum) → if → branches (bounded repeat) | MENU (enum), BRANCHES, MAX_REPEAT | "Does a person pick one of several actions, possibly repeatedly?" | cancel option `kw 32` (`apple-shortcuts:icloud-6ba47bd9…`); pagination of long menus `kw 22` |
| P14 | scatter → parallel branches → gather | 102 / 20p | map over fixed branches → join | BRANCHES (2–8 fns or hashes), JOIN (fn) | "Are there several independent analyses of the same input to combine?" | lock / concurrency `kw 5` (`agno:…loop_with_parallel`); validate each branch `kw 6` |
| P18 | best-of-N / sectioning with a verifier | 225 / 35p (support-only) | map(N × judge) → code select / verify | N (int[2,5]), GEN, SCORE (fn or P49) | "Would generating several candidates and picking by a check beat one attempt?" | the selector must be code or an independent verifier (independence README) |
| P19 | planned fan-out (wide) / bounded expansion (plan) | 33 / 12p | wide(plan, check, worker, reduce, quorum) [D] | PLAN judge, CHECK, WORKER, REDUCE, MAX_FANOUT ≤ 32 | "Is the list of subtasks itself unknown until a model reads the input?" | the planner tier starts no lower than the workers; rewrite target for shared-scratchpad (6 items) |
| P21 | poll until ready | 120 / 9p | loop(≤ N){ effect(check) → wait.delay } → guard(timeout) | CHECK, READY (fn), EVERY_MS, TIMEOUT_MS | "Must the workflow wait for an external job to finish by checking it repeatedly?" | backoff `kw 36` (`node-red:01276f61…`); airflow sensor `poke_interval…timeout` [M-c summary]; batch `kw 26` (`n8n:11772`) |
| P22 | loop until condition / dry | 10 / 1p | for(≤ N){ step; if(cond) break } + invariant(progress) | COND (fn), MAX_ITERS, PROGRESS (fn) | "Must a step repeat until a measurable condition holds?" | **low support:** Home Assistant only (`EPMatt/…xiaomi_wxcjkg11lm`); kept because loops elsewhere fold into P20 and P21 |
| P23 | paginate with a cursor | **0** | E: loop{ effect(page, cursor) → state(cursor) } | PAGE_TOOL, CURSOR_PATH, MAX_PAGES | "Does a source return results in pages?" | **no corpus node support**; pagination appears only as an edge keyword (P10 22, P55 16, P08 1, P12 1). **Candidate: fold into the L3 binding as a pagination capability** |
| P25 | bounded state machine | 49 / 5p | for(≤ N){ switch(state) … } with an enum state | STATES (enum), TRANSITIONS (code table), MAX_STEPS | "Does the process move between named states, re-entering some?" | Node-RED / LangGraph cycles; the transition table is code, never model-chosen except by an enum judge |
| P26 | retry with backoff / adaptive retry | 96 / 4p | E: retry{on error class, escalate resources} | ATTEMPTS, BACKOFF, ON (error classes), ESCALATE | "Can a step fail transiently, or because it needs more resources?" | nf-core `errorStrategy` + memory escalation (`nf-core:neutronstar@1.0.0`, `nextflow:workflowhub/1871`); classify the error before retrying (airflow LLM error-class example [M-c]) |
| P27 | error route → notify / cleanup | 215 / 24p (108 oracle-bearing) | E: route.error → handler(notify, cleanup) | HANDLER, NOTIFY_BINDING, SCOPE | "Must failures be reported or cleaned up rather than just stopping?" | cancel `kw 19` (`n8n:11493`); continue-on-error `kw 10` (`github-actions:MODFLOW-ORG/modflow6`) |
| P28 | fallback on error (alternative path, rejoin) | 44 / 14p | E: route.error → alternative → join | ALT (fn / hash), FLAG_ON_USE | "Is there an acceptable alternative when the main path fails?" | fallback use is always flagged; silent fallback is refused; notify `kw 10` (`n8n:10143`) |
| P29 | finally / completion hook | 112 / 9p (89 oracle-bearing) | E: finally(teardown) | TEARDOWN, RUN_ON (all_done) | "Is there cleanup that must run however the workflow ends?" | Airflow teardown defaults to `all_done_setup_success` [W: airflow DAG docs]; Tekton `finally` (`tekton:…pipelinerun-with-final-results`); KFP exit handlers |
| P30 | saga: steps with compensation | **7, all false positives** | E: effect + compensate per step, reverse order | STEPS [{do, undo}] | "If a later step fails, must earlier completed actions be undone?" | **zero genuine corpus support** (hits are e.g. WDL `RevertSam`); kept as a candidate from Temporal docs; L0 `compensate` is **N** |
| P31 | checkpoint → resume / continue-as-new | 9 / 6p | E: checkpoint every N; continue-as-new on history size | EVERY, STATE_SCHEMA | "Is the run long enough that it must survive restarts?" | `temporal:samples-go/pso`; LangGraph time-travel |
| P32 | approval gate before an effect | 135 / 24p | E: approve(timeout → route) → effect | QUESTION, APPROVERS, TIMEOUT, ON_TIMEOUT | "Should a person approve before an irreversible action?" | approve / reject `kw 32` (`activepieces:71gZO0fN…`); cancel `kw 18` (`airflow:…openlineage_hitl_dag`, `gitlab-ci:…5-Minute-Production-App`) |
| P33 | wait for signal / external event | 108 / 6p | E: wait.signal(timeout) | SIGNAL, SCHEMA, TIMEOUT, ON_TIMEOUT | "Must the workflow pause until an outside event or reply arrives?" | timeout `kw 20` (`home-assistant:CCOSTAN/…announcements.yaml#0`); Temporal signals vs updates vs queries [W] |
| P34 | durable delay / debounce → re-check → act | 118 / 11p | E: wait.delay → solver(re-check) → effect | DELAY, RECHECK (fn), DEBOUNCE_KEY | "Should the action happen only if a condition still holds after a delay?" | delay `kw 79` (`activepieces:1TPst6qx7bNcQ2jV2ZZ61`); re-check is mandatory |
| P35 | interrupt → resume inside an agent node | 15 / 12p | agent [D] with a pause point → E: ask → resume | PAUSE_ON (tool list), RESUME_SCHEMA | "Must an agent stop for human input mid-task?" | `pydantic-graph:…deferred-tools`; requires `flow.agent` (D) |
| P36 | scheduled batch | 164 / 15p | E: trigger.schedule → solver → effect | CRON, TZ, CATCHUP, WINDOW | "Does the task run on a timetable over the data that arrived since the last run?" | validate `kw 22` (`dagster:airlift-migration-tutorial`); lock `kw 5`; Airflow LatestOnly / `depends_on_past` [W] |
| P37 | webhook → validate → act → respond | 282 / 18p | E: trigger.webhook(schema) → solver → effect → respond | SCHEMA, RESPOND, AUTH (env-var name) | "Is the workflow started by an incoming request that needs a reply?" | validate `kw 66` (`github-actions:DZakh/sury`); continue-on-error `kw 18`; timeout `kw 12` (`github-actions:Lightning-AI/…ci-pytorch_test-slow`) |
| P38 | event → guard → act (automation rule) | 252 / 19p | E: trigger.event → solver(guard) → effect | EVENT, CONDITION, ACTION | "Is the workflow a rule: when this happens, if that holds, do this?" | state `kw 70` (`activepieces:OZH5az2…`, `node-red:2e10a76f…`); notify `kw 52` |
| P39 | poll → diff → notify | 26 / 5p | E: trigger.poll → step(diff vs state cursor) → effect | SOURCE, KEY, CURSOR | "Must changes in an outside source be detected by comparing against the last check?" | `dagster:…modal_pipes`, `n8n:12858`; the cursor is P42 |
| P40 | run admission policy | 56 / 1p | E: admission(single / queue / restart / parallel) | MODE, MAX | "What should happen when a new run starts while one is still running?" | Home Assistant only (`mode:` field) |
| P41 | build → test → gate → release | 88 / 2p | E: trigger → stages → barrier → approve? → effect | STAGES, GATES, ENV | "Is this a CI/CD pipeline?" | retry `kw 5` (`gitlab-ci:…dependabot`); cancel `kw 8`. **Two platforms only (GitHub Actions, GitLab):** a candidate to keep as an L4 family rather than an L1 pattern |
| P42 | cross-run state: seen-set / cursor / counter | 157 / 19p (token) | E: state(type, ttl, one writer) | KIND, KEY, TTL, WRITER | "Must the workflow remember something between runs?" | one writer per key (composition checker); TTL required |
| P43 | conversational session | 104 / 15p | E: session(memory cap) → solver(turn) | MEMORY (maxTurns, summarise), TURN | "Is each run one turn of a continuing conversation?" | memory is capped; summarisation is P51 |
| P44 | bounded stream consumer / partial outputs | 39 / 8p | E: stream(batch, maxInFlight) → solver | BATCH, MAX_IN_FLIGHT | "Does input arrive as a continuous stream?" | Node-RED topics; back pressure |
| P45 | capped tool loop (agent node + parent-side verify) | 209 / 26p | agent [D]{tools ≤ 5, budget} → verify(code) | INSTR, TOOLS, RETURNS, VERIFY, BUDGET | "Must a model use tools in an open-ended loop to finish part of the task?" | state / memory `kw 116`, cache `kw 66` (`flowise:chatflows-conversational-agent`); verify is required (FLOW-V3 §2.2) |
| P46 | supervisor → agents as typed tools | 52 / 13p | judge(route) → call / agent(child, typed) → loop ≤ N | CHILDREN (hashes + contracts), ROUTER judge, MAX_TURNS | "Must a coordinator delegate subtasks to specialised workers and combine them?" | rewrite target for group chat and handoff refusals; lock `kw 6` (`agno:…research_sweep`) |
| P47 | model-written code in a sandbox → run → check | 41 / 17p | agent [D] (writes code) → effect(sandbox run) → verify | LANG, SANDBOX, TESTS | "Is the most reliable route for the model to write and run code?" | outputs are tainted data; tests come from the caller, not the model |
| P48 | guardrail tripwire (parallel check aborts) | 6 / 4p | map[main, check] → guard(check) aborts | CHECK (judge / fn), ABORT_ON | "Must output be blocked if a parallel safety check trips?" | **low support** (OpenAI Agents guardrails, strands steering) |
| P49 | verify panel (independent verifiers vote) | 8 / 7p (support-only) | map(n × judge, different families) → vote | N, FAMILIES, QUORUM | "Is a single verifier's judgement not trustworthy enough?" | **low support**; Jev, Haiku and Sonnet share errors (φ 0.61–0.82, 36 of 40 same wrong option) [M]; panel independence must be measured, not assumed |
| P50 | evidence → hypothesis → check / env session | 12 / 10p (mostly support) | loop ≤ N{ step(gather) → judge(hypothesis) → step(test) } | GATHER, HYPOTHESISE, TEST, MAX | "Must the task diagnose a cause by forming and testing hypotheses?" | THESIS §6 "diagnosis before repair" |
| P51 | summarise-map-reduce / context compaction | 47 / 22p | map(chunk → judge summary) → judge(reduce) + invariant(coverage) | CHUNK, MAP_SUMMARY, REDUCE | "Is the input too long for one read and needs condensing?" | `haystack:…summarization-compaction`; every chunk id appears in the reduce |
| P53 | sub-workflow per item | 53 / 20p | map(items → call(hash)) | REF, ITEMS, CHILD_BUDGET | "Must a whole stored sub-workflow run once per item?" | cancel `kw 9`; batch `kw 6` (`n8n:12533`) |
| P55 | ask → validate → use | 91 / 15p | E: ask(schema) → step(validate) → if invalid re-ask (≤ N) | QUESTION, SCHEMA, MAX_ASKS | "Must the workflow ask a person for a value before continuing?" | the answer is untrusted data; pagination `kw 16` (`flowise:agentflowsv2-human-in-the-loop`) |
| P56 | media generation chain | 68 / 2p | effect(model tool) → step → effect … (L3 bindings) | TOOLS, PARAMS | "Is the task generating or editing images, audio or video?" | ComfyUI; batch `kw 21`; mostly L3 work |
| P57 | caller-supplied action list (typed plan fragment) | 20 / 2p | plan [D] over an action enum, from the caller | ACTIONS (enum), MAX | "Does the caller pass the list of actions to perform as input?" | Home Assistant blueprints and DSPy ToolHop; the list is checked like `flow.plan` |

**Numbering.** P11, P24 and P52 were never assigned; they are gaps in the draft numbering. Ids are never reused.

## 6. Candidates with low or no support (marked; not first-class until evidence)

| id | support | decision |
|---|---|---|
| P23 paginate | 0 nodes | Fold into the L3 binding as `pagination: {cursorPath, maxPages}`. Drop from L1 unless LIBRARY-TESTS L1 finds it in the oracle subset |
| P30 saga | 0 genuine | Keep as a candidate. It needs L0 `compensate` (N). The owner's W-bed R7 is parked |
| P22 loop-until | 10 items, 1 platform | Keep. It is the only bounded-convergence skeleton, and P20 and P21 cover the rest |
| P48 tripwire | 6 / 4 platforms | Keep as a candidate. The agentic slice is small |
| P49 verify panel | 8 / 7 platforms | Keep, with the independence caveat in the card |
| P40, P41, P56 | 1–2 platforms each | Platform-specific. Candidates for L4 families or L3 bindings, not L1 |

**Counting the honest catalog** [M-c, recomputed from `out/pattern-census-items.jsonl`]. Dropping the two
zero-support patterns (P23, P30) changes nothing: the ceiling stays at 97.8%, and 90% is still reached at k = 37 with
45 effective patterns. Dropping the three platform-specific patterns as well (P40, P41, P56) lowers the ceiling to
**88.0%**, because those items then have no owner. So P40, P41 and P56 stay in L1 until an L3 binding or L4 family is
shown to take over their items. The coverage claim uses the catalog as it stands: 47 patterns used, 90% at 37.

## 7. Composition and buildability matrix (all 54 entries)

Every pattern is a composition of L0 constructs; numbers refer to the rows of `L0-VOCABULARY.md`. **Tier** says what
must exist before the constructor may emit the pattern as runnable code:
- **S**: solver only, on flow-v2/v3 as built (L0 rows 1–11). Arm (g) on W-bed can use these today.
- **IR**: needs an envelope node that today's engine IR runs (rows 15–18, 20 fixed, 21–22 partial).
- **HOST**: the trigger is owned by the host harness (cron, webhook server, event bus) and reaches Foundry as a call
  with an input (HARNESS-INTEGRATION §1); Foundry builds only the solver behind it [I: an adoption choice, not built].
- **D**: needs a flow-v3 primitive that is designed but not built (rows 12–14).
- **N**: needs an engine node that is not built (rows 19, 20 adaptive, 23–30).

Rung = the first W-bed rung (W-BED §3) whose reference workflow exercises the pattern; "—" = no rung.

| id | L0 constructs composed (rows) | tier | rung | note |
|---|---|---|---|---|
| P01 | 1, 2, 3, 5, 9 (11 for stages > 8) | S | R1 | spine of every rung |
| P02 | 15 read → 2 → 15 write (27 for resume) | IR | — | idempotency key on the write is an L3 binding field |
| P03 | 1, 2, 3, 4, 5, 6 | S | R1 | conventions-once (review-05 §3.3) is its special case |
| P04 | 3 → 2 / 3 → (16) → 15 | S + IR | R0 (draft only) | delivery is an effect; the solver returns the draft |
| P05 | 3 × n, 5 | S | R2 | one decision per judge |
| P06 | 2 (or 15 retrieve) → 3 with quote check | S / IR | — | retrieval tool is L3 |
| P07 | 6, 3, 10, 11 | S | R2 | |
| P08 | 2, 8, 4, 5 | S | R2, R3 | |
| P09 | 6, 3 (samples ≥ 3), 7 | S | R2 | `flow.flagged` accessor proposed (L0 changes note) |
| P10 | 17, 10 | IR | — | |
| P12 | 4, 6, 5, 9 | S | R3 | |
| P13 | 6, 3, 5 | S | R1, R3 | |
| P14 | 6 over fixed branches, 10 (join) | S | R3 | |
| P15 | 2, 5, 4, 9 | S | R3 | |
| P16 | 2, 6, 3, 7, 5 | S | R1 | |
| P17 | 2, 6, 3, 5 | S | R1, R3 | |
| P18 | 6, 3, 2 | S | R6 | selector must be code |
| P19 | 13 / 14 | D | R6 | |
| P20 | 10 (bounded for), 3, 2, 4 | S | R1–R3 | |
| P21 | 10, 15, 18, 4 | IR (≤ 1 h) / N | R7 (parked) | durable wait beyond 1 h is N |
| P22 | 10, 2, 5 | S | — | |
| P23 | 15 + 27 | N | — | fold into the L3 binding (§6) |
| P25 | 10, 3 (enum) | S | — | transition table is code |
| P26 | 20 | IR (fixed) / N (adaptive) | R8 f2 | |
| P27 | 21, 15 | IR partial | R8 | dedicated error edge is N |
| P28 | 21, alternative, 7 | IR partial | R8 | |
| P29 | 22 | IR partial / N | — | true always-run is N |
| P30 | 15 + 23 | N | R7 (parked) | zero genuine support |
| P31 | 11 idempotency memo (child-granular resume) / 27 | S partial / N | R4 | `call-host.mjs` memo already serves a repeated child at $0 |
| P32 | 16, 15 | IR | R7 (parked) | timeout routing is N |
| P33 | 19 | N | R7 (parked) | |
| P34 | 18, 2, 15 | IR (≤ 1 h) / N | — | |
| P35 | 12, 17 | D + IR | R5 | |
| P36 | 25 → solver → 15 | HOST | — | |
| P37 | 24 → solver → 15 | HOST | — | |
| P38 | 26 → solver → 15 | HOST | — | |
| P39 | 26, 27 | N | — | the cursor is P42 |
| P40 | 28 | N | — | |
| P41 | 15, 16, 10 | IR | — | L4 family candidate |
| P42 | 27 | N | — | |
| P43 | 29 | N | — | |
| P44 | 30 | N | — | |
| P45 | 12 | D | R5 | |
| P46 | 3, 11 (12 for agent children), 10 | S (D with agents) | R4, R5 | |
| P47 | 12, 15 (sandbox) | D | R5 | |
| P48 | 6, 4 | S | — | |
| P49 | 6, 3 (several tiers), 2 (vote) | S | R6 | independence unmeasured |
| P50 | 10, 2, 3 | S | — | |
| P51 | 6, 3, 3, 5 | S | — | |
| P53 | 6, 11 | S | R4 | |
| P54 | 11 | S | R4 | |
| P55 | 17, 2, 10 | IR | — | |
| P56 | 15 chain | IR | — | mostly L3 |
| P57 | 14 | D | — | |

**What can be built now, as a number** [M-c, `tools/render-evidence.mjs`, table in `out/pattern-evidence.md`]. An
item is buildable at a tier if every L1 pattern it needs is at that tier or below:

| tier (cumulative) | items | share of 1,559 |
|---|---|---|
| S: solver on flow-v2/v3 today | 419 | 26.9% |
| + IR: engine envelope today | 755 | 48.4% |
| + HOST: host-owned triggers | 1,022 | 65.6% |
| + D: designed flow-v3 (`agent`, `wide`, `plan`) | 1,150 | 73.8% |
| + N: unbuilt engine nodes | 1,524 | 97.8% |

The 97.8% ceiling of §0 is reached only with engine nodes that do not exist. The single most valuable unbuilt node is
**`state`** (P42 blocks 157 items), then `wait.signal` (P33, 108) and `session` (P43, 104); `admission` (P40, 56) and
`stream` (P44, 39) follow. This is the input to BUILD-ORDER's engine column. W-bed arm (g) needs only tier S, which is
why the first slice (§4) is all S.

## 8. Evidence record per pattern

The per-pattern evidence table (grade, node / token / idiom support, oracle-bearing count, platforms, top mined edge
keywords with their share of the pattern's items, companion patterns by lift, two example items) is generated, not hand
copied: `out/pattern-evidence.md`, from `tools/render-evidence.mjs` [M-c]. The grade is a rule:

| grade | rule | patterns |
|---|---|---|
| A | ≥ 50 items detected by a control node or verdict token, on ≥ 10 platforms | 24: P03–P08, P10, P12–P14, P20, P27, P32, P34, P36–P38, P42, P43, P45, P46, P53–P55 |
| B | ≥ 15 detected items, on ≥ 4 platforms | 14: P09, P15, P19, P21, P25, P26, P28, P29, P33, P35, P39, P44, P47, P51 |
| C | detected below B, or support-only (keyword / shape detector, precision unmeasured) | 14: P01, P02, P16, P17, P18, P22, P31, P40, P41, P48, P49, P50, P56, P57 |
| D | zero genuine support | 2: P23, P30 |

Three things the table shows that the cards above do not:
- **Companions are the retrieval prior.** Patterns that the same items need together, by lift: P10 → P55 (×10.5, 68
  items) and P32 (×7.1); P27 → P29 (×6.3, 99 items) and P26 (×5.0); P45 → P46 (×7.2, 51 items); P03 → P05 (×5.1);
  P07 → P09 (×5.1) and P20 (×4.0). LIBRARY.md §4.3 uses these as the "expand together" hint: when the ranker picks
  one, its top companion is offered as the next candidate rather than retrieved from scratch.
- **Edge keywords concentrate where effects and agents are.** P45 (state 56%, cache 32%), P34 (backoff 67%), P10
  (notify 53%, cancel 30%), P20 (state 40%, validate 29%). Patterns in science DAGs carry almost none, consistent with §2.4.
- **The grade is not the oracle count.** P09 is grade B with 0 oracle-bearing items, P26 is B with 90. LIBRARY-TESTS L1
  draws its executable sample by oracle-bearing items, so P09's checklist is untested by the corpus and is tested on
  W-bed R2 instead.

The keyword classes are coarse regexes (`EDGE_KW` in `tools/pattern-census.mjs`; for example `else` counts as
"default / fallback" and `check` as "validate"). A keyword count says *a corpus author wrote about this edge*, not that
the item handles it. Checklist lines therefore cite items, and the hand audit (LIBRARY-TESTS L1) samples them.

## 9. The universal checklist (applies to every pattern; the composition checker enforces it)

These come up under so many patterns that they are not repeated per card. Each has a code the composition checker
(LIBRARY.md §6) emits; codes marked *review-05* are the construction lint proposals of
`research/review-20261007/05-router-constructor.md` §3.6.

| code | rule | mined from / why |
|---|---|---|
| `JUDGE_NO_CHECK` | a judge whose answer cites the input has a code `check` (quote present, id echoed) | P03, P07, P13 cards; FRONTIER-GAPS S1: no check fired on ≥ 21 wrong compiled outputs [M] |
| `ENUM_NO_NONE` | every judged enum has a no-match / undecidable member | P07 `kw default 32`; J1 negative results 1–2: options that are never chosen [M] |
| `BRANCH_ON_TEXT` | control flow reads a model answer only through an enum | PRINCIPLES P9; THESIS P9 |
| `UNBOUNDED` | every loop, retry, map, wait and fan-out has a literal cap | L0 refusals; P20, P21, P22 cards |
| `VERIFY_NOT_GATING` *review-05* | the pattern's verifier or invariant gates the output | O4: 7 of 7 F artifacts had existence-only acceptance [M] |
| `NO_CONSERVATION` | a pattern that transforms a collection carries a count or sum invariant | P01, P08, P12, P15, P16, P17 |
| `SILENT_DROP` | dropped, defaulted or fallen-back items are reported with a reason code or a flag | review-02 §5 must-not-allow list; P08, P28 |
| `EFFECT_IN_SOLVER` | no effect inside a solver; effects are returned as an effect plan for the envelope | FRONTIER-GAPS H2 option 2 [M]; W-BED §3.7 |
| `MAP_NO_ECHO_CHECK` *review-05* | a judge inside a map echoes the item id | P12, P13 |
| `REASONING_ON_EXTRACTION` *review-05* | no chain-of-thought field in an extraction schema | RESEARCH.md:112 (thinking made Haiku worse on extraction) [M] |
| `ONE_WRITER` | each state key, file or effect target has exactly one writer in the composed tree | P07, P42; THESIS P8 |
| `CREDENTIAL_LITERAL` | credentials only as env-var names through an L3 binding | L0 refusals; owner rule |

## 10. Status of this catalog

Complete as a first catalog: 54 entries, 12 full cards (§4), 42 compact cards (§5), low-support candidates marked (§6),
composition and tier per pattern (§7), evidence per pattern (§8). Not done, and owned by LIBRARY-TESTS:
- the 60-item hand audit of the census rules (L1-a);
- keyword precision for the support-only detectors (P01, P02, P16, P17, P18, P49; L1-a);
- full cards (slot tables, three fixtures each) for the 42 compact entries. They are written when a rung or a user task
  first retrieves the pattern, not in advance (BUILD-ORDER §2: a card nobody retrieves is the utility problem in
  miniature);
- executable coverage on the 438 oracle-bearing items (L1-b).
