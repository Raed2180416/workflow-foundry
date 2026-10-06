#!/usr/bin/env python3
"""Acquire the Node-RED flow library (flows.nodered.org, type=flow) listing pages.
The listing embeds each flow's JSON (gist content). Raw pages -> /opt/corpus/node-red/pages/ (gzip).
Usage: python3 -I automation-fetch-nodered.py
"""
import gzip, json, os, time, urllib.request

ROOT = '/opt/corpus/node-red'
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


os.makedirs(f'{ROOT}/pages', exist_ok=True)
page, n = 1, 0
while True:
    out = f'{ROOT}/pages/page-{page:03d}.json.gz'
    if not os.path.exists(out):
        raw = get(f'https://flows.nodered.org/things?format=json&per_page=100&page={page}&type=flow')
        with gzip.open(out, 'wb') as f:
            f.write(raw)
        time.sleep(0.5)
    d = json.load(gzip.open(out))
    if not d.get('data'):
        os.remove(out)
        break
    n += len(d['data'])
    page += 1
print('pages', page - 1, 'flows', n)
