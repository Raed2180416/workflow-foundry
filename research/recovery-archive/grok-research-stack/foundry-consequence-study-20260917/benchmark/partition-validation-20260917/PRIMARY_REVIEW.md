# Primary partition validation result

The exact prime-supplied `../outcome-model-001/REPAIRED_CANDIDATE.json` was executed once using the frozen `run-v2.mjs primary` runner. Process session 17917 completed with exit code 0. All 98 cases passed native v2 evaluation, independently expected manifest JSON, and independently required instrument-attempt multisets. All 98 runs reported `succeeded`; false successes were zero.

The suite was frozen at 2026-09-17T08:47:36.589Z and the runner addendum at 2026-09-17T08:50:30.718Z. The first recorded candidate read was 2026-09-17T08:53:40.912Z. Verification after execution confirmed both freezes and their referenced files unchanged. The preserved candidate bytes match the recorded candidate file hash.

| Check | Observed result |
| --- | --- |
| Native v2 outcome | 98/98 passed |
| Independent exact manifest | 98/98 matched; zero artifact read errors |
| Independent permitted attempt multiset | 98/98 matched |
| All-status completion before publication | 98/98 passed; zero incomplete attempts at publication |
| Independent/native diagnostic agreement | 98/98 |
| Saved native evidence binding | 98/98 passed |
| Missing, forbidden, duplicate calls | Zero each |
| Native log binding, completion, reproduction order, premature confirmation, publication binding errors | Zero each |

There were 197 screening attempts and 128 reproduction attempts: 325 attempts total, comprising 291 returns and 34 thrown errors. The independent synthetic cost was 1,477 units and matched every case's observed accounting. Native actual cost was zero. The reports contain 4,980 native events and 1,799 total steps; the per-run step range was 7–43. The product limit remained 160.

Every frozen group passed: 54 reproduction tensor cells, 18 screening contrasts, one reproduction error, two whitespace evidence cases, five batch-length cases, four input-order permutations, six length-six stress cases, and eight identical-input evidence/claim contrasts. These are 98 executions and 197 sample rows.

The independent replay reads actual manifest files from each workspace's `.foundry/artifacts/<runId>/manifest.json`. It compares those bytes as parsed JSON to expectations authored before candidate exposure, checks required versus observed attempt multisets, and recomputes publication completion using independently derived requirements and native v2's audited attempt/publication intervals. The all-status rule remains a non-gating diagnostic; the native confirmed-before-publication rule remains a gate.

This review inspected saved bindings and aggregated all saved cases. It does not claim a separately implemented raw-event auditor. An optional command to inspect a raw Store example and discover ancestor instruction paths was blocked by the tool because it could not determine the request's safety status. That command supplied no evidence. The completed native event audit and frozen runner's independent replay are the basis of the interval findings above.

## Evidence bindings

| File or identity | SHA-256 / native digest |
| --- | --- |
| Candidate file bytes | `a7edbdfa47d63b836203f8e9199d9aebff94c066cd8bd00a8b768d5383d32f09` |
| Native workflow digest | `1c88cfc1168d192c8e8e1d0f498f84bc64ceeedfa1c5f73492421c0facc239ac` |
| Original `FREEZE.json` | `f885328ae2675d3b69fe8e5e77d618368f5ea7fb248978792eab813c76148a83` |
| `RUNNER_ADDENDUM.json` | `34990b01b5725d745cd5967f26abddc60dc2c29537875a66df2119e767d99a7b` |
| `primary/RESULTS.json` | `38530fce107366e42f5ac580c4fd09fffc3a5e18b326123df9755b4808960e4d` |
| `primary/evaluation/REPORT.json` | `42976f42a75d1874a583626cb5aff87dc2845ce1c9ee4df2c22f52a5915df738` |
| `primary/BINDING.json` | `b26df8f6a53a14af5ab91459047a85943e58049d8a5229df4d105179934e3879` |
| `EXECUTION-primary.json` | `2dad0bf42d57c11d34f25f312e8c9d8e37f4cc60d2ddb5fb9ad7fe8b550939f8` |

The native v1 report, v2 report, all case stores, actual artifacts, supplied candidate copy, binding receipt, and independent replay results remain under `primary/`. The execution allowance consumed is 98. Neither `EXECUTION-counterpart.json` nor `counterpart/` exists; the second 98-case slot remains available only for a subsequent explicit prime instruction. No mutant was executed and no candidate information or results were sent to the builder.

Passing establishes conformance for the exact supplied candidate on these frozen schema-valid fixtures and specified finite contrasts. It is not universal correctness, population generalization, proof of causal use, exhaustive asynchronous scheduling coverage, or broad model qualification. Malformed returns outside advertised schemas, arbitrary six-sample combinations, timeout/cancellation behavior, storage corruption, and arbitrary host implementations are outside this study.
