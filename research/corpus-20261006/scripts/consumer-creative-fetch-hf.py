"""Consumer-creative cluster: Hugging Face dataset acquisitions at pinned revisions.

  python3 -I consumer-creative-fetch-hf.py

Downloads (raw, outside git):
  /opt/corpus/apple-shortcuts/workflowllm/{data.zip,README.md}   openbmb/WorkflowLLM
  /opt/corpus/comfyui/hf/<owner>__<name>/<file>.json            small ComfyUI workflow collections
and writes /opt/corpus/comfyui/hf-manifest.json (revision, licence tag, files). Files are only
downloaded and later parsed as JSON; nothing is executed. The WorkflowLLM pickles are never
unpickled with a permissive loader (see consumer-creative-shortcuts.py).
"""
import hashlib, json, os, time, urllib.parse, urllib.request

UA = {"User-Agent": "workflow-foundry-corpus/1 (research)"}
HF = "https://huggingface.co"

DATASETS = [
    # repo, pinned revision, target dir, file filter
    ("openbmb/WorkflowLLM", "d0de182c3f9abac5c4ded9ae2eadcd8155ee1435", "/opt/corpus/apple-shortcuts/workflowllm",
     lambda f: f in ("data.zip", "README.md")),
    ("NerdyRodent/NR-Flux-ComfyUI-Workflows", "16d5ff0700d77d00aa8864249e3580bce97636ce", None,
     lambda f: f.endswith(".json") or f == "README.md"),
    ("Cseti/ComfyUI-Workflows", "c36360bcb6222df315b5c3c1ed8bd60c6967bc5a", None,
     lambda f: f.endswith(".json") or f == "README.md"),
    ("Old-Fisherman/ComfyUI_Workflows", "e4124433cd98b681d104aa23af53f8152f2d9940", None,
     lambda f: f.endswith(".json") or f == "README.md"),
]


def get(url, timeout=600):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def main():
    manifest = []
    for repo, rev, target, keep in DATASETS:
        meta = json.loads(get(f"{HF}/api/datasets/{repo}/revision/{rev}"))
        files = [s["rfilename"] for s in meta.get("siblings", []) if keep(s["rfilename"])]
        dest = target or f"/opt/corpus/comfyui/hf/{repo.replace('/', '__')}"
        os.makedirs(dest, exist_ok=True)
        got = []
        for f in files:
            p = os.path.join(dest, f)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            if not os.path.exists(p):
                b = get(f"{HF}/datasets/{repo}/resolve/{rev}/{urllib.parse.quote(f)}")
                open(p, "wb").write(b)
                time.sleep(0.3)
            got.append({"file": f, "sha256": hashlib.sha256(open(p, "rb").read()).hexdigest()})
        lic = [t.split(":", 1)[1] for t in meta.get("tags", []) if t.startswith("license:")]
        manifest.append({"repo": repo, "revision": rev, "lastModified": meta.get("lastModified"),
                         "licenseTag": lic[0] if lic else None, "localPath": dest, "files": got,
                         "url": f"{HF}/datasets/{repo}", "retrievedAt": time.strftime("%Y-%m-%d")})
        print(repo, rev[:12], lic, len(got))
    json.dump(manifest, open("/opt/corpus/comfyui/hf-manifest.json", "w"), indent=1)


if __name__ == "__main__":
    main()
