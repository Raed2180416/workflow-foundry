---
name: domain-robotics
description: Construct inspectable robot-fleet and operator workflows with simulation boundaries, resource arbitration, command identity, completion evidence and intervention semantics. Use for robotics orchestration design and simulated evaluation; physical actuation requires a verified deployment adapter.
---

# Robotics workflow construction

Build a task-level coordinator around a verified robot adapter. Keep navigation/control limits, collision protection and emergency stop behavior in the responsible device and deployment systems. This skill defines integration obligations and does not certify physical safety.

## Progressive references

Read [source-map.md](references/source-map.md): ROB-D1–D3 trace the RMF demo; ROB-C1/C2 cover dispatch and cancellation ownership; ROB-T1 distinguishes interruption, cancellation and termination; ROB-P1/S1 cover plan versions and state schemas; ROB-F1–F3 cover Formant interfaces and ROS bridging. Read [requirements.md](references/requirements.md) to generate fault tests; its linked JSON is the machine-readable source. Consult the [portable source map](references/source-map.md) for pinned public sources and inspection limits.

## Define the mission and environment

Record the mission's postcondition, robot identity, device boot/session epoch, map and coordinate-frame revisions, permitted area, trusted telemetry sources, telemetry age limit, clock domain, resource dependencies, energy constraints and operator responsibilities. Use supplied deployment limits; do not invent numeric physical limits from general knowledge.

Choose `simulation`, `shadow-observation`, or `physical-deployment-design`. A generated workflow starts without physical capabilities. Promotion requires an authorized deployment binding whose identity, safety ownership and verification evidence can be checked outside the model. Simulator results stay labeled with simulator, world, seed and adapter versions.

## Compile task-level nodes

For each node, specify typed inputs, capabilities, preconditions, resource claims, bounded retry/deadline policy and independently observable completion. Preserve the distinction between planning an itinerary, scheduling it, issuing a command and observing the robot finish it.

Use a durable command identity containing the workflow revision, robot identity, device epoch, request identifier and canonical payload hash. A duplicate with the same identity and payload may return its prior result. Reusing the identifier for a changed payload must fail. A process-local counter alone is insufficient across restarts.

Model at least these states:

`proposed → authorized → dispatched → accepted → executing → observed-complete`

Also support `rejected`, `failed`, `unknown-effect`, `interrupt-requested`, `interrupted`, `cancel-requested`, `cancelled` and an independently tracked stop request. Map them explicitly onto the selected adapter's states; an upstream `finished` field may include cancellation.

An HTTP success or ROS publish is dispatch/acceptance evidence. Complete a mission only when the correct robot and command epoch produce fresh evidence satisfying the postcondition. Reject late telemetry from a superseded command, stale map or old device epoch.

## Resource and operator coordination

Acquire leases for shared robots, destinations and relevant infrastructure through the authoritative scheduler. Declare the order of acquisition and recovery from expired leases. Local locks inside a single batch do not arbitrate competing agents or processes.

Preserve separate semantics for pause, interruption, cancellation, kill and hardware emergency stop. A cancellation can require cleanup; its request is not its completion. Wait for the adapter's interruption acknowledgement before granting another controller authority. Do not infer a physically safe state from closing a thread, dropping a resumer handle or killing the model process.

If telemetry becomes stale or communication fails after dispatch, mark the command's effect unknown and use the deployment's verified response. Reconcile actual state before retrying. Bound retries and recovery duration; never hide an unbounded loop behind a task-level timeout.

An operator intervention has a named owner, affected resources, lease transfer, context packet and acknowledgement. Natural-language edits become proposed workflow revisions. Stop admission to affected nodes, reconcile in-flight commands, revalidate map/state constraints, invalidate old approvals and test the changed path before resuming.

## Evaluate with safe adapters

Use fake devices or a simulator to inject delayed acknowledgements, duplicate messages, partial acceptance, stale telemetry, process restart, map change, clock reset, operator takeover, resource contention and cancellation during execution. Test command replay after an acknowledgement is lost. Test that a reported error or cancellation cannot satisfy the mission's success condition.

Separate task-planner evaluation, adapter conformance, simulator task success and physical deployment evidence. Record the exact executor model and all tool versions. No single score combines these into a physical-safety guarantee. [requirements.md](references/requirements.md) is a proposed contract suite, not a passed runtime test report.

## Required output

Return the workflow, state mapping, telemetry validity rules, resource leases, command identity scheme, operator handoffs, simulation cases and deployment gaps. Label every guarantee by its enforcement owner and verification status. Keep the visualization synchronized with the same workflow revision and event journal used for execution.
