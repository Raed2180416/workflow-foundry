"""ComfyUI workflow JSON (UI/litegraph format incl. subgraphs, and API "prompt" format)
-> foundry-corpus-item/1 candidates.

Inputs (raw, outside git): /opt/corpus/comfyui/git/<owner>__<repo>/** (see git-manifest.json) and
/opt/corpus/comfyui/hf/<owner>__<name>/** (see hf-manifest.json). JSON is parsed only; nothing runs.

  python3 -I consumer-creative-comfyui.py   -> /opt/corpus/consumer-work/comfyui.candidates.jsonl

Normalisation:
  * UI-only nodes are dropped (Note, MarkdownNote, rgthree Label/Bookmark/bypasser panels, frontend
    PrimitiveNode); Reroute and KJNodes SetNode/GetNode virtual wires are collapsed into direct edges.
  * Subgraph definitions (definitions.subgraphs) are inlined once; the instance node is kept as a
    `subworkflow` node with data edges into the subgraph's entry nodes, and the subgraph's exit nodes
    feed the instance's consumers.
  * Loop open/close node pairs get a `loop` back-edge from close to open.
"""
import glob, importlib.util, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("cc", os.path.join(HERE, "consumer-creative-common.py"))
cc = importlib.util.module_from_spec(spec); spec.loader.exec_module(cc)

ROOT = "/opt/corpus/comfyui"
OUT = "/opt/corpus/consumer-work/comfyui.candidates.jsonl"

UI_ONLY = re.compile(r"^(Note|MarkdownNote|PrimitiveNode|Label \(rgthree\)|Bookmark \(rgthree\)|Fast Groups (Bypasser|Muter) \(rgthree\)|"
                     r"Fast (Bypasser|Muter) \(rgthree\)|Mute / Bypass (Repeater|Relay) \(rgthree\)|Note Plus \(mtb\)|"
                     r"Image Comparer \(rgthree\)|Context Switch Big \(rgthree\)_disabled|workflow/.*_note)$")
COLLAPSE = {"Reroute", "SetNode", "GetNode", "Reroute (rgthree)"}
PROVIDERS = [("openai", r"OpenAI|GPTImage|Dalle|DALLE|Sora"), ("google", r"Gemini|Veo|Imagen|NanoBanana"),
             ("anthropic", r"Claude|Anthropic"), ("kling", r"Kling"), ("luma", r"Luma"), ("runway", r"Runway"),
             ("pika", r"Pika"), ("minimax", r"Minimax|Hailuo"), ("vidu", r"Vidu"), ("recraft", r"Recraft"),
             ("ideogram", r"Ideogram"), ("stability", r"^Stability"), ("bfl", r"FluxPro|Flux2Pro|BFL|FluxKontextPro|FluxKontextMax"),
             ("tripo", r"Tripo"), ("rodin", r"Rodin"), ("moonvalley", r"Moonvalley"),
             ("bytedance", r"ByteDance|Seedream|Seedance"), ("xai", r"Grok"), ("wavespeed", r"Wavespeed"),
             ("meshy", r"Meshy"), ("pixverse", r"Pixverse"), ("magnific", r"Magnific"), ("bria", r"^Bria"),
             ("krea", r"^Krea\d?\w*Node"), ("beeble", r"Beeble"), ("topaz", r"Topaz"), ("elevenlabs", r"ElevenLabs"),
             ("hunyuan-api", r"Hunyuan3DApi|TencentHunyuan"), ("reve", r"^Reve"), ("alibaba-wan-api", r"^Wan\w*ApiNode|WanImageToVideoApi|WanTextToVideoApi"),
             ("qwen-api", r"^Qwen\w*Node$"), ("higgsfield", r"Higgsfield"), ("ltx-api", r"^LtxvApi|LTXVApi")]
POLL_PROVIDERS = {"kling", "luma", "runway", "pika", "minimax", "vidu", "tripo", "rodin", "moonvalley", "bytedance",
                  "wavespeed", "meshy", "pixverse", "beeble", "topaz", "bfl", "alibaba-wan-api", "higgsfield", "ltx-api",
                  "hunyuan-api", "google", "magnific", "xai"}
LOCAL_SERVICE = [("ollama", r"Ollama"), ("lm-studio", r"LMStudio|LM Studio"), ("discord", r"Discord"),
                 ("telegram", r"Telegram"), ("google-translate", r"GoogleTranslate"), ("deepl", r"DeepL"), ("http", r"HTTP|Http|Webhook|URL ?Request|Fetch|API Request"),
                 ("s3", r"\bS3\b"), ("civitai", r"Civitai|CivitAI"), ("huggingface", r"HuggingFace|HF ?Download")]
