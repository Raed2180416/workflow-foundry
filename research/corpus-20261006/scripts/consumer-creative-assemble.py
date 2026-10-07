"""Select and assemble the consumer-creative cluster items (deterministic).

  python3 -I consumer-creative-assemble.py
  -> research/corpus-20261006/parts/consumer-creative.jsonl
     /opt/corpus/consumer-work/strata.json  (stratum of every selected id)
     /opt/corpus/consumer-work/stats.json   (numbers quoted in the ledger)

Strata per platform (quotas below; target 150-300 items in total):
  coverage      every named acquisition source that would otherwise be absent gets its top-k items
                (ComfyBench, the HF ComfyUI collections, HA docs examples, native iCloud shortcuts)
  complex       top items by cc.complexity(), with a per-source cap and near-duplicate suppression
                (same node-type multiset and edge count, or within one source a weighted Jaccard >= 0.85 of
                node-type multisets at similar size => keep the first; for Apple Shortcuts also the same
                normalised title, since native iCloud shortcuts can be later versions of seed shortcuts).
                Graphs over MAX_NODES=1000 nodes are not selected (listed as oversize in stats.json).
  feature       (per-source cap FEATURE_CAP) for each rare feature (loops, humanSteps, hasModelCalls, hasCode, subworkflows, async wait/poll/
                webhook, branching>=5) the top-k items that have it and were not already selected
  representative seeded uniform sample (sha256('consumer-creative-20261006:'+id)) of the remaining candidates
Selection metadata (`x`) is stripped from the committed items.
"""
import collections, hashlib, importlib.util, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("cc", os.path.join(HERE, "consumer-creative-common.py"))
cc = importlib.util.module_from_spec(spec); spec.loader.exec_module(cc)

WORK = "/opt/corpus/consumer-work"
OUT = os.path.join(HERE, "..", "parts", "consumer-creative.jsonl")
PLAN = {
    #                 complex, per-source cap, feature k, representative
    "apple-shortcuts": (45, {"workflowllm": 30, "icloud": 15}, 2, 20),
    "comfyui": (45, 5, 2, 15),
    "home-assistant": (50, 10, 2, 20),
    "ifttt": (10, 10, 2, 8),
}
CANDIDATE_FILES = {"apple-shortcuts": ["apple-shortcuts", "apple-shortcuts-native"], "comfyui": ["comfyui"],
                   "home-assistant": ["home-assistant"], "ifttt": ["ifttt"]}
SOURCE_KEY = {"apple-shortcuts": lambda i: "icloud" if i["x"].get("native") else "workflowllm",
              "comfyui": lambda i: i["x"].get("repo"),
              "home-assistant": lambda i: i["x"].get("repo") or i["x"].get("src"),
              "ifttt": lambda i: "ifttt"}
# per-source cap inside the feature stratum (None: no cap; single-source platforms)
FEATURE_CAP = {"apple-shortcuts": None, "comfyui": 6, "home-assistant": 12, "ifttt": None}
# source key -> minimum items, filled first from that source's highest-scoring candidates
COVERAGE = {"apple-shortcuts": {"icloud": 3},
            "comfyui": {"xxyQwQ/ComfyBench": 3, "NerdyRodent/NR-Flux-ComfyUI-Workflows": 1,
                        "Cseti/ComfyUI-Workflows": 1, "Old-Fisherman/ComfyUI_Workflows": 1},
            "home-assistant": {"home-assistant/home-assistant.io": 3, "forum": 3, "EPMatt/awesome-ha-blueprints": 2},
            "ifttt": {}}
FEATURES = [("loops", lambda f: f["loops"] > 0), ("human", lambda f: f["humanSteps"] > 0),
            ("model", lambda f: f["hasModelCalls"]), ("code", lambda f: f["hasCode"]),
            ("subworkflow", lambda f: f["subworkflows"] > 0), ("wait", lambda f: "wait" in f["async"]),
            ("poll", lambda f: "poll" in f["async"]), ("webhook", lambda f: "webhook" in f["async"]),
            ("schedule", lambda f: "schedule" in f["async"]), ("branching5", lambda f: f["branching"] >= 5)]


def h(s):
    return hashlib.sha256(("consumer-creative-20261006:" + s).encode()).hexdigest()


MIN_NODES = 2      # selection floor (single-node graphs carry no structure)
MAX_NODES = 1000   # selection ceiling: larger graphs stay in the candidate files and are listed in stats["oversize"]
NEAR_DUP = 0.85    # weighted Jaccard of node-type multisets within one source => near-duplicate variant


def types_of(i):
    if "_types" not in i["x"]:
        i["x"]["_types"] = collections.Counter(n["type"] for n in i["graph"]["nodes"])
    return i["x"]["_types"]


