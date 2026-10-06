#!/usr/bin/env python3
"""GitHub Actions workflow YAML -> foundry-corpus-item/1 (parsed as data, never run).

Sources:
  * Zenodo GHA histories sample (orchestration-gha-sample.py; sample.json + raw/ files)
  * .github/workflows of the Go-module mirrors already acquired for this cluster
    (argo-workflows, kubeflow/pipelines, tektoncd/pipeline, temporalio/samples-go), licence known.
Graph model: one trigger node per `on:` event; one node per step (run -> code, uses -> action
named by the action repo); steps of a job are chained; job `needs` link the last step of the
needed job to the first step of the dependent job (data edge if `needs.<job>.outputs` is read);
job-level `uses:` (reusable workflow) is one subworkflow node; `if:` is a guard; `failure()` /
`always()` guards become error-handler nodes with error edges; strategy.matrix is a map.
Usage: <venv python> -I orchestration-gha.py <out.json>
"""
import glob, importlib.util, json, os, re, sys
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("oc", os.path.join(HERE, "orchestration-common.py"))
oc = importlib.util.module_from_spec(spec); spec.loader.exec_module(oc)

ROOT = "/opt/corpus/github-actions"
WEBHOOK_EVENTS = {"push", "pull_request", "pull_request_target", "issues", "issue_comment", "release",
                  "create", "delete", "fork", "watch", "pull_request_review", "pull_request_review_comment",
                  "discussion", "discussion_comment", "label", "milestone", "page_build", "project",
                  "public", "registry_package", "status", "deployment", "deployment_status", "check_run",
                  "check_suite", "gollum", "merge_group", "branch_protection_rule", "project_card", "project_column"}
EVENT_EVENTS = {"workflow_run", "repository_dispatch", "workflow_call"}
MODEL_ACTIONS = re.compile(r"(?i)openai|anthropic|claude|gpt|llm|copilot|gemini|ai-review|coderabbit|ollama|mistral")
HUMAN_ACTIONS = re.compile(r"(?i)manual-approval|wait-for-approval|approval-action|ask-for-approval|github-issue-approval")
EXT_RUN = re.compile(r"(?i)\b(curl|wget)\b.*(-X\s*(POST|PUT|DELETE|PATCH)|--data|-d )|\b(npm|yarn|pnpm) publish|twine upload|"
                     r"docker (push|login)|gh (release|pr|issue|api|workflow)|git push|kubectl (apply|create|delete|rollout|set)|"
                     r"helm (upgrade|install)|terraform (apply|destroy)|aws |gcloud |az |gsutil|cargo publish|"
                     r"mvn deploy|gradle.*publish|fastlane|firebase deploy|vercel|netlify|heroku|scp |rsync |ssh |"
                     r"pip upload|poetry publish|gem push|dotnet nuget push|goreleaser|slack|discord")
WRITE_ACTIONS = re.compile(r"(?i)upload-artifact|cache|create-pull-request|commit|push|release|publish|deploy|"
                           r"pages|gh-pages|docker/build-push|login|labeler|stale|comment|codecov|coveralls|"
                           r"create-release|upload-release|attest|sign|setup-buildx")


def as_list(x):
    if x is None:
        return []
    return x if isinstance(x, list) else [x]


def triggers(on):
    if on is None:
        return []
    if isinstance(on, str):
        return [(on, None)]
    if isinstance(on, list):
        return [(e, None) for e in on]
    if isinstance(on, dict):
        return list(on.items())
    return []


def classify_step(step):
    if "uses" in step:
        u = str(step["uses"])
        name = u.split("@")[0]
        if name.startswith("docker://"):
            return "docker-action", "code", "external", "docker:" + name[9:].split(":")[0]
        if name.startswith("./"):
            return "local-action", "code", "none", None
        conn = "/".join(name.split("/")[:2])
        if HUMAN_ACTIONS.search(name):
            return f"uses:{conn}", "human", "external", conn
        if MODEL_ACTIONS.search(name):
            return f"uses:{conn}", "model", "external", conn
        if name in ("actions/github-script",):
            return f"uses:{conn}", "code", "external", conn
        if re.search(r"(?i)checkout|download|setup-|cache/restore|get-|fetch|paths-filter|changed-files", name):
            eff = "read"
        elif re.search(r"(?i)deploy|publish|release|push|pages|notify|slack|discord|telegram|mail|comment|dispatch|trigger", name):
            eff = "external"
        elif WRITE_ACTIONS.search(name):
            eff = "write"
        else:
            eff = "none" if re.search(r"(?i)lint|test|check|setup|build|format|scan|analy", name) else "external"
        return f"uses:{conn}", "action", eff, conn
    run = str(step.get("run", ""))
    eff = "external" if EXT_RUN.search(run) else "none"
    if re.search(r"(?i)openai|anthropic|api\.openai\.com|claude -p|llm ", run):
        return "run", "model", "external", None
    return "run", "code", eff, None


