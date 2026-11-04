# Rescue of local-only branches (2026-10-28)

These branches existed only in this container's worktrees: 16 branches, 117 commits not on any remote. The two bundles hold every commit reachable from them and not from `claude/intelligent-hamilton-vg1f9a` at 53d65fdf. Nothing here is reviewed or merged; each branch's own commits and result notes say what it holds.

Restore one branch: `git fetch research-branches.bundle <branch>:<branch>` (or `onboarding-site.bundle`), with the base branch present.

| branch | tip | commits ahead |
|---|---|---|
| `a1c-v1-pin-look2` | `b1e16e03` | 1 |
| `worktree-wf_0f86d12b-ab5-1` | `2fd70d02` | 8 |
| `worktree-wf_0f86d12b-ab5-2` | `9e2a2b61` | 5 |
| `worktree-wf_0f86d12b-ab5-3` | `1731c455` | 7 |
| `worktree-wf_0f86d12b-ab5-4` | `2951097b` | 10 |
| `worktree-wf_0f86d12b-ab5-5` | `ca99ca85` | 1 |
| `worktree-wf_3674d3bc-0a7-12` | `b43eda6b` | 26 |
| `worktree-wf_435f2b5e-3ff-12` | `95eda674` | 2 |
| `worktree-wf_435f2b5e-3ff-13` | `f8b7fdf9` | 1 |
| `worktree-wf_6d3b90c9-c30-6` | `4dfe5f1a` | 6 |
| `worktree-wf_6d3b90c9-c30-7` | `b41910d7` | 5 |
| `worktree-wf_bba577b8-b58-1` | `d3bd7acf` | 2 |
| `worktree-wf_bba577b8-b58-2` | `20997d8e` | 3 |
| `worktree-wf_bba577b8-b58-3` | `d3bd7acf` | 2 |
| `worktree-wf_c56a08f8-048-15` | `44bb426d` | 16 |
| `worktree-wf_c7946468-203-16` | `cd0dc23d` | 14 |

## Incremental bundles

- `incr-20261028-1800.bundle`: `worktree-wf_3674d3bc-0a7-12` b43eda6b..a65a3aeb (PREREG-A1CV2-P1 §14 amendment A1, the P1 launch commit). Needs research-branches.bundle first.
- `incr-20261104.bundle`: 24 commits made 2026-10-28 17:45Z–19:45Z on 10 branches (Δ* v1, compose-runtime/2, Move 8, tracker A7 prereg, GQA-1 prereg, SW-1b prereg, WorkBench/AgentDojo splits, nodecap security fixes, onboarding honesty fixes and journeys, and the new DUR-1 build branch `worktree-wf_bd674a6e-71f-11`). Needs the earlier bundles first.
