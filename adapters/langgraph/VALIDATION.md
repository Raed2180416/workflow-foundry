# LangGraph adapter validation

Observed **2026-09-13**, latest fixture receipt at **11:30:14 UTC**. This record concerns the qualified adapter profile, not a domain benchmark or proof of native-runtime parity.

## Executed evidence

`node --test tests/adapters.test.mjs` passed all **11 Node tests**, with **0 failures and 0 skips**. One test creates exported packages and invokes the actual installed LangGraph **1.2.11** under CPython **3.14.7**. Its **16 deterministic cases** passed: typed execution/acceptance; terminal replay; default skip; explicit fallback; input/output schema failures; human resume preserving a prior stamped result and step charge; wrong-run answer; invalid answer schema; deadline during a human pause; slow acceptance crossing the deadline; state-edit command rejection; internal-state input rejection; step exhaustion/failed replay; actual 50 ms child-process timeout with persisted attempt; changed capability bytes; changed workflow identity.

The latest machine receipt is `.foundry/adapter-eval/latest-langgraph.json`. It records `InMemorySaver`, zero model calls, and zero attempted coordinator socket operations under a blocking Python audit hook. The socket observation covers the coordinator; child fixture code explicitly uses only echo, UUID and sleep functions. It is not a general network-isolation test.

All four Python files passed `python3 -m py_compile`. The JavaScript entrypoint, exporters and portable helpers were imported and exercised by the Node tests. A repository integration run passed **73 of 74 tests, with one browser-UI test skipped and none failed**. That full-suite run preceded the final additional deadline fixtures; the complete adapter suite was rerun successfully after those changes. `npm run check` passed the repository doctor, which reports **14 skills** and explicitly does not certify task correctness. No dedicated repository formatter/linter/typechecker was declared in the observed package scripts.

## Environment and dependencies

Created an isolated environment at `.foundry/adapter-eval/.venv` and installed **43 exact packages** from a hashed, wheel-only PyPI resolution. The export contains `requirements.txt` as the scanner-compatible lock filename and `requirements.in` for direct dependencies. No corpus checkout or its installation scripts were used. These tests execute the packaged LangGraph release; no claim is made that its bytes equal the separately pinned research checkout.

The CoS Deterministic Quality Gate full adapter scan reported no Betterleaks secret findings and no OSV dependency findings. Trivy 0.74.0 recognized `langgraph/requirements.txt`; a separate same-scope table result explicitly reported **0 vulnerabilities**. No applicable configuration files were detected for misconfiguration scanning. Local Semgrep rules were absent, and registry rules were not enabled, so this is not a successful Semgrep/SAST audit. The gate report was `/home/raed/.local/state/cos-quality-gate/reports/20260913/165422-security-8c6a9bdb.json`; its embedded Trivy JSON was truncated, which is why the explicit table check was performed. These are observed scanner results, not a guarantee that the code or dependencies are defect-free.

The Serena initialization attempt returned `PLUGIN_DISABLED`. The project quality inventory succeeded and found no GitHub workflows or local Semgrep configuration. No GitHub remote was present in the observed repository. Independent review by the integrating prime is a separate step.

## Deliberate limits

Only pure, free, low-risk, explicitly trusted Python capability bindings are accepted. Human workflows must be totally ordered. No map/loop/wait, effects, retries, continue-on-error, parallel execution or paid models are supported. The wrapper exposes synchronous invocation and inspection; it rejects failed-task recovery and generic checkpoint/state rewrites. A bad human answer terminates the invocation. Paused time is charged against the original deadline.

The tests use in-memory checkpoints and do not prove durability across process/machine loss, cross-process ownership, event-chain integrity or Foundry Store/CAS migration. The child-process lifecycle limits are not a filesystem/network security sandbox. Imported dependencies of a trusted capability are not covered by its single-file hash. Deadline checks cannot preempt synchronous coordinator JSON work; they reject lateness when control returns. The portable schema, safe-integer, Unicode and data-size restrictions can reject inputs accepted by a broader native runtime. Performance, distributional generalization and commercial harness parity remain untested.
