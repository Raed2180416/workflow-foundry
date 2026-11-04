
## Sweep: agentic-tool (2026-10-21)

Rule: D16 (`research/decisions-20261021.md`). Probes ran outside the repo under `/var/tmp/foundry-work/benches/`, in isolated
hash-pinned venvs, with `env -i` and (where no network was needed) `unshare -rn`. Notes: scratchpad `breadth/agentic-tool.md`.

**Installed for a $0 oracle probe, then deleted** (kept: lockfiles and probe scripts, 324 KB, in
`/var/tmp/foundry-work/benches/_agentic-tool-probes/`):

| Bed | What was installed | Size | Result | Disposition |
|---|---|---|---|---|
| WorkBench @ `49c7dfd0` (MIT) | sparse blobless clone + 9 wheels from its `uv.lock` | 3.6 MB + 127 MB | gold 690/690; do-nothing floor 124/690 | deleted; adopt candidate |
| AppWorld 0.1.3.post1 (Apache-2.0 + encryption condition) | 80 wheels, `appworld install`, data bundle `fd9f9608...8250` | 173 MB + 216 MB | gold 147/147 (train+dev); do-nothing 0/147 | deleted; adopt candidate |
| bfcl-eval 2026.3.23 (Apache-2.0), `--no-deps` + 28 light wheels | wheel 1.9 MB | 106 MB | multi-turn gold 800/800; null 0/800 | deleted; adopt candidate |
| agentdojo 0.1.35 (MIT) | 72 wheels | 166 MB | gold utility 97/97; null 5/97 | deleted; adopt candidate |

**Downloaded as data, then deleted:** ToolHop.json (19.7 MB, sha256 `0a51f71a...a7fab`, Apache-2.0), NESTFUL `nestful_data.jsonl`
(8.4 MB, sha256 `e7c9999e...22c1`, Apache-2.0). Full hashes and URLs: notes section 6.

**Metadata only (nothing installed or pulled):** MCP-Atlas (ghcr manifest: 1,021.6 MB compressed), LiveMCPBench (Docker Hub 6,330 MB),
WebArena-Verified (Docker Hub 1.2 to 22 GB per site), EnterpriseOps-Gym (images 103 to 168 MB each; Docker daemon not available here).

**Not adopted, nothing fetched beyond README/metadata:** MCP-Atlas, LiveMCPBench, MCP-Bench, MCP-Universe, ComplexFuncBench,
WebArena-Verified, VisualWebArena, Toolathlon-Verified, ShortcutsBench-as-oracle, ToolSandbox (needs an LLM user simulator and a
RapidAPI key). Reasons: image over 1 GB, accounts or live APIs, or LLM-judged scoring. Detail: notes section 5.

Disk at time of work: 0.27 GB free at 17:30 UTC (earlier ENOSPC incidents are in `a0-dev60-dn.failed-enospc-prepare-20261015.log`); peak
concurrent probe use about 600 MB, all freed by 17:55 UTC.

## Sweep: recurring-synthesis (2026-10-21)

Rule: D16. Probes ran outside the repo under `/var/tmp/foundry-work/benches/_recurring-probes/`, `env -i`, `python -I`, wheels only
with `--require-hashes`. Notes: scratchpad `breadth/recurring-synthesis.md` (section 9 has every URL, size and sha256).

**Installed for a $0 probe, then deleted** (kept: `tryton/requirements.in`, `tryton/requirements.lock` with per-wheel hashes, and four
probe scripts, about 100 KB):

| Item | What was installed | Size | Result | Disposition |
|---|---|---|---|---|
| Tryton 8.2.1 (GPL-3.0-or-later; proteus LGPL-3.0-or-later) | trytond, 10 module wheels, proteus + deps: 32 packages | 49 MB venv (57 MB on disk) + 6 MB uv cache | purchase module's 11 shipped scenario doctests: OK in 900 s wall (15 min, load average ~12); activating 7 modules plus dependencies on in-memory SQLite: 88.6 s | deleted; adopt candidate for the N-version ERP oracle (D4 covers the install when OT-1 starts) |