LOOP_OPEN = re.compile(r"(WhileLoopOpen|ForLoopOpen|forLoopStart|whileLoopStart|^StartLoop$|ForeachListBegin|LoopStart|Loop Start|"
                       r"For Loop Start|While Loop Start|ImpactQueueTrigger)", re.I)
LOOP_CLOSE = re.compile(r"(WhileLoopClose|ForLoopClose|forLoopEnd|whileLoopEnd|^EndLoop$|ForeachListEnd|LoopEnd|Loop End|For Loop End|"
                        r"While Loop End)", re.I)
HUMAN = re.compile(r"(Chooser|ImageChooser|Image Selector|PreviewChooser|Pause|Interactive|HumanInTheLoop|Approval|Wait For User)", re.I)
CODE = re.compile(r"(GLSLShader|Python|Exec(ute)?(Code|Script)|Evaluate (Strings|Ints|Floats)|Eval(uate)? ?Code|JavaScript|"
                  r"RunScript|Script Node|(?<![A-Za-z])CodeNode)", re.I)  # not ExpressionEditor (LivePortrait face edit)
COND = re.compile(r"(Switch(?! Mesh Axis| 3DGS Axis)|\bIf\b|IfElse|Conditional|ExecutionGate|Gate\b|ImpactCompare|StringCompare|"
                  r"ConditionalStop|SwitchByIndex|Selector \(rgthree\)|Any Switch|Logic)", re.I)
MODEL = re.compile(r"(KSampler(?!Select)|Sampler(Custom|Advanced)|SamplerCustom|\bSampler\b(?! Loader)|Sampler$|Sampler\W|DetailDaemonSampler|"
                   r"TextEncode|CLIPTextEncode|T5TextEncode|VAE(Encode|Decode)|Encode(?!.*Loader)|Decode(?!.*Loader)|"
                   r"Upscale(r)?(With)?Model|ImageUpscaleWithModel|UltimateSDUpscale|Detailer|FaceRestore|ReActor|Florence2Run|"
                   r"Sam2|SAM3|SAMDetector|Segment|Detector|DepthAnything|Depth\w*Estimat|MiDaS|Zoe|Marigold|Preprocessor|Lineart|"
                   r"OpenPose|DWPose|Interrogat|Caption|Tagger|WD14|QwenVL|LLM|Ollama|TextGenerate|Whisper|TTS|AudioSeparation|"
                   r"RemoveBackground|RMBG|BiRefNet|Matting|InsightFace|FaceAnalysis|IPAdapter(?!.*(Loader|Model))|InstantID(?!.*Loader)|"
                   r"PuLID(?!.*Loader)|CLIPVisionEncode|SeedVR2(?!.*Loader)|LivePortrait|Wav2Vec|MultiTalk|Hy3D|Hunyuan3D|TripoSR|"
                   r"Rembg|Matte|FrameInterpolation|RIFE|FILM VFI|GIMMVFI|Florence|Moondream|Joy ?Caption|PromptEnhancer|LanPaint_KSampler|"
                   r"Generate(?!.*Size)|Inference)", re.I)
READ = re.compile(r"(Load|Loader|Download|FromFolder|FromDir|FromURL|ReadFile|Read File|LoadImage|LoadVideo|LoadAudio|Webcam|"
                  r"Clipboard|Get ?File)", re.I)
WRITE = re.compile(r"(Save|Export|Write|VideoCombine|Upload|Output ?File)", re.I)
DISPLAY = re.compile(r"(Preview|Show|Display|Compare|Comparer|Viewer|Inspect|Debug)", re.I)


def provider_of(t):
    if not re.search(r"Node(V\d+)?$|Api|API", t):
        return None
    for name, rx in PROVIDERS:
        if re.search(rx, t):
            return name
    return None


