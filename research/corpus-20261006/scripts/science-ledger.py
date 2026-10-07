#!/usr/bin/env python3
"""Render research/corpus-20261006/parts/science-ledger.md from the acquisition manifests under
/opt/corpus/<platform>/, the converter stats in /opt/corpus/science-work/ and the selection stats written
by science-assemble.py. Prose sections are fixed text in this script; every number and source row is computed.
Usage: python3 -I science-ledger.py
"""
import collections, glob, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
PARTS = os.path.join(os.path.dirname(HERE), "parts")
OUT = os.path.join(PARTS, "science-ledger.md")
WORK = "/opt/corpus/science-work"
S = json.load(open(f"{WORK}/science-stats.json"))
ITEMS = [json.loads(l) for l in open(os.path.join(PARTS, "science.jsonl"))]
SEL = {i["id"]: i for i in ITEMS}


def j(p):
    return json.load(open(p))


def row(*c):
    return "| " + " | ".join(str(x).replace("|", "\\|").replace("\n", " ") for x in c) + " |"


def cnt(pairs, n=12):
    return ", ".join(f"{k} {v}" for k, v in pairs[:n]) or "-"


def short(s, n=150):
    s = re.sub(r"\s+", " ", s or "")
    return s if len(s) <= n else s[: n - 1] + "…"


L = []
w = L.append
F = S["features"]
w("# Science cluster: acquisition ledger (corpus-20261006)")
w("")
w("Cluster scope: scientific workflow systems: nf-core and other Nextflow pipelines, Galaxy (IWC + WorkflowHub), CWL, "
  "Snakemake and WDL (GitHub repositories, Dockstore, WorkflowHub). Items: `parts/science.jsonl` (`foundry-corpus-item/1`). "
  "Raw downloads only under `/opt/corpus/{nf-core,galaxy,cwl,wdl,snakemake,workflowhub,dockstore}/` and converter outputs under "
  "`/opt/corpus/science-work/` (outside git). Converters and fetchers: `scripts/science-*.py` (pins in `scripts/science-requirements.txt`). "
  "All corpus content was treated as data: Nextflow and Snakefiles were scanned statically (regex/tokeniser; never run, no `nextflow` or "
  "`snakemake` binary used), Galaxy `.ga` / CWL / YAML parsed as JSON / `yaml.safe_load`, WDL loaded with the miniwdl parser and type "
  "checker with a local-only import reader (no network imports). Git clones were shallow, blob-filtered and sparse, with hooks disabled, "
  "no LFS and no submodules. No containers, conda environments, test suites or install hooks were run.")
w("")
w(f"Retrieved 2026-10-06/07. Status: **development/diagnostic corpus**, not sealed evaluation data. "
  f"Total selected: **{S['total']}** items ({F['redistributable']} redistributable as normalised graphs; the other "
  f"{S['total'] - F['redistributable']} keep URL + derived graph structure only, with titles replaced by ids and no description or summaries).")
w("")
w("## Reproduction")
w("")
w("```sh")
w("S=research/corpus-20261006/scripts; V=/opt/corpus/.venv-science/bin/python   # uv venv --python 3.13; uv pip install -r $S/science-requirements.txt")
w("python3 -I $S/science-fetch-nfcore.py                       # nf-co.re/pipelines.json + sparse clones at latest release tags")
w("git -c core.hooksPath=/dev/null clone --depth 1 --filter=blob:limit=1m --no-recurse-submodules https://github.com/galaxyproject/iwc /opt/corpus/galaxy/iwc")
w("python3 -I $S/science-fetch-snakemake.py 70                  # snakemake-workflow-catalog: top 70 standardized by stars")
w("python3 -I $S/science-fetch-git.py                           # CWL + WDL GitHub repositories (section E)")
w("python3 -I $S/science-fetch-workflowhub.py meta && ... select && ... files && ... crate-meta && ... gitapi")
w("python3 -I $S/science-fetch-dockstore.py list && ... select 70 && ... files")
w("for c in nfcore iwc snakemake-catalog cwl-repos wdl-repos workflowhub dockstore; do $V -I $S/science-$c.py; done   # -> /opt/corpus/science-work/*.jsonl")
w("python3 -I $S/science-assemble.py && python3 -I $S/science-ledger.py")
w("```")
w("")
w("Selection (seeded 20261006, `science-assemble.py`): graphs with <3 nodes are dropped; structural duplicates (same multiset of node "
  "types and edge count) are dropped keeping the more authoritative source (IWC > nf-core > Snakemake catalog > CWL repos > WDL repos > "
  "Dockstore > WorkflowHub). Per platform a head ranked by complexity plus bonuses for an oracle (output-equivalence +10, test-profile +6), "
  "ML-inference steps, runtime fan-out, sub-workflows and branching, minus 20 for tutorial/training/demo material (real production "
  "pipelines are preferred); no source owner / IWC category / WorkflowHub project may take more than 35% of a head; then a uniformly "
  "random tail from the remainder for representativeness. Non-selected converted candidates stay in `/opt/corpus/science-work/*.jsonl`.")
