#!/usr/bin/env python3
"""WorkflowHub acquisition for the science cluster.

Stage `meta`: GET https://workflowhub.eu/workflows.json (all ids) and every
https://workflowhub.eu/workflows/<id>.json into /opt/corpus/workflowhub/meta/<id>.json.
Stage `select`: candidate ids -> /opt/corpus/workflowhub/candidates.json (all CWL, Snakemake, WDL and
non-nf-core Nextflow entries; the 90 largest Galaxy entries by step count that are not IWC duplicates).
Stage `files`: for each candidate's latest version:
  * git-backed version (`remote` + `commit` in the record): shallow, blob:none, sparse clone of the remote
    at that commit into /opt/corpus/workflowhub/git/<id> with only workflow-definition paths checked out
    (*.cwl *.ga *.gxwf.yml *.smk Snakefile *.nf *.config *.wdl *.yml *.yaml nextflow_schema.json LICENSE*),
  * otherwise: the version's RO-Crate (https://workflowhub.eu/workflows/<id>/ro_crate?version=<v>), streamed
    with a 25 MB cap (larger crates are recorded as `too-large`, not downloaded), and only
    workflow-definition files unpacked into /opt/corpus/workflowhub/x/<id>/ (zip-slip guarded).
Nothing is executed.
Per-workflow licence comes from the metadata record's `license` attribute.
Stage `crate-meta`: /workflows/<id>/ro_crate_metadata?version=<v> (JSON-LD only) -> crate-meta/<id>-v<v>.json.
Stage `gitapi`: entries whose version lives in WorkflowHub-hosted git (commit, no remote; the crate endpoint
answered with an HTML page) are fetched file-by-file through the WorkflowHub git tree/raw API.
Usage: python3 -I science-fetch-workflowhub.py meta|select|files|crate-meta|gitapi
"""
import concurrent.futures as cf, glob, json, os, re, subprocess, sys, time, urllib.error, urllib.request, zipfile

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


GIT = ["git", "-c", "core.hooksPath=/dev/null", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.required=false",
       "-c", "protocol.file.allow=never"]
SPARSE = ["*.cwl", "*.ga", "*.gxwf.yml", "*.smk", "Snakefile", "snakefile", "*.nf", "*.config", "*.wdl", "*.yml", "*.yaml",
          "nextflow_schema.json", "/LICENSE*", "/LICENCE*", "/COPYING*", "/ro-crate-metadata.json", "!*test*data*/", "!**/data/"]
CAP = 25 * 1024 * 1024


def select():
    iwc = glob.glob("/opt/corpus/galaxy/iwc/workflows/**/*.ga", recursive=True)
    iwc_dirs = {os.path.basename(os.path.dirname(f)).lower() for f in iwc}
    iwc_names = {json.load(open(f)).get("name", "").strip().lower() for f in iwc}
    cands, gal = [], []
    for f in glob.glob(f"{ROOT}/meta/*.json"):
        d = json.load(open(f))["data"]
        a = d["attributes"]
        wc = (a.get("workflow_class") or {}).get("key")
        rem = [v.get("remote") for v in (a.get("versions") or []) if v.get("remote")]
        r = rem[-1] if rem else ""
        t = a["title"].strip()
        v = a.get("latest_version") or (a.get("versions") or [{}])[-1].get("version")
        if wc == "galaxy":
            m = re.match(r"^([\w.-]+)/main$", t)
            if (m and m.group(1).lower() in iwc_dirs) or t.lower() in iwc_names or "galaxyproject/iwc" in r:
                continue
            gal.append((len((a.get("internals") or {}).get("steps") or []), d["id"], v))
        elif wc in ("cwl", "snakemake", "workflow_description_language") or (wc == "nextflow" and "nf-core/" not in r and not t.startswith("nf-core/")):
            cands.append({"id": d["id"], "version": v, "class": wc})
    gal.sort(reverse=True)
    cands += [{"id": i, "version": v, "class": "galaxy", "steps": n} for n, i, v in gal[:90]]
    json.dump(cands, open(f"{ROOT}/candidates.json", "w"), indent=0)
    print(len(cands), "candidates")


