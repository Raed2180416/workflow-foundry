"""Shared helpers for the consumer-creative cluster converters (foundry-corpus-item/1).

Loaded with importlib by the per-platform converters. Pure functions over already-parsed data;
nothing here executes or imports corpus content. Corpus text is untrusted data.

Feature definitions (same for apple-shortcuts, comfyui, home-assistant, ifttt; repeated in the ledger):
  nodeCount/edgeCount  size of graph.nodes / graph.edges after normalisation
  maxFanOut            maximum out-degree over all edge kinds
  branching            decision points: condition-category nodes, plus human nodes whose answer routes
                       control (menus / choose-from-list with >1 outgoing control edge)
  loops                loop-category nodes (repeat / repeat-each / for-each / while / loop-open nodes)
  async                distinct mechanisms: schedule (time triggers), event (state/device/app triggers),
                       webhook (HTTP triggers), wait (delay / wait-for / wait-to-return), poll (polling
                       triggers or long-running remote jobs that are polled)
  humanSteps           nodes whose completion needs a person (ask/menu/pick/confirm, actionable
                       notifications awaited by a wait_for_trigger, image chooser nodes)
  effects              count of nodes per effects class (none is not counted)
  connectors           distinct external apps/services/integrations named by the nodes
  hasCode              a node runs user code (JavaScript, shell, Python, SSH script, Jinja logic in a
                       template condition is NOT counted)
  hasModelCalls        a node calls an ML/LLM model (local diffusion samplers, hosted model APIs, LLM
                       conversation agents)
  subworkflows         nodes that call another workflow by reference (Run Shortcut, script.*, subgraph
                       instances, automation.trigger)
"""
import hashlib, json, re

SCHEMA = "foundry-corpus-item/1"
RETRIEVED = "2026-10-06"
CATEGORIES = {"trigger", "action", "transform", "condition", "loop", "merge", "wait", "human",
              "model", "code", "subworkflow", "error-handler", "other"}
EFFECTS = {"none", "read", "write", "external"}
EDGE_KINDS = {"data", "control", "error", "loop"}
ASYNC = {"schedule", "webhook", "wait", "poll", "event"}
SECRETISH = re.compile(r"(sk-[A-Za-z0-9]{8,}|api[_-]?key|token=|bearer\s+[A-Za-z0-9._-]{8,}|password|secret|"
                       r"[A-Za-z0-9+/]{40,}={0,2})", re.I)


def clean_summary(s, limit=200):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    s = SECRETISH.sub("[redacted]", s)
    return s[:limit]


class Graph:
    def __init__(self):
        self.nodes, self.edges, self._eset = [], [], set()

    def node(self, ntype, category, effects, summary):
        assert category in CATEGORIES, category
        assert effects in EFFECTS, effects
        nid = f"n{len(self.nodes) + 1}"
        self.nodes.append({"id": nid, "type": str(ntype)[:120], "category": category,
                           "effects": effects, "summary": clean_summary(summary)})
        return nid

    def edge(self, a, b, kind="control"):
        assert kind in EDGE_KINDS, kind
        if a is None or b is None or a == b and kind != "loop":
            return
        k = (a, b, kind)
        if k in self._eset:
            return
        self._eset.add(k)
        self.edges.append({"from": a, "to": b, "kind": kind})

    def cat(self, nid):
        return self.nodes[int(nid[1:]) - 1]["category"]


