
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
