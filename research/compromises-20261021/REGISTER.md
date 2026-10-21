# Compromise register (2026-10-21)

**What this is.** Every limitation the program has accepted or run into, each with its evidence. Each one is to get a
current state-of-the-art fix from frontier research or open source (owner, 2026-10-21), judged first on efficiency and
cost. A fix is adopted only with a test that shows it works here.

**Status values:**
- `open`: no fix chosen.
- `in-flight`: a track is working on it; the track is named.
- `fixed`: fixed and tested; the evidence is cited.

## A. Model and agent efficiency

| id | Compromise | Evidence | Status |
|---|---|---|---|
| A1 | A long agent session's context grows without bound: there is no compaction for remote models, so Mercury uses about 20K input tokens per response, and every step resends history | `research/mercury-20261021/OFFICIAL-DEV60.md` (1.6M input tokens per task); executor report §7 | open |
| A2 | Agents do not know when they are done: Mercury hit the step cap on 52 of 60 tasks, and 15% of Haiku's A1 failures stop early | OFFICIAL-DEV60; DEV60-FAILURE-ANATOMY | in-flight (A1-C: code-owned termination) |
| A3 | A dollar budget never stops a $0-priced model | the 97M-token run | fixed (token meter, `experiments/autobench/test/token-meter.test.mjs`) |
| A4 | One run per task moves 10–15% of tasks, so k = 1 comparisons are noisy, and fixed k is costly | DEV60-A0-A1 replication | open (adaptive k, sequential testing) |
| A5 | There is no learned or validated escalation from a cheap model to a frontier model per node: either all Haiku or all Sonnet | the dev60 four-arm table | open (cascades, routing) |
| A6 | Mercury's `reasoning_effort` has no measurable effect, so there is no thinking-budget lever | PROVISIONING smoke | open |
| A7 | Prompt caching and batch discounts are not used systematically; only the CLI's implicit caching is | PREREG-NEED-V1 D6 cost findings | open |
| A8 | The Mercury Bash tool runs each command fresh: no persistent working directory or session state | executor report §7 | open |

## B. Evaluation validity

| id | Compromise | Evidence | Status |
|---|---|---|---|
| B1 | SOP-Bench's upstream scorer can be gamed (substring containment) | `research/sopbench-20261021/NOTES.md`; the gaming policy scores 99.6% | fixed (strict scoring) |
| B2 | SOP-Bench content_flagging's oracle is invalid (random tools) | `cf_ceiling.py`, about 36% | open (excluded; a fix needs seeded tools) |
| B3 | Raters split implied from latent requirements at κ = 0.57 | `research/intent-20261021/RATER2.md` | open |
| B4 | A1-C's dev60 numbers are in-sample (its plan was probed on the same tasks) | A1-C review finding 8 | in-flight (devCheck) |
| B5 | E8's oracle is too strict and too lenient on MR11 (downstream-failure) worlds | composition HARNESS.md §3 | open |
| B6 | E8 cannot handle same-instant duplicate delivery (MR5); every monolith loses 32–35 of 43 cases | HARNESS.md §4 | open |
| B7 | Small n (14 paired cases) gives no power; K = 1–3 builds | AGENTV-E8, COMP-1 | open |
| B8 | Popular public templates may be memorised (corpus inversion) | `research/intent-20261021/DESIGN.md` | open |
| B9 | Public-split dev numbers cannot be compared with private leaderboards | FRONTIER-20261015 | accepted (reported as such) |

## C. Isolation, plumbing and reproducibility

The orchestration attack, task #75, covers concurrency and failure more broadly.

| id | Compromise | Evidence | Status |
|---|---|---|---|
| C1 | The composition module boundary is a vm context, not a security boundary | HARNESS.md §8 | open |
| C2 | A CLI auto-update changes the harness between runs, so resume is refused | a1s-dev60-dn NOTE | open (pin or vendor the CLI) |
| C3 | Disk full killed runs, with only about 2 GB free now | 10-15 incident | in-flight (#75) |
| C4 | Usage limits kill agents mid-run | 10-15 workflows | in-flight (#75) |
| C5 | Concurrent agents edit the same files, and one agent's kill reached another | run.mjs 3-way merge; `pgrep \| xargs kill` | in-flight (#75); isolate agents in worktrees |
| C6 | The IR has no `call`, `compensate` or continue-as-new | `src/construction-durable.mjs:191` | open |
| C7 | `claude -p` puts the session account's e-mail address into the model's context. It leaked into committed run records (redacted at tip 728de1a; 4 earlier commits still hold it), and it is a possible confound in every CLI-based arm: a model can address mail to it when a recipient is ambiguous (BUILDER-1 B0 did) | research/surface-20261021/runs/JOURNALS-MOVED.md; BUILDER-1 report | open (engine: strip or declare account identity in the CLI provider; audit AutomationBench/SOP-Bench agent transcripts for it) |
| C8 | Tests and runs leave temporary directories in /tmp (4,240 directories, 1.9 GB by 17:35Z on 10-21), which filled the disk: one SOP-Bench sealed row hit ENOSPC (recorded as an environment fault, not scored) and the devCheck chain skipped three runs. The orchestrator's age-based /tmp cleanup then also deleted environment-manager files: the `/tmp/code-sign` symlink (signing broke; restored to the same target, `/opt/env-runner/environment-manager`), plus the session's append-system-prompt, command, MCP-config and lock files (not restored; the environment manager writes them at session start) | research/automationbench-20261014/runs/DEVCHECK.md; this row | open (fix: every test removes its temp dirs; a janitor that deletes only known test prefixes, never by age alone; a disk guard inside every long runner, not only in chain scripts) |

## D. Governance and the principal model

| id | Compromise | Evidence | Status |
|---|---|---|---|
| D1 | There is no principal model: the `human` node has no role, approvals carry a free-string actor, and there is no segregation of duties or delegation of authority | ATTACK-FABLE §2 (`schemas/workflow.schema.json:141`, `src/runtime.mjs:318–330`) | in-flight (OT-0, #74) |
| D2 | "Static proof at deploy" is over-claimed: there is no assurance ladder per invariant family | ATTACK-FABLE §2.2 | open |
| D3 | A replayable journal is evidence of occurrence only, with no external anchoring by default | ATTACK-FABLE §2.2 | open |
| D4 | Some licences block derived or AI use (SAP-SAM, Secure Controls Framework) | ORG-SCALE-SOURCES §5 | accepted (open substitutes) |

## E. Construction quality

| id | Compromise | Evidence | Status |
|---|---|---|---|
| E1 | A ledger existing is not the same as recall: requirement extraction recall is unstable (0.77, 0.93, 0.00) | tracker REPORT; A1 first6 0/6 | in-flight (A1-C: K = 3 unioned ledgers) |
| E2 | Spec derivation from a messy business is unmeasured | SPEC-1 not run | in-flight (#72) |
| E3 | The composed arm runs on the same budget as the monolith while doing more work | COMP-1 prereg | accepted (stated in the prereg) |
| E4 | No complete composed solver exists yet; COMP-1 is the first real test of buildability | HARNESS.md §8 | in-flight (#69) |