def failure_guard(cond):
    c = str(cond or "")
    return bool(re.search(r"failure\(\)|cancelled\(\)|always\(\)|!success\(\)|job\.status\s*!=\s*'success'|needs\.[\w-]+\.result\s*(==|!=)\s*'(failure|cancelled|success)'", c))


class Build:
    def __init__(self):
        self.nodes, self.edges = {}, []
        self.guards = self.loops = 0
        self.async_kinds, self.connectors, self.needs, self.notes = [], [], set(), set()

    def add(self, nid, ntype, cat, eff, summary):
        k, i = nid, 1
        while k in self.nodes:
            k = f"{nid}__{i}"; i += 1
        self.nodes[k] = {"id": k, "type": ntype, "category": cat, "effects": eff, "summary": summary}
        return k

    def link(self, a, b, kind="control"):
        for x in a:
            for y in b:
                if x != y:
                    self.edges.append({"from": x, "to": y, "kind": kind})


def convert_doc(doc):
    b = Build()
    on = doc.get("on", doc.get(True))  # YAML 1.1 parses bare `on:` as boolean True
    trig_ids = []
    for ev, cfg in triggers(on):
        ev = str(ev)
        if ev == "schedule":
            crons = [c.get("cron") for c in as_list(cfg) if isinstance(c, dict)]
            trig_ids.append(b.add("on.schedule", "schedule", "trigger", "none", f"cron {', '.join(map(str, crons))}"))
            b.async_kinds.append("schedule")
        elif ev == "workflow_dispatch":
            n_in = len((cfg or {}).get("inputs") or {}) if isinstance(cfg, dict) else 0
            trig_ids.append(b.add("on.workflow_dispatch", "workflow_dispatch", "trigger", "none", f"manual dispatch ({n_in} inputs)"))
        elif ev in EVENT_EVENTS:
            trig_ids.append(b.add(f"on.{ev}", ev, "trigger", "none", f"event {ev}"))
            b.async_kinds.append("event")
        else:
            filt = ""
            if isinstance(cfg, dict):
                filt = " ".join(f"{k}" for k in cfg.keys())
            trig_ids.append(b.add(f"on.{ev}", ev, "trigger", "none", f"webhook {ev} {filt}".strip()))
            b.async_kinds.append("webhook")
    if trig_ids and any(b.nodes[t]["category"] == "trigger" and b.nodes[t]["type"] not in ("workflow_dispatch", "workflow_call") for t in trig_ids):
        b.needs.add("triggers")
    if any(b.nodes[t]["type"] in ("repository_dispatch", "workflow_run") for t in trig_ids):
        b.needs.add("signals")
    if doc.get("concurrency"):
        b.notes.add("concurrency group")
    jobs = doc.get("jobs") or {}
    if not isinstance(jobs, dict):
        return None
    io, job_if = {}, {}
    for jname, job in jobs.items():
        if not isinstance(job, dict):
            continue
        jname = str(jname)
        guard = job.get("if")
        jsum = []
        if guard is not None:
            b.guards += 1
            jsum.append(f"if: {oc.trim(guard, 60)}")
        strat = job.get("strategy") or {}
        if isinstance(strat, dict) and strat.get("matrix") is not None:
            b.loops += 1
            m = strat["matrix"]
            dyn = isinstance(m, str) or (isinstance(m, dict) and any(isinstance(v, str) and "fromJSON" in v for v in m.values()))
            jsum.append("matrix" + (" from runtime data (fromJSON)" if dyn else ""))
            if strat.get("fail-fast") is False:
                jsum.append("fail-fast:false")
        if job.get("environment"):
            jsum.append("environment gate (protection rules may require reviewers)")
            b.notes.add("deployment environments")
        if job.get("continue-on-error"):
            jsum.append("continue-on-error")
        if job.get("services"):
            jsum.append(f"services:{','.join(map(str, (job.get('services') or {}).keys()))}")
        if job.get("timeout-minutes"):
            jsum.append(f"timeout {job['timeout-minutes']}m")
        is_fail = failure_guard(guard)
        job_if[jname] = is_fail
        if "uses" in job:
            u = str(job["uses"])
            k = b.add(jname, "reusable-workflow", "subworkflow", "external", f"calls {u.split('@')[0]} " + "; ".join(jsum))
            b.needs.add("subworkflow-call")
            if not u.startswith("./"):
                b.connectors.append("/".join(u.split("@")[0].split("/")[:2]))
            io[jname] = ([k], [k])
            continue
        steps = [s for s in as_list(job.get("steps")) if isinstance(s, dict)]
        prev, first = [], None
        for i, st in enumerate(steps):
            typ, cat, eff, conn = classify_step(st)
            if conn:
                b.connectors.append(conn)
            sid = st.get("id") or f"s{i + 1}"
            label = st.get("name") or (st.get("uses") if "uses" in st else (str(st.get("run", "")).strip().splitlines() or [""])[0])
            ssum = [oc.trim(label, 90)]
            if st.get("if") is not None:
                b.guards += 1
                ssum.append(f"if: {oc.trim(st['if'], 50)}")
                if failure_guard(st["if"]):
                    cat = "error-handler"
            if st.get("continue-on-error"):
                ssum.append("continue-on-error")
            k = b.add(f"{jname}.{sid}", typ, cat, eff, " | ".join(ssum))
            if prev:
                kind = "error" if cat == "error-handler" else "control"
                b.link(prev, [k], kind)
            else:
                first = [k]
            prev = [k]
            if cat == "error-handler":
                b.needs.add("error-branches")
        if not steps:
            k = b.add(jname, "job", "other", "none", "; ".join(jsum) or "job without steps")
            first, prev = [k], [k]
        if jsum and first:
            b.nodes[first[0]]["summary"] = oc.trim("[job " + "; ".join(jsum) + "] " + b.nodes[first[0]]["summary"])
        if is_fail:
            for nid in (first or []):
                b.nodes[nid]["category"] = "error-handler"
            b.needs.add("error-branches")
        io[jname] = (first or [], prev or [])
    roots = []
    for jname, job in jobs.items():
        jname = str(jname)
        if jname not in io:
            continue
        needs = [str(n) for n in as_list(job.get("needs"))]
        txt = json.dumps(job, default=str)
        for nname in needs:
            if nname not in io:
                continue
            kind = "data" if re.search(r"needs\.%s\.outputs" % re.escape(nname), txt) else "control"
            if job_if.get(jname):
                kind = "error"
            b.link(io[nname][1], io[jname][0], kind)
        if not [n for n in needs if n in io]:
            roots += io[jname][0]
    b.link(trig_ids, roots, "control")
    if any(n["category"] == "human" for n in b.nodes.values()):
        b.async_kinds.append("wait")
    return b


