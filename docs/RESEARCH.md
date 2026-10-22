# Research log

The distilled history of the Workflow Foundry research: the thesis, what was
tried, what happened, and what is still open. Raw evidence (run directories,
receipts, frozen databases) is not in git; see "Archives" in the
[README](../README.md#archives-and-history). Negative results are kept on purpose.

## Thesis

Most useful agent systems depend on a hand-built, domain-specific harness: what to
inspect, in what order, what counts as enough evidence, which actions are legal,
when to repair or ask a human, and how to tell that the task is really done. The
question is whether an existing agent can instead **build the right workflow for
the task at hand**, then validate it, run it, inspect it, revise it from evidence
and human feedback, and keep successful workflows for reuse.

Two claims have to stay separate:

1. **The substrate** is real: a typed workflow IR, a persistent runtime, evidence
   and authority boundaries, human steering, trial/repair/proposal lifecycles, a
   visual UI, installers, MCP, adapters, domain skills and an adversarial test suite.
2. **The research claim** is open: nobody has shown that a cheap or modest model
   plus these skills can reliably construct specialist-grade harnesses across
   domains without routine human checking.

### How the idea evolved

It started with training a small specialist "harness model". That is no longer
required. The current approach is:

- put workflow-engineering knowledge into portable `SKILL.md` packs (generic
  construction, runtime semantics, steering, evaluation, components, domains, adapters);
- give an ordinary model the task, the real capability contracts, the relevant skills
  and the prior workflow state;
- require typed executable workflow JSON, not prose;
- judge it with deterministic host checks plus independent outcome tests;
- keep failed candidates and revise through version-bound proposals.

A distilled workflow architect may come later as an optimization. It is not a
prerequisite.

### Relation to ARC, AMP and the Neural Core

- **ARC** is the durable operating substrate: authority, trusted capability
  catalogs, task state, provenance, isolation and long-running execution. Foundry
  does not provide those just by being an MCP server. An agent with an unrestricted
  shell can still bypass it.
- **AMP** is the semantic/context interface. It is **not** the workflow compiler.
  Foundry owns its own IR. Integration must be proven against AMP's real
  interfaces, not by naming convention.
- **Neural Core** asks whether active cognition can learn to generate and revise
  its own "ways of thinking". Foundry is the explicit, external procedure layer. A
  future Neural Core could act as its architect, and Foundry traces could serve as
  training material. Do not conflate the two.

## Outcome, falsifier and promotion criteria

**Intended outcome.** An existing modest agent builds a task-specific workflow from
explicit engineering process, domain knowledge and capability contracts. It can
inspect the workflow visually, revise it from natural language, execute it under
bounded authority, and reuse evidence-backed versions. Success means executable
task outcomes, not attractive Markdown or a diagram.

**Falsifier.** The hypothesis is falsified for a tested envelope in two cases: the
skill system does not improve held-constant model behavior, or it reaches reference
success only through hidden human repair, stronger executors, excessive budgets or
weakened verification. A falsifying result changes the mechanism. It does not
erase the negative evidence.

**Promotion criteria.** All of these are required:

- no known critical failure in the declared envelope;
- an evaluator that fails on injected bad cases;
- reproducible environment, source and model records;
- successful restart and stale-edit probes;
- predeclared performance margins against an accessible reference.

A scalar rating or a model's confidence cannot override these gates.

## Timeline

| When | Where | What |
|---|---|---|
| 2026-09-13 to 09-15 | Grok research stack, then ChatGPT/Codex | Core product: runtime, store, MCP, skills, UI, packaging, evals. Pushed 09-15 (`3954dce`). |
| 2026-09-15 to 09-17 | Local only (`~/Projects/grok-research-stack`) | Consequence study: construction modules, outcome repair, outcome history, free/local provider adapters. Not pushed until 10-06. |
| 2026-09-17 09:16 UTC | `continuation-checkpoint-20260917` | **Last real research checkpoint.** No campaign left running. See [research/checkpoint-20260917/](../research/checkpoint-20260917/). |
| 2026-10-06 | Codex recovery, finished in Claude Code | Recovered the unpushed source, reran the tests, published the evidence release, cleaned up the repository. |
| 2026-10-06 | Cloud session (Phase 0) | Node 24, environment probe, model policy file, OpenCode (version, sha256) allowlist, recorded skips, D6 decided (LangGraph/n8n adapters deleted), local CPU models via llama.cpp, Claude models via the session's `claude -p`. Suite: 605 tests, 590 pass, 0 fail, 15 recorded skips. |

## Experiment ledger

All of these are diagnostic development runs on OpenCode free models
(`opencode/big-pickle`, `opencode/ling-3.0-flash-fin-free`). Haiku 4.5 was never tested.

| Experiment (date) | Result | Supported conclusion |
|---|---|---|
| TUI smoke (09-13) | 1st attempt: denied writes from a sandbox path-permission error. 2nd: correct file. | The harness works. This was one environment smoke, not a success rate. |
| Matched incident pair, Big Pickle (09-13) | Baseline timed out with no candidate. Skills arm: 7/8 states. After one declared correction round, both arms 8/8. Wrong-type follow-on: skills arm **0/21** (21 false successes), baseline 7/21. | Procedural skill text alone is not a reliability mechanism. Passing the original cases says little. |
| SRE host-evidence campaign (09-13) | Skills-only candidate: 41/55 on default registry, **55/55** with mandatory host evidence contracts. Host-conditioned candidate: 55/55 with contracts, 34/55 without. | The gain belongs to **host-side evidence enforcement**, not better model reasoning. |
| Installed skills + MCP TUI (09-13) | Both bounded sessions failed the full chain (no run, no locator file, no final answer within 240 s). A deterministic MCP control on the unchanged candidate passed. | The server path works. The model/client path was not qualified. |
| Typed MCP TUI R1–R3 (09-13) | R1 ran correctly (`{count:3,total:21}`) but missed the locator write and `foundry_inspect`. R2 repaired v1 → v2, then delivered the **old proposal with the new run** and was rejected. R3 got HTTP 429 with no model work. Independent replay of R1's candidate passed 7 exposed checks. | No complete request-to-delivery qualification. R2 motivated the trial / repair / exact-delivery lifecycle. |
| mini-SWE-agent reference comparison (09-13) | Reference-01 was invalid because of source drift. Reference-02 bucket task: original DefaultAgent 70/70 and submitted. Foundry workflow repaired code to 70/70 but hit HTTP 429 before submitting. Second task: both arms hit provider unavailability. | Promising partial coding behavior. There is **no** parity or noninferiority result. |
| Visual product demo, Ling (09-13) | Three attempts: invalid JSON at offset 1837, invalid JSON at offset 1884, then valid JSON with an empty nested acceptance rejected by the schema. Nothing executed. | Parser diagnostics and nested-acceptance checks were tightened. No candidate was hand-repaired. |
| Outcome repair checkpoint (09-17) | Run "succeeded" with a wrong artifact. Unsatisfied outcome recorded, same-builder model repair passed 5 dev + 8 withheld cases, v2 applied, re-run satisfied. Independent partitions: repaired 98/98, faulty 80/98 (196 executions). Suite 645 tests, 641 pass, 4 opt-in skips. Opt-in run: 82 checks pass. | A working model-in-the-loop repair mechanism on **one synthetic objective**. The fault and expectation were supplied. This is not general intent satisfaction. |
| Free-provider construction (09-17) | Big Pickle returned one 150 s HTTP 200 stream with reasoning only: no answer, no usage. | An error-precedence bug was fixed and tested offline (23 checks). No successful hosted rerun yet. |

### 2026-10 cloud session (development evidence; Claude CLI route and local CPU models)

| Experiment (date) | Result | Supported conclusion |
|---|---|---|
| Records single-call calibration (10-06) | Sonnet 5.5 single call 6/6 (d1–d3, ≈ $0.08–0.18 per task); Haiku 4.5 single call 0/6. K = 1. | A single strong call is a strong baseline on `records`; Haiku alone is not enough. |
| Haiku thinking on an extraction node (10-07) | With default thinking, Haiku spent ≈ 5.2K output tokens per 6-row extraction call and scored *lower* than with thinking off (`MAX_THINKING_TOKENS=0`): field accuracy 0.84–0.91 vs 0.98, at 3–4× the cost. | For narrow typed extraction, thinking hurt. `reasoning: none` now really disables it on the CLI route. |
| Hand-written records workflow on Haiku (10-07) | After moving date and amount parsing into code (the model returns raw spans): 3/3 d2 dev tasks pass at $0.086/task; d3 still fails (0.90, 0.95). K = 1, dev seeds. | Code-owned parsing turns a failing cheap workflow into a passing one at d2, at about the cost of one Sonnet call: parity, not savings yet. |
| Local generative models as node executors (10-07) | Screening the records extraction node against Sonnet reference outputs (leaf agreement, threshold 0.98): Qwen3.5-2B Q4_K_M 0.80 on 4 calls at **268 s per call** (4-core CPU, no GPU); Granite-4.2-3B Q4_K_M 0.38 with 2/4 schema failures; Qwen3.5-4B stopped before screening. | **Negative.** On this VM, local generative models are too slow and too weak for node execution. Parked by owner decision; Haiku is the cheap executor. Kev (typed judgments, one prefill pass, ≈ 1.4 s per question) is kept. |
| P1 `p1-records-v3` (10-07/08, pre-registered, [report](../research/core-20261006/REPORT.md)) | Hand-written workflow on Haiku 5.5 nodes 35/36 at $0.016/trial; one Sonnet 5.5 call 28/36 at $0.247; Haiku 5.5 agent 29/36 at $0.111; **Haiku 4.5 single call 0/36**. | A good workflow makes a cheap model reliable and cheap. Its author was an Opus agent that had studied the family, so this is a ceiling, not construction. **Negatives kept:** (a) the workflow's own verdict said "pass" on its one oracle failure; (b) an unstated 300 s per-call limit cut off 30 of 108 Haiku single-call trials (29 at d4) and the timeouts were recorded at $0, so single-call costs are understated (corrected post hoc in the report); (c) Haiku 4.5 is not usable on this family. Seeds 5001–5006 are burned. |
| C0 dev construction round (10-08, directional, [report](../research/construction-20261006/REPORT-dev.md)) | Haiku 5.5 writing a script: 16/16. Haiku 5.5 writing the JSON IR: 11/16. Opus 5.5 IR: 16/16 at $0.075/trial. Opus 5.5 agent: 16/16 at $0.506. All 8 constructions passed 24/24 probes. All 9 construction defects came from cases no probe contained. The F verdict was `pass` on all 5 oracle failures. | **Negative for the IR as an authoring surface for cheap builders**, and for probe-based acceptance. These results led to the JIT pivot ([THESIS-JIT](../research/jit-20261008/THESIS-JIT.md)). Seeds 6001–6004 are burned. |
| Auto-heal on the C0/P1 failures (10-08, [design and review](../research/heal-20261008/DESIGN.md) §B.6) | Counterfactual replay localised the broken node in 3/3 incidents at $0. 2 real fixes: P1 status check (promoted; the planted error was fixed 88/88) and codefix (waiting for owner approval). The records date-order incident was **not healed**: 16 attempts, none valid. $6.50 spent. | Diagnosis works. Patching typed IR cannot express a per-row guard, which is one more reason for code-first recompilation. |
| Stream-family headroom calibration (10-08, [notes](../research/jit-20261008/CALIBRATION.md)) | Haiku 5.5 agent: codefix d4/d5 8/8, incident d3 4/4, kinetics d3 4/4, all at about 2–4 cents per task. Kinetics d4: 2/4 for both Haiku and Sonnet. | **Negative for compiling these families.** When a Haiku agent already solves a family for a few cents, compiling cannot pay for itself; the router should interpret. Kinetics d4/d5 is the second stream family. |
| JIT dev stream `jit-dev-records-1` (10-08/09, dev seeds 201–216 at d3, 217–224 at d4 drift; **final, K = 1**; [DEV-NOTES](../research/jit-20261008/DEV-NOTES.md) D10, D12) | Opus agent 24/24, $13.54, $0.564/success. **JIT Sonnet interpreter → Haiku compiler 22/24** (d3 14/16, d4 8/8), $8.99, $0.409/success; a pure compiled run costs $0.0425, and compiles were $4.83, 54% of spend (D10). JIT Opus → Haiku 18/24 (d3 12/16, d4 6/8), $7.53, $0.418/success (D12). Sonnet agent 13/24, $0.543/success; Haiku agent 15/24, $0.164/success; static C0 solver 16/24 (d3 14/16, d4 2/8, silent), $0.076/success (D10). JIT Haiku → Haiku never finished: 10/19 at the 04:22 snapshot ([FRONTIER-GAPS](../research/jit-20261008/FRONTIER-GAPS.md) §0.1). | Development evidence only: dev seeds, K = 1, one compile lineage per arm. The gap from JIT Sonnet → Haiku to the Opus agent (22 vs 24) is inside the noise band, and at 24 tasks the one-time compile cost dominates (D10). The Sonnet → Haiku vs Opus → Haiku gap is not evidence about interpreter strength: it splits 5 tasks to 1, exact McNemar p = 0.22, measured by a dossier agent on data since lost (DEV-NOTES D13, dossier 1). **Negatives kept:** silent compiled misses at the fuzzy identity threshold, including 2 wrong compiled answers of 19 in the Sonnet → Haiku arm (D1; FRONTIER-GAPS §0.1); the Haiku → Haiku arm learned a systematic conflict-resolution error from noisy traces, so a weak interpreter yields weak traces and weak shadows (D2); a static solver fails silently on drift (D5); leaf agreement under-counts semantically equal judge outputs, so a tier-down must be screened end to end (D6); N-version unanimity failed in common mode on s214, across two independent lineages (D8, corrected); a heal widened a guard and turned refusals into silent failures, 6 of 8 d4 tasks wrong in the offline probe, not the stream (D9, corrected); tiering down the high-leverage `rules` judge gave Haiku 5/8 and Sonnet 3/8 against Opus 7/8 (D11, corrected). The 2026-10-09 errata in D8, D9, D11 and D12 correct counts in those entries. |
| JIT dev stream `jit-dev-kinetics-1` (10-08/09, dev seeds 201–216 at d4, 217–224 at d5 drift; **partial, raw data lost**; [DEV-NOTES](../research/jit-20261008/DEV-NOTES.md) D14) | Snapshot at 04:22 UTC; the JIT arms were still running when the cloud container was destroyed ([FRONTIER-GAPS](../research/jit-20261008/FRONTIER-GAPS.md) §0.1). Haiku agent 17/24, $2.10. Sonnet agent 17/24, $7.40. JIT Haiku → Haiku 8/12, $12.09 (compiles $9.63). JIT Opus → Haiku 15/17, $17.82 (compiles $11.56). JIT Sonnet → Haiku 4/8, $15.59 (compiles $13.94). No Opus agent arm. | Partial, K = 1, dev only; the arms cannot be finished or compared. **Negative (dev cost):** compile spend alone was 4.6–6.6× the Haiku agent's whole 24-task stream (FRONTIER-GAPS §0.2 S7). Haiku compiles were often rejected, and Opus fallback compiles cost $3–7 ([HANDOFF](../research/jit-20261008/HANDOFF.md) §2). Part of the rejection is an instrument artefact: exact comparison of fitted numbers (DEV-NOTES D7) and a case-sensitive acceptance regex (D13, dossier 5 N2–N3). |
| Loss of the dev stream run data (10-09) | Lost with the cloud container: every compiled `solve.mjs`, trace, BUILD-NOTES, `compile.json`, `events.jsonl`, `results.jsonl` and `journal.sqlite` of both dev streams, plus the Kev held-out, calib-OOD and OOD material and the wave-A built datasets ([BLOCKER-SYNTHESIS](../research/jit-20261008/BLOCKER-SYNTHESIS.md), "What changed since the dossiers were written"). Why: run data lives under `experiments/runs/`, which is gitignored (`.gitignore` line 13). The handoff snapshot copied it to `research/jit-20261008/handoff/runs/` and packed the journals into `journals.tgz` (`research/jit-20261008/handoff/snapshot.sh` lines 9–12). `*.tgz` is gitignored too (`.gitignore` line 10), the rest of `handoff/runs/` never appeared in any commit (`git log --all -- research/jit-20261008/handoff/runs` is empty), and the snapshot script discarded its errors (`2>/dev/null`; BLOCKER-SYNTHESIS §2.0 S0-1). It was never pushed. | **Negative (process).** `report.mjs` and `durability.mjs` have no inputs, so the dev write-up uses only the numbers already written down. Every "$0 replay" or "archived traces" experiment now needs a fresh dev run, on an engine that has changed since (BLOCKER-SYNTHESIS, "What changed"). The dossier measurements in DEV-NOTES D13 cannot be re-verified. What survives: the numbers in DEV-NOTES, HANDOFF §2, FRONTIER-GAPS §0 and CALIBRATION; `nversion-records-dev.json`; the tier-down summaries; the static C0 solvers; the bed generators and dev configs. Fix to build before any new run: persistence with a check that the files reached git (BLOCKER-SYNTHESIS §2.0 S0-1). |
| AutomationBench dev60, four arms with the date note (10-15/21, [report](../research/automationbench-20261014/runs/DEV60-A0-A1.md)) | Haiku alone 9/60, Haiku + A1 harness 18/60 ($0.94), Sonnet 5.5 alone 20/60 ($6.03), Sonnet + A1 28/60 ($6.92). The Haiku lift replicated (p 0.035 and 0.013). Haiku + A1 vs Sonnet alone: 8 vs 6 discordant (p 0.79). K = 1, public-split devTrain tasks; 15 Sonnet + A1 tasks ran on a newer CLI. | The procedure harness lifts both models by about 13–15 points. A cheap model with the harness ties a frontier model alone at 1/6 the cost on one-shot tasks. Not comparable with the private leaderboard. |
| AutomationBench failure anatomy (10-15, [doc](../research/automationbench-20261014/runs/DEV60-FAILURE-ANATOMY.md)) | Of 80 failed A1 runs: 30% miss exactly one check, 15% stop early (≤ 10 responses, ≤ 1 write), 14% never touch the resource the failed check names. | The gap is mostly mechanical (discovery, termination, one exact detail), which code can own (A1-C). |
| AGENTV-E8 (10-15, [prereg §10](../research/enterprise-20261014/AGENTV-E8-PREREG.md)) | Haiku agent + in-session validator 12/14 vs agent 10/14 vs Haiku-built workflows 14/14. 0 invalid outputs (was 27). The two remaining failures are semantic batch-keying errors. | Inconclusive by the frozen rule. The agent's gap is not only form errors. |
| E8 builders (10-14, [B1-E8-DEV](../research/enterprise-20261014/B1-E8-DEV.md)) | Haiku + practice-world loop 1,022/1,022 cases, 14/14 sized, $0.39 (3 of 3 lineages after N-version repair). Opus 5.5 one-shot build 27.5%, 5/14, $7.63. | On construction, a cheap builder with a practice loop beats a frontier builder without one. Perfect-spec, dev worlds, Opus K = 1. |
| Intent truth inter-rater check (10-21, [RATER2](../research/intent-20261021/RATER2.md)) | Blind second rater: stated 6/6, not-wanted 23/23, L1–L3 overall 76% (κ 0.57). All disagreements are implied vs latent. | The implied/latent boundary is not reliable. The primary intent metric is recall over all unstated requirements. |
| A1-C with Mercury 3 as ledger and checker, Haiku acting (10-21, [report](../research/mercury-20261021/A1C-MERCURY-PARTIAL.md)) | 29/60 strict, partial credit 0.800, about $0.035 per task. Against Sonnet + A1 (28/60): 8 vs 7 discordant. Against Sonnet alone (20/60): p 0.078. Against Haiku-only A1-C (20/60): p 0.049. The first run stopped at its 3M-token cap after 38 tasks; a fill run finished the other 22 under D18. | A cheap planner and checker with a cheap actor ties the frontier-plus-harness arm on dev60, at about 30% of its cost ($0.035 vs $0.115 per task). K = 1, dev. The Opus 5.5 xhigh comparator (D19) has not run yet. |
| AutomationBench devCheck, looks 1–2 of 3 (10-21, [DEVCHECK](../research/automationbench-20261014/runs/DEVCHECK.md)) | Haiku alone 13/60 (partial 0.555); Haiku + A1 20/60 (0.615); Haiku + A1-C 20/60 (0.734). | The code-owned harness gains partial credit, not passes. The preregistered tie rule keeps A1, so look 3 is reserved for A1-C v2. |
| COMP-1, composed vs monolithic E8 builds (10-21, [result](../research/composition-20261021/RESULT-COMP1.md)) | All 3 composed Haiku builds load with 0 interface violations. Pooled M1 0.918 (0.944 without a load-flagged build) against the 0.95 bar; the typed variant reaches 0.945. Cost $10.77. | H-COMP is **inconclusive**: composition keeps interfaces clean but costs correctness at equal budget. K = 3, dev. |
| BUILDER-1, template builder (10-21, [result](../research/surface-20261021/BUILDER-1.md)) | Haiku template builder 18/21 verified in hidden worlds; Mercury 3 builder 18/21; one-shot Haiku 5/21. All three refused the 3 no-fit requests. | The template builder carries a cheap model; Mercury matches Haiku as builder. Preregistered, frozen code, dev worlds. |
| **Negative:** OT-0 agent arms voided (10-21) | The account session limit hit mid-run. A-F Sonnet and A-F Opus "finished" at $0.00 with 0/14; A-HV scored 3/14 with 20 rate-limit errors. The runner recorded failed model calls as outcomes. | The three arms are void, the runner now stops on environment faults, and the arms are re-running on engine v1 (amendment in `research/org-20261021/`). Any runner must treat a provider limit as a fault, never a score. |
| **Negative:** operating incidents (10-21, [register](../research/compromises-20261021/REGISTER.md) C7, C8) | `claude -p` puts the account e-mail into model context, and it reached committed journals (redacted at the tip, journals moved out of git, a pre-commit scan blocks it). Temporary directories filled the disk; one sealed SOP row hit ENOSPC (an environment fault, not scored), and a cleanup by age deleted environment files. | Never clean by age alone. Scan every commit. History is not rewritten (D17) because freeze SHAs must stay stable. |
| SOP-Bench phase 1 (10-21, [notes](../research/sopbench-20261021/NOTES.md)) | Exact parity with upstream (1,315/1,315 verdicts). Haiku agent per row 73.8% macro strict on 12 valid SOPs, $0.0022/row; majority-label baseline 38%. **Negative:** upstream's lenient scorer is gameable (an all-labels answer scores 99.6%; strict 0%), and content_flagging's oracle is invalid (random tools; truth reproducible on about 36% of draws). | Strict scoring only; content_flagging excluded. Phase 2 (build-once workflows, sealed k = 3) tests the "90% on recurring procedures" claim. |
| **Negative:** C2-1, a proven workflow reused by a separate program (10-21/22, preregistered, [result](../research/reuse-20261021/RESULT-C2-1.md)) | SOP-Bench's frozen dangerous_goods workflow, reused byte-identical by a second program (12 suppliers, 235 items) through a contract-hash registry and the preregistered producer-profile gate: REUSE 85.1% / 85.5% (lineages 1 / 2), rebuilding with the same Haiku builder (SCRATCH) 97.9% / 98.3%, Haiku agent per item 57.0% / 56.6% (K = 2). Post-hoc gate on the consumer's labelled history: 97.9% / 98.3%, 0 wrong of 91 accepted. $1.82. The gate let 32 of 112 accepted items through wrong (inverted, offset and 1–10 score scales sit inside the proven range) and refused every item on unproven branches. | The preregistered gate is **inferior** to rebuilding (D2 fails). Shape profiles of what the producer saw cannot see what values mean. |
| C2-2, consumer conformance as the reuse gate (10-22, preregistered, $0, [result](../research/reuse-20261021/RESULT-C2-2.md)) | Admit the entry for a supplier only if it reproduces the consumer's 60 labelled history products (M3 bound), then check every run against A's proof widened with that history: 0 wrong reuse in 98 accepted on fresh suppliers of every C2-1 kind, M3 `serve` (upper 0.034); the producer-profile gate on the same items 38/123 wrong. **Negative kept:** a supplier whose scale changed after the history: 17/17 accepted, all wrong. | Reuse "once proven to work" has to be proven in the consumer's program, and needs monitoring with fresh labels after admission. One entry: M3b cannot serve. |

## Failure → fix chains

The working method: preserve the failure, find the causal weakness, fix the general
mechanism, requalify without rewriting history.

- **Malformed model JSON**: parser diagnostics now carry offset, line and context for repair.
- **Empty nested acceptance**: nested map/loop bodies need nonempty, non-vacuous acceptance.
- **Skipped guard admitting a downstream effect**: prerequisites must succeed by default. Alternatives need an explicit `all_resolved`.
- **Dangling SQLite symlink**: fixed `lstat`/ENOENT handling.
- **Cancellation racing terminal work**: cancellation is checked before acceptance and terminal classification.
- **Unsafe generated schemas**: a bounded schema compiler rejects async, remote, format and regex hazards.
- **TUI object/string ambiguity**: `foundry_run` takes a real object. `foundry_run_json` parses serialized JSON exactly once.
- **OpenCode path-permission mismatch**: equivalent authorized path spellings are allowed without wildcards.
- **Old proposal + new run**: added draft trials, evidence-linked repair requests and exact delivery binding.
- **Component environment leakage**: component processes get an explicit environment allowlist.
- **Event-tail corruption**: event-chain and head verification were strengthened.
- **Weak local assertions**: independent task qualification stays outside the generated workflow.
- **Free-provider HTTP 429**: pauses the generator. No hidden retry, alternate account or paid fallback.
- **Provider abort precedence (09-17)**: the first terminal cause is recorded before shared cancellation.
- **Historical inspection ancestor gaps (09-17)**: every ancestor proposal and repair is now checked against its own request.
- **Existence-only acceptance certified wrong answers (C0/P1, 10-08)**: strict construction lint now rejects existence-only acceptance; a gate that never ran no longer counts (`GATE_NOT_RUN`).
- **Workflows authored ahead of evidence missed unseen cases (C0, 10-08)**: construction moved to compiling from interpreter traces, with guards that deoptimise to the interpreter (JIT).
- **Session usage limit stalled every run for about 3 h (10-08/09)**: runs record rate-limit faults as faults (never as failures) and resume. The fix still to build is an automatic resume scheduled at the reset time.
- **Agent sandbox path scan flagged cross-arm paths (10-09)**: the paths were inside the agent's own private mounts (the sandbox hides `/var/tmp/foundry-work` and `/root` and remounts only the agent's own workdir), so nothing leaked. The scan errs toward flagging, and that is kept.

