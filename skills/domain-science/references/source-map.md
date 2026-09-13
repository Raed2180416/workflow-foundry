# Science source map

Inspected on 2026-09-13. These are static source observations, not upstream test results. The development repository's `research/manifests/science.json` records repository retrieval times, complete revisions and detected license files; `research/manifests/docs-public-science.json` records public-page retrieval times and byte hashes. Those acquisition ledgers are repository-only provenance and are not part of the installed skill. Pinned public sources and observations are retained below. Source code and documents were not installed or executed. Requirements derived from them are proposals for Foundry, not statements about implemented Foundry guarantees.

### SCI-B1

[BioNeMo manifest implementation, lines 30–179](https://github.com/NVIDIA-BioNeMo/bionemo-agent-toolkit/blob/0e67a612e4045f007e38fa77adc8f3ebfc5616b6/workflows/generative-protein-binder-design/protein-binder-design/scripts/manifest.py#L30-L179).

Whole file read. The manifest stores run metadata, stages, candidates, scores and artifact paths. `apply_filters`, lines 120–135, skips criteria whose score is missing and passes when the remaining checks are nonempty and all true. Artifact paths alone do not bind artifact bytes. `save`, lines 72–75, writes directly. Transfer: complete evidence requirements, content identities and atomic state persistence. No biological procedure is needed to test these properties.

### SCI-B2

[BioNeMo executable preflight, lines 111–241](https://github.com/NVIDIA-BioNeMo/bionemo-agent-toolkit/blob/0e67a612e4045f007e38fa77adc8f3ebfc5616b6/workflows/generative-protein-binder-design/complexa-binder-design/scripts/preflight_design.py#L111-L241).

Whole file read. Identity resolution, subprocess acquisition, alignment/context checks and a formatted readiness result precede downstream design. The CLI catches per-item exceptions and prints them; a printed readiness label is not a universal execution gate. Downstream model inference and physical validation were not run or fully traced. Transfer: typed preflight results consumed by the scheduler, with distinct missing, invalid and ready states.

### SCI-R1

[Robin coordinator, lines 158–289](https://github.com/Future-House/robin/blob/4a5cce310f3bc7663a67117db88af43b84733ffe/robin/multitrajectory_runner.py#L158-L289).

Whole file read, including step definitions and result persistence. Steps expand into remote Edison tasks; responses produce status summaries and downloaded output files. Download exceptions are logged and the post-processing path can still run. Results are saved after the pipeline. This is a public coordinator around a hosted service, not the complete service implementation. Transfer: required-artifact joins, durable task identity and reconciliation of remote state.

### SCI-R2

[Robin analysis caller, lines 17–107](https://github.com/Future-House/robin/blob/4a5cce310f3bc7663a67117db88af43b84733ffe/robin/analyses.py#L17-L107) and [interpretation, lines 128–202](https://github.com/Future-House/robin/blob/4a5cce310f3bc7663a67117db88af43b84733ffe/robin/analyses.py#L128-L202).

Whole file read. Five analysis branches feed a consensus step; the caller subsequently reads its expected output and returns an error when the file cannot be processed. Thus the coordinator's permissive download handling does not establish that every caller reports success. Interpretation uses a delimiter-based four-part response check. Transfer: explicit join completeness and schema validation separate from scientific validity.

### SCI-R3

[Robin configuration, lines 242–330](https://github.com/Future-House/robin/blob/4a5cce310f3bc7663a67117db88af43b84733ffe/robin/configuration.py#L242-L330) and [remote request utilities, lines 70–237](https://github.com/Future-House/robin/blob/4a5cce310f3bc7663a67117db88af43b84733ffe/robin/utils.py#L70-L237).

Both files read in full. Configured model/API clients and remote job names define an external dependency boundary. Utilities submit, poll and aggregate tasks; exceptions can skip submissions. Remote model behavior, weights and hosted operational controls are not supplied by these files. Transfer: explicit model/service version and per-request accounting rather than assuming a local model substitution reproduces the service.

### SCI-L1

[Safe Lab server, lines 35–153](https://github.com/MaxNaeg/safe_lab_agents/blob/e4a71147c219caf8867a135ab1fbd4c26e35d43b/safe_lab_agents/mcp/server.py#L35-L153) and [tool registry/invocation/lifecycle, lines 232–382](https://github.com/MaxNaeg/safe_lab_agents/blob/e4a71147c219caf8867a135ab1fbd4c26e35d43b/safe_lab_agents/mcp/server.py#L232-L382).

Whole file read. The server requires a bearer token, registers trusted host-side tools, optionally supports reload and performs name/argument checks before invocation. Shutdown attempts logging and a tool cleanup hook. Transfer: authenticated narrow capabilities and explicit schema revisions; orderly process cleanup is not evidence that an instrument reached a safe state. Optional reload must be considered only when configured, not asserted as an unconditional permission bypass.

### SCI-L2

[Safe Lab container policy, lines 48–68](https://github.com/MaxNaeg/safe_lab_agents/blob/e4a71147c219caf8867a135ab1fbd4c26e35d43b/safe_lab_agents/docker/manager.py#L48-L68), [resource limits and fallback, lines 451–535](https://github.com/MaxNaeg/safe_lab_agents/blob/e4a71147c219caf8867a135ab1fbd4c26e35d43b/safe_lab_agents/docker/manager.py#L451-L535), and [mounts, lines 1021–1056](https://github.com/MaxNaeg/safe_lab_agents/blob/e4a71147c219caf8867a135ab1fbd4c26e35d43b/safe_lab_agents/docker/manager.py#L1021-L1056).

Whole file read. It implements concrete container hardening and scoped mounts. A Docker resource-limit error can cause a retry without the limits. Shared/output directories are made agent-writable elsewhere in this file. Transfer: distinguish a convenience fallback from a strict resource policy; retain an independent protected journal and reject execution when a mandatory resource bound cannot be enforced.

### SCI-L3

[Safe Lab automatic logging, lines 386–441](https://github.com/MaxNaeg/safe_lab_agents/blob/e4a71147c219caf8867a135ab1fbd4c26e35d43b/safe_lab_agents/mcp/predefined/autolog.py#L386-L441) and [batch persistence, lines 225–302](https://github.com/MaxNaeg/safe_lab_agents/blob/e4a71147c219caf8867a135ab1fbd4c26e35d43b/safe_lab_agents/mcp/predefined/autolog.py#L225-L302).

Whole file read. The wrapper calls the tool before constructing its log record. A tool exception escapes that path; a persistence exception is warned about while the successful tool result can still be returned. Batches also hold state before persistence. Transfer: durable intent followed by completion/failure/unknown-effect records. Automatic provenance is useful, but it is not an immutable audit guarantee or proof of efficacy.

### SCI-L4

[Safe Lab argument decoding and validation, lines 30–127](https://github.com/MaxNaeg/safe_lab_agents/blob/e4a71147c219caf8867a135ab1fbd4c26e35d43b/safe_lab_agents/mcp/serialization.py#L30-L127).

Whole file read. Incoming arrays use NumPy loading with `allow_pickle=False`. Validation intentionally checks only outer container types, leaves unannotated parameters alone and returns unchanged arguments when type hints cannot be resolved. Transfer: complete nested schemas, finite values, units and deployment-specific bounds at the adapter. Do not describe this code as accepting incoming Python pickle objects.

### SCI-L5

[Safe Lab network policy, lines 1–122](https://github.com/MaxNaeg/safe_lab_agents/blob/e4a71147c219caf8867a135ab1fbd4c26e35d43b/safe_lab_agents/docker/dockerfiles/firewall.sh#L1-L122).

Whole file read. The policy allows public internet while isolating private networks and exposing a configured MCP route. This is not an internet-domain allowlist. Transfer: specify the intended egress policy accurately and attest the deployed policy; do not infer network controls solely from an isolation label. The script was never run here.

### SCI-F1

[Finch environment setup and tools, lines 74–185](https://github.com/Future-House/finch/blob/aea66fdf2dd2be827727de50a73cae60dff59972/src/fhda/notebook_env.py#L74-L185), [notebook mutation/execution, lines 215–339](https://github.com/Future-House/finch/blob/aea66fdf2dd2be827727de50a73cae60dff59972/src/fhda/notebook_env.py#L215-L339), and [answer submission, lines 65–79](https://github.com/Future-House/finch/blob/aea66fdf2dd2be827727de50a73cae60dff59972/src/fhda/data_analysis_env.py#L65-L79).

Both files read in full. A cell edit saves and reruns the notebook. Execution can use a local kernel or Docker; the Docker path permits cell errors in notebook output. Submitting an answer ends an episode but does not by itself check correctness. Transfer: replay-safe computation, explicit isolation profile, error inspection and separate correctness predicates.

### SCI-A1

[Aviary environment execution, lines 199–352](https://github.com/Future-House/aviary/blob/9b420ea6ba39ab1573cffd888c8eff5641c9726a/src/aviary/env.py#L199-L352).

Read lines 94–364. Tool names are filtered, concurrency is configurable, and a reader/writer lock protects calls within one invocation. Synchronous functions run in threads. This code alone does not establish a lease across independent requests or physical termination after a timeout. Transfer: scoped concurrency contracts and explicit unknown-effect recovery beyond an awaitable's cancellation.

### SCI-D1

[LDP rollout loop, lines 323–464](https://github.com/Future-House/ldp/blob/7220ca1e06292b856b1a3f1fe2c94170bc933055/src/ldp/alg/rollout.py#L323-L464).

Selected rollout path read. The manager distinguishes a step limit via `truncated`, stores failure metadata and closes the environment in a `finally` path. Exception termination is not a successful task outcome. Transfer: preserve distinct terminal reasons and attach execution evidence before using a trajectory for evaluation or learning. Optimization and training internals were not audited.

### SCI-E1

[Symbolic Lab Language validation, lines 67–154](https://github.com/emeraldsci/SymbolicLabLanguage/blob/9059baa04c140a66eb869c28cb2bdfd727e9cd77/ValidObjectQ/sources/ValidObjectQ.m#L67-L154) and [service login boundary, lines 42–51](https://github.com/emeraldsci/SymbolicLabLanguage/blob/9059baa04c140a66eb869c28cb2bdfd727e9cd77/README.md#L42-L51).

README and this validation range read; the broader tree was inventoried. `ValidObjectQ` downloads object packets and runs associated validity tests. This demonstrates typed domain validation tied to database state. It does not establish that the later physical world still matches that snapshot. Full cloud execution infrastructure and individual laboratory procedures were not inspected or exercised.

### SCI-E2

[Cloud Lab Commons ECL overview, lines 11–33](https://github.com/Cloud-Lab-Commons/ecl/blob/d114998930592245d2841d0c9a35329ab737b9be/README.md#L11-L33).

README and filename inventory read. This is a community collection of protocol examples, not an SDK or Emerald's hosted orchestration engine. Experimental-validation wording is a repository claim, not a validation performed here. The README's MIT badge disagrees with the acquired Apache-2.0 LICENSE text; review the actual files before redistribution. Procedures are deliberately not reproduced in this skill.

### SCI-P1

[LILA technology page](https://www.lila.ai/tech), snapshot `lila-tech` in the public-doc manifest.

Vendor-described architecture: scientific reasoning, tools, verifiers, automated facilities and policy improvement from experiment results. The fetched public surface does not provide the model, training system, instrument admission logic or operational safety case. The transferable design question is how a result becomes trustworthy feedback; efficacy and generalization claims remain unverified here.

### SCI-E3

[ECL search protocol, lines 1–207](https://github.com/emeraldsci/ecl-protos/blob/963bb9ffbb8aa6991dec7d6a682fa7daaa8e0381/proto/astra.proto#L1-L207) and [unit protocol, lines 1–141](https://github.com/emeraldsci/ecl-protos/blob/963bb9ffbb8aa6991dec7d6a682fa7daaa8e0381/proto/units.proto#L1-L141).

Both protocol files and the 14-line README read in full. The repository provides a search RPC, recursive filters, scalar/quantity representations and unit expressions. It does not supply their backend implementation or a physical execution service. No explicit license file appears in the four acquired tracked files. Transfer: typed quantities and query structure, with separate semantic validation and licensing review before code reuse.
