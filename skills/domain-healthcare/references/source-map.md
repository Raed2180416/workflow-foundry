# Healthcare source map

Research snapshot: 2026-09-13. The development repository's `research/manifests/science.json` records the public repository revision and licenses; `research/manifests/docs-public-science.json` records official public documents, retrieval timestamps, HTTP outcomes and hashes. Those acquisition ledgers are repository-only provenance and are not part of the installed skill. Pinned public sources and observations are retained below. No patient records, authenticated healthcare services, clinical actions or model evaluations were used.

### HEALTH-A1

[Healthcare Agents router, lines 13–47](https://github.com/ajhcs/healthcare-agents/blob/81b239763c06a71f6290d01f2535431c5ae4d89c/skills/healthcare-agents/SKILL.md#L13-L47) and [completion criteria, lines 70–85](https://github.com/ajhcs/healthcare-agents/blob/81b239763c06a71f6290d01f2535431c5ae4d89c/skills/healthcare-agents/SKILL.md#L70-L85).

Whole router read. It loads a compact workflow index, chooses one primary specialist, reads the relevant full prompt and maintains a working ledger. It distinguishes third-party evidence from authority and requires reconciliation across identifiers, documents and policy versions. This is a prompt contract; source inspection does not establish connector enforcement or clinical readiness.

### HEALTH-A2

[Healthcare Agents handoff map, lines 1–41](https://github.com/ajhcs/healthcare-agents/blob/81b239763c06a71f6290d01f2535431c5ae4d89c/docs/usage/handoff-map.md#L1-L41).

Whole document read. Primary, supporting and final human decision roles remain distinct. Local policies and data handling require verification. Transfer: encode handoff identity, scope and acknowledgement in state rather than assuming naming a reviewer completes a review. The repository's administrative setting is not a universal jurisdictional policy.

### HEALTH-A3

[Healthcare Agents evaluation limits, lines 1–23](https://github.com/ajhcs/healthcare-agents/blob/81b239763c06a71f6290d01f2535431c5ae4d89c/docs/eval/README.md#L1-L23).

Whole document read. Deterministic routing tests, model canaries and synthetic HealthAdminBench-inspired prompts are distinct. The document explicitly says these prompts do not replace benchmark GUI environments. Transfer: report structural, routing, workflow-execution and outcome evidence separately. No benchmark or canary was executed in this research acquisition.

### HEALTH-A4

[Healthcare prompt audit, lines 1–35](https://github.com/ajhcs/healthcare-agents/blob/81b239763c06a71f6290d01f2535431c5ae4d89c/scripts/audit-agents.py#L1-L35) and [heuristic scoring, lines 134–170](https://github.com/ajhcs/healthcare-agents/blob/81b239763c06a71f6290d01f2535431c5ae4d89c/scripts/audit-agents.py#L134-L170).

Read lines 1–170. The audit counts expected sections, citation-like tokens, template signals and usability markers. These are useful maintenance signals, but they cannot establish that a cited policy applies, that a source is current, or that a generated action is correct. The repository includes executable maintenance/routing tooling; it is not merely a directory of static prose, and it is not a clinical production runtime.

### HEALTH-H1

[Hippocratic AI benchmark description](https://hippocraticai.com/benchmarks/), snapshot `hippocratic-benchmarks`.

The retrieved current public page identifies Polaris 5.0 and describes a primary model with specialist support, speech components and company-run evaluation. It distinguishes a constellation from primary-only testing. These are public architecture and evaluation claims. We did not obtain training data, weights, runtime policy code, calibration data or production logs, and did not independently reproduce the results.

### HEALTH-H2

[Hippocratic AI safety description](https://hippocraticai.com/safety/), snapshot `hippocratic-safety`.

The company describes architecture, testing, clinician involvement, escalation and cross-checking. Transfer: assign different enforcement and evaluation responsibilities rather than treating one prompt's confidence as a safety decision. The public statements do not prove the completeness of an escalation path or the safety of an arbitrary substituted model.

### HEALTH-H3

[Hippocratic AI orchestrator surface](https://hippocraticai.com/orchestrator-overview/), snapshot `hippocratic-orchestrators`.

The current catalogue describes coordinated provider, payer and life-sciences workflows and an agent builder with clinician certification and simulation features. The page is a product surface, not source code for its scheduler, state machine or checks. Transfer: make the desired end outcome and cross-role dependencies explicit. Do not claim these proprietary implementations were cloned or reproduced.

### HEALTH-H4

[Polaris primary paper, version 1, 20 March 2024](https://arxiv.org/html/2403.13313v1), snapshot `polaris-2024-v1`.

Historical architecture paper inspected at the abstract and introductory scope: a stateful primary agent, specialist supporting agents and staged evaluations including simulated conversations. This version is not the current Polaris 5.0 implementation. Historical results must remain attached to their stated system version and evaluation setting; they do not transfer automatically to a new workflow generator.