### Retired self-audit dossiers (one line each)

These 09-13 independent-worker audits were removed from the tree. Their tests remain in `tests/`.

- Control/recovery: 25 control tests. Two cancellation-classification failures (AbortError reported as an ordinary failure) were reproduced, fixed, and then passed 25/25.
- Runtime security: 16 cases. Failures included symlink artifact-parent creation and uninstall edit loss. All fixed. The final run passed 16/16.
- Evidence contract: 55/55 after fixing fallback to older evidence and an event-head replacement that hid truncated history.
- Generator/evaluator/provider: the first audits were 51/82. Defects included symlinked artifact ancestors, malformed provider events, hidden assistant-level drift and split UTF-8. The prime fixed them.
- Dataflow construction: 48 tests. The checker rejects reference-01's impossible `last.done` wrapper. Construction behavior only.
- MCP repair lifecycle: MCP had no draft trial or repair request, which is why R2 could not bind its repaired version. That gap led to `foundry_trial`, `foundry_request_repair` and `foundry_delivery`.
- OpenCode environment: OpenCode 1.18.29 isolated with bubblewrap. Non-git worktree roots caused the path-permission mismatch above.

## What is still unproven

Not established: general cross-domain reliability, held-out generalization,
commercial parity, noninferiority to mature specialist harnesses, clinical, robot or
production SRE/security safety, arbitrary worst-case correctness, "skills alone
improve reasoning", Haiku 4.5 performance, n8n runtime parity, outcome-contract
identification from unseen objectives, and cross-world continuation.

