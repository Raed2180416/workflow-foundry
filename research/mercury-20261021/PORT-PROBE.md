# Mercury through ModelPort: live probe (2026-10-21)

**Question.** Does Inception accept a strict JSON-schema `response_format` on the ModelPort provider path
(`src/models/providers/openai-chat.mjs`)? The A1-C probe (`m3-a1c-probe-20261021`) went through the executor, which
sends no response format, so this was unconfirmed.

**Command.** `experiments/mercury/port-probe.mjs <outdir>`, with the key loaded only from the owner's env file.
One call, `allowedModels: ['claude-haiku-5-5', 'mercury-3']`, `tokenCap: 5000`, `callTokens: 3000`,
`decoding.maxTokens: 400`.

**Result.** `ok: true`. The value `{"city":"Paris","population_band":"large"}` validated against the schema (an enum
field and `additionalProperties: false`). Usage: 246 input and 47 output tokens; the meter booked 293 of 5,000.
Cost $0 at list price.

**Gaps the probe hit** (both are usability gaps, not defects in the caps):
1. **A Mercury-only session cannot build a port.** `subsetPolicy(['mercury-3'])` fails `MODEL_POLICY_INVALID: models
   must be a non-empty list`, because the subset keeps no class model. A flow-v3 stream that uses only Mercury
   would need a class model listed that it never calls. Fix candidate: allow an empty `models[]` in a subset when
   `executorModels[]` is non-empty and every call names its model.
2. **The default output allowance is 8,000 tokens,** so with the 3,000-token per-call cap a 115-token prompt is
   refused (`MODEL_BUDGET`, no request sent) unless the call sets `decoding.maxTokens`. That is correct and
   conservative. Callers that use small per-call caps must set `maxTokens`.

Mercury tokens spent in this probe: 293.

**Running total under decision D8 (≤ 5M), approximate, from the agents' reports:**

| Run | Tokens |
|---|---|
| Executor token-cap smoke: 4 sessions, each stopped at its 300K cap | about 1.2M |
| A1-C probe | 84,529 |
| This probe | 293 |
| **Total** | **about 1.3M** |
| BUILDER-1 `b-m-1` (research/surface-20261021/BUILDER-1.md; port meter, 59 calls) | 105,631 |
| BUILDER-1 `b-m-fix-1` (post-hoc fix run; port meter, 63 calls) | 106,356 |
| **Total after BUILDER-1 (2026-10-21)** | **about 1.51M** |

There is no usage endpoint, so this is a ledger, not a measurement of the remaining allowance.