def classify(t, mode):
    """-> (category, effects, summary, provider)"""
    prov = provider_of(t)
    suffix = " (bypassed)" if mode == 4 else (" (muted)" if mode == 2 else "")
    if prov:
        return "model", "external", f"{t} via {prov} API{suffix}", prov
    for name, rx in LOCAL_SERVICE:
        if re.search(rx, t):
            cat = "model" if name in ("ollama", "lm-studio") else "action"
            return cat, "external", f"{t}{suffix}", name
    if LOOP_OPEN.search(t):
        return "loop", "none", f"{t} (loop open){suffix}", None
    if LOOP_CLOSE.search(t):
        return "merge", "none", f"{t} (loop close){suffix}", None
    if HUMAN.search(t):
        return "human", "none", f"{t}{suffix}", None
    if CODE.search(t):
        return "code", "none", f"{t}{suffix}", None
    if COND.search(t):
        return "condition", "none", f"{t}{suffix}", None
    if WRITE.search(t) and not re.search(r"Preview", t, re.I):
        return "action", "write", f"{t}{suffix}", None
    if READ.search(t):
        return "action", "read", f"{t}{suffix}", None
    if MODEL.search(t):
        return "model", "none", f"{t}{suffix}", None
    if DISPLAY.search(t):
        return "action", "none", f"{t}{suffix}", None
    return "transform", "none", f"{t}{suffix}", None


def link_tuple(l):
    if isinstance(l, list) and len(l) >= 5:
        return l[0], l[1], l[3]
    if isinstance(l, dict):
        return l.get("id"), l.get("origin_id"), l.get("target_id")
    return None


class Conv:
    def __init__(self, defs):
        self.g = cc.Graph()
        self.defs = defs                # subgraph uuid -> definition
        self.inlined = {}               # uuid -> (entry gids, exit gids)
        self.providers, self.packs = set(), set()
        self.asyncs = set()
        self.instance_count = 0
        self.has_code = False
        self.types = set()

    def graph(self, nodes, links, scope):
        """Emit nodes/edges of one graph level; return (gid map, entry gids, exit gids) where entry/exit are
        relative to the subgraph pseudo input (-10) / output (-20) nodes."""
        gid, kind = {}, {}
        for n in nodes:
            t = str(n.get("type") or n.get("class_type") or "?")
            nid = n.get("id")
            props = n.get("properties") or {}
            if props.get("cnr_id") and props["cnr_id"] != "comfy-core":
                self.packs.add("pack:" + str(props["cnr_id"])[:60])
            if UI_ONLY.match(t):
                kind[nid] = "drop"
                continue
            if t in COLLAPSE:
                kind[nid] = "collapse"
                continue
            self.types.add(t)
            mode = n.get("mode", 0)
            if t in self.defs:
                self.instance_count += 1
                name = self.defs[t].get("name") or "subgraph"
                gid[nid] = self.g.node("subgraph:" + str(name)[:80], "subworkflow", "none", f"Subgraph instance '{name}'")
                kind[nid] = "subgraph"
                continue
            if re.match(r"^workflow[/>]", t):  # legacy group node
                gid[nid] = self.g.node(t[:120], "subworkflow", "none", f"Group node {t[9:]}")
                kind[nid] = "subgraph"
                continue
            cat, eff, summ, prov = classify(t, mode)
            if prov:
                self.providers.add(prov)
                if prov in POLL_PROVIDERS:
                    self.asyncs.add("poll")
            if cat == "code":
                self.has_code = True
            gid[nid] = self.g.node(t, cat, eff, summ)
            kind[nid] = cat
        # raw adjacency
        srcs = {}   # target -> [origin]
        for l in links or []:
            lt = link_tuple(l)
            if not lt:
                continue
            _, o, tgt = lt
            srcs.setdefault(tgt, []).append(o)
        # Set/Get name resolution
        setname, getname = {}, {}
        for n in nodes:
            t = n.get("type")
            wv = n.get("widgets_values")
            name = (wv[0] if isinstance(wv, list) and wv else None) or n.get("title")
            if t == "SetNode":
                setname.setdefault(str(name), []).append(n.get("id"))
            elif t == "GetNode":
                getname[n.get("id")] = str(name)

        def real_sources(x, seen):
            if x in seen:
                return []
            seen.add(x)
            k = kind.get(x)
            if x == -10:
                return [-10]
            if k == "collapse":
                out = []
                if x in getname:
                    for s in setname.get(getname[x], []):
                        out += real_sources(s, seen)
                for s in srcs.get(x, []):
                    out += real_sources(s, seen)
                return out
            if k == "drop" or x not in gid and x != -10:
                return []
            return [x]
        entries, exits = [], []
        for tgt, os_ in srcs.items():
            if kind.get(tgt) in ("collapse", "drop"):
                continue
            for o in os_:
                for s in real_sources(o, set()):
                    if tgt == -20:
                        if s in gid:
                            exits.append(gid[s])
                    elif s == -10:
                        if tgt in gid:
                            entries.append(gid[tgt])
                    elif s in gid and tgt in gid:
                        self.g.edge(gid[s], gid[tgt], "data")
        # subgraph instances: inline definition once, wire entries/exits
        for n in nodes:
            t = str(n.get("type"))
            nid = n.get("id")
            if kind.get(nid) != "subgraph" or t not in self.defs:
                continue
            if t not in self.inlined:
                self.inlined[t] = ([], [])  # recursion guard
                d = self.defs[t]
                _, en, ex = self.graph(d.get("nodes", []), d.get("links", []), scope + 1)
                self.inlined[t] = (en, ex)
            en, ex = self.inlined[t]
            for e in en:
                self.g.edge(gid[nid], e, "data")
            consumers = [e["to"] for e in self.g.edges if e["from"] == gid[nid] and e["kind"] == "data" and e["to"] not in en]
            for x in ex:
                for c in consumers:
                    self.g.edge(x, c, "data")
        return gid, entries, exits

    def loops(self):
        preds = {}
        for e in self.g.edges:
            preds.setdefault(e["to"], []).append(e["from"])
        for n in self.g.nodes:
            if n["category"] == "merge" and "(loop close)" in n["summary"]:
                # nearest upstream loop-open node
                seen, frontier = set(), [n["id"]]
                found = None
                while frontier and not found:
                    nxt = []
                    for x in frontier:
                        for p in preds.get(x, []):
                            if p in seen:
                                continue
                            seen.add(p)
                            if self.g.cat(p) == "loop":
                                found = p
                                break
                            nxt.append(p)
                        if found:
                            break
                    frontier = nxt
                if found:
                    self.g.edge(n["id"], found, "loop")