**Downloaded as data, then deleted:**

| Data | URL | Size | sha256 | Licence | Disposition |
|---|---|---|---|---|---|
| UCI incident management event log (ID 498) | https://archive.ics.uci.edu/static/public/498/incident+management+process+enriched+event+log.zip | 2,400,214 B zip, 46,212,397 B CSV | `6294e29a311647306bfdfc85783f7df66517c197b9cd49aa5ee36ba9c525d1d6` (zip) | CC BY 4.0 | deleted; analysed for arrivals, SLA flag, reopen and reassignment rates |
| AgentWorldModel-1K `gen_scenario.jsonl` | https://huggingface.co/datasets/Snowflake/AgentWorldModel-1K/resolve/main/gen_scenario.jsonl | 1,338,786 B | `6362e31af6e39bc914c6606b32f62b3d5f571f9653e86a6a9c29e507ae0e647e` | CC-BY-4.0 | deleted |
| AgentWorldModel-1K `gen_tasks.jsonl` | same, `gen_tasks.jsonl` | 2,736,676 B | `0537871c8824cd56d23cc51118294ae3c3070d990cb9a3f766f9dc690f91bf45` | CC-BY-4.0 | deleted |
| AgentWorldModel-1K `README.md` | same, `README.md` | 3,917 B | `12a0f7eb70edfb5e6fb02f9904c3e06daea24eab392ff4d6cef229ce18237810` | CC-BY-4.0 | deleted |

**Metadata only (nothing installed or pulled):** NYC 311 Service Requests 2020-present (Socrata `erm2-nwe9`; no licence field in the
dataset metadata, terms not read); AgentWorldModel-1K other files (`gen_envs` 104 MB, `gen_verifier` 248 MB, `gen_verifier.pure_code`
45 MB, `gen_spec` 68.5 MB, `gen_sample` 37 MB; sizes from HEAD requests); Toucan-1.5M (136 files, Apache-2.0); PyPI metadata for holidays,
workalendar, pm4py, ocpa, ortools (29.8 MB manylinux wheel), simpn, simpy, faker, hypothesis.

**Not adopted:** Toucan-1.5M (no executable outcome verifier), ContextWeave (CC BY-NC-SA, LLM-judged, about $200 per configuration),
ClawForge (no release bundle at submission), Vending-Bench 2 (no usable release found), Odoo / ERPNext / OFBiz as running systems (database
server or JVM required; inert reading only, see ORG-SCALE-SOURCES).

**Not reachable in this session:** EnvScaler, AWM and SimPN repositories (GitHub access not enabled; `add_repo` not used); EUR-Lex
(empty page to the fetch tool); Exa (HTTP 402, credits exhausted at 18:05 UTC).

Disk at time of work: 4.4 GB free at 17:57 UTC, 3.5 GB at 18:23 UTC with other sweeps running; peak use of this sweep about 160 MB, all freed by 18:24 UTC.

## Sweep: enterprise-process (2026-10-21), merged from the sweep's notes by the PLAN.md author

Rule: D16. The sweep did not write into the repository; these rows are copied from its notes, section 7 (scratchpad
`breadth/enterprise-process.md`; download hashes in `breadth/raw/MANIFEST.tsv`). All clones were shallow
(`--depth 1 --no-recurse-submodules --filter=blob:limit=25m`), inert (nothing installed or run; only `python3 -I` reading
JSON/CSV/gz), under `/var/tmp/foundry-work/benches/_sweep-enterprise-process/`, and **all were deleted on 2026-10-21**.

