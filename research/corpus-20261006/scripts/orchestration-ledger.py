#!/usr/bin/env python3
"""Render research/corpus-20261006/parts/orchestration-ledger.md from the acquisition manifests
under /opt/corpus/<platform>/ and the selection stats written by orchestration-assemble.py.
Prose sections are fixed text in this script; every number and source row is computed.
Usage: python3 -I orchestration-ledger.py
"""
import glob, json, os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "parts", "orchestration-ledger.md")
WORK = "/opt/corpus/orchestration-work"
S = json.load(open(f"{WORK}/orchestration-stats.json"))
ITEMS = [json.loads(l) for l in open(os.path.join(os.path.dirname(HERE), "parts", "orchestration.jsonl"))]


def j(p):
    return json.load(open(p))


def row(*c):
    return "| " + " | ".join(str(x).replace("|", "\\|") for x in c) + " |"


L = []
w = L.append
w("# Orchestration cluster: acquisition ledger (corpus-20261006)")
w("")
w("Cluster scope: data/ML/CI orchestration (Airflow, Argo Workflows, Kubeflow Pipelines, Tekton, GitHub Actions, "
  "GitLab CI, Dagster, Prefect, Temporal). Items: `parts/orchestration.jsonl` (`foundry-corpus-item/1`). "
  "Raw downloads only under `/opt/corpus/<platform>/` (outside git). Converters and fetchers: "
  "`scripts/orchestration-*.{py,sh}` plus `scripts/orchestration-gitlab-projects.txt`. All corpus content was treated as data: "
  "Python DAG/flow code was parsed with `ast` and never imported or executed; YAML was parsed with PyYAML `safe_load` "
  "(GitLab custom tags such as `!reference` are kept as inert markers); Go was scanned with regexes; no install hooks were run.")
w("")
w(f"Retrieved 2026-10-06. Status: **development/diagnostic corpus**, not sealed evaluation data. "
  f"Total selected: **{S['total']}** items ({S['features']['redistributable']} redistributable as normalised graphs).")
w("")
w("## Reproduction")
w("")
w("```sh")
w("S=research/corpus-20261006/scripts; V=/opt/corpus/.venv-orch/bin/python   # uv venv, pyyaml==6.0.3")
w("python3 -I $S/orchestration-fetch-pypi.py airflow apache-airflow-core apache-airflow==2.10.5 <101 provider names from apache-airflow extras>")
w("#   then: tar x --wildcards '*example_dags/*.py' '*tests/system/*.py' LICENSE NOTICE PKG-INFO into /opt/corpus/airflow/extracted/<sdist>/")
w("$S/orchestration-fetch-goproxy.sh argo github.com/argoproj/argo-workflows/v3 v3.7.18      # + kubeflow, tekton, temporal (see table)")
w("python3 -I $S/orchestration-fetch-github.py dagster dagster-io/dagster examples '\\.py$' HEAD 3000")
w("python3 -I $S/orchestration-fetch-github.py prefect PrefectHQ/prefect examples '\\.py$' ; ... PrefectHQ/prefect docs/v3 '\\.mdx$'")
w("LISTER=swh python3 -I $S/orchestration-fetch-github.py prefect PrefectHQ/prefect-recipes '' '\\.py$'")
w("python3 -I $S/orchestration-fetch-github.py temporal temporalio/samples-python '' '\\.py$'")
w("python3 -I $S/orchestration-gha-sample.py index && ... sample && ... fetch                   # Zenodo GHA histories")
w("$V -I $S/orchestration-fetch-gitlab.py projects $S/orchestration-gitlab-projects.txt && $V -I $S/orchestration-fetch-gitlab.py templates")
w("python3 -I $S/orchestration-airflow.py $W/airflow-candidates.json; $V -I $S/orchestration-argo.py ...; $V -I $S/orchestration-kfp-tekton.py kfp|tekton ...")
w("$V -I $S/orchestration-gha.py ...; $V -I $S/orchestration-gitlab.py ...; python3 -I $S/orchestration-pycode.py dagster|prefect|temporal ...")
w("python3 -I $S/orchestration-assemble.py && python3 -I $S/orchestration-ledger.py      # W=/opt/corpus/orchestration-work")
w("```")
w("")
w("Selection (seeded 20261006, `orchestration-assemble.py`): per platform a head ranked by complexity plus bonuses for "
  "human steps, model calls, error paths, loops, sub-workflows, event/wait async and the presence of an oracle "
  "(heads exclude graphs with <3 nodes; Airflow packages, Temporal sample families and GitLab templates-vs-projects are "
  "capped at 35% of a head), plus a uniformly random tail from the remainder for representativeness (GitHub Actions tail "
  "only from the uniform pool R). Non-selected converted candidates stay in `/opt/corpus/orchestration-work/*-candidates.json`.")
