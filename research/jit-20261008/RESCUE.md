# RESCUE (2026-10-14): what the cloud container held that git did not, and where it is now

The cloud container of session_011geBy7JvDqKuqhDyfmzd1U survived the 2026-10-09 usage stop. PAUSE-20261009 and
WORKFLOWS-PAUSED recorded its data as lost; it was not.

## In git (PR branch)

| what | where | commit |
|---|---|---|
| every Workflow run of the cloud session: script, run metadata, per-agent result journal | `research/jit-20261008/handoff/workflows-raw/{scripts,meta,journals}/` (the older markdown digests stay in `handoff/workflows/`) | e608a98 |
| cloud dev streams `jit-dev-records-1`, `jit-dev-kinetics-1` at the stop: results, events, faults, arm records, traces, solver versions, decoded model-call journals (`journal.jsonl`, exact replay at $0) | `research/jit-20261008/runs/jit-dev-{records,kinetics}-1/` | e623c5f |
| final numbers of those streams | DEV-NOTES D25, `analysis/cloud-dev-final/` | this commit |

A local session cannot `Workflow`-resume a cloud run (`resumeFromRunId` is same-session only). To continue an unfinished
workflow locally: take its script from `workflows-raw/scripts/`, and for every agent that already has a `result` line in
`workflows-raw/journals/<id>.jsonl`, replace the `agent(...)` call with that recorded value (or pass the values in as the
workflow's `args`); only the missing agents then run.

## Pushed on the owner's approval: orphan branch `foundry-rescue-20261014` (26dda19)

Packed, split and checksummed (`parts/SHA256SUMS`); the first push attempt was refused by the session's safety
classifier and was pushed at 13:28Z on 2026-10-14 after the owner approved it in the session. The branch shares no
history with the PR branch, so cloning the PR branch does not download it. Restore:
`git fetch origin foundry-rescue-20261014 && git worktree add ../rescue origin/foundry-rescue-20261014`, then
`sha256sum -c parts/SHA256SUMS` inside `parts/`, then `cat parts/<name>.tar.xz.part-* | xz -dc | tar -xf - -C <dest>`.
The cloud paid-run kit E1c (ENGINE-FREEZE §6, detached commit ba0eb22) is on branch `kit-e1c-20261014`.

| archive | content | why it matters |
|---|---|---|
| `kev` (21 MB xz) | wave-A Kev build: 228 MB JSONL in seven slices incl. held-out/test slices, summaries, det, smoke, j1 | WORKFLOWS-PAUSED §2 says the held-out/OOD material must be re-authored; it need not be |
| `kev-data-local` (4 MB) | `.foundry/kev-data/`: the held-out and pool inputs of that build | same |
| `heal-state` (0.5 MB), `heal-journals` (37 MB) | auto-heal stores and run journals, incl. the pending proposal `heal/state/live4-cfx/proposals/p-a3336190-r4.json` | the owner's approval of that proposal needs the store |
| `jit-runs` (4 MB), `jit-workdirs` (33 MB) | the raw run dirs incl. `journal.sqlite`, sandbox work dirs, nversion and tierdown probes | the committed mirrors already cover the stream data |
| `workflow-agent-transcripts` (103 MB) | full per-agent transcripts of every cloud Workflow run | only the journals above are needed to resume |
| `misc-scratch`, `bench` | earlier experiment scratch (upstream cloudflared test fixtures excluded: they contain PEM test keys) | low |

All archives were scanned for credential patterns before packing; none found apart from the excluded fixtures and a grep
pattern string in one transcript.
