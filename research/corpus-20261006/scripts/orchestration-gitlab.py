#!/usr/bin/env python3
"""GitLab CI pipelines -> foundry-corpus-item/1 (YAML parsed as data; nothing is run).

Inputs: /opt/corpus/gitlab-ci/<instance>__<project>@<sha>/ (orchestration-fetch-gitlab.py),
        /opt/corpus/gitlab-ci/templates__gitlab-org__gitlab@<sha>/lib/gitlab/ci/templates/**.yml
Semantics modelled: main config + `include: local` files merged (later keys override);
`extends` resolved by deep merge; hidden (.x) jobs and reserved keywords are not jobs; stage
order is a barrier (a `stage:<name>` merge node joins one stage to the next) unless a job declares
`needs` (DAG edges, data when artifacts are consumed); `when: manual` (job or any rule) is a human
step; `when: delayed` a timer; `when: on_failure` an error-handler reached by error edges;
`trigger:` (child / multi-project pipeline) a subworkflow; `parallel: matrix|N` a map; any
rules/only/except is a guard. `include: template|project|component|remote` are recorded as
connectors (not expanded; contents unavailable offline or out of scope).
Usage: <venv python> -I orchestration-gitlab.py <out.json>
"""
import copy, glob, importlib.util, json, os, re, sys
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("oc", os.path.join(HERE, "orchestration-common.py"))
oc = importlib.util.module_from_spec(spec); spec.loader.exec_module(oc)

ROOT = "/opt/corpus/gitlab-ci"
RESERVED = {"image", "services", "stages", "types", "before_script", "after_script", "variables", "cache",
            "include", "default", "workflow", "spec"}
EXT_SCRIPT = re.compile(r"(?i)\b(curl|wget)\b.*(-X\s*(POST|PUT|DELETE)|--data|-d |--upload-file|-T )|docker push|"
                        r"(npm|yarn|pnpm) publish|twine upload|gem push|cargo publish|kubectl (apply|create|delete|rollout)|"
                        r"helm (upgrade|install)|terraform (apply|destroy)|aws |gcloud |az |gsutil|release-cli|glab |"
                        r"git push|scp |rsync |ssh |ansible-playbook|deploy|upload|publish|s3 cp|crane push|skopeo copy|"
                        r"buildah push|podman push|kaniko|ci-fairy|lava|curl .*api/v4")


class L(yaml.SafeLoader):
    pass


def _tag(loader, suffix, node):
    if isinstance(node, yaml.SequenceNode):
        return {"!" + suffix: loader.construct_sequence(node, deep=True)}
    if isinstance(node, yaml.MappingNode):
        return {"!" + suffix: loader.construct_mapping(node, deep=True)}
    return {"!" + suffix: loader.construct_scalar(node)}


L.add_multi_constructor("!", _tag)


def load_all(path):
    try:
        return [d for d in yaml.load_all(open(path, encoding="utf-8", errors="replace"), Loader=L) if isinstance(d, dict)]
    except Exception:
        return []


def deep_merge(a, b):
    if isinstance(a, dict) and isinstance(b, dict):
        out = dict(a)
        for k, v in b.items():
            out[k] = deep_merge(a.get(k), v) if k in a else v
        return out
    return copy.deepcopy(b)


def as_list(x):
    return [] if x is None else (x if isinstance(x, list) else [x])


TPL_BASE = (glob.glob(f"{ROOT}/templates__gitlab-org__gitlab@*/") or [""])[0]