w("")
w("## Per-platform outcome")
w("")
w(row("platform", "units scanned", "converted", "conversion failures", "selected (head+tail)", "redistributable", "licences (selected)", "oracle kinds (selected)"))
w(row(*["---"] * 8))
for p, v in S["platforms"].items():
    w(row(p, v["units_scanned"], v["converted"], v["conversion_errors"], f"{v['selected']} ({v['selected_head']}+{v['selected_tail']})",
          v["redistributable_selected"], ", ".join(f"{a} {b}" for a, b in v["licenses_selected"]),
          ", ".join(f"{a} {b}" for a, b in v["oracles_selected"])))
w("")
w("Conversion failures (raw failures preserved in the candidate files):")
w("")
for p, v in S["platforms"].items():
    if v["error_kinds"]:
        w(f"- **{p}**: " + "; ".join(f"{e} x{n}" for e, n in v["error_kinds"]))
w("")
f = S["features"]
w("## Feature totals over the selected items")
w("")
w(f"- nodes {f['nodes']}, edges {f['edges']}; items with human steps {f['withHuman']}, model calls {f['withModel']}, "
  f"loops/maps {f['withLoops']}, branching {f['withBranching']}, sub-workflows {f['withSubworkflows']}, error paths {f['withErrorPaths']}")
w("- async mechanisms (items): " + ", ".join(f"{a} {b}" for a, b in f["async"]))
w("- IR verdicts: " + ", ".join(f"{a} {b}" for a, b in f["verdicts"]) + "; extensions needed: " + ", ".join(f"{a} {b}" for a, b in f["extensions"]))
w("")
w("## Sources tried")
w("")
w("### A. PyPI sdists (Apache Airflow core + providers)")
w("")
m = j("/opt/corpus/airflow/pypi-manifest.json")
cand = j(f"{WORK}/airflow-candidates.json")["items"]
per = Counter(i["source"]["revision"].split("==")[0] for i in cand)
w("Host `files.pythonhosted.org` via `pypi.org/pypi/<pkg>/json`; sha256 verified against PyPI digests; licence from PyPI "
  "`license_expression` (Apache-2.0 for every package; apache-airflow 2.10.5 via classifier) and the LICENSE/NOTICE in each sdist. "
  "Redistributable: yes (Apache-2.0; NOTICE preserved in the raw download). Example DAGs are `example_dags/*.py` and provider "
  "system tests `tests/system/**/example_*.py`.")
w("")
w(row("package==version", "sdist sha256 (12)", "DAGs converted", "outcome"))
w(row("---", "---", "---", "---"))
for k in sorted(m):
    v = m[k]
    if v.get("outcome") != "acquired":
        w(row(k, "-", 0, v.get("outcome")))
        continue
    n = per.get(v["package"], 0)
    w(row(f"{v['package']}=={v['version']}", v["sha256"][:12], n, "acquired" + ("" if n else " (no example DAGs shipped)")))
w("")
w("### B. Go module proxy (proxy.golang.org) as a mirror of GitHub repositories")
w("")
w("GitHub web/API/codeload are blocked by the egress proxy (403), so module source zips were fetched from "
  "`https://proxy.golang.org/<module>/@v/<version>.zip` (redirects to storage.googleapis.com). Origin commit from `.info`.")
w("")
w(row("platform", "module@version", "origin commit", "zip sha256 (12)", "licence + evidence", "used for", "redistributable"))
w(row(*["---"] * 7))
uses = {"argo": "examples/**/*.yaml (213 files) + .github/workflows", "kubeflow": "test_data/sdk_compiled_pipelines/**/*.yaml (159) + .github/workflows",
        "tekton": "examples/**/*.yaml (152) + .github/workflows", "temporal": "Go samples (one item per sample dir) + .github/workflows"}
