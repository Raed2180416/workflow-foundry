# Where the dynamic workflows stopped (cloud session ran out of usage, 2026-10-09)

> **Update 2026-10-09 (laptop session): both workflows are finished, by subagents, not Workflow runs.**
> - `blocker-dossiers`: synthesis `research/jit-20261008/BLOCKER-SYNTHESIS.md` (db12bd0, revised d49ef63) and
>   critique `BLOCKER-SYNTHESIS-CRITIQUE.md` (ea6d36c).
> - `kev-j1-build`: the owner switched the judge program to hosted **Jev** (no Kev training/GPU). J1 on Jev, baselines,
>   Haiku arm, analysis, `research/judge-20261009/J1-JEV-DEV.md` and `PREREG-J2-draft.md` (4517c4a, 38f74fd, 3816d88,
>   3d1ce99). Jev auth: the `TYPESAFE_API_KEY` of interactive bash, passed as `FOUNDRY_SYSTEMONE_API_KEY` via `bash -ic`.
> The sections below are kept as the historical record of where they stopped.


The cloud container stopped at about **04:52 UTC = 10:22 IST on 2026-10-09**. Its last git push was the 04:50 UTC
snapshot `ef5151b`, and its last bridge request was at 04:51:54 UTC. There was no further autosave after that.

Workflow runs live inside the session that started them: `Workflow` resume (`resumeFromRunId`) only works in that same
session, so these runs cannot be resumed as runs from the laptop. What survives is each workflow's **exported agent
results**, in `research/jit-20261008/handoff/workflows/wf_<id>.md`. The remaining phases have to be re-run from those.

45 workflows were exported: 40 completed, 3 were killed earlier (beds-tier-a, kev-wave-b, engine-stage1), and
**2 were still running**.

---

## 1. `blocker-dossiers` (wf_da253fe6-f97): dossiers done, synthesis and critique not started

- **Goal:** for each of the 18 JIT blockers (B1–B18; the inventory is in `research/jit-20261008/FRONTIER-GAPS.md`):
  - frontier research;
  - at least 3 niche verticals;
  - ideological roots;
  - ranked experiments.
  Then one synthesis, and a critique of it.
- **Done (all 9 dossier agents; their full text is in the export, about 316 KB):**
  1. B2 common-mode failures + B9 lineage variance and small-K validity
  2. B1 silent compiled misses + B7 answer equivalence without an oracle
  3. B3 weak-demonstrator trap + B17 human adjudication
  4. B4 heal widened the domain (D9) + B11 applicability gating for reuse
  5. B6 kinetics compile failures and the composer question + B8 compile acceptance without ground truth
  6. B5 tiering a high-leverage judge + B15 Kev from traces + B16 router and slider
  7. B14 replicating hand-built workflows + B18 a self-improving compiler
  8. B12 composition from guarded sub-modules + B13 interactive environments and game loops
  9. B10 throughput under quota and scheduling on a 4-vCPU VM
- **Not done:** the cross-blocker synthesis, and the adversarial critique of it.
- **Lost:** the workflow script itself ("script not recorded" in the export), so its exact synthesis prompt is gone.
  HANDOFF.md §4 says that if the workflow did not finish, *"the synthesis can be done by hand"*.
- **To continue:** read the 9 dossiers and write the synthesis to `research/jit-20261008/BLOCKER-SYNTHESIS.md`. It should
  rank the experiments across blockers, flag conflicts between dossiers, and map each item to HANDOFF §5 next steps.
  Then critique it. This is reading and writing only (no model-call experiments), and it needs no new workflow (the owner
  said "no new workflows").

## 2. `kev-j1-build` (wf_0ef730df-c61): wave-A datasets built, J1 stock reads not started

- **Goal:**
  1. build the wave-A Kev datasets;
  2. run J1 stock reads of Kev on the laptop GPU through the bridge;
  3. draft PREREG-J2.
