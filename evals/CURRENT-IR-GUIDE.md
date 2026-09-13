# Current native IR for the new SRE diagnostic campaign

The accompanying workflow.schema.json and capabilities.json are authoritative.
This describes the current executable interface, not a task solution. No tools
outside the supplied catalog exist in this experiment.

Required workflow fields: schemaVersion "1.0", id, version, title, goal, domain,
envelope, budget, nodes, acceptance. Each campaign output is a fresh version-1
candidate in its own empty store; repairs also start as fresh version 1.
Envelope has assumptions/risks arrays, nonempty successCriteria, and optional
unsupported. Budget has maxSteps/maxConcurrency/maxDurationMs and optional
maxCost. Unknown properties fail validation.

Every node has id, kind, description, needs. Task nodes additionally have tool,
args, timeoutMs and retry.maxAttempts. An assert has checks. A human has question
and answerSchema. A map has items/maxItems/body; a loop has initial/maxIterations/
body/until; a wait has delayMs. A body has nodes and acceptance. Consult schema
for all optional fields.

Values are JSON literals or reference objects such as {"$ref":"input.FIELD"}
and {"$ref":"nodes.NODE.FIELD"}, with optional default. Capability outputs live
directly under their node names: no extra output or result wrapper. References
to other nodes require direct or transitive needs. Map locals are item/index;
loop locals are iteration/previous. Parent values may enter a body via input.
No JavaScript, expressions, dynamic-property lookup or implicit coercion exists.

eq/ne/gt/gte/lt/lte/in/contains conditions use op,left,right; exists uses op,value;
all/any use op,conditions; not uses op,condition. Equality is strict JSON equality,
numeric operators require numbers, and `in` tests strict membership in an array.
Missing references fail except when handled by exists or an explicit default.
Existence alone does not establish a value's type.

A false when skips a node without output. Dependencies default to
join:"all_success": a skipped or handled-error predecessor skips the dependent.
Explicit join:"all_resolved" allows continuation after all alternatives resolve;
missing outputs still require explicit handling. Task failures stop by default;
onError:"continue" creates {ok:false,error:...} with handled_error status.

An assert returns {passed:true} when checks hold, otherwise fails. A human pauses
and returns {answer:...} after an actual answer. A map returns {items,count}; a
loop returns {iterations,last} or fails at its bound. A wait can require resume.
Nested work consumes the outer budget. All nodes must finish or skip, and all
root acceptance conditions must hold for successful completion. Acceptance must
inspect runtime evidence, but the independent oracle may still reject it.

Registry evidence/approval/effect declarations are host-owned. Where a catalog
entry has requiresEvidence, every effect dispatch needs same-frame ancestral
source receipts matching sourceTool and exact sourceArgs, the selected path's
schema and maxAgeMs. SourceArgs input references bind to resolved EFFECT args.
An older valid receipt cannot replace a newer failed/malformed attempt. Pauses
and retries recheck freshness. A missing source dependency is a validator error;
wrong scope, missing values and bad types remain runtime evidence diagnostics.
The model cannot change the registry or manufacture receipt objects. A catalog
entry without requiresEvidence has no such host gate; the task contract still
applies. No gate replaces independent post-effect task verification.