def compute_features(g, *, async_kinds=(), connectors=(), has_code=None, has_model=None, domains=()):
    out = {}
    for e in g.edges:
        out[e["from"]] = out.get(e["from"], 0) + 1
    ctrl_out = {}
    for e in g.edges:
        if e["kind"] in ("control", "loop"):
            ctrl_out[e["from"]] = ctrl_out.get(e["from"], 0) + 1
    cats = [n["category"] for n in g.nodes]
    branching = sum(1 for n in g.nodes if n["category"] == "condition") + \
        sum(1 for n in g.nodes if n["category"] == "human" and ctrl_out.get(n["id"], 0) > 1)
    eff = {"read": 0, "write": 0, "external": 0}
    for n in g.nodes:
        if n["effects"] in eff:
            eff[n["effects"]] += 1
    asy = sorted({a for a in async_kinds if a in ASYNC})
    return {
        "nodeCount": len(g.nodes), "edgeCount": len(g.edges),
        "maxFanOut": max(out.values()) if out else 0,
        "branching": branching,
        "loops": cats.count("loop"),
        "async": asy,
        "humanSteps": cats.count("human"),
        "effects": eff,
        "connectors": sorted(set(c for c in connectors if c))[:60],
        "hasCode": bool(has_code) if has_code is not None else ("code" in cats),
        "hasModelCalls": bool(has_model) if has_model is not None else ("model" in cats),
        "subworkflows": cats.count("subworkflow"),
        "domains": sorted(set(domains)),
    }


def complexity(f):
    """Selection score (documented in the ledger)."""
    return (f["nodeCount"] + 2 * f["branching"] + 3 * f["loops"] + 4 * f["humanSteps"]
            + 2 * f["subworkflows"] + 2 * len(f["async"]) + 1.5 * len(f["connectors"])
            + (3 if f["hasCode"] else 0) + (2 if f["hasModelCalls"] else 0))


def sha_prefix(b):
    if isinstance(b, str):
        b = b.encode("utf-8", "replace")
    return "sha256:" + hashlib.sha256(b).hexdigest()[:16]


def make_item(*, iid, platform, url, revision, license, license_evidence, redistributable, raw_path,
              title, description, desc_provenance, graph, features, verdict, ir_notes, oracle_kind="none",
              oracle_notes="No executable oracle shipped with the source item.", extra=None):
    item = {
        "schema": SCHEMA, "id": iid,
        "source": {"platform": platform, "url": url, "revision": revision, "retrievedAt": RETRIEVED,
                   "license": license, "licenseEvidence": license_evidence,
                   "redistributable": bool(redistributable), "rawPath": raw_path},
        "title": clean_summary(title, 200),
        "description": {"text": str(description)[:1200], "provenance": desc_provenance},
        "graph": {"nodes": graph.nodes, "edges": graph.edges},
        "features": features,
        "ir": {"verdict": verdict, "notes": ir_notes},
        "oracle": {"kind": oracle_kind, "notes": oracle_notes},
    }
    if extra:
        item["x"] = extra  # cluster-local selection metadata; stripped by the assembler
    return item


def validate(item):
    errs = []
    if item.get("schema") != SCHEMA:
        errs.append("schema")
    ids = set()
    for n in item["graph"]["nodes"]:
        ids.add(n["id"])
        if n["category"] not in CATEGORIES:
            errs.append("category " + n["category"])
        if n["effects"] not in EFFECTS:
            errs.append("effects " + n["effects"])
        if len(n["summary"]) > 200:
            errs.append("summary length")
    for e in item["graph"]["edges"]:
        if e["from"] not in ids or e["to"] not in ids:
            errs.append(f"dangling edge {e}")
        if e["kind"] not in EDGE_KINDS:
            errs.append("edge kind")
    f = item["features"]
    if f["nodeCount"] != len(item["graph"]["nodes"]) or f["edgeCount"] != len(item["graph"]["edges"]):
        errs.append("counts")
    if not item["ir"]["verdict"].split(":")[0] in ("native", "via-extension", "unsupported"):
        errs.append("verdict")
    return errs


def verdict_from(needs, unsupported=None):
    if unsupported:
        return "unsupported:" + unsupported
    needs = sorted({n for n in needs if n})
    return ("via-extension:" + "+".join(needs)) if needs else "native"


def write_jsonl(path, items):
    with open(path, "w", encoding="utf-8") as fh:
        for it in items:
            fh.write(json.dumps(it, ensure_ascii=False) + "\n")
