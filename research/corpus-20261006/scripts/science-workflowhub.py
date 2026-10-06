#!/usr/bin/env python3
"""WorkflowHub candidates -> foundry-corpus-item/1 (science cluster).
Run with /opt/corpus/.venv-science/bin/python -I (WDL entries need miniwdl).

Inputs (science-fetch-workflowhub.py): meta/<id>.json (per-workflow licence, title, tags), files-manifest.json
(git sparse clone or unpacked RO-Crate per candidate), crate-meta/<id>-v<v>.json (mainEntity = main workflow
path; TestSuite/TestDefinition entities). The main workflow is parsed with the platform analyzer
(Galaxy .ga/gxformat2, CWL, Snakemake, Nextflow, WDL). Entries that duplicate a source acquired directly
(IWC, nf-core, the Snakemake catalog clones, the CWL/WDL GitHub clones) are skipped and counted.
Output: /opt/corpus/science-work/workflowhub.jsonl (+ -stats.json)
"""
import glob, importlib.util, json, os, re, yaml

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, f):
    sp = importlib.util.spec_from_file_location(name, os.path.join(HERE, f))
    m = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(m)
    return m


sc = load("science_common", "science-common.py")
bd = load("science_builders", "science-builders.py")
gx = load("science_galaxy", "science-galaxy.py")
iwc = load("science_iwc", "science-iwc.py")
cw = load("science_cwl", "science-cwl.py")
sm = load("science_snakemake", "science-snakemake.py")
smc = load("science_snakemake_catalog", "science-snakemake-catalog.py")
nfa = load("science_nextflow", "science-nextflow.py")
try:
    wd = load("science_wdl", "science-wdl.py")
except Exception:          # miniwdl missing: WDL entries are skipped and counted
    wd = None
ROOT = "/opt/corpus/workflowhub"
EXT = {"galaxy": (".ga", ".gxwf.yml", ".gxwf.yaml"), "cwl": (".cwl",), "snakemake": ("Snakefile", ".smk", "snakefile"),
       "nextflow": (".nf",), "workflow_description_language": (".wdl",)}


def crate_info(i, v):
    p = f"{ROOT}/crate-meta/{i}-v{v}.json"
    if not os.path.exists(p):
        return None, [], None
    try:
        d = json.load(open(p))
    except Exception:
        return None, [], None
    g = d.get("@graph") or []
    root = next((x for x in g if x.get("@id") == "./"), {})
    me = (root.get("mainEntity") or {}).get("@id")
    tests = [x for x in g if any(t in str(x.get("@type")) for t in ("TestSuite", "TestDefinition", "TestInstance"))]
    lic = root.get("license")
    if isinstance(lic, dict):
        lic = lic.get("@id")
    return me, tests, lic


def find_main(base, cls, me):
    if me:
        p = os.path.join(base, me)
        if os.path.isfile(p):
            return p
    exts = EXT.get(cls, ())
    cands = [os.path.join(dp, f) for dp, dns, fs in os.walk(base) if "/.git" not in dp for f in fs if f.endswith(exts) or f in exts]
    if not cands:
        return None
    if cls == "nextflow":
        mains = [c for c in cands if os.path.basename(c) == "main.nf"]
        return sorted(mains or cands, key=lambda c: (c.count("/"), len(c)))[0]
    if cls == "snakemake":
        sf = [c for c in cands if os.path.basename(c).lower() == "snakefile"]
        return sorted(sf or cands, key=lambda c: (c.count("/"), len(c)))[0]
    if cls == "cwl":
        wfs = [c for c in cands if cw.is_workflow_file(c)]
        refd = set()
        for c in cands:
            refd |= cw.referenced_runs(c)
        top = [c for c in wfs if os.path.realpath(c) not in refd] or wfs
        return max(top, key=lambda c: os.path.getsize(c)) if top else None
    return max(cands, key=lambda c: os.path.getsize(c))


def known_dupes():
    d = set()
    for f in ("/opt/corpus/snakemake/fetch-manifest.json",):
        if os.path.exists(f):
            d |= {x["full_name"].lower() for x in json.load(open(f))["items"]}
    if os.path.exists("/opt/corpus/science-work/git-manifest.json"):
        d |= {x["repo"].lower() for x in json.load(open("/opt/corpus/science-work/git-manifest.json"))}
    return d