def stream_capped(url, path):
    req = urllib.request.Request(url, headers={"User-Agent": "foundry-corpus/1 (research corpus)", "Accept": "application/zip, */*"})
    with urllib.request.urlopen(req, timeout=300) as r:
        cl = r.headers.get("Content-Length")
        if cl and int(cl) > CAP:
            return "too-large"
        n = 0
        with open(path + ".part", "wb") as fh:
            while True:
                b = r.read(1 << 20)
                if not b:
                    break
                n += len(b)
                if n > CAP:
                    fh.close()
                    os.remove(path + ".part")
                    return "too-large"
                fh.write(b)
    os.replace(path + ".part", path)
    return "ok"


def unpack(z, dest):
    dest = os.path.realpath(dest)
    os.makedirs(dest, exist_ok=True)
    n = 0
    with zipfile.ZipFile(z) as zf:
        for info in zf.infolist():
            if info.is_dir() or info.file_size > 5_000_000 or not KEEP.search(info.filename):
                continue
            target = os.path.realpath(os.path.join(dest, info.filename))
            if not target.startswith(dest + os.sep):
                continue  # zip-slip guard
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with zf.open(info) as src, open(target, "wb") as fh:
                fh.write(src.read())
            n += 1
    return n


def files():
    cands = json.load(open(f"{ROOT}/candidates.json"))
    os.makedirs(f"{ROOT}/crates", exist_ok=True)

    def one(c):
        i, v = c["id"], c["version"]
        meta = json.load(open(f"{ROOT}/meta/{i}.json"))["data"]["attributes"]
        ver = next((x for x in meta.get("versions") or [] if str(x.get("version")) == str(v)), (meta.get("versions") or [{}])[-1])
        rec = {"id": i, "version": v, "class": c["class"]}
        if ver.get("remote") and ver.get("commit"):
            d = f"{ROOT}/git/{i}"
            if os.path.exists(f"{d}.files.json") and os.path.isdir(f"{d}/.git"):
                rec.update(status="ok", via="git", remote=ver["remote"], commit=ver["commit"], path=d)
                return rec
            try:
                if not os.path.isdir(f"{d}/.git"):
                    os.makedirs(d, exist_ok=True)
                    subprocess.run(GIT + ["init", "-q", d], check=True)
                    subprocess.run(GIT + ["-C", d, "remote", "add", "origin", ver["remote"]], check=True)
                subprocess.run(GIT + ["-C", d, "sparse-checkout", "set", "--no-cone", *SPARSE], check=True)
                subprocess.run(GIT + ["-C", d, "fetch", "-q", "--depth", "1", "--filter=blob:none", "--no-recurse-submodules",
                                      "origin", ver["commit"]], check=True, timeout=600, capture_output=True)
                subprocess.run(GIT + ["-C", d, "checkout", "-q", "FETCH_HEAD"], check=True, timeout=900)
                fl = subprocess.run(["git", "-C", d, "ls-tree", "-r", "--name-only", "HEAD"], capture_output=True, text=True).stdout.split("\n")
                json.dump([f for f in fl if f], open(f"{d}.files.json", "w"))
                rec.update(status="ok", via="git", remote=ver["remote"], commit=ver["commit"], path=d)
            except Exception as e:
                rec.update(status=f"git-error: {str(e)[:160]}", via="git", remote=ver.get("remote"), commit=ver.get("commit"))
            return rec
        z = f"{ROOT}/crates/{i}-v{v}.zip"
        st = "ok" if os.path.exists(z) else None
        for attempt in range(3):
            if st == "ok":
                break
            try:
                st = stream_capped(f"{BASE}/workflows/{i}/ro_crate?version={v}", z)
            except Exception as e:
                st = f"download-error: {str(e)[:120]}"
                time.sleep(5 * (attempt + 1))
            if st == "too-large":
                break
        if st != "ok":
            rec.update(status=st, via="crate")
            return rec
        try:
            n = unpack(z, f"{ROOT}/x/{i}")
            rec.update(status="ok", via="crate", files=n, path=f"{ROOT}/x/{i}")
        except zipfile.BadZipFile:
            rec.update(status="bad-zip", via="crate")
        return rec

    with cf.ThreadPoolExecutor(4) as ex:
        out = list(ex.map(one, cands))
    json.dump(out, open(f"{ROOT}/files-manifest.json", "w"), indent=1)
    import collections
    print(collections.Counter((o["via"], o["status"].split(":")[0]) for o in out))