w("")
w("Science-cluster feature conventions (nodes, category, effects, loops, connectors) are documented at the top of "
  "`scripts/science-common.py`. In short: nodes are executable steps (processes / tools / rules / calls) after inlining static "
  "sub-workflows, plus input-validation and operator nodes; `loops` counts runtime fan-out over data (scatter, collection mapping, "
  "per-sample channels, wildcard expansion); `connectors` are `tool:<package>` and `service:<data service>`; `model` marks local "
  "ML-inference tools (AlphaFold, DeepVariant, Cellpose, Dorado, ...), not hosted LLM calls. Edges in Nextflow/Snakemake graphs are "
  "statically inferred may-flow edges, not traced executions.")
w("")
w("## Per-platform outcome")
w("")
w(row("platform", "candidates (by source)", "selected (head+tail)", "selected by source", "redistributable", "licences (selected)",
      "oracle kinds (selected)", "median nodes (selected)"))
w(row(*["---"] * 8))
for p, v in S["platforms"].items():
    w(row(p, f"{v['candidates']} ({cnt(v['by_source_candidates'])})", f"{v['selected']} ({v['selected_head']}+{v['selected_tail']})",
          cnt(v["by_source_selected"]), v["redistributable_selected"], cnt(v["licenses_selected"]), cnt(v["oracles_selected"]),
          v["nodes_median_selected"]))
w("")
w("Per-source conversion and filtering (before selection):")
w("")
w(row("source", "converted", "kept", "dropped <3 nodes", "dropped placeholder", "dropped structural duplicate"))
w(row(*["---"] * 6))
for src, v in S["sources"].items():
    w(row(src, v["converted"], v["kept"], v["lt3"], v["placeholder"], v["dup_struct"]))
w("")
dups = S["dropped"].get("structural-duplicate", [])
if dups:
    w("Structural duplicates dropped (dropped -> kept): " + "; ".join(f"`{a}` -> `{b}`" for a, b in dups) + ".")
    w("")
w("## Feature totals over the selected items")
w("")
w(f"- nodes {F['nodes']}, edges {F['edges']}; items with ML-inference steps {F['withModel']}, runtime fan-out (map) {F['withLoops']}, "
  f"branching {F['withBranching']}, inlined sub-workflows {F['withSubworkflows']}, inline/local code {F['withCode']}, "
  f"public-archive reads {F['withReadEffects']}, external effects (notifications/exports) {F['withExternalEffects']}, error handlers {F['withErrorPaths']}")
w(f"- node categories: {cnt(F['categories'], 20)}")
w(f"- async mechanisms: {cnt(F['async']) if F['async'] else 'none (scientific pipelines here are batch: no triggers, schedules, webhooks or human steps were found)'}")
w(f"- IR verdicts: {cnt(F['verdicts'])}; extensions needed: {cnt(F['extensions'])}")
w(f"- oracles: {cnt(F['oracles'])}")
w(f"- licences: {cnt(F['licenses'], 30)}")
w(f"- domains (heuristic keyword tags): {cnt(F['domains'], 25)}")
w(f"- data services referenced: {cnt(F['services'], 25)}")
w("")
w("IR notes. Every nf-core pipeline needs `retry-policy` (resource-escalating retries on `task.attempt`), `completion-hook` "
  "(e-mail/IM summary on completion) and `error-branch` (onError handler) extensions; DSL2 processes implicitly map over channel items "
  "(-> IR map) and params-gated if-blocks become when-guards. Galaxy, CWL and WDL graphs are `native` under the Phase 1 IR when "
  "sub-workflows are inlined at compile time (scatter / collection mapping -> map, `when` / if-sections -> when guards); "
  "Snakemake `module`/`subworkflow` imports need `subworkflow-call`; Nextflow `recurse`/`until` iteration needs `dynamic-dag`. "
  "These verdicts are static-analysis claims about structure, not demonstrations of executed equivalence.")