def collect_defs(d):
    defs = {}

    def walk(x):
        for sg in ((x.get("definitions") or {}).get("subgraphs") or []):
            if isinstance(sg, dict) and sg.get("id"):
                defs[sg["id"]] = sg
                walk(sg)
    walk(d)
    return defs


def domains_of(types, providers, media):
    s = " ".join(types)
    d = set()
    rules = [("image-generation", r"KSampler|SamplerCustom|EmptyLatentImage|EmptySD3LatentImage|Flux|SDXL|Image\w*Node"),
             ("video-generation", r"Video|Wan|LTXV|Hunyuan(?!3D)|AnimateDiff|ADE_|SVD|CogVideo|Kling|Luma|Runway|Vidu|Hailuo"),
             ("audio", r"Audio|TTS|Whisper|AceStep|Chatterbox|Music"), ("3d", r"3D|Mesh|GLB|Tripo|Rodin|Meshy|Gaussian|Splat"),
             ("llm", r"LLM|Ollama|TextGenerate|Gemini(?!Image)Node|Claude|OpenAIChat|QwenVL|Florence2"),
             ("upscaling", r"Upscale|SeedVR2|SUPIR"), ("inpainting", r"Inpaint|Outpaint|Mask"),
             ("controlnet", r"ControlNet|Preprocessor|Canny|Depth|OpenPose|DWPose|Lineart"),
             ("face", r"Face|InstantID|PuLID|ReActor|LivePortrait"), ("image-editing", r"Edit|Kontext|Qwen.*Edit|Relight|LayerStyle|LayerUtility")]
    for name, rx in rules:
        if re.search(rx, s):
            d.add(name)
    if media:
        d.add(f"{media}-generation" if media in ("image", "video") else media)
    if providers:
        d.add("hosted-model-api")
    return sorted(d) or ["image-generation"]