| Clone | Pinned SHA (HEAD) | HEAD date | Clone MB | Licence | Disposition |
|---|---|---|---|---|---|
| olly-styles/WorkBench | 49c7dfd00c03d384ec59ea57374f50b766aa5613 | 2026-08-18 | 21.3 (tree, blobless); 8 on disk | MIT | read; recommended; deleted (re-clone for adoption) |
| ServiceNow/EnterpriseOps-Gym | 271f2c357f763376997dfd16807fcde2474ae41b | 2026-08-19 | 33 | Apache-2.0 | read; recommended (laptop); deleted |
| ServiceNow/AgentArch | dfdd9cd69642f74d7f2c72738c96faff7b70e59f | 2026-01-07 | 1.6 | Apache-2.0 | read; recommended; deleted |
| itbench-hub/ITBench | e35270629b336ea3170c912edf3c4632eba877eb | 2026-10-20 | 22.5 | Apache-2.0 | read; live scenarios not adopted; deleted |
| zlwang-cs/OfficeBench | b978b808667c32b52ce19a67ce1def1de9ae02b7 | 2026-03-31 | 43 | Apache-2.0 | read; not adopted; deleted |
| AST-FRI/EnterpriseBench | 9e41e5c1159c7ffd8359e943b1e4d296d3e91b4c | 2026-09-15 | 240 | MIT | read; not adopted (LLM judge); deleted |
| bird-bench/BIRD-Interact | 451fe2c3518ee1cf908d8139e2913483bd519381 | 2026-03-29 | 17 | MIT (data CC BY-SA 4.0) | read; deferred; deleted |
| stanfordmlgroup/MedAgentBench | 99260117137b09f04837a8c18d18a1107efa55ae | 2025-11-21 | 2.8 | MIT | read; not adopted (1.84 GB image); deleted |
| HazyResearch/legalbench | b46bf4ffae90524b2b72aaa30e7745fe9db64481 | 2026-03-29 | 19.9 | per task | read; optional typed-judgment axis; deleted |
| SalesforceAIResearch/CRMArena | 22033e5364b4ca5faf71fe29deae181b4c518706 | 2026-10-15 | 123.7 | CC BY-NC 4.0 | read; not adoptable (live org); deleted. Shared credentials in its README were not used or recorded |
| ServiceNow/WorkArena | e885130962f61fb64ac305497996a46cfc7d18f0 | 2026-09-28 | 152 | Apache-2.0 | read; not adoptable (ServiceNow instances); deleted |
| TheAgentCompany/TheAgentCompany | 98b68ef82a47690c316f42fddb05baafaab56851 | 2025-11-17 | 18 | MIT | read; not adoptable (30+ GB images); deleted |
| patronus-ai/financebench | cc39aeb4afdf33909ee1412188bf89035950c2eb | 2024-12-03 | **1,258 (over the 500 MB cap)** | not stated | read; not adopted; deleted |
| xlang-ai/Spider2 | cafb867313aab4e674652054198f383cf4018943 | 2026-08-12 | **2,150 (over the 500 MB cap)** | MIT | read; not adopted; deleted |
| column-tax/tax-calc-bench | b2a6b82112a9884d83eca00e6183188c5a3697e9 | 2026-10-21 | ≥ 285 (aborted: disk full) | MIT | partial clone deleted; re-acquire sparse (TY24 only) if adopted |

**Compliance incident (disclosed by the sweep).** Its size-measurement loop cloned the 13 repositories above plus the
partial tax-calc-bench clone, about 4.0 GB transient. That broke D16's 500 MB per-clone cap (Spider2, FinanceBench) and
the 1.5 GB total, and filled the disk to 100% for a short time (286 MB free). Everything was deleted at once (2.8 GB free
afterwards). No repository, run or sealed file was touched; nothing third-party was installed or executed. Fix adopted in
PLAN.md §5.5: measure with `git ls-remote` and a blobless clone plus `ls-tree -l`, one clone at a time, `df` check before
each, no background loops.

