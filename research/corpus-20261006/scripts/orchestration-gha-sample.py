#!/usr/bin/env python3
"""Sample GitHub Actions workflow files from the MSR'24 'dataset of GitHub Actions workflow
histories' (Zenodo concept 10259013, version 10.5281/zenodo.20340547, CC-BY-4.0) and fetch the
sampled file versions from raw.githubusercontent.com pinned at the recorded commit.

Step 1 (index): stream /opt/corpus/github-actions/workflows.csv.gz and keep, per (repository,
  file_path), the latest version (max committed_date) plus the number of commits touching it.
  Author/committer names and e-mails in the dataset are dropped and never written anywhere.
Step 2 (sample, seed 20261006): pool R = 220 uniformly random live, valid workflows (one per
  repo); pool C = 330 random live, valid workflows with >= 25 versions (heavily maintained files
  are more likely to be complex), one per repo, disjoint from R.
Step 3 (fetch): file at raw.githubusercontent.com/<repo>/<commit>/<path>; repository licence
  file at the same commit (LICENSE, LICENSE.md, LICENSE.txt, COPYING, ...), classified to SPDX by
  text heuristics in orchestration-gha.py.
Usage: python3 -I orchestration-gha-sample.py index|sample|fetch
"""
import csv, gzip, hashlib, io, json, os, random, sys, time, urllib.request, urllib.error

ROOT = "/opt/corpus/github-actions"
IDX = f"{ROOT}/latest-index.tsv.gz"
SAMPLE = f"{ROOT}/sample.json"
csv.field_size_limit(10**8)


def index():
    latest, counts = {}, {}
    with gzip.open(f"{ROOT}/workflows.csv.gz", "rt", encoding="utf-8", newline="") as fh:
        r = csv.DictReader(fh)
        for i, row in enumerate(r):
            key = (row["repository"], row["file_path"])
            counts[key] = counts.get(key, 0) + 1
            d = int(row["committed_date"] or 0)
            cur = latest.get(key)
            if cur is None or d > cur[1]:
                latest[key] = (row["commit_hash"], d, row["git_change_type"], row["valid_workflow"], row["file_hash"])
            if i % 1000000 == 0:
                print("rows", i, file=sys.stderr)
    with gzip.open(IDX, "wt", encoding="utf-8") as out:
        out.write("repository\tfile_path\tcommit\tcommitted_date\tchange\tvalid_workflow\tfile_hash\tversions\n")
        for (repo, path), (c, d, ch, v, h) in latest.items():
            out.write(f"{repo}\t{path}\t{c}\t{d}\t{ch}\t{v}\t{h}\t{counts[(repo, path)]}\n")
    print("files", len(latest))


def sample():
    rows = []
    with gzip.open(IDX, "rt", encoding="utf-8") as fh:
        next(fh)
        for ln in fh:
            repo, path, c, d, ch, v, h, n = ln.rstrip("\n").split("\t")
            if ch == "D" or v != "True" or not path.startswith(".github/workflows/"):
                continue
            rows.append((repo, path, c, int(d), int(n)))
    rng = random.Random(20261006)
    rng.shuffle(rows)
    seen, R, C = set(), [], []
    for r in rows:
        if len(R) < 220 and r[0] not in seen:
            R.append(r); seen.add(r[0])
    for r in rows:
        if len(C) < 330 and r[0] not in seen and r[4] >= 25:
            C.append(r); seen.add(r[0])
    out = [{"pool": "R", "repo": r[0], "path": r[1], "commit": r[2], "date": r[3], "versions": r[4]} for r in R] + \
          [{"pool": "C", "repo": r[0], "path": r[1], "commit": r[2], "date": r[3], "versions": r[4]} for r in C]
    json.dump({"seed": 20261006, "live_valid_files": len(rows), "sample": out}, open(SAMPLE, "w"), indent=0)
    print("live valid", len(rows), "R", len(R), "C", len(C))


def get(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "foundry-corpus/1"}), timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 400, 451):
                return None
        except Exception:
            pass
        time.sleep(1.5 * (attempt + 1))
    return None


def fetch():
    s = json.load(open(SAMPLE))
    for it in s["sample"]:
        base = f"{ROOT}/raw/{it['repo'].replace('/', '__')}@{it['commit']}"
        dest = f"{base}/{it['path']}"
        if not os.path.exists(dest) and not it.get("outcome"):
            data = get(f"https://raw.githubusercontent.com/{it['repo']}/{it['commit']}/{it['path']}")
            if data is None:
                it["outcome"] = "404"
            else:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                open(dest, "wb").write(data)
        if os.path.exists(dest):
            it["outcome"] = "acquired"
            it["rawPath"] = dest
            it["sha256"] = hashlib.sha256(open(dest, "rb").read()).hexdigest()
        if "license" not in it:
            it["license"] = None
            for cand in ("LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "LICENSE.rst", "license", "License", "LICENCE", "COPYING.md", "license.md", "LICENSE-MIT", "LICENSE-APACHE"):
                data = get(f"https://raw.githubusercontent.com/{it['repo']}/{it['commit']}/{cand}")
                if data:
                    os.makedirs(base, exist_ok=True)
                    open(f"{base}/__LICENSE__{cand.replace('/', '_')}", "wb").write(data)
                    it["license"] = {"file": cand, "path": f"{base}/__LICENSE__{cand.replace('/', '_')}"}
                    break
        json.dump(s, open(SAMPLE, "w"), indent=0)
    from collections import Counter
    print(Counter(i.get("outcome") for i in s["sample"]), Counter(bool(i.get("license")) for i in s["sample"]))


if __name__ == "__main__":
    {"index": index, "sample": sample, "fetch": fetch}[sys.argv[1]]()
