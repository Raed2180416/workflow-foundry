# Actual model-driven product demonstrations

These are development/diagnostic demonstrations, separate from the actual TUI
comparative study in `evals/`. The architect is the observed zero-price OpenCode
Ling model through its isolated noninteractive JSON-event transport. They are not
Haiku tests and are not called TUI runs.

## Batch construction, initial budget

Before construction, `examples/batch-task.md` and `examples/batch-suite.json`
specified bounded numeric batches, exact artifact content and seven cases.
The initial three-round generation budget was exhausted. The first two responses
had format/wrapper errors; the last candidate passed only four of seven cases.
The nonempty-map failure came from reading a child output as `value` rather than
preserving the nested body's node id in the path. No candidate was hand-repaired
or promoted. Raw context, responses, errors, case stores and reported model costs
remain in `.foundry/live-demo/.foundry/generation/` and the verification receipt.

## Bounded development continuation

The original cases and expected outcomes remain unchanged. We add the general
nested-output example to the native skill and expose causal runtime/node errors
in diagnostic evaluator feedback. These are explicit treatment changes, not an
unseen test result. A fresh request may receive the previous unmodified candidate
and its real failure trace, with a maximum of three further model calls and a
five-minute total generation deadline. No hand-written candidate patches.

Success requires all seven independent outcomes, including absence of the output
artifact after malformed inputs. The schema validator alone cannot promote it.
The initial failures remain in the total development history.

## Natural-language revision

After a version passes, request a new version adding an ordered `batchTotals`
array to the same summary artifact. Define the changed expected artifacts before
generation, retaining every old input and rejection case. Bind the request to the
current workflow hash and preserve all existing runs. Use at most three model
calls; every candidate must be validated and executed against the new suite.
Check the old version is still addressable and its prior run program hashes remain
unchanged. This demonstrates versioned language-driven edits, not live migration.

## Limits

The numerical task is a real executable control-flow/serialization test, not a
claim of biological, clinical, production SRE or commercial-harness equivalence.
The oracle is host-authored and diagnostic; arbitrary natural-language intent
does not automatically produce a trustworthy oracle. A reused procedure remains
qualified only for the declared cases, capability version and input bounds.
