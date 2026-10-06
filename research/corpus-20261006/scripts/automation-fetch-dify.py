#!/usr/bin/env python3
"""Acquire Dify DSL templates.
 (1) Dify marketplace template API (marketplace.dify.ai/api/v1/templates + /{id}/dsl)
 (2) Dify repo built-in recommended apps (api/constants/recommended_apps.json) at a pinned SHA via
     raw.githubusercontent.com (SHA resolved with `git ls-remote`).
Raw -> /opt/corpus/dify/. Untrusted data; listing contains creator e-mails, which never leave /opt.
Usage: python3 -I automation-fetch-dify.py <dify-sha>
"""
import gzip, json, os, sys, time, urllib.request

ROOT = '/opt/corpus/dify'
UA = {'User-Agent': 'workflow-foundry-corpus/2026-10-06 (research; low rate)'}


def get(url):
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except Exception:
            if i == 3:
                raise
            time.sleep(3 * (i + 1))


os.makedirs(f'{ROOT}/marketplace/dsl', exist_ok=True)
page, items = 1, []
while True:
    out = f'{ROOT}/marketplace/list-{page:02d}.json.gz'
    if not os.path.exists(out):
        with gzip.open(out, 'wb') as f:
            f.write(get(f'https://marketplace.dify.ai/api/v1/templates?page={page}&page_size=100'))
        time.sleep(0.5)
    d = json.load(gzip.open(out))
    t = d['data']['templates']
    if not t:
        os.remove(out)
        break
    items += t
    page += 1
print('marketplace listed', len(items))
ok = err = 0
for t in items:
    out = f'{ROOT}/marketplace/dsl/{t["id"]}.yaml.gz'
    if os.path.exists(out):
        ok += 1
        continue
    try:
        raw = get(f'https://marketplace.dify.ai/api/v1/templates/{t["id"]}/dsl')
        with gzip.open(out, 'wb') as f:
            f.write(raw)
        ok += 1
        time.sleep(0.3)
    except Exception as e:
        err += 1
        print('dsl error', t['id'], e, file=sys.stderr)
print('dsl ok', ok, 'err', err)
if len(sys.argv) > 1:
    sha = sys.argv[1]
    os.makedirs(f'{ROOT}/repo-{sha[:12]}', exist_ok=True)
    for p in ['api/constants/recommended_apps.json', 'LICENSE']:
        out = f'{ROOT}/repo-{sha[:12]}/' + p.replace('/', '__')
        if not os.path.exists(out):
            open(out, 'wb').write(get(f'https://raw.githubusercontent.com/langgenius/dify/{sha}/{p}'))
    open(f'{ROOT}/repo-{sha[:12]}/SHA', 'w').write(sha + '\n')
    print('repo files ok', sha)
