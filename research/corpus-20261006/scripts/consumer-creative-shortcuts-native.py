"""Native Apple Shortcuts plists (iCloud share sample) -> foundry-corpus-item/1 candidates.

  python3 -I consumer-creative-shortcuts-native.py
  -> /opt/corpus/consumer-work/apple-shortcuts-native.candidates.jsonl

Reads /opt/corpus/apple-shortcuts/icloud-manifest.json and the unsigned .plist files with plistlib
(data only). Control flow follows WFControlFlowMode (0 open, 1 middle: Otherwise / menu item,
2 close) grouped by GroupingIdentifier; data edges follow ActionOutput OutputUUID references and named
variables (Set/Get Variable). Action classification is shared with consumer-creative-shortcuts.py so
the transcribed (WorkflowLLM) and native items use one taxonomy.
"""
import importlib.util, json, os, plistlib, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, mod):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, name))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


cc = load("consumer-creative-common.py", "cc")
sc = load("consumer-creative-shortcuts.py", "sc")
RAW = "/opt/corpus/apple-shortcuts"
OUT = "/opt/corpus/consumer-work/apple-shortcuts-native.candidates.jsonl"
PFX = "is.workflow.actions."
VAR_ACTIONS = {"setvariable", "appendvariable", "getvariable"}


def refs(params):
    """Collect (kind, value) references inside action parameters."""
    out = []

    def walk(x):
        if isinstance(x, dict):
            t = x.get("Type")
            if t == "ActionOutput" and x.get("OutputUUID"):
                out.append(("uuid", x["OutputUUID"]))
            elif t == "Variable" and x.get("VariableName"):
                out.append(("var", x["VariableName"]))
            elif t == "ExtensionInput":
                out.append(("input", None))
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(params)
    return out


def convert(plist):
    conv = sc.Conv()
    g = conv.g
    producer = {}          # uuid -> node
    var = {}               # variable name -> node
    stack, preds = [], []
    exit_inside = False

    def data_edges(nid, params):
        for kind, v in refs(params):
            src = producer.get(v) if kind == "uuid" else var.get(v) if kind == "var" else None
            if kind == "input":
                if conv.input_node is None:
                    conv.input_node = g.node("shortcuts.input", "trigger", "none",
                                             "Shortcut input (share sheet, widget, Siri or caller)")
                src = conv.input_node
            if src and src != nid:
                g.edge(src, nid, "data")

    for a in plist.get("WFWorkflowActions", []):
        ident = str(a.get("WFWorkflowActionIdentifier", ""))
        p = a.get("WFWorkflowActionParameters") or {}
        mode = p.get("WFControlFlowMode")
        uuid = p.get("UUID")
        short = ident[len(PFX):] if ident.startswith(PFX) else None
        if short == "conditional":
            if mode == 0:
                c = g.node("is.workflow.actions.conditional", "condition", "none",
                           f"If ({p.get('WFCondition', '?')})")
                data_edges(c, p)
                for x in preds:
                    g.edge(x, c)
                stack.append({"k": "if", "n": c, "exits": [], "else": False})
                preds = [c]
            elif stack and stack[-1]["k"] == "if":
                fr = stack[-1]
                if mode == 1:
                    fr["exits"] += preds; fr["else"] = True; preds = [fr["n"]]
                elif mode == 2:
                    stack.pop()
                    ex = fr["exits"] + preds + ([] if fr["else"] else [fr["n"]])
                    preds = list(dict.fromkeys(ex))
                    if uuid:
                        producer[uuid] = fr["n"]
            continue
        if short == "choosefrommenu":
            if mode == 0:
                items = p.get("WFMenuItems") or []
                M = g.node("is.workflow.actions.choosefrommenu", "human", "none", f"Choose from menu ({len(items)} options)")
                data_edges(M, p)
                for x in preds:
                    g.edge(x, M)
                stack.append({"k": "menu", "n": M, "exits": [], "items": 0})
                preds = [M]
            elif stack and stack[-1]["k"] == "menu":
                fr = stack[-1]
                if mode == 1:
                    if fr["items"]:
                        fr["exits"] += preds
                    fr["items"] += 1
                    preds = [fr["n"]]
                elif mode == 2:
                    stack.pop()
                    preds = list(dict.fromkeys(fr["exits"] + preds)) or [fr["n"]]
                    if uuid:
                        producer[uuid] = fr["n"]
            continue
        if short in ("repeat.count", "repeat.each"):
            if mode == 0:
                L = g.node(ident, "loop", "none", "Repeat with each" if short.endswith("each") else "Repeat count")
                data_edges(L, p)
                for x in preds:
                    g.edge(x, L)
                stack.append({"k": "loop", "n": L})
                preds = [L]
            elif stack and stack[-1]["k"] == "loop" and mode == 2:
                fr = stack.pop()
                for x in preds:
                    g.edge(x, fr["n"], "loop")
                preds = [fr["n"]]
                if uuid:
                    producer[uuid] = fr["n"]
            continue
        # plain action
        if short in VAR_ACTIONS:
            if short in ("setvariable", "appendvariable") and p.get("WFVariableName"):
                for kind, v in refs(p):
                    src = producer.get(v) if kind == "uuid" else var.get(v) if kind == "var" else conv.input_node
                    if src:
                        var[p["WFVariableName"]] = src
            elif short == "getvariable" and uuid:
                for kind, v in refs(p):
                    src = producer.get(v) if kind == "uuid" else var.get(v) if kind == "var" else conv.input_node
                    if src:
                        producer[uuid] = src
            continue
        if short is not None:
            name = short.replace(".", "_")
            if name == "ask":
                cl = ("is.workflow.actions.ask", "human", "none", "Ask for input")
            else:
                cl = conv.classify("action", name, None, json.dumps(p, default=str)[:4000])
        else:
            cl = conv.classify("intent", ident.replace(".", "_"), None, "")
        if cl is None:
            continue
        nid = g.node(ident if short is None else cl[0], *cl[1:])
        data_edges(nid, p)
        for x in preds:
            g.edge(x, nid)
        if uuid:
            producer[uuid] = nid
        if short in sc.TERMINAL:
            preds = []
            if stack:
                exit_inside = True
        else:
            preds = [nid]
    return conv, exit_inside


