# Disposals of acquired research clones

| Date | Clone | Path | Pinned at | Why | Re-acquire |
|---|---|---|---|---|---|
| 2026-10-21 | tau2-bench | `/var/tmp/foundry-work/enterprise-src/tau2-bench` (857 MB) | `dd8757d4c8791dad7b3cdaf02a105a3d5f9d86bd` (ACQUISITIONS.json) | Disk headroom for live sealed runs. Its static reading is recorded in CATALOGUE.md row B3. A newer pinned, trimmed clone (`57e54143`, research/tau2-20261021/ACQUISITION.md) is in `corpus/tau2-bench` | `git clone --depth 1 https://github.com/sierra-research/tau2-bench` then `git fetch --depth 1 origin dd8757d4…` and check out that commit |
| 2026-10-21 | openui | `/var/tmp/foundry-work/enterprise-src/openui` (567 MB) | `39ce9899f9d06ff764934d7f1f160936efc348e6` (OPENUI.md §acquisition) | Disk headroom for live sealed runs. Read statically and never built; the reading is in OPENUI.md | `git clone --depth 1 https://github.com/thesysdev/openui` and check out that commit |
