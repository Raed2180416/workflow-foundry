#!/usr/bin/env python3
"""Fetch selected files of a public GitHub repository without the (blocked) GitHub API.

Listing: Sourcegraph public GraphQL API (repository(name).commit(rev).tree(path, recursive)).
Content: raw.githubusercontent.com/<owner>/<repo>/<commit oid>/<path> (pinned to the oid).
Files land in /opt/corpus/<platform>/<owner>__<repo>@<oid>/<path>; a manifest JSON records the
oid, file list, sizes, sha256 and the licence file fetched from the same commit.
Downloaded files are data only; nothing is executed.

Usage: python3 -I orchestration-fetch-github.py <platform> <owner/repo> <tree-path> <regex> [rev] [max_files]
"""
import hashlib, json, os, re, sys, time, urllib.request, datetime

SG = "https://sourcegraph.com/.api/graphql"


def gql(query, variables):
    req = urllib.request.Request(SG, data=json.dumps({"query": query, "variables": variables}).encode(),
                                 headers={"Content-Type": "application/json", "User-Agent": "foundry-corpus/1"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except Exception as e:  # transient proxy resets
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))


def get(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "foundry-corpus/1"}), timeout=90) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if attempt == 3:
                raise
        except Exception:
            if attempt == 3:
                raise
        time.sleep(2 * (attempt + 1))


def main():
    platform, repo, tree_path, rx = sys.argv[1:5]
    rev = sys.argv[5] if len(sys.argv) > 5 else "HEAD"
    max_files = int(sys.argv[6]) if len(sys.argv) > 6 else 2000
    q = """query($name:String!,$rev:String!,$path:String!){ repository(name:$name){ commit(rev:$rev){ oid
           tree(path:$path){ entries(first: 20000, recursive: true){ path isDirectory ... on GitBlob { byteSize } } } } } }"""
    res = gql(q, {"name": f"github.com/{repo}", "rev": rev, "path": tree_path})
    commit = (((res.get("data") or {}).get("repository") or {}).get("commit") or {})
    if not commit:
        print(json.dumps({"repo": repo, "outcome": "not found", "response": str(res)[:300]})); return
    oid = commit["oid"]
    entries = [e for e in ((commit.get("tree") or {}).get("entries") or []) if not e["isDirectory"]]
    pat = re.compile(rx)
    sel = [e for e in entries if pat.search(e["path"])][:max_files]
    base = f"/opt/corpus/{platform}/{repo.replace('/', '__')}@{oid}"
    os.makedirs(base, exist_ok=True)
    files = []
    for e in sel:
        dest = os.path.join(base, e["path"])
        if not os.path.exists(dest):
            data = get(f"https://raw.githubusercontent.com/{repo}/{oid}/{e['path']}")
            if data is None:
                files.append({"path": e["path"], "outcome": "404"}); continue
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            open(dest, "wb").write(data)
        data = open(dest, "rb").read()
        files.append({"path": e["path"], "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    lic = None
    for cand in ("LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "LICENSE-APACHE", "LICENCE"):
        dest = os.path.join(base, cand)
        data = open(dest, "rb").read() if os.path.exists(dest) else get(f"https://raw.githubusercontent.com/{repo}/{oid}/{cand}")
        if data:
            open(dest, "wb").write(data)
            lic = {"path": cand, "sha256": hashlib.sha256(data).hexdigest(), "head": data[:200].decode("utf-8", "replace")}
            break
    man = {"repo": repo, "rev": rev, "oid": oid, "treePath": tree_path, "regex": rx, "listed": len(entries),
           "selected": len(sel), "files": files, "license": lic, "lister": "sourcegraph graphql",
           "content": "raw.githubusercontent.com", "retrievedAt": datetime.date.today().isoformat(), "dir": base}
    json.dump(man, open(base + ".manifest.json", "w"), indent=1)
    print(json.dumps({k: man[k] for k in ("repo", "oid", "listed", "selected")} | {"license": (lic or {}).get("path")}))


if __name__ == "__main__":
    main()