w("")
w("## Most complex selected items")
w("")
w(row("item", "nodes", "edges", "complexity", "oracle", "licence", "url"))
w(row(*["---"] * 7))
for iid, n, e, c, ok in S["top_complex"]:
    it = SEL[iid]
    w(row(f"`{iid}`", n, e, c, ok, it["source"]["license"], it["source"]["url"]))
w("")

# ---------------------------------------------------------------- oracles
w("## Executable oracles (test profiles / test data shipped with the workflow)")
w("")
w("Nothing below was run (no Nextflow, Galaxy, cwltool, Snakemake, Cromwell/miniwdl execution, Docker or conda in this container). "
  "`output-equivalence` = the source ships expected outputs or checksums to compare against (nf-test snapshots with md5s, planemo "
  "`-tests.yml` with reference files/checksums, Snakemake `.tests/unit` expected outputs, WARP `verification/Verify*.wdl` truth "
  "comparisons, ENCODE `ref_output/` QC JSON); `test-profile` = a runnable small test configuration with pinned test data but only "
  "content assertions or a smoke run (nf-core `conf/test*.config`, planemo content assertions, Snakemake `.test/` configs, "
  "Dockstore/WARP test input JSONs, WorkflowHub RO-Crate TestSuite entities). Test data are referenced (nf-core/test-datasets, Zenodo, "
  "GCS buckets), not downloaded.")
w("")
byp = collections.defaultdict(collections.Counter)
for it in ITEMS:
    byp[it["source"]["platform"]][it["oracle"]["kind"]] += 1
w(row("platform", "output-equivalence", "test-profile", "none"))
w(row(*["---"] * 4))
for p, c in byp.items():
    w(row(p, c["output-equivalence"], c["test-profile"], c["none"]))
w("")
w("<details><summary>Selected items with an oracle (evidence from the oracle notes)</summary>")
w("")
w(row("item", "kind", "evidence"))
w(row(*["---"] * 3))
for it in sorted(ITEMS, key=lambda i: (i["oracle"]["kind"] != "output-equivalence", i["id"])):
    if it["oracle"]["kind"] != "none":
        w(row(f"`{it['id']}`", it["oracle"]["kind"], short(it["oracle"]["notes"], 160)))
w("")
w("</details>")
w("")

# ---------------------------------------------------------------- sources
w("## Sources tried")
w("")
# A. nf-core
m = j("/opt/corpus/nf-core/fetch-manifest.json")
nst = j(f"{WORK}/nf-core-stats.json")
w("### A. nf-core (nf-co.re pipelines JSON API + GitHub clones)")
w("")
w(f"Index `{m['index']}` retrieved {m['retrievedAt']} (sha256 `{m['indexSha256']}`): {m['pipelinesInIndex']} pipelines, "
  f"{m['withRelease']} with at least one release. Every released pipeline was cloned (shallow, blob-filtered, sparse: `*.nf`, `*.config`, "
  "`nextflow_schema.json`, `conf/`, `tests/`, `workflows/`, `subworkflows/`, `modules/local/`, `modules.json`, LICENSE) at the latest "
  "release tag via the session git proxy. Licence: the LICENSE file of each clone (MIT for every pipeline; nf-core org policy is MIT). "
  "Redistributable: yes. Pipelines without a release (dev-only) were not acquired. Graph: static DSL2 analysis with nf-core modules "
  "resolved from `modules.json` names, sub-workflows inlined, parameters counted from `nextflow_schema.json`.")