def merged_config(base, main_rel):
    """Merge main config with local includes; `include: template:` is resolved against GitLab's
    own template directory acquired in the same run (records which templates were inlined)."""
    conf, ext_includes, seen = {}, [], set()

    def visit(rel, depth, root=None):
        root = root or base
        if (root, rel) in seen or depth > 6:
            return
        seen.add((root, rel))
        p = os.path.join(root, rel)
        if not os.path.exists(p):
            return
        docs = load_all(p)
        for doc in docs:
            if "spec" in doc and len(doc) == 1:
                continue  # component/include input spec header
            incs = doc.get("include")
            for inc in as_list(incs):
                if isinstance(inc, str):
                    if inc.startswith("http"):
                        ext_includes.append("remote")
                    else:
                        for g in sorted(glob.glob(os.path.join(root, inc.lstrip("/")), recursive=True)):
                            visit(os.path.relpath(g, root), depth + 1, root)
                elif isinstance(inc, dict):
                    if "local" in inc:
                        for g in sorted(glob.glob(os.path.join(root, str(inc["local"]).lstrip("/")), recursive=True)):
                            visit(os.path.relpath(g, root), depth + 1, root)
                    elif "template" in inc:
                        ext_includes.append("gitlab-template:" + str(inc["template"]).replace(".gitlab-ci.yml", ""))
                        tp = os.path.join("lib/gitlab/ci/templates", str(inc["template"]))
                        if TPL_BASE and os.path.exists(os.path.join(TPL_BASE, tp)):
                            ext_includes.append("inlined-template")
                            visit(tp, depth + 1, TPL_BASE)
                    elif "project" in inc:
                        ext_includes.append("project:" + str(inc["project"]))
                    elif "component" in inc:
                        ext_includes.append("component:" + re.sub(r"@.*$", "", str(inc["component"])).split("/", 1)[-1])
                    elif "remote" in inc:
                        ext_includes.append("remote")
            body = {k: v for k, v in doc.items() if k != "include"}
            nonlocal conf
            conf = deep_merge(conf, body)

    visit(main_rel, 0)
    return conf, ext_includes


def resolve_extends(conf, name, stack=()):
    job = conf.get(name)
    if not isinstance(job, dict):
        return {}
    ext = as_list(job.get("extends"))
    if not ext or name in stack:
        return job
    merged = {}
    for e in ext:
        if isinstance(e, str) and e in conf:
            merged = deep_merge(merged, resolve_extends(conf, e, stack + (name,)))
    return deep_merge(merged, {k: v for k, v in job.items() if k != "extends"})


