# Automation cluster: acquisition ledger

*Retrieved 2026-10-06. Cluster scope: low-code automation and agentic-LLM app builders (n8n, Zapier,
Make, Node-RED, Activepieces, Pipedream, Dify, Coze, Flowise, Langflow). Development/diagnostic corpus.
None of it is sealed evaluation evidence.*

Output: `parts/automation.jsonl` has 396 `foundry-corpus-item/1` records. 111 are redistributable
(MIT, Apache-2.0 or the Dify licence). 285 are not (unknown licence or terms of service). For those
285, only the URL, title, derived graph and features are kept. Raw copies live only under
`/opt/corpus/{n8n,node-red,dify,activepieces,zapier,langflow,flowise,coze,automation-misc}` (about
110 MB in total) and are never committed. All corpus content was treated as untrusted data. It was
parsed as JSON or YAML only and never executed, and no instruction found inside it was followed.

## Reproduce

```
cd research/corpus-20261006/scripts
python3 -I automation-fetch-n8n.py search && python3 -I automation-fetch-n8n.py select && python3 -I automation-fetch-n8n.py details
python3 -I automation-fetch-nodered.py
python3 -I automation-fetch-activepieces.py
python3 -I automation-fetch-dify.py "$(git ls-remote https://github.com/langgenius/dify HEAD | cut -f1)"   # pinned run used 519ef8b8…
python3 -I automation-fetch-zapier.py 160
python3 -I automation-fetch-git.py --pin          # langflow / flowise / coze-studio sparse shallow clones at the SHAs below
python3 -I automation-normalize.py                 # -> ../parts/automation.jsonl (deterministic; strata -> /opt/corpus/automation-misc/strata.json)
```

The API sources (n8n, Node-RED, Activepieces, Dify marketplace, Zapier) are live services. A re-run
on a later date will see different template sets. Each item's `source.revision` records the template
id, its timestamp and a sha256 prefix of the raw response actually used.

## Sources tried