for mp in sorted(glob.glob("/opt/corpus/*/github.com_*.manifest.json")):
    v = j(mp)
    plat = mp.split("/")[3]
    lic = "MIT" if "samples-go" in v["module"] else "Apache-2.0"
    w(row(plat, f"{v['module']}@{v['version']}", v["info"]["Origin"]["Hash"], v["sha256"][:12],
          f"{lic} (LICENSE at module root)", uses.get(plat, ""), "yes"))
w("")
w("### C. GitHub repositories via Sourcegraph listing / Software Heritage listing + raw.githubusercontent.com content")
w("")
w(row("repo", "lister", "commit", "files listed / fetched", "licence + evidence", "redistributable"))
w(row(*["---"] * 6))
for mp in sorted(glob.glob("/opt/corpus/*/*@*.path-*.manifest.json")):
    v = j(mp)
    if "repo" not in v or "oid" not in v:
        continue
    lic = (v.get("license") or {}).get("head", "")
    spdx = "Apache-2.0" if "Apache License" in lic else ("MIT" if "Permission is hereby granted" in lic or lic.startswith("MIT") or "MIT License" in lic else "see file")
    w(row(v["repo"] + (f" ({v['treePath']})" if v.get("treePath") else ""), v.get("lister"), v["oid"],
          f"{v['listed']} / {len([f for f in v['files'] if f.get('sha256')])}",
          f"{spdx} (raw {(v.get('license') or {}).get('path')} at commit)", "yes" if spdx in ("Apache-2.0", "MIT") else "check"))
w("")
w("### D. Zenodo: 'A dataset of GitHub Actions workflow histories' (MSR 2024)")
w("")
g = j("/opt/corpus/github-actions/sample.json")
oc_ = Counter(i.get("outcome") for i in g["sample"])
lic_found = sum(1 for i in g["sample"] if i.get("license"))
w("- Record: concept DOI 10.5281/zenodo.10259013, version 10.5281/zenodo.20340547 (published 2026-05-22), licence **CC-BY-4.0** "
  "(compilation; each workflow file keeps its repository's licence). Files used: `repositories.csv.gz` (md5 a345384e924083ae4da327e4fdf3af74, verified) "
  "and `workflows.csv.gz` (311 MB, md5 b557752520849d50a99d3750a8f62b68, verified). `workflows.tar.gz` (1.44 GB) and the auxiliaries "
  "were **not** downloaded: file contents were fetched individually instead. Author names/e-mails in the CSV were never copied.")
w(f"- Index: 358,935 (repo, path) files; {g['live_valid_files']:,} live and valid at their latest version. Sample (seed 20261006): "
  f"pool R = 220 uniform (one per repo), pool C = 330 random among files with >=25 versions (one per repo).")
w(f"- Content: `raw.githubusercontent.com/<repo>/<commit>/<path>` pinned to the dataset's latest commit: {dict(oc_)}; "
  f"licence file found at the same commit for {lic_found}/{len(g['sample'])}, classified by text heuristics "
  "(`classify_license_text`), else `unknown`.")
w("- Redistributability policy (applies to GitHub Actions and GitLab CI): normalised graph with short summaries committed only "
  "for permissive licences (MIT, Apache-2.0, BSD-*, ISC, MPL-2.0, Unlicense, CC0, CC-BY-4.0, ...). Copyleft (GPL/LGPL/AGPL/EPL/EUPL), "
  "source-available (BUSL, Elastic) and unknown licences: `redistributable:false`, title replaced by the URL-derived id, description "
  "empty, node summaries reduced to node types (graph features only).")
w("- Converted licences (all 623 GHA candidates incl. mirrors): " + ", ".join(f"{a} {b}" for a, b in S["platforms"]["github-actions"]["licenses_converted"]))
w("")
w("### E. GitLab REST API v4 (gitlab.com, gitlab.freedesktop.org, gitlab.gnome.org, invent.kde.org, salsa.debian.org)")
w("")
w("Per project: `projects/:id?license=true` (licensee detection), default-branch commit, `.gitlab-ci.yml` (or `ci_config_path`) "
  "and recursive `include: local` files (globs resolved with the tree API). `include: template` resolved against GitLab's own "
  "templates fetched in the same run; `include: project|component|remote` recorded as connectors, not expanded. "
  "GitLab CI templates: `gitlab-org/gitlab` `lib/gitlab/ci/templates/**/*.yml` (MIT; the repository is MIT except `ee/`).")