def convert(conf, ext_includes):
    stages = [s for s in as_list(conf.get("stages") or conf.get("types")) if isinstance(s, str)] or ["build", "test", "deploy"]
    stages = [".pre"] + [s for s in stages if s not in (".pre", ".post")] + [".post"]
    jobs = {}
    for k, v in conf.items():
        if not isinstance(k, str) or k in RESERVED or k.startswith(".") or not isinstance(v, dict):
            continue
        j = resolve_extends(conf, k)
        if not any(x in j for x in ("script", "trigger", "run", "extends", "stage", "needs", "image")) and k != "pages":
            continue
        jobs[k] = j
    nodes, edges = {}, []
    guards = loops = 0
    async_kinds, connectors, needs_ext, notes = [], [c for c in ext_includes if c != "inlined-template"], set(), set()
    if "inlined-template" in ext_includes:
        notes.add(f"{ext_includes.count('inlined-template')} include:template file(s) inlined from gitlab-org/gitlab templates")
    wf = conf.get("workflow") or {}
    if isinstance(wf, dict) and wf.get("rules"):
        guards += 1
        notes.add("workflow:rules (pipeline-level guard)")
    for name, j in jobs.items():
        stage = j.get("stage", "test")
        if not isinstance(stage, str):
            stage = "ref:" + oc.trim(json.dumps(stage, default=str), 40)
        when = j.get("when", "on_success")
        if not isinstance(when, str):
            when = "on_success"
        rules = j.get("rules")
        rule_whens = [r.get("when") for r in as_list(rules) if isinstance(r, dict)]
        bits = [f"stage={stage}"]
        if rules or j.get("only") or j.get("except"):
            guards += 1
            bits.append("rules" if rules else "only/except")
        cat, eff = "code", "none"
        script = " ".join(str(x) for x in as_list(j.get("script")) + as_list(j.get("before_script")))
        if EXT_SCRIPT.search(script) or j.get("environment") or j.get("release"):
            eff = "external"
        if j.get("trigger"):
            tr = j["trigger"]
            cat, eff = "subworkflow", "external"
            needs_ext.add("subworkflow-call")
            if isinstance(tr, dict) and tr.get("project"):
                bits.append(f"multi-project trigger {tr['project']}")
                connectors.append("project:" + str(tr["project"]))
            else:
                bits.append("child pipeline")
            if isinstance(tr, dict) and tr.get("strategy") == "depend":
                bits.append("strategy:depend")
        if when == "manual" or "manual" in rule_whens:
            cat = "human"
            async_kinds.append("wait")
            bits.append("when:manual" + (" (some rules)" if when != "manual" else ""))
        elif when == "delayed" or "delayed" in rule_whens:
            cat = "wait"
            async_kinds.append("wait")
            bits.append(f"when:delayed start_in={j.get('start_in', '?')}")
        if when == "on_failure" or "on_failure" in rule_whens:
            cat = "error-handler"
            needs_ext.add("error-branches")
            bits.append("when:on_failure")
        if when == "always":
            bits.append("when:always")
        par = j.get("parallel")
        if par is not None:
            loops += 1
            bits.append("parallel:matrix" if isinstance(par, dict) else f"parallel:{par}")
        if j.get("environment"):
            env = j["environment"]
            ename = env.get("name") if isinstance(env, dict) else env
            bits.append(f"environment={oc.trim(ename, 30)}")
            if isinstance(env, dict) and env.get("action") == "stop":
                bits.append("stop env")
        if j.get("retry"):
            bits.append("retry")
        if j.get("allow_failure"):
            bits.append("allow_failure")
        if j.get("resource_group"):
            bits.append("resource_group")
            notes.add("resource_group (mutex)")
        if j.get("interruptible"):
            notes.add("interruptible")
        for s in as_list(j.get("services")):
            sname = s.get("name") if isinstance(s, dict) else s
            if isinstance(sname, str):
                connectors.append("service:" + re.sub(r"[:@].*$", "", sname.split("/")[-1]))
        if re.search(r"(?i)openai|anthropic|\bllm\b|duo-workflow|claude", script):
            cat = "model" if cat == "code" else cat
        if j.get("pages") or name == "pages":
            connectors.append("gitlab-pages")
            eff = "external"
        nodes[name] = {"id": name, "type": "trigger-job" if j.get("trigger") else "job", "category": cat,
                       "effects": eff, "summary": "; ".join(bits), "_stage": stage, "_needs": j.get("needs"),
                       "_deps": j.get("dependencies"), "_when": when}
    # stage barriers
    used_stages = [s for s in stages if any(n["_stage"] == s for n in nodes.values())]
    for s in [n["_stage"] for n in nodes.values()]:
        if s not in used_stages:
            used_stages.append(s)  # undeclared stage: append (GitLab would reject; keep the job)
    barrier = {}
    for i, s in enumerate(used_stages[:-1]):
        nxt = used_stages[i + 1]
        if any(n["_needs"] is None and n["_stage"] == nxt for n in nodes.values()):
            bid = f"stage:{s}->{nxt}"
            barrier[s] = bid
    out_nodes = []
    for s in used_stages:
        for n in nodes.values():
            if n["_stage"] == s:
                out_nodes.append(n)
        if s in barrier:
            out_nodes.append({"id": barrier[s], "type": "stage-barrier", "category": "merge", "effects": "none",
                              "summary": f"stage {s} completes before {used_stages[used_stages.index(s) + 1]}"})
    for i, s in enumerate(used_stages):
        prev_bar = barrier.get(used_stages[i - 1]) if i > 0 else None
        for n in nodes.values():
            if n["_stage"] != s:
                continue
            kind_fail = n["_when"] == "on_failure"
            if n["_needs"] is None:
                if prev_bar:
                    edges.append({"from": prev_bar, "to": n["id"], "kind": "error" if kind_fail else "control"})
            else:
                for nd in as_list(n["_needs"]):
                    src = nd.get("job") if isinstance(nd, dict) else nd
                    if isinstance(nd, dict) and (nd.get("pipeline") or nd.get("project")):
                        connectors.append("cross-pipeline-artifacts")
                        continue
                    if src in nodes:
                        art = not (isinstance(nd, dict) and nd.get("artifacts") is False)
                        edges.append({"from": src, "to": n["id"], "kind": "error" if kind_fail else ("data" if art and nodes[src].get("_deps", None) is None else "control")})
            if s in barrier:
                edges.append({"from": n["id"], "to": barrier[s], "kind": "control"})
            for dsrc in as_list(n.get("_deps")):
                if dsrc in nodes:
                    edges.append({"from": dsrc, "to": n["id"], "kind": "data"})
    for n in out_nodes:
        for k in ("_stage", "_needs", "_deps", "_when"):
            n.pop(k, None)
    if isinstance(wf, dict) and wf.get("rules"):
        pass
    # pipeline sources (push / MR / schedule / api / trigger) are implicit in GitLab; record via rules text
    txt = json.dumps(conf, default=str)
    trig_types = []
    for src, kind in (("schedule", "schedule"), ("merge_request_event", "webhook"), ("push", "webhook"),
                      ("trigger", "event"), ("pipeline", "event"), ("api", "event"), ("web", None), ("parent_pipeline", "event")):
        if re.search(r'CI_PIPELINE_SOURCE\s*[=!]=~?\s*[\'"/]?%s' % src, txt):
            trig_types.append(src)
            if kind:
                async_kinds.append(kind)
    if not trig_types:
        trig_types = ["push"]
        async_kinds.append("webhook")
    trig = {"id": "__trigger__", "type": "pipeline-source", "category": "trigger", "effects": "none",
            "summary": "pipeline sources referenced: " + ",".join(trig_types)}
    roots = [n["id"] for n in out_nodes if not any(e["to"] == n["id"] for e in edges)]
    edges = [{"from": "__trigger__", "to": r, "kind": "control"} for r in roots] + edges
    out_nodes.insert(0, trig)
    needs_ext.add("triggers")
    if "event" in async_kinds:
        needs_ext.add("signals")
    return out_nodes, oc.dedupe_edges(edges), guards, loops, async_kinds, connectors, needs_ext, notes, len(jobs)


