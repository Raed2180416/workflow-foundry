# AutomationBench: acquisition record

Recorded 2026-10-14. Research import under AGENTS.md "Dependencies must be pinned": URL, SHA, date, licence and
outcome. The clone is inert research material outside git (`corpus/` is ignored); it is never committed.

| Field | Value |
|---|---|
| Source | https://github.com/zapier/AutomationBench (remote `origin` of the clone) |
| Commit | `4a8e1061254004d9dac807054eed33fad7d1ff14` ("Add Opus 5 max public score to readme.", committed 2026-08-04 14:42:13 -0700) |
| Package version | `automation-bench` 1.0.6 (`pyproject.toml`; `CHANGELOG.md` entry 1.0.6, 2026-07-31) |
| Acquired | 2026-10-14, shallow clone (`git rev-parse --is-shallow-repository` = true, one commit), at `corpus/AutomationBench` |
| Licence | MIT, "Copyright (c) 2026 Zapier, Inc." (`LICENSE`, observed in the clone; source files carry `SPDX-License-Identifier: MIT`) |
| Task set | The **public** set only: 6 scored domains × 100 tasks plus 200 `simple` tasks (counted by loading the datasets). The private held-out set behind the official leaderboard is not released (README) and is unavailable to us |
| Environment | AutomationBench's own venv, created by `uv sync` inside the clone, pinned by its `uv.lock` (sha256 `c7d275af5ad98caa7058edce5806281a340f63781cdff3062622c9c0d5d7c521`). `uv sync --locked --check` → "Would make no changes" (115 packages). Python 3.13.16; verifiers 0.2.1, datasets 4.4.2, pydantic 2.12.5 |
| Outcome | **ok.** Tasks load, the official environment runs with a scripted client, and the bridge reproduces it exactly (parity 35/35, [parity.json](parity.json)) |

## What was run, and how

- `uv sync` builds and installs the project editable with its build backend (hatchling). That is the one install step
  the task brief sanctions ("run it only in its own venv: uv sync inside corpus/AutomationBench, pinned by its uv.lock").
  No other install hook or third-party script was run.
- AutomationBench code runs only through `experiments/autobench/bridge.py`, with the venv's interpreter in isolated mode
  (`python -I`), from a neutral working directory, with a minimal environment (`PATH`, `LANG`, `LC_ALL`, `TZ`, a private
  `HOME`, Hugging Face offline flags). No credential reaches it, and the bridge itself needs none.
- No model was called. The official eval entry point (`auto-bench`) was not run with a model or an API key; its
  environment was driven with a scripted `vf.Client` instead (see NOTES.md §9).
- Task text, emails, sheets and policies inside the tasks were read as data. All entities in them are AutomationBench's
  own fictional ones.

## Side effects in the clone

- Python bytecode caches (`__pycache__/`).
- `automationbench/tools/api/schemas/index.txt`: `api_search` writes its BM25 index cache into the package directory on
  first use (`automationbench/tools/api/search.py:98-110`). Both are ignored by the clone's own `.gitignore`;
  `git status` of the clone shows no tracked change.

## Redistribution

MIT allows redistribution with the copyright and permission notice. We redistribute nothing: the clone stays out of git,
and our notes quote only short excerpts (the system prompt and one example task, both with their source paths).