w("")
w(row("instance/project", "commit", "CI files", "API licence -> recorded", "outcome", "redistributable"))
w(row(*["---"] * 6))
gl_items = {i["id"].split(":", 1)[1]: i for i in ITEMS if i["source"]["platform"] == "gitlab-ci"}
cand_gl = {i["id"].split(":", 1)[1]: i for i in j(f"{WORK}/gitlab-candidates.json")["items"]}
err_gl = {e["file"]: e["error"] for e in j(f"{WORK}/gitlab-candidates.json")["errors"]}
for mp in sorted(glob.glob("/opt/corpus/gitlab-ci/*.manifest.json")):
    v = j(mp)
    if os.path.basename(mp).startswith("templates__"):
        n_ok = len([f for f in v["files"] if f.get("sha256")])
        sel = len([k for k in gl_items if "/lib/gitlab/ci/templates/" in k])
        conv = len([k for k in cand_gl if "/lib/gitlab/ci/templates/" in k])
        w(row("gitlab.com/gitlab-org/gitlab lib/gitlab/ci/templates", v["sha"], n_ok, "mit -> MIT",
              f"acquired; {conv} converted, {sel} selected", "yes"))
        continue
    key = f"{v['instance']}/{v['path']}"
    lk = (v.get("license") or {}).get("key") if v.get("license") else None
    it = cand_gl.get(key)
    outcome = "acquired; " + ("selected" if key in gl_items else ("converted" if it else f"not converted: {err_gl.get(key, '?')}"))
    rec = it["source"]["license"] if it else "-"
    w(row(key, v.get("sha", "-"), len([f for f in v.get("files", []) if f.get("sha256")]), f"{lk} -> {rec}", outcome,
          ("yes" if it and it["source"]["redistributable"] else "no (features only)") if it else "-"))
w("")
w("### F. Blocked, unavailable or rejected sources")
w("")
w(row("source", "date", "outcome", "note"))
w(row(*["---"] * 4))
for r in [
    ("github.com, api.github.com, codeload.github.com", "2026-10-06", "blocked (egress proxy 403)", "replaced by proxy.golang.org zips, Sourcegraph/SWH listings + raw.githubusercontent.com"),
    ("sourcegraph.com code search (GraphQL `search`)", "2026-10-06", "blocked (HTTP 403 for anonymous search)", "could not discover Prefect/Dagster/Temporal flows across arbitrary public repos; repository tree listing still works"),
    ("Sourcegraph listing: PrefectHQ/prefect-recipes, gitlab-org/gitlab (as github.com/...)", "2026-10-06", "not found (not indexed)", "prefect-recipes via Software Heritage instead; gitlab-org/gitlab via GitLab API"),
    ("Software Heritage: temporalio/samples-python", "2026-10-06", "not found (origin not archived)", "Sourcegraph listing used"),
    ("data.jsdelivr.com gh listings (dagster, prefect)", "2026-10-06", "blocked (403: package > 50 MB limit)", "Sourcegraph listing used"),
    ("Zenodo GHA histories workflows.tar.gz (1.44 GB) + auxiliaries", "2026-10-06", "not downloaded (by choice)", "index CSV + per-file raw fetch keeps raw storage < 400 MB"),
    ("Hugging Face datasets search (github-actions, airflow dags, ci workflows)", "2026-10-06", "not found / unsuitable", "HajerMH/github_actions (action centrality metadata, no licence), pranavjrat/top-github-actions (GPL-3.0 CSV of action names): no workflow files"),
    ("gitee.com", "2026-10-06", "blocked (connection reset)", "not needed"),
    ("data.softwareheritage.org", "2026-10-06", "blocked (CONNECT 502)", "archive.softwareheritage.org API works"),
    ("raw.githubusercontent.com (3 sampled GHA files)", "2026-10-06", "not found (404 at recorded commit)", "listed as fetch failures"),
    ("gitlab.com mayan-edms/mayan-edms, nsnam/ns-3-dev; invent.kde.org network/neochat", "2026-10-06", "acquired, not convertible", "pipeline defined in project/remote includes that were not expanded"),
    ("Kubeflow samples/ (Python DSL) and Argo Events / WorkflowEventBinding manifests", "2026-10-06", "acquired, not converted", "compiled IR used for KFP; event bindings are not workflows"),
    ("Temporal samples-java/-typescript/-dotnet, Prefect community flows, Dagster docs_snippets", "2026-10-06", "not attempted / out of budget", "Python+Go Temporal samples and official Prefect/Dagster sources only"),
]:
    w(row(*r))
