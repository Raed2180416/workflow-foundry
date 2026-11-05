# Post hoc $0 diagnostics for RESULT-DUR-1.md (2026-11-04)

Never DUR-1 results. Reference policy only, designer-known changes only (the sealed bundle is not loaded), no arm run
on any stream world. Both scripts were run verbatim from the scratchpad with `DUR1_WORK` pointing at a scratch
directory (deleted afterwards); they import the frozen modules from the worktree by absolute path.

- `adv-twin-decompose.mjs` -> `adv-twin-decompose.out.json`: how much of the ADV twin's difference comes from the bed
  actors' world-id draws and how much from L1/F re-draws.
- `adv-twin-overlay.mjs` -> `adv-twin-overlay.out.json` (stdout verbatim): `generateWorld({ injection })` differs only in
  id, publicId and documents on all six ADV worlds; the frozen twin differs on 91 completed cases; a document-only
  overlay that keeps the world id differs on 0.
