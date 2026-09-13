---
name: human-steering
description: Decide when to ask a human, translate their preferences or corrections into versioned workflow changes, and handle approvals, clarification and conflicting requirements without silently changing task authority.
license: LicenseRef-Project-Pending
---

# Human steering

Human involvement supplies missing intent, subjective tradeoffs or authority. It
should not be a hidden mechanism for manually repairing every generated workflow.

## Ask versus investigate

Inspect accessible state yourself when the answer is factual, cheap and within
scope. Ask when the answer materially changes success criteria, acceptable risk,
budget, irreversibility, desired output, architectural choice or external consent.
Present the concrete choice, consequence and your reversible default. Do not ask
the user to debug framework plumbing or inspect a large graph without a specific
decision. One targeted question is usually more useful than a long questionnaire.

An unsupported capability or weak success oracle is a technical gap, not a user
preference. Fix or expose the gap rather than asking the user to waive correctness.

## Preference changes and natural-language edits

1. Read the request and its workflow `baseHash`. Preserve the original user goal
   and identify exactly which requirements the change affects.
2. Inspect affected nodes, descendants, saved evidence and active runs. Explain the
   change in terms of outcome, state, cost, failure behavior and verification.
3. Produce a new version with the same workflow id. Change only what is justified,
   then validate the whole graph and rerun affected tests plus regression checks.
4. Submit a version-bound proposal. A stale base requires rereading and reconciling
   changes; never overwrite another client's newer work.
5. Existing runs retain their old program. Resume/migrate only with explicit state
   compatibility and effect reconciliation. Creating a new version is not proof
   that changing an already-dispatched operation is safe.

## Questions versus approvals

Human nodes ask questions and validate answers against schemas. Approval is a
separate host-enforced capability decision bound to exact arguments, program and
operation identity. Never synthesize a user's consent, infer authorization from a
tool returning success, or let another agent approve its own work.

No response means paused or an explicitly agreed safe fallback. Deadline expiry,
rejection and malformed answers must have visible outcomes. Received, persisted,
consumed and applied are distinct states; do not mark a steering message consumed
before its change is durably applied. Duplicate delivery must be idempotent.

## Evidence

An agent can request a bounded diagnostic repair after an applied run fails.
That record is explicitly agent-authored, retains the original task and version
lineage, and cannot change the goal or success criteria. It is distinct from a
human choosing a new objective or approving an external effect. Diagnostic records
do not automatically dispatch another model call through the user-request queue.

Record the question, answer provenance, interpretation, changed requirements,
proposal hash, validator/test result and whether the human supplied an actual
solution. Count interventions and substantive repairs in experiments. A system
that succeeds because a human repeatedly fixes its logic is not autonomous parity.

The existing ARC audit in `research/dossiers/arc-existing.md` supplies concrete
delivery/consumption and prerequisite-ordering falsifiers. The official LangGraph
interrupt guide documents restart-from-node behavior and side-effect replay:
`https://docs.langchain.com/oss/python/langgraph/interrupts` (checked 2026-09-13).
