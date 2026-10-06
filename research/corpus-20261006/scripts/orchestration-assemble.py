#!/usr/bin/env python3
"""Select and write the orchestration cluster's normalized items.

Reads the per-platform candidate files produced by the converters (outside git, in
/opt/corpus/orchestration-work/*-candidates.json), de-duplicates, selects per platform a
complexity-ranked head plus a seeded random representative tail, validates every item against
foundry-corpus-item/1 shape rules, and writes research/corpus-20261006/parts/orchestration.jsonl
plus a stats JSON used by the ledger.

Selection (seed 20261006): score = orchestration-common.complexity(item) + 6 if the item has an
executable/test oracle. Per platform quota = top `head` by score + `tail` uniform random from the
rest (GitHub Actions tail drawn only from the uniformly sampled pool R so it stays representative).
Usage: python3 -I orchestration-assemble.py
"""
import importlib.util, json, os, random, re, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("oc", os.path.join(HERE, "orchestration-common.py"))
oc = importlib.util.module_from_spec(spec); spec.loader.exec_module(oc)

WORK = "/opt/corpus/orchestration-work"
OUT = os.path.join(os.path.dirname(HERE), "parts", "orchestration.jsonl")
STATS = os.path.join(WORK, "orchestration-stats.json")
QUOTA = {  # platform: (candidate file, head, tail)
    "airflow": ("airflow", 62, 28),
    "argo": ("argo", 38, 17),
    "kubeflow": ("kfp", 22, 8),
    "tekton": ("tekton", 14, 6),
    "github-actions": ("gha", 55, 30),
    "gitlab-ci": ("gitlab", 34, 9),
    "dagster": ("dagster", 18, 7),
    "prefect": ("prefect", 12, 6),
    "temporal": ("temporal", 24, 10),
}


def score(it):
    """complexity + bonuses for the niche features the corpus is meant to cover."""
    f = it["features"]
    err = any(e["kind"] == "error" for e in it["graph"]["edges"]) or any(n["category"] == "error-handler" for n in it["graph"]["nodes"])
    return (oc.complexity(it) + (6 if it["oracle"]["kind"] != "none" else 0)
            + (14 if f["humanSteps"] else 0) + (12 if f["hasModelCalls"] else 0) + (6 if err else 0)
            + (5 if f["loops"] else 0) + (4 if f["subworkflows"] else 0)
            + (3 if set(f["async"]) & {"event", "wait"} else 0))


def group_of(it):
    """Diversity cap key: no single source package/sample family may take >35% of a platform's head."""
    p = it["source"]["platform"]
    if p == "airflow":
        return it["id"].split("/")[0]
    if p == "temporal":
        return it["id"].split("/")[0]
    if p == "gitlab-ci":
        return "templates" if "/lib/gitlab/ci/templates/" in it["id"] else "projects"
    return None


def capped_head(ranked, head):
    out, counts, cap = [], Counter(), max(3, int(head * 0.35))
    for it in ranked:
        if it["features"]["nodeCount"] < 3:  # degenerate extractions never lead the head
            continue
        g = group_of(it)
        if g is not None and counts[g] >= cap:
            continue
        out.append(it)
        counts[g] += 1
        if len(out) == head:
            break
    if len(out) < head:  # too few groups to honour the cap: fill by rank
        ids = {i["id"] for i in out}
        out += [i for i in ranked if i["id"] not in ids][: head - len(out)]
    return out


def validate(it):
    req = ["schema", "id", "source", "title", "description", "graph", "features", "ir", "oracle"]
    assert all(k in it for k in req), it.get("id")
    assert it["schema"] == oc.SCHEMA
    s = it["source"]
    for k in ("platform", "url", "revision", "retrievedAt", "license", "licenseEvidence", "redistributable", "rawPath"):
        assert k in s, (it["id"], k)
    assert s["rawPath"].startswith("/opt/corpus/")
    ids = [n["id"] for n in it["graph"]["nodes"]]
    assert len(ids) == len(set(ids)), it["id"]
    for n in it["graph"]["nodes"]:
        assert set(n) == {"id", "type", "category", "effects", "summary"}, (it["id"], n)
        assert n["category"] in oc.CATEGORIES and n["effects"] in oc.EFFECTS
        assert len(n["summary"]) <= 200
    for e in it["graph"]["edges"]:
        assert set(e) == {"from", "to", "kind"} and e["kind"] in oc.EDGE_KINDS
        assert e["from"] in ids and e["to"] in ids
    f = it["features"]
    assert f["nodeCount"] == len(ids) and f["edgeCount"] == len(it["graph"]["edges"])
    assert set(f["async"]) <= oc.ASYNC
    assert it["ir"]["verdict"].startswith(("native", "via-extension:", "unsupported:"))
    assert it["oracle"]["kind"] in ("none", "mocked-execution", "test-profile", "output-equivalence")
    if not s["redistributable"]:
        assert it["description"]["text"] == ""
    assert not oc.SECRETISH.search(json.dumps(it["graph"])), it["id"]