def item_from(path, doc, *, platform, sid, url, revision, retrieved, lic, lic_ev, redis, extra_note="", oracle=None):
    b = convert_doc(doc)
    if b is None or not b.nodes:
        return None
    nodes = list(b.nodes.values())
    edges = oc.dedupe_edges(b.edges)
    name = str(doc.get("name") or os.path.basename(path))
    text = " ".join([name, path, " ".join(b.connectors)])
    features = oc.compute_features(nodes, edges, guards=b.guards, loops=b.loops, async_kinds=b.async_kinds,
                                   connectors=b.connectors, domains=oc.domains_for(text, ["ci-cd"]))
    ir = oc.ir_verdict(features, needs=sorted(b.needs),
                       notes=f"Steps as nodes, jobs chained by needs; other: {', '.join(sorted(b.notes)) or 'none'}. {extra_note}")
    return oc.make_item(platform=platform, sid=sid, url=url, revision=revision, retrieved=retrieved,
                        license=lic, license_evidence=lic_ev, redistributable=redis, raw_path=path,
                        title=f"{name}", description="", desc_provenance="written", nodes=nodes, edges=edges,
                        features=features, ir=ir,
                        oracle=oracle or {"kind": "none", "notes": "Real CI workflow; success oracle is the repository's own CI run status (not reproducible offline)."})


