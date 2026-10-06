The finalized campaign received HTTP 200 and an unfinished model stream. Its termination is strongly consistent with the adapter's own 150-second deadline. The saved `MODEL_TRANSPORT` label hides a concrete error-precedence defect: an abort raised while reading the provider body takes priority over the adapter's timeout classification. The original failure stays unchanged. There is no completed workflow candidate to judge.

This addendum follows prime's execution of `benchmark/campaign-opencode-v2-continuation-001`, finalized on 17 September 2026 at 08:54:55.973 UTC. The earlier `NOTE.md` describes the pre-dispatch handoff and remains historical. Worker-3 authored the adapter and driver and now reviews prime's saved run; this is not independent review of the reviewer's own source. This review made no network request, model call, retry, suite execution, database open or product edit.

Paths below use `C` for `../benchmark/campaign-opencode-v2-continuation-001/`, `A` for `C/workspace/.foundry/generation/a5d847b9-f12a-4d1b-b8dc-0ce894452d30/01/`, and `P` for `A/opencode-v2-c9810561-0691-4cd1-ac8d-367cb28475a9/`. Live source locators refer to `/home/raed/Projects/workflow-foundry/`.

The wire evidence is decisive about what reached the host. `P/transport.json:1-23` records one attempt, one forwarded request, HTTP 200, zero completed responses, 199,373 partial bytes and error code 20, `This operation was aborted`. All retained bytes match its SHA-256, `ed3c54047505827cee57bc454b2e0450d0dba1daa67e83ed00d592f26011efa3`. The request used the intended endpoint, `big-pickle`, `max_tokens:8192`, `stream:true`, `stream_options.include_usage:true`, empty tools and `tool_choice:none`. The user message is exactly the saved 48,508-byte public prompt; both saved prompt copies and the wire user content share SHA-256 `424ccf5cc44fb5789707f6913e3782af578165685f0b7ebf2bfa31909a51dcd6`. Native client headers identify the actual installed `opencode/latest/2.0.5/cli` session; there is no new header/access refusal to repair.

Parsing all 1,380 lines of `P/wire-response.txt` produced these counts:

| Observation | Count |
| --- | ---: |
| Keep-alive comments before model data | 14 |
| Complete SSE JSON data frames | 676 |
| Nonempty `reasoning_content` deltas | 675 |
| Reconstructed reasoning UTF-8 bytes | 6,967 |
| Nonempty answer-content deltas / bytes | 0 / 0 |
| Nonempty tool-call deltas | 0 |
| Non-null finish reason, `[DONE]`, usage object, error frame | 0 each |
| Malformed JSON frames or unknown lines | 0 |

The file ends at a complete SSE frame boundary, but the response has no terminal completion marker. All data frames identify `big-pickle` and one completion ID. Reasoning text is retained in the original wire file; this review reports its count and hash rather than copying it into another output. These fragments and bytes are not token counts. No prompt, reasoning or completion usage can be recovered from the saved SSE. Usage was requested, but the stream stopped before a usage record arrived. `C/ACCOUNTING.json:38-43` correctly leaves one call's usage unknown. Its zero completed-cost sum covers zero completed responses; it does not establish zero resource use or a measured bill for the failed call. `P/catalog-receipt.json:37-42` records explicit zero catalog pricing, which has a different evidentiary scope.

The timeline places the abort at the provider deadline. Times are UTC on 17 September 2026; file times below are receipt-write mtimes, not separately instrumented network events.

| Event and time source | Time |
| --- | --- |
| Campaign start, `C/RESULTS.json:2` | 08:52:25.135 |
| Generation attempt start, `C/GENERATION_JOB.json:14` | 08:52:25.442 |
| Input and copied adapter written, `P/task/input.json` and runtime-copy mtimes | 08:52:25.775 |
| Catalog receipt written | 08:52:25.995 |
| Private server readiness receipt written | 08:52:26.948 |
| Wire request and original native headers written | 08:52:27.125 |
| First provider `created` value in model SSE | 08:53:39.000 |
| Last provider `created` value in model SSE | 08:54:55.000 |
| Partial body saved after abort | 08:54:55.778 |
| Sandbox/failure/transport receipts written | 08:54:55.781 |
| Generation attempt finished, `C/GENERATION_JOB.json:11` | 08:54:55.783 |
| Campaign finalized | 08:54:55.973 |

The input-write to partial-save interval rounds to **150,003 ms**, with the timer established immediately after those input/runtime-copy writes. The whole generation attempt lasts 150,341 ms, including work before the adapter timer begins. The sandbox ran **149,780 ms** and ended with **SIGTERM**, below its own later-starting 150,000 ms timeout (`P/sandbox-process.json:46-50`). The wire-request record precedes the partial save by 148,653 ms. Thus the configured provider limit covers catalog acquisition and private-server startup as well as provider streaming; it is not 150 seconds of output generation.

SSE `created` values belong to the provider clock and are only second-granular. Their first value is roughly 72 seconds after the local wire-request receipt and their last value is in the abort second, but this is not a measured local time-to-first-token. The 14 preceding keep-alives show response-body activity without recording local arrival timestamps. Queueing, prompt processing, inference latency and clock skew cannot be separated from this trace. More time might permit completion; this run does not prove that it would.

