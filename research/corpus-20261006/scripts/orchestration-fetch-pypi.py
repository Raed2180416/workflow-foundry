#!/usr/bin/env python3
"""Download PyPI sdists for the orchestration cluster (Airflow core + providers, Dagster, Prefect).

Only downloads archives; never extracts into an importable location, never runs setup hooks.
Writes /opt/corpus/<platform>/pypi-manifest.json with filename, version, sha256, url, licence fields.
Usage: python3 -I orchestration-fetch-pypi.py <platform> <package> [<package>...]
"""
import hashlib, json, os, sys, urllib.request, datetime

def fetch_json(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)

def main():
    platform, pkgs = sys.argv[1], sys.argv[2:]
    out = f"/opt/corpus/{platform}"
    os.makedirs(out, exist_ok=True)
    manifest_path = os.path.join(out, "pypi-manifest.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    for spec in pkgs:
        name, _, ver = spec.partition("==")
        meta = fetch_json(f"https://pypi.org/pypi/{name}/{ver + '/' if ver else ''}json")
        info = meta["info"]
        sd = [u for u in meta["urls"] if u["packagetype"] == "sdist"]
        if not sd:
            manifest[spec] = {"package": name, "version": info["version"], "outcome": "no sdist"}
            print(spec, "no sdist"); continue
        u = sd[0]
        dest = os.path.join(out, u["filename"])
        if not os.path.exists(dest):
            urllib.request.urlretrieve(u["url"], dest)
        h = hashlib.sha256(open(dest, "rb").read()).hexdigest()
        assert h == u["digests"]["sha256"], f"sha mismatch {spec}"
        manifest[spec] = {"package": name, "version": info["version"], "filename": u["filename"],
                          "url": u["url"], "sha256": h, "uploadTime": u.get("upload_time_iso_8601"),
                          "license": info.get("license"), "licenseExpression": info.get("license_expression"),
                          "classifiers": [c for c in info.get("classifiers") or [] if c.startswith("License")],
                          "retrievedAt": datetime.date.today().isoformat(), "outcome": "acquired"}
        print(spec, info["version"], u["filename"], u["size"])
    json.dump(manifest, open(manifest_path, "w"), indent=1, sort_keys=True)

if __name__ == "__main__":
    main()
