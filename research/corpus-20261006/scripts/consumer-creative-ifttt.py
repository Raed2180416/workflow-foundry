"""IFTTT published applets -> foundry-corpus-item/1 candidates.

  python3 -I consumer-creative-ifttt.py fetch [N=300]   # seeded uniform sample of the applet sitemap
  python3 -I consumer-creative-ifttt.py normalize       # -> /opt/corpus/consumer-work/ifttt.candidates.jsonl

Machine-readable source: each public applet page carries its steps as server-rendered markup
(`div.tqa-step`: label If/With/When/Then, service, step id from the /<service>/<triggers|queries|actions>/<id>
link, meta chip such as "Realtime trigger" / "Polling trigger" / "Filter code" / "Query" / "Action")
plus a schema.org HowTo JSON-LD block. robots.txt (2026-10-06) allows /applets/ for `*`.
Sitemap: https://ifttt.com/sitemap_applets.xml (44,010 URLs on 2026-10-06). 1 request/second.

Licence: IFTTT Terms of Service (https://ifttt.com/terms, read 2026-10-06) forbid copying or
redistributing Content not owned by you without consent. Items are redistributable:false; git keeps
URL + title + normalized graph + written descriptions only. Raw HTML stays in /opt/corpus/ifttt/pages.
"""
import hashlib, html, json, os, re, sys, time, urllib.request, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("cc", os.path.join(HERE, "consumer-creative-common.py"))
cc = importlib.util.module_from_spec(spec); spec.loader.exec_module(cc)

DEST = "/opt/corpus/ifttt"
OUT = "/opt/corpus/consumer-work/ifttt.candidates.jsonl"
UA = {"User-Agent": "workflow-foundry-corpus/1 (research; 1 req/s)"}
TOS = "ToS:https://ifttt.com/terms"
AI_SVC = re.compile(r"(^ai_|_ai$|_ai_|chatgpt|openai|gemini|claude|gpt|llm)", re.I)


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def fetch(n):
    os.makedirs(os.path.join(DEST, "pages"), exist_ok=True)
    sm = os.path.join(DEST, "sitemap_applets.xml")
    if not os.path.exists(sm):
        open(sm, "wb").write(get("https://ifttt.com/sitemap_applets.xml"))
    urls = re.findall(r"<loc>(https://ifttt\.com/applets/[^<]+)</loc>", open(sm, encoding="utf-8").read())
    urls = sorted(set(urls), key=lambda u: hashlib.sha256(("seed-20261006:" + u).encode()).hexdigest())[:n]
    for u in urls:
        aid = u.rsplit("/", 1)[1].split("-", 1)[0]
        p = os.path.join(DEST, "pages", aid + ".html")
        if os.path.exists(p):
            continue
        try:
            open(p, "wb").write(get(u))
        except Exception as ex:
            open(p + ".err", "w").write(str(ex))
        time.sleep(1.0)
    json.dump({"sitemapUrls": len(set(re.findall(r"<loc>(https://ifttt\.com/applets/[^<]+)</loc>", open(sm).read()))),
               "sampled": len(urls), "seed": "sha256('seed-20261006:'+url) order"},
              open(os.path.join(DEST, "fetch-meta.json"), "w"))
    print("sampled", len(urls))


STEP_RE = re.compile(r'<div class="tqa-step[^"]*">(.*?)(?=<div class="tqa-step|</section|<div class="recommended|<div class="tqa-steps-end)', re.S)


def parse(page):
    s = page.decode("utf-8", "replace")
    title = re.search(r'<h1 class="connection-title">\s*(.*?)\s*</h1>', s, re.S)
    url = re.search(r'<link rel="canonical" href="([^"]+)"', s)
    installs = re.search(r'aria-label="([\d.,]+[kKmM]?) users enabled this Applet"', s)
    author = re.search(r'class="author">\s*([^<]+?)\s*<', s)
    pro = bool(re.search(r'class="[^"]*pro-badge(?!-and)', s))
    steps = []
    for st in STEP_RE.findall(s):
        lab = re.search(r'class="step-label">\s*([^<]+?)\s*<', st)
        if not lab:
            continue
        link = re.search(r'class="step-name[^"]*">\s*(?:<a href="/([^"/]+)/(triggers|queries|actions)/([^"]+)">)?\s*([^<]*?)\s*<', st)
        svc = re.search(r'<img title="([^"]+)" class="service-image', st)
        meta = re.findall(r'class="meta-text">\s*([^<]+?)\s*<', st)
        steps.append({"label": lab.group(1).strip(), "service": link.group(1) if link and link.group(1) else None,
                      "kind": link.group(2) if link and link.group(2) else None,
                      "slug": link.group(3) if link and link.group(3) else None,
                      "name": html.unescape(link.group(4)).strip() if link else "", "serviceTitle": svc.group(1) if svc else None,
                      "meta": meta})
    return {"title": html.unescape(title.group(1)).strip() if title else None, "url": url.group(1) if url else None,
            "installs": installs.group(1) if installs else None, "author": author.group(1) if author else None,
            "pro": pro, "steps": steps}