def crate_meta():
    """RO-Crate metadata (JSON-LD only, no payload) of each candidate's latest version: gives the main
    workflow path (mainEntity) inside git-backed repositories and any TestSuite/TestDefinition entities."""
    cands = json.load(open(f"{ROOT}/candidates.json"))
    os.makedirs(f"{ROOT}/crate-meta", exist_ok=True)

    def one(c):
        p = f"{ROOT}/crate-meta/{c['id']}-v{c['version']}.json"
        if os.path.exists(p):
            return "cached"
        b = get(f"{BASE}/workflows/{c['id']}/ro_crate_metadata?version={c['version']}")
        if not b:
            return "missing"
        open(p, "wb").write(b)
        return "ok"

    with cf.ThreadPoolExecutor(4) as ex:
        res = list(ex.map(one, cands))
    import collections
    print(collections.Counter(res))


def gitapi():
    """Versions hosted in WorkflowHub's own git (commit but no remote): walk /workflows/<id>/git/<v>/tree[/<path>]
    and fetch matching definition files from /workflows/<id>/git/<v>/raw/<path> (<=300 tree entries, <=5 MB each)."""
    man = json.load(open(f"{ROOT}/files-manifest.json"))
    changed = 0
    for rec in man:
        if rec["status"] not in ("bad-zip",) and not rec["status"].startswith("download-error"):
            continue
        i, v = rec["id"], rec["version"]
        meta = json.load(open(f"{ROOT}/meta/{i}.json"))["data"]["attributes"]
        ver = next((x for x in meta.get("versions") or [] if str(x.get("version")) == str(v)), {})
        if not ver.get("commit"):
            continue
        dest = os.path.realpath(f"{ROOT}/x/{i}")
        todo, seen, n, listing = [""], 0, 0, []
        while todo and seen < 300:
            path = todo.pop()
            b = get(f"{BASE}/workflows/{i}/git/{v}/tree" + (f"/{path}" if path else ""))
            if not b:
                continue
            try:
                tree = json.loads(b).get("tree") or []
            except Exception:
                continue
            for e in tree:
                seen += 1
                if e.get("type") == "tree":
                    todo.append(e["path"])
                elif e.get("type") == "blob":
                    listing.append(e["path"])
                    if KEEP.search(e["path"]):
                        raw = get(f"{BASE}/workflows/{i}/git/{v}/raw/{e['path']}", accept="*/*")
                        if raw is not None and len(raw) <= 5_000_000:
                            t = os.path.realpath(os.path.join(dest, e["path"]))
                            if t.startswith(dest + os.sep):
                                os.makedirs(os.path.dirname(t), exist_ok=True)
                                open(t, "wb").write(raw)
                                n += 1
        z = f"{ROOT}/crates/{i}-v{v}.zip"
        if os.path.exists(z) and not zipfile.is_zipfile(z):
            os.remove(z)          # an HTML page saved by the crate stage, not a crate
        if n:
            json.dump(listing, open(f"{dest}.files.json", "w"))
            rec.update(status="ok", via="workflowhub-git", files=n, commit=ver.get("commit"), path=dest)
            changed += 1
        else:
            rec.update(status="no-files-via-git-api", via="workflowhub-git")
    json.dump(man, open(f"{ROOT}/files-manifest.json", "w"), indent=1)
    print(changed, "entries recovered via the WorkflowHub git API")


if __name__ == "__main__":
    {"meta": meta, "crates": crates, "select": select, "files": files, "crate-meta": crate_meta, "gitapi": gitapi}[sys.argv[1]]()
