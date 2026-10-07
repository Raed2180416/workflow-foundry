#!/usr/bin/env python3
"""Render research/corpus-20261006/parts/consumer-creative-ledger.md from the acquisition manifests under
/opt/corpus/{apple-shortcuts,comfyui,home-assistant,ifttt}/, the converter reports and the selection stats
written by consumer-creative-assemble.py. Prose is fixed text in this script; every number and source row
is computed from those files.

  python3 -I consumer-creative-ledger.py
"""
import collections, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
PARTS = os.path.join(os.path.dirname(HERE), "parts")
OUT = os.path.join(PARTS, "consumer-creative-ledger.md")
W = "/opt/corpus/consumer-work"
ITEMS = [json.loads(l) for l in open(os.path.join(PARTS, "consumer-creative.jsonl"), encoding="utf-8")]
S = json.load(open(f"{W}/stats.json"))
STRATA = json.load(open(f"{W}/strata.json"))


def j(p):
    return json.load(open(p))


def rep(name):
    p = f"{W}/{name}.report.json"
    return j(p) if os.path.exists(p) else {}


def row(*c):
    return "| " + " | ".join(str(x).replace("|", "\\|").replace("\n", " ") for x in c) + " |"


def counts(d, n=None):
    items = sorted(d.items(), key=lambda kv: (-kv[1], str(kv[0])))
    return ", ".join(f"{k} {v}" for k, v in (items[:n] if n else items))


HF = {e["repo"]: e for e in j("/opt/corpus/comfyui/hf-manifest.json")}
CGIT = j("/opt/corpus/comfyui/git-manifest.json")
HGIT = j("/opt/corpus/home-assistant/git-manifest.json")
FORUM = j("/opt/corpus/home-assistant/forum-manifest.json")
ICL = j("/opt/corpus/apple-shortcuts/icloud-manifest.json")
IFM = j("/opt/corpus/ifttt/fetch-meta.json")
R_SC, R_NAT, R_CF, R_HA, R_IF = rep("apple-shortcuts"), rep("apple-shortcuts-native"), rep("comfyui"), rep("home-assistant"), rep("ifttt")
PLAT = ["apple-shortcuts", "comfyui", "home-assistant", "ifttt"]
by_plat = collections.defaultdict(list)
for i in ITEMS:
    by_plat[i["source"]["platform"]].append(i)
cand_by_src = {p: S[p]["candidatesBySource"] for p in PLAT}

L = []
w = L.append
n_red = sum(1 for i in ITEMS if i["source"]["redistributable"])
w("# Consumer-creative cluster: acquisition ledger (corpus-20261006)")
w("")
w("Cluster scope: consumer and creative workflow graphs: Apple Shortcuts, ComfyUI node graphs, Home Assistant "
  "automations/scripts/blueprints, plus IFTTT applets as a small supplementary consumer-automation source (not one of "
  "the three sources named for this cluster; kept to 25 items, graph-only). Items: `parts/consumer-creative.jsonl` "
  "(`foundry-corpus-item/1`). Raw downloads only under `/opt/corpus/{apple-shortcuts,comfyui,home-assistant,ifttt}` and "
  "working files under `/opt/corpus/consumer-work` (outside git). Converters and fetchers: `scripts/consumer-creative-*.py`.")
w("")
w("All corpus content was treated as untrusted data and nothing downloaded was executed: ComfyUI and IFTTT pages were parsed "
  "as JSON / with regexes, Home Assistant YAML with a PyYAML `SafeLoader` subclass that turns every custom tag (`!input`, "
  "`!secret`, `!include`) into an inert placeholder, native shortcuts with `plistlib`, the WorkflowLLM pseudo-Python "
  "transcriptions with a tolerant line/indent parser (never `exec`/`eval`/`import`), and `statistics.pkl` with an "
  "Unpickler whose `find_class` admits only builtin container types. Git clones were shallow, blobless and sparse with "
  "hooks, LFS and submodules disabled. No instruction found inside corpus text was followed.")
