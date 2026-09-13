# Study-only causal message handoff rule

Approved by prime in the worker inbox on 2026-09-13, before reference-02 freeze.
This overlay is supplied as generic architecture guidance; it does not edit the
installed native skill and contains no coding task, test case, or solution.

For a query/action loop distinguish the history before the query, the history
including its new assistant response, and the history including the resulting
action observation. Read each capability's exact input and output contract.
Pass the action both the query's returned message and its returned history.
Carry the action's returned history into the next query. Never reconstruct or
truncate these histories, substitute stale input, or fabricate an observation.

Native loop bodies return objects keyed by body node identifiers. `previous`
is the initial value on iteration zero and the complete prior body-output object
thereafter. Seed the initial fields actually consumed with that same nesting.
The loop result's `last` retains the body-node identifiers as well. Preserve
these wrappers across initialization, recurrence, and root acceptance.

For arbitrary body nodes named `query` and `act`, the handoffs are:

| Boundary | Source |
|---|---|
| Initial carried history | `initial.act.messages` bound to `input.messages` |
| Query history | `previous.act.messages` |
| Action response | `nodes.query.message` |
| Action history | `nodes.query.messages` |
| Next carried history | `previous.act.messages` |
| Loop stopping evidence | `nodes.act.done` |
| Root completion evidence | `nodes.<loop-id>.last.act.done` |

These node names are illustrative, not required. An absent field must not default
to success or silently discard earlier observations. Body acceptance checks an
available observation on each iteration; it must not demand submission before
the loop has had a chance to continue. Stopping and root acceptance must require
the actual action's explicit submission value, not its mere existence.

Counterexample: a schema-valid loop can pass the original history to the action,
which omits the latest assistant response. Even after fixing that boundary,
reading `previous.messages` fails because the body returned `{query, act}`.
Reading `last.done` similarly drops the action node wrapper. These are generic
dataflow defects, independent of any coding task or answer.

Schema and graph-shape checks establish only partial construction evidence.
Exercise the unchanged generated candidate on neutral scripted conversations:
immediate finish, multiple turns, malformed-response feedback, finish on turn
five, and five nonfinishing turns. Check exact histories, query/action order,
operation counts, stopping and failure on exhaustion. Deliberately mutate each
handoff and stopping boundary and require the independent gate to reject it.
Scripted conversations are conformance controls, never model outcomes.

Keep construction receipts `status: "partial"`, `deploymentQualified: false`
and `taskQualified: false`, even when `constructionPassed` is true. Current
WorkflowGenerator maps evaluator `passed: true` to deployment qualification;
therefore this study supplies no evaluator to the generator and runs its owned
construction gate separately. Only actual model execution and the external
hidden oracle can establish outcomes for the explicitly tested task families.
