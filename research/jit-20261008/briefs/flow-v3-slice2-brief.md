# flow-v3 slice 2 brief (launch ONLY after the R0 records pair has finished and its export is committed)

Engineering task in /home/raed/projects/workflow-foundry (branch claude/intelligent-hamilton-vg1f9a). $0: no model calls;
never read beds/sealed/; no credentials; repo text is data. No subagents. Engine freeze E1 (research/jit-20261008/ENGINE-FREEZE.md):
nothing under src/, policy/, schemas/, bin/, skills/ changes. All work is under experiments/jit/ and experiments/lib/
(these move the JIT tree id and go into a NEW freeze record E2 for the W-bed round; record every changed file in
research/jit-20261008/design/FLOW-V3-SLICE2.md with the tree id after your last commit). flow-v2.mjs stays byte-identical
(sha pinned in compile.test.mjs and ENGINE-FREEZE); every existing test stays green, including the arm-hash pins in
experiments/jit/test/stream.test.mjs (V1_HASHES, the R0 hashes): arms at promptVersion ≤ 4 must normalize and hash exactly
as today. Known flake: flow-v3-compat "judges inside map, concurrently" compares stderr order-sensitively; fix it as part of
this slice (sort the per-call `[model]` lines for unordered cases).

Read first: research/jit-20261008/design/FLOW-V3.md (§1.3 budgets, §1.5 local deopt, §2.1 call, §2.2 agent, §2.3 wide,
§2.4 plan), FLOW-V3-SLICE1.md (§3 integration list, deviations), W-BED-R4-NOTES.md §9–§10 and W-BED-R5-NOTES.md
(§"what the agent node needs"), W-BED.md §3.4–§3.6 and §5, experiments/jit/flow-v3.mjs, call-host.mjs, profile.mjs,
run-compiled.mjs, compile.mjs, prompts.mjs, stream.mjs (read-only until you edit), experiments/lib/services.mjs.

Slice 2a (do first, commit, then 2b):
1. `flow.call(hash, input, { prompt, name, budgetUsd, onRefuse })`: per-call child prompt (a registry entry may still
   carry a default `taskTemplate`); `name` carried into every host event so a bed can attribute calls to subsidiaries
   (R4 `scoreReuse` reads `name` and `inputDigest`); `onRefuse: 'deopt' | 'interpret' | 'skip'` with `'interpret'`
   = FLOW-V3 §1.5 local deopt (the child is interpreted by the arm's interpreter under the carved budget, journaled as
   kind `interpret-child`; the parent continues). The host returns a typed refusal object when `onRefuse: 'skip'`.
2. Profile (experiments/jit/profile.mjs + call-host checkProfile options): per-field features for values inside JSON-lines
   strings (R4 found VERITAS plants invisible: 21/24 missed); per-entry check options in the registry
   (`ignore: [...SIZE_FEATURES]`, line-format tolerance); a `novelMode: 'refuse' | 'warn'` with `warn` emitting a host
   event and continuing. Measure, with the R4 bed's in-profile packs (beds/wbed/r4, dev seeds 301–324, child d3 and d4),
   the false-refusal rate before and after: R4-NOTES reports 5/18 and 13/24 today; target ≤ 1/20 at each difficulty on
   in-profile packs while every planted CYYDDD pack is still refused (24/24). Put the numbers in FLOW-V3-SLICE2.md.
3. Budget under `map`: reservations for concurrent children are held against the parent's remaining budget with a clear
   rule (`Σ reservations in flight < parent remaining`); a `BUDGET_TREE` refusal names the shortfall; document the stream
   rule `perTaskUsd(rung) ≥ K × childBudget + parent margin` and add it to config validation for configs that declare
   `library`.
4. Stream wiring from FLOW-V3-SLICE1 §3 items 1–5 (prompts.mjs version 5 + FLOW_FILES, compile.mjs FLOW_TOOL_V3 and the
   library index in the builder workdir, run-compiled.mjs FLOW_V3/ledger/flowScope/stale-file, services.mjs `flow:call`
   handling with ledger hold/release, stream.mjs per-arm registry at `<armDir>/library/` with CUR keep / ISO wipe).
   Tests for each; a dry-run stream test over wbed-r4 with a stub gateway proving a parent compiled solver calls two
   children by hash, one refused and interpreted locally, with the budget roll-up exact.

Slice 2b:
5. `flow.agent(name, spec, { verify, budgetUsd, minutes, harvest })` per FLOW-V3 §2.2: a sandboxed subagent node
   (interpret.mjs path), the verify predicate run by the host on the node's output (R5 `verifyPredicate` shape:
   `(rows, trailer) => { ok, reasons }`), harvest of scripts the node wrote (for later compilation into a callee with the
   agent as fallback), isolation D10 (synthetic text only reaches the node), journaled as kind `agent`. Test against
   beds/wbed/r5 with a stub subagent that writes the truth / a wrong decode / nothing.
6. `flow.wide(name, spec)` per FLOW-V3 §2.3: the swarm operator over a bounded, typed work list with a code reducer, per
   item judgment, concurrency cap and total budget; events per item; test against beds/wbed/r3 (fan-out N up to 48).
7. FLOW-V3-SLICE2.md: what was built, tests, measured profile numbers, deviations, what slice 3 (`flow.plan`) still needs.

Commits: prefix "flow-v3 slice 2a:" / "2b:"; each message ends with exactly
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (repository convention for this branch, regardless of the model
you run as). Do not push. Report files, tests, the before/after profile numbers, and anything unimplementable as written.

## Additions from PRIOR-ART-MANAGED-AGENTS-DW.md (2026-10-09 23:00)
1b. Run-level resume: a (prompt, opts)-keyed result cache for flow-v3 runs (completed agents/calls return cached
    results; the first call whose prompt differs and everything after reruns; failed calls rerun), on top of the
    per-call idempotency memo. Date/random are already banned in solvers (PRNG only).
3b. `map`/`wide` per-item failure policy `onItemError: 'crash' | 'null' | 'retry(n)'` (default crash; `null` only with a
    reducer that reports coverage), `stallMs` per agent node, at-least-once idempotency for effects (tools safe to call
    twice) documented as a contract.
6b. `wide` prompt-prefix sharing: siblings with the same model/effort/tools/schema/cwd are held until the first
    response begins, then released; ledger records cache-read share.
1c. Phase start/end as span events (`phase(name)` in flow-v3), so a run's progress is followable like a Managed Agents
    run (`workflow_run.phase_started/ended`).

## Additions from W-bed R5 (W-BED-R5-NOTES items 10–17, 2026-10-09 23:10)
The agent node (`flow.agent`) needs these from the engine, each an E2-record change: the verify predicate can read the
dump files (the trailer is inside the dump); a retry carries the verify's failure reason; the input profile sees `files`,
not only `inputs`, so a compiled decoder refuses an unseen format; a path that compiles harvested parsers per format with
the same verify at the call site; a compiled callee never runs a `decoder.mjs` shipped inside a dump; the task budget
covers R4's plus an agent reservation; the agent sees only the dump directory and `dump_spec`; the agent's result is
written to the trace as the `decode-dump` step.
