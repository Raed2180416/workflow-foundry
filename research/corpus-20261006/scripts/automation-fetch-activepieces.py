#!/usr/bin/env python3
"""Acquire Activepieces official templates (cloud.activepieces.com/api/v1/templates; the endpoint returned all
420 templates in one response on 2026-10-06, `next: null`). Raw -> /opt/corpus/activepieces/templates-all.json.
Usage: python3 -I automation-fetch-activepieces.py
"""
import json, os, urllib.request

out = '/opt/corpus/activepieces/templates-all.json'
os.makedirs(os.path.dirname(out), exist_ok=True)
req = urllib.request.Request('https://cloud.activepieces.com/api/v1/templates',
                             headers={'User-Agent': 'workflow-foundry-corpus/2026-10-06 (research; low rate)'})
raw = urllib.request.urlopen(req, timeout=120).read()
open(out, 'wb').write(raw)
d = json.loads(raw)
print('templates', len(d['data']), 'next', d.get('next'))