w("")
w("## Graph modelling and feature definitions")
w("")
w("- **Airflow**: operators/TaskFlow calls -> nodes; `>>`/`<<`/`chain`/`chain_linear`/`cross_downstream`/`set_*stream` -> control edges; "
  "XComArg/`.output`/TaskFlow arguments/`xcom_pull` in templates -> data edges; TaskGroups expanded to member roots/leaves; "
  "`.expand`/`.partial().expand()` -> loops (map); sensors -> wait (poll, or event when deferrable); HITL operators -> human; "
  "Branch*/ShortCircuit/LatestOnly -> condition; one_failed/all_failed trigger rules -> error edges; teardown -> error-handler; "
  "schedule/asset schedules -> one trigger node. Parse-time Python loops are counted once per creation site (noted per item).")
w("- **Argo**: templates inlined from the entrypoint; steps groups = parallel fan-out/fan-in; DAG `dependencies`/`depends` "
  "(Failed/Errored -> error edges); withItems/withParam/withSequence -> map; recursion -> loop node + loop edge; suspend -> human "
  "(no duration) or wait; templateRef/workflowTemplateRef -> subworkflow; onExit/lifecycle hooks -> error-handler; CronWorkflow -> trigger.")
w("- **Kubeflow** (compiled PipelineSpec): condition/for-loop/exit-handler/nested-pipeline groups inlined; triggerPolicy.condition -> guard; "
  "parameterIterator/artifactIterator -> map; ALL_UPSTREAM_TASKS_COMPLETED -> error-handler; taskOutput producers -> data edges.")
w("- **Tekton**: pipeline tasks; runAfter -> control, `$(tasks.X.results...)` -> data; when -> guard; matrix -> map; finally -> error-handler "
  "with error edges from the leaves; custom tasks/resolvers -> connectors; pipelines-in-pipelines -> subworkflow.")
w("- **GitHub Actions**: one node per `on:` event (schedule -> schedule; repository_dispatch/workflow_run/workflow_call -> event; "
  "others -> webhook); one node per step, chained within a job; job `needs` -> edges (data if `needs.X.outputs` read); `if:` guards; "
  "`failure()/always()/cancelled()` guards -> error-handler + error edges; matrix -> map; job-level `uses:` -> subworkflow.")
w("- **GitLab CI**: jobs -> nodes; stage order as `stage:a->b` merge (barrier) nodes unless `needs` is declared; `when: manual` -> human; "
  "`when: delayed` -> wait; `when: on_failure` -> error-handler; `trigger:` -> subworkflow; `parallel` -> map; rules/only/except -> guard; "
  "pipeline sources referenced in rules -> trigger node (default push).")
w("- **Dagster** (one item per example project): assets (params, `deps`, `ins`) -> data/control edges; multi/graph assets; integration "
  "asset factories (dbt, dlt, sling, airbyte...) -> connectors; asset checks -> read nodes; op jobs with `.map/.collect`; schedules/sensors -> triggers; "
  "run-failure sensors -> error-handler.")
w("- **Prefect** (one item per file or docs page): the richest top-level `@flow`; direct task calls chained in order; `.submit/.map` concurrent "
  "(map counted as loop); if/for/while/try -> guard/loop+loop edge/error-handler; subflows and `run_deployment` -> subworkflow; "
  "`pause_flow_run`/`suspend_flow_run`/`wait_for_input`/`receive_input` -> human; `.serve/.deploy(cron|interval|triggers)` -> trigger.")
w("- **Temporal** (one item per sample, or per file for multi-workflow dirs such as `hello/`): Python `@workflow.run` bodies walked "
  "(activities, child workflows, timers, `wait_condition`, continue-as-new, gather fan-out, except-path compensation); signals/updates -> events; "
  "approval-like waits -> human. Go samples: brace-aware regex scan (approximate; `if err != nil` not counted as a guard).")
w("- Feature definitions are in the docstring of `scripts/orchestration-common.py`. `effects` comes from verb heuristics on node type names "
  "(get/list -> read, create/delete/upload -> write, run/submit/send/deploy -> external) and from script text for shell/code nodes; it is an estimate.")
