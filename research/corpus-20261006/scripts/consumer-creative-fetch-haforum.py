"""Home Assistant Blueprint Exchange (community.home-assistant.io, Discourse) -> raw blueprint YAML.

  python3 -I consumer-creative-fetch-haforum.py [pages=5]

1. Lists the all-time top topics of category 53 (blueprints-exchange) via the public Discourse JSON
   (`/c/blueprints-exchange/53/l/top.json?period=all&page=N`, 50 per page). robots.txt (2026-10-06)
   allows /c/ and /t/ for `*`.
2. For each topic, reads the first post (`/t/<id>.json`) and takes the blueprint import URL
   (my.home-assistant.io blueprint_import link) or, failing that, the first YAML code block that
   contains `blueprint:`.
3. Resolves the import URL the way Home Assistant's importer does: GitHub blob -> raw.githubusercontent,
   gist -> gist.githubusercontent .../raw, community topic -> first code block of that topic.
4. Licence: GitHub-hosted -> LICENSE at the repo root (raw.githubusercontent, HEAD of the branch, SHA
   pinned with `git ls-remote`); gist -> unknown (gists carry no licence); forum-inline -> the forum's
   user-content licence CC-BY-NC-SA-3.0 (community.home-assistant.io/tos §3, read 2026-10-06).

Raw files: /opt/corpus/home-assistant/forum/<topic>.{json,yaml} + forum-manifest.json. Sleeps 1.5 s
between forum requests. Nothing downloaded is executed; YAML is parsed later with a safe loader.
"""
import html, json, os, re, subprocess, sys, time, urllib.parse, urllib.request

BASE = "https://community.home-assistant.io"
DEST = "/opt/corpus/home-assistant/forum"
UA = {"User-Agent": "workflow-foundry-corpus/1 (research; low rate)"}
LICENSE_NAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "license", "LICENSE.MD"]


def get(url, timeout=60):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def spdx_guess(text):
    t = text[:4000].lower()
    for spdx, keys in [("Apache-2.0", ["apache license", "version 2.0"]), ("MIT", ["permission is hereby granted, free of charge"]),
                       ("MIT", ["mit license"]), ("GPL-3.0", ["gnu general public license", "version 3"]),
                       ("GPL-2.0", ["gnu general public license", "version 2"]), ("Unlicense", ["unlicense"]),
                       ("CC-BY-NC-SA-4.0", ["attribution-noncommercial-sharealike 4.0"]), ("CC-BY-4.0", ["attribution 4.0"]),
                       ("BSD-3-Clause", ["redistribution and use", "neither the name"]), ("MPL-2.0", ["mozilla public license"]),
                       ("CC0-1.0", ["cc0"])]:
        if all(k in t for k in keys):
            return spdx
    return "LicenseRef-unrecognised"


_lic_cache = {}


def github_licence(owner, repo, branch):
    key = (owner, repo, branch)
    if key in _lic_cache:
        return _lic_cache[key]
    sha = None
    try:
        out = subprocess.run(["git", "ls-remote", f"https://github.com/{owner}/{repo}", f"refs/heads/{branch}", "HEAD"],
                             capture_output=True, text=True, timeout=40, env=dict(os.environ, GIT_TERMINAL_PROMPT="0")).stdout
        refs = dict((l.split("\t")[1], l.split("\t")[0]) for l in out.splitlines() if "\t" in l)
        sha = refs.get(f"refs/heads/{branch}") or refs.get("HEAD")
    except Exception:
        pass
    lic, ev = "unknown", f"no LICENSE file at github.com/{owner}/{repo} root"
    for n in LICENSE_NAMES:
        try:
            txt = get(f"https://raw.githubusercontent.com/{owner}/{repo}/{sha or branch}/{n}").decode("utf-8", "replace")
            lic, ev = spdx_guess(txt), f"github.com/{owner}/{repo}/{n} @ {sha or branch}"
            break
        except Exception:
            continue
    _lic_cache[key] = (lic, ev, sha)
    return _lic_cache[key]


CODE_RE = re.compile(r"<pre><code[^>]*>(.*?)</code></pre>", re.S)
IMPORT_RE = re.compile(r"blueprint_import/?\?blueprint_url=([^\"'&<> ]+)")


def first_blueprint_block(cooked):
    for m in CODE_RE.finditer(cooked):
        txt = html.unescape(re.sub(r"<[^>]+>", "", m.group(1)))
        if re.search(r"^\s*blueprint\s*:", txt, re.M):
            return txt
    return None


