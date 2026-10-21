# Compromise register B2 check (2026-10-21, FIXES.md Action 0): exhaustive reachability of content_flagging's ground
# truth on the 20 dev rows (dev world only; no sealed row is read).
# The only random draws are in calculateBotProbabilityIndex: dcs = round(U2, 2); bpi = round(U1, 2), or
# round(min(1, U1 + 0.2), 2) when dcs < 0.5. So the reachable (bpi, dcs) outputs are a lattice; every downstream tool is
# deterministic given them. For each row this enumerates the lattice through the real upstream tools (bridge dev world),
# and computes the exact probability that the SOP chain's decision equals the label. $0, no model; about 3 minutes.
# Prints no labels: per row only whether the label is reachable and the exact match probability.
# Usage, from a neutral directory: corpus/sop-bench-venv/bin/python -I <repo>/research/compromises-20261021/action0/b2_reach.py <repo> [maxRows]
import importlib.util, json, sys
from pathlib import Path
repo = Path(sys.argv[1]).resolve(); maxRows = int(sys.argv[2]) if len(sys.argv) > 2 else 10**9
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("sb_bridge", repo / "experiments/sopbench/bridge.py")
br = importlib.util.module_from_spec(spec); spec.loader.exec_module(br)
up = br._load_sibling("upstream").Upstream(repo / "corpus/sop-bench")
split = br.load_split(repo / "research/sopbench-20261021/SPLIT.json")
sop = br.Sop(up.data, "content_flagging")
allowed = br.allowed_rows(split, "content_flagging", sealed=False, freeze=None)
world = br.World(up, sop, allowed)

def pmf_round2():  # round(U, 2), U ~ U[0,1)
    return {k: (0.005 if k in (0, 100) else 0.01) for k in range(101)}
def pmf_shift():   # round(min(1, U + 0.2), 2)
    return {k: (0.005 if k == 20 else 0.205 if k == 100 else 0.01) for k in range(20, 101)}
P_DCS = pmf_round2()

def j(rec):
    assert rec.get("ok"), rec
    return json.loads(rec["content"])

out = []; total_p = 0.0
for rid in sorted(allowed)[:maxRows]:
    inp = br.jsonsafe(sop.inputs(rid)); gt = str(sop.expected(rid)["final_decision"]).lower()
    csi = j(world.call("calculateContentSeverityIndex", {p: inp[p] for p in ["content_id", "PrimaryViolationType", "SecondaryViolationType", "PrimaryViolation_Confidence", "SecondaryViolation_Confidence"]}))
    dec_cache = {}; p_match = 0.0; reach = set(); mass = 0.0
    for d, pd_ in P_DCS.items():
        dcs = d / 100
        for b, pb in (pmf_shift() if dcs < 0.5 else pmf_round2()).items():
            bpi = b / 100
            t = j(world.call("calculate_user_trust_score", {"userid": inp["userid"], "NumberofPreviousPosts": inp["NumberofPreviousPosts"], "CountofFlaggedPosts": inp["CountofFlaggedPosts"], "Latitude": inp["Latitude"], "Longitude": inp["Longitude"], "bot_probability_index": bpi, "device_consistency_score": dcs}))
            key = (t, b)
            if key not in dec_cache:
                dec_cache[key] = str(j(world.call("determineFinalDecision", {"content_id": inp["content_id"], "user_trust_score": t, "content_severity_index": csi, "bot_probability_index": bpi, "NumberofPreviousPosts": inp["NumberofPreviousPosts"], "CountofFlaggedPosts": inp["CountofFlaggedPosts"]}))).lower()
            dec = dec_cache[key]; reach.add(dec); w = pd_ * pb; mass += w
            if dec == gt: p_match += w
    assert abs(mass - 1) < 1e-9, mass
    total_p += p_match
    out.append({"row": rid, "label": gt, "reachableDecisions": sorted(reach), "labelReachable": gt in reach, "pMatch": round(p_match, 4)})
n = len(out)
for r in out: print(json.dumps({"row": r["row"], "labelReachable": r["labelReachable"], "pMatch": r["pMatch"]}))
print(json.dumps({"rows": n, "labelReachable": sum(r["labelReachable"] for r in out), "labelUnreachable": sum(not r["labelReachable"] for r in out),
                  "alwaysMatch": sum(r["pMatch"] > 1 - 1e-9 for r in out), "exactMeanMatchRate": round(total_p / n, 4)}))