def main():
    man = json.load(open(os.path.join(RAW, "icloud-manifest.json")))
    items = []
    for r in man["records"]:
        if r.get("outcome") != "acquired":
            continue
        try:
            pl = plistlib.load(open(r["rawPath"], "rb"))
        except Exception as ex:
            print("unparseable", r["id"], ex)
            continue
        conv, exit_inside = convert(pl)
        g = conv.g
        if len(g.nodes) < 2:
            continue
        acts = pl.get("WFWorkflowActions", [])
        needs = set(conv.needs)
        if len(g.nodes) > 500:
            needs.add("split-over-500-nodes")
        conns = set(conv.connectors)
        blob = json.dumps(acts, default=str)
        for _, host in sc.URL_RE.findall(blob):
            parts = host.lower().split(".")
            conns.add("web:" + ".".join(parts[-2:]))
        types = pl.get("WFWorkflowTypes") or []
        f = cc.compute_features(g, async_kinds=conv.asyncs, connectors=sorted(conns), has_code=conv.has_code,
                                has_model=conv.has_model, domains=sc.domains_of(conv.acts, sorted(conns), conv.has_model))
        notes = ("Heuristic verdict from the native .plist (consumer-creative-shortcuts-native.py), not a compiled IR. "
                 f"{len(acts)} source actions; normalized graph omits Comment/Nothing and Set/Get/Append Variable (kept as data edges). "
                 "Menus/asks/alerts -> IR human nodes, If/Menu -> `when` guards, Repeat -> loop.")
        if types:
            notes += f" Shortcut surfaces: {', '.join(map(str, types))}."
        if needs:
            notes += " Needs: " + ", ".join(sorted(needs)) + "."
        if exit_inside:
            notes += " Stops early inside a branch/loop; expressible with negated `when` guards downstream."
        item = cc.make_item(
            iid=f"apple-shortcuts:icloud-{r['id']}", platform="apple-shortcuts", url=r["url"],
            revision=f"iCloud record {r['id']} recordChangeTag {r.get('recordChangeTag')} modified {r.get('modified')}; plist sha256:{r['sha256'][:16]}",
            license="unknown",
            license_evidence="Shared publicly via an iCloud link by its author; the record carries no licence (Apple iCloud terms apply).",
            redistributable=False, raw_path=r["rawPath"], title=r.get("name") or r["id"],
            description=(f"Native Apple Shortcut ({len(acts)} actions, {f['branching']} decision points, {f['loops']} loops, "
                         f"{f['humanSteps']} interactive steps) referenced from a WorkflowLLM seed shortcut."),
            desc_provenance="written", graph=g, features=f, verdict=cc.verdict_from(sorted(needs)), ir_notes=notes,
            oracle_notes="No executable oracle: Shortcuts run only on iOS/macOS.",
            extra={"score": cc.complexity(f), "srcActions": len(acts), "native": True})
        if not cc.validate(item):
            items.append(item)
    cc.write_jsonl(OUT, items)
    print("records", len(man["records"]), "items", len(items), "->", OUT)


if __name__ == "__main__":
    main()