w("")
w(row("pipeline", "tag", "commit", "published", "nodes/edges", "test profiles", "nf-test (snapshots, md5s)", "selected"))
w(row(*["---"] * 8))
for r in sorted(m["items"], key=lambda r: r["name"]):
    s = nst.get(r["name"], {})
    iid = f"nf-core:{r['name']}@{r['tag']}"
    w(row(r["name"], r["tag"], r["sha"][:12], (r.get("publishedAt") or "")[:10], f"{s.get('nodes', '?')}/{s.get('edges', '?')}",
          len(s.get("profiles", [])), f"{s.get('nftests', 0)} ({s.get('snaps', 0)}, {s.get('md5', 0)})", "yes" if iid in SEL else "no"))
w("")
# B. IWC
w("### B. Galaxy IWC (Intergalactic Workflow Commission)")
w("")
iwc_items = [json.loads(l) for l in open(f"{WORK}/galaxy-iwc.jsonl")]
w("`git clone --depth 1 --filter=blob:limit=1m --no-recurse-submodules https://github.com/galaxyproject/iwc` at commit "
  "`fc190a435262bb61ba29f316e987aa492eb5d18b` (2026-10-01). Every `workflows/**/*.ga` is one candidate. Licence: the per-workflow "
  "`license` field of the `.ga` (SPDX); copyleft (GPL/AGPL) workflows keep graph features only. Oracle: sibling planemo `-tests.yml`. "
  f"Converted {len(iwc_items)}; licences: {cnt(collections.Counter(i['source']['license'] for i in iwc_items).most_common())}; "
  f"oracles: {cnt(collections.Counter(i['oracle']['kind'] for i in iwc_items).most_common())}; selected {sum(1 for i in ITEMS if i['id'].startswith('galaxy:iwc/'))}.")
w("")
# C. WorkflowHub
fm = j("/opt/corpus/workflowhub/files-manifest.json")
wst = j(f"{WORK}/workflowhub-stats.json")
nmeta = len(glob.glob("/opt/corpus/workflowhub/meta/*.json"))
wfh_items = [json.loads(l) for l in open(f"{WORK}/workflowhub.jsonl")]
w("### C. WorkflowHub (workflowhub.eu API, per-workflow licences)")
w("")
w(f"`GET https://workflowhub.eu/workflows.json` and `/workflows/<id>.json` for all {nmeta} public workflow records (2026-10-06). "
  f"Candidates ({len(fm)}): every CWL, Snakemake, WDL and non-nf-core Nextflow entry plus the 90 largest Galaxy entries that are not IWC "
  "copies. Files: git-backed versions -> shallow sparse clone of the registered remote at the registered commit; otherwise the version's "
  "RO-Crate (25 MB cap, only workflow-definition files unpacked, zip-slip guarded); WorkflowHub-hosted git -> per-file git API. "
  "Licence: the record's submitter-declared `license` attribute (per workflow; `other-open` -> `LicenseRef-WorkflowHub-other-open`, "
  "treated as non-redistributable). Entries duplicating a directly acquired source were skipped.")
w("")
w(f"- file acquisition outcomes (via/status): {cnt(collections.Counter(str(r.get('via')) + '/' + str(r.get('status', '')).split(':')[0] for r in fm).most_common())}")
w(f"- converter skips ({len(wst['skipped'])}): {cnt(collections.Counter(re.sub(r'[(:].*', '', v).strip() for v in wst['skipped'].values()).most_common(), 20)}")
w(f"- converted {len(wfh_items)}: {cnt(collections.Counter(i['source']['platform'] for i in wfh_items).most_common())}; "
  f"licences {cnt(collections.Counter(i['source']['license'] for i in wfh_items).most_common(), 25)}")
w("")
w("<details><summary>Selected WorkflowHub items</summary>")
w("")
w(row("item", "licence", "revision", "oracle"))
w(row(*["---"] * 4))
for it in sorted((i for i in ITEMS if ":workflowhub/" in i["id"]), key=lambda i: i["id"]):
    w(row(f"`{it['id']}`", it["source"]["license"], short(it["source"]["revision"], 120), it["oracle"]["kind"]))