def normalize():
    items = []
    pages = sorted(f for f in os.listdir(os.path.join(DEST, "pages")) if f.endswith(".html"))
    for f in pages:
        raw = open(os.path.join(DEST, "pages", f), "rb").read()
        a = parse(raw)
        if not a["steps"]:
            continue
        aid = f[:-5]
        g = cc.Graph()
        prev, asy, conns, has_code = [], set(), set(), False
        for st in a["steps"]:
            lab, meta = st["label"].lower(), " ".join(st["meta"]).lower()
            svc = st["service"] or (st["serviceTitle"] or "ifttt").lower().replace(" ", "_")
            ntype = f"{st['service']}.{st['kind']}.{st['slug']}" if st["kind"] else (st["name"] or lab).lower().replace(" ", "_")
            if lab == "if":
                kind = "poll" if "polling" in meta else "event"
                if svc in ("date_and_time", "datetime") or re.search(r"every_|_at$|every ", (st["slug"] or "")):
                    kind = "schedule"
                if svc in ("maker_webhooks",):
                    kind = "webhook"
                asy.add(kind)
                nid = g.node(ntype, "trigger", "none", f"Trigger: {st['name']} ({svc}; {st['meta'][0] if st['meta'] else 'trigger'})")
            elif lab == "with":
                if AI_SVC.search(svc):
                    nid = g.node(ntype, "model", "external", f"AI query: {st['name']} ({svc})")
                else:
                    nid = g.node(ntype, "action", "read", f"Query: {st['name']} ({svc})")
            elif lab == "when":
                has_code = True
                nid = g.node("ifttt.filter_code", "code", "none", "Filter code (JavaScript; may skip or rewrite actions)")
            elif lab in ("then", "and"):
                eff = "external"
                if svc in ("notifications", "if_notifications", "ifttt_notifications"):
                    eff = "external"
                if AI_SVC.search(svc):
                    nid = g.node(ntype, "model", "external", f"AI action: {st['name']} ({svc})")
                else:
                    nid = g.node(ntype, "action", eff, f"Action: {st['name']} ({svc})")
            elif "delay" in lab or "wait" in lab:
                asy.add("wait")
                nid = g.node("ifttt.delay", "wait", "none", "Delay")
            else:
                nid = g.node(ntype, "other", "none", f"{st['label']}: {st['name']}")
            if svc not in ("ifttt", "filter_code"):
                conns.add(svc)
            for p in prev:
                g.edge(p, nid, "control")
            prev = [nid]
        n_actions = sum(1 for st in a["steps"] if st["label"].lower() in ("then", "and"))
        feats = cc.compute_features(g, async_kinds=asy, connectors=sorted(conns), has_code=has_code,
                                domains=["consumer-automation"] + (["smart-home"] if re.search(
                                    r"smartthings|hue|nest|ring|alexa|google_assistant|wemo|lifx|tuya|smart_life|ecobee|arlo|wyze",
                                    " ".join(conns)) else []))
        needs = sorted({"event-trigger" if k in ("event",) else f"{k}-trigger" if k in ("schedule", "webhook", "poll") else ""
                        for k in asy if k != "wait"} - {""})
        notes = ("Heuristic verdict (consumer-creative-ifttt.py). An applet is one trigger, optional queries, optional "
                 "JavaScript filter code (which may skip actions or override their fields) and 1..n actions; it maps to an IR "
                 "sequence of task nodes with the filter as a code node feeding `when` guards. The trigger needs an extension.")
        item = cc.make_item(
            iid=f"ifttt:{aid}", platform="ifttt", url=a["url"] or f"https://ifttt.com/applets/{aid}",
            revision=f"page fetched 2026-10-06; {cc.sha_prefix(raw)}", license=TOS,
            license_evidence="https://ifttt.com/terms (2026-10-06): no licence grant; copying/redistributing Content not owned by you requires consent",
            redistributable=False, raw_path=os.path.join(DEST, "pages", f),
            title=a["title"] or aid,
            description=(f"IFTTT applet: {len(a['steps'])} steps ({n_actions} action(s)) across "
                         f"{len(conns)} service(s); trigger mode {', '.join(sorted(asy)) or 'unknown'}"
                         f"{'; filter code' if has_code else ''}{'; Pro feature' if a['pro'] else ''}."),
            desc_provenance="written", graph=g, features=feats, verdict=cc.verdict_from(needs), ir_notes=notes,
            extra={"score": cc.complexity(feats), "installs": a["installs"], "authorIsService": a["author"]})
        if not cc.validate(item):
            items.append(item)
    cc.write_jsonl(OUT, items)
    print("pages", len(pages), "items", len(items), "->", OUT)


if __name__ == "__main__":
    if sys.argv[1] == "fetch":
        fetch(int(sys.argv[2]) if len(sys.argv) > 2 else 300)
    else:
        normalize()
