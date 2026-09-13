# n8n adapter validation

Observed **2026-09-13**. The generated workflow JSON and Code-node bodies were exercised; **an actual n8n import or engine run was not performed**. The export metadata retains `targetRuntimeVerified: false` and `runtimeParity: false`.

`node --test tests/adapters.test.mjs` passed all **11 tests**, including export qualification, unsupported-semantics rejection, versioned node/connection shape, explicit binding IDs, typed acceptance, plausible wrong results, input/output schemas, default skip propagation, explicit `all_resolved` fallback, absent outputs, zero/multiple results, operation-key mismatch, late results, step exhaustion, late acceptance and template-like text remaining data. Portable schema/reference/condition cases were compared with the native JSON helpers and validator.

The tests execute our generated JavaScript inside Node's `vm` with a small, explicit substitute for `$input`, `$execution` and cross-node reads. The substitute follows the emitted serial branches and simulates declared capability responses. It is **not n8n** and does not establish UI import behavior, connector execution, persisted restart semantics or target cancellation. The node versions, input parameters and retry differences were inspected in public n8n source pinned at `4169b55bf3b3e6c255d7361642bc5243bd04345a`; the source corpus was not installed or executed.

The full repository suite at the recorded integration pass had **73 passes, 1 browser-UI skip and 0 failures**. The adapter suite was rerun after its final deadline fixture changes and passed again. Four original domain/runtime skills passed metadata checks, and all 62 local dossier/skill links resolved. The source evidence builder independently verified 51 spans across 18 pinned repositories.

The CoS full adapter security gate reported no secret findings or known dependency findings. The inspected dependency lock belongs to the companion LangGraph adapter, not an installed n8n engine. No claim is made about the vulnerability state, credentials or configuration of a future n8n deployment.

## Required deployment qualification

Before treating a task export as executable, bind each capability to an actual trusted pure/free sub-workflow, import the generated JSON in a compatible test instance and verify one-input/one-output handling, both conditional paths and the final acceptance result. Exercise the child deadline and cancellation contract with a deliberately hanging task, then confirm that no dependent work proceeds. Check missing, duplicate, malformed, late and wrong-operation results on the actual engine. The parent must not be automatically retried or resumed from arbitrary node data.

Task timeout/cancellation is delegated to that explicit external binding. A late-result guard cannot terminate a remote task, and the workflow's seconds-based timeout is only a backstop. Human workflows, loops/maps/waits, effects, retry/recovery, concurrent joins, credential installation and native event/CAS migration are outside the current profile. The exporter rejects these conditions rather than claiming their semantics were preserved.
