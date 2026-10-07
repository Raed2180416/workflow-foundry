#!/usr/bin/env python3
"""Dockstore acquisition for the science cluster (WDL emphasis; CWL/Nextflow/Galaxy on Dockstore are
already covered through WorkflowHub, IWC, nf-core and the GitHub clones).

Stage `list`:   GA4GH TRS v2 listing https://dockstore.org/api/ga4gh/trs/v2/tools?toolClass=Workflow&descriptorType=WDL
                (100 per page, all pages) -> /opt/corpus/dockstore/trs-wdl-<offset>.json
Stage `select`: drops test/demo organisations and sources acquired directly (broadinstitute/warp, ENCODE-DCC,
                gatk-workflows/gatk4-somatic-snvs-indels, iwc-workflows, nf-core), keeps at most 2 entries per
                organisation, preferring verified/production versions -> candidates.json (N, default 70)
Stage `files`:  for each candidate's chosen version: TRS /files listing, then PRIMARY/SECONDARY descriptors and
                TEST_FILEs (<=2 MB each) via .../PLAIN_WDL/descriptor/<relative path> into files/<n>/ (path-traversal
                guarded), plus the entry record /api/workflows/path/entry/<path>/published for licenseInformation.
Nothing is executed.  Usage: python3 -I science-fetch-dockstore.py list|select|files [N]
"""
import collections, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = "/opt/corpus/dockstore"
API = "https://dockstore.org/api"
SKIP_ORGS = {"DockstoreTestUser", "dockstore-testing", "denis-yuen", "DockstoreTestUser2", "dockstore", "garyluu", "ga4gh",
             "iwc-workflows", "nf-core", "ENCODE-DCC", "dockstore-personal-testing", "kathy-t", "david4096", "berebolledo",
             "abc-xzy", "Huangzehui", "briandoconnor"}
SEEN_REPOS = set()   # one entry per source repository name (forks/duplicates across organisations are skipped)
SKIP_NAMES = re.compile(r"(?i)^(warp/|gatk4-somatic-snvs-indels)|hello|whalesay|test|tutorial|example|demo|bootcamp|foobar|plenary|md5sum|_copy\b|^bwa$|^gatk4-1$")


def get(url, accept="application/json", raw=False):
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "foundry-corpus/1 (research corpus)", "Accept": accept})
            with urllib.request.urlopen(req, timeout=120) as r:
                b = r.read()
                return b if raw else json.loads(b)
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403, 404, 406):
                return None
        except Exception:
            pass
        time.sleep(2 * (attempt + 1))
    return None


def stage_list():
    off = 0
    while True:
        p = f"{ROOT}/trs-wdl-{off}.json"
        if not os.path.exists(p):
            d = get(f"{API}/ga4gh/trs/v2/tools?toolClass=Workflow&descriptorType=WDL&limit=100&offset={off}")
            if d is None:
                break
            json.dump(d, open(p, "w"))
        d = json.load(open(p))
        if not d:
            break
        off += 1
        if off > 200:
            break
    print(off, "pages")


def stage_select(n):
    tools = []
    for f in sorted(os.listdir(ROOT)):
        if f.startswith("trs-wdl-") and f.endswith(".json"):
            tools += json.load(open(os.path.join(ROOT, f)))
    per_org = collections.Counter()
    pick = []

    def score(t):
        vs = t.get("versions") or []
        return (any(v.get("verified") for v in vs), any(v.get("is_production") for v in vs), len(vs))

    for t in sorted(tools, key=score, reverse=True):
        org, name = t.get("organization") or "", t.get("name") or ""
        repo = name.split("/")[0].lower()
        if org in SKIP_ORGS or SKIP_NAMES.search(name) or per_org[org] >= 2:
            continue
        if (repo, name.lower()) in SEEN_REPOS or any(name.lower() == n for _, n in SEEN_REPOS):
            continue
        SEEN_REPOS.add((repo, name.lower()))
        if org == "broadinstitute" and name.startswith("warp"):
            continue
        vs = [v for v in t.get("versions") or [] if "WDL" in (v.get("descriptor_type") or [])]
        if not vs:
            continue
        v = next((x for x in vs if x.get("verified")), None) or next((x for x in vs if x.get("is_production")), None) or \
            next((x for x in vs if x.get("name") in ("master", "main")), None) or vs[0]
        pick.append({"id": t["id"], "organization": org, "name": name, "version": v["name"], "verified": bool(v.get("verified"))})
        per_org[org] += 1
        if len(pick) >= n:
            break
    json.dump(pick, open(f"{ROOT}/candidates.json", "w"), indent=1)
    print(len(pick), "candidates from", len(tools), "TRS WDL tools")


def stage_files():
    cands = json.load(open(f"{ROOT}/candidates.json"))
    out = []
    for k, c in enumerate(cands):
        tid = urllib.parse.quote(c["id"], safe="")
        ver = urllib.parse.quote(c["version"], safe="")
        listing = get(f"{API}/ga4gh/trs/v2/tools/{tid}/versions/{ver}/WDL/files")
        rec = dict(c, n=k)
        if not listing:
            rec["status"] = "no-files-listing"
            out.append(rec)
            continue
        dest = os.path.realpath(f"{ROOT}/files/{k}")
        os.makedirs(dest, exist_ok=True)
        got, primary, tests = 0, None, []
        for f in listing:
            path, ft = f.get("path") or "", f.get("file_type") or ""
            if ft == "TEST_FILE":
                tests.append(path)
            if ft not in ("PRIMARY_DESCRIPTOR", "SECONDARY_DESCRIPTOR", "TEST_FILE"):
                continue
            b = get(f"{API}/ga4gh/trs/v2/tools/{tid}/versions/{ver}/PLAIN_WDL/descriptor/{urllib.parse.quote(path.lstrip('/'), safe='/')}",
                    accept="text/plain", raw=True)
            if b is None or len(b) > 2_000_000:
                continue
            t = os.path.realpath(os.path.join(dest, path.lstrip("/")))
            if not t.startswith(dest + os.sep):
                continue
            os.makedirs(os.path.dirname(t), exist_ok=True)
            open(t, "wb").write(b)
            got += 1
            if ft == "PRIMARY_DESCRIPTOR":
                primary = path.lstrip("/")
        path_ = c["id"].replace("#workflow/", "")
        entry = get(f"{API}/workflows/path/entry/{urllib.parse.quote(path_, safe='')}/published")
        lic = ((entry or {}).get("licenseInformation") or {}).get("licenseName")
        commit = None
        for v in (entry or {}).get("workflowVersions") or []:
            if v.get("name") == c["version"]:
                commit = v.get("commitID")
        rec.update(status="ok" if primary else "no-primary", files=got, primary=primary, tests=tests, license=lic, commit=commit,
                   gitUrl=(entry or {}).get("gitUrl"), description=((entry or {}).get("description") or "")[:2000],
                   topic=(entry or {}).get("topicAutomatic") or (entry or {}).get("topicManual"), path=dest)
        out.append(rec)
        time.sleep(0.3)
    json.dump(out, open(f"{ROOT}/files-manifest.json", "w"), indent=1)
    print(collections.Counter(r["status"] for r in out))


if __name__ == "__main__":
    st = sys.argv[1]
    if st == "list":
        stage_list()
    elif st == "select":
        stage_select(int(sys.argv[2]) if len(sys.argv) > 2 else 70)
    elif st == "files":
        stage_files()