w("")
w(f"Retrieved 2026-10-06 (licence re-check and selection 2026-10-07). Status: **development/diagnostic corpus**, not "
  f"sealed evaluation data. Total selected: **{len(ITEMS)}** items; **{n_red}** redistributable as normalised graphs, "
  f"**{len(ITEMS) - n_red}** not (unknown licence, non-commercial licence or terms of service). For non-redistributable "
  "items git keeps only the URL, title, a written description, the derived graph (node types, categories, effects, "
  "type-level summaries; no prompts, entity ids, message text or code) and the features.")
w("")
w("## Reproduction")
w("")
w("```sh")
w("S=research/corpus-20261006/scripts; V=/opt/corpus/.venv-consumer/bin/python   # uv venv, pyyaml==6.0.3 (consumer-creative-requirements.txt)")
w("python3 -I $S/consumer-creative-fetch-hf.py                 # WorkflowLLM + 3 HF ComfyUI collections at pinned revisions")
w("python3 -I $S/consumer-creative-fetch-git.py comfy-core      # Comfy-Org/workflow_templates, ComfyBench, execution-inversion demo")
w("python3 -I $S/consumer-creative-fetch-git.py comfy-registry 60   # example workflows of the most-downloaded registry node packs")
w("python3 -I $S/consumer-creative-fetch-git.py ha && python3 -I $S/consumer-creative-fetch-git.py ha-docs")
w("python3 -I $S/consumer-creative-fetch-haforum.py 5          # Blueprint Exchange all-time top topics (250)")
w("python3 -I $S/consumer-creative-fetch-icloud.py 120         # native .plist of iCloud links cited in WorkflowLLM seeds")
w("python3 -I $S/consumer-creative-ifttt.py fetch 300")
w("python3 -I $S/consumer-creative-shortcuts.py; python3 -I $S/consumer-creative-shortcuts-native.py")
w("python3 -I $S/consumer-creative-comfyui.py; $V -I $S/consumer-creative-homeassistant.py; python3 -I $S/consumer-creative-ifttt.py normalize")
w("python3 -I $S/consumer-creative-assemble.py && python3 -I $S/consumer-creative-ledger.py")
w("```")
w("")
w("Live sources (Blueprint Exchange, iCloud share records, IFTTT pages, the ComfyUI registry listing) will differ on a "
  "later date; each item's `source.revision` pins a git SHA, HF revision, iCloud `recordChangeTag` or the sha256 prefix of "
  "the raw bytes actually used.")
w("")
w("## Selection")
w("")
w("`consumer-creative-assemble.py` (deterministic). Per platform, in order: **coverage** (each named acquisition source "
  "that would otherwise be missing gets its top items: ComfyBench, the three HF ComfyUI collections, HA docs examples, "
  "Blueprint Exchange, EPMatt blueprints, native iCloud shortcuts); **complex** (top by the complexity score "
  "`nodes + 2*branching + 3*loops + 4*humanSteps + 2*subworkflows + 2*|async| + 1.5*|connectors| + 3*hasCode + "
  "2*hasModelCalls`, with a per-source cap); **feature** (top-2 not yet selected for each of loops, human steps, model "
  "calls, code, sub-workflows, wait, poll, webhook, schedule, branching>=5); **representative** (uniform sample ordered by "
  "sha256('consumer-creative-20261006:'+id)). Near-duplicates are suppressed: identical node-type multiset and edge count, "
  "or within one source a weighted Jaccard >= 0.85 of node-type multisets at similar size (variant files such as the "
  "JakeUpgrade single-GPU/multi-GPU pairs), or for Apple Shortcuts the same normalised title. Graphs with fewer than 2 or "
  "more than 1000 nodes are not selected; the oversize ones stay in the candidate files and are listed below. The "
  "complexity-ranked strata over-represent very large consumer graphs on purpose; the representative stratum is the one "
  "to use for base rates.")
w("")
w("## Per-platform outcome")
w("")
w(row("platform", "units scanned", "converted candidates", "not converted", "selected (strata)", "redistributable",
      "licences (selected)", "IR verdicts (selected)"))
