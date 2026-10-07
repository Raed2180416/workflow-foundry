#!/usr/bin/env python3
"""Select and write the science cluster's normalized items (foundry-corpus-item/1).

Reads the per-source converter outputs in /opt/corpus/science-work/*.jsonl (outside git), filters and
de-duplicates them, selects per platform a complexity-ranked head plus a seeded random tail, validates
every item with the same shape rules as orchestration-assemble.py, and writes
research/corpus-20261006/parts/science.jsonl plus /opt/corpus/science-work/science-stats.json (ledger input).

Filters: graphs with <3 nodes; WorkflowHub placeholder/test registrations (title 'testEntryTitle...').
De-duplication: exact id, then structural signature (sorted multiset of node types + edge count). On a
collision the item from the more authoritative source is kept, in the order
  galaxy-iwc > nf-core > snakemake-catalog > cwl-repos > wdl-repos > dockstore > workflowhub
(curated, test-carrying registries before submitter-run registries); dropped ids are recorded in the stats.
Selection (seed 20261006): score = orchestration-common.complexity + oracle bonus (output-equivalence +10,
test-profile +6) + 6 ML-inference steps + 3 runtime fan-out + 3 sub-workflows + 2 branching - 20 for
training/tutorial/demo material (the corpus prefers real production pipelines). Per platform: top `head`
by score with no group (source repository owner / IWC category / WorkflowHub project) above 35% of the
head, then `tail` uniformly at random from the remainder for representativeness.
Usage: /opt/corpus/.venv-science/bin/python -I science-assemble.py   (or any python3 -I; stdlib only)
"""
import collections, hashlib, importlib.util, json, os, random, re

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, f):
    sp = importlib.util.spec_from_file_location(name, os.path.join(HERE, f))
    m = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(m)
    return m


oc = load("oc", "orchestration-common.py")
oa = load("oa", "orchestration-assemble.py")   # validate() shared with the orchestration cluster
WORK = "/opt/corpus/science-work"
OUT = os.path.join(os.path.dirname(HERE), "parts", "science.jsonl")
STATS = os.path.join(WORK, "science-stats.json")
SOURCES = ["galaxy-iwc", "nf-core", "snakemake-catalog", "cwl-repos", "wdl-repos", "dockstore", "workflowhub"]
QUOTA = {  # platform: (head, tail)
    "nf-core": (60, 12),
    "galaxy": (45, 15),
    "cwl": (32, 13),
    "snakemake": (28, 12),
    "wdl": (26, 10),
    "nextflow": (18, 7),
}
TUTORIAL = re.compile(r"(?i)tutorial|\bGTN\b|training|\bdemo\b|demonstration|example of|hands-?on|teaching|course\b")
PLACEHOLDER = re.compile(r"(?i)testEntryTitle|entryTitleTest|^test(\s|$)")


def signature(it):
    types = sorted(n["type"] for n in it["graph"]["nodes"])
    return hashlib.sha1(json.dumps([types, it["features"]["edgeCount"]]).encode()).hexdigest()


_proj = {}


def wfh_project(wid):
    if wid not in _proj:
        p = f"/opt/corpus/workflowhub/meta/{wid}.json"
        try:
            d = json.load(open(p))
            d = d.get("data", d)
            ps = ((d.get("relationships") or {}).get("projects") or {}).get("data") or []
            _proj[wid] = "wfh-project:" + ",".join(sorted(x["id"] for x in ps)) if ps else "wfh-project:none"
        except Exception:
            _proj[wid] = "wfh-project:unknown"
    return _proj[wid]


def group_of(it, src):
    """Diversity cap key."""
    if src == "galaxy-iwc":
        m = re.search(r"/iwc/workflows/([^/]+)/", it["source"]["rawPath"])
        return "iwc:" + (m.group(1) if m else "?")
    if src == "workflowhub":
        m = re.search(r"; git https?://[^/]+/([^/ ]+)", it["source"]["revision"])
        if m:
            return "git:" + m.group(1).lower()
        return wfh_project(it["id"].rsplit("/", 1)[-1])
    if src == "dockstore":
        m = re.match(r"wdl:github\.com/([^/]+)/", it["id"])
        return "git:" + (m.group(1).lower() if m else "?")
    if src in ("cwl-repos", "wdl-repos", "snakemake-catalog"):
        return "git:" + it["id"].split(":", 1)[1].split("/")[0].lower()
    return None


def is_tutorial(it):
    return bool(TUTORIAL.search(it["title"] + " " + it["description"]["text"][:300]))


def score(it):
    f = it["features"]
    ok = it["oracle"]["kind"]
    return (oc.complexity(it) + {"output-equivalence": 10, "test-profile": 6}.get(ok, 0)
            + (6 if f["hasModelCalls"] else 0) + (3 if f["loops"] else 0) + (3 if f["subworkflows"] else 0)
            + (2 if f["branching"] else 0) - (20 if is_tutorial(it) else 0))


def capped_head(ranked, head, src_of):
    out, counts, cap = [], collections.Counter(), max(3, int(head * 0.35))
    for it in ranked:
        g = group_of(it, src_of[it["id"]])
        if g is not None and counts[g] >= cap:
            continue
        out.append(it)
        counts[g] += 1
        if len(out) == head:
            break
    if len(out) < head:
        ids = {i["id"] for i in out}
        out += [i for i in ranked if i["id"] not in ids][: head - len(out)]
    return out


