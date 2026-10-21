# Disposals of acquired research clones

| Date | Clone | Path | Pinned at | Why | Re-acquire |
|---|---|---|---|---|---|
| 2026-10-21 | tau2-bench | `/var/tmp/foundry-work/enterprise-src/tau2-bench` (857 MB) | `dd8757d4c8791dad7b3cdaf02a105a3d5f9d86bd` (ACQUISITIONS.json) | Disk headroom for live sealed runs. Its static reading is recorded in CATALOGUE.md row B3. A newer pinned, trimmed clone (`57e54143`, research/tau2-20261021/ACQUISITION.md) is in `corpus/tau2-bench` | `git clone --depth 1 https://github.com/sierra-research/tau2-bench` then `git fetch --depth 1 origin dd8757d4…` and check out that commit |
| 2026-10-21 | openui | `/var/tmp/foundry-work/enterprise-src/openui` (567 MB) | `39ce9899f9d06ff764934d7f1f160936efc348e6` (OPENUI.md §acquisition) | Disk headroom for live sealed runs. Read statically and never built; the reading is in OPENUI.md | `git clone --depth 1 https://github.com/thesysdev/openui` and check out that commit |
| 2026-10-21 | bpmn-miwg-test-suite | `/var/tmp/foundry-work/enterprise-src/bpmn-miwg-test-suite` (252 MB) | `386baa55bf9a200f13ce26bef18557eceb19031f` | Disk below 1.2 GB with the sealed run live; read statically (CATALOGUE.md) | `git clone --depth 1 https://github.com/bpmn-miwg/bpmn-miwg-test-suite` at that commit |
| 2026-10-21 | bpmn-for-research | `…/enterprise-src/bpmn-for-research` (159 MB) | `1416f6f2104ae597eafa3097946140ebc2136a53` | same | `https://github.com/camunda/bpmn-for-research` at that commit |
| 2026-10-21 | WorkArena | `…/enterprise-src/workarena` (149 MB) | `e885130962f61fb64ac305497996a46cfc7d18f0` | same; needs a hosted ServiceNow instance (excluded by D16) | `https://github.com/ServiceNow/WorkArena` at that commit |
| 2026-10-21 | generative-ui-bench | `…/enterprise-src/generative-ui-bench` (99 MB) | `fcca05af68dc3acc5b04660531509b4aed861c7e` | same | `https://github.com/thesysdev/generative-ui-bench` at that commit |
| 2026-10-21 | Kev source snapshot | `/var/tmp/foundry-work/kev/src-c34c073` (433 MB) | this repository at `c34c0735179823165398bdebc2da9d058f22179a` | same; Kev is parked (owner moved to hosted Jev on 10-09) | `git archive c34c073` of this repository |