w("")
w("</details>")
w("")
# D. Dockstore
dm = j("/opt/corpus/dockstore/files-manifest.json")
dst = j(f"{WORK}/dockstore-stats.json")
ntrs = sum(len(j(f)) for f in glob.glob("/opt/corpus/dockstore/trs-wdl-*.json"))
w("### D. Dockstore (GA4GH TRS v2, WDL)")
w("")
w(f"`GET https://dockstore.org/api/ga4gh/trs/v2/tools?toolClass=Workflow&descriptorType=WDL` (all pages, 2026-10-06): {ntrs} WDL "
  "workflow entries. Selection: test/demo organisations and names dropped, sources acquired directly skipped (WARP, ENCODE, IWC, nf-core), "
  "at most 2 entries per organisation, verified > production > default-branch version -> 70 candidates. Files: TRS `/files` listing, then "
  "PRIMARY/SECONDARY descriptors and TEST_FILEs stored at their repository-absolute path (`dockstore_absolute_path`; a first pass that "
  "stored primary-relative paths lost every `../` import and was redone). Licence: Dockstore `licenseInformation.licenseName` "
  "(GitHub-detected licence of the source repository) mapped to SPDX; `Other`/missing -> unknown (non-redistributable).")
w("")
w(f"- conversion: {dst['counts']}; failures: " + "; ".join(f"{k}: {short(v, 90)}" for k, v in dst["failures"].items()))
w("")
w(row("entry", "version", "licence (Dockstore)", "files", "test files", "selected"))
w(row(*["---"] * 6))
for r in dm:
    trs = r["id"].replace("#workflow/", "")
    iid = f"wdl:{trs}:{r['version']}"
    w(row(trs, r["version"], r.get("license") or "none", r.get("files"), len(r.get("tests") or []), "yes" if iid in SEL else "no"))
w("")
# E/F. CWL + WDL repos
gm = j(f"{WORK}/git-manifest.json")
cst = j(f"{WORK}/cwl-repos-stats.json")
wdst = j(f"{WORK}/wdl-repos-stats.json")
w("### E. CWL and WDL GitHub repositories (session git proxy)")
w("")
w("Shallow (`--depth 1`), `--filter=blob:none`, sparse clones of definition files only (`*.cwl`, job/test YAML; `*.wdl`, input JSON) "
  "with the full file list written from tree objects (test data listed, not downloaded). Licence: repository LICENSE file at the cloned "
  "commit (no LICENSE file -> unknown, non-redistributable; NCBI PGAP's LICENSE.md is a US-Government public-domain notice). "
  "CWL: top-level workflows (not referenced by another file's `run:`), test/deprecated paths skipped, at most 8 per repository, largest first. "
  "WDL: every workflow file outside tests/verification/deprecated paths that miniwdl loads with local imports only.")
w("")
w(row("platform", "repository", "commit", "date", "licence", "CWL top-level workflows", "converted", "WDL load failures", "selected"))
w(row(*["---"] * 9))
for r in gm:
    st = (cst if r["platform"] == "cwl" else wdst).get(r["repo"], {})
    nsel = sum(1 for i in ITEMS if i["id"].startswith(f"{r['platform']}:{r['repo']}/"))
    w(row(r["platform"], r["repo"], r["head"][:12], (r.get("date") or "")[:10], st.get("license", "?"),
          st.get("topLevel", "-") if r["platform"] == "cwl" else "-", st.get("kept", 0),
          len(st.get("failures", {})) if r["platform"] == "wdl" else "-", nsel))
w("")
wf = {f"{repo}:{k}": v for repo, s in wdst.items() for k, v in s.get("failures", {}).items()}
if wf:
    w("WDL load failures (raw reasons): " + "; ".join(f"`{k}`: {short(v, 110)}" for k, v in wf.items()))
    w("")
# G. Snakemake catalog
sm = j("/opt/corpus/snakemake/fetch-manifest.json")
sst = j(f"{WORK}/snakemake-catalog-stats.json")
w("### F. Snakemake workflow catalog")
w("")
w(f"Catalog `{sm['catalog']}` cloned at `f1638109ec0447c7292d87496a06586388d78eba` (2026-10-05); {sm['standardized']} standardized "
  "workflows; the 70 with most stars (template repository excluded) were sparse-cloned at their latest release tag (else default-branch "
  "HEAD) with only Snakefiles, rules, schemas, config tables, `.test` configs, `.tests/unit`, CI workflows and LICENSE checked out. "
  "Licence: repository LICENSE/COPYING at the cloned commit.")