def main():
    rng = random.Random(20261006)
    src_of, pool, dropped = {}, [], collections.defaultdict(list)
    per_source = {}
    seen_ids, seen_sig = set(), {}
    for src in SOURCES:
        items = [json.loads(l) for l in open(f"{WORK}/{src}.jsonl")]
        st = per_source[src] = {"converted": len(items), "kept": 0, "lt3": 0, "placeholder": 0, "dup_id": 0, "dup_struct": 0}
        for it in items:
            if it["features"]["nodeCount"] < 3:
                st["lt3"] += 1
                continue
            if PLACEHOLDER.search(it["title"]):
                st["placeholder"] += 1
                continue
            if it["id"] in seen_ids:
                st["dup_id"] += 1
                continue
            s = signature(it)
            if s in seen_sig:
                st["dup_struct"] += 1
                dropped["structural-duplicate"].append([it["id"], seen_sig[s]])
                continue
            seen_ids.add(it["id"])
            seen_sig[s] = it["id"]
            src_of[it["id"]] = src
            pool.append(it)
            st["kept"] += 1
    selected, stats = [], {"sources": per_source, "dropped": dropped, "platforms": {}}
    for platform, (head, tail) in QUOTA.items():
        items = [i for i in pool if i["source"]["platform"] == platform]
        ranked = sorted(items, key=lambda i: (-score(i), i["id"]))
        top = capped_head(ranked, head, src_of)
        top_ids = {i["id"] for i in top}
        rest = sorted((i for i in ranked if i["id"] not in top_ids), key=lambda i: i["id"])
        tail_items = rng.sample(rest, min(tail, len(rest)))
        chosen = top + tail_items
        for i in chosen:
            oa.validate(i)
        selected += chosen
        stats["platforms"][platform] = {
            "candidates": len(items), "selected": len(chosen), "selected_head": len(top), "selected_tail": len(tail_items),
            "by_source_candidates": collections.Counter(src_of[i["id"]] for i in items).most_common(),
            "by_source_selected": collections.Counter(src_of[i["id"]] for i in chosen).most_common(),
            "licenses_selected": collections.Counter(i["source"]["license"] for i in chosen).most_common(),
            "licenses_candidates": collections.Counter(i["source"]["license"] for i in items).most_common(),
            "redistributable_selected": sum(1 for i in chosen if i["source"]["redistributable"]),
            "oracles_selected": collections.Counter(i["oracle"]["kind"] for i in chosen).most_common(),
            "oracles_candidates": collections.Counter(i["oracle"]["kind"] for i in items).most_common(),
            "verdicts_selected": collections.Counter(i["ir"]["verdict"] for i in chosen).most_common(),
            "tutorial_selected": sum(1 for i in chosen if is_tutorial(i)),
            "nodes_median_selected": sorted(i["features"]["nodeCount"] for i in chosen)[len(chosen) // 2] if chosen else 0,
        }
    ids = [i["id"] for i in selected]
    assert len(ids) == len(set(ids))
    oc.write_jsonl(OUT, selected)
    agg = lambda key: sum(i["features"][key] for i in selected)
    stats["total"] = len(selected)
    stats["selected_by_source"] = collections.Counter(src_of[i["id"]] for i in selected).most_common()
    stats["features"] = {
        "nodes": agg("nodeCount"), "edges": agg("edgeCount"),
        "withModel": sum(1 for i in selected if i["features"]["hasModelCalls"]),
        "withLoops": sum(1 for i in selected if i["features"]["loops"]),
        "withBranching": sum(1 for i in selected if i["features"]["branching"]),
        "withSubworkflows": sum(1 for i in selected if i["features"]["subworkflows"]),
        "withCode": sum(1 for i in selected if i["features"]["hasCode"]),
        "withReadEffects": sum(1 for i in selected if i["features"]["effects"]["read"]),
        "withExternalEffects": sum(1 for i in selected if i["features"]["effects"]["external"]),
        "withErrorPaths": sum(1 for i in selected if any(e["kind"] == "error" for e in i["graph"]["edges"]) or any(n["category"] == "error-handler" for n in i["graph"]["nodes"])),
        "async": collections.Counter(a for i in selected for a in i["features"]["async"]).most_common(),
        "categories": collections.Counter(n["category"] for i in selected for n in i["graph"]["nodes"]).most_common(),
        "verdicts": collections.Counter(i["ir"]["verdict"].split(":")[0] for i in selected).most_common(),
        "extensions": collections.Counter(x for i in selected if i["ir"]["verdict"].startswith("via-extension:") for x in i["ir"]["verdict"].split(":", 1)[1].split(",")).most_common(),
        "oracles": collections.Counter(i["oracle"]["kind"] for i in selected).most_common(),
        "licenses": collections.Counter(i["source"]["license"] for i in selected).most_common(),
        "redistributable": sum(1 for i in selected if i["source"]["redistributable"]),
        "domains": collections.Counter(d for i in selected for d in i["features"]["domains"]).most_common(25),
        "services": collections.Counter(c for i in selected for c in i["features"]["connectors"] if c.startswith("service:")).most_common(),
    }
    stats["top_complex"] = [(i["id"], i["features"]["nodeCount"], i["features"]["edgeCount"], round(oc.complexity(i), 1), i["oracle"]["kind"])
                            for i in sorted(selected, key=lambda i: -oc.complexity(i))[:25]]
    json.dump(stats, open(STATS, "w"), indent=1)
    print(json.dumps({"total": len(selected), "by_platform": {k: v["selected"] for k, v in stats["platforms"].items()},
                      "by_source": stats["selected_by_source"],
                      "dropped": {k: len(v) for k, v in dropped.items()},
                      "per_source": per_source}))


if __name__ == "__main__":
    main()
