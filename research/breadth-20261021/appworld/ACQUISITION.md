# AppWorld 0.1.3.post1 (data 0.1.0): acquisition under D16

Bed 3 of the breadth portfolio (PLAN.md §4.3 T1-3). Rule: decision D16 (`research/decisions-20261021.md`). Evidence
labels: **[doc]** a document or registry says so; **[obs]** observed in code or files here; **[run]** measured by a
command in this repository; **[inf]** inference. All dates are 2026-11-04 (UTC) unless stated.

## Source

| Item | Value |
|---|---|
| Package | `appworld==0.1.3.post1`, PyPI https://pypi.org/project/appworld/0.1.3.post1/ (JSON API read 2026-11-04) [doc] |
| Wheel | `appworld-0.1.3.post1-py3-none-any.whl`, 625,317 B, sha256 `db77f8003982502383a50fa2974983894bd1c54f64e2fd3f7e1540d5edd037eb`, uploaded 2026-02-17T06:11:44Z, not yanked [doc]; the same sha256 is in our lock and in `downloads.json` [obs]. The sdist (`05bc6d7a…c9b7`) was not downloaded |
| Latest release | 0.1.3.post1 is PyPI's latest on 2026-11-04 (releases 0.1.0, 0.1.1, 0.1.2, 0.1.3, 0.1.3.post1) [doc] |
| Repository | https://github.com/StonyBrookNLP/appworld (not cloned: the wheel carries the code; the README was read at `raw.githubusercontent.com/StonyBrookNLP/appworld/main/README.md`, 81,334 B, sha256 `f4049141b6e520217395b7ccd9f27048c8e0f90331690dcbef300d2bc4ff7bdd`, ETag `4e39a299…0df7`, read 2026-11-04) [doc] |
| Data bundle | `data-0.1.0.bundle` from `https://s3.us-west-2.amazonaws.com/appworld.dev/data-0.1.0.bundle` (the URL `appworld/download.py` builds: `S3_BASE_URL + "data-0.1.0.bundle"`) [obs]; **34,280,074 B, sha256 `fd9f9608c2ec71ed0ac25c3633a738b9129a318a129e31230425b9188e508250`** (= the PLAN's pinned `fd9f9608…8250`) [run]; S3 Last-Modified 2024-07-27T14:53:17Z, ETag `"9b077001e5e1feba23cbab10d04de597-2"` [doc]; fetched by `curl` 2026-11-04 13:52:26–13:52:39Z, before any unpack [run] |
| Licence (code) | Apache-2.0: wheel `METADATA` `License: Apache-2.0`, `appworld-0.1.3.post1.dist-info/licenses/LICENSE` (Apache License 2.0 text), classifier `License :: OSI Approved :: Apache Software License` [obs] |
| Licence (protected portion) | README §License: the protected portion ("API documentation and implementation, task solution and evaluation tests, etc.") is "packed in encrypted `.bundle` files and released under the Apache 2.0 license with an additional requirement that any of its public redistribution (or of its derivatives) should be done in an encrypted format. Training language models and serving their outputs do not constitute redistribution." [doc]; the unpacked data's own `data/LICENSE` and `README_BEFORE_SHARING.md` say the same [obs] |
| No-look terms | README: test sets ship "only evaluation programs"; `world.task.ground_truth` "should not be shown to the agent for the tasks you are testing on" [doc]. Our reading of the terms: no test content is looked at, tuned on, or committed; per-task test results stay out of git |
| Dependency licences | all 80 wheels carry a licence field: MIT 37 (27 by classifier, 9 by expression, 1 MIT-0), Apache-2.0 13, BSD 18 (BSD-3-Clause 7, BSD-2-Clause 3, classifier only 8), ISC 4, MPL-2.0 1, PSF-2.0 1, Unlicense 1, and 5 compound or dual expressions (MIT AND PSF-2.0; MPL-2.0 AND (Apache-2.0 OR MIT); MPL-2.0 AND MIT; MIT OR Apache-2.0; Apache-2.0 OR BSD-2-Clause) [obs, `downloads.json`]. Nothing is redistributed: the venv stays outside the repo |

## What was downloaded

`experiments/breadth/appworld/acquire.py` (stdlib only; the AgentDojo bed's script with the paths changed) read the
hash-pinned lock `research/breadth-20261021/appworld/requirements.lock.txt` (sha256
`9acb060307c6e777629ab2dce7795b08710459dbaf7985a4d3380d5ad6879693`; `uv pip compile req.in --python-version 3.12
--only-binary :all: --generate-hashes`, made by the 2026-10-21 agentic-tool sweep and kept in
`/var/tmp/foundry-work/benches/_agentic-tool-probes/locks/appworld-req.lock.txt`), asked PyPI's JSON API for each pinned
release, picked the one wheel whose sha256 is in the lock and whose tags CPython 3.12.3 accepts, downloaded it and checked
its sha256. Every download is recorded (URL on files.pythonhosted.org, sha256, bytes, licence fields, upload time, fetch
time) in `/var/tmp/foundry-work/benches/appworld/downloads.json` (sha256 `ead7bd84140ee47134cda378f51998d8930bbc4fca1bb6431fe6400adaa5f753`) [run].

- **80 wheels, 33,419,182 B** (31.9 MiB), fetched 2026-11-04 13:51:15–13:52:40Z; largest: jedi 4.9 MB, uvloop 4.7 MB,
  cryptography 4.2 MB, pydantic 2.6 MB, libcst 2.3 MB [run].
- **The data bundle**, 34.3 MB, by `curl` (above). The PLAN's "173 MB + 216 MB" were the 2026-10-21 probe's on-disk sizes
  (installed venv, unpacked data), not download sizes; the downloads are 33.4 MB + 34.3 MB [run].
- **No sdist, no git clone, no LFS, no submodule.** Wheels only; no package hook ran (a wheel install runs none).

## Install and the two explicit offline steps

| Step | What ran | Result |
|---|---|---|
| venv | `uv venv --python /usr/bin/python3.12 --no-project <B>/venv` (uv 0.11.32, CPython 3.12.3) | [run] |
| wheels | `uv pip install --python <B>/venv/bin/python --no-deps --only-binary :all: --require-hashes --no-index --find-links <B>/wheels --no-cache -r requirements.lock.txt` | 80 packages; venv 113,863,466 B apparent, 147 MB on disk [run] |
| `appworld install` | the package's own console script, under `unshare --user --map-root-user --net` (no network), `env -i` with PATH, LANG, a private HOME and `APPWORLD_CACHE=<B>/cache`, from an empty working directory (no `.env` on the dotenv path) — 2026-11-04 13:55:23Z | `install.py install_package`: decrypts `appworld/.source/apps.bundle` (177,209 B) into the package directory (**96 files, 1,017,074 B, manifest sha256 `8f069913c68ddd5ff7c8d0f6496127fa3c6c3eb5f08a22c9f6476ff32b8e3e19`**) and `tests.bundle` into `<B>/cache/tests` (2.1 MB) [obs, run] |
| data | `experiments/breadth/appworld/setup_offline.py data <bundle> <B>/root <sha256>`, same namespace and environment, 13:55:2x–13:55:44Z: checks the bundle's sha256, then `appworld.common.utils.unpack_bundle(bundle, root, PASSWORD, SALT)` — exactly `download.py download_data` minus its `requests.get` | `<B>/root/data`: **14,696 files, 169,528,045 B** (193 MB on disk), manifest sha256 `230bc4d4bac05328e90098bba2da7edb9950f8ede8de296aed415d1109a1ed5e`; 732 task directories; `datasets/` train 90, dev 57, test_normal 168, test_challenge 417 (ids only were read) [run] |

`<B>` = `/var/tmp/foundry-work/benches/appworld` (outside the repo). The unpack writes the protected portion in plain
files under `<B>/root/data`, including `tasks/<id>/ground_truth/` for every split (train and dev: full; test_normal and
test_challenge: the evaluation programs, answers and test data only — file names listed, contents never opened) [run].
This is the "decrypted ground truth" BG-8 must keep unreachable from every arm (`bg8.json`).

**Integrity (BG-0).** `experiments/breadth/appworld/verify_install.py` (adapted from the AgentDojo bed): 80 pinned = 80
installed distributions at the pinned versions; **10,905 installed files equal to their wheel RECORD sha256, 0
mismatches**; the only files no RECORD lists are the 96 that `appworld install` unpacked, and their manifest equals the
one recorded right after that step (`lib.mjs PIN.unpackedAppsManifestSha256`) [run; repeated in the test suite and in
`parity.json` `bg0`].

**After install.** The wheels directory was deleted once the install check passed (2026-11-04 13:56:25Z, 33 MB;
`downloads.json` keeps every URL and hash, so the set can be re-fetched and re-verified). The data bundle is kept (34 MB)
so the data can be re-unpacked offline.

## How it is run

Only through `experiments/breadth/appworld/bridge.py`, as `python -P -s` with an environment built from nothing (PATH,
LANG, a private HOME, APPWORLD_ROOT/APPWORLD_CACHE, PYTHONHASHSEED=0), never with network access:
- the **arm-facing serve process** (a fresh process and a fresh world per unit) runs inside the executor sandbox of
  `src/executors/claude-code.mjs` plus a network namespace; it sees the venv, `bridge.py`, and a per-unit **public view**
  (hard links to `base_dbs/`, `api_docs/` and the unit's own `specs.json` and `dbs/`; no `ground_truth/`, no
  `datasets/`) and opens the world with `load_ground_truth=False`;
- **host-only** processes (grader, upstream's reference path, the dataset evaluator, scripted plans) run in a network
  namespace and read the full data.

## Footprint and disk (D16 limits)

| Item | Size |
|---|---|
| venv | 147 MB on disk |
| unpacked data | 193 MB on disk |
| data bundle (kept) | 34 MB |
| package-tests cache, logs | 2.2 MB |
| **bench directory** | **≈ 376 MB** (≤ 500 MB per install) |
| host-only run data (parity cache, snapshots) | see `PARITY.md` |

Disk free before this session's work: **1.70 GB** (`df -B1 /`, 13:49Z: 1,700,143,104 B, above the 1.5 GB stop line). It
fell to 1.15 GB at 13:53Z, 0.87 GB at 13:56Z and 0.78–0.82 GB during the parity run while other tracks wrote; this bed's
own peak is the bench directory plus the host-only parity data [run].

## Outcome

**Adopted** for bed 3 (Tier 1). The earlier $0 probe install of the same 80 wheels and bundle (agentic-tool sweep,
2026-10-21; DISPOSALS.md) had been deleted; this is the adoption install. $0 gate results: `PARITY.md`, `parity.json`,
`bg8.json`; adapter notes: `NOTES.md`.

## Kept out of git (terms and PLAN §5.6)

The data (protected portion, plain after unpack), API docs, task instructions, assertion texts, gold solutions, world
outputs and per-unit records stay under `/var/tmp/foundry-work/benches/appworld/` and the host-only
`/var/tmp/foundry-work/appworld-host/`. The repository holds code, ids, hashes, counts and aggregate rates for the
public train and dev splits; nothing per task for test_normal.

## Deletion plan

After the bed's sealed run and analysis: delete `<B>/venv`, `<B>/root`, `<B>/cache` and the bundle; keep
`downloads.json`, the lock and the hashes above; record the deletion in `research/breadth-20261021/DISPOSALS.md`.
Host-only run data follows PLAN §5.6.
