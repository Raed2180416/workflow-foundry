
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
