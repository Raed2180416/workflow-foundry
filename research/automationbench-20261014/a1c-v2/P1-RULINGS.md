# P1 launch rulings (PREREG-A1CV2-P1 §8), recorded before the first P1 paid call

Recorded 2026-10-22 about 03:55Z by the agent executing the P1 step, under the orchestrator's dispatch: "Run P1 exactly as
frozen in PREREG-A1CV2-P1.md … the five arms (A0, v1, v2, v1-M, v2-M) … run ids … unless the prereg names others". The
prereg says these rulings belong in the decisions file. That file is in the main tree, which this step may not edit.
**Pending for the orchestrator:** copy these rulings into `research/decisions-20261021.md` as a decision row, or overrule
them. Nothing below changes the frozen file (§14 stays "None") or any harness file. V2COMMIT is the commit that adds this
file, which changes nothing under `experiments/`, `src/`, `beds/` or `policy/`, as §4 allows.

| § 8 item | Ruling | Basis |
|---|---|---|
| 1. First look | **First look 2 for every A1-C arm, as frozen.** The exposure stays disclosed (§12.1), and the sensitivity analysis without the 6 exposed tasks (§9.5) is read beside H1 and H2. | D23 (3) and D25 name first look 2, and the dispatch says "exactly as frozen". **Not done here:** the correction of AMEND-1 §2.2 disclosure 2. That file is on branch `worktree-wf_630f3979-599-4`, outside this step, so the correction is pending. |
| 2. Mercury arms | **`M_ARMS=1`: v1-M and v2-M run as frozen.** | **The dispatch** names both Mercury arms. **D25 and D27** plan them, and VL-1's fork is v1-M (`a1c-v1m-look2`). **D28 (8)** defers until "the frozen OT-0, SOP-Bench and A1-C v2 runs finish" the policy edits that would put D28 (7)'s per-call settings into these harnesses: JSON schema by default for ledger roles, and effort per node. **D28's own reason** is that its rulings unblock moves "without touching running frozen experiments". **ATTACK §9.3** says that until the allowance is read, "every Mercury run keeps a hard cap under D18". The chain enforces that cap: 5.5M tokens per arm, a stop below 4.5M, and a worst case of 16.8M of the 20M. **Deviation, disclosed (§12.7):** the Mercury calls lack D28 (7)'s explicit effort, completion cap and JSON schema. Mercury results decide nothing here (§10.5). |
| 3. Effort | **Effort stays unset in every arm, as frozen (§5).** | The frozen manifests set none, and D28 (8) defers the effort edits. **Deviation, disclosed (§12.7):** this departs from D28 (4). |
| 4. T3 | **`T3=1`.** The A/A run of A0 (`a0-look2-aa`, cap $4, about $0.9) runs after A0. | The frozen launch template sets `T3=1` (§13), AMEND-1 §4 asks for it, and §8.4 recommends it. |

**Run ids** are the ones the prereg names (§4): `a1c-v1-look2`, `a1c-v2-look2`, `a0-look2`, `a0-look2-aa`,
`a1c-v1m-look2`, `a1c-v2m-look2`. They are not the dispatch's placeholder ids.

**Before launch:**
- The container restarted for the third time (C9) at about 03:40Z. No P1 arm had started, so no spend is booked as
  killed.
- `df -h /` shows 2.3 GB free, and `claude --version` reports `2.1.307 (Claude Code)`.
- Concurrent paid runs on the host, launched by the orchestrator from the main tree:
  - the Opus 5.5 xhigh dev60 run `a0o-dev60-dn`;
  - the SOP-Bench sealed run `p2-sealed`.