w(row(*["---"] * 8))
units = {
    "apple-shortcuts": (f"{R_SC.get('seed', '?')} WorkflowLLM seeds + {sum(1 for r in ICL['records'] if r.get('outcome') == 'acquired')} native plists",
                        f"{R_SC.get('parseFailures', 0)} parse failures, {R_SC.get('emptyGraphs', '?')} empty graphs; native: {len(R_NAT.get('tooSmall', []))} one-action, {len(R_NAT.get('unparseable', []))} unparseable"),
    "comfyui": (f"{R_CF.get('files', '?')} JSON files",
                f"{R_CF.get('notworkflow', '?')} not a workflow, {R_CF.get('dup', '?')} byte-identical duplicates, {R_CF.get('empty', '?')} <2 nodes"),
    "home-assistant": (f"{R_HA.get('objects', '?')} automations/scripts/blueprints found",
                       f"{R_HA.get('objects', 0) - R_HA.get('unique', 0)} identical graphs within a repo dropped"),
    "ifttt": (f"{R_IF.get('pages', '?')} applet pages", f"{len(R_IF.get('noSteps', []))} without parseable steps"),
}
for p in PLAT:
    st = S[p]
    w(row(p, units[p][0], st["candidates"], units[p][1],
          f"{st['selected']} ({counts(st['strata'])})", st["redistributable"], counts(st["licenses"]), counts(st["verdicts"])))
w("")
w("## Feature totals over the selected items")
w("")
for p in PLAT:
    st = S[p]
    its = by_plat[p]
    nodes = sum(i["features"]["nodeCount"] for i in its)
    edges = sum(i["features"]["edgeCount"] for i in its)
    w(f"- **{p}**: nodes {nodes}, edges {edges} (per item min/median/max {st['nodeCount']['min']}/{st['nodeCount']['median']}/"
      f"{st['nodeCount']['max']}); items with loops {st['withLoops']}, human steps {st['withHuman']}, model calls "
      f"{st['withModel']}, code {st['withCode']}, sub-workflow calls {st['withSubworkflow']}; async (items) "
      f"{counts(st['async']) or 'none'}; extensions needed: {counts(st['extensions']) or 'none'}")
dom = collections.Counter(d for i in ITEMS for d in i["features"]["domains"])
w(f"- domains (items, all platforms): {counts(dom, 25)}")
w("")
w("IR verdicts are heuristic (`ir.notes` says so on every item); nothing here was compiled to the Foundry IR. Recurrent "
  "extension needs: triggers (`event-trigger`, `schedule-trigger`, `webhook-trigger`, `poll-trigger`), `signal-wait` "
  "(HA `wait_for_trigger`, Shortcuts `waittoreturn`), `durable-wait>1h`, HA run modes (`restart`/`queued`/`parallel`), "
  "`parametric-action-input` (blueprint `!input` used as a whole action list), `subworkflow-call` (Run Shortcut, "
  "`script.*`, ComfyUI subgraph instances) and `split-over-500-nodes`.")
w("")
w("## Sources tried")
w("")
w(row("#", "source", "URL / revision", "licence and evidence", "outcome", "redistributable"))
w(row(*["---"] * 6))
k = 0


def src(*c):
    global k
    k += 1
    w(row(k, *c))


wl = HF["openbmb/WorkflowLLM"]
src("WorkflowLLM / WorkflowBench (HF dataset)", f"{wl['url']} @ `{wl['revision']}` (data.zip sha256 "
    f"`{[f for f in wl['files'] if f['file'] == 'data.zip'][0]['sha256'][:12]}`)",
    "Apache-2.0: README.md at that revision ends with `license: apache-2.0` (front matter at the end, so the HF API shows "
    "no tag); github.com/OpenBMB/WorkflowLLM LICENSE @ 2b5a2dee5fef is Apache-2.0. Caveat: the seed shortcuts were "
    "collected from public sharing sites (RoutineHub key prefixes); original authors' terms not re-verified.",
    f"**acquired**. seed_data.json: {R_SC.get('seed')} real shortcuts transcribed to pseudo-Python, {R_SC.get('converted')} "
    f"converted. synthesized_data.json (model-synthesised) deliberately not used; API pickles not opened. "
    f"Selected {S['apple-shortcuts']['sources'].get('workflowllm', 0)}", "yes (description = WorkflowBench query, `recovered-by-model`)")
