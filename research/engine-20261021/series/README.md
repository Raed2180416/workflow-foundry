# Engine bump series (engine v1 → v2), held for merge

16 commits from branch `worktree-agent-a799b6269e6dfdf8c`, base `96cab64`. Saved as `git format-patch` output so they
survive the container; the code is NOT merged into the tree yet.

**Why not merged yet.** The SOP-Bench sealed run (`FREEZE-p2.json`) hashes seven report-only dependencies this series
changes (`experiments/lib/{services,models,runner}.mjs`, `src/executors/{claude-code,sandboxed-command}.mjs`,
`src/models/policy.mjs`, `policy/models.json`), and processes started after a merge behave differently (PDEATHSIG,
update switches off, more environment-fault classes, a 5M default gateway token cap). **Merge after p2-sealed writes its
summary.** COMP-1's remaining C-H-T builds and the AutomationBench devCheck chain will record engine v2 in their manifests
if they start after the merge.

**Contents:** see `research/engine-20261021/ENGINE-BUMP.md` once merged; summary: engine compatibility ranges (rank 5),
orchestration patches 01–09, CANCELLED (rank 21), a remedy per stop code (rank 15), workdir lock (rank 12), CLI pin by
bytes and version recording (C2, rank 16), the principal model for human nodes (D1), MCP apply-proposal requires a person
(surface patch 0001, D15), Mercury-only session subsets. Chaos 35/43 (20/43 before). 136 test files: 1,740 pass, 0 fail.

**Dry merge (`git merge-tree`) against the branch head at 2026-10-21 ~17:00Z: clean, no conflicts.**

Apply: `git am research/engine-20261021/series/*.patch` (or merge the local branch if it still exists).
