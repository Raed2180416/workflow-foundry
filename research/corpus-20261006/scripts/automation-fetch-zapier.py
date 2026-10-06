#!/usr/bin/env python3
"""Acquire a seeded sample of Zapier public template pages (zapier.com/templates/details/*).
robots.txt (2026-10-06) allows Claude-User/ClaudeBot on '/', Content-Signal ai-input=yes; pages are
ToS-governed (https://zapier.com/legal/terms-of-service) -> redistributable:false, raw stays in /opt.
Each page embeds a ZSL document (zaps[].zdl.steps[] with app/type/action/params, edges, agents, tables).
Usage: python3 -I automation-fetch-zapier.py [n_sample]
"""
import gzip, hashlib, json, os, random, re, sys, time, urllib.request

ROOT = '/opt/corpus/zapier'
UA = {'User-Agent': 'Claude-User (workflow-foundry corpus research; 1 req/s)'}
SITEMAP = 'https://zapier.com/sitemaps/templates/Xf3Lk9YbRzQnmgP2eCJtA5Wxv0NdMu6T'


def get(url):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except Exception:
            if i == 2:
                raise
            time.sleep(5 * (i + 1))


def extract_zsl(html):
    chunks = re.findall(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', html)
    s = ''.join(json.loads(c) for c in chunks)
    i = s.find('"zsl":')
    if i < 0:
        return None, s
    obj, _ = json.JSONDecoder().raw_decode(s[i + 6:])
    return obj, s


if __name__ == '__main__':
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 160
    os.makedirs(f'{ROOT}/pages', exist_ok=True)
    urls = []
    for p in (1, 2, 3):
        out = f'{ROOT}/sitemap-items-{p}.xml.gz'
        if not os.path.exists(out):
            with gzip.open(out, 'wb') as f:
                f.write(get(f'{SITEMAP}/items?page={p}'))
            time.sleep(1)
        urls += re.findall(r'<loc>([^<]+)</loc>', gzip.open(out).read().decode())
    urls = sorted(set(u for u in urls if '/templates/details/' in u))
    sample = random.Random(20261006).sample(urls, min(n, len(urls)))
    json.dump({'sitemapUrls': len(urls), 'sample': sample}, open(f'{ROOT}/sample.json', 'w'), indent=1)
    ok = err = 0
    for u in sample:
        out = f'{ROOT}/pages/{hashlib.sha1(u.encode()).hexdigest()[:16]}.html.gz'
        if os.path.exists(out):
            ok += 1
            continue
        try:
            raw = get(u)
            with gzip.open(out, 'wb') as f:
                f.write(raw)
            ok += 1
        except Exception as e:
            err += 1
            print('error', u, e, file=sys.stderr)
        time.sleep(1.0)
    print('sitemap urls', len(urls), 'fetched', ok, 'errors', err)
