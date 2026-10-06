#!/usr/bin/env python3
"""Fetch GitLab CI configuration of public GitLab projects through the GitLab REST API v4.

For each <instance> <project path>: project metadata (?license=true, licensee-detected licence),
default-branch commit SHA, .gitlab-ci.yml at that SHA, then `include: local:` files (explicit
paths and globs, resolved with the repository tree API) recursively up to depth 4. Also used to
fetch GitLab's own CI templates directory (lib/gitlab/ci/templates) from gitlab-org/gitlab.
Files land in /opt/corpus/gitlab-ci/<instance>__<path>@<sha>/...; a manifest JSON per project.
Data only: nothing fetched is executed.

Usage: python3 -I orchestration-fetch-gitlab.py projects <list-file>     (lines: instance path)
       python3 -I orchestration-fetch-gitlab.py templates
"""
import fnmatch, hashlib, json, os, re, sys, time, urllib.parse, urllib.request, urllib.error, datetime
import yaml

OUT = "/opt/corpus/gitlab-ci"


class L(yaml.SafeLoader):
    pass


def _tag(loader, suffix, node):
    if isinstance(node, yaml.SequenceNode):
        return {"!" + suffix: loader.construct_sequence(node, deep=True)}
    if isinstance(node, yaml.MappingNode):
        return {"!" + suffix: loader.construct_mapping(node, deep=True)}
    return {"!" + suffix: loader.construct_scalar(node)}


L.add_multi_constructor("!", _tag)


def api(inst, path, raw=False):
    url = f"https://{inst}/api/v4/{path}"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "foundry-corpus/1"}), timeout=60) as r:
                data = r.read()
                return data if raw else json.loads(data)
        except urllib.error.HTTPError as e:
            if e.code in (404, 403, 401):
                return None
            time.sleep(2 * (attempt + 1))
        except Exception:
            time.sleep(2 * (attempt + 1))
    return None


def tree(inst, pid, sha, path, recursive):
    out, page = [], 1
    while page < 60:
        q = urllib.parse.urlencode({"path": path, "ref": sha, "recursive": str(recursive).lower(), "per_page": 100, "page": page})
        res = api(inst, f"projects/{pid}/repository/tree?{q}")
        if not res:
            break
        out += [e["path"] for e in res if e.get("type") == "blob"]
        if len(res) < 100:
            break
        page += 1
    return out


def raw(inst, pid, sha, path):
    return api(inst, f"projects/{pid}/repository/files/{urllib.parse.quote(path, safe='')}/raw?ref={sha}", raw=True)


def local_includes(doc):
    inc = doc.get("include") if isinstance(doc, dict) else None
    out = []
    for x in (inc if isinstance(inc, list) else [inc] if inc else []):
        if isinstance(x, str):
            if not re.match(r"https?://", x):
                out.append(x)
        elif isinstance(x, dict) and "local" in x:
            out.append(x["local"])
    return [o.lstrip("/") for o in out if isinstance(o, str)]


def fetch_project(inst, path):
    meta = api(inst, f"projects/{urllib.parse.quote(path, safe='')}?license=true")
    if not meta:
        return {"instance": inst, "path": path, "outcome": "not found"}
    pid, br = meta["id"], meta.get("default_branch")
    commit = api(inst, f"projects/{pid}/repository/commits/{urllib.parse.quote(br or 'HEAD', safe='')}")
    if not commit:
        return {"instance": inst, "path": path, "outcome": "no commit"}
    sha = commit["id"]
    cfg_path = meta.get("ci_config_path") or ".gitlab-ci.yml"
    if "@" in cfg_path or cfg_path.startswith("http"):
        cfg_path = ".gitlab-ci.yml"
    base = f"{OUT}/{inst}__{path.replace('/', '__')}@{sha}"
    files, queue, seen, depth = [], [(cfg_path, 0)], set(), {}
    while queue:
        p, d = queue.pop(0)
        if p in seen or d > 4 or len(files) > 400:
            continue
        seen.add(p)
        if any(ch in p for ch in "*?["):
            prefix = p.split("*")[0].rsplit("/", 1)[0] if "/" in p.split("*")[0] else ""
            cands = tree(inst, pid, sha, prefix, "**" in p or p.count("/") > prefix.count("/") + 1)
            for c in cands:
                if fnmatch.fnmatch(c, p) or fnmatch.fnmatch(c, p.replace("**/", "")):
                    queue.append((c, d))
            continue
        data = raw(inst, pid, sha, p)
        if data is None:
            files.append({"path": p, "outcome": "404"}); continue
        dest = f"{base}/{p}"
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        open(dest, "wb").write(data)
        files.append({"path": p, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "depth": d})
        try:
            for doc in yaml.load_all(data.decode("utf-8", "replace"), Loader=L):
                for inc in local_includes(doc):
                    queue.append((inc, d + 1))
        except Exception as e:
            files[-1]["yamlError"] = str(e)[:200]
    lic = meta.get("license") or {}
    man = {"instance": inst, "path": path, "id": pid, "web_url": meta.get("web_url"), "default_branch": br,
           "sha": sha, "committed_date": commit.get("committed_date"), "stars": meta.get("star_count"),
           "license": {"key": lic.get("key"), "name": lic.get("name"), "nickname": lic.get("nickname"),
                       "source_url": lic.get("source_url")} if lic else None,
           "license_url": meta.get("license_url"), "ci_config_path": cfg_path, "files": files,
           "retrievedAt": datetime.date.today().isoformat(), "dir": base, "outcome": "acquired"}
    json.dump(man, open(base + ".manifest.json", "w"), indent=1)
    return man


def templates():
    inst, path = "gitlab.com", "gitlab-org/gitlab"
    meta = api(inst, f"projects/{urllib.parse.quote(path, safe='')}?license=true")
    pid = meta["id"]
    sha = api(inst, f"projects/{pid}/repository/commits/{meta['default_branch']}")["id"]
    base = f"{OUT}/templates__gitlab-org__gitlab@{sha}"
    paths = [p for p in tree(inst, pid, sha, "lib/gitlab/ci/templates", True) if p.endswith(".yml")]
    files = []
    for p in paths:
        dest = f"{base}/{p}"
        if not os.path.exists(dest):
            data = raw(inst, pid, sha, p)
            if data is None:
                files.append({"path": p, "outcome": "404"}); continue
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            open(dest, "wb").write(data)
        data = open(dest, "rb").read()
        files.append({"path": p, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    for lp in ("LICENSE",):
        data = raw(inst, pid, sha, lp)
        if data:
            open(f"{base}/LICENSE", "wb").write(data)
    lic = meta.get("license") or {}
    man = {"instance": inst, "path": path, "sha": sha, "license": lic, "files": files, "dir": base,
           "retrievedAt": datetime.date.today().isoformat()}
    json.dump(man, open(base + ".manifest.json", "w"), indent=1)
    print("templates", len(files), sha)


if __name__ == "__main__":
    if sys.argv[1] == "templates":
        templates()
    else:
        for ln in open(sys.argv[2]):
            ln = ln.strip()
            if not ln or ln.startswith("#"):
                continue
            inst, path = ln.split()
            m = fetch_project(inst, path)
            print(json.dumps({k: m.get(k) for k in ("instance", "path", "outcome", "sha", "stars")} | {"license": (m.get("license") or {}).get("key") if isinstance(m.get("license"), dict) else None, "files": len(m.get("files") or [])}), flush=True)