def load_yaml(path):
    docs = [d for d in yaml.safe_load_all(open(path, encoding="utf-8", errors="replace")) if isinstance(d, dict)]
    return docs[0] if docs else None


def main():
    out = sys.argv[1]
    items, errors = [], []
    # 1. Zenodo sample
    s = json.load(open(f"{ROOT}/sample.json"))
    for it in s["sample"]:
        if it.get("outcome") != "acquired":
            errors.append({"file": f"{it['repo']}/{it['path']}", "error": f"fetch {it.get('outcome')}"}); continue
        try:
            doc = load_yaml(it["rawPath"])
            lic_txt = open(it["license"]["path"], encoding="utf-8", errors="replace").read() if it.get("license") else ""
            spdx = oc.classify_license_text(lic_txt) if lic_txt else "unknown"
            lic_ev = (f"https://raw.githubusercontent.com/{it['repo']}/{it['commit']}/{it['license']['file']} (text-classified)"
                      if it.get("license") else "no licence file found at commit (LICENSE*, COPYING*)")
            redis = oc.redistributable_license(spdx)
            it2 = item_from(it["rawPath"], doc or {}, platform="github-actions",
                            sid=f"{it['repo']}/{it['path']}",
                            url=f"https://github.com/{it['repo']}/blob/{it['commit']}/{it['path']}",
                            revision=f"{it['commit']} (versions in dataset: {it['versions']}; Zenodo 10.5281/zenodo.20340547 pool {it['pool']})",
                            retrieved="2026-10-06", lic=spdx, lic_ev=lic_ev, redis=redis,
                            extra_note=f"Sampled from MSR'24 GHA histories dataset (CC-BY-4.0 compilation), pool {it['pool']}.")
            if it2 is None:
                errors.append({"file": f"{it['repo']}/{it['path']}", "error": "no jobs"}); continue
            it2["_pool"] = it["pool"]
            items.append(it2)
        except Exception as e:
            errors.append({"file": f"{it['repo']}/{it['path']}", "error": f"{type(e).__name__}: {e}"})
    # 2. Go-module mirrors with known Apache-2.0/MIT licence
    mirrors = [
        ("/opt/corpus/argo", "argoproj/argo-workflows", "Apache-2.0"),
        ("/opt/corpus/kubeflow", "kubeflow/pipelines", "Apache-2.0"),
        ("/opt/corpus/tekton", "tektoncd/pipeline", "Apache-2.0"),
        ("/opt/corpus/temporal", "temporalio/samples-go", "MIT"),
    ]
    for base, repo, lic in mirrors:
        man = json.load(open(glob.glob(f"{base}/*.manifest.json")[0])) if glob.glob(f"{base}/*.manifest.json") else None
        if base.endswith("temporal"):
            man = json.load(open(glob.glob(f"{base}/github.com_temporalio*.manifest.json")[0]))
        sha = man["info"]["Origin"]["Hash"]
        for p in sorted(glob.glob(f"{base}/extracted/**/.github/workflows/*.y*ml", recursive=True)):
            rel = ".github/workflows/" + os.path.basename(p)
            try:
                doc = load_yaml(p)
                it2 = item_from(p, doc or {}, platform="github-actions", sid=f"{repo}/{rel}",
                                url=f"https://github.com/{repo}/blob/{sha}/{rel}",
                                revision=f"{sha} (Go module {man['version']}, zip sha256:{man['sha256']})",
                                retrieved=man["retrievedAt"], lic=lic,
                                lic_ev=f"LICENSE at module root of {repo} (proxy.golang.org zip)", redis=True,
                                extra_note="From Go module proxy mirror of an orchestration project's own CI.")
                if it2:
                    it2["_pool"] = "M"
                    items.append(it2)
            except Exception as e:
                errors.append({"file": f"{repo}/{rel}", "error": f"{type(e).__name__}: {e}"})
    json.dump({"items": items, "errors": errors, "files": len(s['sample'])}, open(out, "w"))
    print(f"gha: items={len(items)} errors={len(errors)}")


if __name__ == "__main__":
    main()