def load_sources():
    """Yield (path, meta) for every workflow JSON candidate with its source metadata."""
    man = {e["repo"]: e for e in json.load(open(os.path.join(ROOT, "git-manifest.json"))) if e.get("outcome") == "acquired"}
    for repo, e in man.items():
        base = e["localPath"]
        for p in sorted(glob.glob(os.path.join(base, "**", "*.json"), recursive=True)):
            rel = os.path.relpath(p, base)
            if rel.startswith(".git/") or os.path.basename(p).startswith("index") and repo == "Comfy-Org/workflow_templates":
                continue
            yield p, {"kind": "git", "repo": repo, "rel": rel, "sha": e["sha"], "date": e.get("commitDate"),
                      "license": e.get("license", "unknown"), "licenseEvidence": e.get("licenseEvidence", ""),
                      "registryLicense": e.get("registryLicense"), "role": e.get("role")}
    for e in json.load(open(os.path.join(ROOT, "hf-manifest.json"))):
        if "WorkflowLLM" in e["repo"]:
            continue
        for f in e["files"]:
            if f["file"].endswith(".json"):
                yield os.path.join(e["localPath"], f["file"]), {
                    "kind": "hf", "repo": e["repo"], "rel": f["file"], "sha": e["revision"], "date": e.get("lastModified"),
                    "license": {"mit": "MIT", "apache-2.0": "Apache-2.0"}.get(e.get("licenseTag") or "", e.get("licenseTag") or "unknown"),
                    "licenseEvidence": (f"HF dataset card licence tag '{e['licenseTag']}' at {e['revision']}" if e.get("licenseTag")
                                        else f"no licence tag or LICENSE file in HF dataset {e['repo']} at {e['revision']}"),
                    "role": "HF ComfyUI workflow collection"}


REDISTRIBUTABLE = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "Unlicense", "CC0-1.0", "CC-BY-4.0",
                   "GPL-3.0", "GPL-2.0", "AGPL-3.0", "LGPL-3.0", "LGPL-2.1", "MPL-2.0"}


def template_index():
    p = os.path.join(ROOT, "git", "Comfy-Org__workflow_templates", "templates", "index.json")
    out = {}
    if os.path.exists(p):
        for cat in json.load(open(p)):
            for t in cat.get("templates", []):
                out[t["name"]] = dict(t, category=cat.get("category"), group=cat.get("title"))
    return out