- **Done:**
  - **Phase 1, the dataset build.** All six wave-A generator groups were built, in seven slices, at the §4.3 sizes. Every
    record passed Kev `fits()`. The kinetics rebuild was byte-identical. The full report is the export's agent result 1.
    Manifests are committed: `experiments/kev-data/out/wave-a-manifest.json` and `audit-wave-a.json`.
  - **J1 helper scripts, committed at 04:40–04:44Z:** `experiments/kev-data/out/j1/{lib,baselines,haiku,analyze}-j1.mjs`.
  - **J1 inputs uploaded to the laptop** at 04:42Z through the bridge. They are in `~/foundry-bridge/work/data/`:
    - `interactive-dev-select-9459e2fce448.jsonl` (487 lines)
    - `kinetics-dev-select-d1d34f6fa6ad.jsonl` (461 lines)
    - `runbook-dev-select-e431400e7d8b.jsonl` (158 lines)
- **Not done:**
  - J1 stock reads. The agents were polling the bridge `/info` from 04:37 to 04:51Z, but no `kev.benchmark` job was
    ever submitted.
  - Haiku J1 reads.
  - The J1 analysis.
  - PREREG-J2.
- **Lost with the container:**
  - The built JSONL files (228 MB in `/var/tmp/foundry-work/kev/builds/`).
  - Per-group summaries and logs.
  - Any J1 baselines it had computed.
  The build itself is deterministic (`experiments/kev-data/out/assembly/build-wave-a.mjs`, output directory via
  `KEV_WAVE_A_OUT`), but its held-out and pool inputs in `.foundry/kev-data/` (git-ignored) were lost with the container.
  The generator-only parts can be rebuilt. The held-out and OOD material must be re-authored, which gives new hashes.
  J1 on the three surviving dev-select files does **not** need a rebuild.
- **Caveats from the phase-1 report:**
  - The two-model OOD filter has not run, so the OOD slices are not claim-bearing.
  - `assembly/` is a development stand-in.
  - `heldout-manifest.json` was built against an older spec, so the held-out material needs a rebuild.
  - In `experiments/kev-data/test`, 394 tests pass and 4 fail; three of the failures are in the parked wave-B incident
    group.
- **To continue on the laptop:**
  1. Point the J1 scripts' hard-coded `/var/tmp/foundry-work/kev/...` paths at a local directory, for example
     `~/foundry-bridge/work/kev/`.
  2. Run the stock Kev-0.8B reads on the three dev-select files. This is GPU work at $0: run `kev.benchmark` directly,
     or submit it through the bridge.
  3. `haiku-j1.mjs` makes Haiku calls on the owner's Claude login, which spends the same usage limit.
  4. Run `analyze-j1.mjs`, then draft PREREG-J2.

## 3. Also in flight at handoff (not workflows)

- **Engine stage 1** (`engine-stage1-finish`, wf_f3f3579c-597): **completed**. 1021 tests, 0 failures. The gate verdict
  belongs in `research/review-20261007/STAGE1-ENGINE.md`.
- **Dev streams** `jit-dev-records-1` (all done except Haiku/Haiku) and `jit-dev-kinetics-1` (JIT arms were still
  running). Their run data and model-call journals (`experiments/runs/jit/**`) were **never pushed** (see RESUME.md
  "Lost").
  `resume-streams.mjs` resumes from that run data, so these streams have to be re-run, not resumed.
  - **Update 2026-10-14 (cloud session): the data was not lost.** The cloud container survived and still held both streams
    (`experiments/runs/jit/`, with the model-call journals, solver versions and traces). What is in git and what is still only in the
    container is listed in `research/jit-20261008/RESCUE.md`; the committed mirror is
    `research/jit-20261008/runs/jit-dev-{records,kinetics}-1/`, and the final state of both streams, with the numbers that
    supersede the mid-run ones, is DEV-NOTES D25 (`analysis/cloud-dev-final/`). The three kinetics JIT arms stopped on a
    `MODEL_RATE_LIMIT` fault at 04:49–04:50Z and did not finish.