icl_out = collections.Counter(r.get("outcome", "?") for r in ICL["records"])
src("Native shortcuts behind iCloud links cited in the WorkflowLLM seeds",
    f"`https://www.icloud.com/shortcuts/api/records/<id>` -> unsigned `shortcut.plist`; {ICL['candidateIds']} distinct ids "
    f"cited, seeded sample of {ICL['sampled']}; per-item recordChangeTag",
    "unknown: shared by the author through iCloud; the record carries no licence (Apple iCloud terms)",
    f"**acquired** {icl_out.get('acquired', 0)}/{ICL['sampled']} ({counts({k2: v for k2, v in icl_out.items() if k2 != 'acquired'})}); "
    f"{R_NAT.get('items')} converted, {len(R_NAT.get('tooSmall', []))} one-action shortcuts skipped. Selected "
    f"{S['apple-shortcuts']['sources'].get('icloud', 0)}", "no")
for repo in ("NerdyRodent/NR-Flux-ComfyUI-Workflows", "Cseti/ComfyUI-Workflows", "Old-Fisherman/ComfyUI_Workflows"):
    e = HF[repo]
    lic = e.get("licenseTag")
    src(f"HF ComfyUI collection {repo}", f"{e['url']} @ `{e['revision'][:12]}`",
        f"{lic} (HF dataset card licence tag)" if lic else "unknown (no licence tag or LICENSE file)",
        f"**acquired** {sum(1 for f in e['files'] if f['file'].endswith('.json'))} JSON; {cand_by_src['comfyui'].get(repo, 0)} "
        f"converted; selected {S['comfyui']['sources'].get(repo, 0)}", "yes" if lic in ("mit", "apache-2.0") else "no")
for e in CGIT:
    if e.get("role") in ("official templates + subgraph blueprints", "ComfyBench curriculum workflows + task instructions",
                         "execution-inversion (loops / lazy eval) demo workflows"):
        n = cand_by_src["comfyui"].get(e["repo"], 0)
        extra = ""
        if e["repo"] == "xxyQwQ/ComfyBench":
            extra = (" Only the 20 curriculum workflows ship as JSON; the 200 benchmark tasks (instruction/complete.json) "
                     "have instructions but no reference workflow, so they are not items.")
        if e["repo"].startswith("BadCafeCode"):
            extra = " No workflow JSON at that SHA (README only), so no loop-node examples from it."
        src(f"{e['repo']} ({e['role']})", f"{e['url']} @ `{e.get('sha', '')[:12]}` ({e.get('commitDate')})",
            f"{e.get('license')} ({e.get('licenseEvidence', '')[:60]})", f"**{e['outcome']}**; {n} converted; selected "
            f"{S['comfyui']['sources'].get(e['repo'], 0)}.{extra}", "yes" if e.get("license") in ("MIT", "Apache-2.0", "GPL-3.0") else "no")
reg = [e for e in CGIT if e.get("role", "").startswith("registry node pack")]
reg_ok = [e for e in reg if e.get("outcome") == "acquired"]
reg_lic = collections.Counter(e.get("license") for e in reg_ok)
src("ComfyUI registry node packs (example workflows)", "`https://api.comfy.org/nodes` listing (cached registry-nodes.json), "
    f"top packs by downloads with a GitHub repo; {len(reg)} repos tried, each pinned to its HEAD SHA",
    f"per repo LICENSE at the pinned SHA ({counts(reg_lic)}); registry licence field used only when the repo has none",
    f"**{len(reg_ok)} acquired**, {sum(1 for e in reg if e.get('outcome') == 'no example workflow JSON')} without example "
    f"workflow JSON, {sum(1 for e in reg if str(e.get('outcome', '')).startswith('failed'))} failed (below). "
    f"{sum(v for r, v in cand_by_src['comfyui'].items() if r in {e['repo'] for e in reg_ok})} converted",
    "yes for MIT/Apache-2.0/GPL repos, no for unknown")
