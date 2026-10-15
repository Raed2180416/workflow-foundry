# Resume guide: session of 2026-10-15 (saved at the owner's request, usage nearly out)

Everything committed is on branch `claude/intelligent-hamilton-vg1f9a`. `live/` holds copies of the things that existed
only on this machine:
- the dev60 chain scripts;
- `launches.log`;
- the partial Sonnet dev60 results with their `launch.json`;
- `never33.json` (the dev60 never-solved list).

## Finished today (committed)

**Runner and harness fixes**
- AutomationBench runner (`experiments/autobench/run.mjs`): environment faults (rate or usage limit, ENOSPC) and cap
  skips stop the run (exit 3 or 4, no headline).
  - `--resume` keeps recorded outcomes, reruns faults and skips, may raise the cap, and needs `--accept-runner-change` if
    the runner changed.
  - Tests: 71/71 for the whole AutomationBench suite.

**Results**
- **dev60 replication (AM-9 date note):** A1 18/60 against A0 9/60, p = 0.035 (original 22 against 12, p = 0.013).
  Pooled: A1 33.3% against A0 17.5%. See `research/automationbench-20261014/runs/DEV60-A0-A1.md`.
- **Failure anatomy:** of A1's failed runs, 30% miss one check, 15% stop early and 14% never touch the target resource.
  See `.../runs/DEV60-FAILURE-ANATOMY.md`.
- **LP-0b:** no screen gates real K-Dense skills. Jev's misses track chunk length. See
  `research/architecture-20261015/runs/lp-0b/REPORT.md`.
- **AGENTV-E8:** agent-H + validator 12/14 (agent-H 10/14, workflows 14/14), 0 invalid outputs; inconclusive by the
  frozen rule. See `research/enterprise-20261014/AGENTV-E8-PREREG.md` §10.
- **E7 admission round 1:** mutation 0.996, 0 false rejects, specificity not met as written. Reading S17 was added. See
  `beds/ebed/e7/README.md`.

**Research**
- Business research: `research/business-20261015/WHAT-ORGS-PAY-FOR.md`.
- Benchmark research 1/3: `research/benchmarks-20261015/TRUST-BENCHMARKS.md`. Top 5: τ³-bench, ERP-Bench (license
  unverified), EnterpriseOps-Gym, SOP-Bench, UndoBench.

## Still running at save time (will stop when the session ends)

**Workflows.** Resume from their journals with `Workflow({scriptPath, resumeFromRunId})`. The scripts are under
`/root/.claude/projects/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/workflows/scripts/`. The owner
said no NEW workflows; resuming these is allowed.

| Workflow | Run id | State at save |
|---|---|---|
| E8 admission | `wf_92a3b590-150` | audit stage |
| E7 admission round 2 | `wf_2d2102f6-8bc` | prep, blind solvers s4–s6, specificity at 16 worlds per difficulty |
| need-router M0 | `wf_35d646a2-8ca` | re-running 4 agents lost at the 11:00 limit; prereg and metrics majors still open |
| AutomationBench families | `wf_c02e0b27-037` | HR families in build |
| A1-C code-owned harness | `wf_ebe394e0-bf7` | probes and build |

**Paid run.** The Sonnet dev60 pair, chain `live/dev60-dn-chain2.sh`.
- `a0s-dev60-dn` was partial at save; its copy is in `live/`.
- To resume: rerun the chain. It uses `--resume`, and needs `--accept-runner-change` if `run.mjs` changes.
- `a1-dev60-dn` is complete and needs no resume: its 3 fault records were refilled by `a1-dev60-dn-fill`.

**Research agents** (not resumable). The frontier-leaderboard agent and the workflow-construction-benchmark agent were
still running. Re-ask:
- the current leaderboards (Opus 5.5, GPT-6 Astra and others) on AutomationBench and the agent benchmarks;
- the benchmarks for constructing workflows and sub-workflows, and what has no benchmark.

## Next, in order

1. Finish the benchmark synthesis and pick the first external bed: τ³-bench (pass^k, local, MIT) and SOP-Bench
   (template reuse, research-only license). Pin SHAs and write acquisition records.
2. The owner wants to see complex enterprise workflow construction with correct sub-workflows over long horizons. ERP-Bench
   is the best fit once its license is clear. E8 and E7 are our own beds for it.
3. A1-C on dev60, k ≥ 2, scored against the failure-anatomy targets: early stops 12 → ~0, untouched resources 11 → ~0.
4. NL0 stamp by 10-18, after M0's open majors are fixed.

**Owner calls pending:**
- E7 readings t185/t188, t178 and the no-offset time;
- heal proposal p-a3336190-r4, never self-approved;
- external-account benchmarks (WorkArena++, Toolathlon, CRMArena-Pro);
- any publication.