w("")
w(row("repository", "ref", "commit", "stars", "licence", "nodes/edges", "selected"))
w(row(*["---"] * 7))
for r in sm["items"]:
    s = sst.get(r["full_name"], {})
    nsel = sum(1 for i in ITEMS if i["id"].startswith(f"snakemake:{r['full_name']}@"))
    w(row(r["full_name"], (r.get("ref") or "").replace("refs/tags/", ""), (r.get("head") or "")[:12], r.get("stars"), s.get("license", "?"),
          f"{s.get('nodes', '?')}/{s.get('edges', '?')}", nsel))
w("")
# blocked
w("## Blocked, failed or unavailable")
w("")
w("- GitHub REST API (other repositories) is blocked by the egress proxy: repository metadata, licences and file lists were obtained "
  "from `git clone` through the session git proxy (tree objects) instead; no GitHub search was used to find workflows.")
w(f"- nf-core: {m['pipelinesInIndex'] - m['withRelease']} pipelines in the index have no release (in development) and were not acquired.")
w(f"- WorkflowHub: {sum(1 for r in fm if r.get('status') == 'too-large')} RO-Crates over the 25 MB cap (not downloaded), "
  f"{sum(1 for r in fm if r.get('status') == 'bad-zip')} crate endpoints answered with non-zip content, "
  f"{sum(1 for r in fm if str(r.get('status', '')).startswith('git-error'))} registered git remotes failed to clone, "
  f"{sum(1 for r in fm if r.get('status') == 'no-files-via-git-api')} hosted-git entries listed no files; "
  f"{sum(1 for v in wst['skipped'].values() if v.startswith('parse failed'))} main files did not parse as a workflow of their declared class "
  "(raw reasons in `/opt/corpus/science-work/workflowhub-stats.json`).")
nf_main = [k for k, v in wst["skipped"].items() if v.startswith("main workflow file not found")]
oxo = 0
for k in nf_main:
    try:
        g = j(f"/opt/corpus/workflowhub/x/{k}/ro-crate-metadata.json")["@graph"]
        root = next(x for x in g if x.get("@id") == "./")
        oxo += str((root.get("mainEntity") or {}).get("@id", "")).endswith(".oxoflow")
    except Exception:
        pass
w(f"- WorkflowHub: {len(nf_main)} entries have no workflow file in what was acquired (metadata-only RO-Crates of workflows registered "
  f"by URL, or a git checkout without the declared main file); {oxo} of them are oxo-flow (`*.oxoflow`) pipelines registered under the "
  "WDL class, a workflow system outside this cluster's parsers. Not fetched from their remotes.")
w(f"- Dockstore: {dst['counts'].get('failed', 0)} of {dst['counts'].get('entries', 0)} candidates did not convert (remote imports not fetched by "
  "design, miniwdl validation errors, or single-call wrappers below the 2-node threshold); listed above.")
w("- WDL: imports from other repositories (e.g. `raw.githubusercontent.com/broadinstitute/gatk/...`) are refused by the local-only "
  "reader, so the affected WARP pipelines are recorded as failures rather than parsed with missing calls.")
w("- Not attempted: Dockstore CWL/Nextflow/Galaxy entries (covered via WorkflowHub, IWC, nf-core and the GitHub clones), the "
  "nf-core modules/subworkflows repositories as standalone items, Snakemake wrappers, and executing any test profile.")
w("")
w("## Known limitations")
w("")
w("- Nextflow and Snakemake graphs come from static analysis: Nextflow edges are may-flow (conditional channel reassignments are "
  "unioned), Snakemake edges come from matching input to output path patterns, and input functions/lambdas are only partly resolved. "
  "The `nodes`/`edges` counts therefore over-approximate any single run's DAG.")
w("- Domain tags are keyword heuristics over titles, descriptions and tool names and over-tag (e.g. `phylogenetics` from `tree`).")
w("- Licences are the declared licence of the workflow definition (repository LICENSE, `.ga` field, WorkflowHub/Dockstore metadata). "
  "Tool containers and reference data each carry their own licences, which were not assessed.")
w("- WorkflowHub Galaxy entries include Galaxy Training Network tutorial workflows; they are down-weighted, not excluded, and are "
  f"flagged by title in the selection stats ({sum(v['tutorial_selected'] for v in S['platforms'].values())} selected).")
w("")
open(OUT, "w").write("\n".join(L))
print(OUT, len("\n".join(L)), "bytes")
