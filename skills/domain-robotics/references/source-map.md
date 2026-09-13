# Robotics source map

Static inspection date: 2026-09-13. The development repository's `research/manifests/science.json` records exact revisions, retrieval dates, file counts and detected licenses; `research/manifests/docs-public-science.json` indexes public documentation snapshots. Those acquisition ledgers are repository-only provenance and are not part of the installed skill. Pinned public sources and observations are retained below. No ROS nodes, robot controls, SDK examples or upstream tests were executed.

### ROB-D1

[RMF patrol request, lines 118–185](https://github.com/open-rmf/rmf_demos/blob/4f8850fd3ff9c214252e4428d2ed03a646e6c839/rmf_demos_tasks/rmf_demos_tasks/dispatch_patrol.py#L118-L185).

Whole file read. It constructs a UUID-correlated direct or dispatched request, publishes it and waits for a matching response. The response wait ends after five seconds. This is submission evidence; the program does not independently demonstrate mission completion. Simulation time is an explicit option elsewhere in the same file.

### ROB-D2

[RMF robot adapter lifecycle, lines 191–307](https://github.com/open-rmf/rmf_demos/blob/4f8850fd3ff9c214252e4428d2ed03a646e6c839/rmf_demos_fleet_adapter/rmf_demos_fleet_adapter/fleet_adapter.py#L191-L307), [retry loop, lines 352–372](https://github.com/open-rmf/rmf_demos/blob/4f8850fd3ff9c214252e4428d2ed03a646e6c839/rmf_demos_fleet_adapter/rmf_demos_fleet_adapter/fleet_adapter.py#L352-L372), and [response identity, lines 235–251](https://github.com/open-rmf/rmf_demos/blob/4f8850fd3ff9c214252e4428d2ed03a646e6c839/rmf_demos_fleet_adapter/rmf_demos_fleet_adapter/RobotClientAPI.py#L235-L251).

Both files read in full. Commands increment an in-memory ID; navigation acceptance and observed completion follow different paths. Completion requires the last completed request to match the current command. Retry continues until success or a cancellation signal. Transfer: durable command epochs, bounded recovery and explicit terminal evidence, without treating a demo adapter as a complete deployment policy.

### ROB-D3

[RMF fleet manager publish/acceptance, lines 231–320](https://github.com/open-rmf/rmf_demos/blob/4f8850fd3ff9c214252e4428d2ed03a646e6c839/rmf_demos_fleet_adapter/rmf_demos_fleet_adapter/fleet_manager.py#L231-L320) and [state feedback, lines 434–549](https://github.com/open-rmf/rmf_demos/blob/4f8850fd3ff9c214252e4428d2ed03a646e6c839/rmf_demos_fleet_adapter/rmf_demos_fleet_adapter/fleet_manager.py#L434-L549).

Read lines 211–322 and 434–550. Navigation and stop endpoints publish path requests then return success. Feedback updates completion using mode, remaining path and task identity; outdated task feedback is rejected or causes the latest request to be republished. Transfer: acceptance is not physical completion or verified stop; identity needs freshness and restart protection for a stronger deployment contract.

### ROB-C1

[RMF dispatcher response memory, lines 150–180](https://github.com/open-rmf/rmf_ros2/blob/c16cfee2a80065972e191ecad6ad13c29e156baf/rmf_task_ros2/src/rmf_task_ros2/Dispatcher.cpp#L150-L180) and [request admission, lines 446–563](https://github.com/open-rmf/rmf_ros2/blob/c16cfee2a80065972e191ecad6ad13c29e156baf/rmf_task_ros2/src/rmf_task_ros2/Dispatcher.cpp#L446-L563).

Selected ranges read. The dispatcher caches responses by request ID in bounded process memory, checks that cache before parsing a new payload, validates new requests, opens bidding and returns an initial task state. Transfer: persist an idempotency record bound to payload, actor and revision when stronger replay guarantees are required. The inspected cache is not a durable transaction log.

### ROB-C2

[RMF dispatch cancellation and failed assignment, lines 639–825](https://github.com/open-rmf/rmf_ros2/blob/c16cfee2a80065972e191ecad6ad13c29e156baf/rmf_task_ros2/src/rmf_task_ros2/Dispatcher.cpp#L639-L825).

Cancellation ownership changes after dispatch to a fleet. Queued and selected requests have different cancellation actions; removal commands are tracked separately. No winning bid yields an explicit failed assignment. Transfer: ownership and acknowledgement must cross the dispatcher/adapter boundary. A local status transition does not prove that a device stopped.

### ROB-T1

[RMF active task contract, lines 237–347](https://github.com/open-rmf/rmf_task/blob/f0347c15718945bc6f1528ed682708ea9eb573f1/rmf_task/include/rmf_task/Task.hpp#L237-L347).

Read lines 220–359. `finished` includes cancellation. Backups have sequence numbers; interruption returns a resumer and signals when another task can safely be issued. Cancellation can continue cleanup phases; kill has different intended behavior and supersedes cancel. This is an interface contract, not a certified hardware stop implementation. Transfer: retain distinct states and completion acknowledgements, and do not equate software rewind with physical rollback.

### ROB-P1

[RMF schedule participant interface, lines 39–168](https://github.com/open-rmf/rmf_traffic/blob/39f09e7971c8e666e12c8e9b12199014f631c0bb/rmf_traffic/include/rmf_traffic/schedule/Participant.hpp#L39-L168).

Interface read. It exposes plan identifiers, versioned progress, plan-specific delays, reached checkpoints and distributed rectification hooks. The collision algorithms and full negotiation implementation were not inspected. Transfer: bind progress to the current plan and define how disconnected state is reconciled.

### ROB-S1

[RMF task-state schema, lines 1–83](https://github.com/open-rmf/rmf_api_msgs/blob/f61c13048a2b00063c22cf955f4b279053eccba2/rmf_api_msgs/schemas/task_state.json#L1-L83) and [status/dispatch definitions, lines 186–211](https://github.com/open-rmf/rmf_api_msgs/blob/f61c13048a2b00063c22cf955f4b279053eccba2/rmf_api_msgs/schemas/task_state.json#L186-L211).

Whole file read. Task state can contain booking, phases, interruption, cancellation and kill information. Status distinguishes blocked, error, failed, canceled, killed and completed. The top-level schema requires booking, not a successful terminal status. Transfer: structural validation must be followed by task-specific semantic postconditions.

### ROB-F1

[Formant gRPC API, lines 15–123](https://github.com/FormantIO/formant/blob/c2df919bec01052454254a22d73a418b08b01d41/protos/agent/v1/agent.proto#L15-L123).

Read lines 1–145. Telemetry acceptance means queued for upload; intervention, command, response, heartbeat and health interfaces are distinct. Interface availability is not a robot mission's success predicate. This repository supplies public releases/resources and protocol definitions, not Formant's entire hosted backend.

### ROB-F2

[Formant ROS command bridge, lines 28–109](https://github.com/FormantIO/ros2-adapter/blob/55b13fd5cef73b449f440600842cc744ea0103f0/formant_ros2_adapter/scripts/components/formant_control/formant_control.py#L28-L109) and [service calls, lines 94–129](https://github.com/FormantIO/ros2-adapter/blob/55b13fd5cef73b449f440600842cc744ea0103f0/formant_ros2_adapter/scripts/components/services/service_coordinator.py#L94-L129).

Both files read in full. Configured stream names connect Formant callbacks to ROS publishers and services. Service availability has a wait timeout; the subsequent synchronous call has no explicit completion timeout in this code. A command path can invoke a service and then a publisher. Transfer: define the effect of every adapter mapping, end-to-end deadlines, partial execution and how a service result maps to a mission result.

### ROB-F3

[Formant toolkit surface, lines 15–36](https://github.com/FormantIO/toolkit/blob/7eccfca24b97953641032e2e952137a0d97a8005/README.md#L15-L36).

README lines 1–145 and the SDK tree were inspected. Libraries support data access and custom UI/3D experiences on Formant APIs. No SDK-wide implementation review or browser integration test was performed. Transfer: use the same authoritative state for an inspector and executor, but do not infer backend enforcement from a visual control.

### ROB-M1

[RMF workspace manifest, lines 1–69](https://github.com/open-rmf/rmf/blob/146c053b61bc6d8db77ed37f6bb6a4a7d448f12f/rmf.repos#L1-L69).

Whole manifest read. The root repository names separate ROS, task, traffic and message repositories. Those four were additionally acquired to support the targeted traces above. The manifest alone is not an executable robot orchestration implementation.

### ROB-K1

[Skild public platform](https://www.skild.ai/), [official blog index](https://www.skild.ai/blogs), and [S1 research description](https://www.skild.ai/blogs/s1), verified on 2026-09-13. The index dates S1 to 2026-08-18.

The public material describes video-conditioned robotic in-context learning. Its scaling evaluation reports cumulative per-step success and uses human recovery interventions during rollouts. These metrics do not directly measure uninterrupted mission success. No S1 model weights, executable production control stack, internal benchmark data or safety case were obtained. Transfer: distinguish task novelty, horizon, deployment mismatch and intervention policy in comparisons. Public descriptions do not establish a cloneable workflow product or reproduction result.
