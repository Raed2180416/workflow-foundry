#!/usr/bin/env python3
"""WorkflowHub acquisition for the science cluster.

Stage `meta`: GET https://workflowhub.eu/workflows.json (all ids) and every
https://workflowhub.eu/workflows/<id>.json into /opt/corpus/workflowhub/meta/<id>.json.
Stage `crates`: for the candidate ids chosen by science-select-workflowhub (written to
/opt/corpus/workflowhub/candidates.json), download the RO-Crate of the latest version
(https://workflowhub.eu/workflows/<id>/ro_crate?version=<v>) to /opt/corpus/workflowhub/crates/<id>-v<v>.zip
and unpack only workflow-definition files (.ga, .cwl, .smk, Snakefile, .nf, .wdl, .json/.yml metadata,
LICENSE) into /opt/corpus/workflowhub/x/<id>/ (zip-slip guarded; nothing executed).
Per-workflow licence comes from the metadata record's `license` attribute.
Usage: python3 -I science-fetch-workflowhub.py meta|crates
"""
import concurrent.futures as cf, json, os, re, sys, time, urllib.error, urllib.request, zipfile

ROOT = "/opt/corpus/workflowhub"
BASE = "https://workflowhub.eu"
KEEP = re.compile(r"(?i)(\.ga|\.cwl|\.smk|snakefile|\.nf|\.wdl|\.config|\.ya?ml|\.json|license[^/]*|licence[^/]*|readme[^/]*)$")


def get(url, accept="application/json"):
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "foundry-corpus/1 (research corpus)", "Accept": accept})
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404, 410, 422):
                return None
            time.sleep(3 * (attempt + 1))
        except Exception:
            time.sleep(3 * (attempt + 1))
    return None


def meta():
    os.makedirs(f"{ROOT}/meta", exist_ok=True)
    lst = json.loads(get(f"{BASE}/workflows.json"))
    json.dump(lst, open(f"{ROOT}/workflows.json", "w"))
    ids = [d["id"] for d in lst["data"]]

    def one(i):
        p = f"{ROOT}/meta/{i}.json"
        if os.path.exists(p):
            return i, "cached"
        b = get(f"{BASE}/workflows/{i}.json")
        if b is None:
            return i, "missing"
        open(p, "wb").write(b)
        time.sleep(0.2)
        return i, "ok"

    with cf.ThreadPoolExecutor(4) as ex:
        res = list(ex.map(one, ids))
    print(len(ids), "ids;", sum(1 for _, s in res if s != "missing"), "metadata records")


def crates():
    cands = json.load(open(f"{ROOT}/candidates.json"))
    os.makedirs(f"{ROOT}/crates", exist_ok=True)
    out = []

    def one(c):
        i, v = c["id"], c["version"]
        z = f"{ROOT}/crates/{i}-v{v}.zip"
        if not os.path.exists(z):
            b = get(f"{BASE}/workflows/{i}/ro_crate?version={v}", accept="application/zip")
            if not b:
                return {"id": i, "version": v, "status": "download-failed"}
            open(z, "wb").write(b)
        dest = os.path.realpath(f"{ROOT}/x/{i}")
        os.makedirs(dest, exist_ok=True)
        n = 0
        try:
            with zipfile.ZipFile(z) as zf:
                for info in zf.infolist():
                    if info.is_dir() or info.file_size > 20_000_000 or not KEEP.search(info.filename):
                        continue
                    target = os.path.realpath(os.path.join(dest, info.filename))
                    if not target.startswith(dest + os.sep):
                        continue  # zip-slip guard
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    with zf.open(info) as src, open(target, "wb") as fh:
                        fh.write(src.read())
                    n += 1
        except zipfile.BadZipFile:
            return {"id": i, "version": v, "status": "bad-zip"}
        return {"id": i, "version": v, "status": "ok", "files": n}

    with cf.ThreadPoolExecutor(4) as ex:
        out = list(ex.map(one, cands))
    json.dump(out, open(f"{ROOT}/crates-manifest.json", "w"), indent=1)
    print(sum(1 for o in out if o["status"] == "ok"), "of", len(out), "crates unpacked")


if __name__ == "__main__":
    {"meta": meta, "crates": crates}[sys.argv[1]]()
