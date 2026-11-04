# Family factory (node V): acquisitions under D16

Rule: decision D16 (`research/decisions-20261021.md`): isolated exact-pinned venv outside the repository, wheels only,
hashes required, no post-install hook beyond the package manager's wheel install, no accounts or hosted instances, every
download recorded, deleted when not adopted (DISPOSALS.md). Location: `/var/tmp/foundry-work/benches/factory/`.
All reads and downloads on **2026-11-04** (the task text says 2026-10-21; the session clock read 2026-11-04 UTC, so that
is the date recorded). Disk: 1.9 GB free at the start check (`df -h /`, before the worktree checkout); 0.93-1.5 GB
during the work, with other tracks writing; this item's peak was about 60 MB (the UCI CSV, 46 MB, lived about two minutes).

## Downloads

| What | URL | Bytes | sha256 | Licence | Outcome |
|---|---|---|---|---|---|
| UCI incident management event log (ID 498), zip | https://archive.ics.uci.edu/static/public/498/incident+management+process+enriched+event+log.zip | 2,400,214 | `6294e29a311647306bfdfc85783f7df66517c197b9cd49aa5ee36ba9c525d1d6` (matches the task's prefix and the recurring sweep's record) | CC BY 4.0 (Amaral, Fantinato & Peres 2018, doi 10.24432/C57S4H) | **adopted, parameters only.** `incident_event_log.csv` (46,212,397 B, 141,712 rows, 24,918 incidents) was extracted, read once by `experiments/breadth/factory/params/extract_uci.py`, and **deleted** at 17:26Z; the zip is kept (re-extraction) |
| ProcureChange reference OCEL, JSON | https://zenodo.org/api/records/22079246/files/procurechange.jsonocel.gz/content | 7,393,340 | `6ace16482a80393854b5075f8255326f8cbf0f1463ada1d43601e9d9a980ebd8` (equals the record's own SHA256SUMS line; md5 `6be8de3e…f2` equals Zenodo's) | CC BY 4.0 (Berti, "Synthetic relational databases and reference OCELs", Zenodo 22079246, 2026-08-24) | **adopted, parameters only** (`extract_procurechange.py`); nothing else of the 1,158 MB record was fetched |
| Zenodo record SHA256SUMS | https://zenodo.org/api/records/22079246/files/SHA256SUMS/content | 3,332 | `f9de81f7995ada647859c288f092cdd13e9abaf442156930a240a7a586b51c6e` | CC BY 4.0 | kept (verification) |
| PyPI / Zenodo metadata JSON (5 + 1 files) | `https://pypi.org/pypi/<name>/<version>/json`, `https://zenodo.org/api/records/22079246` | 196 KB | not pinned (metadata) | - | kept under `meta/` |

## Installs (venv `/var/tmp/foundry-work/benches/factory/venv`, python 3.13.16, 7.5 MB)

`uv pip install --no-deps --only-binary :all: --require-hashes -r requirements.lock` (`install/install.sh`,
`install/requirements.lock` in this directory), `env -i`, no network beyond PyPI's files host:

| Wheel | Bytes | sha256 | Licence | Why |
|---|---|---|---|---|
| holidays 0.107 (py3-none-any) | 1,694,848 | `5e4582d543b145d8ebb80ce8943e60ea5c8b6a30b74201ad0f95af0cbe67cb14` | MIT | frozen public-holiday tables (DE, GB-ENG, US; `abr/lib/factory/holidays.json`, re-derived and compared by the tests) |
| hypothesis 6.170.5 (cp313 manylinux2014 x86_64) | 1,163,646 | `97326beccad05d80c44504cfc29a0306961de9a5b52f21f863ed446486fc9439` | MPL-2.0 | property tests of the clock engine (the reg family's third oracle) |
| python-dateutil 2.9.0.post0 | 229,892 | `a8b2bc7bffae282281c8140a97d3aa9c14da0b136dfe83f850eea9a5f7470427` | Apache-2.0 / BSD | holidays' only dependency |
| six 1.17.0 | 11,050 | `4721f391ed90541fddacab5acf947aa0d3dc7d27b2e1e8eda2be8970586c3274` | MIT | dateutil's dependency |
| sortedcontainers 2.4.0 | 29,575 | `a163dcaede0f1c021485e957a39245190e74249897e2ae4b2aa38595db237ee0` | Apache-2.0 | hypothesis' only dependency |

The uv download cache (16 MB) was deleted after the install. Nothing in the venv runs at stream generation or grading
time: the generators use only the frozen table, so streams never depend on an installed package.

## Other material read (not downloaded into the repo)

| Source | URL | Read | Kind |
|---|---|---|---|
| NIS2 Art. 23(4)(a),(b),(d) (unofficial reproduction; EUR-Lex returned an empty HTTP 202 page to this session) | https://www.nis-2-directive.com/NIS_2_Directive_Article_23.html | 2026-11-04 | docs claim |
| Regulation (EEC, Euratom) No 1182/71 Art. 3(1), 3(2)(c), 3(4) | https://www.legislation.gov.uk/eur/1971/1182/article/3 | 2026-11-04 | docs claim |
| AutomationBench's own handlers and record shapes (`corpus/AutomationBench`, pinned clone in the main tree, read-only; venv reused, not installed) | local | 2026-11-04 | observed code (scratchpad probe of chat.postMessage, messages/send, values append/rows PUT, Jira issue create) |

## Disk at the end of this item

`/var/tmp/foundry-work/benches/factory` holds the venv (7.5 MB), the two adopted downloads (9.4 MB), metadata (0.2 MB)
and the 24 sealed streams (4.4 MB, mode 0700/0600, `sealed/`): about 34 MB on disk. Within D16's caps (500 MB per
install, 1.5 GB in total).