def resolve(bp_url):
    """-> (raw_url, host_kind, owner, repo, branch, path) or None"""
    u = urllib.parse.unquote(bp_url).strip()
    m = re.match(r"https?://github\.com/([^/]+)/([^/]+)/blob/([^/]+)/(.+)$", u)
    if m:
        o, r, b, p = m.groups()
        return f"https://raw.githubusercontent.com/{o}/{r}/{b}/{p}", "github", o, r, b, p
    m = re.match(r"https?://raw\.githubusercontent\.com/([^/]+)/([^/]+)/(?:refs/heads/)?([^/]+)/(.+)$", u)
    if m:
        o, r, b, p = m.groups()
        return u, "github", o, r, b, p
    m = re.match(r"https?://gist\.github(?:usercontent)?\.com/([^/]+)/([0-9a-f]+)", u)
    if m:
        return f"https://gist.githubusercontent.com/{m.group(1)}/{m.group(2)}/raw", "gist", m.group(1), m.group(2), None, None
    m = re.match(r"https?://community\.home-assistant\.io/t/(?:[^/]+/)?(\d+)", u)
    if m:
        return m.group(1), "forum", None, None, None, None
    return u, "other", None, None, None, None


def main():
    pages = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    os.makedirs(DEST, exist_ok=True)
    topics = []
    for p in range(pages):
        d = json.loads(get(f"{BASE}/c/blueprints-exchange/53/l/top.json?period=all&page={p}"))
        topics += d["topic_list"]["topics"]
        time.sleep(1.5)
    manifest = []
    for t in topics:
        tid = t["id"]
        rec = {"topic": tid, "slug": t.get("slug"), "title": t.get("title"), "likes": t.get("like_count"),
               "views": t.get("views"), "posts": t.get("posts_count"), "created": t.get("created_at"),
               "lastPosted": t.get("last_posted_at"), "url": f"{BASE}/t/{t.get('slug')}/{tid}"}
        jp = os.path.join(DEST, f"{tid}.json")
        try:
            if not os.path.exists(jp):
                open(jp, "wb").write(get(f"{BASE}/t/{tid}.json"))
                time.sleep(1.5)
            post = json.load(open(jp))["post_stream"]["posts"][0]
            cooked = post.get("cooked", "")
            rec["postUpdatedAt"] = post.get("updated_at")
            rec["postVersion"] = post.get("version")
            m = IMPORT_RE.search(cooked)
            yaml_text, how = None, None
            if m:
                raw_url, kind, o, r, b, path = resolve(html.unescape(m.group(1)))
                rec.update({"importUrl": urllib.parse.unquote(html.unescape(m.group(1))), "host": kind})
                if kind == "forum":
                    if str(raw_url) == str(tid):
                        yaml_text, how = first_blueprint_block(cooked), "forum-inline"
                    else:
                        other = json.loads(get(f"{BASE}/t/{raw_url}.json"))
                        time.sleep(1.5)
                        yaml_text, how = first_blueprint_block(other["post_stream"]["posts"][0].get("cooked", "")), "forum-inline"
                elif kind in ("github", "gist", "other"):
                    try:
                        yaml_text, how = get(raw_url).decode("utf-8", "replace"), kind
                        rec["rawUrl"] = raw_url
                    except Exception as ex:
                        rec["fetchError"] = str(ex)[:120]
                if kind == "github":
                    lic, ev, sha = github_licence(o, r, b)
                    rec.update({"license": lic, "licenseEvidence": ev, "sha": sha, "repo": f"{o}/{r}", "path": path, "branch": b})
            if yaml_text is None:
                yaml_text, how = first_blueprint_block(cooked), "forum-inline"
            if how == "forum-inline":
                rec.update({"license": "CC-BY-NC-SA-3.0",
                            "licenseEvidence": "community.home-assistant.io/tos §3 'User Content License' (read 2026-10-06)"})
            elif how == "gist":
                rec.update({"license": "unknown", "licenseEvidence": "GitHub gist: no licence file or field"})
            elif how == "other" and "license" not in rec:
                rec.update({"license": "unknown", "licenseEvidence": "non-GitHub host; no licence found"})
            if yaml_text and re.search(r"^\s*blueprint\s*:", yaml_text, re.M):
                yp = os.path.join(DEST, f"{tid}.yaml")
                open(yp, "w", encoding="utf-8").write(yaml_text)
                rec.update({"rawPath": yp, "via": how, "outcome": "acquired"})
            else:
                rec["outcome"] = "no blueprint YAML found"
        except Exception as ex:
            rec["outcome"] = f"failed: {str(ex)[:160]}"
        manifest.append(rec)
        print(tid, rec.get("outcome"), rec.get("via"), rec.get("license"))
    json.dump(manifest, open(os.path.join(DEST, "..", "forum-manifest.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