w("- IR verdicts compare against the Phase 1 IR (task, assert, human, map, loop, wait, agent, code, verify; `when` guards; retry; "
  "onError stop|continue; all_success/all_resolved joins). Triggers, signals/events, error branches/finally, sub-workflow calls and "
  "setup/teardown scoping are reported as `via-extension:*`. No item was judged `unsupported`; that is a limitation of a static "
  "check, not a claim of executability.")
w("")
w("## Most complex / interesting selected items")
w("")
w(row("id", "nodes", "edges", "why it is interesting"))
w(row("---", "---", "---", "---"))
byid = {i["id"]: i for i in ITEMS}


def why(i):
    f = i["features"]
    bits = []
    if f["humanSteps"]:
        bits.append(f"{f['humanSteps']} human steps")
    if f["hasModelCalls"]:
        bits.append("model calls")
    if f["loops"]:
        bits.append(f"{f['loops']} loops/maps")
    if f["branching"]:
        bits.append(f"{f['branching']} guards/branches")
    if f["subworkflows"]:
        bits.append(f"{f['subworkflows']} sub-workflows")
    if any(e["kind"] == "error" for e in i["graph"]["edges"]):
        bits.append("error paths")
    if f["async"]:
        bits.append("async " + "/".join(f["async"]))
    if f["connectors"]:
        bits.append(f"{len(f['connectors'])} connectors")
    return ", ".join(bits)


picks = [t[0] for t in S["top_complex"][:12]]
for key in ["hitl_operator", "llm_survey_agentic", "langchain_tool_agent", "aip_progress_tracker#example_aip_progress_tracker", "example_sagemaker#",
            "Auto-DevOps", "argo:dag-coinflip", "argo:exit-handlers", "intermediate-parameters", "if_elif_else_complex",
            "pipelinerun-with-when-expressions", "ai-analyzer", "nexus-messaging", "langfuse_tracing", "project_ml", "interactive.mdx"]:
    for i in ITEMS:
        if key in i["id"] and i["id"] not in picks:
            picks.append(i["id"]); break
for pid in picks:
    i = byid.get(pid)
    if i:
        w(row(pid, i["features"]["nodeCount"], i["features"]["edgeCount"], why(i)))
w("")
w("## Honest limits")
w("")
w("- All graphs are **static extractions**; none was executed. Dynamic structure decided at run time (Airflow parse-time loops, "
  "GitLab `rules:changes`, GHA dynamic matrices, Dagster factories, Prefect/Temporal control flow through helper functions) is approximated.")
w("- Prefect coverage is thin: official sources hold few flows (9 examples, 34 recipe files, docs snippets), 42 files had flows whose tasks "
  "live in other modules or that call plain functions, and cross-repository discovery needs Sourcegraph search (blocked).")
w("- Temporal Go extraction is regex-based; Temporal Python misses agent/plugin-mediated activities (e.g. strands/openai-agents plugins), "
  "so some AI samples have very small graphs.")
w("- GitLab CI: external `project`/`component`/`remote` includes are not expanded (their jobs are missing); GitLab templates are taken from "
  "gitlab.com's current default branch even for self-hosted instances running other GitLab versions; GitLab-detected licences "
  "`other`/null are recorded as `LicenseRef-gitlab-detected-other`/`unknown` and treated as not redistributable (e.g. mesa, tezos).")
w("- Licence of GHA repositories is classified from the licence file text at the pinned commit by heuristics; 'unknown' means no file or "
  "an unrecognised text. Dual-licensed repositories are recorded by the first recognised licence.")
w("- Effects/category for operators and actions are name heuristics; descriptions are the platform's own text (provenance original) "
  "only where the licence allows; nothing was model-recovered.")
w("- Oracles: `test-profile` marks items whose upstream project runs them in a test suite (Airflow system tests need real cloud "
  "credentials; Argo/Tekton e2e need a cluster; Dagster/Temporal tests run locally with mocks) — none were run here. KFP "
  "`output-equivalence` means a golden compiled IR paired with its DSL source.")
w("- Raw storage for this cluster under /opt/corpus: ~460 MB (github-actions 340 MB of which 311 MB is the Zenodo index CSV).")
open(OUT, "w").write("\n".join(L) + "\n")
print(OUT, len(L), "lines")