Validated so far:

1. Typed, inspectable procedural workflows are a workable substrate.
2. Host-owned evidence and authority enforcement prevents classes of invalid model actions.
3. Independent outcome tests are essential, because a workflow can certify itself incorrectly.
4. Version/hash binding catches "old proposal + new run" false successes.
5. Failure-preserving repair loops beat silently editing failed model output.
6. Modest models sometimes produce useful or nearly useful procedures. The evidence is sparse and was interrupted by provider limits.

## Longer-term directions

- **Learned workflow architect**: distill from good traces and compare against the skill-only baseline.
- **Workflow-pattern memory**: reusable motifs with provenance, applicability, known failures, required capabilities, outcome evidence and revision history. Covers reuse vs adapt vs reject, and whether repeated task families get cheaper.
- **ARC integration**: Foundry is the procedure, ARC provides authority and durability, AMP supplies context, and the Neural Core is the future learned architect.
- **Counterexample-driven design**: stale evidence, wrong types, partial output, missing tools, contradictions, uncertain effects, crash retries, stale proposals, malicious retrieved text, provider interruption, version drift, weak self-authored acceptance.
- **Learned evaluator assistance**: only behind calibrated uncertainty and evidence requirements. A generator never certifies itself.

## Safety and publication rules

1. Never commit `.env`, tokens, credentials, account exports, model weights or large caches.
2. Never commit `.foundry/` runtime and model traces, or `corpus/` third-party clones wholesale.
3. No `git reset --hard`, `git clean` or force push to "simplify" the repository. Preserve dirty work first.
4. Treat project-local `.mcp.json`, `.codex/config.toml` and similar files as machine-specific until reviewed.
5. Keep raw failed experiments locally even when they are excluded from git.
6. "Everything" means all source and history needed to continue, not every secret or transient host byte.
