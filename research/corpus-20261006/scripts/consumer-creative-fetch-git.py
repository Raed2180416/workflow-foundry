"""Consumer-creative cluster: shallow, blobless, sparse git acquisitions (no LFS, no submodules,
no hooks, nothing executed). Writes /opt/corpus/<platform>/git-manifest.json with the pinned SHA,
commit date and licence evidence of every repository it touched.

  python3 -I consumer-creative-fetch-git.py comfy-core        # Comfy-Org templates + ComfyBench
  python3 -I consumer-creative-fetch-git.py comfy-registry 60 # top-N registry node packs' example workflows
  python3 -I consumer-creative-fetch-git.py ha                # Home Assistant core blueprints + configs
  python3 -I consumer-creative-fetch-git.py ha-docs           # home-assistant.io automation docs

Corpus content is untrusted data: it is only checked out and later parsed as JSON/YAML.
"""
import json, os, re, subprocess, sys, time, urllib.request

ROOT = "/opt/corpus"
ENV = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_LFS_SKIP_SMUDGE="1")
GIT = ["git", "-c", "core.hooksPath=/dev/null", "-c", "submodule.recurse=false",
       "-c", "protocol.file.allow=never", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.process=",
       "-c", "filter.lfs.required=false"]


def run(args, cwd=None, timeout=600, check=True):
    p = subprocess.run(GIT + args, cwd=cwd, env=ENV, capture_output=True, text=True, timeout=timeout)
    if check and p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {p.stderr.strip()[:300]}")
    return p.stdout


def http_get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "workflow-foundry-corpus/1 (research)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


LICENSE_NAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "license", "License.md",
                 "COPYING", "LICENSE-APACHE", "license.md", "license.txt"]


def spdx_guess(text):
    t = text[:4000].lower()
    if "apache license" in t and "version 2.0" in t:
        return "Apache-2.0"
    if "mit license" in t or ("permission is hereby granted, free of charge" in t):
        return "MIT"
    if "gnu affero general public license" in t:
        return "AGPL-3.0"
    if "gnu general public license" in t and "version 3" in t:
        return "GPL-3.0"
    if "gnu general public license" in t and "version 2" in t:
        return "GPL-2.0"
    if "gnu lesser general public license" in t:
        return "LGPL-3.0" if "version 3" in t else "LGPL-2.1"
    if "mozilla public license" in t:
        return "MPL-2.0"
    if "bsd 3-clause" in t or ("redistribution and use in source and binary forms" in t and "neither the name" in t):
        return "BSD-3-Clause"
    if "redistribution and use in source and binary forms" in t:
        return "BSD-2-Clause"
    if "unlicense" in t or "this is free and unencumbered software" in t:
        return "Unlicense"
    if "attribution-noncommercial-sharealike 4.0" in t:
        return "CC-BY-NC-SA-4.0"
    if "attribution-noncommercial 4.0" in t:
        return "CC-BY-NC-4.0"
    if "attribution 4.0" in t and "creative commons" in t:
        return "CC-BY-4.0"
    if "cc0" in t:
        return "CC0-1.0"
    return "LicenseRef-unrecognised"


def clone(url, dest, sparse_patterns):
    """Blobless, depth-1, sparse checkout of only the given (no-cone) patterns."""
    if not os.path.isdir(os.path.join(dest, ".git")):
        run(["clone", "--depth", "1", "--filter=blob:none", "--no-checkout", "--no-recurse-submodules",
             "-q", url, dest], timeout=900)
    run(["sparse-checkout", "init", "--no-cone"], cwd=dest)
    run(["sparse-checkout", "set", "--no-cone"] + sparse_patterns, cwd=dest)
    run(["reset", "-q", "--hard", "HEAD"], cwd=dest, timeout=1800)
    sha = run(["rev-parse", "HEAD"], cwd=dest).strip()
    date = run(["log", "-1", "--format=%cI"], cwd=dest).strip()
    return sha, date