ha_core = [e for e in HGIT if e["repo"] == "home-assistant/core"][0]
for e in HGIT:
    if e["repo"] == "home-assistant/home-assistant.io":
        src("Home Assistant docs examples (automation, scripts, blueprint, cookbook)", f"{e['url']} @ `{e['sha'][:12]}`",
            f"{e['license']} ({e['licenseEvidence'][:50]}); non-commercial, treated as not redistributable",
            f"**acquired**; {R_HA.get('bySource', {}).get('docs', '?')} YAML examples converted; selected "
            f"{S['home-assistant']['sources'].get('home-assistant/home-assistant.io', 0) + S['home-assistant']['sources'].get('docs', 0)}", "no")
cfg = [e for e in HGIT if e["repo"] not in ("home-assistant/home-assistant.io",)]
cfg_rows = ", ".join(f"{e['repo']}@{e['sha'][:8]} {e.get('license')} ({cand_by_src['home-assistant'].get(e['repo'], 0)})" for e in cfg)
src("Home Assistant blueprints and public configs (git)", "shallow sparse clones (YAML only); repo@SHA licence (candidates): " + cfg_rows,
    "LICENSE at each pinned SHA; repos without one are `unknown`",
    f"**acquired** {len(cfg)} repos; {R_HA.get('bySource', {}).get('git', '?')} unique automations/scripts/blueprints. "
    "frenck/home-assistant-config and mf-social/Home-Assistant hold no automations at the pinned SHAs (0 candidates)",
    "MIT/Apache-2.0/GPL-3.0 yes; unknown no")
f_out = collections.Counter(r.get("outcome") for r in FORUM)
f_via = collections.Counter(r.get("via") for r in FORUM if r.get("outcome") == "acquired")
f_lic = collections.Counter(r.get("license") for r in FORUM if r.get("outcome") == "acquired")
src("Home Assistant Blueprint Exchange (Discourse category 53, all-time top)",
    "`community.home-assistant.io/c/blueprints-exchange/53/l/top.json?period=all&page=0..4` + `/t/<id>.json`; blueprint "
    "import URL resolved like HA's importer (GitHub blob pinned via `git ls-remote`, gist raw, or forum code block)",
    f"per item: GitHub LICENSE at the pinned SHA, gists `unknown`, forum-inline CC-BY-NC-SA-3.0 (forum ToS §3); acquired "
    f"licences: {counts(f_lic)}",
    f"**{f_out.get('acquired', 0)} of {len(FORUM)} topics acquired** ({counts(f_via)}); {f_out.get('no blueprint YAML found', 0)} "
    f"without blueprint YAML; {R_HA.get('bySource', {}).get('forum', '?')} converted; selected {S['home-assistant']['sources'].get('forum', 0)}",
    "MIT/Apache-2.0/GPL yes; gist/unknown and CC-BY-NC-SA no")
src("IFTTT published applets (supplementary)", f"`https://ifttt.com/sitemap_applets.xml` ({IFM['sitemapUrls']} URLs), seeded "
    f"sample of {IFM['sampled']} pages at 1 req/s; robots.txt allows /applets/", "ToS:https://ifttt.com/terms (no licence "
    "grant; copying content requires consent)", f"**acquired** {R_IF.get('pages')} pages, {R_IF.get('items')} converted "
    f"(1 trigger, optional queries/filter code, 1..n actions); selected {S['ifttt']['selected']}", "no (URL, title, graph and features only)")
w("")
w("## Blocked, failed or not attempted")
w("")
for e in CGIT:
    if str(e.get("outcome", "")).startswith("failed"):
        w(f"- **{e['repo']}** (ComfyUI registry pack, {e.get('downloads')} downloads): anonymous `git clone` asks for credentials "
          "(`fatal: could not read Username`, re-probed 2026-10-07 with `git ls-remote`): the repository is not publicly "
          "reachable (removed, disabled or private). No substitute was taken.")
w("- **GitHub REST API** (`api.github.com`) for repositories outside this session is blocked by the proxy; repository "
  "metadata therefore comes from shallow blobless sparse clones, `git ls-remote` and LICENSE files read from the pinned tree "
  "or raw.githubusercontent.com. Licences are what the LICENSE file says; GitHub's licence detection was not consulted.")
