# Native-header follow-up: one live completion, then offline parser repair

The separately authorized 2026-09-17T03:24:53Z tiny recheck returned HTTP 200 and exactly `{"ok":true}` through the installed, pinned OpenCode v2.0.5. Its native exported session records `finish: stop`, terminal `succeeded`, model `opencode/big-pickle/default`, 235 input tokens, 33 output tokens and reported cost zero. No task construction or hidden benchmark was involved.

Exactly **one** additional public inference request was forwarded. Across the original and new probes the total is **two**: the original HTTP 403 and this HTTP 200. All earlier five invocation receipts remain. No retries, alternate accounts, alternate models or further live probes occurred. The authorization runner reserves a fixed directory before dispatch and cannot be reused. Offline replay counters do not add to the live count.

## Native header provenance

`native-header-recheck-001/PROVENANCE.json` binds copied before/after sources and the native source receipt. The original failed invocation's adapter is retained as `before-adapter.mjs`; the header-preserving adapter executed in the new live request is `after-adapter.mjs`. All snapshots were created with exclusive writes and mode 0400. The previous root NOTE/AUDIT are also preserved there.

Pinned upstream revision `79169fe966d58fb0e0a5e41133716184a0ab4ca6`, `packages/core/src/session/model-request.ts`, lines 232–244 supplies the six native headers. The actual emitted headers captured for the new request include `user-agent: opencode/latest/2.0.5/cli` and `x-opencode-client: cli`; the three session headers match the actual native session. The bridge only copies their received values. It does not manufacture client or session identity. Original discarded header values were never captured and are not reconstructed as observed evidence.

Installed binary SHA-256: `a7568b505c1fce84d329c709b5661da11a778b0e06959e34147a916111cc5be4`. Source provenance is separately pinned; no reproducible-build identity between source and binary is claimed. Catalog checks retained explicit zero input/output/cache pricing before the request.

## Preserved integration failure and focused fix

The new live attempt's original `RESULT.json` remains **HOLD / PROCESS_FAILED**. The native CLI exited zero, but its event projection contained `step_start` followed by completed projected text and omitted `step_finish`. The old adapter rejected that event shape after preserving the durable session export. This was a parser failure, not another provider refusal.

Pinned `packages/cli/src/run/noninteractive.ts` explains the native finalization/reconciliation path at lines 224–247, 526–552 and 719–743. The only new product change permits an optional leading native start before projected text when the finish event was omitted. It still requires exact prompt/model/session/text binding, explicit zero cost, explicit usage, a durable stop and terminal successful idle. Arbitrary partial text, duplicate starts, misplaced starts, unknown parts, tool attempts and contradictory exports remain rejected.

`native-header-review-001/SAVED-LIVE-REVALIDATION.json` validates the actual saved completion using the amended parser. `native-header-review-001/RESULT.json` then exercises the full production adapter and actual installed CLI/server with the recorded live SSE supplied locally. That replay passed with **zero additional external requests or model inferences**. This establishes the final adapter on saved native data; it does not rewrite the original failed process receipt or claim a second live test of the amended parser.

## Interface and recommended next experiment

The existing export remains `OpenCodeV2FreeProvider({ model, timeoutMs, maxOutputTokens })`, with `identity` and `generate({ prompt, directory, signal }) -> { text, evidence }`. A prime-authorized construction can select `model: 'opencode/big-pickle'`, `timeoutMs: 150000`, `maxOutputTokens: 8192`. Each generate call rechecks the binary and explicit zero catalog prices, uses an isolated private native server, and allows at most one forwarded request. This worker did not start that construction. A successful tiny prompt does not establish long-prompt quality, task correctness, future availability or an independent billing audit.

Final adapter SHA-256: `5772e2d2d7ae60de702cce310af5124f8331e4c3f0c4a2ccc44d5762bafcb9c6`.

Final test SHA-256: `b6ab1e50173501254a267c9f7b151de5e0b3c3e0699359c131f13a14ae7954ee`.

The shared follow-up check receipt is `../local-model/checks-b0244dba-84e0-4eef-b273-facef66b7c64/RESULT.json`: 36 focused tests passed (11 v2, 23 local-provider and 2 quota), four syntax checks passed, and repository doctor passed. Source was stable. Legacy adapter `6848bfcba60945d1dfebf8fbf7e2461590f1c33eb85f5e2dc3bce84a347eeeca` and process helper `bfc97e88bb73bc8f15ba2d174ab1d97c615c3fd097e57c57964bd8bc4196bb7a` remain unchanged. Plugin security, Serena and GitHub scan evidence remain unavailable with HTTP 404 `tunnel_client_not_seen`.

The local Ollama alternative is implemented and fixture-tested separately in `../local-model/NOTE.md`; actual local inference remains held because of the NVML failure and unqualified input token/memory budget.