Files kept for reading (scratchpad, about 5 MB, not data acquisitions): READMEs and LICENSE files, HF dataset cards and API
JSON, DABstep `all.jsonl` (0.19 MB) and `dev.jsonl`, 60 DABstep `task_scores` files (about 3 MB), ITBench-Lite `eval.py`.

## Sweep: construction (2026-10-21), merged from the sweep's notes by the PLAN.md author

Rule: D16. Copied from the sweep's notes, section 8 (scratchpad `breadth/construction.md`). Downloads were made under
`/var/tmp/foundry-work/benches/construction-probe/`, in venvs built with `uv pip install --no-deps --only-binary :all:
--require-hashes` (no post-install hook ran). Peak 402 MB. **Deleted 2026-10-21 18:08 UTC.**

| What | URL | Bytes | sha256 | Licence | Disposition |
|---|---|---|---|---|---|
| SpreadsheetBench Verified-400 | https://huggingface.co/datasets/KAKA22/SpreadsheetBench/resolve/main/spreadsheetbench_verified_400.tar.gz | 14,958,255 | 10ef893dd29cb13ab97143ea787e68cdc9574a13873ab9a54e50b31dc03fc949 | CC BY-SA 4.0 | deleted; Tier 2 (912 set) candidate |
| SpreadsheetBench 912 v0.1 | https://huggingface.co/datasets/KAKA22/SpreadsheetBench/resolve/main/spreadsheetbench_912_v0.1.tar.gz | 95,752,357 | 9cf7228b54f1edcdd4b372eb736774adf29cb4f804c9920229bac6c154833399 | CC BY-SA 4.0 | deleted; Tier 2 candidate |
| NaturalPlan trip_planning.json | https://raw.githubusercontent.com/google-deepmind/natural-plan/main/data/trip_planning.json | 18,989,726 | 15c4755daec9433115f3a9f0dfdca5edafd4a10a7f51b742315eee65c6281e08 | CC BY 4.0 (data) | deleted; Tier 1 candidate |
| NaturalPlan meeting_planning.json | https://raw.githubusercontent.com/google-deepmind/natural-plan/main/data/meeting_planning.json | 23,857,401 | cabd5537667e97d15faf0c3f0187b8eefc720abf0e03fedf8e52dd01c596d53a | CC BY 4.0 | deleted; Tier 1 candidate |
| NaturalPlan calendar_scheduling.json | https://raw.githubusercontent.com/google-deepmind/natural-plan/main/data/calendar_scheduling.json | 6,660,095 | 3f34ff275b22202e16f750560f39805860378ba30f4e15cd80cf37986bcd484d | CC BY 4.0 | deleted; Tier 1 candidate |
| openpyxl 3.1.5 wheel | PyPI | 250,910 | 5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2 | MIT | deleted with its venv |
| et-xmlfile 2.0.0 wheel | PyPI | 18,059 | 7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa | MIT | deleted with its venv |
| absl-py 2.3.1 wheel | PyPI | 135,811 | eeecf07f0c2a93ace0772c92e596ace6d3d3996c042b2128459aaae2a76de11d | Apache-2.0 | deleted with its venv |

**Not acquired:** Spider2-DBT zips (377,819,033 B + 683,874,645 B; over the per-download cap; owner decision), DAComp-DE
and DAComp-DA (5.3 GB and 6.1 GB), Chat2Workflow (Docker stack and provider keys), ScienceAgentBench (password-protected
SharePoint zip), ELT-Bench (hosted accounts).

**Read-only fetches** (READMEs, LICENSE files, evaluator sources, arXiv PDFs, HF file listings, 1-byte range probes of three
Google Drive links) are in the scratchpad `breadth/raw/construction/` (42 MB).

**Observation reconciled.** The construction sweep saw `/var/tmp/foundry-work/benches/appworld/` and `workbench/` at
17:24 UTC and not at 18:08 UTC. Those are the agentic-tool sweep's installs; its rows above record both as installed for a
$0 probe and deleted.

