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
- `incr-20261104-a2.bundle`: `worktree-wf_3674d3bc-0a7-12` a65a3aeb..f7b0a860 (PREREG-A1CV2-P1 §14 amendment A2, the P1 relaunch commit). Needs incr-20261028-1800.bundle first.
- `incr-20261104-1500-redacted.bundle`: 120 commits on 22 branches made through 2026-11-04 14:56Z that were on no remote and in no earlier bundle. It holds the gap-closure, gap-closure-2, breadth, ATTACK-move, nodecap and DUR-1 build branches, the onboarding fix round to `00fe6c9e`, and four older review branches: `worktree-agent-a799b6269e6dfdf8c` (engine bump), `worktree-wf_630f3979-599-2` (loop guard, effort dose) and the JIT v2/v2.1 review branches `worktree-wf_9de1ed41-619-1` and `worktree-wf_eb243b06-14f-1`. **Redaction:** the tracker branch `worktree-wf_6d3b90c9-c30-6` is bundled only as `rescue-c30-6-redacted`. Four of its held-out tracker commits held the host account's e-mail address: the Haiku builders running under the Claude CLI copied it from their host context into run records as the requester's own address. The copy replaces it with `requester@example.test`, a string of the same length, through the whole branch, and is otherwise byte-identical (`git diff` pairs every changed line under that one substitution). The file hashes of the 36 changed files therefore differ from any manifest made before the redaction. The unredacted branch stays local and is never bundled. Needs the earlier bundles first. Restore with `git fetch incr-20261104-1500-redacted.bundle <branch>:<branch>`.
- `incr-20261104-p1-result.bundle`: `worktree-wf_3674d3bc-0a7-12` f7b0a860..287f57ff, P1 complete (all six look-2 arms' repo copies and the fixed analysis; see research/automationbench-20261014/P1-RESULT-HEADLINE.md). Needs incr-20261104-a2.bundle first.
