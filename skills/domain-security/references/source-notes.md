# Portable source notes for the security skill

Reviewed on 2026-09-13. These defensive procedures and mock fixtures are original.
No upstream scanner or exploit implementation is installed with this skill.
The longer checkout-only analysis is `research/dossiers/sre-security.md`;
the installed skill remains usable without that directory or its source corpus.

## Typed evidence and durable coverage

Shannon revision `25b90b0611f15ab945e051dfee8ae78600d3a002` supplies representative
source evidence for the distinction between empty results and invalid evidence:

- [Queue validation](https://github.com/KeygraphHQ/shannon/blob/25b90b0611f15ab945e051dfee8ae78600d3a002/apps/worker/src/services/queue-validation.ts#L215-L270).
- [Branch joins and partial outcomes](https://github.com/KeygraphHQ/shannon/blob/25b90b0611f15ab945e051dfee8ae78600d3a002/apps/worker/src/temporal/workflows.ts#L754-L866).
- [Compatible canonical report adoption](https://github.com/KeygraphHQ/shannon/blob/25b90b0611f15ab945e051dfee8ae78600d3a002/apps/worker/src/services/report-finalization.ts#L273-L389).

Artifact integrity is separate from a finding's truth. The skill adds independent
controls, current target binding, and outcome checks as design requirements;
it does not claim that report hashes prove security.

## Authority and import boundaries

Resolve plugin revision `d6627cc32863f8f5f79bab4de1fb886f458b0236` includes a
[returned-command streaming instruction](https://github.com/resolve-ai-oss/resolve-ai-plugins/blob/d6627cc32863f8f5f79bab4de1fb886f458b0236/plugins/claude/resolve-ai/skills/ask/SKILL.md#L37-L53).
A portable adapter should map supported streaming behavior into typed actions;
tool-returned text cannot authorize arbitrary host execution.

[Torq's official export guide](https://kb.torq.io/en/articles/9140014-export-and-import-workflows-in-torq)
links a public workflow example. The acquired example's SHA-256 was
`3a55b2f262adbc9bf8cc4ee97bde14dc8310c9617c6208cd23b2205ead730521`.
Static inspection found inconsistent destination/status bindings and an
unconditional-success exit. Those observations motivate `SEC-F05`; they are not
claims of an executed Torq platform defect or permission to run its export.

[The current NodeZero MCP tool catalog](https://docs.horizon3.ai/portal/features/mcp/tools/)
distinguishes read-only queries from setup operations that create an assessment.
The public [Horizon3 CLI at its inspected revision](https://github.com/horizon3ai/h3-cli/tree/96326ac46f21e28abee5a0e43bebc94206205964)
is an API client; neither that repository nor this skill contains NodeZero's
proprietary test engine. Tool names and descriptive annotations are insufficient
authority; inspect exact effect and permission contracts.

## Benchmark and substitution boundaries

XBOW's public benchmark revision
`a16cb1ba0701b20d63913846536fc7b0672082af` includes
[a current warning about its historical suite](https://github.com/xbow-engineering/validation-benchmarks/blob/a16cb1ba0701b20d63913846536fc7b0672082af/README.md#L3-L15).
It is development material, not the current XBOW product. Keep task answers,
build output containing ground truth, and evaluator state inaccessible to an
evaluated model. The fixtures shipped here are also public development cases.

A model swap at an MCP client does not replace a proprietary backend's planner,
tools, or evaluation. Compare architect, executor, tools, runtime, budgets, and
human assistance separately. No real target, paid service, customer workflow,
or commercial-parity evaluation was used to create this skill.