## PLAN.md author (2026-10-21)

No install, clone or data download. One $0 power simulation in the scratchpad (`breadth/plan/pool_power.py`, importing the
methodology sweep's `tools-meth/portfolio_sim.py`). Disk at writing: 3.5 GB free (`df`). Read-only reads of the pinned,
already-present `corpus/tau2-bench` (split and task files, registry, CHANGELOG) with `python3 -I`.

## PLAN.md and PREREG revision 2 author (2026-10-21, late evening)

No install, clone or data download. Two $0 calculations in the scratchpad (`breadth/plan2/cost2.py`,
`breadth/plan2/graph_power.py`, the second importing `tools-meth/portfolio_sim.py`), outputs beside them. Read-only reads
of the pinned `corpus/tau2-bench` with `python3 -I` and `grep` (telecom `tasks.json` ids and one task, `split_tasks.json`,
solo-mode code paths in `src/tau2/domains/*/environment.py` and `src/tau2/agent/llm_agent.py`). Disk at writing: 3.0 GB
free (`df -h /`).

## PLAN.md and PREREG revision 3 author (2026-10-21, night)

No install, clone or data download; nothing published. Three $0 calculations in the scratchpad (`breadth/plan3/power3.py`,
`breadth/plan3/cost4.py`, `breadth/plan3/harm_guard.py`, outputs beside them; the first and third import the methodology
sweep's `tools-meth/portfolio_sim.py`). Read-only reads of repository files (REGISTER.md, PREREG-AB-v1 AM-9, decisions,
R0-RUNBOOK, executor and sandbox sources, `policy/models.json`) and of the three critiques' scratchpad scripts. The rev-2
author's private claude.ai artifact of PLAN.md was not opened, updated, republished or deleted (PLAN §11 OD-0). Disk during
writing: 2.8–3.7 GB free (`df -h /`), `/var/tmp/foundry-work` 3.7 GB (other tracks).
## T1-1 WorkBench + shared facade (2026-10-21 23:14Z – 2026-10-22), adopted

Rule: D16. Everything lives under `/var/tmp/foundry-work/benches/workbench/` (outside the repository); notes, gates and
the paid commands are in [workbench/ACQUISITION.md](workbench/ACQUISITION.md). Nothing ran a post-install hook: the clone is
inert source, and the venv holds wheels unpacked by `uv pip install --no-index --only-binary :all: --require-hashes --no-deps`.

**Kept (adopted):**

| What | Source | Bytes | sha256 | Licence | Date (UTC) |
|---|---|---|---|---|---|
| olly-styles/WorkBench @ `49c7dfd00c03d384ec59ea57374f50b766aa5613` (HEAD date 2026-08-18), shallow (depth 1) blobless fetch of that commit, no LFS or submodules | https://github.com/olly-styles/WorkBench | 67 MB on disk (`.git` 21 MB, `data/` 44 MB of which `data/results/` 39 MB) | LICENSE `e8bbcabb0cf6834062d9aec616ff9b52ee8c7ac2ff3e9f02a5a996e82717e26b`, uv.lock `ef9a825a3faafc891deb31576f3b75d3ae2739abe4d8b81a025e11a1c413b8db` | MIT (Copyright (c) 2024 Mindsdb) | 2026-10-21 23:14 |
| numpy 1.26.4 (cp312 manylinux x86_64) | https://files.pythonhosted.org/packages/0f/50/de23fde84e45f5c4fda2488c759b69990fd4512387a8632860f3ac9cd225/numpy-1.26.4-cp312-cp312-manylinux_2_17_x86_64.manylinux2014_x86_64.whl | 17,950,613 | 675d61ffbfa78604709862923189bad94014bef562cc35cf61d3a07bba02a7ed | BSD-3-Clause | 2026-10-21 23:16 |
| pandas 3.0.3 (cp312 manylinux x86_64) | https://files.pythonhosted.org/packages/65/b6/09b01cdbc15224e2850365192d17b7bdebb8bdbd8780ed221fcdf0d9a515/pandas-3.0.3-cp312-cp312-manylinux_2_24_x86_64.manylinux_2_28_x86_64.whl | 10,894,600 | 6dc0b3fd2169c9157deed50b4d519553a3655c8c6a96027136d654592be973a9 | BSD-3-Clause | 2026-10-21 23:16 |
| python-dateutil 2.9.0.post0 | https://files.pythonhosted.org/packages/ec/57/56b9bcc3c9c6a792fcbaf139543cee77261f3651ca9da0c93f5c1221264b/python_dateutil-2.9.0.post0-py2.py3-none-any.whl | 229,892 | a8b2bc7bffae282281c8140a97d3aa9c14da0b136dfe83f850eea9a5f7470427 | Apache-2.0 or BSD-3-Clause (dual) | 2026-10-21 23:16 |
| python-dotenv 1.2.2 | https://files.pythonhosted.org/packages/0b/d7/1959b9648791274998a9c3526f6d0ec8fd2233e4d4acce81bbae76b44b2a/python_dotenv-1.2.2-py3-none-any.whl | 22,101 | 1d8214789a24de455a8b8bd8ae6fe3c6b69a5e3d64aa8a8e5d68e694bbcb285a | BSD-3-Clause | 2026-10-21 23:16 |
| six 1.17.0 | https://files.pythonhosted.org/packages/b7/ce/149a00dd41f10bc29e5921b496af8b574d8413afcd5e30dfa0ed46c2cc5e/six-1.17.0-py2.py3-none-any.whl | 11,050 | 4721f391ed90541fddacab5acf947aa0d3dc7d27b2e1e8eda2be8970586c3274 | MIT | 2026-10-21 23:16 |
| tenacity 9.1.4 | https://files.pythonhosted.org/packages/d7/c1/eb8f9debc45d3b7918a32ab756658a0904732f75e555402972246b0b8e71/tenacity-9.1.4-py3-none-any.whl | 28,926 | 6095a360c919085f28c6527de529e76a06ad89b23659fa881ae0649b867a9d55 | Apache-2.0 | 2026-10-21 23:16 |
| tqdm 4.67.3 | https://files.pythonhosted.org/packages/16/e1/3079a9ff9b8e11b846c6ac5c8b5bfb7ff225eee721825310c91b3b50304f/tqdm-4.67.3-py3-none-any.whl | 78,374 | ee1e4c0e59148062281c49d80b25b67771a127c85fc9676d3be5f243206826bf | MPL-2.0 AND MIT | 2026-10-21 23:16 |
| tzdata 2026.2 | https://files.pythonhosted.org/packages/ce/e4/dccd7f47c4b64213ac01ef921a1337ee6e30e8c6466046018326977efd95/tzdata-2026.2-py2.py3-none-any.whl | 349,321 | bbe9af844f658da81a5f95019480da3a89415801f6cc966806612cc7169bffe7 | Apache-2.0 | 2026-10-21 23:16 |

Every wheel's sha256 equals the hash in WorkBench's `uv.lock` (`wheels-record.json` beside the venv). Licences are the
wheels' own `METADATA` fields. Installed: venv 121 MB (CPython 3.12.3, uv 0.11.32), wheels kept 29 MB (offline rebuild by
hash). **8 wheels, not the 9 of the earlier probe:** that probe installed pandas 2.3.3 + pytz, which is `uv.lock`'s branch for
Python ≥ 3.14; for CPython 3.12 on Linux `uv.lock` resolves pandas 3.0.3 without pytz, and colorama is Windows-only.
`uv.lock` marks tzdata as win32/emscripten-only for pandas 3.0.3; it is installed anyway so that time-zone data never comes
from the host. Not installed (not imported by any code path used here): matplotlib, seaborn, openai and their dependencies.