def tree(dest):
    return run(["ls-tree", "-r", "--name-only", "HEAD"], cwd=dest).splitlines()


def licence_of(dest):
    names = set(tree(dest))
    for n in LICENSE_NAMES:
        if n in names:
            run(["sparse-checkout", "add", "/" + n], cwd=dest)
            p = os.path.join(dest, n)
            if os.path.exists(p):
                return spdx_guess(open(p, encoding="utf-8", errors="replace").read()), n
    return "unknown", "no LICENSE file at repo root"


def save_manifest(platform, entries):
    path = os.path.join(ROOT, platform, "git-manifest.json")
    old = {}
    if os.path.exists(path):
        old = {e["repo"]: e for e in json.load(open(path))}
    for e in entries:
        old[e["repo"]] = e
    json.dump(sorted(old.values(), key=lambda e: e["repo"]), open(path, "w"), indent=1)
    print("manifest", path, len(old))


def fetch_repo(platform, repo, patterns, role):
    dest = os.path.join(ROOT, platform, "git", repo.replace("/", "__"))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    url = f"https://github.com/{repo}"
    try:
        sha, date = clone(url, dest, patterns + ["/README.md"])
        lic, ev = licence_of(dest)
        n = len([f for f in tree(dest)])
        print(f"ok {repo} {sha[:12]} {lic}")
        return {"repo": repo, "url": url, "sha": sha, "commitDate": date, "license": lic,
                "licenseEvidence": f"{ev} @ {sha}", "localPath": dest, "patterns": patterns,
                "role": role, "treeFiles": n, "outcome": "acquired", "retrievedAt": time.strftime("%Y-%m-%d")}
    except Exception as ex:  # record the failure, keep going
        print(f"FAIL {repo}: {ex}")
        return {"repo": repo, "url": url, "outcome": f"failed: {str(ex)[:200]}", "role": role,
                "retrievedAt": time.strftime("%Y-%m-%d")}


def comfy_core():
    out = [
        fetch_repo("comfyui", "Comfy-Org/workflow_templates",
                   ["/templates/*.json", "/blueprints/*.json"], "official templates + subgraph blueprints"),
        fetch_repo("comfyui", "xxyQwQ/ComfyBench",
                   ["/dataset/benchmark/workflow/", "/dataset/benchmark/instruction/", "/assets/extension.md"],
                   "ComfyBench curriculum workflows + task instructions"),
        fetch_repo("comfyui", "BadCafeCode/execution-inversion-demo-comfyui",
                   ["*.json"], "execution-inversion (loops / lazy eval) demo workflows"),
    ]
    save_manifest("comfyui", out)


def registry_packs(limit_pages=60):
    """List every ComfyUI registry node pack (api.comfy.org), cached to disk."""
    cache = os.path.join(ROOT, "comfyui", "registry-nodes.json")
    if os.path.exists(cache):
        return json.load(open(cache))
    packs, page = [], 1
    while True:
        d = json.loads(http_get(f"https://api.comfy.org/nodes?page={page}&limit=100"))
        packs += d.get("nodes", [])
        if page >= d.get("totalPages", 0) or page >= limit_pages:
            break
        page += 1
        time.sleep(0.5)
    json.dump(packs, open(cache, "w"))
    return packs


WF_DIR = re.compile(r"(^|/)(example[_ -]?workflows?|examples?|workflows?|workflow_examples?|demo|samples?)(/|$)", re.I)


