# Design review by failure mechanism

This checklist generates questions and tests; ticking a box is not evidence.

| Concern | Required decision | Falsifying case |
|---|---|---|
| Outcome | Observable success and refusal/failure criteria | Plausible-looking wrong result |
| Inputs | Types, missing data, provenance and contradictions | A required field is absent or false |
| Capabilities | Real API schema, permissions and output semantics | Tool is unavailable or returns wrong type |
| Dependencies | Data/control ordering and explicit joins | Verification runs before an effect completes |
| State | Canonical owner, version and immutable run binding | Two clients edit the same version |
| Branches | Guards and behavior of skipped/missing outputs | Both alternative branches skip |
| Loops | Progress signal, bound, failure on exhaustion | Hypothesis never becomes supported |
| Effects | Idempotency/reconciliation and cancellation | Response lost after effect succeeded |
| Recovery | Checkpoint, dedupe and visible uncertainty | Process dies between dispatch and receipt |
| Human | Ask/infer/escalate rules and answer validation | A preference change invalidates the approach |
| Security | Trusted control vs untrusted content, least authority | Retrieved text asks to weaken policy |
| Evaluation | Independent oracle and mutation probes | Workflow marks its own empty report correct |
| Resources | Steps, calls, cost, deadline and concurrency | Failure cascade causes retry amplification |
| Portability | Semantic capability matrix, versioned adapters | Framework lacks the required join/interrupt |
| Deployment | Credentials, monitoring, rollback and ownership | New environment has stale dependencies |

For each high-risk concern record: requirement id, assumption, design mechanism,
test, result, unresolved gap and owner. A coverage denominator is only the named
taxonomy, not all possible real-world cases. Record independent human review only
when it actually occurred; different model roles are not automatically independent.

## Source discipline

General skill packaging follows the Agent Skills specification and progressive
disclosure guidance (`https://agentskills.io/specification`,
`https://agentskills.io/skill-creation/best-practices`, checked 2026-09-13).
Runtime interrupt/replay hazards are documented in the official LangGraph
interrupt guide (`https://docs.langchain.com/oss/python/langgraph/interrupts`,
checked 2026-09-13). The corpus dossiers supply revision/path evidence for domain
patterns. The proposed combined foundry is our design, not a claim those products
already implement this exact system.
