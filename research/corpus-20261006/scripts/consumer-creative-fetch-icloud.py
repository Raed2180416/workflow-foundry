"""Native Apple Shortcuts (.plist) for a seeded sample of iCloud share links referenced inside the
WorkflowLLM seed shortcuts (update checkers, companion shortcuts, "get the full version" links).

  python3 -I consumer-creative-fetch-icloud.py [N=120]

For each id: GET https://www.icloud.com/shortcuts/api/records/<id> (public share record, JSON), then
the unsigned `fields.shortcut.value.downloadURL` (binary plist). The signed (AEA) variant is not
downloaded. Raw files: /opt/corpus/apple-shortcuts/icloud/<id>.{record.json,plist}; manifest
icloud-manifest.json. ~1 request/second. Licence: none granted (shared by the author through iCloud;
Apple iCloud terms) -> redistributable:false. Plists are parsed later with plistlib only.
"""
import hashlib, json, os, re, sys, time, urllib.request, zipfile

RAW = "/opt/corpus/apple-shortcuts"
DEST = os.path.join(RAW, "icloud")
UA = {"User-Agent": "workflow-foundry-corpus/1 (research; 1 req/s)"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 120
    os.makedirs(DEST, exist_ok=True)
    with zipfile.ZipFile(os.path.join(RAW, "workflowllm", "data.zip")) as z:
        seed = json.loads(z.read("seed_data.json"))
    ids = sorted({m for e in seed for m in re.findall(r"icloud\.com/shortcuts/([0-9a-f]{32})", e["workflow_code"])})
    ids = sorted(ids, key=lambda i: hashlib.sha256(("icloud-20261006:" + i).encode()).hexdigest())[:n]
    man = []
    for sid in ids:
        rec = {"id": sid, "url": f"https://www.icloud.com/shortcuts/{sid}"}
        rp, pp = os.path.join(DEST, sid + ".record.json"), os.path.join(DEST, sid + ".plist")
        try:
            if not os.path.exists(rp):
                open(rp, "wb").write(get(f"https://www.icloud.com/shortcuts/api/records/{sid}"))
                time.sleep(1.0)
            r = json.load(open(rp))
            f = r.get("fields") or {}
            if not f:
                rec["outcome"] = "no record (deleted or unavailable)"
            else:
                rec.update({"name": (f.get("name") or {}).get("value"), "modified": (r.get("modified") or {}).get("timestamp"),
                            "created": (r.get("created") or {}).get("timestamp"), "recordChangeTag": r.get("recordChangeTag"),
                            "signingStatus": (f.get("signingStatus") or {}).get("value")})
                dl = ((f.get("shortcut") or {}).get("value") or {}).get("downloadURL")
                if dl and not os.path.exists(pp):
                    open(pp, "wb").write(get(dl.replace("${f}", "shortcut.plist")))
                    time.sleep(1.0)
                if os.path.exists(pp):
                    b = open(pp, "rb").read()
                    rec.update({"rawPath": pp, "sha256": hashlib.sha256(b).hexdigest(), "outcome": "acquired"})
                else:
                    rec["outcome"] = "no unsigned shortcut asset"
        except Exception as ex:
            rec["outcome"] = f"failed: {str(ex)[:120]}"
        man.append(rec)
        print(sid, rec["outcome"])
    json.dump({"candidateIds": len(set(m for e in seed for m in re.findall(r'icloud\.com/shortcuts/([0-9a-f]{32})', e['workflow_code']))),
               "sampled": len(ids), "records": man}, open(os.path.join(RAW, "icloud-manifest.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
