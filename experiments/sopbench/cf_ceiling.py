# Diagnostic (dev rows only; research/sopbench-20261021/NOTES.md §7.1): content_flagging's tool chain run as its SOP
# describes, N times per row, against the ground truth. calculateBotProbabilityIndex draws random.random(), so the
# chain's decision is a random variable. $0, no model. Run from a neutral directory:
#   corpus/sop-bench-venv/bin/python -I experiments/sopbench/cf_ceiling.py 40
import importlib.util, json, sys, random
from pathlib import Path
repo = Path(__file__).resolve().parents[2]; N = int(sys.argv[1]) if len(sys.argv) > 1 else 40
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("sb_bridge", repo / "experiments/sopbench/bridge.py")
br = importlib.util.module_from_spec(spec); spec.loader.exec_module(br)
up = br._load_sibling("upstream").Upstream(repo / "corpus/sop-bench")
split = br.load_split(repo / "research/sopbench-20261021/SPLIT.json")
sop = br.Sop(up.data, "content_flagging")
allowed = br.allowed_rows(split, "content_flagging", sealed=False, freeze=None)
world = br.World(up, sop, allowed)
res = []
for rid in sorted(allowed):
    inp = br.jsonsafe(sop.inputs(rid)); gt = str(sop.expected(rid)["final_decision"]).lower()
    hits = 0; decs = {}
    for k in range(N):
        b = json.loads(world.call("calculateBotProbabilityIndex", {p: inp[p] for p in ["userid","is_possible_bot","Captcha_tries","device_type","os","browser"]})["content"])
        csi = json.loads(world.call("calculateContentSeverityIndex", {p: inp[p] for p in ["content_id","PrimaryViolationType","SecondaryViolationType","PrimaryViolation_Confidence","SecondaryViolation_Confidence"]})["content"])
        t = json.loads(world.call("calculate_user_trust_score", {"userid": inp["userid"], "NumberofPreviousPosts": inp["NumberofPreviousPosts"], "CountofFlaggedPosts": inp["CountofFlaggedPosts"], "Latitude": inp["Latitude"], "Longitude": inp["Longitude"], "bot_probability_index": b["bot_probability_index"], "device_consistency_score": b["device_consistency_score"]})["content"])
        d = world.call("determineFinalDecision", {"content_id": inp["content_id"], "user_trust_score": t, "content_severity_index": csi, "bot_probability_index": b["bot_probability_index"], "NumberofPreviousPosts": inp["NumberofPreviousPosts"], "CountofFlaggedPosts": inp["CountofFlaggedPosts"]})
        dec = json.loads(d["content"]) if d.get("ok") else "ERR:" + d["content"][:60]
        decs[dec] = decs.get(dec, 0) + 1
        hits += int(str(dec).lower() == gt)
    res.append({"row": rid, "match_rate": hits / N, "modal_matches": max(decs, key=decs.get) == gt, "distinct_decisions": len(decs)})
print(json.dumps({"rows": len(res), "N": N, "mean_match_rate": sum(r["match_rate"] for r in res) / len(res),
                  "rows_always_match": sum(r["match_rate"] == 1 for r in res), "rows_never_match": sum(r["match_rate"] == 0 for r in res),
                  "modal_decision_matches": sum(r["modal_matches"] for r in res), "rows_with_varying_decision": sum(r["distinct_decisions"] > 1 for r in res)}))
