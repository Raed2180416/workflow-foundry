# AgentDojo 0.1.35 (benchmark v1.2.2): acquisition under D16

Bed 2 of the breadth portfolio (PLAN.md §4.3 T1-2). Rule: decision D16 (`research/decisions-20261021.md`). Evidence
labels: **[doc]** a document or registry says so; **[obs]** observed in code or files here; **[run]** measured by a
command in this repository; **[inf]** inference.

## Source

| Item | Value |
|---|---|
| Package | `agentdojo==0.1.35`, PyPI https://pypi.org/project/agentdojo/0.1.35/ (JSON API read 2026-10-28) [doc] |
| Wheel | `agentdojo-0.1.35-py3-none-any.whl`, 192,363 B, sha256 `364bea4219716b716bf639f504d195943f7f6a5535d312ca41d7098704a2affd`, uploaded 2025-10-27T18:11:04Z, not yanked [doc]; the same sha256 is in our lock and in `downloads.json` [obs] |
| Latest release | 0.1.35 is still PyPI's latest on 2026-10-28 (previous: 0.1.34, 2025-06-02) [doc] |
| Repository | https://github.com/ethz-spylab/agentdojo (not cloned: the wheel carries the suites, data and evaluator) |
| Benchmark version | `v1.2.2` (`get_suites("v1.2.2")`): 97 user tasks (workspace 40, travel 20, banking 16, slack 21), 35 injection tasks (14, 7, 9, 5), 949 (user, injection) pairings [run, `bridge.py inventory`] |
| Licence | MIT, "Copyright (c) 2024 Edoardo Debenedetti, Jie Zhang, Mislav Balunovic, Luca Beurer-Kellner, Marc Fischer, and Florian Tramèr": the wheel's `agentdojo-0.1.35.dist-info/licenses/LICENSE` [obs] and the repository's `LICENSE` on `main` (read 2026-10-28) [doc]; PyPI classifier `License :: OSI Approved :: MIT License` [doc] |
| Dependency licences | every one of the 72 wheels carries a licence field: MIT 30, BSD 18, Apache-2.0 13, dual Apache/MIT/BSD 4, MPL-2.0 3 (two of them compound with MIT or Apache), ISC, Unlicense, MIT-0 and PSF-2.0 one each [obs, `downloads.json`]. Nothing is redistributed: the venv stays outside the repo |

## What was downloaded (2026-10-21, 23:12:07–23:13:01Z)

`experiments/breadth/agentdojo/acquire.py` (stdlib only) read the hash-pinned lock
`research/breadth-20261021/agentdojo/requirements.lock.txt` (sha256 `5edeec490dff629ee8d664eb98e3af0b1e9259838521ec195d70cbd95b84e16b`;
`uv pip compile req.in --python-version 3.12 --only-binary :all: --generate-hashes`), asked PyPI's JSON API for each pinned
release, picked the one wheel whose sha256 is in the lock and whose tags CPython 3.12.3 accepts, downloaded it and checked
its sha256. Every download is recorded (URL on files.pythonhosted.org, sha256, bytes, licence fields, upload time, fetch
time) in `/var/tmp/foundry-work/benches/agentdojo/downloads.json` (42,939 B, sha256
`8ac437346baeb9ffa18805ceef5d4803f58f06446a36503d02eb0134dab858b5`) [obs].

- **72 wheels, 41,368,378 B** (39.5 MiB) in total; largest: zstandard 5.5 MB, cryptography 4.8 MB, hf_xet 4.2 MB,
  fastavro 3.6 MB, tokenizers 3.4 MB [obs].
- **No sdist, no git clone, no LFS, no submodule, no data download**: the four suites' environments, tasks and
  system message ship inside the agentdojo wheel [obs].
- Wheels only; no package hook ran (a wheel install runs none).

## Install

| Item | Value |
|---|---|
| Location | `/var/tmp/foundry-work/benches/agentdojo/venv` (outside the repo), interpreter `/usr/bin/python3.12` (CPython 3.12.3), created by uv 0.11.32 [obs, `pyvenv.cfg`] |
| Command | `uv pip install --python <venv>/bin/python --no-deps --only-binary :all: --require-hashes --no-index --find-links <wheels> -r requirements.lock.txt` (acquire.py header) |
| Size | venv 162,907,628 B apparent (155 MiB), 193 MB on disk (`du -sh`); bench directory total 156 MiB apparent [run, 2026-10-28] |
| Wheels directory | not present on 2026-10-28 (removed after the install by the 10-21 session; its contents are recorded in `downloads.json`, and `verify_install.py` checks the installed files against each wheel's RECORD) [obs] |
| Integrity | `experiments/breadth/agentdojo/verify_install.py`: 72 pinned = 72 installed distributions at the pinned versions, 8,927 installed files equal to their wheel RECORD sha256, no unlisted file except uv's two venv seed files (pinned by sha256) [run, 2026-10-28]; package file hash `21aa7659…9684` (bridge inventory, `.pyc` excluded) [run] |
| How it is run | only by `experiments/breadth/agentdojo/bridge.py`, as `python -P -s` with PYTHONHASHSEED=0 in an environment built from nothing (PATH, LANG, a private HOME), from a scratch working directory, under `unshare --user --map-root-user --net` (no network) [obs, `lib.mjs` `bridgeArgv`] |

D16 limits: this install is 155–193 MB (≤ 500 MB). Disk free before this session's work: 2.1 GB (`df -h /`, 2026-10-28
17:51Z), 1.8 GB at 17:55Z with other tracks writing [run]. Nothing new was installed or downloaded on 2026-10-28.

2026-11-04 (completion session): nothing installed or downloaded. Disk free at start 2.0 GB (`df -h /`, above the 1.5 GB
stop line); it fell to 1.4 GB at 13:10Z while other tracks wrote and was back at 1.8 GB by 13:21Z; this bed's own scratch
peaked at about 15 MB (`agentdojo-live/parity`), host-only run data is 64 MB. The install check passed again
(`verify_install.py` in the test suite and in `parity.json` `bg0`) [run].

## Outcome

**Adopted** for bed 2 (Tier 1). The earlier $0 probe install of the same 72 wheels (agentic-tool sweep, 2026-10-21; DISPOSALS.md)
was deleted after its probe; this is the adoption install. Results of the $0 gates are in `PARITY.md` and `parity.json`;
the adapter is `experiments/breadth/agentdojo/` (NOTES.md).

## Deletion plan

After the bed's sealed run and analysis: delete `/var/tmp/foundry-work/benches/agentdojo/venv`, keep `downloads.json` and
the lock, and record the deletion in `research/breadth-20261021/DISPOSALS.md`. Host-only run data
(`/var/tmp/foundry-work/agentdojo-host/`) follows PLAN §5.6.