| # | Source | URL / revision | Licence and evidence | Outcome | Redistributable |
|---|---|---|---|---|---|
| 1 | n8n template library API | `https://api.n8n.io/api/templates/search?rows=250&page=1..53&sort=createdAt:desc`; details `…/api/templates/workflows/{id}`; per-item revision = template id + createdAt + sha256 | `ToS:https://n8n.io/legal/self-serve-terms/`. The API has no licence field. The templates are creator-submitted and n8n.io/legal (fetched 2026-10-06) has no open licence for them. | **acquired**: 13,054 templates indexed (11,748 free, 1,306 paid and skipped). 599 candidate details fetched: 594 ok, 4 returned 404 (ids 6315, 6281, 6455, 8986). **135 normalized** | no (graph and features only, synthetic node ids, written descriptions) |
| 2 | Node-RED flow library | `https://flows.nodered.org/things?format=json&type=flow&per_page=100&page=1..32` (the listing embeds each flow's JSON); revision = gist id + updated_at + sha256 | `unknown`. Each entry is a GitHub gist with no licence field. Site terms: https://terms-of-use.openjsf.org | **acquired** 3,129 flows. **45 normalized** | no |
| 3 | Activepieces official templates | `https://cloud.activepieces.com/api/v1/templates` (all 420 in one response, `next:null`); `/api/v1/flow-templates` returned 404 | `ToS:https://www.activepieces.com/terms`. The repo code is MIT, but the templates are served cloud content with no licence field. | **acquired** 420 (all `OFFICIAL`, `PUBLISHED`). **40 normalized** | no |
| 4 | Dify marketplace templates | `https://marketplace.dify.ai/api/v1/templates?page=N&page_size=100` + `/api/v1/templates/{id}/dsl` | `ToS:https://marketplace.dify.ai/terms`. Publisher-submitted with no per-template licence. The listing includes creator e-mail addresses, which stay in /opt and are not copied into git. | **acquired** 329 listed, 329 DSLs. 267 are graph apps (144 workflow, 123 advanced-chat). 62 skipped as non-graph modes (27 chat, 26 agent-chat, 9 completion). **40 normalized** | no |
| 5 | Dify built-in recommended apps | `raw.githubusercontent.com/langgenius/dify/519ef8b8c2d75f597b8a1dfff79ef4b8c5013e3e/api/constants/recommended_apps.json` (+ LICENSE); SHA from `git ls-remote` | `LicenseRef-Dify-Open-Source-License`, read from LICENSE at that SHA. It is a modified Apache-2.0 whose extra conditions cover multi-tenant hosting and frontend branding, not redistribution. | **acquired** 22 apps, of which 11 are workflow or advanced-chat. **11 normalized** (all). 11 skipped (6 chat, 3 agent-chat, 2 completion). | yes |
| 6 | Langflow starter projects | `github.com/langflow-ai/langflow` @ `504c02fc47e76087b82b0e7cbe4186e9cdd916d4` (2026-10-06T11:46:57-07:00), `src/backend/base/langflow/initial_setup/starter_projects/` | `MIT` (LICENSE at that SHA) | **acquired** 27 JSON flows + 9 `.py` graph definitions. **27 normalized**. The `.py` graphs were not parsed. | yes |
| 7 | Flowise marketplace | `github.com/FlowiseAI/Flowise` @ `9291856d1ea4a4ceea9f8fef8ce14f4f6c81e8eb` (2026-08-13), `packages/server/marketplaces/` | `Apache-2.0` per LICENSE.md. The commercial licence covers only `packages/server/src/enterprise`, and `marketplaces/` is outside it. | **acquired** 24 chatflows, 14 agentflows and 13 agentflowsv2 (**51 normalized**, all). The 13 `tools/` entries are single tools, not workflows, and were skipped. | yes |
| 8 | Coze Studio canvas fixtures | `github.com/coze-dev/coze-studio` @ `fefb05ff27be1da939612fbf9faf5db62583b8ae` (2026-07-29), `backend/domain/workflow/internal/canvas/examples/` + `entity/node_meta.go` (node-type map) | `Apache-2.0` (LICENSE-APACHE) | **acquired** 102 fixtures. `validate/` and `get_canvas/` were excluded as invalid-by-design. **22 normalized** (the most complex). These are upstream **test fixtures, not user workflows**. | yes |
| 9 | Zapier public templates (pages) | Sitemap `https://zapier.com/sitemaps/templates/Xf3Lk9YbRzQnmgP2eCJtA5Wxv0NdMu6T/items?page=1..3` (3,000 `/templates/details/` URLs). Seeded sample of 160 pages fetched at 1 req/s. Each page embeds a ZSL/ZDL document. | `ToS:https://zapier.com/legal/terms-of-service`. No licence is granted. robots.txt (2026-10-06) allows `Claude-User`/`ClaudeBot` on `/` and declares `Content-Signal: ai-train=yes, search=yes, ai-input=yes`. | **acquired** 160 pages, 145 with a parseable ZSL. **25 normalized** | no |
| 10 | Zapier Zap Templates API | `https://api.zapier.com/v1/zap-templates` → 401; `https://zapier.com/api/v4/zap-templates/` → 404 | Partner `client_id` required; `/api/` is disallowed in robots.txt | **blocked** (auth). Item 9 was used instead. | n/a |
| 11 | Make (Integromat) templates | `https://www.make.com/en/templates` → 403 Cloudflare JS challenge ("Just a moment…"); `https://www.make.com/api/templates`, `https://eu1.make.com/api/v2/templates/public`, `https://us1.make.com/api/v2/templates/public` → 401; the terms page is also 403 | Not readable | **blocked** (bot challenge plus API token). The challenge was not circumvented. | n/a |
| 12 | Pipedream | `https://pipedream.com/templates` and `/explore` are SPA shells with no machine-readable template data; `https://api.pipedream.com/v1/templates` → 404 | n/a | **not found**. The PipedreamHQ/pipedream component registry holds single actions and sources, not workflows, and was not acquired. | n/a |
| 13 | Coze.com template store | `https://www.coze.com/api/marketplace/product/list` → 84-byte error body; `https://www.coze.com/template` is an SPA shell | Coze ToS, login-gated | **not acquired**. Open-source Coze Studio fixtures (item 8) were used instead. | n/a |
| 14 | HF dataset `arkelai/n8n-workflows-2k` | `huggingface.co/datasets/arkelai/n8n-workflows-2k` @ `a0e585b8b8818e631a1f37b6ad96d60b3ad16a93` | Card claims Apache-2.0 but states no provenance | **not acquired**: licence claim unverifiable. The content is very likely re-hosted n8n.io templates by third-party creators. Superseded by item 1. | n/a |
| 15 | HF dataset `npv2k1/n8n-workflow` | @ `a7e35863a74cd07186c7b7138dcb2b67c9c63d4f` | Card claims MIT, no provenance | **not acquired** (same reason as 14) | n/a |
| 16 | HF dataset `ruh-ai/n8n-workflow-dataset` | @ `f61ce146dad2e7d4ac92c40b23feae06519137cf` | Card claims Apache-2.0, no provenance | **not acquired** (same reason as 14) | n/a |
| 17 | HF Node-RED / Langflow / Flowise uploads (`Geyanth08/*node_red*`, `convsync/langflow-*`, `*/Flowise`) | HF search 2026-10-06 | Most have no licence tag; they are personal uploads | **not acquired**: unknown licence, tiny or derivative, and the primary sources were reachable | n/a |
| 18 | GitHub REST API | `https://api.github.com/repos/langgenius/dify` → 403 (egress proxy) | n/a | **blocked (host policy)**. `git ls-remote`, sparse shallow clones and raw.githubusercontent.com worked and were used instead. | n/a |
| — | GitHub community n8n dumps (e.g. Zie619/n8n-workflows) | — | — | **not tried**: same provenance problem as 14–16, and item 1 is the primary source | n/a |

## Selection (strata)

Strata ids are listed in `/opt/corpus/automation-misc/strata.json`.

- **complex (220 items)**: within each platform, the top items by a complexity score. The score is
  nodes + 2·branching + 3·loops + 4·human + 2·subworkflows + 2·|async| + 1.5·|connectors|, plus a
  bonus for error branches, code, model calls and mixed non-linearity. Near-duplicates are removed by
  node-type multiset.
  - n8n candidates came from three pools. The 450 templates with the most distinct node types. A
    seeded uniform sample of 160. The 25 richest templates for each of 8 niche node types (wait,
    errorTrigger, executeWorkflow, splitInBatches, form, stopAndError, toolWorkflow, compareDatasets).
  - n8n 95, Node-RED 32, Activepieces 27, Dify marketplace 27, Zapier 17, Coze 22.
- **representative (87 items)**: seeded uniform samples (seed 20261006).
  - n8n 40 from the uniform pool. Node-RED 13, Activepieces 13, Dify 13, Zapier 8.
- **all-licensed (89 items)**: every redistributable workflow: Langflow 27, Flowise 51, Dify repo 11.

Graphs with fewer than 2 nodes or no edges were excluded before selection.

## Results

| platform | items | median nodes | max nodes | branching>0 | loops>0 | human>0 | subwf>0 | model calls | code | verdict native / via-ext / unsupported |
|---|---|---|---|---|---|---|---|---|---|---|
| n8n | 135 | 48 | 306 | 112 | 60 | 18 | 28 | 114 | 99 | 7 / 128 / 0 |
| node-red | 45 | 150 | 421 | 35 | 19 | 0 | 7 | 0 | 40 | 2 / 41 / 2 |
| activepieces | 40 | 14.5 | 30 | 27 | 26 | 7 | 1 | 32 | 12 | 0 / 40 / 0 |
| dify | 51 | 22 | 89 | 40 | 21 | 5 | 0 | 46 | 35 | 17 / 34 / 0 |
| langflow | 27 | 5 | 8 | 1 | 1 | 0 | 0 | 26 | 0 | 4 / 23 / 0 |
| flowise | 51 | 5 | 19 | 14 | 11 | 1 | 0 | 51 | 3 | 16 / 35 / 0 |
| coze | 22 | 5 | 9 | 11 | 7 | 7 | 6 | 6 | 5 | 16 / 6 / 0 |
| zapier | 25 | 21 | 56 | 20 | 2 | 0 | 3 | 5 | 8 | 0 / 25 / 0 |
| **total** | **396** | | | 260 | 147 | 38 | 45 | 280 | 202 | 62 / 332 / 2 |

Of the 396 items, 192 have 20 or more nodes and 101 have 50 or more. 295 have at least one async
element (schedule, webhook, poll, event or wait).

Extensions named in via-extension verdicts, with item counts:

| extension | items |
|---|---|
| event-trigger | 136 |
| webhook-trigger | 127 |
| schedule-trigger | 102 |
| agent-tool-loop | 99 |
| conversation-state | 89 |
| error-branch | 78 |
| chat-session | 78 |
| retry-policy | 66 |
| external-state-store | 51 |
| unstructured-cycle | 46 |
| subworkflow-call | 45 |
| stream | 28 |
| dynamic-fan-out | 7 |
| signal-resume | 2 |

Two items are `unsupported:interactive-dashboard-state` (Node-RED dashboards).

Oracle hints:

| kind | items | what it is |
|---|---|---|
| none | 349 | |
| mocked-execution | 24 | n8n templates that ship `pinData` |
| test-profile | 23 | 22 Coze fixtures (Go tests upstream, not acquired), plus 1 n8n template with Evaluation nodes |

None of these is a success oracle. They are only a lead for building mocked runs.

### Most complex and interesting items

- **n8n:20421**, "Sell clothing on Facebook Messenger with Gemini, Stripe, and an admin app":
  306 nodes, 337 edges, 38 decision points and 6 sub-workflow calls. It combines schedule, webhook,
  event and wait triggers, error outputs, retries, a tool-using agent, chat memory and a data-table
  state store. It is the broadest single stress test of the extension list.
- **n8n:7961**, "WordPress blog automation with Airtable interface, human review & AI research v2":
  209 nodes, 14 loops, poll trigger. The human review runs through Airtable status polling, so it is
  not detected as a human step (see the limits below).
- **n8n:12533** (RSS newsletter curation, 139 nodes, 2 human approvals, 5 loops, 2 sub-workflows)
  and **n8n:14080** (content repurposing, 105 nodes, 4 human approvals, 8 loops) mix several kinds of
  control flow. **n8n:11386** has 8 send-and-wait approval steps in a 43-node workflow.
- **dify:mkt-b450ab90-…**, "Product Marketing Content Generation": 75 nodes, 15 decision points and
  8 `human-input` nodes. Its verdict is **native** because every construct maps to IR
  human/agent/condition nodes.
- **dify:mkt-6c7b54a5-…** has 89 nodes with error branches and retries.
- **dify:mkt-5b4a3083-…** (Pangolinfo scraper) is a natural-language router with 7 loops and is native.
- **zapier:71b121303b32 / 0ea4ebf20bcc / 10dca33726f6**: 47–56-step Zaps with 15–20 Paths branches.
  One is a Looping-by-Zapier fan-out. Zapier templates are much less linear than their reputation
  suggests.
- **activepieces:gPWR7RDqutQ5GmloCrfl9** (30 steps, 3 loops, 6 connectors) and
  **activepieces:07OX2PJBTt6TGnEOIJa8b**. The latter nests three loops: loop → router → loop → loop.
- **node-red:f37879ba…**, "V6.0 Climate Control via DEW POINT": 421 nodes and 160 switch decision
  points, a long-lived event-stream controller.
- **node-red:5203cdf1…** (MG4 EV dashboard) has 50 subflow instances.
- **node-red:a05618a9…** (IP to LED) has 30 unstructured back edges.
- **flowise:agentflowsv2-sql-agent** and **flowise:agentflows-agentic-rag** are bounded self-correction
  loops (`loopAgentflow` with `maxLoopCount`).
- **flowise:agentflowsv2-human-in-the-loop** has an explicit human-input node.
- **coze:batch-batch-with-inner-interrupt**, **coze:parallel-interrupt** and
  **coze:chatflow-chat-run-with-interrupt** are small fixtures that pin down resume-after-interrupt
  semantics inside batch and parallel branches. They are useful as semantics probes for IR
  human/map, not as capability tasks.

## Normalization semantics and known limits

- **Per-platform type tables.** Node category and effects come from per-platform tables in
  `automation-normalize.py`, which document the heuristics.
  - `effects` is `read` for get/list/search-like operations and `write` for
    create/update/send-like ones.
  - It is `external` when the effect cannot be read off the operation (unspecified connector
    operations, non-GET HTTP, shell exec).
  - Model calls are `none`, matching Foundry `agent` nodes.
- **Not validated against platform semantics.** Categories were not checked by executing anything.
  Expect misclassification of community or unknown node types; they default to `action`/`external`.
- **Branching and loops.**
  - `branching` = condition nodes + nodes with ≥2 used non-error output ports.
  - `loops` = loop constructs + DFS back edges outside them. Such back edges become `kind:"loop"` and
    raise `unstructured-cycle`. The item's `ir.notes` say how many pass through a wait or human step,
    i.e. are poll-until loops.
- **IR verdicts are heuristic.** They come from node categories, not from compiling to
  `schemas/workflow.schema.json`. The extension vocabulary goes beyond the schema's list:
  - `agent-tool-loop`: a model-driven tool loop. Foundry `agent` is one narrow judgment; this needs a
    bounded loop of agent + task.
  - `conversation-state`, `chat-session`, `external-state-store` and `retry-policy` are the other
    additions.
  - `unsupported:interactive-dashboard-state`: a Node-RED flow where more than 40% of nodes are
    dashboard widgets, so it is a long-lived UI, not a bounded run.
- **Edge semantics differ by platform** and are not comparable across platforms without care.
  - n8n `main` edges are `data`. `ai_tool` edges are `control` (tool offered to an agent). Other
    `ai_*` edges are `data` (component composition). The last output of a `continueErrorOutput` node
    is `error`.
  - Flowise v1 chatflows and Langflow edges are component dependencies, not control flow.
  - Zapier ZDL `parallel_paths` is represented by a synthetic `EngineAPI:parallel_paths` condition
    node, and `error_wrapper` handlers get `error` edges from every step in the try block.
  - Activepieces and Zapier get extra `data` edges from `{{step_n…}}` / `{{_GEN_n__…}}` references.
- **Human steps.** These cover n8n `form`, `wait` with resume=form, and every `sendAndWait`
  operation; Dify `human-input`; Coze QuestionAnswer/InputReceiver; Flowise `humanInputAgentflow`;
  and Activepieces approval/manual-task/todos.
  - Human review done through external tools (an Airtable or Sheets status field, Slack polling) is
    **not** detected.
  - Node-RED dashboard input widgets are typed as human-initiated `trigger` events, not human steps.
- **Non-redistributable items** carry synthetic node ids (`n1…`) and summaries derived from type and
  operation. Their descriptions are written by the script from features (`provenance:"written"`).
  Titles are kept as identifiers (Node-RED titles clipped to 120 characters). The output was scanned
  for API-key, JWT and e-mail patterns and for embedded URLs: none found.
- **Domains** come from platform categories or tags (n8n categories, Activepieces categories, Dify
  categories, Node-RED tags, Flowise use-cases). Zapier ZSL has none, so `domains:[]`.

## What was impossible, or not done

- **Make:** no machine-readable public templates are reachable. The site sits behind a Cloudflare
  challenge and the API needs a token, so there are zero Make items.
- **Zapier:** templates are ToS-governed. Only a 160-page seeded sample was fetched, at 1 req/s from
  the first 3 of roughly 500 sitemap pages, so the sample is not uniform over the full catalogue. The
  partner API needs a client_id.
- **Pipedream:** has no public workflow-template corpus. Pipedream workflows are private code
  projects, so there are zero items.
- **Coze:** the coze.com store is login-gated. Only open-source test fixtures were used, and they are
  not representative of real Coze user workflows.
- **n8n API:** 4 template ids returned 404. 1,306 paid templates were skipped. The n8n library has no
  open licence, so no n8n graph can be published with original node names or descriptions.
- **Dify:** chat, agent-chat and completion apps (62 marketplace + 11 repo) were skipped as non-graph
  apps.
- **Langflow:** the `.py` starter graphs were not parsed. They duplicate the JSON projects.
- **No oracles:** no item ships an executable success oracle. `mocked-execution` and `test-profile`
  are leads only. Any capability use needs frozen inputs and oracles built separately.
- **Live sources:** the Node-RED, n8n, Activepieces, Dify-marketplace and Zapier sources are live.
  Exact re-acquisition is possible only from the raw copies in /opt (the sha256 prefixes in
  `source.revision` identify them).