def main():
    rng = random.Random(20261006)
    selected, stats = [], {"platforms": {}}
    for platform, (cand, head, tail) in QUOTA.items():
        d = json.load(open(f"{WORK}/{cand}-candidates.json"))
        items = d["items"]
        # de-duplicate: Airflow 2.10.5 example_dags duplicate core 3.3.2 ones by dag_id; keep core
        if platform == "airflow":
            core = {i["id"].split("#")[-1] for i in items if i["id"].startswith("airflow:apache-airflow-core/")}
            items = [i for i in items if not (i["id"].startswith("airflow:apache-airflow/") and i["id"].split("#")[-1] in core)]
        seen, uniq = set(), []
        for i in items:
            if i["id"] not in seen:
                seen.add(i["id"]); uniq.append(i)
        items = uniq
        ranked = sorted(items, key=lambda i: (-score(i), i["id"]))
        top = capped_head(ranked, head)
        top_ids = {i["id"] for i in top}
        rest = [i for i in ranked if i["id"] not in top_ids]
        if platform == "github-actions":
            pool = [i for i in rest if i.get("_pool") == "R"]
        else:
            pool = rest
        pool = sorted(pool, key=lambda i: i["id"])
        tail_items = rng.sample(pool, min(tail, len(pool)))
        chosen = top + tail_items
        for i in chosen:
            i.pop("_pool", None)
            validate(i)
        selected += chosen
        stats["platforms"][platform] = {
            "units_scanned": d.get("files"), "converted": len(items), "conversion_errors": len(d["errors"]),
            "error_kinds": Counter(e["error"][:70] for e in d["errors"]).most_common(6),
            "selected": len(chosen), "selected_head": len(top), "selected_tail": len(tail_items),
            "licenses_selected": Counter(i["source"]["license"] for i in chosen).most_common(),
            "redistributable_selected": sum(1 for i in chosen if i["source"]["redistributable"]),
            "licenses_converted": Counter(i["source"]["license"] for i in items).most_common(),
            "verdicts_selected": Counter(i["ir"]["verdict"] for i in chosen).most_common(),
            "oracles_selected": Counter(i["oracle"]["kind"] for i in chosen).most_common(),
        }
    ids = [i["id"] for i in selected]
    assert len(ids) == len(set(ids))
    oc.write_jsonl(OUT, selected)
    agg = lambda key: sum(i["features"][key] for i in selected)
    stats["total"] = len(selected)
    stats["features"] = {
        "nodes": agg("nodeCount"), "edges": agg("edgeCount"),
        "withHuman": sum(1 for i in selected if i["features"]["humanSteps"]),
        "withModel": sum(1 for i in selected if i["features"]["hasModelCalls"]),
        "withLoops": sum(1 for i in selected if i["features"]["loops"]),
        "withBranching": sum(1 for i in selected if i["features"]["branching"]),
        "withSubworkflows": sum(1 for i in selected if i["features"]["subworkflows"]),
        "withErrorPaths": sum(1 for i in selected if any(e["kind"] == "error" for e in i["graph"]["edges"]) or any(n["category"] == "error-handler" for n in i["graph"]["nodes"])),
        "async": Counter(a for i in selected for a in i["features"]["async"]).most_common(),
        "verdicts": Counter(i["ir"]["verdict"].split(":")[0] for i in selected).most_common(),
        "extensions": Counter(x for i in selected if i["ir"]["verdict"].startswith("via-extension:") for x in i["ir"]["verdict"].split(":", 1)[1].split(",")).most_common(),
        "redistributable": sum(1 for i in selected if i["source"]["redistributable"]),
    }
    stats["top_complex"] = [(i["id"], i["features"]["nodeCount"], i["features"]["edgeCount"], round(oc.complexity(i), 1))
                            for i in sorted(selected, key=lambda i: -oc.complexity(i))[:25]]
    json.dump(stats, open(STATS, "w"), indent=1)
    print(json.dumps({"total": len(selected), "by_platform": {k: v["selected"] for k, v in stats["platforms"].items()}}))


if __name__ == "__main__":
    main()
