"""Select and assemble the consumer-creative cluster items (deterministic).

  python3 -I consumer-creative-assemble.py
  -> research/corpus-20261006/parts/consumer-creative.jsonl
     /opt/corpus/consumer-work/strata.json  (stratum of every selected id)
     /opt/corpus/consumer-work/stats.json   (numbers quoted in the ledger)

Strata per platform (quotas below):
  complex       top items by cc.complexity(), with a per-source cap and near-duplicate suppression
                (same node-type multiset and edge count => keep the first)
  feature       for each rare feature (loops, humanSteps, hasModelCalls, hasCode, subworkflows, async wait/poll/
                webhook, branching>=5) the top-k items that have it and were not already selected
  representative seeded uniform sample (sha256('consumer-creative-20261006:'+id)) of the remaining candidates
Selection metadata (`x`) is stripped from the committed items.
"""
import collections, hashlib, importlib.util, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("cc", os.path.join(HERE, "consumer-creative-common.py"))
cc = importlib.util.module_from_spec(spec); spec.loader.exec_module(cc)

WORK = "/opt/corpus/consumer-work"
OUT = os.path.join(HERE, "..", "parts", "consumer-creative.jsonl")
PLAN = {
    #                 complex, per-source cap, feature k, representative
    "apple-shortcuts": (75, 75, 4, 30),
    "comfyui": (65, 8, 4, 30),
    "home-assistant": (70, 14, 4, 35),
    "ifttt": (25, 25, 3, 15),
}
SOURCE_KEY = {"apple-shortcuts": lambda i: "workflowllm",
              "comfyui": lambda i: i["x"].get("repo"),
              "home-assistant": lambda i: i["x"].get("repo") or i["x"].get("src"),
              "ifttt": lambda i: "ifttt"}
FEATURES = [("loops", lambda f: f["loops"] > 0), ("human", lambda f: f["humanSteps"] > 0),
            ("model", lambda f: f["hasModelCalls"]), ("code", lambda f: f["hasCode"]),
            ("subworkflow", lambda f: f["subworkflows"] > 0), ("wait", lambda f: "wait" in f["async"]),
            ("poll", lambda f: "poll" in f["async"]), ("webhook", lambda f: "webhook" in f["async"]),
            ("schedule", lambda f: "schedule" in f["async"]), ("branching5", lambda f: f["branching"] >= 5)]


def h(s):
    return hashlib.sha256(("consumer-creative-20261006:" + s).encode()).hexdigest()


def sig(i):
    return (i["features"]["edgeCount"], tuple(sorted(collections.Counter(n["type"] for n in i["graph"]["nodes"]).items())))


def select(platform, cands):
    n_cx, cap, k, n_rep = PLAN[platform]
    src = SOURCE_KEY[platform]
    cands = sorted(cands, key=lambda i: (-i["x"]["score"], i["id"]))
    chosen, strata, sigs, per = [], {}, set(), collections.Counter()

    def take(i, stratum):
        chosen.append(i); strata[i["id"]] = stratum; sigs.add(sig(i)); per[src(i)] += 1

    for i in cands:
        if len([s for s in strata.values() if s == "complex"]) >= n_cx:
            break
        if per[src(i)] >= cap or sig(i) in sigs:
            continue
        take(i, "complex")
    for name, pred in FEATURES:
        got = 0
        for i in cands:
            if got >= k:
                break
            if i["id"] in strata or sig(i) in sigs or not pred(i["features"]):
                continue
            take(i, "feature:" + name)
            got += 1
    rest = sorted((i for i in cands if i["id"] not in strata and sig(i) not in sigs), key=lambda i: h(i["id"]))
    for i in rest[:n_rep]:
        if sig(i) in sigs:
            continue
        take(i, "representative")
    return chosen, strata


def main():
    all_items, all_strata, stats = [], {}, {}
    for platform, fn in [("apple-shortcuts", "apple-shortcuts"), ("comfyui", "comfyui"),
                         ("home-assistant", "home-assistant"), ("ifttt", "ifttt")]:
        p = os.path.join(WORK, f"{fn}.candidates.jsonl")
        if not os.path.exists(p):
            print("missing", p)
            continue
        cands = [json.loads(l) for l in open(p, encoding="utf-8")]
        chosen, strata = select(platform, cands)
        all_strata.update(strata)
        st = {"candidates": len(cands), "selected": len(chosen),
              "strata": dict(collections.Counter(s.split(":")[0] for s in strata.values())),
              "licenses": dict(collections.Counter(i["source"]["license"] for i in chosen)),
              "redistributable": sum(1 for i in chosen if i["source"]["redistributable"]),
              "verdicts": dict(collections.Counter(i["ir"]["verdict"].split(":")[0] for i in chosen)),
              "extensions": dict(collections.Counter(e for i in chosen if ":" in i["ir"]["verdict"]
                                                     for e in i["ir"]["verdict"].split(":", 1)[1].split("+"))),
              "nodeCount": {"min": min(i["features"]["nodeCount"] for i in chosen),
                            "median": sorted(i["features"]["nodeCount"] for i in chosen)[len(chosen) // 2],
                            "max": max(i["features"]["nodeCount"] for i in chosen)},
              "withLoops": sum(1 for i in chosen if i["features"]["loops"]),
              "withHuman": sum(1 for i in chosen if i["features"]["humanSteps"]),
              "withModel": sum(1 for i in chosen if i["features"]["hasModelCalls"]),
              "withCode": sum(1 for i in chosen if i["features"]["hasCode"]),
              "withSubworkflow": sum(1 for i in chosen if i["features"]["subworkflows"]),
              "async": dict(collections.Counter(a for i in chosen for a in i["features"]["async"])),
              "sources": dict(collections.Counter(SOURCE_KEY[platform](i) for i in chosen)),
              "top": [{"id": i["id"], "title": i["title"], "score": i["x"]["score"],
                       "f": {k: i["features"][k] for k in ("nodeCount", "edgeCount", "branching", "loops", "humanSteps",
                                                         "subworkflows", "async", "hasCode", "hasModelCalls")},
                       "verdict": i["ir"]["verdict"]} for i in sorted(chosen, key=lambda i: -i["x"]["score"])[:8]]}
        stats[platform] = st
        print(platform, st["candidates"], "->", st["selected"], st["strata"])
        all_items += chosen
    out = []
    for i in all_items:
        i = dict(i)
        i.pop("x", None)
        errs = cc.validate(i)
        assert not errs, (i["id"], errs)
        out.append(i)
    ids = [i["id"] for i in out]
    assert len(ids) == len(set(ids)), "duplicate ids"
    cc.write_jsonl(OUT, out)
    json.dump(all_strata, open(os.path.join(WORK, "strata.json"), "w"), indent=1)
    stats["total"] = len(out)
    json.dump(stats, open(os.path.join(WORK, "stats.json"), "w"), indent=1, ensure_ascii=False)
    print("total", len(out), "->", os.path.normpath(OUT))


if __name__ == "__main__":
    main()
