# Product / repository

## Provenance and inspection depth
Exact upstream URL, retrieved UTC time, revision, license, local path, file count.
Classify: full implementation / partial SDK / skill pack / benchmark / public
product documentation. List inspected source paths and line ranges. No inferred
proprietary internals presented as facts.

## End-to-end trace
Input -> routing -> context -> planning/control -> tool execution -> state writes
-> verification -> termination. Identify real entry points and consumers.

## Contracts
State types, persistence/replay, concurrency/joins, retries/cancellation, tool
permissions, context/memory, approval/escalation, output/evidence, deployment.

## Failures and falsifiers
What fails, what is unverified, what can silently pass, what is only claimed.
For each reusable principle: source evidence, applicability conditions, a concrete
counterexample, executable validation idea and known cost/complexity tradeoff.

## Comparison suitability
Can we substitute executor models? Run locally? Need credentials/services/hardware?
Available benchmarks, contamination/exposure risks, license and redistribution
boundary. Never equate benchmark fixtures with the product itself.

## Extracted requirements
Use identifiers `<domain>-<number>`. Record requirement, rationale, evidence,
candidate runtime/skill enforcement and a falsifying test. State support level.
