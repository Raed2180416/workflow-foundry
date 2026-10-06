# Local Ollama provider: implemented, inference held

The new `src/ollama-local.mjs` is 122 lines and implements the `WorkflowGenerator` provider interface. Constructor creation performs no I/O. No actual local model inference, load, pull, unload, server change, driver change or reboot occurred in this task.

```js
import { OllamaLocalProvider } from '/home/raed/Projects/workflow-foundry/src/ollama-local.mjs';

const provider = new OllamaLocalProvider({
  model: 'qwen3.5-9b:itb',
  expectedDigest: '2afe0596021d6625b47a72567b3ce6692c2afa73a686d8bda8bd820c0b1710fb',
  timeoutMs: 240000,
  numCtx: 32768,
  maxOutputTokens: 8192,
  seed: 0,
  temperature: 0,
});
// After explicit inference authorization and successful hardware preflight:
// const { text, evidence } = await provider.generate({ prompt, directory, signal });
```

This is the proposed configuration for a later controlled invocation. **Do not invoke generation on the current hardware state.** NVML cannot establish GPU availability, and no CPU 9B load is authorized. The 32768 context setting is provisional, not a demonstrated memory-safe or truncation-free setting.

## Observed metadata

`metadata-001/RESULT.json` records the three permitted API requests at 2026-09-17T03:28:02Z: GET `/api/version`, GET `/api/ps`, and POST `/api/show` for the exact model. All returned 200. `/api/ps` was empty. The complete selected metadata and hashes are in `metadata-001/SHOW-SUMMARY.json`; no model was loaded.

| Field | Observed value |
|---|---|
| Ollama version | 0.31.1 |
| Model tag | qwen3.5-9b:itb |
| Base model metadata | Qwen3.5 9B, Qwen |
| Architecture | qwen35 |
| Parameter count | 8,953,803,264 |
| Quantization | Q4_K_M, GGUF |
| Declared architectural context | 262144 |
| Existing configured context | 8192 |
| Existing configured temperature | 0 |
| Loaded context | None observed; resident model list empty |
| System field | Absent; no empty-string hash substituted |
| Template | 7816 UTF-8 bytes |
| Template SHA-256 | 7f0e529032c25183bcd66c7f238da2d377f43be754a94e2725a58c4e16d2ed67 |
| Logical CPUs available | 16 |
| Host memory available | 5,450,268,672 bytes at inspection |
| GPU inspection | nvidia-smi exit 18; NVML driver/library mismatch, library 615.71 |

The expected manifest digest above and stored size 5,680,522,838 bytes come from the earlier, preserved `/api/tags` observation in `../opencode-v2/ALTERNATE-METADATA.json`. The new `/api/show` response does **not** contain a manifest digest, and `/api/ps` contains no loaded model. Consequently this restricted three-request inspection cannot freshly certify the unloaded tag's digest. The implementation uses read-only `/api/tags` checks immediately before and after a future inference; these reads were exercised only with supplied fixtures here. A GGUF/blob identity is not silently substituted for the tag manifest identity.

## Request behavior and bounds

The only inference request is one POST to the existing `127.0.0.1:11434/api/chat`. It sends one user message, `tools: []`, `stream: false`, `think: false`, `keep_alive: 0`, and explicit `num_ctx`, `num_predict`, seed and temperature. It cannot select a remote origin or another model, pull a model, run a tool, invoke a shell, or retry. Constructor version and metadata assumptions are pinned and checked. Raw request, parsed response, prompt, before/after digest observations, hashes, completion reason, token counts and nanosecond latency fields are retained in a unique caller-owned receipt directory.

Before dispatch it requires the expected local architecture and quantization, a working `nvidia-smi` query, an estimated GPU reserve, at least 2 GiB available host memory, and an empty resident-model list. Existing resident models cause `MODEL_BUSY` with no inference or unload request. The GPU estimate is stored size plus the eight full-attention layers' fp16 KV estimate plus 1.5 GiB runtime reserve. This is a conservative screening heuristic for the pinned metadata, not a measured allocation bound or a guarantee against concurrent memory pressure. The adapter cannot prove the Ollama daemon's eventual GPU placement merely from `nvidia-smi`.

The single request asks for immediate release through `keep_alive: 0`; there is no separate empty-prompt unload call. Cancellation aborts the request and permits only bounded, read-only after-checks. Resident state after cancellation can be unknown and is recorded that way. The empty `/api/ps` observation is not a lease: unrelated clients can race it. This minimal adapter does not claim exclusive server ownership or guaranteed unload after an abort; any later actual trial should use an otherwise idle local service.

`done_reason: length`, tool attempts, incomplete responses, model/digest drift, unknown usage and context-budget violations fail with preserved receipts. `prompt_eval_count` and actual output count are retained. The 48508-byte public prompt size was supplied by prime; this worker did not open the construction task. No tokenizer or model package was downloaded. No independent token count exists, so input truncation is explicitly **unknown**, even when the reported token count fits the requested context. No local throughput or task-quality result exists.

## Validation and source identity

`checks-b0244dba-84e0-4eef-b273-facef66b7c64/RESULT.json` and adjacent command receipts record:

- 23 local-provider fixture tests, 11 OpenCode v2 tests and 2 quota regressions: **36 pass, 0 fail**.
- Syntax checks for both provider modules and both test files: pass.
- `npm run check`: pass; the repository has no separate formatter/linter/typechecker script. Doctor does not certify task outcomes.
- Source stable across checks; legacy adapter and process helper hashes unchanged.

Fixtures intercept every HTTP request and GPU observation. They cover exact request contents, zero calls on preflight rejection, existing resident models, before/after digest drift, absent context metadata, tools, truncation reason, token budget, cancellation and terminal HTTP failures. No fixture test contacts the actual Ollama daemon or loads a model.

Local source SHA-256: `7193fbacbce7bfcc065e5db8be3a3d98b68063b20b25642c7ba732b7d11f50e9`.

Local test SHA-256: `41d2a4b93cdcd133d1aca189e805781dc73b487ae5720e3d678811a110368e2f`.

Serena activation, the full security scan and GitHub code-scanning retrieval returned HTTP 404 `tunnel_client_not_seen`. The combined quality-inventory request also failed at the connector boundary. These are unverified checks, not clean scan results. No dependencies or GitHub workflows were changed.

API reference checked: official Ollama `https://docs.ollama.com/api/chat` (chat fields, keep-alive and usage) and `https://docs.ollama.com/api/tags` (manifest digest). `/api/show` documentation was unavailable through the web fetch; actual selected metadata comes from the local endpoint receipt.
