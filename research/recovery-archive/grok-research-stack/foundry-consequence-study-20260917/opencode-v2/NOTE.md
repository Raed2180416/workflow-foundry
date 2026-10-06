# OpenCode v2 adapter: historical hold and authorized follow-up

Latest result: see `NATIVE-RECHECK-RESULT.md` and current `AUDIT.json`. The one newly authorized native-header recheck returned HTTP 200 and a verified saved native completion. A narrowly amended parser then passed full offline native replay. Exactly two public requests exist in total. The report below is the preserved pre-follow-up history; its previous HOLD applies to the first request. Its exact earlier bytes are retained at `native-header-recheck-001/previous-NOTE.md`.

Status at 2026-09-17T03:19Z: **HOLD_PUBLIC_ACCESS_REFUSED**. The implementation and offline checks are complete. The public provider has not produced a verified completion. Prime explicitly stopped further public probing after the actual HTTP 403. Do not use this adapter to start the synthesis campaign on the strength of the offline tests.

## Delivered interface and exact installation

The new `src/opencode-v2-free.mjs` exports `OpenCodeV2FreeProvider({ model, timeoutMs, maxOutputTokens })`, with `identity` and `generate({ prompt, directory, signal }) -> { text, evidence }`. The only accepted model is `opencode/big-pickle`. Default timeout is 240 seconds; prime may supply 150 seconds. Default output limit is 8192 tokens, with a permitted bounded range of 16–16384. Prompt bytes are capped at 400000. Transport and subprocess outputs have separate byte limits.

The installed program is `/usr/bin/opencode`, `opencode v2.0.5`, package `opencode 2.0.5-1.1`. Its pinned SHA-256 is `a7568b505c1fce84d329c709b5661da11a778b0e06959e34147a916111cc5be4`. The constructor and each attempt reject binary changes. No older binary was substituted.

The old `models --verbose --pure`, `run --pure`, and top-level `export` assumptions do not fit this installation. Actual invocation inside the fresh sandbox is:

```text
opencode serve --stdio --port 0
opencode run --server <that-private-server> --format json --model opencode/big-pickle --agent foundry --title foundry-output
opencode session export --server <that-private-server> <observed-session-id>
```

The prompt enters through stdin. The private server uses a generated lease password that is never included in receipts. There is no connection to the user's configured service.

## Catalog evidence

`remote-catalog.json` is the acquired official raw catalog. Big Pickle has explicit numeric zero values for input, output, cache read, and cache write. The adapter checks this raw evidence on every attempt, before passing the same catalog into the isolated program through `OPENCODE_MODELS_PATH`. This matters because v2's catalog normalization can turn absent prices into zeros.

The settled local API independently reported the same selected model, active/enabled, with one zero-price tier and no advertised variants. Receipt: `inspection/settled-catalog-a8a79d80-d43b-4a91-8c8e-82cb8853c8f3/`. This is availability and price metadata; it did not establish public inference access.

Pinned upstream source is under `upstream/`, acquired from v2.0.5 tree `79169fe966d58fb0e0a5e41133716184a0ab4ca6`. Each acquired file has an adjacent URL/revision/date/blob/SHA-256 receipt. Upstream MIT license is retained. Source is inert reference material. The installed binary's identity is independently pinned; no source-to-binary reproducibility claim is made.

## Actual probe accounting and refusal

These are the five already observed smoke invocations, in order. The counts describe inference HTTP requests, not catalog/source metadata fetches.

| Smoke directory | Local gateway attempts | Requests reaching public provider | Result |
|---|---:|---:|---|
| `tiny-probe-c385402b-c83e-48d3-9df1-f6ce81470654` | 0 | 0 | Model transport settings were not ready. |
| `tiny-probe-b0fa7681-4cea-4e77-9d2a-95110871885a` | 0 | 0 | Same readiness/overlay issue; no inference. |
| `tiny-probe-7bddc95a-ab05-48ba-9104-cd240c65288e` | 1 | 0 | Wire validator rejected additional assistant context. |
| `tiny-probe-201bc29b-1445-47b1-8653-1b54a20225e2` | 1 | 0 | Saved wire request exposed the v2 maximum-steps insertion. |
| `tiny-probe-dee7958b-8b95-4dc7-9686-63a7c45ba3d0` | 1 | 1 | HTTP 403, `FreeTierError`; no completion. |

Aggregate: five invocations, three requests arriving at the local gate, **one actual public inference HTTP request, zero successful completions**. No subsequent public call occurred.

The exact refusal is preserved in the last directory, under `opencode-v2-1c89f0f5-dc66-4e69-bf68-afa2f124565e/wire-response.txt`: the provider said its free tier can only be used from within OpenCode. `transport.json` records status 403 and one forwarded request. There is no successful live session export and no verified live runtime cost receipt. Raw zero-price catalog evidence must not be described as an independently checked account invoice or successful generation.

That first relay discarded native client-identification headers. A subsequent patch preserves the native headers produced by the actual installed CLI, as documented by pinned `session/model-request.ts`; arbitrary headers, cookies, and local-server authorization are discarded. This change was tested only against supplied offline responses. It is not a verified resolution of the public refusal. Prime stopped public probing; no identity substitution, alternate account, or access workaround was attempted.