LIC_MAP = {"mit": "MIT", "apache-2.0": "Apache-2.0", "bsd-3-clause": "BSD-3-Clause", "bsd-2-clause": "BSD-2-Clause",
           "mpl-2.0": "MPL-2.0", "gpl-2.0": "GPL-2.0-only", "gpl-2.0+": "GPL-2.0-or-later", "gpl-3.0": "GPL-3.0-only",
           "gpl-3.0+": "GPL-3.0-or-later", "lgpl-2.1": "LGPL-2.1", "lgpl-2.0": "LGPL-2.0", "agpl-3.0": "AGPL-3.0",
           "epl-2.0": "EPL-2.0", "eupl-1.2": "EUPL-1.2", "bsd-3-clause-clear": "BSD-3-Clause-Clear", "isc": "ISC",
           "sgi-b-1.1": "SGI-B-1.1", "unlicense": "Unlicense", "cc0-1.0": "CC0-1.0"}


def main():
    out = sys.argv[1]
    items, errors = [], []
    for mp in sorted(glob.glob(f"{ROOT}/*.manifest.json")):
        man = json.load(open(mp))
        base = man["dir"]
        if os.path.basename(base).startswith("templates__"):
            lic, ev = "MIT", f"https://gitlab.com/gitlab-org/gitlab/-/blob/{man['sha']}/LICENSE (lib/ outside ee/ is MIT Expat)"
            files = [f["path"] for f in man["files"] if f.get("sha256") and "/templates/" in f["path"]]
            for rel in files:
                try:
                    conf, ext = merged_config(base, rel)
                    res = convert(conf, ext)
                    nodes, edges, guards, loops, asy, conns, needs, notes, njobs = res
                    if njobs == 0:
                        errors.append({"file": rel, "error": "no jobs (include-only template)"}); continue
                    items.append(build(man, rel, nodes, edges, guards, loops, asy, conns, needs, notes, lic, ev, True,
                                       title=os.path.basename(rel).replace(".gitlab-ci.yml", "") + " (GitLab CI template)",
                                       sid=f"gitlab-org/gitlab/{rel}", url=f"https://gitlab.com/gitlab-org/gitlab/-/blob/{man['sha']}/{rel}",
                                       raw=os.path.join(base, rel), kind="template"))
                except Exception as e:
                    errors.append({"file": rel, "error": f"{type(e).__name__}: {e}"})
            continue
        if man.get("outcome") != "acquired":
            continue
        key = (man.get("license") or {}).get("key") if man.get("license") else None
        lic = LIC_MAP.get(key or "", "unknown" if not key else f"LicenseRef-gitlab-detected-{key}")
        ev = f"GitLab API projects/{man['id']}?license=true on {man['instance']} (licensee detection: {key}); {man.get('license_url') or ''}"
        try:
            conf, ext = merged_config(base, man["ci_config_path"])
            nodes, edges, guards, loops, asy, conns, needs, notes, njobs = convert(conf, ext)
            if njobs == 0:
                errors.append({"file": f"{man['instance']}/{man['path']}", "error": "no jobs after merging local includes (config lives in remote/project includes)"}); continue
            nfiles = len([f for f in man["files"] if f.get("sha256")])
            items.append(build(man, man["ci_config_path"], nodes, edges, guards, loops, asy, conns, needs, notes, lic, ev,
                               oc.redistributable_license(lic), title=f"{man['path']} pipeline ({nfiles} CI file(s))",
                               sid=f"{man['instance']}/{man['path']}", url=f"{man['web_url']}/-/blob/{man['sha']}/{man['ci_config_path']}",
                               raw=os.path.join(base, man["ci_config_path"]), kind="project"))
        except Exception as e:
            errors.append({"file": f"{man['instance']}/{man['path']}", "error": f"{type(e).__name__}: {e}"})
    json.dump({"items": items, "errors": errors, "files": len(items) + len(errors)}, open(out, "w"))
    print(f"gitlab: items={len(items)} errors={len(errors)}")