def main():
    man = json.load(open(f"{ROOT}/files-manifest.json"))
    dupes = known_dupes()
    items, stats = [], {"skipped": {}, "kept": {}}
    for rec in man:
        i, v, cls = rec["id"], rec["version"], rec["class"]
        key = f"{i}"
        if rec["status"] != "ok":
            stats["skipped"][key] = rec["status"][:80]
            continue
        meta = json.load(open(f"{ROOT}/meta/{i}.json"))["data"]["attributes"]
        remote = (rec.get("remote") or "").lower().rstrip("/").removesuffix(".git")
        m = re.search(r"github\.com/([^/]+/[^/]+)$", remote)
        if m and m.group(1) in dupes:
            stats["skipped"][key] = f"duplicate of directly acquired {m.group(1)}"
            continue
        base = rec["path"]
        me, tests, crate_lic = crate_info(i, v)
        main_f = find_main(base, cls, me)
        if not main_f:
            stats["skipped"][key] = "main workflow file not found"
            continue
        rel = os.path.relpath(main_f, base)
        lic = meta.get("license") or crate_lic
        lic = {"other-open": "LicenseRef-WorkflowHub-other-open", "other-closed": "LicenseRef-WorkflowHub-other-closed"}.get(lic, lic)
        tags = meta.get("tags") or []
        title = meta.get("title") or rel
        desc = (meta.get("description") or "")
        desc = re.sub(r"!\[[^\]]*\]\([^)]*\)|\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)", "", desc).strip()
        url = f"https://workflowhub.eu/workflows/{i}?version={v}"
        revision = f"WorkflowHub workflow {i} version {v}" + (f"; git {rec.get('remote')} @ {rec.get('commit')}" if rec.get("commit") else "; RO-Crate download")
        ev = f"`license` attribute of https://workflowhub.eu/workflows/{i}.json (per-workflow, submitter-declared)"
        listing = []
        if os.path.exists(base + ".files.json"):
            listing = json.load(open(base + ".files.json"))
        else:
            listing = [os.path.relpath(os.path.join(dp, f), base) for dp, _, fs in os.walk(base) for f in fs]
        t_kinds = sorted({str(t.get("@type")) for t in tests})
        oracle = bd.files_oracle(listing, extra_kind="test-profile" if tests and cls != "galaxy" else None,
                                 extra_notes=(f"RO-Crate test entities: {t_kinds}." if tests else ""))
        topic = " ".join(tags) + " " + " ".join(str(x.get("label", "")) for x in (meta.get("topic_annotations") or []) if isinstance(x, dict))
        sid = f"workflowhub/{i}"
        try:
            if cls == "galaxy":
                if main_f.endswith(".ga"):
                    ga = json.load(open(main_f))
                else:
                    ga = gx.from_gxformat2(yaml.safe_load(open(main_f)))
                if cls == "galaxy" and os.path.exists(main_f[:-3] + "-tests.yml"):
                    oracle, _ = iwc.planemo_oracle(main_f[:-3] + "-tests.yml")
                ga.setdefault("name", title)
                ga["annotation"] = desc or ga.get("annotation") or ""
                ga["tags"] = tags or ga.get("tags") or []
                item = iwc.build_item(ga, platform="galaxy", sid=sid, url=url, revision=revision, license=lic, license_evidence=ev,
                                      raw_path=main_f, oracle=oracle, topic_text=topic, title=f"{title} (WorkflowHub #{i})")
            elif cls == "cwl":
                g = cw.analyze_file(main_f, base, sc.classify_step)
                if g is None:
                    raise ValueError("not a CWL Workflow")
                item = bd.cwl_item(g, sid=sid, url=url, revision=revision, license=lic, license_evidence=ev, raw_path=main_f,
                                   title=f"{title} (WorkflowHub #{i})", description=desc, oracle=oracle, topic_text=topic)
            elif cls == "snakemake":
                res = sm.analyze(os.path.dirname(main_f) if os.path.basename(os.path.dirname(main_f)) == "workflow" else base,
                                 sc.classify_step, entry=None if os.path.basename(os.path.dirname(main_f)) == "workflow" else rel)
                if res is None:
                    raise ValueError("no Snakefile")
                item = smc.build_item(res, platform="snakemake", sid=sid, url=url, revision=revision, license=lic, license_evidence=ev,
                                      raw_path=main_f, title=f"{title} (WorkflowHub #{i})", description=desc, oracle=oracle, topic_text=topic)
            elif cls == "nextflow":
                d = os.path.dirname(main_f)
                g = nfa.analyze_repo(d, sc.classify_step, entry_candidates=(os.path.basename(main_f), "main.nf"))
                dsl = "dsl2"
                if g is None or not g.nodes:
                    g = nfa.analyze_dsl1(d, sc.classify_step, entry=os.path.basename(main_f))
                    dsl = "dsl1"
                if g is None or not g.nodes:
                    raise ValueError("no Nextflow processes found")
                item = bd.nextflow_item(g, sid=sid, url=url, revision=revision, license=lic, license_evidence=ev, raw_path=main_f,
                                        title=f"{title} (WorkflowHub #{i})", description=desc, oracle=oracle, dsl=dsl, repo=d, topic_text=topic)
            elif cls == "workflow_description_language":
                if wd is None:
                    raise ValueError("miniwdl unavailable")
                g, doc = wd.analyze_file(main_f, base, sc.classify_step,
                                         (re.search(r"github\.com/([^/]+/[^/.]+)", rec.get("remote") or "") or [None, None])[1])
                if g is None:
                    raise ValueError("no WDL workflow")
                item = bd.wdl_item(g, sid=sid, url=url, revision=revision, license=lic, license_evidence=ev, raw_path=main_f,
                                   title=f"{title} (WorkflowHub #{i})", description=desc, oracle=oracle, topic_text=topic)
            else:
                stats["skipped"][key] = f"class {cls} out of scope"
                continue
        except Exception as e:
            stats["skipped"][key] = f"parse failed ({cls}, {rel}): {type(e).__name__}: {str(e)[:120]}"
            continue
        if item["features"]["nodeCount"] < 2:
            stats["skipped"][key] = f"trivial graph ({item['features']['nodeCount']} node)"
            continue
        item["source"]["platform"] = {"workflow_description_language": "wdl"}.get(cls, cls)
        item["id"] = f"{item['source']['platform']}:{sid}"
        items.append(item)
        stats["kept"][key] = {"class": cls, "main": rel, "nodes": item["features"]["nodeCount"], "license": item["source"]["license"]}
    sc.save_work("workflowhub", items, stats)
    import collections
    print(len(items), "WorkflowHub items", collections.Counter(x["source"]["platform"] for x in items), "skipped", len(stats["skipped"]))


if __name__ == "__main__":
    main()
