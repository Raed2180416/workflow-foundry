# Constrained original DefaultAgent comparison, protocol v1

Prepared 2026-09-13 before any comparison model calls. Worker-8 owns this directory,
`tests/reference-swe*.test.mjs`, and the comparison dossier only. The overall work
window begins 11:46:37 UTC and ends 12:06:37 UTC. Runs must finish earlier or abort.

This is a constrained reference integration of the actual cloned
`SWE-agent/mini-swe-agent` DefaultAgent at commit
`04d809ceab9df28f9adaed044884180159172930`, version 2.4.6. Its original run,
query, execute_actions, stopping, accounting and serialization methods execute.
Only documented custom Model and Environment implementations are supplied. This
does not exercise its CLI, default bash tools, default provider, SWE-bench, TUI,
SWE-agent's separate repository, or commercial products.

The other arm must be constructed by the actual `WorkflowGenerator`, selected
Foundry skills, current schema and a custom capability catalog. Up to three
architecture attempts use only `opencode/ling-3.0-flash-fin-free` through the
existing `src/opencode-free.mjs`. Architecture prompts receive only the generic
interface contract, never concrete evaluation modules, cases, expected outputs
or solutions. No candidate output is hand-patched. Freeze its accepted bytes
before executing either task. If construction fails, report that failure.

Both arms receive exactly the same system text and task text, the same operation
parser, same output-only OpenCode Ling provider, same read/write/test/finish
dispatcher, same public test inputs and same executor limits: five model calls,
one operation per response, serial execution, 150 seconds per provider call,
300 seconds per task/arm. No alternate models, retries outside the budget,
paid providers, host credentials, model tools or human fix assistance. Provider
catalog, raw JSON events and session export must establish exact identity and
zero prices and reported cost for every model response.

Two synthetic Python modules maximum: ceiling bucket count and order of last
occurrence. Source, public cases, hidden cases, expected outputs, settings,
adapter code and relevant Foundry/upstream sources are hashed by the freezer
before the first architecture call. Task order is bucket, last occurrence; arm
order alternates reference/Foundry then Foundry/reference. No task-driven changes
after outcomes are seen. Invalid transport/sandbox/oracle evidence blocks scoring.

Concrete environment API: a response is exactly one JSON object with `op` equal
to `read`, `write`, `test`, or `finish`. `write` alone has `content`, a complete
UTF-8 replacement for the one synthetic module (maximum 16 KiB). There are no
paths, commands, environment variables, test writes, shell tools, loops or model
calls inside an environment operation. Invalid responses become a visible error
observation and consume a call. `test` checks only the public cases. `finish`
stops the native loop but cannot assert independent correctness.

Foundry catalog: `reference.query({messages})` performs exactly one executor
call, returning `{message, messages}`. `reference.act({message,messages})`
performs exactly one operation and appends its observation, returning
`{messages,done,observation}`. The native workflow must have a bounded loop,
separate query/action nodes, carry messages via `previous`, and stop on `done`.
Host checks enforce call budgets, message provenance and one operation per call;
they supply no repair policy or task solution. DefaultAgent uses these same
query/act functions through line-delimited RPC and its own message history.

Candidate Python runs only in fresh bubblewrap namespaces: no network or host
home, read-only `/usr`, read-only candidate and oracle runner, fresh temporary
storage; 2-second CPU, 4-second wall, 256 MiB address-space, 64 processes,
64 KiB output and 1 MiB file-size ceilings. The original Python agent also runs
isolated, with an empty `MSWEA_GLOBAL_CONFIG_DIR`, silent startup and a minimal
environment. Its import-side dotenv read therefore cannot read host credentials.
No upstream install hooks: dependencies are exact-pinned binary wheels only.

Independent host comparisons check actual function output for every fixed hidden
case in a fresh process. Exit status or model success declarations alone do not
pass. Expected results remain outside candidate execution. Read-only mounts and
strict operation validation prevent test edits. Controls must reject the initial
bug, a wrong constant fix, attempted oracle write, forged stdout/early exit and
infinite loop. Artifact and test hashes are rechecked after runs. Raw source,
prompts, returned text, actions, exports, trajectories, outputs and limits are
retained. A final SHA-256 manifest makes changes detectable; it is not a claim of
protection against a malicious host administrator.

Report each task and arm separately: original-agent exit/runtime status,
submission, hidden-case pass count, budget use, tokens, observed cost, latency,
architect attempts and adapter differences. Two tiny cases provide diagnostic
evidence only. There is no aggregate parity or reasoning-improvement claim.
