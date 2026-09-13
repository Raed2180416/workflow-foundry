# Portable source notes for the SRE skill

Reviewed on 2026-09-13. These procedures and fixtures are original design work.
The upstream links document observations and do not grant permission to execute
tools or access a service. No upstream code was copied into this skill. A source
checkout of Workflow Foundry also contains the longer analysis at
`research/dossiers/sre-security.md`; installation of this skill does not require
that research directory or the acquired repositories.

## Evidence and decision boundaries

HolmesGPT revision `459f4d7ae463419a095212442ef5f8818dd0abcc` distinguishes tool
result states and signed approval arguments. Its model loop ending is separate
from an independently observed recovery:

- [Tool-result envelope](https://github.com/HolmesGPT/holmesgpt/blob/459f4d7ae463419a095212442ef5f8818dd0abcc/holmes/core/tools.py#L64-L109).
- [Approval binding](https://github.com/HolmesGPT/holmesgpt/blob/459f4d7ae463419a095212442ef5f8818dd0abcc/holmes/utils/approval_tokens.py#L76-L115).
- [Model answer termination](https://github.com/HolmesGPT/holmesgpt/blob/459f4d7ae463419a095212442ef5f8818dd0abcc/holmes/core/tool_calling_llm.py#L1319-L1348).

Rootly MCP revision `5915e2174bd86e0d653c418d7a1305b82ee8189e` exposes a
configurable API surface and supplies query-repair hints. Its historical-incident
similarity tool proposes useful candidates, not causal proof:

- [Active capability defaults](https://github.com/rootlyhq/rootly-mcp-server/blob/5915e2174bd86e0d653c418d7a1305b82ee8189e/src/rootly_mcp_server/server.py#L674-L682).
- [Pagination error interpretation](https://github.com/rootlyhq/rootly-mcp-server/blob/5915e2174bd86e0d653c418d7a1305b82ee8189e/src/rootly_mcp_server/transport.py#L1184-L1240).
- [Related-incident tool](https://github.com/rootlyhq/rootly-mcp-server/blob/5915e2174bd86e0d653c418d7a1305b82ee8189e/src/rootly_mcp_server/tools/incidents.py#L1470-L1640).

Resolve's public plugin revision `d6627cc32863f8f5f79bab4de1fb886f458b0236`
contains a [scoped investigation-steering procedure](https://github.com/resolve-ai-oss/resolve-ai-plugins/blob/d6627cc32863f8f5f79bab4de1fb886f458b0236/plugins/claude/resolve-ai/skills/steer/SKILL.md#L17-L47).
The plugin delegates to a proprietary backend; changing its client model does
not establish that the backend investigator was replaced.

## Recovery and comparison boundaries

Shannon revision `25b90b0611f15ab945e051dfee8ae78600d3a002` provides source
examples of [identity-compatible report adoption after a lost acknowledgement](https://github.com/KeygraphHQ/shannon/blob/25b90b0611f15ab945e051dfee8ae78600d3a002/apps/worker/src/services/report-finalization.ts#L273-L389)
and [explicit partial/cancelled outcomes](https://github.com/KeygraphHQ/shannon/blob/25b90b0611f15ab945e051dfee8ae78600d3a002/apps/worker/src/temporal/workflows.ts#L1392-L1434).
These inform the original state and evidence requirements; they do not prove
the correctness of a generated workflow's factual conclusions.

[Datadog's public investigation overview](https://docs.datadoghq.com/bits_ai/bits_investigation.md)
describes the Bits product surface. The separately acquired Datadog telemetry
agent is not that investigation engine. No proprietary backend or production
incident was evaluated while constructing this skill.

The fixtures in this directory are inspectable development specifications. They
must not be called sealed tests, copied wholesale into an evaluated model's
prompt, or used as evidence of parity with a commercial product. See
[procedures](procedures.md) for evaluator isolation and comparison controls.