def main():
    idx = template_index()
    items, seen_hash, stats = [], set(), {"files": 0, "notworkflow": 0, "dup": 0, "empty": 0}
    for path, meta in load_sources():
        stats["files"] += 1
        try:
            raw = open(path, "rb").read()
            d = json.loads(raw)
        except Exception:
            stats["notworkflow"] += 1
            continue
        h = cc.sha_prefix(raw)
        if h in seen_hash:
            stats["dup"] += 1
            continue
        if isinstance(d, dict) and isinstance(d.get("nodes"), list):
            fmt = "ui"
            defs = collect_defs(d)
            conv = Conv(defs)
            conv.graph(d["nodes"], d.get("links", []), 0)
        elif isinstance(d, dict) and d and all(isinstance(v, dict) and "class_type" in v for v in d.values()):
            fmt = "api"
            conv = Conv({})
            nodes = [{"id": k, "type": v["class_type"], "mode": 0} for k, v in d.items()]
            links = []
            for k, v in d.items():
                for inp in (v.get("inputs") or {}).values():
                    if isinstance(inp, list) and len(inp) == 2 and isinstance(inp[0], (str, int)) and str(inp[0]) in d:
                        links.append([None, str(inp[0]), inp[1], k, 0])
            conv.graph(nodes, links, 0)
        else:
            stats["notworkflow"] += 1
            continue
        conv.loops()
        g = conv.g
        if len(g.nodes) < 2:
            stats["empty"] += 1
            continue
        seen_hash.add(h)
        name = os.path.splitext(os.path.basename(path))[0]
        tmeta = idx.get(name) if meta["repo"] == "Comfy-Org/workflow_templates" and meta["rel"].startswith("templates/") else None
        connectors = sorted({"api:" + p for p in conv.providers} | conv.packs)
        media = (tmeta or {}).get("mediaType")
        f = cc.compute_features(g, async_kinds=conv.asyncs, connectors=connectors, has_code=conv.has_code,
                                domains=domains_of(conv.types, conv.providers, media))
        needs = []
        if conv.instance_count or any(n["category"] == "subworkflow" for n in g.nodes):
            needs.append("subworkflow-call")
        if len(g.nodes) > 500:
            needs.append("split-over-500-nodes")
        notes = ("Heuristic verdict (consumer-creative-comfyui.py), not a compiled IR. A ComfyUI graph is a static "
                 "dataflow DAG: each node maps to an IR task bound to a ComfyUI node executor and links to `needs`; "
                 "switch nodes with lazy inputs map to `when` guards; loop open/close pairs (execution-inversion "
                 "graph expansion) map to IR loop. Requires GPU + pinned model weights + the custom-node packs listed "
                 "in connectors (executor concern, not IR).")
        if conv.instance_count:
            notes += f" {conv.instance_count} subgraph instance(s) of {len(conv.inlined)} definition(s); inlinable at compile time."
        if "poll" in conv.asyncs:
            notes += " Hosted generation nodes poll a remote job until done (task with timeout/retry; >1h jobs would exceed IR timeoutMs)."
        muted = sum(1 for n in g.nodes if n["summary"].endswith("(bypassed)") or n["summary"].endswith("(muted)"))
        if muted:
            notes += f" {muted} node(s) are bypassed/muted in the saved graph (design-time toggles)."
        lic = meta["license"]
        if lic in ("unknown", "LicenseRef-unrecognised") and meta.get("registryLicense"):
            reg = meta["registryLicense"]
            m = re.search(r'"text"\s*:\s*"([^"]+)"', reg or "")
            if m and m.group(1).strip().upper() in ("MIT", "APACHE-2.0", "GPL-3.0", "GPL-3.0-ONLY", "AGPL-3.0"):
                lic = {"MIT": "MIT", "APACHE-2.0": "Apache-2.0", "GPL-3.0": "GPL-3.0", "GPL-3.0-ONLY": "GPL-3.0",
                       "AGPL-3.0": "AGPL-3.0"}[m.group(1).strip().upper()]
                meta["licenseEvidence"] += f"; ComfyUI registry declares {m.group(1)}"
        redis = lic in REDISTRIBUTABLE
        if meta["kind"] == "git":
            url = f"https://github.com/{meta['repo']}/blob/{meta['sha']}/{meta['rel']}"
            rev = f"git {meta['sha']} ({meta.get('date')}); file {h}"
        else:
            url = f"https://huggingface.co/datasets/{meta['repo']}/blob/{meta['sha']}/{meta['rel']}"
            rev = f"hf {meta['repo']}@{meta['sha']}; file {h}"
        if tmeta and tmeta.get("description"):
            desc, prov = tmeta["description"], "original"
            title = tmeta.get("title") or name
        else:
            title = (d.get("extra") or {}).get("title") if isinstance(d.get("extra"), dict) else None
            title = title or name.replace("_", " ")
            desc = (f"ComfyUI {fmt}-format workflow from {meta['repo']} ({meta['role']}): {len(g.nodes)} nodes"
                    f"{', ' + str(conv.instance_count) + ' subgraph instances' if conv.instance_count else ''}"
                    f"{', hosted APIs: ' + ', '.join(sorted(conv.providers)) if conv.providers else ''}.")
            prov = "written"
        oracle_notes = "No executable oracle shipped with the source item."
        if tmeta:
            outs = (tmeta.get("io") or {}).get("outputs") or []
            oracle_notes = (f"Template declares output node(s) {[o.get('nodeType') for o in outs][:4]} and ships a reference output "
                            f"thumbnail; generative outputs are not deterministic, so there is no equivalence oracle.")
        if meta["repo"] == "xxyQwQ/ComfyBench":
            oracle_notes = ("ComfyBench curriculum workflow (reference design, not a task). ComfyBench tasks are judged by "
                            "execution pass and a VLM resolve judgment; no per-workflow oracle.")
        rid = re.sub(r"[^A-Za-z0-9_.-]+", "-", f"{meta['repo']}/{meta['rel']}")[:150]
        item = cc.make_item(
            iid=f"comfyui:{rid}", platform="comfyui", url=url, revision=rev, license=lic,
            license_evidence=meta["licenseEvidence"], redistributable=redis, raw_path=path,
            title=title, description=desc if (redis or prov == "written") else desc, desc_provenance=prov,
            graph=g, features=f, verdict=cc.verdict_from(needs), ir_notes=notes, oracle_notes=oracle_notes,
            extra={"repo": meta["repo"], "fmt": fmt, "score": cc.complexity(f), "template": bool(tmeta),
                   "usage": (tmeta or {}).get("usage"), "openSource": (tmeta or {}).get("openSource")})
        if not redis and prov == "original":
            item["description"] = {"text": f"ComfyUI workflow ({len(g.nodes)} nodes).", "provenance": "written"}
        errs = cc.validate(item)
        if errs:
            print("invalid", path, errs[:3])
            continue
        items.append(item)
    cc.write_jsonl(OUT, items)
    stats["items"] = len(items)
    json.dump(stats, open(OUT.replace(".candidates.jsonl", ".report.json"), "w"), indent=1)
    print(stats, "items", len(items), "->", OUT)


if __name__ == "__main__":
    main()
