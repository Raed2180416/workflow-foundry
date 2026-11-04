# CI-1 research dossier and build plan: corpus-based construction tests with leave-one-out retrieval

*Research phase, 2026-10-21 ($0: no model was called, nothing in the repo was edited). Owner asks E6 ("corpus-based construction
tests: build X from a description, check by execution") and A8 ("give the builder templates and the hardest enterprise patterns
from the corpus so it builds robustly"), research/REQUIREMENTS-COVERAGE-20261021.md. Committed with the build so the plan the
result deviates from is on record; deviations are listed in [RESULT-CI1.md](RESULT-CI1.md) §8.*

The pool of real corpus workflows we can actually run is much smaller than the corpus suggests. Of the 594 local n8n.io templates,
88% contain a model node and 74% an open-ended AI agent (an agent that picks its own tools in a loop). Only 54 to 86 can be run
against a local simulated world (no agent, no sub-workflow, no community nodes). 38 to 64 of those are non-trivial, and only 10 to 23
were created after Haiku 5.5's training cutoff. So CI-1 can measure something real, but on a small slice, and the per-item effect of
retrieval will be underpowered unless the pool grows.

**Labels:** [O] observed in the research session; [D] a documentation or paper claim, read 2026-10-21; [I] inference.

## 1. What exists in the repo

- **The corpus pool [O].** In the 594 n8n.io templates in `/opt/corpus/n8n/workflows` (n8n terms of service: local use only, never
  committed): 65% have Code nodes, 27.7% of 17,019 expressions are general JavaScript rather than plain field reads, median 23 nodes.
  - Pool definitions: T1 = no generative model and no agent, only classification or extraction nodes; T2 adds model nodes that only
    generate text.
  - Sheet, mail and chat stand-ins (plus model sub-nodes): T1 36 items, T2 54. Adding calendar, CRM, tickets, tasks and files: T1 51,
    T2 86. Services AutomationBench can serve: T2 55.
  - No HTTP Request nodes: 29 items (14 with Code nodes, 21 with JavaScript expressions, median 12 nodes).
  - Top connector operations: Sheets append (39), Gmail (27), Telegram (19), Slack (12), Sheets update (11); about 40 distinct.
- **Duplicates [O].** 580 distinct structure hashes (Weisfeiler-Lehman, two rounds) over 594 templates; 13 exact-duplicate groups
  cover 27 items; 73 items have a near-duplicate at Jaccard >= 0.6, 39 at >= 0.8; 339 authors, the largest with 36 items.
- **Importer bug [O].** `app/importers/n8n.mjs` `workflowOf` picked `json.workflow` (a list of node types) on n8n.io template
  documents, so all 594 raw corpus files threw `N8N_FORMAT`. Fixed in S0 (commit 54f3dbdd).
- **Reusable pieces [O]:** the 12679 replication interpreter seed (`experiments/replicate/items/n8n-12679/controls/original.mjs`,
  40/40 agreement); the effect-log conformance evaluator (`research/jit-20261008/analysis/replication/README.md`; lesson: generic
  normalisation rejected all 11 correct designs, per-item declarations of 19-33 lines were needed); BUILDER-1's stand-ins and
  hidden-world oracle; the corpus-derived pattern catalog (`experiments/library/cards/catalog.json`) and the code-only retriever
  (`experiments/library/retrieve.mjs`); the corpus feature prior; the AutomationBench bridge.
- **AutomationBench as a world [O]:** 47 simulated SaaS tools behind their real REST base URLs (MIT). Whether its routes accept
  n8n's request shapes is unknown [I].
- **The earlier CI-1 plan** (`research/intent-20261021/DESIGN.md` §9) was a feature-recall pilot with no executing oracle; this
  CI-1 replaces it with items scored by running them.
- **Environment [O]:** user namespaces work, so corpus Code-node JavaScript can run sandboxed with no network. 3.3 GB free disk.

## 2. Frontier work, 2025-2026 [D]

- **Chat2Workflow** (arXiv 2604.19667): 237 instances on Dify and Coze; executes the workflow but an LLM judges the output; best
  60.2% resolve; repair adds 5-6 points; no retrieval.
- **MCPGen** (arXiv 2609.23925, 2026-09-20): 100 projects re-implemented from n8n community templates, offline deterministic mocks
  against a gold workflow; best 57% end to end, Claude Sonnet 15%; single turn, no retrieval or repair. Closest prior art.
- **n8n's own builder evaluations** (`packages/@n8n/instance-ai/evaluations/README.md`, fetched 2026-10-21): logic nodes run for
  real, outside calls get LLM-invented responses, an LLM verifier judges, pass@k and pass^k with Fisher's exact test. The `.ee`
  files are enterprise-licensed and not adoptable. [I] Nobody scores a built workflow by equivalent effects against the original
  run on the same deterministic worlds.
- **ServiceNow decomposition + retrieval for low-code flows** (arXiv 2412.00239): > 20% of step and table names hallucinated
  before retrieval.
- **ComfyUI workflow generation** (ComfyGPT 2503.17671; ComfyUI-R1 2506.09790).
- **6,000+ public n8n workflows study** (arXiv 2606.29116, abstract only): reliability mechanisms (fallbacks, repair loops,
  failure alerts, approval gates) are rare, so "hardest enterprise patterns" are scarce in n8n templates [I].
- **Workflow memory:** Agent Workflow Memory (ICML 2025) +24.6% / +51.1% relative on Mind2Web / WebArena; ReasoningBank
  (arXiv 2509.25140) 46.5 -> 49.7 when failures are kept, labels from a 72.7%-accurate LLM judge.
- **CodeRAG-Bench** (NAACL 2025 Findings): retrieval helps only with high-quality context; retrievers fail when wording differs;
  generators often ignore what was retrieved.

## 3. Adjacent fields that hide a solution

1. **Distilled test suites** (Zhong, Yu & Klein, EMNLP 2020): sample many databases, keep the few that tell the gold query from
   near-miss variants. Adopted: world distillation that kills mutants of the reference workflow.
2. **DAIL-SQL** (arXiv 2308.15363): pick examples by masked-question similarity plus first-draft skeleton similarity. Adopted:
   mask names, numbers and addresses; rerank by a draft's skeleton.
3. **ProCAKE** (process-oriented CBR, GPL-3.0): two-stage MAC/FAC workflow retrieval. Study only.
4. **Template-based retrosynthesis** (RetroSim, ACS Cent. Sci. 2017): accuracy capped by template coverage, so CI-1 must report how
   many items the 7 BUILDER-1 templates can express at all.
5. **Spec-to-hardware / IaC:** VerilogEval v2 (simulation-checked, in-context examples matter); IaC-Eval (intent specs, GPT-4
   19.36% pass@1).
6. **Boundary tests mined from guards** (AgentEval, arXiv 2607.06873). Adopted: worlds on each condition's boundary.

## 4. Adopt vs build from scratch

**Adopt:** AutomationBench (v2 world); n8n-mcp node property data (local, typing only); optionally `n8n-workflow` 2.16.0 (Sustainable
Use License, internal use only, never redistributed). Avoid pm4py (AGPL-3.0).

**Build from scratch:** (1) n8n-sim, the original graph on stand-in nodes with Code nodes and expressions in the namespace sandbox;
(2) a world distiller (boundary values + graph mutants, greedy cover <= 8 hidden + 1 public world, mutation score); (3) an effect
canonicaliser; (4) a describer protocol with leakage gates (no node or n8n type names, <= 0.10 8-gram overlap with the creator's
description, no title) and an entailment audit; (5) two independent references (n8n-sim and a Foundry transliteration must agree on
every world before admission); (6) leave-one-out exclusion (target, same structure hash, Jaccard >= 0.6, same author in the stricter
variant); (7) a compose path for the template builder; (8) leave-one-pattern-out attribution.

## 5. Risks

Reference fidelity (stand-ins are not n8n; label references "shim interpretation"); selection bias (only the simple deterministic
slice); power (35-40 test items detect >= 25-point gaps only); memorisation (pre-cutoff templates; report the post-cutoff stratum);
template coverage; over-specified descriptions (translation, not construction); retrieval can hurt (extra effects fail); untrusted
corpus text (describer sees it as data, sticky notes stripped, exemplars rendered from structure only); running corpus Code-node
JavaScript in the sandbox (owner's call; alternative is transliteration); the account e-mail leak on the `claude -p` route (keep the
grounding guard, scrub records; *2026-11-04 review: neither was built for the first runs, RESULT-CI1.md D20; the review runner
isolates the CLI and scrubs, §11.1*); licensing (raw items, worlds and transliterations stay local; git gets digests); Mercury <= 0.5M
tokens.

## 6. Plan

S0 importer fix; S1 targeted pool fetch with a ledger; S2-S4 n8n-sim, distiller, canonicaliser with validity gates (100%
deterministic reruns, empty workflow passes <= 5% of items, median mutation score >= 0.9); S5 bed construction (describer, entailment
audit, two-reference admission; ~15 dev / 35-40 test); S6-S7 leave-one-out retrieval index and compose path; S8 freeze by sha256 in
MANIFEST.json and commit PREREG-CI1.md before the first builder call.

Arms (Haiku at K = 3): A0 one-shot Haiku (+ a thinking-on variant); A1 BUILDER-1 template builder frozen at MANIFEST-fix; A1c A1 +
compose path, no retrieval; A2 A1c + leave-one-out retrieval; A2-M A2 on mercury-3 (K = 1, cap 450K tokens); optional Opus one-shot.

Primary number: share of frozen test items whose built workflow's effects equal the reference's on every hidden world (pass@1 over K
and pass^3, item-clustered bootstrap). Primary test A2 vs A0, paired by item; secondary A2 vs A1c (retrieval), A1c vs A1
(composition), A1 vs A0. Predictions: 25-45% of items fit a template; A0 10-30%, A1 20-40%, A1c 30-50%, A2 +5-15 over A1c. Park rule:
A2 - A1c <= 3 points with the upper interval below 10 parks retrieval. Budget: Haiku arms < $10. The test split is held out from
builder development but has the same author: not sealed.
