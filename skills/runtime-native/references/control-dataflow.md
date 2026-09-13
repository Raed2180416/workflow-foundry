# Compile actual data handoffs

An executable graph needs correct values crossing each edge, not just plausible
node names. Read the exact producer output and consumer input schemas. Track the
shape at every boundary, including native wrappers and message history.

## Carried state in a loop

Distinguish three states in a query/action process: history before the query;
history including the new assistant response; history including the resulting
action observation. Pass the action the query's actual response and updated
history. Pass the action's returned history to the next query. Do not reconstruct,
truncate, default away or replace those observations with stale input.

For illustrative body nodes `query` and `act`, a compatible initial value is
`{"act":{"messages":<initial history>}}`. The next query reads
`previous.act.messages`; the action reads `nodes.query.message` and
`nodes.query.messages`; root completion reads `nodes.<loop>.last.act.done`.
These names are examples, not required tool names or task answers. Use the actual
catalog contracts, including the meaning of `done` versus mere field existence.

The native body returns an object keyed by **all body node identifiers**. It does
not implicitly return the last node's output. Match the initializer to that shape
or use explicit phase-specific guards/defaults. Check both the first and a later
iteration. A loop that immediately finishes can hide a broken recurrence.

## Maps, joins and missing values

A map's `items` contains body-output objects. If `measure` returns `{value:7}`,
each item is `{measure:{value:7}}`; extract `measure.value`, not `value`. Root
`input`, a control node's explicit child `input`, `item`, and `previous` are
different scopes. Native refs use own-property paths, not JavaScript or JSONPath.

Default `all_success` joins require successful prerequisites. Alternative paths
must explicitly use `all_resolved`, then handle absent or failed output. An
`exists` condition is a missing-value probe, not proof that a value is true or that
an action completed. Numeric and Boolean values must retain their actual types.

The static checker rejects paths absent from declared closed structures and
reports carried-state gaps. Open/unknown schemas stay unknown. Conditional
warnings require runtime tests; simply adding a guard to silence a warning does
not make the handoff correct. Data contracts do not establish observation truth,
freshness, causal relevance or independent task success.

## Neutral construction tests

Before spending an external task budget, exercise an unchanged candidate with
neutral scripted tool results: immediate finish; several query/action turns;
malformed response followed by feedback; finish at the iteration bound; no finish
before exhaustion; an empty and a nonempty map; and an intentionally skipped
branch. Check exact inputs/outputs, order, call counts, stopping and exhaustion.
Mutate each handoff and require the construction oracle to reject the mutation.

These are conformance tests, not model reasoning outcomes or hidden task answers.
Keep construction and task-outcome qualification separate. The rule is derived
from the project's preserved `research/reference-swe/` diagnostic comparisons
(repository-only provenance) and the installed native runtime's body semantics.