def comfy_registry(top_n):
    packs = registry_packs()
    packs = [p for p in packs if (p.get("repository") or "").startswith("https://github.com/")]
    packs.sort(key=lambda p: -(p.get("downloads") or 0))
    out, picked = [], 0
    for p in packs:
        if picked >= top_n:
            break
        repo = p["repository"].rstrip("/").removesuffix(".git").split("github.com/")[1]
        if repo.count("/") != 1 or repo.lower() in {"comfyanonymous/comfyui", "comfy-org/workflow_templates"}:
            continue
        dest = os.path.join(ROOT, "comfyui", "git", repo.replace("/", "__"))
        try:
            if not os.path.isdir(os.path.join(dest, ".git")):
                run(["clone", "--depth", "1", "--filter=blob:none", "--no-checkout", "--no-recurse-submodules",
                     "-q", f"https://github.com/{repo}", dest], timeout=600)
            files = [f for f in tree(dest) if f.lower().endswith(".json") and WF_DIR.search(f)
                     and not re.search(r"(package|tsconfig|node_list|extension-node-map|model-list|pyproject|locales?/)", f, re.I)]
        except Exception as ex:
            out.append({"repo": repo, "url": f"https://github.com/{repo}", "outcome": f"failed: {str(ex)[:200]}",
                        "role": "registry node pack", "registry": p.get("id"), "downloads": p.get("downloads")})
            continue
        if not files:
            # keep the empty clone small: nothing checked out; record and remove
            subprocess.run(["rm", "-rf", dest])
            out.append({"repo": repo, "url": f"https://github.com/{repo}", "outcome": "no example workflow JSON",
                        "role": "registry node pack", "registry": p.get("id"), "downloads": p.get("downloads")})
            continue
        e = fetch_repo("comfyui", repo, ["/" + f for f in files[:80]], "registry node pack example workflows")
        e.update({"registry": p.get("id"), "downloads": p.get("downloads"), "registryLicense": p.get("license"),
                  "workflowFiles": len(files)})
        out.append(e)
        picked += 1
    save_manifest("comfyui", out)


HA_REPOS = [
    # repo, sparse patterns, role
    ("home-assistant/core", ["/homeassistant/components/automation/blueprints/", "/homeassistant/components/script/blueprints/",
                             "/homeassistant/components/template/blueprints/"], "built-in blueprints"),
    ("EPMatt/awesome-ha-blueprints", ["/blueprints/**/*.yaml"], "curated blueprint collection"),
    ("frenck/home-assistant-config", ["/**/*.yaml"], "personal config"),
    ("CCOSTAN/Home-AssistantConfig", ["/config/**/*.yaml"], "personal config"),
    ("basnijholt/home-assistant-config", ["/*.yaml", "/**/*.yaml"], "personal config"),
    ("Burningstone91/smart-home-setup", ["/**/*.yaml"], "personal config"),
    ("geekofweek/homeassistant", ["/**/*.yaml"], "personal config"),
    ("bachya/smart-home", ["/**/*.yaml"], "personal config"),
    ("jazzyisj/home-assistant-config", ["/**/*.yaml"], "personal config"),
    ("SgtBatten/HA_blueprints", ["/**/*.yaml"], "blueprint collection"),
    ("Petro31/home-assistant-config", ["/**/*.yaml"], "personal config"),
    ("TheFes/HA-configuration", ["/**/*.yaml"], "personal config"),
    ("dannytsang/homeassistant-config", ["/**/*.yaml"], "personal config"),
    ("JamesMcCarthy79/Home-Assistant-Config", ["/**/*.yaml"], "personal config"),
    ("mf-social/Home-Assistant", ["/**/*.yaml"], "personal config"),
]


def ha():
    out = [fetch_repo("home-assistant", r, pats, role) for r, pats, role in HA_REPOS]
    save_manifest("home-assistant", out)


def ha_docs():
    out = [fetch_repo("home-assistant", "home-assistant/home-assistant.io",
                      ["/source/_docs/automation/", "/source/_docs/scripts.markdown", "/source/_docs/scripts/",
                       "/source/_docs/blueprint/", "/source/_cookbook/"], "official docs examples")]
    save_manifest("home-assistant", out)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "comfy-core":
        comfy_core()
    elif cmd == "comfy-registry":
        comfy_registry(int(sys.argv[2]) if len(sys.argv) > 2 else 60)
    elif cmd == "ha":
        ha()
    elif cmd == "ha-docs":
        ha_docs()
    else:
        sys.exit("unknown command")
