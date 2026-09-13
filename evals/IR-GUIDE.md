# Native IR reference supplied equally to both evaluation arms

This reference describes the executable interface, not a construction strategy.
The accompanying workflow.schema.json is authoritative for accepted JSON fields.
The capabilities.json file lists the available tool contracts. No other tools
exist in the evaluation runtime.

Required workflow fields: schemaVersion "1.0", id, version 1, title, goal, domain,
envelope, budget, nodes and acceptance. Envelope has assumptions and risks arrays,
nonempty successCriteria, and optional unsupported. Budget has maxSteps,
maxConcurrency and maxDurationMs, optionally maxCost. Unknown properties fail.

Every node has id, kind, description and needs. needs names nodes in the same
flow. Task nodes additionally have tool, args, timeoutMs and retry.maxAttempts.
An assert has checks. A human node has question and answerSchema. A map has items,
maxItems and body; a loop has initial, maxIterations, body and until; a wait has
delayMs. A body has nodes and acceptance. Consult schema for other allowed fields.

Values are JSON literals or {"$ref":"input.FIELD"} and
{"$ref":"nodes.NODE.FIELD"}. References may include an optional default field.
The nodes object contains capability outputs directly: there is no extra output
or result wrapper. A reference may traverse only available inputs/outputs and
must be covered by declared direct or transitive needs. No JavaScript or code
evaluation exists. Map bodies expose item/index; loops expose iteration/previous.
Parent values can be passed to a body through the control node's input field.

Conditions are structured objects. eq/ne/gt/gte/lt/lte/in/contains use op,left,right.
exists uses op,value. all/any use op,conditions. not uses op,condition. Equality is
strict JSON equality; numeric operators require numbers. Missing references fail
unless handled by exists or a default. There are no dynamic property lookups,
arithmetic expressions or implicit boolean coercions.

A node's optional when condition skips it if false. Skipped nodes satisfy needs
but produce no output. A task returns the capability's declared output. An assert
returns {"passed":true} when its checks hold, otherwise fails. A human node pauses,
then returns {"answer":theUserValue}. A map returns {items:[bodyOutputs],count}.
A loop returns {iterations,last:bodyOutputs} or fails when exhausted. A wait may
require resume after its wake time. All nested work consumes the outer budget.

The runtime executes ready nodes with bounded concurrency. Top-level dependency
cycles are invalid. All nodes must complete or skip, then all root acceptance
conditions must hold for a successful run. Constant-only acceptance is invalid.
The independent evaluator may still reject a workflow whose own acceptance passes.

Task failures stop the run by default. onError "continue" completes a failed task
with {ok:false,error:...}; downstream code must explicitly handle that shape.
Non-idempotent effects cannot be retried automatically. Registry risk and approval
rules are outside the workflow. Neither a model nor a human-answer node grants
tool permission. Versions and runtime state are separately maintained by the host.