**Generated, host-only (never committed):** regenerated task sets (`host-only/regen/`, 2.8 MB: seeds 42 ×2, 8850 ×3), the
sealed and companion manifests (`host-only/sealed/`, 0.5 MB; sha256 committed in `workbench/SPLIT.json`), per-row parity
verdicts (`host-only/parity/`), raw offline init events (`host-only/init-probe/`).

**Deleted:** every scripted run's live worlds and workdirs (`live/…`), after grading. The earlier probe's install
(agentic-tool sweep, above) had been deleted before this re-acquisition.

**Disk:** 223 MB for WorkBench in all (src 67, venv 121, wheels 29, host-only and work 6), against D16's 500 MB per item;
breadth benches in total 416 MB (with `agentdojo/` 193 MB) against 1.5 GB. Free disk 2.9 GB at 02:52Z on 10-22 (`df -h /`).

**Addendum 2026-10-28 and 2026-11-04 (T1-1 resume).** No new download, clone or install; the clone, venv and wheels
above are unchanged (the pinned `uv.lock` and wheel hashes still match). Generated, host-only: regenerated stream
candidates (`host-only/regen/seed886{0,1,2}-streams.jsonl`, 1.7 MB, 10-28; for the extras rule, not frozen), the full
$0 gate run's per-row verdicts (`host-only/parity/`, 9 MB, 11-04). Deleted on 11-04: the live worlds of every scripted
run after grading, superseded 10-22/10-28 intermediate parity inputs (about 0.6 MB) and a stale test task file. Disk on
11-04: WorkBench 230 MB (src 67, venv 121, wheels 29, host-only 15); breadth benches 797 MB in all (with `agentdojo/`
193 MB and another item's `appworld/` 374 MB) against 1.5 GB; free disk 2.0 GB at 12:23Z, 0.7 GB at 14:43Z (`df -h /`).
## Tier-1 bed 2: AgentDojo adoption (2026-10-21 install, 2026-10-28 adapter)

Rule: D16. Acquisition record: `research/breadth-20261021/agentdojo/ACQUISITION.md`.

| Item | Size | Disposition |
|---|---|---|
| agentdojo 0.1.35 + 71 dependency wheels, installed into `/var/tmp/foundry-work/benches/agentdojo/venv` (uv 0.11.32, `--require-hashes --no-index`) | 41,368,378 B downloaded; venv 155 MiB apparent, 193 MB on disk | **adopted** (bed 2); every installed file checked against its wheel RECORD on 2026-10-28 (`verify_install.py`) |
| the downloaded `wheels/` directory (the 72 files listed with URL, sha256, size and licence in `/var/tmp/foundry-work/benches/agentdojo/downloads.json`) | 41,368,378 B | **deleted** after the install by the 2026-10-21 session (observed absent on 2026-10-28; no record of the exact time) |
| `downloads.json`, `requirements.lock.txt` (also in git) | 42,939 B, 142,875 B | kept |

Nothing else was downloaded for this bed; no clone, sdist, data file or image. To be deleted after the bed's sealed run and
analysis: the venv (then recorded here). Scratch run data stays outside the repo under `/var/tmp/foundry-work/agentdojo-live/`
(parity and seal scratch; batteries' snapshots are removed as soon as they are graded) and host-only data under
`/var/tmp/foundry-work/agentdojo-host/` (PLAN §5.6).

2026-11-04 (completion session): nothing downloaded or installed. Deleted scratch of the 10-22 development session under
`/var/tmp/foundry-work/agentdojo-live/` (`mutall`, `mutall2`, `mutall3`, `mut1`, `smoke`: per-unit snapshots of early
mutation and smoke batteries, about 126 MB on disk; superseded by `parity.json`, which recomputes every battery). Disk free
before: 2.0 GB (`df -h /`); after: 2.1 GB.