## What the implementation checks

Bubblewrap creates fresh user/PID/network namespaces, an empty home, fresh XDG state, private `/tmp`, and read-only program/task mounts. It does not share the host network, mount the host home, or expose the repository/benchmark directory. The only egress path is a filesystem Unix socket to a host-side gate with a fixed provider origin and path. The gate validates the exact model, exact user prompt, empty tools, output limit, and native request headers before forwarding. It allows at most one forwarded request and stops on HTTP failures. HTTP 429 remains `MODEL_RATE_LIMIT`; access refusals remain `MODEL_AUTH_REQUIRED`. There is no fallback.

Exactly five model/config plugins may be active. Tool, browser, shell, skill, MCP, file and subagent plugins are absent; permission defaults deny all. The native plugin inventory is checked before prompting. Agent `steps` is 2 because **v2 `steps: 1` adds a synthetic assistant instruction demanding a progress summary on the first request**. The one-call ceiling is enforced by transport, not by that contaminated prompt mechanism.

The private model catalog is polled until the selected model and its explicit route overlay match. The v2 API deliberately permits a snapshot before initial plugin settlement, explaining the initial empty `models --standalone` result. A per-model route overlay is necessary because the catalog's model settings otherwise retain the original URL.

Native exports use typed messages, not v1 `message.info.role`. The executed model reports the native `default` variant, which is checked consistently. Completion requires exact agreement between the user prompt, session/model/agent identities, assistant text, explicit zero cost, explicit token usage, terminal stop and successful idle outcome. Additional tool behavior, retries, unknown message types, incomplete results and drift fail closed.

For fast responses, v2 can print only reconciled text without start/finish events. The adapter accepts only the native projected-text shape provisionally and requires the durable export to establish completion and cost. Text alone never qualifies.

Receipts retain raw prompt, exact wire body, completed or bounded partial response, native header subset, CLI events, session export when available, model catalog, process result, transport counts and failures. A host cancellation during a refused/rate-limited response can prevent final export; this remains a failure, never a success inferred from text.

## Verification and its boundary

Final source/test hashes and command receipts are in `checks-186bb14b-9b04-4a2e-b460-d4f9712d9661/RESULT.json`.

```text
node --check src/opencode-v2-free.mjs                       PASS
node --check tests/opencode-v2-free.test.mjs                PASS
node --test tests/opencode-v2-free.test.mjs tests/provider-quota.test.mjs
                                                         12 PASS, 0 FAIL
npm run check                                            PASS
node offline-replay.mjs                                  PASS on supplied SSE
node offline-provider-check.mjs                          3 PASS on supplied responses
```

`offline-replay-952eeb90-b2ba-4e69-81b1-3dd281e1aaed/` runs the actual installed CLI/server with a supplied SSE response and verifies its actual native export. The full production adapter is exercised in `offline-provider-check-e5142695-d8f5-4362-a05a-bb2d26d243f6/`: supplied success, HTTP 429 with retry-after 600, and HTTP 403 all pass their expected dispositions. All outbound parent fetches were intercepted locally in these three tests; external network calls and model inferences were zero. Their `forwarded` counters denote calls into the supplied transport fixture and must not be added to live public inference counts.

The repo has no separate formatter, linter or typechecker script. `doctor` is a sanity check, not task-quality certification. Serena activation, project quality inventory, full security scan and GitHub code-scanning evidence each returned HTTP 404 `tunnel_client_not_seen`. Their checks are unverified. No nested worker or broad independent security certification is claimed. Prime's separately reported wider test run is not counted as this worker's own validation.

Final new source SHA-256: `a4ba3a46724ead16d7a9b57304183f22fec0fffdc2315d44568df983e1e2fdda`.

Final new test SHA-256: `1f5d4526c59d00ee77a694f8c40df359422552bef834930934da9a9ab780871d`.

Legacy adapter remains `6848bfcba60945d1dfebf8fbf7e2461590f1c33eb85f5e2dc3bce84a347eeeca`; process helper remains `bfc97e88bb73bc8f15ba2d174ab1d97c615c3fd097e57c57964bd8bc4196bb7a`. Only the two assigned new live-repository files and this owned study directory were written. All earlier receipts remain.

## Authorized alternative metadata

`ALTERNATE-METADATA.json` records a later metadata-only check. Native `opencode service status` returned `stopped`. No auto-starting model/default API command was issued and the configured service was not started or modified. Consequently no authenticated app model was established under the no-mutation constraint.

An existing Ollama listener at `127.0.0.1:11434` returned four tags representing three distinct model digests. Observed choices include `qwen3.5-9b:itb` (Q4_K_M, 5,680,522,838 bytes; alias `itb-qwen3.5:9b`), `ornith:9b` (Q4_K_M), and `contrare/tmax-9b:q5_k_m` (Q5_K_M). Exact digests are in the metadata receipt. These are observed local artifacts, not verified generation quality or throughput. No model was loaded or called, and no secret/config-credential file was read or copied. Prime can choose the local route under a separate bounded inference decision.

There was no task synthesis, benchmark access, provider-hidden evaluation, or claim of Foundry task success in this work.