The exact source explains the misleading label. `src/opencode-v2-free.mjs:205-208` creates one controller and sets `deadlineExpired=true` before aborting it when the provider deadline fires. The same signal governs provider fetch/body reading at `:233-241` and the sandbox process at `:267`. The body catch at `:249-256` saves the partial response, treats a native `AbortError` as an untyped transport failure, and calls `stop`, which sets `transportFailure` at `:218`. The subprocess catch also prefers that value at `:268`. Finally, `:293` evaluates `transportFailure ?? (...)` before consulting either `signal.aborted` or `deadlineExpired`. A timeout that produces an abort during body reading can therefore emerge as `MODEL_TRANSPORT`, even though the code knows its deadline fired. Callback ordering can affect which primary label survives. This precedence defect is established directly from the unchanged source.

The abort identity was also checked using an in-memory `AbortController` on the installed Node `v24.21.0`: calling `abort()` with no reason creates `AbortError`, numeric code 20, and the same `This operation was aborted` message. This check issued no request, timer or inference. `src/process.mjs:20-27` explains the associated SIGTERM on shared-signal cancellation.

Several observations favor the adapter's own timer as the initiating cause. The stop occurs at its precise 150-second window. The later-starting sandbox timer had not reached 150 seconds. The outer generator's 360-second limit had not expired. Its saved status is `failed`, whereas `src/generator.mjs:119-124` records `cancelled` when its controller is aborted; propagated caller cancellation would ordinarily follow that latter path. No retained HTTP refusal, provider error, socket-reset cause, TLS error or premature-EOF error supports a remote failure. The response is also well below the 4 MiB byte limit, and there is no terminal length reason proving the 8,192-token cap was exhausted.

This remains a **strongly supported cause inference**, not a recorded timer-event attestation. The receipt never saved `deadlineExpired`, caller-signal state, `controller.signal.reason`, first-error time or abort origin. It therefore cannot categorically exclude a coincident unrecorded event. The exact diagnosis is: an incomplete HTTP 200 stream was locally aborted at a deadline-consistent time, and the adapter can misclassify that abort as transport failure. It is unsupported to describe this as a provider access refusal or a negative result about workflow correctness.

`P/state/generation.json`, `state/session-export.json`, `state/driver-error.json`, `state/server-stderr.txt` and `response.json` are absent. The sandbox driver saves generation output only after its awaited CLI process returns (`src/opencode-v2-free.mjs:367-371`) and then exports at `:372-379`; the outer cancellation can kill it before these steps. Its outer stdout/stderr are empty because they are not a live mirror of the model stream. The actual 199,373-byte wire receipt prevents misreading that emptiness as no model activity. The ten-line native log records startup and a disabled update check, with no terminal network diagnostic. No native SQLite database was opened to infer missing success or usage.

The next discriminating change should first correct and instrument the cancellation path in a separately reviewed revision. Record the first terminal cause **before** aborting the controller: deadline becomes `TIMEOUT`, caller abort becomes `CANCELLED`, and an actual earlier transport/HTTP failure retains its original classification. Keep the resulting body `AbortError` as secondary evidence. Merely changing the final precedence expression can wrongly overwrite an earlier transport error with a timer that fires during cleanup, so preserve cause order. Retain a small set of local timestamps for call/deadline, forward, response headers, first body/model delta, last model delta and abort, plus error name/code/cause and partial bytes. No new proxy, credentials, headers or model route are indicated.

Before any live continuation, a short supplied-stream test should distinguish deadline cancellation, caller cancellation, a network-read failure that precedes the deadline, and explicit 429/403. Require the primary classification, one forwarded attempt, preserved partial bytes and zero retry; also check that a later timer cannot relabel an earlier error. No such transport replay or product change was performed in this review. A later separately authorized, freshly frozen one-call condition can then vary only the fixed wall-clock allowance while holding the exact public prompt, model, 8,192-token cap and completion/export gates constant. Reaching terminal answer/usage versus remaining unfinished would discriminate the budget hypothesis. The historical 150-second attempt remains an incomplete budget-limited observation either way.

All **41 protocol source entries** matched their frozen hashes, and the sandbox copies of adapter, process helper and data module matched the live frozen sources. `FINALIZED.json` binds the exact existing results and accounting bytes. The **23 reviewed receipt files** have a reproducible ordered snapshot in `RESULT_REVIEW.json`; the snapshot hash is `f83aba9501835d8575533861148deb065893a92662bdde88ccdeda77d45c9900`. The original result remains SHA-256 `3afc152531528b06b20f519cb47a44f79e4324d1ad4c9b219ad79c8f3eec6e8f`, accounting remains `bac9ff50f45e01ff4ccec6326f8477d733e8a674e54d5ed4031e37ab54ea7439`, and adapter remains `5772e2d2d7ae60de702cce310af5124f8331e4c3f0c4a2ccc44d5762bafcb9c6`. Only this addendum and `RESULT_REVIEW.json` were added. No candidate evaluation occurred: preparation validated frozen fixtures on the host, but generation ended before candidate parsing, development scoring, withheld scoring or apply. Model quality, scale and future completion are unmeasured by this failed trajectory.