w(f"- **iCloud share records**: {counts({k2: v for k2, v in icl_out.items() if k2 != 'acquired'})} of the {ICL['sampled']} sampled ids; "
  f"{ICL['candidateIds'] - ICL['sampled']} further cited ids were not fetched (sample cap). Signed (AEA) shortcut assets were not "
  "downloaded; only the unsigned plist variant was used.")
w(f"- **Blueprint Exchange**: {f_out.get('no blueprint YAML found', 0)} of the top {len(FORUM)} topics have no importable "
  "blueprint YAML: no blueprint import link and no YAML code block with `blueprint:` in the first post. Only the all-time "
  "top 250 topics were read.")
w("- **ComfyBench task set**: no reference workflows for the 200 tasks; ComfyBench evaluates by execution pass plus a VLM "
  "judgment, so no per-item oracle is available. Repository has no LICENSE (licence `unknown`).")
w("- **WorkflowLLM synthesised data** (`synthesized_data.json`, ~630 MB of model-generated workflows) was not used: it is "
  "synthetic, not observed workflows.")
w("- **Not attempted in this pass**: Apple's Shortcuts Gallery and RoutineHub directly (the WorkflowLLM seeds and their "
  "iCloud links already include RoutineHub-shared shortcuts), OpenArt / Civitai / comfyworkflows.com ComfyUI sharing "
  "sites, the Home Assistant Community Store and blueprint repositories beyond the 15 listed. Their terms and "
  "bulk-access options were not assessed.")
w("")
w("## Most complex selected items")
w("")
w(row("platform", "id", "title", "nodes", "edges", "branching", "loops", "human", "sub-wf", "async", "licence", "verdict"))
w(row(*["---"] * 12))
for p in PLAT:
    for t in S[p]["top"][:5]:
        f = t["f"]
        w(row(p, f"[{t['id'][:70]}]({t['url']})", t["title"][:60], f["nodeCount"], f["edgeCount"], f["branching"], f["loops"],
              f["humanSteps"], f["subworkflows"], ",".join(f["async"]) or "-", t["license"], t["verdict"]))
w("")
w("Oversize candidates (more than 1000 nodes; not selected, still in `/opt/corpus/consumer-work/*.candidates.jsonl`):")
w("")
for p in PLAT:
    for o in S[p].get("oversize", []):
        w(f"- {p}: [{o['title']}]({o['url']}): {o['nodeCount']} nodes")
w("")
w("## Caveats")
w("")
w("- WorkflowLLM items are graphs of a *transcription* (the dataset authors converted each shortcut plist to "
  "pseudo-Python and wrote a natural-language query with a model). Node order, branches and data references follow that "
  "transcription; variable plumbing (Get/Set Variable, Comment, Nothing) is folded into data edges. The native iCloud items "
  "come straight from the plist (WFControlFlowMode grouping, OutputUUID references) and are the cross-check for that path.")
w("- Home Assistant graphs inline YAML anchors/aliases and expand `choose`/`if`/`repeat`/`parallel`; where a file uses "
  "aliases the item notes say how many. Jinja templates are counted, not evaluated. Blueprint `!input` placeholders stay "
  "placeholders, so a blueprint graph is the template, not one instantiation.")
w("- ComfyUI graphs drop UI-only nodes (notes, labels, primitive widgets), collapse Reroute/SetNode/GetNode wires, inline "
  "each subgraph definition once (instances stay as `subworkflow` nodes wired to the inlined body), and keep bypassed/muted nodes (flagged in the summary). `hasModelCalls` is "
  "true for local diffusion/encoder/vision nodes as well as hosted API nodes; hosted ones are named in `connectors` as "
  "`api:<provider>`.")
w("- Node categories, effects and domains come from name-based rules in the converters, so they are approximate. Two "
  "misclassifications found while spot-checking (ComfyUI `...TextEncodeNode` matching the code rule; LivePortrait "
  "`ExpressionEditor` as code) were fixed before the final selection; others may remain.")
w("- No item has an executable oracle: Shortcuts run only on Apple devices, HA automations need a live instance (a "
  "mocked-execution oracle over HA's script engine is plausible future work), ComfyUI outputs are generative.")
w("")
open(OUT, "w", encoding="utf-8").write("\n".join(L) + "\n")
print("wrote", OUT, len(L), "lines")