def wjaccard(a, b):
    keys = a.keys() | b.keys()
    num = sum(min(a[k], b[k]) for k in keys)
    den = sum(max(a[k], b[k]) for k in keys)
    return num / den if den else 1.0


def sig(i):
    return (i["features"]["edgeCount"], tuple(sorted(collections.Counter(n["type"] for n in i["graph"]["nodes"]).items())))


def norm_title(t):
    t = re.sub(r"^routinehub\s*•\s*", "", (t or "").lower())
    return re.sub(r"[^a-z0-9]+", "", t)


def select(platform, cands):
    n_cx, cap, k, n_rep = PLAN[platform]
    src = SOURCE_KEY[platform]
    capof = (lambda key: cap.get(key, 0)) if isinstance(cap, dict) else (lambda key: cap)
    cands = sorted(cands, key=lambda i: (-i["x"]["score"], i["id"]))
    chosen, strata, sigs, titles, per = [], {}, set(), set(), collections.Counter()

    def dup(i):
        if not MIN_NODES <= i["features"]["nodeCount"] <= MAX_NODES:
            return True
        if sig(i) in sigs or (platform == "apple-shortcuts" and norm_title(i["title"]) in titles):
            return True
        n = i["features"]["nodeCount"]
        return any(src(j) == src(i) and 0.7 * n <= j["features"]["nodeCount"] <= n / 0.7
                   and wjaccard(types_of(i), types_of(j)) >= NEAR_DUP for j in chosen)

    def take(i, stratum):
        chosen.append(i); strata[i["id"]] = stratum; sigs.add(sig(i)); per[src(i)] += 1
        titles.add(norm_title(i["title"]))

    for key, need in COVERAGE[platform].items():
        for i in cands:
            if per[key] >= need:
                break
            if src(i) == key and i["id"] not in strata and not dup(i):
                take(i, "coverage")
    n_complex = 0
    for i in cands:
        if n_complex >= n_cx:
            break
        if i["id"] in strata or per[src(i)] >= capof(src(i)) or dup(i):
            continue
        take(i, "complex")
        n_complex += 1
    for name, pred in FEATURES:
        got = 0
        for i in cands:
            if got >= k:
                break
            if i["id"] in strata or dup(i) or not pred(i["features"]) or \
                    (FEATURE_CAP[platform] is not None and per[src(i)] >= FEATURE_CAP[platform]):
                continue
            take(i, "feature:" + name)
            got += 1
    rest = sorted((i for i in cands if i["id"] not in strata), key=lambda i: h(i["id"]))
    got = 0
    for i in rest:
        if got >= n_rep:
            break
        if dup(i):
            continue
        take(i, "representative")
        got += 1
    return chosen, strata


def main():
    all_items, all_strata, stats = [], {}, {}
    for platform, fns in CANDIDATE_FILES.items():
        cands = []
        for fn in fns:
            p = os.path.join(WORK, f"{fn}.candidates.jsonl")
            if not os.path.exists(p):
                print("missing", p)
                continue
            cands += [json.loads(l) for l in open(p, encoding="utf-8")]
        chosen, strata = select(platform, cands)
        all_strata.update(strata)
        st = {"candidates": len(cands), "selected": len(chosen),
              "candidatesBySource": dict(collections.Counter(SOURCE_KEY[platform](i) for i in cands).most_common()),
              "candidateLicenses": dict(collections.Counter(i["source"]["license"] for i in cands).most_common()),
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
              "oversize": [{"id": i["id"], "url": i["source"]["url"], "nodeCount": i["features"]["nodeCount"],
                            "title": i["title"]} for i in sorted(cands, key=lambda i: -i["features"]["nodeCount"])
                           if i["features"]["nodeCount"] > MAX_NODES][:12],
              "oversizeCount": sum(1 for i in cands if i["features"]["nodeCount"] > MAX_NODES),
              "top": [{"id": i["id"], "title": i["title"], "score": i["x"]["score"], "url": i["source"]["url"],
                       "license": i["source"]["license"], "stratum": strata[i["id"]],
                       "f": {k: i["features"][k] for k in ("nodeCount", "edgeCount", "branching", "loops", "humanSteps",
                                                         "subworkflows", "async", "hasCode", "hasModelCalls")},
                       "verdict": i["ir"]["verdict"]} for i in sorted(chosen, key=lambda i: -i["x"]["score"])[:8]]}
        stats[platform] = st
        print(platform, st["candidates"], "->", st["selected"], st["strata"])
        all_items += chosen
    out = []
    for i in all_items:
        i = dict(i)
        i.pop("x", None)  # selection metadata (score, source key, cached type multiset) is not committed
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