def build(man, rel, nodes, edges, guards, loops, asy, conns, needs, notes, lic, ev, redis, *, title, sid, url, raw, kind):
    text = " ".join([sid, title, " ".join(conns)])
    features = oc.compute_features(nodes, edges, guards=guards, loops=loops, async_kinds=asy, connectors=conns,
                                   domains=oc.domains_for(text, ["ci-cd"]))
    ir = oc.ir_verdict(features, needs=sorted(needs),
                       notes=f"Jobs as nodes; stage barriers as merge nodes; local includes merged, extends resolved; external (project/component/remote) includes not expanded: {len([c for c in conns if c.startswith(('project:', 'component:', 'remote'))])}. Other: {', '.join(sorted(notes)) or 'none'}.")
    return oc.make_item(platform="gitlab-ci", sid=sid, url=url,
                        revision=f"{man['sha']}" + (f" (default branch {man.get('default_branch')}, committed {man.get('committed_date')})" if kind == "project" else " (gitlab-org/gitlab default branch)"),
                        retrieved=man["retrievedAt"], license=lic, license_evidence=ev, redistributable=redis, raw_path=raw,
                        title=title, description="", desc_provenance="written", nodes=nodes, edges=edges,
                        features=features, ir=ir,
                        oracle={"kind": "none", "notes": "GitLab CI config; `glab ci lint`/CI Lint API validates syntax only; success oracle is the project's own pipeline status."})


if __name__ == "__main__":
    main()
