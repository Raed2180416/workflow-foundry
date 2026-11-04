# AgentDojo acquisition under decision D16 (research/decisions-20261021.md; research/breadth-20261021/agentdojo/ACQUISITION.md).
#
# Reads the hash-pinned lock (research/breadth-20261021/agentdojo/requirements.lock.txt: `uv pip compile --python-version
# 3.12 --only-binary :all: --generate-hashes`), asks PyPI's JSON API for each pinned release, picks the ONE wheel whose
# sha256 is in the lock and whose tags this interpreter accepts (best tag first, as pip/uv would), downloads it, checks
# the sha256 and records URL, sha256, size, licence fields and date. Nothing is installed here; the install is
#   uv pip install --python <venv>/bin/python --no-deps --only-binary :all: --require-hashes --no-index --find-links <wheels> -r <lock>
# (a wheel install runs no package hook). Stdlib only, plus pip's vendored `packaging` of the target interpreter.
#
#   /usr/bin/python3.12 -I acquire.py <lock> <out-dir>      -> <out-dir>/wheels/*.whl, <out-dir>/downloads.json
import hashlib, json, os, re, sys, time, urllib.request
from pip._vendor.packaging import tags as ptags
from pip._vendor.packaging.utils import parse_wheel_filename

def parse_lock(text):
    out, cur = [], None
    for line in text.splitlines():
        m = re.match(r'^([A-Za-z0-9_.\-]+)==([^\s\\]+)', line)
        if m:
            cur = {'name': m.group(1), 'version': m.group(2), 'hashes': []}
            out.append(cur)
            continue
        h = re.search(r'--hash=sha256:([0-9a-f]{64})', line)
        if h and cur is not None:
            cur['hashes'].append(h.group(1))
    return out

def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read()
        except Exception as e:  # network hiccup: retry, then fail loudly
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))

def main(lock_path, out_dir):
    pins = parse_lock(open(lock_path, encoding='utf-8').read())
    rank = {t: i for i, t in enumerate(ptags.sys_tags())}
    wheels = os.path.join(out_dir, 'wheels')
    os.makedirs(wheels, exist_ok=True)
    rows = []
    for p in pins:
        meta = json.loads(get(f"https://pypi.org/pypi/{p['name']}/{p['version']}/json"))
        info = meta['info']
        best = None
        for f in meta['urls']:
            if f['packagetype'] != 'bdist_wheel' or f['digests']['sha256'] not in p['hashes']:
                continue
            _, _, _, ftags = parse_wheel_filename(f['filename'])
            r = min((rank[t] for t in ftags if t in rank), default=None)
            if r is not None and (best is None or r < best[0]):
                best = (r, f)
        if best is None:
            raise SystemExit(f"no compatible locked wheel for {p['name']}=={p['version']}")
        f = best[1]
        dest = os.path.join(wheels, f['filename'])
        data = get(f['url'])
        sha = hashlib.sha256(data).hexdigest()
        if sha != f['digests']['sha256'] or sha not in p['hashes']:
            raise SystemExit(f"sha256 mismatch for {f['filename']}")
        with open(dest, 'wb') as fh:
            fh.write(data)
        lic_cls = [c for c in info.get('classifiers') or [] if c.startswith('License ::')]
        rows.append({'name': p['name'], 'version': p['version'], 'filename': f['filename'], 'url': f['url'], 'sha256': sha, 'bytes': len(data),
                     'license_expression': info.get('license_expression'), 'license': (info.get('license') or '')[:120] or None,
                     'license_classifiers': lic_cls, 'upload_time': f.get('upload_time_iso_8601'),
                     'fetched_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
        print(f"{p['name']}=={p['version']} {f['filename']} {len(data)} {sha[:12]}", flush=True)
    rec = {'lock': os.path.basename(lock_path), 'lock_sha256': hashlib.sha256(open(lock_path, 'rb').read()).hexdigest(),
           'interpreter': sys.version.split()[0], 'count': len(rows), 'total_bytes': sum(r['bytes'] for r in rows), 'wheels': rows}
    with open(os.path.join(out_dir, 'downloads.json'), 'w', encoding='utf-8') as fh:
        json.dump(rec, fh, indent=1)
    print(json.dumps({'count': rec['count'], 'total_bytes': rec['total_bytes']}))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
